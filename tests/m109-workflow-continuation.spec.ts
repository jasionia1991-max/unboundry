import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import {
  createGenerationTaskStore,
  readGenerationTaskInTransaction,
} from "../server/generationTaskStore";
import {
  continueWorkflowRun,
  getWorkflowContinuation,
  getWorkflowContinuationPreview,
} from "../server/workflowRunService";
import {
  compileFrozenWorkflowSemanticPlan,
  type WorkflowSemanticEdge,
  type WorkflowSemanticNode,
} from "../types/workflowSemanticPlan";
import type { StoredWorkflowPlan } from "../types/workflowRuns";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { inspectModelReleaseDocument } from "../server/modelReleaseRevisionStore";
import { knownModelParameterSchema } from "../types/modelParameters";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import type { ProviderProtocol } from "../types/relayProtocols";
import { resetGenerationTaskStoreForRuntimeTest } from "../server/generationTasks";

const ownerId = "__test__";
const canvasId = "m109-continuation-canvas";
const groupId = "m109-continuation-group";
const parentRunId = "00000000-0000-4000-8109-000000000001";
const parentReservationId = "00000000-0000-4000-8109-000000000002";
const modelId = "m109-text-model";
const providerDriver = "volcengine-ark";
const providerProfileId = "m109-provider-profile";
const providerModelId = "doubao-seed-2-0-lite-260428";
const modelConfigurationRevision = "m109-model-revision";

type Fixture = Readonly<{
  canvasId: string;
  candidateNodeIds: readonly string[];
  directory: string;
  failedPrerequisiteId: string;
  parentPlan: StoredWorkflowPlan;
  parentRunId: string;
  preservedNodeIds: readonly string[];
  unsafeNodeId: string;
}>;

function releaseFixture(): ModelReleaseRevision {
  const capability = "text" as const;
  const providerDriver = "volcengine-ark";
  const providerProtocol: ProviderProtocol = "native";
  const capabilitySchema = knownModelParameterSchema({
    capability,
    providerDriver,
    providerModelId,
  });
  const document = defaultModelReleaseDocument({
    capability,
    capabilitySchema,
    modelId,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  });
  const proof = inspectModelReleaseDocument(document);
  return Object.freeze({
    createdAt: "2026-09-01T00:00:00.000Z",
    document,
    hash: proof.documentHash,
    modelId,
    revisionId: "00000000-0000-4000-8109-000000000003",
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

function nodeId(index: number) {
  return `m109-n${String(index).padStart(2, "0")}`;
}

function buildGraph() {
  const nodes: WorkflowSemanticNode[] = [
    { id: groupId, type: "group", data: {} },
    ...Array.from({ length: 14 }, (_, index) => ({
      data: {
        textModelId: modelId,
        textParameters: {},
        textPrompt: `m109 prompt ${index}`,
        textPromptReady: true,
      },
      id: nodeId(index),
      parentId: groupId,
      type: "text",
    })),
  ];
  const edges: WorkflowSemanticEdge[] = [
    ...Array.from({ length: 11 }, (_, index) => ({
      data: { inputOrder: 1 },
      id: `m109-edge-${index}`,
      source: nodeId(index),
      target: nodeId(index + 1),
    })),
    {
      data: { inputOrder: 1 },
      id: "m109-edge-failed",
      source: nodeId(12),
      target: nodeId(13),
    },
  ];
  return { edges, nodes };
}

function storedPlanFromGraph(
  semantic: ReturnType<typeof compileFrozenWorkflowSemanticPlan>,
  release: ModelReleaseRevision,
): StoredWorkflowPlan {
  const nodes = semantic.nodes.map((node) => ({
    ...node,
    costCurrency: "CNY" as const,
    modelConfigurationRevision,
    modelReleaseRevision: release,
    providerDriver,
    providerModelId: release.document.providerModelId,
    providerProfileId: release.document.providerProfileId,
    providerProtocol: release.document.providerProtocol,
    recoveryEvidence: "m109 synthetic stored result",
    recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN" as const,
  }));
  return Object.freeze({
    clientSemanticFingerprint: semantic.semanticFingerprint,
    edges: semantic.edges,
    executableNodeIds: semantic.executableNodeIds,
    externalNodes: semantic.externalNodes.map((node) => ({
      id: node.id,
      type: node.kind,
      data: {
        ...(node.assetId ? { assetId: node.assetId } : {}),
        ...(node.content ? { content: node.content } : {}),
        ...(node.inputState ? { inputState: node.inputState } : {}),
      },
    })),
    groupId,
    nodes,
    semanticFingerprint: "wf1-m109-parent-plan",
    version: 1,
  });
}

function taskConfiguration(
  node: StoredWorkflowPlan["nodes"][number],
  inputKey: string,
  ownershipKey: string,
) {
  return {
    generationIdentityVersion: 2,
    generationInputKey: inputKey,
    generationOwnershipKey: ownershipKey,
    modelCapability: "text",
    modelConfigurationRevision,
    modelId,
    modelInputContractFingerprint: `m109-contract-${node.id}`,
    modelReleaseRevision: node.modelReleaseRevision,
    parameterSchema: node.modelReleaseRevision.document.capabilitySchema,
    providerDriver: node.providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol: node.providerProtocol,
    workflowBinding: {
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      groupId,
      modelConfigurationRevision,
      modelReleaseRevision: node.modelReleaseRevision.revisionId,
      reservationId: parentReservationId,
      runId: parentRunId,
    },
  } satisfies Record<string, unknown>;
}

async function withFixture(
  callback: (fixture: Fixture) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-m109-continuation-"));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const release = releaseFixture();
  const graph = buildGraph();
  const semantic = compileFrozenWorkflowSemanticPlan({
    edges: graph.edges,
    groupId,
    nodes: graph.nodes,
  });
  const baseParentPlan = storedPlanFromGraph(semantic, release);
  const parentPlan = Object.freeze({
    ...baseParentPlan,
    externalNodes: Object.freeze(semantic.externalNodes.map((node) => Object.freeze({
      data: Object.freeze({
        ...(node.assetId ? { assetId: node.assetId } : {}),
        ...(node.inputState ? { inputState: node.inputState } : {}),
      }),
      id: node.id,
      type: node.kind,
    }))),
  });
  const timestamp = new Date().toISOString();
  const database = openAppDatabase(directory);
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, 'm109-workflow', 'm109 workflow', 'safe-test', 'user', 'active', ?, ?)
  `).run(ownerId, timestamp, timestamp);
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_sequence
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, 0)
  `).run(
    ownerId,
    canvasId,
    JSON.stringify(graph.nodes),
    JSON.stringify(graph.edges),
    JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    timestamp,
  );
  database.prepare(`
    INSERT INTO workflow_runs (
      id, owner_id, canvas_id, group_id, graph_revision,
      semantic_fingerprint, plan_json, state, stop_requested,
      reservation_id, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, 'failed', 0, ?, 'GENERATION_FAILED',
      'm109 synthetic parent failure', ?, ?)
  `).run(
    parentRunId,
    ownerId,
    canvasId,
    groupId,
    parentPlan.semanticFingerprint,
    JSON.stringify(parentPlan),
    parentReservationId,
    timestamp,
    timestamp,
  );

  const seedStore = createGenerationTaskStore(directory, { recoverRunning: false });
  // The immutable plan is topologically ordered, not a copy of the Canvas
  // array.  Keep the fixture's intended ledger roles bound to explicit node
  // identities so an independent failed prerequisite can never shift the
  // preserved/candidate boundary.
  const preservedNodeIds = Array.from({ length: 9 }, (_, index) => nodeId(index));
  const candidateNodeIds = Array.from({ length: 3 }, (_, index) => nodeId(index + 9));
  const failedPrerequisiteId = nodeId(12);
  const unsafeNodeId = nodeId(13);
  const taskIds = new Map<string, string>();
  for (const node of parentPlan.nodes.filter(({ id }) => preservedNodeIds.includes(id))) {
    const inputKey = `m109-input-${node.id}`;
    const ownershipKey = `m109-owner-${node.id}`;
    const task = seedStore.create({
      canvasId,
      costCurrency: "CNY",
      idempotencyKey: `m109-parent-${node.id}`,
      kind: "text",
      model: modelId,
      modelConfiguration: taskConfiguration(node, inputKey, ownershipKey),
      nodeId: node.id,
      ownerId,
      parameters: {},
      prompt: node.ownPrompt,
      providerModelId,
      providerProfileId,
    }).task;
    seedStore.transition(task.id, "running");
    seedStore.complete(task.id, {
      actualCostMicrounits: 0,
      resultText: `m109 preserved result ${node.id}`,
    });
    taskIds.set(node.id, task.id);
  }
  for (const node of parentPlan.nodes) {
    const state = preservedNodeIds.includes(node.id)
      ? "success"
      : node.id === failedPrerequisiteId
        ? "failed"
        : "blocked";
    database.prepare(`
      INSERT INTO workflow_run_nodes (
        run_id, owner_id, node_id, kind, plan_index, dependencies_json,
        semantic_identity, idempotency_key, state, task_id,
        projection_state, error_code, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parentRunId,
      ownerId,
      node.id,
      node.kind,
      node.planIndex,
      JSON.stringify(node.dependencies),
      node.semanticIdentity,
      `m109-parent-${node.id}`,
      state,
      taskIds.get(node.id) ?? null,
      state === "success" ? "applied" : "pending",
      state === "failed" ? "GENERATION_FAILED" : state === "blocked" ? "UPSTREAM_FAILED" : null,
      state === "failed" ? "m109 failed prerequisite" : state === "blocked" ? "m109 blocked by failed prerequisite" : null,
      timestamp,
      timestamp,
    );
  }
  seedStore.close();
  database.close();

  const fixture: Fixture = Object.freeze({
    candidateNodeIds,
    canvasId,
    directory,
    failedPrerequisiteId,
    parentPlan,
    parentRunId,
    preservedNodeIds,
    unsafeNodeId,
  });
  try {
    await callback(fixture);
  } finally {
    // The continuation runner is kicked asynchronously after a successful
    // create. Reset its process singleton before switching disposable roots.
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      resetGenerationTaskStoreForRuntimeTest();
    } catch {
      // The callback may have failed before the singleton was initialized.
    }
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
}

type MediaExternalFixture = Readonly<{
  directory: string;
  mediaAssetId: string;
  parentRunId: string;
}>;

async function withMediaExternalFixture(
  callback: (fixture: MediaExternalFixture) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-m109-media-external-"));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = directory;
  const mediaAssetId = "m109-media-source";
  const mediaParentRunId = "00000000-0000-4000-8109-000000000004";
  const mediaCanvasId = "m109-media-canvas";
  const mediaNodeId = "m109-media-node";
  const release = releaseFixture();
  const graph = {
    edges: [{
      data: { inputOrder: 1, inputRole: "reference-image" },
      id: "m109-media-edge",
      source: mediaAssetId,
      target: mediaNodeId,
    }],
    nodes: [
      { id: groupId, type: "group", data: {} },
      {
        data: { assetId: mediaAssetId, inputState: "ready" },
        id: mediaAssetId,
        parentId: groupId,
        type: "image",
      },
      {
        data: {
          textModelId: modelId,
          textParameters: {},
          textPrompt: "m109 media continuation prompt",
          textPromptReady: true,
        },
        id: mediaNodeId,
        parentId: groupId,
        type: "text",
      },
    ],
  } satisfies {
    edges: WorkflowSemanticEdge[];
    nodes: WorkflowSemanticNode[];
  };
  const semantic = compileFrozenWorkflowSemanticPlan({
    edges: graph.edges,
    groupId,
    nodes: graph.nodes,
  });
  const parentPlan = storedPlanFromGraph(semantic, release);
  const timestamp = new Date().toISOString();
  const database = openAppDatabase(directory);
  const checksum = "a".repeat(64);
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, 'm109-media-workflow', 'm109 media workflow', 'safe-test', 'user', 'active', ?, ?)
  `).run(ownerId, timestamp, timestamp);
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_sequence
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, 0)
  `).run(
    ownerId,
    mediaCanvasId,
    JSON.stringify(graph.nodes),
    JSON.stringify(graph.edges),
    JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    timestamp,
  );
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, storage_profile_id, object_key, content_type,
      checksum_sha256, storage_status, duration_seconds, duration_source,
      duration_status, media_width, media_height
    ) VALUES ('image', ?, ?, 'm109-media-source.png', 10, ?, ?, 'local', NULL,
      'm109-media-source.png', 'image/png', ?, 'ready', NULL, NULL,
      'not-applicable', 100, 100)
  `).run(mediaAssetId, ownerId, timestamp, timestamp, checksum);
  database.prepare(`
    INSERT INTO workflow_runs (
      id, owner_id, canvas_id, group_id, graph_revision,
      semantic_fingerprint, plan_json, state, stop_requested,
      reservation_id, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, 'failed', 0, ?, 'GENERATION_FAILED',
      'm109 media parent failure', ?, ?)
  `).run(
    mediaParentRunId,
    ownerId,
    mediaCanvasId,
    groupId,
    parentPlan.semanticFingerprint,
    JSON.stringify(parentPlan),
    parentReservationId,
    timestamp,
    timestamp,
  );
  const node = parentPlan.nodes[0]!;
  database.prepare(`
    INSERT INTO workflow_run_nodes (
      run_id, owner_id, node_id, kind, plan_index, dependencies_json,
      semantic_identity, idempotency_key, state, task_id,
      projection_state, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'blocked', NULL, 'pending',
      'UPSTREAM_FAILED', 'm109 media source fixture', ?, ?)
  `).run(
    mediaParentRunId,
    ownerId,
    node.id,
    node.kind,
    node.planIndex,
    JSON.stringify(node.dependencies),
    node.semanticIdentity,
    "m109-media-parent-node",
    timestamp,
    timestamp,
  );
  database.close();
  const fixture = Object.freeze({
    directory,
    mediaAssetId,
    parentRunId: mediaParentRunId,
  });
  try {
    await callback(fixture);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      resetGenerationTaskStoreForRuntimeTest();
    } catch {
      // The callback may have failed before the singleton was initialized.
    }
    if (previousDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
}

test("R11 continuation rejects a same-asset media metadata replacement before creating a child", async () => {
  await withMediaExternalFixture(async (fixture) => {
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    expect(preview.externalInputs).toEqual([
      expect.objectContaining({
        kind: "image",
        sourceAssetByteSize: 10,
        sourceAssetContentType: "image/png",
        sourceAssetId: fixture.mediaAssetId,
        sourceAssetObjectKey: "m109-media-source.png",
        sourceAssetSha256: "a".repeat(64),
        sourceAssetStorageBackend: "local",
        sourceAssetStorageName: "m109-media-source.png",
        sourceAssetStorageProfileId: null,
      }),
    ]);

    const database = openAppDatabase(fixture.directory);
    database.prepare(`
      UPDATE media_assets
      SET byte_size = 11, checksum_sha256 = ?, object_key = ?
      WHERE owner_id = ? AND kind = 'image' AND id = ?
    `).run("b".repeat(64), "m109-media-source-replaced.png", ownerId, fixture.mediaAssetId);
    database.close();

    await expect(continueWorkflowRun({
      intentId: "m109-media-identity-replaced",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    })).rejects.toMatchObject({ code: "WORKFLOW_CONTINUATION_PREVIEW_STALE" });

    const after = openAppDatabase(fixture.directory);
    expect(after.prepare(`
      SELECT COUNT(*) AS count FROM workflow_run_continuations
      WHERE owner_id = ? AND parent_run_id = ?
    `).get(ownerId, fixture.parentRunId)).toEqual({ count: 0 });
    expect(after.prepare(`
      SELECT COUNT(*) AS count FROM workflow_runs
      WHERE owner_id = ? AND id != ?
    `).get(ownerId, fixture.parentRunId)).toEqual({ count: 0 });
    expect(after.prepare(`
      SELECT COUNT(*) AS count FROM generation_provider_attempts
      WHERE task_id IN (SELECT task_id FROM workflow_run_nodes WHERE run_id = ?)
    `).get(fixture.parentRunId)).toEqual({ count: 0 });
    // An already frozen parent must reject even a freshly requested preview;
    // it may not silently adopt replacement bytes under the same asset id.
    const parent = after.prepare("SELECT plan_json FROM workflow_runs WHERE id = ?")
      .get(fixture.parentRunId) as { plan_json: string };
    const frozenPlan = JSON.parse(parent.plan_json);
    Object.assign(frozenPlan.externalNodes[0].data, {
      sourceAssetByteSize: 10,
      sourceAssetContentType: "image/png",
      sourceAssetObjectKey: "m109-media-source.png",
      sourceAssetSha256: "a".repeat(64),
      sourceAssetStorageBackend: "local",
      sourceAssetStorageName: "m109-media-source.png",
      sourceAssetStorageProfileId: null,
    });
    after.prepare("UPDATE workflow_runs SET plan_json = ? WHERE id = ?")
      .run(JSON.stringify(frozenPlan), fixture.parentRunId);
    after.close();
    expect(() => getWorkflowContinuationPreview(ownerId, fixture.parentRunId))
      .toThrow("上游结果暂时无法安全读取");
  });
});

function readParentLedger(directory: string) {
  const database = openAppDatabase(directory);
  const run = database.prepare(`
    SELECT state, graph_revision, semantic_fingerprint FROM workflow_runs WHERE id = ?
  `).get(parentRunId);
  const nodes = database.prepare(`
    SELECT node_id, state, task_id, projection_state
    FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
  `).all(parentRunId);
  database.close();
  return { nodes, run };
}

function readChildLedger(
  directory: string,
  childRunId: string,
  preservedNodeIds: readonly string[],
) {
  const database = openAppDatabase(directory);
  const run = database.prepare(`
    SELECT state, graph_revision, semantic_fingerprint FROM workflow_runs WHERE id = ?
  `).get(childRunId);
  const nodes = database.prepare(`
    SELECT node_id, state, task_id FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
  `).all(childRunId);
  const relation = database.prepare(`
    SELECT parent_run_id, child_run_id, intent_id, preview_digest,
           selected_node_ids_json, frozen_external_inputs_json
    FROM workflow_run_continuations WHERE parent_run_id = ?
  `).get(parentRunId);
  const preservedAttempts = database.prepare(`
    SELECT COUNT(*) AS count FROM generation_provider_attempts AS attempt
    JOIN generation_tasks AS task ON task.id = attempt.task_id
    WHERE task.canvas_id = ? AND task.node_id IN (${preservedNodeIds.map(() => "?").join(",")})
  `).get(canvasId, ...preservedNodeIds);
  database.close();
  return { nodes, preservedAttempts, relation, run };
}

test("R11 continuation preview freezes nine successful nodes and selects only the safe DAG frontier", async () => {
  await withFixture(async (fixture) => {
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    expect(preview.parentState).toBe("failed");
    expect(preview.preservedNodeIds).toEqual(fixture.preservedNodeIds);
    expect(preview.candidateNodeIds).toEqual(fixture.candidateNodeIds);
    expect(preview.blockedNodeIds).toContain(fixture.unsafeNodeId);
    expect(preview.blockedNodeIds).not.toContain(fixture.failedPrerequisiteId);
    expect(preview.externalInputs).toHaveLength(1);
    expect(new Set(preview.externalInputs.map(({ nodeId }) => nodeId))).toEqual(
      new Set([nodeId(8)]),
    );
    expect(preview.requiresUserIntent).toBe(true);
    expect(getWorkflowContinuation(ownerId, fixture.parentRunId).continuation).toBeNull();
    expect(readParentLedger(fixture.directory).run).toMatchObject({
      state: "failed",
      graph_revision: 1,
      semantic_fingerprint: fixture.parentPlan.semanticFingerprint,
    });
  });
});

test("R11 continuation creation is durable and idempotent across a second tab and refresh", async () => {
  await withFixture(async (fixture) => {
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    const first = await continueWorkflowRun({
      intentId: "m109-intent-double-click",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    });
    // The runner is deliberately asynchronous. Let it link any selected
    // tasks, then inspect the durable successor relation and old ledger.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await continueWorkflowRun({
      intentId: "m109-intent-double-click",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    });
    const refreshed = getWorkflowContinuation(ownerId, fixture.parentRunId).continuation;
    expect(first.continuation.childRunId).toBe(second.continuation.childRunId);
    expect(first.continuation.continuationId).toBe(second.continuation.continuationId);
    expect(refreshed?.childRunId).toBe(first.continuation.childRunId);
    const child = readChildLedger(
      fixture.directory,
      first.continuation.childRunId,
      fixture.preservedNodeIds,
    );
    expect(child.relation).toMatchObject({
      parent_run_id: fixture.parentRunId,
      child_run_id: first.continuation.childRunId,
      intent_id: "m109-intent-double-click",
      preview_digest: preview.previewDigest,
    });
    expect(JSON.parse(String(child.relation?.selected_node_ids_json))).toEqual(
      fixture.candidateNodeIds,
    );
    const childNodeIds = (child.nodes as Array<{ node_id: string }>).map(({ node_id }) => node_id);
    expect(childNodeIds).toEqual(fixture.candidateNodeIds);
    expect(child.preservedAttempts).toEqual({ count: 0 });
    expect(readParentLedger(fixture.directory).run).toMatchObject({ state: "failed" });
  });
});

test("R11 an existing successor replays before capacity or Canvas rechecks", async () => {
  await withFixture(async (fixture) => {
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    const first = await continueWorkflowRun({
      intentId: "m109-intent-replay-before-gates",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    });

    // These changes would make a fresh admission unsafe: the saved graph no
    // longer matches the parent and the capacity budget is occupied.  A
    // durable relation with the same preview digest must still replay the
    // already-created child without rebuilding or reserving anything.
    const database = openAppDatabase(fixture.directory);
    const timestamp = new Date().toISOString();
    database.prepare(`
      UPDATE canvas_documents SET graph_revision = 2
      WHERE owner_id = ? AND id = ?
    `).run(ownerId, fixture.canvasId);
    database.prepare(`
      INSERT INTO workflow_runs (
        id, owner_id, canvas_id, group_id, graph_revision,
        semantic_fingerprint, plan_json, state, stop_requested,
        created_at, updated_at
      ) VALUES ('m109-replay-capacity-run', ?, ?, 'm109-replay-capacity-group', 2,
        'm109-replay-capacity', '{"version":1}', 'running', 0, ?, ?)
    `).run(ownerId, fixture.canvasId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO media_capacity_reservations (
        id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
        created_at, updated_at
      ) VALUES ('m109-replay-capacity-reservation', ?, 'm109-replay-capacity-run',
        2147483648, 'active', ?, ?, ?)
    `).run(
      ownerId,
      new Date(Date.now() + 60_000).toISOString(),
      timestamp,
      timestamp,
    );
    database.close();

    const replay = await continueWorkflowRun({
      intentId: "m109-intent-replay-before-gates",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    });
    expect(replay.continuation.childRunId).toBe(first.continuation.childRunId);
    expect(replay.continuation.continuationId).toBe(first.continuation.continuationId);

    await expect(continueWorkflowRun({
      intentId: "m109-intent-replay-before-gates-wrong-preview",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: `${preview.previewDigest}x`,
    })).rejects.toMatchObject({ code: "WORKFLOW_CONTINUATION_PREVIEW_CONFLICT" });
  });
});

test("R11 successor plan keeps chained candidates executable and frozen upstream external", async () => {
  await withFixture(async (fixture) => {
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    const created = await continueWorkflowRun({
      intentId: "m109-intent-plan-separation",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    });
    const database = openAppDatabase(fixture.directory);
    const row = database.prepare(
      "SELECT plan_json FROM workflow_runs WHERE id = ?",
    ).get(created.continuation.childRunId) as { plan_json: string };
    database.close();
    const childPlan = JSON.parse(row.plan_json) as {
      edges: Array<{ source: string; target: string }>;
      executableNodeIds: string[];
      externalNodes: Array<{ id: string }>;
      nodes: Array<{ id: string; dependencies: string[] }>;
    };
    expect(childPlan.executableNodeIds).toEqual(fixture.candidateNodeIds);
    expect(childPlan.nodes.map(({ id }) => id)).toEqual(fixture.candidateNodeIds);
    expect(childPlan.externalNodes.map(({ id }) => id)).toEqual([nodeId(8)]);
    expect(childPlan.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: fixture.preservedNodeIds[fixture.preservedNodeIds.length - 1],
        target: fixture.candidateNodeIds[0],
      }),
      expect.objectContaining({
        source: fixture.candidateNodeIds[0],
        target: fixture.candidateNodeIds[1],
      }),
      expect.objectContaining({
        source: fixture.candidateNodeIds[1],
        target: fixture.candidateNodeIds[2],
      }),
    ]));
    expect(childPlan.nodes[1]?.dependencies).toEqual([fixture.candidateNodeIds[0]]);
    expect(childPlan.nodes[2]?.dependencies).toEqual([fixture.candidateNodeIds[1]]);
  });
});

test("R12 changed canvas input is rejected before successor creation and leaves the failed parent immutable", async () => {
  await withFixture(async (fixture) => {
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    const database = openAppDatabase(fixture.directory);
    database.prepare(`
      UPDATE canvas_documents SET graph_revision = 2 WHERE owner_id = ? AND id = ?
    `).run(ownerId, fixture.canvasId);
    database.close();
    await expect(continueWorkflowRun({
      intentId: "m109-intent-changed-input",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    })).rejects.toMatchObject({
      code: "WORKFLOW_CONTINUATION_GRAPH_CHANGED",
    });
    const after = readParentLedger(fixture.directory);
    expect(after.run).toMatchObject({ state: "failed", graph_revision: 1 });
    expect(after.nodes).toHaveLength(fixture.parentPlan.nodes.length);
    expect(getWorkflowContinuation(ownerId, fixture.parentRunId).continuation).toBeNull();
  });
});

test("R12 active node competition and unknown outcome block continuation without a second paid boundary", async () => {
  await withFixture(async (fixture) => {
    const seedStore = createGenerationTaskStore(fixture.directory, { recoverRunning: false });
    const candidate = fixture.parentPlan.nodes.find(({ id }) => id === fixture.candidateNodeIds[0])!;
    const unresolved = seedStore.create({
      canvasId: fixture.canvasId,
      idempotencyKey: "m109-unresolved-candidate",
      kind: "text",
      model: modelId,
      modelConfiguration: taskConfiguration(candidate, "m109-unresolved-input", "m109-unresolved-owner"),
      nodeId: candidate.id,
      ownerId,
      prompt: candidate.ownPrompt,
      providerModelId,
      providerProfileId,
    }).task;
    seedStore.transition(unresolved.id, "running");
    seedStore.transition(unresolved.id, "failed", {
      code: "OUTCOME_UNKNOWN_BILLING_RISK",
      message: "m109 outcome remains unknown",
    });
    seedStore.close();
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    await expect(continueWorkflowRun({
      intentId: "m109-intent-unknown-outcome",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    })).rejects.toMatchObject({ code: "WORKFLOW_CONTINUATION_NODE_UNRESOLVED" });
    expect(getWorkflowContinuation(ownerId, fixture.parentRunId).continuation).toBeNull();

    const database = openAppDatabase(fixture.directory);
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO workflow_runs (
        id, owner_id, canvas_id, group_id, graph_revision,
        semantic_fingerprint, plan_json, state, stop_requested,
        created_at, updated_at
      ) VALUES ('m109-active-run', ?, ?, ?, 1, 'm109-active',
        '{"version":1}', 'running', 0, ?, ?)
    `).run(ownerId, fixture.canvasId, groupId, timestamp, timestamp);
    database.close();
    // The unresolved task is intentionally removed only from this disposable
    // fixture after the first gate; the active-group gate is independently
    // checked against the same immutable parent.
    const clean = openAppDatabase(fixture.directory);
    clean.prepare("DELETE FROM generation_tasks WHERE id = ?").run(unresolved.id);
    clean.close();
    const secondPreview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    await expect(continueWorkflowRun({
      intentId: "m109-intent-active-group",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: secondPreview.previewDigest,
    })).rejects.toMatchObject({ code: "WORKFLOW_CONTINUATION_ACTIVE_CONFLICT" });
    expect(getWorkflowContinuation(ownerId, fixture.parentRunId).continuation).toBeNull();
  });
});

test("R12 capacity reservation failure is fail-closed and does not create a successor or Provider attempt", async () => {
  await withFixture(async (fixture) => {
    const database = openAppDatabase(fixture.directory);
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO workflow_runs (
        id, owner_id, canvas_id, group_id, graph_revision,
        semantic_fingerprint, plan_json, state, stop_requested,
        created_at, updated_at
      ) VALUES ('m109-capacity-run', ?, ?, 'm109-capacity-group', 1,
        'm109-capacity', '{"version":1}', 'running', 0, ?, ?)
    `).run(ownerId, fixture.canvasId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO media_capacity_reservations (
        id, owner_id, workflow_run_id, reserved_bytes, state, expires_at,
        created_at, updated_at
      ) VALUES ('m109-capacity-reservation', ?, 'm109-capacity-run',
        2147483648, 'active', ?, ?, ?)
    `).run(
      ownerId,
      new Date(Date.now() + 60_000).toISOString(),
      timestamp,
      timestamp,
    );
    database.close();
    const preview = getWorkflowContinuationPreview(ownerId, fixture.parentRunId);
    await expect(continueWorkflowRun({
      intentId: "m109-intent-capacity",
      ownerId,
      parentRunId: fixture.parentRunId,
      previewDigest: preview.previewDigest,
    })).rejects.toMatchObject({ code: "RESOURCE_BUSY" });
    expect(getWorkflowContinuation(ownerId, fixture.parentRunId).continuation).toBeNull();
    expect(readParentLedger(fixture.directory).run).toMatchObject({ state: "failed" });
  });
});

test("R13 continuation panel retries transient read-only status and clears stale previews after a fence failure", async () => {
  const source = await readFile(
    new URL("../client/src/canvas/GenerationTasksPanel.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("workflowRunStatusReadIsRetryable");
  expect(source).toContain("continuationReadRetryDelaysMs");
  expect(source).toContain("continuationReadRecheckDelayMs");
  expect(source).toContain("setContinuationPreviewRetryTick");
  expect(source).toContain("系统会自动再试");
  expect(source).toContain("Drop it so the next");
  // A continuation POST is followed by a read-only refresh path; the panel
  // never turns a lost response into a second POST by itself.
  const submitStart = source.indexOf("const continueWorkflowRun =");
  const submitBody = source.slice(submitStart);
  expect(submitBody).toContain("workflowExecution.continueFailedWorkflow");
  expect(submitBody).toContain("setContinuationPreviewRetryTick");
  expect(submitBody.slice(submitBody.indexOf(".catch"))).toContain(
    "setContinuationPreviews",
  );
});

test("R10 adoption projection reads a newly settled task from the caller transaction", async () => {
  await withFixture(async (fixture) => {
    const database = openAppDatabase(fixture.directory);
    const taskId = database.prepare(`
      SELECT task_id FROM workflow_run_nodes
      WHERE run_id = ? AND node_id = ?
    `).get(fixture.parentRunId, fixture.preservedNodeIds[0]) as { task_id: string };
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        UPDATE generation_tasks
        SET state = 'success', result_text = 'settled in this transaction'
        WHERE id = ?
      `).run(taskId.task_id);
      const settled = readGenerationTaskInTransaction(database, taskId.task_id);
      expect(settled).toMatchObject({
        id: taskId.task_id,
        state: "success",
        resultText: "settled in this transaction",
      });
      database.exec("ROLLBACK");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }
  });
});
