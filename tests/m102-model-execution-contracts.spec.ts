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
import { assertActiveModelContractHealth } from
  "../server/activeModelContractHealth";
import {
  assertRelayMediaOutputCardinality,
  assertGenerationTaskModelReleaseSnapshotIntegrity,
  relayMediaParametersForTask,
} from "../server/generationTasks";
import {
  applyModelContractUpgrade,
  planModelContractUpgrade,
  runModelContractUpgradeCli,
} from "../server/modelContractUpgrade";
import {
  assertFrozenTaskModelExecutionAdapter,
  assertModelExecutionRegistryTotality,
  assertRegisteredModelExecutionTotality,
  compileRegisteredModelTaskDecision,
  currentPublishedModelExecutionDescriptors,
  ExactModelExecutionRegistry,
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
  displayName: string;
  capability: ModelCapability;
  providerDriver: string;
  providerModelId: string;
  providerProtocol: ProviderProtocol;
  costCurrency: "CNY" | "USD";
}>;

function publishedModelSnapshot() {
  const parsed = JSON.parse(readFileSync(join(
    process.cwd(),
    "spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json",
  ), "utf8")) as {
    databaseSchema: number;
    models: PublishedModelSnapshotRow[];
    productionRelease: string;
    publishedCount: number;
    snapshotKind: string;
  };
  if (
    parsed.snapshotKind !== "sanitized-production-published-model-contract-identities" ||
    parsed.databaseSchema !== 41 ||
    parsed.models.length !== parsed.publishedCount
  ) throw new Error("INC-GEN-017 production published-model snapshot is invalid");
  return parsed;
}

function modelSchema(row: PublishedModelSnapshotRow) {
  return knownModelParameterSchema({
    capability: row.capability,
    providerDriver: row.providerDriver,
    providerModelId: row.providerModelId,
  });
}

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
    ["gpt-image-2", "image", "platform.openai.com"],
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
      providerProtocol: providerModelId === "gpt-image-2" ? "gpt-image" : "media-generate",
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

test("R5 builds the complete directed switch matrix from the live published snapshot", () => {
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
  const current = defaultModelReleaseDocument({
    capability: "video",
    capabilitySchema: knownModelParameterSchema({
      capability: "video",
      providerDriver: "multi-protocol-relay",
      providerModelId: "grok-video-3",
    }),
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
      modelId: current.modelId,
      parameterSchema: current.capabilitySchema,
      providerDriver: "multi-protocol-relay",
      providerModelId: current.providerModelId,
      providerProfileId: current.providerProfileId,
      providerProtocol: current.providerProtocol,
      store,
    }).revisionId).toBe(upgraded.revision.revisionId);
    expect(() => assertActiveModelContractHealth({
      capability: current.capability,
      costCurrency: "USD",
      modelId: current.modelId,
      parameterSchema: {
        ...current.capabilitySchema,
        referenceInputs: {
          ...current.capabilitySchema.referenceInputs,
          image: current.capabilitySchema.referenceInputs.image + 1,
        },
      },
      providerDriver: "multi-protocol-relay",
      providerModelId: current.providerModelId,
      providerProfileId: current.providerProfileId,
      providerProtocol: current.providerProtocol,
      store,
    })).toThrow(/身份不一致/);
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

test("schema41 upgrade audits 11 models, publishes GK revision 2, archives kwvideo and repeats idempotently", () => {
  expect(() => runModelContractUpgradeCli(["--data-dir", "relative"]))
    .toThrow(/绝对隔离数据目录/);
  expect(() => runModelContractUpgradeCli(["--data-dir", "/tmp", "--unknown"]))
    .toThrow(/参数无效/);
  expect(() => runModelContractUpgradeCli(["--data-dir", "/tmp", "--apply"]))
    .toThrow(/staging-root/);
  const stagingRoot = mkdtempSync(join(tmpdir(), "unboundry-contract-staging-"));
  try {
    const stagedData = join(stagingRoot, "snapshot-a");
    mkdirSync(stagedData);
    chmodSync(stagedData, 0o700);
    const realStagedData = realpathSync(stagedData);
    writeFileSync(join(stagedData, "unboundry.sqlite"), "");
    expect(() => runModelContractUpgradeCli([
      "--data-dir", stagedData,
      "--staging-root", stagingRoot,
      "--expected-plan-hash", "0".repeat(64),
      "--expected-attestation-sha256", "0".repeat(64),
      "--apply",
    ])).toThrow(/恢复暂存证明/);
    const markerPath = join(stagedData, ".model-contract-upgrade-recovery.json");
    const marker = {
      dataDirectoryRealPath: realStagedData,
      databaseFileName: "unboundry.sqlite",
      databaseSha256: "0".repeat(64),
      databaseSizeBytes: 0,
      purpose: "MODEL-CONTRACT-002",
      schemaVersion: 41,
      snapshotId: "fixture-snapshot-a",
    };
    const writeMarker = (value: typeof marker) => {
      const bytes = `${JSON.stringify(value)}\n`;
      if (existsSync(markerPath)) chmodSync(markerPath, 0o600);
      writeFileSync(markerPath, bytes);
      chmodSync(markerPath, 0o400);
      return createHash("sha256").update(bytes).digest("hex");
    };
    const staleAttestation = writeMarker(marker);
    expect(() => runModelContractUpgradeCli([
      "--data-dir", stagedData,
      "--staging-root", stagingRoot,
      "--expected-plan-hash", "0".repeat(64),
      "--expected-attestation-sha256", staleAttestation,
      "--apply",
    ])).toThrow(/待升级数据库不匹配/);
    const validAttestation = writeMarker({
      ...marker,
      databaseSha256: createHash("sha256").update("").digest("hex"),
    });
    const rootLink = join(stagingRoot, "root-link");
    symlinkSync(stagingRoot, rootLink);
    expect(() => runModelContractUpgradeCli([
      "--data-dir", stagedData,
      "--staging-root", rootLink,
      "--expected-plan-hash", "0".repeat(64),
      "--expected-attestation-sha256", validAttestation,
      "--apply",
    ])).toThrow(/根目录身份无效/);
    const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
    process.env.UNBOUNDRY_DATA_DIR = stagedData;
    try {
      expect(() => runModelContractUpgradeCli([
        "--data-dir", stagedData,
        "--staging-root", stagingRoot,
        "--expected-plan-hash", "0".repeat(64),
        "--expected-attestation-sha256", validAttestation,
        "--apply",
      ])).toThrow(/应用或生产数据目录/);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
      else process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
    const previousTmpDirectory = process.env.TMPDIR;
    process.env.TMPDIR = "/";
    try {
      expect(() => runModelContractUpgradeCli([
        "--data-dir", stagedData,
        "--staging-root", "/",
        "--expected-plan-hash", "0".repeat(64),
        "--expected-attestation-sha256", validAttestation,
        "--apply",
      ])).toThrow(/固定隔离allowlist/);
    } finally {
      if (previousTmpDirectory === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previousTmpDirectory;
    }
  } finally {
    rmSync(stagingRoot, { force: true, recursive: true });
  }
  const store = contractStore();
  try {
    store.exec(`
      PRAGMA user_version = 41;
      CREATE TABLE provider_profiles (
        id TEXT PRIMARY KEY, driver TEXT NOT NULL, status TEXT NOT NULL,
        key_status TEXT NOT NULL, catalog_credential_revision TEXT,
        provider_configuration_version INTEGER NOT NULL
      );
      CREATE TABLE account_provider_credentials (
        account_id TEXT NOT NULL, provider_profile_id TEXT NOT NULL,
        credential_version INTEGER NOT NULL, key_status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE model_profiles (
        id TEXT PRIMARY KEY, capability TEXT NOT NULL,
        default_parameters TEXT NOT NULL, provider_model_id TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL, provider_protocol TEXT NOT NULL,
        status TEXT NOT NULL, archived_at TEXT, published_at TEXT, updated_at TEXT
      );
      CREATE TABLE node_model_bindings (
        node_type TEXT NOT NULL, model_id TEXT NOT NULL, enabled INTEGER NOT NULL,
        is_default INTEGER NOT NULL, updated_at TEXT,
        PRIMARY KEY (node_type, model_id)
      );
      CREATE TABLE public_templates (id TEXT PRIMARY KEY, graph TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE generation_tasks (model TEXT NOT NULL, state TEXT NOT NULL);
      CREATE TABLE canvas_documents (nodes TEXT NOT NULL);
      INSERT INTO provider_profiles VALUES
        ('provider-relay', 'multi-protocol-relay', 'enabled', 'valid', 'catalog-relay-1', 1),
        ('provider-ark', 'volcengine-ark', 'enabled', 'valid', 'catalog-ark-1', 1),
        ('provider-mureka', 'mureka', 'enabled', 'valid', 'catalog-mureka-1', 1);
    `);
    const rows = [
      ["model-text", "text", "doubao-seed-2-0-lite-260428", "provider-ark", "native"],
      ["model-image-gemini", "image", "gemini-3-pro-image-preview", "provider-relay", "media-generate"],
      ["model-image-gpt", "image", "gpt-image-2", "provider-relay", "gpt-image"],
      ["model-video-seedance", "video", "doubao-seedance-2-0-mini-260615", "provider-ark", "native"],
      ["model-video-grok-imagine", "video", "grok-imagine-video-1.5-preview", "provider-relay", "media-generate"],
      ["model-video-kling", "video", "kling-v3-omni-cankao", "provider-relay", "media-generate"],
      ["model-audio-mureka", "audio", "mureka-9", "provider-mureka", "native"],
      ["model-audio-tts", "audio", "doubao-tts-2.0", "provider-relay", "media-generate"],
      ["model-audio-suno", "audio", "suno-v4.5", "provider-relay", "media-generate"],
      ["model-gk-video-3", "video", "grok-video-3", "provider-relay", "media-generate"],
      ["model-kwvideo-v2", "video", "kwvideo-v2", "provider-relay", "media-generate"],
    ] as const;
    for (const [id, capability, providerModelId, providerProfileId, providerProtocol] of rows) {
      const providerDriver = providerProfileId === "provider-ark"
        ? "volcengine-ark"
        : providerProfileId === "provider-mureka"
          ? "mureka"
          : "multi-protocol-relay";
      const capabilitySchema = knownModelParameterSchema({
        capability,
        providerDriver,
        providerModelId,
      });
      const persistedCapabilitySchema = structuredClone(capabilitySchema);
      if (providerModelId === "doubao-seedance-2-0-mini-260615") {
        delete persistedCapabilitySchema.referencePolicy!.normalizationPriority;
      }
      if (providerModelId === "grok-imagine-video-1.5-preview") {
        delete persistedCapabilitySchema.referencePolicy;
        delete persistedCapabilitySchema.referenceMediaRules;
        delete persistedCapabilitySchema.inputPolicy!.promptPolicy;
      }
      if (providerModelId === "gpt-image-2") {
        delete persistedCapabilitySchema.referencePolicy;
        persistedCapabilitySchema.referenceMediaRules = {};
        persistedCapabilitySchema.inputPolicy = {
          required: {},
          roles: { image: ["reference-image"] },
          switchPolicy: "keep-edge",
        };
      }
      if (providerModelId === "mureka-9") {
        persistedCapabilitySchema.fields = persistedCapabilitySchema.fields.map(
          (field) => {
            if (field.key === "lyrics") return { ...field, maxLength: 8_000 };
            if (field.key === "outputCount") {
              return {
                ...field,
                options: [
                  { label: "1×", value: 1 },
                  { label: "2×", value: 2 },
                  { label: "3×", value: 3 },
                ],
              };
            }
            return field;
          },
        );
      }
      if (providerModelId === "grok-video-3") {
        persistedCapabilitySchema.fields = persistedCapabilitySchema.fields.map(
          (field) => field.key === "inputMode"
            ? {
                ...field,
                options: [
                  ...field.options,
                  { label: "参考", value: "reference" },
                ],
              }
            : field,
        );
        persistedCapabilitySchema.referenceInputs = {
          audio: 0,
          image: 0,
          video: 0,
        };
        persistedCapabilitySchema.referenceMediaRules = {};
        delete persistedCapabilitySchema.referencePolicy;
        persistedCapabilitySchema.inputPolicy = {
          required: {},
          roles: {
            audio: [],
            image: ["first-frame", "reference-image", "subject"],
            text: ["instruction"],
            video: [],
          },
          switchPolicy: "keep-edge",
        };
        persistedCapabilitySchema.upstreamInputs = {
          audio: { limitMode: "fixed", maxCount: 0, supported: false },
          image: { limitMode: "context", supported: true },
          text: { limitMode: "context", supported: true },
          video: { limitMode: "fixed", maxCount: 0, supported: false },
        };
      }
      store.prepare(`
        INSERT INTO model_profiles VALUES (?, ?, ?, ?, ?, ?, 'published', NULL, ?, ?)
      `).run(
        id,
        capability,
        JSON.stringify(persistedCapabilitySchema),
        providerModelId,
        providerProfileId,
        providerProtocol,
        "2026-08-27T00:00:00.000Z",
        "2026-08-27T00:00:00.000Z",
      );
      store.prepare(`INSERT INTO node_model_bindings VALUES (?, ?, 1, 0, ?)`)
        .run(capability, id, "2026-08-27T00:00:00.000Z");
      const currentDocument = defaultModelReleaseDocument({
        capability,
        capabilitySchema: persistedCapabilitySchema,
        modelId: id,
        providerDriver,
        providerModelId,
        providerProfileId,
        providerProtocol,
      });
      const document = currentDocument;
      const revision = {
        createdAt: "2026-08-27T00:00:00.000Z",
        document,
        hash: sha(document),
        modelId: id,
        revisionId: `00000000-0000-4000-8000-${String(rows.indexOf(rows.find((item) => item[0] === id)!)).padStart(12, "0")}`,
        revisionNumber: 1,
        validation: {
          compilerHash: compileModelExecutionContract(document.executionContract).hash,
          impact: { incompatibleTemplateIds: [], templateIds: [] },
          paidProviderRequests: 0,
          preview: { modes: [] },
          validatedAt: "2026-08-27T00:00:00.000Z",
        },
      } as const;
      recordAudit(store, "admin-a", "model_contract.publish", null, { modelId: id, revision });
    }
    for (const row of productionGkTemplateRows(
      "model-gk-video-3",
      true,
    )) {
      store.prepare("INSERT INTO public_templates VALUES (?, ?, 'published')")
        .run(row.id, row.graph);
    }
    const preexistingGptTemplateId =
      "ffffffff-ffff-4fff-8fff-fffffffffff1";
    store.prepare("INSERT INTO public_templates VALUES (?, ?, 'published')")
      .run(preexistingGptTemplateId, JSON.stringify({
        edges: [],
        nodes: [{
          data: {
            imageModelId: "model-image-gpt",
            imageParameters: { unsupportedParameter: true },
            label: "Image",
          },
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
          position: { x: 0, y: 0 },
          style: { height: 250, width: 250 },
          type: "image",
          zIndex: 1,
        }],
        version: 1,
      }));
    store.prepare("INSERT INTO canvas_documents VALUES (?)")
      .run(JSON.stringify([{ data: { videoModelId: "model-kwvideo-v2" } }]));
    const exactLegacyGptImageRow = store.prepare(`
      SELECT default_parameters FROM model_profiles
      WHERE id = 'model-image-gpt'
    `).get() as { default_parameters: string };
    const nearMissGptImageRow = JSON.parse(
      exactLegacyGptImageRow.default_parameters,
    );
    nearMissGptImageRow.referenceInputs.image = 2;
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-image-gpt'
    `).run(JSON.stringify(nearMissGptImageRow));
    expect(() => planModelContractUpgrade(store))
      .toThrow(/模型 gpt-image-2 合同迁移失败/);
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-image-gpt'
    `).run(exactLegacyGptImageRow.default_parameters);
    const exactLegacyGptImageAudit = store.prepare(`
      SELECT id, details FROM admin_audit_events
      WHERE action = 'model_contract.publish'
      ORDER BY id
    `).all().map((row) => ({
      details: JSON.parse(String(row.details)) as {
        modelId: string;
        revision: {
          document: ReturnType<typeof defaultModelReleaseDocument>;
          hash: string;
          validation: { compilerHash: string };
        };
      },
      id: Number(row.id),
    })).find((row) => row.details.modelId === "model-image-gpt")!;
    const nearMissGptImageActiveDocument = {
      ...exactLegacyGptImageAudit.details.revision.document,
      capabilitySchema: {
        ...exactLegacyGptImageAudit.details.revision.document.capabilitySchema,
        referenceInputs: {
          ...exactLegacyGptImageAudit.details.revision.document.capabilitySchema
            .referenceInputs,
          image: 2,
        },
      },
    };
    const nearMissGptImageActiveDetails = {
      ...exactLegacyGptImageAudit.details,
      revision: {
        ...exactLegacyGptImageAudit.details.revision,
        document: nearMissGptImageActiveDocument,
        hash: sha(nearMissGptImageActiveDocument),
      },
    };
    store.prepare("UPDATE admin_audit_events SET details = ? WHERE id = ?")
      .run(
        JSON.stringify(nearMissGptImageActiveDetails),
        exactLegacyGptImageAudit.id,
      );
    expect(() => planModelContractUpgrade(store))
      .toThrow(/gpt-image-2默认schema与活动revision迁移身份不一致/);
    store.prepare("UPDATE admin_audit_events SET details = ? WHERE id = ?")
      .run(
        JSON.stringify(exactLegacyGptImageAudit.details),
        exactLegacyGptImageAudit.id,
      );
    const exactLegacyGrokImagineRow = store.prepare(`
      SELECT default_parameters FROM model_profiles
      WHERE id = 'model-video-grok-imagine'
    `).get() as { default_parameters: string };
    const nearMissGrokImagineRow = JSON.parse(
      exactLegacyGrokImagineRow.default_parameters,
    );
    nearMissGrokImagineRow.inputPolicy.promptPolicy = "own-or-upstream-text";
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-video-grok-imagine'
    `).run(JSON.stringify(nearMissGrokImagineRow));
    expect(() => planModelContractUpgrade(store))
      .toThrow(/模型 grok-imagine-video-1.5-preview 合同迁移失败/);
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-video-grok-imagine'
    `).run(exactLegacyGrokImagineRow.default_parameters);
    const exactLegacyGrokImagineAudit = store.prepare(`
      SELECT id, details FROM admin_audit_events
      WHERE action = 'model_contract.publish'
      ORDER BY id
    `).all().map((row) => ({
      details: JSON.parse(String(row.details)) as {
        modelId: string;
        revision: {
          document: ReturnType<typeof defaultModelReleaseDocument>;
          hash: string;
          validation: { compilerHash: string };
        };
      },
      id: Number(row.id),
    })).find((row) => row.details.modelId ===
      "model-video-grok-imagine")!;
    const nearMissGrokImagineActiveDocument = structuredClone(
      exactLegacyGrokImagineAudit.details.revision.document,
    );
    nearMissGrokImagineActiveDocument.capabilitySchema.inputPolicy!
      .promptPolicy = "own-or-upstream-text";
    const nearMissGrokImagineActiveDetails = {
      ...exactLegacyGrokImagineAudit.details,
      revision: {
        ...exactLegacyGrokImagineAudit.details.revision,
        document: nearMissGrokImagineActiveDocument,
        hash: sha(nearMissGrokImagineActiveDocument),
      },
    };
    store.prepare("UPDATE admin_audit_events SET details = ? WHERE id = ?")
      .run(
        JSON.stringify(nearMissGrokImagineActiveDetails),
        exactLegacyGrokImagineAudit.id,
      );
    expect(() => planModelContractUpgrade(store)).toThrow(
      /grok-imagine-video-1.5-preview默认schema与活动revision迁移身份不一致/,
    );
    store.prepare("UPDATE admin_audit_events SET details = ? WHERE id = ?")
      .run(
        JSON.stringify(exactLegacyGrokImagineAudit.details),
        exactLegacyGrokImagineAudit.id,
      );
    const exactLegacyGrokRow = store.prepare(`
      SELECT default_parameters FROM model_profiles
      WHERE id = 'model-gk-video-3'
    `).get() as { default_parameters: string };
    const exactLegacyGrokAudit = store.prepare(`
      SELECT id, details FROM admin_audit_events
      WHERE action = 'model_contract.publish'
      ORDER BY id
    `).all().map((row) => ({
      details: JSON.parse(String(row.details)) as {
        modelId: string;
        revision: {
          document: ReturnType<typeof defaultModelReleaseDocument>;
          hash: string;
          validation: { compilerHash: string };
        };
      },
      id: Number(row.id),
    })).find((row) => row.details.modelId === "model-gk-video-3")!;
    const nearMissActiveDocument = {
      ...exactLegacyGrokAudit.details.revision.document,
      capabilitySchema: {
        ...exactLegacyGrokAudit.details.revision.document.capabilitySchema,
        fields: exactLegacyGrokAudit.details.revision.document.capabilitySchema.fields.map(
          (field) => field.key === "inputMode"
            ? {
                ...field,
                options: [
                  ...field.options,
                  { label: "主体", value: "subject" },
                ],
              }
            : field,
        ),
      },
    };
    const nearMissActiveDetails = {
      ...exactLegacyGrokAudit.details,
      revision: {
        ...exactLegacyGrokAudit.details.revision,
        document: nearMissActiveDocument,
        hash: sha(nearMissActiveDocument),
      },
    };
    store.prepare("UPDATE admin_audit_events SET details = ? WHERE id = ?")
      .run(JSON.stringify(nearMissActiveDetails), exactLegacyGrokAudit.id);
    expect(() => planModelContractUpgrade(store))
      .toThrow(/默认schema与活动revision迁移身份不一致/);
    store.prepare("UPDATE admin_audit_events SET details = ? WHERE id = ?")
      .run(JSON.stringify(exactLegacyGrokAudit.details), exactLegacyGrokAudit.id);
    const plan = planModelContractUpgrade(store);
    expect(plan).toMatchObject({
      auditedModelCount: 11,
      paidProviderRequests: 0,
      publishedModelCount: 11,
      schemaVersion: 41,
    });
    expect(plan.models.find((model) => model.providerModelId === "grok-video-3"))
      .toMatchObject({
        action: "publish-revision",
        hasTextFoundation: true,
        templateImpact: { incompatibleTemplateIds: [] },
      });
    const gkTemplateMigrations = plan.models.find((model) =>
      model.providerModelId === "grok-video-3"
    )!.templateMigrations;
    expect(gkTemplateMigrations).toHaveLength(22);
    expect(gkTemplateMigrations.flatMap((migration) => migration.nodeIds))
      .toHaveLength(34);
    expect(plan.models.find((model) => model.providerModelId === "gpt-image-2"))
      .toMatchObject({
        action: "publish-revision",
        templateImpact: {
          incompatibleTemplateIds: [],
          preexistingIncompatibleTemplateIds: [preexistingGptTemplateId],
          templateIds: [preexistingGptTemplateId],
        },
      });
    const mixedGrokTemplateId =
      "ffffffff-ffff-4fff-8fff-fffffffffff3";
    store.prepare("INSERT INTO public_templates VALUES (?, ?, 'published')")
      .run(mixedGrokTemplateId, JSON.stringify({
        edges: [
          {
            data: { inputOrder: 1 },
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
            source: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
            target: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
            type: "cuttable",
          },
          {
            data: { inputOrder: 2, inputRole: "first-frame" },
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
            source: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
            target: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
            type: "cuttable",
          },
          {
            data: { inputOrder: 1 },
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
            source: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
            target: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6",
            type: "cuttable",
          },
          {
            data: { inputOrder: 2, inputRole: "first-frame" },
            id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
            source: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
            target: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6",
            type: "cuttable",
          },
        ],
        nodes: [
          {
            data: { label: "Text" },
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
            position: { x: 0, y: 0 },
            type: "text",
            zIndex: 1,
          },
          {
            data: { label: "Image" },
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
            position: { x: 0, y: 300 },
            type: "image",
            zIndex: 1,
          },
          {
            data: {
              label: "Historical debt",
              videoModelId: "model-gk-video-3",
              videoParameters: {
                inputMode: "reference",
                unsupportedParameter: true,
              },
              videoPrompt: "脱敏生产提示词",
              videoPromptReady: true,
            },
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
            position: { x: 400, y: 0 },
            type: "video",
            zIndex: 1,
          },
          {
            data: {
              label: "New regression",
              videoModelId: " model-gk-video-3 ",
              videoParameters: { inputMode: "reference" },
              videoPrompt: "脱敏生产提示词",
              videoPromptReady: true,
            },
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6",
            position: { x: 400, y: 300 },
            type: "video",
            zIndex: 1,
          },
        ],
        version: 1,
      }));
    const mixedGrokPlan = planModelContractUpgrade(store);
    const mixedGrokImpact = mixedGrokPlan.models.find((model) =>
      model.providerModelId === "grok-video-3"
    )!.templateImpact;
    expect(mixedGrokImpact.incompatibleTemplateIds).toContain(
      mixedGrokTemplateId,
    );
    expect(mixedGrokImpact.preexistingIncompatibleTemplateIds).not.toContain(
      mixedGrokTemplateId,
    );
    expect(() => applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: mixedGrokPlan.baselineSnapshotHash,
    })).toThrow(
      /GK生产模板语义矩阵未达到22模板\/34节点兼容门|模板影响超出核准边界/,
    );
    store.prepare("DELETE FROM public_templates WHERE id = ?")
      .run(mixedGrokTemplateId);
    const regressiveSeedanceTemplateId =
      "ffffffff-ffff-4fff-8fff-fffffffffff2";
    store.prepare("INSERT INTO public_templates VALUES (?, ?, 'published')")
      .run(regressiveSeedanceTemplateId, JSON.stringify({
        edges: [],
        nodes: [{
          data: {
            label: "Video",
            videoModelId: "model-video-seedance",
            videoParameters: { unsupportedParameter: true },
          },
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
          position: { x: 0, y: 0 },
          style: { height: 250, width: 250 },
          type: "video",
          zIndex: 1,
        }],
        version: 1,
      }));
    const regressivePlan = planModelContractUpgrade(store);
    expect(regressivePlan.models.find((model) =>
      model.providerModelId === "doubao-seedance-2-0-mini-260615"
    )?.templateImpact.incompatibleTemplateIds).toEqual([
      regressiveSeedanceTemplateId,
    ]);
    expect(() => applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: regressivePlan.baselineSnapshotHash,
    })).toThrow(/模板影响超出核准边界/);
    store.prepare("DELETE FROM public_templates WHERE id = ?")
      .run(regressiveSeedanceTemplateId);
    expect(plan.models.filter((model) => model.action === "publish-revision")
      .map((model) => model.providerModelId).sort()).toEqual([
        "doubao-seedance-2-0-mini-260615",
        "gpt-image-2",
        "grok-imagine-video-1.5-preview",
        "grok-video-3",
        "mureka-9",
      ]);
    for (const model of plan.models.filter((item) =>
      item.action === "publish-revision"
    )) {
      expect(model.proposed.executionContract.version).toBe(
        model.providerModelId === "gpt-image-2" ||
          model.providerModelId === "grok-imagine-video-1.5-preview"
          ? 1
          : 2,
      );
    }
    expect(plan.models.find((model) => model.providerModelId === "kwvideo-v2"))
      .toMatchObject({ action: "archive", hasTextFoundation: false });
    store.prepare(`
      UPDATE model_profiles SET provider_protocol = 'media-generate'
      WHERE id = 'model-video-seedance'
    `).run();
    expect(() => planModelContractUpgrade(store))
      .toThrow(/not supported|精确执行registry/);
    store.prepare(`
      UPDATE model_profiles SET provider_protocol = 'native'
      WHERE id = 'model-video-seedance'
    `).run();
    store.prepare(`
      UPDATE provider_profiles SET driver = 'multi-protocol-relay'
      WHERE id = 'provider-ark'
    `).run();
    expect(() => planModelContractUpgrade(store))
      .toThrow(/not supported|精确执行registry/);
    store.prepare(`
      UPDATE provider_profiles SET driver = 'volcengine-ark'
      WHERE id = 'provider-ark'
    `).run();
    const exactSeedanceRow = store.prepare(`
      SELECT default_parameters FROM model_profiles
      WHERE id = 'model-video-seedance'
    `).get() as { default_parameters: string };
    const missingParameterSeedance = JSON.parse(
      exactSeedanceRow.default_parameters,
    );
    missingParameterSeedance.fields = missingParameterSeedance.fields.filter(
      (field: { key: string }) => field.key !== "duration",
    );
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-video-seedance'
    `).run(JSON.stringify(missingParameterSeedance));
    expect(() => planModelContractUpgrade(store))
      .toThrow(/schema不存在的参数/);
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-video-seedance'
    `).run(exactSeedanceRow.default_parameters);
    store.prepare("UPDATE provider_profiles SET provider_configuration_version = 2 WHERE id = 'provider-relay'").run();
    expect(() => applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
    })).toThrow(/基线快照已变化/);
    store.prepare("UPDATE provider_profiles SET provider_configuration_version = 1 WHERE id = 'provider-relay'").run();
    store.prepare(`
      INSERT INTO account_provider_credentials VALUES
        ('owner-invalid', 'provider-relay', 1, 'invalid', '2026-08-27T00:00:00.000Z')
    `).run();
    const invalidCredentialPlan = planModelContractUpgrade(store);
    expect(invalidCredentialPlan.models.find((model) =>
      model.providerModelId === "grok-video-3"
    )?.providerSnapshot.invalidAccountCredentialCount).toBe(1);
    store.prepare("DELETE FROM node_model_bindings WHERE model_id = 'model-gk-video-3'").run();
    expect(() => applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: invalidCredentialPlan.baselineSnapshotHash,
    }))
      .toThrow(/模型能力绑定不存在/);
    const templateInputModes = () => store.prepare(`
      SELECT graph FROM public_templates WHERE status = 'published'
    `).all().flatMap((row) => {
      const graph = JSON.parse(String(row.graph)) as {
        nodes: Array<{ data: Record<string, unknown> }>;
      };
      return graph.nodes.filter((node) =>
        node.data.videoModelId === "model-gk-video-3"
      ).map((node) => (node.data.videoParameters as { inputMode?: unknown })
        ?.inputMode);
    });
    expect(templateInputModes()).toEqual(Array(34).fill("reference"));
    expect(modelContractState(store, "model-gk-video-3").history).toHaveLength(1);
    expect(store.prepare("SELECT status, archived_at FROM model_profiles WHERE id = 'model-kwvideo-v2'").get())
      .toEqual({ status: "published", archived_at: null });
    store.prepare("INSERT INTO node_model_bindings VALUES ('video', 'model-gk-video-3', 1, 0, ?)")
      .run("2026-08-27T00:00:00.000Z");
    const applied = applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: invalidCredentialPlan.baselineSnapshotHash,
    });
    expect(applied).toMatchObject({
      archivedKwvideo: true,
      gkRevisionChanged: true,
      gkRevisionNumber: 2,
      paidProviderRequests: 0,
    });
    expect(applied.upgradedModels.map((model) => model.providerModelId).sort())
      .toEqual([
        "doubao-seedance-2-0-mini-260615",
        "gpt-image-2",
        "grok-imagine-video-1.5-preview",
        "grok-video-3",
        "mureka-9",
      ]);
    expect(modelContractState(store, "model-gk-video-3").history).toHaveLength(2);
    expect(modelContractState(store, "model-video-seedance").history).toHaveLength(2);
    expect(modelContractState(store, "model-video-grok-imagine").history)
      .toHaveLength(2);
    expect(modelContractState(store, "model-image-gpt").history)
      .toHaveLength(2);
    expect(modelContractState(store, "model-audio-mureka").history)
      .toHaveLength(2);
    expect(templateInputModes()).toEqual(Array(34).fill("image"));
    expect(store.prepare("SELECT status, archived_at FROM model_profiles WHERE id = 'model-kwvideo-v2'").get())
      .toMatchObject({ status: "disabled", archived_at: expect.any(String) });
    store.prepare("DELETE FROM public_templates").run();
    const repeatedPlan = planModelContractUpgrade(store);
    expect(repeatedPlan.models.find((model) =>
      model.providerModelId === "grok-video-3"
    )).toMatchObject({
      action: "none",
      templateMigrations: [],
      templateImpact: {
        incompatibleTemplateIds: [],
        nodeMatrix: [],
        templateIds: [],
      },
    });
    const repeated = applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: repeatedPlan.baselineSnapshotHash,
    });
    expect(repeated).toMatchObject({
      archivedKwvideo: false,
      gkRevisionChanged: false,
      gkRevisionNumber: 2,
      paidProviderRequests: 0,
      upgradedModels: [],
    });
    const seedanceRow = store.prepare(`
      SELECT default_parameters FROM model_profiles
      WHERE id = 'model-video-seedance'
    `).get() as { default_parameters: string };
    const invalidSeedanceSchema = JSON.parse(seedanceRow.default_parameters);
    invalidSeedanceSchema.referenceInputs.image += 1;
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-video-seedance'
    `).run(JSON.stringify(invalidSeedanceSchema));
    expect(() => planModelContractUpgrade(store))
      .toThrow(/reference input is not supported/);
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-video-seedance'
    `).run(seedanceRow.default_parameters);
    const exactMurekaRow = store.prepare(`
      SELECT default_parameters FROM model_profiles
      WHERE id = 'model-audio-mureka'
    `).get() as { default_parameters: string };
    const malformedMureka = JSON.parse(exactMurekaRow.default_parameters);
    malformedMureka.fields = malformedMureka.fields.map(
      (field: { key: string }) => field.key === "outputCount"
        ? {
            ...field,
            options: [
              { label: "1×", value: 1 },
              { label: "4×", value: 4 },
            ],
          }
        : field,
    );
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-audio-mureka'
    `).run(JSON.stringify(malformedMureka));
    expect(() => planModelContractUpgrade(store))
      .toThrow(/模型 mureka-9 合同迁移失败/);
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-audio-mureka'
    `).run(exactMurekaRow.default_parameters);
    const nearMissGrok = JSON.parse(exactLegacyGrokRow.default_parameters);
    nearMissGrok.fields = nearMissGrok.fields.map(
      (field: { key: string; options: Array<{ label: string; value: unknown }> }) =>
        field.key === "inputMode"
          ? {
              ...field,
              options: [
                ...field.options,
                { label: "主体", value: "subject" },
              ],
            }
          : field,
    );
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-gk-video-3'
    `).run(JSON.stringify(nearMissGrok));
    expect(() => planModelContractUpgrade(store))
      .toThrow(/模型 grok-video-3 合同迁移失败/);
    store.prepare(`
      UPDATE model_profiles SET default_parameters = ?
      WHERE id = 'model-gk-video-3'
    `).run(JSON.stringify({ version: 2, fields: [] }));
    expect(() => planModelContractUpgrade(store))
      .toThrow(/Invalid model reference inputs/);
  } finally {
    store.close();
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
