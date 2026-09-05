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
import {
  generationFailureMessage,
  generationFailureIsDefinitive,
  generationNeedsReconcile,
} from "../client/src/generation/generationRetry";
import { workflowRecoveryPlan } from "../client/src/generation/workflowGenerationRecovery";
import {
  createSaveGateRun,
  runExclusiveCanvasSubmit,
  runExclusiveServerWorkflowSubmit,
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
  groupRunAuthorityRecoverySupported,
  groupRunSnapshotFingerprint,
  groupRunSuccessProof,
  getGroupRunExecutionOwnerId,
  hasConflictingActiveGroupRunLeaseForCanvas,
  hasForeignActiveGroupRunLeaseForCanvas,
  isGroupRunAuthoritySettledEmpty,
  markGroupRunStarting,
  quarantineCorruptGroupRunCacheAfterAuthority,
  readGroupCheckpoints,
  readGroupRunCheckpoint,
  readGroupRunCheckpointCache,
  readGroupRunCheckpoints,
  readGroupRunLease,
  readGroupRunLeaseCache,
  readGroupRunStarting,
  releaseGroupRunLease,
  renewGroupRunLease,
  setGroupRunAuthoritySettledEmpty,
  taskMatchesAcceptedBinding,
  writeGroupRunCheckpoint,
  verifiedCheckpointSuccessIds,
  type GroupRunCheckpoint,
} from "../client/src/generation/groupRunCheckpoint";
import {
  reconstructGroupRecoveryCheckpoints,
  reconstructGroupRecoveryDecision,
} from
  "../client/src/generation/groupRunRecovery";
import { publishGroupRunNotificationOnce } from
  "../client/src/generation/groupRunNotification";
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
import {
  defaultParameterSchema,
  knownModelParameterSchema,
  type ModelParameterValue,
} from "../types/modelParameters";
import { normalizeModelInputs } from "../types/modelInputSemanticCompiler";
import { resolveNodeInputs } from "../types/nodeInputs";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";
import {
  ensureGenerationTask,
  GenerationRequestError,
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
  legacyTerminalDetachApplicationId,
  legacyTerminalGenerationCandidate,
  legacyTerminalGenerationCandidateStillMatches,
  parseLegacyTerminalGenerationPolicy,
} from "../client/src/generation/legacyTerminalGenerationReconciler";
import {
  legacyTerminalDetachApplicationIdForBinding,
} from "../server/canvasLegacyGenerationReconciliation";
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
      fixtureScopeId: "",
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
    fixtureScopeId: "",
    node,
  });
  expect(candidate).toBeTruthy();
  if (!candidate) throw new Error("candidate missing");
  expect(legacyTerminalDetachApplicationId(candidate, "failed")).toBe(
    legacyTerminalDetachApplicationIdForBinding({
      ...candidate,
      observedTerminalState: "failed",
    }),
  );
  expect(legacyTerminalDetachApplicationId({
    ...candidate,
    fixtureScopeId: "fixture-that-is-not-part-of-the-server-binding",
  }, "failed")).toBe(legacyTerminalDetachApplicationIdForBinding({
    ...candidate,
    observedTerminalState: "failed",
  }));
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
    task: { ...completeSuccess, generationIdentityVersion: 2 },
  }).state).toBe("UNKNOWN_BLOCKED");
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
      [`${kind}Parameters`]: kind === "audio"
        ? { emotion: "auto", emotionScale: 5 }
        : {},
      [`${kind}Prompt`]: `${kind} headless prompt`,
      ...(kind === "text" ? {} : { [`${kind}PromptReady`]: true }),
    },
    id: `headless-${kind}`,
    position: { x: index * 100, y: 0 },
    type: kind,
  })) as ProbeNodeType[];
  const models = Object.fromEntries(kinds.map((kind) => [kind, [{
    capability: kind,
    configurationRevision: `headless-${kind}-revision-1`,
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
    parameterSchema: kind === "audio"
      ? knownModelParameterSchema({
          capability: "audio",
          providerDriver: "multi-protocol-relay",
          providerModelId: "doubao-tts-2.0",
        })
      : defaultParameterSchema(kind),
    releaseRevisionId: `00000000-0000-4000-8000-00000000000${
      kinds.indexOf(kind) + 1
    }`,
  }]])) as NodeExecutorContext["modelCatalog"]["models"];
  const tasks = new Map<string, Record<string, unknown>>();
  const postedIdentities: Array<Record<string, unknown>> = [];
  const boundNodes = new Map<string, ProbeNodeType>();
  const posts: string[] = [];
  const postedParameters = new Map<string, Record<string, unknown>>();
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
    if (url.startsWith("/api/generation-tasks?canvasId=") && method === "GET") {
      return response({ tasks: [...tasks.values()] });
    }
    if (url === "/api/generation-tasks/preflight" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { canvasRevision: number };
      return response({
        canEnqueue: true,
        canSubmit: true,
        canvasRevision: body.canvasRevision,
        problems: [],
      });
    }
    if (url === "/api/generation-tasks" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        fixtureScopeId: string;
        generationIdentityVersion: 2;
        generationInputKey: string;
        generationOwnershipKey: string;
        kind: (typeof kinds)[number];
        model: string;
        modelConfigurationRevision: string;
        modelInputContractFingerprint: string;
        modelReleaseRevision: string;
        nodeId: string;
        parameters: Record<string, unknown>;
        prompt: string;
        workflowBinding: {
          generationInputKey: string;
          generationOwnershipKey: string;
          groupId: string;
          modelConfigurationRevision: string;
          modelReleaseRevision: string;
          runId: string;
        };
      };
      postedIdentities.push({
        fixtureScopeId: body.fixtureScopeId,
        generationIdentityVersion: body.generationIdentityVersion,
        generationInputKey: body.generationInputKey,
        generationOwnershipKey: body.generationOwnershipKey,
        modelConfigurationRevision: body.modelConfigurationRevision,
        modelInputContractFingerprint: body.modelInputContractFingerprint,
        modelReleaseRevision: body.modelReleaseRevision,
        workflowBinding: body.workflowBinding,
      });
      posts.push(body.nodeId);
      postedParameters.set(body.nodeId, body.parameters);
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
        fixtureScopeId: body.fixtureScopeId,
        generationIdentityVersion: body.generationIdentityVersion,
        generationInputKey: body.generationInputKey,
        generationOwnershipKey: body.generationOwnershipKey,
        modelConfigurationRevision: body.modelConfigurationRevision,
        modelInputContractFingerprint: body.modelInputContractFingerprint,
        modelReleaseRevision: body.modelReleaseRevision,
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
        workflowExecutionRunId: body.workflowBinding.runId,
        workflowGroupId: body.workflowBinding.groupId,
      };
      tasks.set(taskId, task);
      return response({ ...task, state: "running" }, 202);
    }
    const taskUrl = new URL(url, "http://127.0.0.1");
    const taskId = taskUrl.pathname.startsWith("/api/generation-tasks/")
      ? taskUrl.pathname.split("/").at(-1)
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
    groupId: "headless-group",
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
      inputFingerprint?: string;
      kind: (typeof kinds)[number];
      modelConfigurationRevision?: string;
      modelInputContractFingerprint: string;
      modelReleaseRevision?: string;
      nodeId: string;
      ownershipKey: string;
      taskId: string;
    };
    onTaskAccepted: (binding: {
      kind: (typeof kinds)[number];
      modelInputContractFingerprint: string;
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
      const runResult = await executor!.run(nodeId, context, executableIds);
      expect(runResult.status, JSON.stringify({ postedIdentities, runResult }))
        .toBe("success");
      expect(boundNodes.has(kind)).toBe(true);
    }
    expect(posts.sort()).toEqual(kinds.map((kind) => `headless-${kind}`).sort());
    expect(postedParameters.get("headless-audio")).toMatchObject({
      emotion: "auto",
    });
    expect(postedParameters.get("headless-audio")).not.toHaveProperty(
      "emotionScale",
    );
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
        inputFingerprint: String(
          boundNodes.get(kind)!.data[`${kind}GenerationInputKey`],
        ),
        kind,
        modelConfigurationRevision: String(
          tasks.get(`headless-task-${kind}`)?.modelConfigurationRevision,
        ),
        modelInputContractFingerprint: String(
          tasks.get(`headless-task-${kind}`)?.modelInputContractFingerprint,
        ),
        modelReleaseRevision: String(
          tasks.get(`headless-task-${kind}`)?.modelReleaseRevision,
        ),
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
    const textContentBeforeContractConflict = nodes.find(
      (node) => node.id === "headless-text",
    )?.data.content;
    const textTask = tasks.get("headless-task-text")!;
    const textContractFingerprint = String(
      textTask.modelInputContractFingerprint,
    );
    textTask.state = "failed";
    textTask.errorMessage = "old contract failed";
    textTask.modelInputContractFingerprint = "different-contract";
    context.acceptedTask = {
      inputFingerprint: String(
        boundNodes.get("text")!.data.textGenerationInputKey,
      ),
      kind: "text",
      modelConfigurationRevision: String(textTask.modelConfigurationRevision),
      modelInputContractFingerprint: textContractFingerprint,
      modelReleaseRevision: String(textTask.modelReleaseRevision),
      nodeId: "headless-text",
      ownershipKey: String(
        boundNodes.get("text")!.data.textGenerationOwnershipKey,
      ),
      taskId: "headless-task-text",
    };
    await expect(createNodeExecutorRegistry().get(
      nodes.find((node) => node.id === "headless-text"),
    )!.recover("headless-text", context)).resolves.toMatchObject({
      status: "failed",
    });
    expect(nodes.find((node) => node.id === "headless-text")?.data.content)
      .toBe(textContentBeforeContractConflict);
    textTask.state = "success";
    textTask.errorMessage = undefined;
    textTask.modelInputContractFingerprint = textContractFingerprint;
    context.acceptedTask = {
      kind: "text",
      modelConfigurationRevision: String(
        tasks.get("headless-task-text")?.modelConfigurationRevision,
      ),
      modelInputContractFingerprint: String(
        tasks.get("headless-task-text")?.modelInputContractFingerprint,
      ),
      modelReleaseRevision: String(
        tasks.get("headless-task-text")?.modelReleaseRevision,
      ),
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
      modelConfigurationRevision: String(
        tasks.get("headless-task-text")?.modelConfigurationRevision,
      ),
      modelInputContractFingerprint: String(
        tasks.get("headless-task-text")?.modelInputContractFingerprint,
      ),
      modelReleaseRevision: String(
        tasks.get("headless-task-text")?.modelReleaseRevision,
      ),
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
    // Each initial execution flushes pending user intent before server-atomic
    // admission; recovery adopts the server projection without a browser write.
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
  expect(workflowSubmissionPreflightProblem({
    executableIds,
    inputs: resolved.inputs,
    problems: [{ code: "REQUIRED_MISSING", message: "等待本轮必需上游输入" }],
  })).toBeUndefined();
  expect(workflowRuntimePreflightDisposition({
    executableIds,
    inputs: resolved.inputs,
    problems: [{ code: "REQUIRED_MISSING", message: "等待本轮必需上游输入" }],
  })).toMatchObject({ status: "waiting" });
  expect(workflowSubmissionPreflightProblem({
    executableIds,
    inputs: resolved.inputs,
    problems: [{ code: "ROLE_CONFLICT", message: "角色冲突" }],
  })).toMatchObject({ code: "ROLE_CONFLICT" });
});

test("workflow preflight waits for the exact dynamic first-frame role only", () => {
  const resolved = resolveNodeInputs({
    edges: [{
      data: { inputOrder: 1, inputRole: "first-frame" },
      id: "image-video",
      source: "image",
      target: "video",
    }],
    modelSchema: knownModelParameterSchema({
      capability: "video",
      providerDriver: "multi-protocol-relay",
      providerModelId: "grok-video-3",
    }),
    nodes: [{
      data: {
        imagePrompt: "先生成首帧",
        imagePromptReady: true,
        label: "首帧",
      },
      id: "image",
      type: "image",
    }, {
      data: { label: "视频" },
      id: "video",
      type: "video",
    }],
    ownPrompt: "让首帧动起来",
    parameters: { inputMode: "image" },
    targetId: "video",
    targetKind: "video",
  });
  const roleProblem = resolved.problems.find(({ code }) => code === "ROLE_CONFLICT");
  expect(roleProblem).toMatchObject({
    code: "ROLE_CONFLICT",
    kind: "image",
    minimumCount: 1,
    role: "first-frame",
  });
  expect(workflowSubmissionPreflightProblem({
    executableIds: new Set(["image", "video"]),
    inputs: resolved.inputs,
    problems: resolved.problems,
  })).toBeUndefined();
  expect(workflowRuntimePreflightDisposition({
    executableIds: new Set(["image", "video"]),
    inputs: resolved.inputs,
    problems: resolved.problems,
  })).toMatchObject({ status: "waiting" });
  expect(workflowSubmissionPreflightProblem({
    executableIds: new Set(["other-image", "video"]),
    inputs: resolved.inputs,
    problems: resolved.problems,
  })).toMatchObject({ code: "EMPTY" });
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
      data: { inputOrder: 1, inputRole: "reference-image" as const },
      id: "reference-image",
      source: "reference",
      target: "image",
    }],
    executableNodeIds: new Set(["image"]),
    groupId: "group",
    modelConfigurationRevisions: { "image:model-a": "revision-a" },
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
  expect(groupRunSnapshotFingerprint({
    ...input,
    edges: input.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data, inputRole: "subject" as const },
    })),
    nodes: base,
  })).not.toBe(original);
  expect(groupRunSnapshotFingerprint({
    ...input,
    edges: input.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data, inputOrder: 2 },
    })),
    nodes: base,
  })).not.toBe(original);
  expect(groupRunSnapshotFingerprint({
    ...input,
    modelConfigurationRevisions: { "image:model-a": "revision-b" },
    nodes: base,
  })).not.toBe(original);

  const videoNodes: ProbeNodeType[] = [{
    id: "video-group",
    type: "group",
    data: { label: "视频组", variant: "group" },
    position: { x: 0, y: 0 },
  }, {
    id: "video",
    parentId: "video-group",
    type: "video",
    data: {
      label: "视频",
      videoInputContractFingerprint: "contract-a",
      videoModelId: "video-model",
      videoParameters: { inputMode: "text" },
      videoPrompt: "一段视频",
      videoPromptReady: true,
    },
    position: { x: 0, y: 0 },
  }];
  const videoFingerprint = groupRunSnapshotFingerprint({
    edges: [],
    executableNodeIds: new Set(["video"]),
    groupId: "video-group",
    nodes: videoNodes,
  });
  expect(groupRunSnapshotFingerprint({
    edges: [],
    executableNodeIds: new Set(["video"]),
    groupId: "video-group",
    nodes: videoNodes.map((node) => node.id === "video"
      ? {
          ...node,
          data: { ...node.data, videoInputContractFingerprint: "contract-b" },
        }
      : node),
  })).not.toBe(videoFingerprint);
});

test("group run success proof is exact and resume fails closed on mismatch", () => {
  const node: ProbeNodeType = {
    id: "text",
    parentId: "group",
    type: "text",
    data: {
      content: "已生成文案",
      groupRunSuccessInputFingerprint: "input-a",
      groupRunSuccessModelConfigurationRevision: "configuration-a",
      groupRunSuccessModelReleaseRevision: "revision-a",
      groupRunSuccessOwnershipKey: "owner-a",
      groupRunSuccessTaskId: "task-a",
      label: "文案",
      textModelId: "model-a",
    },
    position: { x: 0, y: 0 },
  };
  expect(groupRunSuccessProof(node)).toMatchObject({
    ownershipKey: "owner-a",
    taskId: "task-a",
    inputFingerprint: "input-a",
    modelConfigurationRevision: "configuration-a",
    modelReleaseRevision: "revision-a",
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
        inputFingerprint: "input-a",
        modelConfigurationRevision: "configuration-a",
        modelReleaseRevision: "revision-a",
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
  expect(verifiedCheckpointSuccessIds(
    checkpoint,
    [node],
    { "text:model-a": "configuration-b" },
  )).toMatchObject({ mismatchNodeId: "text" });
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
  const changedInput = {
    ...node,
    data: { ...node.data, groupRunSuccessInputFingerprint: "input-b" },
  };
  expect(verifiedCheckpointSuccessIds(checkpoint, [changedInput]))
    .toMatchObject({ mismatchNodeId: "text" });
  const changedRevision = {
    ...node,
    data: { ...node.data, groupRunSuccessModelReleaseRevision: "revision-b" },
  };
  expect(verifiedCheckpointSuccessIds(checkpoint, [changedRevision]))
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
  const heldLockNames = new Set<string>();
  let confirmResult = false;
  Object.defineProperties(fakeWindow, {
    confirm: { value: () => confirmResult },
    localStorage: { value: storage },
    navigator: {
      configurable: true,
      value: {
        locks: {
          request: async (
            name: string,
            _options: { ifAvailable: boolean },
            callback: (lock: unknown) => Promise<boolean> | boolean,
          ) => {
            heldLockNames.add(name);
            try {
              return await callback({});
            } finally {
              heldLockNames.delete(name);
            }
          },
        },
      },
    },
  });
  host.window = fakeWindow;
  const scope = { accountId: "account", canvasId: "canvas", fixtureScopeId: "" };
  const leaseReleaseEventHeldStates: boolean[] = [];
  fakeWindow.addEventListener("unboundry:group-run-lease", () => {
    leaseReleaseEventHeldStates.push([...heldLockNames].some((name) =>
      name.startsWith("unboundry-group-run:") && name.endsWith(":run-a")
    ));
  });
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
    expect(await hasForeignActiveGroupRunLeaseForCanvas(scope, "node-a"))
      .toBe(true);
    expect(await hasForeignActiveGroupRunLeaseForCanvas(scope, "node-c"))
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
      scope,
      "node-c",
    )).toBe(true);
    expect(await hasConflictingActiveGroupRunLeaseForCanvas(
      scope,
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
          inputFingerprint: `input-${runId}`,
          kind: "text" as const,
          modelConfigurationRevision: `configuration-${runId}`,
          modelInputContractFingerprint: `contract-${runId}`,
          modelReleaseRevision: `release-${runId}`,
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
      generationIdentityVersion: 2,
      generationInputKey: "input-run-a",
      generationOwnershipKey: "owner-run-a",
      id: "task-run-a",
      kind: "text",
      modelConfigurationRevision: "configuration-run-a",
      modelInputContractFingerprint: "contract-run-a",
      modelReleaseRevision: "release-run-a",
      nodeId: "node-a",
    })).toBe(true);
    expect(taskMatchesAcceptedBinding(acceptedRunA, {
      generationIdentityVersion: 2,
      generationInputKey: "input-run-a",
      generationOwnershipKey: "owner-run-a",
      id: "task-other",
      kind: "text",
      modelConfigurationRevision: "configuration-run-a",
      modelInputContractFingerprint: "contract-run-a",
      modelReleaseRevision: "release-run-a",
      nodeId: "node-a",
    })).toBe(false);
    expect(readGroupRunCheckpoint(scope, "run-c")?.groupId).toBe("group-c");
    expect(readGroupCheckpoints(scope, "group-a").map((item) => item.runId))
      .toEqual(["run-a"]);
    expect(readGroupCheckpoints(scope, "group-c").map((item) => item.runId))
      .toEqual(["run-c"]);
    expect(readGroupRunCheckpoint(scope, "run-a")?.version).toBe(2);
    // A scope containing sibling groups is ambiguous and must never pick the
    // newest unrelated checkpoint as execution authority.
    expect(readGroupRunCheckpoint(scope)).toBeUndefined();
    expect(clearGroupRunCheckpoint(
      scope,
      { ownerId: "owner-a", runId: "run-a" },
    )).toBe(true);
    expect(readGroupRunCheckpoint(scope, "run-a")).toBeUndefined();
    expect(readGroupRunCheckpoint(scope, "run-c")?.groupId).toBe("group-c");
    expect(releaseGroupRunLease(scope, "run-a", "owner-a")).toBe(true);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(leaseReleaseEventHeldStates.at(-1)).toBe(false);
    expect(await hasForeignActiveGroupRunLeaseForCanvas(scope, "node-a"))
      .toBe(false);
    expect(await hasForeignActiveGroupRunLeaseForCanvas(scope, "node-c"))
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
      accountId: scope.accountId,
      canvasId: scope.canvasId,
      fixtureScopeId: scope.fixtureScopeId,
      generationInputKey: "input-owner",
      generationOwnershipKey: "ownership-owner",
      kind: "text" as const,
      modelInputContractFingerprint: "mic2:owner",
      modelConfigurationRevision: "config-revision-owner",
      modelReleaseRevision: "00000000-0000-4000-8000-000000000022",
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
    expect(await hasForeignActiveGroupRunLeaseForCanvas(scope)).toBe(false);
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
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);

    const reconstructed = reconstructGroupRecoveryCheckpoints({
      nodes: [
        { data: {}, id: "recovery-group", type: "group" },
        {
          data: {
            textGenerating: true,
            textGenerationContractFingerprint: "contract-recovery",
            textGenerationInputKey: "input-recovery",
            textGenerationOwnershipKey: "owner-recovery",
            textGenerationTaskId: "task-recovery",
            workflowExecutionRunId: "run-recovery",
          },
          id: "recovery-text",
          parentId: "recovery-group",
          type: "text",
        },
      ] as ProbeNodeType[],
      scope,
      tasks: [{
        attempt: 1,
        canvasId: scope.canvasId,
        costCurrency: "CNY",
        createdAt: new Date(now).toISOString(),
        fixtureScopeId: scope.fixtureScopeId,
        generationIdentityVersion: 2,
        generationInputKey: "input-recovery",
        generationOwnershipKey: "owner-recovery",
        modelInputContractFingerprint: "contract-recovery",
        modelConfigurationRevision: "configuration-recovery",
        id: "task-recovery",
        kind: "text",
        nodeId: "recovery-text",
        prompt: "redacted",
        state: "running",
        updatedAt: new Date(now).toISOString(),
        modelReleaseRevision: "revision-recovery",
        workflowExecutionRunId: "run-recovery",
        workflowGroupId: "recovery-group",
      }],
    });
    expect(reconstructed).toMatchObject([{
      acceptedTasks: {
        "recovery-text": { taskId: "task-recovery" },
      },
      groupId: "recovery-group",
      runId: "run-recovery",
      version: 2,
    }]);

    const orphanDecision = reconstructGroupRecoveryDecision({
      nodes: [
        { data: {}, id: "orphan-group", type: "group" },
        {
          data: {
            textGenerationContractFingerprint: "contract-orphan",
          },
          id: "orphan-text",
          parentId: "orphan-group",
          type: "text",
        },
      ] as ProbeNodeType[],
      scope,
      tasks: [{
        attempt: 1,
        canvasId: scope.canvasId,
        costCurrency: "CNY",
        createdAt: new Date(now).toISOString(),
        fixtureScopeId: scope.fixtureScopeId,
        generationIdentityVersion: 2,
        generationInputKey: "input-orphan",
        generationOwnershipKey: "owner-orphan",
        modelInputContractFingerprint: "contract-orphan",
        modelConfigurationRevision: "configuration-orphan",
        id: "task-orphan",
        kind: "text",
        nodeId: "orphan-text",
        prompt: "redacted",
        state: "running",
        updatedAt: new Date(now).toISOString(),
        modelReleaseRevision: "revision-orphan",
        workflowExecutionRunId: "run-orphan",
        workflowGroupId: "orphan-group",
      }],
    });
    expect(orphanDecision).toMatchObject({
      blockedGroupIds: [],
      checkpoints: [{
        acceptedTasks: {
          "orphan-text": {
            inputFingerprint: "input-orphan",
            ownershipKey: "owner-orphan",
            taskId: "task-orphan",
          },
        },
        groupId: "orphan-group",
        runId: "run-orphan",
      }],
    });
    const projectedStandaloneAndRecoverableGroup =
      reconstructGroupRecoveryDecision({
        nodes: [
          { data: {}, id: "standalone-group", type: "group" },
          {
            data: { content: "already projected" },
            id: "standalone-text",
            parentId: "standalone-group",
            type: "text",
          },
          { data: {}, id: "recoverable-group", type: "group" },
          {
            data: {
              textGenerationContractFingerprint: "contract-recoverable",
            },
            id: "recoverable-text",
            parentId: "recoverable-group",
            type: "text",
          },
        ] as ProbeNodeType[],
        scope,
        tasks: [
          {
            attempt: 1,
            canvasId: scope.canvasId,
            costCurrency: "CNY",
            createdAt: new Date(now).toISOString(),
            id: "task-standalone",
            kind: "text",
            nodeId: "standalone-text",
            prompt: "redacted",
            resultText: "already projected",
            state: "success",
            updatedAt: new Date(now).toISOString(),
          },
          {
            attempt: 1,
            canvasId: scope.canvasId,
            costCurrency: "CNY",
            createdAt: new Date(now).toISOString(),
            fixtureScopeId: scope.fixtureScopeId,
            generationIdentityVersion: 2,
            generationInputKey: "input-recoverable",
            generationOwnershipKey: "owner-recoverable",
            id: "task-recoverable",
            kind: "text",
            modelConfigurationRevision: "configuration-recoverable",
            modelInputContractFingerprint: "contract-recoverable",
            modelReleaseRevision: "revision-recoverable",
            nodeId: "recoverable-text",
            prompt: "redacted",
            state: "running",
            updatedAt: new Date(now).toISOString(),
            workflowExecutionRunId: "run-recoverable",
            workflowGroupId: "recoverable-group",
          },
        ],
      });
    expect(projectedStandaloneAndRecoverableGroup.blockedGroupIds).toEqual([]);
    expect(projectedStandaloneAndRecoverableGroup.checkpoints).toMatchObject([{
      groupId: "recoverable-group",
      runId: "run-recoverable",
    }]);
    const blockedOrphan = reconstructGroupRecoveryDecision({
      nodes: [
        { data: {}, id: "blocked-group", type: "group" },
        {
          data: {},
          id: "blocked-text",
          parentId: "blocked-group",
          type: "text",
        },
      ] as ProbeNodeType[],
      scope,
      tasks: [{
        attempt: 1,
        canvasId: scope.canvasId,
        costCurrency: "CNY",
        createdAt: new Date(now).toISOString(),
        id: "task-blocked",
        kind: "text",
        nodeId: "blocked-text",
        prompt: "redacted",
        state: "success",
        updatedAt: new Date(now).toISOString(),
        workflowExecutionRunId: "run-blocked",
      }],
    });
    expect(blockedOrphan.blockedGroupIds).toEqual(["blocked-group"]);
    expect(blockedOrphan.checkpoints).toEqual([]);

    const foreignFixtureLegacy = reconstructGroupRecoveryDecision({
      nodes: [
        { data: {}, id: "fixture-group", type: "group" },
        {
          data: {
            textGenerating: true,
            textGenerationContractFingerprint: "contract-fixture",
            textGenerationInputKey: "input-fixture",
            textGenerationModelConfigurationRevision: "configuration-fixture",
            textGenerationModelReleaseRevision: "revision-fixture",
            textGenerationOwnershipKey: "owner-fixture",
            textGenerationTaskId: "task-fixture",
            workflowExecutionRunId: "run-fixture",
          },
          id: "fixture-text",
          parentId: "fixture-group",
          type: "text",
        },
      ] as ProbeNodeType[],
      scope,
      tasks: [{
        attempt: 1,
        canvasId: scope.canvasId,
        costCurrency: "CNY",
        createdAt: new Date(now).toISOString(),
        fixtureScopeId: "different-fixture",
        generationIdentityVersion: 2,
        generationInputKey: "input-fixture",
        generationOwnershipKey: "owner-fixture",
        id: "task-fixture",
        kind: "text",
        modelConfigurationRevision: "configuration-fixture",
        modelInputContractFingerprint: "contract-fixture",
        modelReleaseRevision: "revision-fixture",
        nodeId: "fixture-text",
        prompt: "redacted",
        state: "running",
        updatedAt: new Date(now).toISOString(),
      }],
    });
    expect(foreignFixtureLegacy.checkpoints).toEqual([]);

    values.clear();
    const aggregateKey = `unboundry-group-run-checkpoint:v1:${JSON.stringify([
      scope.accountId,
      scope.canvasId,
      scope.fixtureScopeId,
    ])}`;
    values.set(aggregateKey, JSON.stringify({
      "run-good": checkpoint("run-good", "group-good"),
      "run-malformed": { acceptedTasks: { "node-bad": { taskId: 42 } } },
    }));
    const mixedCache = readGroupRunCheckpointCache(scope);
    expect(mixedCache.corrupted).toBe(true);
    expect(mixedCache.checkpoints.map((item) => item.runId)).toEqual(["run-good"]);

    values.clear();
    const conflictRunId = "run-exact-legacy-conflict";
    const legacyConflict = {
      ...checkpoint(conflictRunId, "group-conflict"),
      snapshotFingerprint: "snapshot-before",
      updatedAt: now,
    };
    const exactConflict = {
      ...legacyConflict,
      snapshotFingerprint: "snapshot-current",
      updatedAt: now + 1,
    };
    values.set(aggregateKey, JSON.stringify({
      [conflictRunId]: legacyConflict,
    }));
    values.set(
      `unboundry-group-run-checkpoint:v1:${JSON.stringify([
        scope.accountId,
        scope.canvasId,
        scope.fixtureScopeId,
        conflictRunId,
      ])}`,
      JSON.stringify(exactConflict),
    );
    const conflictingCache = readGroupRunCheckpointCache(scope);
    expect(conflictingCache.corrupted).toBe(true);
    expect(conflictingCache.checkpoints).toMatchObject([{
      runId: conflictRunId,
      snapshotFingerprint: "snapshot-current",
    }]);

    values.clear();
    const otherAccountScope = { ...scope, accountId: "account-other" };
    const otherFixtureScope = { ...scope, fixtureScopeId: "fixture-other" };
    expect(await acquireGroupRunLease(
      scope,
      "run-exact-scope",
      "owner-scope-a",
      now + 5,
      ["node-exact-scope"],
    )).toBe(true);
    expect(await acquireGroupRunLease(
      otherAccountScope,
      "run-exact-scope",
      "owner-scope-b",
      now + 5,
      ["node-exact-scope"],
    )).toBe(true);
    expect(await acquireGroupRunLease(
      otherFixtureScope,
      "run-exact-scope",
      "owner-scope-c",
      now + 5,
      ["node-exact-scope"],
    )).toBe(true);
    expect(releaseGroupRunLease(scope, "run-exact-scope", "owner-scope-a"))
      .toBe(true);
    expect(releaseGroupRunLease(
      otherAccountScope,
      "run-exact-scope",
      "owner-scope-b",
    )).toBe(true);
    expect(releaseGroupRunLease(
      otherFixtureScope,
      "run-exact-scope",
      "owner-scope-c",
    )).toBe(true);
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
  const taskPanel = readFileSync(
    "client/src/canvas/GenerationTasksPanel.tsx",
    "utf8",
  );
  const shell = readFileSync("client/src/canvas/CanvasShell.tsx", "utf8");
  const taskClient = readFileSync(
    "client/src/generation/generationTasks.ts",
    "utf8",
  );
  const taskServer = readFileSync("server/generationTasks.ts", "utf8");
  const taskApi = readFileSync("server/generationTasksApi.ts", "utf8");
  const checkpointSource = readFileSync(
    "client/src/generation/groupRunCheckpoint.ts",
    "utf8",
  );
  expect(provider).not.toContain("registerWorkflowNode");
  expect(provider).not.toContain("waitForRegistrations");
  expect(provider).toContain("preparation.stopRequested = true");
  expect(provider).toContain("!preparation.stopRequested\n          ) return");
  expect(provider).toContain("if (!preparation.submitted) {");
  expect(provider).toContain("A failed stop\n              // confirmation is not permission");
  expect(provider).toContain("const reattached = await reattachSubmittedServerWorkflowRun({");
  expect(provider).toContain("if (!workflowRunStatusReadIsRetryable(error)) {");
  expect(provider).toContain("preparation.reconciliationBlocked = true");
  expect(provider).toContain("!preparation.reconciliationBlocked &&");
  expect(provider).toContain("activeServerWorkflowNodeIds(run)");
  expect(canvas).toContain("withServerWorkflowGenerationActivity(node)");
  for (const flag of [
    "audioGenerating",
    "imageGenerating",
    "textGenerating",
    "videoGenerating",
  ]) expect(canvas).toContain(`${flag}: true`);
  expect(provider).toContain(
    "Server terminal state is authoritative even when the local Canvas",
  );
  expect(taskPanel).toContain("parseServerWorkflowRunUpdatedEventDetail");
  expect(taskPanel).toContain("mergeServerWorkflowRuns(current, runs)");
  expect(shell).toContain("setSaveConflictMessage(\"\")");
  expect(canvas).toContain(
    "if (controller.signal.aborted || signal?.aborted) return false",
  );
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
  expect(provider).toContain("readGroupRunCheckpointCache(scope)");
  expect(provider).toContain("readGroupRunLeaseCache(scope)");
  expect(provider).toContain("reconstructGroupRecoveryDecision({");
  expect(provider.match(
    /await quarantineCorruptGroupRunCacheAfterAuthority\(/g,
  )?.length).toBe(3);
  expect(provider).toContain("readRecoveryAuthority,");
  expect(provider).toContain(
    "recoveryAuthorityTaskIds = new Set(tasks.map((task) => task.id))",
  );
  expect(provider).toContain(
    "!recoveryAuthorityTaskIds?.has(task.id)",
  );
  expect(provider).toContain(
    'window.addEventListener("storage", wakeRecovery)',
  );
  expect(provider).toContain(
    "window.addEventListener(GROUP_RUN_LEASE_EVENT, wakeRecovery)",
  );
  expect(provider).toContain("authorityConfirmedStableEmpty = true");
  expect(provider).toContain("setGroupRunAuthoritySettledEmpty(scope, true)");
  expect(provider).toContain("if (awaitingAuthorityWake) scheduleAuthorityRetry()");
  expect(provider).toContain("const durableWorkAppeared = cache.checkpoints.some");
  expect(provider).toContain(
    "(cache.quarantined || leaseCache.quarantined)",
  );
  expect(provider).toContain("reconcileRequested = true");
  expect(provider).toContain('errorClass: "automatic-authority-recovery"');
  expect(checkpointSource).toContain("locks.query?.()");
  expect(checkpointSource).toContain(
    "const authority = await readVerifiedAuthority()",
  );
  expect(checkpointSource).toContain("window.localStorage.getItem(key) !== raw");
  expect(checkpointSource).toContain("entry.values.delete(key)");
  expect(taskPanel).toContain("isGroupRunAuthoritySettledEmpty(groupRunScope)");
  expect(taskPanel).toContain("GROUP_RUN_AUTHORITY_EVENT");
  expect(taskPanel).toContain("当前浏览器无法安全自动恢复");
  expect(taskPanel).toContain("请刷新页面或使用支持 Web Locks 的浏览器后重试");
  expect(provider).toContain(
    "void executeGroup(checkpoint.groupId, checkpoint, hasAcceptedTasks)",
  );
  expect(provider).toContain('resumeMode: "current-graph"');
  expect(provider).toContain("durableRestartCheckpoint = currentGraphRecords[0]");
  expect(provider).toContain("durableRestartCheckpoint ?? {");
  expect(provider).toContain(
    "checkpoint: GroupRunCheckpoint | undefined,\n): boolean => checkpoint !== undefined",
  );
  const retiredResumeGuard = provider.indexOf(
    "if (hasLegacyResumeCheckpoint(resumeCheckpoint))",
  );
  const serverWorkflowEntry = provider.indexOf(
    "if (!resumeCheckpoint) {",
    retiredResumeGuard,
  );
  expect(retiredResumeGuard).toBeGreaterThan(-1);
  expect(serverWorkflowEntry).toBeGreaterThan(retiredResumeGuard);
  expect(provider.slice(retiredResumeGuard, serverWorkflowEntry)).toContain(
    "return;",
  );
  expect(provider).not.toContain("enqueueGroupResultProjection(");
  expect(provider).toContain(
    "freshTask = await getGenerationTask(\n                    candidate.taskId",
  );
  expect(provider).toContain(
    "if (freshTask.generationIdentityVersion === 2) {\n                  return \"modern\" as const;",
  );
  expect(provider).toContain("let terminalErrorPublished = false");
  expect(provider).toContain(
    'errorClass: kind === "error" ? "run-terminal" : errorClass',
  );
  expect(provider).toContain(
    'errorClass: "run-terminal",\n        groupId,\n        nodeId: groupId,',
  );
  expect(provider).not.toContain(
    'notify("浏览器无法保存整组进度，为避免刷新后重复生成，本轮已阻止", "error")',
  );
  expect(provider).not.toContain(
    'notify("自动核对进度无法保存；本次未提交任何新任务", "error")',
  );
  const acceptedOnlyEmptyGuard = provider.indexOf(
    "acceptedTasksOnly &&\n        Object.keys(resumeCheckpoint?.acceptedTasks ?? {}).length === 0",
  );
  const startRegistration = provider.indexOf(
    "startingGroupIds.current.add(groupId)",
  );
  expect(acceptedOnlyEmptyGuard).toBeGreaterThan(-1);
  expect(acceptedOnlyEmptyGuard).toBeLessThan(startRegistration);
  expect(provider.slice(acceptedOnlyEmptyGuard, startRegistration)).toContain(
    "恢复记录没有可核对的已接收任务；本轮未提交新任务",
  );
  expect(provider.slice(acceptedOnlyEmptyGuard, startRegistration)).toContain(
    "return;",
  );
  expect(provider).toContain(
    "binding.modelConfigurationRevision ===",
  );
  expect(provider).toContain(
    "rightBinding.modelConfigurationRevision",
  );
  expect(provider).toContain('notifyTerminalErrorOnce(\n              "lease-lost"');
  expect(provider).toContain("candidateLockIds = stableLockIds");
  const leaseAdmission = provider.indexOf(
    "leaseAcquired = await runExclusiveCanvasSubmit",
  );
  const authoritativeRevisionRead = provider.indexOf(
    "await readAuthoritativeCanvasRevision()",
    leaseAdmission,
  );
  const leaseAdmissionResult = provider.indexOf(
    "if (!leaseAcquired)",
    authoritativeRevisionRead,
  );
  expect(leaseAdmission).toBeGreaterThan(-1);
  expect(authoritativeRevisionRead).toBeGreaterThan(leaseAdmission);
  expect(leaseAdmissionResult).toBeGreaterThan(authoritativeRevisionRead);
  expect(provider).toContain(
    "admissionRevision !== stableCanvasRevision",
  );
  expect(provider).toContain(
    "authoritativeRevision !== stableCanvasRevision",
  );
  expect(provider).toContain(
    "admissionFingerprint !== snapshotFingerprint",
  );
  expect(canvas).toContain("readAuthoritativeCanvasRevision");
  expect(provider).toContain(
    "const blockedGroupIds = new Set(reconstructed.blockedGroupIds)",
  );
  expect(provider).not.toContain(
    "if (reconstructed.blockedGroupIds.length > 0) return",
  );
  const restartWrite = provider.indexOf(
    "writeGroupRunCheckpoint(pendingRestartCheckpoint)",
  );
  const oldRunClear = provider.indexOf(
    "clearGroupRunCheckpoint(scope, expectedLease())",
    restartWrite,
  );
  expect(restartWrite).toBeGreaterThan(-1);
  expect(oldRunClear).toBeGreaterThan(restartWrite);
  expect(canvas).not.toContain("retainWorkflowNodesForRender");
  expect(canvas).not.toContain("isConnectionAllowed(connection, edgesRef.current)");
  expect(canvas).toContain("runCanvasMutationAdmission(");
  expect(canvas).toContain("commitCanvasGraphAtomic");
  expect(canvas).toContain("applyViewUpdate");
  expect(taskClient).toContain("runWithCanvasGraphMutationAdmission");
  expect(taskPanel).toContain("readGroupRunCheckpointCache(groupRunScope)");
  expect(taskPanel).toContain('data-testid="tasks-group-recovery"');
  expect(taskPanel).toContain("groupSummary?.groupId === groupCheckpoint.groupId");
  expect(shell).toContain("readGroupRunCheckpointCache(groupRunScope)");
  expect(shell).toContain("readGroupRunLeaseCache(groupRunScope)");
  expect(executors).toContain("inputPreflight.normalizedParameters");
  expect(executors).toContain("inputs: inputPreflight.inputs");
  expect(executors).toContain("recheckExecutionContract(context, plan)");
  expect(executors).toContain("workflowGroupId: context.groupId");
  expect(executors).toContain("task.modelReleaseRevision !== plan.modelReleaseRevision");
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
  expect(taskClient).toContain("...(workflowBinding ? { workflowBinding } : {})");
  expect(taskServer).toContain("const workflowBinding = durableWorkflowBinding(task)");
  expect(taskServer).toContain("compileRegisteredModelTaskDecision({");
  expect(taskApi).toContain('code: "WORKFLOW_BINDING_MISMATCH"');
  expect(taskApi).toContain("...(workflowBinding ? { workflowBinding } : {})");
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

test("navigation fails closed when any scoped lease cache entry is malformed", () => {
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
    navigator: { configurable: true, value: {} },
  });
  host.window = fakeWindow;
  const scope = {
    accountId: "account-corrupt-lease",
    canvasId: "canvas-corrupt-lease",
    fixtureScopeId: "",
  };
  const now = Date.now();
  const checkpoint: GroupRunCheckpoint = {
    ...scope,
    executableNodeIds: ["node-a"],
    groupId: "group-a",
    nodeStates: { "node-a": "running" },
    runId: "run-a",
    snapshotFingerprint: "snapshot-a",
    startedAt: now,
    status: "running",
    successProofs: {},
    updatedAt: now,
    version: 2,
  };
  const stopped: string[] = [];
  fakeWindow.addEventListener("unboundry:group-run-stop", (event) => {
    stopped.push((event as CustomEvent<{ runId: string }>).detail.runId);
  });
  try {
    expect(writeGroupRunCheckpoint(checkpoint)).toBe(true);
    const leaseKey = (runId: string) =>
      `unboundry-group-run-lease:v1:${JSON.stringify([
        scope.accountId,
        scope.canvasId,
        scope.fixtureScopeId,
        runId,
      ])}`;
    values.set(leaseKey("run-a"), JSON.stringify({
      expiresAt: now + 60_000,
      heartbeatAt: now,
      lockedNodeIds: ["node-a"],
      ownerId: "foreign-owner",
      runId: "run-a",
    }));
    values.set(leaseKey("run-bad"), "{not-json");
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    expect(confirmGroupRunNavigation(scope)).toBe(false);
    expect(stopped).toEqual([]);
    expect(readGroupRunCheckpoint(scope, "run-a")?.status).toBe("running");
  } finally {
    clearGroupRunCheckpoint(scope);
    if (previousWindow) host.window = previousWindow;
    else delete host.window;
  }
});

test("exact run cache keys reject malformed keys, maps, suffix drift and incomplete leases without mutation", async () => {
  const host = globalThis as unknown as { window?: Window };
  const previousWindow = host.window;
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  } satisfies Storage;
  const fakeWindow = new EventTarget() as Window;
  let heldLockNames: string[] = [];
  let canvasAdmissionDepth = 0;
  Object.defineProperties(fakeWindow, {
    confirm: { value: () => true },
    localStorage: { value: storage },
    navigator: {
      configurable: true,
      value: {
        locks: {
          query: async () => ({
            held: heldLockNames.map((name) => ({ name })),
            pending: [],
          }),
          request: async <T>(
            name: string,
            _options: { ifAvailable: boolean },
            callback: (lock: unknown) => Promise<T> | T,
          ) => {
            const isCanvasAdmission = name.startsWith(
              "unboundry-group-run-canvas-admission:",
            );
            if (isCanvasAdmission) canvasAdmissionDepth += 1;
            try {
              return await callback({});
            } finally {
              if (isCanvasAdmission) canvasAdmissionDepth -= 1;
            }
          },
        },
      },
    },
  });
  host.window = fakeWindow;
  const scope = {
    accountId: "account-strict-cache",
    canvasId: "canvas-strict-cache",
    fixtureScopeId: "",
  };
  const now = Date.now();
  const lease = {
    expiresAt: now + 60_000,
    heartbeatAt: now,
    lockedNodeIds: ["node-a"],
    ownerId: "owner-a",
    runId: "run-a",
  };
  const checkpoint: GroupRunCheckpoint = {
    ...scope,
    executableNodeIds: ["node-a"],
    groupId: "group-a",
    nodeStates: { "node-a": "running" },
    runId: "run-a",
    snapshotFingerprint: "snapshot-a",
    startedAt: now,
    status: "running",
    successProofs: {},
    updatedAt: now,
    version: 2,
  };
  const leaseKey = `unboundry-group-run-lease:v1:${JSON.stringify([
    scope.accountId, scope.canvasId, scope.fixtureScopeId, "run-a",
  ])}`;
  const checkpointKey = `unboundry-group-run-checkpoint:v1:${JSON.stringify([
    scope.accountId, scope.canvasId, scope.fixtureScopeId, "run-a",
  ])}`;
  const legacyCheckpointKey =
    `unboundry-group-run-checkpoint:v1:${JSON.stringify([
      scope.accountId, scope.canvasId, scope.fixtureScopeId,
    ])}`;
  const malformedLeaseKey = "unboundry-group-run-lease:v1:{malformed-scope";
  const malformedCheckpointKey =
    "unboundry-group-run-checkpoint:v1:{malformed-scope";
  const nonArrayLeaseKey =
    `unboundry-group-run-lease:v1:${JSON.stringify({ scope: "unknown" })}`;
  const incompleteLeaseKey =
    `unboundry-group-run-lease:v1:${JSON.stringify([
      scope.accountId, scope.canvasId,
    ])}`;
  const nonArrayCheckpointKey =
    `unboundry-group-run-checkpoint:v1:${JSON.stringify({ scope: "unknown" })}`;
  const incompleteCheckpointKey =
    `unboundry-group-run-checkpoint:v1:${JSON.stringify([
      scope.accountId, scope.canvasId,
    ])}`;
  try {
    expect(groupRunAuthorityRecoverySupported()).toBe(true);
    expect(isGroupRunAuthoritySettledEmpty(scope)).toBe(false);
    let authorityEvents = 0;
    fakeWindow.addEventListener("unboundry:group-run-authority", () => {
      authorityEvents += 1;
    });
    setGroupRunAuthoritySettledEmpty(scope, true);
    expect(isGroupRunAuthoritySettledEmpty(scope)).toBe(true);
    setGroupRunAuthoritySettledEmpty(scope, true);
    expect(authorityEvents).toBe(1);
    setGroupRunAuthoritySettledEmpty(scope, false);
    expect(isGroupRunAuthoritySettledEmpty(scope)).toBe(false);
    expect(authorityEvents).toBe(2);
    const otherScopeLeaseKey = `unboundry-group-run-lease:v1:${JSON.stringify([
      "different-account", scope.canvasId, "different-fixture", "run-other-scope",
    ])}`;
    values.set(otherScopeLeaseKey, JSON.stringify({
      ...lease,
      runId: "run-other-scope",
    }));
    expect(await hasForeignActiveGroupRunLeaseForCanvas(scope, "node-a"))
      .toBe(false);
    expect(await hasConflictingActiveGroupRunLeaseForCanvas(scope, "node-a"))
      .toBe(false);
    values.delete(otherScopeLeaseKey);

    values.set(malformedLeaseKey, JSON.stringify(lease));
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    expect(await acquireGroupRunLease(
      scope,
      "run-malformed",
      "owner-malformed",
      now,
      ["node-a"],
    )).toBe(false);
    expect(values.has(malformedLeaseKey)).toBe(true);
    values.delete(malformedLeaseKey);

    for (const structurallyInvalidKey of [nonArrayLeaseKey, incompleteLeaseKey]) {
      values.set(structurallyInvalidKey, JSON.stringify(lease));
      expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
      expect(await acquireGroupRunLease(
        scope,
        "run-structurally-invalid",
        "owner-structurally-invalid",
        now,
        ["node-a"],
      )).toBe(false);
      expect(values.has(structurallyInvalidKey)).toBe(true);
      values.delete(structurallyInvalidKey);
    }

    values.set(leaseKey, "");
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    expect(await acquireGroupRunLease(
      scope,
      "run-empty-value",
      "owner-empty-value",
      now,
      ["node-a"],
    )).toBe(false);
    expect(values.get(leaseKey)).toBe("");
    values.delete(leaseKey);

    values.set(malformedCheckpointKey, JSON.stringify(checkpoint));
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
    expect(confirmGroupRunNavigation(scope)).toBe(false);
    expect(writeGroupRunCheckpoint(checkpoint)).toBe(false);
    expect(values.has(malformedCheckpointKey)).toBe(true);
    values.delete(malformedCheckpointKey);

    for (const structurallyInvalidKey of [
      nonArrayCheckpointKey,
      incompleteCheckpointKey,
    ]) {
      values.set(structurallyInvalidKey, JSON.stringify(checkpoint));
      expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
      expect(confirmGroupRunNavigation(scope)).toBe(false);
      expect(writeGroupRunCheckpoint(checkpoint)).toBe(false);
      expect(values.has(structurallyInvalidKey)).toBe(true);
      values.delete(structurallyInvalidKey);
    }

    values.set(checkpointKey, "");
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
    expect(confirmGroupRunNavigation(scope)).toBe(false);
    expect(writeGroupRunCheckpoint(checkpoint)).toBe(false);
    expect(values.get(checkpointKey)).toBe("");
    values.delete(checkpointKey);

    values.set(checkpointKey, JSON.stringify({
      ...checkpoint,
      accountId: "different-account",
    }));
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
    expect(readGroupRunCheckpoint(scope, "run-a")).toBeUndefined();
    values.delete(checkpointKey);

    values.set(legacyCheckpointKey, JSON.stringify({
      "run-a": checkpoint,
      "run-b": {
        ...checkpoint,
        canvasId: "different-canvas",
        runId: "run-b",
      },
    }));
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
    expect(readGroupRunCheckpoints(scope)).toEqual([checkpoint]);
    values.delete(legacyCheckpointKey);

    values.set(leaseKey, JSON.stringify({ "run-a": lease }));
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    expect(confirmGroupRunNavigation(scope)).toBe(false);
    expect(values.has(leaseKey)).toBe(true);

    values.set(leaseKey, JSON.stringify({ ...lease, runId: "run-b" }));
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    expect(releaseGroupRunLease(scope, "run-a", "owner-a")).toBe(false);
    expect(values.has(leaseKey)).toBe(true);

    const { lockedNodeIds: _locks, ...incompleteLease } = lease;
    values.set(leaseKey, JSON.stringify(incompleteLease));
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);

    values.delete(leaseKey);
    values.set(checkpointKey, JSON.stringify({ "run-a": checkpoint }));
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
    expect(confirmGroupRunNavigation(scope)).toBe(false);
    expect(clearGroupRunCheckpoint(scope, undefined, "run-a")).toBe(false);
    expect(values.has(checkpointKey)).toBe(true);

    values.set(checkpointKey, JSON.stringify({ ...checkpoint, runId: "run-b" }));
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
    expect(clearGroupRunCheckpoint(scope, undefined, "run-a")).toBe(false);
    expect(values.has(checkpointKey)).toBe(true);

    values.clear();
    values.set(malformedLeaseKey, "");
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(false);
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    let leaseOnlyAuthorityReads = 0;
    expect(await quarantineCorruptGroupRunCacheAfterAuthority(
      scope,
      async () => {
        leaseOnlyAuthorityReads += 1;
        expect(canvasAdmissionDepth).toBe(1);
        return "lease-only-authority";
      },
    )).toBe("lease-only-authority");
    expect(leaseOnlyAuthorityReads).toBe(1);
    expect(readGroupRunLeaseCache(scope)).toMatchObject({
      corrupted: false,
      quarantined: true,
    });
    values.set(malformedLeaseKey, "{changed-after-lease-only-authority");
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    values.set(malformedLeaseKey, "");
    values.set(nonArrayCheckpointKey, JSON.stringify(checkpoint));
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(true);
    heldLockNames = [
      `unboundry-group-run:${JSON.stringify([
        scope.accountId, scope.canvasId, scope.fixtureScopeId,
      ])}:foreign-run`,
    ];
    let authorityReads = 0;
    expect(await quarantineCorruptGroupRunCacheAfterAuthority(
      scope,
      async () => {
        authorityReads += 1;
        expect(canvasAdmissionDepth).toBe(1);
        return "verified-authority";
      },
    )).toBeUndefined();
    expect(authorityReads).toBe(0);
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    heldLockNames = [];
    expect(await quarantineCorruptGroupRunCacheAfterAuthority(
      scope,
      async () => {
        authorityReads += 1;
        expect(canvasAdmissionDepth).toBe(1);
        return "verified-authority";
      },
    )).toBe("verified-authority");
    expect(authorityReads).toBe(1);
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(false);
    expect(readGroupRunLeaseCache(scope).quarantined).toBe(true);
    expect(readGroupRunCheckpointCache(scope).corrupted).toBe(false);
    expect(readGroupRunCheckpointCache(scope).quarantined).toBe(true);
    expect(values.get(malformedLeaseKey)).toBe("");
    expect(values.get(nonArrayCheckpointKey)).toBe(JSON.stringify(checkpoint));
    expect(writeGroupRunCheckpoint(checkpoint)).toBe(true);
    expect(readGroupRunCheckpoint(scope, "run-a")?.runId).toBe("run-a");
    values.set(malformedLeaseKey, "{changed-after-authority");
    expect(readGroupRunLeaseCache(scope).corrupted).toBe(true);
    expect(await quarantineCorruptGroupRunCacheAfterAuthority(
      scope,
      async () => {
        expect(canvasAdmissionDepth).toBe(1);
        values.set(malformedLeaseKey, "{changed-during-authority");
        return "stale-authority";
      },
    )).toBeUndefined();
    expect(writeGroupRunCheckpoint(checkpoint)).toBe(false);
    const requestLock = (fakeWindow.navigator as Navigator & {
      locks: { request: unknown };
    }).locks.request;
    Object.defineProperty(fakeWindow, "navigator", {
      configurable: true,
      value: { locks: { request: requestLock } },
    });
    expect(groupRunAuthorityRecoverySupported()).toBe(false);
  } finally {
    setGroupRunAuthoritySettledEmpty(scope, false);
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

  const publishedNotices = new Map<string, Set<"recovering" | "terminal">>();
  const noticeIdentity = {
    accountId: summary.accountId,
    canvasId: summary.canvasId,
    errorClass: "poll-timeout",
    groupId: summary.groupId,
    nodeId: "node-a",
    runId: summary.runId,
  };
  expect(Array.from({ length: 30 }, () => publishGroupRunNotificationOnce(
    publishedNotices,
    noticeIdentity,
    "recovering",
  )).filter(Boolean)).toHaveLength(1);
  expect(publishGroupRunNotificationOnce(
    publishedNotices,
    noticeIdentity,
    "terminal",
  )).toBe(true);
  expect(publishGroupRunNotificationOnce(
    publishedNotices,
    noticeIdentity,
    "terminal",
  )).toBe(false);

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
    .toContain("不会重复付费提交");
  expect(friendlyGenerationMessage(undefined, "image", "PROVIDER_RESULT_FORMAT"))
    .toContain("模型已响应");
  expect(friendlyGenerationMessage(
    "系统正在自动找回平台结果；不会重新提交付费请求",
    "image",
    "RESULT_SAVE_FAILED_NO_RETRY",
  )).toBe("图片平台已返回结果，但系统未能安全保存；本轮已自动停止且不会重复提交");
  expect(generationFailureMessage(
    "系统正在自动找回平台结果；不会重新提交付费请求",
    "上次结果仍在系统自动找回中；为避免重复扣费，当前不能重新生成",
    "RESULT_SAVE_FAILED_NO_RETRY",
    "image",
  )).toBe("图片平台已返回结果，但系统未能安全保存；本轮已自动停止且不会重复提交");
  expect(generationFailureIsDefinitive("PROVIDER_RESULT_FORMAT")).toBe(false);
});

test("workflow recovery never routes ordinary users to task panels or external platforms", () => {
  const provider = readFileSync(
    "client/src/generation/WorkflowExecutionProvider.tsx",
    "utf8",
  );
  expect(provider).not.toMatch(
    /任务面板|任务中心|素材库|外部平台|平台任务号|Provider URL/,
  );
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

  const abortEvents: string[] = [];
  let releaseAbortOwner!: () => void;
  const abortOwnerHold = new Promise<void>((resolve) => {
    releaseAbortOwner = resolve;
  });
  const abortOwner = runExclusiveCanvasSubmit("canvas-abort", async () => {
    abortEvents.push("owner-start");
    await abortOwnerHold;
    abortEvents.push("owner-end");
  });
  const abortController = new AbortController();
  const abortedWaiter = runExclusiveCanvasSubmit(
    "canvas-abort",
    async () => abortEvents.push("aborted-start"),
    abortController.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  abortController.abort("cancelled-while-queued");
  await expect(abortedWaiter).rejects.toBe("cancelled-while-queued");
  const afterAbort = runExclusiveCanvasSubmit("canvas-abort", async () => {
    abortEvents.push("after-abort-start");
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(abortEvents).toEqual(["owner-start"]);
  releaseAbortOwner();
  await Promise.all([abortOwner, afterAbort]);
  expect(abortEvents).toEqual([
    "owner-start",
    "owner-end",
    "after-abort-start",
  ]);

  let releaseLegacyLane!: () => void;
  const legacyLaneHold = new Promise<void>((resolve) => {
    releaseLegacyLane = resolve;
  });
  const legacyLane = runExclusiveCanvasSubmit(
    "canvas-lanes",
    async () => legacyLaneHold,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await expect(runExclusiveServerWorkflowSubmit(
    "canvas-lanes",
    async () => "server-workflow-created",
  )).resolves.toBe("server-workflow-created");
  releaseLegacyLane();
  await legacyLane;

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

test("group persist retry is bounded for a still-saving canvas and never covers other failures", async () => {
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

  let timeoutClock = 0;
  let timeoutRuns = 0;
  const timedOut = await runGroupNodeWithPersist({
    admissionDeadlineMs: 30_000,
    now: () => timeoutClock,
    persist: async () => {
      timeoutClock += 10_000;
      return undefined;
    },
    run: async () => {
      timeoutRuns += 1;
      return {
        message: "画布内容还在保存，请等待自动保存完成后再试",
        status: "failed",
      };
    },
  });
  expect(timedOut).toEqual({
    errorCode: "SAVE_STABILITY_TIMEOUT",
    message: "画布持续变化，本次没有创建生成任务。请停止编辑后再试。",
    status: "failed",
  });
  expect(timeoutRuns).toBe(4);

  let preflightClock = 0;
  let preflightRuns = 0;
  let preflightPersists = 0;
  const preflightTimedOut = await runGroupNodeWithPersist({
    admissionDeadlineMs: 500,
    now: () => preflightClock,
    persist: async () => {
      preflightPersists += 1;
      return undefined;
    },
    run: async () => {
      preflightRuns += 1;
      return {
        errorCode: "PREFLIGHT_RETRYABLE",
        message: "生成预检暂时未完成，正在自动重试",
        status: "failed",
      };
    },
    waitForAdmissionRetry: async (milliseconds) => {
      preflightClock += milliseconds;
    },
  });
  expect(preflightTimedOut).toEqual({
    errorCode: "PREFLIGHT_TIMEOUT",
    message: "生成预检持续不可用，本次没有创建生成任务。请稍后再试。",
    status: "failed",
  });
  expect(preflightRuns).toBe(3);
  expect(preflightPersists).toBe(1);

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
    allowLegacyBrowserProjection: true,
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

  const modernBrowserProjectionAttempts: string[] = [];
  const modernPersistFailed = await runGroupNodeWithPersist({
    persist: async () => "画布保存超时，请稍后再试",
    project: (candidate) => {
      modernBrowserProjectionAttempts.push(candidate.applicationId);
    },
    run: async () => ({ projection, status: "success" }),
  });
  expect(modernPersistFailed).toMatchObject({ status: "success" });
  expect(modernPersistFailed.projectionState).toBeUndefined();
  expect(modernBrowserProjectionAttempts).toEqual([]);

  const duplicateApplications: string[] = [];
  const projectOnce = (candidate: GroupResultProjection) => {
    if (!duplicateApplications.includes(candidate.applicationId)) {
      duplicateApplications.push(candidate.applicationId);
    }
  };
  const repeat = () => runGroupNodeWithPersist({
    allowLegacyBrowserProjection: true,
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
  await assertRepeatedCanvasRevisionDriftConverges();
});

async function assertRepeatedCanvasRevisionDriftConverges() {
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

  const executableNodes: WorkflowNodeShape[] = Array.from(
    { length: 11 },
    (_, index) => ({
      data: { textPrompt: `fixture-${index}` },
      id: `drift-node-${index}`,
      type: "text",
    }),
  );
  const fillerNodes: WorkflowNodeShape[] = Array.from(
    { length: 42 },
    (_, index) => ({ data: {}, id: `filler-${index}`, type: "note" }),
  );
  const executableEdges = Array.from({ length: 9 }, (_, index) => ({
    id: `executable-edge-${index}`,
    source: `drift-node-${index % 2}`,
    target: `drift-node-${index + 2}`,
  }));
  const fillerEdges = Array.from({ length: 89 }, (_, index) => ({
    id: `filler-edge-${index}`,
    source: `filler-${index % 41}`,
    target: `filler-${(index % 41) + 1}`,
  }));
  const productionShapeNodes = [...executableNodes, ...fillerNodes];
  const productionShapeEdges = [...executableEdges, ...fillerEdges];
  expect(productionShapeNodes).toHaveLength(53);
  expect(productionShapeEdges).toHaveLength(98);
  expect(buildWorkflowLayers(executableNodes, executableEdges)[0]).toEqual([
    "drift-node-0",
    "drift-node-1",
  ]);

  let canvasRevision = 40;
  let formalPosts = 0;
  let preflights = 0;
  let monotonicNow = 0;
  let invalidPreflightRevision = false;
  let retryablePreflightFailures = 0;
  const retryablePreflightKeys: string[] = [];
  let formalDeadlinePosts = 0;
  const postKeys: string[] = [];
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
      const body = JSON.parse(String(init?.body)) as {
        idempotencyKey: string;
        nodeId: string;
      };
      preflights += 1;
      monotonicNow += 4_000;
      if (body.nodeId === "retryable-preflight-node") {
        retryablePreflightKeys.push(body.idempotencyKey);
        retryablePreflightFailures += 1;
        if (retryablePreflightFailures === 1) {
          throw new TypeError("synthetic preflight network failure");
        }
        if (retryablePreflightFailures === 2) {
          return response({ error: "synthetic preflight unavailable" }, 503);
        }
      }
      return response({
        canEnqueue: true,
        canSubmit: true,
        canvasRevision: invalidPreflightRevision ? "invalid" : canvasRevision,
        problems: [],
      });
    }
    if (url === "/api/generation-tasks" && method === "POST") {
      formalPosts += 1;
      const body = JSON.parse(String(init?.body)) as {
        canvasId: string;
        idempotencyKey: string;
        kind: "text";
        nodeId: string;
        prompt: string;
      };
      postKeys.push(body.idempotencyKey);
      if (body.nodeId === "formal-deadline-node") {
        formalDeadlinePosts += 1;
        return await new Promise<Response>(() => {});
      }
      if (formalPosts <= 2) {
        return response({
          code: "CANVAS_NOT_SAVED",
          error: "画布内容还在保存，请等待自动保存完成后再试",
        }, 409);
      }
      return response({
        attempt: 1,
        canvasId: body.canvasId,
        costCurrency: "CNY",
        createdAt: "2026-08-31T00:00:00.000Z",
        id: "drift-task-accepted",
        idempotencyKey: body.idempotencyKey,
        kind: body.kind,
        nodeId: body.nodeId,
        prompt: body.prompt,
        state: "running",
        updatedAt: "2026-08-31T00:00:01.000Z",
      }, 202);
    }
    throw new Error(`unexpected drift fetch: ${method} ${url}`);
  }) as typeof fetch;

  const nodeStates = new Map<string, string>();
  const executionEdges = Array.from({ length: 10 }, (_, index) => ({
    id: `execution-edge-${index}`,
    source: "drift-node-0",
    target: `drift-node-${index + 1}`,
  }));
  try {
    const result = await runWorkflowGraph({
      edges: executionEdges,
      executableIds: new Set(executableNodes.map((node) => node.id)),
      isCancelled: () => false,
      onNodeStateChange: (nodeId, state) => nodeStates.set(nodeId, state),
      runNode: async (nodeId) => {
        if (nodeId !== "drift-node-0") return { status: "success" };
        return runGroupNodeWithPersist({
          now: () => monotonicNow,
          persist: async () => {
            canvasRevision += 1;
            monotonicNow += 20;
            return undefined;
          },
          run: async (admissionRemainingMs) => {
            try {
              await ensureGenerationTask("text", {
                canvasId: "drift-canvas",
                canvasRevision,
                model: "drift-model",
                nodeId,
                prompt: "controlled drift prompt",
              }, "", undefined, { admissionRemainingMs });
              return { status: "success" };
            } catch (error) {
              return {
                errorCode: error instanceof GenerationRequestError
                  ? error.code
                  : undefined,
                message: error instanceof Error ? error.message : String(error),
                status: "failed",
              };
            }
          },
        });
      },
    });
    expect(result, JSON.stringify({ nodeStates: [...nodeStates], postKeys }))
      .toEqual({ status: "success" });
    expect(preflights).toBe(3);
    expect(formalPosts).toBe(3);
    expect(new Set(postKeys).size).toBe(1);
    expect(monotonicNow).toBe(12_060);
    invalidPreflightRevision = true;
    await expect(ensureGenerationTask("text", {
      canvasId: "drift-canvas",
      canvasRevision,
      model: "drift-model",
      nodeId: "invalid-preflight-node",
      prompt: "invalid preflight revision",
    })).rejects.toMatchObject({ code: "CANVAS_REVISION_INVALID", status: 409 });
    expect(formalPosts).toBe(3);
    invalidPreflightRevision = false;
    let retryablePreflightPersists = 0;
    const retryablePreflight = await runGroupNodeWithPersist({
      now: () => monotonicNow,
      persist: async () => {
        retryablePreflightPersists += 1;
        return undefined;
      },
      run: async (admissionRemainingMs) => {
        try {
          await ensureGenerationTask("text", {
            canvasId: "drift-canvas",
            canvasRevision,
            model: "drift-model",
            nodeId: "retryable-preflight-node",
            prompt: "retry the zero-provider preflight only",
          }, "", undefined, { admissionRemainingMs });
          return { status: "success" };
        } catch (error) {
          return {
            errorCode: error instanceof GenerationRequestError
              ? error.code
              : undefined,
            message: error instanceof Error ? error.message : String(error),
            status: "failed",
          };
        }
      },
      waitForAdmissionRetry: async (milliseconds) => {
        monotonicNow += milliseconds;
      },
    });
    expect(retryablePreflight).toEqual({ status: "success" });
    expect(retryablePreflightFailures).toBe(3);
    expect(new Set(retryablePreflightKeys).size).toBe(1);
    expect(formalPosts).toBe(4);
    expect(retryablePreflightPersists).toBe(1);
    let formalDeadlinePersists = 0;
    const formalDeadline = await runGroupNodeWithPersist({
      admissionDeadlineMs: 4_001,
      now: () => monotonicNow,
      persist: async () => {
        formalDeadlinePersists += 1;
        return undefined;
      },
      run: async (admissionRemainingMs) => {
        try {
          await ensureGenerationTask("text", {
            canvasId: "drift-canvas",
            canvasRevision,
            model: "drift-model",
            nodeId: "formal-deadline-node",
            prompt: "formal response crosses the shared deadline",
          }, "", undefined, { admissionRemainingMs });
          return { status: "success" };
        } catch (error) {
          return {
            errorCode: error instanceof GenerationRequestError
              ? error.code
              : undefined,
            message: error instanceof Error ? error.message : String(error),
            status: "failed",
          };
        }
      },
    });
    expect(formalDeadline).toMatchObject({
      errorCode: "GENERATION_RESPONSE_TIMEOUT",
      status: "failed",
    });
    expect(formalDeadlinePosts).toBe(1);
    expect(formalDeadlinePersists).toBe(1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete host.window;
    else host.window = previousWindow;
  }
}

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
  const modelReleaseRevision = randomUUID();
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
          configurationRevision: `fixture-image-${modelId}-revision-1`,
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
          releaseRevisionId: modelReleaseRevision,
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
    const group = page.locator('[data-testid="rf__node-image-group"]');
    await group.click({
      position: { x: 5, y: 5 },
    });
    const execute = group.getByTestId("group-execute-button");
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
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "节点 target-image 的已发布模型不可用",
      { timeout: 15_000 },
    );
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

test("browser workflow breathes only while admitted and retired recovery never resubmits", async ({
  page,
  request,
}) => {
  const modelId = `fixture-server-workflow-${randomUUID()}`;
  const runId = randomUUID();
  const releaseRevisionId = randomUUID();
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = await created.json() as { id: string };
  let createPosts = 0;
  let canvasPuts = 0;
  let clientSemanticFingerprint = "";
  let stopPosts = 0;
  let generationTaskPosts = 0;
  let listFailures = 0;
  let workflowNodeState: "pending" | "admitting" | "admitted" = "pending";
  const servedWorkflowNodeStates: string[] = [];
  let transientStatusFailures = 0;
  let stopped = false;
  let runCreatedAt = new Date().toISOString();
  const modelConfigurationRevision = `fixture-${modelId}-revision-1`;
  const workflowNodes: ProbeNodeType[] = [{
    data: { label: "Group", title: "服务端整组" },
    id: "server-group",
    position: { x: 100, y: 100 },
    style: { height: 500, width: 700 },
    type: "group",
    zIndex: 0,
  }, {
    data: {
      label: "Text",
      textModelId: modelId,
      textParameters: {},
      textPrompt: "生成服务端整组文字",
      textPromptReady: true,
      title: "服务端文字",
    },
    id: "server-text",
    parentId: "server-group",
    position: { x: 40, y: 80 },
    style: { height: 240, width: 300 },
    type: "text",
    zIndex: 1,
  }];
  const currentGraphFingerprint = groupRunSnapshotFingerprint({
    edges: [],
    executableNodeIds: new Set(["server-text"]),
    groupId: "server-group",
    modelConfigurationRevisions: {
      [`text:${modelId}`]: modelConfigurationRevision,
    },
    modelReleaseRevisions: {
      [`text:${modelId}`]: releaseRevisionId,
    },
    nodes: workflowNodes,
  });

  page.on("request", (entry) => {
    const url = new URL(entry.url());
    if (
      entry.method() === "PUT" &&
      url.pathname === `/api/canvas/${project.id}`
    ) canvasPuts += 1;
  });
  await page.clock.install();

  await page.route("**/api/generation-tasks**", async (route) => {
    const entry = route.request();
    if (
      entry.method() === "POST" &&
      /\/api\/generation-tasks(?:$|\?)/.test(entry.url())
    ) {
      generationTaskPosts += 1;
      await route.fulfill({
        body: JSON.stringify({ error: "intent gate fixture" }),
        contentType: "application/json",
        status: 409,
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        generationEnabled: true,
        models: [{
          capability: "text",
          configurationRevision: modelConfigurationRevision,
          displayName: "服务端整组测试模型",
          generationAvailable: true,
          id: modelId,
          isDefault: true,
          parameterSchema: defaultParameterSchema("text"),
          releaseRevisionId,
        }],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  const runBody = (state: "running" | "stopping" | "cancelled") => ({
    canvasId: project.id,
    clientSemanticFingerprint: clientSemanticFingerprint || "wf1-pending",
    createdAt: runCreatedAt,
    groupId: "server-group",
    id: runId,
    lockedNodeIds: ["server-text"],
    nodes: [{
      id: "server-text",
      kind: "text",
      projectionState: "pending",
      state: state === "cancelled" ? "cancelled" : workflowNodeState,
    }],
    semanticFingerprint: "wf1-test",
    state,
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  await page.route("**/api/workflow-runs**", async (route) => {
    const requestEntry = route.request();
    const requestUrl = new URL(requestEntry.url());
    const method = requestEntry.method();
    if (method === "GET" && requestUrl.pathname === "/api/workflow-runs") {
      if (createPosts === 0 && listFailures === 0) {
        listFailures += 1;
        await route.fulfill({
          body: JSON.stringify({ error: "temporary list failure" }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          runs: createPosts > 0
            ? [runBody(stopped ? "cancelled" : "running")]
            : [],
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (method === "POST" && requestUrl.pathname === "/api/workflow-runs") {
      createPosts += 1;
      const body = requestEntry.postDataJSON() as {
        clientSemanticFingerprint?: string;
      };
      clientSemanticFingerprint = body.clientSemanticFingerprint ?? "";
      runCreatedAt = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 150));
      // Simulate a response lost after the server durably accepted the run.
      await route.abort("failed");
      return;
    }
    if (
      method === "POST" &&
      requestUrl.pathname === `/api/workflow-runs/${runId}/stop`
    ) {
      stopPosts += 1;
      stopped = true;
      await route.fulfill({
        body: JSON.stringify(runBody("stopping")),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (method === "GET" && requestUrl.pathname === `/api/workflow-runs/${runId}`) {
      if (transientStatusFailures === 0) {
        transientStatusFailures += 1;
        await route.fulfill({
          body: JSON.stringify({ error: "temporary status failure" }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      servedWorkflowNodeStates.push(stopped ? "cancelled" : workflowNodeState);
      await route.fulfill({
        body: JSON.stringify(runBody(stopped ? "cancelled" : "running")),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.abort("failed");
  });

  try {
    const saveMetadata = await existingCanvasSaveMetadata(request, project.id);
    const providerBefore = await (
      await request.get("/api/generation-tasks/status")
    ).json() as { paidProviderRequests: number };
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [],
        nodes: workflowNodes,
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
    await expect.poll(() => listFailures).toBe(1);
    const group = page.locator('[data-testid="rf__node-server-group"]');
    await group.click({ position: { x: 5, y: 5 } });
    const execute = group.getByTestId("group-execute-button");
    await expect(execute).toBeEnabled();
    await page.evaluate(async (canvasId) => {
      let releaseServerSubmit!: () => void;
      const holdServerSubmit = new Promise<void>((resolve) => {
        releaseServerSubmit = resolve;
      });
      (window as typeof window & {
        __releaseServerWorkflowSubmit?: () => void;
      }).__releaseServerWorkflowSubmit = releaseServerSubmit;
      void navigator.locks.request(
        `unboundry:server-workflow-submit:${encodeURIComponent(canvasId)}`,
        async () => holdServerSubmit,
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const locks = await navigator.locks.query();
        if (locks.held?.some(({ name }) =>
          name ===
            `unboundry:server-workflow-submit:${encodeURIComponent(canvasId)}`
        )) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("server workflow submit lock was not acquired");
    }, project.id);
    const canvasPutsBeforeTimeout = canvasPuts;
    await execute.click();
    await expect(execute).toHaveText("停止准备");
    await page.clock.fastForward(90_100);
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "整组准备超时，本次尚未提交生成任务",
    );
    await expect(execute).toHaveText("整组执行");
    expect(canvasPuts).toBe(canvasPutsBeforeTimeout);
    expect(createPosts).toBe(0);
    expect(generationTaskPosts).toBe(0);
    await expect.poll(() => page.evaluate(async (canvasId) => {
      const lockName =
        `unboundry:server-workflow-submit:${encodeURIComponent(canvasId)}`;
      const locks = await navigator.locks.query();
      return locks.pending?.filter(({ name }) => name === lockName).length ?? 0;
    }, project.id)).toBe(0);
    await page.evaluate(() => {
      const state = window as typeof window & {
        __releaseServerWorkflowSubmit?: () => void;
      };
      state.__releaseServerWorkflowSubmit?.();
      delete state.__releaseServerWorkflowSubmit;
    });
    await page.clock.setSystemTime(new Date());
    await page.clock.resume();
    await page.evaluate(async (canvasId) => {
      let releaseLegacySubmit!: () => void;
      const holdLegacySubmit = new Promise<void>((resolve) => {
        releaseLegacySubmit = resolve;
      });
      (window as typeof window & {
        __releaseLegacyCanvasSubmit?: () => void;
      }).__releaseLegacyCanvasSubmit = releaseLegacySubmit;
      void navigator.locks.request(
        `unboundry:canvas-submit:${encodeURIComponent(canvasId)}`,
        async () => holdLegacySubmit,
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const locks = await navigator.locks.query();
        if (locks.held?.some(({ name }) =>
          name === `unboundry:canvas-submit:${encodeURIComponent(canvasId)}`
        )) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("legacy Canvas submit lock was not acquired");
    }, project.id);
    await execute.dblclick();
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "整组已由服务端接收",
    );
    await expect.poll(() => createPosts).toBe(1);
    expect(clientSemanticFingerprint).toMatch(/^wf1-[a-z0-9-]+$/);
    expect(transientStatusFailures).toBe(1);
    await expect(page.getByTestId("text-node-generating")).toHaveCount(0);
    workflowNodeState = "admitting";
    await expect.poll(() => servedWorkflowNodeStates.at(-1), {
      timeout: 5_000,
    }).toBe("admitting");
    await expect(page.getByTestId("text-node-generating")).toHaveCount(0);
    workflowNodeState = "admitted";
    await expect.poll(() => servedWorkflowNodeStates.at(-1), {
      timeout: 5_000,
    }).toBe("admitted");
    await expect(page.getByTestId("text-node-generating")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "已找回服务端整组执行",
    );
    await expect(page.getByTestId("text-node-generating")).toBeVisible();
    await group.click({ position: { x: 5, y: 5 } });
    const recoveredExecute = group.getByTestId("group-execute-button");
    await expect(recoveredExecute).toHaveText("停止后续");
    await page.waitForTimeout(250);
    await expect(recoveredExecute).toHaveText("停止后续");
    await expect.poll(() => createPosts).toBe(1);
    await recoveredExecute.click();
    await expect.poll(() => stopPosts).toBe(1);
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "服务端已确认停止后续节点",
    );
    await expect(page.getByTestId("text-node-generating")).toHaveCount(0);
    await expect.poll(() => generationTaskPosts).toBe(0);
    await expect(recoveredExecute).toHaveText("整组执行");
    await page.evaluate(async ({
      canvasId,
      currentGraphFingerprint,
    }) => {
      const status = await fetch("/api/auth/status").then((response) =>
        response.json()
      ) as { user?: { id?: string } };
      const accountId = status.user?.id;
      if (!accountId) throw new Error("missing fixture account");
      const value = {
        accountId,
        canvasId,
        executableNodeIds: ["server-text"],
        fixtureScopeId: "",
        groupId: "server-group",
        nodeStates: { "server-text": "pending" },
        resumeMode: "current-graph",
        runId: "current-graph-awaiting-explicit-intent",
        snapshotFingerprint: currentGraphFingerprint,
        startedAt: Date.now() - 1_000,
        status: "interrupted",
        successProofs: {},
        updatedAt: Date.now(),
        version: 2,
      };
      const key = `unboundry-group-run-checkpoint:v1:${JSON.stringify([
        accountId,
        canvasId,
        "",
      ])}`;
      const raw = JSON.stringify(value);
      localStorage.setItem(key, raw);
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        newValue: raw,
        storageArea: localStorage,
      }));
    }, { canvasId: project.id, currentGraphFingerprint });
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "旧版浏览器整组记录已退出调度",
      { timeout: 5_000 },
    );
    expect(generationTaskPosts).toBe(0);
    const providerAfter = await (
      await request.get("/api/generation-tasks/status")
    ).json() as { paidProviderRequests: number };
    expect(providerAfter.paidProviderRequests).toBe(
      providerBefore.paidProviderRequests,
    );
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
  const imageReleaseRevision = randomUUID();
  const textReleaseRevision = randomUUID();
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
          configurationRevision: `fixture-image-${modelId}-revision-1`,
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
          releaseRevisionId: imageReleaseRevision,
        }, {
          capability: "text",
          configurationRevision: `fixture-text-${modelId}-revision-1`,
          displayName: "文字测试模型",
          generationAvailable: true,
          id: `fixture-text-${modelId}`,
          isDefault: true,
          parameterSchema: defaultParameterSchema("text"),
          releaseRevisionId: textReleaseRevision,
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

    await page.goto(`/canvas/${project.id}`, { timeout: 10_000 });
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
      { timeout: 5_000 },
    );
    const group = page.locator('[data-testid="rf__node-image-group"]');
    await group.dispatchEvent("click");
    await expect(group).toHaveClass(/selected/, { timeout: 5_000 });
    const execute = group.getByTestId("group-execute-button");
    await expect(execute).toBeEnabled({ timeout: 5_000 });
    await execute.click({ timeout: 5_000 });
    await expect(page.getByTestId("workflow-run-toast")).toContainText(
      "节点 director-text 没有已选择的模型",
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("workflow-run-toast")).not.toContainText(
      "画布还在保存",
    );
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
