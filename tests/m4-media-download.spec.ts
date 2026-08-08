import { expect, test, type Download } from "./safe-test";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

async function hashDownload(download: Download) {
  const stream = await download.createReadStream();
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

test("Video success downloads the complete playable MP4 fixture", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.video.success");
  await page.goto("/__fixture/node.video.success");

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByTestId("video-node-toolbar")
    .getByRole("button", { name: "下载" })
    .click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("Video.mp4");
  expect(await download.failure()).toBeNull();
  expect(await hashDownload(download)).toBe(
    await hashFile("client/public/fixtures/video-success.mp4"),
  );
});

test("Audio success downloads the complete playable MP3 fixture", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.audio.success");
  await page.goto("/__fixture/node.audio.success");

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByTestId("audio-node-toolbar")
    .getByRole("button", { name: "下载" })
    .click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("audio-result-1.mp3");
  expect(await download.failure()).toBeNull();
  expect(await hashDownload(download)).toBe(
    await hashFile("client/public/fixtures/audio-success.mp3"),
  );
});
