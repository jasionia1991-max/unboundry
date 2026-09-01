import type { DatabaseSync } from "node:sqlite";

export interface GenerationReadinessQuery {
  hasCommittedActiveTasks(database: DatabaseSync): boolean;
  operationalQuietSnapshot(database: DatabaseSync): Readonly<{
    activeTasks: number;
    currentUnknownBillingTasks: number;
    unsettledCurrentProviderBoundaries: number;
  }>;
}

export const generationReadinessQuery: GenerationReadinessQuery = Object.freeze({
  hasCommittedActiveTasks(database: DatabaseSync) {
    return Boolean(database.prepare(`
      SELECT 1
      FROM generation_tasks
      WHERE state IN ('queued', 'running', 'recovering', 'retrying')
      LIMIT 1
    `).get());
  },
  /**
   * Exact-capture quiet gate. This is deliberately narrower than the paid
   * retry fence: terminal historical evidence remains backup-able, while only
   * the task's current associated attempt can make the live source unsettled.
   */
  operationalQuietSnapshot(database: DatabaseSync) {
    const row = database.prepare(`
      WITH current_attempts AS (
        SELECT
          task.id AS task_id,
          COALESCE(
            CASE WHEN task.provider_task_id IS NOT NULL THEN (
              SELECT paid.id
              FROM generation_provider_attempts AS paid
              WHERE paid.task_id = task.id
                AND paid.provider_task_id = task.provider_task_id
              ORDER BY paid.execution_attempt DESC, paid.id DESC
              LIMIT 1
            ) END,
            (
              SELECT current_attempt.id
              FROM generation_provider_attempts AS current_attempt
              WHERE current_attempt.task_id = task.id
                AND current_attempt.execution_attempt = task.attempt
              ORDER BY current_attempt.id DESC
              LIMIT 1
            )
          ) AS attempt_id
        FROM generation_tasks AS task
      )
      SELECT
        (
          SELECT COUNT(*)
          FROM generation_tasks
          WHERE state IN ('queued', 'running', 'retrying', 'recovering')
        ) AS active_tasks,
        (
          SELECT COUNT(*)
          FROM generation_tasks
          WHERE error_code = 'OUTCOME_UNKNOWN_BILLING_RISK'
        ) AS current_unknown_billing_tasks,
        (
          SELECT COUNT(*)
          FROM current_attempts AS current
          JOIN generation_provider_attempts AS attempt
            ON attempt.id = current.attempt_id
          WHERE attempt.evidence = 'provider-boundary'
            AND attempt.outcome IN ('boundary-claimed', 'outcome-unknown')
            AND attempt.finished_at IS NULL
        ) AS unsettled_current_provider_boundaries
    `).get() as {
      active_tasks: number | bigint;
      current_unknown_billing_tasks: number | bigint;
      unsettled_current_provider_boundaries: number | bigint;
    };
    return Object.freeze({
      activeTasks: Number(row.active_tasks),
      currentUnknownBillingTasks: Number(row.current_unknown_billing_tasks),
      unsettledCurrentProviderBoundaries: Number(
        row.unsettled_current_provider_boundaries,
      ),
    });
  },
});
