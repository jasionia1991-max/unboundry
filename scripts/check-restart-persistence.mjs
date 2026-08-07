import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = await mkdtemp(join(tmpdir(), "unboundry-restart-p1-"));
const databasePath = join(dataDir, "unboundry.sqlite");
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");

async function chooseIsolatedPort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not allocate an isolated test port"));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

const port = await chooseIsolatedPort();
assert.notEqual(port, 4173, "Restart check must never use the user's development port");
const origin = `http://127.0.0.1:${port}`;

async function start() {
  const child = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDir,
        UNBOUNDRY_TEST_AUTH_BYPASS: "1",
      },
      stdio: "ignore",
    },
  );
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited before becoming ready (${child.exitCode})`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop(child);
  throw new Error("Test server did not start");
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const forceStop = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2_000);
  try {
    await exited;
  } finally {
    clearTimeout(forceStop);
  }
}

async function jsonRequest(path, init) {
  const response = await fetch(`${origin}${path}`, init);
  assert.equal(
    response.status,
    200,
    `${init?.method ?? "GET"} ${path} returned ${response.status}`,
  );
  return response.json();
}

async function generationStatus() {
  const status = await jsonRequest("/api/generation-tasks/status");
  assert.equal(status.paidProviderRequests, 0);
  return status;
}

function databaseGenerationCounts() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tasks = database
      .prepare("SELECT COUNT(*) AS count FROM generation_tasks")
      .get().count;
    const events = database
      .prepare("SELECT COUNT(*) AS count FROM generation_task_events")
      .get().count;
    const paidProviderRequests = database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM generation_tasks
        WHERE provider_profile_id IS NOT NULL AND attempt > 0
      `)
      .get().count;
    return { events, paidProviderRequests, tasks };
  } finally {
    database.close();
  }
}

function assertP1Graph(document, expected) {
  assert.equal(document.nodes.length, 3, "P1 graph must contain exactly three nodes");
  assert.equal(document.edges.length, 2, "P1 graph must contain exactly two edges");
  assert.deepEqual(document.nodes, expected.nodes);
  assert.deepEqual(document.edges, expected.edges);
  assert.deepEqual(document.viewport, expected.viewport);

  const nodeIds = document.nodes.map((node) => node.id);
  const edgeIds = document.edges.map((edge) => edge.id);
  assert.equal(new Set(nodeIds).size, nodeIds.length, "Node IDs must stay unique");
  assert.equal(new Set(edgeIds).size, edgeIds.length, "Edge IDs must stay unique");
  const knownNodeIds = new Set(nodeIds);
  for (const edge of document.edges) {
    assert.ok(knownNodeIds.has(edge.source), `Missing source endpoint: ${edge.source}`);
    assert.ok(knownNodeIds.has(edge.target), `Missing target endpoint: ${edge.target}`);
    assert.equal(edge.target, "p1-restart-target-image");
  }

  const textNode = document.nodes.find((node) => node.id === "p1-restart-source-text");
  assert.equal(textNode.data.content, "电商白底图提示词母版正文");
  assert.equal(textNode.data.textPrompt, "只属于文字节点生成框的独立提示词");
  assert.notEqual(textNode.data.content, textNode.data.textPrompt);
  const imageNode = document.nodes.find((node) => node.id === "p1-restart-source-image");
  assert.equal(imageNode.data.assetId, "asset-p1-garment-photo");
  assert.equal(
    imageNode.data.imageSrc,
    "/api/assets/asset-p1-garment-photo",
    "A durable asset ID must hydrate to its stable internal media route",
  );
  assert.deepEqual(
    document.edges.map((edge) => ({
      id: edge.id,
      inputOrder: edge.data.inputOrder,
      inputRole: edge.data.inputRole,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        id: "p1-restart-text-to-image",
        inputOrder: 1,
        inputRole: "instruction",
        source: "p1-restart-source-text",
        target: "p1-restart-target-image",
      },
      {
        id: "p1-restart-image-to-image",
        inputOrder: 2,
        inputRole: "reference-image",
        source: "p1-restart-source-image",
        target: "p1-restart-target-image",
      },
    ],
  );

  const serialized = JSON.stringify({ edges: document.edges, nodes: document.nodes });
  assert.doesNotMatch(serialized, /https?:\/\/|blob:|data:|[?&](?:x-oss-|signature=)/i);
  assert.doesNotMatch(serialized, /"signedUrl"/i);
}

function assertP1UndoGraph(document, expected) {
  assert.equal(document.nodes.length, 3, "Restored P1 graph must contain exactly three nodes");
  assert.equal(document.edges.length, 2, "Restored P1 graph must contain exactly two edges");
  assert.deepEqual(document.nodes, expected.nodes);
  assert.deepEqual(document.edges, expected.edges);
  assert.deepEqual(document.viewport, expected.viewport);

  const nodeIds = document.nodes.map((node) => node.id);
  const edgeIds = document.edges.map((edge) => edge.id);
  assert.equal(new Set(nodeIds).size, nodeIds.length, "Restored node IDs must stay unique");
  assert.equal(new Set(edgeIds).size, edgeIds.length, "Restored edge IDs must stay unique");
  const textNodes = document.nodes.filter((node) => node.type === "text");
  assert.equal(textNodes.length, 1, "Undo must restore exactly one Text source");
  const textNode = textNodes[0];
  const target = document.nodes.find((node) => node.id === "p1-restart-target-image");
  assert.equal(
    `${textNode.data.content}\n\n${target.data.imagePrompt}`,
    "电商白底图提示词母版正文\n\n本节点补充：保持服装原有版型",
    "Restored graph must still compose the same final Prompt",
  );
  const textEdges = document.edges.filter((edge) => edge.source === textNode.id);
  assert.equal(textEdges.length, 1, "Undo must restore exactly one remapped Text edge");
  assert.equal(textEdges[0].target, "p1-restart-target-image");
  assert.equal(textEdges[0].data.inputOrder, 1);
  assert.equal(textEdges[0].data.inputRole, "instruction");
  const snapshot = document.edges
    .slice()
    .sort((left, right) => left.data.inputOrder - right.data.inputOrder)
    .map((edge) => {
      const source = document.nodes.find((node) => node.id === edge.source);
      return {
        ...(source.type === "image" ? { assetId: source.data.assetId } : {}),
        kind: source.type,
        order: edge.data.inputOrder,
        role: edge.data.inputRole,
        sourceNodeId: source.id,
      };
    });
  assert.deepEqual(snapshot, [
    {
      kind: "text",
      order: 1,
      role: "instruction",
      sourceNodeId: "p1-restart-source-text-restored-1",
    },
    {
      assetId: "asset-p1-garment-photo",
      kind: "image",
      order: 2,
      role: "reference-image",
      sourceNodeId: "p1-restart-source-image",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /https?:|signed|signature/i);
}

function assertP3VideoGraph(document, expected) {
  assert.equal(document.nodes.length, 5, "P3 Video graph must contain exactly five nodes");
  assert.equal(document.edges.length, 4, "P3 Video graph must contain exactly four edges");
  assert.deepEqual(document.nodes, expected.nodes);
  assert.deepEqual(document.edges, expected.edges);
  assert.deepEqual(document.viewport, expected.viewport);

  const nodeIds = document.nodes.map((node) => node.id);
  const edgeIds = document.edges.map((edge) => edge.id);
  assert.equal(new Set(nodeIds).size, nodeIds.length, "P3 node IDs must stay unique");
  assert.equal(new Set(edgeIds).size, edgeIds.length, "P3 edge IDs must stay unique");
  const knownNodeIds = new Set(nodeIds);
  for (const edge of document.edges) {
    assert.ok(knownNodeIds.has(edge.source), `Missing P3 source endpoint: ${edge.source}`);
    assert.ok(knownNodeIds.has(edge.target), `Missing P3 target endpoint: ${edge.target}`);
    assert.equal(edge.target, "p3-restart-target-video");
  }

  assert.deepEqual(
    document.edges.map((edge) => ({
      id: edge.id,
      inputOrder: edge.data.inputOrder,
      inputRole: edge.data.inputRole,
      source: edge.source,
      target: edge.target,
    })),
    [
      {
        id: "p3-restart-text-to-video",
        inputOrder: 1,
        inputRole: "instruction",
        source: "p3-restart-source-text",
        target: "p3-restart-target-video",
      },
      {
        id: "p3-restart-image-to-video",
        inputOrder: 2,
        inputRole: "subject",
        source: "p3-restart-source-image",
        target: "p3-restart-target-video",
      },
      {
        id: "p3-restart-video-to-video",
        inputOrder: 3,
        inputRole: "reference-video",
        source: "p3-restart-source-video",
        target: "p3-restart-target-video",
      },
      {
        id: "p3-restart-audio-to-video",
        inputOrder: 4,
        inputRole: "reference-audio",
        source: "p3-restart-source-audio",
        target: "p3-restart-target-video",
      },
    ],
  );

  const target = document.nodes.find((node) => node.id === "p3-restart-target-video");
  assert.equal(target.data.videoPrompt, "本节点补充：镜头缓慢环绕主体");
  assert.equal(target.data.videoParameters.inputMode, "multimodal");

  const serializedGraph = JSON.stringify({ edges: document.edges, nodes: document.nodes });
  assert.doesNotMatch(
    serializedGraph,
    /https?:\/\/|blob:|data:|[?&](?:x-oss-|signature=)|"signedUrl"/i,
  );

  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const snapshot = document.edges.map((edge) => {
    const source = nodesById.get(edge.source);
    assert.ok(source, `Missing P3 snapshot source: ${edge.source}`);
    return {
      ...(source.type === "text" ? {} : { assetId: source.data.assetId }),
      kind: source.type,
      order: edge.data.inputOrder,
      role: edge.data.inputRole,
      sourceNodeId: edge.source,
    };
  });
  assert.deepEqual(snapshot, [
    {
      kind: "text",
      order: 1,
      role: "instruction",
      sourceNodeId: "p3-restart-source-text",
    },
    {
      assetId: "asset-p3-reference-image",
      kind: "image",
      order: 2,
      role: "subject",
      sourceNodeId: "p3-restart-source-image",
    },
    {
      assetId: "asset-p3-reference-video",
      kind: "video",
      order: 3,
      role: "reference-video",
      sourceNodeId: "p3-restart-source-video",
    },
    {
      assetId: "asset-p3-reference-audio",
      kind: "audio",
      order: 4,
      role: "reference-audio",
      sourceNodeId: "p3-restart-source-audio",
    },
  ]);
  const serializedSnapshot = JSON.stringify(snapshot);
  assert.doesNotMatch(serializedSnapshot, /https?:\/\/|blob:|data:|signed|signature/i);
  assert.doesNotMatch(serializedSnapshot, /(?:imageSrc|videoSrc|audioSrc|signedUrl)/i);
}

const canvasId = "restart-p1-text-image-input";
const canvas = {
  revision: 0,
  saveSequence: 1,
  saveSessionId: "restart-p1-session",
  viewport: { x: 21, y: 34, zoom: 0.8 },
  nodes: [
    {
      id: "p1-restart-source-text",
      type: "text",
      position: { x: 80, y: 80 },
      data: {
        content: "电商白底图提示词母版正文",
        textPrompt: "只属于文字节点生成框的独立提示词",
        title: "白底图提示词母版",
      },
    },
    {
      id: "p1-restart-source-image",
      type: "image",
      position: { x: 80, y: 380 },
      data: {
        assetId: "asset-p1-garment-photo",
        inputState: "ready",
        title: "服装照片",
      },
    },
    {
      id: "p1-restart-target-image",
      type: "image",
      position: { x: 520, y: 220 },
      data: {
        imagePrompt: "本节点补充：保持服装原有版型",
        title: "商品白底图",
      },
    },
  ],
  edges: [
    {
      id: "p1-restart-text-to-image",
      source: "p1-restart-source-text",
      sourceHandle: "source",
      target: "p1-restart-target-image",
      targetHandle: "target",
      type: "cuttable",
      data: { inputOrder: 1, inputRole: "instruction" },
    },
    {
      id: "p1-restart-image-to-image",
      source: "p1-restart-source-image",
      sourceHandle: "source",
      target: "p1-restart-target-image",
      targetHandle: "target",
      type: "cuttable",
      data: { inputOrder: 2, inputRole: "reference-image" },
    },
  ],
};

const persistedCanvas = {
  ...canvas,
  nodes: canvas.nodes.map((node) => node.id === "p1-restart-source-image"
    ? {
        ...node,
        data: {
          ...node.data,
          imageSrc: "/api/assets/asset-p1-garment-photo",
        },
      }
    : node),
};

const undoCanvasId = "restart-p1-text-delete-undo";
const undoRestoredCanvas = {
  ...canvas,
  revision: 2,
  saveSequence: 3,
  nodes: canvas.nodes.map((node) => node.id === "p1-restart-source-text"
    ? { ...node, id: "p1-restart-source-text-restored-1" }
    : node),
  edges: canvas.edges.map((edge) => edge.id === "p1-restart-text-to-image"
    ? {
        ...edge,
        id: "p1-restart-text-to-image-restored-1-0",
        source: "p1-restart-source-text-restored-1",
      }
    : edge),
};
const undoRestoredExpected = {
  ...undoRestoredCanvas,
  nodes: undoRestoredCanvas.nodes.map((node) => node.id === "p1-restart-source-image"
    ? {
        ...node,
        data: {
          ...node.data,
          imageSrc: "/api/assets/asset-p1-garment-photo",
        },
      }
    : node),
};

const p3CanvasId = "restart-p3-video-multimodal-input";
const p3Canvas = {
  revision: 0,
  saveSequence: 1,
  saveSessionId: "restart-p3-session",
  viewport: { x: -42, y: 18, zoom: 0.72 },
  nodes: [
    {
      id: "p3-restart-source-text",
      type: "text",
      position: { x: 60, y: 60 },
      data: {
        content: "上游文字：保持商品主体清晰并使用柔和光线",
        title: "视频生成指令",
      },
    },
    {
      id: "p3-restart-source-image",
      type: "image",
      position: { x: 60, y: 260 },
      data: {
        assetId: "asset-p3-reference-image",
        imageSrc: "/api/assets/asset-p3-reference-image",
        title: "主体参考图",
      },
    },
    {
      id: "p3-restart-source-video",
      type: "video",
      position: { x: 60, y: 500 },
      data: {
        assetId: "asset-p3-reference-video",
        title: "动作参考视频",
        videoSrc: "/api/video-assets/asset-p3-reference-video",
      },
    },
    {
      id: "p3-restart-source-audio",
      type: "audio",
      position: { x: 60, y: 740 },
      data: {
        assetId: "asset-p3-reference-audio",
        audioSrc: "/api/audio-assets/asset-p3-reference-audio",
        title: "节奏参考音频",
      },
    },
    {
      id: "p3-restart-target-video",
      type: "video",
      position: { x: 560, y: 340 },
      data: {
        title: "P3 四类上游目标视频",
        videoParameters: { inputMode: "multimodal" },
        videoPrompt: "本节点补充：镜头缓慢环绕主体",
      },
    },
  ],
  edges: [
    {
      id: "p3-restart-text-to-video",
      source: "p3-restart-source-text",
      sourceHandle: "source",
      target: "p3-restart-target-video",
      targetHandle: "target",
      type: "cuttable",
      data: { inputOrder: 1, inputRole: "instruction" },
    },
    {
      id: "p3-restart-image-to-video",
      source: "p3-restart-source-image",
      sourceHandle: "source",
      target: "p3-restart-target-video",
      targetHandle: "target",
      type: "cuttable",
      data: { inputOrder: 2, inputRole: "subject" },
    },
    {
      id: "p3-restart-video-to-video",
      source: "p3-restart-source-video",
      sourceHandle: "source",
      target: "p3-restart-target-video",
      targetHandle: "target",
      type: "cuttable",
      data: { inputOrder: 3, inputRole: "reference-video" },
    },
    {
      id: "p3-restart-audio-to-video",
      source: "p3-restart-source-audio",
      sourceHandle: "source",
      target: "p3-restart-target-video",
      targetHandle: "target",
      type: "cuttable",
      data: { inputOrder: 4, inputRole: "reference-audio" },
    },
  ],
};

let server;
try {
  server = await start();
  await generationStatus();
  assert.deepEqual(databaseGenerationCounts(), {
    events: 0,
    paidProviderRequests: 0,
    tasks: 0,
  });

  const saved = await jsonRequest(`/api/canvas/${canvasId}`, {
    body: JSON.stringify(canvas),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  assert.equal(saved.revision, 1);
  const beforeRestart = await jsonRequest(`/api/canvas/${canvasId}`);
  assert.equal(beforeRestart.revision, 1);
  assertP1Graph(beforeRestart, persistedCanvas);
  await generationStatus();
  assert.deepEqual(databaseGenerationCounts(), {
    events: 0,
    paidProviderRequests: 0,
    tasks: 0,
  });

  const undoInitial = await jsonRequest(`/api/canvas/${undoCanvasId}`, {
    body: JSON.stringify(canvas),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  assert.equal(undoInitial.revision, 1);
  const undoDeleted = await jsonRequest(`/api/canvas/${undoCanvasId}`, {
    body: JSON.stringify({
      ...canvas,
      revision: 1,
      saveSequence: 2,
      nodes: canvas.nodes.filter((node) => node.id !== "p1-restart-source-text"),
      edges: canvas.edges.filter((edge) => edge.source !== "p1-restart-source-text"),
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  assert.equal(undoDeleted.revision, 2);
  const afterDelete = await jsonRequest(`/api/canvas/${undoCanvasId}`);
  assert.equal(afterDelete.nodes.length, 2);
  assert.equal(afterDelete.edges.length, 1);
  const undoRestored = await jsonRequest(`/api/canvas/${undoCanvasId}`, {
    body: JSON.stringify(undoRestoredCanvas),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  assert.equal(undoRestored.revision, 3);
  const beforeUndoRestart = await jsonRequest(`/api/canvas/${undoCanvasId}`);
  assertP1UndoGraph(beforeUndoRestart, undoRestoredExpected);
  await generationStatus();
  assert.deepEqual(databaseGenerationCounts(), {
    events: 0,
    paidProviderRequests: 0,
    tasks: 0,
  });

  const p3Saved = await jsonRequest(`/api/canvas/${p3CanvasId}`, {
    body: JSON.stringify(p3Canvas),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  assert.equal(p3Saved.revision, 1);
  const p3BeforeRestart = await jsonRequest(`/api/canvas/${p3CanvasId}`);
  assert.equal(p3BeforeRestart.revision, 1);
  assertP3VideoGraph(p3BeforeRestart, p3Canvas);
  await generationStatus();
  assert.deepEqual(databaseGenerationCounts(), {
    events: 0,
    paidProviderRequests: 0,
    tasks: 0,
  });

  for (let restartNumber = 1; restartNumber <= 2; restartNumber += 1) {
    await stop(server);
    server = await start();

    const restored = await jsonRequest(`/api/canvas/${canvasId}`);
    assert.equal(restored.revision, 1, `P1 revision changed after restart ${restartNumber}`);
    assertP1Graph(restored, persistedCanvas);
    const undoAfterRestart = await jsonRequest(`/api/canvas/${undoCanvasId}`);
    assert.equal(
      undoAfterRestart.revision,
      3,
      `P1 delete/undo revision changed after restart ${restartNumber}`,
    );
    assertP1UndoGraph(undoAfterRestart, undoRestoredExpected);
    const p3Restored = await jsonRequest(`/api/canvas/${p3CanvasId}`);
    assert.equal(p3Restored.revision, 1, `P3 revision changed after restart ${restartNumber}`);
    assertP3VideoGraph(p3Restored, p3Canvas);
    await generationStatus();
    assert.deepEqual(databaseGenerationCounts(), {
      events: 0,
      paidProviderRequests: 0,
      tasks: 0,
    });
  }
  console.log(
    "restart persistence: P1 undo-shaped remapped graph plus Text+Image and P3 Video graphs, cards, final Prompt, roles and order restored through two restarts; stable internal media routes only; zero generation tasks and zero Provider requests",
  );
} finally {
  if (server?.exitCode === null) await stop(server);
  await rm(dataDir, { force: true, recursive: true });
}
