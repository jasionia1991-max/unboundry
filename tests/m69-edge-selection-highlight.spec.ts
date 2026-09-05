import { expect, test } from "./safe-test";
import {
  connectedEdgeFlowDirections,
  selectionFlowAnimatedEdgeIds,
  stripSelectionFlowMarkers,
} from "../client/src/canvas/selectionFlow";
import { canvasGraphFingerprint } from "../client/src/canvas/canvasDocumentFingerprint";

test("selecting a node gently highlights only its direct edges with a bounded flow", async ({
  page,
  request,
}) => {
  const canvasId = "node.image.text-image-input";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );

  let savesAfterSelection = 0;
  page.on("request", (networkRequest) => {
    if (
      networkRequest.method() === "PUT" &&
      networkRequest.url().includes(`/api/canvas/${canvasId}`)
    ) {
      savesAfterSelection += 1;
    }
  });

  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 900, y: 500 } });
  const baseStroke = await page
    .locator(".react-flow__edge-path")
    .first()
    .evaluate((element) => getComputedStyle(element).stroke);
  await page.getByTestId("image-node-input-target-image").click();
  const highlighted = page.locator(
    ".react-flow__edge.connected-to-selected-node",
  );
  await expect(highlighted).toHaveCount(2);
  await expect(page.locator(".edge-selection-flow")).toHaveCount(2);

  const highlightedStroke = await highlighted
    .first()
    .locator(".react-flow__edge-path")
    .evaluate((element) => getComputedStyle(element).stroke);
  expect(highlightedStroke).not.toBe(baseStroke);

  // 选中只影响渲染，不能触发任何画布保存请求（防 revision 污染）。
  await page.waitForTimeout(1_200);
  expect(savesAfterSelection).toBe(0);
});

test("multi-selection highlights the union of directly connected edges", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.delete-cascade-and-undo");
  await page.getByTestId("probe-node-probe-b").click();
  await expect(
    page.locator(".react-flow__edge.connected-to-selected-node"),
  ).toHaveCount(1);
  await page
    .getByTestId("probe-node-probe-c")
    .click({ modifiers: ["Shift"] });
  await expect(
    page.locator(".react-flow__edge.connected-to-selected-node"),
  ).toHaveCount(2);
});

test("flow direction follows workflow layers and falls back safely on cycles", () => {
  const nodes = [
    { id: "a", type: "text", data: {} },
    { id: "b", type: "image", data: {} },
    { id: "c", type: "image", data: {} },
  ];
  const edges = [
    { id: "a-b", source: "a", target: "b" },
    { id: "b-c", source: "b", target: "c" },
  ];
  const directions = connectedEdgeFlowDirections(
    nodes,
    edges,
    new Set(["b"]),
  );
  expect(directions.get("a-b")).toBe(1);
  expect(directions.get("b-c")).toBe(1);

  const cyclicNodes = [
    { id: "x", type: "text", data: {} },
    { id: "y", type: "image", data: {} },
  ];
  const cyclicEdges = [
    { id: "x-y", source: "x", target: "y" },
    { id: "y-x", source: "y", target: "x" },
  ];
  expect(() =>
    connectedEdgeFlowDirections(cyclicNodes, cyclicEdges, new Set(["x"])),
  ).not.toThrow();
  const cyclicDirections = connectedEdgeFlowDirections(
    cyclicNodes,
    cyclicEdges,
    new Set(["x"]),
  );
  expect(cyclicDirections.get("x-y")).toBe(1);
  expect(cyclicDirections.get("y-x")).toBe(1);
});

test("flow animation is capped so dense selections stay calm", () => {
  const edges = Array.from({ length: 16 }, (_, index) => ({
    id: `e${index}`,
    source: "selected",
    target: `node-${index}`,
  }));
  const animated = selectionFlowAnimatedEdgeIds(
    edges,
    new Set(["selected"]),
  );
  expect(animated.size).toBe(10);
  expect(animated.has("e0")).toBe(true);
  expect(animated.has("e9")).toBe(true);
  expect(animated.has("e10")).toBe(false);
});

test("delete + undo does not leak highlight markers into restored edges", async ({
  page,
  request,
}) => {
  const canvasId = "interaction.delete-cascade-and-undo";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );

  const highlighted = page.locator(
    ".react-flow__edge.connected-to-selected-node",
  );
  await page.getByTestId("probe-node-probe-b").click();
  await expect(highlighted).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("probe-node-probe-b")).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(page.locator('[data-id^="probe-b-restored"]')).toHaveCount(1);
  await expect(highlighted).toHaveCount(1);

  await page
    .locator(".react-flow__pane")
    .click({ position: { x: 900, y: 500 } });
  await expect(highlighted).toHaveCount(0);
  await expect(page.locator(".edge-selection-flow")).toHaveCount(0);
});

test("stripSelectionFlowMarkers keeps the durable fingerprint stable", () => {
  const dirty = {
    className: "react-flow__edge connected-to-selected-node",
    data: {
      flowAnimated: true,
      flowDirection: 1,
      inputRole: "context-image",
    },
    id: "edge-a-b",
    source: "a",
    target: "b",
  };
  const clean = stripSelectionFlowMarkers(dirty);
  expect(clean.className).toBe("react-flow__edge");
  expect(clean.data).toEqual({ inputRole: "context-image" });
  const durable = {
    className: "react-flow__edge",
    data: { inputRole: "context-image" },
    id: "edge-a-b",
    source: "a",
    target: "b",
  };
  expect(
    canvasGraphFingerprint({ edges: [clean], nodes: [] }),
  ).toBe(canvasGraphFingerprint({ edges: [durable], nodes: [] }));
});
