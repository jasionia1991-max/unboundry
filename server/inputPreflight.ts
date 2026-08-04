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

type CanvasRow = { edges: string; graph_revision: number; nodes: string };

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
  ownerId: string;
  parameters?: Record<string, ModelParameterValue>;
  targetId: string;
  targetKind: NodeInputKind;
}): NodeInputPreflight & { canvasRevision: number; persistedOwnPrompt: string } {
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
    const nodes = normalizePersistedMediaNodes(JSON.parse(row.nodes) as Array<{
      data?: Record<string, unknown>;
      id: string;
      type?: string;
    }>);
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
        nodes,
        ownPrompt: persistedOwnPrompt,
        parameters: input.parameters,
        targetId: input.targetId,
        targetKind: input.targetKind,
      }),
      canvasRevision: row.graph_revision,
      persistedOwnPrompt,
    };
  } finally {
    database.close();
  }
}
