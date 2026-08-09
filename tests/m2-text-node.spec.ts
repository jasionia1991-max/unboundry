import { expect, test } from "./safe-test";
import { composeTextControl } from "./helpers/ime";

test("Text matches neutral, selected and editing states", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.text.empty");
  await page.goto("/__fixture/node.text.empty");
  const node = page.locator(".react-flow__node-text");
  const card = page.getByTestId("text-node-text-primary");
  const content = page.getByTestId("canvas-node-text-content");

  expect(await node.boundingBox()).toMatchObject({ width: 250, height: 250 });
  await expect(card).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await expect(card).toHaveCSS("border-radius", "16px");
  await expect(content).toHaveAttribute("data-empty", "true");
  await expect(node.locator(".node-handle-plus").first()).toHaveCSS(
    "opacity",
    "0",
  );

  await node.hover();
  await expect(node.locator(".node-handle-plus").first()).toHaveCSS(
    "opacity",
    "1",
  );
  await node.click();
  await expect(node).toHaveCSS("outline-color", "rgb(122, 122, 122)");
  await expect(node).toHaveCSS("outline-width", "2px");
  await expect(node).toHaveCSS("z-index", "1000");

  const toolbar = page.getByTestId("text-node-toolbar");
  expect(await toolbar.boundingBox()).toMatchObject({ width: 617, height: 48 });
  await expect(toolbar.getByRole("button")).toHaveCount(14);
  await expect(page.getByTestId("canvas-node-title")).toHaveValue("Text");
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
  await expect(
    node.locator(".react-flow__resize-control.handle").first(),
  ).toHaveCSS("width", "24px");

  const title = page.getByTestId("canvas-node-title");
  const saveStatus = page.getByTestId("save-status");
  await title.fill("英文标题");
  await expect(saveStatus).toHaveText("保存中...");
  await title.press("Enter");
  await expect(saveStatus).toHaveText("已保存到云端");
  await page.locator(".react-flow__pane").click({ position: { x: 1000, y: 700 } });
  await page.keyboard.press("Meta+z");
  await node.click();
  // Once the field blurs, canvas history restores the session checkpoint.
  await expect(title).toHaveValue("Text");

  await title.click();
  await title.dispatchEvent("compositionstart", { data: "" });
  await title.evaluate((input: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setValue.call(input, "测试a");
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "a",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
  });
  await title.dispatchEvent("keydown", {
    isComposing: true,
    key: "Enter",
    keyCode: 229,
  });
  await expect(title).toBeFocused();
  await title.dispatchEvent("compositionend", { data: "a" });
  await expect(title).toHaveValue("测试a");
  await title.press("Enter");
  await expect(title).toHaveValue("测试a");
  await expect(saveStatus).toHaveText("已保存到云端");

  await content.dblclick();
  const editor = page.getByTestId("text-node-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toBeFocused();
  await editor.type("格式测试");
  await editor.press("Meta+A");
  await toolbar.getByRole("button", { name: "粗体" }).click();
  await expect(editor.locator("b")).toHaveText("格式测试");
  await editor.press("Meta+z");
  await expect(editor).toHaveText("格式测试");
  await expect(editor.locator("b, strong")).toHaveCount(0);
  await editor.press("Meta+Shift+z");
  await expect(editor.locator("b, strong")).toHaveText("格式测试");

  await editor.press("Escape");
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(node).toHaveClass(/selected/);
  await expect(toolbar).toBeVisible();

  const beforeDrag = (await node.boundingBox())!;
  await page.mouse.move(beforeDrag.x + 125, beforeDrag.y + 125);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + 205, beforeDrag.y + 185, { steps: 4 });
  await page.mouse.up();
  const afterDrag = (await node.boundingBox())!;
  expect(afterDrag.x - beforeDrag.x).toBeGreaterThan(40);
  expect(afterDrag.y - beforeDrag.y).toBeGreaterThan(30);

  await content.dblclick();
  const beforeEditDrag = (await node.boundingBox())!;
  await page.mouse.move(beforeEditDrag.x + 125, beforeEditDrag.y + 125);
  await page.mouse.down();
  await page.mouse.move(beforeEditDrag.x + 205, beforeEditDrag.y + 185, {
    steps: 4,
  });
  await page.mouse.up();
  expect(await node.boundingBox()).toMatchObject({
    x: beforeEditDrag.x,
    y: beforeEditDrag.y,
  });
  await editor.press("Escape");

  await content.dblclick();
  await editor.fill("你好世界");
  await editor.press("Escape");
  await page.mouse.click(1000, 700);
  await page.evaluate(() => {
    const text = document.querySelector(
      '[data-testid="text-node-editor"] p',
    )?.firstChild;
    if (!text) return;
    const range = document.createRange();
    range.setStart(text, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await content.dblclick({
    position: { x: 64, y: 18 },
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.getSelection()?.anchorOffset ?? -1),
    )
    .toBeGreaterThan(0);
  await editor.press("Escape");

  await page.mouse.click(1000, 700);
  await expect(node).not.toHaveClass(/selected/);
  await expect(toolbar).toHaveCount(0);
});

test("Text body keeps the final IME composition and never persists pinyin intermediates", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.text.empty");
  await page.goto("/__fixture/node.text.empty");
  const content = page.getByTestId("canvas-node-text-content");
  const editor = page.getByTestId("text-node-editor");
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await content.dblclick();
  await editor.dispatchEvent("compositionstart", { data: "" });

  for (const value of ["根据w e", "根据wen", "根据wen z", "根据wen zi", "根据文字"]) {
    await editor.evaluate((element, nextValue) => {
      element.textContent = nextValue;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: nextValue,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    }, value);
    await expect(editor).toHaveText(value);
  }

  await editor.dispatchEvent("compositionend", { data: "文字" });
  await expect(editor).toHaveText("根据文字");
  await editor.press("Meta+z");
  await expect(editor).toHaveText("");
  await expect(editor).not.toContainText(/wen|w e/i);
  await editor.press("Meta+Shift+z");
  await expect(editor).toHaveText("根据文字");
  await editor.press("Escape");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await expect(editor).toHaveText("根据文字");

  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await expect(editor).toHaveText("根据文字");
});

test("Text prompt commits only the final IME composition value", async ({
  page,
  request,
}) => {
  const canvasId = "node.text.creator-open";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  const prompt = page.getByTestId("text-creator-prompt");
  await composeTextControl(prompt, ["n", "ni", "ni h", "ni hao", "你好"]);
  await expect(prompt).toHaveValue("你好");
  await prompt.press("Meta+z");
  await expect(prompt).toHaveValue("");
  await expect(prompt).not.toHaveValue(/ni hao/i);
  await prompt.press("Meta+Shift+z");
  await expect(prompt).toHaveValue("你好");
  await prompt.blur();
  await prompt.focus();
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
  await composeTextControl(prompt, ["shi", "shi jie", "世界"]);
  await expect(prompt).toHaveValue("世界");
  await expect.poll(async () => {
    const canvas = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    return canvas.nodes.find((node) => node.id === "text-primary")?.data.textPrompt;
  }, { timeout: 10_000 }).toBe("世界");

  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await expect(prompt).toHaveValue("世界");
});

test("Text toolbar and creator hide while dragging and return after release", async ({
  page,
}) => {
  await page.goto("/__fixture/node.text.creator-open");
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  const creator = page.getByTestId("text-creator");
  const toolbar = page.getByTestId("text-node-toolbar");
  await expect(creator).toBeVisible();
  await expect(toolbar).toBeVisible();

  const node = page.locator(".react-flow__node-text").first();
  const box = (await node.boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 40, { steps: 3 });
  await expect(node).toHaveClass(/dragging/);
  await expect(creator).toHaveCount(0);
  await expect(toolbar).toHaveCount(0);
  await page.mouse.up();
  await expect(creator).toBeVisible();
  await expect(toolbar).toBeVisible();
});

test("focused Text controls own undo while canvas undo restores deleted nodes", async ({
  page,
  request,
}) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generationEnabled: false, models: [] }),
      status: 200,
    });
  });
  const canvasId = "node.text.creator-open";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);

  const prompt = page.getByTestId("text-creator-prompt");
  await prompt.focus();
  await page.keyboard.insertText("你好");
  await expect(prompt).toHaveValue("你好");
  await prompt.press("Meta+z");
  await expect(prompt).toHaveValue("");
  await expect(page.locator(".react-flow__node-text")).toHaveCount(1);
  await prompt.press("Meta+Shift+z");
  await expect(prompt).toHaveValue("你好");

  await prompt.blur();
  await page.locator(".react-flow__node-text").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node-text")).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".react-flow__node-text")).toHaveCount(1);
});

test("Text rich formatting survives focused undo, redo and persistence", async ({
  page,
  request,
}) => {
  const canvasId = "node.text.empty";
  await request.delete(`/api/canvas/${canvasId}`);
  await page.goto(`/__fixture/${canvasId}`);
  const node = page.locator('.react-flow__node[data-id="text-primary"]');
  await node.click();
  const content = page.getByTestId("canvas-node-text-content");
  const editor = page.getByTestId("text-node-editor");
  const toolbar = page.getByTestId("text-node-toolbar");
  await content.dblclick();
  await editor.fill("保留粗体");
  await editor.press("Meta+A");
  await toolbar.getByRole("button", { name: "粗体" }).click();
  await expect(editor.locator("b, strong")).toHaveText("保留粗体");
  await editor.press("Meta+z");
  await expect(editor.locator("b, strong")).toHaveCount(0);
  await expect(editor).toHaveText("保留粗体");
  await editor.press("Meta+Shift+z");
  await expect(editor.locator("b, strong")).toHaveText("保留粗体");
  await editor.press("Escape");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await expect(page.getByTestId("text-node-editor").locator("b, strong"))
    .toHaveText("保留粗体");
});

test("ordinary and P1 source Text nodes share the same creator rule", async ({
  page,
  request,
}) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generationEnabled: false, models: [] }),
      status: 200,
    });
  });

  await request.delete("/api/canvas/node.text.empty");
  await page.goto("/__fixture/node.text.empty");
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await expect(page.getByTestId("text-creator")).toBeVisible();

  const p1Id = "node.image.text-image-input";
  await request.delete(`/api/canvas/${p1Id}`);
  await page.goto(`/__fixture/${p1Id}`);
  await page.locator('.react-flow__node[data-id="input-master-text"]').click();
  await expect(page.getByTestId("text-creator")).toBeVisible();
  await expect(page.getByTestId("text-node-editor")).toHaveText(
    "电商白底产品图，保留服装材质和版型，干净柔和棚拍光线。",
  );
});

test("Text creator follows the reference layout without enabling generation", async ({
  page,
  request,
}) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generationEnabled: false, models: [] }),
      status: 200,
    });
  });
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/.*(provider|generate)/i.test(request.url())) {
      generationRequests.push(request.url());
    }
  });
  await request.delete("/api/canvas/node.text.creator-open");
  await page.goto("/__fixture/node.text.creator-open");

  const node = page.locator(".react-flow__node-text");
  await expect(node).toHaveClass(/selected/);
  await expect(page.getByTestId("text-node-toolbar")).toBeVisible();

  const creator = page.getByTestId("text-creator");
  expect(await creator.boundingBox()).toMatchObject({ height: 200, width: 628 });
  await expect(
    creator.getByRole("button", { name: "添加参考素材" }),
  ).toBeDisabled();
  await expect(creator).toContainText("暂无可用模型");
  await expect(creator).not.toContainText("Gemini 3.1 Flash Lite");
  await expect(creator).not.toContainText("◉");

  const prompt = page.getByTestId("text-creator-prompt");
  await expect(prompt).toHaveAttribute(
    "placeholder",
    "描述任何你想要生成的内容",
  );
  await expect(
    creator.getByRole("button", { name: "Generate" }),
  ).toBeDisabled();
  await prompt.fill("把这段内容整理成三条简短要点");
  await expect(
    creator.getByRole("button", { name: "Generate" }),
  ).toBeDisabled();
  await expect(creator.locator("button:not(:disabled)")).toHaveCount(0);

  await page.locator(".react-flow__pane").click({ position: { x: 1000, y: 200 } });
  await expect(creator).toBeHidden();
  expect(generationRequests).toEqual([]);
});
