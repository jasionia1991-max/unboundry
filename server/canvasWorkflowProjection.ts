import type { DatabaseSync } from "node:sqlite";
import type { NodeInputKind } from "../types/nodeInputs";

export function canvasGraphRevisionMatchesInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  graphRevision: number;
  ownerId: string;
}) {
  const row = input.database.prepare(`
    SELECT graph_revision FROM canvas_documents
    WHERE owner_id = ? AND id = ?
  `).get(input.ownerId, input.canvasId) as
    | { graph_revision?: unknown }
    | undefined;
  return Boolean(row && Number(row.graph_revision) === input.graphRevision);
}

export function projectWorkflowResultInTransaction(input: {
  canvasId: string;
  database: DatabaseSync;
  expectedModelId: string;
  expectedPrompt: string;
  kind: NodeInputKind;
  nodeId: string;
  ownerId: string;
  patch: Record<string, unknown>;
}) {
  if (!input.database.isTransaction) {
    throw new Error("Workflow projection requires an existing transaction");
  }
  const canvas = input.database.prepare(`
    SELECT nodes, revision FROM canvas_documents WHERE owner_id = ? AND id = ?
  `).get(input.ownerId, input.canvasId) as
    | { nodes: string; revision: number }
    | undefined;
  if (!canvas) return "failed" as const;
  const nodes = JSON.parse(canvas.nodes) as Array<{
    data?: Record<string, unknown>;
    id?: string;
    type?: string;
  }>;
  const index = nodes.findIndex(({ id }) => id === input.nodeId);
  const node = nodes[index];
  if (!node || node.type !== input.kind) return "conflict" as const;
  const currentPrompt = String(node.data?.[`${input.kind}Prompt`] ?? "").trim();
  const currentModel = input.kind === "video"
    ? String(node.data?.videoModelId ?? node.data?.videoModel ?? "").trim()
    : String(node.data?.[`${input.kind}ModelId`] ?? "").trim();
  if (currentPrompt !== input.expectedPrompt || currentModel !== input.expectedModelId) {
    return "conflict" as const;
  }
  nodes[index] = { ...node, data: { ...(node.data ?? {}), ...input.patch } };
  const updated = input.database.prepare(`
    UPDATE canvas_documents
    SET nodes = ?, revision = revision + 1, updated_at = ?
    WHERE owner_id = ? AND id = ? AND revision = ?
  `).run(
    JSON.stringify(nodes),
    new Date().toISOString(),
    input.ownerId,
    input.canvasId,
    canvas.revision,
  );
  return Number(updated.changes) === 1 ? "applied" as const : "conflict" as const;
}
