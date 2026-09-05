import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./safe-test";
import { composeTextControl } from "./helpers/ime";

async function canvasGraphSnapshot(page: Page) {
  return page.evaluate(() => {
    const world = document.querySelector<HTMLElement>("[data-testid=canvas-world]");
    return {
      edges: Array.from(document.querySelectorAll<SVGPathElement>(
        ".react-flow__edge-path",
      )).map((edge) => edge.getAttribute("d")),
      nodes: Array.from(document.querySelectorAll<HTMLElement>(
        ".react-flow__node",
      )).map((node) => ({
        height: node.style.height,
        id: node.dataset.id,
        transform: node.style.transform,
        width: node.style.width,
      })),
      world: {
        edgeCount: world?.dataset.edgeCount,
        groupCount: world?.dataset.groupCount,
        nodeCount: world?.dataset.nodeCount,
        saveFingerprintCount: world?.dataset.saveFingerprintCount,
        viewportX: world?.dataset.viewportX,
        viewportY: world?.dataset.viewportY,
        viewportZoom: world?.dataset.viewportZoom,
      },
    };
  });
}

async function mockGroupLayoutTriggerRect(
  page: Page,
  target: { left: number; top: number },
) {
  await page.getByRole("button", { name: "组合框布局" }).evaluate(
    (element, next) => {
      const bounds = element.getBoundingClientRect();
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => DOMRect.fromRect({
          height: bounds.height,
          width: bounds.width,
          x: next.left,
          y: next.top,
        }),
      });
    },
    target,
  );
}

test("Group keeps children stable through create, move, resize, delete and ungroup", async ({
  page,
}) => {
  const source = readFileSync("client/src/canvas/GroupNode.tsx", "utf8");
  expect(source).not.toContain("const beginMove =");
  expect(source).not.toContain("onPointerDown={beginMove}");
  await page.goto("/__fixture/interaction.selection-and-keyboard-move");

  const nodeA = page.getByTestId("probe-node-probe-a");
  const nodeB = page.getByTestId("probe-node-probe-b");
  const beforeA = (await nodeA.boundingBox())!;
  const beforeB = (await nodeB.boundingBox())!;
  await nodeA.click();
  await nodeB.click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "打组" }).click();

  let group = page.locator(".react-flow__node-group");
  await expect(group).toHaveCount(1);
  await expect(group).toHaveClass(/draggable/);
  await expect(group.locator(".group-node-body")).toHaveAttribute(
    "data-child-count",
    "2",
  );
  expect((await nodeA.boundingBox())!.x).toBeCloseTo(beforeA.x, 0);
  expect((await nodeB.boundingBox())!.x).toBeCloseTo(beforeB.x, 0);
  await expect(page.getByTestId("group-node-toolbar")).toHaveCount(1);
  expect(await page.getByTestId("group-node-toolbar").boundingBox()).toMatchObject(
    { height: 48, width: 390 },
  );
  await expect(page.locator(".react-flow__nodesselection")).toHaveCount(0);

  const dragPoint = await group.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let y = rect.top + 10; y < rect.bottom - 10; y += 10) {
      for (let x = rect.left + 10; x < rect.right - 10; x += 10) {
        const target = document.elementFromPoint(x, y);
        if (
          target?.closest(".react-flow__node") === element &&
          !target.closest("button, input, .nodrag, .react-flow__resize-control")
        ) return { x, y };
      }
    }
    throw new Error("Group has no native draggable body point");
  });
  await page.mouse.move(dragPoint.x, dragPoint.y);
  await page.mouse.down();
  await page.mouse.move(
    dragPoint.x,
    dragPoint.y + 50,
    { steps: 5 },
  );
  await expect(group).toHaveClass(/dragging/);
  await page.mouse.up();
  expect((await nodeA.boundingBox())!.y).toBeGreaterThan(beforeA.y + 30);

  const childSize = (await nodeA.boundingBox())!;
  const resize = group.locator(".react-flow__resize-control.bottom.right");
  const resizeBox = (await resize.boundingBox())!;
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2,
    resizeBox.y + resizeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 80, resizeBox.y + 50);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await page.mouse.up();
  expect((await nodeA.boundingBox())!.width).toBeCloseTo(childSize.width, 0);
  expect((await nodeA.boundingBox())!.height).toBeCloseTo(childSize.height, 0);

  await page.keyboard.press("Backspace");
  await expect(group).toHaveCount(0);
  await expect(page.locator(".react-flow__node-probe")).toHaveCount(1);
  await page.keyboard.press("Meta+z");
  group = page.locator(".react-flow__node-group");
  await expect(group).toHaveCount(1);
  await expect(page.locator(".react-flow__node-probe")).toHaveCount(3);

  await page.getByRole("button", { name: "解组" }).click();
  await expect(group).toHaveCount(0);
  await expect(page.locator(".react-flow__node-probe")).toHaveCount(3);
});

test("Selected Group matches the frozen shell and title behavior", async ({
  page,
}) => {
  await page.goto("/__fixture/node.group.selected");
  const group = page.locator(".react-flow__node-group");
  const toolbar = page.getByTestId("group-node-toolbar");

  expect(await group.boundingBox()).toMatchObject({ height: 290, width: 1034 });
  expect(await toolbar.boundingBox()).toMatchObject({ height: 48, width: 390 });
  await expect(group.locator(".react-flow__resize-control")).toHaveCount(8);
  const title = page.getByLabel("组合框标题");
  await expect(title).toHaveValue("新建组");
  await composeTextControl(title, ["xin zu", "新组"]);
  await expect(title).toHaveValue("新组");
  await title.press("Meta+z");
  await expect(title).toHaveValue("新建组");
  await title.press("Meta+Shift+z");
  await expect(title).toHaveValue("新组");

  await page.getByRole("button", { name: "组合框颜色" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("button", { name: "设置颜色" }).first().click();
  await expect(page.getByTestId("group-node-group-primary")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("Group layout reflows children into grid and horizontal positions", async ({
  page,
}) => {
  await page.goto("/__fixture/node.group.selected");
  const image = page.getByTestId("image-node-group-image");
  const video = page.getByTestId("video-node-group-video");
  const group = page.locator(".react-flow__node-group");
  await group.click({ force: true, position: { x: 8, y: 8 } });
  const beforeImage = (await image.boundingBox())!;
  const beforeVideo = (await video.boundingBox())!;
  const beforeGroup = (await group.boundingBox())!;

  await page.getByRole("button", { name: "组合框布局" }).click();
  await expect(page.getByRole("button", { name: "宫格" })).toBeVisible();
  await page.getByRole("button", { name: "宫格" }).click();
  await expect
    .poll(async () => (await video.boundingBox())?.x ?? -1)
    .not.toBe(beforeVideo.x);
  await expect
    .poll(async () => (await group.boundingBox())?.width ?? -1)
    .not.toBe(beforeGroup.width);

  await page.getByRole("button", { name: "组合框布局" }).click();
  await expect(page.getByRole("button", { name: "水平" })).toBeVisible();
  await page.getByRole("button", { name: "水平" }).click();
  await expect
    .poll(async () => (await video.boundingBox())?.x ?? -1)
    .not.toBe(beforeVideo.x);
  await expect
    .poll(async () => (await group.boundingBox())?.width ?? -1)
    .not.toBe(beforeGroup.width);
});

test("Dense template Group keeps the frozen geometry and chrome", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let canvasPuts = 0;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/canvas\//.test(request.url())
    ) {
      canvasPuts += 1;
    }
  });
  await page.goto("/__fixture/legacy.node.group-dense-selected");

  const group = page.locator(".react-flow__node-group");
  const toolbar = page.getByTestId("group-node-toolbar");
  await expect.poll(async () => page.evaluate(() => {
    const groupElement = document.querySelector<HTMLElement>(
      ".react-flow__node-group",
    );
    const viewportElement = document.querySelector<HTMLElement>(
      ".react-flow__viewport",
    );
    const viewport = Number(
      viewportElement?.style.transform.match(/scale\(([^)]+)\)/)?.[1],
    );
    const groupBox = groupElement?.getBoundingClientRect();
    return Boolean(
      groupBox &&
      viewport > 0 &&
      Math.abs(groupBox.height / viewport - 2111) < 0.1 &&
      Math.abs(groupBox.width / viewport - 3443) < 0.1,
    );
  })).toBe(true);
  expect(await toolbar.boundingBox()).toMatchObject({ height: 48, width: 390 });
  await expect(group.locator(".react-flow__resize-control")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "更新模板" })).toBeDisabled();

  const handle = group.locator(".react-flow__resize-control.top.left");
  expect(await handle.boundingBox()).toMatchObject({ height: 24, width: 24 });

  canvasPuts = 0;
  const graphBefore = await canvasGraphSnapshot(page);
  const trigger = page.getByRole("button", { name: "组合框布局" });
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByTestId("group-layout-menu");
  await expect(menu).toHaveClass(/nodrag/);
  await expect(menu).toHaveClass(/nopan/);
  await expect(menu).toHaveClass(/nowheel/);
  await expect(menu).toHaveCSS("position", "fixed");
  expect(await menu.evaluate((element) => element.parentElement === document.body))
    .toBe(true);
  expect(await trigger.getAttribute("aria-controls")).toBe(
    await menu.getAttribute("id"),
  );
  for (const name of ["宫格", "水平"] as const) {
    const button = page.getByRole("button", { name });
    await expect(button).toBeVisible();
    expect(await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      ) === element;
    })).toBe(true);
  }

  const viewportBeforeGesture = await page.getByTestId("canvas-world").evaluate(
    (element) => ({
      x: element.dataset.viewportX,
      y: element.dataset.viewportY,
      zoom: element.dataset.viewportZoom,
    }),
  );
  const menuBox = (await menu.boundingBox())!;
  await page.mouse.move(menuBox.x + 3, menuBox.y + 3);
  await page.mouse.down();
  await page.mouse.move(menuBox.x + 18, menuBox.y + 12);
  await page.mouse.up();
  await expect(menu).toBeVisible();
  expect(await page.getByTestId("canvas-world").evaluate((element) => ({
    x: element.dataset.viewportX,
    y: element.dataset.viewportY,
    zoom: element.dataset.viewportZoom,
  }))).toEqual(viewportBeforeGesture);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await canvasGraphSnapshot(page)).toEqual(graphBefore);
  expect(canvasPuts).toBe(0);

  await trigger.click();
  await page.evaluate(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
    }));
  });
  await expect(menu).toHaveCount(0);
  expect(await canvasGraphSnapshot(page)).toEqual(graphBefore);
  expect(canvasPuts).toBe(0);

  await trigger.click();
  await menu.hover({ position: { x: 3, y: 3 } });
  await page.mouse.wheel(0, 80);
  await expect(menu).toHaveCount(0);
  expect(await page.getByTestId("canvas-world").evaluate((element) => ({
    x: element.dataset.viewportX,
    y: element.dataset.viewportY,
    zoom: element.dataset.viewportZoom,
  }))).toEqual(viewportBeforeGesture);
  expect(await canvasGraphSnapshot(page)).toEqual(graphBefore);
  expect(canvasPuts).toBe(0);

  for (const viewport of [
    { height: 720, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1080, width: 1920 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    const layoutTrigger = page.getByRole("button", { name: "组合框布局" });
    const layoutMenu = page.getByTestId("group-layout-menu");

    await mockGroupLayoutTriggerRect(page, { left: 64, top: 120 });
    await layoutTrigger.evaluate((element) => (element as HTMLElement).click());
    await expect(layoutMenu).toHaveAttribute("data-placement", "down");
    const defaultBounds = (await layoutMenu.boundingBox())!;
    expect(defaultBounds.x).toBeGreaterThanOrEqual(8);
    expect(defaultBounds.x + defaultBounds.width)
      .toBeLessThanOrEqual(viewport.width - 8);
    expect(defaultBounds.y).toBeGreaterThanOrEqual(8);
    expect(defaultBounds.y + defaultBounds.height)
      .toBeLessThanOrEqual(viewport.height - 8);
    for (const name of ["宫格", "水平"] as const) {
      const button = page.getByRole("button", { name });
      expect(await button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        ) === element;
      })).toBe(true);
    }
    await page.keyboard.press("Escape");

    await mockGroupLayoutTriggerRect(page, {
      left: 64,
      top: viewport.height - 52,
    });
    await layoutTrigger.evaluate((element) => (element as HTMLElement).click());
    await expect(layoutMenu).toHaveAttribute("data-placement", "up");
    const upBounds = (await layoutMenu.boundingBox())!;
    expect(upBounds.y + upBounds.height)
      .toBeLessThanOrEqual(viewport.height - 60);
    expect(upBounds.y).toBeGreaterThanOrEqual(8);
    await page.keyboard.press("Escape");

    await mockGroupLayoutTriggerRect(page, { left: 0, top: 120 });
    await layoutTrigger.evaluate((element) => (element as HTMLElement).click());
    expect((await layoutMenu.boundingBox())!.x).toBeGreaterThanOrEqual(8);
    await page.keyboard.press("Escape");

    await mockGroupLayoutTriggerRect(page, {
      left: viewport.width - 40,
      top: 120,
    });
    await layoutTrigger.evaluate((element) => (element as HTMLElement).click());
    const rightBounds = (await layoutMenu.boundingBox())!;
    expect(rightBounds.x + rightBounds.width)
      .toBeLessThanOrEqual(viewport.width - 8);
    await page.keyboard.press("Escape");
  }

  await page.reload();
  await page.getByRole("button", { name: "组合框布局" }).click();
  await page.locator(".react-flow__pane").click({ position: { x: 12, y: 12 } });
  await expect(page.getByTestId("group-layout-menu")).toHaveCount(0);
  await expect(page.getByTestId("group-node-toolbar")).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: "组合框布局" }).click();
  await page.goto("/__fixture/node.group.selected");
  await expect(page.getByTestId("group-layout-menu")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
  expect(canvasPuts).toBe(0);
});

test("Dense template Group downloads every available child asset", async ({
  page,
}) => {
  await page.goto("/__fixture/legacy.node.group-dense-selected");

  const downloads: import("@playwright/test").Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.getByRole("button", { name: "下载全部" }).click();

  await expect.poll(() => downloads.length).toBe(6);
  expect(downloads.map((download) => download.suggestedFilename())).toEqual([
    "1-素材 1.svg",
    "2-素材 2.svg",
    "3-素材 3.svg",
    "4-素材 4.svg",
    "5-素材 5.svg",
    "6-素材 6.svg",
  ]);
  for (const download of downloads) {
    expect(await download.failure()).toBeNull();
  }
});
