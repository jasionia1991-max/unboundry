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
import { createNodeExecutorRegistry } from "./workflowNodeExecutors";
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
  GROUP_RUN_CONTINUE_EVENT,
  GROUP_RUN_LEASE_EVENT,
  GROUP_RUN_STOP_EVENT,
  getGroupRunExecutionOwnerId,
  groupRunLeaseHeartbeatMs,
  groupRunSnapshotFingerprint,
  groupRunSuccessProof,
  isGroupRunLeaseActive,
  markGroupRunStarting,
  readGroupRunCheckpoint,
  readGroupRunLease,
  releaseGroupRunLease,
  renewGroupRunLease,
  taskMatchesAcceptedBinding,
  type AcceptedTaskBinding,
  type GroupRunCheckpoint,
  verifiedCheckpointSuccessIds,
  writeGroupRunCheckpoint,
} from "./groupRunCheckpoint";
import { runExclusiveCanvasSubmit } from "./saveGate";
import { listGenerationTasks } from "./generationTasks";

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
  notify,
  onRetainedNodeIdsChange,
  setNodes,
}: {
  children: ReactNode;
  graph: CanvasGraphCommandPort;
  getEdges: () => CuttableEdge[];
  getNodes: () => ProbeNodeType[];
  notify: (message: string, kind?: "error" | "info" | "success") => void;
  onRetainedNodeIdsChange: (nodeIds: ReadonlySet<string>) => void;
  setNodes: Dispatch<SetStateAction<ProbeNodeType[]>>;
}) {
  const {
    accountId,
    canvasId,
    fixtureScopeId,
    flushCanvasSave,
    isFixture,
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
  const automaticRecoveryScopes = useRef(new Set<string>());
  const [executingGroupIds, setExecutingGroupIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [lockedNodeIds, setLockedNodeIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
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
    onRetainedNodeIdsChange(nextLocks);
  }, [onRetainedNodeIdsChange]);

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
        await waitForCanvasRevision(30_000);
        if (isCancelled?.()) return;
        const stripped = stripStaleCanvasSaveErrors(getNodes(), groupId);
        if (!stripped.changed) return;
        setNodes(stripped.nodes);
        await flushCanvasSave();
        if (isCancelled?.()) return;
        await waitForCanvasRevision(30_000);
        return;
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
      if (runningGroups.current.has(groupId) || startingGroupIds.current.has(groupId)) {
        return;
      }
      const scope = { accountId, canvasId, fixtureScopeId };
      const existingCheckpoint = !resumeCheckpoint
        ? readGroupRunCheckpoint(scope)
        : undefined;
      const liveRunIds = new Set([
        ...[...startingGroups.current.values()].map((run) => run.runId),
        ...[...runningGroups.current.values()].map((run) => run.runId),
      ]);
      if (existingCheckpoint && !liveRunIds.has(existingCheckpoint.runId)) {
        notify("当前画布有一轮未完成记录，请在生成任务面板继续或明确放弃后再开始新一轮", "error");
        return;
      }
      const candidateNodes = getNodes();
      const candidateEdges = getEdges();
      const childIds = new Set(
        candidateNodes
          .filter((node) => node.parentId === groupId)
          .map((node) => node.id),
      );
      const candidateLockIds = new Set([groupId, ...childIds]);
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
        notify(
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
      const abortController = new AbortController();
      let leaseAcquired = false;
      let leaseTimer: number | undefined;
      let leaseRenewInFlight: Promise<boolean> | undefined;
      let summaryBaseForError: (() => Omit<GroupRunSummary, "status">) | undefined;
      const ownerId = getGroupRunExecutionOwnerId();
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
          await waitForCanvasStable(groupId, isStartingCancelled);
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message
              : "画布内容还在保存，稍后会继续，请稍候",
          );
          return;
        }
        if (isStartingCancelled()) return;
        const nodes = getNodes();
        const edges = getEdges();
        const children = nodes.filter((node) => node.parentId === groupId);
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const incomingTextTargets = new Set<string>();
        for (const edge of edges) {
          if (nodeById.get(edge.source)?.type === "text") {
            incomingTextTargets.add(edge.target);
          }
        }
        const executableIds = new Set(
          children
            .filter((node) => isExecutableWorkflowNode(node, {
              hasIncomingText: incomingTextTargets.has(node.id),
            }))
            .map((node) => node.id),
        );
        const resumeInFlightNodeIds = new Set(
          resumeCheckpoint
            ? Object.entries(resumeCheckpoint.nodeStates)
                .filter(([, state]) => state === "running")
                .map(([nodeId]) => nodeId)
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

        const snapshotFingerprint = groupRunSnapshotFingerprint({
          edges,
          executableNodeIds: executableIds,
          groupId,
          nodes,
        });
        let initialSuccessNodeIds = new Set<string>();
        if (resumeCheckpoint) {
          const expectedIds = [...resumeCheckpoint.executableNodeIds].sort();
          const actualIds = [...executableIds].sort();
          if (
            resumeCheckpoint.accountId !== accountId ||
            resumeCheckpoint.canvasId !== canvasId ||
            resumeCheckpoint.fixtureScopeId !== fixtureScopeId ||
            resumeCheckpoint.groupId !== groupId ||
            resumeCheckpoint.snapshotFingerprint !== snapshotFingerprint ||
            JSON.stringify(expectedIds) !== JSON.stringify(actualIds)
          ) {
            notify("画布内容已变化，不能安全继续上一轮；请重新检查后开始新一轮", "error");
            return;
          }
          const verification = verifiedCheckpointSuccessIds(resumeCheckpoint, nodes);
          if (verification.mismatchNodeId) {
            notify("上一轮成功结果的任务凭证与当前画布不一致，已阻止重复生成", "error");
            return;
          }
          initialSuccessNodeIds = verification.verified;
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
              const tasks = await listGenerationTasks(canvasId);
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
          notify(
            "locks" in window.navigator
              ? "当前画布已在其他标签页执行，请等待完成后再继续"
              : "当前浏览器不支持安全的跨标签整组执行，本轮已阻止",
            "error",
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
            notify("执行租约已失效，已阻止后续节点；请核对已提交任务", "error");
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
          runId,
          snapshotFingerprint,
          startedAt,
          status: "preparing",
          successProofs: resumeCheckpoint?.successProofs ?? {},
          lease: readGroupRunLease(scope, runId),
          updatedAt: Date.now(),
          version: 1,
        };
        if (!writeGroupRunCheckpoint(checkpoint, expectedLease())) {
          notify("浏览器无法保存整组进度，为避免刷新后重复生成，本轮已阻止", "error");
          return;
        }

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
            notify("上一轮没有已接收任务，保留待处理节点且未自动提交", "info");
            return;
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
            if (nodeStates.get(binding.nodeId) === "success") continue;
            const node = getNodes().find((candidate) => candidate.id === binding.nodeId);
            const executor = registry.get(node);
            if (!executor || executor.kind !== binding.kind) {
              nodeStates.set(binding.nodeId, "failed");
            } else {
              running.activeNodeIds.add(binding.nodeId);
              nodeStates.set(binding.nodeId, "running");
              try {
                const result = await executor.recover(
                  binding.nodeId,
                  createExecutorContext(
                    () => running.cancelled,
                    { acceptedTask: binding },
                  ),
                );
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
                  notify(
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
          );
          const complete = !running.cancelled &&
            !verification.mismatchNodeId &&
            [...executableIds].every((nodeId) =>
              nodeStates.get(nodeId) === "success" &&
              verification.verified.has(nodeId)
            );
          if (complete && clearGroupRunCheckpoint(scope, expectedLease())) {
            publishGroupRunSummary({ ...summaryBase(), status: "success" });
            notify("已自动核对并保存上一轮已接收任务；没有提交新任务", "success");
          } else {
            running.checkpoint = {
              ...running.checkpoint,
              nodeStates: Object.fromEntries(nodeStates),
              status: "interrupted",
              updatedAt: Date.now(),
            };
            checkpoint = running.checkpoint;
            writeGroupRunCheckpoint(running.checkpoint, expectedLease());
            notify("已核对上一轮已接收任务；待处理节点未自动提交，请在任务面板继续或放弃", "info");
          }
          return;
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
          if (initialSuccessNodeIds.size === 0) {
            if (!clearGroupRunCheckpoint(scope, expectedLease())) {
              notify("准备失败，但续跑记录无法清理；请勿重复开始", "error");
            }
          } else {
            checkpoint = { ...checkpoint, status: "interrupted", updatedAt: Date.now() };
            if (!writeGroupRunCheckpoint(checkpoint, expectedLease())) {
              notify("准备失败且进度无法保存；请勿重复开始", "error");
            }
          }
          notify(
            `整组执行已阻止：发现 ${preflightFailures.length} 个不兼容节点；首个“${firstTitle}”：${first.message}${resumeCheckpoint ? "（本次未提交新任务）" : "（未提交任何生成任务）"}`,
            "error",
          );
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
          notify("运行状态无法保存，为避免刷新后重复生成，本轮已停止", "error");
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
                notify("节点已返回成功但缺少可持续任务凭证，已阻止后续节点", "error");
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
              notify("整组进度无法保存，已阻止后续节点；请核对已提交任务", "error");
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
              if (resumeInFlightNodeIds.has(nodeId)) {
                return await executor.recover(
                  nodeId,
                  createExecutorContext(
                    () => running.cancelled,
                    { acceptedTask: running.checkpoint.acceptedTasks?.[nodeId] },
                  ),
                );
              }
              return await runGroupNodeWithPersist({
                isCancelled: () => running.cancelled,
                persist: () => persistGroupCanvasAfterNode({
                  save,
                }),
                run: async () => {
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
          if (!clearGroupRunCheckpoint(scope, expectedLease())) {
            const interrupted = {
              ...running.checkpoint,
              nodeStates: Object.fromEntries(nodeStates),
              status: "interrupted" as const,
              updatedAt: Date.now(),
            };
            running.checkpoint = interrupted;
            writeGroupRunCheckpoint(interrupted, expectedLease());
            notify("整组已完成，但续跑记录无法清理；请勿重复开始", "error");
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
            notify("整组终态无法保存；已阻止后续节点，请核对已提交任务", "error");
          }
          if (result.status === "failed") {
            const blocked = result.blockedNodeIds.length > 0
              ? `；另有 ${result.blockedNodeIds.length} 个后续节点因上游失败未运行`
              : "";
            notify(
              `整组执行部分失败：${result.message ?? "请查看节点错误提示"}${blocked}`,
              "error",
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
            notify("整组异常且终态无法保存；请核对已提交任务后再继续", "error");
          }
        }
        notify(`${message}；可在生成任务面板核对后继续剩余节点`, "error");
      } finally {
        abortController.abort("run-finished");
        if (leaseTimer !== undefined) window.clearInterval(leaseTimer);
        if (runningGroups.current.get(groupId)?.runId === runId) {
          runningGroups.current.delete(groupId);
        }
        if (startingGroups.current.get(groupId)?.runId === runId) {
          startingGroupIds.current.delete(groupId);
          startingGroups.current.delete(groupId);
        }
        runLocks.current.delete(runId);
        clearGroupRunStarting(scope, runId);
        if (leaseAcquired) {
          releaseGroupRunLease(scope, runId, ownerId);
        }
        publishActiveRunState();
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
      executorModelCatalog,
      registry,
    ],
  );

  useEffect(() => {
    const continuePreviousRun = (event: Event) => {
      const checkpoint = (event as CustomEvent<GroupRunCheckpoint>).detail;
      if (
        !checkpoint ||
        checkpoint.accountId !== accountId ||
        checkpoint.canvasId !== canvasId ||
        checkpoint.fixtureScopeId !== fixtureScopeId
      ) return;
      void executeGroup(checkpoint.groupId, checkpoint);
    };
    window.addEventListener(GROUP_RUN_CONTINUE_EVENT, continuePreviousRun);
    return () => window.removeEventListener(
      GROUP_RUN_CONTINUE_EVENT,
      continuePreviousRun,
    );
  }, [accountId, canvasId, executeGroup, fixtureScopeId]);

  useEffect(() => {
    if (isFixture) return;
    const scope = { accountId, canvasId, fixtureScopeId };
    const scopeKey = JSON.stringify(scope);
    if (automaticRecoveryScopes.current.has(scopeKey)) return;
    automaticRecoveryScopes.current.add(scopeKey);
    let disposed = false;
    const reconcile = async () => {
      // Canvas hydration and model-catalog hydration are asynchronous. Wait for
      // the exact checkpoint graph to be visible before the single auto attempt.
      for (let attempt = 0; attempt < 40 && !disposed; attempt += 1) {
        const checkpoint = readGroupRunCheckpoint(scope);
        const accepted = Object.keys(checkpoint?.acceptedTasks ?? {});
        const nodeIds = new Set(getNodes().map((node) => node.id));
        if (
          checkpoint &&
          accepted.length > 0 &&
          nodeIds.has(checkpoint.groupId) &&
          checkpoint.executableNodeIds.every((nodeId) => nodeIds.has(nodeId))
        ) {
          await executeGroup(checkpoint.groupId, checkpoint, true);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    };
    void reconcile();
    return () => {
      disposed = true;
    };
  }, [accountId, canvasId, executeGroup, fixtureScopeId, getNodes, isFixture]);

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
      lockedNodeIds,
    }),
    [cancelGroup, executeGroup, executingGroupIds, lockedNodeIds],
  );

  return (
    <WorkflowExecutionContext.Provider value={value}>
      {children}
    </WorkflowExecutionContext.Provider>
  );
}

export function useWorkflowExecution() {
  return useContext(WorkflowExecutionContext);
}
