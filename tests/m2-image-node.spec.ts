import { expect, test } from "./safe-test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { composeTextControl } from "./helpers/ime";
import { defaultParameterSchema } from "../types/modelParameters";

test.beforeEach(async ({ page }, testInfo) => {
  const retention = testInfo.title.includes("retains 2K");
  const referenceModel = testInfo.title.includes("reference chip");
  const displayName = referenceModel ? "GPT Image 2" : "Nano Banana 2 Lite";
  const parameterSchema = defaultParameterSchema("image");
  parameterSchema.referenceInputs.image = referenceModel ? 16 : 0;
  parameterSchema.fields = parameterSchema.fields.map((field) => {
    if (field.key === "quality") {
      return {
        ...field,
        defaultValue: retention ? "2k" : "1k",
        options: retention
          ? [{ label: "1K", value: "1k" }, { label: "2K", value: "2k" }]
          : [{ label: "1K", value: "1k" }],
      };
    }
    if (field.key === "outputCount") {
      return {
        ...field,
        defaultValue: 1,
        options: [{ label: "1×", value: 1 }],
      };
    }
    return field;
  });
  await page.route("**/api/models", async (route) => {
    const models = retention
      ? [
          {
            capability: "image",
            displayName: "Nano Banana 2 Lite",
            generationAvailable: true,
            id: "fixture-nano-banana-2-lite",
            imageParameters: {
              aspectRatios: ["1:1", "auto"],
              maxReferenceImages: 0,
              qualities: ["1k", "2k"],
            },
            isDefault: true,
            parameterSchema,
          },
          {
            capability: "image",
            displayName: "GPT Image 2",
            generationAvailable: true,
            id: "fixture-gpt-image-2",
            imageParameters: {
              aspectRatios: ["1:1", "auto"],
              maxReferenceImages: 0,
              qualities: ["1k", "2k"],
            },
            isDefault: false,
            parameterSchema,
          },
        ]
      : [{
          capability: "image",
          displayName,
          generationAvailable: false,
          id: referenceModel ? "fixture-gpt-image-2" : "fixture-nano-banana-2-lite",
          imageParameters: {
            aspectRatios: ["auto"],
            maxReferenceImages: referenceModel ? 16 : 0,
            qualities: ["1k"],
          },
          isDefault: true,
          parameterSchema,
        }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generationEnabled: false,
        models,
      }),
      status: 200,
    });
  });
});

test("Image empty and local upload states match the observed geometry", async ({
  page,
  request,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await request.delete("/api/canvas/node.image.empty");
  await page.goto("/__fixture/node.image.empty");
  const node = page.locator(
    '.react-flow__node-image[data-id="image-primary"]',
  );
  const card = page.getByTestId("image-node-image-primary");

  expect(await node.boundingBox()).toMatchObject({ width: 250, height: 250 });
  await expect(card).toHaveCSS("background-color", "rgb(31, 31, 31)");
  await expect(card).toHaveCSS("border-radius", "16px");
  const emptyUploadToolbar = page.getByTestId("image-empty-upload-toolbar");
  await expect(emptyUploadToolbar).not.toBeVisible();
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(0);

  await node.click();
  await expect(node).toHaveCSS("outline-color", "rgb(122, 122, 122)");
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "上传图片" })).toBeVisible();
  await expect(emptyUploadToolbar).toBeVisible();
  await expect(emptyUploadToolbar).toContainText("上传");
  expect((await emptyUploadToolbar.boundingBox())!.y)
    .toBeLessThan((await card.boundingBox())!.y);

  await page.getByTestId("image-upload-input").setInputFiles(
    path.resolve(
      "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ),
  );

  const preview = node.getByTestId("image-node-preview");
  await expect(preview).toBeVisible();
  await expect(emptyUploadToolbar).not.toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => ({
        height: image.naturalHeight,
        width: image.naturalWidth,
      })),
    )
    .toEqual({ width: 1280, height: 720 });
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { width: box?.width, height: box?.height };
    })
    .toEqual({ width: 444, height: 250 });
  await expect(preview).toHaveCSS("object-fit", "contain");
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);
  await expect(
    node.locator(".react-flow__handle.target .node-handle-plus"),
  ).toHaveCount(0);
  const toolbar = page.getByTestId("image-node-toolbar");
  await expect(toolbar).toBeVisible();
  expect(await toolbar.boundingBox()).toMatchObject({
    width: 400,
    height: 48,
  });
  const toolbarBox = (await toolbar.boundingBox())!;
  const titleBox = (await node.locator(".image-node-title").boundingBox())!;
  expect(toolbarBox.y + toolbarBox.height).toBeLessThan(titleBox.y);
  await expect(toolbar.getByRole("button")).toHaveCount(9);
  await expect(
    toolbar.getByRole("button", { name: "下载" }),
  ).toBeVisible();
  await toolbar.getByRole("button", { name: "全屏查看" }).click();
  const detail = page.getByTestId("image-detail");
  await expect(detail).toBeVisible();
  const detailPreview = detail.getByTestId("image-detail-preview");
  await expect(detailPreview).toBeVisible();
  await expect(detailPreview).toHaveAttribute(
    "src",
    (await preview.getAttribute("src"))!,
  );
  await expect(detail.getByRole("button", { name: "下载" })).toBeVisible();
  await detail.getByRole("button", { name: "关闭图片详情" }).click();
  await expect(detail).toBeHidden();
  await toolbar.getByRole("button", { name: "浏览全部" }).click();
  const moreMenu = page.getByTestId("image-node-more-menu");
  await expect(moreMenu).toBeVisible();
  expect(await moreMenu.boundingBox()).toMatchObject({
    width: 238,
    height: 272,
  });
  await expect(moreMenu.getByRole("menuitem")).toHaveCount(8);
  await expect(moreMenu.locator("button:not(:disabled)")).toHaveCount(0);
  await expect(moreMenu).toContainText("快速切分");
  await expect(moreMenu).toContainText("2×2　3×3　4×4");
  expect(generationRequests).toEqual([]);
  await card.click({ position: { x: 20, y: 20 } });
  await expect(moreMenu).toHaveCount(0);

  const replace = page.getByRole("button", { name: "替换" });
  await page.mouse.move(1000, 700);
  await expect(replace).toHaveCSS("opacity", "0");
  await card.hover();
  await expect(replace).toHaveCSS("opacity", "1");

  const beforeDrag = (await node.boundingBox())!;
  await page.mouse.move(
    beforeDrag.x + 24,
    beforeDrag.y + 24,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeDrag.x + 104,
    beforeDrag.y + 104,
    { steps: 4 },
  );
  await page.mouse.up();
  const afterDrag = (await node.boundingBox())!;
  expect(afterDrag.x - beforeDrag.x).toBeGreaterThan(30);
  expect(afterDrag.y - beforeDrag.y).toBeGreaterThan(30);

  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { x: box?.x, y: box?.y };
    })
    .toEqual({ x: beforeDrag.x, y: beforeDrag.y });

  const title = page.getByTestId("image-node-title-input");
  await title.fill("封面图");
  await title.press("Enter");
  await expect(title).toHaveValue("封面图");
  await page.keyboard.press("Meta+z");
  await expect(title).toHaveValue("Image");

  await title.focus();
  await title.dispatchEvent("compositionstart", { data: "" });
  await title.evaluate((input: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setValue.call(input, "中文标题");
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "中文标题",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
  });
  await title.dispatchEvent("compositionend", { data: "中文标题" });
  await expect(title).toHaveValue("中文标题");
  await title.press("Enter");
  await page.keyboard.press("Meta+z");
  await expect(title).toHaveValue("Image");

  const resizeHandle = node.locator(
    ".react-flow__resize-control.handle.bottom.right",
  );
  const resizeHandleBox = (await resizeHandle.boundingBox())!;
  const beforeResize = (await node.boundingBox())!;
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2,
    resizeHandleBox.y + resizeHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2 + 60,
    resizeHandleBox.y + resizeHandleBox.height / 2 + 40,
  );
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await page.mouse.up();
  const manualSize = (await node.boundingBox())!;
  expect(manualSize.width).toBeGreaterThan(beforeResize.width);
  expect(manualSize.height).toBeGreaterThan(beforeResize.height);

  const portraitPng = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 320;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#4682b4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("image-upload-input").setInputFiles({
    buffer: Buffer.from(portraitPng, "base64"),
    mimeType: "image/png",
    name: "portrait-180x320.png",
  });
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => ({
        height: image.naturalHeight,
        width: image.naturalWidth,
      })),
    )
    .toEqual({ width: 180, height: 320 });
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { width: box?.width, height: box?.height };
    })
    .toEqual({ width: 250, height: 444 });

  await page.keyboard.press("Meta+z");
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => ({
        height: image.naturalHeight,
        width: image.naturalWidth,
      })),
    )
    .toEqual({ width: 1280, height: 720 });
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { width: box?.width, height: box?.height };
    })
    .toEqual({ width: manualSize.width, height: manualSize.height });

  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => {
      const box = await node.boundingBox();
      return { width: box?.width, height: box?.height };
    })
    .toEqual({ width: 444, height: 250 });

  await page.keyboard.press("Meta+z");
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传图片" })).toBeVisible();
  await expect(
    node.locator(".react-flow__handle.target .node-handle-plus"),
  ).toHaveCount(1);
});

test("Image prompt controls match the frozen ready state", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.image.prompt-ready");
  await page.goto("/__fixture/node.image.prompt-ready");

  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  const node = page.locator(".react-flow__node-image");
  await expect(node).toHaveClass(/selected/);
  await expect(node.locator(".react-flow__resize-control")).toHaveCount(8);

  const creator = page.getByTestId("image-creator");
  await expect(creator).toBeVisible();
  expect(await creator.boundingBox()).toMatchObject({ width: 694 });

  const prompt = page.getByTestId("image-creator-prompt");
  expect(await prompt.boundingBox()).toMatchObject({ width: 678, height: 80 });
  await expect(prompt).toHaveAttribute(
    "placeholder",
    "描述任何你想要生成的内容",
  );
  await expect(creator).toContainText("Nano Banana 2 Lite");
  await expect(creator).toContainText("自适应 · 1K");
  await expect(creator.getByRole("button", { name: "1×" })).toBeVisible();
  await expect(creator).not.toContainText("◉");

  const generate = creator.getByRole("button", { name: "Generate" });
  await expect(generate).toBeDisabled();
  await composeTextControl(prompt, ["yi zhi", "yi zhi mao", "一只猫"]);
  await expect(prompt).toHaveValue("一只猫");
  await expect(generate).toBeDisabled();
  await expect(generate).toHaveAttribute(
    "data-tooltip",
    "验收页面不会调用真实生成",
  );

  await prompt.press("Meta+z");
  await expect(prompt).toHaveValue("");
  await expect(prompt).not.toHaveValue(/yi zhi/i);
  await prompt.press("Meta+Shift+z");
  await expect(prompt).toHaveValue("一只猫");

  await page.mouse.click(1000, 200);
  await expect(node).not.toHaveClass(/selected/);
  await expect(creator).toBeHidden();

  const beforeDrag = (await node.boundingBox())!;
  await page.mouse.move(beforeDrag.x + 24, beforeDrag.y + 24);
  await page.mouse.down();
  await page.mouse.move(
    beforeDrag.x + 104,
    beforeDrag.y + 104,
    { steps: 4 },
  );
  await page.mouse.up();
  const afterDrag = (await node.boundingBox())!;
  expect(afterDrag.x - beforeDrag.x).toBeGreaterThan(30);
  expect(afterDrag.y - beforeDrag.y).toBeGreaterThan(30);
});

test("Image reference chip follows the incoming edge and undo restores both", async ({
  page,
  request,
}) => {
  const paidRequests: string[] = [];
  page.on("request", (entry) => {
    if (/openrouter|api\/v1\/images|provider/i.test(entry.url()) && !entry.url().includes("/src/")) {
      paidRequests.push(entry.url());
    }
  });
  await request.delete("/api/canvas/node.image.reference-ready");
  await page.goto("/__fixture/node.image.reference-ready");

  const target = page.locator(
    '.react-flow__node-image[data-id="image-reference-target"]',
  );
  await expect(target).toHaveClass(/selected/);
  const references = page.getByTestId("image-creator-references");
  await expect(references).toBeVisible();
  await expect(references.getByRole("img", { name: "人物参考图" }))
    .toBeVisible();
  await expect(page.getByText("当前模型不支持参考图")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: /^图片模型：/ }),
  ).toContainText("GPT Image 2");
  await expect(page.locator('.react-flow__edge[data-id="edge-image-reference"]'))
    .toHaveCount(1);

  await references.getByRole("button", { name: "删除引用 人物参考图" })
    .click();
  await expect(references).toHaveCount(0);
  await expect(page.locator('.react-flow__edge[data-id="edge-image-reference"]'))
    .toHaveCount(0);

  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("image-creator-references")).toBeVisible();
  await expect(page.locator('.react-flow__edge[data-id="edge-image-reference"]'))
    .toHaveCount(1);
  expect(paidRequests).toEqual([]);
});

test("Image generating state is visual-only and disables every control", async ({
  page,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await page.goto("/__fixture/node.image.generating");

  const node = page.locator(
    '.react-flow__node-image[data-id="image-primary"]',
  );
  await expect(node).toHaveCSS("height", "250px");
  await expect(node).toHaveCSS("width", "250px");
  await expect(page.getByRole("status", { name: "Generating..." }))
    .toBeVisible();
  const background = page.getByTestId("image-node-generating-background");
  await expect(background).toHaveCSS(
    "transform",
    "matrix(1.9, 0, 0, 1.9, 0, 0)",
  );
  await expect(background).toHaveCSS("filter", "blur(42px)");
  await expect(background).toHaveCSS("opacity", "0.22");
  await expect(background).toHaveCSS(
    "animation-timing-function",
    "cubic-bezier(0.16, 1, 0.3, 1)",
  );
  const grid = page.getByTestId("image-node-loading-grid");
  await expect(grid).toHaveAttribute("data-grid-columns", "18");
  await expect(grid).toHaveAttribute("data-grid-rows", "18");

  const creator = page.getByTestId("image-creator");
  await expect(creator).toBeVisible();
  await expect(creator.getByRole("textbox")).toBeDisabled();
  await expect(
    creator.getByRole("button", { name: "Generating..." }),
  ).toBeDisabled();
  await expect(
    creator.locator(".image-creator-controls button:not(:disabled)"),
  ).toHaveCount(0);
  await expect(page.getByTestId("image-node-toolbar")).toHaveCount(0);
  expect(generationRequests).toEqual([]);
});

test("Image success keeps the material-fit result, favorite, prompt, and parameters", async ({
  page,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await page.goto("/__fixture/node.image.success");
  await page.getByTestId("fit-view").click();

  const node = page.locator(
    '.react-flow__node-image[data-id="image-primary"]',
  );
  await node.click();
  await expect(node).toHaveCSS("height", "250px");
  await expect(node).toHaveCSS("width", "444px");
  const preview = page
    .getByTestId("image-node-image-primary")
    .getByTestId("image-node-preview");
  await expect(preview).toHaveCSS("object-fit", "contain");
  await expect(preview).toHaveJSProperty("tagName", "IMG");

  const favorite = node.getByRole("button", { name: "收藏" });
  await expect(favorite).toHaveCSS("height", "28px");
  await expect(favorite).toHaveCSS("width", "28px");
  await expect(favorite).toHaveAttribute("aria-pressed", "false");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");

  const creator = page.getByTestId("image-creator");
  await expect(creator.getByRole("textbox")).toHaveValue(
    "A solid red square centered on a plain white background. Minimal test image.",
  );
  await expect(creator).toContainText("Nano Banana 2 Lite");
  await expect(creator).toContainText("自适应 · 1K");
  await expect(creator.getByRole("button", { name: "1×" })).toBeVisible();
  await expect(
    creator.getByRole("button", { name: "Generate" }),
  ).toBeDisabled();

  await page.locator(".react-flow__pane").click({ position: { x: 1000, y: 200 } });
  await node.click();
  await expect(creator.getByRole("textbox")).toHaveValue(
    "A solid red square centered on a plain white background. Minimal test image.",
  );
  expect(generationRequests).toEqual([]);
});

test("Image crop cancels cleanly and confirms a derived asset", async ({
  page,
  request,
}) => {
  await request.delete("/api/canvas/node.image.empty");
  await page.goto("/__fixture/node.image.empty");
  const node = page.locator(
    '.react-flow__node-image[data-id="image-primary"]',
  );
  const card = page.getByTestId("image-node-image-primary");
  await node.click();
  await page.getByTestId("image-upload-input").setInputFiles(
    path.resolve(
      "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ),
  );
  await expect(card).toHaveAttribute("data-asset-id", /.+/);
  const originalAssetId = await card.getAttribute("data-asset-id");
  expect(originalAssetId).toBeTruthy();
  const preview = node.getByTestId("image-node-preview");

  let redirectedAssetReads = 0;
  let editSourceReads = 0;
  let cropUploadPosts = 0;
  page.on("request", (browserRequest) => {
    if (browserRequest.url().includes("/api/image-edit-sources/")) {
      editSourceReads += 1;
    }
    if (
      browserRequest.method() === "POST" &&
      decodeURIComponent(browserRequest.headers()["x-file-name"] ?? "")
        .endsWith("-crop.png")
    ) {
      cropUploadPosts += 1;
    }
  });
  await page.route(
    `**/api/assets/${originalAssetId}`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      redirectedAssetReads += 1;
      await route.fulfill({
        headers: {
          Location: "https://cross-origin.invalid/crop-source.png",
        },
        status: 307,
      });
    },
  );
  await page.route(
    "https://cross-origin.invalid/crop-source.png",
    (route) => route.fulfill({
      contentType: "image/png",
      path: path.resolve(
        "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
      ),
      status: 200,
    }),
  );

  let releaseFirstEditSource!: () => void;
  const firstEditSourceGate = new Promise<void>((resolve) => {
    releaseFirstEditSource = resolve;
  });
  let releaseSecondEditSource!: () => void;
  const secondEditSourceGate = new Promise<void>((resolve) => {
    releaseSecondEditSource = resolve;
  });
  const editSourceGates = [firstEditSourceGate, secondEditSourceGate];
  let gatedEditSource = 0;
  await page.route("**/api/image-edit-sources/*", async (route) => {
    const response = await route.fetch();
    const gate = editSourceGates[gatedEditSource];
    if (gate) {
      gatedEditSource += 1;
      await gate;
    }
    await route.fulfill({ response });
  });

  await page.getByRole("button", { name: "裁剪" }).click();
  const overlay = page.getByTestId("image-crop-overlay");
  const stage = page.getByTestId("image-crop-stage");
  const selection = page.getByTestId("image-crop-selection");
  const confirmCrop = page.getByRole("button", { name: "确认裁剪" });
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId("image-crop-visual-preview")).toHaveCount(0);
  await expect(page.getByTestId("image-crop-loading")).toContainText(
    "正在准备高清原图",
  );
  await expect(confirmCrop).toBeDisabled();
  await expect(selection).toHaveCount(0);
  expect(await stage.boundingBox()).toMatchObject({ height: 180, width: 320 });
  expect(redirectedAssetReads).toBe(0);
  releaseFirstEditSource();
  await expect(selection).toBeVisible();
  await expect(page.getByTestId("image-crop-secure-source")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await expect(confirmCrop).toBeEnabled();
  expect(redirectedAssetReads).toBe(0);
  expect(await stage.boundingBox()).toMatchObject({ height: 552 });
  expect(await page.getByTestId("image-crop-controls").boundingBox())
    .toMatchObject({ height: 42, width: 252 });
  await expect(confirmCrop).toHaveCSS("white-space", "nowrap");
  expect((await confirmCrop.boundingBox())?.height).toBe(32);
  const initialSelection = (await selection.boundingBox())!;
  expect(initialSelection.width).toBeGreaterThan(780);
  expect(initialSelection.height).toBeGreaterThan(439);

  await page.getByRole("button", { name: "取消裁剪" }).click();
  await expect(overlay).toHaveCount(0);
  await expect(card).toHaveAttribute("data-asset-id", originalAssetId!);

  const safeVisualPreviewUrl = `data:image/png;base64,${readFileSync(
    path.resolve(
      "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ),
  ).toString("base64")}`;
  await preview.evaluate((image: HTMLImageElement, url) => {
    image.src = url;
  }, safeVisualPreviewUrl);
  await expect(preview).toHaveAttribute("src", /^data:image\/png;base64,/);
  await page.getByRole("button", { name: "裁剪" }).click();
  await expect(page.getByTestId("image-crop-visual-preview")).toBeVisible();
  await expect(page.getByTestId("image-crop-loading")).toContainText(
    "正在准备高清原图",
  );
  await expect(confirmCrop).toBeDisabled();
  await expect(selection).toHaveCount(0);
  expect(redirectedAssetReads).toBe(0);
  releaseSecondEditSource();
  await expect(selection).toBeVisible();
  await page.getByRole("button", { name: "宽高比" }).click();
  const ratioMenu = page.getByRole("menu").filter({
    has: page.getByRole("menuitemradio"),
  });
  expect(await ratioMenu.boundingBox()).toMatchObject({
    height: 275,
    width: 128,
  });
  await expect(ratioMenu.getByRole("menuitemradio")).toHaveCount(8);
  await ratioMenu.getByRole("menuitemradio", { name: "1:1" }).click();
  const square = (await selection.boundingBox())!;
  expect(Math.abs(square.width - square.height)).toBeLessThan(2);

  let failedAssetId = "";
  await page.route("**/api/assets/*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    failedAssetId = new URL(route.request().url()).pathname.split("/").pop()!;
    await route.fulfill({
      body: JSON.stringify({ error: "模拟保存失败" }),
      contentType: "application/json",
      status: 500,
    });
  });
  await confirmCrop.click();
  await expect(page.getByRole("alert")).toHaveText("模拟保存失败");
  await expect(overlay).toBeVisible();
  await expect(card).toHaveAttribute("data-asset-id", originalAssetId!);
  expect(failedAssetId).toBeTruthy();
  expect((await request.get(`/api/assets/${failedAssetId}`)).status()).toBe(404);
  await page.getByRole("button", { name: "取消裁剪" }).click();
  await expect(overlay).toHaveCount(0);
  await expect(card).toHaveAttribute("data-asset-id", originalAssetId!);
  await page.unroute("**/api/assets/*");

  await page.getByRole("button", { name: "裁剪" }).click();
  await page.getByRole("button", { name: "宽高比" }).click();
  await page.getByRole("menuitemradio", { name: "1:1" }).click();
  await confirmCrop.click();
  await expect(overlay).toHaveCount(0);
  await expect(card).toHaveAttribute("data-asset-id", originalAssetId!);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  const derivedNode = page.locator(
    '.react-flow__node-image[data-id^="image-crop-"]',
  );
  await expect(derivedNode).toHaveCount(1);
  const derivedCard = derivedNode.locator(".image-node-card");
  const derivedAssetId = await derivedCard.getAttribute("data-asset-id");
  expect(derivedAssetId).toBeTruthy();
  expect(derivedAssetId).not.toBe(originalAssetId);
  await expect
    .poll(() =>
      derivedNode.locator("img").evaluate((image: HTMLImageElement) => ({
        height: image.naturalHeight,
        width: image.naturalWidth,
      })),
    )
    .toEqual({ height: 576, width: 576 });
  await expect
    .poll(async () => {
      const box = await derivedNode.boundingBox();
      return { height: box?.height, width: box?.width };
    })
    .toEqual({ height: 250, width: 250 });
  expect((await derivedNode.boundingBox())!.x).toBeGreaterThan(
    (await node.boundingBox())!.x,
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  expect((await request.get(`/api/assets/${originalAssetId}`)).ok()).toBeTruthy();
  expect((await request.get(`/api/assets/${derivedAssetId}`)).ok()).toBeTruthy();
  expect(cropUploadPosts).toBe(2);

  await node.click();
  await page.getByRole("button", { name: "裁剪" }).click();
  await expect(selection).toBeVisible();
  await node.getByTestId("image-upload-input").setInputFiles(
    path.resolve(
      "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ),
  );
  await expect(card).not.toHaveAttribute("data-asset-id", originalAssetId!);
  await confirmCrop.click();
  await expect(page.getByRole("alert")).toHaveText(
    "原图片已发生变化，请重新打开裁剪",
  );
  expect(cropUploadPosts).toBe(2);
  await expect(page.locator(".react-flow__node-image")).toHaveCount(2);
  await page.getByRole("button", { name: "取消裁剪" }).click();
  await expect(overlay).toHaveCount(0);
  expect(editSourceReads).toBe(4);
  expect(redirectedAssetReads).toBe(0);
});

test("Image multi-angle panel keeps local parameters without generating", async ({
  page,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await page.goto("/__fixture/node.image.success");

  await page.getByRole("button", { name: "多角度" }).click();
  const panel = page.getByTestId("image-multi-angle-panel");
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => getComputedStyle(element).width))
    .toBe("600px");
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.width).toBeCloseTo(491.4, 0);
  expect(panelBox.height).toBeCloseTo(252.3, 0);
  await expect(page.getByTestId("image-multi-angle-rotation")).toHaveText("-30°");
  await expect(page.getByTestId("image-multi-angle-tilt")).toHaveText("23°");
  await expect(page.getByTestId("image-multi-angle-scale")).toHaveText("0");

  await panel.getByRole("slider", { name: "旋转" }).fill("45");
  await panel.getByRole("slider", { name: "倾斜" }).fill("-12");
  await panel.getByRole("slider", { name: "缩放" }).fill("20");
  await expect(page.getByTestId("image-multi-angle-rotation")).toHaveText("45°");
  await expect(page.getByTestId("image-multi-angle-tilt")).toHaveText("-12°");
  await expect(page.getByTestId("image-multi-angle-scale")).toHaveText("20");
  await panel.getByRole("checkbox").check();
  await expect(panel.locator(".image-multi-angle-guide")).toHaveCount(2);

  const cubeBox = (await page
    .getByTestId("image-multi-angle-cube")
    .boundingBox())!;
  await page.mouse.move(cubeBox.x + 20, cubeBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(cubeBox.x + 37.25, cubeBox.y + 31.75);
  await page.mouse.up();
  await expect(page.getByTestId("image-multi-angle-rotation"))
    .toHaveText(/^-?\d+(?:\.5)?°$/);
  const outputBox = (await page
    .getByTestId("image-multi-angle-rotation")
    .boundingBox())!;
  expect(outputBox.x + outputBox.width).toBeLessThanOrEqual(
    panelBox.x + panelBox.width,
  );

  await panel.getByRole("button", { name: "重置" }).click();
  await expect(page.getByTestId("image-multi-angle-rotation")).toHaveText("0°");
  await expect(page.getByTestId("image-multi-angle-tilt")).toHaveText("0°");
  await expect(page.getByTestId("image-multi-angle-scale")).toHaveText("0");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(
    panel.getByRole("button", { name: "生成多角度图片" }),
  ).toBeDisabled();
  expect(generationRequests).toEqual([]);

  await panel.getByRole("button", { name: "关闭多角度" }).click();
  await expect(panel).toBeHidden();
});

test("Image redraw keeps mask coordinates local and cancel is lossless", async ({
  page,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await page.goto("/__fixture/node.image.success");
  const preview = page
    .getByTestId("image-node-image-primary")
    .getByTestId("image-node-preview");
  const originalSrc = await preview.getAttribute("src");

  await page.getByRole("button", { name: "重绘" }).click();
  const overlay = page.getByTestId("image-redraw-overlay");
  const stage = page.getByTestId("image-redraw-stage");
  const toolbar = page.getByTestId("image-redraw-toolbar");
  const prompt = page.getByTestId("image-redraw-prompt");
  const canvas = page.getByTestId("image-redraw-canvas");
  await expect(overlay).toBeVisible();
  const stageBox = (await stage.boundingBox())!;
  expect(stageBox.height).toBe(440);
  expect(stageBox.width).toBeCloseTo(782.22, 1);
  expect(await toolbar.boundingBox()).toMatchObject({
    height: 58,
    width: 385,
  });
  expect(await prompt.boundingBox()).toMatchObject({
    height: 122,
    width: 500,
  });
  expect(await prompt.getByRole("textbox").boundingBox()).toMatchObject({
    height: 60,
    width: 482,
  });
  await expect(
    prompt.getByRole("button", { name: "提交重绘" }),
  ).toBeDisabled();
  const redrawPrompt = prompt.getByRole("textbox", { name: "重绘提示词" });
  await composeTextControl(redrawPrompt, ["huan", "huan bei jing", "更换背景"]);
  await expect(redrawPrompt).toHaveValue("更换背景");
  await redrawPrompt.press("Meta+z");
  await expect(redrawPrompt).toHaveValue("");
  await expect(redrawPrompt).not.toHaveValue(/huan bei jing/i);
  await redrawPrompt.press("Meta+Shift+z");
  await expect(redrawPrompt).toHaveValue("更换背景");

  const canvasBox = (await canvas.boundingBox())!;
  await page.mouse.move(canvasBox.x + 100, canvasBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 180, canvasBox.y + 150, { steps: 5 });
  await page.mouse.up();
  const alphaCount = () =>
    canvas.evaluate((element: HTMLCanvasElement) => {
      const pixels = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index]) count += 1;
      }
      return count;
    });
  const brushedPixels = await alphaCount();
  expect(brushedPixels).toBeGreaterThan(0);

  await toolbar.getByRole("button", { name: "撤销蒙版" }).click();
  expect(await alphaCount()).toBe(0);
  await toolbar.getByRole("button", { name: "恢复蒙版" }).click();
  expect(await alphaCount()).toBe(brushedPixels);

  await toolbar.getByRole("button", { name: "框选" }).click();
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 420, canvasBox.y + 260, { steps: 3 });
  await page.mouse.up();
  const boxedPixels = await alphaCount();
  expect(boxedPixels).toBeGreaterThan(brushedPixels);
  const alphaTotal = () =>
    canvas.evaluate((element: HTMLCanvasElement) => {
      const pixels = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      let total = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        total += pixels[index];
      }
      return total;
    });
  const alphaBeforeErase = await alphaTotal();

  await toolbar.getByRole("button", { name: "橡皮" }).click();
  await page.mouse.move(canvasBox.x + 100, canvasBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 180, canvasBox.y + 150, { steps: 5 });
  await page.mouse.up();
  expect(await alphaTotal()).toBeLessThan(alphaBeforeErase);

  await page.getByRole("button", { name: "取消重绘" }).click();
  await expect(overlay).toHaveCount(0);
  await expect(preview).toHaveAttribute("src", originalSrc!);
  expect(generationRequests).toEqual([]);
});

test("Image lighting stays unavailable while the feature is paused", async ({
  page,
}) => {
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (/provider|generate/i.test(request.url()) && !request.url().includes("/src/")) {
      generationRequests.push(request.url());
    }
  });
  await page.goto("/__fixture/node.image.success");

  const lightingButton = page.getByRole("button", { name: "打光" });
  await expect(lightingButton).toBeDisabled();
  await expect(lightingButton).toHaveAttribute(
    "data-tooltip",
    "打光（暂未开放）",
  );
  await expect(page.getByTestId("image-lighting-panel")).toHaveCount(0);
  expect(generationRequests).toEqual([]);
});

test("Image model switch retains 2K quality when both models support it", async ({
  page,
}) => {
  await page.goto("/canvas");
  await page.getByTestId("add-node").click();
  await page
    .getByTestId("add-node-menu")
    .getByRole("menuitem", { name: "图片", exact: true })
    .click();
  const creator = page.getByTestId("image-creator");
  await expect(creator).toBeVisible();

  await creator.getByRole("button", { name: "图片参数" }).click();
  const parameterPanel = page.getByRole("dialog", { name: "图片生成参数" });
  await expect(parameterPanel).toBeVisible();
  const twoK = parameterPanel.getByRole("button", { name: "2K画质" });
  await expect(twoK).toBeEnabled();
  await expect(twoK).toBeVisible();
  await twoK.click();
  await expect(twoK).toHaveAttribute("aria-pressed", "true");
  await expect(creator).toContainText("2K");

  const model = page.getByRole("combobox", { name: /^图片模型：/ });
  await expect(model).toContainText("Nano Banana 2 Lite");
  await model.click();
  await page.getByRole("option", { name: /GPT Image 2/ }).click();
  await expect(page.getByRole("combobox", { name: /^图片模型：/ }))
    .toContainText("GPT Image 2");
  await expect(creator).toContainText("2K");
  await creator.getByRole("button", { name: "图片参数" }).click();
  await expect(parameterPanel).toBeVisible();
  await expect(parameterPanel.getByRole("button", { name: "2K画质" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(creator).toContainText("2K");
});
