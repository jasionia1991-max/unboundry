import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { generationProviderAttemptCounts } from "../server/generationTaskStore";
import {
  fetchRelayModelCatalog,
  inferRelayCatalogModelHints,
  RelayRemoteError,
} from "../server/multiProtocolRelay";
import {
  getProviderCatalog,
  syncProviderCatalog,
} from "../server/providerCatalog";
import {
  saveProviderProfile,
  type ProviderDriver,
  type ProviderProfile,
} from "../server/providerProfiles";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function relayProfile(): ProviderProfile {
  const timestamp = "2026-08-04T00:00:00.000Z";
  return {
    apiKey: `relay-inference-${randomUUID()}`,
    baseUrl: "https://catalog-inference.example.test/v1",
    configurationVersion: 1,
    createdAt: timestamp,
    driver: "multi-protocol-relay",
    id: randomUUID(),
    label: "Relay inference fixture",
    updatedAt: timestamp,
  };
}

async function withTemporaryData(
  label: string,
  run: (directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), `unboundry-${label}-`));
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    await run(directory);
  } finally {
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
    await rm(directory, { force: true, recursive: true });
  }
}

function legacyModel(providerModelId: string) {
  return {
    capability: "unknown",
    discoveryId: `multi-protocol-relay:${providerModelId}`,
    displayName: providerModelId,
    providerModelId,
    source: "multi-protocol-relay-account-catalog",
    status: "available",
  };
}

function writeLegacySnapshot(
  directory: string,
  profileId: string,
  models: ReturnType<typeof legacyModel>[],
) {
  const store = new DatabaseSync(join(directory, "unboundry.sqlite"));
  try {
    const timestamp = "2026-08-04T01:00:00.000Z";
    const updated = store.prepare(`
      UPDATE provider_profiles
      SET
        catalog_key_status = 'valid',
        catalog_checked_at = ?,
        catalog_synced_at = ?,
        catalog_last_error_code = NULL,
        catalog_models = ?,
        catalog_model_count = ?,
        catalog_control_request_count = 0
      WHERE id = ?
    `).run(timestamp, timestamp, JSON.stringify(models), models.length, profileId);
    expect(updated.changes).toBe(1);
  } finally {
    store.close();
  }
}

function officialEnhancedFixture() {
  const models = [
    ...Array.from({ length: 27 }, (_, index) => ({
      ...(index === 0
        ? {
            api_endpoints: [{
              endpoint: "/v1/messages",
              format: "anthropic",
            }],
          }
        : {}),
      ...(index === 0
        ? {}
        : { api_format: index === 1 ? "gemini" : "openai" }),
      ...(index === 0 ? { id: "must-not-replace-official-name" } : {}),
      name: `chat-model-${index + 1}`,
      type: "chat",
    })),
    ...Array.from({ length: 17 }, (_, index) => ({
      ...(index === 0
        ? {
            api_endpoints: [{
              endpoint: "/v1/images/generations",
              format: "openai",
            }],
          }
        : {}),
      name: `image-model-${index + 1}`,
      type: "image",
    })),
    ...Array.from({ length: 50 }, (_, index) => ({
      name: `video-model-${index + 1}`,
      type: "video",
    })),
    ...Array.from({ length: 7 }, (_, index) => ({
      name: `audio-model-${index + 1}`,
      type: ["audio", "tts", "music"][index % 3],
    })),
  ];
  expect(models).toHaveLength(101);
  return { models, total: models.length, type: "list" };
}

function officialBasicFixture() {
  const data = Array.from({ length: 55 }, (_, index) => ({
    id: `chat-model-${index + 1}`,
    name: `Basic chat ${index + 1}`,
    type: "chat",
  }));
  return { data, total: data.length, type: "list" };
}

test("优创101个增强目录与55个基础目录去重合并为129个", async () => {
  const requests: string[] = [];
  const result = await fetchRelayModelCatalog(
    relayProfile(),
    (async (input) => {
      requests.push(String(input));
      return String(input).endsWith("/skills/models")
        ? jsonResponse(officialEnhancedFixture())
        : jsonResponse(officialBasicFixture());
    }) as typeof fetch,
  );
  expect(requests).toEqual([
    "https://catalog-inference.example.test/v1/skills/models",
    "https://catalog-inference.example.test/v1/models",
  ]);
  expect(result).toMatchObject({
    capabilityCounts: {
      audio: 7,
      image: 17,
      text: 55,
      unknown: 0,
      video: 50,
    },
    catalogSource: "enhanced+basic",
    endpoint: "enhanced",
    rejectedModelCount: 0,
    reportedModelCount: 129,
  });
  expect(result.fallbackReason).toBeUndefined();
  expect(result.models).toHaveLength(129);
  expect(result.models.some((model) =>
    model.providerModelId === "must-not-replace-official-name"
  )).toBe(false);
  expect(result.models.find((model) => model.providerModelId === "chat-model-1"))
    .toMatchObject({
      capability: "text",
      metadata: { protocols: ["claude-messages"] },
    });
  expect(result.models.find((model) => model.providerModelId === "chat-model-2"))
    .toMatchObject({
      capability: "text",
      metadata: { protocols: ["gemini-generate-content"] },
    });
  expect(result.models.find((model) => model.providerModelId === "chat-model-3"))
    .toMatchObject({
      capability: "text",
      metadata: { protocols: ["openai-chat"] },
    });
  expect(result.models.find((model) => model.providerModelId === "image-model-1"))
    .toMatchObject({
      capability: "image",
      metadata: { protocols: ["gpt-image"] },
    });
  for (const id of ["image-model-2", "video-model-1", "audio-model-1"]) {
    expect(result.models.find((model) => model.providerModelId === id), id)
      .toMatchObject({ metadata: { protocols: ["media-generate"] } });
  }
});

test("增强目录只在明确不支持或真空数组时回退", async () => {
  for (const fixture of [
    {
      enhanced: jsonResponse({ error: "not found" }, 404),
      reason: "NOT_SUPPORTED",
    },
    {
      enhanced: jsonResponse({ models: [], total: 0 }),
      reason: "EMPTY",
    },
  ] as const) {
    const requests: string[] = [];
    const result = await fetchRelayModelCatalog(
      relayProfile(),
      (async (input) => {
        requests.push(String(input));
        return requests.length === 1
          ? fixture.enhanced
          : jsonResponse({ data: [{ id: "basic-chat", type: "chat" }], total: 1 });
      }) as typeof fetch,
    );
    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({
      capabilityCounts: {
        audio: 0,
        image: 0,
        text: 1,
        unknown: 0,
        video: 0,
      },
      catalogSource: "basic-fallback",
      endpoint: "basic",
      fallbackReason: fixture.reason,
      rejectedModelCount: 0,
      reportedModelCount: 1,
    });
  }
});

test("基础目录明确不支持时可安全使用增强目录", async () => {
  const requests: string[] = [];
  const result = await fetchRelayModelCatalog(
    relayProfile(),
    (async (input) => {
      requests.push(String(input));
      return requests.length === 1
        ? jsonResponse(officialEnhancedFixture())
        : jsonResponse({ error: "not supported" }, 404);
    }) as typeof fetch,
  );
  expect(requests).toHaveLength(2);
  expect(result).toMatchObject({
    capabilityCounts: {
      audio: 7,
      image: 17,
      text: 27,
      unknown: 0,
      video: 50,
    },
    catalogSource: "enhanced",
    rejectedModelCount: 0,
    reportedModelCount: 101,
  });
  expect(result.models).toHaveLength(101);
});

test("增强目录成功后基础目录格式、网络或授权异常都失败关闭", async () => {
  for (const fixture of [
    {
      expectedCode: "FORMAT",
      second: () => jsonResponse({ data: [{ unsupported: true }], total: 1 }),
    },
    {
      expectedCode: "NETWORK",
      second: () => {
        throw new Error("fixture network failure");
      },
    },
    {
      expectedCode: "AUTH",
      second: () => jsonResponse({ error: "unauthorized" }, 401),
    },
  ]) {
    let requestCount = 0;
    await expect(fetchRelayModelCatalog(
      relayProfile(),
      (async () => {
        requestCount += 1;
        return requestCount === 1
          ? jsonResponse(officialEnhancedFixture())
          : fixture.second();
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: fixture.expectedCode });
    expect(requestCount).toBe(2);
  }
});

test("增强目录格式异常或网络失败不会静默回退", async () => {
  for (const fixture of [
    {
      expectedCode: "FORMAT",
      response: () => jsonResponse({ models: [{ unsupported_field: true }], total: 1 }),
    },
    {
      expectedCode: "NETWORK",
      response: () => {
        throw new Error("fixture network failure");
      },
    },
  ]) {
    let requestCount = 0;
    await expect(fetchRelayModelCatalog(
      relayProfile(),
      (async () => {
        requestCount += 1;
        return fixture.response();
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: fixture.expectedCode });
    expect(requestCount).toBe(1);
  }
});

test("增强目录解析失败保留上次全量快照和诊断", async () => {
  await withTemporaryData("relay-full-snapshot", async (directory) => {
    const profile = await saveProviderProfile({
      apiKey: `relay-full-${randomUUID()}`,
      baseUrl: "https://full-relay.example.test/v1",
      driver: "multi-protocol-relay",
      label: "Full relay",
    });
    const first = await syncProviderCatalog(
      profile.id,
      (async (input) => String(input).endsWith("/skills/models")
        ? jsonResponse(officialEnhancedFixture())
        : jsonResponse(officialBasicFixture())) as typeof fetch,
    );
    expect(first.catalog).toMatchObject({
      capabilityCounts: {
        audio: 7,
        image: 17,
        text: 55,
        unknown: 0,
        video: 50,
      },
      catalogSource: "enhanced+basic",
      modelCount: 129,
      reportedModelCount: 129,
    });
    const before = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    let previous: {
      catalog_diagnostics: string;
      catalog_models: string;
      catalog_synced_at: string;
    };
    try {
      previous = before.prepare(`
        SELECT catalog_diagnostics, catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id) as typeof previous;
    } finally {
      before.close();
    }

    let failedRequestCount = 0;
    await expect(syncProviderCatalog(
      profile.id,
      (async () => {
        failedRequestCount += 1;
        return jsonResponse({ models: [{ unsupported_field: true }], total: 1 });
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: "FORMAT" });
    expect(failedRequestCount).toBe(1);

    let secondEndpointRequests = 0;
    await expect(syncProviderCatalog(
      profile.id,
      (async () => {
        secondEndpointRequests += 1;
        return secondEndpointRequests === 1
          ? jsonResponse(officialEnhancedFixture())
          : jsonResponse({ data: [{ unsupported_field: true }], total: 1 });
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: "FORMAT" });
    expect(secondEndpointRequests).toBe(2);

    const downgradeRequests: string[] = [];
    await expect(syncProviderCatalog(
      profile.id,
      (async (input) => {
        downgradeRequests.push(String(input));
        return downgradeRequests.length === 1
          ? jsonResponse({ error: "temporarily unavailable" }, 404)
          : jsonResponse({ data: [{ id: "compatibility-only" }] });
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: "FORMAT" });
    expect(downgradeRequests).toHaveLength(2);

    const after = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(after.prepare(`
        SELECT catalog_diagnostics, catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual(previous);
      expect(after.prepare(`
        SELECT catalog_key_status, catalog_last_error_code
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_key_status: "unknown",
        catalog_last_error_code: "FORMAT",
      });
      expect(generationProviderAttemptCounts(after)).toEqual({
        historicalEstimatedProviderAttempts: 0,
        paidProviderRequests: 0,
      });
      expect(after.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get()).toEqual({ count: 0 });
    } finally {
      after.close();
    }
  });
});

test("已有全量目录不会被55个兼容模型降级覆盖", async () => {
  await withTemporaryData("relay-no-catalog-downgrade", async (directory) => {
    const profile = await saveProviderProfile({
      apiKey: `relay-no-downgrade-${randomUUID()}`,
      baseUrl: "https://no-downgrade-relay.example.test/v1",
      driver: "multi-protocol-relay",
      label: "No downgrade relay",
    });
    const first = await syncProviderCatalog(
      profile.id,
      (async (input) => String(input).endsWith("/skills/models")
        ? jsonResponse(officialEnhancedFixture())
        : jsonResponse(officialBasicFixture())) as typeof fetch,
    );
    expect(first.catalog).toMatchObject({
      catalogSource: "enhanced+basic",
      modelCount: 129,
      reportedModelCount: 129,
    });

    const before = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    let previous: {
      catalog_diagnostics: string;
      catalog_models: string;
      catalog_synced_at: string;
    };
    try {
      previous = before.prepare(`
        SELECT catalog_diagnostics, catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id) as typeof previous;
    } finally {
      before.close();
    }

    let downgradeRequestCount = 0;
    await expect(syncProviderCatalog(
      profile.id,
      (async () => {
        downgradeRequestCount += 1;
        return downgradeRequestCount === 1
          ? jsonResponse({ error: "not found" }, 404)
          : jsonResponse({
              data: Array.from({ length: 55 }, (_, index) => ({
                id: `basic-chat-${index + 1}`,
                type: "chat",
              })),
              total: 55,
            });
      }) as typeof fetch,
    )).rejects.toMatchObject({ code: "FORMAT" });
    expect(downgradeRequestCount).toBe(2);

    const after = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(after.prepare(`
        SELECT catalog_diagnostics, catalog_models, catalog_synced_at
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual(previous);
      expect(after.prepare(`
        SELECT
          catalog_control_request_count,
          catalog_key_status,
          catalog_last_error_code,
          catalog_model_count
        FROM provider_profiles WHERE id = ?
      `).get(profile.id)).toEqual({
        catalog_control_request_count: 4,
        catalog_key_status: "unknown",
        catalog_last_error_code: "FORMAT",
        catalog_model_count: 129,
      });
    } finally {
      after.close();
    }
  });
});

test("优创55个LLM字符串均归为文字且协议仍由管理员选择", async () => {
  const textIds = [
    "claude-fable-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5-20251101",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-opus-5",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "deepseek-v3.2",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "doubao-seed-1-8-251228",
    "doubao-seed-2-0-pro-260215",
    "doubao-seed-2-1-pro-260628",
    "doubao-seed-2-1-turbo-260628",
    "doubao-seed-character-260628",
    "doubao-seed-evolving",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "glm-5.2",
    "gpt-4o",
    "gpt-5.2",
    "gpt-5.3-chat-latest",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.4-xhigh",
    "gpt-5.5",
    "gpt-5.5-medium",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "grok-4-20-non-reasoning",
    "grok-4.3",
    "grok-4.5",
    "grok-build-0.1",
    "kimi-k2.6",
    "kimi-k3",
    "kimi/kimi-k2.7-code",
    "kimi/kimi-k2.7-code-highspeed",
    "mimo-v2.5-pro",
    "MiniMax-M2.7",
    "MiniMax-M3",
    "qwen3.5-flash",
    "qwen3.5-plus",
    "qwen3.6-flash",
    "qwen3.6-plus",
    "qwen3.7-max",
    "qwen3.7-plus",
    "stepfun/step-3.7-flash",
  ];
  expect(textIds).toHaveLength(55);
  const mediaIds = [
    "gpt-image-1",
    "black-forest-labs/flux-1.1-pro",
    "doubao-seedance-2-0-pro",
    "elevenlabs-tts-v3",
  ];
  const ambiguousIds = [
    "vendor/image-captioner",
    "vendor/video-understanding-pro",
    "whisper-large-v3",
    "custom-embedding-model",
  ];
  const requests: string[] = [];
  const catalog = await fetchRelayModelCatalog(
    relayProfile(),
    (async (input) => {
      requests.push(String(input));
      return requests.length === 1
        ? jsonResponse({ models: [] })
        : jsonResponse({
            data: [
              ...textIds,
              ...mediaIds,
              ...ambiguousIds,
              { id: "qwen3.7-object-only" },
              {
                id: "claude-explicit-video",
                output_modalities: ["video"],
                protocols: ["media-generate"],
              },
              {
                id: "custom-image-understanding",
                type: "image_understanding",
              },
            ],
          });
    }) as typeof fetch,
  );
  expect(catalog.endpoint).toBe("basic");
  expect(requests).toEqual([
    "https://catalog-inference.example.test/v1/skills/models",
    "https://catalog-inference.example.test/v1/models",
  ]);
  const byId = new Map(catalog.models.map((model) => [model.providerModelId, model]));

  for (const id of textIds) {
    expect(byId.get(id)?.capability, id).toBe("text");
    expect(byId.get(id)?.metadata?.protocols, id).toBeUndefined();
  }
  expect(byId.get("gpt-image-1")).toMatchObject({
    capability: "image",
  });
  expect(byId.get("gpt-image-1")?.metadata?.protocols).toBeUndefined();
  expect(byId.get("black-forest-labs/flux-1.1-pro")).toMatchObject({
    capability: "image",
  });
  expect(byId.get("black-forest-labs/flux-1.1-pro")?.metadata?.protocols)
    .toBeUndefined();
  expect(byId.get("doubao-seedance-2-0-pro")).toMatchObject({
    capability: "video",
  });
  expect(byId.get("doubao-seedance-2-0-pro")?.metadata?.protocols)
    .toBeUndefined();
  expect(byId.get("elevenlabs-tts-v3")).toMatchObject({
    capability: "audio",
  });
  expect(byId.get("elevenlabs-tts-v3")?.metadata?.protocols).toBeUndefined();
  for (const id of ambiguousIds) {
    expect(byId.get(id)?.capability, id).toBe("unknown");
    expect(byId.get(id)?.metadata?.protocols, id).toBeUndefined();
  }
  expect(byId.get("qwen3.7-object-only")).toMatchObject({
    capability: "text",
  });
  expect(byId.get("qwen3.7-object-only")?.metadata?.protocols).toBeUndefined();
  expect(byId.get("claude-explicit-video")).toMatchObject({
    capability: "video",
    metadata: { outputModalities: ["video"], protocols: ["media-generate"] },
  });
  expect(byId.get("custom-image-understanding")?.capability).toBe("unknown");
});

test("推断辅助函数不将通用模态单词当作生成输出", () => {
  expect(inferRelayCatalogModelHints("image-caption-model"))
    .toEqual({ capability: "unknown" });
  expect(inferRelayCatalogModelHints("video-understanding-model"))
    .toEqual({ capability: "unknown" });
  expect(inferRelayCatalogModelHints("whisper-large-v3"))
    .toEqual({ capability: "unknown" });
  expect(inferRelayCatalogModelHints("qwen2.5-vl"))
    .toEqual({ capability: "text" });
});

test("旧数据库unknown目录刷新后立即分类且非中转平台不受影响", async () => {
  await withTemporaryData("relay-legacy-inference", async (directory) => {
    const relay = await saveProviderProfile({
      apiKey: `relay-legacy-${randomUUID()}`,
      baseUrl: "https://legacy-relay.example.test/v1",
      driver: "multi-protocol-relay",
      label: "Legacy relay",
    });
    const relayModels = [
      legacyModel("claude-fable-5"),
      legacyModel("gpt-image-1"),
      legacyModel("doubao-seedance-2-0-pro"),
      legacyModel("elevenlabs-tts-v3"),
      legacyModel("vendor-private-model"),
    ];
    writeLegacySnapshot(directory, relay.id, relayModels);
    const before = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    let attemptsBefore: ReturnType<typeof generationProviderAttemptCounts>;
    try {
      attemptsBefore = generationProviderAttemptCounts(before);
    } finally {
      before.close();
    }

    const refreshed = await getProviderCatalog(relay.id);
    expect(refreshed.controlRequestCount).toBe(0);
    expect(refreshed.models.map((model) => [
      model.providerModelId,
      model.capability,
    ])).toEqual([
      ["claude-fable-5", "text"],
      ["gpt-image-1", "image"],
      ["doubao-seedance-2-0-pro", "video"],
      ["elevenlabs-tts-v3", "audio"],
      ["vendor-private-model", "unknown"],
    ]);
    expect(refreshed.models[0].metadata?.protocols).toBeUndefined();
    expect(refreshed.models[4].metadata?.protocols).toBeUndefined();

    const nonRelayDrivers: Array<{
      baseUrl: string;
      driver: Exclude<ProviderDriver, "multi-protocol-relay">;
    }> = [
      { baseUrl: "https://openrouter.ai/api/v1", driver: "openrouter" },
      {
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
      },
      { baseUrl: "https://api.mureka.ai", driver: "mureka" },
      {
        baseUrl: "https://compatible.example.test/v1",
        driver: "openai-compatible",
      },
    ];
    for (const item of nonRelayDrivers) {
      const profile = await saveProviderProfile({
        apiKey: `${item.driver}-${randomUUID()}`,
        baseUrl: item.baseUrl,
        driver: item.driver,
        label: `${item.driver} unchanged`,
      });
      writeLegacySnapshot(directory, profile.id, [legacyModel("claude-fable-5")]);
      const catalog = await getProviderCatalog(profile.id);
      expect(catalog.models[0].capability, item.driver).toBe("unknown");
      expect(catalog.models[0].metadata?.protocols, item.driver).toBeUndefined();
    }

    const after = new DatabaseSync(join(directory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(generationProviderAttemptCounts(after)).toEqual(attemptsBefore);
      expect(after.prepare(`
        SELECT COUNT(*) AS count FROM generation_tasks
      `).get()).toEqual({ count: 0 });
    } finally {
      after.close();
    }
  });
});
