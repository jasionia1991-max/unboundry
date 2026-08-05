import { expect, test, type Locator } from "@playwright/test";

async function composeTitle(input: Locator, value: string, finish = true) {
  await input.dispatchEvent("compositionstart");
  await input.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: nextValue,
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
  }, value);
  if (finish) {
    await input.dispatchEvent("compositionend", { data: value });
  }
}

test("nodes, asset references and viewport survive a reload", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/persistence.nodes-assets-viewport");
  await page.goto("/__fixture/persistence.nodes-assets-viewport");

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "6");
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await expect(page.locator('[data-asset-id="asset-shared-landscape"]')).toHaveCount(2);
  await expect(page.getByText("00:00/03:04")).toBeVisible();

  const text = page.locator(
    '.react-flow__node-text[data-id="persistent-text"]',
  );
  const before = (await text.boundingBox())!;
  await page.mouse.move(before.x + 80, before.y + 80);
  await page.mouse.down();
  await page.mouse.move(before.x + 150, before.y + 130, { steps: 5 });
  await page.mouse.up();

  await page.getByTestId("zoom-slider").fill("1.1");
  await expect(world).toHaveAttribute("data-viewport-zoom", "1.1");
  await page.waitForTimeout(1600);

  const saved = await request.get("/api/canvas/persistence.nodes-assets-viewport");
  expect(saved.ok()).toBeTruthy();
  const document = await saved.json() as {
    nodes: Array<{ id: string; position: { x: number; y: number } }>;
    viewport: { zoom: number };
  };
  expect(document.viewport.zoom).toBe(1.1);
  expect(document.nodes.find((node) => node.id === "persistent-text")?.position.x)
    .toBeGreaterThan(80);
  const after = (await text.boundingBox())!;

  await page.route(
    "**/api/canvas/persistence.final-clean-canvas",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.locator(".react-flow__node").count()).toBe(0);
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "6");
  await expect(world).toHaveAttribute("data-edge-count", "1");
  await expect(world).toHaveAttribute("data-viewport-zoom", "1.1");
  expect((await text.boundingBox())!.x).toBeCloseTo(after.x, 0);
  expect((await text.boundingBox())!.y).toBeCloseTo(after.y, 0);
});

test("media nodes keep material-fit defaults and preserve manual resize", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const resized = new Map<string, { height: number; width: number }>();
  for (const id of [
    "persistent-image-1",
    "persistent-video",
    "persistent-audio",
  ]) {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.click({ position: { x: 20, y: 20 } });
    await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);

    const before = (await node.boundingBox())!;
    const handle = node.locator(
      ".react-flow__resize-control.handle.bottom.right",
    );
    const handleBox = (await handle.boundingBox())!;
    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handleBox.x + handleBox.width / 2 + 36,
      handleBox.y + handleBox.height / 2 + 24,
    );
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.mouse.up();

    const after = (await node.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 20);
    expect(after.height).toBeGreaterThan(before.height + 12);
    resized.set(id, { height: after.height, width: after.width });
  }

  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  for (const [id, expected] of resized) {
    const box = (await page
      .locator(`.react-flow__node[data-id="${id}"]`)
      .boundingBox())!;
    expect(box.width).toBeCloseTo(expected.width, 0);
    expect(box.height).toBeCloseTo(expected.height, 0);
  }
});

test("pagehide rolls every unfinished title composition back to its last commit", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const cases = [
    ["persistent-text", "canvas-node-title", "文字新标题"],
    ["persistent-image-1", "image-node-title-input", "图片新标题"],
    ["persistent-video", "video-node-title-input", "视频新标题"],
    ["persistent-audio", "audio-node-title-input", "音频新标题"],
    ["persistent-playlist", "playlist-node-title-input", "列表新标题"],
  ] as const;

  for (const [nodeId, testId, title] of cases) {
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    const input = page.getByTestId(testId);
    const committedTitle = `${title}已提交`;
    await input.fill(committedTitle);
    await input.press("Enter");
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    await composeTitle(input, `${title}pin yin`, false);
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    await expect(page.getByTestId(testId)).toHaveValue(committedTitle);
    await expect(page.getByTestId(testId)).not.toHaveValue(/pin yin/i);
  }
});

test("slow typing keeps every editable node title saved after the first key", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const cases = [
    ["persistent-text", "canvas-node-title", "T123"],
    ["persistent-image-1", "image-node-title-input", "I123"],
    ["persistent-video", "video-node-title-input", "V123"],
    ["persistent-audio", "audio-node-title-input", "A123"],
    ["persistent-playlist", "playlist-node-title-input", "P123"],
  ] as const;

  for (const [nodeId, testId, title] of cases) {
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    const input = page.getByTestId(testId);
    await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await input.press("Backspace");
    for (const [index, key] of [...title].entries()) {
      await input.press(key);
      if (index < title.length - 1) {
        await page.waitForTimeout(120);
      }
    }
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    await expect(page.getByTestId(testId)).toHaveValue(title);
  }
});

test("cleared canvas stays empty after a reload", async ({ page, request }) => {
  await request.delete("/api/canvas/persistence.final-clean-canvas");
  await page.goto("/__fixture/persistence.final-clean-canvas");

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect(page.getByTestId("empty-quick-actions")).toHaveCount(0);

  for (const id of ["clean-a", "clean-b", "clean-c"]) {
    await page.locator(`.react-flow__node[data-id="${id}"]`).click();
    await page.keyboard.press("Backspace");
  }

  await expect(world).toHaveAttribute("data-node-count", "0");
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(page.getByTestId("empty-quick-actions")).toBeVisible();
  await page.waitForTimeout(1600);

  const saved = await request.get("/api/canvas/persistence.final-clean-canvas");
  expect(saved.ok()).toBeTruthy();
  const document = await saved.json() as { edges: unknown[]; nodes: unknown[] };
  expect(document.nodes).toHaveLength(0);
  expect(document.edges).toHaveLength(0);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "0");
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(page.getByTestId("empty-quick-actions")).toBeVisible();
});
