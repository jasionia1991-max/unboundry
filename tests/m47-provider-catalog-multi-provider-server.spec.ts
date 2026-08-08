import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { appDataDirectory } from "../server/database";
import { generationProviderAttemptCounts } from "../server/generationTaskStore";
import {
  getProviderCatalog,
  importProviderCatalogDrafts,
  syncProviderCatalog,
} from "../server/providerCatalog";
import {
  saveProviderProfile,
  setProviderProfileAfterDocumentWriteHookForTests,
  verifyProviderProfile,
} from "../server/providerProfiles";

type RecordedRequest = {
  authorization: string | null;
  method: string;
  url: string;
};

async function withTemporaryData(
  label: string,
  run: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), `unboundry-${label}-`));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    expect(appDataDirectory()).toBe(directory);
    await run(directory);
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    await rm(directory, { force: true, recursive: true });
  }
}

function databaseAt(directory: string, readOnly = false) {
  return new DatabaseSync(join(directory, "unboundry.sqlite"), { readOnly });
}

function addAdmin(directory: string, id: string) {
  const store = databaseAt(directory);
  try {
    const timestamp = new Date().toISOString();
    store.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash,
        role, status, created_at, updated_at
      )
      VALUES (?, ?, 'Catalog Admin', 'test-only-hash',
        'admin', 'active', ?, ?)
    `).run(id, `catalog-${randomUUID()}`, timestamp, timestamp);
  } finally {
    store.close();
  }
}

function providerAttemptCounts(directory: string) {
  const store = databaseAt(directory, true);
  try {
    return generationProviderAttemptCounts(store);
  } finally {
    store.close();
  }
}

function jsonFetcher(
  records: RecordedRequest[],
  body: unknown,
  status = 200,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    records.push({
      authorization: headers.get("Authorization"),
      method: init?.method ?? "GET",
      url: input instanceof Request ? input.url : String(input),
    });
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      status,
    });
  }) as typeof fetch;
}

test("OpenRouter catalog uses one server-selected read-only request and persists normalized metadata", async () => {
  await withTemporaryData("openrouter-catalog", async (directory) => {
    const apiKey = `or-key-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "OpenRouter catalog",
    });
    const beforeAttempts = providerAttemptCounts(directory);
    const requests: RecordedRequest[] = [];
    const sync = await syncProviderCatalog(
      profile.id,
      jsonFetcher(requests, {
        data: [
          {
            architecture: { output_modalities: ["text"] },
            id: "vendor/shared-model",
            name: "Old duplicate",
          },
          {
            architecture: {
              input_modalities: ["TEXT", "image", "text", "ignored"],
              output_modalities: ["TEXT", "text"],
            },
            context_length: 1_048_576,
            driver: "volcengine-ark",
            id: "vendor/shared-model",
            name: "Shared Model",
            pricing: { completion: "0.000002", prompt: "0.000001" },
            status: "active",
            supported_parameters: ["Temperature", "tools", "temperature"],
          },
          {
            architecture: { output_modalities: ["image"] },
            id: "vendor/image-model",
            name: "Image Model",
          },
          { id: "", name: "invalid row" },
        ],
      }),
    );

    expect(requests).toEqual([{
      authorization: `Bearer ${apiKey}`,
      method: "GET",
      url: "https://openrouter.ai/api/v1/models/user",
    }]);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    expect(sync.controlPlaneRequests).toBe(1);
    expect(sync.catalog).toMatchObject({
      credentialMode: "profile-api-key",
      endpointCount: 0,
      keyStatus: "valid",
      modelCount: 2,
      scope: "account",
      support: "models",
      supportsImport: true,
      supportsSync: true,
    });
    expect(sync.catalog.models).toEqual([
      {
        capability: "text",
        discoveryId: "openrouter:vendor/shared-model",
        displayName: "Shared Model",
        metadata: {
          contextLength: 1_048_576,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          pricingSummary: "输入 0.000001 · 输出 0.000002",
          supportedParameters: ["temperature", "tools"],
        },
        providerModelId: "vendor/shared-model",
        source: "openrouter-account-catalog",
        status: "active",
      },
      {
        capability: "image",
        discoveryId: "openrouter:vendor/image-model",
        displayName: "Image Model",
        metadata: { outputModalities: ["image"] },
        providerModelId: "vendor/image-model",
        source: "openrouter-account-catalog",
        status: "available",
      },
    ]);

    const persisted = await getProviderCatalog(profile.id);
    expect(persisted.models).toEqual(sync.catalog.models);
    expect(persisted.syncedAt).toBe(sync.catalog.syncedAt);
    const store = databaseAt(directory, true);
    try {
      const row = store.prepare(`
        SELECT catalog_model_count, catalog_endpoint_count, catalog_models
        FROM provider_profiles WHERE id = ?
      `).get(profile.id) as {
        catalog_endpoint_count: number;
        catalog_model_count: number;
        catalog_models: string;
      };
      expect(row.catalog_model_count).toBe(2);
      expect(row.catalog_endpoint_count).toBe(0);
      expect(JSON.parse(row.catalog_models)).toEqual(sync.catalog.models);
    } finally {
      store.close();
    }
    expect(providerAttemptCounts(directory)).toEqual(beforeAttempts);
  });
});

test("OpenAI-compatible snapshots and imports stay profile-scoped, disabled and idempotent", async () => {
  await withTemporaryData("compatible-catalog", async (directory) => {
    const actorUserId = `catalog-admin-${randomUUID()}`;
    const openRouter = await saveProviderProfile({
      apiKey: `or-${randomUUID()}`,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Scoped OpenRouter",
    });
    const compatibleKey = `compatible-${randomUUID()}`;
    const compatible = await saveProviderProfile({
      apiKey: compatibleKey,
      baseUrl: "https://compatible.example.test/v1",
      driver: "openai-compatible",
      label: "Compatible catalog",
    });
    addAdmin(directory, actorUserId);
    const beforeAttempts = providerAttemptCounts(directory);

    await syncProviderCatalog(
      openRouter.id,
      jsonFetcher([], {
        data: [{
          architecture: { output_modalities: ["text"] },
          id: "vendor/same-id",
          name: "OpenRouter copy",
        }],
      }),
    );
    const requests: RecordedRequest[] = [];
    const sync = await syncProviderCatalog(
      compatible.id,
      jsonFetcher(requests, {
        data: [{
          driver: "openrouter",
          id: "vendor/same-id",
          input_modalities: ["image", "text"],
          name: "Compatible image model",
          output_modalities: ["image"],
        }],
      }),
    );
    expect(requests).toEqual([{
      authorization: `Bearer ${compatibleKey}`,
      method: "GET",
      url: "https://compatible.example.test/v1/models",
    }]);
    expect(sync.catalog.models[0]).toMatchObject({
      capability: "image",
      discoveryId: "openai-compatible:vendor/same-id",
      providerModelId: "vendor/same-id",
      source: "openai-compatible-public-catalog",
    });
    const openRouterCatalog = await getProviderCatalog(openRouter.id);
    expect(openRouterCatalog.models[0]).toMatchObject({
      capability: "text",
      discoveryId: "openrouter:vendor/same-id",
      source: "openrouter-account-catalog",
    });

    await expect(importProviderCatalogDrafts(
      compatible.id,
      [{ discoveryId: "openrouter:vendor/same-id" }],
      actorUserId,
    )).rejects.toThrow("Unknown discovered model");
    const selection = [{
      capability: "text",
      discoveryId: "openai-compatible:vendor/same-id",
      driver: "volcengine-ark",
    }];
    expect(await importProviderCatalogDrafts(
      compatible.id,
      selection,
      actorUserId,
    )).toEqual({ imported: 1, skipped: 0 });
    expect(await importProviderCatalogDrafts(
      compatible.id,
      selection,
      actorUserId,
    )).toEqual({ imported: 0, skipped: 1 });

    const store = databaseAt(directory, true);
    try {
      expect(store.prepare(`
        SELECT
          model_profiles.id,
          model_profiles.capability,
          model_profiles.cost_currency,
          model_profiles.provider_profile_id,
          model_profiles.provider_model_id,
          model_profiles.status,
          node_model_bindings.enabled,
          node_model_bindings.is_default
        FROM model_profiles
        JOIN node_model_bindings
          ON node_model_bindings.model_id = model_profiles.id
        WHERE model_profiles.provider_model_id = 'vendor/same-id'
      `).all()).toEqual([expect.objectContaining({
        capability: "image",
        cost_currency: "USD",
        enabled: 0,
        is_default: 0,
        provider_profile_id: compatible.id,
        provider_model_id: "vendor/same-id",
        status: "draft",
      })]);
    } finally {
      store.close();
    }
    expect(providerAttemptCounts(directory)).toEqual(beforeAttempts);
  });
});

test("OpenAI-compatible private destinations are rejected before a Bearer key is sent", async () => {
  await withTemporaryData("compatible-private-destination", async (directory) => {
    const profile = await saveProviderProfile({
      apiKey: `private-${randomUUID()}`,
      baseUrl: "https://127.0.0.1/v1",
      driver: "openai-compatible",
      label: "Blocked compatible catalog",
    });
    const beforeAttempts = providerAttemptCounts(directory);
    let fetchCalls = 0;
    const forbiddenFetcher = (async () => {
      fetchCalls += 1;
      throw new Error("private destination fetch must not run");
    }) as typeof fetch;

    await expect(verifyProviderProfile(profile.id, forbiddenFetcher))
      .rejects.toThrow("FORMAT");
    await expect(syncProviderCatalog(profile.id, forbiddenFetcher))
      .rejects.toThrow("FORMAT");
    expect(fetchCalls).toBe(0);
    expect(providerAttemptCounts(directory)).toEqual(beforeAttempts);
  });
});

test("profile-key catalogs discard normalized fields that reflect the saved key", async () => {
  await withTemporaryData("catalog-secret-reflection", async (directory) => {
    for (const driver of ["openrouter", "openai-compatible"] as const) {
      const apiKey = `${driver}-${randomUUID()}`;
      const profile = await saveProviderProfile({
        apiKey,
        baseUrl: driver === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : "https://reflection.example.test/v1",
        driver,
        label: `${driver} reflection guard`,
      });
      const synced = await syncProviderCatalog(
        profile.id,
        jsonFetcher([], {
          data: [
            {
              architecture: { output_modalities: ["text"] },
              id: `safe/${driver}`,
              name: "Safe model",
            },
            {
              architecture: { output_modalities: ["text"] },
              id: apiKey,
              name: "Reflected id",
            },
            {
              architecture: { output_modalities: ["text"] },
              id: `reflected-name/${driver}`,
              name: encodeURIComponent(apiKey),
            },
            {
              architecture: { output_modalities: ["text"] },
              id: `reflected-metadata/${driver}`,
              supported_parameters: [apiKey],
            },
          ],
        }),
      );
      expect(synced.catalog.models).toHaveLength(1);
      expect(synced.catalog.models[0].providerModelId).toBe(`safe/${driver}`);
      expect(JSON.stringify(synced.catalog)).not.toContain(apiKey);
      const store = databaseAt(directory, true);
      try {
        const row = store.prepare(`
          SELECT catalog_models FROM provider_profiles WHERE id = ?
        `).get(profile.id) as { catalog_models: string };
        expect(row.catalog_models).not.toContain(apiKey);
      } finally {
        store.close();
      }
    }
  });
});

test("catalog import rejects the encrypted-document to SQLite crash window", async () => {
  await withTemporaryData("catalog-import-stale-revision", async (directory) => {
    const previousBarrier = process.env.UNBOUNDRY_TEST_PROVIDER_PROFILE_BARRIER;
    process.env.UNBOUNDRY_TEST_PROVIDER_PROFILE_BARRIER = "1";
    const actorUserId = `catalog-admin-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey: `before-${randomUUID()}`,
      baseUrl: "https://stale.example.test/v1",
      driver: "openai-compatible",
      label: "Before crash",
    });
    addAdmin(directory, actorUserId);
    await syncProviderCatalog(
      profile.id,
      jsonFetcher([], {
        data: [{ id: "vendor/stale", output_modalities: ["text"] }],
      }),
    );
    try {
      setProviderProfileAfterDocumentWriteHookForTests(async () => {
        throw new Error("simulated crash after encrypted document rename");
      });
      await expect(saveProviderProfile({
        apiKey: `after-${randomUUID()}`,
        baseUrl: "https://stale.example.test/v1",
        driver: "openai-compatible",
        label: "After crash",
      }, profile.id)).rejects.toThrow("simulated crash");
    } finally {
      setProviderProfileAfterDocumentWriteHookForTests(undefined);
      if (previousBarrier === undefined) {
        delete process.env.UNBOUNDRY_TEST_PROVIDER_PROFILE_BARRIER;
      } else {
        process.env.UNBOUNDRY_TEST_PROVIDER_PROFILE_BARRIER = previousBarrier;
      }
    }

    await expect(importProviderCatalogDrafts(
      profile.id,
      [{ capability: "text", discoveryId: "openai-compatible:vendor/stale" }],
      actorUserId,
    )).rejects.toThrow("Provider profile not found");
    const store = databaseAt(directory, true);
    try {
      expect(store.prepare(`
        SELECT COUNT(*) AS count FROM model_profiles
        WHERE provider_profile_id = ?
      `).get(profile.id)).toEqual({ count: 0 });
    } finally {
      store.close();
    }
  });
});

test("Mureka remains manual and rejects catalog sync and import without a remote request", async () => {
  await withTemporaryData("mureka-manual", async (directory) => {
    const profile = await saveProviderProfile({
      apiKey: `mureka-${randomUUID()}`,
      baseUrl: "https://api.mureka.ai",
      driver: "mureka",
      label: "Mureka manual catalog",
    });
    const beforeAttempts = providerAttemptCounts(directory);
    let fetchCalls = 0;
    const forbiddenFetcher = (async () => {
      fetchCalls += 1;
      throw new Error("Mureka catalog fetch must not run");
    }) as typeof fetch;

    const catalog = await getProviderCatalog(profile.id);
    expect(catalog).toMatchObject({
      credentialMode: "none",
      endpointCount: 0,
      modelCount: 0,
      scope: "manual",
      support: "manual",
      supported: false,
      supportsImport: false,
      supportsSync: false,
    });
    await expect(syncProviderCatalog(
      profile.id,
      forbiddenFetcher,
    )).rejects.toThrow("NOT_SUPPORTED");
    await expect(importProviderCatalogDrafts(
      profile.id,
      [{ capability: "audio", discoveryId: "mureka:fake" }],
      `unused-${randomUUID()}`,
    )).rejects.toThrow("Provider catalog import is not supported");
    expect(fetchCalls).toBe(0);
    expect(providerAttemptCounts(directory)).toEqual(beforeAttempts);
  });
});

test("catalog auth, permission and format failures are safe and preserve the last good snapshot", async () => {
  await withTemporaryData("catalog-safe-errors", async (directory) => {
    const apiKey = `private-${randomUUID()}`;
    const profile = await saveProviderProfile({
      apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Failure-safe catalog",
    });
    const beforeAttempts = providerAttemptCounts(directory);
    await syncProviderCatalog(
      profile.id,
      jsonFetcher([], {
        data: [{
          architecture: { output_modalities: ["text"] },
          id: "vendor/last-good",
          name: "Last good model",
        }],
      }),
    );
    const lastGood = await getProviderCatalog(profile.id);
    const syncedAt = lastGood.syncedAt;
    const remoteSecret = `remote-detail-${randomUUID()}`;
    const scenarios = [
      { code: "AUTH", keyStatus: "invalid", status: 401 },
      { code: "PERMISSION", keyStatus: "permission", status: 403 },
      { code: "FORMAT", keyStatus: "unknown", status: 200 },
    ] as const;
    const requests: RecordedRequest[] = [];

    for (const scenario of scenarios) {
      const fetcher = scenario.code === "FORMAT"
        ? (async (input: string | URL | Request, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          requests.push({
            authorization: headers.get("Authorization"),
            method: init?.method ?? "GET",
            url: input instanceof Request ? input.url : String(input),
          });
          return new Response(`{invalid-json-${remoteSecret}`, {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }) as typeof fetch
        : jsonFetcher(requests, { detail: remoteSecret }, scenario.status);
      let thrown: unknown;
      try {
        await syncProviderCatalog(profile.id, fetcher);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(scenario.code);
      expect(String(thrown)).not.toContain(apiKey);
      expect(String(thrown)).not.toContain(remoteSecret);

      const afterFailure = await getProviderCatalog(profile.id);
      expect(afterFailure.models).toEqual(lastGood.models);
      expect(afterFailure.modelCount).toBe(lastGood.modelCount);
      expect(afterFailure.syncedAt).toBe(syncedAt);
      expect(afterFailure.keyStatus).toBe(scenario.keyStatus);
      expect(afterFailure.errorCode).toBe(scenario.code);
    }

    expect(requests).toHaveLength(3);
    expect(requests).toEqual(requests.map(() => ({
      authorization: `Bearer ${apiKey}`,
      method: "GET",
      url: "https://openrouter.ai/api/v1/models/user",
    })));
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    expect(providerAttemptCounts(directory)).toEqual(beforeAttempts);
  });
});
