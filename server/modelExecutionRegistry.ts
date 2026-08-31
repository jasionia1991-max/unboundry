import {
  defaultParameterValues,
  parameterConditionsMatch,
  type ModelCapability,
  type ModelParameterSchema,
  type ModelParameterValue,
  type ModelUpstreamInputKind,
  parameterFieldRequired,
  validateParameterValues,
} from "../types/modelParameters";
import {
  normalizeModelInputs,
  type ModelSemanticInput,
} from "../types/modelInputSemanticCompiler";
import type { ProviderProtocol } from "../types/relayProtocols";
import { incGen017FeatureFlags } from "./incGen017FeatureFlags";

export type ModelExecutionAdapterId =
  | "ark-text"
  | "ark-video"
  | "mureka-audio"
  | "openrouter-image"
  | "relay-gpt-image"
  | "relay-media";

export type ModelExecutionIdentity = Readonly<{
  adapterId?: ModelExecutionAdapterId;
  providerDriver: string;
  providerModelId: string;
  providerProtocol: ProviderProtocol;
}>;

export type ModelExecutionDescriptor = Readonly<{
  adapterId: ModelExecutionAdapterId;
  capability: ModelCapability;
  connectorFamily:
    | "ark-native"
    | "generic-async-media"
    | "gpt-image"
    | "mureka-native"
    | "specialized-code";
  costCurrency: "CNY" | "USD";
  evidence: "EXACT" | "SPECIALIZED";
  executionContractVersion: 1 | 2;
  identities: readonly ModelExecutionIdentity[];
  logicalModelId: string;
  modes: Readonly<Record<string, Readonly<{
    roles: Partial<Record<ModelUpstreamInputKind, readonly string[]>>;
  }>>>;
  parameterKeys: readonly string[];
  recoveryIdentity: readonly [
    "taskId",
    "requestFingerprint",
    "modelReleaseRevision",
  ];
  resultCount: 1;
  resultKind: ModelCapability;
  runtime: "declarative" | "specialized-code";
}>;

const recoveryIdentity = Object.freeze([
  "taskId",
  "requestFingerprint",
  "modelReleaseRevision",
] as const);

const noRoles = Object.freeze({});
const textOnly = Object.freeze({ text: Object.freeze(["instruction"]) });
const referenceImage = Object.freeze({
  image: Object.freeze(["reference-image"]),
  text: Object.freeze(["instruction"]),
});
const executionModes = (value: ModelExecutionDescriptor["modes"]) => value;

const descriptors = Object.freeze([
  {
    adapterId: "ark-text",
    capability: "text",
    connectorFamily: "ark-native",
    costCurrency: "CNY",
    evidence: "SPECIALIZED",
    executionContractVersion: 1,
    identities: [{
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seed-2-0-lite-260428",
      providerProtocol: "native",
    }],
    logicalModelId: "doubao-seed-2-0-lite-260428",
    modes: executionModes({ default: { roles: {
      audio: ["context-audio"],
      image: ["context-image"],
      text: ["context-text"],
      video: ["context-video"],
    } } }),
    parameterKeys: ["inputMode", "thinkingLevel", "responseFormat", "outputCount"],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "text",
    runtime: "specialized-code",
  },
  {
    adapterId: "relay-gpt-image",
    capability: "image",
    connectorFamily: "gpt-image",
    costCurrency: "USD",
    evidence: "EXACT",
    executionContractVersion: 1,
    identities: [{
      providerDriver: "multi-protocol-relay",
      providerModelId: "gpt-image-2",
      providerProtocol: "gpt-image",
    }, {
      adapterId: "openrouter-image",
      providerDriver: "openrouter",
      providerModelId: "openai/gpt-image-2",
      providerProtocol: "native",
    }],
    logicalModelId: "gpt-image-2",
    modes: executionModes({
      image: { roles: referenceImage },
      text: { roles: textOnly },
    }),
    parameterKeys: ["inputMode", "aspectRatio", "quality", "outputCount"],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "image",
    runtime: "specialized-code",
  },
  {
    adapterId: "relay-media",
    capability: "image",
    connectorFamily: "specialized-code",
    costCurrency: "USD",
    evidence: "SPECIALIZED",
    executionContractVersion: 1,
    identities: [{
      providerDriver: "multi-protocol-relay",
      providerModelId: "gemini-3-pro-image-preview",
      providerProtocol: "media-generate",
    }],
    logicalModelId: "gemini-3-pro-image-preview",
    modes: executionModes({
      image: { roles: referenceImage },
      text: { roles: textOnly },
    }),
    parameterKeys: ["inputMode", "aspectRatio", "quality", "outputCount"],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "image",
    runtime: "specialized-code",
  },
  {
    adapterId: "ark-video",
    capability: "video",
    connectorFamily: "ark-native",
    costCurrency: "CNY",
    evidence: "SPECIALIZED",
    executionContractVersion: 2,
    identities: [{
      providerDriver: "volcengine-ark",
      providerModelId: "doubao-seedance-2-0-mini-260615",
      providerProtocol: "native",
    }],
    logicalModelId: "doubao-seedance-2-0-mini-260615",
    modes: executionModes({
      "first-last-frame": { roles: {
        image: ["first-frame", "last-frame"], text: ["instruction"],
      } },
      multimodal: { roles: {
        audio: ["reference-audio"],
        image: ["subject", "reference-image"],
        text: ["instruction"],
        video: ["subject", "reference-video"],
      } },
      text: { roles: textOnly },
    }),
    parameterKeys: [
      "inputMode", "aspectRatio", "resolution", "duration", "generateAudio",
      "outputCount",
    ],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "video",
    runtime: "specialized-code",
  },
  {
    adapterId: "relay-media",
    capability: "video",
    connectorFamily: "generic-async-media",
    costCurrency: "USD",
    evidence: "EXACT",
    executionContractVersion: 2,
    identities: [{
      providerDriver: "multi-protocol-relay",
      providerModelId: "grok-video-3",
      providerProtocol: "media-generate",
    }],
    logicalModelId: "grok-video-3",
    modes: executionModes({
      image: { roles: { image: ["first-frame"], text: ["instruction"] } },
      text: { roles: textOnly },
    }),
    parameterKeys: [
      "inputMode", "aspectRatio", "resolution", "duration", "generateAudio",
      "outputCount",
    ],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "video",
    runtime: "declarative",
  },
  {
    adapterId: "relay-media",
    capability: "video",
    connectorFamily: "specialized-code",
    costCurrency: "USD",
    evidence: "SPECIALIZED",
    executionContractVersion: 1,
    identities: [{
      providerDriver: "multi-protocol-relay",
      providerModelId: "grok-imagine-video-1.5-preview",
      providerProtocol: "media-generate",
    }],
    logicalModelId: "grok-imagine-video-1.5-preview",
    modes: executionModes({
      reference: { roles: { image: ["first-frame"], text: ["instruction"] } },
    }),
    parameterKeys: [
      "inputMode", "aspectRatio", "resolution", "duration", "generateAudio",
      "outputCount",
    ],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "video",
    runtime: "specialized-code",
  },
  {
    adapterId: "relay-media",
    capability: "video",
    connectorFamily: "specialized-code",
    costCurrency: "USD",
    evidence: "SPECIALIZED",
    executionContractVersion: 1,
    identities: [{
      providerDriver: "multi-protocol-relay",
      providerModelId: "kling-v3-omni-cankao",
      providerProtocol: "media-generate",
    }],
    logicalModelId: "kling-v3-omni-cankao",
    modes: executionModes({
      image: { roles: referenceImage },
      text: { roles: textOnly },
    }),
    parameterKeys: ["inputMode", "aspectRatio", "duration", "videoMode", "outputCount"],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "video",
    runtime: "specialized-code",
  },
  {
    adapterId: "relay-media",
    capability: "audio",
    connectorFamily: "specialized-code",
    costCurrency: "USD",
    evidence: "SPECIALIZED",
    executionContractVersion: 1,
    identities: [{
      providerDriver: "multi-protocol-relay",
      providerModelId: "doubao-tts-2.0",
      providerProtocol: "media-generate",
    }],
    logicalModelId: "doubao-tts-2.0",
    modes: executionModes({ default: { roles: textOnly } }),
    parameterKeys: [
      "inputMode", "speaker", "speechRate", "emotion", "emotionScale", "format",
      "outputCount",
    ],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "audio",
    runtime: "specialized-code",
  },
  {
    adapterId: "mureka-audio",
    capability: "audio",
    connectorFamily: "mureka-native",
    costCurrency: "USD",
    evidence: "SPECIALIZED",
    executionContractVersion: 2,
    identities: [{
      providerDriver: "mureka",
      providerModelId: "mureka-9",
      providerProtocol: "native",
    }],
    logicalModelId: "mureka-9",
    modes: executionModes({ default: { roles: noRoles } }),
    parameterKeys: [
      "musicGenerationMode", "lyrics", "vocalGender", "streamPlayback", "outputCount",
    ],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "audio",
    runtime: "specialized-code",
  },
  {
    adapterId: "relay-media",
    capability: "audio",
    connectorFamily: "specialized-code",
    costCurrency: "USD",
    evidence: "SPECIALIZED",
    executionContractVersion: 1,
    identities: [{
      providerDriver: "multi-protocol-relay",
      providerModelId: "suno-v4.5",
      providerProtocol: "media-generate",
    }],
    logicalModelId: "suno-v4.5",
    modes: executionModes({ default: { roles: textOnly } }),
    parameterKeys: [
      "inputMode", "musicGenerationMode", "lyrics", "vocalGender", "sampleRate",
      "bitrate", "outputCount",
    ],
    recoveryIdentity,
    resultCount: 1,
    resultKind: "audio",
    runtime: "specialized-code",
  },
] satisfies readonly ModelExecutionDescriptor[]);

function identityKey(input: ModelExecutionIdentity & { capability: ModelCapability }) {
  return [
    input.capability,
    input.providerDriver,
    input.providerModelId,
    input.providerProtocol,
  ].join(":");
}

export class ExactModelExecutionRegistry {
  readonly #byIdentity = new Map<string, ModelExecutionDescriptor>();

  constructor(readonly entries: readonly ModelExecutionDescriptor[]) {
    for (const entry of entries) {
      for (const identity of entry.identities) {
        const key = identityKey({ capability: entry.capability, ...identity });
        if (this.#byIdentity.has(key)) {
          throw new Error(`模型执行registry身份重复：${key}`);
        }
        this.#byIdentity.set(
          key,
          identity.adapterId && identity.adapterId !== entry.adapterId
            ? Object.freeze({ ...entry, adapterId: identity.adapterId })
            : entry,
        );
      }
    }
  }

  resolve(input: ModelExecutionIdentity & { capability: ModelCapability }) {
    return this.#byIdentity.get(identityKey(input));
  }
}

export const currentModelExecutionRegistry = new ExactModelExecutionRegistry(
  descriptors as readonly ModelExecutionDescriptor[],
);

export const currentPublishedModelExecutionDescriptors =
  descriptors as readonly ModelExecutionDescriptor[];

export function registeredModelExecution(
  input: ModelExecutionIdentity & { capability: ModelCapability },
) {
  return currentModelExecutionRegistry.resolve(input);
}

function schemaModes(schema: ModelParameterSchema) {
  return schema.referencePolicy
    ? Object.keys(schema.referencePolicy.modes).sort()
    : ["default"];
}

function activeRolePolicy(schema: ModelParameterSchema, mode: string) {
  const modeKey = schema.referencePolicy?.modeKey;
  const values = { ...defaultParameterValues(schema), ...(modeKey ? { [modeKey]: mode } : {}) };
  const exact = schema.inputPolicy?.rolePolicies?.find((policy) =>
    parameterConditionsMatch(policy.enabledWhen, values)
  );
  if (exact) return exact;
  return schema.inputPolicy
    ? { roles: schema.inputPolicy.roles ?? {} }
    : undefined;
}

function representativeInputs(
  schema: ModelParameterSchema,
  mode: string,
  setIndex: number,
  boundary: "minimum" | "maximum",
) {
  const set = schema.referencePolicy?.modes[mode]?.sets[setIndex] ?? {
    audio: schema.referenceInputs.audio,
    image: schema.referenceInputs.image,
    video: schema.referenceInputs.video,
  };
  const rolePolicy = activeRolePolicy(schema, mode);
  const result: ModelSemanticInput[] = [];
  let order = 1;
  for (const kind of ["audio", "image", "video"] as const) {
    const maximum = set[kind];
    if (maximum < 1) continue;
    const limits = (rolePolicy?.limits ?? []).filter((limit) => limit.kind === kind);
    const required = limits.reduce((total, limit) => total + limit.minCount, 0);
    const count = boundary === "maximum" ? maximum : Math.max(1, required);
    const assignment = rolePolicy?.assignment?.[kind] ?? [];
    const allowed = rolePolicy?.roles[kind] ?? [];
    for (let index = 0; index < count; index += 1) {
      const requiredRole = limits.flatMap((limit) =>
        Array.from({ length: limit.minCount }, () => limit.role)
      )[index];
      const role = requiredRole ?? assignment[index] ??
        allowed.find((candidate) =>
          !(limits.find((limit) => limit.role === candidate)?.maxCount === 1 &&
            result.some((item) => item.kind === kind && item.role === candidate))
        ) ?? allowed[0] ?? `reference-${kind}`;
      result.push({
        kind,
        order,
        role,
        semanticId: `${mode}-${kind}-${order}`,
      });
      order += 1;
    }
  }
  const textRole = rolePolicy?.roles.text?.[0];
  if (textRole) {
    result.push({
      kind: "text",
      order,
      role: textRole,
      semanticId: `${mode}-text-${order}`,
    });
  }
  return result;
}

export type ModelExecutionTotality = Readonly<{
  adapterId: ModelExecutionAdapterId;
  contractFingerprints: readonly string[];
  consumedParameterKeys: readonly string[];
  consumedRoles: readonly string[];
  descriptor: ModelExecutionDescriptor;
  modes: readonly string[];
  resultCount: 1;
}>;

export type ModelExecutionTotalityInput = Readonly<{
  capability: ModelCapability;
  capabilitySchema: ModelParameterSchema;
  providerDriver: string;
  providerModelId: string;
  providerProtocol: ProviderProtocol;
  revisionIdentity?: string;
}>;

function declaredRolesForMode(
  schema: ModelParameterSchema,
  mode: string,
) {
  const policy = activeRolePolicy(schema, mode);
  const modeSets = schema.referencePolicy?.modes[mode]?.sets;
  const maximum = modeSets?.reduce((result, set) => ({
    audio: Math.max(result.audio, set.audio),
    image: Math.max(result.image, set.image),
    video: Math.max(result.video, set.video),
  }), { audio: 0, image: 0, video: 0 });
  return new Set(Object.entries(policy?.roles ?? {}).flatMap(([kind, roles]) => {
    if (
      schema.referencePolicy && kind !== "text" &&
      (maximum?.[kind as "audio" | "image" | "video"] ?? 0) < 1
    ) return [];
    return (roles ?? []).map((role) => `${kind}:${role}`);
  }));
}

/**
 * Zero-Provider publication proof for an exact current model identity.
 * Every schema field, enumerated value, mode, role and count boundary must be
 * accepted by the one registered adapter descriptor.
 */
export function assertModelExecutionRegistryTotality(
  registry: ExactModelExecutionRegistry,
  input: ModelExecutionTotalityInput,
): ModelExecutionTotality {
  const descriptor = registry.resolve(input);
  if (!descriptor) throw new Error("模型缺少精确执行registry，不能发布或创建新任务");
  const schemaKeys = input.capabilitySchema.fields.map((field) => field.key);
  if (new Set(schemaKeys).size !== schemaKeys.length) {
    throw new Error("模型schema参数键重复");
  }
  const allowedParameters = new Set(descriptor.parameterKeys);
  const unconsumedParameters = schemaKeys.filter((key) => !allowedParameters.has(key));
  if (unconsumedParameters.length) {
    throw new Error(`模型schema参数未被精确adapter消费：${unconsumedParameters.join(",")}`);
  }
  const undeclaredParameters = descriptor.parameterKeys.filter((key) =>
    !schemaKeys.includes(key)
  );
  if (undeclaredParameters.length) {
    throw new Error(`精确adapter声明了schema不存在的参数：${undeclaredParameters.join(",")}`);
  }
  const outputCount = input.capabilitySchema.fields.find((field) =>
    field.key === "outputCount"
  );
  if (
    !outputCount || outputCount.defaultValue !== descriptor.resultCount ||
    outputCount.options.some((option) => option.value !== descriptor.resultCount)
  ) throw new Error("模型schema结果数量与精确adapter不一致");
  const defaults = defaultParameterValues(input.capabilitySchema);
  for (const field of input.capabilitySchema.fields) {
    const candidates: ModelParameterValue[] = field.options.length
      ? field.options.map((option) => option.value)
      : [field.defaultValue];
    for (const candidate of candidates) {
      const values = {
        ...defaults,
        [field.key]: candidate,
      };
      for (const dependent of input.capabilitySchema.fields) {
        if (
          parameterFieldRequired(dependent, values) &&
          typeof values[dependent.key] === "string" &&
          !String(values[dependent.key]).trim()
        ) values[dependent.key] = "totality";
      }
      validateParameterValues(input.capabilitySchema, values);
    }
  }
  const modes = schemaModes(input.capabilitySchema);
  const registeredModes = Object.keys(descriptor.modes).sort();
  if (JSON.stringify(registeredModes) !== JSON.stringify(modes)) {
    throw new Error("模型schema模式与精确adapter注册不一致");
  }
  if (input.capabilitySchema.referencePolicy) {
    const policy = input.capabilitySchema.referencePolicy;
    const declaredMode = input.capabilitySchema.fields.find((field) =>
      field.key === policy.modeKey
    );
    const options = declaredMode?.options.map((option) => String(option.value)).sort() ?? [];
    if (JSON.stringify(options) !== JSON.stringify(modes)) {
      throw new Error("模型schema模式选项与语义referencePolicy不一致");
    }
    const overlapping = modes.some((left, leftIndex) =>
      modes.slice(leftIndex + 1).some((right) =>
        policy.modes[left].sets.some((leftSet) =>
          policy.modes[right].sets.some((rightSet) =>
            Math.min(leftSet.audio, rightSet.audio) +
                Math.min(leftSet.image, rightSet.image) +
                Math.min(leftSet.video, rightSet.video) > 0
          )
        )
      )
    );
    if (overlapping &&
      (!policy.normalizationPriority ||
        policy.normalizationPriority.length !== modes.length ||
        modes.some((mode) => !policy.normalizationPriority!.includes(mode)))) {
      throw new Error("模型重叠输入模式缺少完整规范化优先级");
    }
  }
  const fingerprints: string[] = [];
  const consumedRoles = new Set<string>();
  for (const mode of modes) {
    const registeredMode = descriptor.modes[mode];
    if (!registeredMode) throw new Error(`模型模式${mode}缺少精确adapter注册`);
    const declaredRoles = declaredRolesForMode(input.capabilitySchema, mode);
    const exactRoles = new Set(Object.entries(registeredMode.roles).flatMap(
      ([kind, roles]) => (roles ?? []).map((role) => `${kind}:${role}`),
    ));
    if (
      [...declaredRoles].some((role) => !exactRoles.has(role)) ||
      [...exactRoles].some((role) => !declaredRoles.has(role))
    ) {
      throw new Error(`模型模式${mode}的schema角色与精确adapter注册不一致`);
    }
    declaredRoles.forEach((role) => consumedRoles.add(role));
    const setCount = input.capabilitySchema.referencePolicy?.modes[mode]?.sets.length ?? 1;
    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      for (const boundary of ["minimum", "maximum"] as const) {
        const connectedInputs = representativeInputs(
          input.capabilitySchema,
          mode,
          setIndex,
          boundary,
        );
        const requestedParameters = {
          ...defaults,
          ...(input.capabilitySchema.referencePolicy
            ? { [input.capabilitySchema.referencePolicy.modeKey]: mode }
            : {}),
        };
        const semantic = normalizeModelInputs({
          connectedInputs,
          modelReleaseRevision: input.revisionIdentity ?? "publication-totality-v2",
          requestedParameters,
          schema: input.capabilitySchema,
          transitionIntent: "execute",
        });
        if (
          semantic.blockingProblems.length ||
          semantic.selectedExecutionMode !== mode
        ) {
          throw new Error(`模型模式${mode}不能唯一编译到精确执行路径`);
        }
        for (const item of semantic.normalizedSemanticInputs) {
          const exact = registeredMode.roles[item.kind] ?? [];
          if (!exact.includes(item.role)) {
            throw new Error(`模型角色${item.kind}:${item.role}未被精确adapter消费`);
          }
          consumedRoles.add(`${item.kind}:${item.role}`);
        }
        fingerprints.push(semantic.contractFingerprint);
      }
    }
  }
  return Object.freeze({
    adapterId: descriptor.adapterId,
    contractFingerprints: Object.freeze(fingerprints),
    consumedParameterKeys: Object.freeze([...schemaKeys].sort()),
    consumedRoles: Object.freeze([...consumedRoles].sort()),
    descriptor,
    modes: Object.freeze(modes),
    resultCount: descriptor.resultCount,
  });
}

export function assertRegisteredModelExecutionTotality(
  input: ModelExecutionTotalityInput,
): ModelExecutionTotality {
  return assertModelExecutionRegistryTotality(currentModelExecutionRegistry, input);
}

export function compileRegisteredModelTaskDecision(input: {
  capability: ModelCapability;
  capabilitySchema: ModelParameterSchema;
  contractFingerprint?: string;
  costCurrency: "CNY" | "USD";
  providerDriver: string;
  providerModelId: string;
  providerProtocol: ProviderProtocol;
  revisionIdentity?: string;
}) {
  const descriptor = registeredModelExecution(input);
  if (!descriptor) throw new Error("当前模型没有精确执行合同，已在Provider前阻断");
  if (descriptor.costCurrency !== input.costCurrency) {
    throw new Error("模型费用币种与精确执行合同不一致");
  }
  const totality = incGen017FeatureFlags().modelInputContractV2
    ? assertRegisteredModelExecutionTotality(input)
    : undefined;
  return Object.freeze({
    adapterId: descriptor.adapterId,
    contractFingerprint: input.contractFingerprint,
    costCurrency: descriptor.costCurrency,
    descriptor,
    resultCount: descriptor.resultCount,
    totality,
  });
}

function legacyAdapterId(input: {
  capability: ModelCapability;
  providerDriver: string;
  providerProtocol: ProviderProtocol;
}): ModelExecutionAdapterId | undefined {
  if (input.providerDriver === "volcengine-ark") {
    if (input.capability === "text") return "ark-text";
    if (input.capability === "video") return "ark-video";
  }
  if (input.providerDriver === "mureka" && input.capability === "audio") {
    return "mureka-audio";
  }
  if (input.providerDriver === "openrouter" && input.capability === "image") {
    return "openrouter-image";
  }
  if (input.providerDriver === "multi-protocol-relay") {
    if (input.providerProtocol === "gpt-image" && input.capability === "image") {
      return "relay-gpt-image";
    }
    if (
      input.providerProtocol === "media-generate" &&
      input.capability !== "text"
    ) return "relay-media";
  }
  return undefined;
}

/** Zero-Provider migration comparison against the pre-registry route. */
export function shadowCompareRegisteredModelExecution(input: {
  capability: ModelCapability;
  capabilitySchema: ModelParameterSchema;
  costCurrency: "CNY" | "USD";
  providerDriver: string;
  providerModelId: string;
  providerProtocol: ProviderProtocol;
  revisionIdentity?: string;
}) {
  const totality = assertRegisteredModelExecutionTotality(input);
  const legacy = Object.freeze({
    adapterId: legacyAdapterId(input),
    costCurrency: input.costCurrency,
    modes: totality.modes,
    parameterKeys: Object.freeze(
      input.capabilitySchema.fields.map((field) => field.key).sort(),
    ),
    recoveryIdentity,
    resultCount: 1 as const,
    roles: totality.consumedRoles,
  });
  const registered = Object.freeze({
    adapterId: totality.adapterId,
    costCurrency: totality.descriptor.costCurrency,
    modes: totality.modes,
    parameterKeys: totality.consumedParameterKeys,
    recoveryIdentity: totality.descriptor.recoveryIdentity,
    resultCount: totality.resultCount,
    roles: totality.consumedRoles,
  });
  const differences = (Object.keys(legacy) as Array<keyof typeof legacy>)
    .filter((key) => JSON.stringify(legacy[key]) !== JSON.stringify(registered[key]));
  return Object.freeze({
    differences: Object.freeze(differences),
    equal: differences.length === 0,
    legacy,
    providerRequests: 0 as const,
    registered,
  });
}

/** Historical tasks without an adapter snapshot remain on their frozen path. */
export function assertFrozenTaskModelExecutionAdapter(input: {
  capability: ModelCapability;
  modelExecutionAdapterId?: unknown;
  providerDriver?: unknown;
  providerModelId?: unknown;
  providerProtocol?: unknown;
}) {
  if (input.modelExecutionAdapterId === undefined) return;
  const descriptor = registeredModelExecution({
    capability: input.capability,
    providerDriver: String(input.providerDriver ?? ""),
    providerModelId: String(input.providerModelId ?? ""),
    providerProtocol: String(input.providerProtocol ?? "") as ProviderProtocol,
  });
  if (!descriptor || descriptor.adapterId !== input.modelExecutionAdapterId) {
    throw new Error("任务冻结adapter与模型执行registry不一致，已阻止Provider请求");
  }
}
