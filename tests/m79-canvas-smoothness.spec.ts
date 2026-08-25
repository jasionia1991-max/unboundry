import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "./safe-test";
import { isLoopbackTestUrl } from "./test-environment";

const previewAccount = Object.freeze({
  displayName: "Preview Performance Owner",
  loginName: "preview-performance-owner",
  password: "preview-performance-password-2026",
});

const performancePhases = ["drag", "pan", "zoom"] as const;
type PerformancePhase = (typeof performancePhases)[number];
type MeterPhase = PerformancePhase | "idle";

type MeterFrame = {
  now: number;
  phase: MeterPhase;
  mounted: number;
  visibleMounted: number;
};

type MeterLongTask = {
  duration: number;
  phase: MeterPhase;
};

type Meters = {
  frames: MeterFrame[];
  longTaskSupported: boolean;
  longTasks: MeterLongTask[];
};

type NodeSnapshot = {
  mountedIds: string[];
  visibleIds: string[];
};

type PhaseMetrics = {
  droppedFrames: number;
  frameCount: number;
  maxMs: number;
  mountedMin: number;
  p95Ms: number;
  visibleMountedMin: number;
};

type PerformanceMetrics = {
  droppedFrames: number;
  frameCount: number;
  fps: number;
  longTaskCountGe100: number;
  longTaskSupported: boolean;
  longTasksMs: number[];
  maxMs: number;
  mountedMin: number;
  measurementDurationMs: number;
  p95Ms: number;
  phases: Record<PerformancePhase, PhaseMetrics>;
};

type TierMetrics = {
  cleanup: "passed";
  dataLayerNodeCount: number;
  dragDistancePx: number;
  fitMounted: number;
  fitZoom: number;
  fitVisibleMounted: number;
  normalMounted: number;
  normalZoom: number;
  normalVisibleMounted: number;
  nodeCount: number;
  pageErrors: string[];
  panAfterMounted: number;
  panAfterVisibleIds: string[];
  panAfterVisibleMounted: number;
  panBeforeMounted: number;
  panBeforeVisibleIds: string[];
  panBeforeVisibleMounted: number;
  panMountedIdsChanged: boolean;
  panViewportAfterY: number;
  panViewportBeforeY: number;
  panVisibleIdsChanged: boolean;
  performance: PerformanceMetrics;
  consoleErrors: string[];
  forbiddenApiRequests: string[];
  externalRequests: string[];
};

test.beforeEach(async ({ context }) => {
  // Browser-owned requests share the authenticated session with the page.
  const request = context.request;
  const bootstrap = await request.post("/api/auth/bootstrap", {
    data: previewAccount,
  });
  expect([201, 409]).toContain(bootstrap.status());
  const login = await request.post("/api/auth/login", {
    data: {
      loginName: previewAccount.loginName,
      password: previewAccount.password,
    },
  });
  expect(login.status()).toBe(200);
  await expect.poll(async () => {
    const status = await request.get("/api/auth/status");
    return (await status.json()) as { authenticated?: boolean };
  }).toMatchObject({ authenticated: true });
});

function denseDocument(nodeCount: number) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    data: {
      label: index % 2 === 0 ? "Image" : "Text",
      title: `节点 ${index + 1}`,
      ...(index % 2 === 0
        ? { imagePrompt: "商品图", imagePromptReady: true }
        : { textPrompt: "文案内容", textPromptReady: true }),
    },
    id: `smooth-node-${index + 1}`,
    position: {
      x: (index % 20) * 300 + 60,
      y: Math.floor(index / 20) * 300 + 60,
    },
    style: { height: 250, width: 250 },
    type: index % 2 === 0 ? "image" : "text",
    zIndex: 1,
  }));
  const edges = Array.from({ length: nodeCount - 1 }, (_, index) => ({
    id: `smooth-edge-${index + 1}`,
    source: nodes[index].id,
    sourceHandle: "source",
    target: nodes[index + 1].id,
    targetHandle: "target",
    type: "cuttable",
  }));
  return { edges, nodes, revision: 0, viewport: { x: 0, y: 0, zoom: 1 } };
}

function richGroupDocument() {
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  for (let groupIndex = 0; groupIndex < 3; groupIndex += 1) {
    const groupId = `rich-group-${groupIndex + 1}`;
    nodes.push({
      data: {
        label: "Group",
        title: `复杂组合 ${groupIndex + 1}`,
        variant: "group",
      },
      id: groupId,
      position: {
        x: (groupIndex % 2) * 3_100,
        y: Math.floor(groupIndex / 2) * 1_900,
      },
      style: { height: 1_660, width: 2_900 },
      type: "group",
      zIndex: 0,
    });
    const childIds: string[] = [];
    for (let childIndex = 0; childIndex < 12; childIndex += 1) {
      const type = childIndex < 7
        ? "text"
        : childIndex < 11
          ? "image"
          : "video";
      const childId = `${groupId}-${type}-${childIndex + 1}`;
      childIds.push(childId);
      nodes.push({
        data: {
          label: type === "text" ? "Text" : type === "image" ? "Image" : "Video",
          title: `${groupIndex + 1}-${childIndex + 1} ${type}`,
          ...(type === "text"
            ? { content: `复杂组合文案 ${groupIndex + 1}-${childIndex + 1}` }
            : type === "image"
              ? {
                  imagePrompt: "本地复杂组合图片",
                  imagePromptReady: true,
                  imageSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23444'/%3E%3C/svg%3E",
                }
              : {
                  videoPrompt: "本地复杂组合视频",
                  videoPromptReady: true,
                  videoSrc: "data:video/mp4;base64,AAAA",
                }),
        },
        id: childId,
        parentId: groupId,
        position: {
          x: 90 + (childIndex % 4) * 690,
          y: 100 + Math.floor(childIndex / 4) * 500,
        },
        style: { height: 410, width: 620 },
        type,
        zIndex: 1,
      });
    }
    for (let edgeIndex = 0; edgeIndex < 24; edgeIndex += 1) {
      edges.push({
        id: `${groupId}-edge-${edgeIndex + 1}`,
        source: childIds[edgeIndex % childIds.length],
        sourceHandle: "source",
        target: childIds[(edgeIndex + (edgeIndex < 12 ? 1 : 5)) % childIds.length],
        targetHandle: "target",
        type: "cuttable",
      });
    }
  }
  edges.push({
    id: "rich-cross-group-edge",
    source: "rich-group-1-text-1",
    sourceHandle: "source",
    target: "rich-group-2-image-8",
    targetHandle: "target",
    type: "cuttable",
  });
  return {
    edges,
    nodes,
    revision: 0,
    viewport: { x: 80, y: 80, zoom: 0.156 },
  };
}

async function saveDenseProjectCanvas(
  request: APIRequestContext,
  canvasId: string,
  nodeCount: number,
) {
  const baselineResponse = await request.get(`/api/canvas/${canvasId}`);
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = (await baselineResponse.json()) as {
    loadToken: string;
    revision: number;
  };
  const saved = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      ...denseDocument(nodeCount),
      observedLoadToken: baseline.loadToken,
      observedRevision: baseline.revision,
      revision: baseline.revision,
      saveAttemptId: randomUUID(),
      saveSequence: 1,
      saveSessionId: randomUUID(),
    },
  });
  expect(saved.ok()).toBeTruthy();

  const persistedResponse = await request.get(`/api/canvas/${canvasId}`);
  expect(persistedResponse.ok()).toBeTruthy();
  const persisted = (await persistedResponse.json()) as {
    nodes?: unknown[];
  };
  expect(persisted.nodes).toHaveLength(nodeCount);
  return persisted.nodes?.length ?? 0;
}

async function saveRichGroupProjectCanvas(
  request: APIRequestContext,
  canvasId: string,
) {
  const document = richGroupDocument();
  expect(document.nodes).toHaveLength(39);
  expect(document.edges).toHaveLength(73);
  const baselineResponse = await request.get(`/api/canvas/${canvasId}`);
  const baseline = (await baselineResponse.json()) as {
    loadToken: string;
    revision: number;
  };
  const saved = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      ...document,
      observedLoadToken: baseline.loadToken,
      observedRevision: baseline.revision,
      revision: baseline.revision,
      saveAttemptId: randomUUID(),
      saveSequence: 1,
      saveSessionId: randomUUID(),
    },
  });
  expect(saved.ok()).toBeTruthy();
}

async function runRichGroupDragScenario(
  page: Page,
  context: {
    request: APIRequestContext;
  },
) {
  const request = context.request;
  let projectId: string | undefined;
  try {
    const created = await request.post("/api/projects", { data: {} });
    expect(created.status()).toBe(201);
    projectId = ((await created.json()) as { id: string }).id;
    await saveRichGroupProjectCanvas(request, projectId);
    await page.goto(`/canvas/${projectId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-node-count", "39");
    await expect(world).toHaveAttribute("data-edge-count", "73");
    await expect(world).toHaveAttribute("data-group-count", "3");
    await expect(world).toHaveAttribute("data-viewport-zoom", "0.156");

    const group = page.locator('.react-flow__node[data-id="rich-group-1"]');
    const child = page.locator(
      '.react-flow__node[data-id="rich-group-1-text-1"]',
    );
    await expect(group).toBeVisible();
    await expect(child).toBeVisible();
    const groupBefore = (await group.boundingBox())!;
    const childBefore = (await child.boundingBox())!;
    const relativeBefore = {
      x: childBefore.x - groupBefore.x,
      y: childBefore.y - groupBefore.y,
    };

    let captureCanvasWrites = false;
    let pointerDown = false;
    const canvasPuts: string[] = [];
    const mediaRequests: string[] = [];
    const requestListener = (browserRequest: import("@playwright/test").Request) => {
      const url = new URL(browserRequest.url());
      if (
        captureCanvasWrites &&
        browserRequest.method() === "PUT" &&
        url.pathname === `/api/canvas/${projectId}`
      ) canvasPuts.push(`${browserRequest.method()} ${url.pathname}`);
      if (pointerDown && /\/(assets|audio-assets|video-assets|media|oss|upload)(\/|$)/.test(
        url.pathname,
      )) mediaRequests.push(`${browserRequest.method()} ${url.pathname}`);
    };
    page.on("request", requestListener);
    await startMeters(page);
    await setMeterPhase(page, "drag");
    const point = await findNodeDragPoint(page, "rich-group-1");
    await page.mouse.move(point.x, point.y);
    captureCanvasWrites = true;
    pointerDown = true;
    await page.mouse.down();
    for (let step = 1; step <= 90; step += 1) {
      await page.mouse.move(point.x + step * 2, point.y + step, { steps: 1 });
      await page.waitForTimeout(8);
    }
    expect(canvasPuts).toEqual([]);
    expect(mediaRequests).toEqual([]);
    await page.mouse.up();
    pointerDown = false;
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await expect.poll(async () => {
      const response = await request.get(`/api/canvas/${projectId}`);
      const document = (await response.json()) as {
        nodes: Array<{ id: string; position: { x: number } }>;
      };
      return document.nodes.find((node) => node.id === "rich-group-1")
        ?.position.x;
    }).toBeGreaterThan(500);
    await page.waitForTimeout(200);
    captureCanvasWrites = false;
    page.off("request", requestListener);
    expect(canvasPuts).toHaveLength(1);

    const meters = summarizeMeters(await readMeters(page));
    expect(meters.phases.drag.frameCount).toBeGreaterThan(20);
    expect(meters.phases.drag.p95Ms).toBeLessThanOrEqual(25);
    expect(meters.phases.drag.maxMs).toBeLessThan(100);
    expect(meters.phases.drag.droppedFrames).toBeLessThanOrEqual(5);
    expect(meters.longTaskCountGe100).toBe(0);

    const groupAfter = (await group.boundingBox())!;
    const childAfter = (await child.boundingBox())!;
    expect(groupAfter.x).toBeGreaterThan(groupBefore.x + 100);
    expect(groupAfter.y).toBeGreaterThan(groupBefore.y + 50);
    expect(childAfter.x - groupAfter.x).toBeCloseTo(relativeBefore.x, 0);
    expect(childAfter.y - groupAfter.y).toBeCloseTo(relativeBefore.y, 0);
    await expect(group).toBeVisible();
    await expect(child).toBeVisible();

    const persisted = async () => {
      const response = await request.get(`/api/canvas/${projectId}`);
      return (await response.json()) as {
        edges: unknown[];
        nodes: Array<{
          id: string;
          parentId?: string;
          position: { x: number; y: number };
        }>;
      };
    };
    await expect.poll(async () => {
      const document = await persisted();
      return document.nodes.find((node) => node.id === "rich-group-1")?.position.x;
    }).toBeGreaterThan(500);
    const saved = await persisted();
    expect(saved.nodes).toHaveLength(39);
    expect(saved.edges).toHaveLength(73);
    expect(saved.nodes.filter((node) => node.parentId === "rich-group-1"))
      .toHaveLength(12);
    const savedChild = saved.nodes.find((node) =>
      node.id === "rich-group-1-text-1"
    )!;
    expect(savedChild.position).toEqual({ x: 90, y: 100 });

    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await group.boundingBox())?.x)
      .toBeCloseTo(groupBefore.x, 0);
    await page.keyboard.press("Meta+Shift+z");
    await expect.poll(async () => (await group.boundingBox())?.x)
      .toBeCloseTo(groupAfter.x, 0);

    const secondPoint = await findNodeDragPoint(page, "rich-group-2");
    await page.keyboard.down("Shift");
    await page.mouse.click(secondPoint.x, secondPoint.y);
    await page.keyboard.up("Shift");
    await expect(world).toHaveAttribute("data-selected-node-count", "2");

    const metrics = {
      canvasPutsFromDragStartThroughSettlement: canvasPuts.length,
      childCountPerGroup: 12,
      edgeCount: 73,
      groupCount: 3,
      groupSize: { height: 1660, width: 2900 },
      mediaRequestsDuringPointerDown: mediaRequests.length,
      nodeCount: 39,
      performance: meters.phases.drag,
      zoom: 0.156,
    };
    test.info().annotations.push({
      type: "m79-rich-group-metrics",
      description: JSON.stringify(metrics),
    });
    console.info(`[m79-rich-group] ${JSON.stringify(metrics)}`);
  } finally {
    if (projectId) await cleanupProject(request, projectId);
  }
}

async function cleanupProject(request: APIRequestContext, projectId: string) {
  const failures: string[] = [];
  for (const path of [
    `/api/canvas/${projectId}`,
    `/api/projects/${projectId}`,
  ]) {
    try {
      const response = await request.delete(path);
      if (![200, 204, 404].includes(response.status())) {
        failures.push(`${path}: ${response.status()}`);
      }
    } catch (error) {
      failures.push(`${path}: ${String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`m79 cleanup failed: ${failures.join(", ")}`);
  }
}

async function installPageErrorCapture(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      m79UnhandledErrors?: string[];
    };
    state.m79UnhandledErrors = [];
    const record = (message: string) => {
      state.m79UnhandledErrors!.push(message);
    };
    window.addEventListener("error", (event) => {
      record(`error:${event.message}`);
    });
    window.addEventListener("unhandledrejection", (event) => {
      record(`unhandledrejection:${String(event.reason)}`);
    });
  });
}

async function nodeSnapshot(page: Page): Promise<NodeSnapshot> {
  return page.evaluate(() => {
    const visibleNodeIds = () => {
      const world = document.querySelector<HTMLElement>(
        '[data-testid="canvas-world"]',
      );
      const worldRect = world?.getBoundingClientRect();
      return Array.from(
        document.querySelectorAll<HTMLElement>(".react-flow__node"),
      )
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const hasBox = rect.width > 0 && rect.height > 0;
          const displayed =
            style.display !== "none" && style.visibility !== "hidden";
          if (!hasBox || !displayed) return false;
          if (!worldRect) return true;
          return (
            rect.right > worldRect.left &&
            rect.left < worldRect.right &&
            rect.bottom > worldRect.top &&
            rect.top < worldRect.bottom
          );
        })
        .map((element) => element.dataset.id ?? "")
        .filter(Boolean);
    };
    const mountedIds = Array.from(
      document.querySelectorAll<HTMLElement>(".react-flow__node"),
    )
      .map((element) => element.dataset.id ?? "")
      .filter(Boolean);
    return {
      mountedIds,
      visibleIds: visibleNodeIds(),
    };
  });
}

async function startMeters(page: Page) {
  await page.evaluate(() => {
    const state = window as typeof window & {
      smoothFrames?: MeterFrame[];
      smoothFrameTimer?: number;
      smoothLongTasks?: MeterLongTask[];
      smoothLongTaskSupported?: boolean;
      smoothObserver?: PerformanceObserver;
      smoothPhase?: MeterPhase;
    };
    state.smoothPhase = "idle";
    state.smoothLongTasks = [];
    const supportsLongTasks =
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("longtask");
    state.smoothLongTaskSupported = supportsLongTasks;
    if (supportsLongTasks) {
      state.smoothObserver = new PerformanceObserver((list) => {
        state.smoothLongTasks!.push(
          ...list.getEntries().map((entry) => ({
            duration: entry.duration,
            phase: state.smoothPhase ?? "idle",
          })),
        );
      });
      state.smoothObserver.observe({ entryTypes: ["longtask"] });
    }
    state.smoothFrames = [];
    const visibleNodeCount = (elements: HTMLElement[]) => {
      const world = document.querySelector<HTMLElement>(
        '[data-testid="canvas-world"]',
      );
      const worldRect = world?.getBoundingClientRect();
      return elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const hasBox = rect.width > 0 && rect.height > 0;
        const displayed =
          style.display !== "none" && style.visibility !== "hidden";
        if (!hasBox || !displayed) return false;
        if (!worldRect) return true;
        return (
          rect.right > worldRect.left &&
          rect.left < worldRect.right &&
          rect.bottom > worldRect.top &&
          rect.top < worldRect.bottom
        );
      }).length;
    };
    const record = (now: number) => {
      const mounted = Array.from(
        document.querySelectorAll<HTMLElement>(".react-flow__node"),
      );
      const visibleMounted = visibleNodeCount(mounted);
      state.smoothFrames!.push({
        now,
        phase: state.smoothPhase ?? "idle",
        mounted: mounted.length,
        visibleMounted,
      });
      state.smoothFrameTimer = requestAnimationFrame(record);
    };
    state.smoothFrameTimer = requestAnimationFrame(record);
  });
}

async function setMeterPhase(page: Page, phase: MeterPhase) {
  await page.evaluate((nextPhase) => {
    const state = window as typeof window & { smoothPhase?: MeterPhase };
    state.smoothPhase = nextPhase;
  }, phase);
}

async function readMeters(page: Page): Promise<Meters> {
  return page.evaluate(() => {
    const state = window as typeof window & {
      smoothFrames?: MeterFrame[];
      smoothFrameTimer?: number;
      smoothLongTasks?: MeterLongTask[];
      smoothLongTaskSupported?: boolean;
      smoothObserver?: PerformanceObserver;
      smoothPhase?: MeterPhase;
    };
    if (state.smoothObserver) {
      state.smoothLongTasks!.push(
        ...state.smoothObserver.takeRecords().map((entry) => ({
          duration: entry.duration,
          phase: state.smoothPhase ?? "idle",
        })),
      );
      state.smoothObserver.disconnect();
    }
    state.smoothPhase = "idle";
    if (state.smoothFrameTimer !== undefined) {
      window.cancelAnimationFrame(state.smoothFrameTimer);
    }
    return {
      frames: state.smoothFrames ?? [],
      longTaskSupported: state.smoothLongTaskSupported ?? false,
      longTasks: state.smoothLongTasks ?? [],
    };
  });
}

function frameStats(frames: MeterFrame[]) {
  const deltas = frames
    .slice(1)
    .map((frame, index) => {
      const previous = frames[index];
      return frame.phase === previous.phase && frame.phase !== "idle"
        ? frame.now - previous.now
        : undefined;
    })
    .filter((delta): delta is number => delta !== undefined);
  const sorted = [...deltas].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    droppedFrames: deltas.filter((delta) => delta > 24).length,
    frameCount: deltas.length,
    maxMs: Math.max(0, ...deltas),
    p95Ms: sorted[p95Index] ?? 0,
  };
}

function summarizeMeters(meters: Meters): PerformanceMetrics {
  const measuredFrames = meters.frames.filter((frame) => frame.phase !== "idle");
  const overall = frameStats(meters.frames);
  const first = measuredFrames[0]?.now ?? 0;
  const last = measuredFrames.at(-1)?.now ?? first;
  const measurementDurationMs = Math.max(0, last - first);
  const phaseMetrics = Object.fromEntries(
    performancePhases.map((phase) => {
      const phaseFrames = meters.frames.filter((frame) => frame.phase === phase);
      const stats = frameStats(phaseFrames);
      return [
        phase,
        {
          ...stats,
          mountedMin:
            phaseFrames.length > 0
              ? Math.min(...phaseFrames.map((frame) => frame.mounted))
              : 0,
          visibleMountedMin:
            phaseFrames.length > 0
              ? Math.min(...phaseFrames.map((frame) => frame.visibleMounted))
              : 0,
        },
      ];
    }),
  ) as Record<PerformancePhase, PhaseMetrics>;
  const longTasksMs = meters.longTasks.map((entry) => entry.duration);
  return {
    ...overall,
    fps:
      measurementDurationMs > 0
        ? Math.round((measuredFrames.length / measurementDurationMs) * 1000)
        : 0,
    longTaskCountGe100: longTasksMs.filter((duration) => duration >= 100).length,
    longTaskSupported: meters.longTaskSupported,
    longTasksMs,
    measurementDurationMs,
    mountedMin:
      measuredFrames.length > 0
        ? Math.min(...measuredFrames.map((frame) => frame.mounted))
        : 0,
    phases: phaseMetrics,
  };
}

async function findPanePoint(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".react-flow__pane");
    if (!pane) throw new Error("React Flow pane is missing");
    const rect = pane.getBoundingClientRect();
    for (let y = rect.top + 12; y < rect.bottom - 12; y += 16) {
      for (let x = rect.left + 12; x < rect.right - 12; x += 16) {
        const target = document.elementFromPoint(x, y);
        if (target?.classList.contains("react-flow__pane")) {
          return { x, y };
        }
      }
    }
    throw new Error("No blank React Flow pane point is available for pan");
  });
}

async function findNodeDragPoint(page: Page, nodeId: string) {
  return page.evaluate((targetNodeId) => {
    const node = Array.from(
      document.querySelectorAll<HTMLElement>(".react-flow__node"),
    ).find((candidate) => candidate.dataset.id === targetNodeId);
    if (!node) throw new Error(`Mounted node ${targetNodeId} is missing`);
    const rect = node.getBoundingClientRect();
    const blockedSelector =
      "button, input, textarea, select, [contenteditable='true'], .nodrag";
    for (let y = rect.top + 10; y < rect.bottom - 10; y += 10) {
      for (let x = rect.left + 10; x < rect.right - 10; x += 10) {
        const target = document.elementFromPoint(x, y);
        if (
          target?.closest(".react-flow__node") === node &&
          !target.closest(blockedSelector)
        ) {
          return { x, y };
        }
      }
    }
    throw new Error(`No draggable point found for ${targetNodeId}`);
  }, nodeId);
}

function sameIdSet(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    [...leftSet].every((id) => rightSet.has(id))
  );
}

async function runTier(
  page: Page,
  context: {
    on: (
      event: "request",
      listener: (request: import("@playwright/test").Request) => void,
    ) => unknown;
    request: APIRequestContext;
  },
  nodeCount: number,
) {
  const externalRequests: string[] = [];
  const forbiddenApiRequests: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (!isLoopbackTestUrl(url)) {
      externalRequests.push(`${request.method()} ${url}`);
      return;
    }
    const pathname = new URL(url).pathname;
    if (
      request.method() !== "GET" &&
      /generation|provider|oss|media|asset|upload|files?|relay/i.test(pathname)
    ) {
      forbiddenApiRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await installPageErrorCapture(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const request = context.request;
  let projectId: string | undefined;
  let metrics: TierMetrics | undefined;
  try {
    const created = await request.post("/api/projects", { data: {} });
    expect(created.status()).toBe(201);
    projectId = ((await created.json()) as { id: string }).id;
    const dataLayerNodeCount = await saveDenseProjectCanvas(
      request,
      projectId,
      nodeCount,
    );
    expect(dataLayerNodeCount).toBe(nodeCount);

    await page.goto(`/canvas/${projectId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-node-count", String(nodeCount));
    await expect.poll(async () => (await nodeSnapshot(page)).mountedIds.length)
      .toBeGreaterThan(0);
    await page.waitForTimeout(250);
    await expect(world).toHaveAttribute("data-viewport-zoom", "1");

    const normal = await nodeSnapshot(page);
    expect(normal.mountedIds.length).toBeGreaterThan(0);
    expect(normal.mountedIds.length).toBeLessThan(nodeCount);
    expect(normal.visibleIds.length).toBeGreaterThan(0);

    await startMeters(page);

    await setMeterPhase(page, "drag");
    const dragNode = page.locator(
      `.react-flow__node[data-id="${normal.visibleIds[0]}"]`,
    );
    const dragBox = await dragNode.boundingBox();
    if (!dragBox) throw new Error("A mounted node is required for drag evidence");
    const { x: dragX, y: dragY } = await findNodeDragPoint(
      page,
      normal.visibleIds[0],
    );
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    for (let step = 1; step <= 90; step += 1) {
      await page.mouse.move(dragX + step * 2, dragY + step, {
        steps: 1,
      });
      await page.waitForTimeout(14);
    }
    await page.mouse.up();
    await page.waitForTimeout(160);
    const dragAfterBox = await dragNode.boundingBox();
    if (!dragAfterBox) throw new Error("Dragged node must stay mounted");
    const dragDistancePx = Math.hypot(
      dragAfterBox.x - dragBox.x,
      dragAfterBox.y - dragBox.y,
    );
    expect(dragDistancePx).toBeGreaterThan(20);

    const panBefore = await nodeSnapshot(page);
    const viewportBeforePan = Number(await world.getAttribute("data-viewport-y"));
    await setMeterPhase(page, "pan");
    const panePoint = await findPanePoint(page);
    await page.mouse.move(panePoint.x, panePoint.y);
    for (let step = 0; step < 30; step += 1) {
      await page.mouse.wheel(0, 24);
      await page.waitForTimeout(8);
    }
    await page.waitForTimeout(180);

    const panAfter = await nodeSnapshot(page);
    const viewportAfterPan = Number(await world.getAttribute("data-viewport-y"));
    expect(viewportAfterPan).not.toBe(viewportBeforePan);
    expect(panAfter.mountedIds.length).toBeGreaterThan(0);
    expect(panAfter.visibleIds.length).toBeGreaterThan(0);
    expect(sameIdSet(panBefore.mountedIds, panAfter.mountedIds)).toBeFalsy();
    expect(sameIdSet(panBefore.visibleIds, panAfter.visibleIds)).toBeFalsy();

    await setMeterPhase(page, "zoom");
    const slider = page.getByTestId("zoom-slider");
    for (const zoom of ["0.9", "0.75", "0.6", "0.45"]) {
      await slider.fill(zoom);
      await page.waitForTimeout(60);
    }
    await expect(world).toHaveAttribute("data-viewport-zoom", "0.45");
    await page.waitForTimeout(180);

    const performance = summarizeMeters(await readMeters(page));
    for (const phase of performancePhases) {
      expect(performance.phases[phase].frameCount).toBeGreaterThan(5);
      expect(performance.phases[phase].visibleMountedMin).toBeGreaterThan(0);
    }
    expect(performance.longTaskSupported).toBeTruthy();
    expect(performance.longTaskCountGe100).toBe(0);
    expect(performance.p95Ms).toBeLessThanOrEqual(25);
    expect(performance.maxMs).toBeLessThan(100);
    expect(performance.droppedFrames).toBeLessThanOrEqual(5);
    expect(performance.mountedMin).toBeGreaterThan(0);
    for (const phase of performancePhases) {
      expect(performance.phases[phase].mountedMin).toBeGreaterThan(0);
    }

    await page.getByTestId("fit-view").click();
    await page.waitForTimeout(1_000);
    await slider.fill("0.15");
    await expect(world).toHaveAttribute("data-viewport-zoom", "0.15");
    await expect.poll(() => page.locator(".react-flow__node").count(), {
      timeout: 5_000,
    }).toBe(nodeCount);
    const fit = await nodeSnapshot(page);
    expect(fit.mountedIds.length).toBe(nodeCount);
    expect(fit.visibleIds.length).toBe(nodeCount);

    const browserUnhandledErrors = await page.evaluate(() => {
      const state = window as typeof window & {
        m79UnhandledErrors?: string[];
      };
      return state.m79UnhandledErrors ?? [];
    });
    const allPageErrors = [...pageErrors, ...browserUnhandledErrors];
    expect(allPageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
    expect(forbiddenApiRequests).toEqual([]);

    metrics = {
      cleanup: "passed",
      dataLayerNodeCount,
      dragDistancePx,
      fitMounted: fit.mountedIds.length,
      fitZoom: Number(await world.getAttribute("data-viewport-zoom")),
      fitVisibleMounted: fit.visibleIds.length,
      normalMounted: normal.mountedIds.length,
      normalZoom: 1,
      normalVisibleMounted: normal.visibleIds.length,
      nodeCount,
      pageErrors: allPageErrors,
      panAfterMounted: panAfter.mountedIds.length,
      panAfterVisibleIds: panAfter.visibleIds,
      panAfterVisibleMounted: panAfter.visibleIds.length,
      panBeforeMounted: panBefore.mountedIds.length,
      panBeforeVisibleIds: panBefore.visibleIds,
      panBeforeVisibleMounted: panBefore.visibleIds.length,
      panMountedIdsChanged: !sameIdSet(
        panBefore.mountedIds,
        panAfter.mountedIds,
      ),
      panViewportAfterY: viewportAfterPan,
      panViewportBeforeY: viewportBeforePan,
      panVisibleIdsChanged: !sameIdSet(
        panBefore.visibleIds,
        panAfter.visibleIds,
      ),
      performance,
      consoleErrors,
      forbiddenApiRequests,
      externalRequests,
    };
  } finally {
    if (projectId) await cleanupProject(request, projectId);
  }
  if (!metrics) throw new Error(`m79 ${nodeCount}-node metrics were not recorded`);
  const serialized = JSON.stringify(metrics);
  test.info().annotations.push({ type: "m79-metrics", description: serialized });
  console.info(`[m79] ${serialized}`);
  return metrics;
}

const nodeCounts = [98, 171, 200] as const;

for (const nodeCount of nodeCounts) {
  test(`${nodeCount}-node canvas stays smooth across drag, pan and zoom`, async ({
    context,
    page,
  }) => {
    await runTier(page, context, nodeCount);
    if (nodeCount === 98) await runRichGroupDragScenario(page, context);
  });
}
