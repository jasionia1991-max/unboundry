export { generationInputKey } from "../../../types/generationIdentity";
import type { GenerationTaskSummary } from "./generationTasks";
import {
  friendlyGenerationMessage,
  type GenerationMessageKind,
} from "./friendlyGenerationMessage";

export const RETRY_OUTCOME_UNKNOWN_MESSAGE =
  "上次结果仍在自动找回中；为避免重复扣费，当前不能重新生成";

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
  return errorCode === "RETRY_OUTCOME_UNKNOWN" ||
    errorCode === "OUTCOME_UNKNOWN_BILLING_RISK";
}

export function generationNeedsReconcile(
  errorCode?: string | null,
  retryBlockCode?: string | null,
) {
  return errorCode === "RETRY_OUTCOME_UNKNOWN" ||
    errorCode === "OUTCOME_UNKNOWN_BILLING_RISK" ||
    errorCode === "PROVIDER_RESULT_MISSING" ||
    errorCode === "PROVIDER_FAILED" ||
    errorCode === "PROVIDER_REQUEST_FAILED" ||
    errorCode === "TIMEOUT" ||
    errorCode === "RESULT_DELAYED" ||
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
    "RATE_LIMIT",
    "RETRY_SNAPSHOT_CHANGED",
    "RETRY_SNAPSHOT_INCOMPATIBLE",
    "USER_CONCURRENCY",
  ]).has(errorCode);
}

export function generationRetryVisible(input: {
  errorCode?: string | null;
  retryAvailable: boolean;
}) {
  return input.retryAvailable && !generationOutcomeUnknown(input.errorCode);
}
