import { expect, test } from "@playwright/test";

test("dense canvas keeps 62 nodes, 58 edges and 5 groups responsive", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["fetch", "xhr"].includes(request.resourceType()) &&
      !url.pathname.startsWith("/api/project-title/")
    ) {
      requests.push(request.url());
    }
  });

  await page.goto("/__fixture/legacy.dense-canvas.neutral");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-node-count", "62");
  await expect(world).toHaveAttribute("data-edge-count", "58");
  await expect(world).toHaveAttribute("data-group-count", "5");
  await expect(world).toHaveAttribute("data-viewport-zoom", "0.15");
  // 可视区域渲染：DOM 只挂载视口内节点，全量计数改由 data-* 属性保证。
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await expect(page.locator(".react-flow__edge:visible").first()).toBeVisible();
  await expect(
    page.locator('[data-node-variant="group"]:visible').first(),
  ).toBeVisible();
  requests.length = 0;

  await page.evaluate(() => {
    const state = window as typeof window & {
      denseLongTasks?: number[];
      denseObserver?: PerformanceObserver;
    };
    state.denseLongTasks = [];
    state.denseObserver = new PerformanceObserver((list) => {
      state.denseLongTasks!.push(
        ...list.getEntries().map((entry) => entry.duration),
      );
    });
    state.denseObserver.observe({ entryTypes: ["longtask"] });
  });

  const node = page.locator(".react-flow__node:visible").first();
  const before = await node.boundingBox();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + 60, before!.y + 45, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId("zoom-slider").fill("0.3");
  await page.getByTestId("minimap-toggle").click();
  await expect(page.locator(".tap-minimap")).toBeVisible();
  await page.waitForTimeout(150);

  const longTasks = await page.evaluate(() => {
    const state = window as typeof window & {
      denseLongTasks?: number[];
      denseObserver?: PerformanceObserver;
    };
    state.denseObserver?.disconnect();
    return state.denseLongTasks ?? [];
  });
  expect(longTasks.filter((duration) => duration >= 250)).toEqual([]);
  expect(requests).toEqual([]);
  await expect(world).toHaveAttribute("data-node-count", "62");
  await expect(world).toHaveAttribute("data-edge-count", "58");
});
