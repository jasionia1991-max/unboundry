import {
  canvasEdgeDataFieldDescriptors,
  canvasEdgeTopLevelFieldDescriptors,
  canvasNodeDataFieldDescriptor,
  canvasNodeTopLevelFieldDescriptors,
  isBrowserWritableCanvasDataField,
  stableCanonicalJson,
  sha256Hex,
} from "./canvasFingerprint";
import { persistedNodeSchemaRegistry } from "./persistedNodeSchemaRegistry";
import { imageToolMaximums } from "./imageTools";

export const canvasCommandWriteContract = "command-v1" as const;
export const legacyCanvasPutWriteContract = "legacy-put-v1" as const;

export type CanvasViewport = Readonly<{ x: number; y: number; zoom: number }>;

export type CanvasCommandBase = Readonly<{
  operationId: string;
  saveSessionId: string;
  saveSequence: number;
}>;

export type ExistingCanvasCommandBase = CanvasCommandBase & Readonly<{
  baseDocumentRevision: number;
  baseInputGraphRevision: number;
  observedLoadToken: string;
}>;

export type InitialUserOwnedCanvasDocument = Readonly<{
  nodes: readonly unknown[];
  edges: readonly unknown[];
  viewport: CanvasViewport;
}>;

export type CreateCanvasDocumentCommand = CanvasCommandBase & Readonly<{
  kind: "create-canvas-document";
  baseDocumentRevision: null;
  baseInputGraphRevision: null;
  observedLoadToken: null;
  initialDocument: InitialUserOwnedCanvasDocument;
}>;

export type UserFieldChange = Readonly<{
  nodeId: string;
  field: `data.${string}`;
  action: "set" | "delete";
  baseValueDigest: string;
  value?: unknown;
}>;

export type ApplyUserFieldChangesCommand = ExistingCanvasCommandBase & Readonly<{
  kind: "apply-user-field-changes";
  changes: readonly UserFieldChange[];
}>;

export type CanvasTopologyMediaAdoption =
  | Readonly<{
      asset: AdoptedCanvasAsset;
      kind: "adopt-uploaded-asset";
      mediaKind: "audio" | "image" | "video";
      nodeId: string;
    }>
  | Readonly<{
      asset: AdoptedCanvasAsset;
      kind: "edit-result-and-invalidate-proof";
      nodeId: string;
      outputBackground?: string;
      sourceAssetId: string;
      toolOperation: string;
      toolOperationId: string;
    }>;

export type CanvasTopologyOperation =
  | Readonly<{ intent: "create-node"; node: unknown }>
  | Readonly<{
      intent: "delete-subgraph";
      nodeIds: readonly string[];
      edgeIds: readonly string[];
    }>
  | Readonly<{ intent: "connect-edge"; edge: unknown }>
  | Readonly<{ intent: "disconnect-edge"; edgeId: string }>
  | Readonly<{ intent: "replace-edge"; edge: unknown }>
  | Readonly<{
      intent: "group-members";
      groupNode: unknown;
      memberNodeIds: readonly string[];
    }>
  | Readonly<{ intent: "ungroup"; groupNodeId: string; memberNodeIds: readonly string[] }>
  | Readonly<{ intent: "paste-subgraph"; nodes: readonly unknown[]; edges: readonly unknown[] }>
  | Readonly<{ intent: "replace-playlist-order"; nodeId: string; clipIds: readonly string[] }>;

export type ApplyTopologyCommand = ExistingCanvasCommandBase & Readonly<{
  kind: "apply-topology";
  topologyOperation: CanvasTopologyOperation;
  affectedTopologyDigest: string;
  mediaAdoptions?: readonly CanvasTopologyMediaAdoption[];
}>;

export type CommitUserLayoutCommand = ExistingCanvasCommandBase & Readonly<{
  kind: "commit-user-layout";
  nodes?: readonly Readonly<{
    nodeId: string;
    position?: Readonly<{ x: number; y: number }>;
    style?: Readonly<{ height?: number; width?: number }>;
    mediaSizingMode?: "auto" | "manual" | null;
    zIndex?: number;
  }>[];
  viewport?: CanvasViewport;
}>;

export type AdoptedCanvasAsset = Readonly<{
  assetId: string;
  byteSize: number;
  contentType: string;
  durationSeconds?: number | null;
  height?: number | null;
  src: string;
  storageBackend: "local" | "oss";
  width?: number | null;
}>;

export type AdoptUploadedAssetCommand = ExistingCanvasCommandBase & Readonly<{
  kind: "adopt-uploaded-asset";
  mediaKind: "audio" | "image" | "video";
  nodeId: string;
  asset: AdoptedCanvasAsset;
}>;

export type EditResultAndInvalidateProofCommand =
  ExistingCanvasCommandBase & Readonly<{
    kind: "edit-result-and-invalidate-proof";
    nodeId: string;
    sourceAssetId: string;
    toolOperation: string;
    toolOperationId: string;
    outputBackground?: string;
    asset: AdoptedCanvasAsset;
  }>;

export type CanvasUserCommand =
  | CreateCanvasDocumentCommand
  | ApplyUserFieldChangesCommand
  | ApplyTopologyCommand
  | CommitUserLayoutCommand
  | AdoptUploadedAssetCommand
  | EditResultAndInvalidateProofCommand;

export type CanvasCommandOutcome = "APPLIED" | "NO_OP" | "REJECTED_CONFLICT";

export type AuthoritativeCanvasDocument = Readonly<{
  edges: readonly unknown[];
  graphRevision: number;
  nodes: readonly unknown[];
  revision: number;
  viewport: CanvasViewport;
}>;

type CanvasCommandResponseBase = Readonly<{
  authoritativeDocument: AuthoritativeCanvasDocument;
  currentDocumentRevision: number;
  currentInputGraphRevision: number;
  currentLoadToken: string;
  operationId: string;
  operationDocumentRevision: number;
  operationInputGraphRevision: number;
  originalRequestId: string;
  requestId: string;
  replayed: boolean;
}>;

export type CanvasCommandSuccessResponse = CanvasCommandResponseBase & Readonly<{
  originalStatus: "applied" | "already-applied";
  status: "applied" | "already-applied";
}>;

export type CanvasCommandConflictResponse = CanvasCommandResponseBase & Readonly<{
  code: string;
  error: string;
}>;

export type CanvasCommandResponse =
  | CanvasCommandSuccessResponse
  | CanvasCommandConflictResponse;

const operationIdentifierPattern = /^[a-z0-9][a-z0-9._:-]{7,199}$/i;
const objectIdentifierPattern = /^[^\s\u0000-\u001f]{1,200}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const existingBaseKeys = [
  "operationId", "saveSessionId", "saveSequence", "baseDocumentRevision",
  "baseInputGraphRevision", "observedLoadToken",
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key)) &&
    keys.every((key) => key in value);
}

function exactOrOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function finitePoint(value: unknown) {
  const item = record(value);
  return Boolean(item && exactKeys(item, ["x", "y"]) &&
    Number.isFinite(item.x) && Number.isFinite(item.y));
}

function validViewport(value: unknown) {
  const item = record(value);
  return Boolean(item && exactKeys(item, ["x", "y", "zoom"]) &&
    Number.isFinite(item.x) && Number.isFinite(item.y) &&
    Number.isFinite(item.zoom) && Number(item.zoom) > 0);
}

function validObjectId(value: unknown) {
  return typeof value === "string" && objectIdentifierPattern.test(value);
}

const canvasNodeKinds = new Set([
  "audio", "group", "image", "playlist", "probe", "storyboard", "text", "video",
]);
const imageColorMarks = new Set([
  "red", "orange", "yellow", "green", "blue", "purple",
]);
const groupColors = new Set([
  "transparent",
  "rgba(239, 68, 68, 0.16)",
  "rgba(249, 115, 22, 0.16)",
  "rgba(234, 179, 8, 0.16)",
  "rgba(34, 197, 94, 0.16)",
  "rgba(6, 182, 212, 0.16)",
  "rgba(59, 130, 246, 0.16)",
  "rgba(168, 85, 247, 0.16)",
  "rgba(255, 255, 255, 0.04)",
]);
const imageFieldNames = new Set([
  "imageAnnotations", "imageColorMarks", "imageAspectRatio", "imageModelId",
  "imageModelConfigurationRevision", "imageModelName", "imageMultiAngleParameters",
  "imagePrompt", "imagePromptReady", "imageParameters", "imageQuality",
  "imageToolMaskFeatherPixels", "imageToolOutpaintParameters",
]);
const textFieldNames = new Set([
  "content", "contentHtml", "textPrompt", "textPromptReady", "textParameters",
  "textModelId", "textModelConfigurationRevision", "textModelName",
]);
const audioFieldNames = new Set([
  "audioFileSize", "audioFileName", "audioModelId",
  "audioModelConfigurationRevision", "audioModelName", "audioPrompt",
  "audioPromptReady", "audioParameters",
]);
const videoFieldNames = new Set([
  "videoAudioEnabled", "videoFileSize", "videoModel", "videoModelId",
  "videoModelConfigurationRevision", "videoPrompt", "videoPromptReady",
  "videoParameters",
]);
const richTextTags = new Set([
  "b", "br", "div", "em", "h1", "h2", "h3", "hr", "i", "li", "ol", "p",
  "strong", "ul",
]);

function boundedString(value: unknown, maximum: number, allowEmpty = true) {
  return typeof value === "string" && value.length <= maximum &&
    (allowEmpty || value.trim().length > 0);
}

function validPlainParameterRecord(value: unknown) {
  const values = record(value);
  if (!values || Object.keys(values).length > 200) return false;
  return Object.entries(values).every(([key, item]) =>
    /^[a-z0-9._-]{1,100}$/i.test(key) && (
      typeof item === "boolean" ||
      typeof item === "number" && Number.isFinite(item) ||
      boundedString(item, 20_000)
    )
  );
}

function validRichTextHtml(value: unknown) {
  if (!boundedString(value, 100_000)) return false;
  const html = String(value);
  if (/<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>/u.test(html)) return false;
  const tags = html.match(/<[^>]*>/g) ?? [];
  return tags.every((tag) => {
    const match = /^<\s*(\/?)\s*([a-z0-9]+)\s*(\/?)\s*>$/i.exec(tag);
    return Boolean(match && richTextTags.has(match[2]!.toLowerCase()) &&
      (!match[3] || match[2]!.toLowerCase() === "br" ||
        match[2]!.toLowerCase() === "hr"));
  });
}

function finiteCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value) <= 100_000;
}

function validImageAnnotations(value: unknown) {
  const document = record(value);
  if (!document || !exactKeys(document, ["elements", "height", "version", "width"]) ||
      document.version !== 1 || !finiteCoordinate(document.width) ||
      !finiteCoordinate(document.height) || Number(document.width) < 1 ||
      Number(document.height) < 1 || !Array.isArray(document.elements) ||
      document.elements.length > 500) return false;
  let points = 0;
  for (const raw of document.elements) {
    const element = record(raw);
    if (!element || !boundedString(element.id, 128, false) ||
        !boundedString(element.color, 32, false) || typeof element.kind !== "string") {
      return false;
    }
    if (element.kind === "stroke") {
      if (!Array.isArray(element.points) || element.points.length < 2 ||
          element.points.length > 2_000 || element.points.some((rawPoint) => {
            const point = record(rawPoint);
            return !point || !finiteCoordinate(point.x) || !finiteCoordinate(point.y);
          })) return false;
      points += element.points.length;
    } else if (element.kind === "text") {
      if (!boundedString(element.text, 2_000, false) ||
          !finiteCoordinate(element.x) || !finiteCoordinate(element.y) ||
          !finiteCoordinate(element.fontSize) || Number(element.fontSize) < 6 ||
          Number(element.fontSize) > 256) return false;
    } else if (element.kind === "number") {
      if (!Number.isSafeInteger(element.value) || Number(element.value) < 1 ||
          Number(element.value) > 9_999 || !finiteCoordinate(element.x) ||
          !finiteCoordinate(element.y)) return false;
    } else if (!["arrow", "ellipse", "rectangle"].includes(element.kind) ||
        Object.entries(element).some(([key, item]) =>
          key !== "value" && typeof item === "number" && !finiteCoordinate(item)
        )) return false;
  }
  return points <= 20_000 &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      imageToolMaximums.annotationDocumentBytes;
}

function validPlaylistClips(value: unknown) {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  const ids = new Set<string>();
  return value.every((raw) => {
    const clip = record(raw);
    if (!clip || !exactOrOptionalKeys(
      clip,
      ["end", "id", "sourceNodeId", "src", "start", "title"],
      ["sourceEnd", "sourceStart"],
    ) || !validObjectId(clip.id) || ids.has(String(clip.id)) ||
        !validObjectId(clip.sourceNodeId) || !boundedString(clip.title, 1_000) ||
        typeof clip.src !== "string" ||
        !(clip.src.startsWith("/api/video-assets/") ||
          /^\/fixtures\/[a-z0-9._/-]+\.mp4(?:\?.*)?$/i.test(clip.src)) ||
        !Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
        Number(clip.start) < 0 || Number(clip.end) <= Number(clip.start) ||
        [clip.sourceStart, clip.sourceEnd].some((item) =>
          item !== undefined && (!Number.isFinite(item) || Number(item) < 0)
        ) || (clip.sourceStart !== undefined && clip.sourceEnd !== undefined &&
          Number(clip.sourceEnd) <= Number(clip.sourceStart))) return false;
    ids.add(String(clip.id));
    return true;
  });
}

function validStoryboardShots(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) return false;
  const ids = new Set<string>();
  return value.every((raw) => {
    const shot = record(raw);
    if (!shot || !exactKeys(shot, [
      "dialogue", "duration", "framing", "id", "mediaTone", "notes", "number",
      "status", "summary",
    ]) || !validObjectId(shot.id) || ids.has(String(shot.id)) ||
        !Number.isSafeInteger(shot.number) || Number(shot.number) < 1 ||
        !["desk", "monitor", "loading"].includes(String(shot.mediaTone)) ||
        !["complete", "loading"].includes(String(shot.status)) ||
        [shot.dialogue, shot.duration, shot.framing, shot.notes, shot.summary]
          .some((item) => !boundedString(item, 20_000))) return false;
    ids.add(String(shot.id));
    return true;
  });
}

function validOutpaint(value: unknown) {
  const item = record(value);
  if (!item || !exactKeys(item, [
    "outputHeight", "outputWidth", "sourceHeight", "sourceWidth", "sourceX",
    "sourceY", "version",
  ]) || item.version !== 1) return false;
  const integers = [item.outputHeight, item.outputWidth, item.sourceHeight, item.sourceWidth];
  if (integers.some((part) => !Number.isSafeInteger(part) || Number(part) < 1 ||
      Number(part) > 8_192) || !Number.isSafeInteger(item.sourceX) ||
      !Number.isSafeInteger(item.sourceY) || Number(item.sourceX) < 0 ||
      Number(item.sourceY) < 0 || Number(item.outputHeight) * Number(item.outputWidth) >
        40_000_000) return false;
  return Number(item.sourceX) + Number(item.sourceWidth) <= Number(item.outputWidth) &&
    Number(item.sourceY) + Number(item.sourceHeight) <= Number(item.outputHeight);
}

function validMultiAngle(value: unknown) {
  const item = record(value);
  return Boolean(item && exactKeys(item, [
    "distance", "horizontalDegrees", "verticalDegrees", "wideAngle",
  ]) && Number.isFinite(item.distance) && Number(item.distance) >= -100 &&
    Number(item.distance) <= 100 && Number.isFinite(item.horizontalDegrees) &&
    Number(item.horizontalDegrees) >= -180 && Number(item.horizontalDegrees) <= 180 &&
    Number.isFinite(item.verticalDegrees) && Number(item.verticalDegrees) >= -90 &&
    Number(item.verticalDegrees) <= 90 && typeof item.wideAngle === "boolean");
}

function fieldAllowedForKind(field: string, nodeKind: string) {
  if (field === "mediaSizingMode") return nodeKind === "image" || nodeKind === "video";
  if (imageFieldNames.has(field)) return nodeKind === "image";
  if (textFieldNames.has(field)) return nodeKind === "text";
  if (audioFieldNames.has(field)) return nodeKind === "audio";
  if (videoFieldNames.has(field)) return nodeKind === "video";
  if (field === "playlistClips") return nodeKind === "playlist";
  if (field === "storyboardShots") return nodeKind === "storyboard";
  if (field === "groupColor" || field === "groupTemplate") return nodeKind === "group";
  if (field === "sourceKind") return ["audio", "image", "video"].includes(nodeKind);
  if (field === "variant") return nodeKind === "group" || nodeKind === "probe";
  return field === "label" || field === "title";
}

function validUserFieldValue(field: string, value: unknown, nodeKind?: string) {
  if (nodeKind && (!canvasNodeKinds.has(nodeKind) ||
      !fieldAllowedForKind(field, nodeKind))) return false;
  if (field === "mediaSizingMode") return value === "auto" || value === "manual";
  if (field === "label") return boundedString(value, 1_000, false);
  if (field === "title" || field.endsWith("ModelName") || field === "videoModel" ||
      field === "audioFileName") return boundedString(value, 1_000);
  if (field.endsWith("Prompt") || field === "content") return boundedString(value, 100_000);
  if (field === "contentHtml") return validRichTextHtml(value);
  if (field.endsWith("PromptReady") || field === "groupTemplate" ||
      field === "videoAudioEnabled") return typeof value === "boolean";
  if (field.endsWith("Parameters")) {
    if (field === "imageMultiAngleParameters") return validMultiAngle(value);
    if (field === "imageToolOutpaintParameters") return validOutpaint(value);
    return validPlainParameterRecord(value);
  }
  if (field.endsWith("ModelId") || field.endsWith("ModelConfigurationRevision") ||
      field === "imageAspectRatio" || field === "imageQuality") {
    return validObjectId(value);
  }
  if (field === "audioFileSize" || field === "videoFileSize") {
    return Number.isSafeInteger(value) && Number(value) >= 1;
  }
  if (field === "imageAnnotations") return validImageAnnotations(value);
  if (field === "imageColorMarks") return Array.isArray(value) && value.length <= 6 &&
    new Set(value).size === value.length && value.every((item) => imageColorMarks.has(String(item)));
  if (field === "imageToolMaskFeatherPixels") {
    return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 64;
  }
  if (field === "playlistClips") return validPlaylistClips(value);
  if (field === "storyboardShots") return validStoryboardShots(value);
  if (field === "groupColor") return typeof value === "string" && groupColors.has(value);
  if (field === "sourceKind") return typeof value === "string" &&
    ["audio", "image", "video"].includes(value) && (!nodeKind || value === nodeKind);
  if (field === "variant") return value === "group";
  return false;
}

export function canvasUserFieldChangeMatchesNode(input: Readonly<{
  action: "delete" | "set";
  field: string;
  nodeKind: string;
  value?: unknown;
}>) {
  if (!fieldAllowedForKind(input.field, input.nodeKind)) return false;
  if (input.action === "delete") return input.field !== "label";
  return validUserFieldValue(input.field, input.value, input.nodeKind);
}

function validUserOwnedNode(value: unknown) {
  const node = record(value);
  if (!node || !validObjectId(node.id) ||
      !persistedNodeSchemaRegistry.accepts(node) ||
      typeof node.type !== "string" || !canvasNodeKinds.has(node.type)) return false;
  for (const [field, item] of Object.entries(node)) {
    const descriptor = canvasNodeTopLevelFieldDescriptors[
      field as keyof typeof canvasNodeTopLevelFieldDescriptors
    ];
    if (!descriptor || descriptor.owner !== "durable-user") return false;
    if (field === "data") {
      const data = record(item);
      if (!data || Object.entries(data).some(([key, dataValue]) =>
        canvasNodeDataFieldDescriptor(key)?.owner !== "durable-user" ||
        !fieldAllowedForKind(key, String(node.type)) ||
        !validUserFieldValue(key, dataValue, String(node.type))
      ) || typeof data.label !== "string") return false;
    }
  }
  return true;
}

function validUserOwnedEdge(value: unknown, requireCanonicalHandles = false) {
  const edge = record(value);
  if (!edge || !validObjectId(edge.id) || !validObjectId(edge.source) ||
      !validObjectId(edge.target) || requireCanonicalHandles &&
        (edge.sourceHandle !== "source" || edge.targetHandle !== "target")) return false;
  return Object.keys(edge).every((key) =>
    canvasEdgeTopLevelFieldDescriptors[
      key as keyof typeof canvasEdgeTopLevelFieldDescriptors
    ]?.owner === "durable-user"
  ) &&
    [edge.sourceHandle, edge.targetHandle, edge.type, edge.className, edge.label]
      .every((item) => item === undefined || typeof item === "string") &&
    (edge.data === undefined || Boolean(record(edge.data)) &&
      Object.keys(record(edge.data)!).every((key) =>
        canvasEdgeDataFieldDescriptors[
          key as keyof typeof canvasEdgeDataFieldDescriptors
        ]?.owner === "durable-user"
      )) &&
    (edge.style === undefined || Boolean(record(edge.style)));
}

function validInitialDocument(value: unknown, requireCanonicalHandles = false) {
  const document = record(value);
  if (!(document && exactKeys(document, ["nodes", "edges", "viewport"]) &&
    Array.isArray(document.nodes) && document.nodes.length <= 5_000 &&
    document.nodes.every(validUserOwnedNode) &&
    Array.isArray(document.edges) && document.edges.length <= 10_000 &&
    document.edges.every((edge) =>
      validUserOwnedEdge(edge, requireCanonicalHandles)
    ) && validViewport(document.viewport))) {
    return false;
  }
  const nodes = new Map<string, Record<string, unknown>>();
  for (const value of document.nodes) {
    const node = record(value)!;
    const id = String(node.id);
    if (nodes.has(id)) return false;
    nodes.set(id, node);
  }
  const edgeIds = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const value of document.edges) {
    const edge = record(value)!;
    const id = String(edge.id);
    const source = String(edge.source);
    const target = String(edge.target);
    if (edgeIds.has(id) || source === target || !nodes.has(source) || !nodes.has(target)) {
      return false;
    }
    edgeIds.add(id);
    adjacency.set(source, [...(adjacency.get(source) ?? []), target]);
  }
  for (const node of nodes.values()) {
    if (node.parentId !== undefined) {
      const parent = typeof node.parentId === "string"
        ? nodes.get(node.parentId)
        : undefined;
      if (!parent || node.parentId === node.id || parent.type !== "group" ||
          node.type === "group") return false;
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!visit(next)) return false;
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of nodes.keys()) {
    if (!visit(id)) return false;
  }
  for (const node of nodes.values()) {
    const parents = new Set<string>();
    let parent = typeof node.parentId === "string" ? node.parentId : undefined;
    while (parent) {
      if (parents.has(parent)) return false;
      parents.add(parent);
      const parentNode = nodes.get(parent);
      parent = typeof parentNode?.parentId === "string" ? parentNode.parentId : undefined;
    }
  }
  return true;
}

export function isValidInitialUserOwnedCanvasDocument(value: unknown) {
  return validInitialDocument(value);
}

function validBase(command: Record<string, unknown>, create: boolean) {
  if (!operationIdentifierPattern.test(String(command.operationId)) ||
      typeof command.saveSessionId !== "string" ||
      !/^[a-z0-9][a-z0-9._:-]{7,79}$/i.test(command.saveSessionId) ||
      !Number.isSafeInteger(command.saveSequence) || Number(command.saveSequence) < 1) {
    return false;
  }
  const validRevision = (revision: unknown) =>
    Number.isSafeInteger(revision) && Number(revision) >= 0;
  return create
    ? command.baseDocumentRevision === null &&
      command.baseInputGraphRevision === null && command.observedLoadToken === null
    : validRevision(command.baseDocumentRevision) &&
      validRevision(command.baseInputGraphRevision) &&
      typeof command.observedLoadToken === "string" &&
      command.observedLoadToken.length >= 1 &&
      command.observedLoadToken.length <= 256;
}

function validUserFieldCommand(command: Record<string, unknown>) {
  if (!exactKeys(command, [...existingBaseKeys, "kind", "changes"]) ||
      !Array.isArray(command.changes) || command.changes.length < 1 ||
      command.changes.length > 100) return false;
  return command.changes.every((value) => {
    const change = record(value);
    if (!change) return false;
    const required = ["nodeId", "field", "action", "baseValueDigest"];
    const optional = change.action === "set" ? ["value"] : [];
    if (!exactOrOptionalKeys(change, required, optional) ||
        !validObjectId(change.nodeId) ||
        !sha256Pattern.test(String(change.baseValueDigest)) ||
        (change.action !== "set" && change.action !== "delete")) return false;
    const field = String(change.field);
    const descriptor = canvasNodeDataFieldDescriptor(field.slice(5));
    if (!field.startsWith("data.") || field.slice(5).includes(".") ||
        !isBrowserWritableCanvasDataField(field.slice(5)) ||
        !descriptor?.allowedCommands.includes("apply-user-field-changes")) return false;
    return change.action === "set"
      ? "value" in change && validUserFieldValue(field.slice(5), change.value)
      : !("value" in change) && field !== "data.label";
  });
}

function validIdArray(value: unknown, maximum = 5_000) {
  return Array.isArray(value) && value.length <= maximum && value.every(validObjectId);
}

function validTopologyOperation(value: unknown) {
  const operation = record(value);
  if (!operation || typeof operation.intent !== "string") return false;
  if (operation.intent === "create-node") {
    return exactKeys(operation, ["intent", "node"]) && validUserOwnedNode(operation.node);
  }
  if (operation.intent === "delete-subgraph") {
    return exactKeys(operation, ["intent", "nodeIds", "edgeIds"]) &&
      validIdArray(operation.nodeIds) && validIdArray(operation.edgeIds, 10_000) &&
      (operation.nodeIds as unknown[]).length > 0;
  }
  if (operation.intent === "connect-edge") {
    return exactKeys(operation, ["intent", "edge"]) &&
      validUserOwnedEdge(operation.edge, true);
  }
  if (operation.intent === "disconnect-edge") {
    return exactKeys(operation, ["intent", "edgeId"]) && validObjectId(operation.edgeId);
  }
  if (operation.intent === "replace-edge") {
    return exactKeys(operation, ["intent", "edge"]) &&
      validUserOwnedEdge(operation.edge);
  }
  if (operation.intent === "group-members") {
    const groupNode = record(operation.groupNode);
    return exactKeys(operation, ["intent", "groupNode", "memberNodeIds"]) &&
      validUserOwnedNode(operation.groupNode) && groupNode?.type === "group" &&
      groupNode.parentId === undefined && validIdArray(operation.memberNodeIds) &&
      (operation.memberNodeIds as unknown[]).length > 0;
  }
  if (operation.intent === "ungroup") {
    return exactKeys(operation, ["intent", "groupNodeId", "memberNodeIds"]) &&
      validObjectId(operation.groupNodeId) && validIdArray(operation.memberNodeIds);
  }
  if (operation.intent === "paste-subgraph") {
    return exactKeys(operation, ["intent", "nodes", "edges"]) &&
      Array.isArray(operation.nodes) && operation.nodes.length > 0 &&
      operation.nodes.length <= 5_000 && operation.nodes.every(validUserOwnedNode) &&
      Array.isArray(operation.edges) && operation.edges.length <= 10_000 &&
      operation.edges.every((edge) => validUserOwnedEdge(edge, true));
  }
  if (operation.intent === "replace-playlist-order") {
    return exactKeys(operation, ["intent", "nodeId", "clipIds"]) &&
      validObjectId(operation.nodeId) && validIdArray(operation.clipIds, 10_000);
  }
  return false;
}

function validLayoutCommand(command: Record<string, unknown>) {
  if (!exactOrOptionalKeys(
    command,
    [...existingBaseKeys, "kind"],
    ["nodes", "viewport"],
  ) || !("nodes" in command || "viewport" in command)) return false;
  if (command.viewport !== undefined && !validViewport(command.viewport)) return false;
  return command.nodes === undefined || (Array.isArray(command.nodes) &&
    command.nodes.length > 0 && command.nodes.length <= 5_000 &&
    command.nodes.every((value) => {
      const item = record(value);
      if (!item || !exactOrOptionalKeys(
        item,
        ["nodeId"],
        ["position", "style", "zIndex", "mediaSizingMode"],
      ) || !validObjectId(item.nodeId) ||
          !("position" in item || "style" in item || "zIndex" in item || "mediaSizingMode" in item)) return false;
      if (item.mediaSizingMode !== undefined && item.mediaSizingMode !== null &&
          item.mediaSizingMode !== "auto" && item.mediaSizingMode !== "manual") return false;
      if (item.position !== undefined && !finitePoint(item.position)) return false;
      const style = record(item.style);
      if (item.style !== undefined && (!style ||
          !Object.keys(style).every((key) => key === "height" || key === "width") ||
          Object.keys(style).length < 1 ||
          !Object.values(style).every((size) => Number.isFinite(size) && Number(size) > 0))) {
        return false;
      }
      return item.zIndex === undefined || Number.isSafeInteger(item.zIndex);
    }));
}

function validAsset(value: unknown) {
  const asset = record(value);
  if (!asset || !exactOrOptionalKeys(
    asset,
    ["assetId", "byteSize", "contentType", "src", "storageBackend"],
    ["durationSeconds", "height", "width"],
  )) return false;
  return validObjectId(asset.assetId) &&
    Number.isSafeInteger(asset.byteSize) && Number(asset.byteSize) >= 0 &&
    typeof asset.contentType === "string" && asset.contentType.length > 0 &&
    asset.contentType.length <= 200 &&
    typeof asset.src === "string" && asset.src.startsWith("/api/") &&
    (asset.storageBackend === "local" || asset.storageBackend === "oss") &&
    [asset.durationSeconds, asset.height, asset.width].every((item) =>
      item === undefined || item === null ||
      (Number.isFinite(item) && Number(item) >= 0)
    );
}

function validTopologyMediaAdoption(value: unknown) {
  const adoption = record(value);
  if (!adoption || !validObjectId(adoption.nodeId) || !validAsset(adoption.asset)) {
    return false;
  }
  if (adoption.kind === "adopt-uploaded-asset") {
    return exactKeys(adoption, ["kind", "mediaKind", "nodeId", "asset"]) &&
      ["audio", "image", "video"].includes(String(adoption.mediaKind));
  }
  return adoption.kind === "edit-result-and-invalidate-proof" &&
    exactOrOptionalKeys(adoption, [
      "kind", "nodeId", "sourceAssetId", "toolOperation", "toolOperationId",
      "asset",
    ], ["outputBackground"]) && validObjectId(adoption.sourceAssetId) &&
    adoption.sourceAssetId !== record(adoption.asset)?.assetId &&
    operationIdentifierPattern.test(String(adoption.toolOperationId)) &&
    typeof adoption.toolOperation === "string" &&
    adoption.toolOperation.length > 0 && adoption.toolOperation.length <= 100 &&
    (adoption.outputBackground === undefined ||
      boundedString(adoption.outputBackground, 100));
}

function validTopologyMediaAdoptions(command: Record<string, unknown>) {
  if (command.mediaAdoptions === undefined) return true;
  const operation = record(command.topologyOperation);
  const adoptions = command.mediaAdoptions;
  if (operation?.intent !== "paste-subgraph" || !Array.isArray(operation.nodes) ||
      !Array.isArray(adoptions) || adoptions.length < 1 ||
      adoptions.length > operation.nodes.length ||
      adoptions.some((value) => !validTopologyMediaAdoption(value))) return false;
  const nodes = new Map((operation.nodes as unknown[]).map((value) => {
    const node = record(value);
    return [String(node?.id ?? ""), node] as const;
  }));
  const nodeIds = adoptions.map((value) => String(record(value)?.nodeId ?? ""));
  if (new Set(nodeIds).size !== nodeIds.length) return false;
  return adoptions.every((value) => {
    const adoption = record(value)!;
    const node = nodes.get(String(adoption.nodeId));
    return node !== undefined &&
      (adoption.kind === "edit-result-and-invalidate-proof"
        ? node.type === "image"
        : node.type === adoption.mediaKind);
  });
}

export function parseCanvasUserCommand(value: unknown):
  | Readonly<{ ok: true; value: CanvasUserCommand }>
  | Readonly<{ code: "CANVAS_COMMAND_INVALID"; ok: false }> {
  const command = record(value);
  if (!command || typeof command.kind !== "string") {
    return { code: "CANVAS_COMMAND_INVALID", ok: false };
  }
  let valid = validBase(command, command.kind === "create-canvas-document");
  if (valid && command.kind === "create-canvas-document") {
    valid = exactKeys(command, [
      ...existingBaseKeys, "kind", "initialDocument",
    ]) && validInitialDocument(command.initialDocument, true);
  } else if (valid && command.kind === "apply-user-field-changes") {
    valid = validUserFieldCommand(command);
  } else if (valid && command.kind === "apply-topology") {
    valid = exactOrOptionalKeys(command, [
      ...existingBaseKeys, "kind", "topologyOperation", "affectedTopologyDigest",
    ], ["mediaAdoptions"]) && sha256Pattern.test(String(command.affectedTopologyDigest)) &&
      validTopologyOperation(command.topologyOperation) &&
      validTopologyMediaAdoptions(command);
  } else if (valid && command.kind === "commit-user-layout") {
    valid = validLayoutCommand(command);
  } else if (valid && command.kind === "adopt-uploaded-asset") {
    valid = exactKeys(command, [
      ...existingBaseKeys, "kind", "mediaKind", "nodeId", "asset",
    ]) && ["audio", "image", "video"].includes(String(command.mediaKind)) &&
      validObjectId(command.nodeId) && validAsset(command.asset);
  } else if (valid && command.kind === "edit-result-and-invalidate-proof") {
    valid = exactOrOptionalKeys(command, [
      ...existingBaseKeys, "kind", "nodeId", "sourceAssetId", "toolOperation",
      "toolOperationId", "asset",
    ], ["outputBackground"]) && validObjectId(command.nodeId) &&
      validObjectId(command.sourceAssetId) &&
      operationIdentifierPattern.test(String(command.toolOperationId)) &&
      typeof command.toolOperation === "string" &&
      command.toolOperation.length > 0 && command.toolOperation.length <= 100 &&
      (command.outputBackground === undefined ||
        boundedString(command.outputBackground, 100)) &&
      validAsset(command.asset);
  } else {
    valid = false;
  }
  return valid
    ? { ok: true, value: command as CanvasUserCommand }
    : { code: "CANVAS_COMMAND_INVALID", ok: false };
}

export function canvasCommandPayloadSha256(command: CanvasUserCommand) {
  return sha256Hex(stableCanonicalJson(command));
}
