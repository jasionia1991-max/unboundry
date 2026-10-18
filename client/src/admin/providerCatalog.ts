import { type ModelCapability } from "../../../types/modelParameters";
import {
  relayProviderProtocols,
  providerProtocolSupportsCapability,
  type ProviderProtocol,
} from "../../../types/relayProtocols";
import {
  type AdminProviderDiscoveredModel,
  type AdminProviderModelCatalog,
  type AdminProviderProfile,
  type ProviderDriver,
} from "./adminTypes";

export const providerDriverDetails: Record<
  ProviderDriver,
  { baseUrl: string; description: string; label: string }
> = {
  mureka: {
    baseUrl: "https://api.mureka.ai",
    description: "歌曲、纯音乐及后续音乐处理模型",
    label: "Mureka",
  },
  "multi-protocol-relay": {
    baseUrl: "",
    description: "统一接入 OpenAI、Claude、Gemini 与媒体生成协议",
    label: "多协议中转站",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    description: "统一管理文字、图片及后续可用模型",
    label: "OpenRouter",
  },
  "volcengine-ark": {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    description: "豆包、Seedream、Seedance 等火山方舟模型",
    label: "火山方舟",
  },
  "openai-compatible": {
    baseUrl: "",
    description: "适合提供标准 OpenAI 接口的私人中转站",
    label: "OpenAI 兼容中转站",
  },
};

export const providerProtocolLabels: Record<ProviderProtocol, string> = {
  native: "平台原生协议",
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  "claude-messages": "Claude Messages",
  "gemini-generate-content": "Gemini GenerateContent",
  "gpt-image": "GPT Image",
  "media-generate": "媒体生成",
};

export function providerBaseUrlEditable(driver: ProviderDriver) {
  return driver === "openai-compatible" || driver === "multi-protocol-relay";
}

export function relayProtocolsForCapability(capability: ModelCapability) {
  return relayProviderProtocols.filter((protocol) =>
    providerProtocolSupportsCapability(protocol, capability),
  );
}

export function providerKeyStatusLabel(status: AdminProviderProfile["keyStatus"]) {
  if (status === "valid") return "Key有效";
  if (status === "invalid") return "Key已失效";
  if (status === "unknown") return "暂时无法确认";
  return "Key未检查";
}

export function providerKeyCheckedAt(value?: string) {
  if (!value) return "";
  const checkedAt = new Date(value);
  if (Number.isNaN(checkedAt.getTime())) return "";
  return `上次检查：${checkedAt.toLocaleString("zh-CN", {
    hour12: false,
  })}`;
}

type ProviderCatalogCapabilities = {
  credentialMode: "none" | "profile-api-key" | "separate";
  description: string;
  endpointLabel: string;
  modelLabel: string;
  scope: "account" | "manual" | "public";
  support: "full" | "manual" | "models" | "unsupported";
  supported: boolean;
  supportsEndpoints: boolean;
  supportsImport: boolean;
  supportsSync: boolean;
};

export function providerCatalogCapabilities(
  profile: AdminProviderProfile,
  catalog: AdminProviderModelCatalog,
): ProviderCatalogCapabilities {
  if (
    catalog.support &&
    catalog.credentialMode &&
    catalog.scope &&
    typeof catalog.supported === "boolean"
  ) {
    return {
      credentialMode: catalog.credentialMode,
      description:
        catalog.description || "读取平台可用的模型资料。",
      endpointLabel: catalog.endpointLabel || "Endpoint",
      modelLabel: catalog.modelLabel || "平台模型",
      scope: catalog.scope,
      support: catalog.support,
      supported: catalog.supported,
      supportsEndpoints: Boolean(catalog.supportsEndpoints),
      supportsImport: Boolean(catalog.supportsImport),
      supportsSync: Boolean(catalog.supportsSync),
    };
  }

  // 旧版方舟返回值没有能力字段，仅在此做兼容。新平台必须由服务端明确声明能力。
  if (profile.driver === "volcengine-ark") {
    return {
      credentialMode: "separate",
      description: "读取火山方舟的官方模型和当前账号Endpoint。",
      endpointLabel: "Endpoint",
      modelLabel: "官方模型",
      scope: "account",
      support: "full",
      supported: true,
      supportsEndpoints: true,
      supportsImport: true,
      supportsSync: true,
    };
  }

  return {
    credentialMode: "none",
    description: "该平台的模型目录能力尚未加载。",
    endpointLabel: "Endpoint",
    modelLabel: "平台模型",
    scope: "manual",
    support: "unsupported",
    supported: false,
    supportsEndpoints: false,
    supportsImport: false,
    supportsSync: false,
  };
}

export function providerCatalogStatusLabel(
  catalog: AdminProviderModelCatalog,
  capabilities: ProviderCatalogCapabilities,
  loading: boolean,
) {
  if (loading) return "正在同步目录…";
  if (capabilities.support === "manual") return "管理员配置";
  if (!capabilities.supported) return "平台不支持";
  if (catalog.keyStatus === "valid") {
    return capabilities.credentialMode === "separate"
      ? "目录凭证有效"
      : "目录可读取";
  }
  if (catalog.keyStatus === "invalid") {
    return capabilities.credentialMode === "separate"
      ? "目录凭证已失效"
      : "Key已失效";
  }
  if (catalog.keyStatus === "permission") return "凭证可用，读取权限不足";
  if (catalog.keyStatus === "unknown") return "目录状态暂时无法确认";
  return capabilities.credentialMode === "separate"
    ? "目录凭证未检查"
    : "目录尚未检查";
}

export function providerCatalogDate(value?: string) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function providerCatalogSnapshotSourceLabel(
  source: AdminProviderModelCatalog["catalogSource"],
) {
  if (source === "enhanced") return "全量增强目录";
  if (source === "enhanced+basic") return "完整组合目录";
  if (source === "basic-fallback") return "兼容目录（仅聊天模型）";
  return "";
}

export function providerCatalogFallbackMessage(
  catalog: AdminProviderModelCatalog,
) {
  if (catalog.catalogSource !== "basic-fallback") return "";
  if (catalog.fallbackReason === "NOT_SUPPORTED") {
    return "平台不支持全量增强目录，当前使用兼容目录，仅显示聊天模型。";
  }
  if (catalog.fallbackReason === "EMPTY") {
    return "全量增强目录没有返回可用模型，当前使用兼容目录，仅显示聊天模型。";
  }
  return "当前使用兼容目录，仅显示聊天模型。";
}

export function providerCatalogCompletenessMessage(
  catalog: AdminProviderModelCatalog,
) {
  const rejected = catalog.rejectedModelCount ?? 0;
  const reported = catalog.reportedModelCount;
  const countLabel = catalog.catalogSource === "enhanced+basic"
    ? "合并后"
    : "平台报告";
  if (rejected > 0) {
    return `${countLabel} ${reported ?? catalog.modelCount + rejected} 个，已保存 ${catalog.modelCount} 个；${rejected} 条格式不完整记录未进入目录。`;
  }
  if (
    typeof reported === "number" &&
    Number.isFinite(reported) &&
    reported !== catalog.modelCount
  ) {
    return `${countLabel} ${reported} 个，已保存 ${catalog.modelCount} 个，数量尚未完全对齐。`;
  }
  return "";
}

export function providerCatalogCapabilityLabel(
  capability: AdminProviderDiscoveredModel["capability"],
) {
  if (capability === "text") return "文字";
  if (capability === "image") return "图片";
  if (capability === "video") return "视频";
  if (capability === "audio") return "音频";
  return "待选择";
}

export function providerCatalogSourceLabel(
  source: string,
  scope: ProviderCatalogCapabilities["scope"],
) {
  const normalized = source.toLowerCase();
  if (normalized.includes("endpoint")) return "当前账号Endpoint";
  if (
    normalized.includes("account") ||
    normalized.includes("user") ||
    normalized.includes("openrouter")
  ) {
    return "当前Key可见目录";
  }
  if (
    normalized.includes("foundation") ||
    normalized.includes("official") ||
    normalized.includes("control-plane")
  ) {
    return "官方目录";
  }
  if (scope === "public") return "公共目录";
  if (scope === "account") return "当前账号目录";
  return "平台目录";
}

function providerCatalogModalityLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "text") return "文字";
  if (normalized === "image") return "图片";
  if (normalized === "video") return "视频";
  if (normalized === "audio") return "音频";
  return value.trim().slice(0, 24);
}

export function providerCatalogModelMetadata(
  metadata?: AdminProviderDiscoveredModel["metadata"],
) {
  if (!metadata) return [];
  const items: string[] = [];
  const input = metadata.inputModalities
    ?.slice(0, 4)
    .map(providerCatalogModalityLabel)
    .filter(Boolean);
  const output = metadata.outputModalities
    ?.slice(0, 4)
    .map(providerCatalogModalityLabel)
    .filter(Boolean);
  if (input?.length) items.push(`输入：${input.join("/")}`);
  if (output?.length) items.push(`输出：${output.join("/")}`);
  if (metadata.modelType?.trim()) {
    items.push(`类型：${metadata.modelType.trim().slice(0, 36)}`);
  }
  const protocols = metadata.protocols
    ?.filter((protocol) => protocol !== "native")
    .slice(0, 4)
    .map((protocol) => providerProtocolLabels[protocol]);
  if (protocols?.length) items.push(`协议：${protocols.join("/")}`);
  if (
    typeof metadata.contextLength === "number" &&
    Number.isFinite(metadata.contextLength) &&
    metadata.contextLength > 0
  ) {
    items.push(`上下文：${Math.floor(metadata.contextLength).toLocaleString("zh-CN")}`);
  }
  const pricing = metadata.pricingSummary?.trim() || metadata.pricingHint?.trim();
  if (pricing) {
    items.push(`价格：${pricing.slice(0, 80)}`);
  }
  if (metadata.supportedParameters?.length) {
    items.push(
      `参数：${metadata.supportedParameters
        .slice(0, 4)
        .map((item) => item.trim().slice(0, 24))
        .filter(Boolean)
        .join("/")}`,
    );
  }
  return items.slice(0, 5);
}

export function discoveredRelayProtocols(model: AdminProviderDiscoveredModel) {
  return (model.metadata?.protocols ?? []).filter(
    (protocol): protocol is Exclude<ProviderProtocol, "native"> =>
      relayProviderProtocols.includes(
        protocol as Exclude<ProviderProtocol, "native">,
      ),
  );
}

export function relayProtocolOptionsForModel(
  model: AdminProviderDiscoveredModel,
  capability?: ModelCapability,
) {
  const declared = discoveredRelayProtocols(model);
  return (declared.length ? declared : relayProviderProtocols).filter(
    (protocol) =>
      !capability || providerProtocolSupportsCapability(protocol, capability),
  );
}

export function discoveredModelAcceptsRelayProtocol(
  model: AdminProviderDiscoveredModel,
  protocol: Exclude<ProviderProtocol, "native"> | undefined,
  capability?: ModelCapability,
) {
  return Boolean(
    protocol && relayProtocolOptionsForModel(model, capability).includes(protocol),
  );
}

export function providerCatalogRemoteStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized || normalized === "unknown") return "未知";
  if (normalized === "published") return "已发布";
  if (
    normalized === "available" ||
    normalized === "active" ||
    normalized === "enabled" ||
    normalized === "ready"
  ) {
    return "可用";
  }
  if (normalized === "running" || normalized === "online") return "运行中";
  if (
    normalized === "creating" ||
    normalized === "deploying" ||
    normalized === "pending" ||
    normalized === "starting" ||
    normalized === "updating"
  ) {
    return "处理中";
  }
  if (
    normalized === "stopped" ||
    normalized === "offline" ||
    normalized === "disabled"
  ) {
    return "已停止";
  }
  if (normalized === "deprecated" || normalized === "retired") return "已下线";
  if (normalized === "failed" || normalized === "error") return "异常";
  return status.trim();
}

export const emptyProviderModelCatalog: AdminProviderModelCatalog = {
  configuredModelCount: 0,
  controlRequestCount: 0,
  endpointCount: 0,
  hasCredentials: false,
  keyStatus: "unchecked",
  modelCount: 0,
  snapshotStale: false,
};

export const providerCatalogPageSize = 50;
export const providerCatalogSelectionLimit = 100;
