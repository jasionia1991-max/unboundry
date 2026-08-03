import { expect, test } from "@playwright/test";

test("deleting a canvas node does not delete account history", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/panel.history.final");
  await request.delete("/api/history/fixture-account");
  await page.goto("/__fixture/panel.history.final");

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "3");
  await expect(page.getByTestId("history-panel")).toBeVisible();
  await expect(page.getByTestId("history-count-image")).toHaveText("2");
  await expect(page.getByTestId("history-count-video")).toHaveText("1");
  await expect(page.getByTestId("history-count-audio")).toHaveText("4");

  const generatedHistory = await request.post("/api/history/fixture-account", {
    data: {
      id: "generated-history-image",
      kind: "image",
      label: "一只黑猫",
      preview: "/api/assets/generated-history-image",
    },
  });
  expect(generatedHistory.ok()).toBeTruthy();
  const historyButton = page.getByTestId("history");
  await historyButton.click();
  await historyButton.click();
  const generatedCard = page.getByRole("button", { name: "一只黑猫" });
  await expect(generatedCard).toBeVisible();
  await expect(generatedCard.locator("img")).toHaveAttribute(
    "src",
    "/api/assets/generated-history-image",
  );
  await expect(
    page.getByTestId("history-count-image"),
  ).toHaveText("3");
  await request.delete("/api/history/fixture-account");
  await historyButton.click();
  await historyButton.click();
  await expect(page.getByTestId("history-count-image")).toHaveText("2");

  await page.locator('[data-id="history-canvas-image"]').click();
  await page.keyboard.press("Backspace");
  await expect(world).toHaveAttribute("data-node-count", "2");
  await expect(page.getByTestId("history-panel")).toHaveCount(0);
  await page.waitForTimeout(700);

  const history = await request.get("/api/history/fixture-account");
  expect(history.ok()).toBeTruthy();
  expect((await history.json() as { items: unknown[] }).items).toHaveLength(7);

  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByTestId("history-count-image")).toHaveText("2");
  await expect(page.getByTestId("history-count-video")).toHaveText("1");
  await expect(page.getByTestId("history-count-audio")).toHaveText("4");

  await page.reload();
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect(world).toHaveAttribute("data-node-count", "2");
  await expect(page.getByTestId("history-count-image")).toHaveText("2");
  await expect(page.getByTestId("history-count-video")).toHaveText("1");
  await expect(page.getByTestId("history-count-audio")).toHaveText("4");
});
