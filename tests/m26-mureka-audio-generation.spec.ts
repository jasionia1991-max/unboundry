import { expect, test } from "./safe-test";
import { execFileSync } from "node:child_process";
import type { ProviderProfile } from "../server/providerProfiles";
import {
  createMurekaAudioTask,
  downloadMurekaAudioResult,
  getMurekaAudioTask,
  MurekaAudioError,
} from "../server/murekaAudioProvider";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { saveGeneratedMp3 } from "../server/audioStorage";
import { openAppDatabase } from "../server/database";

const profile: ProviderProfile & { apiKey: string } = {
  apiKey: "test-secret-never-returned",
  baseUrl: "https://api.mureka.ai",
  createdAt: "2026-08-02T00:00:00.000Z",
  driver: "mureka",
  id: "provider-mureka-test",
  label: "Mureka Test",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

test("Mureka task creation and polling use the official endpoints without real network", async () => {
  const calls: Array<{ body?: string; method?: string; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ body: String(init?.body ?? ""), method: init?.method, url });
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${profile.apiKey}`);
    if (url.endsWith("/v1/instrumental/generate")) {
      return new Response(JSON.stringify({ id: "mureka-task-001" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({
      choices: [{ duration: 12_345, url: "https://cdn.example.test/result.mp3" }],
      id: "mureka-task-001",
      status: "succeeded",
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };

  const created = await createMurekaAudioTask(profile, {
    model: "mureka-9",
    musicGenerationMode: "instrumental",
    outputCount: 1,
    prompt: "安静的钢琴配乐",
    streamPlayback: false,
  }, fetcher);
  expect(created).toEqual({ id: "mureka-task-001", queryKind: "instrumental" });
  const status = await getMurekaAudioTask(
    profile,
    created.id,
    created.queryKind,
    fetcher,
  );
  expect(status).toEqual({
    audioUrl: "https://cdn.example.test/result.mp3",
    durationMs: 12_345,
    state: "succeeded",
  });
  expect(JSON.parse(calls[0].body!)).toEqual({
    model: "mureka-9",
    n: 1,
    prompt: "安静的钢琴配乐",
    stream: false,
  });
  expect(calls.map(({ method, url }) => ({ method, url }))).toEqual([
    { method: "POST", url: "https://api.mureka.ai/v1/instrumental/generate" },
    { method: "GET", url: "https://api.mureka.ai/v1/instrumental/query/mureka-task-001" },
  ]);
});

test("Mureka polling normalizes pending, failure and safe errors", async () => {
  const pending = await getMurekaAudioTask(
    profile,
    "mureka-task-pending",
    "song",
    async () => new Response(JSON.stringify({ status: "streaming" }), { status: 200 }),
  );
  expect(pending).toEqual({ state: "pending" });

  const failed = await getMurekaAudioTask(
    profile,
    "mureka-task-failed",
    "song",
    async () => new Response(JSON.stringify({ message: "provider failed", status: "failed" }), { status: 200 }),
  );
  expect(failed).toEqual({
    errorMessage: "Mureka 未完成本次音频生成",
    state: "failed",
  });

  const auth = getMurekaAudioTask(
    profile,
    "mureka-task-auth",
    "song",
    async () => new Response(JSON.stringify({ message: "denied" }), { status: 401 }),
  );
  await expect(auth).rejects.toMatchObject({
    code: "AUTH",
    message: "Mureka 授权已失效，请管理员检查连接",
  });
  await expect(auth).rejects.not.toThrow(profile.apiKey);

  await expect(getMurekaAudioTask(
    profile,
    "mureka-task-unsafe",
    "song",
    async () => new Response(JSON.stringify({
      choices: [{ url: "http://127.0.0.1/result.mp3" }],
      status: "succeeded",
    }), { status: 200 }),
  )).rejects.toBeInstanceOf(MurekaAudioError);
});

test("Mureka remote errors and nested echoes never expose or persist the API key", async () => {
  const remoteEcho = {
    detail: {
      authorization: `Bearer ${profile.apiKey}`,
      headers: { "x-debug-key": profile.apiKey },
      url: `https://api.mureka.ai/debug/${profile.apiKey}`,
    },
    error: { message: profile.apiKey },
    message: `remote rejected ${profile.apiKey}`,
  };
  const serializeError = (error: unknown) => {
    if (!(error instanceof Error)) return JSON.stringify(error);
    return JSON.stringify({
      code: "code" in error ? error.code : undefined,
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
  };
  const captureError = async (operation: Promise<unknown>) => {
    try {
      await operation;
      throw new Error("expected operation to fail");
    } catch (error) {
      expect(serializeError(error)).not.toContain(profile.apiKey);
      expect(String(error)).not.toContain(profile.apiKey);
      return error;
    }
  };

  const authError = await captureError(getMurekaAudioTask(
    profile,
    "mureka-task-auth-echo",
    "song",
    async () => new Response(JSON.stringify(remoteEcho), {
      headers: { "x-remote-debug": profile.apiKey },
      status: 401,
    }),
  ));
  expect(authError).toMatchObject({
    code: "AUTH",
    message: "Mureka 授权已失效，请管理员检查连接",
  });

  const createError = await captureError(createMurekaAudioTask(profile, {
    model: "mureka-9",
    musicGenerationMode: "instrumental",
    outputCount: 1,
    prompt: "安静的钢琴配乐",
    streamPlayback: false,
  }, async () => new Response(JSON.stringify(remoteEcho), { status: 500 })));
  expect(createError).toMatchObject({
    code: "REMOTE",
    message: "Mureka 暂未接受本次请求",
  });

  const echoedTaskId = await captureError(createMurekaAudioTask(profile, {
    model: "mureka-9",
    musicGenerationMode: "instrumental",
    outputCount: 1,
    prompt: "安静的钢琴配乐",
    streamPlayback: false,
  }, async () => new Response(JSON.stringify({
    ...remoteEcho,
    id: profile.apiKey,
  }), { status: 200 })));
  expect(echoedTaskId).toMatchObject({ code: "FORMAT" });

  const failed = await getMurekaAudioTask(
    profile,
    "mureka-task-failed-echo",
    "song",
    async () => new Response(JSON.stringify({
      ...remoteEcho,
      status: "failed",
    }), { status: 200 }),
  );
  expect(JSON.stringify(failed)).not.toContain(profile.apiKey);
  expect(failed).toEqual({
    errorMessage: "Mureka 未完成本次音频生成",
    state: "failed",
  });

  const unsafeResult = await captureError(getMurekaAudioTask(
    profile,
    "mureka-task-result-echo",
    "song",
    async () => new Response(JSON.stringify({
      choices: [{
        nested: remoteEcho,
        url: `https://cdn.example.test/${encodeURIComponent(profile.apiKey)}.mp3`,
      }],
      status: "succeeded",
    }), { status: 200 }),
  ));
  expect(unsafeResult).toMatchObject({ code: "FORMAT" });

  const downloadError = await captureError(downloadMurekaAudioResult(
    profile,
    "https://cdn.example.test/result.mp3",
    async () => new Response(JSON.stringify(remoteEcho), {
      headers: {
        "content-type": "application/json",
        "x-remote-debug": profile.apiKey,
      },
      status: 500,
    }),
  ));
  expect(downloadError).toMatchObject({
    code: "REMOTE",
    message: "Mureka 暂未接受本次请求",
  });

  const readError = await captureError(getMurekaAudioTask(
    profile,
    "mureka-task-read-error",
    "song",
    async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error(`response read failed ${profile.apiKey}`);
      },
    }) as unknown as Response,
  ));
  expect(readError).toMatchObject({
    code: "NETWORK",
    message: "暂时无法连接 Mureka",
  });

  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-mureka-safe-error-"));
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "USD",
      estimatedCostMicrounits: 1_000_000,
      idempotencyKey: "mureka-safe-error-001",
      kind: "audio",
      model: "model-audio-mureka-v9",
      nodeId: "audio-node-safe-error",
      ownerId: "__test__",
      parameters: {
        musicGenerationMode: "instrumental",
        outputCount: 1,
        streamPlayback: false,
      },
      prompt: "安静的钢琴配乐",
      providerModelId: "mureka-9",
      providerProfileId: profile.id,
    });
    store.transition(created.task.id, "running");
    const persisted = store.transition(created.task.id, "failed", {
      code: "PROVIDER_FAILED",
      message: failed.errorMessage!,
    });
    expect(JSON.stringify(persisted)).not.toContain(profile.apiKey);
    store.close();

    const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    const records = database.prepare(`
      SELECT error_code, error_message
      FROM generation_tasks
      WHERE id = ?
      UNION ALL
      SELECT error_code, error_message
      FROM generation_task_events
      WHERE task_id = ?
    `).all(created.task.id, created.task.id);
    expect(JSON.stringify(records)).not.toContain(profile.apiKey);
    database.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("audio provider task id survives restart without creating a duplicate task", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-mureka-task-"));
  try {
    const first = createGenerationTaskStore(dataDirectory);
    const created = first.create({
      canvasId: "default",
      estimatedCostMicrounits: 1_000_000,
      idempotencyKey: "mureka-idempotency-001",
      kind: "audio",
      model: "model-audio-mureka-v9",
      nodeId: "audio-node-001",
      ownerId: "__test__",
      parameters: {
        musicGenerationMode: "instrumental",
        outputCount: 1,
        streamPlayback: false,
      },
      prompt: "轻柔钢琴",
      providerModelId: "mureka-9",
      providerProfileId: "provider-mureka-test",
    });
    first.transition(created.task.id, "running");
    first.setProviderTaskId(created.task.id, "mureka-provider-task-001");
    first.close();

    const reopened = createGenerationTaskStore(dataDirectory);
    expect(reopened.get(created.task.id)).toMatchObject({
      attempt: 1,
      kind: "audio",
      providerTaskId: "mureka-provider-task-001",
      state: "recovering",
    });
    expect(reopened.list("default")).toHaveLength(1);
    reopened.resume(created.task.id);
    expect(reopened.get(created.task.id)).toMatchObject({
      attempt: 1,
      providerTaskId: "mureka-provider-task-001",
      state: "running",
    });
    expect(reopened.create({
      canvasId: "default",
      estimatedCostMicrounits: 1_000_000,
      idempotencyKey: "mureka-idempotency-001",
      kind: "audio",
      model: "model-audio-mureka-v9",
      nodeId: "audio-node-001",
      ownerId: "__test__",
      parameters: {
        musicGenerationMode: "instrumental",
        outputCount: 1,
        streamPlayback: false,
      },
      prompt: "轻柔钢琴",
      providerModelId: "mureka-9",
      providerProfileId: "provider-mureka-test",
    })).toMatchObject({ created: false, task: { id: created.task.id } });
    expect(reopened.list("default")).toHaveLength(1);
    reopened.transition(created.task.id, "failed", {
      code: "TEST_COMPLETE",
      message: "test complete",
    });
    reopened.close();
  } finally {
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("a generated MP3 is checksummed, registered and added to audio history", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-mureka-audio-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    const setup = openAppDatabase(dataDirectory);
    const timestamp = new Date().toISOString();
    setup.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
    `).run(
      "owner-audio-test",
      "owner-audio-test",
      "Audio Test",
      "test-password-hash",
      timestamp,
      timestamp,
    );
    setup.close();
    const generatedFixture = join(dataDirectory, "mureka-generated-fixture.mp3");
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
      generatedFixture,
    ]);
    const bytes = await readFile(generatedFixture);
    const saved = await saveGeneratedMp3({
      body: new Response(bytes).body!,
      label: "Mureka 测试音频",
      ownerId: "owner-audio-test",
    });
    expect(saved.assetId).toMatch(/^[a-z0-9-]+\.mp3$/i);
    expect(await readFile(join(dataDirectory, "media", saved.assetId))).toEqual(bytes);
    const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      expect(database.prepare(`
        SELECT kind, storage_backend, storage_status, byte_size,
               duration_seconds, duration_source, duration_status
        FROM media_assets WHERE id = ?
      `).get(saved.assetId)).toMatchObject({
        byte_size: bytes.length,
        duration_seconds: expect.any(Number),
        duration_source: "server-probe",
        duration_status: "ready",
        kind: "audio",
        storage_backend: "local",
        storage_status: "ready",
      });
      expect(saved.durationSeconds).toBeGreaterThanOrEqual(3);
      expect(database.prepare(`
        SELECT kind, label, preview FROM asset_history WHERE id = ?
      `).get(saved.assetId)).toEqual({
        kind: "audio",
        label: "Mureka 测试音频",
        preview: `/api/audio-assets/${saved.assetId}`,
      });
    } finally {
      database.close();
    }
  } finally {
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
