import { expect, test } from "@playwright/test";
import { composeTextControl } from "./helpers/ime";

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
    await page.locator(nodeSelector).click({ position: { x: 12, y: 12 } });
    const title = testId
      ? page.getByTestId(testId)
      : page.getByLabel("组合框标题");
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
