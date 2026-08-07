import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { saveAccountCredential } from "../server/accountCredentials";
import { currentSchemaVersion, openAppDatabase } from "../server/database";
import { executeTextTaskWithDependencies } from "../server/generationTasks";
import {
  createGenerationTaskStore,
  generationProviderAttemptCounts,
} from "../server/generationTaskStore";
import {
  acquireProviderGenerationRequestLease,
  getProviderGenerationProfileState,
  getProviderProfile,
  getProviderProfileForGeneration,
  prepareArkControlPlaneCredentials,
  providerConfigurationVersion,
  saveArkControlPlaneCredentials,
  saveProviderProfile,
  verifyProviderProfile,
} from "../server/providerProfiles";

const childBootstrap = `
  import { createServer } from "vite";
  const startAt = Number(process.argv[1]);
  const mode = process.argv[2];
  const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, startAt - Date.now()))
    );
    if (mode === "save" || mode === "save-paused") {
      const profileId = process.argv[3];
      const label = process.argv[4];
      const module = await server.ssrLoadModule("/server/providerProfiles.ts");
      if (mode === "save-paused") {
        const readyPath = process.argv[5];
        const releasePath = process.argv[6];
        const { access, writeFile } = await import("node:fs/promises");
        module.setProviderProfileAfterDocumentWriteHookForTests(async () => {
          await writeFile(readyPath, "document-renamed", { flag: "wx" });
          while (true) {
            try {
              await access(releasePath);
              break;
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          }
        });
      }
      const profile = await module.saveProviderProfile({
        apiKey: mode === "save-paused" ? process.argv[7] : "",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label,
      }, profileId);
      process.stdout.write(JSON.stringify({
        id: profile.id,
        label: profile.label,
        pid: process.pid,
        version: profile.configurationVersion,
      }));
    } else if (mode === "release") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(process.argv[3], "continue", { flag: "wx" });
      process.stdout.write(JSON.stringify({ pid: process.pid, released: true }));
    } else {
      const module = await server.ssrLoadModule("/server/database.ts");
      const database = module.openAppDatabase(process.env.TAPNOW_DATA_DIR);
      const version = database.prepare("PRAGMA user_version").get().user_version;
      database.close();
      process.stdout.write(JSON.stringify({ pid: process.pid, version }));
    }
  } finally {
    await server.close();
  }
`;

function runChild(
  dataDirectory: string,
  startAt: number,
  mode: "migrate" | "release" | "save" | "save-paused",
  ...args: string[]
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        childBootstrap,
        String(startAt),
        mode,
        ...args,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TAPNOW_DATA_DIR: dataDirectory,
          ...(mode === "save-paused"
            ? { TAPNOW_TEST_PROVIDER_PROFILE_BARRIER: "1" }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Provider child exited with ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error(`Provider child returned invalid output: ${stdout}\n${stderr}`));
      }
    });
  });
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPath(path: string) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function within<T>(promise: Promise<T>, milliseconds = 5_000) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Provider lock test timed out")), milliseconds)
    ),
  ]);
}

function restoreDataDirectory(previous: string | undefined) {
  if (previous === undefined) delete process.env.TAPNOW_DATA_DIR;
  else process.env.TAPNOW_DATA_DIR = previous;
}

test("two OS processes serialize complete Provider saves and metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-provider-os-save-"));
  const previous = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
  try {
    const initial = await saveProviderProfile({
      apiKey: `ark-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Initial",
    });
    const startAt = Date.now() + 500;
    const children = await Promise.all([
      runChild(directory, startAt, "save", initial.id, "OS writer A"),
      runChild(directory, startAt, "save", initial.id, "OS writer B"),
    ]);
    expect(new Set(children.map((item) => item.pid)).size).toBe(2);

    const stored = await getProviderProfile(initial.id);
    expect(stored?.configurationVersion).toBe(3);
    expect(["OS writer A", "OS writer B"]).toContain(stored?.label);
    const database = new DatabaseSync(join(directory, "tapnow.sqlite"), {
      readOnly: true,
    });
    try {
      expect(database.prepare(`
        SELECT display_name, driver, key_status,
          provider_configuration_version, status
        FROM provider_profiles WHERE id = ?
      `).get(initial.id)).toEqual({
        display_name: stored?.label,
        driver: "volcengine-ark",
        key_status: "unchecked",
        provider_configuration_version: stored?.configurationVersion,
        status: "disabled",
      });
    } finally {
      database.close();
    }
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("split document and metadata versions block a real task before fake fetch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-provider-split-"));
  const previous = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
  try {
    const original = await saveProviderProfile({
      apiKey: `ark-old-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark split",
    });
    await verifyProviderProfile(original.id, "__test__", async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const updated = await saveProviderProfile({
      apiKey: `ark-new-${randomUUID()}`,
      baseUrl: original.baseUrl,
      driver: original.driver,
      label: original.label,
    }, original.id);

    // This is the durable state left by a crash after the encrypted rename but
    // before the metadata transaction: new document, old green metadata.
    const database = new DatabaseSync(join(directory, "tapnow.sqlite"));
    database.prepare(`
      UPDATE provider_profiles
      SET provider_configuration_version = ?, status = 'enabled',
        key_status = 'valid'
      WHERE id = ?
    `).run(providerConfigurationVersion(original), original.id);
    database.close();

    await expect(getProviderProfileForGeneration(original.id, "__test__")).rejects
      .toMatchObject({ code: "PROVIDER_CONFIGURATION_MISMATCH" });
    expect(
      await getProviderGenerationProfileState(original.id, "__test__"),
    ).toMatchObject({
      configurationAligned: false,
      documentConfigurationVersion: providerConfigurationVersion(updated),
      metadataConfigurationVersion: providerConfigurationVersion(original),
      reason: "configuration-mismatch",
    });

    const store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "split-brain-text-task",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-split-target",
      ownerId: "__test__",
      parameters: { inputs: [], outputCount: 1, responseFormat: "text" },
      prompt: "不得发出请求",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: original.id,
    });
    let providerCalls = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      fetcher: async () => {
        providerCalls += 1;
        return new Response("{}", { status: 200 });
      },
      acquireProfile: acquireProviderGenerationRequestLease,
      mediaUrlForOwner: async () => "unused",
      store,
    });
    expect(providerCalls).toBe(0);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "PROVIDER_CONFIGURATION_MISMATCH",
      state: "failed",
    });
    const attemptsDatabase = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(attemptsDatabase)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
      });
    } finally {
      attemptsDatabase.close();
    }
    store.close();
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("a request lease releases after fake fetch starts instead of waiting for its response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-provider-fetch-lease-"));
  const previous = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  let execution: Promise<void> | undefined;
  let finishFetch = (_response: Response) => {};
  try {
    const profile = await saveProviderProfile({
      apiKey: `ark-old-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Fetch lease profile",
    });
    const credentialStore = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    credentialStore
      .prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('__test__', '__test__', 'Test User', 'test-only', 'admin', 'active', ?, ?)
      `)
      .run(timestamp, timestamp);
    await saveAccountCredential(
      credentialStore,
      "__test__",
      profile.id,
      "sk-lease-credential-1234",
    );
    credentialStore.close();
    await verifyProviderProfile(profile.id, "__test__", async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 }));
    store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "fetch-lease-text-task",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-fetch-lease-target",
      ownerId: "__test__",
      parameters: { inputs: [], outputCount: 1, responseFormat: "text" },
      prompt: "请求已发出后允许管理员保存",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    let fetchStarted = () => {};
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const pendingResponse = new Promise<Response>((resolve) => {
      finishFetch = resolve;
    });
    execution = executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: acquireProviderGenerationRequestLease,
      fetcher: () => {
        fetchStarted();
        return pendingResponse;
      },
      mediaUrlForOwner: async () => "unused",
      store,
    });
    await within(started);

    const saved = await within(saveProviderProfile({
      apiKey: `ark-new-${randomUUID()}`,
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: profile.label,
    }, profile.id));
    expect(providerConfigurationVersion(saved)).toBe(
      providerConfigurationVersion(profile) + 1,
    );

    finishFetch(new Response(JSON.stringify({
      output: [{
        content: [{ text: "已完成", type: "output_text" }],
        status: "completed",
        type: "message",
      }],
      status: "completed",
      usage: { total_tokens: 1 },
    }), { status: 200 }));
    await within(execution);
    expect(store.get(created.task.id)).toMatchObject({
      resultText: "已完成",
      state: "success",
    });
  } finally {
    finishFetch(new Response("{}", { status: 500 }));
    await execution?.catch(() => undefined);
    store?.close();
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("a request lease waits across the document-to-metadata window without using either mismatched Key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-provider-reader-lock-"));
  const previous = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
  const readyPath = join(directory, "provider-writer.ready");
  const releasePath = join(directory, "provider-writer.release");
  let writer: Promise<Record<string, unknown>> | undefined;
  let store: ReturnType<typeof createGenerationTaskStore> | undefined;
  try {
    const profile = await saveProviderProfile({
      apiKey: `ark-old-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Reader lock profile",
    });
    const credentialStore = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    credentialStore
      .prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('__test__', '__test__', 'Test User', 'test-only', 'admin', 'active', ?, ?)
      `)
      .run(timestamp, timestamp);
    await saveAccountCredential(
      credentialStore,
      "__test__",
      profile.id,
      "sk-reader-credential-1234",
    );
    credentialStore.close();
    await verifyProviderProfile(profile.id, "__test__", async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 }));
    store = createGenerationTaskStore(directory);
    const created = store.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "reader-lock-text-task",
      kind: "text",
      model: "model-text-doubao-seed",
      nodeId: "text-reader-lock-target",
      ownerId: "__test__",
      parameters: { inputs: [], outputCount: 1, responseFormat: "text" },
      prompt: "锁内不得发出请求",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });

    writer = runChild(
      directory,
      Date.now(),
      "save-paused",
      profile.id,
      "Rotated while reader waits",
      readyPath,
      releasePath,
      `ark-new-${randomUUID()}`,
    );
    await waitForPath(readyPath);

    let providerCalls = 0;
    const releaser = runChild(
      directory,
      Date.now() + 150,
      "release",
      releasePath,
    );
    const execution = executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: acquireProviderGenerationRequestLease,
      fetcher: async () => {
        providerCalls += 1;
        return new Response("{}", { status: 200 });
      },
      mediaUrlForOwner: async () => "unused",
      store,
    });
    const [saved] = await within(
      Promise.all([writer, execution, releaser]),
      10_000,
    );
    expect(saved.version).toBe(2);
    expect(providerCalls).toBe(0);
    expect(store.get(created.task.id)).toMatchObject({
      errorCode: "PROVIDER_REVERIFY_REQUIRED",
      state: "failed",
    });
    const database = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(database).paidProviderRequests).toBe(0);
    } finally {
      database.close();
    }
  } finally {
    await writeFile(releasePath, "continue").catch(() => undefined);
    await writer?.catch(() => undefined);
    store?.close();
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("version zero and metadata-ahead states fail closed without losing usable snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-provider-align-"));
  const previous = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
  try {
    const profile = await saveProviderProfile({
      apiKey: `ark-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark align",
    });
    await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId: `AKLT${randomUUID().replaceAll("-", "")}`,
      projectName: "default",
      secretAccessKey: `secret-${randomUUID()}`,
    });
    const documentProfile = await getProviderProfile(profile.id);
    expect(documentProfile?.arkControlPlane).toBeTruthy();
    const snapshot = JSON.stringify([{ discoveryId: "kept-model" }]);
    const syncedAt = "2026-08-03T10:00:00.000Z";
    const database = new DatabaseSync(join(directory, "tapnow.sqlite"));
    database.prepare(`
      UPDATE provider_profiles
      SET provider_configuration_version = 0,
        status = 'enabled', key_status = 'valid',
        catalog_key_status = 'valid', catalog_checked_at = ?,
        catalog_synced_at = ?, catalog_models = ?, catalog_model_count = 1
      WHERE id = ?
    `).run(syncedAt, syncedAt, snapshot, profile.id);
    database.close();

    await prepareArkControlPlaneCredentials(profile.id);
    const aligned = new DatabaseSync(join(directory, "tapnow.sqlite"));
    try {
      expect(aligned.prepare(`
        SELECT status, key_status, catalog_key_status, catalog_models,
          catalog_synced_at, provider_configuration_version
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_key_status: "unchecked",
        catalog_models: snapshot,
        catalog_synced_at: syncedAt,
        key_status: "unchecked",
        provider_configuration_version:
          providerConfigurationVersion(documentProfile!),
        status: "disabled",
      });

      aligned.prepare(`
        UPDATE provider_profiles
        SET provider_configuration_version = 0, driver = 'openrouter',
          status = 'enabled', key_status = 'valid',
          catalog_key_status = 'valid', catalog_checked_at = ?,
          catalog_synced_at = ?, catalog_models = ?, catalog_model_count = 1
        WHERE id = ?
      `).run(syncedAt, syncedAt, snapshot, profile.id);
    } finally {
      aligned.close();
    }
    await prepareArkControlPlaneCredentials(profile.id);
    const cleared = new DatabaseSync(join(directory, "tapnow.sqlite"));
    try {
      expect(cleared.prepare(`
        SELECT driver, status, key_status, catalog_key_status,
          catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_key_status: "unchecked",
        catalog_models: "[]",
        catalog_synced_at: null,
        driver: "volcengine-ark",
        key_status: "unchecked",
        status: "disabled",
      });
      cleared.prepare(`
        UPDATE provider_profiles
        SET provider_configuration_version = ?, status = 'enabled',
          key_status = 'valid', catalog_key_status = 'valid',
          catalog_models = ?, catalog_model_count = 1,
          catalog_synced_at = ?
        WHERE id = ?
      `).run(
        providerConfigurationVersion(documentProfile!) + 10,
        snapshot,
        syncedAt,
        profile.id,
      );
    } finally {
      cleared.close();
    }

    await expect(prepareArkControlPlaneCredentials(profile.id)).rejects
      .toMatchObject({ code: "PROVIDER_CONFIGURATION_MISMATCH" });
    const ahead = new DatabaseSync(join(directory, "tapnow.sqlite"), {
      readOnly: true,
    });
    try {
      expect(ahead.prepare(`
        SELECT status, key_status, catalog_key_status,
          catalog_last_error_code, provider_configuration_version
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_key_status: "unchecked",
        catalog_last_error_code: "CONFIGURATION_MISMATCH",
        key_status: "unchecked",
        provider_configuration_version:
          providerConfigurationVersion(documentProfile!) + 10,
        status: "disabled",
      });
    } finally {
      ahead.close();
    }
    await expect(getProviderProfileForGeneration(profile.id, "__test__")).rejects
      .toMatchObject({ code: "PROVIDER_CONFIGURATION_MISMATCH" });
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("a late old Key check cannot write green after the metadata CAS changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-provider-key-cas-"));
  const previous = process.env.TAPNOW_DATA_DIR;
  process.env.TAPNOW_DATA_DIR = directory;
  try {
    const profile = await saveProviderProfile({
      apiKey: `openrouter-${randomUUID()}`,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "CAS profile",
    });
    const validResponse = () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
    });
    await verifyProviderProfile(profile.id, "__test__", async () => validResponse());

    let release = () => {};
    let started = () => {};
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    const requestReleased = new Promise<void>((resolve) => { release = resolve; });
    const late = verifyProviderProfile(profile.id, "__test__", async () => {
      started();
      await requestReleased;
      return validResponse();
    });
    await requestStarted;
    const database = new DatabaseSync(join(directory, "tapnow.sqlite"));
    database.prepare(`
      UPDATE provider_profiles
      SET provider_configuration_version = provider_configuration_version + 1,
        status = 'disabled', key_status = 'unchecked', key_checked_at = NULL
      WHERE id = ?
    `).run(profile.id);
    database.close();
    release();
    await expect(late).rejects.toThrow("CONFIG_CHANGED");

    const checked = new DatabaseSync(join(directory, "tapnow.sqlite"), {
      readOnly: true,
    });
    try {
      expect(checked.prepare(`
        SELECT status, key_status, key_checked_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        key_checked_at: null,
        key_status: "unchecked",
        status: "disabled",
      });
    } finally {
      checked.close();
    }
  } finally {
    restoreDataDirectory(previous);
    await rm(directory, { force: true, recursive: true });
  }
});

test("two OS processes can migrate the same v18 database exactly once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tapnow-provider-migrate-"));
  try {
    const legacy = openAppDatabase(directory);
    const columns = () => new Set(
      (legacy.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{
        name: string;
      }>).map((column) => column.name),
    );
    if (columns().has("catalog_sync_token")) {
      legacy.exec("ALTER TABLE provider_profiles DROP COLUMN catalog_sync_token");
    }
    if (columns().has("provider_configuration_version")) {
      legacy.exec(
        "ALTER TABLE provider_profiles DROP COLUMN provider_configuration_version",
      );
    }
    legacy.exec(`
      DELETE FROM schema_migrations WHERE version >= 19;
      PRAGMA user_version = 18;
    `);
    legacy.close();

    const startAt = Date.now() + 500;
    const migrated = await Promise.all([
      runChild(directory, startAt, "migrate"),
      runChild(directory, startAt, "migrate"),
    ]);
    expect(new Set(migrated.map((item) => item.pid)).size).toBe(2);
    expect(new Set(migrated.map((item) => item.version))).toEqual(
      new Set([currentSchemaVersion]),
    );
    const database = new DatabaseSync(join(directory, "tapnow.sqlite"), {
      readOnly: true,
    });
    try {
      const names = new Set(
        (database.prepare("PRAGMA table_info(provider_profiles)").all() as Array<{
          name: string;
        }>).map((column) => column.name),
      );
      expect(names.has("provider_configuration_version")).toBe(true);
      expect(names.has("catalog_sync_token")).toBe(true);
      expect(names.has("catalog_diagnostics")).toBe(true);
      expect(database.prepare(`
        SELECT version, COUNT(*) AS count
        FROM schema_migrations WHERE version >= 19
        GROUP BY version ORDER BY version
      `).all()).toEqual([
        { count: 1, version: 19 },
        { count: 1, version: 20 },
        { count: 1, version: 21 },
        { count: 1, version: 22 },
        { count: 1, version: 23 },
        { count: 1, version: 24 },
        { count: 1, version: 25 },
        { count: 1, version: 26 },
        { count: 1, version: 27 },
        { count: 1, version: 28 },
        { count: 1, version: 29 },
      ]);
    } finally {
      database.close();
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
