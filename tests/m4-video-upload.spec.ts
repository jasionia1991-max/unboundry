import { expect, test, type APIRequestContext } from "./safe-test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const canvasId = "interaction.upload-media-sandbox-current";
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
test.afterEach(async ({ request }) => clearFixture(request));
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
  await expect(preview).toBeVisible();
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
        videoDuration: number;
        videoHeight: number;
        videoSrc: string;
        videoWidth: number;
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
    videoHeight: 180,
    videoWidth: 320,
  });
  expect(videoNode.data.mediaByteSize).toBeGreaterThan(0);
  expect(videoNode.data.mediaDurationSeconds).toBeCloseTo(1, 1);
  expect(videoNode.data.videoDuration).toBeCloseTo(1, 1);

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
});
