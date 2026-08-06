export type GenerationMessageKind = "audio" | "image" | "text" | "video";

const friendlyFallbacks: Record<GenerationMessageKind, string> = {
  audio: "音频生成失败，请稍后再试",
  image: "图片生成失败，请稍后再试",
  text: "文字生成失败，请稍后再试",
  video: "视频生成失败，请稍后再试",
};

const friendlySubstitutions: ReadonlyArray<{
  message: string;
  pattern: RegExp;
}> = [
  {
    message: "今日费用额度已用完，请明天再试，或联系管理员调整上限",
    pattern: /费用保护已阻止本次任务/,
  },
  {
    message: "画布还在保存，请稍等保存完成后再试",
    pattern: /画布内容还在保存/,
  },
  {
    message: "画布刚发生变化，请等待自动保存完成后再试",
    pattern: /Prompt与已保存画布不一致/,
  },
  {
    message: "素材尚未保存成功，请重新上传后再试",
    pattern: /不存在、尚未保存或不属于当前账号/,
  },
  {
    message: "画布保存超时，请稍后再试",
    pattern: /画布保存超时/,
  },
  {
    message: "画布保存状态异常，请刷新页面后重试",
    pattern: /画布保存状态异常/,
  },
  {
    message: "操作太频繁，请稍后再试",
    pattern: /请求过于频繁/,
  },
  {
    message: "同类型生成任务已达上限，请等待当前任务完成",
    pattern: /当前类型的运行任务已达到上限/,
  },
  {
    message: "同时运行的生成任务太多，请等待完成后再试",
    pattern: /当前运行任务已达到用户上限/,
  },
  {
    message: "模型服务暂时不稳定，请稍后再试",
    pattern: /模型服务连续失败|暂时不可用|暂时无法/,
  },
  {
    message: "本次生成费用暂时无法确认，已为你安全拦截",
    pattern: /本次任务费用无法确认/,
  },
  {
    message: "该模型暂时不能生成，请联系管理员检查模型配置",
    pattern: /当前模型尚未接入安全生成服务/,
  },
  {
    message: "文字模型连接异常，请联系管理员检查平台连接",
    pattern: /文字模型授权或权限校验失败/,
  },
  {
    message: "图片模型连接异常，请联系管理员检查平台连接",
    pattern: /图片模型授权或权限校验失败/,
  },
  {
    message: "视频模型连接异常，请联系管理员检查平台连接",
    pattern: /视频模型授权或权限校验失败/,
  },
  {
    message: "音频模型连接异常，请联系管理员检查平台连接",
    pattern: /音频模型授权或权限校验失败/,
  },
  {
    message: "平台连接资料已更新，请管理员完成只读连接检查",
    pattern: /平台连接资料已更新，请管理员完成只读连接检查/,
  },
  {
    message: "模型平台正在限流，请稍后再试",
    pattern: /rate.?limit|限流|too many requests/i,
  },
  {
    message: "模型平台余额或配额不足",
    pattern: /insufficient|余额|quota/i,
  },
  {
    message: "当前平台连接没有该模型的使用权限",
    pattern: /forbidden|permission|no access|授权|权限/i,
  },
  {
    message: "请求参数不符合模型平台要求",
    pattern: /InvalidParameter|not valid|BadRequest/i,
  },
  {
    message: "参考素材不符合模型要求，请检查素材后重试",
    pattern: /duration|时长|between 2 and 15|总时长|pixel count|总像素|分辨率过低/i,
  },
];

const technicalPattern = /(request\s*id|error\s*code|exception|stack|trace|undefined|null|\[\w+\]|http[s]?:\/\/)/i;

/**
 * One friendly Chinese message for any generation error. Server messages that
 * are already short Chinese are kept; long English runs, technical tokens and
 * unknown raw provider text are replaced with a short per-kind fallback.
 */
export function friendlyGenerationMessage(
  message: string | undefined,
  kind: GenerationMessageKind,
): string {
  const trimmed = (message ?? "").trim();
  if (!trimmed) return friendlyFallbacks[kind];
  for (const item of friendlySubstitutions) {
    if (item.pattern.test(trimmed)) return item.message;
  }
  const hasChinese = /[\u3400-\u9fff]/.test(trimmed);
  const hasLongEnglishRun = /[a-zA-Z]{20,}/.test(trimmed);
  const hasTechnicalText = technicalPattern.test(trimmed);
  if (
    hasChinese &&
    !hasLongEnglishRun &&
    !hasTechnicalText &&
    trimmed.length <= 80
  ) {
    return trimmed;
  }
  return friendlyFallbacks[kind];
}

export function generationMessageFallback(kind: GenerationMessageKind) {
  return friendlyFallbacks[kind];
}
