import { expect, test } from "./safe-test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGenerationTaskStore,
  generationProviderAttemptCounts,
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

  const grokTask = relayTask("video", "media-generate", {
    parameters: {
      aspectRatio: "16:9",
      duration: "1",
      inputSchemaVersion: 1,
      inputs: [
        { assetId: "first.png", kind: "image", order: 1, role: "first-frame", sourceNodeId: "first" },
      ],
      resolution: "480p",
    },
    providerModelId: "grok-imagine-video-1.5-preview",
  });

  await expect(relayMediaParametersForTask(grokTask, async ({ assetId }) =>
    `https://signed.example.test/${assetId}?expires=300`
  )).resolves.toEqual({
    aspect_ratio: "16:9",
    duration: "1",
    images: ["https://signed.example.test/first.png?expires=300"],
    resolution: "480p",
  });

  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      parameters: { inputSchemaVersion: 1, inputs: [] },
      providerModelId: "grok-imagine-video-1.5-preview",
    }),
    async () => "https://signed.example.test/unused",
  )).rejects.toMatchObject({ code: "FORMAT" });

  await expect(relayMediaParametersForTask(
    relayTask("video", "media-generate", {
      parameters: {
        inputSchemaVersion: 1,
        inputs: [
          { assetId: "first.png", kind: "image", order: 1, role: "first-frame", sourceNodeId: "first" },
          { assetId: "second.png", kind: "image", order: 2, role: "first-frame", sourceNodeId: "second" },
        ],
      },
      providerModelId: "grok-imagine-video-1.5-preview",
    }),
    async ({ assetId }) => `https://signed.example.test/${assetId}?expires=300`,
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

test("GPT Image maps documented Youchuang size tiers and blocks missing combos", () => {
  const youchuangSizes = {
    "1k": {
      "1:1": "1024x1024",
      "2:3": "1024x1536",
      "3:2": "1536x1024",
      "3:4": "960x1280",
      "4:3": "1280x960",
      "9:16": "1088x1920",
      "16:9": "1920x1088",
      "4:5": "1024x1280",
      "5:4": "1280x1024",
      "1:2": "960x1920",
      "2:1": "1920x960",
    },
    "2k": {
      "1:1": "2048x2048",
      "2:3": "2048x3072",
      "3:2": "3072x2048",
      "3:4": "1920x2560",
      "4:3": "2560x1920",
      "9:16": "1440x2560",
      "16:9": "2560x1440",
      "4:5": "2048x2560",
      "5:4": "2560x2048",
      "1:2": "1280x2560",
      "2:1": "2560x1280",
    },
    "4k": {
      "1:1": "2880x2880",
      "2:3": "2304x3456",
      "3:2": "3456x2304",
      "3:4": "2400x3200",
      "4:3": "3200x2400",
      "9:16": "2160x3840",
      "16:9": "3840x2160",
      "4:5": "2560x3200",
      "5:4": "3200x2560",
      "1:2": "1920x3840",
      "2:1": "3840x1920",
    },
  } as const;
  expect(gptImageSizeForAspectRatio("auto")).toBe("auto");
  expect(gptImageSizeForAspectRatio("auto", "4k")).toBe("auto");
  for (const tier of ["1k", "2k", "4k"] as const) {
    for (const [ratio, size] of Object.entries(youchuangSizes[tier])) {
      expect(gptImageSizeForAspectRatio(ratio, tier)).toBe(size);
    }
  }
  // 文档没有的组合必须拦截：21:9 各档都没有，未知比例也一样。
  expect(() => gptImageSizeForAspectRatio("21:9", "1k")).toThrow();
  expect(() => gptImageSizeForAspectRatio("21:9", "4k")).toThrow();
  expect(() => gptImageSizeForAspectRatio("7:5", "1k")).toThrow();
});

test("gpt-image size lookup honors the admin map, then the built-in table", () => {
  const adminMap = { "4k": { "9:16": "1792x1024" } };
  expect(gptImageSizeForAspectRatio("9:16", "4k", adminMap))
    .toBe("1792x1024");
  expect(gptImageSizeForAspectRatio("16:9", "4k", adminMap))
    .toBe("3840x2160");
  expect(gptImageSizeForAspectRatio(
    "auto",
    "4k",
    { "4k": { auto: "1024x1024" } },
  )).toBe("1024x1024");
  // 管理员没填的组合仍然按文档内置表/拦截，不乱发。
  expect(() => gptImageSizeForAspectRatio("21:9", "4k", adminMap)).toThrow();
  expect(() => gptImageSizeForAspectRatio(
    "7:5",
    "1k",
    { "1k": { "9:16": "1088x1920" } },
  )).toThrow();
});

test("gpt-image tasks snapshot the admin size map for later retries", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "unboundry-gpt-size-map-snapshot-"),
  );
  try {
    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "gpt-size-map-snapshot",
      costCurrency: "USD",
      estimatedCostMicrounits: 1_000_000,
      idempotencyKey: "gpt-size-map-snapshot-request",
      kind: "image",
      model: "gpt-image-2",
      modelConfiguration: {
        modelId: "gpt-image-2",
        parameterSchema: {
          sizeMap: { "4k": { "9:16": "1792x1024" } },
        },
        providerModelId: "gpt-image-2",
        providerProfileId: relayProfile.id,
        providerProtocol: "gpt-image",
      },
      nodeId: "image-node",
      ownerId: "__test__",
      parameters: {
        aspectRatio: "9:16",
        inputSchemaVersion: 1,
        inputs: [],
        quality: "4k",
      },
      prompt: "尺寸映射快照测试",
      providerModelId: "gpt-image-2",
      providerProfileId: relayProfile.id,
    });
    store.close();

    const reopened = createGenerationTaskStore(directory);
    expect(reopened.get(created.task.id)).toMatchObject({
      modelConfiguration: {
        modelId: "gpt-image-2",
        parameterSchema: {
          sizeMap: { "4k": { "9:16": "1792x1024" } },
        },
        providerProtocol: "gpt-image",
      },
      parameters: {
        aspectRatio: "9:16",
        quality: "4k",
      },
    });
    reopened.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
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
      ownerId: "__test__",
      prompt: "image",
      providerModelId: "relay-image-model",
      providerProfileId: relayProfile.id,
    });
    store.transition(created.task.id, "running");
    store.recordProviderAttempt(created.task.id);
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

test("a lost relay response remains outcome-unknown across reopen and blocks paid retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-unknown-outcome-"));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  try {
    store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "relay-unknown-outcome-canvas",
      idempotencyKey: "relay-unknown-outcome-0001",
      kind: "text",
      modelConfiguration: {
        providerConfigurationVersion: 1,
        providerDriver: "multi-protocol-relay",
        providerProtocol: "openai-chat",
      },
      nodeId: "relay-unknown-outcome-node",
      ownerId: "__test__",
      parameters: { inputSchemaVersion: 1, inputs: [] },
      prompt: "the remote may have received this exact request",
      providerModelId: "relay-text-model",
      providerProfileId: relayProfile.id,
    });
    let providerSubmits = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => ({
        profile: relayProfile,
        release() {},
      }),
      fetcher: async () => {
        providerSubmits += 1;
        throw new TypeError("synthetic response lost after request acceptance");
      },
      mediaUrlForOwner: async () => "unused",
      store,
    });

    expect(providerSubmits).toBe(1);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "NETWORK",
      providerTaskId: undefined,
      state: "failed",
    });
    expect(store.getProviderAttemptForTask(created.task.id)).toMatchObject({
      executionAttempt: 1,
      failureCode: "NETWORK",
      outcome: "outcome-unknown",
    });

    store.close();
    store = undefined;
    const reopened = createGenerationTaskStore(directory);
    const failed = reopened.get(created.task.id);
    expect(reopened.getProviderAttemptForTask(created.task.id)).toMatchObject({
      executionAttempt: 1,
      failureCode: "NETWORK",
      outcome: "outcome-unknown",
    });
    reopened.close();
    expect(failed).toBeTruthy();

    const countsBeforeDecision = openAppDatabase(directory);
    const before = {
      events: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events
      `).get() as { count: number }).count),
      history: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM asset_history
      `).get() as { count: number }).count),
      media: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
      `).get() as { count: number }).count),
      tasks: Number((countsBeforeDecision.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get() as { count: number }).count),
    };
    countsBeforeDecision.close();

    expect(retrySafetyDecision(failed!)).toMatchObject({
      allowed: false,
      code: "RETRY_OUTCOME_UNKNOWN",
    });

    const countsAfterDecision = openAppDatabase(directory);
    try {
      expect({
        events: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM generation_task_events
        `).get() as { count: number }).count),
        history: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM asset_history
        `).get() as { count: number }).count),
        media: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM media_assets
        `).get() as { count: number }).count),
        tasks: Number((countsAfterDecision.prepare(`
          SELECT COUNT(*) AS count FROM generation_tasks
        `).get() as { count: number }).count),
      }).toEqual(before);
      expect(generationProviderAttemptCounts(countsAfterDecision)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 1,
      });
    } finally {
      countsAfterDecision.close();
    }
    expect(providerSubmits).toBe(1);
  } finally {
    store?.close();
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});
