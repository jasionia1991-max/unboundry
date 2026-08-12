import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";

const mediaDirectory = mkdtempSync(join(tmpdir(), "unboundry-playlist-test-"));
const videos = ["red", "blue"].map((color, index) => {
  const path = join(mediaDirectory, `clip-${index}.mp4`);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${index === 0 ? "180x320" : "320x180"}:d=4`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${440 + index * 220}:duration=4`,
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    path,
  ]);
  return path;
});

function playlistExportPayload(body: string) {
  try {
    return JSON.parse(body) as {
      clips?: Array<{ assetId?: string }>;
      mode?: string;
    };
  } catch {
    const payload = new URLSearchParams(body).get("payload");
    if (!payload) throw new Error("playlist export payload is missing");
    return JSON.parse(payload) as {
      clips?: Array<{ assetId?: string }>;
      mode?: string;
    };
  }
}

test.afterAll(() => rmSync(mediaDirectory, { force: true, recursive: true }));

test("Playlist empty state matches Unboundry", async ({ page, request }) => {
  await request.delete("/api/canvas/node.playlist.empty");
  await page.goto("/__fixture/node.playlist.empty");

  const node = page.locator(".react-flow__node-playlist");
  const card = page.getByTestId("playlist-node-playlist-primary");
  await expect(node.locator(".node-handle-plus")).toHaveCount(0);
  expect(await node.boundingBox()).toMatchObject({ width: 960, height: 104 });
  await expect(card).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await expect(card).toHaveCSS("border-radius", "16px");
  await expect(page.getByText("Playlist", { exact: true })).toBeVisible();
  await expect(page.getByTestId("playlist-ruler")).toContainText("00:00");
  await expect(page.getByTestId("playlist-ruler")).toContainText("01:00");
  await expect(page.getByTestId("playlist-ruler").locator("b")).toHaveCount(7);
  const cardBox = (await card.boundingBox())!;
  const firstTime = (await page
    .getByTestId("playlist-ruler")
    .locator("b")
    .first()
    .boundingBox())!;
  const lastTime = (await page
    .getByTestId("playlist-ruler")
    .locator("b")
    .last()
    .boundingBox())!;
  expect(firstTime.x - cardBox.x).toBe(8);
  expect(cardBox.x + cardBox.width - (lastTime.x + lastTime.width)).toBe(8);
  await expect(
    page.getByText("轻点 + 在画布上选取视频", { exact: true }),
  ).toBeVisible();

  await node.click({ position: { x: 20, y: 50 } });
  await expect(page.getByTestId("playlist-node-actions")).toHaveCount(0);

  const title = page.getByTestId("playlist-node-title-input");
  await title.fill("成片列表");
  await title.press("Enter");
  await expect(title).toHaveValue("成片列表");
  await page.keyboard.press("Meta+z");
  await expect(title).toHaveValue("Playlist");

  await title.dispatchEvent("compositionstart", { data: "" });
  await title.evaluate((input: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setValue.call(input, "中文播放列表");
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "中文播放列表",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
  });
  await title.dispatchEvent("compositionend", { data: "中文播放列表" });
  await expect(title).toHaveValue("中文播放列表");
  await title.focus();
  await title.dispatchEvent("compositionstart", { data: "" });
  await title.evaluate((input: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setValue.call(input, "测试a");
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "a",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
  });
  await title.dispatchEvent("keydown", {
    isComposing: true,
    key: "Enter",
    keyCode: 229,
  });
  await expect(title).toBeFocused();
  await title.dispatchEvent("compositionend", { data: "a" });
  await title.evaluate((input: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setValue.call(input, "测试a");
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "a",
        inputType: "insertText",
        isComposing: false,
      }),
    );
  });
  await expect(title).toHaveValue("测试a");

  const add = page.getByRole("button", { name: "添加片段" });
  expect(await add.boundingBox()).toMatchObject({ width: 48, height: 48 });
  await add.click();
  await expect(page.getByTestId("playlist-picker-banner")).toBeVisible();
  await expect(
    page.getByText("选择要添加的片段 · ESC 退出", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("playlist-picker-banner")).toHaveCount(0);

  await node.click({ position: { x: 20, y: 50 } });
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
});

test("Playlist pick-ready fixture can add its local source video", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.playlist.pick-ready");
  await page.goto("/__fixture/node.playlist.pick-ready");

  const playlist = page.locator(".react-flow__node-playlist");
  await expect(page.locator(".react-flow__node-video video")).toHaveCount(2);
  await playlist.getByRole("button", { name: "添加片段" }).click();
  await expect(page.getByTestId("playlist-picker-banner")).toBeVisible();
  await page.locator(".react-flow__node-video").first().click();
  await expect(page.getByRole("status")).toHaveText("已添加到播放列表");
  await expect(page.getByTestId("playlist-segment")).toHaveCount(1);
});

test("Playlist clips-ready fixture opens portrait and landscape clips", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.playlist.clips-ready");
  await page.goto("/__fixture/node.playlist.clips-ready");

  const card = page.getByTestId("playlist-node-playlist-primary");
  await expect(page.getByTestId("playlist-segment")).toHaveCount(2);
  await expect(card).toHaveAttribute("data-total-duration", "9.088");
  await expect(page.getByTestId("playlist-player")).toBeVisible();
  const playerVideo = page.getByTestId("playlist-player").locator("video");
  await expect
    .poll(async () => {
      const box = await playerVideo.boundingBox();
      return box ? box.width / box.height : 0;
    })
    .toBeCloseTo(180 / 320, 1);

  await playerVideo.evaluate((video: HTMLVideoElement) => {
    video.currentTime = 3.96;
  });
  await page
    .getByTestId("playlist-player")
    .getByRole("button", { name: "播放" })
    .click();
  await expect
    .poll(() => playerVideo.getAttribute("src"))
    .toContain("/fixtures/video-success.mp4");
  await expect(page.getByTestId("playlist-player")).toHaveAttribute(
    "data-playing",
    "true",
  );
});

test("Playlist supports pick, reorder, cut, undo and real mp4 export", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const playlistPosts: string[] = [];
  // The merged download is submitted by a native form into a short-lived
  // target page, so observe the whole browser context rather than only the
  // editor page that initiated it.
  page.context().on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/playlist/export"
    ) {
      playlistPosts.push(request.postData() ?? "");
    }
  });
  await request.delete("/api/canvas/node.playlist.workflow");
  await page.goto("/__fixture/node.playlist.workflow");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );

  const emptyVideoNode = page.locator(".react-flow__node-video").first();
  const emptyVideoCard = emptyVideoNode.locator(".video-node-card");
  expect(await emptyVideoNode.boundingBox()).toMatchObject({
    height: 250,
    width: 444,
  });
  expect(await emptyVideoCard.boundingBox()).toMatchObject({
    height: 250,
    width: 444,
  });

  const videoInputs = page.getByTestId("video-upload-input");
  await videoInputs.nth(0).setInputFiles(videos[0]);
  await videoInputs.nth(1).setInputFiles(videos[1]);
  await expect(page.locator(".video-node-card video")).toHaveCount(2);

  const playlist = page.locator(".react-flow__node-playlist");
  await playlist.click({ position: { x: 30, y: 50 } });
  await page.getByRole("button", { name: "添加片段" }).click();
  await expect(page.getByTestId("playlist-picker-banner")).toBeVisible();

  await page.locator(".react-flow__node-video").nth(0).click();
  await expect(page.getByRole("status")).toHaveText("已添加到播放列表");
  await page.locator(".react-flow__node-video").nth(1).click();
  await expect(page.getByTestId("playlist-segment")).toHaveCount(2);
  await page.getByTestId("playlist-picker-banner").getByText("退出").click();
  const player = page.getByTestId("playlist-player");
  const card = page.getByTestId("playlist-node-playlist-primary");
  await expect(player).toBeVisible();
  const playerVideo = player.locator("video");
  await expect
    .poll(async () => {
      const box = await playerVideo.boundingBox();
      return box ? box.width / box.height : 0;
    })
    .toBeCloseTo(180 / 320, 1);

  const firstSegmentBox = (await page
    .getByTestId("playlist-segment")
    .first()
    .boundingBox())!;
  await page.mouse.move(
    firstSegmentBox.x + firstSegmentBox.width * 0.75,
    firstSegmentBox.y + firstSegmentBox.height / 2,
  );
  await expect
    .poll(async () => Number(await card.getAttribute("data-preview-time")))
    .toBeGreaterThan(1);

  const ruler = page.getByTestId("playlist-ruler");
  const rulerBox = (await ruler.boundingBox())!;
  await ruler.click({ position: { x: 24, y: 8 } });
  const committedHead = page.getByTestId("playlist-playhead");
  const committedX = (await committedHead.boundingBox())!.x;
  const hoverX = rulerBox.x + 120;
  await page.mouse.move(hoverX, rulerBox.y + 8);
  await expect(page.getByTestId("playlist-previewhead")).toBeVisible();
  await expect
    .poll(async () => (await page.getByTestId("playlist-previewhead").boundingBox())!.x)
    .toBeCloseTo(hoverX, 0);
  expect((await committedHead.boundingBox())!.x).toBeCloseTo(committedX, 0);

  await page.keyboard.press("Space");
  await expect(player).toHaveAttribute("data-playing", "true");
  const playingCurrent = Number(await card.getAttribute("data-current-time"));
  await page.mouse.move(rulerBox.x + 160, rulerBox.y + 8);
  await expect
    .poll(async () => Number(await card.getAttribute("data-preview-time")))
    .not.toBe(playingCurrent);
  await page.keyboard.press("Space");
  await expect(player).not.toHaveAttribute("data-playing", "true");

  await card.hover();
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => Number(await card.getAttribute("data-timeline-zoom")))
    .toBeGreaterThan(1);
  await expect
    .poll(() => page.locator(".playlist-clip-frame[data-ready]").count())
    .toBeGreaterThan(2);

  await page.getByTestId("playlist-segment").first().click();
  await expect(page.getByRole("button", { name: "裁剪片段左侧" })).toBeVisible();
  const trimRight = page.getByRole("button", { name: "裁剪片段右侧" });
  const beforeHandleTrim = Number(
    await card.getAttribute("data-total-duration"),
  );
  const trimBox = (await trimRight.boundingBox())!;
  await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(trimBox.x - 20, trimBox.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await card.getAttribute("data-total-duration")))
    .toBeLessThan(beforeHandleTrim);
  await page.keyboard.press("Meta+z");

  await page.getByTestId("playlist-segment").first().click();
  const trimLeft = page.getByRole("button", { name: "裁剪片段左侧" });
  const framesBeforeTrim = await page
    .getByTestId("playlist-segment")
    .first()
    .locator(".playlist-clip-frame")
    .evaluateAll((frames) =>
      frames.map((frame) => (frame as HTMLElement).style.backgroundPosition),
    );
  const leftBox = (await trimLeft.boundingBox())!;
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + 24, leftBox.y + 10, { steps: 5 });
  await expect(page.locator(".playlist-trim-mask-left")).toBeVisible();
  await expect(page.getByTestId("playlist-segment").first()).toHaveAttribute(
    "data-clip-start",
    "0.000",
  );
  expect(
    await page
      .getByTestId("playlist-segment")
      .first()
      .locator(".playlist-clip-frame")
      .evaluateAll((frames) =>
        frames.map(
          (frame) => (frame as HTMLElement).style.backgroundPosition,
        ),
      ),
  ).toEqual(framesBeforeTrim);
  await page.mouse.up();
  const trimmedStart = Number(
    await page
      .getByTestId("playlist-segment")
      .first()
      .getAttribute("data-clip-start"),
  );
  expect(trimmedStart).toBeGreaterThan(0);
  const restoredHandle = page.getByRole("button", {
    name: "裁剪片段左侧",
  });
  const restoredBox = (await restoredHandle.boundingBox())!;
  await page.mouse.move(
    restoredBox.x + restoredBox.width / 2,
    restoredBox.y + 10,
  );
  await page.mouse.down();
  await page.mouse.move(restoredBox.x - 40, restoredBox.y + 10, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.getByTestId("playlist-segment").first()).toHaveAttribute(
    "data-clip-start",
    "0.000",
  );

  await page
    .getByTestId("playlist-player")
    .getByRole("button", { name: "关闭" })
    .click();

  const beforePlaylistDrag = (await playlist.boundingBox())!;
  const dragSegmentBox = (await page
    .getByTestId("playlist-segment")
    .first()
    .boundingBox())!;
  await page.mouse.move(
    dragSegmentBox.x + dragSegmentBox.width / 2,
    dragSegmentBox.y + dragSegmentBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragSegmentBox.x + dragSegmentBox.width / 2 + 3,
    dragSegmentBox.y + dragSegmentBox.height / 2 + 40,
    { steps: 5 },
  );
  await page.mouse.up();
  const afterPlaylistDrag = (await playlist.boundingBox())!;
  expect(afterPlaylistDrag.y).toBeGreaterThan(beforePlaylistDrag.y + 25);

  const segments = page.getByTestId("playlist-segment");
  const firstBox = (await segments.first().boundingBox())!;
  const secondBox = (await segments.nth(1).boundingBox())!;
  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width * 0.8,
    secondBox.y + secondBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(segments.first()).toContainText("视频 B");

  const playlistNodeCount = await page
    .locator(".react-flow__node-playlist")
    .count();
  await segments.first().click();
  await page.keyboard.press("Backspace");
  await expect(segments).toHaveCount(1);
  await expect(page.locator(".react-flow__node-playlist")).toHaveCount(
    playlistNodeCount,
  );
  await page.keyboard.press("Meta+z");
  await expect(segments).toHaveCount(2);

  const cutSegmentBox = (await segments.first().boundingBox())!;
  await segments.first().click({
    position: {
      x: cutSegmentBox.width / 2,
      y: cutSegmentBox.height / 2,
    },
  });
  const cut = page.getByRole("button", { name: "切割播放列表" });
  await expect(cut).toBeEnabled();
  await cut.click();
  await expect(segments).toHaveCount(3);
  await page.keyboard.press("Meta+z");
  await expect(segments).toHaveCount(2);
  await page.keyboard.press("c");
  await expect(segments).toHaveCount(3);
  await page.keyboard.press("Meta+z");
  await expect(segments).toHaveCount(2);

  const originalDuration = Number(await card.getAttribute("data-total-duration"));
  await page.keyboard.press("q");
  expect(Number(await card.getAttribute("data-total-duration"))).toBeLessThan(
    originalDuration,
  );
  await page.keyboard.press("Meta+z");
  await expect(card).toHaveAttribute(
    "data-total-duration",
    originalDuration.toFixed(3),
  );
  await page.keyboard.press("e");
  expect(Number(await card.getAttribute("data-total-duration"))).toBeLessThan(
    originalDuration,
  );
  await page.keyboard.press("Meta+z");
  await expect(card).toHaveAttribute(
    "data-total-duration",
    originalDuration.toFixed(3),
  );

  await page.getByRole("button", { name: "导出播放列表" }).click();
  const menu = page.getByTestId("playlist-export-menu");
  await expect(menu).toBeVisible();
  expect(await menu.boundingBox()).toMatchObject({ width: 224, height: 106 });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "⇩下载原始片段（mp4）",
    "⇩下载合并视频（mp4）",
    "⇧导出到画布",
  ]);

  const download = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: /下载合并视频/ }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe("Playlist.mp4");
  const path = await result.path();
  expect(path).toBeTruthy();
  const probe = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path!,
  ])
    .toString()
    .trim();
  expect(Number(probe)).toBeGreaterThan(7.5);
  const downloadPayload = playlistExportPayload(playlistPosts.find((body) =>
    playlistExportPayload(body).mode === "download"
  )!) as { clips: Array<{ assetId: string }>; mode: string };
  expect(downloadPayload.mode).toBe("download");
  expect(downloadPayload.clips).toHaveLength(2);
  expect(downloadPayload.clips.every((clip) => clip.assetId.endsWith(".mp4")))
    .toBe(true);
  expect(JSON.stringify(downloadPayload).length).toBeLessThan(32 * 1024);

  const originalDownloads: string[] = [];
  page.on("download", (item) => originalDownloads.push(item.suggestedFilename()));
  await page.evaluate(() => {
    const state = window as typeof window & { __m2MediaFetches?: number };
    state.__m2MediaFetches = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const value = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const path = new URL(value, window.location.origin).pathname;
      if (/^\/(?:api\/video-assets|fixtures)\//.test(path)) {
        state.__m2MediaFetches = (state.__m2MediaFetches ?? 0) + 1;
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;
  });
  await page.getByRole("button", { name: "导出播放列表" }).click();
  await page
    .getByTestId("playlist-export-menu")
    .getByRole("menuitem", { name: /下载原始片段/ })
    .click();
  await expect.poll(() => originalDownloads.length).toBe(2);
  expect(await page.evaluate(() =>
    (window as typeof window & { __m2MediaFetches?: number }).__m2MediaFetches
  )).toBe(0);

  await page.getByRole("button", { name: "导出播放列表" }).click();
  await page
    .getByTestId("playlist-export-menu")
    .getByRole("menuitem", { name: /导出到画布/ })
    .click();
  await expect(page.locator(".react-flow__node-video")).toHaveCount(3, {
    timeout: 20_000,
  });
  expect(playlistPosts.some((body) =>
    playlistExportPayload(body).mode === "asset"
  )).toBe(true);
  const exported = page.locator(".react-flow__node-video").last();
  await expect(exported.locator(".video-node-card")).toHaveAttribute(
    "data-asset-id",
    /.+\.mp4/,
  );
  const exportedVideo = exported.locator("video");
  await expect
    .poll(() => exportedVideo.getAttribute("src"))
    .toMatch(/^\/api\/video-assets\/.+\.mp4$/);
  await expect
    .poll(() =>
      exportedVideo.evaluate((video: HTMLVideoElement) => video.duration),
    )
    .toBeGreaterThan(7.5);
  const exportedBox = (await exported.boundingBox())!;
  expect(exportedBox.x).toBeGreaterThanOrEqual(0);
  expect(exportedBox.y).toBeGreaterThanOrEqual(0);
  expect(exportedBox.x).toBeLessThan(1440);
  expect(exportedBox.y).toBeLessThan(900);

  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.reload();
  const restoredVideo = page.locator(".react-flow__node-video").last().locator(
    "video",
  );
  await expect
    .poll(() => restoredVideo.getAttribute("src"))
    .toMatch(/^\/api\/video-assets\/.+\.mp4$/);
  const playback = await restoredVideo.evaluate(
    async (video: HTMLVideoElement) => {
      video.currentTime = 5.5;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("seek timeout")),
          5_000,
        );
        video.addEventListener(
          "seeked",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      video.pause();
      return {
        currentTime: video.currentTime,
        readyState: video.readyState,
        videoHeight: video.videoHeight,
        videoWidth: video.videoWidth,
      };
    },
  );
  expect(playback.readyState).toBe(4);
  expect(playback.videoHeight).toBeGreaterThan(0);
  expect(playback.videoWidth).toBeGreaterThan(0);
  expect(playback.currentTime).toBeGreaterThan(5.5);
});
