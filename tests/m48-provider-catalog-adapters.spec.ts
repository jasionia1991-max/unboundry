import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { authGate } from "../server/auth";
import { appDataDirectory, openAppDatabase } from "../server/database";
import {
  getProviderCatalog,
  importProviderCatalogDrafts,
  syncProviderCatalog,
} from "../server/providerCatalog";
import {
  adminProviderProfilesApi,
  saveProviderProfile,
} from "../server/providerProfiles";

async function temporaryDataDirectory<T>(
  prefix: string,
  run: (directory: string) => Promise<T>,
) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    expect(appDataDirectory()).toBe(directory);
    openAppDatabase(directory).close();
    return await run(directory);
  } finally {
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    await rm(directory, { force: true, recursive: true });
  }
}

function addAuditActor(directory: string, userId = "catalog-test-admin") {
  const store = new DatabaseSync(join(directory, "unboundry.sqlite"));
  const timestamp = new Date().toISOString();
  try {
    store.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES (?, ?, 'Catalog Test', 'test-only', 'admin', 'active', ?, ?)
    `).run(userId, userId, timestamp, timestamp);
  } finally {
    store.close();
  }
  return userId;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("OpenRouter sync uses only the saved API key and imports bounded USD drafts", async () => {
  await temporaryDataDirectory("unboundry-openrouter-catalog-", async (directory) => {
    const apiKey = `or-secret-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "OpenRouter catalog",
    });
    const requests: Array<{
      authorization: string | null;
      method: string | undefined;
      url: string;
    }> = [];
    const result = await syncProviderCatalog(profile.id, (async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        authorization: headers.get("Authorization"),
        method: init?.method,
        url: String(input),
      });
      return jsonResponse({
        data: [{
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["image"],
          },
          context_length: 128_000,
          id: "openai/gpt-image-2",
          name: "GPT Image 2",
          pricing: {
            completion: "0.00002",
            prompt: "0.00001",
          },
          supported_parameters: ["quality", "aspect_ratio"],
        }, {
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          id: "safe/text-model",
          name: "Safe Text",
        }],
      });
    }) as typeof fetch);

    expect(requests).toEqual([{
      authorization: `Bearer ${apiKey}`,
      method: "GET",
      url: "https://openrouter.ai/api/v1/models/user",
    }]);
    expect(result.controlPlaneRequests).toBe(1);
    expect(result.catalog).toMatchObject({
      credentialMode: "profile-api-key",
      endpointCount: 0,
      keyStatus: "valid",
      modelCount: 2,
      modelLabel: "当前Key可见模型",
      scope: "account",
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsSync: true,
    });
    expect(result.catalog.models[0]).toMatchObject({
      capability: "image",
      discoveryId: "openrouter:openai/gpt-image-2",
      metadata: {
        contextLength: 128_000,
        inputModalities: ["text", "image"],
        outputModalities: ["image"],
        pricingSummary: "输入 0.00001 · 输出 0.00002",
        supportedParameters: ["quality", "aspect_ratio"],
      },
      providerModelId: "openai/gpt-image-2",
      source: "openrouter-account-catalog",
      status: "available",
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);

    const actor = addAuditActor(directory);
    await expect(importProviderCatalogDrafts(profile.id, [{
      discoveryId: "openrouter:openai/gpt-image-2",
    }], actor)).resolves.toEqual({ imported: 1, skipped: 0 });
    const store = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(store.prepare(`
        SELECT
          model_profiles.capability,
          model_profiles.cost_currency,
          model_profiles.status,
          node_model_bindings.enabled,
          node_model_bindings.is_default
        FROM model_profiles
        JOIN node_model_bindings
          ON node_model_bindings.model_id = model_profiles.id
        WHERE model_profiles.provider_profile_id = ?
      `).get(profile.id)).toEqual({
        capability: "image",
        cost_currency: "USD",
        enabled: 0,
        is_default: 0,
        status: "draft",
      });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get()).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  });
});

test("OpenAI-compatible catalogs remain public/basic and infer only explicit output modalities", async () => {
  await temporaryDataDirectory("unboundry-openai-compatible-catalog-", async (directory) => {
    const profile = await saveProviderProfile({
      apiKey: `compatible-${randomUUID()}`,
      baseUrl: "https://models.example.test/v1",
      driver: "openai-compatible",
      label: "Compatible catalog",
    });
    const urls: string[] = [];
    const result = await syncProviderCatalog(profile.id, (async (input) => {
      urls.push(String(input));
      return jsonResponse({
        data: [{ id: "basic-model", owned_by: "example" }, {
          id: "explicit-image",
          name: "Explicit Image",
          output_modalities: ["image"],
        }],
      });
    }) as typeof fetch);
    expect(urls).toEqual(["https://models.example.test/v1/models"]);
    expect(result.catalog).toMatchObject({
      endpointCount: 0,
      modelLabel: "公共基础模型",
      scope: "public",
      support: "models",
    });
    expect(result.catalog.models).toEqual([
      {
        capability: "unknown",
        discoveryId: "openai-compatible:basic-model",
        displayName: "basic-model",
        providerModelId: "basic-model",
        source: "openai-compatible-public-catalog",
        status: "available",
      },
      {
        capability: "image",
        discoveryId: "openai-compatible:explicit-image",
        displayName: "Explicit Image",
        metadata: { outputModalities: ["image"] },
        providerModelId: "explicit-image",
        source: "openai-compatible-public-catalog",
        status: "available",
      },
    ]);

    const actor = addAuditActor(directory);
    await expect(importProviderCatalogDrafts(profile.id, [{
      capability: "text",
      discoveryId: "openai-compatible:basic-model",
    }], actor)).resolves.toEqual({ imported: 1, skipped: 0 });
    const store = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(store.prepare(`
        SELECT capability, cost_currency, status
        FROM model_profiles WHERE provider_profile_id = ?
      `).get(profile.id)).toEqual({
        capability: "text",
        cost_currency: "USD",
        status: "draft",
      });
    } finally {
      store.close();
    }
  });
});

test("Mureka exposes a manual descriptor without remote sync, import, or fake requests", async () => {
  await temporaryDataDirectory("unboundry-mureka-manual-catalog-", async (directory) => {
    const profile = await saveProviderProfile({
      apiKey: `mureka-${randomUUID()}`,
      baseUrl: "https://api.mureka.ai",
      driver: "mureka",
      label: "Mureka manual",
    });
    let requestCount = 0;
    await expect(syncProviderCatalog(profile.id, (async () => {
      requestCount += 1;
      return jsonResponse({ data: [] });
    }) as typeof fetch)).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(requestCount).toBe(0);
    const catalog = await getProviderCatalog(profile.id);
    expect(catalog).toMatchObject({
      controlRequestCount: 0,
      credentialMode: "none",
      endpointCount: 0,
      modelCount: 0,
      modelLabel: "项目支持模型",
      scope: "manual",
      support: "manual",
      supported: false,
      supportsEndpoints: false,
      supportsImport: false,
      supportsSync: false,
    });
    await expect(importProviderCatalogDrafts(
      profile.id,
      [{ capability: "audio", discoveryId: "manual" }],
      "unused",
    )).rejects.toThrow("not supported");

    const store = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(store.prepare(`
        SELECT catalog_control_request_count, catalog_models
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_control_request_count: 0,
        catalog_models: "[]",
      });
    } finally {
      store.close();
    }
  });
});

test("API-key catalog snapshots reject late writes after connection credentials change", async () => {
  await temporaryDataDirectory("unboundry-provider-catalog-stale-", async (directory) => {
    const profile = await saveProviderProfile({
      apiKey: `first-${randomUUID()}`,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "OpenRouter stale",
    });
    await syncProviderCatalog(profile.id, (async () => jsonResponse({
      data: [{
        architecture: { output_modalities: ["text"] },
        id: "kept-model",
      }],
    })) as typeof fetch);
    const before = await getProviderCatalog(profile.id);

    let release = () => {};
    let started = () => {};
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    const requestReleased = new Promise<void>((resolve) => { release = resolve; });
    const stale = syncProviderCatalog(profile.id, (async () => {
      started();
      await requestReleased;
      return jsonResponse({ data: [{ id: "must-not-overwrite" }] });
    }) as typeof fetch);
    await requestStarted;
    await saveProviderProfile({
      apiKey: `replacement-${randomUUID()}`,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "OpenRouter replacement",
    }, profile.id);
    release();
    await expect(stale).rejects.toMatchObject({ code: "CONFIG_CHANGED" });

    const after = await getProviderCatalog(profile.id);
    expect(after.models).toEqual(before.models);
    expect(after.syncedAt).toBe(before.syncedAt);
    expect(after.keyStatus).toBe("unchecked");
    expect(JSON.stringify(after)).not.toContain("must-not-overwrite");
    const store = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  });
});

test("public Provider profiles expose capability metadata without returning secrets", async () => {
  await temporaryDataDirectory("unboundry-provider-catalog-contract-", async () => {
    const apiKey = `contract-${randomUUID()}`;
    await saveProviderProfile({
      apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Contract OpenRouter",
    });
    const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
    const server = createServer((request, response) => {
      void authGate(request, response, () => {
        void adminProviderProfilesApi(request, response);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(apiKey);
      const body = JSON.parse(text) as {
        paidProviderRequests: number;
        profiles: Array<{
          driver: string;
          modelCatalog: Record<string, unknown>;
        }>;
      };
      expect(body.paidProviderRequests).toBe(0);
      expect(body.profiles[0]).toMatchObject({
        driver: "openrouter",
        modelCatalog: {
          credentialMode: "profile-api-key",
          modelLabel: "当前Key可见模型",
          scope: "account",
          support: "models",
          supported: true,
          supportsEndpoints: false,
          supportsImport: true,
          supportsSync: true,
        },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousBypass === undefined) delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
      else process.env.UNBOUNDRY_TEST_AUTH_BYPASS = previousBypass;
    }
  });
});
