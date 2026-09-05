import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./safe-test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  resolveNodeInputs,
  type NodeInputKind,
  type NodeInputRole,
} from "../types/nodeInputs";
import {
  knownModelParameterSchema,
  type ModelParameterSchema,
} from "../types/modelParameters";
import { openAppDatabase } from "../server/database";
import { resolvePersistedNodeInputs } from "../server/inputPreflight";
import { bootstrapPublishedModelContracts } from
  "../server/modelReleaseBootstrap";
import {
  buildCanvasModelTransitionCommand,
  canvasModelTransitionExpectedBefore,
  createCanvasModelTransitionPort,
  rollbackCanvasModelTransition,
} from "../client/src/canvas/CanvasModelTransitionCommand";
import type { ProbeNodeType } from "../client/src/canvas/ProbeNode";
import type { CuttableEdge } from "../client/src/canvas/canvasTypes";

const seedanceSchema = knownModelParameterSchema({
  capability: "video",
  providerDriver: "volcengine-ark",
  providerModelId: "doubao-seedance-2-0-mini-260615",
});
const serverSchema = seedanceSchema;
const execFileAsync = promisify(execFile);

type GraphNode = {
  data: Record<string, unknown>;
  id: string;
  type: NodeInputKind;
};

type GraphEdge = {
  data: { inputOrder: number; inputRole?: NodeInputRole };
  id: string;
  source: string;
  target: string;
};

function readyMediaNode(
  kind: "audio" | "image" | "video",
  index: number,
  data: Record<string, unknown> = {},
): GraphNode {
  const id = `p3-${kind}-${index}`;
  return {
    data: {
      assetId: `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`,
      [`${kind}Src`]: `https://signed.example.test/${id}?signature=short-lived`,
      label: kind,
      mediaByteSize: 1_024,
      mediaContentType: kind === "image"
        ? "image/png"
        : kind === "video"
          ? "video/mp4"
          : "audio/mpeg",
      mediaDurationSeconds: kind === "image" ? undefined : kind === "video" ? 5 : 4,
      mediaMetadataSource: "server",
      mediaMetadataStatus: "ready",
      mediaStorageBackend: kind === "video" ? "oss" : "local",
      title: `${kind}-${index}`,
      ...(kind === "image" || kind === "video"
        ? { mediaHeight: 720, mediaWidth: 1_280 }
        : {}),
      ...data,
    },
    id,
    type: kind,
  };
}

function edge(
  source: string,
  order: number,
  role?: NodeInputRole,
): GraphEdge {
  return {
    data: {
      inputOrder: order,
      ...(role ? { inputRole: role } : {}),
    },
    id: `p3-edge-${source}`,
    source,
    target: "p3-target-video",
  };
}

function multimodalGraph(counts: {
  audio: number;
  image: number;
  video: number;
}) {
  const nodes: GraphNode[] = [{
    data: {
      content: "上游文字指令：保持商品颜色，并使用舒缓的镜头节奏。",
      label: "Text",
      title: "上游文字",
    },
    id: "p3-text-1",
    type: "text",
  }];
  const edges: GraphEdge[] = [edge("p3-text-1", 1, "instruction")];
  let order = 2;

  for (let index = 1; index <= counts.image; index += 1) {
    const node = readyMediaNode("image", index);
    nodes.push(node);
    edges.push(edge(node.id, order, index === 1 ? "subject" : "reference-image"));
    order += 1;
  }
  for (let index = 1; index <= counts.video; index += 1) {
    const node = readyMediaNode("video", index);
    nodes.push(node);
    edges.push(edge(node.id, order, index === 1 ? "subject" : "reference-video"));
    order += 1;
  }
  for (let index = 1; index <= counts.audio; index += 1) {
    const node = readyMediaNode("audio", index, {
      audioDuration: 12,
      audioWaveform: [6, 12, 18, 12, 6],
    });
    nodes.push(node);
    edges.push(edge(node.id, order, "reference-audio"));
    order += 1;
  }
  nodes.push({
    data: { label: "Video", title: "目标视频" },
    id: "p3-target-video",
    type: "video",
  });
  return { edges, nodes };
}

function videoPreflight(input: {
  edges: GraphEdge[];
  mode: "first-last-frame" | "multimodal" | "text";
  nodes: GraphNode[];
  ownPrompt?: string;
  schema?: ModelParameterSchema;
}) {
  return resolveNodeInputs({
    edges: input.edges,
    modelSchema: input.schema ?? seedanceSchema,
    nodes: input.nodes,
    ownPrompt: input.ownPrompt ?? "本节点补充：生成一段简洁的商品展示视频。",
    parameters: { inputMode: input.mode },
    targetId: "p3-target-video",
    targetKind: "video",
  });
}

test("Video accepts merged or upstream-only Text plus ready media with a URL-free snapshot", () => {
  const graph = multimodalGraph({ audio: 3, image: 9, video: 3 });
  const result = videoPreflight({ ...graph, mode: "multimodal" });

  expect(result.canSubmit).toBeTruthy();
  expect(result.problems).toEqual([]);
  expect(result.inputs).toHaveLength(16);
  expect(result.inputs.every((input) =>
    input.state === "ready" && input.compatibility === "compatible"))
    .toBeTruthy();
  expect(result.inputs.filter(({ kind }) => kind === "text")).toHaveLength(1);
  expect(result.inputs.filter(({ kind }) => kind === "image")).toHaveLength(9);
  expect(result.inputs.filter(({ kind }) => kind === "video")).toHaveLength(3);
  expect(result.inputs.filter(({ kind }) => kind === "audio")).toHaveLength(3);
  expect(result.inputs.filter(({ role }) => role === "subject").map(({ kind }) => kind))
    .toEqual(["image", "video"]);
  expect(result.finalPrompt).toBe(
    "上游文字指令：保持商品颜色，并使用舒缓的镜头节奏。\n\n" +
    "本节点补充：生成一段简洁的商品展示视频。",
  );
  expect(result.snapshot).toHaveLength(16);
  expect(result.snapshot.map(({ order }) => order)).toEqual(
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  expect(result.snapshot[0]).toEqual({
    kind: "text",
    order: 1,
    role: "instruction",
    sourceNodeId: "p3-text-1",
  });
  expect(JSON.stringify(result.snapshot)).not.toMatch(
    /https?:|signed|signature|imageSrc|videoSrc|audioSrc/i,
  );

  const upstreamOnlyGraph = multimodalGraph({ audio: 0, image: 1, video: 0 });
  const upstreamOnly = videoPreflight({
    ...upstreamOnlyGraph,
    mode: "multimodal",
    ownPrompt: "",
  });
  expect(upstreamOnly.inputs.find(({ kind }) => kind === "text")).toMatchObject({
    compatibility: "compatible",
    kind: "text",
    role: "instruction",
    state: "ready",
  });
  expect(upstreamOnly.finalPrompt).toBe(
    "上游文字指令：保持商品颜色，并使用舒缓的镜头节奏。",
  );
  expect(upstreamOnly.problems).toEqual([]);
  expect(upstreamOnly.canSubmit).toBeTruthy();
  expect(upstreamOnly.snapshot).toEqual([
    {
      kind: "text",
      order: 1,
      role: "instruction",
      sourceNodeId: "p3-text-1",
    },
    {
      assetId: "p3-image-1.png",
      kind: "image",
      order: 2,
      role: "subject",
      sourceNodeId: "p3-image-1",
    },
  ]);
  expect(JSON.stringify(upstreamOnly.snapshot)).not.toMatch(
    /https?:|signed|signature|imageSrc|videoSrc|audioSrc/i,
  );

  const automaticSeedancePreflight = resolveNodeInputs({
    edges: upstreamOnlyGraph.edges,
    mediaInputPolicy: "seedance-2",
    modelSchema: seedanceSchema,
    nodes: upstreamOnlyGraph.nodes,
    ownPrompt: "",
    parameters: { inputMode: "multimodal" },
    targetId: "p3-target-video",
    targetKind: "video",
  });
  expect(automaticSeedancePreflight.inputs.find(({ kind }) => kind === "image"))
    .toMatchObject({
      localTechnicalPreflight: {
        problems: [],
        scope: "local-technical-preflight",
        status: "eligible",
      },
    });
  expect(JSON.stringify(automaticSeedancePreflight.inputs))
    .not.toMatch(/trusted|asset:\/\//i);

  const withoutPrompt = videoPreflight({
    edges: [],
    mode: "text",
    nodes: [{
      data: { label: "Video", title: "无文字目标视频" },
      id: "p3-target-video",
      type: "video",
    }],
    ownPrompt: "",
  });
  expect(withoutPrompt.finalPrompt).toBe("");
  expect(withoutPrompt.canSubmit).toBeFalsy();
  expect(withoutPrompt.problems).toContainEqual(expect.objectContaining({
    code: "PROMPT_MISSING",
  }));
});

test("Video keeps all 10/4/4 edges and blocks only the references beyond 9/3/3", () => {
  const graph = multimodalGraph({ audio: 4, image: 10, video: 4 });
  const result = videoPreflight({ ...graph, mode: "multimodal" });

  expect(result.canSubmit).toBeFalsy();
  expect(result.inputs).toHaveLength(19);
  expect(result.snapshot).toHaveLength(19);
  expect(new Set(result.inputs.map(({ edgeId }) => edgeId)).size).toBe(19);
  expect(result.problems.filter(({ code }) => code === "QUANTITY_EXCEEDED"))
    .toHaveLength(3);
  for (const sourceNodeId of ["p3-image-10", "p3-video-4", "p3-audio-4"]) {
    expect(result.inputs.find((input) => input.sourceNodeId === sourceNodeId))
      .toMatchObject({ compatibility: "blocked" });
  }
  expect(result.inputs.find((input) => input.sourceNodeId === "p3-image-9"))
    .toMatchObject({ compatibility: "compatible" });
  expect(result.inputs.find((input) => input.sourceNodeId === "p3-video-3"))
    .toMatchObject({ compatibility: "compatible" });
  expect(result.inputs.find((input) => input.sourceNodeId === "p3-audio-3"))
    .toMatchObject({ compatibility: "compatible" });
});

test("Video blocks an uploading reference without deleting its edge or snapshot entry", () => {
  const graph = multimodalGraph({ audio: 1, image: 1, video: 1 });
  const audio = graph.nodes.find((node) => node.id === "p3-audio-1")!;
  audio.data = { ...audio.data, inputState: "uploading" };
  const result = videoPreflight({ ...graph, mode: "multimodal" });

  expect(result.canSubmit).toBeFalsy();
  expect(result.inputs).toHaveLength(4);
  expect(result.snapshot).toHaveLength(4);
  expect(result.inputs.find((input) => input.sourceNodeId === audio.id))
    .toMatchObject({ compatibility: "blocked", state: "uploading" });
  expect(result.problems).toContainEqual(expect.objectContaining({
    code: "UPLOADING",
    edgeId: `p3-edge-${audio.id}`,
  }));
});

test("first-last-frame derives ordered roles and reports missing or duplicate frames", () => {
  const first = readyMediaNode("image", 1);
  const last = readyMediaNode("image", 2);
  const target: GraphNode = {
    data: { label: "Video" },
    id: "p3-target-video",
    type: "video",
  };
  const complete = videoPreflight({
    edges: [edge(first.id, 1), edge(last.id, 2)],
    mode: "first-last-frame",
    nodes: [first, last, target],
  });
  expect(complete.canSubmit).toBeTruthy();
  expect(complete.inputs.map(({ role }) => role)).toEqual([
    "first-frame",
    "last-frame",
  ]);
  expect(complete.snapshot.map(({ role }) => role)).toEqual([
    "first-frame",
    "last-frame",
  ]);

  const missingLast = videoPreflight({
    edges: [edge(first.id, 1)],
    mode: "first-last-frame",
    nodes: [first, target],
  });
  expect(missingLast.canSubmit).toBeFalsy();
  expect(missingLast.inputs[0].role).toBe("first-frame");
  expect(missingLast.problems).toContainEqual(expect.objectContaining({
    code: "ROLE_CONFLICT",
    message: "当前模式至少需要1个尾帧输入",
  }));

  const duplicateFirst = videoPreflight({
    edges: [
      edge(first.id, 1, "first-frame"),
      edge(last.id, 2, "first-frame"),
    ],
    mode: "first-last-frame",
    nodes: [first, last, target],
  });
  expect(duplicateFirst.canSubmit).toBeFalsy();
  expect(duplicateFirst.inputs).toHaveLength(2);
  expect(duplicateFirst.inputs[1]).toMatchObject({
    compatibility: "blocked",
    reason: "首帧角色最多允许1个，引用已保留",
  });
  expect(duplicateFirst.problems.filter(({ code }) => code === "ROLE_CONFLICT"))
    .toHaveLength(2);
});

test("multimodal permits one image subject and one video subject but blocks duplicates per kind", () => {
  const validGraph = multimodalGraph({ audio: 1, image: 2, video: 2 });
  const valid = videoPreflight({ ...validGraph, mode: "multimodal" });
  expect(valid.canSubmit).toBeTruthy();
  expect(valid.inputs.filter(({ role }) => role === "subject").map(({ kind }) => kind))
    .toEqual(["image", "video"]);

  const duplicateImageEdges = validGraph.edges.map((item) =>
    item.source === "p3-image-2"
      ? { ...item, data: { ...item.data, inputRole: "subject" as const } }
      : item);
  const duplicateImage = videoPreflight({
    edges: duplicateImageEdges,
    mode: "multimodal",
    nodes: validGraph.nodes,
  });
  expect(duplicateImage.canSubmit).toBeFalsy();
  expect(duplicateImage.inputs.find(({ sourceNodeId }) => sourceNodeId === "p3-image-2"))
    .toMatchObject({ compatibility: "blocked" });
  expect(duplicateImage.problems).toContainEqual(expect.objectContaining({
    code: "ROLE_CONFLICT",
    edgeId: "p3-edge-p3-image-2",
  }));

  const duplicateVideoEdges = validGraph.edges.map((item) =>
    item.source === "p3-video-2"
      ? { ...item, data: { ...item.data, inputRole: "subject" as const } }
      : item);
  const duplicateVideo = videoPreflight({
    edges: duplicateVideoEdges,
    mode: "multimodal",
    nodes: validGraph.nodes,
  });
  expect(duplicateVideo.canSubmit).toBeFalsy();
  expect(duplicateVideo.inputs.find(({ sourceNodeId }) => sourceNodeId === "p3-video-2"))
    .toMatchObject({ compatibility: "blocked" });
  expect(duplicateVideo.problems).toContainEqual(expect.objectContaining({
    code: "ROLE_CONFLICT",
    edgeId: "p3-edge-p3-video-2",
  }));
});

test("Seedance multimodal semantics normalize a retained first-frame role in one durable Canvas transaction", async () => {
  const graph = multimodalGraph({ audio: 0, image: 1, video: 0 });
  const retainedFrame = graph.edges.map((item) =>
    item.source === "p3-image-1"
      ? { ...item, data: { ...item.data, inputRole: "first-frame" as const } }
      : item);
  const result = videoPreflight({
    edges: retainedFrame,
    mode: "multimodal",
    nodes: graph.nodes,
  });
  expect(result.canSubmit).toBeTruthy();
  expect(result.inputs.find(({ sourceNodeId }) => sourceNodeId === "p3-image-1"))
    .toMatchObject({ compatibility: "compatible", role: "reference-image" });
  expect(result.problems).toEqual([]);

  const before = {
    edges: retainedFrame as unknown as CuttableEdge[],
    nodes: graph.nodes.map((node) => node.id === "p3-target-video"
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationContractFingerprint: "old-contract",
            videoGenerationError: "old-contract-error",
            videoGenerationErrorCode: "INPUT_INVALID",
            videoGenerationOwnershipKey: "ownership-preserved",
            videoGenerationTaskId: "task-preserved",
            videoInputContractFingerprint: "old-contract",
            videoParameters: { inputMode: "multimodal" },
          },
        }
      : node) as unknown as ProbeNodeType[],
    revision: 7,
  };
  let snapshot = before;
  let checkpoints = 0;
  let commits = 0;
  let flushes = 0;
  const port = createCanvasModelTransitionPort({
    checkpoint: () => { checkpoints += 1; },
    commitAtomic(next) {
      commits += 1;
      snapshot = {
        edges: [...next.edges],
        nodes: [...next.nodes],
        revision: next.revision ?? snapshot.revision,
      };
    },
    async flush() { flushes += 1; },
    persistenceReady: () => true,
    snapshot: () => snapshot,
    waitForRevision: async () => 8,
  });
  const applied = await port.apply({
    intent: "model-switch",
    model: {
      configurationRevision: "seedance-contract-test",
      displayName: "Seedance 2.0 Mini Next",
      id: "seedance-mini-next",
      parameterSchema: seedanceSchema,
      releaseRevisionId: "00000000-0000-4000-8000-000000000301",
    },
    nodeId: "p3-target-video",
    requestedParameters: { inputMode: "multimodal" },
  });
  expect(applied).toMatchObject({ changed: true, revision: 8, status: "applied" });
  expect({ checkpoints, commits, flushes }).toEqual({
    checkpoints: 1,
    commits: 1,
    flushes: 1,
  });
  expect(snapshot.edges).toHaveLength(before.edges.length);
  expect(snapshot.edges.find((item) => item.source === "p3-image-1")?.data?.inputRole)
    .toBe("reference-image");
  expect(snapshot.nodes.find((item) => item.id === "p3-target-video")?.data)
    .toMatchObject({
      videoGenerationOwnershipKey: "ownership-preserved",
      videoGenerationTaskId: "task-preserved",
      videoGenerationContractFingerprint: undefined,
      videoGenerationError: undefined,
      videoGenerationErrorCode: undefined,
      videoInputContractFingerprint: expect.stringMatching(/^mic2:/),
    });

  const unrelatedError = buildCanvasModelTransitionCommand({
    request: {
      intent: "model-switch",
      model: {
        configurationRevision: "seedance-contract-test-other",
        displayName: "Seedance 2.0 Mini Other",
        id: "seedance-mini-other",
        parameterSchema: seedanceSchema,
        releaseRevisionId: "00000000-0000-4000-8000-000000000302",
      },
      nodeId: "p3-target-video",
      requestedParameters: { inputMode: "multimodal" },
    },
    snapshot: {
      ...snapshot,
      nodes: snapshot.nodes.map((node) => node.id === "p3-target-video"
        ? {
            ...node,
            data: {
              ...node.data,
              videoGenerationContractFingerprint: "different-contract",
              videoGenerationError: "provider-error-must-stay",
              videoGenerationErrorCode: "REMOTE",
            },
          }
        : node),
    },
  });
  expect(unrelatedError.status).toBe("ready");
  expect(unrelatedError.after?.nodes.find((item) => item.id === "p3-target-video")?.data)
    .toMatchObject({
      videoGenerationContractFingerprint: "different-contract",
      videoGenerationError: "provider-error-must-stay",
      videoGenerationErrorCode: "REMOTE",
    });

  const savedAfter = snapshot;
  const rollbackBefore = JSON.stringify(savedAfter);
  const rollbackPort = createCanvasModelTransitionPort({
    checkpoint: () => undefined,
    commitAtomic(next) {
      snapshot = {
        edges: [...next.edges],
        nodes: [...next.nodes],
        revision: next.revision ?? snapshot.revision,
      };
    },
    flush: async () => { throw new Error("injected-save-failure"); },
    persistenceReady: () => true,
    snapshot: () => snapshot,
    waitForRevision: async () => 9,
  });
  const rolledBack = await rollbackPort.apply({
    intent: "mode-switch",
    model: {
      configurationRevision: "seedance-contract-test",
      displayName: "Seedance 2.0 Mini",
      id: "seedance-mini",
      parameterSchema: seedanceSchema,
      releaseRevisionId: "00000000-0000-4000-8000-000000000303",
    },
    nodeId: "p3-target-video",
    requestedParameters: { inputMode: "multimodal" },
  });
  expect(rolledBack).toMatchObject({ status: "rolled-back" });
  expect(JSON.stringify(snapshot)).toBe(rollbackBefore);
});

test("model transition rollback preserves concurrent unrelated graph edits", () => {
  const before = {
    edges: [{
      data: { inputOrder: 1, inputRole: "first-frame" as const },
      id: "frame-edge",
      source: "frame",
      target: "video",
    }] as unknown as CuttableEdge[],
    nodes: [{
      data: { assetId: "frame.png", imageSrc: "/frame.png", label: "首帧" },
      id: "frame",
      position: { x: 0, y: 0 },
      type: "image",
    }, {
      data: {
        label: "视频",
        videoModelId: "model-before",
        videoParameters: { inputMode: "first-last-frame" },
      },
      id: "video",
      position: { x: 100, y: 0 },
      type: "video",
    }, {
      data: { content: "原文", label: "无关文案" },
      id: "unrelated",
      position: { x: 200, y: 0 },
      type: "text",
    }] as ProbeNodeType[],
    revision: 7,
  };
  const after = {
    ...before,
    edges: before.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data, inputRole: "reference-image" as const },
    })),
    nodes: before.nodes.map((node) => node.id === "video"
      ? {
          ...node,
          data: {
            ...node.data,
            videoModelId: "model-after",
            videoParameters: { inputMode: "multimodal" },
          },
        }
      : node),
  };
  const current = {
    ...after,
    edges: [...after.edges, {
      data: { inputOrder: 2, inputRole: "instruction" as const },
      id: "concurrent-edge",
      source: "unrelated",
      target: "video",
    }] as unknown as CuttableEdge[],
    nodes: after.nodes.map((node) => node.id === "unrelated"
      ? { ...node, data: { ...node.data, content: "并发新文案" } }
      : node),
    revision: 8,
  };
  const rolledBack = rollbackCanvasModelTransition({ after, before, current });
  expect(rolledBack.nodes.find((node) => node.id === "video")?.data)
    .toMatchObject({
      videoModelId: "model-before",
      videoParameters: { inputMode: "first-last-frame" },
    });
  expect(rolledBack.edges.find((edge) => edge.id === "frame-edge")?.data?.inputRole)
    .toBe("first-frame");
  expect(rolledBack.nodes.find((node) => node.id === "unrelated")?.data.content)
    .toBe("并发新文案");
  expect(rolledBack.edges.some((edge) => edge.id === "concurrent-edge")).toBe(true);
  expect(rolledBack.revision).toBe(8);
});

test("model transition rejects a stale click after the admitted graph changes", async () => {
  let snapshot = {
    edges: [{
      data: { inputOrder: 1, inputRole: "first-frame" as const },
      id: "stale-frame-edge",
      source: "stale-frame",
      target: "stale-video",
    }] as unknown as CuttableEdge[],
    nodes: [{
      data: { assetId: "frame.png", imageSrc: "/frame.png", label: "首帧" },
      id: "stale-frame",
      position: { x: 0, y: 0 },
      type: "image",
    }, {
      data: {
        label: "视频",
        videoModelConfigurationRevision: "config-before",
        videoModelId: "model-before",
        videoParameters: { inputMode: "first-last-frame" },
        videoPrompt: "旧点击",
      },
      id: "stale-video",
      position: { x: 100, y: 0 },
      type: "video",
    }] as ProbeNodeType[],
    revision: 7,
  };
  const expectedBefore = canvasModelTransitionExpectedBefore(
    snapshot,
    "stale-video",
  );
  snapshot = {
    ...snapshot,
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      data: { ...edge.data, inputRole: "reference-image" as const },
    })),
    nodes: snapshot.nodes.map((node) => node.id === "stale-video"
      ? {
          ...node,
          data: {
            ...node.data,
            videoModelConfigurationRevision: "config-new",
            videoModelId: "model-new",
            videoParameters: { inputMode: "multimodal" },
          },
        }
      : node),
    revision: 8,
  };
  let commits = 0;
  const port = createCanvasModelTransitionPort({
    checkpoint: () => undefined,
    commitAtomic() { commits += 1; },
    flush: async () => undefined,
    persistenceReady: () => true,
    snapshot: () => snapshot,
    waitForRevision: async () => snapshot.revision,
  });
  const result = await port.apply({
    expectedBefore,
    intent: "execute",
    model: {
      configurationRevision: "config-before",
      displayName: "旧模型",
      id: "model-before",
      parameterSchema: seedanceSchema,
      releaseRevisionId: "00000000-0000-4000-8000-000000000303",
    },
    nodeId: "stale-video",
    requestedParameters: { inputMode: "first-last-frame" },
  });
  expect(result).toMatchObject({
    message: "画布已在等待期间更新，请按当前内容重新生成",
    status: "rejected",
  });
  expect(commits).toBe(0);
  expect(snapshot.nodes.find((node) => node.id === "stale-video")?.data)
    .toMatchObject({
      videoModelConfigurationRevision: "config-new",
      videoModelId: "model-new",
      videoParameters: { inputMode: "multimodal" },
    });
  expect(snapshot.edges[0]?.data?.inputRole).toBe("reference-image");
});

test("Video execute transition and interactive switches share Canvas admission", async () => {
  const source = await readFile(
    join(process.cwd(), "client/src/canvas/VideoNode.tsx"),
    "utf8",
  );
  const generateStart = source.indexOf("const generateVideo = async");
  const generateEnd = source.indexOf("const retryVideoGeneration", generateStart);
  const generate = source.slice(generateStart, generateEnd);
  const prepare = generate.indexOf("prepareSubmissionAdapter: async () =>");
  const transition = generate.indexOf(
    "const transition = await applyModelTransition(",
  );
  expect(generateStart).toBeGreaterThan(-1);
  expect(generateEnd).toBeGreaterThan(generateStart);
  expect(prepare).toBeGreaterThan(-1);
  expect(transition).toBeGreaterThan(prepare);
  expect(generate).toContain("const compiled = compileCurrentSubmission({");
  expect(generate).toContain("expectedBefore: transitionExpectedBefore");
  expect(source).toContain("canvasModelTransitionExpectedBefore(");
  expect(source).toContain("runWithSingleNodeGenerationAdmission({");
  expect(source).toContain("void applyInteractiveModelTransition({");
  expect(source).toContain("const semanticEditBlocked = Boolean(");
  expect(source).toContain("disabled={semanticEditBlocked}");
  const loadFile = source.slice(
    source.indexOf("const loadFile = async"),
    source.indexOf("const togglePlayback = async"),
  );
  expect(loadFile).toContain("!file ||");
  expect(loadFile).toContain("semanticEditBlocked ||");
  expect(loadFile).toContain("canvasMutationPending ||");
  expect(loadFile).toContain("uploadInFlight.current");
  expect(loadFile).toContain("const prepared = applyViewUpdate(");
  expect(loadFile.indexOf("const prepared = applyViewUpdate("))
    .toBeLessThan(loadFile.indexOf("const response = await fetch("));
  expect(loadFile.indexOf("adoptUploadedAsset({"))
    .toBeGreaterThan(loadFile.indexOf("const response = await fetch("));
  expect(source).toContain("const uploadControlBlocked =");
  expect(source).toContain(
    "semanticEditBlocked || canvasMutationPending || uploading",
  );
  expect(source).toContain("replaceDisabled={uploadControlBlocked}");
});

const serverCanvasId = "p3-video-server-preflight";
const serverModelName = "P3 Zero Provider Video Inputs";
const serverImageAssetId = "p3-server-image";
const serverAudioAssetId = "p3-server-audio.mp3";
let serverModelId = "";
let serverProviderId = "";

async function connectNodes(page: Page, sourceId: string, targetId: string) {
  const sourceNode = page.locator(`.react-flow__node[data-id="${sourceId}"]`);
  const targetNode = page.locator(`.react-flow__node[data-id="${targetId}"]`);
  await sourceNode.click();
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
  await targetNode.click();
}

async function ensureServerModel(request: APIRequestContext) {
  const existing = await (await request.get("/api/admin/models")).json() as {
    models: Array<{ displayName: string; id: string }>;
  };
  const found = existing.models.find(({ displayName }) => displayName === serverModelName);
  if (found) {
    const updated = await request.patch(`/api/admin/models/${found.id}`, {
      data: {
        isDefault: false,
        maxCostMicrounits: 0,
        parameterSchema: serverSchema,
        status: "published",
      },
    });
    expect(updated.ok()).toBeTruthy();
    return found.id;
  }
  const providerResponse = await request.post("/api/admin/providers", {
    data: {
      apiKey: "zero-provider-p3-video-inputs-key",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "P3 Video Inputs Ark",
    },
  });
  expect(providerResponse.status()).toBe(201);
  serverProviderId = (await providerResponse.json() as {
    profile: { id: string };
  }).profile.id;
  const created = await request.post("/api/admin/models", {
    data: {
      capability: "video",
      displayName: serverModelName,
      isDefault: false,
      maxCostMicrounits: 0,
      parameterSchema: serverSchema,
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProfileId: serverProviderId,
      providerProtocol: "native",
      sortOrder: 9_300,
      status: "draft",
    },
  });
  expect(created.status()).toBe(201);
  const modelId = (await created.json() as { model: { id: string } }).model.id;
  const contractResponse = await request.get(
    `/api/admin/models/${modelId}/contract`,
  );
  expect(contractResponse.ok()).toBeTruthy();
  const { suggestedDocument } = await contractResponse.json() as {
    suggestedDocument: Record<string, unknown>;
  };
  const draft = await request.post(
    `/api/admin/models/${modelId}/contract/draft`,
    { data: { document: suggestedDocument, expectedDraftVersion: 0 } },
  );
  expect(draft.ok()).toBeTruthy();
  const published = await request.post(
    `/api/admin/models/${modelId}/contract/publish`,
    { data: { expectedDraftVersion: 1 } },
  );
  expect(published.ok()).toBeTruthy();
  const directoryResponse = await request.get("/api/test-data-directory");
  expect(directoryResponse.ok()).toBeTruthy();
  const { dataDirectory } = await directoryResponse.json() as {
    dataDirectory: string;
  };
  const database = openAppDatabase(dataDirectory);
  try {
    bootstrapPublishedModelContracts(database, "__test__");
  } finally {
    database.close();
  }
  return modelId;
}

async function uploadServerMedia(request: APIRequestContext) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "unboundry-m30-media-"));
  const audioPath = join(fixtureDirectory, "audio.mp3");
  let image: Buffer;
  let audio: Buffer;
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", resolve(process.cwd(), "client/public/fixtures/audio-success.mp3"),
      "-t", "5", "-c:a", "libmp3lame", "-q:a", "9", audioPath,
    ]);
    [image, audio] = await Promise.all([
      readFile(resolve(
        process.cwd(),
        "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png",
      )),
      readFile(audioPath),
    ]);
  } finally {
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
  const responses = [
    await request.post(`/api/assets/${serverImageAssetId}`, {
      data: image,
      headers: { "Content-Type": "image/png", "X-File-Name": "p3-server.png" },
    }),
    await request.post(`/api/audio-assets/${serverAudioAssetId}`, {
      data: audio,
      headers: { "Content-Type": "audio/mpeg", "X-File-Name": "p3-server.mp3" },
    }),
  ];
  expect(responses.map((response) => response.status())).toEqual([201, 201]);
}

test.describe.serial("P3 Video server preflight trusts the persisted edge graph", () => {
  test.beforeAll(async ({ request }) => {
    serverModelId = await ensureServerModel(request);
    await uploadServerMedia(request);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/canvas/${serverCanvasId}`);
    await request.delete(`/api/canvas/${serverCanvasId}-image-dimensions`);
    await request.delete("/api/canvas/node.video.empty");
    await request.delete("/api/canvas/node.video.mode-transition");
    await Promise.all([
      request.delete(`/api/assets/${serverImageAssetId}`),
      request.delete(`/api/audio-assets/${serverAudioAssetId}`),
    ]);
    if (serverModelId) {
      const disabled = await request.patch(`/api/admin/models/${serverModelId}`, {
        data: { isDefault: false, status: "disabled" },
      });
      expect(disabled.ok()).toBeTruthy();
    }
  });

  test("forged client inputs are ignored and zero-cost submission creates no task or paid request", async ({
    request,
  }) => {
    await request.delete(`/api/canvas/${serverCanvasId}`);
    const saved = await request.put(`/api/canvas/${serverCanvasId}`, {
      data: {
        edges: [
          { data: { inputOrder: 1, inputRole: "instruction" }, id: "server-edge-text", source: "server-text", target: "server-video" },
          { data: { inputOrder: 2, inputRole: "subject" }, id: "server-edge-image", source: "server-image", target: "server-video" },
          { data: { inputOrder: 3, inputRole: "reference-audio" }, id: "server-edge-audio", source: "server-audio", target: "server-video" },
        ],
        nodes: [
          { data: { content: "服务端持久化的上游文字" }, id: "server-text", type: "text" },
          { data: { assetId: serverImageAssetId, imageSrc: `/api/assets/${serverImageAssetId}` }, id: "server-image", type: "image" },
          { data: { assetId: serverAudioAssetId, audioSrc: `/api/audio-assets/${serverAudioAssetId}` }, id: "server-audio", type: "audio" },
          {
            data: {
              title: "服务端Video目标",
              videoPrompt: "",
            },
            id: "server-video",
            type: "video",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const canvasRevision = (await saved.json() as { revision: number }).revision;
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    const body = {
      canvasId: serverCanvasId,
      canvasRevision,
      idempotencyKey: `p3-server-${Date.now()}`,
      inputSchemaVersion: 1,
      inputs: [{
        assetId: "forged-client-asset",
        kind: "image",
        order: 99,
        role: "last-frame",
        sourceNodeId: "forged-client-node",
      }],
      kind: "video",
      model: serverModelId,
      nodeId: "server-video",
      ownPrompt: "",
      parameters: { inputMode: "multimodal" },
      prompt: "前端伪造的最终Prompt不能成为事实来源",
    };

    const preflightResponse = await request.post("/api/generation-tasks/preflight", {
      data: body,
    });
    expect(preflightResponse.ok()).toBeTruthy();
    const preflight = await preflightResponse.json() as {
      canEnqueue: boolean;
      canSubmit: boolean;
      finalPrompt: string;
      inputs: Array<{
        compatibility: "blocked" | "compatible";
        edgeId: string;
        state: string;
      }>;
      problems: Array<{ code: string }>;
      provider: { adapterSupported: boolean; configured: boolean };
      providerBalance: { checked: boolean; status: string };
      providerRequests: number;
      safetyAdmission: { allowed: boolean };
      snapshot: Array<Record<string, unknown>>;
    };
    expect(preflight.canSubmit, JSON.stringify(preflight)).toBeTruthy();
    expect(preflight.canEnqueue).toBeFalsy();
    expect(preflight).not.toHaveProperty("costCurrency");
    expect(preflight).not.toHaveProperty("estimatedCostMicrounits");
    expect(preflight.problems).toEqual([]);
    expect(preflight.provider).toEqual({
      adapterSupported: true,
      configured: true,
    });
    expect(preflight.providerBalance).toMatchObject({
      checked: false,
      status: "not-checked",
    });
    expect(typeof preflight.safetyAdmission.allowed).toBe("boolean");
    expect(preflight.providerRequests).toBe(0);
    expect(preflight.finalPrompt).toBe("服务端持久化的上游文字");
    expect(preflight.inputs.map(({ edgeId }) => edgeId)).toEqual([
      "server-edge-text",
      "server-edge-image",
      "server-edge-audio",
    ]);
    expect(preflight.inputs.every((input) =>
      input.state === "ready" && input.compatibility === "compatible"))
      .toBeTruthy();
    expect(preflight.snapshot).toEqual([
      { kind: "text", order: 1, role: "instruction", sourceNodeId: "server-text" },
      { assetId: serverImageAssetId, kind: "image", order: 2, role: "subject", sourceNodeId: "server-image" },
      { assetId: serverAudioAssetId, kind: "audio", order: 3, role: "reference-audio", sourceNodeId: "server-audio" },
    ]);
    expect(JSON.stringify(preflight.snapshot)).not.toMatch(/https?:|signed|signature/i);
    expect(JSON.stringify(preflight.snapshot)).not.toContain("forged-client");

    const submission = await request.post("/api/generation-tasks", { data: body });
    expect(submission.status()).toBe(503);
    const tasks = await (await request.get(
      `/api/generation-tasks?canvasId=${encodeURIComponent(serverCanvasId)}`,
    )).json() as { tasks: unknown[] };
    expect(tasks.tasks).toEqual([]);
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  });

  test("server preflight replaces forged Image dimensions with ready owner metadata and fails closed when dimensions are missing", async ({
    request,
  }) => {
    const canvasId = `${serverCanvasId}-image-dimensions`;
    await request.delete(`/api/canvas/${canvasId}`);
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "subject" },
          id: "authoritative-image-edge",
          source: "authoritative-image",
          target: "authoritative-video",
        }],
        nodes: [
          {
            data: {
              assetId: serverImageAssetId,
              imageSrc: `/api/assets/${serverImageAssetId}`,
              inputState: "ready",
              mediaByteSize: 1,
              mediaContentType: "image/png",
              mediaHeight: 720,
              mediaMetadataSource: "server",
              mediaMetadataStatus: "ready",
              mediaStorageBackend: "local",
              mediaWidth: 800,
              title: "客户端伪造尺寸的图片",
            },
            id: "authoritative-image",
            type: "image",
          },
          {
            data: {
              title: "权威尺寸目标",
              videoPrompt: "必须使用数据库中的图片尺寸",
            },
            id: "authoritative-video",
            type: "video",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    });
    expect(saved.ok()).toBeTruthy();
    const revision = (await saved.json() as { revision: number }).revision;
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    const metadataResponse = await request.get(
      `/api/media-metadata/image/${serverImageAssetId}`,
    );
    expect(metadataResponse.ok()).toBeTruthy();
    expect(await metadataResponse.json()).toMatchObject({
      mediaHeight: 720,
      mediaWidth: 1_280,
    });

    const dimensionSchema: ModelParameterSchema = {
      ...serverSchema,
      referenceMediaRules: {
        ...serverSchema.referenceMediaRules!,
        image: {
          ...serverSchema.referenceMediaRules!.image!,
          maxWidth: 1_000,
        },
      },
    };
    const resolve = () => resolvePersistedNodeInputs({
      bypass: true,
      canvasId,
      expectedRevision: revision,
      modelSchema: dimensionSchema,
      ownerId: "__test__",
      parameters: { inputMode: "multimodal" },
      targetId: "authoritative-video",
      targetKind: "video",
    });
    const database = openAppDatabase();
    const original = database.prepare(`
      SELECT media_height, media_width
      FROM media_assets
      WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
    `).get(serverImageAssetId) as {
      media_height: number | null;
      media_width: number | null;
    } | undefined;
    try {
      expect(original).toEqual({ media_height: 720, media_width: 1_280 });
      const authoritative = resolve();
      expect(authoritative.canSubmit).toBeFalsy();
      expect(authoritative.inputs[0]).toMatchObject({
        compatibility: "blocked",
        mediaHeight: 720,
        mediaWidth: 1_280,
      });
      expect(authoritative.problems).toContainEqual(expect.objectContaining({
        edgeId: "authoritative-image-edge",
        message: expect.stringContaining("宽度需不超过1000px"),
      }));

      expect(database.prepare(`
        UPDATE media_assets
        SET media_height = NULL, media_width = NULL
        WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
      `).run(serverImageAssetId).changes).toBe(1);
      const missing = resolve();
      expect(missing.canSubmit).toBeFalsy();
      expect(missing.inputs[0]).toMatchObject({
        compatibility: "blocked",
        mediaHeight: undefined,
        mediaWidth: undefined,
      });
      expect(missing.problems).toContainEqual(expect.objectContaining({
        edgeId: "authoritative-image-edge",
        message: expect.stringContaining("分辨率尚未经过服务端校验"),
      }));
    } finally {
      if (original) {
        database.prepare(`
          UPDATE media_assets
          SET media_height = ?, media_width = ?
          WHERE owner_id = '__test__' AND kind = 'image' AND id = ?
        `).run(original.media_height, original.media_width, serverImageAssetId);
      }
      database.close();
      await request.delete(`/api/canvas/${canvasId}`);
    }
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  });

  test("Canvas admission rejects forged ready fields for missing, foreign-owned and not-ready assets", async ({
    request,
  }) => {
    const canvasId = `${serverCanvasId}-metadata-negative`;
    const foreignOwnerId = "p3-foreign-media-owner";
    const database = openAppDatabase();
    const original = database.prepare(`
      SELECT owner_id, storage_status
      FROM media_assets
      WHERE kind = 'image' AND id = ?
    `).get(serverImageAssetId) as {
      owner_id: string;
      storage_status: "failed" | "pending" | "ready";
    } | undefined;
    if (!original) {
      database.close();
      throw new Error("P3 metadata negative test image was not registered");
    }
    const reassignImageAssetOwner = (ownerId: string) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec("PRAGMA defer_foreign_keys = ON");
        expect(database.prepare(`
          UPDATE media_assets SET owner_id = ?
          WHERE kind = 'image' AND id = ?
        `).run(ownerId, serverImageAssetId).changes).toBe(1);
        database.prepare(`
          UPDATE media_image_metadata SET owner_id = ?
          WHERE kind = 'image' AND asset_id = ?
        `).run(ownerId, serverImageAssetId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    };

    const expectBlocked = async (assetId: string) => {
      await request.delete(`/api/canvas/${canvasId}`);
      const saved = await request.put(`/api/canvas/${canvasId}`, {
        data: {
          edges: [{
            data: { inputOrder: 1, inputRole: "subject" },
            id: "metadata-negative-edge",
            source: "metadata-negative-image",
            target: "metadata-negative-video",
          }],
          nodes: [
            {
              data: {
                assetId,
                imageSrc: `/api/assets/${assetId}`,
                inputState: "ready",
                mediaByteSize: 1,
                mediaContentType: "image/png",
                mediaMetadataSource: "server",
                mediaMetadataStatus: "ready",
                mediaStorageBackend: "local",
                title: "伪造可信状态的图片",
              },
              id: "metadata-negative-image",
              type: "image",
            },
            {
              data: {
                title: "元数据负控目标",
                videoPrompt: "服务端必须重新核对素材归属和状态",
              },
              id: "metadata-negative-video",
              type: "video",
            },
          ],
          revision: 0,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      });
      expect(saved.status()).toBe(409);
      await expect(saved.json()).resolves.toMatchObject({
        code: "CANVAS_MEDIA_UNAVAILABLE",
      });
      const tasks = await (await request.get(
        `/api/generation-tasks?canvasId=${encodeURIComponent(canvasId)}`,
      )).json() as { tasks: unknown[] };
      expect(tasks.tasks).toEqual([]);
    };

    try {
      const timestamp = new Date().toISOString();
      database.prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
      `).run(
        foreignOwnerId,
        foreignOwnerId,
        "P3 Foreign Media Owner",
        "test-only-not-a-login",
        timestamp,
        timestamp,
      );
      await expectBlocked("p3-missing-image");

      reassignImageAssetOwner(foreignOwnerId);
      await expectBlocked(serverImageAssetId);

      reassignImageAssetOwner(original.owner_id);
      expect(database.prepare(`
        UPDATE media_assets SET storage_status = 'pending'
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).run(original.owner_id, serverImageAssetId).changes).toBe(1);
      await expectBlocked(serverImageAssetId);
    } finally {
      try {
        reassignImageAssetOwner(original.owner_id);
        database.prepare(`
          UPDATE media_assets SET storage_status = ?
          WHERE owner_id = ? AND kind = 'image' AND id = ?
        `).run(original.storage_status, original.owner_id, serverImageAssetId);
        database.prepare("DELETE FROM users WHERE id = ?").run(foreignOwnerId);
      } finally {
        database.close();
        await request.delete(`/api/canvas/${canvasId}`);
      }
    }
  });

  test("a ready Text supplies an empty Video Prompt while a new media edge upgrades mode in the same undo step", async ({
    page,
    request,
  }) => {
    const canvasId = "node.video.empty";
    await request.delete(`/api/canvas/${canvasId}`);
    const imageMetadata = await (
      await request.get(`/api/media-metadata/image/${serverImageAssetId}`)
    ).json() as {
      byteSize: number;
      contentType: string;
      mediaHeight: number;
      mediaWidth: number;
      storageBackend: "local" | "oss";
    };
    const trustedImageData = {
      inputState: "ready",
      mediaByteSize: imageMetadata.byteSize,
      mediaContentType: imageMetadata.contentType,
      mediaHeight: imageMetadata.mediaHeight,
      mediaMetadataSource: "server",
      mediaMetadataStatus: "ready",
      mediaStorageBackend: imageMetadata.storageBackend,
      mediaWidth: imageMetadata.mediaWidth,
    } as const;
    const before = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    const saved = await request.put(`/api/canvas/${canvasId}`, {
      data: {
        edges: [{
          data: { inputOrder: 1, inputRole: "instruction" },
          id: "p3-ui-text-edge",
          source: "p3-ui-text",
          sourceHandle: "source",
          target: "p3-ui-video",
          targetHandle: "target",
          type: "cuttable",
        }, {
          data: { inputOrder: 2, inputRole: "reference-image" },
          id: "p3-ui-existing-edge",
          source: "p3-ui-image-1",
          sourceHandle: "source",
          target: "p3-ui-video",
          targetHandle: "target",
          type: "cuttable",
        }],
        nodes: [
          {
            data: {
              content: "上游文字直接作为视频生成指令",
              title: "视频生成文字",
            },
            id: "p3-ui-text",
            position: { x: 80, y: -230 },
            style: { height: 250, width: 250 },
            type: "text",
          },
          {
            data: {
              assetId: serverImageAssetId,
              imageSrc: `/api/assets/${serverImageAssetId}`,
              ...trustedImageData,
              title: "已有参考图",
            },
            id: "p3-ui-image-1",
            position: { x: 80, y: 100 },
            style: { height: 250, width: 250 },
            type: "image",
          },
          {
            data: {
              assetId: serverImageAssetId,
              imageSrc: `/api/assets/${serverImageAssetId}`,
              ...trustedImageData,
              title: "新增参考图",
            },
            id: "p3-ui-image-2",
            position: { x: 80, y: 430 },
            style: { height: 250, width: 250 },
            type: "image",
          },
          {
            data: {
              title: "Video目标",
              videoGenerationError: "当前模式至少需要1个尾帧输入",
              videoGenerationErrorCode: "ROLE_CONFLICT",
              videoModelId: serverModelId,
              videoParameters: { inputMode: "text" },
              videoPrompt: "",
              videoPromptReady: true,
            },
            id: "p3-ui-video",
            position: { x: 700, y: 250 },
            style: { height: 250, width: 444 },
            type: "video",
          },
        ],
        revision: 0,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      headers: { "X-Unboundry-Safe-Fixture-Seed": canvasId },
    });
    expect(saved.ok()).toBeTruthy();

    await page.goto(`/__fixture/${canvasId}`);
    const world = page.getByTestId("canvas-world");
    await expect(world).toHaveAttribute("data-node-count", "4");
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await page.locator('.react-flow__node[data-id="p3-ui-video"]').click();
    const creator = page.getByTestId("video-creator");
    await expect(creator).toBeVisible();
    // Hydrating an older graph is deliberately non-destructive: its saved text
    // mode remains unchanged until the user adds a new media edge.
    await expect(creator.getByRole("button", { exact: true, name: "文本" }))
      .toBeVisible();
    await expect.poll(async () => Number(
      await world.getAttribute("data-save-fingerprint-count") ?? "0",
    )).toBe(0);
    await expect(creator.getByRole("button", { exact: true, name: "文本" }))
      .toBeEnabled();
    await expect(page.getByText("当前模式至少需要1个尾帧输入", { exact: true }))
      .toHaveCount(0);
    await expect.poll(async () => {
      const current = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
        nodes: Array<{
          data: { videoGenerationError?: string; videoGenerationErrorCode?: string };
          id: string;
        }>;
      };
      const target = current.nodes.find(({ id }) => id === "p3-ui-video");
      return [target?.data.videoGenerationError, target?.data.videoGenerationErrorCode];
    }).toEqual([
      "当前模式至少需要1个尾帧输入",
      "ROLE_CONFLICT",
    ]);

    await connectNodes(page, "p3-ui-image-2", "p3-ui-video");
    await expect(world).toHaveAttribute("data-edge-count", "3");
    await expect(creator.getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await expect(creator.getByRole("button", { exact: true, name: "全能参考" }))
      .toBeEnabled();
    await expect(creator.getByTestId("video-creator-prompt")).toHaveValue("");
    await expect(creator.getByTestId("upstream-input-p3-ui-text")).toBeVisible();
    await expect(creator.getByTestId("upstream-input-problem")).toHaveCount(0);

    await page.keyboard.press("Meta+z");
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await page.locator('.react-flow__node[data-id="p3-ui-video"]').click();
    await expect(creator.getByRole("button", { exact: true, name: "文本" }))
      .toBeVisible();
    await expect(creator.getByRole("button", { exact: true, name: "文本" }))
      .toBeEnabled();

    await connectNodes(page, "p3-ui-image-2", "p3-ui-video");
    await expect(world).toHaveAttribute("data-edge-count", "3");
    await expect(creator.getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await page.getByTestId("upstream-input-p3-ui-image-2")
      .getByRole("button", { name: /删除引用/ })
      .click();
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await expect(creator.getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("已保存到云端");

    const persisted = await (await request.get(`/api/canvas/${canvasId}`)).json() as {
      edges: unknown[];
      nodes: Array<{ data: { videoParameters?: { inputMode?: string } }; id: string }>;
    };
    expect(persisted.edges).toHaveLength(2);
    expect(persisted.nodes.find(({ id }) => id === "p3-ui-video")?.data.videoParameters)
      .toMatchObject({ inputMode: "multimodal" });

    await page.reload();
    await expect(world).toHaveAttribute("data-edge-count", "2");
    await page.locator('.react-flow__node[data-id="p3-ui-video"]').click();
    const restoredCreator = page.getByTestId("video-creator");
    await expect(restoredCreator
      .getByRole("button", { exact: true, name: "全能参考" }))
      .toBeVisible();
    await expect(restoredCreator.getByTestId("video-creator-prompt")).toHaveValue("");
    await expect(restoredCreator.getByTestId("upstream-input-problem")).toHaveCount(0);
    const after = await (await request.get("/api/generation-tasks/status")).json() as {
      paidProviderRequests: number;
    };
    expect(after.paidProviderRequests).toBe(before.paidProviderRequests);
  });
});
