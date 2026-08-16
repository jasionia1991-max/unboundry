import {
  closeSync,
  constants as fileConstants,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const guardianFileName = "legacy-child-role.sqlite";
const guardianFormat = "unboundry-legacy-child-guardian";

export type LegacyChildGuardianErrorCode =
  | "LEGACY_CHILD_GUARDIAN_LOST"
  | "LEGACY_CHILD_GUARDIAN_RELEASE_UNKNOWN"
  | "LEGACY_CHILD_GUARDIAN_UNAVAILABLE"
  | "LEGACY_CHILD_GUARDIAN_UNSAFE";

export class LegacyChildGuardianError extends Error {
  readonly code: LegacyChildGuardianErrorCode;

  constructor(code: LegacyChildGuardianErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "LegacyChildGuardianError";
    this.code = code;
  }
}

type DirectoryIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  mode: bigint;
  uid: bigint;
}>;

type FileIdentity = DirectoryIdentity & Readonly<{ nlink: bigint }>;

export type LegacyChildGuardian = Readonly<{
  assertHeld: () => void;
  path: string;
  release: () => void;
}>;

function fail(
  code: LegacyChildGuardianErrorCode,
  message: string,
): never {
  throw new LegacyChildGuardianError(code, message);
}

function uid() {
  if (typeof process.getuid !== "function") {
    fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "POSIX ownership is required");
  }
  return BigInt(process.getuid());
}

function exactCanonicalDirectory(path: string, privateMode = false) {
  if (!path || !isAbsolute(path) || resolve(path) !== path) {
    fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "guardian directory is not canonical");
  }
  let canonical: string;
  let details: BigIntStats;
  try {
    canonical = realpathSync(path);
    details = lstatSync(path, { bigint: true });
  } catch {
    fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "guardian directory is unavailable");
  }
  if (
    canonical !== path || details.isSymbolicLink() || !details.isDirectory() ||
    details.uid !== uid() || (details.mode & 0o022n) !== 0n ||
    (privateMode && (details.mode & 0o777n) !== 0o700n)
  ) fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "guardian directory is unsafe");
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    uid: details.uid,
  });
}

function contains(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" || (!isAbsolute(difference) && difference !== ".." &&
    !difference.startsWith(`..${sep}`));
}

function assertDisjoint(dataDirectory: string, runtimeDirectory: string) {
  if (
    contains(dataDirectory, runtimeDirectory) ||
    contains(runtimeDirectory, dataDirectory)
  ) fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "runtime and data directories overlap");
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

function guardianIdentity(path: string): FileIdentity {
  let details: BigIntStats;
  try {
    details = lstatSync(path, { bigint: true });
  } catch {
    fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "guardian lease file is unavailable");
  }
  if (
    details.isSymbolicLink() || !details.isFile() || details.nlink !== 1n ||
    details.uid !== uid() || (details.mode & 0o777n) !== 0o600n ||
    details.size > 64n * 1_024n
  ) fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "guardian lease file is unsafe");
  return Object.freeze({
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    nlink: details.nlink,
    uid: details.uid,
  });
}

function sameDirectory(left: DirectoryIdentity, right: DirectoryIdentity) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.uid === right.uid;
}

function sameFile(left: FileIdentity, right: FileIdentity) {
  return sameDirectory(left, right) && left.nlink === right.nlink;
}

function createGuardianFile(path: string) {
  try {
    const descriptor = openSync(
      path,
      fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_RDWR |
        (fileConstants.O_NOFOLLOW ?? 0),
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
  return guardianIdentity(path);
}

function exactGuardianSchema(database: DatabaseSync) {
  const objects = database.prepare(`
    SELECT name, type FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as Array<{ name?: unknown; type?: unknown }>;
  if (objects.length === 0) return "empty" as const;
  if (
    objects.length !== 1 || objects[0]?.type !== "table" ||
    objects[0]?.name !== "legacy_child_guardian_contract"
  ) return "invalid" as const;
  const columns = database.prepare(`
    PRAGMA table_xinfo("legacy_child_guardian_contract")
  `).all() as Array<{
    hidden?: unknown;
    name?: unknown;
    notnull?: unknown;
    pk?: unknown;
    type?: unknown;
  }>;
  if (
    columns.length !== 3 ||
    String(columns[0]?.name) !== "id" ||
    String(columns[0]?.type) !== "INTEGER" ||
    Number(columns[0]?.pk) !== 1 || Number(columns[0]?.hidden) !== 0 ||
    String(columns[1]?.name) !== "format" ||
    String(columns[1]?.type) !== "TEXT" ||
    Number(columns[1]?.notnull) !== 1 || Number(columns[1]?.pk) !== 0 ||
    Number(columns[1]?.hidden) !== 0 ||
    String(columns[2]?.name) !== "version" ||
    String(columns[2]?.type) !== "INTEGER" ||
    Number(columns[2]?.notnull) !== 1 || Number(columns[2]?.pk) !== 0 ||
    Number(columns[2]?.hidden) !== 0
  ) return "invalid" as const;
  const table = database.prepare(`
    SELECT ncol, strict, type, wr
    FROM pragma_table_list
    WHERE schema = 'main' AND name = 'legacy_child_guardian_contract'
  `).get() as
    | { ncol?: unknown; strict?: unknown; type?: unknown; wr?: unknown }
    | undefined;
  if (
    Number(table?.ncol) !== 3 || Number(table?.strict) !== 1 ||
    table?.type !== "table" || Number(table?.wr) !== 0
  ) return "invalid" as const;
  const rows = database.prepare(`
    SELECT id, format, version FROM legacy_child_guardian_contract
  `).all() as Array<{ format?: unknown; id?: unknown; version?: unknown }>;
  return rows.length === 1 && Number(rows[0]?.id) === 1 &&
      rows[0]?.format === guardianFormat && Number(rows[0]?.version) === 1
    ? "current" as const
    : "invalid" as const;
}

export function acquireLegacyChildGuardian(options: Readonly<{
  dataDirectory: string;
  runtimeDirectory: string;
}>): LegacyChildGuardian {
  const dataIdentity = exactCanonicalDirectory(options.dataDirectory);
  const runtimeIdentity = exactCanonicalDirectory(options.runtimeDirectory, true);
  assertDisjoint(options.dataDirectory, options.runtimeDirectory);
  const path = join(options.runtimeDirectory, guardianFileName);
  const before = createGuardianFile(path);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { timeout: 0 });
    database.exec("PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE;");
    const schema = exactGuardianSchema(database);
    if (schema === "invalid") {
      fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "guardian contract is invalid");
    }
    if (schema === "empty") {
      database.exec(`
        CREATE TABLE legacy_child_guardian_contract (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          format TEXT NOT NULL CHECK (format = '${guardianFormat}'),
          version INTEGER NOT NULL CHECK (version = 1)
        ) STRICT;
        INSERT INTO legacy_child_guardian_contract (id, format, version)
        VALUES (1, '${guardianFormat}', 1);
        COMMIT;
        BEGIN IMMEDIATE;
      `);
    }
    if (!database.isTransaction || exactGuardianSchema(database) !== "current") {
      fail("LEGACY_CHILD_GUARDIAN_UNSAFE", "guardian transaction is not held");
    }
  } catch (error) {
    try {
      database?.close();
    } catch {}
    if (error instanceof LegacyChildGuardianError) throw error;
    fail("LEGACY_CHILD_GUARDIAN_UNAVAILABLE", "another legacy child or migration owns the guardian");
  }

  let state: "held" | "lost" | "release-unknown" | "released" = "held";
  const assertHeld = () => {
    if (state !== "held" || !database?.isTransaction) {
      if (state === "release-unknown") {
        fail("LEGACY_CHILD_GUARDIAN_RELEASE_UNKNOWN", "guardian release is indeterminate");
      }
      fail("LEGACY_CHILD_GUARDIAN_LOST", "guardian transaction is not held");
    }
    try {
      const dataAfter = exactCanonicalDirectory(options.dataDirectory);
      const runtimeAfter = exactCanonicalDirectory(options.runtimeDirectory, true);
      const fileAfter = guardianIdentity(path);
      assertDisjoint(options.dataDirectory, options.runtimeDirectory);
      if (
        !sameDirectory(dataIdentity, dataAfter) ||
        !sameDirectory(runtimeIdentity, runtimeAfter) ||
        !sameFile(before, fileAfter) || exactGuardianSchema(database) !== "current"
      ) throw new Error("identity changed");
    } catch {
      state = "lost";
      fail("LEGACY_CHILD_GUARDIAN_LOST", "guardian path identity changed");
    }
  };
  const release = () => {
    if (state === "released") return;
    assertHeld();
    try {
      database!.exec("ROLLBACK");
      database!.close();
    } catch {
      state = "release-unknown";
      fail("LEGACY_CHILD_GUARDIAN_RELEASE_UNKNOWN", "guardian could not be released safely");
    }
    state = "released";
    database = undefined;
  };
  // Close the open-versus-path replacement window before the caller can
  // import Vite or touch the application database.
  try {
    assertHeld();
  } catch (error) {
    try {
      database?.close();
    } catch {}
    database = undefined;
    throw error;
  }
  return Object.freeze({ assertHeld, path, release });
}
