import { expect, test } from "@playwright/test";

const checkedAt = "2026-08-03T14:30:00.000Z";

const emptySchema = {
  fields: [],
  referenceInputs: { audio: 0, image: 0, video: 0 },
  referencePolicy: { allowedCombinations: [], roles: {} },
  schemaVersion: 2,
};

function relayCatalog() {
  return {
    checkedAt,
    configuredModelCount: 2,
    controlRequestCount: 1,
    credentialMode: "profile-api-key",
    description: "读取中转站当前Key可见模型。",
    endpointCount: 0,
    hasCredentials: false,
    keyStatus: "valid",
    modelCount: 3,
    modelLabel: "当前Key可见模型",
    scope: "account",
    snapshotStale: false,
    support: "models",
    supported: true,
    supportsEndpoints: false,
    supportsImport: true,
    supportsReadOnlyManagement: true,
    supportsSync: true,
    syncedAt: checkedAt,
  };
}

test("多协议中转站在Provider页面支持明确协议、批量导入和可选只读资料", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  let importBody: Record<string, unknown> | undefined;
  let commerceProtocols = ["openai-chat", "openai-responses"];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  const profile = {
    apiKeyMask: "••••relay",
    baseUrl: "https://relay.example.test/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "relay-ui",
    keyStatus: "valid",
    label: "业务中转站",
    lastCheckedAt: checkedAt,
    modelCatalog: relayCatalog(),
    status: "verified",
    updatedAt: checkedAt,
  };
  await page.route("**/api/admin/providers**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "PATCH") {
      await route.fulfill({
        body: JSON.stringify({ profile }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/admin/providers") {
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
      return;
    }
    await route.continue();
  });
  await page.route("**/api/admin/provider-catalog/relay-ui**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/sync")) {
      commerceProtocols = ["openai-chat"];
      await route.fulfill({
        body: JSON.stringify({
          catalog: relayCatalog(),
          controlPlaneRequests: 1,
          message: "模型目录已同步，付费生成请求为0。",
          paidGenerationRequests: 0,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/readonly")) {
      await route.fulfill({
        body: JSON.stringify({
          available: true,
          paidGenerationRequests: 0,
          providerReadOnlyRequests: 0,
          resources: {
            balance: { supported: true },
            usage: { supported: true },
          },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/readonly/balance")) {
      await route.fulfill({
        body: JSON.stringify({
          available: true,
          checkedAt,
          paidGenerationRequests: 0,
          parsed: true,
          providerReadOnlyRequests: 1,
          resource: "balance",
          summary: { currency: "USD", remaining: "12.50" },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/readonly/usage")) {
      await route.fulfill({
        body: JSON.stringify({
          available: true,
          checkedAt,
          paidGenerationRequests: 0,
          parsed: true,
          providerReadOnlyRequests: 1,
          resource: "usage",
          summary: { requests: 24 },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/import")) {
      importBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        body: JSON.stringify({ imported: 1, skipped: 0 }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        endpoints: [],
        models: [
          {
            capability: "text",
            discoveryId: "relay:commerce-text",
            displayName:
              "Commerce Assistant With A Deliberately Long Third Party Display Name",
            metadata: {
              inputModalities: ["text"],
              modelType: "chat",
              pricingHint: "$0.20 / 1M tokens",
              protocols: commerceProtocols,
            },
            providerModelId: "vendor/commerce-assistant-with-a-long-model-id",
            source: "relay-account-catalog",
            status: "available",
          },
          {
            capability: "image",
            discoveryId: "relay:image-pro",
            displayName: "Image Pro",
            metadata: { modelType: "image", protocols: ["gpt-image"] },
            providerModelId: "vendor/image-pro",
            source: "relay-account-catalog",
            status: "available",
          },
          {
            capability: "video",
            discoveryId: "relay:video-pro",
            displayName: "Video Pro",
            metadata: { modelType: "video", protocols: ["media-generate"] },
            providerModelId: "vendor/video-pro",
            source: "relay-account-catalog",
            status: "available",
          },
        ],
        paidGenerationRequests: 0,
        syncedAt: checkedAt,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/providers");
  await expect(page.getByRole("button", { name: "多协议中转站" })).toBeVisible();
  const profileCard = page.locator(".provider-profile-list article").first();
  await expect(profileCard).toContainText("第三方身份第三方中转站");
  await expect(profileCard).toContainText("Key状态Key有效");
  await expect(profileCard).toContainText("目录状态目录可读取");
  await expect(profileCard).toContainText("模型数量3");
  await expect(profileCard).toContainText("上次检查");
  await profileCard.getByRole("button", { name: "修改" }).click();
  await expect(profileCard.getByLabel("业务中转站接口地址")).toBeEditable();
  await profileCard.getByRole("button", { name: "取消" }).click();

  const readOnly = page.getByTestId("provider-relay-readonly-relay-ui");
  await expect(readOnly.locator(".provider-relay-readonly-cards")).toHaveCount(0);
  await readOnly.getByRole("button", { name: "读取余额/用量" }).click();
  await expect(readOnly.locator(".provider-relay-readonly-cards")).toContainText(
    "remaining：12.50",
  );
  await expect(readOnly.locator(".provider-relay-readonly-cards")).toContainText(
    "requests：24",
  );

  const catalog = page.getByTestId("provider-model-catalog-relay-ui");
  await catalog.getByRole("button", { name: "查看发现模型" }).click();
  await expect(catalog.getByLabel("搜索发现模型")).toBeVisible();
  await expect(catalog.getByLabel("筛选节点类型")).toBeVisible();
  await catalog.getByLabel("筛选调用协议").selectOption("openai-chat");
  await expect(catalog.locator(".provider-catalog-model-list > div")).toHaveCount(1);
  await expect(
    catalog.locator("strong[title^='Commerce Assistant']"),
  ).toBeVisible();
  const checkbox = catalog.getByRole("checkbox", { name: /Commerce Assistant/ });
  await expect(checkbox).toHaveCSS("width", "16px");
  await expect(checkbox).toHaveCSS("height", "16px");
  await checkbox.check();
  await catalog
    .getByLabel(/Commerce Assistant.*调用协议/)
    .selectOption("openai-responses");
  const bulkBar = catalog.locator(".provider-catalog-bulk-bar");
  await expect(bulkBar).toContainText("已选1个／共3个");
  await expect(bulkBar).toHaveCSS("position", "sticky");
  await catalog.getByRole("button", { name: "同步模型" }).click();
  await expect(
    catalog.getByLabel(/Commerce Assistant.*调用协议/),
  ).toHaveValue("");
  await expect(catalog).toContainText("需要选择当前目录与节点类型兼容的调用协议");
  await expect(
    bulkBar.getByRole("button", { name: "添加到模型中心（1）" }),
  ).toBeDisabled();
  await catalog
    .getByLabel(/Commerce Assistant.*调用协议/)
    .selectOption("openai-chat");
  await bulkBar.getByRole("button", { name: "添加到模型中心（1）" }).click();
  await expect.poll(() => importBody).toEqual({
    models: [{ discoveryId: "relay:commerce-text", providerProtocol: "openai-chat" }],
  });

  for (const width of [902, 760]) {
    await page.setViewportSize({ height: 917, width });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  expect(externalRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
});

test("待识别目录模型可单独查看并在手动定类后进入对应分类", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
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
    apiKeyMask: "••••unknown",
    baseUrl: "https://relay.example.test/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "relay-unknown-filter",
    keyStatus: "valid",
    label: "待识别目录",
    modelCatalog: { ...relayCatalog(), modelCount: 2 },
    status: "verified",
    updatedAt: checkedAt,
  };
  await page.route("**/api/admin/providers", async (route) => {
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
  await page.route(
    "**/api/admin/provider-catalog/relay-unknown-filter",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          endpoints: [],
          models: [
            {
              capability: "unknown",
              discoveryId: "relay:opaque-model",
              displayName: "Opaque Model",
              providerModelId: "vendor/opaque-model",
              source: "multi-protocol-relay-account-catalog",
              status: "available",
            },
            {
              capability: "image",
              discoveryId: "relay:image-model",
              displayName: "Known Image Model",
              providerModelId: "vendor/image-model",
              source: "multi-protocol-relay-account-catalog",
              status: "available",
            },
          ],
          paidGenerationRequests: 0,
          syncedAt: checkedAt,
        }),
        contentType: "application/json",
        status: 200,
      });
    },
  );

  await page.goto("/admin/providers");
  const catalog = page.getByTestId(
    "provider-model-catalog-relay-unknown-filter",
  );
  await catalog.getByRole("button", { name: "查看发现模型" }).click();
  const typeFilter = catalog.getByLabel("筛选节点类型");
  await expect(typeFilter.locator('option[value="unknown"]')).toHaveText(
    "待识别",
  );
  await typeFilter.selectOption("unknown");
  await expect(catalog.locator(".provider-catalog-model-list > div"))
    .toHaveCount(1);
  await expect(catalog).toContainText("Opaque Model");
  await catalog.getByLabel("Opaque Model节点类型").selectOption("image");
  await expect(catalog).toContainText("没有符合当前搜索和类型条件的模型");
  await typeFilter.selectOption("image");
  await expect(catalog.locator(".provider-catalog-model-list > div"))
    .toHaveCount(2);
  await expect(catalog).toContainText("Opaque Model");
  await expect(catalog).toContainText("Known Image Model");

  expect(externalRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
});

test("中转目录明确显示组合来源、类型统计、兼容回退和格式异常", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  const profiles = [{
    apiKeyMask: "••••combined",
    baseUrl: "https://combined.relay.example/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "relay-combined-catalog",
    keyStatus: "valid",
    label: "完整组合目录中转站",
    modelCatalog: {
      ...relayCatalog(),
      capabilityCounts: {
        audio: 7,
        image: 17,
        text: 55,
        unknown: 0,
        video: 50,
      },
      catalogSource: "enhanced+basic",
      modelCount: 129,
      rejectedModelCount: 0,
      reportedModelCount: 129,
    },
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••full",
    baseUrl: "https://full.relay.example/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "relay-full-catalog",
    keyStatus: "valid",
    label: "全量目录中转站",
    modelCatalog: {
      ...relayCatalog(),
      capabilityCounts: {
        audio: 7,
        image: 17,
        text: 27,
        unknown: 0,
        video: 50,
      },
      catalogSource: "enhanced",
      modelCount: 101,
      rejectedModelCount: 0,
      reportedModelCount: 101,
    },
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••basic",
    baseUrl: "https://basic.relay.example/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "relay-basic-fallback",
    keyStatus: "valid",
    label: "兼容目录中转站",
    modelCatalog: {
      ...relayCatalog(),
      capabilityCounts: {
        audio: 0,
        image: 0,
        text: 55,
        unknown: 0,
        video: 0,
      },
      catalogSource: "basic-fallback",
      fallbackReason: "NOT_SUPPORTED",
      modelCount: 55,
      rejectedModelCount: 0,
      reportedModelCount: 55,
    },
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••format",
    baseUrl: "https://format.relay.example/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "relay-format-snapshot",
    keyStatus: "unknown",
    label: "保留目录中转站",
    modelCatalog: {
      ...relayCatalog(),
      capabilityCounts: {
        audio: 7,
        image: 17,
        text: 55,
        unknown: 0,
        video: 50,
      },
      catalogSource: "enhanced",
      errorCode: "FORMAT",
      keyStatus: "unknown",
      modelCount: 129,
      rejectedModelCount: 0,
      reportedModelCount: 129,
      snapshotStale: true,
    },
    status: "verified",
    updatedAt: checkedAt,
  }];

  await page.route("**/api/admin/providers", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        paidProviderRequests: 0,
        profiles,
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: ["multi-protocol-relay"],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/providers");

  const combined = page.getByTestId(
    "provider-model-catalog-relay-combined-catalog",
  );
  await expect(combined).toContainText("当前Key可见模型129");
  await expect(combined).toContainText("目录来源：完整组合目录");
  await expect(combined).toContainText("合并后：129 个");
  await expect(combined).not.toContainText("平台报告：129 个");
  await expect(combined).toContainText("已保存：129 个");
  await expect(combined).toContainText(
    "增强目录与兼容目录已只读获取并去重合并",
  );
  const combinedCounts = combined.getByLabel("模型类型统计");
  await expect(combinedCounts).toContainText("文字55");
  await expect(combinedCounts).toContainText("图片17");
  await expect(combinedCounts).toContainText("视频50");
  await expect(combinedCounts).toContainText("音频7");
  await expect(combined).not.toContainText("数量尚未完全对齐");

  const full = page.getByTestId("provider-model-catalog-relay-full-catalog");
  await expect(full).toContainText("当前Key可见模型101");
  await expect(full).toContainText("目录来源：全量增强目录");
  await expect(full).toContainText("平台报告：101 个");
  const fullCounts = full.getByLabel("模型类型统计");
  await expect(fullCounts).toContainText("文字27");
  await expect(fullCounts).toContainText("图片17");
  await expect(fullCounts).toContainText("视频50");
  await expect(fullCounts).toContainText("音频7");
  await expect(full).not.toContainText("仅显示聊天模型");

  const fallback = page.getByTestId(
    "provider-model-catalog-relay-basic-fallback",
  );
  await expect(fallback).toContainText(
    "目录来源：兼容目录（仅聊天模型）",
  );
  await expect(fallback).toContainText(
    "平台不支持全量增强目录，当前使用兼容目录，仅显示聊天模型。",
  );
  await expect(fallback.getByLabel("模型类型统计")).toContainText(
    "文字55图片0视频0音频0",
  );

  const format = page.getByTestId(
    "provider-model-catalog-relay-format-snapshot",
  );
  await expect(format).toContainText("保留快照来源：全量增强目录");
  await expect(format).toContainText(
    "平台返回格式异常，已保留上次同步结果。",
  );

  for (const width of [902, 560]) {
    await page.setViewportSize({ height: 917, width });
    for (const section of [combined, full, fallback, format]) {
      const diagnostics = section.locator(".provider-catalog-diagnostics");
      await expect(diagnostics).toBeVisible();
      const geometry = await diagnostics.evaluate((element) => ({
        fontSizes: Array.from(element.querySelectorAll<HTMLElement>("*"))
          .map((candidate) => getComputedStyle(candidate).fontSize),
        overflow: element.scrollWidth - element.clientWidth,
      }));
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(
        geometry.fontSizes.every((size) => ["12px", "14px"].includes(size)),
      ).toBe(true);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }

  expect(externalRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
});

test("目录批量选择在第100个时明确限制本次添加", async ({
  page,
}) => {
  const models = Array.from({ length: 101 }, (_, index) => ({
    capability: "text",
    discoveryId: `openrouter:limit-${index}`,
    displayName: `Limit Model ${index}`,
    metadata: { outputModalities: ["text"] },
    providerModelId: `vendor/limit-${index}`,
    source: "openrouter-account-catalog",
    status: "available",
  }));
  const profile = {
    apiKeyMask: "••••limit",
    baseUrl: "https://openrouter.ai/api/v1",
    driver: "openrouter",
    hasApiKey: true,
    id: "catalog-selection-limit",
    keyStatus: "valid",
    label: "Selection Limit",
    modelCatalog: {
      ...relayCatalog(),
      modelCount: models.length,
      supportsReadOnlyManagement: false,
    },
    status: "verified",
    updatedAt: checkedAt,
  };
  await page.route("**/api/admin/providers", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        paidProviderRequests: 0,
        profiles: [profile],
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: ["openrouter"],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(
    "**/api/admin/provider-catalog/catalog-selection-limit",
    async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          endpoints: [],
          models,
          paidGenerationRequests: 0,
          syncedAt: checkedAt,
        }),
        contentType: "application/json",
        status: 200,
      });
    },
  );

  await page.goto("/admin/providers");
  const catalog = page.getByTestId(
    "provider-model-catalog-catalog-selection-limit",
  );
  await catalog.getByRole("button", { name: "查看发现模型" }).click();
  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    await catalog.getByRole("checkbox").evaluateAll((checkboxes) => {
      for (const checkbox of checkboxes) {
        (checkbox as HTMLInputElement).click();
      }
    });
    if (pageNumber === 1) {
      await catalog.getByRole("button", { name: "下一页目录" }).click();
    }
  }
  await expect(catalog).toContainText("已选100个／共101个");
  await expect(catalog).toContainText("单次最多选择 100 个模型");
  await catalog.getByRole("button", { name: "下一页目录" }).click();
  await expect(catalog.getByRole("checkbox", { name: /Limit Model 100/ }))
    .toBeDisabled();
  await expect(
    catalog.getByRole("button", { name: "添加到模型中心（100）" }),
  ).toBeEnabled();
});

test("模型中心对中转模型必须明确协议，并且只有可删除模型显示永久删除", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  let createBody: Record<string, unknown> | undefined;
  let patchBody: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  const models = [
    {
      archived: false,
      canDelete: false,
      capability: "text",
      costCurrency: "USD",
      deleteBlockedReason: "已被画布引用，只能停用或归档",
      displayName: "Protected Relay Text",
      enabled: false,
      everPublished: true,
      id: "relay-protected",
      isDefault: false,
      maxCostMicrounits: 0,
      parameterSchema: emptySchema,
      providerConnected: true,
      providerDriver: "multi-protocol-relay",
      providerModelId: "vendor/text-pro",
      providerName: "业务中转站",
      providerProfileId: "relay-model-provider",
      providerProtocol: "openai-responses",
      references: { activeTasks: 0, canvasDocuments: 1, tasks: 0 },
      sortOrder: 100,
      status: "disabled",
    },
    {
      archived: true,
      canDelete: true,
      capability: "image",
      costCurrency: "USD",
      displayName: "Unused Relay Draft",
      enabled: false,
      everPublished: false,
      id: "relay-unused",
      isDefault: false,
      maxCostMicrounits: 0,
      parameterSchema: emptySchema,
      providerConnected: true,
      providerDriver: "multi-protocol-relay",
      providerModelId: "vendor/image-draft",
      providerName: "业务中转站",
      providerProfileId: "relay-model-provider",
      providerProtocol: "gpt-image",
      references: { activeTasks: 0, canvasDocuments: 0, tasks: 0 },
      sortOrder: 100,
      status: "draft",
    },
  ];
  await page.route("**/api/admin/models**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/admin/models") {
      await route.fulfill({
        body: JSON.stringify({
          models,
          providers: [{
            displayName: "业务中转站",
            driver: "multi-protocol-relay",
            id: "relay-model-provider",
            status: "enabled",
          }],
          submissionEnabled: false,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/admin/models") {
      createBody = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        body: JSON.stringify({ model: models[0], paidProviderRequests: 0 }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (request.method() === "PATCH") {
      patchBody = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        body: JSON.stringify({ model: models[0], paidProviderRequests: 0 }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({ status: 200, body: JSON.stringify({ paidProviderRequests: 0 }) });
  });

  await page.goto("/admin/models");
  const createButton = page.getByRole("button", { name: "保存模型" });
  await page.getByPlaceholder("用户看到的模型名称").fill("新图片模型");
  await page.getByPlaceholder("内部模型编号").fill("vendor/new-image");
  await expect(createButton).toBeDisabled();
  await page.getByLabel("调用协议", { exact: true }).selectOption("gpt-image");
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect.poll(() => createBody).toMatchObject({
    capability: "image",
    providerProfileId: "relay-model-provider",
    providerProtocol: "gpt-image",
  });

  const protectedModel = page.locator(".model-list article").filter({
    hasText: "Protected Relay Text",
  });
  await expect(protectedModel).toContainText("调用协议：OpenAI Responses");
  await expect(protectedModel).toContainText(
    "删除保护：已被画布引用，只能停用或归档",
  );
  await expect(protectedModel.getByRole("button", { name: "永久删除" })).toHaveCount(0);
  await protectedModel.getByRole("button", { name: "参数设置" }).click();
  await protectedModel
    .getByLabel("Protected Relay Text调用协议")
    .selectOption("openai-chat");
  await protectedModel.getByRole("button", { name: "保存参数设置" }).click();
  await expect.poll(() => patchBody).toMatchObject({
    providerProfileId: "relay-model-provider",
    providerProtocol: "openai-chat",
  });

  await page.getByRole("button", { name: "显示归档（1）" }).click();
  const deletable = page.locator(".model-list article").filter({
    hasText: "Unused Relay Draft",
  });
  await expect(deletable.getByRole("button", { name: "永久删除" })).toBeVisible();
  expect(externalRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
});
