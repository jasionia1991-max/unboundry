import { randomUUID } from "node:crypto";
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
  clearGroupRunStarting,
  confirmGroupRunNavigation,
  groupRunSnapshotFingerprint,
  groupRunSuccessProof,
  hasForeignActiveGroupRunLeaseForCanvas,
  markGroupRunStarting,
  readGroupRunStarting,
  releaseGroupRunLease,
  verifiedCheckpointSuccessIds,
  type GroupRunCheckpoint,
} from "../client/src/generation/groupRunCheckpoint";
import { retainWorkflowNodesForRender } from "../client/src/generation/workflowRenderRetention";
import type { ProbeNodeType } from "../client/src/canvas/ProbeNode";
import { defaultParameterSchema } from "../types/modelParameters";
import { resolveNodeInputs } from "../types/nodeInputs";

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

test("group run starting guard and cross-tab lease fail closed", async () => {
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
    expect(await acquireGroupRunLease(scope, "run-a", "owner-a", now)).toBe(true);
    expect(await hasForeignActiveGroupRunLeaseForCanvas("canvas")).toBe(true);
    expect(await acquireGroupRunLease(scope, "run-b", "owner-b", now + 1)).toBe(false);
    expect(releaseGroupRunLease(scope, "run-a", "owner-a")).toBe(true);
    expect(await hasForeignActiveGroupRunLeaseForCanvas("canvas")).toBe(false);
    Object.defineProperty(fakeWindow, "navigator", {
      configurable: true,
      value: {},
    });
    expect(await acquireGroupRunLease(scope, "run-c", "owner-c", now + 2)).toBe(false);
  } finally {
    clearGroupRunStarting(scope, "run-a");
    if (previousWindow) host.window = previousWindow;
    else delete host.window;
  }
});

test("workflow render retention is targeted and never mutates canvas nodes", () => {
  const nodes: ProbeNodeType[] = [
    {
      id: "kept",
      type: "text",
      data: { label: "保活" },
      position: { x: 10, y: 20 },
      selected: true,
    },
    {
      id: "virtualized",
      type: "text",
      data: { label: "普通" },
      position: { x: 30, y: 40 },
    },
  ];
  const before = structuredClone(nodes);
  const rendered = retainWorkflowNodesForRender(nodes, new Set(["kept"]));
  expect(nodes).toEqual(before);
  expect(rendered[0]).toMatchObject({
    className: "workflow-run-locked",
    connectable: false,
    deletable: false,
    dragging: true,
    draggable: false,
    position: { x: 10, y: 20 },
    selectable: false,
    selected: false,
    style: { pointerEvents: "none" },
  });
  expect(rendered[1]).toBe(nodes[1]);
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

test("group persist waits for paint and save before the next node can start", async () => {
  const events: string[] = [];
  const persist = async () => {
    events.push("persist");
    return undefined;
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

  const persistFailed = await runGroupNodeWithPersist({
    persist: async () => "画布保存超时，请稍后再试",
    run: async () => ({ status: "success" }),
  });
  expect(persistFailed).toEqual({
    message: "画布保存超时，请稍后再试",
    status: "failed",
  });

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
    flushCanvasSave: async () => {
      paintOrder.push("flush");
    },
    waitForCanvasRevision: async () => {
      paintOrder.push("wait");
      return 4;
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

test("group run mounts an offscreen Image for preflight and persists the real model error", async ({
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

test("running group locks child edits while the parent can leave the viewport", async ({
  page,
  request,
}) => {
  const modelId = `fixture-group-lock-${randomUUID()}`;
  const taskId = `fixture-group-lock-task-${randomUUID()}`;
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = await created.json() as { id: string };
  const parameterSchema = defaultParameterSchema("text");
  const baseTask = {
    attempt: 1,
    canvasId: project.id,
    costCurrency: "CNY" as const,
    createdAt: "2026-08-20T00:00:00.000Z",
    id: taskId,
    kind: "text" as const,
    model: modelId,
    nodeId: "run-text",
    prompt: "生成一段运行中测试文案",
    updatedAt: "2026-08-20T00:00:01.000Z",
  };
  let taskPostSeen = false;
  await page.route("**/api/models", async (route) => {
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
  await page.route("**/api/generation-tasks**", async (route) => {
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
      taskPostSeen = true;
      await route.fulfill({
        contentType: "application/json",
        json: { ...baseTask, state: "running" },
        status: 202,
      });
      return;
    }
    if (
      requestUrl.pathname === `/api/generation-tasks/${taskId}` &&
      method === "GET"
    ) {
      await route.fulfill({
        contentType: "application/json",
        json: { ...baseTask, state: "running" },
        status: 200,
      });
      return;
    }
    if (requestUrl.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [{ ...baseTask, state: "running" }] },
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

  const readCanvasNodes = async () => {
    const response = await request.get(`/api/canvas/${project.id}`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as {
      nodes: Array<{
        id: string;
        position: { x: number; y: number };
      }>;
    };
  };

  try {
    const saveMetadata = await existingCanvasSaveMetadata(request, project.id);
    const saved = await request.put(`/api/canvas/${project.id}`, {
      data: {
        edges: [],
        nodes: [{
          data: { label: "Group", title: "运行中锁定组" },
          id: "run-group",
          position: { x: 180, y: 120 },
          style: { height: 620, width: 720 },
          type: "group",
          zIndex: 0,
        }, {
          data: {
            label: "Text",
            textModelId: modelId,
            textParameters: {},
            textPrompt: "生成一段运行中测试文案",
            textPromptReady: true,
            title: "运行中子节点",
          },
          id: "run-text",
          parentId: "run-group",
          position: { x: 32, y: 70 },
          style: { height: 220, width: 300 },
          type: "text",
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
    await page.locator('[data-testid="rf__node-run-group"]').click({
      position: { x: 8, y: 8 },
    });
    const execute = page.getByTestId("group-execute-button");
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect.poll(() => taskPostSeen).toBe(true);
    await expect(canvas).toHaveAttribute("data-workflow-run-active", "true");

    await expect(page.getByRole("button", { name: "组合框颜色" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "组合框布局" })).toBeDisabled();
    await expect(page.getByTestId("group-template-button")).toBeDisabled();
    await expect(page.getByRole("button", { name: "解组" })).toBeDisabled();
    await expect(page.getByTestId("group-execute-button")).toHaveText("停止后续");

    const child = page.locator('[data-testid="rf__node-run-text"]');
    await expect(child).toHaveCount(1);
    await expect.poll(() => child.evaluate((element) => ({
      className: element.className,
      pointerEvents: getComputedStyle(element).pointerEvents,
    }))).toEqual({
      className: expect.stringContaining("workflow-run-locked"),
      pointerEvents: "none",
    });

    await page.keyboard.press("Meta+c");
    const beforeCommands = await canvas.evaluate((element) => ({
      nodeCount: element.getAttribute("data-node-count"),
      selectedCount: element.getAttribute("data-selected-node-count"),
    }));
    for (const shortcut of ["Meta+a", "Meta+v", "Meta+x", "Meta+z", "Meta+Shift+z"]) {
      await page.keyboard.press(shortcut);
    }
    await expect(canvas).toHaveAttribute("data-node-count", beforeCommands.nodeCount ?? "");
    await expect(canvas).toHaveAttribute(
      "data-selected-node-count",
      beforeCommands.selectedCount ?? "",
    );

    await page.getByTestId("tasks").click();
    await expect(page.getByTestId("tasks-panel")).toBeVisible();
    await expect(page.getByTestId("tasks-group-summary")).toHaveAttribute(
      "data-status",
      "running",
    );

    const body = page.getByTestId("group-node-run-group");
    const box = await body.boundingBox();
    if (!box) throw new Error("running group body is not mounted");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(-800, -500, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => {
      const current = await readCanvasNodes();
      return current.nodes.find((node) => node.id === "run-group")?.position.x ?? 0;
    }).toBeLessThan(-200);
    await expect(canvas).toHaveAttribute("data-workflow-run-active", "true");
    await expect(page.getByTestId("tasks-group-summary")).toHaveAttribute(
      "data-status",
      "running",
    );
    // The parent may be virtualized after leaving the viewport, but renderer
    // retention keeps the active child mounted and non-interactive.
    await expect(child).toHaveCount(1);
    await page.getByTestId("tasks-group-stop").click();
    await expect(page.getByTestId("tasks-group-summary")).toHaveAttribute(
      "data-status",
      "stopping",
    );
    await expect(page.getByTestId("tasks-group-stop")).toBeDisabled();
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
