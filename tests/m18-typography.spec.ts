import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "./safe-test";

const allowedSizes = ["12px", "14px"];

async function expectUnifiedTypography(page: Page) {
  const result = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll("body *")).filter(
      (element) =>
        element.textContent?.trim() && element.getClientRects().length > 0,
    );
    const styles = visible.flatMap((element) => {
      const normal = getComputedStyle(element);
      const pseudo = ["::before", "::after"].flatMap((selector) => {
        const style = getComputedStyle(element, selector);
        return style.content && !["none", "normal", '""'].includes(style.content)
          ? [{ family: style.fontFamily, size: style.fontSize }]
          : [];
      });
      return [{ family: normal.fontFamily, size: normal.fontSize }, ...pseudo];
    });
    return {
      families: [...new Set(styles.map((style) => style.family))],
      sizes: [...new Set(styles.map((style) => style.size))],
    };
  });
  expect(result.sizes.filter((size) => !allowedSizes.includes(size))).toEqual([]);
  expect(result.families.some((family) => /Inter|Roboto|Segoe UI/i.test(family)))
    .toBe(false);
  expect(result.families.every((family) => /-apple-system|system-ui/i.test(family)))
    .toBe(true);
}

test("the stylesheet exposes only two text sizes and the macOS native font stack", async () => {
  const css = await readFile("client/src/styles.css", "utf8");
  const sizes = [...css.matchAll(/font-size:\s*([^;\n]+)/g)].map((match) =>
    match[1].trim(),
  );
  expect([...new Set(sizes)].sort()).toEqual([
    // 品牌区例外：无央 22px / UNBOUNDRY 小标 10px；既有紧凑 UI 允许 12px/14px。
    "10px",
    "12px",
    "14px",
    "22px",
    "inherit",
    "var(--tap-font-primary)",
    "var(--tap-font-primary) !important",
    "var(--tap-font-secondary)",
  ]);
  expect(css).toContain(
    '--tap-font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text"',
  );
  expect(css).not.toMatch(/font-family:[^;]*(Inter|Roboto|Segoe UI)/i);
});

test("canvas, expanded menus, creator controls and every admin page keep two font sizes", async ({
  page,
}) => {
  await page.goto("/canvas");
  await expectUnifiedTypography(page);

  await page.getByTestId("add-node").click();
  await expect(page.getByTestId("add-node-menu")).toBeVisible();
  await expectUnifiedTypography(page);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "项目菜单" }).click();
  await expectUnifiedTypography(page);
  await page.keyboard.press("Escape");

  await page.getByTestId("node-search").click();
  await expectUnifiedTypography(page);
  await page.keyboard.press("Escape");

  await page.goto("/__fixture/node.text.creator-open");
  await expect(page.getByTestId("text-creator")).toBeVisible();
  await expectUnifiedTypography(page);

  await page.goto("/__fixture/node.image.prompt-ready");
  await expect(page.getByTestId("image-creator")).toBeVisible();
  await expectUnifiedTypography(page);

  await page.goto("/__fixture/node.video.generating");
  await expect(page.getByTestId("video-creator")).toBeVisible();
  await expectUnifiedTypography(page);

  await page.goto("/__fixture/node.audio.empty");
  await expectUnifiedTypography(page);

  for (const route of [
    "/admin/models",
    "/admin/providers",
    "/admin/storage",
    "/admin/generation-safety",
    "/admin/api-contract",
  ]) {
    await page.goto(route);
    await expectUnifiedTypography(page);
  }

  await page.goto("/admin/models");
  await page.getByRole("button", { name: "节点类型" }).click();
  await expect(page.getByRole("listbox", { name: "节点类型选项" })).toBeVisible();
  await expectUnifiedTypography(page);
});
