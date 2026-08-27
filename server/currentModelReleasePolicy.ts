import { compileModelExecutionContract } from "./modelExecutionContractCompiler";
import { gkVideoExecutionContract } from "./modelReleaseDefaults";
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

function executionSignature(document: ModelReleaseDocument) {
  return JSON.stringify(stable({
    capabilitySchema: document.capabilitySchema,
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
  }));
}

export function assertExecutionVersionTransition(
  predecessor: ModelReleaseRevision | undefined,
  document: ModelReleaseDocument,
) {
  if (!predecessor) return;
  const changed = executionSignature(predecessor.document) !==
    executionSignature(document);
  if (
    changed &&
    document.executionContract.version <=
      predecessor.document.executionContract.version
  ) {
    throw new ModelContractPolicyError(
      "EXECUTION_CONTRACT_VERSION_REQUIRED",
      "执行语义已变化，必须提升executionContract.version",
    );
  }
}
