import { createHash, randomUUID } from "node:crypto";
import { appDataDirectory, openAppDatabase } from "./database";
import { createGenerationTaskStore, type GenerationTask } from "./generationTaskStore";
import { createGenerationRecoveryCaseStore, generationRecoverySystemActorId, GenerationRecoveryCaseError } from "./generationRecoveryCaseStore";
import { generationRecoveryCasesEnabled } from "./generationRecoveryFeatureFlags";
import { assertGenerationRecoveryWriteAllowed, recoveryCaseFence } from "./generationRecoveryCaseApplication";
import { hasProviderEvidenceConflictForTaskInTransaction, supportsOriginalRecoveryRead, deferAutomaticRecoveryCheck, claimAutomaticRecoveryCheck, listRecoveryTaskIds, originalRecoveryWindow, recoveryPublicationState } from "./generationRecoveryTaskQueries";
import type { GenerationRecoveryCaseSnapshot, RecoveryCaseCheckOutcome, RecoveryCaseReason } from "../types/generationRecovery";
import type { OriginalGenerationProviderInspection } from "./generationTasks";

type Store = ReturnType<typeof createGenerationRecoveryCaseStore>;
type WorkerPorts = Readonly<{
  inspect: (task: GenerationTask, signal: AbortSignal) => Promise<OriginalGenerationProviderInspection>;
  capture: (taskId: string, caseId: string) => unknown;
  apply: (input: { task: GenerationTask; case: GenerationRecoveryCaseSnapshot; expected: unknown;
    observation: OriginalGenerationProviderInspection; actorId: string; commandId: string; signal: AbortSignal }) => Promise<void | { taskEventWatermark: number; caseEventId: number }>;
  normalSweep: () => Promise<unknown>;
  recoverPublished?: (taskId: string) => boolean;
  registered: <T>(work: () => Promise<T>, abort: () => void) => Promise<T>;
}>;
let ports: WorkerPorts | undefined;
let cursor = "";
let cursorDirectory = "";
let sweep: Promise<void> | undefined;
const active = new Map<string, AbortController>();
export function configureGenerationRecoveryWorkerPorts(value: WorkerPorts) { ports = value; }
export function generationRecoveryInspectionActive(taskId: string) { return active.has(taskId); }
export function abortGenerationRecoveryInspections() {
  for (const controller of active.values()) controller.abort();
}
function followUpCommand(operationId: string, action: string) {
  return `${action}:${createHash("sha256").update(operationId).digest("hex")}`;
}
function queryOutcome(observation: OriginalGenerationProviderInspection): RecoveryCaseCheckOutcome {
  if (observation.state === "not-found" || observation.state === "unsupported") return "no_match";
  if (observation.state === "ambiguous") return "multiple_matches";
  // A GET response is not yet a published result or final settlement.
  return "still_running";
}
function getCurrent(cases: Store, task: GenerationTask) {
  try { return cases.getByTaskAttempt(task.id, task.attempt, task.ownerId); }
  catch (error) {
    if (error instanceof GenerationRecoveryCaseError && error.code === "RECOVERY_NOT_FOUND") return undefined;
    throw error;
  }
}

/** HTTP starts one session; subsequent sweeps use its persistent budget. */
export async function inspectGenerationRecoveryCase(taskId: string, actorId: string, operationId: string) {
  assertGenerationRecoveryWriteAllowed();
  if (!ports) throw new Error("Recovery runtime unavailable");
  if (active.has(taskId)) return;
  const directory = appDataDirectory();
  const database = openAppDatabase(directory);
  const tasks = createGenerationTaskStore(directory, { recoverRunning: false });
  const cases = createGenerationRecoveryCaseStore(database);
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  try {
    const task = tasks.get(taskId);
    if (!task?.ownerId) throw new GenerationRecoveryCaseError("RECOVERY_NOT_FOUND", "原任务不可用");
    if (hasProviderEvidenceConflictForTaskInTransaction(database, task.id)) return;
    const item = getCurrent(cases, task);
    if (!item || item.closedAt || ["success", "cancelled"].includes(task.state)) return;
    const publication = recoveryPublicationState(database, task.id);
    if (!publication.pending && !publication.conflict && ports.recoverPublished?.(task.id)) {
      cases.settleFromTask(recoveryCaseFence(getCurrent(cases, tasks.get(task.id)!)!,
        generationRecoverySystemActorId, followUpCommand(operationId, "published")));
      return;
    }
    const window = originalRecoveryWindow(database, task.id);
    const attempt = tasks.getProviderAttemptForTask(task.id);
    if (!window || !attempt || ["completed", "provider-failed", "definitive-rejected"].includes(attempt.outcome) ||
        !supportsOriginalRecoveryRead(task.kind, task.providerTaskId, task.modelConfiguration)) return;
    if (publication.pending || publication.conflict) {
      if (publication.pending && !publication.conflict) await ports.normalSweep();
      return;
    }
    const automatic = Date.now() < Date.parse(window.automaticDeadlineAt);
    if (automatic && task.state === "recovering" && !cases.hasOriginalOnly(task.id, task.attempt)) {
      // The existing worker owns the original budget; a click never adds a GET.
      await ports.normalSweep(); return;
    }
    if (!automatic && !item.inspectionStartedAt && actorId === generationRecoverySystemActorId) return;
    const checkpoint = automatic ? claimAutomaticRecoveryCheck(database, {
      taskId: task.id, ownerId: task.ownerId, executionAttempt: task.attempt,
    }) : undefined;
    if (automatic && !checkpoint) return;
    const claimed = automatic
      ? cases.getByTaskAttempt(task.id, task.attempt, task.ownerId)!
      : cases.beginInspection(recoveryCaseFence(item, actorId, operationId));
    // An idempotent repeated command must not reuse its consumed lease.
    if (!automatic && (!("inspectionStarted" in claimed) || !claimed.inspectionStarted ||
        !claimed.inspectionLeaseId || !claimed.inspectionLeaseUntil ||
        Date.parse(claimed.inspectionLeaseUntil) <= Date.now())) return;
    active.set(taskId, controller);
    timeout = setTimeout(() => controller.abort(), 10_000);
    const expected = ports.capture(task.id, item.caseId);
    await ports.registered(async () => {
      let outcome: RecoveryCaseCheckOutcome = "query_failed";
      let retryAfterAt: string | undefined;
      let appliedFence: { taskEventWatermark: number; caseEventId: number } | void = undefined;
      try {
        const observation = await ports!.inspect(task, controller.signal);
        controller.signal.throwIfAborted();
        clearTimeout(timeout);
        timeout = undefined;
        assertGenerationRecoveryWriteAllowed();
        appliedFence = await ports!.apply({ task, case: claimed, expected, observation, actorId,
          commandId: followUpCommand(operationId, "apply"), signal: controller.signal });
        outcome = queryOutcome(observation);
      } catch (error) {
        const seconds = error && typeof error === "object" && "retryAfterSeconds" in error
          ? error.retryAfterSeconds : undefined;
        if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400) {
          retryAfterAt = new Date(Date.now() + seconds * 1000).toISOString();
        }
        throw error;
      } finally {
        // Closing an expired check records no new Provider evidence. Any
        // concurrent task/case mutation wins over this late response.
        assertGenerationRecoveryWriteAllowed();
        const latestTask = tasks.get(task.id);
        let latest = latestTask && getCurrent(cases, latestTask);
        const conflicted = hasProviderEvidenceConflictForTaskInTransaction(database, task.id);
        if (!conflicted && latest && latestTask && ["success", "failed"].includes(latestTask.state)) {
          try {
            latest = cases.settleFromTask(recoveryCaseFence(latest,
              generationRecoverySystemActorId, followUpCommand(operationId, "settled")));
          } catch { /* An unknown terminal remains protected and unresolved. */ }
        }
        if (!conflicted && latest && automatic && latestTask?.state !== "cancelled" &&
            latest.eventId === (appliedFence?.caseEventId ?? claimed.eventId) &&
            latest.taskEventWatermark === (appliedFence?.taskEventWatermark ?? claimed.taskEventWatermark)) {
          cases.recordCheck({ ...recoveryCaseFence(latest, actorId, followUpCommand(operationId, "finish")), outcome });
          if (retryAfterAt && checkpoint) deferAutomaticRecoveryCheck(database, {
            taskId: task.id, ownerId: task.ownerId!, executionAttempt: task.attempt, check: checkpoint,
            retryAfterSeconds: Math.max(0, (Date.parse(retryAfterAt) - Date.now()) / 1000),
          });
        } else if (!conflicted && !automatic && latest && latest.inspectionLeaseId === claimed.inspectionLeaseId &&
            latest.task.attempt === claimed.executionAttempt) {
          cases.finishInspection({ ...recoveryCaseFence(latest, actorId, followUpCommand(operationId, "finish")),
            inspectionLeaseId: claimed.inspectionLeaseId!, outcome, retryAfterAt });
        }
      }
    }, () => controller.abort());
  } finally {
    if (timeout) clearTimeout(timeout);
    active.delete(taskId); tasks.close(); database.close();
  }
}

/** Uses the existing 30-second tick. A local maintenance failure never rejects that tick. */
export function runGenerationRecoveryCasesSweep() {
  if (!generationRecoveryCasesEnabled() || !ports) return Promise.resolve();
  if (sweep) return sweep;
  sweep = (async () => {
    try { assertGenerationRecoveryWriteAllowed(); } catch { abortGenerationRecoveryInspections(); return; }
    const directory = appDataDirectory();
    if (cursorDirectory !== directory) { cursor = ""; cursorDirectory = directory; }
    const database = openAppDatabase(directory);
    const tasks = createGenerationTaskStore(directory, { recoverRunning: false });
    const cases = createGenerationRecoveryCaseStore(database);
    const due: string[] = [];
    try {
      const ids = listRecoveryTaskIds(database, cursor, 40);
      cursor = ids.length < 40 ? "" : ids.at(-1)!;
      for (const id of ids) {
        try {
          assertGenerationRecoveryWriteAllowed();
          const task = tasks.get(id); if (!task?.ownerId) continue;
          if (hasProviderEvidenceConflictForTaskInTransaction(database, id)) continue;
          let prior = getCurrent(cases, task);
          if (prior && ["success", "failed"].includes(task.state)) {
            try { prior = cases.settleFromTask(recoveryCaseFence(prior,
              generationRecoverySystemActorId, `settled:${task.id}:${task.attempt}`)); }
            catch { /* Failed does not by itself prove a safe new generation. */ }
          }
          if (["success", "cancelled"].includes(task.state)) continue;
          const attempt = tasks.getProviderAttemptForTask(id);
          if (attempt?.outcome === "completed") {
            cases.ensurePublicationQuarantineCase({
              taskId: id, ownerId: task.ownerId, executionAttempt: task.attempt,
              operationId: `publication-quarantine:${id}:${task.attempt}`,
            });
            continue;
          }
          if (prior?.phase === "ready_for_user" ||
              (attempt && ["provider-failed", "definitive-rejected"].includes(attempt.outcome))) continue;
          const window = originalRecoveryWindow(database, id);
          const publication = recoveryPublicationState(database, id);
          const supported = supportsOriginalRecoveryRead(task.kind, task.providerTaskId, task.modelConfiguration);
          const reason: RecoveryCaseReason | undefined = !window ? "missing_attempt_evidence"
            : publication.conflict ? "provider_evidence_conflict"
            : !supported ? "unsupported_recovery"
            : task.errorCode === "OPERATOR_INCIDENT" ? "operator_incident"
            : task.errorCode === "RESULT_SAVE_FAILED_NO_RETRY" ? "result_recovery_pending"
            : Date.now() >= Date.parse(window.providerDeadlineAt) ? "recovery_window_exhausted" : undefined;
          const item = prior ?? (reason ? cases.ensureCase({ taskId: id, ownerId: task.ownerId,
            executionAttempt: task.attempt, reason, operationId: `case:${id}:${task.attempt}`,
            providerWindowMs: window?.providerWindowMs }) : undefined);
          if (item && !publication.pending && !publication.conflict && ports?.recoverPublished?.(id)) {
            cases.settleFromTask(recoveryCaseFence(getCurrent(cases, tasks.get(id)!)!,
              generationRecoverySystemActorId, `published:${id}:${task.attempt}`));
            continue;
          }
          if (publication.pending || publication.conflict) continue;
          if (item && window && supported && Date.now() < Date.parse(window.automaticDeadlineAt) &&
              (task.state === "failed" || cases.hasOriginalOnly(task.id, task.attempt))) {
            due.push(id);
          } else if (item?.inspectionStartedAt && item.inspectionDeadlineAt && (item.inspectionUsed ?? 0) < 12 &&
              Date.now() < Date.parse(item.inspectionDeadlineAt) &&
              (!item.nextCheckAt || Date.now() >= Date.parse(item.nextCheckAt))) due.push(id);
        } catch { /* Malformed or unavailable case remains unresolved; continue the page. */ }
      }
    } finally { tasks.close(); database.close(); }
    const deadline = Date.now() + 25_000;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, due.length) }, async () => {
      while (next < due.length && Date.now() < deadline) {
        const id = due[next++];
        try { await inspectGenerationRecoveryCase(id, generationRecoverySystemActorId, `scan:${randomUUID()}`); }
        catch { /* Persistent leases/budget survive errors and process restarts. */ }
      }
    }));
  })().finally(() => { sweep = undefined; });
  return sweep;
}
