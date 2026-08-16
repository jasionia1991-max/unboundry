import { expect, test } from "./safe-test";

test("文字生视频 shortcut creates the observed two-node animated workflow", async ({
  page,
}) => {
  await page.goto("/__fixture/workflow.text-to-video.created");
  const world = page.getByTestId("canvas-world");

  await expect(world).toHaveAttribute("data-node-count", "0");
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(page.getByTestId("empty-quick-actions")).toBeVisible();

  await page.getByTestId("quick-text-video").click();
  await expect(page.getByTestId("empty-quick-actions")).toHaveCount(0);
  await expect(world).toHaveAttribute("data-node-count", "2");
  await expect(world).toHaveAttribute("data-edge-count", "1");

  const text = page.locator('.react-flow__node[data-id="workflow-text"]');
  const video = page.locator('.react-flow__node[data-id="workflow-video"]');
  expect(await text.boundingBox()).toMatchObject({ width: 250, height: 250 });
  expect(await video.boundingBox()).toMatchObject({ width: 444, height: 250 });
  await expect(text).toContainText("A cinematic wide shot");

  const highlight = page.locator(".workflow-edge-highlight");
  await expect(highlight).toHaveCount(1);
  await expect(highlight).toHaveCSS("animation-duration", "2s");
  await expect(highlight).not.toHaveAttribute("marker-end");
});
