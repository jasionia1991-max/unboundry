import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { MediaRecord } from "../server/mediaRegistry";
import {
  arkVideoBase64Bytes,
  arkVideoMediaProblem,
  assertArkVideoBase64Budget,
  assertArkVideoMediaCombination,
} from "../server/providerMedia";
import { knownModelParameterSchema } from "../types/modelParameters";
import { resolveNodeInputs } from "../types/nodeInputs";
import {
  GenerationRequestError,
  submitVideoGeneration,
} from "../client/src/generation/generationTasks";

function media(input: Partial<MediaRecord> = {}): MediaRecord {
  return {
    byteSize: 1_024,
    checksumSha256: "a".repeat(64),
    contentType: "video/mp4",
    durationSeconds: 8,
    durationSource: "server-probe",
    durationStatus: "ready",
    objectKey: "objects/2026/08/video/test.mp4",
    storageBackend: "oss",
    storageName: "test.mp4",
    storageStatus: "ready",
    ...input,
  };
}

test("Ark paid-video media policy enforces official size, format and trusted duration boundaries", () => {
  expect(arkVideoMediaProblem("video", media({
    byteSize: 200 * 1_024 * 1_024,
    durationSeconds: 2,
  }))).toBeUndefined();
  expect(arkVideoMediaProblem("video", media({
    byteSize: 200 * 1_024 * 1_024 + 1,
  }))).toContain("200MB");
  expect(arkVideoMediaProblem("video", media({ durationSeconds: 15.001 })))
    .toContain("2至15秒");
  expect(arkVideoMediaProblem("video", media({
    durationSeconds: null,
    durationSource: null,
    durationStatus: "pending",
  }))).toContain("服务端校验");

  const validAudio = media({
    byteSize: 15 * 1_024 * 1_024,
    contentType: "audio/mpeg",
    durationSeconds: 15,
    objectKey: "objects/2026/08/audio/test.mp3",
    storageName: "test.mp3",
  });
  expect(arkVideoMediaProblem("audio", validAudio)).toBeUndefined();
  expect(arkVideoMediaProblem("audio", {
    ...validAudio,
    byteSize: 15 * 1_024 * 1_024 + 1,
  })).toContain("15MB");
  expect(arkVideoMediaProblem("audio", {
    ...validAudio,
    contentType: "audio/mp4",
  })).toContain("MP3或WAV");
  expect(arkVideoMediaProblem("audio", {
    ...validAudio,
    durationSeconds: 1.999,
  })).toContain("2至15秒");
});

test("Ark paid-video media policy enforces separate 15-second totals and forbids audio-only input", () => {
  const image = media({
    contentType: "image/png",
    durationSeconds: null,
    durationSource: null,
    durationStatus: "not-applicable",
    objectKey: "objects/2026/08/image/test.png",
    storageName: "test.png",
  });
  const video = (durationSeconds: number) => media({ durationSeconds });
  const audio = (durationSeconds: number) => media({
    contentType: "audio/wav",
    durationSeconds,
    objectKey: "objects/2026/08/audio/test.wav",
    storageName: "test.wav",
  });

  expect(() => assertArkVideoMediaCombination([
    { kind: "image", media: image },
    { kind: "video", media: video(8) },
    { kind: "video", media: video(7) },
    { kind: "audio", media: audio(8) },
    { kind: "audio", media: audio(7) },
  ])).not.toThrow();
  expect(() => assertArkVideoMediaCombination([
    { kind: "video", media: video(8) },
    { kind: "video", media: video(7.001) },
  ])).toThrow("总时长不得超过15秒");
  expect(() => assertArkVideoMediaCombination([
    { kind: "image", media: image },
    { kind: "audio", media: audio(8) },
    { kind: "audio", media: audio(7.001) },
  ])).toThrow("总时长不得超过15秒");
  expect(() => assertArkVideoMediaCombination([
    { kind: "audio", media: audio(8) },
  ])).toThrow("不能单独");
});

test("Ark Base64 budget counts local expansion but excludes private OSS URLs", () => {
  const localAudio = media({
    byteSize: 15 * 1_024 * 1_024,
    contentType: "audio/mpeg",
    durationSeconds: 2,
    storageBackend: "local",
    storageName: "local.mp3",
  });
  const localImage = media({
    byteSize: 4 * 1_024 * 1_024,
    contentType: "image/png",
    durationSeconds: null,
    durationSource: null,
    durationStatus: "not-applicable",
    storageBackend: "local",
    storageName: "local.png",
  });
  expect(arkVideoBase64Bytes("audio", localAudio)).toBeGreaterThan(15 * 1_024 * 1_024);
  expect(arkVideoBase64Bytes("audio", { ...localAudio, storageBackend: "oss" })).toBe(0);
  expect(() => assertArkVideoBase64Budget([
    { kind: "audio", media: localAudio },
    { kind: "audio", media: localAudio },
    { kind: "audio", media: localAudio },
  ])).not.toThrow();
  expect(() => assertArkVideoBase64Budget([
    { kind: "audio", media: localAudio },
    { kind: "audio", media: localAudio },
    { kind: "audio", media: localAudio },
    { kind: "image", media: localImage },
  ])).toThrow("64MB");
});

test("Video UI policy uses server metadata and assigns totals and Base64 failures to the crossing edge", () => {
  const target = { data: { title: "目标视频" }, id: "target", type: "video" };
  const source = (
    id: string,
    kind: "audio" | "image" | "video",
    data: Record<string, unknown>,
  ) => ({
    data: {
      assetId: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`,
      [`${kind}Src`]: `/api/${kind}/${id}`,
      mediaMetadataSource: "server",
      mediaMetadataStatus: "ready",
      title: id,
      ...data,
    },
    id,
    type: kind,
  });
  const edge = (id: string, order: number) => ({
    data: { inputOrder: order },
    id: `edge-${id}`,
    source: id,
    target: "target",
  });
  const videos = [
    source("video-1", "video", {
      mediaByteSize: 1_024,
      mediaContentType: "video/mp4",
      mediaDurationSeconds: 8,
      mediaStorageBackend: "oss",
    }),
    source("video-2", "video", {
      mediaByteSize: 1_024,
      mediaContentType: "video/mp4",
      mediaDurationSeconds: 8,
      mediaStorageBackend: "oss",
    }),
  ];
  const durationResult = resolveNodeInputs({
    edges: videos.map((node, index) => edge(node.id, index + 1)),
    mediaInputPolicy: "seedance-2",
    nodes: [...videos, target],
    ownPrompt: "测试可信服务端时长",
    targetId: "target",
    targetKind: "video",
  });
  expect(durationResult.problems).toContainEqual(expect.objectContaining({
    edgeId: "edge-video-2",
    message: expect.stringContaining("总时长超过15秒"),
  }));
  expect(durationResult.inputs.find(({ edgeId }) => edgeId === "edge-video-2"))
    .toMatchObject({ compatibility: "blocked", durationSeconds: 8 });

  const localMedia = [1, 2, 3].map((index) => source(`audio-${index}`, "audio", {
    mediaByteSize: 15 * 1_024 * 1_024,
    mediaContentType: "audio/mpeg",
    mediaDurationSeconds: 2,
    mediaStorageBackend: "local",
  }));
  localMedia.push(source("image-crossing", "image", {
    mediaByteSize: 4 * 1_024 * 1_024,
    mediaContentType: "image/png",
    mediaStorageBackend: "local",
  }) as (typeof localMedia)[number]);
  const base64Result = resolveNodeInputs({
    edges: localMedia.map((node, index) => edge(node.id, index + 1)),
    mediaInputPolicy: "seedance-2",
    nodes: [...localMedia, target],
    ownPrompt: "测试Base64总预算",
    targetId: "target",
    targetKind: "video",
  });
  expect(base64Result.problems).toContainEqual(expect.objectContaining({
    edgeId: "edge-image-crossing",
    message: expect.stringContaining("Base64提交内容超过64MB"),
  }));
});

test("client preserves structured 409 problems for exact reference cards without a network call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: "INPUT_INVALID",
    error: "第二段参考视频使总时长超过15秒",
    problems: [{
      code: "INVALID",
      edgeId: "edge-video-2",
      message: "第二段参考视频使总时长超过15秒",
    }],
  }), {
    headers: { "Content-Type": "application/json" },
    status: 409,
  });
  try {
    let captured: unknown;
    await submitVideoGeneration({
      canvasId: "zero-network",
      idempotencyKey: "zero-network-409",
      model: "model-zero-network",
      nodeId: "target",
      parameters: {},
      prompt: "zero network",
    }).catch((error) => {
      captured = error;
    });
    expect(captured).toBeInstanceOf(GenerationRequestError);
    expect(captured).toMatchObject({
      code: "INPUT_INVALID",
      problems: [{ edgeId: "edge-video-2" }],
      status: 409,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const fixtureDirectory = mkdtempSync(join(tmpdir(), "tapnow-ark-media-"));
const videoFiles = [1, 2].map((index) => {
  const file = join(fixtureDirectory, `eight-seconds-${index}.mp4`);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${index === 1 ? "blue" : "red"}:s=640x360:r=24:d=8`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  return file;
});
const audioUploadFile = join(fixtureDirectory, "three-seconds.mp3");
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=3",
  "-c:a",
  "libmp3lame",
  audioUploadFile,
]);
const integrationCanvasId = "p3-provider-media-safety";
const integrationAssetIds = [
  "p3-duration-video-1.mp4",
  "p3-duration-video-2.mp4",
];
let integrationModelId = "";

async function paidRequests(request: APIRequestContext) {
  return (await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  }).paidProviderRequests;
}

test("connected cards share uploading while a failed replacement preserves the accepted asset", async ({
  page,
  request,
}) => {
  const canvasId = "node.image.text-image-input";
  await request.delete(`/api/canvas/${canvasId}`);
  const saved = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [
        {
          data: { inputOrder: 1, inputRole: "reference-image" },
          id: "edge-image",
          source: "image-source",
          target: "video-target",
        },
        {
          data: { inputOrder: 2, inputRole: "reference-audio" },
          id: "edge-audio",
          source: "audio-source",
          target: "video-target",
        },
      ],
      nodes: [
        {
          data: {
            assetId: "fixture-visual.png",
            imageSrc: "data:image/png;base64,iVBORw0KGgo=",
            label: "Image",
            mediaByteSize: 8,
            mediaContentType: "image/png",
            mediaMetadataSource: "server",
            mediaMetadataStatus: "ready",
            mediaStorageBackend: "local",
            title: "视觉参考",
          },
          id: "image-source",
          position: { x: 80, y: 80 },
          type: "image",
        },
        {
          data: { label: "Audio", sourceKind: "audio", title: "待上传音频" },
          id: "audio-source",
          position: { x: 80, y: 400 },
          type: "audio",
        },
        {
          data: {
            label: "Video",
            sourceKind: "video",
            title: "目标视频",
            videoParameters: { inputMode: "multimodal" },
            videoPrompt: "生成商品展示视频",
            videoPromptReady: true,
          },
          id: "video-target",
          position: { x: 620, y: 220 },
          selected: true,
          type: "video",
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();

  let attempt = 0;
  let releaseUpload: (() => void) | undefined;
  await page.route("**/api/audio-assets/*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempt += 1;
    await new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    if (attempt === 2) {
      await route.fulfill({
        body: JSON.stringify({ error: "服务端测试失败：音频内容不可用" }),
        contentType: "application/json",
        status: 400,
      });
      return;
    }
    await route.continue();
  });
  const releaseCurrentUpload = () => {
    const current: unknown = releaseUpload;
    if (typeof current !== "function") throw new Error("upload gate was not ready");
    current();
    releaseUpload = undefined;
  };

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("video-creator")).toBeVisible();
  const card = page.getByTestId("upstream-input-audio-source");
  const input = page.getByTestId("audio-upload-input");

  await input.setInputFiles(audioUploadFile);
  await expect(card).toHaveAttribute("data-input-state", "uploading");
  await expect(page.getByTestId("upstream-input-reason-edge-audio"))
    .toContainText("音频正在上传");
  await expect.poll(() => Boolean(releaseUpload)).toBeTruthy();
  releaseCurrentUpload();
  await expect(card).toHaveAttribute("data-input-state", "ready");
  const readAcceptedAssetId = async () => {
    const response = await request.get(`/api/canvas/${canvasId}`);
    if (!response.ok()) return undefined;
    const document = await response.json() as {
      nodes: Array<{ data: { assetId?: string }; id: string }>;
    };
    return document.nodes.find((node) => node.id === "audio-source")?.data.assetId;
  };
  await expect.poll(readAcceptedAssetId).toMatch(/.+/);
  const acceptedAssetId = await readAcceptedAssetId();

  await input.setInputFiles([]);
  await input.setInputFiles({
    name: "replacement.mp3",
    mimeType: "audio/mpeg",
    buffer: readFileSync(audioUploadFile),
  });
  await expect(card).toHaveAttribute("data-input-state", "uploading");
  await expect.poll(() => Boolean(releaseUpload)).toBeTruthy();
  releaseCurrentUpload();
  await expect(card).toHaveAttribute("data-input-state", "ready");
  await expect(page.getByTestId("audio-node-audio-source").getByRole("alert"))
    .toContainText("服务端测试失败：音频内容不可用");

  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/${canvasId}`);
    if (!response.ok()) return undefined;
    const document = await response.json() as {
      nodes: Array<{ data: { assetId?: string; inputState?: string }; id: string }>;
    };
    return document.nodes.find((node) => node.id === "audio-source")?.data;
  }).toMatchObject({ assetId: acceptedAssetId, inputState: "ready" });
  await page.reload();
  await expect(card).toHaveAttribute("data-input-state", "ready");
  await expect(page.getByTestId("audio-node-audio-source").getByRole("alert"))
    .toHaveCount(0);

  const response = await request.get(`/api/canvas/${canvasId}`);
  const document = await response.json() as {
    nodes: Array<{ data: { assetId?: string }; id: string }>;
  };
  const assetId = document.nodes.find((node) => node.id === "audio-source")?.data.assetId;
  if (assetId) await request.delete(`/api/audio-assets/${assetId}`);
  await request.delete(`/api/canvas/${canvasId}`);
});

test.describe.serial("trusted duration blocks an invalid paid Video request before queueing", () => {
  test.beforeAll(async ({ request }) => {
    const providerResponse = await request.post("/api/admin/providers", {
      data: {
        apiKey: "zero-provider-media-safety-key",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: "P3 Media Safety Ark",
      },
    });
    expect(providerResponse.status()).toBe(201);
    const provider = (await providerResponse.json() as { profile: { id: string } }).profile;
    const modelResponse = await request.post("/api/admin/models", {
      data: {
        capability: "video",
        costCurrency: "CNY",
        displayName: "P3 Paid Media Safety",
        isDefault: false,
        maxCostMicrounits: 1,
        parameterSchema: knownModelParameterSchema({
          capability: "video",
          providerDriver: "volcengine-ark",
          providerModelId: "doubao-seedance-2-0-mini-260615",
        }),
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId: provider.id,
        sortOrder: 9_310,
        status: "published",
      },
    });
    expect(modelResponse.status()).toBe(201);
    integrationModelId = (await modelResponse.json() as { model: { id: string } }).model.id;

    for (let index = 0; index < integrationAssetIds.length; index += 1) {
      await request.delete(`/api/video-assets/${integrationAssetIds[index]}`);
      const response = await request.post(
        `/api/video-assets/${integrationAssetIds[index]}`,
        {
          data: readFileSync(videoFiles[index]),
          headers: {
            "Content-Type": "video/mp4",
            "X-File-Name": `eight-seconds-${index + 1}.mp4`,
          },
        },
      );
      expect(response.status()).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        durationSeconds: 8,
      });
    }
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/canvas/${integrationCanvasId}`);
    for (const assetId of integrationAssetIds) {
      await request.delete(`/api/video-assets/${assetId}`);
    }
    if (integrationModelId) {
      await request.patch(`/api/admin/models/${integrationModelId}`, {
        data: { isDefault: false, status: "disabled" },
      });
    }
    rmSync(fixtureDirectory, { force: true, recursive: true });
  });

  test("two trusted eight-second videos are rejected with zero Provider requests and zero tasks", async ({
    request,
  }) => {
    await request.delete(`/api/canvas/${integrationCanvasId}`);
    const saved = await request.put(`/api/canvas/${integrationCanvasId}`, {
      data: {
        edges: integrationAssetIds.map((_assetId, index) => ({
          data: { inputOrder: index + 1, inputRole: "reference-video" },
          id: `p3-duration-edge-${index + 1}`,
          source: `p3-duration-source-${index + 1}`,
          target: "p3-duration-target",
        })),
        nodes: [
          ...integrationAssetIds.map((assetId, index) => ({
            data: {
              assetId,
              title: `参考视频${index + 1}`,
              videoDuration: 1,
              videoSrc: `/api/video-assets/${assetId}`,
            },
            id: `p3-duration-source-${index + 1}`,
            type: "video",
          })),
          {
            data: {
              title: "目标视频",
              videoPrompt: "使用两段参考视频生成完整镜头",
            },
            id: "p3-duration-target",
            type: "video",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const revision = (await saved.json() as { revision: number }).revision;
    const body = {
      canvasId: integrationCanvasId,
      canvasRevision: revision,
      idempotencyKey: "p3-provider-duration-must-not-queue",
      inputSchemaVersion: 1,
      kind: "video",
      model: integrationModelId,
      nodeId: "p3-duration-target",
      ownPrompt: "使用两段参考视频生成完整镜头",
      parameters: { inputMode: "multimodal" },
    };
    const before = await paidRequests(request);
    const preflightResponse = await request.post("/api/generation-tasks/preflight", {
      data: body,
    });
    expect(preflightResponse.ok()).toBeTruthy();
    const preflight = await preflightResponse.json() as {
      canSubmit: boolean;
      problems: Array<{ edgeId?: string; message: string }>;
      providerRequests: number;
    };
    expect(preflight.canSubmit).toBeFalsy();
    expect(preflight.providerRequests).toBe(0);
    expect(preflight.problems).toContainEqual(expect.objectContaining({
      edgeId: "p3-duration-edge-2",
      message: expect.stringContaining("总时长超过15秒"),
    }));

    const submission = await request.post("/api/generation-tasks", { data: body });
    expect(submission.status()).toBe(409);
    const tasks = await (await request.get(
      `/api/generation-tasks?canvasId=${integrationCanvasId}`,
    )).json() as { tasks: unknown[] };
    expect(tasks.tasks).toEqual([]);
    expect(await paidRequests(request)).toBe(before);
  });
});
