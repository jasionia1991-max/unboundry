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
  contractFingerprint: string;
  inputKey: string;
  kind: CanvasGenerationKind;
  modelConfigurationRevision: string;
  modelReleaseRevision: string;
  nodeId: string;
  ownershipKey: string;
  payload: unknown;
}>;

export type SingleNodeSemanticEditScope = Readonly<{
  accountId: string;
  canvasId: string;
  fixtureScopeId: string;
  kind: CanvasGenerationKind;
  nodeId: string;
}>;

const singleNodeSemanticEditVersions = new Map<string, number>();

function semanticEditScopeKey(scope: SingleNodeSemanticEditScope) {
  return JSON.stringify([
    scope.accountId,
    scope.canvasId,
    scope.fixtureScopeId,
    scope.kind,
    scope.nodeId,
  ]);
}

export function readSingleNodeSemanticEditVersion(
  scope: SingleNodeSemanticEditScope,
) {
  return singleNodeSemanticEditVersions.get(semanticEditScopeKey(scope)) ?? 0;
}

export function markSingleNodeSemanticEdit(scope: SingleNodeSemanticEditScope) {
  const key = semanticEditScopeKey(scope);
  const next = (singleNodeSemanticEditVersions.get(key) ?? 0) + 1;
  singleNodeSemanticEditVersions.set(key, next);
  return next;
}

export type SingleNodeGenerationBlocked = Readonly<{
  message: string;
  status: "blocked";
}>;

export type SingleNodeLifecycleResult = Readonly<{
  reconcileOutcome?: GenerationReconcileOutcome;
  reason?: "blocked" | "stale";
  status: "cancelled" | "failed" | "stale" | "submitted" | "success";
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
    plan: SingleNodeGenerationPlan,
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
  withSubmissionAdmission?<T>(
    plan: SingleNodeGenerationPlan,
    work: () => Promise<T>,
  ): Promise<T>;
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
  submit(): Promise<SingleNodeLifecycleResult>;
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

export function taskMatchesSingleNodeGenerationIdentity(
  task: GenerationTaskSummary,
  plan: Pick<
    SingleNodeGenerationPlan,
    "contractFingerprint" | "inputKey" | "modelConfigurationRevision" |
      "modelReleaseRevision" | "ownershipKey"
  >,
) {
  return task.generationIdentityVersion === 2 &&
    task.generationInputKey === plan.inputKey &&
    task.generationOwnershipKey === plan.ownershipKey &&
    task.modelConfigurationRevision === plan.modelConfigurationRevision &&
    task.modelReleaseRevision === plan.modelReleaseRevision &&
    task.modelInputContractFingerprint === plan.contractFingerprint;
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
  prepareSubmissionAdapter?: () => Promise<SingleNodeGenerationAdapter | void>;
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
  const readPlan = (adapter = input.adapter) => {
    const snapshot = input.graph.snapshot();
    const node = snapshot.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!node || node.type !== adapter.kind ||
      (typeof node.data.workflowExecutionRunId === "string" &&
        node.data.workflowExecutionRunId)) {
      return { message: "节点已不再允许单独生成", status: "blocked" } as const;
    }
    return adapter.readPlan(snapshot, input.nodeId);
  };
  const apply = (
    adapter: SingleNodeGenerationAdapter,
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
    const currentTaskId = currentNode?.data[`${adapter.kind}GenerationTaskId`];
    const result = input.graph.apply({
      fence: {
        expectedRevision: Number(expectedRevision),
        kind: adapter.kind,
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
            ? adapter.applyPrepared?.(node, plan) ?? node
            : phase === "binding" && task
              ? adapter.applyBinding(node, task, plan)
              : task
                ? adapter.applyTerminal(node, task, plan)
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
  const withCanvasAdmission = <T>(
    plan: SingleNodeGenerationPlan,
    work: () => Promise<T>,
  ) => input.tasks.withSubmissionAdmission
    ? input.tasks.withSubmissionAdmission(plan, work)
    : work();
  const assertCurrentPlan = (
    adapter: SingleNodeGenerationAdapter,
    plan: SingleNodeGenerationPlan,
  ) => {
    const currentPlan = readPlan(adapter);
    if (
      isBlocked(currentPlan) ||
      currentPlan.kind !== plan.kind ||
      currentPlan.nodeId !== plan.nodeId ||
      currentPlan.inputKey !== plan.inputKey ||
      currentPlan.modelConfigurationRevision !== plan.modelConfigurationRevision ||
      currentPlan.modelReleaseRevision !== plan.modelReleaseRevision ||
      currentPlan.contractFingerprint !== plan.contractFingerprint ||
      currentPlan.ownershipKey !== plan.ownershipKey
    ) {
      throw new Error("生成输入已修改，已停止本次生成");
    }
  };
  const waitForCurrentRevision = async (
    adapter: SingleNodeGenerationAdapter,
    plan: SingleNodeGenerationPlan,
    state: ReturnType<typeof begin>,
  ) => {
    const receipt = await input.save.waitForRevision();
    if (!current(state.operation, state.controller.signal)) {
      throw new DOMException("单节点生成操作已停止", "AbortError");
    }
    assertCurrentPlan(adapter, plan);
    return receipt.revision;
  };
  const finish = async (
    adapter: SingleNodeGenerationAdapter,
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
        assertCurrent: () => assertCurrentPlan(adapter, plan),
        canvasRevision,
        signal: state.controller.signal,
        waitForRevision: () => waitForCurrentRevision(adapter, plan, state),
      });
    }
    return withCanvasAdmission(plan, async () => {
      if (!current(state.operation, state.controller.signal)) {
        return { reason: "stale", status: "stale" };
      }
      assertCurrentPlan(adapter, plan);
      let terminalRevision = canvasRevision;
      if (refreshRevisionBeforeTerminal) {
        const observedRevision = input.graph.snapshot().revision;
        if (!Number.isSafeInteger(observedRevision) &&
          !graphStillOwned(plan, finalTask, runId)) {
          return { reason: "stale", status: "stale" };
        }
        terminalRevision = Number.isSafeInteger(observedRevision)
          ? Number(observedRevision)
          : await waitForCurrentRevision(adapter, plan, state);
      }
      if (!current(state.operation, state.controller.signal) ||
        !apply(adapter, plan, finalTask, "terminal", runId, terminalRevision)) {
        return { reason: "stale", status: "stale" };
      }
      await flush();
      if (finalTask.state === "success") {
        return { status: "success", task: finalTask };
      }
      if (finalTask.state === "cancelled") {
        return { status: "cancelled", task: finalTask };
      }
      return { status: "failed", task: finalTask };
    });
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
    const admissionPlan: SingleNodeGenerationPlan = planned;
    const runId = randomUUID();
    const admitted = await withCanvasAdmission(admissionPlan, prepareAndBind);
    if ("result" in admitted) return admitted.result;
    return finish(
      admitted.adapter,
      admitted.plan,
      admitted.task,
      state,
      runId,
      admitted.bindingRevision,
    );

    async function prepareAndBind(): Promise<
      | { result: SingleNodeLifecycleResult }
      | {
          adapter: SingleNodeGenerationAdapter;
          bindingRevision: number;
          plan: SingleNodeGenerationPlan;
          task: GenerationTaskSummary;
        }
    > {
      if (!current(state.operation, state.controller.signal)) {
        return { result: { reason: "stale", status: "stale" } };
      }
      const adapter = await input.prepareSubmissionAdapter?.() ?? input.adapter;
      const preparedPlan = readPlan(adapter);
      if (isBlocked(preparedPlan)) {
        return { result: { reason: "blocked", status: "failed" } };
      }
      const plan: SingleNodeGenerationPlan = preparedPlan;
      assertCurrentPlan(adapter, plan);
      if (adapter.applyPrepared &&
        !apply(adapter, plan, undefined, "prepare", runId)) {
        return { result: { reason: "stale", status: "stale" } };
      }
      const receipt = await flush();
      if (!current(state.operation, state.controller.signal)) {
        return { result: { reason: "stale", status: "stale" } };
      }
      const result = await action(plan, {
        assertCurrent: () => assertCurrentPlan(adapter, plan),
        canvasRevision: receipt.revision,
        signal: state.controller.signal,
        waitForRevision: () => waitForCurrentRevision(adapter, plan, state),
      });
      if (!result) {
        return { result: { reason: "blocked", status: "failed" } };
      }
      const task = "task" in result ? result.task : result;
      assertCurrentPlan(adapter, plan);
      if (!taskMatchesSingleNodeGenerationIdentity(task, plan) ||
        !current(state.operation, state.controller.signal) ||
        !apply(adapter, plan, task, "binding", runId)) {
        return { result: { reason: "stale", status: "stale" } };
      }
      const bindingReceipt = await flush();
      return {
        adapter,
        bindingRevision: bindingReceipt.revision,
        plan,
        task,
      };
    }
  };

  const submit = async (): Promise<SingleNodeLifecycleResult> => {
    const state = begin();
    const planned = readPlan();
    if (isBlocked(planned)) return { reason: "blocked", status: "failed" };
    const admissionPlan: SingleNodeGenerationPlan = planned;
    const runId = randomUUID();
    return withCanvasAdmission(admissionPlan, prepareAndSubmit);

    async function prepareAndSubmit(): Promise<SingleNodeLifecycleResult> {
      if (!current(state.operation, state.controller.signal)) {
        return { reason: "stale", status: "stale" };
      }
      const adapter = await input.prepareSubmissionAdapter?.() ?? input.adapter;
      const preparedPlan = readPlan(adapter);
      if (isBlocked(preparedPlan)) {
        return { reason: "blocked", status: "failed" };
      }
      const plan: SingleNodeGenerationPlan = preparedPlan;
      assertCurrentPlan(adapter, plan);
      if (adapter.applyPrepared &&
        !apply(adapter, plan, undefined, "prepare", runId)) {
        return { reason: "stale", status: "stale" };
      }
      const receipt = await flush();
      if (!current(state.operation, state.controller.signal)) {
        return { reason: "stale", status: "stale" };
      }
      const ensured = await input.tasks.ensure(plan, {
        assertCurrent: () => assertCurrentPlan(adapter, plan),
        canvasRevision: receipt.revision,
        signal: state.controller.signal,
        waitForRevision: () => waitForCurrentRevision(adapter, plan, state),
      });
      const task = ensured.task;
      assertCurrentPlan(adapter, plan);
      if (!taskMatchesSingleNodeGenerationIdentity(task, plan) ||
        !current(state.operation, state.controller.signal) ||
        !apply(adapter, plan, task, "binding", runId)) {
        return { reason: "stale", status: "stale" };
      }
      await flush();
      return { status: "submitted", task };
    }
  };

  /**
   * Existing-task provider commands run outside the Canvas admission, while
   * every binding or terminal graph mutation reacquires that admission and is
   * durably flushed before it is released. Generate keeps its prepare, submit,
   * accepted binding, and binding flush inside one admission boundary.
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
      assertCurrent: () => assertCurrentPlan(input.adapter, planned),
      // Existing-task commands do not submit a new generation with this value.
      // A retry/reconcile command owns its waitForRevision gate below, while
      // cancel/recover can settle first and wait before their graph patch.
      canvasRevision: Number.isSafeInteger(snapshot.revision)
        ? Number(snapshot.revision)
        : 0,
      signal: state.controller.signal,
      waitForRevision: () => waitForCurrentRevision(input.adapter, planned, state),
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
    if (!taskMatchesSingleNodeGenerationIdentity(task, planned) ||
      !current(state.operation, state.controller.signal)) {
      return { reason: "stale", status: "stale" };
    }
    if (
      reconcileResult &&
      reconcileResult.outcome !== "recovered"
    ) {
      return {
        reconcileOutcome: reconcileResult.outcome,
        status: "failed",
        task,
      };
    }
    const committed = await withCanvasAdmission(planned, async () => {
      assertCurrentPlan(input.adapter, planned);
      if (!Number.isSafeInteger(input.graph.snapshot().revision)) {
        await waitForCurrentRevision(input.adapter, planned, state);
      }
      if (terminal(task)) {
        const terminalRevision = Number(input.graph.snapshot().revision);
        if (!apply(
          input.adapter,
          planned,
          task,
          "terminal",
          runId,
          terminalRevision,
        )) return { status: "stale" as const };
        await flush();
        return { status: "terminal" as const };
      }
      const bindingRevision = Number(input.graph.snapshot().revision);
      if (!apply(input.adapter, planned, task, "binding", runId, bindingRevision)) {
        return { status: "stale" as const };
      }
      const receipt = await flush();
      return { bindingRevision: receipt.revision, status: "bound" as const };
    });
    if (committed.status === "stale") {
      return { reason: "stale", status: "stale" };
    }
    if (committed.status === "terminal") {
      if (task.state === "success") {
        return { reconcileOutcome: reconcileResult?.outcome, status: "success", task };
      }
      if (task.state === "cancelled") {
        return { reconcileOutcome: reconcileResult?.outcome, status: "cancelled", task };
      }
      return { reconcileOutcome: reconcileResult?.outcome, status: "failed", task };
    }
    const result = await finish(
      input.adapter,
      planned,
      task,
      state,
      runId,
      committed.bindingRevision,
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
      return runExisting((plan, context) =>
        input.tasks.cancel(task, plan, context)
      );
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
    submit,
  };
}
