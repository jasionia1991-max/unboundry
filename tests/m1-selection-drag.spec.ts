import { expect, test } from "@playwright/test";

test("click, Shift-click and four-direction marquee selection", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.selection-and-keyboard-move");
  const world = page.getByTestId("canvas-world");
  const a = page.locator('.react-flow__node[data-id="probe-a"]');
  const b = page.locator('.react-flow__node[data-id="probe-b"]');

  await expect(a.locator(".node-handle-plus").first()).toHaveCSS("opacity", "0");
  await expect(a.locator(".node-handle-plus").last()).toHaveCSS("opacity", "0");
  await expect(b.locator(".node-handle-plus").first()).toHaveCSS("opacity", "0");
  await a.hover();
  await expect(a.locator(".node-handle-plus").first()).toHaveCSS("opacity", "1");
  await expect(a.locator(".node-handle-plus").last()).toHaveCSS("opacity", "1");
  await page.mouse.move(1000, 700);
  await expect(a.locator(".node-handle-plus").first()).toHaveCSS("opacity", "0");
  await a.click();
  await expect(a).toHaveClass(/selected/);
  await expect(a).toHaveCSS("outline-color", "rgb(122, 122, 122)");
  await expect(a).toHaveCSS("outline-width", "2px");
  await expect(a.locator(".probe-node")).toHaveCSS(
    "border-color",
    "rgba(255, 255, 255, 0.1)",
  );
  await expect(
    a.locator(".react-flow__resize-control.handle").first(),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(a.locator(".node-handle-plus").first()).toHaveCSS("opacity", "1");
  await expect(a.locator(".node-handle-plus").last()).toHaveCSS("opacity", "1");
  await page.mouse.move(1000, 700);
  await expect(a.locator(".node-handle-plus").first()).toHaveCSS("opacity", "1");
  await expect(b.locator(".node-handle-plus").first()).toHaveCSS("opacity", "0");
  await expect(a).toHaveCSS("z-index", "1000");
  await expect(world).toHaveAttribute("data-primary-node", "probe-a");

  await b.click({ modifiers: ["Shift"] });
  await expect(a).toHaveClass(/selected/);
  await expect(b).toHaveClass(/selected/);
  await expect(world).toHaveAttribute("data-primary-node", "probe-b");

  await b.click({ modifiers: ["Shift"] });
  await expect(a).toHaveClass(/selected/);
  await expect(b).not.toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);

  await page.mouse.click(1000, 700);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  await expect(world).not.toHaveAttribute("data-primary-node", /.+/);

  const directions = [
    [280, 160, 890, 450],
    [890, 160, 280, 450],
    [280, 450, 890, 160],
    [890, 450, 280, 160],
  ];

  for (const [startX, startY, endX, endY] of directions) {
    await page.mouse.click(1000, 700);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
    await expect(a).toHaveClass(/selected/);
    await expect(b).toHaveClass(/selected/);
  }

  const multiSelection = page.locator(".react-flow__nodesselection-rect");
  await expect(multiSelection).toHaveCSS(
    "border-color",
    "rgba(255, 255, 255, 0.376)",
  );
  await expect(multiSelection).toHaveCSS(
    "background-color",
    "rgba(255, 255, 255, 0.125)",
  );
  await expect(multiSelection).toHaveCSS("border-radius", "16px");
  await expect(multiSelection).toHaveCSS("box-shadow", "none");
});

test("keyboard movement, pointer drag and 20px snap use world coordinates", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.selection-and-keyboard-move");
  const c = page.locator('.react-flow__node[data-id="probe-c"]');

  await c.click();
  const beforeKeyboard = await c.boundingBox();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  let afterKeyboard = await c.boundingBox();
  expect(afterKeyboard!.x - beforeKeyboard!.x).toBe(5);
  expect(afterKeyboard!.y - beforeKeyboard!.y).toBe(20);

  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const box = await c.boundingBox();
      return { x: box?.x, y: box?.y };
    })
    .toEqual({ x: beforeKeyboard!.x, y: beforeKeyboard!.y });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  afterKeyboard = await c.boundingBox();

  await page.mouse.move(
    afterKeyboard!.x + afterKeyboard!.width / 2,
    afterKeyboard!.y + afterKeyboard!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    afterKeyboard!.x + afterKeyboard!.width / 2 + 53,
    afterKeyboard!.y + afterKeyboard!.height / 2 + 37,
    { steps: 6 },
  );
  await page.mouse.up();
  const afterDrag = await c.boundingBox();
  expect(afterDrag!.x).toBeGreaterThan(afterKeyboard!.x);
  expect(afterDrag!.y).toBeGreaterThan(afterKeyboard!.y);

  const snap = page.getByTestId("snap-toggle");
  await snap.click();
  await expect(snap).toHaveAttribute("data-active", "true");

  await page.mouse.move(
    afterDrag!.x + afterDrag!.width / 2,
    afterDrag!.y + afterDrag!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    afterDrag!.x + afterDrag!.width / 2 + 53,
    afterDrag!.y + afterDrag!.height / 2 + 37,
    { steps: 6 },
  );
  await page.mouse.up();
  const afterSnap = await c.boundingBox();
  expect(afterSnap!.x % 20).toBe(0);
  expect(afterSnap!.y % 20).toBe(0);
  await expect(page.locator(".canvas-grid")).toBeVisible();
});

test("real pointer drag at zoom 1.3 converts screen delta to world delta", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.pointer-drag-at-1.3");
  await page.getByTestId("zoom-slider").fill("1.3");
  const c = page.locator('.react-flow__node[data-id="probe-c"]');
  const beforeScreen = await c.boundingBox();
  const beforeWorld = await c.evaluate((element) =>
    element
      .getAttribute("style")!
      .match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!
      .slice(1)
      .map(Number),
  );

  await page.mouse.move(
    beforeScreen!.x + beforeScreen!.width / 2,
    beforeScreen!.y + 60,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeScreen!.x + beforeScreen!.width / 2 - 50,
    beforeScreen!.y + 135,
    { steps: 6 },
  );
  await page.mouse.up();

  const afterScreen = await c.boundingBox();
  const afterWorld = await c.evaluate((element) =>
    element
      .getAttribute("style")!
      .match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!
      .slice(1)
      .map(Number),
  );

  expect((afterScreen!.x - beforeScreen!.x) / 1.3).toBeCloseTo(
    afterWorld[0] - beforeWorld[0],
    3,
  );
  expect((afterScreen!.y - beforeScreen!.y) / 1.3).toBeCloseTo(
    afterWorld[1] - beforeWorld[1],
    3,
  );
});

test("dragging at each viewport edge auto-pans without changing zoom", async ({
  page,
}) => {
  const cases = [
    { axis: "x", direction: 1, edge: "left", nodeId: "collision-a" },
    { axis: "x", direction: -1, edge: "right", nodeId: "collision-b" },
    { axis: "y", direction: 1, edge: "top", nodeId: "collision-a" },
    { axis: "y", direction: -1, edge: "bottom", nodeId: "collision-a" },
  ] as const;

  for (const sample of cases) {
    await page.goto(
      "/__fixture/interaction.edge-auto-scroll-and-collision",
    );
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-edge-auto-pan", "true");
    const node = page.locator(
      `.react-flow__node[data-id="${sample.nodeId}"]`,
    );
    const box = await node.boundingBox();
    const start = {
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    };
    const end = {
      x:
        sample.edge === "left"
          ? 2
          : sample.edge === "right"
            ? 1133
            : start.x,
      y:
        sample.edge === "top"
          ? 2
          : sample.edge === "bottom"
            ? 915
            : start.y,
    };
    const before = {
      x: Number(await world.getAttribute("data-viewport-x")),
      y: Number(await world.getAttribute("data-viewport-y")),
      zoom: Number(await world.getAttribute("data-viewport-zoom")),
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    for (let repeat = 0; repeat < 4; repeat += 1) {
      await page.mouse.move(end.x, end.y);
      await page.waitForTimeout(24);
    }
    await page.mouse.up();

    const after = {
      x: Number(await world.getAttribute("data-viewport-x")),
      y: Number(await world.getAttribute("data-viewport-y")),
      zoom: Number(await world.getAttribute("data-viewport-zoom")),
    };
    expect(after.zoom).toBe(before.zoom);
    expect(
      (after[sample.axis] - before[sample.axis]) * sample.direction,
      sample.edge,
    ).toBeGreaterThan(0);
  }
});

test("node overlap is allowed normally and blocked only with snap enabled", async ({
  page,
}) => {
  await page.goto(
    "/__fixture/interaction.edge-auto-scroll-and-collision",
  );
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-node-collision", "allow-overlap");
  let moving = page.locator(
    '.react-flow__node[data-id="collision-a"]',
  );
  let stationary = page.locator(
    '.react-flow__node[data-id="collision-b"]',
  );
  let before = await moving.boundingBox();
  let target = await stationary.boundingBox();

  await page.mouse.move(
    before!.x + before!.width / 2,
    before!.y + before!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 16 },
  );
  await page.mouse.up();

  let after = await moving.boundingBox();
  let fixed = await stationary.boundingBox();
  expect(
    after!.x < fixed!.x + fixed!.width &&
      after!.x + after!.width > fixed!.x &&
      after!.y < fixed!.y + fixed!.height &&
      after!.y + after!.height > fixed!.y,
  ).toBe(true);

  await page.reload();
  const snap = page.getByTestId("snap-toggle");
  await snap.click();
  await expect(snap).toHaveAttribute("data-active", "true");
  await expect(world).toHaveAttribute(
    "data-node-collision",
    "last-valid-position",
  );
  moving = page.locator('.react-flow__node[data-id="collision-a"]');
  stationary = page.locator('.react-flow__node[data-id="collision-b"]');
  before = await moving.boundingBox();
  target = await stationary.boundingBox();

  await page.mouse.move(
    before!.x + before!.width / 2,
    before!.y + before!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 16 },
  );
  await page.mouse.up();

  after = await moving.boundingBox();
  fixed = await stationary.boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x);
  expect(
    after!.x + after!.width <= fixed!.x ||
      fixed!.x + fixed!.width <= after!.x ||
      after!.y + after!.height <= fixed!.y ||
      fixed!.y + fixed!.height <= after!.y,
  ).toBe(true);
  expect(after!.x % 20).toBe(0);
  expect(after!.y % 20).toBe(0);
});

test("eight resize controls allow unlocked bottom-right resize", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.resize-bottom-right");
  const c = page.locator('.react-flow__node[data-id="probe-c"]');
  await c.click();
  await expect(c.locator(".react-flow__resize-control")).toHaveCount(8);

  const before = await c.boundingBox();
  const handle = c.locator(
    ".react-flow__resize-control.handle.bottom.right",
  );
  const handleBox = await handle.boundingBox();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 92,
    handleBox!.y + handleBox!.height / 2 + 61,
  );
  await page.waitForTimeout(20);
  await page.mouse.up();

  const after = await c.boundingBox();
  expect(after!.x).toBe(before!.x);
  expect(after!.y).toBe(before!.y);
  expect(after!.width).toBeGreaterThan(before!.width);
  expect(after!.height).toBeGreaterThan(before!.height);
  expect(after!.width / after!.height).not.toBeCloseTo(1);
});
