import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  buildCanvasProjectionIdentity,
} from "./generationCanvasProjection";
import {
  applyGenerationProjectionInTransaction,
} from "./canvasMutationGateway";
import { canvasLoadTokens } from "./canvasLoadTokenPort";
import { openAppDatabase } from "./database";
import {
  canvasObservabilitySavepoint,
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
  rollbackDeferredCanvasObservabilityTo,
  deferCanvasCommandEvent,
  deferCanvasRouteEvent,
  deferGenerationLifecycleEvent,
} from "./canvasObservability";
import { stableSha256 } from "../types/canvasFingerprint";
import { currentVersion } from "./version";
import { readCanvasRevisionCommand } from "./canvasTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";

export type SingleNodeCanvasProjectionState =
  | "applied"
  | "conflict"
  | "failed"
  | "settlement-unavailable"
  | "workflow-owned";

type ProjectionTaskIdentity = Readonly<{
  canvas_id: string;
  kind: "audio" | "image" | "text" | "video";
  model_configuration: string;
  node_id: string;
  owner_id: string | null;
  state: string;
}>;

type DurableSingleNodeProjectionState = "applied" | "conflict" | "failed";

let beforeSingleNodeProjectionSettlementForTests:
  | ((state: DurableSingleNodeProjectionState) => void)
  | undefined;

/** Safe-runner-only fault at the durable projection-state settlement boundary. */
export function setSingleNodeProjectionSettlementFaultForTests(
  fault?: (state: DurableSingleNodeProjectionState) => void,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("Single-node projection settlement test fault is disabled");
  }
  beforeSingleNodeProjectionSettlementForTests = fault;
}

function taskIdentity(database: DatabaseSync, taskId: string) {
  return database.prepare(`
    SELECT owner_id, canvas_id, node_id, kind, state, model_configuration
    FROM generation_tasks WHERE id = ?
  `).get(taskId) as ProjectionTaskIdentity | undefined;
}

function hasWorkflowBinding(modelConfiguration: string) {
  try {
    const value = JSON.parse(modelConfiguration) as unknown;
    return Boolean(
      value && typeof value === "object" && !Array.isArray(value) &&
      (value as Record<string, unknown>).workflowBinding,
    );
  } catch {
    return false;
  }
}

function settleSingleNodeProjectionState(
  database: DatabaseSync,
  task: ProjectionTaskIdentity,
  taskId: string,
  state: DurableSingleNodeProjectionState,
  operationId: string | null,
  serverClass?: "B" | "D",
) {
  beforeSingleNodeProjectionSettlementForTests?.(state);
  const timestamp = new Date().toISOString();
  const settled = database.prepare(`
    INSERT INTO generation_canvas_projection_states (
      task_id, owner_id, canvas_id, operation_id, state, failure_count,
      last_error_class, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      operation_id = excluded.operation_id,
      state = excluded.state,
      failure_count = CASE
        WHEN excluded.state = 'failed'
        THEN generation_canvas_projection_states.failure_count + 1
        ELSE 0
      END,
      last_error_class = excluded.last_error_class,
      updated_at = excluded.updated_at
    WHERE generation_canvas_projection_states.owner_id = excluded.owner_id
      AND generation_canvas_projection_states.canvas_id = excluded.canvas_id
  `).run(
    taskId,
    task.owner_id,
    task.canvas_id,
    operationId,
    state,
    state === "failed" ? 1 : 0,
    state === "failed" ? serverClass ?? "D" : null,
    timestamp,
    timestamp,
  );
  if (settled.changes !== 1) {
    throw new Error("Single-node Canvas projection identity changed");
  }
}

function retainFailedSingleNodeProjection(
  database: DatabaseSync,
  task: ProjectionTaskIdentity,
  taskId: string,
  operationId: string | null,
  serverClass: "B" | "D",
) {
  try {
    settleSingleNodeProjectionState(
      database,
      task,
      taskId,
      "failed",
      operationId,
      serverClass,
    );
    return true;
  } catch {
    // Projection bookkeeping must never demote or roll back a successful task.
    // The missing durable state remains discoverable as a pending retry candidate.
    return false;
  }
}

function deferFailedSingleNodeProjection(
  database: DatabaseSync,
  task: ProjectionTaskIdentity,
  taskId: string,
  serverClass: "B" | "D",
  settlementUnavailable = false,
) {
  const requestId = randomUUID();
  const row = executeTransactionScopedCommand(
    database,
    readCanvasRevisionCommand,
    { canvasId: task.canvas_id, ownerId: task.owner_id! },
  );
  deferCanvasCommandEvent(database, {
    actor: "server",
    affectedNodeHash: stableSha256({ nodeId: task.node_id }),
    afterDocumentRevision: row?.documentRevision ?? null,
    afterInputRevision: row?.inputRevision ?? null,
    beforeDocumentRevision: row?.documentRevision ?? null,
    beforeInputRevision: row?.inputRevision ?? null,
    commandKind: "server.projection",
    operationId: `server-projection-unresolved:${taskId}`,
    outcome: settlementUnavailable
      ? "projection.settlement-unavailable"
      : "projection.failed",
    requestId,
  });
  deferCanvasRouteEvent(database, {
    callerSymbol: "server.generationCanvasProjectionService",
    capability: "internal-server-v1",
    clientBuild: currentVersion,
    operation: "single-node-result-projection",
    outcome: settlementUnavailable
      ? "projection.settlement-unavailable"
      : "projection.failed",
    requestId,
    route: "canvas.server-projection",
    runId: `single-node:${taskId}`,
    serverClass: row ? serverClass : "D",
    taskId,
  });
  deferGenerationLifecycleEvent(database, {
    kind: task.kind,
    operation: "single-node-result-projection",
    outcome: settlementUnavailable
      ? "projection.settlement-unavailable"
      : "projection.failed",
    projectionState: settlementUnavailable
      ? "settlement-unavailable"
      : "failed",
    requestId,
    runId: `single-node:${taskId}`,
    taskId,
    taskState: "success",
  });
}

/**
 * Project one modern single-node success inside its caller's transaction.
 * A savepoint contains projection-only faults so task/publication success is
 * never reversed and can be retried without another Provider request.
 */
export function projectSingleNodeGenerationResultInTransaction(
  database: DatabaseSync,
  taskId: string,
): SingleNodeCanvasProjectionState {
  if (!database.isTransaction) {
    throw new Error("Single-node Canvas projection requires an active transaction");
  }
  const task = taskIdentity(database, taskId);
  if (
    !task || task.state !== "success" || !task.owner_id ||
    !["audio", "image", "text", "video"].includes(task.kind)
  ) return "failed";
  if (hasWorkflowBinding(task.model_configuration)) return "workflow-owned";
  const observabilitySavepoint = canvasObservabilitySavepoint(database);
  let operationId: string | null = null;
  let projectionSavepointActive = true;
  database.exec("SAVEPOINT single_node_canvas_projection");
  try {
    const built = buildCanvasProjectionIdentity({
      canvasId: task.canvas_id,
      database,
      kind: task.kind,
      nodeId: task.node_id,
      ownerId: task.owner_id,
      taskId,
    });
    if (built.status !== "ready") {
      database.exec("RELEASE SAVEPOINT single_node_canvas_projection");
      projectionSavepointActive = false;
      const retained = retainFailedSingleNodeProjection(
        database,
        task,
        taskId,
        null,
        "D",
      );
      deferFailedSingleNodeProjection(database, task, taskId, "D", !retained);
      return retained ? "failed" : "settlement-unavailable";
    }
    operationId = built.projection.operationId;
    const result = applyGenerationProjectionInTransaction({
      database,
      loadTokenEpoch: canvasLoadTokens.epoch(),
      loadTokenForRevision: (revision) => canvasLoadTokens.forRevision(
        task.owner_id!,
        task.canvas_id,
        revision,
      ),
      projection: built.projection,
    });
    if (result === "failed") {
      settleSingleNodeProjectionState(
        database,
        task,
        taskId,
        "failed",
        operationId,
        "D",
      );
    } else {
      settleSingleNodeProjectionState(
        database,
        task,
        taskId,
        result,
        operationId,
      );
    }
    database.exec("RELEASE SAVEPOINT single_node_canvas_projection");
    projectionSavepointActive = false;
    return result;
  } catch {
    try {
      if (projectionSavepointActive) {
        database.exec("ROLLBACK TO SAVEPOINT single_node_canvas_projection");
        database.exec("RELEASE SAVEPOINT single_node_canvas_projection");
      }
    } catch (rollbackError) {
      rollbackDeferredCanvasObservabilityTo(database, observabilitySavepoint);
      throw rollbackError;
    }
    rollbackDeferredCanvasObservabilityTo(database, observabilitySavepoint);
    const retained = retainFailedSingleNodeProjection(
      database,
      task,
      taskId,
      operationId,
      "B",
    );
    deferFailedSingleNodeProjection(database, task, taskId, "B", !retained);
    return retained ? "failed" : "settlement-unavailable";
  }
}

export type SingleNodeCanvasProjectionSweepResult = Readonly<{
  applied: number;
  conflict: number;
  failed: number;
  visited: number;
}>;

/** Retry a bounded recent set; receipt/proof replay makes completed rows no-op. */
export function retrySingleNodeCanvasProjections(input?: Readonly<{
  dataDirectory?: string;
  limit?: number;
}>): SingleNodeCanvasProjectionSweepResult {
  const database = openAppDatabase(input?.dataDirectory);
  const limit = Math.max(1, Math.min(500, input?.limit ?? 200));
  const counts = { applied: 0, conflict: 0, failed: 0, visited: 0 };
  try {
    const rows = database.prepare(`
      SELECT task.id
      FROM generation_tasks AS task
      LEFT JOIN generation_canvas_projection_states AS projection
        ON projection.task_id = task.id
      WHERE task.state = 'success'
        AND json_valid(task.model_configuration)
        AND json_type(task.model_configuration, '$.generationIdentityVersion') = 'integer'
        AND json_extract(task.model_configuration, '$.generationIdentityVersion') = 2
        AND json_type(task.model_configuration, '$.workflowBinding') IS NULL
        AND (projection.state IS NULL OR projection.state IN ('pending', 'failed'))
      ORDER BY task.updated_at DESC, task.id
      LIMIT ?
    `).all(limit) as Array<{ id: string }>;
    for (const row of rows) {
      counts.visited += 1;
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = projectSingleNodeGenerationResultInTransaction(
          database,
          row.id,
        );
        if (result === "applied") counts.applied += 1;
        else if (result === "conflict") counts.conflict += 1;
        else counts.failed += 1;
        database.exec("COMMIT");
        flushDeferredCanvasObservability(database);
      } catch {
        if (database.isTransaction) database.exec("ROLLBACK");
        discardDeferredCanvasObservability(database);
        counts.failed += 1;
      }
    }
    return Object.freeze({ ...counts });
  } finally {
    database.close();
  }
}

export function singleNodeCanvasProjectionCandidateCount(dataDirectory?: string) {
  const database = openAppDatabase(dataDirectory);
  try {
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_tasks AS task
      LEFT JOIN generation_canvas_projection_states AS projection
        ON projection.task_id = task.id
      WHERE task.state = 'success'
        AND json_valid(task.model_configuration)
        AND json_extract(task.model_configuration, '$.generationIdentityVersion') = 2
        AND json_type(task.model_configuration, '$.workflowBinding') IS NULL
        AND (projection.state IS NULL OR projection.state IN ('pending', 'failed'))
    `).get() as { count: number };
    return Number(row.count);
  } finally {
    database.close();
  }
}
