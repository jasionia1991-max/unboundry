import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  lstatSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  currentSchemaManifest,
  currentSchemaVersion,
  databaseHasCompleteLegacyMediaMetadata,
  databaseMatchesSchema40Contract,
  databaseMatchesSchemaContract,
  migrationIncompleteMarker,
} from "./database.ts";
import { discardUnreadRequestBody } from "./httpRequest.ts";
import type { RuntimeRoleCoordinator } from "./runtimeRole.ts";

const defaultRetryAfterSeconds = 5;
const defaultShutdownDeadlineMs = 10_000;

type Next = (error?: unknown) => void;

export type RuntimeMode =
  | "active"
  | "maintenance"
  | "read-only"
  | "shutting-down"
  | "standby";

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
  allowLegacySchema37Business?: boolean;
  beforeActiveLeaseRelease?: (
    remainingDeadlineMs: number,
  ) => Promise<void> | void;
  dataDirectory?: string | (() => string);
  legacyRuntimeReadinessGuard?: () => boolean;
  legacyStandbyDatabaseGuard?: (database: DatabaseSync) => boolean;
  logger?: RuntimeLogger;
  readinessDatabaseGuard?: (database: DatabaseSync) => boolean;
  retryAfterSeconds?: number;
  roleCoordinator?: RuntimeRoleCoordinator;
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
  | { ok: true; schemaVersion: number; standby: boolean }
  | {
      code:
        | "DATABASE_DIRECTORY_INVALID"
        | "DATABASE_DIRECTORY_UNAVAILABLE"
        | "DATABASE_FILE_INVALID"
        | "DATABASE_FILE_UNAVAILABLE"
        | "DATABASE_INTEGRITY_FAILED"
        | "DATABASE_MIGRATION_INCOMPLETE"
        | "DATABASE_RESTORE_INCOMPLETE"
        | "DATABASE_SCHEMA_MISMATCH"
        | "DATABASE_UNAVAILABLE";
      ok: false;
    };

type DatabaseAdmissionIdentity = Readonly<{
  dataDirectory: string;
  dataDirectoryDev: bigint;
  dataDirectoryIno: bigint;
  dataDirectoryMode: bigint;
  dataDirectoryUid: bigint;
  dev: bigint;
  ino: bigint;
  mode: bigint;
  nlink: bigint;
  uid: bigint;
}>;

type CachedBusinessSchemaAdmission = Readonly<{
  identity: DatabaseAdmissionIdentity;
  probe: Extract<DatabaseProbe, { ok: true }>;
}>;

export type ShutdownResult = Readonly<{
  activeHandlers: number;
  drained: boolean;
  inFlightRequests: number;
}>;

export type RuntimeShutdownFailureDiagnostic = Readonly<{
  causeCode:
    | `LEGACY_RUNTIME_DATABASE_CHANGED:${string}`
    | "LEGACY_RUNTIME_DRAIN_TIMEOUT"
    | "LEGACY_RUNTIME_STOP_FAILED"
    | "LEGACY_RUNTIME_TERMINATION_UNKNOWN"
    | "RUNTIME_SHUTDOWN_DEADLINE_EXCEEDED"
    | "RUNTIME_SHUTDOWN_DID_NOT_DRAIN"
    | "RUNTIME_SHUTDOWN_UNCLASSIFIED";
  code: "RUNTIME_SHUTDOWN_FAILED";
}>;

export type RuntimeShutdownCoordinatorOptions = Readonly<{
  beginShutdown: () => Promise<ShutdownResult>;
  close: () => Promise<void> | void;
  closeAllConnections?: () => void;
  deadlineMs: number;
  hardExitGraceMs?: number;
  reportFailure?: (diagnostic: RuntimeShutdownFailureDiagnostic) => void;
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

function boundedShutdownFailureDiagnostic(
  error: unknown,
): RuntimeShutdownFailureDiagnostic {
  const message = error instanceof Error ? error.message : "";
  const databaseChange = message.match(
    /^LEGACY_RUNTIME_DATABASE_CHANGED:(ACTIVE_POST_WARMUP|ACTIVE_PRELAUNCH|ACTIVE_SHUTDOWN|ACTIVE_STANDALONE|MEDIA_POST_WARMUP|MEDIA_STANDALONE):(DATABASE|DIRECTORY|JOURNAL|SHM|WAL):(CONTENT_METADATA|IDENTITY|PRESENCE)$/,
  );
  let causeCode: RuntimeShutdownFailureDiagnostic["causeCode"] =
    "RUNTIME_SHUTDOWN_UNCLASSIFIED";
  if (databaseChange) {
    causeCode = databaseChange[0] as
      `LEGACY_RUNTIME_DATABASE_CHANGED:${string}`;
  } else if (/^LEGACY_RUNTIME_DRAIN_TIMEOUT(?::|$)/.test(message)) {
    causeCode = "LEGACY_RUNTIME_DRAIN_TIMEOUT";
  } else if (/^LEGACY_RUNTIME_STOP_FAILED(?::|$)/.test(message)) {
    causeCode = "LEGACY_RUNTIME_STOP_FAILED";
  } else if (/^LEGACY_RUNTIME_TERMINATION_UNKNOWN(?::|$)/.test(message)) {
    causeCode = "LEGACY_RUNTIME_TERMINATION_UNKNOWN";
  } else if (message === "Runtime shutdown deadline exceeded") {
    causeCode = "RUNTIME_SHUTDOWN_DEADLINE_EXCEEDED";
  } else if (message === "Runtime shutdown did not drain") {
    causeCode = "RUNTIME_SHUTDOWN_DID_NOT_DRAIN";
  }
  return Object.freeze({ causeCode, code: "RUNTIME_SHUTDOWN_FAILED" });
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

function existsWithoutThrow(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
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

export { databaseMatchesSchema40Contract, databaseMatchesSchemaContract };

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
  let businessSchemaAdmission: CachedBusinessSchemaAdmission | undefined;
  let activeDatabaseIdentity: DatabaseAdmissionIdentity | undefined;
  let databaseIdentityRestartRequired = false;
  let legacySchema37BusinessActive = false;
  let schema37RestartRequired = false;

  function dataDirectory() {
    if (typeof options.dataDirectory === "function") {
      return options.dataDirectory();
    }
    return options.dataDirectory ??
      process.env.UNBOUNDRY_DATA_DIR ??
      join(process.cwd(), "data");
  }

  function databaseAdmissionIdentity(
    directory: string,
  ): DatabaseAdmissionIdentity | undefined {
    try {
      const canonicalDirectory = lstatSync(directory, { bigint: true });
      if (
        !canonicalDirectory.isDirectory() || canonicalDirectory.isSymbolicLink() ||
        typeof process.getuid !== "function" ||
        canonicalDirectory.uid !== BigInt(process.getuid()) ||
        (canonicalDirectory.mode & 0o022n) !== 0n
      ) return undefined;
      const database = lstatSync(join(directory, "unboundry.sqlite"), {
        bigint: true,
      });
      if (
        !database.isFile() || database.isSymbolicLink() ||
        database.nlink !== 1n || typeof process.getuid !== "function" ||
        database.uid !== BigInt(process.getuid()) ||
        (database.mode & 0o022n) !== 0n
      ) return undefined;
      return Object.freeze({
        dataDirectory: directory,
        dataDirectoryDev: canonicalDirectory.dev,
        dataDirectoryIno: canonicalDirectory.ino,
        dataDirectoryMode: canonicalDirectory.mode,
        dataDirectoryUid: canonicalDirectory.uid,
        dev: database.dev,
        ino: database.ino,
        mode: database.mode,
        nlink: database.nlink,
        uid: database.uid,
      });
    } catch {
      return undefined;
    }
  }

  function sameDatabaseAdmissionIdentity(
    left: DatabaseAdmissionIdentity | undefined,
    right: DatabaseAdmissionIdentity | undefined,
  ) {
    return Boolean(
      left && right && left.dataDirectory === right.dataDirectory &&
        left.dataDirectoryDev === right.dataDirectoryDev &&
        left.dataDirectoryIno === right.dataDirectoryIno &&
        left.dataDirectoryUid === right.dataDirectoryUid &&
        left.dataDirectoryMode === right.dataDirectoryMode &&
        left.dev === right.dev && left.ino === right.ino &&
        left.uid === right.uid && left.mode === right.mode &&
        left.nlink === right.nlink,
    );
  }

  function observeDatabaseAdmissionIdentity(directory: string) {
    const current = databaseAdmissionIdentity(directory);
    if (
      activeDatabaseIdentity &&
      !sameDatabaseAdmissionIdentity(activeDatabaseIdentity, current)
    ) {
      databaseIdentityRestartRequired = true;
      businessSchemaAdmission = undefined;
    }
    return current;
  }

  function establishActiveDatabaseIdentity(
    identity: DatabaseAdmissionIdentity | undefined,
  ) {
    if (!identity) return false;
    if (
      activeDatabaseIdentity &&
      !sameDatabaseAdmissionIdentity(activeDatabaseIdentity, identity)
    ) {
      databaseIdentityRestartRequired = true;
      businessSchemaAdmission = undefined;
      return false;
    }
    activeDatabaseIdentity ??= identity;
    return true;
  }

  function latchSchema37Standby() {
    schema37RestartRequired = true;
    businessSchemaAdmission = undefined;
  }

  function requireRestartAfterStartupSchemaMigration() {
    latchSchema37Standby();
  }

  function observeStartupDatabaseProbe(probe: DatabaseProbe) {
    if (!probe.ok) {
      if (
        legacySchema37BusinessActive ||
        probe.code === "DATABASE_MIGRATION_INCOMPLETE"
      ) {
        latchSchema37Standby();
      }
      return !schema37RestartRequired;
    }
    if (probe.standby) {
      if (!options.allowLegacySchema37Business) {
        latchSchema37Standby();
        return false;
      }
      legacySchema37BusinessActive = true;
      let directory: string;
      try {
        directory = dataDirectory();
      } catch {
        return false;
      }
      return establishActiveDatabaseIdentity(
        observeDatabaseAdmissionIdentity(directory),
      );
    }
    if (legacySchema37BusinessActive) {
      latchSchema37Standby();
      return false;
    }
    if (schema37RestartRequired) return false;
    let directory: string;
    try {
      directory = dataDirectory();
    } catch {
      return true;
    }
    establishActiveDatabaseIdentity(
      observeDatabaseAdmissionIdentity(directory),
    );
    return !schema37RestartRequired && !databaseIdentityRestartRequired;
  }

  function mode(): RuntimeMode {
    if (shuttingDown) return "shutting-down";
    const configuredRole = options.roleCoordinator?.role();
    if (configuredRole && configuredRole !== "active") return configuredRole;
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
    code:
      | "SERVICE_DATABASE_UNAVAILABLE"
      | "SERVICE_ACTIVE_LEASE_UNAVAILABLE"
      | "SERVICE_LEGACY_RUNTIME_UNAVAILABLE"
      | "SERVICE_MAINTENANCE"
      | "SERVICE_RESTART_REQUIRED"
      | "SERVICE_RUNTIME_ROLE_NOT_ACTIVE"
      | "SERVICE_SCHEMA_STANDBY"
      | "SERVICE_SHUTTING_DOWN",
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
      error: code === "SERVICE_MAINTENANCE"
        ? "Service is temporarily unavailable"
        : code === "SERVICE_RUNTIME_ROLE_NOT_ACTIVE"
        ? "Service runtime is not active"
        : code === "SERVICE_ACTIVE_LEASE_UNAVAILABLE"
        ? "Service active lease is unavailable"
        : code === "SERVICE_LEGACY_RUNTIME_UNAVAILABLE"
        ? "Legacy bridge runtime is unavailable"
        : code === "SERVICE_SHUTTING_DOWN"
        ? "Service is shutting down"
        : code === "SERVICE_SCHEMA_STANDBY"
        ? "Service is in schema migration standby"
        : code === "SERVICE_RESTART_REQUIRED"
        ? "Service restart is required"
        : "Service database is unavailable",
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
      const configuredRole = options.roleCoordinator?.role();
      if (configuredRole && configuredRole !== "active") {
        rejectUnavailable(
          request,
          response,
          configuredRole === "maintenance"
            ? "SERVICE_MAINTENANCE"
            : "SERVICE_RUNTIME_ROLE_NOT_ACTIVE",
        );
        return;
      }
      try {
        options.roleCoordinator?.assertActive("writer");
      } catch {
        rejectUnavailable(
          request,
          response,
          "SERVICE_ACTIVE_LEASE_UNAVAILABLE",
        );
        return;
      }
      let directory: string;
      try {
        directory = dataDirectory();
      } catch {
        rejectUnavailable(request, response, "SERVICE_DATABASE_UNAVAILABLE");
        return;
      }
      const databasePath = join(directory, "unboundry.sqlite");
      const maintenanceEvidence =
        existsWithoutThrow(join(directory, migrationIncompleteMarker)) ||
        existsWithoutThrow(join(directory, ".unboundry-restore-incomplete"));
      const currentIdentity = observeDatabaseAdmissionIdentity(directory);
      if (databaseIdentityRestartRequired) {
        rejectUnavailable(request, response, "SERVICE_RESTART_REQUIRED");
        return;
      }
      if (
        maintenanceEvidence || !sameDatabaseAdmissionIdentity(
          businessSchemaAdmission?.identity,
          currentIdentity,
        )
      ) businessSchemaAdmission = undefined;
      const admission = businessSchemaAdmission?.probe ?? probeDatabase();
      const finalIdentity = observeDatabaseAdmissionIdentity(directory);
      if (databaseIdentityRestartRequired) {
        rejectUnavailable(request, response, "SERVICE_RESTART_REQUIRED");
        return;
      }
      if (!sameDatabaseAdmissionIdentity(currentIdentity, finalIdentity)) {
        businessSchemaAdmission = undefined;
        rejectUnavailable(request, response, "SERVICE_DATABASE_UNAVAILABLE");
        return;
      }
      if (admission.ok && admission.standby) {
        if (!options.allowLegacySchema37Business) {
          latchSchema37Standby();
          rejectUnavailable(request, response, "SERVICE_SCHEMA_STANDBY");
          return;
        }
        if (!options.legacyRuntimeReadinessGuard?.()) {
          rejectUnavailable(
            request,
            response,
            "SERVICE_LEGACY_RUNTIME_UNAVAILABLE",
          );
          return;
        }
        legacySchema37BusinessActive = true;
      } else if (legacySchema37BusinessActive) {
        // The legacy process is pinned to schema 37 for its entire lifetime.
        // An in-place one-shot migration must never turn it into a current-schema
        // writer; stop and restart through the current engine instead.
        latchSchema37Standby();
        rejectUnavailable(request, response, "SERVICE_RESTART_REQUIRED");
        return;
      }
      if (schema37RestartRequired) {
        rejectUnavailable(request, response, "SERVICE_RESTART_REQUIRED");
        return;
      }
      // A dynamic startup/readiness guard can move from unavailable to ready.
      // Cache only an exact admitted schema bound to the current path identity.
      if (
        admission.ok && !admission.standby && finalIdentity &&
        establishActiveDatabaseIdentity(finalIdentity)
      ) {
        businessSchemaAdmission = Object.freeze({
          identity: finalIdentity,
          probe: admission,
        });
      } else if (
        admission.ok && admission.standby &&
        options.allowLegacySchema37Business && finalIdentity
      ) {
        // Do not cache schema-37 admission: every bridge request reprobes so an
        // externally attempted migration fails closed before reaching v0.5.1.
        businessSchemaAdmission = undefined;
        if (!establishActiveDatabaseIdentity(finalIdentity)) {
          rejectUnavailable(request, response, "SERVICE_RESTART_REQUIRED");
          return;
        }
      }
      if (databaseIdentityRestartRequired) {
        rejectUnavailable(request, response, "SERVICE_RESTART_REQUIRED");
        return;
      }
      if (!admission.ok) {
        rejectUnavailable(request, response, "SERVICE_DATABASE_UNAVAILABLE");
        return;
      }
      if (!finalIdentity) {
        rejectUnavailable(request, response, "SERVICE_DATABASE_UNAVAILABLE");
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
      const directoryStat = lstatSync(directory);
      if (
        !directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
        typeof process.getuid !== "function" ||
        directoryStat.uid !== process.getuid() ||
        (directoryStat.mode & 0o022) !== 0
      ) {
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
      lstatSync(join(directory, migrationIncompleteMarker));
      return { ok: false, code: "DATABASE_MIGRATION_INCOMPLETE" };
    } catch (error) {
      if (
        !error || typeof error !== "object" || !("code" in error) ||
        error.code !== "ENOENT"
      ) return { ok: false, code: "DATABASE_DIRECTORY_UNAVAILABLE" };
    }
    try {
      const fileStat = lstatSync(databasePath);
      if (
        !fileStat.isFile() || fileStat.isSymbolicLink() ||
        fileStat.size === 0 || fileStat.nlink !== 1 ||
        typeof process.getuid !== "function" ||
        fileStat.uid !== process.getuid() || (fileStat.mode & 0o022) !== 0
      ) {
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
        const wal = lstatSync(`${databasePath}-wal`);
        if (
          !wal.isFile() || wal.isSymbolicLink() || wal.nlink !== 1 ||
          typeof process.getuid !== "function" || wal.uid !== process.getuid() ||
          (wal.mode & 0o022) !== 0
        ) return { ok: false, code: "DATABASE_FILE_UNAVAILABLE" };
        walBytes = wal.size;
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
        const shared = lstatSync(`${databasePath}-shm`);
        if (
          !shared.isFile() || shared.isSymbolicLink() || shared.nlink !== 1 ||
          typeof process.getuid !== "function" || shared.uid !== process.getuid() ||
          (shared.mode & 0o022) !== 0
        ) return { ok: false, code: "DATABASE_FILE_UNAVAILABLE" };
        sharedMemoryPresent = true;
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
      if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) {
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
      const userVersion = Number(versionRow?.user_version);
      const expectedManifest = userVersion === 37
        ? currentSchemaManifest.slice(0, 37)
        : currentSchemaManifest;
      if (
        ![37, schemaVersion].includes(userVersion) ||
        ledgerRows.length !== expectedManifest.length ||
        ledgerRows.some((row, index) => (
          Number(row.version) !== expectedManifest[index]?.version ||
          String(row.name) !== expectedManifest[index]?.name
        ))
      ) {
        return { ok: false, code: "DATABASE_SCHEMA_MISMATCH" };
      }
      if (userVersion === 37) {
        if (
          !options.legacyStandbyDatabaseGuard ||
          !options.legacyStandbyDatabaseGuard(database)
        ) return { ok: false, code: "DATABASE_SCHEMA_MISMATCH" };
        return { ok: true, schemaVersion: 37, standby: true };
      }
      if (!databaseMatchesSchemaContract(database)) {
        return { ok: false, code: "DATABASE_SCHEMA_MISMATCH" };
      }
      if (!databaseHasCompleteLegacyMediaMetadata(database)) {
        return { ok: false, code: "DATABASE_SCHEMA_MISMATCH" };
      }
      if (
        options.readinessDatabaseGuard &&
        !options.readinessDatabaseGuard(database)
      ) {
        return { ok: false, code: "DATABASE_UNAVAILABLE" };
      }
      return { ok: true, schemaVersion, standby: false };
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

    const roleSnapshot = options.roleCoordinator?.snapshot();
    if (
      roleSnapshot?.role === "active" &&
      (!roleSnapshot.activeLeaseHeld || roleSnapshot.draining) &&
      roleSnapshot.leaseState !== "unavailable"
    ) {
      context.code = "SERVICE_ACTIVE_LEASE_UNAVAILABLE";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_ACTIVE_LEASE_UNAVAILABLE",
        mode: "active-lease-unavailable",
        mutationsAccepted: false,
        activeLeaseHeld: false,
        databaseProbe: "not-run",
        requestId: context.requestId,
      });
      return;
    }

    let directory: string | undefined;
    try {
      directory = dataDirectory();
    } catch {
      // The ordinary probe below retains the exact directory failure code.
    }
    const initialIdentity = directory
      ? observeDatabaseAdmissionIdentity(directory)
      : undefined;
    const probe = probeDatabase();
    const finalIdentity = directory
      ? observeDatabaseAdmissionIdentity(directory)
      : undefined;
    const identityChangedDuringProbe = !sameDatabaseAdmissionIdentity(
      initialIdentity,
      finalIdentity,
    );
    if (databaseIdentityRestartRequired) {
      context.code = "SERVICE_RESTART_REQUIRED";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_RESTART_REQUIRED",
        mode: "database-restart-required",
        mutationsAccepted: false,
        databaseProbe: "read-only",
        requestId: context.requestId,
      });
      return;
    }
    if (
      probe.ok && probe.standby && !options.allowLegacySchema37Business
    ) latchSchema37Standby();
    if (
      legacySchema37BusinessActive && (!probe.ok || !probe.standby)
    ) latchSchema37Standby();
    if (schema37RestartRequired && (!probe.ok || !probe.standby)) {
      context.code = "SERVICE_RESTART_REQUIRED";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_RESTART_REQUIRED",
        mode: "schema39-restart-required",
        mutationsAccepted: false,
        databaseProbe: "read-only",
        ...(probe.ok ? { schemaVersion: probe.schemaVersion } : {}),
        requestId: context.requestId,
      });
      return;
    }
    if (!probe.ok || identityChangedDuringProbe || !finalIdentity) {
      const code = !probe.ok ? probe.code : "DATABASE_FILE_UNAVAILABLE";
      context.code = code;
      json(response, 503, {
        error: "Service is not ready",
        code,
        requestId: context.requestId,
      });
      return;
    }
    if (
      roleSnapshot?.role === "active" &&
      (!roleSnapshot.activeLeaseHeld || roleSnapshot.draining)
    ) {
      context.code = "SERVICE_ACTIVE_LEASE_UNAVAILABLE";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_ACTIVE_LEASE_UNAVAILABLE",
        mode: "active-lease-unavailable",
        mutationsAccepted: false,
        activeLeaseHeld: false,
        databaseProbe: "read-only",
        schemaVersion: probe.schemaVersion,
        requestId: context.requestId,
      });
      return;
    }
    if (
      roleSnapshot?.role === "standby" ||
      roleSnapshot?.role === "read-only"
    ) {
      context.code = "SERVICE_RUNTIME_ROLE_NOT_ACTIVE";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_RUNTIME_ROLE_NOT_ACTIVE",
        mode: roleSnapshot.role === "standby"
          ? "standby-api-blocked"
          : "read-only-api-blocked",
        mutationsAccepted: false,
        activeLeaseHeld: false,
        runtimeRole: roleSnapshot.role,
        databaseProbe: "read-only",
        schemaVersion: probe.schemaVersion,
        requestId: context.requestId,
      });
      return;
    }
    if (
      probe.standby && options.allowLegacySchema37Business &&
      !options.legacyRuntimeReadinessGuard?.()
    ) {
      context.code = "SERVICE_LEGACY_RUNTIME_UNAVAILABLE";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_LEGACY_RUNTIME_UNAVAILABLE",
        mode: "schema37-bridge-unavailable",
        mutationsAccepted: false,
        activeLeaseHeld: roleSnapshot?.activeLeaseHeld ?? false,
        databaseProbe: "read-only",
        schemaVersion: probe.schemaVersion,
        requestId: context.requestId,
      });
      return;
    }
    if (
      (!probe.standby || options.allowLegacySchema37Business) &&
      !establishActiveDatabaseIdentity(finalIdentity)
    ) {
      context.code = "SERVICE_RESTART_REQUIRED";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_RESTART_REQUIRED",
        mode: "database-restart-required",
        mutationsAccepted: false,
        databaseProbe: "read-only",
        schemaVersion: probe.schemaVersion,
        requestId: context.requestId,
      });
      return;
    }
    if (probe.standby && options.allowLegacySchema37Business) {
      legacySchema37BusinessActive = true;
    }
    // The schema probe and logical guards above precede the active latch. Close
    // the last path-replacement window before advertising readiness.
    if (
      directory && !sameDatabaseAdmissionIdentity(
        finalIdentity,
        observeDatabaseAdmissionIdentity(directory),
      )
    ) {
      context.code = "SERVICE_RESTART_REQUIRED";
      response.setHeader("Retry-After", String(retryAfterSeconds));
      json(response, 503, {
        status: "not-ready",
        code: "SERVICE_RESTART_REQUIRED",
        mode: "database-restart-required",
        mutationsAccepted: false,
        databaseProbe: "read-only",
        requestId: context.requestId,
      });
      return;
    }

    json(response, 200, {
      status: "ready",
      mode: probe.standby
        ? options.allowLegacySchema37Business
          ? "schema37-bridge-active"
          : "schema37-health-only-standby"
        : maintenance || roleSnapshot?.role === "maintenance"
        ? "maintenance-api-blocked"
        : "active",
      mutationsAccepted:
        !maintenance && (!probe.standby ||
          Boolean(options.allowLegacySchema37Business)) &&
        (!roleSnapshot || (
          roleSnapshot.role === "active" && roleSnapshot.activeLeaseHeld &&
          !roleSnapshot.draining
        )),
      ...(roleSnapshot
        ? {
            activeLeaseHeld: roleSnapshot.activeLeaseHeld,
            runtimeRole: roleSnapshot.role,
          }
        : {}),
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
    const boundedDeadline = boundedInteger(
      deadlineMs,
      shutdownDeadlineMs,
      120_000,
    );
    const shutdownStartedAt = Date.now();
    // Freeze both HTTP and detached writer/Provider admission before asking
    // streams or current handlers to settle. The active lease is deliberately
    // released only after both drain domains report zero.
    const detachedDrain = options.roleCoordinator?.beginDrain(boundedDeadline);
    writeLog("lifecycle", { code: "SHUTDOWN_STARTED" });
    notifyStreams({ type: "shutdown", retryAfterSeconds });
    shutdownPromise = Promise.all([
      waitForDrain(boundedDeadline),
      detachedDrain ?? Promise.resolve({ activeExecutions: 0, drained: true }),
    ]).then(async ([result, detached]) => {
      const combined = detached.drained
        ? result
        : { ...result, drained: false };
      if (combined.drained) {
        const remainingDeadlineMs = Math.max(
          0,
          boundedDeadline - (Date.now() - shutdownStartedAt),
        );
        await options.beforeActiveLeaseRelease?.(remainingDeadlineMs);
        options.roleCoordinator?.releaseAfterDrain();
      }
      writeLog("lifecycle", {
        code: combined.drained ? "SHUTDOWN_DRAINED" : "SHUTDOWN_DEADLINE",
      });
      return combined;
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
    observeStartupDatabaseProbe,
    middleware,
    probeDatabase,
    registerStreamCloser,
    requireRestartAfterStartupSchemaMigration,
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
  let forceClosed = false;
  const forceClose = () => {
    if (forceClosed) return;
    forceClosed = true;
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
          if (!result.drained) {
            forceClose();
            throw new Error("Runtime shutdown did not drain");
          }
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
  } catch (error) {
    forceClose();
    try {
      options.reportFailure?.(boundedShutdownFailureDiagnostic(error));
    } catch {
      // A diagnostic sink cannot weaken the authoritative hard-stop result.
    }
    return 1;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
