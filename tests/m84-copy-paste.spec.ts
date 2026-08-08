import { expect, test } from "@playwright/test";

async function createProjectCanvas(
  request: import("@playwright/test").APIRequestContext,
) {
  const projectResponse = await request.post("/api/projects", {
    data: {},
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };
  const canvasId = project.id;
  const response = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [
        {
          data: { inputOrder: 1, inputRole: "reference-image" },
          id: "e1",
          source: "t1",
          sourceHandle: "source",
          target: "i1",
          targetHandle: "target",
          type: "cuttable",
        },
      ],
      nodes: [
        {
          data: { label: "G1", title: "G1" },
          id: "g1",
          position: { x: 200, y: 150 },
          style: { height: 320, width: 720 },
          type: "group",
        },
        {
          data: {
            label: "T1",
            textPrompt: "hi",
            textPromptReady: true,
            title: "T1",
          },
          id: "t1",
          parentId: "g1",
          position: { x: 60, y: 90 },
          type: "text",
        },
        {
          data: {
            imagePrompt: "img",
            imagePromptReady: true,
            label: "I1",
            title: "I1",
          },
          id: "i1",
          parentId: "g1",
          position: { x: 400, y: 90 },
          type: "image",
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(response.ok()).toBeTruthy();
  return canvasId;
}

async function worldClientPoint(
  page: import("@playwright/test").Page,
  world: { x: number; y: number },
) {
  const worldElement = page.getByTestId("canvas-world");
  const rect = (await worldElement.boundingBox())!;
  const zoom = Number(await worldElement.getAttribute("data-viewport-zoom"));
  const x = Number(await worldElement.getAttribute("data-viewport-x"));
  const y = Number(await worldElement.getAttribute("data-viewport-y"));
  return {
    x: rect.x + x + world.x * zoom,
    y: rect.y + y + world.y * zoom,
  };
}

async function savedCanvas(
  request: import("@playwright/test").APIRequestContext,
  canvasId: string,
) {
  const response = await request.get(`/api/canvas/${canvasId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    edges: Array<{ id: string; source: string; target: string }>;
    nodes: Array<{
      id: string;
      parentId?: string;
      position: { x: number; y: number };
      type: string;
    }>;
  };
}

test("group copy pastes children and internal edges at the cursor top-left", async ({
  page,
  request,
}) => {
  const canvasId = await createProjectCanvas(request);
  await page.goto(`/canvas/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  await page
    .locator('.react-flow__node[data-id="g1"]')
    .click({ position: { x: 24, y: 24 } });
  await page.keyboard.press("Meta+c");
  const target = await worldClientPoint(page, { x: 600, y: 420 });
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press("Meta+v");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const document = await savedCanvas(request, canvasId);
  const groups = document.nodes.filter((node) => node.type === "group");
  expect(groups).toHaveLength(2);
  const original = groups.find((node) => node.id === "g1")!;
  const pasted = groups.find((node) => node.id !== "g1")!;
  expect(original.position).toEqual({ x: 200, y: 150 });
  expect(pasted.position).toEqual({ x: 600, y: 420 });

  const children = document.nodes.filter(
    (node) => node.parentId === pasted.id,
  );
  expect(children.map((node) => node.type).sort()).toEqual(["image", "text"]);
  const textChild = children.find((node) => node.type === "text")!;
  const imageChild = children.find((node) => node.type === "image")!;
  expect(textChild.position).toEqual({ x: 60, y: 90 });
  expect(imageChild.position).toEqual({ x: 400, y: 90 });

  const pastedChildIds = new Set(children.map((node) => node.id));
  const internalEdge = document.edges.find(
    (edge) =>
      pastedChildIds.has(edge.source) && pastedChildIds.has(edge.target),
  );
  expect(internalEdge).toBeTruthy();
  expect(
    document.edges.some(
      (edge) =>
        (edge.source === "g1" || edge.target === "g1") &&
        (pastedChildIds.has(edge.source) || pastedChildIds.has(edge.target)),
    ),
  ).toBe(false);

  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  const undone = await savedCanvas(request, canvasId);
  expect(undone.nodes.filter((node) => node.type === "group")).toHaveLength(1);
});

test("copying a child node pastes it standalone at the cursor", async ({
  page,
  request,
}) => {
  const canvasId = await createProjectCanvas(request);
  await page.goto(`/canvas/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  await page.locator('.react-flow__node[data-id="t1"]').click();
  await page.keyboard.press("Meta+c");
  const target = await worldClientPoint(page, { x: 800, y: 500 });
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press("Meta+v");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const document = await savedCanvas(request, canvasId);
  const pastedText = document.nodes.find(
    (node) =>
      node.type === "text" &&
      node.id !== "t1" &&
      node.position.x === 800 &&
      node.position.y === 500,
  );
  expect(pastedText).toBeTruthy();
  expect(pastedText!.parentId).toBeUndefined();
  expect(document.edges).toHaveLength(1);
});
