import type { DatabaseSync } from "node:sqlite";

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
}
