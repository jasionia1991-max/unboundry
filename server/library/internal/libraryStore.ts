import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appDataDirectory } from "../../database";

export type LibraryKind = "audio" | "image" | "video";

export type LibraryEntry = Readonly<{
  assetId: string;
  createdAt: string;
  folderId: string;
  kind: LibraryKind;
  label: string;
  ownerId: string;
  revision: number;
  updatedAt: string;
}>;

const librarySchemaVersion = 1;

export function libraryDatabasePath(dataDirectory = appDataDirectory()) {
  return join(dataDirectory, "library.sqlite");
}

function assertSafeLibraryDatabaseFile(path: string) {
  const details = lstatSync(path);
  const currentUid = typeof process.getuid === "function"
    ? process.getuid()
    : undefined;
  const trustedOwner = currentUid !== undefined &&
    (details.uid === 0 || details.uid === currentUid);
  if (
    details.isSymbolicLink() || !details.isFile() || details.nlink !== 1 ||
    !trustedOwner || (details.mode & 0o022) !== 0
  ) {
    throw new Error("Library database file permissions are unsafe");
  }
}

export function databaseMatchesLibrarySchema(database: DatabaseSync) {
  const version = database.prepare("PRAGMA user_version").get() as {
    user_version?: unknown;
  };
  if (Number(version.user_version) !== librarySchemaVersion) return false;
  const tables = (database.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>).map((row) => row.name);
  if (tables.join("\n") !== "library_entries") return false;
  const columns = (database.prepare(
    'PRAGMA table_xinfo("library_entries")',
  ).all() as Array<{ name: string }>).map((row) => row.name).sort();
  const quick = database.prepare("PRAGMA quick_check").get() as {
    quick_check?: unknown;
  };
  return columns.join("\n") === [
    "asset_id",
    "created_at",
    "folder_id",
    "kind",
    "label",
    "owner_id",
    "revision",
    "updated_at",
  ].sort().join("\n") && String(quick.quick_check) === "ok" &&
    database.prepare("PRAGMA foreign_key_check").all().length === 0;
}

export function openLibraryDatabase(dataDirectory = appDataDirectory()) {
  const path = libraryDatabasePath(dataDirectory);
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  const existed = existsSync(path);
  if (existed) assertSafeLibraryDatabaseFile(path);
  const database = new DatabaseSync(path, { timeout: 5_000 });
  try {
    if (!existed) chmodSync(path, 0o600);
    assertSafeLibraryDatabaseFile(path);
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = DELETE;");
    const version = Number((database.prepare("PRAGMA user_version").get() as {
      user_version?: unknown;
    }).user_version);
    if (version === 0) {
      const existing = database.prepare(`
        SELECT 1 FROM sqlite_schema
        WHERE type IN ('table', 'index', 'trigger', 'view')
          AND name NOT LIKE 'sqlite_%'
        LIMIT 1
      `).get();
      if (existing) {
        throw new Error("Library database schema is not empty");
      }
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE library_entries (
          owner_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('audio', 'image', 'video')),
          asset_id TEXT NOT NULL,
          label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
          folder_id TEXT NOT NULL DEFAULT 'others',
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner_id, kind, asset_id)
        );
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
    if (!databaseMatchesLibrarySchema(database)) {
      throw new Error("Library database is not the exact supported schema");
    }
    return database;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    throw error;
  }
}

function rowEntry(row: Record<string, unknown>): LibraryEntry {
  return Object.freeze({
    assetId: String(row.asset_id),
    createdAt: String(row.created_at),
    folderId: String(row.folder_id),
    kind: String(row.kind) as LibraryKind,
    label: String(row.label),
    ownerId: String(row.owner_id),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
  });
}

export function beginLibraryEntrySave(input: Readonly<{
  assetId: string;
  folderId: string;
  kind: LibraryKind;
  label: string;
  ownerId: string;
  timestamp: string;
}>) {
  const database = openLibraryDatabase();
  database.exec("BEGIN IMMEDIATE");
  let finished = false;
  try {
    database.prepare(`
      INSERT INTO library_entries (
        owner_id, kind, asset_id, label, folder_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, kind, asset_id) DO UPDATE SET
        label = excluded.label,
        folder_id = excluded.folder_id,
        revision = CASE
          WHEN library_entries.label = excluded.label
            AND library_entries.folder_id = excluded.folder_id
          THEN library_entries.revision
          ELSE library_entries.revision + 1
        END,
        updated_at = CASE
          WHEN library_entries.label = excluded.label
            AND library_entries.folder_id = excluded.folder_id
          THEN library_entries.updated_at
          ELSE excluded.updated_at
        END
    `).run(
      input.ownerId,
      input.kind,
      input.assetId,
      input.label,
      input.folderId,
      input.timestamp,
      input.timestamp,
    );
    const row = database.prepare(`
      SELECT * FROM library_entries
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
    `).get(input.ownerId, input.kind, input.assetId) as Record<string, unknown>;
    return Object.freeze({
      entry: rowEntry(row),
      commit() {
        if (finished) return;
        database.exec("COMMIT");
        finished = true;
        database.close();
      },
      rollback() {
        if (finished) return;
        if (database.isTransaction) database.exec("ROLLBACK");
        finished = true;
        database.close();
      },
    });
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    throw error;
  }
}

export function listLibraryEntries(input: Readonly<{
  folderId: string;
  limit: number;
  offset: number;
  ownerId: string;
  query: string;
}>) {
  const database = openLibraryDatabase();
  try {
    const filter = input.query ? "AND instr(lower(label), lower(?)) > 0" : "";
    const parameters = input.query
      ? [input.ownerId, input.folderId, input.query]
      : [input.ownerId, input.folderId];
    const total = Number((database.prepare(`
      SELECT COUNT(*) AS count FROM library_entries
      WHERE owner_id = ? AND folder_id = ? ${filter}
    `).get(...parameters) as { count: number }).count);
    const rows = database.prepare(`
      SELECT * FROM library_entries
      WHERE owner_id = ? AND folder_id = ? ${filter}
      ORDER BY updated_at DESC, kind, asset_id
      LIMIT ? OFFSET ?
    `).all(...parameters, input.limit, input.offset) as Record<string, unknown>[];
    return Object.freeze({ items: Object.freeze(rows.map(rowEntry)), total });
  } finally {
    database.close();
  }
}

export function removeLibraryEntry(input: Readonly<{
  assetId: string;
  kind: LibraryKind;
  ownerId: string;
}>) {
  const database = openLibraryDatabase();
  try {
    return Number(database.prepare(`
      DELETE FROM library_entries
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
    `).run(input.ownerId, input.kind, input.assetId).changes);
  } finally {
    database.close();
  }
}

export function removeOwnerLibraryEntries(ownerId: string) {
  const database = openLibraryDatabase();
  try {
    return Number(database.prepare(
      "DELETE FROM library_entries WHERE owner_id = ?",
    ).run(ownerId).changes);
  } finally {
    database.close();
  }
}

export function assertLibraryMediaDeletionAllowed(input: Readonly<{
  assetId: string;
  kind: LibraryKind;
  ownerId: string;
}>) {
  const database = openLibraryDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const reference = database.prepare(`
      SELECT 1 FROM library_entries
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
      LIMIT 1
    `).get(input.ownerId, input.kind, input.assetId);
    if (reference) throw new Error("Library assets must be removed from the library first");
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}
