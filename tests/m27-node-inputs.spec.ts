import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  NODE_INPUT_MATRIX,
  isNodeInputConnectionAllowed,
  moveNodeInputEdge,
  resolveNodeInputs,
} from "../types/nodeInputs";
import {
  cleanParameterSchema,
  defaultParameterSchema,
  knownModelParameterSchema,
} from "../types/modelParameters";
import { canvasDocumentFingerprint } from "../client/src/canvas/canvasDocumentFingerprint";
import { persistedNodeOwnPrompt } from "../server/inputPreflight";

function zeroProviderInputSchema() {
  const schema = knownModelParameterSchema({
    capability: "image",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
  });
  return {
    ...schema,
    referenceInputs: { ...schema.referenceInputs, image: 4 },
    referencePolicy: {
      modeKey: "inputMode",
      modes: {
        image: {
          sets: [{ audio: 0, image: 4, video: 0 }],
        },
        text: {
          sets: [{ audio: 0, image: 0, video: 0 }],
        },
      },
    },
  };
}

async function connectNodes(page: Page, sourceId: string, targetId: string) {
  const source = page.locator(
    `.react-flow__node[data-id="${sourceId}"] .react-flow__handle.source .node-handle-hit`,
  );
  const target = page.locator(
    `.react-flow__node[data-id="${targetId}"] .react-flow__handle.target .node-handle-hit`,
  );
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

async function ensureZeroProviderInputModel(request: APIRequestContext) {
  const existingResponse = await request.get("/api/admin/models");
  const existing = await existingResponse.json() as {
    models: Array<{ displayName: string; id: string; status: string }>;
  };
  const found = existing.models.find(
    (model) => model.displayName === "零费用图片入参测试模型",
  );
  if (found) {
    const updated = await request.patch(`/api/admin/models/${found.id}`, {
      data: {
        isDefault: true,
        parameterSchema: zeroProviderInputSchema(),
        status: "published",
      },
    });
    expect(updated.ok()).toBeTruthy();
    zeroModelIds.add(found.id);
    return found.id;
  }
  const createdResponse = await request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "零费用图片入参测试模型",
      isDefault: true,
      maxCostMicrounits: 0,
      parameterSchema: zeroProviderInputSchema(),
      providerModelId: "fixture/image-input-model",
      providerProfileId: "provider-unconfigured",
      sortOrder: 1,
      status: "published",
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { model: { id: string } };
  zeroModelIds.add(created.model.id);
  return created.model.id;
}

function zeroProviderVideoSchema() {
  return {
    ...defaultParameterSchema("video"),
    referenceInputs: { audio: 0, image: 1, video: 0 },
  };
}

async function ensureZeroProviderVideoModel(request: APIRequestContext) {
  const existingResponse = await request.get("/api/admin/models");
  const existing = await existingResponse.json() as {
    models: Array<{ displayName: string; id: string; status: string }>;
  };
  const found = existing.models.find(
    (model) => model.displayName === "零费用视频入参测试模型",
  );
  if (found) {
    const updated = await request.patch(`/api/admin/models/${found.id}`, {
      data: {
        isDefault: true,
        maxCostMicrounits: 0,
        parameterSchema: zeroProviderVideoSchema(),
        status: "published",
      },
    });
    expect(updated.ok()).toBeTruthy();
    zeroModelIds.add(found.id);
    return found.id;
  }
  const createdResponse = await request.post("/api/admin/models", {
    data: {
      capability: "video",
      displayName: "零费用视频入参测试模型",
      isDefault: true,
      maxCostMicrounits: 0,
      parameterSchema: zeroProviderVideoSchema(),
      providerModelId: "fixture/video-input-model",
      providerProfileId: "provider-unconfigured",
      sortOrder: 1,
      status: "published",
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { model: { id: string } };
  zeroModelIds.add(created.model.id);
  return created.model.id;
}

const zeroModelIds = new Set<string>();
const garmentAssetId = "fixture-garment-image";

async function ensureGarmentAsset(request: APIRequestContext) {
  await request.delete(`/api/assets/${garmentAssetId}`);
  const bytes = await readFile(resolve(
    process.cwd(),
    "spec/reference/tapnow-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
  ));
  const uploaded = await request.post(`/api/assets/${garmentAssetId}`, {
    data: bytes,
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": "fixture-garment.png",
    },
  });
  expect(uploaded.status()).toBe(201);
}

test.afterAll(async ({ request }) => {
  await request.delete(`/api/assets/${garmentAssetId}`);
  for (const modelId of zeroModelIds) {
    const disabled = await request.patch(`/api/admin/models/${modelId}`, {
      data: { isDefault: false, status: "disabled" },
    });
    expect(disabled.ok()).toBeTruthy();
  }
});

async function useZeroProviderInputModel(
  page: Page,
  modelId = "fixture-image-input-model",
) {
  const parameterSchema = zeroProviderInputSchema();
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generationEnabled: false,
        models: [{
          capability: "image",
          displayName: "零费用图片入参测试模型",
          generationAvailable: false,
          id: modelId,
          imageParameters: {
            aspectRatios: ["auto"],
            maxReferenceImages: 4,
            qualities: ["auto"],
          },
          isDefault: true,
          parameterSchema,
        }],
      }),
      status: 200,
    });
  });
}

test("canvas fingerprint covers durable graph state but ignores interaction chrome", () => {
  const base = {
    edges: [{ id: "e1", source: "a", target: "b", data: { inputOrder: 1 } }],
    nodes: [{ id: "a", position: { x: 1, y: 2 }, data: { content: "prompt" } }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const fingerprint = canvasDocumentFingerprint(base);
  expect(canvasDocumentFingerprint({
    ...base,
    edges: [{ ...base.edges[0], selected: true, data: { inputOrder: 1, cutIndicator: "hover" } }],
    nodes: [{ ...base.nodes[0], selected: true, dragging: true, measured: { width: 20, height: 20 } }],
  })).toBe(fingerprint);
  expect(canvasDocumentFingerprint({
    ...base,
    nodes: [{ ...base.nodes[0], data: { content: "changed" } }],
  })).not.toBe(fingerprint);
  expect(canvasDocumentFingerprint({
    ...base,
    edges: [{ ...base.edges[0], data: { inputOrder: 2 } }],
  })).not.toBe(fingerprint);
  expect(canvasDocumentFingerprint({
    ...base,
    viewport: { x: 20, y: 0, zoom: 1 },
  })).not.toBe(fingerprint);
});

test("product node input matrix contains exactly 11 allowed and 5 forbidden pairs", () => {
  const kinds = ["text", "image", "video", "audio"] as const;
  const results = kinds.flatMap((source) => kinds.map((target) => ({
    allowed: isNodeInputConnectionAllowed(source, target),
    source,
    target,
  })));
  expect(results.filter((item) => item.allowed)).toHaveLength(11);
  expect(results.filter((item) => !item.allowed)).toHaveLength(5);
  expect(NODE_INPUT_MATRIX.text).toEqual(["text", "image", "video", "audio"]);
  expect(results.filter((item) => !item.allowed).map(({ source, target }) => `${source}->${target}`))
    .toEqual(["image->audio", "video->image", "video->audio", "audio->image", "audio->audio"]);
});

test("shared input ordering compacts durable edge order without changing graph topology", () => {
  const edges = [
    { data: { inputOrder: 7, inputRole: "instruction" }, id: "text", source: "a", target: "target" },
    { data: { inputOrder: 11, inputRole: "reference-image" }, id: "image", source: "b", target: "target" },
    { data: { inputOrder: 1 }, id: "other", source: "c", target: "other-target" },
  ];
  const moved = moveNodeInputEdge(edges, "target", "image", "backward");
  expect(moved.map((edge) => edge.id)).toEqual(["text", "image", "other"]);
  expect(moved.find((edge) => edge.id === "image")?.data).toEqual({
    inputOrder: 1,
    inputRole: "reference-image",
  });
  expect(moved.find((edge) => edge.id === "text")?.data).toEqual({
    inputOrder: 2,
    inputRole: "instruction",
  });
  expect(moved.find((edge) => edge.id === "other")).toBe(edges[2]);
  expect(moveNodeInputEdge(moved, "target", "image", "backward")).toEqual(moved);
});

test("moving multiple Text references changes the final Prompt in the same durable order", () => {
  const nodes = [
    { data: { content: "母版A" }, id: "text-a", type: "text" },
    { data: { content: "母版B" }, id: "text-b", type: "text" },
    { data: {}, id: "target", type: "image" },
  ];
  const edges = [
    { data: { inputOrder: 1, inputRole: "instruction" }, id: "a", source: "text-a", target: "target" },
    { data: { inputOrder: 2, inputRole: "instruction" }, id: "b", source: "text-b", target: "target" },
  ];
  const before = resolveNodeInputs({
    edges,
    nodes,
    ownPrompt: "本节点",
    targetId: "target",
    targetKind: "image",
  });
  expect(before.finalPrompt).toBe("母版A\n\n母版B\n\n本节点");
  const after = resolveNodeInputs({
    edges: moveNodeInputEdge(edges, "target", "b", "backward"),
    nodes,
    ownPrompt: "本节点",
    targetId: "target",
    targetKind: "image",
  });
  expect(after.finalPrompt).toBe("母版B\n\n母版A\n\n本节点");
});

test("server prompt fields cover Text Image Video and Audio target nodes", () => {
  expect([
    persistedNodeOwnPrompt({ data: { textPrompt: "  文字指令  " } }, "text"),
    persistedNodeOwnPrompt({ data: { imagePrompt: "  图片指令  " } }, "image"),
    persistedNodeOwnPrompt({ data: { videoPrompt: "  视频指令  " } }, "video"),
    persistedNodeOwnPrompt({ data: { audioPrompt: "  音频指令  " } }, "audio"),
  ]).toEqual(["文字指令", "图片指令", "视频指令", "音频指令"]);
});

test("edge-only resolver merges prompt and stores stable source metadata without URLs", () => {
  const result = resolveNodeInputs({
    edges: [
      { id: "e-text", source: "source-text", target: "target", data: { inputOrder: 1 } },
      { id: "e-image", source: "source-image", target: "target", data: { inputOrder: 2 } },
    ],
    nodes: [
      { id: "source-text", type: "text", data: { content: "电商白底图母版", title: "母版" } },
      {
        id: "source-image",
        type: "image",
        data: { assetId: "asset-garment", imageSrc: "https://signed.example/short", title: "服装" },
      },
      { id: "target", type: "image", data: { title: "目标" } },
    ],
    ownPrompt: "正面平铺",
    targetId: "target",
    targetKind: "image",
  });
  expect(result.canSubmit).toBeTruthy();
  expect(result.finalPrompt).toBe("电商白底图母版\n\n正面平铺");
  expect(result.snapshot).toEqual([
    { kind: "text", order: 1, role: "instruction", sourceNodeId: "source-text" },
    { assetId: "asset-garment", kind: "image", order: 2, role: "reference-image", sourceNodeId: "source-image" },
  ]);
  expect(JSON.stringify(result.snapshot)).not.toContain("signed.example");
});

test("full upstream text reaches final Prompt while card summaries stay compact", () => {
  const upstream = Array.from(
    { length: 18 },
    (_, index) => `第${index + 1}段白底商品拍摄要求，保留面料纹理和版型。`,
  ).join("\n");
  expect(upstream.length).toBeGreaterThan(120);
  const result = resolveNodeInputs({
    edges: [{ id: "full-text", source: "source-text", target: "target" }],
    nodes: [
      { id: "source-text", type: "text", data: { content: upstream, title: "母版" } },
      { id: "target", type: "image" },
    ],
    ownPrompt: "正面平铺",
    targetId: "target",
    targetKind: "image",
  });
  expect(result.canSubmit).toBeTruthy();
  expect(result.finalPrompt).toBe(`${upstream}\n\n正面平铺`);
  expect(result.inputs[0].summary).toHaveLength(120);
  expect(result.snapshot).toEqual([
    { kind: "text", order: 1, role: "instruction", sourceNodeId: "source-text" },
  ]);
});

test("OpenRouter text mode keeps an image edge visible but blocks submission", () => {
  const result = resolveNodeInputs({
    edges: [{ id: "kept-image", source: "source-image", target: "target" }],
    modelSchema: knownModelParameterSchema({
      capability: "image",
      providerDriver: "openrouter",
      providerModelId: "openai/gpt-image-2",
    }),
    nodes: [
      {
        id: "source-image",
        type: "image",
        data: { assetId: "asset-image", imageSrc: "/api/assets/asset-image" },
      },
      { id: "target", type: "image" },
    ],
    ownPrompt: "白底商品图",
    parameters: { inputMode: "text" },
    targetId: "target",
    targetKind: "image",
  });
  expect(result.inputs.map(({ edgeId }) => edgeId)).toEqual(["kept-image"]);
  expect(result.problems).toContainEqual(expect.objectContaining({
    code: "MODEL_UNSUPPORTED",
  }));
  expect(result.canSubmit).toBeFalsy();
});

test("resolver exposes empty, uploading, ready, invalid and missing without deleting edges", () => {
  const result = resolveNodeInputs({
    edges: [
      { id: "empty", source: "empty", target: "target" },
      { id: "uploading", source: "uploading", target: "target" },
      { id: "ready", source: "ready", target: "target" },
      { id: "invalid", source: "invalid", target: "target" },
      {
        data: { inputOrder: 6, inputRole: "context-text" },
        id: "missing",
        source: "missing",
        target: "target",
      },
    ],
    nodes: [
      { id: "empty", type: "text", data: { content: "" } },
      { id: "uploading", type: "image", data: { inputState: "uploading" } },
      { id: "ready", type: "video", data: { assetId: "v1", videoSrc: "/video/v1" } },
      { id: "invalid", type: "audio", data: { assetId: "a1" } },
      { id: "target", type: "text" },
    ],
    targetId: "target",
    targetKind: "text",
  });
  expect(result.inputs.map((input) => input.state)).toEqual([
    "empty",
    "uploading",
    "ready",
    "invalid",
    "missing",
  ]);
  expect(result.inputs.map((input) => input.edgeId)).toEqual([
    "empty",
    "uploading",
    "ready",
    "invalid",
    "missing",
  ]);
  expect(result.inputs.at(-1)).toMatchObject({
    edgeId: "missing",
    order: 6,
    role: "context-text",
  });
});

test("administrator model schema keeps roles, required counts and switch policy", () => {
  const schema = cleanParameterSchema("image", {
    ...defaultParameterSchema("image"),
    inputPolicy: {
      required: { image: 1, text: 1 },
      roles: { image: ["reference-image"], text: ["instruction"] },
      switchPolicy: "keep-edge",
    },
  });
  expect(schema.inputPolicy).toEqual({
    required: { image: 1, text: 1 },
    roles: { image: ["reference-image"], text: ["instruction"] },
    switchPolicy: "keep-edge",
  });
});

test("generation submission cannot bypass persisted-edge preflight by omitting the schema version", async ({
  request,
}) => {
  const modelId = await ensureZeroProviderInputModel(request);
  const canvasId = `node-input-bypass-${Date.now()}`;
  const saved = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [{
        id: "forbidden-audio-image",
        source: "client-hidden-audio",
        target: "server-image-target",
      }],
      nodes: [
        {
          data: {
            assetId: "audio-from-canvas",
            audioSrc: "https://signed.example/short-audio",
            title: "音频来源",
          },
          id: "client-hidden-audio",
          type: "audio",
        },
        {
          data: { imagePrompt: "画布中的真实提示词" },
          id: "server-image-target",
          type: "image",
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();
  const { revision: canvasRevision } = await saved.json() as { revision: number };
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };

  const requestData = {
    canvasId,
    canvasRevision,
    idempotencyKey: `bypass-${Date.now()}`,
    inputs: [{
      kind: "text",
      order: 1,
      role: "instruction",
      sourceNodeId: "made-up-client-source",
    }],
    kind: "image",
    model: modelId,
    nodeId: "server-image-target",
    parameters: { references: [] },
    prompt: "前端声称可提交",
  };
  const structural = await request.post("/api/generation-tasks/preflight", {
    data: requestData,
  });
  expect(structural.ok()).toBeTruthy();
  const structuralBody = await structural.json() as {
    canSubmit: boolean;
    problems: Array<{ code: string; edgeId?: string }>;
  };
  expect(structuralBody.canSubmit).toBeFalsy();

  const submission = await request.post("/api/generation-tasks", {
    data: requestData,
  });
  expect(submission.status()).toBe(409);
  const submissionBody = await submission.json() as {
    code: string;
    problems: Array<{ code: string; edgeId?: string }>;
  };
  expect(submissionBody).toMatchObject({
    code: "INPUT_INVALID",
    problems: [{ code: "INVALID", edgeId: "forbidden-audio-image" }],
  });
  expect(submissionBody.problems.map(({ code }) => code)).toEqual(
    structuralBody.problems.map(({ code }) => code),
  );
  const tasks = await (await request.get(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
  )).json() as { tasks: unknown[] };
  expect(tasks.tasks).toEqual([]);
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
});

test("server reads the persisted target Prompt and rejects a forged v1 ownPrompt without tasks", async ({
  request,
}) => {
  const modelId = await ensureZeroProviderInputModel(request);
  const canvasId = `node-input-persisted-prompt-${Date.now()}`;
  const persistedPrompt = "已保存的商品白底图指令";
  const forgedPrompt = "客户端伪造的本节点Prompt";
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };

  try {
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [],
        nodes: [{
          data: { imagePrompt: persistedPrompt, imagePromptReady: true },
          id: "persisted-prompt-target",
          type: "image",
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const canvasRevision = (await saved.json() as { graphRevision: number }).graphRevision;
    const base = {
      canvasId,
      canvasRevision,
      inputSchemaVersion: 1,
      kind: "image",
      model: modelId,
      nodeId: "persisted-prompt-target",
      parameters: { inputMode: "text" },
      prompt: "客户端伪造的最终Prompt",
    };

    const acceptedPreflight = await request.post("/api/generation-tasks/preflight", {
      data: { ...base, ownPrompt: persistedPrompt },
    });
    expect(acceptedPreflight.ok()).toBeTruthy();
    await expect(acceptedPreflight.json()).resolves.toMatchObject({
      canSubmit: true,
      finalPrompt: persistedPrompt,
      providerRequests: 0,
    });

    const forgedPreflight = await request.post("/api/generation-tasks/preflight", {
      data: { ...base, ownPrompt: forgedPrompt },
    });
    expect(forgedPreflight.status()).toBe(409);
    await expect(forgedPreflight.json()).resolves.toMatchObject({
      code: "CANVAS_NOT_SAVED",
      revision: canvasRevision,
    });

    const forgedSubmission = await request.post("/api/generation-tasks", {
      data: {
        ...base,
        idempotencyKey: `forged-prompt-${Date.now()}`,
        ownPrompt: forgedPrompt,
      },
    });
    expect(forgedSubmission.status()).toBe(409);
    await expect(forgedSubmission.json()).resolves.toMatchObject({
      code: "CANVAS_NOT_SAVED",
      revision: canvasRevision,
    });

    const tasks = await (await request.get(
      `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
    )).json() as { tasks: unknown[] };
    expect(tasks.tasks).toEqual([]);
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  } finally {
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

test("server rejects forged ready media, invalid role/order and a stale canvas without tasks", async ({
  request,
}) => {
  const modelId = await ensureZeroProviderInputModel(request);
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };

  const roleCanvasId = `node-input-role-order-${Date.now()}`;
  const roleSave = await request.put(`/api/canvas/${roleCanvasId}`, {
    data: {
      edges: [{
        data: { inputOrder: 0, inputRole: "context-text" },
        id: "invalid-metadata",
        source: "instruction",
        target: "target",
      }],
      nodes: [
        { data: { content: "白底商品图" }, id: "instruction", type: "text" },
        { data: { imagePrompt: "正面平铺" }, id: "target", type: "image" },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(roleSave.ok()).toBeTruthy();
  const roleRevision = (await roleSave.json() as { revision: number }).revision;
  const roleBody = {
    canvasId: roleCanvasId,
    canvasRevision: roleRevision,
    idempotencyKey: `role-order-${Date.now()}`,
    inputSchemaVersion: 1,
    kind: "image",
    model: modelId,
    nodeId: "target",
    ownPrompt: "正面平铺",
    parameters: {},
    prompt: "前端声称可提交",
  };
  const rolePreflight = await request.post("/api/generation-tasks/preflight", {
    data: roleBody,
  });
  expect(rolePreflight.ok()).toBeTruthy();
  const roleProblems = (await rolePreflight.json() as {
    problems: Array<{ code: string }>;
  }).problems.map(({ code }) => code);
  expect(roleProblems).toEqual(expect.arrayContaining([
    "ORDER_INVALID",
    "ROLE_UNSUPPORTED",
  ]));
  const roleSubmit = await request.post("/api/generation-tasks", {
    data: roleBody,
  });
  expect(roleSubmit.status()).toBe(409);
  await expect(roleSubmit.json()).resolves.toMatchObject({ code: "INPUT_INVALID" });

  const forgedCanvasId = `node-input-forged-ready-${Date.now()}`;
  const forgedSave = await request.put(`/api/canvas/${forgedCanvasId}`, {
    data: {
      edges: [{ id: "forged-ready", source: "missing-image", target: "target" }],
      nodes: [
        {
          data: {
            assetId: "asset-that-does-not-exist",
            imageSrc: "/api/assets/asset-that-does-not-exist",
            inputState: "ready",
          },
          id: "missing-image",
          type: "image",
        },
        { data: { imagePrompt: "白底商品图" }, id: "target", type: "image" },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(forgedSave.ok()).toBeTruthy();
  const forgedRevision = (await forgedSave.json() as { revision: number }).revision;
  const forgedSubmit = await request.post("/api/generation-tasks", {
    data: {
      canvasId: forgedCanvasId,
      canvasRevision: forgedRevision,
      idempotencyKey: `forged-ready-${Date.now()}`,
      inputSchemaVersion: 1,
      kind: "image",
      model: modelId,
      nodeId: "target",
      ownPrompt: "白底商品图",
      parameters: {},
      prompt: "前端声称素材存在",
    },
  });
  expect(forgedSubmit.status()).toBe(409);
  const forgedResult = await forgedSubmit.json() as {
    code: string;
    problems: Array<{ code: string; edgeId?: string }>;
  };
  expect(forgedResult).toMatchObject({
    code: "INPUT_INVALID",
    problems: expect.arrayContaining([
      expect.objectContaining({ code: "INVALID", edgeId: "forged-ready" }),
    ]),
  });

  const staleCanvasId = `node-input-stale-${Date.now()}`;
  const staleCreate = await request.put(`/api/canvas/${staleCanvasId}`, {
    data: {
      edges: [],
      nodes: [{ data: { imagePrompt: "白底商品图" }, id: "target", type: "image" }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(staleCreate.ok()).toBeTruthy();
  const staleRevision = (await staleCreate.json() as { revision: number }).revision;
  const staleAdvance = await request.put(`/api/canvas/${staleCanvasId}`, {
    data: {
      edges: [],
      nodes: [{
        data: { imagePrompt: "白底商品图", title: "已保存的新版本" },
        id: "target",
        type: "image",
      }],
      revision: staleRevision,
      viewport: { x: 1, y: 0, zoom: 1 },
    },
  });
  expect(staleAdvance.ok()).toBeTruthy();
  const staleSubmit = await request.post("/api/generation-tasks", {
    data: {
      canvasId: staleCanvasId,
      canvasRevision: staleRevision,
      idempotencyKey: `stale-${Date.now()}`,
      inputSchemaVersion: 1,
      kind: "image",
      model: modelId,
      nodeId: "target",
      ownPrompt: "白底商品图",
      parameters: {},
      prompt: "旧版本内容",
    },
  });
  expect(staleSubmit.status()).toBe(409);
  await expect(staleSubmit.json()).resolves.toMatchObject({
    code: "CANVAS_NOT_SAVED",
  });

  for (const canvasId of [roleCanvasId, forgedCanvasId, staleCanvasId]) {
    const tasks = await (await request.get(
      `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
    )).json() as { tasks: unknown[] };
    expect(tasks.tasks).toEqual([]);
  }
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
});

test("allowed Video media edges pass zero-cost preflight without creating a task", async ({
  request,
}) => {
  const modelId = await ensureZeroProviderVideoModel(request);
  await ensureGarmentAsset(request);
  const canvasId = `node-input-video-reference-${Date.now()}`;
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const save = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [{ id: "kept-image-video", source: "source-image", target: "target-video" }],
      nodes: [
        {
          data: {
            assetId: garmentAssetId,
            imageSrc: `/api/assets/${garmentAssetId}`,
          },
          id: "source-image",
          type: "image",
        },
        {
          data: { videoPrompt: "让服装轻微转动" },
          id: "target-video",
          type: "video",
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(save.ok()).toBeTruthy();
  const revision = (await save.json() as { revision: number }).revision;
  const body = {
    canvasId,
    canvasRevision: revision,
    idempotencyKey: `video-reference-${Date.now()}`,
    inputSchemaVersion: 1,
    kind: "video",
    model: modelId,
    nodeId: "target-video",
    ownPrompt: "让服装轻微转动",
    parameters: {},
    prompt: "让服装轻微转动",
  };
  const preflightResponse = await request.post("/api/generation-tasks/preflight", {
    data: body,
  });
  expect(preflightResponse.ok()).toBeTruthy();
  const preflight = await preflightResponse.json() as {
    canEnqueue: boolean;
    canSubmit: boolean;
    costCurrency: string;
    estimatedCostMicrounits: number;
    inputs: Array<{ edgeId: string }>;
    problems: Array<{ code: string }>;
    provider: { adapterSupported: boolean; configured: boolean };
    providerBalance: { checked: boolean; status: string };
    providerRequests: number;
    safetyAdmission: { allowed: boolean };
  };
  expect(preflight.inputs.map(({ edgeId }) => edgeId)).toEqual(["kept-image-video"]);
  expect(preflight.canSubmit).toBeTruthy();
  expect(preflight.canEnqueue).toBeFalsy();
  expect(preflight.costCurrency).toBe("USD");
  expect(preflight.estimatedCostMicrounits).toBe(0);
  expect(preflight.problems).toEqual([]);
  expect(preflight.provider).toEqual({
    adapterSupported: false,
    configured: false,
  });
  expect(preflight.providerBalance).toMatchObject({
    checked: false,
    status: "not-checked",
  });
  expect(typeof preflight.safetyAdmission.allowed).toBe("boolean");
  expect(preflight.providerRequests).toBe(0);
  const submit = await request.post("/api/generation-tasks", { data: body });
  expect(submit.status()).toBe(503);
  const tasks = await (await request.get(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
  )).json() as { tasks: unknown[] };
  expect(tasks.tasks).toEqual([]);
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
});

test("forbidden typed drop creates no edge and keeps the source-aware menu open", async ({ page }) => {
  await page.goto("/__fixture/interaction.typed-input-matrix");
  const world = page.getByTestId("canvas-world");
  const sourceNode = page.locator('.react-flow__node[data-id="typed-audio-source"]');
  const source = sourceNode.locator(".react-flow__handle.source .node-handle-hit");
  const target = page.locator('.react-flow__node[data-id="typed-image-target"]');
  await sourceNode.click();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(page.getByTestId("source-connect-menu")).toHaveAttribute("data-source-kind", "audio");
});

test("first ready Image edge switches an Image target mode with the edge and persists Text plus Image cards", async ({
  page,
  request,
}) => {
  const canvasId = "node.image.empty";
  const modelId = "fixture-image-first-reference-mode";
  await ensureGarmentAsset(request);
  await useZeroProviderInputModel(page, modelId);
  await request.delete(`/api/canvas/${canvasId}`);
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
      taskPosts.push(entry.url());
    }
  });

  const saved = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [],
      nodes: [
        {
          data: {
            content: "电商白底产品图，保留材质和版型。",
            label: "Text",
            title: "白底图母版",
          },
          id: "first-mode-text",
          position: { x: -160, y: 80 },
          style: { height: 250, width: 250 },
          type: "text",
        },
        {
          data: {
            assetId: garmentAssetId,
            imageSrc: `/api/assets/${garmentAssetId}`,
            label: "Image",
            title: "服装照片",
          },
          id: "first-mode-image",
          position: { x: 220, y: 80 },
          style: { height: 300, width: 225 },
          type: "image",
        },
        {
          data: {
            imageModelId: modelId,
            imageParameters: { inputMode: "text" },
            imagePrompt: "正面平铺。",
            imagePromptReady: true,
            label: "Image",
            title: "商品白底图",
          },
          id: "first-mode-target",
          position: { x: 900, y: 80 },
          style: { height: 300, width: 300 },
          type: "image",
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.locator('.react-flow__node[data-id="first-mode-target"]').click();
  const creator = page.getByTestId("image-creator");
  await expect(creator.getByRole("button", { exact: true, name: "文本" }))
    .toBeVisible();
  await page.mouse.click(600, 250);
  await expect(creator).toHaveCount(0);

  await connectNodes(page, "first-mode-text", "first-mode-target");
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await page.mouse.click(600, 250);
  await expect(creator).toHaveCount(0);
  await connectNodes(page, "first-mode-image", "first-mode-target");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await page.locator('.react-flow__node[data-id="first-mode-target"]').click();
  await expect(creator.getByRole("button", { exact: true, name: "图片参考" }))
    .toBeVisible();
  const cards = page.getByTestId("image-creator-references");
  await expect(cards.locator(":scope > div")).toHaveCount(2);
  await expect(cards.locator('[data-input-role="instruction"]')).toHaveCount(1);
  await expect(cards.locator('[data-input-role="reference-image"]')).toHaveCount(1);
  await expect(page.getByTestId("image-final-prompt")).toContainText("母版 + 本节点补充");

  await page.keyboard.press("Meta+z");
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await page.locator('.react-flow__node[data-id="first-mode-target"]').click();
  await expect(creator.getByRole("button", { exact: true, name: "文本" }))
    .toBeVisible();
  await expect(cards.locator(":scope > div")).toHaveCount(1);

  await page.mouse.click(600, 250);
  await connectNodes(page, "first-mode-image", "first-mode-target");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await page.locator('.react-flow__node[data-id="first-mode-target"]').click();
  await expect(creator.getByRole("button", { exact: true, name: "图片参考" }))
    .toBeVisible();
  await cards.getByRole("button", { name: "删除引用 服装照片" }).click();
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await expect(creator.getByRole("button", { exact: true, name: "图片参考" }))
    .toBeVisible();
  await page.keyboard.press("Meta+z");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect(cards.locator(":scope > div")).toHaveCount(2);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const persisted = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
    edges: unknown[];
    nodes: Array<{ data: { imageParameters?: { inputMode?: string } }; id: string }>;
  };
  expect(persisted.edges).toHaveLength(2);
  expect(persisted.nodes.find(({ id }) => id === "first-mode-target")?.data.imageParameters)
    .toMatchObject({ inputMode: "image" });

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.locator('.react-flow__node[data-id="first-mode-target"]').click();
  await expect(page.getByTestId("image-creator-references").locator(":scope > div"))
    .toHaveCount(2);
  await expect(page.getByTestId("image-creator")
    .getByRole("button", { exact: true, name: "图片参考" }))
    .toBeVisible();
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(taskPosts).toEqual([]);
});

test("Image Text+Image input cards merge, delete, undo and survive refresh with zero Provider requests", async ({
  page,
  request,
}) => {
  const modelId = await ensureZeroProviderInputModel(request);
  await ensureGarmentAsset(request);
  await useZeroProviderInputModel(page, modelId);
  await request.delete("/api/canvas/node.image.text-image-input");
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
      taskPosts.push(entry.url());
    }
  });

  await page.goto("/__fixture/node.image.text-image-input");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
  await expect(page.getByTestId("image-model-control")).toContainText(
    "零费用图片入参测试模型",
  );
  const cards = page.getByTestId("image-creator-references");
  await expect(cards.locator(":scope > div")).toHaveCount(2);
  await expect(cards.locator('[data-input-role="instruction"]')).toHaveCount(1);
  await expect(cards.locator('[data-input-role="reference-image"]')).toHaveCount(1);
  await expect(page.getByTestId("image-final-prompt")).toContainText("使用上游母版");
  await expect(page.getByTestId("image-final-prompt")).toContainText("电商白底产品图");

  await page.getByTestId("image-creator-prompt").fill("正面平铺，展示领口细节。");
  await expect(page.getByTestId("image-final-prompt")).toContainText("母版 + 本节点补充");
  await expect(page.getByTestId("image-final-prompt")).toContainText("正面平铺");

  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await cards.getByRole("button", { name: "删除引用 白底图提示词母版" }).click();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-edge-count", "1");
  await expect(cards.locator('[data-input-kind="text"]')).toHaveCount(0);
  await expect(page.getByTestId("image-final-prompt")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  const ownOnlyResponse = await request.post("/api/generation-tasks/preflight", {
    data: {
      canvasId: "node.image.text-image-input",
      kind: "image",
      model: modelId,
      nodeId: "input-target-image",
      ownPrompt: "正面平铺，展示领口细节。",
      parameters: { inputMode: "image" },
    },
  });
  expect(ownOnlyResponse.ok()).toBeTruthy();
  await expect(ownOnlyResponse.json()).resolves.toMatchObject({
    finalPrompt: "正面平铺，展示领口细节。",
    providerRequests: 0,
    snapshot: [{
      assetId: garmentAssetId,
      kind: "image",
      order: 2,
      role: "reference-image",
      sourceNodeId: "input-garment-image",
    }],
  });
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-edge-count", "2");
  await expect(cards.locator('[data-input-kind="text"]')).toHaveCount(1);
  await expect(page.getByTestId("image-final-prompt")).toContainText("母版 + 本节点补充");
  await expect(page.getByTestId("image-final-prompt")).toContainText("电商白底产品图");

  await cards.getByRole("button", { name: "删除引用 服装照片" }).click();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-edge-count", "1");
  await expect.poll(async () => {
    const document = await (await request.get("/api/canvas/node.image.text-image-input")).json() as {
      edges: unknown[];
    };
    return document.edges.length;
  }).toBe(1);
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-edge-count", "2");
  await expect.poll(async () => {
    const document = await (await request.get("/api/canvas/node.image.text-image-input")).json() as {
      edges: unknown[];
    };
    return document.edges.length;
  }).toBe(2);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const preflightResponse = await request.post("/api/generation-tasks/preflight", {
    data: {
      canvasId: "node.image.text-image-input",
      kind: "image",
      model: modelId,
      nodeId: "input-target-image",
      ownPrompt: "正面平铺，展示领口细节。",
      parameters: { inputMode: "image" },
    },
  });
  expect(preflightResponse.ok()).toBeTruthy();
  const preflight = await preflightResponse.json() as {
    canSubmit: boolean;
    finalPrompt: string;
    providerRequests: number;
    modelId: string;
    snapshot: Array<Record<string, unknown>>;
  };
  expect(preflight.canSubmit).toBeTruthy();
  expect(preflight.finalPrompt).toContain("电商白底产品图");
  expect(preflight.finalPrompt).toContain("正面平铺");
  expect(preflight.snapshot).toHaveLength(2);
  expect(preflight.modelId).toBe(modelId);
  expect(preflight.providerRequests).toBe(0);
  expect(JSON.stringify(preflight.snapshot)).not.toContain("data:image");

  await page.reload();
  await expect(page.getByTestId("image-creator-references").locator(":scope > div")).toHaveCount(2);
  await expect(page.getByTestId("image-creator-prompt")).toHaveValue("正面平铺，展示领口细节。");
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(taskPosts).toEqual([]);
});

test("saved whole-node deletion followed by undo is durable across refresh", async ({
  page,
  request,
}) => {
  const modelId = await ensureZeroProviderInputModel(request);
  await ensureGarmentAsset(request);
  await useZeroProviderInputModel(page, modelId);
  await request.delete("/api/canvas/node.image.text-image-input");
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  await page.goto("/__fixture/node.image.text-image-input");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  const textNode = page.locator('.react-flow__node[data-id="input-master-text"]');
  await textNode.click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("Backspace");
  await expect(world).toHaveAttribute("data-node-count", "2");
  await expect.poll(async () => {
    const document = await (await request.get("/api/canvas/node.image.text-image-input")).json() as {
      edges: unknown[];
      nodes: unknown[];
    };
    return [document.nodes.length, document.edges.length];
  }).toEqual([2, 1]);

  await page.keyboard.press("Meta+z");
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect.poll(async () => {
    const document = await (await request.get("/api/canvas/node.image.text-image-input")).json() as {
      edges: unknown[];
      nodes: unknown[];
    };
    return [document.nodes.length, document.edges.length];
  }).toEqual([3, 2]);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const restoredDocument = await (await request.get(
    "/api/canvas/node.image.text-image-input",
  )).json() as {
    edges: Array<{ data?: { inputOrder?: number; inputRole?: string }; source: string; target: string }>;
    nodes: Array<{ data?: { content?: string; title?: string }; id: string; type: string }>;
  };
  const restoredTexts = restoredDocument.nodes.filter((node) => node.type === "text");
  expect(restoredTexts).toHaveLength(1);
  expect(restoredTexts[0].data).toMatchObject({
    content: "电商白底产品图，保留服装材质和版型，干净柔和棚拍光线。",
    title: "白底图提示词母版",
  });
  expect(restoredTexts[0].id).toMatch(/^input-master-text-restored-/);
  expect(restoredDocument.edges.filter((edge) => edge.source === restoredTexts[0].id))
    .toEqual([expect.objectContaining({
      data: { inputOrder: 1, inputRole: "instruction" },
      target: "input-target-image",
    })]);

  const restoredPreflight = await request.post("/api/generation-tasks/preflight", {
    data: {
      canvasId: "node.image.text-image-input",
      kind: "image",
      model: modelId,
      nodeId: "input-target-image",
      ownPrompt: "",
      parameters: { inputMode: "image" },
    },
  });
  expect(restoredPreflight.ok()).toBeTruthy();
  await expect(restoredPreflight.json()).resolves.toMatchObject({
    finalPrompt: "电商白底产品图，保留服装材质和版型，干净柔和棚拍光线。",
    providerRequests: 0,
    snapshot: [
      {
        kind: "text",
        order: 1,
        role: "instruction",
        sourceNodeId: restoredTexts[0].id,
      },
      {
        assetId: garmentAssetId,
        kind: "image",
        order: 2,
        role: "reference-image",
        sourceNodeId: "input-garment-image",
      },
    ],
  });

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect(page.locator('.react-flow__node[data-id^="input-master-text-restored-"]')).toHaveCount(1);
  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
});

test("pagehide latest snapshot wins when an older same-session save is still pending", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.image.text-image-input");
  let releaseOlderSave!: () => void;
  const olderSaveReleased = new Promise<void>((resolve) => {
    releaseOlderSave = resolve;
  });
  let markOlderSaveSeen!: () => void;
  const olderSaveSeen = new Promise<void>((resolve) => {
    markOlderSaveSeen = resolve;
  });
  let heldOlderSave = false;
  await page.route("**/api/canvas/node.image.text-image-input", async (route) => {
    const requestBody = route.request();
    if (requestBody.method() !== "PUT") {
      await route.continue();
      return;
    }
    const body = requestBody.postDataJSON() as { saveSequence?: number };
    if (body.saveSequence === 2 && !heldOlderSave) {
      heldOlderSave = true;
      markOlderSaveSeen();
      await olderSaveReleased;
    } else if (heldOlderSave && Number(body.saveSequence) >= 3) {
      releaseOlderSave();
    }
    await route.continue();
  });

  await page.goto("/__fixture/node.image.text-image-input");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.locator('.react-flow__node[data-id="input-master-text"]').click({
    position: { x: 12, y: 12 },
  });
  await page.keyboard.press("Backspace");
  await olderSaveSeen;
  await page.keyboard.press("Meta+z");
  await expect(world).toHaveAttribute("data-node-count", "3");

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
});

test("server orders same-session saves and keeps different-tab conflicts", async ({ request }) => {
  const canvasId = `persistence.sequence-${Date.now()}`;
  const url = `/api/canvas/${canvasId}`;
  const session = "session-12345678";
  const viewport = { x: 0, y: 0, zoom: 1 };
  const create = await request.put(url, {
    data: {
      edges: [],
      nodes: [{ id: "initial" }],
      revision: 0,
      saveSequence: 1,
      saveSessionId: session,
      viewport,
    },
  });
  expect(create.ok()).toBeTruthy();

  const older = await request.put(url, {
    data: {
      edges: [],
      nodes: [{ id: "older" }],
      revision: 1,
      saveSequence: 2,
      saveSessionId: session,
      viewport,
    },
  });
  expect(older.ok()).toBeTruthy();
  const newerFromStaleRevision = await request.put(url, {
    data: {
      edges: [],
      nodes: [{ id: "latest" }],
      revision: 1,
      saveSequence: 3,
      saveSessionId: session,
      viewport,
    },
  });
  expect(newerFromStaleRevision.ok()).toBeTruthy();

  const lateOlder = await request.put(url, {
    data: {
      edges: [],
      nodes: [{ id: "must-not-win" }],
      revision: 1,
      saveSequence: 2,
      saveSessionId: session,
      viewport,
    },
  });
  expect(lateOlder.status()).toBe(409);
  await expect(lateOlder.json()).resolves.toMatchObject({
    revision: 3,
    saveSequence: 3,
    saveSessionId: session,
  });
  const differentTab = await request.put(url, {
    data: {
      edges: [],
      nodes: [{ id: "other-tab" }],
      revision: 1,
      saveSequence: 99,
      saveSessionId: "different-session-1234",
      viewport,
    },
  });
  expect(differentTab.status()).toBe(409);
  const stored = await (await request.get(url)).json() as { nodes: Array<{ id: string }> };
  expect(stored.nodes).toEqual([{ id: "latest" }]);
});
