import { randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./safe-test";
import { composeTextControl } from "./helpers/ime";

async function seedSelectedImageCanvas(request: APIRequestContext) {
  const canvasId = "node.image.prompt-ready";
  await request.delete(`/api/canvas/${canvasId}`);
  const response = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: [],
      nodes: [
        {
          data: {
            imagePromptReady: true,
            label: "Image",
            sourceKind: "image",
            title: "Image",
          },
          id: "image-primary",
          position: { x: 442, y: 300 },
          selected: true,
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 0,
        },
      ],
      revision: 0,
      saveAttemptId: randomUUID(),
      saveSequence: 1,
      saveSessionId: randomUUID(),
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(response.ok()).toBeTruthy();
  return canvasId;
}

async function gateNodeResizeObserverAfterFirstBatch(page: Page) {
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    const state = {
      firstNodeBatchDelivered: false,
      gateClosed: false,
      readyAtFirstNodeBatch: null as string | null,
      suppressedNodeBatches: 0,
    };
    (window as typeof window & { __m28NodeResizeGate?: typeof state })
      .__m28NodeResizeGate = state;

    class FirstNodeBatchResizeObserver implements ResizeObserver {
      private readonly observer: ResizeObserver;

      constructor(callback: ResizeObserverCallback) {
        this.observer = new NativeResizeObserver((entries) => {
          const hasNodeEntry = entries.some((entry) =>
            entry.target instanceof Element &&
            entry.target.matches(".react-flow__node")
          );
          if (!hasNodeEntry) {
            callback(entries, this);
            return;
          }
          if (state.firstNodeBatchDelivered) {
            state.suppressedNodeBatches += 1;
            const nonNodeEntries = entries.filter((entry) =>
              !(entry.target instanceof Element) ||
              !entry.target.matches(".react-flow__node")
            );
            if (nonNodeEntries.length > 0) callback(nonNodeEntries, this);
            return;
          }

          const firstNode = entries.find((entry) =>
            entry.target instanceof Element &&
            entry.target.matches(".react-flow__node")
          );
          const world = firstNode?.target instanceof Element
            ? firstNode.target.closest<HTMLElement>(".canvas-world")
            : null;
          state.firstNodeBatchDelivered = true;
          state.gateClosed = true;
          state.readyAtFirstNodeBatch =
            world?.dataset.persistenceReady ?? null;
          callback(entries, this);
        });
      }

      disconnect() {
        this.observer.disconnect();
      }

      observe(target: Element, options?: ResizeObserverOptions) {
        this.observer.observe(target, options);
      }

      unobserve(target: Element) {
        this.observer.unobserve(target);
      }
    }

    window.ResizeObserver =
      FirstNodeBatchResizeObserver as typeof ResizeObserver;
  });
}

async function holdCanvasGetUntilReleased(page: Page, canvasId: string) {
  await page.addInitScript((targetCanvasId) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = {
      getStarts: 0,
      release: () => release(),
    };
    (window as typeof window & { __m28CanvasGetGate?: typeof state })
      .__m28CanvasGetGate = state;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
      const method = (init?.method ??
        (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = new URL(raw, window.location.href);
      if (
        method === "GET" &&
        url.pathname === `/api/canvas/${targetCanvasId}`
      ) {
        state.getStarts += 1;
        await gate;
      }
      return nativeFetch(input, init);
    }) as typeof window.fetch;
  }, canvasId);
}

async function flushBrowserTasks(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  }));
}

test("loading accepts the first Image measurement without hiding the first title commit", async ({
  page,
  request,
}) => {
  const canvasId = await seedSelectedImageCanvas(request);
  await page.clock.install();
  await gateNodeResizeObserverAfterFirstBatch(page);
  await holdCanvasGetUntilReleased(page, canvasId);

  let canvasCommands = 0;
  let generationPosts = 0;
  page.on("request", (entry) => {
    const url = new URL(entry.url());
    if (
      entry.method() === "POST" &&
      url.pathname === `/api/canvases/${canvasId}/commands`
    ) {
      canvasCommands += 1;
    }
    if (
      entry.method() === "POST" &&
      /generation-tasks|provider|openrouter|volces|mureka/i.test(entry.url())
    ) {
      generationPosts += 1;
    }
  });

  await page.goto(`/__fixture/${canvasId}`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & {
          __m28CanvasGetGate?: { getStarts: number };
        }).__m28CanvasGetGate?.getStarts ?? 0
      )
    )
    .toBeGreaterThan(0);
  const browserNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(browserNow + 1_000);
  await page.evaluate(() => {
    (window as typeof window & {
      __m28CanvasGetGate?: { release: () => void };
    }).__m28CanvasGetGate?.release();
  });
  await expect(
    page.locator('.react-flow__node-image[data-id="image-primary"]'),
  ).toHaveCount(1);
  await page.clock.runFor(32);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = (window as typeof window & {
          __m28NodeResizeGate?: {
            firstNodeBatchDelivered: boolean;
            gateClosed: boolean;
            readyAtFirstNodeBatch: string | null;
          };
        }).__m28NodeResizeGate;
        return state
          ? {
              firstNodeBatchDelivered: state.firstNodeBatchDelivered,
              gateClosed: state.gateClosed,
              readyAtFirstNodeBatch: state.readyAtFirstNodeBatch,
            }
          : null;
      })
    )
    .toEqual({
      firstNodeBatchDelivered: true,
      gateClosed: true,
      readyAtFirstNodeBatch: "false",
    });

  const world = page.getByTestId("canvas-world");
  await page.clock.runFor(200);
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await flushBrowserTasks(page);
  await page.clock.runFor(600);
  await flushBrowserTasks(page);
  expect(canvasCommands).toBe(0);
  expect(generationPosts).toBe(0);
  await page.clock.resume();

  const node = page.locator(
    '.react-flow__node-image[data-id="image-primary"]',
  );
  await node.click({ position: { x: 12, y: 12 } });
  const title = page.getByTestId("image-node-title-input");
  await expect(node).toHaveCSS("visibility", "visible");
  await expect(title).toBeVisible();
  await expect(title).toHaveValue("Image");
  const domToken = randomUUID();
  await title.evaluate((element, token) => {
    element.setAttribute("data-m28-measurement-token", token);
  }, domToken);

  await composeTextControl(title, ["tu", "tu pian", "图片标题"]);
  const editClock = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(editClock + 100);
  await expect(title).toHaveAttribute("data-m28-measurement-token", domToken);
  await expect(node).toHaveCSS("visibility", "visible");
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("图片标题");

  await title.press("Meta+z");
  await expect(title).toHaveAttribute("data-m28-measurement-token", domToken);
  await expect(node).toHaveCSS("visibility", "visible");
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("Image");
  await title.press("Meta+Shift+z");
  await expect(title).toHaveAttribute("data-m28-measurement-token", domToken);
  await expect(node).toHaveCSS("visibility", "visible");
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("图片标题");
  await flushBrowserTasks(page);
  await page.clock.runFor(600);
  await flushBrowserTasks(page);
  await expect.poll(() => canvasCommands).toBe(1);
  expect(generationPosts).toBe(0);
  await page.clock.resume();
});

test("all six editable node-title families share logical IME undo and redo", async ({
  page,
  request,
}) => {
  const paidRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /generation-tasks|provider|openrouter|volces|mureka/i.test(request.url())
    ) {
      paidRequests.push(request.url());
    }
  });

  const cases = [
    ["node.text.empty", ".react-flow__node-text", "canvas-node-title", "Text", ["wen", "wen zi", "文字标题"]],
    ["node.image.prompt-ready", ".react-flow__node-image", "image-node-title-input", "Image", ["tu", "tu pian", "图片标题"]],
    ["node.video.empty", ".react-flow__node-video", "video-node-title-input", "Video", ["shi", "shi pin", "视频标题"]],
    ["node.audio.empty", ".react-flow__node-audio", "audio-node-title-input", "Audio", ["yin", "yin pin", "音频标题"]],
    ["node.playlist.empty", ".react-flow__node-playlist", "playlist-node-title-input", "Playlist", ["lie", "lie biao", "列表标题"]],
    ["node.group.selected", ".react-flow__node-group", "", "新建组", ["xin", "xin zu", "新组标题"]],
  ] as const;

  for (const [fixtureId, nodeSelector, testId, initial, values] of cases) {
    await request.delete(`/api/canvas/${fixtureId}`);
    await page.goto(`/__fixture/${fixtureId}`);
    await expect(page.getByTestId("canvas-world")).toHaveAttribute(
      "data-persistence-ready",
      "true",
    );
    const title = testId
      ? page.getByTestId(testId)
      : page.getByLabel("组合框标题");
    if ((await title.count()) === 0) {
      await page.locator(nodeSelector).click({ position: { x: 12, y: 12 } });
    }
    await expect(title).toBeVisible();
    await expect(title).toHaveValue(initial);
    await composeTextControl(title, [...values]);
    await expect(title).toHaveValue(values.at(-1)!);
    await title.press("Meta+z");
    await expect(title).toHaveValue(initial);
    await expect(title).not.toHaveValue(/wen zi|tu pian|shi pin|yin pin|lie biao|xin zu/i);
    await title.press("Meta+Shift+z");
    await expect(title).toHaveValue(values.at(-1)!);
  }

  expect(paidRequests).toEqual([]);
});

test("Cmd+Z during an unfinished IME composition rolls back Text body and Image Prompt before persistence", async ({
  page,
  request,
}) => {
  const paidRequests: string[] = [];
  page.on("request", (entry) => {
    if (
      entry.method() === "POST" &&
      /generation-tasks|provider|openrouter|volces|mureka/i.test(entry.url())
    ) paidRequests.push(entry.url());
  });

  await request.delete("/api/canvas/node.text.empty");
  await page.goto("/__fixture/node.text.empty");
  await page.locator('.react-flow__node[data-id="text-primary"]').click();
  await page.getByTestId("canvas-node-text-content").dblclick();
  const body = page.getByTestId("text-node-editor");
  await body.dispatchEvent("compositionstart", { data: "" });
  await body.evaluate((element) => {
    element.textContent = "ni hao";
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "ni hao",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
  });
  await expect(body).toHaveText("ni hao");
  await body.press("Meta+z");
  await expect(body).toHaveText("");
  await body.dispatchEvent("compositionend", { data: "你好" });
  await expect(body).toHaveText("");
  await body.press("Escape");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.reload();
  await expect(page.getByTestId("text-node-editor")).toHaveText("");

  await request.delete("/api/canvas/node.image.prompt-ready");
  await page.goto("/__fixture/node.image.prompt-ready");
  const prompt = page.getByTestId("image-creator-prompt");
  await prompt.dispatchEvent("compositionstart", { data: "" });
  await prompt.evaluate((element: HTMLTextAreaElement) => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(element, "yi zhi mao");
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: "yi zhi mao",
      inputType: "insertCompositionText",
      isComposing: true,
    }));
  });
  await expect(prompt).toHaveValue("yi zhi mao");
  await prompt.press("Meta+z");
  await expect(prompt).toHaveValue("");
  await prompt.dispatchEvent("compositionend", { data: "一只猫" });
  await expect(prompt).toHaveValue("");
  await prompt.blur();
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  await page.reload();
  await expect(page.getByTestId("image-creator-prompt")).toHaveValue("");
  expect(paidRequests).toEqual([]);
});
