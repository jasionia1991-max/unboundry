import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function latestBackup(backupRoot) {
  const entries = await readdir(backupRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const candidate of candidates) {
    const directory = join(backupRoot, candidate);
    try {
      if ((await stat(join(directory, "manifest.json"))).isFile()) {
        return directory;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("No complete backup directory found");
}

async function restoredMedia(directory) {
  const entries = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Restored media contains symbolic link: ${entry.name}`);
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
  await visit(directory);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function tableCounts(database, expected) {
  return Object.fromEntries(
    Object.keys(expected).map((table) => [
      table,
      Number(
        database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ),
    ]),
  );
}

async function startRuntime(dataDirectory, port) {
  const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
  const child = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: "1",
      },
      stdio: "ignore",
    },
  );
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(origin);
      if (response.ok) return { child, origin };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Restored application did not start");
}

async function stopRuntime(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

function mediaUrl(origin, file) {
  if (file.toLowerCase().endsWith(".mp4")) {
    return `${origin}/api/video-assets/${encodeURIComponent(file)}`;
  }
  if (/\.(?:wav|mp3|m4a|aac)$/i.test(file)) {
    return `${origin}/api/audio-assets/${encodeURIComponent(file)}`;
  }
  return `${origin}/api/assets/${encodeURIComponent(file.replace(/\.png$/i, ""))}`;
}

const backupRoot = resolve(
  argument("--backup-root") ??
    process.env.UNBOUNDRY_BACKUP_DIR ??
    join(process.cwd(), "backups"),
);
const requestedDirectory = argument("--backup-dir");
const backupDirectory = requestedDirectory
  ? resolve(requestedDirectory)
  : await latestBackup(backupRoot);
const manifest = JSON.parse(
  await readFile(join(backupDirectory, "manifest.json"), "utf8"),
);
const runtimePortValue = argument("--runtime-port");
const runtimePort = runtimePortValue ? Number(runtimePortValue) : undefined;
if (
  runtimePort !== undefined &&
  (!Number.isInteger(runtimePort) || runtimePort < 1024 || runtimePort > 65_535)
) {
  throw new Error("Invalid runtime verification port");
}

if (
  manifest?.format !== 1 ||
  manifest.database?.file !== "unboundry.sqlite" ||
  !Array.isArray(manifest.media?.files)
) {
  throw new Error("Invalid backup manifest");
}
const expectedSecrets = Array.isArray(manifest.secrets?.files)
  ? manifest.secrets.files
  : [];

const restoredDirectory = await mkdtemp(join(tmpdir(), "unboundry-restore-"));
let runtime;
try {
  await cp(join(backupDirectory, "unboundry.sqlite"), join(restoredDirectory, "unboundry.sqlite"), {
    errorOnExist: true,
  });
  await cp(join(backupDirectory, "media"), join(restoredDirectory, "media"), {
    errorOnExist: true,
    recursive: true,
  });
  try {
    await cp(
      join(backupDirectory, "secrets"),
      join(restoredDirectory, "secrets"),
      { errorOnExist: true, recursive: true },
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const databasePath = join(restoredDirectory, "unboundry.sqlite");
  if ((await sha256(databasePath)) !== manifest.database.sha256) {
    throw new Error("Restored database checksum mismatch");
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const quickCheck = database.prepare("PRAGMA quick_check").get().quick_check;
  const schemaVersion = Number(
    database.prepare("PRAGMA user_version").get().user_version,
  );
  const counts = tableCounts(database, manifest.database.tableCounts);
  const firstCanvas = database
    .prepare("SELECT id FROM canvas_documents ORDER BY id LIMIT 1")
    .get();
  database.close();

  if (
    quickCheck !== "ok" ||
    schemaVersion !== manifest.database.schemaVersion ||
    JSON.stringify(counts) !== JSON.stringify(manifest.database.tableCounts)
  ) {
    throw new Error("Restored database contents do not match the manifest");
  }

  const media = await restoredMedia(join(restoredDirectory, "media"));
  if (JSON.stringify(media) !== JSON.stringify(manifest.media.files)) {
    throw new Error("Restored media contents do not match the manifest");
  }
  let secrets = [];
  try {
    secrets = await restoredMedia(join(restoredDirectory, "secrets"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (JSON.stringify(secrets) !== JSON.stringify(expectedSecrets)) {
    throw new Error("Restored encrypted secrets do not match the manifest");
  }

  let runtimeVerified = false;
  if (runtimePort !== undefined) {
    runtime = await startRuntime(restoredDirectory, runtimePort);
    if (firstCanvas) {
      const canvasResponse = await fetch(
        `${runtime.origin}/api/canvas/${encodeURIComponent(firstCanvas.id)}`,
      );
      if (!canvasResponse.ok) {
        throw new Error("Restored application could not read a canvas");
      }
    }
    if (media.length) {
      const mediaResponse = await fetch(mediaUrl(runtime.origin, media[0].path));
      if (
        !mediaResponse.ok ||
        (await mediaResponse.arrayBuffer()).byteLength !== media[0].size
      ) {
        throw new Error("Restored application could not read media");
      }
    }
    if (
      !(await fetch(`${runtime.origin}/api/generation-tasks/status`)).ok
    ) {
      throw new Error("Restored application could not read generation state");
    }
    runtimeVerified = true;
  }

  console.log(
    JSON.stringify({
      backupDirectory,
      backupName: basename(backupDirectory),
      databaseQuickCheck: quickCheck,
      mediaBytes: media.reduce((total, entry) => total + entry.size, 0),
      mediaFiles: media.length,
      restoredToTemporaryDirectory: true,
      runtimeVerified,
      schemaVersion,
    }),
  );
} finally {
  if (runtime) await stopRuntime(runtime.child);
  await rm(restoredDirectory, { force: true, recursive: true });
}
