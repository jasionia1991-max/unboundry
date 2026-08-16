import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

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

async function fileManifest(directory) {
  const entries = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Backup refuses symbolic links");
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error("Backup refuses special files");
      const details = await stat(path);
      entries.push({
        path: relative(directory, path).replaceAll("\\", "/"),
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
  const tables = database.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  return Object.fromEntries(tables.map((table) => [
    table,
    Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table.replaceAll('"', '""')}"`).get().count),
  ]));
}

const dataDirectory = resolve(argument("--data-dir") ?? process.env.UNBOUNDRY_DATA_DIR ?? "/var/lib/unboundry");
const backupRoot = resolve(argument("--backup-root") ?? process.env.UNBOUNDRY_BACKUP_DIR ?? join(process.cwd(), "backups"));
const sourceDatabasePath = join(dataDirectory, "unboundry.sqlite");
const directory = join(backupRoot, backupName());

await mkdir(backupRoot, { recursive: true });
await mkdir(directory);

const sourceDatabase = new DatabaseSync(sourceDatabasePath);
try {
  await backup(sourceDatabase, join(directory, "unboundry.sqlite"));
} finally {
  sourceDatabase.close();
}

for (const name of ["media", "secrets"]) {
  try {
    await cp(join(dataDirectory, name), join(directory, name), {
      errorOnExist: true,
      recursive: true,
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (name === "media") await mkdir(join(directory, name));
  }
}

const backupDatabasePath = join(directory, "unboundry.sqlite");
const backupDatabase = new DatabaseSync(backupDatabasePath, { readOnly: true });
const integrity = backupDatabase.prepare("PRAGMA integrity_check").get().integrity_check;
const foreignKeyViolations = backupDatabase.prepare("PRAGMA foreign_key_check").all().length;
const schemaVersion = Number(backupDatabase.prepare("PRAGMA user_version").get().user_version);
const counts = tableCounts(backupDatabase);
backupDatabase.close();

if (integrity !== "ok" || foreignKeyViolations !== 0 || schemaVersion !== 39) {
  throw new Error("Backup database validation failed");
}

const databaseDetails = await stat(backupDatabasePath);
const media = await fileManifest(join(directory, "media"));
const secrets = await fileManifest(join(directory, "secrets"));
const manifest = {
  createdAt: new Date().toISOString(),
  database: {
    file: "unboundry.sqlite",
    foreignKeyViolations,
    integrity,
    schemaVersion,
    sha256: await sha256(backupDatabasePath),
    size: databaseDetails.size,
    tableCounts: counts,
  },
  format: 2,
  media: {
    bytes: media.reduce((total, entry) => total + entry.size, 0),
    files: media,
  },
  secrets: { files: secrets },
  source: { dataDirectoryName: basename(dataDirectory) },
};

await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({
  backupDirectory: directory,
  databaseRows: Object.values(counts).reduce((total, count) => total + count, 0),
  mediaBytes: manifest.media.bytes,
  mediaFiles: manifest.media.files.length,
  schemaVersion,
}));
