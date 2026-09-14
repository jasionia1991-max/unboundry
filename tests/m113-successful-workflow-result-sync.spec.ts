import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { resolvePersistedNodeInputs } from "../server/inputPreflight";
import {
  buildCanvasProjectionIdentity,
} from "../server/generationCanvasProjection";
import {
  assertWorkflowContinuationSourcesForRuntimeTest,
  continueWorkflowRun,
  inspectHistoricalWorkflowResultSyncInTransaction,
  syncHistoricalWorkflowResultInTransaction,
  getWorkflowRun,
  getWorkflowContinuationPreview,
  type HistoricalWorkflowResultSyncInput,
} from "../server/workflowRunService";
import { setGenerationProjectionReceiptFaultForTests } from
  "../server/canvasMutationGateway";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { inspectModelReleaseDocument } from "../server/modelReleaseRevisionStore";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";
import {
  knownModelParameterSchema,
  submissionParameterValues,
} from "../types/modelParameters";
import {
  compileFrozenWorkflowSemanticPlan,
  type WorkflowSemanticEdge,
  type WorkflowSemanticNode,
} from "../types/workflowSemanticPlan";
import {
  parseWorkflowContinuationPreview,
  type StoredWorkflowPlan,
} from "../types/workflowRuns";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";

const ownerId = "m113-sync-owner";
const canvasId = "m113-sync-canvas";
const groupId = "m113-sync-group";
const runId = "m113-sync-failed-run";
const reservationId = "m113-sync-reservation";
const nodeId = "m113-sync-video-node";
const downstreamNodeId = "m113-sync-downstream-node";
const taskId = "m113-sync-video-task";
const providerTaskId = "m113-sync-provider-task";
const assetId = "m113-sync-video-asset";
const publicationAttemptId = "m113-sync-publication";
const videoModelId = "m113-sync-video-model";
const textModelId = "m113-sync-text-model";
const videoProfileId = "m113-sync-video-profile";
const textProfileId = "m113-sync-text-profile";
const videoModelConfigurationRevision = "m113-sync-video-configuration";
const textModelConfigurationRevision = "m113-sync-text-configuration";
const baseTime = "2026-09-13T00:00:00.000Z";
const checksum = createHash("sha256").update("m113-video-bytes").digest("hex");

type Fixture = Readonly<{
  database: DatabaseSync;
  directory: string;
  input: HistoricalWorkflowResultSyncInput;
  graphNodes: WorkflowSemanticNode[];
  plan: ReturnType<typeof compileFrozenWorkflowSemanticPlan>;
}>;

function releaseFixture(input: Readonly<{
  capability: "text" | "video";
  modelId: string;
  providerModelId: string;
  providerProfileId: string;
  revisionId: string;
}>): ModelReleaseRevision {
  const providerDriver = "volcengine-ark";
  const providerProtocol = "native" as const;
  const capabilitySchema = knownModelParameterSchema({
    capability: input.capability,
    providerDriver,
    providerModelId: input.providerModelId,
  });
  const document = defaultModelReleaseDocument({
    capability: input.capability,
    capabilitySchema,
    modelId: input.modelId,
    providerDriver,
    providerModelId: input.providerModelId,
    providerProfileId: input.providerProfileId,
    providerProtocol,
  });
  const proof = inspectModelReleaseDocument(document);
  return Object.freeze({
    createdAt: baseTime,
    document,
    hash: proof.documentHash,
    modelId: input.modelId,
    revisionId: input.revisionId,
    revisionNumber: 1,
    validation: Object.freeze({
      compilerHash: proof.compilerHash,
      impact: Object.freeze({
        incompatibleTemplateIds: Object.freeze([]),
        templateIds: Object.freeze([]),
      }),
      paidProviderRequests: 0,
      preview: Object.freeze({ modes: Object.freeze([]) }),
      validatedAt: baseTime,
    }),
  });
}

function seedFixture(database: DatabaseSync) {
  const videoRelease = releaseFixture({
    capability: "video",
    modelId: videoModelId,
    providerModelId: "doubao-seedance-2-0-mini-260615",
    providerProfileId: videoProfileId,
    revisionId: "00000000-0000-4113-8113-000000000001",
  });
  const textRelease = releaseFixture({
    capability: "text",
    modelId: textModelId,
    providerModelId: "doubao-seed-2-0-lite-260428",
    providerProfileId: textProfileId,
    revisionId: "00000000-0000-4113-8113-000000000002",
  });
  const graphNodes: WorkflowSemanticNode[] = [
    { data: {}, id: groupId, type: "group" },
    {
      data: {
        videoModelId,
        videoParameters: {},
        videoPrompt: "m113 historical video prompt",
        videoPromptReady: true,
      },
      id: nodeId,
      parentId: groupId,
      type: "video",
    },
    {
      data: {
        textModelId,
        textParameters: {},
        textPrompt: "m113 downstream prompt",
        textPromptReady: true,
      },
      id: downstreamNodeId,
      parentId: groupId,
      type: "text",
    },
  ];
  const graphEdges: WorkflowSemanticEdge[] = [{
    data: { inputOrder: 1 },
    id: "m113-video-to-text",
    source: nodeId,
    target: downstreamNodeId,
  }];
  const semantic = compileFrozenWorkflowSemanticPlan({
    edges: graphEdges,
    groupId,
    nodes: graphNodes,
  });
  const videoPlan = semantic.nodes.find(({ id }) => id === nodeId)!;
  const textPlan = semantic.nodes.find(({ id }) => id === downstreamNodeId)!;
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-test', 'user', 'active', ?, ?)
  `).run(ownerId, ownerId, ownerId, baseTime, baseTime);
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_session_id, save_sequence
    ) VALUES (?, ?, 1, 7, ?, ?, ?, ?, NULL, 0)
  `).run(
    ownerId,
    canvasId,
    JSON.stringify(graphNodes),
    JSON.stringify(graphEdges),
    JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    baseTime,
  );

  const persisted = resolvePersistedNodeInputs({
    bypass: false,
    canvasId,
    database,
    modelReleaseRevision: videoRelease.revisionId,
    modelSchema: videoRelease.document.capabilitySchema,
    ownerId,
    parameters: {},
    targetId: nodeId,
    targetKind: "video",
  });
  if (!persisted.contractFingerprint) {
    throw new Error("m113 fixture video contract fingerprint is missing");
  }
  const parameters = submissionParameterValues(
    videoRelease.document.capabilitySchema,
    persisted.normalizedParameters ?? {},
  );
  const inputKey = generationInputKey({
    inputs: persisted.inputs,
    modelConfigurationRevision: videoModelConfigurationRevision,
    modelId: videoModelId,
    modelReleaseRevision: videoRelease.revisionId,
    ownPrompt: persisted.persistedOwnPrompt,
    parameters,
    prompt: persisted.finalPrompt,
  });
  const ownershipKey = generationOwnershipKey(generationOwnershipEvidence({
    contractFingerprint: persisted.contractFingerprint,
    inputs: persisted.inputs,
    kind: "video",
    modelConfigurationRevision: videoModelConfigurationRevision,
    modelId: videoModelId,
    modelReleaseRevision: videoRelease.revisionId,
    parameters,
    prompt: persisted.persistedOwnPrompt,
  }));
  const planNodes = [
    {
      ...videoPlan,
      costCurrency: "USD" as const,
      modelConfigurationRevision: videoModelConfigurationRevision,
      modelReleaseRevision: videoRelease,
      providerDriver: "volcengine-ark",
      providerModelId: videoRelease.document.providerModelId,
      providerProfileId: videoRelease.document.providerProfileId,
      providerProtocol: videoRelease.document.providerProtocol,
      recoveryEvidence: "m113 historical sync fixture",
      recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN" as const,
    },
    {
      ...textPlan,
      costCurrency: "USD" as const,
      modelConfigurationRevision: textModelConfigurationRevision,
      modelReleaseRevision: textRelease,
      providerDriver: "volcengine-ark",
      providerModelId: textRelease.document.providerModelId,
      providerProfileId: textRelease.document.providerProfileId,
      providerProtocol: textRelease.document.providerProtocol,
      recoveryEvidence: "m113 downstream fixture",
      recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN" as const,
    },
  ];
  const plan = {
    clientSemanticFingerprint: semantic.semanticFingerprint,
    edges: semantic.edges,
    executableNodeIds: semantic.executableNodeIds,
    externalNodes: [],
    groupId,
    nodes: planNodes,
    semanticFingerprint: semantic.semanticFingerprint,
    version: 1 as const,
  };
  const configuration = {
    credentialVersion: 1,
    generationIdentityVersion: 2,
    generationInputKey: inputKey,
    generationOwnershipKey: ownershipKey,
    modelCapability: "video",
    modelConfigurationRevision: videoModelConfigurationRevision,
    modelId: videoModelId,
    modelInputContractFingerprint: persisted.contractFingerprint,
    modelReleaseRevision: videoRelease,
    modelResultCount: 1,
    parameterSchema: videoRelease.document.capabilitySchema,
    providerDriver: "volcengine-ark",
    providerModelId: videoRelease.document.providerModelId,
    providerProfileId: videoRelease.document.providerProfileId,
    providerProtocol: videoRelease.document.providerProtocol,
    workflowBinding: {
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      groupId,
      modelConfigurationRevision: videoModelConfigurationRevision,
      modelReleaseRevision: videoRelease.revisionId,
      reservationId,
      runId,
    },
  };
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, model, parameters,
      idempotency_key, request_fingerprint, state, attempt, error_code,
      error_message, created_at, updated_at, owner_id, provider_profile_id,
      provider_model_id, result_asset_id, cost_currency, provider_task_id,
      provider_usage_tokens, model_configuration, result_text, credential_revision
    ) VALUES (?, ?, ?, 'video', ?, ?, ?, ?, ?, 'success', 1, NULL, NULL,
      ?, ?, ?, ?, ?, ?, 'USD', ?, 0, ?, NULL, 1)
  `).run(
    taskId,
    canvasId,
    nodeId,
    persisted.finalPrompt,
    videoModelId,
    JSON.stringify(parameters),
    "m113-video-idempotency",
    "intent-v3:m113-video-request",
    baseTime,
    baseTime,
    ownerId,
    videoProfileId,
    videoRelease.document.providerModelId,
    assetId,
    providerTaskId,
    JSON.stringify(configuration),
  );
  database.prepare(`
    INSERT INTO generation_task_events (task_id, state, created_at)
    VALUES (?, 'success', ?)
  `).run(taskId, baseTime);
  database.prepare(`
    INSERT INTO generation_provider_attempts (
      task_id, execution_attempt, provider_profile_id, provider_model_id,
      kind, evidence, created_at, owner_id, credential_revision, outcome,
      provider_task_id, failure_code, finished_at
    ) VALUES (?, 1, ?, ?, 'video', 'provider-boundary', ?, ?, 1,
      'completed', ?, NULL, ?)
  `).run(
    taskId,
    videoProfileId,
    videoRelease.document.providerModelId,
    baseTime,
    ownerId,
    providerTaskId,
    baseTime,
  );
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, storage_profile_id, object_key, content_type,
      checksum_sha256, storage_status, duration_seconds, duration_source,
      duration_status, media_width, media_height
    ) VALUES ('video', ?, ?, ?, 16, ?, ?, 'local', NULL, ?, 'video/mp4', ?,
      'ready', 5, 'provider-task', 'ready', 640, 360)
  `).run(
    assetId,
    ownerId,
    `${assetId}.mp4`,
    baseTime,
    baseTime,
    `${assetId}.mp4`,
    checksum,
  );
  database.prepare(`
    INSERT INTO media_publication_attempts (
      attempt_id, owner_id, kind, asset_id, source, state, storage_backend,
      final_storage_name, object_key, staging_name, task_id,
      task_execution_attempt, output_slot, output_set_count, history_label,
      byte_size, checksum_sha256, content_type, duration_seconds,
      duration_source, media_width, media_height, error_code, retry_count,
      adopted_at, adopted_canvas_id, created_at, updated_at
    ) VALUES (?, ?, 'video', ?, 'generation', 'published', 'local', ?, ?, ?,
      ?, 1, 0, 1, 'm113 single-output historical result', 16, ?, 'video/mp4',
      5, 'provider-task', 640, 360, NULL, 0, NULL, NULL, ?, ?)
  `).run(
    publicationAttemptId,
    ownerId,
    assetId,
    `${assetId}.mp4`,
    `${assetId}.mp4`,
    `.m113-${assetId}.staging`,
    taskId,
    checksum,
    baseTime,
    baseTime,
  );
  database.prepare(`
    INSERT INTO workflow_runs (
      id, owner_id, canvas_id, group_id, graph_revision,
      semantic_fingerprint, plan_json, state, stop_requested,
      reservation_id, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 7, ?, ?, 'failed', 0, ?, 'GENERATION_FAILED',
      'm113 historical failed run', ?, ?)
  `).run(
    runId,
    ownerId,
    canvasId,
    groupId,
    plan.semanticFingerprint,
    JSON.stringify(plan),
    reservationId,
    baseTime,
    baseTime,
  );
  database.prepare(`
    INSERT INTO workflow_run_nodes (
      run_id, owner_id, node_id, kind, plan_index, dependencies_json,
      semantic_identity, idempotency_key, state, task_id,
      projection_state, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, 'video', 0, ?, ?, 'm113-video-idempotency', 'failed', ?,
      'pending', 'GENERATION_FAILED', 'm113 historical failed node', ?, ?)
  `).run(
    runId,
    ownerId,
    nodeId,
    JSON.stringify(videoPlan.dependencies),
    videoPlan.semanticIdentity,
    taskId,
    baseTime,
    baseTime,
  );
  database.prepare(`
    INSERT INTO workflow_run_nodes (
      run_id, owner_id, node_id, kind, plan_index, dependencies_json,
      semantic_identity, idempotency_key, state, task_id,
      projection_state, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, 'text', 1, ?, ?, 'm113-downstream-idempotency', 'pending',
      NULL, 'pending', NULL, NULL, ?, ?)
  `).run(
    runId,
    ownerId,
    downstreamNodeId,
    JSON.stringify(textPlan.dependencies),
    textPlan.semanticIdentity,
    baseTime,
    baseTime,
  );
  return {
    graphNodes,
    input: {
      canvasId,
      executionAttempt: 1,
      nodeId,
      ownerId,
      runId,
      taskId,
    },
    plan: semantic,
  };
}

async function withFixture(callback: (fixture: Fixture) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "unboundry-m113-sync-"));
  const database = openAppDatabase(directory);
  try {
    const seeded = seedFixture(database);
    await callback({ database, directory, ...seeded });
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    await rm(directory, { force: true, recursive: true });
  }
}

function runInTransaction(
  database: DatabaseSync,
  callback: () => void,
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    callback();
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

test("historical video sync is narrow, idempotent, and leaves the failed ledger immutable", async () => {
  await withFixture(async ({ database, input }) => {
    runInTransaction(database, () => {
      const before = database.prepare(`
        SELECT state, task_id, projection_state, error_code
        FROM workflow_run_nodes WHERE run_id = ? AND node_id = ?
      `).get(runId, nodeId);
      expect(inspectHistoricalWorkflowResultSyncInTransaction(database, input)).toMatchObject({
        status: "ready",
        operationId: expect.stringMatching(/^server-projection:[0-9a-f]{64}$/),
        payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM canvas_operation_receipts",
      ).get()).toEqual({ count: 0 });
      const first = syncHistoricalWorkflowResultInTransaction(database, input);
      expect(first).toMatchObject({ status: "applied" });
      const receipt = database.prepare(`
        SELECT operation_id, payload_sha256, command_type, actor_type,
               outcome, conflict_code, http_status
        FROM canvas_operation_receipts
      `).get();
      expect(receipt).toMatchObject({
        actor_type: "server",
        command_type: "server.projection",
        conflict_code: null,
        http_status: 200,
        outcome: expect.stringMatching(/^(APPLIED|NO_OP)$/),
        operation_id: first.operationId,
        payload_sha256: first.payloadSha256,
      });
      expect(database.prepare(`
        SELECT state, task_id, projection_state, error_code
        FROM workflow_run_nodes WHERE run_id = ? AND node_id = ?
      `).get(runId, nodeId)).toEqual(before);
      expect(database.prepare(
        "SELECT state, result_asset_id, attempt FROM generation_tasks WHERE id = ?",
      ).get(taskId)).toEqual({ attempt: 1, result_asset_id: assetId, state: "success" });
      const replay = syncHistoricalWorkflowResultInTransaction(database, input);
      expect(replay).toMatchObject({
        status: "already-synced",
        operationId: first.operationId,
        payloadSha256: first.payloadSha256,
      });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM canvas_operation_receipts",
      ).get()).toEqual({ count: 1 });
    });
  });
});

test("historical sync rejects extra unmapped output and deletion quarantine", async () => {
  await withFixture(async ({ database, input }) => {
    runInTransaction(database, () => {
      database.prepare("UPDATE generation_provider_attempts SET evidence = 'historical-execution-attempt' WHERE task_id = ?").run(taskId);
      expect(inspectHistoricalWorkflowResultSyncInTransaction(database, input).status).toBe("insufficient-evidence");
      expect(database.prepare("SELECT COUNT(*) AS count FROM canvas_operation_receipts").get()).toEqual({ count: 0 });
    });
  });
  await withFixture(async ({ database, input }) => {
    runInTransaction(database, () => {
      database.prepare(`
        INSERT INTO media_publication_attempts (
          attempt_id, owner_id, kind, asset_id, source, state, storage_backend,
          final_storage_name, object_key, staging_name, task_id,
          task_execution_attempt, output_slot, output_set_count, history_label,
          byte_size, content_type,
          error_code, retry_count, created_at, updated_at
        ) VALUES ('m113-unmapped-publication', ?, 'video',
          'm113-missing-asset', 'generation', 'failed', 'local',
          'm113-missing.mp4', 'm113-missing.mp4', '.m113-missing.staging',
          ?, 1, 1, 2, 'm113 unmapped output', 0, 'video/mp4',
          'MEDIA_RECOVERY_EVIDENCE_MISSING', 0, ?, ?)
      `).run(ownerId, taskId, baseTime, baseTime);
      expect(inspectHistoricalWorkflowResultSyncInTransaction(database, input)).toMatchObject({
        status: "insufficient-evidence",
        reason: "成功任务尚未通过完整工作流身份核验",
      });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM canvas_operation_receipts",
      ).get()).toEqual({ count: 0 });
    });
  });

  await withFixture(async ({ database, input }) => {
    runInTransaction(database, () => {
      database.prepare(`
        INSERT INTO media_delete_intents (
          owner_id, kind, asset_id, state, created_at, updated_at
        ) VALUES (?, 'video', ?, 'tombstone', ?, ?)
      `).run(ownerId, assetId, baseTime, baseTime);
      expect(inspectHistoricalWorkflowResultSyncInTransaction(database, input)).toMatchObject({
        status: "insufficient-evidence",
        reason: "成功任务尚未通过完整工作流身份核验",
      });
    });
  });
});

test("historical sync preserves a user edit or deletion and rejects a forged receipt", async () => {
  await withFixture(async ({ database, input }) => {
    runInTransaction(database, () => {
      const first = syncHistoricalWorkflowResultInTransaction(database, input);
      expect(first.status).toBe("applied");
      const changedNodes = database.prepare(
        "SELECT nodes FROM canvas_documents WHERE owner_id = ? AND id = ?",
      ).get(ownerId, canvasId) as { nodes: string };
      const edited = JSON.parse(changedNodes.nodes) as Array<{ id: string; data?: Record<string, unknown> }>;
      const editedNode = edited.find((node) => node.id === nodeId)!;
      editedNode.data = { ...(editedNode.data ?? {}), videoPrompt: "user edited after sync" };
      database.prepare(
        "UPDATE canvas_documents SET nodes = ? WHERE owner_id = ? AND id = ?",
      ).run(JSON.stringify(edited), ownerId, canvasId);
      expect(syncHistoricalWorkflowResultInTransaction(database, input)).toMatchObject({
        status: "current-node-changed",
      });
      expect(JSON.parse((database.prepare(
        "SELECT nodes FROM canvas_documents WHERE owner_id = ? AND id = ?",
      ).get(ownerId, canvasId) as { nodes: string }).nodes)
        .find((node: { id: string }) => node.id === nodeId).data.videoPrompt)
        .toBe("user edited after sync");
      database.prepare(
        "UPDATE canvas_documents SET nodes = '[]', graph_revision = 8 WHERE owner_id = ? AND id = ?",
      ).run(ownerId, canvasId);
      expect(syncHistoricalWorkflowResultInTransaction(database, input)).toMatchObject({
        status: "current-node-changed",
      });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM canvas_operation_receipts",
      ).get()).toEqual({ count: 1 });
    });
  });

  await withFixture(async ({ database, input }) => {
    runInTransaction(database, () => {
      const built = buildCanvasProjectionIdentity({
        canvasId,
        database,
        kind: "video",
        nodeId,
        ownerId,
        runId,
        taskId,
      });
      expect(built.status).toBe("ready");
      if (built.status !== "ready") return;
      database.prepare(`
        INSERT INTO canvas_operation_receipts (
          owner_id, canvas_id, operation_id, payload_sha256, command_type,
          actor_type, baseline_kind, base_document_revision, base_input_revision,
          baseline_load_token_sha256, baseline_epoch, outcome, conflict_code,
          http_status, original_request_id, result_document_revision,
          result_input_revision, result_document_sha256, result_input_sha256,
          affected_subgraph_sha256, changed_paths, created_at, settled_at
        ) VALUES (?, ?, ?, ?, 'server.projection', 'server', 'existing', 1, 7,
          ?, 'm113-forged-epoch', 'APPLIED', NULL, 200, 'm113-forged-request',
          1, 7, ?, ?, NULL, '[]', ?, ?)
      `).run(
        ownerId,
        canvasId,
        built.projection.operationId,
        "f".repeat(64),
        "e".repeat(64),
        "a".repeat(64),
        "b".repeat(64),
        baseTime,
        baseTime,
      );
      expect(inspectHistoricalWorkflowResultSyncInTransaction(database, input)).toMatchObject({
        status: "insufficient-evidence",
        reason: "Canvas投影收据身份或状态不一致",
      });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM canvas_operation_receipts",
      ).get()).toEqual({ count: 1 });
    });
  });
});

test("failed historical readback rolls back the new Canvas and receipt together", async () => {
  await withFixture(async ({ database, input }) => {
    const before = database.prepare(`
      SELECT revision, graph_revision, nodes, edges, viewport, save_sequence
      FROM canvas_documents WHERE owner_id = ? AND id = ?
    `).get(ownerId, canvasId);
    process.env.UNBOUNDRY_SAFE_TEST = "1";
    runInTransaction(database, () => {
      setGenerationProjectionReceiptFaultForTests(() => {
        const row = database.prepare(
          "SELECT nodes FROM canvas_documents WHERE owner_id = ? AND id = ?",
        ).get(ownerId, canvasId) as { nodes: string };
        const nodes = JSON.parse(row.nodes) as Array<{ id: string; data?: Record<string, unknown> }>;
        const target = nodes.find((node) => node.id === nodeId)!;
        target.data = { ...(target.data ?? {}), videoPrompt: "readback drift" };
        database.prepare(
          "UPDATE canvas_documents SET nodes = ? WHERE owner_id = ? AND id = ?",
        ).run(JSON.stringify(nodes), ownerId, canvasId);
      });
      try {
        expect(syncHistoricalWorkflowResultInTransaction(database, input)).toMatchObject({
          status: "sync-failed",
        });
      } finally {
        setGenerationProjectionReceiptFaultForTests(undefined);
      }
      expect(database.prepare(`
        SELECT revision, graph_revision, nodes, edges, viewport, save_sequence
        FROM canvas_documents WHERE owner_id = ? AND id = ?
      `).get(ownerId, canvasId)).toEqual(before);
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM canvas_operation_receipts",
      ).get()).toEqual({ count: 0 });
    });
  });
});

test("workflow summaries surface a qualified recovery marker without terminalizing the node", async () => {
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  await withFixture(async ({ database, directory }) => {
    process.env.UNBOUNDRY_DATA_DIR = directory;
    runInTransaction(database, () => {
      database.prepare(`
        UPDATE workflow_run_nodes
        SET state = 'admitted', error_code = 'GENERATION_FAILED',
            error_message = '旧的工作流失败提示'
        WHERE run_id = ? AND node_id = ?
      `).run(runId, nodeId);
      database.prepare(`
        UPDATE generation_tasks
        SET state = 'recovering', error_code = 'AUTOMATIC_RECOVERY_PENDING',
            error_message = NULL, updated_at = ?
        WHERE id = ?
      `).run("2026-09-13T00:00:10.000Z", taskId);
    });
    const pending = getWorkflowRun(ownerId, runId);
    expect(pending?.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      errorCode: "AUTOMATIC_RECOVERY_PENDING",
      errorMessage: "恢复所需的原始期限证据不完整，系统会保留原请求，等待后续处理；不会重复提交付费请求",
      state: "admitted",
      taskId,
    });
    expect(pending?.updatedAt).toBe("2026-09-13T00:00:10.000Z");

    runInTransaction(database, () => {
      database.prepare(`
        UPDATE generation_tasks
        SET error_code = 'AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED',
            error_message = '原请求已进入待处理', updated_at = ?
        WHERE id = ?
      `).run("2026-09-13T00:00:20.000Z", taskId);
    });
    const exhausted = getWorkflowRun(ownerId, runId);
    expect(exhausted?.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      errorCode: "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED",
      errorMessage: "原请求已进入待处理",
      state: "admitted",
      taskId,
    });
    expect(exhausted?.updatedAt).toBe("2026-09-13T00:00:20.000Z");
  });
  if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
  else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
});

test("continuation preview parses the successful-task source proof after historical sync", async () => {
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  await withFixture(async ({ database, directory, input }) => {
    process.env.UNBOUNDRY_DATA_DIR = directory;
    runInTransaction(database, () => {
      expect(syncHistoricalWorkflowResultInTransaction(database, input).status).toBe("applied");
    });
    const preview = getWorkflowContinuationPreview(ownerId, runId);
    expect(preview.candidateNodeIds).toEqual([downstreamNodeId]);
    expect(preview.preservedNodeIds).toEqual([nodeId]);
    expect(preview.externalInputs).toEqual([
      expect.objectContaining({
        kind: "video",
        nodeId,
        source: "successful-task",
        sourceAssetId: assetId,
        sourceTaskId: taskId,
        serverProjectionOperationId: expect.stringMatching(/^server-projection:[0-9a-f]{64}$/),
        serverProjectionPayloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ]);
    expect(preview.externalInputs[0]).not.toHaveProperty("adoptionReceiptId");
    expect(parseWorkflowContinuationPreview(preview)).toMatchObject({
      candidateNodeIds: [downstreamNodeId],
      parentRunId: runId,
      requiresUserIntent: true,
    });
  });
  if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
  else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
});

test("continuation creation persists the proof and admission rechecks it before generation", async () => {
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousSafeTest = process.env.UNBOUNDRY_SAFE_TEST;
  process.env.UNBOUNDRY_SAFE_TEST = "1";
  try {
    await withFixture(async ({ database, directory, input }) => {
      process.env.UNBOUNDRY_DATA_DIR = directory;
      runInTransaction(database, () => {
        expect(syncHistoricalWorkflowResultInTransaction(database, input).status).toBe("applied");
      });
      const preview = getWorkflowContinuationPreview(ownerId, runId);
      const created = await continueWorkflowRun({
        intentId: "m113-continuation-source-proof",
        ownerId,
        parentRunId: runId,
        previewDigest: preview.previewDigest,
      });
      const relation = database.prepare(`
        SELECT child_run_id, canonical_adoption_receipt_id,
               frozen_external_inputs_json
        FROM workflow_run_continuations
        WHERE owner_id = ? AND parent_run_id = ?
      `).get(ownerId, runId) as {
        canonical_adoption_receipt_id: string | null;
        child_run_id: string;
        frozen_external_inputs_json: string;
      };
      expect(relation.child_run_id).toBe(created.continuation.childRunId);
      expect(relation.canonical_adoption_receipt_id).toBeNull();
      const frozen = JSON.parse(relation.frozen_external_inputs_json) as Array<Record<string, unknown>>;
      expect(frozen).toEqual([
        expect.objectContaining({
          kind: "video",
          nodeId,
          source: "successful-task",
          sourceRunId: runId,
          sourceTaskId: taskId,
          serverProjectionOperationId: expect.stringMatching(/^server-projection:[0-9a-f]{64}$/),
          serverProjectionPayloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      ]);
      const childRow = database.prepare(
        "SELECT plan_json FROM workflow_runs WHERE owner_id = ? AND id = ?",
      ).get(ownerId, relation.child_run_id) as { plan_json: string };
      const childPlan = JSON.parse(childRow.plan_json) as StoredWorkflowPlan;
      assertWorkflowContinuationSourcesForRuntimeTest({
        canvasId,
        childRunId: relation.child_run_id,
        database,
        externalNodes: childPlan.externalNodes,
        ownerId,
      });

      const forged = frozen.map((item) => ({
        ...item,
        serverProjectionPayloadSha256: "f".repeat(64),
      }));
      runInTransaction(database, () => {
        database.prepare(`
          UPDATE workflow_run_continuations
          SET frozen_external_inputs_json = ?
          WHERE owner_id = ? AND child_run_id = ?
        `).run(JSON.stringify(forged), ownerId, relation.child_run_id);
      });
      expect(() => assertWorkflowContinuationSourcesForRuntimeTest({
        canvasId,
        childRunId: relation.child_run_id,
        database,
        externalNodes: childPlan.externalNodes,
        ownerId,
      })).toThrow("后继成功来源投影证明已失效");

      // Let the asynchronous runner finish its isolated pass before the
      // fixture directory is removed; this test never invokes a Provider.
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  } finally {
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    if (previousSafeTest === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
    else process.env.UNBOUNDRY_SAFE_TEST = previousSafeTest;
  }
});


test("historical sync CLI binds dry-run proof to a single write and rejects stale proof", async () => {
  await withFixture(async ({ database, directory }) => {
    const command = promisify(execFile);
    const dataDirectory = await realpath(directory);
    const scope = ["--data-dir", dataDirectory, "--owner-id", ownerId,
      "--canvas-id", canvasId, "--run-id", runId, "--node-id", nodeId,
      "--task-id", taskId, "--execution-attempt", "1"];
    const invoke = async (...mode: string[]) => {
      const result = await command(process.execPath, [
        join(process.cwd(), "scripts/sync-successful-workflow-result.mjs"), ...scope, ...mode,
      ], { timeout: 15_000 });
      return JSON.parse(result.stdout) as Record<string, unknown>;
    };
    const before = database.prepare("SELECT * FROM canvas_documents WHERE owner_id = ? AND id = ?").get(ownerId, canvasId);
    const checked = await invoke("--dry-run");
    expect(checked).toMatchObject({status:"ready",mutation:"none",proofSha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(database.prepare("SELECT * FROM canvas_documents WHERE owner_id = ? AND id = ?").get(ownerId,canvasId)).toEqual(before);
    expect(database.prepare("SELECT COUNT(*) AS n FROM canvas_operation_receipts").get()).toEqual({n:0});
    await expect(invoke("--apply","--expected-proof-sha256","f".repeat(64))).rejects.toThrow("HISTORICAL_SYNC_PROOF_CHANGED");
    expect(database.prepare("SELECT COUNT(*) AS n FROM canvas_operation_receipts").get()).toEqual({n:0});
    expect(await invoke("--apply","--expected-proof-sha256",String(checked.proofSha256)))
      .toMatchObject({status:"applied",mutation:"canvas-and-receipt"});
    expect(await invoke("--apply","--expected-proof-sha256",String(checked.proofSha256)))
      .toMatchObject({status:"already-synced",mutation:"none"});
    expect(database.prepare("SELECT COUNT(*) AS n FROM canvas_operation_receipts").get()).toEqual({n:1});
    expect(database.prepare("SELECT state FROM workflow_runs WHERE id = ?").get(runId)).toEqual({state:"failed"});
  });
});
