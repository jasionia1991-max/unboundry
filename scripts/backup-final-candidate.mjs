import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fstatSync,
  read,
  writeSync,
} from "node:fs";
import {
  chmod,
  lstat,
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import "./node-typescript-runtime.mjs";

const {
  FakeOssRecoveryError,
  ossRecoveryIndexFileName,
  rehydrateFakeOssFromIndexFile,
} = await import("../server/fakeOssRecovery.ts");
const {
  BackupInspectionError,
  inspectBackupDatabase,
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
const currentStartupSchemaVersion = 39;

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new CliError(code, message);
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
    "--data-dir",
    "--expected-database-logical-sha256",
    "--fake-oss-target-dir",
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
    "--data-dir",
    "--expected-database-logical-sha256",
    "--fake-oss-target-dir",
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
  if (
    nativeSandboxEvidence?.denyNetwork !== true ||
    nativeSandboxEvidence?.selfTestDenied !== true ||
    nativeSandboxEvidence?.processTreeEnforced !== true ||
    nativeSandboxEvidence?.migrationChildren !== 2 ||
    (!inheritedSandboxEvidence && !explicitSandboxEvidence)
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_NETWORK_AUDIT_MISMATCH",
      "Migration native children did not remain behind the OS network sandbox",
    );
  }
  return Object.freeze({
    argumentContractSha256: [...argumentHashes][0],
    externalNetworkAttempts: 0,
    nativeSandbox: nativeSandboxEvidence,
    nativeDurationProbes: starts.length,
    sha256,
  });
}

async function runJsonScript(scriptName, arguments_, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const executable = options.wrapper?.executable ?? process.execPath;
    const childArguments = options.wrapper
      ? [...options.wrapper.arguments, process.execPath,
          resolve(appRoot, "scripts", scriptName), ...arguments_]
      : [resolve(appRoot, "scripts", scriptName), ...arguments_];
    const child = spawn(
      executable,
      childArguments,
      {
        cwd: appRoot,
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumChildOutputBytes) {
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", () => {
      rejectPromise(new CliError(
        "FINAL_BACKUP_CHILD_FAILED",
        "Final-candidate child process could not start",
      ));
    });
    child.once("close", (code, signal) => {
      if (outputBytes > maximumChildOutputBytes) {
        rejectPromise(new CliError(
          "FINAL_BACKUP_CHILD_OUTPUT_TOO_LARGE",
          "Final-candidate child output exceeded its limit",
        ));
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0 || signal) {
        let childError;
        try {
          childError = JSON.parse(errorOutput);
        } catch {
          childError = undefined;
        }
        rejectPromise(new CliError(
          typeof childError?.code === "string"
            ? childError.code
            : "FINAL_BACKUP_CHILD_FAILED",
          typeof childError?.message === "string"
            ? childError.message
            : typeof childError?.error === "string"
              ? childError.error
              : "Final-candidate child process failed",
        ));
        return;
      }
      try {
        resolvePromise(JSON.parse(output));
      } catch {
        rejectPromise(new CliError(
          "FINAL_BACKUP_CHILD_OUTPUT_INVALID",
          "Final-candidate child output is invalid",
        ));
      }
    });
  });
}

const migrationNativeSandboxProfile =
  "(version 1)\n(allow default)\n(deny network*)\n";
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
) {
  return Object.freeze({
    denyNetwork: true,
    deniedSocketScope: enforcementMode === "explicit"
      ? "all-network"
      : "safe-runner-deny-network",
    enforcementMode,
    explicitSelfTestDenied: enforcementMode === "explicit" ? true : null,
    inheritedSelfTestDenied: enforcementMode === "inherited",
    migrationChildren: 2,
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
  if (childExited(child)) {
    return {
      exitCode: child.exitCode,
      graceful: false,
      signal: child.signalCode,
    };
  }
  child.kill("SIGTERM");
  if (await waitForChildExit(child, 12_000)) {
    return {
      exitCode: child.exitCode,
      graceful: child.exitCode === 0 && child.signalCode === null,
      signal: child.signalCode,
    };
  }
  child.kill("SIGKILL");
  await waitForChildExit(child, 2_000);
  return {
    exitCode: child.exitCode,
    graceful: false,
    signal: child.signalCode,
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

async function runtimeJson(origin, path, headers = {}) {
  const response = await runtimeBytes(
    origin,
    path,
    64 * 1024,
    { Accept: "application/json", ...headers },
  );
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

function readinessSummary(body) {
  if (
    !body || typeof body !== "object" ||
    body.status !== "ready" || body.mode !== "active" ||
    body.mutationsAccepted !== true || body.databaseProbe !== "read-only" ||
    body.schemaVersion !== currentStartupSchemaVersion
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_READINESS_MISMATCH",
      "Migrated restore did not reach normal active readiness",
    );
  }
  return Object.freeze({
    databaseProbe: "read-only",
    mode: "active",
    mutationsAccepted: true,
    schemaVersion: currentStartupSchemaVersion,
    status: "ready",
  });
}

async function waitForRuntimeReadiness(child, origin, outputState) {
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
      response = await runtimeJson(origin, "/api/health/ready");
    } catch (error) {
      if (error instanceof CliError) throw error;
    }
    if (response?.status === 200) return readinessSummary(response.body);
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
    const activeGenerationTasks = Number(activeTasks?.count);
    if (activeGenerationTasks !== 0) {
      fail(
        "FINAL_BACKUP_STARTUP_NOT_QUIET",
        "Final-candidate restore has active generation work at startup",
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

    const migratedDuration = database.prepare(`
      SELECT id, duration_seconds, duration_source, duration_status
      FROM media_assets
      WHERE storage_backend = 'local' AND storage_status = 'ready'
        AND kind IN ('audio', 'video')
      ORDER BY kind, id
      LIMIT 1
    `).get();
    if (
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
      activeGenerationTasks,
      canvasDocumentsRead,
      ordinaryDatabaseOpen: true,
      readyLegacyDurationAssets: 1,
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

async function inspectStartupNetworkAudit(auditPath, port, childPid) {
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
  const guardLoads = events.filter((event) =>
    event?.event === "node_guard_loaded" && event.pid === childPid &&
    Array.isArray(event.initialAllowedPorts) &&
    event.initialAllowedPorts.includes(port)
  ).length;
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
    event.pid === childPid && event.kind === "net.Server.listen" &&
    event.port === port && event.reason === "non_loopback" &&
    viteWildcardProbeHosts.includes(event.host)
  );
  const exactViteWildcardProbeDenials =
    viteWildcardProbeDenials.length === viteWildcardProbeHosts.length &&
    viteWildcardProbeHosts.every((host) =>
      viteWildcardProbeDenials.filter((event) => event.host === host).length === 1
    );
  const unexpectedBlocked = blocked.filter((event) =>
    !viteWildcardProbeDenials.includes(event)
  );
  const logicalTargets = events.filter((event) =>
    event?.event === "node_logical_target_via_guarded_agent"
  );
  const registered = events.filter((event) =>
    event?.event === "node_loopback_port_registered" &&
    event.pid === childPid && event.kind === "net.Server.listen" &&
    event.port === port
  ).length;
  const unregistered = events.filter((event) =>
    event?.event === "node_loopback_port_unregistered" &&
    event.pid === childPid && event.kind === "net.Server.listen" &&
    event.port === port
  ).length;
  const foreignListenerEvents = events.filter((event) =>
    new Set([
      "node_loopback_port_registered",
      "node_loopback_port_unregistered",
    ]).has(event?.event) && !(
      event.pid === childPid && event.kind === "net.Server.listen" &&
      event.port === port
    )
  );
  if (
    guardLoads < 1 || !exactViteWildcardProbeDenials ||
    unexpectedBlocked.length !== 0 || logicalTargets.length !== 0 ||
    registered !== 1 || unregistered !== 1 || foreignListenerEvents.length !== 0
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_NETWORK_ATTEMPTED",
      "Final-candidate runtime attempted an unapproved network operation",
    );
  }
  return Object.freeze({
    deniedWildcardBindProbes: viteWildcardProbeDenials.length,
    externalNetworkAttempts: 0,
    guardLoads,
    ossRequests: 0,
    providerRequests: 0,
  });
}

function startupEnvironment(targetDirectory, startupRoot, auditPath, port) {
  const guardPath = resolve(appRoot, "scripts", "offline-network-guard.mjs");
  return {
    HOME: startupRoot,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
    NODE_ENV: "production",
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: `--import=${pathToFileURL(guardPath).href}`,
    NO_COLOR: "1",
    PATH: [
      dirname(process.execPath),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(":"),
    TEMP: startupRoot,
    TMP: startupRoot,
    TMPDIR: startupRoot,
    UNBOUNDRY_DATA_DIR: targetDirectory,
    UNBOUNDRY_OFFLINE_GUARD_ALLOWED_PORTS: JSON.stringify([port]),
    UNBOUNDRY_OFFLINE_GUARD_AUDIT: auditPath,
    UNBOUNDRY_OFFLINE_GUARD_MODE: "final-candidate",
    UNBOUNDRY_VITE_CACHE_DIR: resolve(startupRoot, "vite-cache"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
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

async function finalInventoryTestCheckpoint(kind) {
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
    const buildRoot = resolve(appRoot, "dist", "client");
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
      buildRoot !== resolve(repositoryRoot, "dist", "client") ||
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

async function inventoryProductionBuild() {
  const requestedRoot = resolve(appRoot, "dist", "client");
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
    await finalInventoryTestCheckpoint("build");
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
    await finalInventoryTestCheckpoint("restored");
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
    return Object.freeze({
      identity,
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
  const response = await fetch(`${origin}${path}`, {
    headers,
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.body) return { status: response.status, value: Buffer.alloc(0) };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        fail(
          "FINAL_BACKUP_STARTUP_RESPONSE_INVALID",
          "Final-candidate runtime returned an oversized response",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the bounded-reader failure.
      }
    }
    if (error instanceof CliError) throw error;
    fail(
      "FINAL_BACKUP_STARTUP_RESPONSE_INVALID",
      "Final-candidate runtime response could not be read safely",
    );
  } finally {
    reader.releaseLock();
  }
  return { status: response.status, value: Buffer.concat(chunks, bytes) };
}

async function validateNormalStartup(targetDirectory, scratchRoot) {
  const restoredInspectionBefore = inspectBackupDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
  );
  const restoredStateBefore = await fingerprintRestoredState(
    targetDirectory,
    restoredInspectionBefore.logicalSha256,
  );
  const buildArtifactBefore = await inventoryProductionBuild();
  const port = await allocateStartupPort();
  let startupRoot;
  let child;
  try {
    startupRoot = await mkdtemp(
      resolve(scratchRoot, ".unboundry-final-startup-"),
    );
    await chmod(startupRoot, 0o700);
    const auditPath = resolve(startupRoot, "network-audit.jsonl");
    await writeFile(auditPath, "", { flag: "wx", mode: 0o600 });
    await chmod(auditPath, 0o600);
    const outputState = { bytes: 0, exceeded: false, startFailed: false };
    let primaryError;
    let readiness;
    let authStatus;
    let applicationData;
    try {
      child = spawn(
        process.execPath,
        [
          resolve(appRoot, "node_modules", "vite", "bin", "vite.js"),
          "preview",
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--strictPort",
        ],
        {
          cwd: appRoot,
          env: startupEnvironment(targetDirectory, startupRoot, auditPath, port),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.once("error", () => {
        outputState.startFailed = true;
      });
      const collect = (chunk) => {
        outputState.bytes += chunk.length;
        if (outputState.bytes <= maximumStartupOutputBytes) return;
        outputState.exceeded = true;
        if (!childExited(child)) child.kill("SIGKILL");
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const origin = `http://127.0.0.1:${port}`;
      readiness = await waitForRuntimeReadiness(child, origin, outputState);
      const indexResponse = await runtimeBytes(
        origin,
        "/",
        buildArtifactBefore.indexBytes.length,
      );
      if (
        indexResponse.status !== 200 ||
        !indexResponse.value.equals(buildArtifactBefore.indexBytes) ||
        createHash("sha256").update(indexResponse.value).digest("hex") !==
          buildArtifactBefore.summary.indexSha256
      ) {
        fail(
          "FINAL_BACKUP_STARTUP_BUILD_MISMATCH",
          "Final-candidate production preview did not serve its fixed index",
        );
      }
      const fixtureApi = await runtimeBytes(
        origin,
        "/__fixture-api/shell.empty.primary",
        64 * 1024,
        { Accept: "application/json" },
      );
      if (fixtureApi.status !== 404) {
        fail(
          "FINAL_BACKUP_STARTUP_FIXTURE_EXPOSED",
          "Final-candidate production preview exposed its development fixture API",
        );
      }
      const auth = await runtimeJson(origin, "/api/auth/status", {
        Cookie: "unboundry_session=final-startup-probe",
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
      applicationData = await validateRestoredApplicationData(targetDirectory);
      const sustained = await runtimeJson(origin, "/api/health/ready");
      if (sustained.status !== 200) {
        fail(
          "FINAL_BACKUP_STARTUP_READINESS_MISMATCH",
          "Final-candidate runtime lost readiness after ordinary reads",
        );
      }
      readinessSummary(sustained.body);
    } catch (error) {
      primaryError = error;
    }
    const shutdown = child
      ? await stopStartupRuntime(child)
      : { exitCode: null, graceful: false, signal: null };
    await assertStartupPortReleased(port);
    const buildArtifactAfter = shutdown.graceful
      ? await inventoryProductionBuild()
      : undefined;
    const restoredInspectionAfter = shutdown.graceful
      ? inspectBackupDatabase(
        resolve(targetDirectory, "unboundry.sqlite"),
        targetDirectory,
      )
      : undefined;
    const restoredStateAfter = shutdown.graceful
      ? await fingerprintRestoredState(
        targetDirectory,
        restoredInspectionAfter.logicalSha256,
      )
      : undefined;
    const networkAudit = await inspectStartupNetworkAudit(
      auditPath,
      port,
      child?.pid,
    );
    if (!shutdown.graceful) {
      fail(
        "FINAL_BACKUP_STARTUP_SHUTDOWN_FAILED",
        "Final-candidate runtime did not shut down cleanly within its deadline",
      );
    }
    if (buildArtifactAfter.identity !== buildArtifactBefore.identity) {
      fail(
        "FINAL_BACKUP_BUILD_ARTIFACT_CHANGED",
        "Final-candidate production build changed during preview validation",
      );
    }
    if (restoredStateAfter.identity !== restoredStateBefore.identity) {
      fail(
        "FINAL_BACKUP_STARTUP_RESTORED_STATE_CHANGED",
        "Final-candidate production preview changed its restored state",
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
      readiness,
      shutdown: "graceful",
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
    "--data-dir",
    "--fake-oss-target-dir",
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
    pathsOverlap([...dataPaths, ...keyPaths, ...mirrorPaths]) ||
    pathsOverlap([
      ...canonicalDataPaths,
      ...canonicalKeyPaths,
      ...canonicalMirrorPaths,
    ])
  ) {
    fail(
      "FINAL_BACKUP_ARGUMENT_INVALID",
      "Final-candidate keys and OSS mirrors must be mutually disjoint and outside all data and work directories",
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
    report?.finalCandidate !== true ||
    backup?.schemaVersion !== 37 ||
    backup?.databaseLogicalSha256 !== expectedSha ||
    backup?.captureMode !== "locked-exact" ||
    backup?.finalCandidate !== true ||
    report?.sha256 !== backup?.mediaIntegrity?.sha256 ||
    report?.evidenceSha256 !== backup?.mediaIntegrity?.evidenceSha256
  ) {
    fail(
      "FINAL_BACKUP_SOURCE_CHANGED",
      "Final-candidate report and encrypted backup do not bind the same exact v37 source",
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
    verified?.finalCandidate !== true
  ) {
    fail(
      "FINAL_BACKUP_VERIFY_MISMATCH",
      "Verified package summary differs from the created exact-v37 backup",
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
    restored?.finalCandidate !== true
  ) {
    fail(
      "FINAL_BACKUP_RESTORE_MISMATCH",
      "Restored package summary differs from the verified exact-v37 backup",
    );
  }
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
  const durationProbeFixture = await createSafeDurationProbeFixture(scratchRoot);
  const migrationNativeSandbox = await createMigrationNativeSandbox(
    durationProbeFixture.directory,
  );
  const migrationChildOptions = { wrapper: migrationNativeSandbox.wrapper };
  let migrationNativeAudit;
  let migrationDryRun;
  let migrationApplied;
  try {
    const migrationCommon = [
      "--data-dir",
      targetDirectory,
      "--expected-logical-sha256",
      expectedSha,
      ...scratch,
      "--test-duration-probe-audit",
      durationProbeFixture.auditPath,
      "--test-duration-probe-executable",
      durationProbeFixture.executable,
    ];
    migrationDryRun = await runJsonScript(
      "migrate-schema37-to39.mjs",
      ["--dry-run", ...migrationCommon],
      migrationChildOptions,
    );
    if (
      migrationDryRun?.ok !== true ||
      migrationDryRun?.mode !== "dry-run" ||
      migrationDryRun?.status !== "ready" ||
      migrationDryRun?.sourceVersion !== 37 ||
      migrationDryRun?.targetVersion !== 39 ||
      migrationDryRun?.expectedSourceLogicalSha256 !== expectedSha ||
      migrationDryRun?.nativeDurationProbes !== 0
    ) {
      fail(
        "FINAL_BACKUP_MIGRATION_DRY_RUN_MISMATCH",
        "Restored exact-v37 migration dry-run did not match its source contract",
      );
    }
    migrationApplied = await runJsonScript(
      "migrate-schema37-to39.mjs",
      ["--apply", ...migrationCommon],
      migrationChildOptions,
    );
    migrationNativeAudit = await verifySafeDurationProbeAudit(
      durationProbeFixture.auditPath,
      migrationApplied,
      migrationNativeSandbox.evidence,
    );
  } finally {
    await rm(durationProbeFixture.directory, { force: true, recursive: true });
  }
  if (
    migrationApplied?.ok !== true ||
    migrationApplied?.mode !== "apply" ||
    migrationApplied?.status !== "complete" ||
    migrationApplied?.sourceVersion !== 37 ||
    migrationApplied?.targetVersion !== 39 ||
    migrationApplied?.expectedSourceLogicalSha256 !== expectedSha ||
    migrationApplied?.backfilledDurations < 1 ||
    migrationNativeAudit?.nativeDurationProbes < 1 ||
    migrationNativeAudit?.externalNetworkAttempts !== 0
  ) {
    fail(
      "FINAL_BACKUP_MIGRATION_APPLY_MISMATCH",
      "Restored exact-v37 one-shot migration did not match its source contract",
    );
  }
  const migrationInspection = inspectBackupDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
  );
  if (
    migrationInspection.userVersion !== currentStartupSchemaVersion ||
    typeof migrationApplied?.targetLogicalSha256 !== "string" ||
    migrationApplied.targetLogicalSha256 !== migrationInspection.logicalSha256
  ) {
    fail(
      "FINAL_BACKUP_STARTUP_SCHEMA_MISMATCH",
      "Migrated restore is not exact schema 39 for normal startup",
    );
  }
  const startupRuntime = await validateNormalStartup(
    targetDirectory,
    scratchRoot,
  );
  const postStartupInspection = inspectBackupDatabase(
    resolve(targetDirectory, "unboundry.sqlite"),
    targetDirectory,
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
  const startupValidation = Object.freeze({
    ...startupRuntime,
    targetLogicalSha256: postStartupInspection.logicalSha256,
  });
  process.stdout.write(`${JSON.stringify({
    backup,
    expectedDatabaseLogicalSha256: expectedSha,
    expectedSchemaVersion: 37,
    format: "unboundry-final-candidate-backup",
    fakeOssRecovery,
    migrationApplied,
    migrationDryRun,
    migrationInspection,
    migrationNativeAudit,
    report,
    restored,
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
    code: known ? error.code : "FINAL_BACKUP_FAILED",
    message,
  })}\n`);
  process.exitCode = 1;
}
