import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import { createGenerationTaskStore, type GenerationTask } from "./generationTaskStore";
import { createGenerationRecoveryCaseStore, GenerationRecoveryCaseError } from "./generationRecoveryCaseStore";
import { generationRecoveryCasesEnabled } from "./generationRecoveryFeatureFlags";
import { createGenerationRecoveryCasesApi, type GenerationRecoveryHttpPort } from "./generationRecoveryCasesApi";
import {
  automaticRecoveryCheckpoint,
  originalRecoveryWindow,
  providerEvidenceConflictEventCode,
} from "./generationRecoveryTaskQueries";
import { inspectSingleNodeGenerationCanvasState } from "./generationCanvasProjection";
import { readPublishedGenerationMediaProjectionCommand } from "./mediaTransactionCommands";
import { incGen017GenerationEnabled } from "./incGen017FeatureFlags";
import { readGenerationRecoveryAuditCommand } from "./accountTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import {
  recoveryCaseAuditActions,
  type GenerationRecoveryCaseSnapshot,
  type RecoveryCaseAdminAuditEntry,
  type RecoveryCaseAdminDetail,
  type RecoveryCaseAdminList,
  type RecoveryCaseAdminSummary,
  type RecoveryCaseSummary,
} from "../types/generationRecovery";

type Context = ReturnType<typeof context>;
type Case = GenerationRecoveryCaseSnapshot;
type RecoveryPorts = Readonly<{
  frozen: () => boolean;
  inspecting: (taskId: string) => boolean;
  inspect: (taskId: string, actorId: string, operationId: string) => Promise<void>;
}>;
let ports: RecoveryPorts | undefined;
export function configureGenerationRecoveryCasePorts(value: RecoveryPorts) { ports = value; }

export function assertGenerationRecoveryWriteAllowed() {
  if (!generationRecoveryCasesEnabled()) throw new GenerationRecoveryCaseError("RECOVERY_DISABLED", "维护功能关闭");
  if (!incGen017GenerationEnabled() || !ports || ports.frozen()) {
    throw Object.assign(new Error("生成维护已暂停"), { code: "RECOVERY_FROZEN" });
  }
}
function context() {
  const directory = appDataDirectory();
  const database = openAppDatabase(directory);
  const tasks = createGenerationTaskStore(directory, { recoverRunning: false });
  const cases = createGenerationRecoveryCaseStore(database);
  return { database, tasks, cases, close: () => { tasks.close(); database.close(); } };
}
function withContext<T>(read: (value: Context) => T): T {
  const value = context();
  try { return read(value); } finally { value.close(); }
}
export function recoveryCaseFence(item: Case, actorId: string, operationId: string) {
  return { taskId: item.taskId, ownerId: item.ownerId, executionAttempt: item.executionAttempt,
    caseId: item.caseId, expectedCaseEventId: item.eventId, expectedCaseRevision: item.caseRevision,
    expectedTaskEventWatermark: item.taskEventWatermark, actorId, operationId };
}

const recoveryFollowUpWindowMs = 24 * 60 * 60_000;

function hasReadableGenerationResult(database: DatabaseSync, task: GenerationTask) {
  if (task.kind === "text") return Boolean(task.resultText?.trim());
  if (!task.ownerId || !task.resultAssetId) return false;
  const ownsSnapshot = !database.isTransaction;
  if (ownsSnapshot) database.exec("BEGIN");
  try {
    const media = executeTransactionScopedCommand(
      database,
      readPublishedGenerationMediaProjectionCommand,
      {
        executionAttempt: task.attempt,
        kind: task.kind,
        ownerId: task.ownerId,
        primaryAssetId: task.resultAssetId,
        taskId: task.id,
      },
    );
    return media.length > 0 && media[0]?.assetId === task.resultAssetId;
  } finally {
    if (ownsSnapshot) database.exec("COMMIT");
  }
}

/** Public wording is derived from task evidence and durable work, never an error regex. */
export function recoveryCaseSummary(database: DatabaseSync, item: Case, task: GenerationTask, newGenerationAllowed = false): RecoveryCaseSummary {
  const now = Date.now();
  const lastClaimActivityAt = item.progressAt ?? item.claimedAt;
  const hasProviderEvidenceConflict = item.reason === "provider_evidence_conflict" && Boolean(database.prepare(`
    SELECT 1 FROM generation_task_events
    WHERE task_id = ? AND error_code = ?
    LIMIT 1
  `).get(task.id, providerEvidenceConflictEventCode));
  let status: RecoveryCaseSummary["status"] = "queued";
  let summary = "自动恢复暂未完成，已登记待处理；你不用做技术检查";
  let action: RecoveryCaseSummary["action"] = "view_progress";
  let nextCheckAt: string | undefined;
  if (item.reason === "provider_evidence_conflict") {
    status = "unresolved";
    summary = hasProviderEvidenceConflict
      ? "平台返回了相互矛盾的原请求证据，已转入维护核对；不会反向结算或重复提交"
      : "原请求或结果记录存在冲突，已登记维护核对；确认结果前不会重复生成";
    action = "view_progress";
  } else if (task.state === "success") {
    if (!hasReadableGenerationResult(database, task)) {
      // A terminal task row is not proof that its result can still be read.
      // Keep the task visible without claiming that deleted or isolated media
      // was recovered, and do not turn this branch into a new generation.
      status = "unavailable";
      summary = "原任务已完成，但结果素材当前不可读取，任务记录已保留";
      action = "none";
    } else {
      const ownsSnapshot = !database.isTransaction;
      if (ownsSnapshot) database.exec("BEGIN");
      let projection: ReturnType<typeof inspectSingleNodeGenerationCanvasState> | undefined;
      try { projection = task.ownerId && task.modelConfiguration.generationIdentityVersion === 2
        ? inspectSingleNodeGenerationCanvasState({ database, taskId: task.id, ownerId: task.ownerId }) : undefined;
      } finally { if (ownsSnapshot) database.exec("COMMIT"); }
      const pending = projection?.projectionState === "pending";
      status = pending ? "result_pending" : "result_recovered";
      summary = pending ? "原结果已找回，正在自动保存到画布" : "原结果已找回，可在当前节点或任务记录查看";
      action = "view_result";
    }
  } else if (task.state === "failed" && newGenerationAllowed) {
    status = "ready_for_user"; summary = "原任务已核实结束，可以只重新生成当前节点"; action = "regenerate";
  } else if (task.state === "cancelled") {
    status = "unresolved"; summary = "任务已取消，原请求记录已保留"; action = "none";
  } else if (generationRecoveryCasesEnabled() && incGen017GenerationEnabled() && ports && !ports.frozen()) {
    const checkpoint = automaticRecoveryCheckpoint(database, task.id, task.attempt);
    const window = originalRecoveryWindow(database, task.id);
    if (ports.inspecting(task.id)) {
      status = "recovering"; summary = "系统正在核对原请求，不会重复提交生成";
    } else if ((checkpoint && window && now < Date.parse(window.automaticDeadlineAt) &&
          now <= Date.parse(checkpoint.nextCheckAt)) ||
        (item.inspectionStartedAt && item.inspectionDeadlineAt && now < Date.parse(item.inspectionDeadlineAt) &&
          (item.inspectionUsed ?? 0) < 12 && item.nextCheckAt && now <= Date.parse(item.nextCheckAt))) {
      status = "scheduled"; summary = "系统已安排继续核对原请求，你不用点击重试";
      nextCheckAt = checkpoint && window && now < Date.parse(window.automaticDeadlineAt)
        ? checkpoint.nextCheckAt : item.nextCheckAt;
    } else if (item.claimedBy && lastClaimActivityAt &&
        now - Date.parse(lastClaimActivityAt) >= recoveryFollowUpWindowMs) {
      status = "unresolved"; summary = "尚未确认原请求结果，维护事项需要继续跟进";
    } else if (item.phase === "waiting_provider" && item.claimedBy) {
      status = "waiting_provider"; summary = "维护人员已跟进，正在等待平台回复";
    } else if (item.phase === "claimed" && item.claimedBy) {
      status = "claimed"; summary = "维护人员已接手，原请求尚未确认结果";
    } else if ((window && now >= Date.parse(window.automaticDeadlineAt)) || item.checkOutcome === "window_expired" ||
        (item.inspectionDeadlineAt && (now >= Date.parse(item.inspectionDeadlineAt) || (item.inspectionUsed ?? 0) >= 12))) {
      status = "unresolved"; summary = "尚未确认原请求结果，已保留维护事项；你不用反复检查";
    }
  } else {
    status = "unavailable"; summary = "原请求及处理记录已保留，维护进度暂不可更新";
  }
  return { taskId: task.id, caseId: item.caseId, canvasId: task.canvasId, nodeId: task.nodeId,
    kind: task.kind, executionAttempt: item.executionAttempt, phase: item.phase,
    caseEventId: item.eventId, progressVersion: item.progressVersion,
    updatedAt: item.progressAt ?? item.openedAt,
    ...(item.lastCheckedAt ? { lastCheckedAt: item.lastCheckedAt } : {}),
    ...(nextCheckAt ? { nextCheckAt } : {}),
    unread: item.progressVersion > (item.lastReadProgressVersion ?? 0), reasonCode: item.reason, status, summary, action };
}

function adminRecoveryCaseSummary(
  database: DatabaseSync,
  item: Case,
  task: GenerationTask,
  newGenerationAllowed = false,
): RecoveryCaseAdminSummary {
  const summary = recoveryCaseSummary(database, item, task, newGenerationAllowed);
  const now = Date.now();
  const openedAt = Date.parse(item.openedAt);
  const progressAt = item.progressAt ?? item.claimedAt;
  const progressMilliseconds = progressAt ? Date.parse(progressAt) : Number.NaN;
  const claimActive = item.phase === "claimed" || item.phase === "waiting_provider";
  const overdue = item.phase === "queued" && !item.claimedBy && Number.isFinite(openedAt) &&
    now - openedAt >= recoveryFollowUpWindowMs;
  const followUpDue = claimActive && Boolean(item.claimedBy) && Number.isFinite(progressMilliseconds) &&
    now - progressMilliseconds >= recoveryFollowUpWindowMs;
  const configuredModelId = task.modelConfiguration.modelId;
  const modelId = typeof task.model === "string" && task.model.trim()
    ? task.model
    : typeof configuredModelId === "string" && configuredModelId.trim()
      ? configuredModelId
      : undefined;
  return {
    ...summary,
    ownerId: item.ownerId,
    ...(modelId ? { modelId } : {}),
    ...(task.providerModelId ? { providerModelId: task.providerModelId } : {}),
    originalCreatedAt: task.createdAt,
    ...(item.attemptStartedAt ? { attemptStartedAt: item.attemptStartedAt } : {}),
    openedAt: item.openedAt,
    overdue,
    followUpDue,
    ...(claimActive && item.claimedBy ? { claimedBy: item.claimedBy } : {}),
    ...(claimActive && item.claimLeaseUntil ? { claimLeaseUntil: item.claimLeaseUntil } : {}),
  };
}

function safeRecoveryAudit(
  audit: readonly Readonly<{ id: number; action: string; actor: string; createdAt: string }>[],
): readonly RecoveryCaseAdminAuditEntry[] {
  return audit.flatMap((entry) =>
    recoveryCaseAuditActions.includes(entry.action as (typeof recoveryCaseAuditActions)[number])
      ? [{ ...entry, action: entry.action as RecoveryCaseAdminAuditEntry["action"] }]
      : [],
  );
}

function detail(value: Context, taskId: string, ownerId?: string, admin = false) {
  const task = value.tasks.get(taskId);
  // Queued tasks have no execution attempt or recovery case yet. A canvas
  // batch may include them alongside an older task under recovery.
  if (!task || task.attempt < 1 || (ownerId && task.ownerId !== ownerId)) return null;
  try {
    const item = value.cases.getByTaskAttempt(task.id, task.attempt, ownerId);
    return item
      ? (admin
        ? adminRecoveryCaseSummary(value.database, item, task, value.tasks.newGenerationDecision(task.id).allowed)
        : recoveryCaseSummary(value.database, item, task, value.tasks.newGenerationDecision(task.id).allowed))
      : null;
  } catch (cause) {
    if (cause instanceof GenerationRecoveryCaseError && cause.code === "RECOVERY_NOT_FOUND") return null;
    if (!(cause instanceof GenerationRecoveryCaseError) || !["RECOVERY_CASE_CORRUPT", "RECOVERY_CASE_LIMIT"].includes(cause.code)) throw cause;
    const row = value.database.prepare(`SELECT MAX(id) AS id FROM generation_task_events
      WHERE task_id = ? AND error_code GLOB 'RECOVERY_CASE_V*'`).get(taskId) as { id: number | null };
    if (!row.id) throw cause;
    // Corruption is visible, but never produces a fictitious successful claim,
    // fresh budget, result or acknowledgement command.
    return { taskId, caseId: `unavailable:${taskId}`, canvasId: task.canvasId, nodeId: task.nodeId,
      kind: task.kind, executionAttempt: task.attempt, phase: "queued", caseEventId: row.id,
      progressVersion: 0, updatedAt: task.updatedAt, unread: false,
      reasonCode: "provider_evidence_conflict", summary: "原请求记录已保留，处理记录需要维护核对；你不用反复检查",
      status: "unavailable", action: "none" } satisfies RecoveryCaseSummary;
  }
}
function enabled() { return generationRecoveryCasesEnabled(); }
export const generationRecoveryHttpPort: GenerationRecoveryHttpPort = {
  listOwner(ownerId, taskIds) {
    if (!enabled()) return { enabled: false, cases: [] };
    return withContext((value) => ({ enabled: true, cases: taskIds.flatMap((id) => {
      const item = detail(value, id, ownerId); return item ? [item] : [];
    }) }));
  },
  detailOwner(ownerId, taskId) {
    return withContext((value) => ({ enabled: enabled(), case: detail(value, taskId, ownerId) }));
  },
  listAdmin(after, limit) {
    return withContext((value) => {
      const page = value.cases.list({ cursor: after, limit, order: "admin", now: new Date() });
      const result: RecoveryCaseAdminList = { enabled: enabled(), cases: page.items.flatMap((item) => {
        const task = value.tasks.get(item.taskId);
        return task ? [adminRecoveryCaseSummary(value.database, item, task, value.tasks.newGenerationDecision(task.id).allowed)] : [];
      }), corrupt: page.corrupt ?? [], nextCursor: page.nextCursor, unavailableCount: page.corrupt?.length ?? 0 };
      return result;
    });
  },
  detailAdmin(taskId) {
    return withContext((value) => {
      value.database.exec("BEGIN");
      try {
        const item = detail(value, taskId, undefined, true);
        const audit = item ? safeRecoveryAudit(executeTransactionScopedCommand(value.database, readGenerationRecoveryAuditCommand, taskId)) : [];
        value.database.exec("COMMIT");
        const result: RecoveryCaseAdminDetail = { enabled: enabled(), case: item, audit };
        return result;
      } catch (error) { if (value.database.isTransaction) value.database.exec("ROLLBACK"); throw error; }
    });
  },
  async mutate(input) {
    assertGenerationRecoveryWriteAllowed();
    const item = withContext((value) => {
      const task = value.tasks.get(input.taskId);
      if (!task || (input.action === "read" && task.ownerId !== input.actorId)) {
        throw new GenerationRecoveryCaseError("RECOVERY_NOT_FOUND", "未找到处理事项");
      }
      const current = value.cases.getByTaskAttempt(task.id, task.attempt);
      if (!current) throw new GenerationRecoveryCaseError("RECOVERY_NOT_FOUND", "未找到处理事项");
      const fence = { ...recoveryCaseFence(current, input.actorId, input.commandId),
        expectedCaseEventId: input.expectedCaseEventId };
      if (input.action === "read") return value.cases.acknowledge({ ...fence,
        expectedProgressVersion: input.progressVersion! });
      if (input.action === "claim") return value.cases.claim(fence);
      if (input.action === "progress") return value.cases.markProgress({ ...fence, phase: "waiting_provider" });
      if (current.eventId !== input.expectedCaseEventId) {
        throw new GenerationRecoveryCaseError("RECOVERY_CASE_CONFLICT", "处理进度已变化");
      }
      return current;
    });
    if (input.action === "inspect") await ports!.inspect(item.taskId, input.actorId, input.commandId);
    return withContext((value) => ({ enabled: enabled(), case: detail(value, item.taskId, undefined, input.action !== "read") }));
  },
};
export const generationRecoveryCasesHandlers = createGenerationRecoveryCasesApi(generationRecoveryHttpPort);
