import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
} from "./safe-test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANVAS_READ_TIMEOUT_MS,
  CanvasSaveSessionStorageError,
  createFetchCanvasPersistenceTransport,
  createCanvasPersistenceFacade,
  createCanvasSaveJournalPort,
  loadCanvasPersistenceWithDeadline,
  type CanvasPersistenceTransport,
} from "../client/src/canvas/canvasPersistenceFacade";

test("all four Canvas reads share a 30-second deadline without changing six-second saves", () => {
  expect(CANVAS_READ_TIMEOUT_MS).toBe(30_000);
  const surface = readFileSync(resolve("client/src/canvas/CanvasSurface.tsx"), "utf8");
  const facade = readFileSync(resolve("client/src/canvas/canvasPersistenceFacade.ts"), "utf8");
  for (const source of [surface, facade]) {
    expect(source).toContain("const PERSIST_SAVE_TIMEOUT_MS = 6_000;");
    expect(source).not.toContain("PERSIST_LOAD_TIMEOUT_MS");
  }
  for (const [source, reason] of [
    [surface, "canvas-authority-timeout"],
    [surface, "workflow-refresh-timeout"],
    [facade, "canvas-load-timeout"],
    [facade, "canvas-external-baseline-timeout"],
  ]) {
    expect(source).toMatch(new RegExp(`loadCanvasPersistenceWithDeadline\\(\\{[^}]*timeoutReason: "${reason}"`));
  }
});

for (const timeoutReason of [
  "canvas-load-timeout", "canvas-authority-timeout",
  "workflow-refresh-timeout", "canvas-external-baseline-timeout",
]) {
  test(`${timeoutReason} rejects an abort-ignoring transport once and ignores late completion`, async () => {
    let reads = 0;
    let writes = 0;
    let release!: (value: { body: unknown; ok: boolean; status: number }) => void;
    const controller = new AbortController();
    const transport: CanvasPersistenceTransport = {
      load: async () => { reads += 1; return new Promise((resolve) => { release = resolve; }); },
      put: async () => { writes += 1; throw new Error("unexpected write"); },
    };
    const pending = loadCanvasPersistenceWithDeadline({
      canvasId: "deadline-unit", controller, saveSessionId: "session",
      timeoutMs: 20, timeoutReason, transport,
    });
    await expect(pending).rejects.toThrow("Canvas load response timed out");
    expect(controller.signal.reason).toBe(timeoutReason);
    release({ body: { revision: 123 }, ok: true, status: 200 });
    await Promise.resolve();
    await expect(pending).rejects.toThrow("Canvas load response timed out");
    expect(reads).toBe(1);
    expect(writes).toBe(0);
  });
}

test("cancelled body cannot populate the authoritative Canvas transport cache", async () => {
  const document = {
    edges: [], graphRevision: 1, nodes: [], revision: 1,
    loadToken: "11111111-1111-4111-8111-111111111111",
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  let release!: () => void;
  let reads = 0;
  const transport = createFetchCanvasPersistenceTransport((async () => {
    reads += 1;
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, "text", { value: () => new Promise<string>((resolve) => {
      release = () => resolve(JSON.stringify(document));
    }) });
    return response;
  }) as typeof fetch);
  const controller = new AbortController();
  const pending = transport.load({ canvasId: "late-cache", saveSessionId: randomUUID(), signal: controller.signal });
  await Promise.resolve();
  controller.abort("canvas-authority-timeout");
  release();
  await expect(pending).rejects.toThrow("Canvas read aborted");
  const payload = JSON.stringify({
    ...document, observedRevision: 1, observedLoadToken: document.loadToken,
    saveAttemptId: randomUUID(), saveSequence: 1, saveSessionId: randomUUID(),
  });
  expect(transport.preparePayload?.({ canvasId: "late-cache", payload })).toBe(payload);
  expect(reads).toBe(1);
});

async function seedLegacyMediaPersistenceFixture(request: APIRequestContext) {
  const image =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Crect width='1600' height='900' fill='%23545f6c'/%3E%3Cpath d='M0 700 500 300l380 280 260-210 460 330v200H0Z' fill='%23849caf'/%3E%3C/svg%3E";
  const canvasId = "persistence.nodes-assets-viewport";
  const seeded = await request.put(`/api/canvas/${canvasId}`, {
    headers: { "X-Unboundry-Safe-Fixture-Seed": canvasId },
    data: {
      edges: [{
        id: "persistent-edge-text-image",
        source: "persistent-text",
        sourceHandle: "source",
        target: "persistent-image-1",
        targetHandle: "target",
        type: "cuttable",
      }],
      nodes: [
        {
          id: "persistent-text",
          type: "text",
          position: { x: 80, y: 100 },
          data: {
            content: "刷新页面后，这些内容仍然存在。",
            label: "Text",
            title: "持久化文字",
          },
          style: { height: 250, width: 250 },
        },
        ...[380, 870].map((x, index) => ({
          id: `persistent-image-${index + 1}`,
          type: "image",
          position: { x, y: 100 },
          data: {
            assetId: "asset-shared-landscape",
            imageSrc: image,
            label: "Image",
            sourceKind: "image",
            title: `共享素材 ${index + 1}`,
          },
          style: { height: 250, width: 444 },
        })),
        {
          id: "persistent-audio",
          type: "audio",
          position: { x: 80, y: 480 },
          data: {
            assetId: "asset-audio-184",
            audioDuration: 184,
            audioSrc: "data:audio/wav;base64,AAAA",
            audioWaveform: Array.from(
              { length: 64 },
              (_, index) => 12 + (index % 8) * 5,
            ),
            label: "Audio",
            sourceKind: "audio",
            title: "03:04 音频",
          },
          style: { height: 250, width: 444 },
        },
        {
          id: "persistent-video",
          type: "video",
          position: { x: 580, y: 480 },
          data: {
            assetId: "asset-video-demo",
            label: "Video",
            sourceKind: "video",
            title: "持久化视频",
            videoDuration: 12,
            videoHeight: 900,
            videoSrc: "data:video/mp4;base64,AAAA",
            videoWidth: 1600,
          },
          style: { height: 250, width: 444 },
        },
        {
          id: "persistent-playlist",
          type: "playlist",
          position: { x: 80, y: 840 },
          data: { label: "Playlist", title: "持久化播放列表" },
          style: { height: 104, width: 960 },
        },
      ],
      revision: 0,
      saveSequence: 1,
      saveSessionId: randomUUID(),
      viewport: { x: 120, y: 110, zoom: 0.72 },
    },
  });
  expect(seeded.ok()).toBe(true);
}

test("in-memory persistence facade replaces browser transport and journal", async () => {
  const values = new Map<string, string>();
  const journal = createCanvasSaveJournalPort({
    randomUUID: () => "memory-session-0001",
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  });
  const calls: string[] = [];
  const transport: CanvasPersistenceTransport = {
    async load(input) {
      calls.push(`load:${input.canvasId}:${input.saveSessionId}`);
      return {
        body: {
          currentWriterSequence: 0,
          currentWriterSessionId: null,
          edges: [],
          graphRevision: 0,
          loadToken: "memory-load-token-1",
          nodes: [],
          revision: 0,
          saveEpoch: "memory-epoch-1",
          sessionHighWaterAttemptId: null,
          sessionHighWaterSequence: 0,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        ok: true,
        status: 200,
      };
    },
    async put(input) {
      calls.push(`put:${input.canvasId}:${input.responseMode}:${Boolean(input.keepalive)}`);
      return {
        body: {
          graphRevision: 1,
          loadToken: "memory-load-token-2",
          revision: 1,
        },
        ok: true,
        status: 200,
      };
    },
  };
  const facade = createCanvasPersistenceFacade({ journal, transport });
  const session = facade.journal.load("memory-scope");
  const payload = JSON.stringify({
    edges: [],
    nodes: [],
    revision: 0,
    saveAttemptId: "memory-attempt-0001",
    saveSequence: 1,
    saveSessionId: session.saveSessionId,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  const reserved = facade.journal.store("memory-scope", {
    ...session,
    pendingPagehide: {
      attemptId: "memory-attempt-0001",
      payload,
      saveSequence: 1,
      serverEpoch: "memory-epoch-1",
    },
    saveSequence: 1,
    serverEpoch: "memory-epoch-1",
  });
  expect(reserved.storageRevision).toBe(1);
  const loaded = await facade.transport.load({
    canvasId: "memory-canvas",
    saveSessionId: session.saveSessionId,
    signal: new AbortController().signal,
  });
  expect(facade.isLoadedDocument(loaded.body)).toBe(true);
  const saved = await facade.transport.put({
    canvasId: "memory-canvas",
    keepalive: true,
    payload,
    responseMode: "strict-json",
  });
  expect(facade.isSaveSuccess(saved.body, facade.requestFence(payload))).toBe(true);
  expect(facade.pendingSnapshot({
    normalizeNodes: (nodes) => nodes,
    pending: reserved.pendingPagehide!,
    saveSessionId: session.saveSessionId,
  })?.fingerprint).toBeTruthy();
  const settled = facade.journal.settleStored({
    attemptId: "memory-attempt-0001",
    payload,
    saveSequence: 1,
    saveSessionId: session.saveSessionId,
    scopeId: "memory-scope",
    serverEpoch: "memory-epoch-1",
  });
  expect(settled?.settled).toMatchObject({
    confirmedSequence: 1,
    saveSequence: 1,
    storageRevision: 2,
  });
  expect(settled?.settled.pendingPagehide).toBeUndefined();
  expect(() => facade.journal.store("memory-scope", session)).toThrow(
    CanvasSaveSessionStorageError,
  );
  expect(calls).toEqual([
    `load:memory-canvas:${session.saveSessionId}`,
    "put:memory-canvas:strict-json:true",
  ]);
});

async function composeTitle(input: Locator, value: string, finish = true) {
  await input.dispatchEvent("compositionstart");
  await input.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: nextValue,
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
  }, value);
  if (finish) {
    await input.dispatchEvent("compositionend", { data: value });
  }
}

test("nodes, asset references and viewport survive a reload", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/persistence.nodes-assets-viewport");
  await seedLegacyMediaPersistenceFixture(request);
  await page.goto("/__fixture/persistence.nodes-assets-viewport");

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "6");
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await expect(page.locator('[data-asset-id="asset-shared-landscape"]')).toHaveCount(2);
  await expect(page.getByText("00:00/03:04")).toBeVisible();

  const text = page.locator(
    '.react-flow__node-text[data-id="persistent-text"]',
  );
  const before = (await text.boundingBox())!;
  await page.mouse.move(before.x + 80, before.y + 80);
  await page.mouse.down();
  await page.mouse.move(before.x + 150, before.y + 130, { steps: 5 });
  await page.mouse.up();

  await page.getByTestId("zoom-slider").fill("1.1");
  await expect(world).toHaveAttribute("data-viewport-zoom", "1.1");
  await page.waitForTimeout(1600);

  const saved = await request.get("/api/canvas/persistence.nodes-assets-viewport");
  expect(saved.ok()).toBeTruthy();
  const document = await saved.json() as {
    nodes: Array<{ id: string; position: { x: number; y: number } }>;
    viewport: { zoom: number };
  };
  expect(document.viewport.zoom).toBe(1.1);
  expect(document.nodes.find((node) => node.id === "persistent-text")?.position.x)
    .toBeGreaterThan(80);
  const after = (await text.boundingBox())!;

  await page.route(
    "**/api/canvas/persistence.final-clean-canvas",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.locator(".react-flow__node").count()).toBe(0);
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "6");
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await expect(world).toHaveAttribute("data-viewport-zoom", "1.1");
  expect((await text.boundingBox())!.x).toBeCloseTo(after.x, 0);
  expect((await text.boundingBox())!.y).toBeCloseTo(after.y, 0);
});

test("media nodes keep material-fit defaults and preserve manual resize", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await request.delete(`/api/canvas/${canvasId}`);
  await seedLegacyMediaPersistenceFixture(request);
  const durableWrites: Array<{
    body: unknown;
    method: string;
    pathname: string;
  }> = [];
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (
      (outgoing.method() === "PUT" && url.pathname === `/api/canvas/${canvasId}`) ||
      (outgoing.method() === "POST" &&
        url.pathname === `/api/canvases/${canvasId}/commands`)
    ) {
      durableWrites.push({
        body: outgoing.postDataJSON(),
        method: outgoing.method(),
        pathname: url.pathname,
      });
    }
  });
  await page.goto(`/__fixture/${canvasId}`);

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.waitForTimeout(900);
  durableWrites.length = 0;

  const resized = new Map<string, { height: number; width: number }>();
  for (const id of [
    "persistent-image-1",
    "persistent-video",
    "persistent-audio",
  ]) {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.click({ position: { x: 20, y: 20 } });
    await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);

    const before = (await node.boundingBox())!;
    const handle = node.locator(
      ".react-flow__resize-control.handle.bottom.right",
    );
    const handleBox = (await handle.boundingBox())!;
    const writesBeforeGesture = durableWrites.length;
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 36,
      handleBox.y + handleBox.height / 2 + 24,
      { steps: 8 },
    );
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.waitForTimeout(900);
    expect(durableWrites).toHaveLength(writesBeforeGesture);
    await page.mouse.up();

    await expect.poll(() => durableWrites.length).toBe(writesBeforeGesture + 1);
    expect(durableWrites.at(-1)).toMatchObject({
      body: { kind: "commit-user-layout" },
      method: "POST",
      pathname: `/api/canvases/${canvasId}/commands`,
    });

    const after = (await node.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 20);
    expect(after.height).toBeGreaterThan(before.height + 12);
    resized.set(id, { height: after.height, width: after.width });
  }

  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  for (const [id, expected] of resized) {
    const box = (await page
      .locator(`.react-flow__node[data-id="${id}"]`)
      .boundingBox())!;
    expect(box.width).toBeCloseTo(expected.width, 0);
    expect(box.height).toBeCloseTo(expected.height, 0);
  }
});

test("passive media hydration performs zero durable Canvas writes", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await request.delete(`/api/canvas/${canvasId}`);
  const landscape =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Crect width='1600' height='900' fill='%23545f6c'/%3E%3C/svg%3E";
  const portrait =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='1600'%3E%3Crect width='900' height='1600' fill='%234a6171'/%3E%3C/svg%3E";
  const nodes = [
    {
      id: "passive-media-group",
      type: "group",
      position: { x: 120, y: 120 },
      data: { groupColor: "rgba(255, 255, 255, 0.04)", label: "Group", title: "生产形态组" },
      style: { height: 820, width: 1420 },
      zIndex: 0,
    },
    ...[
      ["passive-image-landscape", landscape, 20, 20],
      ["passive-image-portrait", portrait, 340, 20],
    ].map(([id, imageSrc, x, y]) => ({
      id,
      type: "image",
      parentId: "passive-media-group",
      position: { x, y },
      data: {
        assetId: `local-${id}`,
        imageAssetOrigin: "upload",
        imageSrc,
        label: "Image",
        mediaStorageBackend: "local",
        sourceKind: "image",
        title: id,
      },
      style: { height: 250, width: 250 },
      zIndex: 1,
    })),
    {
      id: "passive-video-landscape",
      type: "video",
      parentId: "passive-media-group",
      position: { x: 660, y: 20 },
      data: {
        assetId: "local-passive-video-landscape",
        label: "Video",
        mediaStorageBackend: "local",
        sourceKind: "video",
        title: "本地横版视频",
        videoSrc: "/fixtures/video-success.mp4",
      },
      style: { height: 250, width: 250 },
      zIndex: 1,
    },
    {
      id: "passive-video-portrait",
      type: "video",
      parentId: "passive-media-group",
      position: { x: 980, y: 20 },
      data: {
        assetId: "result-passive-video-portrait",
        label: "Video",
        mediaStorageBackend: "local",
        sourceKind: "video",
        title: "生成结果竖版视频",
        videoSrc: "/fixtures/playlist-portrait.mp4",
      },
      style: { height: 250, width: 250 },
      zIndex: 1,
    },
    {
      id: "passive-audio",
      type: "audio",
      parentId: "passive-media-group",
      position: { x: 20, y: 400 },
      data: {
        assetId: "local-passive-audio",
        audioSrc: "/fixtures/audio-success.mp3",
        label: "Audio",
        mediaStorageBackend: "local",
        sourceKind: "audio",
        title: "本地音频",
      },
      style: { height: 250, width: 444 },
      zIndex: 1,
    },
  ];
  const seeded = await request.put(`/api/canvas/${canvasId}`, {
    headers: { "X-Unboundry-Safe-Fixture-Seed": canvasId },
    data: {
      edges: [],
      nodes,
      revision: 0,
      saveSequence: 1,
      saveSessionId: randomUUID(),
      viewport: { x: 0, y: 0, zoom: 0.7 },
    },
  });
  expect(seeded.ok()).toBe(true);
  const before = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
    graphRevision: number;
    nodes: unknown[];
    revision: number;
    updatedAt?: string;
  };

  const durableWrites: Array<{ method: string; pathname: string }> = [];
  page.on("request", (outgoing) => {
    const url = new URL(outgoing.url());
    if (
      (outgoing.method() === "PUT" && url.pathname === `/api/canvas/${canvasId}`) ||
      (outgoing.method() === "POST" &&
        url.pathname === `/api/canvases/${canvasId}/commands`)
    ) {
      durableWrites.push({ method: outgoing.method(), pathname: url.pathname });
    }
  });

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", String(nodes.length));
  await expect.poll(async () => page.locator("img").evaluateAll((images) =>
    images.filter((image) => (image as HTMLImageElement).complete).length
  )).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1_200);

  const after = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
    graphRevision: number;
    nodes: unknown[];
    revision: number;
    updatedAt?: string;
  };
  expect(durableWrites).toEqual([]);
  expect(after.revision).toBe(before.revision);
  expect(after.graphRevision).toBe(before.graphRevision);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.updatedAt).toBe(before.updatedAt);
});

test("passive media callbacks do not call the durable Canvas node setter", () => {
  const image = readFileSync(resolve("client/src/canvas/ImageNode.tsx"), "utf8");
  const video = readFileSync(resolve("client/src/canvas/VideoNode.tsx"), "utf8");
  const audio = readFileSync(resolve("client/src/canvas/AudioNode.tsx"), "utf8");

  expect(image).not.toContain("deferredPreviewAutoFit");
  expect(image).not.toContain("applyPreviewAutoFit");
  expect(video).not.toContain("deferredVideoMetadata");
  expect(video).not.toContain("applyVideoMetadata");
  expect(video).not.toMatch(/captureMetadata[\s\S]{0,800}\bsetNodes\s*\(/);
  expect(audio).not.toMatch(/decodeAudioData[\s\S]{0,800}\bsetNodes\s*\(/);
  expect(audio).not.toMatch(/applyLoadedAudioDuration[\s\S]{0,500}\bsetNodes\s*\(/);
});

test("pagehide rolls every unfinished title composition back to its last commit", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await request.delete(`/api/canvas/${canvasId}`);
  await seedLegacyMediaPersistenceFixture(request);
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const cases = [
    ["persistent-text", "canvas-node-title", "文字新标题"],
    ["persistent-image-1", "image-node-title-input", "图片新标题"],
    ["persistent-video", "video-node-title-input", "视频新标题"],
    ["persistent-audio", "audio-node-title-input", "音频新标题"],
    ["persistent-playlist", "playlist-node-title-input", "列表新标题"],
  ] as const;

  for (const [nodeId, testId, title] of cases) {
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    const input = page.getByTestId(testId);
    const committedTitle = `${title}已提交`;
    await input.fill(committedTitle);
    await input.press("Enter");
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    await composeTitle(input, `${title}pin yin`, false);
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    await expect(page.getByTestId(testId)).toHaveValue(committedTitle);
    await expect(page.getByTestId(testId)).not.toHaveValue(/pin yin/i);
  }
});

test("slow typing keeps every editable node title saved after the first key", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await request.delete(`/api/canvas/${canvasId}`);
  await seedLegacyMediaPersistenceFixture(request);
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const cases = [
    ["persistent-text", "canvas-node-title", "T123"],
    ["persistent-image-1", "image-node-title-input", "I123"],
    ["persistent-video", "video-node-title-input", "V123"],
    ["persistent-audio", "audio-node-title-input", "A123"],
    ["persistent-playlist", "playlist-node-title-input", "P123"],
  ] as const;

  for (const [nodeId, testId, title] of cases) {
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    const input = page.getByTestId(testId);
    await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await input.press("Backspace");
    for (const [index, key] of [...title].entries()) {
      await input.press(key);
      if (index < title.length - 1) {
        await page.waitForTimeout(120);
      }
    }
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    await expect(page.getByTestId(testId)).toHaveValue(title);
  }
});

test("cleared canvas stays empty after a reload", async ({ page, request }) => {
  await request.delete("/api/canvas/persistence.final-clean-canvas");
  await page.goto("/__fixture/persistence.final-clean-canvas");

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect(page.getByTestId("empty-quick-actions")).toHaveCount(0);

  for (const id of ["clean-a", "clean-b", "clean-c"]) {
    await page.locator(`.react-flow__node[data-id="${id}"]`).click();
    await page.keyboard.press("Backspace");
  }

  await expect(world).toHaveAttribute("data-node-count", "0");
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(page.getByTestId("empty-quick-actions")).toBeVisible();
  await page.waitForTimeout(1600);

  const saved = await request.get("/api/canvas/persistence.final-clean-canvas");
  expect(saved.ok()).toBeTruthy();
  const document = await saved.json() as { edges: unknown[]; nodes: unknown[] };
  expect(document.nodes).toHaveLength(0);
  expect(document.edges).toHaveLength(0);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "0");
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(page.getByTestId("empty-quick-actions")).toBeVisible();
});
