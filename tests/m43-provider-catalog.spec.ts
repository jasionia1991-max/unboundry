import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import {
  getProviderProfile,
  providerProfileWriteLockPath,
  saveArkControlPlaneCredentials,
  saveProviderProfile,
} from "../server/providerProfiles";
import {
  getArkProviderCatalog,
  importArkCatalogDrafts,
  syncArkProviderCatalog,
} from "../server/providerCatalog";
import { appDataDirectory, openAppDatabase } from "../server/database";

function arkResponse(action: string) {
  if (action === "ListFoundationModels") {
    return {
      ResponseMetadata: {
        Action: action,
        Region: "cn-beijing",
        RequestId: "model-list-request",
        Service: "ark",
        Version: "2024-01-01",
      },
      Result: {
        Items: [{
          DisplayName: "Seedream 4",
          FoundationModelTag: { TaskTypes: ["Image"] },
          Name: "doubao-seedream-4-0",
          PrimaryVersion: "250828",
          Status: "Published",
        }],
        TotalCount: 1,
      },
    };
  }
  if (action === "ListFoundationModelVersions") {
    return {
      ResponseMetadata: {
        Action: action,
        Region: "cn-beijing",
        RequestId: "version-list-request",
        Service: "ark",
        Version: "2024-01-01",
      },
      Result: {
        Items: [{ ModelVersion: "250828", Status: "Published" }],
        TotalCount: 1,
      },
    };
  }
  if (action === "ListEndpoints") {
    return {
      ResponseMetadata: {
        Action: action,
        Region: "cn-beijing",
        RequestId: "endpoint-list-request",
        Service: "ark",
        Version: "2024-01-01",
      },
      Result: {
        Items: [{
          Id: "ep-safe-readonly",
          ModelReference: {
            FoundationModel: {
              ModelVersion: "250828",
              Name: "doubao-seedream-4-0",
            },
          },
          Name: "Seedream endpoint",
          Status: "Running",
        }],
        PageNumber: 1,
        PageSize: 100,
        TotalCount: 1,
      },
    };
  }
  throw new Error("Unexpected Ark action");
}

function fakeArkFetcher(actions: string[]) {
  return async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("Action") ?? "";
    actions.push(action);
    return new Response(JSON.stringify(arkResponse(action)), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
}

async function holdDatabaseWriteLockUntilChildExit(databasePath: string) {
  const child = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(process.argv[1], { timeout: 5000 });
    database.exec([
      "PRAGMA busy_timeout = 5000;",
      "BEGIN IMMEDIATE;",
      "UPDATE provider_profile_write_lock",
      "SET marker = marker + 1",
      "WHERE id = 1;",
    ].join("\\n"));
    globalThis.__providerLockDatabase = database;
    process.send({
      isTransaction: database.isTransaction,
      lockedAt: Date.now(),
      type: "locked",
    });
    setTimeout(() => {
      if (!globalThis.__providerLockDatabase) process.exit(1);
      process.exit(0);
    }, 1000);
  `, databasePath], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Lock child exited with ${code}: ${stderr}`));
    });
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("message", (message) => {
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "locked"
      ) {
        if (!("isTransaction" in message) || message.isTransaction !== true) {
          reject(new Error(`Lock child did not retain its transaction: ${JSON.stringify(message)}`));
          return;
        }
        if (
          !("lockedAt" in message) ||
          typeof message.lockedAt !== "number" ||
          Date.now() - message.lockedAt > 250
        ) {
          reject(new Error("Lock child notification arrived too late"));
          return;
        }
        resolve();
      }
      else reject(new Error("Lock child did not acquire the database lock"));
    });
  });
  return { exited };
}

async function commitCatalogSnapshotFromSiblingProcess(
  databasePath: string,
  profileId: string,
  marker: string,
) {
  const syncToken = randomUUID();
  const syncedAt = new Date().toISOString();
  const models = JSON.stringify([{
    capability: "image",
    discoveryId: `foundation:${marker}:1`,
    displayName: marker,
    providerModelId: `${marker}-model`,
    source: "volcengine-ark-control-plane",
    status: "Published",
  }]);
  const child = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require("node:sqlite");
    const [databasePath, profileId, syncToken, syncedAt, models] =
      process.argv.slice(1);
    const database = new DatabaseSync(databasePath, { timeout: 5000 });
    try {
      database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
      const claimed = database.prepare([
        "UPDATE provider_profiles",
        "SET catalog_sync_token = ?",
        "WHERE id = ? AND driver = 'volcengine-ark'",
      ].join(" ")).run(syncToken, profileId);
      if (claimed.changes !== 1) throw new Error("sibling claim failed");
      const completed = database.prepare([
        "UPDATE provider_profiles SET",
        "catalog_key_status = 'valid',",
        "catalog_checked_at = ?, catalog_synced_at = ?,",
        "catalog_last_error_code = NULL, catalog_models = ?,",
        "catalog_endpoints = '[]', catalog_model_count = 1,",
        "catalog_endpoint_count = 0, catalog_sync_token = NULL",
        "WHERE id = ? AND catalog_sync_token = ?",
      ].join(" ")).run(syncedAt, syncedAt, models, profileId, syncToken);
      if (completed.changes !== 1) throw new Error("sibling completion failed");
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      console.error(error);
      process.exitCode = 1;
    } finally {
      database.close();
    }
  `, databasePath, profileId, syncToken, syncedAt, models], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk) => { stderr += chunk; });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Catalog sibling exited with ${code}: ${stderr}`));
    });
  });
  return { models, syncedAt };
}

async function holdAppDatabaseWriteLock(
  databasePath: string,
  profileId: string,
  holdMilliseconds: number,
) {
  const child = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(process.argv[1], { timeout: 5000 });
    database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
    database.prepare([
      "UPDATE provider_profiles",
      "SET updated_at = updated_at",
      "WHERE id = ?",
    ].join(" ")).run(process.argv[2]);
    process.send({ type: "locked" });
    setTimeout(() => {
      database.exec("ROLLBACK");
      database.close();
      process.exit(0);
    }, Number(process.argv[3]));
  `, databasePath, profileId, String(holdMilliseconds)], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Database lock child exited with ${code}: ${stderr}`));
    });
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("message", (message) => {
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "locked"
      ) resolve();
      else reject(new Error("Database lock child did not acquire its lock"));
    });
  });
  return { exited };
}

test("Ark AK/SK remains encrypted while catalog sync and draft import are durable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-ark-catalog-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  expect(appDataDirectory()).toBe(dataDirectory);
  const accessKeyId = `AKLT${randomUUID().replaceAll("-", "")}`;
  const secretAccessKey = `secret-${randomUUID()}-${randomUUID()}`;
  try {
    openAppDatabase(dataDirectory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-api-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark with catalog",
    });
    const expectedLockPath = join(
      dataDirectory,
      "secrets",
      "provider-profile-write-lock.sqlite",
    );
    expect(providerProfileWriteLockPath()).toBe(expectedLockPath);
    const { exited: siblingProcessExited } =
      await holdDatabaseWriteLockUntilChildExit(expectedLockPath);
    const lockProbe = new DatabaseSync(expectedLockPath, { timeout: 1 });
    try {
      lockProbe.exec("PRAGMA busy_timeout = 1");
      expect(() => lockProbe.exec("BEGIN IMMEDIATE")).toThrow();
      expect(lockProbe.isTransaction).toBe(false);
    } finally {
      lockProbe.close();
    }
    const saveStartedAt = Date.now();
    const saved = await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId,
      projectName: "default",
      secretAccessKey,
    });
    expect(Date.now() - saveStartedAt).toBeGreaterThanOrEqual(500);
    await siblingProcessExited;
    expect(saved).toMatchObject({
      accessKeyIdMask: `••••${accessKeyId.slice(-4)}`,
      hasCredentials: true,
      projectName: "default",
    });
    expect(JSON.stringify(saved)).not.toContain(secretAccessKey);

    await Promise.all([
      saveProviderProfile({
        apiKey: "",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: "Ark concurrent A",
      }, profile.id),
      saveProviderProfile({
        apiKey: "",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: "Ark concurrent B",
      }, profile.id),
    ]);
    const latestConcurrentProfile = await getProviderProfile(profile.id);
    const concurrentMetadata = new DatabaseSync(
      join(dataDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    try {
      expect(concurrentMetadata.prepare(`
        SELECT display_name, driver, provider_configuration_version
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        display_name: latestConcurrentProfile?.label,
        driver: latestConcurrentProfile?.driver,
        provider_configuration_version:
          latestConcurrentProfile?.configurationVersion,
      });
    } finally {
      concurrentMetadata.close();
    }

    const actions: string[] = [];
    const sync = await syncArkProviderCatalog(
      profile.id,
      fakeArkFetcher(actions) as typeof fetch,
    );
    expect(actions).toEqual([
      "ListFoundationModels",
      "ListFoundationModelVersions",
      "ListEndpoints",
    ]);
    expect(sync).toMatchObject({
      catalog: {
        endpointCount: 1,
        keyStatus: "valid",
        modelCount: 1,
      },
      controlPlaneRequests: 3,
    });
    const model = sync.catalog.models[0] as {
      capability: string;
      discoveryId: string;
      providerModelId: string;
    };
    expect(model).toMatchObject({
      capability: "image",
      providerModelId: "doubao-seedream-4-0-250828",
    });

    const auditStore = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      const timestamp = new Date().toISOString();
      auditStore.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash,
          role, status, created_at, updated_at
        )
        VALUES (?, 'catalog-admin', 'Catalog Admin', 'test-only-hash',
          'admin', 'active', ?, ?)
      `).run("user-admin-fixture", timestamp, timestamp);
    } finally {
      auditStore.close();
    }

    const firstImport = importArkCatalogDrafts(
      profile.id,
      [{ discoveryId: model.discoveryId }],
      "user-admin-fixture",
    );
    expect(firstImport).toEqual({ imported: 1, skipped: 0 });
    const secondImport = importArkCatalogDrafts(
      profile.id,
      [{ discoveryId: model.discoveryId }],
      "user-admin-fixture",
    );
    expect(secondImport).toEqual({ imported: 0, skipped: 1 });

    const encrypted = await readFile(
      join(dataDirectory, "secrets", "provider-profiles.enc.json"),
      "utf8",
    );
    expect(encrypted).not.toContain(accessKeyId);
    expect(encrypted).not.toContain(secretAccessKey);
    const databasePath = join(dataDirectory, "unboundry.sqlite");
    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from(accessKeyId))).toBe(false);
    expect(databaseBytes.includes(Buffer.from(secretAccessKey))).toBe(false);
    const store = new DatabaseSync(databasePath);
    try {
      expect(store.prepare(`
        SELECT
          catalog_control_request_count,
          catalog_credential_revision,
          catalog_endpoint_count,
          catalog_key_status,
          catalog_model_count
        FROM provider_profiles
        WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_control_request_count: 3,
        catalog_credential_revision: expect.any(String),
        catalog_endpoint_count: 1,
        catalog_key_status: "valid",
        catalog_model_count: 1,
      });
      expect(store.prepare(`
        SELECT capability, provider_model_id, status
        FROM model_profiles
        WHERE provider_profile_id = ? AND provider_model_id = ?
      `).get(profile.id, model.providerModelId)).toMatchObject({
        capability: "image",
        provider_model_id: model.providerModelId,
        status: "draft",
      });
      expect(store.prepare(`
        SELECT enabled, is_default
        FROM node_model_bindings
        WHERE model_id = (
          SELECT id FROM model_profiles
          WHERE provider_profile_id = ? AND provider_model_id = ?
        )
      `).get(profile.id, model.providerModelId)).toMatchObject({
        enabled: 0,
        is_default: 0,
      });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toMatchObject({ count: 0 });

      const storedModels = JSON.parse(
        (store.prepare(`
          SELECT catalog_models FROM provider_profiles WHERE id = ?
        `).get(profile.id) as { catalog_models: string }).catalog_models,
      ) as Array<Record<string, unknown>>;
      storedModels[0].secretAccessKey = secretAccessKey;
      storedModels[0].unexpectedRemoteField = "must-not-be-public";
      store.prepare(`
        UPDATE provider_profiles SET catalog_models = ? WHERE id = ?
      `).run(JSON.stringify(storedModels), profile.id);
      const projectedCatalog = getArkProviderCatalog(profile.id);
      expect(JSON.stringify(projectedCatalog)).not.toContain(secretAccessKey);
      expect(JSON.stringify(projectedCatalog)).not.toContain(
        "must-not-be-public",
      );
      expect(Object.keys(projectedCatalog.models[0]).sort()).toEqual([
        "capability",
        "discoveryId",
        "displayName",
        "providerModelId",
        "source",
        "status",
      ]);
    } finally {
      store.close();
    }
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("catalog failures preserve the last snapshot and stale sync cannot overwrite new credentials", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-ark-catalog-race-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    openAppDatabase(dataDirectory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-api-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark race",
    });
    await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId: `AKLT${randomUUID().replaceAll("-", "")}`,
      projectName: "default",
      secretAccessKey: `secret-${randomUUID()}`,
    });
    await syncArkProviderCatalog(
      profile.id,
      fakeArkFetcher([]) as typeof fetch,
    );
    const store = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    const lastGood = store.prepare(`
      SELECT catalog_models, catalog_synced_at
      FROM provider_profiles WHERE id = ?
    `).get(profile.id) as { catalog_models: string; catalog_synced_at: string };
    store.close();

    await expect(syncArkProviderCatalog(
      profile.id,
      (async () => new Response(JSON.stringify({
        ResponseMetadata: { Error: { Code: "AccessDenied" } },
      }), { status: 403 })) as typeof fetch,
    )).rejects.toMatchObject({ code: "PERMISSION" });
    const afterFailure = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      expect(afterFailure.prepare(`
        SELECT
          catalog_key_status,
          catalog_models,
          catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_key_status: "permission",
        catalog_models: lastGood.catalog_models,
        catalog_synced_at: lastGood.catalog_synced_at,
      });
    } finally {
      afterFailure.close();
    }

    let release = () => {};
    let started = () => {};
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    const requestReleased = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    const staleSync = syncArkProviderCatalog(profile.id, (async (input) => {
      if (first) {
        first = false;
        started();
        await requestReleased;
      }
      const action = new URL(String(input)).searchParams.get("Action") ?? "";
      return new Response(JSON.stringify(arkResponse(action)), { status: 200 });
    }) as typeof fetch);
    await requestStarted;
    await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId: `AKLT${randomUUID().replaceAll("-", "")}`,
      projectName: "default",
      secretAccessKey: `replacement-${randomUUID()}`,
    });
    release();
    await expect(staleSync).rejects.toThrow("CONFIG_CHANGED");
    const latestProfile = await getProviderProfile(profile.id);
    expect(latestProfile?.arkControlPlane?.revision).toBeTruthy();
    const afterStale = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      expect(afterStale.prepare(`
        SELECT catalog_key_status, catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_key_status: "unchecked",
        catalog_models: lastGood.catalog_models,
        catalog_synced_at: lastGood.catalog_synced_at,
      });
    } finally {
      afterStale.close();
    }

    let releaseDatabaseRace = () => {};
    let databaseRaceStarted = () => {};
    const databaseRaceRequestStarted = new Promise<void>((resolve) => {
      databaseRaceStarted = resolve;
    });
    const databaseRaceRequestReleased = new Promise<void>((resolve) => {
      releaseDatabaseRace = resolve;
    });
    let databaseRaceFirst = true;
    const databaseRaceSync = syncArkProviderCatalog(profile.id, (async (input) => {
      if (databaseRaceFirst) {
        databaseRaceFirst = false;
        databaseRaceStarted();
        await databaseRaceRequestReleased;
      }
      const action = new URL(String(input)).searchParams.get("Action") ?? "";
      return new Response(JSON.stringify(arkResponse(action)), { status: 200 });
    }) as typeof fetch);
    await databaseRaceRequestStarted;
    const conflictingStore = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      conflictingStore.prepare(`
        UPDATE provider_profiles
        SET catalog_credential_revision = ?
        WHERE id = ?
      `).run(randomUUID(), profile.id);
    } finally {
      conflictingStore.close();
    }
    releaseDatabaseRace();
    await expect(databaseRaceSync).rejects.toThrow("CONFIG_CHANGED");
    const afterDatabaseRace = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      expect(afterDatabaseRace.prepare(`
        SELECT catalog_key_status, catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_key_status: "unchecked",
        catalog_models: lastGood.catalog_models,
        catalog_synced_at: lastGood.catalog_synced_at,
      });
    } finally {
      afterDatabaseRace.close();
    }

    const restoredRevision = latestProfile?.arkControlPlane?.revision;
    if (!restoredRevision) throw new Error("Missing current catalog revision");
    const revisionRepair = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      revisionRepair.prepare(`
        UPDATE provider_profiles
        SET catalog_credential_revision = ?, catalog_sync_token = NULL
        WHERE id = ?
      `).run(restoredRevision, profile.id);
    } finally {
      revisionRepair.close();
    }

    await expect(syncArkProviderCatalog(
      profile.id,
      (async (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        if (signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      })) as typeof fetch,
      { maximumDurationMs: 10 },
    )).rejects.toMatchObject({ code: "NETWORK" });
    const afterTimeout = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      expect(afterTimeout.prepare(`
        SELECT catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_models: lastGood.catalog_models,
        catalog_synced_at: lastGood.catalog_synced_at,
      });
    } finally {
      afterTimeout.close();
    }
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("the last sync caller claims its database token before credential preparation", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-ark-pre-claim-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  try {
    openAppDatabase(dataDirectory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-api-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark pre-claim ordering",
    });
    await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId: `AKLT${randomUUID().replaceAll("-", "")}`,
      projectName: "default",
      secretAccessKey: `secret-${randomUUID()}`,
    });

    const oldActions: string[] = [];
    let oldError: unknown;
    const oldSyncSettled = syncArkProviderCatalog(
      profile.id,
      fakeArkFetcher(oldActions) as typeof fetch,
    ).catch((error) => {
      oldError = error;
    });
    const latestActions: string[] = [];
    const latest = await syncArkProviderCatalog(
      profile.id,
      fakeArkFetcher(latestActions) as typeof fetch,
    );
    await oldSyncSettled;

    expect(oldError).toMatchObject({ code: "STALE" });
    expect(oldActions).toEqual([]);
    expect(latestActions).toEqual([
      "ListFoundationModels",
      "ListFoundationModelVersions",
      "ListEndpoints",
    ]);
    expect(latest.controlPlaneRequests).toBe(3);
    const store = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(store.prepare(`
        SELECT
          catalog_control_request_count,
          catalog_key_status,
          catalog_model_count,
          catalog_sync_token
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_control_request_count: 3,
        catalog_key_status: "valid",
        catalog_model_count: 1,
        catalog_sync_token: null,
      });
    } finally {
      store.close();
    }
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("database sync tokens reject late success and failure from an older process", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-ark-sync-token-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  try {
    openAppDatabase(dataDirectory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-api-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark cross-process ordering",
    });
    await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId: `AKLT${randomUUID().replaceAll("-", "")}`,
      projectName: "default",
      secretAccessKey: `secret-${randomUUID()}`,
    });
    await syncArkProviderCatalog(
      profile.id,
      fakeArkFetcher([]) as typeof fetch,
    );
    const baselineStore = new DatabaseSync(databasePath, { readOnly: true });
    const baselineRequestCount = Number((baselineStore.prepare(`
      SELECT catalog_control_request_count
      FROM provider_profiles WHERE id = ?
    `).get(profile.id) as { catalog_control_request_count: number })
      .catalog_control_request_count);
    baselineStore.close();

    let releaseLateSuccess = () => {};
    let lateSuccessStarted = () => {};
    const lateSuccessRequestStarted = new Promise<void>((resolve) => {
      lateSuccessStarted = resolve;
    });
    const lateSuccessRequestReleased = new Promise<void>((resolve) => {
      releaseLateSuccess = resolve;
    });
    let lateSuccessFirstRequest = true;
    const lateSuccess = syncArkProviderCatalog(profile.id, (async (input) => {
      if (lateSuccessFirstRequest) {
        lateSuccessFirstRequest = false;
        lateSuccessStarted();
        await lateSuccessRequestReleased;
      }
      const action = new URL(String(input)).searchParams.get("Action") ?? "";
      return new Response(JSON.stringify(arkResponse(action)), { status: 200 });
    }) as typeof fetch);
    await lateSuccessRequestStarted;
    const newerSuccess = await commitCatalogSnapshotFromSiblingProcess(
      databasePath,
      profile.id,
      "newer-success",
    );
    releaseLateSuccess();
    await expect(lateSuccess).rejects.toMatchObject({ code: "STALE" });
    const afterLateSuccess = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(afterLateSuccess.prepare(`
        SELECT
          catalog_control_request_count,
          catalog_key_status,
          catalog_last_error_code,
          catalog_models,
          catalog_synced_at,
          catalog_sync_token
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_control_request_count: baselineRequestCount + 3,
        catalog_key_status: "valid",
        catalog_last_error_code: null,
        catalog_models: newerSuccess.models,
        catalog_synced_at: newerSuccess.syncedAt,
        catalog_sync_token: null,
      });
    } finally {
      afterLateSuccess.close();
    }

    let releaseLateFailure = () => {};
    let lateFailureStarted = () => {};
    const lateFailureRequestStarted = new Promise<void>((resolve) => {
      lateFailureStarted = resolve;
    });
    const lateFailureRequestReleased = new Promise<void>((resolve) => {
      releaseLateFailure = resolve;
    });
    const lateFailure = syncArkProviderCatalog(profile.id, (async () => {
      lateFailureStarted();
      await lateFailureRequestReleased;
      return new Response(JSON.stringify({
        ResponseMetadata: { Error: { Code: "AccessDenied" } },
      }), { status: 403 });
    }) as typeof fetch);
    await lateFailureRequestStarted;
    const newerAfterFailure = await commitCatalogSnapshotFromSiblingProcess(
      databasePath,
      profile.id,
      "newer-after-failure",
    );
    releaseLateFailure();
    await expect(lateFailure).rejects.toMatchObject({ code: "PERMISSION" });
    const afterLateFailure = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(afterLateFailure.prepare(`
        SELECT
          catalog_control_request_count,
          catalog_key_status,
          catalog_last_error_code,
          catalog_models,
          catalog_synced_at,
          catalog_sync_token
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_control_request_count: baselineRequestCount + 4,
        catalog_key_status: "valid",
        catalog_last_error_code: null,
        catalog_models: newerAfterFailure.models,
        catalog_synced_at: newerAfterFailure.syncedAt,
        catalog_sync_token: null,
      });
    } finally {
      afterLateFailure.close();
    }
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("catalog deadline starts before credential preparation and skips remote reads", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-ark-deadline-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  try {
    openAppDatabase(dataDirectory).close();
    const profile = await saveProviderProfile({
      apiKey: `ark-api-${randomUUID()}`,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark total deadline",
    });
    await saveArkControlPlaneCredentials(profile.id, {
      accessKeyId: `AKLT${randomUUID().replaceAll("-", "")}`,
      projectName: "default",
      secretAccessKey: `secret-${randomUUID()}`,
    });
    await syncArkProviderCatalog(
      profile.id,
      fakeArkFetcher([]) as typeof fetch,
    );
    const metadata = new DatabaseSync(databasePath);
    const initialRequestCount = Number((metadata.prepare(`
      SELECT catalog_control_request_count
      FROM provider_profiles WHERE id = ?
    `).get(profile.id) as { catalog_control_request_count: number })
      .catalog_control_request_count);
    metadata.prepare(`
      UPDATE provider_profiles
      SET provider_configuration_version = 0
      WHERE id = ?
    `).run(profile.id);
    metadata.close();

    const { exited } = await holdAppDatabaseWriteLock(
      databasePath,
      profile.id,
      120,
    );
    const remoteActions: string[] = [];
    try {
      await expect(syncArkProviderCatalog(
        profile.id,
        fakeArkFetcher(remoteActions) as typeof fetch,
        { maximumDurationMs: 20 },
      )).rejects.toMatchObject({ code: "NETWORK" });
    } finally {
      await exited;
    }
    expect(remoteActions).toEqual([]);
    const afterDeadline = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(afterDeadline.prepare(`
        SELECT catalog_control_request_count
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toMatchObject({
        catalog_control_request_count: initialRequestCount,
      });
    } finally {
      afterDeadline.close();
    }
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("Ark catalog administration UI stays local and imports only reviewed drafts", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL!).origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  const catalogRequests: Array<{ body: unknown; method: string; path: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (
      request.method() === "POST" &&
      url.pathname.startsWith("/api/generation-tasks")
    ) {
      generationRequests.push(request.url());
    }
  });
  const profileId = "11111111-1111-4111-8111-111111111117";
  const catalog = {
    accessKeyIdMask: "••••safe",
    checkedAt: "2026-08-03T09:00:00.000Z",
    configuredModelCount: 1,
    controlRequestCount: 3,
    endpointCount: 1,
    hasCredentials: true,
    keyStatus: "valid",
    modelCount: 2,
    projectName: "default",
    snapshotStale: false,
    syncedAt: "2026-08-03T09:00:00.000Z",
  };
  const models = [{
    capability: "image",
    discoveryId: "foundation:seedream:1",
    displayName: "Seedream Official",
    providerModelId: "doubao-seedream-test-1",
    source: "volcengine-ark-control-plane",
    status: "Published",
  }, {
    capability: "unknown",
    discoveryId: "foundation:future:1",
    displayName: "Future Model",
    providerModelId: "future-model-1",
    source: "volcengine-ark-control-plane",
    status: "Published",
  }];

  await page.route("**/api/admin/providers", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
        profiles: [{
          apiKeyMask: "••••api1",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          driver: "volcengine-ark",
          hasApiKey: true,
          id: profileId,
          keyStatus: "valid",
          label: "Ark Catalog",
          lastCheckedAt: "2026-08-03T09:00:00.000Z",
          modelCatalog: catalog,
          status: "verified",
          updatedAt: "2026-08-03T09:00:00.000Z",
        }],
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: ["volcengine-ark"],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/admin/provider-catalog/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() ? request.postDataJSON() : undefined;
    catalogRequests.push({ body, method: request.method(), path: url.pathname });
    if (url.pathname.endsWith("/credentials")) {
      await route.fulfill({
        body: JSON.stringify({
          credentials: {
            accessKeyIdMask: "••••next",
            hasCredentials: true,
            projectName: "default",
          },
          paidGenerationRequests: 0,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/sync")) {
      await route.fulfill({
        body: JSON.stringify({
          catalog,
          controlPlaneRequests: 3,
          message: "同步完成：2 个官方模型，1 个接入点。",
          paidGenerationRequests: 0,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/import")) {
      await route.fulfill({
        body: JSON.stringify({
          imported: 1,
          message:
            "已添加 1 个模型到模型中心，当前保持停用；不会自动发布或发起生成。",
          paidGenerationRequests: 0,
          skipped: 0,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        ...catalog,
        endpoints: [{ id: "ep-safe", name: "Image Endpoint", status: "Running" }],
        models,
        paidGenerationRequests: 0,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/providers");
  const catalogSection = page.getByTestId(`provider-model-catalog-${profileId}`);
  await expect(catalogSection).toBeVisible();
  await expect(catalogSection.getByText("目录凭证有效")).toBeVisible();
  await expect(catalogSection.getByText("••••safe", { exact: false })).toBeVisible();
  await expect(catalogSection.locator("dl")).toContainText("官方模型2");
  await expect(catalogSection.locator("dl")).toContainText("Endpoint1");
  await expect(catalogSection.locator("dl")).toContainText("本项目已配置1");

  const accessKeyId = `AKLT-browser-${randomUUID()}`;
  const secretAccessKey = `SK-browser-${randomUUID()}`;
  await catalogSection.getByRole("button", { name: "修改目录凭证" }).click();
  await catalogSection.getByLabel("AK（Access Key ID）").fill(accessKeyId);
  await catalogSection.getByLabel("SK（Secret Access Key）").fill(secretAccessKey);
  await catalogSection.getByRole("button", { name: "加密保存" }).click();
  await expect(catalogSection).not.toContainText(secretAccessKey);
  const storageValues = await page.evaluate(() => [
    ...Object.values(localStorage),
    ...Object.values(sessionStorage),
  ]);
  expect(storageValues.join("\n")).not.toContain(accessKeyId);
  expect(storageValues.join("\n")).not.toContain(secretAccessKey);

  await catalogSection.getByRole("button", { name: "同步模型" }).click();
  await expect(catalogSection.getByRole("status"))
    .toContainText("同步完成：2 个官方模型，1 个接入点");
  await catalogSection.getByRole("button", { name: "查看发现模型" }).click();
  await expect(catalogSection.getByText("Seedream Official")).toBeVisible();
  await expect(catalogSection.getByText("Future Model")).toBeVisible();
  await expect(catalogSection).toContainText(
    "勾选后默认保持停用",
  );
  const futureModelCheckbox = catalogSection.getByRole("checkbox", {
    name: /Future Model/,
  });
  await expect(futureModelCheckbox).toHaveCSS("appearance", "none");
  await expect(futureModelCheckbox).toHaveCSS("width", "16px");
  await expect(futureModelCheckbox).toHaveCSS("height", "16px");
  await expect(futureModelCheckbox).toHaveCSS("border-radius", "4px");
  await expect(futureModelCheckbox).toHaveCSS(
    "background-color",
    "rgb(20, 20, 21)",
  );
  await futureModelCheckbox.check();
  await expect(futureModelCheckbox).toHaveCSS(
    "background-color",
    "rgb(236, 236, 238)",
  );
  for (const width of [902, 1135]) {
    await page.setViewportSize({ height: 917, width });
    const geometry = await catalogSection.evaluate((section) => {
      const list = section.querySelector<HTMLElement>(
        ".provider-catalog-model-list",
      )!;
      const listBox = list.getBoundingClientRect();
      const rows = Array.from(list.querySelectorAll<HTMLElement>(":scope > div"));
      const importButton = section.querySelector<HTMLElement>(
        ".provider-catalog-bulk-bar button",
      )!;
      return {
        importButtonFits:
          importButton.scrollWidth <= importButton.clientWidth + 1 &&
          getComputedStyle(importButton).whiteSpace === "nowrap",
        horizontalOverflow: list.scrollWidth - list.clientWidth,
        rowsContained: rows.every((row) => {
          const box = row.getBoundingClientRect();
          return box.left >= listBox.left - 0.5 && box.right <= listBox.right + 0.5;
        }),
      };
    });
    expect(geometry.importButtonFits).toBe(true);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.rowsContained).toBe(true);
  }
  const futureModelCapability = catalogSection.getByLabel("Future Model节点类型");
  await futureModelCapability.click();
  await futureModelCapability.locator("..")
    .locator('[role="option"][data-value="video"]')
    .click();
  await catalogSection.getByRole("button", {
    name: "添加到模型中心（1）",
  }).click();
  await expect(catalogSection.getByRole("status"))
    .toContainText("已添加 1 个模型到模型中心，当前保持停用");

  const credentialRequest = catalogRequests.find((entry) =>
    entry.path.endsWith("/credentials")
  );
  expect(credentialRequest).toMatchObject({
    body: { accessKeyId, projectName: "default", secretAccessKey },
    method: "PATCH",
  });
  const importRequest = catalogRequests.find((entry) =>
    entry.path.endsWith("/import")
  );
  expect(importRequest).toMatchObject({
    body: {
      models: [{ capability: "video", discoveryId: "foundation:future:1" }],
    },
    method: "POST",
  });
  expect(
    catalogRequests.filter((entry) => entry.path.endsWith("/sync")),
  ).toHaveLength(1);
  expect(generationRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
});
