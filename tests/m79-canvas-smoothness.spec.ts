import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "./safe-test";
import { isLoopbackTestUrl } from "./test-environment";

type BrowserContext = ReturnType<Page["context"]>;
type Route = Parameters<Parameters<Page["route"]>[1]>[0];

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
    const forwardPairs: Array<readonly [string, string]> = [];
    for (let gap = 1; gap < childIds.length && forwardPairs.length < 24; gap += 1) {
      for (
        let sourceIndex = 0;
        sourceIndex + gap < childIds.length && forwardPairs.length < 24;
        sourceIndex += 1
      ) {
        forwardPairs.push([
          childIds[sourceIndex],
          childIds[sourceIndex + gap],
        ]);
      }
    }
    for (let edgeIndex = 0; edgeIndex < forwardPairs.length; edgeIndex += 1) {
      const [source, target] = forwardPairs[edgeIndex];
      edges.push({
        id: `${groupId}-edge-${edgeIndex + 1}`,
        source,
        sourceHandle: "source",
        target,
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
    const canvasCommandPosts: string[] = [];
    const canvasLegacyPuts: string[] = [];
    const mediaRequests: string[] = [];
    const requestListener = (browserRequest: import("@playwright/test").Request) => {
      const url = new URL(browserRequest.url());
      if (
        captureCanvasWrites &&
        browserRequest.method() === "PUT" &&
        url.pathname === `/api/canvas/${projectId}`
      ) canvasLegacyPuts.push(`${browserRequest.method()} ${url.pathname}`);
      if (
        captureCanvasWrites &&
        browserRequest.method() === "POST" &&
        url.pathname === `/api/canvases/${projectId}/commands`
      ) canvasCommandPosts.push(`${browserRequest.method()} ${url.pathname}`);
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
    expect(canvasCommandPosts).toEqual([]);
    expect(canvasLegacyPuts).toEqual([]);
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
    expect(canvasCommandPosts).toHaveLength(1);
    expect(canvasLegacyPuts).toEqual([]);

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
      canvasCommandPostsFromDragStartThroughSettlement:
        canvasCommandPosts.length,
      canvasLegacyPutsFromDragStartThroughSettlement: canvasLegacyPuts.length,
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

type B5NetworkGroup = "loopback" | "controlled-50mbps-50ms";
type B5CaptureKind =
  | "document"
  | "history-directory"
  | "history-preview"
  | "history-original"
  | "canvas-document"
  | "script"
  | "stylesheet"
  | "auth-status";

type B5ResponseLike = {
  body(): Promise<Buffer>;
  headers(): Record<string, string>;
  status(): number;
};

type B5ResponseEvidence = {
  bytes: number | null;
  completedAtMs: number;
  durationMs: number;
  kind: B5CaptureKind;
  startedAtMs: number;
  status: number | null;
  url: string;
};

type B5Capture = {
  browserHttpCache: "disabled-by-safe-test-context-route";
  inFlight: number;
  label: string;
  maxConcurrent: number;
  network: B5NetworkGroup;
  pending: number;
  requestCount: number;
  requestUrls: string[];
  responses: B5ResponseEvidence[];
  startedAtMs: number;
};

type B5RuntimeEvidence = {
  jsHeapLimitBytes?: number;
  jsHeapTotalBytes?: number;
  jsHeapUsedBytes?: number;
  taskDurationMs?: number;
  source: string[];
};

type B5PageReadyTiming = {
  epochMs: number;
  navigationEpochMs: number;
  nowMs: number;
};

type B5PageHistoryTiming = {
  firstImageMs: number;
  firstScreenMs: number;
  startEpochMs: number;
};

type B5NavigationSample = {
  cacheReset: "cdp-cleared" | "unavailable" | "not-requested";
  elapsedMs: number;
  label: string;
  maxConcurrent: number;
  navigationStartEpochMs: number;
  readyAtEpochMs: number;
  network: B5NetworkGroup;
  rawResponses: B5ResponseEvidence[];
  requestCount: number;
  requestUrls: string[];
  runtime: B5RuntimeEvidence;
};

type B5HistorySample = {
  assetIds: string[];
  browserHttpCache: "disabled-by-safe-test-context-route";
  cacheReset: "cdp-cleared" | "not-requested";
  firstImageResponseMs: number | null;
  firstImageVisibleMs: number;
  firstScreenBytes: number | null;
  firstScreenVisibleMs: number;
  historyDirectoryBytes: number | null;
  historyDirectoryMs: number | null;
  historyItemCount: number;
  label: string;
  maxConcurrent: number;
  network: B5NetworkGroup;
  previewDialogMs: number;
  previewOriginalBytes: number | null;
  previewOriginalResponseMs: number | null;
  rawResponses: B5ResponseEvidence[];
  requestCount: number;
  requestUrls: string[];
  runtime: B5RuntimeEvidence;
  firstScreenIds: string[];
  previewCache: "fresh-asset-ids" | "server-preview-cache-only";
};

type B5ProgressReporter = {
  group(
    group: string,
    status: "completed" | "failed",
    samples: readonly unknown[],
    error?: unknown,
  ): void;
  sample(group: string, completed: number, total: number): void;
  failed(groups: readonly string[]): void;
};

type B5UploadEvidence = {
  assetId: string;
  assetBytes: number;
  historyMs: number;
  historyStatus: number;
  uploadMs: number;
  uploadStatus: number;
};

const b5HistoryItemCount = 27;
const b5FirstScreenCount = 20;
const b5FirstScreenDefinition =
  "the first 20 history cards must be fully inside the history content viewport at zoom 80 and have decoded PNGs";
const b5ReferenceImagePath =
  "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png";

function b5RequestKind(
  rawUrl: string,
  resourceType?: string,
): B5CaptureKind | undefined {
  const url = new URL(rawUrl);
  if (resourceType === "document") return "document";
  if (resourceType === "script") return "script";
  if (resourceType === "stylesheet") return "stylesheet";
  if (url.pathname === "/api/auth/status") return "auth-status";
  if (url.pathname === "/api/history/local-user") return "history-directory";
  if (
    url.pathname.startsWith("/api/image-edit-sources/") &&
    url.searchParams.get("preview") === "320-v1"
  ) {
    return "history-preview";
  }
  if (url.pathname.startsWith("/api/assets/")) return "history-original";
  if (/^\/api\/canvas\/[a-z0-9._-]+$/i.test(url.pathname)) {
    return "canvas-document";
  }
  return undefined;
}

function b5RequestCapture(page: Page) {
  let active: B5Capture | undefined;
  const records = new Map<object, {
    capture: B5Capture;
    completed: boolean;
    response?: B5ResponseLike;
    startedAtMs: number;
    kind: B5CaptureKind;
    url: string;
  }>();

  const finish = async (
    request: object,
    record: {
      capture: B5Capture;
      completed: boolean;
      response?: B5ResponseLike;
      startedAtMs: number;
      kind: B5CaptureKind;
      url: string;
    },
  ) => {
    if (record.completed) return;
    record.completed = true;
    let bytes: number | null = null;
    let status: number | null = null;
    const response = record.response;
    if (response) {
      status = response.status();
      try {
        // requestfinished is the body lifecycle boundary. Content-Length is
        // only a fallback for a body that Playwright cannot retrieve.
        bytes = (await response.body()).byteLength;
      } catch {
        const declared = Number(response.headers()["content-length"]);
        if (Number.isSafeInteger(declared) && declared >= 0) bytes = declared;
      }
    }
    const completedAtMs = performance.now();
    record.capture.responses.push({
      bytes,
      completedAtMs,
      durationMs: completedAtMs - record.startedAtMs,
      kind: record.kind,
      startedAtMs: record.startedAtMs,
      status,
      url: record.url,
    });
    record.capture.pending -= 1;
    record.capture.inFlight = Math.max(0, record.capture.inFlight - 1);
    records.delete(request);
  };

  page.on("request", (request) => {
    if (!active || request.method() !== "GET") return;
    const kind = b5RequestKind(request.url(), request.resourceType());
    if (!kind) return;
    const startedAtMs = performance.now();
    const record = {
      capture: active,
      completed: false,
      kind,
      startedAtMs,
      url: request.url(),
    };
    records.set(request as object, record);
    active.pending += 1;
    active.inFlight += 1;
    active.maxConcurrent = Math.max(active.maxConcurrent, active.inFlight);
    active.requestCount += 1;
    active.requestUrls.push(request.url());
  });
  page.on("response", (response) => {
    const request = response.request() as object;
    const record = records.get(request);
    if (record) record.response = response;
  });
  page.on("requestfinished", (request) => {
    const key = request as object;
    const record = records.get(key);
    if (record) void finish(key, record);
  });
  page.on("requestfailed", (request) => {
    const key = request as object;
    const record = records.get(key);
    if (record) void finish(key, record);
  });

  return {
    begin(label: string, network: B5NetworkGroup): B5Capture {
      if (active?.pending) {
        throw new Error(`B5 capture still has ${active.pending} pending requests`);
      }
      const capture: B5Capture = {
        browserHttpCache: "disabled-by-safe-test-context-route",
        inFlight: 0,
        label,
        maxConcurrent: 0,
        network,
        pending: 0,
        requestCount: 0,
        requestUrls: [],
        responses: [],
        startedAtMs: performance.now(),
      };
      active = capture;
      return capture;
    },
    async finish(capture: B5Capture) {
      const deadline = Date.now() + 10_000;
      while (capture.pending > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (capture.pending > 0) {
        throw new Error(`B5 capture timed out with ${capture.pending} pending requests`);
      }
      if (active === capture) active = undefined;
    },
  };
}

function b5P95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length > 0
    ? sorted[Math.ceil(sorted.length * 0.95) - 1]!
    : null;
}

function b5PreviewAssetId(rawUrl: string) {
  const url = new URL(rawUrl);
  const prefix = "/api/image-edit-sources/";
  if (!url.pathname.startsWith(prefix)) return undefined;
  return decodeURIComponent(url.pathname.slice(prefix.length));
}

function b5InvalidCaptureEvidence(
  capture: B5Capture,
  label: string,
  error: unknown,
) {
  return {
    error: String(error),
    label,
    maxConcurrent: capture.maxConcurrent,
    pending: capture.pending,
    rawResponses: [...capture.responses],
    requestCount: capture.requestCount,
    requestUrls: [...capture.requestUrls],
    startedAtMs: capture.startedAtMs,
    valid: false,
  };
}

function b5MetricValue(
  metrics: Array<{ name: string; value: number }>,
  name: string,
) {
  return metrics.find((metric) => metric.name === name)?.value;
}

async function readB5RuntimeEvidence(page: Page): Promise<B5RuntimeEvidence> {
  const source: string[] = [];
  let jsHeapUsedBytes: number | undefined;
  let jsHeapTotalBytes: number | undefined;
  let jsHeapLimitBytes: number | undefined;
  try {
    const memory = await page.evaluate(() => {
      const value = (performance as Performance & {
        memory?: {
          jsHeapSizeLimit: number;
          totalJSHeapSize: number;
          usedJSHeapSize: number;
        };
      }).memory;
      return value
        ? {
            jsHeapLimitBytes: value.jsHeapSizeLimit,
            jsHeapTotalBytes: value.totalJSHeapSize,
            jsHeapUsedBytes: value.usedJSHeapSize,
          }
        : undefined;
    });
    if (memory) {
      source.push("performance.memory");
      jsHeapLimitBytes = memory.jsHeapLimitBytes;
      jsHeapTotalBytes = memory.jsHeapTotalBytes;
      jsHeapUsedBytes = memory.jsHeapUsedBytes;
    }
  } catch {
    // Some browsers expose neither performance.memory nor a usable page.
  }

  let taskDurationMs: number | undefined;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Performance.enable");
    const result = await session.send("Performance.getMetrics") as {
      metrics?: Array<{ name: string; value: number }>;
    };
    const taskDuration = b5MetricValue(result.metrics ?? [], "TaskDuration");
    if (typeof taskDuration === "number") {
      source.push("CDP.Performance.TaskDuration");
      taskDurationMs = taskDuration * 1_000;
    }
    const heapUsed = b5MetricValue(result.metrics ?? [], "JSHeapUsedSize");
    const heapTotal = b5MetricValue(result.metrics ?? [], "JSHeapTotalSize");
    if (typeof heapUsed === "number") jsHeapUsedBytes ??= heapUsed;
    if (typeof heapTotal === "number") jsHeapTotalBytes ??= heapTotal;
    await session.detach();
  } catch {
    // Firefox/WebKit and restricted Chromium contexts can lack CDP metrics.
  }
  return {
    jsHeapLimitBytes,
    jsHeapTotalBytes,
    jsHeapUsedBytes,
    taskDurationMs,
    source,
  };
}

function b5RuntimeDelta(
  before: B5RuntimeEvidence,
  after: B5RuntimeEvidence,
): B5RuntimeEvidence {
  const delta =
    before.taskDurationMs !== undefined && after.taskDurationMs !== undefined
      ? Math.max(0, after.taskDurationMs - before.taskDurationMs)
      : undefined;
  return {
    ...after,
    ...(delta === undefined ? {} : { taskDurationMs: delta }),
    source: [...new Set([...before.source, ...after.source])],
  };
}

async function clearB5BrowserCache(page: Page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.clearBrowserCache");
    await session.detach();
    return "cdp-cleared" as const;
  } catch {
    return "unavailable" as const;
  }
}

async function requireB5ColdCacheReset(page: Page, label: string) {
  const cacheReset = await clearB5BrowserCache(page);
  if (cacheReset !== "cdp-cleared") {
    throw new Error(`${label}: cold sample was not measured after clearing browser cache`);
  }
  return cacheReset;
}

async function installB5ControlledNetwork(
  context: BrowserContext,
  page: Page,
  transportResets: Array<{ url: string; startedAtMs: number; failedAtMs: number; error: "ECONNRESET"; retry: 1 }>,
) {
  const origin = new URL(page.url()).origin;
  const patterns = [`${origin}/**`];
  let nextAvailableAtMs = performance.now();
  const handler = async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/updates") {
      // The update stream is a real SSE connection. Falling through preserves
      // its open body; it is intentionally excluded from B5 byte timing.
      await route.fallback();
      return;
    }
    const startedAtMs = performance.now();
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = await route.fetch();
    } catch (error) {
      // A reused test transport can lose its connection. Retry an idempotent
      // GET once, retaining the reset and all elapsed time in the evidence.
      // HTTP errors, writes and a second transport failure are never retried.
      if (route.request().method() !== "GET" || !String(error).includes("ECONNRESET")) throw error;
      const reset = { url: route.request().url(), startedAtMs, failedAtMs: performance.now(), error: "ECONNRESET" as const, retry: 1 as const };
      transportResets.push(reset);
      console.info(`[m79-b5-transport-reset] ${JSON.stringify(reset)}`);
      response = await route.fetch();
    }
    const body = await response.body();
    const transferMs = (body.byteLength * 8 / 50_000_000) * 1_000;
    const eligibleAtMs = performance.now() + 50;
    const slotStartMs = Math.max(eligibleAtMs, nextAvailableAtMs);
    // Latency is shared by concurrent requests, while response bytes consume
    // one serialized 50Mbps link instead of getting an independent delay.
    nextAvailableAtMs = slotStartMs + transferMs;
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.ceil(Math.max(0, nextAvailableAtMs - performance.now())),
    ));
    await route.fulfill({ body, response });
  };
  for (const pattern of patterns) await context.route(pattern, handler);
  return async () => {
    for (const pattern of patterns) await context.unroute(pattern, handler);
  };
}

async function createB5HistorySample(
  request: APIRequestContext,
  imageBytes: Buffer,
  label: string,
  temporaryAssetIds: Set<string>,
) {
  await request.delete("/api/history/local-user");
  const uploads: B5UploadEvidence[] = [];
  const ids = Array.from({ length: b5HistoryItemCount }, (_, index) =>
    `m79-perf-${label}-${index + 1}-${randomUUID()}`,
  );
  for (const [index, assetId] of ids.entries()) {
    temporaryAssetIds.add(assetId);
    const uploadStarted = performance.now();
    const uploaded = await request.post(`/api/assets/${assetId}`, {
      data: imageBytes,
      headers: {
        "Content-Type": "image/png",
        "X-File-Name": "m79-synthetic-history.png",
      },
    });
    const uploadMs = performance.now() - uploadStarted;
    expect(uploaded.status()).toBe(201);
    const historyStarted = performance.now();
    const history = await request.post("/api/history/local-user", {
      data: {
        id: assetId,
        kind: "image",
        label: `M79 合成历史 ${index + 1}`,
        preview: `/api/assets/${assetId}`,
      },
    });
    uploads.push({
      assetBytes: imageBytes.byteLength,
      assetId,
      historyMs: performance.now() - historyStarted,
      historyStatus: history.status(),
      uploadMs,
      uploadStatus: uploaded.status(),
    });
    expect(history.status()).toBe(201);
  }
  const directory = await request.get(
    "/api/history/local-user?kind=image&limit=60&order=newest",
  );
  expect(directory.ok()).toBeTruthy();
  const page = await directory.json() as { items?: unknown[] };
  expect(page.items).toHaveLength(b5HistoryItemCount);
  return { ids, uploads };
}

async function deleteB5HistorySample(
  request: APIRequestContext,
  temporaryAssetIds: Set<string>,
) {
  await request.delete("/api/history/local-user");
  for (const assetId of temporaryAssetIds) {
    const response = await request.delete(`/api/assets/${assetId}`);
    expect([204, 404]).toContain(response.status());
    temporaryAssetIds.delete(assetId);
  }
}

function b5InstallPageTimingTracker() {
  const host = window as typeof window & {
    __m79B5Timing?: {
      startHistory: () => void;
      waitForHistory: () => Promise<{
        firstImageMs: number;
        firstScreenMs: number;
        startEpochMs: number;
      }>;
      waitForReady: () => Promise<{
        epochMs: number;
        navigationEpochMs: number;
        nowMs: number;
      }>;
    };
  };
  if (host.__m79B5Timing) return;

  type ReadyRecord = {
    epochMs: number;
    navigationEpochMs: number;
    nowMs: number;
  };
  type HistoryRun = {
    done: boolean;
    firstImageMs?: number;
    firstScreenMs?: number;
    images: HTMLImageElement[];
    allDecoded: boolean;
    decodeBatchPending: boolean;
    firstImageScheduled: boolean;
    firstScreenScheduled: boolean;
    promise: Promise<{
      firstImageMs: number;
      firstScreenMs: number;
      startEpochMs: number;
    }>;
    resolve: (value: {
      firstImageMs: number;
      firstScreenMs: number;
      startEpochMs: number;
    }) => void;
    reject: (reason?: unknown) => void;
    startMs: number;
    observer?: MutationObserver;
    timer?: number;
  };

  let readyRecord: ReadyRecord | undefined;
  const readyWaiters: Array<(value: ReadyRecord) => void> = [];
  let readyFrameScheduled = false;
  let historyRun: HistoryRun | undefined;
  let historyFrameScheduled = false;
  const decodeReady = new WeakSet<HTMLImageElement>();
  const decodePending = new WeakMap<HTMLImageElement, Promise<boolean>>();

  const readyCondition = () => {
    const world = document.querySelector('[data-testid="canvas-world"]');
    const addNode = document.querySelector('[data-testid="add-node"]') as
      HTMLButtonElement | null;
    return Boolean(
      world?.getAttribute("data-persistence-ready") === "true" &&
      addNode &&
      !addNode.disabled &&
      addNode.getAttribute("aria-disabled") !== "true",
    );
  };

  const recordReady = () => {
    if (readyRecord || !readyCondition()) return;
    const nowMs = performance.now();
    readyRecord = {
      epochMs: performance.timeOrigin + nowMs,
      navigationEpochMs: performance.timeOrigin,
      nowMs,
    };
    for (const waiter of readyWaiters.splice(0)) waiter(readyRecord);
    readyObserver.disconnect();
  };

  const checkReady = () => {
    if (readyRecord || readyFrameScheduled || !readyCondition()) return;
    readyFrameScheduled = true;
    window.requestAnimationFrame(() => {
      readyFrameScheduled = false;
      if (readyCondition()) recordReady();
      else checkReady();
    });
  };

  const readyObserver = new MutationObserver(checkReady);
  readyObserver.observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  checkReady();

  const waitForReady = () => {
    if (readyRecord) return Promise.resolve(readyRecord);
    return new Promise<ReadyRecord>((resolve, reject) => {
      const waiter = (record: ReadyRecord) => {
        window.clearTimeout(timer);
        resolve(record);
      };
      const timer = window.setTimeout(() => {
        const index = readyWaiters.indexOf(waiter);
        if (index >= 0) readyWaiters.splice(index, 1);
        reject(new Error("B5 canvas ready timing exceeded 60s"));
      }, 60_000);
      readyWaiters.push(waiter);
    });
  };

  const ensureDecoded = (image: HTMLImageElement) => {
    if (decodeReady.has(image)) return Promise.resolve(true);
    const existing = decodePending.get(image);
    if (existing) return existing;
    const pending = (async () => {
      if (!image.complete || image.naturalWidth <= 0) return false;
      try {
        await image.decode();
      } catch {
        return false;
      }
      if (!image.complete || image.naturalWidth <= 0) return false;
      decodeReady.add(image);
      return true;
    })();
    decodePending.set(image, pending);
    void pending.finally(() => {
      if (decodePending.get(image) === pending) decodePending.delete(image);
    });
    return pending;
  };

  const isWithinHistoryViewport = (
    element: Element,
    root: Element | null,
    fullyInside: boolean,
  ) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (!root) return true;
    const rootRect = root.getBoundingClientRect();
    return fullyInside
      ? rect.top >= rootRect.top &&
          rect.bottom <= rootRect.bottom &&
          rect.left >= rootRect.left &&
          rect.right <= rootRect.right
      : rect.bottom > rootRect.top &&
          rect.top < rootRect.bottom &&
          rect.right > rootRect.left &&
          rect.left < rootRect.right;
  };

  const finishHistory = (run: HistoryRun) => {
    if (run.done || run.firstImageMs === undefined || run.firstScreenMs === undefined) {
      return;
    }
    run.done = true;
    if (run.timer !== undefined) window.clearTimeout(run.timer);
    run.observer?.disconnect();
    run.resolve({
      firstImageMs: run.firstImageMs,
      firstScreenMs: run.firstScreenMs,
      startEpochMs: performance.timeOrigin + run.startMs,
    });
  };

  const scheduleHistoryCheck = () => {
    if (!historyRun || historyRun.done || historyFrameScheduled) return;
    historyFrameScheduled = true;
    window.requestAnimationFrame(() => {
      historyFrameScheduled = false;
      const run = historyRun;
      if (!run || run.done) return;
      const browser = document.querySelector('[data-testid="history-browser"]');
      const cards = Array.from(browser?.querySelectorAll(".history-card") ?? []);
      const firstCards = cards.slice(0, 20);
      const root = browser?.querySelector('[data-testid="history-browser-content"]') ?? null;
      const firstImage = firstCards[0]?.querySelector("img");
      if (!run.firstImageScheduled && firstImage instanceof HTMLImageElement) {
        run.firstImageScheduled = true;
        void ensureDecoded(firstImage).then((decoded) => {
          if (historyRun !== run || run.done) return;
          if (!decoded) {
            run.firstImageScheduled = false;
            scheduleHistoryCheck();
            return;
          }
          window.requestAnimationFrame(() => {
            if (historyRun !== run || run.done) return;
            if (isWithinHistoryViewport(firstImage, root, false)) {
              run.firstImageMs = performance.now() - run.startMs;
              finishHistory(run);
            } else {
              run.firstImageScheduled = false;
              scheduleHistoryCheck();
            }
          });
        });
      }

      const images = firstCards
        .map((card) => card.querySelector("img"))
        .filter((image): image is HTMLImageElement => image instanceof HTMLImageElement);
      if (images.length === 20) {
        const sameImages =
          run.images.length === images.length &&
          images.every((image, index) => run.images[index] === image);
        if (!sameImages) {
          run.images = images;
          run.allDecoded = false;
        }
        if (!run.allDecoded && !run.decodeBatchPending) {
          run.decodeBatchPending = true;
          void Promise.all(images.map((image) => ensureDecoded(image))).then((states) => {
            run.decodeBatchPending = false;
            if (historyRun !== run || run.done) return;
            if (images.every((image, index) => run.images[index] === image)) {
              run.allDecoded = states.every(Boolean);
            }
            scheduleHistoryCheck();
          });
        }

        if (
          !run.firstScreenScheduled &&
          run.allDecoded &&
          firstCards.length === 20 &&
          firstCards.every((card) => isWithinHistoryViewport(card, root, true))
        ) {
          run.firstScreenScheduled = true;
          window.requestAnimationFrame(() => {
            if (historyRun !== run || run.done) return;
            const currentBrowser = document.querySelector('[data-testid="history-browser"]');
            const currentCards = Array.from(currentBrowser?.querySelectorAll(".history-card") ?? []).slice(0, 20);
            const currentRoot = currentBrowser?.querySelector('[data-testid="history-browser-content"]') ?? null;
            if (
              currentCards.length === 20 &&
              currentCards.every((card) => isWithinHistoryViewport(card, currentRoot, true)) &&
              run.images.every((image) => image.complete && image.naturalWidth > 0)
            ) {
              run.firstScreenMs = performance.now() - run.startMs;
              finishHistory(run);
            } else {
              run.firstScreenScheduled = false;
              scheduleHistoryCheck();
            }
          });
        }
      }
      if (!run.done) scheduleHistoryCheck();
    });
  };

  const startHistory = () => {
    historyRun?.observer?.disconnect();
    let resolve!: HistoryRun["resolve"];
    let reject!: HistoryRun["reject"];
    const promise = new Promise<{
      firstImageMs: number;
      firstScreenMs: number;
      startEpochMs: number;
    }>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const run: HistoryRun = {
      allDecoded: false,
      decodeBatchPending: false,
      done: false,
      firstImageScheduled: false,
      firstScreenScheduled: false,
      images: [],
      promise,
      reject,
      resolve,
      startMs: performance.now(),
    };
    historyRun = run;
    run.timer = window.setTimeout(() => {
      if (run.done) return;
      run.done = true;
      run.observer?.disconnect();
      run.reject(new Error("B5 history timing exceeded 90s"));
    }, 90_000);
    run.observer = new MutationObserver(scheduleHistoryCheck);
    run.observer.observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    scheduleHistoryCheck();
  };

  const waitForHistory = () => historyRun?.promise ?? Promise.reject(
    new Error("B5 history timing was not started"),
  );

  host.__m79B5Timing = {
    startHistory,
    waitForHistory,
    waitForReady,
  };
}

async function waitForB5CanvasReady(page: Page): Promise<B5PageReadyTiming> {
  const ready = await page.evaluate(async () => {
    const host = window as typeof window & {
      __m79B5Timing?: {
        waitForReady: () => Promise<B5PageReadyTiming>;
      };
    };
    if (!host.__m79B5Timing) throw new Error("B5 page timing tracker is not installed");
    return await host.__m79B5Timing.waitForReady();
  });
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  const addNode = page.getByTestId("add-node");
  await expect(addNode).toBeEnabled();
  return ready;
}

type B5CanvasProbeDocument = {
  nodes?: Array<{
    data?: { content?: unknown };
    id: string;
  }>;
};

async function readB5CanvasProbeDocument(
  request: APIRequestContext,
  projectId: string,
) {
  const response = await request.get(`/api/canvas/${projectId}`);
  if (!response.ok()) return undefined;
  return await response.json() as B5CanvasProbeDocument;
}

async function proveB5CanvasEditable(
  page: Page,
  request: APIRequestContext,
  projectId: string,
) {
  const world = page.getByTestId("canvas-world");
  const addNode = page.getByTestId("add-node");
  await addNode.click();
  const menu = page.getByTestId("add-node-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { exact: true, name: "文本" }).click();
  const node = page.locator(".react-flow__node-text.selected");
  await expect(node).toHaveCount(1);
  const nodeId = await node.getAttribute("data-id");
  if (!nodeId) throw new Error("B5 editable probe text node has no id");
  const content = node.getByTestId("canvas-node-text-content");
  await content.dblclick();
  const editor = node.getByTestId("text-node-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  const value = `m79 editable probe ${randomUUID()}`;
  await editor.fill(value);
  await expect(editor).toHaveText(value);
  await editor.evaluate((element) => (element as HTMLElement).blur());
  await expect.poll(async () => {
    const document = await readB5CanvasProbeDocument(request, projectId);
    return document?.nodes?.find((candidate) => candidate.id === nodeId)
      ?.data?.content;
  }).toBe(value);

  await editor.focus();
  await editor.press("Escape");
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await node.click();
  await page.keyboard.press("Delete");
  await expect(world).toHaveAttribute("data-node-count", "0");
  await expect.poll(async () => {
    const document = await readB5CanvasProbeDocument(request, projectId);
    return document?.nodes?.length ?? -1;
  }).toBe(0);
}

async function measureB5WorkspaceNewGroup(
  page: Page,
  request: APIRequestContext,
  captureController: ReturnType<typeof b5RequestCapture>,
  temporaryProjectIds: Set<string>,
  progress: B5ProgressReporter,
) {
  const samples: Array<B5NavigationSample & { projectId: string }> = [];
  const rawSamples: unknown[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 20; index += 1) {
      await page.goto("/canvas/projects");
      await expect(page.getByTestId("workspace-page")).toBeVisible();
      const createButton = page.getByTestId("workspace-new");
      await expect(createButton).toBeEnabled();
      const label = `workspace-new-loopback-${index + 1}`;
      const cacheReset = await requireB5ColdCacheReset(page, label);
      const capture = captureController.begin(label, "loopback");
      const before = await readB5RuntimeEvidence(page);
      const startedAtEpochMs = await page.evaluate(
        () => performance.timeOrigin + performance.now(),
      );
      let projectId: string | undefined;
      try {
        await createButton.click();
        const projectPathPattern = /^\/canvas\/(?!projects$)[a-z0-9._-]+$/i;
        await expect.poll(() => new URL(page.url()).pathname)
          .toMatch(projectPathPattern);
        const pathname = new URL(page.url()).pathname;
        const match = pathname.match(
          /^\/canvas\/(?!projects$)([a-z0-9._-]+)$/i,
        );
        if (!match?.[1]) throw new Error("Workspace 新建项目没有返回画布编号");
        projectId = decodeURIComponent(match[1]);
        temporaryProjectIds.add(projectId);
        const readyTiming = await waitForB5CanvasReady(page);
        const elapsedMs = readyTiming.epochMs - startedAtEpochMs;
        await proveB5CanvasEditable(page, request, projectId);
        await captureController.finish(capture);
        const after = await readB5RuntimeEvidence(page);
        const sample = {
          cacheReset,
          elapsedMs,
          label,
          maxConcurrent: capture.maxConcurrent,
          navigationStartEpochMs: readyTiming.navigationEpochMs,
          readyAtEpochMs: readyTiming.epochMs,
          network: "loopback",
          projectId,
          rawResponses: capture.responses,
          requestCount: capture.requestCount,
          requestUrls: capture.requestUrls,
          runtime: b5RuntimeDelta(before, after),
        } satisfies B5NavigationSample & { projectId: string };
        samples.push(sample);
        rawSamples.push({ valid: true, ...sample });
        progress.sample("workspace-new-loopback", samples.length, 20);
      } catch (error) {
        rawSamples.push(b5InvalidCaptureEvidence(capture, label, error));
        throw error;
      } finally {
        if (projectId) {
          await cleanupProject(request, projectId);
          temporaryProjectIds.delete(projectId);
        }
      }
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    progress.group(
      "workspace-new-loopback",
      failure === undefined ? "completed" : "failed",
      rawSamples,
      failure,
    );
  }
  return {
    browserHttpCache: "disabled-by-safe-test-context-route" as const,
    coverage: "loopback only; 20 independent projects created by the workspace button",
    editable: "persistence-ready plus a real text create, input, save and delete probe after timing",
    p95Ms: b5P95(samples.map((sample) => sample.elapsedMs)),
    samples,
  };
}

async function measureB5BlankNavigationGroup(
  page: Page,
  projectId: string,
  network: B5NetworkGroup,
  phase: "cold" | "warm",
  captureController: ReturnType<typeof b5RequestCapture>,
  request: APIRequestContext,
  progress: B5ProgressReporter,
) {
  const samples: B5NavigationSample[] = [];
  const rawSamples: unknown[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 20; index += 1) {
      const label = `blank-reopen-${network}-${phase}-${index + 1}`;
      const cacheReset = phase === "cold"
        ? await requireB5ColdCacheReset(page, label)
        : "not-requested" as const;
      const capture = captureController.begin(label, network);
      try {
        const before = await readB5RuntimeEvidence(page);
        await page.goto(`/canvas/${projectId}`);
        const readyTiming = await waitForB5CanvasReady(page);
        const elapsedMs = readyTiming.epochMs - readyTiming.navigationEpochMs;
        await proveB5CanvasEditable(page, request, projectId);
        await captureController.finish(capture);
        const after = await readB5RuntimeEvidence(page);
        const sample = {
          cacheReset,
          elapsedMs,
          label,
          maxConcurrent: capture.maxConcurrent,
        navigationStartEpochMs: readyTiming.navigationEpochMs,
        readyAtEpochMs: readyTiming.epochMs,
          network,
          rawResponses: capture.responses,
          requestCount: capture.requestCount,
          requestUrls: capture.requestUrls,
          runtime: b5RuntimeDelta(before, after),
        } satisfies B5NavigationSample;
        samples.push(sample);
        rawSamples.push({ valid: true, ...sample });
        progress.sample(`${network}-${phase}`, samples.length, 20);
      } catch (error) {
        rawSamples.push(b5InvalidCaptureEvidence(capture, label, error));
        throw error;
      }
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    progress.group(
      `blank-reopen-${network}-${phase}`,
      failure === undefined ? "completed" : "failed",
      rawSamples,
      failure,
    );
  }
  return {
    browserHttpCache: "disabled-by-safe-test-context-route" as const,
    network,
    phase,
    p95Ms: b5P95(samples.map((sample) => sample.elapsedMs)),
    samples,
  };
}

async function b5ImageDecodedAndRendered(image: Locator) {
  return image.evaluate(async (element) => {
    const imageElement = element as HTMLImageElement;
    if (!imageElement.complete || imageElement.naturalWidth <= 0) return false;
    try {
      await imageElement.decode();
    } catch {
      return false;
    }
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const rect = imageElement.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

async function countB5FirstScreenDecodedImages(cards: Locator) {
  return cards.evaluateAll(async (elements, firstScreenCount) => {
    const candidates = elements.slice(0, firstScreenCount).map((element) => ({
      element,
      image: element.querySelector("img") as HTMLImageElement | null,
    }));
    const decoded = await Promise.all(candidates.map(async ({ image }) => {
      if (!image || !image.complete || image.naturalWidth <= 0) return false;
      try {
        await image.decode();
        return true;
      } catch {
        return false;
      }
    }));
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const root = elements[0]?.closest(
      '[data-testid="history-browser-content"]',
    ) as HTMLElement | null;
    const rootRect = root?.getBoundingClientRect();
    return candidates.filter(({ element, image }, index) => {
      const rect = element.getBoundingClientRect();
      const withinRoot = !rootRect || (
        rect.top >= rootRect.top &&
        rect.bottom <= rootRect.bottom &&
        rect.left >= rootRect.left &&
        rect.right <= rootRect.right
      );
      return Boolean(
        decoded[index] &&
        image?.complete &&
        image.naturalWidth > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        withinRoot
      );
    }).length;
  }, b5FirstScreenCount);
}

async function measureB5HistorySample(
  page: Page,
  projectId: string,
  network: B5NetworkGroup,
  phase: "cold" | "warm",
  index: number,
  captureController: ReturnType<typeof b5RequestCapture>,
  request: APIRequestContext,
  assetIds: string[],
  rawSamples: unknown[],
) {
  const label = `history-${network}-${phase}-${index}`;
  const cacheReset = phase === "cold"
    ? await requireB5ColdCacheReset(page, label)
    : "not-requested" as const;
  const capture = captureController.begin(label, network);
  try {
    const before = await readB5RuntimeEvidence(page);
    await page.goto(`/canvas/${projectId}`);
    await waitForB5CanvasReady(page);
    await proveB5CanvasEditable(page, request, projectId);

  const historyStartedAtMs = performance.now();
  await page.evaluate(() => {
    const host = window as typeof window & {
      __m79B5Timing?: { startHistory: () => void };
    };
    if (!host.__m79B5Timing) throw new Error("B5 page timing tracker is not installed");
    host.__m79B5Timing.startHistory();
  });
  await page.getByTestId("history").click();
  await expect(page.getByTestId("history-panel")).toBeVisible();
  await page.getByRole("button", { name: "浏览全部历史" }).click();
  const browser = page.getByTestId("history-browser");
  await expect(browser).toBeVisible();
  await browser.getByRole("slider", { name: "历史缩略图大小" }).fill("80");
  const cards = browser.locator(".history-card");
  await expect(cards).toHaveCount(b5HistoryItemCount);
  await expect.poll(() => capture.responses.filter(
    (response) => response.kind === "history-directory" && response.status === 200,
  ).length).toBeGreaterThan(0);
  await expect.poll(() => b5ImageDecodedAndRendered(
    cards.first().locator("img"),
  )).toBe(true);
  await expect.poll(() => countB5FirstScreenDecodedImages(cards))
    .toBe(b5FirstScreenCount);
  const historyTiming = await page.evaluate(async () => {
    const host = window as typeof window & {
      __m79B5Timing?: {
        waitForHistory: () => Promise<{
          firstImageMs: number;
          firstScreenMs: number;
          startEpochMs: number;
        }>;
      };
    };
    if (!host.__m79B5Timing) throw new Error("B5 page timing tracker is not installed");
    return await host.__m79B5Timing.waitForHistory();
  });
  const firstImageVisibleMs = historyTiming.firstImageMs;
  const firstScreenVisibleMs = historyTiming.firstScreenMs;
  const directoryResponse = capture.responses.find(
    (response) => response.kind === "history-directory" && response.status === 200,
  );
  const firstScreenIds = await cards.evaluateAll((elements, firstScreenCount) =>
    elements.slice(0, firstScreenCount).map((element) =>
      element.getAttribute("data-history-id") ?? "",
    ),
    b5FirstScreenCount,
  );
  expect(firstScreenIds.every(Boolean)).toBeTruthy();
  expect(new Set(firstScreenIds).size).toBe(b5FirstScreenCount);
  expect(firstScreenIds.every((assetId) => assetIds.includes(assetId))).toBeTruthy();

  const firstCard = cards.first();
  const firstId = firstScreenIds[0]!;
  await firstCard.click();
  const preview = page.getByTestId("history-preview");
  await expect(preview).toBeVisible();
  const previewImage = preview.locator("img");
  await expect(previewImage).toHaveCount(1);
  await expect.poll(() => previewImage.evaluate((element) => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  })).toBe(true);
  const previewDialogEpochMs = await page.evaluate(
    () => performance.timeOrigin + performance.now(),
  );
  const previewDialogMs = previewDialogEpochMs - historyTiming.startEpochMs;
  const previewClose = preview.getByRole("button", { name: "关闭历史素材预览" });
  await previewClose.click();
  await browser.getByRole("button", { name: "关闭全部历史" }).click();
  await expect(browser).toHaveCount(0);
  await page.getByTestId("history").click();
  await expect(page.getByTestId("history-panel")).toHaveCount(0);

  await captureController.finish(capture);
  const after = await readB5RuntimeEvidence(page);
  const previewResponses = capture.responses.filter(
    (response) => response.kind === "history-preview" && response.status === 200,
  );
  const firstImageResponse = previewResponses.find((response) =>
    response.url.includes(`/api/image-edit-sources/${firstId}?preview=320-v1`),
  );
  const originalResponse = capture.responses.find(
    (response) =>
      response.kind === "history-original" &&
      response.status === 200 &&
      new URL(response.url).pathname === `/api/assets/${firstId}`,
  );
  const firstScreenResponseBytes = firstScreenIds.map((assetId) =>
    previewResponses.find((response) => b5PreviewAssetId(response.url) === assetId)?.bytes,
  );
  const firstScreenBytes = firstScreenResponseBytes.every(
    (bytes): bytes is number => typeof bytes === "number",
  )
    ? firstScreenResponseBytes.reduce((sum, bytes) => sum + bytes, 0)
    : null;
    return {
      assetIds,
      browserHttpCache: "disabled-by-safe-test-context-route" as const,
      cacheReset,
      firstImageResponseMs: firstImageResponse
        ? firstImageResponse.completedAtMs - historyStartedAtMs
        : null,
      firstImageVisibleMs,
      firstScreenBytes,
      firstScreenVisibleMs,
      historyDirectoryBytes: directoryResponse?.bytes ?? null,
      historyDirectoryMs: directoryResponse
        ? directoryResponse.completedAtMs - historyStartedAtMs
        : null,
      historyItemCount: b5HistoryItemCount,
      label,
      maxConcurrent: capture.maxConcurrent,
      network,
      previewDialogMs,
      previewOriginalBytes: originalResponse?.bytes ?? null,
      previewOriginalResponseMs: originalResponse
        ? originalResponse.completedAtMs - historyStartedAtMs
        : null,
      rawResponses: capture.responses,
      requestCount: capture.requestCount,
      requestUrls: capture.requestUrls,
      runtime: b5RuntimeDelta(before, after),
      firstScreenIds,
      previewCache: phase === "cold"
        ? "fresh-asset-ids" as const
        : "server-preview-cache-only" as const,
    } satisfies B5HistorySample;
  } catch (error) {
    rawSamples.push(b5InvalidCaptureEvidence(capture, label, error));
    throw error;
  }
}

async function runB5HistoryGroup(
  page: Page,
  projectId: string,
  request: APIRequestContext,
  imageBytes: Buffer,
  network: B5NetworkGroup,
  phase: "cold" | "warm",
  captureController: ReturnType<typeof b5RequestCapture>,
  temporaryAssetIds: Set<string>,
  progress: B5ProgressReporter,
) {
  const samples: B5HistorySample[] = [];
  const rawSamples: unknown[] = [];
  const setupUploads: B5UploadEvidence[] = [];
  let failure: unknown;
  try {
    if (phase === "cold") {
      const seenAssetIds = new Set<string>();
      for (let index = 0; index < 20; index += 1) {
        const setup = await createB5HistorySample(
          request,
          imageBytes,
          `${network}-cold-${index + 1}`,
          temporaryAssetIds,
        );
        expect(setup.ids).toHaveLength(b5HistoryItemCount);
        expect(new Set(setup.ids).size).toBe(b5HistoryItemCount);
        expect(setup.ids.filter((id) => seenAssetIds.has(id))).toEqual([]);
        for (const assetId of setup.ids) seenAssetIds.add(assetId);
        setupUploads.push(...setup.uploads);
        try {
          const sample = await measureB5HistorySample(
            page,
            projectId,
            network,
            phase,
            index + 1,
            captureController,
            request,
            setup.ids,
            rawSamples,
          );
          samples.push(sample);
          rawSamples.push({ valid: true, ...sample });
          progress.sample(`${network}-${phase}`, samples.length, 20);
        } finally {
          await deleteB5HistorySample(request, temporaryAssetIds);
        }
      }
    } else {
      const setup = await createB5HistorySample(
        request,
        imageBytes,
        `${network}-warm-shared`,
        temporaryAssetIds,
      );
      expect(setup.ids).toHaveLength(b5HistoryItemCount);
      expect(new Set(setup.ids).size).toBe(b5HistoryItemCount);
      setupUploads.push(...setup.uploads);
      const warmupCapture = captureController.begin(
        `history-${network}-warm-cache-seed`,
        network,
      );
      await page.goto(`/canvas/${projectId}`);
      await waitForB5CanvasReady(page);
      await proveB5CanvasEditable(page, request, projectId);
      await page.getByTestId("history").click();
      await expect(page.getByRole("button", { name: "浏览全部历史" })).toBeVisible();
      await page.getByRole("button", { name: "浏览全部历史" }).click();
      const warmBrowser = page.getByTestId("history-browser");
      await expect(warmBrowser).toBeVisible();
      await warmBrowser.getByRole("slider", { name: "历史缩略图大小" }).fill("80");
      const warmCards = warmBrowser.locator(".history-card");
      await expect(warmCards).toHaveCount(b5HistoryItemCount);
      await expect.poll(() => countB5FirstScreenDecodedImages(warmCards))
        .toBe(b5FirstScreenCount);
      await captureController.finish(warmupCapture);
      await page.getByTestId("history-browser")
        .getByRole("button", { name: "关闭全部历史" }).click();
      await page.getByTestId("history").click();
      for (let index = 0; index < 20; index += 1) {
        const sample = await measureB5HistorySample(
          page,
          projectId,
          network,
          phase,
          index + 1,
          captureController,
          request,
          setup.ids,
          rawSamples,
        );
        samples.push(sample);
        rawSamples.push({ valid: true, ...sample });
        progress.sample(`${network}-${phase}`, samples.length, 20);
      }
      await deleteB5HistorySample(request, temporaryAssetIds);
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    progress.group(
      `history-${network}-${phase}`,
      failure === undefined ? "completed" : "failed",
      rawSamples,
      failure,
    );
  }
  return {
    browserHttpCache: "disabled-by-safe-test-context-route" as const,
    firstScreenDefinition: b5FirstScreenDefinition,
    firstScreenTargetBytes: 2 * 1024 * 1024,
    firstScreenTargetMs: 1_000,
    network,
    phase,
    previewCache: phase === "cold"
      ? "fresh-asset-ids"
      : "server-preview-cache-only",
    p95FirstScreenMs: b5P95(samples.map((sample) => sample.firstScreenVisibleMs)),
    p95FirstScreenBytes: (() => {
      const byteSamples = samples
        .map((sample) => sample.firstScreenBytes)
        .filter((bytes): bytes is number => bytes !== null);
      return byteSamples.length === samples.length ? b5P95(byteSamples) : null;
    })(),
    firstScreenByteSamplesComplete: samples.filter(
      (sample) => sample.firstScreenBytes !== null,
    ).length,
    setupUploads,
    samples,
  };
}

test("PERF built blank canvas cold and warm navigation does not fetch hidden template graphs", async ({
  page,
  context,
}) => {
  // The real HTTP history run creates 27 local PNG assets for every cold sample
  // so that a service preview cache hit cannot be mistaken for a cold miss.
  test.setTimeout(15 * 60_000);
  await page.addInitScript(b5InstallPageTimingTracker);
  await page.evaluate(b5InstallPageTimingTracker);
  await page.setViewportSize({ height: 720, width: 1_280 });
  const display = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  expect(display).toEqual({ devicePixelRatio: 2, height: 720, width: 1_280 });
  const imageBytes = await readFile(b5ReferenceImagePath);
  const created = await context.request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = await created.json() as { id: string };
  const temporaryAssetIds = new Set<string>();
  const temporaryProjectIds = new Set<string>();
  const captureController = b5RequestCapture(page);
  const controlledTransportResets: Array<{ url: string; startedAtMs: number; failedAtMs: number; error: "ECONNRESET"; retry: 1 }> = [];
  const templateReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/templates")) templateReads.push(request.url());
  });
  const evidence: {
    blank?: Record<string, unknown>;
    display: typeof display;
    fixture: { bytes: number; path: string; source: "synthetic" };
    history?: Record<string, unknown>;
    targets: Record<string, number>;
    templateReads: string[];
  } = {
    display,
    fixture: {
      bytes: imageBytes.byteLength,
      path: b5ReferenceImagePath,
      source: "synthetic",
    },
    targets: {
      blankColdP95Ms: 2_000,
      blankWarmP95Ms: 1_000,
      historyFirstScreenBytesP95: 2 * 1024 * 1024,
      historyFirstScreenP95Ms: 1_000,
    },
    templateReads,
  };
  const rawGroups = new Map<string, {
    error?: string;
    samples: readonly unknown[];
    status: "completed" | "failed";
  }>();
  const progress: B5ProgressReporter = {
    group(group, status, samples, error) {
      const record = {
        error: error === undefined ? undefined : String(error),
        samples,
        status,
      } satisfies {
        error?: string;
        samples: readonly unknown[];
        status: "completed" | "failed";
      };
      rawGroups.set(group, record);
      console.info(`[m79-b5-raw] ${JSON.stringify({ group, ...record })}`);
    },
    sample(group, completed, total) {
      if (completed % 5 === 0) {
        console.info(`[m79-b5-progress] ${JSON.stringify({ group, completed, total })}`);
      }
    },
    failed(groups) {
      console.info(`[m79-b5-finally] ${JSON.stringify({
        groups,
        rawGroups: [...rawGroups.entries()].map(([group, record]) => ({
          group,
          ...record,
        })),
        status: "failed",
      })}`);
    },
  };
  let testFailure: unknown;

  try {
    await test.step("B5-01 新建和打开空白画布的 loopback 冷暖测量", async () => {
      const workspaceNewLoopback = await measureB5WorkspaceNewGroup(
        page,
        context.request,
        captureController,
        temporaryProjectIds,
        progress,
      );
      const blankLoopbackCold = await measureB5BlankNavigationGroup(
        page,
        project.id,
        "loopback",
        "cold",
        captureController,
        context.request,
        progress,
      );
      const blankLoopbackWarm = await measureB5BlankNavigationGroup(
        page,
        project.id,
        "loopback",
        "warm",
        captureController,
        context.request,
        progress,
      );
      evidence.blank = {
        workspaceNewLoopback,
        blankReopenLoopback: {
          cold: blankLoopbackCold,
          warm: blankLoopbackWarm,
          editable: "persistence-ready plus a real text create, input, save and delete probe after timing",
        },
      };
    });

    await test.step("B5-02 成品 HTTP 到 history 目录、预览和 20 张首屏", async () => {
      const historyLoopbackCold = await runB5HistoryGroup(
        page,
        project.id,
        context.request,
        imageBytes,
        "loopback",
        "cold",
        captureController,
        temporaryAssetIds,
        progress,
      );
      const historyLoopbackWarm = await runB5HistoryGroup(
        page,
        project.id,
        context.request,
        imageBytes,
        "loopback",
        "warm",
        captureController,
        temporaryAssetIds,
        progress,
      );
      evidence.history = {
        loopback: {
          cold: historyLoopbackCold,
          warm: historyLoopbackWarm,
        },
      };
    });

    await test.step("B5-03 50Mbps/50ms 受控网络的冷暖测量", async () => {
      const removeControlledNetwork = await installB5ControlledNetwork(
        context,
        page,
        controlledTransportResets,
      );
      try {
        const blankControlledCold = await measureB5BlankNavigationGroup(
          page,
          project.id,
          "controlled-50mbps-50ms",
          "cold",
          captureController,
          context.request,
          progress,
        );
        const blankControlledWarm = await measureB5BlankNavigationGroup(
          page,
          project.id,
          "controlled-50mbps-50ms",
          "warm",
          captureController,
          context.request,
          progress,
        );
        const historyControlledCold = await runB5HistoryGroup(
          page,
          project.id,
          context.request,
          imageBytes,
          "controlled-50mbps-50ms",
          "cold",
          captureController,
          temporaryAssetIds,
          progress,
        );
        const historyControlledWarm = await runB5HistoryGroup(
          page,
          project.id,
          context.request,
          imageBytes,
          "controlled-50mbps-50ms",
          "warm",
          captureController,
          temporaryAssetIds,
          progress,
        );
        evidence.blank = {
          ...(evidence.blank ?? {}),
          blankReopenControlled: {
            cold: blankControlledCold,
            warm: blankControlledWarm,
            editable: "persistence-ready plus a real text create, input, save and delete probe after timing",
          },
        };
        evidence.history = {
          ...(evidence.history ?? {}),
          controlled: {
            cold: historyControlledCold,
            warm: historyControlledWarm,
          },
        };
      } finally {
        await removeControlledNetwork();
      }
    });
  } catch (error) {
    testFailure = error;
    throw error;
  } finally {
    if (testFailure !== undefined) {
      progress.failed([...rawGroups.keys()]);
    }
    await deleteB5HistorySample(context.request, temporaryAssetIds);
    for (const temporaryProjectId of temporaryProjectIds) {
      await cleanupProject(context.request, temporaryProjectId);
    }
    await cleanupProject(context.request, project.id);
  }

  expect(templateReads).toEqual([]);
  const finalEvidence = {
    ...evidence,
    cacheSemantics: {
      coldPreviewMiss: "27 fresh synthetic asset ids per cold sample; cache clear required",
      warmPreview: "same assets and server preview cache after an unrecorded seed",
      warmSource: "server-preview-cache-only",
      browserHttpCache: "disabled-by-safe-test-context-route; warm is not browser-cache evidence",
    },
    controlledNetworkModel: {
      bandwidthMbps: 50,
      latencyMs: 50,
      excluded: "/api/updates SSE via route.fallback; not included in byte timing",
      implementation: "one shared response scheduler across routed loopback same-origin responses",
      transportResetRetries: controlledTransportResets,
      scope: "same loopback origin including document, scripts, styles and API responses",
    },
    coverage: {
      history: "loopback and controlled groups, cold and warm 20 samples each",
      newProject: "loopback only, 20 independent UI-created projects",
      blankReopen: "loopback and controlled groups, cold and warm 20 samples each",
    },
    firstScreen: {
      count: b5FirstScreenCount,
      definition: b5FirstScreenDefinition,
      zoom: 80,
    },
    performanceEvidence: "b5-history-http-browser-measurement-only",
    report: "raw samples are retained; targets are reported without an automatic PASS",
    requestEvidenceScope: "GET HTML, scripts, styles, auth status, canvas document, history directory, image-edit preview and original preview; raw URLs retained per sample",
    templateReads,
    temporaryAssetsDeleted: temporaryAssetIds.size === 0,
  };
  test.info().annotations.push({
    type: "b5-perf-evidence",
    description: JSON.stringify(finalEvidence),
  });
  console.info(JSON.stringify(finalEvidence));
});
