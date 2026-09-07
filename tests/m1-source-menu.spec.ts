import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "./safe-test";

type Request = Awaited<ReturnType<Page["waitForRequest"]>>;
type BrowserRoute = Parameters<Parameters<Page["route"]>[1]>[0];

type SourceKind = "text" | "image" | "video" | "audio";
type ActionNodeKind = "text" | "image" | "video" | "audio";

type PersistedNode = {
  data?: Record<string, unknown>;
  id: string;
  parentId?: string;
  position?: { x: number; y: number };
  style?: Record<string, unknown>;
  type?: string;
};

type PersistedEdge = {
  data?: Record<string, unknown>;
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  type?: string;
};

type PersistedCanvas = {
  edges: PersistedEdge[];
  loadToken?: string;
  nodes: PersistedNode[];
  revision?: number;
};

type CanvasMutationWrite = {
  body: Record<string, unknown>;
  method: string;
  url: string;
};

type MenuAction = {
  label: string;
  nodeType: ActionNodeKind;
};

const sourceActionContracts: Record<SourceKind, {
  disabled: readonly string[];
  enabled: readonly MenuAction[];
}> = {
  text: {
    disabled: [],
    enabled: [
      { label: "文本生成", nodeType: "text" },
      { label: "图片生成", nodeType: "image" },
      { label: "视频生成", nodeType: "video" },
      { label: "音频生成", nodeType: "audio" },
    ],
  },
  image: {
    disabled: ["图片编辑器", "3D 世界"],
    enabled: [
      { label: "文本生成", nodeType: "text" },
      { label: "图片生成", nodeType: "image" },
      { label: "视频生成", nodeType: "video" },
    ],
  },
  video: {
    disabled: ["音频生成", "视频编辑", "3D 世界"],
    enabled: [{ label: "文本生成", nodeType: "text" }],
  },
  audio: {
    disabled: ["数字人视频"],
    enabled: [{ label: "视频生成", nodeType: "video" }],
  },
};

function sourceNode(
  id: string,
  kind: SourceKind,
  position: { x: number; y: number },
  parentId?: string,
): PersistedNode {
  const label = kind[0].toUpperCase() + kind.slice(1);
  return {
    data: kind === "text"
      ? { content: "", label: "Text", title: "Text" }
      : { label, sourceKind: kind, title: label },
    id,
    ...(parentId ? { parentId } : {}),
    position,
    style: kind === "text"
      ? { height: 250, width: 250 }
      : kind === "image"
        ? { height: 250, width: 250 }
        : { height: 250, width: 444 },
    type: kind,
  };
}

async function readPersistedCanvas(
  request: APIRequestContext,
  projectId: string,
): Promise<PersistedCanvas> {
  const response = await request.get(`/api/canvas/${projectId}`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as PersistedCanvas;
}

async function seedPersistedCanvas(
  request: APIRequestContext,
  projectId: string,
  nodes: PersistedNode[],
  edges: PersistedEdge[] = [],
) {
  const baseline = await readPersistedCanvas(request, projectId);
  const saved = await request.put(`/api/canvas/${projectId}`, {
    data: {
      edges,
      nodes,
      observedLoadToken: baseline.loadToken,
      observedRevision: baseline.revision,
      revision: baseline.revision,
      saveAttemptId: randomUUID(),
      saveSequence: 1,
      saveSessionId: randomUUID(),
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();
}

async function createPersistedSourceCanvas(
  request: APIRequestContext,
  kind: SourceKind,
  grouped = false,
) {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const projectId = ((await created.json()) as { id: string }).id;
  const sourceId = `${kind}-source-${randomUUID()}`;
  let groupId: string | undefined;
  const nodes: PersistedNode[] = [];
  if (grouped) {
    groupId = `group-${randomUUID()}`;
    nodes.push({
      data: { label: "Group", title: "来源回归组" },
      id: groupId,
      position: { x: 80, y: 180 },
      style: { height: 330, width: 940 },
      type: "group",
    });
    nodes.push(sourceNode(sourceId, kind, { x: 24, y: 36 }, groupId));
  } else {
    nodes.push(sourceNode(sourceId, kind, { x: 120, y: 220 }));
  }
  await seedPersistedCanvas(request, projectId, nodes);
  return { groupId, projectId, sourceId };
}

async function createPersistedSourcePairCanvas(request: APIRequestContext) {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const projectId = ((await created.json()) as { id: string }).id;
  const imageSourceId = `image-source-${randomUUID()}`;
  const videoSourceId = `video-source-${randomUUID()}`;
  await seedPersistedCanvas(request, projectId, [
    sourceNode(imageSourceId, "image", { x: 120, y: 180 }),
    sourceNode(videoSourceId, "video", { x: 650, y: 180 }),
  ]);
  return { imageSourceId, projectId, videoSourceId };
}

async function assertSaveUnconfirmed(page: Page, timeout = 8_000) {
  await expect.poll(async () => await page.evaluate(() => {
    const texts = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="save-conflict"], [data-testid="workflow-run-toast"]',
      ),
    ].map((element) => element.textContent ?? "");
    return texts.join(" ");
  }), { timeout }).toMatch(/保存失败|保存尚未确认|保存结果尚未确认/);
}

async function cleanupPersistedProject(
  request: APIRequestContext,
  projectId: string,
) {
  for (const path of [`/api/canvas/${projectId}`, `/api/projects/${projectId}`]) {
    const response = await request.delete(path);
    expect([200, 204, 404]).toContain(response.status());
  }
}

async function blankCanvasPoint(world: Locator) {
  return await world.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const left = Math.max(bounds.left + 40, 40);
    const right = Math.min(bounds.right - 40, window.innerWidth - 40);
    const top = Math.max(bounds.top + 40, 40);
    const bottom = Math.min(bounds.bottom - 40, window.innerHeight - 40);
    for (let y = bottom; y >= top; y -= 24) {
      for (let x = right; x >= left; x -= 24) {
        const target = document.elementFromPoint(x, y);
        if (
          target?.closest("[data-testid=canvas-world]") === element &&
          !target.closest(".react-flow__node, [role=menu], button, input, textarea")
        ) {
          return { x, y };
        }
      }
    }
    throw new Error("No blank canvas point available for source menu regression");
  });
}

async function dragSourceToBlank(
  page: Page,
  source: Locator,
  world: Locator,
) {
  await source.hover();
  const handle = source.locator(
    ".react-flow__handle.source .node-handle-hit",
  );
  const from = await handle.boundingBox();
  if (!from) throw new Error("Source handle is not measurable");
  const drop = await blankCanvasPoint(world);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
  const menu = page.getByTestId("source-connect-menu");
  await expect(menu).toBeVisible();
  return { drop, menu };
}

async function assertTargetPositionMatchesRawDrop(
  world: Locator,
  rawDrop: { x: number; y: number },
  created: PersistedNode,
  nodeType: ActionNodeKind,
) {
  const bounds = await world.boundingBox();
  expect(bounds).toBeTruthy();
  const zoom = Number(
    (await world.getAttribute("data-viewport-zoom")) ?? "1",
  );
  const viewportX = Number(
    (await world.getAttribute("data-viewport-x")) ?? "0",
  );
  const viewportY = Number(
    (await world.getAttribute("data-viewport-y")) ?? "0",
  );
  const size = nodeType === "video" || nodeType === "audio"
    ? { height: 250, width: 444 }
    : { height: 250, width: 250 };
  const expected = {
    x: (rawDrop.x - bounds!.x - viewportX) / zoom - size.width / 2,
    y: (rawDrop.y - bounds!.y - viewportY) / zoom - size.height / 2,
  };
  expect(created.position).toBeDefined();
  expect(Number.isFinite(created.position?.x)).toBe(true);
  expect(Number.isFinite(created.position?.y)).toBe(true);
  expect(Math.abs(Number(created.position?.x) - expected.x)).toBeLessThan(2);
  expect(Math.abs(Number(created.position?.y) - expected.y)).toBeLessThan(2);
}

function menuItem(menu: Locator, label: string) {
  return menu.locator('[role="menuitem"]').filter({ hasText: label });
}

async function assertSourceMenuContract(menu: Locator, kind: SourceKind) {
  const contract = sourceActionContracts[kind];
  for (const action of contract.enabled) {
    const item = menuItem(menu, action.label);
    await expect(item).toHaveCount(1);
    await expect(item).toBeEnabled();
  }
  for (const label of contract.disabled) {
    const item = menuItem(menu, label);
    await expect(item).toHaveCount(1);
    await expect(item).toBeDisabled();
    // Existing capability menus use title as the user-visible disabled reason.
    await expect(item).toHaveAttribute("title", /\S+/);
  }
}

async function waitForCreatedGraph(
  request: APIRequestContext,
  projectId: string,
  before: PersistedCanvas,
  sourceId: string,
  nodeType: ActionNodeKind,
) {
  await expect.poll(async () => {
    const current = await readPersistedCanvas(request, projectId);
    const beforeIds = new Set(before.nodes.map((node) => node.id));
    const created = current.nodes.find(
      (node) => !beforeIds.has(node.id) && node.type === nodeType,
    );
    return Boolean(
      created && current.edges.some(
        (edge) => edge.source === sourceId && edge.target === created.id,
      ),
    );
  }, { timeout: 15_000 }).toBe(true);

  const current = await readPersistedCanvas(request, projectId);
  const beforeIds = new Set(before.nodes.map((node) => node.id));
  const created = current.nodes.find(
    (node) => !beforeIds.has(node.id) && node.type === nodeType,
  );
  if (!created) throw new Error("Persisted source action did not create a target node");
  const edge = current.edges.find(
    (candidate) => candidate.source === sourceId && candidate.target === created.id,
  );
  if (!edge) throw new Error("Persisted source action did not create a source edge");
  return { current, created, edge };
}

function watchCanvasWrites(page: Page, projectId: string) {
  const writes: CanvasMutationWrite[] = [];
  const canvasPath = `/api/canvas/${projectId}`;
  const commandPath = `/api/canvases/${projectId}/commands`;
  const listener = (request: Request) => {
    const url = new URL(request.url());
    if (
      !((request.method() === "PUT" && url.pathname === canvasPath) ||
        (request.method() === "POST" && url.pathname === commandPath))
    ) return;
    try {
      const body = JSON.parse(request.postData() ?? "") as Record<string, unknown>;
      writes.push({ body, method: request.method(), url: url.pathname });
    } catch {
      // A non-JSON write cannot prove or disprove the atomic graph contract.
    }
  };
  page.on("request", listener);
  return {
    dispose: () => page.off("request", listener),
    writes,
  };
}

function watchCanvasReads(page: Page, projectId: string) {
  const reads: string[] = [];
  const canvasPath = `/api/canvas/${projectId}`;
  const listener = (request: Request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === canvasPath) {
      reads.push(request.url());
    }
  };
  page.on("request", listener);
  return {
    dispose: () => page.off("request", listener),
    reads,
  };
}

async function installCanvasLoadStateWatch(page: Page) {
  await page.addInitScript(() => {
    const states: string[] = [];
    const record = () => {
      const world = document.querySelector<HTMLElement>(
        '[data-testid="canvas-world"]',
      );
      const value = world?.getAttribute("data-persistence-ready");
      if (value && states.at(-1) !== value) states.push(value);
    };
    const observer = new MutationObserver(record);
    observer.observe(document, {
      attributes: true,
      attributeFilter: ["data-persistence-ready"],
      childList: true,
      subtree: true,
    });
    record();
    (window as Window & { __m1CanvasLoadStates?: string[] }).__m1CanvasLoadStates =
      states;
  });
}

async function canvasLoadStates(page: Page) {
  return await page.evaluate(() =>
    (window as Window & { __m1CanvasLoadStates?: string[] })
      .__m1CanvasLoadStates ?? []
  );
}

async function assertStableCanvasPersistence(
  page: Page,
  world: Locator,
) {
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const states = await canvasLoadStates(page);
  const firstReadyStateIndex = states.indexOf("true");
  expect(firstReadyStateIndex).toBeGreaterThanOrEqual(0);
  expect(states[firstReadyStateIndex]).toBe("true");
  expect(states.slice(firstReadyStateIndex + 1)).not.toContain("false");
}

function watchPageErrors(page: Page) {
  const errors: string[] = [];
  const listener = (error: Error) => errors.push(error.message);
  page.on("pageerror", listener);
  return {
    dispose: () => page.off("pageerror", listener),
    errors,
  };
}

function watchGenerationRequests(page: Page) {
  const requests: string[] = [];
  const listener = (request: Request) => {
    const url = request.url();
    if (
      (request.method() === "POST" && /\/api\/generation-tasks(?:\?|$)/.test(url)) ||
      /openrouter|volces|mureka|lk888|lk666/i.test(url)
    ) requests.push(`${request.method()} ${url}`);
  };
  page.on("request", listener);
  return {
    dispose: () => page.off("request", listener),
    requests,
  };
}

async function runPersistedSourceAction({
  action,
  expectParentId,
  expectSourceParentGroup = false,
  grouped = false,
  kind,
  page,
  request,
  verifyDeleteSource = false,
  viewport,
  verifyZoomCancel = false,
}: {
  action: MenuAction;
  expectParentId?: string;
  expectSourceParentGroup?: boolean;
  grouped?: boolean;
  kind: SourceKind;
  page: Page;
  request: APIRequestContext;
  verifyDeleteSource?: boolean;
  viewport?: { height: number; width: number };
  verifyZoomCancel?: boolean;
}) {
  const canvas = await createPersistedSourceCanvas(request, kind, grouped);
  const pageErrors = watchPageErrors(page);
  const generationRequests = watchGenerationRequests(page);
  const canvasReads = watchCanvasReads(page, canvas.projectId);
  let writes: ReturnType<typeof watchCanvasWrites> | undefined;
  try {
    if (viewport) await page.setViewportSize(viewport);
    await installCanvasLoadStateWatch(page);
    await page.goto(`/canvas/${canvas.projectId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    const initialCanvasReadCount = canvasReads.reads.length;
    expect(initialCanvasReadCount).toBeGreaterThan(0);
    await assertStableCanvasPersistence(page, world);
    const source = page.locator(
      `.react-flow__node[data-id="${canvas.sourceId}"]`,
    );
    const before = await readPersistedCanvas(request, canvas.projectId);
    const interactionCanvasReadCount = canvasReads.reads.length;
    writes = watchCanvasWrites(page, canvas.projectId);
    let created = undefined as PersistedNode | undefined;
    let rawDrop: { x: number; y: number } | undefined;
    await test.step("真实拖动来源加号、点击动作并原子创建节点与引用边", async () => {
      const dragged = await dragSourceToBlank(page, source, world);
      rawDrop = dragged.drop;
      const { menu } = dragged;
      await expect(menu).toHaveAttribute("data-source-kind", kind);
      await assertSourceMenuContract(menu, kind);
      await assertStableCanvasPersistence(page, world);
      expect(canvasReads.reads).toHaveLength(interactionCanvasReadCount);
      const actionItem = menuItem(menu, action.label);
      await expect(actionItem).toBeEnabled();
      await actionItem.click();
      await expect(menu).toHaveCount(0);
      await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
      await expect(world).toHaveAttribute(
        "data-node-count",
        String(before.nodes.length + 1),
      );
      await expect(world).toHaveAttribute(
        "data-edge-count",
        String(before.edges.length + 1),
      );
      await assertStableCanvasPersistence(page, world);
      expect(canvasReads.reads).toHaveLength(interactionCanvasReadCount);
    });

    const graphAfterAction = await waitForCreatedGraph(
      request,
      canvas.projectId,
      before,
      canvas.sourceId,
      action.nodeType,
    );
    created = graphAfterAction.created;
    const { current, edge } = graphAfterAction;
    expect(rawDrop).toBeDefined();
    await assertTargetPositionMatchesRawDrop(
      world,
      rawDrop!,
      created,
      action.nodeType,
    );
    if (expectSourceParentGroup || expectParentId !== undefined) {
      expect(current.nodes.find((node) => node.id === canvas.sourceId)?.parentId)
        .toBe(expectSourceParentGroup ? canvas.groupId : expectParentId);
    }
    expect(edge.source).toBe(canvas.sourceId);
    expect(edge.target).toBe(created.id);
    const atomicCommand = writes?.writes.some((write) => {
      if (write.method === "PUT") {
        const nodes = write.body.nodes;
        const edges = write.body.edges;
        if (!Array.isArray(nodes) || !Array.isArray(edges)) return false;
        return nodes.some((node) => {
          if (!node || typeof node !== "object") return false;
          const value = node as { id?: unknown; type?: unknown };
          return value.id === created?.id && value.type === action.nodeType;
        }) && edges.some((edge) => {
          if (!edge || typeof edge !== "object") return false;
          const value = edge as { source?: unknown; target?: unknown };
          return value.source === canvas.sourceId && value.target === created?.id;
        });
      }
      if (write.method !== "POST" || write.body.kind !== "apply-topology") {
        return false;
      }
      const operation = write.body.topologyOperation;
      if (!operation || typeof operation !== "object") return false;
      const topology = operation as {
        edges?: unknown;
        intent?: unknown;
        nodes?: unknown;
      };
      if (topology.intent !== "paste-subgraph" ||
          !Array.isArray(topology.nodes) || !Array.isArray(topology.edges)) {
        return false;
      }
      return topology.nodes.some((node) => {
        if (!node || typeof node !== "object") return false;
        const value = node as { id?: unknown; type?: unknown };
        return value.id === created?.id && value.type === action.nodeType;
      }) && topology.edges.some((edge) => {
        if (!edge || typeof edge !== "object") return false;
        const value = edge as { source?: unknown; target?: unknown };
        return value.source === canvas.sourceId && value.target === created?.id;
      });
    });
    expect(atomicCommand).toBe(true);
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    expect(generationRequests.requests).toEqual([]);
    expect(pageErrors.errors).toEqual([]);

    await test.step("撤销和重做保持节点与引用边成对变化", async () => {
      await page.keyboard.press("Meta+z");
      await expect.poll(async () => {
        const graph = await readPersistedCanvas(request, canvas.projectId);
        return { edges: graph.edges.length, nodes: graph.nodes.length };
      }, { timeout: 15_000 }).toEqual({
        edges: before.edges.length,
        nodes: before.nodes.length,
      });
      await expect(world).toHaveAttribute(
        "data-node-count",
        String(before.nodes.length),
      );
      await expect(world).toHaveAttribute(
        "data-edge-count",
        String(before.edges.length),
      );

      await page.keyboard.press("Meta+Shift+z");
      const redone = await waitForCreatedGraph(
        request,
        canvas.projectId,
        before,
        canvas.sourceId,
        action.nodeType,
      );
      created = redone.created;
      await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    });

    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute(
      "data-node-count",
      String(before.nodes.length + 1),
    );
    await expect(world).toHaveAttribute(
      "data-edge-count",
      String(before.edges.length + 1),
    );
    const reloaded = await readPersistedCanvas(request, canvas.projectId);
    expect(created).toBeDefined();
    expect(reloaded.nodes.some((node) => node.id === created!.id)).toBe(true);
    expect(reloaded.edges.some(
      (candidate) => candidate.source === canvas.sourceId && candidate.target === created!.id,
    )).toBe(true);
    expect(generationRequests.requests).toEqual([]);
    expect(pageErrors.errors).toEqual([]);

    if (verifyZoomCancel) {
      await test.step("程序化缩放后重复拖动并取消不产生重复节点或边", async () => {
        const zoomSlider = page.getByTestId("zoom-slider");
        await zoomSlider.fill("1.25");
        await expect(world).toHaveAttribute("data-viewport-zoom", "1.25");
        const repeatCanvasReadCount = canvasReads.reads.length;
        const repeatedSource = page.locator(
          `.react-flow__node[data-id="${canvas.sourceId}"]`,
        );
        const repeated = await dragSourceToBlank(page, repeatedSource, world);
        await expect(repeated.menu).toBeVisible();
        await assertStableCanvasPersistence(page, world);
        expect(canvasReads.reads).toHaveLength(repeatCanvasReadCount);
        await page.keyboard.press("Escape");
        await expect(repeated.menu).toHaveCount(0);
        await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
        await expect(world).toHaveAttribute(
          "data-node-count",
          String(before.nodes.length + 1),
        );
        await expect(world).toHaveAttribute(
          "data-edge-count",
          String(before.edges.length + 1),
        );
        const unchanged = await readPersistedCanvas(request, canvas.projectId);
        expect(unchanged.nodes).toHaveLength(before.nodes.length + 1);
        expect(unchanged.edges).toHaveLength(before.edges.length + 1);
        expect(canvasReads.reads).toHaveLength(repeatCanvasReadCount);
        await assertStableCanvasPersistence(page, world);
        await zoomSlider.fill("1");
      });
    }

    if (verifyDeleteSource) {
      await test.step("真实删除来源节点并确认引用边一并持久化删除", async () => {
        const persistedSource = page.locator(
          `.react-flow__node[data-id="${canvas.sourceId}"]`,
        );
        await persistedSource.click();
        await page.keyboard.press("Delete");
        await expect(persistedSource).toHaveCount(0);
        await expect.poll(async () => {
          const graph = await readPersistedCanvas(request, canvas.projectId);
          return {
            hasSource: graph.nodes.some((node) => node.id === canvas.sourceId),
            hasSourceEdge: graph.edges.some((candidate) =>
              candidate.source === canvas.sourceId || candidate.target === canvas.sourceId
            ),
          };
        }, { timeout: 15_000 }).toEqual({ hasSource: false, hasSourceEdge: false });
        await assertStableCanvasPersistence(page, world);
      });
    }
  } finally {
    writes?.dispose();
    canvasReads.dispose();
    generationRequests.dispose();
    pageErrors.dispose();
    await cleanupPersistedProject(request, canvas.projectId);
  }
}

async function runDelayedSourceMenuRecovery(
  page: Page,
  request: APIRequestContext,
) {
  const canvas = await createPersistedSourcePairCanvas(request);
  const pageErrors = watchPageErrors(page);
  const generationRequests = watchGenerationRequests(page);
  const commandPath = `**/api/canvases/${canvas.projectId}/commands`;
  let commandCount = 0;
  const commandEvidence: Array<Record<string, unknown>> = [];
  let releaseFirst: (() => void) | undefined;
  let releaseRecovery: (() => void) | undefined;
  const recoveryGate = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });
  let firstCommandSeenResolve!: () => void;
  let recoveryCommandSeenResolve!: () => void;
  const firstCommandSeen = new Promise<void>((resolve) => {
    firstCommandSeenResolve = resolve;
  });
  const recoveryCommandSeen = new Promise<void>((resolve) => {
    recoveryCommandSeenResolve = resolve;
  });
  const commandRoute = async (route: BrowserRoute) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    commandCount += 1;
    let body: unknown;
    try {
      body = route.request().postDataJSON();
    } catch {
      body = undefined;
    }
    const command = body && typeof body === "object"
      ? body as Record<string, unknown>
      : {};
    const operation = command.topologyOperation &&
        typeof command.topologyOperation === "object"
      ? command.topologyOperation as Record<string, unknown>
      : undefined;
    const ids = (value: unknown) => Array.isArray(value)
      ? value.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const record = item as Record<string, unknown>;
          const id = typeof record.id === "string"
            ? record.id
            : typeof record.nodeId === "string"
              ? record.nodeId
              : undefined;
          return id ? [id] : [];
        })
      : undefined;
    commandEvidence.push({
      index: commandCount,
      kind: typeof command.kind === "string" ? command.kind : "unknown",
      ...(typeof command.operationId === "string"
        ? { operationId: command.operationId }
        : {}),
      ...(operation && typeof operation.intent === "string"
        ? { intent: operation.intent }
        : {}),
      ...(operation ? { nodeIds: ids(operation.nodes), edgeIds: ids(operation.edges) } : {}),
      ...(Array.isArray(command.nodes) ? { layoutNodeIds: ids(command.nodes) } : {}),
      ...(Array.isArray(command.changes) ? { changeNodeIds: ids(command.changes) } : {}),
      ...(command.viewport && typeof command.viewport === "object"
        ? { hasViewport: true }
        : {}),
    });
    if (commandCount === 1) {
      firstCommandSeenResolve();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      await route.fulfill({
        body: JSON.stringify({
          code: "CANVAS_SAVE_TEMPORARY_FAILURE",
          error: "模拟保存失败",
        }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    if (commandCount >= 2) {
      recoveryCommandSeenResolve();
      await recoveryGate;
      await route.continue();
      return;
    }
    await route.continue();
  };
  try {
    await page.setViewportSize({ height: 720, width: 1280 });
    await installCanvasLoadStateWatch(page);
    await page.route(commandPath, commandRoute);
    await page.goto(`/canvas/${canvas.projectId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await assertStableCanvasPersistence(page, world);
    const before = await readPersistedCanvas(request, canvas.projectId);
    expect(before.nodes).toHaveLength(2);
    expect(before.edges).toHaveLength(0);
    const imageSource = page.locator(
      `.react-flow__node[data-id="${canvas.imageSourceId}"]`,
    );
    const videoSource = page.locator(
      `.react-flow__node[data-id="${canvas.videoSourceId}"]`,
    );
    let rawDrop: { x: number; y: number } | undefined;

    await test.step("保存等待期间打开第二个来源菜单，旧完成不关闭新菜单", async () => {
      const first = await dragSourceToBlank(page, imageSource, world);
      rawDrop = first.drop;
      await expect(first.menu).toHaveAttribute("data-source-kind", "image");
      await menuItem(first.menu, "文本生成").click();
      await firstCommandSeen;
      await expect(world).toHaveAttribute(
        "data-node-count",
        String(before.nodes.length + 1),
      );
      await expect(world).toHaveAttribute(
        "data-edge-count",
        String(before.edges.length + 1),
      );

      const second = await dragSourceToBlank(page, videoSource, world);
      await expect(second.menu).toHaveAttribute("data-source-kind", "video");
      const firstResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname ===
          `/api/canvases/${canvas.projectId}/commands` &&
        response.status() === 503,
      );
      releaseFirst?.();
      const firstResponse = await firstResponsePromise;
      await firstResponse.body();
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      await expect(second.menu).toBeVisible();
      await assertSaveUnconfirmed(page, 25_000);
      await recoveryCommandSeen;
      await expect(second.menu).toHaveAttribute("aria-busy", "false", {
        timeout: 25_000,
      });
      await expect(page.getByTestId("workflow-run-toast")).toContainText(
        "节点已创建，保存尚未确认",
      );
      await expect(second.menu).toBeVisible();
      await expect(menuItem(second.menu, "文本生成")).toBeEnabled();
    });

    await test.step("一次恢复只落一组节点和引用边，超时草稿不重复创建", async () => {
      releaseRecovery?.();
      const recovered = await waitForCreatedGraph(
        request,
        canvas.projectId,
        before,
        canvas.imageSourceId,
        "text",
      );
      expect(recovered.current.nodes).toHaveLength(before.nodes.length + 1);
      expect(recovered.current.edges).toHaveLength(before.edges.length + 1);
      await assertTargetPositionMatchesRawDrop(
        world,
        rawDrop!,
        recovered.created,
        "text",
      );
      await expect(world).toHaveAttribute(
        "data-node-count",
        String(before.nodes.length + 1),
      );
      await expect(world).toHaveAttribute(
        "data-edge-count",
        String(before.edges.length + 1),
      );
      await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      console.log(`[m1-source-save-evidence] ${JSON.stringify(commandEvidence)}`);
      expect(commandCount).toBeGreaterThanOrEqual(2);
      const topologyCreates = commandEvidence.filter((entry) =>
        entry.kind === "apply-topology" && entry.intent === "paste-subgraph"
      );
      expect(topologyCreates.length).toBeGreaterThanOrEqual(2);
      expect(new Set(topologyCreates.map((entry) => entry.operationId)).size).toBe(1);
      for (const command of topologyCreates) {
        expect(command.operationId).toEqual(expect.any(String));
        expect(command.nodeIds).toEqual([recovered.created.id]);
        expect(command.edgeIds).toEqual([recovered.edge.id]);
      }
      await expect(page.getByTestId("source-connect-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("source-connect-menu")).toHaveCount(0);
      await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
    });
    expect(pageErrors.errors).toEqual([]);
    expect(generationRequests.requests).toEqual([]);
  } finally {
    releaseFirst?.();
    releaseRecovery?.();
    await page.unroute(commandPath, commandRoute);
    generationRequests.dispose();
    pageErrors.dispose();
    await cleanupPersistedProject(request, canvas.projectId);
  }
}

async function runTwoCanvasTabStability(
  page: Page,
  request: APIRequestContext,
) {
  const primary = await createPersistedSourceCanvas(request, "text");
  const secondaryCanvas = await createPersistedSourceCanvas(request, "image");
  const secondaryPage = await page.context().newPage();
  const primaryErrors = watchPageErrors(page);
  const secondaryErrors = watchPageErrors(secondaryPage);
  const primaryGeneration = watchGenerationRequests(page);
  const secondaryGeneration = watchGenerationRequests(secondaryPage);
  let secondaryWrites: ReturnType<typeof watchCanvasWrites> | undefined;
  try {
    await page.setViewportSize({ height: 995, width: 1840 });
    await secondaryPage.setViewportSize({ height: 720, width: 1280 });
    await Promise.all([
      installCanvasLoadStateWatch(page),
      installCanvasLoadStateWatch(secondaryPage),
    ]);
    await Promise.all([
      page.goto(`/canvas/${primary.projectId}`),
      secondaryPage.goto(`/canvas/${secondaryCanvas.projectId}`),
    ]);

    const primaryWorld = page.getByTestId("canvas-world");
    const secondaryWorld = secondaryPage.getByTestId("canvas-world");
    await Promise.all([
      expect(primaryWorld).toHaveAttribute("data-persistence-ready", "true"),
      expect(secondaryWorld).toHaveAttribute(
        "data-persistence-ready",
        "true",
      ),
    ]);
    await assertStableCanvasPersistence(page, primaryWorld);
    await assertStableCanvasPersistence(secondaryPage, secondaryWorld);

    const primaryBefore = await readPersistedCanvas(request, primary.projectId);
    const secondaryBefore = await readPersistedCanvas(
      request,
      secondaryCanvas.projectId,
    );
    const primarySource = page.locator(
      `.react-flow__node[data-id="${primary.sourceId}"]`,
    );
    const secondarySource = secondaryPage.locator(
      `.react-flow__node[data-id="${secondaryCanvas.sourceId}"]`,
    );

    await test.step("同源两个画布标签各自维持来源菜单和状态", async () => {
      const { menu } = await dragSourceToBlank(
        page,
        primarySource,
        primaryWorld,
      );
      await expect(menu).toHaveAttribute("data-source-kind", "text");
      await assertSourceMenuContract(menu, "text");
      await expect(secondaryPage.getByTestId("source-connect-menu")).toHaveCount(0);
      await expect(secondaryPage.getByTestId("source-connect-preview")).toHaveCount(0);
      await expect(secondaryWorld).toHaveAttribute(
        "data-node-count",
        String(secondaryBefore.nodes.length),
      );
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(primaryWorld).toHaveAttribute(
        "data-node-count",
        String(primaryBefore.nodes.length),
      );
      await expect(primaryWorld).toHaveAttribute(
        "data-edge-count",
        String(primaryBefore.edges.length),
      );
    });

    const secondaryWriteLog = watchCanvasWrites(
      secondaryPage,
      secondaryCanvas.projectId,
    );
    secondaryWrites = secondaryWriteLog;
    const { menu: secondaryMenu } = await dragSourceToBlank(
      secondaryPage,
      secondarySource,
      secondaryWorld,
    );
    await expect(secondaryMenu).toHaveAttribute("data-source-kind", "image");
    await assertSourceMenuContract(secondaryMenu, "image");
    const action = sourceActionContracts.image.enabled[0]!;
    await menuItem(secondaryMenu, action.label).click();
    await expect(secondaryMenu).toHaveCount(0);
    await expect(secondaryWorld).toHaveAttribute(
      "data-node-count",
      String(secondaryBefore.nodes.length + 1),
    );
    await expect(secondaryWorld).toHaveAttribute(
      "data-edge-count",
      String(secondaryBefore.edges.length + 1),
    );
    const created = await waitForCreatedGraph(
      request,
      secondaryCanvas.projectId,
      secondaryBefore,
      secondaryCanvas.sourceId,
      action.nodeType,
    );
    expect(secondaryWriteLog.writes.some((write) =>
      write.method === "POST" && write.body.kind === "apply-topology"
    )).toBe(true);
    await expect(secondaryPage.getByTestId("save-status")).toHaveText("已保存到云端");
    await expect(primaryWorld).toHaveAttribute(
      "data-node-count",
      String(primaryBefore.nodes.length),
    );
    await expect(primaryWorld).toHaveAttribute(
      "data-edge-count",
      String(primaryBefore.edges.length),
    );
    await expect(page.getByTestId("source-connect-menu")).toHaveCount(0);
    await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
    await assertStableCanvasPersistence(page, primaryWorld);
    await secondaryPage.reload();
    await expect(secondaryWorld).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    await expect(secondaryWorld).toHaveAttribute(
      "data-node-count",
      String(secondaryBefore.nodes.length + 1),
    );
    await expect(secondaryWorld).toHaveAttribute(
      "data-edge-count",
      String(secondaryBefore.edges.length + 1),
    );
    expect(created.created.id).toMatch(/^text-/);
    expect(secondaryErrors.errors).toEqual([]);
    expect(primaryErrors.errors).toEqual([]);
    expect(secondaryGeneration.requests).toEqual([]);
    expect(primaryGeneration.requests).toEqual([]);
  } finally {
    secondaryWrites?.dispose();
    secondaryGeneration.dispose();
    primaryGeneration.dispose();
    secondaryErrors.dispose();
    primaryErrors.dispose();
    await secondaryPage.close();
    await cleanupPersistedProject(request, primary.projectId);
    await cleanupPersistedProject(request, secondaryCanvas.projectId);
  }
}

const cases = [
  {
    height: 326,
    id: "probe-image",
    items: ["文本生成", "图片生成", "视频生成", "图片编辑器", "3D 世界 Beta"],
    kind: "image",
  },
  {
    height: 270,
    id: "probe-video",
    items: ["文本生成", "音频生成", "视频编辑", "3D 世界 Beta"],
    kind: "video",
  },
  {
    height: 158,
    id: "probe-audio",
    items: ["视频生成", "数字人视频"],
    kind: "audio",
  },
] as const;

for (const source of cases) {
  test(`${source.kind} blank drop shows its exact source menu and cancels cleanly`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.goto(
      "/__fixture/interaction.source-aware-connect-menus-current",
    );
    const world = page.getByTestId("canvas-world");
    const node = page.locator(
      `.react-flow__node[data-id="${source.id}"]`,
    );
    const handle = node.locator(
      ".react-flow__handle.source .node-handle-hit",
    );

    await node.click();
    const from = await handle.boundingBox();
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(950, 460, { steps: 6 });
    await page.mouse.up();

    const menu = page.getByTestId("source-connect-menu");
    await expect(menu).toHaveAttribute("data-source-kind", source.kind);
    await expect(menu).toContainText("引用该节点生成");
    await expect(menu.getByRole("menuitem")).toHaveCount(source.items.length);
    await expect(menu.locator(".source-connect-menu-label")).toHaveText(
      source.items.map((item) => item.replace(" Beta", "Beta")),
    );
    expect(await menu.boundingBox()).toMatchObject({
      width: 288,
      height: source.height,
    });
    await expect(menu.locator(".source-connect-menu-items")).toHaveCSS(
      "gap",
      "4px",
    );
    await expect(menu.getByRole("menuitem").first()).toHaveCSS(
      "height",
      "52px",
    );
    await expect(page.getByTestId("source-connect-preview")).toBeVisible();
    await expect(world).toHaveAttribute("data-node-count", "3");
    await expect(world).toHaveAttribute("data-edge-count", "0");

    await page.mouse.click(1100, 800);
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
    await expect(world).toHaveAttribute("data-node-count", "3");
    await expect(world).toHaveAttribute("data-edge-count", "0");

    await test.step(`真实${source.kind}画布动作可保存、刷新并保持来源菜单契约`, async () => {
      const action = sourceActionContracts[source.kind].enabled[0]!;
      await runPersistedSourceAction({
        action,
        kind: source.kind,
        page,
        request,
        verifyDeleteSource: source.kind === "audio",
      });
    });
  });
}

test("open menu preview remains attached while its source node moves", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto("/__fixture/interaction.source-aware-connect-menus-current");
  const node = page.locator('.react-flow__node[data-id="probe-image"]');
  const handle = node.locator(".react-flow__handle.source .node-handle-hit");

  await node.click();
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(950, 460, { steps: 6 });
  await page.mouse.up();

  const before = await node.boundingBox();
  await page.mouse.move(before!.x + 120, before!.y + 120);
  await page.mouse.down();
  await page.mouse.move(before!.x + 200, before!.y + 160, { steps: 6 });
  await page.mouse.up();

  const after = await node.boundingBox();
  const path = await page
    .getByTestId("source-connect-preview")
    .locator("path")
    .getAttribute("d");
  expect(path).toMatch(
    new RegExp(`^M${Math.round(after!.x + after!.width)},${Math.round(after!.y + after!.height / 2)}`),
  );
  await expect(page.getByTestId("source-connect-menu")).toBeVisible();

  await test.step("CUI-07: a grouped child preview starts at its absolute source port through zoom", async () => {
    await page.goto("/__fixture/node.group.selected");
    const groupWorld = page.getByTestId("canvas-world");
    const child = page.locator('.react-flow__node[data-id="group-image"]');
    const childHandle = child.locator(
      ".react-flow__handle.source .node-handle-hit",
    );
    await child.click();
    const drop = await groupWorld.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      for (let y = bounds.bottom - 48; y > bounds.top + 48; y -= 16) {
        for (let x = bounds.right - 48; x > bounds.left + 48; x -= 16) {
          const target = document.elementFromPoint(x, y);
          if (
            target?.closest("[data-testid=canvas-world]") === element &&
            !target.closest(".react-flow__node, button, input, textarea")
          ) return { x, y };
        }
      }
      throw new Error("No blank canvas point for grouped source preview");
    });
    const fromChild = (await childHandle.boundingBox())!;
    await page.mouse.move(
      fromChild.x + fromChild.width / 2,
      fromChild.y + fromChild.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 6 });
    await page.mouse.up();

    const preview = page.getByTestId("source-connect-preview");
    await expect(page.getByTestId("source-connect-menu")).toBeVisible();
    await expect(groupWorld).toHaveAttribute("data-edge-count", "0");
    const expectPreviewAtChildPort = async () => {
      await expect.poll(async () => {
        const bounds = (await child.boundingBox())!;
        const path = await preview.locator("path").getAttribute("d");
        const origin = /^M([^,]+),([^ ]+)/.exec(path ?? "");
        if (!origin) return false;
        return Math.abs(Number(origin[1]) - bounds.x - bounds.width) < 1 &&
          Math.abs(Number(origin[2]) - bounds.y - bounds.height / 2) < 1;
      }).toBe(true);
    };
    await expectPreviewAtChildPort();

    const zoomSlider = page.getByTestId("zoom-slider");
    const originalZoom = await zoomSlider.inputValue();
    await zoomSlider.fill("1.25");
    await expect(groupWorld).toHaveAttribute("data-viewport-zoom", "1.25");
    const zoomedChild = (await child.boundingBox())!;
    await expectPreviewAtChildPort();
    await page.mouse.move(zoomedChild.x + 80, zoomedChild.y + 80);
    await page.mouse.wheel(80, 40);
    await expect.poll(async () => (await child.boundingBox())!.x)
      .not.toBe(zoomedChild.x);
    await expectPreviewAtChildPort();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(groupWorld).toHaveAttribute("data-edge-count", "0");
    await zoomSlider.fill(originalZoom);
  });

  await test.step("持久化分组来源在1840宽画布缩放后仍可动作并可取消重复拖动", async () => {
    await runPersistedSourceAction({
      action: { label: "文本生成", nodeType: "text" },
      expectSourceParentGroup: true,
      grouped: true,
      kind: "image",
      page,
      request,
      verifyZoomCancel: true,
      viewport: { height: 995, width: 1840 },
    });
  });
});

test("selecting another node closes the open menu and preview", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.goto("/__fixture/interaction.source-aware-connect-menus-current");
  const image = page.locator('.react-flow__node[data-id="probe-image"]');
  const handle = image.locator(".react-flow__handle.source .node-handle-hit");

  await image.click();
  const from = await handle.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(600, 460, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("source-connect-menu")).toBeVisible();

  await page.locator('.react-flow__node[data-id="probe-video"]').click();
  await expect(page.getByTestId("source-connect-menu")).toHaveCount(0);
  await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);

  await test.step("CUI-07: deleting the source removes its temporary preview", async () => {
    await image.click();
    const source = (await handle.boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(950, 460, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId("source-connect-preview")).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(image).toHaveCount(0);
    await expect(page.getByTestId("source-connect-menu")).toHaveCount(0);
    await expect(page.getByTestId("source-connect-preview")).toHaveCount(0);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-edge-count", "0");
  });

  await test.step("文本来源和同源双画布标签的真实动作彼此隔离", async () => {
    await runTwoCanvasTabStability(page, request);
  });

  await test.step("文本来源四种动作与图片来源其余动作均可持久化", async () => {
    for (const action of sourceActionContracts.text.enabled) {
      await test.step(`文本来源→${action.label}`, async () => {
        await runPersistedSourceAction({
          action,
          kind: "text",
          page,
          request,
        });
      });
    }
    for (const action of sourceActionContracts.image.enabled.slice(1)) {
      await test.step(`图片来源→${action.label}`, async () => {
        await runPersistedSourceAction({
          action,
          kind: "image",
          page,
          request,
        });
      });
    }
  });

  await test.step("旧菜单保存失败时保留新菜单并在一次重试后只创建一组节点", async () => {
    await runDelayedSourceMenuRecovery(page, request);
  });
});
