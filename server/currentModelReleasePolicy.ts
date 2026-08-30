import { compileModelExecutionContract } from "./modelExecutionContractCompiler";
import { gkVideoExecutionContract } from "./modelReleaseDefaults";
import {
  cleanParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
} from "../types/modelParameters";
import type {
  ModelReleaseDocument,
  ModelReleaseRevision,
} from "../types/modelReleaseRevisions";

export class ModelContractPolicyError extends Error {
  constructor(
    readonly code:
      | "CURRENT_RELEASE_POLICY_MISMATCH"
      | "EXECUTION_CONTRACT_VERSION_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "ModelContractPolicyError";
  }
}

export function assertCurrentModelReleasePolicy(
  document: ModelReleaseDocument,
  compilerHash = compileModelExecutionContract(document.executionContract).hash,
) {
  if (
    document.runtime === "declarative" &&
    document.providerModelId !== "grok-video-3"
  ) {
    throw new ModelContractPolicyError(
      "CURRENT_RELEASE_POLICY_MISMATCH",
      "当前发布策略不允许该模型声明式runtime；必须由已核准的connector拥有执行语义",
    );
  }
  if (document.providerModelId !== "grok-video-3") return;
  const expected = compileModelExecutionContract(
    gkVideoExecutionContract(document.capabilitySchema),
  );
  if (
    document.runtime !== "declarative" ||
    document.evidence !== "EXACT" ||
    compilerHash !== expected.hash
  ) {
    throw new ModelContractPolicyError(
      "CURRENT_RELEASE_POLICY_MISMATCH",
      "GK执行合同必须与当前代码核准的精确模式、角色和Provider字段一致",
    );
  }
}

export function currentModelReleasePolicyDrift(document: ModelReleaseDocument) {
  try {
    const compiled = compileModelExecutionContract(document.executionContract);
    assertCurrentModelReleasePolicy(document, compiled.hash);
    return Object.freeze({
      code: undefined,
      compilerHash: compiled.hash,
      drifted: false as const,
    });
  } catch (error) {
    if (error instanceof ModelContractPolicyError) {
      return Object.freeze({
        code: error.code,
        drifted: true as const,
        message: error.message,
      });
    }
    throw error;
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [
        key,
        stable((value as Record<string, unknown>)[key]),
      ]),
    );
  }
  return value;
}

export function grokVideo3SchemaState(
  input: unknown,
): "current" | "legacy" | "other" {
  const current = providerParameterSchema({
    capability: "video",
    providerDriver: "multi-protocol-relay",
    providerModelId: "grok-video-3",
  });
  if (!current) return "other";
  const fallback = knownModelParameterSchema({
    capability: "video",
    providerDriver: "multi-protocol-relay",
    providerModelId: "grok-video-3",
  });
  try {
    const cleaned = cleanParameterSchema("video", input, fallback);
    const canonicalCurrent = cleanParameterSchema("video", current, fallback);
    if (JSON.stringify(stable(cleaned)) ===
        JSON.stringify(stable(canonicalCurrent))) return "current";
    const legacy = cleanParameterSchema("video", {
      ...current,
      fields: current.fields.map((field) => field.key === "inputMode"
        ? {
            ...field,
            options: [
              ...field.options,
              { label: "参考", value: "reference" },
            ],
          }
        : field),
      inputPolicy: {
        required: {},
        roles: {
          audio: [],
          image: ["first-frame", "reference-image", "subject"],
          text: ["instruction"],
          video: [],
        },
        switchPolicy: "keep-edge",
      },
      referenceInputs: { audio: 0, image: 0, video: 0 },
      referenceMediaRules: {},
      referencePolicy: undefined,
      upstreamInputs: {
        audio: { limitMode: "fixed", maxCount: 0, supported: false },
        image: { limitMode: "context", supported: true },
        text: { limitMode: "context", supported: true },
        video: { limitMode: "fixed", maxCount: 0, supported: false },
      },
    }, fallback);
    return JSON.stringify(stable(cleaned)) === JSON.stringify(stable(legacy))
      ? "legacy"
      : "other";
  } catch {
    return "other";
  }
}

function executionSignature(document: ModelReleaseDocument) {
  return JSON.stringify(stable({
    capabilitySchema: document.capabilitySchema,
    runtime: executionRuntimeSignature(document),
  }));
}

function executionRuntimeSignature(document: ModelReleaseDocument) {
  return JSON.stringify(stable({
    capability: document.capability,
    connectorFamily: document.connectorFamily,
    connectorVersion: document.connectorVersion,
    executionContract: {
      ...document.executionContract,
      version: 0,
    },
    providerModelId: document.providerModelId,
    providerProfileId: document.providerProfileId,
    providerProtocol: document.providerProtocol,
    runtime: document.runtime,
    modelId: document.modelId,
  }));
}

export function assertExecutionVersionTransition(
  predecessor: ModelReleaseRevision | undefined,
  document: ModelReleaseDocument,
  options: Readonly<{
    equivalentRuntimeSchemaTransition?:
      "exact-legacy-grok-video-3-v2";
  }> = {},
) {
  if (!predecessor) return;
  const changed = executionSignature(predecessor.document) !==
    executionSignature(document);
  const approvedSameVersionSchemaTransition =
    options.equivalentRuntimeSchemaTransition ===
      "exact-legacy-grok-video-3-v2" &&
    predecessor.document.providerModelId === "grok-video-3" &&
    document.providerModelId === "grok-video-3" &&
    predecessor.document.executionContract.version === 2 &&
    document.executionContract.version ===
      predecessor.document.executionContract.version &&
    grokVideo3SchemaState(predecessor.document.capabilitySchema) === "legacy" &&
    grokVideo3SchemaState(document.capabilitySchema) === "current" &&
    executionRuntimeSignature(predecessor.document) ===
      executionRuntimeSignature(document);
  if (
    changed &&
    !approvedSameVersionSchemaTransition &&
    document.executionContract.version <=
      predecessor.document.executionContract.version
  ) {
    throw new ModelContractPolicyError(
      "EXECUTION_CONTRACT_VERSION_REQUIRED",
      "执行语义已变化，必须提升executionContract.version",
    );
  }
}
