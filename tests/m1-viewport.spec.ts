import { expect, test } from "./safe-test";
import {
  screenToWorld,
  worldToScreen,
} from "../client/src/canvas/viewportMath";

test("screen and world coordinates are inverse at zoom 1.3", () => {
  const viewport = { x: 60, y: -30, zoom: 1.3 };
  const world = screenToWorld({ x: 190, y: 100 }, viewport);

  expect(world).toEqual({ x: 100, y: 100 });
  expect(worldToScreen(world, viewport)).toEqual({ x: 190, y: 100 });
  expect(screenToWorld({ x: 140, y: 175 }, viewport)).toEqual({
    x: 61.53846153846153,
    y: 157.69230769230768,
  });
});

test("drag pan, scroll pan, pinch zoom, slider and fit preserve screen chrome", async ({
  page,
}) => {
  await page.goto("/__fixture/shell.empty.primary");
  const world = page.getByTestId("canvas-world");
  const topRight = page.getByTestId("top-right");
  const frozenTopRight = await topRight.boundingBox();

  await expect(world).toHaveAttribute("data-viewport-zoom", "1");
  const slider = page.getByTestId("zoom-slider");
  await expect(slider).toHaveAttribute("min", "0.15");
  await expect(slider).toHaveAttribute("max", "2");
  await slider.fill("1.3");
  await expect(world).toHaveAttribute("data-viewport-zoom", "1.3");
  await expect(page.locator(".canvas-grid pattern")).toHaveAttribute(
    "width",
    "26",
  );
  await expect(page.locator(".canvas-grid circle")).toHaveAttribute(
    "r",
    "0.65",
  );

  await page.mouse.move(800, 300);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(850, 375);
  await page.mouse.up({ button: "middle" });
  expect(Number(await world.getAttribute("data-viewport-x"))).toBeCloseTo(50);
  expect(Number(await world.getAttribute("data-viewport-y"))).toBeCloseTo(75);
  expect(await topRight.boundingBox()).toEqual(frozenTopRight);

  await page.getByTestId("fit-view").click();
  await expect(world).toHaveAttribute("data-viewport-x", "0");
  await expect(world).toHaveAttribute("data-viewport-y", "0");
  await expect(world).toHaveAttribute("data-viewport-zoom", "1");

  await page.mouse.move(800, 300);
  await page.mouse.wheel(120, 80);
  await expect(world).toHaveAttribute("data-viewport-zoom", "1");
  await expect
    .poll(async () => Number(await world.getAttribute("data-viewport-x")))
    .toBeCloseTo(-72, 3);
  await expect
    .poll(async () => Number(await world.getAttribute("data-viewport-y")))
    .toBeCloseTo(-48, 3);

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => Number(await world.getAttribute("data-viewport-zoom")))
    .toBeGreaterThan(1);
  expect(await topRight.boundingBox()).toEqual(frozenTopRight);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  await page.getByTestId("fit-view").click();
  await expect(world).toHaveAttribute("data-viewport-zoom", "1");

  await slider.fill("0.15");
  await expect(world).toHaveAttribute("data-viewport-zoom", "0.15");
  await expect(page.locator(".canvas-grid pattern")).toHaveAttribute(
    "width",
    "3",
  );
  await expect(page.locator(".canvas-grid circle")).toHaveAttribute(
    "r",
    "0.075",
  );

  await slider.fill("2");
  await expect(world).toHaveAttribute("data-viewport-zoom", "2");
  await expect(page.locator(".canvas-grid pattern")).toHaveAttribute(
    "width",
    "40",
  );
  await expect(page.locator(".canvas-grid circle")).toHaveAttribute("r", "1");
});
