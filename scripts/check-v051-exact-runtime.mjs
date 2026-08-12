import "./node-typescript-runtime.mjs";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fileConstants,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

// These must remain dynamic: the sibling loader module has to finish registering
// its restricted TypeScript hooks before Node resolves extensionless TS imports.
const { hashPassword } = await import("../server/auth.ts");
const {
  databaseMatchesFrozenSchema37Contract,
  inspectLockedBackupDatabase,
} = await import("../server/backupInspection.ts");
const {
  applyPendingSchemaMigrationsInTransaction,
  currentSchemaVersion,
  databaseMatchesMigrationManifest,
  databaseMatchesSchemaContract,
} = await import("../server/database.ts");
const { migrateSchema37To39 } = await import("../server/schemaMigration.ts");

const contract = "unboundry-v051-exact-runtime-rehearsal-v3";
const timestamp = "2026-08-12T00:00:00.000Z";
const ownerId = "00000000-0000-4000-8000-000000000592";
const canvasId = "v051-exact-wire-canvas";
const loginPassword = "v051-exact-wire-password-123";
const expectedRejection =
  "Unknown database migration 38:durable-media-publications";

function fail(message) {
  throw new Error(`[v051-exact-runtime] ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) && difference !== ".." &&
      !difference.startsWith(`..${sep}`));
}

function physicalDirectory(path, label, requirePrivateMode = true) {
  if (!path || resolve(path) !== path) fail(`${label} must be normalized and absolute`);
  const details = lstatSync(path);
  const canonical = realpathSync(path);
  if (
    canonical !== path || details.isSymbolicLink() || !details.isDirectory() ||
    (requirePrivateMode && (details.mode & 0o077) !== 0) ||
    typeof process.getuid !== "function" ||
    details.uid !== process.getuid()
  ) fail(
    `${label} must be an owned ${
      requirePrivateMode ? "private " : ""
    }physical directory`,
  );
  return canonical;
}

function safeRunnerInput() {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    fail("UNBOUNDRY_SAFE_TEST=1 is required");
  }
  let input;
  try {
    input = JSON.parse(String(process.argv[2] ?? ""));
  } catch {
    fail("one JSON input argument is required");
  }
  const lexicalTestRoot = resolve(String(process.env.UNBOUNDRY_TEST_ROOT ?? ""));
  const lexicalSourceRoot = resolve(String(
    process.env.UNBOUNDRY_TEST_REPOSITORY_ROOT ?? "",
  ));
  const testRoot = physicalDirectory(
    realpathSync(lexicalTestRoot),
    "Safe test root",
  );
  const sourceRoot = physicalDirectory(
    realpathSync(lexicalSourceRoot),
    "Safe source root",
    false,
  );
  if (testRoot !== lexicalTestRoot || sourceRoot !== lexicalSourceRoot) {
    fail("safe roots must not use lexical aliases");
  }
  const systemTemporaryRoot = realpathSync(String(
    process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT ?? "",
  ));
  if (
    !containsPath(systemTemporaryRoot, testRoot) ||
    !containsPath(systemTemporaryRoot, sourceRoot)
  ) fail("safe roots must stay inside the system temporary directory");
  const expectedNodeOptions =
    `--import=${join(sourceRoot, "scripts/offline-network-guard.mjs")}`;
  if (process.env.NODE_OPTIONS !== expectedNodeOptions) {
    fail("the offline network guard is not preloaded");
  }
  const lexicalSentinel = resolve(String(
    process.env.UNBOUNDRY_SAFE_RUN_SENTINEL ?? "",
  ));
  const sentinel = realpathSync(lexicalSentinel);
  if (sentinel !== lexicalSentinel) fail("safe-run sentinel must not use an alias");
  if (!containsPath(testRoot, sentinel)) fail("safe-run sentinel escaped the test root");
  const sentinelDetails = lstatSync(sentinel);
  if (
    !sentinelDetails.isFile() || sentinelDetails.isSymbolicLink() ||
    sentinelDetails.nlink !== 1 ||
    (sentinelDetails.mode & 0o777) !== 0o600 ||
    typeof process.getuid !== "function" ||
    sentinelDetails.uid !== process.getuid() ||
    (awaitReadUtf8(sentinel).trim() !== process.env.UNBOUNDRY_SAFE_RUN_NONCE)
  ) fail("safe-run sentinel is invalid");
  const lexicalRuntimeRoot = resolve(String(input?.runtimeRoot ?? ""));
  const lexicalWorkRoot = resolve(String(input?.workRoot ?? ""));
  const runtimeRoot = physicalDirectory(
    realpathSync(lexicalRuntimeRoot),
    "Exact-tag runtime root",
  );
  const workRoot = physicalDirectory(
    realpathSync(lexicalWorkRoot),
    "Rehearsal work root",
  );
  if (runtimeRoot !== lexicalRuntimeRoot || workRoot !== lexicalWorkRoot) {
    fail("rehearsal roots must not use lexical aliases");
  }
  const outputPath = resolve(String(input?.outputPath ?? ""));
  if (
    !containsPath(testRoot, runtimeRoot) || !containsPath(testRoot, workRoot) ||
    !containsPath(workRoot, outputPath)
  ) fail("rehearsal paths must stay inside the safe test root");
  const port = Number(input?.port);
  if (
    !Number.isInteger(port) || port < 1 || port > 65_535 || port === 4173 ||
    port !== Number(process.env.UNBOUNDRY_TEST_AUX_PORT)
  ) fail("the rehearsal port is not the runner-assigned auxiliary port");
  const nonce = String(input?.nonce ?? "");
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(nonce)) {
    fail("the runner nonce is invalid");
  }
  return Object.freeze({ nonce, outputPath, port, runtimeRoot, sourceRoot, workRoot });
}

function awaitReadUtf8(path) {
  const descriptor = openSync(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const details = lstatSync(path);
    const buffer = Buffer.alloc(details.size);
    const bytes = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < buffer.length) {
      const count = Math.min(bytes.length, buffer.length - offset);
      const read = readSync(descriptor, bytes, 0, count, offset);
      if (read === 0) break;
      bytes.copy(buffer, offset, 0, read);
      offset += read;
    }
    bytes.fill(0);
    return buffer.toString("utf8", 0, offset);
  } finally {
    closeSync(descriptor);
  }
}

const preservedRichNode = Object.freeze({
  data: Object.freeze({
    label: "v0.5.1 exact unknown-data node",
    rem009bUnknownEnvelope: Object.freeze({
      futureFlag: true,
      nested: Object.freeze(["preserve", 39, Object.freeze({ wire: "unknown" })]),
    }),
    textGenerationInputKey: "v051-exact-input-key",
    textGenerationOwnershipKey: "v051-exact-ownership-key",
    textGenerationTaskId: "v051-exact-task-id",
    textModelId: "v051-exact-model-id",
    textModelName: "v0.5.1 exact model",
    textParameters: Object.freeze({ maxOutputTokens: 92, temperature: 0.2 }),
    textPrompt: "v0.5.1 exact preserved prompt",
    title: "v0.5.1 preserved node",
  }),
  id: "v051-exact-node",
  position: Object.freeze({ x: 92, y: 37 }),
  type: "text",
});

const hiddenCommitNode = Object.freeze({
  ...preservedRichNode,
  data: Object.freeze({
    ...preservedRichNode.data,
    rem009bUnknownEnvelope: Object.freeze({
      futureFlag: false,
      nested: Object.freeze(["hidden-commit", 39, Object.freeze({ wire: "unknown" })]),
    }),
    title: "v0.5.1 hidden commit",
  }),
});

const viewport = Object.freeze({ x: 12, y: 24, zoom: 1.25 });

async function createExactSchema37Fixture(dataDirectory) {
  await mkdir(dataDirectory, { mode: 0o700 });
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "PRAGMA foreign_keys = ON;" +
        "CREATE TABLE IF NOT EXISTS schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    );BEGIN IMMEDIATE;",
    );
    applyPendingSchemaMigrationsInTransaction(database, {
      appliedAt: () => timestamp,
      sourceVersion: 0,
      targetVersion: 37,
    });
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at, protected
      ) VALUES (?, 'v051-exact-owner', 'v0.5.1 Exact Owner', ?, 'admin',
        'active', ?, ?, 1)
    `).run(ownerId, await hashPassword(loginPassword), timestamp, timestamp);
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at, deleted_at
      ) VALUES (?, ?, 'v0.5.1 exact project', 37, 1, 37, NULL)
    `).run(ownerId, canvasId);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, 7, 7, ?, '[]', ?, ?, 'v051-legacy-writer', 7)
    `).run(
      ownerId,
      canvasId,
      JSON.stringify([preservedRichNode]),
      JSON.stringify(viewport),
      timestamp,
    );
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 0, emergency_stop = 0, updated_at = ?
      WHERE id = 1
    `).run(timestamp);
    if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) {
      fail("schema-37 fixture violates foreign keys");
    }
    database.exec("COMMIT; PRAGMA journal_mode = DELETE;");
    if (!databaseMatchesFrozenSchema37Contract(database)) {
      fail("fixture is not the exact frozen schema-37 contract");
    }
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
  await chmod(databasePath, 0o600);
  return databasePath;
}

async function directoryFingerprint(root) {
  const entries = [];
  async function visit(directory, relativePath = "") {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of children) {
      const childRelative = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(`d:${childRelative}`);
        await visit(absolute, childRelative);
      } else if (entry.isFile()) {
        const metadata = await stat(absolute);
        entries.push(
          `f:${childRelative}:${metadata.size}:${sha256(await readFile(absolute))}`,
        );
      } else {
        entries.push(`o:${childRelative}`);
      }
    }
  }
  await visit(root);
  return entries.sort();
}

function logicalSha(databasePath, scratchRoot) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("BEGIN IMMEDIATE");
    return inspectLockedBackupDatabase(database, scratchRoot).logicalSha256;
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
}

function normalizeCurrentRollbackBaseline(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    const migrationJournalMode = database.prepare("PRAGMA journal_mode").get()
      ?.journal_mode;
    if (
      migrationJournalMode !== "wal" ||
      !databaseMatchesMigrationManifest(database) ||
      !databaseMatchesSchemaContract(database) ||
      database.prepare("PRAGMA foreign_key_check").all().length !== 0 ||
      database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    ) fail("one-shot migration did not leave a valid current WAL database");
    const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (
      checkpoint?.busy !== 0 || checkpoint?.log !== 0 ||
      checkpoint?.checkpointed !== 0
    ) fail("current rollback baseline WAL checkpoint did not truncate cleanly");
    const normalizedJournalMode = database.prepare(
      "PRAGMA journal_mode = DELETE",
    ).get()?.journal_mode;
    if (
      normalizedJournalMode !== "delete" ||
      !databaseMatchesMigrationManifest(database) ||
      !databaseMatchesSchemaContract(database) ||
      database.prepare("PRAGMA foreign_key_check").all().length !== 0 ||
      database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok"
    ) fail("current rollback baseline did not normalize safely to DELETE mode");
    return Object.freeze({
      checkpoint: Object.freeze({
        busy: checkpoint.busy,
        checkpointed: checkpoint.checkpointed,
        log: checkpoint.log,
      }),
      migrationJournalMode,
    });
  } finally {
    database.close();
  }
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(child, timeoutMilliseconds, message) {
  if (childExited(child)) return;
  await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", exited);
      reject(new Error(message));
    }, timeoutMilliseconds);
    const exited = () => {
      clearTimeout(timer);
      resolveExit();
    };
    child.once("exit", exited);
  });
}

async function stopServer(child) {
  if (childExited(child)) return;
  child.kill("SIGTERM");
  try {
    await waitForExit(child, 5_000, "old server did not stop after SIGTERM");
  } catch {
    if (!childExited(child)) child.kill("SIGKILL");
    await waitForExit(child, 5_000, "old server did not stop after SIGKILL");
  }
}

async function startOldServer(runtimeRoot, dataDirectory, port) {
  const output = [];
  const child = spawn(
    process.execPath,
    [
      join(runtimeRoot, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (childExited(child)) break;
    try {
      const version = await fetch(`${origin}/api/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (version.ok) return { child, origin, output };
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  await stopServer(child);
  fail(`exact v0.5.1 server did not listen\n${Buffer.concat(output).toString("utf8")}`);
}

async function jsonRequest(origin, path, options = {}) {
  const { cookie, headers, ...requestOptions } = options;
  const response = await fetch(`${origin}${path}`, {
    ...requestOptions,
    headers: {
      ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
  });
  const text = await response.text();
  return Object.freeze({
    body: text ? JSON.parse(text) : {},
    headers: response.headers,
    status: response.status,
  });
}

async function rehearse(input) {
  const dataDirectory = join(input.workRoot, "data");
  const databasePath = await createExactSchema37Fixture(dataDirectory);
  const initialSchema37LogicalSha256 = logicalSha(databasePath, input.workRoot);
  let oldServer;
  let version;
  let login;
  let sessionCookie;
  let oldLoad;
  let hiddenCommit;
  let oldReload;
  try {
    oldServer = await startOldServer(input.runtimeRoot, dataDirectory, input.port);
    version = await jsonRequest(oldServer.origin, "/api/version");
    if (version.status !== 200 || version.body.version !== "0.5.1") {
      fail("exact-tag version endpoint did not return v0.5.1");
    }
    login = await jsonRequest(oldServer.origin, "/api/auth/login", {
      body: JSON.stringify({ loginName: "v051-exact-owner", password: loginPassword }),
      method: "POST",
    });
    sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    if (
      login.status !== 200 ||
      !sessionCookie?.startsWith("unboundry_session=")
    ) {
      fail("exact-tag login failed");
    }
    oldLoad = await jsonRequest(oldServer.origin, `/api/canvas/${canvasId}`, {
      cookie: sessionCookie,
    });
    if (
      oldLoad.status !== 200 || oldLoad.body.revision !== 7 ||
      JSON.stringify(oldLoad.body.nodes) !== JSON.stringify([preservedRichNode]) ||
      "loadToken" in oldLoad.body || "saveEpoch" in oldLoad.body
    ) fail("exact-tag old wire load did not preserve the frozen document shape");
    hiddenCommit = await jsonRequest(oldServer.origin, `/api/canvas/${canvasId}`, {
      body: JSON.stringify({
        edges: [],
        nodes: [hiddenCommitNode],
        observedLoadToken: `v1.${"A".repeat(43)}`,
        observedRevision: 7,
        revision: 7,
        saveAttemptId: "v051-current-attempt",
        saveSequence: 8,
        saveSessionId: "v051-current-session",
        viewport,
      }),
      cookie: sessionCookie,
      method: "PUT",
    });
    if (
      hiddenCommit.status !== 200 || hiddenCommit.body.revision !== 8 ||
      hiddenCommit.body.graphRevision !== 8 || "loadToken" in hiddenCommit.body ||
      JSON.stringify(Object.keys(hiddenCommit.body).sort()) !==
        JSON.stringify(["graphRevision", "revision"])
    ) fail("exact-tag old server did not make the expected hidden commit");
    oldReload = await jsonRequest(oldServer.origin, `/api/canvas/${canvasId}`, {
      cookie: sessionCookie,
    });
    if (
      oldReload.status !== 200 || oldReload.body.revision !== 8 ||
      JSON.stringify(oldReload.body.nodes) !== JSON.stringify([hiddenCommitNode])
    ) fail("exact-tag old server did not preserve unknown node data after commit");
  } finally {
    if (oldServer) await stopServer(oldServer.child);
  }

  const committed = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = committed.prepare(`
      SELECT revision, nodes FROM canvas_documents
      WHERE owner_id = ? AND id = ?
    `).get(ownerId, canvasId);
    if (
      row?.revision !== 8 ||
      row?.nodes !== JSON.stringify([hiddenCommitNode])
    ) fail("hidden commit is absent from the exact schema-37 database");
  } finally {
    committed.close();
  }

  const hiddenCommitLogicalSha256 = logicalSha(databasePath, input.workRoot);
  if (hiddenCommitLogicalSha256 === initialSchema37LogicalSha256) {
    fail("exact-tag hidden commit did not change the schema-37 logical snapshot");
  }
  process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK = "1";
  const migrated = await migrateSchema37To39({
    dataDirectory,
    expectedSourceLogicalSha256: hiddenCommitLogicalSha256,
    mode: "apply",
    scratchRoot: input.workRoot,
    testClock: { drainMilliseconds: 0, sleep: async () => undefined },
  });
  if (
    migrated.status !== "complete" || migrated.sourceVersion !== 37 ||
    migrated.targetVersion !== currentSchemaVersion || !migrated.targetLogicalSha256
  ) fail("one-shot migration did not publish exact schema 39");

  const rollbackBaseline = normalizeCurrentRollbackBaseline(databasePath);
  const beforeRejectedLogicalSha256 = logicalSha(databasePath, input.workRoot);
  if (beforeRejectedLogicalSha256 !== migrated.targetLogicalSha256) {
    fail("current rollback baseline changed the migrated logical snapshot");
  }
  const beforeRejectedDatabaseSha256 = sha256(await readFile(databasePath));
  const beforeRejectedFingerprint = await directoryFingerprint(dataDirectory);
  const beforeRejectedEntries = (await readdir(dataDirectory)).sort();
  if (
    beforeRejectedEntries.includes("unboundry.sqlite-shm") ||
    beforeRejectedEntries.includes("unboundry.sqlite-wal")
  ) fail("rollback rehearsal must begin without SQLite sidecars");
  const beforeRejected = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const journal = beforeRejected.prepare("PRAGMA journal_mode").get();
    if (journal?.journal_mode !== "delete") {
      fail("normalized rollback baseline must begin in DELETE mode");
    }
  } finally {
    beforeRejected.close();
  }

  let rejectedRequest;
  let rejectedServer;
  try {
    rejectedServer = await startOldServer(input.runtimeRoot, dataDirectory, input.port);
    const rejectedVersion = await jsonRequest(rejectedServer.origin, "/api/version");
    if (rejectedVersion.status !== 200 || rejectedVersion.body.version !== "0.5.1") {
      fail("old binary did not expose its version before opening schema 39");
    }
    rejectedRequest = await fetch(
      `${rejectedServer.origin}/api/canvas/${canvasId}`,
      {
        headers: { cookie: sessionCookie },
        signal: AbortSignal.timeout(5_000),
      },
    ).then(async (response) => Object.freeze({
      body: (await response.text()).slice(0, 4_000),
      kind: "response",
      status: response.status,
    }), (error) => Object.freeze({
      error: String(error?.message ?? error).slice(0, 1_000),
      kind: "fetch-error",
    }));
    if (rejectedRequest.kind !== "fetch-error") {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      fail(`the first old database request resolved: ${JSON.stringify({
        childExitCode: rejectedServer.child.exitCode,
        childSignalCode: rejectedServer.child.signalCode,
        processOutput: Buffer.concat(rejectedServer.output)
          .toString("utf8")
          .slice(-8_000),
        request: rejectedRequest,
      })}`);
    }
    await waitForExit(
      rejectedServer.child,
      5_000,
      "exact v0.5.1 process did not terminate on schema 39",
    );
    if (rejectedServer.child.exitCode === 0) {
      fail("exact v0.5.1 process exited successfully after rejecting schema 39");
    }
    if (!Buffer.concat(rejectedServer.output).toString("utf8").includes(expectedRejection)) {
      fail("exact v0.5.1 rejection message was not observed");
    }
  } finally {
    if (rejectedServer) await stopServer(rejectedServer.child);
  }

  const runtimeEntries = (await readdir(dataDirectory)).sort();
  const allowedRuntimeEntries = new Set([
    "unboundry.sqlite",
    "unboundry.sqlite-shm",
    "unboundry.sqlite-wal",
  ]);
  if (runtimeEntries.some((entry) => !allowedRuntimeEntries.has(entry))) {
    fail(`old rejection left an unexpected data entry: ${JSON.stringify(
      runtimeEntries,
    )}`);
  }
  const sidecarsAfterExit = runtimeEntries.filter((entry) =>
    entry === "unboundry.sqlite-shm" || entry === "unboundry.sqlite-wal"
  );
  const afterRejectedFingerprint = await directoryFingerprint(dataDirectory);
  const afterRejectedDatabaseSha256 = sha256(await readFile(databasePath));
  const afterRejected = new DatabaseSync(databasePath, { readOnly: true });
  let journalMode;
  let userVersion;
  let latestMigration;
  let integrity;
  try {
    journalMode = afterRejected.prepare("PRAGMA journal_mode").get()?.journal_mode;
    userVersion = afterRejected.prepare("PRAGMA user_version").get()?.user_version;
    latestMigration = afterRejected.prepare(`
      SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1
    `).get();
    integrity = afterRejected.prepare("PRAGMA integrity_check").get()?.integrity_check;
  } finally {
    afterRejected.close();
  }
  const afterRejectedLogicalSha256 = logicalSha(databasePath, input.workRoot);
  if (
    JSON.stringify(afterRejectedFingerprint) ===
      JSON.stringify(beforeRejectedFingerprint) ||
    afterRejectedDatabaseSha256 === beforeRejectedDatabaseSha256 ||
    journalMode !== "wal" || userVersion !== 39 ||
    latestMigration?.version !== 39 ||
    latestMigration?.name !== "atomic-generation-admission-and-credential-scope" ||
    integrity !== "ok" || afterRejectedLogicalSha256 !== beforeRejectedLogicalSha256
  ) fail(`exact v0.5.1 schema-39 rejection evidence is incomplete: ${
    JSON.stringify({
      afterLogicalSha256: afterRejectedLogicalSha256,
      beforeLogicalSha256: beforeRejectedLogicalSha256,
      databaseBytesChanged:
        afterRejectedDatabaseSha256 !== beforeRejectedDatabaseSha256,
      directoryFingerprintChanged:
        JSON.stringify(afterRejectedFingerprint) !==
          JSON.stringify(beforeRejectedFingerprint),
      integrity,
      journalMode,
      latestMigration,
      processExitCode: rejectedServer.child.exitCode,
      processOutput: Buffer.concat(rejectedServer.output)
        .toString("utf8")
        .slice(-8_000),
      processSignalCode: rejectedServer.child.signalCode,
      rejectedRequest,
      runtimeEntries,
      userVersion,
    })
  }`);

  return Object.freeze({
    contract,
    nonce: input.nonce,
    schema37Wire: Object.freeze({
      acceptsCurrentFenceFields: true,
      hiddenCommitGraphRevision: 8,
      hiddenCommitRevision: 8,
      loadIncludesLoadToken: false,
      loginStatus: login.status,
      oldSuccessIncludesLoadToken: false,
      preservesUnknownNodeData: true,
      reloadRevision: oldReload.body.revision,
      hiddenCommitLogicalSha256,
      initialSchema37LogicalSha256,
      version: version.body.version,
      versionStatus: version.status,
    }),
    schema39Rejection: Object.freeze({
      afterLogicalSha256: afterRejectedLogicalSha256,
      beforeLogicalSha256: beforeRejectedLogicalSha256,
      databaseBytesChanged: afterRejectedDatabaseSha256 !==
        beforeRejectedDatabaseSha256,
      firstDatabaseRequestFailed: true,
      integrityCheck: integrity,
      journalModeAfter: journalMode,
      journalModeBefore: "delete",
      latestMigration,
      logicalRowsUnchanged: afterRejectedLogicalSha256 ===
        beforeRejectedLogicalSha256,
      migrationJournalModeBeforeNormalization:
        rollbackBaseline.migrationJournalMode,
      processExitCode: rejectedServer.child.exitCode,
      rejectionMessage: expectedRejection,
      requestTransportFailed: rejectedRequest.kind === "fetch-error",
      rollbackBaselineNormalizedByCurrent: true,
      rollbackCheckpoint: rollbackBaseline.checkpoint,
      sidecarsAfterExit: Object.freeze(sidecarsAfterExit),
      userVersion,
      versionEndpointBeforeDatabaseOpen: true,
    }),
  });
}

async function writeEvidence(path, evidence) {
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o400,
  });
  chmodSync(path, 0o400);
  const descriptor = openSync(path, fileConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

const input = safeRunnerInput();
const evidence = await rehearse(input);
await writeEvidence(input.outputPath, evidence);
process.stdout.write(`${JSON.stringify({
  contract: evidence.contract,
  evidenceSha256: sha256(await readFile(input.outputPath)),
  status: "pass",
})}\n`);
