import { expect, test } from "./safe-test";
import {
  reattachSubmittedServerWorkflowContinuation,
} from "../client/src/generation/workflowRuns";

const parentRunId = "11111111-1111-4111-8111-111111111111";
const childRunId = "22222222-2222-4222-8222-222222222222";
const previewDigest = "wf1-preview-digest";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function continuationSummary(digest = previewDigest) {
  return {
    childRunId,
    continuationId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-09-10T00:00:00.000Z",
    intentId: "m112-continuation-intent",
    parentRunId,
    previewDigest: digest,
    updatedAt: "2026-09-10T00:00:01.000Z",
  };
}

function childRun() {
  return {
    canvasId: "m112-canvas",
    clientSemanticFingerprint: "wf1-m112-client",
    createdAt: "2026-09-10T00:00:00.000Z",
    groupId: "m112-group",
    id: childRunId,
    lockedNodeIds: ["m112-video"],
    nodes: [{
      id: "m112-video",
      kind: "video",
      projectionState: "pending",
      state: "pending",
    }],
    semanticFingerprint: "wf1-m112-child",
    state: "running",
    updatedAt: "2026-09-10T00:00:01.000Z",
  };
}

function installFetch(
  handler: (url: URL, init?: RequestInit) => Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(new URL(String(input), "http://127.0.0.1"), init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("R13 uncertain continuation POST is reconciled by GET-only relation and child reads", async () => {
  const requests: Array<{ method: string; path: string }> = [];
  let relationReads = 0;
  const restore = installFetch(async (url, init) => {
    requests.push({ method: init?.method ?? "GET", path: url.pathname });
    if (url.pathname.endsWith("/continuation")) {
      relationReads += 1;
      return relationReads < 2
        ? jsonResponse({ continuation: null })
        : jsonResponse({ continuation: continuationSummary() });
    }
    if (url.pathname.endsWith(`/${childRunId}`)) return jsonResponse(childRun());
    throw new Error(`unexpected GET ${url.pathname}`);
  });
  try {
    const result = await reattachSubmittedServerWorkflowContinuation({
      parentRunId,
      previewDigest,
      deadlineMs: 2_000,
      pollIntervalMs: 1,
    });
    expect(result.id).toBe(childRunId);
    expect(relationReads).toBeGreaterThanOrEqual(2);
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
    expect(requests.some(({ method }) => method === "POST")).toBe(false);
  } finally {
    restore();
  }
});

test("R13 continuation relation with a different preview digest is rejected and never follows the wrong child", async () => {
  const paths: string[] = [];
  const restore = installFetch(async (url, init) => {
    paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/continuation")) {
      return jsonResponse({ continuation: continuationSummary("different-preview") });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  });
  try {
    await expect(reattachSubmittedServerWorkflowContinuation({
      parentRunId,
      previewDigest,
      deadlineMs: 1_000,
    })).rejects.toThrow("画布身份已变化");
    expect(paths).toEqual([`GET /api/workflow-runs/${parentRunId}/continuation`]);
  } finally {
    restore();
  }
});

test("R13 a continuation with no visible relation keeps read-only polling alive until its scope aborts", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalFetch = globalThis.fetch;
  let relationReads = 0;
  let postReads = 0;
  const controller = new AbortController();
  // Accelerate the retry schedule only inside this test. The product still
  // uses its 250/750/1500/3000ms burst and 15s slow recheck values.
  globalThis.setTimeout = ((
    handler: (...args: unknown[]) => void,
    timeout?: number,
    ...args: unknown[]
  ) => originalSetTimeout(
    handler,
    Math.min(Number(timeout ?? 0), 2),
    ...args,
  )) as typeof setTimeout;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://127.0.0.1");
    if (init?.method === "POST") postReads += 1;
    if (url.pathname.endsWith("/continuation")) {
      relationReads += 1;
      return jsonResponse({ continuation: null });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  }) as typeof fetch;
  const result = reattachSubmittedServerWorkflowContinuation({
    parentRunId,
    previewDigest,
    signal: controller.signal,
  });
  try {
    await new Promise<void>((resolve) => originalSetTimeout(() => {
      controller.abort("m112-scope-ended");
      resolve();
    }, 30));
    await expect(result).rejects.toBe("m112-scope-ended");
    expect(relationReads).toBeGreaterThan(1);
    expect(postReads).toBe(0);
  } finally {
    controller.abort("m112-cleanup");
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("R13 a transient child status error recovers automatically without another POST", async () => {
  const methods: string[] = [];
  let childReads = 0;
  const restore = installFetch(async (url, init) => {
    methods.push(init?.method ?? "GET");
    if (url.pathname.endsWith("/continuation")) {
      return jsonResponse({ continuation: continuationSummary() });
    }
    childReads += 1;
    return childReads === 1
      ? jsonResponse({ error: "temporary interruption" }, 503)
      : jsonResponse(childRun());
  });
  try {
    const result = await reattachSubmittedServerWorkflowContinuation({
      parentRunId, previewDigest, deadlineMs: 2_000,
    });
    expect(result.id).toBe(childRunId);
    expect(childReads).toBe(2);
    expect(methods).toEqual(["GET", "GET", "GET", "GET"]);
  } finally { restore(); }
});
