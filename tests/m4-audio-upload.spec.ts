import { expect, test, type APIRequestContext } from "./safe-test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const canvasId = "interaction.upload-media-sandbox-current";
const projectIds = new Set<string>();
const mediaDirectory = mkdtempSync(join(tmpdir(), "unboundry-audio-test-"));
const commonAudio = [
  { codec: "libmp3lame", extension: "mp3", mimeType: "audio/mpeg" },
  { codec: "aac", extension: "m4a", mimeType: "audio/mp4" },
  { codec: "libopus", extension: "ogg", mimeType: "audio/ogg" },
].map((format) => {
  const file = join(mediaDirectory, `probe.${format.extension}`);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:duration=1",
    "-c:a",
    format.codec,
    file,
  ]);
  return { ...format, file };
});

function wav(seconds = 1, sampleRate = 44_100) {
  const samples = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(
      Math.round(Math.sin((index / sampleRate) * Math.PI * 880) * 24_000),
      44 + index * 2,
    );
  }
  return buffer;
}

async function clearProjects(request: APIRequestContext) {
  for (const projectId of projectIds) {
    await request.delete(`/api/projects/${projectId}`);
  }
  projectIds.clear();
}

test.beforeEach(async ({ request }) => {
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
});

test.afterEach(async ({ request }) => {
  await clearProjects(request);
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
});

test.afterAll(() => rmSync(mediaDirectory, { force: true, recursive: true }));

test("audio size is rejected before arrayBuffer decoding or upload", async ({
  page,
}) => {
  let uploadPosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.startsWith("/api/audio-assets/")
    ) {
      uploadPosts += 1;
    }
  });
  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("audio-upload-input")).toBeAttached();
  await page.evaluate(() => {
    const state = window as typeof window & { __audioArrayBuffers?: number };
    state.__audioArrayBuffers = 0;
    File.prototype.arrayBuffer = async function () {
      state.__audioArrayBuffers = (state.__audioArrayBuffers ?? 0) + 1;
      return new ArrayBuffer(0);
    };
    const file = new File([new Uint8Array([1])], "oversized.wav", {
      type: "audio/wav",
    });
    Object.defineProperty(file, "size", { value: 50 * 1_024 * 1_024 + 1 });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="audio-upload-input"]',
    )!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByRole("alert")).toContainText("音频不能超过 50MiB");
  expect(await page.evaluate(() =>
    (window as typeof window & { __audioArrayBuffers?: number })
      .__audioArrayBuffers
  )).toBe(0);
  expect(uploadPosts).toBe(0);
});

test("WAV upload, playback controls and waveform survive a reload", async ({
  page,
  request,
}) => {
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "2");

  await page.getByTestId("audio-upload-input").setInputFiles({
    buffer: wav(),
    mimeType: "audio/wav",
    name: "一秒测试音频.wav",
  });
  const media = page.getByTestId("audio-node-media");
  await expect(media).toHaveCount(1);
  await expect(page.locator(".audio-waveform-bars span")).toHaveCount(64);
  await expect(page.getByText("00:00/00:01")).toBeVisible();

  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/${canvasId}`);
      if (!response.ok()) return "";
      const document = await response.json() as {
        nodes: Array<{ data: { assetId?: string; sourceKind?: string } }>;
      };
      return document.nodes.find(
        (node) => node.data.sourceKind === "audio",
      )?.data.assetId ?? "";
    })
    .not.toBe("");
  const document = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    nodes: Array<{
      data: {
        assetId: string;
        audioSrc: string;
        audioWaveform: number[];
        inputState: string;
        mediaByteSize: number;
        mediaContentType: string;
        mediaDurationSeconds: number;
        mediaMetadataSource: string;
        mediaMetadataStatus: string;
        mediaStorageBackend: string;
        sourceKind: string;
      };
    }>;
  };
  const audioNode = document.nodes.find(
    (node) => node.data.sourceKind === "audio",
  )!;
  expect(audioNode.data).toMatchObject({
    inputState: "ready",
    mediaContentType: "audio/wav",
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: "local",
  });
  expect(audioNode.data.mediaByteSize).toBeGreaterThan(0);
  expect(audioNode.data.mediaDurationSeconds).toBeCloseTo(1, 1);
  const asset = await request.get(audioNode.data.audioSrc);
  expect(asset.ok()).toBeTruthy();
  expect(asset.headers()["content-type"]).toBe("audio/wav");
  const metadata = await request.get(
    `/api/media-metadata/audio/${audioNode.data.assetId}`,
  );
  expect(metadata.ok()).toBeTruthy();
  await expect(metadata.json()).resolves.toMatchObject({
    byteSize: audioNode.data.mediaByteSize,
    contentType: "audio/wav",
    durationStatus: "ready",
    storageBackend: "local",
  });

  const playhead = page.locator(".audio-waveform-playhead");
  await page.getByRole("button", { name: "播放音频" }).click();
  await expect
    .poll(() =>
      playhead.evaluate((element) =>
        Number.parseFloat((element as HTMLElement).style.left),
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停音频" }).click();
  await page.getByRole("button", { name: "前进 10 秒" }).click();
  await expect(page.getByText("00:01/00:01")).toBeVisible();
  await page.getByRole("button", { name: "后退 10 秒" }).click();
  await expect(page.getByText("00:00/00:01")).toBeVisible();

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(media).toHaveAttribute("src", audioNode.data.audioSrc);
  await expect(page.locator(".audio-waveform-bars span")).toHaveCount(64);
  await expect(page.getByText("00:00/00:01")).toBeVisible();
});

test("legacy audio metadata is hydrated at the server read boundary without browser backfill", async ({
  page,
  request,
}) => {
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("audio-upload-input").setInputFiles({
    buffer: wav(),
    mimeType: "audio/wav",
    name: "legacy-audio.wav",
  });
  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/${canvasId}`);
    if (!response.ok()) return "";
    const document = await response.json() as {
      nodes: Array<{ data: { assetId?: string; sourceKind?: string } }>;
    };
    return document.nodes.find((node) => node.data.sourceKind === "audio")
      ?.data.assetId ?? "";
  }).not.toBe("");
  const current = await (
    await request.get(`/api/canvas/${canvasId}`)
  ).json() as {
    edges: unknown[];
    nodes: Array<{ data: Record<string, unknown>; id: string }>;
    viewport: Record<string, unknown>;
  };
  const audioNode = current.nodes.find((node) => node.data.sourceKind === "audio")!;
  const assetId = String(audioNode.data.assetId);
  const audioSrc = String(audioNode.data.audioSrc);
  const legacyNodes = current.nodes.map((node) => {
    if (node.data.assetId !== assetId) return node;
    const data = { ...node.data };
    delete data.mediaDurationSeconds;
    return {
      ...node,
      data: {
        ...data,
        inputState: "invalid",
        inputStateReason: "音频时长尚未经过服务端校验，请重新上传",
        mediaMetadataSource: "server",
      },
    };
  });
  const createdProject = await request.post("/api/projects", { data: {} });
  expect(createdProject.status()).toBe(201);
  const projectId = ((await createdProject.json()) as { id: string }).id;
  projectIds.add(projectId);
  const baseline = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as { loadToken: string; revision: number };
  const saved = await request.put(`/api/canvas/${projectId}`, {
    data: {
      edges: current.edges,
      nodes: legacyNodes,
      observedLoadToken: baseline.loadToken,
      observedRevision: baseline.revision,
      revision: baseline.revision,
      viewport: current.viewport,
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();

  const savedLegacy = await (
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
      pathname === `/api/media-metadata/audio/${assetId}`
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
  expect(afterHydration.revision).toBe(savedLegacy.revision);
  expect(afterHydration.nodes.find((node) => node.data.assetId === assetId)?.data)
    .toMatchObject({
      inputState: "ready",
      mediaDurationSeconds: audioNode.data.mediaDurationSeconds,
      mediaMetadataSource: "server",
    });
  expect(canvasWrites).toBe(0);
  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(page.getByTestId("audio-node-media")).toHaveAttribute(
    "src",
    audioSrc,
  );
  await page.waitForTimeout(750);
  expect(metadataRequests).toBe(0);
  const afterReload = await (
    await request.get(`/api/canvas/${projectId}`)
  ).json() as { revision: number };
  expect(afterReload.revision).toBe(savedLegacy.revision);
  expect(canvasWrites).toBe(0);
});

for (const audio of commonAudio) {
  test(`${audio.extension.toUpperCase()} upload survives a reload`, async ({
    page,
    request,
  }) => {
    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.getByTestId("audio-upload-input").setInputFiles(audio.file);
    await expect(page.getByTestId("audio-node-media")).toHaveCount(1);
    await expect(page.locator(".audio-waveform-bars span")).toHaveCount(64);

    await expect
      .poll(async () => {
        const response = await request.get(`/api/canvas/${canvasId}`);
        if (!response.ok()) return "";
        const document = await response.json() as {
          nodes: Array<{
            data: { audioSrc?: string; sourceKind?: string };
          }>;
        };
        return document.nodes.find(
          (node) => node.data.sourceKind === "audio",
        )?.data.audioSrc ?? "";
      })
      .toContain(`.${audio.extension}`);
    const document = await (
      await request.get(`/api/canvas/${canvasId}`)
    ).json() as {
      nodes: Array<{ data: { audioSrc: string; sourceKind: string } }>;
    };
    const audioNode = document.nodes.find(
      (node) => node.data.sourceKind === "audio",
    )!;
    const asset = await request.get(audioNode.data.audioSrc);
    expect(asset.headers()["content-type"]).toBe(audio.mimeType);

    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(page.getByTestId("audio-node-media")).toHaveAttribute(
      "src",
      audioNode.data.audioSrc,
    );
    await expect(page.locator(".audio-waveform-bars span")).toHaveCount(64);
  });
}
