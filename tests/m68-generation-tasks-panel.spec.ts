import { expect, test } from "./safe-test";
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
  const store = createGenerationTaskStore(await serverDataDirectory(request));
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
