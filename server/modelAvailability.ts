import type { ModelCapability } from "../types/modelParameters";
import {
  providerProtocolSupportsCapability,
  type ProviderProtocol,
} from "../types/relayProtocols";

export type ModelGenerationUnavailableReasonCode =
  | "ADAPTER_UNSUPPORTED"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_CONFIGURATION_MISMATCH"
  | "PROVIDER_RECOVERY_ATTEMPT_USED"
  | "PROVIDER_PROFILE_MISSING"
  | "PROVIDER_DRIVER_MISMATCH"
  | "PROVIDER_REVERIFY_REQUIRED"
  | "COST_LIMIT_NOT_CONFIGURED"
  | "EMERGENCY_STOP"
  | "GLOBAL_GENERATION_DISABLED";

export type ModelRuntimeAvailability = {
  generationAvailable: boolean;
  generationUnavailableReason: string;
  generationUnavailableReasonCode: ModelGenerationUnavailableReasonCode | null;
};

export type ModelRuntimeAvailabilityInput = {
  capability: ModelCapability;
  costCurrency: "CNY" | "USD";
  emergencyStop: boolean;
  globalEnabled: boolean;
  latestCapabilitySuccessAt?: string;
  latestProviderAttemptAt?: string;
  maxCostMicrounits: number;
  latestAuthFailureAt?: string;
  modelConfigurationUpdatedAt?: string;
  providerDriver: string;
  providerModelId: string;
  providerProtocol?: ProviderProtocol;
  providerConfigurationUpdatedAt?: string;
  providerConfigurationVersionAligned?: boolean;
  providerStatus: "disabled" | "enabled";
  storedProviderDriver?: string;
};

function timestamp(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function unavailable(
  generationUnavailableReasonCode: ModelGenerationUnavailableReasonCode,
  generationUnavailableReason: string,
): ModelRuntimeAvailability {
  return {
    generationAvailable: false,
    generationUnavailableReason,
    generationUnavailableReasonCode,
  };
}

/**
 * Static adapter compatibility. This is deliberately Provider-request free:
 * it describes adapters shipped by this server, not remote account state.
 */
export function modelGenerationAdapterSupported(
  input: Pick<
    ModelRuntimeAvailabilityInput,
    | "capability"
    | "costCurrency"
    | "providerDriver"
    | "providerModelId"
    | "providerProtocol"
  >,
) {
  const protocol = input.providerProtocol ?? "native";
  if (
    input.providerDriver === "multi-protocol-relay" &&
    protocol !== "native"
  ) {
    return providerProtocolSupportsCapability(protocol, input.capability);
  }
  if (input.capability === "text") {
    return input.providerDriver === "volcengine-ark" &&
      input.costCurrency === "CNY" &&
      /^doubao-seed-2-0-lite-[a-z0-9-]+$/i.test(input.providerModelId);
  }
  if (input.capability === "image") {
    return input.providerDriver === "openrouter" &&
      input.providerModelId === "openai/gpt-image-2";
  }
  if (input.capability === "video") {
    return input.providerDriver === "volcengine-ark" &&
      input.costCurrency === "CNY" &&
      /^doubao-seedance-[a-z0-9-]+$/i.test(input.providerModelId);
  }
  return input.providerDriver === "mureka" &&
    input.costCurrency === "USD" &&
    /^(auto|mureka-(7\.6|8|9))$/i.test(input.providerModelId);
}

/**
 * One deterministic availability decision for model catalogs and UI state.
 * It never reads secrets, changes configuration, or contacts a Provider.
 */
export function evaluateModelRuntimeAvailability(
  input: ModelRuntimeAvailabilityInput,
): ModelRuntimeAvailability {
  // Platform-wide safety decisions take precedence over model-specific setup.
  // This gives every node the same actionable reason while generation is
  // intentionally stopped; once it is enabled, the next model/profile issue
  // becomes visible.
  if (input.emergencyStop) {
    return unavailable(
      "EMERGENCY_STOP",
      "管理员已紧急停止真实生成",
    );
  }
  if (!input.globalEnabled) {
    return unavailable(
      "GLOBAL_GENERATION_DISABLED",
      "管理员已关闭真实生成",
    );
  }
  if (!modelGenerationAdapterSupported(input)) {
    return unavailable(
      "ADAPTER_UNSUPPORTED",
      "当前模型尚未接入安全生成服务",
    );
  }
  if (input.providerConfigurationVersionAligned === false) {
    return unavailable(
      "PROVIDER_CONFIGURATION_MISMATCH",
      "平台连接配置与安全状态不一致，已阻止本次生成",
    );
  }
  if (!input.storedProviderDriver) {
    return unavailable(
      "PROVIDER_PROFILE_MISSING",
      "平台安全配置缺失，请联系管理员",
    );
  }
  if (input.storedProviderDriver !== input.providerDriver) {
    return unavailable(
      "PROVIDER_DRIVER_MISMATCH",
      "平台安全配置不匹配，请联系管理员",
    );
  }
  if (input.providerStatus !== "enabled") {
    return unavailable(
      "PROVIDER_REVERIFY_REQUIRED",
      "平台连接资料已更新，请管理员完成只读连接检查",
    );
  }
  const latestAuthFailureAt = timestamp(input.latestAuthFailureAt);
  const latestCapabilitySuccessAt =
    timestamp(input.latestCapabilitySuccessAt) ?? Number.NEGATIVE_INFINITY;
  const configurationRecoveryAt = Math.max(
    timestamp(input.modelConfigurationUpdatedAt) ?? Number.NEGATIVE_INFINITY,
    timestamp(input.providerConfigurationUpdatedAt) ?? Number.NEGATIVE_INFINITY,
  );
  if (
    latestAuthFailureAt !== undefined &&
    latestAuthFailureAt > latestCapabilitySuccessAt
  ) {
    const capabilityName = input.capability === "text"
      ? "文字"
      : input.capability === "image"
        ? "图片"
        : input.capability === "video"
          ? "视频"
          : "音频";
    if (configurationRecoveryAt <= latestAuthFailureAt) {
      return unavailable(
        "PROVIDER_AUTH_FAILED",
        `${capabilityName}模型授权或权限校验失败，请管理员更新平台连接资料，或确认并更新该模型配置后再试`,
      );
    }
    const latestProviderAttemptAt = timestamp(input.latestProviderAttemptAt);
    if (
      latestProviderAttemptAt !== undefined &&
      latestProviderAttemptAt >= configurationRecoveryAt
    ) {
      return unavailable(
        "PROVIDER_RECOVERY_ATTEMPT_USED",
        `${capabilityName}模型配置更新后的恢复尝试已使用，请等待结果或由管理员再次更新配置`,
      );
    }
  }
  if (
    !Number.isSafeInteger(input.maxCostMicrounits) ||
    input.maxCostMicrounits <= 0
  ) {
    return unavailable(
      "COST_LIMIT_NOT_CONFIGURED",
      "管理员尚未设置模型单次费用上限",
    );
  }
  return {
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
  };
}
