import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ProbeNodeType } from "../canvas/ProbeNode";
import type { CuttableEdge } from "../canvas/canvasTypes";
import { useGenerationCanvas } from "./GenerationCanvasContext";
import {
  buildWorkflowLayers,
  isExecutableWorkflowNode,
  isWorkflowNodeGenerating,
  runWorkflowLayers,
  type NodeRunResult,
} from "./workflowExecution";

export type { NodeRunResult };

export type NodeRunRegistration = {
  run: () => Promise<NodeRunResult>;
};

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
}: {
  children: ReactNode;
  getEdges: () => CuttableEdge[];
  getNodes: () => ProbeNodeType[];
  notify: (message: string, kind?: "error" | "info" | "success") => void;
}) {
  const { isFixture } = useGenerationCanvas();
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
      let layers: string[][];
      try {
        layers = buildWorkflowLayers(children, edges);
      } catch (error) {
        notify(error instanceof Error ? error.message : "整组执行失败");
        return;
      }
      const running = { cancelled: false };
      runningGroups.current.set(groupId, running);
      setExecutingGroupIds(new Set(runningGroups.current.keys()));
      try {
        const result = await runWorkflowLayers({
          executableIds,
          isCancelled: () => running.cancelled,
          layers,
          onLayer: (current, total) => {
            notify(`整组执行中：第 ${current}/${total} 层`);
          },
          runNode: (nodeId) =>
            registrations.current.get(nodeId)?.run() ??
              Promise.resolve({ status: "skipped" }),
        });
        if (result.status === "success") {
          notify("整组执行完成", "success");
        } else if (result.status === "failed") {
          notify(
            `整组执行失败：${result.message ?? "请查看节点错误提示"}`,
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
    [getEdges, getNodes, isFixture, notify],
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
