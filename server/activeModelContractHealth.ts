import type { DatabaseSync } from "node:sqlite";
import type { ModelCapability } from "../types/modelParameters";
import type { ProviderProtocol } from "../types/relayProtocols";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import {
  CanonicalPublishedModelContractError,
  resolveCanonicalPublishedModelContract,
} from "./canonicalPublishedModelContract";
import {
  assertModelReleaseRevisionIntegrity,
  modelContractsRequired,
  modelContractState,
} from "./modelReleaseRevisionStore";

export type ModelContractHealth =
  | Readonly<{
      activeRevisionId: string;
      fingerprint: string;
      state: "healthy";
    }>
  | Readonly<{
      activeRevisionId: string;
      causeCode: "CAPABILITY_SCHEMA_OUT_OF_SYNC";
      expectedFingerprint: string;
      state: "out-of-sync";
    }>
  | Readonly<{
      causeCode: "ACTIVE_REVISION_MISSING" | "BOOTSTRAP_REQUIRED";
      state: "migration-required";
    }>
  | Readonly<{
      activeRevisionId?: string;
      causeCode: string;
      state: "invalid";
    }>;

export type ModelContractHealthErrorCode =
  | "MODEL_CONTRACT_INVALID"
  | "MODEL_CONTRACT_MIGRATION_REQUIRED"
  | "MODEL_CONTRACT_OUT_OF_SYNC";

export class ModelContractHealthError extends Error {
  constructor(
    readonly code: ModelContractHealthErrorCode,
    readonly causeCode: string,
    message: string,
  ) {
    super(message);
    this.name = "ModelContractHealthError";
  }
}

export type ActiveModelContractHealthInput = Readonly<{
  capability: ModelCapability;
  costCurrency: "CNY" | "USD";
  defaultParameters: string | unknown;
  modelId: string;
  providerDriver: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
  store: DatabaseSync;
}>;

export type ActiveModelContractResolution = Readonly<{
  active?: ModelReleaseRevision;
  canonical?: ReturnType<typeof resolveCanonicalPublishedModelContract>;
  health: ModelContractHealth;
}>;

function invalidCause(error: unknown) {
  if (error instanceof CanonicalPublishedModelContractError) {
    return `CANONICAL_${error.code}`;
  }
  if (
    error && typeof error === "object" && "code" in error &&
    typeof error.code === "string"
  ) return error.code;
  return "FROZEN_REVISION_INTEGRITY_INVALID";
}

/**
 * Resolve the current published contract once and use that same immutable
 * result for health, schema, registry and totality decisions. This path is for
 * new-task availability/admission only; historical tasks keep their own frozen
 * revision path.
 */
export function resolveActiveModelContract(
  input: ActiveModelContractHealthInput,
): ActiveModelContractResolution {
  if (!modelContractsRequired(input.store)) {
    return Object.freeze({
      health: Object.freeze({
        causeCode: "BOOTSTRAP_REQUIRED",
        state: "migration-required",
      }),
    });
  }
  const active = modelContractState(input.store, input.modelId).active;
  if (!active) {
    return Object.freeze({
      health: Object.freeze({
        causeCode: "ACTIVE_REVISION_MISSING",
        state: "migration-required",
      }),
    });
  }
  try {
    assertModelReleaseRevisionIntegrity(active);
  } catch (error) {
    return Object.freeze({
      active,
      health: Object.freeze({
        activeRevisionId: active.revisionId,
        causeCode: invalidCause(error),
        state: "invalid",
      }),
    });
  }
  const document = active.document;
  if (
    document.runtime === "blocked" ||
    document.evidence === "UNKNOWN" ||
    document.evidence === "GENERIC_GUESS" ||
    document.modelId !== input.modelId ||
    document.capability !== input.capability ||
    document.providerProfileId !== input.providerProfileId ||
    document.providerModelId !== input.providerModelId ||
    document.providerProtocol !== input.providerProtocol
  ) {
    return Object.freeze({
      active,
      health: Object.freeze({
        activeRevisionId: active.revisionId,
        causeCode: "ACTIVE_IDENTITY_INVALID",
        state: "invalid",
      }),
    });
  }
  let canonical: ReturnType<typeof resolveCanonicalPublishedModelContract>;
  try {
    canonical = resolveCanonicalPublishedModelContract({
      activeDocument: document,
      capability: input.capability,
      costCurrency: input.costCurrency,
      defaultParameters: input.defaultParameters,
      modelId: input.modelId,
      providerDriver: input.providerDriver,
      providerModelId: input.providerModelId,
      providerProfileId: input.providerProfileId,
      providerProtocol: input.providerProtocol,
    });
  } catch (error) {
    return Object.freeze({
      active,
      health: Object.freeze({
        activeRevisionId: active.revisionId,
        causeCode: invalidCause(error),
        state: "invalid",
      }),
    });
  }
  if (canonical.activeExecutionIdentityDifferences.length > 0) {
    return Object.freeze({
      active,
      canonical,
      health: Object.freeze({
        activeRevisionId: active.revisionId,
        causeCode: "EXECUTION_REGISTRY_INVALID",
        state: "invalid",
      }),
    });
  }
  if (canonical.activeCapabilityDifferences.length > 0) {
    return Object.freeze({
      active,
      canonical,
      health: Object.freeze({
        activeRevisionId: active.revisionId,
        causeCode: "CAPABILITY_SCHEMA_OUT_OF_SYNC",
        expectedFingerprint: canonical.capabilityFingerprint,
        state: "out-of-sync",
      }),
    });
  }
  return Object.freeze({
    active,
    canonical,
    health: Object.freeze({
      activeRevisionId: active.revisionId,
      fingerprint: active.hash,
      state: "healthy",
    }),
  });
}

export function inspectActiveModelContractHealth(
  input: ActiveModelContractHealthInput,
): ModelContractHealth {
  return resolveActiveModelContract(input).health;
}

/**
 * One fail-closed health gate for every new-task availability/admission path.
 * Historical tasks keep validating their own frozen revision separately.
 */
export function assertActiveModelContractHealth(
  input: ActiveModelContractHealthInput,
) {
  const resolution = resolveActiveModelContract(input);
  if (resolution.health.state !== "healthy" || !resolution.active) {
    if (resolution.health.state === "out-of-sync") {
      throw new ModelContractHealthError(
        "MODEL_CONTRACT_OUT_OF_SYNC",
        resolution.health.causeCode,
        "active模型合同与当前published模型身份不一致",
      );
    }
    if (resolution.health.state === "migration-required") {
      throw new ModelContractHealthError(
        "MODEL_CONTRACT_MIGRATION_REQUIRED",
        resolution.health.causeCode,
        "模型合同bootstrap或active immutable revision尚未完成",
      );
    }
    throw new ModelContractHealthError(
      "MODEL_CONTRACT_INVALID",
      resolution.health.state === "invalid"
        ? resolution.health.causeCode
        : "ACTIVE_REVISION_RESOLUTION_INVALID",
      "active模型合同或精确执行registry无效",
    );
  }
  return resolution.active;
}
