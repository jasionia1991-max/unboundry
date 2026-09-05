import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import {
  closeSync,
  constants as fileConstants,
  fstatSync,
  lstatSync,
  read,
  realpathSync,
  writeSync,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import "./node-typescript-runtime.mjs";
import {
  AdmittedReleaseError,
  validateAdmittedRelease,
} from "./lib/admitted-release.mjs";
import {
  parseChildErrorEnvelope,
  schemaMigrationChildErrorCodes,
} from "./lib/child-error-envelope.mjs";
import {
  assertAttestedReleaseArtifacts,
  readReleaseAttestation,
  ReleaseAttestationError,
} from "./lib/release-attestation.mjs";
import {
  authenticateInheritedLinuxValidationSandbox,
  LinuxValidationSandboxError,
} from "./lib/linux-validation-sandbox.mjs";

const {
  FakeOssRecoveryError,
  ossRecoveryIndexFileName,
  rehydrateFakeOssFromIndexFile,
} = await import("../server/fakeOssRecovery.ts");
const {
  BackupInspectionError,
  inspectBackupDatabase,
  inspectLockedBackupDatabase,
  validateBackupSecrets,
} = await import("../server/backupInspection.ts");
const { openAppDatabase } = await import("../server/database.ts");

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maximumChildOutputBytes = 16 * 1024 * 1024;
const maximumStartupOutputBytes = 1024 * 1024;
const maximumBuildArtifactBytes = 512 * 1024 * 1024;
const maximumBuildArtifactEntries = 100_000;
const maximumBuildArtifactDepth = 64;
const maximumBuildArtifactNameBytes = 255;
const maximumBuildArtifactPathBytes = 16 * 1024;
const maximumBuildArtifactInventoryPathBytes = 16 * 1024 * 1024;
const maximumRestoredStateBytes = 1024 * 1024 * 1024 * 1024;
const currentStartupSchemaVersion = 43;
const startupShutdownDiagnosticMarkers = Object.freeze([
  "LEGACY_CHILD_GUARDIAN_LOST",
  "LEGACY_RUNTIME_DRAIN_TIMEOUT",
  "LEGACY_RUNTIME_STOP_FAILED",
  "LEGACY_RUNTIME_TERMINATION_UNKNOWN",
  "Runtime shutdown deadline exceeded",
  "Runtime shutdown did not drain",
]);
const startupShutdownDiagnosticCategories = Object.freeze([
  Object.freeze({
    category: "LEGACY_POST_START_DATABASE_IDENTITY_CHANGED",
    marker: "schema or database identity changed during child startup",
  }),
  Object.freeze({
    category: "LEGACY_ACTIVE_TASK_OBSERVATION_CHANGED",
    marker: "inspectLegacyActiveGenerationTasks",
  }),
  Object.freeze({
    category: "LEGACY_ACTIVE_TASK_PRELAUNCH_OBSERVATION_CHANGED",
    marker: "legacyRuntimeSupervisor.ts:260:",
  }),
  Object.freeze({
    category: "LEGACY_ACTIVE_TASK_POST_WARMUP_OBSERVATION_CHANGED",
    marker: "legacyRuntimeSupervisor.ts:292:",
  }),
  Object.freeze({
    category: "LEGACY_MEDIA_OBSERVATION_CHANGED",
    marker: "inspectLegacyMediaMetadataComplete",
  }),
]);
const startupLegacyDatabaseChangePhases = Object.freeze([
  "ACTIVE_POST_WARMUP",
  "ACTIVE_PRELAUNCH",
  "ACTIVE_SHUTDOWN",
  "ACTIVE_STANDALONE",
  "MEDIA_POST_WARMUP",
  "MEDIA_STANDALONE",
]);
const startupLegacyDatabaseChangeComponents = Object.freeze([
  "DATABASE",
  "DIRECTORY",
  "JOURNAL",
  "SHM",
  "WAL",
]);
const startupLegacyDatabaseChangeClasses = Object.freeze([
  "CONTENT_METADATA",
  "IDENTITY",
  "PRESENCE",
]);
const startupLegacySupervisorStackLineAllowlist = new Set([
  188,
  226,
  236,
  238,
  260,
  292,
  297,
]);

function allowlistedLegacyDatabaseChanges(value) {
  const changes = new Map();
  for (const match of value.matchAll(
    /\bLEGACY_RUNTIME_DATABASE_CHANGED:([A-Z_]+):([A-Z_]+):([A-Z_]+)\b/g,
  )) {
    const [, phase, component, changeClass] = match;
    if (
      !startupLegacyDatabaseChangePhases.includes(phase) ||
      !startupLegacyDatabaseChangeComponents.includes(component) ||
      !startupLegacyDatabaseChangeClasses.includes(changeClass)
    ) continue;
    const key = `${phase}:${component}:${changeClass}`;
    changes.set(key, Object.freeze({ changeClass, component, phase }));
  }
  return [...changes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, change]) => change);
}

function allowlistedLegacySupervisorStackLines(value) {
  return [...new Set(
    [...value.matchAll(
      /legacyRuntimeSupervisor\.ts[^\s)]*?:(\d+):\d+/g,
    )]
      .map((match) => Number(match[1]))
      .filter((line) => startupLegacySupervisorStackLineAllowlist.has(line)),
  )].sort((left, right) => left - right);
}

class CliError extends Error {
  constructor(code, message, childStage) {
    super(message);
    this.code = code;
    this.childStage = childStage;
  }
}

function fail(code, message) {
  throw new CliError(code, message);
}

async function inheritedLinuxValidationSandbox(errorCode) {
  try {
    return await authenticateInheritedLinuxValidationSandbox();
  } catch (error) {
    if (!(error instanceof LinuxValidationSandboxError)) throw error;
    fail(
      errorCode,
      "Authenticated inherited Linux validation sandbox is unavailable",
    );
  }
}

function normalizedAbsolutePath(value) {
  if (!value || resolve(value) !== value) {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "All final-candidate paths must be normalized absolute paths",
    );
  }
  return value;
}

async function readRunnerReleaseAttestation(releaseManifestPaths) {
  const hasAttestationEnvironment = Boolean(
    process.env.UNBOUNDRY_RELEASE_ATTESTATION_PATH ||
    process.env.UNBOUNDRY_RELEASE_ATTESTATION_ROOT ||
    process.env.UNBOUNDRY_RELEASE_ATTESTATION_SHA256,
  );
  if (!hasAttestationEnvironment) {
    if (process.env.UNBOUNDRY_SAFE_TEST === "1") {
      fail(
        "FINAL_BACKUP_RELEASE_ATTESTATION_INVALID",
        "Safe-runner release artifacts require an authenticated attestation",
      );
    }
    return undefined;
  }
  if (!(await safeRunnerInheritedSandboxAllowed())) {
    fail(
      "FINAL_BACKUP_RELEASE_ATTESTATION_INVALID",
      "Runner release attestation is incomplete or unauthenticated",
    );
  }
  try {
    const attestation = await readReleaseAttestation();
    if (
      attestation.manifestPaths.bridge !== releaseManifestPaths.bridge ||
      attestation.manifestPaths.final !== releaseManifestPaths.final
    ) {
      fail(
        "FINAL_BACKUP_RELEASE_ATTESTATION_INVALID",
        "Runner release attestation does not match the isolated artifacts",
      );
    }
    return attestation;
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (!(error instanceof ReleaseAttestationError)) throw error;
    fail(
      "FINAL_BACKUP_RELEASE_ATTESTATION_INVALID",
      "Runner release attestation could not be read safely",
    );
  }
}

async function admitRelease(path, expectedRole, runnerAttestation) {
  try {
    return await validateAdmittedRelease({
      ...(runnerAttestation
        ? {
            expectedManifestSha256:
              runnerAttestation.manifestSha256[expectedRole],
            testExpectation: runnerAttestation.expectation,
          }
        : {}),
      expectedRole,
      manifestPath: path,
    });
  } catch (error) {
    if (!(error instanceof AdmittedReleaseError)) throw error;
    const code = error.code === "ADMITTED_RELEASE_CHANGED"
      ? "FINAL_BACKUP_RELEASE_MANIFEST_CHANGED"
      : error.code === "ADMITTED_RELEASE_UNSAFE"
        ? "FINAL_BACKUP_RELEASE_MANIFEST_UNSAFE"
        : "FINAL_BACKUP_RELEASE_MANIFEST_INVALID";
    fail(code, "Release artifact did not satisfy the admitted v3 contract");
  }
}

function sameAdmittedRelease(left, right) {
  return left.directory === right.directory &&
    left.manifestSha256 === right.manifestSha256 &&
    left.inventorySha256 === right.inventorySha256 &&
    JSON.stringify(left.directoryIdentity) ===
      JSON.stringify(right.directoryIdentity);
}

async function revalidateRelease(initial, expectedRole, runnerAttestation) {
  const current = await admitRelease(
    initial.manifestPath,
    expectedRole,
    runnerAttestation,
  );
  if (!sameAdmittedRelease(initial, current)) {
    fail(
      "FINAL_BACKUP_RELEASE_MANIFEST_CHANGED",
      "Release artifact identity changed between final-candidate phases",
    );
  }
  return current;
}

function releaseEvidence(release) {
  return Object.freeze({
    commit: release.manifest.commit,
    inventorySha256: release.inventorySha256,
    manifestSha256: release.manifestSha256,
    migrationArtifactSha256: release.migrationArtifactSha256 ?? null,
    releaseId: release.releaseId,
    releaseRole: release.releaseRole,
    sourceTree: release.manifest.sourceTree,
    version: release.version,
  });
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) &&
      difference !== ".." && !difference.startsWith(`..${sep}`));
}

async function canonicalPotentialPath(path) {
  let current = path;
  const missing = [];
  for (;;) {
    try {
      return resolve(await realpath(current), ...missing);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

function pathsOverlap(paths) {
  return paths.some((left, index) =>
    paths.slice(index + 1).some((right) =>
      containsPath(left, right) || containsPath(right, left)));
}

function parseMirror(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("FINAL_BACKUP_ARGUMENT_INVALID", "OSS mirrors must be JSON objects");
  }
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !== "filePath,objectKey,versionId" ||
    typeof parsed.filePath !== "string" || !parsed.filePath ||
    typeof parsed.objectKey !== "string" || !parsed.objectKey ||
    typeof parsed.versionId !== "string" || !parsed.versionId ||
    parsed.objectKey.includes("\0") || parsed.versionId.includes("\0")
  ) {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "OSS mirrors require objectKey, versionId, and absolute filePath",
    );
  }
  return Object.freeze({
    filePath: normalizedAbsolutePath(parsed.filePath),
    objectKey: parsed.objectKey,
    versionId: parsed.versionId,
  });
}

function serializeMirrors(mirrors) {
  return mirrors.map((mirror) => JSON.stringify(mirror));
}

function parseArguments(argv) {
  const values = new Map();
  const mirrors = [];
  const mediaWarnings = [];
  let requireCleanMedia = false;
  const repeatable = new Set(["--allow-media-warning", "--oss-mirror"]);
  const allowed = new Set([
    ...repeatable,
    "--backup-root",
    "--bridge-release-manifest",
    "--data-dir",
    "--expected-database-logical-sha256",
    "--fake-oss-target-dir",
    "--final-release-manifest",
    "--generation-frozen-at",
    "--last-provider-admission-at",
    "--recovery-private-key",
    "--recovery-public-key",
    "--scratch-root",
    "--signing-private-key",
    "--target-data-dir",
    "--trusted-signing-public-key",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--require-clean-media") {
      if (requireCleanMedia || mediaWarnings.length) {
        fail(
          "FINAL_BACKUP_ARGUMENT_INVALID",
          "Media warning policy is duplicated or conflicting",
        );
      }
      requireCleanMedia = true;
      continue;
    }
    if (!allowed.has(option)) {
      fail("FINAL_BACKUP_ARGUMENT_INVALID", "Unknown final-candidate argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("FINAL_BACKUP_ARGUMENT_INVALID", "A final-candidate argument is missing");
    }
    index += 1;
    if (option === "--oss-mirror") {
      mirrors.push(parseMirror(value));
      continue;
    }
    if (option === "--allow-media-warning") {
      if (
        requireCleanMedia ||
        !/^MEDIA_INTEGRITY_[A-Z0-9_]+$/.test(value) ||
        mediaWarnings.includes(value)
      ) {
        fail("FINAL_BACKUP_ARGUMENT_INVALID", "Media warning allowlist is invalid");
      }
      mediaWarnings.push(value);
      continue;
    }
    if (values.has(option)) {
      fail("FINAL_BACKUP_ARGUMENT_INVALID", "Final-candidate argument is duplicated");
    }
    values.set(option, value);
  }
  const required = [
    "--backup-root",
    "--bridge-release-manifest",
    "--data-dir",
    "--expected-database-logical-sha256",
    "--fake-oss-target-dir",
    "--final-release-manifest",
    "--generation-frozen-at",
    "--last-provider-admission-at",
    "--recovery-private-key",
    "--recovery-public-key",
    "--signing-private-key",
    "--target-data-dir",
    "--trusted-signing-public-key",
  ];
  if (required.some((option) => !values.has(option))) {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "Final-candidate backup requires source, target, keys, exact SHA, and freeze evidence",
    );
  }
  if (mirrors.length === 0) {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "Final-candidate backup requires at least one fake OSS recovery mirror",
    );
  }
  if (!requireCleanMedia && mediaWarnings.length === 0) {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "Final-candidate backup requires clean media or an explicit warning allowlist",
    );
  }
  const expectedSha = values.get("--expected-database-logical-sha256");
  const generationFrozenAt = values.get("--generation-frozen-at");
  const admissionAt = values.get("--last-provider-admission-at");
  const exactUtc = (value) => {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value;
  };
  if (
    !/^[a-f0-9]{64}$/.test(expectedSha) ||
    !exactUtc(generationFrozenAt) ||
    (admissionAt !== "none" && !exactUtc(admissionAt))
  ) {
    fail("FINAL_BACKUP_ARGUMENT_INVALID", "Final-candidate SHA or freeze evidence is invalid");
  }
  return { mediaWarnings, mirrors, requireCleanMedia, values };
}

function appendRepeated(arguments_, option, values) {
  for (const value of values) arguments_.push(option, value);
}

function childArguments(parsed, kind) {
  const values = parsed.values;
  const commonContract = [
    "--historical-recovery",
    "--expected-schema-version",
    "37",
    "--expected-database-logical-sha256",
    values.get("--expected-database-logical-sha256"),
    "--generation-frozen-at",
    values.get("--generation-frozen-at"),
    "--last-provider-admission-at",
    values.get("--last-provider-admission-at"),
  ];
  const policy = parsed.requireCleanMedia
    ? ["--require-clean-media"]
    : [];
  appendRepeated(policy, "--allow-media-warning", parsed.mediaWarnings);
  const scratch = values.has("--scratch-root")
    ? ["--scratch-root", values.get("--scratch-root")]
    : [];
  if (kind === "report") {
    const result = [
      "--source-frozen",
      "--data-dir",
      values.get("--data-dir"),
      ...scratch,
      ...commonContract,
      ...policy,
    ];
    appendRepeated(result, "--oss-mirror", serializeMirrors(parsed.mirrors));
    return result;
  }
  if (kind === "backup") {
    const result = [
      "--source-frozen",
      "--data-dir",
      values.get("--data-dir"),
      "--backup-root",
      values.get("--backup-root"),
      "--recovery-public-key",
      values.get("--recovery-public-key"),
      "--signing-private-key",
      values.get("--signing-private-key"),
      ...scratch,
      ...commonContract,
      ...policy,
    ];
    appendRepeated(result, "--oss-mirror", serializeMirrors(parsed.mirrors));
    return result;
  }
  fail("FINAL_BACKUP_INTERNAL_ERROR", "Unknown final-candidate child role");
}

async function createSafeDurationProbeFixture(scratchRoot) {
  const directory = await mkdtemp(resolve(
    scratchRoot,
    ".unboundry-final-duration-probe-",
  ));
  await chmod(directory, 0o700);
  const executable = resolve(directory, "ffprobe");
  const auditPath = resolve(directory, "migration-duration-audit.jsonl");
  await writeFile(
    executable,
    `#!/bin/sh
set -eu
expected='-v error -protocol_whitelist file,pipe -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /dev/fd/3'
test "$#" -eq 9
test "$*" = "$expected"
test -r /dev/fd/3
bytes=$(wc -c < /dev/fd/3 | tr -d ' ')
test "$bytes" -gt 0
printf '7.125\\n'
`,
    { flag: "wx", mode: 0o700 },
  );
  await chmod(executable, 0o700);
  await writeFile(auditPath, "", { flag: "wx", mode: 0o600 });
  await chmod(auditPath, 0o600);
  return Object.freeze({ auditPath, directory, executable });
}

function isLinuxMigrationSandboxEvidence(nativeSandboxEvidence) {
  return nativeSandboxEvidence?.enforcementMode ===
      "linux-bwrap-inherited-v1" &&
    nativeSandboxEvidence?.denyNetwork === true &&
    nativeSandboxEvidence?.inheritedSelfTestDenied === true &&
    nativeSandboxEvidence?.explicitSelfTestDenied === null &&
    nativeSandboxEvidence?.deniedSocketScope ===
      "isolated-network-namespace-no-usable-external-route" &&
    nativeSandboxEvidence?.profileApplied === false &&
    nativeSandboxEvidence?.profileSha256 === null &&
    nativeSandboxEvidence?.safeRunnerIdentityBound === false &&
    nativeSandboxEvidence?.linuxSandboxIdentityBound === true &&
    nativeSandboxEvidence?.selfTestDenied === true &&
    nativeSandboxEvidence?.selfTestSocketAttempts === 1 &&
    nativeSandboxEvidence?.processTreeEnforced === true &&
    nativeSandboxEvidence?.migrationChildren === 10 &&
    nativeSandboxEvidence?.linuxSandbox?.contract ===
      "unboundry-linux-validation-sandbox-v1" &&
    nativeSandboxEvidence?.linuxSandbox?.processTreeEnforced === true &&
    nativeSandboxEvidence?.linuxSandbox?.external?.denied === true &&
    nativeSandboxEvidence?.linuxSandbox?.loopback?.connected === true &&
    nativeSandboxEvidence?.linuxSandbox?.interfaces?.onlyLoopback === true &&
    nativeSandboxEvidence?.linuxSandbox?.routes?.externalRouteRecords === 0 &&
    nativeSandboxEvidence?.linuxSandbox?.routes?.usableDefaultRoutes === 0;
}

async function verifySafeDurationProbeAudit(
  auditPath,
  migration,
  nativeSandboxEvidence,
) {
  let events;
  try {
    events = (await readFile(auditPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_AUDIT_INVALID",
      "Migration duration probe audit is invalid",
    );
  }
  const starts = events.filter((event) => event?.phase === "start");
  const completes = events.filter((event) => event?.phase === "complete");
  const operationIds = new Set(events.map((event) => event?.operationId));
  const argumentHashes = new Set(events.map((event) => event?.argumentsSha256));
  if (
    starts.length < 1 || starts.length !== completes.length ||
    starts.length !== migration?.nativeDurationProbes ||
    operationIds.size !== 1 || argumentHashes.size !== 1 ||
    events.some((event, index) =>
      event?.sequence !== index + 1 ||
      !/^[a-f0-9]{64}$/.test(String(event?.argumentsSha256 ?? ""))
    )
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_AUDIT_MISMATCH",
      "Migration duration probe audit does not match the applied backfill",
    );
  }
  const sha256 = createHash("sha256")
    .update(JSON.stringify(events), "utf8")
    .digest("hex");
  if (sha256 !== migration.nativeDurationProbeAuditSha256) {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_AUDIT_MISMATCH",
      "Migration duration probe audit checksum does not match",
    );
  }
  const inheritedSandboxEvidence =
    nativeSandboxEvidence?.enforcementMode === "inherited" &&
    nativeSandboxEvidence?.inheritedSelfTestDenied === true &&
    nativeSandboxEvidence?.explicitSelfTestDenied === null &&
    nativeSandboxEvidence?.safeRunnerIdentityBound === true &&
    nativeSandboxEvidence?.deniedSocketScope === "safe-runner-deny-network" &&
    nativeSandboxEvidence?.profileApplied === false &&
    nativeSandboxEvidence?.profileSha256 === null &&
    nativeSandboxEvidence?.selfTestSocketAttempts === 1;
  const explicitSandboxEvidence =
    nativeSandboxEvidence?.enforcementMode === "explicit" &&
    nativeSandboxEvidence?.inheritedSelfTestDenied === false &&
    nativeSandboxEvidence?.explicitSelfTestDenied === true &&
    nativeSandboxEvidence?.deniedSocketScope === "all-network" &&
    nativeSandboxEvidence?.profileApplied === true &&
    nativeSandboxEvidence?.safeRunnerIdentityBound === false &&
    nativeSandboxEvidence?.selfTestSocketAttempts === 1 &&
    /^[a-f0-9]{64}$/.test(String(nativeSandboxEvidence?.profileSha256 ?? ""));
  const linuxSandboxEvidence = isLinuxMigrationSandboxEvidence(
    nativeSandboxEvidence,
  );
  if (
    nativeSandboxEvidence?.denyNetwork !== true ||
    nativeSandboxEvidence?.selfTestDenied !== true ||
    nativeSandboxEvidence?.processTreeEnforced !== true ||
    nativeSandboxEvidence?.migrationChildren !== 10 ||
    (!inheritedSandboxEvidence && !explicitSandboxEvidence &&
      !linuxSandboxEvidence)
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_NETWORK_AUDIT_MISMATCH",
      "Migration native children did not remain behind the OS network sandbox",
    );
  }
  return Object.freeze({
    argumentContractSha256: [...argumentHashes][0],
    externalNetworkAttempts: linuxSandboxEvidence ? null : 0,
    ...(linuxSandboxEvidence
      ? {
          externalNetworkSuccesses: 0,
          networkAttemptCounting: "not-instrumented",
        }
      : {}),
    nativeSandbox: nativeSandboxEvidence,
    nativeDurationProbes: starts.length,
    sha256,
  });
}

function productionMigrationEnvironment(release, runtimeDirectory) {
  const ffprobe = release.manifest.hostPrerequisites?.executables?.find(
    (entry) => entry?.name === "ffprobe",
  );
  const path = release.manifest.runtime?.environment?.PATH?.value;
  if (
    ffprobe?.path !== "/usr/bin/ffprobe" ||
    !/^[a-f0-9]{64}$/.test(String(ffprobe?.sha256 ?? "")) ||
    path !== `${dirname(release.runtimeCommand)}:/usr/bin:/bin`
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_PROBE_INVALID",
      "Production migration ffprobe prerequisite is not release-bound",
    );
  }
  return Object.freeze({
    HOME: runtimeDirectory,
    LANG: "C",
    LC_ALL: "C",
    NODE_NO_WARNINGS: "1",
    NODE_ENV: "production",
    // The release runtime is invoked by its absolute Node path. Keep ffprobe
    // resolution independent of any executable that may appear beside Node.
    PATH: "/usr/bin:/bin",
    TEMP: runtimeDirectory,
    TMP: runtimeDirectory,
    TMPDIR: runtimeDirectory,
  });
}

function verifyProductionDurationProbeEvidence(
  migration,
  nativeSandboxEvidence,
  release,
) {
  const ffprobe = release.manifest.hostPrerequisites.executables.find(
    (entry) => entry.name === "ffprobe",
  );
  if (
    !isLinuxMigrationSandboxEvidence(nativeSandboxEvidence) ||
    migration?.drainMilliseconds !== 60_000 ||
    !Number.isInteger(migration?.nativeDurationProbes) ||
    migration.nativeDurationProbes < 1 ||
    !/^[a-f0-9]{64}$/.test(
      String(migration?.nativeDurationProbeAuditSha256 ?? ""),
    ) ||
    ffprobe?.path !== "/usr/bin/ffprobe" ||
    !/^[a-f0-9]{64}$/.test(String(ffprobe?.sha256 ?? ""))
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_AUDIT_MISMATCH",
      "Production migration duration probe evidence is incomplete",
    );
  }
  return Object.freeze({
    argumentContractSha256: null,
    durationProbeExecutable: ffprobe.path,
    durationProbeExecutableSha256: ffprobe.sha256,
    durationProbeMode: "release-bound-production-path",
    externalNetworkAttempts: null,
    externalNetworkSuccesses: 0,
    nativeDurationProbes: migration.nativeDurationProbes,
    nativeSandbox: nativeSandboxEvidence,
    networkAttemptCounting: "not-instrumented",
    realDrainClock: true,
    sha256: migration.nativeDurationProbeAuditSha256,
    testClockUsed: false,
    testDurationProbeUsed: false,
  });
}

function childProcessGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitForChildProcessGroupExit(processGroupId, timeout) {
  const deadline = Date.now() + timeout;
  while (childProcessGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return true;
}

async function terminateChildProcessGroup(processGroupId) {
  if (!childProcessGroupExists(processGroupId)) return false;
  try {
    process.kill(-processGroupId, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  if (await waitForChildProcessGroupExit(processGroupId, 2_000)) return false;
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  if (!await waitForChildProcessGroupExit(processGroupId, 2_000)) {
    fail(
      "FINAL_BACKUP_CHILD_CLEANUP_UNKNOWN",
      "Final-candidate child process group could not be confirmed stopped",
    );
  }
  return true;
}

async function runJsonChild({
  arguments_,
  childStage,
  cwd,
  env,
  errorProtocol,
  executable,
  label,
}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timer;
    const child = spawn(executable, arguments_, {
      cwd,
      detached: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const processGroupId = child.pid;
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const finish = async ({ code = null, error, reason, signal = null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let forced = false;
      try {
        if (processGroupId && childProcessGroupExists(processGroupId)) {
          forced = await terminateChildProcessGroup(processGroupId);
          if (reason === "close" && code === 0 && signal === null) {
            throw new CliError(
              "FINAL_BACKUP_CHILD_CLEANUP_UNKNOWN",
              `${label} exited while its process group remained active`,
              childStage,
            );
          }
        }
      } catch (cleanupError) {
        rejectPromise(new CliError(
          cleanupError instanceof CliError
            ? cleanupError.code
            : "FINAL_BACKUP_CHILD_CLEANUP_UNKNOWN",
          `${label} cleanup could not be confirmed`,
          childStage,
        ));
        return;
      }
      if (error) {
        rejectPromise(new CliError(
          "FINAL_BACKUP_CHILD_FAILED",
          `${label} could not start`,
          childStage,
        ));
        return;
      }
      if (reason === "timeout") {
        rejectPromise(new CliError(
          "FINAL_BACKUP_CHILD_TIMEOUT",
          `${label} exceeded its bounded runtime`,
          childStage,
        ));
        return;
      }
      if (reason === "output-limit") {
        rejectPromise(new CliError(
          "FINAL_BACKUP_CHILD_OUTPUT_TOO_LARGE",
          `${label} output exceeded its limit`,
          childStage,
        ));
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr);
      if (reason !== "close" || code !== 0 || signal || forced) {
        const childError = signal === null && forced === false
          ? parseChildErrorEnvelope(errorOutput, errorProtocol)
          : undefined;
        rejectPromise(new CliError(
          childError?.code ?? "FINAL_BACKUP_CHILD_FAILED",
          childError
            ? `${label} reported a bounded failure`
            : `${label} failed`,
          childStage,
        ));
        return;
      }
      try {
        resolvePromise(JSON.parse(output));
      } catch {
        rejectPromise(new CliError(
          "FINAL_BACKUP_CHILD_OUTPUT_INVALID",
          `${label} output is invalid`,
          childStage,
        ));
      }
    };
    const collect = (target) => (chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maximumChildOutputBytes) {
        void finish({ reason: "output-limit" });
      } else target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => void finish({ error, reason: "error" }));
    child.once("close", (code, signal) =>
      void finish({ code, reason: "close", signal }));
    timer = setTimeout(() => void finish({ reason: "timeout" }), 20 * 60_000);
  });
}

async function runJsonScript(scriptName, arguments_, options = {}) {
  const protocol = Object.freeze({
    "backup-data.mjs": Object.freeze({
      childStage: "backup-create",
      codePrefix: "BACKUP_",
      envelope: "code-message",
      label: "Final-candidate backup-create child process",
    }),
    "report-media-integrity.mjs": Object.freeze({
      childStage: "media-report",
      codePrefixes: Object.freeze(["BACKUP_", "MEDIA_REPORT_"]),
      envelope: "code-message",
      label: "Final-candidate media-report child process",
    }),
    "restore-backup.mjs": Object.freeze({
      childStage: "backup-restore",
      codePrefix: "BACKUP_",
      envelope: "code-message",
      label: "Final-candidate backup-restore child process",
    }),
    "verify-backup.mjs": Object.freeze({
      childStage: "backup-verify",
      codePrefix: "BACKUP_",
      envelope: "code-message",
      label: "Final-candidate backup-verify child process",
    }),
  })[scriptName];
  if (!protocol) {
    fail(
      "FINAL_BACKUP_CHILD_PROTOCOL_INVALID",
      "Final-candidate child protocol is not fixed",
    );
  }
  const executable = options.wrapper?.executable ?? process.execPath;
  const childArguments = options.wrapper
    ? [...options.wrapper.arguments, process.execPath,
        resolve(appRoot, "scripts", scriptName), ...arguments_]
    : [resolve(appRoot, "scripts", scriptName), ...arguments_];
  return runJsonChild({
    arguments_: childArguments,
    childStage: protocol.childStage,
    cwd: appRoot,
    env: options.env ?? process.env,
    errorProtocol: protocol,
    executable,
    label: protocol.label,
  });
}

const releaseMigrationScripts = new Set([
  "migrate-schema37-to39.mjs",
  "migrate-schema39-to40.mjs",
  "migrate-schema40-to41.mjs",
  "migrate-schema41-to42.mjs",
  "migrate-schema42-to43.mjs",
]);

async function runReleaseMigrationScript(
  release,
  scriptName,
  mode,
  arguments_,
  options = {},
) {
  if (!releaseMigrationScripts.has(scriptName)) {
    fail(
      "FINAL_BACKUP_CHILD_PROTOCOL_INVALID",
      "Release-bound migration script is not fixed",
    );
  }
  if (!new Set(["apply", "dry-run"]).has(mode)) {
    fail(
      "FINAL_BACKUP_CHILD_PROTOCOL_INVALID",
      "Release-bound migration mode is not fixed",
    );
  }
  const executable = options.wrapper?.executable ?? release.runtimeCommand;
  const releaseArguments = [
    `scripts/${scriptName}`,
    `--${mode}`,
    ...arguments_,
  ];
  const childArguments = options.wrapper
    ? [...options.wrapper.arguments, release.runtimeCommand, ...releaseArguments]
    : releaseArguments;
  return runJsonChild({
    arguments_: childArguments,
    childStage: `migration-${scriptName}-${mode}`,
    cwd: release.directory,
    env: options.env ?? process.env,
    errorProtocol: Object.freeze({
      allowedCodes: schemaMigrationChildErrorCodes,
      codePrefix: "SCHEMA_MIGRATION_",
      envelope: "ok-code-error",
    }),
    executable,
    label: `Release-bound ${scriptName} ${mode} child process`,
  });
}

const migrationNativeSandboxProfile =
  "(version 1)\n(allow default)\n(deny network*)\n";
const runtimeNativeSandboxProfile =
  "(version 1)\n(allow default)\n(deny network*)\n" +
  '(allow network-bind (local ip "localhost:*"))\n' +
  '(allow network-inbound (local ip "localhost:*"))\n' +
  '(allow network-outbound (remote ip "localhost:*"))\n';
// TEST-NET-1 is used only after an OS network-denial layer is already selected:
// either the authenticated safe runner's inherited Seatbelt profile or the
// explicit sandbox-exec wrapper. The kernel therefore rejects the syscall
// before any packet can leave the host.
const migrationNativeSelfTestHost = "192.0.2.1";
const migrationNativeSelfTestPort = 9;
const migrationNativeSelfTestSource = `
const { connect } = require("node:net");
let settled = false;
let socket;
let timer;
const finish = (outcome) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  socket?.destroy();
  process.stdout.write(outcome + "\\n");
};
try {
  socket = connect({ host: ${JSON.stringify(migrationNativeSelfTestHost)}, port: ${migrationNativeSelfTestPort} });
  socket.once("error", (error) => finish(String(error?.code ?? "UNKNOWN")));
  socket.once("connect", () => finish("CONNECTED"));
  timer = setTimeout(() => finish("TIMEOUT"), 750);
} catch (error) {
  finish(String(error?.code ?? "UNKNOWN"));
}
`;

async function runMigrationNativeSelfTest(wrapper) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const executable = wrapper?.executable ?? process.execPath;
    const arguments_ = wrapper
      ? [...wrapper.arguments, process.execPath, "-e", migrationNativeSelfTestSource]
      : ["-e", migrationNativeSelfTestSource];
    const child = spawn(executable, arguments_, {
      cwd: appRoot,
      env: { ...process.env, NODE_OPTIONS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({
      code,
      signal,
      stderr: Buffer.concat(stderr).toString("utf8").trim(),
      stdout: Buffer.concat(stdout).toString("utf8").trim(),
    }));
  });
}

function assertMigrationNativeSelfTestResult(selfTest) {
  if (
    selfTest.code !== 0 || selfTest.signal !== null || selfTest.stderr !== "" ||
    !/^(?:[A-Z][A-Z0-9_]*|CONNECTED|TIMEOUT)$/.test(selfTest.stdout)
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_SANDBOX_UNAVAILABLE",
      "Final migration native network sandbox self-test could not establish its result",
    );
  }
}

function migrationNativeSandboxEvidence(
  enforcementMode,
  profileSha256,
  safeRunnerIdentityBound = false,
  linuxSandbox,
) {
  const linuxInherited = enforcementMode === "linux-bwrap-inherited-v1";
  return Object.freeze({
    denyNetwork: true,
    deniedSocketScope: enforcementMode === "explicit"
      ? "all-network"
      : linuxInherited
        ? "isolated-network-namespace-no-usable-external-route"
        : "safe-runner-deny-network",
    enforcementMode,
    explicitSelfTestDenied: enforcementMode === "explicit" ? true : null,
    inheritedSelfTestDenied:
      enforcementMode === "inherited" || linuxInherited,
    ...(linuxInherited
      ? {
          linuxSandbox,
          linuxSandboxIdentityBound: true,
        }
      : {}),
    migrationChildren: 10,
    processTreeEnforced: true,
    profileApplied: enforcementMode === "explicit",
    profileSha256,
    safeRunnerIdentityBound,
    selfTestDenied: true,
    selfTestSocketAttempts: 1,
  });
}

async function safeRunnerInheritedSandboxAllowed() {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") return false;
  let sentinelHandle;
  try {
    const systemTemporaryRoot = await realpath(String(
      process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT ?? "",
    ));
    const testRoot = await realpath(String(
      process.env.UNBOUNDRY_TEST_ROOT ?? "",
    ));
    const repositoryRoot = await realpath(String(
      process.env.UNBOUNDRY_TEST_REPOSITORY_ROOT ?? "",
    ));
    const sentinelPath = await realpath(String(
      process.env.UNBOUNDRY_SAFE_RUN_SENTINEL ?? "",
    ));
    const originalRepositoryRoot = resolve(String(
      process.env.UNBOUNDRY_ORIGINAL_REPOSITORY_ROOT ?? "",
    ));
    const nonce = String(process.env.UNBOUNDRY_SAFE_RUN_NONCE ?? "");
    const expectedNodeOptions = `--import=${resolve(
      repositoryRoot,
      "scripts",
      "offline-network-guard.mjs",
    )}`;
    const testRootDetails = await lstat(testRoot, { bigint: true });
    const repositoryDetails = await lstat(repositoryRoot, { bigint: true });
    sentinelHandle = await open(
      sentinelPath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
    const before = await sentinelHandle.stat({ bigint: true });
    if (before.size >= 256n) return false;
    const buffer = Buffer.alloc(256);
    const { bytesRead } = await sentinelHandle.read(buffer, 0, buffer.length, 0);
    const source = buffer.toString("utf8", 0, bytesRead).trim();
    buffer.fill(0);
    const after = await sentinelHandle.stat({ bigint: true });
    const pathDetails = await lstat(sentinelPath, { bigint: true });
    const sameIdentity = (left, right) =>
      left.dev === right.dev && left.ino === right.ino &&
      left.uid === right.uid && left.mode === right.mode &&
      left.nlink === right.nlink && left.size === right.size &&
      left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
    const currentUid = typeof process.getuid === "function"
      ? BigInt(process.getuid())
      : -1n;
    return nonce.length >= 16 && source === nonce &&
      before.isFile() && !before.isSymbolicLink() && before.nlink === 1n &&
      before.uid === currentUid && (before.mode & 0o077n) === 0n &&
      sameIdentity(before, after) && sameIdentity(before, pathDetails) &&
      testRootDetails.isDirectory() && !testRootDetails.isSymbolicLink() &&
      testRootDetails.uid === currentUid && (testRootDetails.mode & 0o022n) === 0n &&
      repositoryDetails.isDirectory() && !repositoryDetails.isSymbolicLink() &&
      repositoryDetails.uid === currentUid &&
      (repositoryDetails.mode & 0o022n) === 0n &&
      containsPath(systemTemporaryRoot, testRoot) &&
      containsPath(systemTemporaryRoot, repositoryRoot) &&
      containsPath(testRoot, sentinelPath) &&
      containsPath(systemTemporaryRoot, await realpath(process.execPath)) &&
      await realpath(appRoot) === repositoryRoot &&
      repositoryRoot !== originalRepositoryRoot &&
      process.env.NODE_OPTIONS === expectedNodeOptions;
  } catch {
    return false;
  } finally {
    await sentinelHandle?.close();
  }
}

async function createMigrationNativeSandbox(root) {
  const linuxSandbox = await inheritedLinuxValidationSandbox(
    "FINAL_BACKUP_MIGRATION_NATIVE_SANDBOX_UNAVAILABLE",
  );
  if (linuxSandbox) {
    return Object.freeze({
      evidence: migrationNativeSandboxEvidence(
        "linux-bwrap-inherited-v1",
        null,
        false,
        linuxSandbox,
      ),
      wrapper: undefined,
    });
  }
  // NODE_OPTIONS is deliberately empty in the direct safe-runner child: an
  // EACCES/EPERM result therefore proves inherited kernel policy rather than
  // the JavaScript guard. Never make this direct non-loopback probe unless the
  // sentinel and isolated-repository identity bind us to the safe runner.
  if (await safeRunnerInheritedSandboxAllowed()) {
    const inheritedSelfTest = await runMigrationNativeSelfTest();
    assertMigrationNativeSelfTestResult(inheritedSelfTest);
    if (!/^(?:EACCES|EPERM)$/.test(inheritedSelfTest.stdout)) {
      fail(
        "FINAL_BACKUP_MIGRATION_NATIVE_SANDBOX_UNAVAILABLE",
        "Safe-runner native network sandbox did not deny a socket",
      );
    }
    return Object.freeze({
      evidence: migrationNativeSandboxEvidence("inherited", null, true),
      wrapper: undefined,
    });
  }

  if (process.platform !== "darwin") {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_SANDBOX_UNAVAILABLE",
      "Final migration native network sandbox requires macOS",
    );
  }
  const executable = "/usr/bin/sandbox-exec";
  let details;
  try {
    details = await lstat(executable);
  } catch {
    details = undefined;
  }
  if (!details?.isFile() || details.isSymbolicLink()) {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_SANDBOX_UNAVAILABLE",
      "Final migration native network sandbox is unavailable",
    );
  }
  const profilePath = resolve(root, "migration-native.sb");
  await writeFile(profilePath, migrationNativeSandboxProfile, {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(profilePath, 0o600);
  const wrapper = Object.freeze({
    executable,
    arguments: Object.freeze(["-f", profilePath]),
  });
  const explicitSelfTest = await runMigrationNativeSelfTest(wrapper);
  assertMigrationNativeSelfTestResult(explicitSelfTest);
  if (!/^(?:EACCES|EPERM)$/.test(explicitSelfTest.stdout)) {
    fail(
      "FINAL_BACKUP_MIGRATION_NATIVE_SANDBOX_UNAVAILABLE",
      "Final migration native network sandbox self-test did not deny a socket",
    );
  }
  return Object.freeze({
    evidence: migrationNativeSandboxEvidence(
      "explicit",
      createHash("sha256")
        .update(migrationNativeSandboxProfile, "utf8")
        .digest("hex"),
    ),
    wrapper,
  });
}

async function createRuntimeNativeSandbox(startupRoot, instrumented) {
  const linuxSandbox = await inheritedLinuxValidationSandbox(
    "FINAL_BACKUP_STARTUP_NATIVE_SANDBOX_UNAVAILABLE",
  );
  if (linuxSandbox) return undefined;
  if (instrumented) {
    if (process.platform === "linux") {
      fail(
        "FINAL_BACKUP_STARTUP_NATIVE_SANDBOX_UNAVAILABLE",
        "Linux runtime validation requires the authenticated inherited sandbox",
      );
    }
    return undefined;
  }
  // The safe runner already applies a kernel-enforced Seatbelt profile to the
  // entire process tree. A second sandbox-exec invocation is rejected by that
  // outer profile, so consume the inherited policy only after authenticating
  // the runner sentinel, isolated repository, executable and preload identity.
  if (await safeRunnerInheritedSandboxAllowed()) return undefined;
  if (process.platform !== "darwin") {
    fail(
      "FINAL_BACKUP_STARTUP_NATIVE_SANDBOX_UNAVAILABLE",
      "Exact runtime validation requires the native loopback-only sandbox",
    );
  }
  const executable = "/usr/bin/sandbox-exec";
  const details = await lstat(executable).catch(() => undefined);
  if (!details?.isFile() || details.isSymbolicLink()) {
    fail(
      "FINAL_BACKUP_STARTUP_NATIVE_SANDBOX_UNAVAILABLE",
      "Exact runtime validation native sandbox is unavailable",
    );
  }
  const profilePath = resolve(startupRoot, "runtime-native.sb");
  await writeFile(profilePath, runtimeNativeSandboxProfile, {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(profilePath, 0o600);
  return Object.freeze({
    arguments: Object.freeze(["-f", profilePath]),
    executable,
  });
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMilliseconds) {
  if (childExited(child)) return true;
  return await new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolvePromise(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMilliseconds);
    child.once("exit", onExit);
    if (childExited(child)) finish(true);
  });
}

async function stopStartupRuntime(child) {
  const startedAt = Date.now();
  if (childExited(child)) {
    return {
      elapsedMilliseconds: 0,
      exitCode: child.exitCode,
      forced: false,
      graceful: false,
      signal: child.signalCode,
      termSent: false,
    };
  }
  child.kill("SIGTERM");
  if (await waitForChildExit(child, 12_000)) {
    return {
      elapsedMilliseconds: Date.now() - startedAt,
      exitCode: child.exitCode,
      forced: false,
      graceful: child.exitCode === 0 && child.signalCode === null,
      signal: child.signalCode,
      termSent: true,
    };
  }
  child.kill("SIGKILL");
  await waitForChildExit(child, 2_000);
  return {
    elapsedMilliseconds: Date.now() - startedAt,
    exitCode: child.exitCode,
    forced: true,
    graceful: false,
    signal: child.signalCode,
    termSent: true,
  };
}

function listenOnLoopback(server, port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectPromise(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ exclusive: true, host: "127.0.0.1", port });
  });
}

function closeLoopbackServer(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function safeTestStartupPort() {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") return undefined;
  const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535 || port === 4_173) {
    fail(
      "FINAL_BACKUP_STARTUP_PORT_INVALID",
      "Safe final-candidate startup requires its reserved loopback port",
    );
  }
  return port;
}

async function allocateStartupPort() {
  const reserved = safeTestStartupPort();
  if (reserved !== undefined) return reserved;
  const server = createServer();
  try {
    await listenOnLoopback(server, 0);
    const address = server.address();
    if (
      !address || typeof address === "string" ||
      !Number.isInteger(address.port) || address.port <= 0 ||
      address.port === 4_173
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_PORT_INVALID",
        "Final-candidate startup could not reserve a safe loopback port",
      );
    }
    return address.port;
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_STARTUP_PORT_INVALID",
      "Final-candidate startup could not reserve a safe loopback port",
    );
  } finally {
    if (server.listening) await closeLoopbackServer(server);
  }
}

async function assertStartupPortReleased(port) {
  const server = createServer();
  try {
    await listenOnLoopback(server, port);
  } catch {
    fail(
      "FINAL_BACKUP_STARTUP_SHUTDOWN_FAILED",
      "Final-candidate runtime did not release its loopback listener",
    );
  } finally {
    if (server.listening) await closeLoopbackServer(server);
  }
}

async function runtimeJson(
  origin,
  path,
  headers = {},
  { admitStartupConnectionRefused = false } = {},
) {
  let response;
  try {
    response = await runtimeBytes(
      origin,
      path,
      64 * 1024,
      { Accept: "application/json", ...headers },
    );
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (
      admitStartupConnectionRefused && error instanceof Error &&
      "code" in error && error.code === "ECONNREFUSED"
    ) throw error;
    fail(
      "FINAL_BACKUP_STARTUP_RESPONSE_INVALID",
      "Final-candidate runtime response could not be read safely",
    );
  }
  let body;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(response.value);
    body = JSON.parse(text);
  } catch {
    fail(
      "FINAL_BACKUP_STARTUP_RESPONSE_INVALID",
      "Final-candidate runtime returned an invalid response",
    );
  }
  return { body, status: response.status };
}

function readinessSummary(body, expected) {
  if (
    !body || typeof body !== "object" ||
    body.status !== "ready" || body.mode !== expected.mode ||
    body.mutationsAccepted !== expected.mutationsAccepted ||
    body.databaseProbe !== "read-only" ||
    body.schemaVersion !== expected.schemaVersion
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_READINESS_MISMATCH",
      "Migrated restore did not reach normal active readiness",
    );
  }
  return Object.freeze({
    databaseProbe: "read-only",
    mode: expected.mode,
    mutationsAccepted: expected.mutationsAccepted,
    schemaVersion: expected.schemaVersion,
    status: "ready",
  });
}

async function waitForRuntimeReadiness(
  child,
  origin,
  outputState,
  expected,
  headers = {},
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (outputState.startFailed) {
      fail(
        "FINAL_BACKUP_STARTUP_FAILED",
        "Final-candidate runtime process could not start",
      );
    }
    if (outputState.exceeded) {
      fail(
        "FINAL_BACKUP_STARTUP_OUTPUT_TOO_LARGE",
        "Final-candidate runtime output exceeded its limit",
      );
    }
    if (childExited(child)) {
      fail(
        "FINAL_BACKUP_STARTUP_FAILED",
        "Final-candidate runtime exited before readiness",
      );
    }
    let response;
    try {
      response = await runtimeJson(
        origin,
        "/api/health/ready",
        headers,
        { admitStartupConnectionRefused: true },
      );
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (!(error instanceof Error && "code" in error &&
        error.code === "ECONNREFUSED")) {
        fail(
          "FINAL_BACKUP_STARTUP_RESPONSE_INVALID",
          "Final-candidate readiness response could not be read safely",
        );
      }
    }
    if (response?.status === 200) return readinessSummary(response.body, expected);
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, Math.min(100, remaining)));
    }
  }
  fail(
    "FINAL_BACKUP_STARTUP_TIMEOUT",
    "Final-candidate runtime did not reach readiness before its deadline",
  );
}

function parseJsonDocument(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(
      "FINAL_BACKUP_STARTUP_DATA_UNREADABLE",
      `Final-candidate ${label} is not readable JSON`,
    );
  }
  return parsed;
}

async function sha256OpenedMedia(
  mediaDirectory,
  storageName,
  expectedSize,
) {
  let handle;
  try {
    const directoryBefore = await lstat(mediaDirectory);
    if (
      directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory() ||
      typeof process.getuid !== "function" ||
      directoryBefore.uid !== process.getuid() ||
      (directoryBefore.mode & 0o022) !== 0
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_MEDIA_UNREADABLE",
        "Final-candidate media directory is unsafe",
      );
    }
    const path = resolve(mediaDirectory, storageName);
    handle = await open(
      path,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
    );
    const before = await handle.stat();
    if (
      !before.isFile() || before.nlink !== 1 || before.size !== expectedSize ||
      typeof process.getuid !== "function" || before.uid !== process.getuid() ||
      (before.mode & 0o022) !== 0
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_MEDIA_UNREADABLE",
        "Final-candidate local media is unsafe or changed",
      );
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      position !== expectedSize || after.dev !== before.dev ||
      after.ino !== before.ino || after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_MEDIA_UNREADABLE",
        "Final-candidate local media changed while reading",
      );
    }
    const pathIdentity = await lstat(path);
    const directoryAfter = await lstat(mediaDirectory);
    if (
      pathIdentity.isSymbolicLink() || !pathIdentity.isFile() ||
      pathIdentity.dev !== before.dev || pathIdentity.ino !== before.ino ||
      pathIdentity.nlink !== 1 || directoryAfter.isSymbolicLink() ||
      !directoryAfter.isDirectory() ||
      directoryAfter.dev !== directoryBefore.dev ||
      directoryAfter.ino !== directoryBefore.ino ||
      directoryAfter.uid !== directoryBefore.uid ||
      directoryAfter.mode !== directoryBefore.mode ||
      directoryAfter.mtimeMs !== directoryBefore.mtimeMs ||
      directoryAfter.ctimeMs !== directoryBefore.ctimeMs
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_MEDIA_UNREADABLE",
        "Final-candidate local media path changed while reading",
      );
    }
    return hash.digest("hex");
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_STARTUP_MEDIA_UNREADABLE",
      "Final-candidate local media could not be read safely",
    );
  } finally {
    await handle?.close();
  }
}

async function validateRestoredApplicationData(targetDirectory) {
  let database;
  let media;
  let summary;
  try {
    database = openAppDatabase(targetDirectory);
    const sessions = database.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions AS session
      JOIN users AS owner ON owner.id = session.user_id
      WHERE owner.status = 'active'
    `).get();
    const sessionSample = database.prepare(`
      SELECT session.token_hash, session.expires_at
      FROM sessions AS session
      JOIN users AS owner ON owner.id = session.user_id
      WHERE owner.status = 'active'
      ORDER BY session.id
      LIMIT 1
    `).get();
    const sessionRowsRead = Number(sessions?.count);
    if (
      !Number.isSafeInteger(sessionRowsRead) || sessionRowsRead < 1 ||
      typeof sessionSample?.token_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(sessionSample.token_hash) ||
      typeof sessionSample?.expires_at !== "string" ||
      !Number.isFinite(Date.parse(sessionSample.expires_at))
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_DATA_UNREADABLE",
        "Final-candidate persisted sessions are not readable",
      );
    }

    const canvases = database.prepare(
      "SELECT COUNT(*) AS count FROM canvas_documents",
    ).get();
    const canvasSample = database.prepare(`
      SELECT nodes, edges, viewport
      FROM canvas_documents
      ORDER BY id
      LIMIT 1
    `).get();
    const canvasDocumentsRead = Number(canvases?.count);
    if (
      !Number.isSafeInteger(canvasDocumentsRead) || canvasDocumentsRead < 1 ||
      typeof canvasSample?.nodes !== "string" ||
      typeof canvasSample?.edges !== "string" ||
      typeof canvasSample?.viewport !== "string"
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_DATA_UNREADABLE",
        "Final-candidate persisted canvases are not readable",
      );
    }
    const nodes = parseJsonDocument(canvasSample.nodes, "canvas nodes");
    const edges = parseJsonDocument(canvasSample.edges, "canvas edges");
    const viewport = parseJsonDocument(canvasSample.viewport, "canvas viewport");
    if (
      !Array.isArray(nodes) || nodes.length < 1 || !Array.isArray(edges) ||
      !viewport || typeof viewport !== "object" || Array.isArray(viewport) ||
      !Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) ||
      !Number.isFinite(viewport.zoom) || viewport.zoom <= 0
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_DATA_UNREADABLE",
        "Final-candidate persisted canvas document is invalid",
      );
    }

    const activeTasks = database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_tasks
      WHERE state IN ('queued', 'running', 'recovering', 'retrying')
    `).get();
    const generationTasks = database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_tasks
    `).get();
    const providerAttempts = database.prepare(`
      SELECT COUNT(*) AS count
      FROM generation_provider_attempts
    `).get();
    const credentialEpochs = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM account_provider_credentials) AS credentials,
        (SELECT COUNT(*) FROM account_provider_credential_epochs) AS epochs,
        (SELECT COUNT(*)
          FROM account_provider_credentials AS credentials
          JOIN account_provider_credential_epochs AS epochs
            ON epochs.account_id = credentials.account_id
            AND epochs.provider_profile_id = credentials.provider_profile_id
            AND epochs.credential_revision = credentials.credential_version
        ) AS aligned
    `).get();
    const activeGenerationTasks = Number(activeTasks?.count);
    const generationTasksTotal = Number(generationTasks?.count);
    const generationProviderAttemptsTotal = Number(providerAttempts?.count);
    const accountProviderCredentialsTotal = Number(credentialEpochs?.credentials);
    const accountProviderCredentialEpochsTotal = Number(credentialEpochs?.epochs);
    const accountProviderCredentialEpochsAligned = Number(credentialEpochs?.aligned);
    const linuxValidationSandbox =
      await inheritedLinuxValidationSandbox(
        "FINAL_BACKUP_STARTUP_NATIVE_SANDBOX_UNAVAILABLE",
      );
    if (
      activeGenerationTasks !== 0 ||
      !Number.isSafeInteger(generationTasksTotal) || generationTasksTotal < 0 ||
      !Number.isSafeInteger(generationProviderAttemptsTotal) ||
      generationProviderAttemptsTotal < 0 ||
      !Number.isSafeInteger(accountProviderCredentialsTotal) ||
      !Number.isSafeInteger(accountProviderCredentialEpochsTotal) ||
      !Number.isSafeInteger(accountProviderCredentialEpochsAligned) ||
      linuxValidationSandbox &&
        (accountProviderCredentialsTotal !== 1 ||
          accountProviderCredentialEpochsTotal !== 1 ||
          accountProviderCredentialEpochsAligned !== 1) ||
      linuxValidationSandbox &&
        (generationTasksTotal !== 0 || generationProviderAttemptsTotal !== 0)
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_NOT_QUIET",
        linuxValidationSandbox
          ? "Production Linux validation observed generation or paid-attempt ledger entries"
          : "Final-candidate restore has active generation work at startup",
      );
    }

    const mediaRecovery = database.prepare(`
      SELECT (
        (SELECT COUNT(*) FROM media_delete_intents) +
        (SELECT COUNT(*) FROM media_publication_attempts)
      ) AS count
    `).get();
    const startupMediaRecoveryCandidates = Number(mediaRecovery?.count);
    if (startupMediaRecoveryCandidates !== 0) {
      fail(
        "FINAL_BACKUP_STARTUP_NOT_QUIET",
        "Final-candidate restore has unsettled startup media work",
      );
    }

    const migratedDurations = database.prepare(`
      SELECT id, duration_seconds, duration_source, duration_status
      FROM media_assets
      WHERE storage_backend = 'local' AND storage_status = 'ready'
        AND kind IN ('audio', 'video')
      ORDER BY kind, id
    `).all();
    const migratedDuration = migratedDurations[0];
    if (
      migratedDurations.length !== 1 ||
      typeof migratedDuration?.id !== "string" ||
      migratedDuration.duration_status !== "ready" ||
      migratedDuration.duration_source !== "server-probe" ||
      !Number.isFinite(Number(migratedDuration.duration_seconds)) ||
      Number(migratedDuration.duration_seconds) <= 0
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_DURATION_UNREADABLE",
        "Final-candidate migrated duration metadata is not ready",
      );
    }

    media = database.prepare(`
      SELECT storage_name, byte_size, checksum_sha256
      FROM media_assets
      WHERE storage_backend = 'local' AND storage_status = 'ready'
      ORDER BY kind, id
      LIMIT 1
    `).get();
    if (
      typeof media?.storage_name !== "string" ||
      basename(media.storage_name) !== media.storage_name ||
      media.storage_name.includes("\\") ||
      !Number.isSafeInteger(Number(media.byte_size)) || Number(media.byte_size) <= 0 ||
      typeof media.checksum_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(media.checksum_sha256)
    ) {
      fail(
        "FINAL_BACKUP_STARTUP_MEDIA_UNREADABLE",
        "Final-candidate has no readable ready local media",
      );
    }
    summary = {
      accountProviderCredentialEpochsAligned,
      accountProviderCredentialEpochsTotal,
      accountProviderCredentialsTotal,
      activeGenerationTasks,
      canvasDocumentsRead,
      generationProviderAttemptsTotal,
      generationTasksTotal,
      ordinaryDatabaseOpen: true,
      readyLegacyDurationAssets: migratedDurations.length,
      sessionRowsRead,
      startupMediaRecoveryCandidates,
    };
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_STARTUP_DATA_UNREADABLE",
      "Final-candidate application data could not be read normally",
    );
  } finally {
    try {
      database?.close();
    } catch {
      fail(
        "FINAL_BACKUP_STARTUP_DATA_UNREADABLE",
        "Final-candidate application database did not close cleanly",
      );
    }
  }
  const mediaSha256 = await sha256OpenedMedia(
    resolve(targetDirectory, "media"),
    media.storage_name,
    Number(media.byte_size),
  );
  if (mediaSha256 !== media.checksum_sha256) {
    fail(
      "FINAL_BACKUP_STARTUP_MEDIA_UNREADABLE",
      "Final-candidate local media checksum does not match",
    );
  }
  return Object.freeze({
    ...summary,
    localMediaBytesRead: Number(media.byte_size),
    localMediaRead: 1,
  });
}

async function inspectStartupNetworkAudit(
  auditPath,
  port,
  childPid,
  { auxiliaryPort, instrumented },
) {
  if (!instrumented) {
    const linuxSandbox = await inheritedLinuxValidationSandbox(
      "FINAL_BACKUP_STARTUP_NATIVE_SANDBOX_UNAVAILABLE",
    );
    if (linuxSandbox) {
      return Object.freeze({
        deniedWildcardBindProbes: null,
        externalNetworkAttempts: null,
        externalNetworkSuccesses: 0,
        guardLoads: 0,
        instrumentation: "linux-bwrap-network-namespace",
        linuxSandbox,
        networkAttemptCounting: "not-instrumented",
        ossRequests: null,
        providerRequests: null,
      });
    }
    return Object.freeze({
      deniedWildcardBindProbes: null,
      externalNetworkAttempts: 0,
      guardLoads: 0,
      instrumentation: "native-process-sandbox",
      ossRequests: 0,
      providerRequests: 0,
    });
  }
  let events;
  try {
    events = (await readFile(auditPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    fail(
      "FINAL_BACKUP_STARTUP_AUDIT_INVALID",
      "Final-candidate runtime network audit is invalid",
    );
  }
  const loadedGuards = events.filter((event) =>
    event?.event === "node_guard_loaded" &&
    Array.isArray(event.initialAllowedPorts) &&
    event.initialAllowedPorts.includes(port)
  );
  const guardLoads = loadedGuards.filter((event) => event.pid === childPid).length;
  const blocked = events.filter((event) =>
    event?.event === "node_network_blocked"
  );
  // Vite 8 checks whether the selected port is occupied on each wildcard
  // address before it binds the explicitly requested host. The offline guard
  // denies those three availability probes before any wildcard listener is
  // created. Accept only that exact, version-pinned denial shape; every other
  // blocked operation remains evidence of an unapproved network attempt.
  const viteWildcardProbeHosts = [
    "0.0.0.0",
    "::",
    "0000:0000:0000:0000:0000:0000:0000:0000",
  ];
  const viteWildcardProbeDenials = blocked.filter((event) =>
    event.kind === "net.Server.listen" &&
    Number.isSafeInteger(event.port) && event.port >= 0 && event.port <= 65_535 &&
    event.reason === "non_loopback" &&
    viteWildcardProbeHosts.includes(event.host)
  );
  const wildcardGroups = new Map();
  for (const event of viteWildcardProbeDenials) {
    const key = `${event.pid}:${event.port}`;
    const group = wildcardGroups.get(key) ?? [];
    group.push(event);
    wildcardGroups.set(key, group);
  }
  const exactViteWildcardProbeDenials = wildcardGroups.size >= 1 &&
    [...wildcardGroups.values()].every((group) =>
      group.length === viteWildcardProbeHosts.length &&
      viteWildcardProbeHosts.every((host) =>
        group.filter((event) => event.host === host).length === 1
      )
    ) && wildcardGroups.has(`${childPid}:${port}`);
  const unexpectedBlocked = blocked.filter((event) =>
    !viteWildcardProbeDenials.includes(event)
  );
  const logicalTargets = events.filter((event) =>
    event?.event === "node_logical_target_via_guarded_agent"
  );
  const listenerEvents = events.filter((event) => new Set([
    "node_loopback_port_registered",
    "node_loopback_port_unregistered",
  ]).has(event?.event));
  const listenerGroups = new Map();
  let invalidListenerEvent = false;
  for (const event of listenerEvents) {
    if (
      event.kind !== "net.Server.listen" || !Number.isSafeInteger(event.pid) ||
      !Number.isSafeInteger(event.port) || event.port < 1 || event.port > 65_535
    ) {
      invalidListenerEvent = true;
      continue;
    }
    const key = `${event.pid}:${event.port}`;
    const group = listenerGroups.get(key) ?? { registered: 0, unregistered: 0 };
    if (event.event === "node_loopback_port_registered") group.registered += 1;
    else group.unregistered += 1;
    listenerGroups.set(key, group);
  }
  const mainListener = listenerGroups.get(`${childPid}:${port}`);
  const listenersBalanced = [...listenerGroups.values()].every((group) =>
    group.registered === 1 && group.unregistered === 1
  );
  if (
    guardLoads < 1 || !exactViteWildcardProbeDenials ||
    unexpectedBlocked.length !== 0 || logicalTargets.length !== 0 ||
    invalidListenerEvent || !listenersBalanced || mainListener?.registered !== 1 ||
    mainListener?.unregistered !== 1
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_NETWORK_ATTEMPTED",
      "Final-candidate runtime attempted an unapproved network operation",
    );
  }
  return Object.freeze({
    deniedWildcardBindProbes: viteWildcardProbeDenials.length,
    externalNetworkAttempts: 0,
    guardLoads: loadedGuards.length,
    ossRequests: 0,
    providerRequests: 0,
  });
}

function runtimeEnvironment(
  release,
  targetDirectory,
  runtimeRoots,
  port,
  auditPath,
  { nativeOnly = false } = {},
) {
  const guardPath = resolve(appRoot, "scripts", "offline-network-guard.mjs");
  const placeholders = Object.freeze({
    UNBOUNDRY_DATA_DIR: targetDirectory,
    UNBOUNDRY_RUNTIME_DIR: runtimeRoots.runtime,
    UNBOUNDRY_RUNTIME_HOME: runtimeRoots.home,
    UNBOUNDRY_RUNTIME_ROLE: "active",
    UNBOUNDRY_RUNTIME_TEMP: runtimeRoots.temporary,
    UNBOUNDRY_VITE_CACHE_DIR: runtimeRoots.cache,
  });
  const environment = {};
  for (const [name, contract] of Object.entries(release.manifest.runtime.environment)) {
    if (contract.source === "literal") environment[name] = contract.value;
    else environment[name] = placeholders[contract.placeholder];
  }
  const instrumented = Boolean(
    process.env.UNBOUNDRY_SAFE_TEST === "1" && !nativeOnly,
  );
  if (instrumented) {
    environment.NODE_OPTIONS = `--import=${pathToFileURL(guardPath).href}`;
    environment.UNBOUNDRY_OFFLINE_GUARD_ALLOWED_PORTS = JSON.stringify([
      port,
      Number(process.env.UNBOUNDRY_TEST_PORT),
    ]);
    environment.UNBOUNDRY_OFFLINE_GUARD_AUDIT = auditPath;
    environment.UNBOUNDRY_OFFLINE_GUARD_MODE = "final-candidate";
  }
  for (const name of release.manifest.runtime.forbiddenEnvironment) {
    if (name === "NODE_OPTIONS" && instrumented) continue;
    delete environment[name];
  }
  for (const prefix of release.manifest.runtime.forbiddenEnvironmentPrefixes) {
    for (const name of Object.keys(environment)) {
      if (name.startsWith(prefix)) delete environment[name];
    }
  }
  return Object.freeze({ environment, instrumented });
}

function stableArtifactIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.nlink === right.nlink && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function stablePinnedRootIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.nlink === right.nlink && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function assertTrustedPinnedRoot(details, code, message) {
  if (
    !details.isDirectory() || details.isSymbolicLink() ||
    typeof process.getuid !== "function" ||
    details.uid !== BigInt(process.getuid()) ||
    details.nlink < 1n || (details.mode & 0o022n) !== 0n
  ) fail(code, message);
}

function compareArtifactPath(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function finalInventoryTestCheckpoint(kind, checkpointRoot) {
  if (
    process.env.UNBOUNDRY_SAFE_TEST !== "1" ||
    process.env.UNBOUNDRY_TEST_FINAL_INVENTORY_SWAP_KIND !== kind
  ) return;
  try {
    const systemTemporaryRoot = await realpath(String(
      process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT ?? "",
    ));
    const testRoot = await realpath(String(process.env.UNBOUNDRY_TEST_ROOT ?? ""));
    const repositoryRoot = await realpath(String(
      process.env.UNBOUNDRY_TEST_REPOSITORY_ROOT ?? "",
    ));
    const safeDataDirectory = await realpath(String(
      process.env.UNBOUNDRY_DATA_DIR ?? "",
    ));
    const originalRepositoryRoot = resolve(String(
      process.env.UNBOUNDRY_ORIGINAL_REPOSITORY_ROOT ?? "",
    ));
    const sentinelPath = await realpath(String(
      process.env.UNBOUNDRY_SAFE_RUN_SENTINEL ?? "",
    ));
    const nonce = String(process.env.UNBOUNDRY_SAFE_RUN_NONCE ?? "");
    const expectedNodeOptions = `--import=${resolve(
      repositoryRoot,
      "scripts",
      "offline-network-guard.mjs",
    )}`;

    let sentinelHandle;
    let sentinelSource = "";
    let sentinelBefore;
    let sentinelAfter;
    let sentinelPathIdentity;
    try {
      sentinelHandle = await open(
        sentinelPath,
        fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
      );
      sentinelBefore = await sentinelHandle.stat({ bigint: true });
      if (sentinelBefore.size >= 256n) return;
      const buffer = Buffer.alloc(256);
      const { bytesRead } = await sentinelHandle.read(
        buffer,
        0,
        buffer.length,
        0,
      );
      sentinelSource = buffer.toString("utf8", 0, bytesRead).trim();
      buffer.fill(0);
      sentinelAfter = await sentinelHandle.stat({ bigint: true });
      sentinelPathIdentity = await lstat(sentinelPath, { bigint: true });
    } finally {
      await sentinelHandle?.close();
    }

    const appRootIdentity = await realpath(appRoot);
    const expectedCheckpointRoot = await realpath(checkpointRoot);
    let buildCheckpointAuthorized = kind !== "build";
    if (kind === "build") {
      const releaseAttestation = await readReleaseAttestation();
      const suiteRoot = await realpath(dirname(testRoot));
      const attestedBuildRoots = new Set(
        Object.values(releaseAttestation.manifestPaths).map((manifestPath) =>
          resolve(dirname(manifestPath), "dist", "client")),
      );
      buildCheckpointAuthorized =
        containsPath(systemTemporaryRoot, suiteRoot) &&
        containsPath(suiteRoot, releaseAttestation.root) &&
        !containsPath(testRoot, releaseAttestation.root) &&
        containsPath(releaseAttestation.root, expectedCheckpointRoot) &&
        attestedBuildRoots.has(expectedCheckpointRoot);
    }
    const notificationPipe = fstatSync(3);
    const releasePipe = fstatSync(4);
    const isPipe = (details) => details.isFIFO() || details.isSocket();
    if (
      nonce.length < 16 || sentinelSource !== nonce ||
      !sentinelBefore?.isFile() || sentinelBefore.isSymbolicLink() ||
      sentinelBefore.nlink !== 1n ||
      typeof process.getuid !== "function" ||
      sentinelBefore.uid !== BigInt(process.getuid()) ||
      (sentinelBefore.mode & 0o077n) !== 0n ||
      !stablePinnedRootIdentity(sentinelBefore, sentinelAfter) ||
      !stablePinnedRootIdentity(sentinelBefore, sentinelPathIdentity) ||
      !containsPath(systemTemporaryRoot, testRoot) ||
      !containsPath(testRoot, safeDataDirectory) ||
      !containsPath(systemTemporaryRoot, repositoryRoot) ||
      repositoryRoot === originalRepositoryRoot ||
      appRootIdentity !== repositoryRoot ||
      !buildCheckpointAuthorized ||
      (kind === "restored" &&
        !containsPath(testRoot, expectedCheckpointRoot)) ||
      !containsPath(testRoot, sentinelPath) ||
      !isPipe(notificationPipe) || !isPipe(releasePipe) ||
      process.env.NODE_OPTIONS !== expectedNodeOptions
    ) return;
  } catch {
    // A forged or incomplete safe-test environment disables the IPC-only seam.
    // Normal final-candidate work continues without any checkpoint side effect.
    return;
  }
  const token = Buffer.from(`inventory:${kind}\n`, "utf8");
  if (writeSync(3, token) !== token.length) {
    fail("FINAL_BACKUP_INTERNAL_ERROR", "Inventory checkpoint notification failed");
  }
  const released = await new Promise((resolveRelease) => {
    const buffer = Buffer.alloc(1);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRelease(value);
    };
    const timer = setTimeout(() => {
      try {
        closeSync(4);
      } catch {}
      finish(false);
    }, 10_000);
    read(4, buffer, 0, 1, null, (error, bytesRead) => {
      finish(!error && bytesRead === 1 && buffer[0] === 1);
      buffer.fill(0);
    });
  });
  if (!released) {
    fail("FINAL_BACKUP_INTERNAL_ERROR", "Inventory checkpoint release failed");
  }
}

function assertTrustedArtifactEntry(details, expectedKind) {
  const correctKind = expectedKind === "directory"
    ? details.isDirectory()
    : details.isFile();
  if (
    !correctKind || details.isSymbolicLink() ||
    typeof process.getuid !== "function" || details.uid !== process.getuid() ||
    (details.mode & 0o022) !== 0 ||
    (expectedKind === "file" && (
      details.nlink !== 1 || !Number.isSafeInteger(details.size) ||
      details.size < 0
    ))
  ) {
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
      "Final-candidate production build contains an unsafe entry",
    );
  }
}

async function readBuildArtifactFile(path, logicalPath) {
  let handle;
  try {
    handle = await open(
      path,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    const before = await handle.stat();
    assertTrustedArtifactEntry(before, "file");
    if (before.size > maximumBuildArtifactBytes) {
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_TOO_LARGE",
        "Final-candidate production build exceeds its byte limit",
      );
    }
    const hash = createHash("sha256");
    const indexChunks = logicalPath === "index.html" ? [] : undefined;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      indexChunks?.push(Buffer.from(chunk));
      position += bytesRead;
    }
    const after = await handle.stat();
    const pathIdentity = await lstat(path);
    if (
      position !== before.size || !stableArtifactIdentity(before, after) ||
      !stableArtifactIdentity(before, pathIdentity)
    ) {
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
        "Final-candidate production build changed while it was read",
      );
    }
    return Object.freeze({
      identity: Object.freeze({
        ctimeMs: before.ctimeMs,
        dev: before.dev,
        ino: before.ino,
        mode: before.mode,
        mtimeMs: before.mtimeMs,
        nlink: before.nlink,
        path: logicalPath,
        size: before.size,
        uid: before.uid,
      }),
      indexBytes: indexChunks ? Buffer.concat(indexChunks) : undefined,
      record: Object.freeze({
        kind: "file",
        path: logicalPath,
        mode: before.mode & 0o777,
        size: before.size,
        sha256: hash.digest("hex"),
      }),
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
      "Final-candidate production build could not be read safely",
    );
  } finally {
    await handle?.close();
  }
}

async function inventoryProductionBuild(releaseDirectory = appRoot) {
  const requestedRoot = resolve(releaseDirectory, "dist", "client");
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(requestedRoot);
  } catch {
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_MISSING",
      "Final-candidate production build is missing",
    );
  }
  if (canonicalRoot !== requestedRoot) {
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
      "Final-candidate production build root is not canonical",
    );
  }
  const rootParent = dirname(requestedRoot);
  let initialRootParentIdentity;
  let initialRootIdentity;
  let rootHandle;
  let rootParentHandle;
  try {
    rootParentHandle = await open(
      rootParent,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    initialRootParentIdentity = await rootParentHandle.stat({ bigint: true });
    const requestedParentIdentity = await lstat(rootParent, { bigint: true });
    assertTrustedPinnedRoot(
      initialRootParentIdentity,
      "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
      "Final-candidate production build parent is unsafe",
    );
    if (!stablePinnedRootIdentity(
      initialRootParentIdentity,
      requestedParentIdentity,
    )) {
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
        "Final-candidate production build parent identity is unstable",
      );
    }
    rootHandle = await open(
      canonicalRoot,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    initialRootIdentity = await rootHandle.stat({ bigint: true });
    const requestedIdentity = await lstat(requestedRoot, { bigint: true });
    assertTrustedPinnedRoot(
      initialRootIdentity,
      "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
      "Final-candidate production build root is unsafe",
    );
    if (!stablePinnedRootIdentity(initialRootIdentity, requestedIdentity)) {
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
        "Final-candidate production build root identity is unstable",
      );
    }
  } catch (error) {
    await rootHandle?.close();
    rootHandle = undefined;
    await rootParentHandle?.close();
    rootParentHandle = undefined;
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
      "Final-candidate production build root could not be pinned safely",
    );
  }
  try {
    await finalInventoryTestCheckpoint("build", requestedRoot);
    try {
      const checkpointRootIdentity = await rootHandle.stat({ bigint: true });
      const requestedIdentity = await lstat(requestedRoot, { bigint: true });
      const checkpointParentIdentity = await rootParentHandle.stat({ bigint: true });
      const requestedParentIdentity = await lstat(rootParent, { bigint: true });
      if (
        !stablePinnedRootIdentity(initialRootIdentity, checkpointRootIdentity) ||
        !stablePinnedRootIdentity(initialRootIdentity, requestedIdentity) ||
        !stablePinnedRootIdentity(
          initialRootParentIdentity,
          checkpointParentIdentity,
        ) ||
        !stablePinnedRootIdentity(
          initialRootParentIdentity,
          requestedParentIdentity,
        )
      ) {
        fail(
          "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
          "Final-candidate production build root identity changed",
        );
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
        "Final-candidate production build root could not be revalidated",
      );
    }
    const directoryIdentities = [];
    const directoryRecords = [];
    const files = [];
    let buildBytes = 0;
    let buildEntries = 1;
    let buildPathBytes = 0;
    let indexBytes;
  async function visit(directory, prefix = "", depth = 0) {
    let handle;
    let before;
    try {
      handle = await open(
        directory,
        fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
          fileConstants.O_NONBLOCK,
      );
      before = await handle.stat();
      assertTrustedArtifactEntry(before, "directory");
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
        "Final-candidate production build directory could not be pinned safely",
      );
    } finally {
      await handle?.close();
      handle = undefined;
    }
    const children = [];
    let directoryHandle;
    try {
      directoryHandle = await opendir(directory);
      for (;;) {
        const child = await directoryHandle.read();
        if (child === null) break;
        buildEntries += 1;
        if (buildEntries > maximumBuildArtifactEntries) {
          fail(
            "FINAL_BACKUP_BUILD_ARTIFACT_TOO_LARGE",
            "Final-candidate production build exceeds its entry limit",
          );
        }
        const nameBytes = Buffer.byteLength(child.name, "utf8");
        const logicalPath = prefix ? `${prefix}/${child.name}` : child.name;
        const logicalPathBytes = Buffer.byteLength(logicalPath, "utf8");
        buildPathBytes += logicalPathBytes;
        if (
          nameBytes === 0 || nameBytes > maximumBuildArtifactNameBytes ||
          logicalPathBytes > maximumBuildArtifactPathBytes ||
          buildPathBytes > maximumBuildArtifactInventoryPathBytes ||
          depth + 1 > maximumBuildArtifactDepth
        ) {
          fail(
            "FINAL_BACKUP_BUILD_ARTIFACT_TOO_LARGE",
            "Final-candidate production build exceeds its path limits",
          );
        }
        children.push(Object.freeze({
          logicalPath,
          name: child.name,
        }));
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
        "Final-candidate production build directory could not be read safely",
      );
    } finally {
      try {
        await directoryHandle?.close();
      } catch {
        // A completed directory read may already have closed its handle.
      }
    }
    try {
      children.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const child of children) {
        const path = resolve(directory, child.name);
        if (!containsPath(canonicalRoot, path)) {
          fail(
            "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
            "Final-candidate production build escaped its canonical root",
          );
        }
        const { logicalPath } = child;
        const details = await lstat(path);
        if (details.isDirectory() && !details.isSymbolicLink()) {
          await visit(path, logicalPath, depth + 1);
          continue;
        }
        if (!details.isFile() || details.isSymbolicLink()) {
          fail(
            "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
            "Final-candidate production build contains a link or special entry",
          );
        }
        const inspected = await readBuildArtifactFile(path, logicalPath);
        buildBytes += inspected.record.size;
        if (buildBytes > maximumBuildArtifactBytes) {
          fail(
            "FINAL_BACKUP_BUILD_ARTIFACT_TOO_LARGE",
            "Final-candidate production build exceeds its byte limit",
          );
        }
        files.push(inspected);
        if (logicalPath === "index.html") indexBytes = inspected.indexBytes;
      }
      handle = await open(
        directory,
        fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
          fileConstants.O_NONBLOCK,
      );
      const after = await handle.stat();
      const pathIdentity = await lstat(directory);
      if (
        !stableArtifactIdentity(before, after) ||
        !stableArtifactIdentity(before, pathIdentity)
      ) {
        fail(
          "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
          "Final-candidate production build directory changed while it was read",
        );
      }
      directoryIdentities.push(Object.freeze({
        ctimeMs: before.ctimeMs,
        dev: before.dev,
        ino: before.ino,
        mode: before.mode,
        mtimeMs: before.mtimeMs,
        nlink: before.nlink,
        path: prefix,
        size: before.size,
        uid: before.uid,
      }));
      directoryRecords.push(Object.freeze({
        kind: "directory",
        path: prefix,
        mode: before.mode & 0o777,
      }));
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_UNSAFE",
        "Final-candidate production build could not be inventoried safely",
      );
    } finally {
      await handle?.close();
      handle = undefined;
    }
  }
  await visit(canonicalRoot);
  let canonicalRootAfter;
  try {
    canonicalRootAfter = await realpath(requestedRoot);
  } catch {
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
      "Final-candidate production build root changed while it was read",
    );
  }
  if (canonicalRootAfter !== canonicalRoot) {
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
      "Final-candidate production build root changed while it was read",
    );
  }
  try {
    const finalRootIdentity = await rootHandle.stat({ bigint: true });
    const requestedIdentity = await lstat(requestedRoot, { bigint: true });
    const finalParentIdentity = await rootParentHandle.stat({ bigint: true });
    const requestedParentIdentity = await lstat(rootParent, { bigint: true });
    if (
      !stablePinnedRootIdentity(initialRootIdentity, finalRootIdentity) ||
      !stablePinnedRootIdentity(initialRootIdentity, requestedIdentity) ||
      !stablePinnedRootIdentity(initialRootParentIdentity, finalParentIdentity) ||
      !stablePinnedRootIdentity(
        initialRootParentIdentity,
        requestedParentIdentity,
      )
    ) {
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
        "Final-candidate production build root identity changed",
      );
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
      "Final-candidate production build root could not be revalidated",
    );
  }
    const fileRecords = files.map((file) => file.record);
    const records = [...directoryRecords, ...fileRecords].sort(compareArtifactPath);
    const index = fileRecords.find((record) => record.path === "index.html");
    if (!index || index.size === 0 || !indexBytes || indexBytes.length === 0) {
      fail(
        "FINAL_BACKUP_BUILD_INDEX_INVALID",
        "Final-candidate production build requires a nonempty index.html",
      );
    }
    const identity = JSON.stringify({
      directories: directoryIdentities.sort(compareArtifactPath),
      files: files.map((file) => file.identity).sort(compareArtifactPath),
    });
    return Object.freeze({
      identity,
      indexBytes,
      summary: Object.freeze({
        buildArtifactSha256: createHash("sha256")
          .update(JSON.stringify(records)).digest("hex"),
        buildBytes,
        buildFiles: fileRecords.length,
        indexSha256: index.sha256,
      }),
    });
  } finally {
    await rootHandle?.close();
    await rootParentHandle?.close();
  }
}

function isExcludedSqliteTransient(logicalPath) {
  return new Set([
    "unboundry.sqlite-journal",
    "unboundry.sqlite-shm",
    "unboundry.sqlite-wal",
  ]).has(logicalPath);
}

const legacySchema37MutableMediaColumns = new Set([
  "checksum_sha256",
  "duration_seconds",
  "duration_source",
  "duration_status",
  "updated_at",
]);

function quotedSqliteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function normalizedSqliteValue(value) {
  if (value === null) return ["null"];
  if (typeof value === "string") return ["text", value];
  if (typeof value === "number" && Number.isFinite(value)) {
    return ["number", Object.is(value, -0) ? 0 : value];
  }
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (value instanceof Uint8Array) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return [
      "blob",
      bytes.length,
      createHash("sha256").update(bytes).digest("hex"),
    ];
  }
  fail(
    "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
    "Schema-37 invariant contains an unsupported SQLite value",
  );
}

function schema37InvariantFingerprint(targetDirectory) {
  const databasePath = resolve(targetDirectory, "unboundry.sqlite");
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec("PRAGMA query_only = ON");
    const schema = database.prepare(`
      SELECT name, sql, tbl_name, type
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all();
    const tables = schema
      .filter((entry) => entry.type === "table")
      .map((entry) => String(entry.name));
    const hash = createHash("sha256");
    hash.update(`${JSON.stringify({ schema })}\n`);
    for (const table of tables) {
      const tableIdentifier = quotedSqliteIdentifier(table);
      const columns = database.prepare(
        `PRAGMA table_xinfo(${tableIdentifier})`,
      ).all().filter((column) => Number(column.hidden) === 0)
        .map((column) => String(column.name));
      if (columns.length === 0) {
        fail(
          "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
          "Schema-37 invariant contains a columnless table",
        );
      }
      const mutableColumns = table === "media_assets"
        ? legacySchema37MutableMediaColumns
        : new Set();
      const invariantColumns = columns.filter((column) =>
        !mutableColumns.has(column)
      );
      if (invariantColumns.length === 0) {
        fail(
          "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
          "Schema-37 invariant table has no immutable columns",
        );
      }
      const orderBy = invariantColumns.map(quotedSqliteIdentifier).join(", ");
      const rows = database.prepare(
        `SELECT * FROM ${tableIdentifier} ORDER BY ${orderBy}`,
      ).iterate();
      hash.update(`${JSON.stringify({ columns, table })}\n`);
      for (const row of rows) {
        hash.update(`${JSON.stringify(columns.map((column) =>
          mutableColumns.has(column)
            ? ["legacy-schema37-metadata"]
            : normalizedSqliteValue(row[column])))}\n`);
      }
    }
    return hash.digest("hex");
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
      "Schema-37 invariant could not be read safely",
    );
  } finally {
    try {
      database?.close();
    } catch {
      fail(
        "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
        "Schema-37 invariant reader could not be closed safely",
      );
    }
  }
}

function schema37DurationState(targetDirectory) {
  const databasePath = resolve(targetDirectory, "unboundry.sqlite");
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec("PRAGMA query_only = ON");
    const rows = database.prepare(`
      SELECT id, duration_seconds, duration_source, duration_status
      FROM media_assets
      WHERE storage_backend = 'local' AND storage_status = 'ready'
        AND kind IN ('audio', 'video')
      ORDER BY kind, id
    `).all();
    const counts = { failed: 0, pending: 0, ready: 0 };
    for (const row of rows) {
      if (
        typeof row.id !== "string" ||
        !Object.hasOwn(counts, String(row.duration_status)) ||
        (row.duration_status === "pending" &&
          (row.duration_seconds !== null || row.duration_source !== null)) ||
        (row.duration_status === "ready" &&
          (!Number.isFinite(Number(row.duration_seconds)) ||
            Number(row.duration_seconds) <= 0 ||
            typeof row.duration_source !== "string"))
      ) {
        fail(
          "FINAL_BACKUP_STARTUP_DURATION_UNREADABLE",
          "Schema-37 duration metadata has an invalid state",
        );
      }
      counts[row.duration_status] += 1;
    }
    return Object.freeze({
      ...counts,
      sha256: createHash("sha256")
        .update(JSON.stringify(rows), "utf8")
        .digest("hex"),
      total: rows.length,
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_STARTUP_DURATION_UNREADABLE",
      "Schema-37 duration metadata could not be inspected",
    );
  } finally {
    try {
      database?.close();
    } catch {
      fail(
        "FINAL_BACKUP_STARTUP_DURATION_UNREADABLE",
        "Schema-37 duration metadata reader could not be closed",
      );
    }
  }
}

async function fingerprintRestoredState(targetDirectory, databaseLogicalSha256) {
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(targetDirectory);
  } catch {
    fail(
      "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
      "Final-candidate restored state is missing",
    );
  }
  const rootParent = dirname(targetDirectory);
  let initialRootParentIdentity;
  let initialRootIdentity;
  let rootHandle;
  let rootParentHandle;
  try {
    rootParentHandle = await open(
      rootParent,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    initialRootParentIdentity = await rootParentHandle.stat({ bigint: true });
    const requestedParentIdentity = await lstat(rootParent, { bigint: true });
    assertTrustedPinnedRoot(
      initialRootParentIdentity,
      "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
      "Final-candidate restored state parent is unsafe",
    );
    if (!stablePinnedRootIdentity(
      initialRootParentIdentity,
      requestedParentIdentity,
    )) {
      fail(
        "FINAL_BACKUP_RESTORED_STATE_CHANGED",
        "Final-candidate restored state parent identity is unstable",
      );
    }
    rootHandle = await open(
      canonicalRoot,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    initialRootIdentity = await rootHandle.stat({ bigint: true });
    const requestedIdentity = await lstat(targetDirectory, { bigint: true });
    assertTrustedPinnedRoot(
      initialRootIdentity,
      "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
      "Final-candidate restored state root is unsafe",
    );
    if (!stablePinnedRootIdentity(initialRootIdentity, requestedIdentity)) {
      fail(
        "FINAL_BACKUP_RESTORED_STATE_CHANGED",
        "Final-candidate restored state root identity is unstable",
      );
    }
  } catch (error) {
    await rootHandle?.close();
    rootHandle = undefined;
    await rootParentHandle?.close();
    rootParentHandle = undefined;
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
      "Final-candidate restored state root could not be pinned safely",
    );
  }
  try {
    await finalInventoryTestCheckpoint("restored", targetDirectory);
    try {
      const checkpointRootIdentity = await rootHandle.stat({ bigint: true });
      const requestedIdentity = await lstat(targetDirectory, { bigint: true });
      const checkpointParentIdentity = await rootParentHandle.stat({ bigint: true });
      const requestedParentIdentity = await lstat(rootParent, { bigint: true });
      if (
        !stablePinnedRootIdentity(initialRootIdentity, checkpointRootIdentity) ||
        !stablePinnedRootIdentity(initialRootIdentity, requestedIdentity) ||
        !stablePinnedRootIdentity(
          initialRootParentIdentity,
          checkpointParentIdentity,
        ) ||
        !stablePinnedRootIdentity(
          initialRootParentIdentity,
          requestedParentIdentity,
        )
      ) {
        fail(
          "FINAL_BACKUP_RESTORED_STATE_CHANGED",
          "Final-candidate restored state root identity changed",
        );
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_RESTORED_STATE_CHANGED",
        "Final-candidate restored state root could not be revalidated",
      );
    }
    const records = [];
    let restoredStateBytes = 0;
    let restoredStateEntries = 1;
    let restoredStatePathBytes = 0;
  async function inspectFile(path, logicalPath) {
    let handle;
    try {
      handle = await open(
        path,
        fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
          fileConstants.O_NONBLOCK,
      );
      const before = await handle.stat();
      assertTrustedArtifactEntry(before, "file");
      let sha256;
      if (logicalPath !== "unboundry.sqlite") {
        restoredStateBytes += before.size;
        if (restoredStateBytes > maximumRestoredStateBytes) {
          fail(
            "FINAL_BACKUP_RESTORED_STATE_TOO_LARGE",
            "Final-candidate restored state exceeds its byte limit",
          );
        }
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        for (;;) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            position,
          );
          if (bytesRead === 0) break;
          hash.update(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
        if (position !== before.size) {
          fail(
            "FINAL_BACKUP_RESTORED_STATE_CHANGED",
            "Final-candidate restored payload changed while it was read",
          );
        }
        sha256 = hash.digest("hex");
      }
      const after = await handle.stat();
      const pathIdentity = await lstat(path);
      if (
        !stableArtifactIdentity(before, after) ||
        !stableArtifactIdentity(before, pathIdentity)
      ) {
        fail(
          "FINAL_BACKUP_RESTORED_STATE_CHANGED",
          "Final-candidate restored payload identity changed while it was read",
        );
      }
      records.push(logicalPath === "unboundry.sqlite"
        ? Object.freeze({
          kind: "database",
          path: logicalPath,
          mode: before.mode & 0o777,
          logicalSha256: databaseLogicalSha256,
        })
        : Object.freeze({
          kind: "file",
          path: logicalPath,
          mode: before.mode & 0o777,
          size: before.size,
          sha256,
        }));
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
        "Final-candidate restored payload could not be read safely",
      );
    } finally {
      await handle?.close();
    }
  }
  async function visit(directory, prefix = "", depth = 0) {
    let handle;
    let before;
    try {
      handle = await open(
        directory,
        fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
          fileConstants.O_NONBLOCK,
      );
      before = await handle.stat();
      assertTrustedArtifactEntry(before, "directory");
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
        "Final-candidate restored directory could not be pinned safely",
      );
    } finally {
      await handle?.close();
      handle = undefined;
    }
    const children = [];
    let directoryHandle;
    try {
      directoryHandle = await opendir(directory);
      for (;;) {
        const child = await directoryHandle.read();
        if (child === null) break;
        restoredStateEntries += 1;
        if (restoredStateEntries > maximumBuildArtifactEntries) {
          fail(
            "FINAL_BACKUP_RESTORED_STATE_TOO_LARGE",
            "Final-candidate restored state exceeds its entry limit",
          );
        }
        const logicalPath = prefix ? `${prefix}/${child.name}` : child.name;
        const logicalPathBytes = Buffer.byteLength(logicalPath, "utf8");
        restoredStatePathBytes += logicalPathBytes;
        if (
          Buffer.byteLength(child.name, "utf8") === 0 ||
          Buffer.byteLength(child.name, "utf8") >
            maximumBuildArtifactNameBytes ||
          logicalPathBytes > maximumBuildArtifactPathBytes ||
          restoredStatePathBytes > maximumBuildArtifactInventoryPathBytes ||
          depth + 1 > maximumBuildArtifactDepth
        ) {
          fail(
            "FINAL_BACKUP_RESTORED_STATE_TOO_LARGE",
            "Final-candidate restored state exceeds its path limits",
          );
        }
        children.push(Object.freeze({ logicalPath, name: child.name }));
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
        "Final-candidate restored directory could not be read safely",
      );
    } finally {
      try {
        await directoryHandle?.close();
      } catch {
        // A completed directory read may already have closed its handle.
      }
    }
    try {
      children.sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const child of children) {
        const path = resolve(directory, child.name);
        if (!containsPath(canonicalRoot, path)) {
          fail(
            "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
            "Final-candidate restored state escaped its canonical root",
          );
        }
        const details = await lstat(path);
        if (details.isDirectory() && !details.isSymbolicLink()) {
          await visit(path, child.logicalPath, depth + 1);
        } else if (details.isFile() && !details.isSymbolicLink()) {
          if (isExcludedSqliteTransient(child.logicalPath)) {
            assertTrustedArtifactEntry(details, "file");
          } else {
            await inspectFile(path, child.logicalPath);
          }
        } else {
          fail(
            "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
            "Final-candidate restored state contains a link or special entry",
          );
        }
      }
      handle = await open(
        directory,
        fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
          fileConstants.O_NONBLOCK,
      );
      const after = await handle.stat();
      const pathIdentity = await lstat(directory);
      if (
        !stableArtifactIdentity(before, after) ||
        !stableArtifactIdentity(before, pathIdentity)
      ) {
        fail(
          "FINAL_BACKUP_RESTORED_STATE_CHANGED",
          "Final-candidate restored directory changed while it was read",
        );
      }
      records.push(Object.freeze({
        kind: "directory",
        path: prefix,
        mode: before.mode & 0o777,
      }));
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail(
        "FINAL_BACKUP_RESTORED_STATE_UNSAFE",
        "Final-candidate restored state could not be inventoried safely",
      );
    } finally {
      await handle?.close();
    }
  }
  await visit(canonicalRoot);
  let canonicalRootAfter;
  try {
    canonicalRootAfter = await realpath(targetDirectory);
  } catch {
    fail(
      "FINAL_BACKUP_RESTORED_STATE_CHANGED",
      "Final-candidate restored state root changed while it was read",
    );
  }
  if (canonicalRootAfter !== canonicalRoot) {
    fail(
      "FINAL_BACKUP_RESTORED_STATE_CHANGED",
      "Final-candidate restored state root changed while it was read",
    );
  }
  try {
    const finalRootIdentity = await rootHandle.stat({ bigint: true });
    const requestedIdentity = await lstat(targetDirectory, { bigint: true });
    const finalParentIdentity = await rootParentHandle.stat({ bigint: true });
    const requestedParentIdentity = await lstat(rootParent, { bigint: true });
    if (
      !stablePinnedRootIdentity(initialRootIdentity, finalRootIdentity) ||
      !stablePinnedRootIdentity(initialRootIdentity, requestedIdentity) ||
      !stablePinnedRootIdentity(initialRootParentIdentity, finalParentIdentity) ||
      !stablePinnedRootIdentity(
        initialRootParentIdentity,
        requestedParentIdentity,
      )
    ) {
      fail(
        "FINAL_BACKUP_RESTORED_STATE_CHANGED",
        "Final-candidate restored state root identity changed",
      );
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_RESTORED_STATE_CHANGED",
      "Final-candidate restored state root could not be revalidated",
    );
  }
    records.sort(compareArtifactPath);
    const identity = JSON.stringify(records);
    const nonDatabaseIdentity = JSON.stringify(records.map((record) =>
      record.kind === "database"
        ? Object.freeze({
            ...record,
            logicalSha256: "legacy-schema37-metadata-mutable",
          })
        : record));
    return Object.freeze({
      identity,
      nonDatabaseIdentity,
      summary: Object.freeze({
        restoredStateBytes,
        restoredStateEntries: records.length,
        restoredStateSha256: createHash("sha256").update(identity).digest("hex"),
      }),
    });
  } finally {
    await rootHandle?.close();
    await rootParentHandle?.close();
  }
}

async function runtimeBytes(origin, path, maximumBytes, headers = {}) {
  const target = new URL(path, origin);
  if (
    target.protocol !== "http:" || target.hostname !== "127.0.0.1" ||
    !/^[1-9][0-9]{0,4}$/.test(target.port) || Number(target.port) > 65_535
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_RESPONSE_INVALID",
      "Final-candidate runtime probe target is invalid",
    );
  }
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      action(value);
    };
    const request = httpRequest({
      agent: false,
      headers,
      host: "127.0.0.1",
      method: "GET",
      path: `${target.pathname}${target.search}`,
      port: Number(target.port),
    });
    request.setTimeout(2_000, () => {
      const timeout = new Error("runtime probe timed out");
      timeout.code = "ETIMEDOUT";
      request.destroy(timeout);
    });
    request.once("error", (error) => finish(rejectPromise, error));
    request.once("response", (response) => {
      const chunks = [];
      let bytes = 0;
      response.once("error", (error) => finish(rejectPromise, error));
      response.on("data", (chunk) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maximumBytes) {
          response.destroy();
          finish(
            rejectPromise,
            new CliError(
              "FINAL_BACKUP_STARTUP_RESPONSE_INVALID",
              "Final-candidate runtime returned an oversized response",
            ),
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.once("end", () => finish(resolvePromise, {
        status: response.statusCode ?? 0,
        value: Buffer.concat(chunks, bytes),
      }));
    });
    request.end();
  });
}

function optionalTrustedRuntimeDatabaseFile(path) {
  let details;
  try {
    details = lstatSync(path);
  } catch (error) {
    if (
      error instanceof Error && "code" in error && error.code === "ENOENT"
    ) return undefined;
    fail(
      "FINAL_BACKUP_STARTUP_DATABASE_SIDECAR_UNSAFE",
      "Release runtime SQLite sidecar could not be inspected safely",
    );
  }
  if (
    !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
    typeof process.getuid !== "function" || details.uid !== process.getuid() ||
    (details.mode & 0o022) !== 0
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_DATABASE_SIDECAR_UNSAFE",
      "Release runtime SQLite sidecar is unsafe",
    );
  }
  return details;
}

function runtimeDatabaseSidecars(databasePath) {
  const journal = optionalTrustedRuntimeDatabaseFile(`${databasePath}-journal`);
  const shm = optionalTrustedRuntimeDatabaseFile(`${databasePath}-shm`);
  const wal = optionalTrustedRuntimeDatabaseFile(`${databasePath}-wal`);
  if (journal || Boolean(shm) !== Boolean(wal)) {
    fail(
      "FINAL_BACKUP_STARTUP_DATABASE_SIDECAR_UNSAFE",
      "Release runtime SQLite sidecars are incomplete or unsafe",
    );
  }
  return Object.freeze({ journal, shm, wal });
}

function sameRuntimeDatabaseFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.nlink === right.nlink;
}

function assertSameRuntimeDatabaseFile(path, expected, message) {
  const actual = optionalTrustedRuntimeDatabaseFile(path);
  if (!actual || !sameRuntimeDatabaseFileIdentity(actual, expected)) {
    fail("FINAL_BACKUP_STARTUP_RESTORED_STATE_CHANGED", message);
  }
}

function assertRuntimeDatabaseRoot(targetDirectory, expected) {
  let actual;
  try {
    actual = lstatSync(targetDirectory);
  } catch {
    fail(
      "FINAL_BACKUP_STARTUP_RESTORED_STATE_CHANGED",
      "Release runtime restored root is unavailable",
    );
  }
  if (
    !actual.isDirectory() || actual.isSymbolicLink() ||
    typeof process.getuid !== "function" || actual.uid !== process.getuid() ||
    actual.nlink < 1 || (actual.mode & 0o077) !== 0 ||
    actual.dev !== expected.dev || actual.ino !== expected.ino ||
    actual.uid !== expected.uid || actual.mode !== expected.mode ||
    realpathSync(targetDirectory) !== targetDirectory
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_RESTORED_STATE_CHANGED",
      "Release runtime restored root identity changed",
    );
  }
}

function inspectExitedRuntimeDatabase(
  databasePath,
  targetDirectory,
  { admitCommittedWal },
) {
  if (!admitCommittedWal) {
    return inspectBackupDatabase(databasePath, targetDirectory);
  }
  const rootBefore = lstatSync(targetDirectory);
  assertRuntimeDatabaseRoot(targetDirectory, rootBefore);
  const databaseBefore = optionalTrustedRuntimeDatabaseFile(databasePath);
  if (
    !databaseBefore || realpathSync(databasePath) !== databasePath ||
    dirname(databasePath) !== targetDirectory
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
      "Release runtime database path is unsafe",
    );
  }
  const sidecarsBefore = runtimeDatabaseSidecars(databasePath);
  if (!sidecarsBefore.wal) {
    return inspectBackupDatabase(databasePath, targetDirectory);
  }

  let database;
  let inspection;
  let operationError;
  let cleanupError;
  try {
    database = new DatabaseSync(databasePath, { timeout: 5_000 });
    database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    assertRuntimeDatabaseRoot(targetDirectory, rootBefore);
    assertSameRuntimeDatabaseFile(
      databasePath,
      databaseBefore,
      "Release runtime database identity changed before locked inspection",
    );
    assertSameRuntimeDatabaseFile(
      `${databasePath}-wal`,
      sidecarsBefore.wal,
      "Release runtime WAL identity changed before locked inspection",
    );
    assertSameRuntimeDatabaseFile(
      `${databasePath}-shm`,
      sidecarsBefore.shm,
      "Release runtime SHM identity changed before locked inspection",
    );
    inspection = inspectLockedBackupDatabase(database, targetDirectory);
    assertSameRuntimeDatabaseFile(
      databasePath,
      databaseBefore,
      "Release runtime database identity changed during locked inspection",
    );
    assertSameRuntimeDatabaseFile(
      `${databasePath}-wal`,
      sidecarsBefore.wal,
      "Release runtime WAL identity changed during locked inspection",
    );
    assertSameRuntimeDatabaseFile(
      `${databasePath}-shm`,
      sidecarsBefore.shm,
      "Release runtime SHM identity changed during locked inspection",
    );
  } catch (error) {
    operationError = error;
  } finally {
    if (database?.isTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      database?.close();
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (cleanupError) {
    fail(
      "FINAL_BACKUP_STARTUP_DATABASE_CLOSE_UNKNOWN",
      "Release runtime database inspection did not close safely",
    );
  }
  if (operationError) {
    if (operationError instanceof CliError) throw operationError;
    if (operationError instanceof BackupInspectionError) {
      fail(
        "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
        "Release runtime database failed its locked inspection",
      );
    }
    fail(
      "FINAL_BACKUP_STARTUP_DATABASE_LOCK_UNAVAILABLE",
      "Release runtime database could not be locked after process exit",
    );
  }
  if (!inspection) {
    fail(
      "FINAL_BACKUP_STARTUP_RESTORED_STATE_UNSAFE",
      "Release runtime database inspection produced no result",
    );
  }
  assertRuntimeDatabaseRoot(targetDirectory, rootBefore);
  assertSameRuntimeDatabaseFile(
    databasePath,
    databaseBefore,
    "Release runtime database identity changed after locked inspection",
  );
  const sidecarsAfter = runtimeDatabaseSidecars(databasePath);
  if (sidecarsAfter.wal && (
    !sameRuntimeDatabaseFileIdentity(sidecarsAfter.wal, sidecarsBefore.wal) ||
    !sameRuntimeDatabaseFileIdentity(sidecarsAfter.shm, sidecarsBefore.shm)
  )) {
    fail(
      "FINAL_BACKUP_STARTUP_RESTORED_STATE_CHANGED",
      "Release runtime SQLite sidecar identity changed during inspection",
    );
  }
  return inspection;
}

async function validateReleaseStartup({
  expected,
  release,
  scratchRoot,
  targetDirectory,
}) {
  const restoredInspectionBefore = inspectExitedRuntimeDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
    { admitCommittedWal: true },
  );
  const restoredStateBefore = await fingerprintRestoredState(
    targetDirectory,
    restoredInspectionBefore.logicalSha256,
  );
  const schema37InvariantBefore = expected.schemaVersion === 37
    ? schema37InvariantFingerprint(targetDirectory)
    : undefined;
  const schema37DurationBefore = expected.schemaVersion === 37
    ? schema37DurationState(targetDirectory)
    : undefined;
  const buildArtifactBefore = await inventoryProductionBuild(release.directory);
  const staticContract = expected.schemaVersion === 37
    ? release.manifest.runtime.health.legacySchema37StaticAsset
    : release.manifest.runtime.health.staticAsset;
  if (!staticContract) {
    fail(
      "FINAL_BACKUP_STARTUP_BUILD_MISMATCH",
      "Release runtime did not admit the required schema static asset",
    );
  }
  const expectedIndexBytes = await readFile(
    resolve(release.directory, staticContract.path),
  );
  if (
    expectedIndexBytes.length !== staticContract.size ||
    createHash("sha256").update(expectedIndexBytes).digest("hex") !==
      staticContract.sha256
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_BUILD_MISMATCH",
      "Release runtime static asset changed after admission",
    );
  }
  const port = await allocateStartupPort();
  const runtimeRequestHeaders = expected.schemaVersion === 37
    ? Object.freeze({
        Host: "canvas.mymy.ltd",
        "X-Forwarded-For": "127.0.0.1",
        "X-Forwarded-Proto": "https",
      })
    : Object.freeze({});
  let startupRoot;
  let child;
  try {
    startupRoot = await mkdtemp(
      resolve(scratchRoot, `.unboundry-${release.releaseRole}-startup-`),
    );
    await chmod(startupRoot, 0o700);
    const runtimeRoots = Object.freeze({
      cache: resolve(startupRoot, "cache"),
      home: resolve(startupRoot, "home"),
      runtime: resolve(startupRoot, "runtime"),
      temporary: resolve(startupRoot, "temporary"),
    });
    for (const directory of Object.values(runtimeRoots)) {
      await mkdir(directory, { mode: 0o700 });
      await chmod(directory, 0o700);
    }
    const auditPath = resolve(startupRoot, "network-audit.jsonl");
    await writeFile(auditPath, "", { flag: "wx", mode: 0o600 });
    await chmod(auditPath, 0o600);
    const outputState = {
      bytes: 0,
      diagnosticTail: "",
      exceeded: false,
      startFailed: false,
    };
    let primaryError;
    let readiness;
    let version;
    let authStatus;
    let applicationData;
    try {
      const runtime = runtimeEnvironment(
        release,
        targetDirectory,
        runtimeRoots,
        port,
        auditPath,
        { nativeOnly: expected.schemaVersion === 37 },
      );
      const runtimeArguments = release.manifest.runtime.arguments.map((argument) =>
        argument === "${UNBOUNDRY_PORT}" ? String(port) : argument);
      const runtimeSandbox = await createRuntimeNativeSandbox(
        startupRoot,
        runtime.instrumented,
      );
      child = spawn(
        runtimeSandbox?.executable ?? release.runtimeCommand,
        runtimeSandbox
          ? [...runtimeSandbox.arguments, release.runtimeCommand, ...runtimeArguments]
          : runtimeArguments,
        {
          cwd: release.directory,
          env: runtime.environment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.once("error", () => {
        outputState.startFailed = true;
      });
      const collect = (chunk) => {
        outputState.bytes += chunk.length;
        outputState.diagnosticTail = `${outputState.diagnosticTail}${chunk}`
          .slice(-8_192);
        if (outputState.bytes <= maximumStartupOutputBytes) return;
        outputState.exceeded = true;
        if (!childExited(child)) child.kill("SIGKILL");
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const origin = `http://127.0.0.1:${port}`;
      readiness = await waitForRuntimeReadiness(
        child,
        origin,
        outputState,
        expected,
        runtimeRequestHeaders,
      );
      const versionResponse = await runtimeJson(
        origin,
        release.manifest.runtime.health.versionPath,
        runtimeRequestHeaders,
      );
      if (
        versionResponse.status !== 200 ||
        versionResponse.body?.version !== release.version
      ) {
        fail(
          "FINAL_BACKUP_STARTUP_VERSION_MISMATCH",
          "Release runtime version does not match its admitted manifest",
        );
      }
      version = release.version;
      const indexResponse = await runtimeBytes(
        origin,
        "/",
        expectedIndexBytes.length,
        runtimeRequestHeaders,
      );
      if (
        indexResponse.status !== 200 ||
        !indexResponse.value.equals(expectedIndexBytes) ||
        createHash("sha256").update(indexResponse.value).digest("hex") !==
          staticContract.sha256
      ) {
        const actualSha256 = createHash("sha256")
          .update(indexResponse.value).digest("hex");
        let responseCode = null;
        try {
          const document = JSON.parse(indexResponse.value.toString("utf8"));
          if (
            document && typeof document === "object" &&
            typeof document.code === "string" &&
            /^[A-Z0-9_]{1,128}$/.test(document.code)
          ) responseCode = document.code;
        } catch {
          // The body itself is not diagnostic evidence and is never emitted.
        }
        fail(
          "FINAL_BACKUP_STARTUP_BUILD_MISMATCH",
          `Final-candidate production preview did not serve its fixed index (${JSON.stringify({
            actualSha256,
            actualSize: indexResponse.value.length,
            expectedSha256: staticContract.sha256,
            expectedSize: staticContract.size,
            releaseRole: release.releaseRole,
            responseCode,
            schemaVersion: expected.schemaVersion,
            status: indexResponse.status,
          })})`,
        );
      }
      const fixtureApi = await runtimeBytes(
        origin,
        "/__fixture-api/shell.empty.primary",
        64 * 1024,
        { Accept: "application/json", ...runtimeRequestHeaders },
      );
      if (fixtureApi.status !== 404) {
        fail(
          "FINAL_BACKUP_STARTUP_FIXTURE_EXPOSED",
          "Final-candidate production preview exposed its development fixture API",
        );
      }
      const auth = await runtimeJson(origin, "/api/auth/status", {
        Cookie: "unboundry_session=final-startup-probe",
        ...runtimeRequestHeaders,
      });
      if (
        auth.status !== 200 || !auth.body || typeof auth.body !== "object" ||
        auth.body.authenticated !== false || auth.body.bootstrapRequired !== false
      ) {
        fail(
          "FINAL_BACKUP_STARTUP_AUTH_MISMATCH",
          "Final-candidate runtime could not read its ordinary authentication state",
        );
      }
      authStatus = Object.freeze({
        authenticated: false,
        bootstrapRequired: false,
      });
      applicationData = expected.schemaVersion === currentStartupSchemaVersion
        ? await validateRestoredApplicationData(targetDirectory)
        : Object.freeze({});
      const sustained = await runtimeJson(
        origin,
        "/api/health/ready",
        runtimeRequestHeaders,
      );
      if (sustained.status !== 200) {
        fail(
          "FINAL_BACKUP_STARTUP_READINESS_MISMATCH",
          "Final-candidate runtime lost readiness after ordinary reads",
        );
      }
      readinessSummary(sustained.body, expected);
    } catch (error) {
      primaryError = error;
    }
    const shutdown = child
      ? await stopStartupRuntime(child)
      : { exitCode: null, graceful: false, signal: null };
    await assertStartupPortReleased(port);
    const buildArtifactAfter = shutdown.graceful
      ? await inventoryProductionBuild(release.directory)
      : undefined;
    const restoredInspectionAfter = shutdown.graceful
      ? inspectExitedRuntimeDatabase(
        resolve(targetDirectory, "unboundry.sqlite"),
        targetDirectory,
        { admitCommittedWal: true },
      )
      : undefined;
    const restoredStateAfter = shutdown.graceful
      ? await fingerprintRestoredState(
        targetDirectory,
        restoredInspectionAfter.logicalSha256,
      )
      : undefined;
    const restoredInspectionRevalidated = shutdown.graceful
      ? inspectExitedRuntimeDatabase(
        resolve(targetDirectory, "unboundry.sqlite"),
        targetDirectory,
        { admitCommittedWal: true },
      )
      : undefined;
    const schema37InvariantAfter = shutdown.graceful &&
        expected.schemaVersion === 37
      ? schema37InvariantFingerprint(targetDirectory)
      : undefined;
    const schema37DurationAfter = shutdown.graceful &&
        expected.schemaVersion === 37
      ? schema37DurationState(targetDirectory)
      : undefined;
    const networkAudit = await inspectStartupNetworkAudit(
      auditPath,
      port,
      child?.pid,
      {
        auxiliaryPort: Number(process.env.UNBOUNDRY_TEST_PORT),
        instrumented: process.env.UNBOUNDRY_SAFE_TEST === "1" &&
          expected.schemaVersion !== 37,
      },
    );
    if (!shutdown.graceful) {
      const markers = [
        ...startupShutdownDiagnosticMarkers.filter((marker) =>
          outputState.diagnosticTail.includes(marker)),
        ...new Set(outputState.diagnosticTail.match(
          /\b(?:BRIDGE|DATABASE|LEGACY|RUNTIME|SERVICE)_[A-Z0-9_]+\b/g,
        ) ?? []),
        ...(outputState.diagnosticTail.includes("sandbox-exec:")
          ? ["NATIVE_SANDBOX_ERROR"]
          : []),
        ...(outputState.diagnosticTail.includes("Operation not permitted")
          ? ["NATIVE_OPERATION_NOT_PERMITTED"]
          : []),
      ].sort();
      const diagnosticCategories = startupShutdownDiagnosticCategories
        .filter(({ marker }) => outputState.diagnosticTail.includes(marker))
        .map(({ category }) => category);
      const legacySupervisorStackLines = allowlistedLegacySupervisorStackLines(
        outputState.diagnosticTail,
      );
      const legacyDatabaseChanges = allowlistedLegacyDatabaseChanges(
        outputState.diagnosticTail,
      );
      fail(
        "FINAL_BACKUP_STARTUP_SHUTDOWN_FAILED",
        `Final-candidate runtime did not shut down cleanly within its deadline (${JSON.stringify({
          elapsedMilliseconds: shutdown.elapsedMilliseconds,
          exitCode: shutdown.exitCode,
          forced: shutdown.forced,
          markers,
          diagnosticCategories,
          legacyDatabaseChanges,
          legacySupervisorStackLines,
          primaryErrorCode: primaryError instanceof CliError
            ? primaryError.code
            : primaryError
              ? "FINAL_BACKUP_UNCLASSIFIED_PRIMARY_ERROR"
              : null,
          releaseRole: release.releaseRole,
          schemaVersion: expected.schemaVersion,
          signal: shutdown.signal,
          termSent: shutdown.termSent,
        })})`,
      );
    }
    if (buildArtifactAfter.identity !== buildArtifactBefore.identity) {
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
        "Final-candidate production build changed during preview validation",
      );
    }
    const restoredStateChanged = expected.schemaVersion === 37
      ? restoredInspectionAfter.userVersion !== 37 ||
        restoredInspectionRevalidated.userVersion !== 37 ||
        restoredInspectionRevalidated.logicalSha256 !==
          restoredInspectionAfter.logicalSha256 ||
        restoredStateAfter.nonDatabaseIdentity !==
          restoredStateBefore.nonDatabaseIdentity ||
        schema37InvariantAfter !== schema37InvariantBefore
      : restoredInspectionRevalidated.userVersion !== expected.schemaVersion ||
        restoredInspectionRevalidated.logicalSha256 !==
          restoredInspectionAfter.logicalSha256 ||
        restoredStateAfter.identity !== restoredStateBefore.identity;
    if (restoredStateChanged) {
      fail(
        "FINAL_BACKUP_STARTUP_RESTORED_STATE_CHANGED",
        expected.schemaVersion === 37
          ? "Bridge schema-37 preview changed state outside its bounded media metadata backfill"
          : "Final-candidate production preview changed its restored state",
      );
    }
    if (primaryError) throw primaryError;
    return Object.freeze({
      ...applicationData,
      ...networkAudit,
      authStatus,
      ...buildArtifactBefore.summary,
      ...restoredStateBefore.summary,
      listenerReleased: true,
      listenerPort: port,
      ...(expected.schemaVersion === 37
        ? {
            legacyMetadataBackfill: Object.freeze({
              durationAfter: schema37DurationAfter,
              durationBefore: schema37DurationBefore,
              invariantSha256: schema37InvariantAfter,
              logicalSha256After: restoredInspectionAfter.logicalSha256,
              logicalSha256Before: restoredInspectionBefore.logicalSha256,
              metadataChanged:
                restoredInspectionAfter.logicalSha256 !==
                restoredInspectionBefore.logicalSha256,
            }),
          }
        : {}),
      readiness,
      releaseId: release.releaseId,
      releaseRole: release.releaseRole,
      servedStaticAssetSha256: staticContract.sha256,
      shutdown: "graceful",
      version,
    });
  } finally {
    if (child && !childExited(child)) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 2_000);
    }
    if (startupRoot) {
      await rm(startupRoot, { force: true, recursive: true });
    }
  }
}

function sameSummary(left, right) {
  return left?.backupId === right?.backupId &&
    left?.databaseLogicalSha256 === right?.databaseLogicalSha256 &&
    left?.schemaVersion === right?.schemaVersion &&
    left?.mediaFiles === right?.mediaFiles &&
    left?.ossMirrors === right?.ossMirrors &&
    left?.secretFiles === right?.secretFiles &&
    JSON.stringify(left?.mediaIntegrity) === JSON.stringify(right?.mediaIntegrity);
}

let pathArguments = [];
try {
  const parsed = parseArguments(process.argv.slice(2));
  const pathOptions = [
    "--backup-root",
    "--bridge-release-manifest",
    "--data-dir",
    "--fake-oss-target-dir",
    "--final-release-manifest",
    "--recovery-private-key",
    "--recovery-public-key",
    "--signing-private-key",
    "--target-data-dir",
    "--trusted-signing-public-key",
    ...(parsed.values.has("--scratch-root") ? ["--scratch-root"] : []),
  ];
  for (const option of pathOptions) {
    parsed.values.set(option, normalizedAbsolutePath(parsed.values.get(option)));
  }
  const mirrorPaths = parsed.mirrors.map((mirror) => mirror.filePath);
  pathArguments = [
    ...pathOptions.map((option) => parsed.values.get(option)),
    ...mirrorPaths,
  ];
  const sourceDirectory = parsed.values.get("--data-dir");
  const targetDirectory = parsed.values.get("--target-data-dir");
  const backupRoot = parsed.values.get("--backup-root");
  const fakeOssTargetDirectory = parsed.values.get("--fake-oss-target-dir");
  const scratchRoot = parsed.values.has("--scratch-root")
    ? parsed.values.get("--scratch-root")
    : resolve(tmpdir());
  const dataPaths = [
    sourceDirectory,
    targetDirectory,
    backupRoot,
    fakeOssTargetDirectory,
    scratchRoot,
  ];
  const releaseManifestByRole = Object.freeze({
    bridge: parsed.values.get("--bridge-release-manifest"),
    final: parsed.values.get("--final-release-manifest"),
  });
  const releaseManifestPaths = Object.values(releaseManifestByRole);
  const canonicalDataPaths = await Promise.all(
    dataPaths.map((path) => canonicalPotentialPath(path)),
  );
  if (pathsOverlap(dataPaths) || pathsOverlap(canonicalDataPaths)) {
    fail("FINAL_BACKUP_ARGUMENT_INVALID", "Final-candidate data paths overlap");
  }
  const keyPaths = [
    parsed.values.get("--recovery-private-key"),
    parsed.values.get("--recovery-public-key"),
    parsed.values.get("--signing-private-key"),
    parsed.values.get("--trusted-signing-public-key"),
  ];
  let canonicalKeyPaths;
  try {
    canonicalKeyPaths = await Promise.all(keyPaths.map((path) => realpath(path)));
  } catch {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "Final-candidate key paths must resolve before capture",
    );
  }
  let canonicalMirrorPaths;
  try {
    canonicalMirrorPaths = await Promise.all(
      mirrorPaths.map((path) => realpath(path)),
    );
  } catch {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "Final-candidate OSS mirror paths must resolve before capture",
    );
  }
  if (
    pathsOverlap([
      ...dataPaths,
      ...releaseManifestPaths,
      ...keyPaths,
      ...mirrorPaths,
    ]) ||
    pathsOverlap([
      ...canonicalDataPaths,
      ...await Promise.all(releaseManifestPaths.map((path) => realpath(path))),
      ...canonicalKeyPaths,
      ...canonicalMirrorPaths,
    ])
  ) {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "Final-candidate keys and OSS mirrors must be mutually disjoint and outside all data and work directories",
    );
  }
  const runnerReleaseAttestation = await readRunnerReleaseAttestation(
    releaseManifestByRole,
  );
  const releases = Object.freeze({
    bridge: await admitRelease(
      releaseManifestByRole.bridge,
      "bridge",
      runnerReleaseAttestation,
    ),
    final: await admitRelease(
      releaseManifestByRole.final,
      "final",
      runnerReleaseAttestation,
    ),
  });
  const admittedReleaseEvidence = Object.freeze({
    bridge: releaseEvidence(releases.bridge),
    final: releaseEvidence(releases.final),
  });
  const admittedReleaseRelationship = runnerReleaseAttestation?.relationship ?? null;
  if (runnerReleaseAttestation) {
    try {
      assertAttestedReleaseArtifacts(runnerReleaseAttestation, releases);
    } catch (error) {
      if (!(error instanceof ReleaseAttestationError)) throw error;
      fail(
        "FINAL_BACKUP_RELEASE_ATTESTATION_INVALID",
        "Runner source-pair attestation does not match the admitted releases",
      );
    }
  }
  if (
    admittedReleaseEvidence.bridge.commit === admittedReleaseEvidence.final.commit ||
    admittedReleaseEvidence.bridge.sourceTree ===
      admittedReleaseEvidence.final.sourceTree ||
    admittedReleaseEvidence.bridge.manifestSha256 ===
      admittedReleaseEvidence.final.manifestSha256
  ) {
    fail(
      "FINAL_BACKUP_RELEASE_MANIFEST_INVALID",
      "Bridge and final must be distinct immutable release identities",
    );
  }

  const report = await runJsonScript(
    "report-media-integrity.mjs",
    childArguments(parsed, "report"),
  );
  const backup = await runJsonScript(
    "backup-data.mjs",
    childArguments(parsed, "backup"),
  );
  const expectedSha = parsed.values.get("--expected-database-logical-sha256");
  if (
    report?.schemaVersion !== 37 ||
    report?.databaseLogicalSha256 !== expectedSha ||
    report?.captureMode !== "locked-exact" ||
    report?.finalCandidate !== false ||
    backup?.schemaVersion !== 37 ||
    backup?.databaseLogicalSha256 !== expectedSha ||
    backup?.captureMode !== "locked-exact" ||
    backup?.finalCandidate !== false ||
    report?.sha256 !== backup?.mediaIntegrity?.sha256 ||
    report?.evidenceSha256 !== backup?.mediaIntegrity?.evidenceSha256
  ) {
    fail(
      "FINAL_BACKUP_SOURCE_CHANGED",
      "Historical report and encrypted backup do not bind the same exact v37 source",
    );
  }

  const scratch = parsed.values.has("--scratch-root")
    ? ["--scratch-root", parsed.values.get("--scratch-root")]
    : [];
  const verifyArguments = [
    "--backup-dir",
    backup.packageDirectory,
    "--recovery-private-key",
    parsed.values.get("--recovery-private-key"),
    "--trusted-signing-public-key",
    parsed.values.get("--trusted-signing-public-key"),
    ...scratch,
  ];
  const verified = await runJsonScript("verify-backup.mjs", verifyArguments);
  if (
    !sameSummary(backup, verified) ||
    verified?.captureMode !== "locked-exact" ||
    verified?.finalCandidate !== false
  ) {
    fail(
      "FINAL_BACKUP_VERIFY_MISMATCH",
      "Verified package summary differs from the historical exact-v37 backup",
    );
  }
  const restored = await runJsonScript("restore-backup.mjs", [
    ...verifyArguments,
    "--target-data-dir",
    targetDirectory,
  ]);
  if (
    !sameSummary(backup, restored) ||
    restored?.captureMode !== "locked-exact" ||
    restored?.finalCandidate !== false
  ) {
    fail(
      "FINAL_BACKUP_RESTORE_MISMATCH",
      "Restored package summary differs from the verified historical exact-v37 backup",
    );
  }
  const restoredSecretValidation = await validateBackupSecrets(
    resolve(targetDirectory, "unboundry.sqlite"),
    resolve(targetDirectory, "secrets"),
    targetDirectory,
  );
  const fakeOssRecovery = await rehydrateFakeOssFromIndexFile({
    indexPath: resolve(targetDirectory, ossRecoveryIndexFileName),
    sourceDirectory: targetDirectory,
    targetDirectory: fakeOssTargetDirectory,
  });
  if (
    backup.ossMirrors < 1 ||
    fakeOssRecovery.backupId !== backup.backupId ||
    fakeOssRecovery.databaseLogicalSha256 !== expectedSha ||
    fakeOssRecovery.objects.length < 1 ||
    fakeOssRecovery.objects.length !== backup.ossMirrors
  ) {
    fail(
      "FINAL_BACKUP_FAKE_OSS_MISMATCH",
      "Fake OSS recovery does not match the exact-v37 restored package",
    );
  }
  await revalidateRelease(releases.bridge, "bridge", runnerReleaseAttestation);
  const bridgeSchema37 = await validateReleaseStartup({
    expected: Object.freeze({
      mode: "schema37-bridge-active",
      mutationsAccepted: true,
      schemaVersion: 37,
    }),
    release: releases.bridge,
    scratchRoot,
    targetDirectory,
  });
  const postBridge37LogicalSha256 =
    bridgeSchema37.legacyMetadataBackfill?.logicalSha256After;
  const bridgeDurationBefore =
    bridgeSchema37.legacyMetadataBackfill?.durationBefore;
  const bridgeDurationAfter =
    bridgeSchema37.legacyMetadataBackfill?.durationAfter;
  if (
    typeof postBridge37LogicalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(postBridge37LogicalSha256) ||
    bridgeDurationBefore?.total !== 1 ||
    bridgeDurationBefore?.pending !== 1 ||
    bridgeDurationBefore?.ready !== 0 ||
    bridgeDurationBefore?.failed !== 0 ||
    bridgeDurationAfter?.total !== 1 ||
    bridgeDurationAfter?.pending !== 1 ||
    bridgeDurationAfter?.ready !== 0 ||
    bridgeDurationAfter?.failed !== 0 ||
    bridgeDurationAfter?.sha256 !== bridgeDurationBefore?.sha256
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_TARGET_CHANGED",
      "Bridge schema-37 validation did not preserve one pending duration for explicit migration",
    );
  }
  await revalidateRelease(releases.bridge, "bridge", runnerReleaseAttestation);
  const linuxValidationSandbox = await inheritedLinuxValidationSandbox(
    "FINAL_BACKUP_MIGRATION_NATIVE_SANDBOX_UNAVAILABLE",
  );
  const durationProbeFixture = linuxValidationSandbox
    ? undefined
    : await createSafeDurationProbeFixture(scratchRoot);
  let migrationRuntimeDirectory;
  let migrationNativeAudit;
  let migrationDryRun;
  let migrationApplied;
  let migrationFinalApplied;
  const migrationStages = [];
  try {
    migrationRuntimeDirectory = await mkdtemp(resolve(
      scratchRoot,
      ".unboundry-final-migration-runtime-",
    ));
    await chmod(migrationRuntimeDirectory, 0o700);
    const migrationNativeSandbox = await createMigrationNativeSandbox(
      durationProbeFixture?.directory ?? migrationRuntimeDirectory,
    );
    const migrationChildOptions = linuxValidationSandbox
      ? {
          env: productionMigrationEnvironment(
            releases.bridge,
            migrationRuntimeDirectory,
          ),
          wrapper: migrationNativeSandbox.wrapper,
        }
      : { wrapper: migrationNativeSandbox.wrapper };
    const stageDefinitions = Object.freeze([
      Object.freeze({
        scriptName: "migrate-schema37-to39.mjs",
        sourceVersion: 37,
        targetVersion: 39,
      }),
      Object.freeze({
        scriptName: "migrate-schema39-to40.mjs",
        sourceVersion: 39,
        targetVersion: 40,
      }),
      Object.freeze({
        scriptName: "migrate-schema40-to41.mjs",
        sourceVersion: 40,
        targetVersion: 41,
      }),
      Object.freeze({
        scriptName: "migrate-schema41-to42.mjs",
        sourceVersion: 41,
        targetVersion: 42,
      }),
      Object.freeze({
        scriptName: "migrate-schema42-to43.mjs",
        sourceVersion: 42,
        targetVersion: 43,
      }),
    ]);
    let expectedStageSourceSha256 = postBridge37LogicalSha256;
    for (const [stageIndex, definition] of stageDefinitions.entries()) {
      const stageArguments = [
        "--data-dir",
        targetDirectory,
        "--expected-logical-sha256",
        expectedStageSourceSha256,
        "--runtime-dir",
        migrationRuntimeDirectory,
        ...scratch,
        ...(stageIndex === 0 && durationProbeFixture
          ? [
              "--test-duration-probe-audit",
              durationProbeFixture.auditPath,
              "--test-duration-probe-executable",
              durationProbeFixture.executable,
            ]
          : []),
      ];
      const dryRun = await runReleaseMigrationScript(
        releases.bridge,
        definition.scriptName,
        "dry-run",
        stageArguments,
        migrationChildOptions,
      );
      const dryRunSourceSha256 = dryRun?.expectedSourceLogicalSha256 ??
        dryRun?.sourceLogicalSha256;
      if (
        dryRun?.ok !== true ||
        dryRun?.mode !== "dry-run" ||
        dryRun?.status !== (stageIndex === 0 ? "ready" : "verified") ||
        dryRun?.sourceVersion !== definition.sourceVersion ||
        dryRun?.targetVersion !== definition.targetVersion ||
        dryRunSourceSha256 !== expectedStageSourceSha256 ||
        (stageIndex === 0 && (
          dryRun?.nativeDurationProbes !== 0 ||
          linuxValidationSandbox && dryRun?.drainMilliseconds !== 60_000
        ))
      ) {
        fail(
          "FINAL_BACKUP_MIGRATION_DRY_RUN_MISMATCH",
          `Release migration ${definition.sourceVersion} to ` +
            `${definition.targetVersion} dry-run did not match its source contract`,
        );
      }
      const applied = await runReleaseMigrationScript(
        releases.bridge,
        definition.scriptName,
        "apply",
        stageArguments,
        migrationChildOptions,
      );
      const appliedSourceSha256 = applied?.expectedSourceLogicalSha256 ??
        applied?.sourceLogicalSha256;
      if (
        applied?.ok !== true ||
        applied?.mode !== "apply" ||
        applied?.status !== "complete" ||
        applied?.sourceVersion !== definition.sourceVersion ||
        applied?.targetVersion !== definition.targetVersion ||
        appliedSourceSha256 !== expectedStageSourceSha256 ||
        !/^[a-f0-9]{64}$/.test(String(applied?.targetLogicalSha256 ?? ""))
      ) {
        fail(
          "FINAL_BACKUP_MIGRATION_APPLY_MISMATCH",
          `Release migration ${definition.sourceVersion} to ` +
            `${definition.targetVersion} did not match its source contract`,
        );
      }
      if (stageIndex === 0) {
        migrationDryRun = dryRun;
        migrationApplied = applied;
      }
      migrationFinalApplied = applied;
      migrationStages.push(Object.freeze({
        applied,
        dryRun,
        scriptName: definition.scriptName,
        sourceLogicalSha256: expectedStageSourceSha256,
        sourceVersion: definition.sourceVersion,
        targetLogicalSha256: applied.targetLogicalSha256,
        targetVersion: definition.targetVersion,
      }));
      expectedStageSourceSha256 = applied.targetLogicalSha256;
    }
    migrationNativeAudit = linuxValidationSandbox
      ? verifyProductionDurationProbeEvidence(
          migrationApplied,
          migrationNativeSandbox.evidence,
          releases.bridge,
        )
      : await verifySafeDurationProbeAudit(
          durationProbeFixture.auditPath,
          migrationApplied,
          migrationNativeSandbox.evidence,
        );
  } finally {
    await Promise.all([
      ...(durationProbeFixture
        ? [rm(durationProbeFixture.directory, { force: true, recursive: true })]
        : []),
      ...(migrationRuntimeDirectory
        ? [rm(migrationRuntimeDirectory, { force: true, recursive: true })]
        : []),
    ]);
  }
  if (
    migrationApplied?.ok !== true ||
    migrationApplied?.mode !== "apply" ||
    migrationApplied?.status !== "complete" ||
    migrationApplied?.sourceVersion !== 37 ||
    migrationApplied?.targetVersion !== 39 ||
    migrationApplied?.expectedSourceLogicalSha256 !== postBridge37LogicalSha256 ||
    migrationApplied?.backfilledDurations !== 1 ||
    linuxValidationSandbox && migrationApplied?.drainMilliseconds !== 60_000 ||
    migrationApplied?.nativeDurationProbes !==
      migrationApplied.backfilledDurations + bridgeDurationAfter.total ||
    migrationNativeAudit?.nativeDurationProbes !==
      migrationApplied.nativeDurationProbes ||
    (linuxValidationSandbox
      ? migrationNativeAudit?.externalNetworkAttempts !== null ||
        migrationNativeAudit?.externalNetworkSuccesses !== 0 ||
        migrationNativeAudit?.realDrainClock !== true ||
        migrationNativeAudit?.testClockUsed !== false ||
        migrationNativeAudit?.testDurationProbeUsed !== false
      : migrationNativeAudit?.externalNetworkAttempts !== 0)
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_APPLY_MISMATCH",
      "Restored exact-v37 first migration stage did not match its source contract",
    );
  }
  await revalidateRelease(releases.bridge, "bridge", runnerReleaseAttestation);
  const migrationInspection = inspectExitedRuntimeDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
    { admitCommittedWal: true },
  );
  if (
    migrationInspection.userVersion !== currentStartupSchemaVersion ||
    migrationFinalApplied?.targetVersion !== currentStartupSchemaVersion ||
    typeof migrationFinalApplied?.targetLogicalSha256 !== "string" ||
    migrationFinalApplied.targetLogicalSha256 !== migrationInspection.logicalSha256
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_SCHEMA_MISMATCH",
      "Migrated restore is not exact current schema for normal startup",
    );
  }
  const bridgeSchema43 = await validateReleaseStartup({
    expected: Object.freeze({
      mode: "active",
      mutationsAccepted: true,
      schemaVersion: currentStartupSchemaVersion,
    }),
    release: releases.bridge,
    scratchRoot,
    targetDirectory,
  });
  await revalidateRelease(releases.bridge, "bridge", runnerReleaseAttestation);
  await revalidateRelease(releases.final, "final", runnerReleaseAttestation);
  const startupRuntime = await validateReleaseStartup({
    expected: Object.freeze({
      mode: "active",
      mutationsAccepted: true,
      schemaVersion: currentStartupSchemaVersion,
    }),
    release: releases.final,
    scratchRoot,
    targetDirectory,
  });
  await revalidateRelease(releases.final, "final", runnerReleaseAttestation);
  const postStartupInspection = inspectExitedRuntimeDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
    { admitCommittedWal: true },
  );
  if (
    postStartupInspection.userVersion !== currentStartupSchemaVersion ||
    postStartupInspection.logicalSha256 !== migrationInspection.logicalSha256
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_TARGET_CHANGED",
      "Normal startup changed the migrated restore logical target",
    );
  }
  await revalidateRelease(releases.bridge, "bridge", runnerReleaseAttestation);
  const bridgeRollback = await validateReleaseStartup({
    expected: Object.freeze({
      mode: "active",
      mutationsAccepted: true,
      schemaVersion: currentStartupSchemaVersion,
    }),
    release: releases.bridge,
    scratchRoot,
    targetDirectory,
  });
  await revalidateRelease(releases.bridge, "bridge", runnerReleaseAttestation);
  const postBridgeRollbackInspection = inspectExitedRuntimeDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
    { admitCommittedWal: true },
  );
  if (
    postBridgeRollbackInspection.userVersion !== currentStartupSchemaVersion ||
    postBridgeRollbackInspection.logicalSha256 !==
      migrationInspection.logicalSha256
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_TARGET_CHANGED",
      "Bridge rollback runtime changed the migrated current-schema target",
    );
  }
  await revalidateRelease(releases.final, "final", runnerReleaseAttestation);
  const finalReswitch = await validateReleaseStartup({
    expected: Object.freeze({
      mode: "active",
      mutationsAccepted: true,
      schemaVersion: currentStartupSchemaVersion,
    }),
    release: releases.final,
    scratchRoot,
    targetDirectory,
  });
  await revalidateRelease(releases.final, "final", runnerReleaseAttestation);
  const postFinalReswitchInspection = inspectExitedRuntimeDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
    { admitCommittedWal: true },
  );
  if (
    postFinalReswitchInspection.userVersion !== currentStartupSchemaVersion ||
    postFinalReswitchInspection.logicalSha256 !==
      migrationInspection.logicalSha256
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_TARGET_CHANGED",
      "Final reswitch runtime changed the migrated current-schema target",
    );
  }
  const startupValidation = Object.freeze({
    ...startupRuntime,
    bridgeRollback,
    bridgeSchema37,
    bridgeSchema43,
    finalReswitch,
    finalSchema43: startupRuntime,
    postBridge37LogicalSha256,
    runtimeSequence: Object.freeze([
      Object.freeze({ releaseRole: "bridge", schemaVersion: 37 }),
      Object.freeze({ releaseRole: "bridge", schemaVersion: currentStartupSchemaVersion }),
      Object.freeze({ releaseRole: "final", schemaVersion: currentStartupSchemaVersion }),
      Object.freeze({
        operation: "rollback",
        releaseRole: "bridge",
        schemaVersion: currentStartupSchemaVersion,
      }),
      Object.freeze({
        operation: "reswitch",
        releaseRole: "final",
        schemaVersion: currentStartupSchemaVersion,
      }),
    ]),
    targetLogicalSha256: postFinalReswitchInspection.logicalSha256,
  });
  process.stdout.write(`${JSON.stringify({
    backup,
    expectedDatabaseLogicalSha256: expectedSha,
    expectedSchemaVersion: 37,
    format: "unboundry-historical-recovery-backup",
    ...(linuxValidationSandbox
      ? {
          productionLinuxExecution: Object.freeze({
            allHostPrerequisitesActuallyExecuted: false,
            bridgeRollbackRuntimeActuallyExecuted: true,
            finalReswitchRuntimeActuallyExecuted: true,
            hostPrerequisitesActuallyExecuted: Object.freeze({
              bwrap: true,
              ffmpeg: false,
              ffprobe: true,
              node: true,
            }),
            migrationActuallyExecuted: true,
            networkNamespaceActuallyExecuted: true,
            productRuntimeActuallyExecuted: true,
            systemdActuallyExecuted: false,
            nginxActuallyExecuted: false,
          }),
        }
      : {}),
    fakeOssRecovery,
    migrationApplied,
    migrationDryRun,
    migrationFinalApplied,
    migrationInspection,
    migrationNativeAudit,
    migrationStages,
    releaseEvidence: admittedReleaseEvidence,
    releaseRelationship: admittedReleaseRelationship,
    report,
    restored,
    restoredSecretValidation,
    startupValidation,
    targetDirectory,
    verified,
    version: 1,
  })}\n`);
} catch (error) {
  const known = error instanceof CliError ||
    error instanceof FakeOssRecoveryError ||
    error instanceof BackupInspectionError;
  let message = known ? error.message : "Final-candidate backup failed";
  for (const path of pathArguments.sort((left, right) => right.length - left.length)) {
    message = message.replaceAll(path, "[path]");
  }
  process.stderr.write(`${JSON.stringify({
    ...(error instanceof CliError && error.childStage
      ? { childStage: error.childStage }
      : {}),
    code: known ? error.code : "FINAL_BACKUP_FAILED",
    message,
  })}\n`);
  process.exitCode = 1;
}
