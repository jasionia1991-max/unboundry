import { expect, test } from "./safe-test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountCredentialKey,
  accountCredentialRow,
  accountCredentialStatusMap,
  deleteAccountCredential,
  saveAccountCredential,
  verifyAccountCredential,
} from "../server/accountCredentials";
import { openAppDatabase } from "../server/database";

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

    expect(deleteAccountCredential(store, "user-b", "profile-1")).toBeFalsy();
    expect(deleteAccountCredential(store, "user-a", "profile-1")).toBeTruthy();
    expect(await accountCredentialKey(store, "user-a", "profile-1")).toBe(
      undefined,
    );
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
