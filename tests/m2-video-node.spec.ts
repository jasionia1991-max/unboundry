import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mediaDirectory = mkdtempSync(join(tmpdir(), "unboundry-video-node-test-"));
const videoFile = join(mediaDirectory, "probe.mp4");
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=blue:s=320x180:d=2",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=2",
  "-shortest",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  videoFile,
]);

test.beforeEach(async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generationEnabled: false, models: [] }),
      status: 200,
    });
  });
});

test.afterAll(() => rmSync(mediaDirectory, { force: true, recursive: true }));

test("Video generating state disables controls and uses the shared loading effect", async ({
  page,
  request,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url())) {
      generationRequests.push(request.url());
    }
  });
  const canvasId = "node.video.generating";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);

  const node = page.locator(".react-flow__node-video");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(node).toHaveCSS("height", "250px");
  await expect(node).toHaveCSS("width", "444px");
  await expect(page.getByRole("status", { name: "视频生成中" })).toBeVisible();
  await expect(
    page.getByTestId("video-node-generating-background"),
  ).toHaveCSS("animation-name", "video-generating-background-breathe");
  await expect(
    page.getByTestId("video-node-generating-background"),
  ).toHaveCSS("animation-timing-function", "ease-in-out");
  const grid = page.getByTestId("video-node-loading-grid");
  await expect(grid).toHaveAttribute("data-grid-columns", "18");
  await expect(grid).toHaveAttribute("data-grid-rows", "18");
  await expect(grid).toHaveCSS(
    "animation-name",
    "video-generating-grid-breathe",
  );

  const creator = page.getByTestId("video-creator");
  await expect(creator).toBeVisible();
  await expect(creator.getByRole("textbox")).toBeDisabled();
  await expect(
    creator.getByRole("button", { name: "Generating..." }),
  ).toBeDisabled();
  await expect(creator.locator("button:not(:disabled)")).toHaveCount(0);
  await expect(creator).toContainText("暂无可用模型");
  await expect(creator).not.toContainText("Seedance 2.0 Mini");
  await expect(creator).toContainText("全能参考");
  await expect(creator).toContainText("1×");
  await expect(page.getByTestId("video-node-toolbar")).toHaveCount(0);
  expect(generationRequests).toEqual([]);

  const title = page.getByTestId("video-node-title-input");
  await title.fill("视频生成任务");
  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(page.getByTestId("video-node-title-input")).toHaveValue(
    "视频生成任务",
  );
});

test("Video success shows playable media and adds one history item without quota UI", async ({
  page,
  request,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url())) {
      generationRequests.push(request.url());
    }
  });
  await request.delete("/api/canvas/node.video.success");
  await request.delete("/api/history/fixture-video-success");
  await page.goto("/__fixture/node.video.success");

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  const preview = page.getByTestId("video-node-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty("muted", true);
  await expect(preview).not.toHaveAttribute("controls");
  await expect
    .poll(() =>
      preview.evaluate((video: HTMLVideoElement) => ({
        duration: video.duration,
        height: video.videoHeight,
        width: video.videoWidth,
      })),
    )
    .toEqual({ duration: 5.08, height: 480, width: 836 });
  await expect(page.getByTestId("credits")).toHaveCount(0);

  const creator = page.getByTestId("video-creator");
  await expect(creator).toBeVisible();
  await expect(creator).not.toContainText("◉");
  await expect(creator.getByRole("textbox")).toHaveValue(
    "A red square slowly moves from left to right on a plain white background. Minimal UI test.",
  );
  await expect(
    creator.getByRole("button", { name: "Generate" }),
  ).toBeDisabled();

  await page.getByTestId("history").click();
  await expect(page.getByTestId("history-panel")).toBeVisible();
  await expect(page.getByTestId("history-count-video")).toHaveText("1");
  await page.getByTestId("history-tab-video").click();
  await expect(page.getByRole("button", { name: "视频 1" })).toBeVisible();
  const history = await request.get("/api/history/fixture-video-success");
  expect((await history.json() as { items: unknown[] }).items).toHaveLength(1);
  expect(generationRequests).toEqual([]);
});

test("Video empty, upload and editing states match the frozen basic state", async ({
  page,
}) => {
  await page.goto("/__fixture/node.video.empty");

  const node = page.locator(".react-flow__node-video");
  const card = page.getByTestId("video-node-video-primary");
  expect(await node.boundingBox()).toMatchObject({ width: 444, height: 250 });
  await expect(card).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await expect(card).toHaveCSS("border-radius", "16px");
  const emptyUploadToolbar = page.getByTestId("video-empty-upload-toolbar");
  await expect(emptyUploadToolbar).not.toBeVisible();
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(0);

  await node.click({ position: { x: 8, y: 8 } });
  await expect(node).toHaveCSS("outline-color", "rgb(122, 122, 122)");
  await expect(page.getByRole("button", { name: "上传视频" })).toBeVisible();
  await expect(emptyUploadToolbar).toBeVisible();
  await expect(emptyUploadToolbar).toContainText("上传");
  expect((await emptyUploadToolbar.boundingBox())!.y)
    .toBeLessThan((await card.boundingBox())!.y);

  const title = page.getByTestId("video-node-title-input");
  await title.fill("成片");
  await title.press("Enter");
  await expect(title).toHaveValue("成片");

  await page.getByTestId("video-upload-input").setInputFiles(videoFile);
  const preview = page.getByTestId("video-node-preview");
  await expect(preview).toBeVisible();
  await expect(emptyUploadToolbar).not.toBeVisible();
  await expect(preview).toHaveJSProperty("muted", true);
  await expect(preview).not.toHaveAttribute("controls");
  await preview.evaluate((video: HTMLVideoElement) => {
    Object.defineProperties(video, {
      duration: { configurable: true, value: 15.5 },
      videoHeight: { configurable: true, value: 180 },
      videoWidth: { configurable: true, value: 320 },
    });
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { height: box?.height, width: box?.width };
    })
    .toEqual({ height: 250, width: 444 });
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
  await expect(
    node.locator(".react-flow__handle.target .node-handle-plus"),
  ).toHaveCount(0);
  await expect(node.locator(".video-node-play")).toHaveCount(0);
  const toolbar = page.getByTestId("video-node-toolbar");
  await expect(toolbar).toBeVisible();
  expect(await toolbar.boundingBox()).toMatchObject({
    width: 442,
    height: 48,
  });
  const toolbarBox = (await toolbar.boundingBox())!;
  const titleBox = (await node.locator(".video-node-title").boundingBox())!;
  expect(toolbarBox.y + toolbarBox.height).toBeLessThan(titleBox.y);
  await expect(toolbar.getByRole("button")).toHaveCount(10);
  await expect(
    toolbar.getByRole("button", { name: "下载" }),
  ).toBeVisible();

  const volume = page.getByRole("button", { name: "开启声音" });
  await expect(volume).toBeVisible();
  await volume.click();
  await expect(preview).toHaveJSProperty("muted", false);
  await page.getByRole("button", { name: "静音" }).click();
  await expect(preview).toHaveJSProperty("muted", true);

  await expect(page.getByRole("button", { name: "播放视频" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "视频进度" })).toHaveAttribute(
    "step",
    "0.1",
  );

  const replace = card.getByRole("button", { name: "替换" });
  await page.mouse.move(1000, 700);
  await expect(replace).toHaveCSS("opacity", "0");
  await card.hover();
  await expect(replace).toHaveCSS("opacity", "1");

  await preview.evaluate((video: HTMLVideoElement) => {
    Object.defineProperties(video, {
      duration: { configurable: true, value: 15.5 },
      videoHeight: { configurable: true, value: 1024 },
      videoWidth: { configurable: true, value: 576 },
    });
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { height: box?.height, width: box?.width };
    })
    .toEqual({ height: 444, width: 250 });

  await page.getByTestId("video-node-fullscreen").click();
  const detail = page.getByTestId("video-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByLabel("Video preview")).toBeVisible();
  await expect(detail.getByText("提示词", { exact: true })).toBeVisible();
  await expect(detail.getByText("暂无提示词")).toBeVisible();
  await expect(detail).toContainText("本地上传");
  await expect(detail).toContainText("576 x 1024");
  await expect(detail).toContainText("9 : 16");
  await expect(detail).toContainText("00:15");
  expect(
    await detail.locator(".video-detail-panel").boundingBox(),
  ).toMatchObject({ width: 284 });
  expect(
    await detail.locator(".video-detail-prompt").boundingBox(),
  ).toMatchObject({ width: 252, height: 180 });
  await expect(detail.getByRole("button", { name: "应用到画布" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "下载" })).toBeVisible();
  await detail.getByRole("button", { name: "关闭视频详情" }).click();
  await expect(detail).toBeHidden();

  const beforeDrag = (await node.boundingBox())!;
  await page.mouse.move(
    beforeDrag.x + beforeDrag.width / 4,
    beforeDrag.y + (beforeDrag.height * 3) / 4,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeDrag.x + beforeDrag.width / 4 + 80,
    beforeDrag.y + (beforeDrag.height * 3) / 4 + 80,
    { steps: 4 },
  );
  await page.mouse.up();
  const afterDrag = (await node.boundingBox())!;
  expect(afterDrag.x - beforeDrag.x).toBeGreaterThan(30);
  expect(afterDrag.y - beforeDrag.y).toBeGreaterThan(30);

  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { x: box?.x, y: box?.y };
    })
    .toEqual({ x: beforeDrag.x, y: beforeDrag.y });

  await page.keyboard.press("Meta+z");
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传视频" })).toBeVisible();
  expect(await node.boundingBox()).toMatchObject({ height: 250, width: 444 });
  await expect(
    node.locator(".react-flow__handle.target .node-handle-plus"),
  ).toHaveCount(1);

  await page.keyboard.press("Meta+z");
  await expect(title).toHaveValue("Video");
});
