import { spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import {
  request as httpRequest,
  type IncomingMessage,
} from "node:http";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../server/auth";
import {
  databaseMatchesFrozenSchema37Contract,
  inspectLockedBackupDatabase,
} from "../server/backupInspection";
import {
  applyPendingSchemaMigrationsInTransaction,
} from "../server/database";
import {
  isCanvasSaveSuccess,
  isLoadedCanvasDocument,
} from "../client/src/canvas/CanvasSurface";
import { expect, test } from "./safe-test";
// @ts-expect-error Operational release verification is intentionally shared
// with the Node-only release scripts rather than reimplemented in this test.
import { validateAdmittedRelease } from "../scripts/lib/admitted-release.mjs";
// @ts-expect-error The safe runner is the sole issuer of this MJS attestation.
import { readReleaseAttestation } from "../scripts/lib/release-attestation.mjs";

type V051Contract = Readonly<{
  annotatedTagObject: string;
  archiveSha256: string;
  canvasSave: Readonly<{
    acceptsPayloadWithCurrentFenceFields: boolean;
    currentClientAcceptsOldSuccess: boolean;
    currentBridgeExistingCanvasRejectCode: string;
    freshCurrentClientCanHydrateOldServer: boolean;
    legacyOptionalFenceFields: readonly string[];
    legacyRequiredFields: readonly string[];
    oldSuccessIncludesLoadToken: boolean;
    persistsPayloadWithCurrentFenceFields: boolean;
    preservesUnknownNodeData: boolean;
    recognizesObservedLoadToken: boolean;
    recognizesObservedRevision: boolean;
    validatesSaveAttemptId: boolean;
  }>;
  contract: string;
  commitTree: string;
  database: Readonly<{
    firstUnknownTargetVersion: number;
    latestMigrationName: string;
    latestSchemaVersion: number;
    rejectsUnknownMigrationRows: boolean;
  }>;
  files: Readonly<Record<string, string>>;
  safeGate: Readonly<{
    attestationContract: string;
    exactTagRuntimeRequired: boolean;
    externalRehearsalRequired: boolean;
    runsBeforeProductTests: boolean;
    scope: string;
  }>;
  peeledCommit: string;
  processTransition: Readonly<{
    bridgeMustStopBeforeMigration: boolean;
    oneShotStartsHttpListener: boolean;
    restartAfterCommitRequired: boolean;
    sameProcessHotActivationSupported: boolean;
    schema37MutationsAccepted: boolean;
    schema37ReadyHttpStatus: number;
    schema37ReadyMode: string;
  }>;
  schema39ExactTagRuntime: Readonly<{
    databaseBytesUnchanged: boolean;
    directRollbackSupported: boolean;
    firstDatabaseBackedRequestTerminatesProcess: boolean;
    journalModeChangedToWalBeforeRejection: boolean;
    logicalRowsUnchanged: boolean;
    rejectionMessage: string;
    sqliteSidecarsMayBeCreated: boolean;
    startsHttpListenerBeforeDatabaseOpen: boolean;
    versionEndpointReturns200BeforeDatabaseOpen: boolean;
  }>;
  tag: string;
  trackedEntries: number;
}>;

type V051RunnerAttestation = Readonly<{
  build: Readonly<{
    npmCiOffline: true;
    npmIgnoreScripts: true;
    typescriptNoEmit: true;
    viteBuild: true;
  }>;
  contract: string;
  exactTag: Readonly<{
    annotatedTagObject: string;
    archiveSha256: string;
    commitTree: string;
    completeTreeVerified: true;
    files: Readonly<Record<string, string>>;
    peeledCommit: string;
    tag: string;
    trackedEntries: number;
  }>;
  network: Readonly<{
    blocked: 0;
    forbiddenPort: 4173;
    loopbackPort: number;
  }>;
  nonce: string;
  rehearsal: Readonly<{
    contract: string;
    nonce: string;
    schema37Wire: Readonly<{
      acceptsCurrentFenceFields: true;
      hiddenCommitGraphRevision: 8;
      hiddenCommitRevision: 8;
      loadIncludesLoadToken: false;
      loginStatus: 200;
      oldSuccessIncludesLoadToken: false;
      preservesUnknownNodeData: true;
      reloadRevision: 8;
      hiddenCommitLogicalSha256: string;
      initialSchema37LogicalSha256: string;
      version: "0.5.1";
      versionStatus: 200;
    }>;
    schema39Rejection: Readonly<{
      afterLogicalSha256: string;
      beforeLogicalSha256: string;
      databaseBytesChanged: true;
      firstDatabaseRequestFailed: true;
      integrityCheck: "ok";
      journalModeAfter: "wal";
      journalModeBefore: "delete";
      latestMigration: Readonly<{ name: string; version: 40 }>;
      logicalRowsUnchanged: true;
      migrationJournalModeBeforeNormalization: "wal";
      processExitCode: number;
      rejectionMessage: string;
      requestTransportFailed: true;
      rollbackBaselineNormalizedByCurrent: true;
      rollbackCheckpoint: Readonly<{
        busy: 0;
        checkpointed: 0;
        log: 0;
      }>;
      sidecarsAfterExit: readonly (
        "unboundry.sqlite-shm" | "unboundry.sqlite-wal"
      )[];
      userVersion: 40;
      versionEndpointBeforeDatabaseOpen: true;
    }>;
  }>;
  runtimeRoot: string;
  source: Readonly<{ head: string; sha256: string }>;
}>;

type ReleaseEnvironmentValue = Readonly<{
  placeholder?: string;
  required: true;
  source: "literal" | "placeholder";
  value?: string;
}>;

type OperationalRelease = Readonly<{
  directory: string;
  manifest: Readonly<{
    commit: string;
    expectedVersion: string;
    legacyRuntime?: Readonly<{
      archiveSha256: string;
      commitTree: string;
      peeledCommit: string;
    }>;
    migration?: Readonly<{
      arguments: readonly string[];
      command: string;
    }>;
    releaseId: string;
    releaseRole: "bridge" | "final";
    runtime: Readonly<{
      arguments: readonly string[];
      environment: Readonly<Record<string, ReleaseEnvironmentValue>>;
      forbiddenEnvironment: readonly string[];
      forbiddenEnvironmentPrefixes: readonly string[];
      health: Readonly<{
        legacySchema37StaticAsset?: Readonly<{ path: string }>;
        readyPath: string;
        versionPath: string;
      }>;
    }>;
    sourceTree: string;
  }>;
  manifestPath: string;
  manifestSha256: string;
  releaseId: string;
  releaseRole: "bridge" | "final";
  runtimeCommand: string;
  version: string;
}>;

type OperationalReleaseAttestation = Readonly<{
  expectation: Readonly<Record<string, unknown>>;
  manifestPaths: Readonly<{ bridge: string; final: string }>;
  manifestSha256: Readonly<{ bridge: string; final: string }>;
  relationship: Readonly<{
    bridgeCommit: string;
    bridgeSourceTree: string;
    finalCommit: string;
    finalParentIsBridgeCommit: boolean;
    finalSourceTree: string;
    proofSha256: string;
  }>;
}>;

type OperationalReleasePair = Readonly<{
  attestation: OperationalReleaseAttestation;
  bridge: OperationalRelease;
  final: OperationalRelease;
}>;

// Every admitted release runtime is started on the runner-owned main port.
// The bridge's private exact-old child chooses its own loopback port; m81 owns
// that child-listener security contract, so m92 never reaches it directly.
const port = Number(process.env.UNBOUNDRY_TEST_PORT);
const origin = `http://127.0.0.1:${port}`;
const admittedRuntimeHeaders = Object.freeze({
  Host: "canvas.mymy.ltd",
  "X-Forwarded-For": "127.0.0.1",
  "X-Forwarded-Proto": "https",
});
const runtimeIdentityHeaders = new Set([
  "forwarded",
  "host",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
]);
const contractPath = join(
  process.cwd(),
  "tests/fixtures/v051-rollback-contract.json",
);
const timestamp = "2026-08-12T00:00:00.000Z";
const ownerId = "00000000-0000-4000-8000-000000000092";
const providerId = "00000000-0000-4000-8000-000000000193";
const storageId = "00000000-0000-4000-8000-000000000294";
const modelId = "m92-image-model";
const canvasId = "m92-bridge-canvas";
const taskId = "m92-paid-complete";
const mediaId = "m92-legacy-image";
const backfillMediaId = "m92-legacy-backfill-image";
const legacySessionToken = "m92-preserved-session-token";
const loginPassword = "m92-bridge-password-123";
const legacyCredential = "m92-legacy-account-key";
const currentCredential = "m92-current-account-key";
const mediaBytes = Buffer.from("m92 exact legacy media bytes", "utf8");
const viewport = Object.freeze({ x: 12, y: 24, zoom: 1.25 });
const expectedContract = Object.freeze({
  annotatedTagObject: "2e556760b693d1cee1b8b37db3e6747a916bcaf2",
  archiveSha256:
    "e7a619c4d9dbaca14d1032ef18f83f81dcfb36c9402976debc4f8f546c8bb5d0",
  canvasSave: Object.freeze({
    acceptsPayloadWithCurrentFenceFields: true,
    currentBridgeExistingCanvasRejectCode: "CANVAS_LOAD_REQUIRED",
    currentClientAcceptsOldSuccess: false,
    freshCurrentClientCanHydrateOldServer: false,
    legacyOptionalFenceFields: Object.freeze(["saveSessionId", "saveSequence"]),
    legacyRequiredFields: Object.freeze([
      "revision",
      "nodes",
      "edges",
      "viewport",
    ]),
    oldSuccessIncludesLoadToken: false,
    persistsPayloadWithCurrentFenceFields: true,
    preservesUnknownNodeData: true,
    recognizesObservedLoadToken: false,
    recognizesObservedRevision: false,
    validatesSaveAttemptId: false,
  }),
  contract: "unboundry-v051-rollback-boundary-v3",
  commitTree: "0990690bd9828757b82f59861f950ce6ff9ed4f8",
  database: Object.freeze({
    firstUnknownTargetVersion: 38,
    latestMigrationName: "protected-root-admin",
    latestSchemaVersion: 37,
    rejectsUnknownMigrationRows: true,
  }),
  files: Object.freeze({
    "package.json": "142da3969ae57ca686507377777b67783e9375474282467bc54dd9c77c60fa91",
    "server/canvasPersistence.ts":
      "ec1b2612fc8b974347744eee97bc2428ae1c29ab0c89177f5e50f2ef05923a7b",
    "server/database.ts":
      "3d907b9ea518b5e6ec3c1a03d0c68877cd8a28c49d3d20add173efc777103ed4",
    "vite.config.ts":
      "759d61ec22585cb447e80edd675efd0af1228a61448fd0e6829998ad46065786",
  }),
  peeledCommit: "7f7d6177a564056a6f41ff83dfb7ba913b21603b",
  processTransition: Object.freeze({
    bridgeMustStopBeforeMigration: true,
    oneShotStartsHttpListener: false,
    restartAfterCommitRequired: true,
    sameProcessHotActivationSupported: false,
    schema37MutationsAccepted: false,
    schema37ReadyHttpStatus: 200,
    schema37ReadyMode: "schema37-health-only-standby",
  }),
  safeGate: Object.freeze({
    attestationContract: "unboundry-v051-safe-runner-attestation-v2",
    exactTagRuntimeRequired: true,
    externalRehearsalRequired: false,
    runsBeforeProductTests: true,
    scope: "m92-or-full",
  }),
  schema39ExactTagRuntime: Object.freeze({
    databaseBytesUnchanged: false,
    directRollbackSupported: false,
    firstDatabaseBackedRequestTerminatesProcess: true,
    journalModeChangedToWalBeforeRejection: true,
    logicalRowsUnchanged: true,
    rejectionMessage: "Unknown database migration 38:durable-media-publications",
    sqliteSidecarsMayBeCreated: true,
    startsHttpListenerBeforeDatabaseOpen: true,
    versionEndpointReturns200BeforeDatabaseOpen: true,
  }),
  tag: "v0.5.1",
  trackedEntries: 371,
}) satisfies V051Contract;

function richGenerationNode(title: string) {
  return {
    data: {
      label: "M92 rich generation node",
      textGenerationInputKey: "m92-generation-input-key",
      textGenerationOwnershipKey: "m92-generation-ownership-key",
      textGenerationTaskId: taskId,
      textModelId: modelId,
      textModelName: "M92 preserved model",
      textParameters: {
        inputs: [{ kind: "text", order: 1, sourceNodeId: "m92-source" }],
        maxOutputTokens: 92,
        temperature: 0.2,
      },
      textPrompt: "M92 preserved prompt",
      title,
    },
    id: "m92-preserved-node",
    position: { x: 92, y: 39 },
    type: "text",
  };
}

const preservedRichNode = richGenerationNode("M92 preserved node");
const currentBridgeRichNode = richGenerationNode("M92 current bridge write");

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

async function readContract() {
  return JSON.parse(await readFile(contractPath, "utf8")) as V051Contract;
}

function containsPath(parent: string, child: string) {
  const difference = relative(parent, child);
  return difference === "" ||
    (!isAbsolute(difference) && difference !== ".." &&
      !difference.startsWith(`..${sep}`));
}

async function readRunnerAttestation(contract: V051Contract) {
  const lexicalPath = resolve(String(
    process.env.UNBOUNDRY_V051_ATTESTATION_PATH ?? "",
  ));
  const expectedSha256 = String(
    process.env.UNBOUNDRY_V051_ATTESTATION_SHA256 ?? "",
  );
  const expectedNonce = String(
    process.env.UNBOUNDRY_V051_ATTESTATION_NONCE ?? "",
  );
  const lexicalRuntimeRoot = resolve(String(
    process.env.UNBOUNDRY_V051_RUNTIME_ROOT ?? "",
  ));
  expect(expectedSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(expectedNonce).toMatch(
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,
  );
  const systemTemporaryRoot = await realpath(String(
    process.env.UNBOUNDRY_SYSTEM_TEMPORARY_ROOT ?? "",
  ));
  const attestationPath = await realpath(lexicalPath);
  const runtimeRoot = await realpath(lexicalRuntimeRoot);
  const attestationRoot = await realpath(dirname(attestationPath));
  const rehearsalRoot = await realpath(join(attestationRoot, ".."));
  expect(attestationPath).toBe(lexicalPath);
  expect(runtimeRoot).toBe(lexicalRuntimeRoot);
  expect(containsPath(systemTemporaryRoot, attestationPath)).toBe(true);
  expect(containsPath(systemTemporaryRoot, runtimeRoot)).toBe(true);
  expect(containsPath(rehearsalRoot, runtimeRoot)).toBe(true);
  const details = await lstat(attestationPath);
  const rootDetails = await lstat(attestationRoot);
  const runtimeDetails = await lstat(runtimeRoot);
  expect(details.isFile()).toBe(true);
  expect(details.isSymbolicLink()).toBe(false);
  expect(details.nlink).toBe(1);
  expect(details.mode & 0o777).toBe(0o400);
  expect(rootDetails.isDirectory()).toBe(true);
  expect(rootDetails.isSymbolicLink()).toBe(false);
  expect(rootDetails.mode & 0o777).toBe(0o500);
  expect(runtimeDetails.isDirectory()).toBe(true);
  expect(runtimeDetails.isSymbolicLink()).toBe(false);
  expect(runtimeDetails.mode & 0o077).toBe(0);
  if (typeof process.getuid === "function") {
    expect(details.uid).toBe(process.getuid());
    expect(rootDetails.uid).toBe(process.getuid());
    expect(runtimeDetails.uid).toBe(process.getuid());
  }
  const bytes = await readFile(attestationPath);
  expect(sha256(bytes)).toBe(expectedSha256);
  const attestation = JSON.parse(bytes.toString("utf8")) as
    V051RunnerAttestation;
  expect(attestation.exactTag.archiveSha256).toBe(contract.archiveSha256);
  expect(attestation.exactTag.commitTree).toBe(contract.commitTree);
  expect(attestation.rehearsal.schema37Wire.initialSchema37LogicalSha256)
    .toMatch(/^[a-f0-9]{64}$/);
  expect(attestation.rehearsal.schema37Wire.hiddenCommitLogicalSha256)
    .toMatch(/^[a-f0-9]{64}$/);
  expect(attestation.rehearsal.schema37Wire.hiddenCommitLogicalSha256).not.toBe(
    attestation.rehearsal.schema37Wire.initialSchema37LogicalSha256,
  );
  expect(attestation.rehearsal.schema39Rejection.beforeLogicalSha256)
    .toMatch(/^[a-f0-9]{64}$/);
  expect(attestation.rehearsal.schema39Rejection.afterLogicalSha256).toBe(
    attestation.rehearsal.schema39Rejection.beforeLogicalSha256,
  );
  expect(Number.isInteger(
    attestation.rehearsal.schema39Rejection.processExitCode,
  )).toBe(true);
  expect(attestation.rehearsal.schema39Rejection.processExitCode).not.toBe(0);
  const sidecarsAfterExit = attestation.rehearsal.schema39Rejection
    .sidecarsAfterExit;
  expect(sidecarsAfterExit).toEqual([...new Set(sidecarsAfterExit)].sort());
  expect(sidecarsAfterExit.every((entry) =>
    entry === "unboundry.sqlite-shm" || entry === "unboundry.sqlite-wal"
  )).toBe(true);
  expect(Number.isInteger(attestation.network.loopbackPort)).toBe(true);
  expect(attestation.network.loopbackPort).toBeGreaterThan(0);
  expect(attestation.network.loopbackPort).toBeLessThanOrEqual(65_535);
  expect(attestation.network.loopbackPort).not.toBe(4173);
  expect(attestation.source.head).toMatch(/^[a-f0-9]{40}$/);
  expect(attestation.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(attestation).toEqual({
    build: {
      npmCiOffline: true,
      npmIgnoreScripts: true,
      typescriptNoEmit: true,
      viteBuild: true,
    },
    contract: contract.safeGate.attestationContract,
    exactTag: {
      annotatedTagObject: contract.annotatedTagObject,
      archiveSha256: contract.archiveSha256,
      commitTree: contract.commitTree,
      completeTreeVerified: true,
      files: contract.files,
      peeledCommit: contract.peeledCommit,
      tag: contract.tag,
      trackedEntries: contract.trackedEntries,
    },
    network: {
      blocked: 0,
      forbiddenPort: 4173,
      loopbackPort: attestation.network.loopbackPort,
    },
    nonce: expectedNonce,
    rehearsal: {
      contract: "unboundry-v051-exact-runtime-rehearsal-v3",
      nonce: expectedNonce,
      schema37Wire: {
        acceptsCurrentFenceFields: contract.canvasSave
          .acceptsPayloadWithCurrentFenceFields,
        hiddenCommitGraphRevision: 8,
        hiddenCommitLogicalSha256:
          attestation.rehearsal.schema37Wire.hiddenCommitLogicalSha256,
        hiddenCommitRevision: 8,
        initialSchema37LogicalSha256:
          attestation.rehearsal.schema37Wire.initialSchema37LogicalSha256,
        loadIncludesLoadToken: contract.canvasSave.oldSuccessIncludesLoadToken,
        loginStatus: 200,
        oldSuccessIncludesLoadToken: contract.canvasSave.oldSuccessIncludesLoadToken,
        preservesUnknownNodeData: contract.canvasSave.preservesUnknownNodeData,
        reloadRevision: 8,
        version: contract.tag.slice(1),
        versionStatus: 200,
      },
      schema39Rejection: {
        afterLogicalSha256:
          attestation.rehearsal.schema39Rejection.afterLogicalSha256,
        beforeLogicalSha256:
          attestation.rehearsal.schema39Rejection.beforeLogicalSha256,
        databaseBytesChanged: !contract.schema39ExactTagRuntime
          .databaseBytesUnchanged,
        firstDatabaseRequestFailed: true,
        integrityCheck: "ok",
        journalModeAfter: "wal",
        journalModeBefore: "delete",
        latestMigration: {
          name: "seedance-trusted-asset-control-plane",
          version: 40,
        },
        logicalRowsUnchanged: contract.schema39ExactTagRuntime
          .logicalRowsUnchanged,
        migrationJournalModeBeforeNormalization: "wal",
        processExitCode:
          attestation.rehearsal.schema39Rejection.processExitCode,
        rejectionMessage: contract.schema39ExactTagRuntime.rejectionMessage,
        requestTransportFailed: true,
        rollbackBaselineNormalizedByCurrent: true,
        rollbackCheckpoint: {
          busy: 0,
          checkpointed: 0,
          log: 0,
        },
        sidecarsAfterExit,
        userVersion: 40,
        versionEndpointBeforeDatabaseOpen: contract.schema39ExactTagRuntime
          .versionEndpointReturns200BeforeDatabaseOpen,
      },
    },
    runtimeRoot,
    source: {
      head: attestation.source.head,
      sha256: attestation.source.sha256,
    },
  });
  const runtimePackage = JSON.parse(
    await readFile(join(runtimeRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  expect(runtimePackage.version).toBe("0.5.1");
  for (const [path, expectedSha256] of Object.entries(contract.files)) {
    const exactTagFile = await lstat(join(runtimeRoot, path));
    expect(exactTagFile.isFile()).toBe(true);
    expect(exactTagFile.isSymbolicLink()).toBe(false);
    expect(sha256(await readFile(join(runtimeRoot, path)))).toBe(expectedSha256);
  }
  const builtIndex = await lstat(join(runtimeRoot, "dist/client/index.html"));
  expect(builtIndex.isFile()).toBe(true);
  expect(builtIndex.isSymbolicLink()).toBe(false);
  return attestation;
}

async function readOperationalReleases(
  contract: V051Contract,
): Promise<OperationalReleasePair> {
  const attestation = await readReleaseAttestation() as
    OperationalReleaseAttestation;
  const [bridge, final] = await Promise.all([
    validateAdmittedRelease({
      expectedManifestSha256: attestation.manifestSha256.bridge,
      expectedRole: "bridge",
      manifestPath: attestation.manifestPaths.bridge,
      testExpectation: attestation.expectation,
    }) as Promise<OperationalRelease>,
    validateAdmittedRelease({
      expectedManifestSha256: attestation.manifestSha256.final,
      expectedRole: "final",
      manifestPath: attestation.manifestPaths.final,
      testExpectation: attestation.expectation,
    }) as Promise<OperationalRelease>,
  ]);

  expect(bridge).toMatchObject({
    manifestPath: attestation.manifestPaths.bridge,
    manifestSha256: attestation.manifestSha256.bridge,
    releaseId: "v0.5.2",
    releaseRole: "bridge",
    version: "0.5.2",
  });
  expect(final).toMatchObject({
    manifestPath: attestation.manifestPaths.final,
    manifestSha256: attestation.manifestSha256.final,
    releaseId: "v0.6.0",
    releaseRole: "final",
    version: "0.6.0",
  });
  expect(bridge.manifest).toMatchObject({
    commit: attestation.relationship.bridgeCommit,
    expectedVersion: bridge.version,
    releaseId: bridge.releaseId,
    releaseRole: bridge.releaseRole,
    sourceTree: attestation.relationship.bridgeSourceTree,
  });
  expect(final.manifest).toMatchObject({
    commit: attestation.relationship.finalCommit,
    expectedVersion: final.version,
    releaseId: final.releaseId,
    releaseRole: final.releaseRole,
    sourceTree: attestation.relationship.finalSourceTree,
  });
  expect(attestation.relationship.finalParentIsBridgeCommit).toBe(true);
  expect(attestation.relationship.proofSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(final.manifest.commit).not.toBe(bridge.manifest.commit);
  expect(final.manifest.sourceTree).not.toBe(bridge.manifest.sourceTree);
  expect(bridge.manifest.legacyRuntime).toMatchObject({
    archiveSha256: contract.archiveSha256,
    commitTree: contract.commitTree,
    peeledCommit: contract.peeledCommit,
  });
  expect(bridge.manifest.migration?.command).toBe(bridge.runtimeCommand);
  expect(final.manifest.legacyRuntime).toBeUndefined();
  expect(final.manifest.migration).toBeUndefined();
  return Object.freeze({ attestation, bridge, final });
}

function encryptDocument(
  key: Buffer,
  ivByte: number,
  associatedData: string,
  document: unknown,
) {
  const iv = Buffer.alloc(12, ivByte);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
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

function encryptCredential(key: Buffer, value: string) {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("unboundry:account-credentials:v1", "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join("$");
}

async function createExactSchema37Fixture(dataDirectory: string) {
  await mkdir(dataDirectory, { mode: 0o700 });
  await mkdir(join(dataDirectory, "media"), { mode: 0o700 });
  await mkdir(join(dataDirectory, "secrets"), { mode: 0o700 });
  await writeFile(join(dataDirectory, "media", `${mediaId}.png`), mediaBytes, {
    mode: 0o600,
  });
  await writeFile(
    join(dataDirectory, "media", `${backfillMediaId}.png`),
    mediaBytes,
    { mode: 0o600 },
  );

  const masterKey = Buffer.alloc(32, 0x92);
  const providerDocument = {
    profiles: [{
      baseUrl: "https://openrouter.ai/api/v1",
      configurationVersion: 1,
      createdAt: timestamp,
      driver: "openrouter",
      id: providerId,
      label: "M92 preserved Provider",
      updatedAt: timestamp,
    }],
    version: 1,
  };
  const storageDocument = {
    mediaRoutingEnabled: false,
    profiles: [{
      accessKeyId: "m92accesskey",
      accessKeySecret: "m92accesssecret",
      bucket: "m92-private-bucket",
      createdAt: timestamp,
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      id: storageId,
      label: "M92 preserved storage",
      provider: "aliyun-oss",
      region: "oss-cn-hangzhou",
      status: "draft",
      updatedAt: timestamp,
    }],
    version: 1,
  };
  await writeFile(
    join(dataDirectory, "secrets/config-master.key"),
    masterKey,
    { mode: 0o600 },
  );
  await writeFile(
    join(dataDirectory, "secrets/provider-profiles.enc.json"),
    encryptDocument(
      masterKey,
      1,
      "unboundry:provider-profiles:v1",
      providerDocument,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    join(dataDirectory, "secrets/storage-profiles.enc.json"),
    encryptDocument(
      masterKey,
      2,
      "unboundry:storage-profiles:v1",
      storageDocument,
    ),
    { mode: 0o600 },
  );

  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "PRAGMA foreign_keys = ON;" +
        "CREATE TABLE IF NOT EXISTS schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    );BEGIN IMMEDIATE;",
    );
    applyPendingSchemaMigrationsInTransaction(database, {
      appliedAt: () => timestamp,
      sourceVersion: 0,
      targetVersion: 37,
    });

    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at, protected
      ) VALUES (?, 'm92-owner', 'M92 Owner', ?, 'admin', 'active', ?, ?, 1)
    `).run(ownerId, await hashPassword(loginPassword), timestamp, timestamp);
    database.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, expires_at, created_at, last_seen_at
      ) VALUES ('m92-preserved-session', ?, ?, '2099-01-01T00:00:00.000Z', ?, ?)
    `).run(sha256(legacySessionToken), ownerId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at, deleted_at
      ) VALUES (?, ?, 'M92 preserved project', 92, 1, 92, NULL)
    `).run(ownerId, canvasId);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (?, ?, 7, 7, ?, '[]', ?, ?, 'm92-legacy-writer', 7)
    `).run(
      ownerId,
      canvasId,
      JSON.stringify([preservedRichNode]),
      JSON.stringify(viewport),
      timestamp,
    );
    database.prepare(`
      INSERT INTO provider_profiles (
        id, display_name, driver, status, provider_configuration_version,
        created_at, updated_at
      ) VALUES (?, 'M92 preserved Provider', 'openrouter', 'disabled', 1, ?, ?)
    `).run(providerId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO model_profiles (
        id, display_name, provider_profile_id, provider_model_id,
        capability, status, default_parameters, max_cost_microunits,
        cost_currency, archived_at, published_at, provider_protocol,
        created_at, updated_at
      ) VALUES (
        ?, 'M92 image model', ?, 'm92/provider-model', 'image', 'published',
        '{}', 1000, 'USD', NULL, ?, 'openai-chat', ?, ?
      )
    `).run(modelId, providerId, timestamp, timestamp, timestamp);
    database.prepare(`
      INSERT INTO account_provider_credentials (
        account_id, provider_profile_id, encrypted_key, key_status,
        key_checked_at, credential_version, updated_at
      ) VALUES (?, ?, ?, 'unchecked', NULL, 1, ?)
    `).run(
      ownerId,
      providerId,
      encryptCredential(masterKey, legacyCredential),
      timestamp,
    );
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'image', ?, ?, ?, ?, ?, ?, 'local', NULL, ?, 'image/png', ?, 'ready',
        NULL, NULL, 'not-applicable', 1, 1
      )
    `).run(
      mediaId,
      ownerId,
      `${mediaId}.png`,
      mediaBytes.length,
      timestamp,
      timestamp,
      `${mediaId}.png`,
      sha256(mediaBytes),
    );
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'image', ?, ?, ?, ?, ?, ?, 'local', NULL, ?, 'image/png', NULL, 'ready',
        NULL, NULL, 'not-applicable', 1, 1
      )
    `).run(
      backfillMediaId,
      ownerId,
      `${backfillMediaId}.png`,
      mediaBytes.length,
      timestamp,
      timestamp,
      `${backfillMediaId}.png`,
    );
    database.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt,
        created_at, updated_at, owner_id, estimated_cost_microunits,
        actual_cost_microunits, provider_profile_id, provider_model_id,
        result_asset_id, cost_currency, provider_task_id,
        provider_usage_tokens, model_configuration, result_text
      ) VALUES (
        ?, ?, 'm92-paid-node', 'image', 'preserved paid result', ?, '{}',
        'm92-paid-idempotency', ?, 'success', 1, ?, ?, ?, 1000, 900, ?,
        'm92/provider-model', ?, 'USD', 'm92-provider-task', 92, ?, NULL
      )
    `).run(
      taskId,
      canvasId,
      modelId,
      "9".repeat(64),
      timestamp,
      timestamp,
      ownerId,
      providerId,
      mediaId,
      JSON.stringify({
        credentialVersion: 1,
        displayName: "M92 image model",
        providerConfigurationVersion: 1,
      }),
    );
    database.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES (?, 'success', NULL, NULL, ?)
    `).run(taskId, timestamp);
    database.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id
      ) VALUES (?, 1, ?, 'm92/provider-model', 'image',
        'provider-boundary', ?, ?)
    `).run(taskId, providerId, timestamp, ownerId);
    database.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 0, emergency_stop = 0, updated_at = ?
      WHERE id = 1
    `).run(timestamp);
    if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) {
      throw new Error("M92 schema-37 fixture violates foreign keys");
    }
    database.exec("COMMIT; PRAGMA journal_mode = DELETE;");
    if (!databaseMatchesFrozenSchema37Contract(database)) {
      throw new Error("M92 fixture is not exact frozen schema 37");
    }
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
  await chmod(databasePath, 0o600);
  return databasePath;
}

async function directoryFingerprint(root: string) {
  const entries: string[] = [];
  async function visit(directory: string, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const metadata = await stat(absolutePath);
        entries.push(
          `f:${relativePath}:${metadata.size}:${sha256(await readFile(absolutePath))}`,
        );
      } else {
        entries.push(`o:${relativePath}`);
      }
    }
  }
  await visit(root);
  return entries.sort();
}

function logicalSha(databasePath: string, scratchRoot: string) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("BEGIN IMMEDIATE");
    return inspectLockedBackupDatabase(database, scratchRoot).logicalSha256;
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
}

function invariantTableSnapshot(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        AND name != 'media_assets'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    return Object.fromEntries(tables.map(({ name }) => [
      name,
      database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
    ]));
  } finally {
    database.close();
  }
}

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopReleaseRuntime(child: ChildProcess) {
  if (childExited(child)) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (childExited(child)) return;
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function releaseRuntimeEnvironment(
  release: OperationalRelease,
  dataDirectory: string,
  runtimeDirectory: string,
  workingRoot: string,
) {
  const launchRoot = await mkdtemp(join(
    workingRoot,
    `.m92-${release.releaseRole}-runtime-`,
  ));
  const placeholders: Readonly<Record<string, string>> = Object.freeze({
    UNBOUNDRY_DATA_DIR: dataDirectory,
    UNBOUNDRY_RUNTIME_DIR: runtimeDirectory,
    UNBOUNDRY_RUNTIME_HOME: join(launchRoot, "home"),
    UNBOUNDRY_RUNTIME_ROLE: "active",
    UNBOUNDRY_RUNTIME_TEMP: join(launchRoot, "temporary"),
    UNBOUNDRY_VITE_CACHE_DIR: join(launchRoot, "cache"),
  });
  for (const directory of [
    placeholders.UNBOUNDRY_RUNTIME_HOME,
    placeholders.UNBOUNDRY_RUNTIME_TEMP,
    placeholders.UNBOUNDRY_VITE_CACHE_DIR,
  ]) await mkdir(directory, { mode: 0o700 });
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, contract] of Object.entries(
    release.manifest.runtime.environment,
  )) {
    const value = contract.source === "literal"
      ? contract.value
      : placeholders[String(contract.placeholder ?? "")];
    if (contract.required !== true || typeof value !== "string" || !value) {
      throw new Error(`M92 ${release.releaseRole} runtime environment is incomplete`);
    }
    environment[name] = value;
  }
  for (const name of release.manifest.runtime.forbiddenEnvironment) {
    if (environment[name] !== undefined) {
      throw new Error(`M92 ${release.releaseRole} runtime admitted forbidden ${name}`);
    }
  }
  for (const prefix of release.manifest.runtime.forbiddenEnvironmentPrefixes) {
    if (Object.keys(environment).some((name) => name.startsWith(prefix))) {
      throw new Error(
        `M92 ${release.releaseRole} runtime admitted forbidden prefix ${prefix}`,
      );
    }
  }
  return environment;
}

async function startReleaseRuntime(
  release: OperationalRelease,
  dataDirectory: string,
  runtimeDirectory: string,
  workingRoot: string,
) {
  const output: Buffer[] = [];
  await mkdir(runtimeDirectory, { mode: 0o700, recursive: true });
  const environment = await releaseRuntimeEnvironment(
    release,
    dataDirectory,
    runtimeDirectory,
    workingRoot,
  );
  const arguments_ = release.manifest.runtime.arguments.map((argument) =>
    argument === "${UNBOUNDRY_PORT}" ? String(port) : argument);
  const child = spawn(
    release.runtimeCommand,
    arguments_,
    {
      cwd: release.directory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (childExited(child)) break;
    try {
      const ready = await fetch(
        `${origin}${release.manifest.runtime.health.readyPath}`,
        {
        signal: AbortSignal.timeout(500),
        },
      );
      if (ready.ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopReleaseRuntime(child);
  throw new Error(
    `M92 attested ${release.releaseRole} runtime did not become ready\n${
      Buffer.concat(output).toString("utf8").slice(-64 * 1_024)
    }`,
  );
}

async function runBridgeMigration(
  bridge: OperationalRelease,
  dataDirectory: string,
  runtimeDirectory: string,
  scratchRoot: string,
  expectedSourceLogicalSha256: string,
) {
  const migration = bridge.manifest.migration;
  if (!migration || migration.command !== bridge.runtimeCommand) {
    throw new Error("M92 attested bridge migration is unavailable");
  }
  const replacements: Readonly<Record<string, string>> = Object.freeze({
    UNBOUNDRY_DATA_DIR: dataDirectory,
    UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256:
      expectedSourceLogicalSha256,
    UNBOUNDRY_MIGRATION_SCRATCH_ROOT: scratchRoot,
    UNBOUNDRY_RUNTIME_DIR: runtimeDirectory,
  });
  const arguments_ = migration.arguments.map((argument) => {
    const match = /^\$\{([A-Z0-9_]+)\}$/.exec(argument);
    if (!match) return argument;
    const replacement = replacements[match[1]];
    if (!replacement) {
      throw new Error(`M92 migration placeholder ${match[1]} is unavailable`);
    }
    return replacement;
  });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: String(
      bridge.manifest.runtime.environment.PATH?.value ?? process.env.PATH ?? "",
    ),
    UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK: "1",
    UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK_MS: "0",
  };
  const output: Buffer[] = [];
  const child = spawn(migration.command, arguments_, {
    cwd: bridge.directory,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  const exit = await new Promise<Readonly<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const text = Buffer.concat(output).toString("utf8");
  if (exit.code !== 0 || exit.signal !== null) {
    throw new Error(`M92 attested bridge migration failed\n${text.slice(-64 * 1_024)}`);
  }
  const resultLine = text.trim().split("\n").at(-1);
  if (!resultLine) throw new Error("M92 attested bridge migration returned no result");
  const result = JSON.parse(resultLine) as Record<string, unknown>;
  if (result.ok !== true) {
    throw new Error("M92 attested bridge migration did not report success");
  }
  return result;
}

async function jsonRequest(
  path: string,
  options: Readonly<{
    body?: string;
    cookie?: string;
    headers?: Readonly<Record<string, string>>;
    method?: string;
  }> = {},
) {
  if (Object.keys(options.headers ?? {}).some((name) =>
    runtimeIdentityHeaders.has(name.toLowerCase()))) {
    throw new Error("M92 JSON requests cannot override production identity headers");
  }
  const response = await runtimeRequest(path, {
    body: options.body,
    headers: {
      ...admittedRuntimeHeaders,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    maxResponseBytes: 64 * 1_024,
    method: options.method,
  });
  const body = response.body.toString("utf8");
  return {
    body: body ? JSON.parse(body) as Record<string, unknown> : {},
    headers: response.headers,
    setCookie: response.setCookie,
    status: response.status,
  };
}

async function runtimeRequest(
  path: string,
  options: Readonly<{
    body?: Buffer | string;
    headers?: Readonly<Record<string, string>>;
    maxResponseBytes?: number;
    method?: string;
  }> = {},
) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("M92 runtime request path must be origin-form");
  }
  const requestBody = options.body === undefined
    ? undefined
    : Buffer.isBuffer(options.body)
      ? options.body
      : Buffer.from(options.body, "utf8");
  const headers: Record<string, string> = {
    ...options.headers,
    ...(requestBody ? { "Content-Length": String(requestBody.length) } : {}),
  };
  const maximumResponseBytes = options.maxResponseBytes ?? 16 * 1_024 * 1_024;
  if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1) {
    throw new Error("M92 runtime response limit must be a positive integer");
  }
  return await new Promise<Readonly<{
    body: Buffer;
    headers: Headers;
    setCookie: readonly string[];
    status: number;
  }>>((resolveRequest, rejectRequest) => {
    let deadline: NodeJS.Timeout | undefined;
    let request: ReturnType<typeof httpRequest> | undefined;
    let responseStream: IncomingMessage | undefined;
    let settled = false;
    const clearDeadline = () => {
      if (deadline) clearTimeout(deadline);
      deadline = undefined;
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      responseStream?.destroy();
      request?.destroy();
      rejectRequest(error);
    };
    const resolveOnce = (result: Readonly<{
      body: Buffer;
      headers: Headers;
      setCookie: readonly string[];
      status: number;
    }>) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      resolveRequest(result);
    };
    request = httpRequest({
      agent: false,
      headers,
      host: "127.0.0.1",
      method: options.method ?? "GET",
      path,
      port,
    }, (response) => {
      responseStream = response;
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk) => {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maximumResponseBytes) {
          rejectOnce(new Error("M92 runtime response exceeded its byte limit"));
          return;
        }
        chunks.push(bytes);
      });
      response.once("aborted", () => {
        rejectOnce(new Error("M92 runtime response was aborted"));
      });
      response.once("error", rejectOnce);
      response.once("close", () => {
        if (!response.complete) {
          rejectOnce(new Error("M92 runtime response closed before completion"));
        }
      });
      response.once("end", () => {
        if (!response.complete) {
          rejectOnce(new Error("M92 runtime response ended before completion"));
          return;
        }
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, String(value));
          }
        }
        resolveOnce({
          body: Buffer.concat(chunks),
          headers: responseHeaders,
          setCookie: Object.freeze([...(response.headers["set-cookie"] ?? [])]),
          status: response.statusCode ?? 0,
        });
      });
    });
    deadline = setTimeout(() => {
      const error = new Error("M92 runtime request timed out") as Error & {
        code?: string;
      };
      error.code = "ETIMEDOUT";
      rejectOnce(error);
    }, 5_000);
    request.once("error", rejectOnce);
    request.end(requestBody);
  });
}

test("frozen v0.5.1 contract pins the old rollback and canvas-wire boundaries", async () => {
  const contract = await readContract();
  expect(contract).toEqual(expectedContract);
  const attestation = await readRunnerAttestation(contract);
  expect(attestation.exactTag).toEqual({
    annotatedTagObject: contract.annotatedTagObject,
    archiveSha256: contract.archiveSha256,
    commitTree: contract.commitTree,
    completeTreeVerified: true,
    files: contract.files,
    peeledCommit: contract.peeledCommit,
    tag: contract.tag,
    trackedEntries: contract.trackedEntries,
  });

  const exactTagLoadWire = {
    edges: [],
    graphRevision: 7,
    nodes: [{
      ...preservedRichNode,
      data: {
        ...preservedRichNode.data,
        rem009bUnknownEnvelope: {
          futureFlag: true,
          nested: ["preserve", 39, { wire: "unknown" }],
        },
      },
    }],
    revision: 7,
    viewport,
  };
  expect(isLoadedCanvasDocument(exactTagLoadWire)).toBe(
    contract.canvasSave.freshCurrentClientCanHydrateOldServer,
  );
  expect(isCanvasSaveSuccess(
    { graphRevision: 8, revision: 8 },
    { observedLoadToken: `v1.${"A".repeat(43)}`, revision: 7 },
  )).toBe(contract.canvasSave.currentClientAcceptsOldSuccess);
  expect(isCanvasSaveSuccess(
    { graphRevision: 8, loadToken: `v1.${"B".repeat(43)}`, revision: 8 },
    { observedLoadToken: `v1.${"A".repeat(43)}`, revision: 7 },
  )).toBe(true);
});

test("runner-attested exact tag precedes attested bridge, migration, and final runtimes", async () => {
  const contract = await readContract();
  expect(contract).toEqual(expectedContract);
  await readRunnerAttestation(contract);
  const releases = await readOperationalReleases(contract);
  const root = await mkdtemp(join(tmpdir(), "unboundry-m92-bridge-"));
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  let runtime: ChildProcess | undefined;
  try {
    const databasePath = await createExactSchema37Fixture(dataDirectory);
    const activeTaskFixture = new DatabaseSync(databasePath);
    activeTaskFixture.prepare(
      "UPDATE generation_tasks SET state = 'queued' WHERE id = ?",
    ).run(taskId);
    activeTaskFixture.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
    activeTaskFixture.close();
    const beforeActiveTaskRefusal = await directoryFingerprint(dataDirectory);
    const attemptsBeforeActiveTaskRefusal = new DatabaseSync(databasePath, {
      readOnly: true,
    });
    const activeTaskAttemptCount = attemptsBeforeActiveTaskRefusal.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts",
    ).get();
    attemptsBeforeActiveTaskRefusal.close();
    await expect(startReleaseRuntime(
      releases.bridge,
      dataDirectory,
      runtimeDirectory,
      root,
    )).rejects.toThrow(/LEGACY_RUNTIME_ACTIVE_TASKS_PRESENT/);
    expect(await directoryFingerprint(dataDirectory)).toEqual(
      beforeActiveTaskRefusal,
    );
    const attemptsAfterActiveTaskRefusal = new DatabaseSync(databasePath, {
      readOnly: true,
    });
    expect(attemptsAfterActiveTaskRefusal.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts",
    ).get()).toEqual(activeTaskAttemptCount);
    attemptsAfterActiveTaskRefusal.close();
    const resetActiveTaskFixture = new DatabaseSync(databasePath);
    resetActiveTaskFixture.prepare(
      "UPDATE generation_tasks SET state = 'success' WHERE id = ?",
    ).run(taskId);
    resetActiveTaskFixture.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;",
    );
    resetActiveTaskFixture.close();
    const preBridgeSourceSha = logicalSha(databasePath, root);
    const preBackfillInvariants = invariantTableSnapshot(databasePath);
    const preBackfillDatabase = new DatabaseSync(databasePath, {
      readOnly: true,
    });
    const preBackfillRow = preBackfillDatabase.prepare(
      "SELECT * FROM media_assets WHERE kind = 'image' AND id = ?",
    ).get(backfillMediaId) as Record<string, unknown>;
    const preExistingMediaRow = preBackfillDatabase.prepare(
      "SELECT * FROM media_assets WHERE kind = 'image' AND id = ?",
    ).get(mediaId);
    preBackfillDatabase.close();
    const preBackfillMediaBytes = await Promise.all([
      readFile(join(dataDirectory, "media", `${mediaId}.png`)),
      readFile(join(dataDirectory, "media", `${backfillMediaId}.png`)),
    ]);
    const beforeStandby = await directoryFingerprint(dataDirectory);

    // The final release still fail-closes on schema 37; only the independently
    // identified bridge release may supervise the exact legacy engine.
    runtime = await startReleaseRuntime(
      releases.final,
      dataDirectory,
      runtimeDirectory,
      root,
    );
    expect((await jsonRequest("/api/health/live")).status).toBe(200);
    const standby = await jsonRequest("/api/health/ready");
    expect(standby).toMatchObject({
      body: {
        databaseProbe: "read-only",
        mode: contract.processTransition.schema37ReadyMode,
        mutationsAccepted:
          contract.processTransition.schema37MutationsAccepted,
        schemaVersion: 37,
        status: "ready",
      },
      status: contract.processTransition.schema37ReadyHttpStatus,
    });
    const version = await jsonRequest("/api/version");
    expect(version.status).toBe(200);
    expect(version.body.version).toBe(releases.final.version);
    expect(await jsonRequest("/api/version", {
      body: "{}",
      method: "POST",
    })).toMatchObject({
      body: { code: "SERVICE_SCHEMA_STANDBY" },
      status: 503,
    });
    expect(await jsonRequest(`/api/canvas/${canvasId}`)).toMatchObject({
      body: { code: "SERVICE_SCHEMA_STANDBY" },
      status: 503,
    });
    await stopReleaseRuntime(runtime);
    expect(runtime.exitCode).toBe(0);
    runtime = undefined;
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeStandby);
    expect(logicalSha(databasePath, root)).toBe(preBridgeSourceSha);

    runtime = await startReleaseRuntime(
      releases.bridge,
      dataDirectory,
      runtimeDirectory,
      root,
    );
    const postBackfill = new DatabaseSync(databasePath, { readOnly: true });
    const postBackfillRow = postBackfill.prepare(`
      SELECT checksum_sha256, duration_seconds, duration_source,
             duration_status, updated_at
      FROM media_assets WHERE kind = 'image' AND id = ?
    `).get(backfillMediaId);
    expect(postBackfillRow).toEqual({
      checksum_sha256: sha256(mediaBytes),
      duration_seconds: null,
      duration_source: null,
      duration_status: "not-applicable",
      updated_at: expect.any(String),
    });
    const postBackfillFullRow = postBackfill.prepare(
      "SELECT * FROM media_assets WHERE kind = 'image' AND id = ?",
    ).get(backfillMediaId) as Record<string, unknown>;
    const {
      checksum_sha256: _preChecksum,
      updated_at: _preUpdatedAt,
      ...preBackfillStableFields
    } = preBackfillRow;
    const {
      checksum_sha256: _postChecksum,
      updated_at: _postUpdatedAt,
      ...postBackfillStableFields
    } = postBackfillFullRow;
    expect(postBackfillStableFields).toEqual(preBackfillStableFields);
    expect(postBackfill.prepare(
      "SELECT * FROM media_assets WHERE kind = 'image' AND id = ?",
    ).get(mediaId)).toEqual(preExistingMediaRow);
    expect(postBackfill.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts",
    ).get()).toEqual(activeTaskAttemptCount);
    postBackfill.close();
    expect(invariantTableSnapshot(databasePath)).toEqual(preBackfillInvariants);
    expect(await Promise.all([
      readFile(join(dataDirectory, "media", `${mediaId}.png`)),
      readFile(join(dataDirectory, "media", `${backfillMediaId}.png`)),
    ])).toEqual(preBackfillMediaBytes);
    const expectedSourceSha = logicalSha(databasePath, root);
    expect(expectedSourceSha).not.toBe(preBridgeSourceSha);
    const bridgeReady = await jsonRequest("/api/health/ready");
    expect(bridgeReady).toMatchObject({
      body: {
        databaseProbe: "read-only",
        mode: "schema37-bridge-active",
        mutationsAccepted: true,
        schemaVersion: 37,
        status: "ready",
      },
      status: 200,
    });
    expect(await jsonRequest("/api/version")).toMatchObject({
      body: { version: releases.bridge.version },
      status: 200,
    });
    const legacyStaticPath = releases.bridge.manifest.runtime.health
      .legacySchema37StaticAsset?.path;
    expect(legacyStaticPath).toBe("legacy-runtime/dist/client/index.html");
    const legacyIndex = await readFile(
      join(releases.bridge.directory, legacyStaticPath!),
      "utf8",
    );
    const proxiedIndex = await runtimeRequest("/", {
      headers: admittedRuntimeHeaders,
      maxResponseBytes: 1024 * 1024,
    });
    const proxiedIndexBody = proxiedIndex.body.toString("utf8");
    expect(proxiedIndex.status, proxiedIndexBody).toBe(200);
    expect(proxiedIndexBody).toBe(legacyIndex);
    for (const headers of [
      {
        ...admittedRuntimeHeaders,
        Host: `127.0.0.1:${port}`,
      },
      {
        ...admittedRuntimeHeaders,
        "X-Forwarded-For": "127.0.0.1, 127.0.0.2",
      },
      {
        Host: admittedRuntimeHeaders.Host,
        "X-Forwarded-For": admittedRuntimeHeaders["X-Forwarded-For"],
      },
    ]) {
      const rejected = await runtimeRequest("/", {
        headers,
        maxResponseBytes: 64 * 1_024,
      });
      expect(rejected.status).toBe(400);
      expect(JSON.parse(rejected.body.toString("utf8"))).toMatchObject({
        code: "BRIDGE_PROXY_HEADERS_INVALID",
      });
    }
    expect((await runtimeRequest("/", {
      headers: admittedRuntimeHeaders,
      maxResponseBytes: 1024 * 1024,
    })).status).toBe(200);
    expect(logicalSha(databasePath, root)).toBe(expectedSourceSha);
    const preservedCookie = `unboundry_session=${legacySessionToken}`;
    expect(await jsonRequest("/api/auth/status", {
      cookie: preservedCookie,
    })).toMatchObject({
      body: { authenticated: true, user: { id: ownerId } },
      status: 200,
    });
    expect(await jsonRequest(`/api/canvas/${canvasId}`, {
      cookie: preservedCookie,
    })).toMatchObject({
      body: { nodes: [preservedRichNode], revision: 7 },
      status: 200,
    });
    const oldWireNode = {
      ...preservedRichNode,
      data: { ...preservedRichNode.data, prompt: "m92 schema37 bridge write" },
    };
    const schema37Write = await jsonRequest(`/api/canvas/${canvasId}`, {
      body: JSON.stringify({
        edges: [],
        nodes: [oldWireNode],
        revision: 7,
        viewport,
      }),
      cookie: preservedCookie,
      method: "PUT",
    });
    expect(schema37Write).toMatchObject({
      body: { graphRevision: 8, revision: 8 },
      status: 200,
    });
    expect(await jsonRequest(`/api/canvas/${canvasId}`, {
      cookie: preservedCookie,
    })).toMatchObject({
      body: { nodes: [oldWireNode], revision: 8 },
      status: 200,
    });
    // Ordinary mutations reach the old engine, while paid generation and media
    // mutations are stopped by the parent without any Provider-side attempt.
    expect(await jsonRequest("/api/auth/login", {
      body: JSON.stringify({ loginName: "missing", password: "invalid" }),
      method: "POST",
    })).toMatchObject({ status: 401 });
    const attemptsBefore = new DatabaseSync(databasePath, { readOnly: true });
    const beforeAttemptCount = attemptsBefore.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts",
    ).get();
    attemptsBefore.close();
    expect(await jsonRequest("/api/auth/status", {
      cookie: preservedCookie,
      headers: { "X-Unboundry-Legacy-Proxy": "attacker" },
    })).toMatchObject({
      body: { authenticated: true },
      status: 200,
    });
    expect(await jsonRequest("/api/generation-tasks", {
      body: "{}",
      cookie: preservedCookie,
      method: "POST",
    })).toMatchObject({
      body: { code: "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED" },
      status: 503,
    });
    for (const path of [
      "/API/generation-tasks",
      "/api/generation-tasks.json",
    ]) {
      expect(await jsonRequest(path, { cookie: preservedCookie })).toMatchObject({
        body: { code: "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED" },
        status: 503,
      });
    }
    expect(await jsonRequest(`/api/assets/${mediaId}`, {
      cookie: preservedCookie,
      method: "DELETE",
    })).toMatchObject({
      body: { code: "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED" },
      status: 503,
    });
    expect(await jsonRequest("/api/playlist/export", {
      body: JSON.stringify({ mode: "asset" }),
      cookie: preservedCookie,
      method: "POST",
    })).toMatchObject({
      body: { code: "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED" },
      status: 503,
    });
    expect(await jsonRequest("/api/playlist/thumbnails/m92", {
      body: "{}",
      cookie: preservedCookie,
      method: "POST",
    })).toMatchObject({
      body: { code: "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED" },
      status: 503,
    });
    expect(await jsonRequest(`/api/admin/users/${ownerId}`, {
      cookie: preservedCookie,
      method: "DELETE",
    })).toMatchObject({
      body: { code: "BRIDGE_LEGACY_ACCOUNT_DELETION_DISABLED" },
      status: 503,
    });
    const attemptsAfter = new DatabaseSync(databasePath, { readOnly: true });
    expect(attemptsAfter.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts",
    ).get()).toEqual(beforeAttemptCount);
    attemptsAfter.close();
    await stopReleaseRuntime(runtime);
    expect(childExited(runtime)).toBe(true);
    expect(runtime.exitCode).toBe(0);
    runtime = undefined;
    const writtenSourceSha = logicalSha(databasePath, root);
    expect(writtenSourceSha).not.toBe(expectedSourceSha);
    // A second exact-old startup is an idempotence proof for the bounded
    // checksum backfill: it may open SQLite but changes no logical row or
    // Provider-attempt evidence after the first ready transition.
    const beforeIdempotentRestart = invariantTableSnapshot(databasePath);
    runtime = await startReleaseRuntime(
      releases.bridge,
      dataDirectory,
      runtimeDirectory,
      root,
    );
    expect(await jsonRequest("/api/health/ready")).toMatchObject({
      body: { mode: "schema37-bridge-active", schemaVersion: 37 },
      status: 200,
    });
    await stopReleaseRuntime(runtime);
    expect(runtime.exitCode).toBe(0);
    runtime = undefined;
    expect(logicalSha(databasePath, root)).toBe(writtenSourceSha);
    expect(invariantTableSnapshot(databasePath)).toEqual(
      beforeIdempotentRestart,
    );

    const migration = await runBridgeMigration(
      releases.bridge,
      dataDirectory,
      runtimeDirectory,
      root,
      writtenSourceSha,
    );
    expect(migration).toMatchObject({
      mode: "apply",
      sourceVersion: 37,
      status: "complete",
      targetVersion: 40,
    });

    runtime = await startReleaseRuntime(
      releases.final,
      dataDirectory,
      runtimeDirectory,
      root,
    );
    const active = await jsonRequest("/api/health/ready");
    expect(active).toMatchObject({
      body: {
        mode: "active",
        mutationsAccepted: true,
        schemaVersion: 40,
        status: "ready",
      },
      status: 200,
    });

    const preservedSession = await jsonRequest("/api/auth/status", {
      cookie: preservedCookie,
    });
    expect(preservedSession).toMatchObject({
      body: {
        authenticated: true,
        user: { id: ownerId, loginName: "m92-owner", role: "admin" },
      },
      status: 200,
    });
    const login = await jsonRequest("/api/auth/login", {
      body: JSON.stringify({
        loginName: "m92-owner",
        password: loginPassword,
      }),
      method: "POST",
    });
    expect(login.status).toBe(200);
    expect(login.setCookie).toHaveLength(1);
    expect(login.setCookie[0]).toMatch(
      /^unboundry_session=[^;\s]+; HttpOnly; Path=\/; SameSite=Strict; Max-Age=604800; Secure$/,
    );
    const currentCookie = login.setCookie[0]?.split(";", 1)[0];
    expect(currentCookie).toMatch(/^unboundry_session=/);

    const initialCanvas = await jsonRequest(`/api/canvas/${canvasId}`, {
      cookie: currentCookie,
      headers: { "X-Unboundry-Canvas-Save-Session": "m92-current-session" },
    });
    expect(initialCanvas).toMatchObject({
      body: {
        graphRevision: 8,
        nodes: [oldWireNode],
        revision: 8,
      },
      status: 200,
    });
    const initialRevision = Number(initialCanvas.body.revision);
    const initialLoadToken = String(initialCanvas.body.loadToken);

    const legacyWireSave = await jsonRequest(`/api/canvas/${canvasId}`, {
      body: JSON.stringify({
        edges: [],
        nodes: [{ id: "m92-v051-wire-must-not-write" }],
        revision: initialRevision,
        saveSequence: 8,
        saveSessionId: "m92-v051-session",
        viewport,
      }),
      cookie: currentCookie,
      method: "PUT",
    });
    expect(legacyWireSave).toMatchObject({
      body: { code: contract.canvasSave.currentBridgeExistingCanvasRejectCode },
      status: 409,
    });
    const afterLegacyWire = await jsonRequest(`/api/canvas/${canvasId}`, {
      cookie: currentCookie,
    });
    expect(afterLegacyWire.body).toMatchObject({
      nodes: [oldWireNode],
      revision: initialRevision,
    });

    const currentWireSave = await jsonRequest(`/api/canvas/${canvasId}`, {
      body: JSON.stringify({
        edges: [],
        nodes: [currentBridgeRichNode],
        observedLoadToken: initialLoadToken,
        observedRevision: initialRevision,
        revision: initialRevision,
        saveAttemptId: "m92-current-attempt",
        saveSequence: 1,
        saveSessionId: "m92-current-session",
        viewport,
      }),
      cookie: currentCookie,
      method: "PUT",
    });
    expect(currentWireSave).toMatchObject({
      body: { graphRevision: 9, revision: 9 },
      status: 200,
    });
    const afterCurrentWire = await jsonRequest(`/api/canvas/${canvasId}`, {
      cookie: currentCookie,
    });
    expect(afterCurrentWire).toMatchObject({
      body: { nodes: [currentBridgeRichNode], revision: 9 },
      status: 200,
    });

    const providers = await jsonRequest("/api/admin/providers", {
      cookie: currentCookie,
    });
    expect(providers).toMatchObject({
      body: {
        paidProviderRequests: 1,
        profiles: [{ id: providerId, label: "M92 preserved Provider" }],
      },
      status: 200,
    });
    const providerWrite = await jsonRequest(`/api/admin/providers/${providerId}`, {
      body: JSON.stringify({
        baseUrl: "https://openrouter.ai/api/v1",
        driver: "openrouter",
        label: "M92 current Provider",
      }),
      cookie: currentCookie,
      method: "PATCH",
    });
    expect(providerWrite).toMatchObject({
      body: { profile: { id: providerId, label: "M92 current Provider" } },
      status: 200,
    });

    const storage = await jsonRequest("/api/admin/storage", {
      cookie: currentCookie,
    });
    expect(storage).toMatchObject({
      body: { oss: { profiles: [{ id: storageId, label: "M92 preserved storage" }] } },
      status: 200,
    });
    const storageWrite = await jsonRequest(
      `/api/admin/storage/profiles/${storageId}`,
      {
        body: JSON.stringify({
          accessKeyId: "m92accesskey",
          accessKeySecret: "m92accesssecret",
          bucket: "m92-private-bucket",
          endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
          label: "M92 current storage",
          region: "oss-cn-hangzhou",
        }),
        cookie: currentCookie,
        method: "PATCH",
      },
    );
    expect(storageWrite).toMatchObject({
      body: { profile: { id: storageId, label: "M92 current storage" } },
      status: 200,
    });

    const credentials = await jsonRequest("/api/account-credentials", {
      cookie: currentCookie,
    });
    expect(credentials).toMatchObject({
      body: {
        items: [{
          apiKeyMask: "••••-key",
          credentialVersion: 1,
          profileId: providerId,
        }],
      },
      status: 200,
    });
    const credentialWrite = await jsonRequest(
      `/api/account-credentials/${providerId}`,
      {
        body: JSON.stringify({ apiKey: currentCredential }),
        cookie: currentCookie,
        method: "PUT",
      },
    );
    expect(credentialWrite).toMatchObject({
      body: { credentialVersion: 2, keyStatus: "unchecked", mask: "••••-key" },
      status: 200,
    });

    const tasks = await jsonRequest(
      `/api/generation-tasks?canvasId=${canvasId}`,
      { cookie: currentCookie },
    );
    expect(tasks).toMatchObject({
      body: {
        tasks: [{
          id: taskId,
          state: "success",
        }],
      },
      status: 200,
    });
    const media = await runtimeRequest(`/api/assets/${mediaId}`, {
      headers: { ...admittedRuntimeHeaders, Cookie: currentCookie! },
      maxResponseBytes: mediaBytes.length,
    });
    expect(media.status).toBe(200);
    expect(media.body).toEqual(mediaBytes);

    await stopReleaseRuntime(runtime);
    expect(runtime.exitCode).toBe(0);
    runtime = undefined;

    // Final persistence is inspected read-only after the admitted final
    // runtime exits; current-checkout business modules must not supplement the
    // release artifact under test.
    const finalDatabase = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(finalDatabase.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 40,
      });
      expect(finalDatabase.prepare(`
        SELECT version, name FROM schema_migrations
        ORDER BY version DESC LIMIT 1
      `).get()).toEqual({
        name: "seedance-trusted-asset-control-plane",
        version: 40,
      });
      expect(finalDatabase.prepare(`
      SELECT revision, graph_revision, nodes
        FROM canvas_documents WHERE owner_id = ? AND id = ?
      `).get(ownerId, canvasId)).toEqual({
        graph_revision: 9,
        nodes: JSON.stringify([currentBridgeRichNode]),
        revision: 9,
      });
      expect(finalDatabase.prepare(`
        SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?
      `).get(ownerId)).toEqual({ count: 2 });
      expect(finalDatabase.prepare(`
        SELECT provider_configuration_version
        FROM provider_profiles WHERE id = ?
      `).get(providerId)).toEqual({ provider_configuration_version: 2 });
      expect(finalDatabase.prepare(`
        SELECT credential_version
        FROM account_provider_credentials
        WHERE account_id = ? AND provider_profile_id = ?
      `).get(ownerId, providerId)).toEqual({ credential_version: 2 });
      expect(finalDatabase.prepare(`
        SELECT owner_id, credential_revision, outcome, provider_task_id
        FROM generation_provider_attempts
        WHERE task_id = ? AND execution_attempt = 1
      `).get(taskId)).toEqual({
        credential_revision: 1,
        outcome: "completed",
        owner_id: ownerId,
        provider_task_id: "m92-provider-task",
      });
      expect(finalDatabase.prepare(`
        SELECT checksum_sha256, storage_status FROM media_assets
        WHERE kind = 'image' AND id = ?
      `).get(mediaId)).toEqual({
        checksum_sha256: sha256(mediaBytes),
        storage_status: "ready",
      });
      expect(finalDatabase.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      finalDatabase.close();
    }
  } finally {
    if (runtime) await stopReleaseRuntime(runtime);
    await rm(root, { force: true, recursive: true });
  }
});
