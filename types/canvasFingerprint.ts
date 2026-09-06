type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

export type CanvasFieldOwner =
  | "durable-user"
  | "durable-server"
  | "ephemeral-view"
  | "migration";

export type CanvasFieldDescriptor = Readonly<{
  allowedCommands: readonly string[];
  canonicalizer: "json";
  documentImpact: boolean;
  durability: "durable" | "ephemeral";
  input: boolean;
  inputImpact: boolean;
  legacyAliases: readonly string[];
  owner: CanvasFieldOwner;
}>;

const descriptor = (
  owner: CanvasFieldOwner,
  input = false,
  allowedCommands: readonly string[] = [],
) => Object.freeze({
  allowedCommands: Object.freeze([...allowedCommands]),
  canonicalizer: "json" as const,
  documentImpact: owner !== "ephemeral-view",
  durability: owner === "ephemeral-view" ? "ephemeral" as const : "durable" as const,
  input,
  inputImpact: input,
  legacyAliases: Object.freeze([] as string[]),
  owner,
});

const userInput = descriptor("durable-user", true, ["apply-user-field-changes"]);
const userDocument = descriptor("durable-user", false, ["apply-user-field-changes"]);
const userTopology = descriptor("durable-user", true, ["apply-topology"]);
const userLayout = descriptor("durable-user", false, ["commit-user-layout"]);
const serverDocument = descriptor("durable-server", false, ["server.projection"]);
const serverInput = descriptor("durable-server", true, [
  "adopt-uploaded-asset",
  "server.projection",
]);
const ephemeralView = descriptor("ephemeral-view", false, ["apply-view-patch"]);
const migrationDocument = descriptor("migration", false, ["document.migration"]);

/**
 * One authoritative ownership table for node.data. A field missing from this
 * table is deliberately not browser-writable. Unknown persisted fields remain
 * part of the document hash so a newer server field cannot be silently erased.
 */
export const canvasNodeDataFieldDescriptors = Object.freeze({
  mediaSizingMode: userLayout,
  assetId: serverInput,
  groupRunSuccessOwnershipKey: serverDocument,
  groupRunSuccessInputFingerprint: serverDocument,
  groupRunSuccessModelConfigurationRevision: serverDocument,
  groupRunSuccessModelReleaseRevision: serverDocument,
  groupRunSuccessResultKey: serverDocument,
  groupRunSuccessTaskId: serverDocument,
  legacyTerminalDetachApplicationId: migrationDocument,
  workflowExecutionRunId: serverDocument,

  audioDuration: ephemeralView,
  audioFileSize: userDocument,
  audioFileName: userDocument,
  audioGeneratedResult: serverDocument,
  audioGenerationErrorCode: ephemeralView,
  audioGenerationError: ephemeralView,
  audioGenerationContractFingerprint: serverDocument,
  audioGenerationModelConfigurationRevision: serverDocument,
  audioGenerationInputKey: serverDocument,
  audioGenerationModelReleaseRevision: serverDocument,
  audioGenerationOwnershipKey: serverDocument,
  audioGenerationRetryAllowed: ephemeralView,
  audioGenerationRetryBlockCode: ephemeralView,
  audioGenerationRetryBlockReason: ephemeralView,
  audioGenerationTaskId: serverDocument,
  audioGenerating: ephemeralView,
  audioModelId: userInput,
  audioModelConfigurationRevision: userInput,
  audioModelName: userDocument,
  audioPrompt: userInput,
  audioPromptReady: userInput,
  audioParameters: userInput,
  audioResultChoices: serverDocument,
  audioSrc: serverDocument,
  audioWaveform: ephemeralView,

  content: userInput,
  contentHtml: userInput,

  imageGeneratedSuccess: serverDocument,
  imageHasTransparency: serverDocument,
  imageAssetOrigin: serverDocument,
  imageAnnotations: userInput,
  imageColorMarks: userInput,
  imageGenerationErrorCode: ephemeralView,
  imageGenerationError: ephemeralView,
  imageGenerationContractFingerprint: serverDocument,
  imageGenerationModelConfigurationRevision: serverDocument,
  imageGenerationInputKey: serverDocument,
  imageGenerationModelReleaseRevision: serverDocument,
  imageGenerationOwnershipKey: serverDocument,
  imageGenerationRetryAllowed: ephemeralView,
  imageGenerationRetryBlockCode: ephemeralView,
  imageGenerationRetryBlockReason: ephemeralView,
  imageGenerationTaskId: serverDocument,
  imageGenerating: ephemeralView,
  imageAspectRatio: userInput,
  imageModelId: userInput,
  imageModelConfigurationRevision: userInput,
  imageModelName: userDocument,
  imageMultiAngleParameters: userInput,
  imagePrompt: userInput,
  imagePromptReady: userInput,
  imageParameters: userInput,
  imageQuality: userInput,
  imageSrc: serverDocument,
  imageToolOperation: serverDocument,
  imageToolOperationId: serverDocument,
  imageToolGraphOperationId: serverDocument,
  imageToolGraphOperationRevision: serverDocument,
  imageToolGraphOwnershipKey: serverDocument,
  imageToolGraphRunId: serverDocument,
  imageToolGraphSourceAssetId: serverDocument,
  imageToolOutputBackground: serverDocument,
  imageToolMaskAssetId: serverDocument,
  imageToolMaskFeatherPixels: userInput,
  imageToolMaskHeight: serverDocument,
  imageToolMaskVersion: serverDocument,
  imageToolMaskWidth: serverDocument,
  imageToolOutpaintParameters: userInput,
  imageToolPreparedAssetId: serverDocument,
  imageToolPreparedHeight: serverDocument,
  imageToolPreparedVersion: serverDocument,
  imageToolPreparedWidth: serverDocument,
  imageToolSourceAssetId: serverDocument,
  imageSeedanceValidation: serverDocument,

  inputState: serverInput,
  inputStateReason: serverInput,
  inputViewState: ephemeralView,
  inputViewStateReason: ephemeralView,
  label: userDocument,
  mediaByteSize: serverDocument,
  mediaContentType: serverDocument,
  mediaDurationSeconds: serverDocument,
  mediaHeight: serverDocument,
  mediaMetadataSource: serverDocument,
  mediaMetadataStatus: serverDocument,
  mediaStorageBackend: serverDocument,
  mediaWidth: serverDocument,
  playlistClips: userInput,
  playlistPicking: ephemeralView,
  sourceKind: userInput,
  storyboardShots: userInput,

  textPrompt: userInput,
  textPromptReady: userInput,
  textGenerationError: ephemeralView,
  textGenerationErrorCode: ephemeralView,
  textGenerationContractFingerprint: serverDocument,
  textGenerationModelConfigurationRevision: serverDocument,
  textGenerationInputKey: serverDocument,
  textGenerationModelReleaseRevision: serverDocument,
  textGenerationOwnershipKey: serverDocument,
  textGenerationRetryAllowed: ephemeralView,
  textGenerationRetryBlockCode: ephemeralView,
  textGenerationRetryBlockReason: ephemeralView,
  textGenerating: ephemeralView,
  textGenerationTaskId: serverDocument,
  textParameters: userInput,
  textModelId: userInput,
  textModelConfigurationRevision: userInput,
  textModelName: userDocument,

  title: userDocument,
  groupColor: userDocument,
  groupTemplate: userInput,

  videoAudioEnabled: userInput,
  videoCreatedAt: serverDocument,
  videoDuration: ephemeralView,
  videoFileSize: userDocument,
  videoHeight: ephemeralView,
  videoGenerationError: ephemeralView,
  videoGenerationErrorCode: ephemeralView,
  videoGenerationContractFingerprint: serverDocument,
  videoGenerationModelConfigurationRevision: serverDocument,
  videoGenerationInputKey: serverDocument,
  videoGenerationModelInputContractFingerprint: serverDocument,
  videoGenerationModelReleaseRevision: serverDocument,
  videoGenerationOwnershipKey: serverDocument,
  videoGenerationRetryAllowed: ephemeralView,
  videoGenerationRetryBlockCode: ephemeralView,
  videoGenerationRetryBlockReason: ephemeralView,
  videoGenerationTaskId: serverDocument,
  videoGenerating: ephemeralView,
  videoModel: userInput,
  videoModelId: userInput,
  videoModelConfigurationRevision: userInput,
  videoPrompt: userInput,
  videoPromptReady: userInput,
  videoParameters: userInput,
  videoInputContractFingerprint: serverDocument,
  videoSrc: serverDocument,
  videoWidth: ephemeralView,
  variant: userInput,
} satisfies Readonly<Record<string, CanvasFieldDescriptor>>);

export const canvasNodeTopLevelFieldDescriptors = Object.freeze({
  id: userTopology,
  type: userTopology,
  data: userDocument,
  position: userLayout,
  parentId: userTopology,
  extent: userTopology,
  expandParent: userTopology,
  origin: userLayout,
  hidden: userLayout,
  style: userLayout,
  zIndex: userLayout,
  className: userLayout,
  selected: ephemeralView,
  dragging: ephemeralView,
  measured: ephemeralView,
  resizing: ephemeralView,
  width: ephemeralView,
  height: ephemeralView,
  initialWidth: ephemeralView,
  initialHeight: ephemeralView,
  positionAbsoluteX: ephemeralView,
  positionAbsoluteY: ephemeralView,
} satisfies Readonly<Record<string, CanvasFieldDescriptor>>);

export const canvasEdgeTopLevelFieldDescriptors = Object.freeze({
  id: userTopology,
  source: userTopology,
  sourceHandle: userTopology,
  target: userTopology,
  targetHandle: userTopology,
  type: userTopology,
  data: userTopology,
  className: userLayout,
  label: userLayout,
  markerEnd: userLayout,
  markerStart: userLayout,
  style: userLayout,
  zIndex: userLayout,
  selected: ephemeralView,
  animated: ephemeralView,
  interactionWidth: ephemeralView,
} satisfies Readonly<Record<string, CanvasFieldDescriptor>>);

export const canvasEdgeDataFieldDescriptors = Object.freeze({
  inputOrder: userTopology,
  inputRole: userTopology,
  cutIndicator: ephemeralView,
  flowAnimated: ephemeralView,
  flowDirection: ephemeralView,
} satisfies Readonly<Record<string, CanvasFieldDescriptor>>);

export function canvasNodeDataFieldDescriptor(field: string) {
  return canvasNodeDataFieldDescriptors[
    field as keyof typeof canvasNodeDataFieldDescriptors
  ];
}

export function isBrowserWritableCanvasDataField(field: string) {
  return canvasNodeDataFieldDescriptor(field)?.owner === "durable-user";
}

function canonical(value: unknown): JsonLike | undefined {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canonical(item) ?? null);
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .flatMap(([key, item]) => {
        const cleaned = canonical(item);
        return cleaned === undefined ? [] : [[key, cleaned] as const];
      }),
  );
}

export function stableCanonicalJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

const sha256Constants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, shift: number) =>
  (value >>> shift) | (value << (32 - shift));

/** Synchronous cross-runtime SHA-256 for the bounded Canvas JSON contract. */
export function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const first = words[index - 15]!;
      const second = words[index - 2]!;
      const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const upperE = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + upperE + choice + sha256Constants[index]! + words[index]!) >>> 0;
      const upperA = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (upperA + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function stableSha256(value: unknown) {
  return sha256Hex(stableCanonicalJson(value));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function documentNode(value: unknown) {
  const node = record(value);
  if (!node) return value;
  const result: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(node)) {
    const topLevel = canvasNodeTopLevelFieldDescriptors[
      field as keyof typeof canvasNodeTopLevelFieldDescriptors
    ];
    if (topLevel?.owner === "ephemeral-view") continue;
    if (field === "data") {
      const data = record(item);
      result.data = data
        ? Object.fromEntries(Object.entries(data).filter(([key]) =>
            canvasNodeDataFieldDescriptor(key)?.owner !== "ephemeral-view"
          ))
        : item;
    } else {
      result[field] = item;
    }
  }
  return result;
}

/**
 * Canonical browser-owned projection used only at the legacy compatibility
 * boundary.  Server, migration, unknown and view fields are deliberately
 * omitted so an old full-document payload can never become authority for
 * them.
 */
export function userOwnedCanvasNodeProjection(value: unknown) {
  const node = record(value);
  if (!node) return value;
  const projected: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(node)) {
    const topLevel = canvasNodeTopLevelFieldDescriptors[
      field as keyof typeof canvasNodeTopLevelFieldDescriptors
    ];
    if (topLevel?.owner !== "durable-user") continue;
    if (field === "data") {
      const data = record(item);
      projected.data = data
        ? Object.fromEntries(Object.entries(data).filter(([key]) =>
            canvasNodeDataFieldDescriptor(key)?.owner === "durable-user"
          ))
        : item;
    } else {
      projected[field] = item;
    }
  }
  return projected;
}

function inputNode(value: unknown) {
  const node = record(value);
  if (!node) return value;
  const projected: Record<string, unknown> = Object.fromEntries(
    Object.entries(node).filter(([field]) =>
      canvasNodeTopLevelFieldDescriptors[
        field as keyof typeof canvasNodeTopLevelFieldDescriptors
      ]?.input === true
    ),
  );
  const data = record(node.data);
  if (data) {
    const kind = typeof node.type === "string" ? node.type : "";
    const generatedTaskId = data[`${kind}GenerationTaskId`];
    const serverResultIdentityPresent = generatedTaskId !== undefined ||
      data.groupRunSuccessTaskId !== undefined ||
      data.legacyTerminalDetachApplicationId !== undefined;
    projected.data = Object.fromEntries(Object.entries(data).filter(([key]) =>
      canvasNodeDataFieldDescriptor(key)?.input === true && !(
        serverResultIdentityPresent && (
          kind === "text" && (key === "content" || key === "contentHtml") ||
          key === "assetId" || key === "inputState" || key === "inputStateReason"
        )
      )
    ));
  }
  return projected;
}

function documentEdge(value: unknown) {
  const edge = record(value);
  if (!edge) return value;
  const durable = Object.fromEntries(Object.entries(edge).filter(([key]) =>
    canvasEdgeTopLevelFieldDescriptors[
      key as keyof typeof canvasEdgeTopLevelFieldDescriptors
    ]?.owner !== "ephemeral-view"
  ));
  const data = record(durable.data);
  if (data) {
    durable.data = Object.fromEntries(Object.entries(data).filter(([key]) =>
      canvasEdgeDataFieldDescriptors[
        key as keyof typeof canvasEdgeDataFieldDescriptors
      ]?.owner !== "ephemeral-view"
    ));
  }
  return durable;
}

export function userOwnedCanvasEdgeProjection(value: unknown) {
  const edge = record(value);
  if (!edge) return value;
  const projected = Object.fromEntries(Object.entries(edge).filter(([key]) =>
    canvasEdgeTopLevelFieldDescriptors[
      key as keyof typeof canvasEdgeTopLevelFieldDescriptors
    ]?.owner === "durable-user"
  ));
  const data = record(projected.data);
  if (data) {
    projected.data = Object.fromEntries(Object.entries(data).filter(([key]) =>
      canvasEdgeDataFieldDescriptors[
        key as keyof typeof canvasEdgeDataFieldDescriptors
      ]?.owner === "durable-user"
    ));
  }
  return projected;
}

export function userOwnedCanvasDocumentProjection(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
  viewport: { x: number; y: number; zoom: number };
}) {
  return {
    edges: collection(input.edges, userOwnedCanvasEdgeProjection),
    nodes: collection(input.nodes, userOwnedCanvasNodeProjection),
    viewport: input.viewport,
  };
}

/** Browser dirty-state identity; server, migration and view fields are excluded. */
export function canvasUserDocumentFingerprint(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
  viewport: { x: number; y: number; zoom: number };
}) {
  return stableSha256(userOwnedCanvasDocumentProjection(input));
}

function inputEdge(value: unknown) {
  const edge = record(documentEdge(value));
  if (!edge) return value;
  const projected = Object.fromEntries(Object.entries(edge).filter(([key]) =>
    canvasEdgeTopLevelFieldDescriptors[
      key as keyof typeof canvasEdgeTopLevelFieldDescriptors
    ]?.input === true
  ));
  const data = record(projected.data);
  if (data) {
    projected.data = Object.fromEntries(Object.entries(data).filter(([key]) =>
      canvasEdgeDataFieldDescriptors[
        key as keyof typeof canvasEdgeDataFieldDescriptors
      ]?.input === true
    ));
  }
  return projected;
}

function collection(values: ReadonlyArray<unknown>, project: (value: unknown) => unknown) {
  return values.map(project).sort((left, right) => {
    const leftId = String(record(left)?.id ?? "");
    const rightId = String(record(right)?.id ?? "");
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

export function durableCanvasNodes(nodes: ReadonlyArray<unknown>) {
  return collection(nodes, documentNode);
}

export function durableCanvasEdges(edges: ReadonlyArray<unknown>) {
  return collection(edges, documentEdge);
}

export function canvasDocumentProjection(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
  viewport: { x: number; y: number; zoom: number };
}) {
  return {
    edges: durableCanvasEdges(input.edges),
    nodes: durableCanvasNodes(input.nodes),
    viewport: input.viewport,
  };
}

export function canvasInputGraphProjection(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
}) {
  return {
    edges: collection(input.edges, inputEdge),
    nodes: collection(input.nodes, inputNode),
  };
}

/** Complete durable-document SHA-256, including layout, viewport and server results. */
export function canvasDocumentFingerprint(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
  viewport: { x: number; y: number; zoom: number };
}) {
  return stableSha256(canvasDocumentProjection(input));
}

export function durableDocumentEquals(
  left: Parameters<typeof canvasDocumentFingerprint>[0],
  right: Parameters<typeof canvasDocumentFingerprint>[0],
) {
  return canvasDocumentFingerprint(left) === canvasDocumentFingerprint(right);
}

/** Input/topology SHA-256; layout, viewport, server results and view state are excluded. */
export function canvasInputGraphFingerprint(input: {
  edges: ReadonlyArray<unknown>;
  nodes: ReadonlyArray<unknown>;
}) {
  return stableSha256(canvasInputGraphProjection(input));
}

/** Backward-compatible name while graph_revision is retained as the DB column. */
export const canvasGraphFingerprint = canvasInputGraphFingerprint;

export type CanvasRevisionTransition = Readonly<{
  changed: boolean;
  documentRevision: number;
  inputChanged: boolean;
  inputGraphRevision: number;
}>;

export function canvasRevisionTransition(input: Readonly<{
  beforeDocumentSha256: string;
  beforeInputSha256: string;
  documentRevision: number;
  inputGraphRevision: number;
  afterDocumentSha256: string;
  afterInputSha256: string;
}>): CanvasRevisionTransition {
  const changed = input.beforeDocumentSha256 !== input.afterDocumentSha256;
  const inputChanged = input.beforeInputSha256 !== input.afterInputSha256;
  if (!changed && inputChanged) {
    throw new Error("Canvas input projection changed without a durable document change");
  }
  return Object.freeze({
    changed,
    documentRevision: input.documentRevision + (changed ? 1 : 0),
    inputChanged,
    inputGraphRevision: input.inputGraphRevision + (inputChanged ? 1 : 0),
  });
}

/** Existing compact semantic identity used by generation receipts. */
export function stableValueFingerprint(value: unknown) {
  const source = stableCanonicalJson(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}
