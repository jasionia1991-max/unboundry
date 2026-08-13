import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";

test.describe.configure({ mode: "serial" });

const execute = promisify(execFile);
const rehearsalScript = join(process.cwd(), "scripts/rehearse-release.mjs");
const exactForbiddenEnvironment = [
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
  "UNBOUNDRY_MAINTENANCE_MODE",
  "UNBOUNDRY_SAFE_TEST",
];
const formalForbiddenEnvironment = [
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
  "UNBOUNDRY_LEGACY_RUNTIME_ROOT",
  "UNBOUNDRY_MAINTENANCE_MODE",
  "UNBOUNDRY_RELEASE_ROLE",
  "UNBOUNDRY_SAFE_TEST",
];
const exactPlaceholders = {
  UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
  UNBOUNDRY_PORT: "loopback-port",
  UNBOUNDRY_RUNTIME_HOME: "absolute-private-runtime-home-directory",
  UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory",
  UNBOUNDRY_RUNTIME_ROLE: "active-or-non-active-runtime-role",
  UNBOUNDRY_RUNTIME_TEMP: "absolute-private-runtime-temporary-directory",
  UNBOUNDRY_VITE_CACHE_DIR: "absolute-private-cache-directory",
};
const releaseVersionByRole = {
  bridge: "0.5.2",
  final: "0.6.0",
} as const;
const exactLegacyRuntimeContract = {
  archiveSha256: "e7a619c4d9dbaca14d1032ef18f83f81dcfb36c9402976debc4f8f546c8bb5d0",
  commitTree: "0990690bd9828757b82f59861f950ce6ff9ed4f8",
  originalInventorySha256:
    "cd98d90aaae56de756164fa0434dfb6bb144598183536c6d91067308e8d24517",
  peeledCommit: "7f7d6177a564056a6f41ff83dfb7ba913b21603b",
  trackedFiles: 371,
} as const;
const exactLegacyProductionDependencies = {
  "@xyflow/react": { requested: "12.11.2", version: "12.11.2" },
  "ali-oss": { requested: "^6.23.0", version: "6.23.0" },
  archiver: { requested: "^8.0.0", version: "8.0.0" },
  react: { requested: "19.2.8", version: "19.2.8" },
  "react-dom": { requested: "19.2.8", version: "19.2.8" },
};
const exactLegacySourceLockSha256 =
  "79612b35753b970b10223f50adc396c0a064c41bfa8779bb9698b40f9ce0296e";
const exactMigrationArguments = [
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
];
const exactMigrationPlaceholders = {
  UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
  UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256: "lowercase-sha256",
  UNBOUNDRY_MIGRATION_SCRATCH_ROOT: "absolute-private-migration-scratch-directory",
  UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory-shared-with-service",
};

type ReleaseRole = "legacy" | keyof typeof releaseVersionByRole;
type ReleaseInventoryEntry =
  | { mode: number; path: string; type: "directory" }
  | { mode: number; path: string; sha256: string; size: number; type: "file" };

type RehearsalResult = Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

type Fixture = Awaited<ReturnType<typeof createFixture>>;
type RehearsalOptions = NonNullable<Parameters<typeof argumentsFor>[1]>;

function sha256(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function write(path: string, contents: string, mode = 0o600) {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await writeFile(path, contents, { mode });
}

async function releaseInventory(releaseDirectory: string) {
  const result: ReleaseInventoryEntry[] = [];
  async function visit(directory: string, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === "release-manifest.json") continue;
      const path = join(directory, entry.name);
      const details = await lstat(path);
      if (details.isDirectory()) {
        result.push({ mode: 0o500, path: relativePath, type: "directory" });
        await visit(path, relativePath);
      } else {
        const bytes = await readFile(path);
        result.push({
          mode: 0o400,
          path: relativePath,
          sha256: sha256(bytes),
          size: bytes.length,
          type: "file",
        });
      }
    }
  }
  await visit(releaseDirectory);
  return result;
}

async function freezeDirectories(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await freezeDirectories(path);
    else await chmod(path, 0o400);
  }
  await chmod(directory, 0o500);
}

async function createRelease(
  releaseRoot: string,
  id: string,
  releaseRole: ReleaseRole,
) {
  const formal = releaseRole !== "legacy";
  const bridge = releaseRole === "bridge";
  const version = releaseRole === "legacy" ? "0.5.1" : releaseVersionByRole[releaseRole];
  const directory = join(releaseRoot, id);
  await mkdir(join(directory, "dist/client"), { mode: 0o700, recursive: true });
  await write(join(directory, "dist/client/index.html"), `${id} immutable release\n`);
  await write(join(directory, "node_modules/vite/bin/vite.js"), "export {};\n");
  await write(
    join(directory, "node_modules/@vitejs/plugin-react/dist/index.js"),
    "export default function react() {}\n",
  );
  await write(join(directory, "client/index.html"), "<!doctype html>\n");
  await write(join(directory, "server/runtime.js"), "export const runtime = true;\n");
  await write(join(directory, "types/runtime.d.ts"), "export type Runtime = true;\n");
  await write(join(directory, "vite.config.ts"), "export default {};\n");
  await write(join(directory, "spec/unboundry-state-fixtures.json"), "{\"fixtures\":[]}\n");
  if (bridge) {
    await write(
      join(directory, "scripts/migrate-schema37-to39.mjs"),
      "export const artifactBoundSyntheticMigration = true;\n",
    );
    await write(join(directory, "scripts/node-typescript-runtime.mjs"), "export {};\n");
  }
  if (bridge) {
    await write(
      join(directory, "legacy-runtime/dist/client/index.html"),
      "v0.5.2 exact-v0.5.1-compatible synthetic runtime\n",
    );
    await write(
      join(directory, "legacy-runtime/package.json"),
      `${JSON.stringify({ name: "m95-legacy-runtime", version })}\n`,
    );
    await write(
      join(directory, "legacy-runtime/package-lock.json"),
      `${JSON.stringify({ lockfileVersion: 3, version })}\n`,
    );
  }
  await write(join(directory, "package.json"), `${JSON.stringify({
    name: "m95-fake-release",
    version,
  })}\n`);
  await write(join(directory, "package-lock.json"), `${JSON.stringify({
    lockfileVersion: 3,
    packages: { "": { version } },
    version,
  })}\n`);
  const files = await releaseInventory(directory);
  const legacyEntries = bridge
    ? files.filter((entry) => String(entry.path).startsWith("legacy-runtime/"))
      .map((entry) => ({
        ...entry,
        path: String(entry.path).slice("legacy-runtime/".length),
      }))
    : [];
  const legacyIndex = legacyEntries.find((entry) =>
    entry.type === "file" && entry.path === "dist/client/index.html"
  );
  const legacyPackage = legacyEntries.find((entry) =>
    entry.type === "file" && entry.path === "package.json"
  );
  const legacyLock = legacyEntries.find((entry) =>
    entry.type === "file" && entry.path === "package-lock.json"
  );
  const legacyIndexSha256 = legacyIndex?.type === "file" ? legacyIndex.sha256 : undefined;
  const legacyIndexSize = legacyIndex?.type === "file" ? legacyIndex.size : undefined;
  const staticBytes = await readFile(join(directory, "dist/client/index.html"));
  const placeholders = (name: string) => ({
    placeholder: name,
    required: true,
    source: "placeholder",
  });
  const prerequisite = (name: string) => {
    const syntheticStubBytes = Buffer.from(`m95 synthetic ${name} host prerequisite`, "utf8");
    const syntheticVersionBytes = Buffer.from(`m95 synthetic ${name} version output`, "utf8");
    return ({
    arguments: name === "node" ? ["--version"] : ["-version"],
    name,
    path: name === "node" ? "/opt/node22/bin/node" : `/usr/bin/${name}`,
    required: true,
    sha256: sha256(syntheticStubBytes),
    versionOutputSha256: sha256(syntheticVersionBytes),
    versionPattern: name === "node"
      ? "^v22\\.23\\.1$"
      : `^${name} version [^\\r\\n]+(?:\\r?\\n[\\s\\S]*)?$`,
    });
  };
  const runtimePlaceholders = formal
    ? {
        UNBOUNDRY_DATA_DIR: "absolute-private-data-directory",
        UNBOUNDRY_PORT: "loopback-port",
        UNBOUNDRY_RUNTIME_HOME: "absolute-private-runtime-home-directory",
        UNBOUNDRY_RUNTIME_DIR: "absolute-private-runtime-directory",
        UNBOUNDRY_RUNTIME_ROLE: "active-or-non-active-runtime-role",
        UNBOUNDRY_RUNTIME_TEMP: "absolute-private-runtime-temporary-directory",
        UNBOUNDRY_VITE_CACHE_DIR: "absolute-private-cache-directory",
      }
    : exactPlaceholders;
  const databaseCompatibility = releaseRole === "bridge"
    ? {
        activeSchemaVersions: [37, 39],
        migrationMode: "external-one-shot-only",
        rollbackTargetForSchemaVersion: 39,
      }
    : releaseRole === "final"
      ? {
          activeSchemaVersions: [39],
          migrationMode: "forbidden-from-final-runtime",
          standbySchemaVersions: [37],
        }
      : undefined;
  const manifest = {
    admission: {
      directoryMode: "0500",
      incompleteMarkerAbsent: true,
      manifestInventoryVerified: true,
      rule: "marker-absent-directory-0500-manifest-verified",
    },
    artifactClass: "production",
    buildArch: "x64",
    buildLibc: "glibc",
    buildPlatform: "linux",
    build: {
      executedSteps: [
        { arguments: ["node_modules/typescript/bin/tsc", "--noEmit"], command: "node" },
        {
          arguments: [
            "node_modules/vite/bin/vite.js",
            "build",
            "--configLoader",
            "runner",
          ],
          command: "node",
        },
      ],
      lockSha256: sha256(`lock:${id}`),
      networkAudit: { blockedAttempts: 0, guardLoads: bridge ? 6 : 2 },
      networkSandboxVerified: true,
      sandboxProfileSha256: sha256(`sandbox:${id}`),
    },
    commit: sha256(`commit:${id}`).slice(0, 40),
    ...(formal ? {
      databaseCompatibility,
      expectedVersion: version,
    } : {}),
    files,
    format: "unboundry-immutable-release",
    ...(formal ? { formalReleaseCommit: true } : {}),
    hostPrerequisites: {
      executables: [
        prerequisite("node"),
        prerequisite("ffmpeg"),
        prerequisite("ffprobe"),
      ],
      sandbox: {
        arguments: ["--version"],
        name: "bwrap",
        path: "/usr/bin/bwrap",
        required: true,
        sha256: sha256(`bwrap:${id}`),
        versionOutputSha256: sha256(`bubblewrap version:${id}`),
        versionPattern: "^bubblewrap [0-9]+\\.[0-9]+(?:\\.[0-9]+)?$",
      },
    },
    nodeVersion: process.versions.node,
    npmVersion: "10.9.8",
    packageVersion: version,
    releaseId: id,
    ...(formal ? {
      releaseRole,
      releaseStage: releaseRole,
    } : {}),
    ...(bridge ? {
      legacyRuntime: {
        archiveSha256: exactLegacyRuntimeContract.archiveSha256,
        build: {
          dependencyInventorySha256: sha256("m95 synthetic legacy dependency inventory"),
          executedSteps: [
            { arguments: ["node_modules/typescript/bin/tsc", "--noEmit"], command: "node" },
            {
              arguments: [
                "node_modules/vite/bin/vite.js",
                "build",
                "--configLoader",
                "runner",
              ],
              command: "node",
            },
          ],
          lockSha256: legacyLock?.type === "file" ? legacyLock.sha256 : undefined,
          networkAudit: { blockedAttempts: 0, guardLoads: 6 },
          networkSandboxVerified: true,
          parentDependencyConfigLoadSmoke: true,
          sandboxProfileSha256: sha256(`sandbox:${id}`),
          sourceLockSha256: exactLegacySourceLockSha256,
          workingDirectory: "exact-v0.5.1-version-overlay",
        },
        clientIndexSha256: legacyIndexSha256,
        commitTree: exactLegacyRuntimeContract.commitTree,
        inventorySha256: sha256(Buffer.from(JSON.stringify(legacyEntries))),
        originalLockSha256: exactLegacySourceLockSha256,
        originalInventorySha256: exactLegacyRuntimeContract.originalInventorySha256,
        overlay: {
          "package-lock.json": legacyLock?.type === "file" ? legacyLock.sha256 : undefined,
          "package.json": legacyPackage?.type === "file" ? legacyPackage.sha256 : undefined,
        },
        peeledCommit: exactLegacyRuntimeContract.peeledCommit,
        productionDependencies: exactLegacyProductionDependencies,
        runtimeDependencyResolution: "parent-release-node_modules",
        tag: "v0.5.1",
        trackedFiles: exactLegacyRuntimeContract.trackedFiles,
        version,
      },
    } : {}),
    runtime: {
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
      command: "/opt/node22/bin/node",
      cwd: ".",
      environment: {
        HOME: placeholders("UNBOUNDRY_RUNTIME_HOME"),
        NODE_ENV: { required: true, source: "literal", value: "production" },
        PATH: {
          required: true,
          source: "literal",
          value: "/opt/node22/bin:/usr/bin:/bin",
        },
        TEMP: placeholders("UNBOUNDRY_RUNTIME_TEMP"),
        TMP: placeholders("UNBOUNDRY_RUNTIME_TEMP"),
        TMPDIR: placeholders("UNBOUNDRY_RUNTIME_TEMP"),
        UNBOUNDRY_DATA_DIR: placeholders("UNBOUNDRY_DATA_DIR"),
        UNBOUNDRY_RUNTIME_DIR: placeholders("UNBOUNDRY_RUNTIME_DIR"),
        UNBOUNDRY_RUNTIME_ROLE: placeholders("UNBOUNDRY_RUNTIME_ROLE"),
        UNBOUNDRY_SECURE_COOKIES: { required: true, source: "literal", value: "1" },
        UNBOUNDRY_TRUST_PROXY: { required: true, source: "literal", value: "1" },
        UNBOUNDRY_VITE_CACHE_DIR: placeholders("UNBOUNDRY_VITE_CACHE_DIR"),
      },
      forbiddenEnvironment: formal ? formalForbiddenEnvironment : exactForbiddenEnvironment,
      forbiddenEnvironmentPrefixes: ["UNBOUNDRY_TEST_"],
      health: {
        ...(bridge ? {
          legacySchema37StaticAsset: {
            path: "legacy-runtime/dist/client/index.html",
            sha256: legacyIndexSha256,
            size: legacyIndexSize,
            url: "/",
          },
        } : {}),
        livePath: "/api/health/live",
        readyPath: "/api/health/ready",
        staticAsset: {
          path: "dist/client/index.html",
          sha256: sha256(staticBytes),
          size: staticBytes.length,
          url: "/",
        },
        version,
        versionPath: "/api/version",
      },
      placeholders: runtimePlaceholders,
    },
    runtimeRoots: formal
      ? [
          "client",
          "dist",
          ...(bridge ? ["legacy-runtime"] : []),
          "node_modules",
          "package-lock.json",
          "package.json",
          ...(bridge
            ? [
                "scripts/migrate-schema37-to39.mjs",
                "scripts/node-typescript-runtime.mjs",
              ]
            : []),
          "server",
          "spec/unboundry-state-fixtures.json",
          "types",
          "vite.config.ts",
        ].sort()
      : [
          "dist",
          "node_modules",
          "client",
          "server",
          "types",
          "vite.config.ts",
          "spec/unboundry-state-fixtures.json",
          "package.json",
          "package-lock.json",
        ],
    ...(bridge ? {
      migration: {
        arguments: exactMigrationArguments,
        command: "/opt/node22/bin/node",
        httpListener: false,
        permittedReleaseRole: "bridge",
        placeholders: exactMigrationPlaceholders,
      },
    } : {}),
    schemaVersion: formal ? 3 : 2,
    sourceTree: sha256(`tree:${id}`).slice(0, 40),
  };
  await write(
    join(directory, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    0o400,
  );
  await freezeDirectories(directory);
}

function stateDocument(schemaVersion: 37 | 39) {
  return {
    bridgeReleaseId: "v0.5.2",
    exactOldReleaseId: "v0.5.1",
    finalReleaseId: "v0.6.0",
    format: "unboundry-release-data-state-v1",
    logicalRowsSha256: sha256("m95 synthetic logical rows"),
    schemaVersion,
  };
}

async function createFixture(options: {
  currentId?: string;
  schemaVersion?: 37 | 39;
} = {}) {
  const uncanonicalRoot = await mkdtemp(join(tmpdir(), "unboundry-m95-"));
  const root = await realpath(uncanonicalRoot);
  await chmod(root, 0o700);
  const releaseRoot = join(root, "releases");
  await mkdir(releaseRoot, { mode: 0o700 });
  for (const [id, role] of [
    ["v0.5.1", "legacy"],
    ["v0.5.2", "bridge"],
    ["v0.6.0", "final"],
  ] as const) {
    await createRelease(releaseRoot, id, role);
  }
  const currentId = options.currentId ?? "v0.5.2";
  const currentLink = join(releaseRoot, "current");
  await symlink(currentId, currentLink);
  const databaseState = join(root, "database-state.json");
  const stateBytes = `${JSON.stringify(stateDocument(options.schemaVersion ?? 37), null, 2)}\n`;
  await write(databaseState, stateBytes, 0o600);
  const backupReceipt = join(root, "backup-receipt.json");
  await write(backupReceipt, `${JSON.stringify({
    activeGenerationTasks: 0,
    databaseStateSha256: sha256(stateBytes),
    format: "unboundry-frozen-backup-receipt-v1",
    frozen: true,
    generationAdmissionQuietSinceEpochMs: Date.now() - 65_000,
    providerAdmissionsAfterQuietSince: 0,
    schemaVersion: 37,
  }, null, 2)}\n`, 0o400);
  return {
    backupReceipt,
    currentLink,
    databaseState,
    releaseRoot,
    root,
  };
}

function argumentsFor(
  fixture: Fixture,
  options: {
    candidateId?: string;
    failure?: string;
    operation?: "bridge-switch" | "migrate-switch" | "rollback";
    receiptName?: string;
    safeCheckpoint?: string;
    sequencingReceipt?: string;
  } = {},
) {
  return [
    rehearsalScript,
    "--backup-receipt", fixture.backupReceipt,
    "--sequencing-receipt", options.sequencingReceipt ?? join(fixture.root, "missing-sequencing.json"),
    "--candidate-id", options.candidateId ?? "v0.6.0",
    "--current-link", fixture.currentLink,
    "--database-state", fixture.databaseState,
    "--failure", options.failure ?? "none",
    "--operation", options.operation ?? "migrate-switch",
    "--receipt-path", join(fixture.root, options.receiptName ?? "rehearsal-receipt.json"),
    "--rehearsal-root", fixture.root,
    "--release-root", fixture.releaseRoot,
  ];
}

function rehearsalEnvironment(fixture: Fixture, safeCheckpoint?: string) {
  return {
    HOME: "/var/empty",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TEMP: dirname(fixture.root),
    TMP: dirname(fixture.root),
    TMPDIR: dirname(fixture.root),
    ...(safeCheckpoint ? {
      UNBOUNDRY_M95_SAFE_CHECKPOINT: safeCheckpoint,
      UNBOUNDRY_SAFE_TEST: "1",
    } : {}),
  };
}

async function prepareSequencingReceipt(
  fixture: Fixture,
  options: Parameters<typeof argumentsFor>[1] = {},
) {
  if (options.sequencingReceipt) return options.sequencingReceipt;
  const operation = options.operation ?? "migrate-switch";
  const candidateId = options.candidateId ?? "v0.6.0";
  const currentId = await readlink(fixture.currentLink);
  const [currentManifestBytes, candidateManifestBytes, backupBytes, stateBytes] = await Promise.all([
    readFile(join(fixture.releaseRoot, currentId, "release-manifest.json")),
    readFile(join(fixture.releaseRoot, candidateId, "release-manifest.json")),
    readFile(fixture.backupReceipt),
    readFile(fixture.databaseState),
  ]);
  const state = JSON.parse(stateBytes.toString("utf8")) as { schemaVersion: number };
  const sequencingReceipt = join(
    fixture.root,
    `sequencing-${options.receiptName ?? operation}.json`,
  );
  const issuedAtEpochMs = Date.now();
  const syntheticNonce = sha256(
    Buffer.concat([
      randomBytes(32),
      Buffer.from(`${issuedAtEpochMs}:${operation}:${currentId}:${candidateId}`, "utf8"),
    ]),
  );
  await write(sequencingReceipt, `${JSON.stringify({
    backupReceiptSha256: operation === "bridge-switch" ? null : sha256(backupBytes),
    candidateManifestSha256: sha256(candidateManifestBytes),
    candidateReleaseId: candidateId,
    currentManifestSha256: sha256(currentManifestBytes),
    currentReleaseId: currentId,
    databaseStateSha256: sha256(stateBytes),
    evidenceClass: "synthetic",
    expiresAtEpochMs: issuedAtEpochMs + 60_000,
    format: "unboundry-synthetic-sequencing-receipt-v1",
    issuedAtEpochMs,
    operation,
    schemaVersion: state.schemaVersion,
    syntheticNonce,
    syntheticSequenceId: sha256(`sequence:${syntheticNonce}`),
  }, null, 2)}\n`, 0o400);
  return sequencingReceipt;
}

async function executePreparedRehearsal(
  fixture: Fixture,
  options: RehearsalOptions,
  sequencingReceipt: string,
): Promise<RehearsalResult> {
  try {
    const result = await execute(process.execPath, argumentsFor(fixture, {
      ...options,
      sequencingReceipt,
    }), {
      cwd: process.cwd(),
      env: rehearsalEnvironment(fixture, options.safeCheckpoint),
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    });
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as Error & { code?: number; stderr?: string; stdout?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : -1,
      stderr: String(failure.stderr ?? ""),
      stdout: String(failure.stdout ?? ""),
    };
  }
}

function startPreparedRehearsal(
  fixture: Fixture,
  options: RehearsalOptions,
  sequencingReceipt: string,
) {
  const child = spawn(process.execPath, argumentsFor(fixture, {
    ...options,
    sequencingReceipt,
  }), {
    cwd: process.cwd(),
    env: rehearsalEnvironment(fixture, options.safeCheckpoint),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  const completion = new Promise<RehearsalResult>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({
      exitCode: code ?? -1,
      stderr,
      stdout,
    }));
  });
  return { child, completion };
}

async function waitForPath(path: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await lstat(path).then(() => true, () => false)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function runRehearsal(
  fixture: Fixture,
  options: Parameters<typeof argumentsFor>[1] = {},
): Promise<RehearsalResult> {
  const sequencingReceipt = await prepareSequencingReceipt(fixture, options);
  return executePreparedRehearsal(fixture, options, sequencingReceipt);
}

async function removeFixture(fixture: Fixture) {
  async function makeWritable(path: string) {
    const details = await lstat(path).catch(() => undefined);
    if (!details || details.isSymbolicLink()) return;
    if (details.isDirectory()) {
      await chmod(path, 0o700);
      for (const name of await readdir(path)) await makeWritable(join(path, name));
    } else await chmod(path, 0o600);
  }
  await makeWritable(fixture.root);
  await rm(fixture.root, { force: true, recursive: true });
}

test("schema 37 bridge rehearsal migrates without HTTP, atomically switches, drains and retains N-1", async () => {
  test.setTimeout(60_000);
  const fixture = await createFixture({ currentId: "v0.5.1" });
  try {
    const schema37Before = await readFile(fixture.databaseState);
    const bridgePhase = await runRehearsal(fixture, {
      candidateId: "v0.5.2",
      operation: "bridge-switch",
      receiptName: "bridge-phase.json",
    });
    expect(bridgePhase.exitCode, bridgePhase.stderr).toBe(0);
    const bridgeSummary = JSON.parse(bridgePhase.stdout);
    expect(bridgeSummary).toMatchObject({
      evidenceClass: "synthetic",
      syntheticOperation: "bridge-switch",
      syntheticPointerAfter: "v0.5.2",
      syntheticPointerBefore: "v0.5.1",
      syntheticStatus: "passed",
    });
    expect(await readlink(fixture.currentLink)).toBe("v0.5.2");
    expect((await readFile(fixture.databaseState)).equals(schema37Before)).toBe(true);

    const bridgeManifestBytes = await readFile(
      join(fixture.releaseRoot, "v0.5.2", "release-manifest.json"),
    );
    const bridgeManifest = JSON.parse(bridgeManifestBytes.toString("utf8"));
    const currentStaticBytes = await readFile(
      join(fixture.releaseRoot, "v0.5.2", bridgeManifest.runtime.health.staticAsset.path),
    );
    const schema37StaticBytes = await readFile(
      join(
        fixture.releaseRoot,
        "v0.5.2",
        bridgeManifest.runtime.health.legacySchema37StaticAsset.path,
      ),
    );
    expect(sha256(currentStaticBytes)).toBe(
      bridgeManifest.runtime.health.staticAsset.sha256,
    );
    expect(sha256(schema37StaticBytes)).toBe(
      bridgeManifest.runtime.health.legacySchema37StaticAsset.sha256,
    );
    expect(schema37StaticBytes.equals(currentStaticBytes)).toBe(false);
    expect(bridgeSummary.syntheticSteps).toEqual(expect.arrayContaining([
      "candidate-standby-static-live-version-and-role-blocked-ready-health",
    ]));
    const bridgeMigrationBytes = await readFile(
      join(fixture.releaseRoot, "v0.5.2", "scripts/migrate-schema37-to39.mjs"),
    );

    const result = await runRehearsal(fixture, { receiptName: "migration-phase.json" });
    expect(result.exitCode, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      evidenceClass: "synthetic",
      syntheticDrain: {
        getCompleted: true,
        postAttempts: 1,
        postAutomaticallyRetried: false,
        postStatus: 503,
        rangeCompleted: true,
        rangeStatus: 206,
      },
      syntheticExecution: {
        hostPrerequisitesActuallyExecuted: false,
        migrationActuallyExecuted: false,
        productRuntimeActuallyExecuted: false,
        proxyActuallyExecuted: true,
        syntheticFakeRuntimeActuallyExecuted: true,
      },
      syntheticMigration: {
        artifactSha256: sha256(bridgeMigrationBytes),
        bridgeStoppedBeforeMigration: true,
        committed: true,
        httpListenerStarted: false,
        manifestSha256: sha256(bridgeManifestBytes),
        quietMillisecondsRequired: 60_000,
        quietReceiptVerifiedBeforeBridgeStop: true,
        releaseId: "v0.5.2",
        restartAfterCommit: true,
      },
      syntheticOperation: "migrate-switch",
      syntheticPointerAfter: "v0.6.0",
      syntheticPointerBefore: "v0.5.2",
      syntheticReleaseRoles: { candidate: "final", current: "bridge" },
      syntheticStatus: "passed",
    });
    expect(summary.syntheticSequenceId).not.toBe(bridgeSummary.syntheticSequenceId);
    expect(summary.syntheticSequenceReceiptSha256).not.toBe(
      bridgeSummary.syntheticSequenceReceiptSha256,
    );
    expect(await readlink(fixture.currentLink)).toBe("v0.6.0");
    expect(JSON.parse(await readFile(fixture.databaseState, "utf8"))).toMatchObject({
      migrationArtifactSha256: sha256(bridgeMigrationBytes),
      migrationHttpListenerStarted: false,
      migrationManifestSha256: sha256(bridgeManifestBytes),
      migrationReleaseId: "v0.5.2",
      schemaVersion: 39,
    });
    expect((await lstat(join(fixture.releaseRoot, "v0.5.2"))).isDirectory()).toBe(true);
    const frozenReceipt = await lstat(join(fixture.root, "migration-phase.json"));
    expect(frozenReceipt.mode & 0o777).toBe(0o400);
  } finally {
    await removeFixture(fixture);
  }

  const receiptCommitFixture = await createFixture();
  try {
    const committed = await runRehearsal(receiptCommitFixture, {
      receiptName: "receipt-post-link-commit.json",
      safeCheckpoint: "receipt-post-link-commit",
    });
    expect(committed.exitCode, committed.stderr).toBe(0);
    expect(JSON.parse(committed.stdout)).toMatchObject({
      syntheticReceiptCommitRule: "no-replace-hard-link-is-terminal",
      syntheticStatus: "passed",
    });
    expect(JSON.parse(await readFile(
      join(receiptCommitFixture.root, "receipt-post-link-commit.json"),
      "utf8",
    ))).toMatchObject({
      syntheticReceiptCommitRule: "no-replace-hard-link-is-terminal",
      syntheticStatus: "passed",
    });
    expect(
      await lstat(join(receiptCommitFixture.root, ".unboundry-m95-operation-reservation"))
        .then(() => true, () => false),
    ).toBe(false);
  } finally {
    await removeFixture(receiptCommitFixture);
  }
});

test("every pre-publication fault leaves current on a healthy bridge and writes a frozen failure receipt", async () => {
  test.setTimeout(180_000);
  for (const failure of [
    "build",
    "manifest",
    "static-health",
    "live-health",
    "ready-health",
    "migration",
    "nginx-validate",
    "nginx-switch",
    "post-publication-health",
  ]) {
    const fixture = await createFixture();
    try {
      const stateBefore = await readFile(fixture.databaseState);
      const receiptName = `receipt-${failure}.json`;
      const result = await runRehearsal(fixture, { failure, receiptName });
      expect(result.exitCode, failure).not.toBe(0);
      expect(await readlink(fixture.currentLink), failure).toBe("v0.5.2");
      const receipt = JSON.parse(await readFile(join(fixture.root, receiptName), "utf8"));
      expect(receipt).toMatchObject({
        evidenceClass: "synthetic",
        syntheticPointerAfter: "v0.5.2",
        syntheticPointerBefore: "v0.5.2",
        syntheticPointerUnchanged: true,
        syntheticStatus: "failed",
      });
      expect(receipt.syntheticOldRecovery?.healthy, failure).toBe(true);
      expect(receipt.syntheticOldRecovery?.writeProbe?.attempts, failure).toBe(1);
      expect((await lstat(join(fixture.root, receiptName))).mode & 0o777, failure).toBe(0o400);
      const stateAfter = await readFile(fixture.databaseState);
      if (["nginx-validate", "nginx-switch", "post-publication-health"].includes(failure)) {
        expect(JSON.parse(stateAfter.toString("utf8")).schemaVersion, failure).toBe(39);
      } else expect(stateAfter.equals(stateBefore), failure).toBe(true);
    } finally {
      await removeFixture(fixture);
    }
  }
  for (const [safeCheckpoint, expectedCode] of [
    ["sequence-expires-at-publication", "SEQUENCING_RECEIPT_INVALID"],
    ["state-race-before-rename", "DATA_STATE_CHANGED"],
    ["current-race-before-rename", "CURRENT_POINTER_CHANGED"],
    ["post-rename-publication-failure", "CURRENT_PUBLICATION_POST_RENAME_FAILED"],
  ] as const) {
    const fixture = await createFixture();
    try {
      const receiptName = `safe-checkpoint-${safeCheckpoint}.json`;
      const result = await runRehearsal(fixture, {
        receiptName,
        safeCheckpoint,
      });
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(JSON.parse(result.stderr)).toMatchObject({ code: expectedCode });
      expect(await readlink(fixture.currentLink)).toBe("v0.5.2");
      const receipt = JSON.parse(await readFile(join(fixture.root, receiptName), "utf8"));
      expect(receipt).toMatchObject({
        syntheticOldRecovery: { healthy: true },
        syntheticPointerAfter: "v0.5.2",
        syntheticPointerRecoveryState: "old",
        syntheticPointerUnchanged: true,
        syntheticStatus: "failed",
      });
      expect(
        await lstat(join(fixture.root, ".unboundry-m95-operation-reservation"))
          .then(() => true, () => false),
      ).toBe(false);
      const state = JSON.parse(await readFile(fixture.databaseState, "utf8"));
      if (safeCheckpoint === "state-race-before-rename") {
        expect(state.syntheticOutsideWriterCheckpoint).toMatch(/^[0-9a-f]{64}$/);
        expect(state.schemaVersion).toBe(37);
      } else expect(state.schemaVersion).toBe(39);
    } finally {
      await removeFixture(fixture);
    }
  }
});

test("schema 39 rejects exact v0.5.1 and permits only the frozen bridge rollback", async () => {
  test.setTimeout(120_000);
  const fixture = await createFixture({ currentId: "v0.6.0", schemaVersion: 39 });
  try {
    const exact = await runRehearsal(fixture, {
      candidateId: "v0.5.1",
      operation: "rollback",
      receiptName: "exact-old-rejected.json",
    });
    expect(exact.exitCode).not.toBe(0);
    expect(JSON.parse(exact.stderr)).toMatchObject({
      code: "EXACT_OLD_ROLLBACK_FORBIDDEN",
    });
    expect(await readlink(fixture.currentLink)).toBe("v0.6.0");

    const bridge = await runRehearsal(fixture, {
      candidateId: "v0.5.2",
      operation: "rollback",
      receiptName: "bridge-rollback.json",
    });
    expect(bridge.exitCode, bridge.stderr).toBe(0);
    expect(JSON.parse(bridge.stdout)).toMatchObject({
      syntheticDrain: {
        postAttempts: 1,
        postAutomaticallyRetried: false,
        rangeStatus: 206,
      },
      syntheticMigration: { committed: false },
      syntheticOperation: "rollback",
      syntheticPointerAfter: "v0.5.2",
      syntheticPointerBefore: "v0.6.0",
      syntheticStatus: "passed",
    });
    expect(await readlink(fixture.currentLink)).toBe("v0.5.2");
    expect(JSON.parse(await readFile(fixture.databaseState, "utf8")).schemaVersion).toBe(39);
    expect((await lstat(join(fixture.releaseRoot, "v0.6.0"))).isDirectory()).toBe(true);
  } finally {
    await removeFixture(fixture);
  }

  const concurrentFixture = await createFixture();
  try {
    const sequencingReceipt = await prepareSequencingReceipt(concurrentFixture, {
      receiptName: "reservation-winner.json",
    });
    const first = startPreparedRehearsal(concurrentFixture, {
      receiptName: "reservation-winner.json",
      safeCheckpoint: "hold-after-reservation",
    }, sequencingReceipt);
    const reachedPath = join(
      concurrentFixture.root,
      ".unboundry-m95-safe-checkpoint-reached",
    );
    await waitForPath(reachedPath);
    const stateBeforeCompetition = await readFile(concurrentFixture.databaseState);
    const second = await executePreparedRehearsal(concurrentFixture, {
      receiptName: "reservation-loser.json",
    }, sequencingReceipt);
    expect(second.exitCode).not.toBe(0);
    expect(JSON.parse(second.stderr)).toMatchObject({ code: "OPERATION_RESERVED" });
    expect(await readlink(concurrentFixture.currentLink)).toBe("v0.5.2");
    expect((await readFile(concurrentFixture.databaseState)).equals(stateBeforeCompetition)).toBe(true);
    await write(
      join(concurrentFixture.root, ".unboundry-m95-safe-checkpoint-resume"),
      "resume\n",
      0o600,
    );
    const winner = await first.completion;
    expect(winner.exitCode, winner.stderr).toBe(0);
    expect(JSON.parse(winner.stdout)).toMatchObject({
      syntheticPointerAfter: "v0.6.0",
      syntheticStatus: "passed",
    });
    expect(await readlink(concurrentFixture.currentLink)).toBe("v0.6.0");
    expect(JSON.parse(await readFile(concurrentFixture.databaseState, "utf8")).schemaVersion)
      .toBe(39);
    expect(
      await lstat(join(concurrentFixture.root, "reservation-loser.json"))
        .then(() => true, () => false),
    ).toBe(false);
  } finally {
    await removeFixture(concurrentFixture);
  }
});

test("manifest inventory tampering fails before migration and never changes current", async () => {
  test.setTimeout(60_000);
  const fixture = await createFixture();
  try {
    const candidate = join(fixture.releaseRoot, "v0.6.0");
    await chmod(candidate, 0o700);
    await chmod(join(candidate, "dist"), 0o700);
    await chmod(join(candidate, "dist/client"), 0o700);
    await chmod(join(candidate, "dist/client/index.html"), 0o600);
    await writeFile(join(candidate, "dist/client/index.html"), "tampered\n");
    await chmod(join(candidate, "dist/client/index.html"), 0o400);
    await chmod(join(candidate, "dist/client"), 0o500);
    await chmod(join(candidate, "dist"), 0o500);
    await chmod(candidate, 0o500);
    const before = await readFile(fixture.databaseState);
    const result = await runRehearsal(fixture, { receiptName: "tamper-receipt.json" });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "RELEASE_MANIFEST_INVALID" });
    expect(await readlink(fixture.currentLink)).toBe("v0.5.2");
    expect((await readFile(fixture.databaseState)).equals(before)).toBe(true);
    expect(JSON.parse(await readFile(join(fixture.root, "tamper-receipt.json"), "utf8")))
      .toMatchObject({
        syntheticOldRecovery: { healthy: true },
        syntheticPointerUnchanged: true,
      });
  } finally {
    await removeFixture(fixture);
  }

  const legacyStaticFixture = await createFixture({ currentId: "v0.5.1" });
  try {
    const bridge = join(legacyStaticFixture.releaseRoot, "v0.5.2");
    const legacyStaticPath = join(
      bridge,
      "legacy-runtime/dist/client/index.html",
    );
    const currentStaticBefore = await readFile(join(bridge, "dist/client/index.html"));
    await chmod(bridge, 0o700);
    await chmod(join(bridge, "legacy-runtime"), 0o700);
    await chmod(join(bridge, "legacy-runtime/dist"), 0o700);
    await chmod(join(bridge, "legacy-runtime/dist/client"), 0o700);
    await chmod(legacyStaticPath, 0o600);
    await writeFile(legacyStaticPath, "tampered schema-37 static asset\n");
    await chmod(legacyStaticPath, 0o400);
    await chmod(join(bridge, "legacy-runtime/dist/client"), 0o500);
    await chmod(join(bridge, "legacy-runtime/dist"), 0o500);
    await chmod(join(bridge, "legacy-runtime"), 0o500);
    await chmod(bridge, 0o500);
    expect(
      (await readFile(join(bridge, "dist/client/index.html"))).equals(currentStaticBefore),
    ).toBe(true);
    const before = await readFile(legacyStaticFixture.databaseState);
    const result = await runRehearsal(legacyStaticFixture, {
      candidateId: "v0.5.2",
      operation: "bridge-switch",
      receiptName: "legacy-static-tamper-receipt.json",
    });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "RELEASE_MANIFEST_INVALID" });
    expect(await readlink(legacyStaticFixture.currentLink)).toBe("v0.5.1");
    expect((await readFile(legacyStaticFixture.databaseState)).equals(before)).toBe(true);
  } finally {
    await removeFixture(legacyStaticFixture);
  }

  for (const { label, weakenLegacy } of [
    {
      label: "archive",
      weakenLegacy: (manifest: Record<string, any>) => {
        manifest.legacyRuntime.archiveSha256 = sha256("tampered exact archive");
      },
    },
    {
      label: "peeled-commit",
      weakenLegacy: (manifest: Record<string, any>) => {
        manifest.legacyRuntime.peeledCommit = "0".repeat(40);
      },
    },
    {
      label: "commit-tree",
      weakenLegacy: (manifest: Record<string, any>) => {
        manifest.legacyRuntime.commitTree = "1".repeat(40);
      },
    },
    {
      label: "tracked-files",
      weakenLegacy: (manifest: Record<string, any>) => {
        manifest.legacyRuntime.trackedFiles =
          exactLegacyRuntimeContract.trackedFiles - 1;
      },
    },
    {
      label: "original-inventory",
      weakenLegacy: (manifest: Record<string, any>) => {
        manifest.legacyRuntime.originalInventorySha256 =
          sha256("tampered exact original inventory");
      },
    },
    {
      label: "build-attestation",
      weakenLegacy: (manifest: Record<string, any>) => {
        delete manifest.legacyRuntime.build;
      },
    },
    {
      label: "schema37-static-path",
      weakenLegacy: (manifest: Record<string, any>) => {
        manifest.runtime.health.legacySchema37StaticAsset.path =
          manifest.runtime.health.staticAsset.path;
      },
    },
  ]) {
    const weakenedBridgeFixture = await createFixture({ currentId: "v0.5.1" });
    try {
      const bridge = join(weakenedBridgeFixture.releaseRoot, "v0.5.2");
      const manifestPath = join(bridge, "release-manifest.json");
      await chmod(bridge, 0o700);
      await chmod(manifestPath, 0o600);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      weakenLegacy(manifest);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await chmod(manifestPath, 0o400);
      await chmod(bridge, 0o500);
      const before = await readFile(weakenedBridgeFixture.databaseState);
      const result = await runRehearsal(weakenedBridgeFixture, {
        candidateId: "v0.5.2",
        operation: "bridge-switch",
        receiptName:
          `weak-bridge-${label}-${randomBytes(8).toString("hex")}.json`,
      });
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "RELEASE_MANIFEST_INVALID" });
      expect(await readlink(weakenedBridgeFixture.currentLink)).toBe("v0.5.1");
      expect((await readFile(weakenedBridgeFixture.databaseState)).equals(before)).toBe(true);
    } finally {
      await removeFixture(weakenedBridgeFixture);
    }
  }

  for (const weaken of [
    (manifest: Record<string, any>) => { delete manifest.hostPrerequisites.sandbox; },
    (manifest: Record<string, any>) => { delete manifest.build.networkAudit; },
    (manifest: Record<string, any>) => { manifest.releaseRole = "bridge"; },
    (manifest: Record<string, any>) => { manifest.packageVersion = "0.5.2"; },
    (manifest: Record<string, any>) => {
      manifest.databaseCompatibility.activeSchemaVersions = [37, 39];
    },
    (manifest: Record<string, any>) => {
      manifest.migration = {
        arguments: exactMigrationArguments,
        command: "/opt/node22/bin/node",
        httpListener: false,
        permittedReleaseRole: "bridge",
        placeholders: exactMigrationPlaceholders,
      };
    },
  ]) {
    const weakenedFixture = await createFixture();
    try {
      const candidate = join(weakenedFixture.releaseRoot, "v0.6.0");
      const manifestPath = join(candidate, "release-manifest.json");
      await chmod(candidate, 0o700);
      await chmod(manifestPath, 0o600);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      weaken(manifest);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await chmod(manifestPath, 0o400);
      await chmod(candidate, 0o500);
      const before = await readFile(weakenedFixture.databaseState);
      const result = await runRehearsal(weakenedFixture, {
        receiptName: `weak-manifest-${randomBytes(8).toString("hex")}.json`,
      });
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stderr)).toMatchObject({ code: "RELEASE_MANIFEST_INVALID" });
      expect(await readlink(weakenedFixture.currentLink)).toBe("v0.5.2");
      expect((await readFile(weakenedFixture.databaseState)).equals(before)).toBe(true);
    } finally {
      await removeFixture(weakenedFixture);
    }
  }

  const unboundMigrationFixture = await createFixture({ currentId: "v0.5.1" });
  try {
    const bridge = join(unboundMigrationFixture.releaseRoot, "v0.5.2");
    const manifestPath = join(bridge, "release-manifest.json");
    await chmod(bridge, 0o700);
    await chmod(manifestPath, 0o600);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.migration.arguments[0] = "scripts/not-the-bound-migration.mjs";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await chmod(manifestPath, 0o400);
    await chmod(bridge, 0o500);
    const before = await readFile(unboundMigrationFixture.databaseState);
    const result = await runRehearsal(unboundMigrationFixture, {
      candidateId: "v0.5.2",
      operation: "bridge-switch",
      receiptName: "unbound-migration.json",
    });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "RELEASE_MANIFEST_INVALID" });
    expect(await readlink(unboundMigrationFixture.currentLink)).toBe("v0.5.1");
    expect((await readFile(unboundMigrationFixture.databaseState)).equals(before)).toBe(true);
  } finally {
    await removeFixture(unboundMigrationFixture);
  }
});

test("oversized static health declaration is rejected before any response buffering", async () => {
  test.setTimeout(60_000);
  const fixture = await createFixture();
  try {
    const candidate = join(fixture.releaseRoot, "v0.6.0");
    const manifestPath = join(candidate, "release-manifest.json");
    await chmod(candidate, 0o700);
    await chmod(manifestPath, 0o600);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.runtime.health.staticAsset.size = 64 * 1024 * 1024 + 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await chmod(manifestPath, 0o400);
    await chmod(candidate, 0o500);
    const before = await readFile(fixture.databaseState);
    const result = await runRehearsal(fixture, { receiptName: "oversized-receipt.json" });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "RELEASE_MANIFEST_INVALID" });
    expect(await readlink(fixture.currentLink)).toBe("v0.5.2");
    expect((await readFile(fixture.databaseState)).equals(before)).toBe(true);
  } finally {
    await removeFixture(fixture);
  }

  const crashFixture = await createFixture();
  try {
    const sequencingReceipt = await prepareSequencingReceipt(crashFixture, {
      receiptName: "crash-residue.json",
    });
    const crashed = await executePreparedRehearsal(crashFixture, {
      receiptName: "crash-residue.json",
      safeCheckpoint: "crash-after-reservation",
    }, sequencingReceipt);
    expect(crashed.exitCode).not.toBe(0);
    const reservationPath = join(
      crashFixture.root,
      ".unboundry-m95-operation-reservation",
    );
    expect((await lstat(reservationPath)).mode & 0o777).toBe(0o600);
    const retried = await executePreparedRehearsal(crashFixture, {
      receiptName: "crash-residue-retry.json",
    }, sequencingReceipt);
    expect(retried.exitCode).not.toBe(0);
    expect(JSON.parse(retried.stderr)).toMatchObject({ code: "OPERATION_RESERVED" });
    expect(await readlink(crashFixture.currentLink)).toBe("v0.5.2");
    expect(JSON.parse(await readFile(crashFixture.databaseState, "utf8")).schemaVersion).toBe(37);
  } finally {
    await removeFixture(crashFixture);
  }
});
