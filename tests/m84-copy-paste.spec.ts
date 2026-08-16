import { randomUUID } from "node:crypto";
import { expect, test } from "./safe-test";
import { generationOwnershipKey } from "../client/src/canvas/ProbeNode";

const generationSnapshots = {
  audio: {
    modelId: "m84-audio-model",
    parameters: { duration: 12 },
    prompt: "old audio prompt",
    upstream: [],
  },
  image: {
    aspectRatio: "1:1",
    modelId: "m84-image-model",
    parameters: { guidance: 3 },
    prompt: "img",
    quality: "standard",
    upstream: [],
  },
  text: {
    modelId: "m84-text-model",
    parameters: { temperature: 0.4 },
    prompt: "hi",
    upstream: [],
  },
  video: {
    modelId: "m84-video-model",
    parameters: { duration: 5 },
    prompt: "old video prompt",
    upstream: [],
  },
} as const;

const generationTaskIds = {
  audio: "m84-audio-task",
  image: "m84-image-task",
  text: "m84-text-task",
  video: "m84-video-task",
} as const;

const generationKinds = ["text", "image", "video", "audio"] as const;
const generationBindingSuffixes = [
  "GenerationError",
  "GenerationErrorCode",
  "GenerationInputKey",
  "GenerationOwnershipKey",
  "Generating",
  "GenerationRetryAllowed",
  "GenerationRetryBlockCode",
  "GenerationRetryBlockReason",
  "GenerationTaskId",
] as const;

async function createProjectCanvas(
  request: import("@playwright/test").APIRequestContext,
  generationMatrix = false,
) {
  const projectResponse = await request.post("/api/projects", {
    data: {},
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };
  const canvasId = project.id;
  const baselineResponse = await request.get(`/api/canvas/${canvasId}`);
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = (await baselineResponse.json()) as {
    loadToken: string;
    revision: number;
  };
  const saveSessionId = randomUUID();
  const response = await request.put(`/api/canvas/${canvasId}`, {
    data: {
      edges: generationMatrix
        ? []
        : [
            {
              data: { inputOrder: 1, inputRole: "reference-image" },
              id: "e1",
              source: "t1",
              sourceHandle: "source",
              target: "i1",
              targetHandle: "target",
              type: "cuttable",
            },
          ],
      nodes: [
        {
          data: { label: "G1", title: "G1" },
          id: "g1",
          position: { x: 200, y: 150 },
          style: { height: generationMatrix ? 620 : 320, width: 720 },
          type: "group",
        },
        {
          data: {
            label: "T1",
            textPrompt: "hi",
            textPromptReady: true,
            title: "T1",
            ...(generationMatrix
              ? {
                  content: "old text result",
                  contentHtml: "<p>old text result</p>",
                  textGenerationError: "old text error",
                  textGenerationErrorCode: "OLD_TEXT_ERROR",
                  textGenerationInputKey: "text-input-key",
                  textGenerationOwnershipKey: generationOwnershipKey(
                    generationSnapshots.text,
                  ),
                  textGenerating: true,
                  textGenerationRetryAllowed: true,
                  textGenerationRetryBlockCode: "TEXT_BLOCK",
                  textGenerationRetryBlockReason: "text block",
                  textGenerationTaskId: generationTaskIds.text,
                  textModelId: generationSnapshots.text.modelId,
                  textParameters: generationSnapshots.text.parameters,
                }
              : {}),
          },
          id: "t1",
          parentId: "g1",
          position: { x: 60, y: 90 },
          type: "text",
        },
        {
          data: {
            imagePrompt: "img",
            imagePromptReady: true,
            label: "I1",
            title: "I1",
            ...(generationMatrix
              ? {
                  assetId: "m84-old-image-asset",
                  imageGeneratedSuccess: true,
                  imageGenerationError: "old image error",
                  imageGenerationErrorCode: "OLD_IMAGE_ERROR",
                  imageGenerationInputKey: "image-input-key",
                  imageGenerationOwnershipKey: generationOwnershipKey(
                    generationSnapshots.image,
                  ),
                  imageGenerating: true,
                  imageGenerationRetryAllowed: false,
                  imageGenerationRetryBlockCode: "IMAGE_BLOCK",
                  imageGenerationRetryBlockReason: "image block",
                  imageGenerationTaskId: generationTaskIds.image,
                  imageAspectRatio: generationSnapshots.image.aspectRatio,
                  imageModelId: generationSnapshots.image.modelId,
                  imageParameters: generationSnapshots.image.parameters,
                  imageQuality: generationSnapshots.image.quality,
                  imageSrc: "/m84-old-image.png",
                }
              : {}),
          },
          id: "i1",
          parentId: "g1",
          position: { x: 400, y: 90 },
          type: "image",
        },
        ...(generationMatrix
          ? [
              {
                data: {
                  assetId: "m84-old-video-asset",
                  label: "V1",
                  title: "V1",
                  videoGenerationError: "old video error",
                  videoGenerationErrorCode: "OLD_VIDEO_ERROR",
                  videoGenerationInputKey: "video-input-key",
                  videoGenerationOwnershipKey: generationOwnershipKey(
                    generationSnapshots.video,
                  ),
                  videoGenerating: true,
                  videoGenerationRetryAllowed: true,
                  videoGenerationRetryBlockCode: "VIDEO_BLOCK",
                  videoGenerationRetryBlockReason: "video block",
                  videoGenerationTaskId: generationTaskIds.video,
                  videoModelId: generationSnapshots.video.modelId,
                  videoParameters: generationSnapshots.video.parameters,
                  videoPrompt: "old video prompt",
                  videoPromptReady: true,
                  videoSrc: "/m84-old-video.mp4",
                },
                id: "v1",
                parentId: "g1",
                position: { x: 60, y: 360 },
                type: "video",
              },
              {
                data: {
                  assetId: "m84-old-audio-asset",
                  audioGeneratedResult: true,
                  audioGenerationError: "old audio error",
                  audioGenerationErrorCode: "OLD_AUDIO_ERROR",
                  audioGenerationInputKey: "audio-input-key",
                  audioGenerationOwnershipKey: generationOwnershipKey(
                    generationSnapshots.audio,
                  ),
                  audioGenerating: true,
                  audioGenerationRetryAllowed: false,
                  audioGenerationRetryBlockCode: "AUDIO_BLOCK",
                  audioGenerationRetryBlockReason: "audio block",
                  audioGenerationTaskId: generationTaskIds.audio,
                  audioModelId: generationSnapshots.audio.modelId,
                  audioParameters: generationSnapshots.audio.parameters,
                  audioPrompt: "old audio prompt",
                  audioPromptReady: true,
                  audioSrc: "/m84-old-audio.mp3",
                  label: "A1",
                  title: "A1",
                },
                id: "a1",
                parentId: "g1",
                position: { x: 400, y: 360 },
                type: "audio",
              },
            ]
          : []),
      ],
      observedLoadToken: baseline.loadToken,
      observedRevision: baseline.revision,
      revision: baseline.revision,
      saveAttemptId: randomUUID(),
      saveSequence: 1,
      saveSessionId,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(response.ok()).toBeTruthy();
  return canvasId;
}

async function worldClientPoint(
  page: import("@playwright/test").Page,
  world: { x: number; y: number },
) {
  const worldElement = page.getByTestId("canvas-world");
  const rect = (await worldElement.boundingBox())!;
  const zoom = Number(await worldElement.getAttribute("data-viewport-zoom"));
  const x = Number(await worldElement.getAttribute("data-viewport-x"));
  const y = Number(await worldElement.getAttribute("data-viewport-y"));
  return {
    x: rect.x + x + world.x * zoom,
    y: rect.y + y + world.y * zoom,
  };
}

async function savedCanvas(
  request: import("@playwright/test").APIRequestContext,
  canvasId: string,
) {
  const response = await request.get(`/api/canvas/${canvasId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    edges: Array<{ id: string; source: string; target: string }>;
    nodes: Array<{
      id: string;
      data: Record<string, unknown>;
      parentId?: string;
      position: { x: number; y: number };
      type: string;
    }>;
  };
}

test("group copy pastes children and internal edges at the cursor top-left", async ({
  page,
  request,
}) => {
  const canvasId = await createProjectCanvas(request);
  await page.goto(`/canvas/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  await page
    .locator('.react-flow__node[data-id="g1"]')
    .click({ position: { x: 24, y: 24 } });
  await page.keyboard.press("Meta+c");
  const target = await worldClientPoint(page, { x: 600, y: 420 });
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press("Meta+v");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const document = await savedCanvas(request, canvasId);
  const groups = document.nodes.filter((node) => node.type === "group");
  expect(groups).toHaveLength(2);
  const original = groups.find((node) => node.id === "g1")!;
  const pasted = groups.find((node) => node.id !== "g1")!;
  expect(original.position).toEqual({ x: 200, y: 150 });
  expect(pasted.position).toEqual({ x: 600, y: 420 });

  const children = document.nodes.filter(
    (node) => node.parentId === pasted.id,
  );
  expect(children.map((node) => node.type).sort()).toEqual(["image", "text"]);
  const textChild = children.find((node) => node.type === "text")!;
  const imageChild = children.find((node) => node.type === "image")!;
  expect(textChild.position).toEqual({ x: 60, y: 90 });
  expect(imageChild.position).toEqual({ x: 400, y: 90 });

  const pastedChildIds = new Set(children.map((node) => node.id));
  const internalEdge = document.edges.find(
    (edge) =>
      pastedChildIds.has(edge.source) && pastedChildIds.has(edge.target),
  );
  expect(internalEdge).toBeTruthy();
  expect(
    document.edges.some(
      (edge) =>
        (edge.source === "g1" || edge.target === "g1") &&
        (pastedChildIds.has(edge.source) || pastedChildIds.has(edge.target)),
    ),
  ).toBe(false);

  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
  const undone = await savedCanvas(request, canvasId);
  expect(undone.nodes.filter((node) => node.type === "group")).toHaveLength(1);
});

test("copying a child node pastes it standalone at the cursor", async ({
  page,
  request,
}) => {
  const canvasId = await createProjectCanvas(request);
  await page.goto(`/canvas/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  await page.locator('.react-flow__node[data-id="t1"]').click();
  await page.keyboard.press("Meta+c");
  const target = await worldClientPoint(page, { x: 800, y: 500 });
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press("Meta+v");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const document = await savedCanvas(request, canvasId);
  const pastedText = document.nodes.find(
    (node) =>
      node.type === "text" &&
      node.id !== "t1" &&
      node.position.x === 800 &&
      node.position.y === 500,
  );
  expect(pastedText).toBeTruthy();
  expect(pastedText!.parentId).toBeUndefined();
  expect(document.edges).toHaveLength(1);
});

test("copy and paste keeps results and parameters but scrubs all generation bindings", async ({
  page,
  request,
}) => {
  const canvasId = await createProjectCanvas(request, true);
  const exactTaskReads = new Set<string>();
  await page.route("**/api/generation-tasks/**", async (route) => {
    const inbound = route.request();
    if (inbound.method() === "GET") {
      const pathname = new URL(inbound.url()).pathname;
      const taskId = Object.values(generationTaskIds).find((candidate) =>
        pathname === `/api/generation-tasks/${candidate}`
      );
      if (taskId) exactTaskReads.add(taskId);
    }
    await route.fulfill({
      contentType: "application/json",
      status: 503,
      body: JSON.stringify({ error: "m84 keeps seeded task state stable" }),
    });
  });
  await page.goto(`/canvas/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");
  await expect.poll(() => Object.values(generationTaskIds).every((taskId) =>
    exactTaskReads.has(taskId)
  )).toBe(true);

  const beforeCopy = await savedCanvas(request, canvasId);
  const originalBindings = Object.fromEntries(generationKinds.map((kind) => {
    const original = beforeCopy.nodes.find((node) =>
      node.type === kind && node.parentId === "g1"
    )!;
    expect(original.data[`${kind}GenerationTaskId`]).toBe(
      generationTaskIds[kind],
    );
    return [kind, Object.fromEntries(generationBindingSuffixes.map((suffix) => [
      suffix,
      original.data[`${kind}${suffix}`],
    ]))];
  })) as Record<
    (typeof generationKinds)[number],
    Record<(typeof generationBindingSuffixes)[number], unknown>
  >;

  await page
    .locator('.react-flow__node[data-id="g1"]')
    .click({ position: { x: 24, y: 24 } });
  await page.keyboard.press("Meta+c");
  const target = await worldClientPoint(page, { x: 900, y: 700 });
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press("Meta+v");
  await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

  const document = await savedCanvas(request, canvasId);
  const pastedGroup = document.nodes.find(
    (node) => node.type === "group" && node.id !== "g1",
  )!;
  const pastedByKind = new Map(
    document.nodes
      .filter((node) => node.parentId === pastedGroup.id)
      .map((node) => [node.type, node]),
  );
  expect([...pastedByKind.keys()].sort()).toEqual([
    "audio",
    "image",
    "text",
    "video",
  ]);

  const retainedFields = {
    audio: ["assetId", "audioGeneratedResult", "audioParameters", "audioPrompt", "audioSrc"],
    image: ["assetId", "imageGeneratedSuccess", "imageParameters", "imageSrc"],
    text: ["content", "contentHtml", "textParameters", "textPrompt"],
    video: ["assetId", "videoParameters", "videoPrompt", "videoSrc"],
  } as const;
  for (const kind of generationKinds) {
    const original = document.nodes.find((node) => node.type === kind &&
      node.parentId === "g1")!;
    const pasted = pastedByKind.get(kind)!;
    for (const field of retainedFields[kind]) {
      expect(pasted.data[field]).toEqual(original.data[field]);
    }
    for (const suffix of generationBindingSuffixes) {
      expect(original.data[`${kind}${suffix}`]).toEqual(
        originalBindings[kind][suffix],
      );
      if (suffix === "Generating") {
        expect(pasted.data[`${kind}${suffix}`]).toBe(false);
      } else {
        expect(pasted.data[`${kind}${suffix}`]).toBeUndefined();
      }
    }
    expect(original.data[`${kind}GenerationTaskId`]).toBe(
      generationTaskIds[kind],
    );
  }
});
