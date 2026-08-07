import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderProfile } from "../server/providerProfiles";
import {
  createGenerationTaskStore,
  failRecoveredGenerationTasks,
} from "../server/generationTaskStore";
import {
  cancelVolcengineArkVideoTask,
  createVolcengineArkVideoTask,
  getVolcengineArkVideoTask,
  type ArkVideoMediaInput,
} from "../server/volcengineArkVideoProvider";

const profile: ProviderProfile = {
  apiKey: "test-secret-must-not-leak",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  createdAt: "2026-08-01T00:00:00.000Z",
  driver: "volcengine-ark",
  id: "ark-test",
  label: "Ark test",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

test("Seedance Mini create request uses the selected supported parameters", async () => {
  let url = "";
  let request: RequestInit | undefined;
  const created = await createVolcengineArkVideoTask(
    profile,
    {
      duration: 15,
      generateAudio: false,
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "一只黑猫在窗边回头",
      ratio: "9:16",
      resolution: "720p",
    },
    async (input, init) => {
      url = String(input);
      request = init;
      return new Response(JSON.stringify({ id: "cgt-test-001" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
  );
  expect(created).toEqual({ id: "cgt-test-001" });
  expect(url).toBe(
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
  );
  expect(request?.method).toBe("POST");
  expect(new Headers(request?.headers).get("Authorization")).toBe(
    "Bearer test-secret-must-not-leak",
  );
  expect(JSON.parse(String(request?.body))).toEqual({
    content: [{ text: "一只黑猫在窗边回头", type: "text" }],
    duration: 15,
    generate_audio: false,
    model: "doubao-seedance-2-0-mini-260615",
    ratio: "9:16",
    resolution: "720p",
    watermark: false,
  });
});

test("Seedance Mini serializes ordered multimodal inputs after text without persisting adapter URLs", async () => {
  let request: RequestInit | undefined;
  const created = await createVolcengineArkVideoTask(
    profile,
    {
      duration: 5,
      generateAudio: true,
      inputs: [
        {
          kind: "audio",
          order: 4,
          role: "reference-audio",
          url: "https://signed.example.test/audio.mp3?expires=300",
        },
        {
          kind: "video",
          order: 3,
          role: "subject",
          url: "https://signed.example.test/subject.mp4?expires=300",
        },
        {
          kind: "image",
          order: 1,
          role: "first-frame",
          url: "https://signed.example.test/first.png?expires=300",
        },
        {
          kind: "image",
          order: 2,
          role: "subject",
          url: "https://signed.example.test/subject.png?expires=300",
        },
      ],
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "按参考素材制作商品展示视频",
      ratio: "16:9",
      resolution: "480p",
    },
    async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({ id: "cgt-multimodal-001" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
  );

  expect(created).toEqual({ id: "cgt-multimodal-001" });
  expect(JSON.parse(String(request?.body))).toEqual({
    content: [
      { text: "按参考素材制作商品展示视频", type: "text" },
      {
        image_url: { url: "https://signed.example.test/first.png?expires=300" },
        role: "first_frame",
        type: "image_url",
      },
      {
        image_url: { url: "https://signed.example.test/subject.png?expires=300" },
        role: "reference_image",
        type: "image_url",
      },
      {
        role: "reference_video",
        type: "video_url",
        video_url: { url: "https://signed.example.test/subject.mp4?expires=300" },
      },
      {
        audio_url: { url: "https://signed.example.test/audio.mp3?expires=300" },
        role: "reference_audio",
        type: "audio_url",
      },
    ],
    duration: 5,
    generate_audio: true,
    model: "doubao-seedance-2-0-mini-260615",
    ratio: "16:9",
    resolution: "480p",
    watermark: false,
  });
  expect(String(request?.body)).not.toContain('"role":"subject"');
});

test("Seedance Mini accepts a verified local MP3 as official audio Base64 without a network lookup", async () => {
  const encoded = Buffer.from("ID3-safe-local-audio-fixture", "utf8").toString("base64");
  let request: RequestInit | undefined;
  await createVolcengineArkVideoTask(
    profile,
    {
      inputs: [
        {
          kind: "image",
          order: 1,
          role: "reference-image",
          url: "https://signed.example.test/reference.png?expires=300",
        },
        {
          kind: "audio",
          order: 2,
          role: "reference-audio",
          url: `data:audio/mp3;base64,${encoded}`,
        },
      ],
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "使用本机音频制作视频",
    },
    async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({ id: "cgt-local-audio-001" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
  );
  expect(JSON.parse(String(request?.body)).content).toContainEqual({
    audio_url: { url: `data:audio/mp3;base64,${encoded}` },
    role: "reference_audio",
    type: "audio_url",
  });
});

test("Seedance Mini rejects invalid multimodal kind, role, order, URL and count before fetch", async () => {
  const valid: ArkVideoMediaInput = {
    kind: "image",
    order: 1,
    role: "reference-image",
    url: "https://signed.example.test/reference.png?expires=300",
  };
  const cases: Array<{ inputs: unknown; label: string }> = [
    {
      inputs: [{ ...valid, kind: "text" }],
      label: "kind",
    },
    {
      inputs: [{ ...valid, role: "reference-video" }],
      label: "role",
    },
    {
      inputs: [valid, { ...valid, role: "subject" }],
      label: "order",
    },
    {
      inputs: [{ ...valid, url: "http://127.0.0.1/private.png" }],
      label: "url",
    },
    {
      inputs: Array.from({ length: 10 }, (_, index) => ({
        ...valid,
        order: index + 1,
        url: `https://signed.example.test/reference-${index + 1}.png`,
      })),
      label: "count",
    },
  ];

  for (const entry of cases) {
    let calls = 0;
    await expect(createVolcengineArkVideoTask(
      profile,
      {
        inputs: entry.inputs as ArkVideoMediaInput[],
        model: "doubao-seedance-2-0-mini-260615",
        prompt: `invalid ${entry.label}`,
      },
      async () => {
        calls += 1;
        return new Response(JSON.stringify({ id: "must-not-run" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
    )).rejects.toMatchObject({ code: "FORMAT" });
    expect(calls, entry.label).toBe(0);
  }
});

test("Seedance Mini rejects unsupported parameters before any Provider request", async () => {
  let calls = 0;
  await expect(createVolcengineArkVideoTask(
    profile,
    {
      duration: 5,
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "不支持的参数测试",
      ratio: "2:3",
      resolution: "480p",
    },
    async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  )).rejects.toMatchObject({ code: "FORMAT" });
  expect(calls).toBe(0);
});

test("Seedance adapter limits are model-driven so future Seedance releases do not require adapter edits", async () => {
  const limits = {
    counts: { audio: 3, image: 9, video: 3 },
    durationMax: 30,
    durationMin: 4,
    maxBytes: {
      audio: 30 * 1024 * 1024,
      image: 20 * 1024 * 1024,
      video: 200 * 1024 * 1024,
    },
    ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
    resolutions: ["480p", "720p", "1080p"],
  };
  let body: Record<string, unknown> | undefined;
  const created = await createVolcengineArkVideoTask(
    profile,
    {
      duration: 30,
      limits,
      model: "doubao-seedance-2-5-260628",
      prompt: "未来Seedance模型",
      ratio: "16:9",
      resolution: "1080p",
    },
    async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "cgt-future-001" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
  );
  expect(created).toEqual({ id: "cgt-future-001" });
  expect(body).toMatchObject({
    duration: 30,
    model: "doubao-seedance-2-5-260628",
    ratio: "16:9",
    resolution: "1080p",
  });
  let calls = 0;
  await expect(createVolcengineArkVideoTask(
    profile,
    {
      duration: 31,
      limits,
      model: "doubao-seedance-2-5-260628",
      prompt: "超上限",
      ratio: "16:9",
      resolution: "1080p",
    },
    async () => {
      calls += 1;
      return new Response(JSON.stringify({ id: "must-not-run" }), { status: 200 });
    },
  )).rejects.toMatchObject({ code: "FORMAT" });
  expect(calls).toBe(0);
});

test("Seedance Mini status and cancellation use the original Provider task", async () => {
  const calls: Array<{ method: string; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ method: init?.method ?? "GET", url: String(input) });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({
      content: { video_url: "https://example.volccdn.com/result.mp4" },
      status: "succeeded",
      usage: { total_tokens: 250_000 },
    }), { headers: { "Content-Type": "application/json" }, status: 200 });
  };
  await expect(
    getVolcengineArkVideoTask(profile, "cgt-test-001", fetcher),
  ).resolves.toEqual({
    errorCode: undefined,
    errorMessage: undefined,
    providerUsageTokens: 250_000,
    state: "succeeded",
    videoUrl: "https://example.volccdn.com/result.mp4",
  });
  await cancelVolcengineArkVideoTask(profile, "cgt-test-001", fetcher);
  expect(calls).toEqual([
    {
      method: "GET",
      url: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-test-001",
    },
    {
      method: "DELETE",
      url: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-test-001",
    },
  ]);
});

test("Provider errors are safe and do not expose the key or remote response", async () => {
  const remoteBody = "remote-sensitive-details";
  const request = createVolcengineArkVideoTask(
    profile,
    {
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "safe prompt",
    },
    async () => new Response(remoteBody, { status: 500 }),
  );
  await expect(request).rejects.toThrow("火山方舟暂时无法处理视频任务");
  try {
    await request;
  } catch (error) {
    const message = String(error);
    expect(message).not.toContain(profile.apiKey);
    expect(message).not.toContain(remoteBody);
  }
});

test("service restart keeps the original Ark task id and does not create a duplicate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-ark-recovery-"));
  try {
    const first = createGenerationTaskStore(directory);
    const created = first.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 5_000_000,
      idempotencyKey: "ark-recovery-key-001",
      kind: "video",
      model: "seedance-mini",
      nodeId: "video-recovery",
      ownerId: "owner-test",
      prompt: "一只黑猫在窗边回头",
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProfileId: "ark-profile",
    });
    first.transition(created.task.id, "running");
    first.setProviderTaskId(created.task.id, "cgt-original-001");
    first.close();

    const reopened = createGenerationTaskStore(directory);
    expect(reopened.get(created.task.id)).toMatchObject({
      attempt: 1,
      providerTaskId: "cgt-original-001",
      state: "recovering",
    });
    expect(failRecoveredGenerationTasks(reopened)).toEqual([]);
    const resumed = reopened.resume(created.task.id);
    expect(resumed).toMatchObject({
      attempt: 1,
      providerTaskId: "cgt-original-001",
      state: "running",
    });
    expect(reopened.list("default")).toHaveLength(1);
    reopened.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
