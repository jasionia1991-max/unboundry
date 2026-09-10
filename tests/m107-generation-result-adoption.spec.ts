import { setGenerationProjectionReceiptFaultForTests } from "../server/canvasMutationGateway";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "./safe-test";
import {
  applyPendingSchemaMigrationsInTransaction,
  openAppDatabase,
} from "../server/database";
import {
  adoptGenerationResultInTransaction,
} from "../server/generationResultAdoption";
import {
  applyGenerationResultAdoption,
  type GenerationResultAdoptionWorkflowPort,
} from "../server/generationResultAdoptionApplication";
import { applyRealGenerationResultAdoption } from
  "../server/generationResultAdoptionWorkflowAdapter";
import { resolvePersistedNodeInputs } from "../server/inputPreflight";
import {
  assertGenerationPublicationAliasesInTransaction,
  generationResultAdoptionMediaLedgerFromRows,
  GenerationResultAdoptionError,
} from "../server/generationResultAdoptionQueries";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import { inspectModelReleaseDocument } from "../server/modelReleaseRevisionStore";
import {
  knownModelParameterSchema,
  submissionParameterValues,
} from "../types/modelParameters";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";
import { compileFrozenWorkflowSemanticPlan } from "../types/workflowSemanticPlan";

const ownerId = "m107-adoption-owner";
const canvasId = "m107-adoption-canvas";
const nodeId = "m107-adoption-video-node";
const taskId = "m107-adoption-task";
const providerTaskId = "m107-original-provider-task";
const baseTime = "2026-01-01T00:00:00.000Z";
const requestFingerprint = `intent-v3:${"a".repeat(64)}`;
const incidentDigest = "b".repeat(64);
const originalChecksum = createHash("sha256").update("same-original-bytes").digest("hex");

function seedOwner(database: DatabaseSync) {
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'safe-test', 'user', 'active', ?, ?)
  `).run(ownerId, ownerId, ownerId, baseTime, baseTime);
}

function seedFixture(database: DatabaseSync, dataDirectory: string) {
  seedOwner(database);
  database.prepare(`
    INSERT INTO canvas_documents (
      owner_id, id, revision, graph_revision, nodes, edges, viewport,
      updated_at, save_sequence
    ) VALUES (?, ?, 4, 7, ?, '[]', ?, ?, 0)
  `).run(
    ownerId,
    canvasId,
    JSON.stringify([{ id: nodeId, type: "video", data: { title: "original" } }]),
    JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    baseTime,
  );
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, model, parameters,
      idempotency_key, request_fingerprint, state, attempt, error_code,
      error_message, created_at, updated_at, owner_id, provider_profile_id,
      provider_model_id, cost_currency, provider_task_id, model_configuration,
      credential_revision
    ) VALUES (?, ?, ?, 'video', 'original result', 'safe-model', '{}',
      'm107-adoption-key', ?, 'failed', 1, 'PROVIDER_RESULT_FORMAT',
      'the Provider returned a result with an unsupported format', ?, ?, ?,
      'safe-profile', 'safe-provider/model', 'USD', ?,
      '{"modelResultCount":1,"workflowBinding":{"runId":"m107-run"}}', 1)
  `).run(
    taskId,
    canvasId,
    nodeId,
    requestFingerprint,
    baseTime,
    baseTime,
    ownerId,
    providerTaskId,
  );
  database.prepare(`
    INSERT INTO generation_provider_attempts (
      task_id, execution_attempt, provider_profile_id, provider_model_id,
      kind, evidence, created_at, owner_id, credential_revision, outcome,
      provider_task_id, failure_code, finished_at
    ) VALUES (?, 1, 'safe-profile', 'safe-provider/model', 'video',
      'provider-boundary', ?, ?, 1, 'response-received', ?,
      NULL, ?)
  `).run(taskId, baseTime, ownerId, providerTaskId, baseTime);
  database.prepare(`
    INSERT INTO generation_task_events (
      task_id, state, error_code, error_message, created_at
    ) VALUES (?, 'failed', 'PROVIDER_RESULT_FORMAT', ?, ?)
  `).run(
    taskId,
    "the Provider returned a result with an unsupported format",
    baseTime,
  );

  // Seed the incident in the real schema43 shape, then run the actual 43 -> 44
  // DDL migration.  Schema44's output-slot triggers therefore remain active
  // for the whole test; legacy null slots exist only because the migration
  // preserved them from their pre-slot source schema.
  const publications = [
    {
      attemptId: "m107-publication-failed",
      assetId: "m107-asset-failed",
      state: "failed",
      byteSize: 0,
      checksum: null,
      storageStatus: "failed",
      errorCode: "MEDIA_RECOVERY_EVIDENCE_MISSING",
    },
    {
      attemptId: "m107-publication-canonical",
      assetId: "m107-asset-canonical",
      state: "published",
      byteSize: 19,
      checksum: originalChecksum,
      storageStatus: "ready",
      errorCode: null,
    },
    {
      attemptId: "m107-publication-alias",
      assetId: "m107-asset-alias",
      state: "published",
      byteSize: 19,
      checksum: originalChecksum,
      storageStatus: "ready",
      errorCode: null,
    },
  ] as const;
  for (const [index, publication] of publications.entries()) {
    const storageName = `${publication.assetId}.mp4`;
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height
      ) VALUES ('video', ?, ?, ?, ?, ?, ?, 'local', ?, 'video/mp4', ?,
        ?, 5, 'provider-task', 'ready', 640, 360)
    `).run(
      publication.assetId,
      ownerId,
      storageName,
      publication.byteSize,
      baseTime,
      baseTime,
      storageName,
      publication.checksum,
      publication.storageStatus,
    );
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        task_id, task_execution_attempt, history_label, byte_size,
        checksum_sha256, content_type, duration_seconds, duration_source,
        media_width, media_height, error_code, retry_count, created_at,
        updated_at
      ) VALUES (?, ?, 'video', ?, 'generation', ?, 'local', ?, ?, ?, ?, 1,
        'm107 legacy A/B/C accident', ?, ?, 'video/mp4', 5, 'provider-task',
        640, 360, ?, 0, ?, ?)
    `).run(
      publication.attemptId,
      ownerId,
      publication.assetId,
      publication.state,
      storageName,
      storageName,
      `.m107-${index}.generating`,
      taskId,
      publication.byteSize,
      publication.checksum,
      publication.errorCode,
      baseTime,
      baseTime,
    );
  }
  const bytes = Buffer.from("same-original-bytes");
  mkdirSync(join(dataDirectory, "media"), { recursive: true, mode: 0o700 });
  for (const assetId of ["m107-asset-canonical", "m107-asset-alias"]) {
    writeFileSync(join(dataDirectory, "media", `${assetId}.mp4`), bytes, {
      flag: "wx",
      mode: 0o600,
    });
  }
}

function prepareFixture(dataDirectory: string) {
  const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    BEGIN IMMEDIATE;
  `);
  try {
    applyPendingSchemaMigrationsInTransaction(database, {
      sourceVersion: 0,
      targetVersion: 43,
    });
    database.exec("COMMIT");
    seedFixture(database, dataDirectory);
    database.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(database, {
      sourceVersion: 43,
      targetVersion: 44,
    });
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    throw error;
  }
  database.close();
  return openAppDatabase(dataDirectory);
}

const realWorkflowRunId = "m111-adoption-workflow-run";
const realWorkflowGroupId = "m111-adoption-workflow-group";
const realWorkflowReservationId = "m111-adoption-workflow-reservation";
const realWorkflowModelId = "m111-adoption-video-model";
const realWorkflowProviderDriver = "volcengine-ark";
const realWorkflowModelConfigurationRevision = "m111-adoption-model-revision";
const realWorkflowNeighborId = "m111-adoption-neighbor";
const realWorkflowNeighborTwoId = "m111-adoption-neighbor-two";

function realWorkflowRelease(): ModelReleaseRevision {
  const capability = "video" as const;
  const providerDriver = "volcengine-ark";
  const providerModelId = "doubao-seedance-2-0-mini-260615";
  const providerProfileId = "safe-profile";
  const providerProtocol = "native" as const;
  const capabilitySchema = knownModelParameterSchema({
    capability,
    providerDriver,
    providerModelId,
  });
  const document = defaultModelReleaseDocument({
    capability,
    capabilitySchema,
    modelId: realWorkflowModelId,
    providerDriver,
    providerModelId,
    providerProfileId,
    providerProtocol,
  });
  const proof = inspectModelReleaseDocument(document);
  return Object.freeze({
    createdAt: baseTime,
    document,
    hash: proof.documentHash,
    modelId: realWorkflowModelId,
    revisionId: "00000000-0000-4111-8111-000000000111",
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

function seedRealWorkflowBinding(database: DatabaseSync) {
  const release = realWorkflowRelease();
  const graphNodes = [
    { data: {}, id: realWorkflowGroupId, position: { x: 0, y: 0 }, type: "group" },
    {
      data: {
        videoModelId: realWorkflowModelId,
        videoParameters: {},
        videoPrompt: "m111 adoption prompt",
        videoPromptReady: true,
      },
      id: nodeId,
      parentId: realWorkflowGroupId,
      position: { x: 160, y: 240 },
      type: "video",
    },
    {
      data: { title: "unchanged neighbor" },
      id: realWorkflowNeighborId,
      position: { x: 720, y: 240 },
      type: "text",
    },
    {
      data: { title: "unchanged neighbor two" },
      id: realWorkflowNeighborTwoId,
      position: { x: 960, y: 240 },
      type: "text",
    },
  ] as const;
  const graphEdges = [{
    id: "m111-adoption-neighbor-edge",
    source: realWorkflowNeighborId,
    target: realWorkflowNeighborTwoId,
  }];
  const semantic = compileFrozenWorkflowSemanticPlan({
    edges: graphEdges,
    groupId: realWorkflowGroupId,
    nodes: graphNodes,
  });
  const nodePlan = semantic.nodes[0]!;
  // Seed the same identity that the real Canvas projection verifier derives
  // from the persisted node.  Arbitrary placeholder keys would model a
  // tampered task and correctly produce projection-failed, hiding whether the
  // workflow adapter can project a valid adopted result.
  database.prepare(`
    UPDATE canvas_documents SET nodes = ?, edges = ?, graph_revision = 7,
      updated_at = ? WHERE owner_id = ? AND id = ?
  `).run(
    JSON.stringify(graphNodes),
    JSON.stringify(graphEdges),
    baseTime,
    ownerId,
    canvasId,
  );
  const persisted = resolvePersistedNodeInputs({
    bypass: false,
    canvasId,
    database,
    modelReleaseRevision: release.revisionId,
    modelSchema: release.document.capabilitySchema,
    ownerId,
    parameters: {},
    targetId: nodeId,
    targetKind: "video",
  });
  const parameters = submissionParameterValues(
    release.document.capabilitySchema,
    persisted.normalizedParameters ?? {},
  );
  const contractFingerprint = persisted.contractFingerprint;
  if (!contractFingerprint) throw new Error("real workflow fixture contract is missing");
  const inputKey = generationInputKey({
    inputs: persisted.inputs,
    modelConfigurationRevision: realWorkflowModelConfigurationRevision,
    modelId: realWorkflowModelId,
    modelReleaseRevision: release.revisionId,
    ownPrompt: persisted.persistedOwnPrompt,
    parameters,
    prompt: persisted.finalPrompt,
  });
  const ownershipKey = generationOwnershipKey(generationOwnershipEvidence({
    contractFingerprint,
    inputs: persisted.inputs,
    kind: "video",
    modelConfigurationRevision: realWorkflowModelConfigurationRevision,
    modelId: realWorkflowModelId,
    modelReleaseRevision: release.revisionId,
    parameters,
    prompt: persisted.persistedOwnPrompt,
  }));
  const plan = Object.freeze({
    clientSemanticFingerprint: semantic.semanticFingerprint,
    edges: semantic.edges,
    executableNodeIds: semantic.executableNodeIds,
    externalNodes: Object.freeze([]),
    groupId: realWorkflowGroupId,
    nodes: Object.freeze([Object.freeze({
      ...nodePlan,
      costCurrency: "USD" as const,
      modelConfigurationRevision: realWorkflowModelConfigurationRevision,
      modelReleaseRevision: release,
      providerDriver: realWorkflowProviderDriver,
      providerModelId: release.document.providerModelId,
      providerProfileId: release.document.providerProfileId,
      providerProtocol: release.document.providerProtocol,
      recoveryEvidence: "m111 synthetic stored result",
      recoveryGrade: "STORED_RESPONSE_OR_FENCED_UNKNOWN" as const,
    })]),
    semanticFingerprint: semantic.semanticFingerprint,
    version: 1 as const,
  });
  const modelConfiguration = {
    generationIdentityVersion: 2,
    generationInputKey: inputKey,
    generationOwnershipKey: ownershipKey,
    modelCapability: "video",
    modelConfigurationRevision: realWorkflowModelConfigurationRevision,
    modelId: realWorkflowModelId,
    modelInputContractFingerprint: contractFingerprint,
    modelReleaseRevision: release,
    modelResultCount: 1,
    parameterSchema: release.document.capabilitySchema,
    providerDriver: realWorkflowProviderDriver,
    providerModelId: release.document.providerModelId,
    providerProfileId: release.document.providerProfileId,
    providerProtocol: release.document.providerProtocol,
    workflowBinding: {
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      groupId: realWorkflowGroupId,
      modelConfigurationRevision: realWorkflowModelConfigurationRevision,
      modelReleaseRevision: release.revisionId,
      reservationId: realWorkflowReservationId,
      runId: realWorkflowRunId,
    },
  };
  database.prepare(`
    UPDATE generation_tasks SET model = ?, idempotency_key = ?,
      provider_model_id = ?, model_configuration = ?, prompt = ?, parameters = ?
    WHERE owner_id = ? AND id = ?
  `).run(
    realWorkflowModelId,
    "m111-adoption-idempotency",
    release.document.providerModelId,
    JSON.stringify(modelConfiguration),
    persisted.finalPrompt,
    JSON.stringify(parameters),
    ownerId,
    taskId,
  );
  database.prepare(`
    UPDATE generation_provider_attempts SET provider_model_id = ?
    WHERE owner_id = ? AND task_id = ? AND execution_attempt = 1
  `).run(release.document.providerModelId, ownerId, taskId);
  database.prepare(`
    INSERT INTO workflow_runs (
      id, owner_id, canvas_id, group_id, graph_revision,
      semantic_fingerprint, plan_json, state, stop_requested,
      reservation_id, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 7, ?, ?, 'failed', 0, ?, 'GENERATION_FAILED',
      'm111 synthetic parent failure', ?, ?)
  `).run(
    realWorkflowRunId,
    ownerId,
    canvasId,
    realWorkflowGroupId,
    plan.semanticFingerprint,
    JSON.stringify(plan),
    realWorkflowReservationId,
    baseTime,
    baseTime,
  );
  database.prepare(`
    UPDATE generation_tasks SET idempotency_key = ? WHERE id = ?
  `).run("m111-adoption-idempotency", taskId);
  database.prepare(`
    INSERT INTO workflow_run_nodes (
      run_id, owner_id, node_id, kind, plan_index, dependencies_json,
      semantic_identity, idempotency_key, state, task_id,
      projection_state, error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, 'video', 0, '[]', ?, ?, 'failed', ?, 'pending',
      'GENERATION_FAILED', 'm111 synthetic failed node', ?, ?)
  `).run(
    realWorkflowRunId,
    ownerId,
    nodeId,
    nodePlan.semanticIdentity,
    "m111-adoption-idempotency",
    taskId,
    baseTime,
    baseTime,
  );
  return Object.freeze({
    graphFingerprint: semantic.semanticFingerprint,
    nodePlan,
    release,
  });
}

function mediaLedger(database: DatabaseSync) {
  const rows = database.prepare(`
    SELECT publication.*, media.storage_status AS media_storage_status,
      media.byte_size AS asset_byte_size,
      media.checksum_sha256 AS asset_checksum_sha256,
      media.content_type AS asset_content_type, media.storage_backend AS asset_storage_backend,
      media.storage_profile_id AS asset_storage_profile_id, media.object_key AS asset_object_key,
      deletion.state AS deletion_state
    FROM media_publication_attempts AS publication
    LEFT JOIN media_assets AS media ON media.owner_id = publication.owner_id
      AND media.kind = publication.kind AND media.id = publication.asset_id
    LEFT JOIN media_delete_intents AS deletion ON deletion.owner_id = publication.owner_id
      AND deletion.kind = publication.kind AND deletion.asset_id = publication.asset_id
    WHERE publication.task_id = ? ORDER BY publication.attempt_id
  `).all(taskId) as Array<Record<string, unknown>>;
  return generationResultAdoptionMediaLedgerFromRows(rows, {
    "m107-publication-failed": "failed",
    "m107-publication-canonical": "canonical",
    "m107-publication-alias": "alias",
  });
}

function adoptionInput(
  database: ReturnType<typeof openAppDatabase>,
  bindingUnchanged: boolean | undefined = true,
) {
  return {
    ownerId,
    taskId,
    executionAttempt: 1,
    kind: "video" as const,
    incidentDigest,
    canvas: {
      canvasId,
      nodeId,
      graphRevision: 7,
      inputFingerprint: requestFingerprint,
      bindingUnchanged,
      currentAssetId: bindingUnchanged === false ? "m107-new-user-result" : null,
    },
    media: mediaLedger(database),
    canonicalAttemptId: "m107-publication-canonical",
    canonicalAssetId: "m107-asset-canonical",
    aliasAttemptId: "m107-publication-alias",
    aliasAssetId: "m107-asset-alias",
    providerPostCount: 0 as const,
    receiptId: "m107-adoption-receipt",
    runId: "m107-run",
    now: baseTime,
  } as const;
}

function expectAdoptionError(action: () => unknown, code: string) {
  let thrown: unknown;
  try { action(); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(GenerationResultAdoptionError);
  expect((thrown as GenerationResultAdoptionError).code).toBe(code);
}

test("A failed plus B/C published same-origin rows require one receipt and stay idempotent", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m107-adoption-"));
  const database = prepareFixture(dataDirectory);
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const input = adoptionInput(database);
      expectAdoptionError(
        () => assertGenerationPublicationAliasesInTransaction(database, input),
        "ADOPTION_UNSAFE_STATE",
      );
      const beforeProvider = database.prepare(
        "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
      ).get(taskId) as { count: number };
      const first = adoptGenerationResultInTransaction(database, input);
      expect(first.changed).toBe(true);
      expect(first.projection).toBe("project-canonical");
      expect(first.mediaSlotPromotion.outputSetCount).toBe(1);
      expect((database.prepare(
        "SELECT COUNT(*) AS count FROM generation_result_adoptions WHERE task_id = ?",
      ).get(taskId) as { count: number }).count).toBe(1);
      expect((database.prepare(
        "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
      ).get(taskId) as { count: number }).count).toBe(beforeProvider.count);
      expect((database.prepare(
        "SELECT state, error_code, result_asset_id FROM generation_tasks WHERE id = ?",
      ).get(taskId) as Record<string, unknown>)).toEqual({
        state: "failed",
        error_code: "PROVIDER_RESULT_FORMAT",
        result_asset_id: null,
      });

      // Media owns this CAS.  The synthetic test performs its equivalent
      // mutation explicitly, then re-runs the generation guard to prove the
      // alias remains null but is now receipt-bound.
      database.prepare(`
        UPDATE media_publication_attempts
        SET output_slot = 0, output_set_count = 1
        WHERE attempt_id = 'm107-publication-canonical'
          AND owner_id = ? AND task_id = ? AND task_execution_attempt = 1
          AND state = 'published' AND output_slot IS NULL
          AND output_set_count IS NULL
      `).run(ownerId, taskId);
      expect(() => assertGenerationPublicationAliasesInTransaction(database, input)).not.toThrow();
      const replay = adoptGenerationResultInTransaction(database, input);
      expect(replay.changed).toBe(false);
      expect(replay.id).toBe(first.id);
      expect(replay.receiptDigest).toBe(first.receiptDigest);
      expect((database.prepare(`
        SELECT attempt_id, output_slot, output_set_count
        FROM media_publication_attempts WHERE task_id = ? ORDER BY attempt_id
      `).all(taskId) as Array<Record<string, unknown>>)).toEqual([
        { attempt_id: "m107-publication-alias", output_slot: null, output_set_count: null },
        { attempt_id: "m107-publication-canonical", output_slot: 0, output_set_count: 1 },
        { attempt_id: "m107-publication-failed", output_slot: null, output_set_count: null },
      ]);

      // A changed Canvas binding returns preserve-original and does not alter
      // the immutable receipt or the existing node graph.
      const changedCanvas = adoptGenerationResultInTransaction(
        database,
        adoptionInput(database, false),
      );
      expect(changedCanvas.changed).toBe(false);
      expect(changedCanvas.projection).toBe("preserve-original");
      expect(database.prepare(
        "SELECT nodes, edges, graph_revision FROM canvas_documents WHERE id = ?",
      ).get(canvasId)).toEqual({
        nodes: JSON.stringify([{ id: nodeId, type: "video", data: { title: "original" } }]),
        edges: "[]",
        graph_revision: 7,
      });
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("adoption rejects a second Provider attempt or a changed same-origin hash", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m107-adoption-reject-"));
  const database = prepareFixture(dataDirectory);
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT INTO generation_provider_attempts (
          task_id, execution_attempt, provider_profile_id, provider_model_id,
          kind, evidence, created_at, owner_id, credential_revision, outcome,
          provider_task_id, failure_code, finished_at
        ) VALUES (?, 2, 'safe-profile', 'safe-provider/model', 'video',
          'provider-boundary', ?, ?, 1, 'response-received', ?,
          NULL, ?)
      `).run(taskId, baseTime, ownerId, "m107-second-provider-task", baseTime);
      expectAdoptionError(
        () => adoptGenerationResultInTransaction(database, adoptionInput(database)),
        "ADOPTION_UNSAFE_STATE",
      );
      database.prepare(`
        DELETE FROM generation_provider_attempts
        WHERE task_id = ? AND execution_attempt = 2
      `).run(taskId);
      database.prepare(
        "UPDATE media_assets SET checksum_sha256 = ? WHERE id = 'm107-asset-alias'",
      ).run("c".repeat(64));
      expectAdoptionError(
        () => adoptGenerationResultInTransaction(database, adoptionInput(database)),
        "ADOPTION_EVIDENCE_MISMATCH",
      );
      database.exec("ROLLBACK");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("R10 application adopts once, replays without a Provider post, and preserves a changed Canvas node", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m107-adoption-application-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  let database: ReturnType<typeof openAppDatabase> | undefined;
  try {
    database = prepareFixture(dataDirectory);
    database.close();
    database = undefined;

    const readRevisions: number[] = [];
    const projectCalls: string[] = [];
    const workflow: GenerationResultAdoptionWorkflowPort = {
      readInTransaction(current, input) {
        expect(current.isTransaction).toBe(true);
        readRevisions.push(input.currentGraphRevision);
        return Object.freeze({
          runId: input.runId,
          bindingUnchanged: input.currentGraphRevision === 7,
        });
      },
      projectInTransaction(current, input) {
        expect(current.isTransaction).toBe(true);
        const task = current.prepare(
          "SELECT state, result_asset_id FROM generation_tasks WHERE id = ?",
        ).get(input.taskId) as { state: string; result_asset_id: string | null };
        expect(task.state).toBe("success");
        expect(task.result_asset_id).toBe("m107-asset-canonical");
        projectCalls.push(input.taskId);
        return "projected";
      },
    };
    const applicationInput = {
      ownerId,
      taskId,
      executionAttempt: 1,
      kind: "video" as const,
      incidentDigest,
      canonicalAttemptId: "m107-publication-canonical",
      aliasAttemptId: "m107-publication-alias",
    };

    const dryRun = await applyGenerationResultAdoption(
      { ...applicationInput, mode: "dry-run" },
      workflow,
    );
    expect(dryRun).toMatchObject({
      changed: true,
      idempotent: false,
      mode: "dry-run",
      projection: "dry-run",
      providerPostCount: 0,
      state: "dry-run",
    });

    database = openAppDatabase(dataDirectory);
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM generation_result_adoptions WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 0 });
    expect(database.prepare(
      "SELECT state, error_code, result_asset_id FROM generation_tasks WHERE id = ?",
    ).get(taskId)).toEqual({
      state: "failed",
      error_code: "PROVIDER_RESULT_FORMAT",
      result_asset_id: null,
    });
    database.close();
    database = undefined;

    const applied = await applyGenerationResultAdoption(
      { ...applicationInput, mode: "apply" },
      workflow,
    );
    expect(applied).toMatchObject({
      changed: true,
      idempotent: false,
      mode: "apply",
      projection: "project-canonical",
      providerPostCount: 0,
      state: "success",
    });
    expect(projectCalls).toEqual([taskId]);

    database = openAppDatabase(dataDirectory);
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT state, error_code, result_asset_id FROM generation_tasks WHERE id = ?",
    ).get(taskId)).toEqual({
      state: "success",
      error_code: null,
      result_asset_id: "m107-asset-canonical",
    });
    expect(database.prepare(`
      SELECT attempt_id, state, output_slot, output_set_count
      FROM media_publication_attempts WHERE task_id = ? ORDER BY attempt_id
    `).all(taskId)).toEqual([
      {
        attempt_id: "m107-publication-alias",
        state: "published",
        output_slot: null,
        output_set_count: null,
      },
      {
        attempt_id: "m107-publication-canonical",
        state: "published",
        output_slot: 0,
        output_set_count: 1,
      },
      {
        attempt_id: "m107-publication-failed",
        state: "failed",
        output_slot: null,
        output_set_count: null,
      },
    ]);
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM generation_result_adoptions WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 1 });
    database.close();
    database = undefined;

    const replay = await applyGenerationResultAdoption(
      { ...applicationInput, mode: "apply" },
      workflow,
    );
    expect(replay).toMatchObject({
      changed: false,
      idempotent: true,
      mode: "apply",
      projection: "project-canonical",
      providerPostCount: 0,
      state: "success",
    });
    expect(projectCalls).toEqual([taskId, taskId]);

    database = openAppDatabase(dataDirectory);
    database.prepare(`
      UPDATE canvas_documents
      SET graph_revision = 8,
          nodes = ?
      WHERE owner_id = ? AND id = ?
    `).run(
      JSON.stringify([{ id: nodeId, type: "video", data: { assetId: "m107-user-result" } }]),
      ownerId,
      canvasId,
    );
    database.close();
    database = undefined;

    const preserved = await applyGenerationResultAdoption(
      { ...applicationInput, mode: "apply" },
      workflow,
    );
    expect(preserved).toMatchObject({
      changed: false,
      idempotent: true,
      mode: "apply",
      projection: "preserve-original",
      providerPostCount: 0,
      state: "success",
    });
    expect(readRevisions).toEqual([7, 7, 7, 8]);
    expect(projectCalls).toEqual([taskId, taskId]);

    database = openAppDatabase(dataDirectory);
    expect(database.prepare(
      "SELECT state, result_asset_id FROM generation_tasks WHERE id = ?",
    ).get(taskId)).toEqual({ state: "success", result_asset_id: "m107-asset-canonical" });
    expect(database.prepare(`
      SELECT graph_revision, nodes FROM canvas_documents WHERE owner_id = ? AND id = ?
    `).get(ownerId, canvasId)).toEqual({
      graph_revision: 8,
      nodes: JSON.stringify([{ id: nodeId, type: "video", data: { assetId: "m107-user-result" } }]),
    });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM media_assets WHERE owner_id = ?",
    ).get(ownerId)).toEqual({ count: 3 });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM media_publication_attempts WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 3 });
  } finally {
    database?.close();
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("R10 physical object evidence rejects a missing blob and wrong hash, while a deleted node is preserved", async () => {
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const workflow: GenerationResultAdoptionWorkflowPort = {
    readInTransaction(current, input) {
      expect(current.isTransaction).toBe(true);
      // Deliberately report the binding as unchanged. The application must
      // still force preserve-original when the Canvas node has been deleted.
      return Object.freeze({ runId: input.runId, bindingUnchanged: true });
    },
    projectInTransaction() {
      throw new Error("deleted Canvas nodes must not be projected");
    },
  };
  const applicationInput = {
    ownerId,
    taskId,
    executionAttempt: 1,
    kind: "video" as const,
    incidentDigest,
    canonicalAttemptId: "m107-publication-canonical",
    aliasAttemptId: "m107-publication-alias",
    mode: "apply" as const,
  };

  const runRejectedPhysicalCase = async (name: string, mutate: (dataDirectory: string) => void) => {
    const dataDirectory = await mkdtemp(join(tmpdir(), `unboundry-m107-${name}-`));
    let database: ReturnType<typeof openAppDatabase> | undefined;
    process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
    try {
      database = prepareFixture(dataDirectory);
      database.close();
      database = undefined;
      mutate(dataDirectory);
      await expect(applyGenerationResultAdoption(applicationInput, workflow))
        .rejects.toMatchObject({ code: "ADOPTION_EVIDENCE_MISMATCH" });
      database = openAppDatabase(dataDirectory);
      expect(database.prepare(
        "SELECT state, error_code, result_asset_id FROM generation_tasks WHERE id = ?",
      ).get(taskId)).toEqual({
        state: "failed",
        error_code: "PROVIDER_RESULT_FORMAT",
        result_asset_id: null,
      });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM generation_result_adoptions WHERE task_id = ?",
      ).get(taskId)).toEqual({ count: 0 });
    } finally {
      database?.close();
      await rm(dataDirectory, { force: true, recursive: true });
    }
  };

  try {
    await runRejectedPhysicalCase("missing-blob", (dataDirectory) => {
      rmSync(join(dataDirectory, "media", "m107-asset-canonical.mp4"));
    });
    await runRejectedPhysicalCase("wrong-hash", (dataDirectory) => {
      writeFileSync(
        join(dataDirectory, "media", "m107-asset-canonical.mp4"),
        Buffer.from("wrong-original-bytes"),
        { flag: "w", mode: 0o600 },
      );
    });
    await runRejectedPhysicalCase("object-key-mismatch", (dataDirectory) => {
      const database = openAppDatabase(dataDirectory);
      database.prepare(
        "UPDATE media_assets SET object_key = ? WHERE owner_id = ? AND id = ?",
      ).run("m107-asset-canonical-wrong-object", ownerId, "m107-asset-canonical");
      database.close();
    });
    await runRejectedPhysicalCase("storage-profile-mismatch", (dataDirectory) => {
      const database = openAppDatabase(dataDirectory);
      database.prepare(
        "UPDATE media_assets SET storage_profile_id = ? WHERE owner_id = ? AND id = ?",
      ).run("m107-wrong-storage-profile", ownerId, "m107-asset-canonical");
      database.close();
    });

    const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m107-deleted-node-"));
    let database: ReturnType<typeof openAppDatabase> | undefined;
    process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
    try {
      database = prepareFixture(dataDirectory);
      database.prepare(`
        UPDATE canvas_documents SET nodes = ?
        WHERE owner_id = ? AND id = ?
      `).run("[]", ownerId, canvasId);
      // A was already compensated: its failed journal row is retained, but
      // the failed media asset row is legitimately gone. B/C remain the
      // complete physical evidence required for adoption.
      database.prepare(`
        DELETE FROM media_assets
        WHERE owner_id = ? AND id = 'm107-asset-failed' AND storage_status = 'failed'
      `).run(ownerId);
      database.close();
      database = undefined;
      const result = await applyGenerationResultAdoption(applicationInput, workflow);
      expect(result).toMatchObject({
        mode: "apply",
        projection: "preserve-original",
        state: "success",
        providerPostCount: 0,
      });
      database = openAppDatabase(dataDirectory);
      expect(database.prepare(
        "SELECT state, result_asset_id FROM generation_tasks WHERE id = ?",
      ).get(taskId)).toEqual({ state: "success", result_asset_id: "m107-asset-canonical" });
      expect(database.prepare(
        "SELECT nodes FROM canvas_documents WHERE owner_id = ? AND id = ?",
      ).get(ownerId, canvasId)).toEqual({ nodes: "[]" });
      expect(database.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE owner_id = ? AND attempt_id = 'm107-publication-failed'
      `).get(ownerId)).toEqual({
        state: "failed",
        error_code: "MEDIA_RECOVERY_EVIDENCE_MISSING",
      });
      expect(database.prepare(
        "SELECT COUNT(*) AS count FROM media_assets WHERE owner_id = ?",
      ).get(ownerId)).toEqual({ count: 2 });
    } finally {
      database?.close();
      await rm(dataDirectory, { force: true, recursive: true });
    }
  } finally {
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
  }
});

test("R10 real Workflow adoption adapter uses one transaction and keeps the failed parent immutable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m111-real-adapter-"));
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  let database: ReturnType<typeof openAppDatabase> | undefined;
  const applicationInput = {
    ownerId,
    taskId,
    executionAttempt: 1,
    kind: "video" as const,
    incidentDigest,
    canonicalAttemptId: "m107-publication-canonical",
    aliasAttemptId: "m107-publication-alias",
    mode: "apply" as const,
  };
  try {
    database = prepareFixture(dataDirectory);
    const workflow = seedRealWorkflowBinding(database);
    expect(workflow.graphFingerprint).toBeTruthy();
    database.prepare(`UPDATE generation_tasks SET estimated_cost_microunits = 123,
      actual_cost_microunits = 123, provider_usage_tokens = 456 WHERE id = ?`).run(taskId);
    const readUsage = (db: DatabaseSync) => db.prepare(`SELECT estimated_cost_microunits,
      actual_cost_microunits, cost_currency, provider_usage_tokens
      FROM generation_tasks WHERE id = ?`).get(taskId);
    const originalUsage = readUsage(database);
    database.close();
    database = undefined;

    let projectionReached = false;
    setGenerationProjectionReceiptFaultForTests(() => {
      projectionReached = true;
      throw new Error("m107 simulated Canvas receipt failure");
    });
    try {
      await expect(applyRealGenerationResultAdoption(applicationInput))
        .rejects.toThrow("原结果回填暂未完成");
    } finally {
      setGenerationProjectionReceiptFaultForTests(undefined);
    }
    expect(projectionReached).toBe(true);
    database = openAppDatabase(dataDirectory);
    expect(readUsage(database)).toEqual(originalUsage);
    expect(database.prepare("SELECT state, result_asset_id FROM generation_tasks WHERE id = ?")
      .get(taskId)).toEqual({ state: "failed", result_asset_id: null });
    expect(database.prepare("SELECT COUNT(*) AS n FROM generation_result_adoptions WHERE task_id = ?")
      .get(taskId)).toEqual({ n: 0 });
    expect(database.prepare("SELECT output_slot, output_set_count FROM media_publication_attempts WHERE attempt_id = ?")
      .get(applicationInput.canonicalAttemptId)).toEqual({ output_slot: null, output_set_count: null });
    database.close();
    database = undefined;

    const adopted = await applyRealGenerationResultAdoption(applicationInput);
    expect(adopted).toMatchObject({
      changed: true,
      idempotent: false,
      mode: "apply",
      projection: "project-canonical",
      providerPostCount: 0,
      state: "success",
    });

    database = openAppDatabase(dataDirectory);
    const adoptedCanvas = database.prepare(
      "SELECT nodes, edges FROM canvas_documents WHERE owner_id = ? AND id = ?",
    ).get(ownerId, canvasId) as { nodes: string; edges: string };
    const adoptedNodes = JSON.parse(adoptedCanvas.nodes) as Array<Record<string, unknown>>;
    const adoptedNode = adoptedNodes.find((node) => node.id === nodeId) as
      | { data?: Record<string, unknown>; position?: Record<string, number> }
      | undefined;
    expect(adoptedNode?.data?.assetId).toBe("m107-asset-canonical");
    expect(adoptedNode?.position).toEqual({ x: 160, y: 240 });
    expect(adoptedNodes.find((node) => node.id === realWorkflowNeighborId)).toEqual({
      data: { title: "unchanged neighbor" },
      id: realWorkflowNeighborId,
      position: { x: 720, y: 240 },
      type: "text",
    });
    expect(adoptedNodes.find((node) => node.id === realWorkflowNeighborTwoId)).toEqual({
      data: { title: "unchanged neighbor two" },
      id: realWorkflowNeighborTwoId,
      position: { x: 960, y: 240 },
      type: "text",
    });
    expect(JSON.parse(adoptedCanvas.edges)).toEqual([{
      id: "m111-adoption-neighbor-edge",
      source: realWorkflowNeighborId,
      target: realWorkflowNeighborTwoId,
    }]);
    expect(database.prepare(
      "SELECT state, error_code, result_asset_id FROM generation_tasks WHERE id = ?",
    ).get(taskId)).toEqual({
      state: "success",
      error_code: null,
      result_asset_id: "m107-asset-canonical",
    });
    expect(database.prepare(
      "SELECT state, graph_revision FROM workflow_runs WHERE id = ?",
    ).get(realWorkflowRunId)).toEqual({ state: "failed", graph_revision: 7 });
    expect(database.prepare(`
      SELECT state, task_id, projection_state FROM workflow_run_nodes
      WHERE run_id = ? AND node_id = ?
    `).get(realWorkflowRunId, nodeId)).toEqual({
      state: "failed",
      task_id: taskId,
      projection_state: "pending",
    });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM generation_result_adoptions WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 1 });
    database.close();
    database = undefined;

    const replay = await applyRealGenerationResultAdoption(applicationInput);
    expect(replay).toMatchObject({
      changed: false,
      idempotent: true,
      projection: "project-canonical",
      providerPostCount: 0,
      state: "success",
    });

    database = openAppDatabase(dataDirectory);
    expect(readUsage(database)).toEqual(originalUsage);
    database.prepare(`
      UPDATE canvas_documents SET graph_revision = 8, nodes = ?
      WHERE owner_id = ? AND id = ?
    `).run(
      JSON.stringify([{ id: nodeId, type: "video", data: { assetId: "m111-user-result" } }]),
      ownerId,
      canvasId,
    );
    database.close();
    database = undefined;

    const preserved = await applyRealGenerationResultAdoption(applicationInput);
    expect(preserved).toMatchObject({
      changed: false,
      idempotent: true,
      mode: "apply",
      projection: "preserve-original",
      providerPostCount: 0,
      state: "success",
    });
    database = openAppDatabase(dataDirectory);
    expect(database.prepare(
      "SELECT state, result_asset_id FROM generation_tasks WHERE id = ?",
    ).get(taskId)).toEqual({ state: "success", result_asset_id: "m107-asset-canonical" });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM generation_provider_attempts WHERE task_id = ?",
    ).get(taskId)).toEqual({ count: 1 });
    expect(database.prepare(
      "SELECT nodes, graph_revision FROM canvas_documents WHERE owner_id = ? AND id = ?",
    ).get(ownerId, canvasId)).toEqual({
      nodes: JSON.stringify([{ id: nodeId, type: "video", data: { assetId: "m111-user-result" } }]),
      graph_revision: 8,
    });
  } finally {
    database?.close();
    if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
