import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  createLegacyRuntimeLauncher,
  LegacyRuntimeTerminationUnknownError,
  type LegacyRuntimeLauncher,
  type LegacyRuntimeProcess,
  type LegacyRuntimeTarget,
} from "./legacyRuntimeLauncher.ts";

const defaultShutdownDeadlineMs = 10_000;
const generationDrainPollMs = 100;

export type LegacyRuntimeSupervisorState =
  | "failed"
  | "idle"
  | "ready"
  | "starting"
  | "stopped"
  | "stopping";

export type LegacyRuntimeSupervisorOptions = Readonly<{
  activeGenerationTasks?: () => number;
  dataDirectory: string;
  legacyMediaMetadataComplete?: () => boolean;
  launcher?: LegacyRuntimeLauncher;
  legacyRoot: string;
  runtimeDirectory: string;
  shutdownDeadlineMs?: number;
}>;

function boundedDeadline(value: number | undefined, allowZero = false) {
  if (!Number.isFinite(value)) return defaultShutdownDeadlineMs;
  return Math.min(
    120_000,
    Math.max(allowZero ? 0 : 1_000, Math.trunc(value!)),
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function childHasExited(runtime: LegacyRuntimeProcess) {
  return runtime.child.exitCode !== null || runtime.child.signalCode !== null;
}

/**
 * The exact runtime starts Provider work outside the lifetime of its enqueue
 * HTTP response. Its durable task state is therefore the conservative drain
 * boundary: the parent freezes HTTP first, then waits until no active task is
 * left before asking Vite to close and releasing the active lease.
 */
type LegacyFileFingerprint = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  size: bigint;
  uid: bigint;
}>;

type LegacyDatabaseFingerprint = Readonly<{
  database: LegacyFileFingerprint;
  directory: LegacyFileFingerprint;
  shm?: LegacyFileFingerprint;
  wal?: LegacyFileFingerprint;
}>;

function fixedFingerprint(path: string, kind: "directory" | "file") {
  const details = lstatSync(path, { bigint: true });
  if (
    details.isSymbolicLink() ||
    (kind === "directory" ? !details.isDirectory() : !details.isFile()) ||
    (kind === "file" && details.nlink !== 1n) ||
    typeof process.getuid !== "function" ||
    details.uid !== BigInt(process.getuid()) || (details.mode & 0o022n) !== 0n
  ) throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  return Object.freeze({
    ctimeNs: details.ctimeNs,
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    mtimeNs: details.mtimeNs,
    nlink: details.nlink,
    size: details.size,
    uid: details.uid,
  });
}

function optionalFingerprint(path: string) {
  try {
    return fixedFingerprint(path, "file");
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
}

function sameFingerprint(
  left: LegacyFileFingerprint | undefined,
  right: LegacyFileFingerprint | undefined,
  contentMetadata = true,
) {
  return Boolean(
    left && right && left.dev === right.dev && left.ino === right.ino &&
      left.uid === right.uid && left.mode === right.mode &&
      left.nlink === right.nlink && (!contentMetadata || (
        left.size === right.size && left.mtimeNs === right.mtimeNs &&
        left.ctimeNs === right.ctimeNs
      )),
  ) || (!left && !right);
}

function databaseFingerprint(dataDirectory: string): LegacyDatabaseFingerprint {
  if (realpathSync(dataDirectory) !== dataDirectory) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  if (optionalFingerprint(`${databasePath}-journal`)) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  const wal = optionalFingerprint(`${databasePath}-wal`);
  const shm = optionalFingerprint(`${databasePath}-shm`);
  if (Boolean(wal) !== Boolean(shm)) {
    throw new Error("LEGACY_RUNTIME_DATABASE_UNSAFE");
  }
  return Object.freeze({
    database: fixedFingerprint(databasePath, "file"),
    directory: fixedFingerprint(dataDirectory, "directory"),
    ...(shm ? { shm } : {}),
    ...(wal ? { wal } : {}),
  });
}

function sameDatabaseFingerprint(
  before: LegacyDatabaseFingerprint,
  after: LegacyDatabaseFingerprint,
) {
  // SQLite may update lock/WAL-index bytes in an existing SHM file during a
  // coordinated read. Its physical identity remains pinned; DB and WAL content
  // metadata must remain unchanged for the active-task observation itself.
  return sameFingerprint(before.directory, after.directory) &&
    sameFingerprint(before.database, after.database) &&
    sameFingerprint(before.wal, after.wal) &&
    sameFingerprint(
      before.shm,
      after.shm,
      !before.wal || before.wal.size === 0n,
    );
}

export function inspectLegacyActiveGenerationTasks(dataDirectory: string) {
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const before = databaseFingerprint(dataDirectory);
  const location = before.wal && before.wal.size > 0n
    ? databasePath
    : `${pathToFileURL(databasePath).href}?immutable=1`;
  const database = new DatabaseSync(location, { readOnly: true, timeout: 1_000 });
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
    const version = database.prepare("PRAGMA user_version").get() as
      | { user_version?: unknown }
      | undefined;
    if (Number(version?.user_version) !== 37) {
      throw new Error("LEGACY_RUNTIME_SCHEMA_CHANGED");
    }
    const row = database.prepare(`
      SELECT COUNT(*) AS active
      FROM generation_tasks
      WHERE state IN ('queued', 'running', 'recovering', 'retrying')
    `).get() as { active?: unknown } | undefined;
    const active = Number(row?.active);
    if (!Number.isSafeInteger(active) || active < 0) {
      throw new Error("LEGACY_RUNTIME_TASK_STATE_INVALID");
    }
    return active;
  } finally {
    database.close();
    if (!sameDatabaseFingerprint(before, databaseFingerprint(dataDirectory))) {
      throw new Error("LEGACY_RUNTIME_DATABASE_CHANGED");
    }
  }
}

export function inspectLegacyMediaMetadataComplete(dataDirectory: string) {
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const before = databaseFingerprint(dataDirectory);
  const location = before.wal && before.wal.size > 0n
    ? databasePath
    : `${pathToFileURL(databasePath).href}?immutable=1`;
  const database = new DatabaseSync(location, { readOnly: true, timeout: 1_000 });
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
    const version = database.prepare("PRAGMA user_version").get() as
      | { user_version?: unknown }
      | undefined;
    if (Number(version?.user_version) !== 37) {
      throw new Error("LEGACY_RUNTIME_SCHEMA_CHANGED");
    }
    const row = database.prepare(`
      SELECT COUNT(*) AS incomplete
      FROM media_assets
      WHERE storage_status = 'ready'
        AND (
          checksum_sha256 IS NULL
          OR length(checksum_sha256) != 64
          OR checksum_sha256 GLOB '*[^0-9a-f]*'
        )
    `).get() as { incomplete?: unknown } | undefined;
    const incomplete = Number(row?.incomplete);
    if (!Number.isSafeInteger(incomplete) || incomplete < 0) {
      throw new Error("LEGACY_RUNTIME_MEDIA_METADATA_INVALID");
    }
    return incomplete === 0;
  } finally {
    database.close();
    if (!sameDatabaseFingerprint(before, databaseFingerprint(dataDirectory))) {
      throw new Error("LEGACY_RUNTIME_DATABASE_CHANGED");
    }
  }
}

export function createLegacyRuntimeSupervisor(
  options: LegacyRuntimeSupervisorOptions,
) {
  const launcher = options.launcher ?? createLegacyRuntimeLauncher();
  const inspectActiveGenerationTasks = options.activeGenerationTasks ?? (() =>
    inspectLegacyActiveGenerationTasks(options.dataDirectory));
  const inspectMediaMetadataComplete = options.legacyMediaMetadataComplete ??
    (() => inspectLegacyMediaMetadataComplete(options.dataDirectory));
  const shutdownDeadlineMs = boundedDeadline(options.shutdownDeadlineMs);
  let runtime: LegacyRuntimeProcess | undefined;
  let state: LegacyRuntimeSupervisorState = "idle";
  let startPromise: Promise<LegacyRuntimeTarget> | undefined;
  let stopPromise: Promise<void> | undefined;
  let startupTerminationKnown = true;

  function markUnexpectedExit() {
    if (state === "stopping" || state === "stopped") return;
    state = "failed";
  }

  function start() {
    if (startPromise) return startPromise;
    if (state !== "idle") {
      return Promise.reject(new Error(
        "LEGACY_RUNTIME_STATE_INVALID: legacy supervisor cannot restart",
      ));
    }
    state = "starting";
    try {
      if (inspectActiveGenerationTasks() !== 0) {
        state = "failed";
        return Promise.reject(new Error(
          "LEGACY_RUNTIME_ACTIVE_TASKS_PRESENT: drain generation tasks on the exact old runtime before switching to the bridge",
        ));
      }
    } catch (error) {
      state = "failed";
      return Promise.reject(error);
    }
    startPromise = launcher.launch(options.legacyRoot, {
      dataDirectory: options.dataDirectory,
      runtimeDirectory: options.runtimeDirectory,
    }).then(async (launched) => {
      runtime = launched;
      launched.child.once("exit", markUnexpectedExit);
      if (childHasExited(launched)) {
        markUnexpectedExit();
        throw new Error("LEGACY_RUNTIME_EXITED: legacy child exited at readiness");
      }
      if (
        launched.warmup.expectedDatabaseMutation !==
          "legacy-media-checksum-backfill" ||
        launched.warmup.providerRequests !== 0
      ) {
        await abortStartup();
        state = "failed";
        throw new Error(
          "LEGACY_RUNTIME_WARMUP_INVALID: child did not attest the bounded startup write",
        );
      }
      try {
        if (inspectActiveGenerationTasks() !== 0) {
          throw new Error(
            "LEGACY_RUNTIME_ACTIVE_TASKS_PRESENT: legacy startup changed the durable active-task boundary",
          );
        }
        if (!inspectMediaMetadataComplete()) {
          throw new Error(
            "LEGACY_RUNTIME_MEDIA_METADATA_INCOMPLETE: deterministic legacy checksum backfill did not complete",
          );
        }
      } catch (error) {
        try {
          await abortStartup();
        } finally {
          state = "failed";
        }
        throw error;
      }
      state = "ready";
      return launched.target;
    }, (error) => {
      startupTerminationKnown =
        !(error instanceof LegacyRuntimeTerminationUnknownError);
      state = "failed";
      throw error;
    });
    return startPromise;
  }

  function isReady() {
    return state === "ready" && Boolean(runtime) && !childHasExited(runtime!);
  }

  function target() {
    if (!isReady() || !runtime) {
      throw new Error("LEGACY_RUNTIME_UNAVAILABLE: legacy child is not ready");
    }
    return runtime.target;
  }

  function stopChild(
    launched: LegacyRuntimeProcess,
    deadlineAt: number,
  ): Promise<void> {
    if (childHasExited(launched)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      let killIssued = false;
      let confirmationTimeout: NodeJS.Timeout | undefined;
      const complete = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (confirmationTimeout) clearTimeout(confirmationTimeout);
        launched.child.removeListener("exit", onExit);
        launched.child.removeListener("error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onExit = (code: number | null) => {
        if (code === 0 && !killIssued) complete();
        else complete(new Error(
          "LEGACY_RUNTIME_STOP_FAILED: legacy child did not drain cleanly",
        ));
      };
      const onError = () => complete(new Error(
        "LEGACY_RUNTIME_STOP_FAILED: legacy child process failed during shutdown",
      ));
      const remaining = Math.max(1, deadlineAt - Date.now());
      const timeout = setTimeout(() => {
        killIssued = true;
        try {
          launched.child.kill("SIGKILL");
        } catch {
          complete(new Error(
            "LEGACY_RUNTIME_DRAIN_TIMEOUT: legacy child termination could not be requested",
          ));
        }
        // Do not settle until the exit event confirms the OS released the
        // guardian and every exact-old database descriptor.
      }, remaining);
      confirmationTimeout = setTimeout(() => complete(new Error(
        "LEGACY_RUNTIME_TERMINATION_UNKNOWN: killed legacy child exit was not confirmed",
      )), remaining + 5_000);
      confirmationTimeout.unref?.();
      launched.child.once("exit", onExit);
      launched.child.once("error", onError);
      try {
        launched.child.send({ nonce: launched.nonce, type: "shutdown" }, (error) => {
          if (error) complete(new Error(
            "LEGACY_RUNTIME_STOP_FAILED: legacy shutdown IPC failed",
          ));
        });
      } catch {
        complete(new Error(
          "LEGACY_RUNTIME_STOP_FAILED: legacy shutdown IPC was unavailable",
        ));
      }
    });
  }

  function shutdown(deadlineMs = shutdownDeadlineMs) {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (state === "stopped") return;
      state = "stopping";
      const deadlineAt = Date.now() + boundedDeadline(deadlineMs, true);
      let launched = runtime;
      if (!launched && startPromise) {
        try {
          await startPromise;
          launched = runtime;
        } catch {
          state = "failed";
          throw new Error(
            "LEGACY_RUNTIME_STOP_FAILED: legacy startup did not complete cleanly",
          );
        }
      }
      if (!launched) {
        state = "stopped";
        return;
      }
      if (childHasExited(launched)) {
        // An unexpected exit already removed the only legacy writer. HTTP has
        // remained fail-closed since the exit event; lease handoff is now safe
        // even though the durable task rows may need crash recovery next time.
        state = "stopped";
        return;
      }
      while (Date.now() < deadlineAt) {
        if (childHasExited(launched)) break;
        try {
          if (inspectActiveGenerationTasks() === 0) break;
        } catch (error) {
          state = "failed";
          throw error;
        }
        await wait(Math.min(generationDrainPollMs, deadlineAt - Date.now()));
      }
      if (childHasExited(launched)) {
        state = "stopped";
        return;
      }
      if (Date.now() >= deadlineAt) {
        state = "failed";
        throw new Error(
          "LEGACY_RUNTIME_DRAIN_TIMEOUT: active generation tasks did not settle; active lease must remain held",
        );
      }
      await stopChild(launched, deadlineAt);
      state = "stopped";
    })();
    return stopPromise;
  }

  function abortStartup(deadlineMs = shutdownDeadlineMs) {
    if (!runtime) {
      if (!startupTerminationKnown) {
        return Promise.reject(new Error(
          "LEGACY_RUNTIME_TERMINATION_UNKNOWN: active lease must remain held",
        ));
      }
      state = "stopped";
      return Promise.resolve();
    }
    if (childHasExited(runtime)) {
      state = "stopped";
      return Promise.resolve();
    }
    const launched = runtime;
    state = "stopping";
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        launched.child.removeListener("exit", onExit);
        if (error) {
          state = "failed";
          reject(error);
        } else {
          state = "stopped";
          resolve();
        }
      };
      const onExit = () => complete();
      const timeout = setTimeout(() => complete(new Error(
        "LEGACY_RUNTIME_ABORT_TIMEOUT: legacy child exit was not confirmed",
      )), boundedDeadline(deadlineMs));
      launched.child.once("exit", onExit);
      try {
        launched.child.kill("SIGKILL");
      } catch {
        complete(new Error(
          "LEGACY_RUNTIME_ABORT_FAILED: legacy child could not be stopped",
        ));
      }
      if (childHasExited(launched)) complete();
    });
  }

  return Object.freeze({
    abortStartup,
    isReady,
    shutdown,
    start,
    state: () => state,
    target,
  });
}

export type LegacyRuntimeSupervisor = ReturnType<
  typeof createLegacyRuntimeSupervisor
>;
