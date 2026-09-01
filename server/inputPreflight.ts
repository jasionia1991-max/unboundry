import { openAppDatabase } from "./database";
import type {
  ModelParameterSchema,
  ModelParameterValue,
} from "../types/modelParameters";
import {
  resolveNodeInputs,
  type NodeInputKind,
  type NodeInputPreflight,
} from "../types/nodeInputs";
import { normalizePersistedMediaNodes } from "../types/persistedMediaSources";
import { readableMediaForOwner } from "./mediaRegistry";

type CanvasRow = { edges: string; graph_revision: number; nodes: string };
type PersistedNode = {
  data?: Record<string, unknown>;
  id: string;
  parentId?: string;
  type?: string;
};

const mediaNodeKinds = new Set(["audio", "image", "video"] as const);
const persistedTrustedMediaKeys = [
  "mediaByteSize",
  "mediaContentType",
  "mediaDurationSeconds",
  "mediaHeight",
  "mediaMetadataSource",
  "mediaMetadataStatus",
  "mediaStorageBackend",
  "mediaWidth",
] as const;

export function authoritativeMediaNodes(
  nodes: readonly PersistedNode[],
  ownerId: string,
): PersistedNode[] {
  return nodes.map((node) => {
    if (!mediaNodeKinds.has(node.type as "audio" | "image" | "video")) {
      return node;
    }
    const kind = node.type as "audio" | "image" | "video";
    const data = { ...(node.data ?? {}) };
    // Canvas JSON is browser-owned. Remove every field that merely claims to
    // contain server metadata before rebuilding a transient trusted view.
    for (const key of persistedTrustedMediaKeys) delete data[key];
    if (kind === "video") {
      delete data.videoHeight;
      delete data.videoWidth;
    }

    const assetId = typeof data.assetId === "string" ? data.assetId.trim() : "";
    if (!assetId) return { ...node, data };
    const media = readableMediaForOwner(ownerId, kind, assetId);
    if (!media || media.storageStatus !== "ready") {
      return {
        ...node,
        data: {
          ...data,
          inputState: "invalid",
          inputStateReason: "素材不存在、尚未保存或不属于当前账号",
        },
      };
    }

    delete data.inputStateReason;
    data.inputState = "ready";
    data.mediaByteSize = media.byteSize;
    data.mediaContentType = media.contentType;
    data.mediaDurationSeconds = media.durationSeconds ?? undefined;
    data.mediaHeight = media.mediaHeight ?? undefined;
    data.mediaMetadataSource = "server";
    data.mediaMetadataStatus = kind === "image"
      ? "ready"
      : media.durationStatus === "not-applicable"
        ? "failed"
        : media.durationStatus;
    data.mediaStorageBackend = media.storageBackend;
    data.mediaWidth = media.mediaWidth ?? undefined;
    if (kind === "video") {
      data.videoHeight = media.mediaHeight ?? undefined;
      data.videoWidth = media.mediaWidth ?? undefined;
    }
    return { ...node, data };
  });
}

export function readPersistedCanvasGraph(input: {
  bypass?: boolean;
  canvasId: string;
  ownerId: string;
}) {
  const database = openAppDatabase();
  try {
    const row = (input.bypass
      ? database.prepare(`
          SELECT nodes, edges, graph_revision FROM canvas_documents
          WHERE id = ? ORDER BY owner_id = '__test__' DESC, owner_id IS NULL DESC
          LIMIT 1
        `).get(input.canvasId)
      : database.prepare(`
          SELECT nodes, edges, graph_revision FROM canvas_documents
          WHERE owner_id = ? AND id = ?
        `).get(input.ownerId, input.canvasId)) as CanvasRow | undefined;
    if (!row) throw new Error("画布还没有保存，请稍后重试");
    return Object.freeze({
      edges: JSON.parse(row.edges) as Array<{
        data?: Record<string, unknown>;
        id: string;
        source: string;
        target: string;
      }>,
      graphRevision: row.graph_revision,
      nodes: authoritativeMediaNodes(
        normalizePersistedMediaNodes(JSON.parse(row.nodes) as PersistedNode[]),
        input.ownerId,
      ),
    });
  } finally {
    database.close();
  }
}

const nodePromptKeys: Record<NodeInputKind, string> = {
  audio: "audioPrompt",
  image: "imagePrompt",
  text: "textPrompt",
  video: "videoPrompt",
};

export function persistedNodeOwnPrompt(
  node: { data?: Record<string, unknown> },
  kind: NodeInputKind,
) {
  const value = node.data?.[nodePromptKeys[kind]];
  return typeof value === "string" ? value.trim() : "";
}

export class CanvasRevisionConflictError extends Error {
  constructor(
    readonly revision: number,
    message = "画布内容还在保存，请等待保存完成后重试",
  ) {
    super(message);
    this.name = "CanvasRevisionConflictError";
  }
}

export function assertPersistedCanvasRevision(input: {
  bypass: boolean;
  canvasId: string;
  expectedRevision: number;
  ownerId: string;
}) {
  const database = openAppDatabase();
  try {
    const row = (input.bypass
      ? database.prepare(`
          SELECT graph_revision FROM canvas_documents
          WHERE id = ? ORDER BY owner_id = '__test__' DESC, owner_id IS NULL DESC
          LIMIT 1
        `).get(input.canvasId)
      : database.prepare(`
          SELECT graph_revision FROM canvas_documents
          WHERE owner_id = ? AND id = ?
        `).get(input.ownerId, input.canvasId)) as
      | { graph_revision: number }
      | undefined;
    if (!row || row.graph_revision !== input.expectedRevision) {
      throw new CanvasRevisionConflictError(row?.graph_revision ?? -1);
    }
  } finally {
    database.close();
  }
}

export function resolvePersistedNodeInputs(input: {
  bypass: boolean;
  canvasId: string;
  expectedRevision?: number;
  modelSchema?: ModelParameterSchema;
  modelReleaseRevision?: string;
  ownerId: string;
  parameters?: Record<string, ModelParameterValue>;
  targetId: string;
  targetKind: NodeInputKind;
}): NodeInputPreflight & {
  canvasRevision: number;
  persistedOwnPrompt: string;
  persistedTargetParentId?: string;
  persistedTargetData: Record<string, unknown>;
} {
  const database = openAppDatabase();
  try {
    const row = (input.bypass
      ? database.prepare(`
          SELECT nodes, edges, graph_revision FROM canvas_documents
          WHERE id = ? ORDER BY owner_id = '__test__' DESC, owner_id IS NULL DESC
          LIMIT 1
        `).get(input.canvasId)
      : database.prepare(`
          SELECT nodes, edges, graph_revision FROM canvas_documents
          WHERE owner_id = ? AND id = ?
        `).get(input.ownerId, input.canvasId)) as CanvasRow | undefined;
    if (!row) throw new Error("画布还没有保存，请稍后重试");
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== row.graph_revision
    ) {
      throw new CanvasRevisionConflictError(row.graph_revision);
    }
    const nodes = authoritativeMediaNodes(
      normalizePersistedMediaNodes(JSON.parse(row.nodes) as PersistedNode[]),
      input.ownerId,
    );
    const edges = JSON.parse(row.edges) as Array<{
      data?: Record<string, unknown>;
      id: string;
      source: string;
      target: string;
    }>;
    const target = nodes.find((node) => node.id === input.targetId);
    if (!target || target.type !== input.targetKind) {
      throw new Error("目标节点不存在或类型不匹配");
    }
    const persistedOwnPrompt = persistedNodeOwnPrompt(target, input.targetKind);
    return {
      ...resolveNodeInputs({
        edges,
        modelSchema: input.modelSchema,
        modelReleaseRevision: input.modelReleaseRevision,
        nodes,
        ownPrompt: persistedOwnPrompt,
        parameters: input.parameters,
        targetId: input.targetId,
        targetKind: input.targetKind,
      }),
      canvasRevision: row.graph_revision,
      persistedOwnPrompt,
      persistedTargetParentId: target.parentId,
      persistedTargetData: { ...(target.data ?? {}) },
    };
  } finally {
    database.close();
  }
}
