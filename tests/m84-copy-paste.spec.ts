import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./safe-test";
import { scrubDuplicatedGenerationState } from
  "../client/src/canvas/CanvasSurface";

const generationAssets = {
  audio: {
    endpoint: "/api/audio-assets/m84-old-audio.mp3",
    file: "client/public/fixtures/audio-success.mp3",
    id: "m84-old-audio.mp3",
    kind: "audio",
    type: "audio/mpeg",
  },
  image: {
    endpoint: "/api/assets/m84-old-image.png",
    file: "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    id: "m84-old-image.png",
    kind: "image",
    type: "image/png",
  },
  video: {
    endpoint: "/api/video-assets/m84-old-video.mp4",
    file: "client/public/fixtures/video-success.mp4",
    id: "m84-old-video.mp4",
    kind: "video",
    type: "video/mp4",
  },
} as const;

type SeededMediaMetadata = {
  assetId: string;
  byteSize: number;
  contentType: string;
  durationSeconds: number | null;
  kind: "audio" | "image" | "video";
  mediaHeight: number | null;
  mediaWidth: number | null;
  storageBackend: "local" | "oss";
};

function seededMediaPatch(metadata: SeededMediaMetadata) {
  return {
    inputState: "ready",
    mediaByteSize: metadata.byteSize,
    mediaContentType: metadata.contentType,
    mediaDurationSeconds: metadata.durationSeconds ?? undefined,
    mediaHeight: metadata.mediaHeight ?? undefined,
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: metadata.storageBackend,
    mediaWidth: metadata.mediaWidth ?? undefined,
  } as const;
}

async function seedGenerationAssets(
  request: import("@playwright/test").APIRequestContext,
) {
  const metadata = {} as Record<keyof typeof generationAssets, SeededMediaMetadata>;
  for (const [kind, asset] of Object.entries(generationAssets) as Array<
    [keyof typeof generationAssets, (typeof generationAssets)[keyof typeof generationAssets]]
  >) {
    const response = await request.post(asset.endpoint, {
      data: readFileSync(resolve(asset.file)),
      headers: {
        "Content-Type": asset.type,
        "X-File-Name": encodeURIComponent(asset.id),
      },
    });
    expect(response.status()).toBe(201);
    const metadataResponse = await request.get(
      `/api/media-metadata/${asset.kind}/${asset.id}`,
    );
    expect(metadataResponse.ok()).toBeTruthy();
    metadata[kind] = await metadataResponse.json() as SeededMediaMetadata;
  }
  return metadata;
}

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
  const media = generationMatrix ? await seedGenerationAssets(request) : undefined;
  const projectResponse = await request.post("/api/projects", {
    data: {},
  });
  expect(projectResponse.status()).toBe(201);
  const project = (await projectResponse.json()) as { id: string };
  const canvasId = project.id;
  expect((await request.delete(`/api/canvas/${canvasId}`)).ok()).toBeTruthy();
  const saveSessionId = randomUUID();
  const response = await request.put(`/api/canvas/${canvasId}`, {
    headers: { "X-Unboundry-Safe-Fixture-Seed": canvasId },
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
                  assetId: generationAssets.image.id,
                  imageGeneratedSuccess: true,
                  imageAspectRatio: generationSnapshots.image.aspectRatio,
                  imageModelId: generationSnapshots.image.modelId,
                  imageParameters: generationSnapshots.image.parameters,
                  imageQuality: generationSnapshots.image.quality,
                  imageSrc: generationAssets.image.endpoint,
                  ...seededMediaPatch(media!.image),
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
                  assetId: generationAssets.video.id,
                  label: "V1",
                  title: "V1",
                  videoModelId: generationSnapshots.video.modelId,
                  videoParameters: generationSnapshots.video.parameters,
                  videoPrompt: "old video prompt",
                  videoPromptReady: true,
                  videoSrc: generationAssets.video.endpoint,
                  ...seededMediaPatch(media!.video),
                },
                id: "v1",
                parentId: "g1",
                position: { x: 60, y: 360 },
                type: "video",
              },
              {
                data: {
                  assetId: generationAssets.audio.id,
                  audioGeneratedResult: true,
                  audioModelId: generationSnapshots.audio.modelId,
                  audioParameters: generationSnapshots.audio.parameters,
                  audioPrompt: "old audio prompt",
                  audioPromptReady: true,
                  audioSrc: generationAssets.audio.endpoint,
                  ...seededMediaPatch(media!.audio),
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
      revision: 0,
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
  await expect(
    page.locator(".react-flow__node-group"),
  ).toHaveCount(2);
  await expect.poll(async () =>
    (await savedCanvas(request, canvasId)).nodes.filter(
      (node) => node.type === "group",
    ).length
  ).toBe(2);

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
  await expect.poll(async () =>
    (await savedCanvas(request, canvasId)).nodes.filter(
      (node) => node.type === "group",
    ).length
  ).toBe(1);
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
  await expect.poll(async () =>
    (await savedCanvas(request, canvasId)).nodes.some(
      (node) => node.type === "text" && node.id !== "t1" &&
        node.position.x === 800 && node.position.y === 500,
    )
  ).toBe(true);

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
  const boundNode = {
    data: {
      label: "Bound generation node",
      ...Object.fromEntries(generationKinds.flatMap((kind) =>
        generationBindingSuffixes.map((suffix) => [
          `${kind}${suffix}`,
          suffix === "Generating" ? true : `${kind}-${suffix}`,
        ])
      )),
    },
    id: "bound-node",
    position: { x: 0, y: 0 },
    type: "text" as const,
  };
  const scrubbed = scrubDuplicatedGenerationState(boundNode);
  for (const kind of generationKinds) {
    for (const suffix of generationBindingSuffixes) {
      if (suffix === "Generating") {
        expect(scrubbed.data[`${kind}${suffix}`]).toBe(false);
      } else {
        expect(scrubbed.data[`${kind}${suffix}`]).toBeUndefined();
      }
    }
  }

  const canvasId = await createProjectCanvas(request, true);
  await page.goto(`/canvas/${canvasId}`);
  const world = page.getByTestId("canvas-world");
  await expect(world).toHaveAttribute("data-persistence-ready", "true");

  await page
    .locator('.react-flow__node[data-id="g1"]')
    .click({ position: { x: 24, y: 24 } });
  await page.keyboard.press("Meta+c");
  const target = await worldClientPoint(page, { x: 900, y: 700 });
  await page.mouse.move(target.x, target.y);
  await page.keyboard.press("Meta+v");
  await expect(
    page.locator(".react-flow__node-group"),
  ).toHaveCount(2);
  await expect.poll(async () =>
    (await savedCanvas(request, canvasId)).nodes.filter(
      (node) => node.type === "group",
    ).length
  ).toBe(2);

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
    audio: ["assetId", "audioParameters", "audioPrompt", "audioSrc"],
    image: ["assetId", "imageParameters", "imageSrc"],
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
    if (kind === "audio") {
      expect(pasted.data.audioGeneratedResult).toBeUndefined();
    } else if (kind === "image") {
      expect(pasted.data.imageGeneratedSuccess).toBeUndefined();
    }
    for (const suffix of generationBindingSuffixes) {
      if (suffix === "Generating") {
        expect(pasted.data[`${kind}${suffix}`]).toBeFalsy();
      } else {
        expect(pasted.data[`${kind}${suffix}`]).toBeUndefined();
      }
    }
  }
});
