import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { request as openHttpRequest } from "node:http";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  currentSchemaManifest,
  currentSchemaVersion,
  openAppDatabase,
} from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import {
  coordinateRuntimeShutdown,
  createRuntimeLifecycle,
  type ShutdownResult,
} from "../server/runtimeLifecycle";
import { expect, test } from "./safe-test";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const capturedOutput = new WeakMap<ChildProcess, string[]>();

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForChildExit(
  child: ChildProcess,
  milliseconds: number,
  message: string,
) {
  if (childExited(child)) return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve) => {
      const finish = () => resolve();
      child.once("exit", finish);
      if (childExited(child)) {
        child.removeListener("exit", finish);
        resolve();
      }
    }),
    milliseconds,
    message,
  );
}

async function startServer(
  dataDirectory: string,
  options: {
    captureOutput?: boolean;
    environment?: NodeJS.ProcessEnv;
    preview?: boolean;
    waitPath?: string;
  } = {},
) {
  const child = spawn(
    process.execPath,
    [
      vite,
      ...(options.preview ? ["preview"] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: undefined,
        UNBOUNDRY_TRUST_PROXY: "1",
        ...options.environment,
      },
      stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
    },
  );
  if (options.captureOutput) {
    const output: string[] = [];
    capturedOutput.set(child, output);
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childExited(child)) break;
    try {
      if ((await fetch(`${origin}${options.waitPath ?? "/api/health/live"}`, {
        signal: AbortSignal.timeout(500),
      })).ok) {
        return child;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopServer(child);
  throw new Error(
    `M81 deployment hardening server did not start\n${
      capturedOutput.get(child)?.join("") ?? ""
    }`,
  );
}

async function stopServer(child: ChildProcess) {
  if (childExited(child)) return;
  const gracefulExit = waitForChildExit(
    child,
    5_000,
    "server did not stop after SIGTERM",
  );
  child.kill("SIGTERM");
  try {
    await gracefulExit;
  } catch {
    if (childExited(child)) return;
    const forcedExit = waitForChildExit(
      child,
      5_000,
      "server did not stop after SIGKILL",
    );
    child.kill("SIGKILL");
    await forcedExit;
  }
}

function outputOf(child: ChildProcess) {
  return capturedOutput.get(child)?.join("") ?? "";
}

function rawHttp(requestText: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.end(requestText);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error("raw HTTP request timed out"));
    });
  });
}

function slowChunkedHttp(requestHead: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(requestHead);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error("slow chunked request was not closed"));
    });
  });
}

function openServerEventStream() {
  return new Promise<{
    close: () => void;
    closed: Promise<void>;
    status: number;
    text: () => string;
  }>((resolve, reject) => {
    const request = openHttpRequest(`${origin}/api/updates`, (response) => {
      let body = "";
      let settled = false;
      let settleClosed: (() => void) | undefined;
      const closed = new Promise<void>((resolveClosed) => {
        settleClosed = resolveClosed;
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        settleClosed?.();
      };
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("aborted", finish);
      response.once("close", finish);
      response.once("end", finish);
      response.once("error", finish);
      resolve({
        close: () => response.destroy(),
        closed,
        status: response.statusCode ?? 0,
        text: () => body,
      });
    });
    request.once("error", reject);
    request.end();
  });
}

async function expectMissing(path: string) {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function optionalFileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) return 0;
    throw error;
  }
}

async function directoryFingerprint(root: string) {
  const entries: string[] = [];
  async function visit(directory: string, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const metadata = await stat(absolutePath);
        entries.push(
          `f:${relativePath}:${metadata.size}:${await sha256(absolutePath)}`,
        );
      } else {
        entries.push(`o:${relativePath}`);
      }
    }
  }
  await visit(root);
  return entries.sort();
}

function recreateV5ModelProfiles(
  database: DatabaseSync,
  existingCostColumns: "cost" | "max" | "none",
) {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("DROP TABLE model_profiles");
  // Keep this base table and index aligned with immutable migration v5. The
  // v21 prepare hook has explicit, known-safe repairs for either missing cost
  // column; the final exact sqlite_schema text depends on their append order.
  database.exec(`
      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL,
        provider_model_id TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (
          capability IN ('text', 'image', 'video', 'audio')
        ),
        status TEXT NOT NULL CHECK (
          status IN ('draft', 'published', 'disabled')
        ),
        default_parameters TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id)
      );
      CREATE INDEX IF NOT EXISTS model_profiles_capability_status
        ON model_profiles (capability, status, updated_at DESC);
    `);
  if (existingCostColumns === "max") {
    database.exec(`
      ALTER TABLE model_profiles
        ADD COLUMN max_cost_microunits INTEGER NOT NULL DEFAULT 0
        CHECK (max_cost_microunits BETWEEN 0 AND 100000000);
    `);
  }
  if (existingCostColumns === "cost") {
    database.exec(`
      ALTER TABLE model_profiles
        ADD COLUMN cost_currency TEXT NOT NULL DEFAULT 'USD'
        CHECK (cost_currency IN ('USD', 'CNY'));
    `);
  }
  database.exec("DELETE FROM schema_migrations WHERE version IN (21, 22)");
}

function recreateV21MissingCatalogTables(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`
    DROP TABLE node_model_bindings;
    DROP TABLE model_profiles;
    DROP TABLE admin_audit_events;
    DROP TABLE users;
    DELETE FROM schema_migrations WHERE version IN (21, 22, 37);
  `);
}

function replayKnownIdempotentPrepareMigrations(database: DatabaseSync) {
  database.exec(`
    DELETE FROM schema_migrations
    WHERE version IN (21, 22, 23, 24, 25, 26, 29, 31, 32, 34);
  `);
}

function cookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function request(
  path: string,
  options: RequestInit & {
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const { cookie: session, headers, ...init } = options;
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
  });
}

async function bootstrapAdmin() {
  const bootstrap = await request("/api/auth/bootstrap", {
    body: JSON.stringify({
      displayName: "Owner",
      loginName: "owner",
      password: "owner-password-123",
    }),
    headers: { "X-Forwarded-For": "127.0.0.1" },
    method: "POST",
  });
  expect(bootstrap.ok).toBe(true);
  return cookie(bootstrap);
}

test("trusted proxy mode blocks remote bootstrap through forwarded IP", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-bootstrap-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);

    const remote = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Remote",
        loginName: "remote",
        password: "remote-pass-123",
      }),
      headers: { "X-Forwarded-For": "203.0.113.9" },
      method: "POST",
    });
    expect(remote.status).toBe(403);
    expect(await remote.text()).toContain("首次管理员只能在服务器本机创建");

    const local = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(local.status).toBe(201);
    expect(cookie(local)).not.toBe("");
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("trusted proxy mode requires https forwarding for storage writes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-storage-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const adminCookie = await bootstrapAdmin();
    const profile = {
      accessKeyId: "m81-test-access-key-id",
      accessKeySecret: "m81-test-secret-key",
      bucket: "m81-private-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      label: "M81 Test OSS",
      region: "oss-cn-hangzhou",
    };

    const plain = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(plain.status).toBe(400);
    expect(await plain.text()).toContain("HTTPS");

    const secure = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "X-Forwarded-Proto": "https",
      },
      method: "POST",
    });
    expect(secure.status).toBe(201);

    const readThroughProxy = await request("/api/admin/storage", {
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    expect(readThroughProxy.status).toBe(200);

    const direct = await request("/api/admin/storage/profiles", {
      body: JSON.stringify({ ...profile, label: "M81 Direct OSS" }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(direct.status).toBe(201);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("liveness stays process-only while readiness verifies schema 37 without creating data", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-health-"));
  const missingDataDirectory = join(testRoot, "missing-data");
  let server: ChildProcess | undefined;
  try {
    server = await startServer(missingDataDirectory);
    const live = await fetch(`${origin}/api/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: "live" });

    const notReady = await fetch(`${origin}/api/health/ready`);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({
      code: "DATABASE_DIRECTORY_INVALID",
    });
    await expectMissing(missingDataDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness leaves a running generation task and the database bytes unchanged", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-ready-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const task = store.create({
      canvasId: "m81-readiness-canvas",
      idempotencyKey: "m81-readiness-request",
      kind: "image",
      nodeId: "m81-readiness-node",
      prompt: "readiness must never resume this synthetic task",
    }).task;
    store.transition(task.id, "running");
    store.close();
    expect(await optionalFileSize(`${databasePath}-wal`)).toBe(0);
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: 37,
      status: "ready",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);

    const database = new DatabaseSync(
      `${pathToFileURL(databasePath).href}?immutable=1`,
      { readOnly: true },
    );
    try {
      expect(
        database.prepare("SELECT state FROM generation_tasks WHERE id = ?")
          .get(task.id),
      ).toEqual({ state: "running" });
      expect(
        database.prepare(
          "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
        ).get(task.id),
      ).toEqual({ count: 2 });
    } finally {
      database.close();
    }
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness reads an active committed WAL without changing database or WAL bytes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-live-wal-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const task = store.create({
      canvasId: "m81-live-wal-canvas",
      idempotencyKey: "m81-live-wal-request",
      kind: "image",
      nodeId: "m81-live-wal-node",
      prompt: "active WAL readiness must remain observational",
    }).task;
    store.transition(task.id, "running");
    store.close();

    writer = openAppDatabase(dataDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = 36;
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA user_version = 37;
    `);
    const immutableMain = new DatabaseSync(
      `${pathToFileURL(databasePath).href}?immutable=1`,
      { readOnly: true },
    );
    try {
      expect(immutableMain.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 36,
      });
    } finally {
      immutableMain.close();
    }
    expect((await stat(`${databasePath}-wal`)).size).toBeGreaterThan(0);
    expect((await stat(`${databasePath}-shm`)).isFile()).toBe(true);
    const beforeEntries = (await readdir(dataDirectory)).sort();
    const beforeDatabase = await sha256(databasePath);
    const beforeWal = await sha256(`${databasePath}-wal`);
    const beforeTask = writer.prepare(`
      SELECT state,
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events
      FROM generation_tasks
      WHERE id = ?
    `).get(task.id, task.id);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: 37,
      status: "ready",
    });
    expect(await sha256(databasePath)).toBe(beforeDatabase);
    expect(await sha256(`${databasePath}-wal`)).toBe(beforeWal);
    expect((await readdir(dataDirectory)).sort()).toEqual(beforeEntries);
    expect(writer.prepare(`
      SELECT state,
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events
      FROM generation_tasks
      WHERE id = ?
    `).get(task.id, task.id)).toEqual(beforeTask);
  } finally {
    if (server) await stopServer(server);
    writer?.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness fails closed for a hot WAL without SHM until an owned connection recovers it", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-wal-recovery-"));
  const sourceDirectory = join(testRoot, "source");
  const targetDirectory = join(testRoot, "target");
  const sourcePath = join(sourceDirectory, "unboundry.sqlite");
  const targetPath = join(targetDirectory, "unboundry.sqlite");
  let recovery: DatabaseSync | undefined;
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    writer = openAppDatabase(sourceDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = 36;
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA user_version = 37;
    `);
    expect((await stat(`${sourcePath}-wal`)).size).toBeGreaterThan(0);
    await copyFile(sourcePath, targetPath);
    await copyFile(`${sourcePath}-wal`, `${targetPath}-wal`);
    expect((await readdir(targetDirectory)).sort()).toEqual([
      "unboundry.sqlite",
      "unboundry.sqlite-wal",
    ]);
    const beforeDatabase = await sha256(targetPath);
    const beforeWal = await sha256(`${targetPath}-wal`);

    server = await startServer(targetDirectory);
    const blocked = await fetch(`${origin}/api/health/ready`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      code: "DATABASE_FILE_UNAVAILABLE",
    });
    expect(await sha256(targetPath)).toBe(beforeDatabase);
    expect(await sha256(`${targetPath}-wal`)).toBe(beforeWal);
    expect((await readdir(targetDirectory)).sort()).toEqual([
      "unboundry.sqlite",
      "unboundry.sqlite-wal",
    ]);

    recovery = new DatabaseSync(targetPath);
    expect(recovery.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect((await stat(`${targetPath}-shm`)).isFile()).toBe(true);
    const recovered = await fetch(`${origin}/api/health/ready`);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: "ready" });
  } finally {
    if (server) await stopServer(server);
    recovery?.close();
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness rejects a counterfeit schema-37 ledger without changing it", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-counterfeit-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const insert = database.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `);
    for (const migration of currentSchemaManifest) {
      insert.run(migration.version, migration.name, "2026-08-09T00:00:00.000Z");
    }
    database.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
    database.close();
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      code: "DATABASE_SCHEMA_MISMATCH",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness accepts the historical v31-to-v32 public template column order", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-v31-v32-"));
  let server: ChildProcess | undefined;
  try {
    let database = openAppDatabase(dataDirectory);
    database.exec("DROP TABLE public_templates");
    // Keep this SQL text aligned with the known hot-reload v31 migration.
    // Exact sqlite_schema fingerprints are intentional: a whitespace-erasing
    // pseudo-lexer can merge declarations with different SQLite semantics.
    database.exec(`
        CREATE TABLE public_templates (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT CHECK (category IS NULL OR json_valid(category)),
          graph TEXT NOT NULL,
          cover_asset_id TEXT,
          preview_image TEXT,
          status TEXT NOT NULL DEFAULT 'published'
            CHECK (status IN ('draft', 'published', 'archived')),
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_by TEXT,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY (created_by) REFERENCES users(id),
          FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS public_templates_status_updated
          ON public_templates (status, updated_at DESC);
      `);
    database.exec("DELETE FROM schema_migrations WHERE version = 32");
    database.close();
    // Reopen through the real immutable v32 prepare hook so this positive case
    // proves the quoted addColumnIfMissing repair rather than hand-writing it.
    database = openAppDatabase(dataDirectory);
    database.close();
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness accepts exact known migration repair shapes", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-v21-repair-"));
  let server: ChildProcess | undefined;
  try {
    const fixtures = [
      {
        directory: join(testRoot, "missing-catalog-tables"),
        prepare: recreateV21MissingCatalogTables,
      },
      {
        directory: join(testRoot, "idempotent-prepare-replay"),
        prepare: replayKnownIdempotentPrepareMigrations,
      },
      ...(["none", "max", "cost"] as const).map((existingCostColumns) => ({
        directory: join(testRoot, `model-${existingCostColumns}`),
        prepare: (database: DatabaseSync) =>
          recreateV5ModelProfiles(database, existingCostColumns),
      })),
    ];

    for (const fixture of fixtures) {
      await mkdir(fixture.directory);
      let database = openAppDatabase(fixture.directory);
      fixture.prepare(database);
      database.close();
      database = openAppDatabase(fixture.directory);
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      database.close();
      const beforeDirectory = await directoryFingerprint(fixture.directory);

      server = await startServer(fixture.directory);
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({
        databaseProbe: "read-only",
        schemaVersion: currentSchemaVersion,
        status: "ready",
      });
      expect(await directoryFingerprint(fixture.directory)).toEqual(
        beforeDirectory,
      );
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness rejects missing or semantically damaged schema-37 objects", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-schema-contract-"));
  let server: ChildProcess | undefined;
  try {
    const cases = [
      {
        directory: join(testRoot, "missing-table"),
        damage: "DROP TABLE user_templates",
      },
      {
        directory: join(testRoot, "missing-index"),
        damage: "DROP INDEX node_model_bindings_one_default",
      },
      {
        directory: join(testRoot, "missing-canonical-users-index"),
        damage: "DROP INDEX users_status_role",
      },
      {
        directory: join(testRoot, "false-partial-index"),
        damage: `
          DROP INDEX node_model_bindings_one_default;
          CREATE UNIQUE INDEX node_model_bindings_one_default
          ON node_model_bindings (node_type)
          WHERE 0;
        `,
      },
      {
        directory: join(testRoot, "no-op-trigger"),
        damage: `
          DROP TRIGGER archived_models_cannot_enable_binding_insert;
          CREATE TRIGGER archived_models_cannot_enable_binding_insert
          BEFORE INSERT ON node_model_bindings
          BEGIN
            SELECT 1;
          END;
        `,
      },
      {
        directory: join(testRoot, "literal-case-trigger"),
        damage: `
          DROP TRIGGER model_profiles_capture_first_publish_insert;
          CREATE TRIGGER model_profiles_capture_first_publish_insert
          AFTER INSERT ON model_profiles
          WHEN NEW.status = 'PUBLISHED' AND NEW.published_at IS NULL
          BEGIN
            UPDATE model_profiles
            SET published_at = NEW.updated_at
            WHERE id = NEW.id AND published_at IS NULL;
          END;
        `,
      },
      {
        directory: join(testRoot, "split-integer-type"),
        damage: `
          ALTER TABLE schema_migrations
          RENAME TO schema_migrations_original;
          CREATE TABLE schema_migrations (
            version I NTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          );
          INSERT INTO schema_migrations (version, name, applied_at)
          SELECT version, name, applied_at
          FROM schema_migrations_original;
          DROP TABLE schema_migrations_original;
        `,
      },
      {
        directory: join(testRoot, "extra-destructive-trigger"),
        damage: `
          CREATE TRIGGER unexpected_users_delete
          AFTER INSERT ON users
          BEGIN
            DELETE FROM users WHERE id = NEW.id;
          END;
        `,
      },
      {
        directory: join(testRoot, "extra-unique-index"),
        damage: `
          CREATE UNIQUE INDEX unexpected_users_display_name
          ON users (display_name);
        `,
      },
    ];
    for (const fixture of cases) {
      await mkdir(fixture.directory);
      const database = openAppDatabase(fixture.directory);
      database.exec(fixture.damage);
      database.close();
      const beforeDirectory = await directoryFingerprint(fixture.directory);

      server = await startServer(fixture.directory);
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        code: "DATABASE_SCHEMA_MISMATCH",
      });
      expect(await directoryFingerprint(fixture.directory)).toEqual(
        beforeDirectory,
      );
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("malformed mounted paths return controlled 400 responses without killing the process", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-url-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
    });
    const originalPid = server.pid;
    const paths = [
      "/api/canvas/%",
      "/api/canvas/%C0%AF",
      "/api/canvas/%2Fetc",
      "/api/canvas/%5Cetc",
      "/api/canvas/%00",
      `/api/canvas/${"a".repeat(4_100)}`,
    ];
    for (const path of paths) {
      const response = await rawHttp(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toContain(" 400 ");
      expect(response).toContain('"code":"MALFORMED_URL"');
      expect(server.pid).toBe(originalPid);
      expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("JSON body failures and request IDs have stable safe classifications", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-json-"));
  const sensitiveCanary = "m81-cookie-password-api-key-prompt-secret";
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, { captureOutput: true });
    const spoofedId = "attacker-controlled-request-id";
    const live = await fetch(`${origin}/api/health/live`, {
      headers: { "X-Request-ID": spoofedId },
    });
    const requestId = live.headers.get("x-request-id") ?? "";
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(requestId).not.toBe(spoofedId);

    const cases: Array<{
      body: BodyInit;
      code: string;
      contentType: string;
      status: number;
    }> = [
      {
        body: "",
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: `{${sensitiveCanary}`,
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: new Uint8Array([0xc3, 0x28]),
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: "{}",
        contentType: "text/plain",
        code: "UNSUPPORTED_MEDIA_TYPE",
        status: 415,
      },
      {
        body: JSON.stringify({ padding: "x".repeat(70_000) }),
        contentType: "application/json",
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      },
    ];
    for (const fixture of cases) {
      const response = await fetch(`${origin}/api/auth/bootstrap`, {
        body: fixture.body,
        headers: {
          Authorization: `Bearer ${sensitiveCanary}`,
          "Content-Type": fixture.contentType,
          Cookie: `session=${sensitiveCanary}`,
          "X-Forwarded-For": "127.0.0.1",
        },
        method: "POST",
      });
      expect(response.status).toBe(fixture.status);
      expect(await response.json()).toMatchObject({
        code: fixture.code,
        requestId: response.headers.get("x-request-id"),
      });
    }
    const chunkedPayload = JSON.stringify({ padding: "x".repeat(70_000) });
    const chunked = await rawHttp([
      "POST /api/auth/bootstrap HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "X-Forwarded-For: 127.0.0.1",
      "Connection: close",
      "",
      chunkedPayload.length.toString(16),
      chunkedPayload,
      "0",
      "",
      "",
    ].join("\r\n"));
    expect(chunked).toContain(" 413 ");
    expect(chunked).toContain('"code":"PAYLOAD_TOO_LARGE"');

    const compatibleWithoutContentType = await fetch(
      `${origin}/api/auth/bootstrap`,
      {
        body: Buffer.from(JSON.stringify({
          displayName: "Compatible Owner",
          loginName: "compatible-owner",
          password: "compatible-password-123",
        })),
        headers: { "X-Forwarded-For": "127.0.0.1" },
        method: "POST",
      },
    );
    expect(compatibleWithoutContentType.status).toBe(201);
    const structuredJsonSuffix = await fetch(`${origin}/api/auth/login`, {
      body: JSON.stringify({
        loginName: "compatible-owner",
        password: "compatible-password-123",
      }),
      headers: {
        "Content-Type": "application/problem+json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(structuredJsonSuffix.status).toBe(200);
    const unauthorized = await fetch(`${origin}/api/auth/login`, {
      body: JSON.stringify({
        loginName: "compatible-owner",
        password: "incorrect-password-123",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    const duplicateBootstrap = await fetch(`${origin}/api/auth/bootstrap`, {
      body: JSON.stringify({
        displayName: "Duplicate Owner",
        loginName: "duplicate-owner",
        password: "duplicate-password-123",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(duplicateBootstrap.status).toBe(409);
    await expect.poll(() => outputOf(server!).includes('"event":"request"'))
      .toBe(true);
    await expect.poll(() => outputOf(server!).includes('"code":"HTTP_401"'))
      .toBe(true);
    await expect.poll(() => outputOf(server!).includes('"code":"HTTP_409"'))
      .toBe(true);
    expect(outputOf(server)).not.toContain(sensitiveCanary);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("malformed encoded upload names fail before any media path is created", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-filename-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
    });
    const uploads = [
      { contentType: "image/png", path: "/api/assets/m81-bad-name" },
      { contentType: "audio/mpeg", path: "/api/audio-assets/m81-bad-name.mp3" },
      { contentType: "video/mp4", path: "/api/video-assets/m81-bad-name.mp4" },
    ];
    for (const upload of uploads) {
      const response = await fetch(`${origin}${upload.path}`, {
        body: new Uint8Array(),
        headers: {
          "Content-Type": upload.contentType,
          "X-File-Name": "%",
        },
        method: "POST",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "MALFORMED_URL" });
    }
    await expectMissing(join(dataDirectory, "media"));
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("maintenance allows only health and version APIs without initializing data", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-maintenance-"));
  const dataDirectory = join(testRoot, "missing-data");
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, {
      environment: {
        UNBOUNDRY_MAINTENANCE_MODE: "1",
        UNBOUNDRY_TEST_AUTH_BYPASS: "1",
      },
    });
    const blocked = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Must not be created",
        loginName: "blocked-owner",
        password: "blocked-password-123",
      }),
      method: "POST",
    });
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await blocked.json()).toMatchObject({
      code: "SERVICE_MAINTENANCE",
    });
    for (const path of [
      "/api/auth/status",
      "/api/generation-tasks/status",
    ]) {
      const sideEffectingRead = await fetch(`${origin}${path}`);
      expect(sideEffectingRead.status).toBe(503);
      expect(await sideEffectingRead.json()).toMatchObject({
        code: "SERVICE_MAINTENANCE",
      });
    }
    const updates = await fetch(`${origin}/api/updates`);
    expect(updates.status).toBe(503);
    expect(await updates.json()).toMatchObject({
      code: "SERVICE_MAINTENANCE",
    });
    const version = await fetch(`${origin}/api/version`);
    expect(version.status).toBe(200);
    expect(await version.json()).toHaveProperty("version");
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const slowChunked = await slowChunkedHttp([
      "POST /api/auth/bootstrap HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "Connection: keep-alive",
      "",
      "1000",
      "{\"displayName\":\"never-finished",
    ].join("\r\n"));
    expect(slowChunked).toContain(" 503 ");
    expect(slowChunked).toContain("Connection: close");
    await expectMissing(dataDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("shutdown waits for handler cleanup and has a hard close-failure exit", async () => {
  const lifecycle = createRuntimeLifecycle({
    dataDirectory: join(tmpdir(), "unboundry-m81-unused-lifecycle-data"),
    logger: () => undefined,
    shutdownDeadlineMs: 1_000,
  });
  let releaseCleanup: (() => void) | undefined;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const handler = lifecycle.trackHandler(async () => {
    await cleanupGate;
  });
  const drain = lifecycle.beginShutdown();
  let drainSettled = false;
  void drain.then(() => { drainSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  expect(lifecycle.getInFlightRequests()).toBe(0);
  expect(lifecycle.getActiveHandlers()).toBe(1);
  expect(drainSettled).toBe(false);
  releaseCleanup?.();
  await handler;
  expect(await drain).toEqual({
    activeHandlers: 0,
    drained: true,
    inFlightRequests: 0,
  });

  const drainedResult: ShutdownResult = {
    activeHandlers: 0,
    drained: true,
    inFlightRequests: 0,
  };
  let synchronousFailureConnectionsClosed = 0;
  expect(await coordinateRuntimeShutdown({
    beginShutdown: async () => drainedResult,
    close: () => { throw new Error("synthetic synchronous close failure"); },
    closeAllConnections: () => { synchronousFailureConnectionsClosed += 1; },
    deadlineMs: 20,
    hardExitGraceMs: 20,
  })).toBe(1);
  expect(synchronousFailureConnectionsClosed).toBe(1);

  let hungCloseConnectionsClosed = 0;
  expect(await coordinateRuntimeShutdown({
    beginShutdown: async () => drainedResult,
    close: () => new Promise<void>(() => undefined),
    closeAllConnections: () => { hungCloseConnectionsClosed += 1; },
    deadlineMs: 0,
    hardExitGraceMs: 20,
  })).toBe(1);
  expect(hungCloseConnectionsClosed).toBe(1);
});

test("dev and preview own shutdown signals without erasing host listeners", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-shutdown-"));
  let server: ChildProcess | undefined;
  let updates: Awaited<ReturnType<typeof openServerEventStream>> | undefined;
  try {
    const cases: Array<{
      label: string;
      preview: boolean;
      signal: NodeJS.Signals;
    }> = [
      { label: "dev-term", preview: false, signal: "SIGTERM" },
      { label: "preview-term", preview: true, signal: "SIGTERM" },
      { label: "preview-int", preview: true, signal: "SIGINT" },
    ];
    for (const fixture of cases) {
      const dataDirectory = join(testRoot, fixture.label);
      const sentinelModule = join(dataDirectory, "signal-sentinel.mjs");
      const sentinelOutput = join(dataDirectory, "signal-sentinel.log");
      await mkdir(dataDirectory);
      await writeFile(sentinelModule, `
        import { appendFileSync } from "node:fs";
        const output = ${JSON.stringify(sentinelOutput)};
        const record = (label) => () => appendFileSync(output, label + "\\n");
        process.on("SIGTERM", record("listener-one"));
        process.on("SIGTERM", record("listener-two"));
        process.on("SIGINT", record("listener-one"));
        process.on("SIGINT", record("listener-two"));
        const originalOnce = process.once;
        let lateRegistered = false;
        process.once = function (event, listener) {
          const result = Reflect.apply(originalOnce, this, [event, listener]);
          if (
            !lateRegistered &&
            event === "SIGTERM" &&
            listener?.name === "parentSigtermCallback"
          ) {
            lateRegistered = true;
            process.on("SIGTERM", record("listener-late"));
          }
          return result;
        };
      `);
      server = await startServer(dataDirectory, {
        captureOutput: true,
        environment: {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${
            pathToFileURL(sentinelModule).href
          }`.trim(),
        },
        preview: fixture.preview,
      });
      updates = await openServerEventStream();
      expect(updates.status).toBe(200);
      await expect.poll(updates.text).toContain('"version"');

      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        server!.once("exit", (code, signal) => resolve({ code, signal }));
      });
      expect(server.kill(fixture.signal)).toBe(true);
      await expect.poll(updates.text).toContain("event: shutdown");
      await expect.poll(updates.text).toContain('"retryAfterSeconds"');
      await withTimeout(updates.closed, 5_000, "shutdown SSE did not close");

      const result = await withTimeout(
        exited,
        5_000,
        "server did not exit after drain",
      );
      expect(result).toEqual({ code: 0, signal: null });
      await expect.poll(
        () => outputOf(server!).includes('"code":"SHUTDOWN_DRAINED"'),
      ).toBe(true);
      const expectedListeners = fixture.signal === "SIGTERM"
        ? ["listener-late", "listener-one", "listener-two"]
        : ["listener-one", "listener-two"];
      expect((await readFile(sentinelOutput, "utf8")).trim().split("\n").sort())
        .toEqual(expectedListeners);
      expect(outputOf(server)).not.toMatch(/cookie|password|api.?key|prompt/i);
      updates.close();
      updates = undefined;
      await stopServer(server);
      server = undefined;
    }
  } finally {
    updates?.close();
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("unexpected database failures stay internal and the server remains alive", async () => {
  const secretCanary = "cookie-password-apikey-prompt-canary";
  const dataDirectory = await mkdtemp(
    join(tmpdir(), `unboundry-m81-${secretCanary}-`),
  );
  let server: ChildProcess | undefined;
  try {
    await mkdir(join(dataDirectory, "unboundry.sqlite"));
    server = await startServer(dataDirectory, {
      captureOutput: true,
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
    });
    const failed = await fetch(`${origin}/api/media-metadata/image/missing`);
    expect(failed.status).toBe(500);
    const body = await failed.text();
    expect(body).toContain('"code":"INTERNAL_ERROR"');
    expect(body).not.toContain(secretCanary);
    await expect.poll(
      () => outputOf(server!).includes('"code":"INTERNAL_ERROR"'),
    ).toBe(true);
    expect(outputOf(server)).not.toContain(secretCanary);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
