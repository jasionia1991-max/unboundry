import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

type CheckboxGeometry = {
  appearance: string;
  borderRadius: string;
  cardContainsInput: boolean;
  className: string;
  height: string;
  labelContainsInput: boolean;
  margin: string;
  minHeight: string;
  padding: string;
  width: string;
};

async function visibleAdminCheckboxes(page: Page) {
  return page.locator('.admin-card input[type="checkbox"]').evaluateAll(
    (inputs) => inputs
      .filter((input) => input.getClientRects().length > 0)
      .map((input) => {
        const element = input as HTMLInputElement;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const labelBox = element.closest("label")?.getBoundingClientRect();
        const cardBox = element.closest(".admin-card")?.getBoundingClientRect();
        const contains = (parent: DOMRect | undefined) => Boolean(
          parent &&
          box.left >= parent.left - 0.5 &&
          box.right <= parent.right + 0.5 &&
          box.top >= parent.top - 0.5 &&
          box.bottom <= parent.bottom + 0.5,
        );
        return {
          appearance: style.appearance,
          borderRadius: style.borderRadius,
          cardContainsInput: contains(cardBox),
          className: element.className,
          height: style.height,
          labelContainsInput: contains(labelBox),
          margin: style.margin,
          minHeight: style.minHeight,
          padding: style.padding,
          width: style.width,
        } satisfies CheckboxGeometry;
      }),
  );
}

function expectCanonicalCheckboxes(checkboxes: CheckboxGeometry[]) {
  expect(checkboxes.length).toBeGreaterThan(0);
  for (const checkbox of checkboxes) {
    expect(checkbox).toMatchObject({
      appearance: "none",
      borderRadius: "4px",
      cardContainsInput: true,
      height: "16px",
      labelContainsInput: true,
      margin: "0px",
      minHeight: "16px",
      padding: "0px",
      width: "16px",
    });
    expect(checkbox.className.split(/\s+/)).toContain("admin-compact-checkbox");
  }
}

test("every Admin checkbox declares the shared control and text inputs stay isolated", async () => {
  const source = await readFile("client/src/App.tsx", "utf8");
  const styles = await readFile("client/src/styles.css", "utf8");
  const checkboxInputs = [...source.matchAll(/<input\b[\s\S]*?\/>/g)]
    .map(([input]) => input)
    .filter((input) => /type="checkbox"/.test(input));

  expect(checkboxInputs).toHaveLength(7);
  for (const input of checkboxInputs) {
    expect(input).toContain('className="admin-compact-checkbox"');
  }

  expect(styles).toContain(".admin-card :where(");
  expect(styles).toContain('.admin-card input[type="checkbox"] {');
  for (const textInputSelector of [
    "input:not([type])",
    'input[type="text"]',
    'input[type="password"]',
    'input[type="email"]',
    'input[type="url"]',
    'input[type="search"]',
    'input[type="tel"]',
    'input[type="number"]',
  ]) {
    expect(styles).toContain(textInputSelector);
  }
  expect(styles).not.toMatch(/\.admin-card\s+input\s*\{/);
  expect(styles).not.toMatch(/\.auth-card\s+input\s*\{/);
  expect(styles).not.toContain(".admin-card .admin-compact-checkbox");
  expect(styles).not.toMatch(
    /\.admin-model-(?:parameter-enable|parameter-options|reference-heading|upstream-enable)\s+input/,
  );
});

test("all model-admin checkbox roles use the compact gray control without paid requests", async ({
  baseURL,
  page,
}) => {
  const externalRequests: string[] = [];
  const localWrites: string[] = [];
  const providerRequests: string[] = [];
  const localOrigin = new URL(
    baseURL ?? "http://127.0.0.1:4173",
  ).origin;

  page.on("request", (request) => {
    const url = new URL(request.url());
    const method = request.method();
    if (/openrouter|volces|mureka/i.test(request.url())) {
      providerRequests.push(`${method} ${request.url()}`);
    }
    if (url.origin !== localOrigin && !request.url().startsWith("data:")) {
      externalRequests.push(`${method} ${request.url()}`);
    }
    if (
      url.origin === localOrigin &&
      !["GET", "HEAD", "OPTIONS"].includes(method)
    ) {
      localWrites.push(`${method} ${url.pathname}`);
    }
  });

  await page.route("**/api/admin/models", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({ models: [], providers: [] }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.abort();
  });

  const statusBefore = await (
    await page.request.get("/api/generation-tasks/status")
  ).json() as { paidProviderRequests: number };
  expect(statusBefore.paidProviderRequests).toBe(0);

  await page.goto("/admin/models?checkbox-system=1");
  const adminPage = page.getByTestId("admin-models-page");
  const displayName = page.getByPlaceholder("用户看到的模型名称");
  await expect(displayName).toHaveCSS("height", "46px");
  await expect(displayName).toHaveCSS("border-radius", "12px");

  const publish = page.locator('.model-publish-check input[type="checkbox"]');
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveCSS("opacity", "0.45");
  await expect(publish).toHaveCSS("cursor", "not-allowed");

  const imageReferenceOption = page.locator(
    '[data-parameter-key="inputMode"] .admin-model-parameter-options label',
  ).filter({ hasText: "图片参考" }).getByRole("checkbox");
  await expect(imageReferenceOption).not.toBeChecked();
  await expect(imageReferenceOption).toHaveCSS(
    "background-color",
    "rgb(20, 20, 21)",
  );
  await imageReferenceOption.check();
  await expect(imageReferenceOption).toHaveCSS(
    "background-color",
    "rgb(236, 236, 238)",
  );
  await expect(
    page.locator(
      '.admin-model-reference-heading input[type="checkbox"]',
    ),
  ).toBeVisible();

  const focusTarget = page.locator(
    '.admin-model-parameter-enable input[type="checkbox"]:not(:disabled)',
  ).first();
  await page.keyboard.press("Tab");
  await focusTarget.focus();
  expect(await focusTarget.evaluate((element) => element.matches(":focus-visible")))
    .toBe(true);
  await expect(focusTarget).toHaveCSS(
    "box-shadow",
    "rgba(255, 255, 255, 0.16) 0px 0px 0px 3px",
  );

  await adminPage.getByRole("button", { name: "节点类型" }).click();
  await adminPage.getByRole("option", { name: "文字节点" }).click();
  await expect(
    page.locator('.admin-model-upstream-enable input[type="checkbox"]'),
  ).toHaveCount(4);

  for (const width of [902, 1135]) {
    await page.setViewportSize({ height: 917, width });
    expectCanonicalCheckboxes(await visibleAdminCheckboxes(page));
    const horizontalOverflow = await adminPage.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  }

  const statusAfter = await (
    await page.request.get("/api/generation-tasks/status")
  ).json() as { paidProviderRequests: number };
  expect(statusAfter.paidProviderRequests).toBe(0);
  expect(providerRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(localWrites).toEqual([]);
});
