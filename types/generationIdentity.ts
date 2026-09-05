import {
  validateParameterValues,
  type ModelCapability,
  type ModelParameterSchema,
  type ModelParameterValue,
} from "./modelParameters";
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

function parameterRecord(value: unknown): value is Record<string, ModelParameterValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
    Object.entries(value as Record<string, unknown>).every(([key, item]) =>
      key !== "__proto__" && key !== "constructor" && key !== "prototype" &&
      (typeof item === "string" || typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item)))
    );
}

type FrozenGenerationModelIdentity = {
  modelId?: string;
  modelConfigurationRevision?: string;
  modelReleaseRevision?: string;
  contractFingerprint?: string;
};

export type BoundGenerationParameterProof =
  | { state: "valid" | "changed"; parameters: Record<string, ModelParameterValue> }
  | { state: "unknown" };

/**
 * Detect source/edge/prompt edits without consulting the model catalog. This
 * is a change fence, not a complete contract proof: resolved roles, readiness,
 * combined prompts and parameters still require their separate strict proof.
 */
export function boundGenerationSourceProof(
  frozenInputKey: string | undefined,
  currentInputKey: string,
): "same" | "changed" | "unknown" {
  const sourceIdentity = (key: string) => {
    const value: unknown = JSON.parse(key);
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(stableIdentityValue(value)) !== key) throw new Error("Invalid input key");
    const saved = value as Record<string, unknown>;
    if (typeof saved.ownPrompt !== "string" || !Array.isArray(saved.inputs)) {
      throw new Error("Missing source identity");
    }
    return JSON.stringify(stableIdentityValue({
      ownPrompt: saved.ownPrompt,
      inputs: saved.inputs.map((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("Invalid source input");
        }
        const source = item as Record<string, unknown>;
        if (typeof source.edgeId !== "string" || typeof source.sourceNodeId !== "string" ||
          !["text", "image", "video", "audio"].includes(String(source.kind)) ||
          !Number.isSafeInteger(source.order) ||
          (source.assetId !== undefined && typeof source.assetId !== "string") ||
          (source.text !== undefined && typeof source.text !== "string")) {
          throw new Error("Invalid source fields");
        }
        return {
          assetId: source.assetId, edgeId: source.edgeId, kind: source.kind,
          order: source.order, sourceNodeId: source.sourceNodeId, text: source.text,
        };
      }),
    }));
  };
  if (!frozenInputKey) return "unknown";
  try {
    return sourceIdentity(frozenInputKey) === sourceIdentity(currentInputKey) ? "same" : "changed";
  } catch {
    return "unknown";
  }
}

/**
 * Parameter proof only, never permission to submit, detach, or commit a result.
 * A bound ownership key stays opaque. Missing/drifting catalog evidence must
 * not be interpreted as a user edit or prevent reading the original task.
 */
export function boundGenerationParameterProof(input: {
  kind: ModelCapability;
  frozen: FrozenGenerationModelIdentity & { inputKey?: string; ownershipKey?: string };
  current?: FrozenGenerationModelIdentity & {
    capability: ModelCapability;
    parameterSchema?: ModelParameterSchema;
    parameters: unknown;
  };
}): BoundGenerationParameterProof {
  const { frozen, current } = input;
  if (!frozen.ownershipKey || !frozen.inputKey || !current?.parameterSchema ||
    current.capability !== input.kind) return { state: "unknown" };
  const identityKeys = [
    "modelId", "modelConfigurationRevision", "modelReleaseRevision", "contractFingerprint",
  ] as const;
  if (identityKeys.some((key) =>
    typeof frozen[key] !== "string" || !frozen[key] || frozen[key] !== current[key]
  )) return { state: "unknown" };
  try {
    const parsed: unknown = JSON.parse(frozen.inputKey);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "unknown" };
    }
    const saved = parsed as Record<string, unknown>;
    // Require the serialization produced by generationInputKey, not a partial
    // key-set witness (or ambiguous JSON with repeated properties).
    if (JSON.stringify(stableIdentityValue(saved)) !== frozen.inputKey ||
      !Array.isArray(saved.inputs) || typeof saved.prompt !== "string" ||
      typeof saved.ownPrompt !== "string" ||
      saved.modelId !== frozen.modelId ||
      saved.modelConfigurationRevision !== frozen.modelConfigurationRevision ||
      saved.modelReleaseRevision !== frozen.modelReleaseRevision ||
      !parameterRecord(saved.parameters) || !parameterRecord(current.parameters)) {
      return { state: "unknown" };
    }
    const parameters = validateParameterValues(current.parameterSchema, saved.parameters);
    const stableParameters = JSON.stringify(stableIdentityValue(parameters));
    // Frozen parameters must already be the strict submission projection.
    // Silently normalizing invalid/missing/hidden frozen values is not proof.
    if (stableParameters !== JSON.stringify(stableIdentityValue(saved.parameters))) {
      return { state: "unknown" };
    }
    const currentParameters = validateParameterValues(current.parameterSchema, current.parameters);
    return {
      state: stableParameters === JSON.stringify(stableIdentityValue(currentParameters))
        ? "valid" : "changed",
      parameters,
    };
  } catch {
    return { state: "unknown" };
  }
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
