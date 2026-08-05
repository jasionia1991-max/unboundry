import { expect, test } from "@playwright/test";

const checkedAt = "2026-08-03T12:00:00.000Z";

function catalog(
  overrides: Record<string, unknown>,
) {
  return {
    checkedAt,
    configuredModelCount: 0,
    controlRequestCount: 1,
    endpointCount: 0,
    errorCode: undefined,
    hasCredentials: true,
    keyStatus: "valid",
    modelCount: 0,
    snapshotStale: false,
    syncedAt: checkedAt,
    ...overrides,
  };
}

test("Provider model directories follow declared capabilities without paid requests", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  const catalogRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(request.url());
    }
  });

  const profiles = [{
    apiKeyMask: "••••ark1",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    driver: "volcengine-ark",
    hasApiKey: true,
    id: "catalog-ark",
    keyStatus: "valid",
    label: "Ark",
    modelCatalog: catalog({
      accessKeyIdMask: "••••ak01",
      configuredModelCount: 2,
      credentialMode: "separate",
      description: "读取火山方舟的官方模型和当前账号Endpoint。",
      endpointCount: 1,
      endpointLabel: "Endpoint",
      modelCount: 143,
      modelLabel: "官方模型",
      projectName: "default",
      scope: "account",
      support: "full",
      supported: true,
      supportsEndpoints: true,
      supportsImport: true,
      supportsSync: true,
    }),
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••or01",
    baseUrl: "https://openrouter.ai/api/v1",
    driver: "openrouter",
    hasApiKey: true,
    id: "catalog-openrouter",
    keyStatus: "valid",
    label: "OpenRouter",
    modelCatalog: catalog({
      credentialMode: "profile-api-key",
      description: "读取当前Key可见的OpenRouter模型和能力资料。",
      hasCredentials: false,
      modelCount: 2,
      modelLabel: "当前Key可见模型",
      scope: "account",
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsSync: true,
    }),
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••oa01",
    baseUrl: "https://compatible.example/v1",
    driver: "openai-compatible",
    hasApiKey: true,
    id: "catalog-compatible",
    keyStatus: "valid",
    label: "Compatible",
    modelCatalog: catalog({
      credentialMode: "profile-api-key",
      description: "读取该连接公开的基础模型列表。",
      errorCode: "PERMISSION",
      hasCredentials: false,
      keyStatus: "permission",
      modelCount: 1,
      modelLabel: "公共基础模型",
      scope: "public",
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsSync: true,
    }),
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••mu01",
    baseUrl: "https://api.mureka.ai",
    driver: "mureka",
    hasApiKey: true,
    id: "catalog-mureka",
    keyStatus: "valid",
    label: "Mureka",
    modelCatalog: catalog({
      checkedAt: undefined,
      configuredModelCount: 3,
      credentialMode: "none",
      description: "平台未提供可同步的账号模型列表。",
      hasCredentials: false,
      keyStatus: "unchecked",
      modelLabel: "项目支持模型",
      scope: "manual",
      support: "manual",
      supported: false,
      supportsEndpoints: false,
      supportsImport: false,
      supportsSync: false,
      syncedAt: undefined,
    }),
    status: "verified",
    updatedAt: checkedAt,
  }];

  await page.route("**/api/admin/providers", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        paidProviderRequests: 0,
        profiles,
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: [
          "mureka",
          "openai-compatible",
          "openrouter",
          "volcengine-ark",
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/admin/provider-catalog/**", async (route) => {
    const url = new URL(route.request().url());
    catalogRequests.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname.endsWith("/sync")) {
      await route.fulfill({
        body: JSON.stringify({
          catalog: profiles[1].modelCatalog,
          controlPlaneRequests: 1,
          message: "已同步2个当前Key可见模型。",
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
          message: "已添加1个模型到模型中心，当前保持停用。",
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
        endpoints: [],
        models: [{
          capability: "text",
          discoveryId: "openrouter:demo/model",
          displayName: "Demo Multimodal Model",
          metadata: {
            contextLength: 128000,
            inputModalities: ["text", "image"],
            outputModalities: ["text"],
            pricingSummary: "$0.10 / 1M input tokens",
            supportedParameters: ["temperature", "max_tokens"],
          },
          providerModelId: "demo/model",
          source: "openrouter-account-catalog",
          status: "available",
        }],
        paidGenerationRequests: 0,
        syncedAt: checkedAt,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/providers");

  const ark = page.getByTestId("provider-model-catalog-catalog-ark");
  await expect(ark).toContainText("官方模型143");
  await expect(ark).toContainText("Endpoint1");
  await expect(ark.getByRole("button", { name: "修改目录凭证" })).toBeVisible();

  const openRouter = page.getByTestId(
    "provider-model-catalog-catalog-openrouter",
  );
  await expect(openRouter).toContainText("当前Key可见模型2");
  await expect(openRouter).toContainText("使用当前连接已保存的API Key");
  await expect(
    openRouter.getByRole("button", { name: /配置目录凭证/ }),
  ).toHaveCount(0);
  await expect(openRouter.locator("dl")).not.toContainText("Endpoint");
  await openRouter.getByRole("button", { name: "查看发现模型" }).click();
  await expect(openRouter).toContainText("Demo Multimodal Model");
  await expect(openRouter).toContainText("输入：文字/图片");
  await expect(openRouter).toContainText("上下文：128,000");
  await expect(openRouter).toContainText("价格：$0.10 / 1M input tokens");
  const checkbox = openRouter.getByRole("checkbox", {
    name: /Demo Multimodal Model/,
  });
  await expect(checkbox).toHaveCSS("width", "16px");
  await expect(checkbox).toHaveCSS("height", "16px");
  await expect(openRouter.getByLabel("搜索发现模型")).toBeVisible();
  await expect(openRouter.getByLabel("筛选节点类型")).toBeVisible();
  const addModels = openRouter.getByRole("button", {
    name: "添加到模型中心（0）",
  });
  await expect(addModels).toBeDisabled();
  await checkbox.check();
  await expect(
    openRouter.getByRole("button", { name: "添加到模型中心（1）" }),
  ).toBeEnabled();

  const compatible = page.getByTestId(
    "provider-model-catalog-catalog-compatible",
  );
  await expect(compatible).toContainText("公共基础模型1");
  await expect(compatible).toContainText("凭证可用，读取权限不足");
  await expect(compatible).not.toContainText("Endpoint");

  const mureka = page.getByTestId("provider-model-catalog-catalog-mureka");
  await expect(mureka).toContainText(
    "平台未提供可同步模型目录；模型由管理员在模型中心配置。",
  );
  await expect(mureka).toContainText("本项目已配置：3 个");
  await expect(mureka.getByRole("button")).toHaveCount(0);

  for (const width of [902, 1135]) {
    await page.setViewportSize({ height: 917, width });
    for (const section of [ark, openRouter, compatible, mureka]) {
      await expect(section).toBeVisible();
      const overflow = await section.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(1);
  }

  expect(catalogRequests).toEqual([
    "GET /api/admin/provider-catalog/catalog-openrouter",
  ]);
  expect(externalRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
});

test("Provider catalog action bars stay anchored across providers and viewport widths", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL ?? "http://127.0.0.1:4173").origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  const catalogRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  const providers = [{
    apiKeyMask: "••••ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    driver: "volcengine-ark",
    hasApiKey: true,
    id: "action-row-ark",
    keyStatus: "valid",
    label: "Ark",
    modelCatalog: catalog({
      accessKeyIdMask: "••••ak",
      configuredModelCount: 2,
      credentialMode: "separate",
      description: "读取火山方舟官方模型和当前账号Endpoint。",
      endpointCount: 1,
      endpointLabel: "Endpoint",
      modelCount: 143,
      modelLabel: "官方模型",
      projectName: "default",
      scope: "account",
      support: "full",
      supported: true,
      supportsEndpoints: true,
      supportsImport: true,
      supportsSync: true,
    }),
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••router",
    baseUrl: "https://openrouter.ai/api/v1",
    driver: "openrouter",
    hasApiKey: true,
    id: "action-row-openrouter",
    keyStatus: "valid",
    label: "OpenRouter",
    modelCatalog: catalog({
      credentialMode: "profile-api-key",
      description: "读取当前Key可见的OpenRouter模型和能力资料。",
      modelCount: 337,
      modelLabel: "当前Key可见模型",
      scope: "account",
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsSync: true,
    }),
    status: "verified",
    updatedAt: checkedAt,
  }, {
    apiKeyMask: "••••relay",
    baseUrl: "https://relay.example.test/v1",
    driver: "multi-protocol-relay",
    hasApiKey: true,
    id: "action-row-relay",
    keyStatus: "valid",
    label: "多协议中转站",
    modelCatalog: catalog({
      credentialMode: "profile-api-key",
      description: "读取中转站当前Key可见模型。",
      modelCount: 3,
      modelLabel: "当前Key可见模型",
      scope: "account",
      snapshotStale: true,
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsReadOnlyManagement: true,
      supportsSync: true,
    }),
    status: "verified",
    updatedAt: checkedAt,
  }];

  await page.route("**/api/admin/providers", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        paidProviderRequests: 0,
        profiles: providers,
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: [
          "multi-protocol-relay",
          "openrouter",
          "volcengine-ark",
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/admin/provider-catalog/**", async (route) => {
    const url = new URL(route.request().url());
    catalogRequests.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname.endsWith("/sync")) {
      const provider = providers.find((candidate) =>
        url.pathname.includes(candidate.id)
      );
      await route.fulfill({
        body: JSON.stringify({
          catalog: provider?.modelCatalog,
          controlPlaneRequests: 1,
          message: "目录已同步，付费生成请求为0。",
          paidGenerationRequests: 0,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        endpoints: [],
        models: [{
          capability: "text",
          discoveryId: `${url.pathname}:model`,
          displayName: "Layout Fixture Model",
          metadata: {
            inputModalities: ["text"],
            outputModalities: ["text"],
            protocols: ["openai-chat"],
          },
          providerModelId: "fixture/layout-model",
          source: "fixture-account-catalog",
          status: "available",
        }],
        paidGenerationRequests: 0,
        syncedAt: checkedAt,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/providers");
  const sections = providers.map((provider) =>
    page.getByTestId(`provider-model-catalog-${provider.id}`)
  );
  for (const section of sections) {
    await section.getByRole("button", { name: "查看发现模型" }).click();
    await expect(section.getByRole("button", { name: "收起发现模型" }))
      .toBeVisible();
  }
  await sections[0].getByRole("button", { name: "同步模型" }).click();
  await expect(sections[0]).toContainText("目录已同步，付费生成请求为0。");

  for (const width of [1135, 961, 760, 560]) {
    await page.setViewportSize({ height: 917, width });
    for (const section of sections) {
      const geometry = await section.evaluate((element) => {
        const row = element.querySelector<HTMLElement>(
          ".provider-catalog-sync-row",
        )!;
        const actions = row.querySelector<HTMLElement>(":scope > div")!;
        const buttons = Array.from(
          actions.querySelectorAll<HTMLButtonElement>("button"),
        );
        const rowBox = row.getBoundingClientRect();
        const actionsBox = actions.getBoundingClientRect();
        const buttonBoxes = buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return {
            height: box.height,
            left: box.left,
            top: box.top,
            whiteSpace: getComputedStyle(button).whiteSpace,
            width: box.width,
          };
        });
        const fontSizes = new Set([
          getComputedStyle(row.querySelector(":scope > span")!).fontSize,
          ...buttons.map((button) => getComputedStyle(button).fontSize),
        ]);
        return {
          actions: {
            left: actionsBox.left,
            right: actionsBox.right,
            top: actionsBox.top,
            width: actionsBox.width,
          },
          buttons: buttonBoxes,
          fontSizes: Array.from(fontSizes),
          horizontalOverflow: row.scrollWidth - row.clientWidth,
          row: {
            left: rowBox.left,
            right: rowBox.right,
            top: rowBox.top,
            width: rowBox.width,
          },
        };
      });
      expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
      expect(geometry.fontSizes.every((size) => ["12px", "14px"].includes(size)))
        .toBe(true);
      expect(geometry.buttons.every((button) => button.whiteSpace === "nowrap"))
        .toBe(true);
      expect(Math.abs(geometry.buttons[0].top - geometry.buttons[1].top))
        .toBeLessThanOrEqual(1);
      if (width > 760) {
        expect(Math.abs(geometry.actions.right - geometry.row.right))
          .toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.actions.top - geometry.row.top))
          .toBeLessThanOrEqual(1);
      } else {
        expect(Math.abs(geometry.actions.left - geometry.row.left))
          .toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.actions.width - geometry.row.width))
          .toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.buttons[0].width - geometry.buttons[1].width))
          .toBeLessThanOrEqual(1);
      }
    }
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(1);
  }

  expect(catalogRequests).toEqual([
    "GET /api/admin/provider-catalog/action-row-ark",
    "GET /api/admin/provider-catalog/action-row-openrouter",
    "GET /api/admin/provider-catalog/action-row-relay",
    "POST /api/admin/provider-catalog/action-row-ark/sync",
    "GET /api/admin/provider-catalog/action-row-ark",
  ]);
  expect(externalRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
});

test("large discovered catalogs stay searchable with the selected action always above the list", async ({
  page,
}) => {
  const models = Array.from({ length: 337 }, (_, index) => {
    const capability = (["text", "image", "video", "audio"] as const)[
      index % 4
    ];
    return {
      capability,
      discoveryId: `openrouter:vendor/model-${index}`,
      displayName:
        index === 236
          ? "Target Commerce Model With A Deliberately Long Display Name"
          : `Catalog Model ${index}`,
      metadata: {
        contextLength: 128_000 + index,
        inputModalities: ["text", "image"],
        outputModalities: [capability === "text" ? "text" : capability],
        pricingSummary: "$0.10 / 1M input tokens",
        supportedParameters: ["temperature", "max_tokens"],
      },
      providerModelId:
        index === 236 ? "vendor/target-commerce-model" : `vendor/model-${index}`,
      source: "openrouter-account-catalog",
      status: "available",
    };
  });
  const profile = {
    apiKeyMask: "••••long",
    baseUrl: "https://openrouter.ai/api/v1",
    driver: "openrouter",
    hasApiKey: true,
    id: "catalog-large",
    keyStatus: "valid",
    label: "Large OpenRouter",
    modelCatalog: catalog({
      credentialMode: "profile-api-key",
      description: "读取当前Key可见的OpenRouter模型。",
      modelCount: models.length,
      modelLabel: "当前Key可见模型",
      scope: "account",
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsSync: true,
    }),
    status: "verified",
    updatedAt: checkedAt,
  };
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4173" && url.origin !== "http://127.0.0.1:4174") {
      externalRequests.push(request.url());
    }
  });
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
  await page.route("**/api/admin/provider-catalog/catalog-large", async (route) => {
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
  });

  await page.goto("/admin/providers");
  const section = page.getByTestId("provider-model-catalog-catalog-large");
  await section.getByRole("button", { name: "查看发现模型" }).click();
  await expect(section).toContainText("已选0个／共337个");
  await expect(section.locator(".provider-catalog-model-list > div")).toHaveCount(50);
  await expect(section.getByRole("navigation", { name: "发现模型分页" }))
    .toContainText("第1页／共7页");
  await section.getByRole("button", { name: "下一页目录" }).click();
  await expect(section.getByRole("navigation", { name: "发现模型分页" }))
    .toContainText("第2页／共7页");
  await expect(section.locator(".provider-catalog-model-list > div").first())
    .toContainText("Catalog Model 50");
  await section.getByLabel("搜索发现模型").fill("target-commerce");
  await expect(section).toContainText("找到1个");
  await expect(section.locator(".provider-catalog-model-list > div")).toHaveCount(1);
  const capabilityFilter = section.getByLabel("筛选节点类型");
  await capabilityFilter.click();
  await capabilityFilter.locator("..")
    .locator('[role="option"][data-value="text"]')
    .click();
  await expect(section.locator(".provider-catalog-model-list > div")).toHaveCount(1);
  const targetCheckbox = section.getByRole("checkbox", {
    name: /Target Commerce Model/,
  });
  await targetCheckbox.check();
  await expect(
    section.getByRole("button", { name: "添加到模型中心（1）" }),
  ).toBeInViewport();
  const rowFits = await section
    .locator(".provider-catalog-model-list > div")
    .evaluate((row) => row.scrollHeight <= row.clientHeight + 1);
  expect(rowFits).toBe(true);
  expect(externalRequests).toEqual([]);
});

test("saved Provider connections edit inside their own card and keep the existing key when blank", async ({
  page,
}) => {
  const profile = {
    apiKeyMask: "••••edit",
    baseUrl: "https://openrouter.ai/api/v1",
    driver: "openrouter",
    hasApiKey: true,
    id: "provider-inline-edit",
    keyStatus: "invalid",
    label: "Inline OpenRouter",
    modelCatalog: catalog({
      credentialMode: "profile-api-key",
      description: "读取当前Key可见的OpenRouter模型。",
      keyStatus: "invalid",
      modelLabel: "当前Key可见模型",
      scope: "account",
      support: "models",
      supported: true,
      supportsEndpoints: false,
      supportsImport: true,
      supportsSync: true,
      syncedAt: undefined,
    }),
    status: "saved",
    updatedAt: checkedAt,
  };
  let patchBody: Record<string, unknown> | undefined;
  await page.route("**/api/admin/providers**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "PATCH") {
      patchBody = route.request().postDataJSON() as Record<string, unknown>;
      profile.label = String(patchBody.label);
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
          supportedDrivers: ["openrouter"],
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/providers");
  const card = page.locator(".provider-profile-list article").first();
  await card.getByRole("button", { name: "更新Key" }).click();
  await expect(card.getByText("Key留空会保留原密钥")).toBeVisible();
  await card.getByLabel("Inline OpenRouter连接名称").fill("Updated OpenRouter");
  await card.getByRole("button", { name: "保存连接设置" }).click();
  await expect.poll(() => patchBody).toMatchObject({
    apiKey: "",
    baseUrl: "https://openrouter.ai/api/v1",
    driver: "openrouter",
    label: "Updated OpenRouter",
  });
  await expect(page.getByText("连接设置已加密保存")).toBeVisible();
  await expect(card.getByRole("button", { name: "更新Key" })).toBeVisible();
});

test("Provider catalog explains unchecked, invalid, and unknown states", async ({
  page,
}) => {
  const statuses = ["unchecked", "invalid", "unknown"] as const;
  await page.route("**/api/admin/providers", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        paidProviderRequests: 0,
        profiles: statuses.map((keyStatus) => ({
          apiKeyMask: `••••${keyStatus}`,
          baseUrl: "https://openrouter.ai/api/v1",
          driver: "openrouter",
          hasApiKey: true,
          id: `catalog-${keyStatus}`,
          keyStatus,
          label: `OpenRouter ${keyStatus}`,
          modelCatalog: catalog({
            checkedAt: keyStatus === "unchecked" ? undefined : checkedAt,
            credentialMode: "profile-api-key",
            description: "读取当前Key可见的模型。",
            hasCredentials: false,
            keyStatus,
            modelLabel: "当前Key可见模型",
            scope: "account",
            support: "models",
            supported: true,
            supportsEndpoints: false,
            supportsImport: true,
            supportsSync: true,
            syncedAt: undefined,
          }),
          status: keyStatus === "unchecked" ? "saved" : "verified",
          updatedAt: checkedAt,
        })),
        providerSecretsStoredInBrowser: false,
        realGenerationEnabled: false,
        supportedDrivers: ["openrouter"],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/providers");
  const unchecked = page.getByTestId("provider-model-catalog-catalog-unchecked");
  const invalid = page.getByTestId("provider-model-catalog-catalog-invalid");
  const unknown = page.getByTestId("provider-model-catalog-catalog-unknown");
  await expect(unchecked).toContainText("目录尚未检查");
  await expect(unchecked).toContainText("同步前不会改变模型中心");
  await expect(invalid).toContainText("Key已失效");
  await expect(invalid).toContainText("请修改连接后重新检查");
  await expect(unknown).toContainText("目录状态暂时无法确认");
  await expect(unknown).toContainText("已保留上次同步结果");
});
