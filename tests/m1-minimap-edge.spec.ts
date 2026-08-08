import { expect, test, type Locator, type Page } from "@playwright/test";

async function dragConnection(
  page: Page,
  source: Locator,
  target?: Locator,
) {
  const from = await source.boundingBox();
  const to = target ? await target.boundingBox() : null;

  await page.mouse.move(
    from!.x + from!.width / 2,
    from!.y + from!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    to ? to.x + to.width / 2 : 1000,
    to ? to.y + to.height / 2 : 700,
    { steps: 6 },
  );
}

function trackPaidRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      (request.method() === "POST" &&
        /\/api\/generation-tasks(?:\?|$)/.test(url)) ||
      /openrouter|volces|mureka|lk888|lk666/i.test(url)
    ) {
      requests.push(`${request.method()} ${url}`);
    }
  });
  return requests;
}

async function canvasLayersAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ pointX, pointY }) =>
      Array.from(
        new Set(
          document.elementsFromPoint(pointX, pointY).flatMap((element) => {
            const node = element.closest<HTMLElement>(".react-flow__node");
            if (node?.dataset.id) return [`node:${node.dataset.id}`];
            const cut = element.closest<HTMLElement>(".cut-edge-button");
            if (cut?.dataset.edgeCutFor) {
              return [`cut:${cut.dataset.edgeCutFor}`];
            }
            const edge = element.closest<HTMLElement>(".react-flow__edge");
            if (edge?.dataset.id) return [`edge:${edge.dataset.id}`];
            return [];
          }),
        ),
      ),
    { pointX: x, pointY: y },
  );
}

async function exposedEdgePoint(hitLine: Locator) {
  return hitLine.evaluate((element) => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const length = path.getTotalLength();

    for (let index = 1; index < 40; index += 1) {
      const point = path.getPointAtLength((length * index) / 40);
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const firstCanvasElement = document
        .elementsFromPoint(screenPoint.x, screenPoint.y)
        .map((candidate) =>
          candidate.closest<HTMLElement>(
            ".react-flow__node, .react-flow__edge",
          ),
        )
        .find(Boolean);
      if (firstCanvasElement?.classList.contains("react-flow__edge")) {
        return { x: screenPoint.x, y: screenPoint.y };
      }
    }

    return null;
  });
}

test("minimap matches the frozen empty geometry and renders node rects", async ({
  page,
}) => {
  await page.goto("/__fixture/shell.empty.primary");
  const toggle = page.getByTestId("minimap-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-active", "true");
  const minimap = page.locator(".tap-minimap");
  await expect(minimap).toBeVisible();
  expect(await minimap.boundingBox()).toEqual({
    x: 16,
    y: 709,
    width: 198,
    height: 148,
  });
  await expect(minimap).toHaveCSS("overflow", "hidden");
  await expect(minimap).toHaveCSS(
    "outline-color",
    "rgba(255, 255, 255, 0.1)",
  );
  await expect(minimap).toHaveCSS("outline-width", "1px");
  await expect(minimap).toHaveCSS("pointer-events", "auto");
  await expect(minimap).toHaveCSS("cursor", "grab");
  await expect(page.locator("html")).toHaveCSS(
    "overscroll-behavior-x",
    "none",
  );
  await expect(minimap.locator(".react-flow__minimap-node")).toHaveCount(0);

  await page.goto("/__fixture/interaction.selection-and-keyboard-move");
  await page.getByTestId("minimap-toggle").click();
  const nodeRects = page.locator(".tap-minimap .react-flow__minimap-node");
  await expect(nodeRects).toHaveCount(3);

  await page.locator('.react-flow__node[data-id="probe-a"]').click();
  await expect(
    page.locator(".tap-minimap .react-flow__minimap-node.selected"),
  ).toHaveCount(1);
  await expect(page.locator(".tap-minimap .react-flow__minimap-mask")).toHaveCount(
    1,
  );

  const world = page.getByTestId("canvas-world");
  const beforePan = {
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
  };
  const beforeZoom = Number(await world.getAttribute("data-viewport-zoom"));
  const minimapBox = await minimap.boundingBox();
  const minimapViewScale = await minimap
    .locator("svg")
    .evaluate((element) => {
      const viewBox = (element as SVGSVGElement).viewBox.baseVal;
      return viewBox.width / 210;
    });
  const moveScale =
    minimapViewScale * Math.max(beforeZoom, Math.log(beforeZoom));
  await page.mouse.move(
    minimapBox!.x + minimapBox!.width / 2,
    minimapBox!.y + minimapBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    minimapBox!.x + minimapBox!.width / 2 + 24,
    minimapBox!.y + minimapBox!.height / 2 + 16,
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const moved = {
        x: Number(await world.getAttribute("data-viewport-x")),
        y: Number(await world.getAttribute("data-viewport-y")),
      };
      return (
        Math.abs(moved.x - (beforePan.x - 24 * moveScale)) <= 0.01 &&
        Math.abs(moved.y - (beforePan.y - 16 * moveScale)) <= 0.01
      );
    })
    .toBe(true);
  await expect(world).toHaveAttribute(
    "data-viewport-zoom",
    String(beforeZoom),
  );

  const clickPoint = {
    x: minimapBox!.x + minimapBox!.width / 2,
    y: minimapBox!.y + minimapBox!.height / 2,
  };
  const clickWorld = await minimap
    .locator("svg")
    .evaluate((element, point) => {
      const svg = element as SVGSVGElement;
      const matrix = svg.getScreenCTM();
      if (!matrix) return { x: 0, y: 0 };
      const mapped = new DOMPoint(point.x, point.y).matrixTransform(
        matrix.inverse(),
      );
      return { x: mapped.x, y: mapped.y };
    }, clickPoint);
  const canvasBounds = await page.getByTestId("canvas-world").boundingBox();
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect
    .poll(async () => {
      const jumped = {
        x: Number(await world.getAttribute("data-viewport-x")),
        y: Number(await world.getAttribute("data-viewport-y")),
      };
      return (
        Math.abs(
          jumped.x -
            (canvasBounds!.width / 2 - clickWorld.x * beforeZoom),
        ) <= 0.01 &&
        Math.abs(
          jumped.y -
            (canvasBounds!.height / 2 - clickWorld.y * beforeZoom),
        ) <= 0.01
      );
    })
    .toBe(true);
  await expect(world).toHaveAttribute(
    "data-viewport-zoom",
    String(beforeZoom),
  );

  const beforeWheel = {
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
    zoom: Number(await world.getAttribute("data-viewport-zoom")),
  };
  await page.mouse.move(
    minimapBox!.x + minimapBox!.width / 2,
    minimapBox!.y + minimapBox!.height / 2,
  );
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(240, 0);
  await expect
    .poll(async () => ({
      x: Number(await world.getAttribute("data-viewport-x")),
      y: Number(await world.getAttribute("data-viewport-y")),
      zoom: Number(await world.getAttribute("data-viewport-zoom")),
    }))
    .toEqual(beforeWheel);
  await expect(page).toHaveURL(
    /\/__fixture\/interaction\.selection-and-keyboard-move$/,
  );
});

test("fit view brings five distant nodes into the visible canvas", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.fit-five-nodes");
  const nodes = page.locator(".react-flow__node");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-node-count", "5");
  await expect(nodes).toHaveCount(3);
  await expect(
    page.locator('.react-flow__node[data-id="probe-e"]'),
  ).not.toBeInViewport();

  await page.getByTestId("fit-view").click();

  for (const node of await nodes.all()) {
    await expect(node).toBeInViewport();
  }
});

test("clicking or resting on a connection shows scissors, which deletes only the connection", async ({
  page,
}) => {
  await page.goto(
    "/__fixture/interaction.edge-delete-reconnect-download-sandbox-current",
  );
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await expect(world).toHaveAttribute("data-node-count", "3");

  const edge = page.locator(".react-flow__edge");
  await expect(edge.locator(".react-flow__edge-interaction")).toHaveAttribute(
    "stroke-width",
    "20",
  );
  await page.locator('.react-flow__node[data-id="probe-b"]').click();
  await expect(edge).toHaveClass(/connected-to-selected-node/);
  await expect(page.locator(".react-flow__edges")).toHaveCSS("z-index", "0");
  await expect(page.locator(".react-flow__nodes")).toHaveCSS("z-index", "1");
  await expect(
    page.locator('.react-flow__node[data-id="probe-b"]'),
  ).toHaveCSS("z-index", "1000");
  await page.mouse.click(1000, 700);
  await expect(edge).not.toHaveClass(/connected-to-selected-node/);
  const hitLine = edge.locator(".react-flow__edge-interaction");
  const hitLineBox = await hitLine.boundingBox();
  await page.mouse.click(
    hitLineBox!.x + hitLineBox!.width / 2,
    hitLineBox!.y + hitLineBox!.height / 2,
  );
  await expect(edge).toHaveClass(/selected/);
  await expect(world).toHaveAttribute("data-selected-edge-count", "1");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(edge.locator(".react-flow__edgeupdater")).toHaveCount(0);
  const scissors = page.getByRole("button", { name: "删除连线" });
  await expect(scissors).toBeVisible();
  expect(await scissors.boundingBox()).toMatchObject({ width: 32, height: 32 });

  await page.mouse.click(1000, 700);
  await expect(scissors).toHaveCount(0);
  await page.mouse.move(
    hitLineBox!.x + hitLineBox!.width / 2,
    hitLineBox!.y + hitLineBox!.height / 2,
  );
  await expect(scissors).toBeVisible({ timeout: 1_500 });
  await page.mouse.move(1000, 700);
  await expect(scissors).toHaveCount(0);
  await page.mouse.move(
    hitLineBox!.x + hitLineBox!.width / 2,
    hitLineBox!.y + hitLineBox!.height / 2,
  );
  await expect(scissors).toBeVisible({ timeout: 1_500 });

  await scissors.click();
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(world).toHaveAttribute("data-node-count", "3");
});

test("formal edges and their cut control stay behind an occluding node", async ({
  page,
  request,
}) => {
  const paidRequests = trackPaidRequests(page);
  const before = (await (
    await request.get("/api/generation-tasks/status")
  ).json()) as { paidProviderRequests: number };
  await page.goto(
    "/__fixture/interaction.edge-delete-reconnect-download-sandbox-current",
  );

  const world = page.getByTestId("canvas-world");
  const a = page.locator('.react-flow__node[data-id="probe-a"]');
  const b = page.locator('.react-flow__node[data-id="probe-b"]');
  const c = page.locator('.react-flow__node[data-id="probe-c"]');
  const edge = page.locator(
    '.react-flow__edge[data-id="edge-probe-a-probe-b"]',
  );
  await expect(world).toHaveAttribute("data-edge-count", "1");
  const [aBox, bBox, initialCBox] = await Promise.all([
    a.boundingBox(),
    b.boundingBox(),
    c.boundingBox(),
  ]);
  await page.mouse.move(
    bBox!.x + bBox!.width / 2,
    bBox!.y + bBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bBox!.x + bBox!.width / 2 + 260,
    bBox!.y + bBox!.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  const movedBBox = (await b.boundingBox())!;
  await page.mouse.move(
    initialCBox!.x + initialCBox!.width / 2,
    initialCBox!.y + initialCBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    (aBox!.x + aBox!.width + movedBBox.x) / 2,
    aBox!.y + aBox!.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await a.click();
  await expect(a).toHaveCSS("z-index", "1000");
  await expect(edge).toHaveClass(/connected-to-selected-node/);

  const cBox = (await c.boundingBox())!;
  const crossing = {
    x: cBox.x + cBox.width / 2,
    y: cBox.y + cBox.height / 2,
  };
  const crossingLayers = await canvasLayersAt(
    page,
    crossing.x,
    crossing.y,
  );
  expect(crossingLayers[0]).toBe("node:probe-c");

  const exposedPoint = await exposedEdgePoint(
    edge.locator(".react-flow__edge-interaction"),
  );
  expect(exposedPoint).not.toBeNull();
  await page.mouse.click(exposedPoint!.x, exposedPoint!.y);
  await expect
    .poll(() => edge.evaluate((element) => element.classList.contains("selected")))
    .toBe(true);
  const scissors = page.getByRole("button", { name: "删除连线" });
  await expect(scissors).toBeVisible();
  const scissorsBox = (await scissors.boundingBox())!;
  const scissorsLayers = await canvasLayersAt(
    page,
    scissorsBox.x + scissorsBox.width / 2,
    scissorsBox.y + scissorsBox.height / 2,
  );
  expect(scissorsLayers[0]).toBe("node:probe-c");
  expect(scissorsLayers.indexOf("cut:edge-probe-a-probe-b")).toBeGreaterThan(
    scissorsLayers.indexOf("node:probe-c"),
  );

  await page.mouse.click(
    scissorsBox.x + scissorsBox.width / 2,
    scissorsBox.y + scissorsBox.height / 2,
  );
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await expect(c).toHaveClass(/selected/);

  const after = (await (
    await request.get("/api/generation-tasks/status")
  ).json()) as { paidProviderRequests: number };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(paidRequests).toEqual([]);
});

test("native, batch and source-menu previews stay behind nodes", async ({
  page,
  request,
}) => {
  const paidRequests = trackPaidRequests(page);
  const before = (await (
    await request.get("/api/generation-tasks/status")
  ).json()) as { paidProviderRequests: number };
  await page.goto("/__fixture/interaction.manual-connect-image-to-video");
  let a = page.locator('.react-flow__node[data-id="probe-a"]');
  let c = page.locator('.react-flow__node[data-id="probe-c"]');
  let source = a.locator(".react-flow__handle.source .node-handle-hit");
  let cBox = (await c.boundingBox())!;
  let sourceBox = (await source.boundingBox())!;
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2, {
    steps: 6,
  });
  const nativePreview = page.locator(".react-flow__connectionline");
  await expect(nativePreview).toBeVisible();
  await expect(nativePreview).toHaveCSS("z-index", "0");
  await expect(page.locator(".react-flow__nodes")).toHaveCSS("z-index", "1");
  expect(
    (await canvasLayersAt(
      page,
      cBox.x + cBox.width / 2,
      cBox.y + cBox.height / 2,
    ))[0],
  ).toBe("node:probe-c");
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await page.goto("/__fixture/interaction.multi-source-connect-to-node");
  a = page.locator('.react-flow__node[data-id="probe-a"]');
  const b = page.locator('.react-flow__node[data-id="probe-b"]');
  c = page.locator('.react-flow__node[data-id="probe-c"]');
  cBox = (await c.boundingBox())!;
  await a.click();
  await b.click({ modifiers: ["Shift"] });
  const batchHandleBox = (await page
    .getByTestId("batch-connect-handle")
    .boundingBox())!;
  await page.mouse.move(
    batchHandleBox.x + batchHandleBox.width / 2,
    batchHandleBox.y + batchHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2, {
    steps: 6,
  });
  const batchPreview = page.getByTestId("batch-connection-preview");
  await expect(batchPreview).toBeVisible();
  await expect(batchPreview).toHaveCSS("z-index", "3");
  await expect(page.locator(".react-flow__renderer")).toHaveCSS(
    "z-index",
    "4",
  );
  expect(
    (await canvasLayersAt(
      page,
      cBox.x + cBox.width / 2,
      cBox.y + cBox.height / 2,
    ))[0],
  ).toBe("node:probe-c");
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await page.goto("/__fixture/interaction.source-aware-connect-menus-current");
  const world = page.getByTestId("canvas-world");
  const image = page.locator('.react-flow__node[data-id="probe-image"]');
  const video = page.locator('.react-flow__node[data-id="probe-video"]');
  source = image.locator(".react-flow__handle.source .node-handle-hit");
  const [worldBox, videoBox] = await Promise.all([
    world.boundingBox(),
    video.boundingBox(),
  ]);
  sourceBox = (await source.boundingBox())!;
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    worldBox!.x + worldBox!.width - 24,
    videoBox!.y + videoBox!.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  const sourcePreview = page.getByTestId("source-connect-preview");
  await expect(page.getByTestId("source-connect-menu")).toBeVisible();
  await expect(sourcePreview).toBeVisible();
  await expect(sourcePreview).toHaveCSS("z-index", "3");
  expect(
    (await canvasLayersAt(
      page,
      videoBox!.x + videoBox!.width / 2,
      videoBox!.y + videoBox!.height / 2,
    ))[0],
  ).toBe("node:probe-video");

  const after = (await (
    await request.get("/api/generation-tasks/status")
  ).json()) as { paidProviderRequests: number };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(paidRequests).toEqual([]);
});

test("a connection can land anywhere on the target body while invalid drops cancel", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.manual-connect-image-to-video");
  const world = page.getByTestId("canvas-world");
  const node = (id: string) =>
    page.locator(`.react-flow__node[data-id="${id}"]`);
  const handle = (id: string, type: "source" | "target") =>
    page.locator(
      `.react-flow__node[data-id="${id}"] .react-flow__handle.${type} .node-handle-hit`,
    );

  await expect(world).toHaveAttribute("data-edge-count", "1");
  await node("probe-b").click();
  await dragConnection(page, handle("probe-b", "source"), node("probe-c"));
  await page.mouse.up();
  await expect(world).toHaveAttribute("data-edge-count", "2");

  const invalidPairs: Array<[Locator, Locator]> = [
    [handle("probe-b", "source"), node("probe-c")],
    [handle("probe-c", "source"), node("probe-b")],
    [handle("probe-a", "source"), node("probe-a")],
    [handle("probe-a", "source"), handle("probe-b", "source")],
  ];

  for (const [source, target] of invalidPairs) {
    await source
      .locator(
        "xpath=ancestor::*[@data-id and contains(@class,'react-flow__node')][1]",
      )
      .click();
    await dragConnection(page, source, target);
    await page.mouse.up();
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await expect(page.locator(".react-flow__connectionline")).toHaveCount(0);
  }

  await dragConnection(page, handle("probe-a", "source"));
  await expect(page.locator(".react-flow__connectionline")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".react-flow__connectionline")).toHaveCount(0);
  await page.mouse.up();
  await expect(world).toHaveAttribute("data-edge-count", "2");

  await dragConnection(page, handle("probe-a", "source"));
  await expect(page.locator(".react-flow__connectionline")).toBeVisible();
  await page.mouse.up();
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect(page.locator(".react-flow__connectionline")).toHaveCount(0);
});

test("self, duplicate, reverse-cycle and source-to-source attempts stay invalid", async ({
  page,
}) => {
  await page.goto("/__fixture/legacy.interaction.invalid-same-side-edge");
  const world = page.getByTestId("canvas-world");
  const node = (id: string) =>
    page.locator(`.react-flow__node[data-id="${id}"]`);
  const handle = (id: string, type: "source" | "target") =>
    page.locator(
      `.react-flow__node[data-id="${id}"] .react-flow__handle.${type} .node-handle-hit`,
    );

  await expect(world).toHaveAttribute("data-edge-count", "1");
  const invalidPairs: Array<[Locator, Locator]> = [
    [handle("probe-a", "source"), node("probe-a")],
    [handle("probe-a", "source"), node("probe-b")],
    [handle("probe-b", "source"), node("probe-a")],
    [handle("probe-a", "source"), handle("probe-b", "source")],
  ];

  for (const [source, target] of invalidPairs) {
    await source
      .locator(
        "xpath=ancestor::*[@data-id and contains(@class,'react-flow__node')][1]",
      )
      .click();
    await dragConnection(page, source, target);
    await page.mouse.up();
    await expect(world).toHaveAttribute("data-edge-count", "1");
    await expect(page.locator(".react-flow__connectionline")).toHaveCount(0);
  }

  await node("probe-b").click();
  await dragConnection(page, handle("probe-b", "source"), node("probe-c"));
  await page.mouse.up();
  await expect(world).toHaveAttribute("data-edge-count", "2");
});
