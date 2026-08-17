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

const generationErrorCodeMessages: Record<
  string,
  string | ((kind: GenerationMessageKind) => string)
> = {
  ACCOUNT_CREDENTIAL_CHANGED: "你的平台密钥已变更，请重新提交生成",
  ACCOUNT_CREDENTIAL_INVALID: "你的平台密钥无效，请到「我的连接」更新后再试",
  ACCOUNT_CREDENTIAL_MISSING: "未配置你的平台密钥，请到「我的连接」填写后再试",
  ADAPTER_UNSUPPORTED: "该模型尚未接入安全生成服务，请联系管理员",
  CANVAS_NOT_SAVED: "画布内容还在保存，请等待自动保存完成后再试",
  EMERGENCY_STOP: "管理员已紧急停止真实生成",
  GENERATION_DISABLED: "管理员已关闭真实生成",
  GENERATION_FAILED: "生成失败，请稍后再试",
  GENERATION_TASK_NOT_FOUND: "生成任务不存在或已过期，请重新提交",
  GENERATION_UNAVAILABLE: "当前暂时无法创建生成任务",
  GLOBAL_DISABLED: "管理员已关闭真实生成",
  GLOBAL_GENERATION_DISABLED: "管理员已关闭真实生成",
  IDEMPOTENCY_CONFLICT: "生成任务关联不一致，请修改内容后再试",
  INPUT_INVALID: "生成参数不符合要求，请检查节点设置",
  INPUT_SCHEMA_UNSUPPORTED: "生成参数版本与当前模型不匹配，请重新选择模型",
  KIND_CONCURRENCY: "同类型生成任务已达上限，请等待当前任务完成",
  MODEL_UNAVAILABLE: "该模型暂时不能生成，请联系管理员检查模型配置",
  MODEL_UNSUPPORTED: "当前模型不支持该生成方式，请更换模型",
  OUTPUT_COUNT_UNSUPPORTED: "当前模型不支持该生成数量，请调整后重试",
  PROVIDER_AUTH_FAILED: (kind) =>
    `${kind === "text" ? "文字" : kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}模型连接异常，请联系管理员检查平台连接`,
  PROVIDER_CANCEL_UNAVAILABLE: "模型平台暂不支持取消，任务会继续保存结果",
  PROVIDER_CANCELLED: "生成任务已取消",
  PROVIDER_COOLDOWN: "模型服务连续失败，请稍后再试",
  PROVIDER_CONFIGURATION_MISMATCH: "平台连接配置已变化，请刷新页面后重新提交",
  PROVIDER_DRIVER_MISMATCH: "平台连接配置不匹配，请联系管理员",
  PROVIDER_FAILED: "模型平台未完成本次生成，请重试",
  PROVIDER_PROFILE_MISSING: "平台安全配置缺失，请联系管理员",
  PROVIDER_REQUEST_FAILED:
    "已向模型提交，但请求未完成；为避免重复扣费，本次不会自动重提",
  PROVIDER_RECOVERY_ATTEMPT_USED: "模型配置更新后的恢复尝试已使用，请等待结果或联系管理员",
  PROVIDER_REVERIFY_REQUIRED: "平台连接资料已更新，请管理员完成只读连接检查",
  PROVIDER_RESULT_FORMAT: "模型已响应，但结果无法安全识别；本次不会自动重提",
  RATE_LIMIT: "操作太频繁，请稍后再试",
  REFERENCE_SIGN_FAILED: "参考图临时链接创建失败，本次没有向模型提交",
  REFERENCE_STORAGE_BUSY: "参考图临时存储繁忙，本次没有向模型提交",
  REFERENCE_UPLOAD_FAILED: "参考图临时上传失败，本次没有向模型提交",
  PROVIDER_RESULT_MISSING: "平台没有成片，可以重试",
  RECONCILE_RATE_LIMIT: "核对太频繁，请稍后再试",
  RETRY_OUTCOME_UNKNOWN:
    "上次结果还没对上，为避免重复扣费，请先点「核对结果」，不要重新生成",
  RETRY_SNAPSHOT_CHANGED: "任务快照已变化，不能继续旧任务，请重新提交",
  RETRY_SNAPSHOT_INCOMPATIBLE: "任务快照与当前节点不兼容，请重新提交",
  SERVICE_RESTARTED: "服务刚刚重启，任务状态已恢复，请重新检查",
  TASK_NOT_FAILED: "只有失败任务可以重试",
  USER_CANCELLED: "生成任务已取消",
  USER_CONCURRENCY: "同时运行的生成任务太多，请等待完成后再试",
};

export function friendlyGenerationCodeMessage(
  code: string | undefined,
  kind: GenerationMessageKind,
): string | undefined {
  if (!code) return undefined;
  const mapped = generationErrorCodeMessages[code];
  if (typeof mapped === "function") return mapped(kind);
  return mapped;
}

/**
 * One friendly Chinese message for any generation error. Server messages that
 * are already short Chinese are kept; long English runs, technical tokens and
 * unknown raw provider text are replaced with a short per-kind fallback.
 */
export function friendlyGenerationMessage(
  message: string | undefined,
  kind: GenerationMessageKind,
  code?: string,
): string {
  const trimmed = (message ?? "").trim();
  if (!trimmed) {
    return friendlyGenerationCodeMessage(code, kind) ?? friendlyFallbacks[kind];
  }
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
  const coded = friendlyGenerationCodeMessage(code, kind);
  if (coded) return coded;
  return friendlyFallbacks[kind];
}

export function generationMessageFallback(kind: GenerationMessageKind) {
  return friendlyFallbacks[kind];
}
