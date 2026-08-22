import type {
  MediaGenerationExecution,
  MediaGenerationRequest,
} from "./mediaGenerationProvider";
import { mediaProviderRegistry } from "./providerMediaGenerationAdapters";
import type { ProviderProfile } from "./providerProfiles";

function provider(profile: ProviderProfile) {
  return mediaProviderRegistry.resolve(profile, "native", "audio");
}

export const murekaAudioRuntime = Object.freeze({
  inspect(
    profile: ProviderProfile,
    providerTaskId: string,
    execution: MediaGenerationExecution,
  ) {
    return provider(profile).inspect(providerTaskId, execution);
  },
  normalize(profile: ProviderProfile, rawResult: unknown) {
    return provider(profile).normalize(rawResult);
  },
  submit(
    profile: ProviderProfile,
    request: MediaGenerationRequest,
    execution: MediaGenerationExecution,
  ) {
    return provider(profile).submit(request, execution);
  },
});
