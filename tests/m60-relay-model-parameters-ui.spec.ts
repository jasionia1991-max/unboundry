import { expect, test, type Page } from "./safe-test";
import {
  knownModelParameterSchema,
  type ModelCapability,
  type ModelParameterSchema,
} from "../types/modelParameters";

const relayTextSchema = knownModelParameterSchema({
  capability: "text",
  providerDriver: "multi-protocol-relay",
  providerModelId: "gpt-5.4-nano",
});
const relayTtsSchema = knownModelParameterSchema({
  capability: "audio",
  providerDriver: "multi-protocol-relay",
  providerModelId: "doubao-tts-2.0",
});

async function routeFixtureCanvas(
  page: Page,
  canvasId: string,
  document?: Record<string, unknown>,
) {
  await page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill(document
        ? { contentType: "application/json", json: document, status: 200 }
        : { status: 404 });
      return;
    }
    const input = route.request().postDataJSON() as { revision?: number };
    await route.fulfill({
      contentType: "application/json",
      json: { revision: Number(input.revision ?? 0) + 1 },
      status: 200,
    });
  });
}

function publishedModel(input: {
  capability: ModelCapability;
  displayName: string;
  id: string;
  parameterSchema: ModelParameterSchema;
  providerModelId: string;
  providerProtocol: string;
}) {
  return {
    ...input,
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
    isDefault: true,
  };
}

test("relay Text node exposes bounded defaults and keeps them in zero-Provider preflight", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL!).origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  let preflightBody: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  await routeFixtureCanvas(page, "default", {
    edges: [],
    nodes: [{
      data: {
        content: "",
        label: "Text",
        textPrompt: "只回复一个字：好",
        textPromptReady: true,
        title: "Text",
      },
      id: "relay-text-primary",
      position: { x: 442, y: 300 },
      selected: true,
      style: { height: 250, width: 250 },
      type: "text",
      zIndex: 0,
    }],
    revision: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [publishedModel({
          capability: "text",
          displayName: "Relay Nano",
          id: "relay-nano-text",
          parameterSchema: relayTextSchema,
          providerModelId: "gpt-5.4-nano",
          providerProtocol: "openai-responses",
        })],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/generation-tasks/by-idempotency"
    ) {
      await route.fulfill({ status: 404 });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname === "/api/generation-tasks/preflight"
    ) {
      preflightBody = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        json: {
          canEnqueue: false,
          canSubmit: false,
          enqueueProblem: {
            code: "FIXTURE_ZERO_PROVIDER",
            message: "fixture stops before task creation",
          },
          paidProviderRequests: 0,
          problems: [],
        },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: "unexpected generation route" },
      status: 500,
    });
  });

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  const creator = page.getByTestId("text-creator");
  const parameterTrigger = creator.getByRole("button", {
    name: "64 Token · T 0",
  });
  await expect(parameterTrigger).toBeVisible();
  await parameterTrigger.click();
  const dialog = creator.getByRole("dialog", { name: "模型参数" });
  await expect(dialog.getByText("最大输出Token", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "64 Token" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByText("Temperature", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "T 0", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await parameterTrigger.click();

  await expect(page.getByTestId("text-creator-prompt"))
    .toHaveValue("只回复一个字：好");
  await expect(creator.getByRole("button", { name: "Generate" })).toBeEnabled();
  await creator.getByRole("button", { name: "Generate" }).click();
  await expect.poll(() => preflightBody).toMatchObject({
    kind: "text",
    model: "relay-nano-text",
    parameters: {
      inputMode: "text",
      maxOutputTokens: 64,
      outputCount: 1,
      temperature: 0,
    },
  });
  expect(generationRequests.filter((entry) => entry === "POST /api/generation-tasks"))
    .toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("relay doubao TTS node shows only documented controls and reveals emotion scale conditionally", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL!).origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  let preflightBody: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  await routeFixtureCanvas(page, "default", {
    edges: [],
    nodes: [{
      data: {
        audioPrompt: "验收通过",
        audioPromptReady: true,
        label: "Audio",
        sourceKind: "audio",
        title: "Audio",
      },
      id: "audio-primary",
      position: { x: 345, y: 300 },
      selected: true,
      style: { height: 250, width: 444 },
      type: "audio",
      zIndex: 0,
    }],
    revision: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [publishedModel({
          capability: "audio",
          displayName: "Doubao TTS 2.0",
          id: "relay-doubao-tts",
          parameterSchema: relayTtsSchema,
          providerModelId: "doubao-tts-2.0",
          providerProtocol: "media-generate",
        })],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/generation-tasks/by-idempotency"
    ) {
      await route.fulfill({ status: 404 });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname === "/api/generation-tasks/preflight"
    ) {
      preflightBody = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        json: {
          canEnqueue: false,
          canSubmit: false,
          enqueueProblem: {
            code: "FIXTURE_ZERO_PROVIDER",
            message: "fixture stops before task creation",
          },
          paidProviderRequests: 0,
          problems: [],
        },
        status: 200,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: "unexpected generation route" },
      status: 500,
    });
  });

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.locator(".react-flow__node-audio").click({ position: { x: 8, y: 8 } });
  const creator = page.getByTestId("audio-creator");
  const parameterTrigger = creator.getByRole("button", {
    name: "Vivi 2.0 · 0 · 自动 · MP3",
  });
  await expect(parameterTrigger).toBeVisible();
  await parameterTrigger.click();
  const dialog = creator.getByRole("dialog", { name: "模型参数" });
  await expect(dialog.getByText("音色", { exact: true })).toBeVisible();
  await expect(dialog.getByText("语速", { exact: true })).toBeVisible();
  await expect(dialog.getByText("情绪", { exact: true })).toBeVisible();
  await expect(dialog.getByText("格式", { exact: true })).toBeVisible();
  await expect(dialog.getByText("情绪强度", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("时长", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("类型", { exact: true })).toHaveCount(0);
  await parameterTrigger.click();
  await creator.getByRole("button", { name: "Generate" }).click();
  await expect.poll(() => preflightBody).toMatchObject({
    kind: "audio",
    model: "relay-doubao-tts",
    parameters: {
      emotion: "auto",
      format: "mp3",
      inputMode: "text",
      outputCount: 1,
      speaker: "zh_female_vv_uranus_bigtts",
      speechRate: "0",
    },
  });
  expect(
    (preflightBody?.parameters as Record<string, unknown>)?.emotionScale,
  ).toBeUndefined();

  await parameterTrigger.click();
  await dialog.getByRole("button", { name: "愉快" }).click();
  await expect(dialog.getByText("情绪强度", { exact: true })).toBeVisible();

  expect(generationRequests).toContain("POST /api/generation-tasks/preflight");
  expect(generationRequests).not.toContain("POST /api/generation-tasks");
  expect(externalRequests).toEqual([]);
});

test("admin model center presents the bounded relay Text and doubao TTS schemas", async ({
  baseURL,
  page,
}) => {
  const localOrigin = new URL(baseURL!).origin;
  const externalRequests: string[] = [];
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) externalRequests.push(request.url());
    if (url.pathname.startsWith("/api/generation-tasks")) {
      generationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });
  const provider = {
    displayName: "业务中转站",
    driver: "multi-protocol-relay",
    id: "relay-safe-parameters",
    status: "enabled",
  };
  const model = (
    capability: ModelCapability,
    displayName: string,
    id: string,
    parameterSchema: ModelParameterSchema,
    providerModelId: string,
    providerProtocol: string,
  ) => ({
    archived: false,
    canDelete: false,
    capability,
    costCurrency: "USD",
    deleteBlockedReason: "已发布模型只能归档",
    displayName,
    enabled: true,
    everPublished: true,
    generationAvailable: true,
    id,
    isDefault: false,
    maxCostMicrounits: 1_000_000,
    parameterSchema,
    providerConnected: true,
    providerDriver: "multi-protocol-relay",
    providerModelId,
    providerName: provider.displayName,
    providerProfileId: provider.id,
    providerProtocol,
    references: { activeTasks: 0, canvasDocuments: 0, tasks: 0 },
    sortOrder: 100,
    status: "published",
  });
  await page.route("**/api/admin/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        models: [
          model(
            "text",
            "Relay Nano",
            "relay-nano-admin",
            relayTextSchema,
            "gpt-5.4-nano",
            "openai-responses",
          ),
          model(
            "audio",
            "Doubao TTS 2.0",
            "relay-tts-admin",
            relayTtsSchema,
            "doubao-tts-2.0",
            "media-generate",
          ),
        ],
        providers: [provider],
        submissionEnabled: true,
      },
      status: 200,
    });
  });

  await page.goto("/admin/models");
  const textModel = page.locator(".model-list article").filter({ hasText: "Relay Nano" });
  await textModel.getByRole("button", { name: "参数设置" }).click();
  await expect(textModel.locator('[data-parameter-key="maxOutputTokens"]'))
    .toContainText("最大输出Token");
  await expect(textModel.locator('[data-parameter-key="temperature"]'))
    .toContainText("Temperature");

  const audioModel = page.locator(".model-list article").filter({
    hasText: "Doubao TTS 2.0",
  });
  await audioModel.getByRole("button", { name: "参数设置" }).click();
  await expect(audioModel.locator('[data-parameter-key="speaker"]'))
    .toContainText("Vivi 2.0");
  await expect(audioModel.locator('[data-parameter-key="speechRate"]'))
    .toContainText("语速");
  await expect(audioModel.locator('[data-parameter-key="emotionScale"]'))
    .toContainText("情绪强度");
  await expect(audioModel.locator('[data-parameter-key="format"]'))
    .toContainText("MP3");
  await expect(audioModel.locator('[data-parameter-key="duration"]')).toHaveCount(0);
  await expect(audioModel.locator('[data-parameter-key="audioMode"]')).toHaveCount(0);

  expect(generationRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
});
