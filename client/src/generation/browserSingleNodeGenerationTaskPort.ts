import {
  cancelGenerationTask,
  ensureGenerationTask,
  reconcileGenerationTask,
  recoverPendingGenerationTask,
  retryGenerationTask,
  reconcileOutcomeMessage,
  type GenerationTaskSummary,
  type RecoverableGenerationInput,
} from "./generationTasks";
import {
  waitForGenerationTaskWithPause,
} from "./taskPolling";
import type {
  SingleNodeGenerationPlan,
  SingleNodeGenerationTaskReference,
  SingleNodeGenerationTaskPort,
  SingleNodeTaskOperationContext,
} from "./singleNodeGenerationLifecycle";

function recoverableInput(plan: SingleNodeGenerationPlan) {
  if (!plan.payload || typeof plan.payload !== "object") {
    throw new Error("生成输入不完整");
  }
  const payload = plan.payload as Partial<RecoverableGenerationInput>;
  if (payload.canvasId === undefined || payload.nodeId === undefined) {
    throw new Error("生成输入缺少画布或节点标识");
  }
  if (payload.nodeId !== plan.nodeId) {
    throw new Error("生成输入与当前节点不一致");
  }
  return payload as RecoverableGenerationInput;
}

function retryTarget(
  task: SingleNodeGenerationTaskReference,
  plan: SingleNodeGenerationPlan,
) {
  const payload = recoverableInput(plan);
  return {
    canvasId: payload.canvasId,
    generationInputKey: plan.inputKey,
    kind: plan.kind,
    nodeId: plan.nodeId,
    taskId: task.id,
  } as const;
}

function revisionGate(context: SingleNodeTaskOperationContext) {
  return async () => {
    context.assertCurrent();
    return context.waitForRevision();
  };
}

/** Browser HTTP adapter. The lifecycle remains framework- and transport-free. */
export function createBrowserSingleNodeGenerationTaskPort(input: {
  accountId: string;
  onTaskObserved?: (task: GenerationTaskSummary) => void;
  onPollingPaused?: (taskId: string) => void;
}): SingleNodeGenerationTaskPort {
  return {
    async cancel(task, context) {
      context.assertCurrent();
      const cancelled = await cancelGenerationTask(task.id, context.signal);
      return cancelled.state === "cancelled" ? cancelled : undefined;
    },
    async ensure(plan, context) {
      const payload = recoverableInput(plan);
      const ensured = await ensureGenerationTask(
        plan.kind,
        { ...payload, canvasRevision: context.canvasRevision },
        input.accountId,
        context.assertCurrent,
        { generationOwnershipKey: plan.ownershipKey },
      );
      input.onTaskObserved?.(ensured.task);
      return ensured;
    },
    async reconcile(task, plan, context) {
      const result = await reconcileGenerationTask(
        retryTarget(task, plan),
        revisionGate(context),
        undefined,
        context.signal,
      );
      input.onTaskObserved?.(result.task);
      return result.outcome === "missing"
        ? {
            ...result,
            task: {
              ...result.task,
              errorCode: "PROVIDER_RESULT_MISSING",
              errorMessage: reconcileOutcomeMessage(result.outcome),
              retryAllowed: true,
              retryBlockCode: undefined,
              retryBlockReason: undefined,
              state: "failed",
            },
          }
        : result;
    },
    async recover(plan, context) {
      const payload = recoverableInput(plan);
      context.assertCurrent();
      const task = await recoverPendingGenerationTask(
        plan.kind,
        payload.canvasId,
        plan.nodeId,
        context.signal,
        payload,
        input.accountId,
        { generationOwnershipKey: plan.ownershipKey },
      );
      if (task) input.onTaskObserved?.(task);
      return task;
    },
    async retry(task, plan, context) {
      const retried = await retryGenerationTask(
        retryTarget(task, plan),
        revisionGate(context),
        context.signal,
      );
      input.onTaskObserved?.(retried);
      return retried;
    },
    watch(task, context) {
      return waitForGenerationTaskWithPause(
        task.id,
        () => input.onPollingPaused?.(task.id),
        context.signal,
      );
    },
  };
}
