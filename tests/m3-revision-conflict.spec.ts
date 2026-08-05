import { expect, test } from "@playwright/test";

test("last tab to save wins and other tabs converge to the latest content", async ({
  context,
  page,
  request,
}) => {
  await request.delete("/api/canvas/persistence.revision-conflict");
  await page.goto("/__fixture/persistence.revision-conflict");
  const secondPage = await context.newPage();
  await secondPage.goto("/__fixture/persistence.revision-conflict");

  const firstWorld = page.getByTestId("canvas-world");
  const secondWorld = secondPage.getByTestId("canvas-world");
  await expect(firstWorld).toHaveAttribute("data-persistence-ready", "true");
  await expect(secondWorld).toHaveAttribute("data-persistence-ready", "true");

  const firstNode = page.locator('[data-id="conflict-node"]');
  const firstBox = (await firstNode.boundingBox())!;
  await page.mouse.move(firstBox.x + 100, firstBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + 220, firstBox.y + 150, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const document = await (
        await request.get("/api/canvas/persistence.revision-conflict")
      ).json() as { nodes: Array<{ position: { x: number } }> };
      return document.nodes[0].position.x;
    })
    .toBeGreaterThan(480);

  const secondNode = secondPage.locator('[data-id="conflict-node"]');
  const secondBox = (await secondNode.boundingBox())!;
  await secondPage.mouse.move(secondBox.x + 100, secondBox.y + 100);
  await secondPage.mouse.down();
  await secondPage.mouse.move(secondBox.x - 80, secondBox.y + 180, { steps: 5 });
  await secondPage.mouse.up();

  // The second tab is the last writer: its save must be accepted without a
  // conflict dialog and become the stored document.
  await expect.poll(async () => {
    const document = await (
      await request.get("/api/canvas/persistence.revision-conflict")
    ).json() as { nodes: Array<{ position: { x: number } }> };
    return document.nodes[0].position.x;
  }).toBeLessThan(480);
  await expect(secondPage.getByTestId("save-conflict")).toHaveCount(0);

  // The first tab receives the sync notification and converges to the latest
  // content without any manual reload.
  await expect.poll(async () => {
    const first = await firstNode.boundingBox();
    const second = await secondNode.boundingBox();
    return first && second ? Math.abs(first.x - second.x) < 1 : -1;
  }).toBe(true);
});
