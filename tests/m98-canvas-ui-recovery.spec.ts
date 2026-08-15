import { expect, test, type APIRequestContext, type Page } from "./safe-test";
import { randomUUID } from "node:crypto";

type SeedNode = {
  data: Record<string, unknown>;
  id: string;
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

test("all seven node titles ellipsize consistently and expose the full title", async ({
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
    await expect(title).toHaveCSS("overflow", "hidden");
    await expect(title).toHaveCSS("text-overflow", "ellipsis");
    await expect(title).toHaveCSS("white-space", "nowrap");
    expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
  }
});
