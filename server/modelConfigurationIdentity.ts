import { createHash } from "node:crypto";
import type { ModelParameterSchema } from "../types/modelParameters";
import type { GenerationCapabilityKind } from "../types/nodeVocabulary";

/** Shared server-owned identity for the live catalog and final task fence. */
export function authoritativeModelConfigurationRevision(input: Readonly<{
  capability: GenerationCapabilityKind;
  id: string;
  modelConfigurationUpdatedAt: string;
  parameterSchema: ModelParameterSchema;
  providerDriver: string;
  providerModelId: string;
}>) {
  const mediaInputPolicy = input.capability === "video" &&
      input.providerDriver === "volcengine-ark" &&
      /^doubao-seedance-[a-z0-9-]+$/i.test(input.providerModelId)
    ? "seedance-2"
    : undefined;
  return createHash("sha256").update(JSON.stringify({
    id: input.id,
    mediaInputPolicy,
    modelConfigurationUpdatedAt: input.modelConfigurationUpdatedAt,
    parameterSchema: input.parameterSchema,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
  })).digest("hex").slice(0, 24);
}
