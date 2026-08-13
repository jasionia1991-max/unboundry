import { createHash } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  assertReleaseSourcePairArtifacts,
  validateReleaseSourcePairRelationship,
} from "./release-source-pair.mjs";

const CONTRACT = "unboundry-operational-releases-v1";
const MAXIMUM_ATTESTATION_BYTES = 4 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;

export class ReleaseAttestationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ReleaseAttestationError";
  }
}

export function assertAttestedReleaseArtifacts(attestation, releases) {
  try {
    return assertReleaseSourcePairArtifacts(attestation?.relationship, releases);
  } catch (error) {
    if (error instanceof ReleaseAttestationError) throw error;
    fail("Release attestation relationship does not match the admitted artifacts");
  }
}

function fail(message) {
  throw new ReleaseAttestationError("RELEASE_ATTESTATION_INVALID", message);
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!difference.startsWith(`..${sep}`) && difference !== "..");
}

function absolute(value, label) {
  if (typeof value !== "string" || value.length === 0 || resolve(value) !== value) {
    fail(`${label} must be a normalized absolute path`);
  }
  return value;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.uid === right.uid &&
    left.gid === right.gid && left.nlink === right.nlink &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function runtimeLibc() {
  if (process.platform !== "linux") return "none";
  return process.report?.getReport()?.header?.glibcVersionRuntime
    ? "glibc"
    : "musl";
}

export async function readReleaseAttestation() {
  const path = absolute(
    process.env.UNBOUNDRY_RELEASE_ATTESTATION_PATH,
    "Release attestation path",
  );
  const root = absolute(
    process.env.UNBOUNDRY_RELEASE_ATTESTATION_ROOT,
    "Release attestation root",
  );
  const testRoot = absolute(
    process.env.UNBOUNDRY_TEST_ROOT,
    "Safe-runner test root",
  );
  const expectedSha256 = process.env.UNBOUNDRY_RELEASE_ATTESTATION_SHA256;
  const sourceSha256 = process.env.UNBOUNDRY_RELEASE_SOURCE_SHA256;
  const bridgePath = absolute(
    process.env.UNBOUNDRY_BRIDGE_RELEASE_MANIFEST,
    "Bridge release manifest",
  );
  const finalPath = absolute(
    process.env.UNBOUNDRY_FINAL_RELEASE_MANIFEST,
    "Final release manifest",
  );
  const bridgeSha256 = process.env.UNBOUNDRY_BRIDGE_RELEASE_MANIFEST_SHA256;
  const finalSha256 = process.env.UNBOUNDRY_FINAL_RELEASE_MANIFEST_SHA256;
  if (
    process.env.UNBOUNDRY_SAFE_TEST !== "1" ||
    typeof process.getuid !== "function" ||
    !sha256Pattern.test(expectedSha256 ?? "") ||
    !sha256Pattern.test(sourceSha256 ?? "") ||
    !sha256Pattern.test(bridgeSha256 ?? "") ||
    !sha256Pattern.test(finalSha256 ?? "")
  ) fail("Release attestation environment is incomplete");

  let handle;
  try {
    if (
      await realpath(path) !== path || await realpath(root) !== root ||
      await realpath(testRoot) !== testRoot || await realpath(bridgePath) !== bridgePath ||
      await realpath(finalPath) !== finalPath
    ) fail("Release attestation paths must be canonical physical paths");
    const rootDetails = await lstat(root);
    if (
      !containsPath(testRoot, path) || containsPath(testRoot, root) ||
      !containsPath(root, bridgePath) || !containsPath(root, finalPath) ||
      !rootDetails.isDirectory() || rootDetails.isSymbolicLink() ||
      rootDetails.uid !== process.getuid() ||
      (rootDetails.mode & 0o777) !== 0o500
    ) fail("Release attestation roots are not isolated and immutable");

    handle = await open(
      path,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW |
        fileConstants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (
      !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.uid !== process.getuid() || (before.mode & 0o777) !== 0o400 ||
      before.size < 2 || before.size > MAXIMUM_ATTESTATION_BYTES
    ) fail("Release attestation file is not private and immutable");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    const rootAfter = await lstat(root);
    if (
      bytes.length !== before.size || !sameFile(before, after) ||
      !sameFile(before, pathAfter) ||
      rootAfter.dev !== rootDetails.dev || rootAfter.ino !== rootDetails.ino ||
      rootAfter.uid !== rootDetails.uid || rootAfter.gid !== rootDetails.gid ||
      rootAfter.mode !== rootDetails.mode || rootAfter.isSymbolicLink() ||
      !rootAfter.isDirectory() || await realpath(root) !== root ||
      createHash("sha256").update(bytes).digest("hex") !== expectedSha256
    ) fail("Release attestation identity or digest changed");
    let document;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("Release attestation is not valid JSON");
    }
    let relationship;
    try {
      relationship = validateReleaseSourcePairRelationship(document?.relationship);
    } catch {
      fail("Release attestation source-pair proof is invalid");
    }
    if (
      document?.contract !== CONTRACT ||
      document?.nonce !== process.env.UNBOUNDRY_SAFE_RUN_NONCE ||
      document?.artifactRoot !== root ||
      document?.source?.snapshotSha256 !== sourceSha256 ||
      document?.expectation?.artifactClass !== "synthetic-test" ||
      document?.expectation?.formalReleaseCommit !== false ||
      document?.expectation?.buildPlatform !== process.platform ||
      document?.expectation?.buildArch !== process.arch ||
      document?.expectation?.buildLibc !== runtimeLibc() ||
      document?.expectation?.runtimeCommand !== process.execPath ||
      document?.releases?.bridge?.manifestPath !== bridgePath ||
      document?.releases?.final?.manifestPath !== finalPath ||
      document?.releases?.bridge?.manifestSha256 !== bridgeSha256 ||
      document?.releases?.final?.manifestSha256 !== finalSha256 ||
      document?.releases?.bridge?.releaseId !== "v0.5.2" ||
      document?.releases?.final?.releaseId !== "v0.6.0"
    ) fail("Release attestation document does not match its environment");
    return Object.freeze({
      document: Object.freeze(document),
      expectation: Object.freeze({ ...document.expectation }),
      manifestPaths: Object.freeze({ bridge: bridgePath, final: finalPath }),
      manifestSha256: Object.freeze({
        bridge: bridgeSha256,
        final: finalSha256,
      }),
      path,
      relationship,
      root,
      sha256: expectedSha256,
      sourceSha256,
    });
  } catch (error) {
    if (error instanceof ReleaseAttestationError) throw error;
    fail("Release attestation could not be read safely");
  } finally {
    await handle?.close();
  }
}
