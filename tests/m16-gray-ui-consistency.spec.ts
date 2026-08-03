import { expect, test } from "@playwright/test";

test("admin forms and canvas focus states stay inside the gray UI system", async ({
  page,
}) => {
  await page.goto("/admin/accounts");
  const accountForm = page.locator(".admin-card form");
  await expect(accountForm).toHaveAttribute("autocomplete", "off");
  await expect(accountForm.getByPlaceholder("登录账号")).toHaveAttribute(
    "autocomplete",
    "off",
  );
  await expect(
    accountForm.getByPlaceholder("初始密码（至少 12 位）"),
  ).toHaveAttribute("autocomplete", "new-password");

  await page.goto("/admin/models");
  const publish = page.locator('.model-publish-check input[type="checkbox"]');
  await expect(publish).toHaveCSS("appearance", "none");
  await expect(publish).toHaveCSS("background-color", "rgb(20, 20, 21)");
  await expect(publish).toHaveCSS("border-radius", "4px");

  await page.goto("/__fixture/shell.empty.primary");
  const share = page.getByTestId("share");
  await share.focus();
  await expect(share).toHaveCSS(
    "box-shadow",
    "rgba(245, 245, 245, 0.72) 0px 0px 0px 2px",
  );
});

test("model admin form stays inside its card across the responsive boundary", async ({
  page,
}) => {
  await page.setViewportSize({ height: 882, width: 902 });
  await page.goto("/admin/models?layout=compact-desktop");

  const adminPage = page.getByTestId("admin-models-page");
  const cards = adminPage.locator(".admin-layout > .admin-card");
  const preset = adminPage.locator(".admin-model-parameter-preset");
  const presetButton = preset.getByRole("button", { name: "载入推荐参数" });
  await expect(cards).toHaveCount(2);
  await expect(presetButton).toBeVisible();
  await expect(presetButton).toHaveCSS("border-radius", "9px");
  await expect(presetButton).toHaveCSS("background-color", "rgb(48, 48, 50)");

  await adminPage.getByRole("button", { name: "节点类型" }).click();
  await adminPage.getByRole("option", { name: "文字节点" }).click();
  const switchPolicy = adminPage.getByRole("combobox", {
    name: "模型切换规则",
  });
  await expect(switchPolicy).toHaveCSS("height", "34px");
  await expect(switchPolicy).toHaveCSS("border-radius", "11px");
  expect(await switchPolicy.evaluate((element) => element.tagName)).toBe("BUTTON");
  const upstreamRules = adminPage.locator(".admin-model-upstream-inputs")
    .filter({ hasText: "上游输入规则" });
  const textRule = upstreamRules.locator('[data-input-kind="text"]');
  await textRule.getByRole("combobox").click();
  await textRule.getByRole("option", { name: "固定画布数量" }).click();
  await expect(textRule.getByRole("spinbutton", { name: "文字上游输入上限" }))
    .toBeVisible();

  for (const width of [902, 921, 929, 1135]) {
    await page.setViewportSize({ height: 882, width });
    const geometry = await adminPage.evaluate((element) => {
      const [createCard, modelList] = Array.from(
        element.querySelectorAll<HTMLElement>(".admin-layout > .admin-card"),
      );
      const form = createCard.querySelector<HTMLElement>("form")!;
      const editor = form.querySelector<HTMLElement>(".admin-model-parameters")!;
      const upstreamLists = Array.from(
        editor.querySelectorAll<HTMLElement>(".admin-model-upstream-list"),
      );
      const upstreamRows = upstreamLists.flatMap((list) =>
        Array.from(list.querySelectorAll<HTMLElement>(":scope > div")));
      const fixedLimit = upstreamLists.at(-1)!.querySelector<HTMLElement>(
        '[data-input-kind="text"] .admin-model-upstream-limit',
      )!;
      const presetElement = form.querySelector<HTMLElement>(
        ".admin-model-parameter-preset",
      )!;
      const copyBox = presetElement.querySelector("span")!.getBoundingClientRect();
      const buttonBox = presetElement.querySelector("button")!.getBoundingClientRect();
      const contains = (parent: HTMLElement, child: HTMLElement) => {
        const parentBox = parent.getBoundingClientRect();
        const childBox = child.getBoundingClientRect();
        return childBox.left >= parentBox.left - 0.5 &&
          childBox.right <= parentBox.right + 0.5 &&
          child.scrollWidth <= child.clientWidth + 1;
      };
      const createBox = createCard.getBoundingClientRect();
      const listBox = modelList.getBoundingClientRect();
      return {
        cardsSideBySide: listBox.left >= createBox.right + 19,
        cardsStacked:
          Math.abs(createBox.left - listBox.left) < 1 &&
          Math.abs(createBox.width - listBox.width) < 1 &&
          listBox.top >= createBox.bottom + 19,
        copySeparatedFromButton: copyBox.right <= buttonBox.left - 9.5,
        editorContained: contains(form, editor),
        fixedLimitContained: contains(
          fixedLimit.closest<HTMLElement>('[data-input-kind="text"]')!,
          fixedLimit,
        ),
        formContained: contains(createCard, form),
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        listOverflowY: getComputedStyle(modelList).overflowY,
        rowsContained: upstreamRows.every((row) =>
          contains(row.parentElement as HTMLElement, row)),
        roleOptionsSpanRow: upstreamLists[0]
          .querySelector<HTMLElement>(
            '[data-input-kind="text"] .admin-model-parameter-options',
          )!.getBoundingClientRect().width > 120,
      };
    });
    expect(geometry).toMatchObject({
      copySeparatedFromButton: true,
      editorContained: true,
      fixedLimitContained: true,
      formContained: true,
      listOverflowY: "visible",
      roleOptionsSpanRow: true,
      rowsContained: true,
      ...(width <= 928
        ? { cardsSideBySide: false, cardsStacked: true }
        : { cardsSideBySide: true, cardsStacked: false }),
    });
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  }
});

test("expanded reference combinations and the last model dropdown remain usable", async ({
  page,
}) => {
  const providerPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (/\/api\/generation-tasks/.test(request.url()) || /openrouter|volces/i.test(request.url()))
    ) {
      providerPosts.push(request.url());
    }
  });
  const parameterSchema = {
    fields: [{
      defaultValue: "reference",
      group: "input",
      key: "inputMode",
      label: "生成方式",
      options: [
        { label: "首尾帧", value: "first-last-frame" },
        { label: "参考", value: "reference" },
      ],
      summary: true,
      type: "select",
    }],
    groups: [],
    referenceInputs: { audio: 0, image: 5, video: 2 },
    referencePolicy: {
      modeKey: "inputMode",
      modes: {
        "first-last-frame": { sets: [{ audio: 0, image: 2, video: 0 }] },
        reference: {
          sets: [
            { audio: 0, image: 3, video: 2 },
            { audio: 0, image: 5, video: 0 },
          ],
        },
      },
    },
    version: 2,
  };
  const models = ["A", "B", "C"].map((suffix, index) => ({
    capability: "video",
    costCurrency: "USD",
    displayName: `Layout Video ${suffix}`,
    id: `layout-video-${suffix.toLowerCase()}`,
    isDefault: false,
    maxCostMicrounits: 0,
    parameterSchema,
    providerConnected: false,
    providerDriver: "openrouter",
    providerModelId: `test/layout-video-${suffix.toLowerCase()}`,
    providerName: "No provider",
    providerProfileId: "provider-unconfigured",
    sortOrder: index,
    status: "draft",
  }));
  await page.route("**/api/admin/models", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({ models, providers: [] }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ height: 882, width: 1135 });
  await page.goto("/admin/models?layout=expanded-reference");
  const lastCard = page.locator(".model-list article")
    .filter({ hasText: "Layout Video C" });
  await lastCard.getByRole("button", { name: "参数设置" }).click();
  await lastCard.getByRole("button", { name: "添加另一种组合" }).last().click();
  await expect(lastCard.locator(".admin-model-reference-set")).toHaveCount(4);

  for (const width of [902, 921, 929, 1135]) {
    await page.setViewportSize({ height: 882, width });
    const geometry = await lastCard.evaluate((card) => {
      const cardElement = card as HTMLElement;
      const modelList = cardElement.closest<HTMLElement>(".model-list")!;
      const editor = cardElement.querySelector<HTMLElement>(
        ".admin-model-parameter-edit",
      )!;
      const reference = editor.querySelector<HTMLElement>(
        ".admin-model-reference-limits",
      )!;
      const sets = Array.from(
        reference.querySelectorAll<HTMLElement>(".admin-model-reference-set"),
      );
      const contains = (parent: HTMLElement, child: HTMLElement) => {
        const parentBox = parent.getBoundingClientRect();
        const childBox = child.getBoundingClientRect();
        return childBox.left >= parentBox.left - 0.5 &&
          childBox.right <= parentBox.right + 0.5 &&
          child.scrollWidth <= child.clientWidth + 1;
      };
      return {
        cardContained: contains(modelList, cardElement),
        editorContained: contains(cardElement, editor),
        listOverflowY: getComputedStyle(modelList).overflowY,
        referenceContained: contains(editor, reference),
        setsContained: sets.every((set) => contains(reference, set)),
      };
    });
    expect(geometry).toEqual({
      cardContained: true,
      editorContained: true,
      listOverflowY: "visible",
      referenceContained: true,
      setsContained: true,
    });
  }

  const inputMode = lastCard.locator('[data-parameter-key="inputMode"]')
    .locator(".admin-model-parameter-default")
    .getByRole("combobox");
  await inputMode.evaluate((element) => {
    element.scrollIntoView({ block: "end", inline: "nearest" });
    window.scrollBy(0, 12);
  });
  await inputMode.click();
  await expect(inputMode.locator("..")).toHaveAttribute("data-placement", "up");
  const firstLastFrame = lastCard.getByRole("option", { name: "首尾帧" });
  await expect(firstLastFrame).toBeVisible();
  await firstLastFrame.click();
  await expect(inputMode).toContainText("首尾帧");
  expect(providerPosts).toEqual([]);
});
