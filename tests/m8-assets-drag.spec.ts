import { expect, test } from "@playwright/test";

const canvasId = "panel.assets.drag-ready";

test.beforeEach(async ({ request }) => {
  await request.delete(`/api/canvas/${canvasId}`);
});

test("Library image, video and audio drag onto the canvas and survive reload", async ({
  page,
  request,
}) => {
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      providerRequests.push(request.url());
    }
  });

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  const assets = page.getByTestId("assets-library-grid");
  await expect(assets.getByRole("button")).toHaveCount(3);

  await assets
    .getByRole("button", { name: "拖动素材 森林光影" })
    .dragTo(world, { targetPosition: { x: 490, y: 270 } });
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);

  await assets
    .getByRole("button", { name: "拖动素材 海边镜头" })
    .dragTo(world, { targetPosition: { x: 760, y: 300 } });
  await expect(page.locator(".react-flow__node-video")).toHaveCount(1);

  await assets
    .getByRole("button", { name: "拖动素材 环境音乐" })
    .dragTo(world, { targetPosition: { x: 560, y: 610 } });
  await expect(page.locator(".react-flow__node-audio")).toHaveCount(1);
  await expect(page.locator(".audio-waveform-bars span")).toHaveCount(64);
  await expect(assets.getByRole("button")).toHaveCount(3);

  await expect
    .poll(async () => {
      const response = await request.get(`/api/canvas/${canvasId}`);
      if (!response.ok()) return 0;
      const document = (await response.json()) as { nodes: unknown[] };
      return document.nodes.length;
    })
    .toBe(3);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(page.locator(".react-flow__node-image")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-video")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-audio")).toHaveCount(1);
  await expect(page.locator(".audio-waveform-bars span")).toHaveCount(64);
  expect(providerRequests).toEqual([]);
});
