import { expect, test } from "./safe-test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openAppDatabase } from "../server/database";

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
    const lazyImage = panel.getByRole("button", { name: "可预览图片" }).locator("img");
    await expect(lazyImage).toHaveAttribute("loading", "lazy");
    await expect(lazyImage).toHaveAttribute("decoding", "async");

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

test("history uses stable bounded pages and loads older assets only on request", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/panel.history.final");
  await request.delete("/api/history/fixture-account");
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = await dataDirectoryResponse.json() as {
    dataDirectory: string;
  };
  const store = openAppDatabase(dataDirectory);
  const insert = store.prepare(`
    INSERT INTO asset_history (
      account_id, id, kind, label, preview, created_at, owner_id
    ) VALUES ('fixture-account', ?, 'world3d', ?, ?, ?, '__test__')
  `);
  for (let index = 0; index < 65; index += 1) {
    const suffix = String(index).padStart(3, "0");
    insert.run(
      `paged-world-${suffix}`,
      `分页模型 ${suffix}`,
      `world-${suffix}`,
      new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    );
  }
  store.close();

  try {
    const firstResponse = await request.get(
      "/api/history/fixture-account?kind=world3d&limit=20&order=newest",
    );
    expect(firstResponse.status()).toBe(200);
    const first = await firstResponse.json() as {
      counts: { world3d: number };
      items: Array<{ id: string }>;
      nextCursor: string;
    };
    expect(first.counts.world3d).toBe(65);
    expect(first.items).toHaveLength(20);
    expect(first.items[0]?.id).toBe("paged-world-064");
    expect(first.items.at(-1)?.id).toBe("paged-world-045");
    expect(first.nextCursor).toBeTruthy();

    const updatedStore = openAppDatabase(dataDirectory);
    const updatedInsert = updatedStore.prepare(`
      INSERT INTO asset_history (
        account_id, id, kind, label, preview, created_at, owner_id
      ) VALUES (
        'fixture-account', 'paged-world-new', 'world3d',
        '分页模型 NEW', 'world-new', '2026-01-02T00:00:00.000Z', '__test__'
      )
    `);
    updatedInsert.run();
    updatedStore.close();

    const secondResponse = await request.get(
      `/api/history/fixture-account?kind=world3d&limit=20&order=newest&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    expect(secondResponse.status()).toBe(200);
    const second = await secondResponse.json() as {
      counts: { world3d: number };
      items: Array<{ id: string }>;
      nextCursor: string;
    };
    expect(second.counts.world3d).toBe(66);
    expect(second.items).toHaveLength(20);
    expect(second.items[0]?.id).toBe("paged-world-044");
    expect(second.items.at(-1)?.id).toBe("paged-world-025");
    expect(second.items.some((item) => item.id === "paged-world-new")).toBe(false);
    const wrongOrder = await request.get(
      `/api/history/fixture-account?kind=world3d&limit=20&order=oldest&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    expect(wrongOrder.status()).toBe(400);

    await page.goto("/__fixture/panel.history.final");
    const panel = page.getByTestId("history-panel");
    await expect(page.getByTestId("history-count-world3d")).toHaveText("66");
    await panel.getByRole("tab", { name: /^3D/ }).click();
    await expect(panel.locator(".history-card")).toHaveCount(60);
    await expect(panel.getByTestId("history-load-more")).toBeVisible();
    await panel.getByTestId("history-load-more").click();
    await expect(panel.locator(".history-card")).toHaveCount(66);
    await expect(panel.getByTestId("history-load-more")).toHaveCount(0);
  } finally {
    await request.delete("/api/canvas/panel.history.final");
    await request.delete("/api/history/fixture-account");
  }
});
