import { spawn, type ChildProcess } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
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
  currentSchemaVersion,
  databaseMatchesMigrationManifest,
  databaseMatchesSchemaContract,
  openAppDatabase,
} from "../server/database";
import { createGenerationTaskStore } from "../server/generationTaskStore";
import {
  cleanupPublicationStaging,
  finalizeMediaPublication,
  mediaPublicationStagingPath,
  publishLocalMediaPublication,
  reserveMediaPublication,
  stageMediaPublication,
} from "../server/mediaLifecycle";
import { migrateSchema37To39 } from "../server/schemaMigration";
import {
  isCanvasSaveSuccess,
  isLoadedCanvasDocument,
} from "../client/src/canvas/CanvasSurface";
import { expect, test } from "./safe-test";

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
      latestMigration: Readonly<{ name: string; version: 39 }>;
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
      userVersion: 39;
      versionEndpointBeforeDatabaseOpen: true;
    }>;
  }>;
  runtimeRoot: string;
  source: Readonly<{ head: string; sha256: string }>;
}>;

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
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
          name: "atomic-generation-admission-and-credential-scope",
          version: 39,
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
        userVersion: 39,
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

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function stopBridge(child: ChildProcess) {
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

async function startBridge(dataDirectory: string) {
  const output: Buffer[] = [];
  const child = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_MAINTENANCE_MODE: "",
        UNBOUNDRY_TEST_AUTH_BYPASS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => output.push(Buffer.from(chunk)));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (childExited(child)) break;
    try {
      const ready = await fetch(`${origin}/api/health/ready`, {
        signal: AbortSignal.timeout(500),
      });
      if (ready.ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopBridge(child);
  throw new Error(
    `M92 bridge did not become ready\n${Buffer.concat(output).toString("utf8")}`,
  );
}

async function jsonRequest(
  path: string,
  options: RequestInit & { cookie?: string } = {},
) {
  const { cookie, headers, ...requestOptions } = options;
  const response = await fetch(`${origin}${path}`, {
    ...requestOptions,
    headers: {
      ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
  });
  const body = await response.text();
  return {
    body: body ? JSON.parse(body) as Record<string, unknown> : {},
    headers: response.headers,
    status: response.status,
  };
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

test("runner-attested exact tag precedes one current bridge stop, migration, and v39 restart", async () => {
  const contract = await readContract();
  expect(contract).toEqual(expectedContract);
  await readRunnerAttestation(contract);
  const root = await mkdtemp(join(tmpdir(), "unboundry-m92-bridge-"));
  const dataDirectory = join(root, "data");
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousMigrationClock =
    process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK;
  let bridge: ChildProcess | undefined;
  try {
    const databasePath = await createExactSchema37Fixture(dataDirectory);
    const expectedSourceSha = logicalSha(databasePath, root);
    const beforeStandby = await directoryFingerprint(dataDirectory);

    bridge = await startBridge(dataDirectory);
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
    expect(version.body.version).toBe("0.5.1");
    expect(await jsonRequest("/api/version", {
      body: "{}",
      method: "POST",
    })).toMatchObject({
      body: { code: "SERVICE_SCHEMA_STANDBY" },
      status: 503,
    });

    const businessPaths = [
      "/api/updates",
      "/api/auth/status",
      "/api/auth/login",
      "/api/account-context",
      "/api/account-credentials",
      "/api/models",
      "/api/admin/models",
      "/api/templates",
      "/api/admin/templates",
      "/api/agent-config",
      "/api/characters",
      "/api/library",
      "/api/admin/providers",
      "/api/admin/provider-catalog",
      "/api/admin/storage",
      "/api/admin/generation-safety",
      "/api/openapi.json",
      `/api/canvas/${canvasId}`,
      `/api/history/${ownerId}`,
      `/api/project-title/${canvasId}`,
      `/api/projects/${canvasId}`,
      `/api/assets/${mediaId}`,
      `/api/audio-assets/${mediaId}`,
      `/api/video-assets/${mediaId}`,
      `/api/media-metadata/image/${mediaId}`,
      `/api/generation-tasks?canvasId=${canvasId}`,
      "/api/playlist/export",
      "/api/playlist/thumbnails/m92",
    ];
    for (const path of businessPaths) {
      for (const method of ["GET", "POST"] as const) {
        const response = await jsonRequest(path, {
          body: method === "POST" ? "{}" : undefined,
          method,
        });
        expect(response.status, `${method} ${path}`).toBe(503);
        expect(response.body, `${method} ${path}`).toMatchObject({
          code: "SERVICE_SCHEMA_STANDBY",
        });
      }
    }
    await stopBridge(bridge);
    expect(childExited(bridge)).toBe(true);
    bridge = undefined;
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeStandby);
    expect(logicalSha(databasePath, root)).toBe(expectedSourceSha);

    process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK = "1";
    const migration = await migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSourceSha,
      mode: "apply",
      scratchRoot: root,
      testClock: { drainMilliseconds: 0, sleep: async () => undefined },
    });
    expect(migration).toMatchObject({
      mode: "apply",
      sourceVersion: 37,
      status: "complete",
      targetVersion: 39,
    });

    bridge = await startBridge(dataDirectory);
    const active = await jsonRequest("/api/health/ready");
    expect(active).toMatchObject({
      body: {
        mode: "active",
        mutationsAccepted: true,
        schemaVersion: currentSchemaVersion,
        status: "ready",
      },
      status: 200,
    });

    const preservedCookie = `unboundry_session=${legacySessionToken}`;
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
    const currentCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    expect(currentCookie).toMatch(/^unboundry_session=/);

    const initialCanvas = await jsonRequest(`/api/canvas/${canvasId}`, {
      cookie: currentCookie,
      headers: { "X-Unboundry-Canvas-Save-Session": "m92-current-session" },
    });
    expect(initialCanvas).toMatchObject({
      body: {
        graphRevision: 7,
        nodes: [preservedRichNode],
        revision: 7,
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
      nodes: [preservedRichNode],
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
      body: { graphRevision: 8, revision: 8 },
      status: 200,
    });
    const afterCurrentWire = await jsonRequest(`/api/canvas/${canvasId}`, {
      cookie: currentCookie,
    });
    expect(afterCurrentWire).toMatchObject({
      body: { nodes: [currentBridgeRichNode], revision: 8 },
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
        headers: { "X-Forwarded-Proto": "https" },
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
    const media = await fetch(`${origin}/api/assets/${mediaId}`, {
      headers: { Cookie: currentCookie! },
    });
    expect(media.status).toBe(200);
    expect(Buffer.from(await media.arrayBuffer())).toEqual(mediaBytes);

    await stopBridge(bridge);
    bridge = undefined;

    process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
    const taskStore = createGenerationTaskStore(dataDirectory);
    expect(taskStore.get(taskId)).toMatchObject({
      credentialRevision: 1,
      ownerId,
      providerTaskId: "m92-provider-task",
      state: "success",
    });
    const createdTask = taskStore.create({
      canvasId,
      idempotencyKey: "m92-current-local-task",
      kind: "text",
      nodeId: "m92-current-local-node",
      ownerId,
      prompt: "current bridge local task write",
    });
    expect(createdTask).toMatchObject({
      created: true,
      task: { ownerId, state: "queued" },
    });
    taskStore.close();

    const currentMediaBytes = Buffer.from("m92 current bridge media", "utf8");
    const publication = reserveMediaPublication({
      contentType: "image/png",
      finalStorageName: "m92-current-image.png",
      historyLabel: "M92 current image",
      id: "m92-current-image",
      kind: "image",
      objectKey: "m92-current-image.png",
      ownerId,
      storageBackend: "local",
    });
    await writeFile(mediaPublicationStagingPath(publication), currentMediaBytes, {
      mode: 0o600,
    });
    stageMediaPublication(publication, {
      byteSize: currentMediaBytes.length,
      checksumSha256: sha256(currentMediaBytes),
      contentType: "image/png",
      mediaHeight: 1,
      mediaWidth: 1,
    });
    await publishLocalMediaPublication(publication);
    finalizeMediaPublication(publication);
    await cleanupPublicationStaging(publication);

    const finalDatabase = openAppDatabase(dataDirectory);
    try {
      expect(databaseMatchesMigrationManifest(finalDatabase)).toBe(true);
      expect(databaseMatchesSchemaContract(finalDatabase)).toBe(true);
      expect(finalDatabase.prepare("PRAGMA user_version").get()).toEqual({
        user_version: 39,
      });
      expect(finalDatabase.prepare(`
        SELECT revision, graph_revision, nodes
        FROM canvas_documents WHERE owner_id = ? AND id = ?
      `).get(ownerId, canvasId)).toEqual({
        graph_revision: 8,
        nodes: JSON.stringify([currentBridgeRichNode]),
        revision: 8,
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
        SELECT state, owner_id FROM generation_tasks
        WHERE idempotency_key = 'm92-current-local-task'
      `).get()).toEqual({ owner_id: ownerId, state: "queued" });
      expect(finalDatabase.prepare(`
        SELECT checksum_sha256, storage_status FROM media_assets
        WHERE kind = 'image' AND id = 'm92-current-image'
      `).get()).toEqual({
        checksum_sha256: sha256(currentMediaBytes),
        storage_status: "ready",
      });
      expect(finalDatabase.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      finalDatabase.close();
    }
  } finally {
    if (bridge) await stopBridge(bridge);
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    if (previousMigrationClock === undefined) {
      delete process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK;
    } else {
      process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK = previousMigrationClock;
    }
    await rm(root, { force: true, recursive: true });
  }
});
