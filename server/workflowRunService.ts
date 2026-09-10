import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  appDataDirectory,
  openAppDatabase,
  readAppDatabaseSnapshot,
} from "./database";
import {
  readPersistedCanvasGraph,
} from "./inputPreflight";
import { workflowMediaCapacity } from "./mediaPublicationService";
import { admitPreparedGenerationTask } from "./generationAdmissionApplication";
import { buildAuthoritativeGenerationModelConfiguration } from
  "./authoritativeGenerationModelConfiguration";
import { generationTaskApplication } from "./generationTasks";
import {
  generationInputKey,
  generationOwnershipEvidence,
  generationOwnershipKey,
} from "../types/generationIdentity";
import {
  resolveNodeInputs,
  workflowRoleMinimumCanBeSatisfied,
  type NodeInputKind,
} from "../types/nodeInputs";
import {
  normalizeParameterValues,
  submissionParameterValues,
  type ModelParameterSchema,
} from "../types/modelParameters";
import {
  compileRegisteredModelTaskDecision,
  workflowRecoveryPolicy,
} from "./modelExecutionRegistry";
import { modelConfigurationRevision } from "./modelCatalog";
import { modelMediaInputPolicy } from "./modelConfigurationIdentity";
import { assertModelReleaseRevisionIntegrity } from
  "./modelReleaseRevisionStore";
import {
  canvasGraphRevisionMatchesInTransaction,
  projectWorkflowResultInTransaction,
} from "./canvasWorkflowProjection";
import {
  compileFrozenWorkflowSemanticPlan,
  workflowSemanticDigest,
  type FrozenWorkflowSemanticPlan,
} from "../types/workflowSemanticPlan";
import { hasActiveWorkflowRunForCanvas } from "./workflowRunLocks";
import {
  readReadyMediaAssetIdentityCommand,
  readReadyMediaAssetCommand,
} from "./mediaTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import {
  parseImmutableWorkflowPlan,
  WorkflowPlanValidationError,
  type WorkflowContinuationExternalInput,
  type WorkflowContinuationPreview,
  type WorkflowContinuationRelationResponse,
  type WorkflowContinuationSummary,
  type StoredWorkflowNodePlan as StoredNodePlan,
  type StoredWorkflowPlan,
  type WorkflowRunSummary,
} from "../types/workflowRuns";
import { readGenerationResultAdoptionInTransaction } from
  "./generationResultAdoptionQueries";
import {
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
} from "./canvasObservability";

const activeRunStates = ["running", "stopping"] as const;
const terminalNodeStates = ["success", "failed", "blocked", "cancelled"] as const;

type ModelRow = NonNullable<ReturnType<typeof generationTaskApplication.resolveModel>>;

function parsePlan(value: unknown): StoredWorkflowPlan {
  const plan = parseImmutableWorkflowPlan(value);
  try {
    for (const node of plan.nodes) {
      assertModelReleaseRevisionIntegrity(node.modelReleaseRevision);
    }
  } catch {
    throw new WorkflowPlanValidationError(
      "Workflow model release integrity is invalid",
    );
  }
  return plan;
}

function nodeSummaryRows(database: DatabaseSync, runId: string) {
  return database.prepare(`
    SELECT node_id, kind, state, task_id, projection_state, error_code, error_message
    FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
  `).all(runId) as Array<{
    error_code: string | null;
    error_message: string | null;
    kind: NodeInputKind;
    node_id: string;
    projection_state: WorkflowRunSummary["nodes"][number]["projectionState"];
    state: WorkflowRunSummary["nodes"][number]["state"];
    task_id: string | null;
  }>;
}

function clientSemanticFingerprint(row: Record<string, unknown>) {
  try {
    const plan = JSON.parse(String(row.plan_json)) as Record<string, unknown>;
    if (
      typeof plan.clientSemanticFingerprint === "string" &&
      plan.clientSemanticFingerprint.length > 0
    ) return plan.clientSemanticFingerprint;
  } catch {
    // A malformed stored plan must remain inspectable so the sweep can mark it
    // failed and release only resources owned by this run.
  }
  return String(row.semantic_fingerprint);
}

function summary(database: DatabaseSync, row: Record<string, unknown>): WorkflowRunSummary {
  const lockedNodeIds = (database.prepare(`
    SELECT node_id FROM workflow_run_locks
    WHERE run_id = ? ORDER BY node_id
  `).all(String(row.id)) as Array<{ node_id: string }>).map(({ node_id }) =>
    node_id
  );
  return Object.freeze({
    canvasId: String(row.canvas_id),
    clientSemanticFingerprint: clientSemanticFingerprint(row),
    createdAt: String(row.created_at),
    ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
    ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
    groupId: String(row.group_id),
    id: String(row.id),
    lockedNodeIds: Object.freeze(lockedNodeIds),
    nodes: Object.freeze(nodeSummaryRows(database, String(row.id)).map((node) =>
      Object.freeze({
        ...(node.error_code ? { errorCode: node.error_code } : {}),
        ...(node.error_message ? { errorMessage: node.error_message } : {}),
        id: node.node_id,
        kind: node.kind,
        projectionState: node.projection_state,
        state: node.state,
        ...(node.task_id ? { taskId: node.task_id } : {}),
      })
    )),
    semanticFingerprint: String(row.semantic_fingerprint),
    state: row.state as WorkflowRunSummary["state"],
    updatedAt: String(row.updated_at),
  });
}

export function getWorkflowRun(ownerId: string, runId: string) {
  return readAppDatabaseSnapshot((database) => {
    const row = database.prepare(`
      SELECT * FROM workflow_runs WHERE id = ? AND owner_id = ?
    `).get(runId, ownerId) as Record<string, unknown> | undefined;
    return row ? summary(database, row) : undefined;
  });
}

export function listWorkflowRuns(ownerId: string, canvasId: string) {
  return readAppDatabaseSnapshot((database) =>
    (database.prepare(`
      SELECT * FROM workflow_runs
      WHERE owner_id = ? AND canvas_id = ?
      ORDER BY updated_at DESC LIMIT 50
    `).all(ownerId, canvasId) as Record<string, unknown>[])
      .map((row) => summary(database, row))
  );
}

export async function createWorkflowRun(input: {
  canvasId: string;
  clientSemanticFingerprint: string;
  groupId: string;
  ownerId: string;
}) {
  const database = openAppDatabase();
  try {
    const existing = database.prepare(`
      SELECT * FROM workflow_runs
      WHERE owner_id = ? AND canvas_id = ? AND group_id = ?
        AND state IN ('running', 'stopping')
      LIMIT 1
    `).get(input.ownerId, input.canvasId, input.groupId) as
      | Record<string, unknown>
      | undefined;
    if (existing) return summary(database, existing);
    const graph = readPersistedCanvasGraph({
      canvasId: input.canvasId,
      database,
      ownerId: input.ownerId,
    });
    const semantic = compileFrozenWorkflowSemanticPlan({
      edges: graph.edges,
      groupId: input.groupId,
      nodes: graph.nodes,
    });
    if (semantic.semanticFingerprint !== input.clientSemanticFingerprint) {
      throw new Error("画布工作流已变化，请确认当前内容后重新点击一次执行");
    }
    const activeNodeIds = new Set(
      generationTaskApplication.taskStore()
        .listActiveForCanvas(input.canvasId, input.ownerId)
        .map(({ nodeId }) => nodeId),
    );
    const alreadyActive = semantic.executableNodeIds.find((id) => activeNodeIds.has(id));
    if (alreadyActive) {
      throw new Error(`节点 ${alreadyActive} 已有原任务在收口；系统不会重复提交`);
    }
    const storedNodes: StoredNodePlan[] = [];
    for (const node of semantic.nodes) {
      const model = generationTaskApplication.resolveModel(
        node.kind,
        node.modelId,
        input.ownerId,
        database,
      );
      if (!model) throw new Error(`节点 ${node.id} 的已发布模型不可用`);
      const schema = generationTaskApplication.generationModelSchema(node.kind, model);
      const preflight = generationTaskApplication.strictGenerationPreflight({
        body: {
          canvasId: input.canvasId,
          canvasRevision: graph.graphRevision,
          inputSchemaVersion: 1,
          kind: node.kind,
          model: node.modelId,
          nodeId: node.id,
          ownPrompt: node.ownPrompt,
          parameters: node.parameters,
        },
        bypass: false,
        database,
        model,
        ownerId: input.ownerId,
        requireFreshRevision: true,
        targetKind: node.kind,
      });
      const dynamicDependencyIds = new Set(node.dependencies);
      const staticProblem = preflight.problems.find((problem) => {
        if (
          ["EMPTY", "UPLOADING", "INVALID", "MISSING"].includes(problem.code) &&
          problem.edgeId
        ) {
          const edge = semantic.edges.find((candidate) => candidate.id === problem.edgeId);
          return !edge || !dynamicDependencyIds.has(edge.source);
        }
        if (problem.code === "REQUIRED_MISSING") {
          return Object.entries(schema.inputPolicy?.required ?? {}).some(
            ([kind, required]) =>
              preflight.inputs.filter((candidate) =>
                candidate.kind === kind &&
                (
                  candidate.state === "ready" ||
                  dynamicDependencyIds.has(candidate.sourceNodeId)
                )
              ).length < Number(required ?? 0),
          );
        }
        if (problem.code === "ROLE_CONFLICT") {
          return !workflowRoleMinimumCanBeSatisfied({
            dynamicNodeIds: dynamicDependencyIds,
            inputs: preflight.inputs,
            problem,
          });
        }
        if (problem.code === "PROMPT_MISSING") {
          const upstreamTextMayReplaceOwn = node.kind !== "text" ||
            schema.inputPolicy?.promptPolicy === "own-or-upstream-text";
          return !node.ownPrompt && (
            !upstreamTextMayReplaceOwn ||
            !node.dependencies.some((dependencyId) =>
              semantic.nodes.find(({ id }) => id === dependencyId)?.kind === "text"
            )
          );
        }
        return true;
      });
      if (staticProblem) throw new Error(staticProblem.message);
      const release = preflight.modelReleaseRevision;
      if (!release || typeof release !== "object") {
        throw new Error(`节点 ${node.id} 缺少已发布模型合同`);
      }
      const execution = compileRegisteredModelTaskDecision({
        capability: node.kind,
        capabilitySchema: schema,
        costCurrency: model.cost_currency,
        providerDriver: model.provider_driver,
        providerModelId: model.provider_model_id,
        providerProtocol: model.provider_protocol ?? "native",
        revisionIdentity: String(
          (release as Record<string, unknown>).revisionId ?? "",
        ),
      });
      const recovery = workflowRecoveryPolicy(execution.adapterId);
      if (!recovery.workflowEligible) {
        throw new Error(`节点 ${node.id} 的模型不具备整组自动恢复资格`);
      }
      const canonicalParameters = Object.freeze({ ...preflight.parameters });
      const canonicalSemanticNode = {
        dependencies: node.dependencies,
        id: node.id,
        kind: node.kind,
        modelId: node.modelId,
        ownPrompt: node.ownPrompt,
        parameters: canonicalParameters,
        planIndex: node.planIndex,
      };
      storedNodes.push(Object.freeze({
        ...canonicalSemanticNode,
        costCurrency: model.cost_currency,
        modelConfigurationRevision: modelConfigurationRevision({
          ...model,
          capability: node.kind,
        }),
        modelReleaseRevision: release,
        providerDriver: model.provider_driver,
        providerModelId: model.provider_model_id,
        providerProtocol: model.provider_protocol ?? "native",
        providerProfileId: model.provider_profile_id,
        recoveryEvidence: recovery.evidence,
        recoveryGrade: recovery.grade,
        semanticIdentity: workflowSemanticDigest(canonicalSemanticNode),
      }));
    }
    const relevantIds = new Set([
      ...semantic.executableNodeIds,
      ...semantic.externalNodes.map(({ id }) => id),
    ]);
    const authoritativeFingerprint = workflowSemanticDigest({
      baseSemanticFingerprint: semantic.semanticFingerprint,
      nodes: storedNodes.map((node) => ({
        id: node.id,
        modelConfigurationRevision: node.modelConfigurationRevision,
        modelReleaseRevision: node.modelReleaseRevision,
        recoveryGrade: node.recoveryGrade,
        semanticIdentity: node.semanticIdentity,
      })),
    });
    const plan = parsePlan({
      ...semantic,
      clientSemanticFingerprint: semantic.semanticFingerprint,
      externalNodes: semantic.externalNodes.map((node) => ({
        data: {
          ...(node.assetId ? { assetId: node.assetId } : {}),
          ...(node.content ? { content: node.content } : {}),
          ...(node.inputState ? { inputState: node.inputState } : {}),
        },
        id: node.id,
        type: node.kind,
      })),
      nodes: storedNodes,
      semanticFingerprint: authoritativeFingerprint,
    });
    const reservationBytes = workflowMediaCapacity.estimate(
      storedNodes.map(({ kind }) => kind),
    );
    const capacityInspection = await workflowMediaCapacity.inspect(reservationBytes);
    const runId = randomUUID();
    const now = new Date();
    const timestamp = now.toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = database.prepare(`
        SELECT * FROM workflow_runs
        WHERE owner_id = ? AND canvas_id = ? AND group_id = ?
          AND state IN ('running', 'stopping')
        LIMIT 1
      `).get(input.ownerId, input.canvasId, input.groupId) as
        | Record<string, unknown>
        | undefined;
      if (existing) {
        database.exec("COMMIT");
        return summary(database, existing);
      }
      if (!canvasGraphRevisionMatchesInTransaction({
        canvasId: input.canvasId,
        database,
        graphRevision: graph.graphRevision,
        ownerId: input.ownerId,
      })) {
        throw new Error("画布在整组准入期间发生变化，请重新点击一次执行");
      }
      for (const nodeId of semantic.executableNodeIds) {
        if (generationTaskApplication.hasActiveGenerationTaskForNodeInTransaction(database, {
          canvasId: input.canvasId,
          nodeId,
          ownerId: input.ownerId,
        })) {
          throw new Error(`节点 ${nodeId} 已有原任务在收口；系统不会重复提交`);
        }
        const node = storedNodes.find(({ id }) => id === nodeId)!;
        if (generationTaskApplication.hasUnresolvedGenerationOutcomeForNodeInTransaction(
          database,
          {
            canvasId: input.canvasId,
            kind: node.kind,
            nodeId,
            ownerId: input.ownerId,
          },
        )) {
          throw new Error(`节点 ${nodeId} 的原任务结果仍不明确；系统不会重复提交`);
        }
      }
      database.prepare(`
        INSERT INTO workflow_runs (
          id, owner_id, canvas_id, group_id, graph_revision,
          semantic_fingerprint, plan_json, state, stop_requested,
          reservation_id, error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 0, NULL, NULL, NULL, ?, ?)
      `).run(
        runId,
        input.ownerId,
        input.canvasId,
        input.groupId,
        graph.graphRevision,
        authoritativeFingerprint,
        JSON.stringify(plan),
        timestamp,
        timestamp,
      );
      for (const nodeId of relevantIds) {
        database.prepare(`
          INSERT INTO workflow_run_locks (
            owner_id, canvas_id, node_id, run_id, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(input.ownerId, input.canvasId, nodeId, runId, timestamp);
      }
      const reservationId = workflowMediaCapacity.reserveInTransaction({
        bytes: reservationBytes,
        database,
        inspectedAvailableBytes: capacityInspection.availableBytes,
        now,
        ownerId: input.ownerId,
        runId,
      });
      database.prepare(`
        UPDATE workflow_runs SET reservation_id = ? WHERE id = ?
      `).run(reservationId, runId);
      for (const node of storedNodes) {
        const idempotencyKey = `wf1:${workflowSemanticDigest([
          runId,
          node.id,
          node.semanticIdentity,
        ])}`;
        database.prepare(`
          INSERT INTO workflow_run_nodes (
            run_id, owner_id, node_id, kind, plan_index, dependencies_json,
            semantic_identity, idempotency_key, state, task_id,
            projection_state, error_code, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 'pending', NULL, NULL, ?, ?)
        `).run(
          runId,
          input.ownerId,
          node.id,
          node.kind,
          node.planIndex,
          JSON.stringify(node.dependencies),
          node.semanticIdentity,
          idempotencyKey,
          timestamp,
          timestamp,
        );
      }
      const row = database.prepare("SELECT * FROM workflow_runs WHERE id = ?")
        .get(runId) as Record<string, unknown>;
      database.exec("COMMIT");
      kickWorkflowRunner();
      return summary(database, row);
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

export function stopWorkflowRun(ownerId: string, runId: string) {
  const database = openAppDatabase();
  let result: WorkflowRunSummary | undefined;
  let shouldKick = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const current = database.prepare(`
        SELECT * FROM workflow_runs WHERE id = ? AND owner_id = ?
      `).get(runId, ownerId) as Record<string, unknown> | undefined;
      if (current?.state === "running") {
        const changed = database.prepare(`
          UPDATE workflow_runs
          SET stop_requested = 1, state = 'stopping', updated_at = ?
          WHERE id = ? AND owner_id = ? AND state = 'running'
        `).run(new Date().toISOString(), runId, ownerId);
        if (changed.changes !== 1) throw new Error("Workflow stop changed concurrently");
        shouldKick = true;
      } else if (current?.state === "stopping") {
        shouldKick = true;
      }
      const latest = current
        ? database.prepare("SELECT * FROM workflow_runs WHERE id = ?")
            .get(runId) as Record<string, unknown>
        : undefined;
      database.exec("COMMIT");
      result = latest ? summary(database, latest) : undefined;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  if (shouldKick) kickWorkflowRunner();
  return result;
}

export class WorkflowContinuationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = "WorkflowContinuationError";
  }
}

type WorkflowTask = NonNullable<
  ReturnType<ReturnType<typeof generationTaskApplication.taskStore>["get"]>
>;

type WorkflowNodeRow = Readonly<{
  dependencies_json: string;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string;
  kind: NodeInputKind;
  node_id: string;
  plan_index: number;
  projection_state: WorkflowRunSummary["nodes"][number]["projectionState"];
  state: WorkflowRunSummary["nodes"][number]["state"];
  task_id: string | null;
}>;

type ContinuationSource = Readonly<{
  externalNode: Readonly<{
    data: Readonly<Record<string, unknown>>;
    id: string;
    type: NodeInputKind;
  }>;
  provenance: WorkflowContinuationExternalInput;
}>;

type ContinuationBuild = Readonly<{
  childPlan?: StoredWorkflowPlan;
  externalInputs: readonly WorkflowContinuationExternalInput[];
  parentPlan: StoredWorkflowPlan;
  preview: WorkflowContinuationPreview;
  preservedNodeIds: readonly string[];
  selectedNodeIds: readonly string[];
}>;

function continuationError(code: string, message: string, statusCode = 409): never {
  throw new WorkflowContinuationError(code, message, statusCode);
}

function continuationRow(database: DatabaseSync, ownerId: string, parentRunId: string) {
  return database.prepare(`
    SELECT id, owner_id, parent_run_id, child_run_id, intent_id, preview_digest,
           parent_graph_revision, child_graph_revision, parent_plan_digest,
           child_plan_digest, selected_node_ids_json, frozen_external_inputs_json,
           canonical_adoption_receipt_id, created_at, updated_at
    FROM workflow_run_continuations
    WHERE owner_id = ? AND parent_run_id = ?
  `).get(ownerId, parentRunId) as Record<string, unknown> | undefined;
}

function continuationSummary(row: Record<string, unknown>): WorkflowContinuationSummary {
  return Object.freeze({
    childRunId: String(row.child_run_id),
    continuationId: String(row.id),
    createdAt: String(row.created_at),
    intentId: String(row.intent_id),
    parentRunId: String(row.parent_run_id),
    previewDigest: String(row.preview_digest),
    updatedAt: String(row.updated_at),
  });
}

function existingContinuationResultInTransaction(
  database: DatabaseSync,
  ownerId: string,
  parentRunId: string,
  previewDigest: string,
) {
  const existing = continuationRow(database, ownerId, parentRunId);
  if (!existing) return undefined;
  if (String(existing.preview_digest) !== previewDigest) {
    continuationError(
      "WORKFLOW_CONTINUATION_PREVIEW_CONFLICT",
      "继续预览已经变化，请重新读取后再操作",
    );
  }
  const child = database.prepare(`
    SELECT * FROM workflow_runs WHERE id = ? AND owner_id = ?
  `).get(String(existing.child_run_id), ownerId) as Record<string, unknown> | undefined;
  if (!child) {
    continuationError("WORKFLOW_CONTINUATION_CORRUPT", "后继整组记录不完整");
  }
  return Object.freeze({
    continuation: continuationSummary(existing),
    run: summary(database, child),
  });
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readyMediaInTransaction(
  database: DatabaseSync,
  ownerId: string,
  kind: Exclude<NodeInputKind, "text">,
  assetId: string,
) {
  return Boolean(executeTransactionScopedCommand(
    database,
    readReadyMediaAssetCommand,
    { assetId, kind, ownerId },
  ));
}

type FrozenMediaIdentity = Readonly<{
  assetId: string;
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  durationSeconds: number | null;
  durationStatus: "failed" | "not-applicable" | "pending" | "ready";
  kind: Exclude<NodeInputKind, "text">;
  mediaHeight: number | null;
  mediaWidth: number | null;
  objectKey: string;
  storageBackend: "local" | "oss";
  storageName: string;
  storageProfileId: string | null;
}>;

type FrozenMediaEvidence = Readonly<Pick<FrozenMediaIdentity,
  "byteSize" | "checksumSha256" | "contentType" | "objectKey" |
  "storageBackend" | "storageName" | "storageProfileId">>;

const mediaChecksumPattern = /^[0-9a-f]{64}$/i;

/**
 * Read the complete server-owned identity used to freeze a media external
 * input.  The regular ready check is intentionally insufficient here: an
 * asset id can remain stable while its bytes or storage object metadata is
 * replaced.  Missing identity is unsafe and therefore fails closed before a
 * successor can be created or a Provider task can be admitted.
 */
function readReadyMediaIdentityInTransaction(
  database: DatabaseSync,
  ownerId: string,
  kind: Exclude<NodeInputKind, "text">,
  assetId: string,
): FrozenMediaIdentity | undefined {
  // Admission checks also run outside a write transaction. Own a short read
  // snapshot there; adoption/continuation creation retain their caller's TX.
  const ownsSnapshot = !database.isTransaction;
  if (ownsSnapshot) database.exec("BEGIN");
  let row: ReturnType<typeof readReadyMediaAssetIdentityCommand.execute>;
  try {
    row = executeTransactionScopedCommand(database, readReadyMediaAssetIdentityCommand,
      { assetId, kind, ownerId });
    if (ownsSnapshot) database.exec("COMMIT");
  } catch (error) {
    if (ownsSnapshot && database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
  if (!row || row.id !== assetId || row.kind !== kind ||
      !Number.isSafeInteger(row.byteSize) || row.byteSize < 1 ||
      !row.checksumSha256 || !mediaChecksumPattern.test(row.checksumSha256) ||
      !row.contentType || row.contentType.length > 200 ||
      /[\u0000\r\n]/.test(row.contentType) ||
      !row.storageName || row.storageName.length > 255 ||
      /[/\\\u0000\r\n]/.test(row.storageName) ||
      !row.objectKey || row.objectKey.length > 2_000 ||
      /[\u0000\r\n]/.test(row.objectKey) ||
      (row.storageProfileId !== null &&
        (row.storageProfileId.length < 1 || row.storageProfileId.length > 200)) ||
      row.storageBackend === "oss" && !row.storageProfileId) return undefined;
  const optionalDimension = (value: unknown) =>
    value === null || value === undefined
      ? null
      : Number.isSafeInteger(value) && Number(value) > 0
        ? Number(value)
        : undefined;
  const mediaHeight = optionalDimension(row.mediaHeight);
  const mediaWidth = optionalDimension(row.mediaWidth);
  const durationSeconds = row.durationSeconds === null || row.durationSeconds === undefined
    ? null
    : Number.isFinite(Number(row.durationSeconds)) && Number(row.durationSeconds) >= 0
      ? Number(row.durationSeconds)
      : undefined;
  if (mediaHeight === undefined || mediaWidth === undefined || durationSeconds === undefined) {
    return undefined;
  }
  return Object.freeze({
    assetId,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256.toLowerCase(),
    contentType: row.contentType,
    durationSeconds,
    durationStatus: row.durationStatus,
    kind,
    mediaHeight,
    mediaWidth,
    objectKey: row.objectKey,
    storageBackend: row.storageBackend,
    storageName: row.storageName,
    storageProfileId: row.storageProfileId === null
      ? null
      : row.storageProfileId,
  });
}

function mediaEvidence(media: FrozenMediaIdentity): FrozenMediaEvidence {
  return Object.freeze({
    byteSize: media.byteSize,
    checksumSha256: media.checksumSha256,
    contentType: media.contentType,
    objectKey: media.objectKey,
    storageBackend: media.storageBackend,
    storageName: media.storageName,
    storageProfileId: media.storageProfileId,
  });
}

function mediaExternalNodeData(media: FrozenMediaIdentity) {
  const evidence = mediaEvidence(media);
  return Object.freeze({
    assetId: media.assetId,
    inputState: "ready",
    mediaByteSize: media.byteSize,
    mediaContentType: media.contentType,
    mediaDurationSeconds: media.durationSeconds ?? undefined,
    mediaHeight: media.mediaHeight ?? undefined,
    mediaMetadataSource: "server",
    mediaMetadataStatus: media.kind === "image" ? "ready" : media.durationStatus,
    mediaStorageBackend: media.storageBackend,
    mediaWidth: media.mediaWidth ?? undefined,
    [`${media.kind}Src`]: `/api/${media.kind === "image" ? "assets" : `${media.kind}-assets`}/${media.assetId}`,
    sourceAssetByteSize: evidence.byteSize,
    sourceAssetContentType: evidence.contentType,
    sourceAssetObjectKey: evidence.objectKey,
    sourceAssetSha256: evidence.checksumSha256,
    sourceAssetStorageBackend: evidence.storageBackend,
    sourceAssetStorageName: evidence.storageName,
    sourceAssetStorageProfileId: evidence.storageProfileId,
  });
}

function mediaIdentityFromExternalNode(
  kind: Exclude<NodeInputKind, "text">,
  data: Record<string, unknown>,
): FrozenMediaIdentity | undefined {
  const assetId = typeof data.assetId === "string" && data.assetId.length > 0
    ? data.assetId
    : undefined;
  const byteSize = data.sourceAssetByteSize;
  const contentType = data.sourceAssetContentType;
  const objectKey = data.sourceAssetObjectKey;
  const checksumSha256 = data.sourceAssetSha256;
  const storageBackend = data.sourceAssetStorageBackend;
  const storageName = data.sourceAssetStorageName;
  const storageProfileId = data.sourceAssetStorageProfileId;
  if (!assetId || !Number.isSafeInteger(byteSize) || Number(byteSize) < 1 ||
      typeof contentType !== "string" || contentType.length < 1 || contentType.length > 200 ||
      /[\u0000\r\n]/.test(contentType) ||
      typeof objectKey !== "string" || objectKey.length < 1 || objectKey.length > 2_000 ||
      /[\u0000\r\n]/.test(objectKey) ||
      typeof storageName !== "string" || storageName.length < 1 || storageName.length > 255 ||
      /[/\\\u0000\r\n]/.test(storageName) ||
      typeof checksumSha256 !== "string" || !mediaChecksumPattern.test(checksumSha256) ||
      (storageBackend !== "local" && storageBackend !== "oss") ||
      (storageProfileId !== null && typeof storageProfileId !== "string") ||
      (typeof storageProfileId === "string" &&
        (storageProfileId.length < 1 || storageProfileId.length > 200)) ||
      storageBackend === "oss" && !storageProfileId) return undefined;
  return Object.freeze({
    assetId,
    byteSize: Number(byteSize),
    checksumSha256: checksumSha256.toLowerCase(),
    contentType,
    durationSeconds: null,
    durationStatus: "pending" as const,
    kind,
    mediaHeight: null,
    mediaWidth: null,
    objectKey,
    storageBackend,
    storageName,
    storageProfileId,
  });
}

function sameFrozenMediaIdentity(
  actual: FrozenMediaIdentity | undefined,
  expected: FrozenMediaIdentity | undefined,
) {
  return Boolean(actual && expected &&
    actual.assetId === expected.assetId &&
    actual.byteSize === expected.byteSize &&
    actual.checksumSha256 === expected.checksumSha256 &&
    actual.contentType === expected.contentType &&
    actual.objectKey === expected.objectKey &&
    actual.storageBackend === expected.storageBackend &&
    actual.storageName === expected.storageName &&
    actual.storageProfileId === expected.storageProfileId);
}

function frozenTaskSource(
  database: DatabaseSync,
  runRow: Record<string, unknown>,
  parentPlan: StoredWorkflowPlan,
  nodePlan: StoredNodePlan,
  nodeRow: WorkflowNodeRow,
  task: WorkflowTask,
  adoption: ReturnType<typeof readGenerationResultAdoptionInTransaction>,
): ContinuationSource | undefined {
  if (
    task.ownerId !== String(runRow.owner_id) ||
    task.canvasId !== String(runRow.canvas_id) ||
    task.nodeId !== nodePlan.id ||
    task.kind !== nodePlan.kind ||
    task.state !== "success" ||
    !exactWorkflowTaskBinding({
      nodePlan,
      nodeRow: nodeRow as unknown as Record<string, unknown>,
      plan: parentPlan,
      runRow,
      task,
    })
  ) return undefined;
  const adopted = adoption &&
    adoption.ownerId === String(runRow.owner_id) &&
    adoption.taskId === task.id &&
    adoption.canvasId === String(runRow.canvas_id) &&
    adoption.nodeId === nodePlan.id &&
    adoption.runId === String(runRow.id) &&
    adoption.executionAttempt === task.attempt
    ? adoption
    : undefined;
  if (nodeRow.state !== "success" && !adopted) return undefined;
  if (nodePlan.kind === "text") {
    if (typeof task.resultText !== "string" || task.resultText.trim().length < 1) {
      return undefined;
    }
    return Object.freeze({
      externalNode: Object.freeze({
        data: Object.freeze({ content: task.resultText }),
        id: nodePlan.id,
        type: nodePlan.kind,
      }),
      provenance: Object.freeze({
        ...(adopted ? { adoptionReceiptId: adopted.id } : {}),
        kind: nodePlan.kind,
        nodeId: nodePlan.id,
        source: adopted ? "adopted-result" as const : "successful-task" as const,
        sourceRunId: String(runRow.id),
        sourceTaskId: task.id,
        sourceTextSha256: sha256Text(task.resultText),
      }),
    });
  }
  const assetId = adopted?.canonicalAssetId ?? task.resultAssetId ?? "";
  const media = assetId
    ? readReadyMediaIdentityInTransaction(
        database,
        String(runRow.owner_id),
        nodePlan.kind,
        assetId,
      )
    : undefined;
  if (!media) return undefined;
  return Object.freeze({
    externalNode: Object.freeze({
      data: mediaExternalNodeData(media),
      id: nodePlan.id,
      type: nodePlan.kind,
    }),
    provenance: Object.freeze({
      ...(adopted ? { adoptionReceiptId: adopted.id } : {}),
      kind: nodePlan.kind,
      nodeId: nodePlan.id,
      source: adopted ? "adopted-result" as const : "successful-task" as const,
      sourceAssetId: assetId,
      sourceRunId: String(runRow.id),
      sourceTaskId: task.id,
      sourceAssetByteSize: media.byteSize,
      sourceAssetContentType: media.contentType,
      sourceAssetObjectKey: media.objectKey,
      sourceAssetSha256: media.checksumSha256,
      sourceAssetStorageBackend: media.storageBackend,
      sourceAssetStorageName: media.storageName,
      sourceAssetStorageProfileId: media.storageProfileId,
    }),
  });
}

function parentExternalSource(
  database: DatabaseSync,
  ownerId: string,
  runRow: Record<string, unknown>,
  node: StoredWorkflowPlan["externalNodes"][number],
): ContinuationSource | undefined {
  const content = typeof node.data.content === "string" ? node.data.content : undefined;
  const assetId = typeof node.data.assetId === "string" ? node.data.assetId : undefined;
  if (node.type === "text" && (!content || content.trim().length < 1)) return undefined;
  if (node.type !== "text" && !assetId) return undefined;
  if (node.type === "text") {
    return Object.freeze({
      externalNode: Object.freeze({
        data: Object.freeze({ ...node.data, content }),
        id: node.id,
        type: node.type,
      }),
      provenance: Object.freeze({
        kind: node.type,
        nodeId: node.id,
        source: "parent-external" as const,
        sourceRunId: String(runRow.id),
        sourceTextSha256: sha256Text(content!),
      }),
    });
  }
  const media = readReadyMediaIdentityInTransaction(database, ownerId, node.type, assetId!);
  if (!media) return undefined;
  // A continuation of a continuation must retain its parent's frozen bytes.
  // Legacy external inputs have no sourceAsset fields and are frozen here once.
  const hasFrozenIdentity = Object.keys(node.data).some((key) => key.startsWith("sourceAsset"));
  if (hasFrozenIdentity && !sameFrozenMediaIdentity(
    media,
    mediaIdentityFromExternalNode(node.type, node.data as Record<string, unknown>),
  )) return undefined;
  return Object.freeze({
    externalNode: Object.freeze({
      data: mediaExternalNodeData(media),
      id: node.id,
      type: node.type,
    }),
    provenance: Object.freeze({
      kind: node.type,
      nodeId: node.id,
      source: "parent-external" as const,
      sourceAssetByteSize: media.byteSize,
      sourceAssetContentType: media.contentType,
      sourceAssetId: media.assetId,
      sourceAssetObjectKey: media.objectKey,
      sourceAssetSha256: media.checksumSha256,
      sourceAssetStorageBackend: media.storageBackend,
      sourceAssetStorageName: media.storageName,
      sourceAssetStorageProfileId: media.storageProfileId,
      sourceRunId: String(runRow.id),
    }),
  });
}

function continuationBuild(
  database: DatabaseSync,
  ownerId: string,
  parentRunId: string,
): ContinuationBuild {
  const runRow = database.prepare(`
    SELECT * FROM workflow_runs WHERE id = ? AND owner_id = ?
  `).get(parentRunId, ownerId) as Record<string, unknown> | undefined;
  if (!runRow) continuationError("WORKFLOW_RUN_NOT_FOUND", "整组执行不存在", 404);
  if (String(runRow.state) !== "failed") {
    continuationError(
      "WORKFLOW_CONTINUATION_PARENT_NOT_FAILED",
      "只有已经失败的整组执行可以继续未完成节点",
    );
  }
  let parentPlan: StoredWorkflowPlan;
  try {
    parentPlan = parsePlan(runRow.plan_json);
  } catch {
    continuationError("WORKFLOW_CONTINUATION_PARENT_INVALID", "原整组计划无法安全读取");
  }
  if (String(runRow.semantic_fingerprint) !== parentPlan.semanticFingerprint) {
    continuationError("WORKFLOW_CONTINUATION_PARENT_INVALID", "原整组身份校验失败");
  }
  let graph;
  try {
    graph = readPersistedCanvasGraph({
      canvasId: String(runRow.canvas_id),
      database,
      ownerId,
    });
  } catch {
    continuationError("WORKFLOW_CONTINUATION_GRAPH_CHANGED", "当前画布无法安全核对，未继续生成");
  }
  if (graph.graphRevision !== Number(runRow.graph_revision)) {
    continuationError(
      "WORKFLOW_CONTINUATION_GRAPH_CHANGED",
      "当前画布已变化，请先保存当前内容后再继续未完成节点",
    );
  }
  try {
    const semantic = compileFrozenWorkflowSemanticPlan({
      edges: graph.edges,
      groupId: parentPlan.groupId,
      nodes: graph.nodes,
    });
    if (semantic.semanticFingerprint !== parentPlan.clientSemanticFingerprint) {
      continuationError(
        "WORKFLOW_CONTINUATION_GRAPH_CHANGED",
        "当前画布的节点、连线、提示词或模型已变化，未静默重跑旧工作流",
      );
    }
  } catch (error) {
    if (error instanceof WorkflowContinuationError) throw error;
    continuationError(
      "WORKFLOW_CONTINUATION_GRAPH_CHANGED",
      "当前画布无法与原整组执行匹配，未继续生成",
    );
  }
  const rows = database.prepare(`
    SELECT node_id, kind, plan_index, dependencies_json, idempotency_key,
           state, task_id, projection_state, error_code, error_message
    FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
  `).all(parentRunId) as WorkflowNodeRow[];
  if (rows.length !== parentPlan.nodes.length) {
    continuationError("WORKFLOW_CONTINUATION_PARENT_INVALID", "原整组节点账本不完整");
  }
  const rowById = new Map(rows.map((row) => [row.node_id, row]));
  const preserved = new Map<string, ContinuationSource>();
  for (const nodePlan of parentPlan.nodes) {
    const row = rowById.get(nodePlan.id);
    if (!row) continuationError("WORKFLOW_CONTINUATION_PARENT_INVALID", "原整组节点身份不完整");
    if (!row.task_id) continue;
    // Continuation preview already runs inside the caller-owned transaction.
    // Reading through the process task-store singleton would use another
    // SQLite connection (and, in a disposable test root, can even point at a
    // different data directory), so successful upstream tasks would appear
    // missing and the whole preview would fail closed.  Keep the read on this
    // transaction so the same snapshot and owner fence are used throughout.
    const task = generationTaskApplication.readGenerationTaskInTransaction(
      database,
      row.task_id,
    );
    if (!task || task.attempt < 1) continue;
    let adoption: ReturnType<typeof readGenerationResultAdoptionInTransaction>;
    try {
      adoption = readGenerationResultAdoptionInTransaction(database, {
        executionAttempt: task.attempt,
        ownerId,
        taskId: task.id,
      });
    } catch {
      adoption = undefined;
    }
    const source = frozenTaskSource(
      database,
      runRow,
      parentPlan,
      nodePlan,
      row,
      task,
      adoption,
    );
    if (source) preserved.set(nodePlan.id, source);
  }
  const selected = new Set<string>();
  for (const nodePlan of parentPlan.nodes) {
    const row = rowById.get(nodePlan.id)!;
    if (!(["pending", "blocked"] as string[]).includes(row.state) || row.task_id) continue;
    if (nodePlan.dependencies.every((dependency) =>
      selected.has(dependency) || preserved.has(dependency)
    )) selected.add(nodePlan.id);
  }
  const selectedNodeIds = parentPlan.nodes
    .filter(({ id }) => selected.has(id))
    .map(({ id }) => id);
  const preservedNodeIds = parentPlan.nodes
    .filter(({ id }) => preserved.has(id))
    .map(({ id }) => id);
  const blockedNodeIds = parentPlan.nodes
    .filter(({ id }) => rowById.get(id)?.state === "blocked" && !selected.has(id))
    .map(({ id }) => id);
  const parentExternal = new Map(parentPlan.externalNodes.map((node) => [node.id, node]));
  const usedSources = new Set<string>();
  const childEdges = parentPlan.edges.filter((edge) => {
    if (!selected.has(edge.target)) return false;
    // A selected source is another node in the successor plan, so its edge
    // stays in the child DAG but it is not an external input.  Only frozen
    // parent results (or explicit parent external nodes) belong in
    // `sourceMap`; treating a selected source as external makes a chained
    // frontier such as 09 -> 10 -> 11 fail at 10 because node 09 has not
    // produced a result yet.
    if (selected.has(edge.source)) return true;
    if (preserved.has(edge.source)) {
      usedSources.add(edge.source);
      return true;
    }
    if (parentExternal.has(edge.source)) {
      usedSources.add(edge.source);
      return true;
    }
    return false;
  });
  const sourceMap = new Map<string, ContinuationSource>();
  for (const id of usedSources) {
    const source = preserved.get(id) ??
      (parentExternal.has(id)
        ? parentExternalSource(database, ownerId, runRow, parentExternal.get(id)!)
        : undefined);
    if (!source) continuationError("WORKFLOW_CONTINUATION_SOURCE_UNAVAILABLE", "上游结果暂时无法安全读取，未继续生成");
    if (source.externalNode.type !== "text") {
      const expected = mediaIdentityFromExternalNode(
        source.externalNode.type,
        source.externalNode.data as Record<string, unknown>,
      );
      const actual = expected
        ? readReadyMediaIdentityInTransaction(database, ownerId, source.externalNode.type, expected.assetId)
        : undefined;
      if (!sameFrozenMediaIdentity(actual, expected)) {
        continuationError("WORKFLOW_CONTINUATION_SOURCE_UNAVAILABLE", "上游媒体结果已变化或无法完整核验，未继续生成");
      }
    }
    sourceMap.set(id, source);
  }
  const externalInputs = [...sourceMap.values()]
    .map(({ provenance }) => provenance)
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  let childPlan: StoredWorkflowPlan | undefined;
  if (selectedNodeIds.length > 0) {
    const selectedSet = new Set(selectedNodeIds);
    const nodes = selectedNodeIds.map((id, planIndex) => {
      const original = parentPlan.nodes.find((node) => node.id === id)!;
      const dependencies = original.dependencies.filter((dependency) => selectedSet.has(dependency));
      const semanticNode = {
        dependencies,
        id: original.id,
        kind: original.kind,
        modelId: original.modelId,
        ownPrompt: original.ownPrompt,
        parameters: original.parameters,
        planIndex,
      };
      return Object.freeze({
        ...original,
        ...semanticNode,
        semanticIdentity: workflowSemanticDigest(semanticNode),
      });
    });
    const externalNodes = [...sourceMap.values()]
      .map(({ externalNode }) => externalNode)
      .sort((left, right) => left.id.localeCompare(right.id));
    const childSemanticFingerprint = workflowSemanticDigest({
      baseSemanticFingerprint: parentPlan.clientSemanticFingerprint,
      edges: childEdges,
      externalNodes,
      groupId: parentPlan.groupId,
      nodes: nodes.map((node) => ({
        id: node.id,
        modelConfigurationRevision: node.modelConfigurationRevision,
        modelReleaseRevision: node.modelReleaseRevision,
        recoveryGrade: node.recoveryGrade,
        semanticIdentity: node.semanticIdentity,
      })),
    });
    childPlan = parsePlan({
      clientSemanticFingerprint: parentPlan.clientSemanticFingerprint,
      edges: childEdges,
      executableNodeIds: selectedNodeIds,
      externalNodes,
      groupId: parentPlan.groupId,
      nodes,
      semanticFingerprint: childSemanticFingerprint,
      version: 1,
    });
  }
  const previewDigest = workflowSemanticDigest({
    blockedNodeIds,
    candidateNodeIds: selectedNodeIds,
    currentGraphRevision: graph.graphRevision,
    externalInputs,
    groupId: parentPlan.groupId,
    parentGraphRevision: Number(runRow.graph_revision),
    parentPlanDigest: parentPlan.semanticFingerprint,
    parentRunId,
    preservedNodeIds,
    ...(childPlan ? { childPlanDigest: childPlan.semanticFingerprint } : {}),
  });
  const preview: WorkflowContinuationPreview = Object.freeze({
    blockedNodeIds: Object.freeze(blockedNodeIds),
    candidateNodeIds: Object.freeze(selectedNodeIds),
    canvasId: String(runRow.canvas_id),
    currentGraphRevision: graph.graphRevision,
    estimatedNewNodeCount: selectedNodeIds.length,
    externalInputs: Object.freeze(externalInputs),
    groupId: parentPlan.groupId,
    parentGraphRevision: Number(runRow.graph_revision),
    parentPlanDigest: parentPlan.semanticFingerprint,
    parentRunId,
    parentState: "failed",
    preservedNodeIds: Object.freeze(preservedNodeIds),
    previewDigest,
    ...(selectedNodeIds.length === 0
      ? { reason: "没有同时满足原始账本和当前输入核验的未准入节点" }
      : {}),
    requiresUserIntent: true,
  });
  return Object.freeze({
    ...(childPlan ? { childPlan } : {}),
    externalInputs: Object.freeze(externalInputs),
    parentPlan,
    preview,
    preservedNodeIds: Object.freeze(preservedNodeIds),
    selectedNodeIds: Object.freeze(selectedNodeIds),
  });
}

function withContinuationRead<T>(
  ownerId: string,
  parentRunId: string,
  read: (database: DatabaseSync) => T,
) {
  const database = openAppDatabase();
  try {
    database.exec("BEGIN");
    try {
      const result = read(database);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

export function getWorkflowContinuationPreview(ownerId: string, parentRunId: string) {
  return withContinuationRead(ownerId, parentRunId, (database) =>
    continuationBuild(database, ownerId, parentRunId).preview
  );
}

export function getWorkflowContinuation(
  ownerId: string,
  parentRunId: string,
): WorkflowContinuationRelationResponse {
  const database = openAppDatabase();
  try {
    const row = continuationRow(database, ownerId, parentRunId);
    return Object.freeze({ continuation: row ? continuationSummary(row) : null });
  } finally {
    database.close();
  }
}

export async function continueWorkflowRun(input: {
  intentId: string;
  ownerId: string;
  parentRunId: string;
  previewDigest: string;
}) {
  if (!/^[a-zA-Z0-9._:-]{1,256}$/.test(input.intentId) ||
      !/^[a-zA-Z0-9._:-]{1,256}$/.test(input.previewDigest)) {
    continuationError("WORKFLOW_CONTINUATION_INTENT_INVALID", "继续整组执行的意图无效", 400);
  }
  const database = openAppDatabase();
  let result: { continuation: WorkflowContinuationSummary; run: WorkflowRunSummary } | undefined;
  let shouldKick = false;
  try {
    // A durable parent->child relation is the idempotency authority.  Read it
    // before any preview rebuild or capacity inspection so a refresh, a
    // second tab, or a transient capacity failure can never turn an already
    // created successor into a new admission attempt.
    database.exec("BEGIN");
    try {
      const existing = existingContinuationResultInTransaction(
        database,
        input.ownerId,
        input.parentRunId,
        input.previewDigest,
      );
      database.exec("COMMIT");
      if (existing) return existing;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
    const initial = withContinuationRead(input.ownerId, input.parentRunId, (readDatabase) =>
      continuationBuild(readDatabase, input.ownerId, input.parentRunId)
    );
    const capacityInspection = await workflowMediaCapacity.inspect(
      workflowMediaCapacity.estimate(initial.selectedNodeIds.map((id) =>
        initial.parentPlan.nodes.find((node) => node.id === id)!.kind
      )),
    );
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = existingContinuationResultInTransaction(
        database,
        input.ownerId,
        input.parentRunId,
        input.previewDigest,
      );
      if (existing) {
        database.exec("COMMIT");
        return existing;
      }
      const built = continuationBuild(database, input.ownerId, input.parentRunId);
      if (built.preview.previewDigest !== input.previewDigest) {
        continuationError("WORKFLOW_CONTINUATION_PREVIEW_STALE", "当前画布或原结果已变化，请重新读取继续预览");
      }
      if (!built.childPlan || built.selectedNodeIds.length === 0) {
        continuationError("WORKFLOW_CONTINUATION_NO_SAFE_NODES", "当前没有可以安全继续的未完成节点");
      }
      const active = database.prepare(`
        SELECT 1 FROM workflow_runs
        WHERE owner_id = ? AND canvas_id = ? AND group_id = ?
          AND state IN ('running', 'stopping')
        LIMIT 1
      `).get(
        input.ownerId,
        built.preview.canvasId,
        built.preview.groupId,
      );
      if (active) continuationError("WORKFLOW_CONTINUATION_ACTIVE_CONFLICT", "当前组已有执行正在收口，请等待它完成");
      for (const nodeId of built.selectedNodeIds) {
        const nodePlan = built.childPlan.nodes.find(({ id }) => id === nodeId)!;
        if (generationTaskApplication.hasActiveGenerationTaskForNodeInTransaction(database, {
          canvasId: built.preview.canvasId,
          nodeId,
          ownerId: input.ownerId,
        })) continuationError("WORKFLOW_CONTINUATION_NODE_CONFLICT", `节点 ${nodeId} 已有任务正在收口`);
        if (generationTaskApplication.hasUnresolvedGenerationOutcomeForNodeInTransaction(database, {
          canvasId: built.preview.canvasId,
          kind: nodePlan.kind,
          nodeId,
          ownerId: input.ownerId,
        })) continuationError("WORKFLOW_CONTINUATION_NODE_UNRESOLVED", `节点 ${nodeId} 的原结果仍不明确，未重复提交`);
      }
      const childRunId = randomUUID();
      const continuationId = randomUUID();
      const timestamp = new Date().toISOString();
      database.prepare(`
        INSERT INTO workflow_runs (
          id, owner_id, canvas_id, group_id, graph_revision,
          semantic_fingerprint, plan_json, state, stop_requested,
          reservation_id, error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 0, NULL, NULL, NULL, ?, ?)
      `).run(
        childRunId,
        input.ownerId,
        built.preview.canvasId,
        built.preview.groupId,
        built.preview.currentGraphRevision,
        built.childPlan.semanticFingerprint,
        JSON.stringify(built.childPlan),
        timestamp,
        timestamp,
      );
      const relevantIds = new Set([
        ...built.childPlan.executableNodeIds,
        ...built.childPlan.externalNodes.map(({ id }) => id),
      ]);
      for (const nodeId of relevantIds) {
        database.prepare(`
          INSERT INTO workflow_run_locks (
            owner_id, canvas_id, node_id, run_id, created_at
          ) VALUES (?, ?, ?, ?, ?)
        `).run(input.ownerId, built.preview.canvasId, nodeId, childRunId, timestamp);
      }
      const reservationBytes = workflowMediaCapacity.estimate(
        built.childPlan.nodes.map(({ kind }) => kind),
      );
      const reservationId = workflowMediaCapacity.reserveInTransaction({
        bytes: reservationBytes,
        database,
        inspectedAvailableBytes: capacityInspection.availableBytes,
        now: new Date(timestamp),
        ownerId: input.ownerId,
        runId: childRunId,
      });
      database.prepare("UPDATE workflow_runs SET reservation_id = ? WHERE id = ?")
        .run(reservationId, childRunId);
      for (const node of built.childPlan.nodes) {
        database.prepare(`
          INSERT INTO workflow_run_nodes (
            run_id, owner_id, node_id, kind, plan_index, dependencies_json,
            semantic_identity, idempotency_key, state, task_id,
            projection_state, error_code, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 'pending', NULL, NULL, ?, ?)
        `).run(
          childRunId,
          input.ownerId,
          node.id,
          node.kind,
          node.planIndex,
          JSON.stringify(node.dependencies),
          node.semanticIdentity,
          `wf1:${workflowSemanticDigest([childRunId, node.id, node.semanticIdentity])}`,
          timestamp,
          timestamp,
        );
      }
      const adoptionReceiptId = built.externalInputs.find(({ adoptionReceiptId }) => adoptionReceiptId)
        ?.adoptionReceiptId ?? null;
      database.prepare(`
        INSERT INTO workflow_run_continuations (
          id, owner_id, parent_run_id, child_run_id, intent_id, preview_digest,
          parent_graph_revision, child_graph_revision, parent_plan_digest,
          child_plan_digest, selected_node_ids_json, frozen_external_inputs_json,
          canonical_adoption_receipt_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        continuationId,
        input.ownerId,
        input.parentRunId,
        childRunId,
        input.intentId,
        input.previewDigest,
        built.preview.parentGraphRevision,
        built.preview.currentGraphRevision,
        built.preview.parentPlanDigest,
        built.childPlan.semanticFingerprint,
        JSON.stringify(built.selectedNodeIds),
        JSON.stringify(built.externalInputs),
        adoptionReceiptId,
        timestamp,
        timestamp,
      );
      const child = database.prepare("SELECT * FROM workflow_runs WHERE id = ?")
        .get(childRunId) as Record<string, unknown>;
      const relationRow = continuationRow(database, input.ownerId, input.parentRunId)!;
      database.exec("COMMIT");
      result = { continuation: continuationSummary(relationRow), run: summary(database, child) };
      shouldKick = true;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  if (shouldKick) kickWorkflowRunner();
  return result!;
}

function taskSourceNode(
  planNode: StoredNodePlan,
  task: NonNullable<ReturnType<ReturnType<typeof generationTaskApplication.taskStore>["get"]>>,
) {
  let data: Record<string, unknown> = {};
  if (planNode.kind === "text") {
    data.content = task.resultText ?? "";
  } else if (task.resultAssetId && task.ownerId) {
    data = authoritativeMediaSourceData(
      task.ownerId,
      planNode.kind,
      task.resultAssetId,
    );
  }
  return { data, id: planNode.id, type: planNode.kind };
}

function authoritativeMediaSourceData(
  ownerId: string,
  kind: Exclude<NodeInputKind, "text">,
  assetId: string,
) {
  const media = workflowMediaCapacity.readyForOwner(ownerId, kind, assetId);
  if (!media) return {};
  return {
    assetId,
    [`${kind}Src`]: `/api/${kind === "image" ? "assets" : `${kind}-assets`}/${assetId}`,
    inputState: "ready",
    mediaByteSize: media.byteSize,
    mediaContentType: media.contentType,
    mediaDurationSeconds: media.durationSeconds ?? undefined,
    mediaHeight: media.mediaHeight ?? undefined,
    mediaMetadataSource: "server",
    mediaMetadataStatus: kind === "image" ? "ready" : media.durationStatus,
    mediaStorageBackend: media.storageBackend,
    mediaWidth: media.mediaWidth ?? undefined,
  };
}

function authoritativeTaskResultReady(
  planNode: StoredNodePlan,
  task: NonNullable<ReturnType<ReturnType<typeof generationTaskApplication.taskStore>["get"]>>,
) {
  if (planNode.kind === "text") return typeof task.resultText === "string";
  return Boolean(
    task.resultAssetId && task.ownerId && workflowMediaCapacity.readyForOwner(
      task.ownerId,
      planNode.kind,
      task.resultAssetId,
    ),
  );
}

function authoritativeTaskResultReadyInTransaction(
  database: DatabaseSync,
  planNode: StoredNodePlan,
  task: NonNullable<ReturnType<ReturnType<typeof generationTaskApplication.taskStore>["get"]>>,
) {
  if (planNode.kind === "text") return typeof task.resultText === "string";
  return Boolean(
    task.resultAssetId && task.ownerId && readyMediaInTransaction(
      database,
      task.ownerId,
      planNode.kind,
      task.resultAssetId,
    ),
  );
}

function exactWorkflowTaskBinding(input: {
  nodePlan: StoredNodePlan;
  nodeRow: Record<string, unknown>;
  plan: StoredWorkflowPlan;
  runRow: Record<string, unknown>;
  task: NonNullable<ReturnType<ReturnType<typeof generationTaskApplication.taskStore>["get"]>>;
}) {
  const binding = input.task.modelConfiguration.workflowBinding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return false;
  const record = binding as Record<string, unknown>;
  return input.task.ownerId === String(input.runRow.owner_id) &&
    input.task.canvasId === String(input.runRow.canvas_id) &&
    input.task.nodeId === String(input.nodeRow.node_id) &&
    input.task.kind === input.nodePlan.kind &&
    input.task.idempotencyKey === String(input.nodeRow.idempotency_key) &&
    record.runId === String(input.runRow.id) &&
    record.groupId === input.plan.groupId &&
    record.reservationId === String(input.runRow.reservation_id) &&
    record.modelConfigurationRevision === input.nodePlan.modelConfigurationRevision &&
    record.modelReleaseRevision ===
      String(input.nodePlan.modelReleaseRevision.revisionId ?? "") &&
    record.generationInputKey === input.task.modelConfiguration.generationInputKey &&
    record.generationOwnershipKey ===
    input.task.modelConfiguration.generationOwnershipKey;
}

/**
 * Read the Workflow side of a historical result-adoption transaction.
 *
 * This is intentionally a read-only, transaction-scoped seam for the
 * adoption composition root.  The adoption application settles the task and
 * writes the Media receipt in this same transaction, then calls the project
 * half below.  Keeping this check here makes both halves use the same
 * immutable parent plan, task binding, and Canvas graph fence without opening
 * the task-store singleton or another SQLite connection.
 */
export function readAdoptedWorkflowBindingInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    ownerId: string;
    taskId: string;
    executionAttempt: number;
    canvasId: string;
    nodeId: string;
    runId: string | null;
    currentGraphRevision: number;
    canvasNode?: Readonly<Record<string, unknown>>;
  }>,
) {
  if (!database.isTransaction) {
    throw new Error("Workflow adoption binding requires an active transaction");
  }
  if (!input.runId) {
    return Object.freeze({ runId: null, bindingUnchanged: false });
  }
  const run = database.prepare(`
    SELECT * FROM workflow_runs WHERE id = ? AND owner_id = ?
  `).get(input.runId, input.ownerId) as Record<string, unknown> | undefined;
  if (!run || String(run.state) !== "failed" ||
      String(run.canvas_id) !== input.canvasId) {
    throw new Error("原整组执行不是可采用结果的失败记录");
  }
  const plan = parsePlan(run.plan_json);
  const nodePlan = plan.nodes.find(({ id }) => id === input.nodeId);
  const nodeRow = database.prepare(`
    SELECT * FROM workflow_run_nodes
    WHERE run_id = ? AND owner_id = ? AND node_id = ?
  `).get(input.runId, input.ownerId, input.nodeId) as Record<string, unknown> | undefined;
  if (!nodePlan || !nodeRow || String(nodeRow.state) !== "failed" ||
      String(nodeRow.task_id ?? "") !== input.taskId) {
    throw new Error("原整组节点与采用任务绑定不一致");
  }
  const task = generationTaskApplication.readGenerationTaskInTransaction(
    database,
    input.taskId,
  );
  if (!task || task.ownerId !== input.ownerId || task.canvasId !== input.canvasId ||
      task.nodeId !== input.nodeId || task.kind !== nodePlan.kind ||
      task.attempt !== input.executionAttempt ||
      !exactWorkflowTaskBinding({
        nodePlan,
        nodeRow,
        plan,
        runRow: run,
        task,
      })) {
    throw new Error("采用任务尚未通过完整工作流绑定核验");
  }

  // A missing node or a changed graph is a supported preserve-original path.
  // It must not prevent the Media receipt from being adopted, but it must
  // prevent this composition root from overwriting the user's newer Canvas.
  let graphUnchanged = false;
  try {
    const graph = readPersistedCanvasGraph({
      canvasId: input.canvasId,
      database,
      ownerId: input.ownerId,
    });
    if (graph.graphRevision === Number(run.graph_revision) &&
        graph.graphRevision === input.currentGraphRevision) {
      const semantic = compileFrozenWorkflowSemanticPlan({
        edges: graph.edges,
        groupId: plan.groupId,
        nodes: graph.nodes,
      });
      graphUnchanged = semantic.semanticFingerprint === plan.clientSemanticFingerprint;
    }
  } catch {
    graphUnchanged = false;
  }
  return Object.freeze({
    runId: String(run.id),
    bindingUnchanged: Boolean(input.canvasNode) && graphUnchanged,
  });
}

function linkWorkflowTask(input: {
  database: DatabaseSync;
  nodeId: string;
  runId: string;
  taskId: string;
}) {
  const changed = input.database.prepare(`
    UPDATE workflow_run_nodes
    SET task_id = ?, state = 'admitted', updated_at = ?
    WHERE run_id = ? AND node_id = ?
      AND state = 'admitting' AND task_id IS NULL
  `).run(
    input.taskId,
    new Date().toISOString(),
    input.runId,
    input.nodeId,
  );
  if (changed.changes === 1) return;
  const current = input.database.prepare(`
    SELECT task_id, state FROM workflow_run_nodes
    WHERE run_id = ? AND node_id = ?
  `).get(input.runId, input.nodeId) as
    | { state: string; task_id: string | null }
    | undefined;
  if (current?.state !== "admitted" || current.task_id !== input.taskId) {
    throw new Error("Workflow task link changed concurrently");
  }
}

function reconcileAdmittingWorkflowNodes(
  database: DatabaseSync,
  runRow: Record<string, unknown>,
  plan: StoredWorkflowPlan,
) {
  const runId = String(runRow.id);
  const rows = database.prepare(`
    SELECT * FROM workflow_run_nodes
    WHERE run_id = ? AND state = 'admitting'
    ORDER BY plan_index, node_id
  `).all(runId) as Record<string, unknown>[];
  const store = generationTaskApplication.taskStore();
  for (const nodeRow of rows) {
    const nodeId = String(nodeRow.node_id);
    const nodePlan = plan.nodes.find(({ id }) => id === nodeId);
    const task = store.getByIdempotencyForOwner(
      String(runRow.canvas_id),
      String(nodeRow.idempotency_key),
      String(runRow.owner_id),
    );
    if (nodePlan && task && exactWorkflowTaskBinding({
      nodePlan,
      nodeRow,
      plan,
      runRow,
      task,
    })) {
      linkWorkflowTask({ database, nodeId, runId, taskId: task.id });
      continue;
    }
    if (task || !nodePlan) {
      database.prepare(`
        UPDATE workflow_run_nodes
        SET state = 'failed', error_code = 'WORKFLOW_TASK_LINK_MISMATCH',
          error_message = '已提交任务与冻结工作流身份不一致，已阻止重复创建',
          updated_at = ?
        WHERE run_id = ? AND node_id = ? AND state = 'admitting'
      `).run(new Date().toISOString(), runId, nodeId);
      continue;
    }
    const nextState = Number(runRow.stop_requested) === 1 ||
        runRow.state === "stopping"
      ? "cancelled"
      : "pending";
    database.prepare(`
      UPDATE workflow_run_nodes SET state = ?, updated_at = ?
      WHERE run_id = ? AND node_id = ?
        AND state = 'admitting' AND task_id IS NULL
    `).run(nextState, new Date().toISOString(), runId, nodeId);
  }
}

function assertFrozenExternalMediaInputs(
  database: DatabaseSync,
  ownerId: string,
  externalNodes: StoredWorkflowPlan["externalNodes"],
) {
  for (const node of externalNodes) {
    if (node.type === "text" ||
        !Object.keys(node.data).some((key) => key.startsWith("sourceAsset"))) continue;
    const expected = mediaIdentityFromExternalNode(
      node.type,
      node.data as Record<string, unknown>,
    );
    const actual = expected
      ? readReadyMediaIdentityInTransaction(database, ownerId, node.type, expected.assetId)
      : undefined;
    if (!sameFrozenMediaIdentity(actual, expected)) {
      throw new Error("冻结媒体输入已变化或无法完整核验，未提交生成");
    }
  }
}

async function admitWorkflowNode(input: {
  database: DatabaseSync;
  nodeRow: Record<string, unknown>;
  plan: StoredWorkflowPlan;
  runRow: Record<string, unknown>;
}) {
  const runId = String(input.runRow.id);
  const nodeId = String(input.nodeRow.node_id);
  const nodePlan = input.plan.nodes.find(({ id }) => id === nodeId);
  if (!nodePlan) throw new Error("Workflow node plan is missing");
  const store = generationTaskApplication.taskStore();
  const existing = store.getByIdempotencyForOwner(
    String(input.runRow.canvas_id),
    String(input.nodeRow.idempotency_key),
    String(input.runRow.owner_id),
  );
  if (existing) {
    if (!exactWorkflowTaskBinding({
      nodePlan,
      nodeRow: input.nodeRow,
      plan: input.plan,
      runRow: input.runRow,
      task: existing,
    })) throw new Error("已存在任务与冻结工作流身份不一致");
    linkWorkflowTask({
      database: input.database,
      nodeId,
      runId,
      taskId: existing.id,
    });
    return;
  }
  await workflowMediaCapacity.recheck(String(input.runRow.reservation_id));
  const model = generationTaskApplication.resolveModel(
    nodePlan.kind,
    nodePlan.modelId,
    String(input.runRow.owner_id),
    input.database,
  );
  if (!model) throw new Error("已冻结模型不再可用");
  if (
    model.provider_model_id !== nodePlan.providerModelId ||
    model.provider_profile_id !== nodePlan.providerProfileId ||
    modelConfigurationRevision({ ...model, capability: nodePlan.kind }) !==
      nodePlan.modelConfigurationRevision
  ) throw new Error("已冻结模型配置发生变化");
  const releaseDocument = nodePlan.modelReleaseRevision.document;
  if (
    releaseDocument.modelId !== nodePlan.modelId ||
    releaseDocument.capability !== nodePlan.kind ||
    releaseDocument.providerProfileId !== nodePlan.providerProfileId ||
    releaseDocument.providerModelId !== nodePlan.providerModelId ||
    releaseDocument.providerProtocol !== nodePlan.providerProtocol
  ) throw new Error("已冻结模型合同与工作流计划不一致");
  const schema = releaseDocument.capabilitySchema as ModelParameterSchema;
  const normalized = normalizeParameterValues(schema, nodePlan.parameters);
  let parameters = submissionParameterValues(schema, normalized);
  const nodeRows = input.database.prepare(`
    SELECT node_id, task_id, state FROM workflow_run_nodes WHERE run_id = ?
  `).all(runId) as Array<{ node_id: string; state: string; task_id: string | null }>;
  const taskByNode = new Map(nodeRows.flatMap((row) => {
    const task = row.task_id ? store.get(row.task_id) : undefined;
    return task ? [[row.node_id, task] as const] : [];
  }));
  assertFrozenExternalMediaInputs(
    input.database,
    String(input.runRow.owner_id),
    input.plan.externalNodes,
  );
  const graphNodes = input.plan.externalNodes.map((node) => {
    const external = node as {
      data?: Record<string, unknown>;
      id: string;
      type: NodeInputKind;
    };
    const frozen = { ...(external.data ?? {}) };
    const data = external.type !== "text"
      ? (() => {
          // Ordinary and pre-existing plans retain their established ready-
          // media admission. Successor plans carry complete frozen evidence.
          if (!Object.keys(frozen).some((key) => key.startsWith("sourceAsset"))) {
            return typeof frozen.assetId === "string"
              ? authoritativeMediaSourceData(String(input.runRow.owner_id), external.type, frozen.assetId)
              : frozen;
          }
          const expected = mediaIdentityFromExternalNode(external.type, frozen);
          const actual = expected
            ? readReadyMediaIdentityInTransaction(
                input.database,
                String(input.runRow.owner_id),
                external.type,
                expected.assetId,
              )
            : undefined;
          if (!sameFrozenMediaIdentity(actual, expected)) {
            throw new Error("冻结媒体输入已变化或无法完整核验，未提交生成");
          }
          return mediaExternalNodeData(actual!);
        })()
      : frozen;
    return { data, id: String(external.id), type: String(external.type) };
  });
  for (const candidate of input.plan.nodes) {
    const task = taskByNode.get(candidate.id);
    if (task?.state === "success") graphNodes.push(taskSourceNode(candidate, task));
    else graphNodes.push({
      data: {
        [`${candidate.kind}Prompt`]: candidate.ownPrompt,
        [`${candidate.kind}PromptReady`]: true,
      },
      id: candidate.id,
      type: candidate.kind,
    });
  }
  const preflight = resolveNodeInputs({
    edges: input.plan.edges.map((edge) => ({
      data: { inputOrder: edge.inputOrder, inputRole: edge.inputRole },
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    mediaInputPolicy: modelMediaInputPolicy({
      capability: nodePlan.kind,
      providerDriver: model.provider_driver,
      providerModelId: model.provider_model_id,
    }),
    modelReleaseRevision: String(nodePlan.modelReleaseRevision.revisionId ?? ""),
    modelSchema: schema,
    nodes: graphNodes,
    ownPrompt: nodePlan.ownPrompt,
    parameters,
    targetId: nodeId,
    targetKind: nodePlan.kind,
  });
  if (!preflight.canSubmit || !preflight.contractFingerprint) {
    throw new Error(preflight.problems[0]?.message ?? "冻结工作流输入尚未就绪");
  }
  parameters = submissionParameterValues(
    schema,
    preflight.normalizedParameters ?? parameters,
  );
  const inputKey = generationInputKey({
    inputs: preflight.inputs,
    modelConfigurationRevision: nodePlan.modelConfigurationRevision,
    modelId: nodePlan.modelId,
    modelReleaseRevision: String(nodePlan.modelReleaseRevision.revisionId ?? ""),
    ownPrompt: nodePlan.ownPrompt,
    parameters,
    prompt: preflight.finalPrompt,
  });
  const ownershipKey = generationOwnershipKey(generationOwnershipEvidence({
    contractFingerprint: preflight.contractFingerprint,
    inputs: preflight.inputs,
    kind: nodePlan.kind,
    modelConfigurationRevision: nodePlan.modelConfigurationRevision,
    modelId: nodePlan.modelId,
    modelReleaseRevision: String(nodePlan.modelReleaseRevision.revisionId ?? ""),
    parameters,
    prompt: nodePlan.ownPrompt,
  }));
  const runtime = await generationTaskApplication.generationRuntimeDecision({
    canSubmit: true,
    kind: nodePlan.kind,
    model,
    ownerId: String(input.runRow.owner_id),
  });
  const runtimeProblem = generationTaskApplication.preAdmissionRuntimeProblem(runtime);
  if (runtimeProblem || !runtime.providerProfile) {
    throw new Error(runtimeProblem?.message ?? "模型运行时不可用");
  }
  const execution = compileRegisteredModelTaskDecision({
    capability: nodePlan.kind,
    capabilitySchema: schema,
    contractFingerprint: preflight.contractFingerprint,
    costCurrency: model.cost_currency,
    providerDriver: model.provider_driver,
    providerModelId: model.provider_model_id,
    providerProtocol: model.provider_protocol ?? "native",
    revisionIdentity: String(nodePlan.modelReleaseRevision.revisionId ?? ""),
  });
  const requestIntent = {
    canvasId: String(input.runRow.canvas_id),
    generationIdentityVersion: 2,
    generationInputKey: inputKey,
    generationOwnershipKey: ownershipKey,
    inputSchemaVersion: 1,
    inputs: preflight.snapshot,
    kind: nodePlan.kind,
    model: nodePlan.modelId,
    modelConfigurationRevision: nodePlan.modelConfigurationRevision,
    modelInputContractFingerprint: execution.contractFingerprint,
    modelReleaseRevision: String(nodePlan.modelReleaseRevision.revisionId ?? ""),
    nodeId,
    ownPrompt: nodePlan.ownPrompt,
    parameters,
    prompt: preflight.finalPrompt,
    workflowBinding: {
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      groupId: input.plan.groupId,
      modelConfigurationRevision: nodePlan.modelConfigurationRevision,
      modelReleaseRevision: String(nodePlan.modelReleaseRevision.revisionId ?? ""),
      reservationId: String(input.runRow.reservation_id),
      runId,
    },
  };
  const persistedInputs = preflight.inputs.map((item) => ({
    assetId: item.assetId,
    kind: item.kind,
    order: item.order,
    role: item.role,
    sourceNodeId: item.sourceNodeId,
    ...(item.kind === "text" ? { text: item.text } : {}),
  }));
  const authoritativeModelConfiguration =
    buildAuthoritativeGenerationModelConfiguration({
      credentialVersion: Number(runtime.credentialVersion),
      generationInputKey: inputKey,
      generationOwnershipKey: ownershipKey,
      modelCapability: nodePlan.kind,
      modelConfigurationRevision: nodePlan.modelConfigurationRevision,
      modelExecutionAdapterId: execution.adapterId,
      modelId: nodePlan.modelId,
      modelInputContractFingerprint: preflight.contractFingerprint,
      modelReleaseRevision: nodePlan.modelReleaseRevision,
      modelResultCount: execution.resultCount,
      parameterSchema: schema,
      providerConfigurationVersion:
        generationTaskApplication.providerConfigurationVersion(
          runtime.providerProfile,
        ),
      providerDriver: model.provider_driver,
      providerModelId: model.provider_model_id,
      providerProtocol: model.provider_protocol ?? "native",
      providerProfileId: model.provider_profile_id,
      workflowBinding: requestIntent.workflowBinding,
    });
  // Runtime/model checks may await; re-read the frozen media identity at the
  // last local boundary before creating the generation task.  A mismatch
  // fails closed and therefore cannot turn a metadata replacement into a new
  // Provider request.
  assertFrozenExternalMediaInputs(
    input.database,
    String(input.runRow.owner_id),
    input.plan.externalNodes,
  );
  const admitted = admitPreparedGenerationTask({
    input: {
    canvasId: String(input.runRow.canvas_id),
    costCurrency: execution.costCurrency,
    credentialRevision: Number(runtime.credentialVersion),
    estimatedCostMicrounits:
      generationTaskApplication.taskAuditEstimatedCostMicrounits[execution.costCurrency],
    idempotencyKey: String(input.nodeRow.idempotency_key),
    kind: nodePlan.kind,
    model: nodePlan.modelId,
    modelConfiguration: authoritativeModelConfiguration,
    nodeId,
    ownerId: String(input.runRow.owner_id),
    parameters: {
      ...parameters,
      inputSchemaVersion: 1,
      inputs: persistedInputs,
      ...(nodePlan.kind === "image"
        ? {
            references: persistedInputs
              .filter((item) => item.kind === "image" && item.assetId)
              .map((item) => ({
                assetId: item.assetId,
                kind: "image" as const,
                sourceNodeId: item.sourceNodeId,
              })),
          }
        : {}),
    },
    prompt: preflight.finalPrompt,
    providerModelId: model.provider_model_id,
    providerProfileId: model.provider_profile_id,
    requestIntent,
    },
  }, {
    beforeCommit: ({ database }) => assertFrozenExternalMediaInputs(
      database,
      String(input.runRow.owner_id),
      input.plan.externalNodes,
    ),
  });
  linkWorkflowTask({
    database: input.database,
    nodeId,
    runId,
    taskId: admitted.task.id,
  });
}

function projectWorkflowNode(database: DatabaseSync, input: {
  nodePlan: StoredNodePlan;
  runRow: Record<string, unknown>;
  taskId: string;
}) {
  return projectWorkflowResultInTransaction({
    canvasId: String(input.runRow.canvas_id),
    database,
    kind: input.nodePlan.kind,
    nodeId: input.nodePlan.id,
    ownerId: String(input.runRow.owner_id),
    runId: String(input.runRow.id),
    taskId: input.taskId,
  });
}

/**
 * Project a result that was explicitly adopted by the narrow recovery command
 * back into the original Canvas.  The historical failed run/node rows are
 * deliberately read-only here; the adoption command owns their new receipt
 * and task settlement.  This function is only the existing projection path
 * with an additional binding and current-graph fence.
 */
export function projectAdoptedWorkflowResultInTransaction(
  database: DatabaseSync,
  input: Readonly<{
    ownerId: string;
    taskId: string;
    executionAttempt: number;
    runId: string;
    nodeId: string;
  }>,
) {
  if (!database.isTransaction) {
    throw new Error("Adopted workflow projection requires an active transaction");
  }
  const run = database.prepare(`
    SELECT * FROM workflow_runs WHERE id = ? AND owner_id = ?
  `).get(input.runId, input.ownerId) as Record<string, unknown> | undefined;
  if (!run || String(run.state) !== "failed") {
    throw new Error("原整组执行不是不可变失败状态");
  }
  const plan = parsePlan(run.plan_json);
  const nodePlan = plan.nodes.find(({ id }) => id === input.nodeId);
  const nodeRow = database.prepare(`
    SELECT * FROM workflow_run_nodes WHERE run_id = ? AND owner_id = ? AND node_id = ?
  `).get(input.runId, input.ownerId, input.nodeId) as Record<string, unknown> | undefined;
  if (!nodePlan || !nodeRow || String(nodeRow.state) !== "failed" ||
      String(nodeRow.task_id ?? "") !== input.taskId) {
    throw new Error("原整组节点绑定不一致，未覆盖当前画布");
  }
  // Read from the caller-owned transaction.  The adoption command settles a
  // newly recovered task before invoking this projection, so the cached task
  // store (a separate SQLite connection) would otherwise miss that uncommitted
  // success and reject an otherwise valid receipt.
  const task = generationTaskApplication.readGenerationTaskInTransaction(database, input.taskId);
  if (!task || task.ownerId !== input.ownerId || task.canvasId !== String(run.canvas_id) ||
      task.nodeId !== input.nodeId || task.kind !== nodePlan.kind ||
      task.attempt !== input.executionAttempt || task.state !== "success" ||
      !authoritativeTaskResultReadyInTransaction(database, nodePlan, task) ||
      !exactWorkflowTaskBinding({
        nodePlan,
        nodeRow,
        plan,
        runRow: run,
        task,
      })) {
    throw new Error("原结果任务尚未通过完整身份核验");
  }
  const adoption = readGenerationResultAdoptionInTransaction(database, {
    executionAttempt: input.executionAttempt,
    ownerId: input.ownerId,
    taskId: input.taskId,
  });
  if (!adoption || adoption.canvasId !== String(run.canvas_id) ||
      adoption.nodeId !== input.nodeId || adoption.runId !== input.runId ||
      adoption.executionAttempt !== input.executionAttempt) {
    throw new Error("原结果缺少匹配的采用回执");
  }
  const graph = readPersistedCanvasGraph({
    canvasId: String(run.canvas_id),
    database,
    ownerId: input.ownerId,
  });
  if (graph.graphRevision !== Number(run.graph_revision)) {
    throw new Error("当前画布已变化，原结果保留在任务记录中");
  }
  const semantic = compileFrozenWorkflowSemanticPlan({
    edges: graph.edges,
    groupId: plan.groupId,
    nodes: graph.nodes,
  });
  if (semantic.semanticFingerprint !== plan.clientSemanticFingerprint) {
    throw new Error("当前画布输入已变化，原结果保留在任务记录中");
  }
  return projectWorkflowNode(database, {
    nodePlan,
    runRow: run,
    taskId: input.taskId,
  });
}

function retryFailedWorkflowProjections(runId: string) {
  const database = openAppDatabase();
  try {
    const run = database.prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(runId) as Record<string, unknown> | undefined;
    if (!run) return;
    const plan = parsePlan(run.plan_json);
    const rows = database.prepare(`
      SELECT node_id, task_id FROM workflow_run_nodes
      WHERE run_id = ? AND state = 'success'
        AND projection_state = 'failed' AND task_id IS NOT NULL
      ORDER BY plan_index
    `).all(runId) as Array<{ node_id: string; task_id: string }>;
    for (const row of rows) {
      const nodePlan = plan.nodes.find(({ id }) => id === row.node_id);
      if (!nodePlan) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        const projectionState = projectWorkflowNode(database, {
          nodePlan,
          runRow: run,
          taskId: row.task_id,
        });
        const settledProjection = database.prepare(`
          UPDATE workflow_run_nodes SET projection_state = ?, updated_at = ?
          WHERE run_id = ? AND node_id = ? AND projection_state = 'failed'
        `).run(
          projectionState,
          new Date().toISOString(),
          runId,
          row.node_id,
        );
        if (settledProjection.changes !== 1) {
          throw new Error("Workflow projection retry lost its state fence");
        }
        database.exec("COMMIT");
        flushDeferredCanvasObservability(database);
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK");
        discardDeferredCanvasObservability(database);
        throw error;
      }
    }
  } finally {
    database.close();
  }
}

function quarantineMalformedWorkflowRun(
  database: DatabaseSync,
  runId: string,
  message: string,
) {
  const taskIds = (database.prepare(`
    SELECT task_id FROM workflow_run_nodes
    WHERE run_id = ? AND task_id IS NOT NULL
  `).all(runId) as Array<{ task_id: string }>).map(({ task_id }) => task_id);
  const activeTaskRemains =
    generationTaskApplication.quarantineMalformedWorkflowTaskLinks(taskIds);
  database.exec("BEGIN IMMEDIATE");
  try {
    const timestamp = new Date().toISOString();
    if (activeTaskRemains) {
      database.prepare(`
        UPDATE workflow_runs
        SET state = 'stopping', stop_requested = 1,
            error_code = 'WORKFLOW_PLAN_MALFORMED', error_message = ?,
            updated_at = ?
        WHERE id = ? AND state IN ('running', 'stopping')
      `).run(message.slice(0, 500), timestamp, runId);
      database.prepare(`
        UPDATE workflow_run_nodes
        SET state = 'cancelled', error_code = 'WORKFLOW_PLAN_MALFORMED',
            error_message = ?, updated_at = ?
        WHERE run_id = ? AND state IN ('pending', 'admitting')
      `).run(message.slice(0, 500), timestamp, runId);
      database.exec("COMMIT");
      return;
    }
    database.prepare(`
      UPDATE workflow_run_nodes
      SET state = 'failed', error_code = 'WORKFLOW_PLAN_MALFORMED',
          error_message = ?, updated_at = ?
      WHERE run_id = ?
        AND state IN ('pending', 'admitting', 'admitted')
    `).run(message.slice(0, 500), timestamp, runId);
    const changed = database.prepare(`
      UPDATE workflow_runs
      SET state = 'failed', error_code = 'WORKFLOW_PLAN_MALFORMED',
          error_message = ?, updated_at = ?
      WHERE id = ? AND state IN ('running', 'stopping')
    `).run(message.slice(0, 500), timestamp, runId);
    if (changed.changes === 1) {
      database.prepare("DELETE FROM workflow_run_locks WHERE run_id = ?")
        .run(runId);
      workflowMediaCapacity.releaseInTransaction({
        database,
        now: new Date(timestamp),
        runId,
      });
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function persistFirstWorkflowRunError(input: Readonly<{
  code: string;
  database: DatabaseSync;
  message: string;
  runId: string;
  timestamp: string;
}>) {
  return input.database.prepare(`
    UPDATE workflow_runs
    SET error_code = ?, error_message = ?, updated_at = CASE
      WHEN updated_at < ? THEN ? ELSE updated_at END
    WHERE id = ? AND state IN ('running', 'stopping')
      AND error_code IS NULL
  `).run(
    input.code,
    input.message.slice(0, 500),
    input.timestamp,
    input.timestamp,
    input.runId,
  ).changes === 1;
}

function settleWorkflowNodeTerminal(input: Readonly<{
  code: string;
  database: DatabaseSync;
  expectedState: "admitted" | "pending";
  message: string;
  nextState: "blocked" | "cancelled" | "failed";
  nodeId: string;
  runId: string;
  timestamp: string;
}>) {
  input.database.exec("BEGIN IMMEDIATE");
  try {
    const changed = input.database.prepare(`
      UPDATE workflow_run_nodes
      SET state = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE run_id = ? AND node_id = ? AND state = ?
    `).run(
      input.nextState,
      input.code,
      input.message.slice(0, 500),
      input.timestamp,
      input.runId,
      input.nodeId,
      input.expectedState,
    );
    if (
      changed.changes === 1 &&
      (input.nextState === "failed" || input.nextState === "blocked")
    ) {
      persistFirstWorkflowRunError(input);
    }
    input.database.exec("COMMIT");
    return changed.changes === 1;
  } catch (error) {
    if (input.database.isTransaction) input.database.exec("ROLLBACK");
    throw error;
  }
}

function finalizeWorkflowRun(database: DatabaseSync, runId: string) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = database.prepare(`
      SELECT state, stop_requested, error_code, error_message
      FROM workflow_runs WHERE id = ?
    `).get(runId) as
      | {
          error_code: string | null;
          error_message: string | null;
          state: string;
          stop_requested: number;
        }
      | undefined;
    if (!run || !activeRunStates.includes(run.state as never)) {
      database.exec("COMMIT");
      return false;
    }
    const nodes = database.prepare(`
      SELECT node_id, plan_index, state, error_code, error_message
      FROM workflow_run_nodes WHERE run_id = ?
      ORDER BY updated_at, plan_index, node_id
    `).all(runId) as Array<{
      error_code: string | null;
      error_message: string | null;
      node_id: string;
      plan_index: number;
      state: string;
    }>;
    if (
      nodes.length < 1 ||
      nodes.some(({ state }) => !terminalNodeStates.includes(state as never))
    ) {
      database.exec("COMMIT");
      return false;
    }
    const decisive = nodes.find(({ state }) =>
      state === "failed" || state === "blocked"
    );
    const stopped = Number(run.stop_requested) === 1 || run.state === "stopping";
    const finalState = stopped
      ? "cancelled"
      : decisive
        ? "failed"
        : "success";
    const timestamp = new Date().toISOString();
    const changed = database.prepare(`
      UPDATE workflow_runs
      SET state = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE id = ? AND state IN ('running', 'stopping')
    `).run(
      finalState,
      stopped
        ? "WORKFLOW_STOP_REQUESTED"
        : run.error_code ?? decisive?.error_code ?? null,
      stopped
        ? "整组执行已按服务端最新状态停止"
        : run.error_message ?? decisive?.error_message ?? null,
      timestamp,
      runId,
    );
    if (changed.changes === 1) {
      database.prepare("DELETE FROM workflow_run_locks WHERE run_id = ?")
        .run(runId);
      workflowMediaCapacity.releaseInTransaction({
        database,
        now: new Date(timestamp),
        runId,
      });
    }
    database.exec("COMMIT");
    return changed.changes === 1;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function settleWorkflowAdmissionFailure(input: {
  database: DatabaseSync;
  error: unknown;
  nodeId: string;
  runId: string;
}) {
  input.database.exec("BEGIN IMMEDIATE");
  try {
    const run = input.database.prepare(`
      SELECT state, stop_requested FROM workflow_runs WHERE id = ?
    `).get(input.runId) as
      | { state: string; stop_requested: number }
      | undefined;
    const stopped = !run || run.state === "stopping" ||
      Number(run.stop_requested) === 1;
    const timestamp = new Date().toISOString();
    const code = stopped
      ? "WORKFLOW_STOP_REQUESTED"
      : "WORKFLOW_ADMISSION_FAILED";
    const message = stopped
      ? "整组执行已按服务端最新状态停止；本节点未提交"
      : (input.error instanceof Error
        ? input.error.message
        : "工作流准入失败").slice(0, 500);
    const changed = input.database.prepare(`
      UPDATE workflow_run_nodes
      SET state = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE run_id = ? AND node_id = ? AND state = 'admitting'
    `).run(
      stopped ? "cancelled" : "failed",
      code,
      message,
      timestamp,
      input.runId,
      input.nodeId,
    );
    if (changed.changes === 1) {
      persistFirstWorkflowRunError({
        code,
        database: input.database,
        message,
        runId: input.runId,
        timestamp,
      });
    }
    input.database.exec("COMMIT");
  } catch (error) {
    if (input.database.isTransaction) input.database.exec("ROLLBACK");
    throw error;
  }
}

export function settleWorkflowAdmissionFailureForRuntimeTest(input: {
  database: DatabaseSync;
  error: unknown;
  nodeId: string;
  runId: string;
}) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("Workflow admission settlement test seam is unavailable");
  }
  settleWorkflowAdmissionFailure(input);
}

function workflowRunNeedsMutation(runId: string) {
  return readAppDatabaseSnapshot((database) => {
    const run = database.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId);
    if (!run || !activeRunStates.includes(run.state as never)) return false;
    try { parsePlan(run.plan_json); } catch { return true; }
    const nodes = database.prepare(`
      SELECT node_id, state, dependencies_json, error_code, task_id
      FROM workflow_run_nodes WHERE run_id = ?
    `).all(runId);
    const states = new Map(nodes.map((node) => [String(node.node_id), String(node.state)]));
    if (nodes.every((node) => !["pending", "admitting", "admitted"].includes(String(node.state)))) return true;
    return nodes.some((node) => {
      if (node.state === "admitting") return true;
      if (node.state === "admitted" && ["success", "failed", "cancelled", "recovering"].includes(
          String(generationTaskApplication.taskStore().get(String(node.task_id))?.state))) return true;
      if (node.error_code && !run.error_code) return true;
      if (node.state !== "pending") return false;
      if (Number(run.stop_requested) === 1) return true;
      try {
        const dependencies = JSON.parse(String(node.dependencies_json)) as string[];
        return dependencies.every((id) => states.get(id) === "success") ||
          dependencies.some((id) => ["failed", "blocked", "cancelled"].includes(states.get(id) ?? ""));
      } catch { return true; }
    });
  });
}

async function processWorkflowRun(runId: string) {
  if (!workflowRunNeedsMutation(runId)) return;
  const database = openAppDatabase();
  try {
    const run = database.prepare("SELECT * FROM workflow_runs WHERE id = ?")
      .get(runId) as Record<string, unknown> | undefined;
    if (!run || !activeRunStates.includes(run.state as never)) return;
    let plan: StoredWorkflowPlan;
    try {
      plan = parsePlan(run.plan_json);
    } catch (error) {
      const message = error instanceof WorkflowPlanValidationError
        ? error.message
        : "Workflow run plan is malformed";
      quarantineMalformedWorkflowRun(database, runId, message);
      return;
    }
    reconcileAdmittingWorkflowNodes(database, run, plan);
    const timestamp = new Date().toISOString();
    if (Number(run.stop_requested) === 1) {
      database.prepare(`
        UPDATE workflow_run_nodes
        SET state = 'cancelled', updated_at = ?
        WHERE run_id = ? AND state = 'pending'
      `).run(timestamp, runId);
    }
    const store = generationTaskApplication.taskStore();
    const nodes = database.prepare(`
      SELECT * FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
    `).all(runId) as Record<string, unknown>[];
    const existingDecisive = database.prepare(`
      SELECT error_code, error_message, updated_at
      FROM workflow_run_nodes
      WHERE run_id = ? AND state IN ('failed', 'blocked')
        AND error_code IS NOT NULL
      ORDER BY updated_at, plan_index, node_id
      LIMIT 1
    `).get(runId) as
      | {
          error_code: string;
          error_message: string | null;
          updated_at: string;
        }
      | undefined;
    if (existingDecisive) {
      persistFirstWorkflowRunError({
        code: existingDecisive.error_code,
        database,
        message: existingDecisive.error_message ?? "工作流节点未完成",
        runId,
        timestamp: existingDecisive.updated_at,
      });
    }
    for (const node of nodes) {
      if (node.state !== "admitted" || !node.task_id) continue;
      const task = store.get(String(node.task_id));
      if (!task) continue;
      if (
        task.state === "recovering" &&
        !task.providerTaskId &&
        store.hasUnsafeProviderAttemptForNewPaidRetry(task.id)
      ) {
        // The original paid boundary is ambiguous and has no remote id to
        // inspect. Keep the generation task/evidence unresolved so every
        // future admission remains fenced, but terminalize this workflow node
        // to release its graph locks and capacity reservation. Never POST
        // again from the workflow runner.
        settleWorkflowNodeTerminal({
          code: "OUTCOME_UNKNOWN_BILLING_RISK",
          database,
          expectedState: "admitted",
          message: "模型平台可能已受理；已保留原任务证据并永久禁止本轮重复提交",
          nextState: "failed",
          nodeId: String(node.node_id),
          runId,
          timestamp,
        });
      } else if (task.state === "success") {
        const nodePlan = plan.nodes.find(({ id }) => id === String(node.node_id));
        if (!nodePlan || !authoritativeTaskResultReady(nodePlan, task)) {
          settleWorkflowNodeTerminal({
            code: "PUBLICATION_MISSING",
            database,
            expectedState: "admitted",
            message: "原生成任务缺少可验证的持久结果，未运行下游节点",
            nextState: "failed",
            nodeId: String(node.node_id),
            runId,
            timestamp,
          });
          continue;
        }
        database.exec("BEGIN IMMEDIATE");
        try {
          const settledNode = database.prepare(`
            UPDATE workflow_run_nodes SET state = 'success', updated_at = ?
            WHERE run_id = ? AND node_id = ? AND state = 'admitted'
          `).run(timestamp, runId, String(node.node_id));
          if (settledNode.changes !== 1) {
            throw new Error("Workflow node completion lost its state fence");
          }
          const projectionState = projectWorkflowNode(database, {
            nodePlan,
            runRow: run,
            taskId: task.id,
          });
          const settledProjection = database.prepare(`
            UPDATE workflow_run_nodes SET projection_state = ?, updated_at = ?
            WHERE run_id = ? AND node_id = ? AND state = 'success'
              AND task_id = ?
          `).run(
            projectionState,
            timestamp,
            runId,
            String(node.node_id),
            task.id,
          );
          if (settledProjection.changes !== 1) {
            throw new Error("Workflow projection lost its state fence");
          }
          database.exec("COMMIT");
          flushDeferredCanvasObservability(database);
        } catch (error) {
          if (database.isTransaction) database.exec("ROLLBACK");
          discardDeferredCanvasObservability(database);
          throw error;
        }
      } else if (task.state === "failed" || task.state === "cancelled") {
        settleWorkflowNodeTerminal({
          code: task.errorCode ?? "GENERATION_FAILED",
          database,
          expectedState: "admitted",
          message: task.errorMessage ?? "生成任务失败",
          nextState: task.state === "cancelled" ? "cancelled" : "failed",
          nodeId: String(node.node_id),
          runId,
          timestamp,
        });
      }
    }
    const latestStop = database.prepare(`
      SELECT stop_requested FROM workflow_runs WHERE id = ?
    `).get(runId) as { stop_requested?: unknown } | undefined;
    if (Number(latestStop?.stop_requested) === 1) {
      database.prepare(`
        UPDATE workflow_run_nodes SET state = 'cancelled', updated_at = ?
        WHERE run_id = ? AND state = 'pending'
      `).run(timestamp, runId);
    }
    const refreshed = database.prepare(`
      SELECT * FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
    `).all(runId) as Record<string, unknown>[];
    const byId = new Map(refreshed.map((node) => [String(node.node_id), node]));
    for (const node of refreshed) {
      if (node.state !== "pending") continue;
      const dependencies = JSON.parse(String(node.dependencies_json)) as string[];
      const dependencyStates = dependencies.map((id) => String(byId.get(id)?.state));
      if (dependencyStates.some((state) => ["failed", "blocked", "cancelled"].includes(state))) {
        settleWorkflowNodeTerminal({
          code: "UPSTREAM_FAILED",
          database,
          expectedState: "pending",
          message: "上游节点未成功，未提交本节点",
          nextState: "blocked",
          nodeId: String(node.node_id),
          runId,
          timestamp,
        });
        continue;
      }
      if (!dependencyStates.every((state) => state === "success")) continue;
      const claimed = database.prepare(`
        UPDATE workflow_run_nodes SET state = 'admitting', updated_at = ?
        WHERE run_id = ? AND node_id = ? AND state = 'pending'
          AND EXISTS (
            SELECT 1 FROM workflow_runs
            WHERE id = ? AND state = 'running' AND stop_requested = 0
          )
      `).run(timestamp, runId, String(node.node_id), runId);
      if (Number(claimed.changes) !== 1) continue;
      try {
        await admitWorkflowNode({ database, nodeRow: { ...node, state: "admitting" }, plan, runRow: run });
      } catch (error) {
        settleWorkflowAdmissionFailure({
          database,
          error,
          nodeId: String(node.node_id),
          runId,
        });
      }
    }
    finalizeWorkflowRun(database, runId);
  } finally {
    database.close();
  }
}

export async function runFairWorkflowBatch(
  ids: readonly string[],
  process: (id: string) => Promise<void>,
  concurrency = 4,
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("Invalid workflow batch concurrency");
  }
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, ids.length) },
    async () => {
      while (cursor < ids.length) {
        const index = cursor;
        cursor += 1;
        try {
          await process(ids[index]);
        } catch {
          // One damaged run remains durable for the next sweep and cannot
          // starve an unrelated run assigned to this or another worker.
        }
      }
    },
  ));
}

function createWorkflowSweepCoordinator(pass: () => Promise<void>) {
  let inFlight: Promise<void> | undefined;
  let rerunRequested = false;
  return () => {
    if (inFlight) {
      // A stop/task settlement may arrive after the active pass captured its
      // run ids or even after it processed that run. Coalesce those signals,
      // but guarantee one fresh pass before every waiter is released.
      rerunRequested = true;
      return inFlight;
    }
    inFlight = (async () => {
      do {
        rerunRequested = false;
        await pass();
      } while (rerunRequested);
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

async function runWorkflowSweepPass() {
  const { ids, projectionRetryIds } = readAppDatabaseSnapshot((database) => {
    const ids = (database.prepare(`
      SELECT id FROM workflow_runs WHERE state IN ('running', 'stopping')
      ORDER BY updated_at, created_at, id
    `).all() as Array<{ id: string }>).map(({ id }) => id);
    const projectionRetryIds = (database.prepare(`
      SELECT DISTINCT run.id
      FROM workflow_runs AS run
      JOIN workflow_run_nodes AS node ON node.run_id = run.id
      WHERE run.state IN ('success', 'failed', 'cancelled')
        AND node.state = 'success' AND node.projection_state = 'failed'
      ORDER BY run.updated_at LIMIT 50
    `).all() as Array<{ id: string }>).map(({ id }) => id);
    return { ids, projectionRetryIds };
  });
  await runFairWorkflowBatch(ids, processWorkflowRun);
  for (const id of projectionRetryIds) {
    try {
      retryFailedWorkflowProjections(id);
    } catch {
      // Projection owns no Provider boundary. A temporary Canvas/storage
      // failure remains independently retryable on the existing scheduler.
    }
  }
}

const coordinatedWorkflowSweep = createWorkflowSweepCoordinator(
  runWorkflowSweepPass,
);

export function runWorkflowSweep() {
  return coordinatedWorkflowSweep();
}

export function workflowSweepCoordinatorForRuntimeTest(
  pass: () => Promise<void>,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    throw new Error("Workflow sweep coordinator test seam is unavailable");
  }
  return createWorkflowSweepCoordinator(pass);
}

export function kickWorkflowRunner() {
  queueMicrotask(() => {
    void Promise.resolve()
      .then(() => generationTaskApplication.runRegisteredApplicationWork(
        () => runWorkflowSweep(),
      ))
      .catch(() => undefined);
  });
}

export function initializeWorkflowRunner() {
  // Every admitting row is reconciled against its deterministic task identity
  // by the normal sweep before it can be reset or linked.
  kickWorkflowRunner();
}

export function stopWorkflowRunner() {
  // Scheduling is owned by the existing generation worker. Durable workflow
  // rows remain recoverable by the next active runtime owner.
}

export function activeWorkflowRunCount() {
  return readAppDatabaseSnapshot((database) => {
    const row = database.prepare(`
      SELECT COUNT(*) AS count FROM workflow_runs
      WHERE state IN ('running', 'stopping')
    `).get() as { count?: unknown } | undefined;
    return Number(row?.count ?? 0);
  });
}

export const workflowRunApplication = Object.freeze({
  activeCount: activeWorkflowRunCount,
  continue: continueWorkflowRun,
  continuation: getWorkflowContinuation,
  continuationPreview: getWorkflowContinuationPreview,
  create: createWorkflowRun,
  get: getWorkflowRun,
  hasActiveForCanvas: hasActiveWorkflowRunForCanvas,
  initialize: initializeWorkflowRunner,
  kick: kickWorkflowRunner,
  list: listWorkflowRuns,
  stop: stopWorkflowRun,
  stopRunner: stopWorkflowRunner,
  sweep: runWorkflowSweep,
});
