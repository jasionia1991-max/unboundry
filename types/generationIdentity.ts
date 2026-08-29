import type { ModelParameterValue } from "./modelParameters";
import type { NodeInputKind, ResolvedNodeInput } from "./nodeInputs";

function stableIdentityValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableIdentityValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableIdentityValue(item)]),
    );
  }
  return value;
}

/** Stable semantic identity shared by browser admission and server validation. */
export function generationInputKey(input: {
  inputs: readonly ResolvedNodeInput[];
  modelConfigurationRevision?: string;
  modelId?: string;
  modelReleaseRevision?: string;
  ownPrompt?: string;
  parameters: Record<string, ModelParameterValue>;
  prompt: string;
}) {
  return JSON.stringify(stableIdentityValue({
    inputs: input.inputs.map((item) => ({
      assetId: item.assetId,
      edgeId: item.edgeId,
      kind: item.kind,
      order: item.order,
      role: item.role,
      sourceNodeId: item.sourceNodeId,
      state: item.state,
      text: item.text,
    })),
    modelId: input.modelId,
    modelConfigurationRevision: input.modelConfigurationRevision,
    modelReleaseRevision: input.modelReleaseRevision,
    ownPrompt: input.ownPrompt?.trim() ?? "",
    parameters: input.parameters,
    prompt: input.prompt.trim(),
  }));
}

/** Compact, catalog-independent ownership evidence for an in-flight task. */
export function generationOwnershipKey(value: unknown) {
  const source = JSON.stringify(stableIdentityValue(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${source.length.toString(36)}-${left.toString(36)}-${right.toString(36)}`;
}

export function generationOwnershipEvidence(input: {
  contractFingerprint: string;
  inputs: readonly ResolvedNodeInput[];
  kind: NodeInputKind;
  modelConfigurationRevision?: string;
  modelId?: string;
  modelReleaseRevision: string;
  parameters: Record<string, ModelParameterValue>;
  prompt: string;
}) {
  const upstream = input.inputs.map((item) => ({
    assetId: item.kind === "text" ? undefined : item.assetId,
    edgeId: item.edgeId,
    metadataStatus: item.metadataStatus,
    order: item.order,
    ready: item.state === "ready",
    role: item.role,
    source: item.sourceNodeId,
    sourceKind: item.kind,
    src: item.kind === "text" ? undefined : item.preview,
    status: item.state,
    text: item.kind === "text" ? item.text : undefined,
  }));
  return input.kind === "image"
    ? {
        aspectRatio: input.parameters.aspectRatio,
        contractFingerprint: input.contractFingerprint,
        modelConfigurationRevision: input.modelConfigurationRevision,
        modelId: input.modelId,
        modelReleaseRevision: input.modelReleaseRevision,
        parameters: input.parameters,
        prompt: input.prompt,
        quality: input.parameters.quality,
        upstream,
      }
    : {
        contractFingerprint: input.contractFingerprint,
        modelConfigurationRevision: input.modelConfigurationRevision,
        modelId: input.modelId,
        modelReleaseRevision: input.modelReleaseRevision,
        parameters: input.parameters,
        prompt: input.prompt,
        upstream,
      };
}
