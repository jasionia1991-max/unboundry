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
  await expect(minimap).toHaveCSS("pointer-events", "none");
  const dragLayer = page.getByRole("application", { name: "拖动小地图" });
  await expect(dragLayer).toHaveCSS("cursor", "grab");
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
    .poll(async () => ({
      x: Number(await world.getAttribute("data-viewport-x")),
      y: Number(await world.getAttribute("data-viewport-y")),
    }))
    .toEqual({ x: beforePan.x - 48, y: beforePan.y - 32 });
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
  await expect(nodes).toHaveCount(5);
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
  await expect.poll(() =>
    edge.evaluate((element) => getComputedStyle(element.parentElement!).zIndex),
  ).toBe("1001");
  await page.mouse.click(1000, 700);
  await expect(edge).not.toHaveClass(/connected-to-selected-node/);
  await expect.poll(() =>
    edge.evaluate((element) => getComputedStyle(element.parentElement!).zIndex),
  ).toBe("0");
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
