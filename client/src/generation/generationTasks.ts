import type {
  NodeInputProblem,
  NodeInputSnapshot,
} from "../../../types/nodeInputs";
import type { ImageGenerationToolInput } from "../../../types/imageTools";
import { runExclusiveCanvasSubmit } from "./saveGate";
import { rememberFinishedTaskDuration } from "./taskDurationCache";
import {
  hasConflictingActiveGroupRunLeaseForCanvas,
  runWithGroupRunCanvasAdmission,
} from "./groupRunCheckpoint";
import type { GroupRunSummaryScope } from "./groupRunSummary";
import { legacyGenerationSubmissionIsBlocked } from
  "./legacyTerminalGenerationState";

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
  canvasProjectionDocumentRevision?: number;
  canvasProjectionOperationId?: string;
  canvasProjectionOriginalRequestId?: string;
  canvasProjectionState?: "applied" | "conflict" | "failed" |
    "not-applicable" | "pending";
  canvasRevision?: number;
  canvasId: string;
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  fixtureScopeId?: string;
  id: string;
  idempotencyKey?: string;
  providerTaskBound?: boolean;
  /** Server-verified automatic compensation successor for this task. */
  replacementTaskId?: string;
  reconcileAllowed?: boolean;
  generationIdentityVersion?: 2;
  generationInputKey?: string;
  /** Client-local ownership evidence restored from the durable browser intent. */
  generationOwnershipKey?: string;
  modelInputContractFingerprint?: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
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
    checksumSha256: string;
    contentType: string;
    durationSeconds: number | null;
    durationStatus: "failed" | "not-applicable" | "pending" | "ready";
    mediaHeight: number | null;
    mediaWidth: number | null;
    storageBackend: "local" | "oss";
  };
  resultOutputs?: Array<{
    assetId: string;
    media: NonNullable<GenerationTaskSummary["resultMedia"]>;
    role: "alternate" | "primary";
    url: string;
  }>;
  resultText?: string;
  resultUrl?: string;
  state: GenerationTaskState;
  updatedAt: string;
  workflowExecutionRunId?: string;
  workflowGroupId?: string;
  newGenerationAllowed?: boolean;
  newGenerationBlockReason?: string;
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

async function assertNoConflictingGroupRun(
  scope: GroupRunSummaryScope,
  nodeId?: string,
  workflowRunId?: string,
) {
  if (await hasConflictingActiveGroupRunLeaseForCanvas(
    scope,
    nodeId,
    workflowRunId,
  )) {
    throw new GenerationRequestError(
      "当前节点正在整组执行中，请等待完成后再单独生成",
      409,
      "GROUP_RUN_ACTIVE",
    );
  }
}

/**
 * Hold the cross-tab Canvas admission boundary before a single-node command
 * mutates its prepared graph state. The caller releases this boundary as soon
 * as the accepted task binding is durable; Provider polling stays outside it.
 */
export function runWithSingleNodeGenerationAdmission<T>(
  scope: GroupRunSummaryScope,
  nodeId: string,
  work: () => Promise<T> | T,
): Promise<T> {
  return runWithGroupRunCanvasAdmission(scope.canvasId, async () => {
    await assertNoConflictingGroupRun(scope, nodeId);
    const key = canvasNodeMutationAdmissionKey(scope, nodeId);
    locallyAdmittedCanvasMutationNodes.add(key);
    try {
      return await work();
    } finally {
      locallyAdmittedCanvasMutationNodes.delete(key);
    }
  });
}

const locallyAdmittedCanvasMutationNodes = new Set<string>();

function canvasNodeMutationAdmissionKey(
  scope: GroupRunSummaryScope,
  nodeId: string,
) {
  return JSON.stringify([
    scope.accountId,
    scope.canvasId,
    scope.fixtureScopeId,
    nodeId,
  ]);
}

/**
 * Re-entrant mutations started by effects of an already admitted local edit
 * must join that admission instead of waiting on the same non-reentrant
 * cross-tab lock. The marker never bypasses the lock for another tab/process.
 */
export function canvasNodeMutationAdmissionHeldLocally(
  scope: GroupRunSummaryScope,
  nodeId: string,
) {
  return locallyAdmittedCanvasMutationNodes.has(
    canvasNodeMutationAdmissionKey(scope, nodeId),
  );
}

/**
 * Shared cross-tab boundary for Canvas edits whose semantics can affect a
 * generation input or its graph ownership. Every affected endpoint is checked
 * while the Canvas admission lock is held.
 */
export function runWithCanvasGraphMutationAdmission<T>(
  scope: GroupRunSummaryScope,
  nodeIds: readonly string[],
  work: () => Promise<T> | T,
): Promise<T> {
  return runWithGroupRunCanvasAdmission(scope.canvasId, async () => {
    const affectedNodeIds = [...new Set(nodeIds)];
    for (const nodeId of affectedNodeIds) {
      await assertNoConflictingGroupRun(scope, nodeId);
    }
    const localKeys = affectedNodeIds.map((nodeId) =>
      canvasNodeMutationAdmissionKey(scope, nodeId)
    );
    for (const key of localKeys) locallyAdmittedCanvasMutationNodes.add(key);
    try {
      return await work();
    } finally {
      for (const key of localKeys) locallyAdmittedCanvasMutationNodes.delete(key);
    }
  });
}

const GENERATION_TASK_STATUS_READ_TIMEOUT_MS = 10_000;
export const GENERATION_TASK_MUTATION_TIMEOUT_MS = 12_000;

// Only failures classified at the status GET boundary may be retried. An
// exception from applying a task (or from a mutation) is never a read failure.
class GenerationTaskStatusReadError extends GenerationRequestError {
  constructor(
    message: string,
    status: number,
    readonly retryable: boolean,
    code?: string,
    problems: NodeInputProblem[] = [],
  ) {
    super(message, status, code, problems);
  }
}

/**
 * Only errors raised by the status-GET boundary may open the transient polling
 * pause. Keeping the class private prevents callers from manufacturing a
 * retryable error for ordinary processing or mutation failures.
 */
export function isRetryableGenerationStatusReadError(error: unknown): boolean {
  return error instanceof GenerationTaskStatusReadError && error.retryable;
}

const generationTaskKinds: readonly GenerationTaskKind[] = [
  "text",
  "image",
  "video",
  "audio",
];

const generationTaskStates: readonly GenerationTaskState[] = [
  "queued",
  "running",
  "success",
  "failed",
  "cancelled",
  "retrying",
  "recovering",
];

function isGenerationTaskSummary(value: unknown): value is GenerationTaskSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as Partial<GenerationTaskSummary>;
  return typeof task.id === "string" && task.id.length > 0 &&
    generationTaskKinds.includes(task.kind as GenerationTaskKind) &&
    typeof task.canvasId === "string" && task.canvasId.length > 0 &&
    typeof task.nodeId === "string" && task.nodeId.length > 0 &&
    Number.isInteger(task.attempt) && (task.attempt as number) >= 0 &&
    typeof task.createdAt === "string" && task.createdAt.length > 0 &&
    typeof task.updatedAt === "string" && task.updatedAt.length > 0 &&
    typeof task.prompt === "string" &&
    generationTaskStates.includes(task.state as GenerationTaskState) &&
    (task.fixtureScopeId === undefined ||
      typeof task.fixtureScopeId === "string");
}

function invalidTaskStatusResponse(): GenerationTaskStatusReadError {
  return new GenerationTaskStatusReadError(
    "任务状态响应与当前任务不匹配",
    200,
    false,
    "TASK_STATUS_INVALID_RESPONSE",
  );
}

function validateGenerationTaskSummary(
  value: unknown,
  expected: {
    canvasId?: string;
    fixtureScopeId?: string;
    id?: string;
    idempotencyKey?: string;
  } = {},
): GenerationTaskSummary {
  if (!isGenerationTaskSummary(value) ||
    (expected.id !== undefined && value.id !== expected.id) ||
    (expected.canvasId !== undefined && value.canvasId !== expected.canvasId) ||
    (expected.fixtureScopeId !== undefined &&
      (value.fixtureScopeId ?? "") !== expected.fixtureScopeId) ||
    (expected.idempotencyKey !== undefined &&
      value.idempotencyKey !== expected.idempotencyKey)) {
    throw invalidTaskStatusResponse();
  }
  return value;
}

function assertStatusReadActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
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

async function readTaskStatusJson<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
  allowNotFound = false,
): Promise<T | undefined> {
  assertStatusReadActive(signal);
  const controller = new AbortController();
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let observedFailureStatus: number | undefined;
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
      // A stalled error body cannot turn known 401/403/etc. into a network
      // failure. Preserve the status as soon as response headers arrive.
      reject(new GenerationTaskStatusReadError(
        "任务状态查询超时",
        observedFailureStatus ?? 0,
        observedFailureStatus === undefined || observedFailureStatus >= 500,
        "TASK_STATUS_TIMEOUT",
      ));
      controller.abort("generation-task-status-timeout");
    }, GENERATION_TASK_STATUS_READ_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      (async () => {
        let response: Response;
        try {
          response = await fetch(input, { ...init, signal: controller.signal });
        } catch (error) {
          assertStatusReadActive(signal);
          if (error instanceof TypeError ||
            (error instanceof DOMException && error.name === "NetworkError")) {
            throw new GenerationTaskStatusReadError(
              "任务状态网络查询失败", 0, true, "TASK_STATUS_NETWORK_ERROR",
            );
          }
          throw error;
        }
        assertStatusReadActive(signal);
        if (!response.ok) observedFailureStatus = response.status;
        if (allowNotFound && response.status === 404) return undefined;
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          assertStatusReadActive(signal);
          if (response.ok) {
            throw new GenerationTaskStatusReadError(
              "任务状态响应格式无效", response.status, false,
              "TASK_STATUS_INVALID_RESPONSE",
            );
          }
          // Gateways can return HTML. HTTP status remains authoritative.
        }
        assertStatusReadActive(signal);
        if (!response.ok) {
          const details = body && typeof body === "object"
            ? body as Record<string, unknown> : {};
          throw new GenerationTaskStatusReadError(
            typeof details.error === "string" ? details.error : "生成任务服务暂不可用",
            response.status,
            response.status >= 500,
            typeof details.code === "string" ? details.code : undefined,
            safeProblems(details.problems),
          );
        }
        return body as T;
      })(),
      callerAbort,
      deadline,
    ]);
    assertStatusReadActive(signal);
    return result;
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
  fixtureScopeId = "",
  options: {
    followReplacementTask?: boolean;
    retryTransientStatusReads?: boolean;
  } = {},
): Promise<GenerationTaskSummary> {
  const retryDelays = options.retryTransientStatusReads ? [1_000, 2_000] : [];
  for (let failure = 0; ; failure += 1) {
    assertStatusReadActive(signal);
    try {
      const rawTask = await readTaskStatusJson<GenerationTaskSummary>(
        `/api/generation-tasks/${encodeURIComponent(taskId)}` +
          `?fixtureScopeId=${encodeURIComponent(fixtureScopeId)}`,
        { cache: "no-store" },
        signal,
      ) as GenerationTaskSummary;
      assertStatusReadActive(signal);
      const task = validateGenerationTaskSummary(rawTask, {
        fixtureScopeId,
        id: taskId,
      });
      rememberFinishedTaskDuration(task);
      const replacementTaskId = options.followReplacementTask &&
        typeof task.replacementTaskId === "string"
        ? task.replacementTaskId.trim()
        : undefined;
      if (replacementTaskId && replacementTaskId !== task.id) {
        const replacement = await getGenerationTask(
          replacementTaskId,
          signal,
          fixtureScopeId,
          // The outer original-task read owns the finite 1s/2s budget. A
          // replacement read is part of that same observation attempt.
          { retryTransientStatusReads: false },
        );
        const sameGenerationIdentity = task.generationIdentityVersion === 2 &&
          replacement.generationIdentityVersion === 2 &&
          typeof task.generationInputKey === "string" &&
          task.generationInputKey.length > 0 &&
          replacement.generationInputKey === task.generationInputKey &&
          typeof task.generationOwnershipKey === "string" &&
          task.generationOwnershipKey.length > 0 &&
          replacement.generationOwnershipKey === task.generationOwnershipKey &&
          replacement.modelInputContractFingerprint ===
            task.modelInputContractFingerprint &&
          replacement.modelConfigurationRevision ===
            task.modelConfigurationRevision &&
          replacement.modelReleaseRevision === task.modelReleaseRevision;
        if (
          replacement.id !== replacementTaskId ||
          replacement.canvasId !== task.canvasId ||
          replacement.nodeId !== task.nodeId ||
          replacement.kind !== task.kind ||
          !sameGenerationIdentity
        ) {
          throw new GenerationTaskStatusReadError(
            "自动补偿任务关联不一致，已停止覆盖当前节点",
            409,
            false,
            "REPLACEMENT_TASK_BINDING_STALE",
          );
        }
        return replacement;
      }
      return task;
    } catch (error) {
      assertStatusReadActive(signal);
      if (!(error instanceof GenerationTaskStatusReadError) ||
        !error.retryable || failure >= retryDelays.length) throw error;
      await waitForTaskStatusDelay(retryDelays[failure], signal);
    }
  }
}

export async function cancelGenerationTask(
  taskId: string,
  signal?: AbortSignal,
  fixtureScopeId = "",
): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch(
      `/api/generation-tasks/${encodeURIComponent(taskId)}` +
        `?fixtureScopeId=${encodeURIComponent(fixtureScopeId)}`,
      {
      method: "DELETE",
      signal,
      },
    ),
  );
}

export type GenerationReconcileOutcome =
  | "ambiguous"
  | "check-failed"
  | "needs-task-id"
  | "outcome-unknown"
  | "recovered"
  | "still-running";

export type GenerationReconcileResult = {
  outcome: GenerationReconcileOutcome;
  task: GenerationTaskSummary;
};

export function reconcileOutcomeMessage(outcome: GenerationReconcileOutcome) {
  if (outcome === "needs-task-id" || outcome === "check-failed") {
    return "暂时查不到平台结果，系统会继续自动找回";
  }
  if (outcome === "ambiguous") {
    return "平台上有多条相近记录，系统会继续安全匹配";
  }
  if (outcome === "still-running") {
    return "平台还在处理，系统会继续自动跟进";
  }
  if (outcome === "outcome-unknown") {
    return "模型平台可能已经受理或扣费；系统会自动找回结果并禁止重复提交";
  }
  return "";
}

export async function reconcileGenerationTask(
  target: GenerationRetryTarget,
  waitForCanvasRevision: GenerationRetryGate,
  providerTaskId?: string,
  signal?: AbortSignal,
): Promise<GenerationReconcileResult> {
  return runExclusiveCanvasSubmit(target.canvasId, async () => {
    await assertNoConflictingGroupRun({
      accountId: target.accountId,
      canvasId: target.canvasId,
      fixtureScopeId: target.fixtureScopeId ?? "",
    }, target.nodeId);
    return reconcileGenerationTaskUnlocked(
      target,
      waitForCanvasRevision,
      providerTaskId,
      signal,
    );
  });
}

async function reconcileGenerationTaskUnlocked(
  target: GenerationRetryTarget,
  waitForCanvasRevision: GenerationRetryGate,
  providerTaskId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<GenerationReconcileResult> {
  const expectedCanvasRevision = await waitForCanvasRevision();
  const before = await getGenerationTask(
    target.taskId,
    signal,
    target.fixtureScopeId,
  );
  if (!retryTargetMatches(before, target) || !target.generationInputKey) {
    throw new GenerationRequestError(
      "任务已不再绑定当前节点输入，请从节点重新提交",
      409,
      "RETRY_BINDING_STALE",
    );
  }
  if (
    before.generationInputKey &&
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
  const body = await runWithGroupRunCanvasAdmission(target.canvasId, async () => {
    await assertNoConflictingGroupRun({
      accountId: target.accountId,
      canvasId: target.canvasId,
      fixtureScopeId: target.fixtureScopeId ?? "",
    }, target.nodeId);
    return readMutationJson<GenerationReconcileResult>(
      `/api/generation-tasks/${encodeURIComponent(target.taskId)}/reconcile`,
      {
        body: JSON.stringify({
          canvasId: target.canvasId,
          expectedAttempt: before.attempt,
          expectedCanvasRevision,
          expectedGenerationInputKey: target.generationInputKey,
          expectedGenerationOwnershipKey: target.generationOwnershipKey,
          expectedFixtureScopeId: target.fixtureScopeId ?? "",
          expectedModelConfigurationRevision:
            target.modelConfigurationRevision,
          expectedModelInputContractFingerprint:
            target.modelInputContractFingerprint,
          expectedModelReleaseRevision: target.modelReleaseRevision,
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
  });
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
  fixtureScopeId = "",
): Promise<GenerationTaskSummary> {
  return readJson(
    await fetch(
      `/api/generation-tasks/${encodeURIComponent(task.id)}/abandon`,
      {
        body: JSON.stringify({
          acknowledgeRemoteResultMayBeLost: true,
          expectedAttempt: task.attempt,
          expectedFixtureScopeId: fixtureScopeId,
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
  accountId: string;
  canvasId: string;
  fixtureScopeId: string;
  generationInputKey: string;
  generationOwnershipKey: string;
  kind: GenerationTaskKind;
  modelInputContractFingerprint: string;
  modelConfigurationRevision: string;
  modelReleaseRevision: string;
  nodeId: string;
  taskId: string;
};

export type GenerationRetryGate = () => Promise<number>;
export type GenerationRetryCurrentInputGate = () => void;

export type GenerationOwnershipOptions = {
  admissionRemainingMs?: () => number;
  canvasAdmissionAlreadyHeld?: boolean;
  fixtureScopeId?: string;
  generationInputKey?: string;
  generationOwnershipKey?: string;
  modelInputContractFingerprint?: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
  replacesTaskId?: string;
  workflowGroupId?: string;
  workflowRunId?: string;
};

function workflowBindingFromOptions(options: GenerationOwnershipOptions) {
  const workflowSupplied = options.workflowGroupId !== undefined ||
    options.workflowRunId !== undefined;
  if (!workflowSupplied) return undefined;
  const fields = [
    options.workflowGroupId,
    options.workflowRunId,
    options.generationOwnershipKey,
    options.generationInputKey,
    options.modelConfigurationRevision,
    options.modelReleaseRevision,
  ];
  if (
    fields.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new GenerationRequestError(
      "工作流任务绑定不完整，已在提交前停止",
      409,
      "WORKFLOW_BINDING_INCOMPLETE",
    );
  }
  return {
    generationInputKey: options.generationInputKey as string,
    generationOwnershipKey: options.generationOwnershipKey as string,
    groupId: options.workflowGroupId as string,
    modelConfigurationRevision: options.modelConfigurationRevision as string,
    modelReleaseRevision: options.modelReleaseRevision as string,
    runId: options.workflowRunId as string,
  };
}

function taskMatchesWorkflowBinding(
  task: GenerationTaskSummary,
  binding: NonNullable<ReturnType<typeof workflowBindingFromOptions>>,
) {
  return task.workflowGroupId === binding.groupId &&
    task.workflowExecutionRunId === binding.runId &&
    task.generationOwnershipKey === binding.generationOwnershipKey &&
    task.generationInputKey === binding.generationInputKey &&
    task.modelConfigurationRevision === binding.modelConfigurationRevision &&
    task.modelReleaseRevision === binding.modelReleaseRevision;
}

function taskMatchesGenerationIdentity(
  task: GenerationTaskSummary,
  identity: {
    generationInputKey?: string;
    generationOwnershipKey?: string;
    modelInputContractFingerprint?: string;
    modelConfigurationRevision?: string;
    modelReleaseRevision?: string;
  },
) {
  return (identity.generationInputKey === undefined ||
      task.generationInputKey === identity.generationInputKey) &&
    (identity.generationOwnershipKey === undefined ||
      task.generationOwnershipKey === identity.generationOwnershipKey) &&
    (identity.modelInputContractFingerprint === undefined ||
      task.modelInputContractFingerprint ===
        identity.modelInputContractFingerprint) &&
    (identity.modelConfigurationRevision === undefined ||
      task.modelConfigurationRevision === identity.modelConfigurationRevision) &&
    (identity.modelReleaseRevision === undefined ||
      task.modelReleaseRevision === identity.modelReleaseRevision);
}

function generationIdentityIsComplete(identity: {
  generationInputKey?: string;
  generationOwnershipKey?: string;
  modelInputContractFingerprint?: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
}) {
  return Boolean(
    identity.generationInputKey && identity.generationOwnershipKey &&
    identity.modelInputContractFingerprint && identity.modelConfigurationRevision &&
    identity.modelReleaseRevision,
  );
}

function retryTargetMatches(
  task: GenerationTaskSummary,
  target: GenerationRetryTarget,
) {
  return task.id === target.taskId &&
    task.canvasId === target.canvasId &&
    (task.fixtureScopeId ?? "") === (target.fixtureScopeId ?? "") &&
    task.kind === target.kind &&
    task.nodeId === target.nodeId &&
    task.generationInputKey === target.generationInputKey &&
    task.generationOwnershipKey === target.generationOwnershipKey &&
    task.modelInputContractFingerprint ===
      target.modelInputContractFingerprint &&
    task.modelConfigurationRevision === target.modelConfigurationRevision &&
    task.modelReleaseRevision === target.modelReleaseRevision;
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
  assertCurrentInput?: GenerationRetryCurrentInputGate,
): Promise<GenerationTaskSummary> {
  return runExclusiveCanvasSubmit(target.canvasId, async () => {
    await assertNoConflictingGroupRun({
      accountId: target.accountId,
      canvasId: target.canvasId,
      fixtureScopeId: target.fixtureScopeId ?? "",
    }, target.nodeId);
    return retryGenerationTaskUnlocked(
      target,
      waitForCanvasRevision,
      signal,
      assertCurrentInput,
    );
  });
}

async function retryGenerationTaskUnlocked(
  target: GenerationRetryTarget,
  waitForCanvasRevision: GenerationRetryGate,
  signal: AbortSignal | undefined,
  assertCurrentInput: GenerationRetryCurrentInputGate | undefined,
): Promise<GenerationTaskSummary> {
  await waitForCanvasRevision();
  const before = await getGenerationTask(
    target.taskId,
    signal,
    target.fixtureScopeId,
  );
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
  // The first gate covers edits already queued when Retry was clicked. A user
  // can still enqueue a semantic edit while the task GET is in flight, so take
  // a fresh durable high-water immediately before building the paid request.
  const expectedCanvasRevision = await waitForCanvasRevision();
  assertCurrentInput?.();
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  const body = JSON.stringify({
    canvasId: target.canvasId,
    expectedAttempt: before.attempt,
    expectedCanvasRevision,
    expectedGenerationInputKey: target.generationInputKey,
    expectedGenerationOwnershipKey: target.generationOwnershipKey,
    expectedFixtureScopeId: target.fixtureScopeId ?? "",
    expectedModelConfigurationRevision: target.modelConfigurationRevision,
    expectedModelInputContractFingerprint:
      target.modelInputContractFingerprint,
    expectedModelReleaseRevision: target.modelReleaseRevision,
    expectedUpdatedAt: before.updatedAt,
    kind: target.kind,
    nodeId: target.nodeId,
  });
  try {
    const accepted = await runWithGroupRunCanvasAdmission(
      target.canvasId,
      async () => {
        assertCurrentInput?.();
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        await assertNoConflictingGroupRun({
          accountId: target.accountId,
          canvasId: target.canvasId,
          fixtureScopeId: target.fixtureScopeId ?? "",
        }, target.nodeId);
        assertCurrentInput?.();
        if (signal?.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        return readMutationJson<GenerationTaskSummary>(
          `/api/generation-tasks/${encodeURIComponent(target.taskId)}/retry`,
          {
            body,
            headers: { "Content-Type": "application/json" },
            method: "POST",
          },
          signal,
        );
      },
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
      const recovered = await getGenerationTask(
        target.taskId,
        signal,
        target.fixtureScopeId,
      );
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
  fixtureScopeId = "",
): Promise<GenerationTaskSummary[]> {
  const body = await readTaskStatusJson<unknown>(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}` +
      `&fixtureScopeId=${encodeURIComponent(fixtureScopeId)}`,
    { cache: "no-store" },
    signal,
  );
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    !Array.isArray((body as { tasks?: unknown }).tasks)) {
    throw invalidTaskStatusResponse();
  }
  const tasks = (body as { tasks: unknown[] }).tasks.map((task) =>
    validateGenerationTaskSummary(task, { canvasId, fixtureScopeId }),
  );
  for (const task of tasks) rememberFinishedTaskDuration(task);
  return tasks;
}

type GenerationSubmissionIntent = {
  canvasId: string;
  fixtureScopeId: string;
  generationInputKey?: string;
  generationOwnershipKey?: string;
  idempotencyKey: string;
  kind: GenerationTaskKind;
  modelInputContractFingerprint?: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
  nodeId: string;
  replacesTaskId?: string;
  requestSignature: string;
  taskId?: string;
  updatedAt: string;
  version: 2;
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

type GenerationSubmissionIntentRead =
  | { status: "missing" }
  | { intent: GenerationSubmissionIntent; status: "valid" }
  | { raw: string; status: "corrupted" };

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
  fixtureScopeId = "",
) {
  const fixtureSuffix = fixtureScopeId
    ? `:${encodeURIComponent(fixtureScopeId)}`
    : "";
  return `unboundry:generation-submission:v2:${encodeURIComponent(accountId)}:${encodeURIComponent(canvasId)}:${kind}:${encodeURIComponent(nodeId)}${fixtureSuffix}`;
}

function validIntent(
  value: unknown,
  expected: {
    canvasId: string;
    fixtureScopeId: string;
    kind: GenerationTaskKind;
    nodeId: string;
  },
): value is GenerationSubmissionIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<GenerationSubmissionIntent>;
  return intent.version === 2 &&
    intent.canvasId === expected.canvasId &&
    intent.fixtureScopeId === expected.fixtureScopeId &&
    intent.kind === expected.kind &&
    intent.nodeId === expected.nodeId &&
    typeof intent.idempotencyKey === "string" &&
    /^[a-z0-9._:-]{8,200}$/i.test(intent.idempotencyKey) &&
    typeof intent.requestSignature === "string" &&
    (intent.generationOwnershipKey === undefined ||
      (typeof intent.generationOwnershipKey === "string" &&
        intent.generationOwnershipKey.length > 0 &&
        intent.generationOwnershipKey.length <= 2_000)) &&
    (intent.generationInputKey === undefined ||
      (typeof intent.generationInputKey === "string" &&
        intent.generationInputKey.length > 0 &&
        intent.generationInputKey.length <= 32_000)) &&
    (intent.modelInputContractFingerprint === undefined ||
      (typeof intent.modelInputContractFingerprint === "string" &&
        intent.modelInputContractFingerprint.length > 0 &&
        intent.modelInputContractFingerprint.length <= 500)) &&
    (intent.modelConfigurationRevision === undefined ||
      (typeof intent.modelConfigurationRevision === "string" &&
        intent.modelConfigurationRevision.length > 0 &&
        intent.modelConfigurationRevision.length <= 500)) &&
    (intent.modelReleaseRevision === undefined ||
      (typeof intent.modelReleaseRevision === "string" &&
        intent.modelReleaseRevision.length > 0 &&
        intent.modelReleaseRevision.length <= 500)) &&
    (intent.replacesTaskId === undefined ||
      (typeof intent.replacesTaskId === "string" &&
        intent.replacesTaskId.length > 0 &&
        intent.replacesTaskId.length <= 500)) &&
    typeof intent.updatedAt === "string" &&
    (intent.taskId === undefined || typeof intent.taskId === "string");
}

function readSubmissionIntentState(
  accountId: string,
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
  fixtureScopeId = "",
): GenerationSubmissionIntentRead {
  const slot = submissionIntentSlot(
    accountId,
    kind,
    canvasId,
    nodeId,
    fixtureScopeId,
  );
  try {
    const serialized = window.localStorage.getItem(slot);
    if (serialized !== null) {
      if (!serialized) return { raw: serialized, status: "corrupted" };
      try {
        const parsed: unknown = JSON.parse(serialized);
        if (validIntent(parsed, { canvasId, fixtureScopeId, kind, nodeId })) {
          submissionIntentMemory.set(slot, parsed);
          return { intent: parsed, status: "valid" };
        }
      } catch {
        // The exact raw value remains in storage until server authority has
        // proved whether an already accepted task exists.
      }
      return { raw: serialized, status: "corrupted" };
    }
  } catch {
    // Privacy modes can deny localStorage. The in-memory copy still protects
    // rapid duplicate clicks for the lifetime of this page.
  }
  const memory = submissionIntentMemory.get(slot);
  return memory
    ? { intent: memory, status: "valid" }
    : { status: "missing" };
}

function readSubmissionIntent(
  accountId: string,
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
  fixtureScopeId = "",
) {
  const read = readSubmissionIntentState(
    accountId,
    kind,
    canvasId,
    nodeId,
    fixtureScopeId,
  );
  if (read.status === "corrupted") {
    throw new GenerationRequestError(
      "生成请求记录需要先与服务器核对，为避免重复付费暂未提交",
      409,
      "GENERATION_INTENT_CORRUPTED",
    );
  }
  return read.status === "valid" ? read.intent : undefined;
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
    intent.fixtureScopeId,
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

function replaceCorruptedSubmissionIntent(
  accountId: string,
  expectedRaw: string,
  intent: GenerationSubmissionIntent,
) {
  const slot = submissionIntentSlot(
    accountId,
    intent.kind,
    intent.canvasId,
    intent.nodeId,
    intent.fixtureScopeId,
  );
  try {
    if (window.localStorage.getItem(slot) !== expectedRaw) {
      throw new GenerationRequestError(
        "生成请求记录已在其他页面变化，系统将先重新核对原任务",
        409,
        "GENERATION_INTENT_CHANGED",
      );
    }
    window.localStorage.setItem(slot, JSON.stringify(intent));
  } catch (error) {
    if (error instanceof GenerationRequestError) throw error;
    throw new GenerationRequestError(
      "浏览器无法安全修复生成请求记录，为避免重复付费暂未提交",
      503,
      "GENERATION_INTENT_STORAGE_UNAVAILABLE",
    );
  }
  submissionIntentMemory.set(slot, intent);
}

function prepareGenerationSubmission(
  accountId: string,
  kind: GenerationTaskKind,
  input: RecoverableGenerationInput,
  options: GenerationOwnershipOptions,
) {
  const signature = requestSignature(kind, input);
  const fixtureScopeId = options.fixtureScopeId ?? "";
  const current = readSubmissionIntent(
    accountId,
    kind,
    input.canvasId,
    input.nodeId,
    fixtureScopeId,
  );
  const replacesTaskId = options.replacesTaskId?.trim() || undefined;
  const generationOwnershipKey = options.generationOwnershipKey?.trim() || undefined;
  const generationInputKey = options.generationInputKey?.trim() || undefined;
  const modelInputContractFingerprint =
    options.modelInputContractFingerprint?.trim() || undefined;
  const modelConfigurationRevision =
    options.modelConfigurationRevision?.trim() || undefined;
  const modelReleaseRevision = options.modelReleaseRevision?.trim() || undefined;
  if (current && current.replacesTaskId === replacesTaskId) {
    // Never mint a second idempotency key while an older durable intent might
    // already have crossed the paid boundary. ensureGenerationTask first asks
    // the server for this exact key; only a confirmed empty lookup may upgrade
    // the same key to a new semantic identity below.
    return current;
  }
  const intent: GenerationSubmissionIntent = {
    canvasId: input.canvasId,
    fixtureScopeId,
    ...(generationInputKey ? { generationInputKey } : {}),
    ...(generationOwnershipKey ? { generationOwnershipKey } : {}),
    idempotencyKey: crypto.randomUUID(),
    kind,
    ...(modelInputContractFingerprint ? { modelInputContractFingerprint } : {}),
    ...(modelConfigurationRevision ? { modelConfigurationRevision } : {}),
    ...(modelReleaseRevision ? { modelReleaseRevision } : {}),
    nodeId: input.nodeId,
    ...(replacesTaskId ? { replacesTaskId } : {}),
    requestSignature: signature,
    updatedAt: new Date().toISOString(),
    version: 2,
  };
  // This write deliberately happens before preflight and before the paid POST.
  writeSubmissionIntent(accountId, intent);
  return intent;
}

function replacementGenerationSubmissionIntent(
  kind: GenerationTaskKind,
  input: RecoverableGenerationInput,
  options: GenerationOwnershipOptions,
  idempotencyKey: string = crypto.randomUUID(),
  taskId?: string,
): GenerationSubmissionIntent {
  const generationOwnershipKey = options.generationOwnershipKey?.trim() || undefined;
  const generationInputKey = options.generationInputKey?.trim() || undefined;
  const modelInputContractFingerprint =
    options.modelInputContractFingerprint?.trim() || undefined;
  const modelConfigurationRevision =
    options.modelConfigurationRevision?.trim() || undefined;
  const modelReleaseRevision = options.modelReleaseRevision?.trim() || undefined;
  const replacesTaskId = options.replacesTaskId?.trim() || undefined;
  return {
    canvasId: input.canvasId,
    fixtureScopeId: options.fixtureScopeId ?? "",
    ...(generationInputKey ? { generationInputKey } : {}),
    ...(generationOwnershipKey ? { generationOwnershipKey } : {}),
    idempotencyKey,
    kind,
    ...(modelInputContractFingerprint ? { modelInputContractFingerprint } : {}),
    ...(modelConfigurationRevision ? { modelConfigurationRevision } : {}),
    ...(modelReleaseRevision ? { modelReleaseRevision } : {}),
    nodeId: input.nodeId,
    ...(replacesTaskId ? { replacesTaskId } : {}),
    requestSignature: requestSignature(kind, input),
    ...(taskId ? { taskId } : {}),
    updatedAt: new Date().toISOString(),
    version: 2,
  };
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
  return {
    ...task,
    ...(intent.generationInputKey
      ? { generationInputKey: intent.generationInputKey }
      : {}),
    ...(intent.generationOwnershipKey
      ? { generationOwnershipKey: intent.generationOwnershipKey }
      : {}),
  };
}

export function clearGenerationSubmissionIntent(
  kind: GenerationTaskKind,
  canvasId: string,
  nodeId: string,
  taskId: string | undefined,
  accountId: string,
  fixtureScopeId: string,
) {
  const slot = submissionIntentSlot(
    accountId,
    kind,
    canvasId,
    nodeId,
    fixtureScopeId,
  );
  const read = readSubmissionIntentState(
    accountId,
    kind,
    canvasId,
    nodeId,
    fixtureScopeId,
  );
  if (read.status === "corrupted" && taskId) return;
  const current = read.status === "valid" ? read.intent : undefined;
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
  fixtureScopeId = "",
  signal?: AbortSignal,
): Promise<GenerationTaskSummary | undefined> {
  const task = await readTaskStatusJson<unknown>(
    `/api/generation-tasks/by-idempotency?canvasId=${encodeURIComponent(canvasId)}` +
      `&idempotencyKey=${encodeURIComponent(idempotencyKey)}` +
      `&fixtureScopeId=${encodeURIComponent(fixtureScopeId)}`,
    { cache: "no-store" },
    signal,
    true,
  );
  if (task === undefined) return undefined;
  return validateGenerationTaskSummary(task, {
    canvasId,
    fixtureScopeId,
    idempotencyKey,
  });
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
  const fixtureScopeId = options.fixtureScopeId ?? "";
  const intentRead = readSubmissionIntentState(
    accountId,
    kind,
    canvasId,
    nodeId,
    fixtureScopeId,
  );
  let intent = intentRead.status === "valid" ? intentRead.intent : undefined;
  const strictIdentity = {
    generationInputKey: options.generationInputKey?.trim() || undefined,
    generationOwnershipKey:
      options.generationOwnershipKey?.trim() || undefined,
    modelInputContractFingerprint:
      options.modelInputContractFingerprint?.trim() || undefined,
    modelConfigurationRevision:
      options.modelConfigurationRevision?.trim() || undefined,
    modelReleaseRevision: options.modelReleaseRevision?.trim() || undefined,
  };
  if (Object.values(strictIdentity).some((value) => !value)) return undefined;
  if (!intent) {
    const matches = (await listGenerationTasks(
      canvasId,
      signal,
      fixtureScopeId,
    )).filter((task) =>
      task.kind === kind && task.nodeId === nodeId &&
      (task.fixtureScopeId ?? "") === fixtureScopeId &&
      generationIdentityIsComplete(task) &&
      taskMatchesGenerationIdentity(task, strictIdentity)
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  const generationOwnershipKey = options.generationOwnershipKey?.trim() || undefined;
  const contractIdentityMatches =
    intent.generationInputKey === options.generationInputKey &&
    intent.modelInputContractFingerprint === options.modelInputContractFingerprint &&
    intent.modelConfigurationRevision === options.modelConfigurationRevision &&
    intent.modelReleaseRevision === options.modelReleaseRevision;
  if (!contractIdentityMatches) return undefined;
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
        fixtureScopeId,
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
    fixtureScopeId,
    signal,
  );
  if (!task) return undefined;
  if (
    task.canvasId !== canvasId || task.kind !== kind || task.nodeId !== nodeId ||
    (task.fixtureScopeId ?? "") !== fixtureScopeId ||
    !generationIdentityIsComplete(task) ||
    !taskMatchesGenerationIdentity(task, strictIdentity)
  ) {
    clearGenerationSubmissionIntent(
      kind,
      canvasId,
      nodeId,
      undefined,
      accountId,
      fixtureScopeId,
    );
    return undefined;
  }
  rememberGenerationTask(accountId, intent, task);
  return taskWithGenerationOwnership(task, intent);
}

async function postGeneration(
  kind: GenerationTaskKind,
  input: GenerationPreflightInput,
  signal?: AbortSignal,
  replacesTaskId?: string,
) {
  return readMutationJson<GenerationTaskSummary>(
    "/api/generation-tasks",
    {
      body: JSON.stringify({
        ...input,
        kind,
        ...(replacesTaskId?.trim()
          ? { replacesTaskId: replacesTaskId.trim() }
          : {}),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    signal,
  );
}

async function runAdmissionStep<T>(
  remainingMs: (() => number) | undefined,
  phase: "formal" | "preflight",
  work: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!remainingMs) return work();
  const remaining = Math.floor(remainingMs());
  if (remaining <= 0) {
    throw new GenerationRequestError(
      "画布持续变化，本次没有创建生成任务。请停止编辑后再试。",
      409,
      "SAVE_STABILITY_TIMEOUT",
    );
  }
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort("generation-admission-deadline");
      reject(new GenerationRequestError(
        phase === "preflight"
          ? "生成预检暂时未完成，正在自动重试"
          : "生成请求结果暂时无法确认，正在核对原任务",
        0,
        phase === "preflight"
          ? "PREFLIGHT_RETRYABLE"
          : "GENERATION_RESPONSE_TIMEOUT",
      ));
    }, remaining);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } catch (error) {
    if (timedOut) {
      throw new GenerationRequestError(
        phase === "preflight"
          ? "生成预检暂时未完成，正在自动重试"
          : "生成请求结果暂时无法确认，正在核对原任务",
        0,
        phase === "preflight"
          ? "PREFLIGHT_RETRYABLE"
          : "GENERATION_RESPONSE_TIMEOUT",
      );
    }
    throw error;
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
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
  if (legacyGenerationSubmissionIsBlocked(
    accountId,
    input.canvasId,
    options.fixtureScopeId ?? "",
    input.nodeId,
  )) {
    throw new GenerationRequestError(
      "原任务状态仍在安全核对中，为避免重复付费暂不能新建任务",
      409,
      "LEGACY_GENERATION_RECONCILIATION_BLOCKED",
    );
  }
  const workflowBinding = workflowBindingFromOptions(options);
  const groupRunScope = {
    accountId,
    canvasId: input.canvasId,
    fixtureScopeId: options.fixtureScopeId ?? "",
  };
  const withCanvasAdmission = <T>(work: () => Promise<T> | T) =>
    options.canvasAdmissionAlreadyHeld
      ? Promise.resolve().then(work)
      : runWithGroupRunCanvasAdmission(input.canvasId, work);
  await assertNoConflictingGroupRun(
    groupRunScope,
    input.nodeId,
    options.workflowRunId,
  );
  const intentRead = readSubmissionIntentState(
    accountId,
    kind,
    input.canvasId,
    input.nodeId,
    options.fixtureScopeId ?? "",
  );
  const strictIdentity = {
    generationInputKey: options.generationInputKey?.trim() || undefined,
    generationOwnershipKey:
      options.generationOwnershipKey?.trim() || undefined,
    modelInputContractFingerprint:
      options.modelInputContractFingerprint?.trim() || undefined,
    modelConfigurationRevision:
      options.modelConfigurationRevision?.trim() || undefined,
    modelReleaseRevision: options.modelReleaseRevision?.trim() || undefined,
  };
  const modernIdentityRequired = accountId.trim().length > 0 ||
    workflowBinding !== undefined;
  let replacesTaskId = options.replacesTaskId?.trim() || undefined;
  if (modernIdentityRequired && !generationIdentityIsComplete(strictIdentity)) {
    throw new GenerationRequestError(
      "生成请求缺少完整版本化输入身份，已在提交前停止",
      409,
      "GENERATION_IDENTITY_INCOMPLETE",
    );
  }
  let recoveredFromCorruptIntent: GenerationTaskSummary | undefined;
  let intent: GenerationSubmissionIntent;
  if (intentRead.status === "corrupted") {
    if (!generationIdentityIsComplete(strictIdentity)) {
      throw new GenerationRequestError(
        "生成请求记录需要完整输入身份才能安全核对，为避免重复付费暂未提交",
        409,
        "GENERATION_INTENT_CORRUPTED",
      );
    }
    const repaired = await withCanvasAdmission(
      async () => {
        await assertNoConflictingGroupRun(
          groupRunScope,
          input.nodeId,
          options.workflowRunId,
        );
        const nodeTasks = (await listGenerationTasks(
          input.canvasId,
          undefined,
          options.fixtureScopeId ?? "",
        )).filter(
          (task) => task.kind === kind && task.nodeId === input.nodeId &&
            (task.fixtureScopeId ?? "") === (options.fixtureScopeId ?? ""),
        );
        const exactMatches = nodeTasks.filter((task) =>
          task.id !== replacesTaskId &&
          task.generationIdentityVersion === 2 &&
          generationIdentityIsComplete(task) &&
          taskMatchesGenerationIdentity(task, strictIdentity) &&
          (!workflowBinding || taskMatchesWorkflowBinding(task, workflowBinding))
        );
        if (exactMatches.length > 1) {
          throw new GenerationRequestError(
            "服务器存在多条相同输入任务，系统将保留证据并停止重复提交",
            409,
            "GENERATION_INTENT_CORRUPTED",
          );
        }
        const authoritative = exactMatches[0];
        if (authoritative) {
          if (!authoritative.idempotencyKey) {
            throw new GenerationRequestError(
              "原生成任务缺少可验证的提交身份，系统已停止重复提交",
              409,
              "GENERATION_INTENT_CORRUPTED",
            );
          }
          const recoveredIntent = replacementGenerationSubmissionIntent(
            kind,
            input,
            options,
            authoritative.idempotencyKey,
            authoritative.id,
          );
          replaceCorruptedSubmissionIntent(
            accountId,
            intentRead.raw,
            recoveredIntent,
          );
          return { intent: recoveredIntent, task: authoritative };
        }
        const unresolved = nodeTasks.some((task) =>
          ["queued", "running", "retrying", "recovering"].includes(task.state) ||
          task.retryBlockCode === "RETRY_OUTCOME_UNKNOWN"
        );
        if (unresolved) {
          throw new GenerationRequestError(
            "服务器仍有无法归属的原任务，系统将继续核对且不会重复提交",
            409,
            "GENERATION_INTENT_CORRUPTED",
          );
        }
        const replacement = replacementGenerationSubmissionIntent(
          kind,
          input,
          options,
        );
        replaceCorruptedSubmissionIntent(accountId, intentRead.raw, replacement);
        return { intent: replacement };
      },
    );
    intent = repaired.intent;
    recoveredFromCorruptIntent = repaired.task;
  } else if (intentRead.status === "missing" && modernIdentityRequired) {
    const recovered = await withCanvasAdmission(
      async () => {
        await assertNoConflictingGroupRun(
          groupRunScope,
          input.nodeId,
          options.workflowRunId,
        );
        const nodeTasks = (await listGenerationTasks(
          input.canvasId,
          undefined,
          options.fixtureScopeId ?? "",
        )).filter(
          (task) => task.kind === kind && task.nodeId === input.nodeId &&
            (task.fixtureScopeId ?? "") === (options.fixtureScopeId ?? ""),
        );
        const exactMatches = nodeTasks.filter((task) =>
          task.id !== replacesTaskId &&
          task.generationIdentityVersion === 2 &&
          generationIdentityIsComplete(task) &&
          taskMatchesGenerationIdentity(task, strictIdentity) &&
          (!workflowBinding || taskMatchesWorkflowBinding(task, workflowBinding))
        );
        if (exactMatches.length > 1) {
          throw new GenerationRequestError(
            "服务器存在多条相同输入任务，系统将保留证据并停止重复提交",
            409,
            "GENERATION_IDENTITY_AMBIGUOUS",
          );
        }
        const authoritative = exactMatches[0];
        if (authoritative) {
          // Failed workflow projection may have cleared the node binding. A
          // deliberate Generate click is a new intent only when the exact
          // server task has a settled failure and its complete ledger allows
          // replacement. Admission still rechecks that decision atomically.
          if (!workflowBinding && authoritative.state === "failed" &&
            authoritative.newGenerationAllowed === true) {
            replacesTaskId = authoritative.id;
            options = { ...options, replacesTaskId };
            return undefined;
          }
          if (!authoritative.idempotencyKey) {
            throw new GenerationRequestError(
              "原生成任务缺少可验证的提交身份，系统已停止重复提交",
              409,
              "GENERATION_IDENTITY_INCOMPLETE",
            );
          }
          return authoritative;
        }
        const unresolvedIncomplete = nodeTasks.some((task) =>
          (!generationIdentityIsComplete(task) ||
            task.generationIdentityVersion !== 2) &&
          (["queued", "running", "retrying", "recovering"].includes(task.state) ||
            task.retryBlockCode === "RETRY_OUTCOME_UNKNOWN")
        );
        if (unresolvedIncomplete) {
          throw new GenerationRequestError(
            "服务器仍有旧版任务正在安全核对；完整身份确认前不会重复提交",
            409,
            "GENERATION_IDENTITY_INCOMPLETE",
          );
        }
        return undefined;
      },
    );
    if (recovered) {
      intent = replacementGenerationSubmissionIntent(
        kind,
        input,
        options,
        recovered.idempotencyKey,
        recovered.id,
      );
      writeSubmissionIntent(accountId, intent);
      recoveredFromCorruptIntent = recovered;
    } else {
      intent = prepareGenerationSubmission(accountId, kind, input, options);
    }
  } else {
    intent = prepareGenerationSubmission(accountId, kind, input, options);
  }
  const existing = recoveredFromCorruptIntent ??
    await getGenerationTaskByIdempotency(
      input.canvasId,
      intent.idempotencyKey,
      options.fixtureScopeId ?? "",
    );
  if (existing) {
    if (
      existing.canvasId !== input.canvasId ||
      (existing.fixtureScopeId ?? "") !== (options.fixtureScopeId ?? "") ||
      existing.kind !== kind ||
      existing.nodeId !== input.nodeId ||
      (modernIdentityRequired && (
        existing.generationIdentityVersion !== 2 ||
        !generationIdentityIsComplete(existing) ||
        !generationIdentityIsComplete(intent)
      )) ||
      !taskMatchesGenerationIdentity(existing, intent) ||
      (workflowBinding && !taskMatchesWorkflowBinding(existing, workflowBinding))
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
        options.fixtureScopeId ?? "",
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

  const signature = requestSignature(kind, input);
  const nextGenerationInputKey = options.generationInputKey?.trim() || undefined;
  const nextGenerationOwnershipKey =
    options.generationOwnershipKey?.trim() || undefined;
  const nextContractFingerprint =
    options.modelInputContractFingerprint?.trim() || undefined;
  const nextModelConfigurationRevision =
    options.modelConfigurationRevision?.trim() || undefined;
  const nextModelReleaseRevision =
    options.modelReleaseRevision?.trim() || undefined;
  if (
    intent.requestSignature !== signature ||
    intent.generationInputKey !== nextGenerationInputKey ||
    intent.generationOwnershipKey !== nextGenerationOwnershipKey ||
    intent.modelInputContractFingerprint !== nextContractFingerprint ||
    intent.modelConfigurationRevision !== nextModelConfigurationRevision ||
    intent.modelReleaseRevision !== nextModelReleaseRevision
  ) {
    const {
      generationInputKey: _oldInputKey,
      generationOwnershipKey: _oldOwnershipKey,
      modelInputContractFingerprint: _oldContractFingerprint,
      modelConfigurationRevision: _oldModelConfigurationRevision,
      modelReleaseRevision: _oldModelReleaseRevision,
      taskId: _oldTaskId,
      ...sameIntent
    } = intent;
    intent = {
      ...sameIntent,
      ...(nextGenerationInputKey
        ? { generationInputKey: nextGenerationInputKey }
        : {}),
      ...(nextGenerationOwnershipKey
        ? { generationOwnershipKey: nextGenerationOwnershipKey }
        : {}),
      ...(nextContractFingerprint
        ? { modelInputContractFingerprint: nextContractFingerprint }
        : {}),
      ...(nextModelConfigurationRevision
        ? { modelConfigurationRevision: nextModelConfigurationRevision }
        : {}),
      ...(nextModelReleaseRevision
        ? { modelReleaseRevision: nextModelReleaseRevision }
        : {}),
      requestSignature: signature,
      updatedAt: new Date().toISOString(),
    };
    writeSubmissionIntent(accountId, intent);
  }
  const prepared = {
    ...input,
    fixtureScopeId: options.fixtureScopeId ?? "",
    generationIdentityVersion: 2 as const,
    generationInputKey: nextGenerationInputKey,
    generationOwnershipKey: nextGenerationOwnershipKey,
    idempotencyKey: intent.idempotencyKey,
    modelConfigurationRevision: nextModelConfigurationRevision,
    modelInputContractFingerprint: nextContractFingerprint,
    modelReleaseRevision: nextModelReleaseRevision,
    ...(workflowBinding ? { workflowBinding } : {}),
  };

  try {
    return await withCanvasAdmission(async () => {
      await assertNoConflictingGroupRun(
        groupRunScope,
        input.nodeId,
        options.workflowRunId,
      );
      // Preflight, semantic confirmation and the paid boundary share the same
      // cross-tab admission. The server transaction remains the final fence.
      assertCurrentInput?.();
      let preflight: GenerationPreflightResult;
      try {
        preflight = await runAdmissionStep(
          options.admissionRemainingMs,
          "preflight",
          (signal) => preflightGeneration(kind, prepared, signal),
        );
      } catch (error) {
        if (
          error instanceof GenerationRequestError &&
          error.status >= 400 && error.status < 500
        ) throw error;
        if (
          error instanceof GenerationRequestError &&
          error.code === "PREFLIGHT_RETRYABLE"
        ) throw error;
        throw new GenerationRequestError(
          "生成预检暂时未完成，正在自动重试",
          error instanceof GenerationRequestError ? error.status : 0,
          "PREFLIGHT_RETRYABLE",
        );
      }
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
      assertCurrentInput?.();
      const task = await runAdmissionStep(
        options.admissionRemainingMs,
        "formal",
        (signal) => postGeneration(
          kind,
          prepared,
          signal,
          intent.replacesTaskId,
        ),
      );
      if (
        task.canvasId !== input.canvasId ||
        (task.fixtureScopeId ?? "") !== (options.fixtureScopeId ?? "") ||
        task.kind !== kind ||
        task.nodeId !== input.nodeId ||
        (modernIdentityRequired && (
          task.generationIdentityVersion !== 2 ||
          !generationIdentityIsComplete(task) ||
          !taskMatchesGenerationIdentity(task, strictIdentity)
        )) ||
        (workflowBinding && !taskMatchesWorkflowBinding(task, workflowBinding)) ||
        task.state === "cancelled"
      ) {
        throw new GenerationRequestError(
          "生成任务关联不一致，请修改内容后再试",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
      }
      // Persist the accepted task before releasing the cross-tab admission
      // lock so a following group claim can observe authoritative server work.
      rememberGenerationTask(accountId, intent, task);
      return {
        generationOwnershipKey: intent.generationOwnershipKey,
        idempotencyKey: intent.idempotencyKey,
        recovered: false,
        task: taskWithGenerationOwnership(task, intent),
      };
    });
  } catch (error) {
    if (
      error instanceof GenerationRequestError &&
      error.code === "PREFLIGHT_RETRYABLE"
    ) {
      throw error;
    }
    if (
      error instanceof GenerationRequestError &&
      error.status === 409 && error.code === "CANVAS_NOT_SAVED"
    ) {
      const recovered = await getGenerationTaskByIdempotency(
        input.canvasId,
        intent.idempotencyKey,
        options.fixtureScopeId ?? "",
      );
      if (recovered) {
        if (
          recovered.canvasId !== input.canvasId ||
          (recovered.fixtureScopeId ?? "") !== (options.fixtureScopeId ?? "") ||
          recovered.kind !== kind || recovered.nodeId !== input.nodeId ||
          (modernIdentityRequired && (
            !generationIdentityIsComplete(intent) ||
            !generationIdentityIsComplete(recovered) ||
            !taskMatchesGenerationIdentity(recovered, intent)
          )) ||
          (workflowBinding &&
            !taskMatchesWorkflowBinding(recovered, workflowBinding)) ||
          recovered.state === "cancelled"
        ) {
          throw new GenerationRequestError(
            "生成任务关联不一致，请修改内容后再试",
            409,
            "IDEMPOTENCY_CONFLICT",
          );
        }
        rememberGenerationTask(accountId, intent, recovered);
        return {
          generationOwnershipKey: intent.generationOwnershipKey,
          idempotencyKey: intent.idempotencyKey,
          recovered: true,
          task: taskWithGenerationOwnership(recovered, intent),
        };
      }
      // A deterministic revision rejection is before the paid boundary. Keep
      // the exact intent so the bounded caller loop retries with the same key.
      throw error;
    }
    // The POST may have reached the server even when its response did not reach
    // the browser. One read-only reconciliation prevents the next click from
    // creating a second paid task.
    if (mutationOutcomeMayBeUnknown(error)) {
      try {
        const recovered = await getGenerationTaskByIdempotency(
          input.canvasId,
          intent.idempotencyKey,
          options.fixtureScopeId ?? "",
        );
        if (
          recovered &&
          generationIdentityIsComplete(intent) &&
          generationIdentityIsComplete(recovered) &&
          recovered.canvasId === input.canvasId &&
          (recovered.fixtureScopeId ?? "") === (options.fixtureScopeId ?? "") &&
          recovered.kind === kind &&
          recovered.nodeId === input.nodeId &&
          taskMatchesGenerationIdentity(recovered, intent) &&
          (!workflowBinding ||
            taskMatchesWorkflowBinding(recovered, workflowBinding)) &&
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
        options.fixtureScopeId ?? "",
      );
    }
    throw error;
  }
}

type GenerationSubmissionIdentityInput = {
  fixtureScopeId?: string;
  generationIdentityVersion: 2;
  generationInputKey: string;
  generationOwnershipKey: string;
  modelConfigurationRevision: string;
  modelInputContractFingerprint: string;
  modelReleaseRevision: string;
};

export async function submitImageGeneration(input: {
  accountId: string;
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
} & GenerationSubmissionIdentityInput): Promise<GenerationTaskSummary> {
  const { accountId, fixtureScopeId = "", ...requestInput } = input;
  return runExclusiveCanvasSubmit(input.canvasId, async () => {
    return runWithGroupRunCanvasAdmission(input.canvasId, async () => {
      await assertNoConflictingGroupRun({
        accountId,
        canvasId: input.canvasId,
        fixtureScopeId,
      }, input.nodeId);
      return readJson(
        await fetch("/api/generation-tasks", {
          body: JSON.stringify({
            ...requestInput,
            fixtureScopeId,
            kind: "image",
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
    });
  });
}

export type GenerationPreflightInput = {
  canvasId: string;
  canvasRevision?: number;
  fixtureScopeId?: string;
  generationIdentityVersion?: 2;
  generationInputKey?: string;
  generationOwnershipKey?: string;
  imageTool?: ImageGenerationToolInput;
  idempotencyKey: string;
  inputSchemaVersion?: 1;
  inputs?: NodeInputSnapshot[];
  model?: string;
  modelConfigurationRevision?: string;
  modelInputContractFingerprint?: string;
  modelReleaseRevision?: string;
  nodeId: string;
  ownPrompt?: string;
  parameters?: unknown;
  prompt: string;
  workflowBinding?: {
    generationInputKey: string;
    generationOwnershipKey: string;
    groupId: string;
    modelConfigurationRevision: string;
    modelReleaseRevision: string;
    runId: string;
  };
};

export type GenerationPreflightResult = {
  canEnqueue: boolean;
  canSubmit: boolean;
  canvasRevision: number;
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
  signal?: AbortSignal,
): Promise<GenerationPreflightResult> {
  const result = await readJson<GenerationPreflightResult>(
    await fetch("/api/generation-tasks/preflight", {
      body: JSON.stringify({ ...input, kind }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    }),
  );
  if (result.canSubmit === false || result.canEnqueue === false) {
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
  if (!Number.isSafeInteger(result.canvasRevision) || result.canvasRevision < 0) {
    throw new GenerationRequestError(
      "服务器未返回可验证的画布版本，已停止本次生成",
      409,
      "CANVAS_REVISION_INVALID",
    );
  }
  if (
    input.canvasRevision !== undefined &&
    result.canvasRevision !== input.canvasRevision
  ) {
    throw new GenerationRequestError(
      "画布内容还在保存，请等待自动保存完成后再试",
      409,
      "CANVAS_NOT_SAVED",
    );
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
  input: TextGenerationInput & { accountId: string } &
    GenerationSubmissionIdentityInput,
): Promise<GenerationTaskSummary> {
  const { accountId, fixtureScopeId = "", ...requestInput } = input;
  return runExclusiveCanvasSubmit(input.canvasId, async () => {
    return runWithGroupRunCanvasAdmission(input.canvasId, async () => {
      await assertNoConflictingGroupRun({
        accountId,
        canvasId: input.canvasId,
        fixtureScopeId,
      }, input.nodeId);
      return readJson(
        await fetch("/api/generation-tasks", {
          body: JSON.stringify({ ...requestInput, fixtureScopeId, kind: "text" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
    });
  });
}

export async function submitVideoGeneration(input: {
  accountId: string;
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
} & GenerationSubmissionIdentityInput): Promise<GenerationTaskSummary> {
  const { accountId, fixtureScopeId = "", ...requestInput } = input;
  return runExclusiveCanvasSubmit(input.canvasId, async () => {
    return runWithGroupRunCanvasAdmission(input.canvasId, async () => {
      await assertNoConflictingGroupRun({
        accountId,
        canvasId: input.canvasId,
        fixtureScopeId,
      }, input.nodeId);
      return readJson(
        await fetch("/api/generation-tasks", {
          body: JSON.stringify({ ...requestInput, fixtureScopeId, kind: "video" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
    });
  });
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
  accountId: string;
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
} & GenerationSubmissionIdentityInput): Promise<GenerationTaskSummary> {
  const { accountId, fixtureScopeId = "", ...requestInput } = input;
  return runExclusiveCanvasSubmit(input.canvasId, async () => {
    return runWithGroupRunCanvasAdmission(input.canvasId, async () => {
      await assertNoConflictingGroupRun({
        accountId,
        canvasId: input.canvasId,
        fixtureScopeId,
      }, input.nodeId);
      return readJson(
        await fetch("/api/generation-tasks", {
          body: JSON.stringify({ ...requestInput, fixtureScopeId, kind: "audio" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
    });
  });
}

function waitForTaskStatusDelay(delayMs: number, signal?: AbortSignal) {
  assertStatusReadActive(signal);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function waitForGenerationTask(
  taskId: string,
  signal?: AbortSignal,
  fixtureScopeId = "",
  options: {
    followReplacementTask?: boolean;
    retryTransientStatusReads?: boolean;
  } = {},
) {
  const readCurrentTask = async () => {
    const retryDelays = options.retryTransientStatusReads ? [1_000, 2_000] : [];
    for (let failure = 0; ; failure += 1) {
      assertStatusReadActive(signal);
      try {
        return await getGenerationTask(taskId, signal, fixtureScopeId, {
          followReplacementTask: options.followReplacementTask,
          retryTransientStatusReads: false,
        });
      } catch (error) {
        assertStatusReadActive(signal);
        if (!(error instanceof GenerationTaskStatusReadError) ||
          !error.retryable || failure >= retryDelays.length) throw error;
        await waitForTaskStatusDelay(retryDelays[failure], signal);
      }
    }
  };
  // Generic relay media is allowed to poll for at most 15 minutes server-side.
  // Keep the browser waiting slightly longer so it never reports a false local
  // failure while the durable server task is still running.
  for (let attempt = 0; attempt < 1800; attempt += 1) {
    const task = await readCurrentTask();
    const projectionPending = task.generationIdentityVersion === 2 &&
      task.state === "success" &&
      (task.canvasProjectionState === "pending" ||
        task.canvasProjectionState === "failed");
    if (!projectionPending &&
      ["success", "failed", "cancelled"].includes(task.state)) return task;
    await waitForTaskStatusDelay(1_000, signal);
  }
  // The server task is still active after the local waiting window. Return the
  // current snapshot so the caller can keep the breathing light and continue
  // with automatic recovery instead of showing a red error.
  return readCurrentTask();
}
