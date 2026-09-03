import { randomUUID } from "node:crypto";
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
  parseImmutableWorkflowPlan,
  WorkflowPlanValidationError,
  type StoredWorkflowNodePlan as StoredNodePlan,
  type StoredWorkflowPlan,
  type WorkflowRunSummary,
} from "../types/workflowRuns";
import { stableValueFingerprint } from "../types/canvasFingerprint";

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
  const graphNodes = input.plan.externalNodes.map((node) => {
    const external = node as {
      data?: Record<string, unknown>;
      id: string;
      type: NodeInputKind;
    };
    const frozen = { ...(external.data ?? {}) };
    const data = external.type !== "text" && typeof frozen.assetId === "string"
      ? authoritativeMediaSourceData(
          String(input.runRow.owner_id),
          external.type,
          frozen.assetId,
        )
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
  });
  linkWorkflowTask({
    database: input.database,
    nodeId,
    runId,
    taskId: admitted.task.id,
  });
}

function htmlForPlainText(value: string) {
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
  return `<p>${escaped}</p>`;
}

function projectionPatch(nodePlan: StoredNodePlan, task: ReturnType<ReturnType<typeof generationTaskApplication.taskStore>["get"]>) {
  if (!task) return undefined;
  const generationInputKey = task.modelConfiguration.generationInputKey;
  const generationOwnershipKey = task.modelConfiguration.generationOwnershipKey;
  const taskModelConfigurationRevision =
    task.modelConfiguration.modelConfigurationRevision;
  const taskModelReleaseRevision = task.modelConfiguration.modelReleaseRevision;
  const taskModelReleaseRevisionId = taskModelReleaseRevision &&
      typeof taskModelReleaseRevision === "object" &&
      !Array.isArray(taskModelReleaseRevision)
    ? (taskModelReleaseRevision as Record<string, unknown>).revisionId
    : undefined;
  if (
    typeof generationInputKey !== "string" || !generationInputKey ||
    typeof generationOwnershipKey !== "string" || !generationOwnershipKey ||
    taskModelConfigurationRevision !== nodePlan.modelConfigurationRevision ||
    taskModelReleaseRevisionId !== nodePlan.modelReleaseRevision.revisionId
  ) return undefined;
  const result = nodePlan.kind === "text"
    ? (() => {
        const content = task.resultText?.trim() ?? "";
        return { content, contentHtml: htmlForPlainText(content) };
      })()
    : task.resultAssetId && task.ownerId
      ? (authoritativeMediaSourceData(
          task.ownerId,
          nodePlan.kind,
          task.resultAssetId,
        ) as Record<string, unknown>)[`${nodePlan.kind}Src`]
      : undefined;
  if (
    nodePlan.kind === "text"
      ? typeof (result as { content?: unknown }).content !== "string" ||
        !(result as { content: string }).content
      : typeof result !== "string" || !result
  ) return undefined;
  const common = {
    [`${nodePlan.kind}Generating`]: false,
    [`${nodePlan.kind}GenerationError`]: undefined,
    [`${nodePlan.kind}GenerationErrorCode`]: undefined,
    [`${nodePlan.kind}GenerationRetryAllowed`]: undefined,
    [`${nodePlan.kind}GenerationRetryBlockCode`]: undefined,
    [`${nodePlan.kind}GenerationRetryBlockReason`]: undefined,
    groupRunSuccessInputFingerprint: generationInputKey,
    groupRunSuccessModelConfigurationRevision:
      nodePlan.modelConfigurationRevision,
    groupRunSuccessModelReleaseRevision:
      nodePlan.modelReleaseRevision.revisionId,
    groupRunSuccessOwnershipKey: generationOwnershipKey,
    groupRunSuccessResultKey: stableValueFingerprint(result),
    groupRunSuccessTaskId: task.id,
    workflowExecutionRunId: undefined,
  };
  if (nodePlan.kind === "text") {
    const content = task.resultText?.trim() ?? "";
    return {
      ...common,
      content,
      contentHtml: htmlForPlainText(content),
      textGenerationInputKey: undefined,
      textGenerationOwnershipKey: undefined,
      textGenerationTaskId: task.id,
    };
  }
  if (!task.resultAssetId || !task.ownerId) return undefined;
  const media = authoritativeMediaSourceData(
    task.ownerId,
    nodePlan.kind,
    task.resultAssetId,
  );
  if (media.inputState !== "ready") return undefined;
  const mediaPatch = {
    ...common,
    ...media,
    [`${nodePlan.kind}GenerationInputKey`]: undefined,
    [`${nodePlan.kind}GenerationOwnershipKey`]: undefined,
    [`${nodePlan.kind}GenerationTaskId`]: undefined,
  };
  if (nodePlan.kind === "image") {
    return { ...mediaPatch, imageGeneratedSuccess: true };
  }
  if (nodePlan.kind === "audio") {
    return {
      ...mediaPatch,
      audioDuration: media.mediaDurationSeconds,
      audioFileSize: media.mediaByteSize,
      audioGeneratedResult: true,
      audioPrompt: nodePlan.ownPrompt,
    };
  }
  return {
    ...mediaPatch,
    videoAudioEnabled: task.parameters.generateAudio !== false,
    videoCreatedAt: new Date(task.updatedAt).toLocaleDateString("zh-CN"),
    videoDuration: media.mediaDurationSeconds,
    videoFileSize: media.mediaByteSize,
    videoHeight: media.mediaHeight,
    videoPrompt: nodePlan.ownPrompt,
    videoWidth: media.mediaWidth,
  };
}

function projectWorkflowNode(database: DatabaseSync, input: {
  nodePlan: StoredNodePlan;
  runRow: Record<string, unknown>;
  taskId: string;
}) {
  const task = generationTaskApplication.taskStore().get(input.taskId);
  const patch = projectionPatch(input.nodePlan, task);
  if (!patch) return "failed" as const;
  return projectWorkflowResultInTransaction({
    canvasId: String(input.runRow.canvas_id),
    database,
    expectedModelId: input.nodePlan.modelId,
    expectedPrompt: input.nodePlan.ownPrompt,
    kind: input.nodePlan.kind,
    nodeId: input.nodePlan.id,
    ownerId: String(input.runRow.owner_id),
    patch,
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
        let projectionState: "applied" | "conflict" | "failed";
        try {
          projectionState = projectWorkflowNode(database, {
            nodePlan,
            runRow: run,
            taskId: row.task_id,
          });
        } catch {
          projectionState = "failed";
        }
        database.prepare(`
          UPDATE workflow_run_nodes SET projection_state = ?, updated_at = ?
          WHERE run_id = ? AND node_id = ? AND projection_state = 'failed'
        `).run(
          projectionState,
          new Date().toISOString(),
          runId,
          row.node_id,
        );
        database.exec("COMMIT");
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK");
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

async function processWorkflowRun(runId: string) {
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
          database.prepare(`
            UPDATE workflow_run_nodes SET state = 'success', updated_at = ?
            WHERE run_id = ? AND node_id = ? AND state = 'admitted'
          `).run(timestamp, runId, String(node.node_id));
          let projectionState: "applied" | "conflict" | "failed";
          try {
            projectionState = projectWorkflowNode(database, {
              nodePlan,
              runRow: run,
              taskId: task.id,
            });
          } catch {
            // Projection is a recoverable side effect. The authoritative task
            // and publication still prove node success and unblock the DAG.
            projectionState = "failed";
          }
          database.prepare(`
            UPDATE workflow_run_nodes SET projection_state = ?, updated_at = ?
            WHERE run_id = ? AND node_id = ?
          `).run(projectionState, timestamp, runId, String(node.node_id));
          database.exec("COMMIT");
        } catch (error) {
          if (database.isTransaction) database.exec("ROLLBACK");
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
  const database = openAppDatabase();
  let ids: string[];
  let projectionRetryIds: string[];
  try {
    ids = (database.prepare(`
      SELECT id FROM workflow_runs WHERE state IN ('running', 'stopping')
      ORDER BY updated_at, created_at, id
    `).all() as Array<{ id: string }>).map(({ id }) => id);
    projectionRetryIds = (database.prepare(`
      SELECT DISTINCT run.id
      FROM workflow_runs AS run
      JOIN workflow_run_nodes AS node ON node.run_id = run.id
      WHERE run.state IN ('success', 'failed', 'cancelled')
        AND node.state = 'success' AND node.projection_state = 'failed'
      ORDER BY run.updated_at LIMIT 50
    `).all() as Array<{ id: string }>).map(({ id }) => id);
  } finally {
    database.close();
  }
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
  const database = openAppDatabase();
  try {
    const row = database.prepare(`
      SELECT COUNT(*) AS count FROM workflow_runs
      WHERE state IN ('running', 'stopping')
    `).get() as { count?: unknown } | undefined;
    return Number(row?.count ?? 0);
  } finally {
    database.close();
  }
}

export const workflowRunApplication = Object.freeze({
  activeCount: activeWorkflowRunCount,
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
