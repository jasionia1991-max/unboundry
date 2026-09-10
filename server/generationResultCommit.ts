import { withGenerationResultSave, assertGenerationSaveSettlementInTransaction,
  assertNoConcurrentGenerationSaveInTransaction, type GenerationSaveToken,
} from "./generationResultSaveOwnership";
import { assertGenerationPublicationAliasesInTransaction, assertGenerationAdoptionSettlementInTransaction } from "./generationResultAdoptionQueries";
import type { DatabaseSync } from "node:sqlite";
import { openAppDatabase } from "./database";
import {
  cleanupPublicationStaging,
  compensateMediaPublication,
  generatedMediaSaveMaintenanceCode,
  failMediaPublicationInTransaction,
  finalizeMediaPublicationInTransaction,
  markReservedGeneratedMediaPublicationForMaintenance,
  markReservedGeneratedMediaPublicationForMaintenanceInTransaction,
  pendingGeneratedMediaPublications,
  preparePendingGeneratedMediaPublication,
  reservationFromAttempt,
  requestOriginalMediaRedownload,
  runMediaPublicationFinalizeFaultForTests,
  type MediaPublicationReservation,
} from "./mediaLifecycle";
import {
  deleteMediaHistoryCommand,
  upsertMediaHistoryCommand,
} from "./canvasTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import { projectSingleNodeGenerationResultInTransaction } from
  "./generationCanvasProjectionService";
import {
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
} from "./canvasObservability";
import { readPublishedOriginalMediaCandidateIdsCommand } from "./mediaTransactionCommands";

const identifierPattern = /^[a-z0-9._-]+$/i;

type TaskRow = {
  attempt: number;
  credential_revision?: number | null;
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

const originalPublicationRecoveryErrors = new Set([
  "OPERATOR_INCIDENT",
  "OUTCOME_UNKNOWN_BILLING_RISK",
]);

const originalPublicationRecoveryAttemptOutcomes = new Set([
  "accepted",
  "response-received",
  "completed",
  "outcome-unknown",
]);

type PendingProviderAttemptRow = {
  credential_revision: number;
  evidence: "historical-execution-attempt" | "provider-boundary";
  execution_attempt: number;
  failure_code: string | null;
  kind: string;
  outcome: string;
  owner_id: string | null;
  provider_model_id: string | null;
  provider_profile_id: string | null;
  provider_task_id: string | null;
};

/** Generation-owned cancellation fence, evaluated inside Media's transaction. */
function assertExactCancelledGenerationTaskInTransaction(
  database: DatabaseSync,
  reservation: MediaPublicationReservation,
) {
  if (!reservation.taskId || reservation.taskExecutionAttempt === undefined) return false;
  const task = database.prepare(`
    SELECT owner_id, kind, attempt, state, error_code
    FROM generation_tasks WHERE id = ?
  `).get(reservation.taskId) as {
    owner_id?: string | null;
    kind?: string;
    attempt?: number;
    state?: string;
    error_code?: string | null;
  } | undefined;
  return Boolean(
    task && task.owner_id === reservation.ownerId &&
    task.kind === reservation.kind &&
    task.attempt === reservation.taskExecutionAttempt &&
    task.state === "cancelled" && task.error_code === "USER_CANCELLED"
  );
}

function isOriginalPublicationRecoveryError(errorCode: string | null | undefined) {
  return errorCode !== undefined && errorCode !== null &&
    originalPublicationRecoveryErrors.has(errorCode);
}

function isExactOriginalPublicationAttempt(
  task: TaskRow | undefined,
  attempt: PendingProviderAttemptRow | undefined,
) {
  return Boolean(
    task && attempt &&
    attempt.execution_attempt === task.attempt &&
    task.credential_revision !== undefined &&
    task.credential_revision !== null &&
    attempt.credential_revision === task.credential_revision &&
    attempt.evidence === "provider-boundary" &&
    attempt.owner_id === task.owner_id &&
    attempt.kind === task.kind &&
    attempt.provider_model_id === task.provider_model_id &&
    attempt.provider_profile_id === task.provider_profile_id &&
    attempt.provider_task_id === task.provider_task_id &&
    originalPublicationRecoveryAttemptOutcomes.has(attempt.outcome) &&
    attempt.failure_code !== "PROVIDER_FAILED_CHARGE_SETTLED",
  );
}

function isOriginalPublicationRecoveryTask(task: TaskRow | undefined) {
  return Boolean(
    task?.state === "failed" &&
    task.result_asset_id === null &&
    isOriginalPublicationRecoveryError(task.error_code),
  );
}

/** Retain the existing exact original-result exception at the save admission boundary. */
export function permitsOriginalGenerationSaveInTransaction(database: DatabaseSync, input: {
  taskId: string; ownerId: string; executionAttempt: number; kind: "image" | "video" | "audio";
}) {
  const task = database.prepare("SELECT * FROM generation_tasks WHERE id = ?")
    .get(input.taskId) as TaskRow | undefined;
  if (!task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
      task.attempt !== input.executionAttempt || !isOriginalPublicationRecoveryTask(task)) return false;
  const attempt = matchingProviderAttempt(database, {
    taskId: input.taskId, executionAttempt: input.executionAttempt, providerTaskId: task.provider_task_id,
  });
  return isExactOriginalPublicationAttempt(task, attempt);
}

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

function relayResultCount(task: TaskRow) {
  if (!task.model_configuration) return undefined;
  try {
    const configuration = JSON.parse(task.model_configuration) as {
      modelResultCount?: unknown;
    };
    const value = configuration.modelResultCount;
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 4
      ? Number(value)
      : undefined;
  } catch {
    return undefined;
  }
}

function publishedGenerationMediaCandidateIds(input: Readonly<{
  taskId: string; ownerId: string; kind: "audio" | "image" | "video"; executionAttempt: number;
}>) {
  const database = openAppDatabase();
  try {
    database.exec("BEGIN");
    const ids = executeTransactionScopedCommand(database, readPublishedOriginalMediaCandidateIdsCommand, input);
    database.exec("COMMIT");
    return ids;
  } finally { database.close(); }
}

function transaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    flushDeferredCanvasObservability(database);
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    discardDeferredCanvasObservability(database);
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
  saveToken?: GenerationSaveToken;
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
        SELECT task.id, task.owner_id, task.kind, task.state, task.attempt, task.error_code,
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
            kind: "audio" | "image" | "text" | "video";
            owner_id: string | null;
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
        current.outcome !== "response-received" ||
        current.kind === "text" ||
        !current.owner_id
      ) return undefined;

      const saveIdentity = {
        taskId: current.id,
        executionAttempt: input.executionAttempt,
        ownerId: current.owner_id,
        kind: current.kind,
      } as const;
      if (input.saveToken) {
        assertGenerationSaveSettlementInTransaction(database, input.saveToken);
      } else {
        assertNoConcurrentGenerationSaveInTransaction(database, saveIdentity);
      }
      const publicationRows = database.prepare(`
        SELECT *
        FROM media_publication_attempts
        WHERE source = 'generation'
          AND task_id = ?
          AND task_execution_attempt = ?
          AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
      `).all(input.taskId, input.executionAttempt) as Array<Parameters<typeof reservationFromAttempt>[0]>;
      let unprotectedReserved = false;
      for (const row of publicationRows.filter((candidate) => candidate.state === "reserved")) {
        const protectedRow = markReservedGeneratedMediaPublicationForMaintenanceInTransaction(
          database,
          { ...reservationFromAttempt(row), saveToken: input.saveToken },
          generatedMediaSaveMaintenanceCode,
        );
        if (!protectedRow) unprotectedReserved = true;
      }
      const publicationPending = publicationRows.some((row) => row.state !== "reserved") ||
        unprotectedReserved;
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
    SELECT execution_attempt, evidence, credential_revision, kind, outcome,
           failure_code, owner_id, provider_model_id, provider_profile_id,
           provider_task_id
    FROM generation_provider_attempts
    WHERE task_id = ?
      AND execution_attempt = ?
      AND provider_task_id IS ?
    LIMIT 1
  `).get(
    input.taskId,
    input.executionAttempt,
    input.providerTaskId,
  ) as {
    credential_revision: number;
    evidence: "historical-execution-attempt" | "provider-boundary";
    execution_attempt: number;
    failure_code: string | null;
    kind: string;
    outcome: string;
    owner_id: string | null;
    provider_model_id: string | null;
    provider_profile_id: string | null;
    provider_task_id: string | null;
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
               provider_model_id, provider_profile_id, provider_task_id,
               credential_revision, model_configuration
        FROM generation_tasks WHERE id = ?
      `).get(taskId) as TaskRow | undefined;
      // A failed OPERATOR/unknown task may only become success here when the
      // caller presents the exact already-created publication reservation.
      // This is result settlement, never a transition back to execution.
      const originalRecovery = isOriginalPublicationRecoveryTask(task);

      if (originalRecovery && task && isRelayMediaTask(task)) {
        throw new Error("Generation relay output set is required");
      }
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
        const projectionState = projectSingleNodeGenerationResultInTransaction(
          database,
          taskId,
        );
        return {
          assetId: publicationToken.id,
          projectionState,
          state: "success" as const,
          taskId,
        };
      }
      if (
        !task || task.owner_id !== publicationToken.ownerId ||
        task.kind !== publicationToken.kind ||
        !["running", "recovering"].includes(task.state) && !(
          task.state === "failed" &&
          (task.error_code === "RESULT_SAVE_FAILED_NO_RETRY" || originalRecovery)
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
        (originalRecovery || task.owner_id !== "__test__" || task.provider_task_id) &&
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
      if (providerAttempt?.failure_code === "PROVIDER_FAILED_CHARGE_SETTLED") {
        throw new Error("Generation Provider attempt cannot complete publication");
      }
      if (originalRecovery && !isExactOriginalPublicationAttempt(task, providerAttempt)) {
        throw new Error("Generation original Provider evidence is not exact");
      }
      const allowedProviderOutcomes = originalRecovery
        ? ["accepted", "response-received", "completed", "outcome-unknown"]
        : ["boundary-claimed", "accepted", "response-received", "completed"];
      if (
        providerAttempt &&
        !allowedProviderOutcomes.includes(providerAttempt.outcome)
      ) {
        throw new Error("Generation Provider attempt cannot complete publication");
      }
      const timestamp = new Date().toISOString();
      if (providerAttempt) {
        const completedAttempt = database.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = 'completed', failure_code = NULL, finished_at = ?
          WHERE task_id = ? AND execution_attempt = ?
            AND (
              outcome IN (
                'boundary-claimed', 'accepted', 'response-received', 'completed'
              )
              OR (outcome = 'outcome-unknown' AND ? = 1)
            )
            AND provider_task_id IS ?
            AND credential_revision = ?
        `).run(
          timestamp,
          taskId,
          providerAttempt.execution_attempt,
          originalRecovery ? 1 : 0,
          providerAttempt.provider_task_id,
          providerAttempt.credential_revision,
        );
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
            OR (
              state = 'failed' AND ? = 1
              AND error_code IN ('OPERATOR_INCIDENT', 'OUTCOME_UNKNOWN_BILLING_RISK')
            )
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
        originalRecovery ? 1 : 0,
      );
      if (completedTask.changes !== 1) {
        throw new Error("Generation task changed concurrently");
      }
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, 'success', NULL, NULL, ?)
      `).run(taskId, timestamp);
      const projectionState = projectSingleNodeGenerationResultInTransaction(
        database,
        taskId,
      );
      runMediaPublicationFinalizeFaultForTests();
      return {
        assetId: evidence.assetId,
        projectionState,
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
               provider_model_id, provider_profile_id, provider_task_id,
               error_code, credential_revision, model_configuration
        FROM generation_tasks WHERE id = ?
      `).get(taskId) as TaskRow | undefined;
      const originalRecovery = isOriginalPublicationRecoveryTask(task);
      const successfulReplay = task?.state === "success" && Boolean(database.prepare(`
        SELECT 1 FROM media_publication_attempts WHERE attempt_id = ? AND state = 'published'
          AND task_id = ? AND task_execution_attempt = ? AND owner_id = ?
          AND kind = ? AND asset_id = ? AND output_slot IS NOT NULL`)
        .get(publicationToken.attemptId, taskId, task.attempt, publicationToken.ownerId,
          publicationToken.kind, publicationToken.id));
      if (originalRecovery && task && !isRelayMediaTask(task)) {
        throw new Error("Generation candidate is unsupported for original task");
      }
      if (
        !task ||
        !["running", "recovering"].includes(task.state) && !originalRecovery && !successfulReplay ||
        task.owner_id !== publicationToken.ownerId ||
        task.kind !== publicationToken.kind || task.result_asset_id !== null && !successfulReplay
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
        (originalRecovery || task.owner_id !== "__test__" || task.provider_task_id) &&
        !providerAttempt
      ) {
        throw new Error("Generation candidate has no matching paid attempt");
      }
      if (
        providerAttempt &&
        (providerAttempt.owner_id !== task.owner_id ||
          providerAttempt.kind !== task.kind ||
          providerAttempt.provider_model_id !== task.provider_model_id ||
          providerAttempt.provider_profile_id !== task.provider_profile_id)
      ) {
        throw new Error("Generation candidate Provider ownership changed");
      }
      if (originalRecovery && !isExactOriginalPublicationAttempt(task, providerAttempt)) {
        throw new Error("Generation original Provider evidence is not exact");
      }
      if (providerAttempt?.failure_code === "PROVIDER_FAILED_CHARGE_SETTLED") {
        throw new Error("Generation candidate Provider attempt is charge-settled");
      }
      const allowedProviderOutcomes = originalRecovery
        ? [...originalPublicationRecoveryAttemptOutcomes]
        : [
            "boundary-claimed",
            "accepted",
            "response-received",
            "completed",
          ];
      if (providerAttempt && !allowedProviderOutcomes.includes(providerAttempt.outcome)) {
        throw new Error("Generation candidate Provider ownership changed");
      }
      if (successfulReplay) {
        assertGenerationPublicationAliasesInTransaction(database, {
          taskId, executionAttempt: task.attempt, ownerId: publicationToken.ownerId,
          kind: publicationToken.kind,
        });
        return { assetId: evidence.assetId, state: "published" as const, taskId };
      }
      executeTransactionScopedCommand(database, deleteMediaHistoryCommand, {
        assetId: evidence.assetId,
        kind: task.kind,
        ownerId: task.owner_id!,
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
  adoptionReceiptId?: string;
  saveToken?: GenerationSaveToken;
}>) {
  const database = openAppDatabase();
  try { return transaction(database, () => commitGenerationMediaOutputSetInTransaction(database, input)); }
  finally { database.close(); }
}

export function commitGenerationMediaOutputSetInTransaction(database: DatabaseSync, input: Readonly<{
  assetIds: readonly string[];
  executionAttempt: number;
  kind: "audio" | "image" | "video";
  ownerId: string;
  taskId: string;
  adoptionReceiptId?: string;
  saveToken?: GenerationSaveToken;
}>) {
  if (!database.isTransaction) throw new Error("Generation settlement requires a transaction");
  if (input.saveToken) assertGenerationSaveSettlementInTransaction(database, input.saveToken);
  else assertNoConcurrentGenerationSaveInTransaction(database, input);
  const adoption = input.adoptionReceiptId
    ? assertGenerationAdoptionSettlementInTransaction(database, { ...input, adoptionReceiptId: input.adoptionReceiptId })
    : undefined;
  assertGenerationPublicationAliasesInTransaction(database, input);
  if (
    input.assetIds.length < 1 || input.assetIds.length > 4 ||
    new Set(input.assetIds).size !== input.assetIds.length
  ) throw new Error("Invalid generation output set");


      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id,
               provider_model_id, provider_profile_id, provider_task_id,
               error_code, model_configuration, credential_revision
        FROM generation_tasks WHERE id = ?
      `).get(input.taskId) as TaskRow | undefined;
      const originalRecovery = isOriginalPublicationRecoveryTask(task);
      const originalRelayRecovery = Boolean(
        originalRecovery && task && isRelayMediaTask(task),
      );
      if (originalRecovery && !originalRelayRecovery) {
        throw new Error("Generation output set is unsupported for original task");
      }
      if (originalRelayRecovery && task && relayResultCount(task) !== input.assetIds.length) {
        throw new Error("Generation original output set is incomplete");
      }
      if (originalRelayRecovery && database.prepare(`SELECT 1 FROM media_publication_attempts
          WHERE task_id = ? AND (task_execution_attempt IS NOT ? OR owner_id IS NOT ?
            OR kind <> ? OR state NOT IN ('published', 'failed')
            OR error_code = 'OSS_IDENTITY_QUARANTINED') LIMIT 1`)
          .get(input.taskId, input.executionAttempt, input.ownerId, input.kind)) {
        throw new Error("Generation original publication evidence is not settled");
      }
      if (
        !task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
        task.attempt !== input.executionAttempt
      ) {
        throw new Error("Generation output set lost task ownership");
      }
      const publications = database.prepare(`
        SELECT publication.asset_id, publication.actual_cost_microunits,
               publication.provider_usage_tokens, publication.history_label,
               publication.output_slot, publication.output_set_count
        FROM media_publication_attempts AS publication
        JOIN media_assets AS media
          ON media.owner_id = publication.owner_id
          AND media.kind = publication.kind
          AND media.id = publication.asset_id
        WHERE publication.source = 'generation'
          AND publication.state = 'published'
          AND publication.output_slot IS NOT NULL
          AND publication.task_id = ?
          AND publication.task_execution_attempt = ?
          AND publication.owner_id = ? AND publication.kind = ?
          AND media.storage_status = 'ready'
        ORDER BY publication.output_slot
      `).all(
        input.taskId,
        input.executionAttempt,
        input.ownerId,
        input.kind,
      ) as Array<{
        output_slot: number;
        output_set_count: number;
        actual_cost_microunits: number;
        asset_id: string;
        history_label: string | null;
        provider_usage_tokens: number | null;
      }>;
      if (
        publications.length !== input.assetIds.length ||
        publications.some((row, index) => row.asset_id !== input.assetIds[index] ||
          row.output_slot !== index || row.output_set_count !== input.assetIds.length)
      ) {
        throw new Error("Generation output set evidence is incomplete");
      }
      const providerAttempt = matchingProviderAttempt(database, {
        executionAttempt: input.executionAttempt,
        providerTaskId: task.provider_task_id,
        taskId: input.taskId,
      });
      if (
        (originalRecovery || task.owner_id !== "__test__" || task.provider_task_id) &&
        !providerAttempt
      ) {
        throw new Error("Generation output set has no matching paid attempt");
      }
      if (
        providerAttempt &&
        (providerAttempt.owner_id !== task.owner_id ||
          providerAttempt.kind !== task.kind ||
          providerAttempt.provider_model_id !== task.provider_model_id ||
          providerAttempt.provider_profile_id !== task.provider_profile_id)
      ) {
        throw new Error("Generation output set Provider ownership changed");
      }
      if (originalRelayRecovery && !isExactOriginalPublicationAttempt(task, providerAttempt)) {
        throw new Error("Generation original Provider evidence is not exact");
      }
      if (providerAttempt?.failure_code === "PROVIDER_FAILED_CHARGE_SETTLED") {
        throw new Error("Generation output set Provider attempt is charge-settled");
      }
      const allowedProviderOutcomes = originalRelayRecovery
        ? [...originalPublicationRecoveryAttemptOutcomes]
        : [
            "boundary-claimed",
            "accepted",
            "response-received",
            "completed",
          ];
      if (providerAttempt && !allowedProviderOutcomes.includes(providerAttempt.outcome)) {
        throw new Error("Generation output set Provider ownership changed");
      }
      if (task.state === "success") {
        if (
          task.result_asset_id !== input.assetIds[0] ||
          providerAttempt && providerAttempt.outcome !== "completed"
        ) {
          throw new Error("Generation output set replay does not match task");
        }
        const projectionState = projectSingleNodeGenerationResultInTransaction(
          database,
          input.taskId,
        );
        return {
          assetId: input.assetIds[0],
          projectionState,
          state: "success" as const,
          taskId: input.taskId,
        };
      }
      if (
        !["running", "recovering"].includes(task.state) && !originalRelayRecovery && !adoption ||
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
            AND (
              outcome IN (
                'boundary-claimed', 'accepted', 'response-received', 'completed'
              )
              OR (outcome = 'outcome-unknown' AND ? = 1)
            )
            AND provider_task_id IS ?
            AND credential_revision = ?
        `).run(
          timestamp,
          input.taskId,
          providerAttempt.execution_attempt,
          originalRelayRecovery ? 1 : 0,
          providerAttempt.provider_task_id,
          providerAttempt.credential_revision,
        );
        if (completedAttempt.changes !== 1) {
          throw new Error("Generation Provider attempt changed concurrently");
        }
      }
      const primary = publications[0];
      const completedTask = database.prepare(`
        UPDATE generation_tasks
        SET state = 'success', result_asset_id = ?,
            actual_cost_microunits = CASE WHEN ? = 1 THEN actual_cost_microunits ELSE ? END,
            provider_usage_tokens = CASE WHEN ? = 1 THEN provider_usage_tokens ELSE ? END,
            error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = ? AND attempt = ?
          AND (
            state IN ('running', 'recovering')
            OR (
              state = 'failed' AND ? = 1
              AND error_code IN ('OPERATOR_INCIDENT', 'OUTCOME_UNKNOWN_BILLING_RISK')
            ) OR (state = 'failed' AND ? = 1 AND error_code = 'PROVIDER_RESULT_FORMAT'
            )
          )
          AND result_asset_id IS NULL
      `).run(
        primary.asset_id,
        adoption ? 1 : 0,
        primary.actual_cost_microunits,
        adoption ? 1 : 0,
        primary.provider_usage_tokens,
        timestamp,
        input.taskId,
        input.ownerId,
        input.kind,
        input.executionAttempt,
        originalRelayRecovery ? 1 : 0,
        adoption ? 1 : 0,
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
      const projectionState = projectSingleNodeGenerationResultInTransaction(
        database,
        input.taskId,
      );
      runMediaPublicationFinalizeFaultForTests();
      return {
        assetId: primary.asset_id,
        projectionState,
        state: "success" as const,
        taskId: input.taskId,
      };
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
      const projectionState = projectSingleNodeGenerationResultInTransaction(
        database,
        input.taskId,
      );
      return {
        projectionState,
        state: "success" as const,
        taskId: input.taskId,
      };
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

/** Finish an already-published original set after a crash before task settlement.
 * This is local publication work; it never reads or submits to a Provider.
 */
export function recoverPublishedOriginalGenerationResult(taskId: string) {
  const database = openAppDatabase();
  let task: TaskRow | undefined;
  try {
    task = database.prepare(`SELECT owner_id, kind, state, attempt, result_asset_id,
      error_code, provider_model_id, provider_profile_id, provider_task_id,
      model_configuration, credential_revision FROM generation_tasks WHERE id = ?`)
      .get(taskId) as TaskRow | undefined;
    if (!isOriginalPublicationRecoveryTask(task) || !task || !isRelayMediaTask(task)) return false;
    const attempt = matchingProviderAttempt(database, {
      taskId, executionAttempt: task.attempt, providerTaskId: task.provider_task_id,
    });
    if (!isExactOriginalPublicationAttempt(task, attempt)) return false;
  } finally { database.close(); }
  const expected = relayResultCount(task);
  if (expected === undefined || !task.owner_id || task.kind === "text") return false;
  const assetIds = publishedGenerationMediaCandidateIds({
    taskId, ownerId: task.owner_id, kind: task.kind, executionAttempt: task.attempt,
  });
  if (assetIds.length !== expected) return false;
  // The command rechecks the complete set and current task/attempt in its
  // own transaction; edits, cancellation and inconsistent evidence win.
  commitGenerationMediaOutputSet({
    taskId, ownerId: task.owner_id, kind: task.kind, executionAttempt: task.attempt, assetIds,
  });
  return true;
}

export async function recoverPendingGenerationMediaResults(options?: {
  prepare?: typeof preparePendingGeneratedMediaPublication;
}) {
  const outcomes: Array<{
    action: "blocked" | "failed" | "finalized";
    assetId: string;
    taskId: string;
  }> = [];
  const pending = pendingGeneratedMediaPublications();
  const recoverRow = async (row: typeof pending[number]) => {
    let entered = false;
    await withGenerationResultSave({ taskId: row.task_id!, ownerId: row.owner_id,
      executionAttempt: row.task_execution_attempt!, kind: row.kind }, async (saveToken) => {
      entered = true;

    const taskId = row.task_id!;
    const database = openAppDatabase();
    let task: TaskRow | undefined;
    let providerAttempt: PendingProviderAttemptRow | undefined;
    try {
      task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id, error_code,
               provider_model_id, provider_profile_id, provider_task_id,
               model_configuration, credential_revision
        FROM generation_tasks WHERE id = ?
      `).get(taskId) as TaskRow | undefined;
      if (task) {
        providerAttempt = database.prepare(`
          SELECT execution_attempt, evidence, credential_revision,
                 failure_code, kind, outcome, owner_id, provider_model_id,
                 provider_profile_id, provider_task_id
          FROM generation_provider_attempts
          WHERE task_id = ? AND execution_attempt = ?
        `).get(taskId, task.attempt) as PendingProviderAttemptRow | undefined;
      }
    } finally {
      database.close();
    }
    const token: MediaPublicationReservation = {
      attemptId: row.attempt_id,
      saveToken,
      outputSlot: row.output_slot ?? undefined, outputSetCount: row.output_set_count ?? undefined,
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
    const cancelledRecovery = Boolean(
      task?.state === "cancelled" && task.error_code === "USER_CANCELLED" &&
      task.owner_id === row.owner_id && task.kind === row.kind &&
      task.attempt === row.task_execution_attempt,
    );
    if (cancelledRecovery) {
      // Quarantine is an evidence-preserving terminal branch. It must not be
      // retried as a normal delete or rebound to a replacement publication.
      if (row.error_code === "OSS_IDENTITY_QUARANTINED") {
        outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
        return;
      }
      const compensated = await compensateMediaPublication(token, {
        code: "USER_CANCELLED",
        assertCancelledTask: assertExactCancelledGenerationTaskInTransaction,
        requireCancelledTask: true,
      });
      outcomes.push({
        action: compensated ? "failed" : "blocked",
        assetId: row.asset_id,
        taskId,
      });
      return;
    }
    const narrowTerminalRecovery = Boolean(
      task?.state === "failed" &&
      task.error_code === "RESULT_SAVE_FAILED_NO_RETRY" &&
      task.result_asset_id === null,
    );
    const originalPublicationRecovery =
      isOriginalPublicationRecoveryTask(task) &&
      isExactOriginalPublicationAttempt(task, providerAttempt);
    const primaryRecovery = Boolean(
      task && (
        ["running", "recovering"].includes(task.state) ||
        narrowTerminalRecovery ||
        originalPublicationRecovery
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
      return;
    }
    const originalRelayRecovery = Boolean(
      originalPublicationRecovery && primaryRecovery && isRelayMediaTask(task),
    );
    if (originalRelayRecovery) {
      const expected = relayResultCount(task);
      const published = publishedGenerationMediaCandidateIds({
        executionAttempt: task.attempt,
        kind: task.kind as "audio" | "image" | "video",
        ownerId: task.owner_id!,
        taskId,
      });
      // Publish each exact stored candidate, including the first of a larger
      // set. Missing outputs still require the bounded original-request path.
      if (expected === undefined || published.length >= expected) {
        outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
        return;
      }
    }
    if (row.state === "compensating") {
      await compensateMediaPublication(token, { code: row.error_code ?? undefined });
      outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
      return;
    }
    if (row.state === "reserved") {
      const providerTaskId = task?.provider_task_id ?? providerAttempt?.provider_task_id;
      if (!providerTaskId && providerAttempt?.provider_task_id === null &&
          providerAttempt.outcome === "response-received" &&
          row.task_execution_attempt !== null) {
        // No Provider identity means no safe second lookup or POST. Reuse the
        // synchronous settlement fence so this row becomes explicit
        // maintenance evidence instead of remaining an invisible blocker.
        const settled = settleSynchronousResultSaveExhaustion({
          taskId,
          executionAttempt: row.task_execution_attempt,
          saveToken,
        });
        outcomes.push({
          action: settled?.state === "failed" ? "failed" : "blocked",
          assetId: row.asset_id,
          taskId,
        });
        return;
      }
      if (!providerTaskId && narrowTerminalRecovery) {
        const protectedRow = markReservedGeneratedMediaPublicationForMaintenance(
          { ...reservationFromAttempt(row), saveToken },
          generatedMediaSaveMaintenanceCode,
        );
        outcomes.push({
          action: protectedRow ? "failed" : "blocked",
          assetId: row.asset_id,
          taskId,
        });
        return;
      }
      // A Provider identity is handled by Generation's original-task recovery
      // path. Keep this publication row intact until that path returns bytes.
      outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
      return;
    }
    const prepared = await (
      options?.prepare ?? preparePendingGeneratedMediaPublication
    )(row, { saveToken });
    if (prepared.action === "blocked") {
      outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
      return;
    }
    if (prepared.action === "failed") {
      if (task?.provider_task_id && providerAttempt &&
          ["accepted", "response-received", "completed"].includes(providerAttempt.outcome)) {
        if (row.state === "staged" && row.output_slot !== null) {
          requestOriginalMediaRedownload(prepared.reservation);
          const recoveryDatabase = openAppDatabase();
          try {
            transaction(recoveryDatabase, () => {
              assertGenerationSaveSettlementInTransaction(recoveryDatabase, saveToken);
              const changed = recoveryDatabase.prepare(`UPDATE generation_tasks
                SET state = 'recovering', error_code = 'AUTOMATIC_RESULT_RECOVERY',
                  error_message = '正在找回并保存原结果，不会重复提交', updated_at = ?
                WHERE id = ? AND owner_id = ? AND attempt = ? AND state = 'running'`)
                .run(new Date().toISOString(), taskId, row.owner_id, row.task_execution_attempt);
              if (changed.changes === 1) recoveryDatabase.prepare(`INSERT INTO generation_task_events
                (task_id, state, error_code, error_message, created_at)
                VALUES (?, 'recovering', 'AUTOMATIC_RESULT_RECOVERY',
                  '正在找回并保存原结果，不会重复提交', ?)`)
                .run(taskId, new Date().toISOString());
            });
          } finally { recoveryDatabase.close(); }
        }
        outcomes.push({ action: "blocked", assetId: row.asset_id, taskId });
        return;
      }
      if (alternateRecovery) {
        failGenerationAlternateMediaResult(token, "MEDIA_RECOVERY_EVIDENCE_MISSING");
      } else {
        failGenerationMediaResult(token, "MEDIA_RECOVERY_EVIDENCE_MISSING");
      }
      await compensateMediaPublication(token, {
        code: "MEDIA_RECOVERY_EVIDENCE_MISSING",
      });
      outcomes.push({ action: "failed", assetId: row.asset_id, taskId });
      return;
    }
    if (primaryRecovery && task && isRelayMediaTask(task)) {
      if (originalRelayRecovery) {
        publishGenerationMediaCandidate(prepared.reservation);
        const expected = relayResultCount(task);
        const published = publishedGenerationMediaCandidateIds({
          executionAttempt: task.attempt,
          kind: task.kind as "audio" | "image" | "video",
          ownerId: task.owner_id!,
          taskId,
        });
        if (expected === undefined || published.length > expected) {
          throw new Error("Generation relay output set evidence is incomplete");
        }
        if (published.length === expected) commitGenerationMediaOutputSet({
          assetIds: published, saveToken,
          executionAttempt: task.attempt,
          kind: task.kind as "audio" | "image" | "video",
          ownerId: task.owner_id!,
          taskId,
        });
      } else {
        publishGenerationMediaCandidate(prepared.reservation);
        const expected = relayResultCount(task) ?? row.output_set_count;
        const published = publishedGenerationMediaCandidateIds({
          executionAttempt: task.attempt, kind: row.kind, ownerId: row.owner_id, taskId,
        });
        if (expected && published.length === expected) commitGenerationMediaOutputSet({
          assetIds: published, saveToken, executionAttempt: task.attempt, kind: row.kind,
          ownerId: row.owner_id, taskId,
        });
      }
    } else if (alternateRecovery) {
      commitGenerationAlternateMediaResult(prepared.reservation);
    } else {
      commitGenerationMediaResult(prepared.reservation);
    }
    await cleanupPublicationStaging(prepared.reservation).catch(() => undefined);
    outcomes.push({ action: "finalized", assetId: row.asset_id, taskId });
    }, { nonBlocking: true, phase: "recovery" });
    if (!entered) outcomes.push({ action: "blocked", assetId: row.asset_id, taskId: row.task_id! });
  };
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(10, pending.length) }, async () => {
    while (cursor < pending.length) {
      const row = pending[cursor++];
      try { await recoverRow(row); }
      catch {
        // A changed owner, temporary storage error or invalid ledger blocks
        // this task only. Independent tasks keep their recovery opportunity.
        outcomes.push({ action: "blocked", assetId: row.asset_id, taskId: row.task_id! });
      }
    }
  }));
  const order = new Map(pending.map((row, index) => [row.asset_id, index]));
  return outcomes.sort((left, right) => order.get(left.assetId)! - order.get(right.assetId)!);
}

export type GenerationResultCommit = Readonly<{
  commitMedia: typeof commitGenerationMediaResult;
  commitText: typeof commitGenerationTextResult;
}>;

export const generationResultCommit: GenerationResultCommit = Object.freeze({
  commitMedia: commitGenerationMediaResult,
  commitText: commitGenerationTextResult,
});
