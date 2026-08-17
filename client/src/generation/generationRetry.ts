import type { ModelParameterValue } from "../../../types/modelParameters";
import type { ResolvedNodeInput } from "../../../types/nodeInputs";
import type { GenerationTaskSummary } from "./generationTasks";
import {
  friendlyGenerationMessage,
  type GenerationMessageKind,
} from "./friendlyGenerationMessage";

export const RETRY_OUTCOME_UNKNOWN_MESSAGE =
  "上次结果还没对上，为避免重复扣费，请先点「核对结果」，不要重新生成";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

/**
 * The retry binding deliberately excludes canvasRevision. Autosave changes the
 * revision, but only a real Provider input change may detach an old task.
 */
export function generationInputKey(input: {
  inputs: readonly ResolvedNodeInput[];
  modelId?: string;
  ownPrompt?: string;
  parameters: Record<string, ModelParameterValue>;
  prompt: string;
}) {
  return JSON.stringify(stableValue({
    inputs: input.inputs.map((item) => ({
      assetId: item.assetId,
      edgeId: item.edgeId,
      kind: item.kind,
      order: item.order,
      role: item.role,
      sourceNodeId: item.sourceNodeId,
      state: item.state,
      text: item.text,
    })),
    modelId: input.modelId,
    ownPrompt: input.ownPrompt?.trim() ?? "",
    parameters: input.parameters,
    prompt: input.prompt.trim(),
  }));
}

export function generationRetryBlockReason(
  task: Pick<
    GenerationTaskSummary,
    "retryAllowed" | "retryBlockReason" | "state"
  >,
) {
  if (task.state !== "failed") return "只有失败任务可以重试";
  if (task.retryAllowed === true) return "";
  return task.retryBlockReason || "当前失败任务不能安全重试";
}

export function generationFailureMessage(
  message: string,
  retryBlockReason?: string,
  errorCode?: string,
  kind?: GenerationMessageKind,
) {
  const visible = errorCode && kind
    ? friendlyGenerationMessage(message, kind, errorCode)
    : message;
  if (!retryBlockReason || visible.includes(retryBlockReason)) return visible;
  return `${visible}；${retryBlockReason}`;
}

export function safelyRetryableGenerationTask(
  task: GenerationTaskSummary,
) {
  return task.state === "failed" && task.retryAllowed === true;
}
