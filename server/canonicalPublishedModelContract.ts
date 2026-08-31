import { createHash } from "node:crypto";
import type { ModelParameterSchema } from "../types/modelParameters";
import {
  cleanParameterSchema,
  inheritProviderSemanticSchemaDefaults,
  knownModelParameterSchema,
  providerParameterSchema,
  validateParameterSchemaConstraints,
} from "../types/modelParameters";
import type { ProviderProtocol } from "../types/relayProtocols";
import type { GenerationCapabilityKind } from "../types/nodeVocabulary";
import type { ModelReleaseDocument } from "../types/modelReleaseRevisions";
import { compileModelExecutionContract } from "./modelExecutionContractCompiler";
import {
  assertRegisteredModelExecutionTotality,
  registeredModelExecution,
} from "./modelExecutionRegistry";
import { modelReleaseDocumentForId } from "./modelReleaseDefaults";

export type CanonicalPublishedModelContractInput = Readonly<{
  activeDocument?: ModelReleaseDocument;
  capability: GenerationCapabilityKind;
  costCurrency: "CNY" | "USD";
  defaultParameters: string | unknown;
  inheritProviderSemanticDefaults?: boolean;
  modelId: string;
  providerDriver: string;
  providerModelId: string;
  providerProfileId: string;
  providerProtocol: ProviderProtocol;
}>;

export type CanonicalContractDifference = Readonly<{
  after: unknown;
  before: unknown;
  path: string;
}>;

export type CanonicalPublishedModelContractErrorCode =
  | "PERSISTED_SCHEMA_JSON_INVALID"
  | "PERSISTED_SCHEMA_EMPTY"
  | "PERSISTED_SCHEMA_SHAPE_INVALID"
  | "PERSISTED_SCHEMA_VERSION_INVALID"
  | "PERSISTED_SCHEMA_CONSTRAINT_INVALID"
  | "EXECUTION_REGISTRY_UNREGISTERED"
  | "EXECUTION_REGISTRY_CURRENCY_MISMATCH"
  | "EXECUTION_TOTALITY_INVALID"
  | "TARGET_DOCUMENT_INVALID";

export class CanonicalPublishedModelContractError extends Error {
  constructor(
    readonly code: CanonicalPublishedModelContractErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CanonicalPublishedModelContractError";
  }
}

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

export function canonicalContractFingerprint(value: unknown) {
  const serialized = JSON.stringify(stable(value));
  return createHash("sha256")
    .update(serialized === undefined ? "undefined" : serialized)
    .digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionIdentity(document: ModelReleaseDocument) {
  return Object.freeze({
    capability: document.capability,
    connectorFamily: document.connectorFamily,
    connectorVersion: document.connectorVersion,
    evidence: document.evidence,
    executionContract: document.executionContract,
    modelId: document.modelId,
    providerModelId: document.providerModelId,
    providerProfileId: document.providerProfileId,
    providerProtocol: document.providerProtocol,
    runtime: document.runtime,
  });
}

function differences(before: unknown, after: unknown, path = "$"):
  CanonicalContractDifference[] {
  if (canonicalContractFingerprint(before) === canonicalContractFingerprint(after)) {
    return [];
  }
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([
      ...Object.keys(before).filter((key) => before[key] !== undefined),
      ...Object.keys(after).filter((key) => after[key] !== undefined),
    ])]
      .sort();
    return keys.flatMap((key) => differences(
      Object.prototype.hasOwnProperty.call(before, key) &&
          before[key] !== undefined
        ? before[key]
        : "<missing>",
      Object.prototype.hasOwnProperty.call(after, key) &&
          after[key] !== undefined
        ? after[key]
        : "<missing>",
      `${path}.${key}`,
    ));
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const count = Math.max(before.length, after.length);
    return Array.from({ length: count }, (_, index) => differences(
      index < before.length ? before[index] : "<missing>",
      index < after.length ? after[index] : "<missing>",
      `${path}[${index}]`,
    )).flat();
  }
  return [Object.freeze({ after: stable(after), before: stable(before), path })];
}

function parsedDefaultParameters(
  input: string | unknown,
  providerModelId: string,
) {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input) as unknown;
  } catch (error) {
    throw new CanonicalPublishedModelContractError(
      "PERSISTED_SCHEMA_JSON_INVALID",
      `模型 ${providerModelId} 的published参数schema不是有效JSON`,
      { cause: error },
    );
  }
}

export function canonicalPublishedCapabilitySchema(
  input: Pick<
    CanonicalPublishedModelContractInput,
    | "capability"
    | "defaultParameters"
    | "inheritProviderSemanticDefaults"
    | "providerDriver"
    | "providerModelId"
  >,
): ModelParameterSchema {
  const fallback = knownModelParameterSchema({
    capability: input.capability,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
  });
  const constraints = providerParameterSchema({
    capability: input.capability,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
  });
  const persisted = parsedDefaultParameters(
    input.defaultParameters,
    input.providerModelId,
  );
  if (!isRecord(persisted)) {
    throw new CanonicalPublishedModelContractError(
      "PERSISTED_SCHEMA_SHAPE_INVALID",
      `模型 ${input.providerModelId} 的published参数schema必须是对象`,
    );
  }
  if (Object.keys(persisted).length === 0) {
    throw new CanonicalPublishedModelContractError(
      "PERSISTED_SCHEMA_EMPTY",
      `模型 ${input.providerModelId} 的published参数schema不能为空`,
    );
  }
  if (persisted.version !== 2) {
    throw new CanonicalPublishedModelContractError(
      "PERSISTED_SCHEMA_VERSION_INVALID",
      `模型 ${input.providerModelId} 的published参数schema版本无效`,
    );
  }
  if (!Array.isArray(persisted.fields) || persisted.fields.length === 0) {
    throw new CanonicalPublishedModelContractError(
      "PERSISTED_SCHEMA_SHAPE_INVALID",
      `模型 ${input.providerModelId} 的published参数schema缺少字段定义`,
    );
  }
  try {
    const cleaned = cleanParameterSchema(
      input.capability,
      input.inheritProviderSemanticDefaults === false
        ? persisted
        : inheritProviderSemanticSchemaDefaults(persisted, constraints),
      fallback,
    );
    return validateParameterSchemaConstraints(cleaned, constraints);
  } catch (error) {
    const message = error instanceof Error ? error.message : "合同schema无效";
    throw new CanonicalPublishedModelContractError(
      "PERSISTED_SCHEMA_CONSTRAINT_INVALID",
      `模型 ${input.providerModelId} canonical合同解析失败: ${message}`,
      { cause: error },
    );
  }
}

/**
 * Pure canonical source for catalog, health, bootstrap, publish suggestions and
 * migration planning. It performs no I/O and never reads credentials.
 */
export function resolveCanonicalPublishedModelContract(
  input: CanonicalPublishedModelContractInput,
) {
  const capabilitySchema = canonicalPublishedCapabilitySchema(input);
  const descriptor = registeredModelExecution({
    capability: input.capability,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
    providerProtocol: input.providerProtocol,
  });
  if (!descriptor) {
    throw new CanonicalPublishedModelContractError(
      "EXECUTION_REGISTRY_UNREGISTERED",
      `模型 ${input.providerModelId} 缺少精确执行registry`,
    );
  }
  if (descriptor.costCurrency !== input.costCurrency) {
    throw new CanonicalPublishedModelContractError(
      "EXECUTION_REGISTRY_CURRENCY_MISMATCH",
      `模型 ${input.providerModelId} 的费用币种与精确执行registry不一致`,
    );
  }
  let totality: ReturnType<typeof assertRegisteredModelExecutionTotality>;
  try {
    totality = assertRegisteredModelExecutionTotality({
      capability: input.capability,
      capabilitySchema,
      providerDriver: input.providerDriver,
      providerModelId: input.providerModelId,
      providerProtocol: input.providerProtocol,
      revisionIdentity: input.activeDocument?.modelId ?? input.modelId,
    });
  } catch (error) {
    throw new CanonicalPublishedModelContractError(
      "EXECUTION_TOTALITY_INVALID",
      `模型 ${input.providerModelId} 的精确执行合同不完整`,
      { cause: error },
    );
  }
  const defaultTargetDocument = modelReleaseDocumentForId({
    capability: input.capability,
    capabilitySchema,
    modelId: input.modelId,
    providerDriver: input.providerDriver,
    providerModelId: input.providerModelId,
    providerProfileId: input.providerProfileId,
    providerProtocol: input.providerProtocol,
  });
  // Existing immutable histories own their documented connector/runtime
  // identity. A current-schema suggestion may replace only the canonical
  // capability schema; recreating the whole document from today's defaults
  // would silently reinterpret an otherwise healthy historical release.
  const targetDocument: ModelReleaseDocument = input.activeDocument
    ? Object.freeze({
        ...structuredClone(input.activeDocument),
        capabilitySchema: structuredClone(capabilitySchema),
      })
    : defaultTargetDocument;
  if (
    targetDocument.modelId !== input.modelId ||
    targetDocument.capability !== input.capability ||
    targetDocument.providerModelId !== input.providerModelId ||
    targetDocument.providerProfileId !== input.providerProfileId ||
    targetDocument.providerProtocol !== input.providerProtocol ||
    targetDocument.connectorFamily !== descriptor.connectorFamily ||
    targetDocument.evidence !== descriptor.evidence ||
    targetDocument.runtime !== descriptor.runtime
  ) {
    throw new CanonicalPublishedModelContractError(
      "TARGET_DOCUMENT_INVALID",
      `模型 ${input.providerModelId} 的canonical文档与精确执行registry不一致`,
    );
  }
  let executionFingerprint: string;
  try {
    executionFingerprint = compileModelExecutionContract(
      defaultTargetDocument.executionContract,
    ).hash;
    compileModelExecutionContract(targetDocument.executionContract);
  } catch (error) {
    throw new CanonicalPublishedModelContractError(
      "TARGET_DOCUMENT_INVALID",
      `模型 ${input.providerModelId} 的canonical执行合同无效`,
      { cause: error },
    );
  }
  const activeCapabilityDifferences = differences(
    input.activeDocument?.capabilitySchema ?? capabilitySchema,
    capabilitySchema,
  );
  const activeDocumentDifferences = input.activeDocument
    ? differences(input.activeDocument, targetDocument)
    : [];
  const activeExecutionIdentityDifferences = input.activeDocument
    ? differences(
        executionIdentity(input.activeDocument),
        executionIdentity(defaultTargetDocument),
      )
    : [];
  return Object.freeze({
    activeCapabilityDifferences: Object.freeze(activeCapabilityDifferences),
    activeDifferences: Object.freeze(activeCapabilityDifferences),
    activeDocumentDifferences: Object.freeze(activeDocumentDifferences),
    activeExecutionIdentityDifferences: Object.freeze(
      activeExecutionIdentityDifferences,
    ),
    capabilityFingerprint: canonicalContractFingerprint(capabilitySchema),
    capabilitySchema,
    descriptor,
    executionFingerprint,
    registryIdentity: Object.freeze({
      adapterId: descriptor.adapterId,
      connectorFamily: descriptor.connectorFamily,
      connectorVersion: defaultTargetDocument.connectorVersion,
      costCurrency: descriptor.costCurrency,
      evidence: descriptor.evidence,
      executionContractFingerprint: executionFingerprint,
      executionContractVersion:
        defaultTargetDocument.executionContract.version,
      logicalModelId: descriptor.logicalModelId,
      resultCount: descriptor.resultCount,
      runtime: descriptor.runtime,
    }),
    targetDocument,
    targetDocumentFingerprint: canonicalContractFingerprint(targetDocument),
    totality,
  });
}
