import { expect, test } from "./safe-test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveGeneratedAudio } from "../server/audioStorage";
import { openAppDatabase } from "../server/database";
import type { ProviderRequestDeadlineScheduler } from "../server/providerRequestDeadline";
import {
  downloadProviderResultMedia,
  safeProviderResultUrl,
} from "../server/providerResultMedia";

function wavFixture(seconds = 5, sampleRate = 8_000) {
  const sampleCount = Math.round(seconds * sampleRate);
  const dataSize = sampleCount * 2;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataSize, 40);
  return bytes;
}

const publicResolver = (async () => [{
  address: "8.8.8.8",
  family: 4 as const,
}]) as any;

function manualDeadline() {
  let callback: (() => void) | undefined;
  const scheduler: ProviderRequestDeadlineScheduler = {
    clearTimeout() {
      callback = undefined;
    },
    setTimeout(value) {
      callback = value;
      return "manual-deadline";
    },
  };
  return {
    expire() {
      const current = callback;
      if (!current) throw new Error("deadline is not armed");
      current();
    },
    options: { scheduler, timeoutMs: 10_000 },
  };
}

test("Provider result URLs reject credentials, local networks and leaked keys", async () => {
  const key = "relay/secret+test-key";
  const split = Math.floor(key.length / 2);
  for (const value of [
    `https://cdn.example.test/result.png?key=${key}`,
    `https://cdn.example.test/result.png?key=${key.slice(0, split)}\r${key.slice(split)}`,
    `https://cdn.example.test/result.png?key=${key.slice(0, split)}\n${key.slice(split)}`,
    `https://cdn.example.test/result.png?key=${key.slice(0, split)}\t${key.slice(split)}`,
    `https://cdn.example.test/result.png?key=${encodeURIComponent(key)}`,
    `https://cdn.example.test/result.png?key=${encodeURIComponent(encodeURIComponent(key))}`,
    "https://user:password@cdn.example.test/result.png",
    "http://cdn.example.test/result.png",
    "https://cdn.example.test:8443/result.png",
    "https://127.0.0.1/result.png",
    "https://192.168.1.8/result.png",
    "https://198.51.100.8/result.png",
    "https://[::1]/result.png",
    "https://[2001:db8::8]/result.png",
    "https://localhost/result.png",
    "https://media.local/result.png",
  ]) {
    expect(() => safeProviderResultUrl(value, key), value).toThrow();
  }
  expect(
    safeProviderResultUrl("https://cdn.example.test/result.png?expires=300", key)
      .toString(),
  ).toBe("https://cdn.example.test/result.png?expires=300");
});

test("Provider result fake fetchers require both safe-test and temporary-data gates", async () => {
  const previousSafeTest = process.env.UNBOUNDRY_SAFE_TEST;
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  let fetchCalls = 0;
  const fixture = () => downloadProviderResultMedia({
    apiKey: "safe-key",
    kind: "image" as const,
    resolver: publicResolver,
    testFetcher: (async () => {
      fetchCalls += 1;
      return new Response(Buffer.from("not reached"), {
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch,
    url: "https://cdn.example.test/result.png",
  });
  try {
    delete process.env.UNBOUNDRY_SAFE_TEST;
    await expect(fixture()).rejects.toMatchObject({ code: "FORMAT" });

    process.env.UNBOUNDRY_SAFE_TEST = "1";
    process.env.UNBOUNDRY_DATA_DIR =
      process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT;
    await expect(fixture()).rejects.toMatchObject({ code: "FORMAT" });
  } finally {
    if (previousSafeTest === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
    else process.env.UNBOUNDRY_SAFE_TEST = previousSafeTest;
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
  }
  expect(fetchCalls).toBe(0);
});

test("Provider media download is unauthenticated, redirect-free and type checked", async () => {
  const requests: Array<{ authorization: string | null; method?: string; redirect?: string }> = [];
  const result = await downloadProviderResultMedia({
    apiKey: "never-forward-this-key",
    testFetcher: (async (_url, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        method: init?.method,
        redirect: init?.redirect,
      });
      return new Response(Buffer.from("safe-png-fixture"), {
        headers: { "Content-Type": "image/png" },
      });
    }) as typeof fetch,
    kind: "image",
    resolver: publicResolver,
    url: "https://cdn.example.test/result.png?expires=300",
  });
  expect(result.contentType).toBe("image/png");
  expect(requests).toEqual([{
    authorization: null,
    method: "GET",
    redirect: "error",
  }]);
  await result.body.cancel();

  await expect(downloadProviderResultMedia({
    apiKey: "safe-key",
    testFetcher: (async () => new Response(Buffer.from("html"), {
      headers: { "Content-Type": "text/html" },
    })) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/result.mp4",
  })).rejects.toMatchObject({ code: "FORMAT" });

  const audio = await downloadProviderResultMedia({
    apiKey: "safe-key",
    expectedContentType: "audio/mp4",
    testFetcher: (async () => new Response(Buffer.from("m4a"), {
      headers: { "Content-Type": "application/octet-stream" },
    })) as typeof fetch,
    kind: "audio",
    resolver: publicResolver,
    url: "https://cdn.example.test/result.m4a",
  });
  expect(audio.contentType).toBe("audio/mp4");
  await audio.body.cancel();

  for (const remoteType of ["audio/ogg; codecs=opus", "application/ogg"]) {
    const ogg = await downloadProviderResultMedia({
      apiKey: "safe-key",
      testFetcher: (async () => new Response(Buffer.from("OggS OpusHead"), {
        headers: { "Content-Type": remoteType },
      })) as typeof fetch,
      kind: "audio",
      resolver: publicResolver,
      url: "https://cdn.example.test/result.ogg",
    });
    expect(ogg.contentType).toBe("audio/ogg");
    await ogg.body.cancel();
  }
  const opaqueOgg = await downloadProviderResultMedia({
    apiKey: "safe-key",
    expectedContentType: "audio/ogg",
    testFetcher: (async () => new Response(Buffer.from("OggS OpusHead"), {
      headers: { "Content-Type": "application/octet-stream" },
    })) as typeof fetch,
    kind: "audio",
    resolver: publicResolver,
    url: "https://cdn.example.test/result-opaque.ogg",
  });
  expect(opaqueOgg.contentType).toBe("audio/ogg");
  await opaqueOgg.body.cancel();
});

test("Provider result hard deadline covers request and complete body consumption", async () => {
  const requestTimer = manualDeadline();
  let requestSignal: AbortSignal | null | undefined;
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const pending = downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: requestTimer.options,
    testFetcher: (async (_url, init) => {
      requestSignal = init?.signal;
      requestStarted();
      return await new Promise<Response>(() => undefined);
    }) as typeof fetch,
    kind: "image",
    resolver: publicResolver,
    url: "https://cdn.example.test/request-timeout.png",
  });
  await started;
  requestTimer.expire();
  await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(requestSignal?.aborted).toBe(true);

  const bodyTimer = manualDeadline();
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: bodyTimer.options,
    testFetcher: (async () => new Response(new ReadableStream<Uint8Array>({
      start() {
        // Headers arrive, but the fake CDN never finishes the body.
      },
    }), {
      headers: { "Content-Type": "video/mp4" },
      status: 200,
    })) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/body-timeout.mp4",
  });
  const read = downloaded.body.getReader().read();
  bodyTimer.expire();
  await expect(read).rejects.toMatchObject({ code: "TIMEOUT" });
});

test("Provider result stream maps caller abort to CANCELLED", async () => {
  const timer = manualDeadline();
  const controller = new AbortController();
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: (async () => new Response(new ReadableStream<Uint8Array>({
      start() {
        // The body remains pending until the caller aborts.
      },
    }), {
      headers: { "Content-Type": "audio/mpeg" },
      status: 200,
    })) as typeof fetch,
    kind: "audio",
    resolver: publicResolver,
    signal: controller.signal,
    url: "https://cdn.example.test/cancelled.mp3",
  });
  const read = downloaded.body.getReader().read();
  controller.abort();
  await expect(read).rejects.toMatchObject({ code: "CANCELLED" });
});

test("Provider result mid-stream failures map to NETWORK instead of leaking raw errors", async () => {
  const timer = manualDeadline();
  let pulls = 0;
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: (async () => new Response(new ReadableStream<Uint8Array>({
      pull(streamController) {
        pulls += 1;
        if (pulls === 1) {
          streamController.enqueue(new Uint8Array([1, 2, 3]));
        } else {
          streamController.error(new TypeError("connection terminated mid-body"));
        }
      },
    }), {
      headers: { "Content-Type": "image/png" },
      status: 200,
    })) as typeof fetch,
    kind: "image",
    resolver: publicResolver,
    url: "https://cdn.example.test/stream-interrupted.png",
  });
  const reader = downloaded.body.getReader();
  const first = await reader.read();
  expect(first.done).toBe(false);
  await expect(reader.read()).rejects.toMatchObject({
    code: "NETWORK",
    message: "模型结果暂时无法下载",
  });
});

test("Provider result private and mixed DNS answers are blocked before download", async () => {
  let fetchCalls = 0;
  for (const records of [
    [{ address: "10.0.0.8", family: 4 }],
    [
      { address: "8.8.8.8", family: 4 },
      { address: "fd00::8", family: 6 },
    ],
  ]) {
    await expect(downloadProviderResultMedia({
      apiKey: "safe-key",
      testFetcher: (async () => {
        fetchCalls += 1;
        return new Response(Buffer.from("not reached"));
      }) as typeof fetch,
      kind: "audio",
      resolver: (async () => records) as any,
      url: "https://cdn.example.test/result.mp3",
    })).rejects.toMatchObject({ code: "FORMAT" });
  }
  expect(fetchCalls).toBe(0);
});

test("generated WAV reads a complete probe and is saved without a Provider request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-wav-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const ownerId = "relay-wav-owner";
    const timestamp = new Date().toISOString();
    const database = openAppDatabase(directory);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, "Relay WAV", "fixture-only", timestamp, timestamp);
    database.close();

    const fixture = wavFixture();
    expect(fixture.length).toBeGreaterThan(64 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(fixture.subarray(0, 12));
        controller.enqueue(fixture.subarray(12, 37));
        controller.enqueue(fixture.subarray(37));
        controller.close();
      },
    });
    const saved = await saveGeneratedAudio({
      body,
      contentType: "audio/wav",
      label: "WAV fixture",
      ownerId,
    });

    expect(saved).toMatchObject({
      byteSize: fixture.length,
      contentType: "audio/wav",
      storageBackend: "local",
    });
    expect(saved.assetId).toMatch(/\.wav$/);
    expect(saved.durationSeconds).toBeGreaterThan(0);
    expect(await readFile(join(directory, "media", saved.assetId))).toEqual(fixture);
  } finally {
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});

test("generated OGG Opus is probed and persisted with its canonical private-media type", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-relay-ogg-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const ownerId = "relay-ogg-owner";
    const timestamp = new Date().toISOString();
    const database = openAppDatabase(directory);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, "Relay OGG", "fixture-only", timestamp, timestamp);
    database.close();

    const fixturePath = join(directory, "fixture.ogg");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=0.25",
      "-c:a",
      "libopus",
      fixturePath,
    ]);
    const fixture = await readFile(fixturePath);
    const saved = await saveGeneratedAudio({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(fixture.subarray(0, 17));
          controller.enqueue(fixture.subarray(17));
          controller.close();
        },
      }),
      contentType: "audio/ogg",
      label: "OGG Opus fixture",
      ownerId,
    });

    expect(saved).toMatchObject({
      byteSize: fixture.length,
      contentType: "audio/ogg",
      storageBackend: "local",
    });
    expect(saved.assetId).toMatch(/\.ogg$/);
    expect(saved.durationSeconds).toBeGreaterThan(0);
    expect(await readFile(join(directory, "media", saved.assetId))).toEqual(fixture);

    const checkDatabase = openAppDatabase(directory);
    const persisted = checkDatabase.prepare(`
      SELECT content_type, duration_status, owner_id, storage_backend,
             storage_status
      FROM media_assets
      WHERE kind = 'audio' AND id = ?
    `).get(saved.assetId) as Record<string, unknown>;
    checkDatabase.close();
    expect(persisted).toEqual({
      content_type: "audio/ogg",
      duration_status: "ready",
      owner_id: ownerId,
      storage_backend: "local",
      storage_status: "ready",
    });
  } finally {
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});
