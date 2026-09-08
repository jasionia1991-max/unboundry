import {
  recoveryCaseAuditActions,
  recoveryCasePhases,
  recoveryCaseReasons,
  recoveryPublicActions,
  recoveryPublicStatuses,
  type RecoveryCaseAdminDetail,
  type RecoveryCaseAdminList,
  type RecoveryCaseAdminSummary,
  type RecoveryCaseSummary,
  type RecoveryPublicStatus,
} from "../../../types/generationRecovery";

export type RecoveryOwnerListResponse = Readonly<{
  enabled: boolean;
  cases: readonly RecoveryCaseSummary[];
}>;

export type RecoveryOwnerDetailResponse = Readonly<{
  enabled: boolean;
  case: RecoveryCaseSummary | null;
}>;

export type RecoveryAdminAction = "claim" | "inspect" | "progress";

export type RecoveryRequestErrorCode =
  | "RECOVERY_ADMIN_REQUIRED"
  | "RECOVERY_CASE_CONFLICT"
  | "RECOVERY_CASE_LIMIT"
  | "RECOVERY_CONFLICT"
  | "RECOVERY_DISABLED"
  | "RECOVERY_FROZEN"
  | "RECOVERY_INVALID_COMMAND"
  | "RECOVERY_NOT_FOUND"
  | "RECOVERY_ORIGIN_REJECTED"
  | "RECOVERY_RATE_LIMIT"
  | "RECOVERY_ROUTE_NOT_FOUND"
  | "RECOVERY_SESSION_REQUIRED"
  | "RECOVERY_UNAVAILABLE";

export class GenerationRecoveryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: RecoveryRequestErrorCode | string,
  ) {
    super(message);
    this.name = "GenerationRecoveryRequestError";
  }
}

type RecoveryCaseWithReplacement = RecoveryCaseSummary & Readonly<{
  /** Added by the task API when an automatic compensation child exists. */
  replacementTaskId?: string;
}>;

const identifier = /^[a-z0-9._-]{1,120}$/i;
const taskKinds = new Set(["text", "image", "video", "audio"]);
const phases = new Set<string>(recoveryCasePhases);
const reasons = new Set<string>(recoveryCaseReasons);
const statuses = new Set<string>(recoveryPublicStatuses);
const actions = new Set<string>(recoveryPublicActions);
const auditActions = new Set<string>(recoveryCaseAuditActions);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalTimestamp(value: unknown) {
  return value === undefined ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isRecoveryCaseSummary(value: unknown): value is RecoveryCaseSummary {
  if (!isRecord(value)) return false;
  return typeof value.taskId === "string" && identifier.test(value.taskId) &&
    typeof value.caseId === "string" && value.caseId.length > 0 &&
    typeof value.canvasId === "string" && value.canvasId.length > 0 &&
    typeof value.nodeId === "string" && value.nodeId.length > 0 &&
    typeof value.kind === "string" && taskKinds.has(value.kind) &&
    isPositiveInteger(value.executionAttempt) &&
    typeof value.phase === "string" && phases.has(value.phase) &&
    isPositiveInteger(value.caseEventId) &&
    isNonNegativeInteger(value.progressVersion) &&
    typeof value.updatedAt === "string" && value.updatedAt.length > 0 &&
    isOptionalString(value.lastCheckedAt) &&
    isOptionalString(value.nextCheckAt) &&
    typeof value.unread === "boolean" &&
    typeof value.reasonCode === "string" && reasons.has(value.reasonCode) &&
    typeof value.summary === "string" && value.summary.length > 0 &&
    value.summary.length <= 1_000 &&
    typeof value.status === "string" && statuses.has(value.status) &&
    typeof value.action === "string" && actions.has(value.action) &&
    (value.replacementTaskId === undefined ||
      (typeof value.replacementTaskId === "string" &&
        identifier.test(value.replacementTaskId)));
}

function isAdminSummary(value: unknown): value is RecoveryCaseAdminSummary {
  return isRecoveryCaseSummary(value) &&
    typeof (value as RecoveryCaseAdminSummary).ownerId === "string" &&
    typeof (value as RecoveryCaseAdminSummary).originalCreatedAt === "string" &&
    typeof (value as RecoveryCaseAdminSummary).openedAt === "string" &&
    typeof (value as RecoveryCaseAdminSummary).overdue === "boolean" &&
    typeof (value as RecoveryCaseAdminSummary).followUpDue === "boolean" &&
    ((value as RecoveryCaseAdminSummary).modelId === undefined ||
      typeof (value as RecoveryCaseAdminSummary).modelId === "string") &&
    ((value as RecoveryCaseAdminSummary).providerModelId === undefined ||
      typeof (value as RecoveryCaseAdminSummary).providerModelId === "string") &&
    ((value as RecoveryCaseAdminSummary).attemptStartedAt === undefined ||
      typeof (value as RecoveryCaseAdminSummary).attemptStartedAt === "string") &&
    ((value as RecoveryCaseAdminSummary).claimedBy === undefined ||
      typeof (value as RecoveryCaseAdminSummary).claimedBy === "string") &&
    isOptionalTimestamp((value as RecoveryCaseAdminSummary).claimLeaseUntil);
}

function parseOwnerList(value: unknown): RecoveryOwnerListResponse {
  if (!isRecord(value) || typeof value.enabled !== "boolean" ||
      !Array.isArray(value.cases) ||
      !value.cases.every(isRecoveryCaseSummary)) {
    throw new GenerationRecoveryRequestError(
      "恢复状态响应格式无效",
      200,
      "RECOVERY_UNAVAILABLE",
    );
  }
  return {
    enabled: value.enabled,
    cases: value.cases,
  };
}

function parseOwnerDetail(value: unknown): RecoveryOwnerDetailResponse {
  if (!isRecord(value) || typeof value.enabled !== "boolean" ||
      (value.case !== null && !isRecoveryCaseSummary(value.case))) {
    throw new GenerationRecoveryRequestError(
      "恢复状态响应格式无效",
      200,
      "RECOVERY_UNAVAILABLE",
    );
  }
  return { enabled: value.enabled, case: value.case };
}

function parseAdminList(value: unknown): RecoveryCaseAdminList {
  if (!isRecord(value) || typeof value.enabled !== "boolean" ||
      !Array.isArray(value.cases) || !value.cases.every(isAdminSummary) ||
      !Array.isArray(value.corrupt) ||
      !value.corrupt.every((item) => isRecord(item) &&
        typeof item.taskId === "string" && item.taskId.length > 0 &&
        isPositiveInteger(item.eventId) &&
        (item.reason === "invalid_event" || item.reason === "unsupported_event" ||
          item.reason === "task_missing")) ||
      !isNonNegativeInteger(value.unavailableCount) ||
      (value.nextCursor !== undefined && typeof value.nextCursor !== "string")) {
    throw new GenerationRecoveryRequestError(
      "恢复维护列表响应格式无效",
      200,
      "RECOVERY_UNAVAILABLE",
    );
  }
  return {
    enabled: value.enabled,
    cases: value.cases,
    corrupt: value.corrupt,
    unavailableCount: value.unavailableCount,
    ...(value.nextCursor ? { nextCursor: value.nextCursor } : {}),
  };
}

function parseAdminDetail(value: unknown): RecoveryCaseAdminDetail {
  if (!isRecord(value) || typeof value.enabled !== "boolean" ||
      (value.case !== null && !isAdminSummary(value.case) &&
        !isRecoveryCaseSummary(value.case)) ||
      !Array.isArray(value.audit) ||
      !value.audit.every((entry) => isRecord(entry) && isPositiveInteger(entry.id) &&
        typeof entry.action === "string" &&
        auditActions.has(entry.action) &&
        typeof entry.actor === "string" && entry.actor.length <= 80 &&
        typeof entry.createdAt === "string")) {
    throw new GenerationRecoveryRequestError(
      "恢复维护详情响应格式无效",
      200,
      "RECOVERY_UNAVAILABLE",
    );
  }
  return {
    enabled: value.enabled,
    case: value.case,
    audit: value.audit as RecoveryCaseAdminDetail["audit"],
  };
}

function messageForError(status: number, code?: string) {
  if (code === "RECOVERY_ADMIN_REQUIRED" || status === 403) {
    return "只有有效管理员可以处理此事项";
  }
  if (code === "RECOVERY_DISABLED" || code === "RECOVERY_FROZEN") {
    return "生成维护暂不可操作，原任务记录已保留";
  }
  if (code === "RECOVERY_CONFLICT" || code === "RECOVERY_CASE_CONFLICT" ||
      code === "RECOVERY_CAS_CONFLICT" || status === 409) {
    return "处理进度已更新，请重新查看最新状态";
  }
  if (code === "RECOVERY_NOT_FOUND" || status === 404) {
    return "未找到可访问的处理事项";
  }
  if (code === "RECOVERY_INVALID_COMMAND" || status === 400) {
    return "处理操作参数无效";
  }
  if (code === "RECOVERY_RATE_LIMIT" || status === 429) {
    return "处理状态读取过于频繁，请稍后再试";
  }
  return "暂时无法更新处理状态，原任务记录已保留";
}

async function requestJson(
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  let response: Response;
  try {
    response = await fetch(input, { ...init, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new GenerationRecoveryRequestError(
      "恢复状态暂时无法读取，原任务记录已保留",
      0,
      "RECOVERY_UNAVAILABLE",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GenerationRecoveryRequestError(
      messageForError(response.status),
      response.status,
      "RECOVERY_UNAVAILABLE",
    );
  }
  if (!response.ok) {
    const details = isRecord(body) ? body : {};
    const code = typeof details.code === "string" ? details.code : undefined;
    throw new GenerationRecoveryRequestError(
      messageForError(response.status, code),
      response.status,
      code,
    );
  }
  return body;
}

function normalizedTaskIds(taskIds: readonly string[]) {
  return [...new Set(taskIds.filter((id) => identifier.test(id)))].slice(0, 50);
}

export async function readGenerationRecoveryCases(
  taskIds: readonly string[],
  signal?: AbortSignal,
): Promise<RecoveryOwnerListResponse> {
  const ids = normalizedTaskIds(taskIds);
  if (ids.length === 0) return { enabled: true, cases: [] };
  const query = new URLSearchParams({ taskIds: ids.join(",") });
  const body = await requestJson(
    `/api/generation-recovery?${query.toString()}`,
    { cache: "no-store" },
    signal,
  );
  return parseOwnerList(body);
}

export async function readGenerationRecoveryCase(
  taskId: string,
  signal?: AbortSignal,
): Promise<RecoveryOwnerDetailResponse> {
  if (!identifier.test(taskId)) {
    throw new GenerationRecoveryRequestError(
      "未找到可访问的处理事项",
      404,
      "RECOVERY_NOT_FOUND",
    );
  }
  const body = await requestJson(
    `/api/generation-recovery/${encodeURIComponent(taskId)}`,
    { cache: "no-store" },
    signal,
  );
  return parseOwnerDetail(body);
}

function commandId(prefix: string) {
  const random = typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

async function sendCommand(
  path: string,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<RecoveryOwnerDetailResponse> {
  const result = await requestJson(
    path,
    {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Unboundry-Recovery-Command": "v1",
      },
      method: "POST",
    },
    signal,
  );
  return parseOwnerDetail(result);
}

export async function acknowledgeGenerationRecoveryCase(
  item: Pick<RecoveryCaseSummary, "taskId" | "caseEventId" | "progressVersion">,
  signal?: AbortSignal,
) {
  const response = await sendCommand(
    `/api/generation-recovery/${encodeURIComponent(item.taskId)}/read`,
    {
      commandId: commandId("recovery-read"),
      expectedCaseEventId: item.caseEventId,
      progressVersion: item.progressVersion,
    },
    signal,
  );
  return response;
}

export async function listAdminGenerationRecovery(
  input: Readonly<{ after?: string; limit?: number }> = {},
  signal?: AbortSignal,
): Promise<RecoveryCaseAdminList> {
  const query = new URLSearchParams();
  if (input.after) query.set("after", input.after);
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return parseAdminList(await requestJson(
    `/api/admin/generation-recovery${suffix}`,
    { cache: "no-store" },
    signal,
  ));
}

export async function readAdminGenerationRecovery(
  taskId: string,
  signal?: AbortSignal,
): Promise<RecoveryCaseAdminDetail> {
  if (!identifier.test(taskId)) {
    throw new GenerationRecoveryRequestError(
      "未找到可访问的处理事项",
      404,
      "RECOVERY_NOT_FOUND",
    );
  }
  return parseAdminDetail(await requestJson(
    `/api/admin/generation-recovery/${encodeURIComponent(taskId)}`,
    { cache: "no-store" },
    signal,
  ));
}

export async function runAdminGenerationRecoveryAction(
  action: RecoveryAdminAction,
  item: Pick<RecoveryCaseSummary, "taskId" | "caseEventId">,
  signal?: AbortSignal,
): Promise<RecoveryCaseAdminDetail> {
  const body: Record<string, unknown> = {
    commandId: commandId(`recovery-${action}`),
    expectedCaseEventId: item.caseEventId,
  };
  if (action === "progress") body.phase = "waiting_provider";
  const result = await requestJson(
    `/api/admin/generation-recovery/${encodeURIComponent(item.taskId)}/${action}`,
    {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Unboundry-Recovery-Command": "v1",
      },
      method: "POST",
    },
    signal,
  );
  return parseAdminDetail(result);
}

export function recoveryCaseWithReplacement(
  item: RecoveryCaseSummary,
): RecoveryCaseWithReplacement {
  return item as RecoveryCaseWithReplacement;
}

export function recoveryStatusLabel(status: RecoveryPublicStatus) {
  switch (status) {
    case "recovering": return "正在核对原请求";
    case "scheduled": return "已安排继续核对";
    case "queued": return "已登记待处理";
    case "claimed": return "维护人员已接手";
    case "waiting_provider": return "等待平台回复";
    case "unresolved": return "仍待平台结果确认";
    case "result_recovered": return "结果已找回";
    case "result_pending": return "结果已找回，正在写回画布";
    case "ready_for_user": return "当前节点可以继续使用";
    case "unavailable": return "处理状态暂不可更新";
  }
}

export function recoveryCaseHasActiveWork(item: RecoveryCaseSummary) {
  return item.status === "recovering" || item.status === "scheduled" ||
    item.status === "claimed" || item.status === "waiting_provider" ||
    item.status === "result_pending";
}
