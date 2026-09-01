import type { DatabaseSync } from "node:sqlite";

export function workflowRunLockOwnerInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  nodeId: string;
  ownerId: string;
}) {
  const row = input.database.prepare(`
    SELECT run_id FROM workflow_run_locks
    WHERE owner_id = ? AND canvas_id = ? AND node_id = ?
  `).get(input.ownerId, input.canvasId, input.nodeId) as
    | { run_id?: unknown }
    | undefined;
  return row ? String(row.run_id) : undefined;
}

export function workflowRunAcceptingAdmissionsInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  ownerId: string;
  runId: string;
}) {
  return Boolean(input.database.prepare(`
    SELECT 1 FROM workflow_runs
    WHERE id = ? AND owner_id = ? AND canvas_id = ?
      AND state = 'running' AND stop_requested = 0
    LIMIT 1
  `).get(input.runId, input.ownerId, input.canvasId));
}

export function assertWorkflowMediaDeletionAllowedInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    assetId: string;
    kind: "audio" | "image" | "video";
    ownerId: string;
  }>,
) {
  const activeWorkflowInput = database.prepare(`
    SELECT 1
    FROM workflow_runs AS run,
      json_each(run.plan_json, '$.externalNodes') AS external
    WHERE run.owner_id = ?
      AND run.state IN ('running', 'stopping')
      AND json_extract(external.value, '$.data.assetId') = ?
      AND json_extract(external.value, '$.type') = ?
    LIMIT 1
  `).get(input.ownerId, input.assetId, input.kind);
  if (activeWorkflowInput) {
    throw new Error("Active workflow inputs cannot be deleted");
  }
}

export function workflowRunLockedNodeIdsInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  ownerId: string;
}) {
  return (input.database.prepare(`
    SELECT node_id FROM workflow_run_locks
    WHERE owner_id = ? AND canvas_id = ?
  `).all(input.ownerId, input.canvasId) as Array<{ node_id: string }>)
    .map(({ node_id }) => node_id);
}

export function hasActiveWorkflowRunForCanvas(
  database: DatabaseSync,
  ownerId: string,
  canvasId: string,
  bypass = false,
) {
  const row = bypass
    ? database.prepare(`
        SELECT 1 FROM workflow_runs
        WHERE canvas_id = ? AND state IN ('running', 'stopping') LIMIT 1
      `).get(canvasId)
    : database.prepare(`
        SELECT 1 FROM workflow_runs
        WHERE owner_id = ? AND canvas_id = ?
          AND state IN ('running', 'stopping') LIMIT 1
      `).get(ownerId, canvasId);
  return Boolean(row);
}

/** Delete only after the caller has fenced active runs in the same transaction. */
export function deleteWorkflowRunsForCanvasInTransaction(input: {
  bypass: boolean;
  canvasId: string;
  database: DatabaseSync;
  ownerId: string;
}) {
  if (!input.database.isTransaction) {
    throw new Error("Workflow run deletion requires an existing transaction");
  }
  if (input.bypass) {
    input.database.prepare("DELETE FROM workflow_runs WHERE canvas_id = ?")
      .run(input.canvasId);
    return;
  }
  input.database.prepare(`
    DELETE FROM workflow_runs WHERE owner_id = ? AND canvas_id = ?
  `).run(input.ownerId, input.canvasId);
}

/** Account deletion already proves no active/unresolved generation work. */
export function deleteWorkflowRunsForOwnerInTransaction(
  database: DatabaseSync,
  ownerId: string,
) {
  if (!database.isTransaction) {
    throw new Error("Workflow run deletion requires an existing transaction");
  }
  database.prepare("DELETE FROM workflow_runs WHERE owner_id = ?").run(ownerId);
}
