import { expect, test } from "./safe-test";

test("Backspace cascades incident edges and Cmd+Z restores a new node id", async ({
  page,
}) => {
  await page.goto("/__fixture/interaction.delete-cascade-and-undo");
  const world = page.getByTestId("canvas-world");
  const a = page.locator('.react-flow__node[data-id="probe-a"]');
  const assetId = await a.locator(".probe-node").getAttribute("data-asset-id");

  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await a.click();
  await page.keyboard.press("Backspace");

  await expect(world).toHaveAttribute("data-node-count", "2");
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await expect(a).toHaveCount(0);
  await expect(
    page.locator('.react-flow__node[data-id="probe-b"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.react-flow__node[data-id="probe-c"]'),
  ).toHaveCount(1);

  await page.keyboard.press("Meta+z");

  const restored = page.locator(
    '.react-flow__node[data-id^="probe-a-restored-"]',
  );
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
  await expect(restored).toHaveCount(1);
  await expect(restored.locator(".probe-node")).toHaveAttribute(
    "data-asset-id",
    assetId!,
  );
  await expect(restored).toHaveClass(/selected/);

  await page.keyboard.press("Meta+Shift+z");
  await expect(world).toHaveAttribute("data-node-count", "2");
  await expect(world).toHaveAttribute("data-edge-count", "0");
  await page.keyboard.press("Meta+z");
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(world).toHaveAttribute("data-edge-count", "2");
});
