#!/usr/bin/env node

/*
 * Schema 44 rollback bridge.
 *
 * This file is intentionally self-contained.  It does not import the app,
 * Vite, the application database module, or any route handler.  The package
 * contains this manifest, a generic maintenance page, and this executable
 * runtime. It opens the original CURRENT data directory read-only and never
 * copies its database, media, or secrets.
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  readFileSync,
  readdirSync,
  realpathSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve, sep } from "node:path";

const FORMAT = "unboundry-schema44-readonly-preservation";
const VERSION = 2;
const SCHEMA_VERSION = 44;
const SCHEMA_MIGRATION = "media-publication-output-slots-and-recovery";
const DATABASE_NAME = "unboundry.sqlite";
const MANIFEST_NAME = "preservation-manifest.json";
const PAGE_NAME = "maintenance.html";
const EXECUTABLE_NAME = "schema44-readonly-preservation-runtime.mjs";
const MAX_FILE_BYTES = 1024 * 1024 * 1024 * 1024;

class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BridgeError(code, message);
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    fail("SCHEMA44_READONLY_ARGUMENT_INVALID", `${label} is invalid`);
  }
  const output = resolve(value);
  if (output !== value) {
    fail("SCHEMA44_READONLY_ARGUMENT_INVALID", `${label} must be normalized`);
  }
  return output;
}

function privateDirectory(path, label, create = false) {
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const details = lstatSync(path, { throwIfNoEntry: false });
  if (!details || !details.isDirectory() || (details.mode & 0o077) !== 0) {
    fail("SCHEMA44_READONLY_PATH_UNSAFE", `${label} must be a private directory`);
  }
  return details;
}

function regularFile(path, label) {
  const details = lstatSync(path, { throwIfNoEntry: false });
  if (!details || !details.isFile() || (details.mode & 0o077) !== 0) {
    fail("SCHEMA44_READONLY_PATH_UNSAFE", `${label} must be a private regular file`);
  }
  if (details.size > MAX_FILE_BYTES) {
    fail("SCHEMA44_READONLY_FILE_TOO_LARGE", `${label} is too large`);
  }
  return details;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function canonicalIdentity(path, details) {
  return Object.freeze({
    device: String(details.dev),
    inode: String(details.ino),
    mode: details.mode & 0o777,
    size: details.size,
    mtimeMs: details.mtimeMs,
    path: realpathSync(path),
  });
}

function mediaTree(dataDirectory) {
  const root = join(dataDirectory, "media");
  const entries = [];
  let totalBytes = 0;
  if (!existsSync(root)) {
    return Object.freeze({ files: 0, sha256: sha256Bytes("[]"), totalBytes: 0 });
  }
  const rootDetails = lstatSync(root);
  if (!rootDetails.isDirectory() || (rootDetails.mode & 0o077) !== 0) {
    fail("SCHEMA44_READONLY_PATH_UNSAFE", "media must be a private directory");
  }
  function visit(directory, prefix) {
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const path = join(directory, child.name);
      const logical = prefix ? `${prefix}/${child.name}` : child.name;
      const details = lstatSync(path);
      if (details.isSymbolicLink()) {
        fail("SCHEMA44_READONLY_MEDIA_SYMLINK", "media contains a symlink");
      }
      if (details.isDirectory()) {
        if ((details.mode & 0o077) !== 0) {
          fail("SCHEMA44_READONLY_PATH_UNSAFE", "media contains a non-private directory");
        }
        entries.push({ kind: "directory", logical });
        visit(path, logical);
        continue;
      }
      if (!details.isFile()) {
        fail("SCHEMA44_READONLY_MEDIA_ENTRY_INVALID", "media contains a non-regular entry");
      }
      totalBytes += details.size;
      entries.push({
        kind: "file",
        logical,
        mode: details.mode & 0o777,
        sha256: sha256File(path),
        size: details.size,
      });
    }
  }
  visit(root, "");
  entries.sort((left, right) => left.logical.localeCompare(right.logical));
  return Object.freeze({
    files: entries.filter((entry) => entry.kind === "file").length,
    sha256: sha256Bytes(JSON.stringify(entries)),
    totalBytes,
  });
}

function readOnlyDatabase(dataDirectory) {
  privateDirectory(dataDirectory, "data directory");
  const databasePath = join(dataDirectory, DATABASE_NAME);
  const details = regularFile(databasePath, DATABASE_NAME);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (existsSync(`${databasePath}${suffix}`)) {
      fail("SCHEMA44_READONLY_SIDECAR_PRESENT", "CURRENT database has a sidecar");
    }
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version !== SCHEMA_VERSION) {
      fail("SCHEMA44_READONLY_SCHEMA_MISMATCH", "CURRENT database is not schema44");
    }
    const integrity = String(database.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "");
    if (integrity !== "ok") fail("SCHEMA44_READONLY_DATABASE_INVALID", "CURRENT database failed integrity check");
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) fail("SCHEMA44_READONLY_DATABASE_INVALID", "CURRENT database has foreign key violations");
    const migration = database.prepare(`
      SELECT version, name
      FROM schema_migrations
      ORDER BY version DESC
      LIMIT 1
    `).get();
    if (Number(migration?.version) !== SCHEMA_VERSION || migration?.name !== SCHEMA_MIGRATION) {
      fail("SCHEMA44_READONLY_SCHEMA_MISMATCH", "CURRENT migration ledger is not schema44");
    }
    const tables = new Set(database.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'table'
    `).all().map((row) => String(row.name)));
    for (const table of [
      "media_publication_attempts",
      "generation_result_save_leases",
      "generation_result_adoptions",
      "workflow_run_continuations",
    ]) {
      if (!tables.has(table)) fail("SCHEMA44_READONLY_SCHEMA_MISMATCH", "CURRENT recovery tables are incomplete");
    }
    const logicalCounts = Object.freeze({
      canvasDocuments: Number(database.prepare("SELECT COUNT(*) AS count FROM canvas_documents").get()?.count ?? 0),
      generationTasks: Number(database.prepare("SELECT COUNT(*) AS count FROM generation_tasks").get()?.count ?? 0),
      mediaAssets: Number(database.prepare("SELECT COUNT(*) AS count FROM media_assets").get()?.count ?? 0),
      publicationAttempts: Number(database.prepare("SELECT COUNT(*) AS count FROM media_publication_attempts").get()?.count ?? 0),
    });
    return Object.freeze({
      databasePath,
      databaseSha256: sha256File(databasePath),
      identity: canonicalIdentity(databasePath, details),
      logicalCounts,
      migration: Object.freeze({ name: migration.name, version: Number(migration.version) }),
      schemaVersion: version,
    });
  } finally {
    database.close();
  }
}

function inspectSource(dataDirectory) {
  const database = readOnlyDatabase(dataDirectory);
  const media = mediaTree(dataDirectory);
  return Object.freeze({
    database,
    media,
    sourceDataDirectory: dataDirectory,
  });
}

function stableSourceDigest(source) {
  return sha256Bytes(JSON.stringify({
    databaseSha256: source.database.databaseSha256,
    identity: source.database.identity,
    media: source.media,
    sourceDataDirectory: source.sourceDataDirectory,
  }));
}

const maintenancePage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>系统维护中</title>
<style>body{margin:0;background:#111;color:#eee;font:16px system-ui,-apple-system,"PingFang SC",sans-serif;display:grid;place-items:center;min-height:100vh}.card{max-width:32rem;margin:2rem;padding:2rem;border:1px solid #444;border-radius:16px;background:#1d1d1d}.tag{color:#9ad6ff}</style></head>
<body><main class="card"><p class="tag">schema44 · 只读保全模式</p><h1>系统正在维护</h1><p>当前数据已安全保留，维护完成后会自动恢复工作。</p></main></body></html>`;
const maintenancePageSha256 = sha256Bytes(maintenancePage);

function packageInventory(packageDirectory) {
  const entries = readdirSync(packageDirectory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    fail("SCHEMA44_READONLY_PACKAGE_INVALID", "preservation package contains an invalid entry");
  }
  const names = entries.map((entry) => entry.name).sort();
  if (
    names.length !== 3 ||
    !names.includes(MANIFEST_NAME) ||
    !names.includes(PAGE_NAME) ||
    !names.includes(EXECUTABLE_NAME)
  ) {
    fail("SCHEMA44_READONLY_PACKAGE_INVALID", "preservation package inventory is invalid");
  }
  regularFile(join(packageDirectory, MANIFEST_NAME), MANIFEST_NAME);
  regularFile(join(packageDirectory, PAGE_NAME), PAGE_NAME);
  const executable = regularFile(join(packageDirectory, EXECUTABLE_NAME), EXECUTABLE_NAME);
  if ((executable.mode & 0o111) === 0) {
    fail("SCHEMA44_READONLY_PACKAGE_INVALID", "preservation runtime is not executable");
  }
}

function loadManifest(packageDirectory) {
  privateDirectory(packageDirectory, "preservation package");
  packageInventory(packageDirectory);
  let value;
  try {
    value = JSON.parse(readFileSync(join(packageDirectory, MANIFEST_NAME), "utf8"));
  } catch {
    fail("SCHEMA44_READONLY_PACKAGE_INVALID", "preservation manifest is invalid");
  }
  if (!value || value.format !== FORMAT || value.version !== VERSION ||
      value.schemaVersion !== SCHEMA_VERSION || value.mode !== "read-only" ||
      value.writesAccepted !== false || value.providerRequests !== 0 ||
      value.migration !== SCHEMA_MIGRATION ||
      typeof value.sourceDataDirectory !== "string" ||
      typeof value.databaseFileSha256 !== "string" ||
      typeof value.mediaTreeSha256 !== "string" ||
      value.pageSha256 !== maintenancePageSha256 ||
      value.runtimeName !== EXECUTABLE_NAME ||
      typeof value.runtimeSha256 !== "string" ||
      !value.databaseIdentity || typeof value.sourceDigest !== "string") {
    fail("SCHEMA44_READONLY_PACKAGE_INVALID", "preservation manifest contract is invalid");
  }
  if (sha256File(join(packageDirectory, EXECUTABLE_NAME)) !== value.runtimeSha256) {
    fail("SCHEMA44_READONLY_PACKAGE_INVALID", "preservation runtime hash does not match the manifest");
  }
  if (sha256File(join(packageDirectory, PAGE_NAME)) !== value.pageSha256) {
    fail("SCHEMA44_READONLY_PACKAGE_INVALID", "maintenance page hash does not match the manifest");
  }
  return Object.freeze(value);
}

function assertManifestSource(manifest, dataDirectory) {
  const sourcePath = absolutePath(dataDirectory, "data directory");
  if (manifest.sourceDataDirectory !== sourcePath) {
    fail("SCHEMA44_READONLY_SOURCE_MISMATCH", "preservation package is bound to a different CURRENT data directory");
  }
  const source = inspectSource(sourcePath);
  if (source.database.databaseSha256 !== manifest.databaseFileSha256 ||
      source.media.sha256 !== manifest.mediaTreeSha256 ||
      JSON.stringify(source.database.identity) !== JSON.stringify(manifest.databaseIdentity) ||
      stableSourceDigest(source) !== manifest.sourceDigest) {
    fail("SCHEMA44_READONLY_SOURCE_CHANGED", "CURRENT data changed after the preservation package was sealed");
  }
  return source;
}

function createPackage(dataDirectory, outputDirectory, expectedDatabaseSha256, expectedMediaSha256) {
  const sourcePath = absolutePath(dataDirectory, "data directory");
  const outputPath = absolutePath(outputDirectory, "output directory");
  if (outputPath === sourcePath || outputPath.startsWith(`${sourcePath}${sep}`)) {
    fail("SCHEMA44_READONLY_OUTPUT_UNSAFE", "preservation package must be outside CURRENT data");
  }
  if (existsSync(outputPath)) fail("SCHEMA44_READONLY_OUTPUT_EXISTS", "preservation package already exists");
  const before = inspectSource(sourcePath);
  if (expectedDatabaseSha256 && before.database.databaseSha256 !== expectedDatabaseSha256) {
    fail("SCHEMA44_READONLY_SHA_MISMATCH", "CURRENT database hash does not match the expected hash");
  }
  if (expectedMediaSha256 && before.media.sha256 !== expectedMediaSha256) {
    fail("SCHEMA44_READONLY_SHA_MISMATCH", "CURRENT media hash does not match the expected hash");
  }
  mkdirSync(outputPath, { recursive: true, mode: 0o700 });
  try {
    privateDirectory(outputPath, "output directory");
    const after = inspectSource(sourcePath);
    if (stableSourceDigest(before) !== stableSourceDigest(after)) {
      fail("SCHEMA44_READONLY_SOURCE_CHANGED", "CURRENT data changed while sealing preservation package");
    }
    const executableBytes = readFileSync(new URL(import.meta.url));
    const manifest = Object.freeze({
      createdAt: new Date().toISOString(),
      databaseFileSha256: after.database.databaseSha256,
      databaseIdentity: after.database.identity,
      format: FORMAT,
      mediaFiles: after.media.files,
      mediaTreeSha256: after.media.sha256,
      mediaTotalBytes: after.media.totalBytes,
      migration: SCHEMA_MIGRATION,
      mode: "read-only",
      pageSha256: maintenancePageSha256,
      providerRequests: 0,
      runtimeName: EXECUTABLE_NAME,
      runtimeSha256: sha256Bytes(executableBytes),
      schemaVersion: SCHEMA_VERSION,
      sourceDataDirectory: sourcePath,
      sourceDigest: stableSourceDigest(after),
      version: VERSION,
      writesAccepted: false,
    });
    writeFileSync(join(outputPath, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    writeFileSync(join(outputPath, PAGE_NAME), maintenancePage, { mode: 0o600, flag: "wx" });
    writeFileSync(
      join(outputPath, EXECUTABLE_NAME),
      executableBytes,
      { mode: 0o700, flag: "wx" },
    );
    return manifest;
  } catch (error) {
    // The destination did not exist before this command, so remove only the
    // incomplete package that this invocation created.
    try { rmSync(outputPath, { force: true, recursive: true }); } catch {}
    throw error;
  }
}

function jsonResponse(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "allow": "GET, HEAD",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  if (response.req?.method !== "HEAD") response.end(body);
  else response.end();
}

function startServer(packageDirectory, port) {
  const packagePath = absolutePath(packageDirectory, "preservation package");
  const manifest = loadManifest(packagePath);
  const source = assertManifestSource(manifest, manifest.sourceDataDirectory);
  const page = readFileSync(join(packagePath, PAGE_NAME), "utf8");
  // Keep a read-only/query-only handle alive for the complete maintenance
  // process.  No request handler receives this handle or can query data.
  const database = new DatabaseSync(source.database.databasePath, { readOnly: true });
  database.exec("PRAGMA query_only = ON");
  const server = createServer((request, response) => {
    if ((request.method === "GET" || request.method === "HEAD") &&
        (request.url === "/" || request.url === "/maintenance")) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(page),
      });
      if (request.method === "HEAD") response.end();
      else response.end(page);
      return;
    }
    // No health, results, media, auth, session, or mutation route exists in
    // this process.  In particular, GET /results cannot disclose task data.
    jsonResponse(response, 503, {
      code: "SCHEMA44_READONLY_MAINTENANCE",
      message: "系统处于只读保全模式，请稍后再试",
    });
  });
  const close = () => new Promise((resolveClose) => {
    server.close(() => {
      database.close();
      resolveClose();
    });
  });
  const shutdown = () => { void close().finally(() => process.exit(0)); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    process.stdout.write(`${JSON.stringify({ mode: FORMAT, ok: true, port: actualPort, writesAccepted: false })}\n`);
  });
  return { close, server };
}

function flag(args, name, required = true) {
  const index = args.indexOf(name);
  if (index < 0) {
    if (required) fail("SCHEMA44_READONLY_ARGUMENT_INVALID", `missing ${name}`);
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail("SCHEMA44_READONLY_ARGUMENT_INVALID", `missing value for ${name}`);
  return value;
}

function main(args) {
  const command = args[0];
  if (command === "inspect") {
    const dataDirectory = absolutePath(flag(args, "--data-dir"), "data directory");
    const packageDirectory = flag(args, "--package-dir", false);
    const manifest = packageDirectory ? loadManifest(absolutePath(packageDirectory, "preservation package")) : undefined;
    const source = manifest
      ? assertManifestSource(manifest, dataDirectory)
      : inspectSource(dataDirectory);
    const expected = flag(args, "--expected-database-sha256", false);
    if (expected && source.database.databaseSha256 !== expected) fail("SCHEMA44_READONLY_SHA_MISMATCH", "CURRENT database hash does not match");
    process.stdout.write(`${JSON.stringify({ mode: FORMAT, ok: true, schemaVersion: source.database.schemaVersion, writesAccepted: false })}\n`);
    return;
  }
  if (command === "package") {
    const dataDirectory = flag(args, "--data-dir");
    const outputDirectory = flag(args, "--output-dir");
    const manifest = createPackage(
      absolutePath(dataDirectory, "data directory"),
      absolutePath(outputDirectory, "output directory"),
      flag(args, "--expected-database-sha256", false),
      flag(args, "--expected-media-sha256", false),
    );
    process.stdout.write(`${JSON.stringify({ mode: FORMAT, ok: true, packageDirectory: absolutePath(outputDirectory, "output directory"), manifest })}\n`);
    return;
  }
  if (command === "serve") {
    const packageDirectory = flag(args, "--package-dir");
    const port = Number(flag(args, "--port", false) ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail("SCHEMA44_READONLY_ARGUMENT_INVALID", "port is invalid");
    startServer(absolutePath(packageDirectory, "preservation package"), port);
    return;
  }
  fail("SCHEMA44_READONLY_ARGUMENT_INVALID", "command must be inspect, package, or serve");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const code = error instanceof BridgeError ? error.code : "SCHEMA44_READONLY_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ code, message })}\n`);
  process.exitCode = 1;
}
