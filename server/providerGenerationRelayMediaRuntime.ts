import type {
  MediaGenerationExecution,
  MediaGenerationRequest,
} from "./mediaGenerationProvider";
import { mediaProviderRegistry } from "./providerMediaGenerationAdapters";
import type { ProviderProfile } from "./providerProfiles";

function provider(profile: ProviderProfile, kind: "audio" | "image" | "video") {
  return mediaProviderRegistry.resolve(profile, "media-generate", kind);
}

export const relayMediaRuntime = Object.freeze({
  inspect(
    profile: ProviderProfile,
    kind: "audio" | "image" | "video",
    providerTaskId: string,
    execution: MediaGenerationExecution,
  ) {
    return provider(profile, kind).inspect(providerTaskId, execution);
  },
  normalize(
    profile: ProviderProfile,
    kind: "audio" | "image" | "video",
    rawResult: unknown,
  ) {
    return provider(profile, kind).normalize(rawResult);
  },
  submit(
    profile: ProviderProfile,
    request: MediaGenerationRequest,
    execution: MediaGenerationExecution,
  ) {
    return provider(profile, request.kind).submit(request, execution);
  },
});
