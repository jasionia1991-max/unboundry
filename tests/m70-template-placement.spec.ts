import { expect, test } from "./safe-test";
import {
  emptyCanvasTemplateSpot,
  findTemplateSpot,
  nodePlacementRect,
  offsetTemplate,
  templateAnchor,
  templateBounds,
  TEMPLATE_MODEL_SELECTION_REQUIRED_ID,
  viewportForBounds,
} from "../client/src/canvas/templatePlacement";

const sizeFor = (node: { style?: { height: number; width: number } }) => ({
  height: node.style?.height ?? 250,
  width: node.style?.width ?? 250,
});

test("templateBounds covers group children through relative positions", () => {
  const nodes = [
    {
      id: "group",
      position: { x: 100, y: 100 },
      style: { height: 500, width: 500 },
      type: "group",
    },
    {
      id: "child",
      parentId: "group",
      position: { x: 20, y: 30 },
      style: { height: 250, width: 250 },
      type: "image",
    },
  ];
  const bounds = templateBounds(nodes, sizeFor);
  expect(bounds).toMatchObject({
    bottom: 600,
    height: 500,
    left: 100,
    right: 600,
    top: 100,
    width: 500,
  });
});

test("findTemplateSpot skips occupied positions and falls back to the anchor", () => {
  const spot = findTemplateSpot({
    anchor: { x: 0, y: 0 },
    obstacles: [{ bottom: 150, left: 0, right: 150, top: 0 }],
    templateSize: { height: 220, width: 320 },
  });
  // 最小模板尺寸会被钳制到 320×220，所以行间隔是 220+100。
  expect(spot).toEqual({ x: 0, y: 320 });

  const fallback = findTemplateSpot({
    anchor: { x: 0, y: 0 },
    maxCols: 0,
    maxRows: 0,
    obstacles: [{ bottom: 150, left: 0, right: 150, top: 0 }],
    templateSize: { height: 220, width: 320 },
  });
  expect(fallback).toEqual({ x: 0, y: 0 });
});

test("templateAnchor puts the template right of the selection or at the viewport center", () => {
  expect(
    templateAnchor({
      selectedBounds: { bottom: 200, left: 100, right: 400, top: 50 },
      templateSize: { height: 300, width: 500 },
      viewportCenter: { x: 800, y: 450 },
    }),
  ).toEqual({ x: 500, y: 50 });
  expect(
    templateAnchor({
      templateSize: { height: 300, width: 500 },
      viewportCenter: { x: 800, y: 450 },
    }),
  ).toEqual({ x: 900, y: 300 });
});

test("emptyCanvasTemplateSpot jitters around the center with a bounded random", () => {
  const size = { height: 200, width: 300 };
  const center = { x: 500, y: 400 };
  expect(
    emptyCanvasTemplateSpot({
      random: () => 0.5,
      templateSize: size,
      viewportCenter: center,
    }),
  ).toEqual({ x: 350, y: 300 });
  const low = emptyCanvasTemplateSpot({
    random: () => 0,
    templateSize: size,
    viewportCenter: center,
  });
  expect(Math.abs(low.x - 350)).toBeLessThanOrEqual(50);
  expect(Math.abs(low.y - 300)).toBeLessThanOrEqual(50);
});

test("offsetTemplate moves only top-level nodes so children stay relative", () => {
  const moved = offsetTemplate(
    [
      { id: "group", position: { x: 10, y: 20 } },
      { id: "child", parentId: "group", position: { x: 5, y: 6 } },
    ],
    { x: 100, y: 200 },
  );
  expect(moved[0].position).toEqual({ x: 110, y: 220 });
  expect(moved[1].position).toEqual({ x: 5, y: 6 });
});

test("nodePlacementRect resolves global position through the parent chain", () => {
  const nodes = [
    {
      id: "a",
      position: { x: 100, y: 100 },
      style: { height: 250, width: 250 },
    },
    {
      id: "b",
      parentId: "a",
      position: { x: 20, y: 30 },
      style: { height: 250, width: 250 },
    },
  ];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rect = nodePlacementRect(nodes[1], byId, sizeFor);
  expect(rect).toMatchObject({ left: 120, top: 130, right: 370, bottom: 380 });
});

test("viewportForBounds centers the template with padding", () => {
  const viewport = viewportForBounds(
    { height: 300, width: 500, x: 0, y: 0 },
    1000,
    800,
    0.1,
    2,
    0.2,
  );
  expect(viewport.zoom).toBeCloseTo(1.2, 5);
  expect(viewport.x).toBeCloseTo(200, 5);
  expect(viewport.y).toBeCloseTo(220, 5);
});

test("importing the same template twice never overlaps", async ({ page }) => {
  await page.goto("/__fixture/panel.templates.public");
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await page
    .getByTestId("template-first-notice")
    .getByRole("button", { name: "知道了" })
    .click();

  const card = page
    .locator(".template-card")
    .filter({ hasText: "电商详情页工作流" });
  await expect(card).toBeVisible();
  await card.click();
  await expect.poll(() => world.getAttribute("data-node-count")).toBe("12");

  await page.getByTestId("templates").click();
  await expect(page.getByTestId("templates-panel")).toBeVisible();
  await page.locator(".template-card").filter({ hasText: "电商详情页工作流" }).click();
  await expect.poll(() => world.getAttribute("data-node-count")).toBe("24");

  const groups = page.locator(".react-flow__node-group");
  await expect(groups).toHaveCount(2);
  const first = (await groups.nth(0).boundingBox())!;
  const second = (await groups.nth(1).boundingBox())!;
  const overlap =
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
  expect(overlap).toBe(false);
});

test("importing a template on a real project centers it and settles the save status", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };

  let canvasPuts = 0;
  page.on("request", (networkRequest) => {
    if (
      networkRequest.method() === "PUT" &&
      networkRequest.url().includes(`/api/canvas/${project.id}`)
    ) {
      canvasPuts += 1;
    }
  });

  await page.goto(`/canvas/${project.id}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  canvasPuts = 0;

  await page.getByTestId("templates").click();
  await expect(page.getByTestId("templates-panel")).toBeVisible();
  const notice = page.getByTestId("template-first-notice");
  if (await notice.count()) {
    await notice.getByRole("button", { name: "知道了" }).click();
  }
  await page
    .locator(".template-card")
    .filter({ hasText: "电商详情页工作流" })
    .click();
  await expect.poll(() => world.getAttribute("data-node-count")).toBe("12");
  await expect(page.getByTestId("add-node-menu")).toHaveCount(0);

  let lastViewport = "";
  await expect
    .poll(
      async () => {
        const current = [
          await world.getAttribute("data-viewport-x"),
          await world.getAttribute("data-viewport-y"),
          await world.getAttribute("data-viewport-zoom"),
        ].join(",");
        if (current === lastViewport) return "stable";
        lastViewport = current;
        return "moving";
      },
      { timeout: 5_000 },
    )
    .toBe("stable");
  await page.waitForTimeout(300);

  await expect
    .poll(
      async () =>
        (await page.getByTestId("save-status").textContent())?.trim(),
      { timeout: 8_000 },
    )
    .toBe("已保存到云端");

  const worldBox = (await world.boundingBox())!;
  const group = page.locator(".react-flow__node-group").first();
  await expect(group).toBeVisible();
  const box = (await group.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(worldBox.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(worldBox.height + 1);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  expect(Math.abs(centerX - worldBox.width / 2)).toBeLessThan(
    worldBox.width * 0.25,
  );
  expect(Math.abs(centerY - worldBox.height / 2)).toBeLessThan(
    worldBox.height * 0.25,
  );

  // 动画期间保存被闸门挡掉，最终只有节点保存 + 镜头提交等少量请求。
  expect(canvasPuts).toBeLessThanOrEqual(3);

  const imported = (await (
    await request.get(`/api/canvas/${project.id}`)
  ).json()) as {
    edges: Array<{ id: string }>;
    nodes: Array<{ data: Record<string, unknown>; id: string; type: string }>;
  };
  const executableWithRequiredModel = imported.nodes.filter((node) => {
    if (!["audio", "image", "text", "video"].includes(node.type)) return false;
    return node.data[`${node.type}ModelId`] ===
      TEMPLATE_MODEL_SELECTION_REQUIRED_ID;
  });
  expect(executableWithRequiredModel).toHaveLength(8);
  expect(executableWithRequiredModel.every((node) =>
    node.data[node.type === "video" ? "videoModel" : `${node.type}ModelName`] ===
      "请选择兼容模型"
  )).toBe(true);

  const importedNodeIds = imported.nodes.map((node) => node.id).sort();
  const importedEdgeIds = imported.edges.map((edge) => edge.id).sort();
  await page.getByTestId("fit-view").click();
  await page.waitForTimeout(1_200);
  await expect(world).toHaveAttribute("data-node-count", "12");
  await expect(world).toHaveAttribute("data-edge-count", "29");
  await expect(page.locator(".react-flow__node-group")).toHaveCount(1);

  const fitted = (await (
    await request.get(`/api/canvas/${project.id}`)
  ).json()) as {
    edges: Array<{ id: string }>;
    nodes: Array<{ id: string }>;
  };
  expect(fitted.nodes.map((node) => node.id).sort()).toEqual(importedNodeIds);
  expect(fitted.edges.map((edge) => edge.id).sort()).toEqual(importedEdgeIds);

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "12");
  await expect(world).toHaveAttribute("data-edge-count", "29");
  await expect(page.locator(".react-flow__node-group")).toHaveCount(1);

  await request.delete(`/api/projects/${project.id}`);
});
