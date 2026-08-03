import type { ProviderDriver } from "./providerProfiles";
import type { RelayReadOnlyResource } from "./multiProtocolRelay";

export type ProviderCatalogSupport =
  | "full"
  | "manual"
  | "models"
  | "unsupported";

export type ProviderCatalogCredentialMode =
  | "none"
  | "profile-api-key"
  | "separate";

export type ProviderCatalogScope = "account" | "manual" | "public";

export type ProviderCatalogCapabilities = {
  credentialMode: ProviderCatalogCredentialMode;
  description: string;
  endpointLabel?: string;
  modelLabel: string;
  scope: ProviderCatalogScope;
  support: ProviderCatalogSupport;
  supported: boolean;
  supportsEndpoints: boolean;
  supportsImport: boolean;
  supportsReadOnlyManagement: boolean;
  supportsSync: boolean;
  readOnlyResources: RelayReadOnlyResource[];
};

const capabilities: Record<ProviderDriver, ProviderCatalogCapabilities> = {
  "volcengine-ark": {
    credentialMode: "separate",
    description: "读取火山方舟的官方模型和当前账号Endpoint。",
    endpointLabel: "Endpoint",
    modelLabel: "官方模型",
    scope: "account",
    support: "full",
    supported: true,
    supportsEndpoints: true,
    supportsImport: true,
    supportsReadOnlyManagement: false,
    supportsSync: true,
    readOnlyResources: [],
  },
  openrouter: {
    credentialMode: "profile-api-key",
    description: "读取当前API Key可见的OpenRouter模型；不包含方舟式Endpoint。",
    modelLabel: "当前Key可见模型",
    scope: "account",
    support: "models",
    supported: true,
    supportsEndpoints: false,
    supportsImport: true,
    supportsReadOnlyManagement: false,
    supportsSync: true,
    readOnlyResources: [],
  },
  "openai-compatible": {
    credentialMode: "profile-api-key",
    description: "读取平台公开的基础模型列表；能力和参数不完整时由管理员确认。",
    modelLabel: "公共基础模型",
    scope: "public",
    support: "models",
    supported: true,
    supportsEndpoints: false,
    supportsImport: true,
    supportsReadOnlyManagement: false,
    supportsSync: true,
    readOnlyResources: [],
  },
  "multi-protocol-relay": {
    credentialMode: "profile-api-key",
    description: "优先读取扩展模型目录，并可安全查看余额、用量、价格和任务状态。",
    modelLabel: "当前Key可见模型",
    scope: "account",
    support: "models",
    supported: true,
    supportsEndpoints: false,
    supportsImport: true,
    supportsReadOnlyManagement: true,
    supportsSync: true,
    readOnlyResources: [
      "balance",
      "usage",
      "pricing",
      "task-status",
      "model-detail",
    ],
  },
  mureka: {
    credentialMode: "none",
    description: "当前平台没有可安全同步的官方模型目录，请在模型中心手动配置。",
    modelLabel: "项目支持模型",
    scope: "manual",
    support: "manual",
    supported: false,
    supportsEndpoints: false,
    supportsImport: false,
    supportsReadOnlyManagement: false,
    supportsSync: false,
    readOnlyResources: [],
  },
};

export function providerCatalogCapabilities(driver: ProviderDriver) {
  return { ...capabilities[driver] };
}
