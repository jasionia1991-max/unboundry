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
  costCurrency: "CNY" | "USD";
  attempt: number;
  canvasId: string;
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  id: string;
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
  return readJson(
    await fetch(`/api/generation-tasks/${encodeURIComponent(taskId)}`, {
      cache: "no-store",
      signal,
    }),
  );
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

export async function retryGenerationTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch(
      `/api/generation-tasks/${encodeURIComponent(taskId)}/retry`,
      { method: "POST", signal },
    ),
  );
}

export async function listGenerationTasks(
  canvasId: string,
  signal?: AbortSignal,
): Promise<GenerationTaskSummary[]> {
  const body = await readJson<{ tasks: GenerationTaskSummary[] }>(
    await fetch(
      `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
      {
        cache: "no-store",
        signal,
      },
    ),
  );
  return body.tasks;
}

type GenerationSubmissionIntent = {
  canvasId: string;
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
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
) {
  return `tapnow:generation-submission:v1:${encodeURIComponent(canvasId)}:${kind}:${encodeURIComponent(nodeId)}`;
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
    typeof intent.updatedAt === "string" &&
    (intent.taskId === undefined || typeof intent.taskId === "string");
}

function readSubmissionIntent(
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
) {
  const slot = submissionIntentSlot(kind, canvasId, nodeId);
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

function writeSubmissionIntent(intent: GenerationSubmissionIntent) {
  const slot = submissionIntentSlot(intent.kind, intent.canvasId, intent.nodeId);
  submissionIntentMemory.set(slot, intent);
  try {
    window.localStorage.setItem(slot, JSON.stringify(intent));
  } catch {
    // See readSubmissionIntent: remaining in-memory is the safe fallback.
  }
}

function prepareGenerationSubmission(
  kind: GenerationTaskKind,
  input: RecoverableGenerationInput,
) {
  const signature = requestSignature(kind, input);
  const current = readSubmissionIntent(kind, input.canvasId, input.nodeId);
  if (current?.requestSignature === signature) return current;
  const intent: GenerationSubmissionIntent = {
    canvasId: input.canvasId,
    idempotencyKey: crypto.randomUUID(),
    kind,
    nodeId: input.nodeId,
    requestSignature: signature,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
  // This write deliberately happens before preflight and before the paid POST.
  writeSubmissionIntent(intent);
  return intent;
}

function rememberGenerationTask(
  intent: GenerationSubmissionIntent,
  task: GenerationTaskSummary,
) {
  writeSubmissionIntent({
    ...intent,
    taskId: task.id,
    updatedAt: new Date().toISOString(),
  });
}

export function clearGenerationSubmissionIntent(
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
  taskId?: string,
) {
  const slot = submissionIntentSlot(kind, canvasId, nodeId);
  const current = readSubmissionIntent(kind, canvasId, nodeId);
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
  const response = await fetch(
    `/api/generation-tasks/by-idempotency?canvasId=${encodeURIComponent(canvasId)}` +
      `&idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
    { cache: "no-store", signal },
  );
  if (response.status === 404) return undefined;
  return readJson(response);
}

export async function recoverPendingGenerationTask(
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
  signal?: AbortSignal,
  currentInput?: RecoverableGenerationInput,
) {
  const intent = readSubmissionIntent(kind, canvasId, nodeId);
  if (!intent) return undefined;
  if (
    currentInput &&
    intent.requestSignature !== requestSignature(kind, currentInput)
  ) {
    clearGenerationSubmissionIntent(kind, canvasId, nodeId, intent.taskId);
    return undefined;
  }
  const task = await getGenerationTaskByIdempotency(
    canvasId,
    intent.idempotencyKey,
    signal,
  );
  if (!task) return undefined;
  if (task.canvasId !== canvasId || task.kind !== kind || task.nodeId !== nodeId) {
    clearGenerationSubmissionIntent(kind, canvasId, nodeId);
    return undefined;
  }
  rememberGenerationTask(intent, task);
  return task;
}

async function postGeneration(
  kind: GenerationTaskKind,
  input: GenerationPreflightInput,
) {
  return readJson<GenerationTaskSummary>(
    await fetch("/api/generation-tasks", {
      body: JSON.stringify({ ...input, kind }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
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
): Promise<EnsuredGenerationTask> {
  const intent = prepareGenerationSubmission(kind, input);
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
      clearGenerationSubmissionIntent(kind, input.canvasId, input.nodeId);
      throw new GenerationRequestError(
        existing.errorMessage ?? "生成任务已取消",
        409,
        existing.errorCode ?? "USER_CANCELLED",
      );
    }
    rememberGenerationTask(intent, existing);
    return { idempotencyKey: intent.idempotencyKey, recovered: true, task: existing };
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

  try {
    const task = await postGeneration(kind, prepared);
    rememberGenerationTask(intent, task);
    return { idempotencyKey: intent.idempotencyKey, recovered: false, task };
  } catch (error) {
    // The POST may have reached the server even when its response did not reach
    // the browser. One read-only reconciliation prevents the next click from
    // creating a second paid task.
    try {
      const recovered = await getGenerationTaskByIdempotency(
        input.canvasId,
        intent.idempotencyKey,
      );
      if (recovered) {
        rememberGenerationTask(intent, recovered);
        return {
          idempotencyKey: intent.idempotencyKey,
          recovered: true,
          task: recovered,
        };
      }
    } catch {
      // Preserve and surface the original submission error. The durable intent
      // remains available for the next refresh/retry lookup.
    }
    if (
      error instanceof GenerationRequestError &&
      error.code === "IDEMPOTENCY_CONFLICT"
    ) {
      // A key left by another signed-in owner (or the extremely unlikely
      // compact-signature collision) must not permanently poison this node.
      // The server confirmed that no task owned by the current user can be
      // recovered under it, so the next explicit click may safely mint a key.
      clearGenerationSubmissionIntent(kind, input.canvasId, input.nodeId);
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
