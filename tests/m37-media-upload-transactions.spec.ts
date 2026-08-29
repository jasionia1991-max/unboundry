import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./safe-test";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  rollbackCanvasNodeAdoption,
  tryCommitCanvasNodeAdoption,
} from "../client/src/canvas/CanvasGraphMutationContext";
import type { ProbeNodeType } from "../client/src/canvas/ProbeNode";
import {
  createCanvasGraphCommandPort,
  type CanvasGraphSnapshot,
} from "../client/src/canvas/canvasPorts";
import { createDerivedImageToolUseCase } from "../client/src/imageTools/derivedImageToolUseCase";

const mediaDirectory = mkdtempSync(join(tmpdir(), "unboundry-upload-transaction-"));
const videoFile = join(mediaDirectory, "transaction.mp4");
const audioFile = join(mediaDirectory, "transaction.wav");
const imageFile = resolve(
  "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
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

const clientUploadBranches = [
  { id: "image", kind: "image", label: "Image upload" },
  { id: "playlist", kind: "video", label: "Playlist export" },
  { id: "video", kind: "video", label: "Video upload" },
  { id: "audio", kind: "audio", label: "Audio upload" },
] as const;

type ClientUploadBranch = (typeof clientUploadBranches)[number];

test("Image, Video and Audio upload start states require durable Canvas admission", () => {
  for (const kind of ["Image", "Video", "Audio"] as const) {
    const source = readFileSync(
      resolve(process.cwd(), `client/src/canvas/${kind}Node.tsx`),
      "utf8",
    );
    const loadStart = source.indexOf("const loadFile = async");
    const loadEnd = source.indexOf(
      kind === "Image" ? "const applyDerivedImage = async" : "const togglePlayback = async",
      loadStart,
    );
    const loadFile = source.slice(loadStart, loadEnd);
    expect(loadStart, kind).toBeGreaterThan(-1);
    expect(loadEnd, kind).toBeGreaterThan(loadStart);
    expect(loadFile, kind).toContain("semanticEditBlocked ||");
    expect(loadFile, kind).toContain("uploadInFlight.current");
    expect(loadFile, kind).toContain("const prepared = await tryAdoptNodes(id");
    expect(loadFile, kind).toContain("if (!prepared)");
    expect(source, kind).toContain("disabled={uploadControlBlocked}");
    expect(source, kind).toContain("replaceDisabled={uploadControlBlocked}");
  }
});

function branchPostPattern(branch: ClientUploadBranch) {
  return branch.id === "playlist"
    ? "**/api/playlist/export"
    : `**${uploadConfig[branch.kind].endpoint}*`;
}

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

function monitorAssetDeletes(page: Page) {
  const deletedPaths: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") {
      deletedPaths.push(new URL(request.url()).pathname);
    }
  });
  return deletedPaths;
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

function committedResponseFailure(
  page: Page,
  pattern: string,
  browserOutcome: "bad-gateway" | "lost",
) {
  let resolveCreated!: (asset: CreatedAsset) => void;
  const created = new Promise<CreatedAsset>((resolve) => {
    resolveCreated = resolve;
  });
  let intercepted = false;
  void page.route(pattern, async (route) => {
    if (route.request().method() !== "POST" || intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const response = await route.fetch();
    const body = await response.body();
    resolveCreated(JSON.parse(body.toString()) as CreatedAsset);
    // The origin has already committed and returned the ready asset. Lose or
    // replace only the browser-facing response so compensation must use the
    // request id even when an intermediary reports an explicit 5xx.
    if (browserOutcome === "lost") {
      await route.abort("failed");
    } else {
      await route.fulfill({
        body: JSON.stringify({
          code: "UPSTREAM_WRAPPER_FAILED",
          error: "The intermediary lost the committed origin response",
        }),
        contentType: "application/json",
        status: 502,
      });
    }
  });
  return created;
}

function mediaIdCollision(
  page: Page,
  request: APIRequestContext,
  branch: ClientUploadBranch,
  bodyFailure?: "empty" | "malformed",
) {
  const kind = branch.kind;
  let resolveOriginal!: (asset: CreatedAsset) => void;
  const original = new Promise<CreatedAsset>((resolve) => {
    resolveOriginal = resolve;
  });
  let resolveDelivered!: () => void;
  const delivered = new Promise<void>((resolve) => {
    resolveDelivered = resolve;
  });
  let intercepted = false;
  void page.route(branchPostPattern(branch), async (route) => {
    if (route.request().method() !== "POST" || intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const assetId = branch.id === "playlist"
      ? String((route.request().postDataJSON() as { assetId?: unknown }).assetId ?? "")
      : decodeURIComponent(
          new URL(route.request().url()).pathname.split("/").at(-1)!,
        );
    resolveOriginal(await seedAsset(request, kind, assetId));
    const response = await route.fetch();
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "MEDIA_ID_UNAVAILABLE",
    });
    if (bodyFailure) {
      await route.fulfill({
        body: bodyFailure === "empty" ? "" : "{",
        contentType: "application/json",
        status: 409,
      });
    } else {
      await route.fulfill({ response });
    }
    resolveDelivered();
  });
  return { delivered, original };
}

function mismatchedCommittedResponse(
  page: Page,
  branch: ClientUploadBranch,
  replacement: CreatedAsset,
) {
  let resolveRequested!: (asset: CreatedAsset) => void;
  const requested = new Promise<CreatedAsset>((resolve) => {
    resolveRequested = resolve;
  });
  let intercepted = false;
  void page.route(branchPostPattern(branch), async (route) => {
    if (route.request().method() !== "POST" || intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const response = await route.fetch();
    const asset = await response.json() as CreatedAsset;
    expect(response.status()).toBe(201);
    resolveRequested(asset);
    await route.fulfill({
      body: JSON.stringify({
        ...asset,
        assetId: replacement.assetId,
        url: replacement.url,
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  return requested;
}

function branchCanvasId(branch: ClientUploadBranch, _scenario: string) {
  return branch.id === "playlist"
    ? "node.playlist.clips-ready"
    : `node.${branch.kind}.empty`;
}

async function openClientUploadBranch(
  page: Page,
  request: APIRequestContext,
  branch: ClientUploadBranch,
  canvasId: string,
) {
  if (branch.id === "playlist") {
    await request.delete(`/api/canvas/${canvasId}`);
  } else {
    await saveCanvas(request, canvasId, [emptyNode(branch.kind, 0)]);
  }
  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world"))
    .toHaveAttribute("data-persistence-ready", "true");
}

async function triggerClientUploadBranch(
  page: Page,
  branch: ClientUploadBranch,
) {
  if (branch.id === "playlist") {
    const playlist = page.locator(
      '.react-flow__node-playlist[data-id="playlist-primary"]',
    );
    await playlist.click();
    await page.getByRole("button", { name: "导出播放列表" }).click();
    await page.getByTestId("playlist-export-menu")
      .getByRole("menuitem", { name: /导出到画布/ })
      .click();
    return;
  }

  await page.locator(
    `.react-flow__node[data-id="${branch.kind}-transaction"]`,
  ).getByTestId(uploadConfig[branch.kind].inputTestId)
    .setInputFiles(uploadConfig[branch.kind].file);
}

async function expectClientUploadNotAdopted(
  page: Page,
  request: APIRequestContext,
  branch: ClientUploadBranch,
  canvasId: string,
  assetIds: string[],
) {
  if (branch.id === "playlist") {
    await expect(page.locator('.react-flow__node-video[data-id^="video-from-"]'))
      .toHaveCount(0);
    await expect.poll(async () =>
      (await persistedNodes(request, canvasId)).some((node) =>
        node.id.startsWith("video-from-") ||
        assetIds.includes(String(node.data.assetId ?? ""))
      )).toBeFalsy();
    return;
  }

  const node = page.locator(
    `.react-flow__node[data-id="${branch.kind}-transaction"]`,
  );
  for (const assetId of assetIds) {
    await expect.poll(async () =>
      node.locator("[data-asset-id]").evaluateAll(
        (elements, expectedAssetId) => elements.some((element) =>
          element.getAttribute("data-asset-id") === expectedAssetId
        ),
        assetId,
      )).toBeFalsy();
  }
  await expect.poll(async () =>
    (await persistedNodes(request, canvasId)).some((candidate) =>
      assetIds.includes(String(candidate.data.assetId ?? ""))
    )).toBeFalsy();
}

async function expectClientUploadFailureSettled(
  page: Page,
  branch: ClientUploadBranch,
) {
  const feedback = branch.id === "playlist"
    ? page.locator('.playlist-export-state[role="status"]')
    : page.locator(
        `.react-flow__node[data-id="${branch.kind}-transaction"]`,
      ).getByRole("alert");
  await expect(feedback).toBeVisible();
  await expect(feedback).not.toHaveText("");
}

function persistenceLossGate(page: Page, canvasId: string, skipPuts = 0) {
  let resolveCreated!: () => void;
  let resolveRelease!: () => void;
  const created = new Promise<void>((resolve) => {
    resolveCreated = resolve;
  });
  const release = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  let rejectExternalBaseline = false;
  let intercepted = false;
  void page.route(`**/api/canvas/${canvasId}`, async (route) => {
    if (route.request().method() === "GET" && rejectExternalBaseline) {
      rejectExternalBaseline = false;
      await route.fulfill({
        body: JSON.stringify({ error: "External baseline unavailable" }),
        contentType: "application/json",
        status: 500,
      });
      return;
    }
    if (route.request().method() !== "PUT" || intercepted) {
      await route.continue();
      return;
    }
    if (skipPuts > 0) {
      skipPuts -= 1;
      await route.continue();
      return;
    }
    intercepted = true;
    const payload = route.request().postDataJSON() as {
      observedRevision?: number;
      saveAttemptId: string;
      saveSequence: number;
      saveSessionId: string;
    };
    resolveCreated();
    await release;
    const currentRevision = Math.max(0, Number(payload.observedRevision ?? 0)) + 1;
    const sessionHighWaterSequence = Number(payload.saveSequence) + 1;
    rejectExternalBaseline = true;
    await route.fulfill({
      body: JSON.stringify({
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: currentRevision,
        currentRevision,
        currentWriterSequence: sessionHighWaterSequence,
        currentWriterSessionId: "m37-foreign-writer",
        error: "A foreign revision invalidated the upload adoption scope",
        rejectedAttemptId: payload.saveAttemptId,
        rejectedSequence: payload.saveSequence,
        rejectedSessionId: payload.saveSessionId,
        sessionHighWaterAttemptId:
          "77777777-7777-4777-8777-777777777777",
        sessionHighWaterSequence,
      }),
      contentType: "application/json",
      status: 409,
    });
  });
  return {
    created,
    release: () => resolveRelease(),
  };
}

async function paidProviderRequests(request: APIRequestContext) {
  const status = await (
    await request.get("/api/generation-tasks/status")
  ).json() as { paidProviderRequests: number };
  return status.paidProviderRequests;
}

test.afterAll(() => rmSync(mediaDirectory, { force: true, recursive: true }));

test("atomic media adoption rejects a persistence ref closed in the same tick", () => {
  const current = [emptyNode("image", 0)] as unknown as ProbeNodeType[];
  let committed: ProbeNodeType[] | undefined;
  let persistenceReady = true;
  const staleChildReady = true;
  let updateCalled = false;
  const adopted = tryCommitCanvasNodeAdoption({
    commit: (nodes) => {
      committed = nodes;
    },
    currentNodes: () => current,
    persistenceReady: () => persistenceReady,
    targetNodeId: current[0]!.id,
    update: (nodes) => {
      updateCalled = true;
      persistenceReady = false;
      return nodes.map((node) => ({ ...node, selected: true }));
    },
  });

  expect(staleChildReady).toBe(true);
  expect(adopted).toBe(false);
  expect(updateCalled).toBe(true);
  expect(committed).toBeUndefined();
});

test("atomic media adoption rejects a target removed before commit", () => {
  const current = [emptyNode("image", 0)] as unknown as ProbeNodeType[];
  let committed: ProbeNodeType[] | undefined;
  const adopted = tryCommitCanvasNodeAdoption({
    commit: (nodes) => {
      committed = nodes;
    },
    currentNodes: () => [],
    persistenceReady: () => true,
    targetNodeId: current[0]!.id,
    update: (nodes) => nodes,
  });

  expect(adopted).toBe(false);
  expect(committed).toBeUndefined();
});

test("failed media adoption rolls back only unchanged fields and preserves concurrent geometry", () => {
  const before = {
    ...emptyNode("image", 0),
    data: {
      ...emptyNode("image", 0).data,
      assetId: "accepted-image",
      imageSrc: "/api/assets/accepted-image",
      inputState: "ready",
    },
    height: 250,
    selected: false,
    style: { height: 250, width: 280 },
    width: 280,
  } as unknown as ProbeNodeType;
  const committed = {
    ...before,
    data: {
      ...before.data,
      imageGenerationError: undefined,
      inputState: "uploading",
      inputStateReason: "图片正在上传",
    },
    height: undefined,
    measured: undefined,
    style: { height: 320, width: 320 },
    width: undefined,
  } as ProbeNodeType;
  const concurrent = {
    ...committed,
    measured: { height: 333, width: 444 },
    position: { x: 901, y: 902 },
    selected: true,
    style: { ...committed.style, width: 444 },
  } as ProbeNodeType;
  const rolledBack = rollbackCanvasNodeAdoption({
    beforeById: new Map([[before.id, before]]),
    committedById: new Map([[committed.id, committed]]),
    current: [concurrent],
  })[0]!;

  expect(rolledBack.data).toMatchObject({
    assetId: "accepted-image",
    imageSrc: "/api/assets/accepted-image",
    inputState: "ready",
  });
  expect(rolledBack.data.inputStateReason).toBeUndefined();
  expect(rolledBack).toMatchObject({
    height: 250,
    measured: { height: 333, width: 444 },
    position: { x: 901, y: 902 },
    selected: true,
    style: { height: 250, width: 444 },
    width: 280,
  });
});

test("Image, Video and Audio upload start save failure leaves no uploading state", async ({
  page,
  request,
}) => {
  const canvasId = "interaction.upload-media-sandbox-current";
  const kinds: MediaKind[] = ["image", "video", "audio"];
  const uploadPosts: string[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      kinds.some((kind) => entry.url().includes(uploadConfig[kind].endpoint))
    ) uploadPosts.push(entry.url());
  });

  try {
    for (const [index, kind] of kinds.entries()) {
      await saveCanvas(request, canvasId, [emptyNode(kind, index)]);
      await page.goto(`/__fixture/${canvasId}`);
      const world = page.getByTestId("canvas-world");
      await expect(world).toHaveAttribute("data-persistence-ready", "true");
      const gate = persistenceLossGate(page, canvasId);
      const node = page.locator(
        `.react-flow__node[data-id="${kind}-transaction"]`,
      );
      const selection = node.getByTestId(uploadConfig[kind].inputTestId)
        .setInputFiles(uploadConfig[kind].file);
      await gate.created;
      await expect(node.getByLabel(`${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}上传中`))
        .toBeVisible();
      gate.release();
      await selection;
      await expect(node.getByLabel(`${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}上传中`))
        .toHaveCount(0);
      await expect.poll(async () =>
        (await persistedNodes(request, canvasId))[0]?.data.inputState ?? null
      ).toBeNull();
      await page.unroute(`**/api/canvas/${canvasId}`);
      await page.reload();
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await expect(page.locator(
        `.react-flow__node[data-id="${kind}-transaction"]`,
      ).getByTestId(uploadConfig[kind].inputTestId)).toBeEnabled();
    }
    expect(uploadPosts).toEqual([]);
  } finally {
    await page.unroute(`**/api/canvas/${canvasId}`);
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

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
      const input = node.getByTestId(uploadConfig[kind].inputTestId);
      await expect(input).toBeEnabled();
      await input.setInputFiles(uploadConfig[kind].file);
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

    await expect.poll(async () => (await persistedNodes(request, canvasId))
      .map((node) => ({
        assetId: node.data.assetId ?? null,
        id: node.id.replace(/-restored-\d+$/, ""),
        source: node.data.audioSrc ?? node.data.imageSrc ?? node.data.videoSrc ?? null,
      }))
      .sort((left, right) => kinds.indexOf(
        left.id.replace("-transaction", "") as MediaKind,
      ) - kinds.indexOf(
        right.id.replace("-transaction", "") as MediaKind,
      ))).toEqual(kinds.map((kind) => ({
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

test("Image, Video and Audio serialize replacements behind the active upload", async ({
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
      await expect(input).toBeDisabled();
      gates[kind].release(0);
      await expect.poll(async () => (await persistedNodes(request, canvasId))
        .find(({ id }) => id === `${kind}-transaction`)?.data.assetId)
        .toBe(first.assetId);
      await expect(input).toBeEnabled();
      adoptedAssets.push({ kind, assetId: first.assetId });

      await input.setInputFiles(uploadConfig[kind].file);
      const second = await gates[kind].created[1];
      await expect(input).toBeDisabled();
      gates[kind].release(1);

      await expect.poll(async () => (await persistedNodes(request, canvasId))
        .find(({ id }) => id === `${kind}-transaction`)?.data.assetId)
        .toBe(second.assetId);
      adoptedAssets.push({ kind, assetId: second.assetId });
      await expect(input).toBeEnabled();
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

for (const kind of ["image", "video", "audio"] as const) {
  test(`${kind} upload deletes its fresh asset when persistence becomes unavailable before adoption`, async ({
    page,
    request,
  }) => {
    const canvasId = "interaction.upload-media-sandbox-current";
    const uploadGate = responseGate(
      page,
      `**${uploadConfig[kind].endpoint}*`,
      1,
    );
    const persistenceGate = persistenceLossGate(page, canvasId, 1);
    const before = await paidProviderRequests(request);
    const taskPosts = monitorProviderRequests(page);
    const deletedPaths = monitorAssetDeletes(page);

    try {
      await saveCanvas(request, canvasId, [emptyNode(kind, 0)]);
      await page.goto(`/__fixture/${canvasId}`);
      const world = page.getByTestId("canvas-world");
      await expect(world).toHaveAttribute("data-persistence-ready", "true");
      const node = page.locator(
        `.react-flow__node[data-id="${kind}-transaction"]`,
      );

      await node.getByTestId(uploadConfig[kind].inputTestId)
        .setInputFiles(uploadConfig[kind].file);
      const asset = await uploadGate.created[0];
      uploadGate.release(0);
      await persistenceGate.created;
      persistenceGate.release();
      await expect(world).toHaveAttribute("data-persistence-ready", "false");

      await expect.poll(async () => (
        await request.get(`${uploadConfig[kind].endpoint}${asset.assetId}`)
      ).status()).toBe(404);
      expect(deletedPaths).toContain(
        `${uploadConfig[kind].endpoint}${encodeURIComponent(asset.assetId)}`,
      );
      await expect.poll(async () =>
        node.locator("[data-asset-id]").evaluateAll(
          (elements, expectedAssetId) => elements.some((element) =>
            element.getAttribute("data-asset-id") === expectedAssetId
          ),
          asset.assetId,
        )).toBeFalsy();
      expect((await persistedNodes(request, canvasId))[0]?.data.assetId)
        .toBeUndefined();
      expect(await paidProviderRequests(request)).toBe(before);
      expect(taskPosts).toEqual([]);
    } finally {
      persistenceGate.release();
      uploadGate.releaseAll();
      await request.delete(`/api/canvas/${canvasId}`);
    }
  });
}

test("Image crop deletes a completed derived upload when persistence closes before graph adoption", async ({
  request,
}) => {
  const sourceAsset = await seedAsset(request, "image", "m37-crop-source");
  const derivedAssetId = crypto.randomUUID();
  const before = await paidProviderRequests(request);
  const sourceNode = readyNode("image", 0, sourceAsset) as ProbeNodeType;
  let persistenceReady = true;
  let graphSnapshot: CanvasGraphSnapshot = {
    edges: [],
    nodes: [sourceNode],
    revision: 0,
  };
  const graph = createCanvasGraphCommandPort({
    commit(next) {
      graphSnapshot = {
        edges: [...next.edges],
        nodes: [...next.nodes],
        revision: next.revision,
      };
    },
    persistenceReady: () => persistenceReady,
    snapshot: () => graphSnapshot,
  });
  const deletedAssetIds: string[] = [];

  try {
    const file = new File([readFileSync(imageFile)], "m37-crop-derived.png", {
      type: "image/png",
    });
    await expect(createDerivedImageToolUseCase({
      graph,
      media: {
        async discard(assetId) {
          deletedAssetIds.push(assetId);
          const response = await request.delete(
            `/api/assets/${encodeURIComponent(assetId)}`,
          );
          expect(response.ok()).toBeTruthy();
        },
        async metadata(assetId) {
          return { assetId };
        },
        async upload(uploadFile) {
          const response = await request.post(`/api/assets/${derivedAssetId}`, {
            data: Buffer.from(await uploadFile.arrayBuffer()),
            headers: {
              "Content-Type": uploadFile.type,
              "X-File-Name": encodeURIComponent(uploadFile.name),
            },
          });
          expect(response.ok()).toBeTruthy();
          const asset = await response.json() as CreatedAsset & {
            fileName: string;
            height: number;
            width: number;
          };
          persistenceReady = false;
          return asset;
        },
      },
      operation: "crop",
      size: (width, height) => ({ height, width }),
    }).execute({
      expectedRevision: 0,
      file,
      operationId: crypto.randomUUID(),
      ownershipKey: "m37-crop-persistence-fence",
      runId: "m37-crop-persistence-fence",
      sourceAssetId: sourceAsset.assetId,
      sourceNodeId: sourceNode.id,
      title: "crop persistence fence",
    })).rejects.toThrow("画布尚未完成安全加载");

    expect(deletedAssetIds).toEqual([derivedAssetId]);
    expect((await request.get(`/api/assets/${derivedAssetId}`)).status())
      .toBe(404);
    expect(graphSnapshot.nodes).toHaveLength(1);
    expect(graphSnapshot.nodes.some((node) =>
      node.data.assetId === derivedAssetId
    )).toBeFalsy();
    expect(await paidProviderRequests(request)).toBe(before);
  } finally {
    await request.delete(`/api/assets/${derivedAssetId}`);
    await request.delete(`/api/assets/${sourceAsset.assetId}`);
  }
});

test("canvas create-menu upload deletes a completed asset when persistence closes before node adoption", async ({
  page,
  request,
}) => {
  const canvasId = "interaction.upload-image";
  const uploadGate = responseGate(page, "**/api/assets/*", 1);
  const persistenceGate = persistenceLossGate(page, canvasId);
  const before = await paidProviderRequests(request);
  const taskPosts = monitorProviderRequests(page);
  const deletedPaths = monitorAssetDeletes(page);

  try {
    await saveCanvas(request, canvasId, []);
    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");

    await world.dblclick({ position: { x: 300, y: 260 } });
    await page.getByTestId("add-node-menu")
      .getByRole("menuitem", { name: "文本", exact: true })
      .click();
    await persistenceGate.created;
    await world.dblclick({ position: { x: 760, y: 300 } });
    await page.getByTestId("canvas-image-upload-input").setInputFiles(imageFile);
    const asset = await uploadGate.created[0];

    persistenceGate.release();
    await expect(world).toHaveAttribute("data-persistence-ready", "false");
    uploadGate.release(0);

    await expect.poll(async () => (
      await request.get(`/api/assets/${asset.assetId}`)
    ).status()).toBe(404);
    expect(deletedPaths).toContain(
      `/api/assets/${encodeURIComponent(asset.assetId)}`,
    );
    await expect(page.locator(".react-flow__node-image")).toHaveCount(0);
    expect((await persistedNodes(request, canvasId)).some((node) =>
      node.data.assetId === asset.assetId
    )).toBeFalsy();
    expect(await paidProviderRequests(request)).toBe(before);
    expect(taskPosts).toEqual([]);
  } finally {
    persistenceGate.release();
    uploadGate.releaseAll();
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

test("Playlist export deletes its completed video when persistence closes before canvas adoption", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const canvasId = "node.playlist.clips-ready";
  const before = await paidProviderRequests(request);
  const taskPosts = monitorProviderRequests(page);
  const deletedPaths = monitorAssetDeletes(page);

  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  const uploadGate = responseGate(page, "**/api/playlist/export", 1);
  const persistenceGate = persistenceLossGate(page, canvasId);

  try {
    const playlist = page.locator(
      '.react-flow__node-playlist[data-id="playlist-primary"]',
    );
    await playlist.click();
    await page.getByRole("button", { name: "导出播放列表" }).click();
    await page.getByTestId("playlist-export-menu")
      .getByRole("menuitem", { name: /导出到画布/ })
      .click();
    const asset = await uploadGate.created[0];

    const title = playlist.getByTestId("playlist-node-title-input");
    await title.fill("playlist persistence fence");
    await title.evaluate((input: HTMLInputElement) => input.blur());
    await persistenceGate.created;
    persistenceGate.release();
    await expect(world).toHaveAttribute("data-persistence-ready", "false");
    uploadGate.release(0);

    await expect.poll(async () => (
      await request.get(`/api/video-assets/${asset.assetId}`)
    ).status()).toBe(404);
    expect(deletedPaths).toContain(
      `/api/video-assets/${encodeURIComponent(asset.assetId)}`,
    );
    await expect(page.locator('.react-flow__node-video[data-id^="video-from-"]'))
      .toHaveCount(0);
    expect((await persistedNodes(request, canvasId)).some((node) =>
      node.id.startsWith("video-from-") || node.data.assetId === asset.assetId
    )).toBeFalsy();
    expect(await paidProviderRequests(request)).toBe(before);
    expect(taskPosts).toEqual([]);
  } finally {
    persistenceGate.release();
    uploadGate.releaseAll();
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

for (const branch of clientUploadBranches) {
  for (const browserOutcome of ["lost", "bad-gateway"] as const) {
    test(`${branch.label} compensates its ready asset when the committed response is ${browserOutcome}`, async ({
      page,
      request,
    }) => {
      if (branch.id === "playlist") test.setTimeout(60_000);
      const canvasId = branchCanvasId(
        branch,
        `committed-${browserOutcome}`,
      );
      const created = committedResponseFailure(
        page,
        branchPostPattern(branch),
        browserOutcome,
      );
      const deletedPaths = monitorAssetDeletes(page);
      const before = await paidProviderRequests(request);
      const taskPosts = monitorProviderRequests(page);

      try {
        await openClientUploadBranch(page, request, branch, canvasId);
        await triggerClientUploadBranch(page, branch);
        const asset = await created;
        const assetPath =
          `${uploadConfig[branch.kind].endpoint}${encodeURIComponent(asset.assetId)}`;

        await expect.poll(async () => (
          await request.get(assetPath)
        ).status()).toBe(404);
        expect(deletedPaths).toEqual([assetPath]);
        await expectClientUploadNotAdopted(
          page,
          request,
          branch,
          canvasId,
          [asset.assetId],
        );
        expect(await paidProviderRequests(request)).toBe(before);
        expect(taskPosts).toEqual([]);
      } finally {
        await request.delete(`/api/canvas/${canvasId}`);
      }
    });
  }
}

for (const branch of clientUploadBranches) {
  test(`${branch.label} preserves the existing asset on an explicit media id collision`, async ({
    page,
    request,
  }) => {
    if (branch.id === "playlist") test.setTimeout(60_000);
    const canvasId = branchCanvasId(branch, "media-id-collision");
    const deletedPaths = monitorAssetDeletes(page);
    const before = await paidProviderRequests(request);
    const taskPosts = monitorProviderRequests(page);
    const collision = mediaIdCollision(page, request, branch);
    let originalAsset: CreatedAsset | undefined;

    try {
      await openClientUploadBranch(page, request, branch, canvasId);
      await triggerClientUploadBranch(page, branch);
      originalAsset = await collision.original;
      await collision.delivered;
      await expectClientUploadFailureSettled(page, branch);
      const originalPath =
        `${uploadConfig[branch.kind].endpoint}${encodeURIComponent(originalAsset.assetId)}`;

      expect((await request.get(originalPath)).status()).toBe(200);
      expect(deletedPaths).toEqual([]);
      await expectClientUploadNotAdopted(
        page,
        request,
        branch,
        canvasId,
        [originalAsset.assetId],
      );
      expect(await paidProviderRequests(request)).toBe(before);
      expect(taskPosts).toEqual([]);
    } finally {
      await request.delete(`/api/canvas/${canvasId}`);
      if (originalAsset) {
        await request.delete(
          `${uploadConfig[branch.kind].endpoint}${originalAsset.assetId}`,
        );
      }
    }
  });
}

for (const branch of clientUploadBranches) {
  for (const bodyFailure of ["empty", "malformed"] as const) {
    test(`${branch.label} preserves a collided asset when the 409 body is ${bodyFailure}`, async ({
      page,
      request,
    }) => {
      if (branch.id === "playlist") test.setTimeout(60_000);
      const canvasId = branchCanvasId(
        branch,
        `media-id-collision-${bodyFailure}`,
      );
      const deletedPaths = monitorAssetDeletes(page);
      const before = await paidProviderRequests(request);
      const taskPosts = monitorProviderRequests(page);
      const collision = mediaIdCollision(
        page,
        request,
        branch,
        bodyFailure,
      );
      let originalAsset: CreatedAsset | undefined;

      try {
        await openClientUploadBranch(page, request, branch, canvasId);
        await triggerClientUploadBranch(page, branch);
        originalAsset = await collision.original;
        await collision.delivered;
        await expectClientUploadFailureSettled(page, branch);
        const originalPath =
          `${uploadConfig[branch.kind].endpoint}${encodeURIComponent(originalAsset.assetId)}`;

        expect((await request.get(originalPath)).status()).toBe(200);
        expect(deletedPaths).toEqual([]);
        await expectClientUploadNotAdopted(
          page,
          request,
          branch,
          canvasId,
          [originalAsset.assetId],
        );
        expect(await paidProviderRequests(request)).toBe(before);
        expect(taskPosts).toEqual([]);
      } finally {
        await request.delete(`/api/canvas/${canvasId}`);
        if (originalAsset) {
          await request.delete(
            `${uploadConfig[branch.kind].endpoint}${originalAsset.assetId}`,
          );
        }
      }
    });
  }
}

for (const branch of clientUploadBranches) {
  test(`${branch.label} rejects a mismatched successful asset response`, async ({
    page,
    request,
  }) => {
    if (branch.id === "playlist") test.setTimeout(60_000);
    const canvasId = branchCanvasId(branch, "mismatched-success");
    const replacementId = branch.kind === "image"
      ? `m37-${branch.id}-mismatch-existing`
      : `m37-${branch.id}-mismatch-existing.${
        branch.kind === "video" ? "mp4" : "wav"
      }`;
    const replacement = await seedAsset(
      request,
      branch.kind,
      replacementId,
    );
    const requested = mismatchedCommittedResponse(
      page,
      branch,
      replacement,
    );
    const deletedPaths = monitorAssetDeletes(page);
    const before = await paidProviderRequests(request);
    const taskPosts = monitorProviderRequests(page);
    let requestedAsset: CreatedAsset | undefined;

    try {
      await openClientUploadBranch(page, request, branch, canvasId);
      await triggerClientUploadBranch(page, branch);
      requestedAsset = await requested;
      const requestedPath =
        `${uploadConfig[branch.kind].endpoint}${encodeURIComponent(requestedAsset.assetId)}`;
      const replacementPath =
        `${uploadConfig[branch.kind].endpoint}${encodeURIComponent(replacement.assetId)}`;

      await expect.poll(async () => (
        await request.get(requestedPath)
      ).status()).toBe(404);
      expect((await request.get(replacementPath)).status()).toBe(200);
      expect(deletedPaths).toEqual([requestedPath]);
      await expectClientUploadNotAdopted(
        page,
        request,
        branch,
        canvasId,
        [requestedAsset.assetId, replacement.assetId],
      );
      expect(await paidProviderRequests(request)).toBe(before);
      expect(taskPosts).toEqual([]);
    } finally {
      await request.delete(`/api/canvas/${canvasId}`);
      await request.delete(
        `${uploadConfig[branch.kind].endpoint}${replacement.assetId}`,
      );
      if (requestedAsset) {
        await request.delete(
          `${uploadConfig[branch.kind].endpoint}${requestedAsset.assetId}`,
        );
      }
    }
  });
}
