import "./node-typescript-runtime.mjs";

import { spawn } from "node:child_process";
import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  scrypt as deriveScrypt,
} from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  validateAdmittedRelease,
} from "./lib/admitted-release.mjs";
import {
  authenticateInheritedLinuxValidationSandbox,
} from "./lib/linux-validation-sandbox.mjs";
import {
  assertReleaseSourcePairArtifacts,
  attestReleaseSourcePair,
  RELEASE_SOURCE_PAIR_MODES,
} from "./lib/release-source-pair.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedNodeVersion = "22.23.1";
const bwrapExecutable = "/usr/bin/bwrap";
const systemTemporaryRoot = "/var/tmp";
const caseRootPrefix = "unboundry-linux-validation-";
const approvalFormat = "unboundry-linux-production-approval";
const approvalVersion = 1;
const maximumApprovalBytes = 64 * 1024;
const sandboxApprovalPath = "/run/unboundry-validation/approval.json";
const commitPattern = /^[a-f0-9]{40}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumOutputBytes = 32 * 1024 * 1024;
const allowedControllerEnvironment = Object.freeze([
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TZ",
]);
const optionalReadOnlyRuntimeBindings = Object.freeze([
  "/lib64",
  "/etc/ld.so.cache",
  "/etc/localtime",
  "/etc/ssl/certs",
]);
const optionalAlternativeDirectory = "/etc/alternatives";
const providerDocumentAad = Buffer.from(
  "unboundry:provider-profiles:v1",
  "utf8",
);
const storageDocumentAad = Buffer.from(
  "unboundry:storage-profiles:v1",
  "utf8",
);
const accountCredentialAad = Buffer.from(
  "unboundry:account-credentials:v1",
  "utf8",
);

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let validationStage = "entry";

function fail(code, message) {
  throw new ValidationError(code, message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(), [...keys].sort());
}

function normalizedApprovalDocument(document) {
  const identityKeys = ["commit", "manifestSha256", "sourceTree", "version"];
  if (
    !exactKeys(document, ["bridge", "final", "format", "proofSha256", "version"]) ||
    document.format !== approvalFormat || document.version !== approvalVersion ||
    !exactKeys(document.bridge, identityKeys) ||
    !exactKeys(document.final, identityKeys) ||
    document.bridge.version !== "0.5.2" || document.final.version !== "0.6.0" ||
    !commitPattern.test(document.bridge.commit ?? "") ||
    !commitPattern.test(document.bridge.sourceTree ?? "") ||
    !sha256Pattern.test(document.bridge.manifestSha256 ?? "") ||
    !commitPattern.test(document.final.commit ?? "") ||
    !commitPattern.test(document.final.sourceTree ?? "") ||
    !sha256Pattern.test(document.final.manifestSha256 ?? "") ||
    !sha256Pattern.test(document.proofSha256 ?? "") ||
    document.bridge.commit === document.final.commit ||
    document.bridge.sourceTree === document.final.sourceTree
  ) {
    fail(
      "LINUX_VALIDATION_APPROVAL_INVALID",
      "Linux production approval schema or release identity is invalid",
    );
  }
  return Object.freeze({
    bridge: Object.freeze({
      commit: document.bridge.commit,
      manifestSha256: document.bridge.manifestSha256,
      sourceTree: document.bridge.sourceTree,
      version: document.bridge.version,
    }),
    final: Object.freeze({
      commit: document.final.commit,
      manifestSha256: document.final.manifestSha256,
      sourceTree: document.final.sourceTree,
      version: document.final.version,
    }),
    format: approvalFormat,
    proofSha256: document.proofSha256,
    version: approvalVersion,
  });
}

function canonicalApprovalBytes(document) {
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function readApprovalContract(path, pinned) {
  const canonicalBefore = await realpath(path).catch(() => undefined);
  const pathBefore = await lstat(path, { bigint: true }).catch(() => undefined);
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : -1n;
  if (
    path !== path.normalize("NFC") || /[\0\r\n]/.test(path) ||
    canonicalBefore !== path || !pathBefore?.isFile() ||
    pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n ||
    pathBefore.uid !== currentUid || (pathBefore.mode & 0o7777n) !== 0o400n ||
    pathBefore.size < 2n || pathBefore.size > BigInt(maximumApprovalBytes)
  ) {
    fail(
      "LINUX_VALIDATION_APPROVAL_UNSAFE",
      "Linux production approval must be a canonical owned private immutable regular file",
    );
  }
  let handle;
  try {
    handle = await open(
      path,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0) |
        fileConstants.O_NONBLOCK,
    );
    const openedBefore = await handle.stat({ bigint: true });
    if (!sameFixedFileIdentity(pathBefore, openedBefore)) {
      fail(
        "LINUX_VALIDATION_APPROVAL_CHANGED",
        "Linux production approval changed before it was opened",
      );
    }
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true }).catch(() => undefined);
    const canonicalAfter = await realpath(path).catch(() => undefined);
    if (
      bytes.length !== Number(openedBefore.size) ||
      !sameFixedFileIdentity(openedBefore, openedAfter) ||
      !pathAfter || !sameFixedFileIdentity(openedBefore, pathAfter) ||
      canonicalAfter !== path
    ) {
      fail(
        "LINUX_VALIDATION_APPROVAL_CHANGED",
        "Linux production approval changed while it was read",
      );
    }
    let document;
    try {
      document = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      fail(
        "LINUX_VALIDATION_APPROVAL_INVALID",
        "Linux production approval is not valid UTF-8 JSON",
      );
    }
    const normalized = normalizedApprovalDocument(document);
    if (!bytes.equals(canonicalApprovalBytes(normalized))) {
      fail(
        "LINUX_VALIDATION_APPROVAL_INVALID",
        "Linux production approval is not canonical JSON",
      );
    }
    const approvalSha256 = sha256(bytes);
    const identity = fixedFileIdentity(openedAfter);
    if (
      pinned &&
      (pinned.path !== path || pinned.sha256 !== approvalSha256 ||
        !sameJson(pinned.identity, identity))
    ) {
      fail(
        "LINUX_VALIDATION_APPROVAL_CHANGED",
        "Linux production approval identity or bytes changed during validation",
      );
    }
    return Object.freeze({
      document: normalized,
      identity,
      path,
      sha256: approvalSha256,
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    fail(
      "LINUX_VALIDATION_APPROVAL_UNSAFE",
      "Linux production approval could not be read safely",
    );
  } finally {
    await handle?.close();
  }
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) && difference !== ".." &&
      !difference.startsWith(`..${sep}`));
}

function normalizedAbsolute(value, label) {
  if (!value || !isAbsolute(value) || resolve(value) !== value) {
    fail("LINUX_VALIDATION_ARGUMENT_INVALID", `${label} must be normalized and absolute`);
  }
  return value;
}

function parseArguments(argv) {
  let inside = false;
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--inside") {
      if (inside) fail("LINUX_VALIDATION_ARGUMENT_INVALID", "Inside mode is duplicated");
      inside = true;
      continue;
    }
    if (![
      "--approval-json",
      "--approval-sha256",
      "--bridge-release-manifest",
      "--case-root",
      "--final-release-manifest",
    ].includes(argument)) {
      fail("LINUX_VALIDATION_ARGUMENT_INVALID", "Unknown Linux validation argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(argument)) {
      fail("LINUX_VALIDATION_ARGUMENT_INVALID", "Linux validation argument is missing or duplicated");
    }
    values.set(argument, value);
    index += 1;
  }
  for (const option of [
    "--approval-json",
    "--bridge-release-manifest",
    "--case-root",
    "--final-release-manifest",
  ]) {
    if (!values.has(option)) {
      fail("LINUX_VALIDATION_ARGUMENT_INVALID", `Missing ${option}`);
    }
  }
  if (
    inside !== values.has("--approval-sha256") ||
    inside && !sha256Pattern.test(values.get("--approval-sha256") ?? "")
  ) {
    fail(
      "LINUX_VALIDATION_ARGUMENT_INVALID",
      "Inside approval hash is missing, malformed or supplied to the host controller",
    );
  }
  return Object.freeze({
    approvalJson: normalizedAbsolute(
      values.get("--approval-json"),
      "Approval JSON",
    ),
    approvalSha256: values.get("--approval-sha256"),
    bridgeManifest: normalizedAbsolute(
      values.get("--bridge-release-manifest"),
      "Bridge manifest",
    ),
    caseRoot: normalizedAbsolute(values.get("--case-root"), "Case root"),
    finalManifest: normalizedAbsolute(
      values.get("--final-release-manifest"),
      "Final manifest",
    ),
    inside,
  });
}

function assertCleanControllerEnvironment() {
  if (
    process.execPath !== "/opt/node22/bin/node" ||
    !sameJson(Object.keys(process.env).sort(), allowedControllerEnvironment) ||
    process.env.HOME !== "/var/empty" || process.env.LANG !== "C" ||
    process.env.LC_ALL !== "C" || process.env.PATH !== "/opt/node22/bin:/usr/bin:/bin" ||
    process.env.TZ !== "UTC"
  ) {
    fail(
      "LINUX_VALIDATION_CONTROLLER_ENVIRONMENT_INVALID",
      "Linux validation controller requires the documented clean environment",
    );
  }
  return Object.freeze({
    cleanEnvironment: true,
    executable: process.execPath,
    forbiddenVariablesPresent: 0,
    variableNames: allowedControllerEnvironment,
  });
}

function stableDirectoryAnchorIdentity(details) {
  return Object.freeze({
    dev: String(details.dev),
    ino: String(details.ino),
    mode: Number(details.mode & 0o777n),
    uid: String(details.uid),
  });
}

async function assertPrivateDirectory(path, { empty = false } = {}) {
  const canonical = await realpath(path).catch(() => undefined);
  const details = await lstat(path, { bigint: true }).catch(() => undefined);
  const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : -1n;
  if (
    canonical !== path || !details?.isDirectory() || details.isSymbolicLink() ||
    details.uid !== uid || (details.mode & 0o777n) !== 0o700n
  ) {
    fail("LINUX_VALIDATION_PATH_UNSAFE", "Linux validation case root must be an owned physical 0700 directory");
  }
  if (empty && (await readdir(path)).length !== 0) {
    fail("LINUX_VALIDATION_PATH_UNSAFE", "Linux validation case root must begin empty");
  }
  return Object.freeze({
    canonical,
    identity: stableDirectoryAnchorIdentity(details),
  });
}

async function assertPrivateDirectoryAnchor(path, pinned) {
  const canonical = await realpath(path).catch(() => undefined);
  const details = await lstat(path, { bigint: true }).catch(() => undefined);
  if (
    canonical !== pinned.canonical || !details?.isDirectory() ||
    details.isSymbolicLink() || String(details.dev) !== pinned.identity.dev ||
    String(details.ino) !== pinned.identity.ino ||
    Number(details.mode & 0o777n) !== pinned.identity.mode ||
    String(details.uid) !== pinned.identity.uid
  ) {
    fail(
      "LINUX_VALIDATION_PATH_CHANGED",
      "Linux validation case root changed while the sandbox was running",
    );
  }
}

async function createCaseRoot(path) {
  const parent = dirname(path);
  const parentCanonical = await realpath(parent).catch(() => undefined);
  const parentDetails = await lstat(parent, { bigint: true }).catch(
    () => undefined,
  );
  if (
    parent !== systemTemporaryRoot || parentCanonical !== systemTemporaryRoot ||
    !new RegExp(`^${caseRootPrefix}[a-f0-9]{16,64}$`).test(basename(path)) ||
    !parentDetails?.isDirectory() || parentDetails.isSymbolicLink() ||
    parentDetails.uid !== 0n || (parentDetails.mode & 0o1000n) === 0n
  ) {
    fail(
      "LINUX_VALIDATION_PATH_UNSAFE",
      "Linux validation case root must be a fresh private directory under /var/tmp",
    );
  }
  let createdIdentity;
  try {
    await mkdir(path, { mode: 0o700 });
    const created = await lstat(path, { bigint: true });
    if (!created.isDirectory() || created.isSymbolicLink()) {
      fail(
        "LINUX_VALIDATION_PATH_UNSAFE",
        "Linux validation case root creation returned an unsafe entry",
      );
    }
    createdIdentity = stableDirectoryAnchorIdentity(created);
  } catch (error) {
    if (error?.code === "EEXIST") {
      fail(
        "LINUX_VALIDATION_PATH_UNSAFE",
        "Linux validation case root must not exist before this run",
      );
    }
    throw error;
  }
  try {
    await chmod(path, 0o700);
    return await assertPrivateDirectory(path, { empty: true });
  } catch (error) {
    const current = await lstat(path, { bigint: true }).catch(() => undefined);
    if (
      current?.isDirectory() && !current.isSymbolicLink() &&
      String(current.dev) === createdIdentity.dev &&
      String(current.ino) === createdIdentity.ino &&
      String(current.uid) === createdIdentity.uid
    ) {
      await removeOwnedTree(path, current.uid);
    }
    throw error;
  }
}

async function removeOwnedTree(path, expectedUid) {
  const details = await lstat(path, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (!details) return;
  if (details.uid !== expectedUid) {
    fail(
      "LINUX_VALIDATION_CLEANUP_UNKNOWN",
      "Linux validation transient ownership changed before cleanup",
    );
  }
  if (details.isDirectory() && !details.isSymbolicLink()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) {
      await removeOwnedTree(join(path, entry), expectedUid);
    }
    await rm(path, { force: true, recursive: true });
    return;
  }
  if (details.isFile() && !details.isSymbolicLink()) {
    await chmod(path, 0o600);
  }
  await rm(path, { force: true, recursive: true });
}

async function cleanupCaseTransients(caseRoot, pinned) {
  await assertPrivateDirectoryAnchor(caseRoot, pinned);
  const expectedUid = BigInt(process.getuid());
  for (const name of [
    ".linux-validation-owner",
    ".linux-validation-host-namespaces.json",
    "fixture",
    "home",
    "temporary",
  ]) {
    await removeOwnedTree(join(caseRoot, name), expectedUid);
  }
  await assertPrivateDirectoryAnchor(caseRoot, pinned);
  const remaining = (await readdir(caseRoot)).sort();
  if (!sameJson(remaining, ["inner-receipt.json"])) {
    fail(
      "LINUX_VALIDATION_CLEANUP_UNKNOWN",
      "Linux validation transient cleanup left an unexpected entry",
    );
  }
}

function expectedApprovedRelationship(approval) {
  return Object.freeze({
    bridgeCommit: approval.bridge.commit,
    bridgeSourceTree: approval.bridge.sourceTree,
    bridgeSourceVersion: approval.bridge.version,
    changedPaths: Object.freeze(["package-lock.json", "package.json"]),
    crossCommitProof: true,
    finalCommit: approval.final.commit,
    finalParentIsBridgeCommit: true,
    finalSourceTree: approval.final.sourceTree,
    finalSourceVersion: approval.final.version,
    mode: "formal-direct-parent-bridge-final",
    proofSha256: approval.proofSha256,
  });
}

function assertArtifactsMatchApproval(bridge, final, approval) {
  if (
    bridge.manifest.commit !== approval.bridge.commit ||
    bridge.manifest.sourceTree !== approval.bridge.sourceTree ||
    bridge.manifest.packageVersion !== approval.bridge.version ||
    final.manifest.commit !== approval.final.commit ||
    final.manifest.sourceTree !== approval.final.sourceTree ||
    final.manifest.packageVersion !== approval.final.version ||
    bridge.releaseRoot !== final.releaseRoot ||
    !sameJson(bridge.rootIdentity, final.rootIdentity)
  ) {
    fail(
      "LINUX_VALIDATION_ARTIFACT_PAIR_INVALID",
      "Release artifacts do not match the external approval contract",
    );
  }
}

async function admittedPair(bridgeManifest, finalManifest, approval, source) {
  if (
    source.commit !== approval.final.commit ||
    source.sourceTree !== approval.final.sourceTree
  ) {
    fail(
      "LINUX_VALIDATION_SOURCE_PAIR_INVALID",
      "The approved final release must be the clean tracked HEAD",
    );
  }
  const [bridge, final, relationship] = await Promise.all([
    validateAdmittedRelease({
      expectedManifestSha256: approval.bridge.manifestSha256,
      expectedRole: "bridge",
      manifestPath: bridgeManifest,
    }),
    validateAdmittedRelease({
      expectedManifestSha256: approval.final.manifestSha256,
      expectedRole: "final",
      manifestPath: finalManifest,
    }),
    attestReleaseSourcePair({
      finalCommit: source.commit,
      gitExecutable: "/usr/bin/git",
      mode: RELEASE_SOURCE_PAIR_MODES.formal,
      repository: repositoryRoot,
    }),
  ]);
  const expected = expectedApprovedRelationship(approval);
  if (JSON.stringify(relationship) !== JSON.stringify(expected)) {
    fail(
      "LINUX_VALIDATION_SOURCE_PAIR_INVALID",
      "Formal HEAD source pair does not match the external approval contract",
    );
  }
  assertReleaseSourcePairArtifacts(relationship, { bridge, final });
  assertArtifactsMatchApproval(bridge, final, approval);
  return Object.freeze({ bridge, final, relationship });
}

async function admittedArtifacts(bridgeManifest, finalManifest, approval) {
  const [bridge, final] = await Promise.all([
    validateAdmittedRelease({
      expectedManifestSha256: approval.bridge.manifestSha256,
      expectedRole: "bridge",
      manifestPath: bridgeManifest,
    }),
    validateAdmittedRelease({
      expectedManifestSha256: approval.final.manifestSha256,
      expectedRole: "final",
      manifestPath: finalManifest,
    }),
  ]);
  assertArtifactsMatchApproval(bridge, final, approval);
  return Object.freeze({ bridge, final });
}

function bubblewrapDirectories(paths) {
  const directories = new Set();
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== "/") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  return [...directories].sort((left, right) => {
    const depth = left.split(sep).length - right.split(sep).length;
    return depth || left.localeCompare(right);
  });
}

function readOnlyBindSources(bindings) {
  return bindings.map((binding) =>
    typeof binding === "string"
      ? Object.freeze({ destination: binding, source: binding })
      : binding
  );
}

async function optionalReadOnlyRuntimeBindSources() {
  const bindings = [];
  for (const path of optionalReadOnlyRuntimeBindings) {
    if (await lstat(path).then(() => true, () => false)) {
      bindings.push(Object.freeze({ destination: path, source: path }));
    }
  }
  const path = optionalAlternativeDirectory;
  const canonical = await realpath(path).catch(() => undefined);
  const details = await lstat(path, { bigint: true }).catch(() => undefined);
  let alternativeDirectory = null;
  if (details) {
    if (
      canonical !== path || !details.isDirectory() || details.isSymbolicLink() ||
      details.uid !== 0n || (details.mode & 0o022n) !== 0n
    ) {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_UNSAFE",
        "Host runtime read-only binding is unsafe",
      );
    }
    bindings.push(Object.freeze({ destination: path, source: path }));
    alternativeDirectory = Object.freeze({
      identity: fixedFileIdentity(details),
      path,
    });
  }
  return Object.freeze({
    alternativeDirectory,
    bindings: Object.freeze(bindings),
  });
}

async function assertOptionalRuntimeBindingUnchanged(evidence) {
  const path = optionalAlternativeDirectory;
  const canonical = await realpath(path).catch(() => undefined);
  const details = await lstat(path, { bigint: true }).catch(() => undefined);
  if (!evidence) {
    if (canonical !== undefined || details !== undefined) {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_CHANGED",
        "Host runtime read-only binding appeared during validation",
      );
    }
    return;
  }
  if (
    evidence.path !== path || canonical !== path || !details?.isDirectory() ||
    details.isSymbolicLink() || details.uid !== 0n ||
    (details.mode & 0o022n) !== 0n ||
    !sameJson(fixedFileIdentity(details), evidence.identity)
  ) {
    fail(
      "LINUX_VALIDATION_PREREQUISITE_CHANGED",
      "Host runtime read-only binding changed during validation",
    );
  }
}

function fixedFileIdentity(details) {
  return Object.freeze({
    ctimeNs: String(details.ctimeNs),
    dev: String(details.dev),
    gid: String(details.gid),
    ino: String(details.ino),
    mode: Number(details.mode & 0o7777n),
    mtimeNs: String(details.mtimeNs),
    nlink: String(details.nlink),
    size: String(details.size),
    uid: String(details.uid),
  });
}

function sameFixedFileIdentity(left, right) {
  return JSON.stringify(fixedFileIdentity(left)) ===
    JSON.stringify(fixedFileIdentity(right));
}

async function trustedExecutableAncestors(path) {
  const ancestors = [];
  let current = dirname(path);
  for (;;) {
    const canonical = await realpath(current).catch(() => undefined);
    const details = await lstat(current, { bigint: true }).catch(() => undefined);
    if (
      canonical !== current || !details?.isDirectory() ||
      details.isSymbolicLink() || details.uid !== 0n ||
      (details.mode & 0o022n) !== 0n
    ) {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_UNSAFE",
        "Manifest-bound prerequisite has an unsafe ancestor",
      );
    }
    ancestors.push(Object.freeze({
      identity: fixedFileIdentity(details),
      path: current,
    }));
    if (current === "/") break;
    current = dirname(current);
  }
  return Object.freeze(ancestors);
}

async function hashOpenedFile(handle, expectedSize) {
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
  if (BigInt(position) !== expectedSize) {
    fail(
      "LINUX_VALIDATION_PREREQUISITE_CHANGED",
      "Manifest-bound prerequisite changed while it was hashed",
    );
  }
  return hash.digest("hex");
}

async function inspectManifestBoundTool(contract) {
  const expectedName = contract.name === "bwrap" ? "bwrap" : contract.name;
  const canonical = await realpath(contract.path).catch(() => undefined);
  const pathBefore = await lstat(contract.path, { bigint: true }).catch(
    () => undefined,
  );
  if (
    canonical !== contract.path || basename(contract.path) !== expectedName ||
    !pathBefore?.isFile() || pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== 1n || pathBefore.uid !== 0n ||
    (pathBefore.mode & 0o022n) !== 0n ||
    (pathBefore.mode & 0o111n) === 0n || pathBefore.size <= 0n
  ) {
    fail(
      "LINUX_VALIDATION_PREREQUISITE_UNSAFE",
      "Manifest-bound host prerequisite is unavailable or unsafe",
    );
  }
  let handle;
  const ancestorsBefore = await trustedExecutableAncestors(contract.path);
  try {
    handle = await open(
      contract.path,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
    const openedBefore = await handle.stat({ bigint: true });
    if (!sameFixedFileIdentity(pathBefore, openedBefore)) {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_CHANGED",
        "Manifest-bound prerequisite path changed before it was opened",
      );
    }
    const actualSha256 = await hashOpenedFile(handle, openedBefore.size);
    const openedAfter = await handle.stat({ bigint: true });
    if (!sameFixedFileIdentity(openedBefore, openedAfter)) {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_CHANGED",
        "Manifest-bound prerequisite changed while it was read",
      );
    }
    const version = await runBounded(contract.path, contract.arguments, {
      cwd: repositoryRoot,
      env: {
        HOME: "/var/empty",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/opt/node22/bin:/usr/bin:/bin",
        TZ: "UTC",
      },
      timeout: 15_000,
    });
    const pathAfter = await lstat(contract.path, { bigint: true }).catch(
      () => undefined,
    );
    const ancestorsAfter = await trustedExecutableAncestors(contract.path);
    if (
      !pathAfter || !sameFixedFileIdentity(pathBefore, pathAfter) ||
      await realpath(contract.path).catch(() => undefined) !== canonical ||
      !sameJson(ancestorsAfter, ancestorsBefore)
    ) {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_CHANGED",
        "Manifest-bound prerequisite changed during version inspection",
      );
    }
    let versionPattern;
    try {
      versionPattern = new RegExp(contract.versionPattern);
    } catch {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_INVALID",
        "Manifest-bound prerequisite version contract is invalid",
      );
    }
    if (
      actualSha256 !== contract.sha256 ||
      sha256(version.stdout) !== contract.versionOutputSha256 ||
      !versionPattern.test(version.stdout)
    ) {
      fail(
        "LINUX_VALIDATION_PREREQUISITE_MISMATCH",
        "Host prerequisite does not match the admitted release manifest",
      );
    }
    return Object.freeze({
      arguments: Object.freeze([...contract.arguments]),
      ancestors: ancestorsAfter,
      identity: fixedFileIdentity(pathAfter),
      name: contract.name,
      path: contract.path,
      sha256: actualSha256,
      versionOutputSha256: sha256(version.stdout),
    });
  } finally {
    await handle?.close();
  }
}

async function inspectHostPrerequisites(pair) {
  const bridgeContract = pair.bridge.manifest.hostPrerequisites;
  const finalContract = pair.final.manifest.hostPrerequisites;
  if (JSON.stringify(bridgeContract) !== JSON.stringify(finalContract)) {
    fail(
      "LINUX_VALIDATION_PREREQUISITE_MISMATCH",
      "Bridge and final releases require different host prerequisites",
    );
  }
  const contracts = [...bridgeContract.executables, bridgeContract.sandbox];
  if (
    contracts.length !== 4 ||
    JSON.stringify(contracts.map((contract) => contract.name).sort()) !==
      JSON.stringify(["bwrap", "ffmpeg", "ffprobe", "node"]) ||
    bridgeContract.sandbox.path !== bwrapExecutable
  ) {
    fail(
      "LINUX_VALIDATION_PREREQUISITE_INVALID",
      "Admitted release host prerequisite set is incomplete",
    );
  }
  const inspected = await Promise.all(
    contracts.map((contract) => inspectManifestBoundTool(contract)),
  );
  return Object.freeze(Object.fromEntries(
    inspected.map((entry) => [entry.name, entry]),
  ));
}

async function inspectTrackedOnlyRepository() {
  const environment = {
    HOME: "/var/empty",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
  };
  const common = [
    "--no-replace-objects",
    "-c", "core.hooksPath=/dev/null",
    "-c", "credential.helper=",
    "-c", "protocol.file.allow=never",
    "-C", repositoryRoot,
  ];
  const [status, head, tree, tracked] = await Promise.all([
    runBounded("/usr/bin/git", [...common, "status", "--porcelain=v1", "--untracked-files=no"], {
      env: environment,
      timeout: 15_000,
    }),
    runBounded("/usr/bin/git", [...common, "rev-parse", "HEAD"], {
      env: environment,
      timeout: 15_000,
    }),
    runBounded("/usr/bin/git", [...common, "rev-parse", "HEAD^{tree}"], {
      env: environment,
      timeout: 15_000,
    }),
    runBounded("/usr/bin/git", [...common, "ls-tree", "-r", "--full-tree", "HEAD"], {
      env: environment,
      timeout: 15_000,
    }),
  ]);
  const trackedEntries = tracked.stdout ? tracked.stdout.split("\n").map((line) => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match || !match[3] || resolve(repositoryRoot, match[3]).startsWith(
      `${repositoryRoot}${sep}`,
    ) !== true) {
      fail(
        "LINUX_VALIDATION_SOURCE_UNSAFE",
        "Linux validation source contains a non-regular tracked entry",
      );
    }
    return Object.freeze({
      executable: match[1] === "100755",
      objectId: match[2],
      path: match[3],
    });
  }) : [];
  const trackedFiles = trackedEntries.map((entry) => entry.path);
  if (
    status.stdout !== "" ||
    !/^[a-f0-9]{40}$/.test(head.stdout) ||
    !/^[a-f0-9]{40}$/.test(tree.stdout) ||
    trackedFiles.length < 1 ||
    !trackedFiles.includes("scripts/run-linux-production-validation.mjs") ||
    trackedFiles.some((path) =>
      /(^|\/)(?:data|backups?|secrets?)(?:\/|$)/.test(path) ||
      /(^|\/)\.env(?:\.|$)/.test(path) && path !== ".env.example" ||
      /\.(?:db|key|p12|pem|pfx|sqlite)$/i.test(path)
    )
  ) {
    fail(
      "LINUX_VALIDATION_SOURCE_UNSAFE",
      "Linux validation requires a clean tracked-only source projection",
    );
  }
  return Object.freeze({
    commit: head.stdout,
    entries: Object.freeze(trackedEntries),
    sourceTree: tree.stdout,
    trackedFiles: trackedFiles.length,
  });
}

async function gitBlobObjectId(handle, expectedSize) {
  const hash = createHash("sha1");
  hash.update(`blob ${expectedSize.toString()}\0`, "utf8");
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
  if (BigInt(position) !== expectedSize) {
    fail(
      "LINUX_VALIDATION_SOURCE_CHANGED",
      "Tracked source projection changed while it was read",
    );
  }
  return hash.digest("hex");
}

async function removePrivateProjection(root) {
  const uid = BigInt(process.getuid());
  async function makeRemovable(path) {
    const details = await lstat(path, { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (!details) return;
    if (details.uid !== uid) {
      fail(
        "LINUX_VALIDATION_SOURCE_CLEANUP_UNKNOWN",
        "Tracked source projection ownership changed before cleanup",
      );
    }
    if (details.isDirectory() && !details.isSymbolicLink()) {
      await chmod(path, 0o700);
      for (const entry of await readdir(path)) {
        await makeRemovable(join(path, entry));
      }
      return;
    }
    if (details.isFile() && !details.isSymbolicLink()) {
      await chmod(path, 0o600);
      return;
    }
    if (!details.isSymbolicLink()) {
      fail(
        "LINUX_VALIDATION_SOURCE_CLEANUP_UNKNOWN",
        "Tracked source projection contains an unsafe cleanup entry",
      );
    }
  }
  await makeRemovable(root);
  await rm(root, { force: true, recursive: true });
  if (await lstat(root).then(() => true, (error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  })) {
    fail(
      "LINUX_VALIDATION_SOURCE_CLEANUP_UNKNOWN",
      "Tracked source projection could not be confirmed removed",
    );
  }
}

async function createTrackedSourceProjection(source) {
  const root = await mkdtemp(join(systemTemporaryRoot, "unboundry-linux-source-"));
  await chmod(root, 0o700);
  const archivePath = join(root, "source.tar");
  const projection = join(root, "source");
  await mkdir(projection, { mode: 0o700 });
  const environment = {
    HOME: "/var/empty",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
  };
  try {
    await runBounded("/usr/bin/git", [
      "--no-replace-objects",
      "-c", "core.hooksPath=/dev/null",
      "-c", "credential.helper=",
      "-c", "protocol.file.allow=never",
      "-c", "tar.umask=0077",
      "-C", repositoryRoot,
      "archive", "--format=tar", `--output=${archivePath}`, source.commit,
    ], { env: environment, timeout: 60_000 });
    await runBounded("/usr/bin/tar", [
      "--extract",
      "--file", archivePath,
      "--directory", projection,
      "--no-same-owner",
      "--no-same-permissions",
    ], { env: environment, timeout: 60_000 });
    await rm(archivePath);

    const expected = new Map(source.entries.map((entry) => [entry.path, entry]));
    const observed = [];
    const frozenEntries = [];
    async function inspectDirectory(directory, relativePath = "") {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name))) {
        const logicalPath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        const path = join(directory, entry.name);
        const details = await lstat(path, { bigint: true });
        if (details.isDirectory() && !details.isSymbolicLink()) {
          await inspectDirectory(path, logicalPath);
          await chmod(path, 0o500);
          const frozenDirectory = await lstat(path, { bigint: true });
          frozenEntries.push(Object.freeze({
            identity: fixedFileIdentity(frozenDirectory),
            kind: "directory",
            path: logicalPath,
          }));
          continue;
        }
        const contract = expected.get(logicalPath);
        if (
          !contract || !details.isFile() || details.isSymbolicLink() ||
          details.nlink !== 1n || details.uid !== BigInt(process.getuid()) ||
          (details.mode & 0o022n) !== 0n
        ) {
          fail(
            "LINUX_VALIDATION_SOURCE_UNSAFE",
            "Tracked source projection contains an unexpected entry",
          );
        }
        let handle;
        try {
          handle = await open(
            path,
            fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
          );
          const openedBefore = await handle.stat({ bigint: true });
          if (!sameFixedFileIdentity(details, openedBefore)) {
            fail(
              "LINUX_VALIDATION_SOURCE_CHANGED",
              "Tracked source projection changed before it was opened",
            );
          }
          if (await gitBlobObjectId(handle, openedBefore.size) !== contract.objectId) {
            fail(
              "LINUX_VALIDATION_SOURCE_CHANGED",
              "Tracked source projection content does not match its Git object",
            );
          }
          const openedAfter = await handle.stat({ bigint: true });
          if (!sameFixedFileIdentity(openedBefore, openedAfter)) {
            fail(
              "LINUX_VALIDATION_SOURCE_CHANGED",
              "Tracked source projection changed while it was verified",
            );
          }
        } finally {
          await handle?.close();
        }
        await chmod(path, contract.executable ? 0o500 : 0o400);
        const after = await lstat(path, { bigint: true });
        if (
          String(after.dev) !== String(details.dev) ||
          String(after.ino) !== String(details.ino) ||
          after.size !== details.size || after.uid !== details.uid ||
          Number(after.mode & 0o777n) !== (contract.executable ? 0o500 : 0o400)
        ) {
          fail(
            "LINUX_VALIDATION_SOURCE_CHANGED",
            "Tracked source projection identity changed while it was frozen",
          );
        }
        frozenEntries.push(Object.freeze({
          identity: fixedFileIdentity(after),
          kind: "file",
          objectId: contract.objectId,
          path: logicalPath,
        }));
        observed.push(logicalPath);
      }
    }
    await inspectDirectory(projection);
    await chmod(projection, 0o500);
    frozenEntries.push(Object.freeze({
      identity: fixedFileIdentity(await lstat(projection, { bigint: true })),
      kind: "directory",
      path: "",
    }));
    if (JSON.stringify(observed.sort()) !== JSON.stringify([...expected.keys()].sort())) {
      fail(
        "LINUX_VALIDATION_SOURCE_UNSAFE",
        "Tracked source projection inventory is incomplete",
      );
    }
    return Object.freeze({
      evidence: Object.freeze({
        commit: source.commit,
        sourceTree: source.sourceTree,
        trackedFiles: observed.length,
      }),
      inventory: Object.freeze(frozenEntries),
      projection,
      root,
    });
  } catch (error) {
    await removePrivateProjection(root);
    throw error;
  }
}

async function assertTrackedSourceProjectionUnchanged(projection) {
  const observed = [];
  async function visit(directory, relativePath = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name))) {
      const logicalPath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      const path = join(directory, entry.name);
      const details = await lstat(path, { bigint: true });
      observed.push({ details, logicalPath });
      if (details.isDirectory() && !details.isSymbolicLink()) {
        await visit(path, logicalPath);
      }
    }
  }
  const rootDetails = await lstat(projection.projection, { bigint: true });
  await visit(projection.projection);
  const actual = new Map([
    ["", { details: rootDetails, logicalPath: "" }],
    ...observed.map((entry) => [entry.logicalPath, entry]),
  ]);
  if (actual.size !== projection.inventory.length) {
    fail(
      "LINUX_VALIDATION_SOURCE_CHANGED",
      "Tracked source projection inventory changed during validation",
    );
  }
  for (const expected of projection.inventory) {
    const entry = actual.get(expected.path);
    if (
      !entry || JSON.stringify(fixedFileIdentity(entry.details)) !==
        JSON.stringify(expected.identity) ||
      (expected.kind === "directory") !== entry.details.isDirectory() ||
      (expected.kind === "file") !== entry.details.isFile() ||
      entry.details.isSymbolicLink()
    ) {
      fail(
        "LINUX_VALIDATION_SOURCE_CHANGED",
        "Tracked source projection identity changed during validation",
      );
    }
    if (expected.kind === "file") {
      let handle;
      try {
        handle = await open(
          join(projection.projection, expected.path),
          fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
        );
        if (await gitBlobObjectId(handle, entry.details.size) !== expected.objectId) {
          fail(
            "LINUX_VALIDATION_SOURCE_CHANGED",
            "Tracked source projection content changed during validation",
          );
        }
      } finally {
        await handle?.close();
      }
    }
  }
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupGone(processGroupId, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return true;
}

async function terminateProcessGroup(processGroupId) {
  if (!processGroupExists(processGroupId)) {
    return Object.freeze({ forced: false, signalled: false });
  }
  signalProcessGroup(processGroupId, "SIGTERM");
  if (await waitForProcessGroupGone(processGroupId, 2_000)) {
    return Object.freeze({ forced: false, signalled: true });
  }
  signalProcessGroup(processGroupId, "SIGKILL");
  if (!await waitForProcessGroupGone(processGroupId, 2_000)) {
    fail(
      "LINUX_VALIDATION_PROCESS_GROUP_CLEANUP_UNKNOWN",
      "Linux validation child process group could not be confirmed stopped",
    );
  }
  return Object.freeze({ forced: true, signalled: true });
}

async function runBounded(command, arguments_, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let bytes = 0;
    const stdout = [];
    const stderr = [];
    let timer;
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? repositoryRoot,
      detached: true,
      env: options.env,
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    });
    const processGroupId = child.pid;
    const finish = async ({ code = null, error, reason, signal = null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      try {
        if (processGroupId && processGroupExists(processGroupId)) {
          await terminateProcessGroup(processGroupId);
          if (reason === "close" && code === 0 && signal === null) {
            fail(
              "LINUX_VALIDATION_CHILD_PROCESS_LEAKED",
              "Linux validation child exited while its process group remained active",
            );
          }
        }
      } catch (cleanupError) {
        rejectPromise(cleanupError);
        return;
      }
      if (error) {
        rejectPromise(error);
        return;
      }
      if (reason !== "close" || code !== 0 || signal !== null) {
        rejectPromise(new ValidationError(
          reason === "timeout"
            ? "LINUX_VALIDATION_TIMEOUT"
            : reason === "output-limit"
              ? "LINUX_VALIDATION_OUTPUT_LIMIT"
              : "LINUX_VALIDATION_CHILD_FAILED",
          JSON.stringify({
            code,
            error: errorOutput.slice(-8_000),
            signal,
            stdout: output.slice(-8_000),
          }),
        ));
        return;
      }
      resolvePromise(Object.freeze({ stderr: errorOutput, stdout: output }));
    };
    timer = setTimeout(() => {
      void finish({ reason: "timeout" });
    }, options.timeout ?? 30 * 60_000);
    const collect = (target) => (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maximumOutputBytes) {
        void finish({ reason: "output-limit" });
      } else {
        target.push(Buffer.from(chunk));
      }
    };
    child.stdout?.on("data", collect(stdout));
    child.stderr?.on("data", collect(stderr));
    child.once("error", (error) => {
      void finish({ error, reason: "error" });
    });
    child.once("close", (code, signal) => {
      void finish({ code, reason: "close", signal });
    });
  });
}

function shortPcmWavFixture() {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function createKeys() {
  return Object.freeze({
    recovery: generateKeyPairSync("rsa", {
      modulusLength: 3_072,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    }),
    signing: generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    }),
  });
}

function encryptedDocument(key, aad, document) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(document), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: 1,
  });
}

function encryptedCredential(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(accountCredentialAad);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join("$");
}

async function syntheticPasswordHash(password) {
  const salt = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
  const key = await new Promise((resolveKey, rejectKey) => {
    deriveScrypt(password, salt, 64, { N: 16_384, p: 1, r: 8 }, (error, value) => {
      if (error) rejectKey(error);
      else resolveKey(value);
    });
  });
  try {
    return `scrypt$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
  } finally {
    key.fill(0);
  }
}

async function createFixture(caseRoot) {
  const [
    { applyPendingSchemaMigrationsInTransaction },
    { inspectLockedBackupDatabase },
  ] = await Promise.all([
    import("../server/database.ts"),
    import("../server/backupInspection.ts"),
  ]);
  const root = join(caseRoot, "fixture");
  const dataDirectory = join(root, "data");
  const backupRoot = join(root, "backups");
  const scratchRoot = join(root, "scratch");
  const targetDirectory = join(root, "restored");
  const fakeOssTarget = join(root, "fake-oss-recovery");
  const keysRoot = join(root, "keys");
  const mirrorRoot = join(root, "mirror");
  const mediaRoot = join(dataDirectory, "media");
  const secretsRoot = join(dataDirectory, "secrets");
  for (const directory of [
    root,
    dataDirectory,
    backupRoot,
    scratchRoot,
    keysRoot,
    mirrorRoot,
    mediaRoot,
    secretsRoot,
  ]) {
    await mkdir(directory, { mode: 0o700 });
    await chmod(directory, 0o700);
  }

  const lockPath = join(secretsRoot, "provider-profile-write-lock.sqlite");
  const secretLock = new DatabaseSync(lockPath);
  secretLock.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE provider_profile_write_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      marker INTEGER NOT NULL
    );
    INSERT INTO provider_profile_write_lock (id, marker) VALUES (1, 1);
  `);
  secretLock.close();
  await chmod(lockPath, 0o600);

  const storageProfileId = "linux-validation-storage";
  const providerProfileId = "linux-validation-provider";
  const masterKey = randomBytes(32);
  const masterKeyPath = join(secretsRoot, "config-master.key");
  const accountEncryptedKey = encryptedCredential(
    masterKey,
    "synthetic-offline-provider-key",
  );
  try {
    await Promise.all([
      writeFile(masterKeyPath, masterKey, { mode: 0o600 }),
      writeFile(
        join(secretsRoot, "provider-profiles.enc.json"),
        encryptedDocument(masterKey, providerDocumentAad, {
          profiles: [{
            baseUrl: "https://openrouter.ai/api/v1",
            configurationVersion: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            driver: "openrouter",
            id: providerProfileId,
            label: "Linux validation Provider",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }],
          version: 1,
        }),
        { mode: 0o600 },
      ),
      writeFile(
        join(secretsRoot, "storage-profiles.enc.json"),
        encryptedDocument(masterKey, storageDocumentAad, {
          activeProfileId: storageProfileId,
          mediaRoutingEnabled: false,
          profiles: [{
            accessKeyId: "synthetic-storage-access-key",
            accessKeySecret: "synthetic-storage-secret",
            bucket: "synthetic-private-bucket",
            createdAt: "2026-01-01T00:00:00.000Z",
            endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
            id: storageProfileId,
            label: "Linux validation storage",
            provider: "aliyun-oss",
            region: "oss-cn-hangzhou",
            status: "active",
            lastVerifiedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }],
          version: 1,
        }),
        { mode: 0o600 },
      ),
    ]);
  } finally {
    masterKey.fill(0);
  }

  const imageName = "linux-validation-image.png";
  const audioName = "linux-validation-audio.wav";
  const objectFileName = "00000000-0000-4000-8000-000000000001.png";
  const objectKey = `objects/2026/01/image/${objectFileName}`;
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const audioBytes = shortPcmWavFixture();
  const mirrorBytes = Buffer.from(imageBytes);
  const mirrorPath = join(mirrorRoot, "oss-image.png");
  await Promise.all([
    writeFile(join(mediaRoot, imageName), imageBytes, { mode: 0o600 }),
    writeFile(join(mediaRoot, audioName), audioBytes, { mode: 0o600 }),
    writeFile(mirrorPath, mirrorBytes, { mode: 0o600 }),
  ]);

  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const database = new DatabaseSync(databasePath);
  let inspection;
  const timestamp = "2026-01-01T00:00:00.000Z";
  const frozenAt = "2026-01-01T00:02:00.000Z";
  const passwordHash = await syntheticPasswordHash("linux-validation-password");
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
      BEGIN IMMEDIATE;
    `);
    applyPendingSchemaMigrationsInTransaction(database, {
      appliedAt: () => timestamp,
      sourceVersion: 0,
      targetVersion: 37,
    });
    database.prepare(`
      UPDATE generation_safety_settings SET updated_at = ? WHERE id = 1
    `).run(timestamp);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)
    `).run(
      "linux-validation-user",
      "linux-validation",
      "Linux Validation User",
      passwordHash,
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, expires_at, created_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "linux-validation-session",
      sha256("linux-validation-session-token"),
      "linux-validation-user",
      "2030-01-01T00:00:00.000Z",
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at,
        provider_configuration_version
      ) VALUES (?, ?, 'openrouter', 'disabled', ?, ?, 1)
    `).run(
      providerProfileId,
      "Linux validation Provider",
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO account_provider_credentials (
        account_id, provider_profile_id, encrypted_key, key_status,
        credential_version, updated_at
      ) VALUES (?, ?, ?, 'unchecked', 1, ?)
    `).run(
      "linux-validation-user",
      providerProfileId,
      accountEncryptedKey,
      timestamp,
    );
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at
      ) VALUES (?, ?, ?, ?, 1, ?)
    `).run(
      "linux-validation-user",
      "linux-validation-project",
      "Linux Validation Project",
      Date.parse(timestamp),
      Date.parse(timestamp),
    );
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, 1, 1, ?, '[]', ?, ?, ?, 1)
    `).run(
      "linux-validation-user",
      "linux-validation-project",
      JSON.stringify([{
        data: { label: "Linux validation node" },
        id: "linux-validation-node",
        position: { x: 10, y: 20 },
        type: "text",
      }]),
      JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      timestamp,
      "linux-validation-save-session",
    );
    const insertMedia = database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height, storage_profile_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?
      )
    `);
    insertMedia.run(
      "image",
      "linux-validation-local-image",
      "linux-validation-user",
      imageName,
      imageBytes.length,
      timestamp,
      timestamp,
      "local",
      imageName,
      "image/png",
      sha256(imageBytes),
      null,
      null,
      "not-applicable",
      1,
      1,
      null,
    );
    insertMedia.run(
      "audio",
      "linux-validation-local-audio",
      "linux-validation-user",
      audioName,
      audioBytes.length,
      timestamp,
      timestamp,
      "local",
      audioName,
      "audio/wav",
      sha256(audioBytes),
      null,
      null,
      "pending",
      null,
      null,
      null,
    );
    insertMedia.run(
      "image",
      "linux-validation-oss-image",
      "linux-validation-user",
      objectFileName,
      mirrorBytes.length,
      timestamp,
      timestamp,
      "oss",
      objectKey,
      "image/png",
      sha256(mirrorBytes),
      null,
      null,
      "not-applicable",
      1,
      1,
      storageProfileId,
    );
    const safetyBeforeRow = database.prepare(`
      SELECT
        global_enabled, emergency_stop, per_user_concurrency,
        requests_per_minute, text_concurrency, image_concurrency,
        video_concurrency, audio_concurrency, failure_threshold,
        cooldown_minutes, running_task_policy, updated_at
      FROM generation_safety_settings
      WHERE id = 1
    `).get();
    const safetyDocument = (row) => ({
      audioConcurrency: Number(row.audio_concurrency),
      cooldownMinutes: Number(row.cooldown_minutes),
      emergencyStop: Boolean(row.emergency_stop),
      failureThreshold: Number(row.failure_threshold),
      globalEnabled: Boolean(row.global_enabled),
      imageConcurrency: Number(row.image_concurrency),
      perUserConcurrency: Number(row.per_user_concurrency),
      requestsPerMinute: Number(row.requests_per_minute),
      runningTaskPolicy: row.running_task_policy,
      textConcurrency: Number(row.text_concurrency),
      updatedAt: row.updated_at,
      videoConcurrency: Number(row.video_concurrency),
    });
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 0, emergency_stop = 1, updated_at = ?
      WHERE id = 1
    `).run(frozenAt);
    const safetyAfterRow = database.prepare(`
      SELECT
        global_enabled, emergency_stop, per_user_concurrency,
        requests_per_minute, text_concurrency, image_concurrency,
        video_concurrency, audio_concurrency, failure_threshold,
        cooldown_minutes, running_task_policy, updated_at
      FROM generation_safety_settings
      WHERE id = 1
    `).get();
    database.prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, details, created_at
      ) VALUES (?, 'generation_safety.update', ?, ?)
    `).run(
      "linux-validation-user",
      JSON.stringify({
        after: safetyDocument(safetyAfterRow),
        before: safetyDocument(safetyBeforeRow),
      }),
      frozenAt,
    );
    database.exec("COMMIT; BEGIN IMMEDIATE");
    inspection = inspectLockedBackupDatabase(database, dataDirectory);
    database.exec("ROLLBACK");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    throw error;
  }
  await chmod(databasePath, 0o600);

  const keys = createKeys();
  const keyPaths = Object.freeze({
    recoveryPrivate: join(keysRoot, "recovery-private.pem"),
    recoveryPublic: join(keysRoot, "recovery-public.pem"),
    signingPrivate: join(keysRoot, "signing-private.pem"),
    signingPublic: join(keysRoot, "signing-public.pem"),
  });
  await Promise.all([
    writeFile(keyPaths.recoveryPrivate, keys.recovery.privateKey, { mode: 0o600 }),
    writeFile(keyPaths.recoveryPublic, keys.recovery.publicKey, { mode: 0o600 }),
    writeFile(keyPaths.signingPrivate, keys.signing.privateKey, { mode: 0o600 }),
    writeFile(keyPaths.signingPublic, keys.signing.publicKey, { mode: 0o600 }),
  ]);
  if (inspection.userVersion !== 37) {
    database.close();
    fail("LINUX_VALIDATION_FIXTURE_INVALID", "Synthetic fixture is not exact schema 37");
  }
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const [walDetails, shmDetails, walBytes] = await Promise.all([
    lstat(walPath, { bigint: true }).catch(() => undefined),
    lstat(shmPath, { bigint: true }).catch(() => undefined),
    readFile(walPath).catch(() => undefined),
  ]);
  if (
    !walDetails?.isFile() || walDetails.isSymbolicLink() ||
    walDetails.nlink !== 1n || walDetails.uid !== BigInt(process.getuid()) ||
    walDetails.size <= 32n || !shmDetails?.isFile() ||
    shmDetails.isSymbolicLink() || shmDetails.nlink !== 1n ||
    shmDetails.uid !== BigInt(process.getuid()) || shmDetails.size < 32_768n ||
    !walBytes ||
    BigInt(walBytes.length) !== walDetails.size
  ) {
    database.close();
    fail(
      "LINUX_VALIDATION_FIXTURE_INVALID",
      "Synthetic fixture did not retain a committed private WAL and SHM pair",
    );
  }
  return Object.freeze({
    backupRoot,
    dataDirectory,
    expectedLogicalSha256: inspection.logicalSha256,
    fakeOssTarget,
    frozenAt,
    imageSha256: sha256(imageBytes),
    keyPaths,
    mirrorSha256: sha256(mirrorBytes),
    mirrorPath,
    objectKey,
    providerProfileId,
    sourceJournalMode: inspection.journalMode,
    sourceDatabase: database,
    sourceSidecars: Object.freeze({
      committedWalBytes: walBytes.length,
      committedWalSha256: sha256(walBytes),
      shmDev: String(shmDetails.dev),
      shmIno: String(shmDetails.ino),
      shmBytes: Number(shmDetails.size),
      shmPresent: true,
      walDev: String(walDetails.dev),
      walIno: String(walDetails.ino),
      walPresent: true,
    }),
    scratchRoot,
    storageProfileId,
    targetDirectory,
  });
}

async function revalidateSourceSidecars(fixture) {
  const walPath = join(fixture.dataDirectory, "unboundry.sqlite-wal");
  const shmPath = join(fixture.dataDirectory, "unboundry.sqlite-shm");
  const [walDetails, shmDetails, walBytes] = await Promise.all([
    lstat(walPath, { bigint: true }).catch(() => undefined),
    lstat(shmPath, { bigint: true }).catch(() => undefined),
    readFile(walPath).catch(() => undefined),
  ]);
  const evidence = fixture.sourceSidecars;
  if (
    !walDetails?.isFile() || walDetails.isSymbolicLink() ||
    String(walDetails.dev) !== evidence.walDev ||
    String(walDetails.ino) !== evidence.walIno ||
    walDetails.nlink !== 1n || walDetails.uid !== BigInt(process.getuid()) ||
    Number(walDetails.size) !== evidence.committedWalBytes ||
    !walBytes || sha256(walBytes) !== evidence.committedWalSha256 ||
    !shmDetails?.isFile() || shmDetails.isSymbolicLink() ||
    String(shmDetails.dev) !== evidence.shmDev ||
    String(shmDetails.ino) !== evidence.shmIno ||
    shmDetails.nlink !== 1n || shmDetails.uid !== BigInt(process.getuid()) ||
    Number(shmDetails.size) !== evidence.shmBytes || evidence.shmBytes < 32_768
  ) {
    fail(
      "LINUX_VALIDATION_SOURCE_SIDECAR_CHANGED",
      "Synthetic committed WAL and SHM evidence changed during capture",
    );
  }
  return true;
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function fixtureReceiptEvidence(fixture) {
  return Object.freeze({
    backupRoot: fixture.backupRoot,
    expectedLogicalSha256: fixture.expectedLogicalSha256,
    fakeOssTarget: fixture.fakeOssTarget,
    mirrorSha256: fixture.mirrorSha256,
    objectKey: fixture.objectKey,
    sourceJournalMode: fixture.sourceJournalMode,
    sourceSidecars: fixture.sourceSidecars,
    storageProfileId: fixture.storageProfileId,
    targetDirectory: fixture.targetDirectory,
  });
}

function sameJson(left, right) {
  function canonical(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(canonical);
    return Object.fromEntries(
      Object.entries(value).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey)).map(([key, entry]) => [
        key,
        canonical(entry),
      ]),
    );
  }
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function expectedReleaseEvidence(release) {
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

function assertPackageSummary(summary, receipt, fixture) {
  const expectedPackageDirectory = join(
    fixture.backupRoot,
    `${receipt.backup.backupId}.ubbackup`,
  );
  const expectedIntegrity = Object.freeze({
    backupBlockingIssues: 0,
    clean: false,
    evidenceSha256: receipt.report.evidenceSha256,
    issues: 1,
    sha256: receipt.report.sha256,
  });
  if (
    summary?.backupId !== receipt.backup.backupId ||
    summary?.captureMode !== "locked-exact" ||
    summary?.databaseLogicalSha256 !== fixture.expectedLogicalSha256 ||
    summary?.finalCandidate !== true || summary?.mediaFiles !== 2 ||
    summary?.ossMirrors !== 1 || summary?.packageDirectory !== expectedPackageDirectory ||
    summary?.schemaVersion !== 37 || summary?.secretFiles !== 3 ||
    !sameJson(summary?.mediaIntegrity, expectedIntegrity)
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production backup package summary is incomplete",
    );
  }
}

function assertRuntimePhase(phase, contract, fixture, pair, linuxSandbox) {
  const release = contract.role === "bridge" ? pair.bridge : pair.final;
  const expectedStatic = contract.schemaVersion === 37
    ? release.manifest.runtime.health.legacySchema37StaticAsset
    : release.manifest.runtime.health.staticAsset;
  const expectedReadiness = Object.freeze({
    databaseProbe: "read-only",
    mode: contract.schemaVersion === 37 ? "schema37-bridge-active" : "active",
    mutationsAccepted: true,
    schemaVersion: contract.schemaVersion,
    status: "ready",
  });
  if (
    phase?.releaseId !== release.releaseId ||
    phase?.releaseRole !== contract.role || phase?.version !== release.version ||
    !sameJson(phase?.readiness, expectedReadiness) ||
    phase?.servedStaticAssetSha256 !== expectedStatic.sha256 ||
    phase?.listenerReleased !== true || !Number.isInteger(phase?.listenerPort) ||
    phase.listenerPort < 1 || phase.listenerPort > 65_535 ||
    phase.listenerPort === 4_173 || phase?.shutdown !== "graceful" ||
    phase?.externalNetworkAttempts !== null ||
    phase?.externalNetworkSuccesses !== 0 ||
    phase?.instrumentation !== "linux-bwrap-network-namespace" ||
    phase?.networkAttemptCounting !== "not-instrumented" ||
    phase?.providerRequests !== null || phase?.ossRequests !== null ||
    phase?.guardLoads !== 0 || phase?.deniedWildcardBindProbes !== null ||
    !sameJson(phase?.linuxSandbox, linuxSandbox) ||
    !sameJson(phase?.authStatus, {
      authenticated: false,
      bootstrapRequired: false,
    })
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production runtime phase identity or network evidence is incomplete",
    );
  }
  if (contract.schemaVersion === 41 && (
    phase?.accountProviderCredentialsTotal !== 1 ||
    phase?.accountProviderCredentialEpochsTotal !== 1 ||
    phase?.accountProviderCredentialEpochsAligned !== 1 ||
    phase?.activeGenerationTasks !== 0 || phase?.canvasDocumentsRead !== 1 ||
    phase?.generationTasksTotal !== 0 ||
    phase?.generationProviderAttemptsTotal !== 0 ||
    phase?.ordinaryDatabaseOpen !== true ||
    phase?.readyLegacyDurationAssets !== 1 || phase?.sessionRowsRead !== 1 ||
    phase?.startupMediaRecoveryCandidates !== 0 || phase?.localMediaRead !== 1 ||
    phase?.localMediaBytesRead !== 1_644
  )) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production schema-41 runtime data evidence is incomplete",
    );
  }
  if (contract.schemaVersion === 37) {
    const metadata = phase?.legacyMetadataBackfill;
    const counts = Object.freeze({ failed: 0, pending: 1, ready: 0, total: 1 });
    if (
      !sameJson(metadata?.durationBefore && {
        failed: metadata.durationBefore.failed,
        pending: metadata.durationBefore.pending,
        ready: metadata.durationBefore.ready,
        total: metadata.durationBefore.total,
      }, counts) ||
      !sameJson(metadata?.durationAfter && {
        failed: metadata.durationAfter.failed,
        pending: metadata.durationAfter.pending,
        ready: metadata.durationAfter.ready,
        total: metadata.durationAfter.total,
      }, counts) ||
      metadata?.durationAfter?.sha256 !== metadata?.durationBefore?.sha256 ||
      metadata?.logicalSha256Before !== fixture.expectedLogicalSha256 ||
      metadata?.logicalSha256After !== fixture.expectedLogicalSha256 ||
      !validSha256(metadata?.invariantSha256) ||
      metadata?.metadataChanged !== false
    ) {
      fail(
        "LINUX_VALIDATION_RECEIPT_INVALID",
        "Production bridge schema-37 backfill evidence is incomplete",
      );
    }
  }
}

async function validateProductionReceipt(receipt, fixture, pair) {
  const expectedCounts = Object.freeze({
    accountDeleteIntents: 0,
    activeDeleteIntents: 0,
    activePublicationAttempts: 0,
    assets: 3,
    backupBlockingIssues: 0,
    failed: 0,
    failedDeleteIntents: 0,
    files: 2,
    issues: 1,
    ossEvidence: 1,
    pending: 0,
    publicationAttempts: 0,
    ready: 3,
  });
  const expectedIssue = Object.freeze({
    assetId: "linux-validation-local-audio",
    backupBlocking: false,
    code: "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
    kind: "audio",
    severity: "warning",
    state: "ready",
    storageBackend: "local",
  });
  if (
    receipt?.format !== "unboundry-final-candidate-backup" ||
    receipt?.version !== 1 || receipt?.expectedSchemaVersion !== 37 ||
    receipt?.expectedDatabaseLogicalSha256 !== fixture.expectedLogicalSha256 ||
    receipt?.targetDirectory !== fixture.targetDirectory ||
    receipt?.releaseRelationship !== null ||
    !sameJson(receipt?.releaseEvidence?.bridge, expectedReleaseEvidence(pair.bridge)) ||
    !sameJson(receipt?.releaseEvidence?.final, expectedReleaseEvidence(pair.final)) ||
    receipt?.report?.version !== 1 || receipt?.report?.schemaVersion !== 37 ||
    receipt?.report?.databaseLogicalSha256 !== fixture.expectedLogicalSha256 ||
    receipt?.report?.captureMode !== "locked-exact" ||
    receipt?.report?.finalCandidate !== true || receipt?.report?.backupComplete !== true ||
    receipt?.report?.clean !== false ||
    !sameJson(receipt?.report?.counts, expectedCounts) ||
    !sameJson(receipt?.report?.issues, [expectedIssue]) ||
    !validSha256(receipt?.report?.sha256) ||
    !validSha256(receipt?.report?.evidenceSha256) ||
    !/^[0-9a-f-]{36}$/.test(String(receipt?.backup?.backupId ?? ""))
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production final-candidate receipt source evidence is incomplete",
    );
  }
  assertPackageSummary(receipt.backup, receipt, fixture);
  assertPackageSummary(receipt.verified, receipt, fixture);
  assertPackageSummary(receipt.restored, receipt, fixture);
  if (!sameJson(receipt?.restoredSecretValidation, {
    accountCredentials: 1,
    masterKeyPresent: true,
    providerDocumentProfiles: 1,
    storageDocumentProfiles: 1,
  })) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production restored secret evidence is incomplete",
    );
  }

  const fakeObject = receipt?.fakeOssRecovery?.objects?.[0];
  const expectedObjectId = sha256(JSON.stringify({
    format: "unboundry-fake-oss-object",
    objectKey: fixture.objectKey,
    version: 1,
    versionId: "linux-validation-v1",
  }));
  const expectedObjectFile = join(
    fixture.fakeOssTarget,
    "objects",
    `${expectedObjectId}.bin`,
  );
  const expectedMetadataFile = join(
    fixture.fakeOssTarget,
    "objects",
    `${expectedObjectId}.json`,
  );
  if (
    receipt?.fakeOssRecovery?.backupId !== receipt.backup.backupId ||
    receipt?.fakeOssRecovery?.databaseLogicalSha256 !== fixture.expectedLogicalSha256 ||
    receipt?.fakeOssRecovery?.targetDirectory !== fixture.fakeOssTarget ||
    !validSha256(receipt?.fakeOssRecovery?.entriesSha256) ||
    receipt?.fakeOssRecovery?.objects?.length !== 1 ||
    fakeObject?.byteSize !== 70 || fakeObject?.checksumSha256 !== fixture.mirrorSha256 ||
    fakeObject?.objectKey !== fixture.objectKey ||
    fakeObject?.storageProfileId !== fixture.storageProfileId ||
    fakeObject?.versionId !== "linux-validation-v1" ||
    fakeObject?.objectId !== expectedObjectId ||
    fakeObject?.objectFile !== expectedObjectFile ||
    fakeObject?.metadataFile !== expectedMetadataFile ||
    sha256(await readFile(expectedObjectFile)) !== fixture.mirrorSha256
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production fake OSS recovery evidence is incomplete",
    );
  }

  const dryRun = receipt?.migrationDryRun;
  const applied = receipt?.migrationApplied;
  const bridge37Hash = receipt?.startupValidation?.postBridge37LogicalSha256;
  const ffprobe = pair.bridge.manifest.hostPrerequisites.executables.find(
    (entry) => entry.name === "ffprobe",
  );
  if (
    dryRun?.ok !== true || dryRun?.mode !== "dry-run" || dryRun?.status !== "ready" ||
    dryRun?.sourceVersion !== 37 || dryRun?.targetVersion !== 41 ||
    dryRun?.expectedSourceLogicalSha256 !== bridge37Hash ||
    dryRun?.backfilledChecksums !== 0 || dryRun?.backfilledDurations !== 0 ||
    dryRun?.nativeDurationProbes !== 0 || dryRun?.drainMilliseconds !== 60_000 ||
    dryRun?.targetLogicalSha256 !== null ||
    applied?.ok !== true || applied?.mode !== "apply" || applied?.status !== "complete" ||
    applied?.sourceVersion !== 37 || applied?.targetVersion !== 41 ||
    bridge37Hash !== fixture.expectedLogicalSha256 ||
    applied?.expectedSourceLogicalSha256 !== bridge37Hash ||
    applied?.backfilledChecksums !== 0 || applied?.backfilledDurations !== 1 ||
    applied?.nativeDurationProbes !== 2 || applied?.drainMilliseconds !== 60_000 ||
    !validSha256(applied?.targetLogicalSha256) ||
    receipt?.migrationInspection?.userVersion !== 41 ||
    receipt?.migrationInspection?.logicalSha256 !== applied.targetLogicalSha256 ||
    receipt?.migrationInspection?.foreignKeyViolations !== 0 ||
    receipt?.migrationInspection?.integrityCheck !== "ok" ||
    receipt?.migrationInspection?.journalMode !== "wal" ||
    receipt?.migrationNativeAudit?.argumentContractSha256 !== null ||
    receipt?.migrationNativeAudit?.durationProbeExecutable !== "/usr/bin/ffprobe" ||
    receipt?.migrationNativeAudit?.durationProbeExecutableSha256 !== ffprobe?.sha256 ||
    receipt?.migrationNativeAudit?.durationProbeMode !== "release-bound-production-path" ||
    receipt?.migrationNativeAudit?.externalNetworkAttempts !== null ||
    receipt?.migrationNativeAudit?.externalNetworkSuccesses !== 0 ||
    receipt?.migrationNativeAudit?.nativeDurationProbes !== 2 ||
    receipt?.migrationNativeAudit?.networkAttemptCounting !== "not-instrumented" ||
    receipt?.migrationNativeAudit?.realDrainClock !== true ||
    receipt?.migrationNativeAudit?.testClockUsed !== false ||
    receipt?.migrationNativeAudit?.testDurationProbeUsed !== false ||
    receipt?.migrationNativeAudit?.sha256 !== applied.nativeDurationProbeAuditSha256
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production schema migration evidence is incomplete",
    );
  }
  const nativeSandbox = receipt.migrationNativeAudit.nativeSandbox;
  if (
    nativeSandbox?.denyNetwork !== true ||
    nativeSandbox?.deniedSocketScope !==
      "isolated-network-namespace-no-usable-external-route" ||
    nativeSandbox?.enforcementMode !== "linux-bwrap-inherited-v1" ||
    nativeSandbox?.migrationChildren !== 2 ||
    nativeSandbox?.processTreeEnforced !== true ||
    nativeSandbox?.profileApplied !== false || nativeSandbox?.profileSha256 !== null ||
    nativeSandbox?.selfTestDenied !== true ||
    nativeSandbox?.selfTestSocketAttempts !== 1 ||
    nativeSandbox?.linuxSandboxIdentityBound !== true
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production migration sandbox evidence is incomplete",
    );
  }

  const phaseContracts = [
    ["bridgeSchema37", { role: "bridge", schemaVersion: 37 }],
    ["bridgeSchema39", { role: "bridge", schemaVersion: 41 }],
    ["finalSchema39", { role: "final", schemaVersion: 41 }],
    ["bridgeRollback", { role: "bridge", schemaVersion: 41 }],
    ["finalReswitch", { role: "final", schemaVersion: 41 }],
  ];
  const expectedSequence = [
    { releaseRole: "bridge", schemaVersion: 37 },
    { releaseRole: "bridge", schemaVersion: 41 },
    { releaseRole: "final", schemaVersion: 41 },
    { operation: "rollback", releaseRole: "bridge", schemaVersion: 41 },
    { operation: "reswitch", releaseRole: "final", schemaVersion: 41 },
  ];
  if (!sameJson(receipt?.startupValidation?.runtimeSequence, expectedSequence)) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production runtime sequence is incomplete",
    );
  }
  for (const [name, contract] of phaseContracts) {
    assertRuntimePhase(
      receipt.startupValidation[name],
      contract,
      fixture,
      pair,
      receipt.migrationNativeAudit.nativeSandbox.linuxSandbox,
    );
  }
  if (
    receipt.startupValidation.postBridge37LogicalSha256 !==
      receipt.startupValidation.bridgeSchema37.legacyMetadataBackfill.logicalSha256After ||
    receipt.startupValidation.targetLogicalSha256 !== applied.targetLogicalSha256 ||
    receipt.startupValidation.finalSchema39.restoredStateSha256 !==
      receipt.startupValidation.bridgeSchema39.restoredStateSha256 ||
    receipt.startupValidation.bridgeRollback.restoredStateSha256 !==
      receipt.startupValidation.bridgeSchema39.restoredStateSha256 ||
    receipt.startupValidation.finalReswitch.restoredStateSha256 !==
      receipt.startupValidation.bridgeSchema39.restoredStateSha256
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production runtime database hashes do not bind one migrated target",
    );
  }
  const execution = receipt?.productionLinuxExecution;
  if (
    execution?.allHostPrerequisitesActuallyExecuted !== false ||
    execution?.bridgeRollbackRuntimeActuallyExecuted !== true ||
    execution?.finalReswitchRuntimeActuallyExecuted !== true ||
    !sameJson(execution?.hostPrerequisitesActuallyExecuted, {
      bwrap: true,
      ffmpeg: false,
      ffprobe: true,
      node: true,
    }) ||
    execution?.migrationActuallyExecuted !== true ||
    execution?.networkNamespaceActuallyExecuted !== true ||
    execution?.productRuntimeActuallyExecuted !== true ||
    execution?.nginxActuallyExecuted !== false ||
    execution?.systemdActuallyExecuted !== false
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Production Linux execution disclosure is incomplete",
    );
  }
  return Object.freeze({
    migrationActuallyExecuted: true,
    productRuntimeActuallyExecuted: true,
    successfulExternalEgress: 0,
    targetLogicalSha256: applied.targetLogicalSha256,
  });
}

async function inspectMigratedFixture(fixture, targetLogicalSha256) {
  const { inspectLockedBackupDatabase } = await import(
    "../server/backupInspection.ts"
  );
  const databasePath = join(fixture.targetDirectory, "unboundry.sqlite");
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    const independentInspection = inspectLockedBackupDatabase(
      database,
      fixture.targetDirectory,
    );
    const scalar = (sql, ...parameters) => database.prepare(sql).get(...parameters);
    const userVersion = Number(scalar("PRAGMA user_version")?.user_version);
    const integrity = scalar("PRAGMA integrity_check")?.integrity_check;
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    const duration = scalar(`
      SELECT duration_seconds, duration_source, duration_status
      FROM media_assets WHERE id = 'linux-validation-local-audio'
    `);
    const epoch = scalar(`
      SELECT account_id, provider_profile_id, credential_revision
      FROM account_provider_credential_epochs
      WHERE account_id = 'linux-validation-user'
        AND provider_profile_id = 'linux-validation-provider'
    `);
    const ledgers = scalar(`
      SELECT
        (SELECT COUNT(*) FROM generation_tasks) AS tasks,
        (SELECT COUNT(*) FROM generation_provider_attempts) AS attempts
    `);
    if (
      userVersion !== 41 || integrity !== "ok" || foreignKeys.length !== 0 ||
      duration?.duration_status !== "ready" ||
      duration?.duration_source !== "server-probe" ||
      !Number.isFinite(Number(duration?.duration_seconds)) ||
      Math.abs(Number(duration.duration_seconds) - 0.1) > 0.02 ||
      epoch?.account_id !== "linux-validation-user" ||
      epoch?.provider_profile_id !== "linux-validation-provider" ||
      Number(epoch?.credential_revision) !== 1 ||
      Number(ledgers?.tasks) !== 0 || Number(ledgers?.attempts) !== 0 ||
      !validSha256(targetLogicalSha256) ||
      independentInspection.logicalSha256 !== targetLogicalSha256 ||
      independentInspection.userVersion !== 41 ||
      independentInspection.integrityCheck !== "ok" ||
      independentInspection.foreignKeyViolations !== 0
    ) {
      fail(
        "LINUX_VALIDATION_MIGRATED_FIXTURE_INVALID",
        "Production migrated fixture state is incomplete",
      );
    }
    return Object.freeze({
      accountCredentialEpochRevision: 1,
      durationSeconds: Number(duration.duration_seconds),
      durationSource: duration.duration_source,
      durationStatus: duration.duration_status,
      foreignKeyViolations: 0,
      generationProviderAttempts: 0,
      generationTasks: 0,
      integrityCheck: "ok",
      logicalSha256: independentInspection.logicalSha256,
      userVersion,
    });
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
}

async function validateInnerReceiptDocument(
  document,
  pair,
  approvalSha256,
  driverSha256,
  expectedHostNamespaceSha256,
) {
  const expectedLimitations = [
    "nginx-not-executed",
    "systemd-not-executed",
    "production-current-pointer-not-switched",
    "production-data-not-inspected",
  ];
  const expectedCapabilitySets = ["CapAmb", "CapBnd", "CapEff", "CapInh", "CapPrm"];
  const capabilitySets = document?.sandbox?.capabilities?.sets;
  const nestedLinuxSandbox =
    document?.result?.migrationNativeAudit?.nativeSandbox?.linuxSandbox;
  const comparableSandboxEnvelope = (sandbox) => sandbox && Object.freeze({
    capabilities: sandbox.capabilities,
    contract: sandbox.contract,
    enforcementMode: sandbox.enforcementMode,
    external: sandbox.external,
    interfaces: sandbox.interfaces,
    loopback: sandbox.loopback,
    namespaces: sandbox.namespaces && Object.freeze({
      distinct: sandbox.namespaces.distinct,
      hostEvidenceSha256: sandbox.namespaces.hostEvidenceSha256,
      network: sandbox.namespaces.network,
      process: sandbox.namespaces.process && Object.freeze({
        current: sandbox.namespaces.process.current,
        distinct: sandbox.namespaces.process.distinct,
        host: sandbox.namespaces.process.host,
        hostEvidence: sandbox.namespaces.process.hostEvidence,
      }),
    }),
    processTreeEnforced: sandbox.processTreeEnforced,
    routes: sandbox.routes,
    sentinelSha256: sandbox.sentinelSha256,
  });
  if (
    document?.format !== "unboundry-linux-production-validation-inner" ||
    document?.version !== 1 ||
    document?.driver !== "unboundry-linux-production-validation-v1" ||
    document?.driverSha256 !== driverSha256 ||
    document?.approvalSha256 !== approvalSha256 ||
    document?.artifactMigrationActuallyExecuted !== true ||
    document?.bridgeSchema37RuntimeActuallyExecuted !== true ||
    document?.bridgeSchema39RuntimeActuallyExecuted !== true ||
    document?.finalSchema39RuntimeActuallyExecuted !== true ||
    document?.successfulExternalEgress !== 0 ||
    !sameJson(document?.limitations, expectedLimitations) ||
    document?.fixture?.sourceJournalMode !== "wal" ||
    document?.fixture?.sourceSidecars?.walPresent !== true ||
    document?.fixture?.sourceSidecars?.shmPresent !== true ||
    !Number.isSafeInteger(document?.fixture?.sourceSidecars?.committedWalBytes) ||
    document.fixture.sourceSidecars.committedWalBytes <= 32 ||
    !validSha256(document.fixture.sourceSidecars.committedWalSha256) ||
    !Number.isSafeInteger(document?.fixture?.sourceSidecars?.shmBytes) ||
    document.fixture.sourceSidecars.shmBytes < 32_768 ||
    !/^[0-9]+$/.test(String(document?.fixture?.sourceSidecars?.walDev ?? "")) ||
    !/^[0-9]+$/.test(String(document?.fixture?.sourceSidecars?.walIno ?? "")) ||
    !/^[0-9]+$/.test(String(document?.fixture?.sourceSidecars?.shmDev ?? "")) ||
    !/^[0-9]+$/.test(String(document?.fixture?.sourceSidecars?.shmIno ?? "")) ||
    document?.sandbox?.contract !== "unboundry-linux-validation-sandbox-v1" ||
    document?.sandbox?.enforcementMode !== "linux-bwrap-inherited-v1" ||
    document?.sandbox?.processTreeEnforced !== true ||
    document?.sandbox?.capabilities?.allSetsEmpty !== true ||
    document?.sandbox?.capabilities?.noNewPrivileges !== true ||
    !capabilitySets ||
    !sameJson(Object.keys(capabilitySets).sort(), expectedCapabilitySets) ||
    Object.values(capabilitySets).some((value) =>
      !/^0+$/.test(String(value))) ||
    document?.sandbox?.interfaces?.onlyLoopback !== true ||
    document?.sandbox?.routes?.externalRouteRecords !== 0 ||
    document?.sandbox?.routes?.usableDefaultRoutes !== 0 ||
    document?.sandbox?.external?.denied !== true ||
    document?.sandbox?.loopback?.connected !== true ||
    document?.sandbox?.namespaces?.distinct !== true ||
    document?.sandbox?.namespaces?.network?.distinct !== true ||
    document?.sandbox?.namespaces?.network?.hostEvidence !==
      "injected-sha256-bound-json-v1" ||
    document?.sandbox?.namespaces?.process?.distinct !== true ||
    document?.sandbox?.namespaces?.process?.hostEvidence !==
      "injected-sha256-bound-json-v1" ||
    document?.sandbox?.namespaces?.hostEvidenceSha256 !==
      expectedHostNamespaceSha256 ||
    !Array.isArray(document?.sandbox?.namespaces?.process?.nspid) ||
    document.sandbox.namespaces.process.nspid.length < 1 ||
    !sameJson(
      comparableSandboxEnvelope(nestedLinuxSandbox),
      comparableSandboxEnvelope(document?.sandbox),
    )
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Sandbox receipt does not prove the production validation envelope",
    );
  }
  const validated = await validateProductionReceipt(
    document.result,
    document.fixture,
    pair,
  );
  if (
    document?.migratedFixture?.userVersion !== 41 ||
    document?.migratedFixture?.logicalSha256 !== validated.targetLogicalSha256 ||
    document?.migratedFixture?.integrityCheck !== "ok" ||
    document?.migratedFixture?.foreignKeyViolations !== 0 ||
    document?.migratedFixture?.accountCredentialEpochRevision !== 1 ||
    document?.migratedFixture?.durationStatus !== "ready" ||
    document?.migratedFixture?.durationSource !== "server-probe" ||
    document?.migratedFixture?.generationTasks !== 0 ||
    document?.migratedFixture?.generationProviderAttempts !== 0
  ) {
    fail(
      "LINUX_VALIDATION_RECEIPT_INVALID",
      "Sandbox receipt migrated fixture evidence is incomplete",
    );
  }
  return validated;
}

async function writeImmutableJson(path, document) {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o400);
  const handle = await open(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return sha256(bytes);
}

async function insideMain(options) {
  if (process.platform !== "linux" || process.versions.node !== expectedNodeVersion) {
    fail("LINUX_VALIDATION_ENVIRONMENT_INVALID", "Inside validation requires Linux Node 22.23.1");
  }
  const caseRoot = await realpath(options.caseRoot);
  if (caseRoot !== options.caseRoot || process.env.UNBOUNDRY_LINUX_VALIDATION_ROOT !== caseRoot) {
    fail("LINUX_VALIDATION_ENVELOPE_INVALID", "Inside validation root is not authenticated");
  }
  validationStage = "sandbox-authentication";
  const sandboxEvidence = await authenticateInheritedLinuxValidationSandbox();
  if (!sandboxEvidence) {
    fail("LINUX_VALIDATION_ENVELOPE_INVALID", "Inside validation sandbox is not authenticated");
  }
  const driverSha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
  if (
    process.env.UNBOUNDRY_LINUX_VALIDATION_DRIVER_SHA256 !== driverSha256
  ) {
    fail(
      "LINUX_VALIDATION_SOURCE_CHANGED",
      "Inside validation driver does not match the frozen tracked projection",
    );
  }
  validationStage = "approval-admission";
  const approval = await readApprovalContract(options.approvalJson);
  if (approval.sha256 !== options.approvalSha256) {
    fail(
      "LINUX_VALIDATION_APPROVAL_CHANGED",
      "Sandbox approval bytes do not match the host-pinned approval hash",
    );
  }
  validationStage = "artifact-admission";
  const pair = await admittedArtifacts(
    options.bridgeManifest,
    options.finalManifest,
    approval.document,
  );
  validationStage = "fixture-creation";
  const fixture = await createFixture(caseRoot);
  const backupArguments = [
    join(repositoryRoot, "scripts", "backup-final-candidate.mjs"),
    "--data-dir", fixture.dataDirectory,
    "--backup-root", fixture.backupRoot,
    "--bridge-release-manifest", options.bridgeManifest,
    "--target-data-dir", fixture.targetDirectory,
    "--fake-oss-target-dir", fixture.fakeOssTarget,
    "--final-release-manifest", options.finalManifest,
    "--scratch-root", fixture.scratchRoot,
    "--expected-database-logical-sha256", fixture.expectedLogicalSha256,
    "--generation-frozen-at", fixture.frozenAt,
    "--last-provider-admission-at", "none",
    "--allow-media-warning", "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING",
    "--oss-mirror", JSON.stringify({
      filePath: fixture.mirrorPath,
      objectKey: fixture.objectKey,
      versionId: "linux-validation-v1",
    }),
    "--recovery-private-key", fixture.keyPaths.recoveryPrivate,
    "--recovery-public-key", fixture.keyPaths.recoveryPublic,
    "--signing-private-key", fixture.keyPaths.signingPrivate,
    "--trusted-signing-public-key", fixture.keyPaths.signingPublic,
  ];
  let result;
  try {
    validationStage = "backup-execution";
    result = await runBounded(process.execPath, backupArguments, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 25 * 60_000,
    });
  } finally {
    let sidecarError;
    try {
      await revalidateSourceSidecars(fixture);
    } catch (error) {
      sidecarError = error;
    }
    try {
      fixture.sourceDatabase.close();
    } catch {
      fail(
        "LINUX_VALIDATION_FIXTURE_CLOSE_UNKNOWN",
        "Synthetic source database did not close cleanly",
      );
    }
    if (sidecarError) throw sidecarError;
  }
  validationStage = "receipt-validation";
  let receipt;
  try {
    receipt = JSON.parse(result.stdout);
  } catch {
    fail("LINUX_VALIDATION_RECEIPT_INVALID", "Production validation child returned invalid JSON");
  }
  const validated = await validateProductionReceipt(receipt, fixture, pair);
  validationStage = "migrated-fixture-inspection";
  const migratedFixture = await inspectMigratedFixture(
    fixture,
    validated.targetLogicalSha256,
  );
  await readApprovalContract(options.approvalJson, approval);
  const innerReceipt = Object.freeze({
    approvalSha256: approval.sha256,
    artifactMigrationActuallyExecuted: validated.migrationActuallyExecuted,
    bridgeSchema37RuntimeActuallyExecuted:
      receipt.startupValidation.bridgeSchema37.readiness.status === "ready",
    bridgeSchema39RuntimeActuallyExecuted:
      receipt.startupValidation.bridgeSchema39.readiness.status === "ready",
    driverSha256,
    driver: "unboundry-linux-production-validation-v1",
    format: "unboundry-linux-production-validation-inner",
    finalSchema39RuntimeActuallyExecuted:
      receipt.startupValidation.finalSchema39.readiness.status === "ready",
    fixture: fixtureReceiptEvidence(fixture),
    generatedAt: new Date().toISOString(),
    limitations: Object.freeze([
      "nginx-not-executed",
      "systemd-not-executed",
      "production-current-pointer-not-switched",
      "production-data-not-inspected",
    ]),
    migratedFixture,
    result: receipt,
    sandbox: sandboxEvidence,
    successfulExternalEgress: validated.successfulExternalEgress,
    version: 1,
  });
  const innerReceiptPath = join(caseRoot, "inner-receipt.json");
  validationStage = "inner-receipt-write";
  const innerReceiptSha256 = await writeImmutableJson(innerReceiptPath, innerReceipt);
  process.stdout.write(`${JSON.stringify({
    innerReceiptPath,
    innerReceiptSha256,
    status: "PASS",
  })}\n`);
}

async function hostMain(options) {
  const runtimeReport = typeof process.report?.getReport === "function"
    ? process.report.getReport()
    : undefined;
  const glibcVersionRuntime = runtimeReport?.header?.glibcVersionRuntime;
  if (
    process.platform !== "linux" || process.arch !== "x64" ||
    process.versions.node !== expectedNodeVersion ||
    typeof glibcVersionRuntime !== "string" ||
    !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(glibcVersionRuntime) ||
    typeof process.getuid !== "function" || process.getuid() === 0
  ) {
    fail(
      "LINUX_VALIDATION_ENVIRONMENT_INVALID",
      "Host validation requires non-root Linux x64 Node 22.23.1",
    );
  }
  const controllerEnvironment = assertCleanControllerEnvironment();
  const approval = await readApprovalContract(options.approvalJson);
  if (
    containsPath(repositoryRoot, approval.path) ||
    containsPath(approval.path, repositoryRoot)
  ) {
    fail(
      "LINUX_VALIDATION_APPROVAL_UNSAFE",
      "Linux production approval must remain external to the tracked repository",
    );
  }
  const caseRoot = await createCaseRoot(options.caseRoot);
  let sourceProjection;
  let completed = false;
  try {
  const source = await inspectTrackedOnlyRepository();
  const pair = await admittedPair(
    options.bridgeManifest,
    options.finalManifest,
    approval.document,
    source,
  );
  const prerequisites = await inspectHostPrerequisites(pair);
  sourceProjection = await createTrackedSourceProjection(source);
  const projectedDriverPath = join(
    sourceProjection.projection,
    "scripts",
    "run-linux-production-validation.mjs",
  );
  const driverSha256 = sha256(await readFile(projectedDriverPath));
  if (
    containsPath(caseRoot.canonical, pair.bridge.directory) ||
    containsPath(caseRoot.canonical, pair.final.directory) ||
    containsPath(pair.bridge.releaseRoot, caseRoot.canonical) ||
    containsPath(repositoryRoot, caseRoot.canonical) ||
    containsPath(caseRoot.canonical, repositoryRoot) ||
    containsPath(repositoryRoot, pair.bridge.releaseRoot) ||
    containsPath(pair.bridge.releaseRoot, repositoryRoot) ||
    containsPath(caseRoot.canonical, sourceProjection.root) ||
    containsPath(sourceProjection.root, caseRoot.canonical) ||
    containsPath(pair.bridge.releaseRoot, sourceProjection.root) ||
    containsPath(sourceProjection.root, pair.bridge.releaseRoot) ||
    containsPath(caseRoot.canonical, approval.path) ||
    containsPath(pair.bridge.releaseRoot, approval.path) ||
    containsPath(sourceProjection.root, approval.path)
  ) fail("LINUX_VALIDATION_PATH_UNSAFE", "Validation, source and release roots overlap");

  const home = join(caseRoot.canonical, "home");
  const temporary = join(caseRoot.canonical, "temporary");
  await mkdir(home, { mode: 0o700 });
  await mkdir(temporary, { mode: 0o700 });
  const nonce = randomBytes(32).toString("hex");
  const sentinel = join(caseRoot.canonical, ".linux-validation-owner");
  await writeFile(sentinel, `${nonce}\n`, { flag: "wx", mode: 0o600 });
  await chmod(sentinel, 0o600);
  const namespaceDescriptor = (path, kind) => {
    const details = statSync(path, { bigint: true });
    const label = readlinkSync(path, "utf8");
    if (label !== `${kind}:[${details.ino}]`) {
      fail(
        "LINUX_VALIDATION_NAMESPACE_INVALID",
        "Host namespace identity does not match its procfs label",
      );
    }
    return Object.freeze({
      dev: String(details.dev),
      ino: String(details.ino),
      label,
    });
  };
  const hostNamespaceDocument = Object.freeze({
    format: "unboundry-linux-host-namespace-evidence",
    network: namespaceDescriptor("/proc/self/ns/net", "net"),
    nonce,
    process: namespaceDescriptor("/proc/self/ns/pid", "pid"),
    version: 1,
  });
  const hostNamespacePath = join(
    caseRoot.canonical,
    ".linux-validation-host-namespaces.json",
  );
  const hostNamespaceBytes = Buffer.from(
    `${JSON.stringify(hostNamespaceDocument)}\n`,
    "utf8",
  );
  const hostNamespaceSha256 = sha256(hostNamespaceBytes);
  await writeFile(hostNamespacePath, hostNamespaceBytes, {
    flag: "wx",
    mode: 0o400,
  });
  await chmod(hostNamespacePath, 0o400);

  const readOnlyBinds = readOnlyBindSources([
    "/usr",
    "/bin",
    "/lib",
    "/opt/node22",
    Object.freeze({ destination: repositoryRoot, source: sourceProjection.projection }),
    Object.freeze({
      destination: pair.bridge.directory,
      source: pair.bridge.directory,
    }),
    Object.freeze({
      destination: pair.final.directory,
      source: pair.final.directory,
    }),
  ]);
  const runtimeBindings = await optionalReadOnlyRuntimeBindSources();
  readOnlyBinds.push(...runtimeBindings.bindings);
  const destinations = [...new Set([
    ...readOnlyBinds.map(({ destination }) => destination),
    caseRoot.canonical,
    "/proc",
    "/dev",
  ])];
  const bwrapArguments = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--uid", "0",
    "--gid", "0",
    "--cap-drop", "ALL",
    "--clearenv",
  ];
  for (const directory of bubblewrapDirectories(destinations)) {
    bwrapArguments.push("--dir", directory);
  }
  for (const binding of readOnlyBinds) {
    bwrapArguments.push("--ro-bind", binding.source, binding.destination);
  }
  bwrapArguments.push(
    "--dir", "/run/unboundry-validation",
    "--chmod", "0700", "/run/unboundry-validation",
    "--perms", "0400",
    "--file", "4", sandboxApprovalPath,
    "--perms", "0400",
    "--file", "3", "/run/unboundry-validation/host-namespaces.json",
    "--bind", caseRoot.canonical, caseRoot.canonical,
    "--proc", "/proc",
    "--dev", "/dev",
    "--setenv", "HOME", home,
    "--setenv", "LANG", "C",
    "--setenv", "LC_ALL", "C",
    "--setenv", "PATH", "/opt/node22/bin:/usr/bin:/bin",
    "--setenv", "TEMP", temporary,
    "--setenv", "TMP", temporary,
    "--setenv", "TMPDIR", temporary,
    "--setenv", "TZ", "UTC",
    "--setenv", "UNBOUNDRY_LINUX_VALIDATION_HOST_NAMESPACE_SHA256",
    hostNamespaceSha256,
    "--setenv", "UNBOUNDRY_LINUX_VALIDATION_NONCE", nonce,
    "--setenv", "UNBOUNDRY_LINUX_VALIDATION_ROOT", caseRoot.canonical,
    "--setenv", "UNBOUNDRY_LINUX_VALIDATION_SANDBOX", "linux-bwrap-inherited-v1",
    "--setenv", "UNBOUNDRY_LINUX_VALIDATION_SENTINEL", sentinel,
    "--setenv", "UNBOUNDRY_LINUX_VALIDATION_DRIVER_SHA256", driverSha256,
    "--chdir", repositoryRoot,
    "--",
    "/opt/node22/bin/node",
    join(repositoryRoot, "scripts", "run-linux-production-validation.mjs"),
    "--inside",
    "--approval-json", sandboxApprovalPath,
    "--approval-sha256", approval.sha256,
    "--bridge-release-manifest", options.bridgeManifest,
    "--case-root", caseRoot.canonical,
    "--final-release-manifest", options.finalManifest,
  );

  const hostNamespaceIdentityBefore = fixedFileIdentity(
    lstatSync(hostNamespacePath, { bigint: true }),
  );
  const approvalPathIdentityBefore = fixedFileIdentity(
    lstatSync(approval.path, { bigint: true }),
  );
  if (!sameJson(approvalPathIdentityBefore, approval.identity)) {
    fail(
      "LINUX_VALIDATION_APPROVAL_CHANGED",
      "Linux production approval changed before sandbox descriptor handoff",
    );
  }
  let approvalFd;
  let hostNamespaceFd;
  let result;
  let executionError;
  try {
    approvalFd = openSync(
      approval.path,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0) |
        fileConstants.O_NONBLOCK,
    );
    hostNamespaceFd = openSync(
      hostNamespacePath,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
    );
    if (!sameJson(
      fixedFileIdentity(fstatSync(approvalFd, { bigint: true })),
      approval.identity,
    )) {
      fail(
        "LINUX_VALIDATION_APPROVAL_CHANGED",
        "Linux production approval descriptor changed before sandbox handoff",
      );
    }
    if (!sameJson(
      fixedFileIdentity(fstatSync(hostNamespaceFd, { bigint: true })),
      hostNamespaceIdentityBefore,
    )) {
      fail(
        "LINUX_VALIDATION_NAMESPACE_CHANGED",
        "Host namespace evidence descriptor changed before sandbox handoff",
      );
    }
    result = await runBounded(bwrapExecutable, bwrapArguments, {
      cwd: repositoryRoot,
      env: {
        HOME: "/var/empty",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
        TZ: "UTC",
      },
      stdio: ["ignore", "pipe", "pipe", hostNamespaceFd, approvalFd],
      timeout: 30 * 60_000,
    });
  } catch (error) {
    executionError = error;
  } finally {
    if (hostNamespaceFd !== undefined) closeSync(hostNamespaceFd);
    if (approvalFd !== undefined) closeSync(approvalFd);
  }
  const hostNamespaceIdentityAfter = fixedFileIdentity(
    lstatSync(hostNamespacePath, { bigint: true }),
  );
  if (
    !sameJson(hostNamespaceIdentityAfter, hostNamespaceIdentityBefore) ||
    sha256(await readFile(hostNamespacePath)) !== hostNamespaceSha256
  ) {
    fail(
      "LINUX_VALIDATION_NAMESPACE_CHANGED",
      "Host namespace evidence changed while the sandbox was running",
    );
  }
  await assertOptionalRuntimeBindingUnchanged(
    runtimeBindings.alternativeDirectory,
  );
  if (executionError) {
    throw executionError;
  }
  await readApprovalContract(options.approvalJson, approval);
  await assertPrivateDirectoryAnchor(options.caseRoot, caseRoot);
  let inner;
  try {
    inner = JSON.parse(result.stdout);
  } catch {
    fail("LINUX_VALIDATION_RECEIPT_INVALID", "Sandbox controller returned invalid JSON");
  }
  const innerReceiptPath = join(caseRoot.canonical, "inner-receipt.json");
  const innerBytes = await readFile(innerReceiptPath);
  if (
    inner?.status !== "PASS" || inner.innerReceiptPath !== innerReceiptPath ||
    inner.innerReceiptSha256 !== sha256(innerBytes)
  ) fail("LINUX_VALIDATION_RECEIPT_INVALID", "Sandbox receipt identity is invalid");
  let innerReceiptDocument;
  try {
    innerReceiptDocument = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      innerBytes,
    ));
  } catch {
    fail("LINUX_VALIDATION_RECEIPT_INVALID", "Sandbox receipt is not canonical JSON");
  }
  await validateInnerReceiptDocument(
    innerReceiptDocument,
    pair,
    approval.sha256,
    driverSha256,
    hostNamespaceSha256,
  );

  const afterSource = await inspectTrackedOnlyRepository();
  const afterPair = await admittedPair(
    options.bridgeManifest,
    options.finalManifest,
    approval.document,
    afterSource,
  );
  const afterPrerequisites = await inspectHostPrerequisites(afterPair);
  await assertTrackedSourceProjectionUnchanged(sourceProjection);
  await readApprovalContract(options.approvalJson, approval);
  if (
    afterPair.bridge.manifestSha256 !== pair.bridge.manifestSha256 ||
    afterPair.final.manifestSha256 !== pair.final.manifestSha256 ||
    !sameJson(afterPrerequisites, prerequisites) ||
    afterSource.commit !== source.commit || afterSource.sourceTree !== source.sourceTree ||
    afterSource.trackedFiles !== source.trackedFiles ||
    sha256(await readFile(projectedDriverPath)) !== driverSha256
  ) fail("LINUX_VALIDATION_ARTIFACT_CHANGED", "Release artifacts changed during validation");
  await cleanupCaseTransients(caseRoot.canonical, caseRoot);
  const sourceProjectionEvidence = sourceProjection.evidence;
  await removePrivateProjection(sourceProjection.root);
  sourceProjection = undefined;
  const publishedCaseRootIdentity = Object.freeze({
    ...caseRoot.identity,
    mode: 0o500,
  });
  const finalReceipt = Object.freeze({
    approvalSha256: approval.sha256,
    artifactClass: "production",
    artifacts: Object.freeze({
      bridge: Object.freeze({
        commit: pair.bridge.manifest.commit,
        inventorySha256: pair.bridge.inventorySha256,
        manifestSha256: pair.bridge.manifestSha256,
        sourceTree: pair.bridge.manifest.sourceTree,
        version: pair.bridge.manifest.packageVersion,
      }),
      final: Object.freeze({
        commit: pair.final.manifest.commit,
        inventorySha256: pair.final.inventorySha256,
        manifestSha256: pair.final.manifestSha256,
        sourceTree: pair.final.manifest.sourceTree,
        version: pair.final.manifest.packageVersion,
      }),
    }),
    caseRootIdentity: publishedCaseRootIdentity,
    cleanup: Object.freeze({ projection: true, transients: true }),
    controllerEnvironment,
    driver: "unboundry-linux-production-validation-v1",
    driverSha256,
    format: "unboundry-linux-production-validation",
    formalReleaseCommit: true,
    generatedAt: new Date().toISOString(),
    innerReceiptSha256: inner.innerReceiptSha256,
    limitations: Object.freeze([
      "nginx-not-executed",
      "systemd-not-executed",
      "production-current-pointer-not-switched",
      "production-data-not-inspected",
      "publication-not-authorized",
    ]),
    platform: Object.freeze({
      arch: process.arch,
      glibcVersionRuntime,
      libc: "glibc",
      os: process.platform,
    }),
    prerequisites,
    sandbox: Object.freeze({
      capabilities: "none",
      externalNetworkRoute: "none",
      name: "bubblewrap",
      networkNamespace: "private",
      processNamespace: "private",
      processTreeTeardownConfirmed: true,
      successfulExternalEgress: 0,
    }),
    sourcePairProofSha256: pair.relationship.proofSha256,
    sourceProjection: sourceProjectionEvidence,
    status: "PASS",
    version: 1,
  });
  const receiptPath = join(caseRoot.canonical, "receipt.json");
  const receiptSha256 = await writeImmutableJson(receiptPath, finalReceipt);
  await chmod(caseRoot.canonical, 0o500);
  const publishedCanonical = await realpath(caseRoot.canonical).catch(() => undefined);
  const publishedDetails = await lstat(caseRoot.canonical, { bigint: true }).catch(
    () => undefined,
  );
  if (
    publishedCanonical !== caseRoot.canonical ||
    !publishedDetails?.isDirectory() || publishedDetails.isSymbolicLink() ||
    !sameJson(stableDirectoryAnchorIdentity(publishedDetails), publishedCaseRootIdentity)
  ) {
    fail(
      "LINUX_VALIDATION_PATH_CHANGED",
      "Published Linux validation evidence root identity is invalid",
    );
  }
  completed = true;
  process.stdout.write(`${JSON.stringify({ receiptPath, receiptSha256, status: "PASS" })}\n`);
  } finally {
    if (!completed) {
      let cleanupFailed = false;
      if (sourceProjection) {
        try {
          await removePrivateProjection(sourceProjection.root);
        } catch {
          cleanupFailed = true;
        }
      }
      try {
        await removeOwnedTree(caseRoot.canonical, BigInt(process.getuid()));
        if (await lstat(caseRoot.canonical).then(() => true, (error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        })) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        fail(
          "LINUX_VALIDATION_CLEANUP_UNKNOWN",
          "Linux validation transient cleanup could not be confirmed",
        );
      }
    }
  }
}

let paths = [];
try {
  const options = parseArguments(process.argv.slice(2));
  paths = [
    options.approvalJson,
    options.bridgeManifest,
    options.caseRoot,
    options.finalManifest,
  ];
  if (options.inside) await insideMain(options);
  else await hostMain(options);
} catch (error) {
  const reportedError = error;
  const controlledCode = typeof reportedError?.code === "string" &&
      /^(?:BACKUP|LINUX_VALIDATION|SCHEMA_MIGRATION)_[A-Z0-9_]+$/.test(
        reportedError.code,
      )
    ? reportedError.code
    : undefined;
  let message = reportedError instanceof ValidationError
    ? reportedError.message
    : "Linux production validation failed";
  for (const path of paths.sort((left, right) => right.length - left.length)) {
    message = message.replaceAll(path, "[path]");
  }
  process.stderr.write(`${JSON.stringify({
    code: reportedError instanceof ValidationError
      ? reportedError.code
      : controlledCode ?? "LINUX_VALIDATION_FAILED",
    error: message,
    ok: false,
    stage: validationStage,
  })}\n`);
  process.exitCode = 1;
}
