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

const identifierPattern = /^[a-z0-9._-]+$/i;

type TaskRow = {
  attempt: number;
  kind: "audio" | "image" | "text" | "video";
  owner_id: string | null;
  provider_model_id: string | null;
  provider_profile_id: string | null;
  provider_task_id: string | null;
  result_asset_id: string | null;
  state: string;
};

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
      AND ${input.providerTaskId
        ? "provider_task_id = ?"
        : "execution_attempt = ?"}
    ORDER BY execution_attempt DESC
    LIMIT 1
  `).get(
    input.taskId,
    input.providerTaskId ?? input.executionAttempt,
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
        SELECT owner_id, kind, state, attempt, result_asset_id,
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
        !["running", "recovering"].includes(task.state) ||
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
          AND attempt = ? AND state IN ('running', 'recovering')
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

export async function recoverPendingGenerationMediaResults() {
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
        SELECT owner_id, kind, state, attempt, result_asset_id,
               provider_model_id, provider_task_id
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
      taskId,
    };
    if (
      !task || !["running", "recovering"].includes(task.state) ||
      task.owner_id !== row.owner_id || task.kind !== row.kind ||
      task.attempt !== row.task_execution_attempt
    ) {
      failGenerationMediaResult(token, "MEDIA_RECOVERY_TASK_TERMINAL");
      await compensateMediaPublication(token, {
        code: "MEDIA_RECOVERY_TASK_TERMINAL",
      });
      outcomes.push({ action: "failed", assetId: row.asset_id, taskId });
      continue;
    }
    const prepared = await preparePendingGeneratedMediaPublication(row);
    if (prepared.action === "blocked") {
      outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
      continue;
    }
    if (prepared.action === "failed") {
      failGenerationMediaResult(token, "MEDIA_RECOVERY_EVIDENCE_MISSING");
      await compensateMediaPublication(token, {
        code: "MEDIA_RECOVERY_EVIDENCE_MISSING",
      });
      outcomes.push({ action: "failed", assetId: row.asset_id, taskId });
      continue;
    }
    commitGenerationMediaResult(prepared.reservation);
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
