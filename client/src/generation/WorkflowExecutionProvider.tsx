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
import { useGenerationCanvas } from "./GenerationCanvasContext";
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
  type GroupRunCheckpoint,
  verifiedCheckpointSuccessIds,
  writeGroupRunCheckpoint,
} from "./groupRunCheckpoint";

export type { NodeRunResult };

export type NodeRunRegistration = {
  preflight?: (input: {
    executableIds: ReadonlySet<string>;
    phase: WorkflowPreflightPhase;
  }) => Promise<NodeRunResult> | NodeRunResult;
  run: () => Promise<NodeRunResult>;
};

const runtimeInputRefreshTimeoutMs = 5_000;
const registrationReadyTimeoutMs = 5_000;
const inFlightRecoveryTimeoutMs = 30_000;

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

function workflowStateCount(
  states: ReadonlyMap<string, WorkflowGraphNodeState>,
  state: WorkflowGraphNodeState,
) {
  return Array.from(states.values()).filter((value) => value === state).length;
}

async function waitForRuntimePreflight(
  registration: NodeRunRegistration,
  executableIds: ReadonlySet<string>,
  isCancelled?: () => boolean,
) {
  if (!registration.preflight) return { status: "success" as const };
  const deadline = Date.now() + runtimeInputRefreshTimeoutMs;
  while (true) {
    if (isCancelled?.()) return { message: "已停止后续节点", status: "skipped" as const };
    const result = await registration.preflight({
      executableIds,
      phase: "runtime",
    });
    if (isCancelled?.()) return { message: "已停止后续节点", status: "skipped" as const };
    if (result.status !== "busy") return result;
    if (Date.now() >= deadline) {
      if (isCancelled?.()) {
        return { message: "已停止后续节点", status: "skipped" as const };
      }
      return registration.preflight({
        executableIds,
        phase: "runtime-final",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function runRegisteredNodeWithRefreshRecovery(input: {
  executableIds: ReadonlySet<string>;
  isCancelled: () => boolean;
  registration: NodeRunRegistration;
}) {
  const deadline = Date.now() + runtimeInputRefreshTimeoutMs;
  while (true) {
    if (input.isCancelled()) {
      return { message: "已停止后续节点", status: "skipped" as const };
    }
    const preflight = await waitForRuntimePreflight(
      input.registration,
      input.executableIds,
      input.isCancelled,
    );
    if (preflight.status !== "success") return preflight;
    // A stop can arrive after the preflight await. Re-check directly before
    // the registration's paid-submit path.
    if (input.isCancelled()) {
      return { message: "已停止后续节点", status: "skipped" as const };
    }
    const result = await input.registration.run();
    if (result.status !== "busy") return result;
    if (input.isCancelled()) {
      return { message: "已停止后续节点", status: "skipped" as const };
    }
    if (Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForExistingNodeRecovery(input: {
  getNode: () => ProbeNodeType | undefined;
  isCancelled: () => boolean;
}) : Promise<NodeRunResult> {
  const deadline = Date.now() + inFlightRecoveryTimeoutMs;
  while (Date.now() < deadline) {
    if (input.isCancelled()) {
      return { message: "已停止后续节点", status: "skipped" };
    }
    const node = input.getNode();
    const proof = groupRunSuccessProof(node);
    if (node && !isWorkflowNodeGenerating(node)) {
      const errorCode = workflowNodeErrorCode(node);
      if (errorCode) {
        return {
          errorCode,
          message: "刷新后现有生成任务未成功，未自动重新提交",
          status: "failed",
        };
      }
      if (proof) return { status: "success", successProof: proof };
      const data = node.data as Record<string, unknown>;
      const hasPersistedTask = ["audio", "image", "text", "video"].some(
        (kind) => typeof data[`${kind}GenerationTaskId`] === "string",
      );
      if (!hasPersistedTask) {
        return {
          message: "刷新后现有生成任务未能恢复，未自动重新提交",
          status: "failed",
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    message: "刷新后现有生成任务仍在恢复，未自动重新提交",
    status: "failed",
  };
}

type WorkflowExecutionValue = {
  cancelGroup: (groupId: string) => void;
  executeGroup: (
    groupId: string,
    checkpoint?: GroupRunCheckpoint,
  ) => Promise<void>;
  executingGroupIds: ReadonlySet<string>;
  lockedNodeIds: ReadonlySet<string>;
  register: (nodeId: string, registration: NodeRunRegistration) => () => void;
};

const WorkflowExecutionContext = createContext<WorkflowExecutionValue>({
  cancelGroup: () => undefined,
  executeGroup: async () => undefined,
  executingGroupIds: new Set(),
  lockedNodeIds: new Set(),
  register: () => () => undefined,
});

export function WorkflowExecutionProvider({
  children,
  getEdges,
  getNodes,
  notify,
  onRetainedNodeIdsChange,
  setNodes,
}: {
  children: ReactNode;
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
  const registrations = useRef(new Map<string, NodeRunRegistration>());
  const startingGroupIds = useRef(new Set<string>());
  const startingGroups = useRef(new Map<string, {
    cancelled: boolean;
    runId: string;
  }>());
  const runningGroups = useRef(new Map<string, {
    activeNodeIds: Set<string>;
    cancelled: boolean;
    checkpoint: GroupRunCheckpoint;
    checkpointWriteFailed: boolean;
    leaseLost: boolean;
    navigationStopped: boolean;
    ownerId: string;
    publishStopping: () => void;
  }>());
  const [executingGroupIds, setExecutingGroupIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [lockedNodeIds, setLockedNodeIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const register = useCallback(
    (nodeId: string, registration: NodeRunRegistration) => {
      registrations.current.set(nodeId, registration);
      return () => {
        if (registrations.current.get(nodeId) === registration) {
          registrations.current.delete(nodeId);
        }
      };
    },
    [],
  );

  const waitForRegistrations = useCallback(async (
    nodeIds: ReadonlySet<string>,
    isCancelled?: () => boolean,
  ) => {
    const deadline = Date.now() + registrationReadyTimeoutMs;
    while (Date.now() < deadline) {
      if (isCancelled?.()) return false;
      if (Array.from(nodeIds).every((nodeId) => registrations.current.has(nodeId))) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (isCancelled?.()) return false;
    return Array.from(nodeIds).every((nodeId) =>
      registrations.current.has(nodeId)
    );
  }, []);

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
    async (groupId: string, resumeCheckpoint?: GroupRunCheckpoint) => {
      if (isFixture) {
        notify("验收页面不会触发真实生成");
        return;
      }
      if (runningGroups.current.size > 0 || startingGroupIds.current.size > 0) {
        if (runningGroups.current.has(groupId) || startingGroupIds.current.has(groupId)) {
          return;
        }
        notify("当前画布已有一组正在执行，请等待完成后再开始另一组");
        return;
      }
      const scope = { accountId, canvasId, fixtureScopeId };
      if (!resumeCheckpoint && readGroupRunCheckpoint(scope)) {
        notify("当前画布有一轮未完成记录，请在生成任务面板继续或明确放弃后再开始新一轮", "error");
        return;
      }
      startingGroupIds.current.add(groupId);
      const runId = resumeCheckpoint?.runId ?? crypto.randomUUID();
      startingGroups.current.set(groupId, { cancelled: false, runId });
      markGroupRunStarting(scope, groupId, runId);
      // The preparation phase is active too: this drives beforeunload and
      // keeps the task-panel stop action usable while nodes are mounting.
      setExecutingGroupIds(new Set([groupId]));
      const runSequence = nextGroupRunSequence();
      let checkpoint: GroupRunCheckpoint | undefined;
      let retained = false;
      let leaseAcquired = false;
      let leaseTimer: number | undefined;
      let summaryBaseForError: (() => Omit<GroupRunSummary, "status">) | undefined;
      const ownerId = getGroupRunExecutionOwnerId();
      const isStartingCancelled = () =>
        startingGroups.current.get(groupId)?.cancelled === true;
      const expectedLease = () => ({ ownerId, runId });
      const retainRunNodes = (
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
        onRetainedNodeIdsChange(retainedNodeIds);
        setLockedNodeIds(retainedNodeIds);
        retained = true;
      };
      try {
        // Freeze edits at the click boundary, before save/lease/registration
        // awaits. Direct external sources are part of the input snapshot too.
        retainRunNodes(getNodes(), getEdges());
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
        leaseAcquired = await acquireGroupRunLease(scope, runId, ownerId);
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
          const current = runningGroups.current.get(groupId);
          const starting = startingGroups.current.get(groupId);
          if (!current && !starting) return;
          if (current?.cancelled || starting?.cancelled) return;
          if (!renewGroupRunLease(scope, runId, ownerId)) {
            if (current) {
              current.leaseLost = true;
              current.cancelled = true;
              current.publishStopping();
            }
            if (starting) starting.cancelled = true;
            notify("执行租约已失效，已阻止后续节点；请核对已提交任务", "error");
          }
        }, groupRunLeaseHeartbeatMs);

        retainRunNodes(nodes, edges);
        const remainingIds = new Set(
          [...executableIds].filter((id) => !initialSuccessNodeIds.has(id)),
        );
        if (!await waitForRegistrations(remainingIds, isStartingCancelled)) {
          notify("整组节点未能完成加载，本轮没有提交生成任务", "error");
          return;
        }
        if (isStartingCancelled()) return;

        const startedAt = resumeCheckpoint?.startedAt ?? Date.now();
        const nodeStates = new Map<string, WorkflowGraphNodeState>(
          [...initialSuccessNodeIds].map((nodeId) => [nodeId, "success"]),
        );
        checkpoint = {
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
          lease: readGroupRunLease(scope),
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
          const registration = registrations.current.get(nodeId);
          if (!registration) {
            preflightFailures.push({ message: "节点尚未就绪", nodeId });
            continue;
          }
          const result = await registration.preflight?.({
            executableIds,
            phase: "static",
          }) ?? { status: "success" as const };
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
            const registration = registrations.current.get(nodeId);
            if (!registration) {
              return { message: "节点执行上下文意外丢失", status: "failed" };
            }
            running.activeNodeIds.add(nodeId);
            try {
              if (resumeInFlightNodeIds.has(nodeId)) {
                return await waitForExistingNodeRecovery({
                  getNode: () => getNodes().find((node) => node.id === nodeId),
                  isCancelled: () => running.cancelled,
                });
              }
              return await runGroupNodeWithPersist({
                isCancelled: () => running.cancelled,
                persist: () => persistGroupCanvasAfterNode({
                  flushCanvasSave,
                  waitForCanvasRevision,
                }),
                run: async () => {
                  return runRegisteredNodeWithRefreshRecovery({
                    executableIds,
                    isCancelled: () => running.cancelled,
                    registration,
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
        if (leaseTimer !== undefined) window.clearInterval(leaseTimer);
        runningGroups.current.delete(groupId);
        startingGroupIds.current.delete(groupId);
        startingGroups.current.delete(groupId);
        clearGroupRunStarting(scope, runId);
        if (leaseAcquired) {
          releaseGroupRunLease(scope, runId, ownerId);
        }
        setExecutingGroupIds(new Set());
        if (retained) {
          setLockedNodeIds(new Set());
          onRetainedNodeIdsChange(new Set());
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
      onRetainedNodeIdsChange,
      waitForRegistrations,
      waitForCanvasStable,
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
    const scope = { accountId, canvasId, fixtureScopeId };
    const stopForForeignLease = () => {
      const lease = readGroupRunLease(scope);
      for (const running of runningGroups.current.values()) {
        if (
          isGroupRunLeaseActive(lease) &&
          (lease?.ownerId !== running.ownerId || lease.runId !== running.checkpoint.runId)
        ) {
          running.cancelled = true;
          running.leaseLost = true;
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
        const checkpoint = readGroupRunCheckpoint(scope);
        if (checkpoint?.status === "interrupted") {
          starting.cancelled = true;
        } else {
          cancelGroup(detail.groupId);
        }
      }
      const running = runningGroups.current.get(detail.groupId);
      if (!running || running.checkpoint.runId !== detail.runId) return;
      const checkpoint = readGroupRunCheckpoint(scope);
      if (checkpoint?.status !== "interrupted") {
        cancelGroup(detail.groupId);
        return;
      }
      running.cancelled = true;
      running.navigationStopped = true;
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
      register,
    }),
    [cancelGroup, executeGroup, executingGroupIds, lockedNodeIds, register],
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
