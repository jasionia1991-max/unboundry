import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
  statSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  currentSchemaContract,
  currentSchemaManifest,
  currentSchemaVersion,
} from "./database.ts";
import { discardUnreadRequestBody } from "./httpRequest.ts";

const defaultRetryAfterSeconds = 5;
const defaultShutdownDeadlineMs = 10_000;

type Next = (error?: unknown) => void;

export type RuntimeMode = "active" | "maintenance" | "shutting-down";

export type RuntimeControlEvent = Readonly<{
  retryAfterSeconds: number;
  type: "maintenance" | "shutdown";
}>;

export type RuntimeLogRecord = Readonly<{
  code: string;
  durationMs: number;
  event: "lifecycle" | "request";
  method: string;
  requestId: string;
  routeId: string;
  status: number;
  timestamp: string;
}>;

type RuntimeLogger = (record: RuntimeLogRecord) => void;
type StreamCloser = (event: RuntimeControlEvent) => void;

export type RuntimeLifecycleOptions = Readonly<{
  dataDirectory?: string | (() => string);
  logger?: RuntimeLogger;
  readinessDatabaseGuard?: (database: DatabaseSync) => boolean;
  retryAfterSeconds?: number;
  shutdownDeadlineMs?: number;
}>;

type RequestContext = {
  code: string;
  counted: boolean;
  finished: boolean;
  method: string;
  requestId: string;
  routeId: string;
  startedAt: number;
};

type DatabaseProbe =
  | { ok: true; schemaVersion: number }
  | {
      code:
        | "DATABASE_DIRECTORY_INVALID"
        | "DATABASE_DIRECTORY_UNAVAILABLE"
        | "DATABASE_FILE_INVALID"
        | "DATABASE_FILE_UNAVAILABLE"
        | "DATABASE_INTEGRITY_FAILED"
        | "DATABASE_RESTORE_INCOMPLETE"
        | "DATABASE_SCHEMA_MISMATCH"
        | "DATABASE_UNAVAILABLE";
      ok: false;
    };

export type ShutdownResult = Readonly<{
  activeHandlers: number;
  drained: boolean;
  inFlightRequests: number;
}>;

export type RuntimeShutdownCoordinatorOptions = Readonly<{
  beginShutdown: () => Promise<ShutdownResult>;
  close: () => Promise<void> | void;
  closeAllConnections?: () => void;
  deadlineMs: number;
  hardExitGraceMs?: number;
}>;

function defaultLogger(record: RuntimeLogRecord) {
  try {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Logging must never turn a handled request into a process failure.
  }
}

function boundedInteger(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, Math.trunc(value ?? fallback)));
}

function safeMethod(method: string | undefined) {
  const normalized = String(method ?? "UNKNOWN").toUpperCase();
  return /^(?:DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT)$/.test(normalized)
    ? normalized
    : "OTHER";
}

function safeRouteId(routeId: string | undefined) {
  const normalized = String(routeId ?? "unmatched").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized)
    ? normalized
    : "unmatched";
}

function safeCode(code: string | undefined) {
  const normalized = String(code ?? "OK").trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(normalized)
    ? normalized
    : "UNCLASSIFIED";
}

function isAvailableDuringMaintenance(request: IncomingMessage) {
  if (!["GET", "HEAD"].includes(safeMethod(request.method))) return false;
  const path = (request.url ?? "").split("?", 1)[0] ?? "";
  return path === "/version";
}

function json(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function schemaSqlHash(sql: unknown) {
  return createHash("sha256").update(String(sql ?? "")).digest("hex");
}

function acceptedSchemaSqlHashes(contract: {
  acceptedSqlHashes?: readonly string[];
  sqlHash: string;
}) {
  return contract.acceptedSqlHashes ?? [contract.sqlHash];
}

function schemaObject(
  database: DatabaseSync,
  type: "index" | "table" | "trigger",
  name: string,
) {
  return database.prepare(`
    SELECT sql, tbl_name
    FROM sqlite_schema
    WHERE type = ? AND name = ?
  `).get(type, name) as { sql?: unknown; tbl_name?: unknown } | undefined;
}

export function databaseMatchesSchemaContract(database: DatabaseSync) {
  const expectedTables = Object.keys(currentSchemaContract.tables).sort();
  const actualTables = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  if (!sameStrings(actualTables, expectedTables)) return false;

  for (const tableName of expectedTables) {
    if (!/^[a-z][a-z0-9_]*$/.test(tableName)) return false;
    const expectedColumns = [
      ...currentSchemaContract.tables[
        tableName as keyof typeof currentSchemaContract.tables
      ],
    ].sort();
    const actualColumns = (database
      .prepare(`PRAGMA table_xinfo("${tableName}")`)
      .all() as Array<{ name?: unknown }>).map((column) => String(column.name))
      .sort();
    if (!sameStrings(actualColumns, expectedColumns)) return false;
    const table = schemaObject(database, "table", tableName);
    const acceptedSqlHashes = currentSchemaContract.tableSqlHashes[
      tableName as keyof typeof currentSchemaContract.tableSqlHashes
    ];
    if (!table || !acceptedSqlHashes.includes(schemaSqlHash(table.sql))) {
      return false;
    }
  }

  const expectedExplicitIndexNames = Object.keys(
    currentSchemaContract.explicitIndexes,
  ).sort();
  const optionalExplicitIndexNames = new Set<string>();
  for (const [indexName, condition] of Object.entries(
    currentSchemaContract.conditionallyOptionalExplicitIndexes,
  )) {
    const table = schemaObject(database, "table", condition.table);
    if (schemaSqlHash(table?.sql) === condition.tableSqlHash) {
      optionalExplicitIndexNames.add(indexName);
    }
  }
  const requiredExplicitIndexNames = expectedExplicitIndexNames.filter(
    (name) => !optionalExplicitIndexNames.has(name),
  );
  const actualExplicitIndexNames = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'index' AND sql IS NOT NULL
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  if (
    actualExplicitIndexNames.some(
      (name) => !expectedExplicitIndexNames.includes(name),
    ) ||
    requiredExplicitIndexNames.some(
      (name) => !actualExplicitIndexNames.includes(name),
    )
  ) {
    return false;
  }
  for (const indexName of actualExplicitIndexNames) {
    const expected = currentSchemaContract.explicitIndexes[
      indexName as keyof typeof currentSchemaContract.explicitIndexes
    ];
    const index = schemaObject(database, "index", indexName);
    if (
      String(index?.tbl_name ?? "") !== expected.table ||
      !acceptedSchemaSqlHashes(expected).includes(schemaSqlHash(index?.sql))
    ) return false;
  }

  for (const [indexName, expected] of Object.entries(
    currentSchemaContract.indexes,
  )) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(indexName) ||
      !/^[a-z][a-z0-9_]*$/.test(expected.table)
    ) return false;
    const index = (database
      .prepare(`PRAGMA index_list("${expected.table}")`)
      .all() as Array<{
        name?: unknown;
        partial?: unknown;
        unique?: unknown;
      }>).find((candidate) => String(candidate.name) === indexName);
    if (
      !index ||
      Boolean(Number(index.unique)) !== expected.unique ||
      Boolean(Number(index.partial)) !== expected.partial
    ) return false;
    const columns = (database
      .prepare(`PRAGMA index_xinfo("${indexName}")`)
      .all() as Array<{ key?: unknown; name?: unknown }>).filter(
        (column) => Number(column.key) === 1,
      ).map((column) => String(column.name));
    if (!sameStrings(columns, expected.columns)) return false;
    const schemaIndex = schemaObject(database, "index", indexName);
    const explicitIndex = currentSchemaContract.explicitIndexes[
      indexName as keyof typeof currentSchemaContract.explicitIndexes
    ];
    if (
      String(schemaIndex?.tbl_name ?? "") !== expected.table ||
      !acceptedSchemaSqlHashes(explicitIndex).includes(
        schemaSqlHash(schemaIndex?.sql),
      )
    ) return false;
  }

  const expectedTriggerNames = Object.keys(currentSchemaContract.triggers).sort();
  const actualTriggerNames = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'trigger'
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  if (!sameStrings(actualTriggerNames, expectedTriggerNames)) return false;
  for (const [triggerName, expected] of Object.entries(
    currentSchemaContract.triggers,
  )) {
    const trigger = schemaObject(database, "trigger", triggerName);
    if (
      String(trigger?.tbl_name ?? "") !== expected.table ||
      schemaSqlHash(trigger?.sql) !== expected.sqlHash
    ) return false;
  }
  const actualViewNames = (database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'view'
    ORDER BY name
  `).all() as Array<{ name?: unknown }>).map((row) => String(row.name));
  return actualViewNames.length === 0;
}

export function createRuntimeLifecycle(options: RuntimeLifecycleOptions = {}) {
  const logger = options.logger ?? defaultLogger;
  const retryAfterSeconds = boundedInteger(
    options.retryAfterSeconds,
    defaultRetryAfterSeconds,
    3_600,
  );
  const schemaVersion = currentSchemaVersion;
  const shutdownDeadlineMs = boundedInteger(
    options.shutdownDeadlineMs,
    defaultShutdownDeadlineMs,
    120_000,
  );
  const contexts = new WeakMap<IncomingMessage, RequestContext>();
  const streamClosers = new Set<StreamCloser>();
  const drainWaiters = new Set<() => void>();
  let activeHandlers = 0;
  let inFlightRequests = 0;
  let maintenance = process.env.UNBOUNDRY_MAINTENANCE_MODE === "1";
  let shuttingDown = false;
  let shutdownPromise: Promise<ShutdownResult> | undefined;

  function dataDirectory() {
    if (typeof options.dataDirectory === "function") {
      return options.dataDirectory();
    }
    return options.dataDirectory ??
      process.env.UNBOUNDRY_DATA_DIR ??
      join(process.cwd(), "data");
  }

  function mode(): RuntimeMode {
    if (shuttingDown) return "shutting-down";
    if (maintenance) return "maintenance";
    return "active";
  }

  function writeLog(
    event: RuntimeLogRecord["event"],
    fields: Partial<Omit<RuntimeLogRecord, "event" | "timestamp">> = {},
  ) {
    const record: RuntimeLogRecord = {
      timestamp: new Date().toISOString(),
      event,
      requestId: fields.requestId ?? "",
      method: safeMethod(fields.method),
      routeId: safeRouteId(fields.routeId),
      status: Number.isInteger(fields.status) ? Number(fields.status) : 0,
      durationMs: Number.isFinite(fields.durationMs)
        ? Math.max(0, Math.round(Number(fields.durationMs)))
        : 0,
      code: safeCode(fields.code),
    };
    try {
      logger(record);
    } catch {
      // A custom log sink is observational and must not affect availability.
    }
  }

  function drained() {
    return inFlightRequests === 0 && activeHandlers === 0;
  }

  function notifyDrainIfIdle() {
    if (!drained()) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }

  function finishRequest(
    request: IncomingMessage,
    response: ServerResponse,
    context: RequestContext,
  ) {
    if (context.finished) return;
    context.finished = true;
    if (context.counted) {
      context.counted = false;
      inFlightRequests = Math.max(0, inFlightRequests - 1);
    }
    const responseCode = context.code === "OK" && response.statusCode >= 400
      ? `HTTP_${response.statusCode}`
      : context.code;
    writeLog("request", {
      requestId: context.requestId,
      method: context.method,
      routeId: context.routeId,
      status: response.statusCode,
      durationMs: Date.now() - context.startedAt,
      code: responseCode,
    });
    notifyDrainIfIdle();
  }

  function ensureRequest(
    request: IncomingMessage,
    response: ServerResponse,
    routeId?: string,
  ) {
    const existing = contexts.get(request);
    if (existing) {
      if (routeId) existing.routeId = safeRouteId(routeId);
      return existing;
    }

    const context: RequestContext = {
      code: "OK",
      counted: true,
      finished: false,
      method: safeMethod(request.method),
      requestId: randomUUID(),
      routeId: safeRouteId(routeId),
      startedAt: Date.now(),
    };
    contexts.set(request, context);
    inFlightRequests += 1;
    if (!response.headersSent) {
      response.setHeader("X-Request-ID", context.requestId);
    }
    const finish = () => finishRequest(request, response, context);
    response.once("finish", finish);
    response.once("close", finish);
    return context;
  }

  function rejectUnavailable(
    request: IncomingMessage,
    response: ServerResponse,
    code: "SERVICE_MAINTENANCE" | "SERVICE_SHUTTING_DOWN",
  ) {
    const context = ensureRequest(request, response);
    context.code = code;
    discardUnreadRequestBody(request);
    response.setHeader("Connection", "close");
    response.setHeader("Retry-After", String(retryAfterSeconds));
    response.once("finish", () => {
      if (!request.readableEnded && !request.destroyed) request.destroy();
    });
    json(response, 503, {
      error:
        code === "SERVICE_MAINTENANCE"
          ? "Service is temporarily unavailable"
          : "Service is shutting down",
      code,
      requestId: context.requestId,
    });
  }

  function middleware(
    request: IncomingMessage,
    response: ServerResponse,
    next: Next,
  ) {
    ensureRequest(request, response);
    if (!isAvailableDuringMaintenance(request)) {
      if (shuttingDown) {
        rejectUnavailable(request, response, "SERVICE_SHUTTING_DOWN");
        return;
      }
      if (maintenance) {
        rejectUnavailable(request, response, "SERVICE_MAINTENANCE");
        return;
      }
    }
    next();
  }

  function trackHandler<T>(handler: () => Promise<T> | T): Promise<T> {
    activeHandlers += 1;
    return Promise.resolve()
      .then(handler)
      .finally(() => {
        activeHandlers = Math.max(0, activeHandlers - 1);
        notifyDrainIfIdle();
      });
  }

  function setRouteId(request: IncomingMessage, routeId: string) {
    const context = contexts.get(request);
    if (context) context.routeId = safeRouteId(routeId);
  }

  function setResponseCode(request: IncomingMessage, code: string) {
    const context = contexts.get(request);
    if (context) context.code = safeCode(code);
  }

  function requestId(request: IncomingMessage) {
    return contexts.get(request)?.requestId;
  }

  function notifyStreams(event: RuntimeControlEvent) {
    for (const closer of streamClosers) {
      try {
        closer(event);
      } catch {
        writeLog("lifecycle", { code: "STREAM_DRAIN_FAILED" });
      }
    }
  }

  function registerStreamCloser(closer: StreamCloser) {
    streamClosers.add(closer);
    try {
      if (shuttingDown) {
        closer({ type: "shutdown", retryAfterSeconds });
      } else if (maintenance) {
        closer({ type: "maintenance", retryAfterSeconds });
      }
    } catch {
      writeLog("lifecycle", { code: "STREAM_DRAIN_FAILED" });
    }
    return () => {
      streamClosers.delete(closer);
    };
  }

  function setMaintenance(enabled: boolean) {
    if (shuttingDown || maintenance === enabled) return mode();
    maintenance = enabled;
    writeLog("lifecycle", {
      code: enabled ? "MAINTENANCE_ENABLED" : "MAINTENANCE_DISABLED",
    });
    if (enabled) {
      notifyStreams({ type: "maintenance", retryAfterSeconds });
    }
    return mode();
  }

  function probeDatabase(): DatabaseProbe {
    let directory: string;
    try {
      directory = dataDirectory();
    } catch {
      return { ok: false, code: "DATABASE_DIRECTORY_UNAVAILABLE" };
    }

    try {
      const directoryStat = statSync(directory);
      if (!directoryStat.isDirectory()) {
        return { ok: false, code: "DATABASE_DIRECTORY_INVALID" };
      }
      accessSync(directory, constants.R_OK);
    } catch (error) {
      return {
        ok: false,
        code:
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
            ? "DATABASE_DIRECTORY_INVALID"
            : "DATABASE_DIRECTORY_UNAVAILABLE",
      };
    }

    const databasePath = join(directory, "unboundry.sqlite");
    try {
      lstatSync(join(directory, ".unboundry-restore-incomplete"));
      return { ok: false, code: "DATABASE_RESTORE_INCOMPLETE" };
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        return { ok: false, code: "DATABASE_DIRECTORY_UNAVAILABLE" };
      }
    }
    try {
      const fileStat = statSync(databasePath);
      if (!fileStat.isFile() || fileStat.size === 0) {
        return { ok: false, code: "DATABASE_FILE_INVALID" };
      }
      accessSync(databasePath, constants.R_OK);
    } catch (error) {
      return {
        ok: false,
        code:
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
            ? "DATABASE_FILE_INVALID"
            : "DATABASE_FILE_UNAVAILABLE",
      };
    }

    let database: DatabaseSync | undefined;
    try {
      let walBytes = 0;
      let sharedMemoryPresent = false;
      try {
        walBytes = statSync(`${databasePath}-wal`).size;
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          return { ok: false, code: "DATABASE_FILE_UNAVAILABLE" };
        }
      }
      try {
        sharedMemoryPresent = statSync(`${databasePath}-shm`).isFile();
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          return { ok: false, code: "DATABASE_FILE_UNAVAILABLE" };
        }
      }
      if (walBytes > 0 && !sharedMemoryPresent) {
        return { ok: false, code: "DATABASE_FILE_UNAVAILABLE" };
      }
      // A live WAL database must use SQLite's read-only coordination so the
      // committed WAL snapshot is not ignored. SQLite may update disposable
      // read-lock/WAL-index bytes in an existing -shm file; it never writes the
      // main database or WAL here. A hot WAL without -shm fails closed rather
      // than letting readiness create a new sidecar in the source directory.
      const databaseLocation = walBytes > 0
        ? databasePath
        : `${pathToFileURL(databasePath).href}?immutable=1`;
      database = new DatabaseSync(databaseLocation, {
        readOnly: true,
        timeout: 1_000,
      });
      const quickCheckRows = database
        .prepare("PRAGMA quick_check")
        .all() as Array<{ quick_check?: unknown }>;
      if (
        quickCheckRows.length !== 1 ||
        String(quickCheckRows[0]?.quick_check) !== "ok"
      ) {
        return { ok: false, code: "DATABASE_INTEGRITY_FAILED" };
      }
      const versionRow = database
        .prepare("PRAGMA user_version")
        .get() as { user_version?: unknown } | undefined;
      const ledgerTable = database
        .prepare(`
          SELECT 1 AS present
          FROM sqlite_master
          WHERE type = 'table' AND name = 'schema_migrations'
        `)
        .get();
      if (!ledgerTable) {
        return { ok: false, code: "DATABASE_SCHEMA_MISMATCH" };
      }
      const ledgerRows = database
        .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
        .all() as Array<{ name?: unknown; version?: unknown }>;
      if (
        Number(versionRow?.user_version) !== schemaVersion ||
        ledgerRows.length !== currentSchemaManifest.length ||
        ledgerRows.some((row, index) => (
          Number(row.version) !== currentSchemaManifest[index]?.version ||
          String(row.name) !== currentSchemaManifest[index]?.name
        ))
      ) {
        return { ok: false, code: "DATABASE_SCHEMA_MISMATCH" };
      }
      if (!databaseMatchesSchemaContract(database)) {
        return { ok: false, code: "DATABASE_SCHEMA_MISMATCH" };
      }
      if (
        options.readinessDatabaseGuard &&
        !options.readinessDatabaseGuard(database)
      ) {
        return { ok: false, code: "DATABASE_UNAVAILABLE" };
      }
      return { ok: true, schemaVersion };
    } catch {
      return { ok: false, code: "DATABASE_UNAVAILABLE" };
    } finally {
      try {
        database?.close();
      } catch {
        // Readiness has already completed; close failure has no safe detail to expose.
      }
    }
  }

  function healthApi(
    request: IncomingMessage,
    response: ServerResponse,
    kind: "live" | "ready",
  ) {
    const context = ensureRequest(request, response, `health.${kind}`);
    if (request.method !== "GET") {
      context.code = "METHOD_NOT_ALLOWED";
      response.setHeader("Allow", "GET");
      json(response, 405, {
        error: "Method not allowed",
        code: "METHOD_NOT_ALLOWED",
        requestId: context.requestId,
      });
      return;
    }

    if (kind === "live") {
      json(response, 200, {
        status: "live",
        requestId: context.requestId,
      });
      return;
    }

    if (shuttingDown) {
      context.code = "SERVICE_SHUTTING_DOWN";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        error: "Service is shutting down",
        code: "SERVICE_SHUTTING_DOWN",
        requestId: context.requestId,
      });
      return;
    }

    const probe = probeDatabase();
    if (!probe.ok) {
      context.code = probe.code;
      json(response, 503, {
        error: "Service is not ready",
        code: probe.code,
        requestId: context.requestId,
      });
      return;
    }

    json(response, 200, {
      status: "ready",
      mode: maintenance ? "maintenance-api-blocked" : "active",
      mutationsAccepted: !maintenance,
      databaseProbe: "read-only",
      schemaVersion: probe.schemaVersion,
      requestId: context.requestId,
    });
  }

  function waitForDrain(deadlineMs: number): Promise<ShutdownResult> {
    if (drained()) {
      return Promise.resolve({
        activeHandlers: 0,
        drained: true,
        inFlightRequests: 0,
      });
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const complete = (drained: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        drainWaiters.delete(onDrain);
        resolve({ activeHandlers, drained, inFlightRequests });
      };
      const onDrain = () => complete(true);
      drainWaiters.add(onDrain);
      timer = setTimeout(() => complete(false), deadlineMs);
    });
  }

  function beginShutdown(deadlineMs = shutdownDeadlineMs) {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    writeLog("lifecycle", { code: "SHUTDOWN_STARTED" });
    notifyStreams({ type: "shutdown", retryAfterSeconds });
    shutdownPromise = waitForDrain(
      boundedInteger(deadlineMs, shutdownDeadlineMs, 120_000),
    ).then((result) => {
      writeLog("lifecycle", {
        code: result.drained ? "SHUTDOWN_DRAINED" : "SHUTDOWN_DEADLINE",
      });
      return result;
    });
    return shutdownPromise;
  }

  return {
    beginShutdown,
    getActiveHandlers: () => activeHandlers,
    getInFlightRequests: () => inFlightRequests,
    getMode: mode,
    getRetryAfterSeconds: () => retryAfterSeconds,
    getShutdownDeadlineMs: () => shutdownDeadlineMs,
    healthApi,
    middleware,
    probeDatabase,
    registerStreamCloser,
    requestId,
    setMaintenance,
    setResponseCode,
    setRouteId,
    trackHandler,
  };
}

export type RuntimeLifecycle = ReturnType<typeof createRuntimeLifecycle>;

export async function coordinateRuntimeShutdown(
  options: RuntimeShutdownCoordinatorOptions,
): Promise<0 | 1> {
  const deadlineMs = boundedInteger(options.deadlineMs, 10_000, 120_000);
  const hardExitGraceMs = boundedInteger(
    options.hardExitGraceMs,
    1_000,
    30_000,
  );
  let timeout: NodeJS.Timeout | undefined;
  const forceClose = () => {
    try {
      options.closeAllConnections?.();
    } catch {
      // The final process exit remains the authoritative hard stop.
    }
  };
  try {
    const shutdown = options.beginShutdown();
    await Promise.race([
      Promise.resolve(shutdown)
        .then(async (result) => {
          if (!result.drained) forceClose();
          await Promise.resolve().then(options.close);
        }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Runtime shutdown deadline exceeded")),
          deadlineMs + hardExitGraceMs,
        );
      }),
    ]);
    return 0;
  } catch {
    forceClose();
    return 1;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
