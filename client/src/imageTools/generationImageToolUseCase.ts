import type {
  SingleNodeGenerationLifecycle,
  SingleNodeGenerationTaskReference,
} from "../generation/singleNodeGenerationLifecycle";

export type GenerationImageToolOperation =
  | "enhance-conservative"
  | "enhance-creative"
  | "erase"
  | "multi-angle"
  | "outpaint"
  | "redraw"
  | "remove-background";

export type GenerationImageToolAction =
  | Readonly<{ action: "cancel" | "reconcile" | "retry"; taskId: string }>
  | Readonly<{ action: "generate" | "recover" | "submit" }>;

export function createGenerationImageToolUseCase(input: Readonly<{
  lifecycle: SingleNodeGenerationLifecycle;
  operation: GenerationImageToolOperation;
}>) {
  return {
    operation: input.operation,
    async execute(command: GenerationImageToolAction) {
      const reference = "taskId" in command
        ? { id: command.taskId } satisfies SingleNodeGenerationTaskReference
        : undefined;
      const result = command.action === "generate"
        ? await input.lifecycle.generate()
        : command.action === "submit"
          ? await input.lifecycle.submit()
        : command.action === "recover"
          ? await input.lifecycle.recover()
          : command.action === "cancel"
            ? await input.lifecycle.cancel(reference!)
            : command.action === "reconcile"
              ? await input.lifecycle.reconcile(reference!)
              : await input.lifecycle.retry(reference!);
      if (!result.task) {
        throw new Error(
          result.reason === "stale"
            ? "图片工具任务所有权已变化"
            : "图片工具任务没有持久任务证据",
        );
      }
      return {
        kind: "generation-task",
        operation: input.operation,
        ...(result.task.resultAssetId
          ? { resultAssetId: result.task.resultAssetId }
          : {}),
        taskId: result.task.id,
      } as const;
    },
  } as const;
}
