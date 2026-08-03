import { expect, test } from "@playwright/test";

test("Historical Storyboard/Table loads without inventing a create entry", async ({
  page,
}) => {
  await page.goto("/__fixture/legacy.node.storyboard-table");

  const node = page.getByTestId("storyboard-node-storyboard-table-primary");
  await expect(node).toHaveAttribute("data-logical-size", "1200x1000");
  await expect(node.locator('[data-shot-status="complete"]')).toHaveCount(2);
  await expect(node.locator('[data-shot-status="loading"]')).toHaveCount(1);
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(0);
  await expect(page.getByText("新建 Storyboard")).toHaveCount(0);

  const zoom = Number(
    await page.getByTestId("canvas-world").getAttribute("data-viewport-zoom"),
  );
  const box = (await node.boundingBox())!;
  expect(box.width / zoom).toBeCloseTo(1200, 0);
  expect(box.height / zoom).toBeCloseTo(1000, 0);
});

test("Storyboard/Table views share the same historical shots", async ({
  page,
}) => {
  await page.goto("/__fixture/legacy.node.storyboard-table");

  const node = page.getByTestId("storyboard-node-storyboard-table-primary");
  const ids = await node
    .locator("[data-shot-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-shot-id")));

  await node.getByRole("button", { name: "图表视图" }).click();
  await node.getByRole("menuitem", { name: "创意视图" }).click();
  await expect(node.getByTestId("storyboard-creative-view")).toBeVisible();

  const creativeIds = await node
    .locator("[data-shot-id]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-shot-id")));
  expect(creativeIds).toEqual(ids);
  await expect(node).toContainText("媒体");
  await expect(node).toContainText("分镜编号");
  await expect(node).toContainText("对白");
  await expect(node).toContainText("备注");
});
