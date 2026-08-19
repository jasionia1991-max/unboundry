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

export function generationOutcomeUnknown(errorCode?: string | null) {
  return errorCode === "RETRY_OUTCOME_UNKNOWN";
}

export function generationNeedsReconcile(
  errorCode?: string | null,
  retryBlockCode?: string | null,
) {
  return errorCode === "RETRY_OUTCOME_UNKNOWN" ||
    errorCode === "PROVIDER_RESULT_MISSING" ||
    errorCode === "PROVIDER_FAILED" ||
    errorCode === "PROVIDER_REQUEST_FAILED" ||
    errorCode === "TIMEOUT" ||
    retryBlockCode === "RETRY_OUTCOME_UNKNOWN";
}

/**
 * 只有明确拒绝（权限/限流/参数/余额等）或本地可修的问题才算“红字”。
 * 超时、结果不明、平台没出片、下载失败等一律走中性提示。
 */
export function generationFailureIsDefinitive(errorCode?: string | null) {
  if (!errorCode) return false;
  return new Set([
    "ACCOUNT_CREDENTIAL_CHANGED",
    "ACCOUNT_CREDENTIAL_INVALID",
    "ACCOUNT_CREDENTIAL_MISSING",
    "AUTH",
    "CANVAS_NOT_SAVED",
    "EMERGENCY_STOP",
    "FORMAT",
    "GLOBAL_DISABLED",
    "INPUT_INVALID",
    "KIND_CONCURRENCY",
    "MODEL_UNAVAILABLE",
    "PERMISSION",
    "PROVIDER_COOLDOWN",
    "PROVIDER_CONFIGURATION_MISMATCH",
    "PROVIDER_RESULT_FORMAT",
    "RATE_LIMIT",
    "RETRY_SNAPSHOT_CHANGED",
    "RETRY_SNAPSHOT_INCOMPATIBLE",
    "USER_CONCURRENCY",
  ]).has(errorCode);
}

export function generationRetryVisible(input: {
  confirmedMissing?: boolean;
  errorCode?: string | null;
  retryAvailable: boolean;
}) {
  return input.retryAvailable && (
    !generationOutcomeUnknown(input.errorCode) ||
    input.confirmedMissing === true
  );
}
