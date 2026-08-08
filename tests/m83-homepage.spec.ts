import { expect, test } from "./safe-test";

test("homepage shows the brand icon and 无央 wordmark at the agreed sizes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-page")).toBeVisible();
  await expect(page.getByTestId("workspace-brand")).toBeVisible();
  await expect(page.getByText("无央", { exact: true })).toBeVisible();

  const iconBox = await page
    .locator(".workspace-brand .replica-mark")
    .boundingBox();
  expect(Math.round(iconBox!.width)).toBe(60);
  expect(Math.round(iconBox!.height)).toBe(60);

  const wordmarkSize = await page
    .locator(".workspace-wordmark")
    .evaluate((element) => getComputedStyle(element).fontSize);
  expect(wordmarkSize).toBe("22px");
});

test("canvas top-left icon is 34px and admin pages keep 32px", async ({
  page,
}) => {
  await page.goto("/canvas");
  await expect(page.getByTestId("logo-button")).toBeVisible();
  const canvasIcon = await page
    .locator(".logo-button .replica-mark")
    .boundingBox();
  expect(Math.round(canvasIcon!.width)).toBe(60);
  expect(Math.round(canvasIcon!.height)).toBe(60);

  await page.goto("/admin/accounts");
  await expect(page.getByTestId("admin-accounts-page")).toBeVisible();
  const adminIcon = await page
    .locator(".admin-page .replica-mark")
    .first()
    .boundingBox();
  expect(Math.round(adminIcon!.width)).toBe(32);
  expect(Math.round(adminIcon!.height)).toBe(32);
});
