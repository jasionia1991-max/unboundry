import type { ModelParameterSchema } from "../types/modelParameters";
import type { ModelReleaseRevision } from "../types/modelReleaseRevisions";
import type { GenerationCapabilityKind } from "../types/nodeVocabulary";
import type { ProviderProtocol } from "../types/relayProtocols";
import {
  assertRegisteredModelExecutionTotality,
  type ModelExecutionAdapterId,
} from "./modelExecutionRegistry";
import { assertModelReleaseRevisionIntegrity } from
  "./modelReleaseRevisionStore";

const authoritativeGenerationModelConfigurationBrand = Symbol(
  "AuthoritativeGenerationModelConfiguration",
);

export type AuthoritativeWorkflowBinding = Readonly<{
  generationInputKey: string;
  generationOwnershipKey: string;
  groupId: string;
  modelConfigurationRevision: string;
  modelReleaseRevision: string;
  reservationId?: string;
  runId: string;
}>;

/**
 * Opaque, runtime-branded input to the only current task-admission path.
 * The private symbol makes a structural object insufficient, while the
 * runtime assertion also rejects a value manufactured with a type cast.
 */
export type AuthoritativeGenerationModelConfiguration = Readonly<
  Record<string, unknown> & {
  readonly [authoritativeGenerationModelConfigurationBrand]: true;
  credentialVersion: number;
  fixtureScopeId?: string;
  generationIdentityVersion: 2;
  generationInputKey: string;
  generationOwnershipKey: string;
  modelCapability: GenerationCapabilityKind;
  modelConfigurationRevision: string;
  modelExecutionAdapterId: ModelExecutionAdapterId;
  modelId: string;
  modelInputContractFingerprint: string;
  modelReleaseRevision: ModelReleaseRevision;
  modelResultCount: 1;
  parameterSchema: ModelParameterSchema;
  providerConfigurationVersion: number;
  providerDriver: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
    workflowBinding?: AuthoritativeWorkflowBinding;
  }
>;

export type AuthoritativeGenerationModelConfigurationInput = Readonly<{
  credentialVersion: number;
  fixtureScopeId?: string;
  generationInputKey: string;
  generationOwnershipKey: string;
  modelCapability: GenerationCapabilityKind;
  modelConfigurationRevision: string;
  modelExecutionAdapterId: ModelExecutionAdapterId;
  modelId: string;
  modelInputContractFingerprint: string;
  modelReleaseRevision: ModelReleaseRevision;
  modelResultCount: 1;
  parameterSchema: ModelParameterSchema;
  providerConfigurationVersion: number;
  providerDriver: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
  workflowBinding?: AuthoritativeWorkflowBinding;
}>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function frozenStableClone<T>(value: T): T {
  return deepFreeze(stableValue(value) as T);
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function bounded(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= maximum;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validWorkflowBinding(value: unknown): value is AuthoritativeWorkflowBinding {
  if (!record(value)) return false;
  return bounded(value.generationInputKey, 32_000) &&
    bounded(value.generationOwnershipKey, 2_000) &&
    bounded(value.groupId, 200) &&
    bounded(value.modelConfigurationRevision, 500) &&
    bounded(value.modelReleaseRevision, 500) &&
    bounded(value.runId, 200) &&
    (value.reservationId === undefined ||
      typeof value.reservationId === "string" &&
      /^[0-9a-f-]{36}$/i.test(value.reservationId));
}

function brandedConfiguration(
  value: unknown,
): value is AuthoritativeGenerationModelConfiguration {
  return record(value) &&
    Reflect.get(value, authoritativeGenerationModelConfigurationBrand) === true;
}

function assertAuthoritativeFields(
  input: AuthoritativeGenerationModelConfigurationInput,
) {
  assertModelReleaseRevisionIntegrity(input.modelReleaseRevision);
  const release = input.modelReleaseRevision;
  const totality = assertRegisteredModelExecutionTotality({
    capability: input.modelCapability,
    capabilitySchema: input.parameterSchema,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
    providerProtocol: input.providerProtocol,
    revisionIdentity: release.revisionId,
  });
  if (
    !Number.isSafeInteger(input.credentialVersion) ||
    input.credentialVersion < 1 ||
    !Number.isSafeInteger(input.providerConfigurationVersion) ||
    input.providerConfigurationVersion < 1 ||
    input.modelResultCount !== 1 ||
    totality.adapterId !== input.modelExecutionAdapterId ||
    totality.resultCount !== input.modelResultCount ||
    !bounded(input.modelId, 120) ||
    !bounded(input.modelExecutionAdapterId, 120) ||
    !bounded(input.modelConfigurationRevision, 500) ||
    !bounded(input.modelInputContractFingerprint, 500) ||
    !bounded(input.generationInputKey, 32_000) ||
    !bounded(input.generationOwnershipKey, 2_000) ||
    !bounded(input.providerDriver, 120) ||
    !bounded(input.providerModelId, 160) ||
    !bounded(input.providerProfileId, 120) ||
    !input.parameterSchema || typeof input.parameterSchema !== "object" ||
    Array.isArray(input.parameterSchema) ||
    release.modelId !== input.modelId ||
    release.document.modelId !== input.modelId ||
    release.document.capability !== input.modelCapability ||
    release.document.providerModelId !== input.providerModelId ||
    release.document.providerProfileId !== input.providerProfileId ||
    release.document.providerProtocol !== input.providerProtocol ||
    !sameValue(release.document.capabilitySchema, input.parameterSchema) ||
    (input.fixtureScopeId !== undefined &&
      (typeof input.fixtureScopeId !== "string" || input.fixtureScopeId.length > 120)) ||
    (input.workflowBinding !== undefined &&
      (!validWorkflowBinding(input.workflowBinding) ||
        input.workflowBinding.generationInputKey !== input.generationInputKey ||
        input.workflowBinding.generationOwnershipKey !==
          input.generationOwnershipKey ||
        input.workflowBinding.modelConfigurationRevision !==
          input.modelConfigurationRevision ||
        input.workflowBinding.modelReleaseRevision !== release.revisionId))
  ) {
    throw new Error("Authoritative generation model configuration is invalid");
  }
}

/** The sole builder for every current HTTP and durable-workflow admission. */
export function buildAuthoritativeGenerationModelConfiguration(
  input: AuthoritativeGenerationModelConfigurationInput,
): AuthoritativeGenerationModelConfiguration {
  assertAuthoritativeFields(input);
  const frozenInput: AuthoritativeGenerationModelConfigurationInput = {
    ...input,
    modelReleaseRevision: frozenStableClone(input.modelReleaseRevision),
    parameterSchema: frozenStableClone(input.parameterSchema),
    ...(input.workflowBinding
      ? { workflowBinding: frozenStableClone(input.workflowBinding) }
      : {}),
  };
  assertAuthoritativeFields(frozenInput);
  const brand: true = true;
  const configuration: AuthoritativeGenerationModelConfiguration = deepFreeze({
    [authoritativeGenerationModelConfigurationBrand]: brand,
    credentialVersion: frozenInput.credentialVersion,
    ...(frozenInput.fixtureScopeId !== undefined
      ? { fixtureScopeId: frozenInput.fixtureScopeId }
      : {}),
    generationIdentityVersion: 2,
    generationInputKey: frozenInput.generationInputKey,
    generationOwnershipKey: frozenInput.generationOwnershipKey,
    modelCapability: frozenInput.modelCapability,
    modelConfigurationRevision: frozenInput.modelConfigurationRevision,
    modelExecutionAdapterId: frozenInput.modelExecutionAdapterId,
    modelId: frozenInput.modelId,
    modelInputContractFingerprint: frozenInput.modelInputContractFingerprint,
    modelReleaseRevision: frozenInput.modelReleaseRevision,
    modelResultCount: frozenInput.modelResultCount,
    parameterSchema: frozenInput.parameterSchema,
    providerConfigurationVersion: frozenInput.providerConfigurationVersion,
    providerDriver: frozenInput.providerDriver,
    providerModelId: frozenInput.providerModelId,
    providerProfileId: frozenInput.providerProfileId,
    providerProtocol: frozenInput.providerProtocol,
    ...(frozenInput.workflowBinding
      ? { workflowBinding: frozenInput.workflowBinding }
      : {}),
  });
  return configuration;
}

export function assertAuthoritativeGenerationModelConfiguration(
  value: unknown,
): asserts value is AuthoritativeGenerationModelConfiguration {
  if (
    !brandedConfiguration(value)
  ) {
    throw new Error("Authoritative generation model configuration is required");
  }
  assertAuthoritativeFields(value);
}
