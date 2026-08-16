import { createHash } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const RELEASE_FORMAT = "unboundry-immutable-release";
const RELEASE_MANIFEST_SCHEMA = 3;
const REQUIRED_NODE_VERSION = "22.23.1";
const REQUIRED_NPM_VERSION = "10.9.8";
const MAXIMUM_FIXED_FILE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAXIMUM_STATIC_HEALTH_BYTES = 64 * 1024 * 1024;
const MAXIMUM_TREE_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_TREE_ENTRIES = 500_000;
const MAXIMUM_TREE_DEPTH = 64;
const MAXIMUM_PATH_BYTES = 4096;
const sha256Pattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;

const releaseVersionByRole = Object.freeze({
  bridge: "0.5.2",
  final: "0.6.0",
});

const exactLegacyProductionDependencies = Object.freeze({
  "@xyflow/react": Object.freeze({ requested: "12.11.2", version: "12.11.2" }),
  "ali-oss": Object.freeze({ requested: "^6.23.0", version: "6.23.0" }),
  archiver: Object.freeze({ requested: "^8.0.0", version: "8.0.0" }),
  react: Object.freeze({ requested: "19.2.8", version: "19.2.8" }),
  "react-dom": Object.freeze({ requested: "19.2.8", version: "19.2.8" }),
});

const exactLegacyBuildSteps = Object.freeze([
  Object.freeze({
    arguments: Object.freeze(["node_modules/typescript/bin/tsc", "--noEmit"]),
    command: "node",
  }),
  Object.freeze({
    arguments: Object.freeze([
      "node_modules/vite/bin/vite.js",
      "build",
      "--configLoader",
      "runner",
    ]),
    command: "node",
  }),
]);

const exactLegacySourceLockSha256 =
  "79612b35753b970b10223f50adc396c0a064c41bfa8779bb9698b40f9ce0296e";
const exactLegacyArchiveSha256 =
  "e7a619c4d9dbaca14d1032ef18f83f81dcfb36c9402976debc4f8f546c8bb5d0";
const exactLegacyOriginalInventorySha256 =
  "cd98d90aaae56de756164fa0434dfb6bb144598183536c6d91067308e8d24517";
const exactLegacyPeeledCommit = "7f7d6177a564056a6f41ff83dfb7ba913b21603b";
const exactLegacyCommitTree = "0990690bd9828757b82f59861f950ce6ff9ed4f8";
const exactLegacyTrackedFiles = 371;

const exactMigrationArguments = Object.freeze([
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
]);

const exactMigrationPlaceholders = Object.freeze({
  UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
  UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256: "lowercase-sha256",
  UNBOUNDRY_MIGRATION_SCRATCH_ROOT:
    "absolute-private-migration-scratch-directory",
  UNBOUNDRY_RUNTIME_DIR:
    "absolute-private-runtime-directory-shared-with-service",
});

const exactRuntimeArguments = Object.freeze([
  "node_modules/vite/bin/vite.js",
  "preview",
  "--configLoader",
  "runner",
  "--host",
  "127.0.0.1",
  "--port",
  "${UNBOUNDRY_PORT}",
  "--strictPort",
]);

const formalForbiddenEnvironment = Object.freeze([
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
  "UNBOUNDRY_LEGACY_RUNTIME_ROOT",
  "UNBOUNDRY_MAINTENANCE_MODE",
  "UNBOUNDRY_RELEASE_ROLE",
  "UNBOUNDRY_SAFE_TEST",
]);

const exactBuildSteps = Object.freeze([
  Object.freeze({
    arguments: Object.freeze(["node_modules/typescript/bin/tsc", "--noEmit"]),
    command: "node",
  }),
  Object.freeze({
    arguments: Object.freeze([
      "node_modules/vite/bin/vite.js",
      "build",
      "--configLoader",
      "runner",
    ]),
    command: "node",
  }),
]);

const exactRuntimePlaceholders = Object.freeze({
  UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
  UNBOUNDRY_PORT: "loopback-port",
  UNBOUNDRY_RUNTIME_HOME: "absolute-private-runtime-home-directory",
  UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory",
  UNBOUNDRY_RUNTIME_ROLE: "active-or-non-active-runtime-role",
  UNBOUNDRY_RUNTIME_TEMP: "absolute-private-runtime-temporary-directory",
  UNBOUNDRY_VITE_CACHE_DIR: "absolute-private-cache-directory",
});

export class AdmittedReleaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AdmittedReleaseError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AdmittedReleaseError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("ADMITTED_RELEASE_UNSAFE", "POSIX ownership checks are required");
  }
  return process.getuid();
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (
    difference !== ".." && !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

function normalizedAbsolutePath(value, label) {
  if (
    !value || !isAbsolute(value) || resolve(value) !== value ||
    value !== value.normalize("NFC") || /[\0\r\n]/.test(value)
  ) fail("ADMITTED_RELEASE_UNSAFE", `${label} must be a normalized absolute path`);
  return value;
}

function normalizedRelativePath(value, label) {
  if (
    !value || value !== value.normalize("NFC") || value.startsWith("/") ||
    value.includes("\\") || /[\0\r\n]/.test(value)
  ) fail("ADMITTED_RELEASE_INVALID", `${label} has an unsafe path`);
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail("ADMITTED_RELEASE_INVALID", `${label} has an unsafe path segment`);
  }
  return parts;
}

function directoryIdentity(details) {
  return Object.freeze({
    ctimeMs: details.ctimeMs,
    dev: details.dev,
    ino: details.ino,
    mode: details.mode,
    mtimeMs: details.mtimeMs,
    uid: details.uid,
  });
}

function fileIdentity(details) {
  return Object.freeze({
    ...directoryIdentity(details),
    nlink: details.nlink,
    size: details.size,
  });
}

function sameDirectoryIdentity(details, identity) {
  return Boolean(details) && details.isDirectory() && !details.isSymbolicLink() &&
    details.dev === identity.dev && details.ino === identity.ino &&
    details.uid === identity.uid && details.mode === identity.mode &&
    details.mtimeMs === identity.mtimeMs && details.ctimeMs === identity.ctimeMs;
}

function sameFileIdentity(details, identity) {
  return Boolean(details) && details.isFile() && !details.isSymbolicLink() &&
    details.dev === identity.dev && details.ino === identity.ino &&
    details.uid === identity.uid && details.mode === identity.mode &&
    details.nlink === identity.nlink && details.size === identity.size &&
    details.mtimeMs === identity.mtimeMs && details.ctimeMs === identity.ctimeMs;
}

async function fixedFile(path, label, { maximumBytes = MAXIMUM_FIXED_FILE_BYTES, mode } = {}) {
  let descriptor;
  try {
    descriptor = await open(
      path,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0) |
        fileConstants.O_NONBLOCK,
    );
    const before = await descriptor.stat();
    if (
      !before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.uid !== currentUid() || (before.mode & 0o022) !== 0 ||
      (mode !== undefined && (before.mode & 0o777) !== mode) ||
      before.size < 0 || before.size > maximumBytes
    ) fail("ADMITTED_RELEASE_UNSAFE", `${label} is not a fixed owner-controlled file`);
    const identity = fileIdentity(before);
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat();
    const pathAfter = await lstat(path).catch(() => undefined);
    if (
      bytes.length !== before.size || !sameFileIdentity(after, identity) ||
      !sameFileIdentity(pathAfter, identity)
    ) fail("ADMITTED_RELEASE_CHANGED", `${label} changed while it was read`);
    return Object.freeze({ bytes, identity, sha256: sha256(bytes) });
  } catch (error) {
    if (error instanceof AdmittedReleaseError) throw error;
    fail("ADMITTED_RELEASE_UNSAFE", `${label} could not be read safely`);
  } finally {
    await descriptor?.close();
  }
}

function parseDocument(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("ADMITTED_RELEASE_INVALID", `${label} is not valid JSON`);
  }
}

function validateRuntimeContract(runtime, releaseRole, runtimeCommand) {
  const bridge = releaseRole === "bridge";
  if (
    !runtime || typeof runtime !== "object" ||
    runtime.command !== runtimeCommand || runtime.cwd !== "." ||
    JSON.stringify(runtime.arguments) !== JSON.stringify(exactRuntimeArguments) ||
    JSON.stringify(runtime.forbiddenEnvironment) !==
      JSON.stringify(formalForbiddenEnvironment) ||
    JSON.stringify(runtime.forbiddenEnvironmentPrefixes) !==
      JSON.stringify(["UNBOUNDRY_TEST_"]) ||
    JSON.stringify(runtime.placeholders) !==
      JSON.stringify(exactRuntimePlaceholders)
  ) fail("ADMITTED_RELEASE_INVALID", "Release runtime contract is incomplete");

  const placeholderVariables = Object.freeze({
    HOME: "UNBOUNDRY_RUNTIME_HOME",
    TEMP: "UNBOUNDRY_RUNTIME_TEMP",
    TMP: "UNBOUNDRY_RUNTIME_TEMP",
    TMPDIR: "UNBOUNDRY_RUNTIME_TEMP",
    UNBOUNDRY_DATA_DIR: "UNBOUNDRY_DATA_DIR",
    UNBOUNDRY_RUNTIME_DIR: "UNBOUNDRY_RUNTIME_DIR",
    UNBOUNDRY_RUNTIME_ROLE: "UNBOUNDRY_RUNTIME_ROLE",
    UNBOUNDRY_VITE_CACHE_DIR: "UNBOUNDRY_VITE_CACHE_DIR",
  });
  const expectedKeys = [
    ...Object.keys(placeholderVariables),
    "NODE_ENV",
    "PATH",
    "UNBOUNDRY_SECURE_COOKIES",
    "UNBOUNDRY_TRUST_PROXY",
  ].sort();
  const environment = runtime.environment;
  if (
    !environment ||
    JSON.stringify(Object.keys(environment).sort()) !== JSON.stringify(expectedKeys)
  ) fail("ADMITTED_RELEASE_INVALID", "Release runtime environment is incomplete");
  for (const [name, placeholder] of Object.entries(placeholderVariables)) {
    if (JSON.stringify(environment[name]) !== JSON.stringify({
      placeholder,
      required: true,
      source: "placeholder",
    })) fail("ADMITTED_RELEASE_INVALID", `Release runtime environment ${name} is invalid`);
  }
  for (const [name, value] of Object.entries({
    NODE_ENV: "production",
    UNBOUNDRY_SECURE_COOKIES: "1",
    UNBOUNDRY_TRUST_PROXY: "1",
  })) {
    if (JSON.stringify(environment[name]) !== JSON.stringify({
      required: true,
      source: "literal",
      value,
    })) fail("ADMITTED_RELEASE_INVALID", `Release runtime literal ${name} is invalid`);
  }
  if (
    JSON.stringify(environment.PATH) !== JSON.stringify({
      required: true,
      source: "literal",
      value: `${dirname(runtimeCommand)}:/usr/bin:/bin`,
    })
  ) fail("ADMITTED_RELEASE_INVALID", "Release runtime PATH is invalid");

  const health = runtime.health;
  if (
    health?.livePath !== "/api/health/live" ||
    health?.readyPath !== "/api/health/ready" ||
    health?.versionPath !== "/api/version" ||
    typeof health.version !== "string" || !health.version ||
    health.staticAsset?.url !== "/" ||
    health.staticAsset?.path !== "dist/client/index.html" ||
    !sha256Pattern.test(health.staticAsset?.sha256 ?? "") ||
    !Number.isSafeInteger(health.staticAsset?.size) ||
    health.staticAsset.size <= 0 ||
    health.staticAsset.size > MAXIMUM_STATIC_HEALTH_BYTES
  ) fail("ADMITTED_RELEASE_INVALID", "Release health contract is invalid");
  normalizedRelativePath(health.staticAsset.path, "Static health asset");
  const legacyStatic = health.legacySchema37StaticAsset;
  if (
    bridge
      ? legacyStatic?.url !== "/" ||
        legacyStatic?.path !== "legacy-runtime/dist/client/index.html" ||
        !sha256Pattern.test(legacyStatic?.sha256 ?? "") ||
        !Number.isSafeInteger(legacyStatic?.size) || legacyStatic.size <= 0 ||
        legacyStatic.size > MAXIMUM_STATIC_HEALTH_BYTES
      : legacyStatic !== undefined
  ) fail("ADMITTED_RELEASE_INVALID", "Release legacy health contract is invalid");
  if (bridge) {
    normalizedRelativePath(legacyStatic.path, "Legacy static health asset");
    if (legacyStatic.sha256 === health.staticAsset.sha256) {
      fail("ADMITTED_RELEASE_INVALID", "Bridge static assets must be distinct");
    }
  }
}

function validatePrerequisites(manifest, expected) {
  const entries = manifest.hostPrerequisites?.executables;
  if (
    !Array.isArray(entries) || entries.length !== 3 ||
    JSON.stringify(entries.map((entry) => entry.name).sort()) !==
      JSON.stringify(["ffmpeg", "ffprobe", "node"])
  ) fail("ADMITTED_RELEASE_INVALID", "Release host prerequisites are incomplete");
  for (const entry of entries) {
    const expectedArguments = entry.name === "node" ? ["--version"] : ["-version"];
    const expectedPattern = entry.name === "node"
      ? "^v22\\.23\\.1$"
      : `^${entry.name} version [^\\r\\n]+(?:\\r?\\n[\\s\\S]*)?$`;
    if (
      entry.required !== true || !isAbsolute(entry.path) ||
      resolve(entry.path) !== entry.path ||
      JSON.stringify(entry.arguments) !== JSON.stringify(expectedArguments) ||
      !sha256Pattern.test(entry.sha256 ?? "") ||
      !sha256Pattern.test(entry.versionOutputSha256 ?? "") ||
      entry.versionPattern !== expectedPattern ||
      (entry.name === "node" && entry.path !== expected.runtimeCommand)
    ) fail("ADMITTED_RELEASE_INVALID", "Release executable prerequisite is malformed");
  }
  if (expected.artifactClass === "production") {
    const paths = Object.fromEntries(entries.map((entry) => [entry.name, entry.path]));
    if (
      paths.node !== "/opt/node22/bin/node" || paths.ffmpeg !== "/usr/bin/ffmpeg" ||
      paths.ffprobe !== "/usr/bin/ffprobe"
    ) fail("ADMITTED_RELEASE_INVALID", "Production prerequisite paths are invalid");
  }
  const sandbox = manifest.hostPrerequisites?.sandbox;
  if (expected.buildPlatform === "linux") {
    if (
      sandbox?.name !== "bwrap" || !isAbsolute(sandbox.path) ||
      sandbox.required !== true ||
      JSON.stringify(sandbox.arguments) !== JSON.stringify(["--version"]) ||
      !sha256Pattern.test(sandbox.sha256 ?? "") ||
      !sha256Pattern.test(sandbox.versionOutputSha256 ?? "") ||
      sandbox.versionPattern !== "^bubblewrap [0-9]+\\.[0-9]+(?:\\.[0-9]+)?$"
    ) fail("ADMITTED_RELEASE_INVALID", "Release sandbox prerequisite is malformed");
  } else if (sandbox !== undefined) {
    fail("ADMITTED_RELEASE_INVALID", "Non-Linux release declares an unexpected sandbox");
  }
}

async function inventoryRelease(releaseDirectory) {
  const inventory = [];
  const budget = { bytes: 0, entries: 0 };
  async function visit(directory, prefix = "", depth = 0) {
    if (depth > MAXIMUM_TREE_DEPTH) {
      fail("ADMITTED_RELEASE_INVALID", "Release inventory is too deep");
    }
    const before = await lstat(directory).catch(() => undefined);
    if (
      !before?.isDirectory() || before.isSymbolicLink() ||
      before.uid !== currentUid() || (before.mode & 0o022) !== 0
    ) fail("ADMITTED_RELEASE_UNSAFE", "Release inventory directory is unsafe");
    const identity = directoryIdentity(before);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === "release-manifest.json") continue;
      normalizedRelativePath(relativePath, "Release inventory");
      budget.entries += 1;
      if (
        budget.entries > MAXIMUM_TREE_ENTRIES ||
        Buffer.byteLength(relativePath, "utf8") > MAXIMUM_PATH_BYTES
      ) fail("ADMITTED_RELEASE_INVALID", "Release inventory exceeds its entry budget");
      if (
        relativePath === ".incomplete" ||
        /(^|\/)(\.env(?:\.|$)|data|backups|secrets|test-results|playwright-report)(\/|$)/
          .test(relativePath)
      ) fail("ADMITTED_RELEASE_INVALID", "Release contains a mutable or sensitive path");
      const path = join(directory, entry.name);
      const details = await lstat(path);
      if (
        details.isSymbolicLink() || details.uid !== currentUid() ||
        (details.mode & 0o022) !== 0 ||
        (details.isDirectory() && (details.mode & 0o777) !== 0o500) ||
        (details.isFile() && (
          details.nlink !== 1 ||
          !new Set([0o400, 0o500]).has(details.mode & 0o777)
        ))
      ) fail("ADMITTED_RELEASE_UNSAFE", "Release contains unsafe ownership or links");
      if (details.isDirectory()) {
        inventory.push({
          mode: details.mode & 0o777,
          path: relativePath,
          type: "directory",
        });
        await visit(path, relativePath, depth + 1);
      } else if (details.isFile()) {
        budget.bytes += details.size;
        if (
          details.size > MAXIMUM_FIXED_FILE_BYTES ||
          budget.bytes > MAXIMUM_TREE_BYTES
        ) fail("ADMITTED_RELEASE_INVALID", "Release inventory exceeds its byte budget");
        const fixed = await fixedFile(path, `Release file ${relativePath}`);
        inventory.push({
          mode: details.mode & 0o777,
          path: relativePath,
          sha256: fixed.sha256,
          size: fixed.bytes.length,
          type: "file",
        });
      } else fail("ADMITTED_RELEASE_UNSAFE", "Release contains a special file");
    }
    const after = await lstat(directory).catch(() => undefined);
    if (!sameDirectoryIdentity(after, identity)) {
      fail("ADMITTED_RELEASE_CHANGED", "Release directory changed during inventory");
    }
  }
  await visit(releaseDirectory);
  return inventory;
}

function validateRoleClosure(manifest, inventory, releaseRole, artifactClass) {
  const inventoryPaths = new Set(inventory.map((entry) => entry.path));
  const expectedRuntimeRoots = [
    "client",
    "dist",
    ...(releaseRole === "bridge" ? ["legacy-runtime"] : []),
    "node_modules",
    "package-lock.json",
    "package.json",
    ...(releaseRole === "bridge"
      ? ["scripts/migrate-schema37-to39.mjs", "scripts/node-typescript-runtime.mjs"]
      : []),
    "server",
    "spec/unboundry-state-fixtures.json",
    "types",
    "vite.config.ts",
  ].sort();
  if (JSON.stringify(manifest.runtimeRoots) !== JSON.stringify(expectedRuntimeRoots)) {
    fail("ADMITTED_RELEASE_INVALID", "Release runtime roots are invalid");
  }
  if (
    expectedRuntimeRoots.some((path) => !inventoryPaths.has(path)) ||
    !inventoryPaths.has("node_modules/vite/bin/vite.js") ||
    !inventoryPaths.has("node_modules/@vitejs/plugin-react/dist/index.js") ||
    [...inventoryPaths].some((path) =>
      path === "node_modules/typescript" || path.startsWith("node_modules/typescript/") ||
      path.startsWith("node_modules/@playwright/") ||
      (artifactClass === "production" && path === "node_modules/@playwright")
    )
  ) fail("ADMITTED_RELEASE_INVALID", "Release dependency closure is invalid");

  let migrationArtifactSha256;
  if (releaseRole === "bridge") {
    const migrationEntry = inventory.find((entry) =>
      entry.type === "file" && entry.path === "scripts/migrate-schema37-to39.mjs");
    if (
      manifest.migration?.command !== manifest.runtime.command ||
      JSON.stringify(manifest.migration?.arguments) !==
        JSON.stringify(exactMigrationArguments) ||
      manifest.migration?.httpListener !== false ||
      manifest.migration?.permittedReleaseRole !== "bridge" ||
      JSON.stringify(manifest.migration?.placeholders) !==
        JSON.stringify(exactMigrationPlaceholders) ||
      !migrationEntry?.sha256
    ) fail("ADMITTED_RELEASE_INVALID", "Bridge migration is not artifact-bound");
    migrationArtifactSha256 = migrationEntry.sha256;

    const legacyEntries = inventory.filter((entry) =>
      entry.path.startsWith("legacy-runtime/")).map((entry) => ({
        ...entry,
        path: entry.path.slice("legacy-runtime/".length),
      }));
    const legacyIndex = legacyEntries.find((entry) =>
      entry.type === "file" && entry.path === "dist/client/index.html");
    const legacyPackage = legacyEntries.find((entry) =>
      entry.type === "file" && entry.path === "package.json");
    const legacyLock = legacyEntries.find((entry) =>
      entry.type === "file" && entry.path === "package-lock.json");
    const legacy = manifest.legacyRuntime;
    if (
      legacy?.tag !== "v0.5.1" || legacy?.version !== "0.5.2" ||
      legacy?.runtimeDependencyResolution !== "parent-release-node_modules" ||
      legacy?.peeledCommit !== exactLegacyPeeledCommit ||
      legacy?.commitTree !== exactLegacyCommitTree ||
      legacy?.trackedFiles !== exactLegacyTrackedFiles ||
      legacy?.archiveSha256 !== exactLegacyArchiveSha256 ||
      legacy?.originalLockSha256 !== exactLegacySourceLockSha256 ||
      legacy?.originalInventorySha256 !== exactLegacyOriginalInventorySha256 ||
      !sha256Pattern.test(legacy?.inventorySha256 ?? "") ||
      !sha256Pattern.test(legacy?.clientIndexSha256 ?? "") ||
      !sha256Pattern.test(legacy?.overlay?.["package.json"] ?? "") ||
      !sha256Pattern.test(legacy?.overlay?.["package-lock.json"] ?? "") ||
      JSON.stringify(Object.keys(legacy?.overlay ?? {}).sort()) !==
        JSON.stringify(["package-lock.json", "package.json"]) ||
      legacy.overlay["package.json"] !== legacyPackage?.sha256 ||
      legacy.overlay["package-lock.json"] !== legacyLock?.sha256 ||
      JSON.stringify(legacy.productionDependencies) !==
        JSON.stringify(exactLegacyProductionDependencies) ||
      legacyEntries.some((entry) =>
        entry.path === "node_modules" || entry.path.startsWith("node_modules/")) ||
      legacy.clientIndexSha256 !== legacyIndex?.sha256 ||
      legacy.inventorySha256 !== sha256(Buffer.from(JSON.stringify(legacyEntries))) ||
      legacy.build?.networkSandboxVerified !== true ||
      legacy.build?.networkAudit?.blockedAttempts !== 0 ||
      !Number.isSafeInteger(legacy.build?.networkAudit?.guardLoads) ||
      legacy.build.networkAudit.guardLoads < 6 ||
      JSON.stringify(legacy.build.networkAudit) !==
        JSON.stringify(manifest.build.networkAudit) ||
      legacy.build?.sourceLockSha256 !== exactLegacySourceLockSha256 ||
      legacy.build?.lockSha256 !== legacy.overlay["package-lock.json"] ||
      !sha256Pattern.test(legacy.build?.dependencyInventorySha256 ?? "") ||
      legacy.build?.sandboxProfileSha256 !== manifest.build.sandboxProfileSha256 ||
      legacy.build?.parentDependencyConfigLoadSmoke !== true ||
      legacy.build?.workingDirectory !== "exact-v0.5.1-version-overlay" ||
      JSON.stringify(legacy.build?.executedSteps) !==
        JSON.stringify(exactLegacyBuildSteps)
    ) fail("ADMITTED_RELEASE_INVALID", "Bridge legacy runtime is incomplete");
  } else if (
    manifest.migration !== undefined || manifest.legacyRuntime !== undefined ||
    [...inventoryPaths].some((path) =>
      path === "legacy-runtime" || path.startsWith("legacy-runtime/") ||
      path === "scripts" || path.startsWith("scripts/"))
  ) fail("ADMITTED_RELEASE_INVALID", "Final release contains bridge-only artifacts");

  const staticEntry = inventory.find((entry) =>
    entry.type === "file" && entry.path === manifest.runtime.health.staticAsset.path);
  if (
    staticEntry?.sha256 !== manifest.runtime.health.staticAsset.sha256 ||
    staticEntry?.size !== manifest.runtime.health.staticAsset.size
  ) fail("ADMITTED_RELEASE_INVALID", "Release static health asset is unbound");
  if (releaseRole === "bridge") {
    const legacyStatic = manifest.runtime.health.legacySchema37StaticAsset;
    const entry = inventory.find((candidate) =>
      candidate.type === "file" && candidate.path === legacyStatic.path);
    if (entry?.sha256 !== legacyStatic.sha256 || entry?.size !== legacyStatic.size) {
      fail("ADMITTED_RELEASE_INVALID", "Bridge legacy static asset is unbound");
    }
  }
  return migrationArtifactSha256;
}

export async function validateAdmittedRelease({
  expectedManifestSha256,
  expectedRole,
  manifestPath,
  testExpectation,
}) {
  if (!Object.hasOwn(releaseVersionByRole, expectedRole)) {
    fail("ADMITTED_RELEASE_INVALID", "Expected release role is invalid");
  }
  const lexicalManifestPath = normalizedAbsolutePath(manifestPath, "Release manifest");
  if (basename(lexicalManifestPath) !== "release-manifest.json") {
    fail("ADMITTED_RELEASE_UNSAFE", "Release manifest must use its canonical name");
  }
  const releaseDirectory = dirname(lexicalManifestPath);
  const releaseRoot = dirname(releaseDirectory);
  const [canonicalManifest, canonicalDirectory, canonicalRoot] = await Promise.all([
    realpath(lexicalManifestPath).catch(() => undefined),
    realpath(releaseDirectory).catch(() => undefined),
    realpath(releaseRoot).catch(() => undefined),
  ]);
  const [directoryDetails, rootDetails] = await Promise.all([
    lstat(releaseDirectory).catch(() => undefined),
    lstat(releaseRoot).catch(() => undefined),
  ]);
  if (
    canonicalManifest !== lexicalManifestPath ||
    canonicalDirectory !== releaseDirectory || canonicalRoot !== releaseRoot ||
    !containsPath(canonicalRoot, canonicalDirectory) ||
    !directoryDetails?.isDirectory() || directoryDetails.isSymbolicLink() ||
    directoryDetails.uid !== currentUid() ||
    (directoryDetails.mode & 0o777) !== 0o500 ||
    !rootDetails?.isDirectory() || rootDetails.isSymbolicLink() ||
    rootDetails.uid !== currentUid() || (rootDetails.mode & 0o022) !== 0
  ) fail("ADMITTED_RELEASE_UNSAFE", "Release directory is not immutably admitted");
  const initialDirectoryIdentity = directoryIdentity(directoryDetails);
  const initialRootIdentity = directoryIdentity(rootDetails);
  const manifestFile = await fixedFile(
    lexicalManifestPath,
    "Release manifest",
    { maximumBytes: MAXIMUM_MANIFEST_BYTES, mode: 0o400 },
  );
  if (
    expectedManifestSha256 !== undefined &&
    manifestFile.sha256 !== expectedManifestSha256
  ) fail("ADMITTED_RELEASE_CHANGED", "Release manifest digest changed after attestation");
  const manifest = parseDocument(manifestFile.bytes, "Release manifest");
  const version = releaseVersionByRole[expectedRole];
  const expected = testExpectation ?? Object.freeze({
    artifactClass: "production",
    buildArch: "x64",
    buildLibc: "glibc",
    buildPlatform: "linux",
    formalReleaseCommit: true,
    runtimeCommand: "/opt/node22/bin/node",
  });
  if (
    !expected ||
    !new Set(["production", "synthetic-test"]).has(expected.artifactClass) ||
    typeof expected.buildArch !== "string" || !expected.buildArch ||
    typeof expected.buildLibc !== "string" || !expected.buildLibc ||
    typeof expected.buildPlatform !== "string" || !expected.buildPlatform ||
    typeof expected.formalReleaseCommit !== "boolean" ||
    !isAbsolute(expected.runtimeCommand) || resolve(expected.runtimeCommand) !== expected.runtimeCommand
  ) fail("ADMITTED_RELEASE_INVALID", "Release expectation is invalid");
  const compatibility = expectedRole === "bridge"
    ? {
        activeSchemaVersions: [37, 39],
        migrationMode: "external-one-shot-only",
        rollbackTargetForSchemaVersion: 39,
      }
    : {
        activeSchemaVersions: [39],
        migrationMode: "forbidden-from-final-runtime",
        standbySchemaVersions: [37],
      };
  if (
    manifest?.format !== RELEASE_FORMAT ||
    manifest?.schemaVersion !== RELEASE_MANIFEST_SCHEMA ||
    manifest?.artifactClass !== expected.artifactClass ||
    manifest?.formalReleaseCommit !== expected.formalReleaseCommit ||
    manifest?.buildPlatform !== expected.buildPlatform ||
    manifest?.buildArch !== expected.buildArch ||
    manifest?.buildLibc !== expected.buildLibc ||
    manifest?.releaseRole !== expectedRole || manifest?.releaseStage !== expectedRole ||
    manifest?.releaseId !== `v${version}` || basename(releaseDirectory) !== manifest.releaseId ||
    manifest?.expectedVersion !== version || manifest?.packageVersion !== version ||
    !commitPattern.test(manifest?.commit ?? "") ||
    !commitPattern.test(manifest?.sourceTree ?? "") ||
    manifest?.nodeVersion !== REQUIRED_NODE_VERSION ||
    manifest?.npmVersion !== REQUIRED_NPM_VERSION ||
    manifest?.runtime?.health?.version !== version ||
    manifest?.admission?.directoryMode !== "0500" ||
    manifest?.admission?.manifestInventoryVerified !== true ||
    manifest?.admission?.incompleteMarkerAbsent !== true ||
    !new Set([
      "marker-absent-directory-0500-manifest-verified",
      "atomic-staging-rename-manifest-verified",
    ]).has(manifest?.admission?.rule) ||
    JSON.stringify(manifest?.databaseCompatibility) !== JSON.stringify(compatibility)
  ) fail("ADMITTED_RELEASE_INVALID", "Release manifest identity is invalid");
  if (
    manifest.build?.networkSandboxVerified !== true ||
    manifest.build?.networkAudit?.blockedAttempts !== 0 ||
    !Number.isSafeInteger(manifest.build?.networkAudit?.guardLoads) ||
    manifest.build.networkAudit.guardLoads < 2 ||
    !sha256Pattern.test(manifest.build?.lockSha256 ?? "") ||
    !sha256Pattern.test(manifest.build?.sandboxProfileSha256 ?? "") ||
    JSON.stringify(manifest.build?.executedSteps) !== JSON.stringify(exactBuildSteps)
  ) fail("ADMITTED_RELEASE_INVALID", "Release build attestation is incomplete");
  validateRuntimeContract(manifest.runtime, expectedRole, expected.runtimeCommand);
  validatePrerequisites(manifest, expected);
  const inventory = await inventoryRelease(releaseDirectory);
  if (JSON.stringify(inventory) !== JSON.stringify(manifest.files)) {
    fail("ADMITTED_RELEASE_INVALID", "Release inventory does not match its manifest");
  }
  const migrationArtifactSha256 = validateRoleClosure(
    manifest,
    inventory,
    expectedRole,
    expected.artifactClass,
  );
  const [directoryAfter, rootAfter, manifestAfter] = await Promise.all([
    lstat(releaseDirectory).catch(() => undefined),
    lstat(releaseRoot).catch(() => undefined),
    lstat(lexicalManifestPath).catch(() => undefined),
  ]);
  if (
    !sameDirectoryIdentity(directoryAfter, initialDirectoryIdentity) ||
    !sameDirectoryIdentity(rootAfter, initialRootIdentity) ||
    !sameFileIdentity(manifestAfter, manifestFile.identity)
  ) fail("ADMITTED_RELEASE_CHANGED", "Release identity changed during validation");
  return Object.freeze({
    directory: releaseDirectory,
    directoryIdentity: initialDirectoryIdentity,
    inventorySha256: sha256(Buffer.from(JSON.stringify(inventory))),
    manifest,
    manifestPath: lexicalManifestPath,
    manifestSha256: manifestFile.sha256,
    migrationArtifactSha256,
    releaseId: manifest.releaseId,
    releaseRoot,
    releaseRole: expectedRole,
    rootIdentity: initialRootIdentity,
    runtimeCommand: expected.runtimeCommand,
    version,
  });
}
