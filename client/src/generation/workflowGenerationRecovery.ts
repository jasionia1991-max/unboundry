import {
  generationNeedsReconcile,
  safelyRetryableGenerationTask,
} from "./generationRetry";
import {
  GenerationRequestError,
  getGenerationTask,
  reconcileGenerationTask,
  reconcileOutcomeMessage,
  retryGenerationTask,
  waitForGenerationTask,
  type GenerationRetryGate,
  type GenerationTaskKind,
  type GenerationTaskSummary,
} from "./generationTasks";

/**
 * “平台连接正在处理中”是临时锁忙，不是失败：有界自动重试几次，
 * 尽量不让用户看到需要手动操作的提示。
 */
async function withLockBusyRetry<T>(operation: () => Promise<T>): Promise<T> {
  const attempts = 3;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt < attempts - 1 &&
        error instanceof GenerationRequestError &&
        error.code === "PROVIDER_LOCK_BUSY"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      throw error;
    }
  }
}

export function workflowRecoveryPlan(task: {
  errorCode?: string | null;
  retryAllowed?: boolean;
  retryBlockCode?: string | null;
  attempt?: number;
  state: string;
}) {
  if (task.state === "success") return "success" as const;
  if (task.state !== "failed") return "skip" as const;
  // 系统自动重试整个生命周期只有一次（attempt >= 2 说明已经重试过）。
  if (task.retryAllowed === true && (task.attempt ?? 1) < 2) {
    return "retry" as const;
  }
  if (generationNeedsReconcile(task.errorCode, task.retryBlockCode)) {
    return "reconcile" as const;
  }
  return "stop" as const;
}

export async function recoverWorkflowGenerationOnce(input: {
  accountId: string;
  canvasId: string;
  fixtureScopeId: string;
  generationInputKey: string;
  kind: GenerationTaskKind;
  nodeId: string;
  taskId: string;
  waitForCanvasRevision: GenerationRetryGate;
}): Promise<{
  message?: string;
  status: "failed" | "skipped" | "success";
  task?: GenerationTaskSummary;
}> {
  let task = await getGenerationTask(
    input.taskId,
    undefined,
    input.fixtureScopeId,
  );
  if (
    !task.generationOwnershipKey ||
    !task.modelInputContractFingerprint ||
    !task.modelConfigurationRevision ||
    !task.modelReleaseRevision
  ) {
    return {
      message: "历史任务缺少冻结模型合同身份，系统只保留原任务，不自动重试",
      status: "failed",
      task,
    };
  }
  const target = {
    accountId: input.accountId,
    canvasId: input.canvasId,
    fixtureScopeId: input.fixtureScopeId,
    generationInputKey: input.generationInputKey,
    generationOwnershipKey: task.generationOwnershipKey,
    kind: input.kind,
    modelInputContractFingerprint: task.modelInputContractFingerprint,
    modelConfigurationRevision: task.modelConfigurationRevision,
    modelReleaseRevision: task.modelReleaseRevision,
    nodeId: input.nodeId,
    taskId: input.taskId,
  };
  const plan = workflowRecoveryPlan(task);
  if (plan === "success") return { status: "success", task };
  if (plan === "skip") return { status: "skipped", task };

  if (plan === "reconcile") {
    const result = await withLockBusyRetry(() =>
      reconcileGenerationTask(
        target,
        input.waitForCanvasRevision,
      ),
    );
    if (result.outcome === "recovered") {
      const finished = await waitForGenerationTask(
        result.task.id,
        undefined,
        input.fixtureScopeId,
      );
      return finished.state === "success"
        ? { status: "success", task: finished }
        : {
            message: finished.errorMessage,
            status: "failed",
            task: finished,
          };
    }
    return {
      message: reconcileOutcomeMessage(result.outcome) || result.task.errorMessage,
      status: "failed",
      task: result.task,
    };
  }

  if (!safelyRetryableGenerationTask(task) || task.attempt >= 2) {
    return {
      message: task.errorMessage,
      status: "failed",
      task,
    };
  }

  const accepted = await withLockBusyRetry(() =>
    retryGenerationTask(target, input.waitForCanvasRevision),
  );
  const finished = await waitForGenerationTask(
    accepted.id,
    undefined,
    input.fixtureScopeId,
  );
  if (finished.state === "success") return { status: "success", task: finished };
  return {
    message: finished.errorMessage,
    status: "failed",
    task: finished,
  };
}
