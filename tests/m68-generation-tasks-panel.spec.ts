import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";

const canvasId = "persistence.final-clean-canvas";

async function serverDataDirectory(request: import("@playwright/test").APIRequestContext) {
  const response = await request.get("/api/test-data-directory");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { dataDirectory: string };
  return body.dataDirectory;
}

test("generation task panel lists running and failed tasks for the canvas", async ({
  page,
  request,
}) => {
  const dataDirectory = await serverDataDirectory(request);
  const initial = await request.get(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
  );
  expect(initial.status()).toBe(200);
  await expect(initial.json()).resolves.toEqual({ tasks: [] });
  const store = createGenerationTaskStore(dataDirectory);
  const created = store.create({
    canvasId,
    idempotencyKey: "tasks-panel-running-0001",
    kind: "image",
    model: "fixture/image",
    nodeId: "panel-running-image",
    parameters: { count: 1 },
    prompt: "正在生成的测试图片",
  });
  const failed = store.create({
    canvasId,
    idempotencyKey: "tasks-panel-failed-0001",
    kind: "video",
    model: "fixture/video",
    nodeId: "panel-failed-video",
    parameters: { count: 1 },
    prompt: "失败的测试视频",
  });
  store.transition(failed.task.id, "running");
  store.transition(failed.task.id, "failed", {
    code: "PROVIDER_FAILED",
    message: "模型平台未完成本次生成，请重试",
  });
  store.close();

  const apiProbe = await request.get(
    `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
  );
  expect(apiProbe.status()).toBe(200);
  expect(((await apiProbe.json()) as { tasks: unknown[] }).tasks).toHaveLength(2);

  await page.goto(`/__fixture/${canvasId}`);
  await page.getByTestId("tasks").click();
  await expect(page.getByTestId("tasks-panel")).toBeVisible();
  await expect(page.getByTestId("tasks-list")).toBeVisible();
  await expect(page.getByTestId("tasks-active-count")).toHaveText("1");
  await expect(page.getByTestId("tasks-failed-count")).toHaveText("1");
  await expect(page.getByText("正在生成的测试图片")).toBeVisible();
  await expect(page.getByText("失败的测试视频")).toBeVisible();
  await expect(page.getByText("排队中", { exact: true })).toHaveCount(1);
  await expect(page.getByText("运行中", { exact: true })).toHaveCount(0);
  await expect(page.getByText("失败", { exact: true })).toHaveCount(1);
});

test("generation task panel explicitly abandons a received synchronous result without a Provider request", async ({
  page,
  request,
}) => {
  const targetCanvasId = canvasId;
  const dataDirectory = await serverDataDirectory(request);
  let store: ReturnType<typeof createGenerationTaskStore> | undefined =
    createGenerationTaskStore(dataDirectory);
  const task = store.create({
    canvasId: targetCanvasId,
    idempotencyKey: "tasks-panel-abandon-response-0001",
    kind: "image",
    model: "fixture/synchronous-image",
    modelConfiguration: { providerProtocol: "native" },
    nodeId: "panel-abandon-received-image",
    ownerId: "__test__",
    parameters: {},
    prompt: "需要显式放弃的已返回平台结果",
    providerModelId: "fixture-synchronous-image",
    providerProfileId: "fixture-synchronous-profile",
  }).task;
  try {
    const running = store.transition(task.id, "running")!;
    const paid = store.recordProviderAttempt(task.id);
    store.markProviderResponseReceived({
      executionAttempt: paid.executionAttempt,
      taskId: task.id,
    });
    store.transition(task.id, "failed", {
      code: "MEDIA_PUBLICATION_FAILED",
      message: "the received response could not be published locally",
    });
    store.close();
    store = undefined;

    const apiProbe = await request.get(
      `/api/generation-tasks/${task.id}`,
    );
    expect(apiProbe.status()).toBe(200);
    await expect(apiProbe.json()).resolves.toMatchObject({
      abandonAllowed: true,
      id: task.id,
      state: "failed",
    });

    let abandonPosts = 0;
    let providerRequests = 0;
    const confirmations: string[] = [];
    page.on("request", (outbound) => {
      const url = new URL(outbound.url());
      if (
        outbound.method() === "POST" &&
        url.pathname === `/api/generation-tasks/${task.id}/abandon`
      ) abandonPosts += 1;
      if (/openrouter|volcengine|mureka/i.test(outbound.url())) {
        providerRequests += 1;
      }
    });
    await page.goto(`/__fixture/${targetCanvasId}`);
    await page.getByTestId("tasks").click();
    const row = page.getByTestId(`tasks-row-${task.id}`);
    const abandon = page.getByTestId(`tasks-abandon-${task.id}`);
    await expect(row).toHaveAttribute("data-state", "failed");
    await expect(abandon).toHaveText("放弃平台结果");
    page.once("dialog", (dialog) => {
      confirmations.push(dialog.message());
      void dialog.dismiss();
    });
    await abandon.click();
    await expect(row).toHaveAttribute("data-state", "failed");
    expect(abandonPosts).toBe(0);

    page.once("dialog", (dialog) => {
      confirmations.push(dialog.message());
      void dialog.accept();
    });
    await abandon.click();
    await expect(row).toHaveAttribute("data-state", "cancelled");
    expect(confirmations).toHaveLength(2);
    expect(confirmations[0]).toContain("不再尝试恢复该平台结果");
    expect(confirmations[0]).toContain("不会重新付费");
    expect(abandonPosts).toBe(1);
    expect(providerRequests).toBe(0);

    store = createGenerationTaskStore(dataDirectory);
    expect(store.get(task.id)).toMatchObject({
      errorCode: "USER_ABANDONED",
      attempt: running.attempt,
      providerTaskId: undefined,
      state: "cancelled",
    });
    expect(store.getProviderAttemptForTask(task.id)).toMatchObject({
      executionAttempt: running.attempt,
      failureCode: "MEDIA_PUBLICATION_FAILED",
      outcome: "response-received",
      providerTaskId: undefined,
    });
    const database = openAppDatabase(dataDirectory);
    try {
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts
        WHERE task_id = ? AND evidence = 'provider-boundary'
      `).get(task.id)).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  } finally {
    store?.close();
  }
});

test("generation task panel reconciles one accepted retry after its response is lost", async ({
  page,
  request,
}) => {
  const taskId = "tasks-panel-lost-retry-0001";
  const generationInputKey = "tasks-panel-lost-retry-input";
  const targetCanvasId = "default";
  await request.delete(`/api/canvas/${targetCanvasId}`);
  const seededCanvas = await request.put(`/api/canvas/${targetCanvasId}`, {
    data: {
      edges: [],
      nodes: [{
        data: {
          content: "",
          label: "Text",
          textGenerationError: "retry response will be lost",
          textGenerationErrorCode: "OFFLINE_FIXTURE",
          textGenerationInputKey: generationInputKey,
          textGenerationRetryAllowed: true,
          textGenerationTaskId: taskId,
          textGenerating: false,
          textPrompt: "lost retry response",
          title: "Retry text",
        },
        hidden: true,
        id: "tasks-panel-lost-retry-node",
        position: { x: 80, y: 80 },
        style: { height: 250, width: 250 },
        type: "text",
      }],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(seededCanvas.ok()).toBeTruthy();
  const seededRevision = (await seededCanvas.json()) as {
    graphRevision: number;
  };
  const failed = {
    attempt: 1,
    canvasId: targetCanvasId,
    canvasRevision: seededRevision.graphRevision,
    costCurrency: "CNY",
    createdAt: "2026-08-11T08:00:00.000Z",
    errorCode: "OFFLINE_FIXTURE",
    errorMessage: "retry response will be lost",
    generationInputKey,
    id: taskId,
    kind: "text",
    nodeId: "tasks-panel-lost-retry-node",
    prompt: "lost retry response",
    retryAllowed: true,
    state: "failed",
    updatedAt: "2026-08-11T08:00:01.000Z",
  } as const;
  let current: Record<string, unknown> = failed;
  let exactReads = 0;
  let retryPosts = 0;
  let retryBody: Record<string, unknown> | undefined;
  let providerRequests = 0;
  await page.addInitScript(() => {
    const target = window as typeof window & { __m68RetryWakeups?: unknown[] };
    target.__m68RetryWakeups = [];
    window.addEventListener(
      "unboundry:generation-task-retry-accepted",
      (event) => target.__m68RetryWakeups?.push(
        (event as CustomEvent<unknown>).detail,
      ),
    );
  });
  page.on("request", (request) => {
    if (/openrouter|volcengine|mureka/i.test(request.url())) providerRequests += 1;
  });
  await page.route("**/api/generation-tasks**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname === "/api/generation-tasks"
    ) {
      await route.fulfill({ json: { tasks: [current] }, status: 200 });
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === `/api/generation-tasks/${taskId}`
    ) {
      exactReads += 1;
      await route.fulfill({ json: current, status: 200 });
      return;
    }
    if (
      request.method() === "POST" &&
      url.pathname === `/api/generation-tasks/${taskId}/retry`
    ) {
      retryPosts += 1;
      retryBody = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      current = {
        ...failed,
        retryAllowed: false,
        state: "queued",
        updatedAt: "2026-08-11T08:00:02.000Z",
      };
      await route.abort("connectionreset");
      return;
    }
    await route.fallback();
  });

  try {
    await page.goto("/canvas");
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-state",
      "ready",
    );
    await page.getByTestId("tasks").click();
    const row = page.getByTestId(`tasks-row-${taskId}`);
    await expect(row).toHaveAttribute("data-state", "failed");
    const durableBeforeRetry = await (
      await request.get(`/api/canvas/${targetCanvasId}`)
    ).json() as {
      graphRevision: number;
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    expect(durableBeforeRetry.nodes.find(({ id }) =>
      id === "tasks-panel-lost-retry-node"
    )?.data).toMatchObject({
      textGenerationInputKey: generationInputKey,
      textGenerationTaskId: taskId,
    });
    const exactReadsBeforeRetry = exactReads;
    await page.getByTestId(`tasks-retry-${taskId}`).click();
    await expect.poll(() => retryPosts).toBe(1);
    await expect.poll(() => exactReads - exactReadsBeforeRetry).toBe(2);
    await expect(row).toHaveAttribute("data-state", "queued");
    expect(retryBody).toEqual({
      canvasId: targetCanvasId,
      expectedAttempt: 1,
      expectedCanvasRevision: durableBeforeRetry.graphRevision,
      expectedGenerationInputKey: generationInputKey,
      expectedUpdatedAt: "2026-08-11T08:00:01.000Z",
      kind: "text",
      nodeId: "tasks-panel-lost-retry-node",
    });
    expect(await page.evaluate(() =>
      (window as typeof window & { __m68RetryWakeups?: unknown[] })
        .__m68RetryWakeups
    )).toEqual([{
      attempt: 1,
      canvasId: targetCanvasId,
      kind: "text",
      nodeId: "tasks-panel-lost-retry-node",
      taskId,
      updatedAt: "2026-08-11T08:00:02.000Z",
    }]);
    expect(retryPosts).toBe(1);
    expect(providerRequests).toBe(0);
  } finally {
    await request.delete(`/api/canvas/${targetCanvasId}`);
  }
});

test("generation task panel shows an empty state and closes with Escape", async ({
  page,
}) => {
  await page.goto("/__fixture/persistence.nodes-assets-viewport");
  await page.getByTestId("tasks").click();
  await expect(page.getByTestId("tasks-panel")).toBeVisible();
  await expect(page.getByTestId("tasks-empty")).toHaveText("还没有生成任务");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tasks-panel")).toHaveCount(0);
});
