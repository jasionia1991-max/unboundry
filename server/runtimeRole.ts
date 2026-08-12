import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const runtimeRoles = Object.freeze([
  "active",
  "standby",
  "maintenance",
  "read-only",
] as const);

export type RuntimeRole = (typeof runtimeRoles)[number];

export type RuntimeRoleCapability =
  | "database-initialize"
  | "generation-worker"
  | "provider-request"
  | "writer";

export type RuntimeRoleErrorCode =
  | "RUNTIME_ACTIVE_LEASE_LOST"
  | "RUNTIME_ACTIVE_LEASE_RELEASE_UNKNOWN"
  | "RUNTIME_ACTIVE_LEASE_UNAVAILABLE"
  | "RUNTIME_DRAIN_TIMEOUT"
  | "RUNTIME_ROLE_DRAINING"
  | "RUNTIME_ROLE_INVALID"
  | "RUNTIME_ROLE_NOT_ACTIVE"
  | "RUNTIME_ROLE_PATH_UNSAFE";

export class RuntimeRoleError extends Error {
  readonly code: RuntimeRoleErrorCode;

  constructor(code: RuntimeRoleErrorCode, message: string) {
    super(message);
    this.name = "RuntimeRoleError";
    this.code = code;
  }
}

type OwnedDirectoryIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  mode: bigint;
  uid: bigint;
}>;

type OwnedFileIdentity = OwnedDirectoryIdentity & Readonly<{
  nlink: bigint;
}>;

export type RuntimeRoleCoordinatorOptions = Readonly<{
  dataDirectory: string;
  role?: RuntimeRole;
  runtimeDirectory?: string;
}>;

export type RuntimeRoleSnapshot = Readonly<{
  activeLeaseHeld: boolean;
  draining: boolean;
  leaseState: "held" | "lost" | "released" | "release-unknown";
  role: RuntimeRole;
  runtimeDirectory?: string;
}>;

export type RuntimeDrainResult = Readonly<{
  activeExecutions: number;
  drained: boolean;
}>;

type RuntimeDrainEntry = Readonly<{
  abort?: () => void;
  promise: Promise<void>;
}>;

export type RuntimeDrainRegistry = ReturnType<
  typeof createRuntimeDrainRegistry
>;

function fail(code: RuntimeRoleErrorCode, message: string): never {
  throw new RuntimeRoleError(code, message);
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("RUNTIME_ROLE_PATH_UNSAFE", "Runtime roles require POSIX ownership checks");
  }
  return BigInt(process.getuid());
}

function exactAbsolutePath(path: string, label: string) {
  if (!path || !isAbsolute(path) || resolve(path) !== path) {
    fail("RUNTIME_ROLE_PATH_UNSAFE", `${label} must be a normalized absolute path`);
  }
  return path;
}

function pathContains(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" || (
    difference !== ".." && !difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(difference)
  );
}

function assertDisjointDirectories(dataDirectory: string, runtimeDirectory: string) {
  const canonicalData = realpathSync(dataDirectory);
  const canonicalRuntime = realpathSync(runtimeDirectory);
  if (
    pathContains(dataDirectory, runtimeDirectory) ||
    pathContains(runtimeDirectory, dataDirectory) ||
    pathContains(canonicalData, canonicalRuntime) ||
    pathContains(canonicalRuntime, canonicalData)
  ) {
    fail(
      "RUNTIME_ROLE_PATH_UNSAFE",
      "Runtime and persistent data directories must not overlap",
    );
  }
}

function assertDirectory(
  path: string,
  options: Readonly<{ privateMode?: boolean; requireCurrentOwner?: boolean }> = {},
) {
  let details: BigIntStats;
  try {
    details = lstatSync(path, { bigint: true });
  } catch {
    fail("RUNTIME_ROLE_PATH_UNSAFE", "Runtime role directory is unavailable");
  }
  if (
    details.isSymbolicLink() || !details.isDirectory() ||
    (options.requireCurrentOwner !== false && details.uid !== currentUid()) ||
    (details.mode & 0o022n) !== 0n ||
    (options.privateMode && (details.mode & 0o777n) !== 0o700n)
  ) {
    fail("RUNTIME_ROLE_PATH_UNSAFE", "Runtime role directory is unsafe");
  }
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    uid: details.uid,
  });
}

function assertLeaseFile(path: string) {
  let details: BigIntStats;
  try {
    details = lstatSync(path, { bigint: true });
  } catch {
    fail("RUNTIME_ROLE_PATH_UNSAFE", "Runtime active lease file is unavailable");
  }
  if (
    details.isSymbolicLink() || !details.isFile() || details.uid !== currentUid() ||
    details.nlink !== 1n || (details.mode & 0o777n) !== 0o600n ||
    details.size > 64n * 1024n
  ) {
    fail("RUNTIME_ROLE_PATH_UNSAFE", "Runtime active lease file is unsafe");
  }
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    nlink: details.nlink,
    uid: details.uid,
  });
}

function sameDirectoryIdentity(
  left: OwnedDirectoryIdentity,
  right: OwnedDirectoryIdentity,
) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.uid === right.uid;
}

function sameFileIdentity(left: OwnedFileIdentity, right: OwnedFileIdentity) {
  return sameDirectoryIdentity(left, right) && left.nlink === right.nlink;
}

function syncDirectory(path: string) {
  const descriptor = openSync(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function ensureRuntimeDirectory(path: string) {
  const parent = dirname(path);
  // The runtime directory may be owned by the service account even when its
  // parent is root-owned (for example systemd RuntimeDirectory under /run).
  assertDirectory(parent, { requireCurrentOwner: false });
  try {
    mkdirSync(path, { mode: 0o700 });
    syncDirectory(parent);
  } catch (error) {
    if (
      !error || typeof error !== "object" || !("code" in error) ||
      error.code !== "EEXIST"
    ) throw error;
  }
  return assertDirectory(path, { privateMode: true });
}

function defaultRuntimeDirectory(dataDirectory: string) {
  const digest = createHash("sha256")
    .update(realpathSync(dataDirectory))
    .digest("hex")
    .slice(0, 20);
  return join(dirname(dataDirectory), `.unboundry-runtime-${digest}`);
}

function createLeaseFile(path: string) {
  const noFollow = fileConstants.O_NOFOLLOW ?? 0;
  try {
    const descriptor = openSync(
      path,
      fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_RDWR |
        noFollow,
      0o600,
    );
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    syncDirectory(dirname(path));
  } catch (error) {
    if (
      !error || typeof error !== "object" || !("code" in error) ||
      error.code !== "EEXIST"
    ) throw error;
  }
  return assertLeaseFile(path);
}

function exactLeaseSchema(database: DatabaseSync) {
  const objects = database.prepare(`
    SELECT name, type
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as Array<{ name?: unknown; type?: unknown }>;
  if (objects.length === 0) return "empty" as const;
  if (
    objects.length !== 1 || objects[0]?.type !== "table" ||
    objects[0]?.name !== "runtime_role_contract"
  ) return "invalid" as const;
  const columns = database.prepare(`
    PRAGMA table_xinfo("runtime_role_contract")
  `).all() as Array<{
    hidden?: unknown;
    name?: unknown;
    notnull?: unknown;
    pk?: unknown;
    type?: unknown;
  }>;
  if (
    columns.length !== 3 ||
    String(columns[0]?.name) !== "id" || String(columns[0]?.type) !== "INTEGER" ||
    Number(columns[0]?.pk) !== 1 || Number(columns[0]?.hidden) !== 0 ||
    String(columns[1]?.name) !== "format" || String(columns[1]?.type) !== "TEXT" ||
    Number(columns[1]?.notnull) !== 1 || Number(columns[1]?.hidden) !== 0 ||
    String(columns[2]?.name) !== "version" || String(columns[2]?.type) !== "INTEGER" ||
    Number(columns[2]?.notnull) !== 1 || Number(columns[2]?.hidden) !== 0
  ) return "invalid" as const;
  const rows = database.prepare(`
    SELECT id, format, version FROM runtime_role_contract
  `).all() as Array<{ format?: unknown; id?: unknown; version?: unknown }>;
  return rows.length === 1 && Number(rows[0]?.id) === 1 &&
      rows[0]?.format === "unboundry-runtime-role-lease" &&
      Number(rows[0]?.version) === 1
    ? "current" as const
    : "invalid" as const;
}

function acquireSqliteLease(path: string) {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { timeout: 0 });
    database.exec("PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE;");
    database.exec("BEGIN IMMEDIATE");
    const schema = exactLeaseSchema(database);
    if (schema === "invalid") {
      fail("RUNTIME_ROLE_PATH_UNSAFE", "Runtime active lease contract is invalid");
    }
    if (schema === "empty") {
      database.exec(`
        CREATE TABLE runtime_role_contract (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          format TEXT NOT NULL CHECK (format = 'unboundry-runtime-role-lease'),
          version INTEGER NOT NULL CHECK (version = 1)
        ) STRICT;
        INSERT INTO runtime_role_contract (id, format, version)
        VALUES (1, 'unboundry-runtime-role-lease', 1);
        COMMIT;
      `);
      // The schema initialization commit deliberately does not claim active
      // ownership. Reacquire the OS-backed SQLite write lock; if another
      // process wins this tiny race, this process fails closed.
      database.exec("BEGIN IMMEDIATE");
    }
    if (!database.isTransaction || exactLeaseSchema(database) !== "current") {
      fail("RUNTIME_ROLE_PATH_UNSAFE", "Runtime active lease was not established");
    }
    return database;
  } catch (error) {
    try {
      database?.close();
    } catch {}
    if (error instanceof RuntimeRoleError) throw error;
    fail(
      "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
      "Another active runtime already owns the writer and generation worker lease",
    );
  }
}

export function runtimeRoleFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeRole {
  const raw = environment.UNBOUNDRY_RUNTIME_ROLE;
  const maintenance = environment.UNBOUNDRY_MAINTENANCE_MODE;
  if (
    maintenance !== undefined && maintenance !== "0" && maintenance !== "1"
  ) {
    fail(
      "RUNTIME_ROLE_INVALID",
      "UNBOUNDRY_MAINTENANCE_MODE must be exactly 0 or 1",
    );
  }
  const role = raw === undefined
    ? maintenance === "1"
      ? "maintenance"
      : "active"
    : raw;
  if (!runtimeRoles.includes(role as RuntimeRole)) {
    fail("RUNTIME_ROLE_INVALID", "UNBOUNDRY_RUNTIME_ROLE is invalid");
  }
  if (
    maintenance === "1" && role !== "maintenance"
  ) {
    fail(
      "RUNTIME_ROLE_INVALID",
      "UNBOUNDRY_MAINTENANCE_MODE conflicts with UNBOUNDRY_RUNTIME_ROLE",
    );
  }
  return role as RuntimeRole;
}

export function createRuntimeRoleCoordinator(
  options: RuntimeRoleCoordinatorOptions,
) {
  const role = options.role ?? runtimeRoleFromEnvironment();
  if (!runtimeRoles.includes(role)) {
    fail("RUNTIME_ROLE_INVALID", "Runtime role is invalid");
  }
  const dataDirectory = exactAbsolutePath(options.dataDirectory, "Data directory");
  const dataIdentity = assertDirectory(dataDirectory);
  const drainRegistry = createRuntimeDrainRegistry();
  let drainTimedOut = false;
  let leaseDatabase: DatabaseSync | undefined;
  let leaseIdentity: OwnedFileIdentity | undefined;
  let leaseState: RuntimeRoleSnapshot["leaseState"] = role === "active"
    ? "held"
    : "released";
  let runtimeDirectory: string | undefined;
  let runtimeIdentity: OwnedDirectoryIdentity | undefined;

  if (role === "active") {
    runtimeDirectory = exactAbsolutePath(
      options.runtimeDirectory ?? defaultRuntimeDirectory(dataDirectory),
      "Runtime directory",
    );
    if (
      pathContains(dataDirectory, runtimeDirectory) ||
      pathContains(runtimeDirectory, dataDirectory)
    ) {
      fail(
        "RUNTIME_ROLE_PATH_UNSAFE",
        "Runtime and persistent data directories must not overlap",
      );
    }
    runtimeIdentity = ensureRuntimeDirectory(runtimeDirectory);
    assertDisjointDirectories(dataDirectory, runtimeDirectory);
    const leasePath = join(runtimeDirectory, "active-role.sqlite");
    leaseIdentity = createLeaseFile(leasePath);
    leaseDatabase = acquireSqliteLease(leasePath);
    const finalRuntimeIdentity = assertDirectory(runtimeDirectory, {
      privateMode: true,
    });
    const finalLeaseIdentity = assertLeaseFile(leasePath);
    if (
      !sameDirectoryIdentity(runtimeIdentity, finalRuntimeIdentity) ||
      !sameFileIdentity(leaseIdentity, finalLeaseIdentity)
    ) {
      try {
        leaseDatabase.close();
      } catch {}
      fail("RUNTIME_ACTIVE_LEASE_LOST", "Runtime active lease path changed");
    }
  }

  function assertPathIdentities() {
    if (role !== "active" || leaseState !== "held") {
      fail("RUNTIME_ACTIVE_LEASE_LOST", "Runtime active lease is not held");
    }
    try {
      if (!sameDirectoryIdentity(dataIdentity, assertDirectory(dataDirectory))) {
        throw new Error("Persistent data directory changed");
      }
      if (!runtimeDirectory || !runtimeIdentity || !leaseIdentity || !leaseDatabase) {
        throw new Error("Runtime active lease is unavailable");
      }
      if (!leaseDatabase.isTransaction) {
        throw new Error("Runtime active SQLite lease was released");
      }
      const currentRuntime = assertDirectory(runtimeDirectory, { privateMode: true });
      const currentLease = assertLeaseFile(join(runtimeDirectory, "active-role.sqlite"));
      if (
        !sameDirectoryIdentity(runtimeIdentity, currentRuntime) ||
        !sameFileIdentity(leaseIdentity, currentLease)
      ) {
        throw new Error("Runtime active lease identity changed");
      }
      assertDisjointDirectories(dataDirectory, runtimeDirectory);
    } catch {
      leaseState = "lost";
      drainRegistry.freezeAdmission();
      fail("RUNTIME_ACTIVE_LEASE_LOST", "Runtime active lease identity changed");
    }
  }

  function assertActive(capability: RuntimeRoleCapability) {
    if (role !== "active" || leaseState !== "held") {
      fail(
        "RUNTIME_ROLE_NOT_ACTIVE",
        `${capability} requires the exclusive active runtime role`,
      );
    }
    if (drainRegistry.isDraining()) {
      fail("RUNTIME_ROLE_DRAINING", `${capability} is frozen while runtime drains`);
    }
    assertPathIdentities();
  }

  function beginDrain() {
    if (role === "active" && leaseState === "held") {
      assertPathIdentities();
    }
    drainRegistry.freezeAdmission();
    return snapshot();
  }

  function snapshot(): RuntimeRoleSnapshot {
    if (role === "active" && leaseState === "held") {
      try {
        assertPathIdentities();
      } catch {
        // A snapshot is observational: identity loss is latched and reported
        // instead of surfacing a stale positive lease claim.
      }
    }
    return Object.freeze({
      activeLeaseHeld: role === "active" && leaseState === "held",
      draining: drainRegistry.isDraining(),
      leaseState,
      role,
      ...(runtimeDirectory ? { runtimeDirectory } : {}),
    });
  }

  function releaseLease() {
    if (leaseState === "released") return;
    if (leaseState === "lost") {
      fail(
        "RUNTIME_ACTIVE_LEASE_LOST",
        "A runtime that lost path identity must exit without handing off active",
      );
    }
    if (leaseState === "release-unknown") {
      fail(
        "RUNTIME_ACTIVE_LEASE_RELEASE_UNKNOWN",
        "Runtime active lease release is indeterminate; the process must exit",
      );
    }
    try {
      leaseDatabase?.close();
    } catch {
      leaseState = "release-unknown";
      drainRegistry.freezeAdmission();
      fail(
        "RUNTIME_ACTIVE_LEASE_RELEASE_UNKNOWN",
        "Runtime active lease release is indeterminate; the process must exit",
      );
    }
    leaseState = "released";
    leaseDatabase = undefined;
  }

  function close() {
    if (leaseState === "released") return;
    drainRegistry.freezeAdmission();
    if (drainTimedOut) {
      fail(
        "RUNTIME_DRAIN_TIMEOUT",
        "A timed-out runtime must exit without releasing active to another process",
      );
    }
    if (drainRegistry.size() !== 0) {
      fail(
        "RUNTIME_ROLE_DRAINING",
        "Runtime active lease cannot be released while executions remain",
      );
    }
    releaseLease();
  }

  async function shutdown(deadlineMs: number) {
    if (role === "active" && leaseState === "held") assertPathIdentities();
    const drained = await drainRegistry.beginDrain(deadlineMs);
    if (!drained.drained || drained.activeExecutions !== 0) {
      drainTimedOut = true;
      fail(
        "RUNTIME_DRAIN_TIMEOUT",
        "Runtime drain timed out; the process must exit without handing off active",
      );
    }
    releaseLease();
    return Object.freeze({ ...drained, leaseReleased: true });
  }

  function runDetached<T>(
    capability: RuntimeRoleCapability,
    start: () => Promise<T> | T,
    abort?: () => void,
  ) {
    assertActive(capability);
    return drainRegistry.run(() => {
      assertPathIdentities();
      return start();
    }, abort);
  }

  return Object.freeze({
    assertActive,
    beginDrain,
    close,
    role: () => role,
    runDetached,
    shutdown,
    snapshot,
  });
}

export type RuntimeRoleCoordinator = ReturnType<
  typeof createRuntimeRoleCoordinator
>;

/**
 * Tracks detached work that must not outlive an active runtime lease. Calling
 * beginDrain first closes admission, then aborts every registered operation,
 * and finally waits until the shared deadline. It never retries an operation.
 */
export function createRuntimeDrainRegistry() {
  const entries = new Map<symbol, RuntimeDrainEntry>();
  let draining = false;
  let drainPromise: Promise<RuntimeDrainResult> | undefined;

  function freezeAdmission() {
    draining = true;
  }

  function run<T>(
    start: () => Promise<T> | T,
    abort?: () => void,
  ): Promise<T> {
    if (draining) {
      fail("RUNTIME_ROLE_DRAINING", "Detached work cannot start while runtime drains");
    }
    const key = Symbol("runtime-drain-entry");
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    entries.set(key, Object.freeze({ abort, promise: settled }));
    let execution: Promise<T>;
    try {
      // Registration intentionally precedes invocation. No Provider request or
      // persistent mutation can start in the untracked gap forbidden here.
      execution = Promise.resolve(start());
    } catch (error) {
      entries.delete(key);
      resolveSettled();
      return Promise.reject(error);
    }
    void execution.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      entries.delete(key);
      resolveSettled();
    });
    return execution;
  }

  function beginDrain(deadlineMs: number): Promise<RuntimeDrainResult> {
    if (drainPromise) return drainPromise;
    freezeAdmission();
    const boundedDeadline = Number.isFinite(deadlineMs)
      ? Math.min(120_000, Math.max(0, Math.trunc(deadlineMs)))
      : 10_000;
    const current = [...entries.values()];
    for (const entry of current) {
      try {
        entry.abort?.();
      } catch {
        // The operation promise remains authoritative for drain completion.
      }
    }
    drainPromise = (async () => {
      if (entries.size === 0) {
        return Object.freeze({ activeExecutions: 0, drained: true });
      }
      let timer: NodeJS.Timeout | undefined;
      const completed = Promise.allSettled(current.map((entry) => entry.promise))
        .then(() => true);
      const drained = await Promise.race([
        completed,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), boundedDeadline);
        }),
      ]);
      if (timer) clearTimeout(timer);
      return Object.freeze({
        activeExecutions: entries.size,
        drained: drained && entries.size === 0,
      });
    })();
    return drainPromise;
  }

  return Object.freeze({
    beginDrain,
    freezeAdmission,
    isDraining: () => draining,
    run,
    size: () => entries.size,
  });
}
