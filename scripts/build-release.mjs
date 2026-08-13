import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fsyncSync,
  openSync,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { userInfo } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_VERSION = "22.23.1";
const REQUIRED_NPM_VERSION = "10.9.8";
const BUBBLEWRAP_EXECUTABLE = "/usr/bin/bwrap";
const bubblewrapIsolationArguments = Object.freeze([
  "--die-with-parent",
  "--new-session",
  "--unshare-all",
  "--uid", "0",
  "--gid", "0",
  "--clearenv",
]);
const MAXIMUM_FILE_BYTES = 1024 * 1024 * 1024;
const MAXIMUM_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAXIMUM_CACHE_ENTRIES = 250_000;
const MAXIMUM_TREE_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_TREE_DEPTH = 64;
const MAXIMUM_PATH_BYTES = 4096;
const MAXIMUM_TREE_ENTRIES = 500_000;
const commitPattern = /^[0-9a-f]{40}$/;
const releaseIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const releaseVersionByRole = Object.freeze({
  bridge: "0.5.2",
  final: "0.6.0",
});
const exactLegacyRuntimeContract = Object.freeze({
  archiveSha256: "e7a619c4d9dbaca14d1032ef18f83f81dcfb36c9402976debc4f8f546c8bb5d0",
  commitTree: "0990690bd9828757b82f59861f950ce6ff9ed4f8",
  files: Object.freeze({
    "package.json": "142da3969ae57ca686507377777b67783e9375474282467bc54dd9c77c60fa91",
    "server/canvasPersistence.ts": "ec1b2612fc8b974347744eee97bc2428ae1c29ab0c89177f5e50f2ef05923a7b",
    "server/database.ts": "3d907b9ea518b5e6ec3c1a03d0c68877cd8a28c49d3d20add173efc777103ed4",
    "vite.config.ts": "759d61ec22585cb447e80edd675efd0af1228a61448fd0e6829998ad46065786",
  }),
  originalInventorySha256:
    "cd98d90aaae56de756164fa0434dfb6bb144598183536c6d91067308e8d24517",
  peeledCommit: "7f7d6177a564056a6f41ff83dfb7ba913b21603b",
  tag: "v0.5.1",
  trackedFiles: 371,
});
const forbiddenSegments = new Set([
  "backups",
  "data",
  "playwright-report",
  "secrets",
  "test-results",
  "tmp",
]);
const runtimeSourceRoots = Object.freeze(["client", "server", "types"]);
const runtimeSourceFiles = Object.freeze([
  "vite.config.ts",
  "spec/unboundry-state-fixtures.json",
]);
const bridgeMigrationSourceFiles = Object.freeze([
  "scripts/migrate-schema37-to39.mjs",
  "scripts/node-typescript-runtime.mjs",
]);
const repositoryRoot = await realpath(resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
));
const offlineGuardPath = join(repositoryRoot, "scripts/offline-network-guard.mjs");

class ReleaseBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseBuildError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseBuildError(code, message);
}

function exactAbsolutePath(value, label) {
  if (
    !value || !isAbsolute(value) || resolve(value) !== value ||
    value !== value.normalize("NFC") || /[\0\r\n]/.test(value)
  ) {
    fail("RELEASE_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
  }
  return value;
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (
    difference !== ".." && !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function accountTreeEntry(budget, path, details, label) {
  budget.entries += 1;
  if (details.isFile()) budget.bytes += details.size;
  if (
    budget.entries > budget.maximumEntries || budget.bytes > budget.maximumBytes ||
    Buffer.byteLength(path, "utf8") > MAXIMUM_PATH_BYTES
  ) fail("RELEASE_INPUT_UNSAFE", `${label} exceeds a bounded inventory limit`);
}

function parseArguments(argv) {
  const values = new Map();
  const allowed = new Set([
    "--artifact-class",
    "--commit",
    "--ffmpeg-executable",
    "--ffprobe-executable",
    "--expected-version",
    "--formal-release-commit",
    "--legacy-source-archive",
    "--npm-cache",
    "--release-role",
    "--release-id",
    "--release-root",
    "--scratch-root",
    "--target-arch",
    "--target-libc",
    "--target-platform",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(option) || !value || value.startsWith("--") || values.has(option)) {
      fail("RELEASE_ARGUMENT_INVALID", "Release arguments are missing, duplicated, or unknown");
    }
    values.set(option, value);
  }
  if (argv.length % 2 !== 0) {
    fail("RELEASE_ARGUMENT_INVALID", "Every release option requires one value");
  }
  for (const required of [
    "--artifact-class",
    "--commit",
    "--ffmpeg-executable",
    "--ffprobe-executable",
    "--expected-version",
    "--formal-release-commit",
    "--npm-cache",
    "--release-role",
    "--release-id",
    "--release-root",
    "--scratch-root",
    "--target-arch",
    "--target-libc",
    "--target-platform",
  ]) {
    if (!values.has(required)) {
      fail("RELEASE_ARGUMENT_INVALID", `Missing required option ${required}`);
    }
  }
  const commit = values.get("--commit");
  if (!commitPattern.test(commit)) {
    fail("RELEASE_COMMIT_INVALID", "Commit must be a complete lowercase Git SHA-1");
  }
  const releaseId = values.get("--release-id") ?? commit;
  if (!releaseIdPattern.test(releaseId) || releaseId === "." || releaseId === "..") {
    fail("RELEASE_ARGUMENT_INVALID", "Release id is unsafe");
  }
  const buildLibc = process.platform === "linux"
    ? (process.report?.getReport().header.glibcVersionRuntime ? "glibc" : "musl")
    : "none";
  const artifactClass = values.get("--artifact-class");
  if (!new Set(["production", "synthetic-test"]).has(artifactClass)) {
    fail("RELEASE_ARGUMENT_INVALID", "Artifact class must be production or synthetic-test");
  }
  if (
    values.get("--target-platform") !== process.platform ||
    values.get("--target-arch") !== process.arch ||
    values.get("--target-libc") !== buildLibc
  ) {
    fail(
      "RELEASE_TARGET_INVALID",
      "Release target must exactly match the clean builder platform, architecture, and libc",
    );
  }
  if (
    artifactClass === "production" &&
    (process.platform !== "linux" || process.arch !== "x64" || buildLibc !== "glibc")
  ) {
    fail(
      "RELEASE_TARGET_INVALID",
      "Production releases require the clean Linux x64 glibc builder",
    );
  }
  if (
    artifactClass === "production" &&
    (
      process.execPath !== "/opt/node22/bin/node" ||
      values.get("--ffmpeg-executable") !== "/usr/bin/ffmpeg" ||
      values.get("--ffprobe-executable") !== "/usr/bin/ffprobe"
    )
  ) {
    fail(
      "RELEASE_RUNTIME_INVALID",
      "Production releases require the fixed Node and Ubuntu media executable paths",
    );
  }
  const releaseRole = values.get("--release-role");
  const expectedVersion = values.get("--expected-version");
  const formalReleaseCommitRaw = values.get("--formal-release-commit");
  if (!new Set(["true", "false"]).has(formalReleaseCommitRaw)) {
    fail("RELEASE_ARGUMENT_INVALID", "Formal release commit must be true or false");
  }
  const formalReleaseCommit = formalReleaseCommitRaw === "true";
  if (artifactClass === "synthetic-test" && formalReleaseCommit) {
    fail("RELEASE_ARGUMENT_INVALID", "Synthetic artifacts cannot claim a formal release commit");
  }
  if (artifactClass === "production" && !formalReleaseCommit) {
    fail("RELEASE_ARGUMENT_INVALID", "Production artifacts require a formal release commit");
  }
  if (!Object.hasOwn(releaseVersionByRole, releaseRole)) {
    fail("RELEASE_ARGUMENT_INVALID", "Release role must be bridge or final");
  }
  if (expectedVersion !== releaseVersionByRole[releaseRole]) {
    fail(
      "RELEASE_VERSION_INVALID",
      `Release role ${releaseRole} requires version ${releaseVersionByRole[releaseRole]}`,
    );
  }
  if (releaseId !== `v${expectedVersion}`) {
    fail("RELEASE_VERSION_INVALID", "Release id must exactly match the expected package version");
  }
  const legacySourceArchive = values.has("--legacy-source-archive")
    ? exactAbsolutePath(values.get("--legacy-source-archive"), "Legacy source archive")
    : undefined;
  if (
    (releaseRole === "bridge" && !legacySourceArchive) ||
    (releaseRole === "final" && legacySourceArchive)
  ) {
    fail(
      "RELEASE_ARGUMENT_INVALID",
      "Only bridge releases require one exact legacy source archive",
    );
  }
  return Object.freeze({
    artifactClass,
    buildArch: process.arch,
    buildLibc,
    buildPlatform: process.platform,
    commit,
    ffmpegExecutable: exactAbsolutePath(
      values.get("--ffmpeg-executable"),
      "ffmpeg executable",
    ),
    ffprobeExecutable: exactAbsolutePath(
      values.get("--ffprobe-executable"),
      "ffprobe executable",
    ),
    expectedVersion,
    formalReleaseCommit,
    legacySourceArchive,
    npmCache: exactAbsolutePath(values.get("--npm-cache"), "npm cache"),
    releaseId,
    releaseRole,
    releaseRoot: exactAbsolutePath(values.get("--release-root"), "release root"),
    scratchRoot: exactAbsolutePath(values.get("--scratch-root"), "scratch root"),
  });
}

function trustedOwner(details) {
  if (typeof process.getuid !== "function") return false;
  return details.uid === 0 || details.uid === process.getuid();
}

async function assertSafeDirectory(path, label, { privateMode = false } = {}) {
  const details = await lstat(path).catch(() => undefined);
  if (
    !details || !details.isDirectory() || details.isSymbolicLink() ||
    details.nlink < 1 || !trustedOwner(details) ||
    (details.mode & 0o022) !== 0 ||
    (privateMode && (details.mode & 0o777) !== 0o700)
  ) {
    fail("RELEASE_PATH_UNSAFE", `${label} is not a trusted private directory`);
  }
  return details;
}

async function assertTrustedDirectoryChain(path, label) {
  let current = path;
  for (;;) {
    const details = await lstat(current).catch(() => undefined);
    if (
      !details || !details.isDirectory() || details.isSymbolicLink() ||
      !trustedOwner(details) ||
      ((details.mode & 0o022) !== 0 &&
        !((details.mode & 0o1000) !== 0 && details.uid === 0))
    ) {
      fail("RELEASE_PATH_UNSAFE", `${label} has an untrusted directory ancestor`);
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function assertIsolatedNpmCache(path) {
  await assertSafeDirectory(path, "npm cache", { privateMode: true });
  const rootEntries = await readdir(path, { withFileTypes: true });
  if (rootEntries.some((entry) => entry.name !== "_cacache")) {
    fail("RELEASE_PATH_UNSAFE", "npm cache may contain only an isolated _cacache tree");
  }
  let entryCount = 0;
  let totalBytes = 0;
  async function visit(directory, depth = 0) {
    if (depth > MAXIMUM_TREE_DEPTH) fail("RELEASE_PATH_UNSAFE", "npm cache is too deep");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entryCount += 1;
      if (entryCount > MAXIMUM_CACHE_ENTRIES) {
        fail("RELEASE_PATH_UNSAFE", "npm cache contains too many entries");
      }
      const entryPath = join(directory, entry.name);
      if (Buffer.byteLength(entryPath, "utf8") > MAXIMUM_PATH_BYTES) {
        fail("RELEASE_PATH_UNSAFE", "npm cache path is too long");
      }
      const details = await lstat(entryPath);
      if (details.isFile()) totalBytes += details.size;
      if (totalBytes > MAXIMUM_TREE_BYTES) {
        fail("RELEASE_PATH_UNSAFE", "npm cache is too large");
      }
      if (
        !trustedOwner(details) || (details.mode & 0o022) !== 0 ||
        details.isSymbolicLink() ||
        (details.isFile() && (details.nlink !== 1 || details.size > MAXIMUM_FILE_BYTES))
      ) {
        fail("RELEASE_PATH_UNSAFE", "npm cache contains an unsafe entry");
      }
      if (details.isDirectory()) await visit(entryPath, depth + 1);
      else if (!details.isFile()) {
        fail("RELEASE_PATH_UNSAFE", "npm cache contains a link or special entry");
      }
    }
  }
  if (rootEntries.length === 1) await visit(join(path, "_cacache"), 1);
}

async function assertPathRoots(options) {
  const [canonicalRelease, canonicalScratch] = await Promise.all([
    realpath(options.releaseRoot),
    realpath(options.scratchRoot),
  ]);
  await Promise.all([
    assertTrustedDirectoryChain(canonicalRelease, "Release root"),
    assertTrustedDirectoryChain(canonicalScratch, "Scratch root"),
    assertSafeDirectory(options.releaseRoot, "Release root", { privateMode: true }),
    assertSafeDirectory(options.scratchRoot, "Scratch root", { privateMode: true }),
  ]);
  if (
    containsPath(repositoryRoot, canonicalRelease) ||
    containsPath(repositoryRoot, canonicalScratch) ||
    containsPath(canonicalRelease, repositoryRoot) ||
    containsPath(canonicalScratch, repositoryRoot) ||
    containsPath(canonicalRelease, canonicalScratch) ||
    containsPath(canonicalScratch, canonicalRelease)
  ) {
    fail("RELEASE_PATH_UNSAFE", "Repository, release, and scratch paths must be disjoint");
  }
  const canonicalCache = await realpath(options.npmCache);
  await assertTrustedDirectoryChain(canonicalCache, "npm cache");
  // Do not resolve or inspect the real home: the builder is designed to run
  // inside an outer sandbox that may deny it entirely. The OS-reported home is
  // already absolute and is used only for lexical disjointness.
  const canonicalUserHome = resolve(userInfo().homedir);
  if (
    containsPath(repositoryRoot, canonicalCache) ||
    containsPath(canonicalCache, repositoryRoot) ||
    containsPath(canonicalRelease, canonicalCache) ||
    containsPath(canonicalCache, canonicalRelease) ||
    containsPath(canonicalScratch, canonicalCache) ||
    containsPath(canonicalCache, canonicalScratch) ||
    containsPath(canonicalUserHome, canonicalCache) ||
    containsPath(canonicalCache, canonicalUserHome) ||
    containsPath("/var/lib/unboundry", canonicalCache) ||
    containsPath(canonicalCache, "/var/lib/unboundry")
  ) {
    fail(
      "RELEASE_PATH_UNSAFE",
      "npm cache must be an isolated external directory outside private application roots",
    );
  }
  await assertIsolatedNpmCache(canonicalCache);
  const [cacheDetails, releaseDetails, scratchDetails] = await Promise.all([
    lstat(canonicalCache),
    lstat(canonicalRelease),
    lstat(canonicalScratch),
  ]);
  return Object.freeze({
    cache: Object.freeze({
      identity: Object.freeze({
        dev: cacheDetails.dev,
        ino: cacheDetails.ino,
        uid: cacheDetails.uid,
      }),
      path: canonicalCache,
    }),
    release: Object.freeze({
      identity: Object.freeze({
        dev: releaseDetails.dev,
        ino: releaseDetails.ino,
        uid: releaseDetails.uid,
      }),
      path: canonicalRelease,
    }),
    scratch: Object.freeze({
      identity: Object.freeze({
        dev: scratchDetails.dev,
        ino: scratchDetails.ino,
        uid: scratchDetails.uid,
      }),
      path: canonicalScratch,
    }),
  });
}

function cleanEnvironment(home, npmCache, networkAudit) {
  return {
    HOME: home,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    LOGNAME: "unboundry-release",
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: `--import=${offlineGuardPath}`,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    TEMP: home,
    TMP: home,
    TMPDIR: home,
    USER: "unboundry-release",
    UNBOUNDRY_OFFLINE_GUARD_ALLOWED_PORTS: "[1]",
    UNBOUNDRY_OFFLINE_GUARD_AUDIT: networkAudit,
    UNBOUNDRY_OFFLINE_GUARD_MODE: "final-candidate",
    npm_config_audit: "false",
    npm_config_cache: npmCache,
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_logs_dir: join(home, "npm-logs"),
    npm_config_offline: "true",
    npm_config_tmp: home,
    npm_config_update_notifier: "false",
  };
}

function guardedCommandEnvironment(home, npmCache, networkAudit, guardPath) {
  const environment = {
    ...cleanEnvironment(home, npmCache, networkAudit),
    NODE_OPTIONS: `--import=${guardPath}`,
  };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("UNBOUNDRY_TEST_") || name === "UNBOUNDRY_SAFE_TEST") {
      delete environment[name];
    }
  }
  return environment;
}

function sandboxLiteral(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function createDarwinBuildSandbox(
  path,
  { auditFile, home, npmCache, source, writablePaths },
) {
  const nodeRoot = dirname(dirname(process.execPath));
  const readOnlySandboxPaths = [...new Set([source, npmCache])]
    .filter((entry) => !writablePaths.some((writable) => containsPath(writable, entry)));
  const metadataAncestors = new Set(["/private", "/tmp", "/var"]);
  for (const entry of [nodeRoot, ...readOnlySandboxPaths, ...writablePaths]) {
    let ancestor = dirname(entry);
    while (ancestor !== "/") {
      metadataAncestors.add(ancestor);
      ancestor = dirname(ancestor);
    }
  }
  const metadataAncestorRules = [...metadataAncestors]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .map((entry) => `(literal ${sandboxLiteral(entry)})`)
    .join(" ");
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-read*)",
    "(deny file-write*)",
    `(allow file-read-metadata (literal ${sandboxLiteral("/")}) ` +
      `${metadataAncestorRules} ` +
      `(subpath ${sandboxLiteral("/System/Cryptexes")}) ` +
      `(subpath ${sandboxLiteral("/System/Library")}) ` +
      `(subpath ${sandboxLiteral("/bin")}) ` +
      `(subpath ${sandboxLiteral("/usr/bin")}) ` +
      `(subpath ${sandboxLiteral("/usr/lib")}) ` +
      `(subpath ${sandboxLiteral("/usr/share")}) ` +
      `(subpath ${sandboxLiteral("/Library/Apple")}) ` +
      `(subpath ${sandboxLiteral("/private/var/db/timezone")}) ` +
      `(subpath ${sandboxLiteral(nodeRoot)}) ` +
      `${readOnlySandboxPaths.map((entry) => `(subpath ${sandboxLiteral(entry)})`).join(" ")} ` +
      `${writablePaths.map((entry) => `(subpath ${sandboxLiteral(entry)})`).join(" ")} ` +
      `(literal ${sandboxLiteral("/dev/null")}) ` +
      `(literal ${sandboxLiteral("/dev/urandom")}))`,
    `(allow file-read-data (literal ${sandboxLiteral("/")}))`,
    `(allow file-read* (subpath ${sandboxLiteral("/System/Cryptexes")}) ` +
      `(subpath ${sandboxLiteral("/System/Library")}) ` +
      `(subpath ${sandboxLiteral("/bin")}) ` +
      `(subpath ${sandboxLiteral("/usr/bin")}) ` +
      `(subpath ${sandboxLiteral("/usr/lib")}) ` +
      `(subpath ${sandboxLiteral("/usr/share")}) ` +
      `(subpath ${sandboxLiteral("/Library/Apple")}) ` +
      `(subpath ${sandboxLiteral("/private/var/db/timezone")}) ` +
      `(subpath ${sandboxLiteral(nodeRoot)}) ` +
      `${readOnlySandboxPaths.map((entry) => `(subpath ${sandboxLiteral(entry)})`).join(" ")} ` +
      `${writablePaths.map((entry) => `(subpath ${sandboxLiteral(entry)})`).join(" ")} ` +
      `(literal ${sandboxLiteral("/dev/null")}) ` +
      `(literal ${sandboxLiteral("/dev/urandom")}))`,
    `(allow file-write* (subpath ${sandboxLiteral(home)}) ` +
      `(literal ${sandboxLiteral(auditFile)}) ` +
      `${writablePaths.map((entry) => `(subpath ${sandboxLiteral(entry)})`).join(" ")} ` +
      `(literal ${sandboxLiteral("/dev/null")}))`,
    "",
  ].join("\n");
  await writeFile(path, profile, { flag: "wx", mode: 0o600 });
  return Object.freeze({
    evidenceDocument: profile,
    kind: "darwin-seatbelt",
    profilePath: path,
  });
}

async function assertBubblewrapExecutable() {
  const canonical = await realpath(BUBBLEWRAP_EXECUTABLE).catch(() => undefined);
  const details = await lstat(BUBBLEWRAP_EXECUTABLE).catch(() => undefined);
  if (
    canonical !== BUBBLEWRAP_EXECUTABLE ||
    !details?.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
    details.uid !== 0 || (details.mode & 0o022) !== 0 ||
    (details.mode & 0o111) === 0
  ) {
    fail(
      "RELEASE_SANDBOX_UNAVAILABLE",
      "Production Linux releases require trusted root-owned /usr/bin/bwrap",
    );
  }
  const version = (await run(BUBBLEWRAP_EXECUTABLE, ["--version"], {
    env: sourceControlEnvironment(),
  })).trim();
  if (!/^bubblewrap \d+\.\d+(?:\.\d+)?$/.test(version)) {
    fail("RELEASE_SANDBOX_UNAVAILABLE", "Bubblewrap version output is invalid");
  }
  return Object.freeze({
    arguments: Object.freeze(["--version"]),
    name: "bwrap",
    path: BUBBLEWRAP_EXECUTABLE,
    required: true,
    sha256: await sha256File(BUBBLEWRAP_EXECUTABLE),
    versionOutputSha256: createHash("sha256").update(version).digest("hex"),
    versionPattern: "^bubblewrap [0-9]+\\.[0-9]+(?:\\.[0-9]+)?$",
  });
}

async function trustedBubblewrapBindSource(path, label) {
  const canonical = await realpath(path).catch(() => undefined);
  const details = canonical ? await lstat(canonical).catch(() => undefined) : undefined;
  if (
    !canonical || !details || details.isSymbolicLink() ||
    (!details.isDirectory() && !details.isFile()) ||
    details.uid !== 0 || (details.mode & 0o022) !== 0
  ) {
    fail("RELEASE_SANDBOX_UNAVAILABLE", `${label} is not a trusted Linux bind source`);
  }
  return Object.freeze({ destination: path, source: canonical });
}

async function linuxToolchainBinds() {
  const candidates = [
    "/usr/bin",
    "/usr/lib",
    "/usr/lib64",
    "/usr/share",
    "/bin",
    "/lib",
    "/lib64",
    dirname(dirname(process.execPath)),
    "/etc/ld.so.cache",
    "/etc/localtime",
    "/etc/ssl/certs",
  ];
  const binds = [];
  for (const path of [...new Set(candidates)]) {
    if (await lstat(path).then(() => true, () => false)) {
      binds.push(await trustedBubblewrapBindSource(path, "Linux toolchain path"));
    }
  }
  return Object.freeze(binds);
}

async function assertPrivateBubblewrapPath(path, label) {
  const details = await lstat(path).catch(() => undefined);
  if (
    !details || details.isSymbolicLink() ||
    (!details.isDirectory() && !details.isFile()) ||
    !trustedOwner(details) || (details.mode & 0o022) !== 0
  ) fail("RELEASE_PATH_UNSAFE", `${label} is unsafe for a Linux sandbox bind`);
}

async function createLinuxBuildSandbox(
  { auditFile, home, npmCache, source, writablePaths },
) {
  const writable = [...new Set([home, auditFile, ...writablePaths])];
  const readOnly = [source, npmCache].filter((path) => !writable.includes(path));
  await Promise.all([
    ...readOnly.map((path) => assertPrivateBubblewrapPath(path, "Read-only sandbox input")),
    ...writable.map((path) => assertPrivateBubblewrapPath(path, "Writable sandbox input")),
  ]);
  const toolchain = await linuxToolchainBinds();
  const policy = Object.freeze({
    isolationArguments: bubblewrapIsolationArguments,
    readOnly: Object.freeze(readOnly),
    toolchain,
    writable: Object.freeze(writable),
  });
  return Object.freeze({
    evidenceDocument: `${JSON.stringify(policy)}\n`,
    kind: "linux-bubblewrap",
    policy,
  });
}

async function createBuildSandbox(path, context) {
  if (process.platform === "darwin") return createDarwinBuildSandbox(path, context);
  if (process.platform === "linux") return createLinuxBuildSandbox(context);
  fail("RELEASE_SANDBOX_UNAVAILABLE", "The immutable builder requires a supported OS sandbox");
}

function processGroupExists(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function assertProcessGroupStopped(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return;
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!processGroupExists(processGroupId)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  fail(
    "RELEASE_COMMAND_CLEANUP_FAILED",
    "Release command descendants did not terminate within the bounded cleanup deadline",
  );
}

function bubblewrapDestinationDirectories(paths) {
  const directories = new Set();
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== "/") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  return [...directories].sort((left, right) => {
    const depthDifference = left.split(sep).length - right.split(sep).length;
    return depthDifference || bytewiseCompare(left, right);
  });
}

function linuxBubblewrapArguments(sandbox, command, arguments_, options) {
  const environment = options.env ?? {};
  const mountDestinations = [
    ...sandbox.policy.toolchain.map((entry) => entry.destination),
    ...sandbox.policy.readOnly,
    ...sandbox.policy.writable,
    "/proc",
    "/dev",
  ];
  const result = [...bubblewrapIsolationArguments];
  for (const directory of bubblewrapDestinationDirectories(mountDestinations)) {
    result.push("--dir", directory);
  }
  for (const entry of sandbox.policy.toolchain) {
    result.push("--ro-bind", entry.source, entry.destination);
  }
  for (const path of sandbox.policy.readOnly) result.push("--ro-bind", path, path);
  for (const path of sandbox.policy.writable) result.push("--bind", path, path);
  result.push("--proc", "/proc", "--dev", "/dev");
  for (const name of Object.keys(environment).sort(bytewiseCompare)) {
    const value = environment[name];
    if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      fail("RELEASE_SANDBOX_INVALID", "Linux sandbox environment is invalid");
    }
    result.push("--setenv", name, value);
  }
  result.push("--chdir", exactAbsolutePath(options.cwd, "Sandbox working directory"));
  result.push("--", exactAbsolutePath(command, "Sandbox command"), ...arguments_);
  return result;
}

async function runSandboxed(sandbox, command, arguments_, options) {
  try {
    if (sandbox.kind === "darwin-seatbelt") {
      return await run(
        "/usr/bin/sandbox-exec",
        ["-f", sandbox.profilePath, command, ...arguments_],
        options,
      );
    }
    if (sandbox.kind === "linux-bubblewrap") {
      return await run(
        BUBBLEWRAP_EXECUTABLE,
        linuxBubblewrapArguments(sandbox, command, arguments_, options),
        { ...options, env: sourceControlEnvironment() },
      );
    }
    fail("RELEASE_SANDBOX_INVALID", "Release sandbox policy is unsupported");
  } catch (error) {
    if (error instanceof ReleaseBuildError) {
      throw new ReleaseBuildError(
        error.code,
        `Sandboxed ${options.stage ?? "release"} step failed: ${error.message}`,
      );
    }
    throw error;
  }
}

async function proveSandboxNetworkDenied(sandbox, environment, cwd) {
  await runSandboxed(sandbox, process.execPath, [
    "--input-type=module",
    "-e",
    "const{connect}=await import('node:net');" +
      "const s=connect({host:'192.0.2.1',port:9});" +
      "s.once('connect',()=>process.exit(41));" +
      "s.once('error',e=>process.exit(" +
        "['EPERM','EACCES','ENETDOWN','ENETUNREACH'].includes(e.code)?0:42));",
  ], { cwd, env: environment, stage: "network self-test" });
}

function run(command, arguments_, options = {}) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let outputLimitExceeded = false;
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? repositoryRoot,
      detached: true,
      env: options.env,
      stdio: ["ignore", options.stdout ?? "pipe", "pipe"],
    });
    let stdout = "";
    let outputBytes = 0;
    let forceKillTimer;
    let timedOut = false;
    const processGroupId = child.pid;
    const signalGroup = (signal) => {
      if (!Number.isInteger(processGroupId) || processGroupId <= 1) return;
      try {
        process.kill(-processGroupId, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    };
    const stopGroup = () => {
      signalGroup("SIGTERM");
      forceKillTimer ??= setTimeout(() => signalGroup("SIGKILL"), 750);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stopGroup();
    }, options.timeout ?? 20 * 60_000);
    const collect = (kind, chunk) => {
      if (outputLimitExceeded) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAXIMUM_COMMAND_OUTPUT_BYTES) {
        outputLimitExceeded = true;
        stopGroup();
        return;
      }
      if (kind === "stdout") stdout += chunk;
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => collect("stdout", chunk));
    child.stderr?.on("data", (chunk) => collect("stderr", chunk));
    child.once("error", async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      try {
        await assertProcessGroupStopped(processGroupId);
        reject(outputLimitExceeded
          ? new ReleaseBuildError(
              "RELEASE_COMMAND_OUTPUT_LIMIT",
              "Release command exceeded the bounded output limit",
            )
          : error);
      } catch (cleanupError) {
        reject(cleanupError);
      }
    });
    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      try {
        await assertProcessGroupStopped(processGroupId);
      } catch (cleanupError) {
        reject(cleanupError);
        return;
      }
      if (timedOut) {
        reject(new ReleaseBuildError(
          "RELEASE_COMMAND_TIMEOUT",
          "Release command exceeded its bounded deadline",
        ));
        return;
      }
      if (outputLimitExceeded) {
        reject(new ReleaseBuildError(
          "RELEASE_COMMAND_OUTPUT_LIMIT",
          "Release command exceeded the bounded output limit",
        ));
        return;
      }
      if (code === 0 && signal === null) {
        resolvePromise(stdout);
        return;
      }
      reject(new ReleaseBuildError(
        "RELEASE_COMMAND_FAILED",
        `${basename(command)} failed${signal ? ` with signal ${signal}` : ` with status ${code}`}`,
      ));
    });
  });
}

function sourceControlEnvironment() {
  return {
    COPYFILE_DISABLE: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: "/var/empty",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TZ: "UTC",
  };
}

async function git(arguments_, options = {}) {
  return (await run("git", [
    "--no-replace-objects",
    `--git-dir=${join(repositoryRoot, ".git")}`,
    `--work-tree=${repositoryRoot}`,
    ...arguments_,
  ], { ...options, env: sourceControlEnvironment() })).trim();
}

async function assertImmutableCommit(commit) {
  let objectType;
  try {
    objectType = await git(["cat-file", "-t", commit]);
  } catch {
    fail("RELEASE_COMMIT_INVALID", "Requested Git commit does not exist");
  }
  if (objectType !== "commit") {
    fail("RELEASE_COMMIT_INVALID", "Requested Git object is not a commit");
  }
  const resolved = await git(["rev-parse", "--verify", `${commit}^{commit}`]);
  if (resolved !== commit) {
    fail("RELEASE_COMMIT_INVALID", "Requested commit did not resolve exactly");
  }
  const sourceTree = await git(["rev-parse", `${commit}^{tree}`]);
  if (!commitPattern.test(sourceTree)) {
    fail("RELEASE_COMMIT_INVALID", "Commit tree is invalid");
  }
  return sourceTree;
}

async function extractCommit(commit, sourceDirectory) {
  const archivePath = join(dirname(sourceDirectory), "source.tar");
  try {
    await run("git", [
      "--no-replace-objects",
      `--git-dir=${join(repositoryRoot, ".git")}`,
      `--work-tree=${repositoryRoot}`,
      "archive",
      "--format=tar",
      "--output",
      archivePath,
      commit,
    ], { cwd: repositoryRoot, env: sourceControlEnvironment() });
    await run("tar", ["-x", "-f", archivePath, "-C", sourceDirectory], {
      env: sourceControlEnvironment(),
    });
  } catch (error) {
    if (error instanceof ReleaseBuildError) {
      fail("RELEASE_ARCHIVE_FAILED", `Immutable source extraction failed: ${error.message}`);
    }
    throw error;
  } finally {
    await rm(archivePath, { force: true }).catch(() => {});
  }
}

async function normalizeExactLegacySourceModes(root) {
  let entriesSeen = 0;
  async function visit(directory, depth = 0) {
    if (depth > MAXIMUM_TREE_DEPTH) {
      fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy source tree is too deep");
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entriesSeen += 1;
      if (entriesSeen > MAXIMUM_TREE_ENTRIES) {
        fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy source tree has too many entries");
      }
      const path = join(directory, entry.name);
      const details = await lstat(path);
      if (!trustedOwner(details) || details.isSymbolicLink()) {
        fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy archive contains an unsafe entry");
      }
      if (details.isDirectory()) {
        await chmod(path, 0o755);
        await visit(path, depth + 1);
      } else if (details.isFile() && details.nlink === 1) {
        await chmod(path, details.mode & 0o111 ? 0o755 : 0o644);
      } else {
        fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy archive contains a special entry");
      }
    }
  }
  await visit(root);
}

async function prepareExactLegacyRuntimeSource(
  archivePath,
  legacySource,
  workRoot,
  expectedVersion,
) {
  const fixedArchive = await readFixedRegularFile(
    archivePath,
    "Exact v0.5.1 legacy source archive",
  );
  const archiveSha256 = createHash("sha256").update(fixedArchive.bytes).digest("hex");
  if (archiveSha256 !== exactLegacyRuntimeContract.archiveSha256) {
    fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy source archive is not exact v0.5.1");
  }
  const pinnedArchive = join(workRoot, "exact-v0.5.1.tar");
  await writeFile(pinnedArchive, fixedArchive.bytes, { flag: "wx", mode: 0o400 });
  await run("tar", ["-x", "-f", pinnedArchive, "-C", legacySource], {
    env: sourceControlEnvironment(),
  });
  await normalizeExactLegacySourceModes(legacySource);
  const original = await inspectTree(legacySource, { allowEnvironmentExample: true });
  const originalFiles = original.filter((entry) => entry.type === "file");
  const originalInventorySha256 = createHash("sha256")
    .update(JSON.stringify(original))
    .digest("hex");
  if (originalFiles.length !== exactLegacyRuntimeContract.trackedFiles) {
    fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy source inventory is incomplete");
  }
  if (originalInventorySha256 !== exactLegacyRuntimeContract.originalInventorySha256) {
    fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy source inventory is not exact v0.5.1");
  }
  for (const [path, expectedSha256] of Object.entries(exactLegacyRuntimeContract.files)) {
    const entry = originalFiles.find((candidate) => candidate.path === path);
    if (entry?.sha256 !== expectedSha256) {
      fail("RELEASE_LEGACY_RUNTIME_INVALID", `Legacy source blob changed: ${path}`);
    }
  }
  const packagePath = join(legacySource, "package.json");
  const lockPath = join(legacySource, "package-lock.json");
  const packageDocument = JSON.parse(await readFile(packagePath, "utf8"));
  const lockDocument = JSON.parse(await readFile(lockPath, "utf8"));
  if (
    packageDocument.version !== "0.5.1" || lockDocument.version !== "0.5.1" ||
    lockDocument.packages?.[""]?.version !== "0.5.1"
  ) {
    fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy version overlay source is invalid");
  }
  const originalLock = originalFiles.find((entry) => entry.path === "package-lock.json");
  const productionDependencies = Object.fromEntries(
    Object.keys(packageDocument.dependencies ?? {}).sort(bytewiseCompare).map((name) => {
      const version = lockDocument.packages?.[`node_modules/${name}`]?.version;
      if (typeof version !== "string" || !version) {
        fail(
          "RELEASE_LEGACY_RUNTIME_INVALID",
          `Legacy production dependency is not lock-bound: ${name}`,
        );
      }
      return [name, Object.freeze({
        requested: packageDocument.dependencies[name],
        version,
      })];
    }),
  );
  if (!originalLock?.sha256 || Object.keys(productionDependencies).length === 0) {
    fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy build inputs are incomplete");
  }
  packageDocument.version = expectedVersion;
  lockDocument.version = expectedVersion;
  lockDocument.packages[""].version = expectedVersion;
  await writeFile(packagePath, `${JSON.stringify(packageDocument, null, 2)}\n`, { mode: 0o600 });
  await writeFile(lockPath, `${JSON.stringify(lockDocument, null, 2)}\n`, { mode: 0o600 });
  const overlaid = await inspectTree(legacySource, { allowEnvironmentExample: true });
  const changedPaths = overlaid.filter((entry) => {
    const before = original.find((candidate) => candidate.path === entry.path);
    return JSON.stringify(before) !== JSON.stringify(entry);
  }).map((entry) => entry.path);
  if (JSON.stringify(changedPaths) !== JSON.stringify(["package-lock.json", "package.json"])) {
    fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy source overlay changed an unapproved path");
  }
  return Object.freeze({
    evidence: Object.freeze({
      archiveSha256,
      commitTree: exactLegacyRuntimeContract.commitTree,
      originalLockSha256: originalLock.sha256,
      originalInventorySha256,
      overlay: Object.freeze({
        "package-lock.json": await sha256File(lockPath),
        "package.json": await sha256File(packagePath),
      }),
      peeledCommit: exactLegacyRuntimeContract.peeledCommit,
      productionDependencies: Object.freeze(productionDependencies),
      tag: exactLegacyRuntimeContract.tag,
      trackedFiles: exactLegacyRuntimeContract.trackedFiles,
    }),
    overlaidInventory: overlaid,
  });
}

function normalizedRelativePath(path, label) {
  const parts = path.split("/");
  if (
    !path || path !== path.normalize("NFC") || path.includes("\0") ||
    path.includes("\\") || isAbsolute(path) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    fail("RELEASE_INPUT_UNSAFE", `${label} contains an unsafe path`);
  }
  return parts;
}

function isEnvironmentFileName(value) {
  const lower = value.toLowerCase();
  return lower === ".env" || lower.startsWith(".env.");
}

function isForbiddenPath(path) {
  const parts = normalizedRelativePath(path, "Release input");
  return parts.some((part) => {
    const lower = part.toLowerCase();
    return forbiddenSegments.has(lower) || lower === "node_modules" ||
      isEnvironmentFileName(part);
  });
}

function isForbiddenReleasePath(path) {
  const parts = normalizedRelativePath(path, "Release output");
  return parts.some((part) => {
    const lower = part.toLowerCase();
    return forbiddenSegments.has(lower) || isEnvironmentFileName(part);
  });
}

function isSensitiveArtifactPath(path) {
  return normalizedRelativePath(path, "Release input").some((part) =>
    /^(?:id_rsa|id_ed25519)$/i.test(part) || /\.(?:key|p12|pem|pfx)$/i.test(part),
  );
}

async function trackedPaths(commit) {
  const output = await git(["ls-tree", "-rz", "--full-tree", "-r", commit]);
  const entries = output.split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\t");
    const metadata = entry.slice(0, separator).split(" ");
    return { mode: metadata[0], type: metadata[1], path: entry.slice(separator + 1) };
  });
  if (!entries.length) fail("RELEASE_INPUT_UNSAFE", "Commit contains no release files");
  for (const entry of entries) {
    normalizedRelativePath(entry.path, "Git tree");
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      fail("RELEASE_INPUT_UNSAFE", "Git tree contains a link, submodule, or unsupported mode");
    }
    const environmentParts = normalizedRelativePath(entry.path, "Git tree")
      .filter(isEnvironmentFileName);
    const safeEnvironmentExample = entry.path === ".env.example" &&
      environmentParts.length === 1;
    if (
      (isForbiddenPath(entry.path) && !safeEnvironmentExample) ||
      isSensitiveArtifactPath(entry.path)
    ) {
      fail("RELEASE_INPUT_UNSAFE", `Git tree contains forbidden release input: ${entry.path}`);
    }
  }
  return entries;
}

async function trackedFileSnapshot(root, paths) {
  const snapshot = [];
  for (const entry of paths) {
    const path = join(root, entry.path);
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1) {
      fail("RELEASE_INPUT_CHANGED", "Extracted tracked file is unsafe");
    }
    snapshot.push(Object.freeze({
      mode: details.mode & 0o777,
      path: entry.path,
      sha256: await sha256File(path),
      size: details.size,
    }));
  }
  return snapshot;
}

async function sha256File(path) {
  const descriptor = await open(path, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
  try {
    const before = await descriptor.stat();
    if (
      !before.isFile() || before.nlink !== 1 || !trustedOwner(before) ||
      (before.mode & 0o022) !== 0 || before.size > MAXIMUM_FILE_BYTES
    ) {
      fail("RELEASE_INPUT_UNSAFE", "Release input file is unsafe");
    }
    const hash = createHash("sha256");
    for await (const chunk of descriptor.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await descriptor.stat();
    if (
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
      after.nlink !== 1
    ) {
      fail("RELEASE_INPUT_CHANGED", "Release input changed while hashing");
    }
    return hash.digest("hex");
  } finally {
    await descriptor.close();
  }
}

function sameFixedFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.uid === right.uid && left.gid === right.gid &&
    left.nlink === right.nlink && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readFixedRegularFile(path, label) {
  const before = await lstat(path).catch(() => undefined);
  if (
    !before?.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
    !trustedOwner(before) || (before.mode & 0o022) !== 0 ||
    !Number.isSafeInteger(before.size) || before.size < 0 || before.size > MAXIMUM_FILE_BYTES
  ) fail("RELEASE_OUTPUT_UNSAFE", `${label} is not a fixed safe regular file`);
  const descriptor = await open(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await descriptor.stat();
    if (!opened.isFile() || !sameFixedFile(before, opened)) {
      fail("RELEASE_OUTPUT_UNSAFE", `${label} changed before it was copied`);
    }
    const bytes = await descriptor.readFile();
    const openedAfter = await descriptor.stat();
    const pathAfter = await lstat(path).catch(() => undefined);
    if (
      bytes.length !== opened.size || !sameFixedFile(opened, openedAfter) ||
      !pathAfter?.isFile() || pathAfter.isSymbolicLink() ||
      !sameFixedFile(opened, pathAfter)
    ) fail("RELEASE_OUTPUT_UNSAFE", `${label} changed while it was copied`);
    return Object.freeze({ bytes, mode: opened.mode });
  } finally {
    await descriptor.close();
  }
}

async function inspectHostExecutable(path, name) {
  const canonical = await realpath(path).catch(() => undefined);
  const details = await lstat(path).catch(() => undefined);
  if (
    canonical !== path || basename(path) !== name ||
    !details?.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
    !trustedOwner(details) || (details.mode & 0o022) !== 0 ||
    (details.mode & 0o111) === 0
  ) {
    fail("RELEASE_RUNTIME_INVALID", `Required ${name} executable is unsafe`);
  }
  const version = (await run(path, ["-version"], {
    env: sourceControlEnvironment(),
  })).trim();
  if (!version.startsWith(`${name} version `) || version.length > 64 * 1024) {
    fail("RELEASE_RUNTIME_INVALID", `Required ${name} version output is invalid`);
  }
  return Object.freeze({
    arguments: Object.freeze(["-version"]),
    name,
    path,
    required: true,
    sha256: await sha256File(path),
    versionOutputSha256: createHash("sha256").update(version).digest("hex"),
    versionPattern: `^${name} version [^\\r\\n]+(?:\\r?\\n[\\s\\S]*)?$`,
  });
}

async function inspectNodeExecutable(path) {
  const canonical = await realpath(path).catch(() => undefined);
  const details = await lstat(path).catch(() => undefined);
  if (
    canonical !== path || basename(path) !== "node" ||
    !details?.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
    !trustedOwner(details) || (details.mode & 0o022) !== 0 ||
    (details.mode & 0o111) === 0
  ) fail("RELEASE_RUNTIME_INVALID", "Required Node executable is unsafe");
  const version = (await run(path, ["--version"], {
    env: sourceControlEnvironment(),
  })).trim();
  if (version !== `v${REQUIRED_NODE_VERSION}`) {
    fail("RELEASE_RUNTIME_INVALID", "Required Node executable has the wrong version");
  }
  return Object.freeze({
    arguments: Object.freeze(["--version"]),
    name: "node",
    path,
    required: true,
    sha256: await sha256File(path),
    versionOutputSha256: createHash("sha256").update(version).digest("hex"),
    versionPattern: `^v${REQUIRED_NODE_VERSION.replaceAll(".", "\\.")}$`,
  });
}

async function assertGeneratedNpmBinDirectory(path, nodeModulesRoot) {
  const directoryBefore = await lstat(path);
  if (
    !directoryBefore.isDirectory() || directoryBefore.isSymbolicLink() ||
    !trustedOwner(directoryBefore) || (directoryBefore.mode & 0o022) !== 0
  ) {
    fail("RELEASE_OUTPUT_UNSAFE", "node_modules/.bin is not a trusted npm directory");
  }
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > MAXIMUM_TREE_ENTRIES) {
    fail("RELEASE_OUTPUT_UNSAFE", "node_modules/.bin contains too many entries");
  }
  for (const entry of entries) {
    const linkPath = join(path, entry.name);
    const linkBefore = await lstat(linkPath);
    if (
      !entry.isSymbolicLink() || !linkBefore.isSymbolicLink() ||
      linkBefore.nlink !== 1 || !trustedOwner(linkBefore)
    ) {
      fail("RELEASE_OUTPUT_UNSAFE", "node_modules/.bin contains a non-npm link entry");
    }
    const target = await readlink(linkPath);
    const targetPath = resolve(dirname(linkPath), target);
    if (
      !target || isAbsolute(target) || target !== target.normalize("NFC") ||
      /[\0\r\n]/.test(target) || Buffer.byteLength(target, "utf8") > MAXIMUM_PATH_BYTES ||
      !containsPath(nodeModulesRoot, targetPath)
    ) {
      fail("RELEASE_OUTPUT_UNSAFE", "node_modules/.bin contains an unsafe link target");
    }
    const targetDetails = await lstat(targetPath).catch(() => undefined);
    const linkAfter = await lstat(linkPath).catch(() => undefined);
    if (
      !targetDetails?.isFile() || targetDetails.isSymbolicLink() ||
      targetDetails.nlink !== 1 || !trustedOwner(targetDetails) ||
      (targetDetails.mode & 0o022) !== 0 ||
      !linkAfter?.isSymbolicLink() || linkAfter.nlink !== 1 || !trustedOwner(linkAfter) ||
      linkAfter.dev !== linkBefore.dev || linkAfter.ino !== linkBefore.ino ||
      linkAfter.mtimeMs !== linkBefore.mtimeMs || linkAfter.ctimeMs !== linkBefore.ctimeMs
    ) {
      fail("RELEASE_OUTPUT_UNSAFE", "node_modules/.bin changed or targets unsafe runtime input");
    }
  }
  const directoryAfter = await lstat(path).catch(() => undefined);
  if (
    !directoryAfter?.isDirectory() || directoryAfter.isSymbolicLink() ||
    directoryAfter.dev !== directoryBefore.dev || directoryAfter.ino !== directoryBefore.ino ||
    directoryAfter.mtimeMs !== directoryBefore.mtimeMs ||
    directoryAfter.ctimeMs !== directoryBefore.ctimeMs
  ) {
    fail("RELEASE_OUTPUT_UNSAFE", "node_modules/.bin changed while it was validated");
  }
}

async function assertEmptyPlaywrightScopeDirectory(path) {
  const directoryBefore = await lstat(path).catch(() => undefined);
  if (
    !directoryBefore?.isDirectory() || directoryBefore.isSymbolicLink() ||
    !trustedOwner(directoryBefore) || (directoryBefore.mode & 0o022) !== 0
  ) {
    fail(
      "RELEASE_OUTPUT_UNSAFE",
      "node_modules/@playwright is not a trusted empty npm scope directory",
    );
  }
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length !== 0) {
    fail(
      "RELEASE_RUNTIME_INVALID",
      "Runtime dependency closure retained a Playwright development package",
    );
  }
  const directoryAfter = await lstat(path).catch(() => undefined);
  if (
    !directoryAfter?.isDirectory() || directoryAfter.isSymbolicLink() ||
    !sameFixedFile(directoryBefore, directoryAfter)
  ) {
    fail(
      "RELEASE_OUTPUT_UNSAFE",
      "node_modules/@playwright changed while it was validated",
    );
  }
}

async function inspectTree(
  root,
  {
    allowEnvironmentExample = false,
    allowNodeModules = false,
    excludeIncomplete = false,
    excludeManifest = false,
    excludeNodeModulesBin = false,
  } = {},
) {
  const files = [];
  const budget = {
    bytes: 0,
    entries: 0,
    maximumBytes: MAXIMUM_TREE_BYTES,
    maximumEntries: MAXIMUM_TREE_ENTRIES,
  };
  async function visit(directory, prefix = "", depth = 0) {
    if (depth > MAXIMUM_TREE_DEPTH) {
      fail("RELEASE_INPUT_UNSAFE", "Release tree exceeds the maximum depth");
    }
    const directoryBefore = await lstat(directory).catch(() => undefined);
    if (
      !directoryBefore?.isDirectory() || directoryBefore.isSymbolicLink() ||
      !trustedOwner(directoryBefore) || (directoryBefore.mode & 0o022) !== 0
    ) fail("RELEASE_OUTPUT_UNSAFE", "Release tree directory is unsafe");
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > MAXIMUM_TREE_ENTRIES - budget.entries) {
      fail("RELEASE_INPUT_UNSAFE", "Release tree exceeds the maximum entry count");
    }
    entries.sort((left, right) => bytewiseCompare(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (
        excludeNodeModulesBin && entry.name === ".bin" &&
        basename(directory) === "node_modules"
      ) {
        await assertGeneratedNpmBinDirectory(path, directory);
        continue;
      }
      if (excludeIncomplete && relativePath === ".incomplete") continue;
      if (excludeManifest && relativePath === "release-manifest.json") continue;
      normalizedRelativePath(relativePath, "Release tree");
      if (
        ((isForbiddenReleasePath(relativePath) ||
          (!allowNodeModules && normalizedRelativePath(relativePath, "Release tree").includes("node_modules"))) &&
          !(allowEnvironmentExample && relativePath === ".env.example")) ||
        isSensitiveArtifactPath(relativePath)
      ) {
        fail("RELEASE_OUTPUT_UNSAFE", `Release output contains forbidden path: ${relativePath}`);
      }
      const details = await lstat(path);
      accountTreeEntry(budget, relativePath, details, "Release tree");
      if (
        !trustedOwner(details) || (details.mode & 0o022) !== 0 ||
        (details.isFile() && details.nlink !== 1)
      ) {
        fail("RELEASE_OUTPUT_UNSAFE", "Release output has unsafe ownership, mode, or links");
      }
      if (details.isDirectory()) {
        files.push({ mode: details.mode & 0o777, path: relativePath, type: "directory" });
        await visit(path, relativePath, depth + 1);
      } else if (details.isFile() && !details.isSymbolicLink()) {
        const sha256 = await sha256File(path);
        const detailsAfter = await lstat(path).catch(() => undefined);
        if (!detailsAfter?.isFile() || !sameFixedFile(details, detailsAfter)) {
          fail("RELEASE_OUTPUT_UNSAFE", "Release output changed while it was inventoried");
        }
        files.push({
          mode: details.mode & 0o777,
          path: relativePath,
          sha256,
          size: details.size,
          type: "file",
        });
      } else {
        fail(
          "RELEASE_OUTPUT_UNSAFE",
          `Release output contains a link or special file: ${relativePath}`,
        );
      }
    }
    const directoryAfter = await lstat(directory).catch(() => undefined);
    if (
      !directoryAfter?.isDirectory() || directoryAfter.isSymbolicLink() ||
      !sameFixedFile(directoryBefore, directoryAfter)
    ) fail("RELEASE_OUTPUT_UNSAFE", "Release tree changed while it was inventoried");
  }
  await visit(root);
  return files;
}

async function copyRuntimeTree(source, destination, relativePath, options = {}) {
  const budget = options.budget ?? {
    bytes: 0,
    entries: 0,
    maximumBytes: MAXIMUM_TREE_BYTES,
    maximumEntries: MAXIMUM_TREE_ENTRIES,
  };
  const depth = options.depth ?? normalizedRelativePath(relativePath, "Runtime output").length;
  if (depth > MAXIMUM_TREE_DEPTH) {
    fail("RELEASE_OUTPUT_UNSAFE", "Runtime output exceeds the maximum depth");
  }
  const sourcePath = join(source, relativePath);
  const destinationPath = join(destination, relativePath);
  const details = await lstat(sourcePath);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    fail("RELEASE_OUTPUT_UNSAFE", `${relativePath} build output is not a directory`);
  }
  await mkdir(destinationPath, { mode: 0o700 });
  const sourceEntries = await readdir(sourcePath, { withFileTypes: true });
  if (sourceEntries.length > MAXIMUM_TREE_ENTRIES - budget.entries) {
    fail("RELEASE_OUTPUT_UNSAFE", "Runtime output exceeds the maximum entry count");
  }
  for (const entry of sourceEntries) {
    if (options.skipBin && relativePath === "node_modules" && entry.name === ".bin") {
      await assertGeneratedNpmBinDirectory(
        join(source, "node_modules/.bin"),
        join(source, "node_modules"),
      );
      continue;
    }
    if (
      options.skipBin && relativePath === "node_modules" &&
      entry.name === "@playwright"
    ) {
      await assertEmptyPlaywrightScopeDirectory(
        join(source, "node_modules/@playwright"),
      );
      continue;
    }
    const entryRelative = `${relativePath}/${entry.name}`;
    normalizedRelativePath(entryRelative, "Runtime output");
    if (isForbiddenReleasePath(entryRelative) || isSensitiveArtifactPath(entryRelative)) {
      fail("RELEASE_OUTPUT_UNSAFE", `Runtime output contains forbidden path: ${entryRelative}`);
    }
    const input = join(source, entryRelative);
    const output = join(destination, entryRelative);
    const entryDetails = await lstat(input);
    accountTreeEntry(budget, entryRelative, entryDetails, "Runtime output");
    if (entryDetails.isDirectory() && !entryDetails.isSymbolicLink()) {
      await copyRuntimeTree(source, destination, entryRelative, {
        ...options,
        budget,
        depth: depth + 1,
      });
    } else if (entryDetails.isFile() && !entryDetails.isSymbolicLink()) {
      const fixed = await readFixedRegularFile(input, "Runtime output file");
      await writeFile(output, fixed.bytes, {
        flag: "wx",
        mode: fixed.mode & 0o111 ? 0o500 : 0o400,
      });
    } else {
      fail("RELEASE_OUTPUT_UNSAFE", "Runtime output contains a link or special file");
    }
  }
  const directoryAfter = await lstat(sourcePath).catch(() => undefined);
  if (
    !directoryAfter?.isDirectory() || directoryAfter.isSymbolicLink() ||
    !sameFixedFile(details, directoryAfter)
  ) fail("RELEASE_OUTPUT_UNSAFE", "Runtime output directory changed while it was copied");
  await chmod(destinationPath, 0o500);
}

async function hardenRuntimeDirectories(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await hardenRuntimeDirectories(join(directory, entry.name));
  }
  await chmod(directory, 0o500);
}

async function syncDirectory(path) {
  const descriptor = openSync(path, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function createReservation(path) {
  await mkdir(path, { mode: 0o700 });
  const directory = await lstat(path);
  let marker;
  try {
    await writeFile(join(path, ".incomplete"), "release build in progress\n", {
      flag: "wx",
      mode: 0o600,
    });
    await syncDirectory(dirname(path));
    marker = await lstat(join(path, ".incomplete"));
  } catch {
    await writeFile(join(path, ".incomplete"), "release build in progress\n", {
      flag: "a",
      mode: 0o600,
    }).catch(() => {});
    throw new ReleaseBuildError(
      "RELEASE_RESERVATION_FAILED",
      "Release reservation could not be durably marked incomplete",
    );
  }
  return Object.freeze({
    directory: Object.freeze({ dev: directory.dev, ino: directory.ino, uid: directory.uid }),
    marker: Object.freeze({ dev: marker.dev, ino: marker.ino, uid: marker.uid }),
  });
}

function sameIdentity(details, identity) {
  return details.dev === identity.dev && details.ino === identity.ino &&
    details.uid === identity.uid;
}

async function assertPinnedDirectory(root, label) {
  const details = await lstat(root.path).catch(() => undefined);
  if (
    !details?.isDirectory() || details.isSymbolicLink() ||
    !sameIdentity(details, root.identity) || (details.mode & 0o022) !== 0
  ) fail("RELEASE_PATH_UNSAFE", `${label} changed during release creation`);
}

async function assertPinnedReservation(path, identity) {
  const [directory, marker, markerBytes] = await Promise.all([
    lstat(path),
    lstat(join(path, ".incomplete")),
    readFile(join(path, ".incomplete"), "utf8"),
  ]);
  if (
    !directory?.isDirectory() || directory.isSymbolicLink() ||
    !marker?.isFile() || marker.isSymbolicLink() || marker.nlink !== 1 ||
    !sameIdentity(directory, identity.directory) ||
    !sameIdentity(marker, identity.marker) || markerBytes !== "release build in progress\n"
  ) fail("RELEASE_TARGET_CHANGED", "Release reservation identity changed");
}

async function syncFile(path) {
  const descriptor = openSync(path, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function verifyNetworkAudit(path) {
  const details = await lstat(path);
  if (
    !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
    !trustedOwner(details) || (details.mode & 0o077) !== 0 ||
    details.size <= 0 || details.size > 1024 * 1024
  ) fail("RELEASE_SANDBOX_INVALID", "Build network audit is unsafe");
  let events;
  try {
    events = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  } catch {
    fail("RELEASE_SANDBOX_INVALID", "Build network audit is malformed");
  }
  const guardLoads = events.filter((entry) => entry?.event === "node_guard_loaded");
  if (
    guardLoads.length < 2 ||
    events.some((entry) => entry?.event !== "node_guard_loaded") ||
    guardLoads.some((entry) =>
      entry.node !== REQUIRED_NODE_VERSION ||
      JSON.stringify(entry.initialAllowedPorts) !== "[1]"
    )
  ) fail("RELEASE_SANDBOX_INVALID", "Build network guard audit did not satisfy the offline contract");
  return Object.freeze({ blockedAttempts: 0, guardLoads: guardLoads.length });
}

async function removePrivateBuildScratch(path, scratchRoot) {
  const canonical = await realpath(path).catch(() => undefined);
  if (canonical !== path || !containsPath(scratchRoot, path) || path === scratchRoot) {
    fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch path is no longer private");
  }
  async function makeDirectoriesWritable(directory, depth = 0) {
    if (depth > MAXIMUM_TREE_DEPTH) {
      fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch tree is too deep");
    }
    const before = await lstat(directory).catch(() => undefined);
    if (
      !before?.isDirectory() || before.isSymbolicLink() ||
      !trustedOwner(before) || (before.mode & 0o022) !== 0
    ) {
      fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch directory is unsafe");
    }
    await chmod(directory, 0o700);
    const opened = await lstat(directory).catch(() => undefined);
    if (
      !opened?.isDirectory() || opened.isSymbolicLink() ||
      opened.dev !== before.dev || opened.ino !== before.ino ||
      opened.uid !== before.uid || (opened.mode & 0o777) !== 0o700
    ) {
      fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch directory changed");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > MAXIMUM_TREE_ENTRIES) {
      fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch tree has too many entries");
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      const details = await lstat(entryPath).catch(() => undefined);
      if (!details || !trustedOwner(details)) {
        fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch entry is unsafe");
      }
      if (details.isDirectory() && !details.isSymbolicLink()) {
        await makeDirectoriesWritable(entryPath, depth + 1);
      } else if (
        !details.isFile() && !details.isSymbolicLink()
      ) {
        fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch contains a special entry");
      }
    }
  }
  await makeDirectoriesWritable(path);
  await rm(path, { recursive: true });
  if (await lstat(path).then(() => true, () => false)) {
    fail("RELEASE_SCRATCH_CLEANUP_FAILED", "Build scratch residue remains");
  }
}

async function cleanupPrivateBuildScratch(path, scratchRoot) {
  try {
    await assertPinnedDirectory(scratchRoot, "Scratch root");
    await removePrivateBuildScratch(path, scratchRoot.path);
    await assertPinnedDirectory(scratchRoot, "Scratch root");
  } catch {
    throw new ReleaseBuildError(
      "RELEASE_SCRATCH_CLEANUP_FAILED",
      "Private release build scratch could not be removed completely",
    );
  }
}

async function main() {
  if (process.versions.node !== REQUIRED_NODE_VERSION) {
    fail("RELEASE_RUNTIME_INVALID", `Node ${REQUIRED_NODE_VERSION} is required`);
  }
  const options = parseArguments(process.argv.slice(2));
  const roots = await assertPathRoots(options);
  if (await git(["status", "--porcelain=v1", "--untracked-files=all"])) {
    fail("RELEASE_INPUT_DIRTY", "Repository working tree must be clean");
  }
  const sourceTree = await assertImmutableCommit(options.commit);
  const committedPaths = await trackedPaths(options.commit);
  const sandboxPrerequisite = process.platform === "linux"
    ? await assertBubblewrapExecutable()
    : undefined;
  const hostPrerequisites = Object.freeze({
    executables: Object.freeze(await Promise.all([
      inspectNodeExecutable(process.execPath),
      inspectHostExecutable(options.ffmpegExecutable, "ffmpeg"),
      inspectHostExecutable(options.ffprobeExecutable, "ffprobe"),
    ])),
    sandbox: sandboxPrerequisite,
  });
  const target = join(roots.release.path, options.releaseId);
  let reservationIdentity;
  let workRoot;
  try {
    await assertPinnedDirectory(roots.cache, "npm cache");
    await assertPinnedDirectory(roots.release, "Release root");
    await assertPinnedDirectory(roots.scratch, "Scratch root");
    try {
      reservationIdentity = await createReservation(target);
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("RELEASE_TARGET_EXISTS", "Release target or reservation already exists");
      }
      const targetExists = await lstat(target).then(
        (details) => details.isDirectory() && !details.isSymbolicLink(),
        () => false,
      );
      if (targetExists && error && typeof error === "object") {
        error.message = `${error.message}; fail-closed release reservation retained`;
      }
      throw error;
    }
    workRoot = await mkdtemp(join(roots.scratch.path, "release-build-"));
    await chmod(workRoot, 0o700);
    const source = join(workRoot, "source");
    const runtimeSource = join(workRoot, "runtime-source");
    const viteCache = join(workRoot, "vite-cache");
    const legacySource = options.releaseRole === "bridge"
      ? join(source, ".unboundry-legacy-build")
      : undefined;
    const legacyViteCache = options.releaseRole === "bridge"
      ? join(workRoot, "legacy-vite-cache")
      : undefined;
    const home = join(workRoot, "home");
    const networkAudit = join(workRoot, "network-audit.jsonl");
    const installSandboxProfile = join(workRoot, "install.sb");
    const buildSandboxProfile = join(workRoot, "build.sb");
    const npmCache = roots.cache.path;
    await Promise.all([
      mkdir(source, { mode: 0o700 }),
      mkdir(runtimeSource, { mode: 0o700 }),
      mkdir(viteCache, { mode: 0o700 }),
      ...(legacyViteCache ? [mkdir(legacyViteCache, { mode: 0o700 })] : []),
      mkdir(home, { mode: 0o700 }),
    ]);
    if (legacySource) await mkdir(legacySource, { mode: 0o700 });
    await writeFile(networkAudit, "", { flag: "wx", mode: 0o600 });
    await extractCommit(options.commit, source);
    const installSandboxDocument = await createBuildSandbox(installSandboxProfile, {
      auditFile: networkAudit,
      home,
      npmCache,
      source,
      writablePaths: [
        source,
        runtimeSource,
        viteCache,
        ...(legacySource ? [legacySource] : []),
        ...(legacyViteCache ? [legacyViteCache] : []),
      ],
    });
    const extractedPaths = await inspectTree(source, { allowEnvironmentExample: true });
    const extractedFiles = extractedPaths.filter((entry) => entry.type === "file");
    const committedFileNames = committedPaths.map((entry) => entry.path).sort();
    const extractedFileNames = extractedFiles.map((entry) => entry.path).sort();
    if (
      extractedFileNames.length !== committedFileNames.length ||
      extractedFileNames.some((entry, index) => entry !== committedFileNames[index])
    ) {
      fail("RELEASE_INPUT_CHANGED", "Extracted immutable source differs from the Git tree");
    }
    const trackedBefore = await trackedFileSnapshot(source, committedPaths);
    const packageDocument = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    const packageLockDocument = JSON.parse(
      await readFile(join(source, "package-lock.json"), "utf8"),
    );
    if (
      packageDocument.packageManager !== `npm@${REQUIRED_NPM_VERSION}` ||
      packageDocument.engines?.npm !== REQUIRED_NPM_VERSION ||
      !String(packageDocument.engines?.node ?? "").includes(REQUIRED_NODE_VERSION) ||
      typeof packageDocument.version !== "string" || !packageDocument.version
    ) {
      fail("RELEASE_RUNTIME_INVALID", "Commit does not pin the required Node/npm release runtime");
    }
    if (
      packageDocument.version !== options.expectedVersion ||
      packageLockDocument.version !== options.expectedVersion ||
      packageLockDocument.packages?.[""]?.version !== options.expectedVersion
    ) {
      fail(
        "RELEASE_VERSION_INVALID",
        "package.json and both package-lock root versions must match the expected version",
      );
    }
    if (packageDocument.scripts?.build !== "tsc --noEmit && vite build") {
      fail("RELEASE_RUNTIME_INVALID", "Release build entry is not an approved deterministic build");
    }
    const legacyPreparation = legacySource
      ? await prepareExactLegacyRuntimeSource(
          options.legacySourceArchive,
          legacySource,
          workRoot,
          options.expectedVersion,
        )
      : undefined;
    if (legacyPreparation) {
      for (const [name, dependency] of Object.entries(
        legacyPreparation.evidence.productionDependencies,
      )) {
        const currentVersion = packageLockDocument.packages?.[`node_modules/${name}`]?.version;
        if (
          packageDocument.dependencies?.[name] !== dependency.requested ||
          currentVersion !== dependency.version
        ) {
          fail(
            "RELEASE_LEGACY_RUNTIME_INVALID",
            `Parent release dependency is incompatible with the legacy runtime: ${name}`,
          );
        }
      }
    }
    const npmCli = join(dirname(dirname(process.execPath)), "lib/node_modules/npm/bin/npm-cli.js");
    if (await run(process.execPath, [npmCli, "--version"], {
      cwd: source,
      env: {
        ...cleanEnvironment(home, npmCache, networkAudit),
        NODE_OPTIONS: "",
        UNBOUNDRY_OFFLINE_GUARD_ALLOWED_PORTS: "",
        UNBOUNDRY_OFFLINE_GUARD_AUDIT: "",
        UNBOUNDRY_OFFLINE_GUARD_MODE: "",
      },
    }).then((value) => value.trim()) !== REQUIRED_NPM_VERSION) {
      fail("RELEASE_RUNTIME_INVALID", `npm ${REQUIRED_NPM_VERSION} is required`);
    }
    const lockBefore = createHash("sha256").update(await readFile(join(source, "package-lock.json"))).digest("hex");
    const environment = {
      ...guardedCommandEnvironment(
        home,
        npmCache,
        networkAudit,
        join(source, "scripts/offline-network-guard.mjs"),
      ),
      NODE_ENV: "production",
      UNBOUNDRY_VITE_CACHE_DIR: viteCache,
    };
    const unguardedEnvironment = {
      ...cleanEnvironment(home, npmCache, networkAudit),
      NODE_OPTIONS: "",
      UNBOUNDRY_OFFLINE_GUARD_ALLOWED_PORTS: "",
      UNBOUNDRY_OFFLINE_GUARD_AUDIT: "",
      UNBOUNDRY_OFFLINE_GUARD_MODE: "",
    };
    await proveSandboxNetworkDenied(
      installSandboxDocument,
      unguardedEnvironment,
      source,
    );
    await runSandboxed(installSandboxDocument, process.execPath, [npmCli, "ci", "--offline", "--ignore-scripts", "--include=dev", "--no-audit", "--no-fund"], {
      cwd: source,
      env: unguardedEnvironment,
      stage: "build dependency install",
    });
    if (legacySource) {
      await runSandboxed(installSandboxDocument, process.execPath, [
        npmCli,
        "ci",
        "--offline",
        "--ignore-scripts",
        "--include=dev",
        "--no-audit",
        "--no-fund",
      ], {
        cwd: legacySource,
        env: unguardedEnvironment,
        stage: "exact v0.5.1 legacy dependency install",
      });
    }
    await mkdir(join(source, "node_modules"), { mode: 0o700 }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
    const dependenciesBeforeBuild = await inspectTree(join(source, "node_modules"), {
      allowNodeModules: true,
      excludeNodeModulesBin: true,
    });
    const legacyDependenciesBeforeBuild = legacySource
      ? await inspectTree(join(legacySource, "node_modules"), {
          allowNodeModules: true,
          excludeNodeModulesBin: true,
        })
      : undefined;
    const distDirectory = join(source, "dist");
    await mkdir(distDirectory, { mode: 0o700 });
    const legacyDistDirectory = legacySource ? join(legacySource, "dist") : undefined;
    if (legacyDistDirectory) await mkdir(legacyDistDirectory, { mode: 0o700 });
    const buildSandboxDocument = await createBuildSandbox(buildSandboxProfile, {
      auditFile: networkAudit,
      home,
      npmCache,
      source,
      writablePaths: [
        distDirectory,
        viteCache,
        ...(legacyDistDirectory ? [legacyDistDirectory] : []),
        ...(legacyViteCache ? [legacyViteCache] : []),
      ],
    });
    await proveSandboxNetworkDenied(buildSandboxDocument, unguardedEnvironment, source);
    const lockAfterInstall = createHash("sha256").update(await readFile(join(source, "package-lock.json"))).digest("hex");
    if (lockAfterInstall !== lockBefore) fail("RELEASE_INPUT_CHANGED", "npm ci changed package-lock.json");
    await runSandboxed(buildSandboxDocument, process.execPath, [
      join(source, "node_modules/typescript/bin/tsc"),
      "--noEmit",
    ], { cwd: source, env: environment, stage: "TypeScript validation" });
    await runSandboxed(buildSandboxDocument, process.execPath, [
      join(source, "node_modules/vite/bin/vite.js"),
      "build",
      "--configLoader",
      "runner",
    ], { cwd: source, env: environment, stage: "production build" });
    if (legacySource && legacyViteCache) {
      const legacyEnvironment = {
        ...environment,
        UNBOUNDRY_VITE_CACHE_DIR: legacyViteCache,
      };
      await runSandboxed(buildSandboxDocument, process.execPath, [
        join(legacySource, "node_modules/typescript/bin/tsc"),
        "--noEmit",
      ], {
        cwd: legacySource,
        env: legacyEnvironment,
        stage: "exact v0.5.1 legacy TypeScript validation",
      });
      await runSandboxed(buildSandboxDocument, process.execPath, [
        join(legacySource, "node_modules/vite/bin/vite.js"),
        "build",
        "--configLoader",
        "runner",
      ], {
        cwd: legacySource,
        env: legacyEnvironment,
        stage: "exact v0.5.1 legacy production build",
      });
    }
    const dependenciesAfterBuild = await inspectTree(join(source, "node_modules"), {
      allowNodeModules: true,
      excludeNodeModulesBin: true,
    });
    if (JSON.stringify(dependenciesAfterBuild) !== JSON.stringify(dependenciesBeforeBuild)) {
      fail("RELEASE_INPUT_CHANGED", "Production build changed installed dependencies");
    }
    if (legacySource) {
      const legacyDependenciesAfterBuild = await inspectTree(
        join(legacySource, "node_modules"),
        { allowNodeModules: true, excludeNodeModulesBin: true },
      );
      if (
        JSON.stringify(legacyDependenciesAfterBuild) !==
          JSON.stringify(legacyDependenciesBeforeBuild)
      ) {
        fail("RELEASE_INPUT_CHANGED", "Legacy build changed installed dependencies");
      }
      const legacyAfterBuild = (await inspectTree(legacySource, {
        allowEnvironmentExample: true,
        allowNodeModules: true,
        excludeNodeModulesBin: true,
      })).filter((entry) =>
        entry.path !== "dist" && !entry.path.startsWith("dist/") &&
        entry.path !== "node_modules" && !entry.path.startsWith("node_modules/")
      );
      if (JSON.stringify(legacyAfterBuild) !== JSON.stringify(legacyPreparation.overlaidInventory)) {
        fail("RELEASE_INPUT_CHANGED", "Legacy build changed the approved source overlay");
      }
    }
    const lockAfterBuild = createHash("sha256").update(await readFile(join(source, "package-lock.json"))).digest("hex");
    if (lockAfterBuild !== lockBefore) fail("RELEASE_INPUT_CHANGED", "Production build changed package-lock.json");
    const trackedAfter = await trackedFileSnapshot(source, committedPaths);
    if (JSON.stringify(trackedAfter) !== JSON.stringify(trackedBefore)) {
      fail("RELEASE_INPUT_CHANGED", "Production build changed immutable source input");
    }
    if (await assertImmutableCommit(options.commit) !== sourceTree) {
      fail("RELEASE_INPUT_CHANGED", "Requested Git commit changed during release creation");
    }
    let legacyPublication;
    let legacyRuntimeEvidence;
    if (legacySource && legacyPreparation) {
      await rm(join(legacySource, "node_modules"), { recursive: true });
      legacyPublication = join(runtimeSource, "legacy-runtime");
      await mkdir(legacyPublication, { mode: 0o700 });
      for (const path of [
        "dist",
        "client",
        "server",
        "types",
        "vite.config.ts",
        "package.json",
        "package-lock.json",
        "spec/unboundry-state-fixtures.json",
      ]) {
        const input = join(legacySource, path);
        const details = await lstat(input);
        if (details.isDirectory() && !details.isSymbolicLink()) {
          await copyRuntimeTree(legacySource, legacyPublication, path);
        } else if (details.isFile() && !details.isSymbolicLink()) {
          await mkdir(dirname(join(legacyPublication, path)), {
            recursive: true,
            mode: 0o700,
          });
          const fixed = await readFixedRegularFile(input, "Legacy runtime output file");
          await writeFile(join(legacyPublication, path), fixed.bytes, {
            flag: "wx",
            mode: fixed.mode & 0o111 ? 0o500 : 0o400,
          });
        } else {
          fail("RELEASE_OUTPUT_UNSAFE", "Legacy runtime output is unsafe");
        }
      }
      await hardenRuntimeDirectories(legacyPublication);
      const inventory = await inspectTree(legacyPublication);
      const legacyIndex = inventory.find((entry) =>
        entry.type === "file" && entry.path === "dist/client/index.html"
      );
      if (!legacyIndex?.sha256 || !legacyIndex.size) {
        fail("RELEASE_LEGACY_RUNTIME_INVALID", "Legacy client build is incomplete");
      }
      legacyRuntimeEvidence = Object.freeze({
        ...legacyPreparation.evidence,
        clientIndexSha256: legacyIndex.sha256,
        inventorySha256: createHash("sha256").update(JSON.stringify(inventory)).digest("hex"),
        runtimeDependencyResolution: "parent-release-node_modules",
        version: options.expectedVersion,
      });
    }
    for (const path of ["package.json", "package-lock.json"]) {
      await writeFile(join(runtimeSource, path), await readFile(join(source, path)), {
        flag: "wx",
        mode: 0o400,
      });
    }
    await runSandboxed(installSandboxDocument, process.execPath, [
      npmCli,
      "ci",
      "--offline",
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
    ], {
      cwd: runtimeSource,
      env: unguardedEnvironment,
      stage: "runtime dependency install",
    });
    const runtimeDependencies = await inspectTree(join(runtimeSource, "node_modules"), {
      allowNodeModules: true,
      excludeNodeModulesBin: true,
    });
    if (
      !runtimeDependencies.some((entry) => entry.path === "vite/bin/vite.js") ||
      !runtimeDependencies.some((entry) => entry.path === "@vitejs/plugin-react/dist/index.js") ||
      runtimeDependencies.some((entry) =>
        entry.path === "typescript" || entry.path.startsWith("typescript/") ||
        // npm may retain an empty scope directory after --omit=dev. Only an
        // entry below that scope proves that a Playwright package was kept.
        (entry.path === "@playwright" && entry.type !== "directory") ||
        entry.path.startsWith("@playwright/")
      )
    ) {
      fail("RELEASE_RUNTIME_INVALID", "Runtime dependency closure is incomplete or includes development tools");
    }
    let legacyParentDependencyConfigLoadSmoke = false;
    if (legacyPublication && legacyPreparation) {
      const legacyInventoryBeforeSmoke = await inspectTree(legacyPublication);
      const legacyDependencySmoke = String.raw`
        import { readFile } from "node:fs/promises";
        import { createRequire } from "node:module";
        import { join, sep } from "node:path";
        import { pathToFileURL } from "node:url";
        const [parentRoot, legacyRoot, dependenciesJson] = process.argv.slice(1);
        const requireFromLegacy = createRequire(join(legacyRoot, "package.json"));
        const parentNodeModules = join(parentRoot, "node_modules") + sep;
        const dependencies = JSON.parse(dependenciesJson);
        for (const name of dependencies) {
          const resolved = requireFromLegacy.resolve(name);
          if (!resolved.startsWith(parentNodeModules)) {
            throw new Error(
              "legacy dependency did not resolve from parent release node_modules: " + name,
            );
          }
        }
        const vitePath = requireFromLegacy.resolve("vite");
        const vite = await import(pathToFileURL(vitePath).href);
        process.chdir(legacyRoot);
        const loaded = await vite.loadConfigFromFile(
          { command: "serve", isPreview: true, isSsrBuild: false, mode: "production" },
          join(legacyRoot, "vite.config.ts"),
          legacyRoot,
          "silent",
          undefined,
          "runner",
        );
        if (!loaded?.config) throw new Error("legacy Vite config did not load");
        JSON.parse(await readFile(join(legacyRoot, "package.json"), "utf8"));
      `;
      await runSandboxed(installSandboxDocument, process.execPath, [
        "--input-type=module",
        "-e",
        legacyDependencySmoke,
        runtimeSource,
        legacyPublication,
        JSON.stringify([
          ...Object.keys(legacyPreparation.evidence.productionDependencies),
          "@vitejs/plugin-react",
          "vite",
        ].sort(bytewiseCompare)),
      ], {
        cwd: runtimeSource,
        env: environment,
        stage: "legacy parent dependency config-load smoke",
      });
      const legacyInventoryAfterSmoke = await inspectTree(legacyPublication);
      if (JSON.stringify(legacyInventoryAfterSmoke) !== JSON.stringify(legacyInventoryBeforeSmoke)) {
        fail("RELEASE_INPUT_CHANGED", "Legacy config-load smoke changed the runtime publication");
      }
      legacyParentDependencyConfigLoadSmoke = true;
    }
    await runSandboxed(installSandboxDocument, process.execPath, [
      join(runtimeSource, "node_modules/vite/bin/vite.js"),
      "--version",
    ], { cwd: runtimeSource, env: environment, stage: "runtime Vite smoke" });
    const networkAuditEvidence = await verifyNetworkAudit(networkAudit);
    const sandboxProfileSha256 = createHash("sha256")
      .update(installSandboxDocument.evidenceDocument)
      .update("\0")
      .update(buildSandboxDocument.evidenceDocument)
      .digest("hex");
    const legacyRuntimeManifestEvidence = legacyRuntimeEvidence
      ? Object.freeze({
          ...legacyRuntimeEvidence,
          build: Object.freeze({
            dependencyInventorySha256: createHash("sha256")
              .update(JSON.stringify(legacyDependenciesBeforeBuild))
              .digest("hex"),
            executedSteps: Object.freeze([
              Object.freeze({
                arguments: ["node_modules/typescript/bin/tsc", "--noEmit"],
                command: "node",
              }),
              Object.freeze({
                arguments: [
                  "node_modules/vite/bin/vite.js",
                  "build",
                  "--configLoader",
                  "runner",
                ],
                command: "node",
              }),
            ]),
            lockSha256: legacyRuntimeEvidence.overlay["package-lock.json"],
            networkAudit: networkAuditEvidence,
            networkSandboxVerified: true,
            parentDependencyConfigLoadSmoke: legacyParentDependencyConfigLoadSmoke,
            sandboxProfileSha256,
            sourceLockSha256: legacyRuntimeEvidence.originalLockSha256,
            workingDirectory: "exact-v0.5.1-version-overlay",
          }),
        })
      : undefined;
    await assertPinnedDirectory(roots.cache, "npm cache");
    const releaseDirectory = target;
    const publishedRuntimeRoots = [];
    for (const path of [
      "dist",
      "node_modules",
      ...runtimeSourceRoots,
      ...runtimeSourceFiles,
      ...(options.releaseRole === "bridge" ? bridgeMigrationSourceFiles : []),
      "package.json",
      "package-lock.json",
    ]) {
      const inputRoot = path === "node_modules" ? runtimeSource : source;
      const details = await lstat(join(inputRoot, path));
      if (details.isDirectory()) {
        await copyRuntimeTree(inputRoot, releaseDirectory, path, { skipBin: path === "node_modules" });
        publishedRuntimeRoots.push(path);
      }
      else if (details.isFile() && !details.isSymbolicLink()) {
        await mkdir(dirname(join(releaseDirectory, path)), { recursive: true, mode: 0o700 });
        const fixed = await readFixedRegularFile(
          join(inputRoot, path),
          "Required runtime input",
        );
        await writeFile(join(releaseDirectory, path), fixed.bytes, {
          flag: "wx",
          mode: fixed.mode & 0o111 ? 0o500 : 0o400,
        });
        publishedRuntimeRoots.push(path);
      } else fail("RELEASE_OUTPUT_UNSAFE", "Required runtime input is unsafe");
    }
    if (legacyRuntimeEvidence) {
      await copyRuntimeTree(runtimeSource, releaseDirectory, "legacy-runtime");
      publishedRuntimeRoots.push("legacy-runtime");
    }
    await hardenRuntimeDirectories(releaseDirectory);
    const files = await inspectTree(releaseDirectory, {
      allowNodeModules: true,
      excludeIncomplete: true,
      excludeManifest: true,
    });
    const indexArtifact = files.find((entry) =>
      entry.type === "file" && entry.path === "dist/client/index.html"
    );
    if (!indexArtifact?.sha256 || !Number.isSafeInteger(indexArtifact.size) || indexArtifact.size <= 0) {
      fail("RELEASE_RUNTIME_INVALID", "Production build is missing its fixed client index");
    }
    const legacyIndexArtifact = options.releaseRole === "bridge"
      ? files.find((entry) =>
          entry.type === "file" &&
          entry.path === "legacy-runtime/dist/client/index.html"
        )
      : undefined;
    if (
      options.releaseRole === "bridge" &&
      (!legacyIndexArtifact?.sha256 ||
        !Number.isSafeInteger(legacyIndexArtifact.size) ||
        legacyIndexArtifact.size <= 0)
    ) {
      fail(
        "RELEASE_LEGACY_RUNTIME_INVALID",
        "Bridge build is missing its schema-37 client index",
      );
    }
    const admission = Object.freeze({
      directoryMode: "0500",
      incompleteMarkerAbsent: true,
      manifestInventoryVerified: true,
      rule: "marker-absent-directory-0500-manifest-verified",
    });
    const databaseCompatibility = options.releaseRole === "bridge"
      ? Object.freeze({
          activeSchemaVersions: Object.freeze([37, 39]),
          migrationMode: "external-one-shot-only",
          rollbackTargetForSchemaVersion: 39,
        })
      : Object.freeze({
          activeSchemaVersions: Object.freeze([39]),
          migrationMode: "forbidden-from-final-runtime",
          standbySchemaVersions: Object.freeze([37]),
        });
    const manifest = Object.freeze({
      admission,
      artifactClass: options.artifactClass,
      buildArch: options.buildArch,
      buildLibc: options.buildLibc,
      buildPlatform: options.buildPlatform,
      build: Object.freeze({
        command: "npm",
        arguments: ["run", "build"],
        executedSteps: Object.freeze([
          Object.freeze({
            arguments: ["node_modules/typescript/bin/tsc", "--noEmit"],
            command: "node",
          }),
          Object.freeze({
            arguments: [
              "node_modules/vite/bin/vite.js",
              "build",
              "--configLoader",
              "runner",
            ],
            command: "node",
          }),
        ]),
        lockSha256: lockBefore,
        networkSandboxVerified: true,
        networkAudit: networkAuditEvidence,
        sandboxProfileSha256,
      }),
      commit: options.commit,
      databaseCompatibility,
      expectedVersion: options.expectedVersion,
      formalReleaseCommit: options.formalReleaseCommit,
      files,
      format: "unboundry-immutable-release",
      nodeVersion: REQUIRED_NODE_VERSION,
      npmVersion: REQUIRED_NPM_VERSION,
      packageVersion: packageDocument.version,
      hostPrerequisites,
      legacyRuntime: legacyRuntimeManifestEvidence,
      runtimeRoots: Object.freeze([...publishedRuntimeRoots].sort()),
      releaseId: options.releaseId,
      releaseRole: options.releaseRole,
      releaseStage: options.releaseRole,
      runtime: Object.freeze({
        arguments: [
          "node_modules/vite/bin/vite.js",
          "preview",
          "--configLoader",
          "runner",
          "--host",
          "127.0.0.1",
          "--port",
          "${UNBOUNDRY_PORT}",
          "--strictPort",
        ],
        command: process.execPath,
        cwd: ".",
        environment: Object.freeze({
          HOME: Object.freeze({
            placeholder: "UNBOUNDRY_RUNTIME_HOME",
            required: true,
            source: "placeholder",
          }),
          NODE_ENV: Object.freeze({ required: true, source: "literal", value: "production" }),
          PATH: Object.freeze({
            required: true,
            source: "literal",
            value: `${dirname(process.execPath)}:/usr/bin:/bin`,
          }),
          TEMP: Object.freeze({
            placeholder: "UNBOUNDRY_RUNTIME_TEMP",
            required: true,
            source: "placeholder",
          }),
          TMP: Object.freeze({
            placeholder: "UNBOUNDRY_RUNTIME_TEMP",
            required: true,
            source: "placeholder",
          }),
          TMPDIR: Object.freeze({
            placeholder: "UNBOUNDRY_RUNTIME_TEMP",
            required: true,
            source: "placeholder",
          }),
          UNBOUNDRY_DATA_DIR: Object.freeze({
            placeholder: "UNBOUNDRY_DATA_DIR",
            required: true,
            source: "placeholder",
          }),
          UNBOUNDRY_RUNTIME_DIR: Object.freeze({
            placeholder: "UNBOUNDRY_RUNTIME_DIR",
            required: true,
            source: "placeholder",
          }),
          UNBOUNDRY_RUNTIME_ROLE: Object.freeze({
            placeholder: "UNBOUNDRY_RUNTIME_ROLE",
            required: true,
            source: "placeholder",
          }),
          UNBOUNDRY_SECURE_COOKIES: Object.freeze({
            required: true,
            source: "literal",
            value: "1",
          }),
          UNBOUNDRY_TRUST_PROXY: Object.freeze({
            required: true,
            source: "literal",
            value: "1",
          }),
          UNBOUNDRY_VITE_CACHE_DIR: Object.freeze({
            placeholder: "UNBOUNDRY_VITE_CACHE_DIR",
            required: true,
            source: "placeholder",
          }),
        }),
        forbiddenEnvironment: Object.freeze([
          "LD_LIBRARY_PATH",
          "LD_PRELOAD",
          "NODE_OPTIONS",
          "NODE_PATH",
          "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
          "UNBOUNDRY_LEGACY_RUNTIME_ROOT",
          "UNBOUNDRY_MAINTENANCE_MODE",
          "UNBOUNDRY_RELEASE_ROLE",
          "UNBOUNDRY_SAFE_TEST",
        ]),
        forbiddenEnvironmentPrefixes: Object.freeze(["UNBOUNDRY_TEST_"]),
        health: Object.freeze({
          ...(legacyIndexArtifact
            ? {
                legacySchema37StaticAsset: Object.freeze({
                  path: "legacy-runtime/dist/client/index.html",
                  sha256: legacyIndexArtifact.sha256,
                  size: legacyIndexArtifact.size,
                  url: "/",
                }),
              }
            : {}),
          staticAsset: Object.freeze({
            path: "dist/client/index.html",
            sha256: indexArtifact.sha256,
            size: indexArtifact.size,
            url: "/",
          }),
          livePath: "/api/health/live",
          readyPath: "/api/health/ready",
          version: packageDocument.version,
          versionPath: "/api/version",
        }),
        placeholders: Object.freeze({
          UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
          UNBOUNDRY_PORT: "loopback-port",
          UNBOUNDRY_RUNTIME_HOME: "absolute-private-runtime-home-directory",
          UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory",
          UNBOUNDRY_RUNTIME_ROLE: "active-or-non-active-runtime-role",
          UNBOUNDRY_RUNTIME_TEMP: "absolute-private-runtime-temporary-directory",
          UNBOUNDRY_VITE_CACHE_DIR: "absolute-private-cache-directory",
        }),
      }),
      ...(options.releaseRole === "bridge"
        ? {
            migration: Object.freeze({
              arguments: Object.freeze([
                "scripts/migrate-schema37-to39.mjs",
                "--apply",
                "--data-dir",
                "${UNBOUNDRY_DATA_DIR}",
                "--runtime-dir",
                "${UNBOUNDRY_RUNTIME_DIR}",
                "--expected-logical-sha256",
                "${UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256}",
                "--scratch-root",
                "${UNBOUNDRY_MIGRATION_SCRATCH_ROOT}",
              ]),
              command: process.execPath,
              httpListener: false,
              permittedReleaseRole: "bridge",
              placeholders: Object.freeze({
                UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
                UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256: "lowercase-sha256",
                UNBOUNDRY_MIGRATION_SCRATCH_ROOT:
                  "absolute-private-migration-scratch-directory",
                UNBOUNDRY_RUNTIME_DIR:
                  "absolute-private-runtime-directory-shared-with-service",
              }),
            }),
          }
        : {}),
      schemaVersion: 3,
      sourceTree,
    });
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    await chmod(releaseDirectory, 0o700);
    await writeFile(join(releaseDirectory, "release-manifest.json"), manifestBytes, {
      flag: "wx",
      mode: 0o400,
    });
    const completedFiles = await inspectTree(releaseDirectory, {
      allowNodeModules: true,
      excludeIncomplete: true,
      excludeManifest: true,
    });
    if (JSON.stringify(completedFiles) !== JSON.stringify(files)) {
      fail("RELEASE_INPUT_CHANGED", "Completed release inventory differs from manifest");
    }
    const storedManifestBytes = await readFile(join(releaseDirectory, "release-manifest.json"));
    if (!storedManifestBytes.equals(Buffer.from(manifestBytes))) {
      fail("RELEASE_INPUT_CHANGED", "Stored release manifest changed before publication");
    }
    for (const entry of files) {
      if (entry.type === "file") await syncFile(join(releaseDirectory, entry.path));
    }
    await syncFile(join(releaseDirectory, "release-manifest.json"));
    for (const entry of [...files].reverse()) {
      if (entry.type === "directory") await syncDirectory(join(releaseDirectory, entry.path));
    }
    await syncDirectory(releaseDirectory);
    const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
    if (!sha256Pattern.test(manifestSha256)) fail("RELEASE_OUTPUT_UNSAFE", "Manifest hash is invalid");
    const summary = Object.freeze({
      admission,
      artifactClass: options.artifactClass,
      buildArch: options.buildArch,
      buildLibc: options.buildLibc,
      buildPlatform: options.buildPlatform,
      commit: options.commit,
      expectedVersion: options.expectedVersion,
      formalReleaseCommit: options.formalReleaseCommit,
      manifestPath: join(target, "release-manifest.json"),
      manifestSha256,
      releaseDirectory: target,
      releaseId: options.releaseId,
      releaseRole: options.releaseRole,
      sourceTree,
    });
    // Scratch cleanup is part of pre-publication admission. A cleanup failure
    // must leave the .incomplete marker in place, never report a failed command
    // after an otherwise admitted release has become available.
    await cleanupPrivateBuildScratch(workRoot, roots.scratch);
    workRoot = undefined;
    await assertPinnedDirectory(roots.cache, "npm cache");
    await assertPinnedDirectory(roots.release, "Release root");
    await assertPinnedDirectory(roots.scratch, "Scratch root");
    await assertPinnedReservation(target, reservationIdentity);
    await syncDirectory(roots.release.path);
    await chmod(releaseDirectory, 0o700);
    const incompleteMarker = join(releaseDirectory, ".incomplete");
    await rm(incompleteMarker);
    try {
      await syncDirectory(releaseDirectory);
      await chmod(releaseDirectory, 0o500);
      await syncDirectory(releaseDirectory);
      await syncDirectory(roots.release.path);
    } catch (error) {
      // Publication has not committed until both the marker removal and the
      // hardened directory metadata are durable. Restore the fail-closed
      // marker before reporting a pre-commit failure.
      await chmod(releaseDirectory, 0o700).catch(() => {});
      await writeFile(incompleteMarker, "release build in progress\n", {
        flag: "wx",
        mode: 0o600,
      }).catch(() => {});
      await syncFile(incompleteMarker).catch(() => {});
      await syncDirectory(releaseDirectory).catch(() => {});
      await syncDirectory(roots.release.path).catch(() => {});
      throw error;
    }
    return summary;
  } catch (error) {
    if (reservationIdentity) {
      const retained = await lstat(join(target, ".incomplete")).then(
        (details) => details.isFile() && !details.isSymbolicLink(),
        () => false,
      );
      if (retained && error && typeof error === "object") {
        error.message = `${error.message}; fail-closed incomplete release reservation retained`;
      }
    }
    throw error;
  } finally {
    if (workRoot) {
      await cleanupPrivateBuildScratch(workRoot, roots.scratch);
    }
  }
}

try {
  const summary = await main();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const code = error instanceof ReleaseBuildError ? error.code : "RELEASE_BUILD_FAILED";
  const message = error instanceof ReleaseBuildError
    ? error.message
    : "Immutable release creation failed";
  process.stderr.write(`${JSON.stringify({ code, message })}\n`);
  process.exitCode = 1;
}
