import { createDecipheriv, createHash, type Hash } from "node:crypto";
import {
  chmodSync,
  constants as fileConstants,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  currentSchemaManifest,
  currentSchemaVersion,
} from "./database.ts";
import { databaseMatchesSchemaContract } from "./runtimeLifecycle.ts";

const providerDocumentAad = Buffer.from(
  "unboundry:provider-profiles:v1",
  "utf8",
);
const storageDocumentAad = Buffer.from(
  "unboundry:storage-profiles:v1",
  "utf8",
);
const accountCredentialAad = Buffer.from(
  "unboundry:account-credentials:v1",
  "utf8",
);
const maximumEncryptedDocumentBytes = 16 * 1024 * 1024;
const maximumEncryptedCredentialBytes = 256 * 1024;
const knownMigrationNames = Object.freeze(
  currentSchemaManifest.map(({ name }) => name),
);

type SqliteValue = bigint | Buffer | null | number | string | Uint8Array;

type SchemaObjectType = "index" | "table" | "trigger" | "view";

export type BackupMigrationLedgerEntry = Readonly<{
  name: string;
  version: number;
}>;

export type BackupTableFingerprint = Readonly<{
  name: string;
  rowCount: string;
  sha256: string;
}>;

export type BackupDatabaseInspection = Readonly<{
  foreignKeyViolations: 0;
  integrityCheck: "ok";
  journalMode: string;
  logicalSha256: string;
  migrationLedger: readonly BackupMigrationLedgerEntry[];
  schema: Readonly<{
    objectCounts: Readonly<Record<SchemaObjectType, number>>;
    sha256: string;
  }>;
  tables: readonly BackupTableFingerprint[];
  userVersion: number;
}>;

export type BackupSecretValidation = Readonly<{
  accountCredentials: number;
  masterKeyPresent: boolean;
  providerDocumentProfiles: number;
  storageDocumentProfiles: number;
}>;

export class BackupInspectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackupInspectionError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BackupInspectionError(code, message);
}

function assertAbsolutePath(path: string, label: string) {
  if (!path || resolve(path) !== path) {
    fail("BACKUP_PATH_INVALID", `${label} must be an absolute normalized path`);
  }
}

function containsPath(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" ||
    (difference !== ".." && !difference.startsWith(`..${sep}`));
}

function assertPrivateInspectionRoot(inspectionRoot: string) {
  assertAbsolutePath(inspectionRoot, "Inspection root");
  let details: ReturnType<typeof lstatSync>;
  try {
    details = lstatSync(inspectionRoot);
  } catch {
    fail("BACKUP_INSPECTION_ROOT_INVALID", "Inspection root is unavailable");
  }
  if (
    details.isSymbolicLink() ||
    !details.isDirectory() ||
    (details.mode & 0o077) !== 0
  ) {
    fail(
      "BACKUP_INSPECTION_ROOT_INVALID",
      "Inspection root must be a private regular directory",
    );
  }
  return realpathSync(inspectionRoot);
}

function assertContainedRegularPath(
  path: string,
  inspectionRoot: string,
  kind: "directory" | "file",
  label: string,
) {
  assertAbsolutePath(path, label);
  const realRoot = assertPrivateInspectionRoot(inspectionRoot);
  let realPath: string;
  try {
    realPath = realpathSync(path);
  } catch {
    fail("BACKUP_INSPECTION_PATH_INVALID", `${label} is unavailable`);
  }
  if (!containsPath(realRoot, realPath)) {
    fail(
      "BACKUP_INSPECTION_PATH_OUTSIDE_ROOT",
      `${label} must stay inside the private inspection root`,
    );
  }
  const rootInput = resolve(inspectionRoot);
  let current = resolve(path);
  while (current !== rootInput) {
    const details = lstatSync(current);
    if (details.isSymbolicLink()) {
      fail("BACKUP_INSPECTION_LINK_REJECTED", `${label} may not use links`);
    }
    current = dirname(current);
    if (!containsPath(rootInput, current)) {
      fail("BACKUP_INSPECTION_PATH_OUTSIDE_ROOT", `${label} escaped its root`);
    }
  }
  const details = lstatSync(path);
  const valid = kind === "file" ? details.isFile() : details.isDirectory();
  if (details.isSymbolicLink() || !valid) {
    fail("BACKUP_INSPECTION_PATH_INVALID", `${label} has the wrong type`);
  }
}

function assertRegularDatabasePath(
  databasePath: string,
  inspectionRoot: string,
) {
  assertAbsolutePath(databasePath, "Database path");
  assertContainedRegularPath(
    databasePath,
    inspectionRoot,
    "file",
    "Database path",
  );
  let details: ReturnType<typeof lstatSync>;
  try {
    details = lstatSync(databasePath);
  } catch {
    fail("BACKUP_DATABASE_UNAVAILABLE", "Backup database is unavailable");
  }
  if (details.isSymbolicLink() || !details.isFile()) {
    fail(
      "BACKUP_DATABASE_FILE_INVALID",
      "Backup database must be a regular non-symbolic file",
    );
  }
  for (const suffix of ["-journal", "-shm", "-wal"]) {
    try {
      lstatSync(`${databasePath}${suffix}`);
      fail(
        "BACKUP_DATABASE_SIDECAR_REJECTED",
        "Inspection requires a standalone SQLite snapshot",
      );
    } catch (error) {
      if (
        error instanceof BackupInspectionError ||
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) throw error;
    }
  }
}

function quoteIdentifier(identifier: string) {
  if (!identifier || identifier.includes("\0")) {
    fail("BACKUP_DATABASE_IDENTIFIER_INVALID", "Invalid SQLite identifier");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function lengthPrefix(length: number) {
  if (!Number.isSafeInteger(length) || length < 0) {
    fail("BACKUP_DATABASE_VALUE_INVALID", "Invalid SQLite value length");
  }
  const result = Buffer.allocUnsafe(8);
  result.writeBigUInt64BE(BigInt(length));
  return result;
}

function typedValue(value: unknown) {
  let tag: number;
  let bytes: Buffer;
  if (value === null) {
    tag = 0;
    bytes = Buffer.alloc(0);
  } else if (typeof value === "bigint") {
    tag = 1;
    bytes = Buffer.from(value.toString(10), "ascii");
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("BACKUP_DATABASE_VALUE_INVALID", "Non-finite SQLite number");
    }
    tag = 2;
    bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
  } else if (typeof value === "string") {
    tag = 3;
    bytes = Buffer.from(value, "utf8");
  } else if (Buffer.isBuffer(value)) {
    tag = 4;
    bytes = value;
  } else if (value instanceof Uint8Array) {
    tag = 4;
    bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else {
    fail("BACKUP_DATABASE_VALUE_INVALID", "Unsupported SQLite value type");
  }
  return Buffer.concat([Buffer.from([tag]), lengthPrefix(bytes.length), bytes]);
}

function updateTypedValue(hash: Hash, value: unknown) {
  let tag: number;
  let bytes: Buffer;
  if (value === null) {
    tag = 0;
    bytes = Buffer.alloc(0);
  } else if (typeof value === "bigint") {
    tag = 1;
    bytes = Buffer.from(value.toString(10), "ascii");
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("BACKUP_DATABASE_VALUE_INVALID", "Non-finite SQLite number");
    }
    tag = 2;
    bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
  } else if (typeof value === "string") {
    tag = 3;
    bytes = Buffer.from(value, "utf8");
  } else if (Buffer.isBuffer(value)) {
    tag = 4;
    bytes = value;
  } else if (value instanceof Uint8Array) {
    tag = 4;
    bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else {
    fail("BACKUP_DATABASE_VALUE_INVALID", "Unsupported SQLite value type");
  }
  hash.update(Buffer.from([tag]));
  hash.update(lengthPrefix(bytes.length));
  hash.update(bytes);
}

function rowSha256(values: readonly unknown[]) {
  const hash = createHash("sha256");
  hash.update(lengthPrefix(values.length));
  for (const value of values) updateTypedValue(hash, value);
  return hash.digest("hex");
}

function hashSortedRows(rows: readonly (readonly unknown[])[]) {
  const rowHashes = rows.map(rowSha256).sort();
  return hashSortedRowDigests(rowHashes);
}

function hashSortedRowDigests(rowHashes: string[]) {
  rowHashes.sort();
  const hash = createHash("sha256");
  hash.update(lengthPrefix(rowHashes.length));
  for (const rowHash of rowHashes) hash.update(Buffer.from(rowHash, "hex"));
  return hash.digest("hex");
}

function statementRows(database: DatabaseSync, sql: string) {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  return statement.all() as unknown as SqliteValue[][];
}

function safeInteger(value: unknown, label: string) {
  if (typeof value !== "bigint" && typeof value !== "number") {
    fail("BACKUP_DATABASE_METADATA_INVALID", `${label} is invalid`);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    fail("BACKUP_DATABASE_METADATA_INVALID", `${label} is invalid`);
  }
  return numeric;
}

function scalar(database: DatabaseSync, sql: string, label: string) {
  const rows = statementRows(database, sql);
  if (rows.length !== 1 || rows[0]?.length !== 1) {
    fail("BACKUP_DATABASE_METADATA_INVALID", `${label} is unavailable`);
  }
  return rows[0][0];
}

function inspectMigrationLedger(
  database: DatabaseSync,
  userVersion: number,
): BackupMigrationLedgerEntry[] {
  const ledgerTable = statementRows(
    database,
    `
      SELECT COUNT(*)
      FROM sqlite_schema
      WHERE type = 'table' AND name = 'schema_migrations'
    `,
  );
  if (ledgerTable[0]?.[0] !== 1n) {
    fail(
      "BACKUP_MIGRATION_LEDGER_MISSING",
      "Database migration ledger is missing",
    );
  }
  const rows = statementRows(
    database,
    "SELECT version, name FROM schema_migrations ORDER BY version",
  );
  if (rows.length !== userVersion) {
    fail(
      "BACKUP_MIGRATION_LEDGER_INCOMPLETE",
      "Database migration ledger does not match user_version",
    );
  }
  if (userVersion > knownMigrationNames.length) {
    fail(
      "BACKUP_MIGRATION_LEDGER_UNKNOWN",
      "Database migration ledger contains an unknown future version",
    );
  }
  return rows.map((row, index) => {
    const version = safeInteger(row[0], "Migration version");
    const name = typeof row[1] === "string" ? row[1] : "";
    if (
      version !== index + 1 ||
      !name.trim() ||
      name !== knownMigrationNames[index]
    ) {
      fail(
        "BACKUP_MIGRATION_LEDGER_INVALID",
        "Database migration ledger is not contiguous",
      );
    }
    return Object.freeze({ name, version });
  });
}

function inspectSchema(database: DatabaseSync) {
  const rows = statementRows(
    database,
    `
      SELECT type, name, tbl_name, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'index', 'trigger', 'view')
      ORDER BY type, name
    `,
  );
  const objectCounts: Record<SchemaObjectType, number> = {
    index: 0,
    table: 0,
    trigger: 0,
    view: 0,
  };
  for (const row of rows) {
    const type = row[0];
    if (
      type !== "index" &&
      type !== "table" &&
      type !== "trigger" &&
      type !== "view"
    ) {
      fail("BACKUP_DATABASE_SCHEMA_INVALID", "Unknown SQLite schema object");
    }
    objectCounts[type] += 1;
  }
  return Object.freeze({
    objectCounts: Object.freeze(objectCounts),
    sha256: hashSortedRows(rows),
  });
}

function inspectTables(
  database: DatabaseSync,
  inspectionRoot: string,
): BackupTableFingerprint[] {
  const tableNames = statementRows(
    database,
    `
      SELECT name
      FROM sqlite_schema
      WHERE
        type = 'table'
        AND (name NOT LIKE 'sqlite_%' OR name = 'sqlite_sequence')
      ORDER BY name
    `,
  ).map((row) => {
    if (typeof row[0] !== "string") {
      fail("BACKUP_DATABASE_SCHEMA_INVALID", "Invalid SQLite table name");
    }
    return row[0];
  });

  const sortRoot = mkdtempSync(join(inspectionRoot, ".backup-row-sort-"));
  chmodSync(sortRoot, 0o700);
  let sorter: DatabaseSync | undefined;
  try {
    sorter = new DatabaseSync(join(sortRoot, "rows.sqlite"));
    sorter.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = FILE;
      CREATE TABLE row_digests (digest BLOB NOT NULL);
    `);
    const insert = sorter.prepare(
      "INSERT INTO row_digests (digest) VALUES (?)",
    );
    return tableNames.map((name) => {
      sorter!.exec("DELETE FROM row_digests; BEGIN IMMEDIATE");
      let committed = false;
      let rowCount = 0n;
      try {
        const statement = database.prepare(
          `SELECT * FROM ${quoteIdentifier(name)}`,
        );
        statement.setReadBigInts(true);
        statement.setReturnArrays(true);
        for (const row of statement.iterate() as Iterable<unknown[]>) {
          insert.run(Buffer.from(rowSha256(row), "hex"));
          rowCount += 1n;
        }
        sorter!.exec("COMMIT");
        committed = true;
      } finally {
        if (!committed && sorter!.isTransaction) sorter!.exec("ROLLBACK");
      }
      const hash = createHash("sha256");
      hash.update(lengthPrefix(Number(rowCount)));
      const sorted = sorter!.prepare(
        "SELECT digest FROM row_digests ORDER BY digest",
      );
      sorted.setReturnArrays(true);
      for (const row of sorted.iterate() as Iterable<unknown[]>) {
        const digest = row[0];
        if (
          (!(Buffer.isBuffer(digest) || digest instanceof Uint8Array)) ||
          digest.byteLength !== 32
        ) {
          fail("BACKUP_DATABASE_VALUE_INVALID", "Invalid row digest");
        }
        hash.update(digest);
      }
      return Object.freeze({
        name,
        rowCount: rowCount.toString(10),
        sha256: hash.digest("hex"),
      });
    });
  } finally {
    sorter?.close();
    rmSync(sortRoot, { force: true, recursive: true });
  }
}

function logicalSha256(input: {
  migrationLedger: readonly BackupMigrationLedgerEntry[];
  schema: BackupDatabaseInspection["schema"];
  tables: readonly BackupTableFingerprint[];
  userVersion: number;
}) {
  const hash = createHash("sha256");
  hash.update(typedValue(BigInt(input.userVersion)));
  for (const migration of input.migrationLedger) {
    hash.update(typedValue(BigInt(migration.version)));
    hash.update(typedValue(migration.name));
  }
  hash.update(Buffer.from(input.schema.sha256, "hex"));
  for (const table of input.tables) {
    hash.update(typedValue(table.name));
    hash.update(typedValue(BigInt(table.rowCount)));
    hash.update(Buffer.from(table.sha256, "hex"));
  }
  return hash.digest("hex");
}

/**
 * Inspect a private SQLite copy without migrating, checkpointing or repairing it.
 * The caller must never pass the live application database: REM-009A first makes
 * a stable raw copy of main + WAL/journal in a private scratch directory.
 */
export function inspectBackupDatabase(
  databasePath: string,
  inspectionRoot: string,
): BackupDatabaseInspection {
  assertRegularDatabasePath(databasePath, inspectionRoot);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  } catch {
    fail("BACKUP_DATABASE_UNAVAILABLE", "Backup database could not be opened");
  }
  try {
    database.exec("BEGIN");
    const integrityRows = statementRows(database, "PRAGMA integrity_check");
    if (
      integrityRows.length !== 1 ||
      integrityRows[0]?.length !== 1 ||
      integrityRows[0][0] !== "ok"
    ) {
      fail(
        "BACKUP_DATABASE_INTEGRITY_FAILED",
        "Backup database integrity check failed",
      );
    }
    const foreignKeyRows = statementRows(database, "PRAGMA foreign_key_check");
    if (foreignKeyRows.length !== 0) {
      fail(
        "BACKUP_DATABASE_FOREIGN_KEY_FAILED",
        "Backup database contains foreign-key violations",
      );
    }
    const userVersion = safeInteger(
      scalar(database, "PRAGMA user_version", "user_version"),
      "user_version",
    );
    if (userVersion < 1) {
      fail(
        "BACKUP_DATABASE_VERSION_INVALID",
        "Backup database user_version is invalid",
      );
    }
    if (userVersion !== currentSchemaVersion) {
      fail(
        "BACKUP_DATABASE_VERSION_UNSUPPORTED",
        "Backup database version is not supported by this candidate",
      );
    }
    const journalModeValue = scalar(
      database,
      "PRAGMA journal_mode",
      "journal_mode",
    );
    if (typeof journalModeValue !== "string" || !journalModeValue) {
      fail(
        "BACKUP_DATABASE_METADATA_INVALID",
        "Backup database journal_mode is invalid",
      );
    }
    const migrationLedger = inspectMigrationLedger(database, userVersion);
    if (!databaseMatchesSchemaContract(database)) {
      fail(
        "BACKUP_DATABASE_SCHEMA_UNSUPPORTED",
        "Backup database physical schema is not admitted by this candidate",
      );
    }
    const schema = inspectSchema(database);
    const tables = inspectTables(database, inspectionRoot);
    return Object.freeze({
      foreignKeyViolations: 0 as const,
      integrityCheck: "ok" as const,
      journalMode: journalModeValue,
      logicalSha256: logicalSha256({
        migrationLedger,
        schema,
        tables,
        userVersion,
      }),
      migrationLedger: Object.freeze(migrationLedger),
      schema,
      tables: Object.freeze(tables),
      userVersion,
    });
  } catch (error) {
    if (error instanceof BackupInspectionError) throw error;
    fail("BACKUP_DATABASE_INSPECTION_FAILED", "Backup database inspection failed");
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
  fail("BACKUP_DATABASE_INSPECTION_FAILED", "Backup database inspection failed");
}

async function assertRegularTree(directory: string) {
  let root;
  try {
    root = await lstat(directory);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) return false;
    throw error;
  }
  if (root.isSymbolicLink() || !root.isDirectory()) {
    fail(
      "BACKUP_SECRETS_DIRECTORY_INVALID",
      "Secrets path must be a regular directory",
    );
  }
  let directories = 1;
  let files = 0;
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink()) {
        fail("BACKUP_SECRET_LINK_REJECTED", "Secrets may not contain links");
      }
      if (details.isDirectory()) {
        directories += 1;
        if (directories > 32) {
          fail(
            "BACKUP_SECRETS_TREE_TOO_LARGE",
            "Secrets directory contains too many directories",
          );
        }
        await visit(path);
      } else if (!details.isFile()) {
        fail(
          "BACKUP_SECRET_SPECIAL_FILE_REJECTED",
          "Secrets may contain only regular files and directories",
        );
      } else {
        files += 1;
        if (files > 64) {
          fail(
            "BACKUP_SECRETS_TREE_TOO_LARGE",
            "Secrets directory contains too many files",
          );
        }
      }
    }
  }
  await visit(directory);
  return true;
}

async function readOptionalRegularFile(path: string, maximumBytes: number) {
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    fail("BACKUP_SECRET_FILE_INVALID", "Secret must be a regular file");
  }
  if (before.size > BigInt(maximumBytes)) {
    fail("BACKUP_SECRET_FILE_TOO_LARGE", "Secret file exceeds its safe limit");
  }
  const noFollow = "O_NOFOLLOW" in fileConstants
    ? fileConstants.O_NOFOLLOW
    : 0;
  const handle = await open(path, fileConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      fail("BACKUP_SECRET_FILE_CHANGED", "Secret file changed while opening");
    }
    const value = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      BigInt(value.length) !== opened.size ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) {
      value.fill(0);
      fail("BACKUP_SECRET_FILE_CHANGED", "Secret file changed while reading");
    }
    return value;
  } finally {
    await handle.close();
  }
}

function canonicalBase64(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    fail("BACKUP_SECRET_ENCODING_INVALID", `${label} is not canonical base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    decoded.fill(0);
    fail("BACKUP_SECRET_ENCODING_INVALID", `${label} is not canonical base64`);
  }
  return decoded;
}

function decryptGcm(
  key: Buffer,
  aad: Buffer,
  iv: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
) {
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    fail("BACKUP_SECRET_CIPHERTEXT_INVALID", "Encrypted secret is malformed");
  }
  let updated: Buffer | undefined;
  let finalized: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    updated = decipher.update(ciphertext);
    finalized = decipher.final();
    const plaintext = Buffer.concat([updated, finalized]);
    updated.fill(0);
    finalized.fill(0);
    return plaintext;
  } catch {
    updated?.fill(0);
    finalized?.fill(0);
    fail(
      "BACKUP_SECRET_AUTHENTICATION_FAILED",
      "Encrypted secret authentication failed",
    );
  }
}

async function validateEncryptedDocument(
  path: string,
  key: Buffer | undefined,
  aad: Buffer,
) {
  const encoded = await readOptionalRegularFile(
    path,
    maximumEncryptedDocumentBytes,
  );
  if (!encoded) return 0;
  let iv: Buffer | undefined;
  let tag: Buffer | undefined;
  let ciphertext: Buffer | undefined;
  let plaintext: Buffer | undefined;
  try {
    if (!key) {
      fail(
        "BACKUP_SECRET_MASTER_KEY_MISSING",
        "Encrypted secret document has no master key",
      );
    }
    let document: unknown;
    try {
      document = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(encoded),
      );
    } catch {
      fail("BACKUP_SECRET_DOCUMENT_INVALID", "Encrypted secret document is invalid");
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      fail("BACKUP_SECRET_DOCUMENT_INVALID", "Encrypted secret document is invalid");
    }
    const encrypted = document as Record<string, unknown>;
    if (encrypted.version !== 1) {
      fail("BACKUP_SECRET_DOCUMENT_INVALID", "Encrypted secret version is invalid");
    }
    iv = canonicalBase64(encrypted.iv, "Secret IV");
    tag = canonicalBase64(encrypted.tag, "Secret tag");
    ciphertext = canonicalBase64(encrypted.ciphertext, "Secret ciphertext");
    plaintext = decryptGcm(key, aad, iv, tag, ciphertext);
    let decrypted: unknown;
    try {
      decrypted = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
    } catch {
      fail("BACKUP_SECRET_PLAINTEXT_INVALID", "Decrypted secret document is invalid");
    }
    if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
      fail("BACKUP_SECRET_PLAINTEXT_INVALID", "Decrypted secret document is invalid");
    }
    const content = decrypted as Record<string, unknown>;
    if (
      content.version !== 1 ||
      !Array.isArray(content.profiles) ||
      content.profiles.some(
        (profile) => !profile || typeof profile !== "object" || Array.isArray(profile),
      )
    ) {
      fail("BACKUP_SECRET_PLAINTEXT_INVALID", "Decrypted secret document is invalid");
    }
    return content.profiles.length;
  } finally {
    encoded.fill(0);
    iv?.fill(0);
    tag?.fill(0);
    ciphertext?.fill(0);
    plaintext?.fill(0);
  }
}

function validateAccountCredential(value: unknown, key: Buffer | undefined) {
  if (!key) {
    fail(
      "BACKUP_SECRET_MASTER_KEY_MISSING",
      "Encrypted account credential has no master key",
    );
  }
  if (typeof value !== "string" || value.length > maximumEncryptedCredentialBytes) {
    fail("BACKUP_ACCOUNT_CREDENTIAL_INVALID", "Account credential is invalid");
  }
  const parts = value.split("$");
  if (parts.length !== 3) {
    fail("BACKUP_ACCOUNT_CREDENTIAL_INVALID", "Account credential is invalid");
  }
  const iv = canonicalBase64(parts[0], "Credential IV");
  const tag = canonicalBase64(parts[1], "Credential tag");
  const ciphertext = canonicalBase64(parts[2], "Credential ciphertext");
  let plaintext: Buffer | undefined;
  try {
    plaintext = decryptGcm(
      key,
      accountCredentialAad,
      iv,
      tag,
      ciphertext,
    );
    let decoded = "";
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      fail(
        "BACKUP_ACCOUNT_CREDENTIAL_INVALID",
        "Decrypted account credential is invalid",
      );
    }
    if (
      decoded.length < 8 ||
      /\s/.test(decoded)
    ) {
      fail(
        "BACKUP_ACCOUNT_CREDENTIAL_INVALID",
        "Decrypted account credential is invalid",
      );
    }
  } finally {
    iv.fill(0);
    tag.fill(0);
    ciphertext.fill(0);
    plaintext?.fill(0);
  }
}

/**
 * Prove that the copied secret material can decrypt without ever creating a
 * missing master key or returning plaintext. Only aggregate counts leave this
 * function.
 */
export async function validateBackupSecrets(
  databasePath: string,
  secretsDirectory: string,
  inspectionRoot: string,
): Promise<BackupSecretValidation> {
  assertRegularDatabasePath(databasePath, inspectionRoot);
  assertAbsolutePath(secretsDirectory, "Secrets directory");
  let absentSecrets = false;
  try {
    assertContainedRegularPath(
      secretsDirectory,
      inspectionRoot,
      "directory",
      "Secrets directory",
    );
  } catch (error) {
    try {
      lstatSync(secretsDirectory);
    } catch (missing) {
      if (missing instanceof Error && "code" in missing && missing.code === "ENOENT") {
        assertContainedRegularPath(
          dirname(secretsDirectory),
          inspectionRoot,
          "directory",
          "Secrets parent directory",
        );
        absentSecrets = true;
      } else {
        throw error;
      }
    }
    if (!absentSecrets) throw error;
  }
  const secretsPresent = await assertRegularTree(secretsDirectory);
  const key = secretsPresent
    ? await readOptionalRegularFile(join(secretsDirectory, "config-master.key"), 32)
    : undefined;
  if (key && key.length !== 32) {
    key.fill(0);
    fail("BACKUP_SECRET_MASTER_KEY_INVALID", "Secret master key is invalid");
  }

  let database: DatabaseSync | undefined;
  let validationFailed = false;
  try {
    const providerDocumentProfiles = secretsPresent
      ? await validateEncryptedDocument(
          join(secretsDirectory, "provider-profiles.enc.json"),
          key,
          providerDocumentAad,
        )
      : 0;
    const storageDocumentProfiles = secretsPresent
      ? await validateEncryptedDocument(
          join(secretsDirectory, "storage-profiles.enc.json"),
          key,
          storageDocumentAad,
        )
      : 0;

    database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
    database.exec("BEGIN");
    const credentialTable = statementRows(
      database,
      `
        SELECT COUNT(*)
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'account_provider_credentials'
      `,
    );
    let accountCredentials = 0;
    if (credentialTable[0]?.[0] === 1n) {
      const statement = database.prepare(`
        SELECT encrypted_key
        FROM account_provider_credentials
        ORDER BY account_id, provider_profile_id
      `);
      statement.setReadBigInts(true);
      statement.setReturnArrays(true);
      for (const row of statement.iterate() as Iterable<unknown[]>) {
        validateAccountCredential(row[0], key);
        accountCredentials += 1;
      }
    }
    return Object.freeze({
      accountCredentials,
      masterKeyPresent: Boolean(key),
      providerDocumentProfiles,
      storageDocumentProfiles,
    });
  } catch (error) {
    validationFailed = true;
    if (error instanceof BackupInspectionError) throw error;
    throw new BackupInspectionError(
      "BACKUP_SECRET_VALIDATION_FAILED",
      "Backup secret validation failed",
    );
  } finally {
    key?.fill(0);
    let cleanupFailed = false;
    if (database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      database?.close();
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed && !validationFailed) {
      throw new BackupInspectionError(
        "BACKUP_SECRET_CLEANUP_FAILED",
        "Backup secret validation cleanup failed",
      );
    }
  }
}

// Keep the algorithm contract explicit for reviews and future format bridges.
export const backupSecretCryptoContract = Object.freeze({
  accountCredentialAad: accountCredentialAad.toString("utf8"),
  authenticationTagBytes: 16,
  cipher: "aes-256-gcm",
  ivBytes: 12,
  masterKeyBytes: 32,
  providerDocumentAad: providerDocumentAad.toString("utf8"),
  storageDocumentAad: storageDocumentAad.toString("utf8"),
});
