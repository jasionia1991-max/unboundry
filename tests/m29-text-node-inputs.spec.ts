import {
  expect,
  test,
  type APIRequestContext,
} from "./safe-test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  nextNodeInputOrder,
  resolveNodeInputs,
} from "../types/nodeInputs";
import {
  cleanParameterSchema,
  defaultParameterSchema,
  type ModelParameterSchema,
} from "../types/modelParameters";

const allTextUpstreamInputs = {
  audio: { limitMode: "context" as const, supported: true },
  image: { limitMode: "context" as const, supported: true },
  text: { limitMode: "context" as const, supported: true },
  video: { limitMode: "context" as const, supported: true },
};

const textInputRoles = {
  audio: ["context-audio"],
  image: ["context-image", "subject"],
  text: ["context-text"],
  video: ["context-video"],
};

function textInputSchema(
  promptPolicy: "own-required" | "own-or-upstream-text" = "own-required",
): ModelParameterSchema {
  return {
    ...defaultParameterSchema("text"),
    inputPolicy: {
      promptPolicy,
      required: {},
      roles: textInputRoles,
      switchPolicy: "keep-edge",
    },
    upstreamInputs: allTextUpstreamInputs,
  };
}

function incompatibleTextInputSchema(): ModelParameterSchema {
  return {
    ...textInputSchema(),
    upstreamInputs: {
      audio: { limitMode: "fixed", maxCount: 0, supported: false },
      image: { limitMode: "fixed", maxCount: 0, supported: false },
      text: { limitMode: "context", supported: true },
      video: { limitMode: "fixed", maxCount: 0, supported: false },
    },
  };
}

function fourReadyNodes() {
  return [
    {
      data: { content: "上游文字上下文", label: "Text", title: "上游文字" },
      id: "p2-upstream-text",
      type: "text",
    },
    {
      data: {
        assetId: "p2-ready-image",
        imageSrc: "/api/assets/p2-ready-image",
        label: "Image",
        title: "上游图片",
      },
      id: "p2-upstream-image",
      type: "image",
    },
    {
      data: {
        assetId: "p2-ready-video.mp4",
        label: "Video",
        title: "上游视频",
        videoSrc: "/api/video-assets/p2-ready-video.mp4",
      },
      id: "p2-upstream-video",
      type: "video",
    },
    {
      data: {
        assetId: "p2-ready-audio.mp3",
        audioDuration: 2,
        audioSrc: "/api/audio-assets/p2-ready-audio.mp3",
        audioWaveform: [8, 16, 24, 32, 24, 16, 8],
        label: "Audio",
        title: "上游音频",
      },
      id: "p2-upstream-audio",
      type: "audio",
    },
    {
      data: { label: "Text", title: "目标文字" },
      id: "p2-target-text",
      type: "text",
    },
  ];
}

function fourInputEdges() {
  return (["text", "image", "video", "audio"] as const).map(
    (kind, index) => ({
      data: {
        inputOrder: index + 1,
        inputRole: `context-${kind}`,
      },
      id: `p2-edge-${kind}`,
      source: `p2-upstream-${kind}`,
      sourceHandle: "source",
      target: "p2-target-text",
      targetHandle: "target",
      type: "cuttable",
    }),
  );
}

test("Text resolves four durable upstream kinds as independent ready context", () => {
  const result = resolveNodeInputs({
    edges: fourInputEdges(),
    modelSchema: textInputSchema(),
    nodes: fourReadyNodes(),
    ownPrompt: "只使用本节点生成指令",
    targetId: "p2-target-text",
    targetKind: "text",
  });

  expect(result.inputs.map(({ kind, state }) => ({ kind, state }))).toEqual([
    { kind: "text", state: "ready" },
    { kind: "image", state: "ready" },
    { kind: "video", state: "ready" },
    { kind: "audio", state: "ready" },
  ]);
  expect(result.inputs.every((input) => input.compatibility === "compatible"))
    .toBeTruthy();
  expect(result.finalPrompt).toBe("只使用本节点生成指令");
  expect(result.finalPrompt).not.toContain("上游文字上下文");
  expect(result.canSubmit).toBeTruthy();
  expect(result.snapshot).toEqual([
    { kind: "text", order: 1, role: "context-text", sourceNodeId: "p2-upstream-text" },
    {
      assetId: "p2-ready-image",
      kind: "image",
      order: 2,
      role: "context-image",
      sourceNodeId: "p2-upstream-image",
    },
    {
      assetId: "p2-ready-video.mp4",
      kind: "video",
      order: 3,
      role: "context-video",
      sourceNodeId: "p2-upstream-video",
    },
    {
      assetId: "p2-ready-audio.mp3",
      kind: "audio",
      order: 4,
      role: "context-audio",
      sourceNodeId: "p2-upstream-audio",
    },
  ]);
});

test("Text Prompt replacement is opt-in and the administrator schema preserves the policy", () => {
  const ownRequired = resolveNodeInputs({
    edges: [fourInputEdges()[0]],
    modelSchema: textInputSchema("own-required"),
    nodes: fourReadyNodes(),
    ownPrompt: "",
    targetId: "p2-target-text",
    targetKind: "text",
  });
  expect(ownRequired.finalPrompt).toBe("");
  expect(ownRequired.canSubmit).toBeFalsy();
  expect(ownRequired.problems).toContainEqual(expect.objectContaining({
    code: "PROMPT_MISSING",
  }));

  const upstreamFallback = resolveNodeInputs({
    edges: [fourInputEdges()[0]],
    modelSchema: textInputSchema("own-or-upstream-text"),
    nodes: fourReadyNodes(),
    ownPrompt: "",
    targetId: "p2-target-text",
    targetKind: "text",
  });
  expect(upstreamFallback.finalPrompt).toBe("上游文字上下文");
  expect(upstreamFallback.canSubmit).toBeTruthy();

  const ownWins = resolveNodeInputs({
    edges: [fourInputEdges()[0]],
    modelSchema: textInputSchema("own-or-upstream-text"),
    nodes: fourReadyNodes(),
    ownPrompt: "本节点覆盖指令",
    targetId: "p2-target-text",
    targetKind: "text",
  });
  expect(ownWins.finalPrompt).toBe("本节点覆盖指令");

  expect(cleanParameterSchema("text", textInputSchema("own-or-upstream-text"))
    .inputPolicy?.promptPolicy).toBe("own-or-upstream-text");
});

test("new input order appends after the durable maximum instead of filling a hole", () => {
  expect(nextNodeInputOrder([
    {
      data: { inputOrder: 1 },
      id: "first",
      source: "one",
      target: "target",
    },
    {
      data: { inputOrder: 3 },
      id: "third",
      source: "three",
      target: "target",
    },
    {
      data: { inputOrder: 99 },
      id: "unrelated",
      source: "other",
      target: "another-target",
    },
  ], "target")).toBe(4);
  expect(nextNodeInputOrder([], "target")).toBe(1);
});

test("media generation and error fields map to uploading and invalid for every media kind", () => {
  const kinds = ["image", "video", "audio"] as const;
  const nodes = [
    ...kinds.map((kind) => ({
      data: { [`${kind}Generating`]: true, label: kind, title: `${kind}-uploading` },
      id: `${kind}-uploading`,
      type: kind,
    })),
    ...kinds.map((kind) => ({
      data: {
        [`${kind}GenerationError`]: `${kind} generation failed`,
        label: kind,
        title: `${kind}-invalid`,
      },
      id: `${kind}-invalid`,
      type: kind,
    })),
    { data: { label: "Text" }, id: "target", type: "text" },
  ];
  const edges = nodes.slice(0, 6).map((node, index) => ({
    data: { inputOrder: index + 1, inputRole: `context-${node.type}` },
    id: `edge-${node.id}`,
    source: node.id,
    target: "target",
  }));
  const result = resolveNodeInputs({
    edges,
    modelSchema: textInputSchema(),
    nodes,
    ownPrompt: "本节点指令",
    targetId: "target",
    targetKind: "text",
  });

  expect(result.inputs.slice(0, 3).map(({ state }) => state)).toEqual([
    "uploading",
    "uploading",
    "uploading",
  ]);
  expect(result.inputs.slice(3).map(({ reason, state }) => ({ reason, state })))
    .toEqual([
      { reason: "image generation failed", state: "invalid" },
      { reason: "video generation failed", state: "invalid" },
      { reason: "audio generation failed", state: "invalid" },
    ]);
});

test("an empty Text reference explains whether to edit or run the upstream node", () => {
  const resolveTextSource = (data: Record<string, unknown>) => resolveNodeInputs({
    edges: [{
      data: { inputOrder: 1, inputRole: "instruction" },
      id: "text-to-image",
      source: "source-text",
      target: "target-image",
    }],
    modelSchema: defaultParameterSchema("image"),
    nodes: [
      { data: { title: "文字步骤", ...data }, id: "source-text", type: "text" },
      { data: {}, id: "target-image", type: "image" },
    ],
    ownPrompt: "本节点补充",
    targetId: "target-image",
    targetKind: "image",
  });

  expect(resolveTextSource({ textPrompt: "识别图片并生成正文" }).problems[0]?.message)
    .toBe("文字步骤还没有生成正文，请先运行该文字节点");
  expect(resolveTextSource({ textGenerating: true, textPrompt: "生成正文" })
    .problems[0]?.message).toBe("文字步骤正在生成正文，完成后才能运行本节点");
  expect(resolveTextSource({}).problems[0]?.message)
    .toBe("文字步骤还没有正文：可双击填写母版，或输入文字生成指令后运行");
  const ready = resolveTextSource({
    content: "已生成的正文",
    textPrompt: "这是生成指令，不是下游内容",
  });
  expect(ready.canSubmit).toBe(true);
  expect(ready.finalPrompt).toBe("已生成的正文\n\n本节点补充");
});

type CanvasDocument = {
  edges: Array<Record<string, unknown>>;
  nodes: Array<Record<string, unknown>>;
  revision: number;
  viewport: { x: number; y: number; zoom: number };
};

const rootCanvasId = "default";
const serverCanvasId = "p2-text-server-preflight";
const compatibleModelName = "P2 Text Four Inputs";
const incompatibleModelName = "P2 Text Only";
const imageAssetId = "p2-ready-image";
const videoAssetId = "p2-ready-video.mp4";
const audioAssetId = "p2-ready-audio.mp3";
const temporaryModelIds: string[] = [];
let compatibleModelId = "";
let incompatibleModelId = "";
let originalRoot: CanvasDocument | undefined;

async function createTextModel(
  request: APIRequestContext,
  displayName: string,
  parameterSchema: ModelParameterSchema,
) {
  const response = await request.post("/api/admin/models", {
    data: {
      capability: "text",
      displayName,
      isDefault: false,
      maxCostMicrounits: 0,
      parameterSchema,
      providerModelId: `fixture/${displayName.toLowerCase().replaceAll(" ", "-")}`,
      providerProfileId: "provider-unconfigured",
      sortOrder: 9_000 + temporaryModelIds.length,
      status: "published",
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { model: { id: string } };
  temporaryModelIds.push(body.model.id);
  return body.model.id;
}

async function uploadReadyMedia(request: APIRequestContext) {
  const [image, video, audio] = await Promise.all([
    readFile(resolve(
      process.cwd(),
      "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    )),
    readFile(resolve(process.cwd(), "client/public/fixtures/video-success.mp4")),
    readFile(resolve(process.cwd(), "client/public/fixtures/audio-success.mp3")),
  ]);
  const responses = await Promise.all([
    request.post(`/api/assets/${imageAssetId}`, {
      data: image,
      headers: { "Content-Type": "image/png", "X-File-Name": "p2-ready.png" },
    }),
    request.post(`/api/video-assets/${videoAssetId}`, {
      data: video,
      headers: { "Content-Type": "video/mp4", "X-File-Name": "p2-ready.mp4" },
    }),
    request.post(`/api/audio-assets/${audioAssetId}`, {
      data: audio,
      headers: { "Content-Type": "audio/mpeg", "X-File-Name": "p2-ready.mp3" },
    }),
  ]);
  expect(responses.map((response) => response.status())).toEqual([201, 201, 201]);
}

function rootNodes() {
  const [text, image, video, audio, target] = fourReadyNodes();
  return [
    { ...text, position: { x: 70, y: 30 }, style: { height: 250, width: 250 } },
    { ...image, position: { x: 70, y: 330 }, style: { height: 250, width: 250 } },
    { ...video, position: { x: 70, y: 630 }, style: { height: 250, width: 444 } },
    { ...audio, position: { x: 70, y: 930 }, style: { height: 250, width: 444 } },
    {
      ...target,
      data: {
        ...target.data,
        content: "",
        textModelId: compatibleModelId,
        textModelName: compatibleModelName,
        textPrompt: "本节点生成指令",
        textPromptReady: true,
      },
      position: { x: 650, y: 250 },
      selected: true,
      style: { height: 250, width: 250 },
    },
  ];
}

async function saveRootCanvas(request: APIRequestContext) {
  const current = await request.get(`/api/canvas/${rootCanvasId}`);
  const revision = current.ok()
    ? ((await current.json() as CanvasDocument).revision)
    : 0;
  const saved = await request.put(`/api/canvas/${rootCanvasId}`, {
    data: {
      edges: fourInputEdges(),
      nodes: rootNodes(),
      revision,
      viewport: { x: 20, y: -40, zoom: 0.68 },
    },
  });
  expect(saved.ok()).toBeTruthy();
}

test.describe.serial("P2 Text integration stays on the saved root canvas", () => {
  test.beforeAll(async ({ request }) => {
    const root = await request.get(`/api/canvas/${rootCanvasId}`);
    if (root.ok()) originalRoot = await root.json() as CanvasDocument;
    compatibleModelId = await createTextModel(
      request,
      compatibleModelName,
      textInputSchema(),
    );
    incompatibleModelId = await createTextModel(
      request,
      incompatibleModelName,
      incompatibleTextInputSchema(),
    );
    await uploadReadyMedia(request);
    await saveRootCanvas(request);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/canvas/${serverCanvasId}`);
    const currentRoot = await request.get(`/api/canvas/${rootCanvasId}`);
    if (originalRoot && currentRoot.ok()) {
      const current = await currentRoot.json() as CanvasDocument;
      await request.put(`/api/canvas/${rootCanvasId}`, {
        data: {
          edges: originalRoot.edges,
          nodes: originalRoot.nodes,
          revision: current.revision,
          viewport: originalRoot.viewport,
        },
      });
    } else if (!originalRoot) {
      await request.delete(`/api/canvas/${rootCanvasId}`);
    }
    for (const modelId of temporaryModelIds) {
      await request.patch(`/api/admin/models/${modelId}`, {
        data: { isDefault: false, status: "disabled" },
      });
    }
    await Promise.all([
      request.delete(`/api/assets/${imageAssetId}`),
      request.delete(`/api/video-assets/${videoAssetId}`),
      request.delete(`/api/audio-assets/${audioAssetId}`),
    ]);
  });

  test("root Text UI shows four real ready cards and preserves incompatible edges through undo and reload", async ({
    page,
    request,
  }) => {
    const taskPosts: string[] = [];
    page.on("request", (entry) => {
      if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
        taskPosts.push(entry.url());
      }
    });

    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-edge-count", "4");
    const cards = page.getByTestId("text-upstream-inputs");
    await expect(cards.locator("[data-input-kind]")).toHaveCount(4);
    for (const kind of ["text", "image", "video", "audio"] as const) {
      const card = cards.locator(`[data-input-kind="${kind}"]`);
      await expect(card).toHaveAttribute("data-input-state", "ready");
      await expect(card).toHaveAttribute("data-input-compatibility", "compatible");
    }
    await expect(page.getByTestId("text-creator-prompt")).toHaveValue("本节点生成指令");
    await expect(page.getByTestId("upstream-input-problem")).toHaveCount(0);

    await cards.getByRole("button", { name: "查看引用 上游图片" }).click();
    const imageDetails = page.getByRole("dialog", { name: "上游图片引用详情" });
    const imageRole = imageDetails.getByRole("group", { name: "上游图片角色" });
    await imageRole.locator('[data-value="subject"]').click();
    await expect(cards.locator('[data-input-kind="image"]'))
      .toHaveAttribute("data-input-role", "subject");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${rootCanvasId}`);
      const document = await response.json() as CanvasDocument;
      return (document.edges.find((edge) => edge.id === "p2-edge-image")?.data as {
        inputRole?: string;
      })?.inputRole;
    }).toBe("subject");
    await page.keyboard.press("Meta+z");
    await expect(cards.locator('[data-input-kind="image"]'))
      .toHaveAttribute("data-input-role", "context-image");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${rootCanvasId}`);
      const document = await response.json() as CanvasDocument;
      return (document.edges.find((edge) => edge.id === "p2-edge-image")?.data as {
        inputRole?: string;
      })?.inputRole;
    }).toBe("context-image");

    await cards.getByRole("button", { name: "查看引用 上游音频" }).click();
    let audioDetails = page.getByRole("dialog", { name: "上游音频引用详情" });
    await audioDetails.getByRole("button", { name: "向前移动 上游音频" }).click();
    await expect(cards.locator("[data-input-kind]").nth(2))
      .toHaveAttribute("data-input-kind", "audio");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${rootCanvasId}`);
      const document = await response.json() as CanvasDocument;
      return document.edges.map((edge) => ({
        id: edge.id,
        order: (edge.data as { inputOrder?: number }).inputOrder,
      }));
    }).toEqual([
      { id: "p2-edge-text", order: 1 },
      { id: "p2-edge-image", order: 2 },
      { id: "p2-edge-video", order: 4 },
      { id: "p2-edge-audio", order: 3 },
    ]);
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator('.react-flow__node[data-id="p2-target-text"]').click();
    await expect(cards.locator("[data-input-kind]").nth(2))
      .toHaveAttribute("data-input-kind", "audio");
    await cards.getByRole("button", { name: "查看引用 上游音频" }).click();
    audioDetails = page.getByRole("dialog", { name: "上游音频引用详情" });
    await audioDetails.getByRole("button", { name: "向后移动 上游音频" }).click();
    await expect(cards.locator("[data-input-kind]").nth(2))
      .toHaveAttribute("data-input-kind", "video");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${rootCanvasId}`);
      const document = await response.json() as CanvasDocument;
      return document.edges.map((edge) => (edge.data as { inputOrder?: number }).inputOrder);
    }).toEqual([1, 2, 3, 4]);
    await audioDetails.getByRole("button", { name: "向前移动 上游音频" }).click();
    await page.keyboard.press("Meta+z");
    await expect(cards.locator("[data-input-kind]").nth(2))
      .toHaveAttribute("data-input-kind", "video");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${rootCanvasId}`);
      const document = await response.json() as CanvasDocument;
      return document.edges.map((edge) => (edge.data as { inputOrder?: number }).inputOrder);
    }).toEqual([1, 2, 3, 4]);
    await audioDetails.getByRole("button", { name: "关闭 上游音频引用详情" }).click();

    const modelControl = page.getByTestId("text-model-control");
    await expect(modelControl.getByRole("combobox")).toContainText(compatibleModelName);
    await modelControl.getByRole("combobox").click();
    await page.getByRole("option", { name: incompatibleModelName }).click();
    await expect(modelControl.getByRole("combobox")).toContainText(incompatibleModelName);
    await expect(world).toHaveAttribute("data-edge-count", "4");
    await expect(cards.locator("[data-input-kind]")).toHaveCount(4);
    for (const kind of ["image", "video", "audio"] as const) {
      await expect(cards.locator(`[data-input-kind="${kind}"]`))
        .toHaveAttribute("data-input-compatibility", "blocked");
    }
    await cards.getByRole("button", { name: "查看引用 上游图片" }).click();
    await expect(page.getByTestId("upstream-input-reason-p2-edge-image"))
      .toContainText("当前模型不支持image类型上游");

    await cards.getByRole("button", { name: "删除引用 上游音频" }).click();
    await expect(world).toHaveAttribute("data-edge-count", "3");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${rootCanvasId}`);
      return response.ok()
        ? (await response.json() as CanvasDocument).edges.length
        : -1;
    }).toBe(3);
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    await page.keyboard.press("Meta+z");
    await expect(world).toHaveAttribute("data-edge-count", "4");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${rootCanvasId}`);
      return response.ok()
        ? (await response.json() as CanvasDocument).edges.length
        : -1;
    }).toBe(4);
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-edge-count", "4");
    await expect(page.getByTestId("text-upstream-inputs").locator("[data-input-kind]"))
      .toHaveCount(4);
    await expect(page.getByTestId("text-model-control").getByRole("combobox"))
      .toContainText(incompatibleModelName);
    const persisted = await (await request.get(`/api/canvas/${rootCanvasId}`))
      .json() as CanvasDocument;
    expect(persisted.edges.map((edge) => (edge.data as { inputOrder: number }).inputOrder))
      .toEqual([1, 2, 3, 4]);
    expect(new Set(persisted.edges.map((edge) => edge.id)).size).toBe(4);
    expect(taskPosts).toEqual([]);
  });

  test("server Text structural preflight stays valid but the platform stop reason wins", async ({
    request,
  }) => {
    await request.delete(`/api/canvas/${serverCanvasId}`);
    const saved = await request.put(`/api/canvas/${serverCanvasId}`, {
      data: {
        edges: [],
        nodes: [{
          data: {
            label: "Text",
            textModelId: compatibleModelId,
            textPrompt: "本节点文字生成指令",
            title: "服务端文字目标",
          },
          id: "server-text-target",
          position: { x: 100, y: 100 },
          type: "text",
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const canvasRevision = (await saved.json() as { revision: number }).revision;
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    const body = {
      canvasId: serverCanvasId,
      canvasRevision,
      idempotencyKey: `p2-text-${Date.now()}`,
      inputSchemaVersion: 1,
      kind: "text",
      model: compatibleModelId,
      nodeId: "server-text-target",
      ownPrompt: "本节点文字生成指令",
      parameters: {},
      prompt: "前端结果不作为服务端信任边界",
    };

    const preflightResponse = await request.post("/api/generation-tasks/preflight", {
      data: body,
    });
    expect(preflightResponse.ok()).toBeTruthy();
    const preflight = await preflightResponse.json() as {
      canEnqueue: boolean;
      canSubmit: boolean;
      enqueueProblem?: { code: string; message: string };
      finalPrompt: string;
      problems: Array<{ code: string }>;
      provider: { adapterSupported: boolean; configured: boolean };
      providerRequests: number;
    };
    expect(preflight).toMatchObject({
      canEnqueue: false,
      canSubmit: true,
      finalPrompt: "本节点文字生成指令",
      providerRequests: 0,
    });
    expect(preflight.problems).toEqual([]);
    expect(preflight.provider.adapterSupported).toBe(false);
    expect(preflight.enqueueProblem?.code).toBe("GLOBAL_GENERATION_DISABLED");

    const submission = await request.post("/api/generation-tasks", { data: body });
    expect(submission.ok()).toBeFalsy();
    expect([409, 503]).toContain(submission.status());
    await expect(submission.json()).resolves.toMatchObject({
      code: "GLOBAL_GENERATION_DISABLED",
      problems: [{ code: "INVALID" }],
    });
    const tasks = await (await request.get(
      `/api/generation-tasks?canvasId=${encodeURIComponent(serverCanvasId)}`,
    )).json() as { tasks: unknown[] };
    expect(tasks.tasks).toEqual([]);
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  });

  test("creator prompt autosaves after idle without blur", async ({
    page,
    request,
  }) => {
    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator('.react-flow__node[data-id="p2-target-text"]').click({
      position: { x: 12, y: 12 },
    });
    const prompt = page.getByTestId("text-creator-prompt");
    await prompt.fill("自动保存验证");
    await expect
      .poll(
        async () => {
          const document = await (
            await request.get(`/api/canvas/${rootCanvasId}`)
          ).json() as {
            nodes: Array<{ data?: { textPrompt?: string }; id: string }>;
          };
          return document.nodes.find((node) => node.id === "p2-target-text")
            ?.data?.textPrompt;
        },
        { timeout: 8_000 },
      )
      .toBe("自动保存验证");
  });
});
