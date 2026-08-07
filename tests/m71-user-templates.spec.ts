import { expect, test, type APIRequestContext } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProbeNodeType } from "../client/src/canvas/ProbeNode";
import type { CuttableEdge } from "../client/src/canvas/canvasTypes";
import { serializeGroupTemplate } from "../client/src/canvas/groupTemplate";
import { openAppDatabase } from "../server/database";
import {
  deleteUserTemplate,
  listUserTemplates,
  saveUserTemplate,
  type UserTemplateCard,
} from "../server/templateCatalog";

function templateGraph(overrides: {
  edgeCount?: number;
  nodeCount?: number;
  nodeType?: string;
} = {}) {
  const nodeCount = overrides.nodeCount ?? 2;
  const nodeType = overrides.nodeType ?? "text";
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    data: { label: index === 0 ? "Text" : "Image", title: `节点${index + 1}` },
    id: `node-${index + 1}`,
    position: { x: 20 + index * 300, y: 40 },
    style: { height: 250, width: 250 },
    type: index === 0 && nodeType === "text" ? "text" : nodeType,
    zIndex: 1,
  }));
  const edges = Array.from(
    { length: overrides.edgeCount ?? 1 },
    (_, index) => ({
      id: `edge-${index + 1}`,
      source: `node-${index + 1}`,
      sourceHandle: "source",
      target: `node-${index + 2}`,
      targetHandle: "target",
      type: "cuttable",
    }),
  );
  return { edges, nodes, version: 1 };
}

function makeNode(
  id: string,
  type: ProbeNodeType["type"],
  data: ProbeNodeType["data"],
  position: { x: number; y: number },
  parentId?: string,
): ProbeNodeType {
  return {
    data,
    id,
    parentId,
    position,
    style: { height: 250, width: 250 },
    type,
    zIndex: 1,
  };
}

async function saveTemplate(request: APIRequestContext, title: string) {
  const response = await request.post("/api/templates", {
    data: {
      category: "电商",
      graph: templateGraph(),
      title,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { template: UserTemplateCard };
  return body.template;
}

test("user template API saves, pages, searches and deletes private templates", async ({
  request,
}) => {
  const first = await saveTemplate(request, "我的电商模板");
  const second = await saveTemplate(request, "我的视频模板");
  expect(first.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(first.title).toBe("我的电商模板");
  expect(first.categories).toEqual(["电商"]);
  expect(first.graph).toBeUndefined();

  const mine = await request.get(
    "/api/templates?space=mine&q=电商&limit=10&offset=0&includeGraph=false",
  );
  expect(mine.ok()).toBeTruthy();
  const mineBody = (await mine.json()) as {
    items: UserTemplateCard[];
    pagination: { total: number };
  };
  expect(mineBody.items.map((item) => item.id)).toEqual([first.id]);
  expect(mineBody.pagination.total).toBe(1);

  const mineGraph = await request.get(
    "/api/templates?space=mine&q=视频&limit=10&offset=0&includeGraph=true",
  );
  expect(mineGraph.ok()).toBeTruthy();
  const mineGraphBody = (await mineGraph.json()) as {
    items: Array<{
      graph: { nodes: unknown[]; version: number };
      id: string;
    }>;
  };
  expect(mineGraphBody.items[0].id).toBe(second.id);
  expect(mineGraphBody.items[0].graph.version).toBe(1);
  expect(mineGraphBody.items[0].graph.nodes).toHaveLength(2);

  const publicBody = (await (await request.get(
    "/api/templates?space=public&limit=100",
  )).json()) as { items: Array<{ id: string }> };
  expect(publicBody.items.some((item) => item.id === first.id)).toBeFalsy();
  expect(publicBody.items.some((item) => item.id === second.id)).toBeFalsy();

  const deleted = await request.delete(`/api/templates/${first.id}`);
  expect(deleted.status()).toBe(200);
  const missing = await request.delete(`/api/templates/${first.id}`);
  expect(missing.status()).toBe(404);
  const afterDelete = await request.get(
    "/api/templates?space=mine&limit=100&offset=0",
  );
  const afterBody = (await afterDelete.json()) as {
    items: Array<{ id: string }>;
  };
  expect(afterBody.items.map((item) => item.id)).toEqual([second.id]);
});

test("user template API rejects invalid titles, categories and graph shapes", async ({
  request,
}) => {
  for (const body of [
    { graph: templateGraph(), title: "" },
    { graph: templateGraph(), title: "x".repeat(41) },
    { graph: templateGraph(), title: "合法标题", category: "不存在的分类" },
    {
      graph: templateGraph({ nodeType: "probe" }),
      title: "非法节点类型",
    },
    {
      graph: templateGraph({ edgeCount: 2, nodeCount: 3 }),
      title: "边越界",
      edgeLimit: true,
    } as Record<string, unknown>,
    {
      graph: templateGraph({ nodeCount: 501 }),
      title: "节点超限",
    },
  ]) {
    if ("edgeLimit" in body) {
      const graph = body.graph as {
        edges: Array<{ id: string; source: string; target: string }>;
      };
      graph.edges = Array.from({ length: 1001 }, (_, index) => ({
        id: `edge-${index}`,
        source: `node-1`,
        target: `node-2`,
      }));
    }
    const response = await request.post("/api/templates", { data: body });
    expect(response.status(), JSON.stringify(body)).toBe(400);
  }
});

test("user templates are owner-isolated at the data layer", () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-template-isolation-"));
  const store = openAppDatabase(directory);
  try {
    const timestamp = new Date().toISOString();
    for (const id of ["user-a", "user-b"]) {
      store
        .prepare(`
          INSERT INTO users (
            id, login_name, display_name, password_hash, role, status,
            created_at, updated_at
          )
          VALUES (?, ?, ?, 'test-only', 'user', 'active', ?, ?)
        `)
        .run(id, id, id, timestamp, timestamp);
    }
    const savedA = saveUserTemplate(store, "user-a", {
      category: "电商",
      graph: templateGraph(),
      title: "A 的模板",
    });
    const savedB = saveUserTemplate(store, "user-b", {
      graph: templateGraph(),
      title: "B 的模板",
    });

    const listA = listUserTemplates(store, "user-a", {
      category: "全部",
      limit: 100,
      offset: 0,
      query: "",
    });
    expect(listA.total).toBe(1);
    expect(listA.rows[0].id).toBe(savedA.id);

    const listB = listUserTemplates(store, "user-b", {
      category: "全部",
      limit: 100,
      offset: 0,
      query: "",
    });
    expect(listB.rows.map((row) => row.id)).toEqual([savedB.id]);

    expect(deleteUserTemplate(store, "user-b", savedA.id)).toBeFalsy();
    expect(deleteUserTemplate(store, "user-a", savedA.id)).toBeTruthy();
    expect(
      listUserTemplates(store, "user-a", {
        category: "全部",
        limit: 100,
        offset: 0,
        query: "",
      }).total,
    ).toBe(0);
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("template cover follows generation result then graph asset then gradient", async ({
  request,
}) => {
  const dataDirectoryResponse = await request.get("/api/test-data-directory");
  expect(dataDirectoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = (await dataDirectoryResponse.json()) as {
    dataDirectory: string;
  };
  const store = openAppDatabase(dataDirectory);
  const timestamp = new Date().toISOString();
  try {
    store
      .prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at
        )
        VALUES ('image', 'cover-task-image', '__test__', 'cover-task-image.png', 100, ?, ?)
      `)
      .run(timestamp, timestamp);
    store
      .prepare(`
        INSERT INTO generation_tasks (
          id, canvas_id, node_id, kind, prompt, model, parameters,
          idempotency_key, request_fingerprint, state, attempt, owner_id,
          result_asset_id, created_at, updated_at
        )
        VALUES (
          'cover-task', 'cover-canvas', 'node-2', 'image', 'prompt', 'model-1',
          '{}', 'cover-key', 'cover-fingerprint', 'success', 1, '__test__',
          'cover-task-image', ?, ?
        )
      `)
      .run(timestamp, timestamp);
  } finally {
    store.close();
  }

  const fromTask = await request.post("/api/templates", {
    data: {
      graph: templateGraph(),
      nodeIds: ["node-1", "node-2"],
      sourceCanvasId: "cover-canvas",
      title: "封面来自生成结果",
    },
  });
  expect(fromTask.status()).toBe(201);
  const fromTaskCard = (await fromTask.json()) as { template: UserTemplateCard };
  expect(fromTaskCard.template.previewImage).toBe("/api/assets/cover-task-image");
  expect(fromTaskCard.template.cover).toEqual({
    assetId: "cover-task-image",
    kind: "image",
  });

  const fromGraph = await request.post("/api/templates", {
    data: {
      graph: {
        edges: [],
        nodes: [
          {
            data: { assetId: "graph-asset", label: "Image", title: "素材图" },
            id: "asset-node",
            position: { x: 0, y: 0 },
            style: { height: 250, width: 250 },
            type: "image",
            zIndex: 1,
          },
        ],
        version: 1,
      },
      title: "封面来自素材",
    },
  });
  expect(fromGraph.status()).toBe(201);
  const fromGraphCard = (await fromGraph.json()) as { template: UserTemplateCard };
  expect(fromGraphCard.template.previewImage).toBe("/api/assets/graph-asset");

  const gradient = await saveTemplate(request, "封面占位渐变");
  expect(gradient.previewImage).toBeUndefined();
  expect(gradient.cover).toBeNull();
});

test("group template serializer keeps prompts, parameters, roles and durable media identities", () => {
  const group = makeNode(
    "group-1",
    "group",
    {
      groupColor: "rgba(239, 68, 68, 0.16)",
      groupTemplate: true,
      label: "Group",
      title: "电商组",
    },
    { x: 100, y: 80 },
  );
  const image = makeNode(
    "child-image",
    "image",
    {
      assetId: "asset-1",
      imageGenerating: true,
      imageGenerationInputKey: "run-1",
      imageGenerationTaskId: "task-1",
      imageParameters: { aspectRatio: "1:1", imageSize: "1K" },
      imagePrompt: "生成商品图",
      imagePromptReady: true,
      imageSrc: "/api/assets/asset-1",
      inputState: "ready",
      label: "Image",
      mediaByteSize: 1234,
      mediaContentType: "image/png",
      mediaDurationSeconds: undefined,
      mediaMetadataSource: "server",
      mediaMetadataStatus: "ready",
      mediaStorageBackend: "oss",
      title: "商品图",
    },
    { x: 20, y: 30 },
    "group-1",
  );
  const audio = makeNode(
    "child-audio",
    "audio",
    {
      assetId: "asset-2",
      audioGeneratedResult: true,
      audioGenerationInputKey: "run-2",
      audioParameters: { duration: 5 },
      audioPrompt: "背景音乐",
      audioPromptReady: true,
      audioSrc: "/api/audio-assets/asset-2",
      audioWaveform: [1, 2, 3],
      label: "Audio",
      mediaStorageBackend: "local",
      title: "音频",
    },
    { x: 320, y: 30 },
    "group-1",
  );
  const outside = makeNode(
    "outside",
    "text",
    { label: "Text", textPrompt: "外部文字" },
    { x: 800, y: 30 },
  );
  const internalEdge: CuttableEdge = {
    data: {
      animatedHighlight: true,
      cutIndicator: "click",
      flowAnimated: true,
      flowDirection: 1,
      inputOrder: 2,
      inputRole: "reference-image",
    },
    id: "edge-1",
    source: "child-image",
    sourceHandle: "source",
    target: "child-audio",
    targetHandle: "target",
    type: "cuttable",
  };
  const externalEdge: CuttableEdge = {
    id: "edge-2",
    source: "child-image",
    target: "outside",
    type: "cuttable",
  };

  const graph = serializeGroupTemplate({
    edges: [internalEdge, externalEdge],
    groupId: "group-1",
    nodes: [group, image, audio, outside],
  });

  expect(graph.version).toBe(1);
  expect(graph.nodes.map((node) => node.id)).toEqual([
    "group-1",
    "child-image",
    "child-audio",
  ]);
  expect(graph.nodes[0].position).toEqual({ x: 0, y: 0 });
  expect(graph.nodes[1].position).toEqual({ x: 20, y: 30 });
  expect(graph.nodes[1].parentId).toBe("group-1");
  expect(graph.edges.map((edge) => edge.id)).toEqual(["edge-1"]);
  expect(graph.edges[0].data).toEqual({
    inputOrder: 2,
    inputRole: "reference-image",
  });

  const savedImageData = graph.nodes[1].data;
  expect(savedImageData.imagePrompt).toBe("生成商品图");
  expect(savedImageData.imageParameters).toEqual({
    aspectRatio: "1:1",
    imageSize: "1K",
  });
  expect(savedImageData.assetId).toBe("asset-1");
  expect(savedImageData.mediaStorageBackend).toBe("oss");
  expect(savedImageData.mediaContentType).toBe("image/png");
  expect(savedImageData.mediaByteSize).toBe(1234);
  expect(savedImageData.mediaMetadataStatus).toBe("ready");
  for (const stripped of [
    "audioGeneratedResult",
    "audioGenerationInputKey",
    "audioSrc",
    "audioWaveform",
    "groupTemplate",
    "imageGenerationInputKey",
    "imageGenerationTaskId",
    "imageGenerating",
    "imageSrc",
    "inputState",
  ]) {
    expect(savedImageData[stripped]).toBeUndefined();
  }
  const savedAudioData = graph.nodes[2].data;
  expect(savedAudioData.audioPrompt).toBe("背景音乐");
  expect(savedAudioData.audioParameters).toEqual({ duration: 5 });
  expect(savedAudioData.assetId).toBe("asset-2");
  expect(savedAudioData.audioSrc).toBeUndefined();
  expect(savedAudioData.audioGeneratedResult).toBeUndefined();
  expect(savedAudioData.groupTemplate).toBeUndefined();
  expect(graph.nodes[0].data.groupColor).toBe("rgba(239, 68, 68, 0.16)");
  expect(graph.nodes[0].data.groupTemplate).toBeUndefined();
});

test("group template serializer rejects missing groups and probe children", () => {
  const group = makeNode(
    "group-1",
    "group",
    { label: "Group", title: "组" },
    { x: 0, y: 0 },
  );
  const probe = makeNode(
    "probe-child",
    "probe",
    { label: "Probe" },
    { x: 10, y: 10 },
    "group-1",
  );
  expect(() =>
    serializeGroupTemplate({
      edges: [],
      groupId: "missing",
      nodes: [group, probe],
    }),
  ).toThrow("未找到要保存的组");
  expect(() =>
    serializeGroupTemplate({
      edges: [],
      groupId: "group-1",
      nodes: [group, probe],
    }),
  ).toThrow("测试节点");
});

test("private templates accept all seven importable node types", async ({
  request,
}) => {
  const nodes = [
    {
      data: { label: "Group", title: "混合组" },
      id: "group-1",
      position: { x: 0, y: 0 },
      style: { height: 700, width: 1100 },
      type: "group",
      zIndex: 0,
    },
    {
      data: { label: "Audio", title: "音频" },
      id: "node-audio",
      parentId: "group-1",
      position: { x: 10, y: 10 },
      style: { height: 250, width: 444 },
      type: "audio",
      zIndex: 1,
    },
    {
      data: { label: "Image", title: "图片" },
      id: "node-image",
      parentId: "group-1",
      position: { x: 470, y: 10 },
      style: { height: 250, width: 250 },
      type: "image",
      zIndex: 1,
    },
    {
      data: { label: "Playlist", title: "播放列表" },
      id: "node-playlist",
      parentId: "group-1",
      position: { x: 10, y: 280 },
      style: { height: 104, width: 960 },
      type: "playlist",
      zIndex: 1,
    },
    {
      data: { label: "Storyboard", title: "分镜" },
      id: "node-storyboard",
      parentId: "group-1",
      position: { x: 10, y: 410 },
      style: { height: 1000, width: 1200 },
      type: "storyboard",
      zIndex: 1,
    },
    {
      data: { label: "Text", title: "文字" },
      id: "node-text",
      parentId: "group-1",
      position: { x: 10, y: 1430 },
      style: { height: 250, width: 250 },
      type: "text",
      zIndex: 1,
    },
    {
      data: { label: "Video", title: "视频" },
      id: "node-video",
      parentId: "group-1",
      position: { x: 10, y: 1700 },
      style: { height: 250, width: 444 },
      type: "video",
      zIndex: 1,
    },
  ];
  const edges = [
    {
      id: "edge-audio-image",
      source: "node-audio",
      target: "node-image",
      type: "cuttable",
    },
    {
      id: "edge-text-video",
      source: "node-text",
      target: "node-video",
      type: "cuttable",
    },
  ];
  const saved = await request.post("/api/templates", {
    data: {
      category: "影视",
      graph: { edges, nodes, version: 1 },
      title: "七类型模板",
    },
  });
  expect(saved.status()).toBe(201);
  const card = (await saved.json()) as { template: UserTemplateCard };

  const listed = await request.get(
    `/api/templates?space=mine&q=${encodeURIComponent("七类型")}&limit=10&includeGraph=true`,
  );
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as {
    items: Array<{
      graph: {
        nodes: Array<{ type: string }>;
      };
    }>;
  };
  const nodeTypes = body.items[0].graph.nodes.map((node) => node.type).sort();
  expect(nodeTypes).toEqual([
    "audio",
    "group",
    "image",
    "playlist",
    "storyboard",
    "text",
    "video",
  ]);
  await request.delete(`/api/templates/${card.template.id}`);
});

test("group toolbar saves a private template and the my-templates panel lists and deletes it", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  const saved = await request.put(`/api/canvas/${project.id}`, {
    data: {
      edges: [
        {
          id: "edge-1",
          source: "child-text",
          sourceHandle: "source",
          target: "child-image",
          targetHandle: "target",
          type: "cuttable",
        },
      ],
      nodes: [
        {
          data: { label: "Group", title: "模板组" },
          id: "group-1",
          position: { x: 100, y: 100 },
          style: { height: 350, width: 700 },
          type: "group",
          zIndex: 0,
        },
        {
          data: {
            label: "Text",
            textPrompt: "商品描述",
            textPromptReady: true,
            title: "文案",
          },
          id: "child-text",
          parentId: "group-1",
          position: { x: 20, y: 20 },
          style: { height: 250, width: 250 },
          type: "text",
          zIndex: 1,
        },
        {
          data: {
            imagePrompt: "商品图",
            imagePromptReady: true,
            label: "Image",
            title: "图片",
          },
          id: "child-image",
          parentId: "group-1",
          position: { x: 300, y: 20 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        },
      ],
      revision: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page
    .locator('[data-testid="rf__node-group-1"]')
    .click({ position: { x: 5, y: 5 } });
  await page.getByTestId("group-template-button").click();
  await page.getByLabel("模板标题").fill("从画布保存的模板");
  await page.getByTestId("group-template-submit").click();
  await expect(page.getByTestId("workflow-run-toast")).toContainText(
    "模板已保存到我的模板",
  );

  await page.getByTestId("templates").click();
  const panel = page.getByTestId("templates-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "我的模板" }).click();
  const card = panel.getByText("从画布保存的模板", { exact: true });
  await expect(card).toBeVisible();

  await panel.getByRole("button", { name: "浏览全部" }).click();
  const browser = page.getByTestId("template-browser");
  await expect(browser).toBeVisible();
  const browserCard = browser
    .locator(".template-browser-card")
    .filter({ hasText: "从画布保存的模板" });
  // 回归：浏览全部侧栏的「我的模板」是筛选桶，必须显示本人全部模板，
  // 不能按字面分类「我的模板」过滤为空。
  const sidebar = browser.locator(".template-browser-sidebar");
  await sidebar.getByRole("button", { name: "我的模板", exact: true }).click();
  await expect(browserCard).toBeVisible();
  await sidebar.getByRole("button", { name: /^全部/ }).click();
  await expect(browserCard).toBeVisible();
  const browserDelete = browserCard.getByRole("button", {
    name: "删除模板 从画布保存的模板",
  });
  await expect(browserDelete).toBeAttached();
  await expect(browserDelete).toBeEnabled();
  await expect(browserDelete).toHaveCSS("opacity", "0");
  await browserCard.hover();
  await expect(browserDelete).toHaveCSS("opacity", "1");
  await browser.getByRole("button", { name: "关闭全部模板" }).click();
  await expect(browser).toHaveCount(0);

  await panel
    .locator(".template-card")
    .filter({ hasText: "从画布保存的模板" })
    .hover();
  const deleteButton = panel
    .locator(".template-card")
    .filter({ hasText: "从画布保存的模板" })
    .getByRole("button", { name: "删除模板 从画布保存的模板" });
  await deleteButton.click();
  await expect(card).toHaveCount(0);

  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("group toolbar keeps template saving disabled for empty groups", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  const saved = await request.put(`/api/canvas/${project.id}`, {
    data: {
      edges: [],
      nodes: [
        {
          data: { label: "Group", title: "空组" },
          id: "group-empty",
          position: { x: 100, y: 100 },
          style: { height: 300, width: 500 },
          type: "group",
          zIndex: 0,
        },
      ],
      revision: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.getByTestId("group-node-group-empty").click();
  await expect(page.getByTestId("group-template-button")).toBeDisabled();
  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});

test("importing a private template renders its image asset without a manual refresh", async ({
  page,
  request,
}) => {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploaded = await request.post("/api/assets/hydrate-image", {
    data: onePixelPng,
    headers: { "Content-Type": "image/png" },
  });
  expect(uploaded.status()).toBe(201);

  const sourceProject = (await (await request.post("/api/projects", { data: {} }))
    .json()) as { id: string };
  const saved = await request.post("/api/templates", {
    data: {
      category: "电商",
      graph: {
        edges: [],
        nodes: [
          {
            data: { label: "Group", title: "素材模板组" },
            id: "hydrate-group",
            position: { x: 0, y: 0 },
            style: { height: 350, width: 700 },
            type: "group",
            zIndex: 0,
          },
          {
            data: {
              assetId: "hydrate-image",
              label: "Image",
              title: "模板素材图",
            },
            id: "hydrate-image-node",
            parentId: "hydrate-group",
            position: { x: 20, y: 20 },
            style: { height: 250, width: 250 },
            type: "image",
            zIndex: 1,
          },
          {
            data: { label: "Text", title: "说明", textPrompt: "说明文字" },
            id: "hydrate-text-node",
            parentId: "hydrate-group",
            position: { x: 300, y: 20 },
            style: { height: 250, width: 250 },
            type: "text",
            zIndex: 1,
          },
        ],
        version: 1,
      },
      title: "素材引用导入模板",
    },
  });
  expect(saved.status()).toBe(201);

  const targetProject = (await (await request.post("/api/projects", { data: {} }))
    .json()) as { id: string };
  await page.goto(`/canvas/${targetProject.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await page.getByTestId("templates").click();
  const panel = page.getByTestId("templates-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "我的模板" }).click();
  await panel.getByText("素材引用导入模板", { exact: true }).click();

  const importedImage = page.locator(".react-flow__node-image img").first();
  await expect(importedImage).toHaveAttribute(
    "src",
    /\/api\/assets\/hydrate-image/,
  );
  await page.reload();
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  await expect(page.locator(".react-flow__node-image img").first())
    .toHaveAttribute("src", /\/api\/assets\/hydrate-image/);

  await request.delete(`/api/canvas/${targetProject.id}`);
  await request.delete(`/api/projects/${targetProject.id}`);
  await request.delete(`/api/canvas/${sourceProject.id}`);
  await request.delete(`/api/projects/${sourceProject.id}`);
});

test("dragging a real canvas node saves after drag stop, not during the drag", async ({
  page,
  request,
}) => {
  const writes: string[] = [];
  page.on("request", (event) => {
    if (event.method() === "PUT" && /\/api\/canvas\//.test(event.url())) {
      writes.push(event.url());
    }
  });
  const created = await request.post("/api/projects", { data: {} });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };
  const saved = await request.put(`/api/canvas/${project.id}`, {
    data: {
      edges: [],
      nodes: [
        {
          data: { label: "Text", textPrompt: "拖拽保存", textPromptReady: true, title: "拖拽保存" },
          id: "drag-save-node",
          position: { x: 120, y: 120 },
          style: { height: 250, width: 250 },
          type: "text",
          zIndex: 1,
        },
      ],
      revision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto(`/canvas/${project.id}`);
  await expect(page.getByTestId("canvas-world")).toHaveAttribute(
    "data-persistence-ready",
    "true",
  );
  writes.length = 0;

  const node = page.locator(".react-flow__node").first();
  const box = await node.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(startX + step * 4, startY + step * 2, { steps: 1 });
    await page.waitForTimeout(20);
  }
  // 连续拖动期间不得写库（交互安静期生效）。
  expect(writes).toEqual([]);
  await page.mouse.up();

  await expect.poll(() => writes.length).toBeGreaterThan(0);
  await request.delete(`/api/canvas/${project.id}`);
  await request.delete(`/api/projects/${project.id}`);
});
