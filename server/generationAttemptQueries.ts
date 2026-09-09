import type { DatabaseSync } from "node:sqlite";
import { assertWorkflowMediaDeletionAllowedInTransaction } from
  "./workflowRunLocks";
import { providerEvidenceConflictEventCode } from "./generationRecoveryTaskQueries";

export type LatestGenerationProviderAttemptRow = Readonly<{
  credential_revision: number;
  evidence: "historical-execution-attempt" | "provider-boundary";
  execution_attempt: number;
  failure_code: string | null;
  finished_at: string | null;
  kind: string;
  outcome: string;
  owner_id: string | null;
  provider_model_id: string;
  provider_profile_id: string;
  provider_task_id: string | null;
  task_id: string;
}>;

/** Single latest-attempt read contract shared by runtime and repair tooling. */
export function latestGenerationProviderAttemptInTransaction(
  database: DatabaseSync,
  input: Readonly<{ executionAttempt?: number; taskId: string }>,
) {
  return database.prepare(`
    SELECT
      task_id, execution_attempt, provider_profile_id, provider_model_id,
      kind, owner_id, credential_revision, outcome, provider_task_id,
      failure_code, finished_at, evidence
    FROM generation_provider_attempts
    WHERE task_id = ?
      ${input.executionAttempt === undefined ? "" : "AND execution_attempt = ?"}
    ORDER BY execution_attempt DESC, id DESC
    LIMIT 1
  `).get(
    input.taskId,
    ...(input.executionAttempt === undefined ? [] : [input.executionAttempt]),
  ) as LatestGenerationProviderAttemptRow | undefined;
}

export function hasUnresolvedPaidBoundaryInTransaction(
  database: DatabaseSync,
  taskId: string,
) {
  const attempt = latestGenerationProviderAttemptInTransaction(database, { taskId });
  return Boolean(attempt && attempt.evidence === "provider-boundary" && (
    attempt.outcome === "outcome-unknown" ||
    (!attempt.finished_at && [
      "boundary-claimed",
      "accepted",
      "response-received",
    ].includes(attempt.outcome))
  ));
}

export function generationProviderAttemptCounts(database: DatabaseSync) {
  const row = database.prepare(`
    SELECT
      COALESCE(SUM(
        CASE WHEN evidence = 'provider-boundary' THEN 1 ELSE 0 END
      ), 0) AS paid_provider_requests,
      COALESCE(SUM(
        CASE WHEN evidence = 'historical-execution-attempt' THEN 1 ELSE 0 END
      ), 0) AS historical_estimated_provider_attempts
    FROM generation_provider_attempts
  `).get() as {
    historical_estimated_provider_attempts: number;
    paid_provider_requests: number;
  };
  return {
    historicalEstimatedProviderAttempts: Number(
      row.historical_estimated_provider_attempts,
    ),
    paidProviderRequests: Number(row.paid_provider_requests),
  };
}

export function generationProviderAttemptCreatedAt(
  database: DatabaseSync,
  input: Readonly<{
    executionAttempt: number;
    providerTaskId?: string;
    taskId: string;
  }>,
) {
  const row = database.prepare(`
    SELECT created_at
    FROM generation_provider_attempts
    WHERE task_id = ?
      AND ${input.providerTaskId
        ? "provider_task_id = ?"
        : "execution_attempt = ?"}
      AND evidence = 'provider-boundary'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(
    input.taskId,
    input.providerTaskId ?? input.executionAttempt,
  ) as { created_at: string } | undefined;
  return row?.created_at;
}

export function assertGenerationMediaDeletionAllowedInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    assetId: string;
    kind: "audio" | "image" | "video";
    ownerId: string;
  }>,
) {
  const publishedTask = database.prepare(`
    SELECT 1 FROM generation_tasks AS task
    WHERE task.owner_id = ? AND task.kind = ?
      AND (
        (task.state = 'success' AND task.result_asset_id = ?)
        OR EXISTS (
          SELECT 1 FROM media_publication_attempts AS publication
          WHERE publication.task_id = task.id
            AND publication.task_execution_attempt = task.attempt
            AND publication.owner_id = task.owner_id
            AND publication.kind = task.kind
            AND publication.asset_id = ?
            AND publication.source = 'generation'
            AND publication.state = 'published'
        )
      )
    LIMIT 1
  `).get(input.ownerId, input.kind, input.assetId, input.assetId);
  if (publishedTask) {
    throw new Error("Published generation results cannot be deleted");
  }
  assertWorkflowMediaDeletionAllowedInTransaction(database, input);
}

export function hasActiveGenerationTaskForNodeInTransaction(
  database: DatabaseSync,
  input: Readonly<{ canvasId: string; nodeId: string; ownerId: string }>,
) {
  return Boolean(database.prepare(`
    SELECT 1 FROM generation_tasks
    WHERE owner_id = ? AND canvas_id = ? AND node_id = ?
      AND state IN ('queued', 'running', 'retrying', 'recovering')
    LIMIT 1
  `).get(input.ownerId, input.canvasId, input.nodeId));
}

/** A new user intent cannot discard any unresolved execution on this node. */
export function newGenerationForNodeInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    canvasId: string; kind: string; nodeId: string; ownerId: string;
    excludeTaskId?: string;
  }>,
): Readonly<{ allowed: boolean; reason?: string; taskId?: string }> {
  const rows = database.prepare(`
    SELECT task.id, task.state, task.error_code, task.provider_task_id,
      task.result_asset_id, task.result_text,
      EXISTS (SELECT 1 FROM generation_provider_attempts AS attempt
        WHERE attempt.task_id = task.id AND (
          attempt.owner_id IS NOT task.owner_id
          OR attempt.kind IS NOT task.kind
          OR attempt.provider_profile_id IS NOT task.provider_profile_id
          OR attempt.provider_model_id IS NOT task.provider_model_id
          OR attempt.outcome IN ('boundary-claimed', 'accepted', 'response-received', 'outcome-unknown')
          OR (attempt.outcome = 'provider-failed' AND NOT (
            attempt.finished_at IS NOT NULL AND (
              COALESCE(attempt.failure_code, '') = 'PROVIDER_REFUNDED' OR (
                COALESCE(attempt.failure_code, '') = 'PROVIDER_FAILED_CHARGE_SETTLED' AND EXISTS (
                  SELECT 1 FROM generation_task_events AS event
                  WHERE event.task_id = task.id AND event.error_code = 'PROVIDER_FAILURE_CHARGE_SETTLED'
                    AND json_valid(event.error_message)
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.taskId') = task.id
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.ownerId') = task.owner_id
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.canvasId') = task.canvas_id
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.nodeId') = task.node_id
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.kind') = task.kind
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.executionAttempt') = attempt.execution_attempt
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.providerTaskId') = attempt.provider_task_id
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.providerProfileId') = attempt.provider_profile_id
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.providerModelId') = attempt.provider_model_id
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.terminalState') = 'failed'
                    AND json_extract(CASE WHEN json_valid(event.error_message) THEN event.error_message ELSE '{}' END, '$.feeDisposition') = 'charged'
                )
              )
            )
          ))
          OR (attempt.outcome = 'definitive-rejected' AND NOT (
            COALESCE(attempt.failure_code, '') = 'PROVIDER_NOT_ACCEPTED_NO_CHARGE' AND attempt.finished_at IS NOT NULL
          ))
          OR (attempt.outcome = 'completed' AND task.state <> 'success')
        )) AS unsafe_attempt,
      EXISTS (SELECT 1 FROM media_publication_attempts AS publication
        WHERE publication.task_id = task.id AND publication.source = 'generation'
          AND (task.state <> 'success' OR publication.state NOT IN ('published', 'failed'))
      ) AS recoverable_publication,
      EXISTS (SELECT 1 FROM generation_canvas_projection_states AS projection
        WHERE projection.task_id = task.id AND projection.state IN ('pending', 'failed')
      ) AS pending_projection,
      EXISTS (SELECT 1 FROM generation_task_events AS conflict_event
        WHERE conflict_event.task_id = task.id
          AND conflict_event.error_code = ?) AS provider_evidence_conflict
    FROM generation_tasks AS task
    WHERE task.owner_id = ? AND task.canvas_id = ? AND task.node_id = ?
      AND task.kind = ? AND task.id <> ?
    ORDER BY task.created_at DESC, task.id DESC
  `).all(providerEvidenceConflictEventCode, input.ownerId, input.canvasId, input.nodeId, input.kind, input.excludeTaskId ?? "") as Array<{
    id: string; state: string; error_code: string | null;
    provider_task_id: string | null; result_asset_id: string | null;
    result_text: string | null; unsafe_attempt: number; recoverable_publication: number; pending_projection: number;
    provider_evidence_conflict: number;
  }>;
  for (const row of rows) {
    if (['queued', 'running', 'retrying', 'recovering'].includes(row.state)) {
      return { allowed: false, taskId: row.id,
        reason: '这个节点已有任务在处理，系统会继续跟进原任务，请稍候' };
    }
    if (row.error_code === 'OPERATOR_INCIDENT' ||
        row.error_code === 'OUTCOME_UNKNOWN_BILLING_RISK' || row.unsafe_attempt ||
        row.provider_evidence_conflict) {
      return { allowed: false, taskId: row.id,
        reason: '上次请求的结果或扣费尚未查清，系统会继续核对；现在重新生成可能重复扣费' };
    }
    if (row.recoverable_publication || row.pending_projection || (row.state !== 'success' &&
        (row.result_asset_id || row.result_text))) {
      return { allowed: false, taskId: row.id,
        reason: '上次生成已有结果，系统正在恢复保存，请稍候' };
    }
    if (row.provider_task_id && !database.prepare(`
      SELECT 1 FROM generation_provider_attempts
      WHERE task_id = ? AND provider_task_id = ?
    `).get(row.id, row.provider_task_id)) {
      return { allowed: false, taskId: row.id,
        reason: '上次平台任务的记录不完整，需要先核对原任务' };
    }
  }
  return { allowed: true };
}

/** A workflow run id must never make an unresolved paid outcome look new. */
export function hasUnresolvedGenerationOutcomeForNodeInTransaction(
  database: DatabaseSync,
  input: Readonly<{ canvasId: string; kind: string; nodeId: string; ownerId: string }>,
) {
  return Boolean(database.prepare(`
    SELECT 1
    FROM generation_tasks AS task
    LEFT JOIN generation_provider_attempts AS attempt
      ON attempt.task_id = task.id
      AND attempt.execution_attempt = task.attempt
    WHERE task.owner_id = ? AND task.canvas_id = ? AND task.node_id = ?
      AND task.kind = ? AND task.state = 'failed'
      AND (
        task.error_code = 'OUTCOME_UNKNOWN_BILLING_RISK'
      OR attempt.outcome = 'outcome-unknown'
        OR EXISTS (
          SELECT 1 FROM generation_task_events AS conflict_event
          WHERE conflict_event.task_id = task.id
            AND conflict_event.error_code = ?
        )
      )
    LIMIT 1
  `).get(input.ownerId, input.canvasId, input.nodeId, input.kind, providerEvidenceConflictEventCode));
}
