import type { DatabaseSync } from "node:sqlite";

export function workflowRunLockOwnerInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  nodeId: string;
  ownerId: string;
}) {
  const row = input.database.prepare(`
    SELECT lock.run_id
    FROM workflow_run_locks AS lock
    JOIN workflow_runs AS run
      ON run.id = lock.run_id
      AND run.owner_id = lock.owner_id
      AND run.canvas_id = lock.canvas_id
    WHERE lock.owner_id = ? AND lock.canvas_id = ? AND lock.node_id = ?
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

export type WorkflowRunAdmissionAuthority = Readonly<{
  groupId: string;
  idempotencyKey: string;
  kind: string;
  nodeSemanticIdentity: string;
  nodeState: string;
  planModelConfigurationRevision: string;
  planModelId: string;
  planModelReleaseRevision: string;
  planSemanticIdentity: string;
  reservationExpiresAt: string;
  reservationId: string;
  reservationOwnerId: string;
  reservationRunId: string;
  reservationState: string;
  runId: string;
  runState: string;
  stopRequested: number;
}>;

/**
 * Resolves the complete workflow authority from the lock while the caller
 * holds the task-admission write transaction. No request/body reservation is
 * used to select this row.
 */
export function workflowRunAdmissionAuthorityInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  nodeId: string;
  ownerId: string;
}): WorkflowRunAdmissionAuthority | undefined {
  if (!input.database.isTransaction) {
    throw new Error("Workflow admission authority requires a transaction");
  }
  const row = input.database.prepare(`
    SELECT
      run.id AS run_id,
      run.group_id,
      run.state AS run_state,
      run.stop_requested,
      node.kind,
      node.state AS node_state,
      node.semantic_identity AS node_semantic_identity,
      node.idempotency_key,
      reservation.id AS reservation_id,
      reservation.owner_id AS reservation_owner_id,
      reservation.workflow_run_id AS reservation_run_id,
      reservation.state AS reservation_state,
      reservation.expires_at AS reservation_expires_at,
      json_extract(plan_node.value, '$.semanticIdentity')
        AS plan_semantic_identity,
      json_extract(plan_node.value, '$.modelId') AS plan_model_id,
      json_extract(plan_node.value, '$.modelConfigurationRevision')
        AS plan_model_configuration_revision,
      json_extract(plan_node.value, '$.modelReleaseRevision.revisionId')
        AS plan_model_release_revision
    FROM workflow_run_locks AS lock
    JOIN workflow_runs AS run
      ON run.id = lock.run_id
      AND run.owner_id = lock.owner_id
      AND run.canvas_id = lock.canvas_id
    JOIN workflow_run_nodes AS node
      ON node.run_id = run.id
      AND node.owner_id = run.owner_id
      AND node.node_id = lock.node_id
    LEFT JOIN media_capacity_reservations AS reservation
      ON reservation.id = run.reservation_id
      AND reservation.workflow_run_id = run.id
      AND reservation.owner_id = run.owner_id
    LEFT JOIN json_each(run.plan_json, '$.nodes') AS plan_node
      ON json_extract(plan_node.value, '$.id') = node.node_id
    WHERE lock.owner_id = ? AND lock.canvas_id = ? AND lock.node_id = ?
    LIMIT 1
  `).get(input.ownerId, input.canvasId, input.nodeId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return Object.freeze({
    groupId: String(row.group_id ?? ""),
    idempotencyKey: String(row.idempotency_key ?? ""),
    kind: String(row.kind ?? ""),
    nodeSemanticIdentity: String(row.node_semantic_identity ?? ""),
    nodeState: String(row.node_state ?? ""),
    planModelConfigurationRevision: String(
      row.plan_model_configuration_revision ?? "",
    ),
    planModelId: String(row.plan_model_id ?? ""),
    planModelReleaseRevision: String(row.plan_model_release_revision ?? ""),
    planSemanticIdentity: String(row.plan_semantic_identity ?? ""),
    reservationExpiresAt: String(row.reservation_expires_at ?? ""),
    reservationId: String(row.reservation_id ?? ""),
    reservationOwnerId: String(row.reservation_owner_id ?? ""),
    reservationRunId: String(row.reservation_run_id ?? ""),
    reservationState: String(row.reservation_state ?? ""),
    runId: String(row.run_id ?? ""),
    runState: String(row.run_state ?? ""),
    stopRequested: Number(row.stop_requested),
  });
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
