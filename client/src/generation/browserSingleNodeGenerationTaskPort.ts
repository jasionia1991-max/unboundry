import {
  cancelGenerationTask,
  ensureGenerationTask,
  getGenerationTask,
  reconcileGenerationTask,
  recoverPendingGenerationTask,
  retryGenerationTask,
  runWithSingleNodeGenerationAdmission,
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
import { taskMatchesSingleNodeGenerationIdentity } from
  "./singleNodeGenerationLifecycle";

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
  accountId: string,
  fixtureScopeId: string,
) {
  const payload = recoverableInput(plan);
  return {
    accountId,
    canvasId: payload.canvasId,
    fixtureScopeId,
    generationInputKey: plan.inputKey,
    generationOwnershipKey: plan.ownershipKey,
    kind: plan.kind,
    modelInputContractFingerprint: plan.contractFingerprint,
    modelConfigurationRevision: plan.modelConfigurationRevision,
    modelReleaseRevision: plan.modelReleaseRevision,
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
  fixtureScopeId: string;
  onTaskObserved?: (task: GenerationTaskSummary) => void;
  onPollingPaused?: (taskId: string) => void;
}): SingleNodeGenerationTaskPort {
  let submissionAdmissionDepth = 0;
  return {
    async cancel(task, plan, context) {
      context.assertCurrent();
      const existing = await getGenerationTask(
        task.id,
        context.signal,
        input.fixtureScopeId,
      );
      const payload = recoverableInput(plan);
      if (
        existing.canvasId !== payload.canvasId ||
        existing.kind !== plan.kind ||
        existing.nodeId !== plan.nodeId ||
        !taskMatchesSingleNodeGenerationIdentity(existing, plan)
      ) {
        throw new Error("生成任务合同已变化，已停止取消旧任务");
      }
      context.assertCurrent();
      const cancelled = await cancelGenerationTask(
        task.id,
        context.signal,
        input.fixtureScopeId,
      );
      return cancelled.state === "cancelled" ? cancelled : undefined;
    },
    async ensure(plan, context) {
      const payload = recoverableInput(plan);
      const ensured = await ensureGenerationTask(
        plan.kind,
        { ...payload, canvasRevision: context.canvasRevision },
        input.accountId,
        context.assertCurrent,
        {
          canvasAdmissionAlreadyHeld: submissionAdmissionDepth > 0,
          generationInputKey: plan.inputKey,
          generationOwnershipKey: plan.ownershipKey,
          modelInputContractFingerprint: plan.contractFingerprint,
          modelConfigurationRevision: plan.modelConfigurationRevision,
          modelReleaseRevision: plan.modelReleaseRevision,
          fixtureScopeId: input.fixtureScopeId,
        },
      );
      input.onTaskObserved?.(ensured.task);
      return ensured;
    },
    async reconcile(task, plan, context) {
      const result = await reconcileGenerationTask(
        retryTarget(task, plan, input.accountId, input.fixtureScopeId),
        revisionGate(context),
        undefined,
        context.signal,
      );
      input.onTaskObserved?.(result.task);
      return result;
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
        {
          generationInputKey: plan.inputKey,
          generationOwnershipKey: plan.ownershipKey,
          modelInputContractFingerprint: plan.contractFingerprint,
          modelConfigurationRevision: plan.modelConfigurationRevision,
          modelReleaseRevision: plan.modelReleaseRevision,
          fixtureScopeId: input.fixtureScopeId,
        },
      );
      if (task) input.onTaskObserved?.(task);
      return task;
    },
    async retry(task, plan, context) {
      const retried = await retryGenerationTask(
        retryTarget(task, plan, input.accountId, input.fixtureScopeId),
        revisionGate(context),
        context.signal,
        context.assertCurrent,
      );
      input.onTaskObserved?.(retried);
      return retried;
    },
    watch(task, context) {
      return waitForGenerationTaskWithPause(
        task.id,
        () => input.onPollingPaused?.(task.id),
        context.signal,
        input.fixtureScopeId,
      );
    },
    withSubmissionAdmission(plan, work) {
      const payload = recoverableInput(plan);
      return runWithSingleNodeGenerationAdmission({
        accountId: input.accountId,
        canvasId: payload.canvasId,
        fixtureScopeId: input.fixtureScopeId,
      }, plan.nodeId, async () => {
        submissionAdmissionDepth += 1;
        try {
          return await work();
        } finally {
          submissionAdmissionDepth -= 1;
        }
      });
    },
  };
}
