import { expect, test } from "@playwright/test";
import { resolveNodeInputs } from "../types/nodeInputs";
import {
  knownModelParameterSchema,
  type ModelParameterSchema,
} from "../types/modelParameters";

const audioModelId = "audio-text-zero-provider";
const audioModelName = "Audio Text 零Provider";
const upstreamTemplate = "电商配乐母版：节奏轻快，保留服装的精致感。";
const ownSupplement = "本节点补充：人声柔和，结尾自然淡出。";
const lyrics = "[Verse]\n红色衣角随风轻轻摇";

const audioTextSchema: ModelParameterSchema = {
  ...knownModelParameterSchema({
    capability: "audio",
    providerDriver: "mureka",
    providerModelId: "mureka-9",
  }),
  inputPolicy: {
    required: {},
    roles: {
      text: ["instruction", "context-text"],
    },
    switchPolicy: "keep-edge",
  },
  upstreamInputs: {
    audio: { limitMode: "fixed", maxCount: 0, supported: false },
    image: { limitMode: "fixed", maxCount: 0, supported: false },
    text: { limitMode: "context", supported: true },
    video: { limitMode: "fixed", maxCount: 0, supported: false },
  },
};

const audioParameters = {
  lyrics,
  musicGenerationMode: "lyrics-song",
  outputCount: 1,
  streamPlayback: false,
  vocalGender: "female",
};

test("Audio resolves an upstream Text template without folding independent lyrics into Prompt", () => {
  const graph = {
    edges: [{
      data: { inputOrder: 1, inputRole: "instruction" },
      id: "audio-text-edge",
      source: "template-text",
      target: "audio-target",
    }],
    nodes: [
      {
        data: { content: upstreamTemplate, title: "配乐母版" },
        id: "template-text",
        type: "text",
      },
      { data: { title: "目标音频" }, id: "audio-target", type: "audio" },
    ],
  };

  const fallback = resolveNodeInputs({
    ...graph,
    modelSchema: audioTextSchema,
    ownPrompt: "",
    parameters: audioParameters,
    targetId: "audio-target",
    targetKind: "audio",
  });
  expect(fallback.canSubmit).toBeTruthy();
  expect(fallback.finalPrompt).toBe(upstreamTemplate);
  expect(fallback.finalPrompt).not.toContain(lyrics);
  expect(fallback.snapshot).toEqual([{
    kind: "text",
    order: 1,
    role: "instruction",
    sourceNodeId: "template-text",
  }]);

  const merged = resolveNodeInputs({
    ...graph,
    modelSchema: audioTextSchema,
    ownPrompt: ownSupplement,
    parameters: audioParameters,
    targetId: "audio-target",
    targetKind: "audio",
  });
  expect(merged.finalPrompt).toBe(`${upstreamTemplate}\n\n${ownSupplement}`);
  expect(merged.finalPrompt).not.toContain(lyrics);
});

test("Audio Text card, Prompt merge, independent lyrics and delete undo reload stay durable with zero Provider requests", async ({
  page,
  request,
}) => {
  const existing = await request.get("/api/canvas/default");
  const original = existing.ok()
    ? await existing.json() as {
        edges: unknown[];
        nodes: unknown[];
        revision: number;
        viewport: { x: number; y: number; zoom: number };
      }
    : undefined;
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const providerOrTaskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() !== "POST") return;
    const url = new URL(entry.url());
    if (
      /\/api\/generation-tasks(?:$|\/|\?)/.test(url.pathname) ||
      /(?:mureka\.ai|openrouter\.ai|volces\.com)$/i.test(url.hostname)
    ) {
      providerOrTaskPosts.push(entry.url());
    }
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: false,
        models: [{
          capability: "audio",
          displayName: audioModelName,
          generationAvailable: false,
          generationUnavailableReason: "零Provider专项检查不发起真实生成",
          generationUnavailableReasonCode: "GLOBAL_GENERATION_DISABLED",
          id: audioModelId,
          isDefault: true,
          parameterSchema: audioTextSchema,
          providerProtocol: "native",
        }],
      },
      status: 200,
    });
  });

  const saved = await request.put("/api/canvas/default", {
    data: {
      edges: [{
        data: { inputOrder: 1, inputRole: "instruction" },
        id: "audio-text-edge",
        source: "template-text",
        sourceHandle: "source",
        target: "audio-target",
        targetHandle: "target",
        type: "cuttable",
      }],
      nodes: [
        {
          data: {
            content: upstreamTemplate,
            label: "Text",
            title: "配乐母版",
          },
          id: "template-text",
          position: { x: 80, y: 210 },
          style: { height: 200, width: 280 },
          type: "text",
        },
        {
          data: {
            audioModelId,
            audioModelName,
            audioParameters,
            audioPrompt: "",
            audioPromptReady: true,
            label: "Audio",
            title: "目标音频",
          },
          id: "audio-target",
          position: { x: 590, y: 180 },
          style: { height: 250, width: 444 },
          type: "audio",
        },
      ],
      revision: original?.revision ?? 0,
      viewport: { x: 0, y: 0, zoom: 0.8 },
    },
  });
  expect(saved.ok()).toBeTruthy();

  try {
    await page.goto("/");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-edge-count", "1");
    await page.locator('.react-flow__node[data-id="audio-target"]').click({
      position: { x: 12, y: 12 },
    });

    const creator = page.getByTestId("audio-creator");
    const card = page.getByTestId("upstream-input-template-text");
    await expect(creator).toBeVisible();
    await expect(card).toHaveAttribute("data-input-kind", "text");
    await expect(card).toHaveAttribute("data-input-state", "ready");
    await expect(card).toHaveAttribute("data-input-compatibility", "compatible");
    await expect(card).toHaveAttribute("data-input-role", "instruction");
    await expect(page.getByTestId("audio-final-prompt")).toContainText("使用上游母版");
    await expect(page.getByTestId("audio-final-prompt-value")).toHaveText(upstreamTemplate);
    await expect(page.getByTestId("audio-lyrics-source")).toContainText("歌词由音频参数独立提供");
    await expect(page.getByTestId("audio-final-prompt")).not.toContainText(lyrics);

    const mainParameterTrigger = creator
      .locator('.node-parameter-control > button[aria-haspopup="dialog"]')
      .first();
    await mainParameterTrigger.click();
    await expect(page.getByRole("dialog", { name: "模型参数" })
      .getByRole("textbox", { name: "歌词" }))
      .toHaveValue(lyrics);
    await mainParameterTrigger.click();

    await card.getByRole("button", { name: "查看引用 配乐母版" }).click();
    const role = creator.getByRole("dialog", { name: "配乐母版引用详情" })
      .getByRole("group", { name: "配乐母版角色" });
    await role.locator('[data-value="context-text"]').click();
    await expect(card).toHaveAttribute("data-input-role", "context-text");

    const prompt = page.getByTestId("audio-creator-prompt");
    await prompt.fill(ownSupplement);
    await prompt.blur();
    await expect(page.getByTestId("audio-final-prompt")).toContainText("母版 + 本节点补充");
    await expect(page.getByTestId("audio-final-prompt-value"))
      .toHaveText(`${upstreamTemplate}\n\n${ownSupplement}`);
    await expect(page.getByTestId("audio-final-prompt-value")).not.toContainText(lyrics);

    await card.getByRole("button", { name: "删除引用 配乐母版" }).click();
    await expect(world).toHaveAttribute("data-edge-count", "0");
    await expect(page.getByTestId("audio-final-prompt")).toHaveCount(0);
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    await page.keyboard.press("Meta+z");
    await expect(world).toHaveAttribute("data-edge-count", "1");
    await expect(page.getByTestId("upstream-input-template-text"))
      .toHaveAttribute("data-input-role", "context-text");
    await expect(page.getByTestId("audio-final-prompt-value"))
      .toHaveText(`${upstreamTemplate}\n\n${ownSupplement}`);
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-edge-count", "1");
    await page.locator('.react-flow__node[data-id="audio-target"]').click({
      position: { x: 12, y: 12 },
    });
    await expect(page.getByTestId("upstream-input-template-text"))
      .toHaveAttribute("data-input-role", "context-text");
    await expect(page.getByTestId("audio-final-prompt-value"))
      .toHaveText(`${upstreamTemplate}\n\n${ownSupplement}`);
    await expect(page.getByTestId("audio-lyrics-source")).toBeVisible();

    const persisted = await (await request.get("/api/canvas/default")).json() as {
      edges: Array<{
        data: { inputOrder?: number; inputRole?: string };
        id: string;
        source: string;
        target: string;
      }>;
      nodes: Array<{
        data: {
          audioParameters?: { lyrics?: string };
          audioPrompt?: string;
        };
        id: string;
      }>;
    };
    expect(persisted.edges).toEqual([expect.objectContaining({
      data: expect.objectContaining({ inputOrder: 1, inputRole: "context-text" }),
      id: "audio-text-edge",
      source: "template-text",
      target: "audio-target",
    })]);
    expect(persisted.nodes.find(({ id }) => id === "audio-target")?.data)
      .toMatchObject({
        audioParameters: { lyrics },
        audioPrompt: ownSupplement,
      });

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(providerOrTaskPosts).toEqual([]);
  } finally {
    try {
      if (!page.isClosed()) await page.goto("about:blank");
      const current = await request.get("/api/canvas/default");
      if (original && current.ok()) {
        const currentDocument = await current.json() as { revision: number };
        await request.put("/api/canvas/default", {
          data: {
            edges: original.edges,
            nodes: original.nodes,
            revision: currentDocument.revision,
            viewport: original.viewport,
          },
        });
      } else if (!original) {
        await request.delete("/api/canvas/default");
      }
    } catch {
      // A timed-out Playwright context is already isolated in its own data dir.
    }
  }
});
