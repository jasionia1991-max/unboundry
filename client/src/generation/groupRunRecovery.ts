import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { GenerationTaskSummary } from "./generationTasks";
import {
  groupRunSuccessProof,
  type GroupRunCheckpoint,
} from "./groupRunCheckpoint";
import type { GroupRunSummaryScope } from "./groupRunSummary";
import {
  isIncompleteLegacyTerminalGenerationBinding,
  legacyTerminalGenerationCandidate,
} from "./legacyTerminalGenerationReconciler";

export type GroupRecoveryReconstruction = Readonly<{
  blockedGroupIds: readonly string[];
  checkpoints: readonly GroupRunCheckpoint[];
}>;

function terminalSuccessIsAlreadyProjected(
  node: ProbeNodeType,
  task: GenerationTaskSummary,
) {
  if (task.state !== "success") return false;
  if (task.kind === "text") {
    return typeof task.resultText === "string" &&
      task.resultText.trim() === String(node.data.content ?? "").trim();
  }
  const source = task.kind === "image"
    ? node.data.imageSrc
    : task.kind === "video"
      ? node.data.videoSrc
      : node.data.audioSrc;
  return Boolean(
    (task.resultAssetId && node.data.assetId === task.resultAssetId) ||
      (task.resultUrl && source === task.resultUrl),
  );
}

function nodeGenerationContractFingerprint(
  node: ProbeNodeType,
  kind: GenerationTaskSummary["kind"],
) {
  const value = kind === "video"
    ? node.data.videoGenerationModelInputContractFingerprint
    : node.data[`${kind}GenerationContractFingerprint`];
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Rebuilds browser scheduling cache only from the two durable authorities:
 * Canvas task bindings and server task rows. It never creates or retries work.
 */
export function reconstructGroupRecoveryDecision(input: {
  nodes: readonly ProbeNodeType[];
  scope: GroupRunSummaryScope;
  tasks: readonly GenerationTaskSummary[];
}): GroupRecoveryReconstruction {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const blockedRunIds = new Set<string>();
  const blockedGroupIds = new Set<string>();
  const byRun = new Map<string, {
    acceptedTasks: NonNullable<GroupRunCheckpoint["acceptedTasks"]>;
    groupId: string;
    nodeStates: GroupRunCheckpoint["nodeStates"];
  }>();

  const accept = (inputValue: {
    groupId: string;
    inputFingerprint: string;
    kind: GenerationTaskSummary["kind"];
    modelInputContractFingerprint: string;
    modelConfigurationRevision?: string;
    modelReleaseRevision?: string;
    nodeId: string;
    ownershipKey: string;
    runId: string;
    taskId: string;
  }) => {
    if (blockedRunIds.has(inputValue.runId)) return;
    const current = byRun.get(inputValue.runId);
    if (current && current.groupId !== inputValue.groupId) {
      blockedGroupIds.add(current.groupId);
      blockedGroupIds.add(inputValue.groupId);
      byRun.delete(inputValue.runId);
      blockedRunIds.add(inputValue.runId);
      return;
    }
    const entry = current ?? {
      acceptedTasks: {},
      groupId: inputValue.groupId,
      nodeStates: {},
    };
    const existing = entry.acceptedTasks[inputValue.nodeId];
    if (existing && (
      existing.taskId !== inputValue.taskId ||
      existing.ownershipKey !== inputValue.ownershipKey ||
      existing.inputFingerprint !== inputValue.inputFingerprint ||
      existing.modelInputContractFingerprint !==
        inputValue.modelInputContractFingerprint ||
      existing.modelConfigurationRevision !==
        inputValue.modelConfigurationRevision ||
      existing.modelReleaseRevision !== inputValue.modelReleaseRevision
    )) {
      blockedGroupIds.add(inputValue.groupId);
      byRun.delete(inputValue.runId);
      blockedRunIds.add(inputValue.runId);
      return;
    }
    entry.acceptedTasks[inputValue.nodeId] = {
      inputFingerprint: inputValue.inputFingerprint,
      kind: inputValue.kind,
      modelInputContractFingerprint: inputValue.modelInputContractFingerprint,
      modelConfigurationRevision: inputValue.modelConfigurationRevision,
      modelReleaseRevision: inputValue.modelReleaseRevision,
      nodeId: inputValue.nodeId,
      ownershipKey: inputValue.ownershipKey,
      taskId: inputValue.taskId,
    };
    entry.nodeStates[inputValue.nodeId] = "running";
    byRun.set(inputValue.runId, entry);
  };

  for (const task of input.tasks) {
    if (
      task.canvasId !== input.scope.canvasId ||
      (task.fixtureScopeId ?? "") !== input.scope.fixtureScopeId
    ) continue;
    const node = nodeById.get(task.nodeId);
    if (!node?.parentId || node.type !== task.kind || task.state === "cancelled") {
      continue;
    }
    const projectedSuccess = groupRunSuccessProof(node);
    if (
      task.state === "success" && projectedSuccess?.taskId === task.id &&
      projectedSuccess.ownershipKey === task.generationOwnershipKey &&
      projectedSuccess.inputFingerprint === task.generationInputKey &&
      projectedSuccess.modelConfigurationRevision ===
        task.modelConfigurationRevision &&
      projectedSuccess.modelReleaseRevision === task.modelReleaseRevision
    ) continue;
    const workflowBindingFieldCount = [
      task.workflowGroupId,
      task.workflowExecutionRunId,
      task.generationOwnershipKey,
      task.generationInputKey,
      task.modelInputContractFingerprint,
      task.modelConfigurationRevision,
    ].filter((value) => typeof value === "string" && value.length > 0).length;
    if (workflowBindingFieldCount === 0) {
      // Historical standalone generations share the same task table. A
      // terminal result already visible on this exact node is not evidence of
      // an interrupted group run and must not permanently block later group
      // execution. An unprojected success or any unsettled/failed task remains
      // unknown and therefore fail-closed.
      if (terminalSuccessIsAlreadyProjected(node, task)) continue;
      // A legacy task on a group child cannot be proven standalone when the
      // browser cache/binding is missing. Never infer that a new paid POST is safe.
      blockedGroupIds.add(node.parentId);
      continue;
    }
    if (
      workflowBindingFieldCount !== 6 || task.generationIdentityVersion !== 2 ||
      task.workflowGroupId !== node.parentId ||
      !task.workflowExecutionRunId || !task.generationOwnershipKey ||
      !task.generationInputKey || !task.modelInputContractFingerprint ||
      !task.modelConfigurationRevision ||
      !task.modelReleaseRevision
    ) {
      blockedGroupIds.add(task.workflowGroupId ?? node.parentId);
      blockedGroupIds.add(node.parentId);
      continue;
    }
    accept({
      groupId: task.workflowGroupId,
      inputFingerprint: task.generationInputKey,
      kind: task.kind,
      modelInputContractFingerprint: task.modelInputContractFingerprint,
      modelConfigurationRevision: task.modelConfigurationRevision,
      modelReleaseRevision: task.modelReleaseRevision,
      nodeId: task.nodeId,
      ownershipKey: task.generationOwnershipKey,
      runId: task.workflowExecutionRunId,
      taskId: task.id,
    });
  }

  for (const node of input.nodes) {
    if (node.parentId && isIncompleteLegacyTerminalGenerationBinding(node)) {
      blockedGroupIds.add(node.parentId);
    }
    const candidate = legacyTerminalGenerationCandidate({
      accountId: input.scope.accountId,
      canvasId: input.scope.canvasId,
      fixtureScopeId: input.scope.fixtureScopeId,
      node,
    });
    if (!candidate || !node.parentId) continue;
    if (blockedRunIds.has(candidate.runId)) continue;
    const task = taskById.get(candidate.taskId);
    const contractFingerprint = nodeGenerationContractFingerprint(
      node,
      candidate.kind,
    );
    if (
      !task || task.canvasId !== input.scope.canvasId ||
      (task.fixtureScopeId ?? "") !== input.scope.fixtureScopeId ||
      task.nodeId !== candidate.nodeId || task.kind !== candidate.kind ||
      !contractFingerprint ||
      task.modelInputContractFingerprint !== contractFingerprint ||
      task.modelConfigurationRevision !==
        node.data[`${candidate.kind}GenerationModelConfigurationRevision`] ||
      (task.workflowExecutionRunId !== undefined &&
        task.workflowExecutionRunId !== candidate.runId) ||
      (task.generationOwnershipKey !== undefined &&
        task.generationOwnershipKey !== candidate.ownershipKey) ||
      (task.generationInputKey !== undefined &&
        task.generationInputKey !== candidate.inputFingerprint)
    ) continue;
    if (
      task.workflowGroupId && task.workflowExecutionRunId &&
      task.generationOwnershipKey && task.generationInputKey &&
      task.modelInputContractFingerprint && task.modelConfigurationRevision &&
      task.modelReleaseRevision
    ) continue;
    accept({
      groupId: node.parentId,
      inputFingerprint: candidate.inputFingerprint,
      kind: candidate.kind,
      modelInputContractFingerprint: contractFingerprint,
      modelConfigurationRevision: task.modelConfigurationRevision,
      modelReleaseRevision:
        typeof node.data[`${candidate.kind}GenerationModelReleaseRevision`] ===
            "string"
          ? node.data[`${candidate.kind}GenerationModelReleaseRevision`] as string
          : undefined,
      nodeId: candidate.nodeId,
      ownershipKey: candidate.ownershipKey,
      runId: candidate.runId,
      taskId: candidate.taskId,
    });
  }

  const now = Date.now();
  const checkpoints = [...byRun.entries()].flatMap(([runId, entry]) => {
    const group = nodeById.get(entry.groupId);
    if (!group || group.type !== "group") return [];
    const executableNodeIds = Object.keys(entry.acceptedTasks).sort();
    return [{
      ...input.scope,
      acceptedTasks: entry.acceptedTasks,
      executableNodeIds,
      groupId: entry.groupId,
      nodeStates: entry.nodeStates,
      projectionPendingNodeIds: [],
      runId,
      // Deliberately cannot equal a live graph snapshot: accepted tasks are
      // recovered first, then the current graph receives a fresh run.
      snapshotFingerprint: `authority-reconstructed-v2:${runId}`,
      startedAt: now,
      status: "interrupted" as const,
      successProofs: {},
      updatedAt: now,
      version: 2 as const,
    }];
  });
  return {
    blockedGroupIds: [...blockedGroupIds].sort(),
    checkpoints,
  };
}

export function reconstructGroupRecoveryCheckpoints(input: {
  nodes: readonly ProbeNodeType[];
  scope: GroupRunSummaryScope;
  tasks: readonly GenerationTaskSummary[];
}): GroupRunCheckpoint[] {
  return [...reconstructGroupRecoveryDecision(input).checkpoints];
}
