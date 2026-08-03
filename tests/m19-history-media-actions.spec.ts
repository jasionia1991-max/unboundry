import { expect, test } from "@playwright/test";

test("history media opens previews and can add a real asset back to the canvas", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/panel.history.final");
  await request.delete("/api/history/fixture-account");
  for (const item of [
    {
      id: "preview-image.png",
      kind: "image",
      label: "可预览图片",
      preview: "/api/assets/preview-image.png",
    },
    {
      id: "preview-video.mp4",
      kind: "video",
      label: "可预览视频",
      preview: "/api/video-assets/preview-video.mp4",
    },
    {
      id: "preview-audio.mp3",
      kind: "audio",
      label: "可预览音频",
      preview: "/api/audio-assets/preview-audio.mp3",
    },
  ]) {
    expect((await request.post("/api/history/fixture-account", { data: item })).ok())
      .toBeTruthy();
  }

  await page.goto("/__fixture/panel.history.final");
  const world = page.getByTestId("canvas-world");
  const panel = page.getByTestId("history-panel");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "3");

  await panel.getByRole("tab", { name: /视频历史/ }).click();
  await panel.getByRole("button", { name: "可预览视频" }).click();
  let preview = page.getByRole("dialog", { name: "可预览视频预览" });
  await expect(preview.locator("video")).toHaveAttribute(
    "src",
    "/api/video-assets/preview-video.mp4",
  );
  await preview.getByRole("button", { name: "关闭历史素材预览" }).click();
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "浏览全部历史" }).click();
  const browser = page.getByTestId("history-browser");
  await browser
    .getByRole("navigation", { name: "历史素材类型" })
    .getByRole("button", { name: /音频/ })
    .click();
  await browser.getByRole("button", { name: "可预览音频" }).click();
  preview = page.getByRole("dialog", { name: "可预览音频预览" });
  await expect(preview.locator("audio")).toHaveAttribute(
    "src",
    "/api/audio-assets/preview-audio.mp3",
  );
  await preview.getByRole("button", { name: "关闭历史素材预览" }).click();
  await browser.getByRole("button", { name: "关闭全部历史" }).click();

  await panel.getByRole("tab", { name: /图片历史/ }).click();
  await panel.getByRole("button", { name: "可预览图片" }).click();
  preview = page.getByRole("dialog", { name: "可预览图片预览" });
  await expect(preview.locator("img")).toHaveAttribute(
    "src",
    "/api/assets/preview-image.png",
  );
  await preview.getByRole("button", { name: "添加到画布" }).click();
  await expect(panel).toHaveCount(0);
  await expect(world).toHaveAttribute("data-node-count", "4");
  await expect(
    page.locator('.react-flow__node-image img[src="/api/assets/preview-image.png"]'),
  ).toHaveCount(1);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "4");
  await expect(
    page.locator('.react-flow__node-image img[src="/api/assets/preview-image.png"]'),
  ).toHaveCount(1);

  await request.delete("/api/canvas/panel.history.final");
  await request.delete("/api/history/fixture-account");
});

