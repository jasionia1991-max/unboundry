import { expect, test, type Page } from "@playwright/test";
import {
  defaultParameterValues,
  knownModelParameterSchema,
  type ModelCapability,
} from "../types/modelParameters";

const modelInputs = {
  audio: {
    id: "retry-ui-audio-model",
    providerDriver: "mureka",
    providerModelId: "mureka-9",
  },
  image: {
    id: "retry-ui-image-model",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
  },
  text: {
    id: "retry-ui-text-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
  },
  video: {
    id: "retry-ui-video-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  },
} as const;

const kinds = ["text", "image", "video", "audio"] as const;
type Kind = (typeof kinds)[number];

const schemas = Object.fromEntries(
  Object.entries(modelInputs).map(([capability, model]) => [
    capability,
    knownModelParameterSchema({
      capability: capability as ModelCapability,
      providerDriver: model.providerDriver,
      providerModelId: model.providerModelId,
    }),
  ]),
) as Record<ModelCapability, ReturnType<typeof knownModelParameterSchema>>;

function nodeId(kind: Kind) {
  return `retry-ui-${kind}`;
}

function canvasNodes(onlyKind?: Kind) {
  return kinds.filter((kind) => !onlyKind || kind === onlyKind)
    .map((kind, index) => ({
    data: {
      label: kind[0].toUpperCase() + kind.slice(1),
      title: `Retry ${kind}`,
      [`${kind}ModelId`]: modelInputs[kind].id,
      [`${kind}Parameters`]: defaultParameterValues(schemas[kind]),
      [`${kind}Prompt`]: `${kind} 原始提示词`,
      ...(kind === "text" ? {} : { [`${kind}PromptReady`]: true }),
      ...(kind === "text" ? { content: "" } : {}),
    },
    id: nodeId(kind),
    position: {
      x: index % 2 === 0 ? 80 : 620,
      y: index < 2 ? 80 : 520,
    },
    selected: Boolean(onlyKind) || kind === "text",
    style: {
      height: kind === "image" ? 300 : 250,
      width: kind === "image" ? 300 : kind === "text" ? 250 : 444,
    },
    type: kind,
    }));
}

async function installRoutes(page: Page, retryAllowed: boolean) {
  let providerRequests = 0;
  let taskSubmissions = 0;
  const tasks = new Map<string, Record<string, unknown>>();
  const idsByKey = new Map<string, string>();

  page.on("request", (request) => {
    if (/volces|openrouter|mureka/i.test(request.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Retry UI ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs[kind].id,
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/preflight") && method === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: { canEnqueue: true, canSubmit: true, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency") && method === "GET") {
      const id = idsByKey.get(url.searchParams.get("idempotencyKey") ?? "");
      await route.fulfill({
        contentType: "application/json",
        json: id ? tasks.get(id) : { error: "not found" },
        status: id ? 200 : 404,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "POST") {
      const body = request.postDataJSON() as {
        idempotencyKey: string;
        kind: Kind;
        model?: string;
        nodeId: string;
        prompt: string;
      };
      taskSubmissions += 1;
      const id = `retry-ui-task-${body.kind}`;
      idsByKey.set(body.idempotencyKey, id);
      const failed = {
        attempt: 1,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-03T08:00:00.000Z",
        errorCode: retryAllowed ? "AUTH" : "SERVICE_RESTARTED",
        errorMessage: retryAllowed
          ? `${body.kind} 零Provider模拟失败`
          : `${body.kind} 上次生成结果无法确认`,
        id,
        kind: body.kind,
        model: body.model,
        nodeId: body.nodeId,
        prompt: body.prompt,
        retryAllowed,
        ...(!retryAllowed
          ? {
              retryBlockCode: "RETRY_OUTCOME_UNKNOWN",
              retryBlockReason:
                "上次生成结果无法确认，为避免重复扣费，不能直接重试",
            }
          : {}),
        state: "failed",
        updatedAt: "2026-08-03T08:00:01.000Z",
      };
      tasks.set(id, failed);
      await route.fulfill({
        contentType: "application/json",
        json: { ...failed, retryAllowed: false, state: "queued" },
        status: 202,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [...tasks.values()] },
        status: 200,
      });
      return;
    }
    const id = url.pathname.split("/").at(-1) ?? "";
    if (method === "GET" && tasks.has(id)) {
      await route.fulfill({
        contentType: "application/json",
        json: tasks.get(id),
        status: 200,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: "Unexpected fake task route" },
      status: 404,
    });
  });

  return {
    providerRequests: () => providerRequests,
    taskSubmissions: () => taskSubmissions,
  };
}

type CancellableKind = Extract<Kind, "image" | "video">;

async function installCancelOutcomeUnknownRoutes(page: Page) {
  let providerRequests = 0;
  const cancelRequests = new Map<CancellableKind, number>();
  const statusReads = new Map<CancellableKind, number>();
  const submissions = new Map<CancellableKind, number>();
  const tasks = new Map<string, Record<string, unknown>>();
  const idsByKey = new Map<string, string>();

  page.on("request", (request) => {
    if (/volces|openrouter|mureka/i.test(request.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Cancel safety ${kind}`,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs[kind].id,
          isDefault: true,
          parameterSchema: schemas[kind],
        })),
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/preflight") && method === "POST") {
      await route.fulfill({
        contentType: "application/json",
        json: { canEnqueue: true, canSubmit: true, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency") && method === "GET") {
      const id = idsByKey.get(url.searchParams.get("idempotencyKey") ?? "");
      await route.fulfill({
        contentType: "application/json",
        json: id ? tasks.get(id) : { error: "not found" },
        status: id ? 200 : 404,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "POST") {
      const body = request.postDataJSON() as {
        idempotencyKey: string;
        kind: CancellableKind;
        model?: string;
        nodeId: string;
        prompt: string;
      };
      submissions.set(body.kind, (submissions.get(body.kind) ?? 0) + 1);
      const id = `cancel-unknown-task-${body.kind}`;
      idsByKey.set(body.idempotencyKey, id);
      const running = {
        attempt: 1,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-03T08:00:00.000Z",
        id,
        kind: body.kind,
        model: body.model,
        nodeId: body.nodeId,
        prompt: body.prompt,
        retryAllowed: false,
        state: "running",
        updatedAt: "2026-08-03T08:00:01.000Z",
      };
      tasks.set(id, running);
      await route.fulfill({
        contentType: "application/json",
        json: { ...running, state: "queued" },
        status: 202,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [...tasks.values()] },
        status: 200,
      });
      return;
    }
    const id = url.pathname.split("/").at(-1) ?? "";
    const task = tasks.get(id);
    if (task && method === "DELETE") {
      const kind = task.kind as CancellableKind;
      cancelRequests.set(kind, (cancelRequests.get(kind) ?? 0) + 1);
      await route.fulfill({
        contentType: "application/json",
        json: {
          code: "CANCEL_OUTCOME_UNKNOWN",
          error: "取消结果无法确认，任务仍在查询中",
        },
        status: 409,
      });
      return;
    }
    if (task && method === "GET") {
      const kind = task.kind as CancellableKind;
      statusReads.set(kind, (statusReads.get(kind) ?? 0) + 1);
      await route.fulfill({
        contentType: "application/json",
        json: task,
        status: 200,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: "Unexpected fake task route" },
      status: 404,
    });
  });

  return {
    cancelRequests: (kind: CancellableKind) => cancelRequests.get(kind) ?? 0,
    providerRequests: () => providerRequests,
    statusReads: (kind: CancellableKind) => statusReads.get(kind) ?? 0,
    submissions: (kind: CancellableKind) => submissions.get(kind) ?? 0,
  };
}

async function selectNode(page: Page, kind: Kind) {
  if (await page.getByTestId(`${kind}-creator`).isVisible().catch(() => false)) {
    return;
  }
  await page.locator(`.react-flow__node[data-id="${nodeId(kind)}"]`)
    .click({ force: true, position: { x: 8, y: 8 } });
  await expect(page.getByTestId(`${kind}-creator`)).toBeVisible();
}

function retryButton(page: Page, kind: Kind) {
  return kind === "text"
    ? page.getByTestId("text-creator")
        .getByRole("button", { name: "Retry generation" })
    : page.getByTestId(`${kind}-node-${nodeId(kind)}`)
        .getByRole("button", { name: "重试生成" });
}

async function generateAndWaitForFailure(page: Page, kind: Kind) {
  await selectNode(page, kind);
  await page.getByTestId(`${kind}-creator`)
    .getByRole("button", { name: "Generate" })
    .click();
  const failure = kind === "text"
    ? page.getByTestId("upstream-input-problem")
    : page.getByTestId(`${kind}-node-${nodeId(kind)}`).getByRole("alert");
  await expect(failure).toContainText(kind);
}

async function changePrompt(page: Page, kind: Kind) {
  await selectNode(page, kind);
  const prompt = kind === "audio"
    ? page.getByLabel("音频提示词")
    : page.getByTestId(`${kind}-creator-prompt`);
  await prompt.fill(`${kind} 已修改提示词`);
  await prompt.blur();
}

test("four nodes keep safe retry across autosave, then detach it after semantic input changes and refresh", async ({
  page,
  request,
}) => {
  const routes = await installRoutes(page, true);
  for (const kind of kinds) {
    if (page.url().startsWith("http")) {
      await page.evaluate(() => window.localStorage.clear());
    }
    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();
    await page.goto("/");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await generateAndWaitForFailure(page, kind);
    await expect(retryButton(page, kind)).toBeVisible();
    await expect.poll(async () => {
      const canvas = await (await request.get("/api/canvas/default")).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      return canvas.nodes.find((node) => node.id === nodeId(kind))
        ?.data[`${kind}GenerationTaskId`];
    }).toBe(`retry-ui-task-${kind}`);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(retryButton(page, kind)).toBeVisible();
    await changePrompt(page, kind);
    await expect(retryButton(page, kind)).toHaveCount(0);
    await expect.poll(async () => {
      const canvas = await (await request.get("/api/canvas/default")).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return data?.[`${kind}GenerationTaskId`] === undefined &&
        data?.[`${kind}GenerationInputKey`] === undefined;
    }).toBe(true);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(retryButton(page, kind)).toHaveCount(0);
  }
  expect(routes.taskSubmissions()).toBe(4);
  expect(routes.providerRequests()).toBe(0);
});

test("four nodes obey server retryAllowed=false before and after refresh", async ({
  page,
  request,
}) => {
  const routes = await installRoutes(page, false);
  for (const kind of kinds) {
    if (page.url().startsWith("http")) {
      await page.evaluate(() => window.localStorage.clear());
    }
    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();
    await page.goto("/");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await generateAndWaitForFailure(page, kind);
    await expect(retryButton(page, kind)).toHaveCount(0);
    const failure = kind === "text"
      ? page.getByTestId("upstream-input-problem")
      : page.getByTestId(`${kind}-node-${nodeId(kind)}`).getByRole("alert");
    await expect(failure).toContainText("不能直接重试");
    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(retryButton(page, kind)).toHaveCount(0);
  }
  expect(routes.taskSubmissions()).toBe(4);
  expect(routes.providerRequests()).toBe(0);
});

for (const kind of ["image", "video"] as const) {
  test(`${kind} keeps the same paid task active when cancellation outcome is unknown`, async ({
    page,
    request,
  }) => {
    const routes = await installCancelOutcomeUnknownRoutes(page);
    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    await page.goto("/");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await selectNode(page, kind);
    const creator = page.getByTestId(`${kind}-creator`);
    await creator.getByRole("button", { name: "Generate" }).click();

    const cancel = creator.getByRole("button", { name: "取消生成" });
    await expect(cancel).toBeVisible();
    await expect(cancel).toBeEnabled();
    await expect.poll(() => routes.statusReads(kind)).toBeGreaterThanOrEqual(1);
    const taskId = `cancel-unknown-task-${kind}`;
    const intentSlot =
      `tapnow:generation-submission:v1:default:${kind}:` +
      encodeURIComponent(nodeId(kind));
    await expect.poll(async () => page.evaluate(({ intentSlot, taskId }) => {
      const serialized = window.localStorage.getItem(intentSlot);
      if (!serialized) return false;
      return (JSON.parse(serialized) as { taskId?: string }).taskId === taskId;
    }, { intentSlot, taskId })).toBe(true);

    await cancel.click();
    await expect(
      page.getByTestId(`${kind}-node-${nodeId(kind)}`).getByRole("alert"),
    ).toContainText("取消结果无法确认，任务仍在查询中");

    await expect(cancel).toBeVisible();
    await expect(cancel).toBeEnabled();
    await expect(creator.getByRole("button", { name: "Generate" }))
      .toHaveCount(0);
    expect(routes.cancelRequests(kind)).toBe(1);
    expect(routes.submissions(kind)).toBe(1);
    const readsAfterCancel = routes.statusReads(kind);
    await expect.poll(() => routes.statusReads(kind), { timeout: 3_000 })
      .toBeGreaterThan(readsAfterCancel);
    await expect.poll(async () => page.evaluate(({ intentSlot, taskId }) => {
      const serialized = window.localStorage.getItem(intentSlot);
      if (!serialized) return false;
      return (JSON.parse(serialized) as { taskId?: string }).taskId === taskId;
    }, { intentSlot, taskId })).toBe(true);
    await expect.poll(async () => {
      const canvas = await (await request.get("/api/canvas/default")).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        generating: data?.[`${kind}Generating`],
        taskId: data?.[`${kind}GenerationTaskId`],
      };
    }).toEqual({ generating: true, taskId });

    expect(routes.providerRequests()).toBe(0);
  });
}

test("relay audio exposes local-only cancellation while Mureka remains unchanged", async ({
  baseURL,
  page,
  request,
}) => {
  let cancelled = false;
  let cancelRequests = 0;
  const externalRequests: string[] = [];
  const localOrigin = new URL(baseURL!).origin;
  page.on("request", (outbound) => {
    const url = new URL(outbound.url());
    if (url.origin !== localOrigin) {
      externalRequests.push(outbound.url());
    }
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [{
          capability: "audio",
          displayName: "Relay Audio fixture",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.audio.id,
          isDefault: true,
          parameterSchema: schemas.audio,
          providerProtocol: "media-generate",
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({ json: { submissionEnabled: true }, status: 200 });
      return;
    }
    if (url.pathname.endsWith("/preflight")) {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    const task = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "USD",
      createdAt: "2026-08-03T12:00:00.000Z",
      ...(cancelled
        ? {
            errorMessage: "已停止本地等待和结果发布；中转站任务可能仍在运行",
          }
        : {}),
      id: "relay-audio-cancel-task",
      kind: "audio",
      model: modelInputs.audio.id,
      nodeId: nodeId("audio"),
      prompt: "audio 原始提示词",
      state: cancelled ? "cancelled" : "running",
      updatedAt: "2026-08-03T12:00:01.000Z",
    };
    if (
      url.pathname === "/api/generation-tasks" &&
      inbound.method() === "POST"
    ) {
      await route.fulfill({ json: { ...task, state: "queued" }, status: 202 });
      return;
    }
    if (
      url.pathname.endsWith("/relay-audio-cancel-task") &&
      inbound.method() === "DELETE"
    ) {
      cancelRequests += 1;
      cancelled = true;
      await route.fulfill({
        json: {
          ...task,
          errorMessage: "已停止本地等待和结果发布；中转站任务可能仍在运行",
          state: "cancelled",
        },
        status: 200,
      });
      return;
    }
    if (
      url.pathname.endsWith("/relay-audio-cancel-task") &&
      inbound.method() === "GET"
    ) {
      await route.fulfill({ json: task, status: 200 });
      return;
    }
    if (url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: canvasNodes("audio"),
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");
  await selectNode(page, "audio");
  const creator = page.getByTestId("audio-creator");
  await creator.getByRole("button", { name: "Generate" }).click();
  const cancel = creator.getByRole("button", { name: "取消生成" });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(page.getByTestId(`audio-node-${nodeId("audio")}`))
    .toContainText("中转站任务可能仍在运行");
  expect(cancelRequests).toBe(1);
  expect(externalRequests).toEqual([]);
});
