import {
  createHmac,
  randomBytes,
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
} from "./mediaLifecycle";

type CanvasDocument = {
  edges: unknown[];
  nodes: unknown[];
  observedLoadToken?: string;
  observedRevision?: number;
  revision: number;
  saveAttemptId?: string;
  saveSequence?: number;
  saveSessionId?: string;
  viewport: { x: number; y: number; zoom: number };
};

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
  const persistedSameSessionSequence =
    row && saveSessionId && row.save_session_id === saveSessionId
      ? row.save_sequence
      : 0;
  const sessionHighWaterSequence = Math.max(
    highWater?.save_sequence ?? 0,
    persistedSameSessionSequence,
  );
  return {
    currentWriterSequence: row?.save_sequence ?? 0,
    currentWriterSessionId: row?.save_session_id ?? null,
    saveEpoch: canvasSaveEpoch,
    sessionHighWaterAttemptId:
      highWater?.save_sequence === sessionHighWaterSequence
        ? highWater.save_attempt_id
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
  if (bypass) {
    store.prepare(`
      UPDATE project_metadata
      SET updated_at = MAX(updated_at, ?)
      WHERE id = ? AND is_project = 1 AND deleted_at IS NULL
    `).run(now, id);
  } else {
    store.prepare(`
      UPDATE project_metadata
      SET updated_at = MAX(updated_at, ?)
      WHERE owner_id = ? AND id = ? AND is_project = 1 AND deleted_at IS NULL
    `).run(now, ownerId, id);
  }
}

function valid(value: unknown): value is CanvasDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as CanvasDocument;
  const { viewport } = document;
  return (
    Number.isInteger(document.revision) &&
    document.revision >= 0 &&
    ((document.observedLoadToken === undefined &&
      document.observedRevision === undefined) ||
      (typeof document.observedLoadToken === "string" &&
        document.observedLoadToken.trim().length > 0 &&
        document.observedLoadToken.length <= 256 &&
        Number.isSafeInteger(document.observedRevision) &&
        Number(document.observedRevision) >= 0)) &&
    Array.isArray(document.nodes) &&
    document.nodes.length <= 5_000 &&
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

export async function canvasPersistence(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const id = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );
  if (!/^[a-z0-9._-]+$/i.test(id)) {
    json(response, 400, {
      code: "CANVAS_ID_INVALID",
      error: "Invalid canvas ID",
    });
    return;
  }

  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { code: "AUTH_REQUIRED", error: "Please sign in" });
    return;
  }
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  if (request.method === "DELETE") {
    const store = db();
    store.exec("BEGIN IMMEDIATE");
    try {
      if (identity.bypass) {
        store.prepare("DELETE FROM canvas_documents WHERE id = ?").run(id);
      } else {
        store
          .prepare("DELETE FROM canvas_documents WHERE owner_id = ? AND id = ?")
          .run(identity.userId, id);
      }
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
    });
    return;
  }

  // The request stream and all request-derived transformations must complete
  // before the write lock is acquired. A slow or malformed body therefore
  // cannot hold BEGIN IMMEDIATE open.
  const document = await readJsonBody<CanvasDocument>(request, 5_000_000);
  if (!valid(document)) {
    json(response, 400, {
      code: "CANVAS_DOCUMENT_INVALID",
      error: "Invalid canvas document",
    });
    return;
  }
  const nodes = normalizePersistedMediaNodes(document.nodes);
  const mediaReferences = persistedMediaReferences(nodes);
  const edges = document.edges;
  const serializedNodes = JSON.stringify(nodes);
  const serializedEdges = JSON.stringify(edges);
  const serializedViewport = JSON.stringify(document.viewport);
  const incomingGraphFingerprint = canvasGraphFingerprint({ edges, nodes });
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
    // Every decision that can make a save legal is reread under this one
    // writer lock. Project deletion uses the same SQLite writer lock, so an
    // old page can never pass the tombstone check and resurrect the project.
    const row = canvasRow(
      store,
      Boolean(identity.bypass),
      identity.userId,
      id,
    );
    if (projectTombstone(store, Boolean(identity.bypass), identity.userId, id)) {
      ensureCanvasSaveHighWaterTable(store);
      store.prepare(`
        DELETE FROM canvas_save_session_high_water
        WHERE owner_id = ? AND canvas_id = ?
      `).run(ownerId, id);
      store.exec("COMMIT");
      json(response, 409, {
        code: "CANVAS_PROJECT_DELETED",
        error: "项目已删除，请返回工作空间",
      });
      return;
    }
    if (hasOtherOwnerProject(store, Boolean(identity.bypass), identity.userId, id)) {
      store.exec("ROLLBACK");
      json(response, 409, {
        code: "CANVAS_PROJECT_NOT_OWNED",
        error: "项目不存在或不属于当前账号",
      });
      return;
    }

    // A candidate save proves that this account loaded the claimed revision of
    // this exact canvas in this process epoch. The claimed revision may be
    // older than the current row so cross-session DATA-005 last-writer-wins is
    // preserved. Restarting rotates the wire-only HMAC key, so a response
    // delayed across a restart cannot overwrite a newer writer after TEMP
    // high-water state has been discarded. Every write to an existing row,
    // including a v0.5.1-shaped request, therefore requires the observed pair;
    // only creation of a row that is still missing under this transaction may
    // omit it. This intentionally fails old pages closed after an upgrade or
    // restart instead of allowing a discarded per-session high-water to revive
    // an older snapshot.
    // Deliberately omit revision fields from this 409 so an old client cannot
    // misclassify it as a retryable revision conflict.
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
      json(response, 409, {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
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
      json(response, 409, {
        code: "CANVAS_MEDIA_UNAVAILABLE",
        error: "Canvas media is no longer available",
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
    json(response, 200, {
      graphRevision,
      loadToken: canvasLoadTokenFor(ownerId, id, revision),
      revision,
    });
  } catch (error) {
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
    if (identity.bypass) {
      store.prepare("DELETE FROM project_metadata WHERE id = ?").run(id);
    } else {
      store
        .prepare("DELETE FROM project_metadata WHERE owner_id = ? AND id = ?")
        .run(identity.userId, id);
    }
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
    store
      .prepare(`
        INSERT INTO project_metadata (owner_id, id, title, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_id, id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > project_metadata.updated_at
          OR (
            excluded.updated_at = project_metadata.updated_at
            AND excluded.title = project_metadata.title
          )
      `)
      .run(ownerId, id, item.title, item.updatedAt);
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
