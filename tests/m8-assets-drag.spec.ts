import { expect, test } from "./safe-test";

const canvasId = "panel.assets.drag-ready";

test.beforeEach(async ({ request }) => {
  await request.delete(`/api/canvas/${canvasId}`);
});

test.afterEach(async ({ request }) => {
  const response = await request.get(`/api/canvas/${canvasId}`);
  if (response.ok()) {
    const document = (await response.json()) as {
      nodes: Array<{ data?: { assetId?: string; mediaContentType?: string } }>;
    };
    await Promise.all(
      document.nodes
        .filter((node) => node.data?.mediaContentType?.startsWith("image/"))
        .map((node) => node.data?.assetId)
        .filter((assetId): assetId is string => Boolean(assetId))
        .map((assetId) => request.delete(`/api/assets/${assetId}`)),
    );
  }
  await request.delete(`/api/canvas/${canvasId}`);
});

test("library media and a local image file drag onto the canvas and survive reload", async ({
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
  const initialUrl = page.url();
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
  const prevented = await page.evaluate(async () => {
    const response = await fetch("/templates/ecommerce-detail-workflow.png");
    const bytes = await response.arrayBuffer();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped-detail.png", {
      type: "image/png",
    }));
    const target = document.querySelector<HTMLElement>(
      '[data-testid="canvas-world"]',
    );
    if (!target) throw new Error("Canvas world is missing");
    const dragOverAccepted = !target.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      clientX: 520,
      clientY: 320,
      dataTransfer: transfer,
    }));
    const dropAccepted = !target.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: 520,
      clientY: 320,
      dataTransfer: transfer,
    }));
    return { dragOverAccepted, dropAccepted };
  });

  expect(prevented).toEqual({
    dragOverAccepted: true,
    dropAccepted: true,
  });
  expect(page.url()).toBe(initialUrl);
  await expect(world).toHaveAttribute("data-node-count", "4");
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  await expect(page.locator(
    '[data-testid="image-node-title-input"][value="dropped-detail"]',
  )).toHaveCount(1);

  await expect
    .poll(async () => {
      const canvas = await request.get(`/api/canvas/${canvasId}`);
      if (!canvas.ok()) return 0;
      const document = (await canvas.json()) as { nodes: unknown[] };
      return document.nodes.length;
    })
    .toBe(4);
  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "4");
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  expect(page.url()).toBe(initialUrl);
  expect(providerRequests).toEqual([]);
});
