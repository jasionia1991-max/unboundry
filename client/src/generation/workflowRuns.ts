import {
  parseWorkflowContinuationCreateResponse,
  parseWorkflowContinuationPreview,
  parseWorkflowContinuationRelationResponse,
  parseWorkflowRunSummary,
  parseWorkflowRunsEnvelope,
  type WorkflowContinuationCreateResponse,
  type WorkflowContinuationPreview,
  type WorkflowContinuationRelationResponse,
  type WorkflowRunSummary as ServerWorkflowRun,
} from "../../../types/workflowRuns";

export type { ServerWorkflowRun };

export const SERVER_WORKFLOW_RUN_UPDATED_EVENT =
  "unboundry:server-workflow-run-updated";

export type ServerWorkflowRunUpdatedEventDetail = Readonly<{
  accountId: string;
  canvasId: string;
  fixtureScopeId: string;
  run: ServerWorkflowRun;
}>;

const WORKFLOW_RUN_REQUEST_TIMEOUT_MS = 30_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseServerWorkflowRunUpdatedEventDetail(
  value: unknown,
): ServerWorkflowRunUpdatedEventDetail {
  if (
    !record(value) ||
    Object.keys(value).sort().join(",") !==
      "accountId,canvasId,fixtureScopeId,run" ||
    typeof value.accountId !== "string" || value.accountId.length > 200 ||
    typeof value.canvasId !== "string" || value.canvasId.length < 1 ||
    value.canvasId.length > 200 ||
    typeof value.fixtureScopeId !== "string" ||
    value.fixtureScopeId.length > 200
  ) throw new Error("Workflow run event scope is invalid");
  const run = parseWorkflowRunSummary(value.run);
  if (run.canvasId !== value.canvasId) {
    throw new Error("Workflow run event identity is invalid");
  }
  return Object.freeze({
    accountId: value.accountId,
    canvasId: value.canvasId,
    fixtureScopeId: value.fixtureScopeId,
    run,
  });
}

async function responseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new WorkflowRunHttpError(
      record(body) && typeof body.error === "string"
        ? body.error
        : "整组执行请求失败",
      response.status,
    );
  }
  return body;
}

class WorkflowRunHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorkflowRunHttpError";
  }
}

export function workflowRunStatusReadIsRetryable(error: unknown) {
  return error instanceof TypeError ||
    (error instanceof Error && error.name === "TimeoutError") ||
    (error instanceof WorkflowRunHttpError &&
      (error.status === 408 || error.status === 429 || error.status >= 500));
}

export function workflowRunCreateOutcomeIsUncertain(error: unknown) {
  return !(error instanceof WorkflowRunHttpError) ||
    workflowRunStatusReadIsRetryable(error);
}

async function boundedWorkflowRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  parentSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(
    parentSignal?.reason ?? new DOMException("Aborted", "AbortError"),
  );
  if (parentSignal?.aborted) relayAbort();
  else parentSignal?.addEventListener("abort", relayAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException(
      "Workflow run request timed out",
      "TimeoutError",
    )),
    WORKFLOW_RUN_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await responseJson(response);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", relayAbort);
  }
}

function waitForNextPoll(signal?: AbortSignal, delayMs = 1_000) {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(1, delayMs));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function createServerWorkflowRun(input: {
  canvasId: string;
  clientSemanticFingerprint: string;
  groupId: string;
  signal?: AbortSignal;
}) {
  const body = await boundedWorkflowRequest("/api/workflow-runs", {
    body: JSON.stringify({
      canvasId: input.canvasId,
      clientSemanticFingerprint: input.clientSemanticFingerprint,
      groupId: input.groupId,
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }, input.signal);
  const run = parseWorkflowRunSummary(body);
  if (
    run.canvasId !== input.canvasId ||
    run.groupId !== input.groupId ||
    run.clientSemanticFingerprint !== input.clientSemanticFingerprint
  ) throw new Error("Workflow create response identity is invalid");
  return run;
}

export async function getServerWorkflowRun(runId: string, signal?: AbortSignal) {
  const body = await boundedWorkflowRequest(
    `/api/workflow-runs/${encodeURIComponent(runId)}`,
    {
    cache: "no-store",
    credentials: "same-origin",
    },
    signal,
  );
  const run = parseWorkflowRunSummary(body);
  if (run.id !== runId) throw new Error("Workflow get response identity is invalid");
  return run;
}

export async function getServerWorkflowContinuationPreview(
  parentRunId: string,
  signal?: AbortSignal,
): Promise<WorkflowContinuationPreview> {
  const body = await boundedWorkflowRequest(
    `/api/workflow-runs/${encodeURIComponent(parentRunId)}/continuation-preview`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
    signal,
  );
  const preview = parseWorkflowContinuationPreview(body);
  if (preview.parentRunId !== parentRunId) {
    throw new Error("Workflow continuation preview identity is invalid");
  }
  return preview;
}

export async function getServerWorkflowContinuation(
  parentRunId: string,
  signal?: AbortSignal,
): Promise<WorkflowContinuationRelationResponse> {
  const body = await boundedWorkflowRequest(
    `/api/workflow-runs/${encodeURIComponent(parentRunId)}/continuation`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
    signal,
  );
  const relation = parseWorkflowContinuationRelationResponse(body);
  if (
    relation.continuation &&
    relation.continuation.parentRunId !== parentRunId
  ) throw new Error("Workflow continuation relation identity is invalid");
  return relation;
}

const CONTINUATION_RECONCILIATION_RETRY_DELAYS_MS = [
  250,
  750,
  1_500,
  3_000,
] as const;
const CONTINUATION_RECONCILIATION_SLOW_RECHECK_MS = 15_000;

function waitForContinuationReconciliation(
  signal: AbortSignal,
  delayMs: number,
) {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    );
  }
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(1, delayMs));
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Reconcile an uncertain continuation POST using GET-only reads.
 *
 * Once the POST may have reached the server, retrying POST could create a
 * second downstream run. The submit lock is owned by the caller's POST
 * window; this helper keeps the caller-owned scope signal, follows the
 * durable parent->child relation, and only performs bounded/backoff GETs. A
 * caller-owned signal ends the loop when the component/account/canvas scope
 * is gone. With no explicit deadline the slow read-only recheck continues
 * until that scope ends, so a long backend restart does not become a manual
 * retry request.
 */
export async function reattachSubmittedServerWorkflowContinuation(input: {
  parentRunId: string;
  previewDigest: string;
  deadlineMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}) {
  const unknownError = new Error(
    "继续请求已提交，系统正在自动核对；原整组记录已保留，暂时不用重试",
  );
  const deadlineMs = input.deadlineMs === undefined
    ? undefined
    : Math.max(1, Math.min(input.deadlineMs, 90_000));
  const controller = new AbortController();
  const relayAbort = () => controller.abort(
    input.signal?.reason ?? new DOMException("Aborted", "AbortError"),
  );
  if (input.signal?.aborted) relayAbort();
  else input.signal?.addEventListener("abort", relayAbort, { once: true });
  const deadlineTimer = deadlineMs === undefined
    ? undefined
    : setTimeout(() => controller.abort(unknownError), deadlineMs);
  const startedAt = Date.now();
  const throwForAbort = (error: unknown): never => {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }
    if (controller.signal.aborted) throw unknownError;
    throw error;
  };
  let attempt = 0;
  try {
    for (;;) {
      if (deadlineMs !== undefined && Date.now() - startedAt >= deadlineMs) {
        throw unknownError;
      }
      try {
        const relation = await getServerWorkflowContinuation(
          input.parentRunId,
          controller.signal,
        );
        const continuation = relation.continuation;
        if (continuation) {
          if (continuation.previewDigest !== input.previewDigest) {
            throw new Error("继续请求的画布身份已变化，原记录已保留");
          }
          const child = await getServerWorkflowRun(
            continuation.childRunId,
            controller.signal,
          );
          if (
            child.id !== continuation.childRunId ||
            child.canvasId.length < 1
          ) throw new Error("继续请求返回的后继任务身份无效");
          return child;
        }
      } catch (error) {
        if (controller.signal.aborted) throwForAbort(error);
        if (!workflowRunStatusReadIsRetryable(error)) throw error;
      }
      const delay = CONTINUATION_RECONCILIATION_RETRY_DELAYS_MS[attempt] ??
        input.pollIntervalMs ?? CONTINUATION_RECONCILIATION_SLOW_RECHECK_MS;
      attempt += 1;
      try {
        await waitForContinuationReconciliation(controller.signal, delay);
      } catch (error) {
        throwForAbort(error);
      }
    }
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    input.signal?.removeEventListener("abort", relayAbort);
  }
}

export async function continueServerWorkflowRun(input: {
  intentId: string;
  parentRunId: string;
  previewDigest: string;
  signal?: AbortSignal;
}): Promise<WorkflowContinuationCreateResponse> {
  if (!input.intentId || input.intentId.length > 256 ||
      !input.previewDigest || input.previewDigest.length > 256) {
    throw new Error("Workflow continuation intent is invalid");
  }
  const body = await boundedWorkflowRequest(
    `/api/workflow-runs/${encodeURIComponent(input.parentRunId)}/continue`,
    {
      body: JSON.stringify({
        intentId: input.intentId,
        previewDigest: input.previewDigest,
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    input.signal,
  );
  const result = parseWorkflowContinuationCreateResponse(body);
  if (
    result.continuation.parentRunId !== input.parentRunId ||
    result.continuation.previewDigest !== input.previewDigest ||
    result.run.id !== result.continuation.childRunId ||
    result.run.canvasId.length < 1
  ) throw new Error("Workflow continuation response identity is invalid");
  return result;
}

export async function listServerWorkflowRuns(
  canvasId: string,
  signal?: AbortSignal,
) {
  const body = await boundedWorkflowRequest(
    `/api/workflow-runs?canvasId=${encodeURIComponent(canvasId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
    },
    signal,
  );
  const runs = parseWorkflowRunsEnvelope(body).runs;
  if (runs.some((run) => run.canvasId !== canvasId)) {
    throw new Error("Workflow list response identity is invalid");
  }
  if (new Set(runs.map(({ id }) => id)).size !== runs.length) {
    throw new Error("Workflow list response contains duplicate identities");
  }
  return runs;
}

export async function reattachSubmittedServerWorkflowRun(input: {
  canvasId: string;
  clientSemanticFingerprint: string;
  deadlineMs?: number;
  groupId: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  startedAt: number;
}) {
  const reconciliationUnknownError = new Error(
    "服务端接收结果仍不明确；已保留本次锁定，请刷新页面继续只读核对，系统不会重复提交",
  );
  const reconciliationStartedAt = Date.now();
  const deadlineMs = Math.max(
    1,
    Math.min(input.deadlineMs ?? 90_000, 90_000),
  );
  const reconciliationController = new AbortController();
  const relayParentAbort = () => reconciliationController.abort(
    input.signal?.reason ?? new DOMException("Aborted", "AbortError"),
  );
  if (input.signal?.aborted) relayParentAbort();
  else input.signal?.addEventListener("abort", relayParentAbort, { once: true });
  const deadlineTimer = setTimeout(
    () => reconciliationController.abort(reconciliationUnknownError),
    deadlineMs,
  );
  const throwForReconciliationAbort = (error: unknown): never => {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? error;
    }
    if (reconciliationController.signal.aborted) {
      throw reconciliationUnknownError;
    }
    throw error;
  };
  try {
    for (;;) {
      if (input.signal?.aborted) {
        throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (
        reconciliationController.signal.aborted ||
        Date.now() - reconciliationStartedAt >= deadlineMs
      ) throwForReconciliationAbort(reconciliationUnknownError);
      let runs: readonly ServerWorkflowRun[];
      try {
        runs = await listServerWorkflowRuns(
          input.canvasId,
          reconciliationController.signal,
        );
      } catch (error) {
        if (reconciliationController.signal.aborted) {
          throwForReconciliationAbort(error);
        }
        if (!workflowRunStatusReadIsRetryable(error)) throw error;
        // Once the POST may have reached the server, a failed read is not
        // evidence that it is safe to submit again. Keep the local lock and use
        // read-only reconciliation until the exact run becomes visible.
        try {
          await waitForNextPoll(
            reconciliationController.signal,
            input.pollIntervalMs,
          );
        } catch (pollError) {
          throwForReconciliationAbort(pollError);
        }
        continue;
      }
      const matching = runs.find((run) =>
        run.canvasId === input.canvasId &&
        run.groupId === input.groupId &&
        run.clientSemanticFingerprint === input.clientSemanticFingerprint &&
        Date.parse(run.createdAt) >= input.startedAt - 1_000
      );
      if (matching) return matching;
      const conflicting = runs.find((run) =>
        run.groupId === input.groupId &&
        run.clientSemanticFingerprint !== input.clientSemanticFingerprint &&
        (run.state === "running" || run.state === "stopping")
      );
      if (conflicting) {
        throw new Error(
          "服务端已有同组整组执行，当前画布身份不同；已阻止重复提交",
        );
      }
      try {
        await waitForNextPoll(
          reconciliationController.signal,
          input.pollIntervalMs,
        );
      } catch (pollError) {
        throwForReconciliationAbort(pollError);
      }
    }
  } finally {
    clearTimeout(deadlineTimer);
    input.signal?.removeEventListener("abort", relayParentAbort);
  }
}

export function mergeServerWorkflowRuns(
  current: readonly ServerWorkflowRun[],
  incoming: readonly ServerWorkflowRun[],
) {
  const merged = new Map(current.map((run) => [run.id, run]));
  for (const run of incoming) {
    const existing = merged.get(run.id);
    if (!existing || Date.parse(run.updatedAt) > Date.parse(existing.updatedAt)) {
      merged.set(run.id, run);
    }
  }
  return [...merged.values()].sort((left, right) =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}

export function activeServerWorkflowNodeIds(run: ServerWorkflowRun) {
  return new Set(
    run.nodes
      .filter(({ state, kind, errorCode }) => state === "admitted" &&
        !(kind === "video" &&
          (errorCode === "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED" ||
          errorCode === "AUTOMATIC_RECOVERY_PENDING")))
      .map(({ id }) => id),
  );
}

/**
 * A workflow node can remain admitted while its original paid attempt is
 * durably waiting for maintenance after the automatic recovery window. Keep
 * the group run and its stop control alive, but let the Canvas clear that
 * node's active spinner from the persisted server marker.
 */
export function stoppedServerWorkflowNodeIds(run: ServerWorkflowRun) {
  return new Set(
    run.nodes
      .filter(({ state, kind, errorCode }) => state === "admitted" &&
        kind === "video" &&
        (errorCode === "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED" ||
          errorCode === "AUTOMATIC_RECOVERY_PENDING"))
      .map(({ id }) => id),
  );
}

export async function stopServerWorkflowRun(
  runId: string,
  signal?: AbortSignal,
) {
  const body = await boundedWorkflowRequest(
    `/api/workflow-runs/${encodeURIComponent(runId)}/stop`,
    {
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
    },
    signal,
  );
  const run = parseWorkflowRunSummary(body);
  if (run.id !== runId) throw new Error("Workflow stop response identity is invalid");
  return run;
}

export async function stopServerWorkflowRunAndConfirm(
  runId: string,
  signal?: AbortSignal,
) {
  try {
    return await stopServerWorkflowRun(runId, signal);
  } catch (stopError) {
    if (signal?.aborted) throw stopError;
    try {
      const current = await getServerWorkflowRun(runId, signal);
      if (current.state !== "running") return current;
    } catch {
      // Preserve the original stop failure. A read failure is not evidence
      // that the server accepted the stop request.
    }
    throw stopError;
  }
}

export async function waitForServerWorkflowRun(
  runId: string,
  signal?: AbortSignal,
  deadlineMs = 24 * 60 * 60_000,
  onUpdate?: (run: ServerWorkflowRun) => void,
) {
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > Math.max(1_000, Math.min(deadlineMs, 24 * 60 * 60_000))) {
      throw new Error("整组执行状态等待超时；服务端仍会保留原任务并禁止重复提交");
    }
    let run: ServerWorkflowRun;
    try {
      run = await getServerWorkflowRun(runId, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!workflowRunStatusReadIsRetryable(error)) throw error;
      // A transient status read must not unlock a workflow that the server is
      // still executing. Keep polling the same durable run id.
      await waitForNextPoll(signal);
      continue;
    }
    onUpdate?.(run);
    if (["success", "failed", "cancelled"].includes(run.state)) return run;
    await waitForNextPoll(signal);
  }
}
