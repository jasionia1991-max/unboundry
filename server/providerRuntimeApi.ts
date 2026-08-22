import { arkVideoRuntime } from "./providerGenerationArkVideoRuntime";
import { murekaAudioRuntime } from "./providerGenerationMurekaAudioRuntime";
import { relayMediaRuntime } from "./providerGenerationRelayMediaRuntime";
import { generateTextRuntime } from "./providerGenerationTextRuntime";
import { configureProviderReferenceStore } from "./providerMedia";

export const providerRuntimeApi = Object.freeze({
  configureReferenceStore: configureProviderReferenceStore,
  generation: Object.freeze({
    arkVideo: arkVideoRuntime,
    murekaAudio: murekaAudioRuntime,
    relayMedia: relayMediaRuntime,
    text: generateTextRuntime,
  }),
});
