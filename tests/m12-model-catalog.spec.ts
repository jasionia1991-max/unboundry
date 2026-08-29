import { spawn, type ChildProcess } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import {
  bootstrapPublishedModelContracts,
  modelReleaseBootstrapActorUserId,
} from "../server/modelReleaseBootstrap";
import type {
  ModelParameterField,
  ModelParameterSchema,
  ModelReferenceInputs,
} from "../types/modelParameters";

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
  throw new Error("Model catalog test server did not start");
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

test("only administrators manage models while users receive a safe published catalog", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-models-"));
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory);
    expect((await request("/api/models")).status).toBe(401);

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

    const seeded = await request("/api/admin/models", {
      cookie: adminCookie,
    });
    expect(seeded.status).toBe(200);
    expect((await seeded.json()).models).toHaveLength(0);

    const arkProviderResponse = await request("/api/admin/providers", {
      body: JSON.stringify({
        apiKey: "test-ark-key-12345",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: "Test Ark",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(arkProviderResponse.status).toBe(201);
    const arkProvider = (await arkProviderResponse.json()).profile as { id: string };
    const imageProviderResponse = await request("/api/admin/providers", {
      body: JSON.stringify({
        apiKey: "test-openrouter-key-12345",
        baseUrl: "https://openrouter.ai/api/v1",
        driver: "openrouter",
        label: "Test OpenRouter",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(imageProviderResponse.status).toBe(201);
    const imageProvider = (await imageProviderResponse.json()).profile as {
      id: string;
    };
    const providerStatusBefore = await (
      await request("/api/generation-tasks/status", { cookie: adminCookie })
    ).json() as { paidProviderRequests: number };
    expect(providerStatusBefore.paidProviderRequests).toBe(0);

    const seedanceResponse = await request("/api/admin/models", {
      body: JSON.stringify({
        capability: "video",
        displayName: "Seedance Constraint Guard",
        isDefault: false,
        maxCostMicrounits: 0,
        providerModelId: "doubao-seedance-2-0-mini-260615",
        providerProfileId: arkProvider.id,
        sortOrder: 4,
        status: "draft",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(seedanceResponse.status).toBe(201);
    const seedance = (await seedanceResponse.json()).model as {
      id: string;
      parameterSchema: ModelParameterSchema;
    };

    const withoutReferencePolicy = structuredClone(seedance.parameterSchema);
    withoutReferencePolicy.referencePolicy = undefined;
    expect((await request(`/api/admin/models/${seedance.id}`, {
      body: JSON.stringify({ parameterSchema: withoutReferencePolicy }),
      cookie: adminCookie,
      method: "PATCH",
    })).status).toBe(400);

    const withoutInputPolicy = structuredClone(seedance.parameterSchema);
    withoutInputPolicy.inputPolicy = undefined;
    expect((await request(`/api/admin/models/${seedance.id}`, {
      body: JSON.stringify({ parameterSchema: withoutInputPolicy }),
      cookie: adminCookie,
      method: "PATCH",
    })).status).toBe(400);

    const withoutRolePolicies = structuredClone(seedance.parameterSchema);
    withoutRolePolicies.inputPolicy!.rolePolicies = undefined;
    expect((await request(`/api/admin/models/${seedance.id}`, {
      body: JSON.stringify({ parameterSchema: withoutRolePolicies }),
      cookie: adminCookie,
      method: "PATCH",
    })).status).toBe(400);

    const relaxedPrompt = structuredClone(seedance.parameterSchema);
    relaxedPrompt.inputPolicy!.promptPolicy = "own-or-upstream-text";
    expect((await request(`/api/admin/models/${seedance.id}`, {
      body: JSON.stringify({ parameterSchema: relaxedPrompt }),
      cookie: adminCookie,
      method: "PATCH",
    })).status).toBe(400);

    const narrowed = structuredClone(seedance.parameterSchema);
    narrowed.inputPolicy!.roles!.image = narrowed.inputPolicy!.roles!.image
      ?.filter((role) => role !== "subject");
    const narrowedMultimodal = narrowed.inputPolicy!.rolePolicies!
      .find((policy) => policy.enabledWhen?.[0]?.value === "multimodal")!;
    narrowedMultimodal.roles.image = narrowedMultimodal.roles.image
      ?.filter((role) => role !== "subject");
    narrowedMultimodal.limits = narrowedMultimodal.limits
      ?.filter((limit) => !(limit.kind === "image" && limit.role === "subject"));
    expect((await request(`/api/admin/models/${seedance.id}`, {
      body: JSON.stringify({ parameterSchema: narrowed }),
      cookie: adminCookie,
      method: "PATCH",
    })).status).toBe(200);

    // Drafts may be narrowed while they are being edited, but publication now
    // requires the exact registered execution contract. Restore that contract
    // before publishing; the direct database mutation below remains the legacy
    // stored-schema recovery case this test is intended to exercise.
    expect((await request(`/api/admin/models/${seedance.id}`, {
      body: JSON.stringify({ parameterSchema: seedance.parameterSchema }),
      cookie: adminCookie,
      method: "PATCH",
    })).status).toBe(200);

    expect((await request(`/api/admin/models/${seedance.id}`, {
      body: JSON.stringify({ status: "published" }),
      cookie: adminCookie,
      method: "PATCH",
    })).status).toBe(200);
    const contractBootstrap = openAppDatabase(dataDirectory);
    try {
      bootstrapPublishedModelContracts(
        contractBootstrap,
        modelReleaseBootstrapActorUserId(contractBootstrap),
      );
    } finally {
      contractBootstrap.close();
    }
    const weakAssetId = "seedance-constraint-guard-image";
    const weakAsset = await readFile(resolve(
      process.cwd(),
      "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ));
    expect((await request(`/api/assets/${weakAssetId}`, {
      body: weakAsset,
      cookie: adminCookie,
      headers: {
        "Content-Type": "image/png",
        "X-File-Name": "constraint-guard.png",
      },
      method: "POST",
    })).status).toBe(201);
    const weakCanvasId = "seedance-stored-policy-guard";
    const weakCanvas = await request(`/api/canvas/${weakCanvasId}`, {
      body: JSON.stringify({
        edges: [{
          data: { inputOrder: 1, inputRole: "reference-image" },
          id: "weak-image-edge",
          source: "weak-image-source",
          target: "weak-video-target",
        }],
        nodes: [
          {
            data: {
              assetId: weakAssetId,
              imageSrc: `/api/assets/${weakAssetId}`,
              title: "异常存量测试图",
            },
            id: "weak-image-source",
            type: "image",
          },
          {
            data: {
              title: "异常存量Video",
              videoPrompt: "必须使用安全Provider底线",
            },
            id: "weak-video-target",
            type: "video",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      cookie: adminCookie,
      method: "PUT",
    });
    expect(weakCanvas.status).toBe(200);
    const weakCanvasRevision = (await weakCanvas.json()).revision as number;
    const weakenedStoredSchema = structuredClone(seedance.parameterSchema);
    weakenedStoredSchema.referencePolicy = undefined;
    weakenedStoredSchema.inputPolicy = undefined;
    const directDatabase = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
    try {
      directDatabase.prepare(`
        UPDATE model_profiles
        SET default_parameters = ?
        WHERE id = ?
      `).run(JSON.stringify(weakenedStoredSchema), seedance.id);
    } finally {
      directDatabase.close();
    }

    const invalidExistingHistoryBootstrap = openAppDatabase(dataDirectory);
    try {
      expect(() => bootstrapPublishedModelContracts(
        invalidExistingHistoryBootstrap,
        modelReleaseBootstrapActorUserId(invalidExistingHistoryBootstrap),
      )).toThrow();
    } finally {
      invalidExistingHistoryBootstrap.close();
    }

    const guardedCatalog = await (
      await request("/api/admin/models", { cookie: adminCookie })
    ).json() as { models: Array<{ id: string; parameterSchema: ModelParameterSchema }> };
    const guardedSeedance = guardedCatalog.models.find((model) => model.id === seedance.id);
    expect(guardedSeedance?.parameterSchema.referencePolicy?.modes).toHaveProperty("text");
    expect(guardedSeedance?.parameterSchema.inputPolicy?.rolePolicies).toHaveLength(3);

    const guardedPreflight = await request("/api/generation-tasks/preflight", {
      body: JSON.stringify({
        canvasId: weakCanvasId,
        canvasRevision: weakCanvasRevision,
        idempotencyKey: "seedance-stored-policy-guard-request",
        inputSchemaVersion: 1,
        kind: "video",
        model: seedance.id,
        nodeId: "weak-video-target",
        ownPrompt: "必须使用安全Provider底线",
        parameters: { inputMode: "text" },
        prompt: "不信任客户端Prompt",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(guardedPreflight.status).toBe(200);
    const guardedPreflightBody = await guardedPreflight.json() as {
      canSubmit: boolean;
      parameters: Record<string, unknown>;
      problems: Array<{ code: string }>;
      providerRequests: number;
      snapshot: Array<{ role: string }>;
    };
    expect(guardedPreflightBody.canSubmit).toBe(true);
    expect(guardedPreflightBody.problems).toEqual([]);
    expect(guardedPreflightBody.parameters.inputMode).toBe("multimodal");
    expect(guardedPreflightBody.snapshot.map((item) => item.role))
      .toEqual(["reference-image"]);
    expect(guardedPreflightBody.providerRequests).toBe(0);

    const providerStatusAfter = await (
      await request("/api/generation-tasks/status", { cookie: adminCookie })
    ).json() as { paidProviderRequests: number };
    expect(providerStatusAfter.paidProviderRequests).toBe(0);

    const wrongDoubaoProvider = await request("/api/admin/models", {
      body: JSON.stringify({
        capability: "text",
        displayName: "Wrong Doubao",
        isDefault: false,
        providerModelId: "doubao-seed-2-0-lite-260428",
        sortOrder: 5,
        status: "draft",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(wrongDoubaoProvider.status).toBe(400);

    const correctDoubaoProvider = await request("/api/admin/models", {
      body: JSON.stringify({
        capability: "text",
        displayName: "Correct Doubao",
        isDefault: false,
        providerModelId: "doubao-seed-2-0-lite-260428",
        providerProfileId: arkProvider.id,
        sortOrder: 6,
        status: "draft",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(correctDoubaoProvider.status).toBe(201);
    const correctDoubao = (await correctDoubaoProvider.json()).model as {
      id: string;
      parameterSchema: { fields: Array<{ key: string }> };
    };
    expect(correctDoubao.parameterSchema.fields.map((field) => field.key)).toEqual([
      "inputMode",
      "thinkingLevel",
      "responseFormat",
      "outputCount",
    ]);
    const rejectedRebind = await request(`/api/admin/models/${correctDoubao.id}`, {
      body: JSON.stringify({ providerProfileId: "provider-unconfigured" }),
      cookie: adminCookie,
      method: "PATCH",
    });
    expect(rejectedRebind.status).toBe(409);
    expect(await rejectedRebind.json()).toMatchObject({
      code: "MODEL_PROVIDER_REBIND_FORBIDDEN",
    });

    const created = await request("/api/admin/models", {
      body: JSON.stringify({
        capability: "image",
        displayName: "Private Image Model",
        isDefault: false,
        providerModelId: "openai/gpt-image-2",
        providerProfileId: imageProvider.id,
        sortOrder: 20,
        status: "draft",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(created.status).toBe(201);
    const model = (await created.json()).model as { id: string };

    const beforePublish = await (
      await request("/api/models?capability=image", { cookie: adminCookie })
    ).json();
    expect(
      beforePublish.models.map((item: { displayName: string }) => item.displayName),
    ).not.toContain("Private Image Model");

    const privateContract = await request(
      `/api/admin/models/${model.id}/contract`,
      { cookie: adminCookie },
    );
    expect(privateContract.status).toBe(200);
    const { suggestedDocument: privateDocument } = await privateContract.json() as {
      suggestedDocument: Record<string, unknown>;
    };
    expect((await request(`/api/admin/models/${model.id}/contract/draft`, {
      body: JSON.stringify({
        document: privateDocument,
        expectedDraftVersion: 0,
      }),
      cookie: adminCookie,
      method: "POST",
    })).status).toBe(200);
    expect((await request(`/api/admin/models/${model.id}/contract/publish`, {
      body: JSON.stringify({ expectedDraftVersion: 1 }),
      cookie: adminCookie,
      method: "POST",
    })).status).toBe(200);

    expect(
      (
        await request(`/api/admin/models/${model.id}`, {
          body: JSON.stringify({ isDefault: true, status: "published" }),
          cookie: adminCookie,
          method: "PATCH",
        })
      ).status,
    ).toBe(200);

    const account = await request("/api/admin/users", {
      body: JSON.stringify({
        displayName: "Ordinary",
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(account.status).toBe(201);
    const login = await request("/api/auth/login", {
      body: JSON.stringify({
        loginName: "ordinary",
        password: "ordinary-pass-123",
      }),
      method: "POST",
    });
    const userCookie = cookie(login);

    expect(
      (await request("/api/admin/models", { cookie: userCookie })).status,
    ).toBe(403);
    const publicResponse = await request("/api/models?capability=image", {
      cookie: userCookie,
    });
    expect(publicResponse.status).toBe(200);
    const publicBody = await publicResponse.json();
    const published = publicBody.models.find(
      (item: { displayName: string }) =>
        item.displayName === "Private Image Model",
    );
    expect(published).toMatchObject({
      capability: "image",
      imageParameters: {
        aspectRatios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        maxReferenceImages: 16,
        qualities: ["auto", "low", "medium", "high"],
      },
      isDefault: true,
      providerName: "Test OpenRouter",
      parameterSchema: {
        referenceInputs: { audio: 0, image: 16, video: 0 },
        version: 2,
      },
    });
    expect(published).not.toHaveProperty("providerModelId");
    expect(published).not.toHaveProperty("baseUrl");
    expect(published).not.toHaveProperty("apiKey");
    expect(published.configurationRevision).toMatch(/^[a-f0-9]{24}$/);
    expect(published.releaseRevisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(published.releaseRevisionId).not.toBe(
      published.configurationRevision,
    );
    expect(publicBody).toMatchObject({ generationEnabled: false });

    expect(
      (
        await request(`/api/admin/models/${model.id}`, {
          body: JSON.stringify({
            parameterSchema: {
              fields: [{ key: "provider_raw_option", options: ["unsafe"] }],
              referenceInputs: { audio: 0, image: 0, video: 0 },
              version: 1,
            },
          }),
          cookie: adminCookie,
          method: "PATCH",
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await request(`/api/admin/models/${model.id}`, {
          body: JSON.stringify({ status: "disabled" }),
          cookie: adminCookie,
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    const afterDisable = await (
      await request("/api/models?capability=image", { cookie: userCookie })
    ).json();
    expect(
      afterDisable.models.map((item: { displayName: string }) => item.displayName),
    ).not.toContain("Private Image Model");
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("administrator model center is visible and published models reach new node controls", async ({
  page,
}) => {
  await page.goto("/admin/models");
  await expect(page.getByTestId("admin-models-page")).toBeVisible();
  await expect(page.getByText("保护条件不完整时不会提交真实生成。"))
    .toBeVisible();
  await expect(page.locator(".model-list article")).toHaveCount(0);
  await expect(page.getByTestId("model-list-empty")).toContainText(
    "暂无已配置模型",
  );

  const providerAlphaResponse = await page.request.post("/api/admin/providers", {
    data: {
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Provider Alpha",
    },
  });
  const providerBetaResponse = await page.request.post("/api/admin/providers", {
    data: {
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Provider Beta",
    },
  });
  expect(providerAlphaResponse.status()).toBe(201);
  expect(providerBetaResponse.status()).toBe(201);
  const providerAlpha = (await providerAlphaResponse.json()).profile as { id: string };
  const providerBeta = (await providerBetaResponse.json()).profile as { id: string };

  const createdResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "Image Test Model",
      isDefault: true,
      providerModelId: "openai/gpt-image-2",
      providerProfileId: providerAlpha.id,
      sortOrder: 10,
      status: "published",
    },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()).model as { id: string };
  const alternateResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "Image Alternate Model",
      isDefault: false,
      providerModelId: "openai/gpt-image-2",
      providerProfileId: providerBeta.id,
      sortOrder: 20,
      status: "published",
    },
  });
  expect(alternateResponse.status()).toBe(201);
  const alternate = (await alternateResponse.json()).model as { id: string };
  const duplicateNameResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "Image Test Model",
      isDefault: false,
      providerModelId: "openai/gpt-image-2",
      providerProfileId: providerBeta.id,
      sortOrder: 30,
      status: "published",
    },
  });
  expect(duplicateNameResponse.status()).toBe(201);
  const rejectedCrossPlatformRebind = await page.request.patch(
    `/api/admin/models/${created.id}`,
    { data: { providerProfileId: providerBeta.id } },
  );
  expect(rejectedCrossPlatformRebind.status()).toBe(409);
  await expect(rejectedCrossPlatformRebind.json()).resolves.toMatchObject({
    code: "MODEL_PROVIDER_REBIND_FORBIDDEN",
  });

  await page.reload();
  const createdCard = page.locator(".model-list article")
    .filter({ hasText: "Image Test Model" })
    .filter({ hasText: "Provider Alpha" });
  await createdCard.getByRole("button", { name: "参数设置" }).click();
  const editor = createdCard.locator(".admin-model-parameter-edit");
  await expect(editor).toBeVisible();
  const alternateCard = page.locator(".model-list article").filter({
    hasText: "Image Alternate Model",
  });
  await expect.poll(async () => {
    const editorBox = await editor.boundingBox();
    const nextCardBox = await alternateCard.boundingBox();
    return Boolean(
      editorBox && nextCardBox && nextCardBox.y >= editorBox.y + editorBox.height,
    );
  }).toBe(true);
  const ratioSection = editor.locator('[data-parameter-key="aspectRatio"]');
  await ratioSection.locator(".admin-model-parameter-options label").filter({
    hasText: "1:1",
  }).getByRole("checkbox").check();
  await ratioSection.locator(".admin-model-parameter-default").getByRole("combobox").click();
  await ratioSection.getByRole("option", { name: "1:1" }).click();
  await editor.getByRole("button", { name: "保存参数设置" }).click();
  await expect(createdCard).toContainText("比例");

  await page.goto("/canvas");
  await page.getByTestId("add-node").click();
  await page
    .getByTestId("add-node-menu")
    .getByRole("menuitem", { name: "图片", exact: true })
    .click();
  const imageModel = page.getByTestId("image-model-control");
  await expect(imageModel).toBeVisible();
  const modelTrigger = imageModel.getByRole("combobox");
  await expect(modelTrigger).toHaveAttribute("data-value", created.id);
  await expect(modelTrigger).toContainText("Image Test Model");
  await expect(modelTrigger).toContainText("Provider Alpha · 图片");
  await modelTrigger.click();
  const modelOptions = imageModel.getByRole("listbox");
  await expect(modelOptions).toBeVisible();
  await expect(
    modelOptions.getByRole("option", {
      name: /^Image Test Model，Provider Alpha · 图片/,
    }),
  ).toHaveCount(1);
  await expect(
    modelOptions.getByRole("option", {
      name: /^Image Test Model，Provider Beta · 图片/,
    }),
  ).toHaveCount(1);
  await expect(
    modelOptions.getByRole("option", {
      name: /^Image Test Model，Provider Alpha · 图片/,
    }),
  ).toHaveAttribute("data-selected", "true");
  await expect(
    modelOptions.getByRole("option", {
      name: /^Image Test Model，Provider Alpha · 图片/,
    }),
  ).toContainText("Provider Alpha · 图片");
  await expect(
    modelOptions.getByRole("option", {
      name: /^Image Test Model，Provider Alpha · 图片/,
    }),
  ).toHaveCSS("background-color", "rgb(58, 58, 61)");
  await modelOptions
    .getByRole("option", { name: /Image Alternate Model/ })
    .press("Enter");
  await expect(modelTrigger).toHaveAttribute("data-value", alternate.id);
  await expect(modelTrigger).toContainText("Image Alternate Model");
  await expect(modelTrigger).toContainText("Provider Beta · 图片");
  const imageParameters = page.getByRole("button", { name: "图片参数" });
  await expect(imageParameters).toContainText("自适应 · 自动");
  await imageParameters.click();
  const parameterPanel = page.getByRole("dialog", { name: "图片生成参数" });
  await expect(parameterPanel).toBeVisible();
  await expect(parameterPanel.getByRole("group", { name: "画质" })).toContainText(
    "自动",
  );
  await expect(
    parameterPanel.getByRole("button", { name: "自动画质" }),
  ).toBeEnabled();
  await expect(
    parameterPanel.getByRole("button", { name: "高画质" }),
  ).toBeEnabled();
  await expect(
    parameterPanel.getByRole("button", { name: "1K画质" }),
  ).toBeDisabled();
  await expect(
    parameterPanel.getByRole("button", { name: "自适应比例" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    parameterPanel.getByRole("button", { name: "5:4比例" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Generate" })).toBeDisabled();

  await page.goto("/__fixture/node.image.prompt-ready");
  const fixtureModel = page.getByTestId("image-model-control");
  await expect(fixtureModel).toContainText("Image Test Model");
  await expect(fixtureModel).not.toContainText("Nano Banana 2 Lite");
});

test("Seedance admin rules keep Provider floors locked while allowing lower mode limits", async ({
  page,
}) => {
  const generationPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces/i.test(request.url()))
    ) {
      generationPosts.push(request.url());
    }
  });
  const providerResponse = await page.request.post("/api/admin/providers", {
    data: {
      apiKey: "test-p3-ark-key-12345",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "P3 Constraint Ark",
    },
  });
  expect(providerResponse.status()).toBe(201);
  const provider = (await providerResponse.json()).profile as { id: string };
  const modelResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "video",
      displayName: "Seedance Rule Guard UI",
      isDefault: false,
      maxCostMicrounits: 0,
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProfileId: provider.id,
      sortOrder: 45,
      status: "draft",
    },
  });
  expect(modelResponse.status()).toBe(201);

  await page.goto("/admin/models?v=seedance-provider-rule-guard");
  const card = page.locator(".model-list article").filter({ hasText: "Seedance Rule Guard UI" });
  await card.getByRole("button", { name: "参数设置" }).click();
  const editor = card.locator(".admin-model-parameter-edit");
  const inputModeToggle = editor.locator('[data-parameter-key="inputMode"]')
    .locator(".admin-model-parameter-enable input");
  await expect(inputModeToggle).toBeDisabled();

  const baseInputPolicy = editor.locator(".admin-model-upstream-inputs")
    .filter({ hasText: "入参角色与必填条件" });
  const imageRoles = baseInputPolicy.locator('[data-input-kind="image"]');
  await expect(imageRoles.getByText("首帧", { exact: true }).locator("..").getByRole("checkbox"))
    .toBeDisabled();
  await expect(imageRoles.getByText("普通参考", { exact: true }).locator("..").getByRole("checkbox"))
    .toBeDisabled();
  await expect(editor.getByText("已被某种生成方式使用的角色不能从全局单独删除，避免模式规则与全局规则冲突。"))
    .toBeVisible();

  const referencePolicyToggle = editor.locator(
    '.admin-model-reference-limits > .admin-model-reference-heading input[type="checkbox"]',
  );
  await expect(referencePolicyToggle).toBeDisabled();
  await expect(editor.getByText("Provider要求保留分模式校验；可以在当前上限内继续收紧数量和组合。"))
    .toBeVisible();

  await editor.getByLabel("multimodal组合1image上限").fill("8");
  await editor.getByRole("button", { name: "保存参数设置" }).click();
  const models = await (await page.request.get("/api/admin/models")).json() as {
    models: Array<{ displayName: string; parameterSchema: ModelParameterSchema }>;
  };
  const stored = models.models.find((model) => model.displayName === "Seedance Rule Guard UI");
  expect(stored?.parameterSchema.referencePolicy?.modes.multimodal.sets[0].image).toBe(8);
  const status = await (await page.request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(status.paidProviderRequests).toBe(0);
  expect(generationPosts).toEqual([]);
});

test("administrator configures future-model conditions, unavailable options and reference combinations", async ({
  page,
}) => {
  const generationPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces/i.test(request.url()))
    ) {
      generationPosts.push(request.url());
    }
  });
  const response = await page.request.post("/api/admin/models", {
    data: {
      capability: "video",
      displayName: "Future Video Model",
      isDefault: false,
      parameterSchema: {
        fields: [
          {
            defaultValue: "first-last-frame",
            group: "input",
            key: "inputMode",
            label: "生成方式",
            options: [
              { label: "首尾帧", value: "first-last-frame" },
              { label: "参考", value: "reference" },
            ],
            summary: true,
            type: "select",
          },
          {
            defaultValue: "540p",
            group: "main",
            key: "resolution",
            label: "清晰度",
            options: [
              { label: "540p", value: "540p" },
              { label: "720p", value: "720p" },
            ],
            summary: true,
            type: "select",
          },
          {
            defaultValue: false,
            group: "advanced",
            key: "multiShot",
            label: "多镜头",
            options: [
              { label: "开启", value: true },
              { label: "关闭", value: false },
            ],
            type: "boolean",
            visibleWhen: [{ key: "inputMode", operator: "equals", value: "reference" }],
          },
        ],
        groups: [],
        referenceInputs: { audio: 0, image: 5, video: 2 },
        referencePolicy: {
          modeKey: "inputMode",
          modes: {
            "first-last-frame": { sets: [{ audio: 0, image: 2, video: 0 }] },
            reference: {
              sets: [
                { audio: 0, image: 3, video: 2 },
                { audio: 0, image: 5, video: 0 },
              ],
            },
          },
        },
        version: 2,
      },
      providerModelId: "test/future-video-model",
      sortOrder: 50,
      status: "draft",
    },
  });
  expect(response.status()).toBe(201);

  await page.goto("/admin/models?v=model-contract-admin-v2");
  const card = page.locator(".model-list article").filter({ hasText: "Future Video Model" });
  await card.getByRole("button", { name: "参数设置" }).click();
  const editor = card.locator(".admin-model-parameter-edit");
  await expect(editor.getByText("模型参数 · 第2版规则")).toBeVisible();

  await editor.getByRole("button", { name: "新增参数" }).click();
  await editor.getByPlaceholder("例如：安全等级").fill("动态程度");
  await editor.getByRole("button", { name: "添加到节点" }).click();
  await expect(editor.getByText("动态程度", { exact: true })).toBeVisible();
  await expect(editor.getByText("待平台适配", { exact: true })).toBeVisible();

  const inputModeSection = editor.locator('[data-parameter-key="inputMode"]');
  await expect(inputModeSection.locator(".admin-model-parameter-enable")).toContainText("输入区");
  await expect(inputModeSection.locator(".admin-model-parameter-enable input")).toBeEnabled();
  const unconstrainedImageRole = editor.locator(
    '.admin-model-upstream-inputs [data-input-kind="image"]',
  ).getByText("普通参考", { exact: true }).locator("..").getByRole("checkbox");
  await expect(unconstrainedImageRole).toBeDisabled();
  await expect(unconstrainedImageRole).toHaveAttribute(
    "title",
    "每种已启用的上游类型至少保留一个角色",
  );
  const additionalImageRole = editor.locator(
    '.admin-model-upstream-inputs [data-input-kind="image"]',
  ).getByText("主体", { exact: true }).locator("..").getByRole("checkbox");
  await expect(additionalImageRole).toBeEnabled();
  await additionalImageRole.check();
  await expect(unconstrainedImageRole).toBeEnabled();
  await additionalImageRole.uncheck();
  await expect(unconstrainedImageRole).toBeDisabled();
  await expect(editor.locator(
    '.admin-model-reference-limits > .admin-model-reference-heading input[type="checkbox"]',
  )).toBeEnabled();

  const resolutionSection = editor.locator('[data-parameter-key="resolution"]');
  const optionState = resolutionSection.locator(".admin-model-option-states > label").filter({
    hasText: "720p",
  });
  await optionState.getByRole("combobox").click();
  await optionState.getByRole("option", { name: "显示但禁用" }).click();

  const multiShotSection = editor.locator('[data-parameter-key="multiShot"]');
  await expect(multiShotSection.locator(".admin-model-parameter-condition"))
    .toContainText("当生成方式为");
  await expect(multiShotSection.locator(".admin-model-parameter-condition"))
    .toContainText("参考");

  const referenceMode = editor.locator(".admin-model-reference-modes > div").filter({
    hasText: "参考",
  });
  await expect(referenceMode.locator(".admin-model-reference-set")).toHaveCount(2);
  await referenceMode.getByRole("button", { name: "添加另一种组合" }).click();
  await expect(referenceMode.locator(".admin-model-reference-set")).toHaveCount(3);

  await editor.getByRole("button", { name: "保存参数设置" }).click();
  const adminModels = await page.request.get("/api/admin/models");
  const stored = ((await adminModels.json()).models as Array<{
    displayName: string;
    parameterSchema: {
      fields: ModelParameterField[];
      referencePolicy?: { modes: Record<string, { sets: ModelReferenceInputs[] }> };
      version: number;
    };
  }>).find((model) => model.displayName === "Future Video Model");
  expect(stored?.parameterSchema.version).toBe(2);
  expect(stored?.parameterSchema.fields.find((field) => field.key === "resolution")?.options)
    .toContainEqual(expect.objectContaining({ availability: "disabled", value: "720p" }));
  expect(stored?.parameterSchema.fields).toContainEqual(expect.objectContaining({
    label: "动态程度",
    providerStatus: "pending",
    type: "select",
  }));
  expect(stored?.parameterSchema.referencePolicy?.modes.reference.sets).toHaveLength(3);
  expect(generationPosts).toEqual([]);
});

test("all four node model types persist the shared upstream input contract without Provider requests", async ({
  page,
}) => {
  const generationPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces|mureka/i.test(request.url()))
    ) {
      generationPosts.push(request.url());
    }
  });
  const cases = [
    {
      capability: "text",
      displayName: "Universal Input Text",
      forbiddenKinds: [],
      mediaKind: "image",
      mediaLabel: "图片",
      mediaRole: "context-image",
      role: "context-text",
    },
    {
      capability: "image",
      displayName: "Universal Input Image",
      forbiddenKinds: ["video", "audio"],
      mediaKind: "image",
      mediaLabel: "图片",
      mediaRole: "reference-image",
      role: "instruction",
    },
    {
      capability: "video",
      displayName: "Universal Input Video",
      forbiddenKinds: [],
      mediaKind: "video",
      mediaLabel: "视频",
      mediaRole: "reference-video",
      role: "instruction",
    },
    {
      capability: "audio",
      displayName: "Universal Input Audio",
      forbiddenKinds: ["image", "video", "audio"],
      role: "instruction",
    },
  ] as const;

  for (const item of cases) {
    const response = await page.request.post("/api/admin/models", {
      data: {
        capability: item.capability,
        displayName: item.displayName,
        isDefault: false,
        maxCostMicrounits: 0,
        providerModelId: `test/${item.capability}-universal-input`,
        sortOrder: 80,
        status: "draft",
      },
    });
    expect(response.status()).toBe(201);
  }

  await page.goto("/admin/models?v=universal-node-input-contract");
  for (const item of cases) {
    const card = page.locator(".model-list article").filter({ hasText: item.displayName });
    await card.getByRole("button", { name: "参数设置" }).click();
    const editor = card.locator(".admin-model-parameter-edit");

    const upstream = editor.locator(".admin-model-upstream-inputs")
      .filter({ hasText: "上游输入规则" });
    await expect(upstream.locator(".admin-model-upstream-list > [data-input-kind]"))
      .toHaveCount(4);
    const textRule = upstream.locator('[data-input-kind="text"]');
    await expect(textRule.getByRole("checkbox")).toBeChecked();
    await textRule.getByRole("combobox", { name: "文字上游数量规则" }).click();
    await textRule.getByRole("option", { name: "固定画布数量" }).click();
    await textRule.getByRole("spinbutton", { name: "文字上游输入上限" }).fill("2");
    for (const forbiddenKind of item.forbiddenKinds) {
      await expect(
        upstream.locator(`[data-input-kind="${forbiddenKind}"]`).getByRole("checkbox"),
      ).toBeDisabled();
    }
    if ("mediaKind" in item) {
      const mediaRule = upstream.locator(`[data-input-kind="${item.mediaKind}"]`);
      await mediaRule.getByRole("checkbox").check();
      await mediaRule.getByRole("spinbutton", {
        name: `${item.mediaLabel}上游输入上限`,
      }).fill("2");
    }

    const basePolicy = editor.locator(".admin-model-upstream-inputs")
      .filter({ hasText: "入参角色与必填条件" });
    const textPolicy = basePolicy.locator('[data-input-kind="text"]');
    await expect(textPolicy.getByRole("checkbox")).toBeChecked();
    await textPolicy.getByRole("spinbutton", { name: "text必填数量" }).fill("1");
    await basePolicy.getByRole("combobox", { name: "模型切换规则" }).click();
    await basePolicy.getByRole("option", { name: "有不兼容引用时禁止切换" }).click();

    const conditional = editor.locator(".admin-model-upstream-inputs")
      .filter({ hasText: "按生成方式设置角色与必填" });
    await conditional.getByRole("checkbox", {
      name: "按生成方式设置角色与必填",
    }).check();
    const modePolicy = conditional.locator('[data-role-policy="0"]');
    const modeTextPolicy = modePolicy.locator(
      ':scope > .admin-model-upstream-list > [data-input-kind="text"]',
    );
    const roleDetails = modeTextPolicy.locator(`[data-input-role="${item.role}"]`);
    await roleDetails.getByRole("spinbutton").first().fill("1");
    await roleDetails.getByRole("checkbox", { name: /按顺序自动分配/ }).check();
    if ("mediaKind" in item) {
      const modeMediaPolicy = modePolicy.locator(
        `:scope > .admin-model-upstream-list > [data-input-kind="${item.mediaKind}"]`,
      );
      const mediaRoleDetails = modeMediaPolicy.locator(
        `[data-input-role="${item.mediaRole}"]`,
      );
      await mediaRoleDetails.getByRole("spinbutton").first().fill("1");
      await mediaRoleDetails.getByRole("checkbox", { name: /按顺序自动分配/ }).check();
    }

    const combinations = editor.locator(".admin-model-reference-limits")
      .filter({ hasText: "参考素材组合" });
    await combinations.getByRole("checkbox", {
      name: "按生成方式分别设置素材组合",
    }).check();
    await expect(combinations.locator(".admin-model-reference-modes > div"))
      .toHaveCount(1);
    if ("mediaKind" in item) {
      await combinations.getByRole("spinbutton", {
        name: `text组合1${item.mediaKind}上限`,
      }).fill("2");
    }

    await editor.getByRole("button", { name: "保存参数设置" }).click();
    await expect(editor).toHaveCount(0);
  }

  const stored = await (await page.request.get("/api/admin/models")).json() as {
    models: Array<{
      displayName: string;
      parameterSchema: ModelParameterSchema;
    }>;
  };
  for (const item of cases) {
    const model = stored.models.find((candidate) => candidate.displayName === item.displayName);
    expect(model?.parameterSchema.upstreamInputs?.text).toMatchObject({
      limitMode: "fixed",
      maxCount: 2,
      supported: true,
    });
    expect(model?.parameterSchema.inputPolicy).toMatchObject({
      required: { text: 1 },
      switchPolicy: "block-switch",
    });
    expect(model?.parameterSchema.inputPolicy?.roles?.text).toContain(item.role);
    expect(model?.parameterSchema.inputPolicy?.rolePolicies?.[0]).toMatchObject({
      assignment: {
        text: [item.role],
      },
      limits: expect.arrayContaining([
        expect.objectContaining({
          kind: "text",
          maxCount: 2,
          minCount: 1,
          role: item.role,
        }),
      ]),
      roles: { text: [item.role] },
    });
    expect(model?.parameterSchema.referencePolicy?.modes).toHaveProperty("text");
    if ("mediaKind" in item) {
      expect(model?.parameterSchema.upstreamInputs?.[item.mediaKind]).toMatchObject({
        limitMode: "fixed",
        maxCount: 2,
        supported: true,
      });
      expect(model?.parameterSchema.inputPolicy?.roles?.[item.mediaKind])
        .toContain(item.mediaRole);
      expect(model?.parameterSchema.inputPolicy?.rolePolicies?.[0])
        .toMatchObject({
          assignment: { [item.mediaKind]: [item.mediaRole] },
          limits: expect.arrayContaining([
            expect.objectContaining({
              kind: item.mediaKind,
              maxCount: 2,
              minCount: 1,
              role: item.mediaRole,
            }),
          ]),
          roles: { [item.mediaKind]: [item.mediaRole] },
        });
      expect(model?.parameterSchema.referencePolicy?.modes.text.sets[0])
        .toMatchObject({ [item.mediaKind]: 2 });
    }
  }
  expect(generationPosts).toEqual([]);
});

test("administrators edit the gpt-image size map while other protocols reject it", async ({
  page,
}) => {
  const relayResponse = await page.request.post("/api/admin/providers", {
    data: {
      apiKey: "relay-gpt-image-size-key",
      baseUrl: "https://relay.example.test/v1",
      driver: "multi-protocol-relay",
      label: "Size Map Relay",
    },
  });
  expect(relayResponse.status()).toBe(201);
  const relay = (await relayResponse.json()).profile as { id: string };

  const gptResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "GPT Image Size Map",
      isDefault: false,
      providerModelId: "gpt-image-2",
      providerProfileId: relay.id,
      providerProtocol: "gpt-image",
      sortOrder: 70,
      status: "published",
    },
  });
  expect(gptResponse.status()).toBe(201);
  const gptModel = (await gptResponse.json()).model as { id: string };

  const nativeResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "Native Size Map Reject",
      isDefault: false,
      providerModelId: "unconfigured:image-size-map-reject",
      providerProfileId: "provider-unconfigured",
      sortOrder: 71,
      status: "draft",
    },
  });
  expect(nativeResponse.status()).toBe(201);
  const nativeModel = (await nativeResponse.json()).model as { id: string };

  const catalog = await (await page.request.get("/api/admin/models")).json() as {
    models: Array<{ id: string; parameterSchema: ModelParameterSchema }>;
  };
  const gptSchema = structuredClone(
    catalog.models.find((model) => model.id === gptModel.id)!.parameterSchema,
  );
  const nativeSchema = structuredClone(
    catalog.models.find((model) => model.id === nativeModel.id)!.parameterSchema,
  );

  // 非 gpt-image 模型即使请求里带了映射也整体拒绝，防止串到别的平台。
  expect((await page.request.patch(`/api/admin/models/${nativeModel.id}`, {
    data: {
      parameterSchema: {
        ...nativeSchema,
        sizeMap: { "4k": { "9:16": "2160x3840" } },
      },
    },
  })).status()).toBe(400);

  // 非法像素整体拒绝，不部分生效。
  expect((await page.request.patch(`/api/admin/models/${gptModel.id}`, {
    data: {
      parameterSchema: {
        ...gptSchema,
        sizeMap: { "4k": { "9:16": "17x1024" } },
      },
    },
  })).status()).toBe(400);

  const valid = await page.request.patch(`/api/admin/models/${gptModel.id}`, {
    data: {
      parameterSchema: {
        ...gptSchema,
        sizeMap: { "4k": { "9:16": "2160x3840" } },
      },
    },
  });
  expect(valid.status()).toBe(200);

  await page.goto("/admin/models?v=gpt-image-size-map");
  const gptCard = page
    .locator(".model-list article")
    .filter({ hasText: "GPT Image Size Map" });
  await gptCard.getByRole("button", { name: "参数设置" }).click();
  const gptEditor = gptCard.locator(".admin-model-parameter-edit");
  const sizeMapSection = gptEditor.getByTestId("admin-gpt-image-size-map");
  await expect(sizeMapSection).toBeVisible();
  await expect(sizeMapSection.getByText("文档内置表（参考）")).toBeVisible();
  const tier4k = sizeMapSection.locator('[data-tier="4k"]');
  await expect(tier4k).toContainText("9:16");
  await tier4k.getByLabel("新增4K比例").fill("1:1");
  await tier4k.getByLabel("新增4K像素").fill("2880x2880");
  await tier4k.getByRole("button", { name: "加一行" }).click();
  await gptEditor.getByRole("button", { name: "保存参数设置" }).click();

  const after = await (await page.request.get("/api/admin/models")).json() as {
    models: Array<{ id: string; parameterSchema: ModelParameterSchema }>;
  };
  const stored = after.models.find((model) => model.id === gptModel.id)?.parameterSchema;
  expect(stored?.sizeMap).toMatchObject({
    "4k": { "9:16": "2160x3840", "1:1": "2880x2880" },
  });

  // 非 gpt-image 模型的后台编辑页完全不出现这个区块。
  const nativeCard = page
    .locator(".model-list article")
    .filter({ hasText: "Native Size Map Reject" });
  await nativeCard.getByRole("button", { name: "参数设置" }).click();
  const nativeEditor = nativeCard.locator(".admin-model-parameter-edit");
  await expect(nativeEditor.getByTestId("admin-gpt-image-size-map")).toHaveCount(0);
});
