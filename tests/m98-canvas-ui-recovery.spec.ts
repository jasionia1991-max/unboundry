import { expect, test, type APIRequestContext, type Page } from "./safe-test";
import { randomUUID } from "node:crypto";

type SeedNode = {
  data: Record<string, unknown>;
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  style: { height: number; width: number };
  type: "audio" | "group" | "image" | "playlist" | "storyboard" | "text" | "video";
  zIndex?: number;
};

async function seedCanvas(
  request: APIRequestContext,
  canvasId: string,
  nodes: SeedNode[],
  viewport = { x: 80, y: 80, zoom: 0.6 },
) {
  await request.delete(`/api/canvas/${canvasId}`);
  const response = await request.put(`/api/canvas/${canvasId}`, {
    headers: { "X-Unboundry-Safe-Fixture-Seed": canvasId },
    data: {
      edges: [],
      nodes,
      revision: 0,
      saveSequence: 1,
      saveSessionId: randomUUID(),
      viewport,
    },
  });
  expect(response.ok()).toBeTruthy();
}

function titleData(title: string) {
  return { label: "Title", title };
}

test("marquee fully encloses three nodes without selecting an intersected giant group", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  const targetIds = ["target-a", "target-b", "target-c"];
  await seedCanvas(request, canvasId, [
    {
      data: { label: "Group", title: "既有巨大组" },
      id: "giant-group",
      position: { x: 200, y: 160 },
      style: { height: 900, width: 1500 },
      type: "group",
      zIndex: 0,
    },
    ...targetIds.map((id, index) => ({
      data: { content: id, label: "Text", title: id },
      id,
      position: { x: 260 + index * 240, y: 230 },
      style: { height: 180, width: 180 },
      type: "text" as const,
      zIndex: 1,
    })),
  ]);

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page.getByTestId("fit-view").click();

  const group = page.locator('.react-flow__node[data-id="giant-group"]');
  const targets = targetIds.map((id) =>
    page.locator(`.react-flow__node[data-id="${id}"]`)
  );
  const groupBox = (await group.boundingBox())!;
  const targetBoxes = await Promise.all(targets.map((target) => target.boundingBox()));
  const start = {
    x: groupBox.x - 10,
    y: groupBox.y - 10,
  };
  const end = {
    x: Math.max(...targetBoxes.map((box) => box!.x + box!.width)) + 10,
    y: Math.max(...targetBoxes.map((box) => box!.y + box!.height)) + 10,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();

  await expect(world).toHaveAttribute("data-selected-node-count", "3");
  await expect(group).not.toHaveClass(/selected/);
  for (const target of targets) await expect(target).toHaveClass(/selected/);
  await page.getByRole("button", { name: "打组" }).click();
  await expect(page.locator(".react-flow__node-group")).toHaveCount(2);

  await expect.poll(async () => {
    const response = await request.get(`/api/canvas/${canvasId}`);
    const document = await response.json() as {
      nodes: Array<{ id: string; parentId?: string; type: string }>;
    };
    const created = document.nodes.find((node) =>
      node.type === "group" && node.id !== "giant-group"
    );
    return document.nodes
      .filter((node) => node.parentId === created?.id)
      .map((node) => node.id)
      .sort();
  }).toEqual([...targetIds].sort());
});

test("image video and audio load errors use the shared neutral fallback without uploads", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await seedCanvas(request, canvasId, [
    {
      data: {
        assetId: "broken-image",
        imagePromptReady: true,
        imageSrc: "data:image/png;base64,AAAA",
        inputState: "ready",
        label: "Image",
        sourceKind: "image",
        title: "损坏图片",
      },
      id: "broken-image",
      position: { x: 100, y: 120 },
      style: { height: 250, width: 360 },
      type: "image",
    },
    {
      data: {
        assetId: "broken-video",
        inputState: "ready",
        label: "Video",
        sourceKind: "video",
        title: "损坏视频",
        videoDuration: 5,
        videoPromptReady: true,
        videoSrc: "data:video/mp4;base64,AAAA",
      },
      id: "broken-video",
      position: { x: 520, y: 120 },
      style: { height: 250, width: 360 },
      type: "video",
    },
    {
      data: {
        assetId: "broken-audio",
        audioDuration: 5,
        audioPromptReady: true,
        audioSrc: "data:audio/wav;base64,AAAA",
        audioWaveform: [18, 24, 20, 28],
        inputState: "ready",
        label: "Audio",
        sourceKind: "audio",
        title: "损坏音频",
      },
      id: "broken-audio",
      position: { x: 100, y: 460 },
      style: { height: 250, width: 444 },
      type: "audio",
    },
  ]);
  const uploadRequests: string[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      /\/api\/(?:assets|video-assets|audio-assets)(?:\/|$)/.test(entry.url())
    ) uploadRequests.push(entry.url());
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.getByTestId("fit-view").click();
  const nodes = ["broken-image", "broken-video", "broken-audio"].map((id) =>
    page.locator(`.react-flow__node[data-id="${id}"]`)
  );
  for (const node of nodes) {
    const fallback = node.getByTestId("media-load-fallback");
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveCSS("border-style", "solid");
    await expect(fallback.getByRole("button", { name: "重新加载" })).toBeVisible();
    await expect(fallback.getByRole("button", { name: "重新上传" })).toBeVisible();
  }
  await nodes[0].getByRole("button", { name: "重新加载" }).click();
  await expect(nodes[0].getByTestId("media-load-fallback")).toBeVisible();
  expect(uploadRequests).toEqual([]);
});

test("node titles ellipsize while group titles stay complete", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  const longTitle = "服装详情页｜面料与工艺拆解｜超长标题用于验证所有节点统一省略显示与完整悬停提示";
  const types: SeedNode["type"][] = [
    "text",
    "image",
    "video",
    "audio",
    "playlist",
    "group",
    "storyboard",
  ];
  await seedCanvas(request, canvasId, types.map((type, index) => ({
    data: titleData(`${type}｜${longTitle}`),
    id: `long-${type}`,
    position: {
      x: 80 + (index % 3) * 400,
      y: 100 + Math.floor(index / 3) * 330,
    },
    style: {
      height: type === "storyboard" ? 280 : 220,
      width: type === "storyboard" ? 620 : 320,
    },
    type,
  })));

  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.getByTestId("fit-view").click();
  for (const type of types) {
    const title = page
      .locator(`.react-flow__node[data-id="long-${type}"]`)
      .locator(".canvas-node-title > span");
    await expect(title).toHaveAttribute("title", `${type}｜${longTitle}`);
    if (type === "group") {
      await expect(title).toHaveCSS("overflow", "visible");
      await expect(title).toHaveCSS("text-overflow", "clip");
      await expect(title).toHaveCSS("white-space", "normal");
      expect(await title.evaluate((element) => ({
        horizontalOverflow: element.scrollWidth > element.clientWidth,
        verticalOverflow: element.scrollHeight > element.clientHeight,
      }))).toEqual({ horizontalOverflow: false, verticalOverflow: false });
      continue;
    }
    await expect(title).toHaveCSS("overflow", "hidden");
    await expect(title).toHaveCSS("text-overflow", "ellipsis");
    await expect(title).toHaveCSS("white-space", "nowrap");
    expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
  }
});

test("node titles keep readable screen-space typography across zoom bands", async ({
  page,
  request,
}) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await seedCanvas(request, canvasId, [
    {
      data: titleData("服装主体标准化｜超长标题用于缩放可读性验证"),
      id: "readable-text",
      position: { x: 160, y: 160 },
      style: { height: 250, width: 320 },
      type: "text",
    },
    {
      data: titleData("服装一键上新｜P0主图与详情页｜参考实物一致性与自动纠错工作流"),
      id: "readable-group",
      position: { x: 620, y: 120 },
      style: { height: 520, width: 760 },
      type: "group",
    },
    {
      data: titleData("组内上传服装参考图"),
      id: "readable-group-child",
      parentId: "readable-group",
      position: { x: 40, y: 60 },
      style: { height: 220, width: 280 },
      type: "image",
    },
    {
      data: titleData("分镜总览｜动作镜头与带货节奏"),
      id: "readable-storyboard",
      position: { x: 160, y: 560 },
      style: { height: 280, width: 620 },
      type: "storyboard",
    },
    {
      data: titleData("负坐标模板组"),
      id: "negative-group",
      parentId: "negative-group",
      position: { x: -1080, y: -1080 },
      style: { height: 520, width: 760 },
      type: "group",
    },
    {
      data: titleData("组内节点"),
      id: "negative-child",
      parentId: "negative-group",
      position: { x: 40, y: 40 },
      style: { height: 220, width: 280 },
      type: "image",
    },
  ], { x: 770, y: 730, zoom: 0.15 });

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  const slider = page.getByTestId("zoom-slider");
  const textNode = page.locator('.react-flow__node[data-id="readable-text"]');
  const title = textNode.locator(".canvas-node-title");
  const titleText = title.locator("span");
  const negativeGroup = page.locator(
    '.react-flow__node[data-id="negative-group"]',
  );
  const negativeChild = page.locator(
    '.react-flow__node[data-id="negative-child"]',
  );
  await expect(negativeGroup).toBeVisible();
  await expect(negativeChild).toBeVisible();
  await negativeGroup.click({ position: { x: 30, y: 50 } });
  await expect(negativeGroup).toHaveClass(/selected/);
  const negativeBefore = await Promise.all([
    negativeGroup.evaluate((element) => (element as HTMLElement).style.transform),
    negativeChild.evaluate((element) => (element as HTMLElement).style.transform),
  ]);
  expect(negativeBefore[0]).toContain("translate(-1080px, -1080px)");

  await slider.fill("0.6");
  await expect(world).toHaveAttribute("data-title-zoom-band", "compact");
  await expect(title).toHaveCSS("font-size", "14px");
  await expect(title).toHaveCSS("font-weight", "500");
  await expect(title).toHaveCSS("color", "rgba(245, 245, 245, 0.86)");
  await expect(title).toHaveCSS("pointer-events", "all");
  expect(await title.evaluate((element) => getComputedStyle(element).textShadow))
    .not.toBe("none");
  expect(await title.evaluate((element) => getComputedStyle(element).transform))
    .toContain("1.666");
  await expect(titleText).toHaveCSS("text-overflow", "ellipsis");
  expect(await titleText.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);
  await textNode.click({ position: { x: 160, y: 120 } });
  await expect(textNode).toHaveClass(/selected/);

  await slider.fill("0.15");
  await expect(world).toHaveAttribute("data-title-zoom-band", "overview");
  await expect(title).toHaveCSS("font-size", "12px");
  await expect(title).toHaveCSS("pointer-events", "auto");
  const overview = await title.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    transform: getComputedStyle(element).transform,
    width: element.getBoundingClientRect().width,
  }));
  expect(overview.transform).toContain("6.666");
  expect(overview.height).toBeCloseTo(26, 0);
  expect(overview.width).toBeGreaterThanOrEqual(95);
  expect(overview.width).toBeLessThanOrEqual(181);

  const groupTitle = page
    .locator('.react-flow__node[data-id="readable-group"]')
    .locator(".group-node-title");
  await expect(groupTitle).toHaveCSS("font-size", "14px");
  await expect(groupTitle).toHaveCSS("color", "rgba(245, 245, 245, 0.78)");
  const group = page.locator('.react-flow__node[data-id="readable-group"]');
  const groupBox = (await group.boundingBox())!;
  const groupTitleBox = (await groupTitle.boundingBox())!;
  expect(groupTitleBox.width).toBeGreaterThanOrEqual(71);
  expect(groupTitleBox.width).toBeLessThanOrEqual(321);
  expect(groupBox.y - (groupTitleBox.y + groupTitleBox.height)).toBeCloseTo(8, 0);
  const groupTitleText = groupTitle.locator("span");
  await expect(groupTitleText).toHaveCSS("text-overflow", "clip");
  await expect(groupTitleText).toHaveCSS("white-space", "normal");
  expect(await groupTitleText.evaluate((element) => ({
    horizontalOverflow: element.scrollWidth > element.clientWidth,
    verticalOverflow: element.scrollHeight > element.clientHeight,
  }))).toEqual({ horizontalOverflow: false, verticalOverflow: false });

  const groupChildTitle = page
    .locator('.react-flow__node[data-id="readable-group-child"]')
    .locator(".canvas-node-title");
  await expect(groupChildTitle).toBeHidden();
  const groupBody = page.getByTestId("group-node-readable-group");
  await groupBody.dispatchEvent("pointerover");
  await expect(groupChildTitle).toBeVisible();
  await groupBody.dispatchEvent("pointerout");
  await expect(groupChildTitle).toBeHidden();

  const storyboardTitle = page
    .locator('.react-flow__node[data-id="readable-storyboard"]')
    .locator(".storyboard-node-title");
  await expect(storyboardTitle).toHaveCSS("pointer-events", "none");
  expect((await storyboardTitle.boundingBox())!.width).toBeLessThanOrEqual(221);
  const transformsBefore = await Promise.all([
    group.evaluate((element) => (element as HTMLElement).style.transform),
    page
      .locator('.react-flow__node[data-id="readable-group-child"]')
      .evaluate((element) => (element as HTMLElement).style.transform),
  ]);
  for (const zoom of ["0.27", "0.15", "0.6", "0.15", "1", "0.15"]) {
    await slider.fill(zoom);
    await expect(world).toHaveAttribute("data-viewport-zoom", zoom);
  }

  await expect.poll(async () => Promise.all([
    group.evaluate((element) => (element as HTMLElement).style.transform),
    page
      .locator('.react-flow__node[data-id="readable-group-child"]')
      .evaluate((element) => (element as HTMLElement).style.transform),
  ])).toEqual(transformsBefore);
  const persisted = await request.get(`/api/canvas/${canvasId}`);
  expect(persisted.ok()).toBeTruthy();
  const document = await persisted.json() as {
    nodes: Array<{
      id: string;
      position: { x: number; y: number };
    }>;
  };
  expect(document.nodes.find((node) => node.id === "readable-group")?.position)
    .toEqual({ x: 620, y: 120 });
  expect(document.nodes.find((node) => node.id === "readable-group-child")?.position)
    .toEqual({ x: 40, y: 60 });
  await expect.poll(async () => Promise.all([
    negativeGroup.evaluate((element) => (element as HTMLElement).style.transform),
    negativeChild.evaluate((element) => (element as HTMLElement).style.transform),
  ])).toEqual(negativeBefore);
});

test("Text body pans the canvas until editing starts", async ({ page, request }) => {
  const canvasId = "persistence.nodes-assets-viewport";
  await seedCanvas(request, canvasId, [{
    data: {
      content: Array.from({ length: 24 }, (_, index) => `正文第${index + 1}行`).join("\n"),
      label: "Text",
      title: "文字节点平移合同",
    },
    id: "text-pan-contract",
    position: { x: 260, y: 180 },
    style: { height: 250, width: 320 },
    type: "text",
  }], { x: 0, y: 0, zoom: 1 });

  await page.goto(`/__fixture/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  const body = page.getByTestId("canvas-node-text-content");
  await expect(body).not.toHaveClass(/nowheel/);
  const bodyBox = (await body.boundingBox())!;
  const viewportBefore = {
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
  };
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + 80);
  await page.mouse.wheel(120, 80);
  await expect.poll(async () => ({
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
  })).not.toEqual(viewportBefore);
  const viewportAfterWheel = {
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
  };
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + 80);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    bodyBox.x + bodyBox.width / 2 + 70,
    bodyBox.y + 125,
    { steps: 4 },
  );
  await page.mouse.up({ button: "middle" });
  await expect.poll(async () => ({
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
  })).not.toEqual(viewportAfterWheel);

  // The preceding middle-button pan leaves the node unselected. Select it
  // before exercising the normal double-click-to-edit interaction.
  await body.click({ position: { x: bodyBox.width / 2, y: 80 } });
  await body.dblclick({ position: { x: bodyBox.width / 2, y: 80 } });
  await expect(body).toHaveClass(/nowheel/);
  await expect(body).toHaveClass(/nodrag/);
  const editingViewport = {
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
  };
  const editingBox = (await body.boundingBox())!;
  await page.mouse.move(editingBox.x + editingBox.width / 2, editingBox.y + 80);
  await page.mouse.wheel(120, 80);
  await page.waitForTimeout(150);
  expect({
    x: Number(await world.getAttribute("data-viewport-x")),
    y: Number(await world.getAttribute("data-viewport-y")),
  }).toEqual(editingViewport);
  await page.getByTestId("text-node-editor").press("Escape");
  await expect(body).not.toHaveClass(/nowheel/);

  const persisted = await request.get(`/api/canvas/${canvasId}`);
  expect(persisted.ok()).toBeTruthy();
  const document = await persisted.json() as {
    nodes: Array<{ id: string; position: { x: number; y: number } }>;
  };
  expect(document.nodes.find((node) => node.id === "text-pan-contract")?.position)
    .toEqual({ x: 260, y: 180 });
});
