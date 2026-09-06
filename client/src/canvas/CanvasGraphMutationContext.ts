import { adoptedMediaStyle } from "../../../types/mediaGeometry";
import {
  createContext,
  useContext,
  type SetStateAction,
} from "react";
import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";
import type { CanvasGraphCommandPort } from "./canvasPorts";
import type { CanvasModelTransitionPort } from "./CanvasModelTransitionCommand";
import type { AdoptedCanvasAsset } from "../../../types/canvasCommands";
import {
  canvasEdgeDataFieldDescriptors,
  canvasEdgeTopLevelFieldDescriptors,
  canvasNodeDataFieldDescriptor,
  canvasNodeTopLevelFieldDescriptors,
  durableCanvasNodes,
  stableSha256,
} from "../../../types/canvasFingerprint";

type CanvasNodeDataPatch = Partial<ProbeNodeType["data"]>;

/**
 * Upload responses may survive unrelated live topology changes, but they must
 * not overwrite a durable change to their own target node while bytes were in
 * flight. Ephemeral upload progress is intentionally excluded.
 */
export function canvasUploadTargetStillCurrent(
  baseline: ProbeNodeType | undefined,
  current: ProbeNodeType | undefined,
) {
  return Boolean(
    baseline && current && baseline.id === current.id &&
      baseline.type === current.type &&
      stableSha256(durableCanvasNodes([baseline])) ===
        stableSha256(durableCanvasNodes([current])),
  );
}

export type CanvasAuthoritativeNodeDataAdoption = Readonly<{
  expectedAssetId?: string;
  expectedTask?: Readonly<{
    kind: "audio" | "image" | "text" | "video";
    taskId: string;
  }>;
  nodeId: string;
  patch: CanvasNodeDataPatch;
}>;

export type CanvasUploadedAssetAdoption = Readonly<{
  asset: AdoptedCanvasAsset & Readonly<{ hasTransparency?: boolean }>;
  mediaKind: "audio" | "image" | "video";
  rollbackTarget?: ProbeNodeType;
  targetNodeId: string;
  update: SetStateAction<ProbeNodeType[]>;
}>;

function canvasValuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (
    typeof left === "function" || typeof right === "function" ||
    typeof left === "symbol" || typeof right === "symbol"
  ) return false;
  return stableSha256(left) === stableSha256(right);
}

function canvasRecordFieldChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  field: string,
) {
  const beforePresent = Object.prototype.hasOwnProperty.call(before, field);
  const afterPresent = Object.prototype.hasOwnProperty.call(after, field);
  return beforePresent !== afterPresent ||
    !canvasValuesEqual(before[field], after[field]);
}

/**
 * Fail-closed classifier for local-only React Flow state. It rejects topology,
 * layout, user-document and server-document changes, including unknown fields.
 */
export function canvasViewUpdateAllowed(
  before: readonly ProbeNodeType[],
  after: readonly ProbeNodeType[],
) {
  if (
    before.length !== after.length ||
    before.some((node, index) => node.id !== after[index]?.id)
  ) return false;

  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === after[index]) continue;
    const beforeNode = before[index] as unknown as Record<string, unknown>;
    const afterNode = after[index] as unknown as Record<string, unknown>;
    for (const field of new Set([
      ...Object.keys(beforeNode),
      ...Object.keys(afterNode),
    ])) {
      if (field === "data") continue;
      if (!canvasRecordFieldChanged(beforeNode, afterNode, field)) continue;
      const descriptor = canvasNodeTopLevelFieldDescriptors[
        field as keyof typeof canvasNodeTopLevelFieldDescriptors
      ];
      if (descriptor?.owner !== "ephemeral-view") return false;
    }

    const beforeData = before[index].data as Record<string, unknown>;
    const afterData = after[index].data as Record<string, unknown>;
    for (const field of new Set([
      ...Object.keys(beforeData),
      ...Object.keys(afterData),
    ])) {
      if (!canvasRecordFieldChanged(beforeData, afterData, field)) continue;
      if (canvasNodeDataFieldDescriptor(field)?.owner !== "ephemeral-view") {
        return false;
      }
    }
  }
  return true;
}

export function canvasEdgeViewUpdateAllowed(
  before: readonly CuttableEdge[],
  after: readonly CuttableEdge[],
) {
  if (
    before.length !== after.length ||
    before.some((edge, index) => edge.id !== after[index]?.id)
  ) return false;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === after[index]) continue;
    const beforeEdge = before[index] as unknown as Record<string, unknown>;
    const afterEdge = after[index] as unknown as Record<string, unknown>;
    for (const field of new Set([
      ...Object.keys(beforeEdge),
      ...Object.keys(afterEdge),
    ])) {
      if (field === "data") continue;
      if (!canvasRecordFieldChanged(beforeEdge, afterEdge, field)) continue;
      const descriptor = canvasEdgeTopLevelFieldDescriptors[
        field as keyof typeof canvasEdgeTopLevelFieldDescriptors
      ];
      if (descriptor?.owner !== "ephemeral-view") return false;
    }
    const beforeData = (before[index].data ?? {}) as Record<string, unknown>;
    const afterData = (after[index].data ?? {}) as Record<string, unknown>;
    for (const field of new Set([
      ...Object.keys(beforeData),
      ...Object.keys(afterData),
    ])) {
      if (!canvasRecordFieldChanged(beforeData, afterData, field)) continue;
      const descriptor = canvasEdgeDataFieldDescriptors[
        field as keyof typeof canvasEdgeDataFieldDescriptors
      ];
      if (descriptor?.owner !== "ephemeral-view") return false;
    }
  }
  return true;
}

export function authoritativeCanvasNodeDataPatchAllowed(
  patch: Readonly<Record<string, unknown>>,
) {
  return Object.keys(patch).every((field) => {
    const owner = canvasNodeDataFieldDescriptor(field)?.owner;
    return owner === "durable-server" || owner === "ephemeral-view";
  });
}

const uploadedAssetServerFields = new Set([
  "assetId",
  "inputState",
  "inputStateReason",
  "mediaByteSize",
  "mediaContentType",
  "mediaDurationSeconds",
  "mediaHeight",
  "mediaMetadataSource",
  "mediaMetadataStatus",
  "mediaStorageBackend",
  "mediaWidth",
]);

function uploadedAssetServerValue(
  adoption: Pick<CanvasUploadedAssetAdoption, "asset" | "mediaKind">,
  field: string,
) {
  const { asset, mediaKind } = adoption;
  if (field === "assetId") return asset.assetId;
  if (field === "inputState") return "ready";
  if (field === "inputStateReason") return undefined;
  if (field === `${mediaKind}Src`) return asset.src;
  if (field === "mediaByteSize") return asset.byteSize;
  if (field === "mediaContentType") return asset.contentType;
  if (field === "mediaDurationSeconds") return asset.durationSeconds;
  if (field === "mediaHeight") return asset.height;
  if (field === "mediaMetadataSource") return "server";
  if (field === "mediaMetadataStatus") return "ready";
  if (field === "mediaStorageBackend") return asset.storageBackend;
  if (field === "mediaWidth") return asset.width;
  if (field === "imageHasTransparency" && mediaKind === "image") {
    return asset.hasTransparency;
  }
  if (field === "imageAssetOrigin" && mediaKind === "image") {
    return "local-upload";
  }
  return undefined;
}

function uploadedAssetMayClearServerField(
  field: string,
  mediaKind: CanvasUploadedAssetAdoption["mediaKind"],
) {
  return field === "workflowExecutionRunId" ||
    field.startsWith("groupRunSuccess") ||
    field.startsWith(`${mediaKind}Generation`) ||
    mediaKind === "video" && field === "videoInputContractFingerprint" ||
    mediaKind === "audio" && (
      field === "audioGeneratedResult" || field === "audioResultChoices"
    ) ||
    mediaKind === "image" && (
      field === "imageGeneratedSuccess" || field.startsWith("imageTool") ||
      field === "imageSeedanceValidation"
    );
}

/**
 * A browser upload may optimistically update its target and related user-input
 * nodes, but it cannot use the upload boundary as an arbitrary graph or
 * server-owned writer. The durable transport subsequently compiles this exact
 * state change into AdoptUploadedAsset plus bounded user/layout commands.
 */
export function canvasUploadedAssetAdoptionAllowed(
  before: readonly ProbeNodeType[],
  after: readonly ProbeNodeType[],
  adoption: Omit<CanvasUploadedAssetAdoption, "update">,
) {
  if (
    before.length !== after.length ||
    before.some((node, index) => node.id !== after[index]?.id) ||
    before.find((node) => node.id === adoption.targetNodeId)?.data.assetId ===
      adoption.asset.assetId
  ) return false;
  const target = after.find((node) => node.id === adoption.targetNodeId);
  if (
    !target || target.type !== adoption.mediaKind ||
    target.data.assetId !== adoption.asset.assetId ||
    target.data[`${adoption.mediaKind}Src`] !== adoption.asset.src ||
    target.data.mediaByteSize !== adoption.asset.byteSize ||
    target.data.mediaContentType !== adoption.asset.contentType ||
    target.data.mediaStorageBackend !== adoption.asset.storageBackend
  ) return false;

  for (let index = 0; index < before.length; index += 1) {
    const beforeNode = before[index]!;
    const afterNode = after[index]!;
    const targetNode = afterNode.id === adoption.targetNodeId;
    const beforeRecord = beforeNode as unknown as Record<string, unknown>;
    const afterRecord = afterNode as unknown as Record<string, unknown>;
    for (const field of new Set([
      ...Object.keys(beforeRecord),
      ...Object.keys(afterRecord),
    ])) {
      if (field === "data" ||
          !canvasRecordFieldChanged(beforeRecord, afterRecord, field)) continue;
      const descriptor = canvasNodeTopLevelFieldDescriptors[
        field as keyof typeof canvasNodeTopLevelFieldDescriptors
      ];
      if (targetNode && field === "style") {
        const fitted = adoptedMediaStyle(beforeNode, { ...beforeNode.data,
          mediaWidth: adoption.asset.width, mediaHeight: adoption.asset.height });
        if (fitted && stableSha256(fitted) === stableSha256(afterNode.style)) continue;
      }
      if (!descriptor || descriptor.owner !== "ephemeral-view") return false;
    }

    const beforeData = beforeNode.data as Record<string, unknown>;
    const afterData = afterNode.data as Record<string, unknown>;
    for (const field of new Set([
      ...Object.keys(beforeData),
      ...Object.keys(afterData),
    ])) {
      if (!canvasRecordFieldChanged(beforeData, afterData, field)) continue;
      const descriptor = canvasNodeDataFieldDescriptor(field);
      if (!descriptor) return false;
      if (descriptor.owner === "ephemeral-view") continue;
      if (descriptor.owner === "durable-user") {
        if (descriptor.allowedCommands.includes("apply-user-field-changes")) {
          continue;
        }
        if (
          targetNode && adoption.mediaKind === "image" &&
          ((field === "imageAssetOrigin" &&
              afterData[field] === "local-upload") ||
            (field.startsWith("imageTool") && afterData[field] === undefined))
        ) continue;
        return false;
      }
      if (descriptor.owner === "migration") {
        if (targetNode && afterData[field] === undefined) continue;
        return false;
      }
      if (!targetNode) return false;
      if (uploadedAssetMayClearServerField(field, adoption.mediaKind)) {
        if (afterData[field] === undefined || afterData[field] === false) continue;
        return false;
      }
      if (
        uploadedAssetServerFields.has(field) ||
        field === `${adoption.mediaKind}Src` ||
        adoption.mediaKind === "image" &&
          (field === "imageHasTransparency" || field === "imageAssetOrigin")
      ) {
        const expected = uploadedAssetServerValue(adoption, field);
        const actual = afterData[field];
        if (
          (expected === undefined || expected === null)
            ? actual === undefined || actual === null
            : canvasValuesEqual(actual, expected)
        ) continue;
      }
      return false;
    }
  }
  return true;
}

export function tryCommitCanvasNodeAdoption(input: {
  commit: (nodes: ProbeNodeType[]) => void;
  currentNodes: () => ProbeNodeType[];
  persistenceReady: () => boolean;
  targetNodeId: string;
  update: SetStateAction<ProbeNodeType[]>;
}) {
  if (!input.persistenceReady()) return false;
  const current = input.currentNodes();
  if (!current.some((node) => node.id === input.targetNodeId)) return false;
  const next = typeof input.update === "function"
    ? input.update(current)
    : input.update;
  if (!input.persistenceReady()) return false;
  input.commit(next);
  return true;
}

export async function settleCanvasMutationSaveIndicator(input: {
  currentFingerprint: () => string;
  onSaveSuccess: () => void;
  persistedFingerprint: () => string;
  settle: () => Promise<void>;
}) {
  await input.settle();
  if (input.currentFingerprint() !== input.persistedFingerprint()) return false;
  input.onSaveSuccess();
  return true;
}

function restoreChangedRecordFields(
  current: Record<string, unknown>,
  before: Record<string, unknown>,
  committed: Record<string, unknown>,
  excluded = new Set<string>(),
) {
  let restored = current;
  for (const key of new Set([...Object.keys(before), ...Object.keys(committed)])) {
    if (
      excluded.has(key) ||
      Object.is(before[key], committed[key]) ||
      !Object.is(current[key], committed[key])
    ) continue;
    if (restored === current) restored = { ...current };
    if (Object.prototype.hasOwnProperty.call(before, key)) {
      restored[key] = before[key];
    } else {
      delete restored[key];
    }
  }
  return restored;
}

export function rollbackCanvasNodeAdoption(input: {
  beforeById: ReadonlyMap<string, ProbeNodeType>;
  committedById: ReadonlyMap<string, ProbeNodeType>;
  current: ProbeNodeType[];
}) {
  let changed = false;
  const nodes = input.current.map((node) => {
    const beforeNode = input.beforeById.get(node.id);
    const committedNode = input.committedById.get(node.id);
    if (!beforeNode || !committedNode) return node;

    const currentRecord = node as unknown as Record<string, unknown>;
    const beforeRecord = beforeNode as unknown as Record<string, unknown>;
    const committedRecord = committedNode as unknown as Record<string, unknown>;
    let restoredRecord = restoreChangedRecordFields(
      currentRecord,
      beforeRecord,
      committedRecord,
      new Set(["data", "style"]),
    );
    const restoredData = restoreChangedRecordFields(
      node.data as Record<string, unknown>,
      beforeNode.data as Record<string, unknown>,
      committedNode.data as Record<string, unknown>,
    );
    if (restoredData !== node.data) {
      if (restoredRecord === currentRecord) restoredRecord = { ...currentRecord };
      restoredRecord.data = restoredData;
    }

    const currentStyle = (node.style ?? {}) as Record<string, unknown>;
    const beforeStyle = (beforeNode.style ?? {}) as Record<string, unknown>;
    const committedStyle = (committedNode.style ?? {}) as Record<string, unknown>;
    const restoredStyle = restoreChangedRecordFields(
      currentStyle,
      beforeStyle,
      committedStyle,
    );
    if (restoredStyle !== currentStyle) {
      if (restoredRecord === currentRecord) restoredRecord = { ...currentRecord };
      restoredRecord.style = beforeNode.style === undefined &&
          Object.keys(restoredStyle).length === 0
        ? undefined
        : restoredStyle;
    }
    if (restoredRecord === currentRecord) return node;
    changed = true;
    return restoredRecord as unknown as ProbeNodeType;
  });
  return changed ? nodes : input.current;
}

export const CanvasGraphMutationContext = createContext<{
  adoptUploadedAsset: (
    adoption: CanvasUploadedAssetAdoption,
    options?: Readonly<{ checkpoint?: boolean }>,
  ) => Promise<boolean>;
  adoptAuthoritativeNodeData: (
    adoption: CanvasAuthoritativeNodeDataAdoption,
  ) => boolean;
  applyEdgeViewUpdate: (update: SetStateAction<CuttableEdge[]>) => boolean;
  applyModelTransition?: CanvasModelTransitionPort["apply"];
  applyViewUpdate: (update: SetStateAction<ProbeNodeType[]>) => boolean;
  canvasMutationPendingNodeIds: ReadonlySet<string>;
  graphCommandPort?: CanvasGraphCommandPort;
  imageColorFilter?: string;
  mutateGraph: (update: (current: Readonly<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
  }>) => Readonly<{
    edges: CuttableEdge[];
    nodes: ProbeNodeType[];
  }>, options?: Readonly<{ checkpoint?: boolean }>) => Promise<boolean>;
  readCanvasNode: (nodeId: string) => ProbeNodeType | undefined;
  readCanvasMutationVersion: (nodeId: string) => number;
  setImageColorFilter: (color?: string) => void;
  tryAdoptNodes: (
    targetNodeId: string,
    update: SetStateAction<ProbeNodeType[]>,
    options?: Readonly<{ checkpoint?: boolean }>,
  ) => Promise<boolean>;
}>({
  adoptUploadedAsset: async () => false,
  adoptAuthoritativeNodeData: () => false,
  applyEdgeViewUpdate: () => false,
  applyModelTransition: undefined,
  applyViewUpdate: () => false,
  canvasMutationPendingNodeIds: new Set(),
  graphCommandPort: undefined,
  mutateGraph: async () => false,
  readCanvasNode: () => undefined,
  readCanvasMutationVersion: () => 0,
  setImageColorFilter: () => undefined,
  tryAdoptNodes: async () => false,
});

export function useCanvasGraphMutation() {
  return useContext(CanvasGraphMutationContext);
}
