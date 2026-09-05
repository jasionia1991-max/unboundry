import type { WorkflowRunSummary } from "../../../types/workflowRuns";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useEdges,
  useNodes,
  useReactFlow,
  useStoreApi,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type NodeChange,
  type NodePositionChange,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  authoritativeCanvasNodeDataPatchAllowed,
  type CanvasAuthoritativeNodeDataAdoption,
  type CanvasUploadedAssetAdoption,
  canvasEdgeViewUpdateAllowed,
  canvasUploadedAssetAdoptionAllowed,
  CanvasGraphMutationContext,
  canvasViewUpdateAllowed,
  rollbackCanvasNodeAdoption,
  settleCanvasMutationSaveIndicator,
  tryCommitCanvasNodeAdoption,
  useCanvasGraphMutation,
} from "./CanvasGraphMutationContext";
import {
  CanvasCheckpointContext,
  closestEditableControl,
  useCanvasCheckpoint,
} from "./CanvasHistory";
import { CanvasSelectionUiContext } from "./CanvasSelectionContext";
import { discardImageAsset, uploadImageAsset } from "./imageAsset";
import { withImageReferenceInputMode } from "./imageReferenceMode";
import type { ProbeNodeType } from "./ProbeNode";
import { hasInteractionProbeNodes } from "./probeFixtures";
import { storedRichTextValue } from "./TextNode";
import type { CuttableEdge } from "./canvasTypes";
import { createCanvasGraphCommandPort } from "./canvasPorts";
import {
  buildCanvasModelTransitionCommand,
  createCanvasModelTransitionPort,
} from "./CanvasModelTransitionCommand";
import {
  CANVAS_READ_TIMEOUT_MS,
  CanvasSaveSessionStorageError,
  createBrowserCanvasPersistenceFacade,
  hydrateCanvasPersistence,
  loadCanvasPersistenceWithDeadline,
  isCanvasLoadToken,
  isCanvasSaveAttemptId,
  isCanvasSaveEpoch,
  useCanvasPersistenceLifecycleCoordinator,
  useCanvasPersistenceSaveCoordinator,
  type CanvasLoadFailure,
  type CanvasLoadState,
  type CanvasPendingPagehide,
  type CanvasPendingSaveAttempt,
  type CanvasPersistenceSnapshot,
  type CanvasSaveSession,
} from "./canvasPersistenceFacade";
export {
  isCanvasSaveSuccess,
  isLoadedCanvasDocument,
} from "./canvasPersistenceFacade";
export type { CanvasLoadState } from "./canvasPersistenceFacade";
import { fitVisualMediaSize, NODE_DEFAULT_SIZES } from "./mediaGeometry";
import {
  effectiveMediaInputState,
  fetchTrustedMediaMetadata,
  trustedMediaPatch,
} from "./mediaInputMetadata";
import {
  canvasGraphFingerprint,
  canvasUserDocumentFingerprint,
} from "./canvasDocumentFingerprint";
import {
  canvasEdgeDataFieldDescriptors,
  canvasEdgeTopLevelFieldDescriptors,
  canvasNodeDataFieldDescriptors,
  canvasNodeTopLevelFieldDescriptors,
  type CanvasFieldDescriptor,
} from "../../../types/canvasFingerprint";
import { zoomViewportAtScreenPoint } from "./viewportMath";
import {
  connectedEdgeFlowDirections,
  selectionFlowAnimatedEdgeIds,
  stripSelectionFlowMarkers,
} from "./selectionFlow";
import {
  emptyCanvasTemplateSpot,
  findTemplateSpot,
  nodePlacementRect,
  offsetTemplate,
  templateAnchor,
  templateBounds,
  TEMPLATE_MODEL_SELECTION_REQUIRED_ID,
  viewportForBounds,
} from "./templatePlacement";
import {
  GenerationCanvasContext,
  type AuthoritativeGenerationCanvasMutation,
} from "../generation/GenerationCanvasContext";
import { createGroupRunSummaryScope } from "../generation/groupRunSummary";
import {
  canvasNodeMutationAdmissionHeldLocally,
  runWithCanvasGraphMutationAdmission,
} from "../generation/generationTasks";
import { legacyTerminalNodeDataFingerprint } from
  "../generation/legacyTerminalGenerationReconciler";
import {
  shouldAcceptCanvasRevision,
  waitForPaint,
  workflowToastDurationMs,
} from "../generation/groupRunPersist";
import {
  useWorkflowExecution,
  WorkflowExecutionProvider,
} from "../generation/WorkflowExecutionProvider";
import { isExecutableWorkflowNode } from "../generation/workflowExecution";
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
} from "../../../types/modelParameters";
import { normalizeModelInputs } from "../../../types/modelInputSemanticCompiler";
import { normalizePersistedMediaNodes } from "../../../types/persistedMediaSources";
import { UpdateNotice } from "../updates/UpdateNotice";
import { canvasNodeRegistry } from "./canvasNodeRegistry";
import type { TemplateNodeKind } from "../../../types/nodeVocabulary";

const emptyNodes: ProbeNodeType[] = [];

export function scrubDuplicatedGenerationState(
  node: ProbeNodeType,
): ProbeNodeType {
  return {
    ...node,
    data: {
      ...node.data,
      audioGenerationError: undefined,
      audioGenerationErrorCode: undefined,
      audioGenerationInputKey: undefined,
      audioGenerationOwnershipKey: undefined,
      audioGenerationRetryAllowed: undefined,
      audioGenerationRetryBlockCode: undefined,
      audioGenerationRetryBlockReason: undefined,
      audioGenerationTaskId: undefined,
      audioGenerating: false,
      imageGenerationError: undefined,
      imageGenerationErrorCode: undefined,
      imageGenerationInputKey: undefined,
      imageGenerationOwnershipKey: undefined,
      imageGenerationRetryAllowed: undefined,
      imageGenerationRetryBlockCode: undefined,
      imageGenerationRetryBlockReason: undefined,
      imageGenerationTaskId: undefined,
      imageGenerating: false,
      textGenerationError: undefined,
      textGenerationErrorCode: undefined,
      textGenerationInputKey: undefined,
      textGenerationOwnershipKey: undefined,
      textGenerationRetryAllowed: undefined,
      textGenerationRetryBlockCode: undefined,
      textGenerationRetryBlockReason: undefined,
      textGenerationTaskId: undefined,
      textGenerating: false,
      videoGenerationError: undefined,
      videoGenerationErrorCode: undefined,
      videoGenerationInputKey: undefined,
      videoGenerationOwnershipKey: undefined,
      videoGenerationRetryAllowed: undefined,
      videoGenerationRetryBlockCode: undefined,
      videoGenerationRetryBlockReason: undefined,
      videoGenerationTaskId: undefined,
      videoGenerating: false,
    },
  };
}

function throwIfCanvasWaitAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

function waitForCanvasState(ms: number, signal?: AbortSignal) {
  throwIfCanvasWaitAborted(signal);
  return new Promise<void>((resolve, reject) => {
    let timer: number | undefined;
    const onAbort = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * React Flow does not support a node whose parent points to itself. Older
 * public-template data can contain that invalid root link; treat the template
 * root as a world-space node before it reaches React Flow so viewport
 * measurement can never fold its own position back into the graph.
 */
export function normalizeCanvasParentLinks<T extends { id: string; parentId?: string }>(
  nodes: readonly T[],
): T[] {
  return nodes.map((node) =>
    node.parentId === node.id ? { ...node, parentId: undefined } : node,
  );
}

/**
 * A server refresh replaces durable fields, but React Flow's measured geometry
 * and interaction flags belong to the mounted view. Dropping those fields from
 * an already rendered node makes React Flow hide it until another measurement
 * happens, so retain only the explicitly classified top-level view fields for
 * an unchanged node identity/type.
 */
export function mergeAuthoritativeNodesWithViewState(
  currentNodes: readonly ProbeNodeType[],
  authoritativeNodes: readonly ProbeNodeType[],
): ProbeNodeType[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  return authoritativeNodes.map((authoritative) => {
    const current = currentById.get(authoritative.id);
    if (!current || current.type !== authoritative.type) return authoritative;
    const merged = { ...authoritative } as Record<string, unknown>;
    const currentRecord = current as unknown as Record<string, unknown>;
    for (const [field, descriptor] of Object.entries(
      canvasNodeTopLevelFieldDescriptors,
    )) {
      if (descriptor.owner !== "ephemeral-view") continue;
      if (Object.prototype.hasOwnProperty.call(currentRecord, field)) {
        merged[field] = currentRecord[field];
      } else {
        delete merged[field];
      }
    }
    const authoritativeData = authoritative.data as Record<string, unknown>;
    const currentData = current.data as Record<string, unknown>;
    const mergedData = { ...authoritativeData };
    for (const [field, descriptor] of Object.entries(
      canvasNodeDataFieldDescriptors,
    )) {
      if (
        descriptor.owner !== "ephemeral-view" ||
        Object.prototype.hasOwnProperty.call(authoritativeData, field)
      ) continue;
      if (Object.prototype.hasOwnProperty.call(currentData, field)) {
        mergedData[field] = currentData[field];
      }
    }
    merged.data = mergedData;
    return merged as unknown as ProbeNodeType;
  });
}

export function initialCanvasViewport(fixtureId?: string): Viewport {
  if (fixtureId === "legacy.dense-canvas.neutral") {
    return { x: 102.734, y: -21.543, zoom: 0.15 };
  }
  if (fixtureId === "legacy.node-geometry.families") {
    return { x: 70, y: 90, zoom: 0.36 };
  }
  if (fixtureId === "legacy.node.group-dense-selected") {
    return { x: 40, y: 50, zoom: 0.22 };
  }
  if (fixtureId === "persistence.nodes-assets-viewport") {
    return { x: 120, y: 110, zoom: 0.72 };
  }
  if (fixtureId === "legacy.node.storyboard-table") {
    return { x: 312, y: 92, zoom: 0.54 };
  }
  if (fixtureId === "node.image.success") {
    return { x: 93, y: 5, zoom: 0.819 };
  }
  return { x: 0, y: 0, zoom: 1 };
}

const VIEWPORT_QUIET_MS = 250;
const VIEWPORT_ZOOM_NOTIFY_MS = 150;

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

function restoreOwnedCanvasRecord(
  current: Record<string, unknown>,
  historical: Record<string, unknown>,
  descriptors: Readonly<Record<string, CanvasFieldDescriptor>>,
  includeEphemeral = false,
) {
  const restored = { ...current };
  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (
      descriptor.owner !== "durable-user" &&
      !(includeEphemeral && descriptor.owner === "ephemeral-view")
    ) continue;
    if (Object.prototype.hasOwnProperty.call(historical, field)) {
      restored[field] = historical[field];
    } else {
      delete restored[field];
    }
  }
  return restored;
}

const historyAssetAdoptionFields = Object.freeze([
  "assetId",
  "audioSrc",
  "imageSrc",
  "videoSrc",
  "mediaByteSize",
  "mediaContentType",
  "mediaDurationSeconds",
  "mediaHeight",
  "mediaMetadataSource",
  "mediaMetadataStatus",
  "mediaStorageBackend",
  "mediaWidth",
] as const);

function newHistoryNode(historical: ProbeNodeType): ProbeNodeType {
  const topLevel = restoreOwnedCanvasRecord(
    {},
    historical as unknown as Record<string, unknown>,
    canvasNodeTopLevelFieldDescriptors,
    true,
  );
  const data = restoreOwnedCanvasRecord(
    {},
    historical.data as Record<string, unknown>,
    canvasNodeDataFieldDescriptors,
    true,
  );
  for (const field of historyAssetAdoptionFields) {
    if (Object.prototype.hasOwnProperty.call(historical.data, field)) {
      data[field] = historical.data[field];
    }
  }
  return { ...topLevel, data } as unknown as ProbeNodeType;
}

export function restoreCanvasHistorySnapshot(input: Readonly<{
  currentEdges: readonly CuttableEdge[];
  currentNodes: readonly ProbeNodeType[];
  historicalEdges: readonly CuttableEdge[];
  historicalNodes: readonly ProbeNodeType[];
}>) {
  const currentNodes = new Map(input.currentNodes.map((node) => [node.id, node]));
  const nodes = input.historicalNodes.map((historical) => {
    const current = currentNodes.get(historical.id);
    if (!current || current.type !== historical.type) return newHistoryNode(historical);
    const topLevel = restoreOwnedCanvasRecord(
      current as unknown as Record<string, unknown>,
      historical as unknown as Record<string, unknown>,
      canvasNodeTopLevelFieldDescriptors,
      true,
    );
    const data = restoreOwnedCanvasRecord(
      current.data as Record<string, unknown>,
      historical.data as Record<string, unknown>,
      canvasNodeDataFieldDescriptors,
      true,
    );
    return { ...topLevel, data } as unknown as ProbeNodeType;
  });

  const currentEdges = new Map(input.currentEdges.map((edge) => [edge.id, edge]));
  const edges = input.historicalEdges.map((historical) => {
    const current = currentEdges.get(historical.id);
    const topLevel = restoreOwnedCanvasRecord(
      (current ?? {}) as unknown as Record<string, unknown>,
      historical as unknown as Record<string, unknown>,
      canvasEdgeTopLevelFieldDescriptors,
      true,
    );
    const data = restoreOwnedCanvasRecord(
      (current?.data ?? {}) as Record<string, unknown>,
      (historical.data ?? {}) as Record<string, unknown>,
      canvasEdgeDataFieldDescriptors,
      true,
    );
    return {
      ...topLevel,
      ...(Object.keys(data).length > 0 ? { data } : {}),
    } as unknown as CuttableEdge;
  });
  return { edges, nodes };
}
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
      data?: { inputOrder?: number; inputRole?: string };
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
      type: TemplateNodeKind;
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
  "application/x-unboundry-library-asset";
const emptyEdges: CuttableEdge[] = [];
const PERSIST_SAVE_TIMEOUT_MS = 6_000;
const PERSIST_SAVE_JOURNAL_MAX_BYTES = 5_000_000;
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
const nodeTypes = canvasNodeRegistry.nodeTypes();

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
  if (!schema || !model.releaseRevisionId) return node;
  const parameters = normalizeParameterValues(schema, node.data.videoParameters);
  const nonImageInputs = addedMediaKinds.filter((kind) => kind !== "image");
  const semantic = normalizeModelInputs({
    connectedInputs: [
      ...Array.from({ length: imageCountAfterConnection }, (_, index) => ({
        kind: "image" as const,
        order: index + 1,
        role: "reference-image",
        semanticId: `image-${index + 1}`,
      })),
      ...nonImageInputs.map((kind, index) => ({
        kind,
        order: imageCountAfterConnection + index + 1,
        role: `reference-${kind}`,
        semanticId: `${kind}-${index + 1}`,
      })),
    ],
    modelReleaseRevision: model.releaseRevisionId,
    requestedParameters: parameters,
    schema,
    transitionIntent: "execute",
  });
  if (semantic.blockingProblems.length ||
      JSON.stringify(semantic.normalizedParameters) === JSON.stringify(parameters)) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      videoParameters: {
        ...node.data.videoParameters,
        ...semantic.normalizedParameters,
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

const CuttableEdge = memo(function CuttableEdge({
  data,
  id,
  interactionWidth,
  source,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  target,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<CuttableEdge>) {
  const { applyEdgeViewUpdate, mutateGraph } = useCanvasGraphMutation();
  const { lockedNodeIds } = useWorkflowExecution();
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
            disabled={lockedNodeIds.has(source) || lockedNodeIds.has(target)}
            onClick={(event) => {
              event.stopPropagation();
              void mutateGraph(({ edges, nodes }) => ({
                edges: edges.filter((edge) => edge.id !== id),
                nodes,
              }));
            }}
            onMouseLeave={() => {
              applyEdgeViewUpdate((current) =>
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
});

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
        audioResultChoices: success && index === 0
          ? [1, 2].map((choice) => ({
              assetId: `fixture-audio-result-${choice}.mp3`,
              byteSize: 368_000 + choice,
              contentType: "audio/mpeg",
              durationSeconds: 184,
              durationStatus: "ready" as const,
              mediaHeight: null,
              mediaWidth: null,
              role: choice === 1 ? "primary" as const : "alternate" as const,
              storageBackend: "local" as const,
              url: "/fixtures/audio-success.mp3",
            }))
          : undefined,
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
        [850, -50],
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

function withServerWorkflowGenerationActivity(node: ProbeNodeType): ProbeNodeType {
  if (node.type === "text") {
    return { ...node, data: { ...node.data, textGenerating: true } };
  }
  if (node.type === "image") {
    return { ...node, data: { ...node.data, imageGenerating: true } };
  }
  if (node.type === "video") {
    return { ...node, data: { ...node.data, videoGenerating: true } };
  }
  if (node.type === "audio") {
    return { ...node, data: { ...node.data, audioGenerating: true } };
  }
  return node;
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
  onGenerationRetryGateChange,
  onLoadStateChange,
  onOpenAssets,
  onProjectMissing,
  onReady,
  onSearchIndexChange,
  onSaveConflict,
  onSaveFailure,
  onSaveSuccess,
  onSaveStart,
  onZoomChange,
  projectId,
  shellMenuCommand,
  snapEnabled,
  textVideoStarted,
  viewportRequest,
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
  onGenerationRetryGateChange?: (
    gate: (() => Promise<number>) | undefined,
  ) => void;
  onLoadStateChange?: (state: CanvasLoadState) => void;
  onOpenAssets?: () => void;
  onProjectMissing?: () => void;
  onReady: (fitView: () => void) => void;
  onSearchIndexChange?: (entries: CanvasSearchEntry[]) => void;
  onSaveConflict: (message?: string) => void;
  onSaveFailure: (message?: string) => void;
  onSaveSuccess: () => void;
  onSaveStart: () => void;
  onZoomChange?: (zoom: number) => void;
  projectId?: string;
  shellMenuCommand?: CanvasShellMenuCommand;
  snapEnabled: boolean;
  textVideoStarted: boolean;
  viewportRequest?: { sequence: number; x?: number; y?: number; zoom: number };
}) {
  const persistenceFacade = useMemo(
    () => createBrowserCanvasPersistenceFacade(fixtureId),
    [fixtureId],
  );
  const workflowFixture = fixtureId === "workflow.text-to-video.created";
  const persistenceId = projectId ?? fixtureId ?? "default";
  const persistenceScopeId = JSON.stringify([accountId ?? "", persistenceId]);
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
  const [graphState, setGraphState] = useState<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
  }>(() => ({
    edges: workflowFixture || persistenceFixture
      ? emptyEdges
      : createProbeEdges(fixtureId),
    nodes: interactive && !workflowFixture && !persistenceFixture
      ? createProbeNodes(fixtureId)
      : emptyNodes,
  }));
  const { edges, nodes } = graphState;
  type LayoutPreviewPatch = Readonly<{
    dragging?: boolean;
    height?: number;
    position?: ProbeNodeType["position"];
    style?: ProbeNodeType["style"];
    width?: number;
  }>;
  const layoutPreviewByNodeId = useRef(new Map<string, LayoutPreviewPatch>());
  const [layoutPreviewVersion, setLayoutPreviewVersion] = useState(0);
  const [imageColorFilter, setImageColorFilter] = useState<string>();
  const [workflowRetainedNodeIds, setWorkflowRetainedNodeIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [workflowActiveNodeIds, setWorkflowActiveNodeIds] = useState<
    ReadonlySet<string>
  >(() => fixtureId === "node.video.generating"
    ? new Set(["video-primary"])
    : new Set());
  const renderedNodes = useMemo(
    () => {
      const previewNodes = layoutPreviewByNodeId.current.size === 0
        ? nodes
        : nodes.map((node) => {
            const preview = layoutPreviewByNodeId.current.get(node.id);
            if (!preview) return node;
            return {
              ...node,
              ...(preview.dragging !== undefined
                ? { dragging: preview.dragging }
                : {}),
              ...(preview.height !== undefined ? { height: preview.height } : {}),
              ...(preview.position
                ? { position: { ...preview.position } }
                : {}),
              ...(preview.style
                ? { style: { ...node.style, ...preview.style } }
                : {}),
              ...(preview.width !== undefined ? { width: preview.width } : {}),
            };
          });
      const activeNodes = workflowActiveNodeIds.size === 0
        ? previewNodes
        : previewNodes.map((node) =>
            workflowActiveNodeIds.has(node.id)
              ? withServerWorkflowGenerationActivity(node)
              : node
          );
      const workflowNodes = workflowRetainedNodeIds.size === 0
        ? activeNodes
        : activeNodes.map((node) =>
        workflowRetainedNodeIds.has(node.id)
          ? {
              ...node,
              ariaLabel: node.type === "group"
                ? `${node.data.title ?? "运行组"}，整组执行中，结构操作已锁定`
                : `${node.data.title ?? node.data.label ?? node.id}，整组执行中，Prompt、模型、参数和输入已锁定`,
              className: [
                node.className,
                node.type === "group"
                  ? "workflow-run-group"
                  : "workflow-run-locked",
              ]
                .filter(Boolean)
                .join(" "),
              connectable: false,
              deletable: false,
              draggable: node.type === "group" ? node.draggable : false,
            }
          : node,
      );
      if (!imageColorFilter) return workflowNodes;
      return workflowNodes.map((node) =>
        node.type === "image"
          ? {
              ...node,
              hidden: node.hidden ||
                !node.data.imageColorMarks?.includes(imageColorFilter),
            }
          : node
      );
    },
    [
      imageColorFilter,
      layoutPreviewVersion,
      nodes,
      workflowActiveNodeIds,
      workflowRetainedNodeIds,
    ],
  );
  // viewport 实时状态下沉到画布内部：缩放/平移不再让外壳每帧重渲染。
  const [viewport, setViewport] = useState<Viewport>(() =>
    initialCanvasViewport(fixtureId),
  );
  const [persistenceRecheckTick, setPersistenceRecheckTick] = useState(0);
  const lastViewportInteractionAt = useRef(0);
  const viewportQuietTimer = useRef<number | undefined>(undefined);
  const lastZoomNotifyAt = useRef(0);
  const pendingProgrammaticViewport = useRef<Viewport | undefined>(undefined);
  const selectedNodeCountRef = useRef(0);
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
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
  const imageUploadsInFlight = useRef(0);
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
        workflowToastDurationMs(kind),
      );
    },
    [],
  );
  useEffect(() => {
    if (workflowRetainedNodeIds.size === 0) return;
    // A run can start while an old graph menu is open. Close those menus at
    // the lock boundary so stale actions cannot mutate participating nodes.
    setBatchDrag(undefined);
    setBlankContextMenu(undefined);
    setCreateMenu(undefined);
    setNodeContextMenu(undefined);
    setSourceConnectMenu(undefined);
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest(".workflow-run-locked, .workflow-run-group")
    ) {
      activeElement.blur();
    }
  }, [workflowRetainedNodeIds]);
  const persistenceLoadIdentity = useRef({ epoch: 0, scopeId: "" });
  const [persistenceLoadState, setPersistenceLoadState] =
    useState<CanvasLoadState>(persistenceFixture ? "loading" : "ready");
  const [persistenceLoadFailure, setPersistenceLoadFailure] =
    useState<CanvasLoadFailure>();
  const [persistenceLoadAttempt, setPersistenceLoadAttempt] = useState(0);
  const persistenceReady =
    !persistenceFixture ||
    (persistenceLoadState === "ready" &&
      persistenceLoadIdentity.current.scopeId === persistenceScopeId);
  const effectivePersistenceLoadState: CanvasLoadState = persistenceReady
    ? "ready"
    : persistenceLoadState === "ready"
      ? "loading"
      : persistenceLoadState;
  const persistenceReadyRef = useRef(persistenceReady);
  persistenceReadyRef.current = persistenceReady;
  const [confirmedPersistenceRevision, setConfirmedPersistenceRevision] =
    useState<number>();
  const [confirmedGraphRevision, setConfirmedGraphRevision] =
    useState<number>();
  const persistenceRevision = useRef(0);
  const persistenceGraphRevision = useRef(0);
  const persistenceObservedRevision = useRef<number | undefined>(undefined);
  const persistenceObservedLoadToken = useRef<string | undefined>(undefined);
  const persistenceConflict = useRef(false);
  const persistenceDirty = useRef(false);
  const persistenceRetryDelay = useRef(1_000);
  const drainPersistenceQueueRef = useRef<() => void>(() => {});
  const persistenceSessionId = useRef<string>(crypto.randomUUID());
  const persistenceBroadcastInstanceId = useRef<string>(crypto.randomUUID());
  const persistenceSaveSequence = useRef(0);
  const persistenceSequenceFloor = useRef(0);
  const persistenceConfirmedSaveSequence = useRef(0);
  const persistenceServerEpoch = useRef<string | undefined>(undefined);
  const persistenceStorageRevision = useRef(0);
  const persistencePendingPagehide = useRef<CanvasPendingPagehide | undefined>(
    undefined,
  );
  const persistenceBfCacheReloadSafe = useRef(false);
  const applyCanvasSaveSession = useCallback((session: CanvasSaveSession) => {
    persistenceConfirmedSaveSequence.current = session.confirmedSequence;
    persistencePendingPagehide.current = session.pendingPagehide;
    persistenceSaveSequence.current = session.saveSequence;
    persistenceSequenceFloor.current = Math.max(
      persistenceSequenceFloor.current,
      session.saveSequence,
    );
    persistenceServerEpoch.current = session.serverEpoch;
    persistenceSessionId.current = session.saveSessionId;
    persistenceStorageRevision.current = session.storageRevision;
  }, []);
  const currentCanvasSaveSession = useCallback(() => ({
    confirmedSequence: persistenceConfirmedSaveSequence.current,
    pendingPagehide: persistencePendingPagehide.current,
    saveSequence: persistenceSaveSequence.current,
    saveSessionId: persistenceSessionId.current,
    serverEpoch: persistenceServerEpoch.current,
    storageRevision: persistenceStorageRevision.current,
  }), []);
  const assertCanvasSaveSessionCurrent = useCallback(() => {
    const stored = persistenceFacade.journal.load(persistenceScopeId);
    if (
      stored.saveSessionId !== persistenceSessionId.current ||
      stored.storageRevision !== persistenceStorageRevision.current
    ) {
      throw new CanvasSaveSessionStorageError(
        new Error("Canvas save session changed outside this page"),
      );
    }
  }, [persistenceFacade, persistenceScopeId]);
  const persistCanvasSaveSession = useCallback(
    (resolvedPendingAttemptId?: string) => {
      const stored = persistenceFacade.journal.store(
        persistenceScopeId,
        currentCanvasSaveSession(),
        resolvedPendingAttemptId,
      );
      applyCanvasSaveSession(stored);
    },
    [
      applyCanvasSaveSession,
      currentCanvasSaveSession,
      persistenceFacade,
      persistenceScopeId,
    ],
  );
  const reserveCanvasSaveAttempt = useCallback((
    attemptId: string,
    createPayload: (saveSequence: number) => string,
    requestedSequence?: number,
  ) => {
    assertCanvasSaveSessionCurrent();
    if (!isCanvasSaveEpoch(persistenceServerEpoch.current)) {
      throw new CanvasSaveSessionStorageError(
        new Error("Canvas save epoch is unavailable"),
      );
    }
    const sequenceFloor = Math.max(
      persistenceSaveSequence.current,
      persistenceSequenceFloor.current,
    );
    const saveSequence = requestedSequence ?? sequenceFloor + 1;
    if (
      !Number.isSafeInteger(saveSequence) ||
      saveSequence <= sequenceFloor
    ) {
      throw new CanvasSaveSessionStorageError(
        new Error("Canvas save sequence is not strictly increasing"),
      );
    }
    const unpreparedPayload = createPayload(saveSequence);
    const payload = persistenceFacade.transport.preparePayload?.({
      canvasId: persistenceId,
      payload: unpreparedPayload,
    }) ?? unpreparedPayload;
    if (new Blob([payload]).size > PERSIST_SAVE_JOURNAL_MAX_BYTES) {
      throw new CanvasSaveSessionStorageError(
        new Error("Canvas save journal exceeds its safe limit"),
      );
    }
    const pendingPagehide: CanvasPendingPagehide = {
      attemptId,
      payload,
      saveSequence,
      serverEpoch: persistenceServerEpoch.current,
    };
    const stored = persistenceFacade.journal.store(persistenceScopeId, {
      confirmedSequence: persistenceConfirmedSaveSequence.current,
      pendingPagehide,
      saveSequence,
      saveSessionId: persistenceSessionId.current,
      serverEpoch: persistenceServerEpoch.current,
      storageRevision: persistenceStorageRevision.current,
    });
    applyCanvasSaveSession(stored);
    if (
      stored.saveSequence !== saveSequence ||
      stored.pendingPagehide?.attemptId !== attemptId
    ) {
      throw new CanvasSaveSessionStorageError(
        new Error("Canvas save journal was not reserved"),
      );
    }
    return { payload, saveSequence };
  }, [
    applyCanvasSaveSession,
    assertCanvasSaveSessionCurrent,
    persistenceFacade,
    persistenceId,
    persistenceScopeId,
  ]);
  const raiseCanvasSaveSequenceFloor = useCallback((candidate: number) => {
    if (Number.isSafeInteger(candidate) && candidate >= 0) {
      persistenceSequenceFloor.current = Math.max(
        persistenceSequenceFloor.current,
        candidate,
      );
    }
  }, []);
  const settleCanvasSaveSequence = useCallback((
    candidate: number,
    resolvedAttemptId?: string,
  ) => {
    assertCanvasSaveSessionCurrent();
    const settled = Math.max(
      persistenceConfirmedSaveSequence.current,
      candidate,
    );
    const stored = persistenceFacade.journal.store(
      persistenceScopeId,
      {
        confirmedSequence: settled,
        pendingPagehide: persistencePendingPagehide.current,
        saveSequence: Math.max(persistenceSaveSequence.current, settled),
        saveSessionId: persistenceSessionId.current,
        serverEpoch: persistenceServerEpoch.current,
        storageRevision: persistenceStorageRevision.current,
      },
      resolvedAttemptId,
    );
    applyCanvasSaveSession(stored);
  }, [
    applyCanvasSaveSession,
    assertCanvasSaveSessionCurrent,
    persistenceFacade,
    persistenceScopeId,
  ]);
  const persistenceSentFingerprints = useRef(
    new Map<number, {
      attemptId: string;
      document: string;
      graph: string;
      liveEditors: boolean;
    }>(),
  );
  const persistenceActiveFingerprintSequences = useRef(new Set<number>());
  const persistenceConfirmedFingerprintSequence = useRef<number | undefined>(
    undefined,
  );
  const persistenceExternalRevision = useRef<number | undefined>(undefined);
  const persistedDocumentFingerprint = useRef("");
  const persistedGraphFingerprint = useRef("");
  const persistenceInFlightFingerprint = useRef<string | undefined>(undefined);
  const persistenceHydrationTimer = useRef<number | undefined>(undefined);
  const persistenceScheduledDocument = useRef<
    CanvasPersistenceSnapshot | undefined
  >(undefined);
  const persistenceSaveTimer = useRef<number | undefined>(undefined);
  const persistenceSaveController = useRef<AbortController | undefined>(
    undefined,
  );
  const persistenceSaveRun = useRef(0);
  const persistenceSaving = useRef(false);
  const persistenceQueued = useRef<CanvasPersistenceSnapshot | undefined>(
    undefined,
  );
  const persistencePendingAttempt = useRef<
    CanvasPendingSaveAttempt | undefined
  >(undefined);
  const stopForCanvasSaveSessionStorage = useCallback(() => {
    persistenceBfCacheReloadSafe.current = false;
    persistenceConflict.current = true;
    persistenceObservedRevision.current = undefined;
    persistenceObservedLoadToken.current = undefined;
    persistencePendingAttempt.current = undefined;
    setConfirmedPersistenceRevision(undefined);
    setConfirmedGraphRevision(undefined);
    onSaveConflict(
      "浏览器会话存储不可用，已停止画布保存以保护数据，请恢复后重试",
    );
  }, [onSaveConflict]);
  useEffect(() => {
    onLoadStateChange?.(effectivePersistenceLoadState);
  }, [effectivePersistenceLoadState, onLoadStateChange]);
  const uploadInput = useRef<HTMLInputElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const marqueeStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const syncSentFingerprintCount = useCallback(() => {
    worldRef.current?.setAttribute(
      "data-save-fingerprint-count",
      String(persistenceSentFingerprints.current.size),
    );
  }, []);
  const pruneSentFingerprints = useCallback(() => {
    const durablePendingSequence =
      persistencePendingPagehide.current?.saveSequence;
    const normalPendingSequence =
      persistencePendingAttempt.current?.saveSequence;
    for (const sequence of persistenceSentFingerprints.current.keys()) {
      if (
        persistenceActiveFingerprintSequences.current.has(sequence) ||
        persistenceConfirmedFingerprintSequence.current === sequence ||
        durablePendingSequence === sequence ||
        normalPendingSequence === sequence
      ) {
        continue;
      }
      persistenceSentFingerprints.current.delete(sequence);
    }
    syncSentFingerprintCount();
  }, [syncSentFingerprintCount]);
  const rememberSentFingerprint = useCallback((
    sequence: number,
    fingerprint: {
      attemptId: string;
      document: string;
      graph: string;
      liveEditors: boolean;
    },
  ) => {
    persistenceSentFingerprints.current.set(sequence, fingerprint);
    persistenceActiveFingerprintSequences.current.add(sequence);
    pruneSentFingerprints();
  }, [pruneSentFingerprints]);
  const settleSentFingerprint = useCallback((
    sequence: number,
    confirmed: boolean,
  ) => {
    persistenceActiveFingerprintSequences.current.delete(sequence);
    if (
      confirmed &&
      (
        persistenceConfirmedFingerprintSequence.current === undefined ||
        sequence >= persistenceConfirmedFingerprintSequence.current
      )
    ) {
      persistenceConfirmedFingerprintSequence.current = sequence;
    }
    pruneSentFingerprints();
  }, [pruneSentFingerprints]);
  const blankContextMenuRef = useRef<HTMLDivElement>(null);
  const nodeContextMenuRef = useRef<HTMLDivElement>(null);
  const internalClipboard = useRef<
    { edges: CuttableEdge[]; nodes: ProbeNodeType[] } | undefined
  >(undefined);
  const lastPointerWorld = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const appliedTemplateSequence = useRef<number | undefined>(undefined);
  const consumedHistoryAssetSequence = useRef<number | undefined>(undefined);
  const templateFitCancel = useRef<(() => void) | undefined>(undefined);
  const templateViewportAnimating = useRef(false);
  const lastAnimatedViewport = useRef<Viewport | undefined>(undefined);
  const templateFitDeadline = useRef(0);
  const templateFitHardStop = useRef<number | undefined>(undefined);
  const flowInstance = useRef<
    ReactFlowInstance<ProbeNodeType, CuttableEdge> | undefined
  >(undefined);
  const cutTimer = useRef<number | undefined>(undefined);
  const history = useRef<HistoryEntry[]>([]);
  const redoHistory = useRef<Extract<HistoryEntry, { kind: "snapshot" }>[]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const pendingGuardedNodes = useRef<ProbeNodeType[] | undefined>(undefined);
  const pendingGuardedEdges = useRef<CuttableEdge[] | undefined>(undefined);
  const settleCanvasMutationDurablyRef = useRef<() => Promise<void>>(
    async () => undefined,
  );
  const viewportRef = useRef(viewport);
  const pendingWheelViewport = useRef<Viewport | undefined>(undefined);
  const wheelViewportFrame = useRef<number | undefined>(undefined);
  const consumedFocusNodeSequence = useRef(0);
  const layoutGestureSequence = useRef(0);
  const layoutGestureRef = useRef<Readonly<{
    affectedNodeIds: Set<string>;
    epoch: number;
    gestureId: number;
    kind: "drag" | "resize";
    phase: "preview" | "committing";
    scopeId: string;
  }> | undefined>(undefined);
  const restoreSequence = useRef(0);
  const clipboardPasteSequence = useRef(0);
  const setNodes = useCallback<Dispatch<SetStateAction<ProbeNodeType[]>>>(
    (update) => {
      const hadPending = pendingGuardedNodes.current !== undefined;
      const base = pendingGuardedNodes.current ?? nodesRef.current;
      const next = typeof update === "function" ? update(base) : update;
      if (!hadPending && next === base) return;
      pendingGuardedNodes.current = next;
      setGraphState((current) => current.nodes === next
        ? current
        : { ...current, nodes: next });
    },
    [],
  );
  const setEdges = useCallback<Dispatch<SetStateAction<CuttableEdge[]>>>(
    (update) => {
      const hadPending = pendingGuardedEdges.current !== undefined;
      const base = pendingGuardedEdges.current ?? edgesRef.current;
      const next = typeof update === "function" ? update(base) : update;
      if (!hadPending && next === base) return;
      pendingGuardedEdges.current = next;
      setGraphState((current) => current.edges === next
        ? current
        : { ...current, edges: next });
    },
    [],
  );
  const commitCanvasGraphAtomic = useCallback((snapshot: {
    edges: readonly CuttableEdge[];
    nodes: readonly ProbeNodeType[];
  }) => {
    const next = {
      edges: [...snapshot.edges],
      nodes: [...snapshot.nodes],
    };
    pendingGuardedEdges.current = next.edges;
    pendingGuardedNodes.current = next.nodes;
    setGraphState(next);
  }, []);
  const applyPassiveNodeChanges = useCallback(
    (changes: NodeChange<ProbeNodeType>[]) => {
      setNodes((current) => {
        const changed = applyNodeChanges(changes, current);
        return canvasViewUpdateAllowed(current, changed) ? changed : current;
      });
    },
    [setNodes],
  );
  const applyPassiveEdgeChanges = useCallback(
    (changes: EdgeChange<CuttableEdge>[]) => {
      setEdges((current) => {
        const changed = applyEdgeChanges(changes, current);
        return canvasEdgeViewUpdateAllowed(current, changed) ? changed : current;
      });
    },
    [setEdges],
  );
  useLayoutEffect(() => {
    nodesRef.current = nodes;
    if (pendingGuardedNodes.current === nodes) {
      pendingGuardedNodes.current = undefined;
    }
  }, [nodes]);
  useLayoutEffect(() => {
    edgesRef.current = edges;
    if (pendingGuardedEdges.current === edges) {
      pendingGuardedEdges.current = undefined;
    }
  }, [edges]);

  const updateViewportDom = (next: Viewport) => {
    const world = worldRef.current;
    if (world) {
      const titleZoom = Math.max(next.zoom, 0.01);
      const counterScale = titleZoom < 1 ? 1 / titleZoom : 1;
      const titleWidth = `${Math.min(titleZoom, 1) * 100}%`;
      world.setAttribute("data-viewport-x", String(next.x));
      world.setAttribute("data-viewport-y", String(next.y));
      world.setAttribute("data-viewport-zoom", String(next.zoom));
      world.setAttribute(
        "data-title-zoom-band",
        titleZoom < 0.35
          ? "overview"
          : titleZoom < 0.65
            ? "compact"
            : "detail",
      );
      world.style.setProperty(
        "--canvas-title-counter-scale",
        String(counterScale),
      );
      world.style.setProperty("--canvas-title-available-width", titleWidth);
      world.style.setProperty(
        "--canvas-storyboard-title-gap",
        `${10 / titleZoom}px`,
      );
    }
  };

  // 初始补一次 data-viewport-* 属性（后续由 updateViewportDom 直接维护，不再驱动 React 重渲染）。
  useEffect(() => {
    updateViewportDom(viewportRef.current);
  }, []);

  const markCanvasInteraction = useCallback(() => {
    lastViewportInteractionAt.current = performance.now();
    window.clearTimeout(viewportQuietTimer.current);
    viewportQuietTimer.current = window.setTimeout(() => {
      lastViewportInteractionAt.current = 0;
      // 镜头动画期间不触发保存重查；动画最后一帧先关闸门再提交，只保存一次。
      if (!templateViewportAnimating.current) {
        setPersistenceRecheckTick((tick) => tick + 1);
      }
      onZoomChangeRef.current?.(viewportRef.current.zoom);
    }, VIEWPORT_QUIET_MS);
  }, []);

  const applyViewport = useCallback((next: Viewport) => {
    // Open the viewport-interaction gate before React Flow receives the
    // command. setViewport can synchronously reconcile mounted group nodes;
    // those passive reconciliations must never become persisted graph moves.
    markCanvasInteraction();
    viewportRef.current = next;
    updateViewportDom(next);
    if (selectedNodeCountRef.current > 1) setViewport(next);
    if (flowInstance.current) {
      flowInstance.current.setViewport(next);
      pendingProgrammaticViewport.current = undefined;
    } else {
      pendingProgrammaticViewport.current = next;
    }
  }, [markCanvasInteraction]);

  const handleMiniMapClick = useCallback(
    (
      _event: ReactMouseEvent,
      position: { x: number; y: number },
    ) => {
      const bounds = worldRef.current?.getBoundingClientRect();
      if (!bounds || !flowInstance.current) {
        return;
      }
      const zoom = viewportRef.current.zoom;
      applyViewport({
        ...viewportRef.current,
        x: bounds.width / 2 - position.x * zoom,
        y: bounds.height / 2 - position.y * zoom,
      });
    },
    [applyViewport],
  );

  const keepLastNonCollidingPositions = (
    changes: NodeChange<ProbeNodeType>[],
  ) => {
    if (!snapEnabled || layoutGestureRef.current?.kind !== "drag") return changes;

    const positionChanges = changes.filter(
      (change): change is NodePositionChange =>
        change.type === "position" && Boolean(change.position),
    );
    if (!positionChanges.length) return changes;

    const currentById = new Map(
      nodesRef.current.map((node) => {
        const preview = layoutPreviewByNodeId.current.get(node.id);
        return [node.id, preview
          ? {
              ...node,
              ...(preview.position
                ? { position: { ...preview.position } }
                : {}),
              ...(preview.style
                ? { style: { ...node.style, ...preview.style } }
                : {}),
            }
          : node] as const;
      }),
    );
    const movingIds = new Set(positionChanges.map((change) => change.id));
    const blocked = positionChanges.some((change) => {
      const moving = currentById.get(change.id);
      if (!moving || !change.position || !collisionNode(moving)) return false;

      return [...currentById.values()].some((stationary) => {
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
    if (!persistenceReady) return;
    // 其他命令（例如 apply-template）只清理浮层，绝不切换“添加节点”菜单。
    const clearTransientMenus = () => {
      setUploadError("");
      setBlankContextMenu(undefined);
      setNodeContextMenu(undefined);
      setSourceConnectMenu(undefined);
    };
    if (shellMenuCommand.action !== "toggle-add") {
      clearTransientMenus();
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
              x: (x - viewportRef.current.x) / viewportRef.current.zoom,
              y: (y - viewportRef.current.y) / viewportRef.current.zoom,
            },
            screen: { x, y },
          },
    );
    clearTransientMenus();
  }, [persistenceReady, shellMenuCommand]);

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
    onGraphContentChange(persistenceReady && nodes.length > 0);
  }, [nodes.length, onGraphContentChange, persistenceReady]);

  useEffect(() => {
    if (!persistenceReady) {
      onSearchIndexChange?.([]);
      return;
    }
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
      !persistenceReady ||
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
    applyViewUpdate((current) =>
      current.map((candidate) => ({
        ...candidate,
        selected: candidate.id === node.id,
      })),
    );
    setPrimaryId(node.id);
    applyViewport({
      x: bounds.width / 2 - (position.x + size.width / 2) * zoom,
      y: bounds.height / 2 - (position.y + size.height / 2) * zoom,
      zoom,
    });
  }, [applyViewport, focusNodeRequest, persistenceReady]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    redoHistory.current = [];
    const previous = history.current.at(-1);
    if (entry.kind === "snapshot" && previous?.kind === "snapshot") {
      const historyViewport = { x: 0, y: 0, zoom: 1 } as const;
      if (
        canvasUserDocumentFingerprint({
          edges: entry.edges,
          nodes: entry.nodes,
          viewport: historyViewport,
        }) === canvasUserDocumentFingerprint({
          edges: previous.edges,
          nodes: previous.nodes,
          viewport: historyViewport,
        })
      ) return false;
    }
    history.current.push(entry);
    if (history.current.length > 50) {
      history.current.shift();
    }
    return true;
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
    currentNodes = pendingGuardedNodes.current ?? nodesRef.current,
    currentEdges = pendingGuardedEdges.current ?? edgesRef.current,
    currentViewport = viewportRef.current,
  ) => {
    const document = {
      edges: cloneEdges(currentEdges),
      nodes: cloneNodes(currentNodes),
      viewport: { ...currentViewport },
    };
    return {
      ...document,
      fingerprint: canvasUserDocumentFingerprint(document),
      graphFingerprint: canvasGraphFingerprint(document),
    };
  }, [cloneEdges, cloneNodes]);
  const canvasSnapshotWithLiveEditors = useCallback(() => {
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
    const currentNodes = (pendingGuardedNodes.current ?? nodesRef.current).map((node) => {
      const layoutPreview = layoutPreviewByNodeId.current.get(node.id);
      const title = titleValues.get(node.id);
      const textContent = textContentValues.get(node.id);
      const storedText = node.data.content ?? "";
      const bodyChanged = textContent !== undefined && !(
        textContent.content === storedText &&
        (textContent.contentHtml === undefined ||
          // Compare with the same safe DOM serialization used by TextNode.
          // Entity normalization is display-only; retain authoritative bytes
          // unless the user actually changed the text or its formatting.
          textContent.contentHtml ===
            storedRichTextValue(storedText, node.data.contentHtml).html)
      );
      if (
        (title === undefined || title === node.data.title) &&
        !bodyChanged &&
        !layoutPreview
      ) {
        return node;
      }
      return {
        ...node,
        ...(layoutPreview?.position
          ? { position: { ...layoutPreview.position } }
          : {}),
        ...(layoutPreview?.style
          ? { style: { ...node.style, ...layoutPreview.style } }
          : {}),
        data: {
          ...node.data,
          ...(bodyChanged
            ? {
                content: textContent.content,
                contentHtml: textContent.contentHtml,
              }
            : {}),
          title: title ?? node.data.title,
        },
      };
    });
    return canvasSnapshot(
      currentNodes,
      pendingGuardedEdges.current ?? edgesRef.current,
      viewportRef.current,
    );
  }, [canvasSnapshot]);
  const confirmedLiveEditorSaveCoversCurrentSnapshot = useCallback(() => {
    const confirmedSequence = persistenceConfirmedFingerprintSequence.current;
    const confirmed = confirmedSequence === undefined
      ? undefined
      : persistenceSentFingerprints.current.get(confirmedSequence);
    if (
      !confirmed?.liveEditors ||
      confirmed.document !== persistedDocumentFingerprint.current ||
      confirmed.graph !== persistedGraphFingerprint.current
    ) return false;
    const latest = canvasSnapshotWithLiveEditors();
    return latest.fingerprint === confirmed.document &&
      latest.graphFingerprint === confirmed.graph;
  }, [canvasSnapshotWithLiveEditors]);
  const canvasSnapshotRef = useRef(canvasSnapshot);
  canvasSnapshotRef.current = canvasSnapshot;
  const templateFitBlocksPersistence = useCallback(() =>
    templateViewportAnimating.current &&
      performance.now() < templateFitDeadline.current, []);
  const cancelTemplateFit = useCallback(() => {
    templateViewportAnimating.current = false;
    templateFitDeadline.current = 0;
    if (templateFitHardStop.current !== undefined) {
      window.clearTimeout(templateFitHardStop.current);
      templateFitHardStop.current = undefined;
    }
    templateFitCancel.current?.();
    templateFitCancel.current = undefined;
    lastAnimatedViewport.current = undefined;
  }, []);
  const handleViewportChange = useCallback(
    (next: Viewport) => {
      if (templateViewportAnimating.current) {
        const last = lastAnimatedViewport.current;
        if (
          last &&
          Math.abs(next.x - last.x) < 1e-6 &&
          Math.abs(next.y - last.y) < 1e-6 &&
          Math.abs(next.zoom - last.zoom) < 1e-9
        ) {
          // React Flow 对我们动画帧的回显，直接忽略。
          return;
        }
        cancelTemplateFit();
      }
      viewportRef.current = next;
      updateViewportDom(next);
      if (selectedNodeCountRef.current > 1) setViewport(next);
      const now = performance.now();
      lastViewportInteractionAt.current = now;
      window.clearTimeout(viewportQuietTimer.current);
      viewportQuietTimer.current = window.setTimeout(() => {
        lastViewportInteractionAt.current = 0;
        // 镜头动画期间不触发保存重查；动画最后一帧先关闸门再提交，只保存一次。
        if (!templateViewportAnimating.current) {
          setPersistenceRecheckTick((tick) => tick + 1);
        }
        onZoomChangeRef.current?.(viewportRef.current.zoom);
      }, VIEWPORT_QUIET_MS);
      if (
        onZoomChangeRef.current &&
        now - lastZoomNotifyAt.current >= VIEWPORT_ZOOM_NOTIFY_MS
      ) {
        lastZoomNotifyAt.current = now;
        onZoomChangeRef.current(next.zoom);
      }
    },
    [cancelTemplateFit],
  );

  // 缩放滑块等程序化缩放：命令式设置到 ReactFlow（非受控），并同步内部状态。
  useEffect(() => {
    if (!persistenceReadyRef.current || !viewportRequest) return;
    applyViewport({
      ...viewportRef.current,
      ...(viewportRequest.x !== undefined
        ? { x: viewportRequest.x }
        : {}),
      ...(viewportRequest.y !== undefined
        ? { y: viewportRequest.y }
        : {}),
      zoom: viewportRequest.zoom,
    });
  }, [applyViewport, viewportRequest]);

  useEffect(
    () => () => {
      window.clearTimeout(viewportQuietTimer.current);
    },
    [],
  );
  const checkpoint = useCallback((includeHistory = true) => {
    if (!includeHistory) return () => undefined;
    const entry: HistoryEntry = {
      edges: cloneEdges(pendingGuardedEdges.current ?? edgesRef.current),
      kind: "snapshot",
      nodes: cloneNodes(pendingGuardedNodes.current ?? nodesRef.current),
    };
    if (!pushHistory(entry)) return () => undefined;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = history.current.indexOf(entry);
      if (index >= 0) history.current.splice(index, 1);
    };
  }, [cloneEdges, cloneNodes, pushHistory]);

  useEffect(() => {
    if (shellMenuCommand?.action !== "apply-template") return;
    if (shellMenuCommand.sequence === appliedTemplateSequence.current) return;
    if (!persistenceReady) return;
    const graph = shellMenuCommand.graph;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return;
    }
    appliedTemplateSequence.current = shellMenuCommand.sequence;
    const idMap = new Map<string, string>();
    const sourceNodeById = new Map(
      graph.nodes.map((node) => [node.id, node]),
    );
    const incomingTextTargets = new Set(
      graph.edges
        .filter((edge) => sourceNodeById.get(edge.source)?.type === "text")
        .map((edge) => edge.target),
    );
    const appliedNodes: ProbeNodeType[] = graph.nodes.map((source) => {
      const id = `${source.type}-${crypto.randomUUID()}`;
      idMap.set(source.id, id);
      let data: ProbeNodeType["data"] = {
        ...source.data,
        label: source.data.label ?? "Node",
        title: typeof source.data.title === "string"
          ? source.data.title
          : source.data.label ?? "Node",
      };
      if (
        ["audio", "image", "text", "video"].includes(source.type) &&
        isExecutableWorkflowNode(source, {
          hasIncomingText: incomingTextTargets.has(source.id),
        })
      ) {
        const savedModelId = source.type === "audio"
          ? data.audioModelId?.trim()
          : source.type === "image"
            ? data.imageModelId?.trim()
            : source.type === "text"
              ? data.textModelId?.trim()
              : source.type === "video"
                ? data.videoModelId?.trim()
                : "";
        if (!savedModelId) {
          data = source.type === "audio"
            ? {
                ...data,
                audioModelId: TEMPLATE_MODEL_SELECTION_REQUIRED_ID,
                audioModelName: "请选择兼容模型",
              }
            : source.type === "image"
              ? {
                  ...data,
                  imageModelId: TEMPLATE_MODEL_SELECTION_REQUIRED_ID,
                  imageModelName: "请选择兼容模型",
                }
              : source.type === "text"
                ? {
                    ...data,
                    textModelId: TEMPLATE_MODEL_SELECTION_REQUIRED_ID,
                    textModelName: "请选择兼容模型",
                  }
                : {
                    ...data,
                    videoModel: "请选择兼容模型",
                    videoModelId: TEMPLATE_MODEL_SELECTION_REQUIRED_ID,
                  };
        }
      }
      return {
        id,
        type: source.type,
        position: source.position,
        data,
        style: source.style ??
          (source.type === "group"
            ? { height: 500, width: 800 }
            : NODE_DEFAULT_SIZES[source.type]),
        zIndex: source.zIndex,
        selected: false,
      };
    }).map((node, index) => {
      const source = graph.nodes[index];
      return {
        ...node,
        parentId:
          source.parentId && source.parentId !== source.id
            ? idMap.get(source.parentId)
            : undefined,
      };
    });
    const groupNode = appliedNodes.find((node) => node.type === "group");
    const appliedEdges: CuttableEdge[] = graph.edges.map((edge) => ({
      ...(edge.data ? { data: { ...edge.data } } : {}),
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
    const existingNodes = nodesRef.current;
    const existingById = new Map(
      existingNodes.map((node) => [node.id, node]),
    );
    const obstacles = existingNodes.map((node) =>
      nodePlacementRect(node, existingById, nodeSize),
    );
    const selectedBounds = existingNodes.filter((node) => node.selected)
      .reduce<{
        bottom: number;
        left: number;
        right: number;
        top: number;
      } | undefined>((bounds, node) => {
        const rect = nodePlacementRect(node, existingById, nodeSize);
        return bounds
          ? {
              bottom: Math.max(bounds.bottom, rect.bottom),
              left: Math.min(bounds.left, rect.left),
              right: Math.max(bounds.right, rect.right),
              top: Math.min(bounds.top, rect.top),
            }
          : rect;
      }, undefined);
    const worldBounds = worldRef.current?.getBoundingClientRect();
    const viewport = viewportRef.current;
    const viewportCenter = worldBounds
      ? {
          x: (worldBounds.width / 2 - viewport.x) / viewport.zoom,
          y: (worldBounds.height / 2 - viewport.y) / viewport.zoom,
        }
      : { x: 0, y: 0 };
    const placementBounds = templateBounds(appliedNodes, nodeSize);
    const templateSize = {
      height: placementBounds.height,
      width: placementBounds.width,
    };
    const spot = existingNodes.length === 0
      ? emptyCanvasTemplateSpot({ templateSize, viewportCenter })
      : findTemplateSpot({
          anchor: templateAnchor({
            selectedBounds,
            templateSize,
            viewportCenter,
          }),
          obstacles,
          templateSize,
        });
    const positionedNodes = offsetTemplate(appliedNodes, {
      x: spot.x - placementBounds.left,
      y: spot.y - placementBounds.top,
    });
    const placedBounds = templateBounds(positionedNodes, nodeSize);
    const targetViewport = worldBounds
      ? viewportForBounds(
          {
            height: placedBounds.height,
            width: placedBounds.width,
            x: placedBounds.left,
            y: placedBounds.top,
          },
          worldBounds.width,
          worldBounds.height,
          0.15,
          2,
          0.2,
        )
      : undefined;
    const preparedNodes = positionedNodes.map((node) =>
      node.type === "image" && imageTargetsWithImageInput.has(node.id)
        ? withImageReferenceInputMode(node, imageModelsRef.current)
        : node,
    );
    // 模板只保存 assetId，不保存短时/结果地址；落画布时立即重建
    // durable src（与文档 hydration 同一规则），否则要等刷新才显示素材。
    const hydratedNodes = normalizePersistedMediaNodes(preparedNodes);
    void mutateGraph(({ edges, nodes }) => ({
      edges: [...edges, ...appliedEdges],
      nodes: [
        ...nodes.map((node) => ({ ...node, selected: false })),
        ...hydratedNodes,
      ],
    }));
    if (groupNode) setPrimaryId(groupNode.id);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (!targetViewport) return;
        cancelTemplateFit();
        const from = { ...viewportRef.current };
        const startedAt = performance.now();
        let frame = 0;
        templateViewportAnimating.current = true;
        templateFitDeadline.current = startedAt + 1_600;
        templateFitHardStop.current = window.setTimeout(() => {
          templateViewportAnimating.current = false;
          templateFitHardStop.current = undefined;
          // rAF 被节流/暂停时保存调度 effect 可能不再触发；
          // 直接在硬性期限后补一次保存，避免“保存中”卡死。
          const latest = canvasSnapshot();
          if (
            latest.fingerprint !== persistedDocumentFingerprint.current ||
            latest.graphFingerprint !== persistedGraphFingerprint.current
          ) {
            persistenceQueued.current = latest;
            persistenceDirty.current = true;
            void drainPersistenceQueueRef.current();
          }
        }, 1_600);
        const step = (now: number) => {
          const progress = Math.min(
            1,
            Math.max(0, (now - startedAt) / 800),
          );
          const eased =
            progress < 0.5
              ? 4 * progress * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          const next = {
            x: from.x + (targetViewport.x - from.x) * eased,
            y: from.y + (targetViewport.y - from.y) * eased,
            zoom: from.zoom + (targetViewport.zoom - from.zoom) * eased,
          };
          lastAnimatedViewport.current = next;
          if (progress >= 1) {
            // 最后一帧先关“动画闸门”，再提交最终镜头，确保只触发一次保存。
            templateViewportAnimating.current = false;
            templateFitCancel.current = undefined;
            templateFitDeadline.current = 0;
            if (templateFitHardStop.current !== undefined) {
              window.clearTimeout(templateFitHardStop.current);
              templateFitHardStop.current = undefined;
            }
          }
          applyViewport(next);
          if (progress < 1) {
            frame = window.requestAnimationFrame(step);
          }
        };
        frame = window.requestAnimationFrame(step);
        templateFitCancel.current = () => {
          window.cancelAnimationFrame(frame);
          templateViewportAnimating.current = false;
          templateFitDeadline.current = 0;
          if (templateFitHardStop.current !== undefined) {
            window.clearTimeout(templateFitHardStop.current);
            templateFitHardStop.current = undefined;
          }
        };
      }, 100);
    });
    return () => cancelTemplateFit();
  }, [
    cancelTemplateFit,
    checkpoint,
    applyViewport,
    setEdges,
    setNodes,
    persistenceReady,
    shellMenuCommand,
  ]);
  const handleCanvasWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey || event.deltaY === 0 || !worldRef.current) return;
      if (templateViewportAnimating.current) cancelTemplateFit();
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
        if (pending) applyViewport(pending);
      });
    },
    [applyViewport],
  );

  useEffect(() => () => {
    if (wheelViewportFrame.current !== undefined) {
      window.cancelAnimationFrame(wheelViewportFrame.current);
    }
  }, []);
  const copyNodeInternally = (nodeId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    if (node.parentId) {
      // 复制组内单个子节点：粘贴为独立节点，并把相对坐标换算成世界坐标。
      const parent = nodesRef.current.find(
        (candidate) => candidate.id === node.parentId,
      );
      const position = parent
        ? {
            x: parent.position.x + node.position.x,
            y: parent.position.y + node.position.y,
          }
        : { ...node.position };
      internalClipboard.current = {
        edges: [],
        nodes: [{ ...cloneNodes([node])[0], parentId: undefined, position }],
      };
    } else {
      internalClipboard.current = collectNodeSubgraph(nodeId);
    }
    clipboardPasteSequence.current = 0;
    return true;
  };

  const collectNodeSubgraph = (nodeId: string) => {
    const ids = new Set<string>([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodesRef.current) {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id);
          changed = true;
        }
      }
    }
    const nodes = nodesRef.current
      .filter((node) => ids.has(node.id))
      .map((node) => cloneNodes([node])[0]);
    const edges = edgesRef.current
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        ...cloneEdges([stripSelectionFlowMarkers(edge)])[0],
        selected: false,
      }));
    return { edges, nodes };
  };

  const duplicateGraph = (
    source: { edges: CuttableEdge[]; nodes: ProbeNodeType[] },
    pastePoint?: { x: number; y: number },
    offsetStep = 1,
  ) => {
    if (source.nodes.length === 0) return undefined;
    const idMap = new Map<string, string>();
    const nodes = source.nodes.map((node) => {
      const id = `${node.id}-copy-${crypto.randomUUID()}`;
      idMap.set(node.id, id);
      return {
        ...scrubDuplicatedGenerationState(cloneNodes([node])[0]),
        id,
        selected: false,
      };
    });
    for (const node of nodes) {
      if (node.parentId && idMap.has(node.parentId)) {
        node.parentId = idMap.get(node.parentId);
      } else if (node.parentId) {
        node.parentId = undefined;
      }
    }
    const edges = source.edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        ...cloneEdges([stripSelectionFlowMarkers(edge)])[0],
        id: `${edge.id}-copy-${crypto.randomUUID()}`,
        selected: false,
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
      }));
    const roots = nodes.filter((node) => !node.parentId);
    const anchor = roots.length
      ? {
          x: Math.min(...roots.map((node) => node.position.x)),
          y: Math.min(...roots.map((node) => node.position.y)),
        }
      : { x: nodes[0].position.x, y: nodes[0].position.y };
    const delta = pastePoint
      ? { x: pastePoint.x - anchor.x, y: pastePoint.y - anchor.y }
      : { x: 40 * offsetStep, y: 40 * offsetStep };
    for (const node of roots) {
      node.position = {
        x: node.position.x + delta.x,
        y: node.position.y + delta.y,
      };
    }
    return { edges, nodes, rootIds: new Set(roots.map((node) => node.id)) };
  };

  const applyDuplicatedGraph = (
    duplicated: NonNullable<ReturnType<typeof duplicateGraph>>,
  ) => {
    void mutateGraph(({ edges, nodes }) => ({
      edges: [...edges, ...duplicated.edges],
      nodes: [
        ...nodes.map((node) => ({ ...node, selected: false })),
        ...duplicated.nodes.map((node) => ({
          ...node,
          selected: duplicated.rootIds.has(node.id),
        })),
      ],
    }));
    const firstRoot = duplicated.nodes.find((node) =>
      duplicated.rootIds.has(node.id),
    );
    if (firstRoot) setPrimaryId(firstRoot.id);
  };

  const pasteInternalNode = (pastePoint?: { x: number; y: number }) => {
    const copied = internalClipboard.current;
    if (!copied || copied.nodes.length === 0) return false;
    clipboardPasteSequence.current += 1;
    const point = pastePoint ?? lastPointerWorld.current;
    const duplicated = duplicateGraph(copied, point, clipboardPasteSequence.current);
    if (!duplicated) return false;
    applyDuplicatedGraph(duplicated);
    return true;
  };

  const duplicateContextNode = (nodeId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    const source = node.parentId
      ? (() => {
          const parent = nodesRef.current.find(
            (candidate) => candidate.id === node.parentId,
          );
          const position = parent
            ? {
                x: parent.position.x + node.position.x,
                y: parent.position.y + node.position.y,
              }
            : { ...node.position };
          return {
            edges: [],
            nodes: [
              { ...cloneNodes([node])[0], parentId: undefined, position },
            ],
          };
        })()
      : collectNodeSubgraph(nodeId);
    const duplicated = duplicateGraph(source, undefined, 1);
    if (!duplicated) return false;
    applyDuplicatedGraph(duplicated);
    return true;
  };

  const trackPointerWorld = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = viewportRef.current;
    lastPointerWorld.current = {
      x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
    };
  };
  const expandedDeletedNodeIds = (
    currentNodes: readonly ProbeNodeType[],
    rootIds: readonly string[],
  ) => {
    const deletedIds = new Set(rootIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const node of currentNodes) {
        if (node.parentId && deletedIds.has(node.parentId) &&
          !deletedIds.has(node.id)) {
          deletedIds.add(node.id);
          expanded = true;
        }
      }
    }
    return deletedIds;
  };
  const deleteNodesWithAdmission = (rootIds: readonly string[]) => {
    const previewNodes = pendingGuardedNodes.current ?? nodesRef.current;
    const previewEdges = pendingGuardedEdges.current ?? edgesRef.current;
    const deletedIds = expandedDeletedNodeIds(previewNodes, rootIds);
    if (deletedIds.size === 0 || !previewNodes.some((node) =>
      deletedIds.has(node.id)
    )) return;
    const plannedNodeIds = new Set(deletedIds);
    for (const edge of previewEdges) {
      if (deletedIds.has(edge.source) || deletedIds.has(edge.target)) {
        plannedNodeIds.add(edge.source);
        plannedNodeIds.add(edge.target);
      }
    }
    if ([...plannedNodeIds].some((id) => workflowRetainedNodeIds.has(id))) {
      showWorkflowToast("整组执行中，不能删除参与节点", "error");
      return;
    }
    void runCanvasMutationAdmission([...plannedNodeIds], () => {
      const currentNodes = pendingGuardedNodes.current ?? nodesRef.current;
      const currentEdges = pendingGuardedEdges.current ?? edgesRef.current;
      const currentDeletedIds = expandedDeletedNodeIds(currentNodes, rootIds);
      if (!currentNodes.some((node) => currentDeletedIds.has(node.id))) return;
      const deletedNodes = currentNodes.filter((node) =>
        currentDeletedIds.has(node.id)
      );
      const deletedEdges = currentEdges.filter((edge) =>
        currentDeletedIds.has(edge.source) || currentDeletedIds.has(edge.target)
      );
      const actualNodeIds = new Set(currentDeletedIds);
      for (const edge of deletedEdges) {
        actualNodeIds.add(edge.source);
        actualNodeIds.add(edge.target);
      }
      if ([...actualNodeIds].some((id) => !plannedNodeIds.has(id))) {
        throw new Error("画布已在等待期间变化，本次删除未应用");
      }
      pushHistory({
        edges: cloneEdges(deletedEdges),
        kind: "delete",
        nodes: cloneNodes(deletedNodes),
      });
      commitCanvasGraphAtomic({
        nodes: currentNodes.filter((node) => !currentDeletedIds.has(node.id)),
        edges: currentEdges.filter((edge) =>
          !currentDeletedIds.has(edge.source) &&
          !currentDeletedIds.has(edge.target)
        ),
      });
      setPrimaryId(undefined);
    });
  };
  const deleteNodeFromContextMenu = (nodeId: string) => {
    deleteNodesWithAdmission([nodeId]);
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
    if (
      !persistenceReadyRef.current || !createMenu
    ) {
      return;
    }
    const labels = {
      audio: "Audio",
      image: "Image",
      playlist: "Playlist",
      text: "Text",
      video: "Video",
    } as const;
    const nodeId = `${type}-${crypto.randomUUID()}`;
    void mutateGraph(({ edges, nodes }) => ({
      edges,
      nodes: [
        ...nodes.map((node) => ({ ...node, selected: false })),
        {
        id: nodeId,
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
      ],
    }));
    setCreateMenu(undefined);
  };
  const addDroppedLibraryAsset = async (
    asset: CanvasLibraryAsset,
    screen: { x: number; y: number },
  ) => {
    if (!persistenceReadyRef.current) {
      return;
    }
    const bounds = worldRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const position = {
      x:
        (screen.x - bounds.left - viewportRef.current.x) /
        viewportRef.current.zoom,
      y:
        (screen.y - bounds.top - viewportRef.current.y) /
        viewportRef.current.zoom,
    };
    const nodeId = `${asset.kind}-${crypto.randomUUID()}`;
    const loadIdentity = persistenceLoadIdentity.current;
    let metadata: Awaited<ReturnType<typeof fetchTrustedMediaMetadata>>;
    try {
      metadata = await fetchTrustedMediaMetadata(asset.kind, asset.id);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "服务端无法确认素材信息";
      setUploadError(message);
      showWorkflowToast(message, "error");
      return;
    }
    if (
      persistenceLoadIdentity.current !== loadIdentity ||
      !persistenceReadyRef.current || metadata.assetId !== asset.id ||
      metadata.kind !== asset.kind
    ) return;
    void mutateGraph(({ edges, nodes }) => ({
      edges,
      nodes: [
        ...nodes.map((node) => ({ ...node, selected: false })),
        {
        id: nodeId,
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
          ...trustedMediaPatch(metadata),
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
      ],
    }));
  };
  useEffect(() => {
    if (
      !historyAssetRequest ||
      !persistenceReady ||
      historyAssetRequest.sequence === consumedHistoryAssetSequence.current
    ) {
      return;
    }
    const bounds = worldRef.current?.getBoundingClientRect();
    if (!bounds) return;
    consumedHistoryAssetSequence.current = historyAssetRequest.sequence;
    const size = NODE_DEFAULT_SIZES[historyAssetRequest.asset.kind];
    void addDroppedLibraryAsset(historyAssetRequest.asset, {
      x:
        bounds.left +
        bounds.width / 2 -
        (Number(size.width) * viewportRef.current.zoom) / 2,
      y:
        bounds.top +
        bounds.height / 2 -
        (Number(size.height) * viewportRef.current.zoom) / 2,
    });
  }, [historyAssetRequest?.sequence, persistenceReady]);
  const uploadImage = async (
    file?: File,
    droppedAt?: { x: number; y: number },
  ) => {
    const bounds = droppedAt
      ? worldRef.current?.getBoundingClientRect()
      : undefined;
    const targetPosition = droppedAt && bounds
      ? {
          x:
            (droppedAt.x - bounds.left - viewportRef.current.x) /
            viewportRef.current.zoom,
          y:
            (droppedAt.y - bounds.top - viewportRef.current.y) /
            viewportRef.current.zoom,
        }
      : createMenu?.flow;
    if (
      !persistenceReadyRef.current || persistenceConflict.current || !file ||
      !targetPosition
    ) {
      return;
    }
    setUploadError("");
    imageUploadsInFlight.current += 1;
    setUploading(true);
    const loadIdentity = { ...persistenceLoadIdentity.current };
    let createdAssetId: string | undefined;
    let adopted = false;
    try {
      const asset = await uploadImageAsset(file);
      createdAssetId = asset.assetId;
      if (
        !persistenceReadyRef.current ||
        persistenceConflict.current ||
        persistenceLoadIdentity.current.epoch !== loadIdentity.epoch ||
        persistenceLoadIdentity.current.scopeId !== loadIdentity.scopeId
      ) {
        await discardImageAsset(asset.assetId);
        createdAssetId = undefined;
        return;
      }
      const nodeId = `image-${crypto.randomUUID()}`;
      adopted = await mutateGraph(({ edges, nodes }) => ({
        edges,
        nodes: [
          ...nodes.map((node) => ({ ...node, selected: false })),
          {
          id: nodeId,
          type: "image",
          position: targetPosition,
          selected: true,
          data: {
            ...trustedMediaPatch({
              assetId: asset.assetId,
              byteSize: asset.byteSize,
              contentType: asset.contentType,
              durationSeconds: null,
              durationStatus: "not-applicable",
              kind: "image",
              mediaHeight: asset.mediaHeight ?? asset.height,
              mediaWidth: asset.mediaWidth ?? asset.width,
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
        ],
      }));
      if (!adopted) {
        await discardImageAsset(asset.assetId);
        createdAssetId = undefined;
        return;
      }
      setCreateMenu(undefined);
    } catch (error) {
      if (!adopted && createdAssetId) {
        await discardImageAsset(createdAssetId);
      }
      setUploadError(
        error instanceof Error ? error.message : "图片上传失败",
      );
    } finally {
      imageUploadsInFlight.current = Math.max(
        0,
        imageUploadsInFlight.current - 1,
      );
      setUploading(imageUploadsInFlight.current > 0);
    }
  };
  const isConnectionAllowed = (
    connection: Connection | Edge,
    currentEdges: Edge[],
    currentNodes: ProbeNodeType[],
  ) => {
    const sourceType = currentNodes.find((node) => node.id === connection.source)?.type;
    const targetType = currentNodes.find((node) => node.id === connection.target)?.type;
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
    isConnectionAllowed(
      connection,
      pendingGuardedEdges.current ?? edgesRef.current,
      pendingGuardedNodes.current ?? nodesRef.current,
    );
  const normalizeGraphForNewInputs = (
    beforeNodes: ProbeNodeType[],
    beforeEdges: CuttableEdge[],
    afterEdges: CuttableEdge[],
    targetId: string,
    addedSourceIds: readonly string[],
  ) => {
    const target = beforeNodes.find((node) => node.id === targetId);
    if (!target) return { edges: afterEdges, nodes: beforeNodes };
    let nextNodes = beforeNodes;
    if (target.type === "image") {
      const alreadyHasReadyImageInput = beforeEdges.some((edge) => {
        if (edge.target !== targetId) return false;
        const source = beforeNodes.find((node) => node.id === edge.source);
        return source?.type === "image" && Boolean(source.data.assetId) &&
          Boolean(source.data.imageSrc) &&
          (effectiveMediaInputState(source.data) === undefined ||
            effectiveMediaInputState(source.data) === "ready");
      });
      const addsReadyImage = addedSourceIds.some((sourceId) => {
        const source = beforeNodes.find((node) => node.id === sourceId);
        return source?.type === "image" && Boolean(source.data.assetId) &&
          Boolean(source.data.imageSrc) &&
          (effectiveMediaInputState(source.data) === undefined ||
            effectiveMediaInputState(source.data) === "ready");
      });
      if (!alreadyHasReadyImageInput && addsReadyImage) {
        nextNodes = beforeNodes.map((node) => node.id === targetId
          ? withImageReferenceInputMode(node, imageModels)
          : node);
      }
    }
    if (target.type !== "video") return { edges: afterEdges, nodes: nextNodes };
    const model = resolvePublishedModel(videoModels, target.data.videoModelId);
    if (!model?.parameterSchema || !model.configurationRevision ||
      !model.releaseRevisionId) {
      return { edges: afterEdges, nodes: nextNodes };
    }
    const plan = buildCanvasModelTransitionCommand({
      request: {
        intent: "execute",
        model: {
          configurationRevision: model.configurationRevision,
          displayName: model.displayName,
          id: model.id,
          parameterSchema: model.parameterSchema,
          releaseRevisionId: model.releaseRevisionId,
        },
        nodeId: targetId,
        requestedParameters: normalizeParameterValues(
          model.parameterSchema,
          target.data.videoParameters,
        ),
      },
      snapshot: { edges: afterEdges, nodes: nextNodes },
    });
    return plan.status === "ready" && plan.after
      ? { edges: [...plan.after.edges], nodes: [...plan.after.nodes] }
      : { edges: afterEdges, nodes: nextNodes };
  };
  const addConnection = (connection: Connection) => {
    if (!persistenceReadyRef.current) return false;
    if (
      workflowRetainedNodeIds.has(connection.source) ||
      workflowRetainedNodeIds.has(connection.target)
    ) {
      showWorkflowToast("整组执行中，不能修改参与节点的连线", "error");
      return false;
    }
    const beforeNodes = pendingGuardedNodes.current ?? nodesRef.current;
    const beforeEdges = pendingGuardedEdges.current ?? edgesRef.current;
    if (!isConnectionAllowed(connection, beforeEdges, beforeNodes)) return false;
    void runCanvasMutationAdmission(
      [connection.source, connection.target],
      () => {
        const currentNodes = pendingGuardedNodes.current ?? nodesRef.current;
        const currentEdges = pendingGuardedEdges.current ?? edgesRef.current;
        if (!isConnectionAllowed(connection, currentEdges, currentNodes)) {
          throw new Error("画布已在等待期间变化，连线未添加");
        }
        const sourceType = currentNodes.find((node) =>
          node.id === connection.source
        )?.type;
        const targetType = currentNodes.find((node) =>
          node.id === connection.target
        )?.type;
        const afterEdges = addEdge(
          {
            ...connection,
            id: `edge-${connection.source}-${connection.target}-${currentEdges.length}`,
            interactionWidth: 20,
            type: "cuttable",
            data: isNodeInputKind(sourceType) && isNodeInputKind(targetType)
              ? {
                  inputOrder: nextNodeInputOrder(currentEdges, connection.target),
                  inputRole: defaultNodeInputRole(sourceType, targetType),
                }
              : undefined,
          },
          currentEdges,
        );
        const after = normalizeGraphForNewInputs(
          currentNodes,
          currentEdges,
          afterEdges,
          connection.target,
          [connection.source],
        );
        checkpoint();
        commitCanvasGraphAtomic(after);
      },
    );
    return true;
  };
  const addBatchConnections = (sourceIds: string[], targetId: string) => {
    if (!persistenceReadyRef.current) return;
    if (
      workflowRetainedNodeIds.has(targetId) ||
      sourceIds.some((sourceId) => workflowRetainedNodeIds.has(sourceId))
    ) {
      showWorkflowToast("整组执行中，不能修改参与节点的连线", "error");
      return;
    }
    const beforeNodes = pendingGuardedNodes.current ?? nodesRef.current;
    const beforeEdges = pendingGuardedEdges.current ?? edgesRef.current;
    const plannedEdges = [...beforeEdges];
    const addedSourceIds: string[] = [];
    for (const sourceId of sourceIds) {
      const connection: Connection = {
        source: sourceId,
        sourceHandle: "source",
        target: targetId,
        targetHandle: "target",
      };
      if (!isConnectionAllowed(connection, plannedEdges, beforeNodes)) continue;
      addedSourceIds.push(sourceId);
      plannedEdges.push({
        ...connection,
        id: `planned-edge-${sourceId}-${targetId}-${plannedEdges.length}`,
        type: "cuttable",
      });
    }
    if (!addedSourceIds.length) return;
    void runCanvasMutationAdmission([...sourceIds, targetId], () => {
      const currentNodes = pendingGuardedNodes.current ?? nodesRef.current;
      const currentEdges = pendingGuardedEdges.current ?? edgesRef.current;
      const currentAddedSourceIds: string[] = [];
      const afterEdges = sourceIds.reduce<CuttableEdge[]>((next, sourceId) => {
        const connection: Connection = {
          source: sourceId,
          sourceHandle: "source",
          target: targetId,
          targetHandle: "target",
        };

        if (isConnectionAllowed(connection, next, currentNodes)) {
          currentAddedSourceIds.push(sourceId);
          return addEdge(
              {
                ...connection,
                id: `edge-${sourceId}-${targetId}-${next.length}`,
                interactionWidth: 20,
                type: "cuttable",
                data: (() => {
                  const sourceType = currentNodes.find((node) => node.id === sourceId)?.type;
                  const targetType = currentNodes.find((node) => node.id === targetId)?.type;
                  return isNodeInputKind(sourceType) && isNodeInputKind(targetType)
                    ? {
                          inputOrder: nextNodeInputOrder(next, targetId),
                        inputRole: defaultNodeInputRole(sourceType, targetType),
                      }
                    : undefined;
                })(),
              },
              next,
            );
        }
        return next;
      }, currentEdges);
      if (currentAddedSourceIds.length === 0) return;
      const after = normalizeGraphForNewInputs(
        currentNodes,
        currentEdges,
        afterEdges,
        targetId,
        currentAddedSourceIds,
      );
      checkpoint();
      commitCanvasGraphAtomic(after);
    });
  };
  const clearCutIndicators = () =>
    applyEdgeViewUpdate((current) =>
      current.map((edge) =>
        edge.data?.cutIndicator
          ? { ...edge, data: { ...edge.data, cutIndicator: undefined } }
          : edge,
      ),
    );

  useEffect(() => {
    if (textVideoStarted && persistenceReady) {
      void mutateGraph(() => ({
        edges: createProbeEdges("workflow.text-to-video.created"),
        nodes: createProbeNodes("workflow.text-to-video.created"),
      }));
    }
  }, [persistenceReady, textVideoStarted]);

  useEffect(() => {
    const epoch = persistenceLoadIdentity.current.epoch + 1;
    persistenceLoadIdentity.current = { epoch, scopeId: persistenceScopeId };
    layoutGestureRef.current = undefined;
    if (layoutPreviewByNodeId.current.size > 0) {
      layoutPreviewByNodeId.current.clear();
      setLayoutPreviewVersion((version) => version + 1);
    }
    persistencePendingAttempt.current = undefined;
    if (persistenceFixture) {
      try {
        const saveSession = persistenceFacade.journal.load(persistenceScopeId);
        persistenceSessionId.current = saveSession.saveSessionId;
        persistenceSaveSequence.current = saveSession.saveSequence;
        persistenceSequenceFloor.current = saveSession.saveSequence;
        persistenceConfirmedSaveSequence.current =
          saveSession.confirmedSequence;
        persistenceServerEpoch.current = saveSession.serverEpoch;
        persistenceStorageRevision.current = saveSession.storageRevision;
        persistencePendingPagehide.current = saveSession.pendingPagehide;
        persistCanvasSaveSession();
      } catch (error) {
        if (!(error instanceof CanvasSaveSessionStorageError)) throw error;
        persistenceReadyRef.current = false;
        persistenceConflict.current = true;
        persistenceObservedRevision.current = undefined;
        persistenceObservedLoadToken.current = undefined;
        setConfirmedPersistenceRevision(undefined);
        setConfirmedGraphRevision(undefined);
        setPersistenceLoadFailure(persistenceFacade.classifyLoadFailure(error));
        setPersistenceLoadState("failed");
        onSaveConflict(
          "浏览器会话存储不可用，已停止画布保存以保护数据，请恢复后重试",
        );
        return;
      }
    } else {
      persistenceSessionId.current = crypto.randomUUID();
      persistenceSaveSequence.current = 0;
      persistenceSequenceFloor.current = 0;
      persistenceConfirmedSaveSequence.current = 0;
      persistenceServerEpoch.current = undefined;
      persistenceStorageRevision.current = 0;
      persistencePendingPagehide.current = undefined;
    }
    persistenceSaveRun.current += 1;
    persistenceSaveController.current?.abort("canvas-scope-changed");
    persistenceSaveController.current = undefined;
    persistenceSaving.current = false;
    persistenceInFlightFingerprint.current = undefined;
    persistenceObservedRevision.current = undefined;
    persistenceObservedLoadToken.current = undefined;
    const isCurrentLoad = () =>
      persistenceLoadIdentity.current.scopeId === persistenceScopeId &&
      persistenceLoadIdentity.current.epoch === epoch;

    if (!persistenceFixture) {
      persistenceReadyRef.current = true;
      setPersistenceLoadState("ready");
      return;
    }

    persistenceReadyRef.current = false;
    setPersistenceLoadFailure(undefined);
    setPersistenceLoadState("loading");
    setConfirmedPersistenceRevision(undefined);
    setConfirmedGraphRevision(undefined);
    persistenceConflict.current = false;
    persistenceDirty.current = false;
    persistenceQueued.current = undefined;
    pendingGuardedNodes.current = undefined;
    pendingGuardedEdges.current = undefined;
    persistenceRetryDelay.current = 1_000;
    persistenceSentFingerprints.current.clear();
    persistenceActiveFingerprintSequences.current.clear();
    persistenceConfirmedFingerprintSequence.current = undefined;
    syncSentFingerprintCount();
    persistenceExternalRevision.current = undefined;
    window.clearTimeout(persistenceHydrationTimer.current);
    window.clearTimeout(persistenceSaveTimer.current);
    persistenceSaveTimer.current = undefined;
    persistenceScheduledDocument.current = undefined;
    cancelTemplateFit();

    const controller = new AbortController();
    let disposed = false;
    const markLoadFailed = (error: unknown) => {
      if (disposed || !isCurrentLoad()) return;
      persistenceLoadIdentity.current = {
        epoch: epoch + 1,
        scopeId: persistenceScopeId,
      };
      persistenceReadyRef.current = false;
      persistenceObservedRevision.current = undefined;
      persistenceObservedLoadToken.current = undefined;
      setConfirmedPersistenceRevision(undefined);
      setConfirmedGraphRevision(undefined);
      setPersistenceLoadFailure(persistenceFacade.classifyLoadFailure(error));
      setPersistenceLoadState("failed");
    };
    const load = async () => {
      try {
        const result = await hydrateCanvasPersistence({
          canvasId: persistenceId,
          controller,
          facade: persistenceFacade,
          loadTimeoutMs: CANVAS_READ_TIMEOUT_MS,
          runtime: {
            clearPendingPagehide() {
              persistencePendingPagehide.current = undefined;
            },
            confirmedSaveSequence: () =>
              persistenceConfirmedSaveSequence.current,
            createInitialDocument: projectId
              ? undefined
              : () => ({
                  edges: createProbeEdges(persistenceId),
                  nodes: createProbeNodes(persistenceId),
                  viewport,
                }),
            externalRevision: () => persistenceExternalRevision.current,
            isCurrent: () => !disposed && isCurrentLoad(),
            normalizeDocument: (document) => ({
              ...document,
              nodes: normalizeCanvasParentLinks(
                normalizePersistedMediaNodes(document.nodes),
              ),
              edges: document.edges.map((edge) =>
                stripSelectionFlowMarkers(
                  edge.style && typeof edge.style === "object"
                    ? { ...edge, style: undefined }
                    : edge,
                ),
              ),
            }),
            normalizeNodes: (nodes) => normalizeCanvasParentLinks(
              normalizePersistedMediaNodes(nodes),
            ),
            pendingPagehide: () => persistencePendingPagehide.current,
            persistSaveSession: persistCanvasSaveSession,
            randomUUID: () => crypto.randomUUID(),
            rememberSentFingerprint,
            reserveSaveAttempt: reserveCanvasSaveAttempt,
            saveSequence: () => persistenceSaveSequence.current,
            saveSessionId: () => persistenceSessionId.current,
            setConfirmedSaveSequence(saveSequence) {
              persistenceConfirmedSaveSequence.current = saveSequence;
            },
            setServerFence(fence) {
              persistenceServerEpoch.current = fence.saveEpoch;
              persistenceSequenceFloor.current = Math.max(
                persistenceSequenceFloor.current,
                fence.sessionHighWaterSequence,
              );
            },
            settleSentFingerprint,
          },
          saveTimeoutMs: PERSIST_SAVE_TIMEOUT_MS,
        });
        if (result.kind === "cancelled") return;
        if (result.kind === "missing") {
          persistenceReadyRef.current = false;
          setPersistenceLoadState("missing");
          onProjectMissing?.();
          return;
        }
        const document = result.document;
        persistenceRevision.current = document.revision;
        persistenceGraphRevision.current = result.graphRevision;
        persistenceObservedRevision.current = document.revision;
        persistenceObservedLoadToken.current = document.loadToken;
        if (
          persistenceExternalRevision.current !== undefined &&
          persistenceExternalRevision.current <= document.revision
        ) {
          persistenceExternalRevision.current = undefined;
        }
        setConfirmedPersistenceRevision(document.revision);
        setConfirmedGraphRevision(result.graphRevision);
        persistenceConflict.current = false;
        persistenceDirty.current = false;
        persistedDocumentFingerprint.current = result.fingerprint;
        persistedGraphFingerprint.current = result.graphFingerprint;
        setNodes((current) => mergeAuthoritativeNodesWithViewState(
          current,
          document.nodes,
        ).map((node) => {
          if (
            node.measured?.width !== undefined &&
              node.measured.height !== undefined ||
            node.width !== undefined && node.height !== undefined ||
            node.initialWidth !== undefined && node.initialHeight !== undefined
          ) return node;
          const width = node.style?.width;
          const height = node.style?.height;
          return typeof width === "number" && typeof height === "number"
            ? { ...node, initialHeight: height, initialWidth: width }
            : node;
        }));
        setEdges(document.edges);
        applyViewport(document.viewport);
        window.clearTimeout(persistenceHydrationTimer.current);
        persistenceHydrationTimer.current = window.setTimeout(
          () => {
            if (!isCurrentLoad() || disposed) return;
            persistenceReadyRef.current = true;
            setPersistenceLoadState("ready");
          },
          150,
        );
      } catch (error) {
        markLoadFailed(error);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      persistenceSaveRun.current += 1;
      persistenceSaveController.current?.abort("canvas-scope-disposed");
      persistenceSaveController.current = undefined;
      persistenceSaving.current = false;
      window.clearTimeout(persistenceHydrationTimer.current);
      if (isCurrentLoad()) {
        persistenceLoadIdentity.current = {
          epoch: epoch + 1,
          scopeId: persistenceScopeId,
        };
      }
    };
  }, [
    applyViewport,
    cancelTemplateFit,
    onSaveConflict,
    onProjectMissing,
    persistenceFacade,
    persistenceLoadAttempt,
    persistenceFixture,
    persistenceId,
    persistenceScopeId,
    persistCanvasSaveSession,
    rememberSentFingerprint,
    reserveCanvasSaveAttempt,
    settleSentFingerprint,
    syncSentFingerprintCount,
    projectId,
    setEdges,
    setNodes,
  ]);

  useCanvasPersistenceSaveCoordinator({
    accountId,
    canvasSnapshot,
    canvasSnapshotWithLiveEditors,
    drainPersistenceQueueRef,
    edges,
    lastViewportInteractionAt,
    nodes,
    onProjectMissing,
    onSaveConflict,
    onSaveFailure,
    onSaveStart,
    onSaveSuccess,
    persistCanvasSaveSession,
    persistedDocumentFingerprint,
    persistedGraphFingerprint,
    persistenceBroadcastInstanceId,
    persistenceConfirmedSaveSequence,
    persistenceConflict,
    persistenceDirty,
    persistenceExternalRevision,
    persistenceFacade,
    persistenceFixture,
    persistenceGraphRevision,
    persistenceId,
    persistenceInFlightFingerprint,
    persistenceLoadIdentity,
    persistenceObservedLoadToken,
    persistenceObservedRevision,
    persistencePendingAttempt,
    persistencePendingPagehide,
    persistenceQueued,
    persistenceReady,
    persistenceReadyRef,
    persistenceRecheckTick,
    persistenceRetryDelay,
    persistenceRevision,
    persistenceSaveController,
    persistenceSaveRun,
    persistenceScheduledDocument,
    persistenceSaveTimer,
    persistenceSaving,
    persistenceScopeId,
    persistenceSentFingerprints,
    persistenceServerEpoch,
    persistenceSessionId,
    raiseCanvasSaveSequenceFloor,
    rememberSentFingerprint,
    reserveCanvasSaveAttempt,
    setConfirmedGraphRevision,
    setConfirmedPersistenceRevision,
    setPersistenceLoadState,
    settleCanvasSaveSequence,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
    templateFitBlocksPersistence,
    templateFitHardStop,
    templateViewportAnimating,
    viewport,
    normalizeDocument: (document) => ({
      ...document,
      nodes: normalizeCanvasParentLinks(
        normalizePersistedMediaNodes(document.nodes),
      ),
      edges: document.edges.map((edge) =>
        stripSelectionFlowMarkers(
          edge.style && typeof edge.style === "object"
            ? { ...edge, style: undefined }
            : edge,
        ),
      ),
    }),
  });

  useCanvasPersistenceLifecycleCoordinator({
    accountId,
    applyCanvasSaveSession,
    canvasSnapshotRef,
    canvasSnapshotWithLiveEditors,
    drainPersistenceQueueRef,
    onSaveSuccess,
    pendingGuardedEdges,
    pendingGuardedNodes,
    persistedDocumentFingerprint,
    persistedGraphFingerprint,
    persistenceBfCacheReloadSafe,
    persistenceBroadcastInstanceId,
    persistenceConfirmedSaveSequence,
    persistenceConflict,
    persistenceDirty,
    persistenceExternalRevision,
    persistenceFacade,
    persistenceFixture,
    persistenceGraphRevision,
    persistenceId,
    persistenceLoadIdentity,
    persistenceObservedLoadToken,
    persistenceObservedRevision,
    persistencePendingAttempt,
    persistencePendingPagehide,
    persistenceQueued,
    persistenceReady,
    persistenceReadyRef,
    persistenceRetryDelay,
    persistenceRevision,
    persistenceScheduledDocument,
    persistenceSaveTimer,
    persistenceSaving,
    persistenceScopeId,
    persistenceSessionId,
    persistenceStorageRevision,
    pruneSentFingerprints,
    rememberSentFingerprint,
    reserveCanvasSaveAttempt,
    setConfirmedGraphRevision,
    setConfirmedPersistenceRevision,
    setPersistenceLoadState,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
    normalizeNodes: (nodes) => normalizeCanvasParentLinks(
      normalizePersistedMediaNodes(nodes),
    ),
  });

  useEffect(() => {
    const cancelBatchConnection = (event: KeyboardEvent) => {
      if (!persistenceReadyRef.current) return;
      if (event.key === "Escape") {
        setBatchDrag(undefined);
        applyViewUpdate((current) =>
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
      if (
        !target &&
        commandKey &&
        workflowRetainedNodeIds.size > 0 && key === "z"
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!target && commandKey && !event.shiftKey && key === "a") {
        const selectableIds = new Set(
          nodesRef.current
            .filter(
              (node) =>
                !node.parentId && !workflowRetainedNodeIds.has(node.id),
            )
            .map((node) => node.id),
        );
        if (selectableIds.size) {
          event.preventDefault();
          event.stopPropagation();
          window.getSelection()?.removeAllRanges();
          applyViewUpdate((current) =>
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
        const undoSnapshot = {
          edges: cloneEdges(edgesRef.current),
          kind: "snapshot",
          nodes: cloneNodes(nodesRef.current),
        } as const;
        history.current.push(undoSnapshot);
        void mutateGraph(({ edges, nodes }) => restoreCanvasHistorySnapshot({
          currentEdges: edges,
          currentNodes: nodes,
          historicalEdges: cloneEdges(redo.edges).map(stripSelectionFlowMarkers),
          historicalNodes: cloneNodes(redo.nodes),
        }), { checkpoint: false }).then((applied) => {
          if (applied) return;
          if (history.current.at(-1) === undoSnapshot) history.current.pop();
          redoHistory.current.push(redo);
        });
        return;
      }

      const entry = history.current.pop();
      if (!entry) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const redoSnapshot = {
        edges: cloneEdges(edgesRef.current),
        kind: "snapshot",
        nodes: cloneNodes(nodesRef.current),
      } as const;
      redoHistory.current.push(redoSnapshot);
      if (entry.kind === "snapshot") {
        void mutateGraph(({ edges, nodes }) => restoreCanvasHistorySnapshot({
          currentEdges: edges,
          currentNodes: nodes,
          historicalEdges: cloneEdges(entry.edges).map(stripSelectionFlowMarkers),
          historicalNodes: cloneNodes(entry.nodes),
        }), { checkpoint: false }).then((applied) => {
          if (applied) return;
          if (redoHistory.current.at(-1) === redoSnapshot) redoHistory.current.pop();
          history.current.push(entry);
        });
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
      const restoredNodes = deletedNodes.map((node) => newHistoryNode({
          ...node,
          id: restoredIds.get(node.id)!,
          parentId: node.parentId
            ? (restoredIds.get(node.parentId) ?? node.parentId)
            : undefined,
        } as ProbeNodeType));
      const restoredEdges = entry.edges.map((edge, index) => ({
          ...stripSelectionFlowMarkers(edge),
          id: `${edge.id}-restored-${sequence}-${index}`,
          selected: false,
          source: restoredIds.get(edge.source) ?? edge.source,
          target: restoredIds.get(edge.target) ?? edge.target,
        }));
      void mutateGraph(({ edges, nodes }) => ({
        edges: [...edges, ...restoredEdges],
        nodes: [...nodes, ...restoredNodes],
      }), { checkpoint: false }).then((applied) => {
        if (applied) return;
        if (redoHistory.current.at(-1) === redoSnapshot) redoHistory.current.pop();
        history.current.push(entry);
      });
    };

    window.addEventListener("keydown", cancelBatchConnection, true);
    return () => {
      window.clearTimeout(cutTimer.current);
      window.removeEventListener("keydown", cancelBatchConnection, true);
    };
  }, [persistenceReady, primaryId, workflowRetainedNodeIds]);

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
  const colorHiddenNodeIds = imageColorFilter
    ? new Set(
      nodes
        .filter((node) =>
          node.type === "image" &&
          !node.data.imageColorMarks?.includes(imageColorFilter)
        )
        .map((node) => node.id),
    )
    : new Set<string>();
  const colorFilteredEdges = colorHiddenNodeIds.size > 0
    ? edges.filter((edge) =>
      !colorHiddenNodeIds.has(edge.source) &&
      !colorHiddenNodeIds.has(edge.target)
    )
    : edges;
  const visibleEdges = selectedNodeIds.size
    ? colorFilteredEdges.map((edge) =>
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
    : colorFilteredEdges;
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
  selectedNodeCountRef.current = selectedNodeCount;

  // 进入多选时把 viewport 状态同步到实时值（非多选期间状态不随缩放/平移更新，
  // 多选工具栏需要按实时视口定位）。
  useEffect(() => {
    if (selectedNodeCount <= 1) return;
    const live = viewportRef.current;
    setViewport((current) =>
      current.x === live.x && current.y === live.y && current.zoom === live.zoom
        ? current
        : live,
    );
  }, [selectedNodeCount]);
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
    if (
      !canGroupSelection ||
      groupCandidates.some((node) => workflowRetainedNodeIds.has(node.id))
    ) return;
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
    void mutateGraph(({ edges, nodes }) => ({
      edges,
      nodes: [
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
        ...nodes.map((node) =>
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
      ],
    }));
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
              viewportRef.current.zoom +
            viewportRef.current.x,
          y:
            (sourceMenuNode.position.y +
              (sourceMenuNode.measured?.height ??
                (typeof sourceMenuNode.style?.height === "number"
                  ? sourceMenuNode.style.height
                  : 0)) /
                2) *
              viewportRef.current.zoom +
            viewportRef.current.y,
        }
      : undefined;
  const generationCanvasRevision =
    persistenceFixture &&
    persistenceReady &&
    !persistenceConflict.current &&
    isCanvasLoadToken(persistenceObservedLoadToken.current) &&
    confirmedPersistenceRevision !== undefined &&
    confirmedPersistenceRevision === persistenceRevision.current &&
    confirmedGraphRevision !== undefined &&
    confirmedGraphRevision === persistenceGraphRevision.current &&
    canvasGraphFingerprint({
      edges: pendingGuardedEdges.current ?? edges,
      nodes: pendingGuardedNodes.current ?? nodes,
    }) ===
      persistedGraphFingerprint.current
      ? confirmedGraphRevision
      : undefined;
  const retryGenerationEnabled =
    persistenceReady &&
    !persistenceConflict.current &&
    (!persistenceFixture ||
      (persistenceObservedRevision.current !== undefined &&
        isCanvasLoadToken(persistenceObservedLoadToken.current)));
  const generationCanvasRevisionRef = useRef<number | undefined>(undefined);
  generationCanvasRevisionRef.current = generationCanvasRevision;
  const flushCanvasSave = useCallback(async (signal?: AbortSignal) => {
    const assertSafePersistence = () => {
      throwIfCanvasWaitAborted(signal);
      if (
        persistenceFixture &&
        (!persistenceReadyRef.current ||
          persistenceObservedRevision.current === undefined ||
          !isCanvasLoadToken(persistenceObservedLoadToken.current))
      ) {
        throw new Error("画布尚未安全加载，请先重试加载");
      }
      if (persistenceConflict.current) {
        throw new Error("画布保存状态异常，请刷新后重试");
      }
    };
    assertSafePersistence();
    const latest = canvasSnapshotRef.current();
    if (
      !confirmedLiveEditorSaveCoversCurrentSnapshot() &&
      (latest.fingerprint !== persistedDocumentFingerprint.current ||
        latest.graphFingerprint !== persistedGraphFingerprint.current)
    ) {
      persistenceQueued.current = latest;
      persistenceDirty.current = true;
    }
    if (persistenceDirty.current && !persistenceSaving.current) {
      drainPersistenceQueueRef.current();
    }
    const deadline = Date.now() + 15_000;
    while (persistenceDirty.current || persistenceSaving.current) {
      assertSafePersistence();
      if (Date.now() > deadline) {
        throw new Error("画布保存超时，请稍后重试");
      }
      await waitForCanvasState(60, signal);
    }
    assertSafePersistence();
  }, [confirmedLiveEditorSaveCoversCurrentSnapshot, persistenceFixture]);
  const waitForCanvasRevision = useCallback(async (
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ) => {
    const assertSafePersistence = () => {
      throwIfCanvasWaitAborted(signal);
      if (
        persistenceFixture &&
        (!persistenceReadyRef.current ||
          persistenceObservedRevision.current === undefined ||
          !isCanvasLoadToken(persistenceObservedLoadToken.current))
      ) {
        throw new Error("画布尚未安全加载，请先重试加载");
      }
      if (persistenceConflict.current) {
        throw new Error("画布保存状态异常，请刷新后重试");
      }
    };
    assertSafePersistence();
    const latest = canvasSnapshotRef.current();
    if (
      !confirmedLiveEditorSaveCoversCurrentSnapshot() &&
      (latest.fingerprint !== persistedDocumentFingerprint.current ||
        latest.graphFingerprint !== persistedGraphFingerprint.current)
    ) {
      persistenceQueued.current = latest;
      persistenceDirty.current = true;
    }
    if (persistenceDirty.current && !persistenceSaving.current) {
      drainPersistenceQueueRef.current();
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertSafePersistence();
      if (!persistenceDirty.current && !persistenceSaving.current) {
        const revision = generationCanvasRevisionRef.current;
        if (revision !== undefined) {
          // Let the latest render commit the confirmed revision before the
          // caller reads a fresh node closure. A timeout fallback keeps the
          // wait working even when requestAnimationFrame is throttled.
          await waitForPaint();
          assertSafePersistence();
          const candidate = {
            dirty: persistenceDirty.current,
            revision: generationCanvasRevisionRef.current,
            saving: persistenceSaving.current,
          };
          if (shouldAcceptCanvasRevision(candidate)) {
            return candidate.revision;
          }
        }
      }
      await waitForCanvasState(60, signal);
    }
    throw new Error("画布保存超时，请稍后再试");
  }, [confirmedLiveEditorSaveCoversCurrentSnapshot, persistenceFixture]);
  const readAuthoritativeCanvasRevision = useCallback(async () => {
    if (!persistenceFixture) {
      const revision = generationCanvasRevisionRef.current;
      if (!Number.isSafeInteger(revision)) {
        throw new Error("画布版本尚未确认");
      }
      return Number(revision);
    }
    const controller = new AbortController();
    {
      const response = await loadCanvasPersistenceWithDeadline({
        canvasId: persistenceId,
        controller,
        saveSessionId: persistenceSessionId.current,
        timeoutReason: "canvas-authority-timeout",
        transport: persistenceFacade.transport,
      });
      if (!response.ok || !persistenceFacade.isLoadedDocument(response.body)) {
        throw new Error("无法确认画布最新版本");
      }
      return response.body.graphRevision ?? response.body.revision;
    }
  }, [persistenceFacade, persistenceFixture, persistenceId]);
  const workflowResultRead = useRef(false);
  const receiveWorkflowResults = useCallback(async (run: WorkflowRunSummary, signal?: AbortSignal) => {
    const scopeId = persistenceScopeId;
    const available = () => persistenceLoadIdentity.current.scopeId === scopeId &&
      persistenceReadyRef.current && !persistenceConflict.current &&
      !persistenceSaving.current && !persistencePendingAttempt.current &&
      !persistencePendingPagehide.current && !signal?.aborted &&
      (persistenceExternalRevision.current === undefined ||
        persistenceExternalRevision.current <= (persistenceObservedRevision.current ?? -1));
    if (run.canvasId !== persistenceId || !available() || workflowResultRead.current) return false;
    workflowResultRead.current = true;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await loadCanvasPersistenceWithDeadline({
        adopt: false, canvasId: persistenceId, controller,
        saveSessionId: persistenceSessionId.current,
        timeoutReason: "workflow-results-timeout", transport: persistenceFacade.transport,
      });
      if (!available() || !response.ok || !persistenceFacade.isLoadedDocument(response.body) ||
          response.body.revision < persistenceRevision.current ||
          response.body.saveEpoch !== persistenceServerEpoch.current) return false;
      const document = response.body;
      const live = canvasSnapshotWithLiveEditors();
      const adoption = persistenceFacade.transport.prepareWorkflowResultAdoption?.({
        canvasId: persistenceId, current: live.nodes, document, run,
      });
      if (!adoption) return false;
      // A newer edit/run may have removed the old task proof. It must not be
      // restored, and terminal obsolete targets do not need endless reads.
      if (!adoption.received.length) return !["running", "stopping"].includes(run.state);
      // Do not materialize an IME editor into React state mid-composition.
      if (globalThis.document.querySelector('.react-flow__node [data-composition-active="true"]')) return false;
      assertCanvasSaveSessionCurrent();
      const previousFloor = persistenceSequenceFloor.current;
      try {
        persistenceSequenceFloor.current = Math.max(previousFloor, document.sessionHighWaterSequence);
        persistCanvasSaveSession();
      } catch (error) {
        persistenceSequenceFloor.current = previousFloor;
        throw error;
      }
      if (!adoption.commit()) return false;
      for (const entry of [...history.current, ...redoHistory.current]) {
        if (entry.kind === "snapshot") entry.nodes = adoption.mergeHistory(entry.nodes) as ProbeNodeType[];
      }
      const nextNodes = adoption.nodes as ProbeNodeType[];
      persistenceRevision.current = document.revision;
      persistenceGraphRevision.current = document.graphRevision ?? document.revision;
      persistenceObservedRevision.current = document.revision;
      persistenceObservedLoadToken.current = document.loadToken;
      persistedDocumentFingerprint.current = canvasUserDocumentFingerprint(adoption.baseline);
      persistedGraphFingerprint.current = canvasGraphFingerprint(adoption.baseline);
      if (persistenceExternalRevision.current !== undefined &&
          persistenceExternalRevision.current <= document.revision) persistenceExternalRevision.current = undefined;
      const nextSnapshot = canvasSnapshot(nextNodes);
      if (persistenceQueued.current) persistenceQueued.current = nextSnapshot;
      if (persistenceScheduledDocument.current) persistenceScheduledDocument.current = nextSnapshot;
      pendingGuardedNodes.current = nextNodes;
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setConfirmedPersistenceRevision(document.revision);
      setConfirmedGraphRevision(document.graphRevision ?? document.revision);
      if (adoption.conflicts.length) showWorkflowToast("生成结果已保留在历史中；正在编辑的文字保持不变", "error");
      return true;
    } finally {
      workflowResultRead.current = false;
      signal?.removeEventListener("abort", abort);
    }
  }, [assertCanvasSaveSessionCurrent, canvasSnapshot, canvasSnapshotWithLiveEditors,
    persistenceFacade, persistenceId, persistenceScopeId, persistCanvasSaveSession,
    setNodes, showWorkflowToast]);

  const refreshAuthoritativeCanvasDocument = useCallback(async (
    signal?: AbortSignal,
  ) => {
    if (!persistenceFixture) return false;
    layoutGestureRef.current = undefined;
    if (layoutPreviewByNodeId.current.size > 0) {
      layoutPreviewByNodeId.current.clear();
      setLayoutPreviewVersion((version) => version + 1);
    }
    const scopeId = persistenceScopeId;
    await flushCanvasSave(signal);
    if (signal?.aborted) return false;
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason ?? "workflow-refresh-aborted");
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener("abort", relayAbort, { once: true });
    try {
      const response = await loadCanvasPersistenceWithDeadline({
        canvasId: persistenceId,
        controller,
        saveSessionId: persistenceSessionId.current,
        timeoutReason: "workflow-refresh-timeout",
        transport: persistenceFacade.transport,
      });
      if (controller.signal.aborted || signal?.aborted) return false;
      if (!response.ok || !persistenceFacade.isLoadedDocument(response.body)) {
        throw new Error("无法刷新服务端已写回的画布结果");
      }
      if (
        persistenceLoadIdentity.current.scopeId !== scopeId ||
        persistenceConflict.current || persistenceDirty.current ||
        persistenceSaving.current ||
        response.body.revision < persistenceRevision.current
      ) return false;
      const document = {
        ...response.body,
        nodes: normalizeCanvasParentLinks(
          normalizePersistedMediaNodes(response.body.nodes),
        ),
        edges: response.body.edges.map((edge) =>
          stripSelectionFlowMarkers(
            edge.style && typeof edge.style === "object"
              ? { ...edge, style: undefined }
              : edge,
          )
        ),
      };
      const graphRevision = document.graphRevision ?? document.revision;
      const previousServerEpoch = persistenceServerEpoch.current;
      const previousSequenceFloor = persistenceSequenceFloor.current;
      try {
        persistenceServerEpoch.current = document.saveEpoch;
        persistenceSequenceFloor.current = Math.max(
          persistenceSequenceFloor.current,
          document.sessionHighWaterSequence,
        );
        persistCanvasSaveSession();
      } catch (error) {
        persistenceServerEpoch.current = previousServerEpoch;
        persistenceSequenceFloor.current = previousSequenceFloor;
        throw error;
      }
      persistenceRevision.current = document.revision;
      persistenceGraphRevision.current = graphRevision;
      persistenceObservedRevision.current = document.revision;
      persistenceObservedLoadToken.current = document.loadToken;
      if (
        persistenceExternalRevision.current !== undefined &&
        persistenceExternalRevision.current <= document.revision
      ) persistenceExternalRevision.current = undefined;
      persistedDocumentFingerprint.current = canvasUserDocumentFingerprint(document);
      persistedGraphFingerprint.current = canvasGraphFingerprint(document);
      setConfirmedPersistenceRevision(document.revision);
      setConfirmedGraphRevision(graphRevision);
      setNodes((current) => mergeAuthoritativeNodesWithViewState(
        current,
        document.nodes,
      ));
      setEdges(document.edges);
      applyViewport(document.viewport);
      return true;
    } finally {
      signal?.removeEventListener("abort", relayAbort);
    }
  }, [
    applyViewport,
    flushCanvasSave,
    persistenceFacade,
    persistenceFixture,
    persistenceId,
    persistenceScopeId,
    persistCanvasSaveSession,
    setEdges,
    setNodes,
  ]);
  settleCanvasMutationDurablyRef.current = async () => {
    if (!persistenceFixture) return;
    while (true) {
      await flushCanvasSave();
      await waitForCanvasRevision();
      const latest = canvasSnapshotRef.current();
      if (
        (latest.fingerprint === persistedDocumentFingerprint.current &&
          latest.graphFingerprint === persistedGraphFingerprint.current) ||
        confirmedLiveEditorSaveCoversCurrentSnapshot()
      ) return;
    }
  };
  const adoptAuthoritativeGenerationMutation = useCallback((
    mutation: AuthoritativeGenerationCanvasMutation,
  ) => {
    if (
      !persistenceReadyRef.current || persistenceConflict.current ||
      !Number.isSafeInteger(mutation.document.revision) ||
      mutation.document.revision < persistenceRevision.current ||
      !Number.isSafeInteger(mutation.document.graphRevision) ||
      !isCanvasLoadToken(mutation.document.loadToken)
    ) return false;
    const currentTarget = (pendingGuardedNodes.current ?? nodesRef.current).find(
      (node) => node.id === mutation.expected.nodeId,
    );
    if (
      !currentTarget || currentTarget.type !== mutation.expected.kind ||
      legacyTerminalNodeDataFingerprint(currentTarget.data) !==
        mutation.expected.nodeDataFingerprint
    ) return false;
    const normalizedDocument = {
      ...mutation.document,
      nodes: normalizeCanvasParentLinks(
        normalizePersistedMediaNodes(mutation.document.nodes),
      ),
      edges: mutation.document.edges.map((edge) =>
        stripSelectionFlowMarkers(
          edge.style && typeof edge.style === "object"
            ? { ...edge, style: undefined }
            : edge,
        )
      ),
    };
    if (
      persistenceFacade.transport.adoptAuthoritativeDocument &&
      !persistenceFacade.transport.adoptAuthoritativeDocument({
        canvasId: persistenceId,
        document: normalizedDocument,
        loadToken: mutation.document.loadToken,
      })
    ) return false;
    persistenceRevision.current = mutation.document.revision;
    persistenceGraphRevision.current = mutation.document.graphRevision;
    persistenceObservedRevision.current = mutation.document.revision;
    persistenceObservedLoadToken.current = mutation.document.loadToken;
    persistedDocumentFingerprint.current = canvasUserDocumentFingerprint(
      normalizedDocument,
    );
    persistedGraphFingerprint.current = canvasGraphFingerprint(
      normalizedDocument,
    );
    setConfirmedPersistenceRevision(mutation.document.revision);
    setConfirmedGraphRevision(mutation.document.graphRevision);
    setNodes((current) => mergeAuthoritativeNodesWithViewState(
      current,
      normalizedDocument.nodes,
    ));
    setEdges(normalizedDocument.edges);
    applyViewport(normalizedDocument.viewport);
    return true;
  }, [applyViewport, persistenceFacade, persistenceId, setEdges, setNodes]);
  useEffect(() => {
    if (!onGenerationRetryGateChange) return;
    const scopeId = persistenceScopeId;
    const gate = async () => {
      if (persistenceLoadIdentity.current.scopeId !== scopeId) {
        throw new Error("画布范围已经切换，不能重试生成");
      }
      const revision = await waitForCanvasRevision();
      if (persistenceLoadIdentity.current.scopeId !== scopeId) {
        throw new Error("画布范围已经切换，不能重试生成");
      }
      return revision;
    };
    onGenerationRetryGateChange(gate);
    return () => onGenerationRetryGateChange(undefined);
  }, [onGenerationRetryGateChange, persistenceScopeId, waitForCanvasRevision]);
  const generationCanvasContextValue = useMemo(
    () => ({
      ...createGroupRunSummaryScope(
        accountId ?? "",
        persistenceId,
        fixtureId ?? "",
      ),
      canvasRevision: generationCanvasRevision,
      adoptAuthoritativeGenerationMutation,
      flushCanvasSave,
      isFixture: Boolean(fixtureId),
      notify: showWorkflowToast,
      persistenceReady,
      readAuthoritativeCanvasRevision,
      receiveWorkflowResults,
      refreshAuthoritativeCanvasDocument,
      retryGenerationEnabled,
      waitForCanvasRevision,
    }),
    [
      accountId,
      adoptAuthoritativeGenerationMutation,
      fixtureId,
      flushCanvasSave,
      generationCanvasRevision,
      persistenceReady,
      persistenceId,
      readAuthoritativeCanvasRevision,
      receiveWorkflowResults,
      refreshAuthoritativeCanvasDocument,
      retryGenerationEnabled,
      showWorkflowToast,
      waitForCanvasRevision,
    ],
  );
  const canvasSelectionUiContextValue = useMemo(
    () => ({ selectedNodeCount }),
    [selectedNodeCount],
  );
  const guardedSetEdges = useCallback<
    Dispatch<SetStateAction<CuttableEdge[]>>
  >((update) => {
    if (!persistenceReadyRef.current) return;
    setEdges(update);
  }, [setEdges]);
  const guardedSetNodes = useCallback<
    Dispatch<SetStateAction<ProbeNodeType[]>>
  >((update) => {
    if (!persistenceReadyRef.current) return;
    setNodes(update);
  }, [setNodes]);
  const [canvasMutationPendingNodeIds, setCanvasMutationPendingNodeIds] =
    useState<ReadonlySet<string>>(new Set());
  const canvasMutationPendingNodeCountsRef = useRef(new Map<string, number>());
  const canvasMutationVersionsRef = useRef(new Map<string, number>());
  const readCanvasNode = useCallback(
    (nodeId: string) =>
      (pendingGuardedNodes.current ?? nodesRef.current)
        .find((node) => node.id === nodeId),
    [],
  );
  const readCanvasMutationVersion = useCallback(
    (nodeId: string) => canvasMutationVersionsRef.current.get(nodeId) ?? 0,
    [],
  );
  const canvasMutationScope = useMemo(() => createGroupRunSummaryScope(
    accountId ?? "",
    persistenceId,
    fixtureId ?? "",
  ), [accountId, fixtureId, persistenceId]);
  const runCanvasMutationAdmission = useCallback(async <T,>(
    nodeIds: readonly string[],
    work: () => Promise<T> | T,
    rollbackAfterDurableFailure?: (result: T) => Promise<void> | void,
  ): Promise<T | undefined> => {
    if (!persistenceReadyRef.current || persistenceConflict.current) {
      showWorkflowToast("画布保存边界不可用，请刷新后重试", "error");
      return undefined;
    }
    const affected = [...new Set(nodeIds.filter(Boolean))];
    let saveStarted = false;
    for (const nodeId of affected) {
      canvasMutationVersionsRef.current.set(
        nodeId,
        (canvasMutationVersionsRef.current.get(nodeId) ?? 0) + 1,
      );
      const count = canvasMutationPendingNodeCountsRef.current.get(nodeId) ?? 0;
      canvasMutationPendingNodeCountsRef.current.set(nodeId, count + 1);
    }
    setCanvasMutationPendingNodeIds((current) =>
      new Set([...current, ...affected])
    );
    try {
      return await runWithCanvasGraphMutationAdmission(
        canvasMutationScope,
        affected,
        async () => {
          if (!persistenceReadyRef.current || persistenceConflict.current) {
            throw new Error("画布保存边界不可用，请刷新后重试");
          }
          saveStarted = true;
          onSaveStart();
          const result = await work();
          try {
            await settleCanvasMutationSaveIndicator({
              currentFingerprint: () =>
                canvasSnapshotRef.current().fingerprint,
              onSaveSuccess,
              persistedFingerprint: () =>
                persistedDocumentFingerprint.current,
              settle: () => settleCanvasMutationDurablyRef.current(),
            });
          } catch (error) {
            await rollbackAfterDurableFailure?.(result);
            throw error;
          }
          return result;
        },
      );
    } catch (error) {
      if (saveStarted) {
        onSaveFailure(
          error instanceof Error ? error.message : "画布修改未能保存",
        );
      }
      showWorkflowToast(
        error instanceof Error
          ? error.message
          : "当前节点正在整组执行中，画布修改未应用",
        "error",
      );
      return undefined;
    } finally {
      setCanvasMutationPendingNodeIds((current) => {
        const next = new Set(current);
        for (const nodeId of affected) {
          const count = canvasMutationPendingNodeCountsRef.current.get(nodeId) ?? 0;
          if (count <= 1) {
            canvasMutationPendingNodeCountsRef.current.delete(nodeId);
            next.delete(nodeId);
          } else {
            canvasMutationPendingNodeCountsRef.current.set(nodeId, count - 1);
          }
        }
        return next;
      });
    }
  }, [
    canvasMutationScope,
    onSaveFailure,
    onSaveStart,
    onSaveSuccess,
    showWorkflowToast,
  ]);
  const changedNodeIds = useCallback((
    before: readonly ProbeNodeType[],
    after: readonly ProbeNodeType[],
  ) => {
    const beforeById = new Map(before.map((node) => [node.id, node]));
    const afterById = new Map(after.map((node) => [node.id, node]));
    return [...new Set([...beforeById.keys(), ...afterById.keys()])]
      .filter((nodeId) => beforeById.get(nodeId) !== afterById.get(nodeId));
  }, []);
  const changedEdgeEndpointIds = useCallback((
    before: readonly CuttableEdge[],
    after: readonly CuttableEdge[],
  ) => {
    const beforeById = new Map(before.map((edge) => [edge.id, edge]));
    const afterById = new Map(after.map((edge) => [edge.id, edge]));
    const nodeIds = new Set<string>();
    for (const edgeId of new Set([...beforeById.keys(), ...afterById.keys()])) {
      const beforeEdge = beforeById.get(edgeId);
      const afterEdge = afterById.get(edgeId);
      if (beforeEdge === afterEdge) continue;
      if (beforeEdge) {
        nodeIds.add(beforeEdge.source);
        nodeIds.add(beforeEdge.target);
      }
      if (afterEdge) {
        nodeIds.add(afterEdge.source);
        nodeIds.add(afterEdge.target);
      }
    }
    return [...nodeIds];
  }, []);
  const mutateGraph = useCallback(async (update: (current: Readonly<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
  }>) => Readonly<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
  }>, options?: Readonly<{ checkpoint?: boolean }>): Promise<boolean> => {
    if (!persistenceReadyRef.current || persistenceConflict.current) {
      return false;
    }
    const previewCurrent = {
      edges: pendingGuardedEdges.current ?? edgesRef.current,
      nodes: pendingGuardedNodes.current ?? nodesRef.current,
    };
    const preview = update(previewCurrent);
    const plannedNodeIds = [...new Set([
      ...changedNodeIds(previewCurrent.nodes, preview.nodes),
      ...changedEdgeEndpointIds(previewCurrent.edges, preview.edges),
    ])];
    if (plannedNodeIds.length === 0) return false;
    const commit = () => {
      const current = {
        edges: pendingGuardedEdges.current ?? edgesRef.current,
        nodes: pendingGuardedNodes.current ?? nodesRef.current,
      };
      const next = update(current);
      const actualNodeIds = [...new Set([
        ...changedNodeIds(current.nodes, next.nodes),
        ...changedEdgeEndpointIds(current.edges, next.edges),
      ])];
      if (actualNodeIds.some((nodeId) => !plannedNodeIds.includes(nodeId))) {
        throw new Error("画布已在等待期间变化，本次修改未应用");
      }
      if (actualNodeIds.length === 0) return false;
      if (options?.checkpoint !== false) checkpoint();
      commitCanvasGraphAtomic({ edges: next.edges, nodes: next.nodes });
      return true;
    };
    if (plannedNodeIds.every((nodeId) =>
      canvasNodeMutationAdmissionHeldLocally(canvasMutationScope, nodeId)
    )) {
      const applied = commit();
      if (applied) await settleCanvasMutationDurablyRef.current();
      return applied;
    }
    return (await runCanvasMutationAdmission(plannedNodeIds, commit)) === true;
  }, [
    canvasMutationScope,
    changedEdgeEndpointIds,
    changedNodeIds,
    checkpoint,
    commitCanvasGraphAtomic,
    runCanvasMutationAdmission,
  ]);
  const applyDurableLayoutChanges = useCallback((
    current: ProbeNodeType[],
    changes: NodeChange<ProbeNodeType>[],
  ) => {
    const explicitResizes = new Map(changes.flatMap((change) =>
      change.type === "dimensions" && change.dimensions
        ? [[change.id, change.dimensions] as const]
        : []
    ));
    const changed = applyNodeChanges(changes, current);
    if (explicitResizes.size === 0) return changed;
    return changed.map((node) => {
      const dimensions = explicitResizes.get(node.id);
      return dimensions
        ? {
            ...node,
            style: {
              ...node.style,
              height: dimensions.height,
              width: dimensions.width,
            },
          }
        : node;
    });
  }, []);
  const clearLayoutPreview = useCallback((gestureId?: number) => {
    if (
      gestureId !== undefined &&
      layoutGestureRef.current?.gestureId !== gestureId
    ) return;
    layoutGestureRef.current = undefined;
    if (layoutPreviewByNodeId.current.size === 0) return;
    layoutPreviewByNodeId.current.clear();
    setLayoutPreviewVersion((version) => version + 1);
  }, []);
  const beginLayoutGesture = useCallback((kind: "drag" | "resize") => {
    const current = layoutGestureRef.current;
    if (current) return current.kind === kind && current.phase === "preview"
      ? current
      : undefined;
    if (!persistenceReadyRef.current || persistenceConflict.current) {
      return undefined;
    }
    const gesture = {
      affectedNodeIds: new Set<string>(),
      epoch: persistenceLoadIdentity.current.epoch,
      gestureId: layoutGestureSequence.current + 1,
      kind,
      phase: "preview" as const,
      scopeId: persistenceLoadIdentity.current.scopeId,
    };
    layoutGestureSequence.current = gesture.gestureId;
    layoutGestureRef.current = gesture;
    return gesture;
  }, []);
  const updateLayoutPreview = useCallback((
    kind: "drag" | "resize",
    changes: NodeChange<ProbeNodeType>[],
  ) => {
    const gesture = beginLayoutGesture(kind);
    if (!gesture || gesture.phase !== "preview") return false;
    let changed = false;
    for (const change of changes) {
      if (!("id" in change)) continue;
      const currentNode = nodesRef.current.find((node) => node.id === change.id);
      if (!currentNode) continue;
      const previous = layoutPreviewByNodeId.current.get(change.id) ?? {};
      if (change.type === "position") {
        if (!change.position && change.dragging === undefined) continue;
        layoutPreviewByNodeId.current.set(change.id, {
          ...previous,
          ...(change.dragging !== undefined
            ? { dragging: change.dragging }
            : {}),
          ...(change.position
            ? { position: { ...change.position } }
            : {}),
        });
        gesture.affectedNodeIds.add(change.id);
        changed = true;
      } else if (change.type === "dimensions" && change.dimensions) {
        layoutPreviewByNodeId.current.set(change.id, {
          ...previous,
          height: change.dimensions.height,
          style: {
            ...previous.style,
            height: change.dimensions.height,
            width: change.dimensions.width,
          },
          width: change.dimensions.width,
        });
        gesture.affectedNodeIds.add(change.id);
        changed = true;
      }
    }
    if (changed) {
      // If an older normal save is superseded while this gesture is still a
      // view-only preview, conflict recovery must sample that live preview
      // before deciding that the page is clean and reloadable. Merely marking
      // the fingerprint does not enqueue or transmit the layout mutation.
      const pendingAttempt = persistencePendingAttempt.current;
      const sent = pendingAttempt
        ? persistenceSentFingerprints.current.get(pendingAttempt.saveSequence)
        : undefined;
      if (pendingAttempt && sent && !sent.liveEditors) {
        persistenceSentFingerprints.current.set(pendingAttempt.saveSequence, {
          ...sent,
          liveEditors: true,
        });
      }
      setLayoutPreviewVersion((version) => version + 1);
    }
    return changed;
  }, [beginLayoutGesture]);
  const finishLayoutGesture = useCallback(async (kind: "drag" | "resize") => {
    const gesture = layoutGestureRef.current;
    if (!gesture || gesture.kind !== kind || gesture.phase !== "preview") return;
    const gestureId = gesture.gestureId;
    const fenced = !persistenceConflict.current &&
      persistenceLoadIdentity.current.scopeId === gesture.scopeId &&
      persistenceLoadIdentity.current.epoch === gesture.epoch;
    if (!fenced) {
      clearLayoutPreview(gestureId);
      return;
    }
    const patches = new Map(layoutPreviewByNodeId.current);
    const applyPatches = (current: ProbeNodeType[]) => current.map((node) => {
      const preview = patches.get(node.id);
      if (!preview) return node;
      const nextPosition = preview.position ?? node.position;
      const nextWidth = preview.style?.width ?? node.style?.width;
      const nextHeight = preview.style?.height ?? node.style?.height;
      const positionChanged = nextPosition.x !== node.position.x ||
        nextPosition.y !== node.position.y;
      const sizeChanged = nextWidth !== node.style?.width ||
        nextHeight !== node.style?.height;
      if (!positionChanged && !sizeChanged) return node;
      return {
        ...node,
        position: { ...nextPosition },
        ...(sizeChanged
          ? {
              style: {
                ...node.style,
                height: nextHeight,
                width: nextWidth,
              },
            }
          : {}),
      };
    });
    const previewCurrent = pendingGuardedNodes.current ?? nodesRef.current;
    const committedPreview = applyPatches(previewCurrent);
    if (changedNodeIds(previewCurrent, committedPreview).length === 0) {
      clearLayoutPreview(gestureId);
      return;
    }
    if (!persistenceReadyRef.current) {
      // A superseded in-flight save temporarily closes the ready gate while
      // its authoritative baseline GET rebases a live drag/resize draft. The
      // recovery journal already owns that exact preview snapshot, so commit
      // the same snapshot locally instead of dropping it at pointer-up. Other
      // not-ready states remain fail-closed.
      if (!persistenceSaving.current || !persistenceDirty.current) {
        clearLayoutPreview(gestureId);
        return;
      }
      checkpoint();
      commitCanvasGraphAtomic({
        edges: pendingGuardedEdges.current ?? edgesRef.current,
        nodes: committedPreview,
      });
      clearLayoutPreview(gestureId);
      return;
    }
    layoutGestureRef.current = { ...gesture, phase: "committing" };
    // Start the persistence quiet window at gesture completion. The preview is
    // local-only, so without this fence a large command diff can begin while
    // the user's next pan or zoom is already in progress.
    markCanvasInteraction();
    checkpoint();
    try {
      await mutateGraph(({ edges, nodes }) => ({
        edges,
        nodes: applyPatches(nodes),
      }), { checkpoint: false });
    } finally {
      clearLayoutPreview(gestureId);
    }
  }, [
    changedNodeIds,
    checkpoint,
    clearLayoutPreview,
    commitCanvasGraphAtomic,
    markCanvasInteraction,
    mutateGraph,
  ]);
  useEffect(() => {
    const finishResize = () => {
      if (
        layoutGestureRef.current?.kind === "resize" &&
        layoutGestureRef.current.phase === "preview"
      ) {
        void finishLayoutGesture("resize").catch(() => undefined);
      }
    };
    window.addEventListener("pointerup", finishResize);
    return () => window.removeEventListener("pointerup", finishResize);
  }, [finishLayoutGesture]);
  useEffect(() => {
    const cancelPreview = () => {
      if (layoutGestureRef.current?.phase === "preview") clearLayoutPreview();
    };
    const cancelForEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelPreview();
    };
    window.addEventListener("pointercancel", cancelPreview);
    window.addEventListener("blur", cancelPreview);
    window.addEventListener("keydown", cancelForEscape);
    return () => {
      layoutGestureRef.current = undefined;
      layoutPreviewByNodeId.current.clear();
      window.removeEventListener("pointercancel", cancelPreview);
      window.removeEventListener("blur", cancelPreview);
      window.removeEventListener("keydown", cancelForEscape);
    };
  }, [clearLayoutPreview, persistenceId]);
  const applyViewUpdate = useCallback((
    update: SetStateAction<ProbeNodeType[]>,
  ) => {
    if (!persistenceReadyRef.current || persistenceConflict.current) return false;
    const current = pendingGuardedNodes.current ?? nodesRef.current;
    const next = typeof update === "function" ? update(current) : update;
    if (!canvasViewUpdateAllowed(current, next)) return false;
    setNodes(next);
    return true;
  }, [setNodes]);
  const applyEdgeViewUpdate = useCallback((
    update: SetStateAction<CuttableEdge[]>,
  ) => {
    if (!persistenceReadyRef.current || persistenceConflict.current) return false;
    const current = pendingGuardedEdges.current ?? edgesRef.current;
    const next = typeof update === "function" ? update(current) : update;
    if (!canvasEdgeViewUpdateAllowed(current, next)) return false;
    setEdges(next);
    return true;
  }, [setEdges]);
  const adoptAuthoritativeNodeData = useCallback((
    adoption: CanvasAuthoritativeNodeDataAdoption,
  ) => {
    if (
      !persistenceReadyRef.current || persistenceConflict.current ||
      !authoritativeCanvasNodeDataPatchAllowed(
        adoption.patch as Readonly<Record<string, unknown>>,
      )
    ) return false;
    const current = pendingGuardedNodes.current ?? nodesRef.current;
    const target = current.find((node) => node.id === adoption.nodeId);
    if (!target) return false;
    if (
      adoption.expectedAssetId !== undefined &&
      target.data.assetId !== adoption.expectedAssetId
    ) return false;
    if (adoption.expectedTask) {
      const taskId = (target.data as Record<string, unknown>)[
        `${adoption.expectedTask.kind}GenerationTaskId`
      ];
      if (taskId !== adoption.expectedTask.taskId) return false;
    }
    setNodes(current.map((node) => node.id === adoption.nodeId
      ? { ...node, data: { ...node.data, ...adoption.patch } }
      : node));
    return true;
  }, [setNodes]);
  const tryAdoptNodes = useCallback(async (
    targetNodeId: string,
    update: SetStateAction<ProbeNodeType[]>,
    options?: Readonly<{ checkpoint?: boolean }>,
  ) => {
    if (!persistenceReadyRef.current) return false;
    const previewBase = pendingGuardedNodes.current ?? nodesRef.current;
    const preview = typeof update === "function" ? update(previewBase) : update;
    if (!previewBase.some((node) => node.id === targetNodeId)) return false;
    const plannedNodeIds = [...new Set([
      targetNodeId,
      ...changedNodeIds(previewBase, preview),
    ])];
    let beforeById: Map<string, ProbeNodeType> | undefined;
    let committedById: Map<string, ProbeNodeType> | undefined;
    return (await runCanvasMutationAdmission(plannedNodeIds, () => {
      const current = pendingGuardedNodes.current ?? nodesRef.current;
      const next = typeof update === "function" ? update(current) : update;
      if (!current.some((node) => node.id === targetNodeId)) return false;
      const actualNodeIds = changedNodeIds(current, next);
      if (actualNodeIds.some((nodeId) => !plannedNodeIds.includes(nodeId))) {
        throw new Error("画布已在等待期间变化，媒体未接管");
      }
      if (options?.checkpoint) checkpoint();
      const committed = tryCommitCanvasNodeAdoption({
        commit: setNodes,
        currentNodes: () => pendingGuardedNodes.current ?? nodesRef.current,
        persistenceReady: () => persistenceReadyRef.current,
        targetNodeId,
        update: next,
      });
      if (committed) {
        beforeById = new Map(actualNodeIds.flatMap((nodeId) => {
          const node = current.find((candidate) => candidate.id === nodeId);
          return node ? [[nodeId, node] as const] : [];
        }));
        committedById = new Map(actualNodeIds.flatMap((nodeId) => {
          const node = next.find((candidate) => candidate.id === nodeId);
          return node ? [[nodeId, node] as const] : [];
        }));
      }
      return committed;
    }, (committed) => {
      if (!committed || !beforeById || !committedById) return;
      const rollbackBeforeById = beforeById;
      const rollbackCommittedById = committedById;
      setNodes((current) => rollbackCanvasNodeAdoption({
        beforeById: rollbackBeforeById,
        committedById: rollbackCommittedById,
        current,
      }));
    })) === true;
  }, [changedNodeIds, checkpoint, runCanvasMutationAdmission, setNodes]);
  const adoptUploadedAsset = useCallback(async (
    adoption: CanvasUploadedAssetAdoption,
    options?: Readonly<{ checkpoint?: boolean }>,
  ) => {
    const restoreUploadViewBaseline = () => {
      const baseline = adoption.rollbackTarget;
      if (
        !baseline || baseline.id !== adoption.targetNodeId ||
        baseline.type !== adoption.mediaKind
      ) return;
      const fields = [
        "inputViewState",
        "inputViewStateReason",
        `${adoption.mediaKind}GenerationError`,
        `${adoption.mediaKind}GenerationErrorCode`,
      ];
      applyViewUpdate((current) => current.map((node) => {
        if (node.id !== adoption.targetNodeId) return node;
        const data = { ...node.data } as Record<string, unknown>;
        const baselineData = baseline.data as Record<string, unknown>;
        for (const field of fields) {
          if (Object.prototype.hasOwnProperty.call(baselineData, field)) {
            data[field] = baselineData[field];
          } else {
            delete data[field];
          }
        }
        return { ...node, data: data as ProbeNodeType["data"] };
      }));
    };
    if (!persistenceReadyRef.current || persistenceConflict.current) {
      restoreUploadViewBaseline();
      return false;
    }
    const previewBase = pendingGuardedNodes.current ?? nodesRef.current;
    const preview = typeof adoption.update === "function"
      ? adoption.update(previewBase)
      : adoption.update;
    if (!canvasUploadedAssetAdoptionAllowed(previewBase, preview, adoption)) {
      restoreUploadViewBaseline();
      return false;
    }
    const plannedNodeIds = changedNodeIds(previewBase, preview);
    let beforeById: Map<string, ProbeNodeType> | undefined;
    let committedById: Map<string, ProbeNodeType> | undefined;
    const adopted = (await runCanvasMutationAdmission(plannedNodeIds, () => {
      const current = pendingGuardedNodes.current ?? nodesRef.current;
      const next = typeof adoption.update === "function"
        ? adoption.update(current)
        : adoption.update;
      if (!canvasUploadedAssetAdoptionAllowed(current, next, adoption)) {
        return false;
      }
      const actualNodeIds = changedNodeIds(current, next);
      if (actualNodeIds.some((nodeId) => !plannedNodeIds.includes(nodeId))) {
        throw new Error("画布已在等待期间变化，上传素材未接管");
      }
      if (options?.checkpoint) checkpoint();
      beforeById = new Map(actualNodeIds.flatMap((nodeId) => {
        const rollbackTarget = adoption.rollbackTarget;
        const node = nodeId === adoption.targetNodeId &&
            rollbackTarget?.id === adoption.targetNodeId &&
            rollbackTarget.type === adoption.mediaKind
          ? rollbackTarget
          : current.find((candidate) => candidate.id === nodeId);
        return node ? [[nodeId, node] as const] : [];
      }));
      committedById = new Map(actualNodeIds.flatMap((nodeId) => {
        const node = next.find((candidate) => candidate.id === nodeId);
        return node ? [[nodeId, node] as const] : [];
      }));
      setNodes(next);
      if (persistenceFixture) {
        // Replacing one uploaded asset with another may change only
        // server-owned media fields, which are intentionally excluded from
        // the browser user-dirty fingerprint. Explicit asset adoption still
        // has to enqueue its typed durable command.
        persistenceQueued.current = canvasSnapshot(next);
        persistenceDirty.current = true;
      }
      return true;
    }, (committed) => {
      if (!committed || !beforeById || !committedById) return;
      const rollbackBeforeById = beforeById;
      const rollbackCommittedById = committedById;
      setNodes((current) => rollbackCanvasNodeAdoption({
        beforeById: rollbackBeforeById,
        committedById: rollbackCommittedById,
        current,
      }));
    })) === true;
    if (!adopted) restoreUploadViewBaseline();
    return adopted;
  }, [
    applyViewUpdate,
    canvasSnapshot,
    changedNodeIds,
    checkpoint,
    persistenceFixture,
    runCanvasMutationAdmission,
    setNodes,
  ]);
  const workflowGraphPort = useMemo(() => createCanvasGraphCommandPort({
    commit: commitCanvasGraphAtomic,
    commitView: (nextNodes) => setNodes([...nextNodes]),
    persistenceReady: () =>
      persistenceReadyRef.current && !persistenceConflict.current,
    refreshAuthoritativeDocument: refreshAuthoritativeCanvasDocument,
    snapshot: () => ({
      edges: pendingGuardedEdges.current ?? edgesRef.current,
      nodes: pendingGuardedNodes.current ?? nodesRef.current,
      revision: generationCanvasRevisionRef.current,
    }),
  }), [commitCanvasGraphAtomic, refreshAuthoritativeCanvasDocument, setNodes]);
  const modelTransitionPort = useMemo(() => createCanvasModelTransitionPort({
    checkpoint,
    commitAtomic: commitCanvasGraphAtomic,
    flush: flushCanvasSave,
    persistenceReady: () =>
      persistenceReadyRef.current && !persistenceConflict.current,
    snapshot: () => ({
      edges: pendingGuardedEdges.current ?? edgesRef.current,
      nodes: pendingGuardedNodes.current ?? nodesRef.current,
      revision: generationCanvasRevisionRef.current,
    }),
    waitForRevision: waitForCanvasRevision,
  }), [
    checkpoint,
    commitCanvasGraphAtomic,
    flushCanvasSave,
    waitForCanvasRevision,
  ]);

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

  const readWorkflowEdges = useCallback(
    () => pendingGuardedEdges.current ?? edgesRef.current,
    [],
  );
  const readWorkflowNodes = useCallback(
    () => pendingGuardedNodes.current ?? nodesRef.current,
    [],
  );
  return (
    <GenerationCanvasContext.Provider
      value={generationCanvasContextValue}
    >
      <WorkflowExecutionProvider
        applyViewUpdate={applyViewUpdate}
        graph={workflowGraphPort}
        getEdges={readWorkflowEdges}
        getNodes={readWorkflowNodes}
        nodesSnapshot={nodes}
        notify={showWorkflowToast}
        onActiveNodeIdsChange={setWorkflowActiveNodeIds}
        onRetainedNodeIdsChange={setWorkflowRetainedNodeIds}
      >
      <CanvasGraphMutationContext.Provider
        value={{
          adoptUploadedAsset,
          adoptAuthoritativeNodeData,
          applyEdgeViewUpdate,
          applyModelTransition: modelTransitionPort.apply,
          applyViewUpdate,
          canvasMutationPendingNodeIds,
          graphCommandPort: workflowGraphPort,
          imageColorFilter,
          mutateGraph,
          readCanvasNode,
          readCanvasMutationVersion,
          setImageColorFilter,
          tryAdoptNodes,
        }}
      >
      <CanvasCheckpointContext.Provider value={checkpoint}>
      <CanvasSelectionUiContext.Provider value={canvasSelectionUiContextValue}>
      <div
      aria-label="画布"
      aria-busy={effectivePersistenceLoadState === "loading"}
      className="canvas-world"
      data-agent-reference-mode={agentReferenceMode ? "true" : undefined}
      data-create-menu={
        createMenu || blankContextMenu || nodeContextMenu ? "true" : undefined
      }
      data-multi-selection={selectedNodeCount > 1 ? "true" : undefined}
      data-testid="canvas-world"
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
      data-workflow-run-active={
        workflowRetainedNodeIds.size > 0 ? "true" : undefined
      }
      data-persistence-ready={persistenceReady ? "true" : "false"}
      data-persistence-state={effectivePersistenceLoadState}
      data-save-fingerprint-count={persistenceSentFingerprints.current.size}
      data-selected-node-count={selectedNodeCount}
      data-selected-edge-count={edges.filter((edge) => edge.selected).length}
      onWheelCapture={(event) => {
        if (persistenceReady) handleCanvasWheelCapture(event);
      }}
      onDragOverCapture={(event) => {
        const types = Array.from(event.dataTransfer.types);
        if (
          !types.includes(CANVAS_LIBRARY_ASSET_MIME) &&
          !types.includes("Files")
        ) {
          return;
        }
        // Supported canvas drops must never fall through to the browser's
        // default file/URL navigation, even while hydration is still pending.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(event) => {
        const raw = event.dataTransfer.getData(CANVAS_LIBRARY_ASSET_MIME);
        const droppedFile = event.dataTransfer.files.item(0) ?? undefined;
        if (!raw && !droppedFile) return;
        event.preventDefault();
        event.stopPropagation();
        if (!persistenceReady) return;
        if (raw) {
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
            void addDroppedLibraryAsset(asset, {
              x: event.clientX,
              y: event.clientY,
            });
          } catch {
            // Ignore malformed external drag payloads after suppressing the
            // browser's default navigation.
          }
          return;
        }
        if (!droppedFile) return;
        if (
          !["image/gif", "image/jpeg", "image/png", "image/webp"].includes(
            droppedFile.type,
          )
        ) {
          setUploadError("仅支持 PNG、JPEG、WebP 或 GIF 图片");
          showWorkflowToast("仅支持 PNG、JPEG、WebP 或 GIF 图片", "error");
          return;
        }
        void uploadImage(droppedFile, {
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onDoubleClick={(event) => {
        if (
          !persistenceReady ||
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
            x: (x - viewportRef.current.x) / viewportRef.current.zoom,
            y: (y - viewportRef.current.y) / viewportRef.current.zoom,
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
      onPointerMove={trackPointerWorld}
      onPointerDownCapture={(event: ReactPointerEvent<HTMLDivElement>) => {
        const target = event.target;
        marqueeStart.current =
          event.button === 0 &&
            target instanceof Element &&
            target.classList.contains("react-flow__pane")
            ? { x: event.clientX, y: event.clientY }
            : undefined;
      }}
      ref={worldRef}
      role="application"
    >
      <ReactFlow
        autoPanOnNodeDrag
        autoPanSpeed={15}
        connectionLineStyle={{ stroke: "#ffffff60", strokeWidth: 1 }}
        defaultViewport={viewport}
        defaultEdgeOptions={{ interactionWidth: 20 }}
        deleteKeyCode={persistenceReady ? ["Backspace", "Delete"] : null}
        edges={visibleEdges}
        edgeTypes={edgeTypes}
        edgesReconnectable={false}
        elementsSelectable={persistenceReady && !agentReferenceMode}
        elevateEdgesOnSelect={false}
        elevateNodesOnSelect
        isValidConnection={isValidConnection}
        maxZoom={2}
        multiSelectionKeyCode="Shift"
        minZoom={0.15}
        nodes={renderedNodes}
        nodesDraggable={persistenceReady && !activePlaylist && !agentReferenceMode}
        nodesConnectable={persistenceReady}
        nodeTypes={nodeTypes}
        onlyRenderVisibleElements
        onConnect={addConnection}
        onConnectEnd={(event, state) => {
          if (!persistenceReady) return;
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
          if (!persistenceReady) return;
          window.clearTimeout(cutTimer.current);
          cutTimer.current = window.setTimeout(() => {
            applyEdgeViewUpdate((current) =>
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
          if (!persistenceReady) return;
          window.clearTimeout(cutTimer.current);
          const related =
            event.relatedTarget instanceof Element
              ? event.relatedTarget.closest("[data-edge-cut-for]")
              : null;

          if (related?.getAttribute("data-edge-cut-for") === edge.id) {
            return;
          }

          applyEdgeViewUpdate((current) =>
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
          if (!persistenceReady) return;
          window.clearTimeout(cutTimer.current);
          applyEdgeViewUpdate((current) =>
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
        onEdgesChange={(changes) => {
          if (!persistenceReady) return;
          const passive = changes.filter((change) => change.type === "select");
          if (passive.length > 0) applyPassiveEdgeChanges(passive);
          const structural = changes.filter((change) => change.type !== "select");
          if (structural.length === 0) return;
          const previewEdges = pendingGuardedEdges.current ?? edgesRef.current;
          const previewNext = applyEdgeChanges(structural, previewEdges);
          const plannedNodeIds = changedEdgeEndpointIds(
            previewEdges,
            previewNext,
          );
          if (plannedNodeIds.some((nodeId) =>
            workflowRetainedNodeIds.has(nodeId)
          )) {
            showWorkflowToast("整组执行中，不能删除参与节点的连线", "error");
            return;
          }
          if (plannedNodeIds.length === 0) return;
          void runCanvasMutationAdmission(plannedNodeIds, () => {
            const currentNodes = pendingGuardedNodes.current ?? nodesRef.current;
            const currentEdges = pendingGuardedEdges.current ?? edgesRef.current;
            const nextEdges = applyEdgeChanges(structural, currentEdges);
            const actualNodeIds = changedEdgeEndpointIds(
              currentEdges,
              nextEdges,
            );
            if (actualNodeIds.some((nodeId) =>
              !plannedNodeIds.includes(nodeId)
            )) {
              throw new Error("画布连线已在等待期间变化，本次修改未应用");
            }
            if (actualNodeIds.length === 0) return;
            checkpoint();
            commitCanvasGraphAtomic({
              edges: nextEdges,
              nodes: currentNodes,
            });
          });
        }}
        onDelete={({ edges: deletedEdges, nodes: deletedNodes }) => {
          if (!persistenceReady) return;
          pushHistory({
            edges: deletedEdges.map(stripSelectionFlowMarkers),
            kind: "delete",
            nodes: cloneNodes(deletedNodes),
          });
        }}
        onBeforeDelete={async ({ edges: deletingEdges, nodes: deletingNodes }) => {
          if (!persistenceReady) return false;
          if (
            deletingNodes.some((node) => workflowRetainedNodeIds.has(node.id)) ||
            deletingEdges.some((edge) =>
              workflowRetainedNodeIds.has(edge.source) ||
              workflowRetainedNodeIds.has(edge.target)
            )
          ) {
            showWorkflowToast("整组执行中，不能删除参与节点或连线", "error");
            return false;
          }
          const affectedNodeIds = new Set(deletingNodes.map((node) => node.id));
          for (const edge of deletingEdges) {
            affectedNodeIds.add(edge.source);
            affectedNodeIds.add(edge.target);
          }
          const previewNodes = pendingGuardedNodes.current ?? nodesRef.current;
          for (const groupId of deletingNodes
            .filter((node) => node.type === "group")
            .map((node) => node.id)) {
            for (const node of previewNodes) {
              if (node.parentId === groupId) affectedNodeIds.add(node.id);
            }
          }
          await runCanvasMutationAdmission([...affectedNodeIds], () => {
            const currentNodes = pendingGuardedNodes.current ?? nodesRef.current;
            const currentEdges = pendingGuardedEdges.current ?? edgesRef.current;
            const deletedNodeIds = new Set(deletingNodes.map((node) => node.id));
            for (const node of currentNodes) {
              if (node.parentId && deletedNodeIds.has(node.parentId)) {
                deletedNodeIds.add(node.id);
              }
            }
            const deletedEdgeIds = new Set(deletingEdges.map((edge) => edge.id));
            for (const edge of currentEdges) {
              if (deletedNodeIds.has(edge.source) || deletedNodeIds.has(edge.target)) {
                deletedEdgeIds.add(edge.id);
              }
            }
            const deletedNodes = currentNodes.filter((node) =>
              deletedNodeIds.has(node.id)
            );
            const deletedEdges = currentEdges.filter((edge) =>
              deletedEdgeIds.has(edge.id)
            );
            pushHistory({
              edges: deletedEdges.map(stripSelectionFlowMarkers),
              kind: "delete",
              nodes: cloneNodes(deletedNodes),
            });
            commitCanvasGraphAtomic({
              nodes: currentNodes.filter((node) => !deletedNodeIds.has(node.id)),
              edges: currentEdges.filter((edge) => !deletedEdgeIds.has(edge.id)),
            });
          });
          // Deletion is committed inside the cross-tab admission boundary.
          return false;
        }}
        onInit={(instance) => {
          flowInstance.current = instance;
          if (pendingProgrammaticViewport.current) {
            instance.setViewport(pendingProgrammaticViewport.current);
            pendingProgrammaticViewport.current = undefined;
          }
          onReady(() => {
            cancelTemplateFit();
            // A camera-only command must open the interaction fence before
            // React Flow reconciles visibility/measurements.
            markCanvasInteraction();
            void instance.fitView({ duration: 0, padding: 0.2 });
          });
        }}
        onNodesChange={(changes) => {
          // Keep ReactFlow's passive measurements in the controlled nodes so
          // the first hydrated data edit cannot temporarily hide the node.
          let acceptedChanges = persistenceReady
            ? changes
            : changes.filter(
                (change) =>
                  change.type === "dimensions" &&
                  change.dimensions !== undefined &&
                  change.resizing !== true,
              );
          const requestedRemovals = acceptedChanges.filter((change) =>
            change.type === "remove"
          );
          if (requestedRemovals.length > 0) {
            deleteNodesWithAdmission(requestedRemovals.map((change) => change.id));
            acceptedChanges = acceptedChanges.filter((change) =>
              change.type !== "remove"
            );
          }
          if (workflowRetainedNodeIds.size > 0) {
            const retainedGroupIds = new Set(
              nodesRef.current
                .filter(
                  (node) =>
                    node.type === "group" &&
                    workflowRetainedNodeIds.has(node.id),
                )
                .map((node) => node.id),
            );
            acceptedChanges = acceptedChanges.filter((change) => {
              if (!("id" in change)) return false;
              if (!workflowRetainedNodeIds.has(change.id)) return true;
              // The active group may still be selected and moved so its stop
              // button remains reachable even after dragging the group away;
              // child selection and all structural/configuration changes stay
              // fenced.
              if (change.type === "select") {
                return retainedGroupIds.has(change.id);
              }
              if (change.type === "position") {
                // Moving the parent is the one permitted graph operation
                // during a run; it keeps the whole retained group coherent
                // when the user drags it out of the viewport.
                return retainedGroupIds.has(change.id);
              }
              // React Flow can report passive measurement changes while a
              // retained off-screen child is mounted. Keep those measurements
              // but never accept an active resize operation.
              if (change.type === "dimensions") {
                return (
                  change.resizing === undefined &&
                  change.setAttributes === undefined
                );
              }
              return false;
            });
          }
          if (acceptedChanges.length === 0) return;
          const now = performance.now();
          const viewportInteracting =
            lastViewportInteractionAt.current > 0 &&
            now - lastViewportInteractionAt.current < VIEWPORT_QUIET_MS;
          const activelyEditingLayout =
            layoutGestureRef.current?.phase === "preview" ||
            acceptedChanges.some(
              (change) =>
                change.type === "position" && change.dragging === true ||
                change.type === "dimensions" &&
                  (change.resizing === true || change.setAttributes !== undefined),
            );
          if (viewportInteracting && !activelyEditingLayout) {
            // Zoom/pan may mount, unmount or re-measure a parent group. React
            // Flow already owns those measurements in its internal view store.
            // Mirroring them back through the controlled document causes a
            // second full reconciliation for every camera frame. A camera-only
            // action is not graph editing, so retain selection while rejecting
            // camera-induced measurement/structural/coordinate mutation noise.
            acceptedChanges = acceptedChanges.filter(
              (change) =>
                change.type === "select" || change.type === "remove",
            );
            if (acceptedChanges.length === 0) return;
          }
          const passiveChanges = acceptedChanges.filter((change) =>
            change.type === "select" ||
            change.type === "dimensions" &&
              (!persistenceReady ||
                change.resizing === undefined &&
                  change.setAttributes === undefined)
          );
          if (passiveChanges.length > 0) {
            applyPassiveNodeChanges(passiveChanges);
          }
          if (!persistenceReady) return;
          const committingLayoutGesture =
            layoutGestureRef.current?.phase === "committing";
          let activeLayoutKind = layoutGestureRef.current?.phase === "preview"
            ? layoutGestureRef.current.kind
            : undefined;
          if (!activeLayoutKind && acceptedChanges.some((change) =>
            change.type === "dimensions" && change.resizing === true
          )) {
            activeLayoutKind = beginLayoutGesture("resize")?.kind;
          }
          if (!activeLayoutKind && acceptedChanges.some((change) =>
            change.type === "position" && change.dragging === true
          )) {
            activeLayoutKind = beginLayoutGesture("drag")?.kind;
          }
          const layoutChanges = keepLastNonCollidingPositions(
            acceptedChanges.filter((change) =>
              change.type === "position" ||
              change.type === "dimensions" &&
                (change.resizing !== undefined ||
                  change.setAttributes !== undefined)
            ),
          );
          if (layoutChanges.length === 0) return;
          // React Flow emits one last controlled position/dimension echo after
          // onNodeDragStop/pointerup. The gesture snapshot is already being
          // admitted at that point; starting a second mutation would create a
          // duplicate history entry and could race the first durable commit.
          if (committingLayoutGesture) return;
          if (activeLayoutKind) {
            updateLayoutPreview(activeLayoutKind, layoutChanges);
            return;
          }
          void mutateGraph(({ edges, nodes }) => ({
            edges,
            nodes: applyDurableLayoutChanges(nodes, layoutChanges),
          })).catch(() => undefined);
        }}
        onNodeDragStart={() => {
          if (!persistenceReady) return;
          beginLayoutGesture("drag");
        }}
        onNodeDragStop={() => {
          if (!persistenceReady) return;
          void finishLayoutGesture("drag").catch(() => undefined);
        }}
        onNodeClick={(_, node) => {
          if (!persistenceReady) return;
          setNodeContextMenu(undefined);
          if (agentReferenceMode) {
            applyViewUpdate((current) =>
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
              const adoptionTimestamp = Date.now();
              const adoptedClips = sourceClips.map((clip, index) => ({
                ...clip,
                id: `${clip.id}-${adoptionTimestamp}-${index}`,
              }));
              void mutateGraph(({ edges, nodes }) => ({
                edges,
                nodes: nodes.map((candidate) =>
                  candidate.id === activePlaylist.id
                    ? {
                        ...candidate,
                        selected: true,
                        data: {
                          ...candidate.data,
                          playlistClips: [
                            ...(candidate.data.playlistClips ?? []),
                            ...adoptedClips,
                          ],
                        },
                      }
                    : { ...candidate, selected: false },
                ),
              }));
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
          if (
            !persistenceReady ||
            !worldRef.current ||
            agentReferenceMode
          ) return;
          const bounds = worldRef.current.getBoundingClientRect();
          const x = Math.max(
            8,
            Math.min(event.clientX - bounds.left, bounds.width - 248),
          );
          const y = Math.max(
            8,
            Math.min(event.clientY - bounds.top, bounds.height - 471),
          );
          applyViewUpdate((current) =>
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
          if (!persistenceReady) return;
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
          if (
            !persistenceReady ||
            !worldRef.current
          ) return;
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
            canPaste: Boolean(internalClipboard.current?.nodes.length),
            canUndo: history.current.length > 0,
            flow: {
              x: (x - viewportRef.current.x) / viewportRef.current.zoom,
              y: (y - viewportRef.current.y) / viewportRef.current.zoom,
            },
            screen: { x, y },
          });
          setCreateMenu(undefined);
          setNodeContextMenu(undefined);
          setSourceConnectMenu(undefined);
          setUploadError("");
        }}
        onSelectionChange={({ nodes: selectedNodes }) => {
          if (!persistenceReady) return;
          if (workflowRetainedNodeIds.size > 0) {
            const retainedGroupIds = new Set(
              nodesRef.current
                .filter(
                  (node) =>
                    node.type === "group" &&
                    workflowRetainedNodeIds.has(node.id),
                )
                .map((node) => node.id),
            );
            const allowedSelectedNodes = selectedNodes.filter(
              (node) =>
                !workflowRetainedNodeIds.has(node.id) ||
                retainedGroupIds.has(node.id),
            );
            if (allowedSelectedNodes.length !== selectedNodes.length) {
              const allowedIds = new Set(
                allowedSelectedNodes.map((node) => node.id),
              );
              applyViewUpdate((current) =>
                current.map((node) =>
                  workflowRetainedNodeIds.has(node.id) &&
                  !allowedIds.has(node.id)
                    ? { ...node, selected: false }
                    : node,
                ),
              );
            }
            setPrimaryId(allowedSelectedNodes.at(-1)?.id);
            return;
          }
          setPrimaryId(selectedNodes.at(-1)?.id);
        }}
        onSelectionEnd={(event) => {
          const start = marqueeStart.current;
          marqueeStart.current = undefined;
          if (!start || !worldRef.current) return;
          const selection = {
            bottom: Math.max(start.y, event.clientY),
            left: Math.min(start.x, event.clientX),
            right: Math.max(start.x, event.clientX),
            top: Math.min(start.y, event.clientY),
          };
          const partiallySelectedGroupIds = new Set<string>();
          for (const element of worldRef.current.querySelectorAll<HTMLElement>(
            ".react-flow__node-group.selected",
          )) {
            const bounds = element.getBoundingClientRect();
            const fullyContained =
              bounds.left >= selection.left &&
              bounds.right <= selection.right &&
              bounds.top >= selection.top &&
              bounds.bottom <= selection.bottom;
            if (!fullyContained && element.dataset.id) {
              partiallySelectedGroupIds.add(element.dataset.id);
            }
          }
          if (partiallySelectedGroupIds.size === 0) return;
          applyViewUpdate((current) => current.map((node) =>
            partiallySelectedGroupIds.has(node.id)
              ? { ...node, selected: false }
              : node
          ));
        }}
        onViewportChange={(next) => {
          if (persistenceReady) handleViewportChange(next);
        }}
        panOnDrag={persistenceReady && (agentReferenceMode ? true : [1, 2])}
        panOnScroll={persistenceReady}
        panOnScrollSpeed={1.2}
        proOptions={{ hideAttribution: true }}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={persistenceReady && !agentReferenceMode}
        snapGrid={[20, 20]}
        snapToGrid={snapEnabled}
        zoomOnDoubleClick={false}
        zoomOnPinch={persistenceReady}
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
          <div
            className="tap-minimap-host"
            onWheel={(event) => {
              event.stopPropagation();
            }}
          >
            <MiniMap
              ariaLabel="小地图"
              className="tap-minimap"
              maskColor="rgba(0, 0, 0, 0.68)"
              nodeColor="#7a7a7a"
              nodeStrokeColor="#bdbdbd"
              onClick={handleMiniMapClick}
              pannable
              position="bottom-left"
            />
          </div>
        )}
      </ReactFlow>
      {effectivePersistenceLoadState !== "ready" && (
        <section
          aria-live={effectivePersistenceLoadState === "loading" ? "polite" : "assertive"}
          className="canvas-load-gate"
          data-error-kind={persistenceLoadFailure?.kind}
          data-state={effectivePersistenceLoadState}
          data-testid="canvas-load-state"
        >
          <div>
            <strong>
              {effectivePersistenceLoadState === "loading"
                ? "正在加载画布"
                : effectivePersistenceLoadState === "missing"
                  ? "项目不存在"
                  : "画布加载失败"}
            </strong>
            <span>
              {effectivePersistenceLoadState === "loading"
                ? "确认原内容前不会保存或生成。"
                : effectivePersistenceLoadState === "missing"
                  ? "该项目可能已被删除或不属于当前账号，没有创建空白画布。"
                  : persistenceLoadFailure?.message ??
                    "没有打开空白画布，也没有保存或生成。请检查连接后重试。"}
            </span>
            {effectivePersistenceLoadState === "failed" && (
              <div className="canvas-load-actions">
                {persistenceLoadFailure?.kind === "stale-save-session" && (
                  <button
                    data-testid="canvas-load-server-version"
                    onClick={() =>
                      window.open(
                        window.location.href,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    type="button"
                  >
                    打开服务器版本
                  </button>
                )}
                <button
                  className={
                    persistenceLoadFailure?.kind === "stale-save-session"
                      ? "is-secondary"
                      : undefined
                  }
                  data-testid="canvas-load-retry"
                  onClick={() =>
                    setPersistenceLoadAttempt((attempt) => attempt + 1)
                  }
                  type="button"
                >
                  重试加载
                </button>
              </div>
            )}
          </div>
        </section>
      )}
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
              disabled={workflowRetainedNodeIds.has(contextMenuNode.id)}
              onClick={() => {
                duplicateContextNode(contextMenuNode.id);
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
              disabled={workflowRetainedNodeIds.has(contextMenuNode.id)}
              onClick={() => {
                deleteNodeFromContextMenu(contextMenuNode.id);
                setNodeContextMenu(undefined);
              }}
              title={
                workflowRetainedNodeIds.has(contextMenuNode.id)
                  ? "整组执行中不能删除参与节点"
                  : undefined
              }
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
              disabled={workflowRetainedNodeIds.size > 0 || !blankContextMenu.canUndo}
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
                pasteInternalNode(blankContextMenu.flow);
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
                  (absolutePosition.x + width) * viewportRef.current.zoom +
                  viewportRef.current.x,
                y:
                  (absolutePosition.y + height / 2) * viewportRef.current.zoom +
                  viewportRef.current.y,
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
              applyViewUpdate((current) =>
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
      </div>
      </CanvasSelectionUiContext.Provider>
      </CanvasCheckpointContext.Provider>
      </CanvasGraphMutationContext.Provider>
      </WorkflowExecutionProvider>
      <UpdateNotice />
    </GenerationCanvasContext.Provider>
  );
}
