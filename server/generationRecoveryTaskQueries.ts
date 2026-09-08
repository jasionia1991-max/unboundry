import { readGenerationRecoveryPublicationStateCommand } from "./mediaTransactionCommands";
import { assertModelReleaseRevisionIntegrity } from "./modelReleaseRevisionStore";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import {
  recoveryCaseEventKinds,
  recoveryCasePhases,
  recoveryCaseReasons,
  recoveryCaseVersion,
} from "../types/generationRecovery";
import type { DatabaseSync } from "node:sqlite";
import { executeTransactionScopedCommand } from "./transactionCommand";
import { accountAllowsDurableMediaReferenceCommand } from "./accountTransactionCommands";

const checkpointCode = "RECOVERY_AUTOMATIC_CHECK_V1";
/** A durable marker for platform evidence that contradicts a settled receipt. */
export const providerEvidenceConflictEventCode = "RECOVERY_PROVIDER_EVIDENCE_CONFLICT_V1" as const;
const maxRecoveryCaseEventsPerTask = 512;
const day = 24 * 60 * 60_000;
export type OriginalRecoveryWindow = Readonly<{
  attemptStartedAt: string;
  providerWindowMs: number;
  providerDeadlineAt: string;
  automaticDeadlineAt: string;
}>;
export type OriginalRecoveryCheck = Readonly<{
  version: 1;
  executionAttempt: number;
  count: number;
  lastCheckedAt: string;
  nextCheckAt: string;
  leaseUntil: string;
}>;
function safeObject(raw: string) {
  try { const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}
/** Stable bounded task pagination includes old failed incidents and existing cases. */
export function listRecoveryTaskIds(database: DatabaseSync, after = "", limit = 200) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("Invalid recovery page size");
  return (database.prepare(`SELECT task.id FROM generation_tasks AS task
    WHERE task.id > ? AND (
      task.state = 'recovering' OR (task.state = 'failed' AND task.error_code IN (
        'OUTCOME_UNKNOWN_BILLING_RISK', 'OPERATOR_INCIDENT', 'RESULT_SAVE_FAILED_NO_RETRY'))
      OR EXISTS (SELECT 1 FROM generation_task_events AS event
        WHERE event.task_id = task.id AND event.error_code IN (
          'RECOVERY_CASE_V1', ?)))
    ORDER BY task.id LIMIT ?`).all(after, providerEvidenceConflictEventCode, limit) as { id: string }[]).map((row) => row.id);
}

/** A settled task with contradictory Provider evidence remains maintenance work. */
export function hasProviderEvidenceConflictForTaskInTransaction(
  database: DatabaseSync,
  taskId: string,
) {
  if (database.prepare(`
    SELECT 1
    FROM generation_task_events
    WHERE task_id = ? AND error_code = ?
    LIMIT 1
  `).get(taskId, providerEvidenceConflictEventCode)) return true;

  // An ambiguous no-ID match is recorded as a case reason first. It cannot
  // carry the provider task ID required by the full conflict event, but it
  // must still be a durable read fence: a later sweep must not spend another
  // GET against the same unresolved paid attempt.
  const caseEvents = database.prepare(`
    SELECT error_message
    FROM generation_task_events
    WHERE task_id = ? AND error_code = 'RECOVERY_CASE_V1'
    ORDER BY id DESC
    LIMIT ?
  `).all(taskId, maxRecoveryCaseEventsPerTask + 1) as { error_message: string | null }[];
  // The case store rejects histories above this bound. Treat an over-limit
  // history as corrupt here too, so an older conflict cannot be hidden behind
  // newer case snapshots and accidentally authorize another GET.
  if (caseEvents.length > maxRecoveryCaseEventsPerTask) return true;
  return caseEvents.some((row) => {
    if (typeof row.error_message !== "string") return true;
    try {
      const payload = JSON.parse(row.error_message) as unknown;
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return true;
      const value = payload as Record<string, unknown>;
      if (value.version !== recoveryCaseVersion ||
          typeof value.reason !== "string" || !recoveryCaseReasons.includes(value.reason as never) ||
          typeof value.event !== "string" || !recoveryCaseEventKinds.includes(value.event as never) ||
          typeof value.phase !== "string" || !recoveryCasePhases.includes(value.phase as never) ||
          value.taskId !== taskId || typeof value.caseId !== "string" || value.caseId.length < 1 ||
          typeof value.ownerId !== "string" || value.ownerId.length < 1 ||
          !Number.isSafeInteger(value.executionAttempt) || Number(value.executionAttempt) < 1 ||
          !Number.isSafeInteger(value.caseRevision) || Number(value.caseRevision) < 1 ||
          !Number.isSafeInteger(value.checkCount) || Number(value.checkCount) < 0 ||
          !Number.isSafeInteger(value.inspectionUsed) || Number(value.inspectionUsed) < 0 ||
          !Number.isSafeInteger(value.progressVersion) || Number(value.progressVersion) < 0 ||
          !Number.isSafeInteger(value.readVersion) || Number(value.readVersion) < 0 ||
          !Number.isSafeInteger(value.lastReadProgressVersion) || Number(value.lastReadProgressVersion) < 0) {
        return true;
      }
      return value.reason === "provider_evidence_conflict";
    } catch {
      return true;
    }
  });
}

/** Missing/bad original attempt time or frozen contract never buys a fresh window. */
export function originalRecoveryWindow(database: DatabaseSync, taskId: string): OriginalRecoveryWindow | undefined {
  const row = database.prepare(`SELECT task.kind, task.model_configuration,
      attempt.created_at, attempt.execution_attempt, task.attempt
    FROM generation_tasks AS task JOIN generation_provider_attempts AS attempt
      ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
        AND attempt.owner_id IS task.owner_id AND attempt.kind = task.kind
        AND attempt.provider_profile_id IS task.provider_profile_id
        AND attempt.provider_model_id IS task.provider_model_id
        AND attempt.credential_revision IS task.credential_revision
    WHERE task.id = ? ORDER BY attempt.id DESC LIMIT 1`).get(taskId) as {
      kind: string; model_configuration: string; created_at: string;
      execution_attempt: number; attempt: number;
    } | undefined;
  if (!row || !Number.isFinite(Date.parse(row.created_at))) return undefined;
  const configuration = safeObject(row.model_configuration);
  if (!configuration) return undefined;
  const revision = configuration.modelReleaseRevision;
  let declaredDeadline: unknown;
  if (revision !== undefined) {
    if (!revision || typeof revision !== "object" || Array.isArray(revision)) return undefined;
    try { assertModelReleaseRevisionIntegrity(revision as ModelReleaseRevision); } catch { return undefined; }
    const document = (revision as Record<string, unknown>).document;
    if (!document || typeof document !== "object" || Array.isArray(document)) return undefined;
    const execution = (document as Record<string, unknown>).executionContract;
    if (!execution || typeof execution !== "object" || Array.isArray(execution)) return undefined;
    const policy = (execution as Record<string, unknown>).pollPolicy;
    if (policy !== undefined) {
      if (!policy || typeof policy !== "object" || Array.isArray(policy)) return undefined;
      declaredDeadline = (policy as Record<string, unknown>).deadlineMs;
    }
  }
  if (declaredDeadline !== undefined && (typeof declaredDeadline !== "number" ||
      !Number.isFinite(declaredDeadline) || declaredDeadline <= 0)) return undefined;
  const providerWindowMs = typeof declaredDeadline === "number" ? Math.min(day, declaredDeadline)
    : row.kind === "video" ? 75 * 60_000 : 15 * 60_000;
  const providerDeadline = Date.parse(row.created_at) + providerWindowMs;
  return { attemptStartedAt: row.created_at, providerWindowMs,
    providerDeadlineAt: new Date(providerDeadline).toISOString(),
    automaticDeadlineAt: new Date(providerDeadline + day).toISOString() };
}
function readCheckpoint(database: DatabaseSync, taskId: string, attempt: number,
  window?: OriginalRecoveryWindow) {
  const row = database.prepare(`SELECT error_message FROM generation_task_events
    WHERE task_id = ? AND error_code = ? ORDER BY id DESC LIMIT 1`).get(taskId, checkpointCode) as { error_message: string } | undefined;
  if (!row) return undefined;
  const parsed = row.error_message.length <= 2048 ? safeObject(row.error_message) : undefined;
  const checkpointTimes = parsed && [parsed.lastCheckedAt, parsed.nextCheckAt, parsed.leaseUntil]
    .map((value) => typeof value === "string" ? Date.parse(value) : Number.NaN);
  const attemptStartedAt = window ? Date.parse(window.attemptStartedAt) : Number.NaN;
  const automaticDeadlineAt = window ? Date.parse(window.automaticDeadlineAt) : Number.NaN;
  if (!parsed || Object.keys(parsed).sort().join() !==
      ["version", "executionAttempt", "count", "lastCheckedAt", "nextCheckAt", "leaseUntil"].sort().join() ||
      parsed.version !== 1 || !Number.isSafeInteger(parsed.executionAttempt) ||
      !Number.isSafeInteger(parsed.count) || Number(parsed.count) < 1 ||
      !checkpointTimes || checkpointTimes.some((value) => !Number.isFinite(value)) ||
      checkpointTimes[1] < checkpointTimes[0] || checkpointTimes[2] < checkpointTimes[0]) {
    throw new Error("Original recovery checkpoint is damaged");
  }
  // A checkpoint from an older execution attempt is intentionally ignored;
  // only the current attempt may be checked against this attempt's window.
  if (parsed.executionAttempt !== attempt) return undefined;
  if ((Number.isFinite(attemptStartedAt) && checkpointTimes[0] < attemptStartedAt) ||
      (Number.isFinite(automaticDeadlineAt) && checkpointTimes.some((value) => value > automaticDeadlineAt))) {
    throw new Error("Original recovery checkpoint is damaged");
  }
  return parsed as OriginalRecoveryCheck;
}
export function automaticRecoveryCheckpoint(database: DatabaseSync, taskId: string, attempt: number) {
  return readCheckpoint(database, taskId, attempt, originalRecoveryWindow(database, taskId));
}
export function supportsOriginalRecoveryRead(kind: string, providerTaskId: unknown, configuration: Record<string, unknown>) {
  const protocol = configuration.providerProtocol ?? "native";
  return kind !== "text" && ((protocol === "media-generate" && configuration.providerDriver === "multi-protocol-relay") ||
    (protocol === "native" && typeof providerTaskId === "string" && providerTaskId.length > 0 && ["video", "audio"].includes(kind)));
}

/** Shared budget-admission fence. Call inside the transaction that consumes a read. */
export function originalRecoveryReadPreflight(database: DatabaseSync, input: Readonly<{
  taskId: string; ownerId: string; executionAttempt: number;
}>) {
  if (!database.isTransaction) throw new Error("Recovery read admission requires a transaction");
  if (hasProviderEvidenceConflictForTaskInTransaction(database, input.taskId)) return false;
  const task = database.prepare(`SELECT task.state, task.error_code, task.owner_id, task.attempt,
      task.kind, task.provider_task_id, task.model_configuration, attempt.outcome
    FROM generation_tasks AS task JOIN generation_provider_attempts AS attempt
      ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
        AND attempt.owner_id IS task.owner_id AND attempt.kind = task.kind
        AND attempt.provider_profile_id IS task.provider_profile_id
        AND attempt.provider_model_id IS task.provider_model_id
        AND attempt.credential_revision IS task.credential_revision
    WHERE task.id = ?`).get(input.taskId) as { state: string; error_code: string | null;
      owner_id: string; attempt: number; kind: string; provider_task_id: string | null;
      model_configuration: string; outcome: string } | undefined;
  if (!task || task.owner_id !== input.ownerId || task.attempt !== input.executionAttempt ||
      !["boundary-claimed", "accepted", "response-received", "outcome-unknown"].includes(task.outcome) ||
      !(task.state === "recovering" || (task.state === "failed" &&
        ["OUTCOME_UNKNOWN_BILLING_RISK", "OPERATOR_INCIDENT"].includes(task.error_code ?? ""))) ||
      !executeTransactionScopedCommand(database, accountAllowsDurableMediaReferenceCommand, input.ownerId)) return false;
  const configuration = safeObject(task.model_configuration);
  if (!configuration || !supportsOriginalRecoveryRead(task.kind, task.provider_task_id, configuration) ||
      !originalRecoveryWindow(database, input.taskId)) return false;
  const publication = recoveryPublicationState(database, input.taskId);
  return !publication.pending && !publication.conflict;
}

/** Consume before the network. No task.updated_at mutation or transaction across await. */
export function claimAutomaticRecoveryCheck(database: DatabaseSync, input: Readonly<{
  taskId: string; ownerId: string; executionAttempt: number; now?: number;
}>) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const now = input.now ?? Date.now();
    if (!originalRecoveryReadPreflight(database, input)) { database.exec("COMMIT"); return undefined; }
    const task = database.prepare(`SELECT state, error_code, owner_id, attempt FROM generation_tasks WHERE id = ?`)
      .get(input.taskId) as { state: string; error_code: string | null; owner_id: string; attempt: number } | undefined;
    if (!task || task.owner_id !== input.ownerId || task.attempt !== input.executionAttempt ||
        !(task.state === "recovering" || (task.state === "failed" &&
          ["OUTCOME_UNKNOWN_BILLING_RISK", "OPERATOR_INCIDENT"].includes(task.error_code ?? ""))) ||
        !executeTransactionScopedCommand(database, accountAllowsDurableMediaReferenceCommand, input.ownerId)) {
      database.exec("COMMIT"); return undefined;
    }
    const window = originalRecoveryWindow(database, input.taskId);
    const prior = readCheckpoint(database, input.taskId, input.executionAttempt, window);
    if (!window || now >= Date.parse(window.automaticDeadlineAt) ||
        (prior && (now < Date.parse(prior.nextCheckAt) || now < Date.parse(prior.leaseUntil)))) {
      database.exec("COMMIT"); return undefined;
    }
    const count = (prior?.count ?? 0) + 1;
    const automaticDeadlineAt = Date.parse(window.automaticDeadlineAt);
    const checkpoint: OriginalRecoveryCheck = { version: 1, executionAttempt: input.executionAttempt,
      count, lastCheckedAt: new Date(now).toISOString(),
      leaseUntil: new Date(Math.min(automaticDeadlineAt, now + 10_000)).toISOString(),
      nextCheckAt: new Date(Math.min(automaticDeadlineAt,
        now + Math.min(30_000 * 2 ** Math.min(count - 1, 10), 15 * 60_000))).toISOString() };
    database.prepare(`INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
      VALUES(?,?,?,?,?)`).run(input.taskId, task.state, checkpointCode, JSON.stringify(checkpoint), checkpoint.lastCheckedAt);
    database.exec("COMMIT"); return checkpoint;
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
}

export function recoveryPublicationState(database: DatabaseSync, taskId: string) {
  const ownsSnapshot = !database.isTransaction;
  if (ownsSnapshot) database.exec("BEGIN");
  try {
    const media = executeTransactionScopedCommand(database, readGenerationRecoveryPublicationStateCommand, taskId);
    const projectionConflict = Boolean(database.prepare(`SELECT 1 FROM generation_canvas_projection_states
      WHERE task_id = ? AND state = 'conflict' LIMIT 1`).get(taskId));
    return { ...media, conflict: media.quarantined || projectionConflict };
  } finally { if (ownsSnapshot) database.exec("COMMIT"); }
}

/** A platform Retry-After can only delay the already consumed automatic read. */
export function deferAutomaticRecoveryCheck(database: DatabaseSync, input: Readonly<{
  taskId: string; ownerId: string; executionAttempt: number; check: OriginalRecoveryCheck; retryAfterSeconds: number;
}>) {
  if (!Number.isFinite(input.retryAfterSeconds) || input.retryAfterSeconds <= 0 || input.retryAfterSeconds > 86_400) return;
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare("SELECT owner_id, attempt, state FROM generation_tasks WHERE id = ?")
      .get(input.taskId) as { owner_id: string; attempt: number; state: string } | undefined;
    const window = originalRecoveryWindow(database, input.taskId);
    const prior = readCheckpoint(database, input.taskId, input.executionAttempt, window);
    if (row?.owner_id !== input.ownerId || row.attempt !== input.executionAttempt ||
        !["failed", "recovering"].includes(row.state) || !window || !prior ||
        prior.count !== input.check.count || prior.lastCheckedAt !== input.check.lastCheckedAt ||
        !executeTransactionScopedCommand(database, accountAllowsDurableMediaReferenceCommand, input.ownerId)) {
      database.exec("COMMIT"); return;
    }
    const next = Math.min(Date.parse(window.automaticDeadlineAt), Date.now() + input.retryAfterSeconds * 1000);
    if (next > Date.parse(prior.nextCheckAt)) {
      database.prepare(`INSERT INTO generation_task_events(task_id,state,error_code,error_message,created_at)
        VALUES(?,?,?,?,?)`).run(input.taskId, row.state, checkpointCode,
          JSON.stringify({ ...prior, nextCheckAt: new Date(next).toISOString() }), new Date().toISOString());
    }
    database.exec("COMMIT");
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
}
