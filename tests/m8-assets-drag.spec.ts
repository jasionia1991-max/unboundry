import { expect, test, type APIRequestContext } from "./safe-test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const canvasId = "panel.assets.drag-ready";
const libraryFixtures = [
  {
    assetId: "m8-library-image.png",
    bytes: readFileSync(resolve("client/public/templates/ecommerce-detail-workflow.png")),
    contentType: "image/png",
    endpoint: "/api/assets/m8-library-image.png",
    kind: "image",
    label: "森林光影",
  },
  {
    assetId: "m8-library-video.mp4",
    bytes: readFileSync(resolve("client/public/fixtures/video-success.mp4")),
    contentType: "video/mp4",
    endpoint: "/api/video-assets/m8-library-video.mp4",
    kind: "video",
    label: "海边镜头",
  },
  {
    assetId: "m8-library-audio.mp3",
    bytes: readFileSync(resolve("client/public/fixtures/audio-success.mp3")),
    contentType: "audio/mpeg",
    endpoint: "/api/audio-assets/m8-library-audio.mp3",
    kind: "audio",
    label: "环境音乐",
  },
] as const;

async function removeLibraryFixtures(request: APIRequestContext) {
  for (const fixture of libraryFixtures) {
    await request.delete(`/api/library/${fixture.kind}/${fixture.assetId}`);
    await request.delete(fixture.endpoint);
  }
}

test.beforeEach(async ({ request }) => {
  await request.delete(`/api/canvas/${canvasId}`);
  for (const fixture of libraryFixtures) {
    const upload = await request.post(fixture.endpoint, {
      data: fixture.bytes,
      headers: {
        "Content-Type": fixture.contentType,
        "X-File-Name": encodeURIComponent(fixture.assetId),
      },
    });
    expect(upload.status()).toBe(201);
    const saved = await request.post("/api/library", {
      data: {
        assetId: fixture.assetId,
        folderId: "others",
        kind: fixture.kind,
        label: fixture.label,
      },
    });
    expect(saved.ok()).toBeTruthy();
  }
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
  await removeLibraryFixtures(request);
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
  await expect(assets.locator(".assets-library-card")).toHaveCount(3);

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
  await expect(assets.locator(".assets-library-card")).toHaveCount(3);

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
