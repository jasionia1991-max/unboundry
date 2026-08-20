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
  useEdgesState,
  useNodes,
  useNodesState,
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
import { AudioNode } from "./AudioNode";
import {
  CanvasGraphMutationContext,
  tryCommitCanvasNodeAdoption,
} from "./CanvasGraphMutationContext";
import {
  CanvasCheckpointContext,
  closestEditableControl,
  useCanvasCheckpoint,
} from "./CanvasHistory";
import { CanvasSelectionUiContext } from "./CanvasSelectionContext";
import { GroupNode } from "./GroupNode";
import { ImageNode } from "./ImageNode";
import { discardImageAsset, uploadImageAsset } from "./imageAsset";
import { withImageReferenceInputMode } from "./imageReferenceMode";
import { PlaylistNode } from "./PlaylistNode";
import { ProbeNode, type ProbeNodeType } from "./ProbeNode";
import { hasInteractionProbeNodes } from "./probeFixtures";
import { StoryboardTableNode } from "./StoryboardTableNode";
import { plainTextHtml, TextNode } from "./TextNode";
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
import { GenerationCanvasContext } from "../generation/GenerationCanvasContext";
import { createGroupRunSummaryScope } from "../generation/groupRunSummary";
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
  parameterFieldEnabled,
  parameterOptionEnabled,
} from "../../../types/modelParameters";
import { normalizePersistedMediaNodes } from "../../../types/persistedMediaSources";
import { UpdateNotice } from "../updates/UpdateNotice";

const emptyNodes: ProbeNodeType[] = [];

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
      type:
        | "audio"
        | "group"
        | "image"
        | "playlist"
        | "storyboard"
        | "text"
        | "video";
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
const PERSIST_DEBOUNCE_MS = 500;
const PERSIST_LOAD_TIMEOUT_MS = 3_000;
const PERSIST_RETRY_MAX_MS = 30_000;
const PERSIST_SAVE_TIMEOUT_MS = 6_000;
const PERSIST_LOAD_TOKEN_MAX_LENGTH = 256;
const PERSIST_PAGEHIDE_MAX_BYTES = 60 * 1024;
const PERSIST_SAVE_JOURNAL_MAX_BYTES = 5_000_000;
const PERSIST_SAVE_SESSION_STORAGE_PREFIX =
  "unboundry:canvas-save-session:v2:";
const PERSIST_SAVE_SESSION_SCOPE_INDEX_KEY =
  "unboundry:canvas-save-session:v2:scopes";
export type CanvasLoadState = "failed" | "loading" | "missing" | "ready";
type CanvasLoadFailureKind =
  | "connection"
  | "invalid-response"
  | "stale-save-session"
  | "storage"
  | "unknown";
type CanvasLoadFailure = {
  kind: CanvasLoadFailureKind;
  message: string;
};
type LoadedCanvasDocument = {
  currentWriterSequence: number;
  currentWriterSessionId: string | null;
  edges: CuttableEdge[];
  graphRevision?: number;
  loadToken: string;
  nodes: ProbeNodeType[];
  revision: number;
  saveEpoch: string;
  sessionHighWaterAttemptId: string | null;
  sessionHighWaterSequence: number;
  viewport: Viewport;
};
type CanvasSaveFence = Pick<
  LoadedCanvasDocument,
  | "currentWriterSequence"
  | "currentWriterSessionId"
  | "saveEpoch"
  | "sessionHighWaterAttemptId"
  | "sessionHighWaterSequence"
>;
type CanvasPersistenceSnapshot = {
  edges: CuttableEdge[];
  fingerprint: string;
  graphFingerprint: string;
  nodes: ProbeNodeType[];
  viewport: Viewport;
};
type CanvasPendingSaveAttempt = {
  attemptId: string;
  document: CanvasPersistenceSnapshot;
  payload: string;
  rejectedByServer?: boolean;
  saveSequence: number;
};

class CanvasStaleSaveSessionError extends Error {
  constructor() {
    super("Canvas pending save belongs to an old server epoch");
    this.name = "CanvasStaleSaveSessionError";
  }
}

function canvasLoadFailure(error: unknown): CanvasLoadFailure {
  if (error instanceof CanvasStaleSaveSessionError) {
    return {
      kind: "stale-save-session",
      message:
        "检测到服务器重启前仍有一份未确认的本地保存，且内容与服务器版本不同。当前页会保留这份本地恢复副本；请打开服务器版本继续使用，系统不会覆盖任何一份内容。",
    };
  }
  if (error instanceof CanvasSaveSessionStorageError) {
    return {
      kind: "storage",
      message:
        "浏览器会话存储不可用，已停止画布保存和生成以保护数据。请恢复浏览器存储后重试。",
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("timed out") ||
    message.startsWith("Canvas load failed:") ||
    error instanceof TypeError
  ) {
    return {
      kind: "connection",
      message:
        "暂时无法从服务器读取画布。没有打开空白画布，也没有保存或生成；请检查连接后重试。",
    };
  }
  if (
    message.includes("invalid") ||
    message.includes("stale document") ||
    message.includes("save fence")
  ) {
    return {
      kind: "invalid-response",
      message:
        "服务器返回的画布数据不完整。为保护原内容，当前页没有保存或生成，请稍后重试。",
    };
  }
  return {
    kind: "unknown",
    message:
      "画布暂时无法安全打开。没有打开空白画布，也没有保存或生成，请重试。",
  };
}
type CanvasPendingPagehide = {
  attemptId: string;
  payload: string;
  saveSequence: number;
  serverEpoch: string;
};
type CanvasSaveSession = {
  confirmedSequence: number;
  pendingPagehide?: CanvasPendingPagehide;
  saveSequence: number;
  saveSessionId: string;
  serverEpoch?: string;
  storageRevision: number;
};

class CanvasSaveSessionStorageError extends Error {
  constructor(cause: unknown) {
    super("Canvas save session storage is unavailable", { cause });
    this.name = "CanvasSaveSessionStorageError";
  }
}

function isCanvasSaveAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value);
}

function isCanvasSaveEpoch(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value
  );
}

function isCanvasSaveSession(value: unknown): value is CanvasSaveSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<CanvasSaveSession>;
  const baseValid = (
    typeof session.saveSessionId === "string" &&
    /^[a-z0-9-]{8,80}$/i.test(session.saveSessionId) &&
    Number.isSafeInteger(session.confirmedSequence) &&
    Number(session.confirmedSequence) >= 0 &&
    Number.isSafeInteger(session.saveSequence) &&
    Number(session.saveSequence) >= Number(session.confirmedSequence) &&
    Number.isSafeInteger(session.storageRevision) &&
    Number(session.storageRevision) >= 0 &&
    (session.serverEpoch === undefined || isCanvasSaveEpoch(session.serverEpoch)) &&
    (session.pendingPagehide === undefined || (
      Boolean(session.pendingPagehide) &&
      typeof session.pendingPagehide === "object" &&
      isCanvasSaveAttemptId(session.pendingPagehide.attemptId) &&
      typeof session.pendingPagehide.payload === "string" &&
      new Blob([session.pendingPagehide.payload]).size <=
        PERSIST_SAVE_JOURNAL_MAX_BYTES &&
      Number.isSafeInteger(session.pendingPagehide.saveSequence) &&
      session.pendingPagehide.saveSequence > Number(session.confirmedSequence) &&
      session.pendingPagehide.saveSequence <= Number(session.saveSequence) &&
      isCanvasSaveEpoch(session.pendingPagehide.serverEpoch)
    ))
  );
  if (!baseValid) return false;
  return session.pendingPagehide
    ? session.pendingPagehide.saveSequence === session.saveSequence &&
        Number(session.pendingPagehide.saveSequence) >
          Number(session.confirmedSequence) &&
        session.pendingPagehide.serverEpoch === session.serverEpoch
    : session.saveSequence === session.confirmedSequence;
}

function canvasSaveSessionStorageKey(scopeId: string) {
  return `${PERSIST_SAVE_SESSION_STORAGE_PREFIX}${scopeId}`;
}

function loadCanvasSaveSession(scopeId: string): CanvasSaveSession {
  let stored: string | null;
  let storedScopeIndex: string | null;
  try {
    stored = window.sessionStorage.getItem(
      canvasSaveSessionStorageKey(scopeId),
    );
    storedScopeIndex = window.sessionStorage.getItem(
      PERSIST_SAVE_SESSION_SCOPE_INDEX_KEY,
    );
  } catch (error) {
    throw new CanvasSaveSessionStorageError(error);
  }
  let knownScopes: unknown = [];
  if (storedScopeIndex !== null) {
    try {
      knownScopes = JSON.parse(storedScopeIndex);
    } catch (error) {
      throw new CanvasSaveSessionStorageError(error);
    }
    if (
      !Array.isArray(knownScopes) ||
      !knownScopes.every((scope) => typeof scope === "string")
    ) {
      throw new CanvasSaveSessionStorageError(
        new Error("Canvas save session scope index is invalid"),
      );
    }
  }
  if (stored !== null) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (isCanvasSaveSession(parsed)) return parsed;
    } catch (error) {
      throw new CanvasSaveSessionStorageError(error);
    }
    throw new CanvasSaveSessionStorageError(
      new Error("Canvas save session is invalid"),
    );
  }
  if ((knownScopes as string[]).includes(scopeId)) {
    throw new CanvasSaveSessionStorageError(
      new Error("Canvas save session is missing for a known scope"),
    );
  }
  return {
    confirmedSequence: 0,
    saveSequence: 0,
    saveSessionId: crypto.randomUUID(),
    storageRevision: 0,
  };
}

function storeCanvasSaveSession(
  scopeId: string,
  session: CanvasSaveSession,
  resolvedPendingAttemptId?: string,
): CanvasSaveSession {
  try {
    const storageKey = canvasSaveSessionStorageKey(scopeId);
    const rawExisting = window.sessionStorage.getItem(storageKey);
    let existing: CanvasSaveSession | undefined;
    if (rawExisting !== null) {
      const parsed: unknown = JSON.parse(rawExisting);
      if (!isCanvasSaveSession(parsed)) {
        throw new Error("Canvas save session is invalid");
      }
      existing = parsed;
      if (existing.saveSessionId !== session.saveSessionId) {
        throw new Error("Canvas save session identity changed");
      }
      if (existing.storageRevision !== session.storageRevision) {
        throw new Error("Canvas save session changed outside this page");
      }
    }
    const rawScopes = window.sessionStorage.getItem(
      PERSIST_SAVE_SESSION_SCOPE_INDEX_KEY,
    );
    const scopes: unknown = rawScopes !== null ? JSON.parse(rawScopes) : [];
    if (
      !Array.isArray(scopes) ||
      !scopes.every((scope) => typeof scope === "string")
    ) {
      throw new Error("Canvas save session scope index is invalid");
    }
    if (!existing) {
      if (session.storageRevision !== 0 || scopes.includes(scopeId)) {
        throw new Error("Canvas save session is missing for a known scope");
      }
    }
    let pendingPagehide = session.pendingPagehide;
    if (
      existing?.pendingPagehide &&
      resolvedPendingAttemptId === existing.pendingPagehide.attemptId
    ) {
      if (session.confirmedSequence < existing.pendingPagehide.saveSequence) {
        throw new Error("Canvas pending save is not confirmed");
      }
      pendingPagehide = undefined;
    }
    if (
      existing?.pendingPagehide &&
      pendingPagehide === undefined &&
      resolvedPendingAttemptId !== existing.pendingPagehide.attemptId
    ) {
      throw new Error("Canvas pending save journal changed outside this page");
    }
    const merged: CanvasSaveSession = {
      confirmedSequence: session.confirmedSequence,
      ...(pendingPagehide ? { pendingPagehide } : {}),
      saveSequence: session.saveSequence,
      saveSessionId: session.saveSessionId,
      ...(session.serverEpoch ? { serverEpoch: session.serverEpoch } : {}),
      storageRevision: session.storageRevision + 1,
    };
    if (!isCanvasSaveSession(merged)) {
      throw new Error("Canvas save session merge is invalid");
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(merged));
    if (!scopes.includes(scopeId)) {
      window.sessionStorage.setItem(
        PERSIST_SAVE_SESSION_SCOPE_INDEX_KEY,
        JSON.stringify([...scopes, scopeId]),
      );
    }
    return merged;
  } catch (error) {
    throw new CanvasSaveSessionStorageError(error);
  }
}

function settleStoredCanvasSaveSession(
  scopeId: string,
  saveSessionId: string,
  saveSequence: number,
  attemptId: string,
  payload: string,
  serverEpoch: string,
) {
  try {
    const storageKey = canvasSaveSessionStorageKey(scopeId);
    const rawExisting = window.sessionStorage.getItem(storageKey);
    if (rawExisting === null) return undefined;
    const parsed: unknown = JSON.parse(rawExisting);
    if (!isCanvasSaveSession(parsed)) {
      throw new Error("Canvas save session is invalid");
    }
    const existing = parsed;
    if (existing.saveSessionId !== saveSessionId) return undefined;
    if (
      existing.pendingPagehide?.attemptId !== attemptId ||
      existing.pendingPagehide.saveSequence !== saveSequence ||
      existing.saveSequence !== saveSequence ||
      existing.pendingPagehide.payload !== payload ||
      existing.pendingPagehide.serverEpoch !== serverEpoch
    ) {
      return undefined;
    }
    const settled: CanvasSaveSession = {
      confirmedSequence: Math.max(existing.confirmedSequence, saveSequence),
      saveSequence: Math.max(existing.saveSequence, saveSequence),
      saveSessionId: existing.saveSessionId,
      ...(existing.serverEpoch ? { serverEpoch: existing.serverEpoch } : {}),
      storageRevision: existing.storageRevision + 1,
    };
    if (!isCanvasSaveSession(settled)) {
      throw new Error("Canvas save session settlement is invalid");
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(settled));
    return { previousStorageRevision: existing.storageRevision, settled };
  } catch (error) {
    throw new CanvasSaveSessionStorageError(error);
  }
}

function isCanvasLoadToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= PERSIST_LOAD_TOKEN_MAX_LENGTH &&
    value.trim() === value
  );
}

type CanvasSaveSuccess = {
  graphRevision: number;
  loadToken: string;
  revision: number;
};

type CanvasSaveRequestFence = {
  observedLoadToken?: string;
  revision: number;
};

function canvasSaveRequestFence(payload: string): CanvasSaveRequestFence | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const request = value as {
      observedLoadToken?: unknown;
      observedRevision?: unknown;
      revision?: unknown;
    };
    if (!Number.isSafeInteger(request.revision) || Number(request.revision) < 0) {
      return undefined;
    }
    if (request.observedLoadToken === undefined) {
      return { revision: Number(request.revision) };
    }
    if (
      !isCanvasLoadToken(request.observedLoadToken) ||
      request.observedRevision !== request.revision
    ) {
      return undefined;
    }
    return {
      observedLoadToken: request.observedLoadToken,
      revision: Number(request.revision),
    };
  } catch {
    return undefined;
  }
}

export function isCanvasSaveSuccess(
  value: unknown,
  requestFence: CanvasSaveRequestFence | undefined,
): value is CanvasSaveSuccess {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Partial<CanvasSaveSuccess>;
  return (
    Boolean(requestFence) &&
    Number.isSafeInteger(result.revision) &&
    Number(result.revision) > Number(requestFence?.revision) &&
    Number.isSafeInteger(result.graphRevision) &&
    Number(result.graphRevision) >= 0 &&
    Number(result.graphRevision) <= Number(result.revision) &&
    isCanvasLoadToken(result.loadToken) &&
    (
      requestFence?.observedLoadToken === undefined ||
      result.loadToken !== requestFence.observedLoadToken
    )
  );
}

function isCanvasSaveFence(value: unknown): value is CanvasSaveFence {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<CanvasSaveFence>;
  return (
    isCanvasSaveEpoch(document.saveEpoch) &&
    Number.isSafeInteger(document.sessionHighWaterSequence) &&
    Number(document.sessionHighWaterSequence) >= 0 &&
    (document.sessionHighWaterAttemptId === null ||
      isCanvasSaveAttemptId(document.sessionHighWaterAttemptId)) &&
    Number.isSafeInteger(document.currentWriterSequence) &&
    Number(document.currentWriterSequence) >= 0 &&
    (document.currentWriterSessionId === null ||
      isCanvasSaveAttemptId(document.currentWriterSessionId))
  );
}

export function isLoadedCanvasDocument(
  value: unknown,
): value is LoadedCanvasDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<LoadedCanvasDocument>;
  if (!isCanvasSaveFence(value)) return false;
  return (
    Array.isArray(document.edges) &&
    Array.isArray(document.nodes) &&
    isCanvasLoadToken(document.loadToken) &&
    Number.isSafeInteger(document.revision) &&
    Number(document.revision) >= 0 &&
    (document.graphRevision === undefined ||
      (Number.isSafeInteger(document.graphRevision) &&
        Number(document.graphRevision) >= 0 &&
        Number(document.graphRevision) <= Number(document.revision))) &&
    Boolean(document.viewport) &&
    [
      document.viewport?.x,
      document.viewport?.y,
      document.viewport?.zoom,
    ].every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    ) &&
    Number(document.viewport?.zoom) > 0
  );
}

function pendingPagehideSnapshot(
  pending: CanvasPendingPagehide,
  saveSessionId: string,
): CanvasPersistenceSnapshot | undefined {
  try {
    const parsed: unknown = JSON.parse(pending.payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const document = parsed as {
      edges?: unknown;
      nodes?: unknown;
      saveAttemptId?: unknown;
      saveSequence?: unknown;
      saveSessionId?: unknown;
      viewport?: { x?: unknown; y?: unknown; zoom?: unknown };
    };
    if (
      !Array.isArray(document.edges) ||
      !Array.isArray(document.nodes) ||
      document.saveAttemptId !== pending.attemptId ||
      document.saveSequence !== pending.saveSequence ||
      document.saveSessionId !== saveSessionId ||
      !document.viewport ||
      ![document.viewport.x, document.viewport.y, document.viewport.zoom]
        .every((coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate)
        ) ||
      Number(document.viewport.zoom) <= 0
    ) {
      return undefined;
    }
    const snapshot = {
      edges: document.edges as CuttableEdge[],
      nodes: normalizeCanvasParentLinks(
        normalizePersistedMediaNodes(document.nodes) as ProbeNodeType[],
      ),
      viewport: document.viewport as Viewport,
    };
    return {
      ...snapshot,
      fingerprint: canvasDocumentFingerprint(snapshot),
      graphFingerprint: canvasGraphFingerprint(snapshot),
    };
  } catch {
    return undefined;
  }
}
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
  const { setEdges } = useReactFlow<ProbeNodeType, CuttableEdge>();
  const { lockedNodeIds } = useWorkflowExecution();
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
            disabled={lockedNodeIds.has(source) || lockedNodeIds.has(target)}
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
    : new BroadcastChannel(`unboundry-canvas-sync:${scope}`);
}

function broadcastCanvasSaved(
  accountId: string,
  canvasId: string,
  revision: number,
  instanceId: string,
) {
  const channel = canvasSyncChannel(accountId, canvasId);
  if (!channel) return;
  channel.postMessage({ canvasId, instanceId, revision, type: "saved" });
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
  onGenerationRetryGateChange,
  onLoadStateChange,
  onOpenAssets,
  onProjectMissing,
  onReady,
  onSearchIndexChange,
  onSaveConflict,
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
  onSaveSuccess: () => void;
  onSaveStart: () => void;
  onZoomChange?: (zoom: number) => void;
  projectId?: string;
  shellMenuCommand?: CanvasShellMenuCommand;
  snapEnabled: boolean;
  textVideoStarted: boolean;
  viewportRequest?: { sequence: number; x?: number; y?: number; zoom: number };
}) {
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
  const [nodes, setNodesState] = useNodesState<ProbeNodeType>(
    interactive && !workflowFixture && !persistenceFixture
      ? createProbeNodes(fixtureId)
      : emptyNodes,
  );
  const [workflowRetainedNodeIds, setWorkflowRetainedNodeIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [edges, setEdgesState] = useEdgesState<CuttableEdge>(
    workflowFixture || persistenceFixture
      ? emptyEdges
      : createProbeEdges(fixtureId),
  );
  const renderedNodes = useMemo(
    () => {
      if (workflowRetainedNodeIds.size === 0) return nodes;
      return nodes.map((node) =>
        workflowRetainedNodeIds.has(node.id)
          ? {
              ...node,
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
    },
    [nodes, workflowRetainedNodeIds],
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
    const stored = loadCanvasSaveSession(persistenceScopeId);
    if (
      stored.saveSessionId !== persistenceSessionId.current ||
      stored.storageRevision !== persistenceStorageRevision.current
    ) {
      throw new CanvasSaveSessionStorageError(
        new Error("Canvas save session changed outside this page"),
      );
    }
  }, [persistenceScopeId]);
  const persistCanvasSaveSession = useCallback(
    (resolvedPendingAttemptId?: string) => {
      const stored = storeCanvasSaveSession(
        persistenceScopeId,
        currentCanvasSaveSession(),
        resolvedPendingAttemptId,
      );
      applyCanvasSaveSession(stored);
    },
    [applyCanvasSaveSession, currentCanvasSaveSession, persistenceScopeId],
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
    const payload = createPayload(saveSequence);
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
    const stored = storeCanvasSaveSession(persistenceScopeId, {
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
    const stored = storeCanvasSaveSession(
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
  }, [applyCanvasSaveSession, assertCanvasSaveSessionCurrent, persistenceScopeId]);
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
  const viewportRef = useRef(viewport);
  const pendingWheelViewport = useRef<Viewport | undefined>(undefined);
  const wheelViewportFrame = useRef<number | undefined>(undefined);
  const consumedFocusNodeSequence = useRef(0);
  const nodeDragging = useRef(false);
  const restoreSequence = useRef(0);
  const clipboardPasteSequence = useRef(0);
  const setNodes = useCallback<Dispatch<SetStateAction<ProbeNodeType[]>>>(
    (update) => {
      const hadPending = pendingGuardedNodes.current !== undefined;
      const base = pendingGuardedNodes.current ?? nodesRef.current;
      const next = typeof update === "function" ? update(base) : update;
      if (!hadPending && next === base) return;
      pendingGuardedNodes.current = next;
      setNodesState(next);
    },
    [setNodesState],
  );
  const setEdges = useCallback<Dispatch<SetStateAction<CuttableEdge[]>>>(
    (update) => {
      const hadPending = pendingGuardedEdges.current !== undefined;
      const base = pendingGuardedEdges.current ?? edgesRef.current;
      const next = typeof update === "function" ? update(base) : update;
      if (!hadPending && next === base) return;
      pendingGuardedEdges.current = next;
      setEdgesState(next);
    },
    [setEdgesState],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange<ProbeNodeType>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
    },
    [setNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<CuttableEdge>[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
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
    setNodes((current) =>
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
  }, [applyViewport, focusNodeRequest, persistenceReady, setNodes]);

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

  const scrubDuplicatedGenerationState = useCallback(
    (node: ProbeNodeType): ProbeNodeType => ({
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
    }),
    [],
  );
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
      fingerprint: canvasDocumentFingerprint(document),
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
      const title = titleValues.get(node.id);
      const textContent = textContentValues.get(node.id);
      const storedText = node.data.content ?? "";
      const bodyChanged = textContent !== undefined && !(
        textContent.content === storedText &&
        (textContent.contentHtml === undefined ||
          textContent.contentHtml === node.data.contentHtml ||
          (node.data.contentHtml === undefined &&
            textContent.contentHtml === plainTextHtml(storedText)))
      );
      if (
        (title === undefined || title === node.data.title) &&
        !bodyChanged
      ) {
        return node;
      }
      return {
        ...node,
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
    checkpoint();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...hydratedNodes,
    ]);
    setEdges((current) => [...current, ...appliedEdges]);
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
          if (latest.fingerprint !== persistedDocumentFingerprint.current) {
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
    checkpoint();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...duplicated.nodes.map((node) => ({
        ...node,
        selected: duplicated.rootIds.has(node.id),
      })),
    ]);
    setEdges((current) => [...current, ...duplicated.edges]);
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
  const deleteNodeFromContextMenu = (nodeId: string) => {
    const root = nodesRef.current.find((node) => node.id === nodeId);
    if (!root) return;
    const deletedIds = new Set([nodeId]);
    if (root.type === "group") {
      nodesRef.current.forEach((node) => {
        if (node.parentId === nodeId) deletedIds.add(node.id);
      });
    }
    if ([...deletedIds].some((id) => workflowRetainedNodeIds.has(id))) {
      showWorkflowToast("整组执行中，不能删除参与节点", "error");
      return;
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
    addDroppedLibraryAsset(historyAssetRequest.asset, {
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
  const uploadImage = async (file?: File) => {
    if (
      !persistenceReadyRef.current || !file ||
      !createMenu ||
      uploading
    ) {
      return;
    }
    setUploadError("");
    setUploading(true);
    const loadIdentity = { ...persistenceLoadIdentity.current };
    let createdAssetId: string | undefined;
    let adopted = false;
    try {
      const asset = await uploadImageAsset(file);
      createdAssetId = asset.assetId;
      if (
        !persistenceReadyRef.current ||
        persistenceLoadIdentity.current.epoch !== loadIdentity.epoch ||
        persistenceLoadIdentity.current.scopeId !== loadIdentity.scopeId
      ) {
        await discardImageAsset(asset.assetId);
        createdAssetId = undefined;
        return;
      }
      checkpoint();
      adopted = trySetNodes((current) => [
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
      ]);
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
    if (!persistenceReadyRef.current) return false;
    if (
      workflowRetainedNodeIds.has(connection.source) ||
      workflowRetainedNodeIds.has(connection.target)
    ) {
      showWorkflowToast("整组执行中，不能修改参与节点的连线", "error");
      return false;
    }
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
    if (!persistenceReadyRef.current) return;
    if (
      workflowRetainedNodeIds.has(targetId) ||
      sourceIds.some((sourceId) => workflowRetainedNodeIds.has(sourceId))
    ) {
      showWorkflowToast("整组执行中，不能修改参与节点的连线", "error");
      return;
    }
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
    if (textVideoStarted && persistenceReady) {
      setNodes(createProbeNodes("workflow.text-to-video.created"));
      setEdges(createProbeEdges("workflow.text-to-video.created"));
    }
  }, [persistenceReady, setEdges, setNodes, textVideoStarted]);

  useEffect(() => {
    const epoch = persistenceLoadIdentity.current.epoch + 1;
    persistenceLoadIdentity.current = { epoch, scopeId: persistenceScopeId };
    persistencePendingAttempt.current = undefined;
    if (persistenceFixture) {
      try {
        const saveSession = loadCanvasSaveSession(persistenceScopeId);
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
        setPersistenceLoadFailure(canvasLoadFailure(error));
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
      setPersistenceLoadFailure(canvasLoadFailure(error));
      setPersistenceLoadState("failed");
    };
    let timeout: number | undefined;
    const loadDeadline = new Promise<never>((_resolve, reject) => {
      timeout = window.setTimeout(() => {
        controller.abort("canvas-load-timeout");
        reject(new Error("Canvas load response timed out"));
      }, PERSIST_LOAD_TIMEOUT_MS);
    });
    const url = `/api/canvas/${persistenceId}`;
    const putHydrationDocument = async (
      body: string,
      timeoutReason: string,
    ) => {
      let mutationTimeout: number | undefined;
      try {
        return await Promise.race([
          (async () => {
            const response = await fetch(url, {
              body,
              headers: { "Content-Type": "application/json" },
              method: "PUT",
              signal: controller.signal,
            });
            const responseBody: unknown = await response.json();
            return { response, responseBody };
          })(),
          new Promise<never>((_resolve, reject) => {
            mutationTimeout = window.setTimeout(() => {
              reject(new Error(timeoutReason));
              controller.abort(timeoutReason);
            }, PERSIST_SAVE_TIMEOUT_MS);
          }),
        ]);
      } finally {
        window.clearTimeout(mutationTimeout);
      }
    };

    const load = async () => {
      try {
        const { response, responseBody } = await Promise.race([
          (async () => {
            const fetched = await fetch(url, {
              headers: {
                Accept: "application/json",
                "X-Unboundry-Canvas-Save-Session":
                  persistenceSessionId.current,
              },
              signal: controller.signal,
            });
            const body: unknown = await fetched.json();
            return { response: fetched, responseBody: body };
          })(),
          loadDeadline,
        ]);
        window.clearTimeout(timeout);
        timeout = undefined;
        if (!isCurrentLoad() || disposed) return;
        const missing = response.status === 404;
        if (!missing && !response.ok) {
          throw new Error(`Canvas load failed: ${response.status}`);
        }
        if (
          (missing && !isCanvasSaveFence(responseBody)) ||
          (!missing && !isLoadedCanvasDocument(responseBody))
        ) {
          throw new Error("Canvas load returned an invalid save fence");
        }
        const fence = responseBody as CanvasSaveFence;
        let document = missing
          ? undefined
          : responseBody as LoadedCanvasDocument;
        const pending = persistencePendingPagehide.current;
        const pendingSnapshot = pending
          ? pendingPagehideSnapshot(pending, persistenceSessionId.current)
          : undefined;
        if (pending && !pendingSnapshot) {
          throw new Error("Canvas pending pagehide journal is invalid");
        }
        const normalizedLoadedDocument = document
          ? {
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
            }
          : undefined;
        const highWaterProvesPending = Boolean(
          pending &&
          fence.sessionHighWaterSequence >= pending.saveSequence &&
          fence.sessionHighWaterAttemptId === pending.attemptId,
        );
        const currentWriterProvesPending = Boolean(
          pending &&
          pendingSnapshot &&
          normalizedLoadedDocument &&
          fence.currentWriterSessionId === persistenceSessionId.current &&
          fence.currentWriterSequence >= pending.saveSequence &&
          canvasDocumentFingerprint(normalizedLoadedDocument) ===
            pendingSnapshot.fingerprint,
        );
        const oldEpochDocumentProvesPending = Boolean(
          pending &&
          pendingSnapshot &&
          normalizedLoadedDocument &&
          pending.serverEpoch !== fence.saveEpoch &&
          canvasDocumentFingerprint(normalizedLoadedDocument) ===
            pendingSnapshot.fingerprint,
        );
        persistenceServerEpoch.current = fence.saveEpoch;
        persistenceSequenceFloor.current = Math.max(
          persistenceSequenceFloor.current,
          fence.sessionHighWaterSequence,
        );

        if (
          pending &&
          (highWaterProvesPending ||
            currentWriterProvesPending ||
            oldEpochDocumentProvesPending)
        ) {
          if (persistenceSaveSequence.current !== pending.saveSequence) {
            throw new Error("Canvas has an unconfirmed save after its journal");
          }
          persistenceConfirmedSaveSequence.current = Math.max(
            persistenceConfirmedSaveSequence.current,
            pending.saveSequence,
          );
          persistencePendingPagehide.current = undefined;
          persistCanvasSaveSession(pending.attemptId);
        } else if (pending) {
          if (!pendingSnapshot) {
            throw new Error("Canvas pending pagehide journal is invalid");
          }
          if (pending.serverEpoch !== fence.saveEpoch) {
            throw new CanvasStaleSaveSessionError();
          }
          const replaySequence = Math.max(
            persistenceSaveSequence.current,
            fence.sessionHighWaterSequence,
            pending.saveSequence,
          ) + 1;
          const replayAttemptId = crypto.randomUUID();
          const { payload: replayPayload } = reserveCanvasSaveAttempt(
            replayAttemptId,
            (candidateSequence) => JSON.stringify({
              edges: pendingSnapshot.edges,
              nodes: pendingSnapshot.nodes,
              ...(document
                ? {
                    observedLoadToken: document.loadToken,
                    observedRevision: document.revision,
                  }
                : {}),
              revision: document?.revision ?? 0,
              saveAttemptId: replayAttemptId,
              saveSequence: candidateSequence,
              saveSessionId: persistenceSessionId.current,
              viewport: pendingSnapshot.viewport,
            }),
            replaySequence,
          );
          rememberSentFingerprint(replaySequence, {
            attemptId: replayAttemptId,
            document: pendingSnapshot.fingerprint,
            graph: pendingSnapshot.graphFingerprint,
            liveEditors: true,
          });
          const {
            response: replayed,
            responseBody: replayResult,
          } = await putHydrationDocument(
            replayPayload,
            "Canvas pending replay response timed out",
          );
          if (!isCurrentLoad() || disposed) return;
          if (!replayed.ok) {
            throw new Error(`Canvas pending replay failed: ${replayed.status}`);
          }
          if (!isCanvasSaveSuccess(
            replayResult,
            canvasSaveRequestFence(replayPayload),
          )) {
            throw new Error("Canvas pending replay returned invalid data");
          }
          const result = replayResult;
          const replayedDocument: LoadedCanvasDocument = {
            currentWriterSequence: replaySequence,
            currentWriterSessionId: persistenceSessionId.current,
            edges: pendingSnapshot.edges,
            graphRevision: result.graphRevision,
            loadToken: result.loadToken,
            nodes: pendingSnapshot.nodes,
            revision: result.revision,
            saveEpoch: fence.saveEpoch,
            sessionHighWaterAttemptId: replayAttemptId,
            sessionHighWaterSequence: replaySequence,
            viewport: pendingSnapshot.viewport,
          };
          if (!isLoadedCanvasDocument(replayedDocument)) {
            throw new Error("Canvas pending replay returned invalid data");
          }
          persistenceConfirmedSaveSequence.current = replaySequence;
          persistencePendingPagehide.current = undefined;
          persistCanvasSaveSession(replayAttemptId);
          settleSentFingerprint(replaySequence, true);
          document = replayedDocument;
        } else if (
          persistenceSaveSequence.current >
            persistenceConfirmedSaveSequence.current
        ) {
          throw new Error("Canvas has an unconfirmed save without a journal");
        } else {
          // Bind a clean session to this process epoch before exposing the
          // canvas. Pagehide journaling must not use an unpersisted fence.
          persistCanvasSaveSession();
        }

        if (!document) {
          if (projectId) {
            persistenceReadyRef.current = false;
            setPersistenceLoadState("missing");
            onProjectMissing?.();
            return;
          }
          const attemptId = crypto.randomUUID();
          const initialEdges = createProbeEdges(persistenceId);
          const initialNodes = createProbeNodes(persistenceId);
          const { payload: initialPayload, saveSequence } =
            reserveCanvasSaveAttempt(
              attemptId,
              (candidateSequence) => JSON.stringify({
                edges: initialEdges,
                nodes: initialNodes,
                revision: 0,
                saveAttemptId: attemptId,
                saveSequence: candidateSequence,
                saveSessionId: persistenceSessionId.current,
                viewport,
              }),
            );
          const initial = {
            currentWriterSequence: saveSequence,
            currentWriterSessionId: persistenceSessionId.current,
            edges: initialEdges,
            graphRevision: 0,
            loadToken: "",
            nodes: initialNodes,
            revision: 0,
            saveAttemptId: attemptId,
            saveEpoch: fence.saveEpoch,
            saveSequence,
            saveSessionId: persistenceSessionId.current,
            sessionHighWaterAttemptId: attemptId,
            sessionHighWaterSequence: saveSequence,
            viewport,
          };
          rememberSentFingerprint(saveSequence, {
            attemptId,
            document: canvasDocumentFingerprint(initial),
            graph: canvasGraphFingerprint(initial),
            liveEditors: false,
          });
          const {
            response: created,
            responseBody: createdRevision,
          } = await putHydrationDocument(
            initialPayload,
            "Canvas create response timed out",
          );
          if (!isCurrentLoad() || disposed) return;
          if (!created.ok) {
            throw new Error(`Canvas create failed: ${created.status}`);
          }
          if (!isCanvasSaveSuccess(
            createdRevision,
            canvasSaveRequestFence(initialPayload),
          )) {
            throw new Error("Canvas create returned invalid data");
          }
          const createdDocument = {
            ...initial,
            ...createdRevision,
          };
          if (!isLoadedCanvasDocument(createdDocument)) {
            throw new Error("Canvas create returned invalid data");
          }
          document = createdDocument;
          persistenceConfirmedSaveSequence.current = saveSequence;
          persistCanvasSaveSession(attemptId);
          settleSentFingerprint(saveSequence, true);
        }

        if (!isCurrentLoad() || disposed) return;
        if (!isLoadedCanvasDocument(document)) {
          throw new Error("Canvas load returned an invalid document");
        }
        if (
          persistenceExternalRevision.current !== undefined &&
          document.revision < persistenceExternalRevision.current
        ) {
          throw new Error("Canvas load returned a stale document");
        }
        const hydratedDocument = {
          ...document,
          nodes: normalizeCanvasParentLinks(
            normalizePersistedMediaNodes(document.nodes),
          ),
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
        persistenceObservedRevision.current = document.revision;
        persistenceObservedLoadToken.current = document.loadToken;
        if (
          persistenceExternalRevision.current !== undefined &&
          persistenceExternalRevision.current <= document.revision
        ) {
          persistenceExternalRevision.current = undefined;
        }
        setConfirmedPersistenceRevision(document.revision);
        setConfirmedGraphRevision(graphRevision);
        persistenceConflict.current = false;
        persistenceDirty.current = false;
        persistedDocumentFingerprint.current = persistedFingerprint;
        persistedGraphFingerprint.current = graphFingerprint;
        setNodes(hydratedDocument.nodes);
        setEdges(hydratedDocument.edges);
        applyViewport(hydratedDocument.viewport);
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
      } finally {
        window.clearTimeout(timeout);
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
      window.clearTimeout(timeout);
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

  useEffect(() => {
    if (!persistenceFixture || !persistenceReady) {
      return;
    }
    const saveEpoch = persistenceLoadIdentity.current.epoch;
    const isCurrentCanvas = () =>
      persistenceLoadIdentity.current.scopeId === persistenceScopeId &&
      persistenceLoadIdentity.current.epoch === saveEpoch;
    if (persistenceConflict.current) {
      const latest = canvasSnapshot();
      if (latest.fingerprint !== persistedDocumentFingerprint.current) {
        persistenceQueued.current = latest;
        persistenceDirty.current = true;
      }
      return;
    }
    if (templateFitBlocksPersistence()) {
      // 镜头动画期间不触发保存调度，动画结束提交最终镜头时只保存一次；
      // 若 rAF 被节流/暂停导致动画迟迟不结束，超过硬性期限后放行保存，避免“保存中”卡死。
      return;
    }
    if (templateViewportAnimating.current) {
      templateViewportAnimating.current = false;
      templateFitHardStop.current = undefined;
    }

    // 交互安静期：拖动/缩放/平移期间跳过指纹与保存调度，
    // 停手 ≥250ms 后由 persistenceRecheckTick 重新触发本 effect。
    if (performance.now() - lastViewportInteractionAt.current < VIEWPORT_QUIET_MS) {
      window.clearTimeout(persistenceSaveTimer.current);
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
      if (templateFitBlocksPersistence()) {
        persistenceDirty.current = true;
        return;
      }
      if (persistenceSaving.current || persistenceConflict.current) return;
      if (
        persistenceObservedRevision.current === undefined ||
        !isCanvasLoadToken(persistenceObservedLoadToken.current)
      ) {
        persistenceQueued.current = canvasSnapshot();
        persistenceDirty.current = true;
        persistenceConflict.current = true;
        setConfirmedPersistenceRevision(undefined);
        setConfirmedGraphRevision(undefined);
        onSaveConflict("画布加载基线无效，已保留当前草稿，请刷新后重试");
        return;
      }
      const saveRun = ++persistenceSaveRun.current;
      persistenceSaving.current = true;
      let failed = false;
      let failureNotified = false;
      let externalReloadRequired = false;
      const reserveExternalDraft = (
        document: CanvasPersistenceSnapshot,
        liveEditors: boolean,
        readyToSend: boolean,
      ) => {
        const observedRevision = persistenceObservedRevision.current;
        const observedLoadToken = persistenceObservedLoadToken.current;
        if (
          observedRevision === undefined ||
          observedRevision !== persistenceRevision.current ||
          !isCanvasLoadToken(observedLoadToken)
        ) {
          throw new CanvasSaveSessionStorageError(
            new Error("Canvas external draft has no valid load fence"),
          );
        }
        const previousAttempt = persistencePendingAttempt.current;
        const attemptId = crypto.randomUUID();
        const { payload, saveSequence } = reserveCanvasSaveAttempt(
          attemptId,
          (candidateSequence) => JSON.stringify({
            edges: document.edges,
            nodes: document.nodes,
            observedLoadToken,
            observedRevision,
            revision: observedRevision,
            saveAttemptId: attemptId,
            saveSequence: candidateSequence,
            saveSessionId: persistenceSessionId.current,
            viewport: document.viewport,
          }),
        );
        const attempt = { attemptId, document, payload, saveSequence };
        persistencePendingAttempt.current = attempt;
        persistenceQueued.current = undefined;
        persistenceDirty.current = true;
        if (readyToSend) {
          rememberSentFingerprint(saveSequence, {
            attemptId,
            document: document.fingerprint,
            graph: document.graphFingerprint,
            liveEditors,
          });
        }
        if (
          previousAttempt &&
          previousAttempt.saveSequence !== saveSequence
        ) {
          settleSentFingerprint(previousAttempt.saveSequence, false);
        }
        return attempt;
      };
      const loadExternalBaseline = async (
        draft?: CanvasPersistenceSnapshot,
        draftUsesLiveEditors = false,
      ) => {
        if (draft) {
          try {
            // The old fence is still authoritative at this point. Reserve the
            // complete local draft before making it temporarily inaccessible
            // during the external GET. A failed GET can then be recovered by
            // the normal hydration journal replay after retry/refresh.
            reserveExternalDraft(draft, draftUsesLiveEditors, false);
          } catch (error) {
            if (!(error instanceof CanvasSaveSessionStorageError)) throw error;
            failed = true;
            persistenceReadyRef.current = false;
            setPersistenceLoadState("failed");
            stopForCanvasSaveSessionStorage();
            return false;
          }
        }
        persistenceReadyRef.current = false;
        setConfirmedPersistenceRevision(undefined);
        setConfirmedGraphRevision(undefined);
        setPersistenceLoadState("loading");
        const baselineController = new AbortController();
        persistenceSaveController.current = baselineController;
        let baselineTimeout: number | undefined;
        const baselineDeadline = new Promise<never>((_resolve, reject) => {
          baselineTimeout = window.setTimeout(() => {
            baselineController.abort("canvas-external-baseline-timeout");
            reject(new Error("Canvas external baseline response timed out"));
          }, PERSIST_LOAD_TIMEOUT_MS);
        });
        try {
          const { baseline, response } = await Promise.race([
            (async () => {
              const fetched = await fetch(`/api/canvas/${persistenceId}`, {
                headers: {
                  Accept: "application/json",
                  "X-Unboundry-Canvas-Save-Session":
                    persistenceSessionId.current,
                },
                signal: baselineController.signal,
              });
              const body: unknown = await fetched.json();
              return { baseline: body, response: fetched };
            })(),
            baselineDeadline,
          ]);
          if (
            !isCurrentCanvas() ||
            persistenceSaveRun.current !== saveRun
          ) return false;
          if (!response.ok) {
            throw new Error(`Canvas external baseline failed: ${response.status}`);
          }
          if (!isLoadedCanvasDocument(baseline)) {
            throw new Error("Canvas external baseline is invalid");
          }
          if (
            persistenceExternalRevision.current !== undefined &&
            baseline.revision < persistenceExternalRevision.current
          ) {
            throw new Error("Canvas external baseline is stale");
          }
          const hydratedBaseline = {
            ...baseline,
            nodes: normalizeCanvasParentLinks(
              normalizePersistedMediaNodes(baseline.nodes),
            ),
            edges: baseline.edges.map((edge) =>
              stripSelectionFlowMarkers(
                edge.style && typeof edge.style === "object"
                  ? { ...edge, style: undefined }
                  : edge,
              ),
            ),
          };
          const graphRevision = baseline.graphRevision ?? baseline.revision;
          persistenceRevision.current = baseline.revision;
          persistenceGraphRevision.current = graphRevision;
          persistenceObservedRevision.current = baseline.revision;
          persistenceObservedLoadToken.current = baseline.loadToken;
          persistenceServerEpoch.current = baseline.saveEpoch;
          raiseCanvasSaveSequenceFloor(baseline.sessionHighWaterSequence);
          if (draft) {
            // Replace the pre-GET journal in one strict-CAS write. The new
            // attempt carries the freshly observed revision/token, so the
            // queued local draft can never be sent against the stale fence.
            reserveExternalDraft(draft, draftUsesLiveEditors, true);
          } else {
            persistCanvasSaveSession();
          }
          persistedDocumentFingerprint.current =
            canvasDocumentFingerprint(hydratedBaseline);
          persistedGraphFingerprint.current =
            canvasGraphFingerprint(hydratedBaseline);
          setConfirmedPersistenceRevision(baseline.revision);
          setConfirmedGraphRevision(graphRevision);
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current <= baseline.revision
          ) {
            persistenceExternalRevision.current = undefined;
          }
          persistenceReadyRef.current = true;
          setPersistenceLoadState("ready");
          return true;
        } catch (error) {
          if (
            !isCurrentCanvas() ||
            persistenceSaveRun.current !== saveRun
          ) return false;
          failed = true;
          persistenceConflict.current = true;
          persistenceObservedRevision.current = undefined;
          persistenceObservedLoadToken.current = undefined;
          setConfirmedPersistenceRevision(undefined);
          setConfirmedGraphRevision(undefined);
          persistenceReadyRef.current = false;
          setPersistenceLoadState("failed");
          if (error instanceof CanvasSaveSessionStorageError) {
            stopForCanvasSaveSessionStorage();
          } else {
            onSaveConflict(
              "检测到其他页面的新版本，但无法安全读取；已保留当前草稿，请刷新后重试",
            );
          }
          return false;
        } finally {
          window.clearTimeout(baselineTimeout);
          if (persistenceSaveController.current === baselineController) {
            persistenceSaveController.current = undefined;
          }
        }
      };
      const reconcileExternalBaseline = async () => {
        const externalRevision = persistenceExternalRevision.current;
        if (
          externalRevision === undefined ||
          externalRevision <= (persistenceObservedRevision.current ?? -1)
        ) {
          return true;
        }

        const latestDraft = canvasSnapshot();
        const pendingAttempt = persistencePendingAttempt.current;
        const comparisonFingerprint = pendingAttempt
          ? pendingAttempt.document.fingerprint
          : persistedDocumentFingerprint.current;
        if (latestDraft.fingerprint === comparisonFingerprint) {
          if (pendingAttempt && !pendingAttempt.rejectedByServer) {
            failed = true;
            persistenceConflict.current = true;
            persistenceQueued.current = latestDraft;
            persistenceDirty.current = true;
            onSaveConflict(
              "保存结果尚未确认，已保留当前草稿，请刷新后重试",
            );
            return false;
          }
          if (pendingAttempt) {
            try {
              settleCanvasSaveSequence(
                pendingAttempt.saveSequence,
                pendingAttempt.attemptId,
              );
            } catch (error) {
              if (!(error instanceof CanvasSaveSessionStorageError)) {
                throw error;
              }
              failed = true;
              stopForCanvasSaveSessionStorage();
              return false;
            }
          }
          persistencePendingAttempt.current = undefined;
          persistenceQueued.current = undefined;
          persistenceDirty.current = false;
          externalReloadRequired = true;
          return false;
        }

        persistencePendingAttempt.current = undefined;
        persistenceQueued.current = latestDraft;
        persistenceDirty.current = true;
        return loadExternalBaseline(latestDraft);
      };
      try {
        while (
          (persistencePendingAttempt.current || persistenceQueued.current) &&
          !persistenceConflict.current
        ) {
          if (!isCurrentCanvas()) break;
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current >
              (persistenceObservedRevision.current ?? -1) &&
            !(await reconcileExternalBaseline())
          ) {
            break;
          }
          if (templateFitBlocksPersistence()) {
            persistenceDirty.current = true;
            break;
          }
          let attempt = persistencePendingAttempt.current;
          if (!attempt) {
            const document = persistenceQueued.current;
            if (!document) break;
            persistenceQueued.current = undefined;
            const attemptId = crypto.randomUUID();
            let reserved: { payload: string; saveSequence: number };
            try {
              reserved = reserveCanvasSaveAttempt(
                attemptId,
                (saveSequence) => JSON.stringify({
                  edges: document.edges,
                  nodes: document.nodes,
                  observedRevision: persistenceObservedRevision.current,
                  observedLoadToken: persistenceObservedLoadToken.current,
                  revision: persistenceRevision.current,
                  saveAttemptId: attemptId,
                  saveSequence,
                  saveSessionId: persistenceSessionId.current,
                  viewport: document.viewport,
                }),
              );
            } catch (error) {
              if (!(error instanceof CanvasSaveSessionStorageError)) throw error;
              failed = true;
              stopForCanvasSaveSessionStorage();
              break;
            }
            const { payload, saveSequence } = reserved;
            attempt = { attemptId, document, payload, saveSequence };
            persistencePendingAttempt.current = attempt;
            rememberSentFingerprint(saveSequence, {
              attemptId,
              document: document.fingerprint,
              graph: document.graphFingerprint,
              liveEditors: false,
            });
          }
          const { attemptId, document, payload, saveSequence } = attempt;
          persistenceInFlightFingerprint.current = document.fingerprint;
          const saveController = new AbortController();
          persistenceSaveController.current = saveController;
          let saveTimeout: number | undefined;
          let response: Response;
          let responseBody: unknown = {};
          try {
            const result = await Promise.race([
              (async () => {
                const fetched = await fetch(`/api/canvas/${persistenceId}`, {
                  body: payload,
                  headers: { "Content-Type": "application/json" },
                  method: "PUT",
                  signal: saveController.signal,
                });
                const serializedResponse = await fetched.text();
                let parsed: unknown = {};
                if (serializedResponse) {
                  try {
                    parsed = JSON.parse(serializedResponse) as unknown;
                  } catch {
                    parsed = {};
                  }
                }
                return { body: parsed, response: fetched };
              })(),
              new Promise<never>((_resolve, reject) => {
                saveTimeout = window.setTimeout(() => {
                  saveController.abort("canvas-save-timeout");
                  reject(new Error("Canvas save response timed out"));
                }, PERSIST_SAVE_TIMEOUT_MS);
              }),
            ]);
            response = result.response;
            responseBody = result.body;
          } finally {
            window.clearTimeout(saveTimeout);
            if (persistenceSaveController.current === saveController) {
              persistenceSaveController.current = undefined;
            }
          }
          if (!isCurrentCanvas()) return;
          if (!response.ok) attempt.rejectedByServer = true;
          if (response.status === 409) {
            persistencePendingAttempt.current = undefined;
            const parsedConflict = responseBody;
            const conflict: {
              code?: string;
              currentGraphRevision?: number;
              currentRevision?: number;
              currentWriterSequence?: number;
              currentWriterSessionId?: string | null;
              error?: string;
              rejectedAttemptId?: string | null;
              rejectedSequence?: number;
              rejectedSessionId?: string;
              sessionHighWaterAttemptId?: string | null;
              sessionHighWaterSequence?: number;
            } = parsedConflict && typeof parsedConflict === "object"
              ? parsedConflict as {
                  code?: string;
                  currentGraphRevision?: number;
                  currentRevision?: number;
                  currentWriterSequence?: number;
                  currentWriterSessionId?: string | null;
                  error?: string;
                  rejectedAttemptId?: string | null;
                  rejectedSequence?: number;
                  rejectedSessionId?: string;
                  sessionHighWaterAttemptId?: string | null;
                  sessionHighWaterSequence?: number;
                }
              : {};
            const validSupersededEnvelope =
              conflict.code === "CANVAS_SAVE_SUPERSEDED" &&
              conflict.rejectedSessionId === persistenceSessionId.current &&
              conflict.rejectedSequence === saveSequence &&
              conflict.rejectedAttemptId === attemptId &&
              Number.isSafeInteger(conflict.sessionHighWaterSequence) &&
              Number(conflict.sessionHighWaterSequence) >= saveSequence &&
              (conflict.sessionHighWaterAttemptId === null ||
                isCanvasSaveAttemptId(conflict.sessionHighWaterAttemptId)) &&
              (conflict.currentWriterSessionId === null ||
                typeof conflict.currentWriterSessionId === "string") &&
              Number.isSafeInteger(conflict.currentWriterSequence) &&
              Number(conflict.currentWriterSequence) >= 0 &&
              Number.isSafeInteger(conflict.currentRevision) &&
              Number(conflict.currentRevision) >= 0 &&
              Number.isSafeInteger(conflict.currentGraphRevision) &&
              Number(conflict.currentGraphRevision) >= 0 &&
              Number(conflict.currentGraphRevision) <=
                Number(conflict.currentRevision);
            const highWaterSequence = Number(
              conflict.sessionHighWaterSequence,
            );
            const mappedHighWaterFingerprint = validSupersededEnvelope
              ? persistenceSentFingerprints.current.get(highWaterSequence)
              : undefined;
            const highWaterFingerprint =
              mappedHighWaterFingerprint?.attemptId ===
                  conflict.sessionHighWaterAttemptId
                ? mappedHighWaterFingerprint
                : undefined;
            const currentWriterIsThisTab =
              validSupersededEnvelope &&
              conflict.currentWriterSessionId === persistenceSessionId.current;
            const canBindThisTabWriter =
              currentWriterIsThisTab &&
              conflict.currentWriterSequence === highWaterSequence &&
              Boolean(highWaterFingerprint);

            if (validSupersededEnvelope && highWaterFingerprint) {
              try {
                const durableAttemptId =
                  persistencePendingPagehide.current?.attemptId;
                const resolvedAttemptId =
                  durableAttemptId === conflict.sessionHighWaterAttemptId
                    ? conflict.sessionHighWaterAttemptId ?? undefined
                    : durableAttemptId === attemptId
                      ? attemptId
                      : undefined;
                settleCanvasSaveSequence(
                  highWaterSequence,
                  resolvedAttemptId,
                );
              } catch (error) {
                if (!(error instanceof CanvasSaveSessionStorageError)) {
                  throw error;
                }
                failed = true;
                stopForCanvasSaveSessionStorage();
                break;
              }
              settleSentFingerprint(highWaterSequence, true);
              if (saveSequence !== highWaterSequence) {
                settleSentFingerprint(saveSequence, false);
              }
            } else {
              settleSentFingerprint(saveSequence, false);
            }

            if (canBindThisTabWriter && highWaterFingerprint) {
              const latest = highWaterFingerprint.liveEditors
                ? canvasSnapshotWithLiveEditors()
                : canvasSnapshot();
              persistenceExternalRevision.current = Math.max(
                persistenceExternalRevision.current ?? 0,
                Number(conflict.currentRevision),
              );
              const localDraft =
                latest.fingerprint === highWaterFingerprint.document
                  ? undefined
                  : latest;
              if (!(await loadExternalBaseline(
                localDraft,
                highWaterFingerprint.liveEditors,
              ))) break;
              const serverMatchesHighWater =
                persistedDocumentFingerprint.current ===
                  highWaterFingerprint.document &&
                persistedGraphFingerprint.current === highWaterFingerprint.graph;
              if (
                serverMatchesHighWater &&
                latest.fingerprint === highWaterFingerprint.document
              ) {
                persistenceQueued.current = undefined;
                persistenceDirty.current = false;
              } else {
                persistenceQueued.current = latest;
                persistenceDirty.current = true;
              }
            } else if (
              validSupersededEnvelope &&
              !currentWriterIsThisTab &&
              highWaterFingerprint
            ) {
              const latest = highWaterFingerprint.liveEditors
                ? canvasSnapshotWithLiveEditors()
                : canvasSnapshot();
              persistenceExternalRevision.current = Math.max(
                persistenceExternalRevision.current ?? 0,
                Number(conflict.currentRevision),
              );
              if (latest.fingerprint === highWaterFingerprint.document) {
                persistenceRevision.current = Number(conflict.currentRevision);
                persistenceGraphRevision.current = Number(
                  conflict.currentGraphRevision,
                );
                persistenceObservedRevision.current = undefined;
                persistenceObservedLoadToken.current = undefined;
                setConfirmedPersistenceRevision(undefined);
                setConfirmedGraphRevision(undefined);
                persistenceQueued.current = undefined;
                persistenceDirty.current = false;
                externalReloadRequired = true;
              } else {
                // Keep the still-valid old fence long enough to durably reserve
                // the newer local draft. loadExternalBaseline atomically rebases
                // that journal onto the foreign writer's authoritative GET.
                if (!(await loadExternalBaseline(
                  latest,
                  highWaterFingerprint.liveEditors,
                ))) break;
                persistenceQueued.current = latest;
                persistenceDirty.current = true;
              }
            } else if (
              validSupersededEnvelope &&
              isCanvasSaveAttemptId(conflict.sessionHighWaterAttemptId)
            ) {
              try {
                raiseCanvasSaveSequenceFloor(highWaterSequence);
              } catch (error) {
                if (!(error instanceof CanvasSaveSessionStorageError)) {
                  throw error;
                }
                failed = true;
                stopForCanvasSaveSessionStorage();
                break;
              }
              const latest = canvasSnapshot();
              persistenceExternalRevision.current = Math.max(
                persistenceExternalRevision.current ?? 0,
                Number(conflict.currentRevision),
              );
              if (!(await loadExternalBaseline(latest))) break;
              persistenceQueued.current = latest;
              persistenceDirty.current = true;
            } else {
              failed = true;
              persistenceConflict.current = true;
              setConfirmedPersistenceRevision(undefined);
              setConfirmedGraphRevision(undefined);
              persistenceQueued.current = canvasSnapshot();
              persistenceDirty.current = true;
              const projectUnavailable =
                conflict.code === "CANVAS_PROJECT_DELETED" ||
                conflict.code === "CANVAS_PROJECT_NOT_OWNED";
              if (projectUnavailable) {
                persistenceReadyRef.current = false;
                persistenceObservedRevision.current = undefined;
                persistenceObservedLoadToken.current = undefined;
                setPersistenceLoadState("missing");
                onProjectMissing?.();
              }
              const fallback = conflict.code === "CANVAS_LOAD_REQUIRED"
                ? "画布加载基线已失效，已保留当前草稿，请刷新后重试"
                : projectUnavailable
                  ? "项目已不存在或不属于当前账号，当前草稿未被覆盖"
                  : "保存响应无法安全确认，已保留当前草稿，请刷新后重试";
              onSaveConflict(conflict.error?.trim() || fallback);
              break;
            }
          } else if (response.status === 503) {
            const parsedUnavailable = responseBody;
            const unavailable: { code?: string; error?: string } =
              parsedUnavailable && typeof parsedUnavailable === "object"
              ? parsedUnavailable as { code?: string; error?: string }
              : {};
            if (unavailable.code === "CANVAS_SAVE_SESSION_CAPACITY") {
              persistencePendingAttempt.current = undefined;
              settleSentFingerprint(saveSequence, false);
              failed = true;
              persistenceConflict.current = true;
              setConfirmedPersistenceRevision(undefined);
              setConfirmedGraphRevision(undefined);
              persistenceQueued.current = canvasSnapshot();
              persistenceDirty.current = true;
              onSaveConflict(
                unavailable.error?.trim() ||
                  "当前画布保存会话过多，已保留草稿，请刷新后重试",
              );
              break;
            }
            failed = true;
            if (!failureNotified) {
              failureNotified = true;
              onSaveConflict("保存失败，请检查网络，正在自动重试");
            }
            persistenceQueued.current = canvasSnapshot();
            break;
          } else if (
            response.status === 408 ||
            response.status === 425 ||
            response.status === 429 ||
            response.status >= 500
          ) {
            failed = true;
            if (!failureNotified) {
              failureNotified = true;
              onSaveConflict("保存失败，请检查网络，正在自动重试");
            }
            persistenceQueued.current = canvasSnapshot();
            break;
          } else if (!response.ok) {
            const parsedRejection = responseBody;
            const rejected: { error?: string } =
              parsedRejection && typeof parsedRejection === "object"
              ? parsedRejection as { error?: string }
              : {};
            persistencePendingAttempt.current = undefined;
            settleSentFingerprint(saveSequence, false);
            failed = true;
            persistenceConflict.current = true;
            setConfirmedPersistenceRevision(undefined);
            setConfirmedGraphRevision(undefined);
            persistenceQueued.current = canvasSnapshot();
            persistenceDirty.current = true;
            onSaveConflict(
              rejected.error?.trim() ||
                `保存请求被拒绝（${response.status}），已保留当前草稿，请刷新后重试`,
            );
            break;
          } else {
            const requestFence = canvasSaveRequestFence(payload);
            const saveResult = responseBody;
            if (
              !isCanvasSaveSuccess(saveResult, requestFence)
            ) {
              throw new Error("Canvas save returned an invalid revision");
            }
            const { graphRevision, loadToken, revision } = saveResult;
            if (
              saveSequence <= persistenceConfirmedSaveSequence.current
            ) {
              settleSentFingerprint(saveSequence, false);
              if (
                revision > persistenceRevision.current ||
                (revision === persistenceRevision.current &&
                  (graphRevision !== persistenceGraphRevision.current ||
                    loadToken !== persistenceObservedLoadToken.current))
              ) {
                failed = true;
                persistenceConflict.current = true;
                persistenceQueued.current = canvasSnapshot();
                persistenceDirty.current = true;
                setConfirmedPersistenceRevision(undefined);
                setConfirmedGraphRevision(undefined);
                onSaveConflict(
                  "保存响应顺序异常，已保留当前草稿，请刷新后重试",
                );
                break;
              }
              persistencePendingAttempt.current = undefined;
            } else {
              persistencePendingAttempt.current = undefined;
              persistenceRevision.current = revision;
              persistenceGraphRevision.current = graphRevision;
              persistenceObservedRevision.current = revision;
              persistenceObservedLoadToken.current = loadToken;
              persistenceConfirmedSaveSequence.current = Math.max(
                persistenceConfirmedSaveSequence.current,
                saveSequence,
              );
              if (
                persistencePendingPagehide.current?.attemptId === attemptId &&
                persistencePendingPagehide.current.saveSequence <= saveSequence
              ) {
                persistencePendingPagehide.current = undefined;
              }
              persistCanvasSaveSession(attemptId);
              settleSentFingerprint(saveSequence, true);
              if (
                persistenceExternalRevision.current !== undefined &&
                persistenceExternalRevision.current <= revision
              ) {
                persistenceExternalRevision.current = undefined;
              }
              persistenceRetryDelay.current = 1_000;
              setConfirmedPersistenceRevision(revision);
              setConfirmedGraphRevision(graphRevision);
              broadcastCanvasSaved(
                accountId ?? "",
                persistenceId,
                revision,
                persistenceBroadcastInstanceId.current,
              );
              persistedDocumentFingerprint.current = document.fingerprint;
              persistedGraphFingerprint.current = document.graphFingerprint;
            }
          }

          if (externalReloadRequired) break;
          const latest = canvasSnapshot();
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current > persistenceRevision.current &&
            latest.fingerprint === persistedDocumentFingerprint.current
          ) {
            persistenceQueued.current = undefined;
            persistenceDirty.current = false;
            externalReloadRequired = true;
            break;
          }
          if (latest.fingerprint !== persistedDocumentFingerprint.current) {
            persistenceQueued.current = latest;
            persistenceDirty.current = true;
          } else {
            persistenceQueued.current = undefined;
            persistenceDirty.current = false;
          }
        }
      } catch (error) {
        if (!isCurrentCanvas()) return;
        if (error instanceof CanvasSaveSessionStorageError) {
          failed = true;
          stopForCanvasSaveSessionStorage();
          return;
        }
        failed = true;
        persistenceQueued.current = canvasSnapshot();
        if (!failureNotified) {
          failureNotified = true;
          onSaveConflict("保存失败，请检查网络，正在自动重试");
        }
      } finally {
        if (persistenceSaveRun.current !== saveRun) return;
        persistenceInFlightFingerprint.current = undefined;
        persistenceSaving.current = false;
        if (!isCurrentCanvas()) {
          if (
            persistenceReadyRef.current &&
            !persistenceConflict.current &&
            persistenceQueued.current
          ) {
            queueMicrotask(() => drainPersistenceQueueRef.current());
          }
          return;
        }
        drainPersistenceQueueRef.current = drainPersistenceQueue;
        if (
          !failed &&
          !persistenceConflict.current &&
          externalReloadRequired &&
          !persistenceQueued.current
        ) {
          persistenceDirty.current = false;
          persistenceReadyRef.current = false;
          setPersistenceLoadState("loading");
          window.location.reload();
        } else if (
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
          if (
            persistenceExternalRevision.current !== undefined &&
            persistenceExternalRevision.current >
              (persistenceObservedRevision.current ?? -1)
          ) {
            queueMicrotask(() => void drainPersistenceQueue());
          } else {
            const retryDelay = persistenceRetryDelay.current;
            persistenceRetryDelay.current = Math.min(
              persistenceRetryDelay.current * 2,
              PERSIST_RETRY_MAX_MS,
            );
            persistenceSaveTimer.current = window.setTimeout(
              () => void drainPersistenceQueue(),
              retryDelay,
            );
          }
        }
      }
    };

    // 硬性截止兜底必须始终指向当前保存器；首次定时保存若被动画闸门挡住，
    // 1600ms 后仍能把最终文档写入，而不是调用初始化时的空函数。
    drainPersistenceQueueRef.current = drainPersistenceQueue;
    persistenceSaveTimer.current = window.setTimeout(() => {
      // 节点/边变化会在动画真正启动前预约此 timer；执行时必须再次检查，
      // 否则会在 800ms 镜头动画中连续保存每一个中间 viewport。
      if (templateFitBlocksPersistence()) {
        persistenceDirty.current = true;
        return;
      }
      persistenceQueued.current = canvasSnapshot();
      void drainPersistenceQueue();
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(persistenceSaveTimer.current);
  }, [
    canvasSnapshot,
    canvasSnapshotWithLiveEditors,
    edges,
    nodes,
    onProjectMissing,
    onSaveConflict,
    onSaveSuccess,
    onSaveStart,
    persistenceFixture,
    persistenceId,
    persistenceReady,
    persistenceRecheckTick,
    persistenceScopeId,
    persistCanvasSaveSession,
    reserveCanvasSaveAttempt,
    raiseCanvasSaveSequenceFloor,
    rememberSentFingerprint,
    settleCanvasSaveSequence,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
    templateFitBlocksPersistence,
    viewport,
  ]);

  useEffect(() => {
    const hasPendingChanges = () =>
      persistenceDirty.current ||
      persistenceSaving.current ||
      pendingGuardedNodes.current !== undefined ||
      pendingGuardedEdges.current !== undefined ||
      Boolean(persistencePendingAttempt.current) ||
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
    if (!persistenceFixture) return;
    const channel = canvasSyncChannel(accountId ?? "", persistenceId);
    if (!channel) return;
    const onExternalSave = (event: MessageEvent) => {
      const data = event.data as
        | {
            canvasId?: string;
            instanceId?: string;
            revision?: number;
            type?: string;
          }
        | undefined;
      if (
        !data ||
        data.type !== "saved" ||
        data.canvasId !== persistenceId ||
        data.instanceId === persistenceBroadcastInstanceId.current ||
        !Number.isSafeInteger(data.revision) ||
        Number(data.revision) < 0
      ) {
        return;
      }
      persistenceExternalRevision.current = Math.max(
        persistenceExternalRevision.current ?? 0,
        Number(data.revision),
      );
      if (!persistenceReadyRef.current) return;
      const latest = canvasSnapshotRef.current();
      if (
        persistenceDirty.current ||
        persistenceSaving.current ||
        persistenceQueued.current ||
        latest.fingerprint !== persistedDocumentFingerprint.current
      ) {
        if (latest.fingerprint !== persistedDocumentFingerprint.current) {
          persistenceQueued.current = latest;
          persistenceDirty.current = true;
        }
        if (!persistenceSaving.current && !persistenceConflict.current) {
          window.clearTimeout(persistenceSaveTimer.current);
          queueMicrotask(() => drainPersistenceQueueRef.current());
        }
        return;
      }
      persistenceReadyRef.current = false;
      setPersistenceLoadState("loading");
      window.location.reload();
    };
    channel.addEventListener("message", onExternalSave);
    return () => {
      channel.removeEventListener("message", onExternalSave);
      channel.close();
    };
  }, [accountId, persistenceFixture, persistenceId]);

  useEffect(() => {
    if (!persistenceFixture || !persistenceReady) return;
    const flushBeforeReload = () => {
      persistenceBfCacheReloadSafe.current = false;
      if (
        !persistenceReadyRef.current ||
        persistenceObservedRevision.current === undefined ||
        !isCanvasLoadToken(persistenceObservedLoadToken.current) ||
        (persistenceExternalRevision.current !== undefined &&
          persistenceExternalRevision.current >
            persistenceObservedRevision.current)
      ) {
        return;
      }
      const latest = canvasSnapshotWithLiveEditors();
      const inFlightAttempt = persistencePendingAttempt.current;
      const unresolvedInFlightSave =
        persistenceSaving.current &&
        (!inFlightAttempt ||
          inFlightAttempt.saveSequence >
            persistenceConfirmedSaveSequence.current);
      if (
        persistenceConflict.current ||
        (latest.fingerprint === persistedDocumentFingerprint.current &&
          !unresolvedInFlightSave)
      ) {
        if (!persistenceConflict.current) {
          persistenceBfCacheReloadSafe.current = true;
        }
        return;
      }
      window.clearTimeout(persistenceSaveTimer.current);
      // keepalive 有约 64KB 的浏览器硬上限，超限会直接失败；
      // 页面卸载时的兜底保存只在小负载下尽力而为，大负载依赖常规防抖保存。
      const pendingAttempt = persistencePendingAttempt.current;
      let attemptId: string;
      let payload: string;
      let saveSequence: number;
      if (
        pendingAttempt &&
        latest.fingerprint === pendingAttempt.document.fingerprint
      ) {
        attemptId = pendingAttempt.attemptId;
        payload = pendingAttempt.payload;
        saveSequence = pendingAttempt.saveSequence;
      } else {
        attemptId = crypto.randomUUID();
        let reserved: { payload: string; saveSequence: number };
        try {
          reserved = reserveCanvasSaveAttempt(
            attemptId,
            (candidateSequence) => JSON.stringify({
              edges: latest.edges,
              nodes: latest.nodes,
              observedRevision: persistenceObservedRevision.current,
              observedLoadToken: persistenceObservedLoadToken.current,
              revision: persistenceRevision.current,
              saveAttemptId: attemptId,
              saveSequence: candidateSequence,
              saveSessionId: persistenceSessionId.current,
              viewport: latest.viewport,
            }),
          );
        } catch (error) {
          if (error instanceof CanvasSaveSessionStorageError) {
            stopForCanvasSaveSessionStorage();
            return;
          }
          throw error;
        }
        ({ payload, saveSequence } = reserved);
        rememberSentFingerprint(saveSequence, {
          attemptId,
          document: latest.fingerprint,
          graph: latest.graphFingerprint,
          liveEditors: true,
        });
      }
      const journal = persistencePendingPagehide.current;
      if (
        journal?.attemptId !== attemptId ||
        journal.payload !== payload ||
        journal.saveSequence !== saveSequence
      ) {
        stopForCanvasSaveSessionStorage();
        return;
      }
      persistenceBfCacheReloadSafe.current = true;
      if (new Blob([payload]).size <= PERSIST_PAGEHIDE_MAX_BYTES) {
        const saveSessionId = persistenceSessionId.current;
        const expectedStorageRevision = persistenceStorageRevision.current;
        const savedSnapshot = pendingPagehideSnapshot(journal, saveSessionId);
        if (!savedSnapshot) {
          persistenceBfCacheReloadSafe.current = false;
          stopForCanvasSaveSessionStorage();
          return;
        }
        void fetch(`/api/canvas/${persistenceId}`, {
          body: payload,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          method: "PUT",
        }).then(async (response) => {
          if (!response.ok) {
            settleSentFingerprint(saveSequence, false);
            return;
          }
          const result: unknown = await response.json();
          const requestFence = canvasSaveRequestFence(payload);
          if (
            !isCanvasSaveSuccess(result, requestFence)
          ) {
            settleSentFingerprint(saveSequence, false);
            return;
          }
          settleSentFingerprint(saveSequence, true);
          try {
            const settlement = settleStoredCanvasSaveSession(
              persistenceScopeId,
              saveSessionId,
              saveSequence,
              attemptId,
              payload,
              journal.serverEpoch,
            );
            if (
              settlement &&
              persistenceLoadIdentity.current.scopeId === persistenceScopeId &&
              persistenceSessionId.current === saveSessionId &&
              persistenceStorageRevision.current === expectedStorageRevision &&
              settlement.previousStorageRevision === expectedStorageRevision
            ) {
              applyCanvasSaveSession(settlement.settled);
              persistenceRevision.current = result.revision;
              persistenceGraphRevision.current = result.graphRevision;
              persistenceObservedRevision.current = result.revision;
              persistenceObservedLoadToken.current = result.loadToken;
              persistenceRetryDelay.current = 1_000;
              persistedDocumentFingerprint.current = savedSnapshot.fingerprint;
              persistedGraphFingerprint.current = savedSnapshot.graphFingerprint;
              setConfirmedPersistenceRevision(result.revision);
              setConfirmedGraphRevision(result.graphRevision);
              if (
                persistenceExternalRevision.current !== undefined &&
                persistenceExternalRevision.current <= result.revision
              ) {
                persistenceExternalRevision.current = undefined;
              }
              broadcastCanvasSaved(
                accountId ?? "",
                persistenceId,
                result.revision,
                persistenceBroadcastInstanceId.current,
              );
              const currentSnapshot = canvasSnapshotWithLiveEditors();
              if (currentSnapshot.fingerprint === savedSnapshot.fingerprint) {
                persistenceQueued.current = undefined;
                persistenceDirty.current = false;
                onSaveSuccess();
              } else {
                persistenceBfCacheReloadSafe.current = false;
                persistenceQueued.current = currentSnapshot;
                persistenceDirty.current = true;
              }
            }
          } catch {
            // A later page will fail closed on the still-persisted pending
            // journal and reconcile it against the server fence.
          }
        }).catch(() => {
          pruneSentFingerprints();
        });
      }
    };
    window.addEventListener("pagehide", flushBeforeReload);
    return () => window.removeEventListener("pagehide", flushBeforeReload);
  }, [
    accountId,
    applyCanvasSaveSession,
    canvasSnapshotWithLiveEditors,
    onSaveSuccess,
    persistenceFixture,
    persistenceId,
    persistenceReady,
    persistenceScopeId,
    rememberSentFingerprint,
    reserveCanvasSaveAttempt,
    pruneSentFingerprints,
    settleSentFingerprint,
    stopForCanvasSaveSessionStorage,
  ]);

  useEffect(() => {
    const reloadRestoredPage = (event: PageTransitionEvent) => {
      if (
        event.persisted &&
        persistenceBfCacheReloadSafe.current &&
        persistenceReadyRef.current &&
        !persistenceConflict.current
      ) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", reloadRestoredPage);
    return () => window.removeEventListener("pageshow", reloadRestoredPage);
  }, []);

  useEffect(() => {
    const cancelBatchConnection = (event: KeyboardEvent) => {
      if (!persistenceReadyRef.current) return;
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
  }, [persistenceReady, primaryId, setEdges, setNodes, workflowRetainedNodeIds]);

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
  const flushCanvasSave = useCallback(async () => {
    const assertSafePersistence = () => {
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
    if (latest.fingerprint !== persistedDocumentFingerprint.current) {
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
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    assertSafePersistence();
  }, [persistenceFixture]);
  const waitForCanvasRevision = useCallback(async (timeoutMs = 30_000) => {
    const assertSafePersistence = () => {
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
    if (latest.fingerprint !== persistedDocumentFingerprint.current) {
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
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error("画布保存超时，请稍后再试");
  }, [persistenceFixture]);
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
      flushCanvasSave,
      isFixture: Boolean(fixtureId),
      notify: showWorkflowToast,
      persistenceReady,
      retryGenerationEnabled,
      waitForCanvasRevision,
    }),
    [
      accountId,
      fixtureId,
      flushCanvasSave,
      generationCanvasRevision,
      persistenceReady,
      persistenceId,
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
  const trySetNodes = useCallback((update: SetStateAction<ProbeNodeType[]>) => {
    if (!persistenceReadyRef.current) return false;
    setNodes(update);
    return true;
  }, [setNodes]);
  const tryAdoptNodes = useCallback((
    targetNodeId: string,
    update: SetStateAction<ProbeNodeType[]>,
  ) => tryCommitCanvasNodeAdoption({
    commit: setNodes,
    currentNodes: () => pendingGuardedNodes.current ?? nodesRef.current,
    persistenceReady: () => persistenceReadyRef.current,
    targetNodeId,
    update,
  }), [setNodes]);

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
        getEdges={() => pendingGuardedEdges.current ?? edgesRef.current}
        getNodes={() => pendingGuardedNodes.current ?? nodesRef.current}
        notify={showWorkflowToast}
        onRetainedNodeIdsChange={setWorkflowRetainedNodeIds}
        setNodes={guardedSetNodes}
      >
      <CanvasGraphMutationContext.Provider
        value={{
          setEdges: guardedSetEdges,
          setNodes: guardedSetNodes,
          tryAdoptNodes,
          trySetNodes,
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
      onDragOver={(event) => {
        if (!persistenceReady) return;
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
        if (!persistenceReady) return;
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
          if (!persistenceReady) return;
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
          if (!persistenceReady) return;
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
        onEdgesChange={(changes) => {
          if (!persistenceReady) return;
          const accepted = changes.filter((change) => {
            if (change.type !== "remove") return true;
            const edge = edgesRef.current.find((candidate) => candidate.id === change.id);
            return !edge ||
              (!workflowRetainedNodeIds.has(edge.source) &&
                !workflowRetainedNodeIds.has(edge.target));
          });
          if (accepted.length !== changes.length) {
            showWorkflowToast("整组执行中，不能删除参与节点的连线", "error");
          }
          onEdgesChange(accepted);
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
          if (pendingProgrammaticViewport.current) {
            instance.setViewport(pendingProgrammaticViewport.current);
            pendingProgrammaticViewport.current = undefined;
          }
          onReady(() => void instance.fitView({ duration: 0, padding: 0.2 }));
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
                  change.resizing === undefined &&
                  change.setAttributes === undefined,
              );
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
          if (!persistenceReady) {
            onNodesChange(acceptedChanges);
            return;
          }
          const now = performance.now();
          const viewportInteracting =
            lastViewportInteractionAt.current > 0 &&
            now - lastViewportInteractionAt.current < VIEWPORT_QUIET_MS;
          const activelyDraggingNode =
            nodeDragging.current ||
            acceptedChanges.some(
              (change) =>
                change.type === "position" && change.dragging === true,
            );
          if (viewportInteracting && !activelyDraggingNode) {
            // Zoom/pan may mount, unmount or re-measure a parent group. React
            // Flow can report that passive reconciliation as a position
            // change. A camera-only action is not graph editing, so retain
            // measurements/selections but discard unsolicited coordinates.
            acceptedChanges = acceptedChanges.filter(
              (change) => change.type !== "position",
            );
            if (acceptedChanges.length === 0) return;
          }
          if (
            nodeDragging.current &&
            acceptedChanges.some((change) => change.type === "position")
          ) {
            markCanvasInteraction();
          }
          if (
            !nodeDragging.current &&
            acceptedChanges.some((change) => change.type === "position")
          ) {
            checkpoint();
          }
          onNodesChange(keepLastNonCollidingPositions(acceptedChanges));
        }}
        onNodeDragStart={() => {
          if (!persistenceReady) return;
          nodeDragging.current = true;
          checkpoint();
          markCanvasInteraction();
        }}
        onNodeDragStop={() => {
          if (!persistenceReady) return;
          nodeDragging.current = false;
          markCanvasInteraction();
        }}
        onNodeClick={(_, node) => {
          if (!persistenceReady) return;
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
              setNodes((current) =>
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
          setNodes((current) => current.map((node) =>
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
      </div>
      </CanvasSelectionUiContext.Provider>
      </CanvasCheckpointContext.Provider>
      </CanvasGraphMutationContext.Provider>
      </WorkflowExecutionProvider>
      <UpdateNotice />
    </GenerationCanvasContext.Provider>
  );
}
