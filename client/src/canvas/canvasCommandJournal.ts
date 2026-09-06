import { adoptedMediaStyle } from "../../../types/mediaGeometry";
import type { WorkflowRunSummary } from "../../../types/workflowRuns";
import type {
  AdoptedCanvasAsset,
  ApplyTopologyCommand,
  AuthoritativeCanvasDocument,
  CanvasTopologyOperation,
  CanvasTopologyMediaAdoption,
  CanvasUserCommand,
  ExistingCanvasCommandBase,
  UserFieldChange,
} from "../../../types/canvasCommands";
import {
  canvasNodeDataFieldDescriptors,
  stableSha256,
  userOwnedCanvasDocumentProjection,
  userOwnedCanvasEdgeProjection,
  userOwnedCanvasNodeProjection,
} from "../../../types/canvasFingerprint";

export type CanvasCommandTargetDocument = Readonly<{
  edges: readonly unknown[];
  nodes: readonly unknown[];
  viewport: Readonly<{ x: number; y: number; zoom: number }>;
}>;

type JournalTopologyOperation =
  | Readonly<{ intent: "delete-subgraph"; nodeIds: readonly string[] }>
  | Readonly<{ intent: "connect-edge"; edge: unknown }>
  | Readonly<{ intent: "disconnect-edge"; edgeId: string }>
  | Readonly<{ intent: "replace-edge"; edge: unknown }>
  | Readonly<{
      intent: "group-members";
      groupNode: unknown;
      memberNodeIds: readonly string[];
    }>
  | Readonly<{ intent: "ungroup"; groupNodeId: string }>
  | Readonly<{
      intent: "paste-subgraph";
      nodes: readonly unknown[];
      edges: readonly unknown[];
    }>
  | Readonly<{
      intent: "replace-playlist-order";
      clipIds: readonly string[];
      nodeId: string;
    }>;

export type CanvasCommandJournalEntry =
  | Readonly<{
      changes: readonly UserFieldChange[];
      kind: "apply-user-field-changes";
      lane: string;
    }>
  | Readonly<{
      kind: "apply-topology";
      lane: string;
      mediaAdoptions?: readonly CanvasTopologyMediaAdoption[];
      operation: JournalTopologyOperation;
    }>
  | Readonly<{
      kind: "commit-user-layout";
      lane: string;
      nodes?: readonly Readonly<{
        nodeId: string;
        position?: Readonly<{ x: number; y: number }>;
        style?: Readonly<{ height?: number; width?: number }>;
        mediaSizingMode?: "auto" | "manual" | null;
        zIndex?: number;
      }>[];
      viewport?: Readonly<{ x: number; y: number; zoom: number }>;
    }>
  | Readonly<{
      asset: AdoptedCanvasAsset;
      kind: "adopt-uploaded-asset";
      lane: string;
      mediaKind: "audio" | "image" | "video";
      nodeId: string;
    }>
  | Readonly<{
      asset: AdoptedCanvasAsset;
      kind: "edit-result-and-invalidate-proof";
      lane: string;
      nodeId: string;
      outputBackground?: string;
      sourceAssetId: string;
      toolOperation: string;
      toolOperationId: string;
    }>;

export type CanvasCommandIntent = Readonly<{
  entry: CanvasCommandJournalEntry;
  lane: string;
  materialize: (
    base: ExistingCanvasCommandBase,
    current: AuthoritativeCanvasDocument,
  ) => Exclude<CanvasUserCommand, { kind: "create-canvas-document" }> | undefined;
}>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function idOf(value: unknown) {
  return String(record(value)?.id ?? "");
}

function byId(values: readonly unknown[]) {
  return new Map(values.flatMap((value) => {
    const id = idOf(value);
    return id ? [[id, value] as const] : [];
  }));
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function topologyAffectedProjection(
  document: CanvasCommandTargetDocument,
  operation: CanvasTopologyOperation,
) {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (operation.intent === "create-node") nodeIds.add(idOf(operation.node));
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
    const edge = document.edges.map(record).find((item) =>
      item?.id === operation.edgeId
    );
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
    nodeIds.add(idOf(operation.groupNode));
    operation.memberNodeIds.forEach((id) => nodeIds.add(id));
  }
  if (operation.intent === "ungroup") {
    nodeIds.add(operation.groupNodeId);
    operation.memberNodeIds.forEach((id) => nodeIds.add(id));
  }
  if (operation.intent === "paste-subgraph") {
    operation.nodes.forEach((node) => nodeIds.add(idOf(node)));
    operation.edges.forEach((value) => {
      const edge = record(value);
      edgeIds.add(String(edge?.id ?? ""));
      nodeIds.add(String(edge?.source ?? ""));
      nodeIds.add(String(edge?.target ?? ""));
    });
  }
  if (operation.intent === "replace-playlist-order") {
    nodeIds.add(operation.nodeId);
  }
  return {
    edges: document.edges.filter((value) => {
      const edge = record(value);
      return edgeIds.has(String(edge?.id ?? "")) ||
        nodeIds.has(String(edge?.source ?? "")) ||
        nodeIds.has(String(edge?.target ?? ""));
    }),
    identity: {
      edgeIds: uniqueSorted([...edgeIds].filter(Boolean)),
      intent: operation.intent,
      nodeIds: uniqueSorted([...nodeIds].filter(Boolean)),
    },
    nodes: document.nodes.filter((node) => nodeIds.has(idOf(node))),
  };
}

export function canvasTopologyAffectedDigestForCommand(
  document: CanvasCommandTargetDocument,
  operation: CanvasTopologyOperation,
) {
  return stableSha256(topologyAffectedProjection(document, operation));
}

const specializedImageFields = new Set([
  "imageAssetOrigin",
  "imageToolOperation",
  "imageToolOperationId",
  "imageToolOutputBackground",
]);

function commandNode(value: unknown) {
  const node = record(userOwnedCanvasNodeProjection(value));
  if (!node) return value;
  const data = record(node.data);
  if (!data) return node;
  const nextData = { ...data };
  for (const field of specializedImageFields) delete nextData[field];
  return { ...node, data: nextData };
}

function commandEdge(value: unknown) {
  return userOwnedCanvasEdgeProjection(value);
}

function currentNodeData(current: AuthoritativeCanvasDocument, nodeId: string) {
  return record(record(current.nodes.find((value) => idOf(value) === nodeId))?.data);
}

function materializeTopologyOperation(
  entry: Extract<CanvasCommandJournalEntry, { kind: "apply-topology" }>,
  current: AuthoritativeCanvasDocument,
): CanvasTopologyOperation | undefined {
  const operation = entry.operation;
  if (operation.intent === "delete-subgraph") {
    const nodeIds = operation.nodeIds.filter((id) =>
      current.nodes.some((value) => idOf(value) === id)
    );
    if (nodeIds.length === 0) return undefined;
    const deleting = new Set(nodeIds);
    const edgeIds = current.edges.filter((value) => {
      const edge = record(value);
      return deleting.has(String(edge?.source ?? "")) ||
        deleting.has(String(edge?.target ?? ""));
    }).map(idOf);
    return { edgeIds, intent: "delete-subgraph", nodeIds };
  }
  if (operation.intent === "connect-edge") {
    const currentEdge = current.edges.find((value) => idOf(value) === idOf(operation.edge));
    if (currentEdge && stableSha256(commandEdge(currentEdge)) ===
        stableSha256(commandEdge(operation.edge))) return undefined;
    return { edge: operation.edge, intent: "connect-edge" };
  }
  if (operation.intent === "disconnect-edge") {
    return current.edges.some((value) => idOf(value) === operation.edgeId)
      ? { edgeId: operation.edgeId, intent: "disconnect-edge" }
      : undefined;
  }
  if (operation.intent === "replace-edge") {
    const currentEdge = current.edges.find((value) =>
      idOf(value) === idOf(operation.edge)
    );
    if (!currentEdge) return { edge: operation.edge, intent: "replace-edge" };
    return stableSha256(commandEdge(currentEdge)) ===
        stableSha256(commandEdge(operation.edge))
      ? undefined
      : { edge: operation.edge, intent: "replace-edge" };
  }
  if (operation.intent === "group-members") {
    const existingGroup = current.nodes.find((value) =>
      idOf(value) === idOf(operation.groupNode)
    );
    if (existingGroup && operation.memberNodeIds.every((memberId) =>
      record(current.nodes.find((value) => idOf(value) === memberId))?.parentId ===
        idOf(operation.groupNode)
    )) return undefined;
    return {
      groupNode: operation.groupNode,
      intent: "group-members",
      memberNodeIds: operation.memberNodeIds,
    };
  }
  if (operation.intent === "ungroup") {
    const group = current.nodes.find((value) => idOf(value) === operation.groupNodeId);
    if (!group && current.nodes.every((value) =>
      record(value)?.parentId !== operation.groupNodeId
    )) return undefined;
    return {
      groupNodeId: operation.groupNodeId,
      intent: "ungroup",
      memberNodeIds: current.nodes.filter((value) =>
        record(value)?.parentId === operation.groupNodeId
      ).map(idOf),
    };
  }
  if (operation.intent === "paste-subgraph") {
    const nodesMatch = operation.nodes.every((value) => {
      const existing = current.nodes.find((candidate) => idOf(candidate) === idOf(value));
      return existing && stableSha256(commandNode(existing)) === stableSha256(value);
    });
    const edgesMatch = operation.edges.every((value) => {
      const existing = current.edges.find((candidate) => idOf(candidate) === idOf(value));
      return existing && stableSha256(commandEdge(existing)) === stableSha256(value);
    });
    const mediaMatch = (entry.mediaAdoptions ?? []).every((adoption) =>
      currentNodeData(current, adoption.nodeId)?.assetId === adoption.asset.assetId
    );
    return nodesMatch && edgesMatch && mediaMatch
      ? undefined
      : { edges: operation.edges, intent: "paste-subgraph", nodes: operation.nodes };
  }
  const data = currentNodeData(current, operation.nodeId);
  const clips = Array.isArray(data?.playlistClips) ? data.playlistClips : undefined;
  if (clips && clips.map(idOf).join("\u0000") === operation.clipIds.join("\u0000")) {
    return undefined;
  }
  return {
    clipIds: operation.clipIds,
    intent: "replace-playlist-order",
    nodeId: operation.nodeId,
  };
}

export function canvasCommandIntentFromJournalEntry(
  entry: CanvasCommandJournalEntry,
): CanvasCommandIntent {
  return Object.freeze({
    entry,
    lane: entry.lane,
    materialize(base, current) {
      if (entry.kind === "apply-topology") {
        const topologyOperation = materializeTopologyOperation(entry, current);
        if (!topologyOperation) return undefined;
        const command: ApplyTopologyCommand = {
          ...base,
          affectedTopologyDigest: canvasTopologyAffectedDigestForCommand(
            current,
            topologyOperation,
          ),
          kind: "apply-topology",
          ...(entry.mediaAdoptions
            ? { mediaAdoptions: entry.mediaAdoptions }
            : {}),
          topologyOperation,
        };
        return command;
      }
      if (entry.kind === "apply-user-field-changes") {
        return entry.changes.length > 0
          ? { ...base, changes: entry.changes, kind: entry.kind }
          : undefined;
      }
      if (entry.kind === "commit-user-layout") {
        const nodes = (entry.nodes ?? []).filter((layout) => {
          const node = record(current.nodes.find((value) => idOf(value) === layout.nodeId));
          if (!node) return true;
          const style = record(node.style) ?? {};
          return (layout.mediaSizingMode !== undefined &&
              (record(node.data)?.mediaSizingMode ?? null) !== layout.mediaSizingMode) ||
            (layout.position !== undefined &&
              stableSha256(node.position) !== stableSha256(layout.position)) ||
            (layout.style?.height !== undefined &&
              style.height !== layout.style.height) ||
            (layout.style?.width !== undefined && style.width !== layout.style.width) ||
            (layout.zIndex !== undefined && node.zIndex !== layout.zIndex);
        });
        const viewport = entry.viewport &&
            stableSha256(current.viewport) !== stableSha256(entry.viewport)
          ? entry.viewport
          : undefined;
        return nodes.length > 0 || viewport
          ? {
              ...base,
              kind: entry.kind,
              ...(nodes.length > 0 ? { nodes } : {}),
              ...(viewport ? { viewport } : {}),
            }
          : undefined;
      }
      const currentData = currentNodeData(current, entry.nodeId);
      if (currentData?.assetId === entry.asset.assetId) return undefined;
      if (entry.kind === "adopt-uploaded-asset") {
        return {
          ...base,
          asset: entry.asset,
          kind: entry.kind,
          mediaKind: entry.mediaKind,
          nodeId: entry.nodeId,
        };
      }
      return {
        ...base,
        asset: entry.asset,
        kind: entry.kind,
        nodeId: entry.nodeId,
        ...(entry.outputBackground === undefined
          ? {}
          : { outputBackground: entry.outputBackground }),
        sourceAssetId: entry.sourceAssetId,
        toolOperation: entry.toolOperation,
        toolOperationId: entry.toolOperationId,
      };
    },
  });
}

function mediaAsset(data: Record<string, unknown>, kind: "audio" | "image" | "video") {
  const byteSize = data.mediaByteSize ?? data[`${kind}FileSize`];
  const src = data[`${kind}Src`];
  if (
    typeof data.assetId !== "string" || !data.assetId ||
    !Number.isSafeInteger(byteSize) || Number(byteSize) < 0 ||
    typeof data.mediaContentType !== "string" || !data.mediaContentType ||
    typeof src !== "string" || !src.startsWith("/api/") ||
    (data.mediaStorageBackend !== "local" && data.mediaStorageBackend !== "oss")
  ) return undefined;
  return {
    assetId: data.assetId,
    byteSize: Number(byteSize),
    contentType: data.mediaContentType,
    ...(data.mediaDurationSeconds === undefined
      ? {}
      : { durationSeconds: Number(data.mediaDurationSeconds) }),
    ...(data.mediaHeight === undefined ? {} : { height: Number(data.mediaHeight) }),
    src,
    storageBackend: data.mediaStorageBackend,
    ...(data.mediaWidth === undefined ? {} : { width: Number(data.mediaWidth) }),
  } satisfies AdoptedCanvasAsset;
}

function mediaAdoption(
  nodeId: string,
  data: Record<string, unknown>,
  kind: "audio" | "image" | "video",
): CanvasTopologyMediaAdoption | undefined {
  const asset = mediaAsset(data, kind);
  if (!asset) return undefined;
  if (kind === "image" && data.imageAssetOrigin === "image-tool" &&
      typeof data.imageToolSourceAssetId === "string" &&
      typeof data.imageToolOperation === "string" &&
      typeof data.imageToolOperationId === "string") {
    return {
      asset,
      kind: "edit-result-and-invalidate-proof",
      nodeId,
      ...(typeof data.imageToolOutputBackground === "string"
        ? { outputBackground: data.imageToolOutputBackground }
        : {}),
      sourceAssetId: data.imageToolSourceAssetId,
      toolOperation: data.imageToolOperation,
      toolOperationId: data.imageToolOperationId,
    };
  }
  return {
    asset,
    kind: "adopt-uploaded-asset",
    mediaKind: kind,
    nodeId,
  };
}

function serverResultIdentityPresent(data: Record<string, unknown>, kind: string) {
  return typeof data.groupRunSuccessTaskId === "string" ||
    typeof data[`${kind}GenerationTaskId`] === "string";
}

function explicitlyDetachesServerResultForUpload(
  beforeData: Record<string, unknown> | undefined,
  targetData: Record<string, unknown>,
  kind: string,
) {
  return Boolean(
    beforeData && serverResultIdentityPresent(beforeData, kind) &&
    !serverResultIdentityPresent(targetData, kind) &&
    targetData.workflowExecutionRunId === undefined,
  );
}

function selectsExistingAudioResultChoice(
  beforeData: Record<string, unknown> | undefined,
  targetData: Record<string, unknown>,
) {
  if (!beforeData || !Array.isArray(beforeData.audioResultChoices)) return false;
  const targetAssetId = targetData.assetId;
  const targetSource = targetData.audioSrc;
  if (
    typeof targetAssetId !== "string" || !targetAssetId ||
    typeof targetSource !== "string" || !targetSource
  ) return false;
  const choice = beforeData.audioResultChoices.map(record).find((candidate) =>
    candidate?.assetId === targetAssetId && candidate.url === targetSource
  );
  return Boolean(choice && beforeData.assetId !== targetAssetId);
}

function topologyEntry(
  lane: string,
  operation: JournalTopologyOperation,
  mediaAdoptions?: readonly CanvasTopologyMediaAdoption[],
) {
  return canvasCommandIntentFromJournalEntry({
    kind: "apply-topology",
    lane,
    ...(mediaAdoptions && mediaAdoptions.length > 0 ? { mediaAdoptions } : {}),
    operation,
  });
}

function playlistIds(value: unknown) {
  return Array.isArray(value) ? value.map(idOf) : undefined;
}

function playlistOnlyReordered(before: unknown, target: unknown) {
  const beforeClips = Array.isArray(before) ? before : undefined;
  const targetClips = Array.isArray(target) ? target : undefined;
  if (!beforeClips || !targetClips || beforeClips.length !== targetClips.length) {
    return false;
  }
  const beforeById = byId(beforeClips);
  return targetClips.every((clip) => {
    const previous = beforeById.get(idOf(clip));
    return previous !== undefined && stableSha256(previous) === stableSha256(clip);
  });
}

export function planCanvasCommandIntents(
  before: AuthoritativeCanvasDocument,
  target: CanvasCommandTargetDocument,
): readonly CanvasCommandIntent[] {
  const intents: CanvasCommandIntent[] = [];
  const beforeNodes = byId(before.nodes);
  const targetNodes = byId(target.nodes);
  const beforeEdges = byId(before.edges);
  const targetEdges = byId(target.edges);
  const ungrouped = new Set<string>();
  const grouped = new Set<string>();
  const playlistReorders = new Set<string>();

  for (const [id, value] of beforeNodes) {
    const node = record(value);
    if (node?.type !== "group" || targetNodes.has(id)) continue;
    const members = before.nodes.filter((candidate) =>
      record(candidate)?.parentId === id
    ).map(idOf);
    if (members.every((memberId) => {
      const targetMember = record(targetNodes.get(memberId));
      return targetMember && targetMember.parentId === undefined;
    })) {
      ungrouped.add(id);
      intents.push(topologyEntry(`ungroup:${id}`, {
        groupNodeId: id,
        intent: "ungroup",
      }));
    }
  }

  const deletedNodeIds = [...beforeNodes.keys()].filter((id) =>
    !targetNodes.has(id) && !ungrouped.has(id)
  );
  if (deletedNodeIds.length > 0) {
    intents.push(topologyEntry("delete-subgraph", {
      intent: "delete-subgraph",
      nodeIds: deletedNodeIds,
    }));
  }

  for (const [id, value] of targetNodes) {
    const targetNode = record(value);
    if (beforeNodes.has(id) || targetNode?.type !== "group") continue;
    const members = target.nodes.filter((candidate) =>
      record(candidate)?.parentId === id
    ).map(idOf);
    if (members.length > 0 && members.every((memberId) => beforeNodes.has(memberId))) {
      grouped.add(id);
      intents.push(topologyEntry(`group:${id}`, {
        groupNode: commandNode(value),
        intent: "group-members",
        memberNodeIds: members,
      }));
    }
  }

  const addedNodeEntries = [...targetNodes.entries()].filter(([id]) =>
    !beforeNodes.has(id) && !grouped.has(id)
  );
  const addedNodeIds = new Set(addedNodeEntries.map(([id]) => id));
  const pastedEdges = [...targetEdges.entries()].filter(([id, value]) => {
    if (beforeEdges.has(id)) return false;
    const edge = record(value);
    return addedNodeIds.has(String(edge?.source ?? "")) ||
      addedNodeIds.has(String(edge?.target ?? ""));
  });
  const pastedEdgeIds = new Set(pastedEdges.map(([id]) => id));
  const addedNodes = addedNodeEntries.map(([, value]) => commandNode(value));
  if (addedNodes.length > 0) {
    const mediaAdoptions = addedNodeEntries.flatMap(([nodeId, value]) => {
      const node = record(value);
      const data = record(node?.data);
      const kind = String(node?.type ?? "");
      if (!data || !["audio", "image", "video"].includes(kind) ||
          typeof data.assetId !== "string") return [];
      const adoption = mediaAdoption(
        nodeId,
        data,
        kind as "audio" | "image" | "video",
      );
      if (!adoption) throw new Error("Canvas media adoption is incomplete");
      return [adoption];
    });
    intents.push(topologyEntry("paste-nodes", {
      edges: pastedEdges.map(([, value]) => commandEdge(value)),
      intent: "paste-subgraph",
      nodes: addedNodes,
    }, mediaAdoptions));
  }

  for (const [id, beforeValue] of beforeEdges) {
    const targetValue = targetEdges.get(id);
    if (targetValue && stableSha256(commandEdge(beforeValue)) ===
        stableSha256(commandEdge(targetValue))) continue;
    const edge = record(beforeValue);
    if (deletedNodeIds.includes(String(edge?.source ?? "")) ||
        deletedNodeIds.includes(String(edge?.target ?? "")) ||
        ungrouped.has(String(edge?.source ?? "")) ||
        ungrouped.has(String(edge?.target ?? ""))) continue;
    intents.push(targetValue
      ? topologyEntry(`replace:${id}`, {
          edge: commandEdge(targetValue),
          intent: "replace-edge",
        })
      : topologyEntry(`disconnect:${id}`, {
          edgeId: id,
          intent: "disconnect-edge",
        }));
  }
  for (const [id, targetValue] of targetEdges) {
    if (pastedEdgeIds.has(id)) continue;
    const beforeValue = beforeEdges.get(id);
    if (beforeValue) continue;
    intents.push(topologyEntry(`connect:${id}`, {
      edge: commandEdge(targetValue),
      intent: "connect-edge",
    }));
  }

  for (const [nodeId, targetValue] of targetNodes) {
    if (!beforeNodes.has(nodeId)) continue;
    const node = record(targetValue);
    const data = record(node?.data);
    const kind = String(node?.type ?? "");
    const beforeData = record(record(beforeNodes.get(nodeId))?.data);
    if (!node || !data || !["audio", "image", "video"].includes(kind)) continue;
    if (
      serverResultIdentityPresent(beforeData ?? data, kind) &&
      !explicitlyDetachesServerResultForUpload(beforeData, data, kind) &&
      !(kind === "audio" && selectsExistingAudioResultChoice(beforeData, data))
    ) continue;
    if (data.assetId === beforeData?.assetId || typeof data.assetId !== "string") {
      continue;
    }
    const adoption = mediaAdoption(
      nodeId,
      data,
      kind as "audio" | "image" | "video",
    );
    if (!adoption) continue;
    if (adoption.kind === "edit-result-and-invalidate-proof") {
      intents.push(canvasCommandIntentFromJournalEntry({
        asset: adoption.asset,
        kind: "edit-result-and-invalidate-proof",
        lane: `image-tool:${nodeId}`,
        nodeId,
        ...(adoption.outputBackground === undefined
          ? {}
          : { outputBackground: adoption.outputBackground }),
        sourceAssetId: adoption.sourceAssetId,
        toolOperation: adoption.toolOperation,
        toolOperationId: adoption.toolOperationId,
      }));
    } else {
      intents.push(canvasCommandIntentFromJournalEntry({
        asset: adoption.asset,
        kind: "adopt-uploaded-asset",
        lane: `upload:${nodeId}`,
        mediaKind: adoption.mediaKind,
        nodeId,
      }));
    }
  }

  for (const [nodeId, targetValue] of targetNodes) {
    const beforeNode = record(beforeNodes.get(nodeId));
    const targetNode = record(targetValue);
    if (beforeNode?.type !== "playlist" || targetNode?.type !== "playlist") continue;
    const beforeClips = record(beforeNode.data)?.playlistClips;
    const targetClips = record(targetNode.data)?.playlistClips;
    const targetIds = playlistIds(targetClips);
    if (targetIds && stableSha256(beforeClips) !== stableSha256(targetClips) &&
        playlistOnlyReordered(beforeClips, targetClips)) {
      playlistReorders.add(nodeId);
      intents.push(topologyEntry(`playlist-order:${nodeId}`, {
        clipIds: targetIds,
        intent: "replace-playlist-order",
        nodeId,
      }));
    }
  }

  const changes = [...targetNodes.entries()].flatMap(([nodeId, targetValue]) => {
    const beforeValue = beforeNodes.get(nodeId);
    if (!beforeValue) return [];
    const beforeNode = record(beforeValue);
    const targetNode = record(targetValue);
    if (!beforeNode || !targetNode || beforeNode.type !== targetNode.type) return [];
    const beforeData = record(beforeNode.data) ?? {};
    const targetData = record(targetNode.data) ?? {};
    return Object.entries(canvasNodeDataFieldDescriptors).flatMap(
      ([field, descriptor]) => {
        if (playlistReorders.has(nodeId) && field === "playlistClips") return [];
        if (descriptor.owner !== "durable-user" ||
            !descriptor.allowedCommands.includes("apply-user-field-changes")) {
          return [];
        }
        const beforePresent = Object.prototype.hasOwnProperty.call(beforeData, field);
        const targetPresent = Object.prototype.hasOwnProperty.call(targetData, field);
        if (beforePresent === targetPresent &&
            stableSha256(beforeData[field]) === stableSha256(targetData[field])) {
          return [];
        }
        return [{
          action: targetPresent ? "set" as const : "delete" as const,
          baseValueDigest: stableSha256(beforeData[field]),
          field: `data.${field}` as `data.${string}`,
          nodeId,
          ...(targetPresent ? { value: targetData[field] } : {}),
        }];
      },
    );
  });
  for (let index = 0; index < changes.length; index += 100) {
    const chunk = changes.slice(index, index + 100);
    intents.push(canvasCommandIntentFromJournalEntry({
      changes: chunk,
      kind: "apply-user-field-changes",
      lane: `user-fields:${index / 100}`,
    }));
  }

  const layouts = [...targetNodes.entries()].flatMap(([nodeId, targetValue]) => {
    const beforeValue = beforeNodes.get(nodeId);
    if (!beforeValue) return [];
    const previous = record(beforeValue) ?? {};
    const next = record(targetValue) ?? {};
    const previousStyle = record(previous.style) ?? {};
    const nextStyle = record(next.style) ?? {};
    const nextMode = record(next.data)?.mediaSizingMode;
    const modeChanged = record(previous.data)?.mediaSizingMode !== nextMode;
    const positionChanged = stableSha256(previous.position) !== stableSha256(next.position);
    const autoAdoption = record(previous.data)?.assetId !== record(next.data)?.assetId &&
      !modeChanged && nextMode === "auto" &&
      stableSha256(nextStyle) === stableSha256(adoptedMediaStyle(next, record(next.data) ?? {}));
    const widthChanged = !autoAdoption && previousStyle.width !== nextStyle.width;
    const heightChanged = !autoAdoption && previousStyle.height !== nextStyle.height;
    const zIndexChanged = previous.zIndex !== next.zIndex;
    if (!positionChanged && !widthChanged && !heightChanged && !zIndexChanged && !modeChanged) return [];
    return [{
      nodeId,
      ...((modeChanged || widthChanged || heightChanged) && (next.type === "image" || next.type === "video") ? { mediaSizingMode: nextMode === "auto" || nextMode === "manual" ? nextMode as "auto" | "manual" : null } : {}),
      ...(positionChanged && record(next.position)
        ? { position: next.position as { x: number; y: number } }
        : {}),
      ...(widthChanged || heightChanged
        ? { style: {
            ...(heightChanged && typeof nextStyle.height === "number"
              ? { height: nextStyle.height }
              : {}),
            ...(widthChanged && typeof nextStyle.width === "number"
              ? { width: nextStyle.width }
              : {}),
          } }
        : {}),
      ...(zIndexChanged && Number.isSafeInteger(next.zIndex)
        ? { zIndex: Number(next.zIndex) }
        : {}),
    }];
  }).filter((value) => value.mediaSizingMode !== undefined || value.position || value.style &&
    Object.keys(value.style).length > 0 || value.zIndex !== undefined);
  const viewportChanged = stableSha256(before.viewport) !== stableSha256(target.viewport);
  if (layouts.length > 0 || viewportChanged) {
    intents.push(canvasCommandIntentFromJournalEntry({
      kind: "commit-user-layout",
      lane: "layout",
      ...(layouts.length > 0 ? { nodes: layouts } : {}),
      ...(viewportChanged ? { viewport: target.viewport } : {}),
    }));
  }
  return Object.freeze(intents);
}

export function canvasCommandJournalEntries(
  intents: readonly CanvasCommandIntent[],
) {
  return intents.map((intent) => intent.entry);
}

export function userOwnedCanvasTarget(document: CanvasCommandTargetDocument) {
  return userOwnedCanvasDocumentProjection(document);
}

export function initialCanvasCommandDocument(
  document: CanvasCommandTargetDocument,
) {
  return {
    edges: document.edges.map(commandEdge),
    nodes: document.nodes.map(commandNode),
    viewport: { ...document.viewport },
  };
}

export function commandOperationId(input: Readonly<{
  attemptId: string;
  command: CanvasUserCommand;
  lane: string;
}>) {
  return `save-op:${input.attemptId}:${stableSha256({
    command: { ...input.command, operationId: undefined },
    lane: input.lane,
  })}`;
}

export function commandSessionId(baseSessionId: string, lane: string) {
  return `cmd-${stableSha256({ baseSessionId, lane }).slice(0, 48)}`;
}

/** Apply only task-bound server result fields. The baseline receives the same
 * patch, so generated text is never mistaken for a new user command. Local
 * topology, input edits and view state retain their existing authority. */
export function mergeWorkflowResultNodes(input: {
  baseline: readonly unknown[];
  current: readonly unknown[];
  incoming: readonly unknown[];
  run: WorkflowRunSummary;
}) {
  const baseline = byId(input.baseline);
  const incoming = byId(input.incoming);
  const proofs = new Map(input.run.nodes.filter((node) =>
    node.state === "success" && node.projectionState === "applied" && node.taskId
  ).map((node) => [node.id, node]));
  const patches = new Map<string, Record<string, unknown>>();
  const mediaStyles = new Map<string, Record<string, unknown>>();
  const conflicts: string[] = [];
  const resultFields = Object.entries(canvasNodeDataFieldDescriptors)
    .filter(([, field]) => field.owner === "durable-server")
    .map(([field]) => field);
  const nodes = input.current.map((value) => {
    const id = idOf(value);
    const proof = proofs.get(id);
    if (!proof) return value;
    const local = record(value)!;
    const before = record(baseline.get(id));
    const remote = record(incoming.get(id));
    const currentData = record(local.data);
    const beforeData = record(before?.data);
    const remoteData = record(remote?.data);
    if (!before || !beforeData || !remoteData || !currentData ||
        local.type !== proof.kind || before.type !== proof.kind || remote?.type !== proof.kind ||
        remoteData.groupRunSuccessTaskId !== proof.taskId ||
        !remoteData.groupRunSuccessOwnershipKey || !remoteData.groupRunSuccessResultKey ||
        (currentData.groupRunSuccessTaskId !== beforeData.groupRunSuccessTaskId &&
          currentData.groupRunSuccessTaskId !== proof.taskId)) return value;
    // Deletion/replacement/input changes invalidate the old target. Workflow
    // locks separately prohibit semantic edits to a currently executing node.
    const inputChanged = Object.entries(canvasNodeDataFieldDescriptors).some(([key, field]) =>
      field.owner === "durable-user" && field.input && key !== "content" && key !== "contentHtml" &&
      stableSha256(currentData[key] ?? null) !== stableSha256(beforeData[key] ?? null)
    );
    if (inputChanged) return value;
    const fields = [...resultFields, `${proof.kind}Generating`,
      `${proof.kind}GenerationError`, `${proof.kind}GenerationErrorCode`,
      `${proof.kind}GenerationRetryAllowed`, `${proof.kind}GenerationRetryBlockCode`,
      `${proof.kind}GenerationRetryBlockReason`];
    if (proof.kind === "text") fields.push("content", "contentHtml");
    const patch = Object.fromEntries(fields.map((field) => [field, remoteData[field]]));
    patches.set(id, patch);
    const textConflict = proof.kind === "text" && ["content", "contentHtml"].some((field) =>
      stableSha256(currentData[field] ?? null) !== stableSha256(beforeData[field] ?? null) &&
      stableSha256(currentData[field] ?? null) !== stableSha256(remoteData[field] ?? null)
    );
    if (textConflict) {
      conflicts.push(id);
      return value;
    }
    const fitted = adoptedMediaStyle(remote!, remoteData);
    if (fitted && stableSha256(remote?.style) === stableSha256(fitted)) mediaStyles.set(id, fitted);
    const preserveLocalLayout = currentData.mediaSizingMode !== "auto" ||
      stableSha256(local.style) !== stableSha256(before.style);
    return { ...local, data: { ...currentData, ...patch },
      ...(!preserveLocalLayout && mediaStyles.has(id) ? { style: mediaStyles.get(id), width: undefined, height: undefined, measured: undefined } : {}) };
  });
  return {
    baseline: input.baseline.map((value) => {
      const patch = patches.get(idOf(value));
      const node = record(value);
      return patch && node ? { ...node, data: { ...record(node.data), ...patch },
        ...(mediaStyles.has(idOf(value)) ? { style: mediaStyles.get(idOf(value)) } : {}) } : value;
    }),
    conflicts,
    nodes,
    received: [...patches.keys()],
  };
}
