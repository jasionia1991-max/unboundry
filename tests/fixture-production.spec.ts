import { expect, test } from "@playwright/test";

test("production build does not expose fixture data", async ({ page }) => {
  await page.goto("/__fixture/shell.empty.primary");

  await expect(page.getByTestId("fixture-unavailable")).toBeVisible();
  await expect(page.getByTestId("canvas-shell")).toHaveCount(0);

  const response = await page.request.get(
    "/__fixture-api/shell.empty.primary",
    { headers: { Accept: "application/json" } },
  );
  expect(await response.text()).not.toContain('"fixture"');

  await page.goto("/__responsive-preview/1440x900");
  await expect(page.getByTestId("fixture-unavailable")).toBeVisible();
  await expect(page.getByTestId("responsive-preview")).toHaveCount(0);
});
