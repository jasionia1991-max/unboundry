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
  type WorkflowPreflightPhase,
} from "./workflowExecution";
import { publishGroupRunSummary } from "./groupRunSummary";

export type { NodeRunResult };

export type NodeRunRegistration = {
  preflight?: (input: {
    executableIds: ReadonlySet<string>;
    phase: WorkflowPreflightPhase;
  }) => Promise<NodeRunResult> | NodeRunResult;
  run: () => Promise<NodeRunResult>;
};

const runtimeInputRefreshTimeoutMs = 5_000;

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
  const { canvasId, flushCanvasSave, isFixture, waitForCanvasRevision } =
    useGenerationCanvas();
  const registrations = useRef(new Map<string, NodeRunRegistration>());
  const runningGroups = useRef(new Map<string, { cancelled: boolean }>());
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
    if (running) running.cancelled = true;
  }, []);

  const executeGroup = useCallback(
    async (groupId: string) => {
      if (isFixture) {
        notify("验收页面不会触发真实生成");
        return;
      }
      if (runningGroups.current.has(groupId)) return;
      try {
        await flushCanvasSave();
        await waitForCanvasRevision();
        const stripped = stripStaleCanvasSaveErrors(getNodes(), groupId);
        if (stripped.changed) {
          setNodes(stripped.nodes);
          await flushCanvasSave();
          await waitForCanvasRevision();
        }
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "画布还在保存，请稍后再试",
          "error",
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
      const preflightFailures: Array<{ message: string; nodeId: string }> = [];
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
            message: result.message ?? "请检查标红节点",
            nodeId,
          });
        }
      }
      if (preflightFailures.length > 0) {
        const first = preflightFailures[0];
        const firstNode = nodeById.get(first.nodeId);
        const firstTitle = typeof firstNode?.data.title === "string" &&
            firstNode.data.title.trim()
          ? firstNode.data.title.trim()
          : typeof firstNode?.data.label === "string" && firstNode.data.label.trim()
            ? firstNode.data.label.trim()
            : first.nodeId;
        notify(
          `整组执行已阻止：发现 ${preflightFailures.length} 个不兼容节点；首个“${firstTitle}”：${first.message}（未提交任何生成任务）`,
          "error",
        );
        return;
      }
      const running = { cancelled: false };
      const startedAt = Date.now();
      runningGroups.current.set(groupId, running);
      setExecutingGroupIds(new Set(runningGroups.current.keys()));
      try {
        let lastCompleted = 0;
        const result = await runWorkflowGraph({
          edges,
          executableIds,
          isCancelled: () => running.cancelled,
          onNodeStateChange: (_nodeId, state, completed, total) => {
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
            return runGroupNodeWithPersist({
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
          },
        });
        publishGroupRunSummary({
          canvasId,
          elapsedMs: Date.now() - startedAt,
          groupId,
          nodeCount: executableIds.size,
          status: result.status,
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
          notify("整组执行已取消");
        }
      } catch {
        notify("整组执行失败", "error");
      } finally {
        runningGroups.current.delete(groupId);
        setExecutingGroupIds(new Set(runningGroups.current.keys()));
      }
    },
    [canvasId, flushCanvasSave, getEdges, getNodes, isFixture, notify, waitForCanvasRevision],
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
