import { expect, test } from "@playwright/test";
import {
  evaluateModelRuntimeAvailability,
  type ModelRuntimeAvailabilityInput,
} from "../server/modelAvailability";

const readyImage: ModelRuntimeAvailabilityInput = {
  capability: "image",
  costCurrency: "USD",
  emergencyStop: false,
  globalEnabled: true,
  providerDriver: "openrouter",
  providerModelId: "openai/gpt-image-2",
  providerStatus: "enabled",
  storedProviderDriver: "openrouter",
};

test("model runtime reasons are stable, Chinese, and Provider-request free", () => {
  let providerRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((..._arguments: Parameters<typeof fetch>) => {
    providerRequests += 1;
    throw new Error("availability evaluation must not request a Provider");
  }) as typeof fetch;
  try {
    const cases: Array<{
      expectedCode: string;
      input: ModelRuntimeAvailabilityInput;
    }> = [
      {
        expectedCode: "ADAPTER_UNSUPPORTED",
        input: { ...readyImage, providerModelId: "unsupported/image-model" },
      },
      {
        expectedCode: "PROVIDER_PROFILE_MISSING",
        input: { ...readyImage, storedProviderDriver: undefined },
      },
      {
        expectedCode: "PROVIDER_DRIVER_MISMATCH",
        input: { ...readyImage, storedProviderDriver: "openai-compatible" },
      },
      {
        expectedCode: "PROVIDER_REVERIFY_REQUIRED",
        input: { ...readyImage, providerStatus: "disabled" },
      },
      {
        expectedCode: "PROVIDER_AUTH_FAILED",
        input: {
          ...readyImage,
          latestAuthFailureAt: "2026-08-03T03:37:28.000Z",
          modelConfigurationUpdatedAt: "2026-08-03T03:37:27.000Z",
          providerConfigurationUpdatedAt: "2026-08-03T03:37:26.000Z",
        },
      },
      {
        expectedCode: "EMERGENCY_STOP",
        input: { ...readyImage, emergencyStop: true },
      },
      {
        expectedCode: "GLOBAL_GENERATION_DISABLED",
        input: { ...readyImage, globalEnabled: false },
      },
    ];

    for (const { expectedCode, input } of cases) {
      const result = evaluateModelRuntimeAvailability(input);
      expect(result.generationAvailable).toBe(false);
      expect(result.generationUnavailableReasonCode).toBe(expectedCode);
      expect(result.generationUnavailableReason).toMatch(/[\u4e00-\u9fff]/);
    }
    expect(providerRequests).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a model is runnable only when every runtime gate is ready", () => {
  expect(evaluateModelRuntimeAvailability(readyImage)).toEqual({
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
  });
});

test("a capability auth incident clears only after configuration or capability success", () => {
  const blocked = evaluateModelRuntimeAvailability({
    ...readyImage,
    capability: "text",
    costCurrency: "CNY",
    latestAuthFailureAt: "2026-08-03T03:37:28.000Z",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    modelConfigurationUpdatedAt: "2026-08-03T03:37:27.000Z",
    providerConfigurationUpdatedAt: "2026-08-03T03:37:26.000Z",
    storedProviderDriver: "volcengine-ark",
  });
  expect(blocked).toMatchObject({
    generationAvailable: false,
    generationUnavailableReasonCode: "PROVIDER_AUTH_FAILED",
  });
  expect(blocked.generationUnavailableReason).toContain("更新");

  expect(evaluateModelRuntimeAvailability({
    ...readyImage,
    capability: "text",
    costCurrency: "CNY",
    latestAuthFailureAt: "2026-08-03T03:37:28.000Z",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    modelConfigurationUpdatedAt: "2026-08-03T03:37:29.000Z",
    providerConfigurationUpdatedAt: "2026-08-03T03:37:26.000Z",
    storedProviderDriver: "volcengine-ark",
  })).toMatchObject({
    generationAvailable: true,
    generationUnavailableReasonCode: null,
  });

  expect(evaluateModelRuntimeAvailability({
    ...readyImage,
    latestAuthFailureAt: "2026-08-03T03:37:28.000Z",
    modelConfigurationUpdatedAt: "2026-08-03T03:37:27.000Z",
    providerConfigurationUpdatedAt: "2026-08-03T03:37:29.000Z",
  })).toMatchObject({
    generationAvailable: true,
    generationUnavailableReasonCode: null,
  });

  expect(evaluateModelRuntimeAvailability({
    ...readyImage,
    capability: "text",
    costCurrency: "CNY",
    latestAuthFailureAt: "2026-08-03T03:37:28.000Z",
    latestProviderAttemptAt: "2026-08-03T03:37:30.000Z",
    modelConfigurationUpdatedAt: "2026-08-03T03:37:29.000Z",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    storedProviderDriver: "volcengine-ark",
  })).toMatchObject({
    generationAvailable: false,
    generationUnavailableReasonCode: "PROVIDER_RECOVERY_ATTEMPT_USED",
  });

  expect(evaluateModelRuntimeAvailability({
    ...readyImage,
    latestAuthFailureAt: "2026-08-03T03:37:28.000Z",
    latestCapabilitySuccessAt: "2026-08-03T03:37:30.000Z",
    modelConfigurationUpdatedAt: "2026-08-03T03:37:27.000Z",
  })).toMatchObject({
    generationAvailable: true,
    generationUnavailableReasonCode: null,
  });
});

test("the shipped Doubao Seed text adapter uses the same runtime gates", () => {
  expect(evaluateModelRuntimeAvailability({
    capability: "text",
    costCurrency: "CNY",
    emergencyStop: false,
    globalEnabled: true,
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    providerStatus: "enabled",
    storedProviderDriver: "volcengine-ark",
  })).toMatchObject({
    generationAvailable: true,
    generationUnavailableReasonCode: null,
  });
});

test("emergency stop wins over the ordinary global switch", () => {
  const result = evaluateModelRuntimeAvailability({
    ...readyImage,
    emergencyStop: true,
    globalEnabled: false,
  });
  expect(result.generationUnavailableReasonCode).toBe("EMERGENCY_STOP");
});

test("platform stop reasons stay consistent even when model setup also needs work", () => {
  expect(evaluateModelRuntimeAvailability({
    ...readyImage,
    globalEnabled: false,
    providerModelId: "unsupported/image-model",
    providerStatus: "disabled",
    storedProviderDriver: undefined,
  }).generationUnavailableReasonCode).toBe("GLOBAL_GENERATION_DISABLED");
  expect(evaluateModelRuntimeAvailability({
    ...readyImage,
    emergencyStop: true,
    globalEnabled: false,
    providerModelId: "unsupported/image-model",
  }).generationUnavailableReasonCode).toBe("EMERGENCY_STOP");
});
