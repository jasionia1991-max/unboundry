const historicalPreTaskConfigurationErrors = new Set([
  "Generation provider is not configured",
]);

/**
 * Old clients persisted a server configuration rejection as if a paid task
 * had failed. Hide only the exact known pre-task message; real task failures
 * and media errors remain untouched.
 */
export function visibleGenerationError(value: string | undefined) {
  const message = value?.trim() ?? "";
  return historicalPreTaskConfigurationErrors.has(message) ? "" : message;
}

const legacyLocalVideoInputErrorCodes = new Set([
  "COMBINATION_UNSUPPORTED",
  "ROLE_CONFLICT",
  "ROLE_UNSUPPORTED",
]);

/**
 * A few old canvases persisted a local input-role rejection without ever
 * creating or binding a task. Clear only that narrow historical shape after
 * the current model/input resolver proves the same node is now valid.
 */
export function shouldClearStaleVideoInputError(input: Readonly<{
  canSubmit: boolean;
  error?: string;
  errorCode?: string;
  identityBindings: readonly unknown[];
}>) {
  return input.canSubmit &&
    Boolean(input.error?.trim()) &&
    legacyLocalVideoInputErrorCodes.has(input.errorCode ?? "") &&
    input.identityBindings.every((value) => !value);
}

export type GenerationNoticeTone = "blocking" | "recovering" | "failed";

/**
 * Keep the visual treatment tied to the real state boundary. The provider's
 * wording is presentation data and must not decide whether a task is failed,
 * retryable, or safe to charge again.
 */
export function generationNoticeTone(input: Readonly<{
  code?: string | null;
  inputBlocked?: boolean;
  message?: string;
  recovering?: boolean;
}>): GenerationNoticeTone {
  if (input.inputBlocked) return "blocking";
  if (input.recovering) return "recovering";
  if (input.message && /正在|自动找回|安全保存|暂时无法|无法确认|查询中|等待|核对|重连/.test(input.message)) {
    return "recovering";
  }
  if (input.message && /输入已修改|合同已变化|节点.*不允许|未创建.*任务/.test(input.message)) {
    return "blocking";
  }
  if (input.code === "INPUT_INVALID" ||
    input.code === "MODEL_UNAVAILABLE" ||
    input.code === "CANVAS_NOT_SAVED" ||
    input.code === "ACCOUNT_CREDENTIAL_MISSING" ||
    input.code === "ACCOUNT_CREDENTIAL_INVALID" ||
    input.code === "PROVIDER_CONFIGURATION_MISMATCH") {
    return "blocking";
  }
  if (input.code === "TASK_STATUS_NETWORK_ERROR" ||
    input.code === "TASK_STATUS_TIMEOUT" ||
    input.code === "TASK_STATUS_INVALID_RESPONSE" ||
    input.code === "POLLING_PAUSED" ||
    input.code === "SERVICE_RESTARTED" ||
    input.code === "PROVIDER_RESULT_MISSING" ||
    input.code === "OUTCOME_UNKNOWN_BILLING_RISK" ||
    input.code === "RETRY_OUTCOME_UNKNOWN" ||
    input.code === "PROVIDER_REQUEST_FAILED" ||
    input.code === "TIMEOUT" ||
    input.code === "RESULT_DELAYED" ||
    input.code === "CANVAS_PROJECTION_PENDING" ||
    input.code === "CANVAS_PROJECTION_FAILED") {
    return "recovering";
  }
  return "failed";
}

const providerErrorPatterns: ReadonlyArray<{
  pattern: RegExp;
  summary: string;
}> = [
  {
    pattern: /pixel count|总像素|分辨率过低/i,
    summary: "参考视频分辨率不符合模型要求（总像素需 409600～8295044，例如 640×640 或 1280×720）",
  },
  {
    pattern: /duration|时长|between 2 and 15|2至15秒|总时长/i,
    summary: "参考素材时长不符合模型要求",
  },
  {
    pattern: /rate.?limit|限流|too many requests/i,
    summary: "模型平台正在限流，请稍后再试",
  },
  {
    pattern: /InvalidParameter|not valid|BadRequest/i,
    summary: "请求参数不符合模型平台要求",
  },
  {
    pattern: /insufficient|余额|quota/i,
    summary: "模型平台余额或配额不足",
  },
  {
    pattern: /forbidden|permission|no access/i,
    summary: "当前平台连接没有该模型的使用权限",
  },
];

const providerDiagnosticMaxLength = 2_000;

/**
 * Provider text is useful for support only after it has crossed the browser
 * UI boundary. Strip credentials, cookies, request bodies, and URLs before
 * allowing it into the expandable/copyable diagnostic block.
 */
export function sanitizeProviderDiagnostic(value: string | undefined) {
  const normalized = value?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .trim() ?? "";
  if (!normalized) return "";
  const redacted = normalized
    .replace(/(?:https?|wss?):\/\/[^\s<]+/gi, "[地址已隐藏]")
    .replace(/\b(?:data|blob):[^\s<]+/gi, "[地址已隐藏]")
    .replace(/((?:authorization|cookie|set-cookie|x-api-key|api[-_ ]?key|access[-_ ]?key|secret|token|password|signature|signed[-_ ]?url)["']?\s*(?:[:=]\s*|\s+))(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[已隐藏]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [已隐藏]")
    .replace(/\b(?:sk|rk|ak|pk)-[A-Za-z0-9_-]{8,}\b/gi, "[凭据已隐藏]");
  if (redacted.length <= providerDiagnosticMaxLength) return redacted;
  return `${redacted.slice(0, providerDiagnosticMaxLength)}…`;
}

/**
 * Provider errors are shown as a short Chinese summary with the platform's
 * original text kept for support/debugging. Messages that are already local
 * (Chinese) are treated as friendly and do not repeat a raw copy.
 */
export function providerErrorParts(value: string | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return { raw: "", summary: "" };
  const sanitized = sanitizeProviderDiagnostic(raw);
  const hasLongEnglishRun = /[a-zA-Z]{20,}/.test(raw);
  const hasChinese = /[\u3400-\u9fff]/.test(raw);
  if (hasChinese && sanitized.length <= 180 && !hasLongEnglishRun && !/Request id/i.test(raw)) {
    return { raw: "", summary: sanitized };
  }
  for (const { pattern, summary } of providerErrorPatterns) {
    if (pattern.test(raw)) return { raw: sanitized, summary };
  }
  return {
    raw: sanitized,
    summary: "模型平台返回了暂未分类的错误，可点击“查看原文”了解具体原因",
  };
}
