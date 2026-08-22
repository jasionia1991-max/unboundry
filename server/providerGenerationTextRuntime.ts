import type {
  TextGenerationProviderExecution,
  TextGenerationRequest,
} from "./generationProvider";
import {
  textProviderRegistry,
  type TextProviderRegistry,
} from "./providerRegistry";
import type { ProviderProfile } from "./providerProfiles";

export type { TextProviderRegistry } from "./providerRegistry";

/** Text runtime seam; durable task transitions remain in Generation. */
export function generateTextRuntime(
  profile: ProviderProfile,
  request: TextGenerationRequest,
  execution: Omit<TextGenerationProviderExecution, "profile">,
  registry: TextProviderRegistry = textProviderRegistry,
) {
  return registry.generate(profile, request, execution);
}
