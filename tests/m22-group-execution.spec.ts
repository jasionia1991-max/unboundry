import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "./safe-test";
import {
  buildWorkflowLayers,
  isExecutableWorkflowNode,
  runWorkflowGraph,
  runWorkflowLayers,
  workflowModelSelectionProblem,
  workflowRuntimePreflightDisposition,
  workflowSubmissionPreflightProblem,
  type WorkflowNodeShape,
} from "../client/src/generation/workflowExecution";
import { friendlyGenerationMessage } from "../client/src/generation/friendlyGenerationMessage";
import { generationNeedsReconcile } from "../client/src/generation/generationRetry";
import { workflowRecoveryPlan } from "../client/src/generation/workflowGenerationRecovery";
import {
  createSaveGateRun,
  runExclusiveCanvasSubmit,
} from "../client/src/generation/saveGate";
import {
  isCanvasNotSavedMessage,
  persistGroupCanvasAfterNode,
  runGroupNodeWithPersist,
  shouldAcceptCanvasRevision,
  shouldIgnoreStaleCanvasSaveProblem,
  stripStaleCanvasSaveErrors,
  workflowToastDurationMs,
} from "../client/src/generation/groupRunPersist";
import {
  dismissGroupRunSummary,
  GROUP_RUN_SUMMARY_CACHE_LIMIT,
  GROUP_RUN_SUMMARY_DISMISSAL_LIMIT,
  groupRunSummaryMatchesScope,
  isGroupRunSummaryDismissed,
  publishGroupRunSummary,
  readLastGroupRunSummaryForGroup,
  type GroupRunSummary,
} from "../client/src/generation/groupRunSummary";
import {
  acquireGroupRunLease,
  clearGroupRunCheckpoint,
  clearGroupRunStarting,
  confirmGroupRunNavigation,
  groupRunSnapshotFingerprint,
  groupRunSuccessProof,
  getGroupRunExecutionOwnerId,
  hasConflictingActiveGroupRunLeaseForCanvas,
  hasForeignActiveGroupRunLeaseForCanvas,
  markGroupRunStarting,
  readGroupRunCheckpoint,
  readGroupRunCheckpoints,
  readGroupRunLease,
  readGroupRunStarting,
  releaseGroupRunLease,
  renewGroupRunLease,
  taskMatchesAcceptedBinding,
  writeGroupRunCheckpoint,
  verifiedCheckpointSuccessIds,
  type GroupRunCheckpoint,
} from "../client/src/generation/groupRunCheckpoint";
import { NodeExecutorRegistry } from "../client/src/generation/nodeExecutorRegistry";
import type { NodeExecutorContext } from
  "../client/src/generation/nodeExecutorRegistry";
import {
  createNodeExecutorRegistry,
  workflowResultOwnerMatches,
} from "../client/src/generation/workflowNodeExecutors";
import type { ProbeNodeType } from "../client/src/canvas/ProbeNode";
import { createCanvasGraphCommandPort } from
  "../client/src/canvas/canvasPorts";
import { defaultParameterSchema } from "../types/modelParameters";
import { resolveNodeInputs } from "../types/nodeInputs";
import {
  reconcileGenerationTask,
  retryGenerationTask,
} from "../client/src/generation/generationTasks";
import {
  enqueueGroupResultProjection,
  groupResultProjectionApplicationId,
  groupResultSemanticRevision,
  mergeGroupResultProjection,
  reconcileGroupResultProjection,
  unresolvedProjectionNodeIds,
  waitForGroupResultProjections,
  type GroupResultProjection,
} from "../client/src/generation/groupResultProjection";
import {
  classifyLegacyTerminalGenerationTask,
  getLegacyTerminalGenerationPolicy,
  isIncompleteLegacyTerminalGenerationBinding,
  legacyTerminalCanvasWriteAllowed,
  legacyTerminalGenerationCandidate,
  legacyTerminalGenerationCandidateStillMatches,
  parseLegacyTerminalGenerationPolicy,
} from "../client/src/generation/legacyTerminalGenerationReconciler";
import {
  effectiveLegacyTerminalGenerationState,
} from "../client/src/generation/legacyTerminalGenerationState";
import type { GenerationTaskSummary } from
  "../client/src/generation/generationTasks";

test("39-node legacy fixture finds exactly five stale candidates across three runs", () => {
  const legacy = [
    ["text", "text-stale-1", "run-a"],
    ["text", "text-stale-2", "run-a"],
    ["image", "image-stale-1", "run-b"],
    ["text", "text-stale-3", "run-c"],
    ["image", "image-stale-2", "run-c"],
  ] as const;
  const nodes: ProbeNodeType[] = [
    ...Array.from({ length: 34 }, (_, index) => ({
      data: { label: `ordinary-${index}` },
      id: `ordinary-${index}`,
      position: { x: index, y: index },
      type: index % 2 === 0 ? "text" as const : "image" as const,
    })),
    ...legacy.map(([kind, nodeId, runId], index) => ({
      data: {
        label: nodeId,
        workflowExecutionRunId: runId,
        [`${kind}Generating`]: true,
        [`${kind}GenerationInputKey`]: `input-${index}`,
        [`${kind}GenerationOwnershipKey`]: `owner-${index}`,
        [`${kind}GenerationTaskId`]: `task-${index}`,
      },
      id: nodeId,
      position: { x: index, y: 100 },
      type: kind,
    })),
  ];
  const candidates = nodes.flatMap((node) => {
    const candidate = legacyTerminalGenerationCandidate({
      accountId: "account-a",
      canvasId: "canvas-a",
      node,
    });
    return candidate ? [candidate] : [];
  });
  expect(nodes).toHaveLength(39);
  expect(candidates).toHaveLength(5);
  expect(candidates.filter((candidate) => candidate.kind === "text")).toHaveLength(3);
  expect(candidates.filter((candidate) => candidate.kind === "image")).toHaveLength(2);
  expect(new Set(candidates.map((candidate) => candidate.runId))).toEqual(
    new Set(["run-a", "run-b", "run-c"]),
  );
});

test("legacy terminal classifier is exact, checksum-complete and fail-closed", () => {
  const node: ProbeNodeType = {
    data: {
      imageGenerating: true,
      imageGenerationInputKey: "input-a",
      imageGenerationOwnershipKey: "owner-a",
      imageGenerationTaskId: "task-a",
      label: "stale image",
      workflowExecutionRunId: "run-a",
    },
    id: "image-a",
    position: { x: 0, y: 0 },
    type: "image",
  };
  const candidate = legacyTerminalGenerationCandidate({
    accountId: "account-a",
    canvasId: "canvas-a",
    node,
  });
  expect(candidate).toBeTruthy();
  if (!candidate) throw new Error("candidate missing");
  const baseTask = {
    attempt: 1,
    canvasId: "canvas-a",
    costCurrency: "CNY",
    createdAt: "2026-08-26T00:00:00.000Z",
    generationInputKey: "input-a",
    generationOwnershipKey: "owner-a",
    id: "task-a",
    kind: "image",
    nodeId: "image-a",
    prompt: "fixture",
    state: "running",
    updatedAt: "2026-08-26T00:00:01.000Z",
    workflowExecutionRunId: "run-a",
  } satisfies GenerationTaskSummary;
  expect(classifyLegacyTerminalGenerationTask({ candidate, task: baseTask }).state)
    .toBe("ACTIVE_CONFIRMED");
  expect(classifyLegacyTerminalGenerationTask({
    candidate,
    task: { ...baseTask, state: "success" },
  }).state).toBe("CONFLICT_PRESERVED");
  const incompleteSuccess = {
    ...baseTask,
    resultAssetId: "asset-a",
    resultUrl: "/api/image-assets/asset-a/content",
    state: "success" as const,
  };
  expect(classifyLegacyTerminalGenerationTask({
    candidate,
    task: incompleteSuccess,
  }).state).toBe("CONFLICT_PRESERVED");
  const completeSuccess = {
    ...incompleteSuccess,
    resultMedia: {
      byteSize: 123,
      checksumSha256: "a".repeat(64),
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable" as const,
      mediaHeight: 512,
      mediaWidth: 512,
      storageBackend: "local" as const,
    },
  };
  expect(classifyLegacyTerminalGenerationTask({
    candidate,
    task: completeSuccess,
  }).state).toBe("RESTORED");
  expect(classifyLegacyTerminalGenerationTask({
    candidate,
    task: { ...completeSuccess, nodeId: "other-node" },
  }).state).toBe("UNKNOWN_BLOCKED");
  for (const task of [
    { ...baseTask, generationInputKey: "other-input" },
    { ...baseTask, generationOwnershipKey: "other-owner" },
    { ...baseTask, workflowExecutionRunId: "other-run" },
  ]) {
    expect(classifyLegacyTerminalGenerationTask({ candidate, task }).state)
      .toBe("UNKNOWN_BLOCKED");
  }
  expect(legacyTerminalGenerationCandidateStillMatches({
    ...node,
    data: { ...node.data, label: "edited after detection" },
  }, candidate)).toBe(false);
});

test("legacy display never breathes before exact classification and partial bindings block", () => {
  expect(legacyTerminalCanvasWriteAllowed({
    webLocksAvailable: false,
    writeEnabled: true,
  })).toBe(false);
  expect(legacyTerminalCanvasWriteAllowed({
    webLocksAvailable: true,
    writeEnabled: false,
  })).toBe(false);
  expect(effectiveLegacyTerminalGenerationState({
    bindingComplete: true,
    hasLegacyRun: true,
    locallyActive: false,
    persistedGenerating: true,
  })).toBe("DETECTING");
  expect(effectiveLegacyTerminalGenerationState({
    bindingComplete: true,
    hasLegacyRun: true,
    locallyActive: true,
    persistedGenerating: true,
  })).toBe("ACTIVE_CONFIRMED");
  expect(effectiveLegacyTerminalGenerationState({
    bindingComplete: false,
    hasLegacyRun: true,
    locallyActive: false,
    persistedGenerating: true,
  })).toBe("UNKNOWN_BLOCKED");
  expect(effectiveLegacyTerminalGenerationState({
    bindingComplete: false,
    hasLegacyRun: true,
    locallyActive: false,
    persistedGenerating: true,
    state: "PASSTHROUGH",
  })).toBe("PASSTHROUGH");
  expect(effectiveLegacyTerminalGenerationState({
    bindingComplete: false,
    hasLegacyRun: false,
    locallyActive: false,
    persistedGenerating: false,
    state: "UNKNOWN_BLOCKED",
  })).toBeUndefined();
  const partial: ProbeNodeType = {
    data: {
      label: "partial",
      textGenerating: true,
      textGenerationTaskId: "task-partial",
      workflowExecutionRunId: "run-partial",
    },
    id: "text-partial",
    position: { x: 0, y: 0 },
    type: "text",
  };
  expect(isIncompleteLegacyTerminalGenerationBinding(partial)).toBe(true);
});

test("legacy policy reads have a real deadline and scope cleanup owns abort", async () => {
  expect(parseLegacyTerminalGenerationPolicy({
    mode: "allowlist",
    writeEnabled: false,
  })).toEqual({ mode: "allowlist", writeEnabled: false });
  for (const malformed of [
    { mode: "unknown", writeEnabled: true },
    { mode: "detect", writeEnabled: true },
    { mode: "on", writeEnabled: false },
    { mode: "off", writeEnabled: "false" },
    { extra: true, mode: "on", writeEnabled: true },
  ]) {
    expect(() => parseLegacyTerminalGenerationPolicy(malformed))
      .toThrow("策略响应格式异常");
  }
  const originalFetch = globalThis.fetch;
  let transportAborted = false;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        transportAborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    })) as typeof globalThis.fetch;
  try {
    await expect(getLegacyTerminalGenerationPolicy(
      "deadline-canvas",
      undefined,
      10,
    )).rejects.toThrow("策略查询超时");
    expect(transportAborted).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const provider = readFileSync(
    "client/src/generation/WorkflowExecutionProvider.tsx",
    "utf8",
  );
  expect(provider).toContain(
    'controller.abort("legacy-terminal-reconciliation-scope-changed")',
  );
  expect(provider).toContain(
    'boundedUnknownRecheck(`classification:${candidateKey}`)',
  );
  expect(provider).toContain('boundedUnknownRecheck(`locks:${candidateKey}`)');
  expect(provider).toContain('result === "deferred"');
  expect(provider).toContain("requestRecheck(1_000)");
});

test("headless workflow registry owns all four executable node kinds", () => {
  expect(createNodeExecutorRegistry().kinds().sort()).toEqual([
    "audio",
    "image",
    "text",
    "video",
  ]);
  const boundNode: ProbeNodeType = {
    data: {
      label: "Text",
      textGenerationOwnershipKey: "owner-a",
      textGenerationTaskId: "task-a",
      workflowExecutionRunId: "run-a",
    },
    id: "text-a",
    position: { x: 0, y: 0 },
    type: "text",
  };
  expect(workflowResultOwnerMatches(boundNode, {
    kind: "text",
    ownershipKey: "owner-a",
    runId: "run-a",
    taskId: "task-a",
  })).toBe(true);
  expect(workflowResultOwnerMatches(boundNode, {
    kind: "text",
    ownershipKey: "owner-a",
    runId: "run-b",
    taskId: "task-a",
  })).toBe(false);
  expect(workflowResultOwnerMatches(undefined, {
    kind: "text",
    ownershipKey: "owner-a",
    runId: "run-a",
    taskId: "task-a",
  })).toBe(false);
});

test("headless workflow registry rejects duplicate executor ownership", () => {
  const executor = {
    kind: "text" as const,
    preflight: async () => ({ status: "success" as const }),
    recover: async () => ({ status: "success" as const }),
    run: async () => ({ status: "success" as const }),
  };
  expect(() => new NodeExecutorRegistry([executor, executor])).toThrow(
    "节点执行器重复注册：text",
  );
});

test("all four headless executors preflight, run, recover and apply without mounted components", async () => {
  const host = globalThis as unknown as { window?: Window };
  const previousWindow = host.window;
  const previousFetch = globalThis.fetch;
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;
  const fakeWindow = new EventTarget() as Window;
  Object.defineProperties(fakeWindow, {
    localStorage: { value: storage },
    navigator: { configurable: true, value: {} },
  });
  host.window = fakeWindow;
  const kinds = ["text", "image", "audio", "video"] as const;
  const runId = "headless-four-kind-run";
  const canvasId = "headless-four-kind-canvas";
  let nodes = kinds.map((kind, index) => ({
    data: {
      label: `${kind} fixture`,
      title: `${kind} fixture`,
      [`${kind}ModelId`]: `headless-${kind}-model`,
      [`${kind}Parameters`]: {},
      [`${kind}Prompt`]: `${kind} headless prompt`,
      ...(kind === "text" ? {} : { [`${kind}PromptReady`]: true }),
    },
    id: `headless-${kind}`,
    position: { x: index * 100, y: 0 },
    type: kind,
  })) as ProbeNodeType[];
  const models = Object.fromEntries(kinds.map((kind) => [kind, [{
    capability: kind,
    displayName: `Headless ${kind}`,
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
    id: `headless-${kind}-model`,
    ...(kind === "image"
      ? {
          imageParameters: {
            aspectRatios: ["auto"],
            maxReferenceImages: 0,
            qualities: ["auto"],
          },
        }
      : {}),
    isDefault: true,
    parameterSchema: defaultParameterSchema(kind),
  }]])) as NodeExecutorContext["modelCatalog"]["models"];
  const tasks = new Map<string, Record<string, unknown>>();
  const boundNodes = new Map<string, ProbeNodeType>();
  const posts: string[] = [];
  const recoveryOrder: string[] = [];
  let flushes = 0;
  let mutateTextSemanticBeforeRead = false;
  const response = (body: unknown, status = 200) => new Response(
    JSON.stringify(body),
    { headers: { "Content-Type": "application/json" }, status },
  );
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (url.startsWith("/api/generation-tasks/by-idempotency")) {
      return response({ error: "not found" }, 404);
    }
    if (url === "/api/generation-tasks/preflight" && method === "POST") {
      return response({ canEnqueue: true, canSubmit: true, problems: [] });
    }
    if (url === "/api/generation-tasks" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        kind: (typeof kinds)[number];
        model: string;
        nodeId: string;
        prompt: string;
      };
      posts.push(body.nodeId);
      const taskId = `headless-task-${body.kind}`;
      const resultAssetId = `headless-result-${body.kind}`;
      const task = {
        attempt: 1,
        canvasId,
        costCurrency: "CNY",
        createdAt: "2026-08-21T00:00:00.000Z",
        id: taskId,
        kind: body.kind,
        model: body.model,
        nodeId: body.nodeId,
        prompt: body.prompt,
        ...(body.kind === "text"
          ? { resultText: "headless text result" }
          : {
              resultAssetId,
              resultMedia: {
                byteSize: 128,
                contentType: body.kind === "image"
                  ? "image/png"
                  : body.kind === "audio"
                    ? "audio/mpeg"
                    : "video/mp4",
                durationSeconds: body.kind === "image" ? null : 2,
                durationStatus: body.kind === "image" ? "not-applicable" : "ready",
                mediaHeight: body.kind === "image" || body.kind === "video" ? 64 : null,
                mediaWidth: body.kind === "image" || body.kind === "video" ? 64 : null,
                storageBackend: "local",
              },
              resultUrl: body.kind === "image"
                ? `/api/assets/${resultAssetId}`
                : body.kind === "audio"
                  ? `/api/audio-assets/${resultAssetId}`
                  : `/api/video-assets/${resultAssetId}`,
            }),
        state: "success",
        updatedAt: "2026-08-21T00:00:01.000Z",
      };
      tasks.set(taskId, task);
      return response({ ...task, state: "running" }, 202);
    }
    const taskId = url.startsWith("/api/generation-tasks/")
      ? url.split("/").at(-1)
      : undefined;
    if (taskId && tasks.has(taskId)) {
      if (taskId === "headless-task-text" && mutateTextSemanticBeforeRead) {
        mutateTextSemanticBeforeRead = false;
        nodes = nodes.map((node) => node.id === "headless-text"
          ? { ...node, data: { ...node.data, textPrompt: "changed after acceptance" } }
          : node);
      }
      recoveryOrder.push(`get:${taskId}`);
      return response(tasks.get(taskId));
    }
    throw new Error(`unexpected headless fetch: ${method} ${url}`);
  }) as typeof fetch;
  let revision = 1;
  const graph = createCanvasGraphCommandPort({
    commit: (snapshot) => {
      nodes = [...snapshot.nodes];
    },
    persistenceReady: () => true,
    snapshot: () => ({ edges: [], nodes, revision }),
  });
  const context = {
    accountId: "headless-account",
    canvasId,
    fixtureScopeId: "",
    graph,
    isCancelled: () => false,
    isFixture: false,
    modelCatalog: { models, status: "ready" },
    runId,
    onTaskAccepted: async (binding: {
      kind: (typeof kinds)[number];
      nodeId: string;
      ownershipKey: string;
      taskId: string;
    }) => {
      recoveryOrder.push(`accepted:${binding.taskId}`);
    },
    save: {
      flush: async () => {
        flushes += 1;
        revision += 1;
        for (const kind of kinds) {
          const node = nodes.find((candidate) => candidate.id === `headless-${kind}`);
          if (node?.data[`${kind}Generating`]) {
            boundNodes.set(kind, structuredClone(node));
          }
        }
      },
      waitForRevision: async () => ({ revision }),
    },
  } as NodeExecutorContext & {
    acceptedTask?: {
      kind: (typeof kinds)[number];
      nodeId: string;
      ownershipKey: string;
      taskId: string;
    };
    onTaskAccepted: (binding: {
      kind: (typeof kinds)[number];
      nodeId: string;
      ownershipKey: string;
      taskId: string;
    }) => Promise<void>;
  };
  try {
    const registry = createNodeExecutorRegistry();
    const executableIds = new Set(nodes.map((node) => node.id));
    for (const kind of kinds) {
      const nodeId = `headless-${kind}`;
      const executor = registry.get(nodes.find((node) => node.id === nodeId));
      expect(executor?.kind).toBe(kind);
      await expect(executor!.preflight(nodeId, context, executableIds, "static"))
        .resolves.toEqual({ status: "success" });
      await expect(executor!.run(nodeId, context, executableIds))
        .resolves.toMatchObject({ status: "success" });
      expect(boundNodes.has(kind)).toBe(true);
    }
    expect(posts.sort()).toEqual(kinds.map((kind) => `headless-${kind}`).sort());
    for (const kind of kinds) {
      const taskId = `headless-task-${kind}`;
      expect(recoveryOrder.indexOf(`accepted:${taskId}`)).toBeGreaterThanOrEqual(0);
      expect(recoveryOrder.indexOf(`accepted:${taskId}`)).toBeLessThan(
        recoveryOrder.indexOf(`get:${taskId}`),
      );
    }
    expect(nodes.find((node) => node.id === "headless-text")?.data.content)
      .toBe("headless text result");
    expect(nodes.find((node) => node.id === "headless-image")?.data.imageSrc)
      .toBe("/api/assets/headless-result-image");
    expect(nodes.find((node) => node.id === "headless-audio")?.data.audioSrc)
      .toBe("/api/audio-assets/headless-result-audio");
    expect(nodes.find((node) => node.id === "headless-video")?.data.videoSrc)
      .toBe("/api/video-assets/headless-result-video");

    for (const kind of kinds) {
      const nodeId = `headless-${kind}`;
      const acceptedBeforeNodeBinding = structuredClone(boundNodes.get(kind)!);
      delete acceptedBeforeNodeBinding.data[`${kind}GenerationOwnershipKey`];
      delete acceptedBeforeNodeBinding.data[`${kind}GenerationTaskId`];
      delete acceptedBeforeNodeBinding.data[`${kind}Generating`];
      delete acceptedBeforeNodeBinding.data.workflowExecutionRunId;
      nodes = nodes.map((node) =>
        node.id === nodeId ? acceptedBeforeNodeBinding : node
      );
      context.acceptedTask = {
        kind,
        nodeId,
        ownershipKey: String(
          boundNodes.get(kind)!.data[`${kind}GenerationOwnershipKey`],
        ),
        taskId: `headless-task-${kind}`,
      };
      const executor = createNodeExecutorRegistry().get(
        nodes.find((node) => node.id === nodeId),
      );
      await expect(executor!.recover(nodeId, context))
        .resolves.toMatchObject({ status: "success" });
    }
    expect(posts).toHaveLength(4);
    nodes = nodes.map((node) => node.id === "headless-text"
      ? boundNodes.get("text")!
      : node);
    context.acceptedTask = {
      kind: "text",
      nodeId: "headless-text",
      ownershipKey: "wrong-owner",
      taskId: "headless-task-text",
    };
    await expect(createNodeExecutorRegistry().get(
      nodes.find((node) => node.id === "headless-text"),
    )!.recover("headless-text", context)).resolves.toMatchObject({
      errorCode: "RESULT_OWNERSHIP_CONFLICT",
      status: "failed",
    });
    expect(posts).toHaveLength(4);
    nodes = nodes.map((node) => node.id === "headless-text"
      ? boundNodes.get("text")!
      : node);
    context.acceptedTask = {
      kind: "text",
      nodeId: "headless-text",
      ownershipKey: String(
        boundNodes.get("text")!.data.textGenerationOwnershipKey,
      ),
      taskId: "headless-task-text",
    };
    mutateTextSemanticBeforeRead = true;
    await expect(createNodeExecutorRegistry().get(
      nodes.find((node) => node.id === "headless-text"),
    )!.recover("headless-text", context)).resolves.toMatchObject({
      errorCode: "RESULT_OWNERSHIP_CONFLICT",
      status: "failed",
    });
    expect(posts).toHaveLength(4);
    // Admission/binding remains durable before paid work. Terminal success is
    // now projected by the outer group persistence boundary exactly once.
    expect(flushes).toBe(8);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) host.window = previousWindow;
    else delete host.window;
  }
});

async function existingCanvasSaveMetadata(
  request: APIRequestContext,
  canvasId: string,
) {
  const baselineResponse = await request.get(`/api/canvas/${canvasId}`);
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = await baselineResponse.json() as {
    loadToken: string;
    revision: number;
  };
  return {
    observedLoadToken: baseline.loadToken,
    observedRevision: baseline.revision,
    revision: baseline.revision,
    saveAttemptId: randomUUID(),
    saveSequence: 1,
    saveSessionId: randomUUID(),
  };
}

test("workflow layering puts a chain in order and branches into the same layer", () => {
  const nodes: WorkflowNodeShape[] = [
    { id: "text", type: "text", data: { textPromptReady: true, textPrompt: "策略" } },
    { id: "img-a", type: "image", data: { imagePromptReady: true } },
    { id: "img-b", type: "image", data: { imagePromptReady: true } },
    { id: "img-c", type: "image", data: { imagePromptReady: true } },
  ];
  const edges = [
    { id: "e1", source: "text", target: "img-a" },
    { id: "e2", source: "text", target: "img-b" },
    { id: "e3", source: "text", target: "img-c" },
  ];
  expect(buildWorkflowLayers(nodes, edges)).toEqual([
    ["text"],
    ["img-a", "img-b", "img-c"],
  ]);
});

test("workflow layering ignores external edges and self loops", () => {
  const nodes: WorkflowNodeShape[] = [
    { id: "a", type: "text", data: {} },
    { id: "b", type: "text", data: {} },
  ];
  const edges = [
    { id: "e1", source: "outside", target: "a" },
    { id: "e2", source: "a", target: "a" },
  ];
  expect(buildWorkflowLayers(nodes, edges)).toEqual([["a", "b"]]);
});

test("workflow detects circular dependencies", () => {
  const nodes: WorkflowNodeShape[] = [
    { id: "a", type: "text", data: {} },
    { id: "b", type: "text", data: {} },
  ];
  const edges = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "a" },
  ];
  expect(() => buildWorkflowLayers(nodes, edges)).toThrow("循环依赖");
});

test("workflow node executability excludes notes, upload slots and containers", () => {
  expect(isExecutableWorkflowNode({
    id: "text",
    type: "text",
    data: { textPromptReady: true, textPrompt: "写一段文案" },
  })).toBe(true);
  expect(isExecutableWorkflowNode({
    id: "note",
    type: "text",
    data: { textPromptReady: true, textPrompt: "  " },
  })).toBe(false);
  expect(isExecutableWorkflowNode({
    id: "slot",
    type: "image",
    data: { imagePromptReady: false },
  })).toBe(false);
  expect(isExecutableWorkflowNode({
    id: "legacy-slot",
    type: "image",
    data: { imagePromptReady: true },
  })).toBe(false);
  expect(isExecutableWorkflowNode({
    id: "prompt-image",
    type: "image",
    data: { imagePromptReady: true, imagePrompt: "生成一张海报" },
  })).toBe(true);
  expect(isExecutableWorkflowNode({
    id: "upstream-text-image",
    type: "image",
    data: { imagePromptReady: true },
  }, { hasIncomingText: true })).toBe(true);
  expect(isExecutableWorkflowNode({
    id: "upstream-text-video",
    type: "video",
    data: { videoPromptReady: true },
  }, { hasIncomingText: true })).toBe(true);
  expect(isExecutableWorkflowNode({
    id: "bare-video",
    type: "video",
    data: { videoPromptReady: true },
  })).toBe(false);
  expect(isExecutableWorkflowNode({
    id: "group",
    type: "group",
    data: {},
  })).toBe(false);
});

test("workflow runner executes one layer in parallel and stops on a skipped node", async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const executed: string[] = [];
  const result = await runWorkflowLayers({
    executableIds: new Set(["text", "img-a", "img-b"]),
    isCancelled: () => false,
    layers: [["text"], ["img-a", "img-b"]],
    onLayer: () => undefined,
    runNode: async (nodeId) => {
      executed.push(nodeId);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return nodeId === "img-b"
        ? { status: "skipped", message: "参考图还没上传" }
        : { status: "success" };
    },
  });
  expect(result.status).toBe("skipped");
  if (result.status === "skipped") {
    expect(result.message).toBe("参考图还没上传");
  } else {
    throw new Error("expected skipped result");
  }
  expect(executed).toEqual(["text", "img-a", "img-b"]);
  expect(maxConcurrent).toBeGreaterThanOrEqual(2);
});

test("workflow runner cancels before scheduling later layers", async () => {
  let cancelled = false;
  const executed: string[] = [];
  const result = await runWorkflowLayers({
    executableIds: new Set(["a", "b", "c"]),
    isCancelled: () => cancelled,
    layers: [["a"], ["b"], ["c"]],
    runNode: async (nodeId) => {
      executed.push(nodeId);
      if (nodeId === "a") cancelled = true;
      return { status: "success" };
    },
  });
  expect(result.status).toBe("cancelled");
  expect(executed).toEqual(["a"]);
});

test("workflow runner carries the real failure message to the caller", async () => {
  const result = await runWorkflowLayers({
    executableIds: new Set(["text"]),
    isCancelled: () => false,
    layers: [["text"]],
    runNode: async () => ({
      message: "模型平台未完成本次生成，请重试",
      status: "failed",
    }),
  });
  expect(result.status).toBe("failed");
  if (result.status === "failed") {
    expect(result.message).toContain("模型平台未完成本次生成");
  } else {
    throw new Error("expected failed result");
  }
});

test("workflow submission preflight defers future output but blocks model incompatibility", () => {
  const executableIds = new Set(["prompt", "target"]);
  const inputs = [{
    compatibility: "compatible" as const,
    edgeId: "prompt-target",
    kind: "text" as const,
    sourceNodeId: "prompt",
    state: "empty" as const,
  }];
  expect(workflowSubmissionPreflightProblem({
    executableIds,
    inputs,
    problems: [{
      code: "EMPTY",
      edgeId: "prompt-target",
      message: "上游文字尚未生成",
    }, {
      code: "PROMPT_MISSING",
      message: "请先生成上游文字",
    }],
  })).toBeUndefined();
  expect(workflowSubmissionPreflightProblem({
    executableIds,
    inputs,
    problems: [{
      code: "MODEL_UNSUPPORTED",
      edgeId: "prompt-target",
      message: "当前模型不支持text类型上游，引用已保留",
    }],
  })).toMatchObject({ code: "MODEL_UNSUPPORTED" });
  expect(workflowModelSelectionProblem({
    isFixture: false,
    kind: "image",
    status: "ready",
    unavailableReason: "原模型已停用/归档或不可用，当前不可生成",
  })).toMatchObject({ code: "MODEL_UNAVAILABLE" });
  expect(workflowModelSelectionProblem({
    isFixture: false,
    kind: "image",
    model: { generationAvailable: true },
    status: "ready",
  })).toBeUndefined();
});

test("real resolver empty generated Text is waiting during group preflight", () => {
  const resolved = resolveNodeInputs({
    edges: [{ id: "text-image", source: "text", target: "image" }],
    modelSchema: defaultParameterSchema("image"),
    nodes: [{
      data: {
        content: "",
        label: "Text",
        textPrompt: "先生成商品卖点正文",
        textPromptReady: true,
      },
      id: "text",
      type: "text",
    }, {
      data: { imagePromptReady: true, label: "Image" },
      id: "image",
      type: "image",
    }],
    ownPrompt: "",
    targetId: "image",
    targetKind: "image",
  });
  expect(resolved.inputs[0]).toMatchObject({
    compatibility: "blocked",
    sourceNodeId: "text",
    state: "empty",
  });
  expect(resolved.problems[0]).toMatchObject({ code: "EMPTY" });
  const executableIds = new Set(["text", "image"]);
  expect(workflowSubmissionPreflightProblem({
    executableIds,
    inputs: resolved.inputs,
    problems: resolved.problems,
  })).toBeUndefined();
  expect(workflowRuntimePreflightDisposition({
    executableIds,
    inputs: resolved.inputs,
    problems: resolved.problems,
  })).toMatchObject({ status: "waiting" });
  for (const code of ["REQUIRED_MISSING", "ROLE_CONFLICT"] as const) {
    expect(workflowSubmissionPreflightProblem({
      executableIds,
      inputs: resolved.inputs,
      problems: [{ code, message: "等待本轮必需上游输入" }],
    })).toBeUndefined();
    expect(workflowRuntimePreflightDisposition({
      executableIds,
      inputs: resolved.inputs,
      problems: [{ code, message: "等待本轮必需上游输入" }],
    })).toMatchObject({ status: "waiting" });
  }
});

test("workflow graph starts a ready branch child without waiting for a slow sibling", async () => {
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const events: string[] = [];
  const result = await runWorkflowGraph({
    edges: [{ id: "root-fast", source: "root", target: "fast" }, {
      id: "root-slow",
      source: "root",
      target: "slow",
    }, {
      id: "fast-child",
      source: "fast",
      target: "child",
    }],
    executableIds: new Set(["root", "fast", "slow", "child"]),
    isCancelled: () => false,
    runNode: async (nodeId) => {
      events.push(`start:${nodeId}`);
      if (nodeId === "slow") await slow;
      if (nodeId === "child") releaseSlow();
      events.push(`end:${nodeId}`);
      return { status: "success" };
    },
  });
  expect(result).toEqual({ status: "success" });
  expect(events.indexOf("start:child")).toBeLessThan(events.indexOf("end:slow"));
});

test("workflow graph waits for every direct input before a multi-input node", async () => {
  let releaseSecond: () => void = () => {};
  const second = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let joinStarts = 0;
  const run = runWorkflowGraph({
    edges: [{ id: "a-join", source: "a", target: "join" }, {
      id: "b-join",
      source: "b",
      target: "join",
    }],
    executableIds: new Set(["a", "b", "join"]),
    isCancelled: () => false,
    runNode: async (nodeId) => {
      if (nodeId === "b") await second;
      if (nodeId === "join") joinStarts += 1;
      return { status: "success" };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(joinStarts).toBe(0);
  releaseSecond();
  await expect(run).resolves.toEqual({ status: "success" });
  expect(joinStarts).toBe(1);
});

test("workflow graph isolates a failed branch and continues independent work", async () => {
  const executed: string[] = [];
  const result = await runWorkflowGraph({
    edges: [{ id: "bad-child", source: "bad", target: "blocked-child" }],
    executableIds: new Set(["bad", "blocked-child", "independent"]),
    isCancelled: () => false,
    runNode: async (nodeId) => {
      executed.push(nodeId);
      return nodeId === "bad"
        ? { message: "上游生成失败", status: "failed" }
        : { status: "success" };
    },
  });
  expect(executed).toContain("independent");
  expect(executed).not.toContain("blocked-child");
  expect(result).toMatchObject({
    blockedNodeIds: ["blocked-child"],
    failedNodeIds: ["bad"],
    status: "failed",
  });
});

test("workflow graph binds the first parallel failure and blocks only its descendants", async () => {
  let releaseSlowFailure: () => void = () => {};
  const slowFailure = new Promise<void>((resolve) => {
    releaseSlowFailure = resolve;
  });
  const executed: string[] = [];
  const result = await runWorkflowGraph({
    edges: [
      { id: "slow-child", source: "listed-first", target: "slow-blocked" },
      { id: "fast-child", source: "fails-first", target: "fast-blocked" },
    ],
    executableIds: new Set([
      "listed-first",
      "fails-first",
      "slow-blocked",
      "fast-blocked",
      "independent",
    ]),
    isCancelled: () => false,
    runNode: async (nodeId) => {
      executed.push(nodeId);
      if (nodeId === "listed-first") {
        await slowFailure;
        return {
          errorCode: "SLOW_BRANCH_ERROR",
          message: "第一分支后失败",
          status: "failed",
        };
      }
      if (nodeId !== "fails-first") return { status: "success" };
      setTimeout(releaseSlowFailure, 5);
      return {
        errorCode: "FAST_BRANCH_ERROR",
        message: "第二分支先失败",
        status: "failed",
      };
    },
  });
  expect(result).toMatchObject({
    errorCode: "FAST_BRANCH_ERROR",
    firstFailure: {
      errorCode: "FAST_BRANCH_ERROR",
      message: "第二分支先失败",
      nodeId: "fails-first",
    },
    message: "第二分支先失败",
    status: "failed",
  });
  expect(result.status === "failed" ? result.failedNodeIds : []).toEqual(
    expect.arrayContaining(["listed-first", "fails-first"]),
  );
  expect(result.status === "failed" ? result.blockedNodeIds : []).toEqual(
    expect.arrayContaining(["slow-blocked", "fast-blocked"]),
  );
  expect(executed).toContain("independent");
  expect(executed).not.toContain("slow-blocked");
  expect(executed).not.toContain("fast-blocked");
});

test("workflow graph cancellation prevents new dispatch", async () => {
  let cancelled = false;
  const executed: string[] = [];
  const result = await runWorkflowGraph({
    edges: [{ id: "a-b", source: "a", target: "b" }],
    executableIds: new Set(["a", "b"]),
    isCancelled: () => cancelled,
    runNode: async (nodeId) => {
      executed.push(nodeId);
      cancelled = true;
      return { status: "success" };
    },
  });
  expect(result.status).toBe("cancelled");
  expect(executed).toEqual(["a"]);
});

test("workflow graph resume reuses proven successes and only dispatches remaining nodes", async () => {
  const executed: string[] = [];
  const states: string[] = [];
  const result = await runWorkflowGraph({
    edges: [
      { id: "a-b", source: "a", target: "b" },
      { id: "b-c", source: "b", target: "c" },
    ],
    executableIds: new Set(["a", "b", "c"]),
    initialSuccessNodeIds: new Set(["a", "b"]),
    isCancelled: () => false,
    onNodeStateChange: (nodeId, state) => states.push(`${nodeId}:${state}`),
    runNode: async (nodeId) => {
      executed.push(nodeId);
      return { status: "success" };
    },
  });
  expect(result).toEqual({ status: "success" });
  expect(executed).toEqual(["c"]);
  expect(states).toEqual(expect.arrayContaining(["a:success", "b:success", "c:success"]));
});

test("group run snapshot ignores camera geometry and generated output but fences config", () => {
  const base: ProbeNodeType[] = [{
    id: "group",
    type: "group",
    data: { label: "组", variant: "group" },
    position: { x: 0, y: 0 },
  }, {
    id: "reference",
    type: "image",
    data: {
      assetId: "asset-a",
      imageSrc: "/api/assets/asset-a",
      label: "参考图",
    },
    position: { x: -400, y: 30 },
  }, {
    id: "image",
    parentId: "group",
    type: "image",
    data: {
      imageModelId: "model-a",
      imageParameters: { seed: 1 },
      imagePrompt: "蓝色外套",
      imagePromptReady: true,
      label: "图片",
    },
    position: { x: 20, y: 30 },
  }];
  const input = {
    edges: [{
      id: "reference-image",
      source: "reference",
      target: "image",
    }],
    executableNodeIds: new Set(["image"]),
    groupId: "group",
  };
  const original = groupRunSnapshotFingerprint({ ...input, nodes: base });
  const movedWithOutput = base.map((node) => node.id === "image" ? {
    ...node,
    data: {
      ...node.data,
      imageGenerationOwnershipKey: "owner",
      imageGenerationTaskId: "task",
      imageSrc: "/generated.png",
    },
    position: { x: 9_000, y: -4_000 },
  } : node);
  expect(groupRunSnapshotFingerprint({ ...input, nodes: movedWithOutput }))
    .toBe(original);
  const changedPrompt = base.map((node) => node.id === "image" ? {
    ...node,
    data: { ...node.data, imagePrompt: "红色外套" },
  } : node);
  expect(groupRunSnapshotFingerprint({ ...input, nodes: changedPrompt }))
    .not.toBe(original);
  const changedReference = base.map((node) => node.id === "reference" ? {
    ...node,
    data: {
      ...node.data,
      assetId: "asset-b",
      imageSrc: "/api/assets/asset-b",
    },
  } : node);
  expect(groupRunSnapshotFingerprint({ ...input, nodes: changedReference }))
    .not.toBe(original);
});

test("group run success proof is exact and resume fails closed on mismatch", () => {
  const node: ProbeNodeType = {
    id: "text",
    parentId: "group",
    type: "text",
    data: {
      content: "已生成文案",
      groupRunSuccessOwnershipKey: "owner-a",
      groupRunSuccessTaskId: "task-a",
      label: "文案",
    },
    position: { x: 0, y: 0 },
  };
  expect(groupRunSuccessProof(node)).toMatchObject({
    ownershipKey: "owner-a",
    taskId: "task-a",
  });
  expect(groupRunSuccessProof(node)?.resultKey).toEqual(expect.any(String));
  const checkpoint: GroupRunCheckpoint = {
    accountId: "account",
    canvasId: "canvas",
    executableNodeIds: ["text"],
    fixtureScopeId: "",
    groupId: "group",
    nodeStates: { text: "success" },
    runId: "run",
    snapshotFingerprint: "snapshot",
    startedAt: 1,
    status: "interrupted",
    successProofs: {
      text: {
        ownershipKey: "owner-a",
        resultKey: groupRunSuccessProof(node)!.resultKey,
        taskId: "task-a",
      },
    },
    updatedAt: 2,
    version: 1,
  };
  expect(verifiedCheckpointSuccessIds(checkpoint, [node]).verified)
    .toEqual(new Set(["text"]));
  const changed = {
    ...node,
    data: { ...node.data, groupRunSuccessTaskId: "task-b" },
  };
  expect(verifiedCheckpointSuccessIds(checkpoint, [changed]))
    .toMatchObject({ mismatchNodeId: "text" });
  const changedResult = {
    ...node,
    data: { ...node.data, content: "已被替换的文案" },
  };
  expect(verifiedCheckpointSuccessIds(checkpoint, [changedResult]))
    .toMatchObject({ mismatchNodeId: "text" });
});

test("group run proof survives terminal cleanup and graph forwards the task proof", async () => {
  const durableNode: ProbeNodeType = {
    id: "image",
    parentId: "group",
    type: "image",
    data: {
      content: "",
      groupRunSuccessOwnershipKey: "owner-a",
      groupRunSuccessResultKey: "result-a",
      groupRunSuccessTaskId: "task-a",
      imageSrc: "/generated-a.png",
      label: "图片",
    },
    position: { x: 0, y: 0 },
  };
  expect(groupRunSuccessProof(durableNode)).toMatchObject({
    ownershipKey: "owner-a",
    taskId: "task-a",
  });
  const successProofs: unknown[] = [];
  await expect(runWorkflowGraph({
    edges: [],
    executableIds: new Set(["image"]),
    isCancelled: () => false,
    onNodeStateChange: (_nodeId, state, _completed, _total, result) => {
      if (state === "success") successProofs.push(result?.successProof);
    },
    runNode: async () => ({
      status: "success" as const,
      successProof: {
        ownershipKey: "owner-a",
        resultKey: "result-a",
        taskId: "task-a",
      },
    }),
  })).resolves.toEqual({ status: "success" });
  expect(successProofs).toEqual([{
    ownershipKey: "owner-a",
    resultKey: "result-a",
    taskId: "task-a",
  }]);
});

test("group run starting guard permits disjoint leases and rejects overlap", async () => {
  const host = globalThis as unknown as { window?: Window };
  const previousWindow = host.window;
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;
  const fakeWindow = new EventTarget() as Window;
  let confirmResult = false;
  Object.defineProperties(fakeWindow, {
    confirm: { value: () => confirmResult },
    localStorage: { value: storage },
    navigator: {
      configurable: true,
      value: {
        locks: {
          request: async (
            _name: string,
            _options: { ifAvailable: boolean },
            callback: (lock: unknown) => Promise<boolean> | boolean,
          ) => callback({}),
        },
      },
    },
  });
  host.window = fakeWindow;
  const scope = { accountId: "account", canvasId: "canvas", fixtureScopeId: "" };
  try {
    markGroupRunStarting(scope, "group", "run-a");
    expect(readGroupRunStarting(scope)).toEqual({ groupId: "group", runId: "run-a" });
    expect(confirmGroupRunNavigation(scope)).toBe(false);
    let stoppedRunId = "";
    fakeWindow.addEventListener("unboundry:group-run-stop", (event) => {
      stoppedRunId = (event as CustomEvent<{ runId: string }>).detail.runId;
    });
    confirmResult = true;
    expect(confirmGroupRunNavigation(scope)).toBe(true);
    expect(stoppedRunId).toBe("run-a");
    clearGroupRunStarting(scope, "run-a");
    expect(readGroupRunStarting(scope)).toBeUndefined();

    const now = Date.now();
    expect(await acquireGroupRunLease(
      scope,
      "run-a",
      "owner-a",
      now,
      ["group-a", "node-a"],
    )).toBe(true);
    expect(await acquireGroupRunLease(
      scope,
      "run-a",
      "owner-intruder",
      now + 1,
      ["group-a", "node-a"],
    )).toBe(false);
    expect(readGroupRunLease(scope, "run-a")?.ownerId).toBe("owner-a");
    expect(await hasForeignActiveGroupRunLeaseForCanvas("canvas", "node-a"))
      .toBe(true);
    expect(await hasForeignActiveGroupRunLeaseForCanvas("canvas", "node-c"))
      .toBe(false);
    expect(await acquireGroupRunLease(
      scope,
      "run-b",
      "owner-b",
      now + 1,
      ["node-a"],
    )).toBe(false);
    expect(await acquireGroupRunLease(
      scope,
      "run-c",
      "owner-c",
      now + 2,
      ["group-c", "node-c"],
    )).toBe(true);
    expect([...values.keys()].filter((key) =>
      key.startsWith("unboundry-group-run-lease:v1:")
    )).toHaveLength(2);
    expect(await hasConflictingActiveGroupRunLeaseForCanvas(
      "canvas",
      "node-c",
    )).toBe(true);
    expect(await hasConflictingActiveGroupRunLeaseForCanvas(
      "canvas",
      "node-c",
      "run-c",
    )).toBe(false);
    const checkpoint = (runId: string, groupId: string): GroupRunCheckpoint => Object.assign({
      accountId: scope.accountId,
      canvasId: scope.canvasId,
      executableNodeIds: [`node-${groupId.at(-1)}`],
      fixtureScopeId: scope.fixtureScopeId,
      groupId,
      nodeStates: {},
      runId,
      snapshotFingerprint: `snapshot-${runId}`,
      startedAt: now,
      status: "running" as const,
      successProofs: {},
      updatedAt: now,
      version: 1 as const,
    }, {
      acceptedTasks: {
        [`node-${groupId.at(-1)}`]: {
          kind: "text" as const,
          nodeId: `node-${groupId.at(-1)}`,
          ownershipKey: `owner-${runId}`,
          taskId: `task-${runId}`,
        },
      },
    });
    expect(writeGroupRunCheckpoint(
      checkpoint("run-a", "group-a"),
      { ownerId: "owner-a", runId: "run-a" },
    )).toBe(true);
    expect(writeGroupRunCheckpoint(
      checkpoint("run-c", "group-c"),
      { ownerId: "owner-c", runId: "run-c" },
    )).toBe(true);
    expect([...values.keys()].filter((key) =>
      key.startsWith("unboundry-group-run-checkpoint:v1:")
    )).toHaveLength(2);
    expect(writeGroupRunCheckpoint(
      checkpoint("run-c", "group-c"),
      { ownerId: "owner-a", runId: "run-a" },
    )).toBe(false);
    expect(readGroupRunCheckpoint(scope, "run-a")?.groupId).toBe("group-a");
    expect((readGroupRunCheckpoint(scope, "run-a") as GroupRunCheckpoint & {
      acceptedTasks?: Record<string, { taskId: string }>;
    })?.acceptedTasks?.["node-a"]?.taskId).toBe("task-run-a");
    const acceptedRunA = readGroupRunCheckpoint(scope, "run-a")
      ?.acceptedTasks?.["node-a"];
    expect(taskMatchesAcceptedBinding(acceptedRunA, {
      id: "task-run-a",
      kind: "text",
      nodeId: "node-a",
    })).toBe(true);
    expect(taskMatchesAcceptedBinding(acceptedRunA, {
      id: "task-other",
      kind: "text",
      nodeId: "node-a",
    })).toBe(false);
    expect(readGroupRunCheckpoint(scope, "run-c")?.groupId).toBe("group-c");
    expect(clearGroupRunCheckpoint(
      scope,
      { ownerId: "owner-a", runId: "run-a" },
    )).toBe(true);
    expect(readGroupRunCheckpoint(scope, "run-a")).toBeUndefined();
    expect(readGroupRunCheckpoint(scope, "run-c")?.groupId).toBe("group-c");
    expect(releaseGroupRunLease(scope, "run-a", "owner-a")).toBe(true);
    expect(await hasForeignActiveGroupRunLeaseForCanvas("canvas", "node-a"))
      .toBe(false);
    expect(await hasForeignActiveGroupRunLeaseForCanvas("canvas", "node-c"))
      .toBe(true);
    expect(releaseGroupRunLease(scope, "run-c", "owner-c")).toBe(true);

    const staleRunId = "run-stale-resume";
    const staleLeaseKey = `unboundry-group-run-lease:v1:${JSON.stringify([
      scope.accountId,
      scope.canvasId,
      scope.fixtureScopeId,
      staleRunId,
    ])}`;
    values.set(staleLeaseKey, JSON.stringify({
      expiresAt: now - 1,
      heartbeatAt: now - 60_001,
      lockedNodeIds: ["node-stale"],
      ownerId: "owner-before-reload",
      runId: staleRunId,
    }));
    expect(await acquireGroupRunLease(
      scope,
      staleRunId,
      "owner-after-reload",
      now,
      ["node-stale"],
    )).toBe(true);
    expect(readGroupRunLease(scope, staleRunId)?.ownerId)
      .toBe("owner-after-reload");
    expect(await renewGroupRunLease(
      scope,
      staleRunId,
      "owner-after-reload",
      now + 5_000,
    )).toBe(true);
    expect(readGroupRunLease(scope, staleRunId)?.heartbeatAt).toBe(now + 5_000);
    expect(releaseGroupRunLease(
      scope,
      staleRunId,
      "owner-after-reload",
    )).toBe(true);

    values.set(staleLeaseKey, JSON.stringify({
      expiresAt: now + 60_000,
      heartbeatAt: now,
      lockedNodeIds: ["node-stale"],
      ownerId: "owner-still-active",
      runId: staleRunId,
    }));
    expect(await acquireGroupRunLease(
      scope,
      staleRunId,
      "owner-must-wait",
      now + 1,
      ["node-stale"],
    )).toBe(true);
    expect(readGroupRunLease(scope, staleRunId)?.ownerId)
      .toBe("owner-must-wait");
    expect(releaseGroupRunLease(
      scope,
      staleRunId,
      "owner-must-wait",
    )).toBe(true);

    const sameOwner = getGroupRunExecutionOwnerId();
    expect(await acquireGroupRunLease(
      scope,
      "run-owner",
      sameOwner,
      now + 3,
      ["node-owner"],
    )).toBe(true);
    let taskRequests = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      taskRequests += 1;
      throw new Error("task endpoint must stay unreachable while group owns node");
    };
    const target = {
      canvasId: scope.canvasId,
      generationInputKey: "input-owner",
      kind: "text" as const,
      nodeId: "node-owner",
      taskId: "task-owner",
    };
    try {
      await expect(retryGenerationTask(target, async () => 1)).rejects
        .toMatchObject({
          code: "GROUP_RUN_ACTIVE",
          status: 409,
        });
      await expect(reconcileGenerationTask(target, async () => 1)).rejects
        .toMatchObject({
          code: "GROUP_RUN_ACTIVE",
          status: 409,
        });
      expect(taskRequests).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
      expect(releaseGroupRunLease(scope, "run-owner", sameOwner)).toBe(true);
    }
    expect(writeGroupRunCheckpoint(checkpoint("run-a", "group-a"))).toBe(true);
    expect(writeGroupRunCheckpoint(checkpoint("run-c", "group-c"))).toBe(true);
    expect(clearGroupRunCheckpoint(scope, undefined, "run-a")).toBe(true);
    expect(readGroupRunCheckpoint(scope, "run-a")).toBeUndefined();
    expect(readGroupRunCheckpoint(scope, "run-c")?.groupId).toBe("group-c");
    expect(clearGroupRunCheckpoint(scope)).toBe(true);
    expect(await hasForeignActiveGroupRunLeaseForCanvas("canvas")).toBe(false);
    const malformedRunId = "run-malformed-binding";
    values.set(
      `unboundry-group-run-checkpoint:v1:${JSON.stringify([
        scope.accountId,
        scope.canvasId,
        scope.fixtureScopeId,
        malformedRunId,
      ])}`,
      JSON.stringify({
        ...checkpoint(malformedRunId, "group-malformed"),
        acceptedTasks: {
          "node-malformed": {
            kind: "text",
            nodeId: "different-node",
            ownershipKey: "owner-malformed",
            taskId: "task-malformed",
          },
        },
      }),
    );
    expect(readGroupRunCheckpoint(scope, malformedRunId)).toBeUndefined();
    Object.defineProperty(fakeWindow, "navigator", {
      configurable: true,
      value: {},
    });
    expect(await acquireGroupRunLease(scope, "run-d", "owner-d", now + 4))
      .toBe(false);
  } finally {
    clearGroupRunStarting(scope, "run-a");
    if (previousWindow) host.window = previousWindow;
    else delete host.window;
  }
});

test("workflow execution has no component registration or render-retention dependency", () => {
  const provider = readFileSync(
    "client/src/generation/WorkflowExecutionProvider.tsx",
    "utf8",
  );
  const executors = readFileSync(
    "client/src/generation/workflowNodeExecutors.ts",
    "utf8",
  );
  const registry = readFileSync(
    "client/src/generation/nodeExecutorRegistry.ts",
    "utf8",
  );
  const canvas = readFileSync("client/src/canvas/CanvasSurface.tsx", "utf8");
  expect(provider).not.toContain("registerWorkflowNode");
  expect(provider).not.toContain("waitForRegistrations");
  expect(provider).toContain("另一轮正在使用${conflictRole}");
  expect(provider).toContain("（节点 ${conflictingNodeId}）");
  expect(provider).toContain('running.abortController.abort("foreign-lease")');
  const persistedRun = provider.indexOf("return await runGroupNodeWithPersist({");
  expect(persistedRun).toBeGreaterThan(-1);
  expect(provider.indexOf("return executor.recover(", persistedRun))
    .toBeGreaterThan(persistedRun);
  expect(provider).toContain("recordDirectProjectionReceipt(binding.nodeId, result)");
  expect(provider).toContain("recordDirectProjectionReceipt(nodeId, nodeResult)");
  expect(provider).toContain("...directProjectionReceipts");
  expect(canvas).not.toContain("retainWorkflowNodesForRender");
  expect(executors).not.toContain("document.");
  expect(executors).not.toContain("window.");
  expect(executors).not.toContain("context.setNodes");
  expect(executors).not.toContain("context.getNodes");
  expect(executors).not.toContain("context.getEdges");
  expect(executors).not.toContain("context.flushCanvasSave");
  expect(executors).not.toContain("context.waitForCanvasRevision");
  expect(registry).not.toContain('from "react"');
  expect(registry).toContain("graph: CanvasGraphCommandPort");
  expect(registry).toContain("save: CanvasSavePort");
});

test("navigation interrupts every locally owned concurrent run without crossing checkpoint ownership", async () => {
  const host = globalThis as unknown as { window?: Window };
  const previousWindow = host.window;
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;
  const fakeWindow = new EventTarget() as Window;
  Object.defineProperties(fakeWindow, {
    confirm: { value: () => true },
    localStorage: { value: storage },
    navigator: {
      configurable: true,
      value: {
        locks: {
          request: async (
            _name: string,
            _options: { ifAvailable: boolean },
            callback: (lock: unknown) => Promise<boolean> | boolean,
          ) => callback({}),
        },
      },
    },
  });
  host.window = fakeWindow;
  const scope = { accountId: "account-nav", canvasId: "canvas-nav", fixtureScopeId: "" };
  const ownerId = getGroupRunExecutionOwnerId();
  const now = Date.now();
  const stopped: string[] = [];
  fakeWindow.addEventListener("unboundry:group-run-stop", (event) => {
    stopped.push((event as CustomEvent<{ runId: string }>).detail.runId);
  });
  const checkpoint = (runId: string, groupId: string): GroupRunCheckpoint => ({
    accountId: scope.accountId,
    canvasId: scope.canvasId,
    executableNodeIds: [`node-${runId}`],
    fixtureScopeId: scope.fixtureScopeId,
    groupId,
    nodeStates: {},
    runId,
    snapshotFingerprint: `snapshot-${runId}`,
    startedAt: now,
    status: "running",
    successProofs: {},
    updatedAt: now,
    version: 1,
  });
  try {
    expect(await acquireGroupRunLease(
      scope,
      "run-nav-a",
      ownerId,
      now,
      ["node-a"],
    )).toBe(true);
    expect(await acquireGroupRunLease(
      scope,
      "run-nav-b",
      ownerId,
      now + 1,
      ["node-b"],
    )).toBe(true);
    expect(writeGroupRunCheckpoint(
      checkpoint("run-nav-a", "group-nav-a"),
      { ownerId, runId: "run-nav-a" },
    )).toBe(true);
    expect(writeGroupRunCheckpoint(
      checkpoint("run-nav-b", "group-nav-b"),
      { ownerId, runId: "run-nav-b" },
    )).toBe(true);
    expect(confirmGroupRunNavigation(scope)).toBe(true);
    expect(stopped.sort()).toEqual(["run-nav-a", "run-nav-b"]);
    expect(readGroupRunCheckpoints(scope).map((item) => item.status))
      .toEqual(["interrupted", "interrupted"]);
  } finally {
    releaseGroupRunLease(scope, "run-nav-a", ownerId);
    releaseGroupRunLease(scope, "run-nav-b", ownerId);
    clearGroupRunCheckpoint(scope);
    if (previousWindow) host.window = previousWindow;
    else delete host.window;
  }
});

test("workflow graph stop waits for an active node and reports descendants pending", async () => {
  let cancelled = false;
  let activeStarted = false;
  let releaseActive: () => void = () => {};
  const activeBarrier = new Promise<void>((resolve) => {
    releaseActive = resolve;
  });
  const states: string[] = [];
  const pending = runWorkflowGraph({
    edges: [{ id: "active-child", source: "active", target: "child" }],
    executableIds: new Set(["active", "child"]),
    isCancelled: () => cancelled,
    onNodeStateChange: (nodeId, state) => states.push(`${nodeId}:${state}`),
    runNode: async (nodeId) => {
      expect(nodeId).toBe("active");
      activeStarted = true;
      await activeBarrier;
      return { status: "success" };
    },
  });
  await expect.poll(() => activeStarted).toBe(true);
  cancelled = true;
  let settled = false;
  void pending.finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(settled).toBe(false);
  releaseActive();
  await expect(pending).resolves.toEqual({
    completedNodeIds: ["active"],
    pendingNodeIds: ["child"],
    status: "cancelled",
  });
  expect(states).toEqual(["active:running", "active:success"]);
});

test("group run summary scope and bounded dismissal isolate accounts and fixtures", () => {
  const summary = {
    accountId: "account-a",
    blockedCount: 0,
    blockedNodeIds: [],
    canvasId: "same-canvas",
    completedAt: 1,
    elapsedMs: 1,
    failedCount: 0,
    failedNodeIds: [],
    fixtureScopeId: "fixture-a",
    groupId: "group-a",
    nodeCount: 1,
    runId: "run-0",
    runSequence: 1,
    skippedCount: 0,
    skippedNodeIds: [],
    status: "success",
    startedAt: 1,
    successCount: 1,
  } satisfies GroupRunSummary;
  expect(groupRunSummaryMatchesScope(summary, {
    accountId: "account-a",
    canvasId: "same-canvas",
    fixtureScopeId: "fixture-a",
  })).toBe(true);
  expect(groupRunSummaryMatchesScope(summary, {
    accountId: "account-b",
    canvasId: "same-canvas",
    fixtureScopeId: "fixture-a",
  })).toBe(false);
  expect(groupRunSummaryMatchesScope(summary, {
    accountId: "account-a",
    canvasId: "same-canvas",
    fixtureScopeId: "fixture-b",
  })).toBe(false);
  for (let index = 0; index <= GROUP_RUN_SUMMARY_DISMISSAL_LIMIT; index += 1) {
    dismissGroupRunSummary({ ...summary, runId: `run-${index}` });
  }
  expect(isGroupRunSummaryDismissed(summary)).toBe(false);
  expect(isGroupRunSummaryDismissed({
    ...summary,
    runId: `run-${GROUP_RUN_SUMMARY_DISMISSAL_LIMIT}`,
  })).toBe(true);

  const host = globalThis as unknown as { window?: Window };
  const previousWindow = host.window;
  host.window = new EventTarget() as unknown as Window;
  try {
    const current = { ...summary, runId: "new-run", runSequence: 3 };
    publishGroupRunSummary(current);
    publishGroupRunSummary({ ...summary, runId: "late-old-run", runSequence: 2 });
    expect(readLastGroupRunSummaryForGroup(summary, summary.groupId)?.runId)
      .toBe("new-run");
    publishGroupRunSummary({
      ...summary,
      accountId: "account-b",
      runId: "scope-b-run",
      runSequence: 4,
    });
    expect(readLastGroupRunSummaryForGroup(summary, summary.groupId)?.runId)
      .toBe("new-run");

    const evictionScope = {
      accountId: "eviction-account",
      canvasId: "eviction-canvas",
      fixtureScopeId: "",
    };
    for (let index = 0; index <= GROUP_RUN_SUMMARY_CACHE_LIMIT; index += 1) {
      publishGroupRunSummary({
        ...summary,
        ...evictionScope,
        groupId: `eviction-group-${index}`,
        runId: `eviction-run-${index}`,
        runSequence: 100 + index,
      });
    }
    expect(readLastGroupRunSummaryForGroup(
      evictionScope,
      "eviction-group-0",
    )).toBeUndefined();
    expect(readLastGroupRunSummaryForGroup(
      evictionScope,
      `eviction-group-${GROUP_RUN_SUMMARY_CACHE_LIMIT}`,
    )?.runId).toBe(`eviction-run-${GROUP_RUN_SUMMARY_CACHE_LIMIT}`);
  } finally {
    if (previousWindow) host.window = previousWindow;
    else delete host.window;
  }
});

test("friendly generation messages avoid long English and jargon", () => {
  expect(friendlyGenerationMessage("当前类型的运行任务已达到上限", "text"))
    .toBe("同类型生成任务已达上限，请等待当前任务完成");
  expect(friendlyGenerationMessage(
    "some very long english provider error with request id abc-123 and a huge stack trace",
    "image",
  )).toBe("图片生成失败，请稍后再试");
  expect(friendlyGenerationMessage("平铺图不存在、尚未保存或不属于当前账号", "text"))
    .toContain("素材尚未保存成功");
  expect(friendlyGenerationMessage("请求过于频繁，请稍后再试", "text"))
    .toBe("操作太频繁，请稍后再试");
  expect(friendlyGenerationMessage("短中文提示", "text")).toBe("短中文提示");
  expect(friendlyGenerationMessage(undefined, "image", "PROVIDER_REQUEST_FAILED"))
    .toContain("不会自动重提");
  expect(friendlyGenerationMessage(undefined, "image", "PROVIDER_RESULT_FORMAT"))
    .toContain("模型已响应");
});

test("save gate waits for a durable canvas revision before running the node", async () => {
  let revisionConfirmed = false;
  const calls: string[] = [];
  const run = createSaveGateRun(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      revisionConfirmed = true;
      return 42;
    },
    async () => {
      calls.push("run");
      return { status: "success" as const };
    },
    "text",
  );
  const pending = run();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(calls).toEqual([]);
  expect(await pending).toEqual({ status: "success" });
  expect(revisionConfirmed).toBe(true);
  expect(calls).toEqual(["run"]);

  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstHold = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = runExclusiveCanvasSubmit("canvas-a", async () => {
    events.push("a-start");
    await firstHold;
    events.push("a-end");
    return 1;
  });
  const second = runExclusiveCanvasSubmit("canvas-a", async () => {
    events.push("a2-start");
    return 2;
  });
  const other = runExclusiveCanvasSubmit("canvas-b", async () => {
    events.push("b-start");
    return 3;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events).toEqual(["a-start", "b-start"]);
  releaseFirst();
  await expect(Promise.all([first, second, other])).resolves.toEqual([1, 2, 3]);
  expect(events).toEqual(["a-start", "b-start", "a-end", "a2-start"]);

  const failed = runExclusiveCanvasSubmit("canvas-fail", async () => {
    throw new Error("first submit failed");
  });
  const afterFailure = runExclusiveCanvasSubmit("canvas-fail", async () => "ok");
  await expect(failed).rejects.toThrow("first submit failed");
  await expect(afterFailure).resolves.toBe("ok");

  let revision = 14;
  const seen: number[] = [];
  await Promise.all([
    runExclusiveCanvasSubmit("canvas-rev", async () => {
      seen.push(revision);
      revision += 1;
    }),
    runExclusiveCanvasSubmit("canvas-rev", async () => {
      seen.push(revision);
      revision += 1;
    }),
  ]);
  expect(seen).toEqual([14, 15]);
  expect(revision).toBe(16);
});

test("a pure projection failure does not block the current run downstream", async () => {
  const events: string[] = [];
  let persistCalls = 0;
  const persist = async () => {
    events.push("persist");
    persistCalls += 1;
    return persistCalls === 1 ? "画布保存状态异常" : undefined;
  };
  const started: string[] = [];
  const result = await runWorkflowGraph({
    edges: [
      { id: "a-b", source: "a", target: "b" },
    ],
    executableIds: new Set(["a", "b"]),
    isCancelled: () => false,
    runNode: async (nodeId) => {
      started.push(nodeId);
      if (nodeId === "b") {
        expect(events).toEqual(["persist"]);
      }
      return runGroupNodeWithPersist({
        persist,
        run: async () => ({ status: "success" }),
      });
    },
  });
  expect(result.status).toBe("success");
  expect(started).toEqual(["a", "b"]);
  expect(events).toEqual(["persist", "persist"]);
});

test("group persist retry happens once for a still-saving canvas and never for other failures", async () => {
  const persistCalls: number[] = [];
  let first = true;
  const saved = await runGroupNodeWithPersist({
    persist: async () => {
      persistCalls.push(1);
      return undefined;
    },
    run: async () => {
      if (first) {
        first = false;
        return {
          message: "画布还在保存，请稍等保存完成后再试",
          status: "failed",
        };
      }
      return { status: "success" };
    },
  });
  expect(saved).toEqual({ status: "success" });
  expect(persistCalls).toEqual([1, 1]);

  let otherRuns = 0;
  const other = await runGroupNodeWithPersist({
    persist: async () => undefined,
    run: async () => {
      otherRuns += 1;
      return { message: "模型平台未完成本次生成，请重试", status: "failed" };
    },
  });
  expect(other).toMatchObject({
    message: "模型平台未完成本次生成，请重试",
    status: "failed",
  });
  expect(otherRuns).toBe(1);

  const cancelled = await runGroupNodeWithPersist({
    isCancelled: () => true,
    persist: async () => undefined,
    run: async () => ({
      message: "画布内容还在保存，请等待自动保存完成后再试",
      status: "failed",
    }),
  });
  expect(cancelled).toEqual({
    message: "已停止后续节点",
    status: "skipped",
  });

  const projectionBase = {
    accountId: "account-a",
    canvasId: "canvas-a",
    dataPatch: {
      content: "durable result",
      contentHtml: "<p>durable result</p>",
      groupRunSuccessOwnershipKey: "owner-a",
      groupRunSuccessResultKey: "result-a",
      groupRunSuccessTaskId: "task-a",
      textGenerationInputKey: undefined,
      textGenerationOwnershipKey: undefined,
      textGenerationTaskId: "task-a",
      textGenerating: false,
      title: "must-not-overwrite-user-title",
      workflowExecutionRunId: undefined,
    },
    inputFingerprint: "input-a",
    kind: "text" as const,
    nodeId: "node-a",
    ownershipKey: "owner-a",
    resultKey: "result-a",
    runId: "run-a",
    taskId: "task-a",
  };
  const projection: GroupResultProjection = {
    ...projectionBase,
    applicationId: groupResultProjectionApplicationId(projectionBase),
    semanticRevision: groupResultSemanticRevision(projectionBase),
  };
  expect(unresolvedProjectionNodeIds(["old-node"], [
    {
      applicationId: "old-application",
      attempts: 1,
      nodeId: "old-node",
      status: "applied",
    },
    {
      applicationId: projection.applicationId,
      attempts: 4,
      nodeId: projection.nodeId,
      status: "exhausted",
    },
  ])).toEqual(["node-a"]);
  const queuedApplications: string[] = [];
  const persistFailed = await runGroupNodeWithPersist({
    persist: async () => "画布保存超时，请稍后再试",
    project: (candidate) => queuedApplications.push(candidate.applicationId),
    run: async () => ({
      projection,
      status: "success",
    }),
  });
  expect(persistFailed).toMatchObject({
    projectionState: "pending",
    status: "success",
  });
  expect(queuedApplications).toEqual(["run-a:node-a:task-a:result-a"]);

  const duplicateApplications: string[] = [];
  const projectOnce = (candidate: GroupResultProjection) => {
    if (!duplicateApplications.includes(candidate.applicationId)) {
      duplicateApplications.push(candidate.applicationId);
    }
  };
  const repeat = () => runGroupNodeWithPersist({
    persist: async () => "画布保存状态异常",
    project: projectOnce,
    run: async () => ({
      projection: { ...projection, applicationId: "same-application" },
      status: "success",
    }),
  });
  await Promise.all([repeat(), repeat()]);
  expect(duplicateApplications).toEqual(["same-application"]);

  const latest = {
    currentWriterSequence: 7,
    currentWriterSessionId: "writer-session-a",
    edges: [{ id: "edge-a", source: "other", target: "node-a" }],
    graphRevision: 9,
    loadToken: "load-token-a",
    nodes: [
      {
        data: { label: "other" },
        id: "other",
        position: { x: 1, y: 2 },
        type: "text",
      },
      {
        data: {
          textGenerationInputKey: "input-a",
          textGenerationOwnershipKey: "owner-a",
          textGenerationTaskId: "task-a",
          title: "user title",
          workflowExecutionRunId: "run-a",
        },
        id: "node-a",
        position: { x: 30, y: 40 },
        style: { height: 200, width: 300 },
        type: "text",
      },
    ] as ProbeNodeType[],
    revision: 11,
    saveEpoch: "epoch-a",
    sessionHighWaterAttemptId: null,
    sessionHighWaterSequence: 0,
    viewport: { x: 8, y: 9, zoom: 0.7 },
  };
  const merged = mergeGroupResultProjection(latest, projection);
  expect(merged.status).toBe("apply");
  if (merged.status === "apply") {
    expect(merged.document.viewport).toEqual(latest.viewport);
    expect(merged.document.edges).toEqual(latest.edges);
    expect(merged.document.nodes[0]).toEqual(latest.nodes[0]);
    expect(merged.document.nodes[1]).toMatchObject({
      data: { content: "durable result", title: "user title" },
      position: { x: 30, y: 40 },
      style: { height: 200, width: 300 },
    });
    expect(mergeGroupResultProjection(merged.document, projection).status).toBe(
      "already-applied",
    );
  }
  const semanticConflict = structuredClone(latest);
  semanticConflict.nodes[1].data.textGenerationInputKey = "input-edited";
  expect(mergeGroupResultProjection(semanticConflict, projection).status).toBe(
    "conflict",
  );
  const incompleteProof = structuredClone(latest);
  incompleteProof.nodes[1].data = {
    ...incompleteProof.nodes[1].data,
    groupRunSuccessOwnershipKey: "owner-a",
    groupRunSuccessResultKey: "result-a",
    groupRunSuccessTaskId: "task-a",
  };
  expect(mergeGroupResultProjection(incompleteProof, projection).status).toBe(
    "apply",
  );

  let loads = 0;
  let puts = 0;
  const reconciled = await reconcileGroupResultProjection({
    maxAttempts: 3,
    projection,
    transport: {
      load: async () => {
        loads += 1;
        return { body: latest, ok: true, status: 200 };
      },
      put: async (input) => {
        puts += 1;
        const request = JSON.parse(input.payload) as {
          generationProjection: GroupResultProjection;
          revision: number;
        };
        expect(request.generationProjection).toEqual(projection);
        return puts === 1
          ? { body: { code: "CANVAS_REVISION_CONFLICT" }, ok: false, status: 409 }
          : {
              body: {
                graphRevision: request.revision + 1,
                loadToken: "load-token-b",
                revision: request.revision + 1,
              },
              ok: true,
              status: 200,
            };
      },
    },
  });
  expect(reconciled).toMatchObject({ attempts: 2, status: "applied" });
  expect({ loads, puts }).toEqual({ loads: 2, puts: 2 });

  const projectionHost = globalThis as unknown as { window?: Window };
  const previousProjectionWindow = projectionHost.window;
  const locklessWindow = new EventTarget() as Window;
  Object.defineProperty(locklessWindow, "navigator", { value: {} });
  projectionHost.window = locklessWindow;
  let locklessTransportCalls = 0;
  try {
    await expect(reconcileGroupResultProjection({
      projection,
      transport: {
        load: async () => {
          locklessTransportCalls += 1;
          return { body: latest, ok: true, status: 200 };
        },
        put: async () => {
          locklessTransportCalls += 1;
          return { body: undefined, ok: false, status: 500 };
        },
      },
    })).resolves.toMatchObject({ attempts: 0, status: "exhausted" });
  } finally {
    if (previousProjectionWindow) projectionHost.window = previousProjectionWindow;
    else delete projectionHost.window;
  }
  expect(locklessTransportCalls).toBe(0);

  let dedupedPuts = 0;
  const dedupedTransport = {
    load: async () => ({ body: latest, ok: true, status: 200 }),
    put: async (input: { payload: string }) => {
      dedupedPuts += 1;
      const request = JSON.parse(input.payload) as { revision: number };
      return {
        body: {
          graphRevision: request.revision + 1,
          loadToken: "load-token-deduped",
          revision: request.revision + 1,
        },
        ok: true,
        status: 200,
      };
    },
  };
  const firstApplication = enqueueGroupResultProjection(projection, {
    transport: dedupedTransport,
  });
  const duplicateApplication = enqueueGroupResultProjection(projection, {
    transport: dedupedTransport,
  });
  expect(duplicateApplication).toBe(firstApplication);
  await expect(waitForGroupResultProjections(projection.runId)).resolves.toEqual([
    expect.objectContaining({ status: "applied" }),
  ]);
  expect(dedupedPuts).toBe(1);

  const keepOriginalFailure = await runGroupNodeWithPersist({
    persist: async () => "画布保存超时，请稍后再试",
    run: async () => ({ message: "请明确选择兼容的图片模型", status: "failed" }),
  });
  expect(keepOriginalFailure).toEqual({
    message: "请明确选择兼容的图片模型",
    status: "failed",
  });

  expect(isCanvasNotSavedMessage("画布还在保存，请稍等保存完成后再试")).toBe(
    true,
  );
  expect(isCanvasNotSavedMessage("画布保存超时，请稍后再试")).toBe(false);
  expect(isCanvasNotSavedMessage("模型平台未完成本次生成，请重试")).toBe(false);
  expect(shouldAcceptCanvasRevision({
    dirty: false,
    revision: 12,
    saving: false,
  })).toBe(true);
  expect(shouldAcceptCanvasRevision({
    dirty: true,
    revision: 12,
    saving: false,
  })).toBe(false);
  expect(shouldAcceptCanvasRevision({
    dirty: false,
    revision: 12,
    saving: true,
  })).toBe(false);
  expect(workflowToastDurationMs("error")).toBe(8_000);
  expect(workflowToastDurationMs("success")).toBe(2_600);
  expect(workflowToastDurationMs("info")).toBe(2_600);

  const paintOrder: string[] = [];
  await persistGroupCanvasAfterNode({
    save: {
      flush: async () => {
        paintOrder.push("flush");
      },
      waitForRevision: async () => {
        paintOrder.push("wait");
        return { revision: 4 };
      },
    },
    waitForPaint: async () => {
      paintOrder.push("paint");
    },
  });
  expect(paintOrder).toEqual(["paint", "flush", "wait"]);
});

test("stale canvas-save leftovers are not group-incompatible and can be stripped", () => {
  const leftover = {
    code: "INVALID",
    message: "画布还在保存，请稍等保存完成后再试",
  };
  expect(shouldIgnoreStaleCanvasSaveProblem(leftover)).toBe(true);
  expect(workflowSubmissionPreflightProblem({
    executableIds: new Set(["director", "cover"]),
    inputs: [],
    problems: [leftover],
  })).toBeUndefined();
  expect(workflowSubmissionPreflightProblem({
    executableIds: new Set(["director", "cover"]),
    inputs: [],
    problems: [
      leftover,
      {
        code: "MODEL_UNSUPPORTED",
        message: "当前模型不支持image类型上游，引用已保留",
      },
    ],
  })).toMatchObject({ code: "MODEL_UNSUPPORTED" });
  expect(workflowRuntimePreflightDisposition({
    executableIds: new Set(["director"]),
    inputs: [],
    problems: [leftover],
  })).toEqual({ status: "ready" });

  const stripped = stripStaleCanvasSaveErrors([
    {
      data: { title: "组" },
      id: "group",
      parentId: undefined,
    },
    {
      data: {
        textGenerationError: leftover.message,
        textGenerationErrorCode: "INVALID",
        title: "生成P1带货导演稿",
      },
      id: "director",
      parentId: "group",
    },
    {
      data: {
        imageGenerationError: "图片生成失败，请稍后再试",
        imageGenerationErrorCode: "GENERATION_FAILED",
        title: "OOTD种草图",
      },
      id: "cover",
      parentId: "group",
    },
  ], "group");
  expect(stripped.changed).toBe(true);
  expect(stripped.nodes[1]?.data).toEqual({ title: "生成P1带货导演稿" });
  expect(stripped.nodes[2]?.data).toMatchObject({
    imageGenerationError: "图片生成失败，请稍后再试",
    imageGenerationErrorCode: "GENERATION_FAILED",
  });
});

test("save gate turns a save failure into a friendly node failure", async () => {
  let runCalled = false;
  const run = createSaveGateRun(
    async () => {
      throw new Error("画布保存状态异常");
    },
    async () => {
      runCalled = true;
      return { status: "success" };
    },
    "video",
  );
  await expect(run()).resolves.toMatchObject({
    message: "画布保存状态异常，请刷新页面后重试",
    status: "failed",
  });
  expect(runCalled).toBe(false);
});

test("group run stays disabled on acceptance fixtures and makes no provider requests", async ({
  page,
}) => {
  let providerRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      /generation-tasks|provider|openrouter|volces|mureka/i.test(request.url())
    ) {
      providerRequests += 1;
    }
  });
  await page.goto("/__fixture/legacy.node.group-dense-selected");
  const button = page.getByTestId("group-execute-button");
  await expect(button).toBeDisabled();
  await page.waitForTimeout(400);
  expect(providerRequests).toBe(0);
});

test("group run preflights a truly unmounted offscreen Image and persists the real model error", async ({
  page,
  request,
}) => {
  const modelId = `fixture-no-image-reference-${randomUUID()}`;
  const assetId = `fixture-group-reference-${randomUUID()}`;
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = await created.json() as { id: string };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploaded = await request.post(`/api/assets/${assetId}`, {
    data: png,
    headers: { "Content-Type": "image/png", "X-File-Name": "reference.png" },
  });
  expect(uploaded.status()).toBe(201);
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
      taskPosts.push(entry.url());
    }
  });
  const parameterSchema = {
    ...defaultParameterSchema("image"),
    referenceInputs: { audio: 0, image: 0, video: 0 },
  };
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "不支持参考图测试模型",
          generationAvailable: true,
          id: modelId,
          imageParameters: {
            aspectRatios: ["auto"],
            maxReferenceImages: 0,
            qualities: ["auto"],
          },
          isDefault: true,
          parameterSchema,
        }],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  try {
    const saveMetadata = await existingCanvasSaveMetadata(request, project.id);
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "reference-image" },
          id: "edge-reference-target",
          source: "reference-image",
          sourceHandle: "source",
          target: "target-image",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [{
          data: { label: "Group", title: "图片生成组" },
          id: "image-group",
          position: { x: 100, y: 100 },
          style: { height: 700, width: 2_300 },
          type: "group",
          zIndex: 0,
        }, {
          data: {
            assetId,
            imageSrc: `/api/assets/${assetId}`,
            inputState: "ready",
            label: "Image",
            title: "商品参考图",
          },
          id: "reference-image",
          parentId: "image-group",
          position: { x: 30, y: 60 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        }, {
          data: {
            imageModelId: modelId,
            imageParameters: {},
            imagePrompt: "生成同组封面",
            imagePromptReady: true,
            label: "Image",
            title: "会被整组预检拦截的同层节点",
          },
          id: "valid-sibling-image",
          parentId: "image-group",
          position: { x: 30, y: 330 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        }, {
          data: {
            imageModelId: modelId,
            imageParameters: {},
            imagePrompt: "生成商品主图",
            imagePromptReady: true,
            label: "Image",
            title: "商品主图",
          },
          id: "target-image",
          parentId: "image-group",
          position: { x: 1_900, y: 60 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        }],
        ...saveMetadata,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/canvas/${project.id}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await page.locator('[data-testid="rf__node-image-group"]').click({
      position: { x: 5, y: 5 },
    });
    const execute = page.getByTestId("group-execute-button");
    await expect(execute).toBeEnabled();
    await expect(page.locator('[data-testid="rf__node-target-image"]'))
      .toHaveCount(0);
    await page.evaluate(() => {
      const state = window as typeof window & {
        __groupSummaryEvents?: number;
        __lastGroupSummaryScope?: {
          accountId: string;
          fixtureScopeId: string;
        };
      };
      state.__groupSummaryEvents = 0;
      window.addEventListener("unboundry:group-run-summary", (event) => {
        state.__groupSummaryEvents = (state.__groupSummaryEvents ?? 0) + 1;
        const detail = (event as CustomEvent<{
          accountId: string;
          fixtureScopeId: string;
        }>).detail;
        state.__lastGroupSummaryScope ??= {
          accountId: detail.accountId,
          fixtureScopeId: detail.fixtureScopeId,
        };
      });
    });
    await execute.dblclick();
    const expectedMessage = "当前模型不支持image类型上游，引用已保留";
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      `整组执行已阻止：发现 1 个不兼容节点；首个“商品主图”：${expectedMessage}（未提交任何生成任务）`,
      { timeout: 15_000 },
    );
    await page.getByTestId("tasks").click();
    const summary = page.getByTestId("tasks-group-summary");
    await expect(summary).toContainText("最近一轮整组部分失败");
    await expect(summary).toContainText("成功 0 · 失败 1 · 跳过 0 · 未运行 1");
    await expect(summary).toContainText("首个失败：商品主图（MODEL_UNSUPPORTED）");
    await expect(summary).toContainText(expectedMessage);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __groupSummaryEvents?: number })
        .__groupSummaryEvents
    )).toBe(2);
    await summary.getByTestId("tasks-group-summary-locate").click();
    await expect(page.locator('[data-testid="rf__node-target-image"]'))
      .toHaveClass(/selected/);
    await expect(page.getByTestId("image-node-target-image").getByRole("alert"))
      .toContainText(expectedMessage);
    await summary.getByRole("button", { name: "关闭最近一轮整组摘要" }).click();
    await expect(summary).toHaveCount(0);
    await page.evaluate(({ canvasId }) => {
      const state = window as typeof window & {
        __lastGroupSummaryScope?: { accountId: string; fixtureScopeId: string };
      };
      const scope = state.__lastGroupSummaryScope;
      if (!scope) throw new Error("missing captured group summary scope");
      const base = {
          accountId: scope.accountId,
          blockedCount: 0,
          blockedNodeIds: [],
          canvasId,
          completedAt: Date.now(),
          elapsedMs: 25,
          failedCount: 0,
          failedNodeIds: [],
          fixtureScopeId: scope.fixtureScopeId,
          groupId: "image-group",
          nodeCount: 1,
          reason: "不应跨范围显示",
          runId: "wrong-scope-run",
          runSequence: 10_001,
          skippedCount: 1,
          skippedNodeIds: ["target-image"],
          status: "skipped",
          startedAt: Date.now() - 25,
          successCount: 0,
      };
      for (const [index, override] of [
        { accountId: `${scope.accountId}-wrong` },
        { canvasId: `${canvasId}-wrong` },
        { fixtureScopeId: `${scope.fixtureScopeId}-wrong` },
      ].entries()) {
        window.dispatchEvent(new CustomEvent("unboundry:group-run-summary", {
          detail: {
            ...base,
            ...override,
            runId: `wrong-scope-run-${index}`,
            runSequence: 10_001 + index,
          },
        }));
      }
    }, { canvasId: project.id });
    await expect(page.getByTestId("tasks-group-summary")).toHaveCount(0);
    await page.evaluate(({ canvasId }) => {
      const state = window as typeof window & {
        __lastGroupSummaryScope?: { accountId: string; fixtureScopeId: string };
      };
      const scope = state.__lastGroupSummaryScope;
      if (!scope) throw new Error("missing captured group summary scope");
      window.dispatchEvent(new CustomEvent("unboundry:group-run-summary", {
        detail: {
          accountId: scope.accountId,
          blockedCount: 0,
          blockedNodeIds: [],
          canvasId,
          completedAt: Date.now(),
          elapsedMs: 25,
          failedCount: 0,
          failedNodeIds: [],
          fixtureScopeId: scope.fixtureScopeId,
          groupId: "image-group",
          nodeCount: 1,
          reason: "节点仍在生成，请等待当前节点完成",
          runId: "manual-skipped-run",
          runSequence: 10_002,
          skippedCount: 1,
          skippedNodeIds: ["target-image"],
          status: "skipped",
          startedAt: Date.now() - 25,
          successCount: 0,
        },
      }));
    }, { canvasId: project.id });
    const skippedSummary = page.getByTestId("tasks-group-summary");
    await expect(skippedSummary).toContainText("跳过 1 · 未运行 0");
    await expect(skippedSummary).toContainText("节点仍在生成，请等待当前节点完成");
    await skippedSummary.getByRole("button", { name: "关闭最近一轮整组摘要" }).click();
    await expect.poll(async () => {
      const canvas = await (await request.get(`/api/canvas/${project.id}`)).json() as {
        nodes: Array<{
          data: { imageGenerationError?: string; imageGenerationErrorCode?: string };
          id: string;
        }>;
      };
      return canvas.nodes.find((node) => node.id === "target-image")?.data;
    }).toMatchObject({
      imageGenerationError: expectedMessage,
      imageGenerationErrorCode: "MODEL_UNSUPPORTED",
    });

    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await expect(page.getByTestId("image-node-target-image").getByRole("alert"))
      .toContainText(expectedMessage);
    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-group-summary")).toHaveCount(0);
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(taskPosts).toEqual([]);
  } finally {
    await request.delete(`/api/canvas/${project.id}`);
    await request.delete(`/api/projects/${project.id}`);
    await request.delete(`/api/assets/${assetId}`);
  }
});

test("disjoint group runs isolate success, failure and stop while unrelated edits stay available", async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const modelId = `fixture-group-lock-${randomUUID()}`;
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = await created.json() as { id: string };
  const parameterSchema = defaultParameterSchema("text");
  type FakeTaskState = "failed" | "running" | "success";
  type FakeTask = {
    attempt: number;
    canvasId: string;
    costCurrency: "CNY";
    createdAt: string;
    id: string;
    kind: "text";
    model: string;
    nodeId: string;
    prompt: string;
    updatedAt: string;
  };
  const tasks = new Map<string, FakeTask>();
  const taskStates = new Map<string, FakeTaskState>();
  const latestTaskByNode = new Map<string, string>();
  const taskPostNodes: string[] = [];
  type CapturedSummary = { groupId: string; runId: string; status: string };
  const terminalSummaries: CapturedSummary[] = [];
  let taskSequence = 0;
  const taskJson = (task: FakeTask) => {
    const state = taskStates.get(task.id) ?? "running";
    return {
      ...task,
      ...(state === "failed"
        ? { error: "故意失败，验证另一轮继续", errorCode: "FIXTURE_FAILURE" }
        : {}),
      ...(state === "success"
        ? { resultText: `已完成 ${task.nodeId} / ${task.id}` }
        : {}),
      state,
    };
  };
  const setLatestTaskState = (nodeId: string, state: FakeTaskState) => {
    const taskId = latestTaskByNode.get(nodeId);
    if (!taskId) throw new Error(`missing fake task for ${nodeId}`);
    taskStates.set(taskId, state);
  };
  const withDeadline = async <T>(label: string, promise: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`dual-run timeout: ${label}`)), 15_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  await page.context().route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [{
          capability: "text",
          displayName: "整组锁定测试模型",
          generationAvailable: true,
          id: modelId,
          isDefault: true,
          parameterSchema,
        }],
      },
      status: 200,
    });
  });
  await page.context().route("**/api/generation-tasks**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const method = route.request().method();
    if (requestUrl.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
          textProviderConfigured: true,
          textSubmissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (requestUrl.pathname.endsWith("/preflight") && method === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: { canEnqueue: true, canSubmit: true, problems: [] },
        status: 200,
      });
      return;
    }
    if (
      requestUrl.pathname === "/api/generation-tasks/by-idempotency" &&
      method === "GET"
    ) {
      await route.fulfill({
        contentType: "application/json",
        json: { error: "not found" },
        status: 404,
      });
      return;
    }
    if (requestUrl.pathname === "/api/generation-tasks" && method === "POST") {
      const body = route.request().postDataJSON() as {
        nodeId: string;
        prompt: string;
      };
      taskSequence += 1;
      const taskId = `fixture-group-lock-task-${taskSequence}-${randomUUID()}`;
      const task: FakeTask = {
        attempt: 1,
        canvasId: project.id,
        costCurrency: "CNY",
        createdAt: new Date().toISOString(),
        id: taskId,
        kind: "text",
        model: modelId,
        nodeId: body.nodeId,
        prompt: body.prompt,
        updatedAt: new Date().toISOString(),
      };
      tasks.set(taskId, task);
      taskStates.set(taskId, "running");
      latestTaskByNode.set(body.nodeId, taskId);
      taskPostNodes.push(body.nodeId);
      await route.fulfill({
        contentType: "application/json",
        json: taskJson(task),
        status: 202,
      });
      return;
    }
    const taskId = requestUrl.pathname.startsWith("/api/generation-tasks/")
      ? requestUrl.pathname.split("/").at(-1)
      : undefined;
    if (taskId && tasks.has(taskId) && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: taskJson(tasks.get(taskId)!),
        status: 200,
      });
      return;
    }
    if (requestUrl.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [...tasks.values()].map(taskJson) },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: "unexpected fake generation task request" },
      status: 404,
    });
  });

  const startGroup = async (
    groupId: string,
    nodeId: string,
    expectedNodePostCount: number,
  ) => {
    await withDeadline(`${groupId} select`, page
      .locator(`[data-testid="rf__node-${groupId}"]`)
      .evaluate((element) => element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
      }))));
    const execute = page
      .locator(`[data-testid="rf__node-${groupId}"]`)
      .getByTestId("group-execute-button");
    await expect(execute).toBeEnabled();
    await withDeadline(`${groupId} execute click`, execute.evaluate((element) =>
      (element as HTMLButtonElement).click()
    ));
    await withDeadline(`${groupId} task POST`, expect.poll(() =>
      taskPostNodes.filter((candidate) => candidate === nodeId).length
    ).toBe(expectedNodePostCount));
  };
  const discardInterruptedCheckpointsForNextScenario = () => page.evaluate(() => {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("unboundry-group-run-checkpoint:v1:")) {
        window.localStorage.removeItem(key);
      }
    }
  });
  const expectTerminalSummaryCount = (
    groupId: string,
    status: "cancelled" | "failed" | "success",
    count: number,
  ) => expect.poll(() => page.evaluate(({ groupId, status }) =>
    ((window as typeof window & {
      __dualRunSummaries?: Array<{ groupId: string; runId: string; status: string }>;
    }).__dualRunSummaries ?? []).filter((summary) =>
      summary.groupId === groupId && summary.status === status
    ).length, { groupId, status }), { timeout: 15_000 }).toBe(count);
  const installSummaryCapture = () => page.evaluate(() => {
    const host = window as typeof window & {
      __dualRunSummaries?: Array<{ groupId: string; runId: string; status: string }>;
    };
    host.__dualRunSummaries = [];
    window.addEventListener("unboundry:group-run-summary", (event) => {
      const detail = (event as CustomEvent<{
        groupId: string;
        runId: string;
        status: string;
      }>).detail;
      host.__dualRunSummaries?.push({
        groupId: detail.groupId,
        runId: detail.runId,
        status: detail.status,
      });
    });
  });
  const captureTerminalSummaries = async () => {
    terminalSummaries.push(...await page.evaluate(() =>
      ((window as typeof window & {
        __dualRunSummaries?: Array<{ groupId: string; runId: string; status: string }>;
      }).__dualRunSummaries ?? []).filter((summary) =>
        ["cancelled", "failed", "success"].includes(summary.status)
      )
    ));
  };
  const resetGroupPositionsForNextScenario = async () => {
    const response = await request.get(`/api/canvas/${project.id}`);
    expect(response.ok()).toBeTruthy();
    const current = await response.json() as {
      edges: unknown[];
      loadToken: string;
      nodes: Array<{
        id: string;
        position: { x: number; y: number };
        [key: string]: unknown;
      }>;
      revision: number;
    };
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: current.edges,
        nodes: current.nodes.map((node) => node.id === "run-group-a"
          ? { ...node, position: { x: 180, y: 120 } }
          : node.id === "run-group-b"
            ? { ...node, position: { x: 760, y: 120 } }
            : node),
        observedLoadToken: current.loadToken,
        observedRevision: current.revision,
        revision: current.revision,
        saveAttemptId: randomUUID(),
        saveSequence: 1,
        saveSessionId: randomUUID(),
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await installSummaryCapture();
  };

  try {
    const saveMetadata = await existingCanvasSaveMetadata(request, project.id);
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [{
          id: "run-edge-a-next",
          source: "run-text-a",
          sourceHandle: "source",
          target: "run-text-a-next",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [{
          data: { label: "Group", title: "运行中锁定组 A" },
          id: "run-group-a",
          position: { x: 180, y: 120 },
          style: { height: 650, width: 480 },
          type: "group",
          zIndex: 0,
        }, {
          data: {
            label: "Text",
            textModelId: modelId,
            textParameters: {},
            textPrompt: "生成 A 组运行中测试文案",
            textPromptReady: true,
            title: "运行中子节点 A",
          },
          id: "run-text-a",
          parentId: "run-group-a",
          position: { x: 32, y: 70 },
          style: { height: 220, width: 300 },
          type: "text",
          zIndex: 1,
        }, {
          data: {
            label: "Text",
            textModelId: modelId,
            textParameters: {},
            textPrompt: "生成 A 组第二层文案",
            textPromptReady: true,
            title: "运行中下游子节点 A2",
          },
          id: "run-text-a-next",
          parentId: "run-group-a",
          position: { x: 32, y: 900 },
          style: { height: 220, width: 300 },
          type: "text",
          zIndex: 1,
        }, {
          data: { label: "Group", title: "运行中锁定组 B" },
          id: "run-group-b",
          position: { x: 760, y: 120 },
          style: { height: 420, width: 480 },
          type: "group",
          zIndex: 0,
        }, {
          data: {
            label: "Text",
            textModelId: modelId,
            textParameters: {},
            textPrompt: "生成 B 组运行中测试文案",
            textPromptReady: true,
            title: "运行中子节点 B",
          },
          id: "run-text-b",
          parentId: "run-group-b",
          position: { x: 32, y: 70 },
          style: { height: 220, width: 300 },
          type: "text",
          zIndex: 1,
        }, {
          data: {
            label: "Text",
            textModelId: modelId,
            textParameters: {},
            textPrompt: "可在运行期间编辑的无关文案",
            textPromptReady: true,
            title: "无关文字节点",
          },
          id: "unrelated-text",
          position: { x: 180, y: 850 },
          style: { height: 220, width: 300 },
          type: "text",
          zIndex: 1,
        }, {
          data: {
            imagePromptReady: false,
            inputState: "empty",
            label: "Image",
            title: "无关图片节点",
          },
          id: "unrelated-image",
          position: { x: 760, y: 850 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        }],
        ...saveMetadata,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/canvas/${project.id}`);
    const canvas = page.getByTestId("canvas-world");
    await expect(canvas).toHaveAttribute("data-persistence-ready", "true");
    await installSummaryCapture();

    await startGroup("run-group-a", "run-text-a", 1);
    await startGroup("run-group-b", "run-text-b", 1);
    await expect(canvas).toHaveAttribute("data-workflow-run-active", "true");
    // A's second layer starts genuinely outside the viewport. Static preflight
    // must still include it before fit-view can mount it later.
    await expect(page.locator('[data-testid="rf__node-run-text-a-next"]'))
      .toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-node-count", "7");
    await expect(canvas).toHaveAttribute("data-edge-count", "1");

    // View controls and unrelated graph editing remain live while two runs own
    // only their exact participants.
    const zoomBeforeFit = await canvas.getAttribute("data-viewport-zoom");
    await page.getByTestId("fit-view").click();
    await expect.poll(() => canvas.getAttribute("data-viewport-zoom"))
      .not.toBe(zoomBeforeFit);
    await page.getByTestId("zoom-slider").fill("0.72");
    await expect(canvas).toHaveAttribute("data-viewport-zoom", "0.72");
    const unrelatedText = page.locator('[data-testid="rf__node-unrelated-text"]');
    await unrelatedText.click({ position: { x: 12, y: 12 } });
    await page.getByTestId("text-creator-prompt")
      .fill("运行期间仍可编辑的无关文案");
    await expect(page.getByTestId("text-creator-prompt"))
      .toHaveValue("运行期间仍可编辑的无关文案");
    await page.getByTestId("text-creator-prompt").blur();
    await unrelatedText.evaluate((element) => element.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    const unrelatedBefore = await unrelatedText.boundingBox();
    await page.mouse.move(
      unrelatedBefore!.x + unrelatedBefore!.width / 2,
      unrelatedBefore!.y + unrelatedBefore!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      unrelatedBefore!.x + unrelatedBefore!.width / 2 + 28,
      unrelatedBefore!.y + unrelatedBefore!.height / 2 + 20,
      { steps: 6 },
    );
    await page.mouse.up();
    const unrelatedAfter = await unrelatedText.boundingBox();
    expect(unrelatedAfter!.x).toBeGreaterThan(unrelatedBefore!.x);
    const sourceHandle = unrelatedText.locator(
      ".react-flow__handle.source .node-handle-hit",
    );
    const targetNode = page.locator('[data-testid="rf__node-unrelated-image"]');
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetNode.boundingBox();
    if (!sourceBox || !targetBox) throw new Error("unrelated connection handles missing");
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(canvas).toHaveAttribute("data-edge-count", "2");
    await targetNode.click();
    await page.keyboard.press("Backspace");
    await expect(canvas).toHaveAttribute("data-node-count", "6");
    await expect(canvas).toHaveAttribute("data-edge-count", "1");

    const groupB = page.locator('[data-testid="rf__node-run-group-b"]');
    await expect(groupB.getByRole("button", { name: "组合框颜色" })).toBeDisabled();
    await expect(groupB.getByRole("button", { name: "组合框布局" })).toBeDisabled();
    await expect(groupB.getByTestId("group-template-button")).toBeDisabled();
    await expect(groupB.getByRole("button", { name: "解组" })).toBeDisabled();
    await expect(groupB.getByTestId("group-execute-button")).toHaveText("停止后续");

    const childA = page.locator('[data-testid="rf__node-run-text-a"]');
    await expect(childA).toHaveCount(1);
    await expect.poll(() => childA.evaluate((element) => ({
      ariaLabel: element.getAttribute("aria-label"),
      className: element.className,
      pointerEvents: getComputedStyle(element).pointerEvents,
    }))).toEqual({
      ariaLabel: "运行中子节点 A，整组执行中，Prompt、模型、参数和输入已锁定",
      className: expect.stringContaining("workflow-run-locked"),
      pointerEvents: "none",
    });
    await childA.evaluate((element) => element.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    await page.keyboard.press("Backspace");
    await expect(canvas).toHaveAttribute("data-node-count", "6");

    // A selected running participant cannot be deleted. Copy/paste creates a
    // disjoint graph, and that unrelated copy can be deleted while both runs
    // keep their exact task ownership.
    await page.locator('[data-testid="rf__node-run-group-a"]').click({
      position: { x: 8, y: 8 },
    });
    await page.keyboard.press("Backspace");
    await expect(canvas).toHaveAttribute("data-node-count", "6");
    await page.locator('[data-testid="rf__edge-run-edge-a-next"]')
      .evaluate((element) => element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
      })));
    await expect(page.getByTestId("cut-edge-run-edge-a-next")).toBeDisabled();
    await unrelatedText.click({ position: { x: 12, y: 12 } });
    await page.keyboard.press("Meta+c");
    await page.keyboard.press("Meta+v");
    await expect(canvas).toHaveAttribute("data-node-count", "7");
    await page.keyboard.press("Backspace");
    await expect(canvas).toHaveAttribute("data-node-count", "6");
    expect(taskPostNodes).toEqual(["run-text-a", "run-text-b"]);

    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-panel")).toBeVisible();
    await expect(page.getByTestId("tasks-group-summary")).toHaveAttribute(
      "data-status",
      "running",
    );

    await page.locator('[data-testid="rf__node-run-group-a"]').click({
      position: { x: 8, y: 8 },
    });
    const body = page.getByTestId("group-node-run-group-a");
    const box = await body.boundingBox();
    if (!box) throw new Error("running group body is not mounted");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(-800, -500, { steps: 12 });
    await page.mouse.up();

    await expect(canvas).toHaveAttribute("data-workflow-run-active", "true");
    await expect(childA).toHaveCount(0);
    await expect(page.locator('[data-testid="rf__node-run-text-a-next"]'))
      .toHaveCount(0);

    // Completing A's first layer while the whole group is truly unmounted must
    // dispatch and apply the second layer without releasing B.
    setLatestTaskState("run-text-a", "success");
    await withDeadline("run-text-a-next task POST", expect.poll(() =>
      taskPostNodes.filter((candidate) => candidate === "run-text-a-next").length
    ).toBe(1));
    setLatestTaskState("run-text-a-next", "success");
    await expectTerminalSummaryCount("run-group-a", "success", 1);
    await expect(canvas).toHaveAttribute("data-workflow-run-active", "true");
    await expect.poll(async () => {
      const savedCanvas = await (await request.get(`/api/canvas/${project.id}`)).json() as {
        nodes: Array<{ data: { content?: string }; id: string }>;
      };
      return savedCanvas.nodes.find((node) => node.id === "run-text-a-next")?.data.content;
    }).toContain("已完成 run-text-a-next");
    setLatestTaskState("run-text-b", "failed");
    await expectTerminalSummaryCount("run-group-b", "failed", 1);
    await expect(canvas).not.toHaveAttribute("data-workflow-run-active", "true");
    await captureTerminalSummaries();
    await discardInterruptedCheckpointsForNextScenario();
    await resetGroupPositionsForNextScenario();

    // A failed terminal state must likewise leave B running.
    await startGroup("run-group-a", "run-text-a", 2);
    await startGroup("run-group-b", "run-text-b", 2);
    setLatestTaskState("run-text-a", "failed");
    await expectTerminalSummaryCount("run-group-a", "failed", 1);
    expect(taskPostNodes.filter((nodeId) => nodeId === "run-text-a-next"))
      .toHaveLength(1);
    await expect(canvas).toHaveAttribute("data-workflow-run-active", "true");
    setLatestTaskState("run-text-b", "success");
    await expectTerminalSummaryCount("run-group-b", "success", 1);
    await expect(canvas).not.toHaveAttribute("data-workflow-run-active", "true");
    await captureTerminalSummaries();
    await discardInterruptedCheckpointsForNextScenario();
    await resetGroupPositionsForNextScenario();

    // Stopping A prevents later dispatch for A but does not stop B. The active
    // A task still reaches a durable terminal result, as promised by the UI.
    await startGroup("run-group-a", "run-text-a", 3);
    await startGroup("run-group-b", "run-text-b", 3);
    await page
      .locator('[data-testid="rf__node-run-group-a"]')
      .getByTestId("group-execute-button")
      .evaluate((element) => (element as HTMLButtonElement).click());
    setLatestTaskState("run-text-a", "success");
    await expectTerminalSummaryCount("run-group-a", "cancelled", 1);
    expect(taskPostNodes.filter((nodeId) => nodeId === "run-text-a-next"))
      .toHaveLength(1);
    await expect(canvas).toHaveAttribute("data-workflow-run-active", "true");
    setLatestTaskState("run-text-b", "success");
    await expectTerminalSummaryCount("run-group-b", "success", 1);
    await expect(canvas).not.toHaveAttribute("data-workflow-run-active", "true");
    await captureTerminalSummaries();
    expect(taskPostNodes).toEqual([
      "run-text-a", "run-text-b",
      "run-text-a-next",
      "run-text-a", "run-text-b",
      "run-text-a", "run-text-b",
    ]);
    expect(terminalSummaries.filter((summary) =>
      summary.groupId === "run-group-a" && summary.status === "success"
    )).toHaveLength(1);
    expect(terminalSummaries.filter((summary) =>
      summary.groupId === "run-group-a" && summary.status === "failed"
    )).toHaveLength(1);
    expect(terminalSummaries.filter((summary) =>
      summary.groupId === "run-group-a" && summary.status === "cancelled"
    )).toHaveLength(1);
    expect(terminalSummaries.filter((summary) =>
      summary.groupId === "run-group-b" && summary.status === "success"
    )).toHaveLength(2);
    expect(terminalSummaries.filter((summary) =>
      summary.groupId === "run-group-b" && summary.status === "failed"
    )).toHaveLength(1);
    expect(new Set(terminalSummaries.map((summary) => summary.runId)).size)
      .toBe(6);

    // Release the last active nodes of two groups in the same polling window.
    // Both terminal summaries remain independently addressable and both
    // successful checkpoints clear without deleting sibling state.
    await discardInterruptedCheckpointsForNextScenario();
    await resetGroupPositionsForNextScenario();
    const simultaneousAPosts = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a"
    ).length;
    const simultaneousBPosts = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-b"
    ).length;
    const simultaneousDownstreamPosts = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a-next"
    ).length;
    await startGroup("run-group-a", "run-text-a", simultaneousAPosts + 1);
    await startGroup("run-group-b", "run-text-b", simultaneousBPosts + 1);
    setLatestTaskState("run-text-a", "success");
    await expect.poll(() => taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a-next"
    ).length).toBe(simultaneousDownstreamPosts + 1);
    setLatestTaskState("run-text-a-next", "success");
    setLatestTaskState("run-text-b", "success");
    await expectTerminalSummaryCount("run-group-a", "success", 1);
    await expectTerminalSummaryCount("run-group-b", "success", 1);
    await expect(canvas).not.toHaveAttribute("data-workflow-run-active", "true");
    await expect.poll(() => page.evaluate(() => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        if (window.localStorage.key(index)?.startsWith(
          "unboundry-group-run-checkpoint:v1:",
        )) return false;
      }
      return true;
    })).toBe(true);

    // Both groups now consume the same durable external Text input. Starting
    // B while A owns that source must identify the exact shared node and keep
    // B at zero task submissions.
    await resetGroupPositionsForNextScenario();
    const overlapResponse = await request.get(`/api/canvas/${project.id}`);
    expect(overlapResponse.ok()).toBeTruthy();
    const overlapCanvas = await overlapResponse.json() as {
      edges: Array<{ id: string; [key: string]: unknown }>;
      loadToken: string;
      nodes: Array<{
        data: Record<string, unknown>;
        id: string;
        [key: string]: unknown;
      }>;
      revision: number;
    };
    const overlapSave = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [
          ...overlapCanvas.edges,
          {
            id: "run-edge-shared-a",
            source: "unrelated-text",
            sourceHandle: "source",
            target: "run-text-a",
            targetHandle: "target",
            type: "cuttable",
          },
          {
            id: "run-edge-shared-b",
            source: "unrelated-text",
            sourceHandle: "source",
            target: "run-text-b",
            targetHandle: "target",
            type: "cuttable",
          },
        ],
        nodes: overlapCanvas.nodes.map((node) => node.id === "unrelated-text"
          ? {
              ...node,
              data: {
                ...node.data,
                content: "两个工作流共享的真实输入",
                contentHtml: "<p>两个工作流共享的真实输入</p>",
              },
            }
          : node),
        observedLoadToken: overlapCanvas.loadToken,
        observedRevision: overlapCanvas.revision,
        revision: overlapCanvas.revision,
        saveAttemptId: randomUUID(),
        saveSequence: 1,
        saveSessionId: randomUUID(),
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(overlapSave.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await installSummaryCapture();
    const overlapAPosts = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a"
    ).length;
    const overlapBPosts = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-b"
    ).length;
    const overlapDownstreamPosts = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a-next"
    ).length;
    await startGroup("run-group-a", "run-text-a", overlapAPosts + 1);
    const overlapGroupB = page.locator('[data-testid="rf__node-run-group-b"]');
    await overlapGroupB.evaluate((element) => element.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    await overlapGroupB.getByTestId("group-execute-button")
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "另一轮正在使用直接输入“无关文字节点”（节点 unrelated-text），本轮未提交任何生成任务",
    );
    expect(taskPostNodes.filter((nodeId) => nodeId === "run-text-b"))
      .toHaveLength(overlapBPosts);
    setLatestTaskState("run-text-a", "success");
    await expect.poll(() => taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a-next"
    ).length).toBe(overlapDownstreamPosts + 1);
    setLatestTaskState("run-text-a-next", "success");
    await expectTerminalSummaryCount("run-group-a", "success", 1);

    const restoreResponse = await request.get(`/api/canvas/${project.id}`);
    expect(restoreResponse.ok()).toBeTruthy();
    const restoreCanvas = await restoreResponse.json() as {
      edges: Array<{ id: string; [key: string]: unknown }>;
      loadToken: string;
      nodes: unknown[];
      revision: number;
    };
    const restoreSave = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: restoreCanvas.edges.filter((edge) =>
          !["run-edge-shared-a", "run-edge-shared-b"].includes(edge.id)
        ),
        nodes: restoreCanvas.nodes,
        observedLoadToken: restoreCanvas.loadToken,
        observedRevision: restoreCanvas.revision,
        revision: restoreCanvas.revision,
        saveAttemptId: randomUUID(),
        saveSequence: 1,
        saveSessionId: randomUUID(),
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(restoreSave.ok()).toBeTruthy();

    // Two real tabs race the same group. The origin-wide admission lock and
    // active-task check permit one first-layer POST only.
    await discardInterruptedCheckpointsForNextScenario();
    await resetGroupPositionsForNextScenario();
    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    const secondPage = await page.context().newPage();
    try {
      await secondPage.goto(`/canvas/${project.id}`);
      await expect(secondPage.getByTestId("canvas-world")).toHaveAttribute(
        "data-persistence-ready",
        "true",
      );
      const selectAndStart = async (targetPage: typeof page) => {
        const group = targetPage.locator('[data-testid="rf__node-run-group-a"]');
        await group.evaluate((element) => element.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        ));
        await group.getByTestId("group-execute-button")
          .evaluate((element) => (element as HTMLButtonElement).click());
      };
      const groupRaceAPosts = taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a"
      ).length;
      const groupRaceDownstreamPosts = taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a-next"
      ).length;
      await Promise.all([selectAndStart(page), selectAndStart(secondPage)]);
      await expect.poll(() => taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a"
      ).length).toBe(groupRaceAPosts + 1);
      await expect.poll(() => page.evaluate(() => {
        let leases = 0;
        for (let index = 0; index < window.localStorage.length; index += 1) {
          if (window.localStorage.key(index)?.startsWith(
            "unboundry-group-run-lease:v1:",
          )) leases += 1;
        }
        return leases;
      })).toBe(1);
      setLatestTaskState("run-text-a", "success");
      await expect.poll(() => taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a-next"
      ).length).toBe(groupRaceDownstreamPosts + 1);
      setLatestTaskState("run-text-a-next", "success");
      await expect.poll(() => page.evaluate(() => {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          if (window.localStorage.key(index)?.startsWith(
            "unboundry-group-run-lease:v1:",
          )) return false;
        }
        return true;
      })).toBe(true);
    } finally {
      await secondPage.close();
    }

    // A manual Generate and a group claim use the same origin-wide admission
    // lock. Whichever enters first may submit, while the loser observes either
    // the active lease or the accepted task before reaching a second POST.
    await resetGroupPositionsForNextScenario();
    const manualRacePage = await page.context().newPage();
    try {
      await manualRacePage.goto(`/canvas/${project.id}`);
      await expect(manualRacePage.getByTestId("canvas-world")).toHaveAttribute(
        "data-persistence-ready",
        "true",
      );
      const group = page.locator('[data-testid="rf__node-run-group-a"]');
      await group.evaluate((element) => element.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ));
      const manualNode = manualRacePage.locator(
        '[data-testid="rf__node-run-text-a"]',
      );
      await manualNode.evaluate((element) => element.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ));
      const manualGenerate = manualRacePage
        .getByTestId("text-creator")
        .getByRole("button", { name: "Generate" });
      await expect(manualGenerate).toBeEnabled();
      const postsBeforeRace = taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a"
      ).length;
      const downstreamBeforeRace = taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a-next"
      ).length;
      await Promise.all([
        group.getByTestId("group-execute-button")
          .evaluate((element) => (element as HTMLButtonElement).click()),
        manualGenerate.evaluate((element) => (element as HTMLButtonElement).click()),
      ]);
      await expect.poll(() => taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a"
      ).length).toBe(postsBeforeRace + 1);
      await expect.poll(async () => [
        await page.locator("body").innerText(),
        await manualRacePage.locator("body").innerText(),
      ].some((text) => text.includes("整组"))).toBe(true);
      const groupWon = await page.evaluate(() => {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          if (window.localStorage.key(index)?.startsWith(
            "unboundry-group-run-lease:v1:",
          )) return true;
        }
        return false;
      });
      setLatestTaskState("run-text-a", "success");
      if (groupWon) {
        await expect.poll(() => taskPostNodes.filter((nodeId) =>
          nodeId === "run-text-a-next"
        ).length).toBe(downstreamBeforeRace + 1);
        setLatestTaskState("run-text-a-next", "success");
      } else {
        await expect.poll(() => taskPostNodes.filter((nodeId) =>
          nodeId === "run-text-a-next"
        ).length).toBe(downstreamBeforeRace);
      }
      await expect.poll(() => page.evaluate(() => {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          if (window.localStorage.key(index)?.startsWith(
            "unboundry-group-run-lease:v1:",
          )) return false;
        }
        return true;
      })).toBe(true);
    } finally {
      await manualRacePage.close();
    }

    // A hard refresh converts the active run to an interrupted checkpoint,
    // releases its page owner, and resumes the exact accepted task without a
    // duplicate first-layer POST. Reload automatically reconciles only that
    // accepted task; the pending downstream stays manual.
    await resetGroupPositionsForNextScenario();
    const refreshPostsBefore = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a"
    ).length;
    const refreshDownstreamBefore = taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a-next"
    ).length;
    await startGroup(
      "run-group-a",
      "run-text-a",
      refreshPostsBefore + 1,
    );
    await expect.poll(() => page.evaluate(() => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith("unboundry-group-run-checkpoint:v1:")) continue;
        const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
          acceptedTasks?: Record<string, { taskId?: string }>;
          nodeStates?: Record<string, string>;
          status?: string;
        } | null;
        if (
          value?.status === "running" &&
          value.nodeStates?.["run-text-a"] === "running" &&
          value.acceptedTasks?.["run-text-a"]?.taskId
        ) return true;
      }
      return false;
    })).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent(
      "pagehide",
    )));
    await expect.poll(() => page.evaluate(() => {
      let interrupted = false;
      let leased = false;
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("unboundry-group-run-lease:v1:")) leased = true;
        if (!key?.startsWith("unboundry-group-run-checkpoint:v1:")) continue;
        const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
          status?: string;
        } | null;
        if (value?.status === "interrupted") interrupted = true;
      }
      return { interrupted, leased };
    })).toEqual({ interrupted: true, leased: false });

    const refreshTaskId = latestTaskByNode.get("run-text-a");
    if (!refreshTaskId) throw new Error("missing accepted refresh task");
    setLatestTaskState("run-text-a", "success");
    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-group-summary")).toHaveCount(0);
    await expect(page.getByTestId("tasks-group-checkpoint")).toBeVisible();
    await expect.poll(() => taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a"
    ).length).toBe(refreshPostsBefore + 1);
    await expect.poll(() => taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a-next"
    ).length).toBe(refreshDownstreamBefore);
    await expect.poll(async () => {
      const savedCanvas = await (await request.get(
        `/api/canvas/${project.id}`,
      )).json() as {
        nodes: Array<{ data: { content?: string }; id: string }>;
      };
      return savedCanvas.nodes.find((node) => node.id === "run-text-a")
        ?.data.content;
    }).toContain("已完成 run-text-a");
    await page.getByTestId("tasks-group-continue").click();
    await expect.poll(() => taskPostNodes.filter((nodeId) =>
      nodeId === "run-text-a-next"
    ).length).toBe(refreshDownstreamBefore + 1);
    setLatestTaskState("run-text-a-next", "success");
    await expect.poll(() => page.evaluate(() => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        if (window.localStorage.key(index)?.startsWith(
          "unboundry-group-run-lease:v1:",
        )) return false;
      }
      return true;
    })).toBe(true);

    // Leaving for a different real canvas uses the same page-exit checkpoint
    // path. Returning exposes one resumable run and keeps the accepted task
    // exact instead of minting another paid submission. Returning reconciles
    // the accepted task automatically but leaves downstream submission manual.
    const otherProjectResponse = await request.post("/api/projects", { data: {} });
    expect(otherProjectResponse.status()).toBe(201);
    const otherProject = await otherProjectResponse.json() as { id: string };
    try {
      await resetGroupPositionsForNextScenario();
      const switchPostsBefore = taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a"
      ).length;
      const switchDownstreamBefore = taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a-next"
      ).length;
      await startGroup(
        "run-group-a",
        "run-text-a",
        switchPostsBefore + 1,
      );
      await expect.poll(() => page.evaluate(() => {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index);
          if (!key?.startsWith("unboundry-group-run-checkpoint:v1:")) continue;
          const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
            acceptedTasks?: Record<string, { taskId?: string }>;
            nodeStates?: Record<string, string>;
            status?: string;
          } | null;
          if (
            value?.status === "running" &&
            value.nodeStates?.["run-text-a"] === "running" &&
            value.acceptedTasks?.["run-text-a"]?.taskId
          ) return true;
        }
        return false;
      })).toBe(true);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.goto(`/canvas/${otherProject.id}`);
      await expect(page.getByTestId("canvas-world")).toHaveAttribute(
        "data-persistence-ready",
        "true",
      );
      setLatestTaskState("run-text-a", "success");
      await page.goto(`/canvas/${project.id}`);
      await expect(page.getByTestId("canvas-world")).toHaveAttribute(
        "data-persistence-ready",
        "true",
      );
      await page.getByTestId("tasks").click();
      await expect(page.getByTestId("tasks-group-checkpoint")).toBeVisible();
      await expect.poll(() => taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a"
      ).length).toBe(switchPostsBefore + 1);
      await expect.poll(() => taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a-next"
      ).length).toBe(switchDownstreamBefore);
      await page.getByTestId("tasks-group-continue").click();
      await expect.poll(() => taskPostNodes.filter((nodeId) =>
        nodeId === "run-text-a-next"
      ).length).toBe(switchDownstreamBefore + 1);
      setLatestTaskState("run-text-a-next", "success");
      await expect.poll(() => page.evaluate(() => {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          if (window.localStorage.key(index)?.startsWith(
            "unboundry-group-run-lease:v1:",
          )) return false;
        }
        return true;
      })).toBe(true);
    } finally {
      await request.delete(`/api/canvas/${otherProject.id}`);
      await request.delete(`/api/projects/${otherProject.id}`);
    }

  } finally {
    await request.delete(`/api/canvas/${project.id}`);
    await request.delete(`/api/projects/${project.id}`);
  }
});

test("group run ignores a leftover canvas-save error and still blocks a real model incompatibility", async ({
  page,
  request,
}) => {
  const modelId = `fixture-no-image-reference-stale-${randomUUID()}`;
  const assetId = `fixture-group-reference-stale-${randomUUID()}`;
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = await created.json() as { id: string };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploaded = await request.post(`/api/assets/${assetId}`, {
    data: png,
    headers: { "Content-Type": "image/png", "X-File-Name": "reference.png" },
  });
  expect(uploaded.status()).toBe(201);
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
      taskPosts.push(entry.url());
    }
  });
  const parameterSchema = {
    ...defaultParameterSchema("image"),
    referenceInputs: { audio: 0, image: 0, video: 0 },
  };
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "不支持参考图测试模型",
          generationAvailable: true,
          id: modelId,
          imageParameters: {
            aspectRatios: ["auto"],
            maxReferenceImages: 0,
            qualities: ["auto"],
          },
          isDefault: true,
          parameterSchema,
        }, {
          capability: "text",
          displayName: "文字测试模型",
          generationAvailable: true,
          id: `fixture-text-${modelId}`,
          isDefault: true,
          parameterSchema: defaultParameterSchema("text"),
        }],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  try {
    const saveMetadata = await existingCanvasSaveMetadata(request, project.id);
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "reference-image" },
          id: "edge-reference-target",
          source: "reference-image",
          sourceHandle: "source",
          target: "target-image",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [{
          data: { label: "Group", title: "图片生成组" },
          id: "image-group",
          position: { x: 100, y: 100 },
          style: { height: 900, width: 900 },
          type: "group",
          zIndex: 0,
        }, {
          data: {
            content: "已有导演稿",
            label: "Text",
            textGenerationError: "画布还在保存，请稍等保存完成后再试",
            textGenerationErrorCode: "INVALID",
            textPrompt: "生成P1带货导演稿",
            textPromptReady: true,
            title: "生成P1带货导演稿",
          },
          id: "director-text",
          parentId: "image-group",
          position: { x: 30, y: 60 },
          style: { height: 200, width: 250 },
          type: "text",
          zIndex: 1,
        }, {
          data: {
            assetId,
            imageSrc: `/api/assets/${assetId}`,
            inputState: "ready",
            label: "Image",
            title: "商品参考图",
          },
          id: "reference-image",
          parentId: "image-group",
          position: { x: 30, y: 280 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        }, {
          data: {
            imageModelId: modelId,
            imageParameters: {},
            imagePrompt: "生成商品主图",
            imagePromptReady: true,
            label: "Image",
            title: "商品主图",
          },
          id: "target-image",
          parentId: "image-group",
          position: { x: 370, y: 280 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        }],
        ...saveMetadata,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/canvas/${project.id}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await page.locator('[data-testid="rf__node-image-group"]').click({
      position: { x: 5, y: 5 },
    });
    const execute = page.getByTestId("group-execute-button");
    await expect(execute).toBeEnabled();
    await execute.click();
    const expectedMessage = "当前模型不支持image类型上游，引用已保留";
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      `整组执行已阻止：发现 1 个不兼容节点；首个“商品主图”：${expectedMessage}（未提交任何生成任务）`,
    );
    await expect(page.getByTestId("workflow-run-toast")).not.toContainText(
      "画布还在保存",
    );
    await expect.poll(async () => {
      const canvas = await (await request.get(`/api/canvas/${project.id}`)).json() as {
        nodes: Array<{
          data: {
            imageGenerationError?: string;
            textGenerationError?: string;
            textGenerationErrorCode?: string;
          };
          id: string;
        }>;
      };
      const director = canvas.nodes.find((node) => node.id === "director-text")?.data;
      const target = canvas.nodes.find((node) => node.id === "target-image")?.data;
      return {
        directorError: director?.textGenerationError ?? "",
        targetError: target?.imageGenerationError ?? "",
      };
    }).toEqual({
      directorError: "",
      targetError: expectedMessage,
    });

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(taskPosts).toEqual([]);
  } finally {
    await request.delete(`/api/canvas/${project.id}`);
    await request.delete(`/api/projects/${project.id}`);
    await request.delete(`/api/assets/${assetId}`);
  }
});

test("workflow recovery retries a fake submit and only reconciles a true unknown outcome", () => {
  expect(workflowRecoveryPlan({
    errorCode: "NETWORK",
    retryAllowed: true,
    state: "failed",
  })).toBe("retry");
  expect(workflowRecoveryPlan({
    errorCode: "REMOTE",
    retryAllowed: true,
    state: "failed",
  })).toBe("retry");
  expect(workflowRecoveryPlan({
    errorCode: "TIMEOUT",
    retryAllowed: false,
    retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
    state: "failed",
  })).toBe("reconcile");
  expect(workflowRecoveryPlan({
    errorCode: "PROVIDER_REQUEST_FAILED",
    retryAllowed: false,
    retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
    state: "failed",
  })).toBe("reconcile");
  expect(workflowRecoveryPlan({
    errorCode: "CANVAS_NOT_SAVED",
    retryAllowed: false,
    state: "failed",
  })).toBe("stop");
  expect(workflowRecoveryPlan({
    state: "success",
  })).toBe("success");
  expect(generationNeedsReconcile("PROVIDER_REQUEST_FAILED")).toBe(true);
  expect(generationNeedsReconcile("TIMEOUT")).toBe(true);
  expect(generationNeedsReconcile("RESULT_DELAYED")).toBe(true);
  expect(generationNeedsReconcile("NETWORK", "RETRY_OUTCOME_UNKNOWN")).toBe(true);
  expect(generationNeedsReconcile("INPUT_INVALID")).toBe(false);
});
