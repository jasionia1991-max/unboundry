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
import {
  createSaveGateRun,
  runExclusiveCanvasSubmit,
} from "../client/src/generation/saveGate";
import {
  isCanvasNotSavedMessage,
  persistGroupCanvasAfterNode,
  runGroupNodeWithPersist,
  shouldAcceptCanvasRevision,
  workflowToastDurationMs,
} from "../client/src/generation/groupRunPersist";
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
    message: "整组执行已取消",
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

test("group run persists an incompatible Image model error without creating a task", async ({
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
          style: { height: 700, width: 700 },
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
          position: { x: 370, y: 60 },
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
    await expect(page.getByTestId("image-node-target-image").getByRole("alert"))
      .toContainText(expectedMessage);
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
