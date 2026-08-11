import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import {
  accountCredentialKey,
  saveAccountCredential,
} from "../server/accountCredentials";
import { openAppDatabase } from "../server/database";
import {
  createGenerationTaskStore,
  generationProviderAttemptCounts,
} from "../server/generationTaskStore";
import { executeTextTaskWithDependencies } from "../server/generationTasks";
import { providerMediaUrlForOwner } from "../server/providerMedia";
import {
  getProviderProfile,
  listProviderProfiles,
  migrateLegacyProviderKeysIfNeeded,
  saveArkControlPlaneCredentials,
  saveProviderProfile,
} from "../server/providerProfiles";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");

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
  throw new Error("Account credential isolation server did not start");
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

test("legacy global keys migrate only to active administrators and leave the document key-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-key-migration-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const store = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    for (const [id, role] of [
      ["admin-1", "admin"],
      ["admin-2", "admin"],
      ["user-1", "user"],
    ] as const) {
      store
        .prepare(`
          INSERT INTO users (
            id, login_name, display_name, password_hash, role, status,
            created_at, updated_at
          )
          VALUES (?, ?, ?, 'test-only', ?, 'active', ?, ?)
        `)
        .run(id, id, id, role, timestamp, timestamp);
    }
    store.close();

    const secret = `sk-legacy-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey: secret,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Legacy OpenRouter",
    });
    expect((await getProviderProfile(profile.id))?.apiKey).toBe(secret);
    const manualStore = openAppDatabase(directory);
    await saveAccountCredential(
      manualStore,
      "admin-1",
      profile.id,
      "sk-manual-replacement-9999",
    );
    manualStore.close();
    const arkSecret = `ark-key-${randomUUID()}`;
    const arkProfile = await saveProviderProfile({
      apiKey: arkSecret,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Legacy Ark",
    });
    await saveArkControlPlaneCredentials(arkProfile.id, {
      accessKeyId: "AKLT-legacy-control-plane",
      projectName: "default",
      secretAccessKey: "legacy-control-plane-secret",
    });
    expect((await getProviderProfile(arkProfile.id))?.apiKey).toBe(arkSecret);
    expect(
      (await getProviderProfile(arkProfile.id))?.arkControlPlane?.accessKeyId,
    ).toBe("AKLT-legacy-control-plane");

    await migrateLegacyProviderKeysIfNeeded();
    await migrateLegacyProviderKeysIfNeeded();

    const document = await listProviderProfiles();
    expect(document.profiles.find((item) => item.id === profile.id)?.apiKey)
      .toBeUndefined();
    const migratedArk = document.profiles.find(
      (item) => item.id === arkProfile.id,
    );
    expect(migratedArk?.apiKey).toBeUndefined();
    expect(migratedArk?.arkControlPlane?.accessKeyId).toBe(
      "AKLT-legacy-control-plane",
    );
    const migratedStore = openAppDatabase(directory);
    try {
      expect(
        await accountCredentialKey(migratedStore, "admin-1", profile.id),
      ).toBe("sk-manual-replacement-9999");
      expect(
        await accountCredentialKey(migratedStore, "admin-2", profile.id),
      ).toBe(secret);
      expect(
        await accountCredentialKey(migratedStore, "user-1", profile.id),
      ).toBeUndefined();
      expect(
        await accountCredentialKey(migratedStore, "admin-1", arkProfile.id),
      ).toBe(arkSecret);
      expect(
        await accountCredentialKey(migratedStore, "user-1", arkProfile.id),
      ).toBeUndefined();
    } finally {
      migratedStore.close();
    }
  } finally {
    delete process.env.UNBOUNDRY_DATA_DIR;
    if (previous !== undefined) process.env.UNBOUNDRY_DATA_DIR = previous;
    await rm(directory, { force: true, recursive: true });
  }
});

test("a changed account credential version fails a queued task before any provider call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-credential-version-"));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const store = openAppDatabase(directory);
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
    store.close();

    const profile = await saveProviderProfile({
      apiKey: "sk-first-key-1234",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "Versioned Ark",
    });
    const credentialStore = openAppDatabase(directory);
    await saveAccountCredential(
      credentialStore,
      "user-a",
      profile.id,
      "sk-second-key-5678",
    );
    const version = credentialStore
      .prepare(`
        SELECT credential_version
        FROM account_provider_credentials
        WHERE account_id = 'user-a' AND provider_profile_id = ?
      `)
      .get(profile.id) as { credential_version: number };
    credentialStore.close();
    expect(Number(version.credential_version)).toBe(1);

    // Simulate a task submitted while the account used an older snapshot.
    const taskStore = createGenerationTaskStore(directory);
    const created = taskStore.create({
      canvasId: "default",
      costCurrency: "CNY",
      estimatedCostMicrounits: 100_000,
      idempotencyKey: "stale-credential-version",
      kind: "text",
      model: "model-versioned-ark",
      modelConfiguration: {
        credentialVersion: 99,
        providerConfigurationVersion: 1,
        providerDriver: "volcengine-ark",
        providerModelId: "doubao-seed-2-0-lite-260428",
        providerProfileId: profile.id,
      },
      nodeId: "node-versioned",
      ownerId: "user-a",
      parameters: { inputs: [], outputCount: 1, responseFormat: "text" },
      prompt: "version check",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: profile.id,
    });
    expect(created.task.modelConfiguration.credentialVersion).toBe(99);
    let fakeFetchCalls = 0;
    let leaseAcquires = 0;
    await executeTextTaskWithDependencies(created.task.id, {
      acquireProfile: async () => {
        leaseAcquires += 1;
        return {
          profile: {
            apiKey: "sk-second-key-5678",
            baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
            createdAt: timestamp,
            driver: "volcengine-ark",
            id: profile.id,
            label: "Versioned Ark",
            updatedAt: timestamp,
          },
          release: () => undefined,
        };
      },
      fetcher: async () => {
        fakeFetchCalls += 1;
        throw new Error("provider must not be reached");
      },
      mediaUrlForOwner: providerMediaUrlForOwner,
      store: taskStore,
    });
    const failed = taskStore.get(created.task.id);
    expect(failed?.state).toBe("failed");
    expect(failed?.errorCode).toBe("ACCOUNT_CREDENTIAL_CHANGED");
    expect(failed?.errorMessage).toBe("你的平台密钥已变更，请重新提交");
    expect(leaseAcquires).toBe(1);
    expect(fakeFetchCalls).toBe(0);
    const attemptStore = openAppDatabase(directory);
    try {
      expect(generationProviderAttemptCounts(attemptStore)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
      });
    } finally {
      attemptStore.close();
    }
  } finally {
    delete process.env.UNBOUNDRY_DATA_DIR;
    if (previous !== undefined) process.env.UNBOUNDRY_DATA_DIR = previous;
    await rm(directory, { force: true, recursive: true });
  }
});

test("account key availability is owner-isolated: A bad key never affects B or the admin", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-owner-isolation-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    const bootstrap = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      method: "POST",
    });
    expect(bootstrap.status).toBe(201);
    const adminCookie = cookie(bootstrap);

    const provider = await request("/api/admin/providers", {
      body: JSON.stringify({
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: "Isolation Ark",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(provider.status).toBe(201);
    const providerBody = (await provider.json()) as {
      profile: { id: string };
    };

    const model = await request("/api/admin/models", {
      body: JSON.stringify({
        capability: "text",
        displayName: "Isolation Text",
        isDefault: true,
        maxCostMicrounits: 1_000_000,
        providerModelId: "doubao-seed-2-0-lite-260428",
        providerProfileId: providerBody.profile.id,
        providerProtocol: "native",
        sortOrder: 1,
        status: "published",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(model.status).toBe(201);

    const database = openAppDatabase(dataDirectory);
    database
      .prepare(`
        UPDATE provider_profiles
        SET status = 'enabled', key_status = 'valid'
        WHERE id = ?
      `)
      .run(providerBody.profile.id);
    database
      .prepare(`
        UPDATE generation_safety_settings
        SET global_enabled = 1, emergency_stop = 0
        WHERE id = 1
      `)
      .run();
    database.close();

    const createUser = async (name: string, password: string) => {
      const created = await request("/api/admin/users", {
        body: JSON.stringify({
          displayName: name,
          loginName: name,
          password,
        }),
        cookie: adminCookie,
        method: "POST",
      });
      expect(created.status).toBe(201);
      const login = await request("/api/auth/login", {
        body: JSON.stringify({ loginName: name, password }),
        method: "POST",
      });
      expect(login.status).toBe(200);
      const body = (await login.json()) as { user: { id: string } };
      return { cookie: cookie(login), id: body.user.id };
    };
    const userA = await createUser("user-a", "user-a-password-123");
    const userB = await createUser("user-b", "user-b-password-123");

    const readAvailability = async (sessionCookie: string) => {
      const response = await request(
        `/api/models?capability=text`,
        { cookie: sessionCookie },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        models: Array<{
          generationAvailable: boolean;
          generationUnavailableReasonCode: string | null;
        }>;
      };
      return body.models[0];
    };

    const beforeA = await readAvailability(userA.cookie);
    expect(beforeA).toMatchObject({
      generationAvailable: false,
      generationUnavailableReasonCode: "ACCOUNT_CREDENTIAL_MISSING",
    });
    const beforeB = await readAvailability(userB.cookie);
    expect(beforeB.generationUnavailableReasonCode).toBe(
      "ACCOUNT_CREDENTIAL_MISSING",
    );

    const saved = await request(
      `/api/account-credentials/${providerBody.profile.id}`,
      {
        body: JSON.stringify({ apiKey: "sk-account-a-good-key-1234" }),
        cookie: userA.cookie,
        method: "PUT",
      },
    );
    expect(saved.status).toBe(200);

    const afterA = await readAvailability(userA.cookie);
    expect(afterA.generationAvailable).toBe(true);
    const stillB = await readAvailability(userB.cookie);
    expect(stillB.generationUnavailableReasonCode).toBe(
      "ACCOUNT_CREDENTIAL_MISSING",
    );

    const credentialStore = openAppDatabase(dataDirectory);
    credentialStore
      .prepare(`
        UPDATE account_provider_credentials
        SET key_status = 'invalid'
        WHERE account_id = ? AND provider_profile_id = ?
      `)
      .run(userA.id, providerBody.profile.id);
    credentialStore.close();

    const badA = await readAvailability(userA.cookie);
    expect(badA).toMatchObject({
      generationAvailable: false,
      generationUnavailableReasonCode: "ACCOUNT_CREDENTIAL_INVALID",
    });
    const unaffectedB = await readAvailability(userB.cookie);
    expect(unaffectedB.generationUnavailableReasonCode).toBe(
      "ACCOUNT_CREDENTIAL_MISSING",
    );
    const adminView = await readAvailability(adminCookie);
    expect(adminView.generationUnavailableReasonCode).toBe(
      "ACCOUNT_CREDENTIAL_MISSING",
    );

    const deleted = await request(`/api/admin/users/${userA.id}`, {
      cookie: adminCookie,
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const afterDelete = openAppDatabase(dataDirectory);
    try {
      const credentialCount = Number(
        (
          afterDelete
            .prepare(`
              SELECT COUNT(*) AS count
              FROM account_provider_credentials
              WHERE account_id = ?
            `)
            .get(userA.id) as { count: number }
        ).count,
      );
      expect(credentialCount).toBe(0);
    } finally {
      afterDelete.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
