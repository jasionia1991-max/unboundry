import { expect, test } from "./safe-test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveGeneratedAudio } from "../server/audioStorage";
import { validatePng } from "../server/assetStorage";
import { openAppDatabase, closeRuntimeDatabaseTransactions } from "../server/database";
import {
  createProviderRequestDeadline,
  type ProviderRequestDeadlineScheduler,
} from "../server/providerRequestDeadline";
import {
  downloadProviderResultMedia,
  safeProviderResultUrl,
} from "../server/providerResultMedia";
import { normalizeProviderImageToPng } from "../server/providerImageNormalization";
import { reserveMediaResources } from "../server/resourceBudget";

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

function manualDeadline(config: {
  idleTimeoutMs?: number;
  timeoutMs?: number;
} = { timeoutMs: 10_000 }) {
  let now = 0;
  let nextHandle = 0;
  const timers = new Map<string, {
    callback: () => void;
    dueAt: number;
  }>();
  const scheduledDurations: number[] = [];
  const scheduler: ProviderRequestDeadlineScheduler = {
    clearTimeout(handle) {
      timers.delete(String(handle));
    },
    setTimeout(callback, timeoutMs) {
      const handle = `manual-deadline-${++nextHandle}`;
      timers.set(handle, { callback, dueAt: now + timeoutMs });
      scheduledDurations.push(timeoutMs);
      return handle;
    },
  };
  const advance = (milliseconds: number) => {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new RangeError("manual time must advance by a non-negative integer");
    }
    const target = now + milliseconds;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!next) break;
      const [handle, timer] = next;
      now = timer.dueAt;
      timers.delete(handle);
      timer.callback();
    }
    now = target;
  };
  return {
    expire() {
      if (config.timeoutMs === undefined) {
        throw new Error("hard deadline override is not configured");
      }
      advance(config.timeoutMs);
    },
    advance,
    pendingTimerCount() {
      return timers.size;
    },
    scheduledDurations,
    options: {
      scheduler,
      ...(config.idleTimeoutMs === undefined
        ? {}
        : { idleTimeoutMs: config.idleTimeoutMs }),
      ...(config.timeoutMs === undefined
        ? {}
        : { timeoutMs: config.timeoutMs }),
    },
  };
}

function controlledBody() {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  return {
    body,
    close() {
      streamController?.close();
    },
    error(error: unknown) {
      streamController?.error(error);
    },
    push(chunk: Uint8Array) {
      streamController?.enqueue(chunk);
    },
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
  const requests: Array<{
    accept: string | null;
    authorization: string | null;
    method?: string;
    redirect?: string;
  }> = [];
  const result = await downloadProviderResultMedia({
    apiKey: "never-forward-this-key",
    testFetcher: (async (_url, init) => {
      requests.push({
        accept: new Headers(init?.headers).get("Accept"),
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
    accept: "image/png, image/jpeg, image/webp, image/gif",
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

test("Provider JPEG and WebP results are decoded into bounded canonical PNG assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-provider-image-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const ownerId = "provider-image-owner";
    const timestamp = new Date().toISOString();
    const database = openAppDatabase(directory);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
    `).run(ownerId, ownerId, "Provider image", "fixture-only", timestamp, timestamp);
    database.close();

    for (const fixture of [
      { contentType: "image/jpeg" as const, extension: "jpg" },
      { contentType: "image/webp" as const, extension: "webp" },
    ]) {
      const sourcePath = join(directory, `fixture.${fixture.extension}`);
      if (fixture.extension === "webp") {
        const sourcePng = join(directory, "fixture-source.png");
        execFileSync("ffmpeg", [
          "-y", "-loglevel", "error",
          "-f", "lavfi", "-i", "color=c=0x336699:s=96x64",
          "-frames:v", "1", sourcePng,
        ]);
        execFileSync("cwebp", ["-quiet", sourcePng, "-o", sourcePath]);
      } else {
        execFileSync("ffmpeg", [
          "-y", "-loglevel", "error",
          "-f", "lavfi", "-i", "color=c=0x336699:s=96x64",
          "-frames:v", "1", sourcePath,
        ]);
      }
      const source = await readFile(sourcePath);
      const normalized = await normalizeProviderImageToPng({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(source.subarray(0, 13));
            controller.enqueue(source.subarray(13));
            controller.close();
          },
        }),
        contentType: fixture.contentType,
        ownerId,
      });
      expect(normalized.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(validatePng(normalized)).toEqual({ height: 64, width: 96 });
    }

    const releaseFirst = await reserveMediaResources({
      bytes: 1,
      directory,
      ownerId: "provider-image-budget-a",
    });
    const releaseSecond = await reserveMediaResources({
      bytes: 1,
      directory,
      ownerId: "provider-image-budget-b",
    });
    let pulls = 0;
    try {
      await expect(normalizeProviderImageToPng({
        body: new ReadableStream<Uint8Array>({
          pull() {
            pulls += 1;
            throw new Error("image body was read before resource admission");
          },
        }, { highWaterMark: 0 }),
        contentType: "image/jpeg",
        ownerId,
      })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
      expect(pulls).toBe(0);
    } finally {
      releaseSecond();
      releaseFirst();
    }
  } finally {
    closeRuntimeDatabaseTransactions();
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(directory, { force: true, recursive: true });
  }
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
  expect(bodyTimer.pendingTimerCount()).toBe(0);
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
  expect(timer.pendingTimerCount()).toBe(0);
});

test("Provider result download uses the 180-second hard default and tolerates steady progress", async () => {
  const timer = manualDeadline({});
  const source = controlledBody();
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: (async () => new Response(source.body, {
      headers: { "Content-Type": "video/mp4" },
      status: 200,
    })) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/slow-but-progressing.mp4",
  });
  expect(timer.scheduledDurations.slice(0, 2)).toEqual([180_000, 60_000]);

  const reader = downloaded.body.getReader();
  for (let index = 0; index < 3; index += 1) {
    const read = reader.read();
    timer.advance(50_000);
    source.push(new Uint8Array([index + 1]));
    const result = await read;
    expect(result.done).toBe(false);
  }
  source.close();
  const finished = await reader.read();
  expect(finished.done).toBe(true);
  expect(timer.pendingTimerCount()).toBe(0);
});

test("Provider result initial response wait stays bounded by sixty seconds", async () => {
  const timer = manualDeadline({});
  let requestSignal: AbortSignal | null | undefined;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const download = downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: ((_url, init) => {
      requestSignal = init?.signal;
      entered();
      return new Promise<Response>(() => undefined);
    }) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/headers-never-arrive.mp4",
  });
  await started;
  timer.advance(59_999);
  expect(requestSignal?.aborted).toBe(false);
  timer.advance(1);
  await expect(download).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(requestSignal?.aborted).toBe(true);
  expect(timer.pendingTimerCount()).toBe(0);
});

test("Provider result download fails an idle body before the hard deadline", async () => {
  const timer = manualDeadline({});
  const source = controlledBody();
  let requestSignal: AbortSignal | null | undefined;
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: (async (_url, init) => {
      requestSignal = init?.signal;
      return new Response(source.body, {
        headers: { "Content-Type": "video/mp4" },
        status: 200,
      });
    }) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/idle-timeout.mp4",
  });
  const read = downloaded.body.getReader().read();
  timer.advance(60_000);
  await expect(read).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(requestSignal?.aborted).toBe(true);
  expect(timer.pendingTimerCount()).toBe(0);
});

test("Provider result empty chunks do not reset the idle deadline", async () => {
  const timer = manualDeadline({});
  const source = controlledBody();
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: (async () => new Response(source.body, {
      headers: { "Content-Type": "video/mp4" },
      status: 200,
    })) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/empty-chunks.mp4",
  });
  const reader = downloaded.body.getReader();
  const first = reader.read();
  source.push(new Uint8Array(0));
  expect((await first).value?.byteLength).toBe(0);
  timer.advance(59_999);
  const second = reader.read();
  source.push(new Uint8Array(0));
  expect((await second).value?.byteLength).toBe(0);
  const stalled = reader.read();
  timer.advance(1);
  await expect(stalled).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(timer.pendingTimerCount()).toBe(0);
});

test("Provider result hard deadline never resets while chunks keep arriving", async () => {
  const timer = manualDeadline({});
  const source = controlledBody();
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: (async () => new Response(source.body, {
      headers: { "Content-Type": "video/mp4" },
      status: 200,
    })) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/hard-timeout.mp4",
  });
  const reader = downloaded.body.getReader();
  for (let index = 0; index < 3; index += 1) {
    const read = reader.read();
    timer.advance(50_000);
    source.push(new Uint8Array([index + 1]));
    expect((await read).done).toBe(false);
  }
  const finalRead = reader.read();
  timer.advance(30_000);
  await expect(finalRead).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(timer.pendingTimerCount()).toBe(0);
});

test("Provider result consumer cancellation clears hard and idle timers", async () => {
  const timer = manualDeadline({});
  const source = controlledBody();
  const downloaded = await downloadProviderResultMedia({
    apiKey: "safe-key",
    deadlineOptions: timer.options,
    testFetcher: (async () => new Response(source.body, {
      headers: { "Content-Type": "video/mp4" },
      status: 200,
    })) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/consumer-cancel.mp4",
  });
  const reader = downloaded.body.getReader();
  const read = reader.read();
  await reader.cancel("consumer stopped");
  await expect(read).resolves.toMatchObject({ done: true });
  expect(timer.pendingTimerCount()).toBe(0);
});

test("Provider submit deadlines keep their existing request-only default", () => {
  const timer = manualDeadline({});
  const deadline = createProviderRequestDeadline({
    operation: "submit",
    scheduler: timer.options.scheduler,
  });
  expect(timer.scheduledDurations).toEqual([180_000]);
  deadline.complete();
  expect(timer.pendingTimerCount()).toBe(0);
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
    closeRuntimeDatabaseTransactions();
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
    closeRuntimeDatabaseTransactions();
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});
