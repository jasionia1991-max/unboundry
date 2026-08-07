import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { knownModelParameterSchema } from "../types/modelParameters";

async function connectNodes(page: Page, sourceId: string, targetId: string) {
  const source = page.locator(
    `.react-flow__node[data-id="${sourceId}"] .react-flow__handle.source .node-handle-hit`,
  );
  const target = page.locator(
    `.react-flow__node[data-id="${targetId}"] .react-flow__handle.target .node-handle-hit`,
  );
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

test("an existing Image edge becomes compatible when its source finishes uploading", async ({
  page,
  request,
}) => {
  // Reuse the established P1 persistence fixture route. Playwright runs in an
  // isolated data directory, so this does not touch the user's real canvas.
  const canvasId = "node.image.text-image-input.persistence-retest";
  const modelId = "late-upload-image-model";
  const schema = knownModelParameterSchema({
    capability: "image",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
  });
  const assetIds = new Set<string>();
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        generationEnabled: false,
        models: [{
          capability: "image",
          displayName: "图片引用自动切换测试模型",
          generationAvailable: false,
          generationUnavailableReason: "自动检查不会调用真实模型",
          generationUnavailableReasonCode: "GLOBAL_GENERATION_DISABLED",
          id: modelId,
          isDefault: true,
          parameterSchema: schema,
        }],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await request.delete(`/api/canvas/${canvasId}`);
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
      taskPosts.push(entry.url());
    }
  });
  let releaseFirstUpload!: () => void;
  let resolveFirstAsset!: (assetId: string) => void;
  const firstUploadRelease = new Promise<void>((resolve) => {
    releaseFirstUpload = resolve;
  });
  const firstAssetCreated = new Promise<string>((resolve) => {
    resolveFirstAsset = resolve;
  });
  let interceptedUpload = false;
  await page.route("**/api/assets/*", async (route) => {
    if (route.request().method() !== "POST" || interceptedUpload) {
      await route.continue();
      return;
    }
    interceptedUpload = true;
    const response = await route.fetch();
    const body = await response.body();
    const asset = JSON.parse(body.toString()) as { assetId: string };
    assetIds.add(asset.assetId);
    resolveFirstAsset(asset.assetId);
    await firstUploadRelease;
    await route.fulfill({
      body,
      headers: response.headers(),
      status: response.status(),
    });
  });

  try {
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "reference-image" },
          id: "existing-image-edge",
          source: "late-source",
          sourceHandle: "source",
          target: "image-target",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [
          {
            data: {
              imageSrc: "blob:http://127.0.0.1/expired",
              inputState: "invalid",
              inputStateReason: "旧本地预览已失效",
              title: "待重新上传的参考图",
            },
            id: "late-source",
            position: { x: 100, y: 160 },
            style: { height: 250, width: 250 },
            type: "image",
          },
          {
            data: {
              imageModelId: modelId,
              imageParameters: { inputMode: "text" },
              imagePrompt: "生成商品图",
              imagePromptReady: true,
              title: "目标图片",
            },
            id: "image-target",
            position: { x: 620, y: 160 },
            style: { height: 300, width: 300 },
            type: "image",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    const source = page.locator('.react-flow__node[data-id="late-source"]');
    const savedDocument = async () => {
      const document = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
        edges: Array<{ id: string }>;
        nodes: Array<{ data: { imageParameters?: { inputMode?: string }; assetId?: string; inputState?: string }; id: string }>;
      };
      const sourceNode = document.nodes.find((node) => node.id === "late-source");
      if (sourceNode?.data.assetId) assetIds.add(sourceNode.data.assetId);
      return document;
    };
    const targetMode = async () => (await savedDocument()).nodes
      .find((node) => node.id === "image-target")
      ?.data.imageParameters?.inputMode;

    await source.getByTestId("image-upload-input").setInputFiles(resolve(
      "spec/reference/unboundry-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ));
    const staleAssetId = await firstAssetCreated;
    await expect(source.getByTestId("image-node-generating")).toBeVisible();
    await page.keyboard.press("Meta+z");
    releaseFirstUpload();
    await expect.poll(targetMode).toBe("text");
    await expect.poll(async () => {
      const document = await savedDocument();
      const sourceNode = document.nodes.find((node) => node.id === "late-source");
      return {
        assetId: sourceNode?.data.assetId ?? null,
        edgeCount: document.edges.length,
        inputState: sourceNode?.data.inputState,
      };
    }).toEqual({ assetId: null, edgeCount: 1, inputState: "invalid" });
    await expect.poll(async () => (await request.get(
      `/api/assets/${staleAssetId}`,
    )).status()).toBe(404);

    await source.getByTestId("image-upload-input").setInputFiles(resolve(
      "spec/reference/unboundry-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ));
    await expect.poll(targetMode).toBe("image");
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");
    const beforeReload = await savedDocument();
    expect(beforeReload.edges).toHaveLength(1);
    const adoptedAssetId = beforeReload.nodes.find((node) => node.id === "late-source")
      ?.data.assetId;
    expect(adoptedAssetId).toBeTruthy();
    expect(adoptedAssetId).not.toBe(staleAssetId);
    await page.reload();
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    await expect.poll(targetMode).toBe("image");
    const afterReload = await savedDocument();
    expect(afterReload.edges).toHaveLength(1);
    expect(afterReload.nodes.find((node) => node.id === "late-source")?.data.assetId)
      .toBe(adoptedAssetId);

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(taskPosts).toEqual([]);
  } finally {
    releaseFirstUpload();
    for (const assetId of assetIds) {
      await request.delete(`/api/assets/${assetId}`);
    }
    await request.delete(`/api/canvas/${canvasId}`);
  }
});

test("Image upload completion uses live edges, the live target model, and the first ready reference", async ({
  page,
  request,
}) => {
  const canvasId = "node.image.text-image-input.persistence-retest";
  const compatibleModelId = "m35-live-compatible";
  const textOnlyModelId = "m35-live-text-only";
  const compatibleSchema = knownModelParameterSchema({
    capability: "image",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
  });
  const textOnlySchema = {
    ...compatibleSchema,
    fields: compatibleSchema.fields.map((field) => field.key === "inputMode"
      ? {
          ...field,
          defaultValue: "text" as const,
          options: field.options.filter((option) => option.value === "text"),
        }
      : field),
    referenceInputs: { ...compatibleSchema.referenceInputs, image: 0 },
    referencePolicy: {
      modeKey: "inputMode",
      modes: {
        text: { sets: [{ audio: 0, image: 0, video: 0 }] },
      },
    },
  };
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        generationEnabled: false,
        models: [
          {
            capability: "image",
            displayName: "实时边模型",
            generationAvailable: false,
            generationUnavailableReason: "自动检查不会调用真实模型",
            generationUnavailableReasonCode: "GLOBAL_GENERATION_DISABLED",
            id: compatibleModelId,
            isDefault: true,
            parameterSchema: compatibleSchema,
          },
          {
            capability: "image",
            displayName: "上传中切换到文本模型",
            generationAvailable: false,
            generationUnavailableReason: "自动检查不会调用真实模型",
            generationUnavailableReasonCode: "GLOBAL_GENERATION_DISABLED",
            id: textOnlyModelId,
            isDefault: false,
            parameterSchema: textOnlySchema,
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  const readyAssetId = "m35-existing-ready-image";
  const readyUpload = await request.post(`/api/assets/${readyAssetId}`, {
    data: await readFile(resolve(
      "spec/reference/unboundry-v2.12.2-dense/01-neutral-1280x720.png",
    )),
    headers: {
      "Content-Type": "image/png",
      "X-File-Name": "existing-ready.png",
    },
  });
  expect(readyUpload.ok()).toBeTruthy();
  const readyAsset = await readyUpload.json() as {
    assetId: string;
    byteSize: number;
    contentType: string;
    storageBackend: "local" | "oss";
    url: string;
  };
  const createdAssetIds = new Set([readyAsset.assetId]);
  let releaseUpload!: () => void;
  let resolveCreated!: (assetId: string) => void;
  const releasePromise = new Promise<void>((resolveRelease) => {
    releaseUpload = resolveRelease;
  });
  const uploadCreated = new Promise<string>((resolveAsset) => {
    resolveCreated = resolveAsset;
  });
  let intercepted = false;
  await page.route("**/api/assets/*", async (route) => {
    if (route.request().method() !== "POST" || intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    const response = await route.fetch();
    const body = await response.body();
    const asset = JSON.parse(body.toString()) as { assetId: string };
    createdAssetIds.add(asset.assetId);
    resolveCreated(asset.assetId);
    await releasePromise;
    await route.fulfill({
      body,
      headers: response.headers(),
      status: response.status(),
    });
  });

  const targetNode = (id: string, x: number, y: number) => ({
    data: {
      imageModelId: compatibleModelId,
      imageParameters: { inputMode: "text" },
      imagePrompt: "测试实时引用",
      imagePromptReady: true,
      label: "Image",
      title: id,
    },
    id,
    position: { x, y },
    style: { height: 240, width: 240 },
    type: "image",
  });
  const before = await (await request.get("/api/generation-tasks/status")).json() as {
    paidProviderRequests: number;
  };
  const taskPosts: string[] = [];
  page.on("request", (entry) => {
    if (entry.method() === "POST" && /\/api\/generation-tasks(?:$|\?)/.test(entry.url())) {
      taskPosts.push(entry.url());
    }
  });

  try {
    await request.delete(`/api/canvas/${canvasId}`);
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [
          { id: "late-a", source: "live-source", sourceHandle: "source", target: "target-a", targetHandle: "target", type: "cuttable" },
          { id: "late-d", source: "live-source", sourceHandle: "source", target: "target-d", targetHandle: "target", type: "cuttable" },
          { id: "ready-d", source: "ready-source", sourceHandle: "source", target: "target-d", targetHandle: "target", type: "cuttable" },
        ],
        nodes: [
          {
            data: {
              inputState: "invalid",
              inputStateReason: "尚未上传",
              label: "Image",
              title: "实时上传源",
            },
            id: "live-source",
            position: { x: 40, y: 100 },
            style: { height: 240, width: 240 },
            type: "image",
          },
          {
            data: {
              assetId: readyAsset.assetId,
              imageSrc: readyAsset.url,
              inputState: "ready",
              label: "Image",
              mediaByteSize: readyAsset.byteSize,
              mediaContentType: readyAsset.contentType,
              mediaMetadataSource: "server",
              mediaMetadataStatus: "ready",
              mediaStorageBackend: readyAsset.storageBackend,
              title: "已有可用图片",
            },
            id: "ready-source",
            position: { x: 40, y: 470 },
            style: { height: 240, width: 240 },
            type: "image",
          },
          targetNode("target-a", 480, 20),
          targetNode("target-b", 480, 430),
          targetNode("target-c", 850, 20),
          targetNode("target-d", 850, 430),
        ],
        revision: 0,
        viewport: { x: 20, y: 30, zoom: 0.75 },
      },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-persistence-ready", "true");
    const source = page.locator('.react-flow__node[data-id="live-source"]');
    await source.getByTestId("image-upload-input").setInputFiles(resolve(
      "spec/reference/unboundry-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
    ));
    await uploadCreated;
    await expect(source.getByTestId("image-node-generating")).toBeVisible();

    const oldEdge = page.locator('.react-flow__edge[data-id="late-a"]');
    const hitLine = oldEdge.locator(".react-flow__edge-interaction");
    const hitBox = await hitLine.boundingBox();
    expect(hitBox).not.toBeNull();
    await page.mouse.click(
      hitBox!.x + hitBox!.width / 2,
      hitBox!.y + hitBox!.height / 2,
    );
    await page.getByRole("button", { name: "删除连线" }).click();
    await connectNodes(page, "live-source", "target-b");
    await connectNodes(page, "live-source", "target-c");
    await expect(world).toHaveAttribute("data-edge-count", "4");

    await page.locator('.react-flow__node[data-id="target-c"]').click();
    const creator = page.getByTestId("image-creator");
    await creator.getByTestId("image-model-control").getByRole("combobox").click();
    await creator.getByRole("option", { name: /上传中切换到文本模型/ }).click();
    releaseUpload();

    await expect.poll(async () => {
      const document = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
        edges: Array<{ source: string; target: string }>;
        nodes: Array<{
          data: { assetId?: string; imageModelId?: string; imageParameters?: { inputMode?: string } };
          id: string;
        }>;
      };
      const mode = (id: string) => document.nodes.find((node) => node.id === id)
        ?.data.imageParameters?.inputMode;
      const uploaded = document.nodes.find((node) => node.id === "live-source")
        ?.data.assetId;
      if (uploaded) createdAssetIds.add(uploaded);
      return {
        edgeCount: document.edges.length,
        hasOldEdge: document.edges.some((edge) => edge.source === "live-source" && edge.target === "target-a"),
        modes: [mode("target-a"), mode("target-b"), mode("target-c"), mode("target-d")],
        switchedModel: document.nodes.find((node) => node.id === "target-c")?.data.imageModelId,
        uploaded: Boolean(uploaded),
      };
    }).toEqual({
      edgeCount: 4,
      hasOldEdge: false,
      modes: ["text", "image", "text", "text"],
      switchedModel: textOnlyModelId,
      uploaded: true,
    });

    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
    expect(taskPosts).toEqual([]);
  } finally {
    releaseUpload();
    await request.delete(`/api/canvas/${canvasId}`);
    for (const assetId of createdAssetIds) {
      await request.delete(`/api/assets/${assetId}`);
    }
  }
});
