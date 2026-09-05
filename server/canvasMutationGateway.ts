import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AuthoritativeCanvasDocument,
  CanvasUserCommand,
} from "../types/canvasCommands";
import {
  imageToolMaximums,
  type ImageGenerationToolInput,
} from "../types/imageTools";
import {
  isValidInitialUserOwnedCanvasDocument,
  canvasCommandPayloadSha256,
} from "../types/canvasCommands";
import {
  canvasDocumentFingerprint,
  canvasEdgeDataFieldDescriptors,
  canvasEdgeTopLevelFieldDescriptors,
  canvasInputGraphFingerprint,
  canvasNodeDataFieldDescriptor,
  canvasNodeTopLevelFieldDescriptors,
  canvasRevisionTransition,
  durableCanvasEdges,
  durableCanvasNodes,
  sha256Hex,
  stableSha256,
  stableValueFingerprint,
  userOwnedCanvasDocumentProjection,
  userOwnedCanvasEdgeProjection,
  userOwnedCanvasNodeProjection,
} from "../types/canvasFingerprint";
import {
  adoptUploadedMediaReferences,
  MediaPublicationConflictError,
} from "./mediaPublicationService";
import { touchProjectUpdatedAtCommand } from "./projectTransactionCommands";
import { readCanvasProjectScopeCommand } from "./projectTransactionCommands";
import { readReadyMediaAssetCommand } from "./mediaTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import { workflowRunLockedNodeIdsInTransaction } from "./workflowRunLocks";
import { recordCanvasOperationReuseAuditCommand } from
  "./accountTransactionCommands";
import {
  applyCanvasUserCommand,
  authoritativeCanvasAssetPatch,
  type AuthoritativeCanvasAsset,
  CanvasCommandApplicationError,
  createInitialCanvasDocument,
  invalidateGenerationProof,
  type MutableCanvasDocument,
  validateCanvasDocumentTopology,
} from "./canvasTransactionCommands";
import {
  assertAuthoritativeCanvasGenerationProjection,
  buildCanvasProjectionIdentity,
  inspectSingleNodeGenerationCanvasState,
  type AuthoritativeCanvasGenerationProjection,
} from "./generationCanvasProjection";
import {
  canvasObservabilitySavepoint,
  deferCanvasCommandEvent,
  deferCanvasRouteEvent,
  deferGenerationLifecycleEvent,
  rollbackDeferredCanvasObservabilityTo,
  type CanvasGenerationTaskState,
} from "./canvasObservability";
import { currentVersion } from "./version";

let afterGenerationProjectionReceiptForTests:
  | ((projection: AuthoritativeCanvasGenerationProjection) => void)
  | undefined;

/** Safe-runner-only fault after Canvas and receipt writes, before settlement. */
export function setGenerationProjectionReceiptFaultForTests(
  fault?: (projection: AuthoritativeCanvasGenerationProjection) => void,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("Generation projection receipt test fault is disabled");
  }
  afterGenerationProjectionReceiptForTests = fault;
}

export type CanvasGatewayConflictCode =
  | "CANVAS_ALREADY_EXISTS"
  | "CANVAS_LEGACY_RECONCILE_REQUIRED"
  | "CANVAS_LOAD_REQUIRED"
  | "CANVAS_MEDIA_UNAVAILABLE"
  | "CANVAS_PROJECT_DELETED"
  | "CANVAS_PROJECT_NOT_OWNED"
  | "CANVAS_SAVE_SUPERSEDED"
  | "CANVAS_SERVER_OWNERSHIP_CONFLICT"
  | "CANVAS_TOPOLOGY_CONFLICT"
  | "GENERATION_TERMINAL_BINDING_CONFLICT"
  | "GENERATION_TERMINAL_PROOF_CONFLICT"
  | "GENERATION_TERMINAL_STATE_CONFLICT"
  | "GENERATION_TERMINAL_TASK_CONFLICT"
  | "WORKFLOW_GRAPH_LOCKED";

export type CanvasMutationGatewayResult = Readonly<{
  affectedSubgraphSha256: string | null;
  authoritativeDocument: AuthoritativeCanvasDocument;
  changedPaths: readonly string[];
  conflictCode: CanvasGatewayConflictCode | null;
  httpStatus: 200 | 409;
  operationDocumentRevision: number;
  operationInputGraphRevision: number;
  operationId: string;
  originalRequestId: string;
  outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT";
  replayed: boolean;
}>;

export type CanvasOperationReuseResult = Readonly<{
  authoritativeDocument: AuthoritativeCanvasDocument;
  code: "CANVAS_OPERATION_REUSED";
  operationDocumentRevision: number;
  operationId: string;
  operationInputGraphRevision: number;
  originalRequestId: string;
  replayed: false;
}>;

export class CanvasMutationGatewayUnavailableError extends Error {
  readonly code = "CANVAS_COMMAND_RECEIPT_UNAVAILABLE";

  constructor(message = "Canvas operation receipts are unavailable") {
    super(message);
    this.name = "CanvasMutationGatewayUnavailableError";
  }
}

export class CanvasMutationGatewayCapacityError extends Error {
  readonly code = "CANVAS_OPERATION_RECEIPT_CAPACITY";

  constructor() {
    super("Canvas operation receipt capacity reached");
    this.name = "CanvasMutationGatewayCapacityError";
  }
}

type CanvasRow = Readonly<{
  edges: string;
  graph_revision: number;
  nodes: string;
  revision: number;
  save_sequence: number;
  save_session_id: string | null;
  viewport: string;
}>;

type ReceiptRow = Readonly<{
  affected_subgraph_sha256: string | null;
  changed_paths: string;
  conflict_code: CanvasGatewayConflictCode | null;
  http_status: 200 | 409;
  operation_id: string;
  original_request_id: string;
  outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT";
  payload_sha256: string;
  result_document_revision: number;
  result_input_revision: number;
}>;

const commandTypes = Object.freeze({
  "adopt-uploaded-asset": "upload.adopt",
  "apply-topology": "topology.change",
  "apply-user-field-changes": "node.user-field.change",
  "commit-user-layout": "layout.change",
  "create-canvas-document": "canvas.create",
  "edit-result-and-invalidate-proof": "edited-result.adopt",
} as const);

const receiptCanvasLimit = 50_000;
const receiptOwnerLimit = 250_000;

function useReceiptStorage<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (
      error instanceof CanvasMutationGatewayCapacityError ||
      error instanceof CanvasMutationGatewayUnavailableError
    ) {
      throw error;
    }
    throw new CanvasMutationGatewayUnavailableError(
      "Canvas operation receipt storage failed",
    );
  }
}

function assertTransaction(database: DatabaseSync) {
  if (!database.isTransaction) {
    throw new Error("Canvas mutation gateway requires an active transaction");
  }
}

function canvasRow(database: DatabaseSync, ownerId: string, canvasId: string) {
  return database.prepare(`
    SELECT revision, graph_revision, nodes, edges, viewport,
           save_session_id, save_sequence
    FROM canvas_documents
    WHERE owner_id = ? AND id = ?
  `).get(ownerId, canvasId) as CanvasRow | undefined;
}

function commandOutcome(
  result: CanvasMutationGatewayResult | CanvasOperationReuseResult,
) {
  if ("code" in result) {
    return "command.rejected-conflict.CANVAS_OPERATION_REUSED";
  }
  if (result.outcome === "APPLIED") return "command.applied";
  if (result.outcome === "NO_OP") return "command.no-op";
  return `command.rejected-conflict.${result.conflictCode ??
    "CANVAS_SERVER_OWNERSHIP_CONFLICT"}`;
}

function legacyPutOutcome(
  result: CanvasMutationGatewayResult | CanvasOperationReuseResult,
) {
  if ("code" in result) {
    return "command.rejected-conflict.CANVAS_OPERATION_REUSED";
  }
  if (result.outcome === "APPLIED") return "legacy.applied";
  if (result.outcome === "NO_OP") return "legacy.no-op";
  if (result.conflictCode === "CANVAS_LEGACY_RECONCILE_REQUIRED") {
    return "legacy.reconcile-required";
  }
  return `command.rejected-conflict.${result.conflictCode ??
    "CANVAS_SERVER_OWNERSHIP_CONFLICT"}`;
}

function legacyDetachOutcome(
  result: CanvasMutationGatewayResult | CanvasOperationReuseResult,
) {
  if ("code" in result) {
    return "command.rejected-conflict.CANVAS_OPERATION_REUSED";
  }
  if (result.outcome === "APPLIED") return "legacy.detached";
  if (result.outcome === "NO_OP") return "legacy.already-detached";
  return `command.rejected-conflict.${result.conflictCode ??
    "GENERATION_TERMINAL_BINDING_CONFLICT"}`;
}

function deferGatewayCommand(input: Readonly<{
  actor: string;
  affectedNodeHash: string;
  before: CanvasRow | undefined;
  commandKind: string;
  database: DatabaseSync;
  outcome: string;
  requestId: string;
  result: CanvasMutationGatewayResult | CanvasOperationReuseResult;
}>) {
  const noMutation = "code" in input.result || input.result.replayed ||
    input.result.outcome !== "APPLIED";
  const current = input.result.authoritativeDocument;
  deferCanvasCommandEvent(input.database, {
    actor: input.actor,
    affectedNodeHash: input.affectedNodeHash,
    afterDocumentRevision: noMutation
      ? current.revision
      : input.result.operationDocumentRevision,
    afterInputRevision: noMutation
      ? current.graphRevision
      : input.result.operationInputGraphRevision,
    beforeDocumentRevision: input.before?.revision ?? null,
    beforeInputRevision: input.before?.graph_revision ?? null,
    commandKind: input.commandKind,
    operationId: input.result.operationId,
    outcome: input.outcome,
    requestId: input.requestId,
  });
}

function userCommandAffectedNodeHash(command: CanvasUserCommand) {
  if (command.kind === "apply-topology" &&
      /^[0-9a-f]{64}$/i.test(command.affectedTopologyDigest)) {
    return command.affectedTopologyDigest;
  }
  if (command.kind === "apply-topology") {
    return stableSha256({ intent: command.topologyOperation.intent });
  }
  if (command.kind === "apply-user-field-changes") {
    return stableSha256({
      nodeIds: [...new Set(command.changes.map(({ nodeId }) => nodeId))].sort(),
    });
  }
  if (command.kind === "commit-user-layout") {
    return stableSha256({
      nodeIds: [...new Set(command.nodes?.map(({ nodeId }) => nodeId) ?? [])]
        .sort(),
      viewport: command.viewport !== undefined,
    });
  }
  if (command.kind === "create-canvas-document") {
    return stableSha256({
      edgeIds: command.initialDocument.edges.map((value) =>
        String((value as { id?: unknown })?.id ?? "")
      ).sort(),
      nodeIds: command.initialDocument.nodes.map((value) =>
        String((value as { id?: unknown })?.id ?? "")
      ).sort(),
    });
  }
  return stableSha256({ nodeId: command.nodeId });
}

function documentFromRow(row: CanvasRow): MutableCanvasDocument {
  try {
    const edges = JSON.parse(row.edges) as unknown;
    const nodes = JSON.parse(row.nodes) as unknown;
    const viewport = JSON.parse(row.viewport) as Record<string, unknown> | null;
    if (
      !Array.isArray(edges) ||
      !Array.isArray(nodes) ||
      !viewport ||
      !Number.isFinite(viewport.x) ||
      !Number.isFinite(viewport.y) ||
      !Number.isFinite(viewport.zoom) ||
      Number(viewport.zoom) <= 0
    ) {
      throw new Error("Invalid Canvas document row");
    }
    return {
      edges,
      nodes,
      viewport: {
        x: Number(viewport.x),
        y: Number(viewport.y),
        zoom: Number(viewport.zoom),
      },
    };
  } catch {
    throw new CanvasMutationGatewayUnavailableError(
      "Invalid authoritative Canvas document",
    );
  }
}

function authoritativeDocument(row: CanvasRow): AuthoritativeCanvasDocument {
  return Object.freeze({
    ...documentFromRow(row),
    graphRevision: Number(row.graph_revision),
    revision: Number(row.revision),
  });
}

function receipt(
  database: DatabaseSync,
  ownerId: string,
  canvasId: string,
  operationId: string,
) {
  return useReceiptStorage(() => database.prepare(`
      SELECT operation_id, payload_sha256, outcome, conflict_code, http_status,
             original_request_id, result_document_revision, result_input_revision,
             affected_subgraph_sha256, changed_paths
      FROM canvas_operation_receipts
      WHERE owner_id = ? AND canvas_id = ? AND operation_id = ?
    `).get(ownerId, canvasId, operationId) as ReceiptRow | undefined);
}

function assertReceiptCapacity(
  database: DatabaseSync,
  ownerId: string,
  canvasId: string,
) {
  useReceiptStorage(() => {
    const canvas = database.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_receipts
      WHERE owner_id = ? AND canvas_id = ?
    `).get(ownerId, canvasId) as { count: number };
    if (Number(canvas.count) >= receiptCanvasLimit) {
      throw new CanvasMutationGatewayCapacityError();
    }
    const owner = database.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_receipts WHERE owner_id = ?
    `).get(ownerId) as { count: number };
    if (Number(owner.count) >= receiptOwnerLimit) {
      throw new CanvasMutationGatewayCapacityError();
    }
  });
}

function currentSessionHighWater(
  database: DatabaseSync,
  ownerId: string,
  canvasId: string,
  saveSessionId: string,
  row: CanvasRow,
) {
  return useReceiptStorage(() => {
    const receiptSequence = database.prepare(`
      SELECT MAX(save_sequence) AS sequence
      FROM canvas_operation_receipts
      WHERE owner_id = ? AND canvas_id = ? AND save_session_id = ?
    `).get(ownerId, canvasId, saveSessionId) as { sequence: number | null };
    return Math.max(
      Number(receiptSequence.sequence ?? 0),
      row.save_session_id === saveSessionId ? Number(row.save_sequence) : 0,
    );
  });
}

function authoritativeAsset(
  database: DatabaseSync,
  ownerId: string,
  kind: "audio" | "image" | "video",
  assetId: string,
): AuthoritativeCanvasAsset | undefined {
  const row = executeTransactionScopedCommand(database, readReadyMediaAssetCommand, {
    assetId,
    kind,
    ownerId,
  });
  if (!row) return undefined;
  const route = kind === "image" ? "assets" : `${kind}-assets`;
  return Object.freeze({
    assetId: row.id,
    byteSize: row.byteSize,
    contentType: row.contentType,
    createdAt: row.createdAt,
    durationSeconds: row.durationSeconds,
    height: row.height,
    ...(row.hasTransparency === null
      ? {}
      : { hasTransparency: row.hasTransparency }),
    src: `/api/${route}/${encodeURIComponent(row.id)}`,
    storageBackend: row.storageBackend,
    width: row.width,
  });
}

function receiptResult(
  row: ReceiptRow,
  current: CanvasRow,
  replayed: boolean,
): CanvasMutationGatewayResult {
  let changedPaths: readonly string[] = [];
  try {
    const parsed = JSON.parse(row.changed_paths);
    if (Array.isArray(parsed)) changedPaths = parsed.map(String);
  } catch {
    throw new CanvasMutationGatewayUnavailableError("Invalid durable Canvas receipt");
  }
  return Object.freeze({
    affectedSubgraphSha256: row.affected_subgraph_sha256,
    authoritativeDocument: authoritativeDocument(current),
    changedPaths,
    conflictCode: row.conflict_code,
    httpStatus: Number(row.http_status) as 200 | 409,
    operationDocumentRevision: Number(row.result_document_revision),
    operationId: row.operation_id,
    operationInputGraphRevision: Number(row.result_input_revision),
    originalRequestId: row.original_request_id,
    outcome: row.outcome,
    replayed,
  });
}

function insertReceipt(
  database: DatabaseSync,
  input: Readonly<{
    affectedSubgraphSha256: string | null;
    changedPaths: readonly string[];
    command: CanvasUserCommand;
    conflictCode: CanvasGatewayConflictCode | null;
    documentSha256: string;
    documentRevision: number;
    inputRevision: number;
    inputSha256: string;
    loadTokenEpoch: string;
    ownerId: string;
    canvasId: string;
    outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT";
    payloadSha256: string;
    requestId: string;
  }>,
) {
  useReceiptStorage(() => {
    const { command } = input;
    const create = command.kind === "create-canvas-document";
    const now = new Date().toISOString();
    const loadToken = create ? null : command.observedLoadToken;
    const result = database.prepare(`
      INSERT INTO canvas_operation_receipts (
        owner_id, canvas_id, operation_id, payload_sha256, command_type,
        actor_type, save_session_id, save_sequence, baseline_kind,
        base_document_revision, base_input_revision,
        baseline_load_token_sha256, baseline_epoch,
        outcome, conflict_code, http_status, original_request_id,
        result_document_revision, result_input_revision,
        result_document_sha256, result_input_sha256,
        affected_subgraph_sha256, changed_paths, created_at, settled_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'browser', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      input.ownerId,
      input.canvasId,
      command.operationId,
      input.payloadSha256,
      commandTypes[command.kind],
      command.saveSessionId,
      command.saveSequence,
      create ? "create" : "existing",
      create ? null : command.baseDocumentRevision,
      create ? null : command.baseInputGraphRevision,
      loadToken === null ? null : sha256Hex(loadToken),
      create ? null : input.loadTokenEpoch,
      input.outcome,
      input.conflictCode,
      input.outcome === "REJECTED_CONFLICT" ? 409 : 200,
      input.requestId,
      input.documentRevision,
      input.inputRevision,
      input.documentSha256,
      input.inputSha256,
      input.affectedSubgraphSha256,
      JSON.stringify(input.changedPaths),
      now,
      now,
    );
    if (result.changes !== 1) throw new CanvasMutationGatewayUnavailableError();
  });
}

function insertInternalReceipt(
  database: DatabaseSync,
  input: Readonly<{
    actorType: "legacy" | "server";
    affectedSubgraphSha256: string | null;
    baselineDocumentRevision: number;
    baselineInputRevision: number;
    baselineLoadToken: string;
    baselineEpoch: string;
    canvasId: string;
    changedPaths: readonly string[];
    commandType: "legacy.put" | "legacy.terminal-detach" | "server.projection";
    conflictCode: CanvasGatewayConflictCode | null;
    documentRevision: number;
    documentSha256: string;
    inputRevision: number;
    inputSha256: string;
    operationId: string;
    outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT";
    ownerId: string;
    payloadSha256: string;
    requestId: string;
    saveSequence?: number;
    saveSessionId?: string;
  }>,
) {
  useReceiptStorage(() => {
    const now = new Date().toISOString();
    const result = database.prepare(`
      INSERT INTO canvas_operation_receipts (
        owner_id, canvas_id, operation_id, payload_sha256, command_type,
        actor_type, save_session_id, save_sequence, baseline_kind,
        base_document_revision, base_input_revision,
        baseline_load_token_sha256, baseline_epoch,
        outcome, conflict_code, http_status, original_request_id,
        result_document_revision, result_input_revision,
        result_document_sha256, result_input_sha256,
        affected_subgraph_sha256, changed_paths, created_at, settled_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 'existing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      input.ownerId,
      input.canvasId,
      input.operationId,
      input.payloadSha256,
      input.commandType,
      input.actorType,
      input.saveSessionId ?? null,
      input.saveSequence ?? null,
      input.baselineDocumentRevision,
      input.baselineInputRevision,
      sha256Hex(input.baselineLoadToken),
      input.baselineEpoch,
      input.outcome,
      input.conflictCode,
      input.outcome === "REJECTED_CONFLICT" ? 409 : 200,
      input.requestId,
      input.documentRevision,
      input.inputRevision,
      input.documentSha256,
      input.inputSha256,
      input.affectedSubgraphSha256,
      JSON.stringify(input.changedPaths),
      now,
      now,
    );
    if (result.changes !== 1) throw new CanvasMutationGatewayUnavailableError();
  });
}

export class CanvasGenerationBindingConflictError extends Error {
  readonly code = "CANVAS_SERVER_OWNERSHIP_CONFLICT";

  constructor(message = "Canvas generation binding changed before admission") {
    super(message);
    this.name = "CanvasGenerationBindingConflictError";
  }
}

function assertImageToolGenerationBinding(input: Readonly<{
  data: Record<string, unknown>;
  database: DatabaseSync;
  document: MutableCanvasDocument;
  nodeId: string;
  ownerId: string;
  tool: ImageGenerationToolInput;
}>) {
  const { data, database, document, nodeId, ownerId, tool } = input;
  const absentOrEqual = (field: string, expected: unknown) =>
    data[field] === undefined || stableSha256(data[field]) === stableSha256(expected);
  if (
    !absentOrEqual("imageAssetOrigin", "image-tool") ||
    !absentOrEqual("imageToolOperation", tool.operation) ||
    !absentOrEqual("imageToolOperationId", tool.operationId) ||
    !absentOrEqual("imageToolSourceAssetId", tool.sourceAssetId) ||
    !absentOrEqual("imageToolOutputBackground", tool.outputBackground)
  ) {
    throw new CanvasGenerationBindingConflictError(
      "Image tool identity changed before admission",
    );
  }
  const source = document.nodes.map((value) => value && typeof value === "object" &&
      !Array.isArray(value) ? value as Record<string, unknown> : undefined)
    .find((value) => value?.id === tool.sourceNodeId);
  const sourceData = source?.data && typeof source.data === "object" &&
      !Array.isArray(source.data)
    ? source.data as Record<string, unknown>
    : undefined;
  const sourceEdge = document.edges.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const edge = value as Record<string, unknown>;
    const edgeData = edge.data && typeof edge.data === "object" &&
        !Array.isArray(edge.data)
      ? edge.data as Record<string, unknown>
      : undefined;
    return edge.source === tool.sourceNodeId && edge.target === nodeId &&
      edgeData?.inputRole === "reference-image" && edgeData.inputOrder === 1;
  });
  const sourceMedia = executeTransactionScopedCommand(
    database,
    readReadyMediaAssetCommand,
    { assetId: tool.sourceAssetId, kind: "image", ownerId },
  );
  if (
    source?.type !== "image" || sourceData?.assetId !== tool.sourceAssetId ||
    !sourceEdge || !sourceMedia
  ) {
    throw new CanvasGenerationBindingConflictError(
      "Image tool source changed before admission",
    );
  }
  const requiresMask = tool.operation === "redraw" || tool.operation === "erase" ||
    tool.operation === "outpaint";
  if (!tool.mask) {
    if (
      requiresMask || data.imageToolMaskAssetId !== undefined ||
      data.imageToolPreparedAssetId !== undefined ||
      data.imageToolOutpaintParameters !== undefined
    ) {
      throw new CanvasGenerationBindingConflictError(
        "Image tool mask changed before admission",
      );
    }
    return;
  }
  const mask = tool.mask;
  const maskMedia = executeTransactionScopedCommand(
    database,
    readReadyMediaAssetCommand,
    { assetId: mask.assetId, kind: "image", ownerId },
  );
  if (
    !requiresMask || data.imageToolMaskFeatherPixels !== mask.featherPixels ||
    !absentOrEqual("imageToolMaskAssetId", mask.assetId) ||
    !absentOrEqual("imageToolMaskVersion", mask.version) ||
    !absentOrEqual("imageToolMaskWidth", mask.width) ||
    !absentOrEqual("imageToolMaskHeight", mask.height) ||
    !maskMedia || maskMedia.contentType !== "image/png" ||
    maskMedia.byteSize < 1 || maskMedia.byteSize > imageToolMaximums.maskBytes ||
    maskMedia.mediaWidth !== mask.width || maskMedia.mediaHeight !== mask.height
  ) {
    throw new CanvasGenerationBindingConflictError(
      "Image tool mask changed before admission",
    );
  }
  if (tool.operation !== "outpaint") {
    if (
      tool.outpaint !== undefined || tool.preparedInput !== undefined ||
      data.imageToolOutpaintParameters !== undefined ||
      data.imageToolPreparedAssetId !== undefined ||
      sourceMedia.mediaWidth !== null && sourceMedia.mediaWidth !== mask.width ||
      sourceMedia.mediaHeight !== null && sourceMedia.mediaHeight !== mask.height
    ) {
      throw new CanvasGenerationBindingConflictError(
        "Image tool prepared input changed before admission",
      );
    }
    return;
  }
  const prepared = tool.preparedInput;
  const outpaint = tool.outpaint;
  const preparedMedia = prepared
    ? executeTransactionScopedCommand(database, readReadyMediaAssetCommand, {
        assetId: prepared.assetId,
        kind: "image",
        ownerId,
      })
    : undefined;
  if (
    !prepared || !outpaint ||
    stableSha256(data.imageToolOutpaintParameters) !== stableSha256(outpaint) ||
    !absentOrEqual("imageToolPreparedAssetId", prepared.assetId) ||
    !absentOrEqual("imageToolPreparedVersion", prepared.version) ||
    !absentOrEqual("imageToolPreparedWidth", prepared.width) ||
    !absentOrEqual("imageToolPreparedHeight", prepared.height) ||
    !preparedMedia || preparedMedia.contentType !== "image/png" ||
    preparedMedia.byteSize < 1 ||
    preparedMedia.byteSize > imageToolMaximums.inputBytes ||
    preparedMedia.mediaWidth !== prepared.width ||
    preparedMedia.mediaHeight !== prepared.height ||
    sourceMedia.mediaWidth !== null &&
      sourceMedia.mediaWidth !== outpaint.sourceWidth ||
    sourceMedia.mediaHeight !== null &&
      sourceMedia.mediaHeight !== outpaint.sourceHeight
  ) {
    throw new CanvasGenerationBindingConflictError(
      "Image tool prepared input changed before admission",
    );
  }
}

/**
 * Binds a newly admitted modern single-node task to its Canvas in the task
 * store's existing BEGIN IMMEDIATE transaction. This server-only projection
 * commits before Provider launch and never changes the input graph revision.
 */
function bindSingleNodeGenerationCore(input: Readonly<{
  canvasId: string;
  contractFingerprint: string;
  database: DatabaseSync;
  inputFingerprint: string;
  imageTool?: ImageGenerationToolInput;
  kind: "audio" | "image" | "text" | "video";
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  modelConfigurationRevision: string;
  modelReleaseRevision: string;
  nodeId: string;
  ownerId: string;
  ownershipKey: string;
  requestId: string;
  taskId: string;
  taskState: CanvasGenerationTaskState;
}>): CanvasMutationGatewayResult {
  assertTransaction(input.database);
  const operationId = `server-generation-bind:${input.taskId}`;
  if (input.imageTool && input.kind !== "image") {
    throw new CanvasGenerationBindingConflictError(
      "Image tool identity cannot bind a non-image task",
    );
  }
  const imageToolPatch: Record<string, unknown> = input.imageTool
    ? {
        imageAssetOrigin: "image-tool",
        imageToolMaskAssetId: input.imageTool.mask?.assetId,
        imageToolMaskHeight: input.imageTool.mask?.height,
        imageToolMaskVersion: input.imageTool.mask?.version,
        imageToolMaskWidth: input.imageTool.mask?.width,
        imageToolOperation: input.imageTool.operation,
        imageToolOperationId: input.imageTool.operationId,
        imageToolOutputBackground: input.imageTool.outputBackground,
        imageToolPreparedAssetId: input.imageTool.preparedInput?.assetId,
        imageToolPreparedHeight: input.imageTool.preparedInput?.height,
        imageToolPreparedVersion: input.imageTool.preparedInput?.version,
        imageToolPreparedWidth: input.imageTool.preparedInput?.width,
        imageToolSourceAssetId: input.imageTool.sourceAssetId,
      }
    : {};
  const bindingPatch: Record<string, unknown> = {
    groupRunSuccessInputFingerprint: undefined,
    groupRunSuccessModelConfigurationRevision: undefined,
    groupRunSuccessModelReleaseRevision: undefined,
    groupRunSuccessOwnershipKey: undefined,
    groupRunSuccessResultKey: undefined,
    groupRunSuccessTaskId: undefined,
    legacyTerminalDetachApplicationId: undefined,
    workflowExecutionRunId: undefined,
    [`${input.kind}GenerationInputKey`]: input.inputFingerprint,
    [`${input.kind}GenerationModelConfigurationRevision`]:
      input.modelConfigurationRevision,
    [`${input.kind}GenerationModelReleaseRevision`]: input.modelReleaseRevision,
    [`${input.kind}GenerationOwnershipKey`]: input.ownershipKey,
    [`${input.kind}GenerationTaskId`]: input.taskId,
    ...imageToolPatch,
    ...(input.kind === "video"
      ? {
          videoGenerationContractFingerprint: undefined,
          videoGenerationModelInputContractFingerprint:
            input.contractFingerprint,
        }
      : {
          [`${input.kind}GenerationContractFingerprint`]:
            input.contractFingerprint,
        }),
  };
  const payloadSha256 = stableSha256({
    bindingPatch,
    canvasId: input.canvasId,
    kind: input.kind,
    nodeId: input.nodeId,
    ownerId: input.ownerId,
    taskId: input.taskId,
  });
  const current = canvasRow(input.database, input.ownerId, input.canvasId);
  if (!current) throw new CanvasGenerationBindingConflictError("Canvas not found");
  const existing = receipt(
    input.database,
    input.ownerId,
    input.canvasId,
    operationId,
  );
  if (existing) {
    if (existing.payload_sha256 !== payloadSha256) {
      throw new CanvasMutationGatewayUnavailableError(
        "Generation binding operation identity changed payload",
      );
    }
    return receiptResult(existing, current, true);
  }
  const state = inspectSingleNodeGenerationCanvasState({
    database: input.database,
    ownerId: input.ownerId,
    taskId: input.taskId,
  });
  if (!state.bindingMatches) {
    throw new CanvasGenerationBindingConflictError();
  }
  assertReceiptCapacity(input.database, input.ownerId, input.canvasId);
  const before = documentFromRow(current);
  try {
    validateCanvasDocumentTopology(before);
  } catch {
    throw new CanvasGenerationBindingConflictError(
      "Canvas topology is invalid for generation admission",
    );
  }
  const node = before.nodes.map((value) => value && typeof value === "object" &&
      !Array.isArray(value) ? value as Record<string, unknown> : undefined)
    .find((value) => value?.id === input.nodeId);
  const data = node?.data && typeof node.data === "object" &&
      !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : undefined;
  if (!node || !data || node.type !== input.kind) {
    throw new CanvasGenerationBindingConflictError();
  }
  if (input.imageTool) {
    assertImageToolGenerationBinding({
      data,
      database: input.database,
      document: before,
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      tool: input.imageTool,
    });
  }
  const nextData = { ...data };
  for (const [field, value] of Object.entries(bindingPatch)) {
    if (value === undefined) delete nextData[field];
    else nextData[field] = value;
  }
  const candidate: MutableCanvasDocument = {
    ...before,
    nodes: before.nodes.map((value) => value === node
      ? { ...node, data: nextData }
      : value),
  };
  validateCanvasDocumentTopology(candidate);
  const beforeDocumentSha256 = canvasDocumentFingerprint(before);
  const beforeInputSha256 = canvasInputGraphFingerprint(before);
  const afterDocumentSha256 = canvasDocumentFingerprint(candidate);
  const afterInputSha256 = canvasInputGraphFingerprint(candidate);
  const transition = canvasRevisionTransition({
    afterDocumentSha256,
    afterInputSha256,
    beforeDocumentSha256,
    beforeInputSha256,
    documentRevision: current.revision,
    inputGraphRevision: current.graph_revision,
  });
  if (transition.inputGraphRevision !== current.graph_revision) {
    throw new CanvasMutationGatewayUnavailableError(
      "Server generation binding changed the input graph revision",
    );
  }
  if (transition.changed) {
    const updated = input.database.prepare(`
      UPDATE canvas_documents
      SET revision = ?, graph_revision = ?, nodes = ?, edges = ?, viewport = ?,
          updated_at = ?
      WHERE owner_id = ? AND id = ? AND revision = ?
    `).run(
      transition.documentRevision,
      transition.inputGraphRevision,
      JSON.stringify(candidate.nodes),
      JSON.stringify(candidate.edges),
      JSON.stringify(candidate.viewport),
      new Date().toISOString(),
      input.ownerId,
      input.canvasId,
      current.revision,
    );
    if (updated.changes !== 1) {
      throw new CanvasMutationGatewayUnavailableError(
        "Generation binding lost its writer fence",
      );
    }
    executeTransactionScopedCommand(input.database, touchProjectUpdatedAtCommand, {
      bypass: input.ownerId === "__test__",
      canvasId: input.canvasId,
      ownerId: input.ownerId,
      updatedAt: Date.now(),
    });
  }
  insertInternalReceipt(input.database, {
    actorType: "server",
    affectedSubgraphSha256: stableSha256({ nodeId: input.nodeId }),
    baselineDocumentRevision: current.revision,
    baselineEpoch: input.loadTokenEpoch,
    baselineInputRevision: current.graph_revision,
    baselineLoadToken: input.loadTokenForRevision(current.revision),
    canvasId: input.canvasId,
    changedPaths: transition.changed
      ? [`nodes.${input.nodeId}.server-generation-binding`]
      : [],
    commandType: "server.projection",
    conflictCode: null,
    documentRevision: transition.documentRevision,
    documentSha256: afterDocumentSha256,
    inputRevision: transition.inputGraphRevision,
    inputSha256: afterInputSha256,
    operationId,
    outcome: transition.changed ? "APPLIED" : "NO_OP",
    ownerId: input.ownerId,
    payloadSha256,
    requestId: input.requestId,
  });
  const result = receipt(
    input.database,
    input.ownerId,
    input.canvasId,
    operationId,
  );
  const after = canvasRow(input.database, input.ownerId, input.canvasId);
  if (!result || !after) {
    throw new CanvasMutationGatewayUnavailableError(
      "Generation binding receipt was not persisted",
    );
  }
  return receiptResult(result, after, false);
}

export function bindSingleNodeGenerationInTransaction(input: Readonly<{
  canvasId: string;
  contractFingerprint: string;
  database: DatabaseSync;
  inputFingerprint: string;
  imageTool?: ImageGenerationToolInput;
  kind: "audio" | "image" | "text" | "video";
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  modelConfigurationRevision: string;
  modelReleaseRevision: string;
  nodeId: string;
  ownerId: string;
  ownershipKey: string;
  requestId: string;
  taskId: string;
  taskState: CanvasGenerationTaskState;
}>): CanvasMutationGatewayResult {
  const before = canvasRow(input.database, input.ownerId, input.canvasId);
  const result = bindSingleNodeGenerationCore(input);
  const affectedNodeHash = result.affectedSubgraphSha256 ??
    stableSha256({ nodeId: input.nodeId });
  deferGatewayCommand({
    actor: "server",
    affectedNodeHash,
    before,
    commandKind: "server.generation-binding",
    database: input.database,
    outcome: commandOutcome(result),
    requestId: input.requestId,
    result,
  });
  deferCanvasRouteEvent(input.database, {
    callerSymbol: "server.generationAdmissionApplication",
    capability: "internal-server-v1",
    clientBuild: currentVersion,
    operation: "single-node-generation-binding",
    outcome: commandOutcome(result),
    requestId: input.requestId,
    route: "canvas.server-generation-binding",
    runId: null,
    serverClass: "T",
    taskId: input.taskId,
  });
  if (!result.replayed) {
    deferGenerationLifecycleEvent(input.database, {
      kind: input.kind,
      operation: "single-node-generation-binding",
      outcome: `generation-task.${input.taskState}`,
      projectionState: "pending",
      requestId: input.requestId,
      runId: null,
      taskId: input.taskId,
      taskState: input.taskState,
    });
  }
  return result;
}

function applyGenerationProjectionCore(input: Readonly<{
  baseDocument?: MutableCanvasDocument;
  database: DatabaseSync;
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  projection: AuthoritativeCanvasGenerationProjection;
  requestId?: string;
}>): "applied" | "conflict" | "failed" {
  assertTransaction(input.database);
  assertAuthoritativeCanvasGenerationProjection(input.projection);
  const projection = input.projection;
  const projectionRequestId = input.requestId ?? randomUUID();
  const operationId = projection.operationId;
  const payloadSha256 = projection.payloadSha256;
  const existing = receipt(
    input.database,
    projection.ownerId,
    projection.canvasId,
    operationId,
  );
  const current = canvasRow(
    input.database,
    projection.ownerId,
    projection.canvasId,
  );
  if (!current) return "failed";
  const authoritativeBefore = documentFromRow(current);
  if (existing) {
    if (existing.payload_sha256 !== payloadSha256) {
      throw new CanvasMutationGatewayUnavailableError(
        "Server projection operation identity changed payload",
      );
    }
    if (existing.outcome === "REJECTED_CONFLICT") return "conflict";
    if (input.baseDocument) {
      validateCanvasDocumentTopology(input.baseDocument);
      const beforeDocumentSha256 = canvasDocumentFingerprint(authoritativeBefore);
      const beforeInputSha256 = canvasInputGraphFingerprint(authoritativeBefore);
      const afterDocumentSha256 = canvasDocumentFingerprint(input.baseDocument);
      const afterInputSha256 = canvasInputGraphFingerprint(input.baseDocument);
      const transition = canvasRevisionTransition({
        afterDocumentSha256,
        afterInputSha256,
        beforeDocumentSha256,
        beforeInputSha256,
        documentRevision: current.revision,
        inputGraphRevision: current.graph_revision,
      });
      if (transition.changed) {
        const updated = input.database.prepare(`
          UPDATE canvas_documents
          SET revision = ?, graph_revision = ?, nodes = ?, edges = ?, viewport = ?,
              updated_at = ?
          WHERE owner_id = ? AND id = ? AND revision = ?
        `).run(
          transition.documentRevision,
          transition.inputGraphRevision,
          JSON.stringify(input.baseDocument.nodes),
          JSON.stringify(input.baseDocument.edges),
          JSON.stringify(input.baseDocument.viewport),
          new Date().toISOString(),
          projection.ownerId,
          projection.canvasId,
          current.revision,
        );
        if (updated.changes !== 1) {
          throw new CanvasMutationGatewayUnavailableError(
            "Legacy Canvas merge lost its writer fence",
          );
        }
        executeTransactionScopedCommand(input.database, touchProjectUpdatedAtCommand, {
          bypass: false,
          canvasId: projection.canvasId,
          ownerId: projection.ownerId,
          updatedAt: Date.now(),
        });
      }
    }
    return "applied";
  }
  assertReceiptCapacity(
    input.database,
    projection.ownerId,
    projection.canvasId,
  );
  const before = input.baseDocument ?? authoritativeBefore;
  try {
    validateCanvasDocumentTopology(before);
  } catch (error) {
    if (!(error instanceof CanvasCommandApplicationError)) throw error;
    const documentSha256 = canvasDocumentFingerprint(before);
    const inputSha256 = canvasInputGraphFingerprint(before);
    insertInternalReceipt(input.database, {
      actorType: "server",
      affectedSubgraphSha256: stableSha256({ nodeId: projection.nodeId }),
      baselineDocumentRevision: current.revision,
      baselineEpoch: input.loadTokenEpoch,
      baselineInputRevision: current.graph_revision,
      baselineLoadToken: input.loadTokenForRevision(current.revision),
      canvasId: projection.canvasId,
      changedPaths: [],
      commandType: "server.projection",
      conflictCode: "CANVAS_TOPOLOGY_CONFLICT",
      documentRevision: current.revision,
      documentSha256,
      inputRevision: current.graph_revision,
      inputSha256,
      operationId,
      outcome: "REJECTED_CONFLICT",
      ownerId: projection.ownerId,
      payloadSha256,
      requestId: projectionRequestId,
    });
    return "conflict";
  }
  const node = before.nodes.map((value) => value && typeof value === "object" &&
      !Array.isArray(value) ? value as Record<string, unknown> : undefined)
    .find((value) => value?.id === projection.nodeId);
  const data = node?.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : undefined;
  const bindingConflict = !projection.bindingMatches || !node || !data ||
    node.type !== projection.kind;
  if (bindingConflict) {
    const documentSha256 = canvasDocumentFingerprint(before);
    const inputSha256 = canvasInputGraphFingerprint(before);
    insertInternalReceipt(input.database, {
      actorType: "server",
      affectedSubgraphSha256: stableSha256({ nodeId: projection.nodeId }),
      baselineDocumentRevision: current.revision,
      baselineEpoch: input.loadTokenEpoch,
      baselineInputRevision: current.graph_revision,
      baselineLoadToken: input.loadTokenForRevision(current.revision),
      canvasId: projection.canvasId,
      changedPaths: [],
      commandType: "server.projection",
      conflictCode: "CANVAS_SERVER_OWNERSHIP_CONFLICT",
      documentRevision: current.revision,
      documentSha256,
      inputRevision: current.graph_revision,
      inputSha256,
      operationId,
      outcome: "REJECTED_CONFLICT",
      ownerId: projection.ownerId,
      payloadSha256,
      requestId: projectionRequestId,
    });
    return "conflict";
  }
  const nextData = { ...data };
  for (const [field, value] of Object.entries(projection.patch)) {
    if (value === undefined) delete nextData[field];
    else nextData[field] = value;
  }
  const candidate: MutableCanvasDocument = {
    ...before,
    nodes: before.nodes.map((value) => value === node
      ? { ...node, data: nextData }
      : value),
  };
  validateCanvasDocumentTopology(candidate);
  const persisted = candidate;
  const beforeDocumentSha256 = canvasDocumentFingerprint(authoritativeBefore);
  const beforeInputSha256 = canvasInputGraphFingerprint(authoritativeBefore);
  const afterDocumentSha256 = canvasDocumentFingerprint(persisted);
  const afterInputSha256 = canvasInputGraphFingerprint(persisted);
  const transition = canvasRevisionTransition({
    afterDocumentSha256,
    afterInputSha256,
    beforeDocumentSha256,
    beforeInputSha256,
    documentRevision: current.revision,
    inputGraphRevision: current.graph_revision,
  });
  if (transition.changed) {
    const updated = input.database.prepare(`
      UPDATE canvas_documents
      SET revision = ?, graph_revision = ?, nodes = ?, edges = ?, viewport = ?,
          updated_at = ?
      WHERE owner_id = ? AND id = ? AND revision = ?
    `).run(
      transition.documentRevision,
      transition.inputGraphRevision,
      JSON.stringify(persisted.nodes),
      JSON.stringify(persisted.edges),
      JSON.stringify(persisted.viewport),
      new Date().toISOString(),
      projection.ownerId,
      projection.canvasId,
      current.revision,
    );
    if (updated.changes !== 1) {
      throw new CanvasMutationGatewayUnavailableError(
        "Canvas projection lost its writer fence",
      );
    }
    executeTransactionScopedCommand(input.database, touchProjectUpdatedAtCommand, {
      bypass: false,
      canvasId: projection.canvasId,
      ownerId: projection.ownerId,
      updatedAt: Date.now(),
    });
  }
  insertInternalReceipt(input.database, {
    actorType: "server",
    affectedSubgraphSha256: stableSha256({ nodeId: projection.nodeId }),
    baselineDocumentRevision: current.revision,
    baselineEpoch: input.loadTokenEpoch,
    baselineInputRevision: current.graph_revision,
    baselineLoadToken: input.loadTokenForRevision(current.revision),
    canvasId: projection.canvasId,
    changedPaths: transition.changed
      ? [
          ...(input.baseDocument &&
              canvasDocumentFingerprint(input.baseDocument) !==
                canvasDocumentFingerprint(authoritativeBefore)
            ? ["legacy.user-document"]
            : []),
          `nodes.${projection.nodeId}.server-projection`,
        ]
      : [],
    commandType: "server.projection",
    conflictCode: null,
    documentRevision: transition.documentRevision,
    documentSha256: afterDocumentSha256,
    inputRevision: transition.inputGraphRevision,
    inputSha256: afterInputSha256,
    operationId,
    outcome: transition.changed ? "APPLIED" : "NO_OP",
    ownerId: projection.ownerId,
    payloadSha256,
    requestId: projectionRequestId,
  });
  return "applied";
}

export function applyGenerationProjectionInTransaction(input: Readonly<{
  baseDocument?: MutableCanvasDocument;
  database: DatabaseSync;
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  projection: AuthoritativeCanvasGenerationProjection;
  requestId?: string;
}>): "applied" | "conflict" | "failed" {
  const requestId = input.requestId ?? randomUUID();
  const before = canvasRow(
    input.database,
    input.projection.ownerId,
    input.projection.canvasId,
  );
  const result = applyGenerationProjectionCore({ ...input, requestId });
  afterGenerationProjectionReceiptForTests?.(input.projection);
  const after = canvasRow(
    input.database,
    input.projection.ownerId,
    input.projection.canvasId,
  );
  const outcome = `projection.${result}`;
  deferCanvasCommandEvent(input.database, {
    actor: "server",
    affectedNodeHash: stableSha256({ nodeId: input.projection.nodeId }),
    afterDocumentRevision: after?.revision ?? null,
    afterInputRevision: after?.graph_revision ?? null,
    beforeDocumentRevision: before?.revision ?? null,
    beforeInputRevision: before?.graph_revision ?? null,
    commandKind: "server.projection",
    operationId: input.projection.operationId,
    outcome,
    requestId,
  });
  deferCanvasRouteEvent(input.database, {
    callerSymbol: input.projection.scope === "workflow"
      ? "server.canvasWorkflowProjection"
      : "server.generationCanvasProjectionService",
    capability: "internal-server-v1",
    clientBuild: currentVersion,
    operation: input.projection.scope === "workflow"
      ? "workflow-result-projection"
      : "single-node-result-projection",
    outcome,
    requestId,
    route: "canvas.server-projection",
    runId: input.projection.runId,
    serverClass: result === "applied" ? "A" : result === "failed" ? "B" : "D",
    taskId: input.projection.taskId,
  });
  deferGenerationLifecycleEvent(input.database, {
    kind: input.projection.kind,
    operation: input.projection.scope === "workflow"
      ? "workflow-result-projection"
      : "single-node-result-projection",
    outcome,
    projectionState: result,
    requestId,
    runId: input.projection.runId,
    taskId: input.projection.taskId,
    taskState: "success",
  });
  return result;
}

function legacyTerminalDataFingerprint(data: unknown) {
  return stableValueFingerprint(data);
}

function legacyTerminalDetachedAlready(
  data: Record<string, unknown>,
  input: Readonly<{
    applicationId: string;
    kind: "audio" | "image" | "text" | "video";
  }>,
) {
  return data.legacyTerminalDetachApplicationId === input.applicationId &&
    data.workflowExecutionRunId === undefined &&
    data[`${input.kind}GenerationTaskId`] === undefined &&
    data[`${input.kind}GenerationOwnershipKey`] === undefined &&
    data[`${input.kind}GenerationInputKey`] === undefined &&
    data[`${input.kind}Generating`] !== true;
}

function legacyTerminalBindingMatches(
  node: Record<string, unknown>,
  data: Record<string, unknown>,
  input: Readonly<{
    inputFingerprint: string;
    kind: "audio" | "image" | "text" | "video";
    nodeDataFingerprint: string;
    ownershipKey: string;
    runId: string;
    taskId: string;
  }>,
) {
  return node.type === input.kind &&
    data.workflowExecutionRunId === input.runId &&
    data[`${input.kind}GenerationTaskId`] === input.taskId &&
    data[`${input.kind}GenerationOwnershipKey`] === input.ownershipKey &&
    data[`${input.kind}GenerationInputKey`] === input.inputFingerprint &&
    data[`${input.kind}Generating`] === true &&
    legacyTerminalDataFingerprint(data) === input.nodeDataFingerprint;
}

function legacyTerminalNextData(
  data: Record<string, unknown>,
  input: Readonly<{
    applicationId: string;
    authoritativeResultKey?: string;
    kind: "audio" | "image" | "text" | "video";
    ownershipKey: string;
    resultKey?: string;
    taskId: string;
  }>,
) {
  const next = {
    ...data,
    [`${input.kind}Generating`]: false,
    legacyTerminalDetachApplicationId: input.applicationId,
  };
  delete next.workflowExecutionRunId;
  for (const suffix of [
    "GenerationTaskId",
    "GenerationOwnershipKey",
    "GenerationInputKey",
    "GenerationError",
    "GenerationErrorCode",
    "GenerationRetryAllowed",
    "GenerationRetryBlockCode",
    "GenerationRetryBlockReason",
  ]) delete next[`${input.kind}${suffix}`];
  const proofFields = [
    "groupRunSuccessTaskId",
    "groupRunSuccessOwnershipKey",
    "groupRunSuccessResultKey",
  ] as const;
  if (proofFields.some((field) => next[field] !== undefined)) {
    if (
      next.groupRunSuccessTaskId !== input.taskId ||
      next.groupRunSuccessOwnershipKey !== input.ownershipKey ||
      typeof next.groupRunSuccessResultKey !== "string" ||
      input.resultKey === undefined || input.authoritativeResultKey === undefined ||
      next.groupRunSuccessResultKey !== input.resultKey ||
      input.resultKey !== input.authoritativeResultKey
    ) return undefined;
    for (const field of proofFields) delete next[field];
  }
  return next;
}

function internalReceiptResult(
  database: DatabaseSync,
  ownerId: string,
  canvasId: string,
  operationId: string,
  current: CanvasRow,
  replayed: boolean,
) {
  const stored = receipt(database, ownerId, canvasId, operationId);
  if (!stored) {
    throw new CanvasMutationGatewayUnavailableError(
      "Canvas operation receipt was not persisted",
    );
  }
  return receiptResult(stored, current, replayed);
}

function detachLegacyTerminalCore(input: Readonly<{
  applicationId: string;
  authoritativeResultKey?: string;
  canvasId: string;
  database: DatabaseSync;
  inputFingerprint: string;
  kind: "audio" | "image" | "text" | "video";
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  nodeDataFingerprint: string;
  nodeId: string;
  observedTerminalState: "cancelled" | "failed" | "success";
  ownerId: string;
  ownershipKey: string;
  preconditionConflictCode?:
    | "GENERATION_TERMINAL_PROOF_CONFLICT"
    | "GENERATION_TERMINAL_STATE_CONFLICT"
    | "GENERATION_TERMINAL_TASK_CONFLICT";
  requestId: string;
  resultKey?: string;
  runId: string;
  taskId: string;
}>): CanvasMutationGatewayResult | CanvasOperationReuseResult | undefined {
  assertTransaction(input.database);
  const operationId = input.applicationId;
  const payloadSha256 = stableSha256({
    applicationId: input.applicationId,
    canvasId: input.canvasId,
    inputFingerprint: input.inputFingerprint,
    kind: input.kind,
    nodeDataFingerprint: input.nodeDataFingerprint,
    nodeId: input.nodeId,
    observedTerminalState: input.observedTerminalState,
    ownerId: input.ownerId,
    ownershipKey: input.ownershipKey,
    resultKey: input.resultKey,
    runId: input.runId,
    taskId: input.taskId,
  });
  const existing = receipt(
    input.database,
    input.ownerId,
    input.canvasId,
    operationId,
  );
  const current = canvasRow(input.database, input.ownerId, input.canvasId);
  if (!current) return undefined;
  if (existing) {
    if (existing.payload_sha256 !== payloadSha256) {
      recordOperationReuseAudit(
        input.database,
        input.ownerId,
        input.canvasId,
        operationId,
        input.requestId,
        existing.payload_sha256,
        payloadSha256,
      );
      return Object.freeze({
        authoritativeDocument: authoritativeDocument(current),
        code: "CANVAS_OPERATION_REUSED",
        operationDocumentRevision: Number(existing.result_document_revision),
        operationId,
        operationInputGraphRevision: Number(existing.result_input_revision),
        originalRequestId: existing.original_request_id,
        replayed: false,
      });
    }
    return receiptResult(existing, current, true);
  }
  assertReceiptCapacity(input.database, input.ownerId, input.canvasId);
  const before = documentFromRow(current);
  const beforeDocumentSha256 = canvasDocumentFingerprint(before);
  const beforeInputSha256 = canvasInputGraphFingerprint(before);
  const settle = (
    conflictCode: CanvasGatewayConflictCode | null,
    outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT",
    document: MutableCanvasDocument,
    documentRevision: number,
    inputRevision: number,
    changedPaths: readonly string[],
  ) => {
    const persisted = document;
    insertInternalReceipt(input.database, {
      actorType: "legacy",
      affectedSubgraphSha256: stableSha256({ nodeId: input.nodeId }),
      baselineDocumentRevision: current.revision,
      baselineEpoch: input.loadTokenEpoch,
      baselineInputRevision: current.graph_revision,
      baselineLoadToken: input.loadTokenForRevision(current.revision),
      canvasId: input.canvasId,
      changedPaths,
      commandType: "legacy.terminal-detach",
      conflictCode,
      documentRevision,
      documentSha256: canvasDocumentFingerprint(persisted),
      inputRevision,
      inputSha256: canvasInputGraphFingerprint(persisted),
      operationId,
      outcome,
      ownerId: input.ownerId,
      payloadSha256,
      requestId: input.requestId,
    });
    const settledRow = canvasRow(input.database, input.ownerId, input.canvasId);
    if (!settledRow) throw new CanvasMutationGatewayUnavailableError();
    return internalReceiptResult(
      input.database,
      input.ownerId,
      input.canvasId,
      operationId,
      settledRow,
      false,
    );
  };
  if (input.preconditionConflictCode) {
    return settle(
      input.preconditionConflictCode,
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  try {
    validateCanvasDocumentTopology(before);
  } catch (error) {
    if (!(error instanceof CanvasCommandApplicationError)) throw error;
    return settle(
      "CANVAS_TOPOLOGY_CONFLICT",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  const node = before.nodes.map((value) => value && typeof value === "object" &&
      !Array.isArray(value) ? value as Record<string, unknown> : undefined)
    .find((value) => value?.id === input.nodeId);
  const data = node?.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : undefined;
  if (!node || !data) {
    return settle(
      "GENERATION_TERMINAL_BINDING_CONFLICT",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  if (legacyTerminalDetachedAlready(data, input)) {
    return settle(
      null,
      "NO_OP",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  if (!legacyTerminalBindingMatches(node, data, input)) {
    return settle(
      "GENERATION_TERMINAL_BINDING_CONFLICT",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  const nextData = legacyTerminalNextData(data, input);
  if (!nextData) {
    return settle(
      "GENERATION_TERMINAL_PROOF_CONFLICT",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  const candidate: MutableCanvasDocument = {
    ...before,
    nodes: before.nodes.map((value) => value === node
      ? { ...node, data: nextData }
      : value),
  };
  validateCanvasDocumentTopology(candidate);
  const persisted = candidate;
  const afterDocumentSha256 = canvasDocumentFingerprint(persisted);
  const afterInputSha256 = canvasInputGraphFingerprint(persisted);
  const transition = canvasRevisionTransition({
    afterDocumentSha256,
    afterInputSha256,
    beforeDocumentSha256,
    beforeInputSha256,
    documentRevision: current.revision,
    inputGraphRevision: current.graph_revision,
  });
  if (transition.inputChanged) {
    throw new CanvasMutationGatewayUnavailableError(
      "Legacy terminal detach changed the Canvas input graph",
    );
  }
  if (transition.changed) {
    const updated = input.database.prepare(`
      UPDATE canvas_documents
      SET revision = ?, graph_revision = ?, nodes = ?, edges = ?, viewport = ?,
          updated_at = ?
      WHERE owner_id = ? AND id = ? AND revision = ?
    `).run(
      transition.documentRevision,
      transition.inputGraphRevision,
      JSON.stringify(persisted.nodes),
      JSON.stringify(persisted.edges),
      JSON.stringify(persisted.viewport),
      new Date().toISOString(),
      input.ownerId,
      input.canvasId,
      current.revision,
    );
    if (updated.changes !== 1) {
      throw new CanvasMutationGatewayUnavailableError(
        "Canvas terminal detach lost its writer fence",
      );
    }
    executeTransactionScopedCommand(input.database, touchProjectUpdatedAtCommand, {
      bypass: false,
      canvasId: input.canvasId,
      ownerId: input.ownerId,
      updatedAt: Date.now(),
    });
  }
  return settle(
    null,
    transition.changed ? "APPLIED" : "NO_OP",
    persisted,
    transition.documentRevision,
    transition.inputGraphRevision,
    transition.changed
      ? [`nodes.${input.nodeId}.legacy-terminal-detach`]
      : [],
  );
}

export function detachLegacyTerminalInTransaction(input: Readonly<{
  applicationId: string;
  authoritativeResultKey?: string;
  canvasId: string;
  database: DatabaseSync;
  inputFingerprint: string;
  kind: "audio" | "image" | "text" | "video";
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  nodeDataFingerprint: string;
  nodeId: string;
  observedTerminalState: "cancelled" | "failed" | "success";
  ownerId: string;
  ownershipKey: string;
  preconditionConflictCode?:
    | "GENERATION_TERMINAL_PROOF_CONFLICT"
    | "GENERATION_TERMINAL_STATE_CONFLICT"
    | "GENERATION_TERMINAL_TASK_CONFLICT";
  requestId: string;
  resultKey?: string;
  runId: string;
  taskId: string;
}>): CanvasMutationGatewayResult | CanvasOperationReuseResult | undefined {
  const before = canvasRow(input.database, input.ownerId, input.canvasId);
  const result = detachLegacyTerminalCore(input);
  if (result) {
    deferGatewayCommand({
      actor: "legacy",
      affectedNodeHash: "affectedSubgraphSha256" in result &&
          result.affectedSubgraphSha256
        ? result.affectedSubgraphSha256
        : stableSha256({ nodeId: input.nodeId }),
      before,
      commandKind: "legacy.terminal-detach",
      database: input.database,
      outcome: legacyDetachOutcome(result),
      requestId: input.requestId,
      result,
    });
  }
  return result;
}

function recordOperationReuseAudit(
  database: DatabaseSync,
  ownerId: string,
  canvasId: string,
  operationId: string,
  requestId: string,
  existingPayloadSha256: string,
  receivedPayloadSha256: string,
) {
  executeTransactionScopedCommand(database, recordCanvasOperationReuseAuditCommand, {
    details: JSON.stringify({
      canvasId,
      existingPayloadSha256,
      operationId,
      receivedPayloadSha256,
      requestId,
    }),
    ownerId,
    timestamp: new Date().toISOString(),
  });
}

export type LegacyGenerationProjectionHint = Readonly<{
  accountId: string;
  applicationId: string;
  inputFingerprint: string;
  kind: "audio" | "image" | "text" | "video";
  nodeId: string;
  ownershipKey: string;
  resultKey: string;
  runId: string;
  semanticRevision: string;
  taskId: string;
}>;

export type LegacyCanvasPutDocument = Readonly<{
  edges: readonly unknown[];
  generationProjection?: LegacyGenerationProjectionHint;
  nodes: readonly unknown[];
  observedLoadToken: string;
  observedRevision: number;
  saveAttemptId: string;
  saveSequence: number;
  saveSessionId: string;
  viewport: Readonly<{ x: number; y: number; zoom: number }>;
}>;

function legacyGenerationProjectionIdentity(
  projection: LegacyGenerationProjectionHint,
) {
  return {
    inputFingerprint: projection.inputFingerprint,
    kind: projection.kind,
    nodeId: projection.nodeId,
    ownershipKey: projection.ownershipKey,
    runId: projection.runId,
    taskId: projection.taskId,
  };
}

/**
 * Compatibility bridge for cached browsers that still send
 * `generationProjection` in a full-document PUT. Only identity hints cross
 * this boundary: the result patch/key supplied by the browser is ignored and
 * rebuilt from the committed task/publication/media ledgers.
 */
export function applyLegacyGenerationProjectionInTransaction(input: Readonly<{
  baseDocument?: MutableCanvasDocument;
  canvasId: string;
  database: DatabaseSync;
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  ownerId: string;
  projection: LegacyGenerationProjectionHint;
  requestId: string;
}>): "applied" | "reconcile-required" {
  assertTransaction(input.database);
  if (input.baseDocument) {
    const current = canvasRow(input.database, input.ownerId, input.canvasId);
    if (!current || canvasInputGraphFingerprint(input.baseDocument) !==
        canvasInputGraphFingerprint(documentFromRow(current))) {
      return "reconcile-required";
    }
  }
  const built = buildCanvasProjectionIdentity({
    canvasId: input.canvasId,
    database: input.database,
    kind: input.projection.kind,
    nodeId: input.projection.nodeId,
    ownerId: input.ownerId,
    runId: input.projection.runId,
    taskId: input.projection.taskId,
  });
  if (built.status !== "ready") return "reconcile-required";
  const authoritative = built.projection;
  const hintedIdentity = legacyGenerationProjectionIdentity(input.projection);
  if (
    authoritative.canvasId !== input.canvasId ||
    authoritative.ownerId !== input.ownerId ||
    authoritative.inputFingerprint !== hintedIdentity.inputFingerprint ||
    authoritative.kind !== hintedIdentity.kind ||
    authoritative.nodeId !== hintedIdentity.nodeId ||
    authoritative.ownershipKey !== hintedIdentity.ownershipKey ||
    authoritative.runId !== hintedIdentity.runId ||
    authoritative.taskId !== hintedIdentity.taskId
  ) return "reconcile-required";
  return applyGenerationProjectionInTransaction({
    ...(input.baseDocument ? { baseDocument: input.baseDocument } : {}),
    database: input.database,
    loadTokenEpoch: input.loadTokenEpoch,
    loadTokenForRevision: input.loadTokenForRevision,
    projection: authoritative,
    requestId: input.requestId,
  }) === "applied"
    ? "applied"
    : "reconcile-required";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function lengthPrefixedSha256(values: readonly string[]) {
  const hash = createHash("sha256");
  for (const value of values) {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function legacyCanvasPutOperationId(input: Readonly<{
  canvasId: string;
  ownerId: string;
  saveAttemptId: string;
  saveSequence: number;
  saveSessionId: string;
}>) {
  return `legacy-save:${lengthPrefixedSha256([
    input.ownerId,
    input.canvasId,
    input.saveSessionId,
    String(input.saveSequence),
    input.saveAttemptId,
  ])}`;
}

const legacySpecializedUserFields = new Set([
  "imageAssetOrigin",
  "imageToolOperation",
  "imageToolOperationId",
  "imageToolOutputBackground",
]);

function legacyUserNode(value: unknown) {
  const projected = recordValue(userOwnedCanvasNodeProjection(value));
  if (!projected) return value;
  const data = recordValue(projected.data);
  if (!data) return projected;
  const filtered = { ...data };
  for (const field of legacySpecializedUserFields) delete filtered[field];
  return { ...projected, data: filtered };
}

function legacyUserDocument(document: LegacyCanvasPutDocument) {
  return userOwnedCanvasDocumentProjection({
    edges: document.edges,
    nodes: document.nodes.map(legacyUserNode),
    viewport: document.viewport,
  });
}

function replaceOwnedFields(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  owned: (field: string) => boolean,
) {
  const next = { ...current };
  for (const field of Object.keys(next)) {
    if (owned(field) && !Object.prototype.hasOwnProperty.call(incoming, field)) {
      delete next[field];
    }
  }
  for (const [field, value] of Object.entries(incoming)) {
    if (owned(field)) next[field] = value;
  }
  return next;
}

function mergeLegacyNode(current: unknown, incoming: unknown) {
  const incomingNode = recordValue(incoming);
  if (!incomingNode) return incoming;
  const currentNode = recordValue(current);
  if (!currentNode) return incomingNode;
  const next = replaceOwnedFields(currentNode, incomingNode, (field) =>
    canvasNodeTopLevelFieldDescriptors[
      field as keyof typeof canvasNodeTopLevelFieldDescriptors
    ]?.owner === "durable-user"
  );
  const currentData = recordValue(currentNode.data) ?? {};
  const incomingData = recordValue(incomingNode.data) ?? {};
  const nextData = replaceOwnedFields(currentData, incomingData, (field) =>
    canvasNodeDataFieldDescriptor(field)?.owner === "durable-user"
  );
  const topLevelInputChanged = [...new Set([
    ...Object.keys(currentNode),
    ...Object.keys(next),
  ])].some((field) =>
    canvasNodeTopLevelFieldDescriptors[
      field as keyof typeof canvasNodeTopLevelFieldDescriptors
    ]?.input === true &&
    stableSha256(currentNode[field]) !== stableSha256(next[field])
  );
  const dataInputChanged = [...new Set([
    ...Object.keys(currentData),
    ...Object.keys(nextData),
  ])].some((field) =>
    canvasNodeDataFieldDescriptor(field)?.input === true &&
    stableSha256(currentData[field]) !== stableSha256(nextData[field])
  );
  if (topLevelInputChanged || dataInputChanged) {
    for (const kind of new Set([
      String(currentNode.type ?? ""),
      String(next.type ?? ""),
    ])) invalidateGenerationProof(nextData, kind);
  }
  next.data = nextData;
  return next;
}

function mergeLegacyEdge(current: unknown, incoming: unknown) {
  const incomingEdge = recordValue(userOwnedCanvasEdgeProjection(incoming));
  if (!incomingEdge) return incoming;
  const currentEdge = recordValue(current);
  if (!currentEdge) return incomingEdge;
  const next = replaceOwnedFields(currentEdge, incomingEdge, (field) =>
    canvasEdgeTopLevelFieldDescriptors[
      field as keyof typeof canvasEdgeTopLevelFieldDescriptors
    ]?.owner === "durable-user"
  );
  const currentData = recordValue(currentEdge.data) ?? {};
  const incomingData = recordValue(incomingEdge.data) ?? {};
  next.data = replaceOwnedFields(currentData, incomingData, (field) =>
    canvasEdgeDataFieldDescriptors[
      field as keyof typeof canvasEdgeDataFieldDescriptors
    ]?.owner === "durable-user"
  );
  if (Object.keys(recordValue(next.data) ?? {}).length === 0 &&
      incomingEdge.data === undefined && currentEdge.data === undefined) {
    delete next.data;
  }
  return next;
}

function invalidateLegacyNodeProof(current: unknown, candidate: unknown) {
  const currentNode = recordValue(current);
  const candidateNode = recordValue(candidate);
  const candidateData = recordValue(candidateNode?.data);
  if (!candidateNode || !candidateData) return;
  for (const kind of new Set([
    String(currentNode?.type ?? ""),
    String(candidateNode.type ?? ""),
  ])) invalidateGenerationProof(candidateData, kind);
}

function legacyEdgeInputFingerprint(edge: unknown) {
  return canvasInputGraphFingerprint({
    edges: edge === undefined ? [] : [edge],
    nodes: [],
  });
}

function invalidateLegacyTopologyProof(
  before: MutableCanvasDocument | undefined,
  candidate: MutableCanvasDocument,
) {
  if (!before) return;
  const currentNodes = new Map(before.nodes.flatMap((value) => {
    const node = recordValue(value);
    return typeof node?.id === "string" ? [[node.id, value] as const] : [];
  }));
  const candidateNodes = new Map(candidate.nodes.flatMap((value) => {
    const node = recordValue(value);
    return typeof node?.id === "string" ? [[node.id, value] as const] : [];
  }));
  const currentEdges = new Map(before.edges.flatMap((value) => {
    const edge = recordValue(value);
    return typeof edge?.id === "string" ? [[edge.id, value] as const] : [];
  }));
  const candidateEdges = new Map(candidate.edges.flatMap((value) => {
    const edge = recordValue(value);
    return typeof edge?.id === "string" ? [[edge.id, value] as const] : [];
  }));
  const affectedTargets = new Set<string>();
  for (const edgeId of new Set([...currentEdges.keys(), ...candidateEdges.keys()])) {
    const currentEdge = currentEdges.get(edgeId);
    const candidateEdge = candidateEdges.get(edgeId);
    if (legacyEdgeInputFingerprint(currentEdge) ===
        legacyEdgeInputFingerprint(candidateEdge)) continue;
    const currentTarget = String(recordValue(currentEdge)?.target ?? "");
    const candidateTarget = String(recordValue(candidateEdge)?.target ?? "");
    if (currentTarget) affectedTargets.add(currentTarget);
    if (candidateTarget) affectedTargets.add(candidateTarget);
  }
  for (const nodeId of affectedTargets) {
    const candidateNode = candidateNodes.get(nodeId);
    if (candidateNode) invalidateLegacyNodeProof(currentNodes.get(nodeId), candidateNode);
  }
}

function lockedLegacyProjection(
  document: MutableCanvasDocument,
  lockedNodeIds: readonly string[],
) {
  const locked = new Set(lockedNodeIds);
  return {
    edges: durableCanvasEdges(document.edges.filter((value) => {
      const edge = recordValue(value);
      return locked.has(String(edge?.source ?? "")) ||
        locked.has(String(edge?.target ?? ""));
    })),
    nodes: durableCanvasNodes(document.nodes.filter((value) =>
      locked.has(String(recordValue(value)?.id ?? ""))
    )),
  };
}

function legacyAssetIntents(document: LegacyCanvasPutDocument) {
  return document.nodes.flatMap((value) => {
    const node = recordValue(value);
    const data = recordValue(node?.data);
    const kind = String(node?.type ?? "");
    return node && data && ["audio", "image", "video"].includes(kind) &&
        typeof data.assetId === "string" && data.assetId
      ? [{ assetId: data.assetId, kind, nodeId: String(node.id ?? "") }]
      : [];
  }).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

export type UncapableLegacyCanvasPutCandidateResult =
  | Readonly<{
      document: MutableCanvasDocument;
      status: "ready";
    }>
  | Readonly<{
      code:
        | "CANVAS_LEGACY_RECONCILE_REQUIRED"
        | "CANVAS_MEDIA_UNAVAILABLE"
        | "CANVAS_TOPOLOGY_CONFLICT";
      status: "rejected";
    }>;

function validateUncapableLegacyTopology(document: MutableCanvasDocument) {
  try {
    validateCanvasDocumentTopology(document);
    return true;
  } catch (error) {
    if (!(error instanceof CanvasCommandApplicationError)) throw error;
  }

  // One release window retains the historical test/old-client shape whose
  // placeholder nodes only carried an id. Ownership projection has already
  // removed unknown/server fields; substitute only the missing schema shell
  // while validating identity, parent, edge, cycle and capacity invariants.
  const compatibilityNodes = document.nodes.map((value) => {
    const node = recordValue(value);
    if (!node || typeof node.id !== "string" || !node.id || node.id.length > 200) {
      return value;
    }
    if (typeof node.type === "string") return value;
    if (node.data !== undefined && !recordValue(node.data)) return value;
    return {
      ...(typeof node.parentId === "string" ? { parentId: node.parentId } : {}),
      data: {},
      id: node.id,
      type: "probe",
    };
  });
  try {
    validateCanvasDocumentTopology({ ...document, nodes: compatibilityNodes });
    return true;
  } catch (error) {
    if (!(error instanceof CanvasCommandApplicationError)) throw error;
    return false;
  }
}

/**
 * Time-bounded no-capability adapter. It deliberately preserves the old wire
 * response/revision behavior, but never lets that compatibility path replace
 * server-owned fields or bypass topology/media validation.
 */
export function prepareUncapableLegacyCanvasPutCandidate(input: Readonly<{
  currentDocument?: MutableCanvasDocument;
  database: DatabaseSync;
  document: Pick<LegacyCanvasPutDocument, "edges" | "nodes" | "viewport">;
  ownerId: string;
}>): UncapableLegacyCanvasPutCandidateResult {
  assertTransaction(input.database);
  const userDocument = legacyUserDocument({
    ...input.document,
    observedLoadToken: "legacy-uncapable",
    observedRevision: 0,
    saveAttemptId: "legacy-uncapable",
    saveSequence: 1,
    saveSessionId: "legacy-uncapable",
  });
  const before = input.currentDocument;
  const currentNodes = new Map((before?.nodes ?? []).flatMap((value) => {
    const node = recordValue(value);
    return typeof node?.id === "string" ? [[node.id, value] as const] : [];
  }));
  const currentEdges = new Map((before?.edges ?? []).flatMap((value) => {
    const edge = recordValue(value);
    return typeof edge?.id === "string" ? [[edge.id, value] as const] : [];
  }));
  const incomingRawNodes = new Map(input.document.nodes.flatMap((value) => {
    const node = recordValue(value);
    return typeof node?.id === "string" ? [[node.id, node] as const] : [];
  }));
  const candidate: MutableCanvasDocument = {
    edges: userDocument.edges.map((value) => {
      const id = String(recordValue(value)?.id ?? "");
      return mergeLegacyEdge(currentEdges.get(id), value);
    }),
    nodes: userDocument.nodes.map((value) => {
      const id = String(recordValue(value)?.id ?? "");
      return mergeLegacyNode(currentNodes.get(id), value);
    }),
    viewport: { ...userDocument.viewport },
  };
  invalidateLegacyTopologyProof(before, candidate);

  for (const [nodeId, rawNode] of incomingRawNodes) {
    const kind = String(rawNode.type ?? "");
    if (!["audio", "image", "video"].includes(kind)) continue;
    const rawData = recordValue(rawNode.data);
    const incomingAssetId = typeof rawData?.assetId === "string"
      ? rawData.assetId
      : undefined;
    if (!incomingAssetId) continue;
    const currentData = recordValue(recordValue(currentNodes.get(nodeId))?.data);
    if (currentData?.assetId === incomingAssetId) continue;
    const asset = authoritativeAsset(
      input.database,
      input.ownerId,
      kind as "audio" | "image" | "video",
      incomingAssetId,
    );
    if (!asset) return { code: "CANVAS_MEDIA_UNAVAILABLE", status: "rejected" };
    const candidateNode = candidate.nodes.map(recordValue).find((value) =>
      value?.id === nodeId
    );
    const candidateData = recordValue(candidateNode?.data);
    if (!candidateNode || !candidateData) {
      return { code: "CANVAS_LEGACY_RECONCILE_REQUIRED", status: "rejected" };
    }
    invalidateLegacyNodeProof(currentNodes.get(nodeId), candidateNode);
    Object.assign(
      candidateData,
      authoritativeCanvasAssetPatch(
        kind as "audio" | "image" | "video",
        asset,
      ),
    );
    if (kind === "image") candidateData.imageAssetOrigin = "local-upload";
  }
  if (!validateUncapableLegacyTopology(candidate)) {
    return { code: "CANVAS_TOPOLOGY_CONFLICT", status: "rejected" };
  }
  return { document: candidate, status: "ready" };
}

function applyLegacyCanvasPutCore(input: Readonly<{
  canvasId: string;
  database: DatabaseSync;
  document: LegacyCanvasPutDocument;
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  ownerId: string;
  requestId: string;
  validLoadToken: (
    token: string,
    ownerId: string,
    canvasId: string,
    revision: number,
  ) => boolean;
}>): CanvasMutationGatewayResult | CanvasOperationReuseResult | Readonly<{
  code: "CANVAS_NOT_FOUND";
}> {
  assertTransaction(input.database);
  const operationId = legacyCanvasPutOperationId({
    canvasId: input.canvasId,
    ownerId: input.ownerId,
    saveAttemptId: input.document.saveAttemptId,
    saveSequence: input.document.saveSequence,
    saveSessionId: input.document.saveSessionId,
  });
  const userDocument = legacyUserDocument(input.document);
  const payloadSha256 = stableSha256(input.document.generationProjection
    ? {
        assetIntents: legacyAssetIntents(input.document),
        document: userDocument,
        generationProjectionIdentity: legacyGenerationProjectionIdentity(
          input.document.generationProjection,
        ),
        observedRevision: input.document.observedRevision,
        saveAttemptId: input.document.saveAttemptId,
        saveSequence: input.document.saveSequence,
        saveSessionId: input.document.saveSessionId,
      }
    : {
        assetIntents: legacyAssetIntents(input.document),
        document: userDocument,
        observedRevision: input.document.observedRevision,
        saveAttemptId: input.document.saveAttemptId,
        saveSequence: input.document.saveSequence,
        saveSessionId: input.document.saveSessionId,
      });
  const existing = receipt(
    input.database,
    input.ownerId,
    input.canvasId,
    operationId,
  );
  const current = canvasRow(input.database, input.ownerId, input.canvasId);
  if (existing) {
    if (!current) throw new CanvasMutationGatewayUnavailableError(
      "Legacy receipt exists without its authoritative Canvas",
    );
    if (existing.payload_sha256 !== payloadSha256) {
      recordOperationReuseAudit(
        input.database,
        input.ownerId,
        input.canvasId,
        operationId,
        input.requestId,
        existing.payload_sha256,
        payloadSha256,
      );
      return Object.freeze({
        authoritativeDocument: authoritativeDocument(current),
        code: "CANVAS_OPERATION_REUSED" as const,
        operationDocumentRevision: Number(existing.result_document_revision),
        operationId,
        operationInputGraphRevision: Number(existing.result_input_revision),
        originalRequestId: existing.original_request_id,
        replayed: false as const,
      });
    }
    return receiptResult(existing, current, true);
  }

  const projectScope = executeTransactionScopedCommand(
    input.database,
    readCanvasProjectScopeCommand,
    { canvasId: input.canvasId, ownerId: input.ownerId },
  );
  if (projectScope.otherOwner || !current) {
    return Object.freeze({ code: "CANVAS_NOT_FOUND" as const });
  }
  assertReceiptCapacity(input.database, input.ownerId, input.canvasId);

  const before = documentFromRow(current);
  const settle = (
    conflictCode: CanvasGatewayConflictCode | null,
    outcome: "APPLIED" | "NO_OP" | "REJECTED_CONFLICT",
    document: MutableCanvasDocument,
    documentRevision: number,
    inputRevision: number,
    changedPaths: readonly string[],
  ) => {
    insertInternalReceipt(input.database, {
      actorType: "legacy",
      affectedSubgraphSha256: stableSha256(input.document.generationProjection
        ? {
            edges: userDocument.edges.map((value) =>
              String(recordValue(value)?.id ?? "")
            ),
            nodes: userDocument.nodes.map((value) =>
              String(recordValue(value)?.id ?? "")
            ),
            projectionNodeId: input.document.generationProjection.nodeId,
          }
        : {
            edges: userDocument.edges.map((value) =>
              String(recordValue(value)?.id ?? "")
            ),
            nodes: userDocument.nodes.map((value) =>
              String(recordValue(value)?.id ?? "")
            ),
          }),
      baselineDocumentRevision: input.document.observedRevision,
      baselineEpoch: input.loadTokenEpoch,
      baselineInputRevision: current.graph_revision,
      baselineLoadToken: input.document.observedLoadToken,
      canvasId: input.canvasId,
      changedPaths,
      commandType: "legacy.put",
      conflictCode,
      documentRevision,
      documentSha256: canvasDocumentFingerprint(document),
      inputRevision,
      inputSha256: canvasInputGraphFingerprint(document),
      operationId,
      outcome,
      ownerId: input.ownerId,
      payloadSha256,
      requestId: input.requestId,
      saveSequence: input.document.saveSequence,
      saveSessionId: input.document.saveSessionId,
    });
    const settled = canvasRow(input.database, input.ownerId, input.canvasId);
    if (!settled) throw new CanvasMutationGatewayUnavailableError();
    return internalReceiptResult(
      input.database,
      input.ownerId,
      input.canvasId,
      operationId,
      settled,
      false,
    );
  };

  if (projectScope.tombstoned) {
    return settle(
      "CANVAS_PROJECT_DELETED",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  if (
    input.document.observedRevision > current.revision ||
    !input.validLoadToken(
      input.document.observedLoadToken,
      input.ownerId,
      input.canvasId,
      input.document.observedRevision,
    )
  ) {
    return settle(
      "CANVAS_LOAD_REQUIRED",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  if (input.document.saveSequence <= currentSessionHighWater(
    input.database,
    input.ownerId,
    input.canvasId,
    input.document.saveSessionId,
    current,
  )) {
    return settle(
      "CANVAS_SAVE_SUPERSEDED",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  if (!isValidInitialUserOwnedCanvasDocument(userDocument)) {
    return settle(
      "CANVAS_LEGACY_RECONCILE_REQUIRED",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }

  const currentNodes = new Map(before.nodes.flatMap((value) => {
    const node = recordValue(value);
    return typeof node?.id === "string" ? [[node.id, value] as const] : [];
  }));
  const currentEdges = new Map(before.edges.flatMap((value) => {
    const edge = recordValue(value);
    return typeof edge?.id === "string" ? [[edge.id, value] as const] : [];
  }));
  const incomingRawNodes = new Map(input.document.nodes.flatMap((value) => {
    const node = recordValue(value);
    return typeof node?.id === "string" ? [[node.id, node] as const] : [];
  }));
  const candidate: MutableCanvasDocument = {
    edges: userDocument.edges.map((value) => {
      const id = String(recordValue(value)?.id ?? "");
      return mergeLegacyEdge(currentEdges.get(id), value);
    }),
    nodes: userDocument.nodes.map((value) => {
      const id = String(recordValue(value)?.id ?? "");
      return mergeLegacyNode(currentNodes.get(id), value);
    }),
    viewport: { ...userDocument.viewport },
  };
  invalidateLegacyTopologyProof(before, candidate);

  for (const [nodeId, rawNode] of incomingRawNodes) {
    const kind = String(rawNode.type ?? "");
    if (!["audio", "image", "video"].includes(kind)) continue;
    const rawData = recordValue(rawNode.data);
    const incomingAssetId = typeof rawData?.assetId === "string"
      ? rawData.assetId
      : undefined;
    if (!incomingAssetId) continue;
    const currentData = recordValue(recordValue(currentNodes.get(nodeId))?.data);
    if (currentData?.assetId === incomingAssetId) continue;
    const asset = authoritativeAsset(
      input.database,
      input.ownerId,
      kind as "audio" | "image" | "video",
      incomingAssetId,
    );
    if (!asset) {
      return settle(
        "CANVAS_MEDIA_UNAVAILABLE",
        "REJECTED_CONFLICT",
        before,
        current.revision,
        current.graph_revision,
        [],
      );
    }
    const candidateNode = candidate.nodes.map(recordValue).find((value) =>
      value?.id === nodeId
    );
    const candidateData = recordValue(candidateNode?.data);
    if (!candidateNode || !candidateData) {
      return settle(
        "CANVAS_LEGACY_RECONCILE_REQUIRED",
        "REJECTED_CONFLICT",
        before,
        current.revision,
        current.graph_revision,
        [],
      );
    }
    invalidateLegacyNodeProof(currentNodes.get(nodeId), candidateNode);
    Object.assign(
      candidateData,
      authoritativeCanvasAssetPatch(
        kind as "audio" | "image" | "video",
        asset,
      ),
    );
    if (kind === "image") candidateData.imageAssetOrigin = "local-upload";
  }

  try {
    validateCanvasDocumentTopology(candidate);
  } catch (error) {
    if (!(error instanceof CanvasCommandApplicationError)) throw error;
    return settle(
      "CANVAS_TOPOLOGY_CONFLICT",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }
  const lockedNodeIds = workflowRunLockedNodeIdsInTransaction({
    canvasId: input.canvasId,
    database: input.database,
    ownerId: input.ownerId,
  });
  if (stableSha256(lockedLegacyProjection(before, lockedNodeIds)) !==
      stableSha256(lockedLegacyProjection(candidate, lockedNodeIds))) {
    return settle(
      "WORKFLOW_GRAPH_LOCKED",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }

  input.database.exec("SAVEPOINT legacy_canvas_media_adoption");
  const rollbackLegacyMediaAdoption = () => {
    input.database.exec("ROLLBACK TO SAVEPOINT legacy_canvas_media_adoption");
    input.database.exec("RELEASE SAVEPOINT legacy_canvas_media_adoption");
  };
  const commitLegacyMediaAdoption = () => {
    input.database.exec("RELEASE SAVEPOINT legacy_canvas_media_adoption");
  };
  try {
    adoptUploadedMediaReferences(input.database, {
      canvasId: input.canvasId,
      ownerId: input.ownerId,
      references: candidate.nodes.flatMap((value) => {
        const node = recordValue(value);
        const data = recordValue(node?.data);
        const kind = String(node?.type ?? "");
        return data && ["audio", "image", "video"].includes(kind) &&
            typeof data.assetId === "string"
          ? [{ assetId: data.assetId, kind: kind as "audio" | "image" | "video" }]
          : [];
      }),
    });
  } catch (error) {
    if (!(error instanceof MediaPublicationConflictError)) throw error;
    rollbackLegacyMediaAdoption();
    return settle(
      "CANVAS_MEDIA_UNAVAILABLE",
      "REJECTED_CONFLICT",
      before,
      current.revision,
      current.graph_revision,
      [],
    );
  }

  if (input.document.generationProjection) {
    if (canvasInputGraphFingerprint(candidate) !==
        canvasInputGraphFingerprint(before)) {
      rollbackLegacyMediaAdoption();
      return settle(
        "CANVAS_LEGACY_RECONCILE_REQUIRED",
        "REJECTED_CONFLICT",
        before,
        current.revision,
        current.graph_revision,
        [],
      );
    }
    const observabilitySavepoint = canvasObservabilitySavepoint(input.database);
    input.database.exec("SAVEPOINT legacy_canvas_generation_projection");
    const projectionResult = applyLegacyGenerationProjectionInTransaction({
      baseDocument: candidate,
      canvasId: input.canvasId,
      database: input.database,
      loadTokenEpoch: input.loadTokenEpoch,
      loadTokenForRevision: input.loadTokenForRevision,
      ownerId: input.ownerId,
      projection: input.document.generationProjection,
      requestId: input.requestId,
    });
    if (projectionResult !== "applied") {
      input.database.exec(
        "ROLLBACK TO SAVEPOINT legacy_canvas_generation_projection",
      );
      input.database.exec("RELEASE SAVEPOINT legacy_canvas_generation_projection");
      rollbackDeferredCanvasObservabilityTo(
        input.database,
        observabilitySavepoint,
      );
      rollbackLegacyMediaAdoption();
      return settle(
        "CANVAS_LEGACY_RECONCILE_REQUIRED",
        "REJECTED_CONFLICT",
        before,
        current.revision,
        current.graph_revision,
        [],
      );
    }
    input.database.exec("RELEASE SAVEPOINT legacy_canvas_generation_projection");
    const projectedRow = canvasRow(input.database, input.ownerId, input.canvasId);
    if (!projectedRow) throw new CanvasMutationGatewayUnavailableError();
    const projectedDocument = documentFromRow(projectedRow);
    const changed = canvasDocumentFingerprint(projectedDocument) !==
      canvasDocumentFingerprint(before);
    const userChanged = canvasDocumentFingerprint(candidate) !==
      canvasDocumentFingerprint(before);
    commitLegacyMediaAdoption();
    return settle(
      null,
      changed ? "APPLIED" : "NO_OP",
      projectedDocument,
      projectedRow.revision,
      projectedRow.graph_revision,
      changed
        ? [
            ...(userChanged ? ["legacy.user-document"] : []),
            `nodes.${input.document.generationProjection.nodeId}.server-projection`,
          ]
        : [],
    );
  }

  const beforeDocumentSha256 = canvasDocumentFingerprint(before);
  const beforeInputSha256 = canvasInputGraphFingerprint(before);
  const afterDocumentSha256 = canvasDocumentFingerprint(candidate);
  const afterInputSha256 = canvasInputGraphFingerprint(candidate);
  const transition = canvasRevisionTransition({
    afterDocumentSha256,
    afterInputSha256,
    beforeDocumentSha256,
    beforeInputSha256,
    documentRevision: current.revision,
    inputGraphRevision: current.graph_revision,
  });
  if (transition.changed) {
    const updated = input.database.prepare(`
      UPDATE canvas_documents
      SET revision = ?, graph_revision = ?, nodes = ?, edges = ?, viewport = ?,
          updated_at = ?, save_session_id = ?, save_sequence = ?
      WHERE owner_id = ? AND id = ? AND revision = ?
    `).run(
      transition.documentRevision,
      transition.inputGraphRevision,
      JSON.stringify(candidate.nodes),
      JSON.stringify(candidate.edges),
      JSON.stringify(candidate.viewport),
      new Date().toISOString(),
      input.document.saveSessionId,
      input.document.saveSequence,
      input.ownerId,
      input.canvasId,
      current.revision,
    );
    if (updated.changes !== 1) {
      throw new CanvasMutationGatewayUnavailableError(
        "Legacy Canvas adapter lost its writer fence",
      );
    }
    executeTransactionScopedCommand(input.database, touchProjectUpdatedAtCommand, {
      bypass: false,
      canvasId: input.canvasId,
      ownerId: input.ownerId,
      updatedAt: Date.now(),
    });
  }
  commitLegacyMediaAdoption();

  return settle(
    null,
    transition.changed ? "APPLIED" : "NO_OP",
    candidate,
    transition.documentRevision,
    transition.inputGraphRevision,
    transition.changed ? ["legacy.user-document"] : [],
  );
}

export function applyLegacyCanvasPutInTransaction(input: Readonly<{
  canvasId: string;
  database: DatabaseSync;
  document: LegacyCanvasPutDocument;
  loadTokenEpoch: string;
  loadTokenForRevision: (revision: number) => string;
  ownerId: string;
  requestId: string;
  validLoadToken: (
    token: string,
    ownerId: string,
    canvasId: string,
    revision: number,
  ) => boolean;
}>): CanvasMutationGatewayResult | CanvasOperationReuseResult | Readonly<{
  code: "CANVAS_NOT_FOUND";
}> {
  const before = canvasRow(input.database, input.ownerId, input.canvasId);
  const result = applyLegacyCanvasPutCore(input);
  if (!("code" in result && result.code === "CANVAS_NOT_FOUND")) {
    deferGatewayCommand({
      actor: "legacy",
      affectedNodeHash: "affectedSubgraphSha256" in result &&
          result.affectedSubgraphSha256
        ? result.affectedSubgraphSha256
        : stableSha256({
            edgeIds: input.document.edges.map((value) =>
              String((value as { id?: unknown })?.id ?? "")
            ).sort(),
            nodeIds: input.document.nodes.map((value) =>
              String((value as { id?: unknown })?.id ?? "")
            ).sort(),
          }),
      before,
      commandKind: "legacy.put",
      database: input.database,
      outcome: legacyPutOutcome(result),
      requestId: input.requestId,
      result,
    });
  }
  return result;
}

function settleConflict(
  database: DatabaseSync,
  input: Readonly<{
    code: CanvasGatewayConflictCode;
    command: CanvasUserCommand;
    current: CanvasRow;
    loadTokenEpoch: string;
    ownerId: string;
    canvasId: string;
    payloadSha256: string;
    requestId: string;
  }>,
) {
  const document = documentFromRow(input.current);
  const documentSha256 = canvasDocumentFingerprint(document);
  const inputSha256 = canvasInputGraphFingerprint(document);
  insertReceipt(database, {
    affectedSubgraphSha256:
      input.command.kind === "apply-topology"
        ? input.command.affectedTopologyDigest
        : null,
    canvasId: input.canvasId,
    changedPaths: [],
    command: input.command,
    conflictCode: input.code,
    documentRevision: input.current.revision,
    documentSha256,
    inputRevision: input.current.graph_revision,
    inputSha256,
    loadTokenEpoch: input.loadTokenEpoch,
    outcome: "REJECTED_CONFLICT",
    ownerId: input.ownerId,
    payloadSha256: input.payloadSha256,
    requestId: input.requestId,
  });
  const persisted = receipt(
    database,
    input.ownerId,
    input.canvasId,
    input.command.operationId,
  );
  if (!persisted) throw new CanvasMutationGatewayUnavailableError();
  return receiptResult(persisted, input.current, false);
}

function applyCanvasUserCommandCore(input: Readonly<{
  canvasId: string;
  command: CanvasUserCommand;
  database: DatabaseSync;
  loadTokenEpoch: string;
  ownerId: string;
  requestId: string;
  validLoadToken: (
    token: string,
    ownerId: string,
    canvasId: string,
    revision: number,
  ) => boolean;
}>): CanvasMutationGatewayResult | Readonly<{
  code: "CANVAS_NOT_FOUND";
}> | CanvasOperationReuseResult {
  const { canvasId, command, database, ownerId } = input;
  assertTransaction(database);
  const payloadSha256 = canvasCommandPayloadSha256(command);
  const existingReceipt = receipt(database, ownerId, canvasId, command.operationId);
  const initialRow = canvasRow(database, ownerId, canvasId);
  if (existingReceipt) {
    if (existingReceipt.payload_sha256 !== payloadSha256) {
      if (!initialRow) throw new CanvasMutationGatewayUnavailableError(
        "Canvas receipt exists without its authoritative document",
      );
      recordOperationReuseAudit(
        database,
        ownerId,
        canvasId,
        command.operationId,
        input.requestId,
        existingReceipt.payload_sha256,
        payloadSha256,
      );
      return Object.freeze({
        authoritativeDocument: authoritativeDocument(initialRow),
        code: "CANVAS_OPERATION_REUSED" as const,
        operationDocumentRevision: Number(
          existingReceipt.result_document_revision,
        ),
        operationId: existingReceipt.operation_id,
        operationInputGraphRevision: Number(
          existingReceipt.result_input_revision,
        ),
        originalRequestId: existingReceipt.original_request_id,
        replayed: false as const,
      });
    }
    if (!initialRow) throw new CanvasMutationGatewayUnavailableError(
      "Canvas receipt exists without its authoritative document",
    );
    return receiptResult(existingReceipt, initialRow, true);
  }

  const projectScope = executeTransactionScopedCommand(
    database,
    readCanvasProjectScopeCommand,
    { canvasId, ownerId },
  );
  if (projectScope.tombstoned) {
    if (!initialRow) return Object.freeze({ code: "CANVAS_NOT_FOUND" as const });
    assertReceiptCapacity(database, ownerId, canvasId);
    return settleConflict(database, {
      canvasId,
      code: "CANVAS_PROJECT_DELETED",
      command,
      current: initialRow,
      loadTokenEpoch: input.loadTokenEpoch,
      ownerId,
      payloadSha256,
      requestId: input.requestId,
    });
  }
  if (projectScope.otherOwner) {
    return Object.freeze({ code: "CANVAS_NOT_FOUND" as const });
  }
  assertReceiptCapacity(database, ownerId, canvasId);

  if (command.kind === "create-canvas-document") {
    if (initialRow) {
      return settleConflict(database, {
        canvasId,
        code: "CANVAS_ALREADY_EXISTS",
        command,
        current: initialRow,
        loadTokenEpoch: input.loadTokenEpoch,
        ownerId,
        payloadSha256,
        requestId: input.requestId,
      });
    }
    const candidate = createInitialCanvasDocument(command);
    const persisted = candidate;
    const documentSha256 = canvasDocumentFingerprint(persisted);
    const inputSha256 = canvasInputGraphFingerprint(persisted);
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      ownerId,
      canvasId,
      JSON.stringify(persisted.nodes),
      JSON.stringify(persisted.edges),
      JSON.stringify(persisted.viewport),
      now,
      command.saveSessionId,
      command.saveSequence,
    );
    executeTransactionScopedCommand(database, touchProjectUpdatedAtCommand, {
      bypass: false,
      canvasId,
      ownerId,
      updatedAt: Date.now(),
    });
    insertReceipt(database, {
      affectedSubgraphSha256: stableSha256({
        edges: persisted.edges.map((edge) => String((edge as { id?: unknown }).id ?? "")),
        nodes: persisted.nodes.map((node) => String((node as { id?: unknown }).id ?? "")),
      }),
      canvasId,
      changedPaths: ["document.create"],
      command,
      conflictCode: null,
      documentRevision: 1,
      documentSha256,
      inputRevision: 1,
      inputSha256,
      loadTokenEpoch: input.loadTokenEpoch,
      outcome: "APPLIED",
      ownerId,
      payloadSha256,
      requestId: input.requestId,
    });
    const created = canvasRow(database, ownerId, canvasId);
    const createdReceipt = receipt(database, ownerId, canvasId, command.operationId);
    if (!created || !createdReceipt) throw new CanvasMutationGatewayUnavailableError();
    return receiptResult(createdReceipt, created, false);
  }

  if (!initialRow) return Object.freeze({ code: "CANVAS_NOT_FOUND" as const });
  const validBaseline =
    command.baseDocumentRevision <= initialRow.revision &&
    command.baseInputGraphRevision <= initialRow.graph_revision &&
    input.validLoadToken(
      command.observedLoadToken,
      ownerId,
      canvasId,
      command.baseDocumentRevision,
    );
  if (!validBaseline) {
    return settleConflict(database, {
      canvasId,
      code: "CANVAS_LOAD_REQUIRED",
      command,
      current: initialRow,
      loadTokenEpoch: input.loadTokenEpoch,
      ownerId,
      payloadSha256,
      requestId: input.requestId,
    });
  }
  if (command.saveSequence <= currentSessionHighWater(
    database,
    ownerId,
    canvasId,
    command.saveSessionId,
    initialRow,
  )) {
    return settleConflict(database, {
      canvasId,
      code: "CANVAS_SAVE_SUPERSEDED",
      command,
      current: initialRow,
      loadTokenEpoch: input.loadTokenEpoch,
      ownerId,
      payloadSha256,
      requestId: input.requestId,
    });
  }

  const before = documentFromRow(initialRow);
  let asset: AuthoritativeCanvasAsset | undefined;
  const authoritativeMediaAssets = new Map<string, AuthoritativeCanvasAsset>();
  if (command.kind === "adopt-uploaded-asset") {
    asset = authoritativeAsset(
      database,
      ownerId,
      command.mediaKind,
      command.asset.assetId,
    );
    if (!asset) {
      return settleConflict(database, {
        canvasId,
        code: "CANVAS_MEDIA_UNAVAILABLE",
        command,
        current: initialRow,
        loadTokenEpoch: input.loadTokenEpoch,
        ownerId,
        payloadSha256,
        requestId: input.requestId,
      });
    }
  } else if (command.kind === "edit-result-and-invalidate-proof") {
    const node = before.nodes.find((value) =>
      (value as { id?: unknown })?.id === command.nodeId
    ) as { data?: unknown; type?: unknown } | undefined;
    const sourceAssetPresent = before.nodes.some((value) => {
      const source = value && typeof value === "object" && !Array.isArray(value)
        ? value as { data?: unknown; type?: unknown }
        : undefined;
      const sourceData = source?.data && typeof source.data === "object" &&
          !Array.isArray(source.data)
        ? source.data as Record<string, unknown>
        : undefined;
      return source?.type === "image" &&
        sourceData?.assetId === command.sourceAssetId;
    });
    if (node?.type !== "image" || !sourceAssetPresent) {
      return settleConflict(database, {
        canvasId,
        code: "CANVAS_SERVER_OWNERSHIP_CONFLICT",
        command,
        current: initialRow,
        loadTokenEpoch: input.loadTokenEpoch,
        ownerId,
        payloadSha256,
        requestId: input.requestId,
      });
    }
    const sourceAsset = authoritativeAsset(
      database,
      ownerId,
      "image",
      command.sourceAssetId,
    );
    asset = authoritativeAsset(
      database,
      ownerId,
      "image",
      command.asset.assetId,
    );
    if (!sourceAsset || !asset) {
      return settleConflict(database, {
        canvasId,
        code: "CANVAS_MEDIA_UNAVAILABLE",
        command,
        current: initialRow,
        loadTokenEpoch: input.loadTokenEpoch,
        ownerId,
        payloadSha256,
        requestId: input.requestId,
      });
    }
  } else if (command.kind === "apply-topology") {
    for (const adoption of command.mediaAdoptions ?? []) {
      if (adoption.kind === "edit-result-and-invalidate-proof") {
        const sourceAssetPresent = before.nodes.some((value) => {
          const source = value && typeof value === "object" && !Array.isArray(value)
            ? value as { data?: unknown; type?: unknown }
            : undefined;
          const sourceData = source?.data && typeof source.data === "object" &&
              !Array.isArray(source.data)
            ? source.data as Record<string, unknown>
            : undefined;
          return source?.type === "image" &&
            sourceData?.assetId === adoption.sourceAssetId;
        });
        if (!sourceAssetPresent || !authoritativeAsset(
          database,
          ownerId,
          "image",
          adoption.sourceAssetId,
        )) {
          return settleConflict(database, {
            canvasId,
            code: sourceAssetPresent
              ? "CANVAS_MEDIA_UNAVAILABLE"
              : "CANVAS_SERVER_OWNERSHIP_CONFLICT",
            command,
            current: initialRow,
            loadTokenEpoch: input.loadTokenEpoch,
            ownerId,
            payloadSha256,
            requestId: input.requestId,
          });
        }
      }
      const mediaKind = adoption.kind === "adopt-uploaded-asset"
        ? adoption.mediaKind
        : "image";
      const authoritative = authoritativeAsset(
        database,
        ownerId,
        mediaKind,
        adoption.asset.assetId,
      );
      if (!authoritative) {
        return settleConflict(database, {
          canvasId,
          code: "CANVAS_MEDIA_UNAVAILABLE",
          command,
          current: initialRow,
          loadTokenEpoch: input.loadTokenEpoch,
          ownerId,
          payloadSha256,
          requestId: input.requestId,
        });
      }
      authoritativeMediaAssets.set(adoption.nodeId, authoritative);
    }
  }

  let application;
  try {
    application = applyCanvasUserCommand({
      authoritativeAsset: asset,
      authoritativeMediaAssets,
      command,
      currentDocument: before,
      lockedNodeIds: workflowRunLockedNodeIdsInTransaction({
        canvasId,
        database,
        ownerId,
      }),
    });
  } catch (error) {
    if (!(error instanceof CanvasCommandApplicationError)) throw error;
    return settleConflict(database, {
      canvasId,
      code: error.code,
      command,
      current: initialRow,
      loadTokenEpoch: input.loadTokenEpoch,
      ownerId,
      payloadSha256,
      requestId: input.requestId,
    });
  }
  const persisted = application.document;
  const beforeDocumentSha256 = canvasDocumentFingerprint(before);
  const beforeInputSha256 = canvasInputGraphFingerprint(before);
  const afterDocumentSha256 = canvasDocumentFingerprint(persisted);
  const afterInputSha256 = canvasInputGraphFingerprint(persisted);
  const transition = canvasRevisionTransition({
    afterDocumentSha256,
    afterInputSha256,
    beforeDocumentSha256,
    beforeInputSha256,
    documentRevision: initialRow.revision,
    inputGraphRevision: initialRow.graph_revision,
  });
  const mediaReferences = [
    ...(asset
      ? [{
          assetId: asset.assetId,
          kind: command.kind === "adopt-uploaded-asset"
            ? command.mediaKind
            : "image" as const,
        }]
      : []),
    ...(command.kind === "apply-topology"
      ? (command.mediaAdoptions ?? []).map((adoption) => ({
          assetId: adoption.asset.assetId,
          kind: adoption.kind === "adopt-uploaded-asset"
            ? adoption.mediaKind
            : "image" as const,
        }))
      : []),
  ];
  if (transition.changed && mediaReferences.length > 0) {
    database.exec("SAVEPOINT canvas_command_media_adoption");
    try {
      adoptUploadedMediaReferences(database, {
        canvasId,
        ownerId,
        references: mediaReferences,
      });
      database.exec("RELEASE SAVEPOINT canvas_command_media_adoption");
    } catch (error) {
      if (!(error instanceof MediaPublicationConflictError)) throw error;
      database.exec("ROLLBACK TO SAVEPOINT canvas_command_media_adoption");
      database.exec("RELEASE SAVEPOINT canvas_command_media_adoption");
      return settleConflict(database, {
        canvasId,
        code: "CANVAS_MEDIA_UNAVAILABLE",
        command,
        current: initialRow,
        loadTokenEpoch: input.loadTokenEpoch,
        ownerId,
        payloadSha256,
        requestId: input.requestId,
      });
    }
  }
  if (transition.changed) {
    const updated = database.prepare(`
      UPDATE canvas_documents
      SET revision = ?, graph_revision = ?, nodes = ?, edges = ?, viewport = ?,
          updated_at = ?, save_session_id = ?, save_sequence = ?
      WHERE owner_id = ? AND id = ? AND revision = ?
    `).run(
      transition.documentRevision,
      transition.inputGraphRevision,
      JSON.stringify(persisted.nodes),
      JSON.stringify(persisted.edges),
      JSON.stringify(persisted.viewport),
      new Date().toISOString(),
      command.saveSessionId,
      command.saveSequence,
      ownerId,
      canvasId,
      initialRow.revision,
    );
    if (updated.changes !== 1) {
      throw new CanvasMutationGatewayUnavailableError("Canvas transaction lost its writer fence");
    }
    executeTransactionScopedCommand(database, touchProjectUpdatedAtCommand, {
      bypass: false,
      canvasId,
      ownerId,
      updatedAt: Date.now(),
    });
  }
  insertReceipt(database, {
    affectedSubgraphSha256: application.affectedSubgraphSha256,
    canvasId,
    changedPaths: application.changedPaths,
    command,
    conflictCode: null,
    documentRevision: transition.documentRevision,
    documentSha256: afterDocumentSha256,
    inputRevision: transition.inputGraphRevision,
    inputSha256: afterInputSha256,
    loadTokenEpoch: input.loadTokenEpoch,
    outcome: transition.changed ? "APPLIED" : "NO_OP",
    ownerId,
    payloadSha256,
    requestId: input.requestId,
  });
  const current = canvasRow(database, ownerId, canvasId);
  const persistedReceipt = receipt(database, ownerId, canvasId, command.operationId);
  if (!current || !persistedReceipt) throw new CanvasMutationGatewayUnavailableError();
  return receiptResult(persistedReceipt, current, false);
}

export function applyCanvasUserCommandInTransaction(input: Readonly<{
  canvasId: string;
  command: CanvasUserCommand;
  database: DatabaseSync;
  loadTokenEpoch: string;
  ownerId: string;
  requestId: string;
  validLoadToken: (
    token: string,
    ownerId: string,
    canvasId: string,
    revision: number,
  ) => boolean;
}>): CanvasMutationGatewayResult | Readonly<{
  code: "CANVAS_NOT_FOUND";
}> | CanvasOperationReuseResult {
  const before = canvasRow(input.database, input.ownerId, input.canvasId);
  const result = applyCanvasUserCommandCore(input);
  if (!("code" in result && result.code === "CANVAS_NOT_FOUND")) {
    deferGatewayCommand({
      actor: "browser",
      affectedNodeHash: "affectedSubgraphSha256" in result &&
          result.affectedSubgraphSha256
        ? result.affectedSubgraphSha256
        : userCommandAffectedNodeHash(input.command),
      before,
      commandKind: input.command.kind,
      database: input.database,
      outcome: commandOutcome(result),
      requestId: input.requestId,
      result,
    });
  }
  return result;
}
