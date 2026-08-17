import type {
  NodeInputProblem,
  NodeInputSnapshot,
} from "../../../types/nodeInputs";

export type GenerationTaskKind = "text" | "image" | "video" | "audio";

export type GenerationTaskState =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "retrying"
  | "recovering";

export type GenerationTaskSummary = {
  abandonAllowed?: boolean;
  costCurrency: "CNY" | "USD";
  attempt: number;
  canvasRevision?: number;
  canvasId: string;
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  id: string;
  providerTaskBound?: boolean;
  reconcileAllowed?: boolean;
  generationInputKey?: string;
  /** Client-local ownership evidence restored from the durable browser intent. */
  generationOwnershipKey?: string;
  kind: GenerationTaskKind;
  model?: string;
  nodeId: string;
  prompt: string;
  retryAllowed?: boolean;
  retryBlockCode?: string;
  retryBlockReason?: string;
  resultAssetId?: string;
  resultMedia?: {
    byteSize: number;
    contentType: string;
    durationSeconds: number | null;
    durationStatus: "failed" | "not-applicable" | "pending" | "ready";
    mediaHeight: number | null;
    mediaWidth: number | null;
    storageBackend: "local" | "oss";
  };
  resultText?: string;
  resultUrl?: string;
  state: GenerationTaskState;
  updatedAt: string;
};

export type GenerationCapabilityStatus = {
  audioProviderConfigured?: boolean;
  audioSubmissionEnabled?: boolean;
  imageProviderConfigured?: boolean;
  imageSubmissionEnabled?: boolean;
  historicalEstimatedProviderAttempts?: number;
  paidProviderRequests: number;
  persistentQueueReady: boolean;
  providerConfigured: boolean;
  submissionEnabled: boolean;
  textProviderConfigured?: boolean;
  textSubmissionEnabled?: boolean;
  videoProviderConfigured?: boolean;
  videoSubmissionEnabled?: boolean;
};

export class GenerationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly problems: NodeInputProblem[] = [],
  ) {
    super(message);
    this.name = "GenerationRequestError";
  }
}

const GENERATION_TASK_STATUS_READ_TIMEOUT_MS = 10_000;
export const GENERATION_TASK_MUTATION_TIMEOUT_MS = 12_000;

function safeProblems(value: unknown): NodeInputProblem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((problem): problem is NodeInputProblem =>
    Boolean(
      problem &&
      typeof problem === "object" &&
      typeof (problem as NodeInputProblem).code === "string" &&
      typeof (problem as NodeInputProblem).message === "string" &&
      ((problem as NodeInputProblem).edgeId === undefined ||
        typeof (problem as NodeInputProblem).edgeId === "string"),
    )).slice(0, 64);
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & {
    code?: string;
    error?: string;
    problems?: unknown;
  };
  if (!response.ok) {
    throw new GenerationRequestError(
      body.error ?? "生成任务服务暂不可用",
      response.status,
      body.code,
      safeProblems(body.problems),
    );
  }
  return body;
}

async function readTaskStatusJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
  allowNotFound = false,
): Promise<T | undefined> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const callerAbort = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => {
      controller.abort(signal.reason);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      reject(new GenerationRequestError(
        "任务状态查询超时",
        0,
        "TASK_STATUS_TIMEOUT",
      ));
      controller.abort("generation-task-status-timeout");
    }, GENERATION_TASK_STATUS_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, {
          ...init,
          signal: controller.signal,
        });
        if (allowNotFound && response.status === 404) return undefined;
        return readJson<T>(response);
      })(),
      callerAbort,
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

async function readMutationJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let observedStatus: number | undefined;
  const callerAbort = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => {
      controller.abort(signal.reason);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      const status = observedStatus !== undefined && observedStatus >= 400
        ? observedStatus
        : 0;
      reject(new GenerationRequestError(
        status > 0
          ? `生成任务服务响应超时（${status}）`
          : "生成请求响应超时，正在核对已有任务",
        status,
        status > 0
          ? "GENERATION_HTTP_RESPONSE_TIMEOUT"
          : "GENERATION_RESPONSE_TIMEOUT",
      ));
      controller.abort("generation-task-mutation-timeout");
    }, GENERATION_TASK_MUTATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(input, {
          ...init,
          signal: controller.signal,
        });
        observedStatus = response.status;
        try {
          return await readJson<T>(response);
        } catch (error) {
          if (!(error instanceof GenerationRequestError)) {
            throw new GenerationRequestError(
              "生成任务服务响应异常，正在核对已有任务",
              response.ok ? 0 : response.status,
              "GENERATION_SERVER_RESPONSE_INVALID",
            );
          }
          throw error;
        }
      })(),
      callerAbort,
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export async function getGenerationCapabilityStatus(
  signal?: AbortSignal,
): Promise<GenerationCapabilityStatus> {
  return readJson(
    await fetch("/api/generation-tasks/status", {
      cache: "no-store",
      signal,
    }),
  );
}

export async function getGenerationTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary> {
  return await readTaskStatusJson<GenerationTaskSummary>(
    `/api/generation-tasks/${encodeURIComponent(taskId)}`,
    { cache: "no-store" },
    signal,
  ) as GenerationTaskSummary;
}

export async function cancelGenerationTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch(`/api/generation-tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      signal,
    }),
  );
}

export type GenerationReconcileOutcome =
  | "check-failed"
  | "missing"
  | "needs-task-id"
  | "recovered"
  | "still-running";

export type GenerationReconcileResult = {
  outcome: GenerationReconcileOutcome;
  task: GenerationTaskSummary;
};

export function reconcileOutcomeMessage(outcome: GenerationReconcileOutcome) {
  if (outcome === "needs-task-id") {
    return "系统没记下平台任务号，请填写后再核对";
  }
  if (outcome === "still-running") {
    return "平台还在做，请稍后再核对";
  }
  if (outcome === "missing") {
    return "平台没有成片，可以重试";
  }
  if (outcome === "check-failed") {
    return "暂时查不到平台结果，请稍后再核对";
  }
  return "";
}

export async function reconcileGenerationTask(
  target: GenerationRetryTarget,
  waitForCanvasRevision: GenerationRetryGate,
  providerTaskId?: string,
  signal?: AbortSignal,
): Promise<GenerationReconcileResult> {
  const expectedCanvasRevision = await waitForCanvasRevision();
  const before = await getGenerationTask(target.taskId, signal);
  if (
    !retryTargetMatches(before, target) ||
    !target.generationInputKey ||
    before.generationInputKey !== target.generationInputKey
  ) {
    throw new GenerationRequestError(
      "任务已不再绑定当前节点输入，请从节点重新提交",
      409,
      "RETRY_BINDING_STALE",
    );
  }
  if (before.state !== "failed") {
    throw new GenerationRequestError(
      "任务状态已变化，请刷新后再试",
      409,
      "RETRY_TASK_CHANGED",
    );
  }
  const body = await readMutationJson<GenerationReconcileResult>(
    `/api/generation-tasks/${encodeURIComponent(target.taskId)}/reconcile`,
    {
      body: JSON.stringify({
        canvasId: target.canvasId,
        expectedAttempt: before.attempt,
        expectedCanvasRevision,
        expectedGenerationInputKey: target.generationInputKey,
        expectedUpdatedAt: before.updatedAt,
        kind: target.kind,
        nodeId: target.nodeId,
        ...(providerTaskId?.trim()
          ? { providerTaskId: providerTaskId.trim() }
          : {}),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    signal,
  );
  if (!body?.outcome || !body.task || !retryTargetMatches(body.task, target)) {
    throw new GenerationRequestError(
      "核对结果响应异常，请稍后再试",
      500,
      "RECONCILE_RESPONSE_INVALID",
    );
  }
  return body;
}

export async function abandonGenerationTask(
  task: Pick<GenerationTaskSummary, "attempt" | "id" | "updatedAt">,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch(
      `/api/generation-tasks/${encodeURIComponent(task.id)}/abandon`,
      {
        body: JSON.stringify({
          acknowledgeRemoteResultMayBeLost: true,
          expectedAttempt: task.attempt,
          expectedUpdatedAt: task.updatedAt,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal,
      },
    ),
  );
}

export const GENERATION_TASK_RETRY_ACCEPTED_EVENT =
  "unboundry:generation-task-retry-accepted";

export type GenerationTaskRetryAcceptedDetail = {
  attempt: number;
  canvasId: string;
  kind: GenerationTaskKind;
  nodeId: string;
  taskId: string;
  updatedAt: string;
};

export type GenerationRetryTarget = {
  canvasId: string;
  generationInputKey: string;
  kind: GenerationTaskKind;
  nodeId: string;
  taskId: string;
};

export type GenerationRetryGate = () => Promise<number>;

export type GenerationOwnershipOptions = {
  generationOwnershipKey?: string;
};

function retryTargetMatches(
  task: GenerationTaskSummary,
  target: GenerationRetryTarget,
) {
  return task.id === target.taskId &&
    task.canvasId === target.canvasId &&
    task.kind === target.kind &&
    task.nodeId === target.nodeId;
}

function retryWasAccepted(
  before: Pick<GenerationTaskSummary, "attempt">,
  after: GenerationTaskSummary,
) {
  return after.state !== "failed" || after.attempt > before.attempt;
}

function mutationOutcomeMayBeUnknown(error: unknown) {
  if (error instanceof GenerationRequestError) {
    return error.status === 0 || error.status >= 500;
  }
  if (error instanceof TypeError) return true;
  return error instanceof DOMException &&
    (error.name === "NetworkError" || error.name === "TimeoutError");
}

export async function retryGenerationTask(
  target: GenerationRetryTarget,
  waitForCanvasRevision: GenerationRetryGate,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary> {
  const expectedCanvasRevision = await waitForCanvasRevision();
  const before = await getGenerationTask(target.taskId, signal);
  if (
    !retryTargetMatches(before, target) ||
    !target.generationInputKey ||
    before.generationInputKey !== target.generationInputKey
  ) {
    throw new GenerationRequestError(
      "任务已不再绑定当前节点输入，请从节点重新提交",
      409,
      "RETRY_BINDING_STALE",
    );
  }
  if (before.state !== "failed") {
    throw new GenerationRequestError(
      "任务状态已变化，请刷新后再试",
      409,
      "RETRY_TASK_CHANGED",
    );
  }
  const body = JSON.stringify({
    canvasId: target.canvasId,
    expectedAttempt: before.attempt,
    expectedCanvasRevision,
    expectedGenerationInputKey: target.generationInputKey,
    expectedUpdatedAt: before.updatedAt,
    kind: target.kind,
    nodeId: target.nodeId,
  });
  try {
    const accepted = await readMutationJson<GenerationTaskSummary>(
      `/api/generation-tasks/${encodeURIComponent(target.taskId)}/retry`,
      {
        body,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      signal,
    );
    if (!retryTargetMatches(accepted, target)) {
      throw new GenerationRequestError(
        "生成任务关联不一致，请刷新后重试",
        409,
        "RETRY_BINDING_STALE",
      );
    }
    if (!retryWasAccepted(before, accepted)) {
      throw new GenerationRequestError(
        "重试响应尚未确认，正在核对任务状态",
        0,
        "RETRY_RESPONSE_NOT_CONFIRMED",
      );
    }
    return accepted;
  } catch (error) {
    if (signal?.aborted || !mutationOutcomeMayBeUnknown(error)) {
      throw error;
    }
    try {
      const recovered = await getGenerationTask(target.taskId, signal);
      if (
        retryTargetMatches(recovered, target) &&
        retryWasAccepted(before, recovered)
      ) {
        return recovered;
      }
    } catch {
      // Preserve the unknown POST result. A second retry POST is never issued.
    }
    throw error;
  }
}

export async function listGenerationTasks(
  canvasId: string,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary[]> {
  const body = await readTaskStatusJson<{ tasks: GenerationTaskSummary[] }>(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
    { cache: "no-store" },
    signal,
  );
  return body?.tasks ?? [];
}

type GenerationSubmissionIntent = {
  canvasId: string;
  generationOwnershipKey?: string;
  idempotencyKey: string;
  kind: GenerationTaskKind;
  nodeId: string;
  requestSignature: string;
  taskId?: string;
  updatedAt: string;
  version: 1;
};

export type RecoverableGenerationInput = Omit<
  GenerationPreflightInput,
  "idempotencyKey"
>;

export type EnsuredGenerationTask = {
  generationOwnershipKey?: string;
  idempotencyKey: string;
  recovered: boolean;
  task: GenerationTaskSummary;
};

const submissionIntentMemory = new Map<string, GenerationSubmissionIntent>();

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "canvasRevision" && key !== "idempotencyKey")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

// A compact deterministic signature keeps prompts and reference details out of
// localStorage. A collision is still fail-closed by the server fingerprint.
function requestSignature(kind: GenerationTaskKind, input: RecoverableGenerationInput) {
  const source = JSON.stringify(stableValue({ kind, ...input }));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const value = source.charCodeAt(index);
    left = Math.imul(left ^ value, 0x01000193) >>> 0;
    right = Math.imul(right ^ value, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

function submissionIntentSlot(
  accountId: string,
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
) {
  return `unboundry:generation-submission:v2:${encodeURIComponent(accountId)}:${encodeURIComponent(canvasId)}:${kind}:${encodeURIComponent(nodeId)}`;
}

function validIntent(
  value: unknown,
  expected: { canvasId: string; kind: GenerationTaskKind; nodeId: string },
): value is GenerationSubmissionIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<GenerationSubmissionIntent>;
  return intent.version === 1 &&
    intent.canvasId === expected.canvasId &&
    intent.kind === expected.kind &&
    intent.nodeId === expected.nodeId &&
    typeof intent.idempotencyKey === "string" &&
    /^[a-z0-9._:-]{8,200}$/i.test(intent.idempotencyKey) &&
    typeof intent.requestSignature === "string" &&
    (intent.generationOwnershipKey === undefined ||
      (typeof intent.generationOwnershipKey === "string" &&
        intent.generationOwnershipKey.length > 0 &&
        intent.generationOwnershipKey.length <= 2_000)) &&
    typeof intent.updatedAt === "string" &&
    (intent.taskId === undefined || typeof intent.taskId === "string");
}

function readSubmissionIntent(
  accountId: string,
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
) {
  const slot = submissionIntentSlot(accountId, kind, canvasId, nodeId);
  try {
    const serialized = window.localStorage.getItem(slot);
    if (serialized) {
      const parsed: unknown = JSON.parse(serialized);
      if (validIntent(parsed, { canvasId, kind, nodeId })) {
        submissionIntentMemory.set(slot, parsed);
        return parsed;
      }
      window.localStorage.removeItem(slot);
    }
  } catch {
    // Privacy modes can deny localStorage. The in-memory copy still protects
    // rapid duplicate clicks for the lifetime of this page.
  }
  return submissionIntentMemory.get(slot);
}

function writeSubmissionIntent(
  accountId: string,
  intent: GenerationSubmissionIntent,
) {
  const slot = submissionIntentSlot(
    accountId,
    intent.kind,
    intent.canvasId,
    intent.nodeId,
  );
  try {
    window.localStorage.setItem(slot, JSON.stringify(intent));
  } catch {
    throw new GenerationRequestError(
      "浏览器无法安全保存生成请求，请允许本地存储后重试",
      503,
      "GENERATION_INTENT_STORAGE_UNAVAILABLE",
    );
  }
  // A new or upgraded intent must never become usable in this page until its
  // durable copy exists. This keeps preflight and the paid POST fail-closed.
  submissionIntentMemory.set(slot, intent);
}

function prepareGenerationSubmission(
  accountId: string,
  kind: GenerationTaskKind,
  input: RecoverableGenerationInput,
  options: GenerationOwnershipOptions,
) {
  const signature = requestSignature(kind, input);
  const current = readSubmissionIntent(accountId, kind, input.canvasId, input.nodeId);
  const generationOwnershipKey = options.generationOwnershipKey?.trim() || undefined;
  if (current) {
    if (generationOwnershipKey && current.generationOwnershipKey) {
      if (current.generationOwnershipKey === generationOwnershipKey) {
        // Catalog-derived request fields may drift. Once both sides carry the
        // same raw ownership proof, keep the original paid idempotency intent.
        return current;
      }
      // A different non-empty ownership key is a genuinely different run and
      // deliberately falls through to mint a new idempotency key.
    } else if (generationOwnershipKey) {
      if (current.requestSignature !== signature) {
        // A legacy intent has no raw ownership proof. Never attach today's key
        // to it unless the old catalog-derived signature still matches exactly.
        clearGenerationSubmissionIntent(
          kind,
          input.canvasId,
          input.nodeId,
          undefined,
          accountId,
        );
        throw new GenerationRequestError(
          "旧生成任务无法证明仍属于当前输入，请再次提交",
          409,
          "GENERATION_OWNERSHIP_UNPROVEN",
        );
      }
      const upgraded = { ...current, generationOwnershipKey };
      writeSubmissionIntent(accountId, upgraded);
      return upgraded;
    } else if (current.requestSignature === signature) {
      // Callers without ownership evidence retain the exact legacy signature
      // fence; they never receive the relaxed catalog-drift behavior above.
      return current;
    }
  }
  const intent: GenerationSubmissionIntent = {
    canvasId: input.canvasId,
    ...(generationOwnershipKey ? { generationOwnershipKey } : {}),
    idempotencyKey: crypto.randomUUID(),
    kind,
    nodeId: input.nodeId,
    requestSignature: signature,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
  // This write deliberately happens before preflight and before the paid POST.
  writeSubmissionIntent(accountId, intent);
  return intent;
}

function rememberGenerationTask(
  accountId: string,
  intent: GenerationSubmissionIntent,
  task: GenerationTaskSummary,
) {
  try {
    writeSubmissionIntent(accountId, {
      ...intent,
      taskId: task.id,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (
      !(error instanceof GenerationRequestError) ||
      error.code !== "GENERATION_INTENT_STORAGE_UNAVAILABLE"
    ) {
      throw error;
    }
    // The original durable idempotency intent (and its same-page memory copy)
    // is sufficient to recover this exact task. Do not hide a confirmed task
    // merely because the optional taskId annotation could not be refreshed.
  }
}

function taskWithGenerationOwnership(
  task: GenerationTaskSummary,
  intent: GenerationSubmissionIntent,
) {
  return intent.generationOwnershipKey
    ? { ...task, generationOwnershipKey: intent.generationOwnershipKey }
    : task;
}

export function clearGenerationSubmissionIntent(
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
  taskId?: string,
  accountId = "",
) {
  const slot = submissionIntentSlot(accountId, kind, canvasId, nodeId);
  const current = readSubmissionIntent(accountId, kind, canvasId, nodeId);
  if (taskId && current && current.taskId !== taskId) return;
  submissionIntentMemory.delete(slot);
  try {
    window.localStorage.removeItem(slot);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

export async function getGenerationTaskByIdempotency(
  canvasId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary | undefined> {
  return readTaskStatusJson<GenerationTaskSummary>(
    `/api/generation-tasks/by-idempotency?canvasId=${encodeURIComponent(canvasId)}` +
      `&idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
    { cache: "no-store" },
    signal,
    true,
  );
}

export async function recoverPendingGenerationTask(
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
  signal?: AbortSignal,
  currentInput?: RecoverableGenerationInput,
  accountId = "",
  options: GenerationOwnershipOptions = {},
) {
  let intent = readSubmissionIntent(accountId, kind, canvasId, nodeId);
  if (!intent) return undefined;
  const generationOwnershipKey = options.generationOwnershipKey?.trim() || undefined;
  if (intent.generationOwnershipKey) {
    if (
      !generationOwnershipKey ||
      generationOwnershipKey !== intent.generationOwnershipKey
    ) {
      // Keep the already-verified intent intact. A caller without the same raw
      // ownership proof cannot poll or claim its task.
      return undefined;
    }
  } else {
    if (!currentInput || !generationOwnershipKey) return undefined;
    if (intent.requestSignature !== requestSignature(kind, currentInput)) {
      clearGenerationSubmissionIntent(
        kind,
        canvasId,
        nodeId,
        intent.taskId,
        accountId,
      );
      return undefined;
    }
    // No await occurs between validating the legacy signature and persisting
    // its first raw ownership proof.
    intent = { ...intent, generationOwnershipKey };
    writeSubmissionIntent(accountId, intent);
  }
  const task = await getGenerationTaskByIdempotency(
    canvasId,
    intent.idempotencyKey,
    signal,
  );
  if (!task) return undefined;
  if (task.canvasId !== canvasId || task.kind !== kind || task.nodeId !== nodeId) {
    clearGenerationSubmissionIntent(kind, canvasId, nodeId, undefined, accountId);
    return undefined;
  }
  rememberGenerationTask(accountId, intent, task);
  return taskWithGenerationOwnership(task, intent);
}

async function postGeneration(
  kind: GenerationTaskKind,
  input: GenerationPreflightInput,
) {
  return readMutationJson<GenerationTaskSummary>(
    "/api/generation-tasks",
    {
      body: JSON.stringify({ ...input, kind }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
}

/**
 * Shared four-node submission transaction. The durable browser intent is
 * written synchronously before any await, an already-created server task is
 * recovered before preflight, and a lost POST response is reconciled with the
 * same owner-scoped key before an error reaches the node UI.
 */
export async function ensureGenerationTask(
  kind: GenerationTaskKind,
  input: RecoverableGenerationInput,
  accountId = "",
  assertCurrentInput?: () => void,
  options: GenerationOwnershipOptions = {},
): Promise<EnsuredGenerationTask> {
  const intent = prepareGenerationSubmission(accountId, kind, input, options);
  const prepared = { ...input, idempotencyKey: intent.idempotencyKey };
  const existing = await getGenerationTaskByIdempotency(
    input.canvasId,
    intent.idempotencyKey,
  );
  if (existing) {
    if (
      existing.canvasId !== input.canvasId ||
      existing.kind !== kind ||
      existing.nodeId !== input.nodeId
    ) {
      throw new GenerationRequestError(
        "生成任务关联不一致，请修改内容后再试",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
    }
    if (existing.state === "cancelled") {
      clearGenerationSubmissionIntent(
        kind,
        input.canvasId,
        input.nodeId,
        undefined,
        accountId,
      );
      throw new GenerationRequestError(
        existing.errorMessage ?? "生成任务已取消",
        409,
        existing.errorCode ?? "USER_CANCELLED",
      );
    }
    rememberGenerationTask(accountId, intent, existing);
    return {
      generationOwnershipKey: intent.generationOwnershipKey,
      idempotencyKey: intent.idempotencyKey,
      recovered: true,
      task: taskWithGenerationOwnership(existing, intent),
    };
  }

  const preflight = await preflightGeneration(kind, prepared);
  if (!preflight.canSubmit || !preflight.canEnqueue) {
    throw new GenerationRequestError(
      preflight.problems[0]?.message ??
        preflight.enqueueProblem?.message ??
        "当前暂时无法创建生成任务",
      409,
      preflight.enqueueProblem?.code ?? preflight.problems[0]?.code,
      preflight.problems,
    );
  }

  // No await is allowed between this last caller-owned semantic fence and the
  // paid POST invocation. postGeneration starts fetch synchronously.
  assertCurrentInput?.();
  try {
    const task = await postGeneration(kind, prepared);
    if (
      task.canvasId !== input.canvasId ||
      task.kind !== kind ||
      task.nodeId !== input.nodeId ||
      task.state === "cancelled"
    ) {
      throw new GenerationRequestError(
        "生成任务关联不一致，请修改内容后再试",
        409,
        "IDEMPOTENCY_CONFLICT",
      );
    }
    rememberGenerationTask(accountId, intent, task);
    return {
      generationOwnershipKey: intent.generationOwnershipKey,
      idempotencyKey: intent.idempotencyKey,
      recovered: false,
      task: taskWithGenerationOwnership(task, intent),
    };
  } catch (error) {
    // The POST may have reached the server even when its response did not reach
    // the browser. One read-only reconciliation prevents the next click from
    // creating a second paid task.
    if (mutationOutcomeMayBeUnknown(error)) {
      try {
        const recovered = await getGenerationTaskByIdempotency(
          input.canvasId,
          intent.idempotencyKey,
        );
        if (
          recovered &&
          recovered.canvasId === input.canvasId &&
          recovered.kind === kind &&
          recovered.nodeId === input.nodeId &&
          recovered.state !== "cancelled"
        ) {
          rememberGenerationTask(accountId, intent, recovered);
          return {
            generationOwnershipKey: intent.generationOwnershipKey,
            idempotencyKey: intent.idempotencyKey,
            recovered: true,
            task: taskWithGenerationOwnership(recovered, intent),
          };
        }
      } catch {
        // Preserve and surface the original submission error. The durable intent
        // remains available for the next refresh/retry lookup.
      }
    }
    if (
      error instanceof GenerationRequestError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      // A deterministic client rejection is never hidden by an older task found
      // under this key. The next explicit click gets a fresh key instead of
      // inheriting a rejected/conflicting intent.
      clearGenerationSubmissionIntent(
        kind,
        input.canvasId,
        input.nodeId,
        undefined,
        accountId,
      );
    }
    throw error;
  }
}

export async function submitImageGeneration(input: {
  canvasId: string;
  canvasRevision?: number;
  idempotencyKey: string;
  inputSchemaVersion?: 1;
  inputs?: NodeInputSnapshot[];
  ownPrompt?: string;
  model?: string;
  nodeId: string;
  parameters?: {
    aspectRatio?: string;
    quality?: string;
    references?: Array<{
      assetId: string;
      kind: "image";
      sourceNodeId: string;
    }>;
  };
  prompt: string;
}): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch("/api/generation-tasks", {
      body: JSON.stringify({ ...input, kind: "image" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export type GenerationPreflightInput = {
  canvasId: string;
  canvasRevision?: number;
  idempotencyKey: string;
  inputSchemaVersion?: 1;
  inputs?: NodeInputSnapshot[];
  model?: string;
  nodeId: string;
  ownPrompt?: string;
  parameters?: unknown;
  prompt: string;
};

export type GenerationPreflightResult = {
  canEnqueue: boolean;
  canSubmit: boolean;
  enqueueProblem?: {
    code: string;
    message: string;
  };
  problems: NodeInputProblem[];
  provider?: {
    adapterSupported: boolean;
    configured: boolean;
  };
  safetyAdmission?: {
    allowed: boolean;
    code: string;
    message?: string;
  };
};

/**
 * All four node kinds use this same zero-Provider gate before the formal task
 * POST. Structural input problems and runtime admission failures stay separate
 * so a valid graph can explain why it is not currently enqueueable.
 */
export async function preflightGeneration(
  kind: GenerationTaskKind,
  input: GenerationPreflightInput,
): Promise<GenerationPreflightResult> {
  const result = await readJson<GenerationPreflightResult>(
    await fetch("/api/generation-tasks/preflight", {
      body: JSON.stringify({ ...input, kind }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  if (!result.canEnqueue && !result.enqueueProblem) {
    const safetyProblem = result.safetyAdmission?.allowed === false &&
      result.safetyAdmission.message
      ? {
          code: result.safetyAdmission.code,
          message: result.safetyAdmission.message,
        }
      : undefined;
    const providerProblem = result.provider &&
        (!result.provider.adapterSupported || !result.provider.configured)
      ? {
          code: !result.provider.adapterSupported
            ? "ADAPTER_UNSUPPORTED"
            : "PROVIDER_PROFILE_MISSING",
          message: !result.provider.adapterSupported
            ? "当前模型尚未接入安全生成服务"
            : "平台安全配置缺失，请联系管理员",
        }
      : undefined;
    result.enqueueProblem = safetyProblem ?? providerProblem ?? {
      code: "GENERATION_UNAVAILABLE",
      message: "当前暂时无法创建生成任务",
    };
  }
  return result;
}

export type TextGenerationInput = {
  canvasId: string;
  canvasRevision?: number;
  idempotencyKey: string;
  inputSchemaVersion?: 1;
  inputs?: NodeInputSnapshot[];
  model?: string;
  nodeId: string;
  ownPrompt?: string;
  parameters: Record<string, boolean | number | string>;
  prompt: string;
};

export async function preflightTextGeneration(
  input: TextGenerationInput,
): Promise<GenerationPreflightResult> {
  return preflightGeneration("text", input);
}

export async function submitTextGeneration(
  input: TextGenerationInput,
): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch("/api/generation-tasks", {
      body: JSON.stringify({ ...input, kind: "text" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function submitVideoGeneration(input: {
  canvasId: string;
  canvasRevision?: number;
  idempotencyKey: string;
  inputSchemaVersion?: 1;
  inputs?: NodeInputSnapshot[];
  model?: string;
  nodeId: string;
  ownPrompt?: string;
  parameters: Record<string, boolean | number | string>;
  prompt: string;
}): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch("/api/generation-tasks", {
      body: JSON.stringify({ ...input, kind: "video" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function preflightVideoGeneration(input: {
  canvasId: string;
  canvasRevision?: number;
  idempotencyKey: string;
  inputSchemaVersion?: 1;
  inputs?: NodeInputSnapshot[];
  model?: string;
  nodeId: string;
  ownPrompt?: string;
  parameters: Record<string, boolean | number | string>;
  prompt: string;
}): Promise<GenerationPreflightResult> {
  return preflightGeneration("video", input);
}

export async function submitAudioGeneration(input: {
  canvasId: string;
  canvasRevision?: number;
  idempotencyKey: string;
  inputSchemaVersion?: 1;
  inputs?: NodeInputSnapshot[];
  model?: string;
  nodeId: string;
  ownPrompt?: string;
  parameters: Record<string, boolean | number | string>;
  prompt: string;
}): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch("/api/generation-tasks", {
      body: JSON.stringify({ ...input, kind: "audio" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function waitForGenerationTask(
  taskId: string,
  signal?: AbortSignal,
) {
  // Generic relay media is allowed to poll for at most 15 minutes server-side.
  // Keep the browser waiting slightly longer so it never reports a false local
  // failure while the durable server task is still running.
  for (let attempt = 0; attempt < 960; attempt += 1) {
    const task = await getGenerationTask(taskId, signal);
    if (["success", "failed", "cancelled"].includes(task.state)) return task;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 1_000);
      signal?.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
  throw new Error("生成等待超时");
}
