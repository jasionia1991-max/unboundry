import type { ModelParameterValue } from "./modelParameters";
import type { NodeInputKind, ResolvedNodeInput } from "./nodeInputs";
import type {
  ImageGenerationToolInput,
  ImageMultiAngleParameters,
} from "./imageTools";

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

/**
 * Canonical ownership evidence for the six Provider-backed image tools. Keep
 * this shared between browser planning and server preflight so a tool cannot
 * bind a task under a generic image-generation identity.
 */
export function imageGenerationToolOwnershipEvidence(input: Readonly<{
  accountId: string;
  aspectRatio?: string;
  canvasId: string;
  imageTool: ImageGenerationToolInput;
  modelId?: string;
  modelParameters?: Record<string, ModelParameterValue>;
  multiAngleParameters?: ImageMultiAngleParameters;
  prompt: string;
  quality?: string;
}>) {
  const tool = input.imageTool;
  const common = {
    accountId: input.accountId,
    aspectRatio: input.aspectRatio,
    canvasId: input.canvasId,
    modelId: input.modelId,
    modelParameters: input.modelParameters,
    operation: tool.operation,
    operationId: tool.operationId,
    prompt: input.prompt,
    quality: input.quality,
    sourceAssetId: tool.sourceAssetId,
    sourceNodeId: tool.sourceNodeId,
  };
  if (tool.operation === "multi-angle") {
    if (!input.multiAngleParameters) {
      throw new Error("Multi-angle ownership parameters are missing");
    }
    return { ...common, parameters: input.multiAngleParameters };
  }
  if (tool.operation === "redraw") {
    if (!tool.mask) throw new Error("Redraw ownership mask is missing");
    return { ...common, mask: tool.mask };
  }
  if (tool.operation === "erase" || tool.operation === "outpaint") {
    if (!tool.mask) throw new Error("Image-tool ownership mask is missing");
    return {
      ...common,
      mask: tool.mask,
      outpaint: tool.outpaint,
      preparedAssetId: tool.preparedInput?.assetId,
    };
  }
  return common;
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
