import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { NodeInputKind } from "../types/nodeInputs";
import {
  applyGenerationProjectionInTransaction,
} from "./canvasMutationGateway";
import { buildCanvasProjectionIdentity } from
  "./generationCanvasProjection";
import {
  canvasLoadTokenEpochForApplication,
  canvasLoadTokenForApplication,
} from "./canvasPersistence";
import { stableSha256 } from "../types/canvasFingerprint";
import {
  canvasObservabilitySavepoint,
  deferCanvasCommandEvent,
  deferCanvasRouteEvent,
  deferGenerationLifecycleEvent,
  rollbackDeferredCanvasObservabilityTo,
  type CanvasServerClass,
} from "./canvasObservability";
import { currentVersion } from "./version";

export function canvasGraphRevisionMatchesInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  graphRevision: number;
  ownerId: string;
}) {
  const row = input.database.prepare(`
    SELECT graph_revision FROM canvas_documents
    WHERE owner_id = ? AND id = ?
  `).get(input.ownerId, input.canvasId) as
    | { graph_revision?: unknown }
    | undefined;
  return Boolean(row && Number(row.graph_revision) === input.graphRevision);
}

export function projectWorkflowResultInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  kind: NodeInputKind;
  nodeId: string;
  ownerId: string;
  runId: string;
  taskId: string;
}) {
  if (!input.database.isTransaction) {
    throw new Error("Workflow Canvas projection requires an active transaction");
  }
  const deferFailure = (serverClass: CanvasServerClass) => {
    const requestId = randomUUID();
    const row = input.database.prepare(`
      SELECT revision, graph_revision FROM canvas_documents
      WHERE owner_id = ? AND id = ?
    `).get(input.ownerId, input.canvasId) as
      | { graph_revision: number; revision: number }
      | undefined;
    deferCanvasCommandEvent(input.database, {
      actor: "server",
      affectedNodeHash: stableSha256({ nodeId: input.nodeId }),
      afterDocumentRevision: row?.revision ?? null,
      afterInputRevision: row?.graph_revision ?? null,
      beforeDocumentRevision: row?.revision ?? null,
      beforeInputRevision: row?.graph_revision ?? null,
      commandKind: "server.projection",
      operationId: `server-projection-unresolved:${input.taskId}`,
      outcome: "projection.failed",
      requestId,
    });
    deferCanvasRouteEvent(input.database, {
      callerSymbol: "server.canvasWorkflowProjection",
      capability: "internal-server-v1",
      clientBuild: currentVersion,
      operation: "workflow-result-projection",
      outcome: "projection.failed",
      requestId,
      route: "canvas.server-projection",
      runId: input.runId,
      serverClass: row ? serverClass : "D",
      taskId: input.taskId,
    });
    deferGenerationLifecycleEvent(input.database, {
      kind: input.kind,
      operation: "workflow-result-projection",
      outcome: "projection.failed",
      projectionState: "failed",
      requestId,
      runId: input.runId,
      taskId: input.taskId,
      taskState: "success",
    });
  };

  const observabilitySavepoint = canvasObservabilitySavepoint(input.database);
  input.database.exec("SAVEPOINT workflow_canvas_projection");
  try {
    const built = buildCanvasProjectionIdentity(input);
    if (built.status !== "ready") {
      input.database.exec("RELEASE SAVEPOINT workflow_canvas_projection");
      deferFailure("D");
      return "failed" as const;
    }
    const result = applyGenerationProjectionInTransaction({
      database: input.database,
      loadTokenEpoch: canvasLoadTokenEpochForApplication(),
      loadTokenForRevision: (revision) => canvasLoadTokenForApplication(
        input.ownerId,
        input.canvasId,
        revision,
      ),
      projection: built.projection,
    });
    input.database.exec("RELEASE SAVEPOINT workflow_canvas_projection");
    return result;
  } catch (error) {
    try {
      input.database.exec("ROLLBACK TO SAVEPOINT workflow_canvas_projection");
      input.database.exec("RELEASE SAVEPOINT workflow_canvas_projection");
    } catch (rollbackError) {
      rollbackDeferredCanvasObservabilityTo(
        input.database,
        observabilitySavepoint,
      );
      throw rollbackError;
    }
    rollbackDeferredCanvasObservabilityTo(input.database, observabilitySavepoint);
    deferFailure("B");
    return "failed" as const;
  }
}
