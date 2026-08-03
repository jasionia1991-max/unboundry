import { expect, test } from "@playwright/test";

test("a stale second tab cannot silently overwrite the first tab", async ({
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

  const before = await (
    await request.get("/api/canvas/persistence.revision-conflict")
  ).json() as { revision: number };
  expect(before.revision).toBe(1);

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

  const saved = await (
    await request.get("/api/canvas/persistence.revision-conflict")
  ).json() as { nodes: Array<{ position: { x: number; y: number } }> };

  const secondNode = secondPage.locator('[data-id="conflict-node"]');
  const secondBox = (await secondNode.boundingBox())!;
  await secondPage.mouse.move(secondBox.x + 100, secondBox.y + 100);
  await secondPage.mouse.down();
  await secondPage.mouse.move(secondBox.x - 80, secondBox.y + 180, { steps: 5 });
  await secondPage.mouse.up();

  await expect(secondPage.getByTestId("save-conflict")).toBeVisible();
  const afterConflict = await (
    await request.get("/api/canvas/persistence.revision-conflict")
  ).json() as { nodes: Array<{ position: { x: number; y: number } }> };
  expect(afterConflict.nodes[0].position).toEqual(saved.nodes[0].position);

  await secondPage.getByRole("button", { name: "重新载入" }).click();
  await expect(secondWorld).toHaveAttribute("data-persistence-ready", "true");
  const reloadedBox = (await secondNode.boundingBox())!;
  const currentFirstBox = (await firstNode.boundingBox())!;
  expect(reloadedBox.x).toBeCloseTo(currentFirstBox.x, 0);
  expect(reloadedBox.y).toBeCloseTo(currentFirstBox.y, 0);
});
