import { expect, test } from "./safe-test";

test("persisted small node cards stay inside their selected geometry at every zoom", async ({ page, request }) => {
  const nodes = [
    { id: "small-text", type: "text", style: { width: 260, height: 220 },
      position: { x: 140, y: 350 }, data: { content: "Preserved text", title: "Small text" } },
    { id: "small-image", type: "image", style: { width: 100, height: 90 },
      position: { x: 470, y: 350 }, data: { title: "Small image" } },
    { id: "small-video", type: "video", style: { width: 200, height: 120 },
      position: { x: 650, y: 350 }, data: { title: "Small video" } },
    { id: "small-audio", type: "audio", style: { width: 240, height: 140 },
      position: { x: 930, y: 350 }, data: { title: "Small audio" } },
  ];
  await page.setViewportSize({ width: 1800, height: 1100 });
  await request.delete("/api/canvas/default");
  const seed = await request.put("/api/canvas/default", {
    headers: { "X-Unboundry-Safe-Fixture-Seed": "default" },
    data: { nodes, edges: [], revision: 0, viewport: { x: 0, y: 0, zoom: 0.75 } },
  });
  expect(seed.ok()).toBe(true);
  await page.goto("/canvas");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
  for (const zoom of [0.5, 1, 1.25]) {
    await page.getByTestId("zoom-slider").fill(String(zoom));
    for (const { id, type, style } of nodes) {
      const node = page.locator(`.react-flow__node[data-id="${id}"]`);
      await node.click({ position: { x: 20, y: 20 } });
      await expect(node).toHaveClass(/selected/);
      await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
      const dimensions = await node.evaluate((element, kind) => {
        const card = element.querySelector(`.${kind}-node-card`)!;
        const outer = element.getBoundingClientRect();
        const inner = card.getBoundingClientRect();
        return { outer: { x: outer.x, y: outer.y, width: outer.width, height: outer.height },
          inner: { x: inner.x, y: inner.y, width: inner.width, height: inner.height },
          outline: getComputedStyle(element).outlineWidth };
      }, type);
      expect(dimensions.outline).toBe("2px");
      expect(dimensions.outer.width / zoom).toBeCloseTo(style.width, 0);
      expect(dimensions.outer.height / zoom).toBeCloseTo(style.height, 0);
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(dimensions.outer[key] - dimensions.inner[key]), `${id} ${key} at ${zoom}`).toBeLessThan(1);
      }
    }
  }
  const saved = await (await request.get("/api/canvas/default")).json();
  expect(saved.nodes.map(({ id, position, style }: typeof nodes[number]) => ({ id, position, style })).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)))
    .toEqual(nodes.map(({ id, position, style }) => ({ id, position, style })).sort((a, b) => a.id.localeCompare(b.id)));
  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
  await expect(sizeOf(page, "small-text")).resolves.toEqual({ width: 260, height: 220 });
});

const sizeOf = async (page: import("@playwright/test").Page, id: string) => {
  const zoom = Number(
    await page.getByTestId("canvas-world").getAttribute("data-viewport-zoom"),
  );
  const box = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  return {
    height: Math.round((box?.height ?? 0) / zoom),
    width: Math.round((box?.width ?? 0) / zoom),
  };
};

test("Node geometry catalog keeps defaults, media adaptation, and user resizing separate", async ({
  page,
}) => {
  await page.goto("/__fixture/legacy.node-geometry.families");

  await expect(page.getByTestId("canvas-shell")).toHaveAttribute(
    "data-fixture-id",
    "legacy.node-geometry.families",
  );
  // 可视区域渲染：先缩到最小档让目录页全部节点进入视口，再按类型计数。
  await page.getByTestId("zoom-slider").fill("0.15");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-viewport-zoom",
    "0.15",
  );
  await expect(page.locator(".react-flow__node-text")).toHaveCount(2);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(3);
  await expect(page.locator(".react-flow__node-video")).toHaveCount(3);
  await expect(page.locator(".react-flow__node-audio")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-playlist")).toHaveCount(2);
  await expect(page.locator(".react-flow__node-group")).toHaveCount(1);

  await expect(sizeOf(page, "geometry-default-text")).resolves.toEqual({
    height: 250,
    width: 250,
  });
  await expect(sizeOf(page, "geometry-default-image")).resolves.toEqual({
    height: 250,
    width: 250,
  });
  await expect(sizeOf(page, "geometry-default-video")).resolves.toEqual({
    height: 250,
    width: 444,
  });
  await expect(sizeOf(page, "geometry-default-audio")).resolves.toEqual({
    height: 250,
    width: 444,
  });
  await expect(sizeOf(page, "geometry-default-playlist")).resolves.toEqual({
    height: 104,
    width: 960,
  });

  for (const id of [
    "geometry-media-image-landscape",
    "geometry-media-video-landscape",
  ]) {
    await expect(sizeOf(page, id)).resolves.toEqual({ height: 250, width: 444 });
  }
  for (const id of [
    "geometry-media-image-portrait",
    "geometry-media-video-portrait",
  ]) {
    await expect(sizeOf(page, id)).resolves.toEqual({ height: 444, width: 250 });
  }

  await expect(sizeOf(page, "geometry-user-text")).resolves.toEqual({
    height: 320,
    width: 395,
  });
  await expect(sizeOf(page, "geometry-user-playlist")).resolves.toEqual({
    height: 220,
    width: 1100,
  });
  await expect(sizeOf(page, "geometry-user-group")).resolves.toEqual({
    height: 420,
    width: 1034,
  });

  for (const id of [
    "geometry-default-image",
    "geometry-default-video",
    "geometry-default-audio",
    "geometry-media-image-landscape",
    "geometry-media-video-landscape",
  ]) {
    await expect(
      page.locator(`.react-flow__node[data-id="${id}"] .react-flow__resize-control`),
    ).toHaveCount(0);
  }

  for (const id of [
    "geometry-default-image",
    "geometry-default-video",
    "geometry-default-audio",
    "geometry-media-image-landscape",
    "geometry-media-video-landscape",
    "geometry-user-text",
    "geometry-user-playlist",
    "geometry-user-group",
  ]) {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.click({ position: { x: 20, y: 20 } });
    await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
  }
});
