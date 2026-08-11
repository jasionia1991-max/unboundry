import { expect, test } from "./safe-test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("history media opens previews and can add a real asset back to the canvas", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/panel.history.final");
  await request.delete("/api/history/fixture-account");
  const items = [
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
  ] as const;
  const uploads = [
    {
      bytes: readFileSync(resolve(
        "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
      )),
      contentType: "image/png",
      endpoint: "/api/assets/preview-image.png",
      fileName: "preview-image.png",
    },
    {
      bytes: readFileSync(resolve("client/public/fixtures/video-success.mp4")),
      contentType: "video/mp4",
      endpoint: "/api/video-assets/preview-video.mp4",
      fileName: "preview-video.mp4",
    },
    {
      bytes: readFileSync(resolve("client/public/fixtures/audio-success.mp3")),
      contentType: "audio/mpeg",
      endpoint: "/api/audio-assets/preview-audio.mp3",
      fileName: "preview-audio.mp3",
    },
  ] as const;

  try {
    for (const upload of uploads) {
      const response = await request.post(upload.endpoint, {
        data: upload.bytes,
        headers: {
          "Content-Type": upload.contentType,
          "X-File-Name": encodeURIComponent(upload.fileName),
        },
      });
      expect(response.status()).toBe(201);
      const readable = await request.get(upload.endpoint);
      expect(readable.status()).toBe(200);
      expect(await readable.body()).toEqual(upload.bytes);
    }
    for (const item of items) {
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
    const video = preview.locator("video");
    await expect(video).toHaveAttribute("src", "/api/video-assets/preview-video.mp4");
    await expect.poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.duration)
    ).toBeGreaterThan(0);
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
    const audio = preview.locator("audio");
    await expect(audio).toHaveAttribute("src", "/api/audio-assets/preview-audio.mp3");
    await expect.poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.duration)
    ).toBeGreaterThan(0);
    await preview.getByRole("button", { name: "关闭历史素材预览" }).click();
    await browser.getByRole("button", { name: "关闭全部历史" }).click();

    await panel.getByRole("tab", { name: /图片历史/ }).click();
    await panel.getByRole("button", { name: "可预览图片" }).click();
    preview = page.getByRole("dialog", { name: "可预览图片预览" });
    const image = preview.locator("img");
    await expect(image).toHaveAttribute("src", "/api/assets/preview-image.png");
    await expect.poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth)
    ).toBeGreaterThan(0);
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
  } finally {
    await request.delete("/api/canvas/panel.history.final");
    await request.delete("/api/history/fixture-account");
    await Promise.all(uploads.map((upload) => request.delete(upload.endpoint)));
  }
});
