import { expect, test } from "./safe-test";
import { defaultParameterSchema } from "../types/modelParameters";
import { composeTextControl } from "./helpers/ime";

test("Agent empty panel matches the frozen geometry", async ({ page }) => {
  await page.goto("/__fixture/panel.agent.expanded-empty");

  await expect(page.getByTestId("agent-panel")).toBeVisible();
  expect(await page.getByTestId("canvas-world").boundingBox()).toMatchObject({
    height: 917,
    width: 655,
    x: 0,
    y: 0,
  });
  expect(await page.getByTestId("agent-panel").boundingBox()).toMatchObject({
    height: 917,
    width: 480,
    x: 655,
    y: 0,
  });
  expect(
    await page.getByTestId("agent-suggestion-a").boundingBox(),
  ).toMatchObject({ height: 148, width: 223, x: 670, y: 372 });
  expect(
    await page.getByTestId("agent-suggestion-b").boundingBox(),
  ).toMatchObject({ height: 148, width: 222, x: 897, y: 372 });
  expect(await page.getByTestId("agent-prompt").boundingBox()).toMatchObject({
    height: 48,
    width: 431,
    x: 679,
    y: 804,
  });
  await expect(page.getByTestId("agent-send")).toBeDisabled();
});

test("Agent input treats one IME composition as one undo unit", async ({
  page,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await page.goto("/__fixture/panel.agent.expanded-empty");
  const prompt = page.getByTestId("agent-prompt");
  await composeTextControl(prompt, ["ni", "ni hao", "你好"]);
  await expect(prompt).toHaveValue("你好");
  await prompt.press("Meta+z");
  await expect(prompt).toHaveValue("");
  await expect(prompt).not.toHaveValue(/ni hao/i);
  await prompt.press("Meta+Shift+z");
  await expect(prompt).toHaveValue("你好");

  await prompt.dispatchEvent("compositionstart", { data: "" });
  await prompt.evaluate((element: HTMLTextAreaElement) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setValue.call(element, "ni hao pin yin");
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertCompositionText",
      isComposing: true,
    }));
  });
  await prompt.blur();
  await expect(prompt).toHaveValue("你好");
  expect(generationRequests).toEqual([]);
});

test("Agent files drawer matches the frozen empty state", async ({ page }) => {
  await page.goto("/__fixture/panel.agent.files-empty");

  const files = page.getByTestId("agent-files-panel");
  await expect(files).toBeVisible();
  expect(await files.boundingBox()).toMatchObject({
    height: 200,
    width: 320,
    x: 323,
    y: 0,
  });
  await expect(files.getByText("文件", { exact: true })).toBeVisible();
  await expect(files.getByText("暂无输出", { exact: true })).toBeVisible();
  await files.getByRole("button", { name: "收起文件" }).click();
  await expect(files).toHaveCount(0);
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await expect(page.getByTestId("agent-files-panel")).toBeVisible();
});

test("new creator nodes keep their selected toolbars beside Agent", async ({
  page,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  for (const [label, type, creator] of [
    ["文本", "text", "text-creator"],
    ["图片", "image", "image-creator"],
    ["视频", "video", "video-creator"],
  ] as const) {
    await page.goto(
      `/__fixture/panel.agent.expanded-empty?creator=${type}`,
    );
    const world = page.getByTestId("canvas-world");
    await world.dblclick({ position: { x: 280, y: 180 } });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
      .toBe("");
    await page
      .getByTestId("add-node-menu")
      .getByRole("menuitem", { name: label, exact: true })
      .click();
    await expect(page.locator(`.react-flow__node-${type}.selected`)).toHaveCount(
      1,
    );
    await expect(page.getByTestId(creator)).toBeVisible();
    if (type === "text") {
      await expect(page.getByTestId("text-node-toolbar")).toBeVisible();
    } else {
      await expect(page.getByTestId(`${type}-node-toolbar`)).toHaveCount(0);
    }
  }

  await expect(
    page.getByTestId("video-creator").getByRole("button", { name: "Generate" }),
  ).toBeDisabled();
  expect(generationRequests).toEqual([]);
});

test("Agent add, canvas reference, confirmation and model menus match", async ({
  page,
  request,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });

  const createdModelResponse = await request.post("/api/admin/models", {
    data: {
      capability: "text",
      displayName: "Doubao Seed",
      isDefault: true,
      parameterSchema: defaultParameterSchema("text"),
      providerModelId: "test/doubao-seed-lite",
      sortOrder: 1,
      status: "published",
    },
  });
  expect(createdModelResponse.status()).toBe(201);
  const createdModel = await createdModelResponse.json() as { model: { id: string } };

  await page.goto("/__fixture/menu.agent.add-and-model");
  await expect(page.getByTestId("agent-panel")).toBeVisible();
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);

  await page.getByTestId("agent-add").click();
  const addMenu = page.getByTestId("agent-add-menu");
  await expect(addMenu).toBeVisible();
  await expect(addMenu.getByRole("menuitem").allTextContents()).resolves.toEqual(
    ["▱从画布添加", "⌕上传附件", "♧技能›", "◉头脑风暴", "⌘全部插件›"],
  );

  await addMenu
    .getByRole("menuitem", { name: "从画布添加", exact: true })
    .click();
  await expect(page.getByTestId("agent-reference-banner")).toContainText(
    "点击节点以添加为引用",
  );
  await page.locator(".react-flow__node-image").first().click();
  await expect(page.getByTestId("agent-reference-list")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "移除引用 人物参考图" }),
  ).toBeVisible();
  await page
    .getByTestId("agent-reference-banner")
    .getByRole("button", { name: "退出" })
    .click();
  await expect(page.getByTestId("agent-reference-banner")).toHaveCount(0);

  await page.getByTestId("agent-confirmation-mode").click();
  const confirmationMenu = page.getByTestId("agent-confirmation-menu");
  await expect(
    confirmationMenu.getByRole("menuitemradio").allTextContents(),
  ).resolves.toEqual([
    "手动确认Agent在执行生成前都会寻求您的确认✓",
    "自动生成Agent会自主规划生成任务并自动执行",
  ]);
  await confirmationMenu
    .getByRole("menuitemradio", { name: /自动生成/ })
    .click();
  await expect(page.getByTestId("agent-confirmation-mode")).toContainText(
    "自动生成",
  );

  await page.getByTestId("agent-model").click();
  const modelMenu = page.getByTestId("agent-model-menu");
  await expect(modelMenu.getByRole("menuitemradio")).toHaveCount(1);
  await expect(
    modelMenu.getByRole("menuitemradio", { name: "Doubao Seed", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("agent-model")).toContainText("Doubao Seed");
  await expect(modelMenu).not.toContainText("Auto switch");
  await expect(modelMenu).not.toContainText("Sonnet");
  await expect(modelMenu).not.toContainText("即将上线");
  expect(generationRequests).toEqual([]);
  await request.patch(`/api/admin/models/${createdModel.model.id}`, {
    data: { status: "disabled" },
  });
});
