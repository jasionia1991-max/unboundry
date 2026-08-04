import { expect, test, type Page } from "@playwright/test";
import {
  canvasDocumentFingerprint,
  canvasGraphFingerprint,
} from "../types/canvasFingerprint";
import {
  screenToWorld,
  zoomViewportAtScreenPoint,
} from "../client/src/canvas/viewportMath";

function trackProviderRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/openrouter|volces|mureka|lk888|lk666/i.test(request.url())) {
      requests.push(request.url());
    }
  });
  return requests;
}

test("graph fingerprint ignores viewport while document fingerprint preserves it", () => {
  const graph = {
    edges: [{ id: "edge-a-b", source: "a", target: "b" }],
    nodes: [{ id: "a", position: { x: 10, y: 20 }, type: "text" }],
  };
  const first = { ...graph, viewport: { x: 0, y: 0, zoom: 1 } };
  const second = { ...graph, viewport: { x: 90, y: -40, zoom: 1.3 } };

  expect(canvasGraphFingerprint(first)).toBe(canvasGraphFingerprint(second));
  expect(canvasDocumentFingerprint(first)).not.toBe(
    canvasDocumentFingerprint(second),
  );
});

test("pointer anchored wheel zoom preserves the world point", () => {
  const viewport = { x: 30, y: -20, zoom: 1 };
  const pointer = { x: 420, y: 310 };
  const world = screenToWorld(pointer, viewport);
  const zoomed = zoomViewportAtScreenPoint(viewport, pointer, {
    deltaMode: 0,
    deltaY: -100,
  });

  expect(zoomed.zoom).toBeGreaterThan(viewport.zoom);
  expect(screenToWorld(pointer, zoomed).x).toBeCloseTo(world.x, 8);
  expect(screenToWorld(pointer, zoomed).y).toBeCloseTo(world.y, 8);
});

test("search location is consumed once and zoom remains available over the node", async ({
  page,
}) => {
  const providerRequests = trackProviderRequests(page);
  await page.goto("/__fixture/interaction.node-search.populated");
  const world = page.getByTestId("canvas-world");

  await page.getByTestId("node-search").click();
  await page.getByRole("searchbox", { name: "搜索节点..." }).fill("晨光城市");
  await page
    .getByTestId("node-search-results")
    .getByRole("button", { name: /品牌故事文案.*晨光城市/ })
    .click();
  await expect(world).toHaveAttribute("data-primary-node", "search-text");

  const node = page.locator('.react-flow__node[data-id="search-text"]');
  const bounds = await node.boundingBox();
  expect(bounds).not.toBeNull();
  const before = Number(await world.getAttribute("data-viewport-zoom"));
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2,
  );
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => Number(await world.getAttribute("data-viewport-zoom")))
    .toBeGreaterThan(before);
  const zoomed = Number(await world.getAttribute("data-viewport-zoom"));
  await page.waitForTimeout(250);
  expect(Number(await world.getAttribute("data-viewport-zoom"))).toBeCloseTo(
    zoomed,
    6,
  );

  await page.getByTestId("zoom-slider").fill("1.3");
  await expect(world).toHaveAttribute("data-viewport-zoom", "1.3");
  await page.waitForTimeout(250);
  await expect(world).toHaveAttribute("data-viewport-zoom", "1.3");
  expect(providerRequests).toEqual([]);
});

test("open creator stays stable and focused while zooming over its prompt", async ({
  page,
}) => {
  const providerRequests = trackProviderRequests(page);
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ generationEnabled: false, models: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/__fixture/node.text.creator-open");
  const world = page.getByTestId("canvas-world");
  const creator = page.getByTestId("text-creator");
  const prompt = page.getByTestId("text-creator-prompt");
  await expect(creator).toBeVisible();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await prompt.focus();
  await expect(prompt).toBeFocused();
  await page.keyboard.insertText("缩放时保留这段文字");
  await expect(prompt).toHaveValue("缩放时保留这段文字");
  await page.waitForTimeout(100);
  await expect(prompt).toHaveValue("缩放时保留这段文字");
  await prompt.evaluate((element) => {
    element.setAttribute("data-zoom-instance", "before");
  });
  await prompt.focus();
  const beforeBounds = await creator.boundingBox();
  const promptBounds = await prompt.boundingBox();
  expect(beforeBounds).not.toBeNull();
  expect(promptBounds).not.toBeNull();

  await page.mouse.move(
    promptBounds!.x + promptBounds!.width / 2,
    promptBounds!.y + promptBounds!.height / 2,
  );
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -80);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => Number(await world.getAttribute("data-viewport-zoom")))
    .toBeGreaterThan(1);
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute("data-zoom-instance", "before");
  await expect(prompt).toHaveValue("缩放时保留这段文字");
  await expect(page.getByTestId("text-generation-saving")).toHaveCount(0);
  await expect(page.getByText("画布正在保存，保存完成后可生成")).toHaveCount(0);
  const afterBounds = await creator.boundingBox();
  expect(afterBounds).not.toBeNull();
  expect(afterBounds!.height).toBeCloseTo(beforeBounds!.height, 1);
  expect(providerRequests).toEqual([]);
});

test("server graph revision stays stable for viewport-only saves", async ({
  request,
}) => {
  const canvasId = `m62-graph-revision-${crypto.randomUUID()}`;
  const initial = {
    edges: [],
    nodes: [],
    revision: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const created = await request.put(`/api/canvas/${canvasId}`, { data: initial });
  expect(created.ok()).toBe(true);
  const first = await created.json() as {
    graphRevision: number;
    revision: number;
  };

  const viewportSave = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      ...initial,
      revision: first.revision,
      viewport: { x: 120, y: -80, zoom: 1.4 },
    },
  });
  expect(viewportSave.ok()).toBe(true);
  const second = await viewportSave.json() as {
    graphRevision: number;
    revision: number;
  };
  expect(second.revision).toBe(first.revision + 1);
  expect(second.graphRevision).toBe(first.graphRevision);

  const graphSave = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      ...initial,
      nodes: [{ data: { content: "新节点" }, id: "text-a", type: "text" }],
      revision: second.revision,
      viewport: { x: 120, y: -80, zoom: 1.4 },
    },
  });
  expect(graphSave.ok()).toBe(true);
  const third = await graphSave.json() as {
    graphRevision: number;
    revision: number;
  };
  expect(third.graphRevision).toBe(first.graphRevision + 1);
});
