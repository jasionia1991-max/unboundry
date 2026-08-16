import { expect, test } from "./safe-test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountCredentialKey,
  accountCredentialRevision,
  accountCredentialRow,
  accountCredentialStatusMap,
  deleteAccountCredential,
  saveAccountCredential,
  verifyAccountCredential,
} from "../server/accountCredentials";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import {
  importProviderCatalogDrafts,
  syncProviderCatalog,
} from "../server/providerCatalog";
import {
  getProviderProfile,
  providerConfigurationVersion,
  saveArkControlPlaneCredentials,
  saveProviderProfile,
  verifyProviderProfile,
} from "../server/providerProfiles";
import {
  deleteStorageProfile,
  listStorageProfiles,
  markStorageProfileVerified,
  saveStorageProfile,
  setStorageMediaRouting,
} from "../server/secureStorageProfiles";
import { knownModelParameterSchema } from "../types/modelParameters";

function seedProvider(
  store: ReturnType<typeof openAppDatabase>,
  profileId: string,
  driver = "openrouter",
) {
  const timestamp = new Date().toISOString();
  store
    .prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at
      )
      VALUES (?, ?, ?, 'enabled', ?, ?)
    `)
    .run(profileId, "测试平台", driver, timestamp, timestamp);
  store
    .prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency
      )
      VALUES (
        ?, '测试模型', ?, 'test-model', 'image', 'published', '{}', ?, ?,
        1000000, 'USD'
      )
    `)
    .run(
      `model-${profileId}`,
      profileId,
      timestamp,
      timestamp,
    );
}

function seedActiveUser(
  store: ReturnType<typeof openAppDatabase>,
  userId: string,
) {
  const timestamp = new Date().toISOString();
  store.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'test-only', 'user', 'active', ?, ?)
  `).run(userId, userId, userId, timestamp, timestamp);
}

function beginSyntheticAccountDeletion(
  store: ReturnType<typeof openAppDatabase>,
  userId: string,
) {
  const timestamp = new Date().toISOString();
  store.exec("BEGIN IMMEDIATE");
  try {
    store.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES (?, 'running', NULL, 0, ?, ?)
    `).run(userId, timestamp, timestamp);
    store.prepare(`
      UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?
    `).run(timestamp, userId);
    store.exec("COMMIT");
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

test("account credentials are encrypted, versioned and owner-isolated", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-unit-"));
  const store = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    for (const id of ["user-a", "user-b"]) {
      store
        .prepare(`
          INSERT INTO users (
            id, login_name, display_name, password_hash, role, status,
            created_at, updated_at
          )
          VALUES (?, ?, ?, 'test-only', 'user', 'active', ?, ?)
        `)
        .run(id, id, id, timestamp, timestamp);
    }
    seedProvider(store, "profile-1");

    const saved = await saveAccountCredential(
      store,
      "user-a",
      "profile-1",
      "sk-secret-a-1234",
    );
    expect(saved.mask).toBe("••••1234");
    expect(saved.credentialVersion).toBe(1);

    const row = accountCredentialRow(store, "user-a", "profile-1");
    expect(row).toBeDefined();
    expect(row!.encrypted_key).not.toContain("sk-secret-a-1234");
    expect(await accountCredentialKey(store, "user-a", "profile-1")).toBe(
      "sk-secret-a-1234",
    );
    expect(await accountCredentialKey(store, "user-b", "profile-1")).toBe(
      undefined,
    );

    const updated = await saveAccountCredential(
      store,
      "user-a",
      "profile-1",
      "sk-secret-a-5678",
    );
    expect(updated.credentialVersion).toBe(2);
    expect(await accountCredentialKey(store, "user-a", "profile-1")).toBe(
      "sk-secret-a-5678",
    );
    expect(
      accountCredentialStatusMap(store, "user-a").get("profile-1"),
    ).toEqual({
      credentialVersion: 2,
      keyStatus: "unchecked",
      updatedAt: expect.any(String),
    });
    expect(accountCredentialStatusMap(store, "user-b").size).toBe(0);

    await expect(
      deleteAccountCredential(store, "user-b", "profile-1"),
    ).resolves.toBe(false);
    await expect(
      deleteAccountCredential(store, "user-a", "profile-1"),
    ).resolves.toBe(true);
    expect(accountCredentialRevision(store, "user-a", "profile-1")).toBe(3);
    expect(await accountCredentialKey(store, "user-a", "profile-1")).toBe(
      undefined,
    );
    const readded = await saveAccountCredential(
      store,
      "user-a",
      "profile-1",
      "sk-secret-a-9012",
    );
    expect(readded.credentialVersion).toBe(4);
    expect(accountCredentialRevision(store, "user-a", "profile-1")).toBe(4);
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("account credential commits serialize with an account deletion intent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-delete-fence-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const store = openAppDatabase(directory);
  try {
    for (const userId of [
      "credential-save-first",
      "credential-delete-first",
      "credential-delete-during-verify",
    ]) {
      seedActiveUser(store, userId);
    }
    seedProvider(store, "credential-delete-fence-profile");

    await expect(saveAccountCredential(
      store,
      "credential-save-first",
      "credential-delete-fence-profile",
      "sk-save-before-delete-1111",
    )).resolves.toMatchObject({ credentialVersion: 1 });
    beginSyntheticAccountDeletion(store, "credential-save-first");
    const blockedSave = await saveAccountCredential(
      store,
      "credential-save-first",
      "credential-delete-fence-profile",
      "sk-save-after-delete-2222",
    ).catch((error: Error & { code?: string }) => error);
    expect(blockedSave).toMatchObject({ code: "ACCOUNT_DELETE_ACTIVE" });
    const blockedDelete = await deleteAccountCredential(
      store,
      "credential-save-first",
      "credential-delete-fence-profile",
    ).catch((error: Error & { code?: string }) => error);
    expect(blockedDelete).toMatchObject({ code: "ACCOUNT_DELETE_ACTIVE" });
    expect(accountCredentialRevision(
      store,
      "credential-save-first",
      "credential-delete-fence-profile",
    )).toBe(1);

    await saveAccountCredential(
      store,
      "credential-delete-first",
      "credential-delete-fence-profile",
      "sk-delete-before-intent-3333",
    );
    await expect(deleteAccountCredential(
      store,
      "credential-delete-first",
      "credential-delete-fence-profile",
    )).resolves.toBe(true);
    beginSyntheticAccountDeletion(store, "credential-delete-first");
    expect(accountCredentialRow(
      store,
      "credential-delete-first",
      "credential-delete-fence-profile",
    )).toBeUndefined();

    await saveAccountCredential(
      store,
      "credential-delete-during-verify",
      "credential-delete-fence-profile",
      "sk-verify-before-delete-4444",
    );
    let releaseProbe = () => {};
    let signalProbeStarted = () => {};
    const probeStarted = new Promise<void>((resolve) => {
      signalProbeStarted = resolve;
    });
    const probeReleased = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const verification = verifyAccountCredential(
      store,
      "credential-delete-during-verify",
      "credential-delete-fence-profile",
      async () => {
        signalProbeStarted();
        await probeReleased;
        return new Response(JSON.stringify({ data: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
    );
    await probeStarted;
    beginSyntheticAccountDeletion(store, "credential-delete-during-verify");
    releaseProbe();
    await expect(verification).rejects.toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(accountCredentialRow(
      store,
      "credential-delete-during-verify",
      "credential-delete-fence-profile",
    )).toMatchObject({ key_status: "unchecked" });

    let lateProbeCalls = 0;
    const rejectedBeforeProbe = await verifyAccountCredential(
      store,
      "credential-delete-during-verify",
      "credential-delete-fence-profile",
      async () => {
        lateProbeCalls += 1;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    ).catch((error: Error & { code?: string }) => error);
    expect(rejectedBeforeProbe).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(lateProbeCalls).toBe(0);
  } finally {
    store.close();
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("authenticated Provider commits serialize with actor account deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-provider-delete-fence-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof openAppDatabase> | undefined;
  try {
    openAppDatabase(directory).close();
    const profile = await saveProviderProfile({
      apiKey: "sk-provider-delete-fence-1111",
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Provider before actor mutation",
    });
    const arkProfile = await saveProviderProfile({
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Ark delete fence",
    });
    store = openAppDatabase(directory);
    seedActiveUser(store, "provider-save-actor");
    seedActiveUser(store, "provider-verify-actor");

    let committedMutationAudits = 0;
    await expect(saveProviderProfile({
      apiKey: "sk-provider-delete-fence-audit-failure",
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: "Must roll back with audit",
    }, profile.id, "provider-save-actor", () => {
      throw new Error("deterministic audit failure");
    })).rejects.toThrow("deterministic audit failure");
    expect((await getProviderProfile(profile.id))?.label).toBe(
      "Provider before actor mutation",
    );
    const savedBeforeDeletion = await saveProviderProfile({
      apiKey: "sk-provider-delete-fence-2222",
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: "Provider mutation committed first",
    }, profile.id, "provider-save-actor", (transactionStore, committed) => {
      expect(transactionStore.isTransaction).toBe(true);
      transactionStore.prepare(`
        INSERT INTO admin_audit_events (
          actor_user_id, action, target_user_id, details, created_at
        ) VALUES (?, 'provider_profile.update', NULL, ?, ?)
      `).run(
        "provider-save-actor",
        JSON.stringify({ profileId: committed.id }),
        new Date().toISOString(),
      );
      committedMutationAudits += 1;
    });
    expect(savedBeforeDeletion.label).toBe("Provider mutation committed first");
    expect(committedMutationAudits).toBe(1);
    expect(store.prepare(`
      SELECT action FROM admin_audit_events
      WHERE actor_user_id = 'provider-save-actor'
    `).get()).toEqual({ action: "provider_profile.update" });
    beginSyntheticAccountDeletion(store, "provider-save-actor");

    const blockedProfileSave = await saveProviderProfile({
      apiKey: "sk-provider-delete-fence-3333",
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: "Must not commit after deletion",
    }, profile.id, "provider-save-actor", () => {
      committedMutationAudits += 1;
    }).catch(
      (error: Error & { code?: string }) => error,
    );
    expect(blockedProfileSave).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect((await getProviderProfile(profile.id))?.label).toBe(
      "Provider mutation committed first",
    );
    expect(committedMutationAudits).toBe(1);

    const blockedArkSave = await saveArkControlPlaneCredentials(
      arkProfile.id,
      {
        accessKeyId: "test-access-key-1234",
        projectName: "default",
        secretAccessKey: "test-secret-key-1234",
      },
      "provider-save-actor",
      () => {
        committedMutationAudits += 1;
      },
    ).catch((error: Error & { code?: string }) => error);
    expect(blockedArkSave).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect((await getProviderProfile(arkProfile.id))?.arkControlPlane)
      .toBeUndefined();
    expect(committedMutationAudits).toBe(1);

    const statusBeforeAuditFailure = store.prepare(`
      SELECT key_checked_at, key_status, status
      FROM provider_profiles WHERE id = ?
    `).get(profile.id);
    await expect(verifyProviderProfile(
      profile.id,
      "provider-verify-actor",
      async () => new Response(JSON.stringify({ data: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
      "provider-verify-actor",
      () => {
        throw new Error("deterministic verification audit failure");
      },
    )).rejects.toThrow("deterministic verification audit failure");
    expect(store.prepare(`
      SELECT key_checked_at, key_status, status
      FROM provider_profiles WHERE id = ?
    `).get(profile.id)).toEqual(statusBeforeAuditFailure);

    let releaseProbe = () => {};
    let signalProbeStarted = () => {};
    const probeStarted = new Promise<void>((resolve) => {
      signalProbeStarted = resolve;
    });
    const probeReleased = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const statusBefore = store.prepare(`
      SELECT key_checked_at, key_status, status
      FROM provider_profiles WHERE id = ?
    `).get(profile.id);
    const lateVerification = verifyProviderProfile(
      profile.id,
      "provider-verify-actor",
      async () => {
        signalProbeStarted();
        await probeReleased;
        return new Response(JSON.stringify({ data: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
      "provider-verify-actor",
      () => {
        committedMutationAudits += 1;
      },
    );
    await probeStarted;
    beginSyntheticAccountDeletion(store, "provider-verify-actor");
    releaseProbe();
    await expect(lateVerification).rejects.toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(store.prepare(`
      SELECT key_checked_at, key_status, status
      FROM provider_profiles WHERE id = ?
    `).get(profile.id)).toEqual(statusBefore);
    expect(committedMutationAudits).toBe(1);

    let rejectedProbeCalls = 0;
    const rejectedBeforeProbe = await verifyProviderProfile(
      profile.id,
      "provider-verify-actor",
      async () => {
        rejectedProbeCalls += 1;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
      "provider-verify-actor",
    ).catch((error: Error & { code?: string }) => error);
    expect(rejectedBeforeProbe).toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(rejectedProbeCalls).toBe(0);
  } finally {
    store?.close();
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Provider catalog sync and import serialize with actor account deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-catalog-delete-fence-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof openAppDatabase> | undefined;
  const catalogFetcher = (providerModelId: string) => (async () =>
    new Response(JSON.stringify({
      data: [{
        architecture: { output_modalities: ["text"] },
        id: providerModelId,
        name: providerModelId,
      }],
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })) as typeof fetch;
  try {
    openAppDatabase(directory).close();
    const committedProfile = await saveProviderProfile({
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Catalog committed first",
    });
    const auditFailureProfile = await saveProviderProfile({
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Catalog audit rollback",
    });
    const lateProfile = await saveProviderProfile({
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Catalog deletion wins",
    });
    store = openAppDatabase(directory);
    for (const actorId of [
      "catalog-commit-actor",
      "catalog-audit-failure-actor",
      "catalog-late-actor",
    ]) {
      seedActiveUser(store, actorId);
    }
    await saveAccountCredential(
      store,
      "catalog-commit-actor",
      committedProfile.id,
      "sk-catalog-commit-1111",
    );
    await saveAccountCredential(
      store,
      "catalog-audit-failure-actor",
      auditFailureProfile.id,
      "sk-catalog-audit-failure-2222",
    );
    await saveAccountCredential(
      store,
      "catalog-late-actor",
      lateProfile.id,
      "sk-catalog-late-3333",
    );

    const committed = await syncProviderCatalog(
      committedProfile.id,
      "catalog-commit-actor",
      catalogFetcher("vendor/catalog-committed"),
    );
    expect(committed.catalog).toMatchObject({
      keyStatus: "valid",
      modelCount: 1,
    });
    expect(store.prepare(`
      SELECT action FROM admin_audit_events
      WHERE actor_user_id = ? AND action = 'provider_catalog.sync'
    `).get("catalog-commit-actor")).toEqual({
      action: "provider_catalog.sync",
    });

    beginSyntheticAccountDeletion(store, "catalog-commit-actor");
    const blockedImport = await importProviderCatalogDrafts(
      committedProfile.id,
      [{ discoveryId: "openrouter:vendor/catalog-committed" }],
      "catalog-commit-actor",
    ).catch((error: Error & { code?: string }) => error);
    expect(blockedImport).toMatchObject({ code: "ACCOUNT_DELETE_ACTIVE" });
    expect(store.prepare(`
      SELECT COUNT(*) AS count FROM model_profiles
      WHERE provider_profile_id = ?
    `).get(committedProfile.id)).toEqual({ count: 0 });

    const auditFailureSnapshot = store.prepare(`
      SELECT catalog_checked_at, catalog_key_status, catalog_model_count,
             catalog_models, catalog_synced_at
      FROM provider_profiles WHERE id = ?
    `).get(auditFailureProfile.id);
    store.exec(`
      CREATE TRIGGER m73_fail_provider_catalog_sync_audit
      BEFORE INSERT ON admin_audit_events
      WHEN NEW.action = 'provider_catalog.sync'
      BEGIN
        SELECT RAISE(ABORT, 'm73 deterministic catalog audit failure');
      END;
    `);
    await expect(syncProviderCatalog(
      auditFailureProfile.id,
      "catalog-audit-failure-actor",
      catalogFetcher("vendor/catalog-audit-failure"),
    )).rejects.toThrow("m73 deterministic catalog audit failure");
    expect(store.prepare(`
      SELECT catalog_checked_at, catalog_key_status, catalog_model_count,
             catalog_models, catalog_synced_at
      FROM provider_profiles WHERE id = ?
    `).get(auditFailureProfile.id)).toEqual(auditFailureSnapshot);
    expect(store.prepare(`
      SELECT COUNT(*) AS count FROM admin_audit_events
      WHERE actor_user_id = ? AND action = 'provider_catalog.sync'
    `).get("catalog-audit-failure-actor")).toEqual({ count: 0 });
    store.exec("DROP TRIGGER m73_fail_provider_catalog_sync_audit");

    let releaseCatalog = () => {};
    let signalCatalogStarted = () => {};
    const catalogStarted = new Promise<void>((resolve) => {
      signalCatalogStarted = resolve;
    });
    const catalogReleased = new Promise<void>((resolve) => {
      releaseCatalog = resolve;
    });
    const lateSync = syncProviderCatalog(
      lateProfile.id,
      "catalog-late-actor",
      (async () => {
        signalCatalogStarted();
        await catalogReleased;
        return new Response(JSON.stringify({
          data: [{
            architecture: { output_modalities: ["text"] },
            id: "vendor/catalog-late",
            name: "Late catalog",
          }],
        }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }) as typeof fetch,
    );
    await catalogStarted;
    beginSyntheticAccountDeletion(store, "catalog-late-actor");
    releaseCatalog();
    await expect(lateSync).rejects.toMatchObject({
      code: "ACCOUNT_DELETE_ACTIVE",
    });
    expect(store.prepare(`
      SELECT catalog_key_status, catalog_model_count, catalog_synced_at
      FROM provider_profiles WHERE id = ?
    `).get(lateProfile.id)).toEqual({
      catalog_key_status: "unchecked",
      catalog_model_count: 0,
      catalog_synced_at: null,
    });
    expect(store.prepare(`
      SELECT COUNT(*) AS count FROM admin_audit_events
      WHERE actor_user_id = ? AND action = 'provider_catalog.sync'
    `).get("catalog-late-actor")).toEqual({ count: 0 });
  } finally {
    store?.close();
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("storage document commits serialize audit and actor account deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-storage-delete-fence-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof openAppDatabase> | undefined;
  const input = (label: string) => ({
    accessKeyId: "test-storage-access-key",
    accessKeySecret: "test-storage-secret-key",
    bucket: "private-storage-bucket",
    endpoint: "https://oss-cn-shanghai.aliyuncs.com",
    label,
    region: "oss-cn-shanghai",
  });
  try {
    store = openAppDatabase(directory);
    seedActiveUser(store, "storage-commit-actor");
    seedActiveUser(store, "storage-verify-actor");
    const profile = await saveStorageProfile(input("Storage original"));
    const verificationProfile = await saveStorageProfile(
      input("Storage verification original"),
    );

    const beforeAuditFailure = await listStorageProfiles();
    await expect(saveStorageProfile(
      input("Must roll back with audit"),
      profile.id,
      "storage-commit-actor",
      () => {
        throw new Error("deterministic storage audit failure");
      },
    )).rejects.toThrow("deterministic storage audit failure");
    expect(await listStorageProfiles()).toEqual(beforeAuditFailure);

    await expect(markStorageProfileVerified(
      verificationProfile.id,
      "storage-verify-actor",
      () => {
        throw new Error("deterministic storage verification audit failure");
      },
    )).rejects.toThrow("deterministic storage verification audit failure");
    const rolledBackVerificationProfile = (await listStorageProfiles()).profiles.find(
      (candidate) => candidate.id === verificationProfile.id,
    );
    expect(rolledBackVerificationProfile).toMatchObject({ status: "draft" });
    expect(Object.hasOwn(
      rolledBackVerificationProfile!,
      "lastVerifiedAt",
    )).toBe(false);

    const testedRevision = (await listStorageProfiles()).profiles.find(
      (candidate) => candidate.id === verificationProfile.id,
    )!;
    await saveStorageProfile(
      input("Storage changed during verification"),
      verificationProfile.id,
    );
    let staleVerificationAudits = 0;
    await expect(markStorageProfileVerified(
      verificationProfile.id,
      "storage-verify-actor",
      () => {
        staleVerificationAudits += 1;
      },
      testedRevision,
    )).rejects.toThrow("Storage profile changed during verification");
    expect(staleVerificationAudits).toBe(0);
    expect((await listStorageProfiles()).profiles.find(
      (candidate) => candidate.id === verificationProfile.id,
    )).toMatchObject({
      label: "Storage changed during verification",
      status: "draft",
    });

    let committedAudits = 0;
    const committed = await saveStorageProfile(
      input("Storage committed first"),
      profile.id,
      "storage-commit-actor",
      (transactionStore, saved) => {
        expect(transactionStore.isTransaction).toBe(true);
        transactionStore.prepare(`
          INSERT INTO admin_audit_events (
            actor_user_id, action, target_user_id, details, created_at
          ) VALUES (?, 'update_storage_profile', NULL, ?, ?)
        `).run(
          "storage-commit-actor",
          JSON.stringify({ profileId: saved.id }),
          new Date().toISOString(),
        );
        committedAudits += 1;
      },
    );
    expect(committed.label).toBe("Storage committed first");
    expect(committedAudits).toBe(1);
    expect(store.prepare(`
      SELECT action FROM admin_audit_events
      WHERE actor_user_id = 'storage-commit-actor'
    `).get()).toEqual({ action: "update_storage_profile" });

    beginSyntheticAccountDeletion(store, "storage-commit-actor");
    for (const mutation of [
      () => saveStorageProfile(
        input("Must remain blocked"),
        profile.id,
        "storage-commit-actor",
        () => {
          committedAudits += 1;
        },
      ),
      () => markStorageProfileVerified(
        profile.id,
        "storage-commit-actor",
        () => {
          committedAudits += 1;
        },
      ),
      () => setStorageMediaRouting(
        false,
        "storage-commit-actor",
        () => {
          committedAudits += 1;
        },
      ),
      () => deleteStorageProfile(
        profile.id,
        "storage-commit-actor",
        () => {
          committedAudits += 1;
        },
      ),
    ]) {
      const blocked = await mutation().catch(
        (error: Error & { code?: string }) => error,
      );
      expect(blocked).toMatchObject({ code: "ACCOUNT_DELETE_ACTIVE" });
    }
    expect(committedAudits).toBe(1);
    expect((await listStorageProfiles()).profiles.find(
      (candidate) => candidate.id === profile.id,
    )).toMatchObject({ label: "Storage committed first", status: "draft" });
  } finally {
    store?.close();
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("account credential verification maps AUTH to invalid and success to valid", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-verify-"));
  const store = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    store
      .prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES ('user-a', 'user-a', 'A', 'test-only', 'user', 'active', ?, ?)
      `)
      .run(timestamp, timestamp);
    seedProvider(store, "profile-1");
    await saveAccountCredential(store, "user-a", "profile-1", "sk-valid-1234");

    const invalid = await verifyAccountCredential(
      store,
      "user-a",
      "profile-1",
      async () =>
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ).catch((error: Error) => error);
    expect(invalid).toBeInstanceOf(Error);
    expect(accountCredentialRow(store, "user-a", "profile-1")?.key_status).toBe(
      "invalid",
    );

    const verified = await verifyAccountCredential(
      store,
      "user-a",
      "profile-1",
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    expect(verified.status).toBe("verified");
    expect(verified.keyStatus).toBe("valid");
    expect(accountCredentialRow(store, "user-a", "profile-1")?.key_status).toBe(
      "valid",
    );
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("credential epochs serialize concurrent mutation, delete, and re-add", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-epoch-"));
  const seed = openAppDatabase(directory);
  const first = openAppDatabase(directory);
  const second = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    seed.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('epoch-user', 'epoch-user', 'Epoch', 'test-only', 'user',
        'active', ?, ?)
    `).run(timestamp, timestamp);
    seedProvider(seed, "epoch-profile");

    const saved = await Promise.all([
      saveAccountCredential(
        first,
        "epoch-user",
        "epoch-profile",
        "sk-concurrent-first-1111",
      ),
      saveAccountCredential(
        second,
        "epoch-user",
        "epoch-profile",
        "sk-concurrent-second-2222",
      ),
    ]);
    expect(saved.map(({ credentialVersion }) => credentialVersion).sort())
      .toEqual([1, 2]);
    expect(accountCredentialRevision(seed, "epoch-user", "epoch-profile"))
      .toBe(2);
    expect(accountCredentialRow(seed, "epoch-user", "epoch-profile")
      ?.credential_version).toBe(2);

    const [deleted] = await Promise.all([
      deleteAccountCredential(first, "epoch-user", "epoch-profile"),
      saveAccountCredential(
        second,
        "epoch-user",
        "epoch-profile",
        "sk-concurrent-third-3333",
      ),
    ]);
    expect(deleted).toBe(true);
    expect(accountCredentialRevision(seed, "epoch-user", "epoch-profile"))
      .toBe(4);

    const readded = await saveAccountCredential(
      seed,
      "epoch-user",
      "epoch-profile",
      "sk-readded-final-5555",
    );
    expect(readded.credentialVersion).toBe(5);
    expect(accountCredentialRevision(seed, "epoch-user", "epoch-profile"))
      .toBe(5);
  } finally {
    second.close();
    first.close();
    seed.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("stale credential verification cannot overwrite a rotated revision", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-stale-verify-"));
  const store = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('verify-user', 'verify-user', 'Verify', 'test-only', 'user',
        'active', ?, ?)
    `).run(timestamp, timestamp);
    seedProvider(store, "verify-profile");
    await saveAccountCredential(
      store,
      "verify-user",
      "verify-profile",
      "sk-before-rotation-1111",
    );

    let releaseProbe!: () => void;
    let signalProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      signalProbeStarted = resolve;
    });
    const probeReleased = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const staleVerification = verifyAccountCredential(
      store,
      "verify-user",
      "verify-profile",
      async () => {
        signalProbeStarted();
        await probeReleased;
        return new Response(JSON.stringify({ data: [] }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      },
    );
    await probeStarted;
    await saveAccountCredential(
      store,
      "verify-user",
      "verify-profile",
      "sk-after-rotation-2222",
    );
    releaseProbe();
    await expect(staleVerification).rejects.toThrow(
      "平台密钥在验证期间已变化",
    );

    expect(accountCredentialRow(store, "verify-user", "verify-profile"))
      .toMatchObject({ credential_version: 2, key_status: "unchecked" });
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("credential verification and the paid boundary serialize fail-closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-verify-boundary-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof openAppDatabase> | undefined;
  let taskStore: ReturnType<typeof createGenerationTaskStore> | undefined;
  try {
    openAppDatabase(directory).close();
    const profile = await saveProviderProfile({
      apiKey: "sk-profile-verification-1111",
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Credential verification boundary",
    });
    store = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('verify-boundary-user', 'verify-boundary-user', 'Verify',
        'test-only', 'user', 'active', ?, ?)
    `).run(timestamp, timestamp);
    store.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency, provider_protocol
      ) VALUES (
        'verify-boundary-model', 'Verify boundary model', ?,
        'openai/gpt-image-2', 'image', 'published', '{}', ?, ?,
        1000000, 'USD', 'native'
      )
    `).run(profile.id, timestamp, timestamp);
    store.prepare(`
      INSERT INTO node_model_bindings (
        node_type, model_id, enabled, is_default, sort_order,
        created_at, updated_at
      ) VALUES ('image', 'verify-boundary-model', 1, 1, 1, ?, ?)
    `).run(timestamp, timestamp);
    store.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?
      WHERE id = ?
    `).run(timestamp, profile.id);
    store.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 1, emergency_stop = 0,
        per_user_concurrency = 5, image_concurrency = 5,
        requests_per_minute = 120, updated_at = ?
      WHERE id = 1
    `).run(timestamp);
    const credential = await saveAccountCredential(
      store,
      "verify-boundary-user",
      profile.id,
      "sk-account-verification-2222",
    );
    taskStore = createGenerationTaskStore(directory);
    const task = taskStore.admitOrGet({
      canvasId: "verify-boundary-canvas",
      credentialRevision: credential.credentialVersion,
      idempotencyKey: "verify-boundary-idempotency-0001",
      kind: "image",
      model: "verify-boundary-model",
      modelConfiguration: {
        credentialVersion: credential.credentialVersion,
        modelId: "verify-boundary-model",
        parameterSchema: knownModelParameterSchema({
          capability: "image",
          providerDriver: "openrouter",
          providerModelId: "openai/gpt-image-2",
        }),
        providerConfigurationVersion: providerConfigurationVersion(profile),
        providerDriver: "openrouter",
        providerModelId: "openai/gpt-image-2",
        providerProfileId: profile.id,
        providerProtocol: "native",
      },
      nodeId: "verify-boundary-node",
      ownerId: "verify-boundary-user",
      parameters: { count: 1, size: "1k" },
      prompt: "verification status must win before the paid boundary",
      providerModelId: "openai/gpt-image-2",
      providerProfileId: profile.id,
    }).task;
    taskStore.transition(task.id, "running");

    await expect(verifyAccountCredential(
      store,
      "verify-boundary-user",
      profile.id,
      async () => new Response(JSON.stringify({ error: "unauthorized" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      }),
    )).rejects.toThrow("API Key已失效");
    expect(accountCredentialRow(
      store,
      "verify-boundary-user",
      profile.id,
    )?.key_status).toBe("invalid");
    const statusWon = (() => {
      try {
        taskStore!.recordProviderAttempt(task.id);
      } catch (error) {
        return error as Error & { code?: string };
      }
    })();
    expect(statusWon).toMatchObject({ code: "ACCOUNT_CREDENTIAL_INVALID" });
    expect(taskStore.getProviderAttemptForTask(task.id)).toBeUndefined();

    store.prepare(`
      UPDATE account_provider_credentials
      SET key_status = 'valid', key_checked_at = ?
      WHERE account_id = 'verify-boundary-user' AND provider_profile_id = ?
    `).run(new Date().toISOString(), profile.id);
    expect(taskStore.recordProviderAttempt(task.id)).toMatchObject({
      executionAttempt: 1,
    });
    const boundaryWon = await verifyAccountCredential(
      store,
      "verify-boundary-user",
      profile.id,
      async () => new Response(JSON.stringify({ error: "unauthorized" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      }),
    ).catch((error: Error & { code?: string }) => error);
    expect(boundaryWon).toMatchObject({ code: "ACCOUNT_CREDENTIAL_IN_USE" });
    expect(accountCredentialRow(
      store,
      "verify-boundary-user",
      profile.id,
    )?.key_status).toBe("valid");
    expect(taskStore.getProviderAttemptForTask(task.id)).toMatchObject({
      outcome: "boundary-claimed",
    });

    const providerTaskId = "verify-boundary-accepted-remote-task";
    taskStore.setProviderTaskId(task.id, providerTaskId);
    const failed = taskStore.transition(task.id, "failed", {
      code: "AUTH",
      message: "poll authorization failed after Provider acceptance",
    })!;
    const blockedMutation = await saveAccountCredential(
      store,
      "verify-boundary-user",
      profile.id,
      "sk-mutation-must-wait-3333",
    ).catch((error: Error & { code?: string }) => error);
    expect(blockedMutation).toMatchObject({
      code: "ACCOUNT_CREDENTIAL_IN_USE",
    });
    expect(accountCredentialRevision(
      store,
      "verify-boundary-user",
      profile.id,
    )).toBe(1);

    expect(taskStore.abandonAcceptedProviderTask({
      expectedAttempt: failed.attempt,
      expectedUpdatedAt: failed.updatedAt,
      taskId: task.id,
    })).toMatchObject({
      errorCode: "USER_ABANDONED",
      providerTaskId,
      state: "cancelled",
    });
    expect(taskStore.getProviderAttemptForTask(task.id)).toMatchObject({
      failureCode: "AUTH",
      outcome: "accepted",
      providerTaskId,
    });
    await expect(saveAccountCredential(
      store,
      "verify-boundary-user",
      profile.id,
      "sk-safe-after-abandon-4444",
    )).resolves.toMatchObject({ credentialVersion: 2 });
  } finally {
    taskStore?.close();
    store?.close();
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("credential mutation cannot strand work that crossed the paid boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-paid-work-"));
  const store = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('paid-user', 'paid-user', 'Paid', 'test-only', 'user',
        'active', ?, ?)
    `).run(timestamp, timestamp);
    seedProvider(store, "paid-profile");
    await saveAccountCredential(
      store,
      "paid-user",
      "paid-profile",
      "sk-paid-boundary-1111",
    );
    store.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt,
        created_at, updated_at, owner_id, provider_profile_id,
        provider_model_id, model_configuration, credential_revision
      ) VALUES (
        'paid-credential-task', 'paid-canvas', 'paid-node', 'image',
        'paid work', 'model-paid-profile', '{}', 'paid-credential-key-0001',
        'intent-v2:fixture', 'running', 1, ?, ?, 'paid-user',
        'paid-profile', 'test-model', '{"credentialVersion":1}', 1
      )
    `).run(timestamp, timestamp);
    store.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, owner_id, provider_profile_id,
        provider_model_id, kind, evidence, credential_revision, outcome,
        created_at
      ) VALUES (
        'paid-credential-task', 1, 'paid-user', 'paid-profile', 'test-model',
        'image', 'provider-boundary', 1, 'boundary-claimed', ?
      )
    `).run(timestamp);

    await expect(saveAccountCredential(
      store,
      "paid-user",
      "paid-profile",
      "sk-must-not-rotate-2222",
    )).rejects.toThrow("仍有已提交到模型平台的任务");
    await expect(deleteAccountCredential(
      store,
      "paid-user",
      "paid-profile",
    )).rejects.toThrow("仍有已提交到模型平台的任务");
    expect(accountCredentialRevision(store, "paid-user", "paid-profile"))
      .toBe(1);

    store.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = 'provider-failed', failure_code = 'PROVIDER_FAILED',
        finished_at = ?
      WHERE task_id = 'paid-credential-task' AND execution_attempt = 1
    `).run(new Date().toISOString());
    store.prepare(`
      UPDATE generation_tasks
      SET state = 'failed', error_code = 'PROVIDER_FAILED',
        error_message = 'terminal Provider failure'
      WHERE id = 'paid-credential-task'
    `).run();
    await expect(saveAccountCredential(
      store,
      "paid-user",
      "paid-profile",
      "sk-safe-after-terminal-3333",
    )).resolves.toMatchObject({ credentialVersion: 2 });
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Provider profile mutation and verification cannot strand paid continuation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-provider-paid-work-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  let store: ReturnType<typeof openAppDatabase> | undefined;
  try {
    openAppDatabase(directory).close();
    const profile = await saveProviderProfile({
      apiKey: "sk-provider-paid-work-1111",
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Paid profile",
    });
    store = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('profile-user', 'profile-user', 'Profile', 'test-only', 'user',
        'active', ?, ?)
    `).run(timestamp, timestamp);
    store.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, created_at, updated_at,
        max_cost_microunits, cost_currency
      ) VALUES (
        'profile-paid-model', 'Paid model', ?, 'remote-paid-model', 'image',
        'published', '{}', ?, ?, 1000000, 'USD'
      )
    `).run(profile.id, timestamp, timestamp);
    store.prepare(`
      UPDATE provider_profiles
      SET status = 'enabled', key_status = 'valid', key_checked_at = ?
      WHERE id = ?
    `).run(timestamp, profile.id);
    store.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt,
        created_at, updated_at, owner_id, provider_profile_id,
        provider_model_id, model_configuration, credential_revision
      ) VALUES (
        'profile-paid-task', 'profile-canvas', 'profile-node', 'image',
        'paid work', 'profile-paid-model', '{}', 'profile-paid-key-0001',
        'intent-v2:profile-fixture', 'running', 1, ?, ?, 'profile-user',
        ?, 'remote-paid-model', '{"credentialVersion":1}', 1
      )
    `).run(timestamp, timestamp, profile.id);
    store.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, owner_id, provider_profile_id,
        provider_model_id, kind, evidence, credential_revision, outcome,
        created_at
      ) VALUES (
        'profile-paid-task', 1, 'profile-user', ?, 'remote-paid-model',
        'image', 'provider-boundary', 1, 'boundary-claimed', ?
      )
    `).run(profile.id, timestamp);

    const blockedBoundary = await saveProviderProfile({
      apiKey: "sk-provider-paid-work-2222",
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: "Must remain unchanged",
    }, profile.id).catch((error: Error & { code?: string }) => error);
    expect(blockedBoundary).toMatchObject({ code: "PROVIDER_PROFILE_IN_USE" });
    expect((await getProviderProfile(profile.id))?.label).toBe("Paid profile");

    const blockedVerification = await verifyProviderProfile(
      profile.id,
      async () => new Response(JSON.stringify({ error: "unauthorized" }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      }),
    ).catch((error: Error & { code?: string }) => error);
    expect(blockedVerification).toMatchObject({
      code: "PROVIDER_PROFILE_IN_USE",
    });
    expect(store.prepare(`
      SELECT key_status, status FROM provider_profiles WHERE id = ?
    `).get(profile.id)).toEqual({ key_status: "valid", status: "enabled" });

    store.prepare(`
      UPDATE generation_provider_attempts
      SET outcome = 'accepted', provider_task_id = 'remote-profile-task'
      WHERE task_id = 'profile-paid-task' AND execution_attempt = 1
    `).run();
    store.prepare(`
      UPDATE generation_tasks
      SET provider_task_id = 'remote-profile-task', state = 'failed'
      WHERE id = 'profile-paid-task'
    `).run();
    const blockedAccepted = await saveProviderProfile({
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: "Accepted result still needs this profile",
    }, profile.id).catch((error: Error & { code?: string }) => error);
    expect(blockedAccepted).toMatchObject({ code: "PROVIDER_PROFILE_IN_USE" });

    const generationStore = createGenerationTaskStore(directory);
    try {
      const failed = generationStore.get("profile-paid-task")!;
      expect(generationStore.abandonAcceptedProviderTask({
        expectedAttempt: failed.attempt,
        expectedUpdatedAt: failed.updatedAt,
        taskId: failed.id,
      })).toMatchObject({
        errorCode: "USER_ABANDONED",
        providerTaskId: "remote-profile-task",
        state: "cancelled",
      });
      expect(generationStore.getProviderAttemptForTask(failed.id))
        .toMatchObject({
          outcome: "accepted",
          providerTaskId: "remote-profile-task",
        });
    } finally {
      generationStore.close();
    }
    await expect(saveProviderProfile({
      baseUrl: profile.baseUrl,
      driver: profile.driver,
      label: "Safe after explicit abandon",
    }, profile.id)).resolves.toMatchObject({
      label: "Safe after explicit abandon",
    });
  } finally {
    store?.close();
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("deleting a credential does not leave an epoch that pins its Provider profile", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-credential-epoch-fk-"));
  const store = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('cascade-user', 'cascade-user', 'Cascade', 'test-only', 'user',
        'active', ?, ?)
    `).run(timestamp, timestamp);
    seedProvider(store, "cascade-profile");
    await saveAccountCredential(
      store,
      "cascade-user",
      "cascade-profile",
      "sk-cascade-profile-1111",
    );
    await deleteAccountCredential(
      store,
      "cascade-user",
      "cascade-profile",
    );
    expect(accountCredentialRevision(store, "cascade-user", "cascade-profile"))
      .toBe(2);

    store.prepare("DELETE FROM model_profiles WHERE id = ?")
      .run("model-cascade-profile");
    expect(store.prepare("DELETE FROM provider_profiles WHERE id = ?")
      .run("cascade-profile").changes).toBe(1);
    expect(accountCredentialRevision(store, "cascade-user", "cascade-profile"))
      .toBe(0);
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("account credential API lists, saves, masks and deletes for the current account", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const createdProfile = await request.post("/api/admin/providers", {
    data: {
      apiKey: "sk-admin-secret-1234",
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "测试平台",
    },
  });
  expect(createdProfile.status()).toBe(201);
  const profile = (await createdProfile.json()) as { profile: { id: string } };
  const profileId = profile.profile.id;
  const store = openAppDatabase(dataDirectory);
  try {
    const timestamp = new Date().toISOString();
    store
      .prepare(`
        INSERT INTO model_profiles (
          id, display_name, provider_profile_id, provider_model_id,
          capability, status, default_parameters, created_at, updated_at,
          max_cost_microunits, cost_currency
        )
        VALUES (
          'model-api-1', '测试模型', ?, 'test-model', 'image', 'published',
          '{}', ?, ?, 1000000, 'USD'
        )
      `)
      .run(profileId, timestamp, timestamp);
  } finally {
    store.close();
  }

  const before = await request.get("/api/account-credentials");
  expect(before.ok()).toBeTruthy();
  const beforeBody = (await before.json()) as {
    items: Array<{
      apiKeyMask?: string;
      credentialVersion: number;
      keyStatus: string;
      profileId: string;
    }>;
  };
  const item = beforeBody.items.find(
    (candidate) => candidate.profileId === profileId,
  );
  expect(item).toMatchObject({
    credentialVersion: 0,
    keyStatus: "unchecked",
  });
  expect(item!.apiKeyMask).toBeUndefined();

  const saved = await request.put(`/api/account-credentials/${profileId}`, {
    data: { apiKey: "sk-api-secret-9012" },
  });
  expect(saved.status()).toBe(200);
  const savedBody = (await saved.json()) as {
    credentialVersion: number;
    mask: string;
  };
  expect(savedBody.mask).toBe("••••9012");
  expect(savedBody.credentialVersion).toBe(1);

  const after = await request.get("/api/account-credentials");
  const afterBody = (await after.json()) as {
    items: Array<{
      apiKeyMask?: string;
      credentialVersion: number;
      keyStatus: string;
      profileId: string;
    }>;
  };
  const savedItem = afterBody.items.find(
    (candidate) => candidate.profileId === profileId,
  );
  expect(savedItem).toMatchObject({
    apiKeyMask: "••••9012",
    credentialVersion: 1,
    keyStatus: "unchecked",
  });
  expect(JSON.stringify(afterBody)).not.toContain("sk-api-secret-9012");

  const replaced = await request.put(`/api/account-credentials/${profileId}`, {
    data: { apiKey: "sk-api-secret-3456" },
  });
  expect(((await replaced.json()) as { credentialVersion: number }).credentialVersion).toBe(2);

  const removed = await request.delete(`/api/account-credentials/${profileId}`);
  expect(removed.status()).toBe(200);
  const missing = await request.delete(`/api/account-credentials/${profileId}`);
  expect(missing.status()).toBe(404);
});

test("account credential API rejects invalid keys and unknown connections", async ({
  request,
}) => {
  const invalid = await request.put(
    "/api/account-credentials/00000000-0000-4000-8000-000000000000",
    { data: { apiKey: "short" } },
  );
  expect(invalid.status()).toBe(400);

  const unknown = await request.put(
    "/api/account-credentials/00000000-0000-4000-8000-000000000000",
    { data: { apiKey: "sk-valid-key-12345" } },
  );
  expect(unknown.status()).toBe(400);
});

test("my connections page lists, updates and deletes keys; admin page has no key field", async ({
  page,
  request,
}) => {
  const createdProfile = await request.post("/api/admin/providers", {
    data: {
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "连接页平台",
    },
  });
  expect(createdProfile.status()).toBe(201);
  const profile = (await createdProfile.json()) as { profile: { id: string } };
  const profileId = profile.profile.id;
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const store = openAppDatabase(dataDirectory);
  try {
    const timestamp = new Date().toISOString();
    store
      .prepare(`
        INSERT INTO model_profiles (
          id, display_name, provider_profile_id, provider_model_id,
          capability, status, default_parameters, created_at, updated_at,
          max_cost_microunits, cost_currency
        )
        VALUES (
          'model-connections-ui', '连接页模型', ?, 'test-model', 'image',
          'published', '{}', ?, ?, 1000000, 'USD'
        )
      `)
      .run(profileId, timestamp, timestamp);
  } finally {
    store.close();
  }
  const saved = await request.put(
    `/api/account-credentials/${profileId}`,
    { data: { apiKey: "sk-connections-ui-1111" } },
  );
  expect(saved.status()).toBe(200);

  await page.goto("/connections");
  await expect(page.getByTestId("connections-page")).toBeVisible();
  const row = page.getByTestId(`connection-row-${profileId}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("连接页平台");
  await expect(row).toContainText("••••1111");
  await expect(row.getByLabel("连接页平台 的 API Key")).toHaveValue("");

  await row
    .getByLabel("连接页平台 的 API Key")
    .fill("sk-connections-ui-2222");
  await row.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已加密保存")).toBeVisible();
  await expect(row).toContainText("••••2222");

  await row.getByRole("button", { name: "删除" }).click();
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("••••");
  await expect(row.getByRole("button", { name: "删除" })).toBeDisabled();

  await page.goto("/admin/providers");
  await expect(page.getByTestId("admin-providers-page")).toBeVisible();
  await expect(page.getByLabel("API Key")).toHaveCount(0);
});

test("credential, Provider, catalog, and storage HTTP mutations map deletion fences to 409", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const providerResponse = await request.post("/api/admin/providers", {
    data: {
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Deletion fence Provider",
    },
  });
  expect(providerResponse.status()).toBe(201);
  const providerId = (
    (await providerResponse.json()) as { profile: { id: string } }
  ).profile.id;
  const arkResponse = await request.post("/api/admin/providers", {
    data: {
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Deletion fence Ark",
    },
  });
  expect(arkResponse.status()).toBe(201);
  const arkProfileId = (
    (await arkResponse.json()) as { profile: { id: string } }
  ).profile.id;
  const savedCredential = await request.put(
    `/api/account-credentials/${providerId}`,
    { data: { apiKey: "sk-http-delete-fence-1111" } },
  );
  expect(savedCredential.status()).toBe(200);
  const storageResponse = await request.post("/api/admin/storage/profiles", {
    data: {
      accessKeyId: "test-http-storage-access-key",
      accessKeySecret: "test-http-storage-secret-key",
      bucket: "private-http-storage-bucket",
      endpoint: "https://oss-cn-shanghai.aliyuncs.com",
      label: "HTTP deletion fence storage",
      region: "oss-cn-shanghai",
    },
  });
  expect(storageResponse.status()).toBe(201);
  const storageProfileId = (
    (await storageResponse.json()) as { profile: { id: string } }
  ).profile.id;

  const store = openAppDatabase(dataDirectory);
  try {
    const catalogDiscoveryId = "openrouter:vendor/http-delete-fence";
    const catalogTimestamp = new Date().toISOString();
    store.prepare(`
      UPDATE provider_profiles
      SET catalog_key_status = 'valid', catalog_checked_at = ?,
          catalog_synced_at = ?, catalog_last_error_code = NULL,
          catalog_models = ?, catalog_model_count = 1
      WHERE id = ?
    `).run(
      catalogTimestamp,
      catalogTimestamp,
      JSON.stringify([{
        capability: "text",
        discoveryId: catalogDiscoveryId,
        displayName: "HTTP delete fence",
        providerModelId: "vendor/http-delete-fence",
        source: "openrouter-account-catalog",
        status: "available",
      }]),
      providerId,
    );
    const auditCountBefore = Number((store.prepare(`
      SELECT COUNT(*) AS count FROM admin_audit_events
    `).get() as { count: number }).count);
    beginSyntheticAccountDeletion(store, "__test__");

    const assertConflict = async (
      response: Awaited<ReturnType<typeof request.put>>,
    ) => {
      expect(response.status()).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "ACCOUNT_DELETE_ACTIVE",
      });
    };
    await assertConflict(await request.put(
      `/api/account-credentials/${providerId}`,
      { data: { apiKey: "sk-http-delete-fence-2222" } },
    ));
    await assertConflict(await request.post(
      `/api/account-credentials/${providerId}/verify`,
    ));
    await assertConflict(await request.delete(
      `/api/account-credentials/${providerId}`,
    ));
    await assertConflict(await request.patch(
      `/api/admin/providers/${providerId}`,
      {
        data: {
          baseUrl: "https://openrouter.ai/api/v1",
          driver: "openrouter",
          label: "Must remain blocked",
        },
      },
    ));
    await assertConflict(await request.post(
      `/api/admin/providers/${providerId}/test`,
    ));
    await assertConflict(await request.patch(
      `/api/admin/provider-catalog/${arkProfileId}/credentials`,
      {
        data: {
          accessKeyId: "test-access-key-1234",
          projectName: "default",
          secretAccessKey: "test-secret-key-1234",
        },
      },
    ));
    await assertConflict(await request.post(
      `/api/admin/provider-catalog/${providerId}/sync`,
    ));
    await assertConflict(await request.post(
      `/api/admin/provider-catalog/${providerId}/import`,
      { data: { models: [{ discoveryId: catalogDiscoveryId }] } },
    ));
    await assertConflict(await request.post("/api/admin/storage/profiles", {
      data: {
        accessKeyId: "test-http-storage-blocked-key",
        accessKeySecret: "test-http-storage-blocked-secret",
        bucket: "private-http-storage-blocked",
        endpoint: "https://oss-cn-shanghai.aliyuncs.com",
        label: "Must remain blocked",
        region: "oss-cn-shanghai",
      },
    }));
    await assertConflict(await request.patch(
      `/api/admin/storage/profiles/${storageProfileId}`,
      {
        data: {
          bucket: "private-http-storage-bucket",
          endpoint: "https://oss-cn-shanghai.aliyuncs.com",
          label: "Must remain blocked",
          region: "oss-cn-shanghai",
        },
      },
    ));
    await assertConflict(await request.delete(
      `/api/admin/storage/profiles/${storageProfileId}`,
    ));
    await assertConflict(await request.post(
      "/api/admin/storage/media-routing",
      { data: { enabled: false } },
    ));
    await assertConflict(await request.post(
      `/api/admin/storage/profiles/${storageProfileId}/activate`,
    ));
    await assertConflict(await request.post(
      `/api/admin/storage/profiles/${storageProfileId}/test`,
    ));

    expect(accountCredentialRevision(store, "__test__", providerId)).toBe(1);
    expect(store.prepare(`
      SELECT COUNT(*) AS count FROM model_profiles
      WHERE provider_profile_id = ?
    `).get(providerId)).toEqual({ count: 0 });
    const storageState = await request.get("/api/admin/storage");
    expect(storageState.status()).toBe(200);
    expect(((await storageState.json()) as {
      oss: { profiles: unknown[] };
    }).oss.profiles).toEqual([
      expect.objectContaining({
        id: storageProfileId,
        label: "HTTP deletion fence storage",
        status: "draft",
      }),
    ]);
    expect(Number((store.prepare(`
      SELECT COUNT(*) AS count FROM admin_audit_events
    `).get() as { count: number }).count)).toBe(auditCountBefore);
  } finally {
    if (store.isTransaction) store.exec("ROLLBACK");
    store.prepare("DELETE FROM account_delete_intents WHERE owner_id = ?")
      .run("__test__");
    store.prepare(`
      UPDATE users SET status = 'active', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), "__test__");
    store.close();
  }
});
