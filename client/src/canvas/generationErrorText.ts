import {
  friendlyGenerationCodeMessage,
  friendlyGenerationMessage,
  type GenerationMessageKind,
} from "../generation/friendlyGenerationMessage";
import { sanitizeProviderDiagnostic } from "../generation/generationErrors";

/**
 * Plain-Chinese explanation of a generation task / workflow error for the
 * task panel and other non-node surfaces. Node components keep using
 * `friendlyGenerationMessage` directly so their existing wording is unchanged.
 *
 * `summary` says what happened, `action` says what the user can do, and
 * `detail` holds the sanitized original code/message for a "详情" disclosure.
 */
export type GenerationErrorText = Readonly<{
  action?: string;
  detail?: string;
  summary: string;
}>;

type CodeEntry = Readonly<{
  action?: string;
  /** Generic codes: a specific friendly Chinese server message wins. */
  preferServerMessage?: boolean;
  summary: string | ((kind: GenerationMessageKind | undefined) => string);
}>;

const kindLabel = (kind: GenerationMessageKind | undefined) =>
  kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : kind === "text" ? "文字" : "";

const libraryProjectionConflict: CodeEntry = {
  action: "可点“放到画布”把结果放回画布",
  summary: "结果已保存到素材库，但画布已被改动，没有自动放回原节点",
};

const timeoutEntry: CodeEntry = {
  action: "请稍后查看结果，或点“核对结果”；不要重复提交",
  preferServerMessage: true,
  summary: "等待模型平台响应超时",
};

const contentPolicyEntry: CodeEntry = {
  action: "请修改提示词或参考素材后重试",
  summary: "内容未通过平台安全审核",
};

const codeEntries: Readonly<Record<string, CodeEntry>> = {
  AUTOMATIC_RECOVERY_PENDING: {
    action: "不会重复付费提交；可稍后点“核对结果”或联系管理员",
    summary: "原请求记录已保留，等待后续处理",
  },
  AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED: {
    action: "不会重复付费提交；可稍后点“核对结果”或联系管理员",
    summary: "自动找回已超过最长等待时间，原请求记录已保留",
  },
  AUTOMATIC_RESULT_RECOVERY: {
    action: "无需操作，不会重复扣费",
    summary: "系统正在自动找回平台结果",
  },
  CANVAS_GENERATION_PROJECTION_CONFLICT: libraryProjectionConflict,
  CANVAS_PROJECTION_FAILED: {
    action: "结果在素材库中，可点“放到画布”手动放回",
    summary: "结果没能自动写回画布",
  },
  CANVAS_PROJECTION_PENDING: {
    summary: "结果正在写回画布",
  },
  CANVAS_SERVER_OWNERSHIP_CONFLICT: libraryProjectionConflict,
  CANVAS_WORKFLOW_PROJECTION_STALE: {
    action: "结果在素材库中，可手动放到画布",
    summary: "画布已变化，结果没有自动写回",
  },
  EMERGENCY_STOP: {
    action: "请联系管理员",
    summary: "管理员已紧急停止真实生成",
  },
  GENERATION_FAILED: {
    action: "可稍后重试",
    preferServerMessage: true,
    summary: "生成失败",
  },
  GENERATION_HTTP_RESPONSE_TIMEOUT: timeoutEntry,
  GENERATION_RESPONSE_TIMEOUT: timeoutEntry,
  INSUFFICIENT_BALANCE: {
    action: "请充值或联系管理员后再试",
    summary: "模型平台余额不足",
  },
  INSUFFICIENT_STORAGE: {
    action: "请清理素材或联系管理员",
    summary: "存储空间不足，结果暂时无法保存",
  },
  MEDIA_RESULT_DISCARDED: {
    action: "如仍需要结果，请重新生成",
    summary: "这个结果已被清理，没有保留",
  },
  NETWORK_ERROR: {
    action: "系统会自动重试，也可稍后点“核对结果”",
    preferServerMessage: true,
    summary: "网络连接不稳定",
  },
  OPERATOR_INCIDENT: {
    action: "不会重复扣费；可联系管理员核对，或在允许时放弃平台结果后重新生成",
    summary: "长时间没有拿到平台结果，系统已停止自动找回，交由管理员核对",
  },
  OSS_IDENTITY_QUARANTINED: {
    action: "请联系管理员检查存储设置；不会重复扣费",
    summary: "结果存储暂时异常，已暂停保存以免出错",
  },
  OUTCOME_UNKNOWN_BILLING_RISK: {
    action: "请等待自动找回，不要重复提交",
    summary: "模型平台可能已经受理或扣费，结果暂时无法确认",
  },
  PROVIDER_CANCELLED: { action: "如仍需要结果，可重新生成", summary: "任务已取消" },
  PROVIDER_FAILED: {
    action: "可点“重试”重新生成",
    preferServerMessage: true,
    summary: "模型平台未完成本次生成",
  },
  PROVIDER_TERMINAL: {
    action: "可重新生成",
    preferServerMessage: true,
    summary: "模型平台已结束该任务，没有返回结果",
  },
  PUBLICATION_MISSING: {
    action: "可重新运行该节点",
    summary: "原生成任务没有可用的已保存结果，下游节点未运行",
  },
  RATE_LIMIT: { action: "请稍后再试", summary: "模型平台正在限流" },
  RECONCILE_RATE_LIMIT: { action: "请稍后查看", summary: "系统正在自动找回结果" },
  REJECTED_MINOR_OR_SENSITIVE: contentPolicyEntry,
  REQUEST_TIMEOUT: timeoutEntry,
  RESULT_DELAYED: { action: "无需操作", summary: "系统正在处理，稍后会自动继续保存结果" },
  RESULT_SAVE_FAILED_NO_RETRY: {
    action: "不会重复提交；请联系管理员核对",
    summary: (kind) => `${kindLabel(kind) || "生成"}平台已返回结果，但系统未能安全保存，本轮已自动停止`,
  },
  SERVICE_SHUTTING_DOWN: { action: "请稍后再试", summary: "服务正在更新重启" },
  TASK_STATUS_TIMEOUT: timeoutEntry,
  TIMEOUT: timeoutEntry,
  UNKNOWN_ERROR: {
    action: "可稍后重试，或联系管理员",
    preferServerMessage: true,
    summary: "发生了未知错误",
  },
  UPSTREAM_FAILED: { action: "先处理上游节点后再运行", summary: "上游节点没有成功，这个节点未运行" },
  USER_ABANDONED: {
    action: "如仍需要结果，请重新生成（会产生新的费用）",
    summary: "你已放弃这个平台结果，系统不再尝试找回",
  },
  USER_CANCELLED: { action: "如仍需要结果，可重新生成", summary: "任务已取消" },
  WORKFLOW_NODE_DEADLINE_EXCEEDED: {
    action: "如果稍后生成成功，结果会出现在素材库，不会重复扣费",
    summary: "该节点超过最长等待时间仍未完成，已停止等待",
  },
  WORKFLOW_STOP_REQUESTED: { action: "如需继续，可重新运行", summary: "整组执行已停止" },
};

const messagePatterns: ReadonlyArray<Readonly<{ entry: CodeEntry; pattern: RegExp }>> = [
  {
    entry: contentPolicyEntry,
    pattern: /sensitive|content.?policy|moderation|safety.?(check|system|filter)|审核|违规|敏感/i,
  },
  { entry: codeEntries.RATE_LIMIT, pattern: /rate.?limit|too many requests|\b429\b|限流/i },
  { entry: codeEntries.INSUFFICIENT_BALANCE, pattern: /insufficient.?(balance|quota|credit)|余额不足/i },
  { entry: timeoutEntry, pattern: /timed?.?out|timeout|deadline exceeded|超时/i },
  { entry: codeEntries.NETWORK_ERROR, pattern: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|network|fetch failed|socket hang up/i },
];

const technicalPattern =
  /(request\s*id|error\s*code|exception|stack|trace|undefined|null|\[\w+\]|https?:\/\/|\bat\s+\S+\s+\()/i;

/** True for short Chinese text that is safe to show to the owner as-is. */
export function isFriendlyChineseMessage(message: string | null | undefined) {
  const trimmed = message?.trim() ?? "";
  return Boolean(trimmed) &&
    /[\u3400-\u9fff]/.test(trimmed) &&
    !/[a-zA-Z]{20,}/.test(trimmed) &&
    !technicalPattern.test(trimmed) &&
    !trimmed.includes("\n") &&
    trimmed.length <= 120;
}

function asKind(kind: string | null | undefined): GenerationMessageKind | undefined {
  return kind === "audio" || kind === "image" || kind === "text" || kind === "video"
    ? kind
    : undefined;
}

function resolveEntry(entry: CodeEntry, kind: GenerationMessageKind | undefined) {
  return typeof entry.summary === "function" ? entry.summary(kind) : entry.summary;
}

function diagnosticDetail(code: string | undefined, message: string, summary: string) {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? "";
  const sanitized = sanitizeProviderDiagnostic(firstLine);
  const parts: string[] = [];
  if (code) parts.push(`错误代码：${code}`);
  if (sanitized && sanitized !== summary) parts.push(`原始信息：${sanitized}`);
  return parts.length > 0 ? parts.join("；") : undefined;
}

export function generationTaskErrorText(input: Readonly<{
  code?: string | null;
  kind?: string | null;
  message?: string | null;
}>): GenerationErrorText {
  const code = input.code?.trim() || undefined;
  const message = input.message?.trim() ?? "";
  const kind = asKind(input.kind);
  const entry = code ? codeEntries[code] : undefined;
  let summary: string;
  let action: string | undefined;
  if (entry && !(entry.preferServerMessage && isFriendlyChineseMessage(message))) {
    summary = resolveEntry(entry, kind);
    action = entry.action;
  } else if (isFriendlyChineseMessage(message)) {
    summary = message;
    action = entry?.action;
  } else {
    const pattern = messagePatterns.find(({ pattern }) => pattern.test(`${code ?? ""} ${message}`));
    if (pattern) {
      summary = resolveEntry(pattern.entry, kind);
      action = pattern.entry.action;
    } else {
      const coded = friendlyGenerationCodeMessage(code, kind ?? "image");
      summary = coded ??
        (kind ? friendlyGenerationMessage(message, kind, code) : "生成失败，请稍后再试");
    }
  }
  const detail = diagnosticDetail(code, message, summary);
  return {
    ...(action ? { action } : {}),
    ...(detail ? { detail } : {}),
    summary,
  };
}

/** One line: summary plus suggested action. */
export function generationTaskErrorLine(input: Parameters<typeof generationTaskErrorText>[0]) {
  const text = generationTaskErrorText(input);
  return text.action ? `${text.summary}。${text.action}` : text.summary;
}

/**
 * Message for a thrown request error. Friendly Chinese server text is kept so
 * existing wording (and the tests asserting it) stays intact; English or
 * technical text is replaced by a mapped code or the caller's fallback.
 */
export function userFacingErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (isFriendlyChineseMessage(message)) return message.trim();
  const code = typeof error === "object" && error !== null && "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
  const entry = code ? codeEntries[code] : undefined;
  if (entry) return resolveEntry(entry, undefined);
  return fallback;
}
