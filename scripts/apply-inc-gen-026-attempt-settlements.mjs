import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inspectionScriptPath = join(
  applicationRoot,
  "scripts",
  "inspect-inc-gen-026-attempt-settlements.mjs",
);
const applyScriptPath = fileURLToPath(import.meta.url);
const classifierPath = join(
  applicationRoot,
  "server",
  "generationProviderOutcome.ts",
);

class ApplyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new ApplyError(code, message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function canonical(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  return sha256(canonical(value));
}

function parseArguments(argv) {
  const values = new Map();
  let apply = false;
  const allowed = new Set(["--data-dir", "--manifest", "--manifest-sha256"]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--apply") {
      if (apply) fail("IG26_APPLY_ARGUMENT_INVALID", "Apply flag is duplicated");
      apply = true;
      continue;
    }
    if (!allowed.has(option) || values.has(option)) {
      fail("IG26_APPLY_ARGUMENT_INVALID", "Unknown or duplicated apply argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("IG26_APPLY_ARGUMENT_INVALID", "Apply argument value is missing");
    }
    values.set(option, value);
    index += 1;
  }
  if (!apply || [...allowed].some((key) => !values.has(key))) {
    fail(
      "IG26_APPLY_ARGUMENT_INVALID",
      "Apply requires --apply, data directory, manifest, and exact manifest SHA-256",
    );
  }
  for (const key of ["--data-dir", "--manifest"]) {
    const value = values.get(key);
    if (!isAbsolute(value) || normalize(value) !== value || resolve(value) !== value) {
      fail("IG26_APPLY_ARGUMENT_INVALID", "All paths must be normalized and absolute");
    }
  }
  if (!/^[a-f0-9]{64}$/.test(values.get("--manifest-sha256"))) {
    fail("IG26_APPLY_ARGUMENT_INVALID", "Manifest SHA-256 is invalid");
  }
  return {
    dataDirectory: values.get("--data-dir"),
    manifestPath: values.get("--manifest"),
    manifestSha256: values.get("--manifest-sha256"),
  };
}

function privateRegularFile(path, code) {
  const details = lstatSync(path, { bigint: true });
  const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : undefined;
  if (
    uid === undefined || !details.isFile() || details.isSymbolicLink() ||
    details.uid !== uid || details.nlink !== 1n || (details.mode & 0o022n) !== 0n
  ) fail(code, "Selected file must be a private, owned, regular file");
  return realpathSync(path);
}

function selectedDatabase(dataDirectory) {
  const requested = realpathSync(dataDirectory);
  const details = lstatSync(requested, { bigint: true });
  const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : undefined;
  const lowered = requested.toLowerCase();
  const testShaped = ["/tmp/", "/private/var/folders/", "test", "fixture", "rehearsal", "inspect"]
    .some((marker) => lowered.includes(marker));
  const explicitProduction = ["/var/lib/", "/srv/", "/opt/", "/library/application support/"]
    .some((marker) => lowered.includes(marker));
  let configured;
  if (process.env.UNBOUNDRY_DATA_DIR) {
    try {
      configured = realpathSync(process.env.UNBOUNDRY_DATA_DIR);
    } catch {
      configured = undefined;
    }
  }
  if (
    uid === undefined || !details.isDirectory() || details.isSymbolicLink() ||
    details.uid !== uid || (details.mode & 0o022n) !== 0n ||
    !testShaped || explicitProduction || configured === requested
  ) fail(
    "IG26_APPLY_PRODUCTION_REFUSED",
    "Apply accepts only a private non-production snapshot directory",
  );
  const databasePath = privateRegularFile(
    join(requested, "unboundry.sqlite"),
    "IG26_APPLY_DATABASE_INVALID",
  );
  if (dirname(databasePath) !== requested) {
    fail("IG26_APPLY_DATABASE_INVALID", "Database escapes the selected directory");
  }
  return { databasePath, dataDirectory: requested };
}

function readManifest(input) {
  const manifestPath = privateRegularFile(
    input.manifestPath,
    "IG26_APPLY_MANIFEST_INVALID",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { manifestSha256, ...base } = manifest;
  const calculated = sha256(canonical(base));
  if (
    calculated !== input.manifestSha256 || manifestSha256 !== calculated ||
    manifest.manifestSchemaVersion !== 1 || manifest.mode !== "dry-run" ||
    manifest.schemaVersion !== 42 || !Array.isArray(manifest.entries) ||
    !Array.isArray(manifest.blocked) || manifest.blocked.length > 0 ||
    manifest.entries.length < 1 || manifest.source?.type !== "schema42-snapshot"
  ) fail("IG26_APPLY_MANIFEST_INVALID", "Manifest identity or contract is invalid");
  const safeSnapshotHead = process.env.UNBOUNDRY_SAFE_TEST === "1"
    ? process.env.UNBOUNDRY_SOURCE_HEAD
    : undefined;
  const head = /^[a-f0-9]{40}$/.test(safeSnapshotHead ?? "")
    ? safeSnapshotHead
    : execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: applicationRoot,
        encoding: "utf8",
      }).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) {
    fail("IG26_APPLY_TOOL_DRIFT", "Tool source HEAD is unavailable or invalid");
  }
  if (
    manifest.tool?.head !== head ||
    manifest.tool?.scriptSha256 !== sha256(readFileSync(inspectionScriptPath)) ||
    manifest.tool?.applyScriptSha256 !== sha256(readFileSync(applyScriptPath)) ||
    manifest.tool?.classifierSha256 !== sha256(readFileSync(classifierPath))
  ) fail("IG26_APPLY_TOOL_DRIFT", "Tool HEAD or inspection script changed after dry-run");
  if (
    typeof manifest.source?.evidencePath !== "string" ||
    !/^[a-f0-9]{64}$/.test(String(manifest.source?.evidenceSha256 ?? "")) ||
    sha256(readFileSync(privateRegularFile(
      manifest.source.evidencePath,
      "IG26_APPLY_EVIDENCE_INVALID",
    ))) !== manifest.source.evidenceSha256
  ) fail("IG26_APPLY_EVIDENCE_INVALID", "Terminal evidence changed after dry-run");
  return manifest;
}

function rowEvidence(row) {
  return {
    attempt: {
      executionAttempt: Number(row.execution_attempt),
      failureCode: row.failure_code,
      finishedAt: row.finished_at,
      outcome: row.outcome,
      providerModelId: row.provider_model_id,
      providerProfileId: row.provider_profile_id,
      providerTaskId: row.attempt_provider_task_id,
    },
    task: {
      errorCode: row.error_code,
      errorMessage: row.error_message,
      id: row.task_id,
      ownerId: row.owner_id,
      providerTaskId: row.task_provider_task_id,
      state: row.task_state,
      updatedAt: row.updated_at,
    },
  };
}

function readCandidate(database, taskId, executionAttempt) {
  return database.prepare(`
    SELECT
      task.id AS task_id, task.owner_id, task.state AS task_state,
      task.error_code, task.error_message, task.provider_task_id AS task_provider_task_id,
      task.updated_at, attempt.execution_attempt, attempt.provider_profile_id,
      attempt.provider_model_id, attempt.outcome, attempt.provider_task_id AS attempt_provider_task_id,
      attempt.failure_code, attempt.finished_at
    FROM generation_tasks AS task
    JOIN generation_provider_attempts AS attempt ON attempt.task_id = task.id
    WHERE task.id = ? AND attempt.execution_attempt = ? AND task.attempt = ?
  `).get(taskId, executionAttempt, executionAttempt);
}

function main() {
  const input = parseArguments(process.argv.slice(2));
  const source = selectedDatabase(input.dataDirectory);
  const manifest = readManifest(input);
  const databaseDetails = statSync(source.databasePath, { bigint: true });
  if (
    manifest.source.databasePath !== source.databasePath ||
    manifest.source.databaseDevice !== databaseDetails.dev.toString() ||
    manifest.source.databaseInode !== databaseDetails.ino.toString()
  ) fail("IG26_APPLY_SOURCE_DRIFT", "Selected database is not the inspected source");
  const database = new DatabaseSync(source.databasePath, { timeout: 5_000 });
  let applied = 0;
  let noOp = 0;
  try {
    const schemaVersion = Number(database.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get()?.version);
    if (schemaVersion !== 42) {
      fail("IG26_APPLY_SCHEMA_UNSUPPORTED", "Attempt settlement requires exact schema42");
    }
    database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    try {
      const decisions = manifest.entries.map((entry) => {
        if (
          entry.classification !== "settle-terminal-failure" ||
          typeof entry.expectedChanges?.attemptFailureCode !== "string" ||
          entry.expectedChanges.attemptFailureCode.length < 1 ||
          entry.expectedChanges.attemptFailureCode.length > 200 ||
          entry.expectedChanges?.attemptOutcome !== "provider-failed" ||
          entry.expectedChanges?.taskMutation !== "none" ||
          !Number.isFinite(Date.parse(entry.expectedChanges?.attemptFinishedAt)) ||
          !/^[a-f0-9]{64}$/.test(String(entry.beforeFingerprint ?? "")) ||
          !/^[a-f0-9]{64}$/.test(String(entry.afterFingerprint ?? "")) ||
          typeof entry.taskId !== "string" || entry.taskId.length < 1 ||
          entry.taskId.length > 200 ||
          !Number.isSafeInteger(entry.executionAttempt) ||
          entry.executionAttempt < 1
        ) fail("IG26_APPLY_MANIFEST_INVALID", "Manifest entry exceeds the frozen mutation scope");
        const row = readCandidate(database, entry.taskId, entry.executionAttempt);
        if (!row) fail("IG26_APPLY_ROW_DRIFT", "Inspected task or attempt no longer exists");
        const currentFingerprint = fingerprint(rowEvidence(row));
        if (currentFingerprint === entry.afterFingerprint) return { entry, state: "after" };
        if (currentFingerprint !== entry.beforeFingerprint) {
          fail("IG26_APPLY_ROW_DRIFT", "Task or attempt evidence changed after dry-run");
        }
        if (
          row.task_state !== "failed" || row.outcome === "provider-failed" ||
          row.failure_code !== entry.expectedChanges.attemptFailureCode ||
          row.finished_at !== null
        ) fail("IG26_APPLY_PREDICATE_FAILED", "Settlement predicate no longer matches");
        return { entry, state: "before" };
      });
      for (const decision of decisions) {
        if (decision.state === "after") {
          noOp += 1;
          continue;
        }
        const entry = decision.entry;
        const result = database.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = 'provider-failed', finished_at = ?
          WHERE task_id = ? AND execution_attempt = ?
            AND outcome IN ('accepted', 'response-received')
            AND failure_code = ? AND finished_at IS NULL
        `).run(
          entry.expectedChanges.attemptFinishedAt,
          entry.taskId,
          entry.executionAttempt,
          entry.expectedChanges.attemptFailureCode,
        );
        if (result.changes !== 1) {
          fail("IG26_APPLY_CONCURRENT_CHANGE", "Attempt changed during settlement");
        }
        const after = readCandidate(database, entry.taskId, entry.executionAttempt);
        if (!after || fingerprint(rowEvidence(after)) !== entry.afterFingerprint) {
          fail("IG26_APPLY_AFTER_MISMATCH", "Applied attempt does not match the manifest");
        }
        applied += 1;
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  process.stdout.write(`${JSON.stringify({
    applied,
    historyPreserved: true,
    manifestSha256: input.manifestSha256,
    noOp,
    ok: true,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    code: error instanceof ApplyError ? error.code : "IG26_APPLY_FAILED",
    error: error instanceof Error ? error.message : "Attempt settlement failed",
    ok: false,
  })}\n`);
  process.exitCode = 1;
}
