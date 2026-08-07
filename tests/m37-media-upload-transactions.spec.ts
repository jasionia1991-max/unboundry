import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const mediaDirectory = mkdtempSync(join(tmpdir(), "unboundry-upload-transaction-"));
const videoFile = join(mediaDirectory, "transaction.mp4");
const audioFile = join(mediaDirectory, "transaction.wav");
const imageFile = resolve(
  "spec/reference/unboundry-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
);

execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=blue:s=320x180:d=0.5",
  "-an",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  videoFile,
]);
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=0.5",
  "-c:a",
  "pcm_s16le",
  audioFile,
]);

type MediaKind = "audio" | "image" | "video";
type CreatedAsset = {
  assetId: string;
  byteSize: number;
  contentType: string;
  durationSeconds?: number;
  storageBackend: "local" | "oss";
  url: string;
};

const uploadConfig = {
  audio: {
    endpoint: "/api/audio-assets/",
    file: audioFile,
    inputTestId: "audio-upload-input",
  },
  image: {
    endpoint: "/api/assets/",
    file: imageFile,
    inputTestId: "image-upload-input",
  },
  video: {
    endpoint: "/api/video-assets/",
    file: videoFile,
    inputTestId: "video-upload-input",
  },
} as const;

function emptyNode(kind: MediaKind, index: number) {
  return {
    data: {
      label: kind[0].toUpperCase() + kind.slice(1),
      sourceKind: kind,
      title: `${kind} transaction`,
    },
    id: `${kind}-transaction`,
    position: { x: 80 + index * 360, y: 180 },
    style: { height: kind === "audio" ? 190 : 250, width: 280 },
    type: kind,
  };
}

function readyNode(kind: MediaKind, index: number, asset: CreatedAsset) {
  const sourceKey = `${kind}Src` as "audioSrc" | "imageSrc" | "videoSrc";
  return {
    ...emptyNode(kind, index),
    data: {
      ...emptyNode(kind, index).data,
      assetId: asset.assetId,
      inputState: "ready",
      mediaByteSize: asset.byteSize,
      mediaContentType: asset.contentType,
      mediaDurationSeconds: asset.durationSeconds,
      mediaMetadataSource: "server",
      mediaMetadataStatus: "ready",
      mediaStorageBackend: asset.storageBackend,
      [sourceKey]: asset.url,
      ...(kind === "audio"
        ? { audioDuration: asset.durationSeconds, audioFileName: "old.wav" }
        : {}),
      ...(kind === "video"
        ? { videoDuration: asset.durationSeconds, videoHeight: 180, videoWidth: 320 }
        : {}),
    },
  };
}

async function saveCanvas(
  request: APIRequestContext,
  canvasId: string,
  nodes: unknown[],
) {
  await request.delete(`/api/canvas/${canvasId}`);
  const response = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [],
      nodes,
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function persistedNodes(request: APIRequestContext, canvasId: string) {
  const response = await request.get(`/api/canvas/${canvasId}`);
  if (!response.ok()) return [];
  const document = await response.json() as {
    nodes: Array<{ data: Record<string, unknown>; id: string }>;
  };
  return document.nodes;
}

async function seedAsset(
  request: APIRequestContext,
  kind: MediaKind,
  assetId: string,
) {
  const file = uploadConfig[kind].file;
  const contentType = kind === "image"
    ? "image/png"
    : kind === "video"
      ? "video/mp4"
      : "audio/wav";
  const response = await request.post(`${uploadConfig[kind].endpoint}${assetId}`, {
    data: readFileSync(file),
    headers: {
      "Content-Type": contentType,
      "X-File-Name": encodeURIComponent(file.split("/").at(-1)!),
    },
  });
  expect(response.ok()).toBeTruthy();
  return await response.json() as CreatedAsset;
}

function monitorProviderRequests(page: Page) {
  const taskPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/generation-tasks(?:$|\?)/.test(request.url())
    ) taskPosts.push(request.url());
  });
  return taskPosts;
}

function responseGate(page: Page, pattern: string, count: number) {
  const createdResolvers: Array<(asset: CreatedAsset) => void> = [];
  const releaseResolvers: Array<() => void> = [];
  const created = Array.from({ length: count }, (_, index) =>
    new Promise<CreatedAsset>((resolveCreated) => {
      createdResolvers[index] = resolveCreated;
    }));
  const releases = Array.from({ length: count }, (_, index) =>
    new Promise<void>((resolveRelease) => {
      releaseResolvers[index] = resolveRelease;
    }));
  let uploadIndex = 0;
  void page.route(pattern, async (route) => {
    if (route.request().method() !== "POST" || uploadIndex >= count) {
      await route.continue();
      return;
    }
    const index = uploadIndex;
    uploadIndex += 1;
    const response = await route.fetch();
    const body = await response.body();
    createdResolvers[index](JSON.parse(body.toString()) as CreatedAsset);
    await releases[index];
    try {
      await route.fulfill({
        body,
        headers: response.headers(),
        status: response.status(),
      });
    } catch {
      // A superseding operation can abort the older browser request.
    }
  });
  return {
    created,
    release: (index: number) => releaseResolvers[index](),
    releaseAll: () => releaseResolvers.forEach((release) => release()),
  };
}

test.afterAll(() => rmSync(mediaDirectory, { force: true, recursive: true }));

test("ready Image, Video and Audio replacements keep the accepted asset when upload fails", async ({
  page,
  request,
}) => {
  const canvasId = "interaction.upload-media-sandbox-current";
  const kinds: MediaKind[] = ["image", "video", "audio"];
  const assets: CreatedAsset[] = [];
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts = monitorProviderRequests(page);

  try {
    for (const kind of kinds) {
      assets.push(await seedAsset(
        request,
        kind,
        kind === "image" ? `m37-old-${kind}` : `m37-old-${kind}.${kind === "video" ? "mp4" : "wav"}`,
      ));
    }
    await saveCanvas(
      request,
      canvasId,
      kinds.map((kind, index) => readyNode(kind, index, assets[index])),
    );
    for (const kind of kinds) {
      await page.route(`**${uploadConfig[kind].endpoint}*`, async (route) => {
        if (route.request().method() === "POST") {
          await route.fulfill({
            body: JSON.stringify({ error: `${kind} replacement rejected` }),
            contentType: "application/json",
            status: 503,
          });
          return;
        }
        await route.continue();
      });
    }

    await page.goto(`/__fixture/${canvasId}`);
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");

    for (const [index, kind] of kinds.entries()) {
      const node = page.locator(`.react-flow__node[data-id="${kind}-transaction"]`);
      await node.getByTestId(uploadConfig[kind].inputTestId)
        .setInputFiles(uploadConfig[kind].file);
      await expect(node.getByRole("alert"))
        .toContainText(`${kind} replacement rejected`);
      await expect(node.locator("[data-asset-id]")).toHaveAttribute(
        "data-asset-id",
        assets[index].assetId,
      );
    }
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    await expect.poll(async () => {
      const nodes = await persistedNodes(request, canvasId);
      return kinds.map((kind) => {
        const node = nodes.find(({ id }) => id === `${kind}-transaction`);
        return {
          assetId: node?.data.assetId,
          inputState: node?.data.inputState,
          reason: node?.data.inputStateReason ?? null,
        };
      });
    }).toEqual(kinds.map((_, index) => ({
      assetId: assets[index].assetId,
      inputState: "ready",
      reason: null,
    })));

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(taskPosts).toEqual([]);
  } finally {
    await request.delete(`/api/canvas/${canvasId}`);
    for (const [index, kind] of kinds.entries()) {
      if (assets[index]) {
        await request.delete(`${uploadConfig[kind].endpoint}${assets[index].assetId}`);
      }
    }
  }
});

test("undo or node removal invalidates held Image, Video and Audio responses and removes their assets", async ({
  page,
  request,
}) => {
  const canvasId = "interaction.upload-media-sandbox-current";
  const kinds: MediaKind[] = ["image", "video", "audio"];
  const gates = {
    audio: responseGate(page, "**/api/audio-assets/*", 1),
    image: responseGate(page, "**/api/assets/*", 1),
    video: responseGate(page, "**/api/video-assets/*", 1),
  };
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts = monitorProviderRequests(page);

  try {
    await saveCanvas(request, canvasId, kinds.map(emptyNode));
    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");

    const staleAssets: CreatedAsset[] = [];
    for (const kind of kinds) {
      const node = page.locator(`.react-flow__node[data-id="${kind}-transaction"]`);
      await node.getByTestId(uploadConfig[kind].inputTestId)
        .setInputFiles(uploadConfig[kind].file);
      const staleAsset = await gates[kind].created[0];
      staleAssets.push(staleAsset);
      if (kind === "video") {
        await node.click();
        await page.keyboard.press("Delete");
        await expect(world).toHaveAttribute("data-node-count", "2");
        await page.keyboard.press("Meta+z");
        await expect(world).toHaveAttribute("data-node-count", "3");
      } else {
        await page.keyboard.press("Meta+z");
      }
      gates[kind].release(0);
      await expect.poll(async () => (await request.get(
        `${uploadConfig[kind].endpoint}${staleAsset.assetId}`,
      )).status()).toBe(404);
    }

    await expect.poll(async () => (await persistedNodes(request, canvasId)).map((node) => ({
      assetId: node.data.assetId ?? null,
      id: node.id,
      source: node.data.audioSrc ?? node.data.imageSrc ?? node.data.videoSrc ?? null,
    }))).toEqual(kinds.map((kind) => ({
      assetId: null,
      id: `${kind}-transaction`,
      source: null,
    })));

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(taskPosts).toEqual([]);
  } finally {
    Object.values(gates).forEach((gate) => gate.releaseAll());
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

test("later Image, Video and Audio uploads win when older responses arrive last", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const canvasId = "interaction.upload-media-sandbox-current";
  const kinds: MediaKind[] = ["image", "video", "audio"];
  const gates = {
    audio: responseGate(page, "**/api/audio-assets/*", 2),
    image: responseGate(page, "**/api/assets/*", 2),
    video: responseGate(page, "**/api/video-assets/*", 2),
  };
  const adoptedAssets: Array<{ kind: MediaKind; assetId: string }> = [];

  try {
    await saveCanvas(request, canvasId, kinds.map(emptyNode));
    await page.goto(`/__fixture/${canvasId}`);
    await expect(page.getByTestId("canvas-world"))
      .toHaveAttribute("data-persistence-ready", "true");

    for (const kind of kinds) {
      const input = page.locator(`.react-flow__node[data-id="${kind}-transaction"]`)
        .getByTestId(uploadConfig[kind].inputTestId);
      await input.setInputFiles(uploadConfig[kind].file);
      const first = await gates[kind].created[0];
      await input.setInputFiles(uploadConfig[kind].file);
      const second = await gates[kind].created[1];
      gates[kind].release(1);

      await expect.poll(async () => (await persistedNodes(request, canvasId))
        .find(({ id }) => id === `${kind}-transaction`)?.data.assetId)
        .toBe(second.assetId);
      adoptedAssets.push({ kind, assetId: second.assetId });
      gates[kind].release(0);
      await expect.poll(async () => (await request.get(
        `${uploadConfig[kind].endpoint}${first.assetId}`,
      )).status()).toBe(404);
      expect((await request.get(
        `${uploadConfig[kind].endpoint}${second.assetId}`,
      )).ok()).toBeTruthy();
    }

    const nodes = await persistedNodes(request, canvasId);
    expect(nodes).toHaveLength(3);
    expect(new Set(nodes.map((node) => node.data.assetId)).size).toBe(3);
  } finally {
    Object.values(gates).forEach((gate) => gate.releaseAll());
    await request.delete(`/api/canvas/${canvasId}`);
    for (const asset of adoptedAssets) {
      await request.delete(`${uploadConfig[asset.kind].endpoint}${asset.assetId}`);
    }
  }
});
