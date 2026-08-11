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
  getProviderProfile,
  providerConfigurationVersion,
  saveProviderProfile,
  verifyProviderProfile,
} from "../server/providerProfiles";
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
