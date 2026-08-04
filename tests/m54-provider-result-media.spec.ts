import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveGeneratedAudio } from "../server/audioStorage";
import { openAppDatabase } from "../server/database";
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

test("Provider result URLs reject credentials, local networks and leaked keys", async () => {
  const key = "relay-secret-test-key";
  for (const value of [
    `https://cdn.example.test/result.png?key=${key}`,
    "https://user:password@cdn.example.test/result.png",
    "http://cdn.example.test/result.png",
    "https://127.0.0.1/result.png",
    "https://192.168.1.8/result.png",
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

test("Provider media download is unauthenticated, redirect-free and type checked", async () => {
  const requests: Array<{ authorization: string | null; method?: string; redirect?: string }> = [];
  const result = await downloadProviderResultMedia({
    apiKey: "never-forward-this-key",
    fetcher: (async (_url, init) => {
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

  await expect(downloadProviderResultMedia({
    apiKey: "safe-key",
    fetcher: (async () => new Response(Buffer.from("html"), {
      headers: { "Content-Type": "text/html" },
    })) as typeof fetch,
    kind: "video",
    resolver: publicResolver,
    url: "https://cdn.example.test/result.mp4",
  })).rejects.toMatchObject({ code: "FORMAT" });

  const audio = await downloadProviderResultMedia({
    apiKey: "safe-key",
    expectedContentType: "audio/mp4",
    fetcher: (async () => new Response(Buffer.from("m4a"), {
      headers: { "Content-Type": "application/octet-stream" },
    })) as typeof fetch,
    kind: "audio",
    resolver: publicResolver,
    url: "https://cdn.example.test/result.m4a",
  });
  expect(audio.contentType).toBe("audio/mp4");

  for (const remoteType of ["audio/ogg; codecs=opus", "application/ogg"]) {
    const ogg = await downloadProviderResultMedia({
      apiKey: "safe-key",
      fetcher: (async () => new Response(Buffer.from("OggS OpusHead"), {
        headers: { "Content-Type": remoteType },
      })) as typeof fetch,
      kind: "audio",
      resolver: publicResolver,
      url: "https://cdn.example.test/result.ogg",
    });
    expect(ogg.contentType).toBe("audio/ogg");
  }
  const opaqueOgg = await downloadProviderResultMedia({
    apiKey: "safe-key",
    expectedContentType: "audio/ogg",
    fetcher: (async () => new Response(Buffer.from("OggS OpusHead"), {
      headers: { "Content-Type": "application/octet-stream" },
    })) as typeof fetch,
    kind: "audio",
    resolver: publicResolver,
    url: "https://cdn.example.test/result-opaque.ogg",
  });
  expect(opaqueOgg.contentType).toBe("audio/ogg");
});

test("Provider result DNS rebinding to a private address is blocked before download", async () => {
  let fetchCalls = 0;
  await expect(downloadProviderResultMedia({
    apiKey: "safe-key",
    fetcher: (async () => {
      fetchCalls += 1;
      return new Response(Buffer.from("not reached"));
    }) as typeof fetch,
    kind: "audio",
    resolver: (async () => [{ address: "10.0.0.8", family: 4 }]) as any,
    url: "https://cdn.example.test/result.mp3",
  })).rejects.toMatchObject({ code: "FORMAT" });
  expect(fetchCalls).toBe(0);
});

test("generated WAV reads a complete probe and is saved without a Provider request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-relay-wav-"));
  const previousDataDirectory = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
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
    if (previousDataDirectory === undefined) delete process.env.TAPNOW_DATA_DIR;
    else process.env.TAPNOW_DATA_DIR = previousDataDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});

test("generated OGG Opus is probed and persisted with its canonical private-media type", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-relay-ogg-"));
  const previousDataDirectory = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
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
    if (previousDataDirectory === undefined) delete process.env.TAPNOW_DATA_DIR;
    else process.env.TAPNOW_DATA_DIR = previousDataDirectory;
    await rm(directory, { force: true, recursive: true });
  }
});
