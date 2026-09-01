export type ServerWorkflowRun = Readonly<{
  canvasId: string;
  createdAt: string;
  errorCode?: string;
  errorMessage?: string;
  groupId: string;
  id: string;
  lockedNodeIds: readonly string[];
  nodes: readonly Readonly<{
    errorCode?: string;
    errorMessage?: string;
    id: string;
    kind: "text" | "image" | "video" | "audio";
    projectionState: "pending" | "applied" | "conflict" | "failed";
    state: "pending" | "admitting" | "admitted" | "success" | "failed" | "blocked" | "cancelled";
    taskId?: string;
  }>[];
  semanticFingerprint: string;
  state: "running" | "stopping" | "success" | "failed" | "cancelled";
  updatedAt: string;
}>;

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new WorkflowRunHttpError(
      typeof body.error === "string" ? body.error : "整组执行请求失败",
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

function waitForNextPoll(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 1_000);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function createServerWorkflowRun(input: {
  canvasId: string;
  clientSemanticFingerprint: string;
  groupId: string;
  signal?: AbortSignal;
}) {
  const response = await fetch("/api/workflow-runs", {
    body: JSON.stringify({
      canvasId: input.canvasId,
      clientSemanticFingerprint: input.clientSemanticFingerprint,
      groupId: input.groupId,
    }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: input.signal,
  });
  return await responseJson(response) as ServerWorkflowRun;
}

export async function getServerWorkflowRun(runId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/workflow-runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  return await responseJson(response) as ServerWorkflowRun;
}

export async function listServerWorkflowRuns(
  canvasId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/workflow-runs?canvasId=${encodeURIComponent(canvasId)}`,
    {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    },
  );
  const body = await responseJson(response) as { runs?: ServerWorkflowRun[] };
  return Array.isArray(body.runs) ? body.runs : [];
}

export async function stopServerWorkflowRun(runId: string) {
  const response = await fetch(
    `/api/workflow-runs/${encodeURIComponent(runId)}/stop`,
    {
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
    },
  );
  return await responseJson(response) as ServerWorkflowRun;
}

export async function waitForServerWorkflowRun(
  runId: string,
  signal?: AbortSignal,
) {
  for (;;) {
    let run: ServerWorkflowRun;
    try {
      run = await getServerWorkflowRun(runId, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const retryable = error instanceof TypeError ||
        (error instanceof WorkflowRunHttpError &&
          (error.status === 408 || error.status === 429 || error.status >= 500));
      if (!retryable) throw error;
      // A transient status read must not unlock a workflow that the server is
      // still executing. Keep polling the same durable run id.
      await waitForNextPoll(signal);
      continue;
    }
    if (["success", "failed", "cancelled"].includes(run.state)) return run;
    await waitForNextPoll(signal);
  }
}
