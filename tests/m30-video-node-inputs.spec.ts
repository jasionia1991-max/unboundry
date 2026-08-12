import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./safe-test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  resolveNodeInputs,
  type NodeInputKind,
  type NodeInputRole,
} from "../types/nodeInputs";
import {
  knownModelParameterSchema,
  type ModelParameterSchema,
} from "../types/modelParameters";
import { openAppDatabase } from "../server/database";
import { resolvePersistedNodeInputs } from "../server/inputPreflight";

const seedanceSchema = knownModelParameterSchema({
  capability: "video",
  providerDriver: "volcengine-ark",
  providerModelId: "doubao-seedance-2-0-mini-260615",
});

function serverFixtureSchema(): ModelParameterSchema {
  const rules = seedanceSchema.referenceMediaRules!;
  const audio = { ...rules.audio! };
  const video = { ...rules.video! };
  // The checked-in audio fixture is deliberately long. This local-only model
  // exercises authoritative metadata hydration, not a paid Seedance limit.
  delete audio.maxDurationSeconds;
  delete audio.maxTotalDurationSeconds;
  delete audio.minDurationSeconds;
  delete video.minPixelCount;
  return {
    ...seedanceSchema,
    referenceMediaRules: {
      ...rules,
      audio,
      video: { ...video, minDurationSeconds: 0 },
    },
  };
}

const serverSchema = serverFixtureSchema();

type GraphNode = {
  data: Record<string, unknown>;
  id: string;
  type: NodeInputKind;
};

type GraphEdge = {
  data: { inputOrder: number; inputRole?: NodeInputRole };
  id: string;
  source: string;
  target: string;
};

function readyMediaNode(
  kind: "audio" | "image" | "video",
  index: number,
  data: Record<string, unknown> = {},
): GraphNode {
  const id = `p3-${kind}-${index}`;
  return {
    data: {
      assetId: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`,
      [`${kind}Src`]: `https://signed.example.test/${id}?signature=short-lived`,
      label: kind,
      mediaByteSize: 1_024,
      mediaContentType: kind === "image"
        ? "image/png"
        : kind === "video"
          ? "video/mp4"
          : "audio/mpeg",
      mediaDurationSeconds: kind === "image" ? undefined : kind === "video" ? 5 : 4,
      mediaMetadataSource: "server",
      mediaMetadataStatus: "ready",
      mediaStorageBackend: kind === "video" ? "oss" : "local",
      title: `${kind}-${index}`,
      ...(kind === "image" || kind === "video"
        ? { mediaHeight: 720, mediaWidth: 1_280 }
        : {}),
      ...data,
    },
    id,
    type: kind,
  };
}

function edge(
  source: string,
  order: number,
  role?: NodeInputRole,
): GraphEdge {
  return {
    data: {
      inputOrder: order,
      ...(role ? { inputRole: role } : {}),
    },
    id: `p3-edge-${source}`,
    source,
    target: "p3-target-video",
  };
}

function multimodalGraph(counts: {
  audio: number;
  image: number;
  video: number;
}) {
  const nodes: GraphNode[] = [{
    data: {
      content: "上游文字指令：保持商品颜色，并使用舒缓的镜头节奏。",
      label: "Text",
      title: "上游文字",
    },
    id: "p3-text-1",
    type: "text",
  }];
  const edges: GraphEdge[] = [edge("p3-text-1", 1, "instruction")];
  let order = 2;

  for (let index = 1; index <= counts.image; index += 1) {
    const node = readyMediaNode("image", index);
    nodes.push(node);
    edges.push(edge(node.id, order, index === 1 ? "subject" : "reference-image"));
    order += 1;
  }
  for (let index = 1; index <= counts.video; index += 1) {
    const node = readyMediaNode("video", index);
    nodes.push(node);
    edges.push(edge(node.id, order, index === 1 ? "subject" : "reference-video"));
    order += 1;
  }
  for (let index = 1; index <= counts.audio; index += 1) {
    const node = readyMediaNode("audio", index, {
      audioDuration: 12,
      audioWaveform: [6, 12, 18, 12, 6],
    });
    nodes.push(node);
    edges.push(edge(node.id, order, "reference-audio"));
    order += 1;
  }
  nodes.push({
    data: { label: "Video", title: "目标视频" },
    id: "p3-target-video",
    type: "video",
  });
  return { edges, nodes };
}

function videoPreflight(input: {
  edges: GraphEdge[];
  mode: "first-last-frame" | "multimodal" | "text";
  nodes: GraphNode[];
  ownPrompt?: string;
  schema?: ModelParameterSchema;
}) {
  return resolveNodeInputs({
    edges: input.edges,
    modelSchema: input.schema ?? seedanceSchema,
    nodes: input.nodes,
    ownPrompt: input.ownPrompt ?? "本节点补充：生成一段简洁的商品展示视频。",
    parameters: { inputMode: input.mode },
    targetId: "p3-target-video",
    targetKind: "video",
  });
}

test("Video accepts merged or upstream-only Text plus ready media with a URL-free snapshot", () => {
  const graph = multimodalGraph({ audio: 3, image: 9, video: 3 });
  const result = videoPreflight({ ...graph, mode: "multimodal" });

  expect(result.canSubmit).toBeTruthy();
  expect(result.problems).toEqual([]);
  expect(result.inputs).toHaveLength(16);
  expect(result.inputs.every((input) =>
    input.state === "ready" && input.compatibility === "compatible"))
    .toBeTruthy();
  expect(result.inputs.filter(({ kind }) => kind === "text")).toHaveLength(1);
  expect(result.inputs.filter(({ kind }) => kind === "image")).toHaveLength(9);
  expect(result.inputs.filter(({ kind }) => kind === "video")).toHaveLength(3);
  expect(result.inputs.filter(({ kind }) => kind === "audio")).toHaveLength(3);
  expect(result.inputs.filter(({ role }) => role === "subject").map(({ kind }) => kind))
    .toEqual(["image", "video"]);
  expect(result.finalPrompt).toBe(
    "上游文字指令：保持商品颜色，并使用舒缓的镜头节奏。\n\n" +
    "本节点补充：生成一段简洁的商品展示视频。",
  );
  expect(result.snapshot).toHaveLength(16);
  expect(result.snapshot.map(({ order }) => order)).toEqual(
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  expect(result.snapshot[0]).toEqual({
    kind: "text",
    order: 1,
    role: "instruction",
    sourceNodeId: "p3-text-1",
  });
  expect(JSON.stringify(result.snapshot)).not.toMatch(
    /https?:|signed|signature|imageSrc|videoSrc|audioSrc/i,
  );

  const upstreamOnlyGraph = multimodalGraph({ audio: 0, image: 1, video: 0 });
  const upstreamOnly = videoPreflight({
    ...upstreamOnlyGraph,
    mode: "multimodal",
    ownPrompt: "",
  });
  expect(upstreamOnly.inputs.find(({ kind }) => kind === "text")).toMatchObject({
    compatibility: "compatible",
    kind: "text",
    role: "instruction",
    state: "ready",
  });
  expect(upstreamOnly.finalPrompt).toBe(
    "上游文字指令：保持商品颜色，并使用舒缓的镜头节奏。",
  );
  expect(upstreamOnly.problems).toEqual([]);
  expect(upstreamOnly.canSubmit).toBeTruthy();
  expect(upstreamOnly.snapshot).toEqual([
    {
      kind: "text",
      order: 1,
      role: "instruction",
      sourceNodeId: "p3-text-1",
    },
    {
      assetId: "p3-image-1.png",
      kind: "image",
      order: 2,
      role: "subject",
      sourceNodeId: "p3-image-1",
    },
  ]);
  expect(JSON.stringify(upstreamOnly.snapshot)).not.toMatch(
    /https?:|signed|signature|imageSrc|videoSrc|audioSrc/i,
  );

  const withoutPrompt = videoPreflight({
    edges: [],
    mode: "text",
    nodes: [{
      data: { label: "Video", title: "无文字目标视频" },
      id: "p3-target-video",
      type: "video",
    }],
    ownPrompt: "",
  });
  expect(withoutPrompt.finalPrompt).toBe("");
  expect(withoutPrompt.canSubmit).toBeFalsy();
  expect(withoutPrompt.problems).toContainEqual(expect.objectContaining({
    code: "PROMPT_MISSING",
  }));
});

test("Video keeps all 10/4/4 edges and blocks only the references beyond 9/3/3", () => {
  const graph = multimodalGraph({ audio: 4, image: 10, video: 4 });
  const result = videoPreflight({ ...graph, mode: "multimodal" });

  expect(result.canSubmit).toBeFalsy();
  expect(result.inputs).toHaveLength(19);
  expect(result.snapshot).toHaveLength(19);
  expect(new Set(result.inputs.map(({ edgeId }) => edgeId)).size).toBe(19);
  expect(result.problems.filter(({ code }) => code === "QUANTITY_EXCEEDED"))
    .toHaveLength(3);
  for (const sourceNodeId of ["p3-image-10", "p3-video-4", "p3-audio-4"]) {
    expect(result.inputs.find((input) => input.sourceNodeId === sourceNodeId))
      .toMatchObject({ compatibility: "blocked" });
  }
  expect(result.inputs.find((input) => input.sourceNodeId === "p3-image-9"))
    .toMatchObject({ compatibility: "compatible" });
  expect(result.inputs.find((input) => input.sourceNodeId === "p3-video-3"))
    .toMatchObject({ compatibility: "compatible" });
  expect(result.inputs.find((input) => input.sourceNodeId === "p3-audio-3"))
    .toMatchObject({ compatibility: "compatible" });
});

test("Video blocks an uploading reference without deleting its edge or snapshot entry", () => {
  const graph = multimodalGraph({ audio: 1, image: 1, video: 1 });
  const audio = graph.nodes.find((node) => node.id === "p3-audio-1")!;
  audio.data = { ...audio.data, inputState: "uploading" };
  const result = videoPreflight({ ...graph, mode: "multimodal" });

  expect(result.canSubmit).toBeFalsy();
  expect(result.inputs).toHaveLength(4);
  expect(result.snapshot).toHaveLength(4);
  expect(result.inputs.find((input) => input.sourceNodeId === audio.id))
    .toMatchObject({ compatibility: "blocked", state: "uploading" });
  expect(result.problems).toContainEqual(expect.objectContaining({
    code: "UPLOADING",
    edgeId: `p3-edge-${audio.id}`,
  }));
});

test("first-last-frame derives ordered roles and reports missing or duplicate frames", () => {
  const first = readyMediaNode("image", 1);
  const last = readyMediaNode("image", 2);
  const target: GraphNode = {
    data: { label: "Video" },
    id: "p3-target-video",
    type: "video",
  };
  const complete = videoPreflight({
    edges: [edge(first.id, 1), edge(last.id, 2)],
    mode: "first-last-frame",
    nodes: [first, last, target],
  });
  expect(complete.canSubmit).toBeTruthy();
  expect(complete.inputs.map(({ role }) => role)).toEqual([
    "first-frame",
    "last-frame",
  ]);
  expect(complete.snapshot.map(({ role }) => role)).toEqual([
    "first-frame",
    "last-frame",
  ]);

  const missingLast = videoPreflight({
    edges: [edge(first.id, 1)],
    mode: "first-last-frame",
    nodes: [first, target],
  });
  expect(missingLast.canSubmit).toBeFalsy();
  expect(missingLast.inputs[0].role).toBe("first-frame");
  expect(missingLast.problems).toContainEqual(expect.objectContaining({
    code: "ROLE_CONFLICT",
    message: "当前模式至少需要1个尾帧输入",
  }));

  const duplicateFirst = videoPreflight({
    edges: [
      edge(first.id, 1, "first-frame"),
      edge(last.id, 2, "first-frame"),
    ],
    mode: "first-last-frame",
    nodes: [first, last, target],
  });
  expect(duplicateFirst.canSubmit).toBeFalsy();
  expect(duplicateFirst.inputs).toHaveLength(2);
  expect(duplicateFirst.inputs[1]).toMatchObject({
    compatibility: "blocked",
    reason: "首帧角色最多允许1个，引用已保留",
  });
  expect(duplicateFirst.problems.filter(({ code }) => code === "ROLE_CONFLICT"))
    .toHaveLength(2);
});

test("multimodal permits one image subject and one video subject but blocks duplicates per kind", () => {
  const validGraph = multimodalGraph({ audio: 1, image: 2, video: 2 });
  const valid = videoPreflight({ ...validGraph, mode: "multimodal" });
  expect(valid.canSubmit).toBeTruthy();
  expect(valid.inputs.filter(({ role }) => role === "subject").map(({ kind }) => kind))
    .toEqual(["image", "video"]);

  const duplicateImageEdges = validGraph.edges.map((item) =>
    item.source === "p3-image-2"
      ? { ...item, data: { ...item.data, inputRole: "subject" as const } }
      : item);
  const duplicateImage = videoPreflight({
    edges: duplicateImageEdges,
    mode: "multimodal",
    nodes: validGraph.nodes,
  });
  expect(duplicateImage.canSubmit).toBeFalsy();
  expect(duplicateImage.inputs.find(({ sourceNodeId }) => sourceNodeId === "p3-image-2"))
    .toMatchObject({ compatibility: "blocked" });
  expect(duplicateImage.problems).toContainEqual(expect.objectContaining({
    code: "ROLE_CONFLICT",
    edgeId: "p3-edge-p3-image-2",
  }));

  const duplicateVideoEdges = validGraph.edges.map((item) =>
    item.source === "p3-video-2"
      ? { ...item, data: { ...item.data, inputRole: "subject" as const } }
      : item);
  const duplicateVideo = videoPreflight({
    edges: duplicateVideoEdges,
    mode: "multimodal",
    nodes: validGraph.nodes,
  });
  expect(duplicateVideo.canSubmit).toBeFalsy();
  expect(duplicateVideo.inputs.find(({ sourceNodeId }) => sourceNodeId === "p3-video-2"))
    .toMatchObject({ compatibility: "blocked" });
  expect(duplicateVideo.problems).toContainEqual(expect.objectContaining({
    code: "ROLE_CONFLICT",
    edgeId: "p3-edge-p3-video-2",
  }));
});

const serverCanvasId = "p3-video-server-preflight";
const serverModelName = "P3 Zero Provider Video Inputs";
const serverImageAssetId = "p3-server-image";
const serverVideoAssetId = "p3-server-video.mp4";
const serverAudioAssetId = "p3-server-audio.mp3";
let serverModelId = "";

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

async function ensureServerModel(request: APIRequestContext) {
  const existing = await (await request.get("/api/admin/models")).json() as {
    models: Array<{ displayName: string; id: string }>;
  };
  const found = existing.models.find(({ displayName }) => displayName === serverModelName);
  if (found) {
    const updated = await request.patch(`/api/admin/models/${found.id}`, {
      data: {
        isDefault: false,
        maxCostMicrounits: 0,
        parameterSchema: serverSchema,
        status: "published",
      },
    });
    expect(updated.ok()).toBeTruthy();
    return found.id;
  }
  const created = await request.post("/api/admin/models", {
    data: {
      capability: "video",
      displayName: serverModelName,
      isDefault: false,
      maxCostMicrounits: 0,
      parameterSchema: serverSchema,
      providerModelId: "fixture/p3-video-inputs",
      providerProfileId: "provider-unconfigured",
      sortOrder: 9_300,
      status: "published",
    },
  });
  expect(created.status()).toBe(201);
  return (await created.json() as { model: { id: string } }).model.id;
}

async function uploadServerMedia(request: APIRequestContext) {
  const [image, video, audio] = await Promise.all([
    readFile(resolve(
      process.cwd(),
      "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    )),
    readFile(resolve(process.cwd(), "client/public/fixtures/video-success.mp4")),
    readFile(resolve(process.cwd(), "client/public/fixtures/audio-success.mp3")),
  ]);
  const responses = [
    await request.post(`/api/assets/${serverImageAssetId}`, {
      data: image,
      headers: { "Content-Type": "image/png", "X-File-Name": "p3-server.png" },
    }),
    await request.post(`/api/video-assets/${serverVideoAssetId}`, {
      data: video,
      headers: { "Content-Type": "video/mp4", "X-File-Name": "p3-server.mp4" },
    }),
    await request.post(`/api/audio-assets/${serverAudioAssetId}`, {
      data: audio,
      headers: { "Content-Type": "audio/mpeg", "X-File-Name": "p3-server.mp3" },
    }),
  ];
  expect(responses.map((response) => response.status())).toEqual([201, 201, 201]);
}

test.describe.serial("P3 Video server preflight trusts the persisted edge graph", () => {
  test.beforeAll(async ({ request }) => {
    serverModelId = await ensureServerModel(request);
    await uploadServerMedia(request);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/canvas/${serverCanvasId}`);
    await request.delete(`/api/canvas/${serverCanvasId}-image-dimensions`);
    await request.delete("/api/canvas/node.video.empty");
    await Promise.all([
      request.delete(`/api/assets/${serverImageAssetId}`),
      request.delete(`/api/video-assets/${serverVideoAssetId}`),
      request.delete(`/api/audio-assets/${serverAudioAssetId}`),
    ]);
    if (serverModelId) {
      const disabled = await request.patch(`/api/admin/models/${serverModelId}`, {
        data: { isDefault: false, status: "disabled" },
      });
      expect(disabled.ok()).toBeTruthy();
    }
  });

  test("forged client inputs are ignored and zero-cost submission creates no task or paid request", async ({
    request,
  }) => {
    await request.delete(`/api/canvas/${serverCanvasId}`);
    const saved = await request.put(`/api/canvas/${serverCanvasId}`, {
      data: {
        edges: [
          { data: { inputOrder: 1, inputRole: "instruction" }, id: "server-edge-text", source: "server-text", target: "server-video" },
          { data: { inputOrder: 2, inputRole: "subject" }, id: "server-edge-image", source: "server-image", target: "server-video" },
          { data: { inputOrder: 3, inputRole: "subject" }, id: "server-edge-video", source: "server-video-source", target: "server-video" },
          { data: { inputOrder: 4, inputRole: "reference-audio" }, id: "server-edge-audio", source: "server-audio", target: "server-video" },
        ],
        nodes: [
          { data: { content: "服务端持久化的上游文字" }, id: "server-text", type: "text" },
          { data: { assetId: serverImageAssetId, imageSrc: `/api/assets/${serverImageAssetId}` }, id: "server-image", type: "image" },
          { data: { assetId: serverVideoAssetId, videoSrc: `/api/video-assets/${serverVideoAssetId}` }, id: "server-video-source", type: "video" },
          { data: { assetId: serverAudioAssetId, audioSrc: `/api/audio-assets/${serverAudioAssetId}` }, id: "server-audio", type: "audio" },
          {
            data: {
              title: "服务端Video目标",
              videoPrompt: "",
            },
            id: "server-video",
            type: "video",
          },
        ],
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
      idempotencyKey: `p3-server-${Date.now()}`,
      inputSchemaVersion: 1,
      inputs: [{
        assetId: "forged-client-asset",
        kind: "image",
        order: 99,
        role: "last-frame",
        sourceNodeId: "forged-client-node",
      }],
      kind: "video",
      model: serverModelId,
      nodeId: "server-video",
      ownPrompt: "",
      parameters: { inputMode: "multimodal" },
      prompt: "前端伪造的最终Prompt不能成为事实来源",
    };

    const preflightResponse = await request.post("/api/generation-tasks/preflight", {
      data: body,
    });
    expect(preflightResponse.ok()).toBeTruthy();
    const preflight = await preflightResponse.json() as {
      canEnqueue: boolean;
      canSubmit: boolean;
      finalPrompt: string;
      inputs: Array<{
        compatibility: "blocked" | "compatible";
        edgeId: string;
        state: string;
      }>;
      problems: Array<{ code: string }>;
      provider: { adapterSupported: boolean; configured: boolean };
      providerBalance: { checked: boolean; status: string };
      providerRequests: number;
      safetyAdmission: { allowed: boolean };
      snapshot: Array<Record<string, unknown>>;
    };
    expect(preflight.canSubmit).toBeTruthy();
    expect(preflight.canEnqueue).toBeFalsy();
    expect(preflight).not.toHaveProperty("costCurrency");
    expect(preflight).not.toHaveProperty("estimatedCostMicrounits");
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
    expect(preflight.finalPrompt).toBe("服务端持久化的上游文字");
    expect(preflight.inputs.map(({ edgeId }) => edgeId)).toEqual([
      "server-edge-text",
      "server-edge-image",
      "server-edge-video",
      "server-edge-audio",
    ]);
    expect(preflight.inputs.every((input) =>
      input.state === "ready" && input.compatibility === "compatible"))
      .toBeTruthy();
    expect(preflight.snapshot).toEqual([
      { kind: "text", order: 1, role: "instruction", sourceNodeId: "server-text" },
      { assetId: serverImageAssetId, kind: "image", order: 2, role: "subject", sourceNodeId: "server-image" },
      { assetId: serverVideoAssetId, kind: "video", order: 3, role: "subject", sourceNodeId: "server-video-source" },
      { assetId: serverAudioAssetId, kind: "audio", order: 4, role: "reference-audio", sourceNodeId: "server-audio" },
    ]);
    expect(JSON.stringify(preflight.snapshot)).not.toMatch(/https?:|signed|signature/i);
    expect(JSON.stringify(preflight.snapshot)).not.toContain("forged-client");

    const submission = await request.post("/api/generation-tasks", { data: body });
    expect(submission.status()).toBe(503);
    const tasks = await (await request.get(
      `/api/generation-tasks?canvasId=${encodeURIComponent(serverCanvasId)}`,
    )).json() as { tasks: unknown[] };
    expect(tasks.tasks).toEqual([]);
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  });

  test("server preflight replaces forged Image dimensions with ready owner metadata and fails closed when dimensions are missing", async ({
    request,
  }) => {
    const canvasId = `${serverCanvasId}-image-dimensions`;
    await request.delete(`/api/canvas/${canvasId}`);
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "subject" },
          id: "authoritative-image-edge",
          source: "authoritative-image",
          target: "authoritative-video",
        }],
        nodes: [
          {
            data: {
              assetId: serverImageAssetId,
              imageSrc: `/api/assets/${serverImageAssetId}`,
              inputState: "ready",
              mediaByteSize: 1,
              mediaContentType: "image/png",
              mediaHeight: 720,
              mediaMetadataSource: "server",
              mediaMetadataStatus: "ready",
              mediaStorageBackend: "local",
              mediaWidth: 800,
              title: "客户端伪造尺寸的图片",
            },
            id: "authoritative-image",
            type: "image",
          },
          {
            data: {
              title: "权威尺寸目标",
              videoPrompt: "必须使用数据库中的图片尺寸",
            },
            id: "authoritative-video",
            type: "video",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const revision = (await saved.json() as { revision: number }).revision;
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    const metadataResponse = await request.get(
      `/api/media-metadata/image/${serverImageAssetId}`,
    );
    expect(metadataResponse.ok()).toBeTruthy();
    expect(await metadataResponse.json()).toMatchObject({
      mediaHeight: 720,
      mediaWidth: 1_280,
    });

    const dimensionSchema: ModelParameterSchema = {
      ...serverSchema,
      referenceMediaRules: {
        ...serverSchema.referenceMediaRules!,
        image: {
          ...serverSchema.referenceMediaRules!.image!,
          maxWidth: 1_000,
        },
      },
    };
    const resolve = () => resolvePersistedNodeInputs({
      bypass: true,
      canvasId,
      expectedRevision: revision,
      modelSchema: dimensionSchema,
      ownerId: "__test__",
      parameters: { inputMode: "multimodal" },
      targetId: "authoritative-video",
      targetKind: "video",
    });
    const database = openAppDatabase();
    const original = database.prepare(`
      SELECT media_height, media_width
      FROM media_assets
      WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
    `).get(serverImageAssetId) as {
      media_height: number | null;
      media_width: number | null;
    } | undefined;
    try {
      expect(original).toEqual({ media_height: 720, media_width: 1_280 });
      const authoritative = resolve();
      expect(authoritative.canSubmit).toBeFalsy();
      expect(authoritative.inputs[0]).toMatchObject({
        compatibility: "blocked",
        mediaHeight: 720,
        mediaWidth: 1_280,
      });
      expect(authoritative.problems).toContainEqual(expect.objectContaining({
        edgeId: "authoritative-image-edge",
        message: expect.stringContaining("宽度需不超过1000px"),
      }));

      expect(database.prepare(`
        UPDATE media_assets
        SET media_height = NULL, media_width = NULL
        WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
      `).run(serverImageAssetId).changes).toBe(1);
      const missing = resolve();
      expect(missing.canSubmit).toBeFalsy();
      expect(missing.inputs[0]).toMatchObject({
        compatibility: "blocked",
        mediaHeight: undefined,
        mediaWidth: undefined,
      });
      expect(missing.problems).toContainEqual(expect.objectContaining({
        edgeId: "authoritative-image-edge",
        message: expect.stringContaining("分辨率尚未经过服务端校验"),
      }));
    } finally {
      if (original) {
        database.prepare(`
          UPDATE media_assets
          SET media_height = ?, media_width = ?
          WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
        `).run(original.media_height, original.media_width, serverImageAssetId);
      }
      database.close();
      await request.delete(`/api/canvas/${canvasId}`);
    }
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  });

  test("server metadata hydration rejects forged ready fields for missing, foreign-owned and not-ready assets", async ({
    request,
  }) => {
    const canvasId = `${serverCanvasId}-metadata-negative`;
    const foreignOwnerId = "p3-foreign-media-owner";
    const database = openAppDatabase();
    const original = database.prepare(`
      SELECT owner_id, storage_status
      FROM media_assets
      WHERE kind = 'image' AND id = ?
    `).get(serverImageAssetId) as {
      owner_id: string;
      storage_status: "failed" | "pending" | "ready";
    } | undefined;
    if (!original) {
      database.close();
      throw new Error("P3 metadata negative test image was not registered");
    }

    const expectBlocked = async (assetId: string) => {
      await request.delete(`/api/canvas/${canvasId}`);
      const saved = await request.put(`/api/canvas/${canvasId}`, {
        data: {
          edges: [{
            data: { inputOrder: 1, inputRole: "subject" },
            id: "metadata-negative-edge",
            source: "metadata-negative-image",
            target: "metadata-negative-video",
          }],
          nodes: [
            {
              data: {
                assetId,
                imageSrc: `/api/assets/${assetId}`,
                inputState: "ready",
                mediaByteSize: 1,
                mediaContentType: "image/png",
                mediaMetadataSource: "server",
                mediaMetadataStatus: "ready",
                mediaStorageBackend: "local",
                title: "伪造可信状态的图片",
              },
              id: "metadata-negative-image",
              type: "image",
            },
            {
              data: {
                title: "元数据负控目标",
                videoPrompt: "服务端必须重新核对素材归属和状态",
              },
              id: "metadata-negative-video",
              type: "video",
            },
          ],
          revision: 0,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      });
      expect(saved.ok()).toBeTruthy();
      const revision = (await saved.json() as { revision: number }).revision;
      const response = await request.post("/api/generation-tasks/preflight", {
        data: {
          canvasId,
          canvasRevision: revision,
          idempotencyKey: `p3-metadata-negative-${assetId}-${Date.now()}`,
          inputSchemaVersion: 1,
          inputs: [],
          kind: "video",
          model: serverModelId,
          nodeId: "metadata-negative-video",
          ownPrompt: "服务端必须重新核对素材归属和状态",
          parameters: { inputMode: "multimodal" },
          prompt: "客户端伪造提示词",
        },
      });
      expect(response.ok()).toBeTruthy();
      const preflight = await response.json() as {
        canSubmit: boolean;
        inputs: Array<{
          compatibility: string;
          reason?: string;
          sourceNodeId: string;
          state: string;
        }>;
        problems: Array<{ code: string; message: string }>;
      };
      expect(preflight.canSubmit).toBeFalsy();
      expect(preflight.inputs.find(({ sourceNodeId }) =>
        sourceNodeId === "metadata-negative-image"))
        .toMatchObject({
          compatibility: "blocked",
          reason: "素材不存在、尚未保存或不属于当前账号",
          state: "invalid",
        });
      expect(preflight.problems).toContainEqual(expect.objectContaining({
        code: "INVALID",
        message: "素材不存在、尚未保存或不属于当前账号",
      }));
    };

    try {
      const timestamp = new Date().toISOString();
      database.prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
      `).run(
        foreignOwnerId,
        foreignOwnerId,
        "P3 Foreign Media Owner",
        "test-only-not-a-login",
        timestamp,
        timestamp,
      );
      await expectBlocked("p3-missing-image");

      expect(database.prepare(`
        UPDATE media_assets SET owner_id = ?
        WHERE kind = 'image' AND id = ?
      `).run(foreignOwnerId, serverImageAssetId).changes).toBe(1);
      await expectBlocked(serverImageAssetId);

      expect(database.prepare(`
        UPDATE media_assets SET owner_id = ?, storage_status = 'pending'
        WHERE kind = 'image' AND id = ?
      `).run(original.owner_id, serverImageAssetId).changes).toBe(1);
      await expectBlocked(serverImageAssetId);
    } finally {
      try {
        database.prepare(`
          UPDATE media_assets SET owner_id = ?, storage_status = ?
          WHERE kind = 'image' AND id = ?
        `).run(original.owner_id, original.storage_status, serverImageAssetId);
        database.prepare("DELETE FROM users WHERE id = ?").run(foreignOwnerId);
      } finally {
        database.close();
        await request.delete(`/api/canvas/${canvasId}`);
      }
    }
  });

  test("a ready Text supplies an empty Video Prompt while a new media edge upgrades mode in the same undo step", async ({
    page,
    request,
  }) => {
    const canvasId = "node.video.empty";
    await request.delete(`/api/canvas/${canvasId}`);
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "instruction" },
          id: "p3-ui-text-edge",
          source: "p3-ui-text",
          sourceHandle: "source",
          target: "p3-ui-video",
          targetHandle: "target",
          type: "cuttable",
        }, {
          data: { inputOrder: 2, inputRole: "reference-image" },
          id: "p3-ui-existing-edge",
          source: "p3-ui-image-1",
          sourceHandle: "source",
          target: "p3-ui-video",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [
          {
            data: {
              content: "上游文字直接作为视频生成指令",
              title: "视频生成文字",
            },
            id: "p3-ui-text",
            position: { x: 80, y: -230 },
            style: { height: 250, width: 250 },
            type: "text",
          },
          {
            data: {
              assetId: serverImageAssetId,
              imageSrc: `/api/assets/${serverImageAssetId}`,
              title: "已有参考图",
            },
            id: "p3-ui-image-1",
            position: { x: 80, y: 100 },
            style: { height: 250, width: 250 },
            type: "image",
          },
          {
            data: {
              assetId: serverImageAssetId,
              imageSrc: `/api/assets/${serverImageAssetId}`,
              title: "新增参考图",
            },
            id: "p3-ui-image-2",
            position: { x: 80, y: 430 },
            style: { height: 250, width: 250 },
            type: "image",
          },
          {
            data: {
              title: "Video目标",
              videoModelId: serverModelId,
              videoParameters: { inputMode: "text" },
              videoPrompt: "",
              videoPromptReady: true,
            },
            id: "p3-ui-video",
            position: { x: 700, y: 250 },
            style: { height: 250, width: 444 },
            type: "video",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-node-count", "4");
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await page.locator('.react-flow__node[data-id="p3-ui-video"]').click();
    const creator = page.getByTestId("video-creator");
    await expect(creator).toBeVisible();
    // Hydrating an older graph is deliberately non-destructive: its saved text
    // mode remains unchanged until the user adds a new media edge.
    await expect(creator.getByRole("button", { exact: true, name: "文本" }))
      .toBeVisible();

    await connectNodes(page, "p3-ui-image-2", "p3-ui-video");
    await expect(world).toHaveAttribute("data-edge-count", "3");
    await expect(creator.getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await expect(creator.getByTestId("video-creator-prompt")).toHaveValue("");
    await expect(creator.getByTestId("upstream-input-p3-ui-text")).toBeVisible();
    await expect(creator.getByTestId("upstream-input-problem")).toHaveCount(0);

    await page.keyboard.press("Meta+z");
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await expect(creator.getByRole("button", { exact: true, name: "文本" }))
      .toBeVisible();

    await connectNodes(page, "p3-ui-image-2", "p3-ui-video");
    await expect(world).toHaveAttribute("data-edge-count", "3");
    await expect(creator.getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await page.getByTestId("upstream-input-p3-ui-image-2")
      .getByRole("button", { name: /删除引用/ })
      .click();
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await expect(creator.getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    const persisted = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
      edges: unknown[];
      nodes: Array<{ data: { videoParameters?: { inputMode?: string } }; id: string }>;
    };
    expect(persisted.edges).toHaveLength(2);
    expect(persisted.nodes.find(({ id }) => id === "p3-ui-video")?.data.videoParameters)
      .toMatchObject({ inputMode: "multimodal" });

    await page.reload();
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await page.locator('.react-flow__node[data-id="p3-ui-video"]').click();
    const restoredCreator = page.getByTestId("video-creator");
    await expect(restoredCreator
      .getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await expect(restoredCreator.getByTestId("video-creator-prompt")).toHaveValue("");
    await expect(restoredCreator.getByTestId("upstream-input-problem")).toHaveCount(0);
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  });
});
