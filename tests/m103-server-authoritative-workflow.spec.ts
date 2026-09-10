import { DatabaseSync } from "node:sqlite";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "./safe-test";
import {
  applyPendingSchemaMigrationsInTransaction,
  currentSchemaVersion,
  databaseMatchesMigrationManifest,
  databaseMatchesSchema41Contract,
  databaseMatchesSchema42Contract,
  databaseMatchesSchema43Contract,
  databaseMatchesSchemaContract,
  openAppDatabase,
} from "../server/database";
import {
  compileFrozenWorkflowSemanticPlan,
} from "../types/workflowSemanticPlan";
import {
  sha256Hex,
  stableSha256,
  stableValueFingerprint,
} from "../types/canvasFingerprint";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";
import {
  workflowLockedGraphChanged,
  workflowProjectedResultRegressed,
} from "../server/canvasPersistence";
import { projectWorkflowResultInTransaction } from
  "../server/canvasWorkflowProjection";
import { setGenerationProjectionReceiptFaultForTests } from
  "../server/canvasMutationGateway";
import { buildCanvasProjectionIdentity } from
  "../server/generationCanvasProjection";
import {
  createGenerationTaskStore,
  GenerationTaskWorkflowLockedError,
  type GenerationTaskInput,
} from "../server/generationTaskStore";
import {
  estimateWorkflowMediaCapacityBytes,
  reserveWorkflowMediaCapacityInTransaction,
} from "../server/mediaCapacityReservations";
import { inspectLockedBackupDatabase } from "../server/backupInspection";
import { createRuntimeRoleCoordinator } from "../server/runtimeRole";
import { migrateSchema41To42 } from "../server/schema41To42Migration";
import { migrateSchema42To43 } from "../server/schema42To43Migration";
import { migrateSchema43To44 } from "../server/schema43To44Migration";
import {
  workflowRecoveryPolicy,
  type ModelExecutionAdapterId,
} from "../server/modelExecutionRegistry";
import {
  assertGenerationMediaDeletionAllowedInTransaction,
  hasUnresolvedPaidBoundaryInTransaction,
  hasUnresolvedGenerationOutcomeForNodeInTransaction,
} from
  "../server/generationAttemptQueries";
import {
  deleteAccountGenerationDataCommand,
  deleteProjectGenerationDataCommand,
} from "../server/generationTransactionCommands";
import { executeTransactionScopedCommand } from "../server/transactionCommand";
import {
  deleteWorkflowRunsForCanvasInTransaction,
  deleteWorkflowRunsForOwnerInTransaction,
  hasActiveWorkflowRunForCanvas,
  workflowRunAdmissionAuthorityInTransaction,
} from "../server/workflowRunLocks";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { inspectModelReleaseDocument } from
  "../server/modelReleaseRevisionStore";
import {
  knownModelParameterSchema,
  submissionParameterValues,
} from "../types/modelParameters";
import { resolveNodeInputs } from "../types/nodeInputs";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import type { ProviderProtocol } from "../types/relayProtocols";
import {
  resetCanvasObservabilityForTests,
  snapshotCanvasObservabilityForTests,
} from "../server/canvasObservability";

const executeFile = promisify(execFile);

async function stoppedProcessProofForSchemaMigrationTest() {
  const child = spawn(process.execPath, [
    "-e",
    "setInterval(() => {}, 1000)",
  ], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid || pid <= 1) throw new Error("schema migration proof child did not start");
  let startTicks = "1";
  let pidNamespace = `${process.platform}:host`;
  if (process.platform === "linux") {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    startTicks = fields[19] ?? startTicks;
    pidNamespace = readlinkSync("/proc/self/ns/pid");
  }
  child.kill("SIGKILL");
  await new Promise<void>((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
  return Object.freeze({ pid, pidNamespace, startTicks });
}

function workflowReleaseFixture(input: {
  index: number;
  kind: "audio" | "image" | "text" | "video";
  modelId: string;
  providerDriver: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
}): ModelReleaseRevision {
  const capabilitySchema = knownModelParameterSchema({
    capability: input.kind,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
  });
  const document = defaultModelReleaseDocument({
    capability: input.kind,
    capabilitySchema,
    modelId: input.modelId,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
    providerProfileId: input.providerProfileId,
    providerProtocol: input.providerProtocol,
  });
  const proof = inspectModelReleaseDocument(document);
  return Object.freeze({
    createdAt: "2026-09-01T00:00:00.000Z",
    document,
    hash: proof.documentHash,
    modelId: input.modelId,
    revisionId: `00000000-0000-4000-8000-${String(input.index).padStart(12, "0")}`,
    revisionNumber: 1,
    validation: Object.freeze({
      compilerHash: proof.compilerHash,
      impact: Object.freeze({
        incompatibleTemplateIds: Object.freeze([]),
        templateIds: Object.freeze([]),
      }),
      paidProviderRequests: 0,
      preview: Object.freeze({ modes: Object.freeze([]) }),
      validatedAt: "2026-09-01T00:00:00.000Z",
    }),
  });
}

function migrateMemory(targetVersion = currentSchemaVersion) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    BEGIN IMMEDIATE;
  `);
  applyPendingSchemaMigrationsInTransaction(database, {
    sourceVersion: 0,
    targetVersion,
  });
  database.exec("COMMIT");
  return database;
}

function workflowGraph(overrides: Record<string, unknown> = {}) {
  return {
    edges: [
      { id: "e1", source: "source", target: "copy", data: { inputOrder: 1 } },
      { id: "e2", source: "copy", target: "image", data: { inputOrder: 1 } },
    ],
    groupId: "group-1",
    nodes: [
      {
        id: "group-1",
        type: "group",
      },
      {
        data: { content: "authoritative source", runtimeStatus: "ignored" },
        id: "source",
        type: "text",
      },
      {
        data: {
          content: "old output",
          textModelId: "text-model",
          textPrompt: "write copy",
          textPromptReady: true,
          ...overrides,
        },
        id: "copy",
        parentId: "group-1",
        type: "text",
      },
      {
        data: {
          imageModelId: "image-model",
          imageParameters: { size: "1024x1024" },
          imagePrompt: "make image",
          imagePromptReady: true,
        },
        id: "image",
        parentId: "group-1",
        type: "image",
      },
    ],
  };
}

test("INC-GEN-025 semantic plan freezes DAG inputs and excludes runtime outputs", () => {
  const baseline = compileFrozenWorkflowSemanticPlan(workflowGraph());
  const runtimeOnly = compileFrozenWorkflowSemanticPlan(workflowGraph({
    content: "different generated output",
    textGenerating: true,
    textGenerationTaskId: "task-runtime-only",
  }));
  const semanticChange = compileFrozenWorkflowSemanticPlan(workflowGraph({
    textPrompt: "write different copy",
  }));

  expect(baseline.executableNodeIds).toEqual(["copy", "image"]);
  expect(baseline.nodes[1]?.dependencies).toEqual(["copy"]);
  expect(baseline.externalNodes).toEqual([{
    content: "authoritative source",
    id: "source",
    kind: "text",
  }]);
  expect(runtimeOnly.semanticFingerprint).toBe(baseline.semanticFingerprint);
  expect(semanticChange.semanticFingerprint).not.toBe(baseline.semanticFingerprint);
});

test("INC-GEN-025 semantic compiler rejects cyclic executable DAGs", () => {
  const graph = workflowGraph();
  graph.edges.push({
    data: { inputOrder: 2 },
    id: "cycle",
    source: "image",
    target: "copy",
  });
  expect(() => compileFrozenWorkflowSemanticPlan(graph)).toThrow("循环依赖");
});

test("schema 44 is exact and a schema 42 database is refused without mutation", () => {
  const current = migrateMemory();
  expect(currentSchemaVersion).toBe(44);
  expect(databaseMatchesMigrationManifest(current)).toBe(true);
  expect(databaseMatchesSchemaContract(current)).toBe(true);
  current.close();

  const directory = mkdtempSync(join(tmpdir(), "unboundry-schema42-refusal-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "unboundry.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    BEGIN IMMEDIATE;
  `);
  applyPendingSchemaMigrationsInTransaction(legacy, {
    sourceVersion: 0,
    targetVersion: 42,
  });
  legacy.exec("COMMIT");
  expect(databaseMatchesSchema42Contract(legacy)).toBe(true);
  legacy.close();
  chmodSync(path, 0o600);
  expect(() => openAppDatabase(directory)).toThrow();
  const after = new DatabaseSync(path, { readOnly: true });
  expect((after.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
    .toBe(42);
  after.close();
  rmSync(directory, { force: true, recursive: true });
});

test("schema 41 dry-run and apply migrate only the v42 workflow boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "unboundry-schema41-to42-"));
  chmodSync(root, 0o700);
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  const inspectionRoot = join(root, "inspection");
  mkdirSync(dataDirectory, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  mkdirSync(inspectionRoot, { mode: 0o700 });
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  try {
    const source = new DatabaseSync(databasePath);
    source.exec(
      "PRAGMA foreign_keys = ON;" +
        "CREATE TABLE schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    );" +
        "BEGIN IMMEDIATE;",
    );
    applyPendingSchemaMigrationsInTransaction(source, {
      sourceVersion: 0,
      targetVersion: 41,
    });
    source.exec("COMMIT; PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE");
    const sourceSha = inspectLockedBackupDatabase(source, inspectionRoot)
      .logicalSha256;
    source.exec("ROLLBACK");
    source.close();
    chmodSync(databasePath, 0o600);

    const dryRun = await migrateSchema41To42({
      dataDirectory,
      expectedSourceLogicalSha256: sourceSha,
      mode: "dry-run",
      runtimeDirectory,
      scratchRoot: root,
    });
    expect(dryRun).toMatchObject({
      sourceVersion: 41,
      status: "verified",
      targetVersion: 42,
    });
    const unchanged = new DatabaseSync(databasePath, { readOnly: true });
    expect(databaseMatchesSchema41Contract(unchanged)).toBe(true);
    unchanged.close();

    const cli = await executeFile(process.execPath, [
      join(process.cwd(), "scripts/migrate-schema41-to42.mjs"),
      "--dry-run",
      "--data-dir",
      dataDirectory,
      "--runtime-dir",
      runtimeDirectory,
      "--scratch-root",
      root,
      "--expected-logical-sha256",
      sourceSha,
    ], { cwd: process.cwd(), env: process.env });
    expect(JSON.parse(cli.stdout)).toMatchObject({
      ok: true,
      sourceVersion: 41,
      targetVersion: 42,
    });

    const applied = await migrateSchema41To42({
      dataDirectory,
      expectedSourceLogicalSha256: sourceSha,
      mode: "apply",
      runtimeDirectory,
      scratchRoot: root,
    });
    expect(applied).toMatchObject({
      sourceVersion: 41,
      status: "complete",
      targetVersion: 42,
    });
    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    expect(databaseMatchesMigrationManifest(migrated, 42)).toBe(true);
    expect(databaseMatchesSchema42Contract(migrated)).toBe(true);
    migrated.close();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("schema 42 dry-run and apply migrate exactly to durable receipt schema 43", async () => {
  const root = mkdtempSync(join(tmpdir(), "unboundry-schema42-to43-"));
  chmodSync(root, 0o700);
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  const inspectionRoot = join(root, "inspection");
  mkdirSync(dataDirectory, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  mkdirSync(inspectionRoot, { mode: 0o700 });
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  try {
    const source = new DatabaseSync(databasePath);
    source.exec(
      "PRAGMA foreign_keys = ON;" +
        "CREATE TABLE schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    );" +
        "BEGIN IMMEDIATE;",
    );
    applyPendingSchemaMigrationsInTransaction(source, {
      sourceVersion: 0,
      targetVersion: 42,
    });
    source.exec("COMMIT; PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE");
    const sourceSha = inspectLockedBackupDatabase(source, inspectionRoot)
      .logicalSha256;
    source.exec("ROLLBACK");
    source.close();
    chmodSync(databasePath, 0o600);

    const dryRun = await migrateSchema42To43({
      dataDirectory,
      expectedSourceLogicalSha256: sourceSha,
      mode: "dry-run",
      runtimeDirectory,
      scratchRoot: root,
    });
    expect(dryRun).toMatchObject({
      sourceVersion: 42,
      status: "verified",
      targetVersion: 43,
    });
    const unchanged = new DatabaseSync(databasePath, { readOnly: true });
    expect(databaseMatchesMigrationManifest(unchanged, 42)).toBe(true);
    expect(databaseMatchesSchema42Contract(unchanged)).toBe(true);
    unchanged.close();

    const cli = await executeFile(process.execPath, [
      join(process.cwd(), "scripts/migrate-schema42-to43.mjs"),
      "--dry-run",
      "--data-dir",
      dataDirectory,
      "--runtime-dir",
      runtimeDirectory,
      "--scratch-root",
      root,
      "--expected-logical-sha256",
      sourceSha,
    ], { cwd: process.cwd(), env: process.env });
    expect(JSON.parse(cli.stdout)).toMatchObject({
      ok: true,
      sourceVersion: 42,
      targetVersion: 43,
    });

    const applied = await migrateSchema42To43({
      dataDirectory,
      expectedSourceLogicalSha256: sourceSha,
      mode: "apply",
      runtimeDirectory,
      scratchRoot: root,
    });
    expect(applied).toMatchObject({
      sourceVersion: 42,
      status: "complete",
      targetVersion: 43,
    });
    const migrated = new DatabaseSync(databasePath);
    migrated.exec("PRAGMA foreign_keys = ON");
    expect(databaseMatchesMigrationManifest(migrated, 43)).toBe(true);
    expect(databaseMatchesSchema43Contract(migrated)).toBe(true);
    const timestamp = new Date().toISOString();
    migrated.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('receipt-owner', 'receipt-owner', 'Owner', 'test', 'user',
        'active', ?, ?)
    `).run(timestamp, timestamp);
    migrated.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES ('receipt-owner', 'receipt-canvas', 0, 0, '[]', '[]', '{}',
        ?, NULL, 0)
    `).run(timestamp);
    expect(() => migrated.prepare(`
      INSERT INTO canvas_operation_receipts (
        owner_id, canvas_id, operation_id, payload_sha256, command_type,
        actor_type, save_session_id, save_sequence, baseline_kind,
        base_document_revision, base_input_revision,
        baseline_load_token_sha256, baseline_epoch, outcome, conflict_code,
        http_status, original_request_id, result_document_revision,
        result_input_revision, result_document_sha256, result_input_sha256,
        affected_subgraph_sha256, changed_paths, created_at, settled_at
      ) VALUES (
        'receipt-owner', 'receipt-canvas', 'receipt-operation',
        ?, 'canvas.create', 'browser', 'session-01', 1, 'create',
        NULL, NULL, NULL, NULL, 'APPLIED', NULL, 200, 'request-01',
        0, 0, ?, ?, NULL, '[]', ?, ?
      )
    `).run("a".repeat(64), "b".repeat(64), "c".repeat(64), timestamp, timestamp))
      .not.toThrow();
    expect(() => migrated.prepare(`
      UPDATE canvas_operation_receipts SET http_status = 409
      WHERE owner_id = 'receipt-owner' AND canvas_id = 'receipt-canvas'
    `).run()).toThrow();
    migrated.prepare(`
      DELETE FROM canvas_documents
      WHERE owner_id = 'receipt-owner' AND id = 'receipt-canvas'
    `).run();
    expect(migrated.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_receipts
    `).get()).toEqual({ count: 0 });
    migrated.close();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("schema 43 to 44 preserves the frozen source and admits durable output slots", async () => {
  const root = mkdtempSync(join(tmpdir(), "unboundry-schema43-to44-"));
  chmodSync(root, 0o700);
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  const inspectionRoot = join(root, "inspection");
  mkdirSync(dataDirectory, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  mkdirSync(inspectionRoot, { mode: 0o700 });
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  try {
    const source = new DatabaseSync(databasePath);
    source.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
      BEGIN IMMEDIATE;
    `);
    applyPendingSchemaMigrationsInTransaction(source, {
      sourceVersion: 0,
      targetVersion: 43,
    });
    source.exec("COMMIT; PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE");
    const sourceInspection = inspectLockedBackupDatabase(source, inspectionRoot);
    expect(databaseMatchesSchema43Contract(source)).toBe(true);
    expect(sourceInspection.userVersion).toBe(43);
    source.exec("ROLLBACK");
    source.close();
    chmodSync(databasePath, 0o600);

    const dryRun = await migrateSchema43To44({
      dataDirectory,
      expectedSourceLogicalSha256: sourceInspection.logicalSha256,
      mode: "dry-run",
      runtimeDirectory,
      scratchRoot: root,
    });
    expect(dryRun).toMatchObject({
      mode: "dry-run",
      sourceVersion: 43,
      status: "verified",
      targetVersion: 44,
    });
    const unchanged = new DatabaseSync(databasePath, { readOnly: true });
    expect(databaseMatchesMigrationManifest(unchanged, 43)).toBe(true);
    expect(databaseMatchesSchema43Contract(unchanged)).toBe(true);
    expect(unchanged.prepare("PRAGMA user_version").get()).toEqual({ user_version: 43 });
    unchanged.close();

    const cli = await executeFile(process.execPath, [
      join(process.cwd(), "scripts/migrate-schema43-to44.mjs"),
      "--dry-run",
      "--data-dir",
      dataDirectory,
      "--runtime-dir",
      runtimeDirectory,
      "--scratch-root",
      root,
      "--expected-logical-sha256",
      sourceInspection.logicalSha256,
    ], { cwd: process.cwd(), env: process.env });
    expect(JSON.parse(cli.stdout)).toMatchObject({
      ok: true,
      sourceVersion: 43,
      targetVersion: 44,
    });

    const applied = await migrateSchema43To44({
      dataDirectory,
      expectedSourceLogicalSha256: sourceInspection.logicalSha256,
      mode: "apply",
      runtimeDirectory,
      scratchRoot: root,
    });
    expect(applied).toMatchObject({
      mode: "apply",
      sourceVersion: 43,
      status: "complete",
      targetVersion: 44,
    });
    const migrated = new DatabaseSync(databasePath);
    migrated.exec("PRAGMA foreign_keys = ON");
    expect(databaseMatchesMigrationManifest(migrated, 44)).toBe(true);
    expect(databaseMatchesSchemaContract(migrated)).toBe(true);
    expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const timestamp = new Date().toISOString();
    migrated.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('schema44-owner', 'schema44-owner', 'Owner', 'test', 'user',
        'active', ?, ?)
    `).run(timestamp, timestamp);
    migrated.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
        request_fingerprint, state, attempt, error_code, error_message,
        created_at, updated_at, owner_id, cost_currency, model_configuration
      ) VALUES (
        'schema44-task', 'schema44-canvas', 'schema44-node', 'image', 'test', '{}',
        'schema44-idempotency', 'schema44-request', 'running', 1, NULL, NULL,
        ?, ?, 'schema44-owner', 'CNY', '{}'
      )
    `).run(timestamp, timestamp);
    migrated.prepare(`
      INSERT INTO generation_result_save_leases (
        task_id, execution_attempt, owner_id, kind, runtime_instance_id,
        fence_epoch, holder_token, phase, heartbeat_at, lease_until
      ) VALUES ('schema44-task', 1, 'schema44-owner', 'image', '1:00000000-0000-0000-0000-000000000000',
        1, '1234567890abcdef', 'saving', ?, ?)
    `).run(timestamp, timestamp);
    expect(() => migrated.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state, storage_backend,
        final_storage_name, object_key, staging_name, task_id,
        task_execution_attempt, content_type, created_at, updated_at
      ) VALUES (
        'schema44-pub-invalid', 'schema44-owner', 'image', 'schema44-asset',
        'generation', 'reserved', 'local', 'final', 'object', 'staging',
        'schema44-task', 1, 'image/png', ?, ?
      )
    `).run(timestamp, timestamp)).toThrow();
    migrated.close();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("schema 43 quiesced preservation takes over an existing lease without settling an unknown task", async () => {
  const root = mkdtempSync(join(tmpdir(), "unboundry-schema43-quiesced-to44-"));
  chmodSync(root, 0o700);
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  const inspectionRoot = join(root, "inspection");
  mkdirSync(dataDirectory, { mode: 0o700 });
  mkdirSync(runtimeDirectory, { mode: 0o700 });
  mkdirSync(inspectionRoot, { mode: 0o700 });
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const providerAt = "2026-01-01T00:00:00.000Z";
  const freezeAt = "2026-01-01T00:02:00.000Z";
  try {
    const source = new DatabaseSync(databasePath);
    source.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
      BEGIN IMMEDIATE;
    `);
    applyPendingSchemaMigrationsInTransaction(source, {
      sourceVersion: 0,
      targetVersion: 43,
    });
    source.exec("COMMIT; PRAGMA journal_mode = DELETE");
    source.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('quiesced-owner', 'quiesced-owner', 'Owner', 'test',
        'user', 'active', ?, ?)
    `).run(providerAt, providerAt);
    source.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        provider_profile_id, provider_model_id, cost_currency,
        model_configuration, credential_revision
      ) VALUES (
        'quiesced-task', 'quiesced-canvas', 'quiesced-node', 'video',
        'prompt', 'model', '{}', 'quiesced-idempotency',
        'quiesced-fingerprint', 'recovering', 1,
        'AUTOMATIC_RESULT_RECOVERY', 'preserve unknown outcome', ?, ?,
        'quiesced-owner', 'quiesced-profile', 'quiesced-provider',
        'CNY', '{}', 0)
    `).run(providerAt, providerAt);
    source.prepare(`
      INSERT INTO generation_task_events (
        task_id, state, error_code, error_message, created_at
      ) VALUES ('quiesced-task', 'recovering',
        'AUTOMATIC_RESULT_RECOVERY', 'preserve unknown outcome', ?)
    `).run(providerAt);
    source.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id, credential_revision, outcome,
        provider_task_id, failure_code, finished_at
      ) VALUES ('quiesced-task', 1, 'quiesced-profile', 'quiesced-provider',
        'video', 'provider-boundary', ?, 'quiesced-owner', 0,
        'outcome-unknown', NULL, 'OUTCOME_UNKNOWN_BILLING_RISK', NULL)
    `).run(providerAt);
    source.prepare(`
      INSERT INTO generation_admission_events (
        task_id, execution_attempt, owner_id, kind, admission_type, created_at
      ) VALUES ('quiesced-task', 1, 'quiesced-owner', 'video', 'initial', ?)
    `).run(providerAt);
    source.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        task_id, task_execution_attempt, content_type, created_at, updated_at
      ) VALUES ('quiesced-publication', 'quiesced-owner', 'video',
        'quiesced-asset', 'generation', 'reserved', 'local', 'final-name',
        'object-key', 'staging-name', 'quiesced-task', 1, 'video/mp4', ?, ?)
    `).run(providerAt, providerAt);
    source.prepare(`
      UPDATE generation_safety_settings
      SET global_enabled = 0, emergency_stop = 1, updated_at = ?
      WHERE id = 1
    `).run(freezeAt);
    source.prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, details, created_at
      ) VALUES ('quiesced-owner', 'generation_safety.update', ?, ?)
    `).run(JSON.stringify({
      after: {
        emergencyStop: true,
        globalEnabled: false,
        updatedAt: freezeAt,
      },
    }), freezeAt);
    source.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; BEGIN IMMEDIATE");
    const sourceInspection = inspectLockedBackupDatabase(source, inspectionRoot);
    expect(databaseMatchesSchema43Contract(source)).toBe(true);
    source.exec("ROLLBACK");
    source.close();
    chmodSync(databasePath, 0o600);

    const prepareExistingLease = async () => {
      const initial = createRuntimeRoleCoordinator({
        dataDirectory,
        role: "active",
        runtimeDirectory,
      });
      await expect(initial.beginDrain(1_000)).resolves.toMatchObject({
        activeExecutions: 0,
        drained: true,
      });
      initial.releaseAfterDrain();
    };
    const makeContract = async () => ({
      expectedDatabaseLogicalSha256: sourceInspection.logicalSha256,
      expectedSchemaVersion: 43 as const,
      freezeEvidence: {
        generationFrozenAt: freezeAt,
        lastProviderAdmissionAt: providerAt,
        sourceDatabaseLogicalSha256: sourceInspection.logicalSha256,
      },
      preservedTask: {
        executionAttempt: 1,
        taskId: "quiesced-task",
      },
      runtimeDirectory,
      stoppedProcess: await stoppedProcessProofForSchemaMigrationTest(),
    });

    await prepareExistingLease();
    const dryContract = await makeContract();
    const cli = await executeFile(process.execPath, [
      join(process.cwd(), "scripts/migrate-schema43-to44.mjs"),
      "--dry-run",
      "--quiesced-active-preservation",
      "--data-dir", dataDirectory,
      "--runtime-dir", runtimeDirectory,
      "--scratch-root", root,
      "--expected-logical-sha256", sourceInspection.logicalSha256,
      "--freeze-at", freezeAt,
      "--last-provider-admission-at", providerAt,
      "--preserved-task-id", "quiesced-task",
      "--preserved-task-attempt", "1",
      "--previous-pid", String(dryContract.stoppedProcess.pid),
      "--previous-pid-namespace", dryContract.stoppedProcess.pidNamespace,
      "--previous-pid-start-ticks", dryContract.stoppedProcess.startTicks,
    ], { cwd: process.cwd(), env: process.env });
    expect(JSON.parse(cli.stdout)).toMatchObject({
      ok: true,
      preservationMode: "quiesced-active-preservation",
      sourceVersion: 43,
      status: "verified",
      targetVersion: 44,
    });
    const unchanged = new DatabaseSync(databasePath, { readOnly: true });
    expect(databaseMatchesSchema43Contract(unchanged)).toBe(true);
    expect(unchanged.prepare(`
      SELECT state, error_code, attempt
      FROM generation_tasks WHERE id = 'quiesced-task'
    `).get()).toEqual({
      attempt: 1,
      error_code: "AUTOMATIC_RESULT_RECOVERY",
      state: "recovering",
    });
    unchanged.close();

    await prepareExistingLease();
    const applied = await migrateSchema43To44({
      dataDirectory,
      expectedSourceLogicalSha256: sourceInspection.logicalSha256,
      mode: "apply",
      runtimeDirectory,
      scratchRoot: root,
      quiescedSourceContract: await makeContract(),
    });
    expect(applied).toMatchObject({
      preservationMode: "quiesced-active-preservation",
      sourceVersion: 43,
      status: "complete",
      targetVersion: 44,
    });
    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    expect(databaseMatchesMigrationManifest(migrated, 44)).toBe(true);
    expect(databaseMatchesSchemaContract(migrated)).toBe(true);
    expect(migrated.prepare(`
      SELECT state, error_code, attempt, provider_task_id, result_asset_id
      FROM generation_tasks WHERE id = 'quiesced-task'
    `).get()).toEqual({
      attempt: 1,
      error_code: "AUTOMATIC_RESULT_RECOVERY",
      provider_task_id: null,
      result_asset_id: null,
      state: "recovering",
    });
    expect(migrated.prepare(`
      SELECT state, task_id, task_execution_attempt, output_slot,
        output_set_count
      FROM media_publication_attempts
      WHERE attempt_id = 'quiesced-publication'
    `).get()).toEqual({
      output_set_count: null,
      output_slot: null,
      state: "reserved",
      task_execution_attempt: 1,
      task_id: "quiesced-task",
    });
    migrated.close();
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("exact workflow graph locks permit unrelated edits and reject relevant changes", () => {
  const previousNodes = [
    { id: "locked", type: "text", data: { textPrompt: "frozen" } },
    { id: "free", type: "text", data: { textPrompt: "before" } },
  ];
  const previousEdges = [
    { id: "locked-edge", source: "locked", target: "free" },
  ];
  expect(workflowLockedGraphChanged({
    lockedNodeIds: ["locked"],
    nextEdges: previousEdges,
    nextNodes: [previousNodes[0], { ...previousNodes[1], position: { x: 10, y: 20 } }],
    previousEdges,
    previousNodes,
  })).toBe(false);
  expect(workflowLockedGraphChanged({
    lockedNodeIds: ["locked"],
    nextEdges: previousEdges,
    nextNodes: [{ id: "locked", type: "text", data: { textPrompt: "changed" } }, previousNodes[1]],
    previousEdges,
    previousNodes,
  })).toBe(true);
  expect(workflowLockedGraphChanged({
    lockedNodeIds: ["locked"],
    nextEdges: [],
    nextNodes: previousNodes,
    previousEdges,
    previousNodes,
  })).toBe(true);
  expect(workflowProjectedResultRegressed({
    currentNodes: [{
      data: { groupRunSuccessTaskId: "authoritative-task", content: "new" },
      id: "locked",
    }],
    incomingNodes: [{ data: { content: "stale" }, id: "locked" }],
  })).toBe(true);
  expect(workflowProjectedResultRegressed({
    currentNodes: [{
      data: { groupRunSuccessTaskId: "authoritative-task", content: "new" },
      id: "locked",
    }],
    incomingNodes: [{
      data: { groupRunSuccessTaskId: "authoritative-task", content: "edited" },
      id: "locked",
    }],
  })).toBe(false);
});

test("single-node admission is blocked by a run and incomplete run bindings fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-workflow-lock-"));
  chmodSync(directory, 0o700);
  const database = openAppDatabase(directory);
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, login_name, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 'test', 'user', 'active', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport, updated_at,
      save_session_id, save_sequence
    ) VALUES ('owner', 'canvas', 1, 1, '[]', '[]', '{}', ?, NULL, 0)
  `).run(timestamp);
  database.prepare(`
    INSERT INTO workflow_runs (
      id, owner_id, canvas_id, group_id, graph_revision, semantic_fingerprint,
      plan_json, state, stop_requested, created_at, updated_at
    ) VALUES ('run-owner', 'owner', 'canvas', 'group', 1, 'fingerprint',
      '{"version":1}', 'running', 0, ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO workflow_run_locks (owner_id, canvas_id, node_id, run_id, created_at)
    VALUES ('owner', 'canvas', 'node', 'run-owner', ?)
  `).run(timestamp);
  database.prepare(`
    INSERT INTO workflow_run_locks (owner_id, canvas_id, node_id, run_id, created_at)
    VALUES ('owner', 'canvas', 'unknown-node', 'run-owner', ?)
  `).run(timestamp);
  database.prepare(`
    INSERT INTO workflow_run_locks (owner_id, canvas_id, node_id, run_id, created_at)
    VALUES ('owner', 'other-canvas', 'wrong-canvas-node', 'run-owner', ?)
  `).run(timestamp);
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
      request_fingerprint, state, attempt, error_code, error_message,
      created_at, updated_at, owner_id, cost_currency, model_configuration
    ) VALUES (
      'old-unknown-task', 'canvas', 'unknown-node', 'text', 'test', '{}',
      'old-unknown-idempotency', 'old-workflow-run-fingerprint', 'failed', 0,
      'OUTCOME_UNKNOWN_BILLING_RISK', 'unknown', ?, ?, 'owner', 'CNY', '{}'
    )
  `).run(timestamp, timestamp);
  expect(hasActiveWorkflowRunForCanvas(database, "owner", "canvas")).toBe(true);
  expect(hasUnresolvedGenerationOutcomeForNodeInTransaction(database, {
    canvasId: "canvas",
    kind: "text",
    nodeId: "unknown-node",
    ownerId: "owner",
  })).toBe(true);
  database.exec("BEGIN IMMEDIATE");
  expect(workflowRunAdmissionAuthorityInTransaction({
    canvasId: "other-canvas",
    database,
    nodeId: "wrong-canvas-node",
    ownerId: "owner",
  })).toBeUndefined();
  database.exec("ROLLBACK");
  database.close();

  const store = createGenerationTaskStore(directory);
  const base: GenerationTaskInput = {
    canvasId: "canvas",
    idempotencyKey: "workflow-lock-test",
    kind: "text",
    modelConfiguration: {},
    nodeId: "node",
    ownerId: "owner",
    prompt: "test",
    providerModelId: "provider-model",
    providerProfileId: "provider-profile",
  };
  expect(() => store.admitOrGet(base)).toThrow(GenerationTaskWorkflowLockedError);
  expect(() => store.admitOrGet({
      ...base,
      idempotencyKey: "workflow-owning-run",
      modelConfiguration: { workflowBinding: { runId: "run-owner" } },
  })).toThrow(GenerationTaskWorkflowLockedError);
  expect(() => store.admitOrGet({
    ...base,
    idempotencyKey: "workflow-unknown-run",
    modelConfiguration: { workflowBinding: { runId: "run-owner" } },
    nodeId: "unknown-node",
  })).toThrow(GenerationTaskWorkflowLockedError);
  const stopped = openAppDatabase(directory);
  stopped.prepare(`
    UPDATE workflow_runs SET stop_requested = 1, state = 'stopping'
    WHERE id = 'run-owner'
  `).run();
  stopped.close();
  expect(() => store.admitOrGet({
    ...base,
    idempotencyKey: "workflow-stopped-run",
    modelConfiguration: { workflowBinding: { runId: "run-owner" } },
  })).toThrow(GenerationTaskWorkflowLockedError);
  const paidBoundary = store.create({
    ...base,
    canvasId: "paid-boundary-canvas",
    idempotencyKey: "paid-boundary-evidence",
    nodeId: "paid-boundary-node",
    ownerId: "__test__",
  }).task;
  const historicalBoundary = store.create({
    ...base,
    canvasId: "historical-boundary-canvas",
    idempotencyKey: "historical-boundary-evidence",
    nodeId: "historical-boundary-node",
    ownerId: "__test__",
  }).task;
  const finishedUnknown = store.create({
    ...base,
    canvasId: "finished-unknown-canvas",
    idempotencyKey: "finished-unknown-evidence",
    nodeId: "finished-unknown-node",
    ownerId: "__test__",
  }).task;
  for (const task of [paidBoundary, historicalBoundary, finishedUnknown]) {
    store.transition(task.id, "running");
    store.recordProviderAttempt(task.id);
  }
  const evidenceDatabase = openAppDatabase(directory);
  evidenceDatabase.prepare(`
    UPDATE generation_provider_attempts
    SET evidence = 'historical-execution-attempt'
    WHERE task_id = ?
  `).run(historicalBoundary.id);
  evidenceDatabase.prepare(`
    UPDATE generation_provider_attempts
    SET outcome = 'outcome-unknown', finished_at = ?
    WHERE task_id = ?
  `).run(timestamp, finishedUnknown.id);
  expect(hasUnresolvedPaidBoundaryInTransaction(
    evidenceDatabase,
    paidBoundary.id,
  )).toBe(true);
  expect(hasUnresolvedPaidBoundaryInTransaction(
    evidenceDatabase,
    historicalBoundary.id,
  )).toBe(false);
  expect(hasUnresolvedPaidBoundaryInTransaction(
    evidenceDatabase,
    finishedUnknown.id,
  )).toBe(true);
  evidenceDatabase.close();
  store.close();
  rmSync(directory, { force: true, recursive: true });
});

test("media capacity reservation is durable, bounded, and transaction-owned", () => {
  const database = migrateMemory();
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, login_name, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 'test', 'user', 'active', ?, ?)
  `).run(timestamp, timestamp);
  database.prepare(`
    INSERT INTO workflow_runs (
      id, owner_id, canvas_id, group_id, graph_revision, semantic_fingerprint,
      plan_json, state, stop_requested, created_at, updated_at
    ) VALUES ('run', 'owner', 'canvas', 'group', 1, 'fingerprint',
      '{"version":1,"externalNodes":[{"data":{"assetId":"input-image"},"id":"source","type":"image"}]}',
      'running', 0, ?, ?)
  `).run(timestamp, timestamp);
  expect(() => assertGenerationMediaDeletionAllowedInTransaction(database, {
    assetId: "input-image",
    kind: "image",
    ownerId: "owner",
  })).toThrow("Active workflow inputs cannot be deleted");
  const bytes = estimateWorkflowMediaCapacityBytes(["text", "image", "video"]);
  expect(bytes).toBeGreaterThan(1);
  expect(() => reserveWorkflowMediaCapacityInTransaction({
    bytes,
    database,
    ownerId: "owner",
    runId: "run",
  })).toThrow("existing transaction");
  database.exec("BEGIN IMMEDIATE");
  const reservationId = reserveWorkflowMediaCapacityInTransaction({
    bytes,
    database,
    ownerId: "owner",
    runId: "run",
  });
  database.exec("COMMIT");
  const row = database.prepare(`
    SELECT reserved_bytes, state FROM media_capacity_reservations WHERE id = ?
  `).get(reservationId) as { reserved_bytes: number; state: string };
  expect(row).toEqual({ reserved_bytes: bytes, state: "active" });
  database.prepare(`
    INSERT INTO workflow_runs (
      id, owner_id, canvas_id, group_id, graph_revision, semantic_fingerprint,
      plan_json, state, stop_requested, created_at, updated_at
    ) VALUES ('run-2', 'owner', 'canvas-2', 'group-2', 1, 'fingerprint-2',
      '{"version":1}', 'running', 0, ?, ?)
  `).run(timestamp, timestamp);
  database.exec("BEGIN IMMEDIATE");
  expect(() => reserveWorkflowMediaCapacityInTransaction({
    bytes,
    database,
    inspectedAvailableBytes: bytes + 1024 * 1024 * 1024,
    ownerId: "owner",
    runId: "run-2",
  })).toThrow("正在被其他任务占用");
  database.exec("ROLLBACK");
  database.close();
});

test("terminal workflow task links are removed before project or account generation data", () => {
  const database = migrateMemory();
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, login_name, display_name, password_hash, role, status, created_at, updated_at)
    VALUES ('owner', 'owner', 'Owner', 'test', 'user', 'active', ?, ?)
  `).run(timestamp, timestamp);
  for (const canvasId of ["canvas-project", "canvas-account"]) {
    const taskId = `task-${canvasId}`;
    const runId = `run-${canvasId}`;
    database.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
        request_fingerprint, state, created_at, updated_at, owner_id
      ) VALUES (?, ?, 'node', 'text', 'prompt', '{}', ?, ?, 'success', ?, ?, 'owner')
    `).run(taskId, canvasId, `idem-${canvasId}`, `fingerprint-${canvasId}`, timestamp, timestamp);
    database.prepare(`
      INSERT INTO workflow_runs (
        id, owner_id, canvas_id, group_id, graph_revision,
        semantic_fingerprint, plan_json, state, stop_requested, created_at, updated_at
      ) VALUES (?, 'owner', ?, 'group', 1, ?, '{"version":1}', 'success', 0, ?, ?)
    `).run(runId, canvasId, `semantic-${canvasId}`, timestamp, timestamp);
    database.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, task_id,
        projection_state, created_at, updated_at
      ) VALUES (?, 'owner', 'node', 'text', 0, '[]', ?, ?, 'success', ?, 'applied', ?, ?)
    `).run(runId, `node-semantic-${canvasId}`, `workflow-idem-${canvasId}`, taskId, timestamp, timestamp);
  }
  database.exec("BEGIN IMMEDIATE");
  deleteWorkflowRunsForCanvasInTransaction({
    bypass: false,
    canvasId: "canvas-project",
    database,
    ownerId: "owner",
  });
  executeTransactionScopedCommand(database, deleteProjectGenerationDataCommand, {
    bypass: false,
    canvasId: "canvas-project",
    ownerId: "owner",
  });
  database.exec("COMMIT");
  expect(database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM workflow_runs WHERE canvas_id = 'canvas-project') AS runs,
      (SELECT COUNT(*) FROM generation_tasks WHERE canvas_id = 'canvas-project') AS tasks
  `).get()).toEqual({ runs: 0, tasks: 0 });

  database.exec("BEGIN IMMEDIATE");
  deleteWorkflowRunsForOwnerInTransaction(database, "owner");
  executeTransactionScopedCommand(database, deleteAccountGenerationDataCommand, "owner");
  database.exec("COMMIT");
  expect(database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM workflow_runs WHERE owner_id = 'owner') AS runs,
      (SELECT COUNT(*) FROM generation_tasks WHERE owner_id = 'owner') AS tasks
  `).get()).toEqual({ runs: 0, tasks: 0 });
  database.close();
});

test("every registered execution adapter has explicit workflow recovery evidence", () => {
  const adapterIds: ModelExecutionAdapterId[] = [
    "ark-text",
    "ark-video",
    "mureka-audio",
    "openrouter-image",
    "relay-gpt-image",
    "relay-media",
  ];
  const policies = adapterIds.map((adapterId) => ({
    adapterId,
    ...workflowRecoveryPolicy(adapterId),
  }));
  expect(policies.every(({ evidence }) => evidence.length > 40)).toBe(true);
  expect(policies.filter(({ workflowEligible }) => workflowEligible).map(
    ({ adapterId }) => adapterId,
  )).toEqual(["ark-text", "ark-video", "mureka-audio", "relay-media"]);
  expect(policies.filter(({ workflowEligible }) => !workflowEligible).map(
    ({ adapterId }) => adapterId,
  )).toEqual(["openrouter-image", "relay-gpt-image"]);
  expect(policies.find(({ adapterId }) => adapterId === "relay-media")?.grade)
    .toBe("DURABLE_USAGE_MATCH");
  expect(policies.find(({ adapterId }) => adapterId === "ark-video")?.grade)
    .toBe("DURABLE_PROVIDER_TASK");
  expect(policies.find(({ adapterId }) => adapterId === "ark-text")?.grade)
    .toBe("STORED_RESPONSE_OR_FENCED_UNKNOWN");
  expect(policies.find(({ adapterId }) => adapterId === "relay-gpt-image")?.grade)
    .toBe("SYNC_RESPONSE_OR_FENCED_UNKNOWN");
});

test("INC-GEN-026 malformed active workflow terminalizes and releases only its own durable resources", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-malformed-workflow-"));
  chmodSync(directory, 0o700);
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const database = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES ('__test__', 'malformed-workflow', 'Malformed Workflow',
        'test', 'user', 'active', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES ('__test__', 'malformed-canvas', 1, 1, '[]', '[]', '{}', ?, NULL, 0)
    `).run(timestamp);
    database.prepare(`
      INSERT INTO workflow_runs (
        id, owner_id, canvas_id, group_id, graph_revision,
        semantic_fingerprint, plan_json, state, stop_requested,
        reservation_id, created_at, updated_at
      ) VALUES ('malformed-run', '__test__', 'malformed-canvas',
        'malformed-group', 1, 'malformed-fingerprint', '{"version":1}',
        'running', 0, 'malformed-reservation', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, task_id,
        projection_state, created_at, updated_at
      ) VALUES ('malformed-run', '__test__', 'malformed-node', 'text', 0,
        '[]', 'malformed-semantic', 'malformed-idempotency', 'pending', NULL,
        'pending', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO workflow_run_locks (
        owner_id, canvas_id, node_id, run_id, created_at
      ) VALUES ('__test__', 'malformed-canvas', 'malformed-node',
        'malformed-run', ?)
    `).run(timestamp);
    database.prepare(`
      INSERT INTO media_capacity_reservations (
        id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
        created_at, updated_at
      ) VALUES ('malformed-reservation', '__test__', 'malformed-run', 1,
        'active', ?, ?, ?)
    `).run(new Date(Date.now() + 60_000).toISOString(), timestamp, timestamp);
    database.close();

    const malformedTaskStore = createGenerationTaskStore(directory);
    const queuedMalformedTask = malformedTaskStore.create({
      canvasId: "malformed-canvas",
      idempotencyKey: "malformed-queued-idempotency",
      kind: "text",
      modelConfiguration: {},
      nodeId: "malformed-queued-node",
      ownerId: "__test__",
      prompt: "queued malformed task",
      providerModelId: "malformed-provider-model",
      providerProfileId: "malformed-provider-profile",
    }).task;
    const paidMalformedTask = malformedTaskStore.create({
      canvasId: "malformed-canvas",
      idempotencyKey: "malformed-paid-idempotency",
      kind: "video",
      modelConfiguration: {},
      nodeId: "malformed-paid-node",
      ownerId: "__test__",
      prompt: "paid malformed task",
      providerModelId: "malformed-provider-model",
      providerProfileId: "malformed-provider-profile",
    }).task;
    const unrelatedRunningTask = malformedTaskStore.create({
      canvasId: "unrelated-canvas",
      idempotencyKey: "unrelated-running-idempotency",
      kind: "text",
      modelConfiguration: {},
      nodeId: "unrelated-running-node",
      ownerId: "__test__",
      prompt: "unrelated running task",
      providerModelId: "unrelated-provider-model",
      providerProfileId: "unrelated-provider-profile",
    }).task;
    malformedTaskStore.transition(paidMalformedTask.id, "running");
    malformedTaskStore.recordProviderAttempt(paidMalformedTask.id);
    malformedTaskStore.transition(paidMalformedTask.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "preserve paid boundary",
    });
    malformedTaskStore.transition(unrelatedRunningTask.id, "running");
    malformedTaskStore.close();
    const linkedSetup = openAppDatabase(directory);
    for (const fixture of [{
      kind: "text",
      nodeId: "malformed-queued-node",
      reservationId: "malformed-queued-reservation",
      runId: "malformed-queued-run",
      taskId: queuedMalformedTask.id,
    }, {
      kind: "video",
      nodeId: "malformed-paid-node",
      reservationId: "malformed-paid-reservation",
      runId: "malformed-paid-run",
      taskId: paidMalformedTask.id,
    }] as const) {
      linkedSetup.prepare(`
        INSERT INTO workflow_runs (
          id, owner_id, canvas_id, group_id, graph_revision,
          semantic_fingerprint, plan_json, state, stop_requested,
          reservation_id, created_at, updated_at
        ) VALUES (?, '__test__', 'malformed-canvas', ?, 1, ?,
          '{"version":1}', 'running', 0, ?, ?, ?)
      `).run(
        fixture.runId,
        `${fixture.runId}-group`,
        `${fixture.runId}-fingerprint`,
        fixture.reservationId,
        timestamp,
        timestamp,
      );
      linkedSetup.prepare(`
        INSERT INTO workflow_run_nodes (
          run_id, owner_id, node_id, kind, plan_index, dependencies_json,
          semantic_identity, idempotency_key, state, task_id,
          projection_state, created_at, updated_at
        ) VALUES (?, '__test__', ?, ?, 0, '[]', ?, ?, 'admitted', ?,
          'pending', ?, ?)
      `).run(
        fixture.runId,
        fixture.nodeId,
        fixture.kind,
        `${fixture.nodeId}-semantic`,
        `${fixture.nodeId}-idempotency`,
        fixture.taskId,
        timestamp,
        timestamp,
      );
      linkedSetup.prepare(`
        INSERT INTO workflow_run_locks (
          owner_id, canvas_id, node_id, run_id, created_at
        ) VALUES ('__test__', 'malformed-canvas', ?, ?, ?)
      `).run(fixture.nodeId, fixture.runId, timestamp);
      linkedSetup.prepare(`
        INSERT INTO media_capacity_reservations (
          id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
          created_at, updated_at
        ) VALUES (?, '__test__', ?, 1, 'active', ?, ?, ?)
      `).run(
        fixture.reservationId,
        fixture.runId,
        new Date(Date.now() + 60_000).toISOString(),
        timestamp,
        timestamp,
      );
    }
    linkedSetup.close();

    const workflow = await import("../server/workflowRunService");
    await workflow.runWorkflowSweep();
    const verify = openAppDatabase(directory);
    expect(verify.prepare(`
      SELECT state, error_code FROM workflow_runs WHERE id = 'malformed-run'
    `).get()).toEqual({
      error_code: "WORKFLOW_PLAN_MALFORMED",
      state: "failed",
    });
    expect(verify.prepare(`
      SELECT state, error_code FROM workflow_run_nodes
      WHERE run_id = 'malformed-run'
    `).get()).toEqual({
      error_code: "WORKFLOW_PLAN_MALFORMED",
      state: "failed",
    });
    expect(verify.prepare(`
      SELECT COUNT(*) AS count FROM workflow_run_locks
      WHERE run_id = 'malformed-run'
    `).get()).toEqual({ count: 0 });
    expect(verify.prepare(`
      SELECT state FROM media_capacity_reservations
      WHERE id = 'malformed-reservation'
    `).get()).toEqual({ state: "released" });
    expect(verify.prepare(`
      SELECT state, error_code AS errorCode FROM generation_tasks WHERE id = ?
    `).get(queuedMalformedTask.id)).toEqual({
      errorCode: "WORKFLOW_PLAN_MALFORMED",
      state: "cancelled",
    });
    expect(verify.prepare(`
      SELECT state FROM workflow_runs WHERE id = 'malformed-queued-run'
    `).get()).toEqual({ state: "failed" });
    expect(verify.prepare(`
      SELECT state, stop_requested AS stopRequested
      FROM workflow_runs WHERE id = 'malformed-paid-run'
    `).get()).toEqual({ state: "stopping", stopRequested: 1 });
    expect(verify.prepare(`
      SELECT COUNT(*) AS count FROM workflow_run_locks
      WHERE run_id = 'malformed-paid-run'
    `).get()).toEqual({ count: 1 });
    expect(verify.prepare(`
      SELECT state FROM media_capacity_reservations
      WHERE id = 'malformed-paid-reservation'
    `).get()).toEqual({ state: "active" });
    expect(verify.prepare(`
      SELECT
        task.state,
        (SELECT COUNT(*) FROM generation_provider_attempts
          WHERE task_id = task.id) AS attempts
      FROM generation_tasks AS task WHERE task.id = ?
    `).get(paidMalformedTask.id)).toEqual({ attempts: 1, state: "recovering" });
    expect(verify.prepare(`
      SELECT state FROM generation_tasks WHERE id = ?
    `).get(unrelatedRunningTask.id)).toEqual({ state: "running" });
    verify.close();
    expect(workflow.getWorkflowRun("__test__", "malformed-run")).toMatchObject({
      errorCode: "WORKFLOW_PLAN_MALFORMED",
      lockedNodeIds: [],
      state: "failed",
    });
  } finally {
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    rmSync(directory, { force: true, recursive: true });
  }
});

test("server sweep projects authoritative success and stop releases only future nodes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-workflow-sweep-"));
  chmodSync(directory, 0o700);
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  let taskStoreForCleanup: ReturnType<typeof createGenerationTaskStore> | undefined;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const database = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    const successRelease = workflowReleaseFixture({
      index: 101,
      kind: "text",
      modelId: "text-model",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: "provider-profile",
      providerProtocol: "native",
    });
    const successSchema = knownModelParameterSchema({
      capability: "text",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seed-2-0-lite-260428",
    });
    const successPreflight = resolveNodeInputs({
      edges: [],
      modelReleaseRevision: successRelease.revisionId,
      modelSchema: successSchema,
      nodes: [{
        data: {
          content: "old",
          textModelConfigurationRevision: "model-revision",
          textModelId: "text-model",
          textPrompt: "authoritative prompt",
          textPromptReady: true,
        },
        id: "text-node",
        type: "text",
      }],
      ownPrompt: "authoritative prompt",
      parameters: {},
      targetId: "text-node",
      targetKind: "text",
    });
    if (!successPreflight.contractFingerprint) {
      throw new Error("workflow projection fixture has no input contract");
    }
    const successParameters = submissionParameterValues(
      successSchema,
      successPreflight.normalizedParameters ?? {},
    );
    const successInputKey = generationInputKey({
      inputs: successPreflight.inputs,
      modelConfigurationRevision: "model-revision",
      modelId: "text-model",
      modelReleaseRevision: successRelease.revisionId,
      ownPrompt: "authoritative prompt",
      parameters: successParameters,
      prompt: successPreflight.finalPrompt,
    });
    const successOwnershipKey = generationOwnershipKey(
      generationOwnershipEvidence({
        contractFingerprint: successPreflight.contractFingerprint,
        inputs: successPreflight.inputs,
        kind: "text",
        modelConfigurationRevision: "model-revision",
        modelId: "text-model",
        modelReleaseRevision: successRelease.revisionId,
        parameters: successParameters,
        prompt: "authoritative prompt",
      }),
    );
    database.prepare(`
      INSERT INTO users (id, login_name, display_name, password_hash, role, status, created_at, updated_at)
      VALUES ('__test__', 'workflow-test', 'Workflow Test', 'test', 'user', 'active', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES ('__test__', 'canvas', 1, 1, ?, '[]',
        '{"x":0,"y":0,"zoom":1}', ?, NULL, 0)
    `).run(JSON.stringify([{
      data: {
        content: "old",
        textGenerating: true,
        textGenerationInputKey: successInputKey,
        textGenerationOwnershipKey: successOwnershipKey,
        textGenerationTaskId: "stale-task-id",
        textModelConfigurationRevision: "model-revision",
        textModelId: "text-model",
        textParameters: successParameters,
        textPrompt: "authoritative prompt",
        textPromptReady: true,
        workflowExecutionRunId: "success-run",
      },
      id: "text-node",
      type: "text",
    }]), timestamp);
    database.close();

    const generation = await import("../server/generationTasks");
    const taskStore = generation.generationTaskApplication.taskStore();
    taskStoreForCleanup = taskStore;
    const task = taskStore.create({
      canvasId: "canvas",
      idempotencyKey: "workflow-sweep-task",
      kind: "text",
      model: "text-model",
      modelConfiguration: {
        generationIdentityVersion: 2,
        generationInputKey: successInputKey,
        generationOwnershipKey: successOwnershipKey,
        modelCapability: "text",
        modelConfigurationRevision: "model-revision",
        modelId: "text-model",
        modelInputContractFingerprint: successPreflight.contractFingerprint,
        modelReleaseRevision: successRelease,
        parameterSchema: successSchema,
        workflowBinding: {
          generationInputKey: successInputKey,
          generationOwnershipKey: successOwnershipKey,
          groupId: "success-group",
          modelConfigurationRevision: "model-revision",
          modelReleaseRevision: successRelease.revisionId,
          reservationId: "success-run-reservation",
          runId: "success-run",
        },
      },
      nodeId: "text-node",
      ownerId: "__test__",
      prompt: "authoritative prompt",
      providerModelId: "provider-text-model",
      providerProfileId: "provider-profile",
    }).task;
    const boundCanvas = openAppDatabase(directory);
    const boundCanvasRow = boundCanvas.prepare(`
      SELECT nodes FROM canvas_documents
      WHERE owner_id = '__test__' AND id = 'canvas'
    `).get() as { nodes: string };
    const boundNodes = JSON.parse(boundCanvasRow.nodes) as Array<{
      data: Record<string, unknown>;
    }>;
    boundNodes[0]!.data.textGenerationTaskId = task.id;
    boundCanvas.prepare(`
      UPDATE canvas_documents SET nodes = ?
      WHERE owner_id = '__test__' AND id = 'canvas'
    `).run(JSON.stringify(boundNodes));
    boundCanvas.close();
    taskStore.transition(task.id, "running");
    taskStore.complete(task.id, {
      actualCostMicrounits: 0,
      resultText: "<b>authoritative & result</b>",
    });
    const unknownTask = taskStore.create({
      canvasId: "canvas",
      idempotencyKey: "workflow-unknown-task",
      kind: "image",
      model: "image-model",
      modelConfiguration: { generationOwnershipKey: "workflow-unknown-owner-key" },
      nodeId: "unknown-node",
      ownerId: "__test__",
      prompt: "unknown outcome",
      providerModelId: "provider-image-model",
      providerProfileId: "provider-profile",
    }).task;
    taskStore.transition(unknownTask.id, "running");
    taskStore.recordProviderAttempt(unknownTask.id);
    taskStore.transition(unknownTask.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "fenced unknown",
    });
    const recoveringRelease = workflowReleaseFixture({
      index: 104,
      kind: "text",
      modelId: "recovering-text-model",
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: "provider-profile",
      providerProtocol: "native",
    });
    const recoveringTask = taskStore.create({
      canvasId: "canvas",
      idempotencyKey: "workflow-recovering-task",
      kind: "text",
      model: "recovering-text-model",
      modelConfiguration: {
        generationIdentityVersion: 2,
        generationInputKey: "recovering-input-key",
        generationOwnershipKey: "recovering-owner-key",
        modelCapability: "text",
        modelConfigurationRevision: "recovering-model-revision",
        modelId: "recovering-text-model",
        modelInputContractFingerprint: "recovering-contract",
        modelReleaseRevision: recoveringRelease,
        parameterSchema: successSchema,
        workflowBinding: {
          generationInputKey: "recovering-input-key",
          generationOwnershipKey: "recovering-owner-key",
          groupId: "recovering-group",
          modelConfigurationRevision: "recovering-model-revision",
          modelReleaseRevision: recoveringRelease.revisionId,
          reservationId: "recovering-run-reservation",
          runId: "recovering-run",
        },
      },
      nodeId: "recovering-node",
      ownerId: "__test__",
      prompt: "recover the original task",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProfileId: "provider-profile",
    }).task;
    taskStore.transition(recoveringTask.id, "running");
    taskStore.transition(recoveringTask.id, "recovering", {
      code: "AUTOMATIC_RESULT_RECOVERY",
      message: "continue the original task",
    });

    const plan = JSON.stringify({
      clientSemanticFingerprint: "semantic-run-client",
      edges: [],
      executableNodeIds: ["text-node"],
      externalNodes: [],
      groupId: "success-group",
      nodes: [{
        costCurrency: "CNY",
        dependencies: [],
        id: "text-node",
        kind: "text",
        modelConfigurationRevision: "model-revision",
        modelId: "text-model",
        modelReleaseRevision: successRelease,
        ownPrompt: "authoritative prompt",
        parameters: {},
        planIndex: 0,
        providerDriver: "volcengine-ark",
        providerModelId: "doubao-seed-2-0-lite-260428",
        providerProfileId: "provider-profile",
        providerProtocol: "native",
        recoveryEvidence: "stored response",
        recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN",
        semanticIdentity: "semantic-node",
      }],
      semanticFingerprint: "semantic-run",
      version: 1,
    });
    const store = openAppDatabase(directory);
    const recoveringPlan = JSON.stringify({
      clientSemanticFingerprint: "recovering-semantic-run-client",
      edges: [],
      executableNodeIds: ["recovering-node"],
      externalNodes: [],
      groupId: "recovering-group",
      nodes: [{
        costCurrency: "CNY",
        dependencies: [],
        id: "recovering-node",
        kind: "text",
        modelConfigurationRevision: "recovering-model-revision",
        modelId: "recovering-text-model",
        modelReleaseRevision: recoveringRelease,
        ownPrompt: "recover the original task",
        parameters: {},
        planIndex: 0,
        providerDriver: "volcengine-ark",
        providerModelId: "doubao-seed-2-0-lite-260428",
        providerProfileId: "provider-profile",
        providerProtocol: "native",
        recoveryEvidence: "stored response",
        recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN",
        semanticIdentity: "recovering-semantic-node",
      }],
      semanticFingerprint: "recovering-semantic-run",
      version: 1,
    });
    const unknownPlan = JSON.stringify({
      clientSemanticFingerprint: "unknown-semantic-run-client",
      edges: [],
      executableNodeIds: ["unknown-node"],
      externalNodes: [],
      groupId: "unknown-group",
      nodes: [{
        costCurrency: "USD",
        dependencies: [],
        id: "unknown-node",
        kind: "image",
        modelConfigurationRevision: "unknown-model-revision",
        modelId: "image-model",
        modelReleaseRevision: workflowReleaseFixture({
          index: 102,
          kind: "image",
          modelId: "image-model",
          providerDriver: "multi-protocol-relay",
          providerModelId: "gpt-image-2",
          providerProfileId: "provider-profile",
          providerProtocol: "gpt-image",
        }),
        ownPrompt: "unknown outcome",
        parameters: {},
        planIndex: 0,
        providerDriver: "multi-protocol-relay",
        providerModelId: "gpt-image-2",
        providerProfileId: "provider-profile",
        providerProtocol: "gpt-image",
        recoveryEvidence: "sync response or fenced unknown",
        recoveryGrade: "SYNC_RESPONSE_OR_FENCED_UNKNOWN",
        semanticIdentity: "unknown-semantic-node",
      }],
      semanticFingerprint: "unknown-semantic-run",
      version: 1,
    });
    for (const [runId, groupId, runPlan] of [
      ["success-run", "success-group", plan],
      ["stop-run", "stop-group", JSON.stringify({
        clientSemanticFingerprint: "stop-semantic-client",
        edges: [],
        executableNodeIds: ["future-node"],
        externalNodes: [],
        groupId: "stop-group",
        nodes: [{
          costCurrency: "CNY",
          dependencies: [],
          id: "future-node",
          kind: "text",
          modelConfigurationRevision: "future-model-revision",
          modelId: "future-model",
          modelReleaseRevision: workflowReleaseFixture({
            index: 103,
            kind: "text",
            modelId: "future-model",
            providerDriver: "volcengine-ark",
            providerModelId: "doubao-seed-2-0-lite-260428",
            providerProfileId: "provider-profile",
            providerProtocol: "native",
          }),
          ownPrompt: "future",
          parameters: {},
          planIndex: 0,
          providerDriver: "volcengine-ark",
          providerModelId: "doubao-seed-2-0-lite-260428",
          providerProfileId: "provider-profile",
          providerProtocol: "native",
          recoveryEvidence: "stored response recovery evidence for stopped future node",
          recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN",
          semanticIdentity: "future-semantic",
        }],
        semanticFingerprint: "stop-semantic",
        version: 1,
      })],
      ["recovering-run", "recovering-group", recoveringPlan],
      ["unknown-run", "unknown-group", unknownPlan],
    ] as const) {
      store.prepare(`
        INSERT INTO workflow_runs (
          id, owner_id, canvas_id, group_id, graph_revision,
          semantic_fingerprint, plan_json, state, stop_requested,
          reservation_id, created_at, updated_at
        ) VALUES (?, '__test__', 'canvas', ?, 1, ?, ?, 'running', 0, ?, ?, ?)
      `).run(
        runId,
        groupId,
        `${runId}-fingerprint`,
        runPlan,
        `${runId}-reservation`,
        timestamp,
        timestamp,
      );
      store.prepare(`
        INSERT INTO workflow_run_locks (owner_id, canvas_id, node_id, run_id, created_at)
        VALUES ('__test__', 'canvas', ?, ?, ?)
      `).run(
        runId === "success-run"
          ? "text-node"
          : runId === "unknown-run"
            ? "unknown-node"
            : runId === "recovering-run" ? "recovering-node" : "future-node",
        runId,
        timestamp,
      );
      store.prepare(`
        INSERT INTO media_capacity_reservations (
          id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
          created_at, updated_at
        ) VALUES (?, '__test__', ?, 1, 'active', ?, ?, ?)
      `).run(
        `${runId}-reservation`,
        runId,
        new Date(Date.now() + 60_000).toISOString(),
        timestamp,
        timestamp,
      );
    }
    store.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, task_id,
        projection_state, created_at, updated_at
      ) VALUES (
        'success-run', '__test__', 'text-node', 'text', 0, '[]',
        'semantic-node', 'success-idempotency', 'admitted', ?,
        'pending', ?, ?
      )
    `).run(task.id, timestamp, timestamp);
    store.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, task_id,
        projection_state, created_at, updated_at
      ) VALUES (
        'stop-run', '__test__', 'future-node', 'text', 0, '[]',
        'future-semantic', 'future-idempotency', 'pending', NULL,
        'pending', ?, ?
      )
    `).run(timestamp, timestamp);
    store.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, task_id,
        projection_state, created_at, updated_at
      ) VALUES (
        'unknown-run', '__test__', 'unknown-node', 'image', 0, '[]',
        'unknown-semantic-node', 'unknown-idempotency', 'admitted', ?,
        'pending', ?, ?
      )
    `).run(unknownTask.id, timestamp, timestamp);
    store.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, task_id,
        projection_state, created_at, updated_at
      ) VALUES (
        'recovering-run', '__test__', 'recovering-node', 'text', 0, '[]',
        'recovering-semantic-node', 'recovering-idempotency', 'admitted', ?,
        'pending', ?, ?
      )
    `).run(recoveringTask.id, timestamp, timestamp);
    store.close();

    const projectionProbe = openAppDatabase(directory);
    let projectionBuild: ReturnType<typeof buildCanvasProjectionIdentity>;
    let projectionProbeResult: ReturnType<typeof projectWorkflowResultInTransaction>;
    projectionProbe.exec("BEGIN IMMEDIATE");
    try {
      projectionBuild = buildCanvasProjectionIdentity({
        canvasId: "canvas",
        database: projectionProbe,
        kind: "text",
        nodeId: "text-node",
        ownerId: "__test__",
        runId: "success-run",
        taskId: task.id,
      });
      projectionProbeResult = projectWorkflowResultInTransaction({
        canvasId: "canvas",
        database: projectionProbe,
        kind: "text",
        nodeId: "text-node",
        ownerId: "__test__",
        runId: "success-run",
        taskId: task.id,
      });
    } finally {
      if (projectionProbe.isTransaction) projectionProbe.exec("ROLLBACK");
      projectionProbe.close();
    }
    expect(projectionBuild!).toMatchObject({ status: "ready" });
    expect(projectionProbeResult!).toBe("applied");

    const workflow = await import("../server/workflowRunService");
    const faultStore = openAppDatabase(directory);
    const canvasBeforeProjectionFault = faultStore.prepare(`
      SELECT revision, graph_revision, nodes, edges, viewport, updated_at
      FROM canvas_documents WHERE owner_id = '__test__' AND id = 'canvas'
    `).get();
    faultStore.prepare(`
      UPDATE workflow_runs
      SET stop_requested = 1, state = 'stopping', updated_at = ?
      WHERE id = 'stop-run' AND state = 'running'
    `).run(new Date().toISOString());
    faultStore.close();
    resetCanvasObservabilityForTests();
    setGenerationProjectionReceiptFaultForTests((projection) => {
      if (projection.scope === "workflow" && projection.taskId === task.id) {
        throw new Error("m103 projection fault");
      }
    });
    try {
      await workflow.runWorkflowSweep();
    } finally {
      setGenerationProjectionReceiptFaultForTests(undefined);
    }
    const failedProjection = openAppDatabase(directory);
    expect(failedProjection.prepare(`
      SELECT state FROM workflow_runs WHERE id = 'success-run'
    `).get()).toEqual({ state: "success" });
    expect(failedProjection.prepare(`
      SELECT state, projection_state, error_code
      FROM workflow_run_nodes
      WHERE run_id = 'success-run' AND node_id = 'text-node'
    `).get()).toEqual({
      error_code: null,
      projection_state: "failed",
      state: "success",
    });
    expect(failedProjection.prepare(`
      SELECT revision, graph_revision, nodes, edges, viewport, updated_at
      FROM canvas_documents WHERE owner_id = '__test__' AND id = 'canvas'
    `).get()).toEqual(canvasBeforeProjectionFault);
    expect(failedProjection.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_receipts
      WHERE actor_type = 'server' AND command_type = 'server.projection'
    `).get()).toEqual({ count: 0 });
    failedProjection.close();
    const projectionFailureEvents = snapshotCanvasObservabilityForTests().events
      .filter((event) => event.outcome === "projection.failed" && (
        ("taskId" in event && event.taskId === task.id) ||
        ("operationId" in event &&
          event.operationId === `server-projection-unresolved:${task.id}`)
      ));
    expect(projectionFailureEvents.map((event) => event.event).sort()).toEqual([
      "command",
      "generation-lifecycle",
      "route",
    ]);
    expect(snapshotCanvasObservabilityForTests().events.some((event) =>
      event.outcome === "projection.applied" &&
      "taskId" in event && event.taskId === task.id
    )).toBe(false);

    await workflow.runWorkflowSweep();
    const after = openAppDatabase(directory);
    expect(after.prepare(`
      SELECT state FROM workflow_runs ORDER BY id DESC
    `).all()).toEqual([
      { state: "failed" },
      { state: "success" },
      { state: "cancelled" },
      { state: "running" },
    ]);
    expect(after.prepare(`
      SELECT run_id, state, projection_state, error_code
      FROM workflow_run_nodes ORDER BY run_id DESC
    `).all()).toEqual([
      {
        error_code: "OUTCOME_UNKNOWN_BILLING_RISK",
        projection_state: "pending",
        run_id: "unknown-run",
        state: "failed",
      },
      {
        error_code: null,
        projection_state: "applied",
        run_id: "success-run",
        state: "success",
      },
      {
        error_code: null,
        projection_state: "pending",
        run_id: "stop-run",
        state: "cancelled",
      },
      {
        error_code: null,
        projection_state: "pending",
        run_id: "recovering-run",
        state: "admitted",
      },
    ]);
    expect(after.prepare("SELECT COUNT(*) AS count FROM workflow_run_locks").get())
      .toEqual({ count: 1 });
    expect(after.prepare(`
      SELECT state FROM media_capacity_reservations ORDER BY id
    `).all()).toEqual([
      { state: "active" },
      { state: "released" },
      { state: "released" },
      { state: "released" },
    ]);
    expect(after.prepare(`
      SELECT state FROM generation_tasks WHERE id = ?
    `).get(unknownTask.id)).toEqual({ state: "recovering" });
    expect(after.prepare(`
      SELECT COUNT(*) AS count FROM canvas_operation_receipts
      WHERE actor_type = 'server' AND command_type = 'server.projection'
        AND operation_id LIKE 'server-projection:%'
    `).get()).toEqual({ count: 1 });
    const projectionAppliedEvents = snapshotCanvasObservabilityForTests().events
      .filter((event) => event.outcome === "projection.applied" &&
        "taskId" in event && event.taskId === task.id);
    expect(projectionAppliedEvents.map((event) => event.event).sort()).toEqual([
      "generation-lifecycle",
      "route",
    ]);
    const canvas = after.prepare(`
      SELECT nodes FROM canvas_documents WHERE owner_id = '__test__' AND id = 'canvas'
    `).get() as { nodes: string };
    expect((JSON.parse(canvas.nodes) as Array<{ data: Record<string, unknown> }>)[0]?.data)
      .toMatchObject({
        content: "<b>authoritative & result</b>",
        contentHtml: "<p>&lt;b&gt;authoritative &amp; result&lt;/b&gt;</p>",
        groupRunSuccessInputFingerprint: successInputKey,
        groupRunSuccessModelConfigurationRevision: "model-revision",
        groupRunSuccessModelReleaseRevision: successRelease.revisionId,
        groupRunSuccessOwnershipKey: successOwnershipKey,
        groupRunSuccessResultKey: stableSha256({
          textSha256: sha256Hex("<b>authoritative & result</b>"),
        }),
        groupRunSuccessTaskId: task.id,
        textGenerationTaskId: task.id,
      });
    const projectedTextData = (JSON.parse(canvas.nodes) as Array<{
      data: Record<string, unknown>;
    }>)[0]!.data;
    expect(projectedTextData.textGenerating).toBe(false);
    expect(projectedTextData.textGenerationInputKey).toBeUndefined();
    expect(projectedTextData.textGenerationOwnershipKey).toBeUndefined();
    expect(projectedTextData.workflowExecutionRunId).toBeUndefined();
    const retryNodes = JSON.parse(canvas.nodes) as Array<{
      data: Record<string, unknown>;
    }>;
    retryNodes[0]!.data.content = "temporarily stale projection";
    after.prepare(`
      UPDATE canvas_documents SET nodes = ?, revision = revision + 1
      WHERE owner_id = '__test__' AND id = 'canvas'
    `).run(JSON.stringify(retryNodes));
    after.prepare(`
      UPDATE workflow_run_nodes SET projection_state = 'failed'
      WHERE run_id = 'success-run' AND node_id = 'text-node'
    `).run();
    after.close();
    expect(taskStore.resume(recoveringTask.id)).toMatchObject({
      attempt: 1,
      state: "running",
    });
    taskStore.complete(recoveringTask.id, {
      actualCostMicrounits: 0,
      resultText: "recovered original result",
    });
    await workflow.runWorkflowSweep();
    const retried = openAppDatabase(directory);
    expect(retried.prepare(`
      SELECT projection_state FROM workflow_run_nodes
      WHERE run_id = 'success-run' AND node_id = 'text-node'
    `).get()).toEqual({ projection_state: "applied" });
    const retriedCanvas = retried.prepare(`
      SELECT nodes FROM canvas_documents WHERE owner_id = '__test__' AND id = 'canvas'
    `).get() as { nodes: string };
    // Receipt replay proves the original projection was already committed; a
    // later durable user edit must never be overwritten by a recovery sweep.
    expect((JSON.parse(retriedCanvas.nodes) as Array<{ data: Record<string, unknown> }>)[0]
      ?.data.content).toBe("temporarily stale projection");
    expect(retried.prepare(`
      SELECT state FROM workflow_runs WHERE id = 'recovering-run'
    `).get()).toEqual({ state: "success" });
    expect(retried.prepare(`
      SELECT state, projection_state FROM workflow_run_nodes
      WHERE run_id = 'recovering-run' AND node_id = 'recovering-node'
    `).get()).toEqual({ projection_state: "conflict", state: "success" });
    expect(retried.prepare(`
      SELECT state FROM media_capacity_reservations
      WHERE id = 'recovering-run-reservation'
    `).get()).toEqual({ state: "released" });
    expect(retried.prepare(`
      SELECT COUNT(*) AS count FROM workflow_run_locks
      WHERE run_id = 'recovering-run'
    `).get()).toEqual({ count: 0 });
    retried.close();
  } finally {
    taskStoreForCleanup?.close();
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    rmSync(directory, { force: true, recursive: true });
  }
});
