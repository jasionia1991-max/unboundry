import { createHash } from "node:crypto";
import type { ModelParameterSchema } from "../types/modelParameters";
import type { GenerationCapabilityKind } from "../types/nodeVocabulary";

export function modelMediaInputPolicy(input: Readonly<{
  capability: GenerationCapabilityKind;
  providerDriver: string;
  providerModelId: string;
}>) {
  return input.capability === "video" &&
      input.providerDriver === "volcengine-ark" &&
      /^doubao-seedance-[a-z0-9-]+$/i.test(input.providerModelId)
    ? "seedance-2" as const
    : undefined;
}

/** Shared server-owned identity for the live catalog and final task fence. */
export function authoritativeModelConfigurationRevision(input: Readonly<{
  capability: GenerationCapabilityKind;
  id: string;
  modelConfigurationUpdatedAt: string;
  parameterSchema: ModelParameterSchema;
  providerDriver: string;
  providerModelId: string;
}>) {
  const mediaInputPolicy = modelMediaInputPolicy(input);
  return createHash("sha256").update(JSON.stringify({
    id: input.id,
    mediaInputPolicy,
    modelConfigurationUpdatedAt: input.modelConfigurationUpdatedAt,
    parameterSchema: input.parameterSchema,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
  })).digest("hex").slice(0, 24);
}
