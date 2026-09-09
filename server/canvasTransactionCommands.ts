import { adoptedMediaStyle } from "../types/mediaGeometry";
import type { TransactionScopedCommand } from "./transactionCommand";
import {
  canvasUserFieldChangeMatchesNode,
  type AdoptedCanvasAsset,
  type CanvasTopologyMediaAdoption,
  type CanvasTopologyOperation,
  type CanvasUserCommand,
} from "../types/canvasCommands";
import {
  canvasEdgeDataFieldDescriptors,
  canvasEdgeTopLevelFieldDescriptors,
  canvasInputGraphFingerprint,
  canvasNodeDataFieldDescriptors,
  canvasNodeDataFieldDescriptor,
  canvasNodeTopLevelFieldDescriptors,
  stableSha256,
} from "../types/canvasFingerprint";
import { persistedNodeSchemaRegistry } from "../types/persistedNodeSchemaRegistry";

export type MutableCanvasDocument = {
  edges: unknown[];
  nodes: unknown[];
  viewport: { x: number; y: number; zoom: number };
};

/** Exact local snapshot for generation maintenance CAS; never a Canvas writer. */
export const readGenerationRecoveryCanvasCommand: TransactionScopedCommand<Readonly<{
  ownerId: string; canvasId: string; nodeId: string;
}>, Readonly<{ canvas?: Readonly<{
  owner_id: string | null; id: string; revision: number; graph_revision: number;
  nodes: string; edges: string; viewport: string; updated_at: string;
  save_session_id: string | null; save_sequence: number;
}>; canvasNode?: Readonly<Record<string, unknown>> }>> = {
  execute(scope, input) {
    const canvas = scope.prepare(`SELECT owner_id,id,revision,graph_revision,nodes,edges,viewport,
      updated_at,save_session_id,save_sequence FROM canvas_documents WHERE owner_id = ? AND id = ?`)
      .get(input.ownerId, input.canvasId) as {
        owner_id: string | null; id: string; revision: number; graph_revision: number;
        nodes: string; edges: string; viewport: string; updated_at: string;
        save_session_id: string | null; save_sequence: number;
      } | undefined;
    if (!canvas) return {};
    const nodes: unknown = JSON.parse(canvas.nodes);
    if (!Array.isArray(nodes)) throw new Error("Recovery Canvas snapshot is damaged");
    const node: unknown = nodes.find((value) => value && typeof value === "object" && value.id === input.nodeId);
    return { canvas, ...(node && typeof node === "object" && !Array.isArray(node)
      ? { canvasNode: node as Readonly<Record<string, unknown>> } : {}) };
  },
};

export const readCanvasRevisionCommand: TransactionScopedCommand<Readonly<{
  canvasId: string;
  ownerId: string;
}>, Readonly<{ documentRevision: number; inputRevision: number }> | undefined> = {
  execute(scope, input) {
    const row = scope.prepare(`
      SELECT revision, graph_revision
      FROM canvas_documents
      WHERE owner_id = ? AND id = ?
    `).get(input.ownerId, input.canvasId) as
      | { graph_revision: number; revision: number }
      | undefined;
    return row
      ? { documentRevision: row.revision, inputRevision: row.graph_revision }
      : undefined;
  },
};

export class CanvasCommandApplicationError extends Error {
  constructor(
    readonly code:
      | "CANVAS_SERVER_OWNERSHIP_CONFLICT"
      | "CANVAS_TOPOLOGY_CONFLICT"
      | "WORKFLOW_GRAPH_LOCKED",
    message: string,
  ) {
    super(message);
    this.name = "CanvasCommandApplicationError";
  }
}

type CanvasCommandApplication = Readonly<{
  affectedSubgraphSha256: string | null;
  changedPaths: readonly string[];
  document: MutableCanvasDocument;
}>;

export type AuthoritativeCanvasAsset = AdoptedCanvasAsset & Readonly<{
  createdAt?: string;
  hasTransparency?: boolean;
}>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function cloneDocument(document: MutableCanvasDocument): MutableCanvasDocument {
  return JSON.parse(JSON.stringify(document)) as MutableCanvasDocument;
}

function failTopology(message: string): never {
  throw new CanvasCommandApplicationError("CANVAS_TOPOLOGY_CONFLICT", message);
}

function nodeId(node: unknown) {
  return String(record(node)?.id ?? "");
}

function edgeId(edge: unknown) {
  return String(record(edge)?.id ?? "");
}

function sortedUnique(values: readonly string[]) {
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) failTopology("Duplicate topology identity");
  return sorted;
}

function validateNodeShape(node: unknown) {
  if (!persistedNodeSchemaRegistry.accepts(node)) failTopology("Unknown or invalid node");
}

function validateModernEdgeHandles(edge: unknown) {
  const value = record(edge);
  if (value?.sourceHandle !== "source" || value.targetHandle !== "target") {
    failTopology("Canvas edge handle is missing or unsupported");
  }
}

export function validateCanvasDocumentTopology(document: MutableCanvasDocument) {
  if (document.nodes.length > 5_000 || document.edges.length > 10_000) {
    failTopology("Canvas topology capacity exceeded");
  }
  const nodes = new Map<string, Record<string, unknown>>();
  for (const value of document.nodes) {
    validateNodeShape(value);
    const node = record(value)!;
    const id = String(node.id);
    if (nodes.has(id)) failTopology("Duplicate node identity");
    nodes.set(id, node);
  }
  const edges = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const value of document.edges) {
    const edge = record(value);
    if (!edge || typeof edge.id !== "string" || !edge.id ||
        typeof edge.source !== "string" || typeof edge.target !== "string" ||
        !nodes.has(edge.source) || !nodes.has(edge.target) ||
        edge.source === edge.target || edges.has(edge.id)) {
      failTopology("Invalid, duplicate, or dangling edge");
    }
    edges.add(edge.id);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }
  for (const node of nodes.values()) {
    if (node.parentId !== undefined) {
      const parent = typeof node.parentId === "string"
        ? nodes.get(node.parentId)
        : undefined;
      if (!parent || node.parentId === node.id || parent.type !== "group" ||
          node.type === "group") {
        failTopology("Invalid parent relationship");
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) failTopology("Canvas topology contains a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodes.keys()) visit(id);
  for (const node of nodes.values()) {
    const parents = new Set<string>();
    let parent = typeof node.parentId === "string" ? node.parentId : undefined;
    while (parent) {
      if (parents.has(parent)) failTopology("Canvas parent hierarchy contains a cycle");
      parents.add(parent);
      const parentNode = nodes.get(parent);
      parent = typeof parentNode?.parentId === "string" ? parentNode.parentId : undefined;
    }
  }
}

function assertUnlocked(lockedNodeIds: ReadonlySet<string>, ids: readonly string[]) {
  if (ids.some((id) => lockedNodeIds.has(id))) {
    throw new CanvasCommandApplicationError(
      "WORKFLOW_GRAPH_LOCKED",
      "Workflow-owned Canvas topology is locked",
    );
  }
}

export function invalidateGenerationProof(
  data: Record<string, unknown>,
  kind: string,
) {
  for (const key of Object.keys(data)) {
    if (
      key.startsWith("groupRunSuccess") || key === "workflowExecutionRunId" ||
      key === "legacyTerminalDetachApplicationId" ||
      key.startsWith(`${kind}Generation`) ||
      (kind === "image" && key.startsWith("imageToolGraph"))
    ) delete data[key];
  }
  if (kind === "image") delete data.imageGeneratedSuccess;
  if (kind === "audio") {
    delete data.audioGeneratedResult;
    delete data.audioResultChoices;
  }
}

function topologyInputProjection(
  value: unknown,
  topLevelDescriptors: Readonly<Record<string, Readonly<{ input: boolean }>>>,
  dataDescriptors?: Readonly<Record<string, Readonly<{ input: boolean }>>>,
) {
  const item = record(value);
  if (!item) return item;
  const projected = Object.fromEntries(Object.entries(item).filter(([field]) =>
    topLevelDescriptors[field]?.input === true
  ));
  const data = record(item.data);
  if (data && dataDescriptors) {
    projected.data = Object.fromEntries(Object.entries(data).filter(([field]) =>
      dataDescriptors[field]?.input === true
    ));
  }
  return projected;
}

function topologyGenerationProofNodeIds(
  before: MutableCanvasDocument,
  after: MutableCanvasDocument,
) {
  const nodeIds = new Set<string>();
  const beforeNodes = new Map(before.nodes.map((node) => [nodeId(node), node]));
  const afterNodes = new Map(after.nodes.map((node) => [nodeId(node), node]));
  for (const [id, next] of afterNodes) {
    const current = beforeNodes.get(id);
    if (!current || stableSha256(topologyInputProjection(
      current,
      canvasNodeTopLevelFieldDescriptors,
      // apply-topology can change playlistClips as well as top-level topology.
      canvasNodeDataFieldDescriptors,
    )) !== stableSha256(topologyInputProjection(
      next,
      canvasNodeTopLevelFieldDescriptors,
      canvasNodeDataFieldDescriptors,
    ))) nodeIds.add(id);
  }
  const beforeEdges = new Map(before.edges.map((edge) => [edgeId(edge), edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edgeId(edge), edge]));
  for (const id of new Set([...beforeEdges.keys(), ...afterEdges.keys()])) {
    const current = beforeEdges.get(id);
    const next = afterEdges.get(id);
    if (stableSha256(topologyInputProjection(
      current,
      canvasEdgeTopLevelFieldDescriptors,
      canvasEdgeDataFieldDescriptors,
    )) === stableSha256(topologyInputProjection(
      next,
      canvasEdgeTopLevelFieldDescriptors,
      canvasEdgeDataFieldDescriptors,
    ))) continue;
    const currentTarget = String(record(current)?.target ?? "");
    const nextTarget = String(record(next)?.target ?? "");
    if (currentTarget && afterNodes.has(currentTarget)) nodeIds.add(currentTarget);
    if (nextTarget && afterNodes.has(nextTarget)) nodeIds.add(nextTarget);
  }
  return nodeIds;
}

function applyAuthoritativeAssetAdoption(input: Readonly<{
  adoption: CanvasTopologyMediaAdoption;
  asset: AuthoritativeCanvasAsset;
  document: MutableCanvasDocument;
}>) {
  const { adoption, asset, document } = input;
  const node = document.nodes.map(record).find((item) => item?.id === adoption.nodeId);
  const data = record(node?.data);
  const kind = String(node?.type ?? "");
  const sourceAssetPresent = adoption.kind === "edit-result-and-invalidate-proof" &&
    document.nodes.some((value) => {
      const source = record(value);
      const sourceData = record(source?.data);
      return source?.type === "image" &&
        sourceData?.assetId === adoption.sourceAssetId;
    });
  if (!node || !data || !["audio", "image", "video"].includes(kind) ||
      asset.assetId !== adoption.asset.assetId ||
      (adoption.kind === "adopt-uploaded-asset" && kind !== adoption.mediaKind) ||
      (adoption.kind === "edit-result-and-invalidate-proof" &&
        (kind !== "image" || !sourceAssetPresent))) {
    throw new CanvasCommandApplicationError(
      "CANVAS_SERVER_OWNERSHIP_CONFLICT",
      "Canvas asset kind no longer matches the node",
    );
  }
  invalidateGenerationProof(data, kind);
  if (kind === "image") delete data.imageHasTransparency;
  Object.assign(data, authoritativeCanvasAssetPatch(
    kind as "audio" | "image" | "video",
    asset,
  ));
  const fittedStyle = adoptedMediaStyle(node, data);
  if (fittedStyle) node.style = fittedStyle;
  if (adoption.kind === "edit-result-and-invalidate-proof") {
    data.imageAssetOrigin = "image-tool";
    data.imageToolOperation = adoption.toolOperation;
    data.imageToolOperationId = adoption.toolOperationId;
    data.imageToolSourceAssetId = adoption.sourceAssetId;
    if (adoption.outputBackground === undefined) {
      delete data.imageToolOutputBackground;
    } else {
      data.imageToolOutputBackground = adoption.outputBackground;
    }
  } else if (kind === "image") {
    for (const key of Object.keys(data)) {
      if (key.startsWith("imageTool")) delete data[key];
    }
    delete data.imageSeedanceValidation;
    data.imageAssetOrigin = "local-upload";
  }
}

export function authoritativeCanvasAssetPatch(
  kind: "audio" | "image" | "video",
  asset: AuthoritativeCanvasAsset,
) {
  return {
    assetId: asset.assetId,
    [`${kind}Src`]: asset.src,
    inputState: "ready",
    inputStateReason: undefined,
    mediaByteSize: asset.byteSize,
    mediaContentType: asset.contentType,
    mediaDurationSeconds: asset.durationSeconds ?? undefined,
    mediaHeight: asset.height ?? undefined,
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: asset.storageBackend,
    mediaWidth: asset.width ?? undefined,
    ...(kind === "image" && asset.hasTransparency !== undefined
      ? { imageHasTransparency: asset.hasTransparency }
      : {}),
    ...(kind === "video" && asset.createdAt
      ? { videoCreatedAt: asset.createdAt }
      : {}),
  };
}

function topologyAffectedProjection(
  document: MutableCanvasDocument,
  operation: CanvasTopologyOperation,
) {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (operation.intent === "create-node") nodeIds.add(nodeId(operation.node));
  if (operation.intent === "delete-subgraph") {
    operation.nodeIds.forEach((id) => nodeIds.add(id));
    operation.edgeIds.forEach((id) => edgeIds.add(id));
  }
  if (operation.intent === "connect-edge") {
    const edge = record(operation.edge);
    edgeIds.add(String(edge?.id ?? ""));
    nodeIds.add(String(edge?.source ?? ""));
    nodeIds.add(String(edge?.target ?? ""));
  }
  if (operation.intent === "disconnect-edge") {
    edgeIds.add(operation.edgeId);
    const edge = document.edges.map(record).find((item) => item?.id === operation.edgeId);
    if (edge) {
      nodeIds.add(String(edge.source ?? ""));
      nodeIds.add(String(edge.target ?? ""));
    }
  }
  if (operation.intent === "replace-edge") {
    const nextEdge = record(operation.edge);
    const currentEdge = document.edges.map(record).find((item) =>
      item?.id === nextEdge?.id
    );
    for (const edge of [currentEdge, nextEdge]) {
      if (!edge) continue;
      edgeIds.add(String(edge.id ?? ""));
      nodeIds.add(String(edge.source ?? ""));
      nodeIds.add(String(edge.target ?? ""));
    }
  }
  if (operation.intent === "group-members") {
    nodeIds.add(nodeId(operation.groupNode));
    operation.memberNodeIds.forEach((id) => nodeIds.add(id));
  }
  if (operation.intent === "ungroup") {
    nodeIds.add(operation.groupNodeId);
    operation.memberNodeIds.forEach((id) => nodeIds.add(id));
  }
  if (operation.intent === "paste-subgraph") {
    operation.nodes.forEach((node) => nodeIds.add(nodeId(node)));
    operation.edges.forEach((edge) => {
      const item = record(edge);
      edgeIds.add(String(item?.id ?? ""));
      nodeIds.add(String(item?.source ?? ""));
      nodeIds.add(String(item?.target ?? ""));
    });
  }
  if (operation.intent === "replace-playlist-order") {
    nodeIds.add(operation.nodeId);
  }
  return {
    edges: document.edges.filter((edge) => {
      const item = record(edge);
      return edgeIds.has(String(item?.id ?? "")) ||
        nodeIds.has(String(item?.source ?? "")) ||
        nodeIds.has(String(item?.target ?? ""));
    }),
    identity: {
      edgeIds: sortedUnique([...edgeIds].filter(Boolean)),
      intent: operation.intent,
      nodeIds: sortedUnique([...nodeIds].filter(Boolean)),
    },
    nodes: document.nodes.filter((node) => nodeIds.has(nodeId(node))),
  };
}

export function canvasTopologyAffectedDigest(
  document: MutableCanvasDocument,
  operation: CanvasTopologyOperation,
) {
  return stableSha256(topologyAffectedProjection(document, operation));
}

function applyTopologyOperation(
  document: MutableCanvasDocument,
  operation: CanvasTopologyOperation,
) {
  const nodesById = new Map(document.nodes.map((node) => [nodeId(node), node]));
  const edgesById = new Map(document.edges.map((edge) => [edgeId(edge), edge]));
  if (operation.intent === "create-node") {
    const id = nodeId(operation.node);
    if (!id || nodesById.has(id)) failTopology("Node identity already exists");
    validateNodeShape(operation.node);
    document.nodes.push(operation.node);
  } else if (operation.intent === "delete-subgraph") {
    const deletingNodes = new Set(sortedUnique(operation.nodeIds));
    if ([...deletingNodes].some((id) => !nodesById.has(id))) {
      failTopology("Node deletion precondition no longer holds");
    }
    const requiredEdges = document.edges.filter((edge) => {
      const item = record(edge)!;
      return deletingNodes.has(String(item.source)) || deletingNodes.has(String(item.target));
    }).map(edgeId).sort();
    if (JSON.stringify(requiredEdges) !== JSON.stringify(sortedUnique(operation.edgeIds))) {
      failTopology("Node deletion must enumerate every cascading edge");
    }
    const deletingEdges = new Set(operation.edgeIds);
    document.nodes = document.nodes.filter((node) => !deletingNodes.has(nodeId(node)));
    document.edges = document.edges.filter((edge) => !deletingEdges.has(edgeId(edge)));
  } else if (operation.intent === "connect-edge") {
    const edge = record(operation.edge)!;
    if (edgesById.has(String(edge.id)) || !nodesById.has(String(edge.source)) ||
        !nodesById.has(String(edge.target))) {
      failTopology("Edge connection precondition no longer holds");
    }
    validateModernEdgeHandles(operation.edge);
    document.edges.push(operation.edge);
  } else if (operation.intent === "disconnect-edge") {
    if (!edgesById.has(operation.edgeId)) failTopology("Edge no longer exists");
    document.edges = document.edges.filter((edge) => edgeId(edge) !== operation.edgeId);
  } else if (operation.intent === "replace-edge") {
    const edge = record(operation.edge)!;
    const id = String(edge.id);
    const currentEdge = record(edgesById.get(id));
    if (!edgesById.has(id) || !nodesById.has(String(edge.source)) ||
        !nodesById.has(String(edge.target))) {
      failTopology("Edge replacement precondition no longer holds");
    }
    const replacesLegacyEdgeInPlace = currentEdge !== undefined &&
      currentEdge.source === edge.source &&
      currentEdge.target === edge.target &&
      currentEdge.sourceHandle === undefined &&
      currentEdge.targetHandle === undefined &&
      edge.sourceHandle === undefined && edge.targetHandle === undefined;
    if (!replacesLegacyEdgeInPlace) validateModernEdgeHandles(operation.edge);
    document.edges = document.edges.map((current) =>
      edgeId(current) === id ? operation.edge : current
    );
  } else if (operation.intent === "group-members") {
    const groupId = nodeId(operation.groupNode);
    const groupNode = record(operation.groupNode);
    if (!groupId || nodesById.has(groupId) || groupNode?.type !== "group" ||
        groupNode.parentId !== undefined || operation.memberNodeIds.some((id) => {
          const member = record(nodesById.get(id));
          return !member || id === groupId || member.type === "group" ||
            member.parentId !== undefined;
        })) {
      failTopology("Group precondition no longer holds");
    }
    validateNodeShape(operation.groupNode);
    const members = new Set(sortedUnique(operation.memberNodeIds));
    document.nodes = [
      ...document.nodes.map((node) => members.has(nodeId(node))
        ? { ...record(node), extent: "parent", parentId: groupId }
        : node),
      operation.groupNode,
    ];
  } else if (operation.intent === "ungroup") {
    const group = record(nodesById.get(operation.groupNodeId));
    if (!group || group.type !== "group") failTopology("Group no longer exists");
    const actualMembers = document.nodes.filter((node) =>
      record(node)?.parentId === operation.groupNodeId
    ).map(nodeId).sort();
    if (JSON.stringify(actualMembers) !==
        JSON.stringify(sortedUnique(operation.memberNodeIds))) {
      failTopology("Group membership changed");
    }
    document.nodes = document.nodes.flatMap((node) => {
      if (nodeId(node) === operation.groupNodeId) return [];
      if (!operation.memberNodeIds.includes(nodeId(node))) return [node];
      const next = { ...record(node) };
      delete next.parentId;
      delete next.extent;
      return [next];
    });
    document.edges = document.edges.filter((edge) => {
      const item = record(edge)!;
      return item.source !== operation.groupNodeId && item.target !== operation.groupNodeId;
    });
  } else if (operation.intent === "paste-subgraph") {
    const pastedNodeIds = operation.nodes.map(nodeId);
    const pastedEdgeIds = operation.edges.map(edgeId);
    sortedUnique(pastedNodeIds);
    sortedUnique(pastedEdgeIds);
    if (pastedNodeIds.some((id) => !id || nodesById.has(id)) ||
        pastedEdgeIds.some((id) => !id || edgesById.has(id))) {
      failTopology("Pasted identity already exists");
    }
    operation.nodes.forEach(validateNodeShape);
    operation.edges.forEach(validateModernEdgeHandles);
    document.nodes.push(...operation.nodes);
    document.edges.push(...operation.edges);
  } else {
    const node = record(nodesById.get(operation.nodeId));
    const data = record(node?.data);
    const clips = Array.isArray(data?.playlistClips) ? data.playlistClips : undefined;
    if (!node || node.type !== "playlist" || !data || !clips) {
      failTopology("Playlist no longer exists");
    }
    const byId = new Map(clips.map((clip) => [String(record(clip)?.id ?? ""), clip]));
    if (operation.clipIds.length !== clips.length ||
        sortedUnique(operation.clipIds).some((id) => !byId.has(id))) {
      failTopology("Playlist membership changed");
    }
    data.playlistClips = operation.clipIds.map((id) => byId.get(id));
  }
  validateCanvasDocumentTopology(document);
}

export function applyCanvasUserCommand(input: Readonly<{
  authoritativeAsset?: AuthoritativeCanvasAsset;
  authoritativeMediaAssets?: ReadonlyMap<string, AuthoritativeCanvasAsset>;
  command: Exclude<CanvasUserCommand, { kind: "create-canvas-document" }>;
  currentDocument: MutableCanvasDocument;
  lockedNodeIds?: readonly string[];
}>): CanvasCommandApplication {
  validateCanvasDocumentTopology(input.currentDocument);
  const document = cloneDocument(input.currentDocument);
  const changedPaths: string[] = [];
  const locked = new Set(input.lockedNodeIds ?? []);
  let affectedSubgraphSha256: string | null = null;
  const { command } = input;
  if (command.kind === "apply-user-field-changes") {
    const nodes = new Map(document.nodes.map((node) => [nodeId(node), record(node)!]));
    assertUnlocked(locked, command.changes.map((change) => change.nodeId));
    for (const change of command.changes) {
      const node = nodes.get(change.nodeId);
      const data = record(node?.data);
      const field = change.field.slice("data.".length);
      if (!node || !data) {
        throw new CanvasCommandApplicationError(
          "CANVAS_SERVER_OWNERSHIP_CONFLICT",
          "Canvas node no longer exists",
        );
      }
      const descriptor = canvasNodeDataFieldDescriptor(field);
      if (
        descriptor?.owner !== "durable-user" ||
        !descriptor.allowedCommands.includes(command.kind)
      ) {
        throw new CanvasCommandApplicationError(
          "CANVAS_SERVER_OWNERSHIP_CONFLICT",
          "Canvas field is not browser writable",
        );
      }
      if (!canvasUserFieldChangeMatchesNode({
        action: change.action,
        field,
        nodeKind: String(node.type ?? ""),
        ...(change.action === "set" ? { value: change.value } : {}),
      })) {
        throw new CanvasCommandApplicationError(
          "CANVAS_SERVER_OWNERSHIP_CONFLICT",
          "Canvas field does not match this node kind or value contract",
        );
      }
      const existed = Object.prototype.hasOwnProperty.call(data, field);
      const valueChanged = change.action === "delete"
        ? existed
        : !existed || stableSha256(data[field]) !== stableSha256(change.value);
      if (change.action === "delete") delete data[field];
      else data[field] = change.value;
      if (valueChanged) changedPaths.push(`nodes.${change.nodeId}.data.${field}`);
      if (valueChanged && canvasNodeDataFieldDescriptor(field)?.input) {
        invalidateGenerationProof(data, String(node.type ?? ""));
      }
    }
  } else if (command.kind === "commit-user-layout") {
    const nodes = new Map(document.nodes.map((node) => [nodeId(node), record(node)!]));
    for (const layout of command.nodes ?? []) {
      const node = nodes.get(layout.nodeId);
      if (!node) failTopology("Layout node no longer exists");
      if (layout.position) node.position = layout.position;
      if (layout.style) node.style = { ...record(node.style), ...layout.style };
      const data = record(node.data);
      const visual = node.type === "image" || node.type === "video";
      if (layout.mediaSizingMode !== undefined && !visual) failTopology("Media sizing requires a visual node");
      if (data && visual) {
        if (layout.mediaSizingMode === null) delete data.mediaSizingMode;
        else if (layout.mediaSizingMode !== undefined) data.mediaSizingMode = layout.mediaSizingMode;
        else if (layout.style) data.mediaSizingMode = "manual";
      }
      if (layout.zIndex !== undefined) node.zIndex = layout.zIndex;
      changedPaths.push(`nodes.${layout.nodeId}.layout`);
    }
    if (command.viewport) {
      document.viewport = { ...command.viewport };
      changedPaths.push("viewport");
    }
  } else if (command.kind === "apply-topology") {
    const actualDigest = canvasTopologyAffectedDigest(
      input.currentDocument,
      command.topologyOperation,
    );
    if (actualDigest !== command.affectedTopologyDigest) {
      failTopology("Affected topology changed");
    }
    const affected = topologyAffectedProjection(
      input.currentDocument,
      command.topologyOperation,
    );
    assertUnlocked(locked, affected.identity.nodeIds);
    applyTopologyOperation(document, command.topologyOperation);
    const currentNodes = new Map(input.currentDocument.nodes.map((node) => [
      nodeId(node),
      record(node),
    ]));
    for (const id of topologyGenerationProofNodeIds(input.currentDocument, document)) {
      const node = document.nodes.map(record).find((item) => item?.id === id);
      const data = record(node?.data);
      if (!node || !data) continue;
      const kinds = new Set([
        String(currentNodes.get(id)?.type ?? ""),
        String(node.type ?? ""),
      ]);
      for (const kind of kinds) invalidateGenerationProof(data, kind);
    }
    for (const adoption of command.mediaAdoptions ?? []) {
      const asset = input.authoritativeMediaAssets?.get(adoption.nodeId);
      if (!asset) {
        throw new CanvasCommandApplicationError(
          "CANVAS_SERVER_OWNERSHIP_CONFLICT",
          "Canvas media adoption is not authoritative",
        );
      }
      applyAuthoritativeAssetAdoption({ adoption, asset, document });
      changedPaths.push(`nodes.${adoption.nodeId}.data.asset`);
    }
    affectedSubgraphSha256 = actualDigest;
    changedPaths.push(`topology.${command.topologyOperation.intent}`);
  } else {
    assertUnlocked(locked, [command.nodeId]);
    const asset = input.authoritativeAsset;
    if (!asset) {
      throw new CanvasCommandApplicationError(
        "CANVAS_SERVER_OWNERSHIP_CONFLICT",
        "Canvas media adoption is not authoritative",
      );
    }
    applyAuthoritativeAssetAdoption({ adoption: command, asset, document });
    changedPaths.push(`nodes.${command.nodeId}.data.asset`);
  }
  return Object.freeze({
    affectedSubgraphSha256,
    changedPaths: Object.freeze(changedPaths),
    document,
  });
}

export function createInitialCanvasDocument(
  command: Extract<CanvasUserCommand, { kind: "create-canvas-document" }>,
) {
  const document = cloneDocument({
    edges: [...command.initialDocument.edges],
    nodes: [...command.initialDocument.nodes],
    viewport: { ...command.initialDocument.viewport },
  });
  document.edges.forEach(validateModernEdgeHandles);
  validateCanvasDocumentTopology(document);
  // Exercise the same canonical input projection used by the gateway before
  // the first durable row is admitted.
  canvasInputGraphFingerprint(document);
  return document;
}

export type MediaHistoryIdentity = Readonly<{
  assetId: string;
  kind: string;
  ownerId: string;
}>;

export const deleteMediaHistoryCommand: TransactionScopedCommand<
  MediaHistoryIdentity,
  number
> = {
  execute(scope, input) {
    return Number(scope.prepare(`
      DELETE FROM asset_history
      WHERE account_id = ? AND owner_id = ? AND id = ? AND kind = ?
    `).run(input.ownerId, input.ownerId, input.assetId, input.kind).changes);
  },
};

export const upsertMediaHistoryCommand: TransactionScopedCommand<Readonly<{
  assetId: string;
  createdAt: string;
  kind: "audio" | "image" | "video";
  label: string;
  ownerId: string;
  preview: string;
}>, void> = {
  execute(scope, input) {
    scope.prepare(`
      INSERT INTO asset_history (
        account_id, id, kind, label, preview, created_at, owner_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        kind = excluded.kind, label = excluded.label,
        preview = excluded.preview, owner_id = excluded.owner_id
    `).run(
      input.ownerId,
      input.assetId,
      input.kind,
      input.label,
      input.preview,
      input.createdAt,
      input.ownerId,
    );
  },
};

export const deleteProjectCanvasDocumentsCommand: TransactionScopedCommand<Readonly<{
  bypass: boolean;
  canvasId: string;
  ownerId: string;
}>, number> = {
  execute(scope, input) {
    return Number((input.bypass
      ? scope.prepare("DELETE FROM canvas_documents WHERE id = ?")
        .run(input.canvasId)
      : scope.prepare("DELETE FROM canvas_documents WHERE owner_id = ? AND id = ?")
        .run(input.ownerId, input.canvasId)).changes);
  },
};

export const deleteAccountCanvasDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare("DELETE FROM canvas_documents WHERE owner_id = ?").run(ownerId);
    scope.prepare(`
      DELETE FROM asset_history WHERE owner_id = ? OR account_id = ?
    `).run(ownerId, ownerId);
  },
};

export const deleteAccountHistoryCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare(`
      DELETE FROM asset_history WHERE owner_id = ? OR account_id = ?
    `).run(ownerId, ownerId);
  },
};

export const claimLegacyCanvasDataCommand: TransactionScopedCommand<string, void> = {
  execute(scope, ownerId) {
    scope.prepare("UPDATE canvas_documents SET owner_id = ? WHERE owner_id IS NULL")
      .run(ownerId);
    scope.prepare("UPDATE asset_history SET owner_id = ? WHERE owner_id IS NULL")
      .run(ownerId);
  },
};

export const createProjectCanvasDocumentCommand: TransactionScopedCommand<Readonly<{
  canvasId: string;
  edges: string;
  nodes: string;
  ownerId: string;
  updatedAt: string;
  viewport: string;
}>, void> = {
  execute(scope, input) {
    scope.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_sequence
      ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, 0)
    `).run(
      input.ownerId,
      input.canvasId,
      input.nodes,
      input.edges,
      input.viewport,
      input.updatedAt,
    );
  },
};

export const readCanvasDocumentRevisionCommand: TransactionScopedCommand<Readonly<{
  canvasId: string;
  ownerId: string;
}>, number | undefined> = {
  execute(scope, input) {
    const row = scope.prepare(`
      SELECT revision FROM canvas_documents WHERE owner_id = ? AND id = ?
    `).get(input.ownerId, input.canvasId) as { revision?: unknown } | undefined;
    return row && Number.isSafeInteger(row.revision)
      ? Number(row.revision)
      : undefined;
  },
};

export type CanvasOperationReceiptProjectionState = Readonly<{
  originalRequestId: string;
  outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT";
  resultDocumentRevision: number;
}>;

export const readCanvasOperationReceiptProjectionStateCommand:
  TransactionScopedCommand<Readonly<{
    canvasId: string;
    operationId: string;
    ownerId: string;
  }>, CanvasOperationReceiptProjectionState | undefined> = {
    execute(scope, input) {
      const row = scope.prepare(`
        SELECT outcome, original_request_id, result_document_revision
        FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ? AND operation_id = ?
      `).get(input.ownerId, input.canvasId, input.operationId) as {
        original_request_id: string;
        outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT";
        result_document_revision: number;
      } | undefined;
      return row
        ? Object.freeze({
            originalRequestId: row.original_request_id,
            outcome: row.outcome,
            resultDocumentRevision: Number(row.result_document_revision),
          })
        : undefined;
    },
  };
