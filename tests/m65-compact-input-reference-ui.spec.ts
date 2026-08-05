import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  defaultParameterSchema,
  type ModelParameterSchema,
} from "../types/modelParameters";

// Reuse a registered development fixture ID; its persisted canvas document is
// replaced inside this test's isolated data directory.
const canvasId = "node.text.creator-open";
const modelName = "M65 Text Four Compact Inputs";
const textTitle = "这是一个不应常驻在紧凑引用入口旁边的超长文字节点标题";
const imageTitle = "这是一个不应常驻在紧凑引用入口旁边的超长图片节点标题";
const videoTitle = "这是一个不应常驻在紧凑引用入口旁边的超长视频节点标题";
const audioTitle = "这是一个不应常驻在紧凑引用入口旁边的超长音频节点标题";
const overflowTextTitle = "第五个仅在用户打开加号入口后显示的文字引用";
const textSummary = "这段上游文字摘要只能在用户主动打开详情后出现，不能在节点输入框顶部长期占据整行高度";
const longProblem = "这是一条用于检查不兼容引用的完整长原因：当前图片素材没有通过安全格式校验，引用必须保留，但原因不应该以橙色长段落在创建器中重复常驻";

type CanvasDocument = {
  revision: number;
};

function modelSchema(): ModelParameterSchema {
  return {
    ...defaultParameterSchema("text"),
    inputPolicy: {
      promptPolicy: "own-required",
      required: {},
      roles: {
        audio: ["context-audio"],
        image: ["context-image", "subject"],
        text: ["context-text"],
        video: ["context-video"],
      },
      switchPolicy: "keep-edge",
    },
    upstreamInputs: {
      audio: { limitMode: "context", supported: true },
      image: { limitMode: "context", supported: true },
      text: { limitMode: "context", supported: true },
      video: { limitMode: "context", supported: true },
    },
  };
}

async function createModel(request: APIRequestContext) {
  const response = await request.post("/api/admin/models", {
    data: {
      capability: "text",
      displayName: modelName,
      isDefault: false,
      maxCostMicrounits: 0,
      parameterSchema: modelSchema(),
      providerModelId: "fixture/m65-compact-input-reference-ui",
      providerProfileId: "provider-unconfigured",
      sortOrder: 9_650,
      status: "published",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { model: { id: string } }).model.id;
}

async function seedCanvas(
  request: APIRequestContext,
  modelId: string,
  includeOverflow = false,
  destinationCanvasId = canvasId,
  generationError = "",
) {
  const current = await request.get(`/api/canvas/${destinationCanvasId}`);
  const revision = current.ok()
    ? (await current.json() as CanvasDocument).revision
    : 0;
  const inputSources = [
    { key: "text", kind: "text" },
    { key: "image", kind: "image" },
    { key: "video", kind: "video" },
    { key: "audio", kind: "audio" },
    ...(includeOverflow ? [{ key: "text-extra", kind: "text" }] : []),
  ] as const;
  const response = await request.put(`/api/canvas/${destinationCanvasId}`, {
    data: {
      edges: inputSources.map(
        ({ key, kind }, index) => ({
          data: {
            inputOrder: index + 1,
            inputRole: `context-${kind}`,
          },
          id: `m65-edge-${key}`,
          source: `m65-source-${key}`,
          sourceHandle: "source",
          target: "m65-target-text",
          targetHandle: "target",
          type: "cuttable",
        }),
      ),
      nodes: [
        {
          data: { content: textSummary, label: "Text", title: textTitle },
          id: "m65-source-text",
          position: { x: 40, y: 30 },
          style: { height: 180, width: 230 },
          type: "text",
        },
        {
          data: {
            assetId: "m65-image",
            imageSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='38' height='38'%3E%3Crect width='38' height='38' fill='%23c74f45'/%3E%3C/svg%3E",
            inputState: "invalid",
            inputStateReason: longProblem,
            label: "Image",
            title: imageTitle,
          },
          id: "m65-source-image",
          position: { x: 40, y: 240 },
          style: { height: 180, width: 230 },
          type: "image",
        },
        {
          data: {
            assetId: "m65-video.mp4",
            label: "Video",
            title: videoTitle,
            videoSrc: "data:video/mp4;base64,AAAA",
          },
          id: "m65-source-video",
          position: { x: 40, y: 450 },
          style: { height: 180, width: 300 },
          type: "video",
        },
        {
          data: {
            assetId: "m65-audio.mp3",
            audioDuration: 4,
            audioSrc: "data:audio/mpeg;base64,AAAA",
            audioWaveform: [8, 16, 24, 32, 24, 16, 8],
            label: "Audio",
            title: audioTitle,
          },
          id: "m65-source-audio",
          position: { x: 40, y: 660 },
          style: { height: 180, width: 300 },
          type: "audio",
        },
        ...(includeOverflow ? [{
          data: {
            content: "第五个引用的文字摘要",
            label: "Text",
            title: overflowTextTitle,
          },
          id: "m65-source-text-extra",
          position: { x: 350, y: 660 },
          style: { height: 180, width: 230 },
          type: "text",
        }] : []),
        {
          data: {
            content: "",
            label: "Text",
            textModelId: modelId,
            textModelName: modelName,
            textPrompt: "只做零 Provider 界面检查，不提交生成",
            textPromptReady: true,
            ...(generationError ? { textGenerationError: generationError } : {}),
            title: "紧凑引用目标文字",
          },
          id: "m65-target-text",
          position: { x: 570, y: 180 },
          selected: true,
          style: { height: 230, width: 250 },
          type: "text",
        },
      ],
      revision,
      viewport: { x: 5, y: 5, zoom: 0.68 },
    },
  });
  expect(response.ok()).toBeTruthy();
}

function trackForbiddenRequests(page: Page) {
  const generationTaskPosts: string[] = [];
  const providerRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      /^\/api\/generation-tasks(?:\/|$)/.test(url.pathname)
    ) {
      generationTaskPosts.push(request.url());
    }
    if (/openrouter\.ai|volces\.com|mureka\.ai|lk666\.ai|lk888\.ai/i.test(url.hostname)) {
      providerRequests.push(request.url());
    }
  });
  return { generationTaskPosts, providerRequests };
}

async function zoomOver(
  page: Page,
  world: Locator,
  target: Locator,
  stableElements: Locator[],
) {
  const beforeZoom = Number(await world.getAttribute("data-viewport-zoom"));
  const beforeHeights = await Promise.all(stableElements.map(async (element) =>
    (await element.boundingBox())?.height));
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -70);
  await page.keyboard.up("Control");
  await expect.poll(async () =>
    Number(await world.getAttribute("data-viewport-zoom"))).toBeGreaterThan(beforeZoom);
  await page.waitForTimeout(120);
  for (const [index, element] of stableElements.entries()) {
    await expect(element).toBeVisible();
    const afterHeight = (await element.boundingBox())?.height;
    expect(afterHeight).toBeCloseTo(beforeHeights[index]!, 1);
  }
}

test.describe.serial("compact upstream references stay one-row and zero Provider", () => {
  let modelId = "";

  test.beforeAll(async ({ request }) => {
    modelId = await createModel(request);
    await seedCanvas(request, modelId);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/canvas/${canvasId}`);
    if (modelId) {
      await request.patch(`/api/admin/models/${modelId}`, {
        data: { isDefault: false, status: "disabled" },
      });
    }
  });

  test("four compact entries expose one detail surface without persistent copy or paid calls", async ({
    page,
    request,
  }) => {
    const forbidden = trackForbiddenRequests(page);
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };

    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator('.react-flow__node[data-id="m65-target-text"]').click({
      position: { x: 20, y: 20 },
    });

    const creator = page.getByTestId("text-creator");
    const references = page.getByTestId("text-upstream-inputs");
    const entries = references.locator("[data-input-kind]");
    const triggers = references.locator(".upstream-input-trigger");
    await expect(creator).toBeVisible();
    await expect(entries).toHaveCount(4);
    await expect(triggers).toHaveCount(4);
    const sizes = await triggers.evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width };
    }));
    for (const size of sizes) {
      expect(size.width).toBeGreaterThanOrEqual(36);
      expect(size.width).toBeLessThanOrEqual(40);
      expect(size.height).toBeGreaterThanOrEqual(36);
      expect(size.height).toBeLessThanOrEqual(40);
    }

    await expect(creator.locator(".upstream-input-details")).toHaveCount(0);
    await expect(creator.getByText(textTitle, { exact: true })).toHaveCount(0);
    await expect(creator.getByText(textSummary, { exact: true })).toHaveCount(0);
    const closedReason = creator.getByText(longProblem, { exact: true });
    await expect(closedReason).toHaveCount(1);
    await expect(closedReason).toHaveClass(/sr-only/);
    expect(await closedReason.boundingBox()).toMatchObject({ height: 1, width: 1 });
    await expect(page.getByTestId("upstream-input-problem")).toHaveCount(0);

    const closedCreatorHeight = (await creator.boundingBox())!.height;
    await creator.evaluate((element) => element.setAttribute("data-m65-instance", "creator"));
    const textTrigger = references.getByRole("button", { name: `查看引用 ${textTitle}` });
    await zoomOver(page, world, textTrigger, [creator]);
    await expect(creator).toHaveAttribute("data-m65-instance", "creator");
    await expect(creator.locator(".upstream-input-details")).toHaveCount(0);
    await expect(page.getByText("画布正在保存，保存完成后可生成")).toHaveCount(0);

    const imageTrigger = references.getByRole("button", { name: `查看引用 ${imageTitle}` });
    await imageTrigger.click();
    const imageDetails = page.getByRole("dialog", { name: `${imageTitle}引用详情` });
    await expect(page.locator('.upstream-input-details[role="dialog"]')).toHaveCount(1);
    await expect(imageDetails).toBeVisible();
    await expect(imageDetails.getByText(imageTitle, { exact: true })).toBeVisible();
    await expect(imageDetails.getByText("图片素材", { exact: true })).toBeVisible();
    await expect(imageDetails.getByText(longProblem, { exact: true })).toBeVisible();
    await expect(creator.getByText(longProblem, { exact: true })).toHaveCount(1);

    const role = imageDetails.getByRole("combobox", { name: `${imageTitle}角色` });
    await expect(role).toBeVisible();
    await expect(role.locator("option")).toHaveCount(2);
    await role.selectOption("subject");
    await expect(references.locator('[data-input-kind="image"]'))
      .toHaveAttribute("data-input-role", "subject");
    await role.selectOption("context-image");

    const moveBackward = imageDetails.getByRole("button", { name: `向前移动 ${imageTitle}` });
    const moveForward = imageDetails.getByRole("button", { name: `向后移动 ${imageTitle}` });
    await expect(moveBackward).toBeEnabled();
    await expect(moveForward).toBeEnabled();
    await moveForward.click();
    await expect(entries.nth(2)).toHaveAttribute("data-input-kind", "image");
    await moveBackward.click();
    await expect(entries.nth(1)).toHaveAttribute("data-input-kind", "image");

    const videoTrigger = references.getByRole("button", { name: `查看引用 ${videoTitle}` });
    await videoTrigger.click();
    await expect(page.locator('.upstream-input-details[role="dialog"]')).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: `${videoTitle}引用详情` })).toBeVisible();
    await expect(imageDetails).toHaveCount(0);

    await imageTrigger.click();
    await expect(imageDetails).toBeVisible();
    await imageDetails.evaluate((element) => element.setAttribute("data-m65-instance", "details"));
    await zoomOver(page, world, imageDetails, [creator, imageDetails]);
    await expect(creator).toHaveAttribute("data-m65-instance", "creator");
    await expect(imageDetails).toHaveAttribute("data-m65-instance", "details");
    await expect(creator.getByText(longProblem, { exact: true })).toHaveCount(1);
    await expect(page.getByText("画布正在保存，保存完成后可生成")).toHaveCount(0);

    await imageDetails.getByRole("button", {
      name: `关闭 ${imageTitle}引用详情`,
    }).click();
    await expect(imageDetails).toHaveCount(0);
    const restoredClosedReason = creator.getByText(longProblem, { exact: true });
    await expect(restoredClosedReason).toHaveClass(/sr-only/);
    expect(await restoredClosedReason.boundingBox())
      .toMatchObject({ height: 1, width: 1 });
    expect((await creator.boundingBox())!.height).toBeCloseTo(closedCreatorHeight, 1);

    const imageEntry = references.locator('[data-input-kind="image"]');
    await imageEntry.hover();
    const remove = creator.getByRole("button", { name: `删除引用 ${imageTitle}` });
    await expect(remove).toBeVisible();
    await expect(remove).toBeEnabled();
    await expect(remove).toHaveCSS("opacity", "1");
    await remove.click();
    await expect(world).toHaveAttribute("data-edge-count", "3");
    await expect(entries).toHaveCount(3);
    await page.keyboard.press("Meta+z");
    await expect(world).toHaveAttribute("data-edge-count", "4");
    await expect(entries).toHaveCount(4);

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(forbidden.generationTaskPosts).toEqual([]);
    expect(forbidden.providerRequests).toEqual([]);
  });

  test("a fifth input stays behind one +N entry and preserves a single selected detail surface", async ({
    page,
    request,
  }) => {
    await seedCanvas(request, modelId, true);
    const forbidden = trackForbiddenRequests(page);
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };

    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await page.locator('.react-flow__node[data-id="m65-target-text"]').click({
      position: { x: 20, y: 20 },
    });

    const creator = page.getByTestId("text-creator");
    const references = page.getByTestId("text-upstream-inputs");
    const directEntries = references.locator(":scope > .upstream-input-card");
    const overflow = page.getByTestId("upstream-input-overflow-trigger");
    const overflowPanel = page.locator("#text-upstream-inputs-overflow-panel");
    await expect(creator).toBeVisible();
    await expect(directEntries).toHaveCount(3);
    await expect(references.locator(":scope > .upstream-input-overflow"))
      .toHaveCount(1);
    await expect(overflow).toBeVisible();
    await expect(overflow).toHaveText("+2");
    await expect(overflow).toHaveAttribute("aria-expanded", "false");
    await expect(overflowPanel).toBeHidden();

    const rowBoxes = await Promise.all([
      ...await directEntries.all(),
      overflow,
    ].map((entry) => entry.boundingBox()));
    expect(rowBoxes.every(Boolean)).toBeTruthy();
    const rowY = rowBoxes[0]!.y;
    for (const box of rowBoxes) {
      expect(box!.width).toBeCloseTo(38, 1);
      expect(box!.height).toBeCloseTo(38, 1);
      expect(box!.y).toBeCloseTo(rowY, 1);
    }
    const closedRowHeight = (await references.boundingBox())!.height;
    expect(closedRowHeight).toBeLessThanOrEqual(42);

    const stateMarks = references.locator(".upstream-input-state-mark");
    await expect(stateMarks).toHaveCount(5);
    const stateMarkFacts = await stateMarks.evaluateAll((marks) => marks.map((mark) => {
      const bounds = mark.getBoundingClientRect();
      return {
        height: bounds.height,
        text: mark.textContent,
        width: bounds.width,
      };
    }));
    for (const mark of stateMarkFacts) {
      expect(mark.text).toBe("");
    }
    const visibleStateMarks = stateMarkFacts.filter((mark) => mark.width > 0);
    expect(visibleStateMarks).toHaveLength(3);
    for (const mark of visibleStateMarks) {
      expect(mark.width).toBeCloseTo(5, 1);
      expect(mark.height).toBeCloseTo(5, 1);
    }
    await expect(references.locator(".upstream-input-order")).toHaveCount(0);

    const firstCard = directEntries.first();
    const firstTrigger = references.getByRole("button", { name: `查看引用 ${textTitle}` });
    await firstTrigger.click();
    await expect(firstCard).toHaveAttribute("data-details-open", "true");
    await expect(firstTrigger).toHaveCSS("background-color", "rgb(241, 241, 242)");
    const selectedPreview = firstCard.locator('.upstream-input-preview[data-has-media="false"]');
    await expect(selectedPreview).toHaveCSS("background-color", "rgb(241, 241, 242)");
    await expect(selectedPreview).toHaveCSS("color", "rgb(32, 32, 35)");
    await expect(selectedPreview.locator("svg.upstream-input-kind-icon")).toHaveCount(1);
    await expect(page.locator(".upstream-input-details")).toHaveCount(1);
    await page.getByRole("button", { name: `关闭 ${textTitle}引用详情` }).click();
    await expect(firstCard).not.toHaveAttribute("data-details-open", "true");

    await overflow.click();
    await expect(overflow).toHaveAttribute("aria-expanded", "true");
    await expect(overflowPanel).toBeVisible();
    await expect(overflowPanel.locator(".upstream-input-card")).toHaveCount(2);
    await expect(overflowPanel.locator('[data-input-kind="audio"]')).toHaveCount(1);
    await expect(overflowPanel.locator('[data-input-kind="text"]')).toHaveCount(1);
    expect((await references.boundingBox())!.height).toBeCloseTo(closedRowHeight, 1);

    await overflowPanel.getByRole("button", {
      name: `查看引用 ${overflowTextTitle}`,
    }).click();
    await expect(overflowPanel).toBeHidden();
    await expect(page.locator(".upstream-input-details")).toHaveCount(1);
    const fifthDetails = page.getByRole("dialog", {
      name: `${overflowTextTitle}引用详情`,
    });
    await expect(fifthDetails).toBeVisible();
    await expect(fifthDetails).toContainText("文字 · #5 · 已就绪");
    await expect(fifthDetails.locator(".upstream-input-role-row")).toContainText("文字上下文");
    expect((await references.boundingBox())!.height).toBeCloseTo(closedRowHeight, 1);

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(forbidden.generationTaskPosts).toEqual([]);
    expect(forbidden.providerRequests).toEqual([]);
  });

  test("reference, input blocker and generation blocker share one creator overlay", async ({
    page,
    request,
  }) => {
    const originalResponse = await request.get("/api/canvas/default");
    const original = originalResponse.ok()
      ? await originalResponse.json() as {
          edges: unknown[];
          nodes: unknown[];
          revision: number;
          viewport: { x: number; y: number; zoom: number };
        }
      : undefined;
    const forbidden = trackForbiddenRequests(page);
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };

    try {
      await seedCanvas(
        request,
        modelId,
        false,
        "default",
        "用于检查创作框只打开一层状态详情",
      );
      await page.goto("/");
      await expect(page.getByTestId("canvas-world"))
        .toHaveAttribute("data-persistence-ready", "true");
      await page.locator('.react-flow__node[data-id="m65-target-text"]').click({
        position: { x: 20, y: 20 },
      });

      const creator = page.getByTestId("text-creator");
      const references = page.getByTestId("text-upstream-inputs");
      const inputBlocker = creator.getByTestId("upstream-input-problem");
      const generationBlocker = creator.getByTestId("text-generation-unavailable");
      await expect(inputBlocker).toBeVisible();
      await expect(generationBlocker).toBeVisible();

      await references.getByRole("button", { name: `查看引用 ${imageTitle}` }).click();
      await expect(creator.locator(".upstream-input-details")).toHaveCount(1);
      await expect(creator.locator("details[open]")).toHaveCount(0);

      await inputBlocker.locator("summary").click();
      await expect(creator.locator(".upstream-input-details")).toHaveCount(0);
      await expect(inputBlocker).toHaveAttribute("open", "");
      await expect(generationBlocker).not.toHaveAttribute("open", "");
      await expect(creator.locator("details[open]")).toHaveCount(1);

      await generationBlocker.locator("summary").click();
      await expect(inputBlocker).not.toHaveAttribute("open", "");
      await expect(generationBlocker).toHaveAttribute("open", "");
      await expect(creator.locator("details[open]")).toHaveCount(1);

      await references.getByRole("button", { name: `查看引用 ${textTitle}` }).click();
      await expect(generationBlocker).not.toHaveAttribute("open", "");
      await expect(creator.locator(".upstream-input-details")).toHaveCount(1);
      await expect(creator.locator("details[open]")).toHaveCount(0);

      const after = await (await request.get("/api/generation-tasks/status")).json() as {
        paidProviderRequests: number;
      };
      expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
      expect(forbidden.generationTaskPosts).toEqual([]);
      expect(forbidden.providerRequests).toEqual([]);
    } finally {
      const latest = await request.get("/api/canvas/default");
      if (original && latest.ok()) {
        const revision = (await latest.json() as CanvasDocument).revision;
        await request.put("/api/canvas/default", {
          data: { ...original, revision },
        });
      } else if (!original) {
        await request.delete("/api/canvas/default");
      }
    }
  });
});
