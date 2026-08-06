import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useEdges,
  useEdgesState,
  useNodes,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type Connection,
  type Edge,
  type EdgeProps,
  type NodeChange,
  type NodePositionChange,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { AudioNode } from "./AudioNode";
import { CanvasGraphMutationContext } from "./CanvasGraphMutationContext";
import {
  CanvasCheckpointContext,
  closestEditableControl,
  useCanvasCheckpoint,
} from "./CanvasHistory";
import { CanvasSelectionUiContext } from "./CanvasSelectionContext";
import { GroupNode } from "./GroupNode";
import { ImageNode } from "./ImageNode";
import { uploadImageAsset } from "./imageAsset";
import { withImageReferenceInputMode } from "./imageReferenceMode";
import { PlaylistNode } from "./PlaylistNode";
import { ProbeNode, type ProbeNodeType } from "./ProbeNode";
import { hasInteractionProbeNodes } from "./probeFixtures";
import { StoryboardTableNode } from "./StoryboardTableNode";
import { TextNode } from "./TextNode";
import { VideoNode } from "./VideoNode";
import type { CuttableEdge } from "./canvasTypes";
import { fitVisualMediaSize, NODE_DEFAULT_SIZES } from "./mediaGeometry";
import { trustedMediaPatch } from "./mediaInputMetadata";
import {
  canvasDocumentFingerprint,
  canvasGraphFingerprint,
} from "./canvasDocumentFingerprint";
import { zoomViewportAtScreenPoint } from "./viewportMath";
import {
  connectedEdgeFlowDirections,
  selectionFlowAnimatedEdgeIds,
  stripSelectionFlowMarkers,
} from "./selectionFlow";
import { GenerationCanvasContext } from "../generation/GenerationCanvasContext";
import { WorkflowExecutionProvider } from "../generation/WorkflowExecutionProvider";
import {
  resolvePublishedModel,
  type PublishedModel,
  usePublishedModels,
} from "../models/ModelCatalog";
import {
  defaultNodeInputRole,
  isNodeInputConnectionAllowed,
  isNodeInputKind,
  nextNodeInputOrder,
} from "../../../types/nodeInputs";
import {
  normalizeParameterValues,
  parameterFieldEnabled,
  parameterOptionEnabled,
} from "../../../types/modelParameters";
import { normalizePersistedMediaNodes } from "../../../types/persistedMediaSources";

const emptyNodes: ProbeNodeType[] = [];
type HistoryEntry =
  | {
      edges: CuttableEdge[];
      kind: "delete";
      nodes: ProbeNodeType[];
    }
  | {
      edges: CuttableEdge[];
      kind: "snapshot";
      nodes: ProbeNodeType[];
    };
type BatchConnectionDrag = {
  cursor: { x: number; y: number };
  pointerId: number;
  sources: Array<{ id: string; x: number; y: number }>;
};
type SourceConnectMenu = {
  drop: { x: number; y: number };
  kind: "audio" | "image" | "video";
  sourceId: string;
};
type CreateMenu = {
  flow: { x: number; y: number };
  screen: { x: number; y: number };
};
type BlankContextMenu = CreateMenu & {
  canPaste: boolean;
  canUndo: boolean;
};
type NodeContextMenu = {
  nodeId: string;
  screen: { x: number; y: number };
};
export type AgentCanvasReference = {
  id: string;
  thumbnail?: string;
  title: string;
};

export type CanvasShellMenuCommand = {
  action: "apply-template" | "dismiss" | "toggle-add";
  graph?: {
    edges: Array<{
      id: string;
      source: string;
      sourceHandle: "source";
      target: string;
      targetHandle: "target";
      type: "cuttable";
    }>;
    nodes: Array<{
      data: Record<string, unknown> & { label: string };
      id: string;
      parentId?: string;
      position: { x: number; y: number };
      style?: { height: number; width: number };
      type: "group" | "image" | "text" | "video";
      zIndex?: number;
    }>;
    version: 1;
  };
  sequence: number;
};
export type CanvasSearchEntry = {
  category: "全部" | "图片" | "视频" | "文本" | "音频" | "World" | "分组";
  detail: string;
  id: string;
  searchText: string;
  thumbnail?: string;
  title: string;
  type: ProbeNodeType["type"];
};
export type CanvasLibraryAsset = {
  id: string;
  kind: "audio" | "image" | "video";
  label: string;
  src: string;
};
export const CANVAS_LIBRARY_ASSET_MIME =
  "application/x-tapnow-library-asset";
const emptyEdges: CuttableEdge[] = [];
const PERSIST_DEBOUNCE_MS = 500;
const nodeSize = (node: ProbeNodeType) => ({
  height:
    node.measured?.height ??
    (typeof node.style?.height === "number" ? node.style.height : 0),
  width:
    node.measured?.width ??
    (typeof node.style?.width === "number" ? node.style.width : 0),
});
const collisionNode = (node: ProbeNodeType) =>
  !node.parentId &&
  node.type !== "group" &&
  node.data.variant !== "group";
const overlapArea = (
  first: ProbeNodeType,
  firstPosition: { x: number; y: number },
  second: ProbeNodeType,
  secondPosition: { x: number; y: number },
) => {
  const firstSize = nodeSize(first);
  const secondSize = nodeSize(second);
  const width = Math.max(
    0,
    Math.min(
      firstPosition.x + firstSize.width,
      secondPosition.x + secondSize.width,
    ) - Math.max(firstPosition.x, secondPosition.x),
  );
  const height = Math.max(
    0,
    Math.min(
      firstPosition.y + firstSize.height,
      secondPosition.y + secondSize.height,
    ) - Math.max(firstPosition.y, secondPosition.y),
  );
  return width * height;
};
const nodeTypes = {
  audio: AudioNode,
  group: GroupNode,
  image: ImageNode,
  playlist: PlaylistNode,
  probe: ProbeNode,
  storyboard: StoryboardTableNode,
  text: TextNode,
  video: VideoNode,
};

/**
 * Apply the Video mode upgrade used by both single and batch edge creation.
 * An existing saved model id must resolve exactly; otherwise the user's old
 * parameters stay untouched until they explicitly choose another model.
 */
export function withVideoReferenceInputModeForNewEdges(
  node: ProbeNodeType,
  videoModels: PublishedModel[] | undefined,
  addedMediaKinds: readonly ("audio" | "image" | "video")[],
  imageCountAfterConnection: number,
): ProbeNodeType {
  if (node.type !== "video" || !addedMediaKinds.length) return node;
  const model = resolvePublishedModel(videoModels, node.data.videoModelId);
  const schema = model?.parameterSchema;
  if (!schema) return node;
  const parameters = normalizeParameterValues(schema, node.data.videoParameters);
  const inputMode = schema.fields.find((field) => field.key === "inputMode");
  const multimodal = inputMode?.options.find(
    (option) => option.value === "multimodal",
  );
  if (
    !inputMode ||
    !multimodal ||
    (multimodal.availability ?? "available") !== "available" ||
    !parameterFieldEnabled(inputMode, parameters) ||
    !parameterOptionEnabled(multimodal, parameters)
  ) {
    return node;
  }

  const currentMode = String(parameters.inputMode ?? inputMode.defaultValue);
  const shouldUpgrade = currentMode === "text" || (
    currentMode === "first-last-frame" && (
      addedMediaKinds.some((kind) => kind === "video" || kind === "audio") ||
      imageCountAfterConnection > 2
    )
  );
  if (!shouldUpgrade) return node;

  return {
    ...node,
    data: {
      ...node.data,
      videoParameters: {
        ...node.data.videoParameters,
        inputMode: "multimodal",
      },
    },
  };
}

const sourceMenuItems = {
  image: [
    { description: "脚本、广告词、品牌文案", icon: "text", label: "文本生成" },
    { description: "宣传图、海报、封面", icon: "image", label: "图片生成" },
    { description: "宣传视频、动画、电影", icon: "video", label: "视频生成" },
    { description: "编辑、调整和组合图片", icon: "edit", label: "图片编辑器" },
    {
      beta: true,
      description: "场景与资产生成、导演编排",
      icon: "world",
      label: "3D 世界",
    },
  ],
  video: [
    { description: "脚本、广告词、品牌文案", icon: "text", label: "文本生成" },
    { description: "音乐、配音、音效", icon: "audio", label: "音频生成" },
    { description: "剪辑、拼接和处理视频", icon: "edit", label: "视频编辑" },
    {
      beta: true,
      description: "场景与资产生成、导演编排",
      icon: "world",
      label: "3D 世界",
    },
  ],
  audio: [
    { description: "宣传视频、动画、电影", icon: "video", label: "视频生成" },
    { description: "数字人、口播、虚拟主播", icon: "person", label: "数字人视频" },
  ],
} as const;

function SourceMenuIcon({ name }: { name: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {name === "text" && <path d="M4 6h16M4 12h11M4 18h8" />}
      {name === "image" && (
        <>
          <rect height="16" rx="3" width="18" x="3" y="4" />
          <circle cx="16" cy="9" r="1.5" />
          <path d="m5 17 4-4 3 3 2-2 5 5" />
        </>
      )}
      {name === "video" && (
        <>
          <rect height="16" rx="3" width="18" x="3" y="4" />
          <path d="m10 9 5 3-5 3Z" />
        </>
      )}
      {name === "audio" && (
        <path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 10v4" />
      )}
      {name === "edit" && (
        <>
          <path d="M4 20h4L19 9l-4-4L4 16Z" />
          <path d="m13 7 4 4" />
        </>
      )}
      {name === "person" && (
        <>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" />
        </>
      )}
      {name === "world" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" />
        </>
      )}
      {name === "upload" && (
        <>
          <path d="M12 16V4M8 8l4-4 4 4" />
          <path d="M5 15v4h14v-4" />
        </>
      )}
      {name === "playlist" && (
        <>
          <rect height="14" rx="2" width="14" x="5" y="5" />
          <path d="M5 9h3M5 15h3M16 9h3M16 15h3M9 5v14M15 5v14" />
        </>
      )}
    </svg>
  );
}

function CuttableEdge({
  data,
  id,
  interactionWidth,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<CuttableEdge>) {
  const { setEdges } = useReactFlow<ProbeNodeType, CuttableEdge>();
  const checkpoint = useCanvasCheckpoint();
  const [path, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });

  return (
    <>
      <BaseEdge
        interactionWidth={interactionWidth}
        labelX={labelX}
        labelY={labelY}
        path={path}
        style={style}
      />
      {data?.flowAnimated && (
        <path
          className="edge-selection-flow"
          d={path}
          style={{
            animationDirection: data.flowDirection === -1 ? "reverse" : "normal",
          }}
        />
      )}
      {data?.animatedHighlight && (
        <path className="workflow-edge-highlight" d={path} />
      )}
      {data?.cutIndicator && (
        <EdgeLabelRenderer>
          <button
            aria-label="删除连线"
            className="cut-edge-button nodrag nopan"
            data-edge-cut-for={id}
            data-testid={`cut-edge-${id}`}
            onClick={(event) => {
              event.stopPropagation();
              checkpoint();
              setEdges((current) => current.filter((edge) => edge.id !== id));
            }}
            onMouseLeave={() => {
              setEdges((current) =>
                current.map((edge) =>
                  edge.id === id && edge.data?.cutIndicator === "hover"
                    ? {
                        ...edge,
                        data: { ...edge.data, cutIndicator: undefined },
                      }
                    : edge,
                ),
              );
            }}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7 17a3 3 0 1 0 0 .01M17 17a3 3 0 1 0 0 .01M9.15 14.85 18 4M6 4l8.85 10.85" />
            </svg>
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { cuttable: CuttableEdge };

function ConnectionEscapeGuard() {
  const store = useStoreApi<ProbeNodeType, CuttableEdge>();

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        store.getState().cancelConnection();
      }
    };

    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [store]);

  return null;
}

function createProbeNodes(fixtureId?: string): ProbeNodeType[] {
  if (!fixtureId || fixtureId === "default") {
    return [];
  }

  if (
    fixtureId === "interaction.upload-image" ||
    fixtureId === "panel.assets.drag-ready"
  ) {
    return [];
  }

  if (fixtureId === "interaction.edge-auto-scroll-and-collision") {
    return [
      {
        id: "collision-a",
        type: "probe",
        position: { x: 300, y: 260 },
        data: { label: "拖动节点 A" },
        style: { height: 250, width: 250 },
        zIndex: 0,
      },
      {
        id: "collision-b",
        type: "probe",
        position: { x: 700, y: 260 },
        data: { label: "固定节点 B" },
        style: { height: 250, width: 250 },
        zIndex: 0,
      },
    ];
  }

  if (fixtureId === "menu.canvas-context.node") {
    const image =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%23ead7c2'/%3E%3Cstop offset='1' stop-color='%237e909d'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1600' height='900' fill='url(%23g)'/%3E%3Ccircle cx='800' cy='350' r='150' fill='%23f3d7c1'/%3E%3Cpath d='M480 900c35-390 605-390 640 0' fill='%235e7181'/%3E%3C/svg%3E";
    return [
      {
        id: "context-image",
        type: "image",
        position: { x: 330, y: 220 },
        data: {
          imageGeneratedSuccess: true,
          imageSrc: image,
          label: "Image",
          sourceKind: "image",
          title: "人物参考图",
        },
        style: { height: 250, width: 444 },
      },
    ];
  }

  if (fixtureId === "interaction.node-search.populated") {
    const image =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='900'%3E%3Crect width='900' height='900' fill='%23f3f3f3'/%3E%3Crect x='255' y='255' width='390' height='390' rx='24' fill='%23d62828'/%3E%3C/svg%3E";
    return [
      {
        id: "search-text",
        type: "text",
        position: { x: 130, y: 260 },
        data: {
          content: "晨光城市里，一家小店开始讲述自己的品牌故事。",
          label: "Text",
          title: "品牌故事文案",
        },
        style: { height: 250, width: 250 },
      },
      {
        id: "search-image",
        type: "image",
        position: { x: 450, y: 260 },
        data: {
          imagePrompt:
            "A solid red square centered on a plain white background.",
          imageSrc: image,
          label: "Image",
          sourceKind: "image",
          title: "红色方块海报",
        },
        style: { height: 250, width: 250 },
      },
      {
        id: "search-video",
        type: "video",
        position: { x: 770, y: 260 },
        data: {
          label: "Video",
          sourceKind: "video",
          title: "城市宣传视频",
          videoPrompt: "镜头从街道缓慢推进到发光的商店招牌。",
        },
        style: { height: 250, width: 444 },
      },
    ];
  }

  if (fixtureId === "menu.agent.add-and-model") {
    const image =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='1200'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%23ead7c2'/%3E%3Cstop offset='1' stop-color='%237e909d'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='900' height='1200' fill='url(%23g)'/%3E%3Ccircle cx='450' cy='390' r='125' fill='%23f3d7c1'/%3E%3Cpath d='M240 1030c25-330 395-330 420 0' fill='%235e7181'/%3E%3C/svg%3E";
    return [
      {
        id: "agent-reference-image",
        type: "image",
        position: { x: 150, y: 245 },
        data: {
          imageGeneratedSuccess: true,
          imageSrc: image,
          label: "Image",
          sourceKind: "image",
          title: "人物参考图",
        },
        style: { height: 250, width: 188 },
      },
      {
        id: "agent-reference-crop",
        type: "image",
        position: { x: 410, y: 285 },
        data: {
          imageGeneratedSuccess: true,
          imageSrc: image,
          label: "Image",
          sourceKind: "image",
          title: "裁剪参考图",
        },
        style: { height: 188, width: 141 },
      },
    ];
  }

  if (fixtureId === "persistence.revision-conflict") {
    return [
      {
        id: "conflict-node",
        type: "probe",
        position: { x: 480, y: 260 },
        data: { label: "两页同时编辑" },
        style: { height: 250, width: 250 },
      },
    ];
  }

  if (fixtureId === "panel.history.final") {
    const image =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='900'%3E%3Cdefs%3E%3CradialGradient id='g'%3E%3Cstop stop-color='%23b42121'/%3E%3Cstop offset='1' stop-color='%2311161b'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='900' height='900' fill='url(%23g)'/%3E%3C/svg%3E";
    return [
      {
        id: "history-canvas-image",
        type: "image",
        position: { x: 520, y: 140 },
        data: {
          assetId: "history-image-1",
          imageSrc: image,
          label: "Image",
          sourceKind: "image",
          title: "历史图片",
        },
        style: { height: 250, width: 250 },
      },
      {
        id: "history-canvas-video",
        type: "video",
        position: { x: 860, y: 140 },
        data: {
          assetId: "history-video-1",
          label: "Video",
          sourceKind: "video",
          title: "历史视频",
        },
        style: { height: 250, width: 444 },
      },
      {
        id: "history-canvas-audio",
        type: "audio",
        position: { x: 520, y: 500 },
        data: {
          assetId: "history-audio-1",
          label: "Audio",
          sourceKind: "audio",
          title: "历史音频",
        },
        style: { height: 250, width: 444 },
      },
    ];
  }

  if (fixtureId === "persistence.final-clean-canvas") {
    return [
      {
        id: "clean-a",
        type: "probe",
        position: { x: 260, y: 220 },
        data: { label: "待清空 A" },
        style: { height: 250, width: 250 },
      },
      {
        id: "clean-b",
        type: "probe",
        position: { x: 650, y: 220 },
        data: { label: "待清空 B" },
        style: { height: 250, width: 250 },
      },
      {
        id: "clean-c",
        type: "probe",
        position: { x: 1040, y: 220 },
        data: { label: "待清空 C" },
        style: { height: 250, width: 250 },
      },
    ];
  }

  if (fixtureId === "persistence.nodes-assets-viewport") {
    const image =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Crect width='1600' height='900' fill='%23545f6c'/%3E%3Cpath d='M0 700 500 300l380 280 260-210 460 330v200H0Z' fill='%23849caf'/%3E%3C/svg%3E";
    return [
      {
        id: "persistent-text",
        type: "text",
        position: { x: 80, y: 100 },
        data: { content: "刷新页面后，这些内容仍然存在。", label: "Text", title: "持久化文字" },
        style: { height: 250, width: 250 },
      },
      ...[380, 870].map((x, index): ProbeNodeType => ({
        id: `persistent-image-${index + 1}`,
        type: "image",
        position: { x, y: 100 },
        data: {
          assetId: "asset-shared-landscape",
          imageSrc: image,
          label: "Image",
          sourceKind: "image",
          title: `共享素材 ${index + 1}`,
        },
        style: { height: 250, width: 444 },
      })),
      {
        id: "persistent-audio",
        type: "audio",
        position: { x: 80, y: 480 },
        data: {
          assetId: "asset-audio-184",
          audioDuration: 184,
          audioSrc: "data:audio/wav;base64,AAAA",
          audioWaveform: Array.from({ length: 64 }, (_, index) => 12 + (index % 8) * 5),
          label: "Audio",
          sourceKind: "audio",
          title: "03:04 音频",
        },
        style: { height: 250, width: 444 },
      },
      {
        id: "persistent-video",
        type: "video",
        position: { x: 580, y: 480 },
        data: {
          assetId: "asset-video-demo",
          label: "Video",
          sourceKind: "video",
          title: "持久化视频",
          videoDuration: 12,
          videoHeight: 900,
          videoSrc: "data:video/mp4;base64,AAAA",
          videoWidth: 1600,
        },
        style: { height: 250, width: 444 },
      },
      {
        id: "persistent-playlist",
        type: "playlist",
        position: { x: 80, y: 840 },
        data: { label: "Playlist", title: "持久化播放列表" },
        style: { height: 104, width: 960 },
      },
    ];
  }

  if (fixtureId === "legacy.node-geometry.families") {
    const mediaLandscape = fitVisualMediaSize(16, 9);
    const mediaPortrait = fitVisualMediaSize(9, 16);
    const landscapeImage =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Crect width='1600' height='900' fill='%23545f6c'/%3E%3C/svg%3E";
    const portraitImage =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='1600'%3E%3Crect width='900' height='1600' fill='%234a6171'/%3E%3C/svg%3E";

    return [
      {
        id: "geometry-default-text",
        type: "text",
        position: { x: 80, y: 90 },
        data: { content: "", label: "Text", title: "默认尺寸 · Text" },
        style: { ...NODE_DEFAULT_SIZES.text },
      },
      {
        id: "geometry-default-image",
        type: "image",
        position: { x: 390, y: 90 },
        data: { label: "Image", sourceKind: "image", title: "默认尺寸 · Image" },
        style: { ...NODE_DEFAULT_SIZES.image },
      },
      {
        id: "geometry-default-video",
        type: "video",
        position: { x: 700, y: 90 },
        data: { label: "Video", sourceKind: "video", title: "默认尺寸 · Video" },
        style: { ...NODE_DEFAULT_SIZES.video },
      },
      {
        id: "geometry-default-audio",
        type: "audio",
        position: { x: 1200, y: 90 },
        data: { label: "Audio", sourceKind: "audio", title: "默认尺寸 · Audio" },
        style: { ...NODE_DEFAULT_SIZES.audio },
      },
      {
        id: "geometry-default-playlist",
        type: "playlist",
        position: { x: 1700, y: 90 },
        data: { label: "Playlist", title: "默认尺寸 · Playlist" },
        style: { ...NODE_DEFAULT_SIZES.playlist },
      },
      {
        id: "geometry-media-image-landscape",
        type: "image",
        position: { x: 80, y: 520 },
        data: {
          imageSrc: landscapeImage,
          label: "Image",
          sourceKind: "image",
          title: "素材自适应 · Image 16:9",
        },
        style: mediaLandscape,
      },
      {
        id: "geometry-media-image-portrait",
        type: "image",
        position: { x: 600, y: 520 },
        data: {
          imageSrc: portraitImage,
          label: "Image",
          sourceKind: "image",
          title: "素材自适应 · Image 9:16",
        },
        style: mediaPortrait,
      },
      {
        id: "geometry-media-video-landscape",
        type: "video",
        position: { x: 920, y: 520 },
        data: {
          label: "Video",
          sourceKind: "video",
          title: "素材自适应 · Video 16:9",
          videoHeight: 900,
          videoSrc: "data:video/mp4;base64,AAAA",
          videoWidth: 1600,
        },
        style: mediaLandscape,
      },
      {
        id: "geometry-media-video-portrait",
        type: "video",
        position: { x: 1450, y: 520 },
        data: {
          label: "Video",
          sourceKind: "video",
          title: "素材自适应 · Video 9:16",
          videoHeight: 1600,
          videoSrc: "data:video/mp4;base64,AAAA",
          videoWidth: 900,
        },
        style: mediaPortrait,
      },
      {
        id: "geometry-user-text",
        type: "text",
        position: { x: 80, y: 1100 },
        data: { content: "", label: "Text", title: "用户调整 · Text" },
        style: { height: 320, width: 395 },
      },
      {
        id: "geometry-user-playlist",
        type: "playlist",
        position: { x: 580, y: 1100 },
        data: { label: "Playlist", title: "用户调整 · Playlist" },
        style: { height: 220, width: 1100 },
      },
      {
        id: "geometry-user-group",
        type: "group",
        position: { x: 1760, y: 1100 },
        data: { label: "Group", title: "用户调整 · Group" },
        style: { height: 420, width: 1034 },
      },
    ];
  }

  if (fixtureId === "legacy.node.storyboard-table") {
    return [
      {
        id: "storyboard-table-primary",
        type: "storyboard",
        position: { x: 0, y: 0 },
        data: {
          label: "Storyboard/Table",
          title: "剪辑结果 (0:03.5)",
          storyboardShots: [
            {
              dialogue: "无对白",
              duration: "7s",
              framing: "近景",
              id: "shot-1",
              mediaTone: "desk",
              notes: "一个人独自在桌前，环境安静，镜头缓慢推进。",
              number: 1,
              status: "complete",
              summary: "画面展示一张黑色办公桌与键盘，桌面陈设简洁。",
            },
            {
              dialogue: "无对白",
              duration: "3.04s",
              framing: "特写",
              id: "shot-2",
              mediaTone: "monitor",
              notes: "屏幕成为视觉焦点，光线从右侧落在桌面。",
              number: 2,
              status: "complete",
              summary: "画面中摆放着曲面显示器，键盘与鼠标位于前景。",
            },
            {
              dialogue: "—",
              duration: "—",
              framing: "—",
              id: "shot-3",
              mediaTone: "loading",
              notes: "等待生成",
              number: 3,
              status: "loading",
              summary: "正在生成分镜",
            },
          ],
        },
        style: { ...NODE_DEFAULT_SIZES.storyboard },
        zIndex: 0,
      },
    ];
  }

  if (
    fixtureId === "node.playlist.workflow" ||
    fixtureId === "node.playlist.pick-ready" ||
    fixtureId === "node.playlist.clips-ready"
  ) {
    const pickReady = fixtureId === "node.playlist.pick-ready";
    const clipsReady = fixtureId === "node.playlist.clips-ready";
    return [
      {
        id: "video-source-a",
        type: "video",
        position: { x: 120, y: 100 },
        data: {
          label: "Video",
          sourceKind: "video",
          title: "视频 A",
          videoDuration: clipsReady ? 4 : pickReady ? 5.088 : undefined,
          videoHeight: clipsReady ? 320 : pickReady ? 480 : undefined,
          videoSrc: clipsReady
            ? "/fixtures/playlist-portrait.mp4"
            : pickReady
              ? "/fixtures/video-success.mp4"
              : undefined,
          videoWidth: clipsReady ? 180 : pickReady ? 836 : undefined,
        },
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
      {
        id: "video-source-b",
        type: "video",
        position: { x: 600, y: 100 },
        data: {
          label: "Video",
          sourceKind: "video",
          title: "视频 B",
          videoDuration: pickReady || clipsReady ? 5.088 : undefined,
          videoHeight: pickReady || clipsReady ? 480 : undefined,
          videoSrc:
            pickReady || clipsReady ? "/fixtures/video-success.mp4" : undefined,
          videoWidth: pickReady || clipsReady ? 836 : undefined,
        },
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
      {
        id: "playlist-primary",
        type: "playlist",
        position: { x: 120, y: 460 },
        data: {
          label: "Playlist",
          playlistClips: clipsReady
            ? [
                {
                  end: 4,
                  id: "clip-video-source-a",
                  sourceEnd: 4,
                  sourceNodeId: "video-source-a",
                  sourceStart: 0,
                  src: "/fixtures/playlist-portrait.mp4",
                  start: 0,
                  title: "视频 A",
                },
                {
                  end: 5.088,
                  id: "clip-video-source-b",
                  sourceEnd: 5.088,
                  sourceNodeId: "video-source-b",
                  sourceStart: 0,
                  src: "/fixtures/video-success.mp4",
                  start: 0,
                  title: "视频 B",
                },
              ]
            : undefined,
          title: "Playlist",
        },
        selected: true,
        style: { width: 960, height: 104 },
        zIndex: 0,
      },
    ];
  }

  if (fixtureId === "node.playlist.empty") {
    return [
      {
        id: "playlist-primary",
        type: "playlist",
        position: { x: 140, y: 340 },
        data: { label: "Playlist", title: "Playlist" },
        style: { width: 960, height: 104 },
        zIndex: 0,
      },
    ];
  }

  if (
    fixtureId === "node.audio.empty" ||
    fixtureId === "node.audio.success"
  ) {
    const success = fixtureId === "node.audio.success";
    const results = success ? 2 : 1;
    return Array.from({ length: results }, (_, index) => ({
      id: index ? `audio-result-${index + 1}` : "audio-primary",
      type: "audio" as const,
      position: { x: success ? 120 + index * 560 : 345, y: 300 },
      data: {
        audioDuration: success ? 184 : undefined,
        audioFileName: success ? `audio-result-${index + 1}.mp3` : undefined,
        audioFileSize: success ? 368_000 : undefined,
        audioGeneratedResult: success,
        audioSrc: success ? "/fixtures/audio-success.mp3" : undefined,
        audioWaveform: success
          ? Array.from(
              { length: 64 },
              (_, bar) => 10 + ((bar * (index ? 23 : 17)) % 48),
            )
          : undefined,
        label: "Audio",
        sourceKind: "audio" as const,
        title: success ? `Audio ${index + 1}` : "Audio",
      },
      selected: success && index === 0,
      style: { width: 444, height: 250 },
      zIndex: 0,
    }));
  }

  if (fixtureId === "interaction.upload-media-sandbox-current") {
    return [
      {
        id: "audio-upload-primary",
        type: "audio",
        position: { x: 120, y: 300 },
        data: {
          label: "Audio",
          sourceKind: "audio",
          title: "Audio",
        },
        selected: false,
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
      {
        id: "video-upload-primary",
        type: "video",
        position: { x: 700, y: 300 },
        data: {
          label: "Video",
          sourceKind: "video",
          title: "Video",
        },
        selected: true,
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
    ];
  }

  if (
    fixtureId === "node.video.empty" ||
    fixtureId === "node.video.generating" ||
    fixtureId === "node.video.success"
  ) {
    const success = fixtureId === "node.video.success";
    const generating = fixtureId === "node.video.generating";
    return [
      {
        id: "video-primary",
        type: "video",
        position: { x: 345, y: 300 },
        data: {
          label: "Video",
          sourceKind: "video",
          title: "Video",
          videoGenerating: generating,
          videoAudioEnabled: success,
          videoCreatedAt: success ? "2026/07/27" : undefined,
          videoDuration: success ? 5.088 : undefined,
          videoFileSize: success ? 11_000 : undefined,
          videoHeight: success ? 480 : undefined,
          videoModel: success ? "Seedance 2.0 Mini" : undefined,
          videoPrompt: generating
            ? "A red square slowly moves from left to right on a plain white background. Minimal UI test."
            : success
              ? "A red square slowly moves from left to right on a plain white background. Minimal UI test."
              : undefined,
          videoPromptReady: generating || success,
          videoSrc: success ? "/fixtures/video-success.mp4" : undefined,
          videoWidth: success ? 836 : undefined,
        },
        selected: generating || success,
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
    ];
  }

  if (fixtureId === "node.image.reference-ready") {
    const reference =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='900'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%23d8c7b8'/%3E%3Cstop offset='1' stop-color='%236c7780'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='900' height='900' fill='url(%23g)'/%3E%3Ccircle cx='450' cy='330' r='140' fill='%23efd2bd'/%3E%3Cpath d='M210 900c22-330 458-330 480 0' fill='%234b5965'/%3E%3C/svg%3E";
    return [
      {
        id: "image-reference-source",
        type: "image",
        position: { x: 180, y: 220 },
        data: {
          assetId: "fixture-reference-image",
          imageGeneratedSuccess: true,
          imageSrc: reference,
          label: "Image",
          sourceKind: "image",
          title: "人物参考图",
        },
        style: { height: 250, width: 250 },
        zIndex: 0,
      },
      {
        id: "image-reference-target",
        type: "image",
        position: { x: 620, y: 220 },
        data: {
          imagePrompt: "保持人物特征，改成自然的户外背景。",
          imagePromptReady: true,
          label: "Image",
          sourceKind: "image",
          title: "图片生成",
        },
        selected: true,
        style: { height: 250, width: 250 },
        zIndex: 0,
      },
    ];
  }

  if (
    fixtureId === "node.image.text-image-input" ||
    fixtureId === "node.image.text-image-input.persistence-retest"
  ) {
    const garment =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='1200'%3E%3Crect width='900' height='1200' fill='%23f7f7f5'/%3E%3Cpath d='M315 220 220 300l90 170 65-40v510h150V430l65 40 90-170-95-80-75 65H390z' fill='%23b04438'/%3E%3Cpath d='M390 220c15 75 105 75 120 0' fill='none' stroke='%23872e28' stroke-width='22'/%3E%3C/svg%3E";
    return [
      {
        id: "input-master-text",
        type: "text",
        position: { x: 80, y: 130 },
        data: {
          content: "电商白底产品图，保留服装材质和版型，干净柔和棚拍光线。",
          label: "Text",
          title: "白底图提示词母版",
        },
        style: { height: 250, width: 250 },
      },
      {
        id: "input-garment-image",
        type: "image",
        position: { x: 80, y: 470 },
        data: {
          assetId: "fixture-garment-image",
          imageGeneratedSuccess: true,
          imageSrc: garment,
          label: "Image",
          sourceKind: "image",
          title: "服装照片",
        },
        style: { height: 300, width: 225 },
      },
      {
        id: "input-target-image",
        type: "image",
        position: { x: 560, y: 280 },
        data: {
          imageParameters: { inputMode: "image" },
          imagePrompt: "",
          imagePromptReady: true,
          label: "Image",
          sourceKind: "image",
          title: "商品白底图",
        },
        selected: true,
        style: { height: 300, width: 300 },
      },
    ];
  }

  if (
    fixtureId === "node.image.empty" ||
    fixtureId === "node.image.generating" ||
    fixtureId === "node.image.prompt-ready" ||
    fixtureId === "node.image.success"
  ) {
    const success = fixtureId === "node.image.success";
    const generating = fixtureId === "node.image.generating";
    return [
      {
        id: "image-primary",
        type: "image",
        position: { x: 442, y: 300 },
        data: {
          imageGenerating: generating,
          imageGeneratedSuccess: success,
          imagePrompt:
            generating || success
              ? "A solid red square centered on a plain white background. Minimal test image."
              : undefined,
          imagePromptReady:
            fixtureId === "node.image.prompt-ready" || generating || success,
          imageSrc: success ? "/fixtures/image-success.svg" : undefined,
          label: "Image",
          sourceKind: "image",
          title: "Image",
        },
        selected:
          fixtureId === "node.image.prompt-ready" || generating || success,
        style: { width: 250, height: 250 },
        zIndex: 0,
      },
    ];
  }

  if (
    fixtureId === "node.text.empty" ||
    fixtureId === "node.text.creator-open" ||
    fixtureId === "node.text.selected-editing"
  ) {
    return [
      {
        id: "text-primary",
        type: "text",
        position: { x: 442, y: 300 },
        data: {
          content: "",
          label: "Text",
          textPromptReady: fixtureId === "node.text.creator-open",
          title: "Text",
        },
        selected:
          fixtureId === "node.text.selected-editing" ||
          fixtureId === "node.text.creator-open",
        style: { width: 250, height: 250 },
        zIndex: 0,
      },
    ];
  }

  if (fixtureId === "node.group.selected") {
    return [
      {
        id: "group-primary",
        type: "group",
        position: { x: 150, y: 270 },
        data: { label: "Group", title: "新建组" },
        selected: true,
        style: { height: 290, width: 1034 },
        zIndex: 0,
      },
      {
        id: "group-image",
        type: "image",
        parentId: "group-primary",
        position: { x: 20, y: 20 },
        data: { label: "Image", sourceKind: "image", title: "Image" },
        style: { height: 250, width: 250 },
        zIndex: 1,
      },
      {
        id: "group-video",
        type: "video",
        parentId: "group-primary",
        position: { x: 570, y: 20 },
        data: { label: "Video", sourceKind: "video", title: "Video" },
        style: { height: 250, width: 444 },
        zIndex: 1,
      },
    ];
  }

  if (fixtureId === "legacy.node.group-dense-selected") {
    const image =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'%3E%3Crect width='1600' height='900' fill='%23475362'/%3E%3C/svg%3E";
    return [
      {
        id: "group-dense-primary",
        type: "group",
        position: { x: 200, y: 600 },
        data: {
          groupColor: "rgba(255, 255, 255, 0.04)",
          groupTemplate: true,
          label: "Group",
          title: "模板组",
        },
        selected: true,
        style: { height: 2111, width: 3443 },
        zIndex: 0,
      },
      ...[
        [120, 140],
        [1450, 140],
        [2750, 140],
        [120, 1580],
        [1450, 1580],
        [2750, 1580],
      ].map(([x, y], index): ProbeNodeType => ({
        id: `group-dense-image-${index + 1}`,
        type: "image",
        parentId: "group-dense-primary",
        position: { x, y },
        data: {
          imageSrc: image,
          label: "Image",
          sourceKind: "image",
          title: `素材 ${index + 1}`,
        },
        style: { height: 250, width: 444 },
        zIndex: 1,
      })),
    ];
  }

  if (fixtureId === "legacy.dense-canvas.neutral") {
    const groups: ProbeNodeType[] = [
      [0, 0, 2000, 1400],
      [2200, 0, 2000, 1400],
      [4400, 0, 2000, 1400],
      [800, 1700, 2500, 2200],
      [3400, 1700, 2600, 2200],
    ].map(([x, y, width, height], index) => ({
      id: `dense-group-${index + 1}`,
      type: "probe",
      position: { x, y },
      data: { label: `Group ${index + 1}`, variant: "group" },
      style: { width, height },
      zIndex: -1,
    }));
    const labels = ["Text", "Image", "Video", "Audio", "Playlist"];
    const content: ProbeNodeType[] = Array.from({ length: 57 }, (_, index) => {
      const label = labels[index % labels.length];
      return {
        id: `dense-node-${index + 1}`,
        type: "probe",
        position: {
          x: 260 + (index % 8) * 750,
          y: 180 + Math.floor(index / 8) * 480,
        },
        data: {
          assetId: `asset-dense-${index + 1}`,
          label,
        },
        style: {
          width: label === "Video" || label === "Audio" ? 444 : 250,
          height: label === "Playlist" ? 340 : 250,
        },
        zIndex: 0,
      };
    });

    return [...groups, ...content];
  }

  if (fixtureId === "workflow.text-to-video.created") {
    return [
      {
        id: "workflow-text",
        type: "text",
        position: { x: 250, y: 260 },
        data: {
          assetId: "asset-workflow-text",
          content:
            "A cinematic wide shot with soft natural light and smooth camera movement.",
          label: "Text",
        },
        style: { width: 250, height: 250 },
        zIndex: 0,
      },
      {
        id: "workflow-video",
        type: "probe",
        position: { x: 650, y: 260 },
        data: {
          assetId: "asset-workflow-video",
          label: "Video",
          sourceKind: "video",
        },
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
    ];
  }

  if (fixtureId === "interaction.source-aware-connect-menus-current") {
    return [
      {
        id: "probe-image",
        type: "probe",
        position: { x: 220, y: 180 },
        data: {
          assetId: "asset-probe-image",
          label: "Image",
          sourceKind: "image",
        },
        style: { width: 250, height: 250 },
        zIndex: 0,
      },
      {
        id: "probe-video",
        type: "probe",
        position: { x: 650, y: 180 },
        data: {
          assetId: "asset-probe-video",
          label: "Video",
          sourceKind: "video",
        },
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
      {
        id: "probe-audio",
        type: "probe",
        position: { x: 410, y: 520 },
        data: {
          assetId: "asset-probe-audio",
          label: "Audio",
          sourceKind: "audio",
        },
        style: { width: 444, height: 250 },
        zIndex: 0,
      },
    ];
  }

  if (fixtureId === "interaction.typed-input-matrix") {
    return [
      {
        id: "typed-audio-source",
        type: "audio",
        position: { x: 180, y: 280 },
        data: {
          assetId: "fixture-audio-source",
          audioDuration: 12,
          audioSrc: "/fixtures/audio-success.mp3",
          label: "Audio",
          sourceKind: "audio",
          title: "音频来源",
        },
        style: { height: 250, width: 444 },
      },
      {
        id: "typed-image-target",
        type: "image",
        position: { x: 780, y: 280 },
        data: {
          imagePromptReady: true,
          label: "Image",
          sourceKind: "image",
          title: "图片目标",
        },
        style: { height: 250, width: 250 },
      },
    ];
  }

  const nodes: ProbeNodeType[] = [
    {
      id: "probe-a",
      type: "probe",
      position: { x: 300, y: 180 },
      data: { assetId: "asset-probe-a", label: "A" },
      style: { width: 250, height: 250 },
      zIndex: 0,
    },
    {
      id: "probe-b",
      type: "probe",
      position: { x: 760, y: 180 },
      data: { assetId: "asset-probe-b", label: "B" },
      style: { width: 250, height: 250 },
      zIndex: 0,
    },
    {
      id: "probe-c",
      type: "probe",
      position: { x: 460, y: 500 },
      data: { assetId: "asset-probe-c", label: "C" },
      style: { width: 250, height: 250 },
      zIndex: 0,
    },
  ];

  if (fixtureId === "interaction.fit-five-nodes") {
    return [
      ...nodes,
      {
        id: "probe-d",
        type: "probe",
        position: { x: -500, y: -300 },
        data: { label: "D" },
        style: { width: 250, height: 250 },
        zIndex: 0,
      },
      {
        id: "probe-e",
        type: "probe",
        position: { x: 1500, y: 900 },
        data: { label: "E" },
        style: { width: 250, height: 250 },
        zIndex: 0,
      },
    ];
  }

  return nodes;
}

function createProbeEdges(fixtureId?: string): CuttableEdge[] {
  if (
    fixtureId === "node.image.text-image-input" ||
    fixtureId === "node.image.text-image-input.persistence-retest"
  ) {
    return [
      {
        id: "edge-master-text-target-image",
        source: "input-master-text",
        sourceHandle: "source",
        target: "input-target-image",
        targetHandle: "target",
        type: "cuttable",
        data: { inputOrder: 1, inputRole: "instruction" },
      },
      {
        id: "edge-garment-target-image",
        source: "input-garment-image",
        sourceHandle: "source",
        target: "input-target-image",
        targetHandle: "target",
        type: "cuttable",
        data: { inputOrder: 2, inputRole: "reference-image" },
      },
    ];
  }

  if (fixtureId === "node.image.reference-ready") {
    return [
      {
        id: "edge-image-reference",
        source: "image-reference-source",
        sourceHandle: "source",
        target: "image-reference-target",
        targetHandle: "target",
        type: "cuttable",
      },
    ];
  }

  if (fixtureId === "persistence.final-clean-canvas") {
    return [
      {
        id: "clean-edge-a-b",
        source: "clean-a",
        sourceHandle: "source",
        target: "clean-b",
        targetHandle: "target",
        type: "cuttable",
      },
      {
        id: "clean-edge-b-c",
        source: "clean-b",
        sourceHandle: "source",
        target: "clean-c",
        targetHandle: "target",
        type: "cuttable",
      },
    ];
  }

  if (fixtureId === "persistence.nodes-assets-viewport") {
    return [
      {
        id: "persistent-edge-text-image",
        source: "persistent-text",
        sourceHandle: "source",
        target: "persistent-image-1",
        targetHandle: "target",
        type: "cuttable",
      },
    ];
  }

  if (fixtureId === "legacy.dense-canvas.neutral") {
    const connections = Array.from({ length: 56 }, (_, index) => [
      index + 1,
      index + 2,
    ]).concat([
      [1, 11],
      [16, 31],
    ]);

    return connections.map(([source, target], index) => ({
      id: `dense-edge-${index + 1}`,
      source: `dense-node-${source}`,
      sourceHandle: "source",
      target: `dense-node-${target}`,
      targetHandle: "target",
      type: "cuttable",
    }));
  }

  if (fixtureId === "workflow.text-to-video.created") {
    return [
      {
        id: "edge-workflow-text-video",
        source: "workflow-text",
        sourceHandle: "source",
        target: "workflow-video",
        targetHandle: "target",
        type: "cuttable",
        data: { animatedHighlight: true },
      },
    ];
  }

  if (fixtureId === "interaction.delete-cascade-and-undo") {
    return [
      {
        id: "edge-probe-a-probe-b",
        source: "probe-a",
        sourceHandle: "source",
        target: "probe-b",
        targetHandle: "target",
        type: "cuttable",
      },
      {
        id: "edge-probe-a-probe-c",
        source: "probe-a",
        sourceHandle: "source",
        target: "probe-c",
        targetHandle: "target",
        type: "cuttable",
      },
    ];
  }

  if (fixtureId === "legacy.interaction.invalid-same-side-edge") {
    return [
      {
        id: "edge-probe-a-probe-b",
        source: "probe-a",
        sourceHandle: "source",
        target: "probe-b",
        targetHandle: "target",
        type: "cuttable",
      },
    ];
  }

  if (fixtureId === "interaction.manual-connect-image-to-video") {
    return [
      {
        id: "edge-probe-a-probe-c",
        source: "probe-a",
        sourceHandle: "source",
        target: "probe-c",
        targetHandle: "target",
        type: "cuttable",
      },
    ];
  }

  if (
    fixtureId === "interaction.edge-delete-reconnect-download-sandbox-current"
  ) {
    return [
      {
        id: "edge-probe-a-probe-b",
        source: "probe-a",
        sourceHandle: "source",
        target: "probe-b",
        targetHandle: "target",
        type: "cuttable",
      },
    ];
  }

  return emptyEdges;
}

function canvasSyncChannel(accountId: string, canvasId: string) {
  const scope = accountId ? `${accountId}:${canvasId}` : canvasId;
  return typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(`tapnow-canvas-sync:${scope}`);
}

function broadcastCanvasSaved(
  accountId: string,
  canvasId: string,
  revision: number,
  sessionId: string,
) {
  const channel = canvasSyncChannel(accountId, canvasId);
  if (!channel) return;
  channel.postMessage({ canvasId, revision, sessionId, type: "saved" });
  channel.close();
}

export function CanvasSurface({
  accountId,
  agentReferenceMode,
  fixtureId,
  focusNodeRequest,
  historyAssetRequest,
  minimapOpen,
  onAgentReferencePick,
  onAddMenuOpenChange,
  onGraphContentChange,
  onOpenAssets,
  onProjectMissing,
  onReady,
  onSearchIndexChange,
  onSaveConflict,
  onSaveSuccess,
  onSaveStart,
  onViewportChange,
  projectId,
  shellMenuCommand,
  snapEnabled,
  textVideoStarted,
  viewport,
}: {
  accountId?: string;
  agentReferenceMode?: boolean;
  fixtureId?: string;
  focusNodeRequest?: { id: string; sequence: number };
  historyAssetRequest?: {
    asset: CanvasLibraryAsset;
    sequence: number;
  };
  minimapOpen: boolean;
  onAgentReferencePick?: (reference: AgentCanvasReference) => void;
  onAddMenuOpenChange?: (open: boolean) => void;
  onGraphContentChange: (hasContent: boolean) => void;
  onOpenAssets?: () => void;
  onProjectMissing?: () => void;
  onReady: (fitView: () => void) => void;
  onSearchIndexChange?: (entries: CanvasSearchEntry[]) => void;
  onSaveConflict: (message?: string) => void;
  onSaveSuccess: () => void;
  onSaveStart: () => void;
  onViewportChange: (viewport: Viewport) => void;
  projectId?: string;
  shellMenuCommand?: CanvasShellMenuCommand;
  snapEnabled: boolean;
  textVideoStarted: boolean;
  viewport: Viewport;
}) {
  const workflowFixture = fixtureId === "workflow.text-to-video.created";
  const persistenceId = projectId ?? fixtureId ?? "default";
  const imageModels = usePublishedModels("image");
  const videoModels = usePublishedModels("video");
  const imageModelsRef = useRef(imageModels);
  imageModelsRef.current = imageModels;
  const persistenceFixture =
    Boolean(projectId) ||
    !fixtureId ||
    fixtureId.startsWith("persistence.") ||
    fixtureId?.startsWith("node.") ||
    fixtureId === "panel.history.final" ||
    fixtureId === "panel.assets.drag-ready" ||
    fixtureId === "interaction.upload-image" ||
    fixtureId === "interaction.upload-media-sandbox-current";
  const interactive =
    hasInteractionProbeNodes(fixtureId) || workflowFixture || textVideoStarted;
  const [nodes, setNodes, onNodesChange] = useNodesState<ProbeNodeType>(
    interactive && !workflowFixture && !persistenceFixture
      ? createProbeNodes(fixtureId)
      : emptyNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<CuttableEdge>(
    workflowFixture || persistenceFixture
      ? emptyEdges
      : createProbeEdges(fixtureId),
  );
  const [primaryId, setPrimaryId] = useState<string>();
  const [batchDrag, setBatchDrag] = useState<BatchConnectionDrag>();
  const [sourceConnectMenu, setSourceConnectMenu] =
    useState<SourceConnectMenu>();
  const [createMenu, setCreateMenu] = useState<CreateMenu>();
  const [blankContextMenu, setBlankContextMenu] =
    useState<BlankContextMenu>();
  const [nodeContextMenu, setNodeContextMenu] =
    useState<NodeContextMenu>();
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [playlistToast, setPlaylistToast] = useState("");
  const [workflowToast, setWorkflowToast] = useState<{
    kind: "error" | "info" | "success";
    message: string;
  }>();
  const workflowToastTimer = useRef<number | undefined>(undefined);
  const showWorkflowToast = useCallback(
    (message: string, kind: "error" | "info" | "success" = "info") => {
      setWorkflowToast({ kind, message });
      window.clearTimeout(workflowToastTimer.current);
      workflowToastTimer.current = window.setTimeout(
        () => setWorkflowToast(undefined),
        2_600,
      );
    },
    [],
  );
  const [persistenceReady, setPersistenceReady] = useState(!persistenceFixture);
  const [confirmedPersistenceRevision, setConfirmedPersistenceRevision] =
    useState<number>();
  const [confirmedGraphRevision, setConfirmedGraphRevision] =
    useState<number>();
  const persistenceRevision = useRef(0);
  const persistenceGraphRevision = useRef(0);
  const persistenceConflict = useRef(false);
  const persistenceDirty = useRef(false);
  const drainPersistenceQueueRef = useRef<() => void>(() => {});
  const persistenceSessionId = useRef(crypto.randomUUID());
  const persistenceSaveSequence = useRef(0);
  const persistenceSentFingerprints = useRef(
    new Map<number, { document: string; graph: string }>(),
  );
  const persistedDocumentFingerprint = useRef("");
  const persistedGraphFingerprint = useRef("");
  const persistenceInFlightFingerprint = useRef<string | undefined>(undefined);
  const persistenceHydrationTimer = useRef<number | undefined>(undefined);
  const persistenceSaveTimer = useRef<number | undefined>(undefined);
  const persistenceSaving = useRef(false);
  const persistenceQueued = useRef<{
    edges: CuttableEdge[];
    fingerprint: string;
    graphFingerprint: string;
    nodes: ProbeNodeType[];
    viewport: Viewport;
  } | undefined>(undefined);
  const uploadInput = useRef<HTMLInputElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const blankContextMenuRef = useRef<HTMLDivElement>(null);
  const nodeContextMenuRef = useRef<HTMLDivElement>(null);
  const internalClipboard = useRef<ProbeNodeType | undefined>(undefined);
  const appliedTemplateSequence = useRef<number | undefined>(undefined);
  const flowInstance = useRef<
    ReactFlowInstance<ProbeNodeType, CuttableEdge> | undefined
  >(undefined);
  const cutTimer = useRef<number | undefined>(undefined);
  const history = useRef<HistoryEntry[]>([]);
  const redoHistory = useRef<Extract<HistoryEntry, { kind: "snapshot" }>[]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef(viewport);
  const pendingWheelViewport = useRef<Viewport | undefined>(undefined);
  const wheelViewportFrame = useRef<number | undefined>(undefined);
  const consumedFocusNodeSequence = useRef(0);
  const nodeDragging = useRef(false);
  const restoreSequence = useRef(0);
  const clipboardPasteSequence = useRef(0);
  const minimapDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    viewport: Viewport;
  } | undefined>(undefined);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  viewportRef.current = viewport;

  const keepLastNonCollidingPositions = (
    changes: NodeChange<ProbeNodeType>[],
  ) => {
    if (!snapEnabled || !nodeDragging.current) return changes;

    const positionChanges = changes.filter(
      (change): change is NodePositionChange =>
        change.type === "position" && Boolean(change.position),
    );
    if (!positionChanges.length) return changes;

    const currentById = new Map(
      nodesRef.current.map((node) => [node.id, node]),
    );
    const movingIds = new Set(positionChanges.map((change) => change.id));
    const blocked = positionChanges.some((change) => {
      const moving = currentById.get(change.id);
      if (!moving || !change.position || !collisionNode(moving)) return false;

      return nodesRef.current.some((stationary) => {
        if (
          movingIds.has(stationary.id) ||
          !collisionNode(stationary)
        ) {
          return false;
        }

        const currentArea = overlapArea(
          moving,
          moving.position,
          stationary,
          stationary.position,
        );
        const nextArea = overlapArea(
          moving,
          change.position!,
          stationary,
          stationary.position,
        );
        return nextArea > 0 && nextArea >= currentArea;
      });
    });

    if (!blocked) return changes;

    return changes.map((change) => {
      if (change.type !== "position" || !movingIds.has(change.id)) {
        return change;
      }
      const current = currentById.get(change.id);
      if (!current) return change;
      return {
        ...change,
        position: current.position,
        positionAbsolute: change.positionAbsolute
          ? current.position
          : undefined,
      };
    });
  };

  useEffect(() => {
    if (!shellMenuCommand) return;
    if (shellMenuCommand.action === "dismiss") {
      setBlankContextMenu(undefined);
      setCreateMenu(undefined);
      setNodeContextMenu(undefined);
      setSourceConnectMenu(undefined);
      setUploadError("");
      return;
    }
    if (!worldRef.current) return;
    const bounds = worldRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(80, bounds.width - 296));
    const y = Math.max(8, Math.min(300, bounds.height - 518));
    setCreateMenu((current) =>
      current
        ? undefined
        : {
            flow: {
              x: (x - viewport.x) / viewport.zoom,
              y: (y - viewport.y) / viewport.zoom,
            },
            screen: { x, y },
          },
    );
    setUploadError("");
    setBlankContextMenu(undefined);
    setNodeContextMenu(undefined);
    setSourceConnectMenu(undefined);
  }, [shellMenuCommand]);

  useEffect(() => {
    onAddMenuOpenChange?.(Boolean(createMenu));
  }, [createMenu, onAddMenuOpenChange]);

  useEffect(() => {
    if (!blankContextMenu) return;
    const closeBlankMenu = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else if (
        blankContextMenuRef.current?.contains(event.target as Node | null)
      ) {
        return;
      }
      setBlankContextMenu(undefined);
    };
    window.addEventListener("keydown", closeBlankMenu);
    window.addEventListener("mousedown", closeBlankMenu, true);
    return () => {
      window.removeEventListener("keydown", closeBlankMenu);
      window.removeEventListener("mousedown", closeBlankMenu, true);
    };
  }, [blankContextMenu]);

  useEffect(() => {
    if (!nodeContextMenu) return;
    const closeNodeMenu = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else if (
        nodeContextMenuRef.current?.contains(event.target as Node | null)
      ) {
        return;
      }
      setNodeContextMenu(undefined);
    };
    window.addEventListener("keydown", closeNodeMenu);
    window.addEventListener("mousedown", closeNodeMenu, true);
    return () => {
      window.removeEventListener("keydown", closeNodeMenu);
      window.removeEventListener("mousedown", closeNodeMenu, true);
    };
  }, [nodeContextMenu]);

  useEffect(() => {
    if (persistenceReady) onGraphContentChange(nodes.length > 0);
  }, [nodes.length, onGraphContentChange, persistenceReady]);

  useEffect(() => {
    if (!persistenceReady) return;
    const categoryByType: Partial<
      Record<ProbeNodeType["type"], CanvasSearchEntry["category"]>
    > = {
      audio: "音频",
      group: "分组",
      image: "图片",
      text: "文本",
      video: "视频",
    };
    onSearchIndexChange?.(
      nodes.map((node) => {
        const title = node.data.title ?? node.data.label;
        const prompt =
          node.data.imagePrompt ??
          node.data.videoPrompt ??
          node.data.content ??
          "";
        const detail = prompt.trim() || "无 Prompt";
        const storyboardText = node.data.storyboardShots
          ?.flatMap((shot) => [
            shot.dialogue,
            shot.framing,
            shot.notes,
            shot.summary,
          ])
          .join(" ");
        return {
          category: categoryByType[node.type] ?? "全部",
          detail,
          id: node.id,
          searchText: [
            title,
            node.data.label,
            node.data.imagePrompt,
            node.data.videoPrompt,
            node.data.content,
            storyboardText,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase(),
          thumbnail: node.data.imageSrc,
          title,
          type: node.type,
        };
      }),
    );
  }, [nodes, onSearchIndexChange, persistenceReady]);

  useEffect(() => {
    if (
      !focusNodeRequest ||
      focusNodeRequest.sequence <= consumedFocusNodeSequence.current ||
      !flowInstance.current ||
      !worldRef.current
    ) {
      return;
    }
    const node = nodesRef.current.find(
      (candidate) => candidate.id === focusNodeRequest.id,
    );
    if (!node) return;
    consumedFocusNodeSequence.current = focusNodeRequest.sequence;
    const size = nodeSize(node);
    const internalNode = flowInstance.current.getInternalNode(node.id);
    const position =
      internalNode?.internals.positionAbsolute ?? node.position;
    const bounds = worldRef.current.getBoundingClientRect();
    const zoom = Math.max(0.85, Math.min(1, viewportRef.current.zoom));
    setNodes((current) =>
      current.map((candidate) => ({
        ...candidate,
        selected: candidate.id === node.id,
      })),
    );
    setPrimaryId(node.id);
    onViewportChange({
      x: bounds.width / 2 - (position.x + size.width / 2) * zoom,
      y: bounds.height / 2 - (position.y + size.height / 2) * zoom,
      zoom,
    });
  }, [focusNodeRequest, onViewportChange, persistenceReady, setNodes]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    redoHistory.current = [];
    history.current.push(entry);
    if (history.current.length > 50) {
      history.current.shift();
    }
  }, []);
  const cloneNodes = useCallback((current: ProbeNodeType[]) =>
    current.map((node) => ({
      ...node,
      data: {
        ...node.data,
        playlistClips: node.data.playlistClips?.map((clip) => ({ ...clip })),
      },
      measured: node.measured ? { ...node.measured } : undefined,
      position: { ...node.position },
      style: node.style ? { ...node.style } : undefined,
    })), []);
  const cloneEdges = useCallback((current: CuttableEdge[]) =>
    current.map((edge) => ({
      ...edge,
      data: edge.data ? { ...edge.data } : undefined,
      style: edge.style ? { ...edge.style } : undefined,
    })), []);
  const canvasSnapshot = useCallback((
    currentNodes = nodesRef.current,
    currentEdges = edgesRef.current,
    currentViewport = viewportRef.current,
  ) => {
    const document = {
      edges: cloneEdges(currentEdges),
      nodes: cloneNodes(currentNodes),
      viewport: { ...currentViewport },
    };
    return {
      ...document,
      fingerprint: canvasDocumentFingerprint(document),
      graphFingerprint: canvasGraphFingerprint(document),
    };
  }, [cloneEdges, cloneNodes]);
  const canvasSnapshotRef = useRef(canvasSnapshot);
  canvasSnapshotRef.current = canvasSnapshot;
  const checkpoint = useCallback((includeHistory = true) => {
    if (!includeHistory) return;
    pushHistory({
      edges: cloneEdges(edgesRef.current),
      kind: "snapshot",
      nodes: cloneNodes(nodesRef.current),
    });
  }, [cloneEdges, cloneNodes, pushHistory]);

  useEffect(() => {
    if (shellMenuCommand?.action !== "apply-template") return;
    if (shellMenuCommand.sequence === appliedTemplateSequence.current) return;
    appliedTemplateSequence.current = shellMenuCommand.sequence;
    const graph = shellMenuCommand.graph;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return;
    }
    const idMap = new Map<string, string>();
    const appliedNodes: ProbeNodeType[] = graph.nodes.map((source) => {
      const id = `${source.type}-${crypto.randomUUID()}`;
      idMap.set(source.id, id);
      return {
        id,
        type: source.type,
        position: source.position,
        data: {
          ...source.data,
          label: source.data.label ?? "Node",
          title: typeof source.data.title === "string"
            ? source.data.title
            : source.data.label ?? "Node",
        },
        style: source.style ??
          (source.type === "group"
            ? { height: 500, width: 800 }
            : NODE_DEFAULT_SIZES[source.type]),
        zIndex: source.zIndex,
        selected: false,
      };
    }).map((node, index) => ({
      ...node,
      parentId: graph.nodes[index].parentId
        ? idMap.get(graph.nodes[index].parentId!)
        : undefined,
    }));
    const groupNode = appliedNodes.find((node) => node.type === "group");
    const appliedEdges: CuttableEdge[] = graph.edges.map((edge) => ({
      id: `template-edge-${crypto.randomUUID()}`,
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
      sourceHandle: "source",
      targetHandle: "target",
      type: "cuttable",
    }));
    const nodeTypeById = new Map(
      appliedNodes.map((node) => [node.id, node.type]),
    );
    const imageTargetsWithImageInput = new Set(
      appliedEdges
        .filter((edge) =>
          nodeTypeById.get(edge.target) === "image" &&
          nodeTypeById.get(edge.source) === "image")
        .map((edge) => edge.target),
    );
    const preparedNodes = appliedNodes.map((node) =>
      node.type === "image" && imageTargetsWithImageInput.has(node.id)
        ? withImageReferenceInputMode(node, imageModelsRef.current)
        : node,
    );
    checkpoint();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...preparedNodes,
    ]);
    setEdges((current) => [...current, ...appliedEdges]);
    if (groupNode) setPrimaryId(groupNode.id);
    window.requestAnimationFrame(() => {
      void flowInstance.current?.fitView({ duration: 0, padding: 0.2 });
    });
  }, [checkpoint, setEdges, setNodes, shellMenuCommand]);
  const handleCanvasWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey || event.deltaY === 0 || !worldRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = worldRef.current.getBoundingClientRect();
      const current = pendingWheelViewport.current ?? viewportRef.current;
      const next = zoomViewportAtScreenPoint(
        current,
        {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
        {
          deltaMode: event.deltaMode,
          deltaY: event.deltaY,
          macOs: /Mac|iPhone|iPad|iPod/.test(navigator.platform),
        },
      );
      if (next === current) return;
      viewportRef.current = next;
      pendingWheelViewport.current = next;
      if (wheelViewportFrame.current !== undefined) return;
      wheelViewportFrame.current = window.requestAnimationFrame(() => {
        wheelViewportFrame.current = undefined;
        const pending = pendingWheelViewport.current;
        pendingWheelViewport.current = undefined;
        if (pending) onViewportChange(pending);
      });
    },
    [onViewportChange],
  );

  useEffect(() => () => {
    if (wheelViewportFrame.current !== undefined) {
      window.cancelAnimationFrame(wheelViewportFrame.current);
    }
  }, []);
  const copyNodeInternally = (nodeId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    internalClipboard.current = cloneNodes([node])[0];
    clipboardPasteSequence.current = 0;
    return true;
  };
  const appendNodeDuplicate = (
    source: ProbeNodeType,
    offsetStep = 1,
  ) => {
    const duplicate = cloneNodes([source])[0];
    const id = `${source.id}-copy-${crypto.randomUUID()}`;
    checkpoint();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        ...duplicate,
        id,
        position: {
          x: duplicate.position.x + 40 * offsetStep,
          y: duplicate.position.y + 40 * offsetStep,
        },
        selected: true,
      },
    ]);
    setPrimaryId(id);
    return id;
  };
  const pasteInternalNode = () => {
    const copied = internalClipboard.current;
    if (!copied) return false;
    clipboardPasteSequence.current += 1;
    appendNodeDuplicate(copied, clipboardPasteSequence.current);
    return true;
  };
  const deleteNodeFromContextMenu = (nodeId: string) => {
    const root = nodesRef.current.find((node) => node.id === nodeId);
    if (!root) return;
    const deletedIds = new Set([nodeId]);
    if (root.type === "group") {
      nodesRef.current.forEach((node) => {
        if (node.parentId === nodeId) deletedIds.add(node.id);
      });
    }
    const deletedNodes = nodesRef.current.filter((node) =>
      deletedIds.has(node.id),
    );
    const deletedEdges = edgesRef.current.filter(
      (edge) => deletedIds.has(edge.source) || deletedIds.has(edge.target),
    );
    pushHistory({
      edges: cloneEdges(deletedEdges),
      kind: "delete",
      nodes: cloneNodes(deletedNodes),
    });
    setNodes((current) =>
      current.filter((node) => !deletedIds.has(node.id)),
    );
    setEdges((current) =>
      current.filter(
        (edge) =>
          !deletedIds.has(edge.source) && !deletedIds.has(edge.target),
      ),
    );
    setPrimaryId(undefined);
  };
  const downloadNodeMedia = (node: ProbeNodeType) => {
    const source =
      node.type === "image"
        ? node.data.imageSrc
        : node.type === "video"
          ? node.data.videoSrc
          : node.type === "audio"
            ? node.data.audioSrc
            : undefined;
    if (!source) return false;
    const extension =
      node.type === "image" ? "png" : node.type === "video" ? "mp4" : "wav";
    const anchor = document.createElement("a");
    anchor.href = source;
    anchor.download = `${node.data.title ?? node.data.label}.${extension}`;
    anchor.click();
    return true;
  };
  const addEmptyNode = (
    type: "audio" | "image" | "playlist" | "text" | "video",
  ) => {
    if (!createMenu) return;
    const labels = {
      audio: "Audio",
      image: "Image",
      playlist: "Playlist",
      text: "Text",
      video: "Video",
    } as const;
    checkpoint();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id: `${type}-${crypto.randomUUID()}`,
        type,
        position: createMenu.flow,
        selected: true,
        data: {
          audioPromptReady: type === "audio" || undefined,
          imagePromptReady: type === "image" || undefined,
          label: labels[type],
          sourceKind:
            type === "audio" || type === "image" || type === "video"
              ? type
              : undefined,
          textPromptReady: type === "text" || undefined,
          title: labels[type],
          videoPromptReady: type === "video" || undefined,
        },
        style: { ...NODE_DEFAULT_SIZES[type] },
      },
    ]);
    setCreateMenu(undefined);
  };
  const addDroppedLibraryAsset = (
    asset: CanvasLibraryAsset,
    screen: { x: number; y: number },
  ) => {
    const bounds = worldRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const position = {
      x: (screen.x - bounds.left - viewport.x) / viewport.zoom,
      y: (screen.y - bounds.top - viewport.y) / viewport.zoom,
    };
    checkpoint();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id: `${asset.kind}-${crypto.randomUUID()}`,
        type: asset.kind,
        position,
        selected: true,
        data: {
          audioPromptReady: asset.kind === "audio" || undefined,
          assetId: asset.id,
          audioSrc: asset.kind === "audio" ? asset.src : undefined,
          imagePromptReady: asset.kind === "image" || undefined,
          imageSrc: asset.kind === "image" ? asset.src : undefined,
          label:
            asset.kind === "audio"
              ? "Audio"
              : asset.kind === "image"
                ? "Image"
                : "Video",
          sourceKind: asset.kind,
          title: asset.label,
          videoPromptReady: asset.kind === "video" || undefined,
          videoSrc: asset.kind === "video" ? asset.src : undefined,
        },
        style:
          asset.kind === "image"
            ? { ...NODE_DEFAULT_SIZES.image }
            : asset.kind === "video"
              ? { ...NODE_DEFAULT_SIZES.video }
              : { ...NODE_DEFAULT_SIZES.audio },
      },
    ]);
  };
  useEffect(() => {
    if (!historyAssetRequest || !persistenceReady) return;
    const bounds = worldRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const size = NODE_DEFAULT_SIZES[historyAssetRequest.asset.kind];
    addDroppedLibraryAsset(historyAssetRequest.asset, {
      x: bounds.left + bounds.width / 2 - Number(size.width) * viewport.zoom / 2,
      y: bounds.top + bounds.height / 2 - Number(size.height) * viewport.zoom / 2,
    });
  }, [historyAssetRequest?.sequence, persistenceReady]);
  const uploadImage = async (file?: File) => {
    if (!file || !createMenu || uploading) return;
    setUploadError("");
    setUploading(true);
    try {
      const asset = await uploadImageAsset(file);
      checkpoint();
      setNodes((current) => [
        ...current.map((node) => ({ ...node, selected: false })),
        {
          id: `image-${crypto.randomUUID()}`,
          type: "image",
          position: createMenu.flow,
          selected: true,
          data: {
            ...trustedMediaPatch({
              assetId: asset.assetId,
              byteSize: asset.byteSize,
              contentType: asset.contentType,
              durationSeconds: null,
              durationStatus: "not-applicable",
              kind: "image",
              storageBackend: asset.storageBackend,
            }),
            assetId: asset.assetId,
            imagePromptReady: true,
            imageSrc: asset.url,
            label: "Image",
            sourceKind: "image",
            title:
              asset.fileName.replace(/\.[^.]+$/, "") || "Image",
          },
          style: {
            ...fitVisualMediaSize(asset.width, asset.height),
          },
        },
      ]);
      setCreateMenu(undefined);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "图片上传失败",
      );
    } finally {
      setUploading(false);
    }
  };
  const isConnectionAllowed = (
    connection: Connection | Edge,
    currentEdges: Edge[],
  ) => {
    const sourceType = nodesRef.current.find((node) => node.id === connection.source)?.type;
    const targetType = nodesRef.current.find((node) => node.id === connection.target)?.type;
    return connection.source !== connection.target &&
    connection.sourceHandle === "source" &&
    connection.targetHandle === "target" &&
    isNodeInputConnectionAllowed(sourceType, targetType) &&
    !currentEdges.some(
      (edge) =>
        (edge.source === connection.source &&
          edge.target === connection.target) ||
        (edge.source === connection.target &&
          edge.target === connection.source),
    );
  };
  const isValidConnection = (connection: Connection | Edge) =>
    isConnectionAllowed(connection, edges);
  const upgradeImageInputModeForNewEdges = (
    targetId: string,
    addedSourceIds: readonly string[],
  ) => {
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (target?.type !== "image") return;

    // Only the first ready Image reference chooses the compatible input mode.
    // An empty/uploading/invalid edge is retained as user content, but it must
    // not prevent the first usable reference from applying the model rule.
    const alreadyHasReadyImageInput = edgesRef.current.some((edge) => {
      if (edge.target !== targetId) return false;
      const source = nodesRef.current.find((node) => node.id === edge.source);
      return source?.type === "image" &&
        Boolean(source.data.assetId) &&
        Boolean(source.data.imageSrc) &&
        (source.data.inputState === undefined || source.data.inputState === "ready");
    });
    if (alreadyHasReadyImageInput) return;

    const addsReadyImage = addedSourceIds.some((sourceId) => {
      const source = nodesRef.current.find((node) => node.id === sourceId);
      return source?.type === "image" &&
        Boolean(source.data.assetId) &&
        Boolean(source.data.imageSrc) &&
        (source.data.inputState === undefined || source.data.inputState === "ready");
    });
    if (!addsReadyImage) return;

    setNodes((current) => current.map((node) => node.id === targetId
      ? withImageReferenceInputMode(node, imageModels)
      : node));
  };
  const upgradeVideoInputModeForNewEdges = (
    targetId: string,
    addedSourceIds: readonly string[],
  ) => {
    const target = nodesRef.current.find((node) => node.id === targetId);
    if (target?.type !== "video") return;
    const addedMediaKinds = addedSourceIds.flatMap((sourceId) => {
      const kind = nodesRef.current.find((node) => node.id === sourceId)?.type;
      return kind === "image" || kind === "video" || kind === "audio"
        ? [kind]
        : [];
    });
    if (!addedMediaKinds.length) return;

    const imageCountAfterConnection = new Set([
      ...edgesRef.current.flatMap((edge) => {
        if (edge.target !== targetId) return [];
        const source = nodesRef.current.find((node) => node.id === edge.source);
        return source?.type === "image" ? [source.id] : [];
      }),
      ...addedSourceIds.filter((sourceId) =>
        nodesRef.current.find((node) => node.id === sourceId)?.type === "image"),
    ]).size;
    setNodes((current) => current.map((node) => node.id === targetId
      ? withVideoReferenceInputModeForNewEdges(
          node,
          videoModels,
          addedMediaKinds,
          imageCountAfterConnection,
        )
      : node));
  };
  const addConnection = (connection: Connection) => {
    if (!isConnectionAllowed(connection, edgesRef.current)) {
      return false;
    }
    const sourceType = nodesRef.current.find((node) => node.id === connection.source)?.type;
    const targetType = nodesRef.current.find((node) => node.id === connection.target)?.type;
    checkpoint();
    upgradeImageInputModeForNewEdges(connection.target, [connection.source]);
    upgradeVideoInputModeForNewEdges(connection.target, [connection.source]);
    setEdges((current) =>
      isConnectionAllowed(connection, current)
        ? addEdge(
            {
              ...connection,
              id: `edge-${connection.source}-${connection.target}-${current.length}`,
              interactionWidth: 20,
              type: "cuttable",
              data: isNodeInputKind(sourceType) && isNodeInputKind(targetType)
                ? {
                    inputOrder: nextNodeInputOrder(current, connection.target),
                    inputRole: defaultNodeInputRole(sourceType, targetType),
                  }
                : undefined,
            },
            current,
          )
        : current,
    );
    return true;
  };
  const addBatchConnections = (sourceIds: string[], targetId: string) => {
    const plannedEdges = [...edgesRef.current];
    const addedSourceIds: string[] = [];
    for (const sourceId of sourceIds) {
      const connection: Connection = {
        source: sourceId,
        sourceHandle: "source",
        target: targetId,
        targetHandle: "target",
      };
      if (!isConnectionAllowed(connection, plannedEdges)) continue;
      addedSourceIds.push(sourceId);
      plannedEdges.push({
        ...connection,
        id: `planned-edge-${sourceId}-${targetId}-${plannedEdges.length}`,
        type: "cuttable",
      });
    }
    if (!addedSourceIds.length) return;
    checkpoint();
    upgradeImageInputModeForNewEdges(targetId, addedSourceIds);
    upgradeVideoInputModeForNewEdges(targetId, addedSourceIds);
    setEdges((current) =>
      sourceIds.reduce<CuttableEdge[]>((next, sourceId) => {
        const connection: Connection = {
          source: sourceId,
          sourceHandle: "source",
          target: targetId,
          targetHandle: "target",
        };

        return isConnectionAllowed(connection, next)
          ? addEdge(
              {
                ...connection,
                id: `edge-${sourceId}-${targetId}-${next.length}`,
                interactionWidth: 20,
                type: "cuttable",
                data: (() => {
                  const sourceType = nodesRef.current.find((node) => node.id === sourceId)?.type;
                  const targetType = nodesRef.current.find((node) => node.id === targetId)?.type;
                  return isNodeInputKind(sourceType) && isNodeInputKind(targetType)
                    ? {
                          inputOrder: nextNodeInputOrder(next, targetId),
                        inputRole: defaultNodeInputRole(sourceType, targetType),
                      }
                    : undefined;
                })(),
              },
              next,
            )
          : next;
      }, current),
    );
  };
  const clearCutIndicators = () =>
    setEdges((current) =>
      current.map((edge) =>
        edge.data?.cutIndicator
          ? { ...edge, data: { ...edge.data, cutIndicator: undefined } }
          : edge,
      ),
    );

  useEffect(() => {
    if (textVideoStarted) {
      setNodes(createProbeNodes("workflow.text-to-video.created"));
      setEdges(createProbeEdges("workflow.text-to-video.created"));
    }
  }, [setEdges, setNodes, textVideoStarted]);

  useEffect(() => {
    if (!persistenceFixture) return;
    setConfirmedPersistenceRevision(undefined);
    setConfirmedGraphRevision(undefined);
    const controller = new AbortController();
    const url = `/api/canvas/${persistenceId}`;
    void fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          if (projectId) {
            onProjectMissing?.();
            return undefined;
          }
          const saveSequence = ++persistenceSaveSequence.current;
          const initial = {
            edges: createProbeEdges(persistenceId),
            nodes: createProbeNodes(persistenceId),
            revision: 0,
            saveSequence,
            saveSessionId: persistenceSessionId.current,
            viewport,
          };
          persistenceSentFingerprints.current.set(saveSequence, {
            document: canvasDocumentFingerprint(initial),
            graph: canvasGraphFingerprint(initial),
          });
          const created = await fetch(url, {
            body: JSON.stringify(initial),
            headers: { "Content-Type": "application/json" },
            method: "PUT",
            signal: controller.signal,
          });
          if (!created.ok) throw new Error(`Canvas create failed: ${created.status}`);
          return {
            ...initial,
            ...(await created.json() as {
              graphRevision: number;
              revision: number;
            }),
          };
        }
        if (!response.ok) throw new Error(`Canvas load failed: ${response.status}`);
        return await response.json() as {
          edges: CuttableEdge[];
          graphRevision?: number;
          nodes: ProbeNodeType[];
          revision: number;
          viewport: Viewport;
        };
      })
      .then((document) => {
        if (!document) return;
        const hydratedDocument = {
          ...document,
          nodes: normalizePersistedMediaNodes(document.nodes),
          edges: (document.edges ?? []).map((edge) =>
            stripSelectionFlowMarkers(
              edge.style && typeof edge.style === "object"
                ? { ...edge, style: undefined }
                : edge,
            ),
          ),
        };
        const persistedFingerprint = canvasDocumentFingerprint(hydratedDocument);
        const graphFingerprint = canvasGraphFingerprint(hydratedDocument);
        const graphRevision = document.graphRevision ?? document.revision;
        persistenceRevision.current = document.revision;
        persistenceGraphRevision.current = graphRevision;
        setConfirmedPersistenceRevision(document.revision);
        setConfirmedGraphRevision(graphRevision);
        persistenceConflict.current = false;
        persistenceDirty.current = false;
        persistedDocumentFingerprint.current = persistedFingerprint;
        persistedGraphFingerprint.current = graphFingerprint;
        setNodes(hydratedDocument.nodes);
        setEdges(hydratedDocument.edges);
        onViewportChange(hydratedDocument.viewport);
        window.clearTimeout(persistenceHydrationTimer.current);
        persistenceHydrationTimer.current = window.setTimeout(
          () => setPersistenceReady(true),
          150,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setConfirmedPersistenceRevision(undefined);
          setConfirmedGraphRevision(undefined);
          persistedDocumentFingerprint.current = canvasSnapshot().fingerprint;
          persistedGraphFingerprint.current = canvasSnapshot().graphFingerprint;
          setPersistenceReady(true);
        }
      });
    return () => {
      controller.abort();
      window.clearTimeout(persistenceHydrationTimer.current);
    };
  }, [
    canvasSnapshot,
    onProjectMissing,
    onViewportChange,
    persistenceFixture,
    persistenceId,
    projectId,
    setEdges,
    setNodes,
  ]);

  useEffect(() => {
    if (
      !persistenceFixture ||
      !persistenceReady ||
      persistenceConflict.current
    ) {
      return;
    }

    const liveDocument = canvasSnapshot();
    const confirmed =
      liveDocument.fingerprint === persistedDocumentFingerprint.current;
    const coveredByInFlightSave =
      persistenceSaving.current &&
      liveDocument.fingerprint === persistenceInFlightFingerprint.current;

    window.clearTimeout(persistenceSaveTimer.current);
    if (coveredByInFlightSave) {
      persistenceQueued.current = undefined;
      persistenceDirty.current = true;
      return;
    }
    if (confirmed && !persistenceSaving.current) {
      persistenceQueued.current = undefined;
      if (persistenceDirty.current) onSaveSuccess();
      persistenceDirty.current = false;
      return;
    }

    if (!persistenceDirty.current) onSaveStart();
    persistenceDirty.current = true;

    const drainPersistenceQueue = async () => {
      if (persistenceSaving.current || persistenceConflict.current) return;
      persistenceSaving.current = true;
      let failed = false;
      let conflictRetried = false;
      let failureNotified = false;
      try {
        while (persistenceQueued.current && !persistenceConflict.current) {
          const document = persistenceQueued.current;
          persistenceQueued.current = undefined;
          const saveSequence = ++persistenceSaveSequence.current;
          persistenceInFlightFingerprint.current = document.fingerprint;
          persistenceSentFingerprints.current.set(saveSequence, {
            document: document.fingerprint,
            graph: document.graphFingerprint,
          });
          const response = await fetch(`/api/canvas/${persistenceId}`, {
            body: JSON.stringify({
              edges: document.edges,
              nodes: document.nodes,
              revision: persistenceRevision.current,
              saveSequence,
              saveSessionId: persistenceSessionId.current,
              viewport: document.viewport,
            }),
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            method: "PUT",
          });
          if (response.status === 409) {
            const conflict = await response.json() as {
              error?: string;
              graphRevision?: number;
              revision?: number;
              saveSequence?: number;
              saveSessionId?: string | null;
            };
            const supersededBySameSession =
              conflict.saveSessionId === persistenceSessionId.current &&
              Number.isSafeInteger(conflict.saveSequence) &&
              Number(conflict.saveSequence) >= saveSequence;
            if (supersededBySameSession) {
              persistenceRevision.current = Number(conflict.revision);
              persistenceGraphRevision.current = Number(
                conflict.graphRevision ?? conflict.revision,
              );
              setConfirmedPersistenceRevision(Number(conflict.revision));
              setConfirmedGraphRevision(persistenceGraphRevision.current);
              const confirmedFingerprint = persistenceSentFingerprints.current.get(
                Number(conflict.saveSequence),
              );
              if (confirmedFingerprint) {
                persistedDocumentFingerprint.current =
                  confirmedFingerprint.document;
                persistedGraphFingerprint.current = confirmedFingerprint.graph;
              }
            } else if (
              !conflictRetried &&
              Number.isInteger(conflict.revision)
            ) {
              // 最后修改者胜：采用服务端最新 revision，用本页最新内容重试一次。
              conflictRetried = true;
              persistenceRevision.current = Number(conflict.revision);
              persistenceGraphRevision.current = Number(
                conflict.graphRevision ?? conflict.revision,
              );
              setConfirmedPersistenceRevision(Number(conflict.revision));
              setConfirmedGraphRevision(persistenceGraphRevision.current);
            } else {
              failed = true;
              persistenceConflict.current = true;
              setConfirmedPersistenceRevision(undefined);
              setConfirmedGraphRevision(undefined);
              persistenceQueued.current = undefined;
              onSaveConflict(
                conflict.error || "内容已在其他页面更新，已采用最新版",
              );
              break;
            }
          } else if (!response.ok) {
            failed = true;
            if (!failureNotified) {
              failureNotified = true;
              onSaveConflict("保存失败，请检查网络，正在自动重试");
            }
            persistenceQueued.current = canvasSnapshot();
            break;
          } else {
            const { graphRevision, revision } = await response.json() as {
              graphRevision: number;
              revision: number;
            };
            persistenceRevision.current = revision;
            persistenceGraphRevision.current = graphRevision;
            setConfirmedPersistenceRevision(revision);
            setConfirmedGraphRevision(graphRevision);
            broadcastCanvasSaved(
              accountId ?? "",
              persistenceId,
              revision,
              persistenceSessionId.current,
            );
            persistedDocumentFingerprint.current = document.fingerprint;
            persistedGraphFingerprint.current = document.graphFingerprint;
          }

          const latest = canvasSnapshot();
          if (latest.fingerprint !== persistedDocumentFingerprint.current) {
            persistenceQueued.current = latest;
            persistenceDirty.current = true;
          } else {
            persistenceDirty.current = false;
          }
        }
      } catch {
        failed = true;
        persistenceQueued.current = canvasSnapshot();
      } finally {
        persistenceInFlightFingerprint.current = undefined;
        persistenceSaving.current = false;
        drainPersistenceQueueRef.current = drainPersistenceQueue;
        if (
          !failed &&
          !persistenceConflict.current &&
          persistenceQueued.current
        ) {
          void drainPersistenceQueue();
        } else if (
          !failed &&
          !persistenceConflict.current &&
          canvasSnapshot().fingerprint === persistedDocumentFingerprint.current
        ) {
          persistenceDirty.current = false;
          onSaveSuccess();
        } else if (failed && !persistenceConflict.current) {
          persistenceDirty.current = true;
          window.clearTimeout(persistenceSaveTimer.current);
          persistenceSaveTimer.current = window.setTimeout(
            () => void drainPersistenceQueue(),
            1_000,
          );
        }
      }
    };

    persistenceSaveTimer.current = window.setTimeout(() => {
      persistenceQueued.current = canvasSnapshot();
      void drainPersistenceQueue();
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(persistenceSaveTimer.current);
  }, [
    canvasSnapshot,
    edges,
    nodes,
    onSaveConflict,
    onSaveSuccess,
    onSaveStart,
    persistenceFixture,
    persistenceId,
    persistenceReady,
    viewport,
  ]);

  useEffect(() => {
    const hasPendingChanges = () =>
      persistenceDirty.current ||
      persistenceSaving.current ||
      Boolean(persistenceQueued.current);
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  useEffect(() => {
    if (!persistenceFixture || !persistenceReady) return;
    const channel = canvasSyncChannel(accountId ?? "", persistenceId);
    if (!channel) return;
    const onExternalSave = (event: MessageEvent) => {
      const data = event.data as
        | {
            canvasId?: string;
            revision?: number;
            sessionId?: string;
            type?: string;
          }
        | undefined;
      if (
        !data ||
        data.type !== "saved" ||
        data.canvasId !== persistenceId ||
        data.sessionId === persistenceSessionId.current
      ) {
        return;
      }
      if (persistenceDirty.current || persistenceSaving.current) return;
      window.location.reload();
    };
    channel.addEventListener("message", onExternalSave);
    return () => {
      channel.removeEventListener("message", onExternalSave);
      channel.close();
    };
  }, [accountId, persistenceFixture, persistenceId, persistenceReady]);

  useEffect(() => {
    if (!persistenceFixture || !persistenceReady) return;
    const flushBeforeReload = () => {
      const titleValues = new Map(
        [...document.querySelectorAll<HTMLInputElement>(
          '.react-flow__node input[aria-label$="标题"]',
        )].flatMap((input) => {
          if (input.dataset.compositionActive === "true") return [];
          const id = input.closest<HTMLElement>(".react-flow__node")?.dataset.id;
          return id ? [[id, input.value] as const] : [];
        }),
      );
      const textContentValues = new Map(
        [...document.querySelectorAll<HTMLElement>(
          '.react-flow__node [data-testid="text-node-editor"]',
        )].flatMap((editor) => {
          if (editor.dataset.compositionActive === "true") return [];
          const id = editor.closest<HTMLElement>(".react-flow__node")?.dataset.id;
          return id
            ? [[id, {
                content: editor.innerText,
                contentHtml: editor.dataset.committedRichHtml,
              }] as const]
            : [];
        }),
      );
      const nodes = cloneNodes(nodesRef.current).map((node) => {
        const title = titleValues.get(node.id);
        const textContent = textContentValues.get(node.id);
        if (
          (title === undefined || title === node.data.title) &&
          (textContent === undefined ||
            (textContent.content === node.data.content &&
              (textContent.contentHtml === undefined ||
                textContent.contentHtml === node.data.contentHtml)))
        ) {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            content: textContent?.content ?? node.data.content,
            contentHtml:
              textContent?.contentHtml ?? node.data.contentHtml,
            title: title ?? node.data.title,
          },
        };
      });
      const latest = canvasSnapshot(
        nodes,
        edgesRef.current,
        viewportRef.current,
      );
      if (
        persistenceConflict.current ||
        (latest.fingerprint === persistedDocumentFingerprint.current &&
          !persistenceSaving.current)
      ) {
        return;
      }
      window.clearTimeout(persistenceSaveTimer.current);
      const saveSequence = ++persistenceSaveSequence.current;
      persistenceSentFingerprints.current.set(saveSequence, {
        document: latest.fingerprint,
        graph: latest.graphFingerprint,
      });
      void fetch(`/api/canvas/${persistenceId}`, {
        body: JSON.stringify({
          edges: latest.edges,
          nodes: latest.nodes,
          revision: persistenceRevision.current,
          saveSequence,
          saveSessionId: persistenceSessionId.current,
          viewport: latest.viewport,
        }),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "PUT",
      });
    };
    window.addEventListener("pagehide", flushBeforeReload);
    return () => window.removeEventListener("pagehide", flushBeforeReload);
  }, [
    canvasSnapshot,
    cloneNodes,
    persistenceFixture,
    persistenceId,
    persistenceReady,
  ]);

  useEffect(() => {
    const cancelBatchConnection = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBatchDrag(undefined);
        setNodes((current) =>
          current.map((node) =>
            node.data.playlistPicking
              ? {
                  ...node,
                  data: { ...node.data, playlistPicking: false },
                }
              : node,
          ),
        );
      }

      const target = closestEditableControl(event.target);
      const commandKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (!target && commandKey && !event.shiftKey && key === "a") {
        const selectableIds = new Set(
          nodesRef.current
            .filter((node) => !node.parentId)
            .map((node) => node.id),
        );
        if (selectableIds.size) {
          event.preventDefault();
          event.stopPropagation();
          window.getSelection()?.removeAllRanges();
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              selected: selectableIds.has(node.id),
            })),
          );
          setPrimaryId(nodesRef.current.filter((node) => !node.parentId).at(-1)?.id);
        }
        return;
      }
      if (!target && commandKey && !event.shiftKey && key === "c") {
        const selected =
          nodesRef.current.find((node) => node.id === primaryId) ??
          nodesRef.current.filter((node) => node.selected).at(-1);
        if (selected && copyNodeInternally(selected.id)) {
          event.preventDefault();
        }
        return;
      }
      if (!target && commandKey && !event.shiftKey && key === "v") {
        if (pasteInternalNode()) {
          event.preventDefault();
        }
        return;
      }
      // Focused text controls own logical IME-safe undo/redo. Canvas history
      // resumes after the control blurs, using the session checkpoint.
      if (target || key !== "z" || !commandKey) {
        return;
      }

      if (event.shiftKey) {
        const redo = redoHistory.current.pop();
        if (!redo) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        history.current.push({
          edges: cloneEdges(edgesRef.current),
          kind: "snapshot",
          nodes: cloneNodes(nodesRef.current),
        });
        setNodes(cloneNodes(redo.nodes));
        setEdges(cloneEdges(redo.edges).map(stripSelectionFlowMarkers));
        return;
      }

      const entry = history.current.pop();
      if (!entry) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      redoHistory.current.push({
        edges: cloneEdges(edgesRef.current),
        kind: "snapshot",
        nodes: cloneNodes(nodesRef.current),
      });
      if (entry.kind === "snapshot") {
        setNodes(cloneNodes(entry.nodes));
        setEdges(cloneEdges(entry.edges).map(stripSelectionFlowMarkers));
        return;
      }

      const sequence = ++restoreSequence.current;
      const deletedNodes = [
        ...new Map(entry.nodes.map((node) => [node.id, node])).values(),
      ];
      const restoredIds = new Map(
        deletedNodes.map((node) => [
          node.id,
          `${node.id}-restored-${sequence}`,
        ]),
      );
      setNodes((current) => [
        ...current,
        ...deletedNodes.map((node) => ({
          ...node,
          id: restoredIds.get(node.id)!,
          parentId: node.parentId
            ? (restoredIds.get(node.parentId) ?? node.parentId)
            : undefined,
        })),
      ]);
      setEdges((current) => [
        ...current,
        ...entry.edges.map((edge, index) => ({
          ...stripSelectionFlowMarkers(edge),
          id: `${edge.id}-restored-${sequence}-${index}`,
          selected: false,
          source: restoredIds.get(edge.source) ?? edge.source,
          target: restoredIds.get(edge.target) ?? edge.target,
        })),
      ]);
    };

    window.addEventListener("keydown", cancelBatchConnection, true);
    return () => {
      window.clearTimeout(cutTimer.current);
      window.removeEventListener("keydown", cancelBatchConnection, true);
    };
  }, [primaryId, setEdges, setNodes]);

  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  const edgeFlowDirections = connectedEdgeFlowDirections(
    nodes,
    edges,
    selectedNodeIds,
  );
  const flowAnimatedEdgeIds = selectionFlowAnimatedEdgeIds(
    edges,
    selectedNodeIds,
  );
  const visibleEdges = selectedNodeIds.size
    ? edges.map((edge) =>
        selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)
          ? {
              ...edge,
              className: Array.from(
                new Set(
                  [edge.className ?? "", "connected-to-selected-node"]
                    .join(" ")
                    .split(/\s+/)
                    .filter(Boolean),
                ),
              ).join(" "),
              data: {
                ...(edge.data ?? {}),
                flowAnimated: flowAnimatedEdgeIds.has(edge.id),
                flowDirection: edgeFlowDirections.get(edge.id) ?? 1,
              },
            }
          : edge,
      )
    : edges;
  const contextMenuNode = nodeContextMenu
    ? nodes.find((node) => node.id === nodeContextMenu.nodeId)
    : undefined;
  const contextMenuDownloadable = Boolean(
    contextMenuNode &&
      ((contextMenuNode.type === "image" && contextMenuNode.data.imageSrc) ||
        (contextMenuNode.type === "video" && contextMenuNode.data.videoSrc) ||
        (contextMenuNode.type === "audio" && contextMenuNode.data.audioSrc)),
  );
  const groupCandidates = selectedNodes.filter(
    (node) => !node.parentId && node.type !== "group",
  );
  const activePlaylist = nodes.find((node) => node.data.playlistPicking);
  const selectedNodeCount = selectedNodes.length;
  const canGroupSelection =
    selectedNodeCount > 1 && groupCandidates.length === selectedNodeCount;
  const selectionBounds =
    selectedNodeCount > 1
      ? selectedNodes.reduce(
          (bounds, node) => {
            const absolutePosition =
              flowInstance.current?.getInternalNode(node.id)?.internals
                .positionAbsolute ?? node.position;
            const width =
              node.measured?.width ??
              (typeof node.style?.width === "number" ? node.style.width : 0);
            const height =
              node.measured?.height ??
              (typeof node.style?.height === "number" ? node.style.height : 0);
            return {
              bottom: Math.max(bounds.bottom, absolutePosition.y + height),
              left: Math.min(bounds.left, absolutePosition.x),
              right: Math.max(bounds.right, absolutePosition.x + width),
              top: Math.min(bounds.top, absolutePosition.y),
            };
          },
          {
            bottom: Number.NEGATIVE_INFINITY,
            left: Number.POSITIVE_INFINITY,
            right: Number.NEGATIVE_INFINITY,
            top: Number.POSITIVE_INFINITY,
          },
        )
      : undefined;
  const batchAnchor = selectionBounds
    ? {
        x: selectionBounds.right * viewport.zoom + viewport.x + 12,
        y:
          ((selectionBounds.top + selectionBounds.bottom) / 2) * viewport.zoom +
          viewport.y,
      }
    : undefined;
  const multiSelectionToolbarAnchor =
    selectionBounds
      ? {
          x:
            ((selectionBounds.left + selectionBounds.right) / 2) *
              viewport.zoom +
            viewport.x,
          y: selectionBounds.top * viewport.zoom + viewport.y - 8,
        }
      : undefined;
  const createGroup = () => {
    if (!canGroupSelection) return;
    const bounds = groupCandidates.reduce(
      (result, node) => {
        const size = nodeSize(node);
        return {
          bottom: Math.max(result.bottom, node.position.y + size.height),
          left: Math.min(result.left, node.position.x),
          right: Math.max(result.right, node.position.x + size.width),
          top: Math.min(result.top, node.position.y),
        };
      },
      {
        bottom: Number.NEGATIVE_INFINITY,
        left: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
      },
    );
    const groupId = `group-${Date.now()}`;
    const position = { x: bounds.left - 20, y: bounds.top - 20 };
    const childIds = new Set(groupCandidates.map((node) => node.id));
    checkpoint();
    setNodes((current) => [
      {
        id: groupId,
        type: "group",
        position,
        data: { label: "Group", title: "新建组" },
        selected: true,
        style: {
          height: bounds.bottom - bounds.top + 40,
          width: bounds.right - bounds.left + 40,
        },
        zIndex: 0,
      },
      ...current.map((node) =>
        childIds.has(node.id)
          ? {
              ...node,
              parentId: groupId,
              position: {
                x: node.position.x - position.x,
                y: node.position.y - position.y,
              },
              selected: false,
              zIndex: 1,
            }
          : { ...node, selected: false },
      ),
    ]);
    setPrimaryId(groupId);
  };
  const sourceMenuNode = sourceConnectMenu
    ? nodes.find((node) => node.id === sourceConnectMenu.sourceId)
    : undefined;
  const sourceMenuAnchor =
    sourceConnectMenu && sourceMenuNode
      ? {
          x:
            (sourceMenuNode.position.x +
              (sourceMenuNode.measured?.width ??
                (typeof sourceMenuNode.style?.width === "number"
                  ? sourceMenuNode.style.width
                  : 0))) *
              viewport.zoom +
            viewport.x,
          y:
            (sourceMenuNode.position.y +
              (sourceMenuNode.measured?.height ??
                (typeof sourceMenuNode.style?.height === "number"
                  ? sourceMenuNode.style.height
                  : 0)) /
                2) *
              viewport.zoom +
            viewport.y,
        }
      : undefined;
  const generationCanvasRevision =
    persistenceFixture &&
    persistenceReady &&
    !persistenceConflict.current &&
    confirmedPersistenceRevision !== undefined &&
    confirmedPersistenceRevision === persistenceRevision.current &&
    confirmedGraphRevision !== undefined &&
    confirmedGraphRevision === persistenceGraphRevision.current &&
    canvasGraphFingerprint({ edges, nodes }) ===
      persistedGraphFingerprint.current
      ? confirmedGraphRevision
      : undefined;
  const generationCanvasRevisionRef = useRef<number | undefined>(undefined);
  generationCanvasRevisionRef.current = generationCanvasRevision;
  const flushCanvasSave = useCallback(async () => {
    if (persistenceConflict.current) {
      throw new Error("画布保存状态异常，请刷新后重试");
    }
    if (persistenceDirty.current && !persistenceSaving.current) {
      persistenceQueued.current = canvasSnapshotRef.current();
      drainPersistenceQueueRef.current();
    }
    const deadline = Date.now() + 8_000;
    while (persistenceDirty.current || persistenceSaving.current) {
      if (Date.now() > deadline) {
        throw new Error("画布保存超时，请稍后重试");
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }, []);
  const waitForCanvasRevision = useCallback(async (timeoutMs = 8_000) => {
    if (persistenceConflict.current) {
      throw new Error("画布保存状态异常，请刷新后重试");
    }
    if (persistenceDirty.current && !persistenceSaving.current) {
      persistenceQueued.current = canvasSnapshotRef.current();
      drainPersistenceQueueRef.current();
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!persistenceDirty.current && !persistenceSaving.current) {
        const revision = generationCanvasRevisionRef.current;
        if (revision !== undefined) {
          // Let the latest render commit the confirmed revision before the
          // caller reads a fresh node closure. A timeout fallback keeps the
          // wait working even when requestAnimationFrame is throttled.
          await new Promise((resolve) => {
            const fallback = window.setTimeout(resolve, 100);
            window.requestAnimationFrame(() => {
              window.clearTimeout(fallback);
              resolve(null);
            });
          });
          const latest = generationCanvasRevisionRef.current;
          if (latest !== undefined) return latest;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error("画布保存超时，请稍后再试");
  }, []);
  const generationCanvasContextValue = useMemo(
    () => ({
      accountId: accountId ?? "",
      canvasId: persistenceId,
      canvasRevision: generationCanvasRevision,
      flushCanvasSave,
      isFixture: Boolean(fixtureId),
      waitForCanvasRevision,
    }),
    [
      accountId,
      fixtureId,
      flushCanvasSave,
      generationCanvasRevision,
      persistenceId,
      waitForCanvasRevision,
    ],
  );
  const canvasSelectionUiContextValue = useMemo(
    () => ({ selectedNodeCount }),
    [selectedNodeCount],
  );

  useEffect(() => {
    if (selectedNodeCount <= 1) return;
    window.getSelection()?.removeAllRanges();
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      (activeElement.closest(".react-flow__node") ||
        activeElement.closest(".react-flow__node-toolbar"))
    ) {
      activeElement.blur();
    }
  }, [selectedNodeCount]);

  return (
    <GenerationCanvasContext.Provider
      value={generationCanvasContextValue}
    >
      <WorkflowExecutionProvider
        getEdges={() => edgesRef.current}
        getNodes={() => nodesRef.current}
        notify={showWorkflowToast}
      >
      <CanvasGraphMutationContext.Provider value={{ setEdges, setNodes }}>
      <CanvasCheckpointContext.Provider value={checkpoint}>
      <CanvasSelectionUiContext.Provider value={canvasSelectionUiContextValue}>
      <div
      aria-label="画布"
      className="canvas-world"
      data-agent-reference-mode={agentReferenceMode ? "true" : undefined}
      data-create-menu={
        createMenu || blankContextMenu || nodeContextMenu ? "true" : undefined
      }
      data-multi-selection={selectedNodeCount > 1 ? "true" : undefined}
      data-testid="canvas-world"
      data-viewport-x={viewport.x}
      data-viewport-y={viewport.y}
      data-viewport-zoom={viewport.zoom}
      data-primary-node={primaryId}
      data-edge-count={edges.length}
      data-edge-auto-pan="true"
      data-node-collision={
        snapEnabled ? "last-valid-position" : "allow-overlap"
      }
      data-group-count={
        nodes.filter((node) => node.data.variant === "group").length
      }
      data-node-count={nodes.length}
      data-persistence-ready={persistenceReady ? "true" : "false"}
      data-selected-node-count={selectedNodeCount}
      data-selected-edge-count={edges.filter((edge) => edge.selected).length}
      onWheelCapture={handleCanvasWheelCapture}
      onDragOver={(event) => {
        if (
          Array.from(event.dataTransfer.types).includes(
            CANVAS_LIBRARY_ASSET_MIME,
          )
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const raw = event.dataTransfer.getData(CANVAS_LIBRARY_ASSET_MIME);
        if (!raw) return;
        event.preventDefault();
        try {
          const asset = JSON.parse(raw) as CanvasLibraryAsset;
          if (
            !asset ||
            !["audio", "image", "video"].includes(asset.kind) ||
            typeof asset.id !== "string" ||
            typeof asset.label !== "string" ||
            typeof asset.src !== "string"
          ) {
            return;
          }
          addDroppedLibraryAsset(asset, {
            x: event.clientX,
            y: event.clientY,
          });
        } catch {
          // Ignore malformed external drag payloads.
        }
      }}
      onDoubleClick={(event) => {
        if (
          !worldRef.current ||
          !(event.target instanceof Element) ||
          event.target.closest(
            ".react-flow__node, button, input, textarea, [contenteditable='true'], .nodrag",
          ) ||
          !event.target.closest(".react-flow__pane")
        ) {
          return;
        }
        event.preventDefault();
        const bounds = worldRef.current.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        setCreateMenu({
          flow: {
            x: (x - viewport.x) / viewport.zoom,
            y: (y - viewport.y) / viewport.zoom,
          },
          screen: {
            x: Math.max(8, Math.min(x, bounds.width - 296)),
            y: Math.max(8, Math.min(y, bounds.height - 518)),
          },
        });
        setUploadError("");
        setSourceConnectMenu(undefined);
        setNodeContextMenu(undefined);
      }}
      ref={worldRef}
      role="application"
    >
      <ReactFlow
        autoPanOnNodeDrag
        autoPanSpeed={15}
        connectionLineStyle={{ stroke: "#ffffff60", strokeWidth: 1 }}
        defaultEdgeOptions={{ interactionWidth: 20 }}
        deleteKeyCode={["Backspace", "Delete"]}
        edges={visibleEdges}
        edgeTypes={edgeTypes}
        edgesReconnectable={false}
        elementsSelectable={!agentReferenceMode}
        elevateEdgesOnSelect={false}
        elevateNodesOnSelect
        isValidConnection={isValidConnection}
        maxZoom={2}
        multiSelectionKeyCode="Shift"
        minZoom={0.15}
        nodes={nodes}
        nodesDraggable={!activePlaylist && !agentReferenceMode}
        nodesConnectable
        nodeTypes={nodeTypes}
        onConnect={addConnection}
        onConnectEnd={(event, state) => {
          if (
            state.isValid ||
            !state.fromNode ||
            state.fromHandle?.type !== "source"
          ) {
            return;
          }

          const point =
            "changedTouches" in event ? event.changedTouches[0] : event;
          const hit = document.elementFromPoint(point.clientX, point.clientY);
          if (hit?.closest(".react-flow__handle.source")) {
            return;
          }

          const target = hit?.closest<HTMLElement>(".react-flow__node");
          if (target?.dataset.id) {
            const added = addConnection({
              source: state.fromNode.id,
              sourceHandle: state.fromHandle.id ?? null,
              target: target.dataset.id,
              targetHandle: "target",
            });
            if (added) return;
          }

          const sourceNode = nodes.find(
            (node) => node.id === state.fromNode?.id,
          );
          if (sourceNode?.data.sourceKind && worldRef.current) {
            const worldRect = worldRef.current.getBoundingClientRect();
            setSourceConnectMenu({
              drop: {
                x: point.clientX - worldRect.left,
                y: point.clientY - worldRect.top,
              },
              kind: sourceNode.data.sourceKind,
              sourceId: sourceNode.id,
            });
          }
        }}
        onEdgeMouseEnter={(_, edge) => {
          window.clearTimeout(cutTimer.current);
          cutTimer.current = window.setTimeout(() => {
            setEdges((current) =>
              current.map((candidate) =>
                candidate.id === edge.id &&
                candidate.data?.cutIndicator !== "click"
                  ? {
                      ...candidate,
                      data: { ...candidate.data, cutIndicator: "hover" },
                    }
                  : candidate,
              ),
            );
          }, 700);
        }}
        onEdgeMouseLeave={(event, edge) => {
          window.clearTimeout(cutTimer.current);
          const related =
            event.relatedTarget instanceof Element
              ? event.relatedTarget.closest("[data-edge-cut-for]")
              : null;

          if (related?.getAttribute("data-edge-cut-for") === edge.id) {
            return;
          }

          setEdges((current) =>
            current.map((candidate) =>
              candidate.id === edge.id &&
              candidate.data?.cutIndicator === "hover"
                ? {
                    ...candidate,
                    data: {
                      ...candidate.data,
                      cutIndicator: undefined,
                    },
                  }
                : candidate,
            ),
          );
        }}
        onEdgeClick={(_, edge) => {
          window.clearTimeout(cutTimer.current);
          setEdges((current) =>
            current.map((candidate) => ({
              ...candidate,
              data: {
                ...candidate.data,
                cutIndicator:
                  candidate.id === edge.id ? "click" : undefined,
              },
            })),
          );
        }}
        onEdgesChange={onEdgesChange}
        onDelete={({ edges: deletedEdges, nodes: deletedNodes }) => {
          pushHistory({
            edges: deletedEdges.map(stripSelectionFlowMarkers),
            kind: "delete",
            nodes: cloneNodes(deletedNodes),
          });
        }}
        onBeforeDelete={async ({ edges: deletingEdges, nodes: deletingNodes }) => {
          const groupIds = new Set(
            deletingNodes
              .filter((node) => node.type === "group")
              .map((node) => node.id),
          );
          if (!groupIds.size) return true;
          const children = nodesRef.current.filter(
            (node) => node.parentId && groupIds.has(node.parentId),
          );
          const deletingNodeIds = new Set(
            deletingNodes.map((node) => node.id),
          );
          const childIds = new Set(children.map((node) => node.id));
          const edgeIds = new Set(deletingEdges.map((edge) => edge.id));
          return {
            nodes: [
              ...deletingNodes,
              ...children.filter((node) => !deletingNodeIds.has(node.id)),
            ],
            edges: [
              ...deletingEdges,
              ...edgesRef.current.filter(
                (edge) =>
                  !edgeIds.has(edge.id) &&
                  (childIds.has(edge.source) || childIds.has(edge.target)),
              ),
            ],
          };
        }}
        onInit={(instance) => {
          flowInstance.current = instance;
          onReady(() => void instance.fitView({ duration: 0, padding: 0.2 }));
        }}
        onNodesChange={(changes) => {
          if (
            !nodeDragging.current &&
            changes.some((change) => change.type === "position")
          ) {
            checkpoint();
          }
          onNodesChange(keepLastNonCollidingPositions(changes));
        }}
        onNodeDragStart={() => {
          nodeDragging.current = true;
          checkpoint();
        }}
        onNodeDragStop={() => {
          nodeDragging.current = false;
        }}
        onNodeClick={(_, node) => {
          setNodeContextMenu(undefined);
          if (agentReferenceMode) {
            setNodes((current) =>
              current.map((candidate) => ({
                ...candidate,
                selected: false,
              })),
            );
            setPrimaryId(undefined);
            onAgentReferencePick?.({
              id: node.id,
              thumbnail: node.data.imageSrc,
              title: node.data.title ?? node.data.label,
            });
            return;
          }
          if (activePlaylist && node.id !== activePlaylist.id) {
            const sourceClips =
              node.type === "video" && node.data.videoSrc && node.data.videoDuration
                ? [
                    {
                      end: node.data.videoDuration,
                      id: `clip-${node.id}-${Date.now()}`,
                      sourceNodeId: node.id,
                      sourceEnd: node.data.videoDuration,
                      sourceStart: 0,
                      src: node.data.videoSrc,
                      start: 0,
                      title: node.data.title ?? "Video",
                    },
                  ]
                : node.type === "playlist"
                  ? node.data.playlistClips ?? []
                  : [];
            if (sourceClips.length) {
              checkpoint();
              setNodes((current) =>
                current.map((candidate) =>
                  candidate.id === activePlaylist.id
                    ? {
                        ...candidate,
                        selected: true,
                        data: {
                          ...candidate.data,
                          playlistClips: [
                            ...(candidate.data.playlistClips ?? []),
                            ...sourceClips.map((clip, index) => ({
                              ...clip,
                              id: `${clip.id}-${Date.now()}-${index}`,
                            })),
                          ],
                        },
                      }
                    : { ...candidate, selected: false },
                ),
              );
              setPlaylistToast("已添加到播放列表");
              window.setTimeout(() => setPlaylistToast(""), 1_200);
            }
            return;
          }
          if (sourceConnectMenu?.sourceId !== node.id) {
            setSourceConnectMenu(undefined);
          }
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (!worldRef.current || agentReferenceMode) return;
          const bounds = worldRef.current.getBoundingClientRect();
          const x = Math.max(
            8,
            Math.min(event.clientX - bounds.left, bounds.width - 248),
          );
          const y = Math.max(
            8,
            Math.min(event.clientY - bounds.top, bounds.height - 471),
          );
          setNodes((current) =>
            current.map((candidate) => ({
              ...candidate,
              selected: candidate.id === node.id,
            })),
          );
          setPrimaryId(node.id);
          setNodeContextMenu({ nodeId: node.id, screen: { x, y } });
          setBlankContextMenu(undefined);
          setCreateMenu(undefined);
          setSourceConnectMenu(undefined);
          setUploadError("");
        }}
        onPaneClick={() => {
          setPrimaryId(undefined);
          setBlankContextMenu(undefined);
          setNodeContextMenu(undefined);
          setCreateMenu(undefined);
          setUploadError("");
          setSourceConnectMenu(undefined);
          clearCutIndicators();
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          if (!worldRef.current) return;
          const bounds = worldRef.current.getBoundingClientRect();
          const x = Math.max(
            8,
            Math.min(event.clientX - bounds.left, bounds.width - 248),
          );
          const y = Math.max(
            8,
            Math.min(event.clientY - bounds.top, bounds.height - 365),
          );
          setBlankContextMenu({
            canPaste: Boolean(internalClipboard.current),
            canUndo: history.current.length > 0,
            flow: {
              x: (x - viewport.x) / viewport.zoom,
              y: (y - viewport.y) / viewport.zoom,
            },
            screen: { x, y },
          });
          setCreateMenu(undefined);
          setNodeContextMenu(undefined);
          setSourceConnectMenu(undefined);
          setUploadError("");
        }}
        onSelectionChange={({ nodes: selectedNodes }) =>
          setPrimaryId(selectedNodes.at(-1)?.id)
        }
        onViewportChange={onViewportChange}
        panOnDrag={agentReferenceMode ? true : [1, 2]}
        panOnScroll
        panOnScrollSpeed={1.2}
        proOptions={{ hideAttribution: true }}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={!agentReferenceMode}
        snapGrid={[20, 20]}
        snapToGrid={snapEnabled}
        viewport={viewport}
        zoomOnDoubleClick={false}
        zoomOnPinch
        zoomOnScroll={false}
      >
        <Background
          className="canvas-grid"
          color="rgba(255, 255, 255, 0.3)"
          gap={20}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        {batchDrag && (
          <svg
            aria-hidden="true"
            className="canvas-connection-preview batch-connection-preview"
            data-testid="batch-connection-preview"
          >
            {batchDrag.sources.map((source) => {
              const middleX = (source.x + batchDrag.cursor.x) / 2;
              return (
                <path
                  d={`M${source.x},${source.y} C${middleX},${source.y} ${middleX},${batchDrag.cursor.y} ${batchDrag.cursor.x},${batchDrag.cursor.y}`}
                  key={source.id}
                />
              );
            })}
          </svg>
        )}
        {sourceConnectMenu && sourceMenuAnchor && (
          <svg
            aria-hidden="true"
            className="canvas-connection-preview source-connect-preview"
            data-testid="source-connect-preview"
          >
            <path
              d={`M${sourceMenuAnchor.x},${sourceMenuAnchor.y} C${(sourceMenuAnchor.x + sourceConnectMenu.drop.x) / 2},${sourceMenuAnchor.y} ${(sourceMenuAnchor.x + sourceConnectMenu.drop.x) / 2},${sourceConnectMenu.drop.y} ${sourceConnectMenu.drop.x},${sourceConnectMenu.drop.y}`}
            />
          </svg>
        )}
        <ConnectionEscapeGuard />
        {minimapOpen && (
          <MiniMap
            className="tap-minimap"
            maskColor="rgba(0, 0, 0, 0.68)"
            nodeColor="#7a7a7a"
            nodeStrokeColor="#bdbdbd"
            position="bottom-left"
          />
        )}
      </ReactFlow>
      {nodeContextMenu && contextMenuNode && (
        <div
          className="node-context-menu nodrag nopan"
          data-testid="node-context-menu"
          ref={nodeContextMenuRef}
          style={{
            left: nodeContextMenu.screen.x,
            top: nodeContextMenu.screen.y,
          }}
        >
          <div
            aria-label="节点右键菜单"
            className="node-context-list"
            role="listbox"
          >
            <button
              aria-selected="false"
              disabled
              title="素材库写入功能尚未接入"
              role="option"
              type="button"
            >
              保存到素材库
            </button>
            <div className="node-context-divider" role="separator" />
            <button
              aria-selected="false"
              disabled
              title="当前节点没有可应用的历史结果"
              role="option"
              type="button"
            >
              应用所有历史
            </button>
            <button
              aria-selected="false"
              disabled={!contextMenuDownloadable}
              onClick={() => {
                downloadNodeMedia(contextMenuNode);
                setNodeContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              下载
            </button>
            <div className="node-context-divider" role="separator" />
            <button
              aria-selected="true"
              data-selected="true"
              onClick={() => {
                copyNodeInternally(contextMenuNode.id);
                setNodeContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              <span>复制</span>
              <kbd>⌘C</kbd>
            </button>
            <button
              aria-selected="false"
              disabled
              title="请在画布空白处粘贴"
              role="option"
              type="button"
            >
              <span>粘贴</span>
              <kbd>⌘V</kbd>
            </button>
            <button
              aria-selected="false"
              onClick={() => {
                appendNodeDuplicate(contextMenuNode);
                setNodeContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              副本
            </button>
            <div className="node-context-divider" role="separator" />
            <button
              aria-selected="false"
              onClick={() => {
                deleteNodeFromContextMenu(contextMenuNode.id);
                setNodeContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              <span>删除</span>
              <kbd>⌫,del</kbd>
            </button>
            <div className="node-context-divider" role="separator" />
            <button
              aria-selected="false"
              disabled
              title="私有版仅使用画布内部复制，不覆盖系统剪贴板"
              role="option"
              type="button"
            >
              复制到剪贴板
            </button>
            <div className="node-context-divider" role="separator" />
            <button
              aria-selected="false"
              disabled
              title="未配置外部问题反馈服务"
              role="option"
              type="button"
            >
              反馈问题
            </button>
          </div>
        </div>
      )}
      {blankContextMenu && (
        <div
          className="blank-context-menu nodrag nopan"
          data-testid="blank-context-menu"
          ref={blankContextMenuRef}
          style={{
            left: blankContextMenu.screen.x,
            top: blankContextMenu.screen.y,
          }}
        >
          <div
            aria-label="画布空白右键菜单"
            className="blank-context-list"
            role="listbox"
          >
            <button
              aria-selected="true"
              data-selected="true"
              onClick={() => {
                setBlankContextMenu(undefined);
                uploadInput.current?.click();
              }}
              role="option"
              type="button"
            >
              上传
            </button>
            <button
              aria-selected="false"
              onClick={() => {
                setBlankContextMenu(undefined);
                onOpenAssets?.();
              }}
              role="option"
              type="button"
            >
              添加资产
            </button>
            <div className="blank-context-divider" role="separator" />
            <button
              aria-selected="false"
              onClick={() => {
                setCreateMenu({
                  flow: blankContextMenu.flow,
                  screen: blankContextMenu.screen,
                });
                setBlankContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              添加节点
            </button>
            <button
              aria-selected="false"
              onClick={() => {
                setCreateMenu({
                  flow: blankContextMenu.flow,
                  screen: blankContextMenu.screen,
                });
                setBlankContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              添加辅助工具
            </button>
            <div className="blank-context-divider" role="separator" />
            <button
              aria-selected="false"
              disabled={!blankContextMenu.canUndo}
              onClick={() => {
                window.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    bubbles: true,
                    key: "z",
                    metaKey: true,
                  }),
                );
                setBlankContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              <span>撤销</span>
              <kbd>⌘Z</kbd>
            </button>
            <button
              aria-selected="false"
              disabled
              role="option"
              type="button"
            >
              <span>重做</span>
              <kbd>⇧⌘Z</kbd>
            </button>
            <div className="blank-context-divider" role="separator" />
            <button
              aria-selected="false"
              disabled={!blankContextMenu.canPaste}
              onClick={() => {
                pasteInternalNode();
                setBlankContextMenu(undefined);
              }}
              role="option"
              type="button"
            >
              <span>粘贴</span>
              <kbd>⌘V</kbd>
            </button>
          </div>
        </div>
      )}
      <input
        accept="image/png,image/jpeg,image/webp,image/gif"
        data-testid="canvas-image-upload-input"
        hidden
        onChange={(event) => {
          void uploadImage(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
        ref={uploadInput}
        type="file"
      />
      {createMenu && (
        <div
          aria-label="添加节点"
          className="add-node-menu nodrag nopan"
          data-testid="add-node-menu"
          role="menu"
          style={{ left: createMenu.screen.x, top: createMenu.screen.y }}
        >
          <div className="add-node-menu-section">添加节点</div>
          {(
            [
              ["text", "文本", "text"],
              ["image", "图片", "image"],
              ["video", "视频", "video"],
              ["audio", "音频", "audio"],
            ] as const
          ).map(([type, label, icon]) => (
            <button
              key={type}
              onClick={() => addEmptyNode(type)}
              role="menuitem"
              type="button"
            >
              <SourceMenuIcon name={icon} />
              <span>{label}</span>
            </button>
          ))}
          <button disabled role="menuitem" type="button">
            <SourceMenuIcon name="world" />
            <span>3D 世界</span>
          </button>
          <div className="add-node-menu-section">辅助工具</div>
          <button
            onClick={() => addEmptyNode("playlist")}
            role="menuitem"
            type="button"
          >
            <SourceMenuIcon name="playlist" />
            <span>播放列表</span>
          </button>
          <div className="add-node-menu-section">添加资源</div>
          <button
            data-testid="upload-image-menu-item"
            disabled={uploading}
            onClick={() => uploadInput.current?.click()}
            role="menuitem"
            type="button"
          >
            <SourceMenuIcon name="upload" />
            <span>{uploading ? "上传中…" : "上传"}</span>
          </button>
          {uploadError && (
            <div className="add-node-menu-error" role="alert">
              {uploadError}
            </div>
          )}
        </div>
      )}
      {batchAnchor && (
        <button
          aria-label="连接所有已选节点"
          className="batch-connect-handle nodrag nopan"
          data-testid="batch-connect-handle"
          onPointerCancel={() => setBatchDrag(undefined)}
          onPointerDown={(event) => {
            if (event.button !== 0 || !worldRef.current) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const worldRect = worldRef.current.getBoundingClientRect();
            const sources = selectedNodes.map((node) => {
              const absolutePosition =
                flowInstance.current?.getInternalNode(node.id)?.internals
                  .positionAbsolute ?? node.position;
              const width =
                node.measured?.width ??
                (typeof node.style?.width === "number" ? node.style.width : 0);
              const height =
                node.measured?.height ??
                (typeof node.style?.height === "number"
                  ? node.style.height
                  : 0);
              return {
                id: node.id,
                x:
                  (absolutePosition.x + width) * viewport.zoom + viewport.x,
                y:
                  (absolutePosition.y + height / 2) * viewport.zoom + viewport.y,
              };
            });

            setBatchDrag({
              cursor: {
                x: event.clientX - worldRect.left,
                y: event.clientY - worldRect.top,
              },
              pointerId: event.pointerId,
              sources,
            });
          }}
          onPointerMove={(event) => {
            if (
              !batchDrag ||
              batchDrag.pointerId !== event.pointerId ||
              !worldRef.current
            ) {
              return;
            }

            const worldRect = worldRef.current.getBoundingClientRect();
            setBatchDrag({
              ...batchDrag,
              cursor: {
                x: event.clientX - worldRect.left,
                y: event.clientY - worldRect.top,
              },
            });
          }}
          onPointerUp={(event) => {
            if (!batchDrag || batchDrag.pointerId !== event.pointerId) {
              return;
            }

            const target = document
              .elementFromPoint(event.clientX, event.clientY)
              ?.closest<HTMLElement>(".react-flow__node");
            if (target?.dataset.id) {
              addBatchConnections(
                batchDrag.sources.map((source) => source.id),
                target.dataset.id,
              );
            }
            setBatchDrag(undefined);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          style={{ left: batchAnchor.x, top: batchAnchor.y }}
          type="button"
        />
      )}
      {multiSelectionToolbarAnchor && (
        <div
          className="multi-selection-toolbar nodrag nopan"
          data-testid="multi-selection-toolbar"
          style={{
            left: multiSelectionToolbarAnchor.x,
            top: multiSelectionToolbarAnchor.y,
          }}
        >
          <button
            disabled={!canGroupSelection}
            onClick={createGroup}
            title={
              canGroupSelection
                ? "将已选节点打组"
                : "只能将两个或更多未打组的顶层节点打组"
            }
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <rect height="14" rx="2" width="14" x="3" y="7" />
              <path d="M7 7V4h14v14h-4" />
            </svg>
            打组
          </button>
        </div>
      )}
      {sourceConnectMenu && sourceMenuAnchor && (
        <div
          aria-label={`${sourceConnectMenu.kind} 来源操作`}
          className="source-connect-menu nodrag nopan"
          data-source-kind={sourceConnectMenu.kind}
          data-testid="source-connect-menu"
          role="menu"
          style={{
            left: sourceConnectMenu.drop.x,
            top: sourceConnectMenu.drop.y,
          }}
        >
          <div className="source-connect-menu-title">引用该节点生成</div>
          <div className="source-connect-menu-items">
            {sourceMenuItems[sourceConnectMenu.kind].map((item) => (
              <button key={item.label} role="menuitem" type="button">
                <span className="source-connect-menu-icon">
                  <SourceMenuIcon name={item.icon} />
                </span>
                <span className="source-connect-menu-copy">
                  <span className="source-connect-menu-label">
                    {item.label}
                    {"beta" in item && item.beta && (
                      <span className="source-connect-menu-beta">Beta</span>
                    )}
                  </span>
                  <span className="source-connect-menu-description">
                    {item.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {activePlaylist && (
        <div
          className="playlist-picker-banner nodrag nopan"
          data-testid="playlist-picker-banner"
        >
          <span>选择以添加到播放列表</span>
          <button
            onClick={() =>
              setNodes((current) =>
                current.map((node) =>
                  node.id === activePlaylist.id
                    ? {
                        ...node,
                        data: { ...node.data, playlistPicking: false },
                      }
                    : node,
                ),
              )
            }
            type="button"
          >
            退出
          </button>
        </div>
      )}
      {playlistToast && (
        <div className="playlist-picker-toast" role="status">
          {playlistToast}
        </div>
      )}
      {workflowToast && (
        <div
          className={`workflow-run-toast workflow-run-toast-${workflowToast.kind}`}
          data-testid="workflow-run-toast"
          role="status"
        >
          {workflowToast.message}
        </div>
      )}
      {minimapOpen && (
        <div
          aria-label="拖动小地图"
          className="tap-minimap-drag-layer"
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            minimapDrag.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              viewport,
            };
          }}
          onPointerMove={(event) => {
            const drag = minimapDrag.current;
            if (!drag || drag.pointerId !== event.pointerId) {
              return;
            }
            onViewportChange({
              ...drag.viewport,
              x: drag.viewport.x - (event.clientX - drag.startX) * 2,
              y: drag.viewport.y - (event.clientY - drag.startY) * 2,
            });
          }}
          onPointerUp={(event) => {
            if (minimapDrag.current?.pointerId === event.pointerId) {
              minimapDrag.current = undefined;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          role="application"
        />
      )}
      </div>
      </CanvasSelectionUiContext.Provider>
      </CanvasCheckpointContext.Provider>
      </CanvasGraphMutationContext.Provider>
      </WorkflowExecutionProvider>
    </GenerationCanvasContext.Provider>
  );
}
