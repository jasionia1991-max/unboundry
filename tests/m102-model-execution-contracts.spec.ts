import { expect, test } from "./safe-test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compileModelContractPoll,
  compileModelContractRequest,
  compileModelExecutionContract,
  selectExecutionMode,
} from "../server/modelExecutionContractCompiler";
import {
  assertModelReleaseRevisionIntegrity,
  currentModelReleasePolicyDrift,
  inspectModelReleaseDocument,
  ModelContractConflictError,
  markModelContractsRequired,
  modelContractsRequired,
  modelContractState,
  publishModelContract,
  rollbackModelContract,
  saveModelContractDraft,
  setModelContractRevoked,
  upgradeModelContractRevision,
  validateModelContractDocument,
  validateModelContractDraft,
} from "../server/modelReleaseRevisionStore";
import { defaultModelReleaseDocument } from "../server/modelReleaseDefaults";
import {
  canonicalContractFingerprint,
  canonicalPublishedCapabilitySchema,
  resolveCanonicalPublishedModelContract,
} from "../server/canonicalPublishedModelContract";
import { analyzeModelContractTemplateCompatibility } from "../server/modelContractTemplateCompatibility";
import { recordAudit } from "../server/audit";
import {
  defaultParameterValues,
  defaultParameterSchema,
  knownModelParameterSchema,
  parameterConditionsMatch,
  parameterFieldRequired,
  providerParameterSchema,
  validateParameterValues,
  type ModelCapability,
  type ModelInputRolePolicy,
  type ModelParameterCondition,
  type ModelParameterSchema,
  type ModelParameterValue,
} from "../types/modelParameters";
import {
  normalizeModelInputs,
  type ModelSemanticInput,
} from "../types/modelInputSemanticCompiler";
import {
  pollContractRelayMediaTask,
  submitContractRelayMedia,
} from "../server/relayProviderAdapters";
import { modelReleaseBootstrapActorUserId } from "../server/modelReleaseBootstrap";
import { modelContractTemplateCompatibilitySignature } from "../server/modelCatalog";
import {
  assertActiveModelContractHealth,
  inspectActiveModelContractHealth,
} from "../server/activeModelContractHealth";
import { evaluateModelRuntimeAvailability } from "../server/modelAvailability";
import { workflowModelSelectionProblem } from
  "../client/src/generation/workflowExecution";
import {
  assertRelayMediaOutputCardinality,
  assertGenerationTaskModelReleaseSnapshotIntegrity,
  relayMediaParametersForTask,
} from "../server/generationTasks";
import {
  createIncGen018ModelContractUpgradeSafeTestHarness,
  planModelContractUpgrade,
  runModelContractUpgradeCli,
} from "../server/modelContractUpgrade";
import { openAppDatabase } from "../server/database";
import {
  incGen018ActiveModelContractFixtures,
} from "./fixtures/inc-gen-018-active-model-contracts";
import {
  assertFrozenTaskModelExecutionAdapter,
  assertModelExecutionRegistryTotality,
  assertRegisteredModelExecutionTotality,
  compileRegisteredModelTaskDecision,
  currentPublishedModelExecutionDescriptors,
  ExactModelExecutionRegistry,
  registeredModelExecution,
  shadowCompareRegisteredModelExecution,
  type ModelExecutionDescriptor,
} from "../server/modelExecutionRegistry";
import {
  incGen017FeatureFlags,
  incGen017GenerationEnabled,
} from "../server/incGen017FeatureFlags";
import type { ProviderProtocol } from "../types/relayProtocols";

const gkContract = {
  connectorFamily: "generic-async-media",
  connectorVersion: 1,
  create: { method: "POST", path: "/v1/media/generate", taskIdPath: "task_id" },
  modes: [
    {
      id: "text-to-video",
      prompt: "required",
      roles: [],
      bindings: [
        { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
        { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
      ],
    },
    {
      id: "first-frame-to-video",
      prompt: "required",
      roles: [{ id: "first-frame", kind: "image", minItems: 1, maxItems: 1, ordered: true, shape: "url" }],
      bindings: [
        { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
        { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
        { source: { kind: "role", roleId: "first-frame" }, transform: "array", target: { location: "json", path: "params.images" } },
      ],
    },
  ],
  poll: { method: "GET", path: "/v1/media/status", taskIdTarget: { location: "query", path: "task_id" } },
  result: { resultPath: "result_url", states: { failed: ["failed"], running: ["pending", "running"], succeeded: ["success"] } },
  version: 1,
} as const;

type PublishedModelSnapshotRow = Readonly<{
  capability: ModelCapability;
  providerDriver: string;
  providerModelId: string;
  providerProtocol: ProviderProtocol;
  costCurrency: "CNY" | "USD";
}>;

function publishedModelSnapshot() {
  const models = currentPublishedModelExecutionDescriptors.map((descriptor) => {
    const identity = descriptor.identities.find((candidate) =>
      candidate.providerModelId === descriptor.logicalModelId
    ) ?? descriptor.identities[0];
    if (!identity) throw new Error("published execution descriptor has no identity");
    return Object.freeze({
      capability: descriptor.capability,
      costCurrency: descriptor.costCurrency,
      providerDriver: identity.providerDriver,
      providerModelId: identity.providerModelId,
      providerProtocol: identity.providerProtocol,
    } satisfies PublishedModelSnapshotRow);
  });
  return Object.freeze({
    models: Object.freeze(models),
    publishedCount: models.length,
  });
}

function modelSchema(row: PublishedModelSnapshotRow) {
  return knownModelParameterSchema({
    capability: row.capability,
    providerDriver: row.providerDriver,
    providerModelId: row.providerModelId,
  });
}

test("v0.7.1 TT Image 2 owns the exact async recoverable release contract", () => {
  const active = incGen018ActiveModelContractFixtures[
    "cbaf438c-1c36-48e2-807d-4ce78367d0cf"
  ];
  const document = defaultModelReleaseDocument({
    capability: "image",
    capabilitySchema: active.capabilitySchema,
    modelId: "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
    providerDriver: "multi-protocol-relay",
    providerModelId: "tt-image-2",
    providerProfileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    providerProtocol: "media-generate",
  });
  const proof = inspectModelReleaseDocument(document);
  expect({
    compilerHash: proof.compilerHash,
    documentHash: proof.documentHash,
    schemaHash: canonicalContractFingerprint(document.capabilitySchema),
  }).toEqual({
    compilerHash:
      "d50a0345ea0e2e44252b5cd208eacc0fddf30afbbc8726523185f7c1b5689c25",
    documentHash:
      "a2693d360e1192a9bde9d2ccb2259f54f30cf0e6c315fd7cc9d10005171d2527",
    schemaHash:
      "d0b50d6f0f4b549472541abac05ce0b3d188c03c0c471e644d96a9e425bb7ba7",
  });
  expect(document).toMatchObject({
    connectorFamily: "specialized-code",
    documentation: [{
      checkedAt: "2026-09-02",
      url: "https://ycaigc.lk666.ai/apidoc",
    }],
    evidence: "EXACT",
    executionContract: { version: 2 },
    providerModelId: "tt-image-2",
    providerProtocol: "media-generate",
    runtime: "specialized-code",
  });
});

function activePolicyForMode(schema: ModelParameterSchema, mode: string) {
  const modeKey = schema.referencePolicy?.modeKey;
  const values = {
    ...defaultParameterValues(schema),
    ...(modeKey ? { [modeKey]: mode } : {}),
  };
  return schema.inputPolicy?.rolePolicies?.find((policy) =>
    parameterConditionsMatch(policy.enabledWhen, values)
  ) ?? (schema.inputPolicy
    ? { roles: schema.inputPolicy.roles ?? {} } satisfies ModelInputRolePolicy
    : undefined);
}

function maximumInputsForMode(
  schema: ModelParameterSchema,
  mode: string,
  set: { audio: number; image: number; video: number },
) {
  const policy = activePolicyForMode(schema, mode);
  const inputs: ModelSemanticInput[] = [];
  let order = 1;
  for (const kind of ["audio", "image", "video"] as const) {
    const limits = (policy?.limits ?? []).filter((limit) => limit.kind === kind);
    const requiredRoles = limits.flatMap((limit) =>
      Array.from({ length: limit.minCount }, () => limit.role)
    );
    const assignment = policy?.assignment?.[kind] ?? [];
    const allowed = policy?.roles[kind] ?? [];
    for (let index = 0; index < set[kind]; index += 1) {
      const role = requiredRoles[index] ?? assignment[index] ??
        allowed.find((candidate) => {
          const limit = limits.find((entry) => entry.role === candidate);
          return !limit || inputs.filter((item) =>
            item.kind === kind && item.role === candidate
          ).length < limit.maxCount;
        }) ?? allowed[0] ?? `reference-${kind}`;
      inputs.push({
        kind,
        order,
        role,
        semanticId: `${mode}:${kind}:${order}`,
      });
      order += 1;
    }
  }
  const textRole = policy?.roles.text?.[0];
  if (textRole) {
    inputs.push({
      kind: "text",
      order,
      role: textRole,
      semanticId: `${mode}:text:${order}`,
    });
  }
  return inputs;
}

function sourceInputCases(schema: ModelParameterSchema) {
  if (schema.referencePolicy) {
    return Object.entries(schema.referencePolicy.modes).flatMap(([mode, policy]) =>
      policy.sets.map((set, setIndex) => ({
        inputs: maximumInputsForMode(schema, mode, set),
        mode,
        setIndex,
      }))
    );
  }
  const policy = activePolicyForMode(schema, "default");
  const inputs: ModelSemanticInput[] = [];
  let order = 1;
  for (const kind of ["audio", "image", "text", "video"] as const) {
    const role = policy?.roles[kind]?.[0];
    if (!role) continue;
    inputs.push({ kind, order, role, semanticId: `default:${kind}:${order}` });
    order += 1;
  }
  return [{ inputs, mode: "default", setIndex: 0 }];
}

function activateCondition(
  values: Record<string, ModelParameterValue>,
  schema: ModelParameterSchema,
  condition: ModelParameterCondition,
) {
  const field = schema.fields.find((candidate) => candidate.key === condition.key);
  if (!field) return;
  const candidates = field.options.map((option) => option.value);
  if (condition.operator === "equals") values[condition.key] = condition.value!;
  if (condition.operator === "in") values[condition.key] = condition.values![0];
  if (condition.operator === "notEquals") {
    values[condition.key] = candidates.find((value) => value !== condition.value) ?? field.defaultValue;
  }
  if (condition.operator === "notIn") {
    values[condition.key] = candidates.find((value) => !condition.values?.includes(value)) ?? field.defaultValue;
  }
  if (condition.operator === "truthy") values[condition.key] = candidates.find(Boolean) ?? true;
  if (condition.operator === "falsy") values[condition.key] = candidates.find((value) => !value) ?? false;
}

function activatedValuesForField(
  schema: ModelParameterSchema,
  field: ModelParameterSchema["fields"][number],
) {
  const values = defaultParameterValues(schema);
  for (const condition of [
    ...(field.enabledWhen ?? []),
    ...(field.visibleWhen ?? []),
    ...(field.requiredWhen ?? []),
  ]) activateCondition(values, schema, condition);
  return values;
}

function semanticInputIdentity(inputs: readonly ModelSemanticInput[]) {
  return inputs.map((item) => ({
    kind: item.kind,
    order: item.order,
    semanticId: item.semanticId,
  }));
}

test("GK contract compiles deterministically and selects exactly one explicit mode", () => {
  const fixtures = [
    ["doubao-seed-2-0-lite-260428", "text", "www.volcengine.com"],
    ["doubao-seedance-2-0-mini-260615", "video", "www.volcengine.com"],
    ["gemini-3-pro-image-preview", "image", "ai.google.dev"],
    ["tt-image-2", "image", "ycaigc.lk666.ai"],
    ["grok-imagine-video-1.5-preview", "video", "docs.x.ai"],
    ["kling-v3-omni-cankao", "video", "app.klingai.com"],
    ["mureka-9", "audio", "platform.mureka.ai"],
  ] as const;
  for (const [providerModelId, capability, hostname] of fixtures) {
    const document = defaultModelReleaseDocument({
      capability,
      capabilitySchema: defaultParameterSchema(capability),
      modelId: `model-${providerModelId}`,
      providerDriver: providerModelId.startsWith("doubao-") ? "volcengine-ark" : "multi-protocol-relay",
      providerModelId,
      providerProfileId: "provider-fixture",
      providerProtocol: "media-generate",
    });
    expect(new URL(document.documentation[0]!.url).hostname).toBe(hostname);
  }
  expect(defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema: defaultParameterSchema("video"),
    modelId: "model-unknown",
    providerDriver: "multi-protocol-relay",
    providerModelId: "kwvideo-v2",
    providerProfileId: "provider-fixture",
    providerProtocol: "media-generate",
  }).documentation).toEqual([]);
  for (const [providerModelId, capability] of [
    ["doubao-tts-2.0", "audio"],
    ["grok-video-3", "video"],
    ["suno-v4.5", "audio"],
  ] as const) {
    expect(defaultModelReleaseDocument({
      capability,
      capabilitySchema: defaultParameterSchema(capability),
      modelId: `model-no-exact-doc-${providerModelId}`,
      providerDriver: "multi-protocol-relay",
      providerModelId,
      providerProfileId: "provider-fixture",
      providerProtocol: "media-generate",
    }).documentation).toEqual([]);
  }
  const first = compileModelExecutionContract(gkContract);
  const second = compileModelExecutionContract(structuredClone(gkContract));
  expect(first.hash).toBe(second.hash);
  expect(first.preview).toMatchObject({
    method: "POST",
    path: "/v1/media/generate",
  });
  expect(selectExecutionMode(first.contract, { prompt: "衣服转身", inputs: [] }).id)
    .toBe("text-to-video");
  expect(selectExecutionMode(first.contract, {
    prompt: "衣服转身",
    inputs: [{ kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/source.png" }],
  }).id).toBe("first-frame-to-video");
  expect(() => selectExecutionMode(first.contract, {
    prompt: "衣服转身",
    inputs: [
      { kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/a.png" },
      { kind: "image", order: 2, roleId: "first-frame", value: "https://example.invalid/b.png" },
    ],
  })).toThrow(/唯一输入模式/);
  expect(compileModelContractRequest(first.contract, {
    inputs: [{ kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/source.png" }],
    modelId: "grok-video-3",
    parameters: {},
    prompt: "衣服转身",
  })).toEqual({
    body: {
      model: "grok-video-3",
      params: { images: ["https://example.invalid/source.png"] },
      prompt: "衣服转身",
    },
    method: "POST",
    path: "/v1/media/generate",
    query: {},
  });
  expect(compileModelContractPoll(first.contract, "task-example")).toEqual({
    body: {}, method: "GET", path: "/v1/media/status", query: { task_id: "task-example" },
  });
  const capabilitySchema = defaultParameterSchema("video");
  const release = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema,
    modelId: "model-gk-video-3",
    providerDriver: "multi-protocol-relay",
    providerModelId: "grok-video-3",
    providerProfileId: "provider-relay",
    providerProtocol: "media-generate",
  });
  const compiledRelease = compileModelExecutionContract(release.executionContract);
  expect(compileModelContractRequest(compiledRelease.contract, {
    inputs: [],
    modelId: "grok-video-3",
    parameters: {
      aspectRatio: "16:9",
      duration: 5,
      generateAudio: true,
      resolution: "480p",
    },
    prompt: "衣服转身",
  })).toEqual({
    body: {
      model: "grok-video-3",
      params: {
        aspect_ratio: "16:9",
        duration: 5,
        generate_audio: true,
        resolution: "480p",
      },
      prompt: "衣服转身",
    },
    method: "POST",
    path: "/v1/media/generate",
    query: {},
  });
  expect(compiledRelease.contract.version).toBe(2);
  expect(compiledRelease.contract.modes).toEqual(expect.arrayContaining([
    expect.objectContaining({ evidence: "EXACT", id: "text-to-video", runtime: "declarative" }),
    expect.objectContaining({ evidence: "EXACT", id: "first-frame-to-video", runtime: "declarative" }),
  ]));
  const document = releaseDocument();
  const documentationOnly = {
    ...document,
    documentation: [{
      checkedAt: "2026-08-27",
      url: "https://provider.invalid/docs/v2",
    }],
  };
  const executionChanged = {
    ...document,
    executionContract: {
      ...document.executionContract,
      create: { ...document.executionContract.create, path: "/v1/media/generate-v2" },
    },
  };
  expect(modelContractTemplateCompatibilitySignature(document))
    .toBe(modelContractTemplateCompatibilitySignature(documentationOnly));
  expect(modelContractTemplateCompatibilitySignature(document))
    .not.toBe(modelContractTemplateCompatibilitySignature(executionChanged));
});

test("an unknown future model cannot inherit specialized-code publication", () => {
  const document = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema: defaultParameterSchema("video"),
    modelId: "model-future-unregistered",
    providerDriver: "multi-protocol-relay",
    providerModelId: "future-video-model-without-adapter",
    providerProfileId: "provider-fixture",
    providerProtocol: "media-generate",
  });
  expect(document.runtime).toBe("blocked");
  expect(document.evidence).toBe("UNKNOWN");
});

test("all ten current models have exact zero-Provider registry totality and shadow parity", () => {
  const { models: rows, publishedCount } = publishedModelSnapshot();
  expect(currentPublishedModelExecutionDescriptors).toHaveLength(rows.length);
  expect(rows).toHaveLength(publishedCount);
  for (const row of rows) {
    const capabilitySchema = modelSchema(row);
    const totality = assertRegisteredModelExecutionTotality({
      capability: row.capability,
      capabilitySchema,
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
      providerProtocol: row.providerProtocol,
      revisionIdentity: `current:${row.providerModelId}`,
    });
    expect(totality.resultCount).toBe(1);
    expect(totality.contractFingerprints.length).toBeGreaterThan(0);
    const shadow = shadowCompareRegisteredModelExecution({
      capability: row.capability,
      capabilitySchema,
      costCurrency: row.costCurrency,
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
      providerProtocol: row.providerProtocol,
      revisionIdentity: `current:${row.providerModelId}`,
    });
    expect(shadow).toMatchObject({
      differences: [],
      equal: true,
      providerRequests: 0,
    });
  }
  expect(() => assertRegisteredModelExecutionTotality({
    capability: "video",
    capabilitySchema: defaultParameterSchema("video"),
    providerDriver: "multi-protocol-relay",
    providerModelId: "future-video-model-without-adapter",
    providerProtocol: "media-generate",
  })).toThrow(/精确执行registry/);
});

test("publication rejects overlapping input modes without a complete normalization priority", () => {
  const schema = knownModelParameterSchema({
    capability: "video",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  });
  expect(schema.referencePolicy?.normalizationPriority).toBeDefined();
  const withoutPriority: ModelParameterSchema = {
    ...schema,
    referencePolicy: {
      ...schema.referencePolicy!,
      normalizationPriority: undefined,
    },
  };
  expect(() => assertRegisteredModelExecutionTotality({
    capability: "video",
    capabilitySchema: withoutPriority,
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
    providerProtocol: "native",
  })).toThrow(/规范化优先级/);
});

test("a frozen single-result task rejects relay multi-output before saving", () => {
  let mismatch: unknown;
  try {
    assertRelayMediaOutputCardinality({
      expectedResultCount: 1,
      outputs: [{ kind: "video" }, { kind: "video" }],
    });
  } catch (error) {
    mismatch = error;
  }
  expect(mismatch).toMatchObject({ code: "PROVIDER_RESULT_FORMAT" });
  expect(() => assertRelayMediaOutputCardinality({
    expectedResultCount: 1,
    outputs: [{ kind: "video" }],
  })).not.toThrow();
});

test("R5 builds the complete directed switch matrix from the current published registry", () => {
  const { models } = publishedModelSnapshot();
  const matrixPairs = new Set<string>();
  for (const source of models) {
    const sourceSchema = modelSchema(source);
    for (const sourceCase of sourceInputCases(sourceSchema)) {
      const sourceParameters = {
        ...defaultParameterValues(sourceSchema),
        ...(sourceSchema.referencePolicy
          ? { [sourceSchema.referencePolicy.modeKey]: sourceCase.mode }
          : {}),
      };
      const admittedSource = normalizeModelInputs({
        connectedInputs: sourceCase.inputs,
        modelReleaseRevision: `matrix-source:${source.providerModelId}`,
        requestedParameters: sourceParameters,
        schema: sourceSchema,
        transitionIntent: "execute",
      });
      expect(admittedSource.blockingProblems).toEqual([]);
      for (const target of models) {
        const pair = `${source.providerDriver}:${source.providerModelId}->${target.providerDriver}:${target.providerModelId}`;
        matrixPairs.add(pair);
        const before = semanticInputIdentity(admittedSource.normalizedSemanticInputs);
        if (source.capability !== target.capability) {
          expect(semanticInputIdentity(admittedSource.normalizedSemanticInputs)).toEqual(before);
          continue;
        }
        const targetSchema = modelSchema(target);
        const targetTotality = assertRegisteredModelExecutionTotality({
          capability: target.capability,
          capabilitySchema: targetSchema,
          providerDriver: target.providerDriver,
          providerModelId: target.providerModelId,
          providerProtocol: target.providerProtocol,
          revisionIdentity: `matrix-target:${target.providerModelId}`,
        });
        const transition = normalizeModelInputs({
          connectedInputs: admittedSource.normalizedSemanticInputs,
          modelReleaseRevision: `matrix-target:${target.providerModelId}`,
          requestedParameters: defaultParameterValues(targetSchema),
          schema: targetSchema,
          transitionIntent: "model-switch",
        });
        expect(semanticInputIdentity(transition.normalizedSemanticInputs)).toEqual(before);
        if (transition.blockingProblems.length) continue;
        const registeredMode = targetTotality.descriptor.modes[transition.selectedExecutionMode];
        expect(registeredMode).toBeTruthy();
        for (const input of transition.normalizedSemanticInputs) {
          expect(registeredMode.roles[input.kind] ?? []).toContain(input.role);
        }
      }
    }
  }
  expect(matrixPairs.size).toBe(models.length * models.length);
});

test("R5 proves every published model field boundary, golden decision, error and recovery", () => {
  const { models } = publishedModelSnapshot();
  for (const row of models) {
    const capabilitySchema = modelSchema(row);
    const totality = assertRegisteredModelExecutionTotality({
      capability: row.capability,
      capabilitySchema,
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
      providerProtocol: row.providerProtocol,
      revisionIdentity: `r5-property:${row.providerModelId}`,
    });
    const golden = compileRegisteredModelTaskDecision({
      capability: row.capability,
      capabilitySchema,
      costCurrency: row.costCurrency,
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
      providerProtocol: row.providerProtocol,
      revisionIdentity: `r5-golden:${row.providerModelId}`,
    });
    expect(golden).toMatchObject({
      adapterId: totality.adapterId,
      costCurrency: row.costCurrency,
      resultCount: 1,
    });
    expect(golden.descriptor).toMatchObject({
      logicalModelId: row.providerModelId,
      recoveryIdentity: ["taskId", "requestFingerprint", "modelReleaseRevision"],
      resultCount: 1,
      resultKind: row.capability,
    });
    expect(Object.keys(golden.descriptor.modes).sort()).toEqual(totality.modes);
    expect([...golden.descriptor.parameterKeys].sort()).toEqual(
      capabilitySchema.fields.map((field) => field.key).sort(),
    );

    for (const field of capabilitySchema.fields) {
      const base = activatedValuesForField(capabilitySchema, field);
      const candidates: ModelParameterValue[] = field.options.length
        ? field.options.map((option) => option.value)
        : field.type === "number"
          ? [...new Set([field.min ?? field.defaultValue, field.defaultValue, field.max ?? field.defaultValue])]
          : field.type === "text" || field.type === "textarea"
            ? ["x", "x".repeat(field.maxLength ?? 20_000)]
            : [field.defaultValue];
      for (const candidate of candidates) {
        const values = { ...base, [field.key]: candidate };
        for (const dependent of capabilitySchema.fields) {
          if (
            parameterFieldRequired(dependent, values) &&
            typeof values[dependent.key] === "string" &&
            !String(values[dependent.key]).trim()
          ) values[dependent.key] = "required";
        }
        expect(() => validateParameterValues(capabilitySchema, values)).not.toThrow();
      }
      if (field.type === "text" || field.type === "textarea") {
        const tooLong = {
          ...base,
          [field.key]: "x".repeat((field.maxLength ?? 20_000) + 1),
        };
        expect(() => validateParameterValues(capabilitySchema, tooLong)).toThrow(
          /Unsupported model parameter value/,
        );
      } else {
        const invalidValues = {
          ...base,
          [field.key]: "__r5_invalid__",
        };
        for (const dependent of capabilitySchema.fields) {
          if (
            parameterFieldRequired(dependent, invalidValues) &&
            typeof invalidValues[dependent.key] === "string" &&
            !String(invalidValues[dependent.key]).trim()
          ) invalidValues[dependent.key] = "required";
        }
        expect(() => validateParameterValues(capabilitySchema, invalidValues))
          .toThrow(/Unsupported model parameter value/);
      }
    }
    expect(() => validateParameterValues(capabilitySchema, {
      ...defaultParameterValues(capabilitySchema),
      unexpectedR5Field: true,
    })).toThrow(/Unsupported model parameter/);

    for (const sourceCase of sourceInputCases(capabilitySchema)) {
      const maximum = capabilitySchema.referencePolicy?.modes[sourceCase.mode]
        ?.sets[sourceCase.setIndex];
      const overflowKind = (["audio", "image", "video"] as const).find((kind) =>
        (maximum?.[kind] ?? 0) > 0
      );
      if (!overflowKind || !maximum) continue;
      const overflow = [
        ...sourceCase.inputs,
        {
          kind: overflowKind,
          order: sourceCase.inputs.length + 1,
          role: `reference-${overflowKind}`,
          semanticId: `overflow:${overflowKind}`,
        } satisfies ModelSemanticInput,
      ];
      const result = normalizeModelInputs({
        connectedInputs: overflow,
        modelReleaseRevision: `r5-overflow:${row.providerModelId}`,
        requestedParameters: {
          ...defaultParameterValues(capabilitySchema),
          [capabilitySchema.referencePolicy!.modeKey]: sourceCase.mode,
        },
        schema: capabilitySchema,
        transitionIntent: "execute",
      });
      if (!result.blockingProblems.length) {
        expect(result.selectedExecutionMode).not.toBe(sourceCase.mode);
      }
      expect(semanticInputIdentity(result.normalizedSemanticInputs)).toEqual(
        semanticInputIdentity(overflow),
      );
    }

    expect(() => compileRegisteredModelTaskDecision({
      capability: row.capability,
      capabilitySchema,
      costCurrency: row.costCurrency === "USD" ? "CNY" : "USD",
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
      providerProtocol: row.providerProtocol,
    })).toThrow(/费用币种/);
    expect(() => assertFrozenTaskModelExecutionAdapter({
      capability: row.capability,
      modelExecutionAdapterId: totality.adapterId,
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
      providerProtocol: row.providerProtocol,
    })).not.toThrow();
    expect(() => assertFrozenTaskModelExecutionAdapter({
      capability: row.capability,
      modelExecutionAdapterId: "invalid-r5-adapter",
      providerDriver: row.providerDriver,
      providerModelId: row.providerModelId,
      providerProtocol: row.providerProtocol,
    })).toThrow(/冻结adapter/);
  }
});

test("R5 admits a future model only after exact registration and rejects protocol-only fallback", () => {
  const futureDescriptor = Object.freeze({
    adapterId: "relay-media",
    capability: "video",
    connectorFamily: "generic-async-media",
    costCurrency: "USD",
    evidence: "EXACT",
    executionContractVersion: 1,
    identities: Object.freeze([{
      providerDriver: "multi-protocol-relay",
      providerModelId: "future-video-with-exact-adapter",
      providerProtocol: "media-generate",
    }]),
    logicalModelId: "future-video-with-exact-adapter",
    modes: Object.freeze({ default: Object.freeze({ roles: Object.freeze({}) }) }),
    parameterKeys: Object.freeze([
      "inputMode", "aspectRatio", "resolution", "duration", "generateAudio", "outputCount",
    ]),
    recoveryIdentity: Object.freeze([
      "taskId", "requestFingerprint", "modelReleaseRevision",
    ]),
    resultCount: 1,
    resultKind: "video",
    runtime: "declarative",
  } satisfies ModelExecutionDescriptor);
  const futureRegistry = new ExactModelExecutionRegistry([futureDescriptor]);
  const capabilitySchema = defaultParameterSchema("video");
  const exactProof = assertModelExecutionRegistryTotality(futureRegistry, {
    capability: "video",
    capabilitySchema,
    providerDriver: "multi-protocol-relay",
    providerModelId: "future-video-with-exact-adapter",
    providerProtocol: "media-generate",
    revisionIdentity: "future-exact:1",
  });
  expect(exactProof).toMatchObject({
    adapterId: "relay-media",
    modes: ["default"],
    resultCount: 1,
  });

  const protocolOnly = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema,
    modelId: "model-future-protocol-only",
    providerDriver: "multi-protocol-relay",
    providerModelId: "future-video-protocol-only",
    providerProfileId: "provider-fixture",
    providerProtocol: "media-generate",
  });
  expect(protocolOnly).toMatchObject({ evidence: "UNKNOWN", runtime: "blocked" });
  expect(() => assertModelExecutionRegistryTotality(futureRegistry, {
    capability: "video",
    capabilitySchema,
    providerDriver: "multi-protocol-relay",
    providerModelId: "future-video-protocol-only",
    providerProtocol: "media-generate",
  })).toThrow(/精确执行registry/);
});

test("INC-GEN-017 rollback switches fail closed and frozen historical tasks remain readable", () => {
  const previousModel = process.env.UNBOUNDRY_MODEL_INPUT_CONTRACT_V2;
  const previousWorkflow = process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2;
  try {
    process.env.UNBOUNDRY_MODEL_INPUT_CONTRACT_V2 = "0";
    process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2 = "0";
    expect(incGen017FeatureFlags()).toEqual({
      modelInputContractV2: false,
      workflowSelfHealingV2: false,
    });
    expect(incGen017GenerationEnabled()).toBe(false);
    process.env.UNBOUNDRY_MODEL_INPUT_CONTRACT_V2 = "1";
    expect(incGen017GenerationEnabled()).toBe(false);
    process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2 = "1";
    expect(incGen017GenerationEnabled()).toBe(true);
    expect(() => assertFrozenTaskModelExecutionAdapter({
      capability: "video",
      providerDriver: "multi-protocol-relay",
      providerModelId: "future-video-model-without-adapter",
      providerProtocol: "media-generate",
      modelExecutionAdapterId: "relay-media",
    })).toThrow(/冻结adapter/);
    expect(() => assertFrozenTaskModelExecutionAdapter({
      capability: "video",
      providerDriver: "historical-driver",
      providerModelId: "historical-model",
      providerProtocol: "native",
    })).not.toThrow();
  } finally {
    if (previousModel === undefined) delete process.env.UNBOUNDRY_MODEL_INPUT_CONTRACT_V2;
    else process.env.UNBOUNDRY_MODEL_INPUT_CONTRACT_V2 = previousModel;
    if (previousWorkflow === undefined) delete process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2;
    else process.env.UNBOUNDRY_WORKFLOW_SELF_HEALING_V2 = previousWorkflow;
  }
});

test("INC-GEN-017 stop-loss gate covers API admission and detached launch", () => {
  const api = readFileSync(
    join(process.cwd(), "server/generationTasksApi.ts"),
    "utf8",
  );
  const runtime = readFileSync(
    join(process.cwd(), "server/generationTasks.ts"),
    "utf8",
  );
  expect(api).toContain("incGen017ProtectedMutation");
  expect(api).toContain("!incGen017GenerationEnabled()");
  expect(api).toContain('code: "INC_GEN_017_STOP_LOSS"');
  expect(runtime).toContain("function launchGenerationTask(");
  expect(runtime).toContain("if (!incGen017GenerationEnabled())");
  expect(runtime).toContain('throw new Error("INC_GEN_017_STOP_LOSS")');
  const startup = runtime.slice(
    runtime.indexOf("export function initializePersistentGenerationTaskWorker"),
    runtime.indexOf("type TextTaskStore"),
  );
  expect(startup.indexOf("if (!incGen017GenerationEnabled())"))
    .toBeLessThan(startup.indexOf("failInterruptedRetryingGenerationTasks()"));
  const sweep = runtime.slice(
    runtime.indexOf("export async function runGenerationRecoverySweep"),
    runtime.indexOf("export function generationAvailability"),
  );
  expect(sweep.match(/!incGen017GenerationEnabled\(\)/g)?.length)
    .toBeGreaterThanOrEqual(2);
  const automaticRetry = runtime.slice(
    runtime.indexOf("async function autoRetryRelayTaskOnce"),
    runtime.indexOf("async function executeRelayMediaTask"),
  );
  expect(automaticRetry.match(/!incGen017GenerationEnabled\(\)/g)?.length)
    .toBeGreaterThanOrEqual(2);
});

test("relay recovery uses leased reads and the frozen declarative contract", () => {
  const runtime = readFileSync(
    join(process.cwd(), "server/generationTasks.ts"),
    "utf8",
  );
  const recovery = runtime.slice(
    runtime.indexOf("async function recoverRelayMediaAfterPoll"),
    runtime.indexOf("async function autoRetryRelayTaskOnce"),
  );
  expect(recovery).toContain("withProviderRequestLease({");
  expect(recovery).toContain("declarativeModelExecutionContract(current)");
  expect(recovery).toContain("modelExecutionContract: executionContract");
  const matching = runtime.slice(
    runtime.indexOf("async function autoMatchRelayProviderTask"),
    runtime.indexOf("async function executeRelayGptImageTask"),
  );
  expect(matching).toContain("withProviderRequestLease({");
  expect(matching).toContain("beforeRequest: providerBoundary()");
  const reconcile = runtime.slice(
    runtime.indexOf("async function inspectReconcileMediaProvider"),
    runtime.indexOf("async function pollReconcileProviderTask"),
  );
  expect(reconcile).toContain("withProviderRequestLease({");
  expect(reconcile).toContain("declarativeModelExecutionContract(task)");
  expect(reconcile).toContain("beforeProviderRequest: providerBoundary()");
});

test("GPT Image task execution is isolated from the generic async media route", () => {
  const runtime = readFileSync(
    join(process.cwd(), "server/generationTasks.ts"),
    "utf8",
  );
  const start = runtime.indexOf("async function executeRelayGptImageTask(");
  const end = runtime.indexOf("async function executeImageTask(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const route = runtime.slice(start, end);
  expect(route).toContain("sendPreparedRelayGptImageRequest(");
  expect(route).toContain('assertRelayProfile(currentProfile, "gpt-image")');
  expect(route).toContain("taskStore().markProviderResponseReceived({");
  expect(route).toContain('commitMode: "primary"');
  expect(route).toContain("expectedResultCount: 1");
  expect(route).not.toContain("executeRelayMediaTask(");
  expect(route).not.toContain("routeRelayProviderRequest(");
  expect(route).not.toContain('"/v1/media/generate"');
  expect(route).not.toContain('"/v1/media/status"');
});

test("compiler rejects executable, secret, arbitrary network and ambiguous contracts", () => {
  for (const mutation of [
    { ...gkContract, create: { ...gkContract.create, path: "https://evil.invalid/v1" } },
    { ...gkContract, create: { ...gkContract.create, path: "/v1/%2e%2e/admin" } },
    { ...gkContract, poll: undefined },
    { ...gkContract, modes: [{ ...gkContract.modes[0], bindings: [{ source: { kind: "env", name: "SECRET" }, target: { location: "header", path: "Authorization" } }] }] },
    { ...gkContract, modes: [gkContract.modes[0], { ...gkContract.modes[1], bindings: gkContract.modes[1].bindings.slice(0, 2) }] },
    { ...gkContract, modes: [gkContract.modes[0], { ...gkContract.modes[1], roles: [{ ...gkContract.modes[1].roles[0], shape: "file-id" }] }] },
    { ...gkContract, modes: [gkContract.modes[0], { ...gkContract.modes[1], bindings: gkContract.modes[1].bindings.map((item, index) => index === 2 ? { ...item, target: { location: "query", path: "params.images" } } : item) }] },
    { ...gkContract, modes: [{ ...gkContract.modes[0], bindings: [...gkContract.modes[0].bindings, { source: { kind: "constant", value: "bearer-secret-token" }, target: { location: "json", path: "params.mode" } }] }, gkContract.modes[1]] },
    { ...gkContract, modes: [...gkContract.modes, { ...gkContract.modes[0], id: "duplicate-text" }] },
    {
      ...gkContract,
      modes: [
        gkContract.modes[0],
        { ...gkContract.modes[0], id: "overlapping-optional", prompt: "optional" },
      ],
    },
  ]) {
    expect(() => compileModelExecutionContract(mutation as never)).toThrow();
  }
  const stringRole = compileModelExecutionContract({
    ...gkContract,
    modes: [gkContract.modes[0], {
      ...gkContract.modes[1],
      bindings: gkContract.modes[1].bindings.map((item, index) =>
        index === 2 ? { ...item, transform: "string" as const } : item
      ),
      roles: [{ ...gkContract.modes[1].roles[0], maxItems: 2 }],
    }],
  });
  expect(() => compileModelContractRequest(stringRole.contract, {
    inputs: [
      { kind: "image", order: 1, roleId: "first-frame", value: "https://example.invalid/a.png" },
      { kind: "image", order: 2, roleId: "first-frame", value: "https://example.invalid/b.png" },
    ],
    modelId: "grok-video-3",
    parameters: {},
    prompt: "衣服转身",
  })).toThrow(/多值素材/);
});

test("release validation binds runtime ownership and rejects credential-bearing sources", () => {
  const store = contractStore();
  try {
    const exactGptImages = [{
      modelId: "model-image-gpt-policy",
      providerDriver: "multi-protocol-relay",
      providerModelId: "gpt-image-2",
      providerProfileId: "provider-relay",
      providerProtocol: "gpt-image" as const,
    }, {
      modelId: "model-image-openrouter-gpt-policy",
      providerDriver: "openrouter",
      providerModelId: "openai/gpt-image-2",
      providerProfileId: "provider-openrouter",
      providerProtocol: "native" as const,
    }].map((identity) => defaultModelReleaseDocument({
      capability: "image",
      capabilitySchema: providerParameterSchema({
        capability: "image",
        providerDriver: identity.providerDriver,
        providerModelId: identity.providerModelId,
      })!,
      ...identity,
    }));
    for (const exactGptImage of exactGptImages) {
      const exact = saveModelContractDraft(
        store,
        "admin-a",
        exactGptImage,
        modelContractState(store, exactGptImage.modelId).draftVersion,
      );
      expect(() => validateModelContractDraft(
        store,
        "admin-a",
        exactGptImage.modelId,
        exact.draftVersion,
      )).not.toThrow();
      expect(() => publishModelContract(
        store,
        "admin-a",
        exactGptImage.modelId,
        exact.draftVersion,
      )).not.toThrow();
      for (const mutation of [
        { ...exactGptImage, evidence: "SPECIALIZED" as const },
        {
          ...exactGptImage,
          connectorFamily: "specialized-code" as const,
          connectorVersion: 1,
          executionContract: {
            ...exactGptImage.executionContract,
            connectorFamily: "specialized-code" as const,
            connectorVersion: 1,
            version: 2 as const,
          },
        },
        {
          ...exactGptImage,
          executionContract: {
            ...exactGptImage.executionContract,
            create: {
              ...exactGptImage.executionContract.create,
              path: "/v1/media/generate",
            },
          },
        },
      ]) {
        const rejected = saveModelContractDraft(
          store,
          "admin-a",
          mutation,
          modelContractState(store, mutation.modelId).draftVersion,
        );
        expect(() => validateModelContractDraft(
          store,
          "admin-a",
          mutation.modelId,
          rejected.draftVersion,
        )).toThrow(/GPT Image 2执行合同/);
      }
    }
    const spoofed = {
      ...releaseDocument("model-suno"),
      providerModelId: "suno-v4",
    } as const;
    const spoofedDraft = saveModelContractDraft(store, "admin-a", spoofed, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      spoofed.modelId,
      spoofedDraft.draftVersion,
    )).toThrow(/runtime/);
    const secretUrl = {
      ...releaseDocument("model-gk-secret-url"),
      documentation: [{
        checkedAt: "2026-08-26",
        url: "https://provider.invalid/docs?api_key=secret",
      }],
    } as const;
    const secretDraft = saveModelContractDraft(store, "admin-a", secretUrl, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      secretUrl.modelId,
      secretDraft.draftVersion,
    )).toThrow(/官方来源/);
    const schema = defaultParameterSchema("video");
    const exact = defaultModelReleaseDocument({
      capability: "video",
      capabilitySchema: schema,
      modelId: "model-gk-exact-role",
      providerDriver: "multi-protocol-relay",
      providerModelId: "grok-video-3",
      providerProfileId: "provider-relay",
      providerProtocol: "media-generate",
    });
    const extraRole = {
      ...exact,
      executionContract: {
        ...exact.executionContract,
        modes: [...exact.executionContract.modes, {
          bindings: [
            { source: { kind: "model-id" as const }, target: { location: "json" as const, path: "model" } },
            { source: { kind: "prompt" as const }, target: { location: "json" as const, path: "prompt" } },
            ...exact.executionContract.modes[0].bindings.filter((item) => item.source.kind === "parameter"),
            { source: { kind: "role" as const, roleId: "last-frame" }, transform: "array" as const, target: { location: "json" as const, path: "params.images" } },
          ],
          id: "last-frame-to-video",
          prompt: "required" as const,
          roles: [{ id: "last-frame", kind: "image" as const, maxItems: 1, minItems: 1, ordered: true, shape: "url" as const }],
        }],
      },
    };
    const extraRoleDraft = saveModelContractDraft(store, "admin-a", extraRole, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      extraRole.modelId,
      extraRoleDraft.draftVersion,
    )).toThrow(/GK执行合同/);
    const wrongTarget = {
      ...exact,
      modelId: "model-gk-wrong-target",
      executionContract: {
        ...exact.executionContract,
        modes: exact.executionContract.modes.map((mode) => ({
          ...mode,
          bindings: mode.bindings.map((item) =>
            item.source.kind === "parameter" && item.source.key === "duration"
              ? { ...item, target: { ...item.target, path: "params.not_provider_field" } }
              : item
          ),
        })),
      },
    };
    const wrongTargetDraft = saveModelContractDraft(store, "admin-a", wrongTarget, 0);
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      wrongTarget.modelId,
      wrongTargetDraft.draftVersion,
    )).toThrow(/GK执行合同/);
  } finally {
    store.close();
  }
});

function contractStore() {
  const store = new DatabaseSync(":memory:");
  store.exec(`
    CREATE TABLE admin_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id TEXT,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  return store;
}

function releaseDocument(modelId = "model-gk-video-3") {
  const baseSchema = defaultParameterSchema("video");
  const capabilitySchema = {
    ...baseSchema,
    fields: baseSchema.fields.filter((field) =>
      field.key === "inputMode" || field.key === "outputCount"
    ),
  };
  const current = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema,
    modelId,
    providerDriver: "multi-protocol-relay",
    providerModelId: "grok-video-3",
    providerProfileId: "provider-relay",
    providerProtocol: "media-generate",
  });
  return {
    ...current,
    documentation: [{ checkedAt: "2026-08-26", url: "https://provider.invalid/docs" }],
  } as const;
}

function exactReleaseDocument(modelId = "model-gk-video-3") {
  const capabilitySchema = canonicalPublishedCapabilitySchema({
    capability: "video",
    defaultParameters: knownModelParameterSchema({
      capability: "video",
      providerDriver: "multi-protocol-relay",
      providerModelId: "grok-video-3",
    }),
    providerDriver: "multi-protocol-relay",
    providerModelId: "grok-video-3",
  });
  const current = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema,
    modelId,
    providerDriver: "multi-protocol-relay",
    providerModelId: "grok-video-3",
    providerProfileId: "provider-relay",
    providerProtocol: "media-generate",
  });
  return {
    ...current,
    documentation: [{ checkedAt: "2026-08-26", url: "https://provider.invalid/docs" }],
  } as const;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function historicalGkRevision(modelId = "model-gk-video-3") {
  const current = releaseDocument(modelId);
  const document = { ...current, executionContract: gkContract } as const;
  return {
    createdAt: "2026-08-27T00:00:00.000Z",
    document,
    hash: sha(document),
    modelId,
    revisionId: "77010660-f111-4d80-a45b-6a137be3ca6d",
    revisionNumber: 1,
    validation: {
      compilerHash: compileModelExecutionContract(gkContract).hash,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
      paidProviderRequests: 0,
      preview: { modes: [] },
      validatedAt: "2026-08-27T00:00:00.000Z",
    },
  } as const;
}

test("frozen revision integrity is independent from current GK release policy", () => {
  const historical = historicalGkRevision();
  expect(currentModelReleasePolicyDrift(historical.document)).toMatchObject({
    code: "CURRENT_RELEASE_POLICY_MISMATCH",
    drifted: true,
  });
  expect(() => assertModelReleaseRevisionIntegrity(historical)).not.toThrow();
  expect(() => assertModelReleaseRevisionIntegrity({
    ...historical,
    hash: "0".repeat(64),
  })).toThrow(expect.objectContaining({
    code: "FROZEN_REVISION_DOCUMENT_HASH_MISMATCH",
  }));
  expect(() => assertModelReleaseRevisionIntegrity({
    ...historical,
    validation: { ...historical.validation, compilerHash: "0".repeat(64) },
  })).toThrow(expect.objectContaining({
    code: "FROZEN_REVISION_COMPILER_HASH_MISMATCH",
  }));
  const unsafeDocument = {
    ...historical.document,
    documentation: [{
      checkedAt: "2026-08-27",
      url: "https://provider.invalid/docs?api_key=secret",
    }],
  };
  expect(() => assertModelReleaseRevisionIntegrity({
    ...historical,
    document: unsafeDocument,
    hash: sha(unsafeDocument),
  })).toThrow(expect.objectContaining({
    code: "FROZEN_REVISION_DOCUMENT_INVALID",
  }));
  const unsupportedDocument = {
    ...historical.document,
    executionContract: { ...historical.document.executionContract, version: 3 },
  };
  expect(() => assertModelReleaseRevisionIntegrity({
    ...historical,
    document: unsupportedDocument,
    hash: sha(unsupportedDocument),
  })).toThrow();
  expect(() => assertGenerationTaskModelReleaseSnapshotIntegrity({
    ...historical,
    hash: "0".repeat(64),
  })).toThrow(expect.objectContaining({
    causeCode: "FROZEN_REVISION_DOCUMENT_HASH_MISMATCH",
    code: "PROVIDER_CONFIGURATION_MISMATCH",
  }));
});

test("explicit upgrade publishes revision 2 atomically and is idempotent", () => {
  const store = contractStore();
  try {
    const historical = historicalGkRevision();
    recordAudit(store, "admin-a", "model_contract.publish", null, {
      modelId: historical.modelId,
      revision: historical,
    });
    store.exec("CREATE TABLE release_target (revision_id TEXT NOT NULL)");
    const current = exactReleaseDocument();
    expect(() => upgradeModelContractRevision(store, "admin-a", {
      document: current,
      expectedActiveRevisionId: historical.revisionId,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
    }, (candidate) => {
      store.prepare("INSERT INTO release_target (revision_id) VALUES (?)")
        .run(candidate.revisionId);
      throw new Error("synthetic activation failure");
    })).toThrow(/synthetic activation failure/);
    expect(modelContractState(store, historical.modelId).history).toHaveLength(1);
    expect(modelContractState(store, historical.modelId).draft).toBeUndefined();
    expect(store.prepare("SELECT COUNT(*) AS count FROM release_target").get())
      .toEqual({ count: 0 });
    const upgraded = upgradeModelContractRevision(store, "admin-a", {
      document: current,
      expectedActiveRevisionId: historical.revisionId,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
    });
    expect(upgraded.changed).toBe(true);
    expect(upgraded.revision.revisionNumber).toBe(2);
    expect(upgraded.revision.document.executionContract.version).toBe(2);
    expect(upgraded.revision.predecessorRevisionId).toBe(historical.revisionId);
    const repeated = upgradeModelContractRevision(store, "admin-a", {
      document: current,
      expectedActiveRevisionId: upgraded.revision.revisionId,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
    });
    expect(repeated.changed).toBe(false);
    expect(modelContractState(store, historical.modelId).history).toHaveLength(2);
    expect(() => rollbackModelContract(
      store,
      "admin-a",
      historical.modelId,
      historical.revisionId,
    )).toThrow(expect.objectContaining({
      code: "CURRENT_RELEASE_POLICY_MISMATCH",
    }));
    expect(modelContractState(store, historical.modelId).history).toHaveLength(2);
    expect(markModelContractsRequired(store, "admin-a", {
      modelIds: [current.modelId],
      total: 1,
    })).toBe(true);
    expect(assertActiveModelContractHealth({
      capability: current.capability,
      costCurrency: "USD",
      defaultParameters: current.capabilitySchema,
      modelId: current.modelId,
      providerDriver: "multi-protocol-relay",
      providerModelId: current.providerModelId,
      providerProfileId: current.providerProfileId,
      providerProtocol: current.providerProtocol,
      store,
    }).revisionId).toBe(upgraded.revision.revisionId);
    expect(() => assertActiveModelContractHealth({
      capability: current.capability,
      costCurrency: "USD",
      defaultParameters: {
        ...current.capabilitySchema,
        referenceInputs: {
          ...current.capabilitySchema.referenceInputs,
          image: current.capabilitySchema.referenceInputs.image + 1,
        },
      },
      modelId: current.modelId,
      providerDriver: "multi-protocol-relay",
      providerModelId: current.providerModelId,
      providerProfileId: current.providerProfileId,
      providerProtocol: current.providerProtocol,
      store,
    })).toThrow(/active模型合同或精确执行registry无效/);
  } finally {
    store.close();
  }
});

test("execution semantics cannot change without a contract version bump", () => {
  const store = contractStore();
  try {
    const first = defaultModelReleaseDocument({
      capability: "audio",
      capabilitySchema: defaultParameterSchema("audio"),
      modelId: "model-suno-versioned",
      providerDriver: "multi-protocol-relay",
      providerModelId: "suno-v4.5",
      providerProfileId: "provider-relay",
      providerProtocol: "media-generate",
    });
    const draft = saveModelContractDraft(store, "admin-a", first, 0);
    validateModelContractDraft(store, "admin-a", first.modelId, draft.draftVersion);
    publishModelContract(store, "admin-a", first.modelId, draft.draftVersion);
    const changed = {
      ...first,
      capabilitySchema: {
        ...first.capabilitySchema,
        referenceInputs: {
          ...first.capabilitySchema.referenceInputs,
          image: first.capabilitySchema.referenceInputs.image + 1,
        },
      },
    };
    const changedDraft = saveModelContractDraft(store, "admin-a", changed, 1);
    validateModelContractDraft(
      store,
      "admin-a",
      first.modelId,
      changedDraft.draftVersion,
    );
    expect(() => publishModelContract(
      store,
      "admin-a",
      first.modelId,
      changedDraft.draftVersion,
    )).toThrow(expect.objectContaining({
      code: "EXECUTION_CONTRACT_VERSION_REQUIRED",
    }));
    const active = modelContractState(store, first.modelId).active!;
    expect(() => upgradeModelContractRevision(store, "admin-a", {
      document: changed,
      equivalentRuntimeSchemaTransition: "exact-legacy-grok-video-3-v2",
      expectedActiveRevisionId: active.revisionId,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
    })).toThrow(expect.objectContaining({
      code: "EXECUTION_CONTRACT_VERSION_REQUIRED",
    }));
    expect(() => upgradeModelContractRevision(store, "admin-a", {
      document: changed,
      equivalentRuntimeSchemaTransition: "exact-legacy-gpt-image-2-v1",
      expectedActiveRevisionId: active.revisionId,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
    })).toThrow(expect.objectContaining({
      code: "EXECUTION_CONTRACT_VERSION_REQUIRED",
    }));
    expect(() => upgradeModelContractRevision(store, "admin-a", {
      document: changed,
      equivalentRuntimeSchemaTransition:
        "exact-legacy-grok-imagine-video-1.5-v1",
      expectedActiveRevisionId: active.revisionId,
      impact: { incompatibleTemplateIds: [], templateIds: [] },
    })).toThrow(expect.objectContaining({
      code: "EXECUTION_CONTRACT_VERSION_REQUIRED",
    }));
  } finally {
    store.close();
  }
});

test("revision 1 first-frame tasks ignore composed instruction inputs and remain executable", async () => {
  const historical = historicalGkRevision();
  const parameters = await relayMediaParametersForTask({
    kind: "video",
    modelConfiguration: { modelReleaseRevision: historical },
    ownerId: "owner-a",
    parameters: {
      inputs: [
        { kind: "text", order: 1, role: "instruction", sourceNodeId: "text-source" },
        { assetId: "asset-first", kind: "image", order: 2, role: "first-frame", sourceNodeId: "image-source" },
      ],
    },
    prompt: "转身展示服装",
    providerModelId: "grok-video-3",
  }, async () => "https://cdn.example.test/first.png");
  expect(parameters).toEqual({ images: ["https://cdn.example.test/first.png"] });
  const textOnly = await relayMediaParametersForTask({
    kind: "video",
    modelConfiguration: { modelReleaseRevision: historical },
    ownerId: "owner-a",
    parameters: {
      inputs: [{ kind: "text", order: 1, role: "instruction", sourceNodeId: "text-source" }],
    },
    prompt: "纯文字生成视频",
    providerModelId: "grok-video-3",
  }, async () => "https://cdn.example.test/unused.png");
  expect(textOnly).toEqual({});
});

const productionGkAudit = JSON.parse(readFileSync(join(
  process.cwd(),
  "spec/MODEL_CONTRACT_002_PRODUCTION_TEMPLATE_MATRIX_2026-08-27.json",
), "utf8")) as {
  evidence: { captureMode: string; paidProviderRequests: number };
  normalizedNodeContract: {
    firstFrame: {
      inputOrder: number;
      inputRole: string;
      inputState: string;
      kind: string;
    };
    instruction: {
      inputOrder: number;
      inputRole: string;
      kind: string;
      nonEmpty: boolean;
    };
    nodeInputMode: string;
    parameters: Record<string, never>;
    promptReady: boolean;
  };
  observedEdgeMetadata: {
    firstFrameRoleExplicitNodes: number;
    instructionRoleRuntimeDefaultNodes: number;
    orderExplicitNodes: number;
    orderRuntimeFallbackNodes: string[];
  };
  observedSourceMetadata: {
    firstFrameAssetMaterializedNodes: number;
    firstFramePlaceholderNodes: number;
    instructionContentMaterializedNodes: number;
    instructionPromptReadyNodes: number;
  };
  templates: Record<string, string[]>;
};
const productionGkTemplateNodes = productionGkAudit.templates;

function productionGkTemplateRows(
  modelId = "model-gk-video-3",
  legacyStoredInputMode = false,
) {
  return Object.entries(productionGkTemplateNodes).map(([id, nodeIds]) => {
    const normalized = productionGkAudit.normalizedNodeContract;
    const sourceNodes = [
      { data: { content: "", label: "文字", textPrompt: normalized.instruction.nonEmpty ? "脱敏生产文字指令" : "", textPromptReady: true }, id: `${id}-text`, position: { x: 0, y: 0 }, type: normalized.instruction.kind, zIndex: 1 },
      { data: { label: "首帧" }, id: `${id}-image`, position: { x: 0, y: 300 }, type: normalized.firstFrame.kind, zIndex: 1 },
    ];
    const videoNodes = nodeIds.map((nodeId, index) => ({
      data: {
        label: "视频",
        inputMode: normalized.nodeInputMode,
        videoModelId: modelId,
        videoParameters: {
          ...productionGkAudit.normalizedNodeContract.parameters,
          ...(legacyStoredInputMode
            ? { inputMode: normalized.nodeInputMode }
            : {}),
        },
        videoPrompt: "脱敏生产提示词",
        videoPromptReady: productionGkAudit.normalizedNodeContract.promptReady,
      },
      id: nodeId,
      position: { x: 400, y: index * 300 },
      type: "video",
      zIndex: 1,
    }));
    const edges = nodeIds.flatMap((nodeId, index) => {
      const usesOrderFallback = productionGkAudit.observedEdgeMetadata
        .orderRuntimeFallbackNodes.includes(`${id}/${nodeId}`);
      return [
        {
          data: usesOrderFallback
            ? {}
            : { inputOrder: normalized.instruction.inputOrder },
          id: `${id}-text-${index}`,
          source: `${id}-text`,
          target: nodeId,
          type: "cuttable",
        },
        {
          data: usesOrderFallback
            ? { inputRole: normalized.firstFrame.inputRole }
            : {
                inputOrder: normalized.firstFrame.inputOrder,
                inputRole: normalized.firstFrame.inputRole,
              },
          id: `${id}-image-${index}`,
          source: `${id}-image`,
          target: nodeId,
          type: "cuttable",
        },
      ];
    });
    return { graph: JSON.stringify({ edges, nodes: [...sourceNodes, ...videoNodes], version: 1 }), id };
  });
}

test("sanitized production matrix keeps all 22 templates and 34 GK nodes compatible", () => {
  const modelId = "model-gk-video-3";
  expect(productionGkAudit.evidence).toEqual(expect.objectContaining({
    captureMode: "production-read-only-sanitized",
    modelId: "624827c6-5541-4cc8-93ac-4f9d5ce79602",
    paidProviderRequests: 0,
    productionRelease: "v0.6.51",
    schemaVersion: 41,
    sourceRevisionId: historicalGkRevision().revisionId,
  }));
  expect(productionGkAudit.normalizedNodeContract).toEqual({
    firstFrame: {
      inputOrder: 2,
      inputRole: "first-frame",
      inputState: "ready",
      kind: "image",
    },
    instruction: {
      inputOrder: 1,
      inputRole: "instruction",
      kind: "text",
      nonEmpty: true,
    },
    nodeInputMode: "reference",
    parameters: {},
    promptReady: true,
  });
  expect(productionGkAudit.observedEdgeMetadata).toEqual({
    firstFrameRoleExplicitNodes: 34,
    instructionRoleRuntimeDefaultNodes: 34,
    orderExplicitNodes: 27,
    orderRuntimeFallbackNodes: expect.arrayContaining([
      "00000000-0000-4000-8000-000000000111/template-node-4",
      "00000000-0000-4000-8000-000000000116/template-node-4",
    ]),
  });
  expect(productionGkAudit.observedSourceMetadata).toEqual({
    firstFrameAssetMaterializedNodes: 0,
    firstFramePlaceholderNodes: 34,
    instructionContentMaterializedNodes: 0,
    instructionPromptReadyNodes: 34,
  });
  const result = analyzeModelContractTemplateCompatibility({
    active: historicalGkRevision().document,
    proposed: releaseDocument(),
    rows: productionGkTemplateRows(modelId),
  });
  expect(result.templateIds).toHaveLength(22);
  expect(result.nodes).toHaveLength(34);
  expect(result.incompatibleTemplateIds).toEqual([]);
  expect(result.nodes.every((node) =>
    node.compatible && node.beforeModeId === "first-frame-to-video" &&
    node.afterModeId === "first-frame-to-video"
  )).toBe(true);
  const current = releaseDocument();
  const changedBinding = {
    ...current,
    executionContract: {
      ...current.executionContract,
      modes: current.executionContract.modes.map((mode) =>
        mode.id === "first-frame-to-video"
          ? {
              ...mode,
              bindings: mode.bindings.map((binding) =>
                binding.source.kind === "role"
                  ? {
                      ...binding,
                      target: { ...binding.target, path: "params.reference_images" },
                    }
                  : binding
              ),
            }
          : mode
      ),
    },
  };
  expect(analyzeModelContractTemplateCompatibility({
    active: historicalGkRevision().document,
    proposed: changedBinding as never,
    rows: productionGkTemplateRows(modelId),
  }).incompatibleTemplateIds).toHaveLength(22);
  const removedParameter = {
    ...current,
    capabilitySchema: {
      ...current.capabilitySchema,
      fields: current.capabilitySchema.fields.filter((field) =>
        field.key !== "outputCount"
      ),
    },
  };
  expect(analyzeModelContractTemplateCompatibility({
    active: historicalGkRevision().document,
    proposed: removedParameter,
    rows: productionGkTemplateRows(modelId),
  }).incompatibleTemplateIds).toHaveLength(22);
  const impossible = structuredClone(productionGkTemplateRows(modelId)[0]!);
  const impossibleGraph = JSON.parse(impossible.graph) as {
    edges: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
    version: number;
  };
  const firstFrameEdge = impossibleGraph.edges.find((edge) =>
    (edge.data as { inputRole?: string } | undefined)?.inputRole === "first-frame"
  )!;
  firstFrameEdge.data = { inputOrder: 2, inputRole: "reference-image" };
  const impossibleResult = analyzeModelContractTemplateCompatibility({
    active: historicalGkRevision().document,
    proposed: current,
    rows: [{ ...impossible, graph: JSON.stringify(impossibleGraph) }],
  });
  expect(impossibleResult.incompatibleTemplateIds).toEqual([impossible.id]);
  expect(impossibleResult.preexistingIncompatibleTemplateIds).toEqual([
    impossible.id,
  ]);
  const unknownParameter = structuredClone(productionGkTemplateRows(modelId)[0]!);
  const unknownParameterGraph = JSON.parse(unknownParameter.graph) as {
    nodes: Array<{ data: Record<string, unknown>; id: string }>;
  };
  unknownParameterGraph.nodes.find((node) => node.id === "template-node-4")!
    .data.videoParameters = { unsupportedParameter: true };
  expect(analyzeModelContractTemplateCompatibility({
    active: historicalGkRevision().document,
    proposed: current,
    rows: [{ ...unknownParameter, graph: JSON.stringify(unknownParameterGraph) }],
  }).incompatibleTemplateIds).toEqual([unknownParameter.id]);
  const invalidOrder = structuredClone(productionGkTemplateRows(modelId)[0]!);
  const invalidOrderGraph = JSON.parse(invalidOrder.graph) as {
    edges: Array<{ data: Record<string, unknown> }>;
  };
  invalidOrderGraph.edges[0]!.data.inputOrder = 0;
  expect(analyzeModelContractTemplateCompatibility({
    active: historicalGkRevision().document,
    proposed: current,
    rows: [{ ...invalidOrder, graph: JSON.stringify(invalidOrderGraph) }],
  }).incompatibleTemplateIds).toEqual([invalidOrder.id]);
});

const incGen018FixtureProviders = [
  {
    catalogCredentialRevision: false,
    configurationVersion: 1,
    driver: "multi-protocol-relay",
    id: "06831aee-5794-44cd-8e43-cc613eb60fdf",
    label: "Relay configuration 1",
  },
  {
    catalogCredentialRevision: false,
    configurationVersion: 1,
    driver: "mureka",
    id: "b8ee8c7a-6526-4a40-9d76-1d998f7d3eb0",
    label: "Mureka configuration 1",
  },
  {
    catalogCredentialRevision: false,
    configurationVersion: 2,
    driver: "multi-protocol-relay",
    id: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    label: "Relay configuration 2",
  },
  {
    catalogCredentialRevision: true,
    configurationVersion: 5,
    driver: "volcengine-ark",
    id: "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c",
    label: "Ark configuration 5",
  },
] as const;

const incGen018FixtureModels = [
  {
    capability: "video",
    costCurrency: "USD",
    displayName: "可灵-Omni 参考生",
    historyRevisionIds: ["9ebf4e43-1aff-4e83-9272-212cbc5113d9"],
    id: "3919d490-8739-490a-8bce-0678c27e4760",
    isDefault: 0,
    profileId: "06831aee-5794-44cd-8e43-cc613eb60fdf",
    protocol: "media-generate",
    providerModelId: "kling-v3-omni-cankao",
  },
  {
    capability: "audio",
    costCurrency: "USD",
    displayName: "Mureka V9",
    historyRevisionIds: [
      "b626484c-670c-4298-a9e5-90fbf87ee8bb",
      "dfbd24d0-9751-4145-9e95-1b8e074e7c94",
    ],
    id: "4d6196b4-00de-46ca-8011-383ad810a865",
    isDefault: 0,
    profileId: "b8ee8c7a-6526-4a40-9d76-1d998f7d3eb0",
    protocol: "native",
    providerModelId: "mureka-9",
  },
  {
    capability: "video",
    costCurrency: "USD",
    displayName: "grok-video-3",
    historyRevisionIds: [
      "77010660-f111-4d80-a45b-6a137be3ca6d",
      "e873a5c3-d0cd-4a7e-bc52-4b677285795b",
      "02571121-893e-440f-b45f-a913b3d8d7cf",
    ],
    id: "624827c6-5541-4cc8-93ac-4f9d5ce79602",
    isDefault: 1,
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "media-generate",
    providerModelId: "grok-video-3",
  },
  {
    capability: "audio",
    costCurrency: "USD",
    displayName: "Doubao TTS 2.0",
    historyRevisionIds: ["bc0bcfef-21a9-4f6f-aa50-71d3e43a64ad"],
    id: "65600fd0-739d-4359-9c9c-958e3ae49b05",
    isDefault: 1,
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "media-generate",
    providerModelId: "doubao-tts-2.0",
  },
  {
    capability: "audio",
    costCurrency: "USD",
    displayName: "Suno 音乐生成 4.5",
    historyRevisionIds: ["27cac2d0-3b99-452d-956f-4d59b916f3ed"],
    id: "65830fc7-3888-48ea-a842-87db6df65ec1",
    isDefault: 0,
    profileId: "06831aee-5794-44cd-8e43-cc613eb60fdf",
    protocol: "media-generate",
    providerModelId: "suno-v4.5",
  },
  {
    capability: "video",
    costCurrency: "CNY",
    displayName: "Seedance 2.0 Mini",
    historyRevisionIds: [
      "6cedb460-4047-4b2a-b23e-63180bf3df11",
      "a62f1d76-a416-4e29-a786-9474ead24e0d",
    ],
    id: "897d3dfc-83e4-48e9-a033-ca612338681b",
    isDefault: 0,
    profileId: "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c",
    protocol: "native",
    providerModelId: "doubao-seedance-2-0-mini-260615",
  },
  {
    capability: "image",
    costCurrency: "USD",
    displayName: "Nano Banana Pro",
    historyRevisionIds: ["ac2fdd8a-db1f-48b8-99b0-9391d1dad386"],
    id: "cb2e1041-33f5-49ff-bc99-994a97622db4",
    isDefault: 0,
    profileId: "06831aee-5794-44cd-8e43-cc613eb60fdf",
    protocol: "media-generate",
    providerModelId: "gemini-3-pro-image-preview",
  },
  {
    capability: "image",
    costCurrency: "USD",
    displayName: "GPT Image 2 · 专用协议",
    historyRevisionIds: [
      "a4b2ad53-54e4-43cb-a502-69e6c8e9390b",
      "35c5af5e-a7ea-45fc-88d2-8f54f9da65c6",
    ],
    id: "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
    isDefault: 1,
    maxCostMicrounits: 10_000_000,
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "gpt-image",
    providerModelId: "gpt-image-2",
  },
  {
    capability: "text",
    costCurrency: "CNY",
    displayName: "Doubao Seed",
    historyRevisionIds: ["6ab5deb8-b273-4b8e-a11e-6cf2560dcf9c"],
    id: "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
    isDefault: 1,
    profileId: "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c",
    protocol: "native",
    providerModelId: "doubao-seed-2-0-lite-260428",
  },
  {
    capability: "video",
    costCurrency: "USD",
    displayName: "grok-video-3.5",
    historyRevisionIds: [
      "16ecf19d-8329-4771-80e5-5db0f0e90cc2",
      "e3824408-b340-4b1a-b6de-34042f616854",
    ],
    id: "f2abd864-4e38-4081-af52-820629032033",
    isDefault: 0,
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "media-generate",
    providerModelId: "grok-imagine-video-1.5-preview",
  },
] as const;

type IncGen018Fixture = ReturnType<typeof seedIncGen018Fixture>;

function seedIncGen018Fixture(dataDirectory: string) {
  const harness = createIncGen018ModelContractUpgradeSafeTestHarness();
  const store = openAppDatabase(dataDirectory);
  const timestamp = "2026-08-30T00:00:00.000Z";
  store.exec(
    "DELETE FROM node_model_bindings;" +
      "DELETE FROM model_profiles;" +
      "DELETE FROM provider_profiles;" +
      "DELETE FROM admin_audit_events;",
  );
  store.prepare(
    "INSERT OR IGNORE INTO users (" +
      "id, login_name, display_name, password_hash, role, status, " +
      "created_at, updated_at, protected" +
      ") VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, 0)",
  ).run(
    "admin-a",
    "admin-a",
    "Admin A",
    "test-only",
    timestamp,
    timestamp,
  );
  for (const provider of incGen018FixtureProviders) {
    store.prepare(
      "INSERT INTO provider_profiles (" +
        "id, display_name, driver, status, key_status, " +
        "catalog_credential_revision, provider_configuration_version, " +
        "created_at, updated_at" +
        ") VALUES (?, ?, ?, 'enabled', 'valid', ?, ?, ?, ?)",
    ).run(
      provider.id,
      provider.label,
      provider.driver,
      provider.catalogCredentialRevision
        ? harness.catalogCredentialRevision
        : null,
      provider.configurationVersion,
      timestamp,
      timestamp,
    );
  }
  for (const [sortOrder, model] of incGen018FixtureModels.entries()) {
    const document = structuredClone(
      incGen018ActiveModelContractFixtures[model.id],
    );
    const proof = inspectModelReleaseDocument(document);
    store.prepare(
      "INSERT INTO model_profiles (" +
        "id, display_name, provider_profile_id, provider_model_id, " +
        "capability, status, default_parameters, max_cost_microunits, " +
        "cost_currency, archived_at, published_at, provider_protocol, " +
        "created_at, updated_at" +
      ") VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?, NULL, ?, ?, ?, ?)",
    ).run(
      model.id,
      model.displayName,
      model.profileId,
      model.providerModelId,
      model.capability,
      JSON.stringify(document.capabilitySchema),
      "maxCostMicrounits" in model ? model.maxCostMicrounits : 0,
      model.costCurrency,
      timestamp,
      model.protocol,
      timestamp,
      timestamp,
    );
    store.prepare(
      "INSERT INTO node_model_bindings (" +
        "node_type, model_id, enabled, is_default, sort_order, " +
        "created_at, updated_at" +
        ") VALUES (?, ?, 1, ?, ?, ?, ?)",
    ).run(
      model.capability,
      model.id,
      model.isDefault,
      sortOrder,
      timestamp,
      timestamp,
    );
    for (
      let revisionIndex = 0;
      revisionIndex < model.historyRevisionIds.length;
      revisionIndex += 1
    ) {
      const revision = {
        createdAt: timestamp,
        document: structuredClone(document),
        hash: proof.documentHash,
        modelId: model.id,
        ...(revisionIndex > 0
          ? {
              predecessorRevisionId:
                model.historyRevisionIds[revisionIndex - 1],
            }
          : {}),
        revisionId: model.historyRevisionIds[revisionIndex],
        revisionNumber: revisionIndex + 1,
        validation: {
          compilerHash: proof.compilerHash,
          impact: { incompatibleTemplateIds: [], templateIds: [] },
          paidProviderRequests: 0,
          preview: { modes: [] },
          validatedAt: timestamp,
        },
      };
      assertModelReleaseRevisionIntegrity(revision);
      recordAudit(
        store,
        "admin-a",
        "model_contract.publish",
        null,
        { modelId: model.id, revision },
      );
    }
  }
  expect(markModelContractsRequired(store, "admin-a", {
    modelIds: incGen018FixtureModels.map((model) => model.id),
    total: incGen018FixtureModels.length,
  })).toBe(true);
  return { dataDirectory, harness, store };
}

function createIncGen018Fixture(): IncGen018Fixture {
  const dataDirectory = mkdtempSync(
    join(tmpdir(), "unboundry-inc-gen-018-upgrade-"),
  );
  return seedIncGen018Fixture(dataDirectory);
}

function openIncGen018Fixture(dataDirectory: string): IncGen018Fixture {
  return {
    dataDirectory,
    harness: createIncGen018ModelContractUpgradeSafeTestHarness(),
    store: openAppDatabase(dataDirectory),
  };
}

function closeIncGen018Fixture(fixture: IncGen018Fixture) {
  fixture.store.close();
  rmSync(fixture.dataDirectory, { force: true, recursive: true });
}

function rawUpgradeMutationSnapshot(store: DatabaseSync) {
  return JSON.stringify({
    audit: store.prepare(
      "SELECT id, actor_user_id, action, target_user_id, details, created_at " +
        "FROM admin_audit_events ORDER BY id",
    ).all(),
    bindings: store.prepare(
      "SELECT node_type, model_id, enabled, is_default, sort_order, " +
        "created_at, updated_at FROM node_model_bindings " +
        "ORDER BY node_type, model_id",
    ).all(),
    models: store.prepare(
      "SELECT id, display_name, provider_profile_id, provider_model_id, " +
        "capability, status, default_parameters, max_cost_microunits, " +
        "cost_currency, archived_at, published_at, provider_protocol, " +
        "created_at, updated_at FROM model_profiles ORDER BY id",
    ).all(),
  });
}

function databaseByteIdentity(dataDirectory: string) {
  return ["unboundry.sqlite", "unboundry.sqlite-wal"]
    .map((name) => ({ name, path: join(dataDirectory, name) }))
    .filter(({ path }) => existsSync(path))
    .map(({ name, path }) => {
      const bytes = readFileSync(path);
      return {
        bytes: bytes.byteLength,
        name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
}

function insertQuietTask(
  store: DatabaseSync,
  id: string,
  state: "failed" | "running",
  errorCode?: string,
) {
  store.prepare(
    "INSERT INTO generation_tasks (" +
      "id, canvas_id, node_id, kind, prompt, parameters, " +
      "idempotency_key, request_fingerprint, state, attempt, " +
      "error_code, created_at, updated_at, model_configuration, " +
      "credential_revision" +
      ") VALUES (?, ?, ?, 'image', 'fixture', '{}', ?, ?, ?, 1, ?, ?, ?, '{}', 1)",
  ).run(
    id,
    "canvas-" + id,
    "node-" + id,
    "idempotency-" + id,
    "fingerprint-" + id,
    state,
    errorCode ?? null,
    "2026-08-30T00:00:00.000Z",
    "2026-08-30T00:00:00.000Z",
  );
}

function insertUnknownAttempt(
  store: DatabaseSync,
  taskId: string,
  evidence: "historical-execution-attempt" | "provider-boundary",
  finished: boolean,
) {
  store.prepare(
    "INSERT INTO generation_provider_attempts (" +
      "task_id, execution_attempt, provider_profile_id, provider_model_id, " +
      "kind, evidence, created_at, finished_at, credential_revision, outcome" +
      ") VALUES (?, 1, ?, ?, 'image', ?, ?, ?, 1, 'outcome-unknown')",
  ).run(
    taskId,
    "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    "gpt-image-2",
    evidence,
    "2026-08-30T00:00:00.000Z",
    finished ? "2026-08-30T00:01:00.000Z" : null,
  );
}

function applyFixturePlan(fixture: IncGen018Fixture) {
  const plan = fixture.harness.plan(fixture.store);
  return fixture.harness.apply(fixture.store, "admin-a", {
    expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
    expectedPlanHash: plan.planHash,
  });
}

test("INC-GEN-018 CLI requires dual hashes and an exact recovery attestation", () => {
  expect(() => runModelContractUpgradeCli(["--data-dir", "relative"]))
    .toThrow(/绝对隔离数据目录/);
  expect(() => runModelContractUpgradeCli(["--data-dir", "/tmp", "--unknown"]))
    .toThrow(/参数无效/);
  expect(() => runModelContractUpgradeCli([
    "--data-dir",
    "/tmp",
    "--staging-root",
    "/tmp",
    "--expected-plan-hash",
    "0".repeat(64),
    "--expected-attestation-sha256",
    "0".repeat(64),
    "--apply",
  ])).toThrow(/expected-baseline-hash/);

  const stagingRoot = mkdtempSync(
    join(tmpdir(), "unboundry-inc-gen-018-cli-"),
  );
  const dataDirectory = join(stagingRoot, "snapshot");
  mkdirSync(dataDirectory);
  chmodSync(dataDirectory, 0o700);
  const fixture = seedIncGen018Fixture(dataDirectory);
  const publicPlan = planModelContractUpgrade(fixture.store);
  fixture.store.close();
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const markerPath = join(
    dataDirectory,
    ".model-contract-upgrade-recovery.json",
  );
  const writeMarker = (purpose: string) => {
    const databaseBytes = readFileSync(databasePath);
    const marker = {
      dataDirectoryRealPath: realpathSync(dataDirectory),
      databaseFileName: "unboundry.sqlite",
      databaseSha256:
        createHash("sha256").update(databaseBytes).digest("hex"),
      databaseSizeBytes: statSync(databasePath).size,
      purpose,
      schemaVersion: 42,
      snapshotId: "inc-gen-018-cli-fixture",
    };
    if (existsSync(markerPath)) chmodSync(markerPath, 0o600);
    const bytes = JSON.stringify(marker) + "\n";
    writeFileSync(markerPath, bytes);
    chmodSync(markerPath, 0o400);
    return createHash("sha256").update(bytes).digest("hex");
  };
  try {
    const wrongPurposeSha = writeMarker("MODEL-CONTRACT-002");
    expect(() => runModelContractUpgradeCli([
      "--data-dir",
      dataDirectory,
      "--staging-root",
      stagingRoot,
      "--expected-baseline-hash",
      publicPlan.baselineSnapshotHash,
      "--expected-plan-hash",
      publicPlan.planHash,
      "--expected-attestation-sha256",
      wrongPurposeSha,
      "--apply",
    ])).toThrow(/待升级数据库不匹配/);

    const attestationSha = writeMarker("INC-GEN-018");
    expect(() => runModelContractUpgradeCli([
      "--data-dir",
      dataDirectory,
      "--staging-root",
      stagingRoot,
      "--expected-baseline-hash",
      publicPlan.baselineSnapshotHash,
      "--expected-plan-hash",
      publicPlan.planHash,
      "--expected-attestation-sha256",
      attestationSha,
      "--apply",
    ])).toThrow(/当前schema\/10模型精确基线/);
  } finally {
    rmSync(stagingRoot, { force: true, recursive: true });
  }
});

test("contract planner selects Seed, TTS and the v0.7.1 TT Image async transition", () => {
  const fixture = createIncGen018Fixture();
  try {
    const plan = fixture.harness.plan(fixture.store);
    expect(plan).toMatchObject({
      actionCounts: {
        blockedInvalidActive: 0,
        blockedUnclassifiedDrift: 0,
        none: 7,
        publishRevision: 3,
      },
      auditedModelCount: 10,
      catalogIdentityMatchCount: 10,
      exactExecutionIdentityCount: 10,
      missingExpectedModelIds: [],
      paidProviderRequests: 0,
      publishedModelCount: 10,
      schemaVersion: 42,
      unexpectedPublishedModelIds: [],
    });
    expect(plan.models.map((model) => model.modelId)).toEqual(
      incGen018FixtureModels.map((model) => model.id).sort(),
    );
    const transitions = plan.models.filter(
      (model) => model.action === "publish-revision",
    );
    expect(transitions.map((model) => model.modelId).sort()).toEqual([
      "65600fd0-739d-4359-9c9c-958e3ae49b05",
      "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
      "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
    ]);
    for (const transition of transitions) {
      expect(transition.executionIdentityState).toBe("exact-pre");
      if (transition.modelId === "cbaf438c-1c36-48e2-807d-4ce78367d0cf") {
        expect(transition.activeCapabilityDifferences).toEqual([]);
        expect(transition.activeDocumentDifferences.map(({ path }) => path))
          .toEqual(expect.arrayContaining([
            "$.connectorFamily",
            "$.executionContract.version",
            "$.providerModelId",
            "$.providerProtocol",
          ]));
      } else {
        expect(transition.activeCapabilityDifferences.map(({ path }) => path))
          .toEqual(["$.inputPolicy"]);
        expect(transition.activeDocumentDifferences.map(({ path }) => path))
          .toEqual(["$.capabilitySchema.inputPolicy"]);
      }
    }
    expect(transitions.find((model) =>
      model.modelId === "65600fd0-739d-4359-9c9c-958e3ae49b05"
    )).toMatchObject({
      proposedDocumentHash:
        "4d89f4032e7721d9f396d18cda3dfd5181906625042934bbb97c961378113e56",
      proposedSchemaHash:
        "15d30ed0e85c5a6a54242cce5ac48a72c9848fe5313cea81e6769b4f58859ad2",
    });
    expect(transitions.find((model) =>
      model.modelId === "cbaf438c-1c36-48e2-807d-4ce78367d0cf"
    )).toMatchObject({
      displayName: "TT Image 2 · 异步可恢复",
      proposedCompilerHash:
        "d50a0345ea0e2e44252b5cd208eacc0fddf30afbbc8726523185f7c1b5689c25",
      proposedDocumentHash:
        "a2693d360e1192a9bde9d2ccb2259f54f30cf0e6c315fd7cc9d10005171d2527",
      proposedSchemaHash:
        "d0b50d6f0f4b549472541abac05ce0b3d188c03c0c471e644d96a9e425bb7ba7",
      providerModelId: "tt-image-2",
      transition: "exact-gpt-image-2-async-v2",
    });
    expect(transitions.find((model) =>
      model.modelId === "ee51d65e-c924-4a9a-b224-6c4ee180a0ce"
    )).toMatchObject({
      proposedDocumentHash:
        "5a2556c9f18cb1e2d46e0ffaecc8025eff93244def1e4f8d8fea4e54322197e9",
      proposedSchemaHash:
        "05cf5e3e6433ebb90d4ad21ff14d8c205b63e84bb0ba8536e0e939a031d7cfc4",
    });
  } finally {
    closeIncGen018Fixture(fixture);
  }
});

test("INC-GEN-018 blocks near misses, invalid active revisions and an unexpected eleventh model before writes", () => {
  const scenarios = [
    {
      assert(plan: ReturnType<IncGen018Fixture["harness"]["plan"]>) {
        const model = plan.models.find((item) =>
          item.modelId === "ee51d65e-c924-4a9a-b224-6c4ee180a0ce"
        );
        expect(model).toMatchObject({
          action: "blocked-unclassified-drift",
          blockers: ["APPROVED_TARGET_NOT_EXACT_PRE_OR_POST_STATE"],
        });
      },
      mutate(fixture: IncGen018Fixture) {
        const row = fixture.store.prepare(
          "SELECT default_parameters FROM model_profiles WHERE id = ?",
        ).get("ee51d65e-c924-4a9a-b224-6c4ee180a0ce") as {
          default_parameters: string;
        };
        fixture.store.prepare(
          "UPDATE model_profiles SET default_parameters = ? WHERE id = ?",
        ).run(
          JSON.stringify(JSON.parse(row.default_parameters), null, 1),
          "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
        );
      },
    },
    {
      assert(plan: ReturnType<IncGen018Fixture["harness"]["plan"]>) {
        expect(plan.models.find((item) =>
          item.modelId === "3919d490-8739-490a-8bce-0678c27e4760"
        )).toMatchObject({
          action: "blocked-invalid-active",
          blockers: ["FROZEN_REVISION_INTEGRITY_INVALID"],
        });
      },
      mutate(fixture: IncGen018Fixture) {
        const rows = fixture.store.prepare(
          "SELECT id, details FROM admin_audit_events " +
            "WHERE action = 'model_contract.publish' ORDER BY id",
        ).all() as Array<{ details: string; id: number }>;
        const active = [...rows].reverse().find((row) =>
          JSON.parse(row.details).modelId ===
            "3919d490-8739-490a-8bce-0678c27e4760"
        )!;
        const details = JSON.parse(active.details);
        details.revision.hash = "0".repeat(64);
        fixture.store.prepare(
          "UPDATE admin_audit_events SET details = ? WHERE id = ?",
        ).run(JSON.stringify(details), active.id);
      },
    },
    {
      assert(plan: ReturnType<IncGen018Fixture["harness"]["plan"]>) {
        expect(plan).toMatchObject({
          auditedModelCount: 11,
          publishedModelCount: 11,
          unexpectedPublishedModelIds: ["ffffffff-ffff-4fff-8fff-fffffffffff8"],
        });
        expect(plan.models.find((item) =>
          item.modelId === "ffffffff-ffff-4fff-8fff-fffffffffff8"
        )).toMatchObject({
          action: "blocked-unclassified-drift",
          blockers: ["PUBLISHED_MODEL_NOT_IN_R0_BASELINE"],
        });
      },
      mutate(fixture: IncGen018Fixture) {
        const source = fixture.store.prepare(
          "SELECT * FROM model_profiles WHERE id = ?",
        ).get("3919d490-8739-490a-8bce-0678c27e4760") as {
          capability: string;
          cost_currency: string;
          created_at: string;
          default_parameters: string;
          max_cost_microunits: number;
          provider_profile_id: string;
          provider_protocol: string;
          published_at: string;
          updated_at: string;
        };
        fixture.store.prepare(
          "INSERT INTO model_profiles (" +
            "id, display_name, provider_profile_id, provider_model_id, " +
            "capability, status, default_parameters, max_cost_microunits, " +
            "cost_currency, archived_at, published_at, provider_protocol, " +
            "created_at, updated_at" +
            ") VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?, NULL, ?, ?, ?, ?)",
        ).run(
          "ffffffff-ffff-4fff-8fff-fffffffffff8",
          "Unexpected published model",
          source.provider_profile_id,
          "unexpected-model",
          source.capability,
          source.default_parameters,
          source.max_cost_microunits,
          source.cost_currency,
          source.published_at,
          source.provider_protocol,
          source.created_at,
          source.updated_at,
        );
      },
    },
  ] as const;

  for (const scenario of scenarios) {
    const fixture = createIncGen018Fixture();
    try {
      scenario.mutate(fixture);
      const plan = fixture.harness.plan(fixture.store);
      scenario.assert(plan);
      const before = rawUpgradeMutationSnapshot(fixture.store);
      expect(() => fixture.harness.apply(fixture.store, "admin-a", {
        expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
        expectedPlanHash: plan.planHash,
      })).toThrow(/当前schema\/10模型精确基线/);
      expect(rawUpgradeMutationSnapshot(fixture.store)).toBe(before);
    } finally {
      closeIncGen018Fixture(fixture);
    }
  }
});

test("INC-GEN-018 quiet gate blocks active/current-unknown/unsettled-boundary evidence without writes", () => {
  const scenarios = [
    (fixture: IncGen018Fixture) => {
      insertQuietTask(fixture.store, "quiet-active", "running");
    },
    (fixture: IncGen018Fixture) => {
      insertQuietTask(
        fixture.store,
        "quiet-current-unknown",
        "failed",
        "OUTCOME_UNKNOWN_BILLING_RISK",
      );
    },
    (fixture: IncGen018Fixture) => {
      insertQuietTask(fixture.store, "quiet-provider-boundary", "failed");
      insertUnknownAttempt(
        fixture.store,
        "quiet-provider-boundary",
        "provider-boundary",
        false,
      );
    },
  ] as const;
  for (const seed of scenarios) {
    const fixture = createIncGen018Fixture();
    try {
      seed(fixture);
      const plan = fixture.harness.plan(fixture.store);
      const before = rawUpgradeMutationSnapshot(fixture.store);
      expect(() => fixture.harness.apply(fixture.store, "admin-a", {
        expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
        expectedPlanHash: plan.planHash,
      })).toThrow(
        /活动任务、当前unknown-billing任务或未收口Provider边界证据/,
      );
      expect(rawUpgradeMutationSnapshot(fixture.store)).toBe(before);
    } finally {
      closeIncGen018Fixture(fixture);
    }
  }
});

test("INC-GEN-018 quiet gate permits finished Provider and historical unknown evidence", () => {
  const fixture = createIncGen018Fixture();
  try {
    insertQuietTask(fixture.store, "quiet-provider-finished", "failed");
    insertUnknownAttempt(
      fixture.store,
      "quiet-provider-finished",
      "provider-boundary",
      true,
    );
    insertQuietTask(fixture.store, "quiet-historical-unfinished", "failed");
    insertUnknownAttempt(
      fixture.store,
      "quiet-historical-unfinished",
      "historical-execution-attempt",
      false,
    );
    const plan = fixture.harness.plan(fixture.store);
    expect(plan.quietSnapshot).toMatchObject({
      activeTasks: 0,
      currentUnknownBillingTasks: 0,
      unsettledProviderBoundaryUnknown: 0,
    });
    const result = fixture.harness.apply(fixture.store, "admin-a", {
      expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
      expectedPlanHash: plan.planHash,
    });
    expect(result).toMatchObject({ changed: true, paidProviderRequests: 0 });
  } finally {
    closeIncGen018Fixture(fixture);
  }
});

test("INC-GEN-018 target and final-health failures roll every revision, row and audit write back", () => {
  const scenarios = [
    {
      error: /fixture-second-target/,
      trigger:
        "CREATE TRIGGER reject_inc_gen_018_second_target " +
        "BEFORE UPDATE OF default_parameters ON model_profiles " +
        "WHEN OLD.id = 'ee51d65e-c924-4a9a-b224-6c4ee180a0ce' " +
        "BEGIN SELECT RAISE(ABORT, 'fixture-second-target'); END",
    },
    {
      error: /升级后10\/10 published模型未达到精确健康终态/,
      trigger:
        "CREATE TRIGGER corrupt_inc_gen_018_final_health " +
        "AFTER UPDATE OF default_parameters ON model_profiles " +
        "WHEN OLD.id = 'ee51d65e-c924-4a9a-b224-6c4ee180a0ce' " +
        "BEGIN UPDATE model_profiles " +
        "SET default_parameters = default_parameters || ' ' " +
        "WHERE id = '3919d490-8739-490a-8bce-0678c27e4760'; END",
    },
  ] as const;
  for (const scenario of scenarios) {
    const fixture = createIncGen018Fixture();
    try {
      const plan = fixture.harness.plan(fixture.store);
      fixture.store.exec(scenario.trigger);
      const before = rawUpgradeMutationSnapshot(fixture.store);
      expect(() => fixture.harness.apply(fixture.store, "admin-a", {
        expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
        expectedPlanHash: plan.planHash,
      })).toThrow(scenario.error);
      expect(rawUpgradeMutationSnapshot(fixture.store)).toBe(before);
      const after = fixture.harness.plan(fixture.store);
      expect(after.actionCounts).toMatchObject({
        none: 7,
        publishRevision: 3,
      });
      expect(modelContractState(
        fixture.store,
        "65600fd0-739d-4359-9c9c-958e3ae49b05",
      ).history).toHaveLength(1);
      expect(modelContractState(
        fixture.store,
        "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
      ).history).toHaveLength(1);
      expect(modelContractState(
        fixture.store,
        "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
      ).history).toHaveLength(2);
    } finally {
      closeIncGen018Fixture(fixture);
    }
  }
});

test("contract upgrade applies all three exact transitions and repeat apply is byte-idempotent", () => {
  const fixture = createIncGen018Fixture();
  let sibling: IncGen018Fixture | undefined;
  try {
    const targetIds = [
      "65600fd0-739d-4359-9c9c-958e3ae49b05",
      "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
      "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
    ];
    const historicalStates = new Map(targetIds.map((modelId) => [
      modelId,
      JSON.stringify(modelContractState(fixture.store, modelId).history),
    ]));
    const auditBefore = (fixture.store.prepare(
      "SELECT id, actor_user_id, action, target_user_id, details, created_at " +
        "FROM admin_audit_events WHERE action = 'model_contract.publish' " +
        "ORDER BY id",
    ).all() as Array<{ details: string }>).filter((row) =>
      targetIds.includes(JSON.parse(row.details).modelId)
    );
    const before = fixture.harness.plan(fixture.store);
    const result = fixture.harness.apply(fixture.store, "admin-a", {
      expectedBaselineSnapshotHash: before.baselineSnapshotHash,
      expectedPlanHash: before.planHash,
    });
    expect(result).toMatchObject({
      beforeBaselineSnapshotHash: before.baselineSnapshotHash,
      beforePlanHash: before.planHash,
      changed: true,
      paidProviderRequests: 0,
    });
    expect(result.upgradedModels.map((model) => model.modelId).sort()).toEqual(
      targetIds,
    );

    const after = fixture.harness.plan(fixture.store);
    expect(after).toMatchObject({
      actionCounts: {
        blockedInvalidActive: 0,
        blockedUnclassifiedDrift: 0,
        none: 10,
        publishRevision: 0,
      },
      auditedModelCount: 10,
      catalogIdentityMatchCount: 10,
      exactExecutionIdentityCount: 10,
      healthyModelCount: 10,
      missingExpectedModelIds: [],
      paidProviderRequests: 0,
      publishedModelCount: 10,
      unexpectedPublishedModelIds: [],
    });
    for (const model of incGen018FixtureModels) {
      const expectedHistory = model.historyRevisionIds.length +
        (targetIds.includes(model.id) ? 1 : 0);
      expect(modelContractState(fixture.store, model.id).history)
        .toHaveLength(expectedHistory);
    }
    for (const modelId of targetIds) {
      const history = modelContractState(fixture.store, modelId).history;
      const historicalLength = JSON.parse(historicalStates.get(modelId)!)
        .length;
      expect(JSON.stringify(history.slice(0, historicalLength))).toBe(
        historicalStates.get(modelId),
      );
      expect(history.at(-1)?.predecessorRevisionId).toBe(
        history.at(-2)?.revisionId,
      );
    }
    const auditAfter = (fixture.store.prepare(
      "SELECT id, actor_user_id, action, target_user_id, details, created_at " +
        "FROM admin_audit_events WHERE action = 'model_contract.publish' " +
        "ORDER BY id",
    ).all() as Array<{ details: string }>).filter((row) =>
      targetIds.includes(JSON.parse(row.details).modelId)
    );
    expect(JSON.stringify(auditAfter.slice(0, auditBefore.length))).toBe(
      JSON.stringify(auditBefore),
    );
    const appendedAudit = auditAfter.slice(auditBefore.length).map((row) =>
      JSON.parse(row.details)
    );
    expect(appendedAudit.map((details) => details.modelId).sort()).toEqual(
      targetIds,
    );
    expect(appendedAudit.every((details) =>
      details.releasePolicyUpgrade === true
    )).toBe(true);

    const taskCountsBeforeCatalogPreflight = fixture.store.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_tasks) AS tasks,
        (SELECT COUNT(*) FROM generation_provider_attempts) AS attempts
    `).get() as { attempts: number; tasks: number };
    const representativeCatalog = incGen018FixtureModels.map((model) => {
      const row = fixture.store.prepare(`
        SELECT models.default_parameters, models.provider_model_id,
          models.provider_protocol, providers.driver
        FROM model_profiles AS models
        JOIN provider_profiles AS providers
          ON providers.id = models.provider_profile_id
        WHERE models.id = ?
      `).get(model.id) as {
        default_parameters: string;
        driver: string;
        provider_model_id: string;
        provider_protocol: ProviderProtocol;
      };
      const modelContractHealth = inspectActiveModelContractHealth({
        capability: model.capability,
        costCurrency: model.costCurrency,
        defaultParameters: row.default_parameters,
        modelId: model.id,
        providerDriver: row.driver,
        providerModelId: row.provider_model_id,
        providerProfileId: model.profileId,
        providerProtocol: row.provider_protocol,
        store: fixture.store,
      });
      const availability = evaluateModelRuntimeAvailability({
        accountCredentialState: "valid",
        capability: model.capability,
        costCurrency: model.costCurrency,
        emergencyStop: false,
        globalEnabled: true,
        modelContractHealth,
        providerConfigurationVersionAligned: true,
        providerDriver: row.driver,
        providerModelId: row.provider_model_id,
        providerProtocol: row.provider_protocol,
        providerStatus: "enabled",
        storedProviderDriver: row.driver,
      });
      return {
        capability: model.capability,
        id: model.id,
        modelContractHealth,
        releaseRevisionId: modelContractState(fixture.store, model.id).active
          ?.revisionId,
        ...availability,
      };
    });
    expect(representativeCatalog).toHaveLength(10);
    expect(representativeCatalog.filter((model) =>
      !model.generationAvailable ||
      model.generationUnavailableReasonCode !== null ||
      !model.releaseRevisionId
    )).toEqual([]);
    const sevenNodeModelIds = [
      "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
      "65600fd0-739d-4359-9c9c-958e3ae49b05",
      "3919d490-8739-490a-8bce-0678c27e4760",
      "4d6196b4-00de-46ca-8011-383ad810a865",
      "624827c6-5541-4cc8-93ac-4f9d5ce79602",
      "897d3dfc-83e4-48e9-a033-ca612338681b",
      "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
    ];
    expect(sevenNodeModelIds.map((modelId) => {
      const model = representativeCatalog.find((item) => item.id === modelId)!;
      return workflowModelSelectionProblem({
        isFixture: false,
        kind: model.capability,
        model,
        status: "ready",
      });
    })).toEqual(new Array(7).fill(undefined));
    expect(fixture.store.prepare(`
      SELECT
        (SELECT COUNT(*) FROM generation_tasks) AS tasks,
        (SELECT COUNT(*) FROM generation_provider_attempts) AS attempts
    `).get()).toEqual(taskCountsBeforeCatalogPreflight);

    fixture.store.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const siblingDirectory = mkdtempSync(
      join(tmpdir(), "unboundry-inc-gen-018-repeat-sibling-"),
    );
    for (const name of ["unboundry.sqlite", "library.sqlite"]) {
      const source = join(fixture.dataDirectory, name);
      if (existsSync(source)) {
        writeFileSync(join(siblingDirectory, name), readFileSync(source));
      }
    }
    sibling = openIncGen018Fixture(siblingDirectory);
    const siblingPlan = sibling.harness.plan(sibling.store);
    expect(siblingPlan.actionCounts).toMatchObject({
      none: 10,
      publishRevision: 0,
    });
    const rawBeforeRepeat = rawUpgradeMutationSnapshot(sibling.store);
    const bytesBeforeRepeat = databaseByteIdentity(sibling.dataDirectory);
    const repeated = sibling.harness.apply(sibling.store, "admin-a", {
      expectedBaselineSnapshotHash: siblingPlan.baselineSnapshotHash,
      expectedPlanHash: siblingPlan.planHash,
    });
    expect(repeated).toMatchObject({
      afterBaselineSnapshotHash: siblingPlan.baselineSnapshotHash,
      beforeBaselineSnapshotHash: siblingPlan.baselineSnapshotHash,
      changed: false,
      paidProviderRequests: 0,
      upgradedModels: [],
    });
    expect(rawUpgradeMutationSnapshot(sibling.store)).toBe(rawBeforeRepeat);
    expect(databaseByteIdentity(sibling.dataDirectory)).toEqual(
      bytesBeforeRepeat,
    );
  } finally {
    if (sibling) closeIncGen018Fixture(sibling);
    closeIncGen018Fixture(fixture);
  }
});

test("draft CAS, validation and atomic immutable publish are audit-backed", () => {
  const actorStore = new DatabaseSync(":memory:");
  try {
    actorStore.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO users (id, role, status, created_at) VALUES
        ('disabled-admin', 'admin', 'disabled', '2026-01-01T00:00:00Z'),
        ('ordinary-user', 'user', 'active', '2026-01-01T00:00:00Z'),
        ('admin-newer', 'admin', 'active', '2026-02-01T00:00:00Z'),
        ('admin-oldest', 'admin', 'active', '2026-01-15T00:00:00Z');
    `);
    expect(modelReleaseBootstrapActorUserId(actorStore)).toBe("admin-oldest");
    actorStore.exec("UPDATE users SET status = 'disabled' WHERE role = 'admin'");
    expect(() => modelReleaseBootstrapActorUserId(actorStore)).toThrow(/活跃管理员/);
  } finally {
    actorStore.close();
  }
  const store = contractStore();
  try {
    store.exec("CREATE TABLE release_target (revision_id TEXT NOT NULL)");
    const directValidation = validateModelContractDocument(releaseDocument());
    expect(directValidation.paidProviderRequests).toBe(0);
    expect(store.prepare("SELECT COUNT(*) AS count FROM admin_audit_events").get())
      .toEqual({ count: 0 });
    const draft = saveModelContractDraft(store, "admin-a", releaseDocument(), 0);
    expect(draft.draftVersion).toBe(1);
    expect(() => saveModelContractDraft(
      store,
      "admin-b",
      releaseDocument(),
      0,
    )).toThrow(ModelContractConflictError);
    const validated = validateModelContractDraft(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
    );
    expect(validated.validation?.paidProviderRequests).toBe(0);
    expect(validated.validation?.preview.modes).toHaveLength(2);
    expect(validated.validation?.preview.modes[1]).toMatchObject({
      body: {
        model: "grok-video-3",
        params: { images: ["https://example.invalid/first-frame-1"] },
        prompt: "示例提示词",
      },
      method: "POST",
      modeId: "first-frame-to-video",
      path: "/v1/media/generate",
      query: {},
    });
    expect(() => publishModelContract(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
      (candidate) => {
        store.prepare("INSERT INTO release_target (revision_id) VALUES (?)")
          .run(candidate.revisionId);
        throw new Error("synthetic activation failure");
      },
    )).toThrow(/synthetic activation failure/);
    expect(modelContractState(store, draft.modelId).history).toHaveLength(0);
    expect(store.prepare("SELECT COUNT(*) AS count FROM release_target").get())
      .toEqual({ count: 0 });
    const revision = publishModelContract(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
      (candidate) => {
        store.prepare("INSERT INTO release_target (revision_id) VALUES (?)")
          .run(candidate.revisionId);
      },
    );
    expect(revision.revisionNumber).toBe(1);
    expect(modelContractState(store, draft.modelId).active?.hash).toBe(revision.hash);
    expect(() => assertModelReleaseRevisionIntegrity(revision)).not.toThrow();
    expect(() => assertModelReleaseRevisionIntegrity({
      ...revision,
      document: {
        ...revision.document,
        documentation: [{
          checkedAt: "2026-08-26",
          url: "https://provider.invalid/tampered-doc",
        }],
      },
    })).toThrow(/哈希/);
    expect(markModelContractsRequired(store, "admin-a", {
      modelIds: [draft.modelId],
      total: 1,
    })).toBe(true);
    expect(modelContractsRequired(store)).toBe(true);
    expect(markModelContractsRequired(store, "admin-a", {
      modelIds: [draft.modelId],
      total: 1,
    })).toBe(false);
    expect(() => publishModelContract(
      store,
      "admin-a",
      draft.modelId,
      draft.draftVersion,
    )).toThrow();
  } finally {
    store.close();
  }
});

test("rollback creates a new revision and revoke affects only new submissions", () => {
  const store = contractStore();
  try {
    const firstDraft = saveModelContractDraft(store, "admin-a", releaseDocument(), 0);
    validateModelContractDraft(store, "admin-a", firstDraft.modelId, 1);
    const first = publishModelContract(store, "admin-a", firstDraft.modelId, 1);
    const secondDocument = {
      ...releaseDocument(),
      documentation: [{ checkedAt: "2026-08-26", url: "https://provider.invalid/docs/v2" }],
    };
    const secondDraft = saveModelContractDraft(store, "admin-a", secondDocument, 1);
    validateModelContractDraft(store, "admin-a", secondDraft.modelId, 2);
    const second = publishModelContract(store, "admin-a", secondDraft.modelId, 2);
    const reusedRoleDocument = {
      ...releaseDocument(),
      executionContract: {
        ...gkContract,
        modes: [
          gkContract.modes[0],
          {
            ...gkContract.modes[1],
            roles: [{ ...gkContract.modes[1].roles[0], kind: "video" }],
          },
        ],
      },
    } as const;
    const reusedRoleDraft = saveModelContractDraft(
      store,
      "admin-a",
      reusedRoleDocument,
      2,
    );
    expect(() => validateModelContractDraft(
      store,
      "admin-a",
      second.modelId,
      reusedRoleDraft.draftVersion,
    )).toThrow(/GK执行合同/);
    setModelContractRevoked(store, "admin-a", second.modelId, true);
    expect(modelContractState(store, second.modelId).active).toBeUndefined();
    const rolledBack = rollbackModelContract(
      store,
      "admin-a",
      second.modelId,
      first.revisionId,
    );
    expect(rolledBack.revisionNumber).toBe(3);
    expect(rolledBack.predecessorRevisionId).toBe(second.revisionId);
    expect(modelContractState(store, second.modelId).revoked).toBe(true);
    expect(modelContractState(store, second.modelId).active).toBeUndefined();
    const frozenTaskSnapshot = structuredClone(second);
    expect(frozenTaskSnapshot.revisionId).toBe(second.revisionId);
    setModelContractRevoked(store, "admin-a", second.modelId, false);
    expect(modelContractState(store, second.modelId).active?.revisionId)
      .toBe(rolledBack.revisionId);
  } finally {
    store.close();
  }
});

test("GK transport accepts the declared task id with harmless response envelope fields", async () => {
  const calls: Array<{ body?: unknown; url: string }> = [];
  const evidence: Array<Record<string, unknown>> = [];
  const responses = [
    {
      task_id: "task-gk-001",
      state: "queued",
      request_id: "request-gk-001",
      metadata: { region: "fixture" },
    },
    { result_url: "https://cdn.example.test/result.mp4", state: "success" },
  ];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      url: String(input),
    });
    return new Response(JSON.stringify(responses.shift()), {
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "provider-request-safe-001",
      },
      status: 200,
    });
  };
  const connection = { apiKey: "fixture-secret", baseUrl: "https://api.example.test" };
  const submission = await submitContractRelayMedia(connection, {
    capability: "video",
    model: "grok-video-3",
    params: { images: ["https://cdn.example.test/first.png"] },
    prompt: "转身展示服装",
    providerProtocol: "media-generate",
  }, gkContract, {
    fetcher,
    onProviderResponseEvidence: (item) => evidence.push(item),
  });
  expect(submission.externalTaskId).toBe("task-gk-001");
  const result = await pollContractRelayMediaTask(connection, {
    capability: "video",
    externalTaskId: submission.externalTaskId,
    providerProtocol: "media-generate",
  }, gkContract, {
    fetcher,
    onProviderResponseEvidence: (item) => evidence.push(item),
  });
  expect(result).toMatchObject({
    outputs: [{ transientUrl: "https://cdn.example.test/result.mp4" }],
    state: "success",
  });
  expect(evidence).toHaveLength(2);
  expect(evidence[0]).toMatchObject({
    contentType: "application/json",
    fieldPaths: expect.arrayContaining([
      "metadata.region",
      "request_id",
      "state",
      "task_id",
    ]),
    httpStatus: 200,
    providerRequestId: "provider-request-safe-001",
    responseBytes: expect.any(Number),
    structureHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(evidence)).not.toContain("fixture-secret");
  expect(JSON.stringify(evidence)).not.toContain("转身展示服装");
  expect(JSON.stringify(evidence)).not.toContain("result.mp4");
  expect(calls).toEqual([
    {
      body: {
        model: "grok-video-3",
        params: { images: ["https://cdn.example.test/first.png"] },
        prompt: "转身展示服装",
      },
      url: "https://api.example.test/v1/media/generate",
    },
    { url: "https://api.example.test/v1/media/status?task_id=task-gk-001" },
  ]);

  const malformedEvidence: Array<Record<string, unknown>> = [];
  const malformed = await submitContractRelayMedia(connection, {
    capability: "video",
    model: "grok-video-3",
    params: { images: ["https://cdn.example.test/first.png"] },
    prompt: "response shape recovery",
    providerProtocol: "media-generate",
  }, gkContract, {
    fetcher: async () => new Response("not-json", {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }),
    onProviderResponseEvidence: (item) => malformedEvidence.push(item),
  }).catch((error: unknown) => error);
  expect(malformed).toMatchObject({
    code: "FORMAT",
    providerTaskMayStillRun: true,
  });
  expect(malformedEvidence).toContainEqual(expect.objectContaining({
    failureStage: "response-format",
    httpStatus: 200,
    responseBytes: 8,
  }));

  await expect(submitContractRelayMedia(connection, {
    capability: "video",
    model: "grok-video-3",
    params: { images: ["https://cdn.example.test/first.png"] },
    prompt: "illegal remote task id",
    providerProtocol: "media-generate",
  }, gkContract, {
    fetcher: async () => new Response(JSON.stringify({ task_id: "unsafe/task/id" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }),
  })).rejects.toMatchObject({
    code: "FORMAT",
    providerTaskMayStillRun: true,
  });

  await expect(pollContractRelayMediaTask(connection, {
    capability: "video",
    externalTaskId: "task-gk-malformed-poll",
    providerProtocol: "media-generate",
  }, gkContract, {
    fetcher: async () => new Response(JSON.stringify({ state: "mystery" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }),
  })).rejects.toMatchObject({
    code: "FORMAT",
    providerTaskMayStillRun: true,
  });

  const numericEvidence: Array<Record<string, unknown>> = [];
  const numericSubmission = await submitContractRelayMedia(connection, {
    capability: "video",
    model: "grok-video-3",
    params: { images: ["https://cdn.example.test/first.png"] },
    prompt: "real numeric task id envelope",
    providerProtocol: "media-generate",
  }, gkContract, {
    fetcher: async () => new Response(JSON.stringify({
      data: {
        task_ids: [921_337],
        "任务ids": [921_337],
        "对话组ID": "safe-conversation-group",
      },
    }), {
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "provider-request-numeric-001",
      },
      status: 200,
    }),
    onProviderResponseEvidence: (item) => numericEvidence.push(item),
  });

  expect(numericSubmission.externalTaskId).toBe("921337");
  expect(numericSubmission.externalTaskIds).toEqual(["921337"]);
  expect(numericEvidence).toContainEqual(expect.objectContaining({
    fieldPaths: expect.arrayContaining([
      "data.task_ids[]:number",
      "data.任务ids[]:number",
      "data.对话组ID",
    ]),
    httpStatus: 200,
    providerRequestId: "provider-request-numeric-001",
  }));
  expect(JSON.stringify(numericEvidence)).not.toContain("fixture-secret");
  expect(JSON.stringify(numericEvidence)).not.toContain("real numeric task id envelope");

  for (const [name, response, expectedTaskId] of [
    ["english alias", { data: { task_ids: [921_338] } }, "921338"],
    ["chinese alias", { data: { "任务ids": [921_339] } }, "921339"],
    [
      "canonical and aliases agree",
      { task_id: "921340", data: { task_ids: [921_340], "任务ids": ["921340"] } },
      "921340",
    ],
  ] as const) {
    const accepted = await submitContractRelayMedia(connection, {
      capability: "video",
      model: "grok-video-3",
      params: { images: ["https://cdn.example.test/first.png"] },
      prompt: name,
      providerProtocol: "media-generate",
    }, gkContract, {
      fetcher: async () => new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    });
    expect(accepted.externalTaskIds, name).toEqual([expectedTaskId]);
  }

  for (const [name, response] of [
    ["aliases conflict", { data: { task_ids: [1], "任务ids": [2] } }],
    ["canonical conflicts", { task_id: "1", data: { task_ids: [2] } }],
    ["empty alias", { data: { task_ids: [] } }],
    ["multiple ids", { data: { task_ids: [1, 2] } }],
    ["numeric zero id", { data: { task_ids: [0] } }],
    ["string zero id", { data: { task_ids: ["0"] } }],
    ["unsafe numeric id", { data: { task_ids: [1.5] } }],
    ["unsafe string id", { data: { task_ids: ["unsafe/task/id"] } }],
    ["arbitrary data.task_id", { data: { task_id: "not-declared" } }],
    ["arbitrary data.id", { data: { id: "not-declared" } }],
  ] as const) {
    await expect(submitContractRelayMedia(connection, {
      capability: "video",
      model: "grok-video-3",
      params: { images: ["https://cdn.example.test/first.png"] },
      prompt: name,
      providerProtocol: "media-generate",
    }, gkContract, {
      fetcher: async () => new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    }), name).rejects.toMatchObject({
      code: "FORMAT",
      providerTaskMayStillRun: true,
    });
  }
});

test("admin contract workbench is separate, structured and responsive with zero Provider calls", async ({ page }) => {
  const app = readFileSync(join(process.cwd(), "client/src/App.tsx"), "utf8");
  const styles = readFileSync(join(process.cwd(), "client/src/styles.css"), "utf8");
  expect(app).toContain("model-contract-workbench");
  expect(app).toContain("本地验证当前页面｜零写入");
  expect(app).toContain("草稿发生并发冲突，没有覆盖另一位管理员");
  expect(app).toContain("已保存草稿：{hasSavedDraft ? `版本 ${draftVersion}` : \"无\"}");
  expect(app).toContain('code === "MODEL_CONTRACT_DRAFT_CONFLICT"');
  expect(app).toContain("无需先保存，不会发布，也不会调用 Provider");
  expect(app).toContain("发布不会调用 Provider");
  expect(app).toContain("脱敏只读预览");
  expect(app).toContain("三份脱敏只读预览");
  expect(app).not.toContain("模式标识（系统使用）");
  expect(app).not.toContain("角色标识（系统使用）");
  expect(app).toContain("查看差异");
  expect(app).toContain("错误映射");
  expect(app).toContain("fallback合同");
  expect(styles).toContain("@media (max-width: 928px)");
  expect(styles).toContain("grid-template-columns: 210px minmax(0, 1fr) 290px");
  const contractStyles = styles.slice(
    styles.indexOf(".model-contract-page"),
    styles.indexOf(".model-lifecycle-reason"),
  );
  expect(contractStyles).not.toContain("#1fa2dc");
  expect(contractStyles).toContain("appearance: none");
  expect(contractStyles).toContain(".model-contract-page input.admin-compact-checkbox");
  expect(contractStyles).toContain("caret-color: transparent");

  const providerResponse = await page.request.post("/api/admin/providers", {
    data: {
      baseUrl: "https://openrouter.ai/api/v1",
      driver: "openrouter",
      label: "Contract Fixture Provider",
    },
  });
  expect(providerResponse.status()).toBe(201);
  const provider = (await providerResponse.json()).profile as { id: string };
  const modelResponse = await page.request.post("/api/admin/models", {
    data: {
      capability: "image",
      displayName: "Contract Fixture Model",
      isDefault: false,
      providerModelId: "openai/gpt-image-2",
      providerProfileId: provider.id,
      sortOrder: 1,
      status: "draft",
    },
  });
  expect(modelResponse.status()).toBe(201);
  const model = (await modelResponse.json()).model as { id: string };
  await page.goto("/admin/models");
  await expect(
    page.locator("article").filter({ hasText: "Contract Fixture Model" })
      .getByRole("button", { name: "合同工作台" }),
  ).toBeVisible();
  for (const viewport of [
    { height: 720, width: 1280 },
    { height: 900, width: 1440 },
    { height: 1080, width: 1920 },
    { height: 900, width: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/admin/models/${model.id}/contract`);
    await expect(page.getByTestId("model-contract-workbench")).toBeVisible();
    await expect(page.getByRole("button", { name: "新增模式" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增角色" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新增绑定" }).first()).toBeVisible();
    expect(await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))).toEqual({ client: viewport.width, scroll: viewport.width });
    const actions = await page.locator(".model-contract-actions").boundingBox();
    const editor = await page.locator(".model-contract-editor").boundingBox();
    expect(actions).not.toBeNull();
    expect(editor).not.toBeNull();
    expect(actions!.y).toBeGreaterThan(0);
  }
  const validateButton = page.getByRole("button", { name: "本地验证当前页面｜零写入" });
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：无")).toBeVisible();
  await expect(validateButton).toBeEnabled();
  await expect(page.getByText(/当前页面可直接本地验证/).first()).toBeVisible();
  const checkbox = page.locator(".model-contract-page input.admin-compact-checkbox").first();
  await expect(checkbox).toBeVisible();
  expect(await checkbox.evaluate((element) => ({
    appearance: getComputedStyle(element).appearance,
    background: getComputedStyle(element).backgroundColor,
  }))).toEqual({ appearance: "none", background: "rgb(236, 236, 238)" });
  const parameterTrigger = page.locator(".model-contract-page .admin-parameter-select-trigger").first();
  await expect(parameterTrigger).toBeVisible();
  expect(await parameterTrigger.evaluate((element) => ({
    caret: getComputedStyle(element).caretColor,
    height: getComputedStyle(element).height,
  }))).toEqual({ caret: "rgba(0, 0, 0, 0)", height: "34px" });
  await validateButton.click();
  await expect(page.locator(".model-contract-feedback")).toHaveText(
    "本地验证通过；Provider 请求为 0。",
  );
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：无")).toBeVisible();
  await expect(page.locator("#model-contract-preview")).toContainText("openai/gpt-image-2");
  await page.getByRole("button", { name: "已保存草稿", exact: true }).click();
  await expect(page.locator("#model-contract-preview")).toContainText("已保存草稿：无");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存；本次没有调用 Provider。")).toBeVisible();
  await page.getByRole("button", { name: "已保存草稿", exact: true }).click();
  await expect(page.locator("#model-contract-preview")).toContainText("openai/gpt-image-2");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：1")).toBeVisible();
  await expect(validateButton).toBeEnabled();
  await expect(page.getByText("草稿发生并发冲突，没有覆盖另一位管理员。")).toHaveCount(0);
});
