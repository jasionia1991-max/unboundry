import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  appDataDirectory,
  currentSchemaVersion,
  openAppDatabase,
} from "../server/database.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function backupName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function mediaManifest(directory) {
  const entries = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Media backup refuses symbolic link: ${entry.name}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const details = await stat(path);
      entries.push({
        path: relative(directory, path),
        sha256: await sha256(path),
        size: details.size,
      });
    }
  }
  try {
    await visit(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function tableCounts(database) {
  const tables = [
    "schema_migrations",
    "canvas_documents",
    "asset_history",
    "project_metadata",
    "generation_tasks",
    "generation_task_events",
    "users",
    "sessions",
    "admin_audit_events",
    "media_assets",
    "provider_profiles",
    "model_profiles",
    "node_model_bindings",
  ];
  return Object.fromEntries(
    tables.map((table) => [
      table,
      Number(
        database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ),
    ]),
  );
}

const dataDirectory = resolve(argument("--data-dir") ?? appDataDirectory());
const backupRoot = resolve(
  argument("--backup-root") ??
    process.env.TAPNOW_BACKUP_DIR ??
    join(process.cwd(), "backups"),
);
const sourceDatabasePath = join(dataDirectory, "tapnow.sqlite");
const sourceMediaDirectory = join(dataDirectory, "media");
const directory = join(backupRoot, backupName());

await mkdir(backupRoot, { recursive: true });
await mkdir(directory);

const sourceDatabase = openAppDatabase(dataDirectory);
try {
  sourceDatabase.exec("PRAGMA wal_checkpoint(PASSIVE)");
  await backup(sourceDatabase, join(directory, "tapnow.sqlite"));
} finally {
  sourceDatabase.close();
}

try {
  await cp(sourceMediaDirectory, join(directory, "media"), {
    errorOnExist: true,
    recursive: true,
  });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  await mkdir(join(directory, "media"));
}

const backupDatabasePath = join(directory, "tapnow.sqlite");
const backupDatabase = new DatabaseSync(backupDatabasePath, { readOnly: true });
const quickCheck = backupDatabase.prepare("PRAGMA quick_check").get().quick_check;
const schemaVersion = Number(
  backupDatabase.prepare("PRAGMA user_version").get().user_version,
);
const counts = tableCounts(backupDatabase);
backupDatabase.close();

if (quickCheck !== "ok" || schemaVersion !== currentSchemaVersion) {
  throw new Error("Backup database validation failed");
}

const databaseDetails = await stat(backupDatabasePath);
const media = await mediaManifest(join(directory, "media"));
const manifest = {
  format: 1,
  createdAt: new Date().toISOString(),
  database: {
    file: "tapnow.sqlite",
    quickCheck,
    schemaVersion,
    sha256: await sha256(backupDatabasePath),
    size: databaseDetails.size,
    tableCounts: counts,
  },
  media: {
    bytes: media.reduce((total, entry) => total + entry.size, 0),
    files: media,
  },
  source: {
    dataDirectoryName: basename(dataDirectory),
  },
};

await writeFile(
  join(directory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx" },
);

console.log(
  JSON.stringify({
    backupDirectory: directory,
    databaseRows: Object.values(counts).reduce(
      (total, count) => total + count,
      0,
    ),
    mediaBytes: manifest.media.bytes,
    mediaFiles: manifest.media.files.length,
    schemaVersion,
  }),
);
