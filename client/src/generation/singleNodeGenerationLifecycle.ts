import type { ProbeNodeType } from "../canvas/ProbeNode";
import type {
  CanvasGenerationKind,
  CanvasGraphCommandPort,
  CanvasGraphSnapshot,
  CanvasSavePort,
} from "../canvas/canvasPorts";
import type {
  EnsuredGenerationTask,
  GenerationReconcileOutcome,
  GenerationTaskSummary,
} from "./generationTasks";

export type SingleNodeGenerationPlan = Readonly<{
  inputKey: string;
  kind: CanvasGenerationKind;
  nodeId: string;
  ownershipKey: string;
  payload: unknown;
}>;

export type SingleNodeGenerationBlocked = Readonly<{
  message: string;
  status: "blocked";
}>;

export type SingleNodeLifecycleResult = Readonly<{
  reconcileOutcome?: GenerationReconcileOutcome;
  reason?: "blocked" | "stale";
  status: "cancelled" | "failed" | "stale" | "success";
  task?: GenerationTaskSummary;
}>;

export type SingleNodeGenerationTaskReference = Readonly<{ id: string }>;

export type SingleNodeTaskReconcileResult = Readonly<{
  outcome: GenerationReconcileOutcome;
  task: GenerationTaskSummary;
}>;

export interface SingleNodeGenerationAdapter {
  kind: CanvasGenerationKind;
  applyPrepared?(
    node: ProbeNodeType,
    plan: SingleNodeGenerationPlan,
  ): ProbeNodeType;
  applyBinding(
    node: ProbeNodeType,
    task: GenerationTaskSummary,
    plan: SingleNodeGenerationPlan,
  ): ProbeNodeType;
  applyTerminal(
    node: ProbeNodeType,
    task: GenerationTaskSummary,
    plan: SingleNodeGenerationPlan,
  ): ProbeNodeType;
  readPlan(
    snapshot: CanvasGraphSnapshot,
    nodeId: string,
  ): SingleNodeGenerationBlocked | SingleNodeGenerationPlan;
}

export interface SingleNodeGenerationTaskPort {
  cancel(
    task: SingleNodeGenerationTaskReference,
    context: SingleNodeTaskOperationContext,
  ): Promise<GenerationTaskSummary | undefined>;
  ensure(
    plan: SingleNodeGenerationPlan,
    context: SingleNodeTaskOperationContext,
  ): Promise<EnsuredGenerationTask>;
  reconcile(
    task: SingleNodeGenerationTaskReference,
    plan: SingleNodeGenerationPlan,
    context: SingleNodeTaskOperationContext,
  ): Promise<SingleNodeTaskReconcileResult>;
  recover(
    plan: SingleNodeGenerationPlan,
    context: SingleNodeTaskOperationContext,
  ): Promise<GenerationTaskSummary | undefined>;
  retry(
    task: SingleNodeGenerationTaskReference,
    plan: SingleNodeGenerationPlan,
    context: SingleNodeTaskOperationContext,
  ): Promise<GenerationTaskSummary>;
  watch(
    task: GenerationTaskSummary,
    context: SingleNodeTaskOperationContext,
  ): Promise<GenerationTaskSummary>;
}

export type SingleNodeTaskOperationContext = Readonly<{
  assertCurrent(): void;
  canvasRevision: number;
  signal: AbortSignal;
  waitForRevision(): Promise<number>;
}>;

export interface SingleNodeGenerationLifecycle {
  abort(reason?: string): void;
  cancel(task: SingleNodeGenerationTaskReference): Promise<SingleNodeLifecycleResult>;
  generate(): Promise<SingleNodeLifecycleResult>;
  reconcile(task: SingleNodeGenerationTaskReference): Promise<SingleNodeLifecycleResult>;
  recover(task?: GenerationTaskSummary): Promise<SingleNodeLifecycleResult>;
  retry(task: SingleNodeGenerationTaskReference): Promise<SingleNodeLifecycleResult>;
}

function isBlocked(
  value: SingleNodeGenerationBlocked | SingleNodeGenerationPlan,
): value is SingleNodeGenerationBlocked {
  return "status" in value && value.status === "blocked";
}

function terminal(task: GenerationTaskSummary) {
  return task.state === "cancelled" || task.state === "failed" ||
    task.state === "success";
}

function isTaskReconcileResult(
  value: GenerationTaskSummary | SingleNodeTaskReconcileResult,
): value is SingleNodeTaskReconcileResult {
  return "outcome" in value && "task" in value;
}

export function createSingleNodeGenerationLifecycle(input: {
  adapter: SingleNodeGenerationAdapter;
  graph: CanvasGraphCommandPort;
  nodeId: string;
  randomUUID?: () => string;
  save: CanvasSavePort;
  tasks: SingleNodeGenerationTaskPort;
}): SingleNodeGenerationLifecycle {
  const randomUUID = input.randomUUID ?? (() => crypto.randomUUID());
  let operation = 0;
  let controller: AbortController | undefined;

  const begin = () => {
    operation += 1;
    controller?.abort("single-node-operation-replaced");
    controller = new AbortController();
    return { controller, operation };
  };
  const current = (candidate: number, signal: AbortSignal) =>
    candidate === operation && !signal.aborted;
  const readPlan = () => {
    const snapshot = input.graph.snapshot();
    const node = snapshot.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!node || node.type !== input.adapter.kind ||
      (typeof node.data.workflowExecutionRunId === "string" &&
        node.data.workflowExecutionRunId)) {
      return { message: "节点已不再允许单独生成", status: "blocked" } as const;
    }
    return input.adapter.readPlan(snapshot, input.nodeId);
  };
  const apply = (
    plan: SingleNodeGenerationPlan,
    task: GenerationTaskSummary | undefined,
    phase: "binding" | "prepare" | "terminal",
    runId: string,
    fallbackRevision?: number,
  ) => {
    const snapshot = input.graph.snapshot();
    const expectedRevision = Number.isSafeInteger(snapshot.revision)
      ? Number(snapshot.revision)
      : fallbackRevision;
    if (!Number.isSafeInteger(expectedRevision)) return false;
    const currentNode = snapshot.nodes.find((node) => node.id === input.nodeId);
    const currentTaskId = currentNode?.data[`${input.adapter.kind}GenerationTaskId`];
    const result = input.graph.apply({
      fence: {
        expectedRevision: Number(expectedRevision),
        kind: input.adapter.kind,
        nodeId: input.nodeId,
        ownershipKey: plan.ownershipKey,
        runId,
        ...(phase === "terminal" && task
          ? { taskId: task.id }
          : typeof currentTaskId === "string" && currentTaskId
            ? { taskId: currentTaskId }
            : {}),
      },
      scope: "generation",
      update: (currentSnapshot) => ({
        ...currentSnapshot,
        nodes: currentSnapshot.nodes.map((node) => node.id === input.nodeId
          ? phase === "prepare"
            ? input.adapter.applyPrepared?.(node, plan) ?? node
            : phase === "binding" && task
              ? input.adapter.applyBinding(node, task, plan)
              : task
                ? input.adapter.applyTerminal(node, task, plan)
                : node
          : node),
      }),
    });
    return result.status === "applied";
  };
  const graphStillOwned = (
    plan: SingleNodeGenerationPlan,
    task: GenerationTaskSummary,
    runId: string,
  ) => {
    const node = input.graph.snapshot().nodes.find(
      (candidate) => candidate.id === input.nodeId,
    );
    if (!node || node.type !== plan.kind) return false;
    const currentRunId = node.data.workflowExecutionRunId;
    const currentOwnershipKey = node.data[`${plan.kind}GenerationOwnershipKey`];
    const currentTaskId = node.data[`${plan.kind}GenerationTaskId`];
    return (!currentRunId || currentRunId === runId) &&
      (!currentOwnershipKey || currentOwnershipKey === plan.ownershipKey) &&
      (!currentTaskId || currentTaskId === task.id);
  };
  const flush = async () => {
    await input.save.flush();
    return input.save.waitForRevision();
  };
  const assertCurrentPlan = (plan: SingleNodeGenerationPlan) => {
    const currentPlan = readPlan();
    if (
      isBlocked(currentPlan) ||
      currentPlan.kind !== plan.kind ||
      currentPlan.nodeId !== plan.nodeId ||
      currentPlan.inputKey !== plan.inputKey ||
      currentPlan.ownershipKey !== plan.ownershipKey
    ) {
      throw new Error("生成输入已修改，已停止本次生成");
    }
  };
  const waitForCurrentRevision = async (
    plan: SingleNodeGenerationPlan,
    state: ReturnType<typeof begin>,
  ) => {
    const receipt = await input.save.waitForRevision();
    if (!current(state.operation, state.controller.signal)) {
      throw new DOMException("单节点生成操作已停止", "AbortError");
    }
    assertCurrentPlan(plan);
    return receipt.revision;
  };
  const finish = async (
    plan: SingleNodeGenerationPlan,
    task: GenerationTaskSummary,
    state: ReturnType<typeof begin>,
    runId: string,
    canvasRevision: number,
    refreshRevisionBeforeTerminal = false,
  ): Promise<SingleNodeLifecycleResult> => {
    if (!current(state.operation, state.controller.signal)) {
      return { reason: "stale", status: "stale" };
    }
    let finalTask = task;
    if (!terminal(finalTask)) {
      finalTask = await input.tasks.watch(finalTask, {
        assertCurrent: () => assertCurrentPlan(plan),
        canvasRevision,
        signal: state.controller.signal,
        waitForRevision: () => waitForCurrentRevision(plan, state),
      });
    }
    let terminalRevision = canvasRevision;
    if (refreshRevisionBeforeTerminal) {
      const observedRevision = input.graph.snapshot().revision;
      if (!Number.isSafeInteger(observedRevision) &&
        !graphStillOwned(plan, finalTask, runId)) {
        return { reason: "stale", status: "stale" };
      }
      terminalRevision = Number.isSafeInteger(observedRevision)
        ? Number(observedRevision)
        : await waitForCurrentRevision(plan, state);
    }
    if (!current(state.operation, state.controller.signal) ||
      !apply(plan, finalTask, "terminal", runId, terminalRevision)) {
      return { reason: "stale", status: "stale" };
    }
    await flush();
    if (finalTask.state === "success") return { status: "success", task: finalTask };
    if (finalTask.state === "cancelled") {
      return { status: "cancelled", task: finalTask };
    }
    return { status: "failed", task: finalTask };
  };
  const run = async (
    action: (
      plan: SingleNodeGenerationPlan,
      context: SingleNodeTaskOperationContext,
    ) => Promise<EnsuredGenerationTask | GenerationTaskSummary | undefined>,
  ): Promise<SingleNodeLifecycleResult> => {
    const state = begin();
    const planned = readPlan();
    if (isBlocked(planned)) return { reason: "blocked", status: "failed" };
    const runId = randomUUID();
    if (input.adapter.applyPrepared &&
      !apply(planned, undefined, "prepare", runId)) {
      return { reason: "stale", status: "stale" };
    }
    const receipt = await flush();
    if (!current(state.operation, state.controller.signal)) {
      return { reason: "stale", status: "stale" };
    }
    const result = await action(planned, {
      assertCurrent: () => assertCurrentPlan(planned),
      canvasRevision: receipt.revision,
      signal: state.controller.signal,
      waitForRevision: () => waitForCurrentRevision(planned, state),
    });
    if (!result) return { reason: "blocked", status: "failed" };
    const task = "task" in result ? result.task : result;
    if (!current(state.operation, state.controller.signal) ||
      !apply(planned, task, "binding", runId)) {
      return { reason: "stale", status: "stale" };
    }
    const bindingReceipt = await flush();
    return finish(planned, task, state, runId, bindingReceipt.revision);
  };

  /**
   * Existing-task operations preserve the legacy save gate: the task command
   * owns its single revision wait, binding is in-memory, and only the terminal
   * patch is durably flushed. Generate intentionally uses the three-boundary
   * path above because it must persist a model snapshot before admission.
   */
  const runExisting = async (
    action: (
      plan: SingleNodeGenerationPlan,
      context: SingleNodeTaskOperationContext,
    ) => Promise<
      GenerationTaskSummary | SingleNodeTaskReconcileResult | undefined
    >,
  ): Promise<SingleNodeLifecycleResult> => {
    const state = begin();
    const planned = readPlan();
    if (isBlocked(planned)) return { reason: "blocked", status: "failed" };
    const snapshot = input.graph.snapshot();
    const runId = randomUUID();
    const context: SingleNodeTaskOperationContext = {
      assertCurrent: () => assertCurrentPlan(planned),
      // Existing-task commands do not submit a new generation with this value.
      // A retry/reconcile command owns its waitForRevision gate below, while
      // cancel/recover can settle first and wait before their graph patch.
      canvasRevision: Number.isSafeInteger(snapshot.revision)
        ? Number(snapshot.revision)
        : 0,
      signal: state.controller.signal,
      waitForRevision: () => waitForCurrentRevision(planned, state),
    };
    const actionResult = await action(planned, context);
    if (!actionResult) return { reason: "blocked", status: "failed" };
    let reconcileResult: SingleNodeTaskReconcileResult | undefined;
    let task: GenerationTaskSummary;
    if (isTaskReconcileResult(actionResult)) {
      reconcileResult = actionResult;
      task = actionResult.task;
    } else {
      task = actionResult;
    }
    if (!current(state.operation, state.controller.signal)) {
      return { reason: "stale", status: "stale" };
    }
    if (
      reconcileResult &&
      reconcileResult.outcome !== "missing" &&
      reconcileResult.outcome !== "recovered"
    ) {
      return {
        reconcileOutcome: reconcileResult.outcome,
        status: "failed",
        task,
      };
    }
    if (!Number.isSafeInteger(input.graph.snapshot().revision)) {
      await waitForCurrentRevision(planned, state);
    }
    if (terminal(task)) {
      if (!apply(planned, task, "terminal", runId)) {
        return { reason: "stale", status: "stale" };
      }
      await flush();
      if (task.state === "success") {
        return {
          reconcileOutcome: reconcileResult?.outcome,
          status: "success",
          task,
        };
      }
      if (task.state === "cancelled") {
        return {
          reconcileOutcome: reconcileResult?.outcome,
          status: "cancelled",
          task,
        };
      }
      return {
        reconcileOutcome: reconcileResult?.outcome,
        status: "failed",
        task,
      };
    }
    const bindingRevision = Number(input.graph.snapshot().revision);
    if (!apply(planned, task, "binding", runId, bindingRevision)) {
      return { reason: "stale", status: "stale" };
    }
    const result = await finish(
      planned,
      task,
      state,
      runId,
      bindingRevision,
      true,
    );
    return reconcileResult
      ? { ...result, reconcileOutcome: reconcileResult.outcome }
      : result;
  };

  return {
    abort(reason = "single-node-operation-aborted") {
      operation += 1;
      controller?.abort(reason);
      controller = undefined;
    },
    cancel(task) {
      return runExisting((_plan, context) => input.tasks.cancel(task, context));
    },
    generate() {
      return run((plan, context) => input.tasks.ensure(plan, context));
    },
    reconcile(task) {
      return runExisting((plan, context) =>
        input.tasks.reconcile(task, plan, context)
      );
    },
    recover(task) {
      return runExisting(async (plan, context) =>
        task ?? await input.tasks.recover(plan, context)
      );
    },
    retry(task) {
      return runExisting((plan, context) => input.tasks.retry(task, plan, context));
    },
  };
}
