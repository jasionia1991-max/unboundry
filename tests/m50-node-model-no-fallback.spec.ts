import { expect, test } from "./safe-test";
import { withVideoReferenceInputModeForNewEdges } from "../client/src/canvas/CanvasSurface";
import { withImageReferenceInputMode } from "../client/src/canvas/imageReferenceMode";
import type { ProbeNodeType } from "../client/src/canvas/ProbeNode";
import {
  resolvePublishedModel,
  resolvePublishedModelSelection,
  SAVED_MODEL_UNAVAILABLE_REASON,
  type PublishedModel,
} from "../client/src/models/ModelCatalog";
import {
  defaultParameterValues,
  knownModelParameterSchema,
  type ModelCapability,
  type ModelParameterSchema,
} from "../types/modelParameters";

const activeModels = {
  audio: {
    configurationRevision: "a05000000000000000000001",
    displayName: "新音频模型",
    id: "active-audio-model",
    providerDriver: "mureka",
    providerModelId: "mureka-9",
    releaseRevisionId: "a0500000-0000-4000-8000-000000000001",
  },
  image: {
    configurationRevision: "a05000000000000000000002",
    displayName: "新图片模型",
    id: "active-image-model",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
    releaseRevisionId: "a0500000-0000-4000-8000-000000000002",
  },
  text: {
    configurationRevision: "a05000000000000000000003",
    displayName: "新文字模型",
    id: "active-text-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    releaseRevisionId: "a0500000-0000-4000-8000-000000000003",
  },
  video: {
    configurationRevision: "a05000000000000000000004",
    displayName: "新视频模型",
    id: "active-video-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
    releaseRevisionId: "a0500000-0000-4000-8000-000000000004",
  },
} as const;

const oldModels = {
  audio: { displayName: "已归档音频模型", id: "archived-audio-model" },
  image: { displayName: "已停用图片模型", id: "disabled-image-model" },
  text: { displayName: "已归档文字模型", id: "archived-text-model" },
  video: { displayName: "已停用视频模型", id: "disabled-video-model" },
} as const;

function schemaWithInputMode(
  capability: "image" | "video",
  schema: ModelParameterSchema,
  inputMode: "image" | "multimodal",
) {
  return {
    ...schema,
    // This test model accepts the already-connected reference. Compatibility
    // checks still run; the schema simply gives them a compatible destination.
    inputPolicy: capability === "video" ? undefined : schema.inputPolicy,
    fields: schema.fields.map((field) => field.key === "inputMode"
      ? { ...field, defaultValue: inputMode }
      : field),
  } satisfies ModelParameterSchema;
}

const schemas = {
  audio: knownModelParameterSchema({
    capability: "audio",
    providerDriver: activeModels.audio.providerDriver,
    providerModelId: activeModels.audio.providerModelId,
  }),
  image: schemaWithInputMode("image", knownModelParameterSchema({
    capability: "image",
    providerDriver: activeModels.image.providerDriver,
    providerModelId: activeModels.image.providerModelId,
  }), "image"),
  text: knownModelParameterSchema({
    capability: "text",
    providerDriver: activeModels.text.providerDriver,
    providerModelId: activeModels.text.providerModelId,
  }),
  video: schemaWithInputMode("video", knownModelParameterSchema({
    capability: "video",
    providerDriver: activeModels.video.providerDriver,
    providerModelId: activeModels.video.providerModelId,
  }), "multimodal"),
} satisfies Record<ModelCapability, ModelParameterSchema>;

test("saved ids are exact references and only an empty id may inherit the default", () => {
  const model: PublishedModel = {
    capability: "image",
    displayName: activeModels.image.displayName,
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
    id: activeModels.image.id,
    isDefault: true,
    parameterSchema: schemas.image,
    releaseRevisionId: activeModels.image.releaseRevisionId,
  };

  expect(resolvePublishedModel([model])).toBe(model);
  expect(resolvePublishedModel([model], oldModels.image.id)).toBeUndefined();
  const missingSelection = resolvePublishedModelSelection({
    models: [model],
    savedId: oldModels.image.id,
    savedName: oldModels.image.displayName,
    status: "ready",
  });
  expect(missingSelection.model).toBeUndefined();
  expect(missingSelection).toMatchObject({
    displayName: oldModels.image.displayName,
    savedModelUnavailable: true,
    selectedId: oldModels.image.id,
    unavailableReason: SAVED_MODEL_UNAVAILABLE_REASON,
  });

  const savedNode = {
    data: {
      imageModelId: oldModels.image.id,
      imageModelName: oldModels.image.displayName,
      imageParameters: { inputMode: "text", preservedToken: "keep-image" },
      label: "Image",
    },
    id: "saved-image",
    position: { x: 0, y: 0 },
    type: "image",
  } as ProbeNodeType;
  expect(withImageReferenceInputMode(savedNode, [model])).toBe(savedNode);

  const emptyModelNode = {
    ...savedNode,
    data: {
      ...savedNode.data,
      imageModelId: undefined,
      imageModelName: undefined,
    },
    id: "new-image",
  } as ProbeNodeType;
  expect(withImageReferenceInputMode(emptyModelNode, [model]).data.imageParameters)
    .toMatchObject({ inputMode: "image", preservedToken: "keep-image" });

  const videoModel: PublishedModel = {
    capability: "video",
    displayName: activeModels.video.displayName,
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
    id: activeModels.video.id,
    isDefault: true,
    parameterSchema: knownModelParameterSchema({
      capability: "video",
      providerDriver: activeModels.video.providerDriver,
      providerModelId: activeModels.video.providerModelId,
    }),
    releaseRevisionId: activeModels.video.releaseRevisionId,
  };
  const savedVideoNode = {
    data: {
      label: "Video",
      videoModel: oldModels.video.displayName,
      videoModelId: oldModels.video.id,
      videoParameters: { inputMode: "text", preservedToken: "keep-video" },
    },
    id: "saved-video",
    position: { x: 0, y: 0 },
    type: "video",
  } as ProbeNodeType;
  expect(withVideoReferenceInputModeForNewEdges(
    savedVideoNode,
    [videoModel],
    ["image"],
    1,
  )).toBe(savedVideoNode);
  const emptyModelVideoNode = {
    ...savedVideoNode,
    data: {
      ...savedVideoNode.data,
      videoModel: undefined,
      videoModelId: undefined,
    },
    id: "new-video",
  } as ProbeNodeType;
  expect(withVideoReferenceInputModeForNewEdges(
    emptyModelVideoNode,
    [videoModel],
    ["image"],
    1,
  ).data.videoParameters).toMatchObject({
    inputMode: "multimodal",
    preservedToken: "keep-video",
  });
});

test("all four nodes preserve unavailable saved models until an explicit compatible switch", async ({
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
  const generationPosts: string[] = [];
  const externalRequests: string[] = [];

  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        generationEnabled: true,
        models: (Object.entries(activeModels) as Array<[
          ModelCapability,
          (typeof activeModels)[ModelCapability],
        ]>).map(([capability, model]) => ({
          capability,
          configurationRevision: model.configurationRevision,
          displayName: model.displayName,
          generationAvailable: true,
          generationUnavailableReason: "",
          generationUnavailableReasonCode: null,
          id: model.id,
          imageParameters: capability === "image"
            ? {
                aspectRatios: ["auto", "1:1"],
                maxReferenceImages: 16,
                qualities: ["auto", "high"],
              }
            : undefined,
          isDefault: true,
          parameterSchema: schemas[capability],
          releaseRevisionId: model.releaseRevisionId,
        })),
      },
      status: 200,
    });
  });
  page.on("request", (entry) => {
    const url = new URL(entry.url());
    if (
      entry.method() === "POST" &&
      (url.pathname === "/api/generation-tasks" ||
        url.pathname === "/api/generation-tasks/preflight")
    ) {
      generationPosts.push(url.pathname);
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      externalRequests.push(entry.url());
    }
  });

  try {
    const saved = await request.put("/api/canvas/default", {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "instruction" },
          id: "kept-text-image",
          source: "missing-text",
          sourceHandle: "source",
          target: "missing-image",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [
          {
            data: {
              content: "保留的上游文字",
              label: "Text",
              textModelId: oldModels.text.id,
              textModelName: oldModels.text.displayName,
              textParameters: { inputMode: "text", preservedToken: "keep-text" },
              textPrompt: "保留文字 Prompt",
              title: "旧文字节点",
            },
            id: "missing-text",
            position: { x: 390, y: 30 },
            style: { height: 240, width: 240 },
            type: "text",
          },
          {
            data: {
              imageModelId: oldModels.image.id,
              imageModelName: oldModels.image.displayName,
              imageParameters: { inputMode: "text", preservedToken: "keep-image" },
              imagePrompt: "保留图片 Prompt",
              imagePromptReady: true,
              label: "Image",
              title: "旧图片节点",
            },
            id: "missing-image",
            position: { x: 760, y: 30 },
            style: { height: 270, width: 270 },
            type: "image",
          },
          {
            data: {
              label: "Video",
              title: "旧视频节点",
              videoModel: oldModels.video.displayName,
              videoModelId: oldModels.video.id,
              videoParameters: { inputMode: "text", preservedToken: "keep-video" },
              videoPrompt: "保留视频 Prompt",
              videoPromptReady: true,
            },
            id: "missing-video",
            position: { x: 760, y: 470 },
            style: { height: 240, width: 426 },
            type: "video",
          },
          {
            data: {
              audioModelId: oldModels.audio.id,
              audioModelName: oldModels.audio.displayName,
              audioParameters: { audioMode: "music", preservedToken: "keep-audio" },
              audioPrompt: "保留音频 Prompt",
              audioPromptReady: true,
              label: "Audio",
              title: "旧音频节点",
            },
            id: "missing-audio",
            position: { x: 320, y: 470 },
            style: { height: 240, width: 426 },
            type: "audio",
          },
        ],
        revision: original?.revision ?? 0,
        viewport: { x: 20, y: 20, zoom: 0.68 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto("/canvas");
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-edge-count", "1");

    const checks = [
      {
        creator: "text-creator",
        id: "missing-text",
        kind: "text",
        old: oldModels.text,
        prompt: "保留文字 Prompt",
        promptTestId: "text-creator-prompt",
      },
      {
        creator: "image-creator",
        id: "missing-image",
        kind: "image",
        old: oldModels.image,
        prompt: "保留图片 Prompt",
        promptTestId: "image-creator-prompt",
      },
      {
        creator: "video-creator",
        id: "missing-video",
        kind: "video",
        old: oldModels.video,
        prompt: "保留视频 Prompt",
        promptTestId: "video-creator-prompt",
      },
      {
        creator: "audio-creator",
        id: "missing-audio",
        kind: "audio",
        old: oldModels.audio,
        prompt: "保留音频 Prompt",
      },
    ] as const;

    const checkUnavailableNodes = async () => {
      for (const check of checks) {
        await page.locator(`.react-flow__node[data-id="${check.id}"]`)
          .dispatchEvent("click");
        const creator = page.getByTestId(check.creator);
        await expect(creator).toBeVisible();
        const control = creator.getByTestId(`${check.kind}-model-control`);
        await expect(control.getByRole("combobox"))
          .toHaveAttribute("data-value", check.old.id);
        await expect(control).toContainText(check.old.displayName);
        await expect(control).toContainText("原模型不可用");
        await expect(creator.getByTestId(`${check.kind}-generation-unavailable`))
          .toContainText(SAVED_MODEL_UNAVAILABLE_REASON);
        await expect(creator.getByRole("button", { name: "Generate" }))
          .toBeDisabled();
        const prompt = check.kind === "audio"
          ? creator.getByLabel("音频提示词")
          : creator.getByTestId(check.promptTestId);
        await expect(prompt).toHaveValue(check.prompt);
      }
    };

    await checkUnavailableNodes();

    const beforeReload = await (await request.get("/api/canvas/default")).json() as {
      edges: unknown[];
      nodes: Array<{ data: Record<string, unknown>; id: string }>;
    };
    expect(beforeReload.edges).toHaveLength(1);
    expect(beforeReload.nodes.find(({ id }) => id === "missing-text")?.data)
      .toMatchObject({
        textModelId: oldModels.text.id,
        textModelName: oldModels.text.displayName,
        textParameters: { inputMode: "text", preservedToken: "keep-text" },
        textPrompt: "保留文字 Prompt",
      });
    expect(beforeReload.nodes.find(({ id }) => id === "missing-image")?.data)
      .toMatchObject({
        imageModelId: oldModels.image.id,
        imageModelName: oldModels.image.displayName,
        imageParameters: { inputMode: "text", preservedToken: "keep-image" },
        imagePrompt: "保留图片 Prompt",
      });
    expect(beforeReload.nodes.find(({ id }) => id === "missing-video")?.data)
      .toMatchObject({
        videoModel: oldModels.video.displayName,
        videoModelId: oldModels.video.id,
        videoParameters: { inputMode: "text", preservedToken: "keep-video" },
        videoPrompt: "保留视频 Prompt",
      });
    expect(beforeReload.nodes.find(({ id }) => id === "missing-audio")?.data)
      .toMatchObject({
        audioModelId: oldModels.audio.id,
        audioModelName: oldModels.audio.displayName,
        audioParameters: { audioMode: "music", preservedToken: "keep-audio" },
        audioPrompt: "保留音频 Prompt",
      });

    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect(world).toHaveAttribute("data-edge-count", "1");
    await checkUnavailableNodes();

    // The only transition to a currently published model is a deliberate menu
    // selection. Existing compatibility validation still runs in each handler.
    for (const check of checks) {
      await page.locator(`.react-flow__node[data-id="${check.id}"]`)
        .dispatchEvent("click");
      const creator = page.getByTestId(check.creator);
      const control = creator.getByTestId(`${check.kind}-model-control`);
      await control.getByRole("combobox").click();
      const active = activeModels[check.kind];
      await control.getByRole("option", { name: new RegExp(active.displayName) })
        .click();
      await expect(control.getByRole("combobox"))
        .toHaveAttribute("data-value", active.id);
      await expect(control).toContainText(active.displayName);
      await expect(creator.getByTestId(`${check.kind}-generation-unavailable`))
        .toHaveCount(0);
    }

    await expect.poll(async () => {
      const document = await (await request.get("/api/canvas/default")).json() as {
        nodes: Array<{ data: Record<string, unknown>; id: string }>;
      };
      return Object.fromEntries(document.nodes.map((node) => [node.id, node.data]));
    }).toMatchObject({
      "missing-audio": {
        audioModelId: activeModels.audio.id,
        audioModelName: activeModels.audio.displayName,
        audioPrompt: "保留音频 Prompt",
      },
      "missing-image": {
        imageModelId: activeModels.image.id,
        imageModelName: activeModels.image.displayName,
        imagePrompt: "保留图片 Prompt",
      },
      "missing-text": {
        textModelId: activeModels.text.id,
        textModelName: activeModels.text.displayName,
        textPrompt: "保留文字 Prompt",
      },
      "missing-video": {
        videoModel: activeModels.video.displayName,
        videoModelId: activeModels.video.id,
        videoPrompt: "保留视频 Prompt",
      },
    });
    const afterSwitch = await (await request.get("/api/canvas/default")).json() as {
      edges: unknown[];
      nodes: unknown[];
    };
    expect(afterSwitch.edges).toHaveLength(1);
    expect(generationPosts).toEqual([]);
    expect(externalRequests).toEqual([]);
  } finally {
    const latest = await request.get("/api/canvas/default");
    if (original && latest.ok()) {
      const revision = (await latest.json() as { revision: number }).revision;
      await request.put("/api/canvas/default", {
        data: { ...original, revision },
      });
    } else if (!original) {
      await request.delete("/api/canvas/default");
    }
  }
});
