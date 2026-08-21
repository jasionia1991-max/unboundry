import {
  TextGenerationProviderError,
  type TextGenerationProtocol,
  type TextGenerationProvider,
  type TextGenerationProviderExecution,
  type TextGenerationRequest,
  type TextGenerationResult,
} from "./generationProvider";
import type { ProviderProfile } from "./providerProfiles";
import { volcengineArkTextGenerationProvider } from "./volcengineArkTextProvider";
import { relayTextGenerationProvider } from "./relayProviderAdapters";

function registrationKey(
  driver: ProviderProfile["driver"],
  protocol: TextGenerationProtocol,
) {
  return `${driver}:${protocol}`;
}

export class TextProviderRegistry {
  readonly #providers = new Map<string, TextGenerationProvider>();

  constructor(providers: readonly TextGenerationProvider[]) {
    for (const provider of providers) {
      for (const registration of provider.registrations) {
        const key = registrationKey(
          registration.driver,
          registration.protocol,
        );
        if (this.#providers.has(key)) {
          throw new Error(`Duplicate Text Provider registration: ${key}`);
        }
        this.#providers.set(key, provider);
      }
    }
  }

  resolve(
    profile: ProviderProfile,
    protocol: TextGenerationProtocol,
  ): TextGenerationProvider {
    const provider = this.#providers.get(registrationKey(profile.driver, protocol));
    if (!provider) {
      throw new TextGenerationProviderError(
        "FORMAT",
        protocol === "native"
          ? "文字模型配置已失效"
          : "中转站请求或响应格式无法安全识别",
      );
    }
    return provider;
  }

  generate(
    profile: ProviderProfile,
    request: TextGenerationRequest,
    execution: Omit<TextGenerationProviderExecution, "profile">,
  ): Promise<TextGenerationResult> {
    return this.resolve(profile, request.protocol).generate(request, {
      ...execution,
      profile,
    });
  }
}

export const textProviderRegistry = new TextProviderRegistry([
  volcengineArkTextGenerationProvider,
  relayTextGenerationProvider,
]);
