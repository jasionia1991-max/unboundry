import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "./safe-test";
import {
  applyPendingSchemaMigrationsInTransaction,
  currentSchemaVersion,
  databaseMatchesMigrationManifest,
  databaseMatchesSchema41Contract,
  databaseMatchesSchemaContract,
  openAppDatabase,
} from "../server/database";
import {
  compileFrozenWorkflowSemanticPlan,
} from "../types/workflowSemanticPlan";
import {
  workflowLockedGraphChanged,
  workflowProjectedResultRegressed,
} from "../server/canvasPersistence";
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
import { migrateSchema41To42 } from "../server/schema41To42Migration";
import {
  workflowRecoveryPolicy,
  type ModelExecutionAdapterId,
} from "../server/modelExecutionRegistry";
import {
  assertGenerationMediaDeletionAllowedInTransaction,
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
} from "../server/workflowRunLocks";

const executeFile = promisify(execFile);

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

test("schema 42 is exact and a schema 41 database is refused without mutation", () => {
  const current = migrateMemory();
  expect(currentSchemaVersion).toBe(42);
  expect(databaseMatchesMigrationManifest(current)).toBe(true);
  expect(databaseMatchesSchemaContract(current)).toBe(true);
  current.close();

  const directory = mkdtempSync(join(tmpdir(), "unboundry-schema41-refusal-"));
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
    targetVersion: 41,
  });
  legacy.exec("COMMIT");
  expect(databaseMatchesSchema41Contract(legacy)).toBe(true);
  legacy.close();
  chmodSync(path, 0o600);
  expect(() => openAppDatabase(directory)).toThrow();
  const after = new DatabaseSync(path, { readOnly: true });
  expect((after.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
    .toBe(41);
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
    expect(databaseMatchesMigrationManifest(migrated)).toBe(true);
    expect(databaseMatchesSchemaContract(migrated)).toBe(true);
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

test("single-node admission is blocked by another run and allowed for its owning run", () => {
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
  let owningError: unknown;
  try {
    store.admitOrGet({
      ...base,
      idempotencyKey: "workflow-owning-run",
      modelConfiguration: { workflowBinding: { runId: "run-owner" } },
    });
  } catch (error) {
    owningError = error;
  }
  expect(owningError).not.toBeInstanceOf(GenerationTaskWorkflowLockedError);
  expect(() => store.admitOrGet({
    ...base,
    idempotencyKey: "workflow-unknown-run",
    modelConfiguration: { workflowBinding: { runId: "run-owner" } },
    nodeId: "unknown-node",
  })).toThrow("原任务结果仍不明确");
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
  expect(policies.every(({ workflowEligible }) => workflowEligible)).toBe(true);
  expect(policies.find(({ adapterId }) => adapterId === "relay-media")?.grade)
    .toBe("DURABLE_USAGE_MATCH");
  expect(policies.find(({ adapterId }) => adapterId === "ark-video")?.grade)
    .toBe("DURABLE_PROVIDER_TASK");
  expect(policies.find(({ adapterId }) => adapterId === "ark-text")?.grade)
    .toBe("STORED_RESPONSE_OR_FENCED_UNKNOWN");
  expect(policies.find(({ adapterId }) => adapterId === "relay-gpt-image")?.grade)
    .toBe("SYNC_RESPONSE_OR_FENCED_UNKNOWN");
});

test("server sweep projects authoritative success and stop releases only future nodes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unboundry-workflow-sweep-"));
  chmodSync(directory, 0o700);
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  try {
    const database = openAppDatabase(directory);
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO users (id, login_name, display_name, password_hash, role, status, created_at, updated_at)
      VALUES ('__test__', 'workflow-test', 'Workflow Test', 'test', 'user', 'active', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES ('__test__', 'canvas', 1, 1, ?, '[]', '{}', ?, NULL, 0)
    `).run(JSON.stringify([{
      data: {
        content: "old",
        textModelId: "text-model",
        textPrompt: "authoritative prompt",
      },
      id: "text-node",
      type: "text",
    }]), timestamp);
    database.close();

    const taskStore = createGenerationTaskStore(directory);
    const task = taskStore.create({
      canvasId: "canvas",
      idempotencyKey: "workflow-sweep-task",
      kind: "text",
      model: "text-model",
      modelConfiguration: { generationOwnershipKey: "workflow-owner-key" },
      nodeId: "text-node",
      ownerId: "__test__",
      prompt: "authoritative prompt",
      providerModelId: "provider-text-model",
      providerProfileId: "provider-profile",
    }).task;
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
    taskStore.close();

    const plan = JSON.stringify({
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
        modelReleaseRevision: { revisionId: "release-revision" },
        ownPrompt: "authoritative prompt",
        parameters: {},
        planIndex: 0,
        providerDriver: "volcengine-ark",
        providerModelId: "provider-text-model",
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
    const unknownPlan = JSON.stringify({
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
        modelReleaseRevision: { revisionId: "unknown-release-revision" },
        ownPrompt: "unknown outcome",
        parameters: {},
        planIndex: 0,
        providerDriver: "relay",
        providerModelId: "provider-image-model",
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
        edges: [],
        executableNodeIds: ["future-node"],
        externalNodes: [],
        groupId: "stop-group",
        nodes: [],
        semanticFingerprint: "stop-semantic",
        version: 1,
      })],
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
          : runId === "unknown-run" ? "unknown-node" : "future-node",
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
    store.close();

    const workflow = await import("../server/workflowRunService");
    workflow.stopWorkflowRun("__test__", "stop-run");
    await workflow.runWorkflowSweep();
    const after = openAppDatabase(directory);
    expect(after.prepare(`
      SELECT state FROM workflow_runs ORDER BY id DESC
    `).all()).toEqual([
      { state: "failed" },
      { state: "success" },
      { state: "cancelled" },
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
    ]);
    expect(after.prepare("SELECT COUNT(*) AS count FROM workflow_run_locks").get())
      .toEqual({ count: 0 });
    expect(after.prepare(`
      SELECT state FROM media_capacity_reservations ORDER BY id
    `).all()).toEqual([
      { state: "released" },
      { state: "released" },
      { state: "released" },
    ]);
    expect(after.prepare(`
      SELECT state FROM generation_tasks WHERE id = ?
    `).get(unknownTask.id)).toEqual({ state: "recovering" });
    const canvas = after.prepare(`
      SELECT nodes FROM canvas_documents WHERE owner_id = '__test__' AND id = 'canvas'
    `).get() as { nodes: string };
    expect((JSON.parse(canvas.nodes) as Array<{ data: Record<string, unknown> }>)[0]?.data)
      .toMatchObject({
        content: "<b>authoritative & result</b>",
        contentHtml: "<p>&lt;b&gt;authoritative &amp; result&lt;/b&gt;</p>",
        groupRunSuccessTaskId: task.id,
        textGenerationTaskId: task.id,
      });
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
    await workflow.runWorkflowSweep();
    const retried = openAppDatabase(directory);
    expect(retried.prepare(`
      SELECT projection_state FROM workflow_run_nodes
      WHERE run_id = 'success-run' AND node_id = 'text-node'
    `).get()).toEqual({ projection_state: "applied" });
    const retriedCanvas = retried.prepare(`
      SELECT nodes FROM canvas_documents WHERE owner_id = '__test__' AND id = 'canvas'
    `).get() as { nodes: string };
    expect((JSON.parse(retriedCanvas.nodes) as Array<{ data: Record<string, unknown> }>)[0]
      ?.data.content).toBe("<b>authoritative & result</b>");
    retried.close();
    const generation = await import("../server/generationTasks");
    generation.generationTaskApplication.taskStore().close();
  } finally {
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    rmSync(directory, { force: true, recursive: true });
  }
});
