import { expect, test } from "./safe-test";

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
