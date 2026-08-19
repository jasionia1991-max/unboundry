import { expect, test, type Page } from "./safe-test";
import {
  defaultParameterValues,
  knownModelParameterSchema,
  submissionParameterValues,
  type ModelCapability,
  type ModelParameterValue,
} from "../types/modelParameters";
import { generationInputKey } from
  "../client/src/generation/generationRetry";
import { waitForGenerationTaskWithPause } from
  "../client/src/generation/taskPolling";
import { resolveNodeInputs } from "../types/nodeInputs";

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

function mediaAssetUrl(
  kind: Exclude<Kind, "text">,
  assetId: string,
) {
  return kind === "image"
    ? `/api/assets/${assetId}`
    : kind === "video"
      ? `/api/video-assets/${assetId}`
      : `/api/audio-assets/${assetId}`;
}

function stableSubmissionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSubmissionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "canvasRevision" && key !== "idempotencyKey")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableSubmissionValue(item)]),
    );
  }
  return value;
}

function recoveryRequestSignature(kind: Kind) {
  const prompt = `${kind} 原始提示词`;
  const submittedParameters = submissionParameterValues(
    schemas[kind],
    defaultParameterValues(schemas[kind]),
  );
  const source = JSON.stringify(stableSubmissionValue({
    canvasId: "default",
    inputSchemaVersion: 1,
    inputs: [],
    kind,
    model: modelInputs[kind].id,
    nodeId: nodeId(kind),
    ownPrompt: prompt,
    parameters: kind === "image"
      ? { ...submittedParameters, references: [] }
      : submittedParameters,
    prompt,
  }));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const value = source.charCodeAt(index);
    left = Math.imul(left ^ value, 0x01000193) >>> 0;
    right = Math.imul(right ^ value, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

function compactGenerationOwnershipKey(value: unknown) {
  const source = JSON.stringify(stableSubmissionValue(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

function recoveryOwnershipKey(
  kind: Kind,
  prompt = `${kind} 原始提示词`,
) {
  return compactGenerationOwnershipKey({
    ...(kind === "image"
      ? { aspectRatio: undefined, quality: undefined }
      : {}),
    modelId: modelInputs[kind].id,
    parameters: defaultParameterValues(schemas[kind]),
    prompt,
    upstream: [],
  });
}

function submissionIntentSlot(kind: Kind) {
  return `unboundry:generation-submission:v2:__test__:default:${kind}:` +
    encodeURIComponent(nodeId(kind));
}

async function flushBrowserTasks(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));
}

async function withWindowTimerGlobal<T>(run: () => Promise<T>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
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
  const bindingAcks = new Set<Kind>();
  const statusBeforeBindingAck = new Map<Kind, number>();
  const taskRetries = new Map<Kind, number>();
  const tasks = new Map<string, Record<string, unknown>>();
  const idsByKey = new Map<string, string>();

  page.on("request", (request) => {
    if (/volces|openrouter|mureka/i.test(request.url())) providerRequests += 1;
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() !== "PUT" ||
      new URL(request.url()).pathname !== "/api/canvas/default" ||
      !response.ok()
    ) return;
    try {
      const body = request.postDataJSON() as {
        nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
      };
      for (const kind of kinds) {
        const node = body.nodes?.find((candidate) => candidate.id === nodeId(kind));
        if (
          typeof node?.data?.[`${kind}GenerationTaskId`] === "string" &&
          typeof node.data[`${kind}GenerationInputKey`] === "string" &&
          typeof node.data[`${kind}GenerationOwnershipKey`] === "string"
        ) bindingAcks.add(kind);
      }
    } catch {
      // Non-canvas payloads are irrelevant to the binding ACK observation.
    }
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
        ownPrompt?: string;
        parameters?: Record<string, ModelParameterValue> & {
          references?: unknown;
        };
        prompt: string;
        canvasRevision?: number;
      };
      taskSubmissions += 1;
      const id = `retry-ui-task-${body.kind}`;
      idsByKey.set(body.idempotencyKey, id);
      const keyParameters = { ...(body.parameters ?? {}) };
      delete keyParameters.references;
      const submittedInputKey = generationInputKey({
        inputs: [],
        modelId: body.model,
        ownPrompt: body.ownPrompt,
        parameters: keyParameters,
        prompt: body.prompt,
      });
      const failed = {
        attempt: 1,
        canvasRevision: body.canvasRevision,
        canvasId: "default",
        costCurrency: "CNY",
        createdAt: "2026-08-03T08:00:00.000Z",
        errorCode: retryAllowed ? "AUTH" : "SERVICE_RESTARTED",
        errorMessage: retryAllowed
          ? `${body.kind} 零Provider模拟失败`
          : `${body.kind} 上次生成结果无法确认`,
        id,
        generationInputKey: submittedInputKey,
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
    if (url.pathname.endsWith("/retry") && method === "POST") {
      const id = url.pathname.split("/").at(-2) ?? "";
      const task = tasks.get(id);
      const kind = task?.kind;
      if (!task || typeof kind !== "string" || !kinds.includes(kind as Kind)) {
        await route.fulfill({
          contentType: "application/json",
          json: { error: "Unknown fake retry task" },
          status: 404,
        });
        return;
      }
      const retryKind = kind as Kind;
      taskRetries.set(retryKind, (taskRetries.get(retryKind) ?? 0) + 1);
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...task,
          attempt: Number(task.attempt ?? 0) + 1,
          retryAllowed: false,
          state: "queued",
          updatedAt: "2026-08-03T08:00:02.000Z",
        },
        status: 202,
      });
      return;
    }
    const id = url.pathname.split("/").at(-1) ?? "";
    if (method === "GET" && tasks.has(id)) {
      const kind = tasks.get(id)?.kind;
      if (typeof kind === "string" && kinds.includes(kind as Kind) &&
        !bindingAcks.has(kind as Kind)) {
        const typedKind = kind as Kind;
        statusBeforeBindingAck.set(
          typedKind,
          (statusBeforeBindingAck.get(typedKind) ?? 0) + 1,
        );
      }
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
    bindingAcked: (kind: Kind) => bindingAcks.has(kind),
    providerRequests: () => providerRequests,
    taskRetries: (kind: Kind) => taskRetries.get(kind) ?? 0,
    taskSubmissions: () => taskSubmissions,
    statusBeforeBindingAck: (kind: Kind) =>
      statusBeforeBindingAck.get(kind) ?? 0,
  };
}

type SaveFenceOutcome = "load-required" | "pass";

async function installCanvasSaveFence(page: Page) {
  let armed:
    | { kind: Kind; outcome: SaveFenceOutcome; title: string }
    | undefined;
  const matched = new Map<string, number>();

  await page.route("**/api/canvas/default", async (route) => {
    const request = route.request();
    if (request.method() !== "PUT" || !armed) {
      await route.continue();
      return;
    }
    let body: {
      nodes?: Array<{ data?: { title?: unknown }; id?: unknown }>;
    };
    try {
      body = request.postDataJSON() as typeof body;
    } catch {
      await route.continue();
      return;
    }
    const expected = armed;
    const title = body.nodes?.find((node) => node.id === nodeId(expected.kind))
      ?.data?.title;
    if (title !== expected.title) {
      await route.continue();
      return;
    }
    armed = undefined;
    const key = `${expected.kind}:${expected.outcome}`;
    matched.set(key, (matched.get(key) ?? 0) + 1);
    if (expected.outcome === "pass") {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Reload required before retrying generation",
      },
      status: 409,
    });
  });

  return {
    arm(kind: Kind, title: string, outcome: SaveFenceOutcome) {
      if (armed) throw new Error("A canvas save fence is already armed");
      armed = { kind, outcome, title };
    },
    matched: (kind: Kind, outcome: SaveFenceOutcome) =>
      matched.get(`${kind}:${outcome}`) ?? 0,
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

async function clickRetryWithCapturedTitleChange(
  page: Page,
  kind: Kind,
  title: string,
) {
  const button = retryButton(page, kind);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.evaluate((element, payload) => {
    const button = element as HTMLButtonElement;
    const input = document.querySelector(
      `.react-flow__node[data-id="${payload.nodeId}"] ` +
        'input[placeholder="请输入标题"]',
    );
    if (!(input instanceof HTMLInputElement) || button.disabled) {
      throw new Error("Expected an enabled retry handler and editable title");
    }
    document.documentElement.removeAttribute("data-m41-retry-capture");
    button.addEventListener("click", () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!valueSetter) throw new Error("Missing native input value setter");
      valueSetter.call(input, payload.title);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: payload.title,
        inputType: "insertText",
      }));
      document.documentElement.setAttribute(
        "data-m41-retry-capture",
        payload.title,
      );
    }, { capture: true, once: true });
  }, { nodeId: nodeId(kind), title });
  await button.click();
  await expect(page.locator("html"))
    .toHaveAttribute("data-m41-retry-capture", title);
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

test("an aborted task poll exits without showing a transient polling pause", async () => {
  const originalFetch = globalThis.fetch;
  let pauses = 0;
  globalThis.fetch = async () => {
    throw new DOMException("scope changed", "AbortError");
  };
  try {
    await withWindowTimerGlobal(async () => {
      await expect(
        waitForGenerationTaskWithPause("aborted-task", () => {
          pauses += 1;
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(pauses).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("four retry handlers save first and fail closed on LOAD_REQUIRED", async ({
  page,
  request,
}) => {
  const routes = await installRoutes(page, true);
  const saveFence = await installCanvasSaveFence(page);

  for (const kind of kinds) {
    if (page.url().startsWith("http")) {
      await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
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

    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await generateAndWaitForFailure(page, kind);
    await expect.poll(() => routes.bindingAcked(kind)).toBe(true);
    expect(routes.statusBeforeBindingAck(kind)).toBe(0);
    await expect(retryButton(page, kind)).toBeEnabled();
    await expect.poll(async () => {
      const canvas = await (await request.get("/api/canvas/default")).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const node = canvas.nodes.find((candidate) => candidate.id === nodeId(kind));
      return {
        inputKey: typeof node?.data[`${kind}GenerationInputKey`],
        ownershipKey: typeof node?.data[`${kind}GenerationOwnershipKey`],
        taskId: node?.data[`${kind}GenerationTaskId`],
      };
    }).toEqual({
      inputKey: "string",
      ownershipKey: "string",
      taskId: `retry-ui-task-${kind}`,
    });
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    const savedTitle = `${kind} retry after saved title`;
    saveFence.arm(kind, savedTitle, "pass");
    await clickRetryWithCapturedTitleChange(page, kind, savedTitle);
    await expect.poll(() => saveFence.matched(kind, "pass")).toBe(1);
    await expect.poll(() => routes.taskRetries(kind)).toBe(1);
    await expect(retryButton(page, kind)).toBeEnabled();
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    const blockedTitle = `${kind} retry blocked title`;
    saveFence.arm(kind, blockedTitle, "load-required");
    await clickRetryWithCapturedTitleChange(page, kind, blockedTitle);
    await expect.poll(() => saveFence.matched(kind, "load-required")).toBe(1);
    await expect(page.getByTestId("save-conflict")).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("保存失败");
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    expect(routes.taskRetries(kind)).toBe(1);
  }

  expect(routes.taskSubmissions()).toBe(4);
  expect(routes.providerRequests()).toBe(0);
});

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
    await page.goto("/canvas");
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
    await page.goto("/canvas");
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

    await page.goto("/canvas");
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
      `unboundry:generation-submission:v2:__test__:default:${kind}:` +
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

test("four nodes pin the effective default before a lost paid response and recover the same task after catalog drift", async ({
  page,
  request,
}) => {
  type CanvasAck = {
    data: Record<string, unknown>;
    graphRevision?: number;
  };
  type PostEvidence = {
    ackedSnapshot: boolean;
    canvasRevision?: number;
    model?: string;
  };

  let currentKind: Kind = "text";
  let defaultVersion: "A" | "B" = "A";
  let providerRequests = 0;
  const builtTasks = new Set<Kind>();
  const lostLookups = new Set<Kind>();
  const canvasAcks = new Map<Kind, CanvasAck>();
  const createPosts = new Map<Kind, number>();
  const postEvidence = new Map<Kind, PostEvidence>();

  const providerRequestListener = (inbound: { url(): string }) => {
    if (/volces|openrouter|mureka/i.test(inbound.url())) providerRequests += 1;
  };
  const canvasResponseListener = (response: {
    json(): Promise<unknown>;
    ok(): boolean;
    request(): {
      method(): string;
      postDataJSON(): unknown;
      url(): string;
    };
  }) => {
    const inbound = response.request();
    if (
      !response.ok() ||
      inbound.method() !== "PUT" ||
      new URL(inbound.url()).pathname !== "/api/canvas/default"
    ) return;
    const body = inbound.postDataJSON() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    for (const kind of kinds) {
      const data = body.nodes?.find((node) => node.id === nodeId(kind))?.data;
      if (!data) continue;
      const ack: CanvasAck = { data };
      canvasAcks.set(kind, ack);
      void response.json().then((value) => {
        const graphRevision = (value as { graphRevision?: unknown })
          ?.graphRevision;
        if (Number.isSafeInteger(graphRevision)) {
          ack.graphRevision = Number(graphRevision);
        }
      }).catch(() => undefined);
    }
  };
  page.on("request", providerRequestListener);
  page.on("response", canvasResponseListener);

  await page.route("**/api/models", async (route) => {
    const kind = currentKind;
    const published = (["A", "B"] as const).map((version) => ({
      capability: kind,
      displayName: `Default ${version} ${kind}`,
      generationAvailable: true,
      generationUnavailableReason: "",
      generationUnavailableReasonCode: null,
      id: version === "A"
        ? modelInputs[kind].id
        : `${modelInputs[kind].id}-v2`,
      isDefault: version === defaultVersion,
      parameterSchema: schemas[kind],
    }));
    await route.fulfill({
      json: { generationEnabled: true, models: published },
      status: 200,
    });
  });

  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    const kind = currentKind;
    const taskId = `default-drift-lost-task-${kind}`;
    const prompt = `${kind} 原始提示词`;
    const inputKey = generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: prompt,
      parameters: submissionParameterValues(
        schemas[kind],
        defaultParameterValues(schemas[kind]),
      ),
      prompt,
    });
    const failedTask = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-12T08:00:00.000Z",
      errorCode: "DEFAULT_DRIFT_FIXTURE",
      errorMessage: `${kind} default drift fixture failure`,
      generationInputKey: inputKey,
      id: taskId,
      kind,
      nodeId: nodeId(kind),
      prompt,
      retryAllowed: false,
      retryBlockCode: "DEFAULT_DRIFT_FIXTURE",
      retryBlockReason: "fixture blocks retry",
      state: "failed",
      updatedAt: "2026-08-12T08:00:01.000Z",
    };

    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      if (!builtTasks.has(kind)) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (!lostLookups.has(kind)) {
        lostLookups.add(kind);
        await route.abort("failed");
        return;
      }
      await route.fulfill({ json: failedTask, status: 200 });
      return;
    }
    if (
      url.pathname === `/api/generation-tasks/${taskId}` &&
      inbound.method() === "GET"
    ) {
      await route.fulfill({ json: failedTask, status: 200 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
      await route.fulfill({ json: { tasks: builtTasks.has(kind) ? [failedTask] : [] }, status: 200 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
      const body = inbound.postDataJSON() as {
        canvasRevision?: number;
        model?: string;
      };
      createPosts.set(kind, (createPosts.get(kind) ?? 0) + 1);
      const ack = canvasAcks.get(kind);
      const modelNameKey = kind === "video" ? "videoModel" : `${kind}ModelName`;
      const expectedParameters = defaultParameterValues(schemas[kind]);
      const ackedParameters = ack?.data[`${kind}Parameters`];
      postEvidence.set(kind, {
        ackedSnapshot: Boolean(
          ack &&
          ack.data[`${kind}ModelId`] === modelInputs[kind].id &&
          ack.data[modelNameKey] === `Default A ${kind}` &&
          JSON.stringify(ackedParameters) ===
            JSON.stringify(expectedParameters) &&
          (kind !== "image" || (
            ack.data.imageAspectRatio === expectedParameters.aspectRatio &&
            ack.data.imageQuality === expectedParameters.quality
          ))
        ),
        canvasRevision: body.canvasRevision,
        model: body.model,
      });
      builtTasks.add(kind);
      // The server-side task exists, but neither the POST response nor the
      // immediate idempotency reconciliation reaches this page.
      await route.abort("failed");
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  try {
    for (const kind of kinds) {
      currentKind = kind;
      defaultVersion = "A";
      builtTasks.delete(kind);
      lostLookups.delete(kind);
      canvasAcks.delete(kind);
      createPosts.delete(kind);
      postEvidence.delete(kind);
      if (page.url().startsWith("http")) {
        await page.evaluate(() => {
          window.localStorage.clear();
          window.sessionStorage.clear();
        });
      }

      await request.delete("/api/canvas/default");
      const [baseNode] = canvasNodes(kind);
      const data = { ...baseNode.data } as Record<string, unknown>;
      delete data[`${kind}ModelId`];
      delete data[`${kind}Parameters`];
      delete data[kind === "video" ? "videoModel" : `${kind}ModelName`];
      if (kind === "image") {
        delete data.imageAspectRatio;
        delete data.imageQuality;
      }
      expect((await request.put("/api/canvas/default", {
        data: {
          edges: [],
          nodes: [{ ...baseNode, data }],
          revision: 0,
          viewport: { x: 0, y: 0, zoom: 0.75 },
        },
      })).ok()).toBeTruthy();

      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const generate = page.getByTestId(`${kind}-creator`)
        .getByRole("button", { name: "Generate" });
      await expect(generate).toBeEnabled();
      await generate.click();
      await expect.poll(() => createPosts.get(kind) ?? 0).toBe(1);
      await expect.poll(() => lostLookups.has(kind)).toBe(true);
      await expect(generate).toBeEnabled();

      const evidence = postEvidence.get(kind);
      expect(evidence).toMatchObject({
        ackedSnapshot: true,
        model: modelInputs[kind].id,
      });
      await expect.poll(() => canvasAcks.get(kind)?.graphRevision)
        .toBe(evidence?.canvasRevision);

      const expectedParameters = defaultParameterValues(schemas[kind]);
      const beforeReload = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const pinnedBeforeReload = beforeReload.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data;
      expect(pinnedBeforeReload?.[`${kind}ModelId`])
        .toBe(modelInputs[kind].id);
      expect(pinnedBeforeReload?.[`${kind}Parameters`])
        .toEqual(expectedParameters);
      expect(pinnedBeforeReload?.[`${kind}GenerationTaskId`]).toBeUndefined();
      if (kind === "image") {
        expect(pinnedBeforeReload?.imageAspectRatio)
          .toBe(expectedParameters.aspectRatio);
        expect(pinnedBeforeReload?.imageQuality)
          .toBe(expectedParameters.quality);
      }
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), submissionIntentSlot(kind)))
        .not.toBeNull();

      defaultVersion = "B";
      await page.reload();
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        return canvas.nodes.find((node) => node.id === nodeId(kind))
          ?.data[`${kind}GenerationTaskId`];
      }).toBe(`default-drift-lost-task-${kind}`);

      const recovered = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const recoveredData = recovered.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data;
      expect(recoveredData?.[`${kind}ModelId`]).toBe(modelInputs[kind].id);
      expect(recoveredData?.[`${kind}Parameters`]).toEqual(expectedParameters);
      if (kind === "image") {
        expect(recoveredData?.imageAspectRatio)
          .toBe(expectedParameters.aspectRatio);
        expect(recoveredData?.imageQuality).toBe(expectedParameters.quality);
      }
      expect(createPosts.get(kind)).toBe(1);
      expect(providerRequests).toBe(0);
    }
  } finally {
    page.off("request", providerRequestListener);
    page.off("response", canvasResponseListener);
    await page.unroute("**/api/models");
    await page.unroute("**/api/generation-tasks**");
    await request.delete("/api/canvas/default");
  }
});

for (const lateCancelCase of (["video", "audio"] as const).flatMap(
  (kind) => (["success", "error"] as const).map((outcome) => ({ kind, outcome })),
)) {
  const { kind, outcome } = lateCancelCase;
  test(`${kind} ignores a late old-cancel ${outcome} after changed input starts a new owned run`, async ({
    page,
    request,
  }) => {
    const oldTaskId = `m41-${kind}-late-cancel-old`;
    const newTaskId = `m41-${kind}-late-cancel-new`;
    const newPrompt = `${kind} new owner prompt`;
    const oldCancelMessage = `${kind} old cancel ${outcome} must stay hidden`;
    const oldRunning = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T14:00:00.000Z",
      id: oldTaskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      state: "running",
      updatedAt: "2026-08-09T14:00:00.500Z",
    };
    const newQueued = {
      ...oldRunning,
      createdAt: "2026-08-09T14:00:01.000Z",
      id: newTaskId,
      prompt: newPrompt,
      state: "queued",
      updatedAt: "2026-08-09T14:00:01.500Z",
    };
    const resultAssetId = `m41-${kind}-late-cancel-result`;
    const newSuccess = {
      ...newQueued,
      resultAssetId,
      resultMedia: {
        byteSize: 1_024,
        contentType: kind === "video" ? "video/mp4" : "audio/mpeg",
        durationSeconds: 8,
        durationStatus: "ready",
        storageBackend: "local",
      },
      resultUrl: mediaAssetUrl(kind, resultAssetId),
      state: "success",
      updatedAt: "2026-08-09T14:00:02.000Z",
    };
    let cancelRequests = 0;
    let createPosts = 0;
    let listOldTask = true;
    let oldTaskReads = 0;
    let markCancelStarted!: () => void;
    const cancelStarted = new Promise<void>((resolve) => {
      markCancelStarted = resolve;
    });
    let markNewPollStarted!: () => void;
    const newPollStarted = new Promise<void>((resolve) => {
      markNewPollStarted = resolve;
    });
    let markOldPollStarted!: () => void;
    const oldPollStarted = new Promise<void>((resolve) => {
      markOldPollStarted = resolve;
    });
    let providerRequests = 0;
    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let releaseNewPoll!: () => void;
    const newPollGate = new Promise<void>((resolve) => {
      releaseNewPoll = resolve;
    });
    let releaseOldPoll!: () => void;
    const oldPollGate = new Promise<void>((resolve) => {
      releaseOldPoll = resolve;
    });

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    if (kind === "audio") {
      await page.route("**/api/audio-assets/**", async (route) => {
        await route.fulfill({ body: "", status: 404 });
      });
    }
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} late cancel owner`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            id: modelInputs[kind].id,
            isDefault: true,
            parameterSchema: schemas[kind],
            ...(kind === "audio"
              ? { providerProtocol: "media-generate" }
              : {}),
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
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
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({
          json: { tasks: listOldTask ? [oldRunning] : [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${oldTaskId}` &&
        inbound.method() === "GET"
      ) {
        oldTaskReads += 1;
        if (oldTaskReads === 1) {
          await route.fulfill({ json: oldRunning, status: 200 });
          return;
        }
        markOldPollStarted();
        await oldPollGate;
        await route.fulfill({ json: oldRunning, status: 200 }).catch(() => undefined);
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${oldTaskId}` &&
        inbound.method() === "DELETE"
      ) {
        cancelRequests += 1;
        listOldTask = false;
        markCancelStarted();
        await cancelGate;
        if (outcome === "success") {
          await route.fulfill({
            json: {
              ...oldRunning,
              errorMessage: oldCancelMessage,
              state: "cancelled",
            },
            status: 200,
          }).catch(() => undefined);
        } else {
          await route.fulfill({
            json: { code: "OLD_CANCEL_FAILED", error: oldCancelMessage },
            status: 500,
          }).catch(() => undefined);
        }
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        createPosts += 1;
        await route.fulfill({ json: newQueued, status: 202 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${newTaskId}` &&
        inbound.method() === "GET"
      ) {
        markNewPollStarted();
        await newPollGate;
        await route.fulfill({ json: newSuccess, status: 200 }).catch(() => undefined);
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const oldInputKey = generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: `${kind} 原始提示词`,
      parameters: submissionParameterValues(
        schemas[kind],
        defaultParameterValues(schemas[kind]),
      ),
      prompt: `${kind} 原始提示词`,
    });
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            [`${kind}Generating`]: true,
            [`${kind}GenerationInputKey`]: oldInputKey,
            [`${kind}GenerationTaskId`]: oldTaskId,
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await oldPollStarted;
      await selectNode(page, kind);
      const creator = page.getByTestId(`${kind}-creator`);
      const cancel = creator.getByRole("button", { name: "取消生成" });
      await expect(cancel).toBeEnabled();
      await cancel.click();
      await cancelStarted;
      expect(cancelRequests).toBe(1);

      const prompt = kind === "audio"
        ? page.getByLabel("音频提示词")
        : page.getByTestId("video-creator-prompt");
      await prompt.evaluate((element) => {
        element.removeAttribute("disabled");
      });
      await prompt.fill(newPrompt);
      await prompt.blur();
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          generating: data?.[`${kind}Generating`],
          prompt: data?.[`${kind}Prompt`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({ generating: false, prompt: newPrompt, taskId: null });

      await creator.getByRole("button", { name: "Generate" }).click();
      await newPollStarted;
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          generating: data?.[`${kind}Generating`],
          prompt: data?.[`${kind}Prompt`],
          taskId: data?.[`${kind}GenerationTaskId`],
        };
      }).toEqual({ generating: true, prompt: newPrompt, taskId: newTaskId });
      expect(createPosts).toBe(1);

      const oldCancelResponse = page.waitForResponse((response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname ===
          `/api/generation-tasks/${oldTaskId}`);
      releaseCancel();
      await oldCancelResponse;
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);
      const node = page.getByTestId(`${kind}-node-${nodeId(kind)}`);
      await expect(node).not.toContainText(oldCancelMessage);
      await expect(node.getByRole("alert")).toHaveCount(0);
      await expect(prompt).toHaveValue(newPrompt);
      const afterOldCancel = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      expect(afterOldCancel.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data).toEqual(expect.objectContaining({
        [`${kind}Generating`]: true,
        [`${kind}GenerationTaskId`]: newTaskId,
        [`${kind}Prompt`]: newPrompt,
      }));

      releaseNewPoll();
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          generating: data?.[`${kind}Generating`],
          prompt: data?.[`${kind}Prompt`],
          src: data?.[`${kind}Src`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({
        generating: false,
        prompt: newPrompt,
        src: mediaAssetUrl(kind, resultAssetId),
        taskId: null,
      });
      expect(cancelRequests).toBe(1);
      expect(createPosts).toBe(1);
      expect(providerRequests).toBe(0);
    } finally {
      releaseCancel();
      releaseNewPoll();
      releaseOldPoll();
      await request.delete("/api/canvas/default");
    }
  });
}

test("a caller-owned AbortSignal stops task polling without reporting a pause", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  let pauses = 0;
  globalThis.fetch = async (_input, init) => {
    markFetchStarted();
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("caller stopped", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  try {
    await withWindowTimerGlobal(async () => {
      const polling = waitForGenerationTaskWithPause(
        "caller-aborted-task",
        () => {
          pauses += 1;
        },
        controller.signal,
      );
      await fetchStarted;
      controller.abort("scope changed");
      await expect(polling).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(pauses).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an old Image poll cannot overwrite the newer task after cancellation and input revocation", async ({
  page,
  request,
}) => {
  const oldTaskId = "m41-image-old-owner-task";
  const newTaskId = "m41-image-new-owner-task";
  const newPrompt = "image 新提示词";
  const oldRunning = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T12:00:00.000Z",
    id: oldTaskId,
    kind: "image",
    model: modelInputs.image.id,
    nodeId: nodeId("image"),
    prompt: "image 原始提示词",
    state: "running",
    updatedAt: "2026-08-09T12:00:00.500Z",
  };
  const oldSuccess = {
    ...oldRunning,
    resultAssetId: "m41-image-old-owner-result",
    resultMedia: {
      byteSize: 701,
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable",
      storageBackend: "local",
    },
    resultUrl: "/api/assets/m41-image-old-owner-result",
    state: "success",
    updatedAt: "2026-08-09T12:00:03.000Z",
  };
  const newQueued = {
    ...oldRunning,
    createdAt: "2026-08-09T12:00:01.000Z",
    id: newTaskId,
    prompt: newPrompt,
    state: "queued",
    updatedAt: "2026-08-09T12:00:01.500Z",
  };
  const newSuccess = {
    ...newQueued,
    resultAssetId: "m41-image-new-owner-result",
    resultMedia: {
      byteSize: 702,
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable",
      storageBackend: "local",
    },
    resultUrl: "/api/assets/m41-image-new-owner-result",
    state: "success",
    updatedAt: "2026-08-09T12:00:02.000Z",
  };
  await page.addInitScript(({ oldRunning, oldSuccess, oldTaskId }) => {
    const state: {
      oldGets: number;
      releaseOld?: () => void;
    } = { oldGets: 0 };
    (window as typeof window & {
      __m41ImageOldOwner?: typeof state;
    }).__m41ImageOldOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${oldTaskId}`
      ) {
        state.oldGets += 1;
        if (state.oldGets === 1) {
          return Promise.resolve(new Response(JSON.stringify(oldRunning), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }));
        }
        return new Promise<Response>((resolve) => {
          // Intentionally ignore the recovery effect's abort. Ownership, not
          // transport cooperation, must reject this late success.
          state.releaseOld = () => resolve(new Response(
            JSON.stringify(oldSuccess),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ));
        });
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, { oldRunning, oldSuccess, oldTaskId });

  let newGets = 0;
  let oldCancelled = false;
  let providerRequests = 0;
  let submittedPrompt = "";
  let taskSubmissions = 0;
  let releaseNew!: () => void;
  const newGate = new Promise<void>((resolve) => {
    releaseNew = resolve;
  });
  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "Image owner replacement",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.image.id,
          isDefault: true,
          parameterSchema: schemas.image,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, problems: [] },
        status: 200,
      });
      return;
    }
    if (
      url.pathname === `/api/generation-tasks/${oldTaskId}` &&
      inbound.method() === "DELETE"
    ) {
      oldCancelled = true;
      await route.fulfill({
        json: {
          ...oldRunning,
          errorMessage: "用户取消旧图片任务",
          state: "cancelled",
        },
        status: 200,
      });
      return;
    }
    if (
      url.pathname === "/api/generation-tasks" &&
      inbound.method() === "GET"
    ) {
      await route.fulfill({
        json: { tasks: oldCancelled ? [] : [oldRunning] },
        status: 200,
      });
      return;
    }
    if (
      url.pathname === "/api/generation-tasks" &&
      inbound.method() === "POST"
    ) {
      taskSubmissions += 1;
      const body = inbound.postDataJSON() as { prompt?: string };
      submittedPrompt = body.prompt ?? "";
      await route.fulfill({ json: newQueued, status: 202 });
      return;
    }
    if (
      url.pathname === `/api/generation-tasks/${newTaskId}` &&
      inbound.method() === "GET"
    ) {
      newGets += 1;
      await newGate;
      await route.fulfill({ json: newSuccess, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const oldInputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.image.id,
    ownPrompt: "image 原始提示词",
    parameters: submissionParameterValues(
      schemas.image,
      defaultParameterValues(schemas.image),
    ),
    prompt: "image 原始提示词",
  });
  const oldOwnershipKey = recoveryOwnershipKey("image");
  const [baseNode] = canvasNodes("image");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          assetId: "m41-image-old-preview",
          imageGeneratedSuccess: true,
          imageGenerating: true,
          imageGenerationInputKey: oldInputKey,
          imageGenerationOwnershipKey: oldOwnershipKey,
          imageGenerationTaskId: oldTaskId,
          imageSrc: "/api/assets/m41-image-old-preview",
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41ImageOldOwner?: { oldGets: number };
      }).__m41ImageOldOwner?.oldGets ?? 0)).toBeGreaterThanOrEqual(2);
    await selectNode(page, "image");
    const creator = page.getByTestId("image-creator");
    const cancel = creator.getByRole("button", { name: "取消生成" });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId("image"))?.data;
      return {
        generating: data?.imageGenerating,
        taskId: data?.imageGenerationTaskId ?? null,
      };
    }).toEqual({ generating: false, taskId: null });

    const prompt = page.getByTestId("image-creator-prompt");
    await prompt.fill(newPrompt);
    await prompt.blur();
    await creator.getByRole("button", { name: "Generate" }).click();
    await expect.poll(() => newGets).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId("image"))?.data;
      return {
        generating: data?.imageGenerating,
        taskId: data?.imageGenerationTaskId,
      };
    }).toEqual({ generating: true, taskId: newTaskId });

    releaseNew();
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId("image"))?.data;
      return {
        assetId: data?.assetId,
        generating: data?.imageGenerating,
        src: data?.imageSrc,
        taskId: data?.imageGenerationTaskId ?? null,
      };
    }).toEqual({
      assetId: "m41-image-new-owner-result",
      generating: false,
      src: "/api/assets/m41-image-new-owner-result",
      taskId: null,
    });

    await page.evaluate(() => {
      (window as typeof window & {
        __m41ImageOldOwner?: { releaseOld?: () => void };
      }).__m41ImageOldOwner?.releaseOld?.();
    });
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    await expect(page.getByTestId("image-node-preview")).toHaveAttribute(
      "src",
      "/api/assets/m41-image-new-owner-result",
    );
    const finalCanvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    expect(finalCanvas.nodes.find((node) => node.id === nodeId("image"))?.data)
      .toEqual(expect.objectContaining({
        assetId: "m41-image-new-owner-result",
        imageGenerating: false,
        imageSrc: "/api/assets/m41-image-new-owner-result",
      }));
    expect(finalCanvas.nodes.find((node) => node.id === nodeId("image"))?.data
      .imageGenerationTaskId).toBeUndefined();
    expect(submittedPrompt).toBe(newPrompt);
    expect(taskSubmissions).toBe(1);
    expect(providerRequests).toBe(0);
  } finally {
    releaseNew();
    await page.evaluate(() => {
      (window as typeof window & {
        __m41ImageOldOwner?: { releaseOld?: () => void };
      }).__m41ImageOldOwner?.releaseOld?.();
    }).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

for (const retryPollingCase of [
  { failure: "GET 500", kind: "image" },
  { failure: "GET 500", kind: "video" },
  { failure: "GET 500", kind: "audio" },
  { failure: "fetch hung", kind: "image" },
  { failure: "body hung", kind: "image" },
] as const) {
  const { failure, kind } = retryPollingCase;
  test(`${kind} retry acceptance pauses on ${failure}, then rechecks the same task without another POST`, async ({
    page,
    request,
  }) => {
    const taskId = `m41-${kind}-retry-poll-${failure.replaceAll(" ", "-")}`;
    const resultAssetId = `m41-${kind}-retry-poll-result-${failure.replaceAll(" ", "-")}`;
    const submittedParameters = submissionParameterValues(
      schemas[kind],
      defaultParameterValues(schemas[kind]),
    );
    const inputKey = generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: `${kind} 原始提示词`,
      parameters: submittedParameters,
      prompt: `${kind} 原始提示词`,
    });
    const ownershipKey = recoveryOwnershipKey(kind);
    const failedTask = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T12:30:00.000Z",
      errorCode: "AUTH",
      errorMessage: `${kind} retry fixture failure`,
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      retryAllowed: true,
      state: "failed",
      updatedAt: "2026-08-09T12:30:00.500Z",
    };
    const queuedTask = {
      ...failedTask,
      attempt: 2,
      errorCode: undefined,
      errorMessage: undefined,
      retryAllowed: false,
      state: "queued",
      updatedAt: "2026-08-09T12:30:01.000Z",
    };
    const successTask = {
      ...queuedTask,
      resultAssetId,
      resultMedia: {
        byteSize: 800,
        contentType: kind === "image"
          ? "image/png"
          : kind === "video"
            ? "video/mp4"
            : "audio/mpeg",
        durationSeconds: kind === "image" ? null : 6,
        durationStatus: kind === "image" ? "not-applicable" : "ready",
        storageBackend: "local",
      },
      resultUrl: mediaAssetUrl(kind, resultAssetId),
      state: "success",
      updatedAt: "2026-08-09T12:30:02.000Z",
    };
    if (failure !== "GET 500") {
      await page.clock.install();
      await page.addInitScript(({ failure, taskId }) => {
        const state = { hungStarts: 0, retryAccepted: false };
        (window as typeof window & {
          __m41RetryHungDetail?: typeof state;
        }).__m41RetryHungDetail = state;
        const originalFetch = window.fetch.bind(window);
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const raw = typeof input === "string" || input instanceof URL
            ? String(input)
            : input.url;
          const url = new URL(raw, window.location.href);
          const method = (init?.method ??
            (input instanceof Request ? input.method : "GET")).toUpperCase();
          if (
            method === "GET" &&
            url.pathname === `/api/generation-tasks/${taskId}` &&
            state.retryAccepted &&
            state.hungStarts === 0
          ) {
            state.hungStarts += 1;
            if (failure === "fetch hung") {
              return new Promise<Response>(() => {
                // The status deadline must not depend on fetch honoring abort.
              });
            }
            const response = new Response(null, {
              headers: { "Content-Type": "application/json" },
              status: 200,
            });
            Object.defineProperty(response, "json", {
              configurable: true,
              value: () => new Promise(() => {
                // Headers arrived, but the body permanently ignores abort.
              }),
            });
            return Promise.resolve(response);
          }
          return originalFetch(input, init);
        }) as typeof window.fetch;
      }, { failure, taskId });
    }

    let createPosts = 0;
    let postAcceptanceDetailReads = 0;
    let providerRequests = 0;
    let retryAccepted = false;
    let retryPosts = 0;
    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    if (kind === "audio") {
      await page.route("**/api/audio-assets/**", async (route) => {
        await route.fulfill({ body: "", status: 404 });
      });
    }
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} retry polling`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            id: modelInputs[kind].id,
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
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
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({
          json: { tasks: retryAccepted ? [] : [failedTask] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}/retry` &&
        inbound.method() === "POST"
      ) {
        retryPosts += 1;
        retryAccepted = true;
        if (failure !== "GET 500") {
          await page.evaluate(() => {
            const state = (window as typeof window & {
              __m41RetryHungDetail?: {
                retryAccepted: boolean;
              };
            }).__m41RetryHungDetail;
            if (state) state.retryAccepted = true;
          });
        }
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        if (!retryAccepted) {
          await route.fulfill({ json: failedTask, status: 200 });
          return;
        }
        postAcceptanceDetailReads += 1;
        if (failure === "GET 500" && postAcceptanceDetailReads === 1) {
          await route.fulfill({
            json: { code: "TEMPORARY", error: "temporary status outage" },
            status: 500,
          });
        } else {
          await route.fulfill({ json: successTask, status: 200 });
        }
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        createPosts += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            [`${kind}GenerationError`]: `${kind} retry fixture failure`,
            [`${kind}GenerationErrorCode`]: "AUTH",
            [`${kind}GenerationInputKey`]: inputKey,
            [`${kind}GenerationOwnershipKey`]: ownershipKey,
            [`${kind}Generating`]: false,
            [`${kind}GenerationRetryAllowed`]: true,
            [`${kind}GenerationTaskId`]: taskId,
            ...(kind === "audio"
              ? {}
              : {
                  [`${kind}Src`]: mediaAssetUrl(
                    kind,
                    `m41-${kind}-retry-old`,
                  ),
                }),
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas", { waitUntil: "domcontentloaded" });
      if (failure !== "GET 500") {
        await flushBrowserTasks(page);
        await page.clock.runFor(200);
      }
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const retry = retryButton(page, kind);
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect.poll(() => retryPosts).toBe(1);
      if (failure !== "GET 500") {
        await expect.poll(() => page.evaluate(() =>
          (window as typeof window & {
            __m41RetryHungDetail?: { hungStarts: number };
          }).__m41RetryHungDetail?.hungStarts ?? 0)).toBe(1);
        await page.clock.fastForward(10_100);
      }

      const node = page.getByTestId(`${kind}-node-${nodeId(kind)}`);
      await expect(node.getByRole("alert")).toContainText("点击重试重新检查");
      const recheck = node.getByRole("button", { name: "重新检查任务状态" });
      await expect(recheck).toBeVisible();
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          errorCode: data?.[`${kind}GenerationErrorCode`] ?? null,
          generating: data?.[`${kind}Generating`],
          taskId: data?.[`${kind}GenerationTaskId`],
        };
      }).toEqual({ errorCode: null, generating: true, taskId });
      expect(retryPosts).toBe(1);
      expect(createPosts).toBe(0);

      await recheck.click();
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          errorCode: data?.[`${kind}GenerationErrorCode`] ?? null,
          generating: data?.[`${kind}Generating`],
          src: data?.[`${kind}Src`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({
        errorCode: null,
        generating: false,
        src: mediaAssetUrl(kind, resultAssetId),
        taskId: null,
      });
      expect(retryPosts).toBe(1);
      expect(createPosts).toBe(0);
      expect(providerRequests).toBe(0);
    } finally {
      await request.delete("/api/canvas/default");
    }
  });
}

// Generate is intentionally disabled as soon as the canvas becomes dirty.
// Retry stays clickable and owns the wait-for-save gate covered below; the
// paid create path's final input fence is covered by the held ensure tests.
for (const saveGateCase of (["image", "video", "audio"] as const).flatMap(
  (kind) => [
    { inputChanged: true, kind },
    { inputChanged: false, kind },
  ],
)) {
  const { inputChanged, kind } = saveGateCase;
  test(`${kind} Retry save gate ${
    inputChanged ? "cancels after an input change" : "submits exactly once for unchanged input"
  }`, async ({ page, request }) => {
    const taskId = `m41-${kind}-retry-save-gate-task`;
    const resultAssetId = `m41-${kind}-retry-save-gate-result`;
    const originalPrompt = `${kind} 原始提示词`;
    const changedPrompt = `${kind} save gate changed prompt`;
    const submittedParameters = submissionParameterValues(
      schemas[kind],
      defaultParameterValues(schemas[kind]),
    );
    const inputKey = generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: originalPrompt,
      parameters: submittedParameters,
      prompt: originalPrompt,
    });
    const ownershipKey = recoveryOwnershipKey(kind, originalPrompt);
    const baseTask = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T13:00:00.000Z",
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: originalPrompt,
      updatedAt: "2026-08-09T13:00:00.500Z",
    };
    const failedTask = {
      ...baseTask,
      errorCode: "AUTH",
      errorMessage: `${kind} retryable fixture failure`,
      retryAllowed: true,
      state: "failed",
    };
    const queuedTask = {
      ...baseTask,
      attempt: 2,
      state: "queued",
      updatedAt: "2026-08-09T13:00:01.000Z",
    };
    const successTask = {
      ...queuedTask,
      resultAssetId,
      resultMedia: {
        byteSize: 900,
        contentType: kind === "image"
          ? "image/png"
          : kind === "video"
            ? "video/mp4"
            : "audio/mpeg",
        durationSeconds: kind === "image" ? null : 7,
        durationStatus: kind === "image" ? "not-applicable" : "ready",
        storageBackend: "local",
      },
      resultUrl: mediaAssetUrl(kind, resultAssetId),
      state: "success",
      updatedAt: "2026-08-09T13:00:02.000Z",
    };
    let createPosts = 0;
    let generationAccepted = false;
    let providerRequests = 0;
    let retryPosts = 0;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let markSaveStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });
    let heldSave = false;

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} save gate`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            id: modelInputs[kind].id,
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
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
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({
          json: {
            tasks: generationAccepted ? [] : [failedTask],
          },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}/retry` &&
        inbound.method() === "POST"
      ) {
        retryPosts += 1;
        generationAccepted = true;
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        createPosts += 1;
        generationAccepted = true;
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({
          json: generationAccepted ? successTask : failedTask,
          status: 200,
        });
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            [`${kind}GenerationError`]: `${kind} retryable fixture failure`,
            [`${kind}GenerationErrorCode`]: "AUTH",
            [`${kind}GenerationInputKey`]: inputKey,
            [`${kind}GenerationOwnershipKey`]: ownershipKey,
            [`${kind}Generating`]: false,
            [`${kind}GenerationRetryAllowed`]: true,
            [`${kind}GenerationTaskId`]: taskId,
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();
    await page.route("**/api/canvas/default", async (route) => {
      if (route.request().method() !== "PUT" || heldSave) {
        await route.continue();
        return;
      }
      heldSave = true;
      markSaveStarted();
      await saveGate;
      await route.continue();
    });

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const title = page.locator(
        `.react-flow__node[data-id="${nodeId(kind)}"] ` +
          'input[placeholder="请输入标题"]',
      );
      await title.fill(`${kind} save gate dirty title`);
      await saveStarted;

      const actionButton = retryButton(page, kind);
      await expect(actionButton).toBeEnabled();
      await actionButton.click();
      await expect(actionButton).toBeDisabled();
      expect(createPosts).toBe(0);
      expect(retryPosts).toBe(0);

      if (inputChanged) {
        const prompt = kind === "audio"
          ? page.getByLabel("音频提示词")
          : page.getByTestId(`${kind}-creator-prompt`);
        await prompt.fill(changedPrompt);
        await prompt.blur();
      }
      releaseSave();
      await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);

      const expectedPosts = inputChanged ? 0 : 1;
      await expect.poll(() => retryPosts).toBe(expectedPosts);
      expect(createPosts).toBe(0);
      if (inputChanged) {
        await expect.poll(async () => {
          const canvas = await (
            await request.get("/api/canvas/default")
          ).json() as {
            nodes: Array<{ data: Record<string, unknown>; id: string }>;
          };
          const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
          return {
            generating: data?.[`${kind}Generating`] ?? false,
            prompt: data?.[`${kind}Prompt`],
            taskId: data?.[`${kind}GenerationTaskId`] ?? null,
          };
        }).toEqual({
          generating: false,
          prompt: changedPrompt,
          taskId: null,
        });
      } else {
        await expect.poll(async () => {
          const canvas = await (
            await request.get("/api/canvas/default")
          ).json() as {
            nodes: Array<{ data: Record<string, unknown>; id: string }>;
          };
          const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
          return {
            generating: data?.[`${kind}Generating`],
            src: data?.[`${kind}Src`],
            taskId: data?.[`${kind}GenerationTaskId`] ?? null,
          };
        }).toEqual({
          generating: false,
          src: mediaAssetUrl(kind, resultAssetId),
          taskId: null,
        });
      }
      expect(providerRequests).toBe(0);
    } finally {
      releaseSave();
      await request.delete("/api/canvas/default");
    }
  });
}

for (const ensureFenceCase of [
  { hold: "by-idempotency", kind: "image" },
  { hold: "preflight", kind: "video" },
  { hold: "preflight", kind: "audio" },
] as const) {
  const { hold, kind } = ensureFenceCase;
  test(`${kind} Generate rechecks live input after held ${hold} and before the paid POST`, async ({
    page,
    request,
  }) => {
    const changedPrompt = `${kind} changed inside ensure`;
    let createPosts = 0;
    let markHeldRequest!: () => void;
    const heldRequestStarted = new Promise<void>((resolve) => {
      markHeldRequest = resolve;
    });
    let providerRequests = 0;
    let releaseHeldRequest!: () => void;
    const heldRequest = new Promise<void>((resolve) => {
      releaseHeldRequest = resolve;
    });
    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `${kind} ensure fence`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            id: modelInputs[kind].id,
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
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
      if (url.pathname.endsWith("/by-idempotency")) {
        if (hold === "by-idempotency") {
          markHeldRequest();
          await heldRequest;
        }
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        if (hold === "preflight") {
          markHeldRequest();
          await heldRequest;
        }
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        createPosts += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      const creator = page.getByTestId(`${kind}-creator`);
      await creator.getByRole("button", { name: "Generate" }).click();
      await heldRequestStarted;
      await expect(creator.getByRole("button", {
        name: /正在保存画布|Submitting\.\.\./,
      })).toBeDisabled();
      expect(createPosts).toBe(0);

      const prompt = kind === "audio"
        ? page.getByLabel("音频提示词")
        : page.getByTestId(`${kind}-creator-prompt`);
      await prompt.fill(changedPrompt);
      await prompt.blur();
      releaseHeldRequest();
      await expect(creator.getByRole("button", { name: "Generate" }))
        .toBeEnabled();
      await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
      await flushBrowserTasks(page);
      await flushBrowserTasks(page);
      expect(createPosts).toBe(0);
      expect(providerRequests).toBe(0);
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), submissionIntentSlot(kind)))
        .toBeNull();
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      expect(data?.[`${kind}Prompt`]).toBe(changedPrompt);
      expect(data?.[`${kind}GenerationTaskId`]).toBeUndefined();
      expect(data?.[`${kind}Generating`]).not.toBe(true);
    } finally {
      releaseHeldRequest();
      await request.delete("/api/canvas/default");
    }
  });
}

for (const kind of kinds) {
  test(`${kind} recovered polling pauses on a transient 500 and resumes to success without POST`, async ({
    page,
    request,
  }) => {
    const taskId = `m41-recovered-polling-pause-${kind}`;
    const resultAssetId = `m41-recovered-polling-result-${kind}`;
    const resultText = "m41 recovered Text result";
    const submittedParameters = submissionParameterValues(
      schemas[kind],
      defaultParameterValues(schemas[kind]),
    );
    const activeInputKey = generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: `${kind} 原始提示词`,
      parameters: submittedParameters,
      prompt: `${kind} 原始提示词`,
    });
    const ownershipKey = recoveryOwnershipKey(kind);
    const runningTask = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T11:30:00.000Z",
      generationInputKey: activeInputKey,
      generationOwnershipKey: ownershipKey,
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      state: "running",
      updatedAt: "2026-08-09T11:30:00.500Z",
    };
    const successTask = {
      ...runningTask,
      ...(kind === "text"
        ? { resultText }
        : {
            resultAssetId,
            resultMedia: {
              byteSize: 768,
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 5,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              storageBackend: "local",
            },
            resultUrl: mediaAssetUrl(kind, resultAssetId),
          }),
      state: "success",
      updatedAt: "2026-08-09T11:30:01.000Z",
    };
    let listReads = 0;
    let providerRequests = 0;
    let taskReads = 0;
    let taskSubmissions = 0;

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    if (kind === "audio") {
      await page.route("**/api/audio-assets/**", async (route) => {
        await route.fulfill({ body: "", status: 404 });
      });
    }
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `Recovered pause ${kind}`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            id: modelInputs[kind].id,
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
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
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
        listReads += 1;
        await route.fulfill({ json: { tasks: [runningTask] }, status: 200 });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        taskReads += 1;
        if (taskReads === 1) {
          await route.fulfill({
            json: { code: "TEMPORARY", error: "temporary polling outage" },
            status: 500,
          });
        } else {
          await route.fulfill({ json: successTask, status: 200 });
        }
        return;
      }
      if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
        taskSubmissions += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: {
            ...baseNode.data,
            [`${kind}Generating`]: true,
            [`${kind}GenerationInputKey`]: activeInputKey,
            [`${kind}GenerationOwnershipKey`]: ownershipKey,
            [`${kind}GenerationTaskId`]: taskId,
            ...(kind === "text"
              ? {
                  content: "m41 recovered Text old result",
                  contentHtml: "<p>m41 recovered Text old result</p>",
                }
              : {
                  [`${kind}Src`]: mediaAssetUrl(
                    kind,
                    `m41-recovered-polling-old-${kind}`,
                  ),
                }),
          },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      if (kind === "audio") {
        await page.goto("/canvas", { waitUntil: "domcontentloaded" });
      } else {
        await page.goto("/canvas");
      }
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(() => taskReads).toBeGreaterThanOrEqual(1);
      expect(listReads).toBe(0);
      const node = page.getByTestId(`${kind}-node-${nodeId(kind)}`);
      const controls = kind === "text"
        ? page.getByTestId("text-creator")
        : node;
      if (kind === "text") {
        await selectNode(page, kind);
        const status = controls.getByTestId("upstream-input-problem");
        await expect(status).toHaveAttribute("role", "status");
        await expect(status).toContainText("点击重试重新检查");
      } else {
        await expect(node.getByRole("alert"))
          .toContainText("点击重试重新检查");
      }
      const resume = controls.getByRole("button", { name: "重新检查任务状态" });
      await expect(resume).toBeVisible();
      await resume.click();

      await expect.poll(() => taskReads).toBeGreaterThanOrEqual(2);
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          generating: data?.[`${kind}Generating`],
          result: kind === "text"
            ? data?.content
            : data?.[`${kind}Src`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({
        generating: false,
        result: kind === "text"
          ? resultText
          : mediaAssetUrl(kind, resultAssetId),
        taskId: kind === "text" ? taskId : null,
      });
      expect(taskSubmissions).toBe(0);
      expect(providerRequests).toBe(0);
    } finally {
      await request.delete("/api/canvas/default");
    }
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
  await page.goto("/canvas");
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

test("image node resumes polling after a reload while the task is running and shows the result without another refresh", async ({
  page,
  request,
}) => {
  const taskId = "recovery-running-image";
  let pollCount = 0;
  let providerRequests = 0;
  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });

  const runningTask = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "USD",
    createdAt: "2026-08-03T08:00:00.000Z",
    id: taskId,
    kind: "image" as const,
    model: modelInputs.image.id,
    nodeId: nodeId("image"),
    prompt: "image 原始提示词",
    retryAllowed: true,
    state: "running" as const,
    updatedAt: "2026-08-03T08:00:01.000Z",
  };
  const successTask = {
    ...runningTask,
    resultAssetId: "recovery-result-image",
    resultMedia: {
      byteSize: 123,
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable" as const,
      storageBackend: "local" as const,
    },
    resultUrl: "/api/assets/recovery-result-image",
    state: "success" as const,
    updatedAt: "2026-08-03T08:00:30.000Z",
  };
  let latestTask: Record<string, unknown> = runningTask;

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "Retry UI image",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.image.id,
          isDefault: true,
          parameterSchema: schemas.image,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
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
      await route.fulfill({
        contentType: "application/json",
        json: { error: "not found" },
        status: 404,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { tasks: [latestTask] },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith(`/${taskId}`) && method === "GET") {
      pollCount += 1;
      if (pollCount >= 2) latestTask = successTask;
      await route.fulfill({
        contentType: "application/json",
        json: latestTask,
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

  await request.delete("/api/canvas/default");
  const submittedParameters = submissionParameterValues(
    schemas.image,
    defaultParameterValues(schemas.image),
  );
  const inputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.image.id,
    ownPrompt: "image 原始提示词",
    parameters: submittedParameters,
    prompt: "image 原始提示词",
  });
  const [imageNode] = canvasNodes("image");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...imageNode,
        data: {
          ...imageNode.data,
          imageGenerationInputKey: inputKey,
          imageGenerating: true,
          imageGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");

  // 恢复逻辑必须在“任务仍在运行”的挂载后自动继续轮询并应用结果，
  // 不需要用户再刷新一次。
  await expect.poll(async () => {
    const canvas = await (await request.get("/api/canvas/default")).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    const data = canvas.nodes.find((node) => node.id === nodeId("image"))
      ?.data ?? {};
    return data.imageSrc === "/api/assets/recovery-result-image" &&
      data.imageGenerating === false
      ? "done"
      : "pending";
  }).toBe("done");
  expect(pollCount).toBeGreaterThanOrEqual(2);
  expect(providerRequests).toBe(0);
});

test("persisted active media tasks replace an old image, video, or audio result", async ({
  page,
  request,
}) => {
  const mediaKinds = ["image", "video", "audio"] as const;
  const resultUrl = (kind: (typeof mediaKinds)[number]) =>
    mediaAssetUrl(kind, `new-result-${kind}`);
  const bindings = new Map(mediaKinds.map((kind) => {
    const parameters = submissionParameterValues(
      schemas[kind],
      defaultParameterValues(schemas[kind]),
    );
    return [kind, {
      inputKey: generationInputKey({
        inputs: [],
        modelId: modelInputs[kind].id,
        ownPrompt: `${kind} 原始提示词`,
        parameters,
        prompt: `${kind} 原始提示词`,
      }),
      ownershipKey: recoveryOwnershipKey(kind),
    }] as const;
  }));
  const exactReads = new Set<string>();
  let listReads = 0;
  let providerRequests = 0;
  let taskSubmissions = 0;
  const tasks = mediaKinds.map((kind, index) => ({
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T08:00:00.000Z",
    generationInputKey: bindings.get(kind)!.inputKey,
    generationOwnershipKey: bindings.get(kind)!.ownershipKey,
    id: `old-result-recovery-${kind}`,
    kind,
    model: modelInputs[kind].id,
    nodeId: nodeId(kind),
    prompt: `${kind} 原始提示词`,
    resultAssetId: `new-result-${kind}`,
    resultMedia: {
      byteSize: 100 + index,
      contentType: kind === "image"
        ? "image/png"
        : kind === "video"
          ? "video/mp4"
          : "audio/mpeg",
      durationSeconds: kind === "image" ? null : 2 + index,
      durationStatus: kind === "image" ? "not-applicable" : "ready",
      storageBackend: "local",
    },
    resultUrl: resultUrl(kind),
    state: "success",
    updatedAt: "2026-08-09T08:00:01.000Z",
  }));

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: mediaKinds.map((kind) => ({
          capability: kind,
          displayName: `Old result recovery ${kind}`,
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
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
      listReads += 1;
      await route.fulfill({ json: { tasks }, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      const task = tasks.find((candidate) =>
        url.pathname === `/api/generation-tasks/${candidate.id}`
      );
      if (task) {
        exactReads.add(task.id);
        await route.fulfill({ json: task, status: 200 });
        return;
      }
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
      taskSubmissions += 1;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const nodes = mediaKinds.map((kind, index) => ({
    data: {
      label: kind[0].toUpperCase() + kind.slice(1),
      title: `Old ${kind}`,
      [`${kind}Generating`]: true,
      [`${kind}GenerationInputKey`]: bindings.get(kind)!.inputKey,
      [`${kind}GenerationOwnershipKey`]: bindings.get(kind)!.ownershipKey,
      [`${kind}GenerationTaskId`]: `old-result-recovery-${kind}`,
      [`${kind}ModelId`]: modelInputs[kind].id,
      [`${kind}Parameters`]: defaultParameterValues(schemas[kind]),
      [`${kind}Prompt`]: `${kind} 原始提示词`,
      [`${kind}PromptReady`]: true,
      [`${kind}Src`]: `/api/assets/old-result-${kind}`,
    },
    id: nodeId(kind),
    position: { x: 100 + index * 520, y: 120 },
    selected: index === 0,
    style: {
      height: kind === "image" ? 300 : 250,
      width: kind === "image" ? 300 : 444,
    },
    type: kind,
  }));
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(async () => {
      const response = await request.get("/api/canvas/default");
      const canvas = await response.json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      return mediaKinds.map((kind) => {
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return [data?.[`${kind}Src`], data?.[`${kind}Generating`]];
      });
    }).toEqual(mediaKinds.map((kind) => [resultUrl(kind), false]));
    expect(exactReads).toEqual(new Set(tasks.map((task) => task.id)));
    expect(listReads).toBe(0);
    expect(taskSubmissions).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
  }
});

test("a Text fixture never resumes its persisted task", async ({
  page,
  request,
}) => {
  const canvasId = "node.text.empty";
  let taskReads = 0;
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: "text",
          displayName: "Fixture-safe text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.text.id,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (
      inbound.method() === "GET" &&
      url.pathname === "/api/generation-tasks/fixture-persisted-text-task"
    ) {
      taskReads += 1;
      await route.fulfill({
        json: { error: "fixture must not read its persisted task" },
        status: 500,
      });
      return;
    }
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: {
          persistentQueueReady: true,
          submissionEnabled: true,
          textSubmissionEnabled: true,
        },
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete(`/api/canvas/${canvasId}`);
  expect((await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [],
      nodes: [{
        data: {
          content: "旧内容",
          contentHtml: "<p>旧内容</p>",
          label: "Text",
          textGenerating: true,
          textGenerationTaskId: "fixture-persisted-text-task",
          textModelId: modelInputs.text.id,
          textParameters: defaultParameterValues(schemas.text),
          textPrompt: "fixture 不得恢复",
          title: "Fixture text",
        },
        id: "text-primary",
        position: { x: 240, y: 180 },
        selected: true,
        style: { height: 250, width: 250 },
        type: "text",
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto(`/__fixture/${canvasId}`);
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-model-control"))
      .toContainText("Fixture-safe text");
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    expect(taskReads).toBe(0);
  } finally {
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

test("image recovery hands an active poll to the new ready run before the old run settles", async ({
  page,
  request,
}) => {
  const taskId = "image-recovery-owner-task";
  const activeInputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.image.id,
    ownPrompt: "image 原始提示词",
    parameters: submissionParameterValues(
      schemas.image,
      defaultParameterValues(schemas.image),
    ),
    prompt: "image 原始提示词",
  });
  const ownershipKey = recoveryOwnershipKey("image");
  const runningTask = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T09:00:00.000Z",
    generationInputKey: activeInputKey,
    generationOwnershipKey: ownershipKey,
    id: taskId,
    kind: "image",
    model: modelInputs.image.id,
    nodeId: nodeId("image"),
    prompt: "image 原始提示词",
    state: "running",
    updatedAt: "2026-08-09T09:00:01.000Z",
  };
  const successTask = {
    ...runningTask,
    resultAssetId: "image-recovery-owner-result",
    resultMedia: {
      byteSize: 321,
      contentType: "image/png",
      durationSeconds: null,
      durationStatus: "not-applicable",
      storageBackend: "local",
    },
    resultUrl: "/api/assets/image-recovery-owner-result",
    state: "success",
    updatedAt: "2026-08-09T09:00:02.000Z",
  };
  await page.addInitScript(({ running, success, taskId: interceptedTaskId }) => {
    const state: {
      releaseSecond?: () => void;
      taskGets: number;
    } = { taskGets: 0 };
    (window as typeof window & {
      __m41ImageRecoveryOwner?: typeof state;
    }).__m41ImageRecoveryOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${interceptedTaskId}`
      ) {
        state.taskGets += 1;
        if (state.taskGets === 2) {
          return new Promise<Response>((_resolve, reject) => {
            state.releaseSecond = () => reject(
              new DOMException("old recovery scope closed", "AbortError"),
            );
          });
        }
        return Promise.resolve(new Response(JSON.stringify(
          state.taskGets >= 3 ? success : running,
        ), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, { running: runningTask, success: successTask, taskId });

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: "image",
          displayName: "Image recovery owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.image.id,
          isDefault: true,
          parameterSchema: schemas.image,
        }],
      },
      status: 200,
    });
  });
  let taskLists = 0;
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
        json: { persistentQueueReady: true, submissionEnabled: true },
        status: 200,
      });
      return;
    }
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "GET") {
      taskLists += 1;
      await route.fulfill({ json: { tasks: [runningTask] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const activeNodes = canvasNodes("image").map((node) => ({
    ...node,
    data: {
      ...node.data,
      imageGenerating: true,
      imageGenerationInputKey: activeInputKey,
      imageGenerationOwnershipKey: ownershipKey,
      imageGenerationTaskId: taskId,
    },
  }));
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: activeNodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();
  const initialDocument = await (
    await request.get("/api/canvas/default")
  ).json() as Record<string, unknown>;
  let markBaselineStarted!: () => void;
  const baselineStarted = new Promise<void>((resolve) => {
    markBaselineStarted = resolve;
  });
  let releaseBaseline!: () => void;
  const baselineGate = new Promise<void>((resolve) => {
    releaseBaseline = resolve;
  });
  let supersededSent = false;
  let putCount = 0;
  await page.route("**/api/canvas/default", async (route) => {
    const inbound = route.request();
    if (inbound.method() === "GET" && !supersededSent) {
      await route.fulfill({ json: initialDocument, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      markBaselineStarted();
      await baselineGate;
      await route.fulfill({
        json: {
          ...initialDocument,
          currentWriterSequence: 1,
          currentWriterSessionId: "other-tab",
          graphRevision: 2,
          loadToken: "m41-image-owner-load-token-b",
          revision: 2,
          sessionHighWaterAttemptId: "foreign-attempt-0002",
          sessionHighWaterSequence: 2,
        },
        status: 200,
      });
      return;
    }
    const body = inbound.postDataJSON() as Record<string, unknown>;
    putCount += 1;
    if (putCount === 1) {
      supersededSent = true;
      await route.fulfill({
        json: {
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: 2,
          currentRevision: 2,
          currentWriterSequence: 1,
          currentWriterSessionId: "other-tab",
          error: "foreign high-water requires a fresh baseline",
          rejectedAttemptId: body.saveAttemptId,
          rejectedSequence: body.saveSequence,
          rejectedSessionId: body.saveSessionId,
          sessionHighWaterAttemptId: "foreign-attempt-0002",
          sessionHighWaterSequence: 2,
        },
        status: 409,
      });
      return;
    }
    await route.fulfill({
      json: {
        graphRevision: 3,
        loadToken: "m41-image-owner-load-token-c",
        revision: 3,
      },
      status: 200,
    });
  });

  const raceState = () => page.evaluate(() => {
    const state = (window as typeof window & {
      __m41ImageRecoveryOwner?: { taskGets: number };
    }).__m41ImageRecoveryOwner;
    return state?.taskGets ?? 0;
  });
  try {
    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(raceState).toBeGreaterThanOrEqual(2);

    await page.getByTestId("image-node-title-input").fill("owner handoff");
    await baselineStarted;
    await expect(world).toHaveAttribute("data-persistence-ready", "false");
    releaseBaseline();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(raceState).toBeGreaterThanOrEqual(3);
    expect(taskLists).toBe(0);
    await expect(page.getByTestId("image-node-preview")).toHaveAttribute(
      "src",
      "/api/assets/image-recovery-owner-result",
    );
  } finally {
    await page.evaluate(() => {
      const state = (window as typeof window & {
        __m41ImageRecoveryOwner?: { releaseSecond?: () => void };
      }).__m41ImageRecoveryOwner;
      state?.releaseSecond?.();
    }).catch(() => undefined);
    releaseBaseline();
    await request.delete("/api/canvas/default");
  }
});

for (const kind of kinds) {
  test(`${kind} upgrades and exactly recovers a legacy intent after the model catalog is ready`, async ({
    page,
    request,
  }) => {
    const idempotencyKey = `m41-intent-only-${kind}`;
    const taskId = `m41-intent-only-task-${kind}`;
    const intentSlot = submissionIntentSlot(kind);
    const resultAssetId = `intent-only-asset-${kind}`;
    const nextResult = kind === "text"
      ? "intent-only 新文字结果"
      : mediaAssetUrl(kind, resultAssetId);
    const task = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T10:00:00.000Z",
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      ...(kind === "text"
        ? { resultText: nextResult }
        : {
            resultAssetId,
            resultMedia: {
              byteSize: 512,
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 3,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              storageBackend: "local",
            },
            resultUrl: nextResult,
          }),
      state: "success",
      updatedAt: "2026-08-09T10:00:01.000Z",
    };
    let byIdempotencyReads = 0;
    let modelReads = 0;
    let providerRequests = 0;
    let taskLists = 0;
    let taskSubmissions = 0;
    let releaseModels!: () => void;
    const modelsGate = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.addInitScript(({ intent, slot }) => {
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }, {
      intent: {
        canvasId: "default",
        idempotencyKey,
        kind,
        nodeId: nodeId(kind),
        requestSignature: recoveryRequestSignature(kind),
        taskId,
        updatedAt: "2026-08-09T10:00:00.500Z",
        version: 1,
      },
      slot: intentSlot,
    });
    await page.route("**/api/models", async (route) => {
      modelReads += 1;
      await modelsGate;
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `Intent-only recovery ${kind}`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            id: modelInputs[kind].id,
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
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
      if (
        inbound.method() === "GET" &&
        url.pathname.endsWith("/by-idempotency") &&
        url.searchParams.get("canvasId") === "default" &&
        url.searchParams.get("idempotencyKey") === idempotencyKey
      ) {
        byIdempotencyReads += 1;
        await route.fulfill({ json: task, status: 200 });
        return;
      }
      if (
        inbound.method() === "GET" &&
        url.pathname === "/api/generation-tasks"
      ) {
        taskLists += 1;
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      if (
        inbound.method() === "POST" &&
        url.pathname === "/api/generation-tasks"
      ) {
        taskSubmissions += 1;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    const [baseNode] = canvasNodes(kind);
    const oldResultData = kind === "text"
      ? {
          content: "intent-only 旧文字结果",
          contentHtml: "<p>intent-only 旧文字结果</p>",
        }
      : {
          [`${kind}Src`]: mediaAssetUrl(kind, `intent-only-old-${kind}`),
          ...(kind === "image" ? { imageGeneratedSuccess: true } : {}),
          ...(kind === "audio" ? { audioGeneratedResult: true } : {}),
        };
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: [{
          ...baseNode,
          data: { ...baseNode.data, ...oldResultData },
        }],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect.poll(() => modelReads).toBeGreaterThanOrEqual(1);
      expect(byIdempotencyReads).toBe(0);
      releaseModels();
      await expect.poll(() => byIdempotencyReads).toBeGreaterThanOrEqual(1);
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return kind === "text" ? data?.content : data?.[`${kind}Src`];
      }).toBe(nextResult);
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), intentSlot)).toBeNull();
      expect(taskLists).toBe(0);
      expect(taskSubmissions).toBe(0);
      expect(providerRequests).toBe(0);
    } finally {
      releaseModels();
      await page.evaluate((slot) => {
        window.localStorage.removeItem(slot);
      }, intentSlot).catch(() => undefined);
      await request.delete("/api/canvas/default");
    }
  });
}

test("Text legacy intent mismatch clears without reading or applying the old result", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-legacy-mismatch-task";
  const intentSlot = submissionIntentSlot(kind);
  const protectedBody = "legacy mismatch 必须保留的正文";
  const currentPrompt = "text 当前已变化的提示词";
  let byIdempotencyReads = 0;
  let generationPosts = 0;
  let providerRequests = 0;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, slot }) => {
    window.localStorage.setItem(slot, JSON.stringify(intent));
  }, {
    intent: {
      canvasId: "default",
      idempotencyKey: "m41-text-legacy-mismatch-key",
      kind,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:15:00.000Z",
      version: 1,
    },
    slot: intentSlot,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Legacy mismatch Text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.text.id,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (url.pathname.endsWith("/by-idempotency")) {
      byIdempotencyReads += 1;
      await route.fulfill({
        json: {
          attempt: 1,
          canvasId: "default",
          costCurrency: "CNY",
          createdAt: "2026-08-09T10:14:00.000Z",
          id: taskId,
          kind,
          nodeId: nodeId(kind),
          prompt: "text 原始提示词",
          resultText: "不应应用的旧结果",
          state: "success",
          updatedAt: "2026-08-09T10:14:01.000Z",
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "POST") generationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          content: protectedBody,
          contentHtml: `<p>${protectedBody}</p>`,
          textPrompt: currentPrompt,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();
    await expect(page.getByTestId("text-node-editor")).toHaveText(protectedBody);
    const canvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    expect(canvas.nodes.find((node) => node.id === nodeId(kind))?.data.content)
      .toBe(protectedBody);
    expect(byIdempotencyReads).toBe(0);
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("four active old-result tasks recover before a delayed model catalog and retain overlays", async ({
  page,
  request,
}) => {
  const intents = kinds.map((kind) => ({
    idempotencyKey: `m41-delayed-model-active-${kind}`,
    kind,
    ownershipKey: compactGenerationOwnershipKey({
      ...(kind === "image"
        ? { aspectRatio: undefined, quality: undefined }
        : {}),
      modelId: modelInputs[kind].id,
      parameters: defaultParameterValues(schemas[kind]),
      prompt: `${kind} 原始提示词`,
      upstream: [],
    }),
    slot: submissionIntentSlot(kind),
    taskId: `m41-delayed-model-active-task-${kind}`,
  }));
  const tasks = new Map(intents.map(({ kind, taskId }) => {
    const resultAssetId = `delayed-model-active-result-${kind}`;
    return [kind, {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T10:30:00.000Z",
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      ...(kind === "text"
        ? { resultText: "delayed-model active 新文字结果" }
        : {
            resultAssetId,
            resultMedia: {
              byteSize: 640,
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 4,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              storageBackend: "local",
            },
            resultUrl: mediaAssetUrl(kind, resultAssetId),
          }),
      state: "success",
      updatedAt: "2026-08-09T10:30:01.000Z",
    }];
  }));
  let modelReads = 0;
  let providerRequests = 0;
  let taskLists = 0;
  let taskReads = 0;
  let taskSubmissions = 0;
  let releaseModels!: () => void;
  const modelsGate = new Promise<void>((resolve) => {
    releaseModels = resolve;
  });
  let releaseTasks!: () => void;
  const tasksGate = new Promise<void>((resolve) => {
    releaseTasks = resolve;
  });
  const initialTaskReads = new Set<string>();

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript((seededIntents) => {
    for (const entry of seededIntents) {
      window.localStorage.setItem(entry.slot, JSON.stringify(entry.intent));
    }
  }, intents.map(({ idempotencyKey, kind, ownershipKey, slot, taskId }) => ({
    intent: {
      canvasId: "default",
      generationOwnershipKey: ownershipKey,
      idempotencyKey,
      kind,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:30:00.500Z",
      version: 1,
    },
    slot,
  })));
  await page.route("**/api/models", async (route) => {
    modelReads += 1;
    await modelsGate;
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Delayed active ${kind}`,
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
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (url.pathname.endsWith("/by-idempotency")) {
      const intent = intents.find((candidate) =>
        candidate.idempotencyKey === url.searchParams.get("idempotencyKey"));
      const task = intent ? tasks.get(intent.kind) : undefined;
      if (task) taskReads += 1;
      await route.fulfill({
        json: task ?? { error: "not found" },
        status: task ? 200 : 404,
      });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      taskLists += 1;
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      const taskId = url.pathname.split("/").at(-1);
      const task = [...tasks.values()].find((candidate) => candidate.id === taskId);
      if (task) {
        taskReads += 1;
        if (!initialTaskReads.has(task.id)) {
          initialTaskReads.add(task.id);
          await route.fulfill({
            json: {
              ...task,
              resultAssetId: undefined,
              resultMedia: undefined,
              resultText: undefined,
              resultUrl: undefined,
              state: "running",
            },
            status: 200,
          });
        } else {
          await tasksGate;
          await route.fulfill({ json: task, status: 200 });
        }
        return;
      }
    }
    if (inbound.method() === "POST" && url.pathname === "/api/generation-tasks") {
      taskSubmissions += 1;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const activeNodes = canvasNodes().map((node) => {
    const kind = node.type as Kind;
    const taskId = intents.find((candidate) => candidate.kind === kind)!.taskId;
    const ownershipKey = intents.find((candidate) => candidate.kind === kind)!
      .ownershipKey;
    const submittedParameters = submissionParameterValues(
      schemas[kind],
      defaultParameterValues(schemas[kind]),
    );
    const inputKey = generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: `${kind} 原始提示词`,
      parameters: submittedParameters,
      prompt: `${kind} 原始提示词`,
    });
    return {
      ...node,
      data: {
        ...node.data,
        [`${kind}Generating`]: true,
        [`${kind}GenerationInputKey`]: inputKey,
        [`${kind}GenerationOwnershipKey`]: ownershipKey,
        [`${kind}GenerationTaskId`]: taskId,
        ...(kind === "text"
          ? {
              content: "delayed-model active 旧文字结果",
              contentHtml: "<p>delayed-model active 旧文字结果</p>",
            }
          : {
              [`${kind}Src`]: mediaAssetUrl(kind, `delayed-model-active-old-${kind}`),
            }),
      },
    };
  });
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: activeNodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => modelReads).toBeGreaterThanOrEqual(1);
    await expect.poll(() => initialTaskReads.size).toBe(4);
    expect(taskReads).toBeGreaterThanOrEqual(4);
    expect(taskLists).toBe(0);
    for (const { slot } of intents) {
      expect(await page.evaluate((key) =>
        window.localStorage.getItem(key), slot)).not.toBeNull();
    }
    await expect(page.getByTestId("text-node-generating")).toBeVisible();
    await expect(page.getByTestId("image-node-generating")).toBeVisible();
    await expect(page.getByTestId("video-node-generating")).toBeVisible();
    await expect(page.getByTestId("audio-node-generating")).toBeVisible();
    await expect(page.getByTestId("text-node-editor"))
      .toContainText("delayed-model active 旧文字结果");
    await expect(page.getByTestId("image-node-preview")).toHaveAttribute(
      "src",
      mediaAssetUrl("image", "delayed-model-active-old-image"),
    );
    await expect(page.getByTestId("video-node-preview")).toHaveAttribute(
      "src",
      mediaAssetUrl("video", "delayed-model-active-old-video"),
    );
    await expect(page.getByTestId("audio-node-media")).toHaveAttribute(
      "src",
      mediaAssetUrl("audio", "delayed-model-active-old-audio"),
    );
    const activeCanvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    for (const kind of kinds) {
      const data = activeCanvas.nodes.find(
        (node) => node.id === nodeId(kind),
      )?.data;
      expect(kind === "text" ? data?.content : data?.[`${kind}Src`]).toBe(
        kind === "text"
          ? "delayed-model active 旧文字结果"
          : mediaAssetUrl(kind, `delayed-model-active-old-${kind}`),
      );
    }

    releaseTasks();
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      return kinds.map((kind) => {
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return kind === "text" ? data?.content : data?.[`${kind}Src`];
      });
    }).toEqual(kinds.map((kind) => kind === "text"
      ? "delayed-model active 新文字结果"
      : mediaAssetUrl(kind, `delayed-model-active-result-${kind}`)));
    for (const { slot } of intents) {
      await expect.poll(() => page.evaluate((key) =>
        window.localStorage.getItem(key), slot)).toBeNull();
    }
    expect(taskSubmissions).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    releaseTasks();
    releaseModels();
    await page.evaluate((slots) => {
      slots.forEach((slot) => window.localStorage.removeItem(slot));
    }, intents.map((entry) => entry.slot)).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("scoped retry-accepted events wake exact GET only for their four bound nodes", async ({
  page,
  request,
}) => {
  const inputKeys = Object.fromEntries(kinds.map((kind) => [
    kind,
    generationInputKey({
      inputs: [],
      modelId: modelInputs[kind].id,
      ownPrompt: `${kind} 原始提示词`,
      parameters: submissionParameterValues(
        schemas[kind],
        defaultParameterValues(schemas[kind]),
      ),
      prompt: `${kind} 原始提示词`,
    }),
  ])) as Record<Kind, string>;
  const accepted = new Set<Kind>();
  const exactReads = new Map<Kind, number>();
  const ownershipKeys = Object.fromEntries(kinds.map((kind) => [
    kind,
    recoveryOwnershipKey(kind),
  ])) as Record<Kind, string>;
  let listReads = 0;
  let mutationPosts = 0;
  let providerRequests = 0;
  const taskIdFor = (kind: Kind) => `m41-event-wakeup-${kind}`;
  const resultFor = (kind: Kind) => kind === "text"
    ? "event wakeup 新文字结果"
    : mediaAssetUrl(kind, `event-wakeup-result-${kind}`);
  const taskFor = (kind: Kind) => ({
    attempt: accepted.has(kind) ? 2 : 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-10T07:00:00.000Z",
    generationInputKey: inputKeys[kind],
    generationOwnershipKey: ownershipKeys[kind],
    id: taskIdFor(kind),
    kind,
    model: modelInputs[kind].id,
    nodeId: nodeId(kind),
    prompt: `${kind} 原始提示词`,
    ...(accepted.has(kind)
      ? kind === "text"
        ? { resultText: resultFor(kind) }
        : {
            resultAssetId: `event-wakeup-result-${kind}`,
            resultMedia: {
              byteSize: 720,
              contentType: kind === "image"
                ? "image/png"
                : kind === "video"
                  ? "video/mp4"
                  : "audio/mpeg",
              durationSeconds: kind === "image" ? null : 5,
              durationStatus: kind === "image" ? "not-applicable" : "ready",
              storageBackend: "local",
            },
            resultUrl: resultFor(kind),
          }
      : {
          errorCode: "AUTH",
          errorMessage: `${kind} retryable failure`,
          retryAllowed: true,
        }),
    state: accepted.has(kind) ? "success" : "failed",
    updatedAt: accepted.has(kind)
      ? "2026-08-10T07:00:02.000Z"
      : "2026-08-10T07:00:01.000Z",
  });

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: kinds.map((kind) => ({
          capability: kind,
          displayName: `Event wakeup ${kind}`,
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
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      listReads += 1;
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "GET") {
      const kind = kinds.find((candidate) =>
        url.pathname === `/api/generation-tasks/${taskIdFor(candidate)}`);
      if (kind) {
        exactReads.set(kind, (exactReads.get(kind) ?? 0) + 1);
        await route.fulfill({ json: taskFor(kind), status: 200 });
        return;
      }
    }
    if (inbound.method() === "POST") mutationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const seededNodes = canvasNodes().map((node) => {
    const kind = node.type as Kind;
    return {
      ...node,
      data: {
        ...node.data,
        [`${kind}GenerationError`]: `${kind} seeded failure`,
        [`${kind}GenerationErrorCode`]: "AUTH",
        [`${kind}GenerationInputKey`]: inputKeys[kind],
        [`${kind}GenerationOwnershipKey`]: ownershipKeys[kind],
        [`${kind}Generating`]: false,
        [`${kind}GenerationRetryAllowed`]: true,
        [`${kind}GenerationTaskId`]: taskIdFor(kind),
        ...(kind === "text"
          ? {
              content: "event wakeup 旧文字结果",
              contentHtml: "<p>event wakeup 旧文字结果</p>",
            }
          : {
              [`${kind}Src`]: mediaAssetUrl(kind, `event-wakeup-old-${kind}`),
              ...(kind === "image" ? { imageGeneratedSuccess: true } : {}),
              ...(kind === "audio" ? { audioGeneratedResult: true } : {}),
            }),
      },
    };
  });
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: seededNodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => kinds.every((kind) =>
      (exactReads.get(kind) ?? 0) >= 1)).toBe(true);
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      return kinds.every((kind) => {
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return data?.[`${kind}Generating`] === false &&
          data?.[`${kind}GenerationTaskId`] === taskIdFor(kind) &&
          data?.[`${kind}GenerationError`] !== `${kind} seeded failure`;
      });
    }).toBe(true);
    await flushBrowserTasks(page);

    for (const kind of kinds) {
      const beforeWrongScope = exactReads.get(kind) ?? 0;
      await page.evaluate(({ eventName, kind, taskId }) => {
        const base = {
          attempt: 2,
          canvasId: "default",
          kind,
          nodeId: `retry-ui-${kind}`,
          taskId,
          updatedAt: "2026-08-10T07:00:02.000Z",
        };
        const wrongKind = kind === "text" ? "image" : "text";
        for (const detail of [
          { ...base, canvasId: "other-canvas" },
          { ...base, nodeId: "other-node" },
          { ...base, kind: wrongKind },
          { ...base, taskId: `${taskId}-other` },
        ]) {
          window.dispatchEvent(new CustomEvent(eventName, { detail }));
        }
      }, {
        eventName: "unboundry:generation-task-retry-accepted",
        kind,
        taskId: taskIdFor(kind),
      });
      await flushBrowserTasks(page);
      expect(exactReads.get(kind) ?? 0).toBe(beforeWrongScope);

      accepted.add(kind);
      await page.evaluate(({ eventName, kind, taskId }) => {
        window.dispatchEvent(new CustomEvent(eventName, {
          detail: {
            attempt: 2,
            canvasId: "default",
            kind,
            nodeId: `retry-ui-${kind}`,
            taskId,
            updatedAt: "2026-08-10T07:00:02.000Z",
          },
        }));
      }, {
        eventName: "unboundry:generation-task-retry-accepted",
        kind,
        taskId: taskIdFor(kind),
      });
      await expect.poll(() => exactReads.get(kind) ?? 0)
        .toBeGreaterThan(beforeWrongScope);
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return kind === "text" ? data?.content : data?.[`${kind}Src`];
      }).toBe(resultFor(kind));
    }
    expect(listReads).toBe(0);
    expect(mutationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
  }
});

test("Text rejects an exact task id whose server scope belongs to another node", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-wrong-scope";
  const inputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.text.id,
    ownPrompt: "text 原始提示词",
    parameters: submissionParameterValues(
      schemas.text,
      defaultParameterValues(schemas.text),
    ),
    prompt: "text 原始提示词",
  });
  let exactReads = 0;
  let listReads = 0;
  let mutationPosts = 0;
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Wrong scope text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.text.id,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (inbound.method() === "GET" &&
      url.pathname === `/api/generation-tasks/${taskId}`) {
      exactReads += 1;
      await route.fulfill({
        json: {
          attempt: 1,
          canvasId: "default",
          costCurrency: "CNY",
          createdAt: "2026-08-10T08:00:00.000Z",
          generationInputKey: inputKey,
          id: taskId,
          kind,
          nodeId: "another-text-node",
          prompt: "text 原始提示词",
          resultText: "wrong-scope result must not apply",
          state: "success",
          updatedAt: "2026-08-10T08:00:01.000Z",
        },
        status: 200,
      });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      listReads += 1;
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "POST") mutationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          content: "Text keeps this old body",
          contentHtml: "<p>Text keeps this old body</p>",
          textGenerationInputKey: inputKey,
          textGenerating: true,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => exactReads).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        body: data?.content,
        generating: data?.textGenerating,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      body: "Text keeps this old body",
      generating: false,
      taskId: null,
    });
    expect(listReads).toBe(0);
    expect(mutationPosts).toBe(0);
  } finally {
    await request.delete("/api/canvas/default");
  }
});

test("Video keeps unchanged-input Generate disabled but submits once after a real prompt change", async ({
  page,
  request,
}) => {
  const kind = "video" as const;
  const taskId = "m41-video-changed-input-task";
  const originalPrompt = "video 原始提示词";
  const changedPrompt = "video changed input prompt";
  const parameters = submissionParameterValues(
    schemas.video,
    defaultParameterValues(schemas.video),
  );
  const originalInputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.video.id,
    ownPrompt: originalPrompt,
    parameters,
    prompt: originalPrompt,
  });
  let taskSubmissions = 0;
  let taskReads = 0;
  let releaseTask!: () => void;
  const taskGate = new Promise<void>((resolve) => {
    releaseTask = resolve;
  });
  const queuedTask = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-10T09:00:00.000Z",
    id: taskId,
    kind,
    model: modelInputs.video.id,
    nodeId: nodeId(kind),
    prompt: changedPrompt,
    state: "queued",
    updatedAt: "2026-08-10T09:00:01.000Z",
  };
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Changed input video",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.video.id,
          isDefault: true,
          parameterSchema: schemas.video,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
      await route.fulfill({
        json: { canEnqueue: true, canSubmit: true, problems: [] },
        status: 200,
      });
      return;
    }
    if (url.pathname === "/api/generation-tasks" && inbound.method() === "POST") {
      taskSubmissions += 1;
      await route.fulfill({ json: queuedTask, status: 202 });
      return;
    }
    if (url.pathname === `/api/generation-tasks/${taskId}` &&
      inbound.method() === "GET") {
      taskReads += 1;
      await taskGate;
      await route.fulfill({
        json: {
          ...queuedTask,
          resultAssetId: "m41-video-changed-input-result",
          resultMedia: {
            byteSize: 800,
            contentType: "video/mp4",
            durationSeconds: 5,
            durationStatus: "ready",
            storageBackend: "local",
          },
          resultUrl: mediaAssetUrl("video", "m41-video-changed-input-result"),
          state: "success",
        },
        status: 200,
      });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          assetId: "m41-video-old-result",
          videoGenerationInputKey: originalInputKey,
          videoPrompt: originalPrompt,
          videoPromptReady: true,
          videoSrc: mediaAssetUrl("video", "m41-video-old-result"),
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await selectNode(page, kind);
    const generate = page.getByTestId("video-creator")
      .getByRole("button", { name: "Generate" });
    await expect(generate).toBeDisabled();
    await page.getByTestId("video-creator-prompt").fill(changedPrompt);
    await page.getByTestId("video-creator-prompt").blur();
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect.poll(() => taskSubmissions).toBe(1);
    await expect.poll(() => taskReads).toBeGreaterThanOrEqual(1);
    expect(taskSubmissions).toBe(1);
    await expect(page.getByRole("button", { name: "取消生成" })).toBeVisible();
  } finally {
    releaseTask();
    await request.delete("/api/canvas/default");
  }
});

test("a manual Text body commit owns the node over a late active-poll success", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-manual-owner-task";
  const intentSlot = submissionIntentSlot(kind);
  const runningTask = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T10:45:00.000Z",
    id: taskId,
    kind,
    model: modelInputs.text.id,
    nodeId: nodeId(kind),
    prompt: "text 原始提示词",
    state: "running",
    updatedAt: "2026-08-09T10:45:00.500Z",
  };
  const successTask = {
    ...runningTask,
    resultText: "迟到的生成结果不得覆盖手稿",
    state: "success",
    updatedAt: "2026-08-09T10:45:01.000Z",
  };
  const manualDraft = "用户手工正文必须保留";
  let providerRequests = 0;
  let taskSubmissions = 0;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, running, slot, success, taskId }) => {
    const marker = "__m41:text-manual-owner-seeded";
    if (window.sessionStorage.getItem(marker) !== "1") {
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }
    const state: {
      releaseSuccess?: () => void;
      taskGets: number;
    } = { taskGets: 0 };
    (window as typeof window & {
      __m41TextManualOwner?: typeof state;
    }).__m41TextManualOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${taskId}`
      ) {
        state.taskGets += 1;
        if (state.taskGets >= 2) {
          return new Promise<Response>((resolve) => {
            state.releaseSuccess = () => resolve(new Response(
              JSON.stringify(success),
              {
                headers: { "Content-Type": "application/json" },
                status: 200,
              },
            ));
          });
        }
        return Promise.resolve(new Response(JSON.stringify(running), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, {
    intent: {
      canvasId: "default",
      idempotencyKey: "m41-text-manual-owner-key",
      kind,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:45:00.250Z",
      version: 1,
    },
    running: runningTask,
    slot: intentSlot,
    success: successTask,
    taskId,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Text manual owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.text.id,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    if (inbound.method() === "POST" && url.pathname === "/api/generation-tasks") {
      taskSubmissions += 1;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const submittedParameters = submissionParameterValues(
    schemas.text,
    defaultParameterValues(schemas.text),
  );
  const activeInputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.text.id,
    ownPrompt: "text 原始提示词",
    parameters: submittedParameters,
    prompt: "text 原始提示词",
  });
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          content: "轮询开始前的旧正文",
          contentHtml: "<p>轮询开始前的旧正文</p>",
          textGenerating: true,
          textGenerationInputKey: activeInputKey,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextManualOwner?: { taskGets: number };
      }).__m41TextManualOwner?.taskGets ?? 0)).toBeGreaterThanOrEqual(2);

    await page.getByTestId("canvas-node-text-content").dispatchEvent("dblclick");
    const editor = page.getByTestId("text-node-editor");
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.fill(manualDraft);
    await editor.press("Escape");
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({ content: manualDraft, generating: false, taskId: null });
    await expect.poll(() => page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();

    await page.evaluate(() => {
      (window as typeof window & {
        __m41TextManualOwner?: { releaseSuccess?: () => void };
      }).__m41TextManualOwner?.releaseSuccess?.();
    });
    await expect(editor).toHaveText(manualDraft);
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      return canvas.nodes.find((node) => node.id === nodeId(kind))?.data.content;
    }).toBe(manualDraft);

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-node-editor")).toHaveText(manualDraft);
    expect(taskSubmissions).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("a Text prompt change revokes a held active poll before its late success", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-prompt-owner-task";
  const intentSlot = submissionIntentSlot(kind);
  const originalPrompt = "text 原始提示词";
  const changedPrompt = "text prompt changed while poll was held";
  const protectedBody = "提示词变化后必须保留的正文";
  const runningTask = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T10:50:00.000Z",
    id: taskId,
    kind,
    model: modelInputs.text.id,
    nodeId: nodeId(kind),
    prompt: originalPrompt,
    state: "running",
    updatedAt: "2026-08-09T10:50:00.500Z",
  };
  const successTask = {
    ...runningTask,
    resultText: "迟到成功不得覆盖提示词变化后的正文",
    state: "success",
    updatedAt: "2026-08-09T10:50:01.000Z",
  };
  let generationPosts = 0;
  let providerRequests = 0;

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, running, slot, success, taskId }) => {
    const marker = "__m41:text-prompt-owner-seeded";
    if (window.sessionStorage.getItem(marker) !== "1") {
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }
    const state: {
      lateResponses: number;
      releaseSuccess?: () => void;
      taskGets: number;
    } = { lateResponses: 0, taskGets: 0 };
    (window as typeof window & {
      __m41TextPromptOwner?: typeof state;
    }).__m41TextPromptOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${taskId}`
      ) {
        state.taskGets += 1;
        if (state.taskGets >= 2) {
          return new Promise<Response>((resolve) => {
            state.releaseSuccess = () => {
              state.lateResponses += 1;
              resolve(new Response(JSON.stringify(success), {
                headers: { "Content-Type": "application/json" },
                status: 200,
              }));
            };
          });
        }
        return Promise.resolve(new Response(JSON.stringify(running), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, {
    intent: {
      canvasId: "default",
      idempotencyKey: "m41-text-prompt-owner-key",
      kind,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:50:00.250Z",
      version: 1,
    },
    running: runningTask,
    slot: intentSlot,
    success: successTask,
    taskId,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Text prompt owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.text.id,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (inbound.method() === "POST") generationPosts += 1;
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  const submittedParameters = submissionParameterValues(
    schemas.text,
    defaultParameterValues(schemas.text),
  );
  const activeInputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.text.id,
    ownPrompt: originalPrompt,
    parameters: submittedParameters,
    prompt: originalPrompt,
  });
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          content: protectedBody,
          contentHtml: `<p>${protectedBody}</p>`,
          textGenerating: true,
          textGenerationInputKey: activeInputKey,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextPromptOwner?: { taskGets: number };
      }).__m41TextPromptOwner?.taskGets ?? 0)).toBeGreaterThanOrEqual(2);

    await selectNode(page, kind);
    const prompt = page.getByTestId("text-creator-prompt");
    await prompt.fill(changedPrompt);
    await prompt.blur();
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating ?? false,
        inputKey: data?.textGenerationInputKey ?? null,
        prompt: data?.textPrompt,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      content: protectedBody,
      generating: false,
      inputKey: null,
      prompt: changedPrompt,
      taskId: null,
    });
    await expect.poll(() => page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();

    await page.evaluate(() => {
      (window as typeof window & {
        __m41TextPromptOwner?: { releaseSuccess?: () => void };
      }).__m41TextPromptOwner?.releaseSuccess?.();
    });
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextPromptOwner?: { lateResponses: number };
      }).__m41TextPromptOwner?.lateResponses ?? 0)).toBe(1);
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    await expect(page.getByTestId("text-node-editor")).toHaveText(protectedBody);
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating ?? false,
        prompt: data?.textPrompt,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      content: protectedBody,
      generating: false,
      prompt: changedPrompt,
      taskId: null,
    });
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("text-node-editor")).toHaveText(protectedBody);
    await selectNode(page, kind);
    await expect(page.getByTestId("text-creator-prompt"))
      .toHaveValue(changedPrompt);
    const reloadedCanvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    const reloadedData = reloadedCanvas.nodes.find(
      (node) => node.id === nodeId(kind),
    )?.data;
    expect(reloadedData?.textGenerationTaskId).toBeUndefined();
    expect(reloadedData?.textGenerating).not.toBe(true);
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("an upstream Text body change revokes a persisted active poll while the model catalog is delayed", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const targetId = nodeId(kind);
  const sourceId = "m41-text-upstream-owner-source";
  const taskId = "m41-text-upstream-owner-task";
  const intentSlot = submissionIntentSlot(kind);
  const originalPrompt = "text 原始提示词";
  const originalUpstream = "上游初始语义正文";
  const changedUpstream = "上游已提交的新语义正文";
  const protectedBody = "上游变化不得被迟到结果覆盖的目标正文";
  const submittedParameters = submissionParameterValues(
    schemas.text,
    defaultParameterValues(schemas.text),
  );
  const [targetNode] = canvasNodes(kind);
  const sourceNode = {
    data: {
      content: originalUpstream,
      contentHtml: `<p>${originalUpstream}</p>`,
      label: "Text",
      title: "上游语义来源",
    },
    id: sourceId,
    position: { x: 80, y: 80 },
    style: { height: 250, width: 250 },
    type: "text",
  };
  const upstreamEdge = {
    data: { inputOrder: 1, inputRole: "context-text" },
    id: "m41-text-upstream-owner-edge",
    source: sourceId,
    sourceHandle: "source",
    target: targetId,
    targetHandle: "target",
    type: "cuttable",
  };
  const initialPreflight = resolveNodeInputs({
    edges: [upstreamEdge],
    modelSchema: schemas.text,
    nodes: [sourceNode, targetNode],
    ownPrompt: originalPrompt,
    parameters: submittedParameters,
    targetId,
    targetKind: kind,
  });
  expect(initialPreflight.canSubmit).toBe(true);
  expect(initialPreflight.inputs).toEqual([
    expect.objectContaining({
      sourceNodeId: sourceId,
      state: "ready",
      text: originalUpstream,
    }),
  ]);
  const activeInputKey = generationInputKey({
    inputs: initialPreflight.inputs,
    modelId: modelInputs.text.id,
    ownPrompt: originalPrompt,
    parameters: submittedParameters,
    prompt: initialPreflight.finalPrompt,
  });
  const activeOwnershipKey = compactGenerationOwnershipKey({
    modelId: modelInputs.text.id,
    parameters: defaultParameterValues(schemas.text),
    prompt: originalPrompt,
    upstream: [{
      edgeId: upstreamEdge.id,
      order: 1,
      ready: true,
      role: "context-text",
      source: sourceId,
      sourceKind: "text",
      status: "ready",
      text: originalUpstream,
    }],
  });
  const runningTask = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-09T10:55:00.000Z",
    id: taskId,
    generationInputKey: activeInputKey,
    kind,
    model: modelInputs.text.id,
    nodeId: targetId,
    prompt: initialPreflight.finalPrompt,
    state: "running",
    updatedAt: "2026-08-09T10:55:00.500Z",
  };
  const successTask = {
    ...runningTask,
    resultText: "迟到的旧上游生成结果",
    state: "success",
    updatedAt: "2026-08-09T10:55:01.000Z",
  };
  let generationPosts = 0;
  let modelReads = 0;
  let providerRequests = 0;
  let releaseModels!: () => void;
  const modelsGate = new Promise<void>((resolve) => {
    releaseModels = resolve;
  });

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, running, slot, success, taskId }) => {
    const marker = "__m41:text-upstream-owner-seeded";
    if (window.sessionStorage.getItem(marker) !== "1") {
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(slot, JSON.stringify(intent));
    }
    const state: {
      lateResponses: number;
      releaseSuccess?: () => void;
      taskGets: number;
    } = { lateResponses: 0, taskGets: 0 };
    (window as typeof window & {
      __m41TextUpstreamOwner?: typeof state;
    }).__m41TextUpstreamOwner = state;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const url = new URL(raw, window.location.href);
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (
        method === "GET" &&
        url.pathname === `/api/generation-tasks/${taskId}`
      ) {
        state.taskGets += 1;
        if (state.taskGets >= 2) {
          return new Promise<Response>((resolve) => {
            state.releaseSuccess = () => {
              state.lateResponses += 1;
              resolve(new Response(JSON.stringify(success), {
                headers: { "Content-Type": "application/json" },
                status: 200,
              }));
            };
          });
        }
        return Promise.resolve(new Response(JSON.stringify(running), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }));
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }, {
    intent: {
      canvasId: "default",
      generationOwnershipKey: activeOwnershipKey,
      idempotencyKey: "m41-text-upstream-owner-key",
      kind,
      nodeId: targetId,
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-09T10:55:00.250Z",
      version: 1,
    },
    running: runningTask,
    slot: intentSlot,
    success: successTask,
    taskId,
  });
  await page.route("**/api/models", async (route) => {
    modelReads += 1;
    await modelsGate;
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Text upstream owner",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.text.id,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (inbound.method() === "POST") generationPosts += 1;
    if (url.pathname.endsWith("/by-idempotency")) {
      await route.fulfill({ json: { error: "not found" }, status: 404 });
      return;
    }
    if (inbound.method() === "GET" && url.pathname === "/api/generation-tasks") {
      await route.fulfill({ json: { tasks: [] }, status: 200 });
      return;
    }
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });

  await request.delete("/api/canvas/default");
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [upstreamEdge],
      nodes: [
        sourceNode,
        {
          ...targetNode,
          data: {
            ...targetNode.data,
            content: protectedBody,
            contentHtml: `<p>${protectedBody}</p>`,
            textGenerating: true,
            textGenerationInputKey: activeInputKey,
            textGenerationOwnershipKey: activeOwnershipKey,
            textGenerationTaskId: taskId,
          },
          position: { x: 620, y: 80 },
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();
  let heldSavePayload: {
    nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
  } | undefined;
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let saveHeld = false;
  await page.route("**/api/canvas/default", async (route) => {
    if (route.request().method() !== "PUT" || saveHeld) {
      await route.continue();
      return;
    }
    saveHeld = true;
    heldSavePayload = route.request().postDataJSON() as typeof heldSavePayload;
    markSaveStarted();
    await saveGate;
    await route.continue();
  });

  try {
    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(() => modelReads).toBeGreaterThanOrEqual(1);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextUpstreamOwner?: { taskGets: number };
      }).__m41TextUpstreamOwner?.taskGets ?? 0)).toBeGreaterThanOrEqual(2);

    const source = page.locator(`.react-flow__node[data-id="${sourceId}"]`);
    const target = page.locator(`.react-flow__node[data-id="${targetId}"]`);
    await source.click({ force: true });
    await source.getByTestId("canvas-node-text-content")
      .dispatchEvent("dblclick");
    const sourceEditor = source.getByTestId("text-node-editor");
    await expect(sourceEditor).toHaveAttribute("contenteditable", "true");
    await sourceEditor.fill(changedUpstream);
    await sourceEditor.press("Escape");
    await saveStarted;

    const heldSourceData = heldSavePayload?.nodes?.find(
      (node) => node.id === sourceId,
    )?.data;
    const heldTargetData = heldSavePayload?.nodes?.find(
      (node) => node.id === targetId,
    )?.data;
    expect(heldSourceData?.content).toBe(changedUpstream);
    expect(heldTargetData?.content).toBe(protectedBody);
    expect(heldTargetData?.textGenerating).not.toBe(true);
    expect(heldTargetData?.textGenerationInputKey).toBeUndefined();
    expect(heldTargetData?.textGenerationOwnershipKey).toBeUndefined();
    expect(heldTargetData?.textGenerationTaskId).toBeUndefined();
    await expect.poll(() => page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();

    await target.click({ force: true, position: { x: 8, y: 8 } });
    await expect(page.getByTestId("text-creator")).toBeVisible();
    const generate = page.getByTestId("text-creator")
      .getByRole("button", { name: "Generate" });
    await expect(generate).toBeDisabled();
    await expect(target.getByTestId("text-node-editor")).toHaveText(
      protectedBody,
    );

    releaseSave();
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const sourceData = canvas.nodes.find((node) => node.id === sourceId)?.data;
      const targetData = canvas.nodes.find((node) => node.id === targetId)?.data;
      return {
        sourceContent: sourceData?.content,
        targetContent: targetData?.content,
        targetGenerating: targetData?.textGenerating ?? false,
        targetInputKey: targetData?.textGenerationInputKey ?? null,
        targetTaskId: targetData?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      sourceContent: changedUpstream,
      targetContent: protectedBody,
      targetGenerating: false,
      targetInputKey: null,
      targetTaskId: null,
    });

    await page.evaluate(() => {
      (window as typeof window & {
        __m41TextUpstreamOwner?: { releaseSuccess?: () => void };
      }).__m41TextUpstreamOwner?.releaseSuccess?.();
    });
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __m41TextUpstreamOwner?: { lateResponses: number };
      }).__m41TextUpstreamOwner?.lateResponses ?? 0)).toBe(1);
    await flushBrowserTasks(page);
    await flushBrowserTasks(page);
    await expect(target.getByTestId("text-node-editor")).toHaveText(
      protectedBody,
    );
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === targetId)?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating ?? false,
        inputKey: data?.textGenerationInputKey ?? null,
        taskId: data?.textGenerationTaskId ?? null,
      };
    }).toEqual({
      content: protectedBody,
      generating: false,
      inputKey: null,
      taskId: null,
    });
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();

    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await expect(page.locator(`.react-flow__node[data-id="${sourceId}"]`)
      .getByTestId("text-node-editor")).toHaveText(changedUpstream);
    await target.click({ force: true, position: { x: 8, y: 8 } });
    await expect(page.getByTestId("text-creator")).toBeVisible();
    await expect(target.getByTestId("text-node-editor")).toHaveText(
      protectedBody,
    );
    const reloadedCanvas = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    const reloadedTarget = reloadedCanvas.nodes.find(
      (node) => node.id === targetId,
    )?.data;
    expect(reloadedTarget?.textGenerationTaskId).toBeUndefined();
    expect(reloadedTarget?.textGenerating).not.toBe(true);
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    releaseModels();
    releaseSave();
    await page.evaluate((slot) => {
      (window as typeof window & {
        __m41TextUpstreamOwner?: { releaseSuccess?: () => void };
      }).__m41TextUpstreamOwner?.releaseSuccess?.();
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

test("a hung then failed terminal Text canvas patch replays the same-tab canvas session journal", async ({
  page,
  request,
}) => {
  const kind = "text" as const;
  const taskId = "m41-text-terminal-save-lost";
  const originalPrompt = "text 原始提示词";
  const oldBody = "terminal save 前保留的旧正文";
  const resultText = "reload exact GET 恢复的正文";
  const parameters = submissionParameterValues(
    schemas.text,
    defaultParameterValues(schemas.text),
  );
  const inputKey = generationInputKey({
    inputs: [],
    modelId: modelInputs.text.id,
    ownPrompt: originalPrompt,
    parameters,
    prompt: originalPrompt,
  });
  const ownershipKey = compactGenerationOwnershipKey({
    modelId: modelInputs.text.id,
    parameters: defaultParameterValues(schemas.text),
    prompt: originalPrompt,
    upstream: [],
  });
  const successTask = {
    attempt: 1,
    canvasId: "default",
    costCurrency: "CNY",
    createdAt: "2026-08-10T11:00:00.000Z",
    generationInputKey: inputKey,
    generationOwnershipKey: ownershipKey,
    id: taskId,
    kind,
    model: modelInputs.text.id,
    nodeId: nodeId(kind),
    prompt: originalPrompt,
    resultText,
    state: "success",
    updatedAt: "2026-08-10T11:00:01.000Z",
  };
  const intentSlot = submissionIntentSlot(kind);
  let exactReads = 0;
  let allowJournalReplay = false;
  let generationPosts = 0;
  let providerRequests = 0;
  let terminalWrites = 0;
  let releaseTerminalWrite!: () => void;
  const terminalWriteGate = new Promise<void>((resolve) => {
    releaseTerminalWrite = resolve;
  });
  let markTerminalWriteStarted!: () => void;
  const terminalWriteStarted = new Promise<void>((resolve) => {
    markTerminalWriteStarted = resolve;
  });
  let markTerminalWriteFailed!: () => void;
  const terminalWriteFailed = new Promise<void>((resolve) => {
    markTerminalWriteFailed = resolve;
  });

  page.on("request", (entry) => {
    if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
  });
  await page.addInitScript(({ intent, marker, slot }) => {
    if (window.sessionStorage.getItem(marker) === "1") return;
    window.sessionStorage.setItem(marker, "1");
    window.localStorage.setItem(slot, JSON.stringify(intent));
  }, {
    intent: {
      canvasId: "default",
      generationOwnershipKey: ownershipKey,
      idempotencyKey: "m41-text-terminal-save-lost-key",
      kind,
      nodeId: nodeId(kind),
      requestSignature: recoveryRequestSignature(kind),
      taskId,
      updatedAt: "2026-08-10T11:00:00.500Z",
      version: 1,
    },
    marker: "__m41:text-terminal-save-lost",
    slot: intentSlot,
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      json: {
        generationEnabled: true,
        models: [{
          capability: kind,
          displayName: "Terminal save Text",
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: modelInputs.text.id,
          isDefault: true,
          parameterSchema: schemas.text,
        }],
      },
      status: 200,
    });
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const inbound = route.request();
    const url = new URL(inbound.url());
    if (url.pathname.endsWith("/status")) {
      await route.fulfill({
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
    if (
      inbound.method() === "GET" &&
      url.pathname === `/api/generation-tasks/${taskId}`
    ) {
      exactReads += 1;
      await route.fulfill({ json: successTask, status: 200 });
      return;
    }
    if (inbound.method() === "POST") generationPosts += 1;
    await route.fulfill({ json: { error: "unexpected" }, status: 404 });
  });
  await page.route("**/api/canvas/default", async (route) => {
    const inbound = route.request();
    if (inbound.method() !== "PUT") {
      await route.continue();
      return;
    }
    const body = inbound.postDataJSON() as {
      nodes?: Array<{ data?: Record<string, unknown>; id?: string }>;
    };
    const target = body.nodes?.find((node) => node.id === nodeId(kind));
    if (target?.data?.content !== resultText) {
      await route.continue();
      return;
    }
    if (allowJournalReplay) {
      await route.continue();
      return;
    }
    terminalWrites += 1;
    if (terminalWrites === 1) {
      markTerminalWriteStarted();
      await terminalWriteGate;
    }
    await route.fulfill({
      json: { error: "terminal canvas ACK lost" },
      status: 503,
    });
    if (terminalWrites === 1) markTerminalWriteFailed();
  });

  await request.delete("/api/canvas/default");
  const [baseNode] = canvasNodes(kind);
  expect((await request.put("/api/canvas/default", {
    data: {
      edges: [],
      nodes: [{
        ...baseNode,
        data: {
          ...baseNode.data,
          content: oldBody,
          contentHtml: `<p>${oldBody}</p>`,
          textGenerating: true,
          textGenerationInputKey: inputKey,
          textGenerationOwnershipKey: ownershipKey,
          textGenerationTaskId: taskId,
        },
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 0.75 },
    },
  })).ok()).toBeTruthy();

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    await terminalWriteStarted;
    expect(terminalWrites).toBe(1);
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).not.toBeNull();

    releaseTerminalWrite();
    await terminalWriteFailed;
    await flushBrowserTasks(page);
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).not.toBeNull();
    const beforeReload = await (
      await request.get("/api/canvas/default")
    ).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    expect(beforeReload.nodes.find((node) => node.id === nodeId(kind))?.data)
      .toEqual(expect.objectContaining({
        content: oldBody,
        textGenerationTaskId: taskId,
      }));

    allowJournalReplay = true;
    await page.reload();
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");
    expect(exactReads).toBe(1);
    await expect.poll(async () => {
      const canvas = await (
        await request.get("/api/canvas/default")
      ).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
      return {
        content: data?.content,
        generating: data?.textGenerating ?? false,
        inputKey: data?.textGenerationInputKey ?? null,
        ownershipKey: data?.textGenerationOwnershipKey ?? null,
        taskId: data?.textGenerationTaskId,
      };
    }).toEqual({
      content: resultText,
      generating: false,
      inputKey: null,
      ownershipKey: null,
      taskId,
    });
    expect(await page.evaluate((slot) =>
      window.localStorage.getItem(slot), intentSlot)).toBeNull();
    expect(generationPosts).toBe(0);
    expect(providerRequests).toBe(0);
  } finally {
    releaseTerminalWrite();
    await page.evaluate((slot) => {
      window.localStorage.removeItem(slot);
    }, intentSlot).catch(() => undefined);
    await request.delete("/api/canvas/default");
  }
});

for (const kind of ["image", "video"] as const) {
  test(`${kind} clears a terminal cancellation returned to the initial Generate click`, async ({
    page,
    request,
  }) => {
    const taskId = `m41-generate-cancelled-${kind}`;
    const intentSlot = submissionIntentSlot(kind);
    let providerRequests = 0;
    let taskReads = 0;
    let taskSubmissions = 0;
    let releaseCancelled!: () => void;
    const cancelledGate = new Promise<void>((resolve) => {
      releaseCancelled = resolve;
    });
    const queuedTask = {
      attempt: 1,
      canvasId: "default",
      costCurrency: "CNY",
      createdAt: "2026-08-09T11:00:00.000Z",
      id: taskId,
      kind,
      model: modelInputs[kind].id,
      nodeId: nodeId(kind),
      prompt: `${kind} 原始提示词`,
      state: "queued",
      updatedAt: "2026-08-09T11:00:00.500Z",
    };

    page.on("request", (entry) => {
      if (/volces|openrouter|mureka/i.test(entry.url())) providerRequests += 1;
    });
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        json: {
          generationEnabled: true,
          models: [{
            capability: kind,
            displayName: `Cancelled Generate ${kind}`,
            generationAvailable: true,
            generationUnavailableReason: "",
            generationUnavailableReasonCode: null,
            id: modelInputs[kind].id,
            isDefault: true,
            parameterSchema: schemas[kind],
          }],
        },
        status: 200,
      });
    });
    await page.route("**/api/generation-tasks**", async (route) => {
      const inbound = route.request();
      const url = new URL(inbound.url());
      if (url.pathname.endsWith("/status")) {
        await route.fulfill({
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
      if (url.pathname.endsWith("/by-idempotency")) {
        await route.fulfill({ json: { error: "not found" }, status: 404 });
        return;
      }
      if (url.pathname.endsWith("/preflight") && inbound.method() === "POST") {
        await route.fulfill({
          json: { canEnqueue: true, canSubmit: true, problems: [] },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === `/api/generation-tasks/${taskId}` &&
        inbound.method() === "GET"
      ) {
        taskReads += 1;
        await cancelledGate;
        await route.fulfill({
          json: {
            ...queuedTask,
            errorCode: "USER_CANCELLED",
            errorMessage: `${kind} 生成已取消`,
            state: "cancelled",
            updatedAt: "2026-08-09T11:00:01.000Z",
          },
          status: 200,
        });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "POST"
      ) {
        taskSubmissions += 1;
        await route.fulfill({ json: queuedTask, status: 202 });
        return;
      }
      if (
        url.pathname === "/api/generation-tasks" &&
        inbound.method() === "GET"
      ) {
        await route.fulfill({ json: { tasks: [] }, status: 200 });
        return;
      }
      await route.fulfill({ json: { error: "unexpected" }, status: 404 });
    });

    await request.delete("/api/canvas/default");
    expect((await request.put("/api/canvas/default", {
      data: {
        edges: [],
        nodes: canvasNodes(kind),
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 0.75 },
      },
    })).ok()).toBeTruthy();

    try {
      await page.goto("/canvas");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await selectNode(page, kind);
      await page.getByTestId(`${kind}-creator`)
        .getByRole("button", { name: "Generate" })
        .click();
      await expect.poll(() => taskReads).toBeGreaterThanOrEqual(1);
      await expect.poll(() => page.evaluate(({ slot, taskId }) => {
        const serialized = window.localStorage.getItem(slot);
        return serialized
          ? (JSON.parse(serialized) as { taskId?: string }).taskId === taskId
          : false;
      }, { slot: intentSlot, taskId })).toBe(true);
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          generating: data?.[`${kind}Generating`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({ generating: true, taskId });

      releaseCancelled();
      await expect.poll(async () => {
        const canvas = await (
          await request.get("/api/canvas/default")
        ).json() as {
          nodes: Array<{ data: Record<string, unknown>; id: string }>;
        };
        const data = canvas.nodes.find((node) => node.id === nodeId(kind))?.data;
        return {
          generating: data?.[`${kind}Generating`],
          taskId: data?.[`${kind}GenerationTaskId`] ?? null,
        };
      }).toEqual({ generating: false, taskId: null });
      await expect.poll(() => page.evaluate((slot) =>
        window.localStorage.getItem(slot), intentSlot)).toBeNull();
      expect(taskSubmissions).toBe(1);
      expect(providerRequests).toBe(0);
    } finally {
      releaseCancelled();
      await page.evaluate((slot) => {
        window.localStorage.removeItem(slot);
      }, intentSlot).catch(() => undefined);
      await request.delete("/api/canvas/default");
    }
  });
}
