import {
  createContext,
  useCallback,
  useContext,
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
} from "./groupRunSummary";

export type { NodeRunResult };

export type NodeRunRegistration = {
  preflight?: (input: {
    executableIds: ReadonlySet<string>;
    phase: WorkflowPreflightPhase;
  }) => Promise<NodeRunResult> | NodeRunResult;
  run: () => Promise<NodeRunResult>;
};

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

function workflowStateCount(
  states: ReadonlyMap<string, WorkflowGraphNodeState>,
  state: WorkflowGraphNodeState,
) {
  return Array.from(states.values()).filter((value) => value === state).length;
}

async function waitForRuntimePreflight(
  registration: NodeRunRegistration,
  executableIds: ReadonlySet<string>,
) {
  if (!registration.preflight) return { status: "success" as const };
  const deadline = Date.now() + runtimeInputRefreshTimeoutMs;
  while (true) {
    const result = await registration.preflight({
      executableIds,
      phase: "runtime",
    });
    if (result.status !== "busy") return result;
    if (Date.now() >= deadline) {
      return registration.preflight({
        executableIds,
        phase: "runtime-final",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

type WorkflowExecutionValue = {
  cancelGroup: (groupId: string) => void;
  executeGroup: (groupId: string) => Promise<void>;
  executingGroupIds: ReadonlySet<string>;
  register: (nodeId: string, registration: NodeRunRegistration) => () => void;
};

const WorkflowExecutionContext = createContext<WorkflowExecutionValue>({
  cancelGroup: () => undefined,
  executeGroup: async () => undefined,
  executingGroupIds: new Set(),
  register: () => () => undefined,
});

export function WorkflowExecutionProvider({
  children,
  getEdges,
  getNodes,
  notify,
  setNodes,
}: {
  children: ReactNode;
  getEdges: () => CuttableEdge[];
  getNodes: () => ProbeNodeType[];
  notify: (message: string, kind?: "error" | "info" | "success") => void;
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
  const runningGroups = useRef(new Map<string, {
    activeNodeIds: Set<string>;
    cancelled: boolean;
  }>());
  const [executingGroupIds, setExecutingGroupIds] = useState<
    ReadonlySet<string>
  >(new Set());

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

  const cancelGroup = useCallback((groupId: string) => {
    const running = runningGroups.current.get(groupId);
    if (!running || running.cancelled) return;
    running.cancelled = true;
    const activeCount = running.activeNodeIds.size;
    notify(
      `已停止后续节点；当前已开始的 ${activeCount} 个节点仍会继续处理，已经提交的任务会继续并保存结果。`,
    );
  }, [notify]);

  const waitForCanvasStable = useCallback(async (groupId: string) => {
    // 画布自动保存期间不弹红字：最多等三轮，每轮 30 秒；
    // 保存完成会自动继续，只有真正超时才给中性提示。
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await flushCanvasSave();
        await waitForCanvasRevision(30_000);
        const stripped = stripStaleCanvasSaveErrors(getNodes(), groupId);
        if (!stripped.changed) return;
        setNodes(stripped.nodes);
        await flushCanvasSave();
        await waitForCanvasRevision(30_000);
        return;
      } catch (error) {
        if (attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }, [flushCanvasSave, getNodes, setNodes, waitForCanvasRevision]);

  const executeGroup = useCallback(
    async (groupId: string) => {
      if (isFixture) {
        notify("验收页面不会触发真实生成");
        return;
      }
      if (
        runningGroups.current.has(groupId) ||
        startingGroupIds.current.has(groupId)
      ) return;
      startingGroupIds.current.add(groupId);
      const runId = crypto.randomUUID();
      const runSequence = nextGroupRunSequence();
      try {
      try {
        await waitForCanvasStable(groupId);
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "画布内容还在保存，稍后会继续，请稍候",
        );
        return;
      }
      const nodes = getNodes();
      const edges = getEdges();
      const children = nodes.filter((node) => node.parentId === groupId);
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const incomingTextTargets = new Set<string>();
      for (const edge of edges) {
        if (nodeById.get(edge.source)?.type !== "text") continue;
        incomingTextTargets.add(edge.target);
      }
      const executableIds = new Set(
        children
          .filter((node) =>
            isExecutableWorkflowNode(node, {
              hasIncomingText: incomingTextTargets.has(node.id),
            }))
          .map((node) => node.id),
      );
      if (executableIds.size === 0) {
        notify("组内没有可执行的生成节点");
        return;
      }
      if (children.some(isWorkflowNodeGenerating)) {
        notify("组内有节点正在生成，请等待完成后再试");
        return;
      }
      try {
        buildWorkflowLayers(children, edges);
      } catch (error) {
        notify(error instanceof Error ? error.message : "整组执行失败");
        return;
      }
      const startedAt = Date.now();
      const preflightFailures: Array<{
        errorCode?: string;
        message: string;
        nodeId: string;
      }> = [];
      for (const nodeId of executableIds) {
        const registration = registrations.current.get(nodeId);
        if (!registration) {
          preflightFailures.push({ message: "节点尚未就绪", nodeId });
          continue;
        }
        const result = await registration.preflight?.({
          executableIds,
          phase: "static",
        }) ?? {
          status: "success" as const,
        };
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
          accountId,
          blockedCount: executableIds.size - preflightFailures.length,
          blockedNodeIds: Array.from(executableIds).filter((nodeId) =>
            !preflightFailures.some((failure) => failure.nodeId === nodeId)
          ),
          canvasId,
          completedAt: Date.now(),
          elapsedMs: Date.now() - startedAt,
          errorCode: first.errorCode ?? workflowNodeErrorCode(firstNode),
          failedCount: preflightFailures.length,
          failedNodeIds: preflightFailures.map((failure) => failure.nodeId),
          firstFailedNodeId: first.nodeId,
          firstFailedNodeTitle: firstTitle,
          fixtureScopeId,
          groupId,
          nodeCount: executableIds.size,
          reason: first.message,
          runId,
          runSequence,
          skippedCount: 0,
          skippedNodeIds: [],
          status: "failed",
          startedAt,
          successCount: 0,
        });
        notify(
          `整组执行已阻止：发现 ${preflightFailures.length} 个不兼容节点；首个“${firstTitle}”：${first.message}（未提交任何生成任务）`,
          "error",
        );
        return;
      }
      const running = { activeNodeIds: new Set<string>(), cancelled: false };
      const nodeStates = new Map<string, WorkflowGraphNodeState>();
      runningGroups.current.set(groupId, running);
      setExecutingGroupIds(new Set(runningGroups.current.keys()));
      try {
        let lastCompleted = 0;
        const result = await runWorkflowGraph({
          edges,
          executableIds,
          isCancelled: () => running.cancelled,
          onNodeStateChange: (nodeId, state, completed, total) => {
            nodeStates.set(nodeId, state);
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
              return { message: "节点尚未就绪", status: "failed" };
            }
            running.activeNodeIds.add(nodeId);
            try {
              return await runGroupNodeWithPersist({
                isCancelled: () => running.cancelled,
                persist: () =>
                  persistGroupCanvasAfterNode({
                    flushCanvasSave,
                    waitForCanvasRevision,
                  }),
                run: async () => {
                  const preflight = await waitForRuntimePreflight(
                    registration,
                    executableIds,
                  );
                  if (preflight.status !== "success") return preflight;
                  return registration.run();
                },
              });
            } finally {
              running.activeNodeIds.delete(nodeId);
            }
          },
        });
        const nodeIdsInStates = (states: WorkflowGraphNodeState[]) =>
          Array.from(nodeStates.entries())
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
          accountId,
          blockedCount: blockedNodeIds.length,
          blockedNodeIds,
          canvasId,
          completedAt: Date.now(),
          elapsedMs: Date.now() - startedAt,
          errorCode: result.status === "failed"
            ? result.firstFailure?.errorCode ?? workflowNodeErrorCode(latestNode)
            : workflowNodeErrorCode(latestNode),
          failedCount: failedNodeIds.length,
          failedNodeIds,
          firstFailedNodeId,
          firstFailedNodeTitle: firstFailedNodeId
            ? workflowNodeTitle(latestNode, firstFailedNodeId)
            : undefined,
          fixtureScopeId,
          groupId,
          nodeCount: executableIds.size,
          reason: result.status === "failed"
            ? result.firstFailure?.message ?? "请查看失败节点的错误提示"
            : "message" in result ? result.message : undefined,
          runId,
          runSequence,
          skippedCount: skippedNodeIds.length,
          skippedNodeIds,
          status: result.status,
          startedAt,
          successCount: workflowStateCount(nodeStates, "success"),
        });
        if (result.status === "success") {
          notify("整组执行完成", "success");
        } else if (result.status === "failed") {
          const blocked = result.blockedNodeIds.length > 0
            ? `；另有 ${result.blockedNodeIds.length} 个后续节点因上游失败未运行`
            : "";
          notify(
            `整组执行部分失败：${result.message ?? "请查看节点错误提示"}${blocked}`,
            "error",
          );
        } else if (result.status === "skipped") {
          notify(
            `整组执行已停止：${result.message ?? "有节点未就绪"}`,
          );
        } else {
          notify("已停止后续节点；已经开始的节点均已处理完毕");
        }
      } catch {
        notify("整组执行失败", "error");
      } finally {
        runningGroups.current.delete(groupId);
        setExecutingGroupIds(new Set(runningGroups.current.keys()));
      }
      } finally {
        startingGroupIds.current.delete(groupId);
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
      waitForCanvasStable,
    ],
  );

  const value = useMemo<WorkflowExecutionValue>(
    () => ({
      cancelGroup,
      executeGroup,
      executingGroupIds,
      register,
    }),
    [cancelGroup, executeGroup, executingGroupIds, register],
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
