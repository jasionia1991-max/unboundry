import type { DatabaseSync } from "node:sqlite";
import { openAppDatabase } from "./database";
import {
  cleanupPublicationStaging,
  compensateMediaPublication,
  failMediaPublicationInTransaction,
  finalizeMediaPublicationInTransaction,
  pendingGeneratedMediaPublications,
  preparePendingGeneratedMediaPublication,
  runMediaPublicationFinalizeFaultForTests,
  type MediaPublicationReservation,
} from "./mediaLifecycle";
import {
  deleteMediaHistoryCommand,
  upsertMediaHistoryCommand,
} from "./canvasTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";

const identifierPattern = /^[a-z0-9._-]+$/i;

type TaskRow = {
  attempt: number;
  error_code?: string | null;
  kind: "audio" | "image" | "text" | "video";
  model_configuration?: string;
  owner_id: string | null;
  provider_model_id: string | null;
  provider_profile_id: string | null;
  provider_task_id: string | null;
  result_asset_id: string | null;
  state: string;
};

function isRelayMediaTask(task: TaskRow) {
  if (task.kind === "text" || !task.model_configuration) return false;
  try {
    const configuration = JSON.parse(task.model_configuration) as {
      providerProtocol?: unknown;
    };
    return configuration.providerProtocol === "media-generate";
  } catch {
    return false;
  }
}

function transaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * A synchronous Provider response cannot be fetched again after its bytes
 * disappear from process memory. Atomically close that exact paid attempt
 * without creating a retryable Provider outcome. If publication already owns
 * the bytes, hand the task to publication recovery instead.
 */
export function settleSynchronousResultSaveExhaustion(input: Readonly<{
  dataDirectory?: string;
  executionAttempt: number;
  taskId: string;
}>) {
  if (
    !identifierPattern.test(input.taskId) ||
    input.taskId.length > 120 ||
    !Number.isSafeInteger(input.executionAttempt) ||
    input.executionAttempt < 1
  ) {
    throw new Error("Invalid synchronous result-save settlement");
  }
  const database = openAppDatabase(input.dataDirectory);
  try {
    return transaction(database, () => {
      const current = database.prepare(`
        SELECT task.id, task.state, task.attempt, task.error_code,
               task.provider_task_id AS task_provider_task_id,
               attempt.outcome,
               attempt.provider_task_id AS attempt_provider_task_id
        FROM generation_tasks AS task
        JOIN generation_provider_attempts AS attempt
          ON attempt.task_id = task.id
          AND attempt.execution_attempt = task.attempt
          AND attempt.owner_id IS task.owner_id
          AND attempt.kind = task.kind
          AND attempt.provider_profile_id IS task.provider_profile_id
          AND attempt.provider_model_id IS task.provider_model_id
        WHERE task.id = ?
      `).get(input.taskId) as
        | {
            attempt: number;
            attempt_provider_task_id: string | null;
            error_code: string | null;
            id: string;
            outcome: string;
            state: string;
            task_provider_task_id: string | null;
          }
        | undefined;
      if (
        !current ||
        !["running", "recovering"].includes(current.state) ||
        current.attempt !== input.executionAttempt ||
        current.task_provider_task_id !== null ||
        current.attempt_provider_task_id !== null ||
        current.outcome !== "response-received"
      ) return undefined;

      const publicationPending = Boolean(database.prepare(`
        SELECT 1
        FROM media_publication_attempts
        WHERE source = 'generation'
          AND task_id = ?
          AND task_execution_attempt = ?
          AND state IN (
            'reserved', 'staged', 'external-ready', 'compensating'
          )
        LIMIT 1
      `).get(input.taskId, input.executionAttempt));
      if (
        publicationPending &&
        current.state === "recovering" &&
        current.error_code === "AUTOMATIC_RESULT_RECOVERY"
      ) return undefined;
      const nextState = publicationPending ? "recovering" : "failed";
      const timestamp = new Date().toISOString();
      const error = publicationPending
        ? {
            code: "AUTOMATIC_RESULT_RECOVERY",
            message: "平台结果已进入安全保存队列；系统会继续原结果且不会重复提交",
          }
        : {
            code: "RESULT_SAVE_FAILED_NO_RETRY",
            message: "平台已返回结果，但系统未能安全保存；本轮已停止且不会重复提交",
          };
      const updatedTask = database.prepare(`
        UPDATE generation_tasks
        SET state = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ? AND state = ? AND attempt = ?
          AND provider_task_id IS NULL
      `).run(
        nextState,
        error.code,
        error.message,
        timestamp,
        current.id,
        current.state,
        input.executionAttempt,
      );
      if (updatedTask.changes !== 1) {
        throw new Error("Generation task changed concurrently");
      }
      if (!publicationPending) {
        const updatedAttempt = database.prepare(`
          UPDATE generation_provider_attempts
          SET failure_code = 'RESULT_SAVE_FAILED_NO_RETRY'
          WHERE task_id = ? AND execution_attempt = ?
            AND provider_task_id IS NULL
            AND outcome = 'response-received'
        `).run(input.taskId, input.executionAttempt);
        if (updatedAttempt.changes !== 1) {
          throw new Error("Provider attempt changed concurrently");
        }
      }
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        current.id,
        nextState,
        error.code,
        error.message,
        timestamp,
      );
      return { state: nextState, taskId: current.id } as const;
    });
  } finally {
    database.close();
  }
}

function matchingProviderAttempt(
  database: DatabaseSync,
  input: Readonly<{
    executionAttempt: number;
    providerTaskId: string | null;
    taskId: string;
  }>,
) {
  return database.prepare(`
    SELECT execution_attempt, kind, outcome, owner_id, provider_model_id,
           provider_profile_id
    FROM generation_provider_attempts
    WHERE task_id = ?
      AND execution_attempt = ?
      ${input.providerTaskId ? "AND provider_task_id = ?" : ""}
    LIMIT 1
  `).get(
    input.taskId,
    input.executionAttempt,
    ...(input.providerTaskId ? [input.providerTaskId] : []),
  ) as {
    execution_attempt: number;
    kind: string;
    outcome: string;
    owner_id: string | null;
    provider_model_id: string | null;
    provider_profile_id: string | null;
  } | undefined;
}

export function commitGenerationMediaResult(
  publicationToken: MediaPublicationReservation,
) {
  const database = openAppDatabase();
  try {
    return transaction(database, () => {
      const taskId = publicationToken.taskId;
      if (!taskId) throw new Error("Generation publication task is missing");
      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id, error_code,
               provider_model_id, provider_profile_id, provider_task_id
        FROM generation_tasks WHERE id = ?
      `).get(taskId) as TaskRow | undefined;
      if (
        task?.state === "success" &&
        task.owner_id === publicationToken.ownerId &&
        task.kind === publicationToken.kind &&
        task.result_asset_id === publicationToken.id
      ) {
        const replay = finalizeMediaPublicationInTransaction(
          database,
          publicationToken,
        );
        if (!replay || replay.taskId !== taskId) {
          throw new Error("Generation publication replay does not match task");
        }
        return {
          assetId: publicationToken.id,
          state: "success" as const,
          taskId,
        };
      }
      if (
        !task || task.owner_id !== publicationToken.ownerId ||
        task.kind !== publicationToken.kind ||
        !["running", "recovering"].includes(task.state) && !(
          task.state === "failed" &&
          task.error_code === "RESULT_SAVE_FAILED_NO_RETRY"
        ) ||
        task.result_asset_id !== null
      ) {
        throw new Error("Generation task lost publication ownership");
      }
      const evidence = finalizeMediaPublicationInTransaction(
        database,
        publicationToken,
      );
      if (
        !evidence || evidence.taskId !== taskId ||
        evidence.ownerId !== publicationToken.ownerId ||
        evidence.kind !== publicationToken.kind ||
        evidence.assetId !== publicationToken.id ||
        evidence.executionAttempt !== task.attempt
      ) {
        throw new Error("Generation publication evidence does not match task");
      }
      const providerAttempt = matchingProviderAttempt(database, {
        executionAttempt: evidence.executionAttempt,
        providerTaskId: task.provider_task_id,
        taskId,
      });
      if (
        (task.owner_id !== "__test__" || task.provider_task_id) &&
        !providerAttempt
      ) {
        throw new Error("Generation task has no matching paid attempt");
      }
      if (
        providerAttempt &&
        (providerAttempt.owner_id !== task.owner_id ||
          providerAttempt.kind !== task.kind ||
          providerAttempt.provider_model_id !== task.provider_model_id ||
          providerAttempt.provider_profile_id !== task.provider_profile_id)
      ) {
        throw new Error("Generation Provider attempt ownership changed");
      }
      if (
        providerAttempt &&
        ![
          "boundary-claimed",
          "accepted",
          "response-received",
          "completed",
        ].includes(providerAttempt.outcome)
      ) {
        throw new Error("Generation Provider attempt cannot complete publication");
      }
      const timestamp = new Date().toISOString();
      if (providerAttempt) {
        const completedAttempt = database.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = 'completed', failure_code = NULL, finished_at = ?
          WHERE task_id = ? AND execution_attempt = ?
            AND outcome IN (
              'boundary-claimed', 'accepted', 'response-received', 'completed'
            )
        `).run(timestamp, taskId, providerAttempt.execution_attempt);
        if (completedAttempt.changes !== 1) {
          throw new Error("Generation Provider attempt changed concurrently");
        }
      }
      const completedTask = database.prepare(`
        UPDATE generation_tasks
        SET state = 'success', result_asset_id = ?,
            actual_cost_microunits = ?, provider_usage_tokens = ?,
            error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = ?
          AND attempt = ?
          AND (
            state IN ('running', 'recovering')
            OR (state = 'failed' AND error_code = 'RESULT_SAVE_FAILED_NO_RETRY')
          )
          AND result_asset_id IS NULL
      `).run(
        evidence.assetId,
        evidence.actualCostMicrounits,
        evidence.providerUsageTokens ?? null,
        timestamp,
        taskId,
        evidence.ownerId,
        evidence.kind,
        evidence.executionAttempt,
      );
      if (completedTask.changes !== 1) {
        throw new Error("Generation task changed concurrently");
      }
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, 'success', NULL, NULL, ?)
      `).run(taskId, timestamp);
      runMediaPublicationFinalizeFaultForTests();
      return {
        assetId: evidence.assetId,
        state: "success" as const,
        taskId,
      };
    });
  } finally {
    database.close();
  }
}

/**
 * Publish an additional result returned by the same paid Provider attempt.
 * The primary result has already completed the task; alternates must never
 * rewrite its cost, terminal state, or result_asset_id.
 */
export function commitGenerationAlternateMediaResult(
  publicationToken: MediaPublicationReservation,
) {
  const database = openAppDatabase();
  try {
    return transaction(database, () => {
      const taskId = publicationToken.taskId;
      if (!taskId) throw new Error("Generation publication task is missing");
      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id,
               provider_model_id, provider_profile_id, provider_task_id
        FROM generation_tasks WHERE id = ?
      `).get(taskId) as TaskRow | undefined;
      if (
        !task || task.state !== "success" ||
        task.owner_id !== publicationToken.ownerId ||
        task.kind !== publicationToken.kind ||
        !task.result_asset_id || task.result_asset_id === publicationToken.id
      ) {
        throw new Error("Generation alternate lost publication ownership");
      }
      const evidence = finalizeMediaPublicationInTransaction(
        database,
        publicationToken,
      );
      if (
        !evidence || evidence.taskId !== taskId ||
        evidence.ownerId !== publicationToken.ownerId ||
        evidence.kind !== publicationToken.kind ||
        evidence.assetId !== publicationToken.id ||
        evidence.executionAttempt !== task.attempt
      ) {
        throw new Error("Generation alternate evidence does not match task");
      }
      const providerAttempt = matchingProviderAttempt(database, {
        executionAttempt: evidence.executionAttempt,
        providerTaskId: task.provider_task_id,
        taskId,
      });
      if (
        (task.owner_id !== "__test__" || task.provider_task_id) &&
        !providerAttempt
      ) {
        throw new Error("Generation alternate has no matching paid attempt");
      }
      if (
        providerAttempt &&
        (providerAttempt.owner_id !== task.owner_id ||
          providerAttempt.kind !== task.kind ||
          providerAttempt.provider_model_id !== task.provider_model_id ||
          providerAttempt.provider_profile_id !== task.provider_profile_id ||
          providerAttempt.outcome !== "completed")
      ) {
        throw new Error("Generation alternate Provider ownership changed");
      }
      return {
        assetId: evidence.assetId,
        state: "success" as const,
        taskId,
      };
    });
  } finally {
    database.close();
  }
}

/**
 * Make one relay output durable without completing its task. Relay Providers
 * may return a set, so task success is committed only after every output has
 * reached this restart-safe published state.
 */
export function publishGenerationMediaCandidate(
  publicationToken: MediaPublicationReservation,
) {
  const database = openAppDatabase();
  try {
    return transaction(database, () => {
      const taskId = publicationToken.taskId;
      if (!taskId) throw new Error("Generation publication task is missing");
      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id,
               provider_model_id, provider_profile_id, provider_task_id
        FROM generation_tasks WHERE id = ?
      `).get(taskId) as TaskRow | undefined;
      if (
        !task || !["running", "recovering"].includes(task.state) ||
        task.owner_id !== publicationToken.ownerId ||
        task.kind !== publicationToken.kind || task.result_asset_id !== null
      ) {
        throw new Error("Generation candidate lost publication ownership");
      }
      const evidence = finalizeMediaPublicationInTransaction(
        database,
        publicationToken,
      );
      if (
        !evidence || evidence.taskId !== taskId ||
        evidence.ownerId !== task.owner_id || evidence.kind !== task.kind ||
        evidence.assetId !== publicationToken.id ||
        evidence.executionAttempt !== task.attempt
      ) {
        throw new Error("Generation candidate evidence does not match task");
      }
      const providerAttempt = matchingProviderAttempt(database, {
        executionAttempt: evidence.executionAttempt,
        providerTaskId: task.provider_task_id,
        taskId,
      });
      if (
        (task.owner_id !== "__test__" || task.provider_task_id) &&
        !providerAttempt
      ) {
        throw new Error("Generation candidate has no matching paid attempt");
      }
      if (
        providerAttempt &&
        (providerAttempt.owner_id !== task.owner_id ||
          providerAttempt.kind !== task.kind ||
          providerAttempt.provider_model_id !== task.provider_model_id ||
          providerAttempt.provider_profile_id !== task.provider_profile_id ||
          ![
            "boundary-claimed",
            "accepted",
            "response-received",
            "completed",
          ].includes(providerAttempt.outcome))
      ) {
        throw new Error("Generation candidate Provider ownership changed");
      }
      executeTransactionScopedCommand(database, deleteMediaHistoryCommand, {
        assetId: evidence.assetId,
        kind: task.kind,
        ownerId: task.owner_id,
      });
      return { assetId: evidence.assetId, state: "published" as const, taskId };
    });
  } finally {
    database.close();
  }
}

export function commitGenerationMediaOutputSet(input: Readonly<{
  assetIds: readonly string[];
  executionAttempt: number;
  kind: "audio" | "image" | "video";
  ownerId: string;
  taskId: string;
}>) {
  if (
    input.assetIds.length < 1 || input.assetIds.length > 4 ||
    new Set(input.assetIds).size !== input.assetIds.length
  ) throw new Error("Invalid generation output set");
  const database = openAppDatabase();
  try {
    return transaction(database, () => {
      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id,
               provider_model_id, provider_profile_id, provider_task_id
        FROM generation_tasks WHERE id = ?
      `).get(input.taskId) as TaskRow | undefined;
      if (
        !task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
        task.attempt !== input.executionAttempt
      ) {
        throw new Error("Generation output set lost task ownership");
      }
      const publications = database.prepare(`
        SELECT publication.asset_id, publication.actual_cost_microunits,
               publication.provider_usage_tokens, publication.history_label
        FROM media_publication_attempts AS publication
        JOIN media_assets AS media
          ON media.owner_id = publication.owner_id
          AND media.kind = publication.kind
          AND media.id = publication.asset_id
        WHERE publication.source = 'generation'
          AND publication.state = 'published'
          AND publication.task_id = ?
          AND publication.task_execution_attempt = ?
          AND publication.owner_id = ? AND publication.kind = ?
          AND media.storage_status = 'ready'
        ORDER BY publication.created_at, publication.attempt_id
      `).all(
        input.taskId,
        input.executionAttempt,
        input.ownerId,
        input.kind,
      ) as Array<{
        actual_cost_microunits: number;
        asset_id: string;
        history_label: string | null;
        provider_usage_tokens: number | null;
      }>;
      if (
        publications.length !== input.assetIds.length ||
        publications.some((row, index) => row.asset_id !== input.assetIds[index])
      ) {
        throw new Error("Generation output set evidence is incomplete");
      }
      const providerAttempt = matchingProviderAttempt(database, {
        executionAttempt: input.executionAttempt,
        providerTaskId: task.provider_task_id,
        taskId: input.taskId,
      });
      if (
        (task.owner_id !== "__test__" || task.provider_task_id) &&
        !providerAttempt
      ) {
        throw new Error("Generation output set has no matching paid attempt");
      }
      if (
        providerAttempt &&
        (providerAttempt.owner_id !== task.owner_id ||
          providerAttempt.kind !== task.kind ||
          providerAttempt.provider_model_id !== task.provider_model_id ||
          providerAttempt.provider_profile_id !== task.provider_profile_id ||
          ![
            "boundary-claimed",
            "accepted",
            "response-received",
            "completed",
          ].includes(providerAttempt.outcome))
      ) {
        throw new Error("Generation output set Provider ownership changed");
      }
      if (task.state === "success") {
        if (
          task.result_asset_id !== input.assetIds[0] ||
          providerAttempt && providerAttempt.outcome !== "completed"
        ) {
          throw new Error("Generation output set replay does not match task");
        }
        return {
          assetId: input.assetIds[0],
          state: "success" as const,
          taskId: input.taskId,
        };
      }
      if (
        !["running", "recovering"].includes(task.state) ||
        task.result_asset_id !== null
      ) {
        throw new Error("Generation output set lost task ownership");
      }
      const timestamp = new Date().toISOString();
      if (providerAttempt) {
        const completedAttempt = database.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = 'completed', failure_code = NULL, finished_at = ?
          WHERE task_id = ? AND execution_attempt = ?
            AND outcome IN (
              'boundary-claimed', 'accepted', 'response-received', 'completed'
            )
        `).run(timestamp, input.taskId, providerAttempt.execution_attempt);
        if (completedAttempt.changes !== 1) {
          throw new Error("Generation Provider attempt changed concurrently");
        }
      }
      const primary = publications[0];
      const completedTask = database.prepare(`
        UPDATE generation_tasks
        SET state = 'success', result_asset_id = ?,
            actual_cost_microunits = ?, provider_usage_tokens = ?,
            error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = ? AND attempt = ?
          AND state IN ('running', 'recovering') AND result_asset_id IS NULL
      `).run(
        primary.asset_id,
        primary.actual_cost_microunits,
        primary.provider_usage_tokens,
        timestamp,
        input.taskId,
        input.ownerId,
        input.kind,
        input.executionAttempt,
      );
      if (completedTask.changes !== 1) {
        throw new Error("Generation task changed concurrently");
      }
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, 'success', NULL, NULL, ?)
      `).run(input.taskId, timestamp);
      const preview = (assetId: string) => input.kind === "video"
        ? `/api/video-assets/${assetId}`
        : input.kind === "audio"
          ? `/api/audio-assets/${assetId}`
          : `/api/assets/${assetId}`;
      const defaultLabel = input.kind === "video"
        ? "生成视频"
        : input.kind === "audio"
          ? "生成音频"
          : "生成图片";
      for (const publication of publications) {
        executeTransactionScopedCommand(database, upsertMediaHistoryCommand, {
          assetId: publication.asset_id,
          createdAt: timestamp,
          kind: input.kind,
          label: publication.history_label || defaultLabel,
          ownerId: input.ownerId,
          preview: preview(publication.asset_id),
        });
      }
      runMediaPublicationFinalizeFaultForTests();
      return { assetId: primary.asset_id, state: "success" as const, taskId: input.taskId };
    });
  } finally {
    database.close();
  }
}

export function commitGenerationTextResult(input: Readonly<{
  actualCostMicrounits: number;
  dataDirectory?: string;
  executionAttempt: number;
  providerUsageTokens?: number;
  resultText: string;
  taskId: string;
}>) {
  const resultText = input.resultText.trim();
  if (
    !identifierPattern.test(input.taskId) || input.taskId.length > 120 ||
    !Number.isSafeInteger(input.executionAttempt) || input.executionAttempt < 1 ||
    !Number.isSafeInteger(input.actualCostMicrounits) ||
    input.actualCostMicrounits < 0 || resultText.length < 1 ||
    resultText.length > 200_000 || input.providerUsageTokens !== undefined &&
      (!Number.isSafeInteger(input.providerUsageTokens) ||
        input.providerUsageTokens < 0)
  ) throw new Error("Invalid generation text result");
  const database = openAppDatabase(input.dataDirectory);
  try {
    return transaction(database, () => {
      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id,
               provider_model_id, provider_profile_id, provider_task_id
        FROM generation_tasks WHERE id = ?
      `).get(input.taskId) as TaskRow | undefined;
      if (
        !task || task.kind !== "text" || task.state !== "running" ||
        task.attempt !== input.executionAttempt || task.result_asset_id !== null
      ) throw new Error("Generation text task changed concurrently");
      const providerAttempt = matchingProviderAttempt(database, {
        executionAttempt: input.executionAttempt,
        providerTaskId: task.provider_task_id,
        taskId: input.taskId,
      });
      if (task.owner_id !== "__test__" && !providerAttempt) {
        throw new Error("Generation task has no matching paid attempt");
      }
      if (
        providerAttempt &&
        (providerAttempt.owner_id !== task.owner_id ||
          providerAttempt.kind !== task.kind ||
          providerAttempt.provider_model_id !== task.provider_model_id ||
          providerAttempt.provider_profile_id !== task.provider_profile_id)
      ) {
        throw new Error("Generation Provider attempt ownership changed");
      }
      const timestamp = new Date().toISOString();
      if (providerAttempt) {
        const completedAttempt = database.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = 'completed', failure_code = NULL, finished_at = ?
          WHERE task_id = ? AND execution_attempt = ?
            AND outcome IN (
              'boundary-claimed', 'accepted', 'response-received', 'completed'
            )
        `).run(timestamp, input.taskId, providerAttempt.execution_attempt);
        if (completedAttempt.changes !== 1) {
          throw new Error("Generation Provider attempt cannot be completed");
        }
      }
      const completed = database.prepare(`
        UPDATE generation_tasks
        SET state = 'success', actual_cost_microunits = ?,
            provider_usage_tokens = ?, result_text = ?,
            error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND kind = 'text' AND state = 'running' AND attempt = ?
      `).run(
        input.actualCostMicrounits,
        input.providerUsageTokens ?? null,
        resultText,
        timestamp,
        input.taskId,
        input.executionAttempt,
      );
      if (completed.changes !== 1) {
        throw new Error("Generation task changed concurrently");
      }
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, 'success', NULL, NULL, ?)
      `).run(input.taskId, timestamp);
      return { state: "success" as const, taskId: input.taskId };
    });
  } finally {
    database.close();
  }
}

function failGenerationMediaResult(
  publicationToken: MediaPublicationReservation,
  code: string,
) {
  const taskId = publicationToken.taskId;
  if (!taskId) throw new Error("Generation publication task is missing");
  const database = openAppDatabase();
  try {
    transaction(database, () => {
      failMediaPublicationInTransaction(database, publicationToken, code);
      const timestamp = new Date().toISOString();
      const failed = database.prepare(`
        UPDATE generation_tasks
        SET state = 'failed', result_asset_id = NULL,
            error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = ?
          AND state IN ('running', 'recovering')
      `).run(
        code.slice(0, 80),
        "生成结果未能安全发布，系统未重新请求模型",
        timestamp,
        taskId,
        publicationToken.ownerId,
        publicationToken.kind,
      );
      if (failed.changes === 1) {
        database.prepare(`
          INSERT INTO generation_task_events (
            task_id, state, error_code, error_message, created_at
          ) VALUES (?, 'failed', ?, ?, ?)
        `).run(
          taskId,
          code.slice(0, 80),
          "生成结果未能安全发布，系统未重新请求模型",
          timestamp,
        );
      }
    });
  } finally {
    database.close();
  }
}

function failGenerationAlternateMediaResult(
  publicationToken: MediaPublicationReservation,
  code: string,
) {
  const database = openAppDatabase();
  try {
    transaction(database, () => {
      failMediaPublicationInTransaction(database, publicationToken, code);
    });
  } finally {
    database.close();
  }
}

export async function recoverPendingGenerationMediaResults(options?: {
  prepare?: typeof preparePendingGeneratedMediaPublication;
}) {
  const outcomes: Array<{
    action: "blocked" | "failed" | "finalized";
    assetId: string;
    taskId: string;
  }> = [];
  for (const row of pendingGeneratedMediaPublications()) {
    const taskId = row.task_id!;
    const database = openAppDatabase();
    let task: TaskRow | undefined;
    try {
      task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id, error_code,
               provider_model_id, provider_profile_id, provider_task_id,
               model_configuration
        FROM generation_tasks WHERE id = ?
      `).get(taskId) as TaskRow | undefined;
    } finally {
      database.close();
    }
    const token: MediaPublicationReservation = {
      attemptId: row.attempt_id,
      finalStorageName: row.final_storage_name,
      id: row.asset_id,
      kind: row.kind,
      objectKey: row.object_key,
      ownerId: row.owner_id,
      stagingName: row.staging_name,
      storageBackend: row.storage_backend,
      storageProfileId: row.storage_profile_id,
      taskExecutionAttempt: row.task_execution_attempt ?? undefined,
      taskId,
    };
    const narrowTerminalRecovery = Boolean(
      task?.state === "failed" &&
      task.error_code === "RESULT_SAVE_FAILED_NO_RETRY" &&
      task.result_asset_id === null,
    );
    const primaryRecovery = Boolean(
      task && (
        ["running", "recovering"].includes(task.state) ||
        narrowTerminalRecovery
      ) &&
      task.result_asset_id === null,
    );
    const alternateRecovery = Boolean(
      task?.state === "success" && task.result_asset_id &&
      task.result_asset_id !== row.asset_id,
    );
    if (
      !task || (!primaryRecovery && !alternateRecovery) ||
      task.owner_id !== row.owner_id || task.kind !== row.kind ||
      task.attempt !== row.task_execution_attempt
    ) {
      // Provider bytes are a stronger fact than an unrelated/stale task
      // terminal snapshot. Preserve them for exact recovery or operator
      // adjudication; never compensate an otherwise intact generated result.
      outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
      continue;
    }
    const prepared = await (
      options?.prepare ?? preparePendingGeneratedMediaPublication
    )(row);
    if (prepared.action === "blocked") {
      outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
      continue;
    }
    if (prepared.action === "failed") {
      if (alternateRecovery) {
        failGenerationAlternateMediaResult(token, "MEDIA_RECOVERY_EVIDENCE_MISSING");
      } else {
        failGenerationMediaResult(token, "MEDIA_RECOVERY_EVIDENCE_MISSING");
      }
      await compensateMediaPublication(token, {
        code: "MEDIA_RECOVERY_EVIDENCE_MISSING",
      });
      outcomes.push({ action: "failed", assetId: row.asset_id, taskId });
      continue;
    }
    if (primaryRecovery && task && isRelayMediaTask(task)) {
      publishGenerationMediaCandidate(prepared.reservation);
    } else if (alternateRecovery) {
      commitGenerationAlternateMediaResult(prepared.reservation);
    } else {
      commitGenerationMediaResult(prepared.reservation);
    }
    await cleanupPublicationStaging(prepared.reservation).catch(() => undefined);
    outcomes.push({ action: "finalized", assetId: row.asset_id, taskId });
  }
  return outcomes;
}

export type GenerationResultCommit = Readonly<{
  commitMedia: typeof commitGenerationMediaResult;
  commitText: typeof commitGenerationTextResult;
}>;

export const generationResultCommit: GenerationResultCommit = Object.freeze({
  commitMedia: commitGenerationMediaResult,
  commitText: commitGenerationTextResult,
});
