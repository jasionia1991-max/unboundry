import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGenerationTaskStore,
  type GenerationTask,
} from "../server/generationTaskStore";
import { openAppDatabase } from "../server/database";
import { removeUnpublishedGeneratedMedia } from "../server/generatedMediaCleanup";
import { registerMediaForOwner } from "../server/mediaRegistry";
import {
  executeTextTaskWithDependencies,
  gptImageSizeForAspectRatio,
  generationTaskCancellationMode,
  relayMediaParametersForTask,
  retrySafetyDecision,
} from "../server/generationTasks";
import type { ProviderProfile } from "../server/providerProfiles";

const relayProfile: ProviderProfile = {
  apiKey: "relay-runtime-fixture-secret",
  baseUrl: "https://relay.example.test/v1",
  configurationVersion: 1,
  createdAt: "2026-08-03T00:00:00.000Z",
  driver: "multi-protocol-relay",
  id: "relay-runtime-profile",
  label: "Relay runtime fixture",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

function paidProviderAttempts(directory: string) {
  const database = openAppDatabase(directory);
  try {
    return Number((database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_provider_attempts
      WHERE evidence = 'provider-boundary'
    `).get() as { count: number }).count);
  } finally {
    database.close();
  }
}

function relayTask(
  kind: GenerationTask["kind"],
  providerProtocol: string,
  overrides: Partial<GenerationTask> = {},
): GenerationTask {
  return {
    attempt: 1,
    canvasId: "relay-runtime-canvas",
    costCurrency: "USD",
    createdAt: "2026-08-03T00:00:00.000Z",
    id: `relay-${kind}-task`,
    idempotencyKey: `relay-${kind}-idempotency-001`,
    kind,
    model: `relay-${kind}-model`,
    modelConfiguration: {
      providerConfigurationVersion: 1,
      providerDriver: "multi-protocol-relay",
      providerProtocol,
    },
    nodeId: `relay-${kind}-node`,
    ownerId: "__test__",
    parameters: { inputSchemaVersion: 1, inputs: [] },
    prompt: "fixture prompt",
    providerModelId: `vendor/${kind}-model`,
    providerProfileId: relayProfile.id,
    state: "failed",
    updatedAt: "2026-08-03T00:00:01.000Z",
    ...overrides,
  };
}

test("Gemini relay Text materializes ordered four-kind context once and persists no transient URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-text-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-runtime-canvas",
      costCurrency: "USD",
      estimatedCostMicrounits: 2_000_000,
      idempotencyKey: "relay-gemini-text-idempotency-001",
      kind: "text",
      model: "relay-gemini-text-model",
      modelConfiguration: {
        providerConfigurationVersion: 1,
        providerDriver: "multi-protocol-relay",
        providerProtocol: "gemini-generate-content",
      },
      nodeId: "relay-gemini-text-node",
      ownerId: "__test__",
      parameters: {
        inputSchemaVersion: 1,
        inputs: [
          { kind: "text", order: 1, role: "context-text", sourceNodeId: "text-up", text: "上游文字" },
          { assetId: "image.png", kind: "image", order: 2, role: "context-image", sourceNodeId: "image-up" },
          { assetId: "video.mp4", kind: "video", order: 3, role: "context-video", sourceNodeId: "video-up" },
          { assetId: "audio.mp3", kind: "audio", order: 4, role: "context-audio", sourceNodeId: "audio-up" },
        ],
        maxOutputTokens: 64,
        outputCount: 1,
        temperature: 0,
      },
      prompt: "根据四类上下文生成说明",
      providerModelId: "gemini-fixture-model",
      providerProfileId: relayProfile.id,
    });
    const requestBodies: unknown[] = [];
    let providerCalls = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({ profile: relayProfile, release() {} }),
      fetcher: async (_input, init) => {
        providerCalls += 1;
        requestBodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          candidates: [{ content: { parts: [{ text: "生成成功" }] } }],
          usageMetadata: {
            candidatesTokenCount: 8,
            promptTokenCount: 32,
            totalTokenCount: 40,
          },
        });
      },
      mediaContentTypeForOwner: ({ kind }) =>
        kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
      mediaUrlForOwner: async ({ kind }) =>
        kind === "image"
          ? "data:image/png;base64,ZmFrZQ=="
          : kind === "audio"
            ? "data:audio/mp3;base64,ZmFrZQ=="
            : "https://signed.example.test/video.mp4?expires=300",
      store,
    });
    expect(providerCalls).toBe(1);
    expect(requestBodies[0]).toMatchObject({
      contents: [{
        parts: [
          { text: "上游文字" },
          { inlineData: { mimeType: "image/png" } },
          { fileData: { mimeType: "video/mp4" } },
          { inlineData: { mimeType: "audio/mpeg" } },
          { text: "根据四类上下文生成说明" },
        ],
        role: "user",
      }],
      generationConfig: { maxOutputTokens: 64, temperature: 0 },
    });
    expect(store.get(created.task.id)).toMatchObject({
      actualCostMicrounits: 2_000_000,
      providerUsageTokens: 40,
      resultText: "生成成功",
      state: "success",
    });
    expect(JSON.stringify(store.get(created.task.id))).not.toContain("signed.example.test");
    expect(paidProviderAttempts(directory)).toBe(1);
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("unsupported relay Text context fails before Provider boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-text-reject-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-runtime-canvas",
      idempotencyKey: "relay-chat-video-reject-001",
      kind: "text",
      modelConfiguration: { providerProtocol: "openai-chat" },
      nodeId: "relay-chat-video-node",
      ownerId: "__test__",
      parameters: {
        inputs: [{
          assetId: "video.mp4",
          kind: "video",
          order: 1,
          role: "context-video",
          sourceNodeId: "video-up",
        }],
      },
      prompt: "分析视频",
      providerModelId: "chat-fixture-model",
      providerProfileId: relayProfile.id,
    });
    let providerCalls = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({ profile: relayProfile, release() {} }),
      fetcher: async () => {
        providerCalls += 1;
        return Response.json({});
      },
      mediaContentTypeForOwner: () => "video/mp4",
      mediaUrlForOwner: async () => "https://signed.example.test/video.mp4",
      store,
    });
    expect(providerCalls).toBe(0);
    expect(paidProviderAttempts(directory)).toBe(0);
    expect(store.get(created.task.id)).toMatchObject({ errorCode: "FORMAT", state: "failed" });
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("relay media parameters use explicit role mapping and keep transient URLs out of snapshots", async () => {
  const task = relayTask("video", "media-generate", {
    parameters: {
      aspectRatio: "16:9",
      inputSchemaVersion: 1,
      inputs: [
        { assetId: "first.png", kind: "image", order: 1, role: "first-frame", sourceNodeId: "first" },
        { assetId: "voice.mp3", kind: "audio", order: 2, role: "reference-audio", sourceNodeId: "voice" },
        { assetId: "style.png", kind: "image", order: 3, role: "reference-image", sourceNodeId: "style" },
      ],
      references: [{ secretLegacyField: "not-forwarded" }],
    },
  });
  const before = JSON.stringify(task.parameters);
  const materialized = await relayMediaParametersForTask(task, async ({ assetId }) =>
    `https://signed.example.test/${assetId}?expires=300`
  );
  expect(materialized).toEqual({
    aspect_ratio: "16:9",
    first_frame_url: "https://signed.example.test/first.png?expires=300",
    reference_audio_url: "https://signed.example.test/voice.mp3?expires=300",
    reference_image_url: "https://signed.example.test/style.png?expires=300",
  });
  expect(JSON.stringify(task.parameters)).toBe(before);
  expect(before).not.toContain("signed.example.test");

  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      parameters: { custom_unmapped_12345678: "must-not-leave" },
    }),
    async () => "https://signed.example.test/unused",
  )).rejects.toMatchObject({ code: "FORMAT" });
});

test("Doubao TTS relay audio maps documented UI fields without forwarding snapshots", async () => {
  const task = relayTask("audio", "media-generate", {
    providerModelId: "doubao-tts-2.0",
    parameters: {
      emotion: "happy",
      emotionScale: 4,
      format: "mp3",
      inputSchemaVersion: 1,
      inputs: [],
      outputCount: 1,
      speaker: "zh_female_vv_uranus_bigtts",
      speechRate: "0",
    },
  });
  const before = JSON.stringify(task.parameters);
  const materialized = await relayMediaParametersForTask(
    task,
    async () => "https://signed.example.test/unused",
  );

  expect(materialized).toEqual({
    emotion: "happy",
    emotion_scale: 4,
    format: "mp3",
    speaker: "zh_female_vv_uranus_bigtts",
    speech_rate: "0",
  });
  expect(JSON.stringify(task.parameters)).toBe(before);
  expect(before).not.toContain("signed.example.test");
});

test("Doubao TTS execution drops stale emotion scale while automatic emotion is active", async () => {
  const task = relayTask("audio", "media-generate", {
    providerModelId: "doubao-tts-2.0",
    parameters: {
      emotion: "auto",
      emotionScale: 5,
      format: "ogg_opus",
      inputSchemaVersion: 1,
      inputs: [],
      outputCount: 1,
      speaker: "zh_female_vv_uranus_bigtts",
      speechRate: "0",
    },
  });

  await expect(relayMediaParametersForTask(
    task,
    async () => "https://signed.example.test/unused",
  )).resolves.toEqual({
    emotion: "auto",
    format: "ogg_opus",
    speaker: "zh_female_vv_uranus_bigtts",
    speech_rate: "0",
  });
});

test("GPT Image maps supported canvas ratios to its bounded size contract", () => {
  expect(gptImageSizeForAspectRatio("auto")).toBe("auto");
  expect(gptImageSizeForAspectRatio("1:1")).toBe("1024x1024");
  expect(gptImageSizeForAspectRatio("16:9")).toBe("1536x1024");
  expect(gptImageSizeForAspectRatio("9:16")).toBe("1024x1536");
  expect(() => gptImageSizeForAspectRatio("7:5")).toThrow();
});

test("a cancelled relay publication removes its local media and history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-cleanup-"));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const assetId = "fixture-unpublished.png";
  const storageName = assetId;
  try {
    const store = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
    `).run(
      "__test__",
      "relay-cleanup-test",
      "Relay cleanup test",
      "fixture-password-hash",
      timestamp,
      timestamp,
    );
    store.close();
    await mkdir(join(directory, "media"), { recursive: true });
    await writeFile(join(directory, "media", storageName), "fixture");
    registerMediaForOwner("__test__", {
      byteSize: 7,
      checksumSha256: "0".repeat(64),
      contentType: "image/png",
      id: assetId,
      kind: "image",
      storageName,
    });
    const history = openAppDatabase(directory);
    history.prepare(`
      INSERT INTO asset_history (
        account_id, id, kind, label, preview, created_at, owner_id
      ) VALUES (?, ?, 'image', ?, ?, ?, ?)
    `).run(
      "__test__",
      assetId,
      "fixture",
      `/api/assets/${assetId}`,
      new Date().toISOString(),
      "__test__",
    );
    history.close();

    await expect(removeUnpublishedGeneratedMedia({
      assetId,
      kind: "image",
      ownerId: "__test__",
    })).resolves.toBe(true);
    await expect(readFile(join(directory, "media", storageName))).rejects.toThrow();
    const checked = openAppDatabase(directory);
    expect((checked.prepare(`
      SELECT COUNT(*) AS count FROM media_assets WHERE id = ?
    `).get(assetId) as { count: number }).count).toBe(0);
    expect((checked.prepare(`
      SELECT COUNT(*) AS count FROM asset_history WHERE id = ?
    `).get(assetId) as { count: number }).count).toBe(0);
    checked.close();
  } finally {
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});

test("relay media image video and audio share local-only cancel and resumable task-id rules", async () => {
  for (const kind of ["image", "video", "audio"] as const) {
    const task = relayTask(kind, "media-generate", {
      errorCode: "TIMEOUT",
      providerTaskId: `remote:${kind}:001`,
      state: "failed",
    });
    expect(retrySafetyDecision(task)).toEqual({
      allowed: true,
      mode: "resume-provider-task",
    });
    expect(generationTaskCancellationMode({ ...task, state: "running" }))
      .toBe("cancel-relay-media-local");
  }

  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-image-retry-"));
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-runtime-canvas",
      idempotencyKey: "relay-image-preserve-id-001",
      kind: "image",
      modelConfiguration: { providerProtocol: "media-generate" },
      nodeId: "relay-image-node",
      prompt: "image",
    });
    store.transition(created.task.id, "running");
    store.setProviderTaskId(created.task.id, "remote:image:001");
    store.transition(created.task.id, "failed", { code: "TIMEOUT", message: "timeout" });
    store.transition(
      created.task.id,
      "retrying",
      undefined,
      { preserveProviderTaskId: true },
    );
    expect(store.get(created.task.id)?.providerTaskId).toBe("remote:image:001");
    store.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
