import type { DatabaseSync } from "node:sqlite";
import { assertWorkflowMediaDeletionAllowedInTransaction } from
  "./workflowRunLocks";

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
      )
    LIMIT 1
  `).get(input.ownerId, input.canvasId, input.nodeId, input.kind));
}
