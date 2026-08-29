import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { CuttableEdge } from "../canvas/canvasTypes";
import type {
  CanvasGraphCommandPort,
  CanvasSavePort,
} from "../canvas/canvasPorts";
import {
  useModelCatalogStatus,
  usePublishedModels,
} from "../models/ModelCatalog";
import { useGenerationCanvas } from "./GenerationCanvasContext";
import {
  type NodeExecutor,
  type NodeExecutorContext,
} from "./nodeExecutorRegistry";
import {
  createNodeExecutorRegistry,
  currentWorkflowGenerationBinding,
} from "./workflowNodeExecutors";
import {
  persistGroupCanvasAfterNode,
  runGroupNodeWithPersist,
  stripStaleCanvasSaveErrors,
} from "./groupRunPersist";
import {
  buildWorkflowLayers,
  isExecutableWorkflowNode,
  isWorkflowNodeGenerating,
  runWorkflowGraph,
  type NodeRunResult,
  type WorkflowGraphNodeState,
  type WorkflowPreflightPhase,
} from "./workflowExecution";
import {
  nextGroupRunSequence,
  publishGroupRunSummary,
  type GroupRunSummary,
} from "./groupRunSummary";
import {
  clearGroupRunStarting,
  clearGroupRunCheckpoint,
  acquireGroupRunLease,
  GROUP_RUN_AUTHORITY_EVENT,
  GROUP_RUN_CONTINUE_EVENT,
  GROUP_RUN_LEASE_EVENT,
  GROUP_RUN_STOP_EVENT,
  getGroupRunExecutionOwnerId,
  groupRunLeaseHeartbeatMs,
  groupRunSnapshotFingerprint,
  groupRunSuccessProof,
  hasConflictingActiveGroupRunLeaseForCanvas,
  isGroupRunLeaseActive,
  markGroupRunStarting,
  quarantineCorruptGroupRunCacheAfterAuthority,
  readGroupRunCheckpointCache,
  readGroupRunCheckpoint,
  readGroupRunCheckpoints,
  readGroupRunLease,
  readGroupRunLeaseCache,
  releaseGroupRunLease,
  renewGroupRunLease,
  runWithGroupRunCanvasAdmission,
  setGroupRunAuthoritySettledEmpty,
  taskMatchesAcceptedBinding,
  type AcceptedTaskBinding,
  type GroupRunCheckpoint,
  verifiedCheckpointSuccessIds,
  writeGroupRunCheckpoint,
} from "./groupRunCheckpoint";
import { reconstructGroupRecoveryDecision } from "./groupRunRecovery";
import { publishGroupRunNotificationOnce } from "./groupRunNotification";
import { runExclusiveCanvasSubmit } from "./saveGate";
import { listGenerationTasks } from "./generationTasks";
import {
  enqueueGroupResultProjection,
  type GroupResultProjectionResult,
  waitForGroupResultProjections,
  reconcileGroupResultProjection,
  unresolvedProjectionNodeIds,
} from "./groupResultProjection";
import { getGenerationTask } from "./generationTasks";
import {
  classifyLegacyTerminalGenerationTask,
  detachLegacyTerminalGeneration,
  getLegacyTerminalGenerationPolicy,
  isIncompleteLegacyTerminalGenerationBinding,
  legacyTerminalCanvasWriteAllowed,
  legacyTerminalGenerationCandidate,
  legacyTerminalGenerationCandidateStillMatches,
  type LegacyTerminalGenerationCandidate,
  type LegacyTerminalGenerationState,
} from "./legacyTerminalGenerationReconciler";
import {
  clearLegacyGenerationSubmissionBlocks,
  LegacyTerminalGenerationStateProvider,
  replaceLegacyGenerationSubmissionBlocks,
} from "./legacyTerminalGenerationState";

export type { NodeRunResult };

const runtimeInputRefreshTimeoutMs = 5_000;

function workflowNodeTitle(node: ProbeNodeType | undefined, fallback: string) {
  if (typeof node?.data.title === "string" && node.data.title.trim()) {
    return node.data.title.trim();
  }
  if (typeof node?.data.label === "string" && node.data.label.trim()) {
    return node.data.label.trim();
  }
  return fallback;
}

function workflowNodeErrorCode(node: ProbeNodeType | undefined) {
  if (!node) return undefined;
  const value = node.type === "text"
    ? node.data.textGenerationErrorCode
    : node.type === "image"
      ? node.data.imageGenerationErrorCode
      : node.type === "video"
        ? node.data.videoGenerationErrorCode
        : node.type === "audio"
          ? node.data.audioGenerationErrorCode
          : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function taskBelongsToWorkflowRun(
  node: ProbeNodeType | undefined,
  task: { id: string; kind: "audio" | "image" | "text" | "video" },
  runId: string,
) {
  if (!node || node.data.workflowExecutionRunId !== runId) return false;
  const data = node.data as Record<string, unknown>;
  return data[`${task.kind}GenerationTaskId`] === task.id;
}

function workflowStateCount(
  states: ReadonlyMap<string, WorkflowGraphNodeState>,
  state: WorkflowGraphNodeState,
) {
  return Array.from(states.values()).filter((value) => value === state).length;
}

async function waitForRuntimePreflight(
  executor: NodeExecutor,
  nodeId: string,
  context: NodeExecutorContext,
  executableIds: ReadonlySet<string>,
  isCancelled?: () => boolean,
) {
  const deadline = Date.now() + runtimeInputRefreshTimeoutMs;
  while (true) {
    if (isCancelled?.()) return { message: "已停止后续节点", status: "skipped" as const };
    const result = await executor.preflight(
      nodeId,
      context,
      executableIds,
      "runtime",
    );
    if (isCancelled?.()) return { message: "已停止后续节点", status: "skipped" as const };
    if (result.status !== "busy") return result;
    if (Date.now() >= deadline) {
      if (isCancelled?.()) {
        return { message: "已停止后续节点", status: "skipped" as const };
      }
      return executor.preflight(
        nodeId,
        context,
        executableIds,
        "runtime-final",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function runRegisteredNodeWithRefreshRecovery(input: {
  context: NodeExecutorContext;
  executor: NodeExecutor;
  executableIds: ReadonlySet<string>;
  isCancelled: () => boolean;
  nodeId: string;
}) {
  const deadline = Date.now() + runtimeInputRefreshTimeoutMs;
  while (true) {
    if (input.isCancelled()) {
      return { message: "已停止后续节点", status: "skipped" as const };
    }
    const preflight = await waitForRuntimePreflight(
      input.executor,
      input.nodeId,
      input.context,
      input.executableIds,
      input.isCancelled,
    );
    if (preflight.status !== "success") return preflight;
    // A stop can arrive after the preflight await. Re-check directly before
    // the registration's paid-submit path.
    if (input.isCancelled()) {
      return { message: "已停止后续节点", status: "skipped" as const };
    }
    const result = await input.executor.run(
      input.nodeId,
      input.context,
      input.executableIds,
    );
    if (result.status !== "busy") return result;
    if (input.isCancelled()) {
      return { message: "已停止后续节点", status: "skipped" as const };
    }
    if (Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

type WorkflowExecutionValue = {
  cancelGroup: (groupId: string) => void;
  executeGroup: (
    groupId: string,
    checkpoint?: GroupRunCheckpoint,
  ) => Promise<void>;
  executingGroupIds: ReadonlySet<string>;
  lockedNodeIds: ReadonlySet<string>;
};

const WorkflowExecutionContext = createContext<WorkflowExecutionValue>({
  cancelGroup: () => undefined,
  executeGroup: async () => undefined,
  executingGroupIds: new Set(),
  lockedNodeIds: new Set(),
});

export function WorkflowExecutionProvider({
  children,
  graph,
  getEdges,
  getNodes,
  nodesSnapshot,
  notify,
  onRetainedNodeIdsChange,
  setNodes,
}: {
  children: ReactNode;
  graph: CanvasGraphCommandPort;
  getEdges: () => CuttableEdge[];
  getNodes: () => ProbeNodeType[];
  nodesSnapshot: ProbeNodeType[];
  notify: (message: string, kind?: "error" | "info" | "success") => void;
  onRetainedNodeIdsChange: (nodeIds: ReadonlySet<string>) => void;
  setNodes: Dispatch<SetStateAction<ProbeNodeType[]>>;
}) {
  const {
    accountId,
    adoptAuthoritativeGenerationMutation,
    canvasId,
    fixtureScopeId,
    flushCanvasSave,
    isFixture,
    persistenceReady,
    readAuthoritativeCanvasRevision,
    waitForCanvasRevision,
  } = useGenerationCanvas();
  const save = useMemo<CanvasSavePort>(() => ({
    flush: flushCanvasSave,
    waitForRevision: async (timeoutMs) => ({
      revision: await waitForCanvasRevision(timeoutMs),
    }),
  }), [flushCanvasSave, waitForCanvasRevision]);
  const registry = useMemo(() => createNodeExecutorRegistry(), []);
  const modelCatalogStatus = useModelCatalogStatus();
  const textModels = usePublishedModels("text");
  const imageModels = usePublishedModels("image");
  const audioModels = usePublishedModels("audio");
  const videoModels = usePublishedModels("video");
  const executorModelCatalog = useMemo(() => ({
    models: {
      audio: audioModels,
      image: imageModels,
      text: textModels,
      video: videoModels,
    },
    status: modelCatalogStatus,
  }), [audioModels, imageModels, modelCatalogStatus, textModels, videoModels]);
  const startingGroupIds = useRef(new Set<string>());
  const startingGroups = useRef(new Map<string, {
    cancelled: boolean;
    runId: string;
  }>());
  const runningGroups = useRef(new Map<string, {
    activeNodeIds: Set<string>;
    abortController: AbortController;
    cancelled: boolean;
    checkpoint: GroupRunCheckpoint;
    checkpointWriteFailed: boolean;
    leaseLost: boolean;
    navigationStopped: boolean;
    ownerId: string;
    publishStopping: () => void;
    runId: string;
  }>());
  const runLocks = useRef(new Map<string, ReadonlySet<string>>());
  const automaticRecoveryScopeKey = useRef<string | undefined>(undefined);
  const legacyReconciliationRunToken = useRef(0);
  const legacyRecheckAttempts = useRef(new Map<string, number>());
  const publishedRunNotifications = useRef(new Map<
    string,
    Set<"recovering" | "terminal">
  >());
  const notifyCurrent = useRef(notify);
  notifyCurrent.current = notify;
  const getLegacyNodes = useRef(getNodes);
  getLegacyNodes.current = getNodes;
  const [legacyGenerationStates, setLegacyGenerationStates] = useState<
    ReadonlyMap<string, LegacyTerminalGenerationState>
  >(new Map());
  const legacyBindingSignature = useMemo(() => JSON.stringify(
    nodesSnapshot.flatMap((node) => {
      const candidate = legacyTerminalGenerationCandidate({
        accountId,
        canvasId,
        fixtureScopeId,
        node,
      });
      if (candidate) {
        return [[
          candidate.nodeId,
          candidate.kind,
          candidate.nodeDataFingerprint,
          candidate.runId,
          candidate.taskId,
          candidate.ownershipKey,
          candidate.inputFingerprint,
        ]];
      }
      return isIncompleteLegacyTerminalGenerationBinding(node)
        ? [[node.id, node.type, "incomplete"]]
        : [];
    }),
  ), [accountId, canvasId, fixtureScopeId, nodesSnapshot]);
  const hasLegacyGenerationBindings = legacyBindingSignature !== "[]";
  const [executingGroupIds, setExecutingGroupIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [lockedNodeIds, setLockedNodeIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [foreignLeaseLockedNodeIds, setForeignLeaseLockedNodeIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const publishActiveRunState = useCallback(() => {
    const nextGroups = new Set([
      ...startingGroups.current.keys(),
      ...runningGroups.current.keys(),
    ]);
    const nextLocks = new Set<string>();
    for (const locks of runLocks.current.values()) {
      for (const nodeId of locks) nextLocks.add(nodeId);
    }
    setExecutingGroupIds(nextGroups);
    setLockedNodeIds(nextLocks);
  }, []);
  useEffect(() => {
    const scope = { accountId, canvasId, fixtureScopeId };
    const refresh = () => {
      const cache = readGroupRunLeaseCache(scope);
      const next = new Set<string>();
      if (cache.corrupted) {
        for (const node of nodesSnapshot) {
          if (isExecutableWorkflowNode(node)) next.add(node.id);
        }
      } else {
        for (const lease of cache.leases) {
          if (!isGroupRunLeaseActive(lease) ||
            lease.ownerId === getGroupRunExecutionOwnerId()) continue;
          for (const nodeId of lease.lockedNodeIds) next.add(nodeId);
        }
      }
      setForeignLeaseLockedNodeIds((current) =>
        current.size === next.size && [...current].every((id) => next.has(id))
          ? current
          : next
      );
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(GROUP_RUN_LEASE_EVENT, refresh);
    window.addEventListener(GROUP_RUN_AUTHORITY_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(GROUP_RUN_LEASE_EVENT, refresh);
      window.removeEventListener(GROUP_RUN_AUTHORITY_EVENT, refresh);
    };
  }, [accountId, canvasId, fixtureScopeId, nodesSnapshot]);
  const effectiveLockedNodeIds = useMemo(() => new Set([
    ...lockedNodeIds,
    ...foreignLeaseLockedNodeIds,
  ]), [foreignLeaseLockedNodeIds, lockedNodeIds]);
  useEffect(() => {
    onRetainedNodeIdsChange(effectiveLockedNodeIds);
  }, [effectiveLockedNodeIds, onRetainedNodeIdsChange]);

  const setLegacyGenerationState = useCallback((
    nodeId: string,
    state: LegacyTerminalGenerationState,
  ) => {
    setLegacyGenerationStates((current) => {
      if (current.get(nodeId) === state) return current;
      const next = new Map(current);
      next.set(nodeId, state);
      return next;
    });
  }, []);

  useEffect(() => {
    setLegacyGenerationStates(new Map());
    legacyRecheckAttempts.current.clear();
  }, [accountId, canvasId]);

  useEffect(() => {
    setLegacyGenerationStates(new Map());
  }, [legacyBindingSignature]);

  useEffect(() => {
    replaceLegacyGenerationSubmissionBlocks({
      accountId,
      canvasId,
      fixtureScopeId,
      states: legacyGenerationStates,
    });
    return () => clearLegacyGenerationSubmissionBlocks(
      accountId,
      canvasId,
      fixtureScopeId,
    );
  }, [accountId, canvasId, fixtureScopeId, legacyGenerationStates]);

  useEffect(() => {
    if (executingGroupIds.size === 0 && startingGroupIds.current.size === 0) {
      return;
    }
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [executingGroupIds]);

  useEffect(() => {
    const scope = { accountId, canvasId, fixtureScopeId };
    const interruptForPageExit = () => {
      const ownerId = getGroupRunExecutionOwnerId();
      for (const starting of startingGroups.current.values()) {
        starting.cancelled = true;
        const checkpoint = readGroupRunCheckpoint(scope, starting.runId);
        const lease = readGroupRunLease(scope, starting.runId);
        if (checkpoint && lease?.ownerId === ownerId) {
          writeGroupRunCheckpoint({
            ...checkpoint,
            status: "interrupted",
            updatedAt: Date.now(),
          }, { ownerId, runId: starting.runId });
        }
        releaseGroupRunLease(scope, starting.runId, ownerId);
      }
      for (const running of runningGroups.current.values()) {
        if (running.ownerId !== ownerId) continue;
        running.cancelled = true;
        running.navigationStopped = true;
        running.abortController.abort("page-exit");
        const interrupted = {
          ...running.checkpoint,
          status: "interrupted" as const,
          updatedAt: Date.now(),
        };
        running.checkpoint = interrupted;
        writeGroupRunCheckpoint(interrupted, {
          ownerId,
          runId: running.runId,
        });
        releaseGroupRunLease(scope, running.runId, ownerId);
      }
    };
    window.addEventListener("pagehide", interruptForPageExit);
    return () => window.removeEventListener("pagehide", interruptForPageExit);
  }, [accountId, canvasId, fixtureScopeId]);

  const cancelGroup = useCallback((groupId: string) => {
    const running = runningGroups.current.get(groupId);
    const starting = startingGroups.current.get(groupId);
    if (!running && !starting) return;
    if (starting && !running) {
      if (starting.cancelled) return;
      starting.cancelled = true;
      notify("已停止整组准备，不会再提交后续生成任务");
      return;
    }
    if (!running || running.cancelled) return;
    running.cancelled = true;
    const nextCheckpoint = {
      ...running.checkpoint,
      status: "stopping" as const,
      updatedAt: Date.now(),
    };
    running.checkpoint = nextCheckpoint;
    if (!writeGroupRunCheckpoint(nextCheckpoint, {
      ownerId: running.ownerId,
      runId: nextCheckpoint.runId,
    })) {
      running.checkpointWriteFailed = true;
      notify("停止状态无法保存，已阻止后续节点；请勿在其他标签页继续", "error");
    }
    running.publishStopping();
    const activeCount = running.activeNodeIds.size;
    notify(
      `已停止后续节点；当前已开始的 ${activeCount} 个节点仍会继续处理，已经提交的任务会继续并保存结果。`,
    );
  }, [notify]);

  const waitForCanvasStable = useCallback(async (
    groupId: string,
    isCancelled?: () => boolean,
  ) => {
    // 画布自动保存期间不弹红字：最多等三轮，每轮 30 秒；
    // 保存完成会自动继续，只有真正超时才给中性提示。
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (isCancelled?.()) return;
      try {
        await flushCanvasSave();
        if (isCancelled?.()) return;
        const revision = await waitForCanvasRevision(30_000);
        if (isCancelled?.()) return;
        const stripped = stripStaleCanvasSaveErrors(getNodes(), groupId);
        if (!stripped.changed) return revision;
        setNodes(stripped.nodes);
        await flushCanvasSave();
        if (isCancelled?.()) return;
        return await waitForCanvasRevision(30_000);
      } catch (error) {
        if (attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }, [flushCanvasSave, getNodes, setNodes, waitForCanvasRevision]);

  const executeGroup = useCallback(
    async (
      groupId: string,
      resumeCheckpoint?: GroupRunCheckpoint,
      acceptedTasksOnly = false,
    ) => {
      if (isFixture) {
        notify("验收页面不会触发真实生成");
        return;
      }
      if (["0", "false"].includes(
        String(import.meta.env.VITE_UNBOUNDRY_WORKFLOW_SELF_HEALING_V2 ?? "")
          .toLowerCase(),
      )) {
        notify("工作流自动自愈已由管理员临时止损；本轮未提交生成任务", "error");
        return;
      }
      if (runningGroups.current.has(groupId) || startingGroupIds.current.has(groupId)) {
        return;
      }
      const scope = { accountId, canvasId, fixtureScopeId };
      const recoveryNotificationRunId = resumeCheckpoint?.runId ??
        `cache-recovery:${groupId}`;
      const notifyPreAdmissionRecoveryOnce = (
        message: string,
        kind: "error" | "info" = "info",
      ) => {
        const phase = kind === "error" ? "terminal" : "recovering";
        if (publishGroupRunNotificationOnce(publishedRunNotifications.current, {
          accountId,
          canvasId,
          errorClass: kind === "error"
            ? "pre-admission-terminal"
            : "pre-admission-recovering",
          groupId,
          nodeId: groupId,
          runId: recoveryNotificationRunId,
        }, phase)) notify(message, kind);
      };
      const acceptedTaskMapsMatch = (
        left: GroupRunCheckpoint["acceptedTasks"],
        right: GroupRunCheckpoint["acceptedTasks"],
      ) => {
        const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) =>
          a.localeCompare(b)
        );
        const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) =>
          a.localeCompare(b)
        );
        return leftEntries.length === rightEntries.length &&
          leftEntries.every(([nodeId, binding], index) => {
            const [rightNodeId, rightBinding] = rightEntries[index] ?? [];
            return nodeId === rightNodeId &&
              binding.nodeId === rightBinding?.nodeId &&
              binding.kind === rightBinding.kind &&
              binding.taskId === rightBinding.taskId &&
              binding.ownershipKey === rightBinding.ownershipKey &&
              binding.inputFingerprint === rightBinding.inputFingerprint &&
              binding.modelInputContractFingerprint ===
                rightBinding.modelInputContractFingerprint &&
              binding.modelConfigurationRevision ===
                rightBinding.modelConfigurationRevision &&
              binding.modelReleaseRevision ===
                rightBinding.modelReleaseRevision;
          });
      };
      let recoveryAuthorityTaskIds: ReadonlySet<string> | undefined;
      const readRecoveryAuthority = async () => {
        const tasks = await listGenerationTasks(
          canvasId,
          undefined,
          scope.fixtureScopeId,
        );
        recoveryAuthorityTaskIds = new Set(tasks.map((task) => task.id));
        return reconstructGroupRecoveryDecision({
          nodes: getNodes(),
          scope,
          tasks,
        });
      };
      if (resumeCheckpoint &&
        Object.keys(resumeCheckpoint.acceptedTasks ?? {}).length > 0) {
        acceptedTasksOnly = true;
      }
      const liveRunIds = new Set([
        ...[...startingGroups.current.values()].map((run) => run.runId),
        ...[...runningGroups.current.values()].map((run) => run.runId),
      ]);
      const candidateNodes = getNodes();
      const candidateEdges = getEdges();
      let durableRestartCheckpoint: GroupRunCheckpoint | undefined;
      const resumeCache = resumeCheckpoint
        ? readGroupRunCheckpointCache(scope)
        : undefined;
      const resumeLeaseCache = resumeCheckpoint
        ? readGroupRunLeaseCache(scope)
        : undefined;
      if (resumeCheckpoint && (
        resumeCache?.corrupted || resumeCache?.quarantined ||
        resumeLeaseCache?.corrupted || resumeLeaseCache?.quarantined
      )) {
        try {
          const reconstructed = await quarantineCorruptGroupRunCacheAfterAuthority(
            scope,
            readRecoveryAuthority,
          );
          if (!reconstructed) {
            notifyPreAdmissionRecoveryOnce(
              "系统正在安全核对已接收任务，确认后会自动继续",
            );
            return;
          }
          const exact = reconstructed.checkpoints.find((checkpoint) =>
            checkpoint.groupId === resumeCheckpoint?.groupId &&
            checkpoint.runId === resumeCheckpoint?.runId
          );
          if (
            reconstructed.blockedGroupIds.includes(groupId) || !exact ||
            !acceptedTaskMapsMatch(
              exact.acceptedTasks,
              resumeCheckpoint.acceptedTasks,
            )
          ) {
            notifyPreAdmissionRecoveryOnce(
              "恢复缓存无法从已接收任务完整重建；本轮未提交新任务",
              "error",
            );
            return;
          }
          if (reconstructed.checkpoints.some((checkpoint) =>
            !writeGroupRunCheckpoint(checkpoint)
          )) {
            notifyPreAdmissionRecoveryOnce(
              "自动恢复记录无法安全保存；本轮未提交新任务",
              "error",
            );
            return;
          }
          resumeCheckpoint = exact;
          acceptedTasksOnly = true;
        } catch {
          notifyPreAdmissionRecoveryOnce(
            "系统正在安全核对已接收任务，确认后会自动继续",
          );
          return;
        }
      }
      if (!resumeCheckpoint) {
        const cache = readGroupRunCheckpointCache(scope);
        const leaseCache = readGroupRunLeaseCache(scope);
        const cacheNeedsAuthorityQuarantine =
          cache.corrupted || cache.quarantined ||
          leaseCache.corrupted || leaseCache.quarantined;
        let groupCheckpoints = cache.checkpoints
          .filter((candidate) =>
            candidate.groupId === groupId && !liveRunIds.has(candidate.runId)
          );
        if (cacheNeedsAuthorityQuarantine || groupCheckpoints.length === 0) {
          try {
            const reconstructed = cacheNeedsAuthorityQuarantine
              ? await quarantineCorruptGroupRunCacheAfterAuthority(
                scope,
                readRecoveryAuthority,
              )
              : await runWithGroupRunCanvasAdmission(
                canvasId,
                readRecoveryAuthority,
              );
            if (!reconstructed) {
              notifyPreAdmissionRecoveryOnce(
                "系统正在安全核对已接收任务，确认后会自动继续",
              );
              return;
            }
            if (reconstructed.blockedGroupIds.includes(groupId)) {
              notifyPreAdmissionRecoveryOnce(
                "系统发现无法完整核对的已接收任务；本轮未提交新任务",
                "error",
              );
              return;
            }
            const rebuiltAll = reconstructed.checkpoints.filter((checkpoint) =>
              !liveRunIds.has(checkpoint.runId)
            );
            for (const checkpoint of rebuiltAll) {
              if (!writeGroupRunCheckpoint(checkpoint)) {
                notifyPreAdmissionRecoveryOnce(
                  "自动恢复记录无法安全保存；本轮未提交新任务",
                  "error",
                );
                return;
              }
            }
            const rebuilt = rebuiltAll.filter((checkpoint) =>
              checkpoint.groupId === groupId &&
              !liveRunIds.has(checkpoint.runId)
            );
            groupCheckpoints = rebuilt;
          } catch {
            notifyPreAdmissionRecoveryOnce(
              "系统正在安全核对已接收任务，确认后会自动继续",
            );
            return;
          }
        }
        if (groupCheckpoints.length > 1) {
          const acceptedRecords = groupCheckpoints.filter((checkpoint) =>
            Object.keys(checkpoint.acceptedTasks ?? {}).length > 0
          );
          const currentGraphRecords = groupCheckpoints.filter((checkpoint) =>
            checkpoint.resumeMode === "current-graph" &&
            Object.keys(checkpoint.acceptedTasks ?? {}).length === 0
          );
          if (
            groupCheckpoints.length === 2 && acceptedRecords.length === 1 &&
            currentGraphRecords.length === 1
          ) {
            resumeCheckpoint = acceptedRecords[0];
            durableRestartCheckpoint = currentGraphRecords[0];
            acceptedTasksOnly = true;
          } else {
            notifyPreAdmissionRecoveryOnce(
              "当前工作组存在多轮相互冲突的恢复记录；系统只核对原任务，未提交新任务",
              "error",
            );
            return;
          }
        }
        const existingCheckpoint = resumeCheckpoint ?? groupCheckpoints[0];
        if (existingCheckpoint) {
          if (Object.keys(existingCheckpoint.acceptedTasks ?? {}).length > 0) {
            resumeCheckpoint = existingCheckpoint;
            acceptedTasksOnly = true;
          } else if (existingCheckpoint.resumeMode === "current-graph") {
            resumeCheckpoint = existingCheckpoint;
            acceptedTasksOnly = false;
          } else if (!clearGroupRunCheckpoint(scope, undefined, existingCheckpoint.runId)) {
            notifyPreAdmissionRecoveryOnce(
              "当前工作组的陈旧恢复缓存无法安全释放；本轮未提交生成任务",
              "error",
            );
            return;
          }
        }
      }
      const childIds = new Set(
        candidateNodes
          .filter((node) => node.parentId === groupId)
          .map((node) => node.id),
      );
      let candidateLockIds = new Set([groupId, ...childIds]);
      for (const edge of candidateEdges) {
        if (childIds.has(edge.target)) candidateLockIds.add(edge.source);
      }
      const conflictingNodeId = [...candidateLockIds].find((nodeId) =>
        [...runLocks.current.values()].some((locks) => locks.has(nodeId))
      );
      if (conflictingNodeId) {
        const conflictingNode = candidateNodes.find((node) =>
          node.id === conflictingNodeId
        );
        const conflictRole = conflictingNodeId === groupId
          ? "运行组"
          : childIds.has(conflictingNodeId)
            ? "组内节点"
            : "直接输入";
        notifyPreAdmissionRecoveryOnce(
          `另一轮正在使用${conflictRole}“${workflowNodeTitle(conflictingNode, conflictingNodeId)}”（节点 ${conflictingNodeId}），本轮未提交任何生成任务`,
          "error",
        );
        return;
      }
      startingGroupIds.current.add(groupId);
      const runId = resumeCheckpoint?.runId ?? crypto.randomUUID();
      startingGroups.current.set(groupId, { cancelled: false, runId });
      runLocks.current.set(runId, candidateLockIds);
      markGroupRunStarting(scope, groupId, runId);
      // The preparation phase is active too: this drives beforeunload and
      // keeps the task-panel stop action usable while nodes are mounting.
      publishActiveRunState();
      const runSequence = nextGroupRunSequence();
      let checkpoint: GroupRunCheckpoint | undefined;
      let restartCheckpoint: GroupRunCheckpoint | undefined;
      let stableCanvasRevision: number | undefined;
      const abortController = new AbortController();
      let leaseAcquired = false;
      let leaseTimer: number | undefined;
      let leaseRenewInFlight: Promise<boolean> | undefined;
      let summaryBaseForError: (() => Omit<GroupRunSummary, "status">) | undefined;
      const ownerId = getGroupRunExecutionOwnerId();
      let terminalErrorPublished = false;
      const notifyRecoveryOnce = (
        nodeId: string,
        errorClass: string,
        message: string,
        kind: "error" | "info" = "info",
      ) => {
        if (kind === "error") {
          if (terminalErrorPublished) return;
          terminalErrorPublished = true;
        }
        const phase = kind === "error" ? "terminal" : "recovering";
        if (publishGroupRunNotificationOnce(publishedRunNotifications.current, {
          accountId,
          canvasId,
          errorClass,
          groupId,
          nodeId,
          runId,
        }, phase)) notify(message, kind);
      };
      const notifyTerminalErrorOnce = (
        errorClass: string,
        message: string,
        nodeId = groupId,
      ) => notifyRecoveryOnce(nodeId, errorClass, message, "error");
      const isStartingCancelled = () =>
        startingGroups.current.get(groupId)?.cancelled === true;
      const expectedLease = () => ({ ownerId, runId });
      const refreshRunLocks = (
        candidateNodes: readonly ProbeNodeType[],
        candidateEdges: readonly CuttableEdge[],
      ) => {
        const childIds = new Set(
          candidateNodes
            .filter((node) => node.parentId === groupId)
            .map((node) => node.id),
        );
        const retainedNodeIds = new Set([groupId, ...childIds]);
        for (const edge of candidateEdges) {
          if (childIds.has(edge.target)) retainedNodeIds.add(edge.source);
        }
        runLocks.current.set(runId, retainedNodeIds);
        publishActiveRunState();
      };
      try {
        // Freeze edits at the click boundary, before save/lease/registration
        // awaits. Direct external sources are part of the input snapshot too.
        refreshRunLocks(getNodes(), getEdges());
        try {
          stableCanvasRevision = await waitForCanvasStable(
            groupId,
            isStartingCancelled,
          );
        } catch (error) {
          notifyRecoveryOnce(
            groupId,
            "canvas-save-wait",
            error instanceof Error
              ? error.message
              : "画布内容还在保存，稍后会继续，请稍候",
          );
          return;
        }
        if (isStartingCancelled()) return;
        if (!Number.isSafeInteger(stableCanvasRevision)) return;
        let nodes = getNodes();
        let edges = getEdges();
        let children = nodes.filter((node) => node.parentId === groupId);
        const stableChildIds = new Set(children.map((node) => node.id));
        const stableLockIds = new Set([groupId, ...stableChildIds]);
        for (const edge of edges) {
          if (stableChildIds.has(edge.target)) stableLockIds.add(edge.source);
        }
        const stableConflictNodeId = [...stableLockIds].find((nodeId) =>
          [...runLocks.current.entries()].some(([otherRunId, locks]) =>
            otherRunId !== runId && locks.has(nodeId)
          )
        );
        if (stableConflictNodeId) {
          notifyTerminalErrorOnce(
            "stable-lock-conflict",
            "画布保存期间参与整组执行的节点发生变化；本轮未提交生成任务",
            stableConflictNodeId,
          );
          return;
        }
        candidateLockIds = stableLockIds;
        runLocks.current.set(runId, candidateLockIds);
        publishActiveRunState();
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const incomingTextTargets = new Set<string>();
        for (const edge of edges) {
          if (nodeById.get(edge.source)?.type === "text") {
            incomingTextTargets.add(edge.target);
          }
        }
        let executableIds = new Set(
          children
            .filter((node) => isExecutableWorkflowNode(node, {
              hasIncomingText: incomingTextTargets.has(node.id),
            }))
            .map((node) => node.id),
        );
        const resumeInFlightNodeIds = new Set(
          resumeCheckpoint
            ? [
                ...Object.entries(resumeCheckpoint.nodeStates)
                  .filter(([, state]) => state === "running")
                  .map(([nodeId]) => nodeId),
                ...(resumeCheckpoint.projectionPendingNodeIds ?? []),
              ]
            : [],
        );
        if (executableIds.size === 0) {
          notify("组内没有可执行的生成节点");
          return;
        }
        if (children.some((node) =>
          isWorkflowNodeGenerating(node) && !resumeInFlightNodeIds.has(node.id)
        )) {
          notify("组内有节点正在生成，请等待完成后再试");
          return;
        }
        try {
          // Only executable nodes can submit work. A note/upload/reference
          // cycle must not block an otherwise valid generation subgraph.
          buildWorkflowLayers(
            children.filter((node) => executableIds.has(node.id)),
            edges,
          );
        } catch (error) {
          notify(error instanceof Error ? error.message : "整组执行失败");
          return;
        }

        const modelConfigurationRevisions = Object.fromEntries(
          Object.entries(executorModelCatalog.models).flatMap(([kind, models]) =>
            (models ?? []).flatMap((model) =>
              model.configurationRevision
                ? [[`${kind}:${model.id}`, model.configurationRevision]]
                : [],
            )
          ),
        );
        const modelReleaseRevisions = Object.fromEntries(
          Object.entries(executorModelCatalog.models).flatMap(([kind, models]) =>
            (models ?? []).flatMap((model) =>
              model.releaseRevisionId
                ? [[`${kind}:${model.id}`, model.releaseRevisionId]]
                : [],
            )
          ),
        );
        const snapshotFingerprint = groupRunSnapshotFingerprint({
          edges,
          executableNodeIds: executableIds,
          groupId,
          modelConfigurationRevisions,
          modelReleaseRevisions,
          nodes,
        });
        let initialSuccessNodeIds = new Set<string>();
        let resumeSnapshotMatches = true;
        if (resumeCheckpoint) {
          const expectedIds = [...resumeCheckpoint.executableNodeIds].sort();
          const actualIds = [...executableIds].sort();
          if (
            resumeCheckpoint.accountId !== accountId ||
            resumeCheckpoint.canvasId !== canvasId ||
            resumeCheckpoint.fixtureScopeId !== fixtureScopeId ||
            resumeCheckpoint.groupId !== groupId
          ) {
            notifyTerminalErrorOnce(
              "resume-scope-mismatch",
              "恢复记录不属于当前工作组；本轮未提交生成任务",
            );
            return;
          }
          resumeSnapshotMatches =
            resumeCheckpoint.snapshotFingerprint === snapshotFingerprint &&
            JSON.stringify(expectedIds) === JSON.stringify(actualIds);
          const verification = verifiedCheckpointSuccessIds(
            resumeCheckpoint,
            nodes,
            modelConfigurationRevisions,
          );
          if (verification.mismatchNodeId && resumeSnapshotMatches) {
            notifyTerminalErrorOnce(
              "resume-proof-mismatch",
              "上一轮成功结果的任务凭证与当前画布不一致，已阻止重复生成",
              verification.mismatchNodeId,
            );
            return;
          }
          initialSuccessNodeIds = verification.verified;
          for (const nodeId of resumeCheckpoint.projectionPendingNodeIds ?? []) {
            initialSuccessNodeIds.delete(nodeId);
          }
        }

        if (isStartingCancelled()) return;
        leaseAcquired = await runExclusiveCanvasSubmit(canvasId, () =>
          acquireGroupRunLease(
            scope,
            runId,
            ownerId,
            Date.now(),
            [...candidateLockIds],
            async () => {
              const tasks = await listGenerationTasks(
                canvasId,
                undefined,
                scope.fixtureScopeId,
              );
              if (recoveryAuthorityTaskIds && tasks.some((task) =>
                candidateLockIds.has(task.nodeId) &&
                !recoveryAuthorityTaskIds?.has(task.id)
              )) {
                return false;
              }
              const admissionRevision = await waitForCanvasRevision(30_000);
              const authoritativeRevision =
                await readAuthoritativeCanvasRevision();
              const admissionNodes = getNodes();
              const admissionEdges = getEdges();
              const admissionChildren = admissionNodes.filter((node) =>
                node.parentId === groupId
              );
              const admissionChildIds = new Set(
                admissionChildren.map((node) => node.id),
              );
              const admissionLockIds = new Set([groupId, ...admissionChildIds]);
              for (const edge of admissionEdges) {
                if (admissionChildIds.has(edge.target)) {
                  admissionLockIds.add(edge.source);
                }
              }
              const admissionNodeById = new Map(
                admissionNodes.map((node) => [node.id, node]),
              );
              const admissionTextTargets = new Set<string>();
              for (const edge of admissionEdges) {
                if (admissionNodeById.get(edge.source)?.type === "text") {
                  admissionTextTargets.add(edge.target);
                }
              }
              const admissionExecutableIds = new Set(
                admissionChildren
                  .filter((node) => isExecutableWorkflowNode(node, {
                    hasIncomingText: admissionTextTargets.has(node.id),
                  }))
                  .map((node) => node.id),
              );
              const admissionFingerprint = groupRunSnapshotFingerprint({
                edges: admissionEdges,
                executableNodeIds: admissionExecutableIds,
                groupId,
                modelConfigurationRevisions,
                modelReleaseRevisions,
                nodes: admissionNodes,
              });
              if (
                admissionRevision !== stableCanvasRevision ||
                authoritativeRevision !== stableCanvasRevision ||
                admissionFingerprint !== snapshotFingerprint ||
                [...admissionExecutableIds].sort().join("\u0000") !==
                  [...executableIds].sort().join("\u0000") ||
                [...admissionLockIds].sort().join("\u0000") !==
                  [...candidateLockIds].sort().join("\u0000")
              ) return false;
              nodes = admissionNodes;
              edges = admissionEdges;
              children = admissionChildren;
              executableIds = admissionExecutableIds;
              candidateLockIds = admissionLockIds;
              return !tasks.some((task) =>
                ["queued", "running", "retrying", "recovering"].includes(
                  task.state,
                ) &&
                candidateLockIds.has(task.nodeId) &&
                !(acceptedTasksOnly && taskMatchesAcceptedBinding(
                  resumeCheckpoint?.acceptedTasks?.[task.nodeId],
                  task,
                )) &&
                !taskBelongsToWorkflowRun(
                  nodes.find((node) => node.id === task.nodeId),
                  task,
                  runId,
                )
              );
            },
          )
        );
        if (!leaseAcquired) {
          notifyTerminalErrorOnce(
            "lease-admission-blocked",
            "locks" in window.navigator
              ? "当前画布已在其他标签页执行，请等待完成后再继续"
              : "当前浏览器不支持安全的跨标签整组执行，本轮已阻止",
          );
          return;
        }
        // Start renewing immediately; registration waits and static preflight
        // are part of the lease too, not a gap before `running` is published.
        leaseTimer = window.setInterval(() => {
          if (leaseRenewInFlight) return;
          const renewal = renewGroupRunLease(scope, runId, ownerId);
          leaseRenewInFlight = renewal;
          void renewal.then((renewed) => {
            if (renewed) return;
            const current = runningGroups.current.get(groupId);
            const starting = startingGroups.current.get(groupId);
            if (
              current?.runId !== runId &&
              starting?.runId !== runId
            ) return;
            if (current?.cancelled || starting?.cancelled) return;
            if (current) {
              current.leaseLost = true;
              current.cancelled = true;
              current.abortController.abort("lease-lost");
              current.publishStopping();
            }
            if (starting) starting.cancelled = true;
            notifyTerminalErrorOnce(
              "lease-lost",
              "执行租约已失效，已阻止后续节点；系统会继续核对已提交任务",
            );
          }).finally(() => {
            if (leaseRenewInFlight === renewal) leaseRenewInFlight = undefined;
          });
        }, groupRunLeaseHeartbeatMs);

        refreshRunLocks(nodes, edges);
        const remainingIds = new Set(
          [...executableIds].filter((id) => !initialSuccessNodeIds.has(id)),
        );
        if (isStartingCancelled()) return;

        const createExecutorContext = (
          isCancelled: () => boolean,
          options: {
            acceptedTask?: AcceptedTaskBinding;
            onTaskAccepted?: NodeExecutorContext["onTaskAccepted"];
          } = {},
        ): NodeExecutorContext => ({
          acceptedTask: options.acceptedTask,
          accountId,
          canvasId,
          fixtureScopeId,
          groupId,
          graph,
          isCancelled,
          isFixture,
          modelCatalog: executorModelCatalog,
          runId,
          save,
          signal: abortController.signal,
          onTaskAccepted: options.onTaskAccepted,
        });

        const startedAt = resumeCheckpoint?.startedAt ?? Date.now();
        const nodeStates = new Map<string, WorkflowGraphNodeState>(
          [...initialSuccessNodeIds].map((nodeId) => [nodeId, "success"]),
        );
        checkpoint = {
          acceptedTasks: resumeCheckpoint?.acceptedTasks ?? {},
          accountId,
          canvasId,
          executableNodeIds: [...executableIds],
          fixtureScopeId,
          groupId,
          nodeStates: Object.fromEntries(nodeStates),
          projectionPendingNodeIds:
            resumeCheckpoint?.projectionPendingNodeIds ?? [],
          runId,
          snapshotFingerprint,
          startedAt,
          status: "preparing",
          successProofs: resumeCheckpoint?.successProofs ?? {},
          lease: readGroupRunLease(scope, runId),
          updatedAt: Date.now(),
          version: 2,
        };
        if (!writeGroupRunCheckpoint(checkpoint, expectedLease())) {
          notify("浏览器无法保存整组进度，为避免刷新后重复生成，本轮已阻止", "error");
          return;
        }
        const directProjectionReceipts: GroupResultProjectionResult[] = [];
        const recordDirectProjectionReceipt = (
          nodeId: string,
          result: NodeRunResult | undefined,
        ) => {
          if (
            result?.status !== "success" ||
            result.projectionState !== "applied" ||
            !result.projection
          ) return;
          directProjectionReceipts.push({
            applicationId: result.projection.applicationId,
            attempts: 1,
            nodeId,
            status: "applied",
          });
        };

        const summaryBase = (): Omit<GroupRunSummary, "status"> => ({
          accountId,
          activeCount: workflowStateCount(nodeStates, "running"),
          blockedCount: workflowStateCount(nodeStates, "blocked") +
            workflowStateCount(nodeStates, "pending"),
          blockedNodeIds: [...nodeStates.entries()]
            .filter(([, state]) => state === "blocked" || state === "pending")
            .map(([nodeId]) => nodeId),
          canvasId,
          completedAt: Date.now(),
          completedCount: [...nodeStates.values()].filter((state) =>
            ["blocked", "failed", "skipped", "success"].includes(state)
          ).length,
          elapsedMs: Date.now() - startedAt,
          failedCount: workflowStateCount(nodeStates, "failed"),
          failedNodeIds: [...nodeStates.entries()]
            .filter(([, state]) => state === "failed")
            .map(([nodeId]) => nodeId),
          fixtureScopeId,
          groupId,
          nodeCount: executableIds.size,
          runId,
          runSequence,
          skippedCount: workflowStateCount(nodeStates, "skipped"),
          skippedNodeIds: [...nodeStates.entries()]
            .filter(([, state]) => state === "skipped")
            .map(([nodeId]) => nodeId),
          startedAt,
          successCount: workflowStateCount(nodeStates, "success"),
        });
        summaryBaseForError = summaryBase;
        publishGroupRunSummary({ ...summaryBase(), status: "preparing" });

        if (acceptedTasksOnly) {
          const accepted = Object.values(checkpoint.acceptedTasks ?? {});
          if (accepted.length === 0) {
            if (resumeSnapshotMatches) {
              notifyRecoveryOnce(
                groupId,
                "pending-auto-continue",
                "正在自动继续上一轮尚未提交的节点",
              );
            }
          }
          for (const nodeId of executableIds) {
            if (!nodeStates.has(nodeId)) {
              nodeStates.set(nodeId, resumeCheckpoint?.nodeStates[nodeId] ?? "pending");
            }
          }
          checkpoint = {
            ...checkpoint,
            nodeStates: Object.fromEntries(nodeStates),
            status: "running",
            updatedAt: Date.now(),
          };
          if (!writeGroupRunCheckpoint(checkpoint, expectedLease())) {
            notify("自动核对进度无法保存；本次未提交任何新任务", "error");
            return;
          }
          const running = {
            activeNodeIds: new Set<string>(),
            abortController,
            cancelled: false,
            checkpoint,
            checkpointWriteFailed: false,
            leaseLost: false,
            navigationStopped: false,
            ownerId,
            publishStopping: () => publishGroupRunSummary({
              ...summaryBase(),
              status: "stopping",
            }),
            runId,
          };
          runningGroups.current.set(groupId, running);
          startingGroupIds.current.delete(groupId);
          startingGroups.current.delete(groupId);
          clearGroupRunStarting(scope, runId);
          publishActiveRunState();
          publishGroupRunSummary({ ...summaryBase(), status: "running" });

          for (const binding of accepted) {
            if (running.cancelled || abortController.signal.aborted) break;
            const durableProof = groupRunSuccessProof(
              getNodes().find((candidate) => candidate.id === binding.nodeId),
            );
            const expectedProof = running.checkpoint.successProofs[binding.nodeId];
            if (
              !running.checkpoint.projectionPendingNodeIds?.includes(binding.nodeId) &&
              nodeStates.get(binding.nodeId) === "success" &&
              durableProof?.taskId === expectedProof?.taskId &&
              durableProof?.ownershipKey === expectedProof?.ownershipKey &&
              durableProof?.resultKey === expectedProof?.resultKey
            ) continue;
            const node = getNodes().find((candidate) => candidate.id === binding.nodeId);
            const executor = registry.get(node);
            if (!executor || executor.kind !== binding.kind) {
              nodeStates.set(binding.nodeId, "failed");
            } else {
              running.activeNodeIds.add(binding.nodeId);
              nodeStates.set(binding.nodeId, "running");
              try {
                const result = await runGroupNodeWithPersist({
                  isCancelled: () => running.cancelled,
                  persist: () => persistGroupCanvasAfterNode({ save }),
                  project: (projection) => {
                    void enqueueGroupResultProjection(projection, {
                      signal: abortController.signal,
                    });
                  },
                  run: () => executor.recover(
                    binding.nodeId,
                    createExecutorContext(
                      () => running.cancelled,
                      { acceptedTask: binding },
                    ),
                  ),
                });
                recordDirectProjectionReceipt(binding.nodeId, result);
                if (result.status === "success") {
                  nodeStates.set(binding.nodeId, "success");
                  if (result.successProof) {
                    running.checkpoint.successProofs[binding.nodeId] =
                      result.successProof;
                  } else {
                    nodeStates.set(binding.nodeId, "failed");
                  }
                } else {
                  nodeStates.set(binding.nodeId, result.status === "skipped"
                    ? "skipped"
                    : "failed");
                }
              } catch (error) {
                if (!abortController.signal.aborted) {
                  nodeStates.set(binding.nodeId, "failed");
                  notifyRecoveryOnce(
                    binding.nodeId,
                    "accepted-task-reconcile",
                    error instanceof Error ? error.message : "自动核对任务失败",
                    "error",
                  );
                }
              } finally {
                running.activeNodeIds.delete(binding.nodeId);
              }
            }
            running.checkpoint = {
              ...running.checkpoint,
              nodeStates: Object.fromEntries(nodeStates),
              status: "running",
              updatedAt: Date.now(),
            };
            checkpoint = running.checkpoint;
            if (!writeGroupRunCheckpoint(running.checkpoint, expectedLease())) {
              running.cancelled = true;
              running.checkpointWriteFailed = true;
              break;
            }
          }

          const verification = verifiedCheckpointSuccessIds(
            running.checkpoint,
            getNodes(),
            modelConfigurationRevisions,
          );
          const projectionResults = [
            ...directProjectionReceipts,
            ...await waitForGroupResultProjections(runId),
          ];
          const projectionPendingNodeIds = unresolvedProjectionNodeIds(
            running.checkpoint.projectionPendingNodeIds ?? [],
            projectionResults,
          );
          running.checkpoint = {
            ...running.checkpoint,
            projectionPendingNodeIds,
          };
          const projectionsSettled = projectionPendingNodeIds.length === 0;
          const complete = !running.cancelled && projectionsSettled &&
            !verification.mismatchNodeId &&
            [...executableIds].every((nodeId) =>
              nodeStates.get(nodeId) === "success" &&
              verification.verified.has(nodeId)
            );
          if (complete && clearGroupRunCheckpoint(scope, expectedLease())) {
            publishGroupRunSummary({ ...summaryBase(), status: "success" });
            return;
          }
          if (!resumeSnapshotMatches) {
            const acceptedSettled = accepted.every((binding) =>
              nodeStates.get(binding.nodeId) === "success"
            );
            if (!acceptedSettled || running.cancelled || !projectionsSettled) {
              running.checkpoint = {
                ...running.checkpoint,
                nodeStates: Object.fromEntries(nodeStates),
                projectionPendingNodeIds,
                status: "interrupted",
                updatedAt: Date.now(),
              };
              checkpoint = running.checkpoint;
              writeGroupRunCheckpoint(running.checkpoint, expectedLease());
              notifyRecoveryOnce(
                groupId,
                "snapshot-changed-reconcile",
                "画布已变化；系统继续核对原任务，确认安全前不会提交当前图的新任务",
              );
              return;
            }
            const reusableSuccessIds = [...verification.verified]
              .filter((nodeId) => {
                if (!executableIds.has(nodeId)) return false;
                const node = getNodes().find((candidate) => candidate.id === nodeId);
                if (!node || !["audio", "image", "text", "video"].includes(node.type)) {
                  return false;
                }
                const proof = running.checkpoint.successProofs[nodeId];
                const current = currentWorkflowGenerationBinding({
                  context: {
                    canvasId,
                    graph,
                    isFixture,
                    modelCatalog: executorModelCatalog,
                  },
                  kind: node.type as AcceptedTaskBinding["kind"],
                  nodeId,
                });
                return Boolean(
                  proof?.inputFingerprint && proof.modelReleaseRevision && current &&
                  proof.inputFingerprint === current.inputFingerprint &&
                  proof.modelReleaseRevision === current.modelReleaseRevision &&
                  proof.ownershipKey === current.ownershipKey,
                );
              });
            const reusableSuccessProofs = Object.fromEntries(
              reusableSuccessIds.flatMap((nodeId) => {
                const proof = running.checkpoint.successProofs[nodeId];
                return proof ? [[nodeId, proof]] : [];
              }),
            );
            if (durableRestartCheckpoint && (
              durableRestartCheckpoint.accountId !== accountId ||
              durableRestartCheckpoint.canvasId !== canvasId ||
              durableRestartCheckpoint.fixtureScopeId !== fixtureScopeId ||
              durableRestartCheckpoint.groupId !== groupId ||
              durableRestartCheckpoint.snapshotFingerprint !== snapshotFingerprint ||
              JSON.stringify([...durableRestartCheckpoint.executableNodeIds].sort()) !==
                JSON.stringify([...executableIds].sort())
            )) {
              notifyTerminalErrorOnce(
                "snapshot-restart-conflict",
                "当前图续作记录与已保存画布不一致；系统仅保留原任务结果，未提交新任务",
              );
              return;
            }
            const pendingRestartCheckpoint: GroupRunCheckpoint =
              durableRestartCheckpoint ?? {
                accountId,
                canvasId,
                executableNodeIds: [...executableIds],
                fixtureScopeId,
                groupId,
                nodeStates: Object.fromEntries(
                  reusableSuccessIds.map((nodeId) => [nodeId, "success" as const]),
                ),
                resumeMode: "current-graph",
                runId: crypto.randomUUID(),
                snapshotFingerprint,
                startedAt: Date.now(),
                status: "preparing",
                successProofs: reusableSuccessProofs,
                updatedAt: Date.now(),
                version: 2,
              };
            if (!writeGroupRunCheckpoint(pendingRestartCheckpoint)) {
              notifyTerminalErrorOnce(
                "snapshot-restart-write",
                "旧运行已完成核对，但当前图续作记录无法安全保存；未提交新任务",
              );
              return;
            }
            if (!clearGroupRunCheckpoint(scope, expectedLease())) {
              notifyTerminalErrorOnce(
                "snapshot-old-clear",
                "旧运行已完成核对，但恢复缓存无法精确关闭；当前图未提交新任务",
              );
              return;
            }
            restartCheckpoint = pendingRestartCheckpoint;
            notifyRecoveryOnce(
              groupId,
              "snapshot-changed-restart",
              "上一轮原任务已恢复；画布有变化，正在按当前图自动继续",
            );
            return;
          }

          initialSuccessNodeIds = verification.verified;
          for (const nodeId of projectionPendingNodeIds) {
            initialSuccessNodeIds.delete(nodeId);
          }
          for (const binding of accepted) {
            resumeInFlightNodeIds.add(binding.nodeId);
          }
          for (const nodeId of initialSuccessNodeIds) remainingIds.delete(nodeId);
          runningGroups.current.delete(groupId);
          checkpoint = {
            ...running.checkpoint,
            nodeStates: Object.fromEntries(nodeStates),
            projectionPendingNodeIds,
            status: "preparing",
            updatedAt: Date.now(),
          };
          if (!writeGroupRunCheckpoint(checkpoint, expectedLease())) {
            notifyTerminalErrorOnce(
              "pending-auto-continue-checkpoint",
              "自动续作状态无法保存；本次未提交新的生成任务",
            );
            return;
          } else {
            notifyRecoveryOnce(
              groupId,
              "pending-auto-continue",
              "上一轮原任务已恢复，正在自动继续未完成节点",
            );
          }
        }

        const preflightFailures: Array<{
          errorCode?: string;
          message: string;
          nodeId: string;
        }> = [];
        for (const nodeId of remainingIds) {
          if (isStartingCancelled()) {
            checkpoint = {
              ...checkpoint,
              status: "interrupted",
              updatedAt: Date.now(),
            };
            writeGroupRunCheckpoint(checkpoint, expectedLease());
            notify("已停止整组准备，不会再提交后续生成任务");
            return;
          }
          const executor = registry.get(nodeById.get(nodeId));
          if (!executor) {
            preflightFailures.push({ message: "节点执行器不可用", nodeId });
            continue;
          }
          const result = await executor.preflight(
            nodeId,
            createExecutorContext(isStartingCancelled),
            executableIds,
            "static",
          );
          if (isStartingCancelled()) {
            checkpoint = {
              ...checkpoint,
              status: "interrupted",
              updatedAt: Date.now(),
            };
            writeGroupRunCheckpoint(checkpoint, expectedLease());
            notify("已停止整组准备，不会再提交后续生成任务");
            return;
          }
          if (result.status !== "success") {
            preflightFailures.push({
              errorCode: result.errorCode,
              message: result.message ?? "请检查标红节点",
              nodeId,
            });
          }
        }
        if (preflightFailures.length > 0) {
          const first = preflightFailures[0];
          const firstNode = nodeById.get(first.nodeId);
          const firstTitle = workflowNodeTitle(firstNode, first.nodeId);
          publishGroupRunSummary({
            ...summaryBase(),
            blockedCount: executableIds.size -
              initialSuccessNodeIds.size - preflightFailures.length,
            blockedNodeIds: [...remainingIds].filter((nodeId) =>
              !preflightFailures.some((failure) => failure.nodeId === nodeId)
            ),
            errorCode: first.errorCode ?? workflowNodeErrorCode(firstNode),
            failedCount: preflightFailures.length,
            failedNodeIds: preflightFailures.map((failure) => failure.nodeId),
            firstFailedNodeId: first.nodeId,
            firstFailedNodeTitle: firstTitle,
            reason: first.message,
            status: "failed",
          });
          let terminalMessage =
            `整组执行已阻止：发现 ${preflightFailures.length} 个不兼容节点；首个“${firstTitle}”：${first.message}${resumeCheckpoint ? "（本次未提交新任务）" : "（未提交任何生成任务）"}`;
          if (initialSuccessNodeIds.size === 0) {
            if (!clearGroupRunCheckpoint(scope, expectedLease())) {
              terminalMessage = "准备失败且续跑记录无法清理；请勿重复开始";
            }
          } else {
            checkpoint = { ...checkpoint, status: "interrupted", updatedAt: Date.now() };
            if (!writeGroupRunCheckpoint(checkpoint, expectedLease())) {
              terminalMessage = "准备失败且进度无法保存；请勿重复开始";
            }
          }
          notifyTerminalErrorOnce("static-preflight", terminalMessage, first.nodeId);
          return;
        }

        if (isStartingCancelled()) {
          checkpoint = { ...checkpoint, status: "interrupted", updatedAt: Date.now() };
          writeGroupRunCheckpoint(checkpoint, expectedLease());
          notify("已停止整组准备，不会再提交后续生成任务");
          return;
        }
        checkpoint = { ...checkpoint, status: "running", updatedAt: Date.now() };
        if (!writeGroupRunCheckpoint(checkpoint, expectedLease())) {
          notifyTerminalErrorOnce(
            "run-checkpoint-start",
            "运行状态无法保存，为避免刷新后重复生成，本轮已停止",
          );
          return;
        }
        const running = {
          activeNodeIds: new Set<string>(),
          abortController,
          cancelled: false,
          checkpoint,
          checkpointWriteFailed: false,
          leaseLost: false,
          navigationStopped: false,
          ownerId,
          publishStopping: () => publishGroupRunSummary({
            ...summaryBase(),
            status: "stopping",
          }),
          runId,
        };
        runningGroups.current.set(groupId, running);
        startingGroupIds.current.delete(groupId);
        startingGroups.current.delete(groupId);
        clearGroupRunStarting(scope, runId);
        publishGroupRunSummary({ ...summaryBase(), status: "running" });
        let lastCompleted = initialSuccessNodeIds.size;
        const result = await runWorkflowGraph({
          edges,
          executableIds,
          initialSuccessNodeIds,
          isCancelled: () => running.cancelled,
          onNodeStateChange: (nodeId, state, completed, total, nodeResult) => {
            nodeStates.set(nodeId, state);
            recordDirectProjectionReceipt(nodeId, nodeResult);
            if (state === "success") {
              const candidate = nodeResult?.successProof;
              const proof = candidate?.taskId && candidate.ownershipKey &&
                  candidate.resultKey
                ? candidate
                : groupRunSuccessProof(
                getNodes().find((node) => node.id === nodeId),
              );
              if (proof) running.checkpoint.successProofs[nodeId] = proof;
              else {
                running.cancelled = true;
                notifyTerminalErrorOnce(
                  "success-proof-missing",
                  "节点已返回成功但缺少可持续任务凭证，已阻止后续节点",
                  nodeId,
                );
              }
            }
            const nextCheckpoint = {
              ...running.checkpoint,
              nodeStates: Object.fromEntries(nodeStates),
              status: running.navigationStopped
                ? ("interrupted" as const)
                : running.cancelled
                  ? ("stopping" as const)
                  : ("running" as const),
              updatedAt: Date.now(),
            };
            running.checkpoint = nextCheckpoint;
            checkpoint = nextCheckpoint;
            if (!writeGroupRunCheckpoint(nextCheckpoint, expectedLease())) {
              running.checkpointWriteFailed = true;
              running.cancelled = true;
              notifyTerminalErrorOnce(
                "run-checkpoint-progress",
                "整组进度无法保存，已阻止后续节点；请核对已提交任务",
                nodeId,
              );
            }
            publishGroupRunSummary({
              ...summaryBase(),
              status: running.cancelled ? "stopping" : "running",
            });
            if (
              ["blocked", "failed", "skipped", "success"].includes(state) &&
              completed > lastCompleted
            ) {
              lastCompleted = completed;
              notify(`整组执行中：已完成 ${completed}/${total} 个节点`);
            }
          },
          runNode: async (nodeId) => {
            const node = getNodes().find((candidate) => candidate.id === nodeId);
            const executor = registry.get(node);
            if (!executor) {
              return { message: "节点执行器意外丢失", status: "failed" };
            }
            running.activeNodeIds.add(nodeId);
            try {
              return await runGroupNodeWithPersist({
                isCancelled: () => running.cancelled,
                persist: () => persistGroupCanvasAfterNode({
                  save,
                }),
                project: (projection) => {
                  void enqueueGroupResultProjection(projection, {
                    signal: abortController.signal,
                  });
                },
                run: async () => {
                  if (resumeInFlightNodeIds.has(nodeId)) {
                    return executor.recover(
                      nodeId,
                      createExecutorContext(
                        () => running.cancelled,
                        { acceptedTask: running.checkpoint.acceptedTasks?.[nodeId] },
                      ),
                    );
                  }
                  return runRegisteredNodeWithRefreshRecovery({
                    context: createExecutorContext(
                      () => running.cancelled,
                      {
                        onTaskAccepted: async (binding) => {
                          const current = runningGroups.current.get(groupId);
                          if (current?.runId !== runId) {
                            throw new Error("整组运行已停止，未继续轮询已接收任务");
                          }
                          const nextCheckpoint = {
                            ...current.checkpoint,
                            acceptedTasks: {
                              ...(current.checkpoint.acceptedTasks ?? {}),
                              [binding.nodeId]: binding,
                            },
                            updatedAt: Date.now(),
                          };
                          current.checkpoint = nextCheckpoint;
                          checkpoint = nextCheckpoint;
                          if (!writeGroupRunCheckpoint(nextCheckpoint, expectedLease())) {
                            current.checkpointWriteFailed = true;
                            current.cancelled = true;
                            throw new Error("已接收任务的恢复凭证无法保存，已停止轮询");
                          }
                        },
                      },
                    ),
                    executor,
                    executableIds,
                    isCancelled: () => running.cancelled,
                    nodeId,
                  });
                },
              });
            } finally {
              running.activeNodeIds.delete(nodeId);
            }
          },
        });

        const projectionResults = [
          ...directProjectionReceipts,
          ...await waitForGroupResultProjections(runId),
        ];
        const projectionPendingNodeIds = unresolvedProjectionNodeIds(
          running.checkpoint.projectionPendingNodeIds ?? [],
          projectionResults,
        );
        const projectionIncomplete = projectionPendingNodeIds.length > 0;

        const nodeIdsInStates = (states: WorkflowGraphNodeState[]) =>
          [...nodeStates.entries()]
            .filter(([, state]) => states.includes(state))
            .map(([nodeId]) => nodeId);
        const failedNodeIds = Array.from(new Set([
          ...nodeIdsInStates(["failed"]),
          ...(result.status === "failed" ? result.failedNodeIds : []),
        ]));
        const skippedNodeIds = Array.from(new Set([
          ...nodeIdsInStates(["skipped"]),
          ...(result.status === "skipped" ? result.skippedNodeIds : []),
        ]));
        const blockedNodeIds = Array.from(new Set([
          ...nodeIdsInStates(["blocked", "pending"]),
          ...(result.status === "failed" || result.status === "skipped"
            ? result.blockedNodeIds
            : []),
          ...(result.status === "cancelled" ? result.pendingNodeIds : []),
        ]));
        const firstFailedNodeId = result.status === "failed"
          ? result.firstFailure?.nodeId ?? failedNodeIds[0]
          : failedNodeIds[0];
        const latestNode = firstFailedNodeId
          ? getNodes().find((node) => node.id === firstFailedNodeId)
          : undefined;
        publishGroupRunSummary({
          ...summaryBase(),
          activeCount: 0,
          blockedCount: blockedNodeIds.length,
          blockedNodeIds,
          errorCode: result.status === "failed"
            ? result.firstFailure?.errorCode ?? workflowNodeErrorCode(latestNode)
            : workflowNodeErrorCode(latestNode),
          failedCount: failedNodeIds.length,
          failedNodeIds,
          firstFailedNodeId,
          firstFailedNodeTitle: firstFailedNodeId
            ? workflowNodeTitle(latestNode, firstFailedNodeId)
            : undefined,
          reason: result.status === "failed"
            ? result.firstFailure?.message ?? "请查看失败节点的错误提示"
            : "message" in result ? result.message : undefined,
          skippedCount: skippedNodeIds.length,
          skippedNodeIds,
          status: result.status,
        });
        if (result.status === "success") {
          if (projectionIncomplete) {
            const interrupted = {
              ...running.checkpoint,
              nodeStates: Object.fromEntries(nodeStates),
              projectionPendingNodeIds,
              status: "interrupted" as const,
              updatedAt: Date.now(),
            };
            running.checkpoint = interrupted;
            writeGroupRunCheckpoint(interrupted, expectedLease());
            notify("生成已完成；结果写回正在后台自动恢复，原结果已安全保留", "info");
            publishGroupRunSummary({
              ...summaryBase(),
              reason: "生成已完成，但结果写回遇到语义冲突或已耗尽自动重试",
              status: "success",
            });
          } else if (!clearGroupRunCheckpoint(scope, expectedLease())) {
            const interrupted = {
              ...running.checkpoint,
              nodeStates: Object.fromEntries(nodeStates),
              status: "interrupted" as const,
              updatedAt: Date.now(),
            };
            running.checkpoint = interrupted;
            writeGroupRunCheckpoint(interrupted, expectedLease());
            notifyTerminalErrorOnce(
              "success-checkpoint-clear",
              "整组已完成，但续跑记录无法清理；请勿重复开始",
            );
            publishGroupRunSummary({
              ...summaryBase(),
              reason: "整组已完成，但续跑记录无法安全清理",
              status: "failed",
            });
          } else {
            notify("整组执行完成", "success");
          }
        } else {
          running.checkpoint = {
            ...running.checkpoint,
            nodeStates: Object.fromEntries(nodeStates),
            status: "interrupted" as const,
            updatedAt: Date.now(),
          };
          if (!writeGroupRunCheckpoint(running.checkpoint, expectedLease())) {
            running.checkpointWriteFailed = true;
            notifyTerminalErrorOnce(
              "terminal-checkpoint-write",
              "整组终态无法保存；已阻止后续节点，请核对已提交任务",
            );
          }
          if (result.status === "failed") {
            const blocked = result.blockedNodeIds.length > 0
              ? `；另有 ${result.blockedNodeIds.length} 个后续节点因上游失败未运行`
              : "";
            notifyTerminalErrorOnce(
              "workflow-failed",
              `整组执行部分失败：${result.message ?? "请查看节点错误提示"}${blocked}`,
              firstFailedNodeId,
            );
          } else if (result.status === "skipped") {
            notify(`整组执行已停止：${result.message ?? "有节点未就绪"}`);
          } else {
            notify("已停止后续节点；已经开始的节点均已处理完毕");
          }
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "整组执行失败；请查看生成任务状态";
        if (summaryBaseForError) {
          publishGroupRunSummary({
            ...summaryBaseForError(),
            failedCount: Math.max(1, workflowStateCount(
              checkpoint
                ? new Map(Object.entries(checkpoint.nodeStates))
                : new Map<string, WorkflowGraphNodeState>(),
              "failed",
            )),
            reason: message,
            status: "failed",
          });
        }
        if (checkpoint) {
          const interrupted = {
            ...checkpoint,
            status: "interrupted" as const,
            updatedAt: Date.now(),
          };
          if (!writeGroupRunCheckpoint(interrupted, expectedLease())) {
            notifyTerminalErrorOnce(
              "exception-checkpoint-write",
              "整组异常且终态无法保存；请核对已提交任务后再继续",
            );
          }
        }
        notifyTerminalErrorOnce(
          "workflow-exception",
          `${message}；系统已保留已提交任务并自动核对，受影响分支暂停，其他结果不受影响`,
        );
      } finally {
        abortController.abort("run-finished");
        if (leaseTimer !== undefined) window.clearInterval(leaseTimer);
        if (leaseAcquired) {
          // Publish the cooperative lease-release wake while this local run is
          // still registered. The automatic recovery listener can then tell
          // that the durable checkpoint belongs to the run that is currently
          // settling, instead of immediately re-entering a terminal run.
          releaseGroupRunLease(scope, runId, ownerId);
        }
        if (runningGroups.current.get(groupId)?.runId === runId) {
          runningGroups.current.delete(groupId);
        }
        if (startingGroups.current.get(groupId)?.runId === runId) {
          startingGroupIds.current.delete(groupId);
          startingGroups.current.delete(groupId);
        }
        runLocks.current.delete(runId);
        clearGroupRunStarting(scope, runId);
        publishActiveRunState();
        if (restartCheckpoint) {
          window.setTimeout(() => {
            // This is a freshly persisted current-graph run. The old run's
            // accepted tasks are already settled. Yield one browser task so
            // React commits the recovered terminal node state before the new
            // graph is checked for still-generating nodes.
            void executeGroup(
              (restartCheckpoint as GroupRunCheckpoint).groupId,
              restartCheckpoint as GroupRunCheckpoint,
              false,
            );
          }, 0);
        }
      }
    },
    [
      accountId,
      canvasId,
      fixtureScopeId,
      getEdges,
      getNodes,
      isFixture,
      notify,
      publishActiveRunState,
      waitForCanvasStable,
      readAuthoritativeCanvasRevision,
      executorModelCatalog,
      registry,
    ],
  );
  const executeGroupCurrent = useRef(executeGroup);
  executeGroupCurrent.current = executeGroup;

  useEffect(() => {
    const continuePreviousRun = (event: Event) => {
      const checkpoint = (event as CustomEvent<GroupRunCheckpoint>).detail;
      if (
        !checkpoint ||
        checkpoint.accountId !== accountId ||
        checkpoint.canvasId !== canvasId ||
        checkpoint.fixtureScopeId !== fixtureScopeId
      ) return;
      const hasAcceptedTasks = Object.keys(checkpoint.acceptedTasks ?? {}).length > 0;
      if (!hasAcceptedTasks && checkpoint.resumeMode !== "current-graph") return;
      void executeGroup(checkpoint.groupId, checkpoint, hasAcceptedTasks);
    };
    window.addEventListener(GROUP_RUN_CONTINUE_EVENT, continuePreviousRun);
    return () => window.removeEventListener(
      GROUP_RUN_CONTINUE_EVENT,
      continuePreviousRun,
    );
  }, [accountId, canvasId, executeGroup, fixtureScopeId]);

  useEffect(() => {
    if (isFixture || !persistenceReady || modelCatalogStatus === "loading") return;
    const scope = { accountId, canvasId, fixtureScopeId };
    const scopeKey = JSON.stringify(scope);
    if (automaticRecoveryScopeKey.current === scopeKey) return;
    automaticRecoveryScopeKey.current = scopeKey;
    let disposed = false;
    let reconcileInFlight: Promise<void> | undefined;
    let reconcileRequested = false;
    let awaitingAuthorityWake = false;
    let authorityConfirmedStableEmpty = false;
    setGroupRunAuthoritySettledEmpty(scope, false);
    let authorityRetryTimer: number | undefined;
    const clearAuthorityRetry = () => {
      if (authorityRetryTimer === undefined) return;
      window.clearTimeout(authorityRetryTimer);
      authorityRetryTimer = undefined;
    };
    const scheduleAuthorityRetry = () => {
      if (disposed || authorityRetryTimer !== undefined) return;
      authorityRetryTimer = window.setTimeout(() => {
        authorityRetryTimer = undefined;
        requestReconcile();
      }, 15_000);
    };
    const notifyAutomaticRecoveryOnce = (
      groupId: string,
      runId: string,
    ) => {
      if (publishGroupRunNotificationOnce(publishedRunNotifications.current, {
        accountId,
        canvasId,
        errorClass: "automatic-authority-recovery",
        groupId,
        nodeId: groupId,
        runId,
      }, "recovering")) {
        notifyCurrent.current(
          "系统正在安全核对已接收任务，确认后会自动继续",
          "info",
        );
      }
    };
    const reconcile = async () => {
      // Canvas hydration and model-catalog hydration are asynchronous. Wait for
      // the exact checkpoint graph to be visible. Each wake has a bounded retry
      // window; storage/lease changes can trigger another bounded window.
      for (let attempt = 0; attempt < 40 && !disposed; attempt += 1) {
        const nodeIds = new Set(getLegacyNodes.current().map((node) => node.id));
        const cache = readGroupRunCheckpointCache(scope);
        const leaseCache = readGroupRunLeaseCache(scope);
        const cacheNeedsAuthorityQuarantine =
          cache.corrupted || cache.quarantined ||
          leaseCache.corrupted || leaseCache.quarantined;
        let checkpoints = cache.checkpoints.filter((checkpoint) =>
          (Object.keys(checkpoint.acceptedTasks ?? {}).length > 0 ||
            checkpoint.resumeMode === "current-graph") &&
          nodeIds.has(checkpoint.groupId) &&
          checkpoint.executableNodeIds.every((nodeId) => nodeIds.has(nodeId))
        );
        if (cacheNeedsAuthorityQuarantine ||
          (checkpoints.length === 0 && nodeIds.size > 0)) {
          try {
            const readRecoveryAuthority = async () => {
              const tasks = await listGenerationTasks(
                canvasId,
                undefined,
                scope.fixtureScopeId,
              );
              return reconstructGroupRecoveryDecision({
                nodes: getLegacyNodes.current(),
                scope,
                tasks,
              });
            };
            const reconstructed = cacheNeedsAuthorityQuarantine
              ? await quarantineCorruptGroupRunCacheAfterAuthority(
                scope,
                readRecoveryAuthority,
              )
              : await runWithGroupRunCanvasAdmission(
                canvasId,
                readRecoveryAuthority,
              );
            if (!reconstructed) {
              awaitingAuthorityWake = true;
              const checkpoint = checkpoints[0];
              notifyAutomaticRecoveryOnce(
                checkpoint?.groupId ?? "canvas-recovery",
                checkpoint?.runId ?? `automatic-recovery:${scopeKey}`,
              );
              await new Promise((resolve) => window.setTimeout(resolve, 250));
              continue;
            }
            awaitingAuthorityWake = false;
            reconcileRequested = false;
            const blockedGroupIds = new Set(reconstructed.blockedGroupIds);
            let writeFailed = false;
            for (const checkpoint of reconstructed.checkpoints) {
              if (blockedGroupIds.has(checkpoint.groupId)) continue;
              if (!writeGroupRunCheckpoint(checkpoint)) {
                awaitingAuthorityWake = true;
                notifyAutomaticRecoveryOnce(
                  checkpoint.groupId,
                  checkpoint.runId,
                );
                writeFailed = true;
                break;
              }
            }
            if (writeFailed) {
              await new Promise((resolve) => window.setTimeout(resolve, 250));
              continue;
            }
            const currentNodeIds = new Set(
              getLegacyNodes.current().map((node) => node.id),
            );
            checkpoints = reconstructed.checkpoints.filter((checkpoint) =>
              !blockedGroupIds.has(checkpoint.groupId) &&
              (Object.keys(checkpoint.acceptedTasks ?? {}).length > 0 ||
                checkpoint.resumeMode === "current-graph") &&
              currentNodeIds.has(checkpoint.groupId) &&
              checkpoint.executableNodeIds.every((nodeId) =>
                currentNodeIds.has(nodeId)
              )
            );
            if (checkpoints.length === 0) {
              if (blockedGroupIds.size > 0) {
                awaitingAuthorityWake = true;
                notifyAutomaticRecoveryOnce(
                  blockedGroupIds.values().next().value ?? "canvas-recovery",
                  `automatic-recovery:${scopeKey}`,
                );
                scheduleAuthorityRetry();
              } else {
                authorityConfirmedStableEmpty = true;
                setGroupRunAuthoritySettledEmpty(scope, true);
                clearAuthorityRetry();
              }
              return;
            }
          } catch {
            // Server authority unavailable: do not infer that no task exists and
            // never open a new submission path from browser cache alone.
            awaitingAuthorityWake = true;
            const checkpoint = checkpoints[0];
            notifyAutomaticRecoveryOnce(
              checkpoint?.groupId ?? "canvas-recovery",
              checkpoint?.runId ?? `automatic-recovery:${scopeKey}`,
            );
            await new Promise((resolve) => window.setTimeout(resolve, 250));
            continue;
          }
        }
        if (checkpoints.length > 0) {
          authorityConfirmedStableEmpty = false;
          setGroupRunAuthoritySettledEmpty(scope, false);
          clearAuthorityRetry();
          awaitingAuthorityWake = false;
          reconcileRequested = false;
          const groups = new Map<string, GroupRunCheckpoint[]>();
          for (const checkpoint of checkpoints) {
            const group = groups.get(checkpoint.groupId) ?? [];
            group.push(checkpoint);
            groups.set(checkpoint.groupId, group);
          }
          for (const [groupId, groupCheckpoints] of groups) {
            if (disposed) return;
            if (groupCheckpoints.length === 1) {
              const checkpoint = groupCheckpoints[0];
              await executeGroupCurrent.current(
                groupId,
                checkpoint,
                Object.keys(checkpoint.acceptedTasks ?? {}).length > 0,
              );
            } else {
              await executeGroupCurrent.current(groupId);
            }
          }
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (awaitingAuthorityWake) scheduleAuthorityRetry();
    };
    const requestReconcile = (): void => {
      if (disposed) return;
      if (reconcileInFlight) {
        reconcileRequested = true;
        return;
      }
      reconcileInFlight = reconcile().finally(() => {
        reconcileInFlight = undefined;
        if (disposed || !reconcileRequested) return;
        reconcileRequested = false;
        requestReconcile();
      });
    };
    const wakeRecovery = (event?: Event) => {
      // Same-window lease events are cooperative lock wakes, not a signal to
      // restart every durable terminal checkpoint. Cross-tab checkpoint/lease
      // changes arrive through `storage`; a local lease release only matters
      // when authority reconciliation was already waiting on that lock.
      const cache = readGroupRunCheckpointCache(scope);
      const leaseCache = readGroupRunLeaseCache(scope);
      if (
        event?.type === GROUP_RUN_LEASE_EVENT && !awaitingAuthorityWake &&
        !leaseCache.corrupted && !leaseCache.quarantined
      ) return;
      const durableWorkAppeared = cache.checkpoints.some((checkpoint) =>
        !runningGroups.current.has(checkpoint.groupId) &&
        !startingGroupIds.current.has(checkpoint.groupId) &&
        (Object.keys(checkpoint.acceptedTasks ?? {}).length > 0 ||
          checkpoint.resumeMode === "current-graph")
      );
      if (
        awaitingAuthorityWake || cache.corrupted || leaseCache.corrupted ||
        durableWorkAppeared ||
        ((cache.quarantined || leaseCache.quarantined) &&
          !authorityConfirmedStableEmpty)
      ) {
        authorityConfirmedStableEmpty = false;
        setGroupRunAuthoritySettledEmpty(scope, false);
        requestReconcile();
      }
    };
    window.addEventListener("storage", wakeRecovery);
    window.addEventListener(GROUP_RUN_LEASE_EVENT, wakeRecovery);
    requestReconcile();
    return () => {
      disposed = true;
      setGroupRunAuthoritySettledEmpty(scope, false);
      clearAuthorityRetry();
      window.removeEventListener("storage", wakeRecovery);
      window.removeEventListener(GROUP_RUN_LEASE_EVENT, wakeRecovery);
      if (automaticRecoveryScopeKey.current === scopeKey) {
        automaticRecoveryScopeKey.current = undefined;
      }
    };
  }, [
    accountId,
    canvasId,
    fixtureScopeId,
    isFixture,
    modelCatalogStatus,
    persistenceReady,
  ]);

  useEffect(() => {
    if (isFixture || !persistenceReady || modelCatalogStatus === "loading") return;
    const scope = { accountId, canvasId, fixtureScopeId };
    if (!hasLegacyGenerationBindings) return;
    const scopeKey = JSON.stringify(scope);
    const runToken = ++legacyReconciliationRunToken.current;
    const scopeIsCurrent = () =>
      legacyReconciliationRunToken.current === runToken;
    const controller = new AbortController();
    let recheckTimer: number | undefined;
    let nextRecheckDelayMs: number | undefined;
    const requestRecheck = (delayMs: number) => {
      nextRecheckDelayMs = nextRecheckDelayMs === undefined
        ? delayMs
        : Math.min(nextRecheckDelayMs, delayMs);
    };
    const armRecheck = () => {
      if (!scopeIsCurrent() || nextRecheckDelayMs === undefined) return;
      const delayMs = nextRecheckDelayMs;
      nextRecheckDelayMs = undefined;
      recheckTimer = window.setTimeout(() => {
        recheckTimer = undefined;
        if (scopeIsCurrent()) void run();
      }, delayMs);
    };
    const boundedUnknownRecheck = (key: string) => {
      const attempts = (legacyRecheckAttempts.current.get(key) ?? 0) + 1;
      legacyRecheckAttempts.current.set(key, attempts);
      const delay = [1_000, 2_000, 4_000][attempts - 1];
      if (delay !== undefined) requestRecheck(delay);
    };
    const exactCheckpointOwns = (
      candidate: LegacyTerminalGenerationCandidate,
    ) => {
      const checkpoint = readGroupRunCheckpoints(scope).find(
        (item) => item.runId === candidate.runId,
      );
      const binding = checkpoint?.acceptedTasks?.[candidate.nodeId];
      return Boolean(
        checkpoint && binding && binding.kind === candidate.kind &&
        binding.nodeId === candidate.nodeId && binding.taskId === candidate.taskId &&
        binding.ownershipKey === candidate.ownershipKey,
      );
    };
    const activeLeaseOwns = (candidate: LegacyTerminalGenerationCandidate) =>
      isGroupRunLeaseActive(readGroupRunLease(scope, candidate.runId));
    const run = async () => {
      if (!scopeIsCurrent()) return;
      const nodes = nodesSnapshot;
      for (const node of nodes) {
        if (isIncompleteLegacyTerminalGenerationBinding(node)) {
          setLegacyGenerationState(node.id, "UNKNOWN_BLOCKED");
        }
      }
      const candidates = nodes.flatMap((node) => {
        const candidate = legacyTerminalGenerationCandidate({
          accountId,
          canvasId,
          fixtureScopeId: scope.fixtureScopeId,
          node,
        });
        return candidate ? [candidate] : [];
      });
      const semanticMatches = new Map(candidates.map((candidate) => {
        const current = currentWorkflowGenerationBinding({
          context: {
            canvasId,
            graph,
            isFixture,
            modelCatalog: executorModelCatalog,
          },
          kind: candidate.kind,
          nodeId: candidate.nodeId,
        });
        return [
          candidate.nodeId,
          current?.inputFingerprint === candidate.inputFingerprint &&
            current.ownershipKey === candidate.ownershipKey,
        ];
      }));
      let policy;
      try {
        policy = await getLegacyTerminalGenerationPolicy(
          canvasId,
          controller.signal,
        );
      } catch {
        if (!scopeIsCurrent()) return;
        for (const node of nodes) {
          if (
            isIncompleteLegacyTerminalGenerationBinding(node) ||
            legacyTerminalGenerationCandidate({
              accountId,
              canvasId,
              fixtureScopeId: scope.fixtureScopeId,
              node,
            })
          ) setLegacyGenerationState(node.id, "UNKNOWN_BLOCKED");
        }
        boundedUnknownRecheck(`policy:${scopeKey}`);
        armRecheck();
        return;
      }
      legacyRecheckAttempts.current.delete(`policy:${scopeKey}`);
      if (!scopeIsCurrent()) return;
      if (policy.mode === "off") {
        for (const node of nodes) {
          if (
            isIncompleteLegacyTerminalGenerationBinding(node) ||
            legacyTerminalGenerationCandidate({
              accountId,
              canvasId,
              fixtureScopeId: scope.fixtureScopeId,
              node,
            })
          ) setLegacyGenerationState(node.id, "PASSTHROUGH");
        }
        return;
      }
      if (candidates.length === 0) return;
      const taskReads = new Map<string, ReturnType<typeof getGenerationTask>>();
      const readTask = (taskId: string) => {
        const existing = taskReads.get(taskId);
        if (existing) return existing;
        const pending = getGenerationTask(
          taskId,
          controller.signal,
          scope.fixtureScopeId,
        );
        taskReads.set(taskId, pending);
        return pending;
      };
      let cursor = 0;
      const worker = async () => {
        while (scopeIsCurrent()) {
          const candidate = candidates[cursor++];
          if (!candidate) return;
          const candidateKey = JSON.stringify(candidate);
          if (runLocks.current.has(candidate.runId)) {
            requestRecheck(1_000);
            continue;
          }
          const conflictingLease = await hasConflictingActiveGroupRunLeaseForCanvas(
            scope,
            candidate.nodeId,
            candidate.runId,
          );
          if (!scopeIsCurrent()) return;
          if (
            exactCheckpointOwns(candidate) || activeLeaseOwns(candidate) ||
            conflictingLease
          ) {
            setLegacyGenerationState(candidate.nodeId, "DETECTING");
            requestRecheck(1_000);
            continue;
          }
          setLegacyGenerationState(candidate.nodeId, "DETECTING");
          let task;
          try {
            task = await readTask(candidate.taskId);
          } catch {
            if (!scopeIsCurrent()) return;
            setLegacyGenerationState(candidate.nodeId, "UNKNOWN_BLOCKED");
            boundedUnknownRecheck(`task:${candidateKey}`);
            continue;
          }
          legacyRecheckAttempts.current.delete(`task:${candidateKey}`);
          if (!scopeIsCurrent()) return;
          let decision;
          try {
            decision = classifyLegacyTerminalGenerationTask({ candidate, task });
          } catch {
            setLegacyGenerationState(candidate.nodeId, "UNKNOWN_BLOCKED");
            boundedUnknownRecheck(`classification:${candidateKey}`);
            continue;
          }
          if (decision.state === "UNKNOWN_BLOCKED") {
            setLegacyGenerationState(candidate.nodeId, decision.state);
            boundedUnknownRecheck(`classification:${candidateKey}`);
            continue;
          }
          legacyRecheckAttempts.current.delete(`classification:${candidateKey}`);
          if (decision.state === "ACTIVE_CONFIRMED") {
            setLegacyGenerationState(candidate.nodeId, decision.state);
            legacyRecheckAttempts.current.delete(`locks:${candidateKey}`);
            legacyRecheckAttempts.current.delete(`write:${candidateKey}`);
            requestRecheck(1_000);
            continue;
          }
          if (!policy.writeEnabled) {
            setLegacyGenerationState(candidate.nodeId, "UNKNOWN_BLOCKED");
            boundedUnknownRecheck(`write:${candidateKey}`);
            continue;
          }
          const locks = (window.navigator as Navigator & {
            locks?: { request: unknown };
          }).locks;
          if (!legacyTerminalCanvasWriteAllowed({
            webLocksAvailable: Boolean(locks),
            writeEnabled: policy.writeEnabled,
          })) {
            setLegacyGenerationState(candidate.nodeId, "UNKNOWN_BLOCKED");
            boundedUnknownRecheck(`locks:${candidateKey}`);
            continue;
          }
          legacyRecheckAttempts.current.delete(`locks:${candidateKey}`);
          try {
            const result = await runWithGroupRunCanvasAdmission(
              canvasId,
              async () => {
                if (
                  !scopeIsCurrent() ||
                  runLocks.current.has(candidate.runId) ||
                  exactCheckpointOwns(candidate) || activeLeaseOwns(candidate) ||
                  await hasConflictingActiveGroupRunLeaseForCanvas(
                    scope,
                    candidate.nodeId,
                    candidate.runId,
                  )
                ) return "deferred" as const;
                await waitForCanvasRevision();
                const freshNode = getLegacyNodes.current().find(
                  (node) => node.id === candidate.nodeId,
                );
                if (!legacyTerminalGenerationCandidateStillMatches(freshNode, candidate)) {
                  return "conflict" as const;
                }
                if (
                  decision.state === "RESTORED" &&
                  semanticMatches.get(candidate.nodeId) === true
                ) {
                  const projection = await reconcileGroupResultProjection({
                    projection: decision.projection,
                    signal: controller.signal,
                  });
                  if (!scopeIsCurrent()) return "unknown" as const;
                  if (
                    projection.status === "applied" ||
                    projection.status === "already-applied"
                  ) {
                    if (!projection.authoritativeMutation) return "unknown" as const;
                    const adopted = adoptAuthoritativeGenerationMutation({
                      ...projection.authoritativeMutation,
                      expected: candidate,
                    });
                    return adopted ? "restored" as const : "unknown" as const;
                  }
                  if (projection.status !== "conflict") return "unknown" as const;
                }
                const detached = await detachLegacyTerminalGeneration({
                  candidate,
                  observedTerminalState: decision.task.state as
                    | "cancelled"
                    | "failed"
                    | "success",
                  resultKey: decision.state === "RESTORED"
                    ? decision.projection.resultKey
                    : undefined,
                  signal: controller.signal,
                });
                if (!scopeIsCurrent()) return "unknown" as const;
                const adopted = adoptAuthoritativeGenerationMutation({
                  ...detached.mutation,
                  expected: candidate,
                });
                return adopted ? "detached" as const : "unknown" as const;
              },
            );
            if (result === "restored") {
              setLegacyGenerationState(candidate.nodeId, "RESTORED");
            } else if (result === "detached") {
              setLegacyGenerationState(candidate.nodeId, "CONFLICT_PRESERVED");
            } else if (result === "deferred") {
              setLegacyGenerationState(candidate.nodeId, "DETECTING");
              requestRecheck(1_000);
            } else if (result === "unknown" || result === "conflict") {
              setLegacyGenerationState(candidate.nodeId, "UNKNOWN_BLOCKED");
              if (result === "unknown") {
                boundedUnknownRecheck(`write:${candidateKey}`);
              }
            }
          } catch {
            if (scopeIsCurrent()) {
              setLegacyGenerationState(candidate.nodeId, "UNKNOWN_BLOCKED");
              boundedUnknownRecheck(`write:${candidateKey}`);
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(3, candidates.length) }, () => worker()),
      );
      armRecheck();
    };
    void run();
    return () => {
      if (legacyReconciliationRunToken.current === runToken) {
        legacyReconciliationRunToken.current += 1;
      }
      controller.abort("legacy-terminal-reconciliation-scope-changed");
      if (recheckTimer !== undefined) window.clearTimeout(recheckTimer);
    };
  }, [
    accountId,
    adoptAuthoritativeGenerationMutation,
    canvasId,
    fixtureScopeId,
    hasLegacyGenerationBindings,
    isFixture,
    legacyBindingSignature,
    modelCatalogStatus,
    persistenceReady,
    setLegacyGenerationState,
    waitForCanvasRevision,
  ]);

  useEffect(() => {
    const scope = { accountId, canvasId, fixtureScopeId };
    const stopForForeignLease = () => {
      for (const running of runningGroups.current.values()) {
        const lease = readGroupRunLease(scope, running.runId);
        if (
          isGroupRunLeaseActive(lease) &&
          lease?.ownerId !== running.ownerId
        ) {
          running.cancelled = true;
          running.leaseLost = true;
          running.abortController.abort("foreign-lease");
          running.publishStopping();
        }
      }
    };
    const stopForNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{
        groupId: string;
        runId: string;
        scope: typeof scope;
      }>).detail;
      if (!detail || JSON.stringify(detail.scope) !== JSON.stringify(scope)) return;
      const starting = startingGroups.current.get(detail.groupId);
      if (starting?.runId === detail.runId) {
        const checkpoint = readGroupRunCheckpoint(scope, detail.runId);
        if (checkpoint?.status === "interrupted") {
          starting.cancelled = true;
        } else {
          cancelGroup(detail.groupId);
        }
      }
      const running = runningGroups.current.get(detail.groupId);
      if (!running || running.checkpoint.runId !== detail.runId) return;
      const checkpoint = readGroupRunCheckpoint(scope, detail.runId);
      if (checkpoint?.status !== "interrupted") {
        cancelGroup(detail.groupId);
        return;
      }
      running.cancelled = true;
      running.navigationStopped = true;
      running.abortController.abort("navigation");
      // confirmGroupRunNavigation already persisted interrupted; do not
      // replace that durable terminal marker with a later running state.
      running.publishStopping();
    };
    window.addEventListener(GROUP_RUN_LEASE_EVENT, stopForForeignLease);
    window.addEventListener("storage", stopForForeignLease);
    window.addEventListener(GROUP_RUN_STOP_EVENT, stopForNavigation);
    return () => {
      window.removeEventListener(GROUP_RUN_LEASE_EVENT, stopForForeignLease);
      window.removeEventListener("storage", stopForForeignLease);
      window.removeEventListener(GROUP_RUN_STOP_EVENT, stopForNavigation);
    };
  }, [accountId, cancelGroup, canvasId, fixtureScopeId]);

  const value = useMemo<WorkflowExecutionValue>(
    () => ({
      cancelGroup,
      executeGroup,
      executingGroupIds,
      lockedNodeIds: effectiveLockedNodeIds,
    }),
    [cancelGroup, effectiveLockedNodeIds, executeGroup, executingGroupIds],
  );

  return (
    <WorkflowExecutionContext.Provider value={value}>
      <LegacyTerminalGenerationStateProvider states={legacyGenerationStates}>
        {children}
      </LegacyTerminalGenerationStateProvider>
    </WorkflowExecutionContext.Provider>
  );
}

export function useWorkflowExecution() {
  return useContext(WorkflowExecutionContext);
}
