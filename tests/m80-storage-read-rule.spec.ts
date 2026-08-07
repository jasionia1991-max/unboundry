import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import {
  activateStorageProfile,
  activeStorageProfile,
  markStorageProfileVerified,
  readableStorageProfile,
  saveStorageProfile,
  storageMediaRoutingState,
} from "../server/secureStorageProfiles";
import { registerMediaForOwner } from "../server/mediaRegistry";
import { openAppDatabase } from "../server/database";

const port = 4198;
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

test("routing off still serves existing OSS assets through the HTTP layer", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m80-read-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  let server: ChildProcess | undefined;
  try {
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
    const draft = await saveStorageProfile(dummyProfile());
    await markStorageProfileVerified(draft.id);
    await activateStorageProfile(draft.id);
    openAppDatabase(dataDirectory).close();
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
