import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  classifyGenerationProviderOutcome,
  generationOutcomeAdapterId,
} from "../server/generationProviderOutcome.ts";

const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const applyScriptPath = join(
  applicationRoot,
  "scripts",
  "apply-inc-gen-026-attempt-settlements.mjs",
);
const classifierPath = join(
  applicationRoot,
  "server",
  "generationProviderOutcome.ts",
);

class InspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new InspectionError(code, message);
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

function parseArguments(argv) {
  const values = new Map();
  const allowed = new Set([
    "--data-dir",
    "--evidence",
    "--fixture",
    "--manifest-out",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!allowed.has(option) || values.has(option)) {
      fail("IG26_INSPECT_ARGUMENT_INVALID", "Unknown or duplicated inspection argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("IG26_INSPECT_ARGUMENT_INVALID", "Inspection argument value is missing");
    }
    values.set(option, value);
    index += 1;
  }
  if (
    values.has("--data-dir") === values.has("--fixture") ||
    !values.has("--manifest-out") ||
    (values.has("--data-dir") !== values.has("--evidence"))
  ) fail(
    "IG26_INSPECT_ARGUMENT_INVALID",
    "Choose a fixture, or an explicit data directory with exact terminal evidence",
  );
  for (const value of values.values()) {
    if (!isAbsolute(value) || normalize(value) !== value || resolve(value) !== value) {
      fail("IG26_INSPECT_ARGUMENT_INVALID", "All paths must be normalized and absolute");
    }
  }
  return {
    dataDirectory: values.get("--data-dir"),
    evidencePath: values.get("--evidence"),
    fixturePath: values.get("--fixture"),
    manifestPath: values.get("--manifest-out"),
  };
}

function isInside(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (
    !isAbsolute(difference) && difference !== ".." &&
    !difference.startsWith(`..${sep}`)
  );
}

async function privateRegularFile(path, code) {
  const details = await lstat(path).catch(() => undefined);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    uid === undefined || !details?.isFile() || details.isSymbolicLink() ||
    details.uid !== uid || details.nlink !== 1 || (details.mode & 0o022) !== 0
  ) fail(code, "Selected file must be a private, owned, regular file");
  return realpath(path);
}

async function inspectionDatabase(dataDirectory) {
  const requested = await realpath(dataDirectory).catch(() => undefined);
  const details = requested ? await lstat(requested).catch(() => undefined) : undefined;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    !requested || uid === undefined || !details?.isDirectory() ||
    details.isSymbolicLink() || details.uid !== uid || (details.mode & 0o022) !== 0
  ) fail("IG26_INSPECT_DATA_INVALID", "Inspection data directory is not private and owned");
  const lowered = requested.toLowerCase();
  const testShaped = ["/tmp/", "/private/var/folders/", "test", "fixture", "rehearsal", "inspect"]
    .some((marker) => lowered.includes(marker));
  const explicitProduction = ["/var/lib/", "/srv/", "/opt/", "/library/application support/"]
    .some((marker) => lowered.includes(marker));
  let configuredDataDirectory;
  if (process.env.UNBOUNDRY_DATA_DIR) {
    configuredDataDirectory = await realpath(process.env.UNBOUNDRY_DATA_DIR)
      .catch(() => undefined);
  }
  if (!testShaped || explicitProduction || configuredDataDirectory === requested) {
    fail(
      "IG26_INSPECT_PRODUCTION_REFUSED",
      "Inspection accepts only a private non-production snapshot directory",
    );
  }
  const databasePath = await privateRegularFile(
    join(requested, "unboundry.sqlite"),
    "IG26_INSPECT_DATABASE_INVALID",
  );
  if (dirname(databasePath) !== requested) {
    fail("IG26_INSPECT_DATABASE_INVALID", "Database escapes the selected directory");
  }
  return { dataDirectory: requested, databasePath };
}

function toolIdentity() {
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
    fail("IG26_INSPECT_TOOL_INVALID", "Tool source HEAD is unavailable or invalid");
  }
  return {
    applyScriptSha256: sha256(readFileSync(applyScriptPath)),
    classifierSha256: sha256(readFileSync(classifierPath)),
    head,
    scriptSha256: sha256(readFileSync(scriptPath)),
  };
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

function fingerprint(value) {
  return sha256(canonical(value));
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

async function terminalEvidence(evidencePath, source) {
  const canonicalPath = await privateRegularFile(
    evidencePath,
    "IG26_INSPECT_EVIDENCE_INVALID",
  );
  const bytes = await readFile(canonicalPath);
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("IG26_INSPECT_EVIDENCE_INVALID", "Terminal evidence JSON is invalid");
  }
  if (
    !exactKeys(evidence, [
      "database",
      "evidenceSchemaVersion",
      "observations",
      "sourceReports",
    ]) ||
    evidence.evidenceSchemaVersion !== 1 ||
    !exactKeys(evidence.database, ["device", "inode", "path", "schemaVersion"]) ||
    evidence.database.path !== source.databasePath ||
    evidence.database.device !== source.databaseDevice ||
    evidence.database.inode !== source.databaseInode ||
    evidence.database.schemaVersion !== 43 ||
    !Array.isArray(evidence.sourceReports) || evidence.sourceReports.length < 1 ||
    evidence.sourceReports.length > 20 ||
    !Array.isArray(evidence.observations) || evidence.observations.length > 500
  ) fail("IG26_INSPECT_EVIDENCE_INVALID", "Terminal evidence contract is invalid");
  for (const report of evidence.sourceReports) {
    if (
      !exactKeys(report, ["pathLabel", "sha256"]) ||
      typeof report.pathLabel !== "string" || report.pathLabel.length < 1 ||
      report.pathLabel.length > 500 || /[\u0000\r\n]/.test(report.pathLabel) ||
      !/^[a-f0-9]{64}$/.test(report.sha256)
    ) fail("IG26_INSPECT_EVIDENCE_INVALID", "Source report identity is invalid");
  }
  const seen = new Set();
  for (const observation of evidence.observations) {
    if (
      !exactKeys(observation, [
        "adapterId",
        "executionAttempt",
        "failureCode",
        "kind",
        "providerTaskId",
        "rowFingerprint",
        "taskId",
      ].filter((key) => key !== "providerTaskId" ||
        Object.prototype.hasOwnProperty.call(observation, key))) ||
      observation.kind !== "provider-terminal-failed" ||
      !generationOutcomeAdapterId(observation.adapterId) ||
      !Number.isSafeInteger(observation.executionAttempt) ||
      observation.executionAttempt < 1 ||
      typeof observation.failureCode !== "string" ||
      observation.failureCode.length < 1 || observation.failureCode.length > 200 ||
      typeof observation.taskId !== "string" || observation.taskId.length < 1 ||
      observation.taskId.length > 200 ||
      !/^[a-f0-9]{64}$/.test(observation.rowFingerprint) ||
      (observation.providerTaskId !== undefined &&
        (typeof observation.providerTaskId !== "string" ||
          observation.providerTaskId.length < 1 ||
          observation.providerTaskId.length > 500))
    ) fail("IG26_INSPECT_EVIDENCE_INVALID", "Terminal observation is invalid");
    const key = `${observation.taskId}:${observation.executionAttempt}`;
    if (seen.has(key)) {
      fail("IG26_INSPECT_EVIDENCE_INVALID", "Terminal observation is duplicated");
    }
    seen.add(key);
  }
  return {
    evidence,
    evidencePath: canonicalPath,
    evidenceSha256: sha256(bytes),
  };
}

async function inspectDataDirectory(dataDirectory, evidencePath) {
  const source = await inspectionDatabase(dataDirectory);
  const databaseDetails = await stat(source.databasePath, { bigint: true });
  const sourceIdentity = {
    databaseDevice: databaseDetails.dev.toString(),
    databaseInode: databaseDetails.ino.toString(),
    databasePath: source.databasePath,
  };
  const attestation = await terminalEvidence(evidencePath, {
    device: sourceIdentity.databaseDevice,
    inode: sourceIdentity.databaseInode,
    path: sourceIdentity.databasePath,
    databaseDevice: sourceIdentity.databaseDevice,
    databaseInode: sourceIdentity.databaseInode,
    databasePath: sourceIdentity.databasePath,
  });
  const database = new DatabaseSync(source.databasePath, { readOnly: true, timeout: 5_000 });
  try {
    const schemaVersion = Number(database.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get()?.version);
    if (schemaVersion !== 43) {
      fail("IG26_INSPECT_SCHEMA_UNSUPPORTED", "Attempt settlement requires exact schema43");
    }
    const rows = database.prepare(`
      SELECT
        task.id AS task_id, task.owner_id, task.state AS task_state,
        task.error_code, task.error_message, task.provider_task_id AS task_provider_task_id,
        task.updated_at, attempt.execution_attempt, attempt.provider_profile_id,
        attempt.provider_model_id, attempt.outcome, attempt.provider_task_id AS attempt_provider_task_id,
        attempt.failure_code, attempt.finished_at
      FROM generation_tasks AS task
      JOIN generation_provider_attempts AS attempt
        ON attempt.task_id = task.id AND attempt.execution_attempt = task.attempt
      WHERE task.state = 'failed' AND attempt.finished_at IS NULL
        AND attempt.failure_code IS NOT NULL
      ORDER BY task.id
    `).all();
    const settledAt = new Date().toISOString();
    const observations = new Map(attestation.evidence.observations.map((item) => [
      `${item.taskId}:${item.executionAttempt}`,
      item,
    ]));
    const blocked = [];
    const entries = rows.flatMap((row) => {
      const before = rowEvidence(row);
      const rowFingerprint = fingerprint(before);
      const key = `${before.task.id}:${before.attempt.executionAttempt}`;
      const observation = observations.get(key);
      if (
        !observation || observation.rowFingerprint !== rowFingerprint ||
        observation.failureCode !== before.attempt.failureCode ||
        (observation.providerTaskId !== undefined &&
          observation.providerTaskId !== before.attempt.providerTaskId)
      ) {
        blocked.push({
          executionAttempt: before.attempt.executionAttempt,
          reason: "Exact terminal Provider observation is missing or does not match the frozen row",
          rowFingerprint,
          taskId: before.task.id,
        });
        return [];
      }
      const decision = classifyGenerationProviderOutcome({
        adapterId: observation.adapterId,
        attempt: {
          failureCode: before.attempt.failureCode ?? undefined,
          finishedAt: before.attempt.finishedAt ?? undefined,
          outcome: before.attempt.outcome,
          providerTaskId: before.attempt.providerTaskId ?? undefined,
        },
        observation: {
          failureCode: observation.failureCode,
          kind: observation.kind,
          ...(observation.providerTaskId
            ? { providerTaskId: observation.providerTaskId }
            : {}),
        },
        publication: { state: "none" },
        task: {
          errorCode: before.task.errorCode ?? undefined,
          providerTaskId: before.task.providerTaskId ?? undefined,
          state: before.task.state,
        },
      });
      if (decision.action !== "settle-terminal-failure") {
        blocked.push({
          executionAttempt: before.attempt.executionAttempt,
          reason: `Shared outcome classifier returned ${decision.action}`,
          rowFingerprint,
          taskId: before.task.id,
        });
        return [];
      }
      const after = {
        attempt: {
          ...before.attempt,
          finishedAt: settledAt,
          outcome: "provider-failed",
        },
        task: before.task,
      };
      return [{
        afterFingerprint: fingerprint(after),
        beforeFingerprint: rowFingerprint,
        classification: "settle-terminal-failure",
        expectedChanges: {
          attemptFailureCode: observation.failureCode,
          attemptFinishedAt: settledAt,
          attemptOutcome: "provider-failed",
          taskMutation: "none",
        },
        executionAttempt: before.attempt.executionAttempt,
        reason: "Exact attested Provider observation was accepted by the shared outcome classifier",
        taskId: before.task.id,
      }];
    });
    for (const observation of attestation.evidence.observations) {
      const key = `${observation.taskId}:${observation.executionAttempt}`;
      if (!rows.some((row) =>
        `${row.task_id}:${Number(row.execution_attempt)}` === key
      )) blocked.push({
        executionAttempt: observation.executionAttempt,
        reason: "Attested observation has no exact unsettled current row",
        rowFingerprint: observation.rowFingerprint,
        taskId: observation.taskId,
      });
    }
    return {
      blocked,
      entries,
      schemaVersion,
      source: {
        ...sourceIdentity,
        evidencePath: attestation.evidencePath,
        evidenceSha256: attestation.evidenceSha256,
        sourceReports: attestation.evidence.sourceReports,
        type: "schema43-snapshot",
      },
    };
  } finally {
    database.close();
  }
}

async function inspectFixture(fixturePath) {
  const canonicalPath = await privateRegularFile(
    fixturePath,
    "IG26_INSPECT_FIXTURE_INVALID",
  );
  const expectedRoot = join(applicationRoot, "tests", "fixtures", "inc-gen-026");
  if (!isInside(expectedRoot, canonicalPath)) {
    fail("IG26_INSPECT_FIXTURE_INVALID", "Fixture must be the repository-owned INC-GEN-026 fixture");
  }
  const fixtureBytes = await readFile(canonicalPath);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  if (fixture.fixtureSchemaVersion !== 1 || !Array.isArray(fixture.blockedEvidence)) {
    fail("IG26_INSPECT_FIXTURE_INVALID", "Fixture schema is invalid");
  }
  return {
    blocked: fixture.blockedEvidence,
    entries: [],
    schemaVersion: "fixture-1",
    source: {
      fixturePath: canonicalPath,
      fixtureSha256: sha256(fixtureBytes),
      type: "redacted-fixture",
    },
  };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const inspection = input.dataDirectory
    ? await inspectDataDirectory(input.dataDirectory, input.evidencePath)
    : await inspectFixture(input.fixturePath);
  const manifestBase = {
    blocked: inspection.blocked,
    createdAt: new Date().toISOString(),
    entries: inspection.entries,
    manifestSchemaVersion: 1,
    mode: "dry-run",
    schemaVersion: inspection.schemaVersion,
    source: inspection.source,
    tool: toolIdentity(),
  };
  const manifestSha256 = sha256(canonical(manifestBase));
  const manifest = { ...manifestBase, manifestSha256 };
  const parent = await realpath(dirname(input.manifestPath)).catch(() => undefined);
  if (!parent) {
    fail("IG26_INSPECT_MANIFEST_INVALID", "Manifest parent must be an existing real directory");
  }
  await writeFile(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({
    blockedCount: inspection.blocked.length,
    entryCount: inspection.entries.length,
    manifestPath: input.manifestPath,
    manifestSha256,
    ok: true,
  })}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    code: error instanceof InspectionError ? error.code : "IG26_INSPECT_FAILED",
    error: error instanceof Error ? error.message : "Attempt inspection failed",
    ok: false,
  })}\n`);
  process.exitCode = 1;
}
