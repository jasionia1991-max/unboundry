import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { generationProviderAttemptCounts } from "../server/generationTaskStore";
import { OutboundProxyConfigurationError } from "../server/outboundNetwork";
import {
  getProviderCatalog,
  providerCatalogSyncErrorMessage,
  syncProviderCatalog,
} from "../server/providerCatalog";
import {
  providerVerificationErrorMessage,
  saveProviderProfile,
  verifyProviderProfile,
  type ProviderDriver,
} from "../server/providerProfiles";

const keyProxyMessage =
  "本机代理地址模式阻止安全检查，暂时无法确认API Key是否有效";
const catalogProxyMessage =
  "本机代理地址模式阻止目录同步，已保留上次结果";

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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function successCatalog(driver: ProviderDriver) {
  return driver === "multi-protocol-relay"
    ? { models: [{ id: "vendor/last-good", output_modalities: ["text"] }] }
    : { data: [{ id: "vendor/last-good", output_modalities: ["text"] }] };
}

function providerAttemptCounts(directory: string) {
  const store = new DatabaseSync(join(directory, "unboundry.sqlite"), {
    readOnly: true,
  });
  try {
    return generationProviderAttemptCounts(store);
  } finally {
    store.close();
  }
}

test("Provider Key与目录严格透传代理配置错误并保留目录快照", async () => {
  await withTemporaryData("provider-proxy-code", async (directory) => {
    for (const driver of [
      "multi-protocol-relay",
      "openai-compatible",
    ] as const) {
      const profile = await saveProviderProfile({
        apiKey: `proxy-${driver}-${randomUUID()}`,
        baseUrl: `https://${driver}.proxy.example.test/v1`,
        driver,
        label: `${driver} proxy mapping`,
      });
      await syncProviderCatalog(
        profile.id,
        (async (input) =>
          jsonResponse(
            driver === "multi-protocol-relay" &&
                new URL(String(input)).pathname.endsWith("/v1/models")
              ? { data: [{ id: "vendor/last-good", output_modalities: ["text"] }] }
              : successCatalog(driver),
          )) as typeof fetch,
      );
      const lastGood = await getProviderCatalog(profile.id);
      expect(lastGood.models).toHaveLength(1);
      const attemptsBefore = providerAttemptCounts(directory);
      const observedMethods: string[] = [];
      const proxyFailure = (async (_input, init) => {
        observedMethods.push(init?.method ?? "");
        throw new OutboundProxyConfigurationError();
      }) as typeof fetch;

      let verificationError: unknown;
      try {
        await verifyProviderProfile(profile.id, proxyFailure);
      } catch (error) {
        verificationError = error;
      }
      expect(verificationError).toMatchObject({ code: "PROXY_CONFIGURATION" });
      expect(providerVerificationErrorMessage(verificationError))
        .toBe(keyProxyMessage);

      let catalogError: unknown;
      try {
        await syncProviderCatalog(profile.id, proxyFailure);
      } catch (error) {
        catalogError = error;
      }
      expect(catalogError).toMatchObject({ code: "PROXY_CONFIGURATION" });
      expect(providerCatalogSyncErrorMessage(catalogError, driver))
        .toBe(catalogProxyMessage);

      const afterFailure = await getProviderCatalog(profile.id);
      expect(afterFailure.models).toEqual(lastGood.models);
      expect(afterFailure.modelCount).toBe(lastGood.modelCount);
      expect(afterFailure.syncedAt).toBe(lastGood.syncedAt);
      expect(afterFailure.keyStatus).toBe("unknown");
      expect(afterFailure.errorCode).toBe("PROXY_CONFIGURATION");
      expect(observedMethods).toEqual(["GET", "GET"]);

      const store = new DatabaseSync(join(directory, "unboundry.sqlite"), {
        readOnly: true,
      });
      try {
        expect(store.prepare(`
          SELECT key_status FROM provider_profiles WHERE id = ?
        `).get(profile.id)).toEqual({ key_status: "unknown" });
        expect(generationProviderAttemptCounts(store)).toEqual(attemptsBefore);
        expect(store.prepare(`
          SELECT COUNT(*) AS count FROM generation_tasks
        `).get()).toEqual({ count: 0 });
      } finally {
        store.close();
      }
    }
  });
});

test("127直连私网地址仍是FORMAT且不计为已发出目录请求", async () => {
  await withTemporaryData("provider-private-format", async () => {
    for (const driver of [
      "multi-protocol-relay",
      "openai-compatible",
    ] as const) {
      const profile = await saveProviderProfile({
        apiKey: `private-${driver}-${randomUUID()}`,
        baseUrl: "https://127.0.0.1/v1",
        driver,
        label: `${driver} private destination`,
      });
      let fetchCalls = 0;
      const forbiddenFetcher = (async () => {
        fetchCalls += 1;
        throw new Error("private destination request must not run");
      }) as typeof fetch;

      let verificationError: unknown;
      try {
        await verifyProviderProfile(profile.id, forbiddenFetcher);
      } catch (error) {
        verificationError = error;
      }
      expect(verificationError).toMatchObject({ code: "FORMAT" });
      expect(providerVerificationErrorMessage(verificationError))
        .toBe("平台返回异常，暂时无法确认API Key是否有效");

      let catalogError: unknown;
      try {
        await syncProviderCatalog(profile.id, forbiddenFetcher);
      } catch (error) {
        catalogError = error;
      }
      expect(catalogError).toMatchObject({ code: "FORMAT" });
      expect(providerCatalogSyncErrorMessage(catalogError, driver))
        .toBe("平台返回格式异常，已保留上次同步结果");
      expect(fetchCalls).toBe(0);
      expect(await getProviderCatalog(profile.id)).toMatchObject({
        controlRequestCount: 0,
        errorCode: "FORMAT",
      });
    }
  });
});

test("平台连接页展示可执行的Key和目录代理提示", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4175").origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  const profile = {
    apiKeyMask: "••••safe",
    baseUrl: "https://proxy.relay.example.test/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "proxy-ui",
    keyStatus: "unknown",
    label: "代理配置测试站",
    modelCatalog: {
      checkedAt: "2026-08-04T09:00:00.000Z",
      configuredModelCount: 0,
      controlRequestCount: 0,
      credentialMode: "profile-api-key",
      description: "读取中转站当前Key可见模型。",
      endpointCount: 0,
      errorCode: "PROXY_CONFIGURATION",
      hasCredentials: false,
      keyStatus: "unknown",
      modelCount: 0,
      modelLabel: "当前Key可见模型",
      scope: "account",
      snapshotStale: true,
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsReadOnlyManagement: true,
      supportsSync: true,
      syncedAt: "2026-08-03T09:00:00.000Z",
    },
    status: "saved",
    updatedAt: "2026-08-04T09:00:00.000Z",
  };
  await page.route("**/api/admin/providers**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/proxy-ui/test")) {
      await route.fulfill({
        body: JSON.stringify({ error: keyProxyMessage, paidGenerationRequests: 0 }),
        contentType: "application/json",
        status: 400,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        paidProviderRequests: 0,
        profiles: [profile],
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: ["multi-protocol-relay"],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/admin/provider-catalog/proxy-ui/**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: catalogProxyMessage, paidGenerationRequests: 0 }),
      contentType: "application/json",
      status: 400,
    });
  });

  await page.goto("/admin/providers");
  const article = page.getByRole("article").filter({ hasText: "代理配置测试站" });
  await article.getByRole("button", { name: "检查连接" }).click();
  await expect(article.locator(".provider-test-feedback")).toHaveText(
    keyProxyMessage,
  );
  const catalog = page.getByTestId("provider-model-catalog-proxy-ui");
  await expect(catalog.locator(".provider-catalog-state-note")).toHaveText(
    catalogProxyMessage,
  );
  await catalog.getByRole("button", { name: "同步模型" }).click();
  await expect(catalog.locator(".provider-catalog-feedback")).toHaveText(
    catalogProxyMessage,
  );
  expect(externalRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
});
