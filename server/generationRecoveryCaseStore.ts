import {
  originalRecoveryReadPreflight,
  providerEvidenceConflictEventCode,
  recoveryPublicationState,
} from "./generationRecoveryTaskQueries";
import { assertOriginalRecoveryReadFence, type OriginalRecoveryReadFence } from "./generationRecoveryReadFence";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  accountAllowsDurableMediaReferenceCommand,
  isActiveGenerationRecoveryAdminCommand,
} from "./accountTransactionCommands";
import { recordAudit } from "./audit";
import { openAppDatabase } from "./database";
import { generationRecoveryCasesEnabled } from "./generationRecoveryFeatureFlags";
import { newGenerationForNodeInTransaction } from "./generationAttemptQueries";
import {
  executeTransactionScopedCommand,
  type TransactionScopedCommand,
} from "./transactionCommand";
import {
  isGenerationCapabilityKind,
  type GenerationCapabilityKind,
} from "../types/nodeVocabulary";
import {
  recoveryCaseCheckOutcomes,
  recoveryCaseEventCode,
  recoveryCaseEventKinds,
  recoveryCasePhases,
  recoveryCaseReasons,
  recoveryCaseVersion,
  recoveryOriginalOnlyEventCode,
  recoveryTaskStates,
  type GenerationRecoveryCaseSnapshot,
  type RecoveryCaseCorruptSummary,
  type RecoveryCaseCheckOutcome,
  type RecoveryCaseEvidenceReference,
  type RecoveryCaseEventKind,
  type RecoveryCaseEventPayload,
  type RecoveryCasePage,
  type RecoveryCasePhase,
  type RecoveryCaseReason,
  type RecoveryCaseTaskSummary,
  type RecoveryOriginalOnlyMarker,
  type RecoveryTaskState,
} from "../types/generationRecovery";

/** The automatic actor is an internal command identity, not an HTTP identity. */
export const generationRecoverySystemActorId = "system:generation-recovery" as const;

const identifierPattern = /^[A-Za-z0-9._:-]{1,160}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxEventMessageBytes = 16_384;
const maxCaseEventsPerTask = 512;
const maxListEvents = 100_000;
const maxPageSize = 200;
const maximumProviderWindowMs = 24 * 60 * 60 * 1_000;
const defaultVideoProviderWindowMs = 75 * 60 * 1_000;
const defaultOtherProviderWindowMs = 15 * 60 * 1_000;
const claimLeaseMs = 15 * 60 * 1_000;
const claimTakeoverMs = 24 * 60 * 60 * 1_000;
const inspectionTimeoutMs = 10 * 1_000;
const maximumInspectionUses = 12;
const inspectionSessionMs = 24 * 60 * 60 * 1_000;

const recoveryCaseActionNames = {
  acknowledged: "generation_recovery.case_acknowledged",
  checked: "generation_recovery.case_checked",
  claimed: "generation_recovery.case_claimed",
  closed: "generation_recovery.case_closed",
  opened: "generation_recovery.case_opened",
  progressed: "generation_recovery.case_progressed",
} as const;

export type GenerationRecoveryCaseErrorCode =
  | "RECOVERY_DISABLED"
  | "RECOVERY_ADMIN_REQUIRED"
  | "RECOVERY_INVALID_COMMAND"
  | "RECOVERY_NOT_FOUND"
  | "RECOVERY_CASE_CONFLICT"
  | "RECOVERY_CASE_CORRUPT"
  | "RECOVERY_CASE_NOT_DUE"
  | "RECOVERY_CASE_LIMIT"
  | "RECOVERY_CASE_TASK_NOT_FOUND"
  | "RECOVERY_CASE_OWNER_BLOCKED"
  | "RECOVERY_CASE_ATTEMPT_NOT_FOUND";

export class GenerationRecoveryCaseError extends Error {
  readonly code: GenerationRecoveryCaseErrorCode;

  constructor(code: GenerationRecoveryCaseErrorCode, message: string) {
    super(message);
    this.name = "GenerationRecoveryCaseError";
    this.code = code;
  }
}

type ClockInput = Date | string | undefined;
export type MutationFence = Readonly<{
  taskId: string;
  ownerId: string;
  caseId: string;
  executionAttempt: number;
  expectedCaseEventId: number;
  expectedCaseRevision: number;
  expectedTaskEventWatermark?: number;
  operationId: string;
  actorId: string;
  now?: ClockInput;
}>;

export type RecoveryCaseOpenInput = Readonly<{
  taskId: string;
  ownerId: string;
  executionAttempt: number;
  reason: RecoveryCaseReason;
  operationId: string;
  actorId?: string;
  now?: ClockInput;
  providerWindowMs?: number;
  expectedOriginalReadFence?: OriginalRecoveryReadFence;
}>;

/**
 * A narrow terminal quarantine admission for an already-completed Provider
 * attempt whose local publication or Canvas projection ledger is conflicted.
 * It intentionally has no inspection/read input: this command only records
 * the durable maintenance case after checking the local ledgers in-transaction.
 */
export type RecoveryCasePublicationQuarantineInput = Readonly<{
  taskId: string;
  ownerId: string;
  executionAttempt: number;
  operationId: string;
  actorId?: string;
  now?: ClockInput;
  providerWindowMs?: number;
}>;

export type RecoveryCaseClaimInput = MutationFence & Readonly<{
  takeoverAfterMs?: number;
}>;

export type RecoveryCaseCheckInput = MutationFence & Readonly<{
  outcome: RecoveryCaseCheckOutcome;
  phase?: RecoveryCasePhase;
  evidenceRef?: RecoveryCaseEvidenceReference;
  /** Internal automatic check; does not consume the post-window budget. */
  consumeInspection?: boolean;
}>;

export type RecoveryCaseProgressInput = MutationFence & Readonly<{
  phase: "waiting_provider";
}>;

export type RecoveryCaseInspectionStartInput = MutationFence;

export type RecoveryCaseInspectionStartResult = GenerationRecoveryCaseSnapshot & Readonly<{
  /** False means the same command was already durably consumed; do not re-GET. */
  inspectionStarted: boolean;
}>;

export type RecoveryCaseInspectionFinishInput = MutationFence & Readonly<{
  inspectionLeaseId: string;
  outcome: RecoveryCaseCheckOutcome;
  phase?: RecoveryCasePhase;
  evidenceRef?: RecoveryCaseEvidenceReference;
  retryAfterAt?: ClockInput;
}>;

export type RecoveryCaseAcknowledgeInput = MutationFence & Readonly<{
  expectedProgressVersion: number;
}>;

export type RecoveryCaseCloseInput = MutationFence;

export type RecoveryCaseListInput = Readonly<{
  ownerId?: string;
  phases?: readonly RecoveryCasePhase[];
  dueOnly?: boolean;
  now?: ClockInput;
  limit?: number;
  cursor?: string;
  /** Admin-only stable priority order; the default event order is unchanged. */
  order?: "event" | "admin";
}>;

export type RecoveryCaseStoreOptions = Readonly<{
  /** Additive maintenance is disabled unless the caller opts in explicitly. */
  enabled?: boolean;
  ownerGuard?: TransactionScopedCommand<string, boolean>;
  adminGuard?: TransactionScopedCommand<string, boolean>;
}>;

type RecoveryTaskRow = Readonly<{
  id: string;
  owner_id: string | null;
  canvas_id: string;
  node_id: string;
  kind: string;
  state: string;
  error_code: string | null;
  attempt: number;
  created_at: string;
  updated_at: string;
  provider_profile_id: string | null;
  provider_model_id: string | null;
  credential_revision: number;
  provider_task_id: string | null;
  result_asset_id: string | null;
  result_text: string | null;
}>;

type RecoveryEventRow = Readonly<{
  id: number;
  task_id: string;
  state: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}>;

type AdminRecoveryCandidateRow = RecoveryEventRow & Readonly<{
  case_id: string | null;
  execution_attempt: number | null;
  admin_priority: number;
  admin_opened_at_ms: number;
}>;

type ParsedCaseEvent = Readonly<{
  row: RecoveryEventRow;
  payload: RecoveryCaseEventPayload;
}>;

type ParsedMarkerEvent = Readonly<{
  row: RecoveryEventRow;
  marker: RecoveryOriginalOnlyMarker;
}>;

type Cursor = Readonly<{
  version: 1;
  afterEventId: number;
  snapshotEventId: number;
  /** Present only for the administrator priority cursor. */
  order?: "admin";
  adminNow?: string;
  adminPriority?: number;
  adminOpenedAtMs?: number;
  adminEventId?: number;
}>;

function fail(code: GenerationRecoveryCaseErrorCode, message: string): never {
  throw new GenerationRecoveryCaseError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("RECOVERY_CASE_CORRUPT", "维护事件包含未登记字段");
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("RECOVERY_CASE_CORRUPT", `维护事件缺少字段:${key}`);
    }
  }
}

function assertIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("RECOVERY_INVALID_COMMAND", `${label}无效`);
  }
  return value;
}

function assertHash(value: unknown, label: string) {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    fail("RECOVERY_INVALID_COMMAND", `${label}无效`);
  }
  return value;
}

function assertTimestamp(value: unknown, label: string) {
  return parseTimestamp(value, label);
}

function assertJsonIdentifier(value: unknown, label: string) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("RECOVERY_CASE_CORRUPT", `维护事件${label}无效`);
  }
  return value;
}

function parseTimestamp(value: unknown, label: string, corrupt = false) {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) {
    fail(
      corrupt ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND",
      `${label}无效`,
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    fail(
      corrupt ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND",
      `${label}无效`,
    );
  }
  return value;
}

function nowIso(value: ClockInput, fallback = new Date()): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail("RECOVERY_INVALID_COMMAND", "时间无效");
    return value.toISOString();
  }
  if (value !== undefined) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) fail("RECOVERY_INVALID_COMMAND", "时间无效");
    return new Date(parsed).toISOString();
  }
  return fallback.toISOString();
}

function timestampMilliseconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail("RECOVERY_CASE_CORRUPT", "维护时间无效");
  return milliseconds;
}

function assertSafePositiveInteger(value: unknown, label: string, corrupt = false) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(
      corrupt ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND",
      `${label}无效`,
    );
  }
  return Number(value);
}

function assertSafeNonNegativeInteger(value: unknown, label: string, corrupt = false) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    fail(
      corrupt ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND",
      `${label}无效`,
    );
  }
  return Number(value);
}

function assertEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
  corrupt = false,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(
      corrupt ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND",
      `${label}无效`,
    );
  }
  return value as T;
}

function assertEvidenceReference(
  value: unknown,
  corrupt = false,
): RecoveryCaseEvidenceReference {
  if (!isPlainObject(value)) {
    fail(
      corrupt ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND",
      "证据引用无效",
    );
  }
  exactKeys(value, ["kind"], ["eventId", "sha256"]);
  const kind = assertEnum(
    value.kind,
    ["none", "task_event", "provider_usage", "provider_task"] as const,
    "证据引用类型",
    corrupt,
  );
  if (kind === "none" && (Object.hasOwn(value, "eventId") || Object.hasOwn(value, "sha256"))) {
    fail("RECOVERY_CASE_CORRUPT", "空证据引用不能携带内容");
  }
  const result: RecoveryCaseEvidenceReference = {
    kind,
    ...(Object.hasOwn(value, "eventId")
      ? { eventId: assertSafePositiveInteger(value.eventId, "证据事件", corrupt) }
      : {}),
    ...(Object.hasOwn(value, "sha256")
      ? {
          sha256: typeof value.sha256 === "string" && hashPattern.test(value.sha256)
            ? value.sha256
            : fail(
              corrupt ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND",
              "证据摘要无效",
            ),
        }
      : {}),
  };
  return result;
}

function parseCasePayload(
  row: RecoveryEventRow,
): RecoveryCaseEventPayload {
  if (row.error_code !== recoveryCaseEventCode || typeof row.error_message !== "string") {
    fail("RECOVERY_CASE_CORRUPT", "维护事件编码或内容无效");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.error_message);
  } catch {
    fail("RECOVERY_CASE_CORRUPT", "维护事件JSON无效");
  }
  if (!isPlainObject(decoded)) fail("RECOVERY_CASE_CORRUPT", "维护事件必须是对象");
  exactKeys(
    decoded,
    [
      "version",
      "event",
      "caseId",
      "taskId",
      "executionAttempt",
      "ownerId",
      "phase",
      "reason",
      "caseRevision",
      "operationId",
      "actorId",
      "checkCount",
      "inspectionUsed",
      "progressVersion",
      "readVersion",
      "lastReadProgressVersion",
    ],
    [
      "checkOutcome",
      "attemptStartedAt",
      "providerWindowMs",
      "automaticDeadlineAt",
      "lastCheckedAt",
      "nextCheckAt",
      "inspectionStartedAt",
      "inspectionDeadlineAt",
      "inspectionLeaseId",
      "inspectionLeaseUntil",
      "claimedAt",
      "claimedBy",
      "claimLeaseId",
      "claimLeaseUntil",
      "progressAt",
      "closedAt",
      "evidenceRef",
    ],
  );
  const version = assertSafePositiveInteger(decoded.version, "事件版本", true);
  if (version !== recoveryCaseVersion) fail("RECOVERY_CASE_CORRUPT", "维护事件版本不支持");
  const event = assertEnum(decoded.event, recoveryCaseEventKinds, "事件类型", true);
  const phase = assertEnum(decoded.phase, recoveryCasePhases, "处理阶段", true);
  const reason = assertEnum(decoded.reason, recoveryCaseReasons, "维护原因", true);
  const executionAttempt = assertSafePositiveInteger(decoded.executionAttempt, "执行尝试", true);
  const caseRevision = assertSafePositiveInteger(decoded.caseRevision, "维护版本", true);
  const checkCount = assertSafeNonNegativeInteger(decoded.checkCount, "检查次数", true);
  const inspectionUsed = assertSafeNonNegativeInteger(decoded.inspectionUsed, "外查次数", true);
  if (inspectionUsed > maximumInspectionUses) fail("RECOVERY_CASE_CORRUPT", "外查次数超过上限");
  const progressVersion = assertSafeNonNegativeInteger(decoded.progressVersion, "进度版本", true);
  const readVersion = assertSafeNonNegativeInteger(decoded.readVersion, "读取版本", true);
  const lastReadProgressVersion = assertSafeNonNegativeInteger(decoded.lastReadProgressVersion, "最近已读进度版本", true);
  if (lastReadProgressVersion > progressVersion) fail("RECOVERY_CASE_CORRUPT", "已读进度版本超过当前进度");
  const hasAttemptTiming = ["attemptStartedAt", "providerWindowMs", "automaticDeadlineAt"]
    .every((key) => Object.hasOwn(decoded, key));
  const hasPartialAttemptTiming = ["attemptStartedAt", "providerWindowMs", "automaticDeadlineAt"]
    .some((key) => Object.hasOwn(decoded, key));
  if (hasPartialAttemptTiming && !hasAttemptTiming) {
    fail("RECOVERY_CASE_CORRUPT", "attempt时间字段不完整");
  }
  if (reason === "missing_attempt_evidence" && hasAttemptTiming) {
    fail("RECOVERY_CASE_CORRUPT", "缺少attempt证据的事项不能伪造时间预算");
  }
  if (reason !== "missing_attempt_evidence" && !hasAttemptTiming) {
    fail("RECOVERY_CASE_CORRUPT", "普通维护事项缺少attempt时间预算");
  }
  const attemptStartedAt = hasAttemptTiming
    ? parseTimestamp(decoded.attemptStartedAt, "attempt开始时间", true)
    : undefined;
  const providerWindowMs = hasAttemptTiming
    ? assertSafePositiveInteger(decoded.providerWindowMs, "Provider窗口", true)
    : undefined;
  if (providerWindowMs !== undefined && providerWindowMs > maximumProviderWindowMs) {
    fail("RECOVERY_CASE_CORRUPT", "Provider窗口超过上限");
  }
  const automaticDeadlineAt = hasAttemptTiming
    ? parseTimestamp(decoded.automaticDeadlineAt, "自动截止时间", true)
    : undefined;
  if (automaticDeadlineAt && attemptStartedAt &&
      timestampMilliseconds(automaticDeadlineAt) < timestampMilliseconds(attemptStartedAt)) {
    fail("RECOVERY_CASE_CORRUPT", "自动截止时间早于attempt开始");
  }
  const payload: RecoveryCaseEventPayload = {
    version: recoveryCaseVersion,
    event,
    caseId: assertJsonIdentifier(decoded.caseId, "caseId"),
    taskId: assertJsonIdentifier(decoded.taskId, "taskId"),
    executionAttempt,
    ownerId: assertJsonIdentifier(decoded.ownerId, "ownerId"),
    phase,
    reason,
    caseRevision,
    operationId: assertJsonIdentifier(decoded.operationId, "operationId"),
    actorId: assertJsonIdentifier(decoded.actorId, "actorId"),
    ...(attemptStartedAt ? { attemptStartedAt } : {}),
    ...(providerWindowMs !== undefined ? { providerWindowMs } : {}),
    ...(automaticDeadlineAt ? { automaticDeadlineAt } : {}),
    checkCount,
    inspectionUsed,
    progressVersion,
    readVersion,
    lastReadProgressVersion,
    ...(Object.hasOwn(decoded, "checkOutcome")
      ? { checkOutcome: assertEnum(decoded.checkOutcome, recoveryCaseCheckOutcomes, "检查结果", true) }
      : {}),
    ...(Object.hasOwn(decoded, "lastCheckedAt")
      ? { lastCheckedAt: parseTimestamp(decoded.lastCheckedAt, "最近检查时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "nextCheckAt")
      ? { nextCheckAt: parseTimestamp(decoded.nextCheckAt, "下次检查时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "inspectionStartedAt")
      ? { inspectionStartedAt: parseTimestamp(decoded.inspectionStartedAt, "检查开始时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "inspectionDeadlineAt")
      ? { inspectionDeadlineAt: parseTimestamp(decoded.inspectionDeadlineAt, "检查截止时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "inspectionLeaseId")
      ? { inspectionLeaseId: assertJsonIdentifier(decoded.inspectionLeaseId, "外查租约") }
      : {}),
    ...(Object.hasOwn(decoded, "inspectionLeaseUntil")
      ? { inspectionLeaseUntil: parseTimestamp(decoded.inspectionLeaseUntil, "外查租约截止时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "claimedAt")
      ? { claimedAt: parseTimestamp(decoded.claimedAt, "认领时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "claimedBy")
      ? { claimedBy: assertJsonIdentifier(decoded.claimedBy, "认领人") }
      : {}),
    ...(Object.hasOwn(decoded, "claimLeaseId")
      ? { claimLeaseId: assertJsonIdentifier(decoded.claimLeaseId, "认领租约") }
      : {}),
    ...(Object.hasOwn(decoded, "claimLeaseUntil")
      ? { claimLeaseUntil: parseTimestamp(decoded.claimLeaseUntil, "认领租约截止时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "progressAt")
      ? { progressAt: parseTimestamp(decoded.progressAt, "进度时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "closedAt")
      ? { closedAt: parseTimestamp(decoded.closedAt, "关闭时间", true) }
      : {}),
    ...(Object.hasOwn(decoded, "evidenceRef")
      ? { evidenceRef: assertEvidenceReference(decoded.evidenceRef, true) }
      : {}),
  };
  if (event === "closed" && !payload.closedAt) fail("RECOVERY_CASE_CORRUPT", "关闭事件缺少关闭时间");
  if (payload.claimedBy && !payload.claimedAt) fail("RECOVERY_CASE_CORRUPT", "认领人缺少认领时间");
  if (payload.claimLeaseId && !payload.claimLeaseUntil) fail("RECOVERY_CASE_CORRUPT", "认领租约缺少截止时间");
  if (payload.inspectionLeaseId && !payload.inspectionLeaseUntil) fail("RECOVERY_CASE_CORRUPT", "外查租约缺少截止时间");
  if (payload.inspectionDeadlineAt && !payload.inspectionStartedAt) fail("RECOVERY_CASE_CORRUPT", "外查截止时间缺少会话开始时间");
  if (payload.inspectionDeadlineAt && payload.inspectionStartedAt &&
      timestampMilliseconds(payload.inspectionDeadlineAt) < timestampMilliseconds(payload.inspectionStartedAt)) {
    fail("RECOVERY_CASE_CORRUPT", "外查截止时间早于会话开始");
  }
  if (payload.reason === "missing_attempt_evidence" && (
    payload.checkCount !== 0 ||
    payload.inspectionUsed !== 0 ||
    payload.checkOutcome !== "not_checked" ||
    payload.nextCheckAt !== undefined ||
    payload.inspectionStartedAt !== undefined ||
    payload.inspectionDeadlineAt !== undefined ||
    payload.inspectionLeaseId !== undefined
  )) {
    fail("RECOVERY_CASE_CORRUPT", "证据不足事项不能持有查询预算");
  }
  if (payload.phase === "ready_for_user" &&
      payload.checkOutcome !== "result_found" &&
      payload.checkOutcome !== "terminal_verified") {
    fail("RECOVERY_CASE_CORRUPT", "没有结果证据不能进入待用户确认");
  }
  assertCaseEventSemantics(payload);
  return payload;
}

function parseOriginalOnlyMarker(row: RecoveryEventRow): RecoveryOriginalOnlyMarker {
  if (row.error_code !== recoveryOriginalOnlyEventCode || typeof row.error_message !== "string") {
    fail("RECOVERY_CASE_CORRUPT", "原任务保护事件编码或内容无效");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.error_message);
  } catch {
    fail("RECOVERY_CASE_CORRUPT", "原任务保护事件JSON无效");
  }
  if (!isPlainObject(decoded)) fail("RECOVERY_CASE_CORRUPT", "原任务保护事件必须是对象");
  exactKeys(decoded, ["version", "marker", "caseId", "taskId", "executionAttempt", "ownerId", "operationId"]);
  if (decoded.version !== recoveryCaseVersion || decoded.marker !== "original-only") {
    fail("RECOVERY_CASE_CORRUPT", "原任务保护事件版本不支持");
  }
  return {
    version: recoveryCaseVersion,
    marker: "original-only",
    caseId: assertJsonIdentifier(decoded.caseId, "caseId"),
    taskId: assertJsonIdentifier(decoded.taskId, "taskId"),
    executionAttempt: assertSafePositiveInteger(decoded.executionAttempt, "执行尝试", true),
    ownerId: assertJsonIdentifier(decoded.ownerId, "ownerId"),
    operationId: assertJsonIdentifier(decoded.operationId, "operationId"),
  };
}

function assertTaskState(value: unknown, label: string, corrupt = false): RecoveryTaskState {
  return assertEnum(value, recoveryTaskStates, label, corrupt);
}

function taskSummary(row: RecoveryTaskRow): RecoveryCaseTaskSummary {
  if (
    typeof row.owner_id !== "string" || !identifierPattern.test(row.owner_id) ||
    !identifierPattern.test(row.id) || !identifierPattern.test(row.canvas_id) ||
    !identifierPattern.test(row.node_id) || !isGenerationCapabilityKind(row.kind) ||
    !Number.isSafeInteger(row.attempt) || row.attempt < 0
  ) {
    fail("RECOVERY_CASE_CORRUPT", "生成任务身份字段无效");
  }
  const state = assertTaskState(row.state, "生成任务状态", true);
  const createdAt = parseTimestamp(row.created_at, "任务创建时间", true);
  const updatedAt = parseTimestamp(row.updated_at, "任务更新时间", true);
  return {
    id: row.id,
    ownerId: row.owner_id,
    canvasId: row.canvas_id,
    nodeId: row.node_id,
    kind: row.kind,
    state,
    attempt: row.attempt,
    createdAt,
    updatedAt,
    ...(typeof row.provider_task_id === "string" && row.provider_task_id
      ? { providerTaskId: row.provider_task_id }
      : {}),
  };
}

function assertCaseTransition(
  from: RecoveryCasePhase,
  to: RecoveryCasePhase,
  allowConflictReopen = false,
) {
  const allowed: Record<RecoveryCasePhase, readonly RecoveryCasePhase[]> = {
    queued: ["queued", "claimed", "waiting_provider", "result_recovered", "ready_for_user"],
    claimed: ["claimed", "waiting_provider", "result_recovered", "ready_for_user"],
    waiting_provider: ["waiting_provider", "claimed", "result_recovered", "ready_for_user"],
    result_recovered: ["result_recovered", "ready_for_user"],
    ready_for_user: ["ready_for_user"],
  };
  if (!allowed[from].includes(to) &&
      !(allowConflictReopen &&
        ["claimed", "waiting_provider", "ready_for_user"].includes(from) &&
        to === "queued")) {
    fail("RECOVERY_CASE_CONFLICT", "维护阶段不能倒退");
  }
}

function isProviderEvidenceConflictEscalation(
  previous: RecoveryCaseEventPayload,
  current: RecoveryCaseEventPayload,
) {
  return current.event === "progressed" &&
    current.phase === "queued" &&
    current.reason === "provider_evidence_conflict" &&
    (previous.reason !== "provider_evidence_conflict" || previous.phase !== "queued");
}

function assertCaseEventSemantics(payload: RecoveryCaseEventPayload) {
  switch (payload.event) {
    case "opened":
      if (payload.caseRevision !== 1 || payload.phase !== "queued" ||
          payload.checkCount !== 0 || payload.checkOutcome !== "not_checked" ||
          payload.inspectionUsed !== 0 || payload.progressVersion !== 0 ||
          payload.readVersion !== 0 || payload.lastReadProgressVersion !== 0 ||
          payload.claimedAt !== undefined || payload.claimedBy !== undefined ||
          payload.claimLeaseId !== undefined || payload.claimLeaseUntil !== undefined ||
          payload.inspectionStartedAt !== undefined || payload.inspectionDeadlineAt !== undefined ||
          payload.inspectionLeaseId !== undefined || payload.inspectionLeaseUntil !== undefined ||
          payload.closedAt !== undefined || payload.evidenceRef !== undefined) {
        fail("RECOVERY_CASE_CORRUPT", "opened事件字段或阶段无效");
      }
      break;
    case "claimed":
      if (payload.phase !== "claimed" || !payload.claimedAt || !payload.claimedBy ||
          !payload.claimLeaseId || !payload.claimLeaseUntil) {
        fail("RECOVERY_CASE_CORRUPT", "claimed事件缺少认领租约");
      }
      break;
    case "checked":
      if (!payload.checkOutcome || payload.checkOutcome === "not_checked" || !payload.lastCheckedAt) {
        fail("RECOVERY_CASE_CORRUPT", "checked事件缺少真实检查结果");
      }
      if (payload.checkOutcome === "result_found") {
        if ((payload.phase !== "result_recovered" && payload.phase !== "ready_for_user") ||
            !payload.evidenceRef || payload.evidenceRef.kind === "none") {
          fail("RECOVERY_CASE_CORRUPT", "结果恢复事件缺少结果阶段或证据");
        }
      } else if (payload.checkOutcome === "terminal_verified") {
        if (payload.phase !== "ready_for_user" ||
            !payload.evidenceRef || payload.evidenceRef.kind === "none") {
          fail("RECOVERY_CASE_CORRUPT", "失败终态核验事件缺少阶段或证据");
        }
      } else if (payload.phase === "ready_for_user") {
        fail("RECOVERY_CASE_CORRUPT", "没有结果证据不能进入待用户确认");
      }
      break;
    case "progressed":
      if (payload.phase === "ready_for_user" || payload.closedAt !== undefined) {
        fail("RECOVERY_CASE_CORRUPT", "progressed事件阶段或关闭字段无效");
      }
      break;
    case "acknowledged":
      break;
    case "closed":
      if (payload.phase !== "ready_for_user" || !payload.closedAt ||
          (payload.checkOutcome !== "result_found" &&
           payload.checkOutcome !== "terminal_verified") ||
          !payload.evidenceRef || payload.evidenceRef.kind === "none") {
        fail("RECOVERY_CASE_CORRUPT", "closed事件必须对应已找回结果");
      }
      break;
  }
}

function assertCaseEventRelation(
  previous: RecoveryCaseEventPayload,
  current: RecoveryCaseEventPayload,
) {
  if (current.event === "opened") {
    fail("RECOVERY_CASE_CORRUPT", "opened事件只能是维护事项首条事件");
  }
  if (current.event === "checked") {
    if (current.checkCount !== previous.checkCount + 1) {
      fail("RECOVERY_CASE_CORRUPT", "检查次数不连续");
    }
    const isTerminalEvidence = current.checkOutcome === "result_found" ||
      current.checkOutcome === "terminal_verified";
    const expectedProgressVersion = previous.progressVersion +
      (isTerminalEvidence || current.phase !== previous.phase ? 1 : 0);
    if (current.progressVersion !== expectedProgressVersion ||
        (!isTerminalEvidence && current.phase !== previous.phase)) {
      fail("RECOVERY_CASE_CORRUPT", "checked事件阶段或进度不连续");
    }
  } else if (current.event === "progressed") {
    const phaseChanged = current.phase !== previous.phase;
    const conflictEscalation = current.reason === "provider_evidence_conflict" &&
      (previous.reason !== "provider_evidence_conflict" || previous.phase !== "queued") &&
      current.phase === "queued";
    // Each distinct, durably recorded contradictory observation is user-visible
    // progress even while the case is already held in the conflict queue. A
    // replay of the same operation never reaches this relation check.
    const conflictProgress = current.reason === "provider_evidence_conflict" &&
      previous.reason === "provider_evidence_conflict" &&
      current.phase === "queued" && previous.phase === "queued";
    if ((phaseChanged && current.phase !== "waiting_provider" && !conflictEscalation) ||
        current.progressVersion !== previous.progressVersion +
          ((phaseChanged || conflictEscalation || conflictProgress) ? 1 : 0) ||
        current.inspectionUsed < previous.inspectionUsed ||
        current.inspectionUsed > previous.inspectionUsed + 1) {
      fail("RECOVERY_CASE_CORRUPT", "progressed事件阶段或预算不连续");
    }
  } else if (current.event === "acknowledged") {
    if (current.phase !== previous.phase ||
        current.progressVersion !== previous.progressVersion ||
        current.readVersion !== previous.readVersion + 1 ||
        current.lastReadProgressVersion < previous.lastReadProgressVersion) {
      fail("RECOVERY_CASE_CORRUPT", "acknowledged事件读取版本不连续");
    }
  } else if (current.event === "closed" && previous.phase !== "ready_for_user") {
    fail("RECOVERY_CASE_CORRUPT", "closed事件前维护事项尚未准备用户确认");
  }
}

function readTask(database: DatabaseSync, taskId: string): RecoveryTaskRow {
  const row = database.prepare(`
    SELECT id, owner_id, canvas_id, node_id, kind, state, attempt,
           error_code, created_at, updated_at, provider_profile_id,
           provider_model_id, credential_revision, provider_task_id,
           result_asset_id, result_text
    FROM generation_tasks
    WHERE id = ?
  `).get(taskId) as RecoveryTaskRow | undefined;
  if (!row) fail("RECOVERY_NOT_FOUND", "生成任务不存在");
  return row;
}

function readTaskEventWatermark(database: DatabaseSync, taskId: string): number {
  const row = database.prepare(`
    SELECT COALESCE(MAX(id), 0) AS watermark
    FROM generation_task_events
    WHERE task_id = ?
  `).get(taskId) as { watermark?: number | bigint } | undefined;
  return Number(row?.watermark ?? 0);
}

type RecoveryProviderAttemptRow = Readonly<{
  execution_attempt: number;
  owner_id: string | null;
  kind: string;
  created_at: string;
  provider_profile_id: string;
  provider_model_id: string;
  credential_revision: number;
  outcome: string;
  provider_task_id: string | null;
  failure_code: string | null;
  finished_at: string | null;
  evidence: string;
}>;

function readProviderAttemptStart(
  database: DatabaseSync,
  task: RecoveryTaskRow,
  executionAttempt: number,
): RecoveryProviderAttemptRow | undefined {
  const attempt = database.prepare(`
    SELECT execution_attempt, owner_id, kind, created_at,
           provider_profile_id, provider_model_id, credential_revision,
           outcome, provider_task_id, failure_code, finished_at, evidence
    FROM generation_provider_attempts
    WHERE task_id = ? AND execution_attempt = ?
  `).get(task.id, executionAttempt) as {
    execution_attempt: number;
    owner_id: string | null;
    kind: string;
    created_at: string;
    provider_profile_id: string;
    provider_model_id: string;
    credential_revision: number;
    outcome: string;
    provider_task_id: string | null;
    failure_code: string | null;
    finished_at: string | null;
    evidence: string;
  } | undefined;
  if (attempt) {
    if (attempt.owner_id === null || attempt.owner_id !== task.owner_id) {
      fail("RECOVERY_CASE_CONFLICT", "Provider attempt所有者不匹配");
    }
    if (attempt.kind !== task.kind) fail("RECOVERY_CASE_CONFLICT", "Provider attempt类型不匹配");
    if (attempt.provider_profile_id !== task.provider_profile_id ||
        attempt.provider_model_id !== task.provider_model_id ||
        attempt.credential_revision !== task.credential_revision ||
        attempt.provider_task_id !== task.provider_task_id) {
      fail("RECOVERY_CASE_CONFLICT", "Provider attempt绑定不匹配");
    }
    parseTimestamp(attempt.created_at, "Provider attempt开始时间", true);
  }
  // A task created_at timestamp is not an attempt receipt.  When the exact
  // provider-attempt row is missing, the caller may only register an
  // evidence-insufficient case; it must not manufacture a new time budget.
  return attempt;
}

function readCaseRows(
  database: DatabaseSync,
  taskId: string,
  asOfEventId?: number,
): RecoveryEventRow[] {
  const rows = asOfEventId === undefined
    ? database.prepare(`
        SELECT id, task_id, state, error_code, error_message, created_at
        FROM generation_task_events
        WHERE task_id = ? AND error_code = ?
        ORDER BY id ASC
        LIMIT ?
      `).all(taskId, recoveryCaseEventCode, maxCaseEventsPerTask + 1) as RecoveryEventRow[]
    : database.prepare(`
        SELECT id, task_id, state, error_code, error_message, created_at
        FROM generation_task_events
        WHERE task_id = ? AND error_code = ? AND id <= ?
        ORDER BY id ASC
        LIMIT ?
      `).all(taskId, recoveryCaseEventCode, asOfEventId, maxCaseEventsPerTask + 1) as RecoveryEventRow[];
  if (rows.length > maxCaseEventsPerTask) fail("RECOVERY_CASE_LIMIT", "维护事件超过单任务上限");
  return rows;
}

function readMarkerRows(database: DatabaseSync, taskId: string): RecoveryEventRow[] {
  return database.prepare(`
    SELECT id, task_id, state, error_code, error_message, created_at
    FROM generation_task_events
    WHERE task_id = ? AND error_code = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(taskId, recoveryOriginalOnlyEventCode, maxCaseEventsPerTask + 1) as RecoveryEventRow[];
}

function validateEventRowState(row: RecoveryEventRow) {
  assertTaskState(row.state, "维护事件任务状态", true);
  if (!Number.isSafeInteger(row.id) || row.id < 1 || row.task_id.length < 1) {
    fail("RECOVERY_CASE_CORRUPT", "维护事件行身份无效");
  }
  parseTimestamp(row.created_at, "维护事件时间", true);
}

function readCaseHistories(database: DatabaseSync, taskId: string, asOfEventId?: number) {
  const groups = new Map<string, ParsedCaseEvent[]>();
  const attempts = new Map<number, string>();
  for (const row of readCaseRows(database, taskId, asOfEventId)) {
    validateEventRowState(row);
    const payload = parseCasePayload(row);
    if (payload.taskId !== taskId) fail("RECOVERY_CASE_CORRUPT", "维护事件taskId不匹配");
    const key = `${payload.caseId}\u0000${payload.executionAttempt}`;
    const priorKey = attempts.get(payload.executionAttempt);
    if (priorKey !== undefined && priorKey !== payload.caseId) {
      fail("RECOVERY_CASE_CORRUPT", "同一attempt存在多个维护事项");
    }
    attempts.set(payload.executionAttempt, payload.caseId);
    const group = groups.get(key) ?? [];
    const previous = group.at(-1)?.payload;
    if (previous) {
      if (previous.caseRevision + 1 !== payload.caseRevision) {
        fail("RECOVERY_CASE_CORRUPT", "维护事件版本不连续");
      }
      const conflictEscalation = payload.reason === "provider_evidence_conflict" &&
        previous.reason !== payload.reason && payload.event === "progressed" &&
        payload.phase === "queued";
      if (previous.ownerId !== payload.ownerId ||
          (previous.reason !== payload.reason && !conflictEscalation)) {
        fail("RECOVERY_CASE_CORRUPT", "维护事件身份或原因发生改变");
      }
      assertCaseTransition(previous.phase, payload.phase,
        isProviderEvidenceConflictEscalation(previous, payload));
      assertCaseEventRelation(previous, payload);
    } else if (payload.caseRevision !== 1 || payload.event !== "opened") {
      fail("RECOVERY_CASE_CORRUPT", "维护事项必须从opened开始");
    }
    group.push({ row, payload });
    groups.set(key, group);
  }
  return groups;
}

function readCaseHistory(
  database: DatabaseSync,
  taskId: string,
  caseId: string,
  executionAttempt: number,
): ParsedCaseEvent[] {
  const group = readCaseHistories(database, taskId).get(`${caseId}\u0000${executionAttempt}`);
  if (!group?.length) fail("RECOVERY_NOT_FOUND", "维护事项不存在");
  return group;
}

function assertTaskOwner(
  database: DatabaseSync,
  task: RecoveryTaskRow,
  ownerId: string,
  ownerGuard: TransactionScopedCommand<string, boolean>,
) {
  if (task.owner_id !== ownerId) fail("RECOVERY_CASE_CONFLICT", "生成任务所有者不匹配");
  if (!executeTransactionScopedCommand(database, ownerGuard, ownerId)) {
    fail("RECOVERY_CASE_OWNER_BLOCKED", "账号不可继续处理维护事项");
  }
}

function assertActor(
  database: DatabaseSync,
  actorId: string,
  adminGuard: TransactionScopedCommand<string, boolean>,
  allowSystem: boolean,
) {
  assertIdentifier(actorId, "处理人");
  if (allowSystem && actorId === generationRecoverySystemActorId) return;
  if (!executeTransactionScopedCommand(database, adminGuard, actorId)) {
    fail("RECOVERY_ADMIN_REQUIRED", "只有有效管理员可以处理维护事项");
  }
}

function writeAuditForMutation(
  database: DatabaseSync,
  actorId: string,
  task: RecoveryTaskRow,
  action: string,
  payload: RecoveryCaseEventPayload,
) {
  if (actorId === generationRecoverySystemActorId) return;
  recordAudit(database, actorId, action, task.owner_id, {
    caseId: payload.caseId,
    taskId: payload.taskId,
    executionAttempt: payload.executionAttempt,
    caseRevision: payload.caseRevision,
    operationId: payload.operationId,
    phase: payload.phase,
    event: payload.event,
  });
}

function encodeCursor(cursor: Cursor): string {
  const value = cursor.order === "admin"
    ? {
      // Keep the administrator cursor short enough for the HTTP query bound;
      // the regular event cursor below remains backward compatible.
      v: 1,
      o: "admin",
      s: cursor.snapshotEventId,
      n: cursor.adminNow,
      p: cursor.adminPriority,
      a: cursor.adminOpenedAtMs,
      e: cursor.adminEventId,
    }
    : cursor;
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | undefined {
  if (value === undefined) return undefined;
  if (value.length < 1 || value.length > 300) fail("RECOVERY_INVALID_COMMAND", "游标无效");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    fail("RECOVERY_INVALID_COMMAND", "游标无效");
  }
  if (isPlainObject(decoded) && decoded.v === 1 && decoded.o === "admin") {
    if (typeof decoded.n !== "string" || decoded.n.length < 20 || decoded.n.length > 40 ||
        !Number.isFinite(Date.parse(decoded.n)) ||
        !Number.isSafeInteger(decoded.s) || Number(decoded.s) < 0 ||
        !Number.isSafeInteger(decoded.p) || Number(decoded.p) < 0 || Number(decoded.p) > 2 ||
        !Number.isSafeInteger(decoded.a) ||
        !Number.isSafeInteger(decoded.e) || Number(decoded.e) < 1) {
      fail("RECOVERY_INVALID_COMMAND", "管理员游标无效");
    }
    return {
      version: 1,
      afterEventId: Number(decoded.e),
      snapshotEventId: Number(decoded.s),
      order: "admin",
      adminNow: nowIso(decoded.n),
      adminPriority: Number(decoded.p),
      adminOpenedAtMs: Number(decoded.a),
      adminEventId: Number(decoded.e),
    };
  }
  // Accept the pre-compression admin shape during a rolling local upgrade.
  if (!isPlainObject(decoded) ||
      decoded.version !== 1 ||
      !Number.isSafeInteger(decoded.afterEventId) || Number(decoded.afterEventId) < 0 ||
      !Number.isSafeInteger(decoded.snapshotEventId) || Number(decoded.snapshotEventId) < 0 ||
      (decoded.order !== undefined && decoded.order !== "admin")) {
    fail("RECOVERY_INVALID_COMMAND", "游标无效");
  }
  if (decoded.order === "admin") {
    if (typeof decoded.adminNow !== "string" || decoded.adminNow.length < 20 || decoded.adminNow.length > 40 ||
        !Number.isFinite(Date.parse(decoded.adminNow)) ||
        !Number.isSafeInteger(decoded.adminPriority) ||
        Number(decoded.adminPriority) < 0 || Number(decoded.adminPriority) > 2 ||
        !Number.isSafeInteger(decoded.adminOpenedAtMs) ||
        !Number.isSafeInteger(decoded.adminEventId) || Number(decoded.adminEventId) < 1 ||
        Number(decoded.afterEventId) !== Number(decoded.adminEventId)) {
      fail("RECOVERY_INVALID_COMMAND", "管理员游标无效");
    }
    return {
      version: 1,
      afterEventId: Number(decoded.afterEventId),
      snapshotEventId: Number(decoded.snapshotEventId),
      order: "admin",
      adminNow: nowIso(decoded.adminNow),
      adminPriority: Number(decoded.adminPriority),
      adminOpenedAtMs: Number(decoded.adminOpenedAtMs),
      adminEventId: Number(decoded.adminEventId),
    };
  }
  return {
    version: 1,
    afterEventId: Number(decoded.afterEventId),
    snapshotEventId: Number(decoded.snapshotEventId),
  };
}

function writeTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export type ProviderEvidenceConflictCaseInput = Readonly<{
  taskId: string;
  ownerId: string;
  caseId: string;
  executionAttempt: number;
  operationId: string;
  actorId: string;
  now: string;
  conflictKind: "fee_disposition" | "evidence_hash" | "provider_state";
  priorReceiptEventId?: number;
  priorReceiptEventCode?: "PROVIDER_FAILURE_CHARGE_SETTLED" | "PROVIDER_FAILURE_NO_CHARGE_SETTLED";
  priorEvidenceSha256?: string;
  incomingEvidenceSha256: string;
  incomingObservedAt: string;
  incomingFeeDisposition: "unknown" | "charged" | "not_charged";
  incomingProviderState: "failed" | "succeeded";
  incomingProviderTaskId: string;
  incomingAdapterId: string;
  incomingProtocolContractId: string;
}>;

export type ProviderEvidenceConflictCaseResult = Readonly<{
  changed: boolean;
  conflictEventId: number;
  caseEventId: number;
}>;

type ProviderEvidenceConflictEventPayload = Readonly<{
  version: 1;
  conflict: "provider_evidence_conflict";
  taskId: string;
  ownerId: string;
  caseId: string;
  executionAttempt: number;
  operationId: string;
  conflictKind: "fee_disposition" | "evidence_hash" | "provider_state";
  priorReceiptEventId?: number;
  priorReceiptEventCode?: "PROVIDER_FAILURE_CHARGE_SETTLED" | "PROVIDER_FAILURE_NO_CHARGE_SETTLED";
  priorEvidenceSha256?: string;
  incomingEvidenceSha256: string;
  incomingObservedAt: string;
  incomingFeeDisposition: "unknown" | "charged" | "not_charged";
  incomingProviderState: "failed" | "succeeded";
  incomingProviderTaskId: string;
  incomingAdapterId: string;
  incomingProtocolContractId: string;
}>;

function providerEvidenceConflictPayload(
  value: unknown,
  persisted = false,
): ProviderEvidenceConflictEventPayload {
  const invalid = (message: string): never => fail(
    persisted ? "RECOVERY_CASE_CORRUPT" : "RECOVERY_INVALID_COMMAND", message,
  );
  const result = isPlainObject(value) ? value : invalid("平台证据冲突记录必须是对象");
  exactKeys(result,
    [
      "version", "conflict", "taskId", "ownerId", "caseId", "executionAttempt",
      "operationId", "conflictKind", "incomingEvidenceSha256", "incomingObservedAt",
      "incomingFeeDisposition", "incomingProviderState", "incomingProviderTaskId",
      "incomingAdapterId", "incomingProtocolContractId",
    ],
    ["priorReceiptEventId", "priorReceiptEventCode", "priorEvidenceSha256"],
  );
  if (result.version !== 1 || result.conflict !== "provider_evidence_conflict") invalid("平台证据冲突记录版本无效");
  const identifier = (key: string) => {
    if (typeof result[key] !== "string" || !identifierPattern.test(result[key] as string)) {
      invalid(`平台证据冲突记录${key}无效`);
    }
    return result[key] as string;
  };
  const executionAttempt = result.executionAttempt;
  if (!Number.isSafeInteger(executionAttempt) || Number(executionAttempt) < 1) invalid("平台证据冲突记录执行尝试无效");
  if (!["fee_disposition", "evidence_hash", "provider_state"].includes(String(result.conflictKind))) {
    invalid("平台证据冲突记录类型无效");
  }
  const incomingEvidenceSha256 = typeof result.incomingEvidenceSha256 === "string"
    ? result.incomingEvidenceSha256
    : invalid("平台证据冲突记录摘要无效");
  if (!hashPattern.test(incomingEvidenceSha256)) {
    invalid("平台证据冲突记录摘要无效");
  }
  if (typeof result.priorEvidenceSha256 === "string" && !hashPattern.test(result.priorEvidenceSha256)) {
    invalid("平台证据冲突原回执摘要无效");
  }
  if (result.priorReceiptEventId !== undefined &&
      (!Number.isSafeInteger(result.priorReceiptEventId) || Number(result.priorReceiptEventId) < 1)) {
    invalid("平台证据冲突原回执事件无效");
  }
  if (result.priorReceiptEventCode !== undefined &&
      !["PROVIDER_FAILURE_CHARGE_SETTLED", "PROVIDER_FAILURE_NO_CHARGE_SETTLED"].includes(String(result.priorReceiptEventCode))) {
    invalid("平台证据冲突原回执编码无效");
  }
  if (result.priorReceiptEventId !== undefined && result.priorReceiptEventCode === undefined) {
    invalid("平台证据冲突原回执编码缺失");
  }
  if (result.priorReceiptEventCode !== undefined && result.priorReceiptEventId === undefined) {
    invalid("平台证据冲突原回执事件缺失");
  }
  const incomingObservedAt = typeof result.incomingObservedAt === "string"
    ? result.incomingObservedAt
    : invalid("平台证据冲突观察时间无效");
  if (!Number.isFinite(Date.parse(incomingObservedAt))) {
    invalid("平台证据冲突观察时间无效");
  }
  const incomingFeeDisposition = result.incomingFeeDisposition;
  const incomingProviderState = result.incomingProviderState;
  if (!["unknown", "charged", "not_charged"].includes(String(incomingFeeDisposition)) ||
      incomingProviderState !== "failed" && incomingProviderState !== "succeeded") {
    invalid("平台证据冲突结论无效");
  }
  return {
    version: 1,
    conflict: "provider_evidence_conflict",
    taskId: identifier("taskId"),
    ownerId: identifier("ownerId"),
    caseId: identifier("caseId"),
    executionAttempt: Number(executionAttempt),
    operationId: identifier("operationId"),
    conflictKind: result.conflictKind as ProviderEvidenceConflictEventPayload["conflictKind"],
    ...(result.priorReceiptEventId !== undefined ? { priorReceiptEventId: Number(result.priorReceiptEventId) } : {}),
    ...(result.priorReceiptEventCode !== undefined
      ? { priorReceiptEventCode: result.priorReceiptEventCode as ProviderEvidenceConflictEventPayload["priorReceiptEventCode"] }
      : {}),
    ...(result.priorEvidenceSha256 !== undefined ? { priorEvidenceSha256: result.priorEvidenceSha256 as string } : {}),
    incomingEvidenceSha256,
    incomingObservedAt,
    incomingFeeDisposition: incomingFeeDisposition as ProviderEvidenceConflictEventPayload["incomingFeeDisposition"],
    incomingProviderState: incomingProviderState as ProviderEvidenceConflictEventPayload["incomingProviderState"],
    incomingProviderTaskId: identifier("incomingProviderTaskId"),
    incomingAdapterId: identifier("incomingAdapterId"),
    incomingProtocolContractId: identifier("incomingProtocolContractId"),
  };
}

function persistedProviderEvidenceConflictPayload(
  value: unknown,
): ProviderEvidenceConflictEventPayload {
  if (typeof value !== "string") {
    fail("RECOVERY_CASE_CORRUPT", "平台证据冲突记录JSON无效");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    fail("RECOVERY_CASE_CORRUPT", "平台证据冲突记录JSON无效");
  }
  return providerEvidenceConflictPayload(decoded, true);
}

/**
 * Append a verified post-settlement platform conflict and move its existing
 * case back to the maintenance queue. The caller must already own an active
 * BEGIN IMMEDIATE transaction; this helper never changes the generation task,
 * attempt, result or Provider ledger.
 */
export function appendProviderEvidenceConflictCaseInTransaction(
  database: DatabaseSync,
  input: ProviderEvidenceConflictCaseInput,
): ProviderEvidenceConflictCaseResult {
  if (!database.isTransaction) throw new Error("平台证据冲突登记必须在事务中执行");
  assertIdentifier(input.taskId, "taskId");
  assertIdentifier(input.ownerId, "ownerId");
  assertIdentifier(input.caseId, "caseId");
  assertSafePositiveInteger(input.executionAttempt, "执行尝试");
  assertIdentifier(input.operationId, "operationId");
  assertIdentifier(input.actorId, "处理人");
  parseTimestamp(input.now, "平台证据冲突登记时间");
  assertHash(input.incomingEvidenceSha256, "平台证据冲突摘要");
  assertTimestamp(input.incomingObservedAt, "平台证据冲突观察时间");
  assertIdentifier(input.incomingProviderTaskId, "Provider任务ID");
  assertIdentifier(input.incomingAdapterId, "适配器");
  assertIdentifier(input.incomingProtocolContractId, "协议合同");
  if (input.priorEvidenceSha256 !== undefined) assertHash(input.priorEvidenceSha256, "原回执摘要");
  if (input.priorReceiptEventId !== undefined) assertSafePositiveInteger(input.priorReceiptEventId, "原回执事件");
  if (input.priorReceiptEventId !== undefined && input.priorReceiptEventCode === undefined) {
    fail("RECOVERY_INVALID_COMMAND", "原回执编码缺失");
  }
  if (input.priorReceiptEventCode !== undefined && input.priorReceiptEventId === undefined) {
    fail("RECOVERY_INVALID_COMMAND", "原回执事件缺失");
  }

  const task = readTask(database, input.taskId);
  if (task.owner_id !== input.ownerId || task.attempt !== input.executionAttempt) {
    fail("RECOVERY_CASE_CONFLICT", "平台证据冲突任务身份已变化");
  }
  const history = readCaseHistory(database, task.id, input.caseId, input.executionAttempt);
  const latest = historyLatest(history);
  const rows = database.prepare(`
    SELECT id, error_message
    FROM generation_task_events
    WHERE task_id = ? AND error_code = ?
    ORDER BY id ASC
  `).all(task.id, providerEvidenceConflictEventCode) as Array<{ id: number; error_message: string | null }>;
  const existing = rows.find((row) => {
    const payload = persistedProviderEvidenceConflictPayload(row.error_message);
    if (payload.taskId !== input.taskId || payload.ownerId !== input.ownerId ||
        payload.caseId !== input.caseId || payload.executionAttempt !== input.executionAttempt) {
      fail("RECOVERY_CASE_CORRUPT", "平台证据冲突记录身份不匹配");
    }
    return payload.operationId === input.operationId;
  });
  if (existing) {
    const payload = persistedProviderEvidenceConflictPayload(existing.error_message);
    const expected = providerEvidenceConflictPayload({
      version: 1,
      conflict: "provider_evidence_conflict",
      taskId: input.taskId,
      ownerId: input.ownerId,
      caseId: input.caseId,
      executionAttempt: input.executionAttempt,
      operationId: input.operationId,
      conflictKind: input.conflictKind,
      ...(input.priorReceiptEventId !== undefined ? { priorReceiptEventId: input.priorReceiptEventId } : {}),
      ...(input.priorReceiptEventCode !== undefined ? { priorReceiptEventCode: input.priorReceiptEventCode } : {}),
      ...(input.priorEvidenceSha256 !== undefined ? { priorEvidenceSha256: input.priorEvidenceSha256 } : {}),
      incomingEvidenceSha256: input.incomingEvidenceSha256,
      incomingObservedAt: input.incomingObservedAt,
      incomingFeeDisposition: input.incomingFeeDisposition,
      incomingProviderState: input.incomingProviderState,
      incomingProviderTaskId: input.incomingProviderTaskId,
      incomingAdapterId: input.incomingAdapterId,
      incomingProtocolContractId: input.incomingProtocolContractId,
    }, false);
    if (JSON.stringify(payload) !== JSON.stringify(expected)) {
      fail("RECOVERY_CASE_CONFLICT", "相同命令ID对应了不同的平台冲突证据");
    }
    if (latest.payload.reason !== "provider_evidence_conflict" || latest.payload.phase !== "queued") {
      fail("RECOVERY_CASE_CONFLICT", "平台证据冲突记录与维护事项状态不一致");
    }
    return { changed: false, conflictEventId: Number(existing.id), caseEventId: latest.row.id };
  }

  const conflictPayload = providerEvidenceConflictPayload({
    version: 1,
    conflict: "provider_evidence_conflict",
    taskId: input.taskId,
    ownerId: input.ownerId,
    caseId: input.caseId,
    executionAttempt: input.executionAttempt,
    operationId: input.operationId,
    conflictKind: input.conflictKind,
    ...(input.priorReceiptEventId !== undefined ? { priorReceiptEventId: input.priorReceiptEventId } : {}),
    ...(input.priorReceiptEventCode !== undefined ? { priorReceiptEventCode: input.priorReceiptEventCode } : {}),
    ...(input.priorEvidenceSha256 !== undefined ? { priorEvidenceSha256: input.priorEvidenceSha256 } : {}),
    incomingEvidenceSha256: input.incomingEvidenceSha256,
    incomingObservedAt: input.incomingObservedAt,
    incomingFeeDisposition: input.incomingFeeDisposition,
    incomingProviderState: input.incomingProviderState,
    incomingProviderTaskId: input.incomingProviderTaskId,
    incomingAdapterId: input.incomingAdapterId,
    incomingProtocolContractId: input.incomingProtocolContractId,
  });
  const conflictEvent = database.prepare(`
    INSERT INTO generation_task_events(task_id, state, error_code, error_message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(task.id, task.state, providerEvidenceConflictEventCode,
    JSON.stringify(conflictPayload), input.now);

  assertCaseTransition(latest.payload.phase, "queued", isProviderEvidenceConflictEscalation({
    ...latest.payload,
  }, {
    ...latest.payload,
    event: "progressed",
    phase: "queued",
    reason: "provider_evidence_conflict",
  }));
  // A new conflict operation must wake the owner even when an earlier conflict
  // already put this case in the queued maintenance state. Exact operation
  // replay returned above remains unchanged and does not create another event.
  const progressVersion = latest.payload.progressVersion + 1;
  const casePayload = buildMutationPayload(latest.payload, {
    event: "progressed",
    phase: "queued",
    reason: "provider_evidence_conflict",
    operationId: input.operationId,
    actorId: input.actorId,
    progressVersion,
    progressAt: input.now,
    nextCheckAt: undefined,
    inspectionLeaseId: undefined,
    inspectionLeaseUntil: undefined,
    claimedAt: undefined,
    claimedBy: undefined,
    claimLeaseId: undefined,
    claimLeaseUntil: undefined,
    closedAt: undefined,
  });
  const caseEventId = insertCaseEvent(database, task, casePayload, input.now);
  // Keep the already approved case audit namespace so admin detail can expose
  // the transition without widening the public audit DTO or storing evidence.
  // The automatic actor is deliberately not a users row, so it must follow the
  // same skip rule as the ordinary case mutations instead of violating the
  // admin_audit_events foreign key and rolling back the durable quarantine.
  if (input.actorId !== generationRecoverySystemActorId) {
    recordAudit(database, input.actorId, recoveryCaseActionNames.progressed, task.owner_id, {
      caseId: casePayload.caseId,
      taskId: casePayload.taskId,
      executionAttempt: casePayload.executionAttempt,
      caseRevision: casePayload.caseRevision,
      operationId: casePayload.operationId,
      phase: casePayload.phase,
      event: casePayload.event,
      conflictEventId: Number(conflictEvent.lastInsertRowid),
    });
  }
  return {
    changed: true,
    conflictEventId: Number(conflictEvent.lastInsertRowid),
    caseEventId,
  };
}

function checkWriteEnabled(enabled: boolean) {
  if (!enabled) fail("RECOVERY_DISABLED", "生成维护功能未启用");
}

function checkOperationId(operationId: string) {
  return assertIdentifier(operationId, "操作ID");
}

function readTaskForMutation(
  database: DatabaseSync,
  taskId: string,
  ownerId: string,
  ownerGuard: TransactionScopedCommand<string, boolean>,
): RecoveryTaskRow {
  const task = readTask(database, taskId);
  taskSummary(task);
  assertTaskOwner(database, task, ownerId, ownerGuard);
  return task;
}

function assertFence(
  latest: ParsedCaseEvent,
  fence: MutationFence,
  watermark: number,
) {
  if (
    latest.row.id !== fence.expectedCaseEventId ||
    latest.payload.caseRevision !== fence.expectedCaseRevision ||
    (fence.expectedTaskEventWatermark !== undefined &&
      fence.expectedTaskEventWatermark !== watermark)
  ) {
    fail("RECOVERY_CASE_CONFLICT", "维护事项已被其他操作更新");
  }
}

function findOperation(
  history: readonly ParsedCaseEvent[],
  operationId: string,
) {
  return history.some(({ payload }) => payload.operationId === operationId);
}

function makeCaseId(taskId: string, executionAttempt: number) {
  void taskId;
  void executionAttempt;
  const value = `recovery-case:${randomUUID().replaceAll("-", "")}`;
  assertIdentifier(value, "caseId");
  return value;
}

function addMilliseconds(iso: string, amount: number): string {
  const milliseconds = timestampMilliseconds(iso);
  const next = milliseconds + amount;
  if (!Number.isSafeInteger(next)) fail("RECOVERY_INVALID_COMMAND", "维护时间超出范围");
  return new Date(next).toISOString();
}

function validateProviderWindow(kind: string, supplied: number | undefined) {
  const defaultValue = kind === "video"
    ? defaultVideoProviderWindowMs
    : defaultOtherProviderWindowMs;
  const value = supplied ?? defaultValue;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumProviderWindowMs) {
    fail("RECOVERY_INVALID_COMMAND", "Provider窗口无效");
  }
  return value;
}

function nextBackoffMs(checkCount: number): number {
  const exponent = Math.min(Math.max(checkCount - 1, 0), 8);
  return Math.min(15 * 60 * 1_000, 30 * 1_000 * (2 ** exponent));
}

function readCaseOpenedAt(
  database: DatabaseSync,
  latest: ParsedCaseEvent,
): string {
  const row = database.prepare(`
    SELECT created_at
    FROM generation_task_events
    WHERE task_id = ? AND error_code = ? AND id <= ?
      AND json_extract(
        CASE WHEN json_valid(error_message) THEN error_message ELSE '{}' END,
        '$.caseId'
      ) = ?
      AND json_extract(
        CASE WHEN json_valid(error_message) THEN error_message ELSE '{}' END,
        '$.executionAttempt'
      ) = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(
    latest.row.task_id,
    recoveryCaseEventCode,
    latest.row.id,
    latest.payload.caseId,
    latest.payload.executionAttempt,
  ) as { created_at?: string } | undefined;
  return parseTimestamp(row?.created_at, "维护事项打开时间", true);
}

function buildSnapshot(
  database: DatabaseSync,
  task: RecoveryTaskRow,
  latest: ParsedCaseEvent,
): GenerationRecoveryCaseSnapshot {
  const payload = latest.payload;
  if (payload.taskId !== task.id || payload.ownerId !== task.owner_id) {
    fail("RECOVERY_CASE_CORRUPT", "维护事项与任务身份不匹配");
  }
  return {
    caseId: payload.caseId,
    taskId: payload.taskId,
    ownerId: payload.ownerId,
    executionAttempt: payload.executionAttempt,
    openedAt: readCaseOpenedAt(database, latest),
    phase: payload.phase,
    reason: payload.reason,
    caseRevision: payload.caseRevision,
    eventId: latest.row.id,
    taskEventWatermark: readTaskEventWatermark(database, task.id),
    task: taskSummary(task),
    ...(payload.attemptStartedAt ? { attemptStartedAt: payload.attemptStartedAt } : {}),
    ...(payload.providerWindowMs !== undefined ? { providerWindowMs: payload.providerWindowMs } : {}),
    ...(payload.automaticDeadlineAt ? { automaticDeadlineAt: payload.automaticDeadlineAt } : {}),
    checkCount: payload.checkCount,
    inspectionUsed: payload.inspectionUsed,
    progressVersion: payload.progressVersion,
    readVersion: payload.readVersion,
    lastReadProgressVersion: payload.lastReadProgressVersion,
    ...(payload.checkOutcome ? { checkOutcome: payload.checkOutcome } : {}),
    ...(payload.lastCheckedAt ? { lastCheckedAt: payload.lastCheckedAt } : {}),
    ...(payload.nextCheckAt ? { nextCheckAt: payload.nextCheckAt } : {}),
    ...(payload.inspectionStartedAt ? { inspectionStartedAt: payload.inspectionStartedAt } : {}),
    ...(payload.inspectionDeadlineAt ? { inspectionDeadlineAt: payload.inspectionDeadlineAt } : {}),
    ...(payload.inspectionLeaseId ? { inspectionLeaseId: payload.inspectionLeaseId } : {}),
    ...(payload.inspectionLeaseUntil ? { inspectionLeaseUntil: payload.inspectionLeaseUntil } : {}),
    ...(payload.claimedAt ? { claimedAt: payload.claimedAt } : {}),
    ...(payload.claimedBy ? { claimedBy: payload.claimedBy } : {}),
    ...(payload.claimLeaseId ? { claimLeaseId: payload.claimLeaseId } : {}),
    ...(payload.claimLeaseUntil ? { claimLeaseUntil: payload.claimLeaseUntil } : {}),
    ...(payload.progressAt ? { progressAt: payload.progressAt } : {}),
    ...(payload.closedAt ? { closedAt: payload.closedAt } : {}),
    ...(payload.evidenceRef ? { evidenceRef: payload.evidenceRef } : {}),
  };
}

function insertCaseEvent(
  database: DatabaseSync,
  task: RecoveryTaskRow,
  payload: RecoveryCaseEventPayload,
  createdAt: string,
): number {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, "utf8") > maxEventMessageBytes) {
    fail("RECOVERY_INVALID_COMMAND", "维护事件超过大小上限");
  }
  const result = database.prepare(`
    INSERT INTO generation_task_events (
      task_id, state, error_code, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(task.id, task.state, recoveryCaseEventCode, encoded, createdAt);
  return Number(result.lastInsertRowid);
}

function copyPayload(
  payload: RecoveryCaseEventPayload,
  changes: Partial<RecoveryCaseEventPayload>,
): RecoveryCaseEventPayload {
  return { ...payload, ...changes };
}

function buildMutationPayload(
  previous: RecoveryCaseEventPayload,
  changes: Partial<RecoveryCaseEventPayload> & Pick<RecoveryCaseEventPayload, "event" | "phase" | "operationId" | "actorId">,
): RecoveryCaseEventPayload {
  const result = copyPayload(previous, {
    ...changes,
    caseRevision: previous.caseRevision + 1,
  });
  // Re-run the same strict checks used for persisted data before writing.
  const fakeRow: RecoveryEventRow = {
    id: 1,
    task_id: result.taskId,
    state: "recovering",
    error_code: recoveryCaseEventCode,
    error_message: JSON.stringify(result),
    created_at: result.progressAt ?? result.lastCheckedAt ?? result.attemptStartedAt ?? new Date(0).toISOString(),
  };
  const parsed = parseCasePayload(fakeRow);
  assertCaseEventRelation(previous, parsed);
  return parsed;
}

function readTaskTerminalEvent(
  database: DatabaseSync,
  taskId: string,
  state: "success" | "failed",
): number {
  const row = database.prepare(`
    SELECT id
    FROM generation_task_events
    WHERE task_id = ? AND state = ? AND (error_code IS NULL OR error_code <> ?)
    ORDER BY id DESC
    LIMIT 1
  `).get(taskId, state, recoveryCaseEventCode) as { id?: number | bigint } | undefined;
  const eventId = Number(row?.id ?? 0);
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    fail("RECOVERY_CASE_CONFLICT", `任务缺少可核验的${state}终态事件`);
  }
  return eventId;
}

function historyLatest(history: readonly ParsedCaseEvent[]): ParsedCaseEvent {
  const latest = history.at(-1);
  if (!latest) fail("RECOVERY_NOT_FOUND", "维护事项不存在");
  return latest;
}

function buildStore(
  database: DatabaseSync,
  options: RecoveryCaseStoreOptions,
) {
  const enabled = options.enabled ?? generationRecoveryCasesEnabled();
  const ownerGuard = options.ownerGuard ?? accountAllowsDurableMediaReferenceCommand;
  const adminGuard = options.adminGuard ?? isActiveGenerationRecoveryAdminCommand;

  function ensureCase(input: RecoveryCaseOpenInput): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const reason = assertEnum(input.reason, recoveryCaseReasons, "维护原因");
    const actorId = input.actorId ?? generationRecoverySystemActorId;
    const createdAt = nowIso(input.now);
    return writeTransaction(database, () => {
      if (input.expectedOriginalReadFence) {
        if (input.expectedOriginalReadFence.taskId !== taskId) fail("RECOVERY_INVALID_COMMAND", "原请求身份不匹配");
        assertOriginalRecoveryReadFence(database, input.expectedOriginalReadFence);
      }
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      if (actorId !== generationRecoverySystemActorId) {
        assertActor(database, actorId, adminGuard, false);
      }
      if (executionAttempt !== task.attempt) {
        fail("RECOVERY_CASE_CONFLICT", "只能登记生成任务当前执行尝试的维护事项");
      }
      if (task.state !== "failed" && task.state !== "recovering") {
        fail("RECOVERY_CASE_CONFLICT", "只有失败或恢复中的任务才能登记维护事项");
      }
      const providerAttempt = readProviderAttemptStart(database, task, executionAttempt);
      if (providerAttempt && ["completed", "provider-failed", "definitive-rejected"].includes(providerAttempt.outcome)) {
        fail("RECOVERY_CASE_CONFLICT", "Provider尝试已经有明确终态");
      }
      const histories = readCaseHistories(database, task.id);
      const matching = [...histories.values()].find(
        (group) => group[0]?.payload.executionAttempt === executionAttempt,
      );
      if (matching) {
        const first = matching[0].payload;
        if (first.ownerId !== ownerId || first.reason !== reason) {
          fail("RECOVERY_CASE_CONFLICT", "原attempt已有不同维护事项");
        }
        const latest = historyLatest(matching);
        return buildSnapshot(database, task, latest);
      }
      const attemptStartedAt = reason === "missing_attempt_evidence" ? undefined : providerAttempt?.created_at;
      if (!attemptStartedAt && reason !== "missing_attempt_evidence") {
        fail("RECOVERY_CASE_ATTEMPT_NOT_FOUND", "没有可信的原attempt开始时间");
      }
      const providerWindowMs = attemptStartedAt === undefined
        ? undefined
        : validateProviderWindow(task.kind, input.providerWindowMs);
      const automaticDeadlineAt = attemptStartedAt === undefined || providerWindowMs === undefined
        ? undefined
        : addMilliseconds(
            addMilliseconds(attemptStartedAt, providerWindowMs),
            maximumProviderWindowMs,
          );
      const casePayload: RecoveryCaseEventPayload = {
        version: recoveryCaseVersion,
        event: "opened",
        caseId: makeCaseId(task.id, executionAttempt),
        taskId: task.id,
        executionAttempt,
        ownerId,
        phase: "queued",
        reason,
        caseRevision: 1,
        operationId,
        actorId,
        ...(attemptStartedAt ? { attemptStartedAt } : {}),
        ...(providerWindowMs !== undefined ? { providerWindowMs } : {}),
        ...(automaticDeadlineAt ? { automaticDeadlineAt } : {}),
        checkCount: 0,
        inspectionUsed: 0,
        progressVersion: 0,
        readVersion: 0,
        lastReadProgressVersion: 0,
        checkOutcome: "not_checked",
        ...(automaticDeadlineAt ? { nextCheckAt: createdAt } : {}),
      };
      const eventId = insertCaseEvent(database, task, casePayload, createdAt);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.opened, casePayload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(casePayload),
          created_at: createdAt,
        },
        payload: casePayload,
      });
    });
  }

  /**
   * Register a terminal publication/projection quarantine without reopening
   * the Provider attempt. This is deliberately separate from ensureCase:
   * ordinary terminal attempts remain ineligible unless the Media-owned
   * publication or Canvas projection ledger has a confirmed conflict.
   *
   * Undefined means the transaction found no confirmed local quarantine (or
   * the task/attempt is not the narrow terminal shape this admission accepts),
   * and no case event was written.
   */
  function ensurePublicationQuarantineCase(
    input: RecoveryCasePublicationQuarantineInput,
  ): GenerationRecoveryCaseSnapshot | undefined {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = input.actorId ?? generationRecoverySystemActorId;
    const createdAt = nowIso(input.now);
    const reason: RecoveryCaseReason = "provider_evidence_conflict";
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      if (actorId !== generationRecoverySystemActorId) {
        assertActor(database, actorId, adminGuard, false);
      }
      if (executionAttempt !== task.attempt) {
        fail("RECOVERY_CASE_CONFLICT", "只能登记生成任务当前执行尝试的维护事项");
      }

      // Read the Media-owned publication and Canvas projection ledgers while
      // the same IMMEDIATE transaction is open. Pending work alone is not a
      // quarantine; only an explicit OSS identity or projection conflict is.
      const publication = recoveryPublicationState(database, task.id);
      if (!publication.conflict || task.state !== "failed") return undefined;

      const providerAttempt = readProviderAttemptStart(database, task, executionAttempt);
      if (!providerAttempt || providerAttempt.outcome !== "completed") return undefined;

      const histories = readCaseHistories(database, task.id);
      const matching = [...histories.values()].find(
        (group) => group[0]?.payload.executionAttempt === executionAttempt,
      );
      if (matching) {
        const first = matching[0].payload;
        const latest = historyLatest(matching);
        if (first.ownerId !== ownerId) {
          fail("RECOVERY_CASE_CONFLICT", "原attempt已有不同维护事项");
        }
        // A local publication/projection conflict is idempotent once this
        // case is already queued for the same reason. A prior operator
        // incident may have opened the case first, however; in that case the
        // ledger conflict is a legal, narrow escalation of the same case.
        if (latest.payload.reason === reason && latest.payload.phase === "queued") {
          return buildSnapshot(database, task, latest);
        }
        assertCaseTransition(latest.payload.phase, "queued", isProviderEvidenceConflictEscalation(
          { ...latest.payload },
          { ...latest.payload, event: "progressed", phase: "queued", reason },
        ));
        const casePayload = buildMutationPayload(latest.payload, {
          event: "progressed",
          phase: "queued",
          reason,
          operationId,
          actorId,
          progressVersion: latest.payload.progressVersion + 1,
          progressAt: createdAt,
          nextCheckAt: undefined,
          inspectionLeaseId: undefined,
          inspectionLeaseUntil: undefined,
          claimedAt: undefined,
          claimedBy: undefined,
          claimLeaseId: undefined,
          claimLeaseUntil: undefined,
          closedAt: undefined,
        });
        const eventId = insertCaseEvent(database, task, casePayload, createdAt);
        writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.progressed, casePayload);
        return buildSnapshot(database, task, {
          row: {
            id: eventId,
            task_id: task.id,
            state: task.state,
            error_code: recoveryCaseEventCode,
            error_message: JSON.stringify(casePayload),
            created_at: createdAt,
          },
          payload: casePayload,
        });
      }

      const attemptStartedAt = providerAttempt.created_at;
      const providerWindowMs = validateProviderWindow(task.kind, input.providerWindowMs);
      const automaticDeadlineAt = addMilliseconds(
        addMilliseconds(attemptStartedAt, providerWindowMs),
        maximumProviderWindowMs,
      );
      const casePayload: RecoveryCaseEventPayload = {
        version: recoveryCaseVersion,
        event: "opened",
        caseId: makeCaseId(task.id, executionAttempt),
        taskId: task.id,
        executionAttempt,
        ownerId,
        phase: "queued",
        reason,
        caseRevision: 1,
        operationId,
        actorId,
        attemptStartedAt,
        providerWindowMs,
        automaticDeadlineAt,
        checkCount: 0,
        inspectionUsed: 0,
        progressVersion: 0,
        readVersion: 0,
        lastReadProgressVersion: 0,
        checkOutcome: "not_checked",
        nextCheckAt: createdAt,
      };
      const eventId = insertCaseEvent(database, task, casePayload, createdAt);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.opened, casePayload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(casePayload),
          created_at: createdAt,
        },
        payload: casePayload,
      });
    });
  }

  function claim(input: RecoveryCaseClaimInput): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const now = nowIso(input.now);
    const takeoverAfterMs = input.takeoverAfterMs ?? claimTakeoverMs;
    if (!Number.isSafeInteger(takeoverAfterMs) || takeoverAfterMs < 1 || takeoverAfterMs > maximumProviderWindowMs) {
      fail("RECOVERY_INVALID_COMMAND", "认领接管窗口无效");
    }
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      assertActor(database, actorId, adminGuard, false);
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) return buildSnapshot(database, task, latest);
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (latest.payload.closedAt || latest.payload.phase === "ready_for_user" || latest.payload.phase === "result_recovered") {
        fail("RECOVERY_CASE_CONFLICT", "该维护事项已经进入结果阶段");
      }
      if (latest.payload.phase === "claimed" || latest.payload.claimedBy) {
        const claimedAt = latest.payload.claimedAt
          ? timestampMilliseconds(latest.payload.claimedAt)
          : 0;
        const claimLeaseUntil = latest.payload.claimLeaseUntil
          ? timestampMilliseconds(latest.payload.claimLeaseUntil)
          : 0;
        if (latest.payload.claimedBy === actorId && Date.parse(now) < claimLeaseUntil) {
          return buildSnapshot(database, task, latest);
        }
        if (latest.payload.claimedBy !== actorId && Date.parse(now) - claimedAt < takeoverAfterMs) {
          fail("RECOVERY_CASE_CONFLICT", "维护事项已被其他处理人认领");
        }
      }
      const leaseId = `lease:${randomUUID().replaceAll("-", "")}`;
      const payload = buildMutationPayload(latest.payload, {
        event: "claimed",
        phase: "claimed",
        operationId,
        actorId,
        claimedAt: now,
        claimedBy: actorId,
        claimLeaseId: leaseId,
        claimLeaseUntil: addMilliseconds(now, claimLeaseMs),
        progressVersion: latest.payload.progressVersion +
          (latest.payload.phase !== "claimed" || latest.payload.claimedBy !== actorId ? 1 : 0),
        progressAt: now,
      });
      assertCaseTransition(latest.payload.phase, payload.phase);
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.claimed, payload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
      });
    });
  }

  function recordCheck(input: RecoveryCaseCheckInput): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const suppliedOutcome = assertEnum(input.outcome, recoveryCaseCheckOutcomes, "检查结果");
    if (suppliedOutcome === "not_checked" || suppliedOutcome === "terminal_verified") {
      fail("RECOVERY_INVALID_COMMAND", "检查必须记录真实的查询结果");
    }
    if (input.phase !== undefined) assertEnum(input.phase, recoveryCasePhases, "处理阶段");
    const suppliedEvidence = input.evidenceRef === undefined
      ? undefined
      : assertEvidenceReference(input.evidenceRef);
    const now = nowIso(input.now);
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      assertActor(database, actorId, adminGuard, true);
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) return buildSnapshot(database, task, latest);
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (latest.payload.closedAt) fail("RECOVERY_CASE_CONFLICT", "维护事项已关闭");
      if (latest.payload.nextCheckAt && timestampMilliseconds(now) < timestampMilliseconds(latest.payload.nextCheckAt)) {
        fail("RECOVERY_CASE_NOT_DUE", "尚未到下次检查时间");
      }
      if (!latest.payload.automaticDeadlineAt || !latest.payload.attemptStartedAt || latest.payload.providerWindowMs === undefined) {
        fail("RECOVERY_CASE_CONFLICT", "缺少可信attempt证据，不能进行外查");
      }
      const deadline = timestampMilliseconds(latest.payload.automaticDeadlineAt);
      const expired = timestampMilliseconds(now) >= deadline;
      if (suppliedOutcome === "window_expired") {
        fail("RECOVERY_INVALID_COMMAND", "检查窗口只能由服务器时钟判定已过期");
      }
      const outcome: RecoveryCaseCheckOutcome = expired ? "window_expired" : suppliedOutcome;
      let phase: RecoveryCasePhase = latest.payload.phase;
      if (outcome === "result_found") {
        if (!suppliedEvidence || suppliedEvidence.kind === "none") {
          fail("RECOVERY_INVALID_COMMAND", "结果恢复必须带服务器证据引用");
        }
        phase = input.phase ?? "result_recovered";
        if (phase !== "result_recovered" && phase !== "ready_for_user") {
          fail("RECOVERY_INVALID_COMMAND", "结果恢复阶段无效");
        }
      } else if (outcome !== "window_expired") {
        phase = input.phase ?? latest.payload.phase;
        if (input.phase && phase !== latest.payload.phase && actorId === generationRecoverySystemActorId) {
          fail("RECOVERY_ADMIN_REQUIRED", "自动检查不能改变维护阶段");
        }
        if (phase === "ready_for_user") fail("RECOVERY_INVALID_COMMAND", "没有结果证据不能进入待用户确认");
      }
      assertCaseTransition(latest.payload.phase, phase);
      const count = latest.payload.checkCount + 1;
      const progressChanged = phase !== latest.payload.phase || outcome === "result_found";
      const progressVersion = latest.payload.progressVersion + (progressChanged ? 1 : 0);
      const nextCheckAt = outcome === "no_match" || outcome === "multiple_matches" ||
          outcome === "query_failed" || outcome === "still_running"
        ? (() => {
            const candidate = addMilliseconds(now, nextBackoffMs(count));
            return timestampMilliseconds(candidate) < deadline ? candidate : undefined;
          })()
        : undefined;
      const payload = buildMutationPayload(latest.payload, {
        event: "checked",
        phase,
        operationId,
        actorId,
        checkCount: count,
        checkOutcome: outcome,
        lastCheckedAt: now,
        ...(nextCheckAt ? { nextCheckAt } : { nextCheckAt: undefined }),
        progressVersion,
        ...(progressChanged ? { progressAt: now } : {}),
        ...(outcome === "result_found" && suppliedEvidence ? { evidenceRef: suppliedEvidence } : {}),
      });
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.checked, payload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
      });
    });
  }

  /** Progress reported by an active admin claim; it never consumes an external-read slot. */
  function markProgress(input: RecoveryCaseProgressInput): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const now = nowIso(input.now);
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      assertActor(database, actorId, adminGuard, false);
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) return buildSnapshot(database, task, latest);
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (latest.payload.closedAt || latest.payload.phase === "result_recovered" || latest.payload.phase === "ready_for_user") {
        fail("RECOVERY_CASE_CONFLICT", "该维护事项已经进入结果阶段");
      }
      if (latest.payload.claimedBy !== actorId || !latest.payload.claimLeaseUntil ||
          timestampMilliseconds(now) >= timestampMilliseconds(latest.payload.claimLeaseUntil)) {
        fail("RECOVERY_CASE_CONFLICT", "管理员认领租约已过期");
      }
      const phaseChanged = latest.payload.phase !== "waiting_provider";
      if (phaseChanged) assertCaseTransition(latest.payload.phase, input.phase);
      const payload = buildMutationPayload(latest.payload, {
        event: "progressed",
        phase: input.phase,
        operationId,
        actorId,
        progressAt: now,
        progressVersion: latest.payload.progressVersion + (phaseChanged ? 1 : 0),
      });
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.progressed, payload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
      });
    });
  }

  /**
   * Atomically consumes one bounded post-window read before the caller makes
   * the network request. The lease is deliberately persisted before the
   * request, so a crash cannot refund the read budget.
   */
  function beginInspection(input: RecoveryCaseInspectionStartInput): RecoveryCaseInspectionStartResult {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const now = nowIso(input.now);
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      assertActor(database, actorId, adminGuard, true);
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) {
        return { ...buildSnapshot(database, task, latest), inspectionStarted: false };
      }
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (!originalRecoveryReadPreflight(database, { taskId, ownerId, executionAttempt })) {
        fail("RECOVERY_CASE_CONFLICT", "原任务当前应优先保存或保持保护，不可新增核对请求");
      }
      if (latest.payload.closedAt) fail("RECOVERY_CASE_CONFLICT", "维护事项已关闭");
      if (!latest.payload.attemptStartedAt || !latest.payload.automaticDeadlineAt || latest.payload.providerWindowMs === undefined) {
        fail("RECOVERY_CASE_CONFLICT", "缺少可信attempt证据，不能开始外查");
      }
      if (timestampMilliseconds(now) < timestampMilliseconds(latest.payload.automaticDeadlineAt)) {
        fail("RECOVERY_CASE_CONFLICT", "自动窗口内应沿用自动检查，不得消耗维护外查次数");
      }
      if (latest.payload.inspectionDeadlineAt &&
          timestampMilliseconds(now) >= timestampMilliseconds(latest.payload.inspectionDeadlineAt)) {
        fail("RECOVERY_CASE_CONFLICT", "外查会话已经过期");
      }
      if (latest.payload.nextCheckAt && timestampMilliseconds(now) < timestampMilliseconds(latest.payload.nextCheckAt)) {
        fail("RECOVERY_CASE_NOT_DUE", "尚未到下次检查时间");
      }
      if (latest.payload.inspectionLeaseId && latest.payload.inspectionLeaseUntil &&
          timestampMilliseconds(now) < timestampMilliseconds(latest.payload.inspectionLeaseUntil)) {
        fail("RECOVERY_CASE_CONFLICT", "已有外查请求在途");
      }
      if (latest.payload.inspectionUsed >= maximumInspectionUses) {
        fail("RECOVERY_CASE_CONFLICT", "外查次数已经用尽");
      }
      const sessionStartedAt = latest.payload.inspectionStartedAt ?? now;
      const sessionDeadlineAt = latest.payload.inspectionDeadlineAt ??
        addMilliseconds(sessionStartedAt, inspectionSessionMs);
      if (timestampMilliseconds(now) >= timestampMilliseconds(sessionDeadlineAt)) {
        fail("RECOVERY_CASE_CONFLICT", "外查会话已经过期");
      }
      const leaseId = `inspection:${randomUUID().replaceAll("-", "")}`;
      const leaseUntil = new Date(Math.min(
        timestampMilliseconds(sessionDeadlineAt),
        timestampMilliseconds(now) + inspectionTimeoutMs,
      )).toISOString();
      const payload = buildMutationPayload(latest.payload, {
        event: "progressed",
        phase: latest.payload.phase,
        operationId,
        actorId,
        inspectionUsed: latest.payload.inspectionUsed + 1,
        inspectionStartedAt: sessionStartedAt,
        inspectionDeadlineAt: sessionDeadlineAt,
        inspectionLeaseId: leaseId,
        inspectionLeaseUntil: leaseUntil,
      });
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.progressed, payload);
      return {
        ...buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
        }),
        inspectionStarted: true,
      };
    });
  }

  /** Completes the read lease and records only the server-side check outcome. */
  function finishInspection(input: RecoveryCaseInspectionFinishInput): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const inspectionLeaseId = assertIdentifier(input.inspectionLeaseId, "外查租约");
    const suppliedOutcome = assertEnum(input.outcome, recoveryCaseCheckOutcomes, "检查结果");
    if (suppliedOutcome === "not_checked" || suppliedOutcome === "terminal_verified") {
      fail("RECOVERY_INVALID_COMMAND", "检查必须记录真实的查询结果");
    }
    const suppliedEvidence = input.evidenceRef === undefined
      ? undefined
      : assertEvidenceReference(input.evidenceRef);
    const now = nowIso(input.now);
    const retryAfterAt = input.retryAfterAt === undefined ? undefined : nowIso(input.retryAfterAt);
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      assertActor(database, actorId, adminGuard, true);
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) return buildSnapshot(database, task, latest);
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (latest.payload.inspectionLeaseId !== inspectionLeaseId) {
        fail("RECOVERY_CASE_CONFLICT", "外查租约已被替换或撤销");
      }
      if (latest.payload.closedAt) fail("RECOVERY_CASE_CONFLICT", "维护事项已关闭");
      if (!latest.payload.automaticDeadlineAt || !latest.payload.attemptStartedAt || latest.payload.providerWindowMs === undefined) {
        fail("RECOVERY_CASE_CONFLICT", "缺少可信attempt证据，不能完成外查");
      }
      const sessionExpired = latest.payload.inspectionDeadlineAt !== undefined &&
        timestampMilliseconds(now) >= timestampMilliseconds(latest.payload.inspectionDeadlineAt);
      const leaseExpired = latest.payload.inspectionLeaseUntil !== undefined &&
        timestampMilliseconds(now) >= timestampMilliseconds(latest.payload.inspectionLeaseUntil);
      if (suppliedOutcome === "window_expired") {
        fail("RECOVERY_INVALID_COMMAND", "检查窗口只能由服务器时钟判定已过期");
      }
      if (!sessionExpired && leaseExpired && suppliedOutcome !== "query_failed") {
        fail("RECOVERY_CASE_CONFLICT", "外查租约已过期，只能记录查询失败并清理在途状态");
      }
      const outcome: RecoveryCaseCheckOutcome = sessionExpired
        ? "window_expired"
        : leaseExpired
          ? "query_failed"
          : suppliedOutcome;
      let phase: RecoveryCasePhase = latest.payload.phase;
      if (outcome === "result_found") {
        if (!suppliedEvidence || suppliedEvidence.kind === "none") {
          fail("RECOVERY_INVALID_COMMAND", "结果恢复必须带服务器证据引用");
        }
        phase = input.phase ?? "result_recovered";
        if (phase !== "result_recovered" && phase !== "ready_for_user") {
          fail("RECOVERY_INVALID_COMMAND", "结果恢复阶段无效");
        }
      } else if (outcome !== "window_expired") {
        phase = input.phase ?? latest.payload.phase;
        if (input.phase && phase !== latest.payload.phase && actorId === generationRecoverySystemActorId) {
          fail("RECOVERY_ADMIN_REQUIRED", "自动检查不能改变维护阶段");
        }
        if (phase === "ready_for_user") fail("RECOVERY_INVALID_COMMAND", "没有结果证据不能进入待用户确认");
      }
      assertCaseTransition(latest.payload.phase, phase);
      const count = latest.payload.checkCount + 1;
      const progressChanged = phase !== latest.payload.phase || outcome === "result_found";
      const progressVersion = latest.payload.progressVersion + (progressChanged ? 1 : 0);
      const sessionDeadline = latest.payload.inspectionDeadlineAt
        ? timestampMilliseconds(latest.payload.inspectionDeadlineAt)
        : undefined;
      const nextCheckAt = outcome === "no_match" || outcome === "multiple_matches" ||
          outcome === "query_failed" || outcome === "still_running"
        ? (() => {
            const backoffAt = addMilliseconds(now, nextBackoffMs(count));
            const candidate = retryAfterAt && timestampMilliseconds(retryAfterAt) > timestampMilliseconds(backoffAt)
              ? retryAfterAt : backoffAt;
            if (sessionDeadline === undefined || timestampMilliseconds(candidate) < sessionDeadline) return candidate;
            return undefined;
          })()
        : undefined;
      const payload = buildMutationPayload(latest.payload, {
        event: "checked",
        phase,
        operationId,
        actorId,
        checkCount: count,
        checkOutcome: outcome,
        lastCheckedAt: now,
        ...(nextCheckAt ? { nextCheckAt } : { nextCheckAt: undefined }),
        inspectionLeaseId: undefined,
        inspectionLeaseUntil: undefined,
        progressVersion,
        ...(progressChanged ? { progressAt: now } : {}),
        ...(outcome === "result_found" && suppliedEvidence ? { evidenceRef: suppliedEvidence } : {}),
      });
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.checked, payload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
      });
    });
  }

  /**
   * Derives one durable, user-visible case progress event from an already
   * settled generation task. This is intentionally read-only with respect to
   * generation_tasks and never invokes a Provider or opens a new task.
   */
  function settleFromTask(input: MutationFence): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const now = nowIso(input.now);
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      if (actorId !== generationRecoverySystemActorId) {
        fail("RECOVERY_ADMIN_REQUIRED", "任务终态派生只能由系统处理");
      }
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) return buildSnapshot(database, task, latest);
      if (latest.payload.closedAt || latest.payload.phase === "result_recovered" ||
          latest.payload.phase === "ready_for_user") {
        return buildSnapshot(database, task, latest);
      }
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (executionAttempt !== task.attempt) {
        fail("RECOVERY_CASE_CONFLICT", "只能结算生成任务当前执行尝试");
      }

      let outcome: "result_found" | "terminal_verified";
      let phase: "result_recovered" | "ready_for_user";
      if (task.state === "success") {
        if (task.result_asset_id === null && task.result_text === null) {
          fail("RECOVERY_CASE_CONFLICT", "成功任务缺少已保存结果");
        }
        outcome = "result_found";
        phase = "result_recovered";
      } else if (task.state === "failed") {
        if (!task.owner_id) fail("RECOVERY_CASE_CONFLICT", "失败任务缺少所有者");
        const decision = newGenerationForNodeInTransaction(database, {
          canvasId: task.canvas_id,
          kind: task.kind,
          nodeId: task.node_id,
          ownerId: task.owner_id,
        });
        if (!decision.allowed) {
          fail("RECOVERY_CASE_CONFLICT", decision.reason ?? "失败任务仍有未决结果");
        }
        outcome = "terminal_verified";
        phase = "ready_for_user";
      } else {
        fail("RECOVERY_CASE_CONFLICT", "只有已结算的成功或可靠失败任务才能更新维护事项");
      }

      const terminalEventId = readTaskTerminalEvent(
        database,
        task.id,
        task.state === "success" ? "success" : "failed",
      );
      assertCaseTransition(latest.payload.phase, phase);
      const payload = buildMutationPayload(latest.payload, {
        event: "checked",
        phase,
        operationId,
        actorId,
        checkCount: latest.payload.checkCount + 1,
        checkOutcome: outcome,
        lastCheckedAt: now,
        nextCheckAt: undefined,
        inspectionLeaseId: undefined,
        inspectionLeaseUntil: undefined,
        claimLeaseId: undefined,
        claimLeaseUntil: undefined,
        progressVersion: latest.payload.progressVersion + 1,
        progressAt: now,
        evidenceRef: { kind: "task_event", eventId: terminalEventId },
      });
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.checked, payload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
      });
    });
  }

  function acknowledge(input: RecoveryCaseAcknowledgeInput): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const now = nowIso(input.now);
    if (!Number.isSafeInteger(input.expectedProgressVersion) || input.expectedProgressVersion < 0) {
      fail("RECOVERY_INVALID_COMMAND", "进度版本无效");
    }
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      if (actorId !== ownerId) fail("RECOVERY_CASE_CONFLICT", "已读操作只能由任务所有者执行");
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) return buildSnapshot(database, task, latest);
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (latest.payload.progressVersion !== input.expectedProgressVersion) {
        fail("RECOVERY_CASE_CONFLICT", "已有新的维护进展");
      }
      // Opening the page/read endpoint must not create another read event for
      // an already acknowledged progress version.
      if (latest.payload.lastReadProgressVersion >= input.expectedProgressVersion) {
        return buildSnapshot(database, task, latest);
      }
      const payload = buildMutationPayload(latest.payload, {
        event: "acknowledged",
        phase: latest.payload.phase,
        operationId,
        actorId,
        readVersion: latest.payload.readVersion + 1,
        lastReadProgressVersion: input.expectedProgressVersion,
      });
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.acknowledged, payload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
      });
    });
  }

  function closeCase(input: RecoveryCaseCloseInput): GenerationRecoveryCaseSnapshot {
    checkWriteEnabled(enabled);
    const taskId = assertIdentifier(input.taskId, "taskId");
    const ownerId = assertIdentifier(input.ownerId, "ownerId");
    const caseId = assertIdentifier(input.caseId, "caseId");
    const executionAttempt = assertSafePositiveInteger(input.executionAttempt, "执行尝试");
    const operationId = checkOperationId(input.operationId);
    const actorId = assertIdentifier(input.actorId, "处理人");
    const now = nowIso(input.now);
    return writeTransaction(database, () => {
      const task = readTaskForMutation(database, taskId, ownerId, ownerGuard);
      assertActor(database, actorId, adminGuard, false);
      const history = readCaseHistory(database, task.id, caseId, executionAttempt);
      const latest = historyLatest(history);
      if (findOperation(history, operationId)) return buildSnapshot(database, task, latest);
      assertFence(latest, input, readTaskEventWatermark(database, task.id));
      if (latest.payload.closedAt) fail("RECOVERY_CASE_CONFLICT", "维护事项已关闭");
      if (latest.payload.phase !== "ready_for_user" ||
          (latest.payload.checkOutcome !== "result_found" &&
           latest.payload.checkOutcome !== "terminal_verified") ||
          !latest.payload.evidenceRef || latest.payload.evidenceRef.kind === "none") {
        fail("RECOVERY_CASE_CONFLICT", "没有结果证据不能关闭维护事项");
      }
      const payload = buildMutationPayload(latest.payload, {
        event: "closed",
        phase: "ready_for_user",
        operationId,
        actorId,
        closedAt: now,
        progressAt: now,
      });
      const eventId = insertCaseEvent(database, task, payload, now);
      writeAuditForMutation(database, actorId, task, recoveryCaseActionNames.closed, payload);
      return buildSnapshot(database, task, {
        row: {
          id: eventId,
          task_id: task.id,
          state: task.state,
          error_code: recoveryCaseEventCode,
          error_message: JSON.stringify(payload),
          created_at: now,
        },
        payload,
      });
    });
  }

  function getByTaskAttempt(taskIdInput: string, executionAttemptInput: number, ownerId?: string) {
    const taskId = assertIdentifier(taskIdInput, "taskId");
    const executionAttempt = assertSafePositiveInteger(executionAttemptInput, "执行尝试");
    const task = readTask(database, taskId);
    const taskOwner = task.owner_id;
    if (ownerId !== undefined && taskOwner !== ownerId) fail("RECOVERY_NOT_FOUND", "未找到可访问的维护事项");
    const histories = readCaseHistories(database, task.id);
    const match = [...histories.values()].find(
      (group) => group[0]?.payload.executionAttempt === executionAttempt,
    );
    if (!match) fail("RECOVERY_NOT_FOUND", "维护事项不存在");
    return buildSnapshot(database, task, historyLatest(match));
  }

  function getByCaseId(caseIdInput: string, ownerId?: string) {
    const caseId = assertIdentifier(caseIdInput, "caseId");
    const rows = database.prepare(`
      SELECT DISTINCT task_id
      FROM generation_task_events
      WHERE error_code = ?
      LIMIT ?
    `).all(recoveryCaseEventCode, maxListEvents + 1) as Array<{ task_id: string }>;
    if (rows.length > maxListEvents) fail("RECOVERY_CASE_LIMIT", "维护事项查询超过上限");
    for (const row of rows) {
      const task = readTask(database, row.task_id);
      const histories = readCaseHistories(database, task.id);
      for (const history of histories.values()) {
        if (history[0]?.payload.caseId !== caseId) continue;
        if (ownerId !== undefined && task.owner_id !== ownerId) fail("RECOVERY_NOT_FOUND", "未找到可访问的维护事项");
        return buildSnapshot(database, task, historyLatest(history));
      }
    }
    fail("RECOVERY_NOT_FOUND", "维护事项不存在");
  }

  function listAdmin(
    input: RecoveryCaseListInput,
    ownerId: string | undefined,
    phases: readonly RecoveryCasePhase[] | undefined,
    limit: number,
    cursor: Cursor | undefined,
    now: string,
    snapshotEventId: number,
  ): RecoveryCasePage {
    const adminPriorityWindowMs = 24 * 60 * 60_000;
    const afterPriority = cursor?.adminPriority ?? -1;
    const afterOpenedMilliseconds = cursor?.adminOpenedAtMs ?? Number.MIN_SAFE_INTEGER;
    const afterEventId = cursor?.adminEventId ?? 0;
    const candidateRows = database.prepare(`
      WITH raw_events AS (
        SELECT id, task_id, state, error_code, error_message, created_at,
          CASE WHEN json_valid(error_message) THEN error_message ELSE '{}' END AS safe_json,
          CASE WHEN json_valid(error_message) THEN 1 ELSE 0 END AS valid_json
        FROM generation_task_events
        WHERE error_code = ? AND id <= ?
      ),
      parsed_events AS (
        SELECT id, task_id, state, error_code, error_message, created_at,
          CASE WHEN json_type(safe_json, '$.caseId') = 'text'
            THEN json_extract(safe_json, '$.caseId') END AS case_id,
          CASE WHEN json_type(safe_json, '$.executionAttempt') = 'integer'
            THEN json_extract(safe_json, '$.executionAttempt') END AS execution_attempt,
          CASE WHEN json_type(safe_json, '$.event') = 'text'
            THEN json_extract(safe_json, '$.event') END AS event,
          CASE WHEN json_type(safe_json, '$.ownerId') = 'text'
            THEN json_extract(safe_json, '$.ownerId') END AS owner_id,
          CASE WHEN json_type(safe_json, '$.phase') = 'text'
            THEN json_extract(safe_json, '$.phase') END AS phase,
          CASE WHEN json_type(safe_json, '$.claimedBy') = 'text'
            THEN json_extract(safe_json, '$.claimedBy') END AS claimed_by,
          CASE WHEN json_type(safe_json, '$.progressAt') = 'text'
            THEN json_extract(safe_json, '$.progressAt') END AS progress_at,
          CASE WHEN json_type(safe_json, '$.claimedAt') = 'text'
            THEN json_extract(safe_json, '$.claimedAt') END AS claimed_at,
          valid_json,
          CASE WHEN json_type(safe_json, '$.claimedBy') IS NULL OR json_type(safe_json, '$.claimedBy') = 'text'
            THEN 1 ELSE 0 END AS claimed_field_ok,
          CASE WHEN json_type(safe_json, '$.progressAt') IS NULL OR json_type(safe_json, '$.progressAt') = 'text'
            THEN 1 ELSE 0 END AS progress_field_ok,
          CASE WHEN json_type(safe_json, '$.claimedAt') IS NULL OR json_type(safe_json, '$.claimedAt') = 'text'
            THEN 1 ELSE 0 END AS claimed_at_field_ok
        FROM raw_events
      ),
      ranked_cases AS (
        SELECT parsed_events.*,
          ROW_NUMBER() OVER (
            PARTITION BY task_id, case_id, execution_attempt
            ORDER BY id DESC
          ) AS case_rank
        FROM parsed_events
      ),
      latest_cases AS (
        SELECT * FROM ranked_cases WHERE case_rank = 1
      ),
      opened_ranked AS (
        SELECT task_id, case_id, execution_attempt, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY task_id, case_id, execution_attempt
            ORDER BY id ASC
          ) AS opened_rank
        FROM parsed_events
        WHERE event = 'opened' AND case_id IS NOT NULL AND execution_attempt IS NOT NULL
      ),
      opened_cases AS (
        SELECT task_id, case_id, execution_attempt, created_at AS opened_at
        FROM opened_ranked
        WHERE opened_rank = 1
      ),
      with_opened AS (
        SELECT latest_cases.*,
          COALESCE(opened_cases.opened_at, latest_cases.created_at) AS admin_opened_at
        FROM latest_cases
        LEFT JOIN opened_cases
          ON opened_cases.task_id = latest_cases.task_id
         AND opened_cases.case_id = latest_cases.case_id
         AND opened_cases.execution_attempt = latest_cases.execution_attempt
      ),
      with_time AS (
        SELECT with_opened.*,
          COALESCE(
            CAST(ROUND((julianday(admin_opened_at) - 2440587.5) * 86400000.0) AS INTEGER),
            0
          ) AS admin_opened_at_ms
        FROM with_opened
      ),
      params AS (
        SELECT CAST(ROUND((julianday(?) - 2440587.5) * 86400000.0) AS INTEGER) AS admin_now_ms
      ),
      prioritized AS (
        SELECT with_time.*,
          CASE
            WHEN valid_json = 1 AND case_id IS NOT NULL AND length(case_id) > 0
             AND execution_attempt IS NOT NULL AND execution_attempt >= 1
             AND owner_id IS NOT NULL AND length(owner_id) > 0
             AND event IN ('opened', 'claimed', 'checked', 'progressed', 'acknowledged', 'closed')
             AND phase IN ('queued', 'claimed', 'waiting_provider', 'result_recovered', 'ready_for_user')
             AND claimed_field_ok = 1 AND progress_field_ok = 1 AND claimed_at_field_ok = 1
             AND phase = 'queued' AND claimed_by IS NULL
             AND params.admin_now_ms - admin_opened_at_ms >= ? THEN 0
            WHEN valid_json = 1 AND case_id IS NOT NULL AND length(case_id) > 0
             AND execution_attempt IS NOT NULL AND execution_attempt >= 1
             AND owner_id IS NOT NULL AND length(owner_id) > 0
             AND event IN ('opened', 'claimed', 'checked', 'progressed', 'acknowledged', 'closed')
             AND phase IN ('queued', 'claimed', 'waiting_provider', 'result_recovered', 'ready_for_user')
             AND claimed_field_ok = 1 AND progress_field_ok = 1 AND claimed_at_field_ok = 1
             AND phase IN ('claimed', 'waiting_provider') AND claimed_by IS NOT NULL
             AND params.admin_now_ms - COALESCE(
               CAST(ROUND((julianday(progress_at) - 2440587.5) * 86400000.0) AS INTEGER),
               CAST(ROUND((julianday(claimed_at) - 2440587.5) * 86400000.0) AS INTEGER)
             ) >= ? THEN 1
            ELSE 2
          END AS admin_priority
        FROM with_time CROSS JOIN params
      )
      SELECT id, task_id, state, error_code, error_message, created_at,
        case_id, execution_attempt, admin_priority, admin_opened_at_ms
      FROM prioritized
      WHERE admin_priority > ?
         OR (admin_priority = ? AND (
           admin_opened_at_ms > ?
           OR (admin_opened_at_ms = ? AND id > ?)
         ))
      ORDER BY admin_priority ASC, admin_opened_at_ms ASC, id ASC
      LIMIT ?
    `).all(
      recoveryCaseEventCode,
      snapshotEventId,
      now,
      adminPriorityWindowMs,
      adminPriorityWindowMs,
      afterPriority,
      afterPriority,
      afterOpenedMilliseconds,
      afterOpenedMilliseconds,
      afterEventId,
      limit + 1,
    ) as RecoveryEventRow[];
    const adminCandidates = candidateRows as AdminRecoveryCandidateRow[];
    const consumedRows = adminCandidates.slice(0, limit);
    const hasMoreCandidates = adminCandidates.length > limit;

    const corrupt: RecoveryCaseCorruptSummary[] = [];
    const recordCorrupt = (row: AdminRecoveryCandidateRow, reason: RecoveryCaseCorruptSummary["reason"]) => {
      if (corrupt.length < maxPageSize) {
        corrupt.push({ taskId: row.task_id, eventId: Number(row.id), reason });
      }
    };
    const snapshots: GenerationRecoveryCaseSnapshot[] = [];
    const historiesCache = new Map<string, Map<string, ParsedCaseEvent[]> | null>();
    const tasksCache = new Map<string, RecoveryTaskRow | null>();
    for (const row of consumedRows) {
      let histories = historiesCache.get(row.task_id);
      if (!historiesCache.has(row.task_id)) {
        try {
          histories = readCaseHistories(database, row.task_id, snapshotEventId);
        } catch {
          histories = null;
        }
        historiesCache.set(row.task_id, histories);
      }
      if (!histories) {
        recordCorrupt(row, "invalid_event");
        continue;
      }
      const caseKey = `${row.case_id ?? ""}\u0000${row.execution_attempt ?? ""}`;
      const history = histories.get(caseKey);
      if (!history || historyLatest(history).row.id !== row.id) {
        recordCorrupt(row, "invalid_event");
        continue;
      }
      let task = tasksCache.get(row.task_id);
      if (!tasksCache.has(row.task_id)) {
        try {
          task = readTask(database, row.task_id);
        } catch {
          task = null;
        }
        tasksCache.set(row.task_id, task);
      }
      if (!task) {
        recordCorrupt(row, "task_missing");
        continue;
      }
      try {
        const latest = historyLatest(history);
        if (ownerId !== undefined && latest.payload.ownerId !== ownerId) continue;
        if (phases && !phases.includes(latest.payload.phase)) continue;
        if (input.dueOnly && latest.payload.nextCheckAt &&
            timestampMilliseconds(latest.payload.nextCheckAt) > timestampMilliseconds(now)) continue;
        if (task.owner_id !== latest.payload.ownerId) {
          fail("RECOVERY_CASE_CORRUPT", "任务所有者与维护事项不匹配");
        }
        snapshots.push(buildSnapshot(database, task, latest));
      } catch (cause) {
        const reason = cause instanceof GenerationRecoveryCaseError &&
          cause.code === "RECOVERY_CASE_CORRUPT" ? "invalid_event" : "task_missing";
        recordCorrupt(row, reason);
      }
    }

    const last = consumedRows.at(-1);
    const nextCursor = hasMoreCandidates && last
      ? encodeCursor({
        version: 1,
        afterEventId: Number(last.id),
        snapshotEventId,
        order: "admin",
        adminNow: now,
        adminPriority: Number(last.admin_priority),
        adminOpenedAtMs: Number(last.admin_opened_at_ms),
        adminEventId: Number(last.id),
      })
      : undefined;
    return {
      items: snapshots,
      snapshotEventId,
      ...(corrupt.length ? { corrupt } : {}),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  function list(input: RecoveryCaseListInput = {}): RecoveryCasePage {
    const ownerId = input.ownerId === undefined ? undefined : assertIdentifier(input.ownerId, "ownerId");
    const phases = input.phases?.map((phase) => assertEnum(phase, recoveryCasePhases, "处理阶段"));
    const limit = input.limit ?? maxPageSize;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPageSize) fail("RECOVERY_INVALID_COMMAND", "分页大小无效");
    const order = input.order ?? "event";
    if (order !== "event" && order !== "admin") fail("RECOVERY_INVALID_COMMAND", "排序方式无效");
    const cursor = decodeCursor(input.cursor);
    if (cursor && ((cursor.order === "admin") !== (order === "admin"))) {
      fail("RECOVERY_INVALID_COMMAND", "游标排序方式不匹配");
    }
    const now = cursor?.order === "admin" ? cursor.adminNow! : nowIso(input.now);
    const snapshotEventId = cursor?.snapshotEventId ?? Number((database.prepare(`
      SELECT COALESCE(MAX(id), 0) AS max_id
      FROM generation_task_events
      WHERE error_code = ?
    `).get(recoveryCaseEventCode) as { max_id?: number | bigint } | undefined)?.max_id ?? 0);
    if (snapshotEventId < (cursor?.afterEventId ?? 0)) fail("RECOVERY_INVALID_COMMAND", "游标水位无效");
    if (order === "admin") {
      return listAdmin(input, ownerId, phases, limit, cursor, now, snapshotEventId);
    }
    // A task can have several recovery cases across attempts, so the page
    // walks a bounded set of tasks and reconstructs each task's bounded case
    // history.  The window query avoids loading every historical event just
    // to discover which tasks have changed since the caller's cursor.  The
    // extra row is a task-level sentinel used to advance the cursor without
    // making the parser scan an unbounded event stream.
    const taskPageSize = Math.min(maxListEvents, limit + 1);
    const candidateRows = database.prepare(`
      SELECT id, task_id, state, error_code, error_message, created_at
      FROM (
        SELECT id, task_id, state, error_code, error_message, created_at,
               ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY id DESC) AS task_rank
        FROM generation_task_events
        WHERE error_code = ? AND id > ? AND id <= ?
      )
      WHERE task_rank = 1
      ORDER BY id ASC
      LIMIT ?
    `).all(
      recoveryCaseEventCode,
      cursor?.afterEventId ?? 0,
      snapshotEventId,
      taskPageSize + 1,
    ) as RecoveryEventRow[];
    const hasMoreTasks = candidateRows.length > taskPageSize;
    const taskRows = candidateRows.slice(0, taskPageSize);
    const corrupt: RecoveryCaseCorruptSummary[] = [];
    const recordCorrupt = (row: RecoveryEventRow, reason: RecoveryCaseCorruptSummary["reason"]) => {
      if (corrupt.length < maxPageSize) {
        corrupt.push({ taskId: row.task_id, eventId: Number(row.id), reason });
      }
    };
    const snapshots: GenerationRecoveryCaseSnapshot[] = [];
    for (const row of taskRows) {
      let histories: Map<string, ParsedCaseEvent[]>;
      try {
        histories = readCaseHistories(database, row.task_id, snapshotEventId);
      } catch {
        recordCorrupt(row, "invalid_event");
        continue;
      }
      try {
        const task = readTask(database, row.task_id);
        for (const group of histories.values()) {
          const latest = historyLatest(group);
          if (latest.row.id <= (cursor?.afterEventId ?? 0)) continue;
          if (ownerId !== undefined && latest.payload.ownerId !== ownerId) continue;
          if (phases && !phases.includes(latest.payload.phase)) continue;
          if (input.dueOnly && latest.payload.nextCheckAt && timestampMilliseconds(latest.payload.nextCheckAt) > timestampMilliseconds(now)) continue;
          if (task.owner_id !== latest.payload.ownerId) fail("RECOVERY_CASE_CORRUPT", "任务所有者与维护事项不匹配");
          snapshots.push(buildSnapshot(database, task, latest));
        }
      } catch {
        recordCorrupt(row, "task_missing");
      }
    }
    snapshots.sort((left, right) => left.eventId - right.eventId);
    const pageItems = snapshots.slice(0, limit);
    const moreSnapshots = snapshots.length > limit;
    const lastScannedTaskEventId = taskRows.at(-1)?.id ?? (cursor?.afterEventId ?? 0);
    const nextAfterEventId = moreSnapshots
      ? pageItems.at(-1)!.eventId
      : lastScannedTaskEventId;
    const nextCursor = moreSnapshots || hasMoreTasks
      ? encodeCursor({ version: 1, afterEventId: nextAfterEventId, snapshotEventId })
      : undefined;
    return {
      items: pageItems,
      snapshotEventId,
      ...(corrupt.length ? { corrupt } : {}),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  function hasOriginalOnly(taskIdInput: string, executionAttemptInput: number): boolean {
    const taskId = assertIdentifier(taskIdInput, "taskId");
    const executionAttempt = assertSafePositiveInteger(executionAttemptInput, "执行尝试");
    const rows = readMarkerRows(database, taskId);
    if (rows.length > maxCaseEventsPerTask) return true;
    for (const row of rows) {
      try {
        validateEventRowState(row);
        const marker = parseOriginalOnlyMarker(row);
        if (marker.taskId !== taskId) return true;
        if (marker.executionAttempt === executionAttempt) return true;
      } catch {
        // A malformed guard is fail-closed for the task. It must never be
        // silently ignored by an older launcher.
        return true;
      }
    }
    return false;
  }

  function getTaskEventWatermark(taskIdInput: string): number {
    return readTaskEventWatermark(database, assertIdentifier(taskIdInput, "taskId"));
  }

  return {
    ensureCase,
    ensurePublicationQuarantineCase,
    claim,
    recordCheck,
    markProgress,
    beginInspection,
    finishInspection,
    settleFromTask,
    acknowledge,
    closeCase,
    getByTaskAttempt,
    getByCaseId,
    list,
    hasOriginalOnly,
    hasOriginalRecoveryOnly: hasOriginalOnly,
    isOriginalOnly: hasOriginalOnly,
    getTaskEventWatermark,
  };
}

/** Uses a caller-owned SQLite connection; close it at the owner boundary. */
export function createGenerationRecoveryCaseStore(
  database: DatabaseSync,
  options: RecoveryCaseStoreOptions = {},
) {
  return buildStore(database, options);
}

/** Opens the application database and returns a store that owns the connection. */
export function openGenerationRecoveryCaseStore(
  dataDirectory: string,
  options: RecoveryCaseStoreOptions = {},
) {
  const database = openAppDatabase(dataDirectory);
  const store = buildStore(database, options);
  return {
    ...store,
    closeDatabase() {
      database.close();
    },
  };
}
