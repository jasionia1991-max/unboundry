import { expect, test, type Page, type APIRequestContext } from "./safe-test";

type StoredNode = {
  data: Record<string, unknown>;
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  selected?: boolean;
  style: { height: number; width: number };
  type: string;
};

const image =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='800'%3E%3Crect width='800' height='800' fill='%23545f6c'/%3E%3C/svg%3E";

function productNodes(): StoredNode[] {
  return [
    {
      data: {
        content: "多选时只保留一个公共工具栏。",
        label: "Text",
        textPromptReady: true,
        title: "多选文字",
      },
      id: "multi-text",
      position: { x: 100, y: 120 },
      style: { height: 250, width: 250 },
      type: "text",
    },
    {
      data: {
        assetId: "multi-image-asset",
        imagePromptReady: true,
        imageSrc: image,
        label: "Image",
        sourceKind: "image",
        title: "多选图片",
      },
      id: "multi-image",
      position: { x: 430, y: 120 },
      style: { height: 250, width: 250 },
      type: "image",
    },
    {
      data: {
        assetId: "multi-video-asset",
        label: "Video",
        sourceKind: "video",
        title: "多选视频",
        videoDuration: 5,
        videoPromptReady: true,
        videoSrc: "data:video/mp4;base64,AAAA",
      },
      id: "multi-video",
      position: { x: 760, y: 120 },
      style: { height: 250, width: 444 },
      type: "video",
    },
    {
      data: {
        assetId: "multi-audio-asset",
        audioDuration: 12,
        audioPromptReady: true,
        audioSrc: "data:audio/wav;base64,AAAA",
        audioWaveform: Array.from({ length: 32 }, (_, index) => 16 + index % 5),
        label: "Audio",
        sourceKind: "audio",
        title: "多选音频",
      },
      id: "multi-audio",
      position: { x: 430, y: 470 },
      style: { height: 250, width: 444 },
      type: "audio",
    },
  ];
}

async function seedCanvas(
  request: APIRequestContext,
  canvasId: string,
  nodes = productNodes(),
) {
  await request.delete(`/api/canvas/${canvasId}`);
  const response = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [
        {
          id: "multi-edge-text-image",
          source: "multi-text",
          sourceHandle: "source",
          target: "multi-image",
          targetHandle: "target",
          type: "cuttable",
        },
      ],
      nodes,
      revision: 0,
      saveSequence: 1,
      saveSessionId: "m63-seed-session",
      viewport: { x: 40, y: 40, zoom: 0.8 },
    },
  });
  expect(response.ok()).toBeTruthy();
}

function trackPaidRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      (request.method() === "POST" && /\/api\/generation-tasks(?:\?|$)/.test(url)) ||
      /openrouter|volces|mureka|lk888|lk666/i.test(url)
    ) {
      requests.push(`${request.method()} ${url}`);
    }
  });
  return requests;
}

test("product-node multiselect keeps one shared toolbar and no individual chrome", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await seedCanvas(request, canvasId);
  const paidRequests = trackPaidRequests(page);
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const text = page.locator('.react-flow__node[data-id="multi-text"]');
  const imageNode = page.locator('.react-flow__node[data-id="multi-image"]');
  await page.locator(".react-flow__pane").click({ position: { x: 12, y: 12 } });
  await text.click({ position: { x: 80, y: 100 } });
  await expect(page.getByTestId("text-node-toolbar")).toBeVisible();
  await expect(page.getByTestId("text-creator")).toBeVisible();
  await expect(page.getByTestId("canvas-node-title")).toBeVisible();

  await imageNode.click({ modifiers: ["Shift"], position: { x: 100, y: 120 } });
  await expect(world).toHaveAttribute("data-selected-node-count", "2");
  await expect(page.getByTestId("multi-selection-toolbar")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "打组" })).toBeEnabled();
  await expect(page.getByTestId("batch-connect-handle")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-toolbar:visible")).toHaveCount(0);
  await expect(page.locator(".react-flow__resize-control:visible")).toHaveCount(0);
  await expect(page.locator(
    'input[data-canvas-text-edit="graph"]:visible, textarea[data-canvas-text-edit="graph"]:visible, [contenteditable="true"][data-canvas-text-edit="graph"]:visible',
  )).toHaveCount(0);
  await expect(page.locator(".playlist-node-actions:visible")).toHaveCount(0);
  await expect(page.locator(".group-node-toolbar:visible")).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await text.click({ modifiers: ["Shift"], position: { x: 80, y: 100 } });
  await expect(world).toHaveAttribute("data-selected-node-count", "1");
  await expect(page.getByTestId("multi-selection-toolbar")).toHaveCount(0);
  await expect(page.getByTestId("image-node-toolbar")).toBeVisible();
  await expect(page.getByTestId("image-creator")).toBeVisible();
  await expect(page.getByTestId("image-node-title-input")).toBeVisible();

  await page.locator(".react-flow__pane").click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("Meta+A");
  await expect(world).toHaveAttribute("data-selected-node-count", "4");
  await expect(page.getByTestId("multi-selection-toolbar")).toHaveCount(1);
  await expect(page.locator(".react-flow__node-toolbar:visible")).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await page.locator(".react-flow__pane").click({ position: { x: 12, y: 12 } });
  await text.click({ position: { x: 80, y: 100 } });
  const title = page.getByTestId("canvas-node-title");
  await title.click();
  await title.press("Meta+A");
  expect(await title.evaluate((input) => ({
    end: (input as HTMLInputElement).selectionEnd,
    length: (input as HTMLInputElement).value.length,
    start: (input as HTMLInputElement).selectionStart,
  }))).toEqual({ end: 4, length: 4, start: 0 });
  await expect(world).toHaveAttribute("data-selected-node-count", "1");

  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(paidRequests).toEqual([]);
});

test("left-drag marquee selects nodes without native page text selection", async ({ page, request }) => {
  const paidRequests = trackPaidRequests(page);
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  await page.goto("/__fixture/interaction.selection-and-keyboard-move");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(page.locator('.react-flow__node[data-id="probe-a"]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="probe-b"]')).toBeVisible();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(280, 160);
  await page.mouse.down();
  await page.mouse.move(890, 450, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await expect(page.getByTestId("multi-selection-toolbar")).toHaveCount(1);
  expect(await page.evaluate(() => ({
    activeEditable: document.activeElement?.matches(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    ) ?? false,
    selection: window.getSelection()?.toString() ?? "",
  }))).toEqual({ activeEditable: false, selection: "" });

  const after = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  expect(paidRequests).toEqual([]);
});

test("group create, undo, delete recovery and reload preserve one active surface", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await seedCanvas(request, canvasId, productNodes().slice(0, 2));
  const paidRequests = trackPaidRequests(page);
  const beforeStatus = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const text = page.locator('.react-flow__node[data-id="multi-text"]');
  const imageNode = page.locator('.react-flow__node[data-id="multi-image"]');
  const beforeText = (await text.boundingBox())!;
  const beforeImage = (await imageNode.boundingBox())!;
  await text.click({ position: { x: 80, y: 100 } });
  await imageNode.click({ modifiers: ["Shift"], position: { x: 100, y: 120 } });
  await page.getByRole("button", { name: "打组" }).click();

  await expect(page.locator(".react-flow__node-group")).toHaveCount(1);
  await expect(world).toHaveAttribute("data-selected-node-count", "1");
  await expect(page.getByTestId("group-node-toolbar")).toHaveCount(1);
  expect((await text.boundingBox())!.x).toBeCloseTo(beforeText.x, 0);
  expect((await imageNode.boundingBox())!.x).toBeCloseTo(beforeImage.x, 0);

  await page.keyboard.press("Meta+Z");
  await expect(page.locator(".react-flow__node-group")).toHaveCount(0);
  await expect(world).toHaveAttribute("data-selected-node-count", "2");
  await expect(page.getByTestId("multi-selection-toolbar")).toHaveCount(1);
  await page.getByRole("button", { name: "打组" }).click();
  await expect(page.locator(".react-flow__node-group")).toHaveCount(1);
  await expect.poll(async () => {
    const snapshot = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
      nodes: StoredNode[];
    };
    return snapshot.nodes.some((node) => node.type === "group");
  }).toBe(true);
  let saved = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
    edges: Array<{ source: string; target: string }>;
    nodes: StoredNode[];
  };
  const savedGroup = saved.nodes.find((node) => node.type === "group");
  expect(savedGroup).toBeTruthy();
  expect(saved.nodes.filter((node) => node.parentId === savedGroup!.id)).toHaveLength(2);
  expect(saved.edges).toHaveLength(1);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(page.locator(".react-flow__node-group")).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.locator(".react-flow__node-group").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Backspace");
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await page.keyboard.press("Meta+Z");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(world).toHaveAttribute("data-selected-node-count", "1");
  await expect(page.getByTestId("group-node-toolbar")).toHaveCount(1);
  await expect(page.getByTestId("multi-selection-toolbar")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  saved = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
    edges: Array<{ source: string; target: string }>;
    nodes: StoredNode[];
  };
  const restoredGroup = saved.nodes.find((node) => node.type === "group");
  expect(restoredGroup).toBeTruthy();
  expect(saved.nodes.filter((node) => node.parentId === restoredGroup!.id)).toHaveLength(2);
  expect(saved.edges).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const afterStatus = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  expect(afterStatus.paidProviderRequests).toBe(beforeStatus.paidProviderRequests);
  expect(paidRequests).toEqual([]);
});
