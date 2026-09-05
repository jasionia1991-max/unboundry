import { expect, test, type APIRequestContext } from "./safe-test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const canvasId = "interaction.upload-media-sandbox-current";
const projectIds = new Set<string>();
const mediaDirectory = mkdtempSync(join(tmpdir(), "unboundry-video-upload-"));
const videoFile = join(mediaDirectory, "一秒测试视频.mp4");
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=green:s=320x180:d=1",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=550:duration=1",
  "-shortest",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  videoFile,
]);

async function clearFixture(request: APIRequestContext) {
  const response = await request.get(`/api/canvas/${canvasId}`);
  if (response.ok()) {
    const document = await response.json() as {
      nodes: Array<{
        data: { assetId?: string; audioSrc?: string; videoSrc?: string };
      }>;
    };
    await Promise.all(
      document.nodes
        .filter((node) => node.data.assetId)
        .map((node) =>
          request.delete(
            `${node.data.videoSrc ? "/api/video-assets/" : "/api/audio-assets/"}${node.data.assetId}`,
          ),
        ),
    );
  }
  await request.delete(`/api/canvas/${canvasId}`);
}

test.beforeEach(async ({ request }) => clearFixture(request));
test.afterEach(async ({ request }) => {
  for (const projectId of projectIds) {
    await request.delete(`/api/projects/${projectId}`);
  }
  projectIds.clear();
  await clearFixture(request);
});
test.afterAll(() => rmSync(mediaDirectory, { force: true, recursive: true }));

test("MP4 playback, range delivery, download and metadata survive a reload", async ({
  page,
  request,
}) => {
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "2");

  await page.getByTestId("video-upload-input").setInputFiles(videoFile);
  const preview = page.getByTestId("video-node-preview");
  await expect.poll(async () => {
    if (await preview.count() !== 1) {
      return { hasLayout: false, mediaError: null, visible: false };
    }
    const layout = await preview.evaluate((video: HTMLVideoElement) => {
      const bounds = video.getBoundingClientRect();
      return {
        hasLayout: bounds.height > 0 && bounds.width > 0,
        mediaError: video.error?.code ?? null,
      };
    });
    return {
      ...layout,
      visible: await preview.isVisible(),
    };
  }, { timeout: 15_000 }).toEqual({
    hasLayout: true,
    mediaError: null,
    visible: true,
  });
  await expect(preview).toHaveJSProperty("muted", true);
  await expect
    .poll(() =>
      preview.evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByText("1.0s", { exact: true })).toBeVisible();

  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/${canvasId}`);
      if (!response.ok()) return "";
      const document = await response.json() as {
        nodes: Array<{
          data: { assetId?: string; sourceKind?: string };
        }>;
      };
      return document.nodes.find(
        (node) => node.data.sourceKind === "video",
      )?.data.assetId ?? "";
    })
    .not.toBe("");
  const document = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    nodes: Array<{
      data: {
        assetId: string;
        sourceKind: string;
        inputState: string;
        mediaByteSize: number;
        mediaContentType: string;
        mediaDurationSeconds: number;
        mediaHeight: number;
        mediaMetadataSource: string;
        mediaMetadataStatus: string;
        mediaStorageBackend: string;
        mediaWidth: number;
        videoSrc: string;
      };
    }>;
  };
  const videoNode = document.nodes.find(
    (node) => node.data.sourceKind === "video",
  )!;
  expect(videoNode.data).toMatchObject({
    inputState: "ready",
    mediaContentType: "video/mp4",
    mediaHeight: 180,
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: "local",
    mediaWidth: 320,
  });
  expect(videoNode.data.mediaByteSize).toBeGreaterThan(0);
  expect(videoNode.data.mediaDurationSeconds).toBeCloseTo(1, 1);

  const metadata = await request.get(
    `/api/media-metadata/video/${videoNode.data.assetId}`,
  );
  expect(metadata.ok()).toBeTruthy();
  await expect(metadata.json()).resolves.toMatchObject({
    byteSize: videoNode.data.mediaByteSize,
    contentType: "video/mp4",
    durationStatus: "ready",
    mediaHeight: 180,
    mediaWidth: 320,
    storageBackend: "local",
  });

  const range = await request.get(videoNode.data.videoSrc, {
    headers: { Range: "bytes=0-99" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-range"]).toMatch(/^bytes 0-99\//);

  const progress = page.getByRole("slider", { name: "视频进度" });
  await progress.fill("0.5");
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeCloseTo(0.5, 1);
  await page.getByRole("button", { name: "播放视频" }).click();
  await expect
    .poll(() =>
      preview.evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "暂停视频" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByTestId("video-node-toolbar")
    .getByRole("button", { name: "下载" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Video.mp4");
  const downloaded = await download.createReadStream();
  const sourceHash = createHash("sha256");
  for await (const chunk of createReadStream(videoFile)) sourceHash.update(chunk);
  const downloadHash = createHash("sha256");
  for await (const chunk of downloaded) downloadHash.update(chunk);
  expect(downloadHash.digest("hex")).toBe(sourceHash.digest("hex"));

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(preview).toHaveAttribute("src", videoNode.data.videoSrc);
  await expect(page.getByText("1.0s", { exact: true })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const noopBaseline = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as { revision: number };
  const noopCanvasPuts: string[] = [];
  const observeCanvasPut = (outgoing: { method(): string; url(): string }) => {
    if (
      outgoing.method() === "PUT" &&
      outgoing.url().includes(`/api/canvas/${canvasId}`)
    ) noopCanvasPuts.push(outgoing.url());
  };
  page.on("request", observeCanvasPut);
  const metadataEvents = await preview.evaluate((video) => {
    let observed = 0;
    const count = () => {
      observed += 1;
    };
    video.addEventListener("loadedmetadata", count);
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("loadedmetadata"));
    video.removeEventListener("loadedmetadata", count);
    return observed;
  });
  expect(metadataEvents).toBe(2);
  // Four debounce windows prove the value-equivalent event stayed quiet;
  // observing request start avoids confusing a slow response with no write.
  await page.waitForTimeout(2_000);
  page.off("request", observeCanvasPut);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  expect(noopCanvasPuts).toHaveLength(0);
  const noopSettled = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as { revision: number };
  expect(noopSettled.revision).toBe(noopBaseline.revision);

  const current = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    edges: unknown[];
    loadToken: string;
    nodes: Array<{ data: Record<string, unknown>; id: string }>;
    revision: number;
    viewport: Record<string, unknown>;
  };
  const legacyNodes = current.nodes.map((node) => {
    if (node.data.assetId !== videoNode.data.assetId) return node;
    const data = { ...node.data };
    delete data.mediaHeight;
    delete data.mediaWidth;
    return {
      ...node,
      data: {
        ...data,
        inputState: "invalid",
        inputStateReason: "视频参考视频分辨率尚未经过服务端校验，请重新上传",
        mediaMetadataSource: "server",
        videoHeight: 180,
        videoWidth: 320,
      },
    };
  });
  const createdProject = await request.post("/api/projects", { data: {} });
  expect(createdProject.status()).toBe(201);
  const projectId = ((await createdProject.json()) as { id: string }).id;
  projectIds.add(projectId);
  const projectBaseline = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as { loadToken: string; revision: number };
  const savedLegacy = await request.put(`/api/canvas/${projectId}`, {
    data: {
      edges: current.edges,
      nodes: legacyNodes,
      observedLoadToken: projectBaseline.loadToken,
      observedRevision: projectBaseline.revision,
      revision: projectBaseline.revision,
      viewport: current.viewport,
    },
  });
  expect(savedLegacy.ok(), await savedLegacy.text()).toBeTruthy();
  const savedLegacyDocument = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as { revision: number };

  let canvasWrites = 0;
  let metadataRequests = 0;
  page.on("request", (entry) => {
    const pathname = new URL(entry.url()).pathname;
    if (
      (entry.method() === "PUT" && pathname === `/api/canvas/${projectId}`) ||
      (entry.method() === "POST" &&
        pathname === `/api/canvases/${projectId}/commands`)
    ) canvasWrites += 1;
    if (
      entry.method() === "GET" &&
      pathname === `/api/media-metadata/video/${videoNode.data.assetId}`
    ) metadataRequests += 1;
  });
  await page.goto(`/canvas/${projectId}`);
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.waitForTimeout(750);
  expect(metadataRequests).toBe(0);
  const afterHydration = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as {
    nodes: Array<{ data: Record<string, unknown> }>;
    revision: number;
  };
  expect(afterHydration.revision).toBe(savedLegacyDocument.revision);
  expect(afterHydration.nodes.find((node) =>
    node.data.assetId === videoNode.data.assetId
  )?.data).toMatchObject({
    inputState: "ready",
    mediaHeight: videoNode.data.mediaHeight,
    mediaMetadataSource: "server",
    mediaWidth: videoNode.data.mediaWidth,
  });
  expect(canvasWrites).toBe(0);
  await expect(preview).toHaveAttribute("src", videoNode.data.videoSrc);
});
