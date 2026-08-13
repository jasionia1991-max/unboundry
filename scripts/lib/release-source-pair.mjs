import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

const BRIDGE_VERSION = "0.5.2";
const FINAL_VERSION = "0.6.0";
const PROOF_CONTRACT = "unboundry-release-source-pair-v1";
const changedPaths = Object.freeze(["package-lock.json", "package.json"]);
const commitPattern = /^[a-f0-9]{40}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export const RELEASE_SOURCE_PAIR_MODES = Object.freeze({
  formal: "formal-direct-parent-bridge-final",
  synthetic: "synthetic-direct-child-fixture",
});

export class ReleaseSourcePairError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ReleaseSourcePairError";
  }
}

function fail(code, message) {
  throw new ReleaseSourcePairError(code, message);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function canonicalJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes);
  } catch {
    fail("RELEASE_SOURCE_PAIR_INVALID", `${label} is not valid JSON`);
  }
}

function assertVersionDocument(document, version, label) {
  if (
    !document || typeof document !== "object" || Array.isArray(document) ||
    document.version !== version
  ) fail("RELEASE_SOURCE_PAIR_INVALID", `${label} version is not ${version}`);
}

function assertLockDocument(document, version, label) {
  assertVersionDocument(document, version, label);
  if (
    !document.packages || typeof document.packages !== "object" ||
    Array.isArray(document.packages) ||
    !document.packages[""] || typeof document.packages[""] !== "object" ||
    Array.isArray(document.packages[""]) ||
    document.packages[""].version !== version
  ) fail("RELEASE_SOURCE_PAIR_INVALID", `${label} root package version is not ${version}`);
}

function sourcePairProofDocument(relationship) {
  return Object.freeze({
    bridgeCommit: relationship.bridgeCommit,
    bridgeSourceTree: relationship.bridgeSourceTree,
    bridgeSourceVersion: relationship.bridgeSourceVersion,
    changedPaths,
    contract: PROOF_CONTRACT,
    crossCommitProof: relationship.crossCommitProof,
    finalCommit: relationship.finalCommit,
    finalParentIsBridgeCommit: relationship.finalParentIsBridgeCommit,
    finalSourceTree: relationship.finalSourceTree,
    finalSourceVersion: relationship.finalSourceVersion,
    mode: relationship.mode,
  });
}

export function releaseSourcePairProofSha256(relationship) {
  return createHash("sha256")
    .update(JSON.stringify(sourcePairProofDocument(relationship)))
    .digest("hex");
}

export function validateReleaseSourcePairRelationship(relationship) {
  const expectedKeys = [
    "bridgeCommit",
    "bridgeSourceTree",
    "bridgeSourceVersion",
    "changedPaths",
    "crossCommitProof",
    "finalCommit",
    "finalParentIsBridgeCommit",
    "finalSourceTree",
    "finalSourceVersion",
    "mode",
    "proofSha256",
  ];
  if (
    !exactKeys(relationship, expectedKeys) ||
    !Object.values(RELEASE_SOURCE_PAIR_MODES).includes(relationship.mode) ||
    relationship.crossCommitProof !==
      (relationship.mode === RELEASE_SOURCE_PAIR_MODES.formal) ||
    relationship.finalParentIsBridgeCommit !== true ||
    relationship.bridgeSourceVersion !== BRIDGE_VERSION ||
    relationship.finalSourceVersion !== FINAL_VERSION ||
    !commitPattern.test(relationship.bridgeCommit ?? "") ||
    !commitPattern.test(relationship.finalCommit ?? "") ||
    !commitPattern.test(relationship.bridgeSourceTree ?? "") ||
    !commitPattern.test(relationship.finalSourceTree ?? "") ||
    relationship.bridgeCommit === relationship.finalCommit ||
    relationship.bridgeSourceTree === relationship.finalSourceTree ||
    JSON.stringify(relationship.changedPaths) !== JSON.stringify(changedPaths) ||
    !sha256Pattern.test(relationship.proofSha256 ?? "") ||
    releaseSourcePairProofSha256(relationship) !== relationship.proofSha256
  ) fail("RELEASE_SOURCE_PAIR_INVALID", "Release source-pair relationship is invalid");
  return Object.freeze({
    ...relationship,
    changedPaths: Object.freeze([...relationship.changedPaths]),
  });
}

function releaseIdentity(release, role) {
  const manifest = release?.manifest ?? release;
  const version = release?.version ?? manifest?.packageVersion;
  if (
    !manifest || typeof manifest !== "object" ||
    manifest.releaseRole !== role ||
    version !== (role === "bridge" ? BRIDGE_VERSION : FINAL_VERSION)
  ) fail("RELEASE_SOURCE_PAIR_ARTIFACT_MISMATCH", `${role} artifact identity is invalid`);
  return Object.freeze({
    commit: manifest.commit,
    sourceTree: manifest.sourceTree,
    version,
  });
}

export function assertReleaseSourcePairArtifacts(relationship, releases) {
  const validated = validateReleaseSourcePairRelationship(relationship);
  if (!exactKeys(releases, ["bridge", "final"])) {
    fail("RELEASE_SOURCE_PAIR_ARTIFACT_MISMATCH", "Release artifact pair is incomplete");
  }
  const bridge = releaseIdentity(releases.bridge, "bridge");
  const final = releaseIdentity(releases.final, "final");
  if (
    validated.bridgeCommit !== bridge.commit ||
    validated.bridgeSourceTree !== bridge.sourceTree ||
    validated.bridgeSourceVersion !== bridge.version ||
    validated.finalCommit !== final.commit ||
    validated.finalSourceTree !== final.sourceTree ||
    validated.finalSourceVersion !== final.version
  ) {
    fail(
      "RELEASE_SOURCE_PAIR_ARTIFACT_MISMATCH",
      "Release source-pair relationship does not match the admitted manifests",
    );
  }
  return validated;
}

async function git(repository, arguments_, gitExecutable) {
  try {
    const result = await execute(
      gitExecutable,
      [
        "--no-replace-objects",
        "-c",
        "core.hooksPath=/dev/null",
        ...arguments_,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        env: {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          LANG: "C",
          LC_ALL: "C",
          PATH: "/usr/bin:/bin",
        },
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    return result.stdout;
  } catch {
    fail("RELEASE_SOURCE_PAIR_GIT_FAILED", "Release source-pair Git inspection failed");
  }
}

async function commitFile(repository, commit, path, gitExecutable) {
  const bytes = await git(
    repository,
    ["show", "--no-ext-diff", "--no-textconv", `${commit}:${path}`],
    gitExecutable,
  );
  const document = parseJson(bytes, `${commit}:${path}`);
  if (bytes !== canonicalJson(document)) {
    fail(
      "RELEASE_SOURCE_PAIR_INVALID",
      `${path} must retain canonical formatting across the release pair`,
    );
  }
  return document;
}

async function commitTree(repository, commit, gitExecutable) {
  const value = (await git(
    repository,
    ["show", "-s", "--format=%T", commit],
    gitExecutable,
  )).trim();
  if (!commitPattern.test(value)) {
    fail("RELEASE_SOURCE_PAIR_INVALID", "Release source tree identity is invalid");
  }
  return value;
}

export async function attestReleaseSourcePair({
  finalCommit,
  gitExecutable = "/usr/bin/git",
  mode,
  repository,
}) {
  if (
    !isAbsolute(repository) || resolve(repository) !== repository ||
    await realpath(repository).catch(() => undefined) !== repository
  ) fail("RELEASE_SOURCE_PAIR_UNSAFE", "Release repository must be a canonical absolute path");
  const details = await lstat(repository).catch(() => undefined);
  if (!details?.isDirectory() || details.isSymbolicLink()) {
    fail("RELEASE_SOURCE_PAIR_UNSAFE", "Release repository must be a physical directory");
  }
  if (!commitPattern.test(finalCommit ?? "")) {
    fail("RELEASE_SOURCE_PAIR_INVALID", "Final release commit must be a full object identity");
  }
  if (!Object.values(RELEASE_SOURCE_PAIR_MODES).includes(mode)) {
    fail("RELEASE_SOURCE_PAIR_INVALID", "Release source-pair mode is invalid");
  }
  const topLevel = (await git(repository, ["rev-parse", "--show-toplevel"], gitExecutable))
    .trim();
  if (topLevel !== repository) {
    fail("RELEASE_SOURCE_PAIR_UNSAFE", "Release repository root is ambiguous");
  }
  const status = await git(
    repository,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    gitExecutable,
  );
  if (status !== "") {
    fail("RELEASE_SOURCE_PAIR_DIRTY", "Release source-pair repository must be clean");
  }
  const resolvedFinal = (await git(
    repository,
    ["rev-parse", "--verify", `${finalCommit}^{commit}`],
    gitExecutable,
  )).trim();
  if (resolvedFinal !== finalCommit) {
    fail("RELEASE_SOURCE_PAIR_INVALID", "Final release commit did not resolve exactly");
  }
  const rawCommit = await git(repository, ["cat-file", "-p", finalCommit], gitExecutable);
  const parents = rawCommit.split("\n")
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length));
  if (parents.length !== 1 || !commitPattern.test(parents[0])) {
    fail(
      "RELEASE_SOURCE_PAIR_PARENT_INVALID",
      "Final release commit must have exactly one direct parent",
    );
  }
  const bridgeCommit = parents[0];
  const diff = (await git(
    repository,
    [
      "diff-tree",
      "--no-commit-id",
      "--name-status",
      "-r",
      "--no-renames",
      bridgeCommit,
      finalCommit,
      "--",
    ],
    gitExecutable,
  )).trim().split("\n").filter(Boolean).sort();
  if (JSON.stringify(diff) !== JSON.stringify([
    "M\tpackage-lock.json",
    "M\tpackage.json",
  ])) {
    fail(
      "RELEASE_SOURCE_PAIR_DIFF_INVALID",
      "Final release commit may change only package.json and package-lock.json",
    );
  }
  for (const commit of [bridgeCommit, finalCommit]) {
    const entries = (await git(
      repository,
      ["ls-tree", commit, "--", ...changedPaths],
      gitExecutable,
    )).trim().split("\n").filter(Boolean);
    if (
      entries.length !== 2 || entries.some((entry) => !entry.startsWith("100644 blob "))
    ) fail("RELEASE_SOURCE_PAIR_DIFF_INVALID", "Version files must remain regular Git blobs");
  }

  const [bridgePackage, bridgeLock, finalPackage, finalLock] = await Promise.all([
    commitFile(repository, bridgeCommit, "package.json", gitExecutable),
    commitFile(repository, bridgeCommit, "package-lock.json", gitExecutable),
    commitFile(repository, finalCommit, "package.json", gitExecutable),
    commitFile(repository, finalCommit, "package-lock.json", gitExecutable),
  ]);
  assertVersionDocument(bridgePackage, BRIDGE_VERSION, "Bridge package.json");
  assertLockDocument(bridgeLock, BRIDGE_VERSION, "Bridge package-lock.json");
  assertVersionDocument(finalPackage, FINAL_VERSION, "Final package.json");
  assertLockDocument(finalLock, FINAL_VERSION, "Final package-lock.json");
  const expectedFinalPackage = structuredClone(bridgePackage);
  expectedFinalPackage.version = FINAL_VERSION;
  const expectedFinalLock = structuredClone(bridgeLock);
  expectedFinalLock.version = FINAL_VERSION;
  expectedFinalLock.packages[""].version = FINAL_VERSION;
  if (
    JSON.stringify(finalPackage) !== JSON.stringify(expectedFinalPackage) ||
    JSON.stringify(finalLock) !== JSON.stringify(expectedFinalLock)
  ) fail("RELEASE_SOURCE_PAIR_DIFF_INVALID", "Final version documents changed beyond three fields");

  const relationshipWithoutProof = {
    bridgeCommit,
    bridgeSourceTree: await commitTree(repository, bridgeCommit, gitExecutable),
    bridgeSourceVersion: BRIDGE_VERSION,
    changedPaths,
    crossCommitProof: mode === RELEASE_SOURCE_PAIR_MODES.formal,
    finalCommit,
    finalParentIsBridgeCommit: true,
    finalSourceTree: await commitTree(repository, finalCommit, gitExecutable),
    finalSourceVersion: FINAL_VERSION,
    mode,
  };
  return validateReleaseSourcePairRelationship(Object.freeze({
    ...relationshipWithoutProof,
    proofSha256: releaseSourcePairProofSha256(relationshipWithoutProof),
  }));
}
