import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { requestIdentity } from "./auth";
import {
  normalizePersistedMediaNodes,
  persistedMediaReferences,
} from "../types/persistedMediaSources";
import { canvasGraphFingerprint } from "../types/canvasFingerprint";
import {
  adoptUploadedMediaReferences,
  MediaPublicationConflictError,
} from "./mediaPublicationService";
import {
  deleteProjectMetadataCommand,
  touchProjectUpdatedAtCommand,
  upsertProjectTitleCommand,
} from "./projectTransactionCommands";
import { deleteProjectCanvasDocumentsCommand } from
  "./canvasTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import { readCanvasRouteGenerationEvidenceCommand } from
  "./generationTransactionCommands";
import { persistedNodeSchemaRegistry } from "../types/persistedNodeSchemaRegistry";
import { legacyCanvasPutWriteContract } from "../types/canvasCommands";
import {
  applyLegacyGenerationProjectionInTransaction,
  applyLegacyCanvasPutInTransaction,
  prepareUncapableLegacyCanvasPutCandidate,
  CanvasMutationGatewayCapacityError,
  CanvasMutationGatewayUnavailableError,
  type CanvasMutationGatewayResult,
  type CanvasOperationReuseResult,
  type LegacyGenerationProjectionHint,
} from "./canvasMutationGateway";
import {
  hasActiveWorkflowRunForCanvas,
  workflowRunLockedNodeIdsInTransaction,
} from "./workflowRunLocks";
import {
  canvasClientBuildFromHeader,
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
  recordCanvasRouteEvent,
  type CanvasServerClass,
} from "./canvasObservability";

function inImmediateTransaction<T>(store: DatabaseSync, operation: () => T): T {
  const ownsTransaction = !store.isTransaction;
  if (ownsTransaction) store.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    if (ownsTransaction) store.exec("COMMIT");
    return result;
  } catch (error) {
    if (ownsTransaction && store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

type CanvasDocument = {
  edges: unknown[];
  generationProjection?: GenerationProjectionCommit;
  nodes: unknown[];
  observedLoadToken?: string;
  observedRevision?: number;
  revision: number;
  saveAttemptId?: string;
  saveSequence?: number;
  saveSessionId?: string;
  viewport: { x: number; y: number; zoom: number };
};

type GenerationProjectionCommit = LegacyGenerationProjectionHint;

type CanvasRow = {
  edges: string;
  graph_revision: number;
  nodes: string;
  owner_id: string | null;
  revision: number;
  save_sequence: number;
  save_session_id: string | null;
  viewport: string;
};

type CanvasPersistenceBarrierInput = {
  canvasId: string;
  ownerId: string;
  saveAttemptId?: string;
  saveSequence?: number;
  saveSessionId?: string;
};

type CanvasPersistenceBarrier = (
  input: CanvasPersistenceBarrierInput,
) => Promise<void> | void;
type CanvasPersistenceFault = (input: CanvasPersistenceBarrierInput) => void;

const canvasSaveSessionGlobalHighWaterLimit = 50_000;
const canvasSaveSessionOwnerHighWaterLimit = 5_000;
const canvasSaveSessionPattern = /^[a-z0-9-]{8,80}$/i;
const generationProjectionKinds = new Set(["audio", "image", "text", "video"]);
const generationProjectionValuePattern = /^[\w.:/-]{1,512}$/;
const generationProjectionInputFingerprintMaxLength = 100_000;

export function workflowLockedGraphChanged(input: {
  lockedNodeIds: readonly string[];
  previousEdges: unknown[];
  previousNodes: unknown[];
  nextEdges: unknown[];
  nextNodes: unknown[];
}) {
  const lockedIds = new Set(input.lockedNodeIds);
  if (lockedIds.size === 0) return false;
  const subgraph = (nodes: unknown[], edges: unknown[]) => ({
    edges: edges.filter((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const edge = value as Record<string, unknown>;
      return lockedIds.has(String(edge.source ?? "")) ||
        lockedIds.has(String(edge.target ?? ""));
    }).sort((left, right) => String((left as Record<string, unknown>).id ?? "")
      .localeCompare(String((right as Record<string, unknown>).id ?? ""))),
    nodes: nodes.filter((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      return lockedIds.has(String((value as Record<string, unknown>).id ?? ""));
    }).sort((left, right) => String((left as Record<string, unknown>).id ?? "")
      .localeCompare(String((right as Record<string, unknown>).id ?? ""))),
  });
  const previous = subgraph(input.previousNodes, input.previousEdges);
  const next = subgraph(input.nextNodes, input.nextEdges);
  return canvasGraphFingerprint(previous) !== canvasGraphFingerprint(next);
}

export function workflowProjectedResultRegressed(input: {
  currentNodes: unknown[];
  incomingNodes: unknown[];
}) {
  const incomingById = new Map(input.incomingNodes.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const node = value as { data?: Record<string, unknown>; id?: unknown };
    return typeof node.id === "string" ? [[node.id, node] as const] : [];
  }));
  return input.currentNodes.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const current = value as { data?: Record<string, unknown>; id?: unknown };
    const taskId = current.data?.groupRunSuccessTaskId;
    if (typeof current.id !== "string" || typeof taskId !== "string") return false;
    return incomingById.get(current.id)?.data?.groupRunSuccessTaskId !== taskId;
  });
}
let canvasSaveSessionGlobalHighWaterLimitForTests: number | undefined;
let canvasSaveSessionOwnerHighWaterLimitForTests: number | undefined;
let beforeCanvasSaveTransactionForTests: CanvasPersistenceBarrier | undefined;
let afterCanvasSaveUpsertForTests: CanvasPersistenceFault | undefined;

type HistoryAsset = {
  createdAt?: string;
  id: string;
  kind: "image" | "video" | "audio" | "world3d";
  label: string;
  preview: string;
};

type HistoryCursor = {
  createdAt: string;
  kind: HistoryAsset["kind"] | null;
  order: "newest" | "oldest";
  rowid: number;
};

type HistoryPageRow = Omit<HistoryAsset, "createdAt"> & {
  createdAt: string;
  historyRowid: number;
};

const historyKinds = ["image", "video", "audio", "world3d"] as const;
const historyPageDefault = 60;
const historyPageMaximum = 100;

function boundedHistoryPageSize(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? Math.min(parsed, historyPageMaximum)
    : historyPageDefault;
}

function historyCursor(
  value: string | null,
  kind: HistoryAsset["kind"] | undefined,
  order: HistoryCursor["order"],
): HistoryCursor | undefined {
  if (!value || value.length > 512) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<HistoryCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      parsed.createdAt.length < 1 ||
      parsed.createdAt.length > 80 ||
      parsed.kind !== (kind ?? null) ||
      parsed.order !== order ||
      !Number.isSafeInteger(parsed.rowid) ||
      Number(parsed.rowid) < 1
    ) {
      return undefined;
    }
    return {
      createdAt: parsed.createdAt,
      kind: kind ?? null,
      order,
      rowid: Number(parsed.rowid),
    };
  } catch {
    return undefined;
  }
}

function encodeHistoryCursor(value: HistoryCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

type ProjectTitle = {
  title: string;
  updatedAt: number;
};

let database: DatabaseSync | undefined;
let databaseDirectory = "";
let canvasLoadTokenKey = randomBytes(32);
let canvasSaveEpoch = `v1.${randomBytes(16).toString("base64url")}`;

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendLegacyCapabilityResult(
  response: ServerResponse,
  input: Readonly<{
    canvasId: string;
    currentRequestId: string;
    ownerId: string;
    result: CanvasMutationGatewayResult | CanvasOperationReuseResult;
    saveAttemptId: string;
    saveSequence: number;
    saveSessionId: string;
  }>,
) {
  const current = input.result.authoritativeDocument;
  const currentLoadToken = canvasLoadTokenFor(
    input.ownerId,
    input.canvasId,
    current.revision,
  );
  const operationReuse = "code" in input.result;
  const rejected = !operationReuse &&
    input.result.outcome === "REJECTED_CONFLICT";
  const originalSaveStatus = !operationReuse && input.result.outcome === "APPLIED"
    ? "applied" as const
    : "already-applied" as const;
  const common = {
    authoritativeDocument: current,
    currentGraphRevision: current.graphRevision,
    currentLoadToken,
    currentRevision: current.revision,
    graphRevision: current.graphRevision,
    loadToken: currentLoadToken,
    operationGraphRevision: input.result.operationInputGraphRevision,
    operationId: input.result.operationId,
    operationRevision: input.result.operationDocumentRevision,
    originalRequestId: input.result.originalRequestId,
    rejectedAttemptId: input.saveAttemptId,
    rejectedSequence: input.saveSequence,
    rejectedSessionId: input.saveSessionId,
    replayed: input.result.replayed,
    requestId: input.currentRequestId,
    revision: current.revision,
    saveAttemptId: input.saveAttemptId,
    saveSequence: input.saveSequence,
    saveSessionId: input.saveSessionId,
  };
  response.setHeader(
    "X-Unboundry-Canvas-Write-Contract",
    legacyCanvasPutWriteContract,
  );
  if (operationReuse || rejected) {
    const code = operationReuse
      ? input.result.code
      : input.result.conflictCode ?? "CANVAS_LEGACY_RECONCILE_REQUIRED";
    json(response, 409, {
      ...common,
      code,
      error: code === "CANVAS_SAVE_SUPERSEDED"
        ? "Superseded same-session save"
        : "Canvas must be reconciled with the authoritative document",
      requiresAuthoritativeGet: true,
    });
    return;
  }
  json(response, 200, {
    ...common,
    originalSaveStatus,
    requiresAuthoritativeGet: false,
    saveStatus: input.result.replayed ? "already-applied" : originalSaveStatus,
  });
}

function updateLengthPrefixed(
  hmac: ReturnType<typeof createHmac>,
  value: string,
) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hmac.update(length);
  hmac.update(bytes);
}

function canvasLoadTokenFor(
  ownerId: string,
  canvasId: string,
  observedRevision: number,
) {
  const hmac = createHmac("sha256", canvasLoadTokenKey);
  updateLengthPrefixed(hmac, "unboundry.canvas-load-token.v1");
  updateLengthPrefixed(hmac, ownerId);
  updateLengthPrefixed(hmac, canvasId);
  updateLengthPrefixed(hmac, String(observedRevision));
  return `v1.${hmac.digest("base64url")}`;
}

/** Canvas-domain capability for narrow server-side Canvas mutations. */
export function canvasLoadTokenForApplication(
  ownerId: string,
  canvasId: string,
  observedRevision: number,
) {
  return canvasLoadTokenFor(ownerId, canvasId, observedRevision);
}

function validCanvasLoadToken(
  token: string,
  ownerId: string,
  canvasId: string,
  observedRevision: number,
) {
  const expected = Buffer.from(
    canvasLoadTokenFor(ownerId, canvasId, observedRevision),
    "utf8",
  );
  const received = Buffer.from(token, "utf8");
  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

/** Canvas-domain verification capability shared by the typed command API. */
export function validCanvasLoadTokenForApplication(
  token: string,
  ownerId: string,
  canvasId: string,
  observedRevision: number,
) {
  return validCanvasLoadToken(token, ownerId, canvasId, observedRevision);
}

/** Opaque process epoch persisted only as a receipt baseline proof. */
export function canvasLoadTokenEpochForApplication() {
  return canvasSaveEpoch;
}

function rotateCanvasLoadTokenKey() {
  const previous = canvasLoadTokenKey;
  const nextKey = randomBytes(32);
  const nextEpoch = `v1.${randomBytes(16).toString("base64url")}`;
  canvasLoadTokenKey = nextKey;
  canvasSaveEpoch = nextEpoch;
  previous.fill(0);
}

/** Test-only deterministic barriers for save/delete and rollback interleavings. */
export function setCanvasPersistenceBarriersForTests(input?: {
  afterUpsert?: CanvasPersistenceFault;
  beforeTransaction?: CanvasPersistenceBarrier;
  globalHighWaterLimit?: number;
  ownerHighWaterLimit?: number;
}) {
  if (process.env.UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER !== "1") {
    throw new Error("Canvas persistence test barrier is disabled");
  }
  if (
    input?.globalHighWaterLimit !== undefined &&
    (!Number.isSafeInteger(input.globalHighWaterLimit) ||
      input.globalHighWaterLimit < 1 ||
      input.globalHighWaterLimit > canvasSaveSessionGlobalHighWaterLimit)
  ) {
    throw new Error("Invalid canvas persistence test global high-water limit");
  }
  if (
    input?.ownerHighWaterLimit !== undefined &&
    (!Number.isSafeInteger(input.ownerHighWaterLimit) ||
      input.ownerHighWaterLimit < 1 ||
      input.ownerHighWaterLimit > canvasSaveSessionOwnerHighWaterLimit)
  ) {
    throw new Error("Invalid canvas persistence test owner high-water limit");
  }
  afterCanvasSaveUpsertForTests = input?.afterUpsert;
  beforeCanvasSaveTransactionForTests = input?.beforeTransaction;
  canvasSaveSessionGlobalHighWaterLimitForTests = input?.globalHighWaterLimit;
  canvasSaveSessionOwnerHighWaterLimitForTests = input?.ownerHighWaterLimit;
}

/** Read one connection-local high-water in tests without creating/evicting it. */
export function canvasSaveSessionHighWaterForTests(input: {
  canvasId: string;
  ownerId: string;
  saveSessionId: string;
}) {
  if (process.env.UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER !== "1") {
    throw new Error("Canvas persistence test inspection is disabled");
  }
  const store = db();
  const table = store.prepare(`
    SELECT 1
    FROM sqlite_temp_master
    WHERE type = 'table' AND name = 'canvas_save_session_high_water'
  `).get();
  if (!table) return undefined;
  const row = store.prepare(`
    SELECT save_sequence
    FROM canvas_save_session_high_water
    WHERE owner_id = ? AND canvas_id = ? AND save_session_id = ?
  `).get(input.ownerId, input.canvasId, input.saveSessionId) as
    | { save_sequence: number }
    | undefined;
  return row?.save_sequence;
}

/** Prove that a read path did not initialize connection-local save state. */
export function canvasSaveHighWaterTableExistsForTests() {
  if (process.env.UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER !== "1") {
    throw new Error("Canvas persistence test inspection is disabled");
  }
  return Boolean(db().prepare(`
    SELECT 1
    FROM sqlite_temp_master
    WHERE type = 'table' AND name = 'canvas_save_session_high_water'
  `).get());
}

/** Simulate one process restart: discard connection-local state and credentials. */
export function resetCanvasPersistenceConnectionForTests() {
  if (process.env.UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER !== "1") {
    throw new Error("Canvas persistence test reset is disabled");
  }
  if (database?.isTransaction) {
    throw new Error("Cannot reset canvas persistence during a transaction");
  }
  try {
    database?.close();
  } finally {
    database = undefined;
    databaseDirectory = "";
    rotateCanvasLoadTokenKey();
  }
}

/** Reserve a synthetic owner/session key through the production cap logic. */
export function reserveCanvasSaveSessionHighWaterForTests(input: {
  canvasId: string;
  ownerId: string;
  saveSequence: number;
  saveSessionId: string;
}) {
  if (process.env.UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER !== "1") {
    throw new Error("Canvas persistence test reservation is disabled");
  }
  if (
    !Number.isSafeInteger(input.saveSequence) ||
    input.saveSequence < 1 ||
    !input.ownerId ||
    !input.canvasId ||
    !input.saveSessionId
  ) {
    throw new Error("Invalid canvas persistence test reservation");
  }
  const store = db();
  store.exec("BEGIN IMMEDIATE");
  try {
    ensureCanvasSaveHighWaterTable(store);
    const existing = canvasSaveHighWater(
      store,
      input.ownerId,
      input.canvasId,
      input.saveSessionId,
    );
    if (!existing && !hasCanvasSaveHighWaterCapacity(store, input.ownerId)) {
      store.exec("ROLLBACK");
      return false;
    }
    upsertCanvasSaveHighWater(
      store,
      input.ownerId,
      input.canvasId,
      input.saveSessionId,
      input.saveSequence,
    );
    store.exec("COMMIT");
    return true;
  } catch (error) {
    rollbackCanvasSave(store, error);
  }
}

function canvasRow(
  store: DatabaseSync,
  bypass: boolean,
  ownerId: string,
  id: string,
) {
  return (
    bypass
      ? store
          .prepare(`
            SELECT owner_id, revision, graph_revision, nodes, edges, viewport,
                   save_session_id, save_sequence
            FROM canvas_documents
            WHERE id = ?
            ORDER BY owner_id IS NULL DESC
            LIMIT 1
          `)
          .get(id)
      : store
          .prepare(`
            SELECT owner_id, revision, graph_revision, nodes, edges, viewport,
                   save_session_id, save_sequence
            FROM canvas_documents
            WHERE owner_id = ? AND id = ?
          `)
          .get(ownerId, id)
  ) as CanvasRow | undefined;
}

function ensureCanvasSaveHighWaterTable(store: DatabaseSync) {
  store.exec(`
    CREATE TEMP TABLE IF NOT EXISTS canvas_save_session_high_water (
      owner_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      save_session_id TEXT NOT NULL,
      save_sequence INTEGER NOT NULL CHECK (save_sequence > 0),
      save_attempt_id TEXT,
      PRIMARY KEY (owner_id, canvas_id, save_session_id)
    ) WITHOUT ROWID
  `);
}

function canvasSaveHighWater(
  store: DatabaseSync,
  ownerId: string,
  canvasId: string,
  saveSessionId: string,
) {
  return store.prepare(`
    SELECT save_sequence, save_attempt_id
    FROM canvas_save_session_high_water
    WHERE owner_id = ? AND canvas_id = ? AND save_session_id = ?
  `).get(ownerId, canvasId, saveSessionId) as
    | { save_attempt_id: string | null; save_sequence: number }
    | undefined;
}

function existingCanvasSaveHighWater(
  store: DatabaseSync,
  ownerId: string,
  canvasId: string,
  saveSessionId: string,
) {
  const table = store.prepare(`
    SELECT 1
    FROM sqlite_temp_master
    WHERE type = 'table' AND name = 'canvas_save_session_high_water'
  `).get();
  return table
    ? canvasSaveHighWater(store, ownerId, canvasId, saveSessionId)
    : undefined;
}

function canvasReadFenceMetadata(
  store: DatabaseSync,
  ownerId: string,
  canvasId: string,
  row: CanvasRow | undefined,
  saveSessionId: string | undefined,
) {
  const highWater = saveSessionId
    ? existingCanvasSaveHighWater(store, ownerId, canvasId, saveSessionId)
    : undefined;
  const durableReceipt = saveSessionId
    ? store.prepare(`
        SELECT operation_id, save_sequence
        FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ? AND save_session_id = ?
          AND save_sequence IS NOT NULL
        ORDER BY save_sequence DESC, settled_at DESC, operation_id ASC
        LIMIT 1
      `).get(ownerId, canvasId, saveSessionId) as
        | { operation_id: string; save_sequence: number }
        | undefined
    : undefined;
  const persistedSameSessionSequence =
    row && saveSessionId && row.save_session_id === saveSessionId
      ? row.save_sequence
      : 0;
  const sessionHighWaterSequence = Math.max(
    highWater?.save_sequence ?? 0,
    persistedSameSessionSequence,
    durableReceipt?.save_sequence ?? 0,
  );
  const markerAttemptId = durableReceipt?.save_sequence ===
      sessionHighWaterSequence &&
      durableReceipt.operation_id.startsWith("save-marker:")
    ? durableReceipt.operation_id.slice("save-marker:".length)
    : null;
  return {
    currentWriterSequence: row?.save_sequence ?? 0,
    currentWriterSessionId: row?.save_session_id ?? null,
    saveEpoch: canvasSaveEpoch,
    sessionHighWaterAttemptId:
      highWater?.save_sequence === sessionHighWaterSequence
        ? highWater.save_attempt_id
        : markerAttemptId && canvasSaveSessionPattern.test(markerAttemptId)
          ? markerAttemptId
          : null,
    sessionHighWaterOperationId:
      durableReceipt?.save_sequence === sessionHighWaterSequence
        ? durableReceipt.operation_id
        : null,
    sessionHighWaterSequence,
  };
}

function canvasSaveHighWaterLimits() {
  return {
    global: canvasSaveSessionGlobalHighWaterLimitForTests ??
      canvasSaveSessionGlobalHighWaterLimit,
    owner: canvasSaveSessionOwnerHighWaterLimitForTests ??
      canvasSaveSessionOwnerHighWaterLimit,
  };
}

function hasCanvasSaveHighWaterCapacity(
  store: DatabaseSync,
  ownerId: string,
) {
  // Project deletion is committed through a different SQLite connection, so
  // its connection cannot directly remove rows from this connection-local
  // TEMP table. Reclaim only exact owner/canvas keys whose durable project row
  // is already tombstoned, plus keys whose durable owner has been physically
  // deleted, before either bounded-capacity count is evaluated. Active owners,
  // active projects and canvases without a project tombstone are untouched.
  store.prepare(`
    DELETE FROM canvas_save_session_high_water
    WHERE
      EXISTS (
        SELECT 1
        FROM project_metadata
        WHERE
          project_metadata.owner_id = canvas_save_session_high_water.owner_id
          AND project_metadata.id = canvas_save_session_high_water.canvas_id
          AND project_metadata.deleted_at IS NOT NULL
      )
      OR NOT EXISTS (
        SELECT 1
        FROM users
        WHERE users.id = canvas_save_session_high_water.owner_id
      )
  `).run();
  const limits = canvasSaveHighWaterLimits();
  const global = store.prepare(`
    SELECT COUNT(*) AS count FROM canvas_save_session_high_water
  `).get() as { count: number };
  if (global.count >= limits.global) return false;
  const owner = store.prepare(`
    SELECT COUNT(*) AS count
    FROM canvas_save_session_high_water
    WHERE owner_id = ?
  `).get(ownerId) as { count: number };
  return owner.count < limits.owner;
}

function upsertCanvasSaveHighWater(
  store: DatabaseSync,
  ownerId: string,
  canvasId: string,
  saveSessionId: string,
  saveSequence: number,
  saveAttemptId: string | null = null,
) {
  return store.prepare(`
    INSERT INTO canvas_save_session_high_water (
      owner_id, canvas_id, save_session_id, save_sequence, save_attempt_id
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, canvas_id, save_session_id) DO UPDATE SET
      save_sequence = excluded.save_sequence,
      save_attempt_id = excluded.save_attempt_id
    WHERE excluded.save_sequence >
      canvas_save_session_high_water.save_sequence
  `).run(ownerId, canvasId, saveSessionId, saveSequence, saveAttemptId);
}

function rollbackCanvasSave(store: DatabaseSync, original: unknown): never {
  try {
    if (store.isTransaction) store.exec("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError(
      [original, rollbackError],
      "Canvas save and rollback both failed",
    );
  }
  throw original;
}

function projectTombstone(
  store: DatabaseSync,
  bypass: boolean,
  ownerId: string,
  id: string,
) {
  return bypass
    ? store.prepare(`
        SELECT 1
        FROM project_metadata
        WHERE id = ? AND deleted_at IS NOT NULL
        LIMIT 1
      `).get(id)
    : store.prepare(`
        SELECT 1
        FROM project_metadata
        WHERE owner_id = ? AND id = ? AND deleted_at IS NOT NULL
      `).get(ownerId, id);
}

export function hasOtherOwnerProject(
  store: DatabaseSync,
  bypass: boolean,
  ownerId: string,
  id: string,
) {
  if (bypass) return false;
  // `default` 是每个账号各自继承的旧画布：首管理员的项目表里虽然有同名的
  // default 项目行，但其他账号也必须能创建/保存自己的 default 画布，
  // 因此 default 不参与“跨账号项目 ID”守卫。
  if (id === "default") return false;
  return Boolean(store.prepare(`
    SELECT 1
    FROM project_metadata
    WHERE
      id = ?
      AND is_project = 1
      AND deleted_at IS NULL
      AND owner_id != ?
    LIMIT 1
  `).get(id, ownerId));
}

function touchProjectUpdatedAt(
  store: DatabaseSync,
  bypass: boolean,
  ownerId: string,
  id: string,
  now: number,
) {
  executeTransactionScopedCommand(store, touchProjectUpdatedAtCommand, {
    bypass,
    canvasId: id,
    ownerId,
    updatedAt: now,
  });
}

function valid(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as CanvasDocument;
  const { viewport } = document;
  return (
    Number.isInteger(document.revision) &&
    document.revision >= 0 &&
    (document.generationProjection === undefined ||
      validGenerationProjection(document.generationProjection)) &&
    ((document.observedLoadToken === undefined &&
      document.observedRevision === undefined) ||
      (typeof document.observedLoadToken === "string" &&
        document.observedLoadToken.trim().length > 0 &&
        document.observedLoadToken.length <= 256 &&
        Number.isSafeInteger(document.observedRevision) &&
        Number(document.observedRevision) >= 0)) &&
    Array.isArray(document.nodes) &&
    document.nodes.length <= 5_000 &&
    document.nodes.every((node) =>
      !node || typeof node !== "object" || Array.isArray(node) ||
        !("type" in node)
        ? true
        : persistedNodeSchemaRegistry.accepts(node)
    ) &&
    Array.isArray(document.edges) &&
    document.edges.length <= 10_000 &&
    viewport &&
    [viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) &&
    viewport.zoom > 0 &&
    (document.saveAttemptId === undefined ||
      (typeof document.saveAttemptId === "string" &&
        canvasSaveSessionPattern.test(document.saveAttemptId) &&
        document.saveSessionId !== undefined &&
        document.saveSequence !== undefined)) &&
    ((document.saveSessionId === undefined && document.saveSequence === undefined) ||
      (typeof document.saveSessionId === "string" &&
        canvasSaveSessionPattern.test(document.saveSessionId) &&
        Number.isSafeInteger(document.saveSequence) &&
        Number(document.saveSequence) > 0))
  );
}

function validGenerationProjection(value: unknown): value is GenerationProjectionCommit {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const projection = value as Partial<GenerationProjectionCommit>;
  if (!generationProjectionKinds.has(String(projection.kind))) return false;
  const fields = [
    projection.accountId,
    projection.applicationId,
    projection.nodeId,
    projection.ownershipKey,
    projection.resultKey,
    projection.runId,
    projection.semanticRevision,
    projection.taskId,
  ];
  return fields.every((field) =>
    typeof field === "string" && generationProjectionValuePattern.test(field)
  ) && typeof projection.inputFingerprint === "string" &&
    projection.inputFingerprint.length > 0 &&
    projection.inputFingerprint.length <= generationProjectionInputFingerprintMaxLength &&
    projection.applicationId ===
    `${projection.runId}:${projection.nodeId}:${projection.taskId}:${projection.resultKey}` &&
    projection.semanticRevision === generationProjectionSemanticRevision(
      projection as GenerationProjectionCommit,
    );
}

function stableProjectionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableProjectionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableProjectionValue(item)]),
    );
  }
  return value;
}

function generationProjectionSemanticRevision(projection: GenerationProjectionCommit) {
  const source = JSON.stringify(stableProjectionValue({
    inputFingerprint: projection.inputFingerprint,
    kind: projection.kind,
    nodeId: projection.nodeId,
    ownershipKey: projection.ownershipKey,
    runId: projection.runId,
    taskId: projection.taskId,
  }));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function legacyRouteServerClass(
  store: DatabaseSync,
  ownerId: string,
  canvasId: string,
  projection: GenerationProjectionCommit | undefined,
): CanvasServerClass {
  if (!projection) return "T";
  const evidence = executeTransactionScopedCommand(
    store,
    readCanvasRouteGenerationEvidenceCommand,
    {
      canvasId,
      kind: projection.kind,
      nodeId: projection.nodeId,
      ownerId,
      taskId: projection.taskId,
    },
  );
  if (!evidence) return "D";
  if (["queued", "running", "recovering", "retrying"].includes(
    evidence.state,
  )) return "T";
  if (evidence.generationIdentityVersion === 2) {
    return evidence.state === "success" ? "B" : "D";
  }
  if (!["success", "failed", "cancelled"].includes(evidence.state)) {
    return "D";
  }
  return evidence.dangerousAttempt && evidence.state !== "success" ? "D" : "C";
}

function legacyRouteOutcome(
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

export async function canvasPersistence(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const existingRequestId = response.getHeader("X-Request-ID");
  const currentRequestId = typeof existingRequestId === "string" &&
      existingRequestId.length >= 8
    ? existingRequestId
    : randomUUID();
  response.setHeader("X-Request-ID", currentRequestId);
  const clientBuild = canvasClientBuildFromHeader(
    request.headers["x-unboundry-client-build"],
  );
  const rawWriteContract = request.headers["x-unboundry-canvas-write-contract"];
  const legacyCapability = request.method === "PUT" &&
    rawWriteContract === legacyCanvasPutWriteContract;
  if (legacyCapability) {
    response.setHeader(
      "X-Unboundry-Canvas-Write-Contract",
      legacyCanvasPutWriteContract,
    );
  }
  let routeOperation = "legacy-full-document-put";
  let routeRunId: string | null = null;
  let routeTaskId: string | null = null;
  let routeServerClass: CanvasServerClass = "T";
  const recordLegacyRoute = (outcome: string) => recordCanvasRouteEvent({
    callerSymbol: "client.canvasPersistenceFacade",
    capability: legacyCapability ? legacyCanvasPutWriteContract : "none",
    clientBuild,
    operation: routeOperation,
    outcome,
    requestId: currentRequestId,
    route: "canvas.legacy-put",
    runId: routeRunId,
    serverClass: routeServerClass,
    taskId: routeTaskId,
  });
  const id = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    if (request.method === "PUT") {
      recordLegacyRoute("legacy.rejected.CANVAS_ID_INVALID");
    }
    json(response, 400, {
      code: "CANVAS_ID_INVALID",
      error: "Invalid canvas ID",
      requestId: currentRequestId,
    });
    return;
  }

  const identity = requestIdentity(request);
  if (!identity) {
    if (request.method === "PUT") {
      recordLegacyRoute("legacy.rejected.AUTH_REQUIRED");
    }
    json(response, 401, {
      code: "AUTH_REQUIRED",
      error: "Please sign in",
      requestId: currentRequestId,
    });
    return;
  }
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  if (request.method === "DELETE") {
    const store = db();
    store.exec("BEGIN IMMEDIATE");
    try {
      if (hasActiveWorkflowRunForCanvas(
        store,
        ownerId,
        id,
        identity.bypass,
      )) {
        store.exec("ROLLBACK");
        json(response, 409, {
          code: "WORKFLOW_RUN_ACTIVE",
          error: "画布仍有整组任务在自动收口，请等待完成后再删除",
        });
        return;
      }
      executeTransactionScopedCommand(store, deleteProjectCanvasDocumentsCommand, {
        bypass: Boolean(identity.bypass),
        canvasId: id,
        ownerId,
      });
      ensureCanvasSaveHighWaterTable(store);
      store.prepare(`
        DELETE FROM canvas_save_session_high_water
        WHERE owner_id = ? AND canvas_id = ?
      `).run(ownerId, id);
      store.exec("COMMIT");
    } catch (error) {
      rollbackCanvasSave(store, error);
    }
    json(response, 204, {});
    return;
  }

  if (request.method === "GET") {
    const rawSaveSessionId =
      request.headers["x-unboundry-canvas-save-session"];
    if (
      Array.isArray(rawSaveSessionId) ||
      (rawSaveSessionId !== undefined &&
        !canvasSaveSessionPattern.test(rawSaveSessionId))
    ) {
      json(response, 400, {
        code: "CANVAS_SAVE_SESSION_INVALID",
        error: "Invalid canvas save session header",
      });
      return;
    }
    const saveSessionId = rawSaveSessionId;
    const store = db();
    if (projectTombstone(store, Boolean(identity.bypass), identity.userId, id)) {
      json(response, 404, {
        code: "CANVAS_NOT_FOUND",
        error: "Canvas not found",
        ...canvasReadFenceMetadata(store, ownerId, id, undefined, saveSessionId),
      });
      return;
    }
    if (hasOtherOwnerProject(store, Boolean(identity.bypass), identity.userId, id)) {
      json(response, 404, {
        code: "CANVAS_NOT_FOUND",
        error: "Canvas not found",
        ...canvasReadFenceMetadata(store, ownerId, id, undefined, saveSessionId),
      });
      return;
    }
    const row = canvasRow(
      store,
      Boolean(identity.bypass),
      identity.userId,
      id,
    );
    if (!row) {
      json(response, 404, {
        code: "CANVAS_NOT_FOUND",
        error: "Canvas not found",
        ...canvasReadFenceMetadata(store, ownerId, id, undefined, saveSessionId),
      });
      return;
    }
    json(response, 200, {
      edges: JSON.parse(row.edges),
      graphRevision: row.graph_revision,
      loadToken: canvasLoadTokenFor(ownerId, id, row.revision),
      nodes: JSON.parse(row.nodes),
      revision: row.revision,
      viewport: JSON.parse(row.viewport),
      ...canvasReadFenceMetadata(store, ownerId, id, row, saveSessionId),
    });
    return;
  }

  if (request.method !== "PUT") {
    response.setHeader("Allow", "GET, PUT, DELETE");
    json(response, 405, {
      code: "METHOD_NOT_ALLOWED",
      error: "Method not allowed",
      requestId: currentRequestId,
    });
    return;
  }

  if (
    Array.isArray(rawWriteContract) ||
    (rawWriteContract !== undefined &&
      rawWriteContract !== legacyCanvasPutWriteContract)
  ) {
    recordLegacyRoute("legacy.rejected.CANVAS_WRITE_CONTRACT_UNSUPPORTED");
    json(response, 400, {
      code: "CANVAS_WRITE_CONTRACT_UNSUPPORTED",
      error: "Canvas write contract is unsupported",
      operationId: null,
      requestId: currentRequestId,
    });
    return;
  }
  // The request stream and all request-derived transformations must complete
  // before the write lock is acquired. A slow or malformed body therefore
  // cannot hold BEGIN IMMEDIATE open.
  let document: CanvasDocument;
  try {
    document = await readJsonBody<CanvasDocument>(request, 5_000_000);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      recordLegacyRoute(`legacy.rejected.${error.code}`);
    }
    throw error;
  }
  if (!valid(document)) {
    recordLegacyRoute("legacy.rejected.CANVAS_DOCUMENT_INVALID");
    json(response, 400, {
      code: "CANVAS_DOCUMENT_INVALID",
      error: "Invalid canvas document",
      ...(legacyCapability
        ? { operationId: null, requestId: currentRequestId }
        : {}),
    });
    return;
  }
  if (legacyCapability && (
    typeof document.saveAttemptId !== "string" ||
    typeof document.saveSessionId !== "string" ||
    !Number.isSafeInteger(document.saveSequence) ||
    document.observedRevision === undefined ||
    document.observedLoadToken === undefined
  )) {
    recordLegacyRoute("legacy.rejected.CANVAS_LEGACY_WRITE_IDENTITY_INVALID");
    response.setHeader(
      "X-Unboundry-Canvas-Write-Contract",
      legacyCanvasPutWriteContract,
    );
    json(response, 400, {
      code: "CANVAS_LEGACY_WRITE_IDENTITY_INVALID",
      error: "Legacy Canvas write identity is invalid",
      operationId: null,
      requestId: currentRequestId,
    });
    return;
  }
  if (document.generationProjection) {
    routeOperation = "legacy-generation-projection";
    routeRunId = document.generationProjection.runId;
    routeTaskId = document.generationProjection.taskId;
  }
  let nodes = normalizePersistedMediaNodes(document.nodes);
  let mediaReferences = persistedMediaReferences(nodes);
  let edges = document.edges;
  let serializedNodes = JSON.stringify(nodes);
  let serializedEdges = JSON.stringify(edges);
  const serializedViewport = JSON.stringify(document.viewport);
  let incomingGraphFingerprint = canvasGraphFingerprint({ edges, nodes });
  const barrierInput = {
    canvasId: id,
    ownerId,
    saveAttemptId: document.saveAttemptId,
    saveSequence: document.saveSequence,
    saveSessionId: document.saveSessionId,
  };
  await beforeCanvasSaveTransactionForTests?.(barrierInput);

  const store = db();
  store.exec("BEGIN IMMEDIATE");
  try {
    routeServerClass = legacyRouteServerClass(
      store,
      ownerId,
      id,
      document.generationProjection,
    );
    if (legacyCapability) {
      const result = applyLegacyCanvasPutInTransaction({
        canvasId: id,
        database: store,
        document: {
          edges,
          ...(document.generationProjection
            ? { generationProjection: document.generationProjection }
            : {}),
          nodes,
          observedLoadToken: document.observedLoadToken!,
          observedRevision: document.observedRevision!,
          saveAttemptId: document.saveAttemptId!,
          saveSequence: document.saveSequence!,
          saveSessionId: document.saveSessionId!,
          viewport: document.viewport,
        },
        loadTokenEpoch: canvasLoadTokenEpochForApplication(),
        loadTokenForRevision: (revision) =>
          canvasLoadTokenForApplication(ownerId, id, revision),
        ownerId,
        requestId: currentRequestId,
        validLoadToken: validCanvasLoadTokenForApplication,
      });
      if ("code" in result && result.code === "CANVAS_NOT_FOUND") {
        store.exec("ROLLBACK");
        discardDeferredCanvasObservability(store);
        recordLegacyRoute("legacy.rejected.CANVAS_NOT_FOUND");
        response.setHeader(
          "X-Unboundry-Canvas-Write-Contract",
          legacyCanvasPutWriteContract,
        );
        json(response, 404, {
          code: result.code,
          error: "Canvas not found",
          operationId: null,
          requestId: currentRequestId,
        });
        return;
      }
      store.exec("COMMIT");
      flushDeferredCanvasObservability(store);
      recordLegacyRoute(legacyRouteOutcome(result));
      sendLegacyCapabilityResult(response, {
        canvasId: id,
        currentRequestId,
        ownerId,
        result,
        saveAttemptId: document.saveAttemptId!,
        saveSequence: document.saveSequence!,
        saveSessionId: document.saveSessionId!,
      });
      return;
    }
    // Every decision that can make a save legal is reread under this one
    // writer lock. Project deletion uses the same SQLite writer lock, so an
    // old page can never pass the tombstone check and resurrect the project.
    const row = canvasRow(
      store,
      Boolean(identity.bypass),
      identity.userId,
      id,
    );
    const safeFixtureSeed =
      process.env.UNBOUNDRY_SAFE_TEST === "1" && !row &&
      request.headers["x-unboundry-safe-fixture-seed"] === id;
    if (projectTombstone(store, Boolean(identity.bypass), identity.userId, id)) {
      ensureCanvasSaveHighWaterTable(store);
      store.prepare(`
        DELETE FROM canvas_save_session_high_water
        WHERE owner_id = ? AND canvas_id = ?
      `).run(ownerId, id);
      store.exec("COMMIT");
      recordLegacyRoute("legacy.rejected.CANVAS_PROJECT_DELETED");
      json(response, 409, {
        code: "CANVAS_PROJECT_DELETED",
        error: "项目已删除，请返回工作空间",
      });
      return;
    }
    if (hasOtherOwnerProject(store, Boolean(identity.bypass), identity.userId, id)) {
      store.exec("ROLLBACK");
      recordLegacyRoute("legacy.rejected.CANVAS_PROJECT_NOT_OWNED");
      json(response, 409, {
        code: "CANVAS_PROJECT_NOT_OWNED",
        error: "项目不存在或不属于当前账号",
      });
      return;
    }

    // A candidate save proves that this account loaded the claimed revision of
    // this exact canvas in this process epoch. The claimed revision may be
    // older than the current row so cross-session DATA-005 last-writer-wins is
    // preserved. Existing rows always require the pair; legacy create is the
    // only time-bounded exception.
    const validObservedBaseline =
      document.observedRevision !== undefined &&
      document.observedLoadToken !== undefined &&
      validCanvasLoadToken(
        document.observedLoadToken,
        ownerId,
        id,
        document.observedRevision,
      );
    if (
      (document.observedRevision !== undefined && !validObservedBaseline) ||
      (row && !validObservedBaseline)
    ) {
      store.exec("ROLLBACK");
      recordLegacyRoute("legacy.rejected.CANVAS_LOAD_REQUIRED");
      json(response, 409, {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      });
      return;
    }

    const preparedLegacyDocument = safeFixtureSeed
      ? {
          document: { edges, nodes, viewport: document.viewport },
          status: "ready" as const,
        }
      : prepareUncapableLegacyCanvasPutCandidate({
          currentDocument: row
            ? {
                edges: JSON.parse(row.edges) as unknown[],
                nodes: JSON.parse(row.nodes) as unknown[],
                viewport: JSON.parse(row.viewport) as CanvasDocument["viewport"],
              }
            : undefined,
          database: store,
          document: { edges, nodes, viewport: document.viewport },
          ownerId,
        });
    if (preparedLegacyDocument.status === "rejected") {
      store.exec("ROLLBACK");
      recordLegacyRoute(`legacy.rejected.${preparedLegacyDocument.code}`);
      const messages = {
        CANVAS_LEGACY_RECONCILE_REQUIRED:
          "Legacy Canvas document requires authoritative reconciliation",
        CANVAS_MEDIA_UNAVAILABLE: "Canvas media is no longer available",
        CANVAS_TOPOLOGY_CONFLICT: "Canvas topology is invalid",
      } as const;
      json(response, 409, {
        code: preparedLegacyDocument.code,
        error: messages[preparedLegacyDocument.code],
      });
      return;
    }
    nodes = preparedLegacyDocument.document.nodes;
    edges = preparedLegacyDocument.document.edges;
    serializedNodes = JSON.stringify(nodes);
    serializedEdges = JSON.stringify(edges);
    mediaReferences = persistedMediaReferences(nodes);
    incomingGraphFingerprint = canvasGraphFingerprint({ edges, nodes });

    const lockedWorkflowNodeIds = row
      ? workflowRunLockedNodeIdsInTransaction({
          canvasId: id,
          database: store,
          ownerId,
        })
      : [];
    if (row && workflowLockedGraphChanged({
      lockedNodeIds: lockedWorkflowNodeIds,
      nextEdges: edges,
      nextNodes: nodes,
      previousEdges: JSON.parse(row.edges) as unknown[],
      previousNodes: JSON.parse(row.nodes) as unknown[],
    })) {
      store.exec("ROLLBACK");
      recordLegacyRoute("legacy.rejected.WORKFLOW_GRAPH_LOCKED");
      json(response, 409, {
        code: "WORKFLOW_GRAPH_LOCKED",
        error: "整组执行中的相关节点或连线暂不能修改；其他画布内容仍可编辑",
      });
      return;
    }

    if (
      row &&
      document.observedRevision !== undefined &&
      document.observedRevision < row.revision &&
      workflowProjectedResultRegressed({
        currentNodes: JSON.parse(row.nodes) as unknown[],
        incomingNodes: nodes,
      })
    ) {
      store.exec("ROLLBACK");
      recordLegacyRoute("legacy.rejected.CANVAS_WORKFLOW_PROJECTION_STALE");
      json(response, 409, {
        code: "CANVAS_WORKFLOW_PROJECTION_STALE",
        error: "整组结果已由服务端保存；请刷新后再继续编辑",
      });
      return;
    }

    ensureCanvasSaveHighWaterTable(store);

    // A process restart discards the TEMP table, while schema 37 retains only
    // the current writer on the canvas row. Before a different session (or a
    // legacy no-session request) overwrites that row, atomically hand its
    // durable session/sequence into TEMP. If the bounded table cannot retain
    // it, fail closed and leave the durable row untouched.
    if (
      row?.save_session_id &&
      row.save_sequence > 0 &&
      row.save_session_id !== document.saveSessionId
    ) {
      const retainedCurrentWriter = canvasSaveHighWater(
        store,
        ownerId,
        id,
        row.save_session_id,
      );
      if (
        !retainedCurrentWriter &&
        !hasCanvasSaveHighWaterCapacity(store, ownerId)
      ) {
        store.exec("ROLLBACK");
        recordLegacyRoute("legacy.failed.CANVAS_SAVE_SESSION_CAPACITY");
        json(response, 503, {
          code: "CANVAS_SAVE_SESSION_CAPACITY",
          error: "Canvas save session capacity reached",
        });
        return;
      }
      upsertCanvasSaveHighWater(
        store,
        ownerId,
        id,
        row.save_session_id,
        row.save_sequence,
        null,
      );
    }

    const highWater = document.saveSessionId
      ? canvasSaveHighWater(store, ownerId, id, document.saveSessionId)
      : undefined;
    const persistedSameSessionSequence =
      row &&
        document.saveSessionId &&
        row.save_session_id === document.saveSessionId
        ? row.save_sequence
        : 0;
    const sessionHighWater = Math.max(
      highWater?.save_sequence ?? 0,
      persistedSameSessionSequence,
    );
    const sessionHighWaterAttemptId =
      highWater?.save_sequence === sessionHighWater
        ? highWater.save_attempt_id
        : null;

    if (
      document.saveSessionId &&
      Number(document.saveSequence) <= sessionHighWater
    ) {
      store.exec("ROLLBACK");
      recordLegacyRoute("legacy.rejected.CANVAS_SAVE_SUPERSEDED");
      json(response, 409, {
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: row?.graph_revision ?? 0,
        currentRevision: row?.revision ?? 0,
        currentWriterSequence: row?.save_sequence ?? 0,
        currentWriterSessionId: row?.save_session_id ?? null,
        error: "Superseded same-session save",
        rejectedAttemptId: document.saveAttemptId ?? null,
        rejectedSequence: Number(document.saveSequence),
        rejectedSessionId: document.saveSessionId,
        sessionHighWaterAttemptId,
        sessionHighWaterSequence: sessionHighWater,
      });
      return;
    }

    if (document.saveSessionId && !highWater) {
      if (!hasCanvasSaveHighWaterCapacity(store, ownerId)) {
        store.exec("ROLLBACK");
        recordLegacyRoute("legacy.failed.CANVAS_SAVE_SESSION_CAPACITY");
        json(response, 503, {
          code: "CANVAS_SAVE_SESSION_CAPACITY",
          error: "Canvas save session capacity reached",
        });
        return;
      }
    }

    const revision = (row?.revision ?? 0) + 1;
    const graphChanged = !row || incomingGraphFingerprint !==
      canvasGraphFingerprint({
        edges: JSON.parse(row.edges) as unknown[],
        nodes: JSON.parse(row.nodes) as unknown[],
      });
    const graphRevision = row
      ? row.graph_revision + (graphChanged ? 1 : 0)
      : 1;
    try {
      adoptUploadedMediaReferences(store, {
        canvasId: id,
        ownerId,
        references: mediaReferences,
      });
    } catch (error) {
      if (!(error instanceof MediaPublicationConflictError)) throw error;
      store.exec("ROLLBACK");
      recordLegacyRoute("legacy.rejected.CANVAS_MEDIA_UNAVAILABLE");
      json(response, 409, {
        code: "CANVAS_MEDIA_UNAVAILABLE",
        error: "Canvas media is no longer available",
      });
      return;
    }
    if (document.generationProjection) {
      const projectionResult = applyLegacyGenerationProjectionInTransaction({
        baseDocument: preparedLegacyDocument.document,
        canvasId: id,
        database: store,
        loadTokenEpoch: canvasLoadTokenEpochForApplication(),
        loadTokenForRevision: (nextRevision) =>
          canvasLoadTokenForApplication(ownerId, id, nextRevision),
        ownerId,
        projection: document.generationProjection,
        requestId: currentRequestId,
      });
      if (projectionResult !== "applied") {
        store.exec("ROLLBACK");
        discardDeferredCanvasObservability(store);
        recordLegacyRoute(
          "legacy.rejected.CANVAS_GENERATION_PROJECTION_CONFLICT",
        );
        json(response, 409, {
          code: "CANVAS_GENERATION_PROJECTION_CONFLICT",
          error: "Generation result projection requires authoritative reconciliation",
        });
        return;
      }
      const projected = canvasRow(
        store,
        Boolean(identity.bypass),
        identity.userId,
        id,
      );
      if (!projected) {
        throw new CanvasMutationGatewayUnavailableError(
          "Projected Canvas document is unavailable",
        );
      }
      if (document.saveSessionId) {
        const writerUpdated = store.prepare(`
          UPDATE canvas_documents
          SET save_session_id = ?, save_sequence = ?
          WHERE owner_id = ? AND id = ? AND revision = ?
        `).run(
          document.saveSessionId,
          Number(document.saveSequence),
          ownerId,
          id,
          projected.revision,
        );
        if (writerUpdated.changes !== 1) {
          throw new CanvasMutationGatewayUnavailableError(
            "Legacy projection writer identity was not retained",
          );
        }
        const highWaterUpdated = upsertCanvasSaveHighWater(
          store,
          ownerId,
          id,
          document.saveSessionId,
          Number(document.saveSequence),
          document.saveAttemptId ?? null,
        );
        if (highWaterUpdated.changes !== 1) {
          throw new CanvasMutationGatewayUnavailableError(
            "Legacy projection high-water update failed",
          );
        }
      }
      if (afterCanvasSaveUpsertForTests) {
        afterCanvasSaveUpsertForTests(barrierInput);
      }
      store.exec("COMMIT");
      flushDeferredCanvasObservability(store);
      recordLegacyRoute("legacy.applied");
      json(response, 200, {
        graphRevision: projected.graph_revision,
        loadToken: canvasLoadTokenFor(ownerId, id, projected.revision),
        revision: projected.revision,
      });
      return;
    }
    store
      .prepare(`
        INSERT INTO canvas_documents (
          owner_id, id, revision, graph_revision, nodes, edges, viewport, updated_at,
          save_session_id, save_sequence
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, id) DO UPDATE SET
          revision = excluded.revision,
          graph_revision = excluded.graph_revision,
          nodes = excluded.nodes,
          edges = excluded.edges,
          viewport = excluded.viewport,
          updated_at = excluded.updated_at,
          save_session_id = excluded.save_session_id,
          save_sequence = excluded.save_sequence
      `)
      .run(
        ownerId,
        id,
        revision,
        graphRevision,
        serializedNodes,
        serializedEdges,
        serializedViewport,
        new Date().toISOString(),
        document.saveSessionId ?? null,
        document.saveSequence ?? 0,
      );
    touchProjectUpdatedAt(
      store,
      Boolean(identity.bypass),
      identity.userId,
      id,
      Date.now(),
    );
    if (document.saveSessionId) {
      const updated = upsertCanvasSaveHighWater(
        store,
        ownerId,
        id,
        document.saveSessionId,
        Number(document.saveSequence),
        document.saveAttemptId ?? null,
      );
      if (updated.changes !== 1) {
        throw new Error("Canvas save high-water update failed");
      }
    }
    if (afterCanvasSaveUpsertForTests) {
      afterCanvasSaveUpsertForTests(barrierInput);
    }
    store.exec("COMMIT");
    flushDeferredCanvasObservability(store);
    recordLegacyRoute("legacy.applied");
    json(response, 200, {
      graphRevision,
      loadToken: canvasLoadTokenFor(ownerId, id, revision),
      revision,
    });
  } catch (error) {
    if (
      error instanceof CanvasMutationGatewayCapacityError ||
      error instanceof CanvasMutationGatewayUnavailableError
    ) {
      if (store.isTransaction) store.exec("ROLLBACK");
      discardDeferredCanvasObservability(store);
      recordLegacyRoute(`legacy.failed.${error.code}`);
      if (legacyCapability) {
        response.setHeader(
          "X-Unboundry-Canvas-Write-Contract",
          legacyCanvasPutWriteContract,
        );
      }
      json(response, 503, {
        code: error.code,
        error: error.message,
        ...(legacyCapability
          ? { operationId: null, requestId: currentRequestId }
          : {}),
      });
      return;
    }
    discardDeferredCanvasObservability(store);
    rollbackCanvasSave(store, error);
  }
}

export async function accountHistory(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const accountId = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(accountId)) {
    json(response, 400, { error: "Invalid account ID" });
    return;
  }

  const store = db();
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }
  const effectiveAccountId = identity.bypass ? accountId : identity.userId;
  if (request.method === "GET") {
    const requestUrl = new URL(request.url ?? "", "http://127.0.0.1");
    const kindValue = requestUrl.searchParams.get("kind");
    const kind = kindValue === null
      ? undefined
      : historyKinds.find((candidate) => candidate === kindValue);
    if (kindValue !== null && !kind) {
      json(response, 400, { error: "Invalid history kind" });
      return;
    }
    const order: HistoryCursor["order"] =
      requestUrl.searchParams.get("order") === "oldest" ? "oldest" : "newest";
    const orderValue = requestUrl.searchParams.get("order");
    if (orderValue !== null && orderValue !== "newest" && orderValue !== "oldest") {
      json(response, 400, { error: "Invalid history order" });
      return;
    }
    const limit = boundedHistoryPageSize(requestUrl.searchParams.get("limit"));
    const cursorValue = requestUrl.searchParams.get("cursor");
    const cursor = historyCursor(cursorValue, kind, order);
    if (cursorValue !== null && !cursor) {
      json(response, 400, { error: "Invalid history cursor" });
      return;
    }

    const scopeColumn = identity.bypass
      ? "history.account_id"
      : "history.owner_id";
    const scopeId = identity.bypass ? effectiveAccountId : identity.userId;
    const pageComparison = order === "newest" ? "<" : ">";
    const pageOrder = order === "newest" ? "DESC" : "ASC";
    const pageWhere = [
      `${scopeColumn} = ?`,
      kind ? "history.kind = ?" : undefined,
      `(
        history.kind = 'world3d'
        OR (
          history.kind IN ('image', 'video', 'audio')
          AND media.id IS NOT NULL
        )
      )`,
      cursor
        ? `(
          history.created_at ${pageComparison} ?
          OR (
            history.created_at = ?
            AND history.rowid ${pageComparison} ?
          )
        )`
        : undefined,
    ].filter((condition): condition is string => Boolean(condition));
    const pageParameters: Array<string | number> = [scopeId];
    if (kind) pageParameters.push(kind);
    if (cursor) {
      pageParameters.push(cursor.createdAt, cursor.createdAt, cursor.rowid);
    }
    pageParameters.push(limit + 1);
    const rows = store.prepare(`
      SELECT
        history.id,
        history.kind,
        history.label,
        history.preview,
        history.created_at AS createdAt,
        history.rowid AS historyRowid
      FROM asset_history AS history
      LEFT JOIN media_assets AS media
        ON media.id = history.id
        AND media.kind = history.kind
        AND media.owner_id = history.owner_id
        AND media.storage_status = 'ready'
      WHERE ${pageWhere.join(" AND ")}
      ORDER BY history.created_at ${pageOrder}, history.rowid ${pageOrder}
      LIMIT ?
    `).all(...pageParameters) as HistoryPageRow[];
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(({ historyRowid: _historyRowid, ...item }) => item);

    const counts: Record<HistoryAsset["kind"], number> = {
      image: 0,
      video: 0,
      audio: 0,
      world3d: 0,
    };
    const countRows = store.prepare(`
      SELECT history.kind, COUNT(*) AS count
      FROM asset_history AS history
      LEFT JOIN media_assets AS media
        ON media.id = history.id
        AND media.kind = history.kind
        AND media.owner_id = history.owner_id
        AND media.storage_status = 'ready'
      WHERE
        ${scopeColumn} = ?
        AND (
          history.kind = 'world3d'
          OR (
            history.kind IN ('image', 'video', 'audio')
            AND media.id IS NOT NULL
          )
        )
      GROUP BY history.kind
    `).all(scopeId) as Array<{ count: number; kind: HistoryAsset["kind"] }>;
    for (const row of countRows) {
      if (historyKinds.includes(row.kind)) counts[row.kind] = Number(row.count);
    }

    const lastRow = pageRows.at(-1);
    const nextCursor = rows.length > limit && lastRow
      ? encodeHistoryCursor({
          createdAt: lastRow.createdAt,
          kind: kind ?? null,
          order,
          rowid: lastRow.historyRowid,
        })
      : undefined;
    json(response, 200, { counts, items, nextCursor });
    return;
  }

  if (request.method === "DELETE") {
    if (identity.bypass) {
      store
        .prepare("DELETE FROM asset_history WHERE account_id = ?")
        .run(effectiveAccountId);
    } else {
      store
        .prepare("DELETE FROM asset_history WHERE owner_id = ?")
        .run(identity.userId);
    }
    json(response, 204, {});
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const item = await readJsonBody<HistoryAsset>(request, 5_000_000);
    if (
      !/^[a-z0-9._-]+$/i.test(item.id) ||
      !["image", "video", "audio", "world3d"].includes(item.kind) ||
      typeof item.label !== "string" ||
      item.label.length < 1 ||
      item.label.length > 120 ||
      typeof item.preview !== "string" ||
      item.preview.length > 1_000
    ) {
      json(response, 400, { error: "Invalid history asset" });
      return;
    }
    if (item.kind !== "world3d") {
      const mediaOwnerId = identity.bypass ? "__test__" : identity.userId;
      const media = store.prepare(`
        SELECT 1 FROM media_assets
        WHERE owner_id = ? AND kind = ? AND id = ?
          AND storage_status = 'ready'
      `).get(mediaOwnerId, item.kind, item.id);
      const expectedPreview = item.kind === "video"
        ? `/api/video-assets/${item.id}`
        : item.kind === "audio"
          ? `/api/audio-assets/${item.id}`
          : `/api/assets/${item.id}`;
      if (!media || item.preview !== expectedPreview) {
        json(response, 409, {
          code: "MEDIA_NOT_READY",
          error: "History media must be an owned ready asset",
        });
        return;
      }
    }
    store
      .prepare(`
        INSERT INTO asset_history (
          account_id, id, kind, label, preview, created_at, owner_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          preview = excluded.preview,
          owner_id = excluded.owner_id
      `)
      .run(
        effectiveAccountId,
        item.id,
        item.kind,
        item.label,
        item.preview,
        new Date().toISOString(),
        identity.bypass ? "__test__" : identity.userId,
      );
    json(response, 201, { item });
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

export async function projectTitle(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    json(response, 400, { error: "Invalid project ID" });
    return;
  }

  const store = db();
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "Please sign in" });
    return;
  }
  if (request.method === "DELETE") {
    if (hasOtherOwnerProject(store, Boolean(identity.bypass), identity.userId, id)) {
      json(response, 404, { error: "Project title not found" });
      return;
    }
    inImmediateTransaction(store, () => executeTransactionScopedCommand(
      store,
      deleteProjectMetadataCommand,
      { bypass: Boolean(identity.bypass), canvasId: id, ownerId: identity.userId },
    ));
    json(response, 204, {});
    return;
  }

  const read = () =>
    (identity.bypass
      ? store
          .prepare(`
            SELECT title, updated_at AS updatedAt
            FROM project_metadata
            WHERE id = ?
            ORDER BY owner_id IS NULL DESC
            LIMIT 1
          `)
          .get(id)
      : store
          .prepare(`
            SELECT title, updated_at AS updatedAt
            FROM project_metadata
            WHERE owner_id = ? AND id = ?
          `)
          .get(identity.userId, id)) as ProjectTitle | undefined;

  if (request.method === "GET") {
    if (hasOtherOwnerProject(store, Boolean(identity.bypass), identity.userId, id)) {
      json(response, 404, { error: "Project title not found" });
      return;
    }
    const row = read();
    if (!row) {
      json(response, 404, { error: "Project title not found" });
      return;
    }
    json(response, 200, row);
    return;
  }

  if (request.method !== "PUT") {
    response.setHeader("Allow", "GET, PUT, DELETE");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const item = await readJsonBody<ProjectTitle>(request, 5_000_000);
    if (
      typeof item.title !== "string" ||
      item.title.length > 120 ||
      !Number.isSafeInteger(item.updatedAt) ||
      item.updatedAt < 1
    ) {
      json(response, 400, { error: "Invalid project title" });
      return;
    }
    if (projectTombstone(store, Boolean(identity.bypass), identity.userId, id)) {
      json(response, 409, { error: "项目已删除，请返回工作空间" });
      return;
    }
    if (hasOtherOwnerProject(store, Boolean(identity.bypass), identity.userId, id)) {
      json(response, 409, { error: "项目不存在或不属于当前账号" });
      return;
    }
    const ownerId = identity.bypass ? "__test__" : identity.userId;
    inImmediateTransaction(store, () => executeTransactionScopedCommand(
      store,
      upsertProjectTitleCommand,
      { canvasId: id, ownerId, title: item.title, updatedAt: item.updatedAt },
    ));
    const saved = read();
    if (
      !saved ||
      saved.title !== item.title ||
      saved.updatedAt !== item.updatedAt
    ) {
      json(response, 409, {
        current: saved ?? null,
        error: "项目名称已在其他页面更新，请确认后重试",
      });
      return;
    }
    json(response, 200, saved);
  } catch (error) {
    if (error instanceof HttpRequestError) throw error;
    json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}
