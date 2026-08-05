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

/**
 * Provider errors are shown as a short Chinese summary with the platform's
 * original text kept for support/debugging. Messages that are already local
 * (Chinese) are treated as friendly and do not repeat a raw copy.
 */
export function providerErrorParts(value: string | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return { raw: "", summary: "" };
  const hasLongEnglishRun = /[a-zA-Z]{20,}/.test(raw);
  const hasChinese = /[\u3400-\u9fff]/.test(raw);
  if (hasChinese && !hasLongEnglishRun && !/Request id/i.test(raw)) {
    return { raw: "", summary: raw };
  }
  for (const { pattern, summary } of providerErrorPatterns) {
    if (pattern.test(raw)) return { raw, summary };
  }
  return {
    raw,
    summary: "模型平台拒绝了本次请求，可点击“查看原文”了解具体原因",
  };
}
