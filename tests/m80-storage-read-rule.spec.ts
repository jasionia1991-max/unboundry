import { spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { ClientRequest, IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { expect, test } from "./safe-test";
import {
  activateStorageProfile,
  activeStorageProfile,
  encryptedStorageProfilePath,
  listStorageProfiles,
  markStorageProfileVerified,
  readableStorageProfile,
  saveStorageProfile,
  setStorageMediaRouting,
  storageMediaRoutingState,
  storageProfileById,
} from "../server/secureStorageProfiles";
import { registerMediaForOwner } from "../server/mediaRegistry";
import { openAppDatabase } from "../server/database";
import {
  fetchPrivateOssDownload,
  spoolOssEntry,
} from "../server/groupDownload";
import type { PublicHttpsFetchDependencies } from "../server/outboundNetwork";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");

function dummyProfile() {
  return {
    accessKeyId: "m80-test-access-key-id",
    accessKeySecret: "m80-test-secret-key",
    bucket: "m80-private-bucket",
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    label: "M80 Test OSS",
    region: "oss-cn-hangzhou",
  };
}

async function startServer(dataDirectory: string) {
  const child = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: undefined,
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${origin}/api/auth/status`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("M80 storage test server did not start");
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

function cookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function request(
  path: string,
  options: RequestInit & { cookie?: string } = {},
) {
  const { cookie: session, ...init } = options;
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session } : {}),
      ...init.headers,
    },
  });
}

const fakeChecksum = "a".repeat(64);

function insertOssMedia(
  dataDirectory: string,
  ownerId: string,
  id: string,
  profileId: string | null,
) {
  const database = new DatabaseSync(
    join(dataDirectory, "unboundry.sqlite"),
  );
  try {
    const timestamp = new Date().toISOString();
    database
      .prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at,
          updated_at, storage_backend, storage_profile_id, object_key,
          content_type, checksum_sha256, storage_status, duration_seconds,
          duration_source, duration_status, media_width, media_height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "image",
        id,
        ownerId,
        `${id}.png`,
        1,
        timestamp,
        timestamp,
        "oss",
        profileId,
        `objects/2026/08/image/${id}.png`,
        "image/png",
        fakeChecksum,
        "ready",
        null,
        null,
        "not-applicable",
        null,
        null,
      );
  } finally {
    database.close();
  }
}

async function bootstrapAdmin() {
  const bootstrap = await request("/api/auth/bootstrap", {
    body: JSON.stringify({
      displayName: "Owner",
      loginName: "owner",
      password: "owner-password-123",
    }),
    method: "POST",
  });
  expect(bootstrap.ok).toBe(true);
  return cookie(bootstrap);
}

test("re-verifying an active profile keeps it active and readable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m80-state-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    const draft = await saveStorageProfile(dummyProfile());
    await markStorageProfileVerified(draft.id);
    await activateStorageProfile(draft.id);
    expect((await activeStorageProfile())?.id).toBe(draft.id);

    const reverified = await markStorageProfileVerified(draft.id);
    expect(reverified.status).toBe("active");
    expect((await activeStorageProfile())?.id).toBe(draft.id);
    expect((await readableStorageProfile())?.id).toBe(draft.id);
    expect(await storageMediaRoutingState()).toMatchObject({
      enabled: false,
      profile: { id: draft.id, status: "active" },
    });
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("legacy non-canonical OSS profiles fail closed on every operational read without rewriting data", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m80-legacy-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  let server: ChildProcess | undefined;
  try {
    openAppDatabase(dataDirectory).close();
    const draft = await saveStorageProfile(dummyProfile());
    await markStorageProfileVerified(draft.id);
    await activateStorageProfile(draft.id);
    await setStorageMediaRouting(true);

    const profilePath = await encryptedStorageProfilePath();
    const encrypted = JSON.parse(await readFile(profilePath, "utf8")) as {
      ciphertext: string;
      iv: string;
      tag: string;
      version: 1;
    };
    const key = await readFile(
      join(dataDirectory, "secrets", "config-master.key"),
    );
    const associatedData = Buffer.from("unboundry:storage-profiles:v1", "utf8");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAAD(associatedData);
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    const document = JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")) as {
      profiles: Array<{ endpoint: string; id: string }>;
    };
    const profile = document.profiles.find((candidate) => candidate.id === draft.id);
    if (!profile) throw new Error("fixture profile missing");
    profile.endpoint = "https://legacy-custom.example.test";

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(document), "utf8"),
      cipher.final(),
    ]);
    await writeFile(profilePath, JSON.stringify({
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      version: 1,
    }));
    const legacyBytes = await readFile(profilePath, "utf8");

    expect(await activeStorageProfile()).toBeUndefined();
    expect(await readableStorageProfile()).toBeUndefined();
    expect(await storageProfileById(draft.id)).toBeUndefined();
    expect(await storageMediaRoutingState()).toEqual({
      enabled: false,
      profile: undefined,
    });
    expect((await listStorageProfiles()).profiles[0].endpoint)
      .toBe("https://legacy-custom.example.test");
    await expect(markStorageProfileVerified(draft.id))
      .rejects.toThrow("OSS configuration is invalid");
    expect(await readFile(profilePath, "utf8")).toBe(legacyBytes);

    server = await startServer(dataDirectory);
    const adminCookie = await bootstrapAdmin();
    const status = await request("/api/admin/storage", { cookie: adminCookie });
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody).toMatchObject({
      activeBackend: "local",
      cloudRequestsEnabled: false,
      oss: {
        effectiveMediaRoutingEnabled: false,
        mediaRoutingEnabled: false,
        rawMediaRoutingEnabled: true,
        readableProfileAvailable: false,
      },
    });
    expect(statusBody.warning).toContain("新素材当前仍写入本机存储");
    expect(await readFile(profilePath, "utf8")).toBe(legacyBytes);
  } finally {
    if (server) await stopServer(server);
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("group download uses the pinned HTTPS guard for signed OSS reads", async () => {
  let resolverCalls = 0;
  const requests: Array<{ address: string; family: number; url: string }> = [];
  const requester = ((
    url: URL,
    options: Record<string, unknown>,
    respond: (response: IncomingMessage) => void,
  ) => {
    const request = new EventEmitter() as ClientRequest;
    request.end = (() => {
      const lookup = options.lookup as (
        hostname: string,
        lookupOptions: { family?: number },
        callback: (
          error: Error | null,
          address: string,
          family: number,
        ) => void,
      ) => void;
      lookup(url.hostname, { family: 0 }, (error, address, family) => {
        if (error) {
          request.emit("error", error);
          return;
        }
        requests.push({ address, family, url: url.toString() });
        const incoming = Readable.from([Buffer.from("fixture")]) as IncomingMessage;
        Object.assign(incoming, {
          rawHeaders: ["content-type", "application/octet-stream"],
          statusCode: 200,
          statusMessage: "OK",
        });
        respond(incoming);
      });
      return request;
    }) as ClientRequest["end"];
    return request;
  }) as NonNullable<PublicHttpsFetchDependencies["requester"]>;
  const response = await fetchPrivateOssDownload(
    "https://private-bucket.oss-cn-hangzhou.aliyuncs.com/object?signature=test",
    {
      requester,
      resolver: (async () => {
        resolverCalls += 1;
        return resolverCalls === 1
          ? [{ address: "93.184.216.34", family: 4 as const }]
          : [{ address: "10.0.0.8", family: 4 as const }];
      }) as any,
    },
  );
  expect(response.status).toBe(200);
  expect(resolverCalls).toBe(1);
  expect(requests).toEqual([{
    address: "93.184.216.34",
    family: 4,
    url: "https://private-bucket.oss-cn-hangzhou.aliyuncs.com/object?signature=test",
  }]);
  await response.body?.cancel();

  let blockedRequestCalls = 0;
  for (const input of [
    {
      resolver: (async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ]) as any,
      url: "https://private-bucket.oss-cn-hangzhou.aliyuncs.com/object",
    },
    {
      resolver: (async () => [{
        address: "93.184.216.34",
        family: 4,
      }]) as any,
      url: "https://private-bucket.oss-cn-hangzhou.aliyuncs.com:8443/object",
    },
  ]) {
    await expect(fetchPrivateOssDownload(input.url, {
      requester: (() => {
        blockedRequestCalls += 1;
        throw new Error("must not reach requester");
      }) as NonNullable<PublicHttpsFetchDependencies["requester"]>,
      resolver: input.resolver,
    })).rejects.toMatchObject({ code: "FORMAT" });
  }
  expect(blockedRequestCalls).toBe(0);
});

test("group download body deadlines cancel stalled OSS reads and remove temp files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-m80-spool-"));
  let cancelled = false;
  let requestSignal: AbortSignal | undefined;
  try {
    const result = await spoolOssEntry({
      byteSize: 8,
      extension: "png",
      kind: "media",
      media: {
        assetId: "stalled-oss-asset",
        backend: "oss",
        objectKey: "objects/2026/08/image/stalled.png",
        storageProfileId: "stalled-profile",
      },
      name: "stalled.png",
      taskId: "stalled-task",
    }, new AbortController().signal, {
      bodyTimeoutMs: 5,
      createReadUrl: async () =>
        "https://m80-private-bucket.oss-cn-hangzhou.aliyuncs.com/stalled.png",
      fetchDownload: async (_location, _dependencies, signal) => {
        requestSignal = signal;
        return new Response(new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
          pull() {
            // Deliberately never produces a chunk.
          },
        }), { status: 200 });
      },
      makeTempDirectory: () => mkdtemp(join(directory, "entry-")),
      profileForMedia: async () => ({
        ...dummyProfile(),
        createdAt: "2026-08-12T00:00:00.000Z",
        id: "stalled-profile",
        provider: "aliyun-oss" as const,
        status: "active" as const,
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
    });
    expect(result).toBeUndefined();
    expect(requestSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("routing off still serves existing OSS assets through the HTTP layer", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m80-read-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  let server: ChildProcess | undefined;
  try {
    openAppDatabase(dataDirectory).close();
    const draft = await saveStorageProfile(dummyProfile());
    await markStorageProfileVerified(draft.id);
    await activateStorageProfile(draft.id);
    await storageMediaRoutingState();

    server = await startServer(dataDirectory);
    const adminCookie = await bootstrapAdmin();
    const database = new DatabaseSync(
      join(dataDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    const owner = database
      .prepare("SELECT id FROM users WHERE login_name = ?")
      .get("owner") as { id: string };
    database.close();
    insertOssMedia(dataDirectory, owner.id, "m80-oss-read", draft.id);

    const asset = await request("/api/assets/m80-oss-read", {
      cookie: adminCookie,
      redirect: "manual",
    });
    expect(asset.status).toBe(307);
    const location = asset.headers.get("location") ?? "";
    expect(location).toContain("x-oss-signature-version=OSS4-HMAC-SHA256");

    const storage = await request("/api/admin/storage", {
      cookie: adminCookie,
    });
    expect(storage.status).toBe(200);
    const body = JSON.parse(await storage.text());
    expect(body.oss).toMatchObject({
      activeProfileId: draft.id,
      effectiveMediaRoutingEnabled: false,
      mediaRoutingEnabled: false,
      rawMediaRoutingEnabled: false,
      readableProfileAvailable: true,
    });
    expect(body.warning).toBeUndefined();
  } finally {
    if (server) await stopServer(server);
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("status warns when OSS assets exist without a readable profile", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m80-warn-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  let server: ChildProcess | undefined;
  try {
    openAppDatabase(dataDirectory).close();
    const draft = await saveStorageProfile(dummyProfile());
    await markStorageProfileVerified(draft.id);

    server = await startServer(dataDirectory);
    const adminCookie = await bootstrapAdmin();
    const database = new DatabaseSync(
      join(dataDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    const owner = database
      .prepare("SELECT id FROM users WHERE login_name = ?")
      .get("owner") as { id: string };
    database.close();
    insertOssMedia(dataDirectory, owner.id, "m80-warn-oss", null);

    const storage = await request("/api/admin/storage", {
      cookie: adminCookie,
    });
    expect(storage.status).toBe(200);
    const body = JSON.parse(await storage.text());
    expect(body.oss.readableProfileAvailable).toBe(false);
    expect(body.warning).toContain("云端素材");
  } finally {
    if (server) await stopServer(server);
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("new OSS media rows record their owning storage profile", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m80-track-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    openAppDatabase(dataDirectory).close();
    const draft = await saveStorageProfile(dummyProfile());
    await markStorageProfileVerified(draft.id);
    await activateStorageProfile(draft.id);
    const setupDatabase = new DatabaseSync(
      join(dataDirectory, "unboundry.sqlite"),
    );
    const timestamp = new Date().toISOString();
    setupDatabase
      .prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "__test__",
        "test",
        "Test",
        "not-a-real-password",
        "user",
        "active",
        timestamp,
        timestamp,
      );
    setupDatabase.close();
    registerMediaForOwner("__test__", {
      byteSize: 1,
      checksumSha256: fakeChecksum,
      contentType: "image/png",
      id: "m80-profile-track",
      kind: "image",
      objectKey: "objects/2026/08/image/m80-profile-track.png",
      storageBackend: "oss",
      storageProfileId: draft.id,
      storageName: "m80-profile-track.png",
    });
    const database = new DatabaseSync(
      join(dataDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    const row = database
      .prepare("SELECT storage_profile_id FROM media_assets WHERE id = ?")
      .get("m80-profile-track") as { storage_profile_id: string | null };
    database.close();
    expect(row.storage_profile_id).toBe(draft.id);
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
