import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";
import { NODE_DEFAULT_SIZES } from "./mediaGeometry";
import type { TemplateNodeKind } from "../../../types/nodeVocabulary";

export type TemplateNodeType = TemplateNodeKind;

export type TemplateGraphNode = {
  data: Record<string, unknown> & { label: string };
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  style: { height: number; width: number };
  type: TemplateNodeType;
  zIndex: number;
};

export type TemplateGraphEdge = {
  data?: {
    inputOrder?: number;
    inputRole?: string;
  };
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  type: string;
};

export type TemplateGraph = {
  edges: TemplateGraphEdge[];
  nodes: TemplateGraphNode[];
  version: 1;
};

/**
 * 生成结果、任务状态、错误/重试标记和瞬态运行时字段不进入模板。
 * 模板只保留可跨项目导入的提示词、参数、角色/顺序、上传素材身份与可信元数据。
 */
const STRIP_DATA_KEYS = new Set([
  "audioGeneratedResult",
  "audioGenerationError",
  "audioGenerationErrorCode",
  "audioGenerationInputKey",
  "audioGenerationRetryAllowed",
  "audioGenerationRetryBlockCode",
  "audioGenerationRetryBlockReason",
  "audioGenerationTaskId",
  "audioGenerating",
  "audioSrc",
  "audioWaveform",
  "groupTemplate",
  "groupRunSuccessOwnershipKey",
  "groupRunSuccessResultKey",
  "groupRunSuccessTaskId",
  "imageGeneratedSuccess",
  "imageGenerationError",
  "imageGenerationErrorCode",
  "imageGenerationInputKey",
  "imageGenerationRetryAllowed",
  "imageGenerationRetryBlockCode",
  "imageGenerationRetryBlockReason",
  "imageGenerationTaskId",
  "imageGenerating",
  "imageSrc",
  "inputState",
  "inputStateReason",
  "playlistPicking",
  "textGenerationError",
  "textGenerationErrorCode",
  "textGenerationInputKey",
  "textGenerationRetryAllowed",
  "textGenerationRetryBlockCode",
  "textGenerationRetryBlockReason",
  "textGenerationTaskId",
  "textGenerating",
  "videoGenerationError",
  "videoGenerationErrorCode",
  "videoGenerationInputKey",
  "videoGenerationRetryAllowed",
  "videoGenerationRetryBlockCode",
  "videoGenerationRetryBlockReason",
  "videoGenerationTaskId",
  "videoGenerating",
  "videoSrc",
]);

function serializeNode(node: ProbeNodeType): TemplateGraphNode {
  const data: Record<string, unknown> = { ...node.data };
  for (const key of STRIP_DATA_KEYS) {
    delete data[key];
  }
  const defaultSize =
    node.type === "group"
      ? { height: 500, width: 800 }
      : NODE_DEFAULT_SIZES[
          node.type as Exclude<ProbeNodeType["type"], "group" | "probe">
        ] ?? { height: 250, width: 250 };
  return {
    data: {
      ...data,
      label: typeof data.label === "string" ? data.label : "Node",
    },
    id: node.id,
    ...(node.parentId ? { parentId: node.parentId } : {}),
    position: { x: node.position.x, y: node.position.y },
    style: {
      height:
        typeof node.style?.height === "number"
          ? node.style.height
          : defaultSize.height,
      width:
        typeof node.style?.width === "number"
          ? node.style.width
          : defaultSize.width,
    },
    type: node.type as TemplateNodeType,
    zIndex: typeof node.zIndex === "number" ? node.zIndex : 0,
  };
}

function serializeEdge(edge: CuttableEdge): TemplateGraphEdge {
  const data: TemplateGraphEdge["data"] = {};
  if (typeof edge.data?.inputOrder === "number") {
    data.inputOrder = edge.data.inputOrder;
  }
  if (typeof edge.data?.inputRole === "string") {
    data.inputRole = edge.data.inputRole;
  }
  return {
    ...(Object.keys(data).length ? { data } : {}),
    id: edge.id,
    source: edge.source,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    target: edge.target,
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    type: edge.type ?? "cuttable",
  };
}

/**
 * 把当前画布中的一个组保存为与公共模板同构的模板图：
 * 组节点归一化到 (0,0)，子节点保持相对坐标，只收集两端都在组内的边。
 */
export function serializeGroupTemplate(options: {
  edges: readonly CuttableEdge[];
  groupId: string;
  nodes: readonly ProbeNodeType[];
}): TemplateGraph {
  const group = options.nodes.find(
    (node) => node.id === options.groupId && node.type === "group",
  );
  if (!group) throw new Error("未找到要保存的组");
  const children = options.nodes.filter(
    (node) => node.id !== options.groupId && node.parentId === options.groupId,
  );
  if (children.some((node) => node.type === "probe")) {
    throw new Error("组内包含测试节点，无法保存为模板");
  }
  const childIds = new Set(children.map((node) => node.id));
  const childEdges = options.edges
    .filter(
      (edge) => childIds.has(edge.source) && childIds.has(edge.target),
    )
    .map(serializeEdge);
  const groupNode = serializeNode(group);
  groupNode.position = { x: 0, y: 0 };
  // The serialized group is the template root even if historical canvas data
  // carried an invalid self-parent link. Never publish a cyclic template.
  delete groupNode.parentId;
  return {
    edges: childEdges,
    nodes: [groupNode, ...children.map(serializeNode)],
    version: 1,
  };
}

const PUBLIC_PRIVATE_MEDIA_KEYS = [
  "assetId",
  "audioDuration",
  "audioFileName",
  "audioFileSize",
  "mediaByteSize",
  "mediaContentType",
  "mediaDurationSeconds",
  "mediaHeight",
  "mediaMetadataSource",
  "mediaMetadataStatus",
  "mediaStorageBackend",
  "mediaWidth",
  "videoCreatedAt",
  "videoFileSize",
  "videoHeight",
  "videoWidth",
] as const;

/**
 * 公共模板不得带走项目私货素材。提示词、模型、参数、连线角色保留。
 * 只用于发公共，不得拿去改「我的模板」保存路径。
 */
export function stripPrivateMediaForPublicTemplate(
  graph: TemplateGraph,
): TemplateGraph {
  return {
    edges: graph.edges.map((edge) => ({
      ...edge,
      ...(edge.data ? { data: { ...edge.data } } : {}),
    })),
    nodes: graph.nodes.map((node) => {
      const data: Record<string, unknown> = { ...node.data };
      for (const key of PUBLIC_PRIVATE_MEDIA_KEYS) {
        delete data[key];
      }
      if (Array.isArray(data.playlistClips)) {
        data.playlistClips = data.playlistClips.map((clip) => {
          if (!clip || typeof clip !== "object") return clip;
          return { ...clip, src: "" };
        });
      }
      return {
        ...node,
        data: data as TemplateGraphNode["data"],
        position: { ...node.position },
        style: { ...node.style },
      };
    }),
    version: 1,
  };
}
