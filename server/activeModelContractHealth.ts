import type { DatabaseSync } from "node:sqlite";
import type {
  ModelCapability,
  ModelParameterSchema,
} from "../types/modelParameters";
import type { ProviderProtocol } from "../types/relayProtocols";
import {
  assertRegisteredModelExecutionTotality,
  registeredModelExecution,
} from "./modelExecutionRegistry";
import {
  assertModelReleaseRevisionIntegrity,
  modelContractsRequired,
  modelContractState,
} from "./modelReleaseRevisionStore";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

/**
 * One fail-closed health gate for every new-task availability/admission path.
 * Historical tasks keep validating their own frozen revision separately.
 */
export function assertActiveModelContractHealth(input: {
  capability: ModelCapability;
  costCurrency: "CNY" | "USD";
  modelId: string;
  parameterSchema: ModelParameterSchema;
  providerDriver: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
  store: DatabaseSync;
}) {
  if (!modelContractsRequired(input.store)) {
    throw new Error("模型合同bootstrap尚未完成");
  }
  const active = modelContractState(input.store, input.modelId).active;
  if (!active) throw new Error("模型缺少active immutable revision");
  assertModelReleaseRevisionIntegrity(active);
  const document = active.document;
  if (
    document.runtime === "blocked" ||
    document.evidence === "UNKNOWN" ||
    document.evidence === "GENERIC_GUESS" ||
    document.modelId !== input.modelId ||
    document.capability !== input.capability ||
    document.providerProfileId !== input.providerProfileId ||
    document.providerModelId !== input.providerModelId ||
    document.providerProtocol !== input.providerProtocol ||
    JSON.stringify(stable(document.capabilitySchema)) !==
      JSON.stringify(stable(input.parameterSchema))
  ) {
    throw new Error("active模型合同与当前published模型身份不一致");
  }
  const descriptor = registeredModelExecution({
    capability: input.capability,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
    providerProtocol: input.providerProtocol,
  });
  if (
    !descriptor ||
    descriptor.connectorFamily !== document.connectorFamily ||
    descriptor.costCurrency !== input.costCurrency ||
    descriptor.evidence !== document.evidence ||
    descriptor.runtime !== document.runtime
  ) {
    throw new Error("active模型合同与精确执行registry不一致");
  }
  assertRegisteredModelExecutionTotality({
    capability: input.capability,
    capabilitySchema: document.capabilitySchema,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
    providerProtocol: input.providerProtocol,
    revisionIdentity: active.revisionId,
  });
  return active;
}
