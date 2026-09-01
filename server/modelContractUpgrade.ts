import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inImmediateTransaction } from "./audit";
import {
  canonicalContractFingerprint,
  CanonicalPublishedModelContractError,
  resolveCanonicalPublishedModelContract,
} from "./canonicalPublishedModelContract";
import {
  modelContractUpgradeSeeds,
  modelReferenceCounts,
  type ModelContractUpgradeSeedRow,
} from "./modelCatalog";
import { modelReleaseBootstrapActorUserId } from "./modelReleaseBootstrap";
import {
  assertModelReleaseRevisionIntegrity,
  inspectModelReleaseDocument,
  modelContractState,
  upgradeModelContractRevision,
} from "./modelReleaseRevisionStore";
import { publishedTemplateIdsUsingModel } from "./templateContractQueries";
import type {
  ModelContractValidation,
  ModelReleaseDocument,
  ModelReleaseRevision,
} from "../types/modelReleaseRevisions";
import { currentSchemaVersion } from "./database";

export type ModelContractUpgradeAction =
  | "none"
  | "publish-revision"
  | "blocked-unclassified-drift"
  | "blocked-invalid-active";

type IncGen018ExactTransition =
  | "exact-legacy-doubao-seed-v1"
  | "exact-legacy-doubao-tts-v1"
  | "exact-gpt-image-2-async-v2";

type EquivalentRuntimeSchemaTransition =
  | "exact-legacy-doubao-seed-v1"
  | "exact-legacy-doubao-tts-v1";

type ExactPublishedBaseline = Readonly<{
  activeCompilerHash: string;
  activeDocumentHash: string;
  activeRevisionId: string;
  activeRevisionNumber: number;
  activeSchemaHash: string;
  bindingEnabled: number;
  bindingIsDefault: number;
  capability: ModelContractUpgradeSeedRow["capability"];
  catalogCredentialRevisionSha256: string;
  connectorFamily: ModelReleaseDocument["connectorFamily"];
  connectorVersion: number;
  costCurrency: "CNY" | "USD";
  displayName: string;
  driver: string;
  executionContractVersion: number;
  historyCount: number;
  keyStatus: string;
  maxCostMicrounits: number;
  modelId: string;
  predecessorRevisionId: string | null;
  profileId: string;
  protocol: ModelContractUpgradeSeedRow["provider_protocol"];
  providerConfigurationVersion: number;
  providerModelId: string;
  providerStatus: string;
  rawDefaultParametersSha256: string;
  runtime: ModelReleaseDocument["runtime"];
}>;

type ApprovedTransition = Readonly<{
  equivalentRuntimeSchemaTransition?: EquivalentRuntimeSchemaTransition;
  expectedCapabilitySchemaHash: string;
  expectedCompilerHash: string;
  expectedDocumentHash: string;
  targetIdentity?: Readonly<{
    displayName: string;
    protocol: ModelContractUpgradeSeedRow["provider_protocol"];
    providerModelId: string;
  }>;
  transition: IncGen018ExactTransition;
}>;

type ModelContractUpgradePolicyContext = Readonly<{
  catalogCredentialRevisionSha256ByProfileId: Readonly<
    Record<string, string>
  >;
}>;

const emptySha256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const exactPublishedBaselines = Object.freeze({
  "3919d490-8739-490a-8bce-0678c27e4760": Object.freeze({
    activeCompilerHash:
      "41f6a8567ab7962610d0a8b125f539543184e27b30c478a39e98117fabf6ab6b",
    activeDocumentHash:
      "b2256a99265cf5d97c16b8628e179bf0f2c340d9ec4632b3ca41a1af9a4c7ad3",
    activeRevisionId: "9ebf4e43-1aff-4e83-9272-212cbc5113d9",
    activeRevisionNumber: 1,
    activeSchemaHash:
      "6e0c43fc0c84192b097a064febaecf9ee7cb2a4aadf77e2f26e855d90ea14c33",
    bindingEnabled: 1,
    bindingIsDefault: 0,
    capability: "video",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "specialized-code",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "可灵-Omni 参考生",
    driver: "multi-protocol-relay",
    executionContractVersion: 1,
    historyCount: 1,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "3919d490-8739-490a-8bce-0678c27e4760",
    predecessorRevisionId: null,
    profileId: "06831aee-5794-44cd-8e43-cc613eb60fdf",
    protocol: "media-generate",
    providerConfigurationVersion: 1,
    providerModelId: "kling-v3-omni-cankao",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "6e0c43fc0c84192b097a064febaecf9ee7cb2a4aadf77e2f26e855d90ea14c33",
    runtime: "specialized-code",
  }),
  "4d6196b4-00de-46ca-8011-383ad810a865": Object.freeze({
    activeCompilerHash:
      "563854ea2f7561ee80e24da97a2467802825dae94a8b46a7f827544bde2d332a",
    activeDocumentHash:
      "b39ef1b3dc324d8e8b2e0a8964369e1f2b49ff21f28d9a540ba3a044f678f7de",
    activeRevisionId: "dfbd24d0-9751-4145-9e95-1b8e074e7c94",
    activeRevisionNumber: 2,
    activeSchemaHash:
      "500621cb1e6058a153ad424af9759bc650cff68d049cf9c5769c49bb3608d4b8",
    bindingEnabled: 1,
    bindingIsDefault: 0,
    capability: "audio",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "mureka-native",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "Mureka V9",
    driver: "mureka",
    executionContractVersion: 2,
    historyCount: 2,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "4d6196b4-00de-46ca-8011-383ad810a865",
    predecessorRevisionId: "b626484c-670c-4298-a9e5-90fbf87ee8bb",
    profileId: "b8ee8c7a-6526-4a40-9d76-1d998f7d3eb0",
    protocol: "native",
    providerConfigurationVersion: 1,
    providerModelId: "mureka-9",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "500621cb1e6058a153ad424af9759bc650cff68d049cf9c5769c49bb3608d4b8",
    runtime: "specialized-code",
  }),
  "624827c6-5541-4cc8-93ac-4f9d5ce79602": Object.freeze({
    activeCompilerHash:
      "efec07eeb08dbae7286c0c51b874a176f967617656d3a6d0b26734a608526a87",
    activeDocumentHash:
      "030eebf9ba8c31008f64feb0e6361d74651ff0f9eed0d41fd8820bca67a04dce",
    activeRevisionId: "02571121-893e-440f-b45f-a913b3d8d7cf",
    activeRevisionNumber: 3,
    activeSchemaHash:
      "6f42e0f72994b0cec73ae45d138cc6bc0367c16573e0b55bd5e7ad73ea9f1228",
    bindingEnabled: 1,
    bindingIsDefault: 1,
    capability: "video",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "generic-async-media",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "grok-video-3",
    driver: "multi-protocol-relay",
    executionContractVersion: 2,
    historyCount: 3,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "624827c6-5541-4cc8-93ac-4f9d5ce79602",
    predecessorRevisionId: "e873a5c3-d0cd-4a7e-bc52-4b677285795b",
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "media-generate",
    providerConfigurationVersion: 2,
    providerModelId: "grok-video-3",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "6f42e0f72994b0cec73ae45d138cc6bc0367c16573e0b55bd5e7ad73ea9f1228",
    runtime: "declarative",
  }),
  "65600fd0-739d-4359-9c9c-958e3ae49b05": Object.freeze({
    activeCompilerHash:
      "41f6a8567ab7962610d0a8b125f539543184e27b30c478a39e98117fabf6ab6b",
    activeDocumentHash:
      "91775e3368695bd583b3f48f3c11402df7f7ebba638bb3724c666e447cdf8f11",
    activeRevisionId: "bc0bcfef-21a9-4f6f-aa50-71d3e43a64ad",
    activeRevisionNumber: 1,
    activeSchemaHash:
      "51763b4a60224853285429653ed1fca45b0d73a50c6fb24ecf95e5c3b1e6d2aa",
    bindingEnabled: 1,
    bindingIsDefault: 1,
    capability: "audio",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "specialized-code",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "Doubao TTS 2.0",
    driver: "multi-protocol-relay",
    executionContractVersion: 1,
    historyCount: 1,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "65600fd0-739d-4359-9c9c-958e3ae49b05",
    predecessorRevisionId: null,
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "media-generate",
    providerConfigurationVersion: 2,
    providerModelId: "doubao-tts-2.0",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "51763b4a60224853285429653ed1fca45b0d73a50c6fb24ecf95e5c3b1e6d2aa",
    runtime: "specialized-code",
  }),
  "65830fc7-3888-48ea-a842-87db6df65ec1": Object.freeze({
    activeCompilerHash:
      "41f6a8567ab7962610d0a8b125f539543184e27b30c478a39e98117fabf6ab6b",
    activeDocumentHash:
      "5623f1bf26b2d7d8ccfd22c06d789c814a443e576a382606f96f9be79e297fc7",
    activeRevisionId: "27cac2d0-3b99-452d-956f-4d59b916f3ed",
    activeRevisionNumber: 1,
    activeSchemaHash:
      "0252f7d0778a298a6c977bb0b4c5774c5a401f49dfba90cc98eb6fb54ea8348a",
    bindingEnabled: 1,
    bindingIsDefault: 0,
    capability: "audio",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "specialized-code",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "Suno 音乐生成 4.5",
    driver: "multi-protocol-relay",
    executionContractVersion: 1,
    historyCount: 1,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "65830fc7-3888-48ea-a842-87db6df65ec1",
    predecessorRevisionId: null,
    profileId: "06831aee-5794-44cd-8e43-cc613eb60fdf",
    protocol: "media-generate",
    providerConfigurationVersion: 1,
    providerModelId: "suno-v4.5",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "0252f7d0778a298a6c977bb0b4c5774c5a401f49dfba90cc98eb6fb54ea8348a",
    runtime: "specialized-code",
  }),
  "897d3dfc-83e4-48e9-a033-ca612338681b": Object.freeze({
    activeCompilerHash:
      "334d7a4891b2f1bdf8944309e8b9e89843a3014630340b7748d2f87f9c500a90",
    activeDocumentHash:
      "421321a4c20aa02b32b9d89fe68448b82af0f58a8bcda25cc7b99ac31ae9148c",
    activeRevisionId: "a62f1d76-a416-4e29-a786-9474ead24e0d",
    activeRevisionNumber: 2,
    activeSchemaHash:
      "8dbf72d04a53ac2d3712038046f69e8e2e7ed0e6ac2bd19db501d9c62da1f2d8",
    bindingEnabled: 1,
    bindingIsDefault: 0,
    capability: "video",
    catalogCredentialRevisionSha256:
      "7f0982b117baed000cb68b1d9278f694aa3cb2e021b7189bc485a913b412af30",
    connectorFamily: "ark-native",
    connectorVersion: 1,
    costCurrency: "CNY",
    displayName: "Seedance 2.0 Mini",
    driver: "volcengine-ark",
    executionContractVersion: 2,
    historyCount: 2,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "897d3dfc-83e4-48e9-a033-ca612338681b",
    predecessorRevisionId: "6cedb460-4047-4b2a-b23e-63180bf3df11",
    profileId: "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c",
    protocol: "native",
    providerConfigurationVersion: 5,
    providerModelId: "doubao-seedance-2-0-mini-260615",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "a51f9d692d9db5f1b66c2f830b313bb7e30450d0d24917b633e8686017a5ee1c",
    runtime: "specialized-code",
  }),
  "cb2e1041-33f5-49ff-bc99-994a97622db4": Object.freeze({
    activeCompilerHash:
      "41f6a8567ab7962610d0a8b125f539543184e27b30c478a39e98117fabf6ab6b",
    activeDocumentHash:
      "0274ec16f86f27fa131bc69397137b94a577e794796aac34ea2a8e8ae55c5e46",
    activeRevisionId: "ac2fdd8a-db1f-48b8-99b0-9391d1dad386",
    activeRevisionNumber: 1,
    activeSchemaHash:
      "501a3d43dc824df94f7faae77a502fb2a6e32f85f21dd9a1310f7405a9918581",
    bindingEnabled: 1,
    bindingIsDefault: 0,
    capability: "image",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "specialized-code",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "Nano Banana Pro",
    driver: "multi-protocol-relay",
    executionContractVersion: 1,
    historyCount: 1,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "cb2e1041-33f5-49ff-bc99-994a97622db4",
    predecessorRevisionId: null,
    profileId: "06831aee-5794-44cd-8e43-cc613eb60fdf",
    protocol: "media-generate",
    providerConfigurationVersion: 1,
    providerModelId: "gemini-3-pro-image-preview",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "501a3d43dc824df94f7faae77a502fb2a6e32f85f21dd9a1310f7405a9918581",
    runtime: "specialized-code",
  }),
  "cbaf438c-1c36-48e2-807d-4ce78367d0cf": Object.freeze({
    activeCompilerHash:
      "6b31c78d50b3b1998174c824f51269ff089f0019dd156e57f9a6d421676dbc1f",
    activeDocumentHash:
      "0d562a4c26b69368fbf2f6852a601ce934ad797e59752d415fce2f83e66bf571",
    activeRevisionId: "35c5af5e-a7ea-45fc-88d2-8f54f9da65c6",
    activeRevisionNumber: 2,
    activeSchemaHash:
      "d0b50d6f0f4b549472541abac05ce0b3d188c03c0c471e644d96a9e425bb7ba7",
    bindingEnabled: 1,
    bindingIsDefault: 1,
    capability: "image",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "gpt-image",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "GPT Image 2 · 专用协议",
    driver: "multi-protocol-relay",
    executionContractVersion: 1,
    historyCount: 2,
    keyStatus: "valid",
    maxCostMicrounits: 10_000_000,
    modelId: "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
    predecessorRevisionId: "a4b2ad53-54e4-43cb-a502-69e6c8e9390b",
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "gpt-image",
    providerConfigurationVersion: 2,
    providerModelId: "gpt-image-2",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "d0b50d6f0f4b549472541abac05ce0b3d188c03c0c471e644d96a9e425bb7ba7",
    runtime: "specialized-code",
  }),
  "ee51d65e-c924-4a9a-b224-6c4ee180a0ce": Object.freeze({
    activeCompilerHash:
      "c55c41a3b4aaee5efa6db73761038a8de4c396705c4865e0c7e663522663cb0b",
    activeDocumentHash:
      "1024ab6dcc1df132f8c91969c40ed09f46a672667f100d25b099cf4b22e47e5d",
    activeRevisionId: "6ab5deb8-b273-4b8e-a11e-6cf2560dcf9c",
    activeRevisionNumber: 1,
    activeSchemaHash:
      "7903dd66de0d69795b9fc5abc81f0eca0926b955f38c5a7c4e275dbb005b347c",
    bindingEnabled: 1,
    bindingIsDefault: 1,
    capability: "text",
    catalogCredentialRevisionSha256:
      "7f0982b117baed000cb68b1d9278f694aa3cb2e021b7189bc485a913b412af30",
    connectorFamily: "ark-native",
    connectorVersion: 1,
    costCurrency: "CNY",
    displayName: "Doubao Seed",
    driver: "volcengine-ark",
    executionContractVersion: 1,
    historyCount: 1,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
    predecessorRevisionId: null,
    profileId: "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c",
    protocol: "native",
    providerConfigurationVersion: 5,
    providerModelId: "doubao-seed-2-0-lite-260428",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "7903dd66de0d69795b9fc5abc81f0eca0926b955f38c5a7c4e275dbb005b347c",
    runtime: "specialized-code",
  }),
  "f2abd864-4e38-4081-af52-820629032033": Object.freeze({
    activeCompilerHash:
      "41f6a8567ab7962610d0a8b125f539543184e27b30c478a39e98117fabf6ab6b",
    activeDocumentHash:
      "4af6cef0098159092cfb76ba70d3b63a7d08d6eba96fc4a2d140f798f9e2961f",
    activeRevisionId: "e3824408-b340-4b1a-b6de-34042f616854",
    activeRevisionNumber: 2,
    activeSchemaHash:
      "79896f3f0acedf21a1818cdd0018246f2ef678ea26f1c3bd77f1006d5611e7be",
    bindingEnabled: 1,
    bindingIsDefault: 0,
    capability: "video",
    catalogCredentialRevisionSha256: emptySha256,
    connectorFamily: "specialized-code",
    connectorVersion: 1,
    costCurrency: "USD",
    displayName: "grok-video-3.5",
    driver: "multi-protocol-relay",
    executionContractVersion: 1,
    historyCount: 2,
    keyStatus: "valid",
    maxCostMicrounits: 0,
    modelId: "f2abd864-4e38-4081-af52-820629032033",
    predecessorRevisionId: "16ecf19d-8329-4771-80e5-5db0f0e90cc2",
    profileId: "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    protocol: "media-generate",
    providerConfigurationVersion: 2,
    providerModelId: "grok-imagine-video-1.5-preview",
    providerStatus: "enabled",
    rawDefaultParametersSha256:
      "79896f3f0acedf21a1818cdd0018246f2ef678ea26f1c3bd77f1006d5611e7be",
    runtime: "specialized-code",
  }),
} satisfies Readonly<Record<string, ExactPublishedBaseline>>);

const approvedTransitions = Object.freeze({
  "65600fd0-739d-4359-9c9c-958e3ae49b05": Object.freeze({
    equivalentRuntimeSchemaTransition: "exact-legacy-doubao-tts-v1",
    expectedCapabilitySchemaHash:
      "15d30ed0e85c5a6a54242cce5ac48a72c9848fe5313cea81e6769b4f58859ad2",
    expectedCompilerHash:
      "41f6a8567ab7962610d0a8b125f539543184e27b30c478a39e98117fabf6ab6b",
    expectedDocumentHash:
      "4d89f4032e7721d9f396d18cda3dfd5181906625042934bbb97c961378113e56",
    targetIdentity: undefined,
    transition: "exact-legacy-doubao-tts-v1",
  }),
  "cbaf438c-1c36-48e2-807d-4ce78367d0cf": Object.freeze({
    equivalentRuntimeSchemaTransition: undefined,
    expectedCapabilitySchemaHash:
      "d0b50d6f0f4b549472541abac05ce0b3d188c03c0c471e644d96a9e425bb7ba7",
    expectedCompilerHash:
      "d50a0345ea0e2e44252b5cd208eacc0fddf30afbbc8726523185f7c1b5689c25",
    expectedDocumentHash:
      "a2693d360e1192a9bde9d2ccb2259f54f30cf0e6c315fd7cc9d10005171d2527",
    targetIdentity: Object.freeze({
      displayName: "TT Image 2 · 异步可恢复",
      protocol: "media-generate",
      providerModelId: "tt-image-2",
    }),
    transition: "exact-gpt-image-2-async-v2",
  }),
  "ee51d65e-c924-4a9a-b224-6c4ee180a0ce": Object.freeze({
    equivalentRuntimeSchemaTransition: "exact-legacy-doubao-seed-v1",
    expectedCapabilitySchemaHash:
      "05cf5e3e6433ebb90d4ad21ff14d8c205b63e84bb0ba8536e0e939a031d7cfc4",
    expectedCompilerHash:
      "c55c41a3b4aaee5efa6db73761038a8de4c396705c4865e0c7e663522663cb0b",
    expectedDocumentHash:
      "5a2556c9f18cb1e2d46e0ffaecc8025eff93244def1e4f8d8fea4e54322197e9",
    targetIdentity: undefined,
    transition: "exact-legacy-doubao-seed-v1",
  }),
} satisfies Readonly<Record<string, ApprovedTransition>>);

const expectedPublishedModelIds = Object.freeze(
  Object.keys(exactPublishedBaselines).sort(),
);
const expectedMigrationModelIds = Object.freeze(
  Object.keys(approvedTransitions).sort(),
);
const productionPolicyContext = Object.freeze({
  catalogCredentialRevisionSha256ByProfileId: Object.freeze({}),
}) satisfies ModelContractUpgradePolicyContext;
const emptyImpact = Object.freeze({
  incompatibleTemplateIds: Object.freeze([]),
  templateIds: Object.freeze([]),
}) satisfies ModelContractValidation["impact"];

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

function snapshotHash(value: unknown) {
  const serialized = JSON.stringify(stable(value));
  return createHash("sha256")
    .update(serialized === undefined ? "undefined" : serialized)
    .digest("hex");
}

function rawSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type Difference = Readonly<{ after: unknown; before: unknown; path: string }>;

function differences(before: unknown, after: unknown, path = "$"): Difference[] {
  if (snapshotHash(before) === snapshotHash(after)) return [];
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
    return Array.from(
      { length: Math.max(before.length, after.length) },
      (_, index) => differences(
        index < before.length ? before[index] : "<missing>",
        index < after.length ? after[index] : "<missing>",
        `${path}[${index}]`,
      ),
    ).flat();
  }
  return [Object.freeze({ after: stable(after), before: stable(before), path })];
}

function rowStaticIdentity(row: ModelContractUpgradeSeedRow) {
  return Object.freeze({
    archivedAt: row.archived_at,
    bindingEnabled: row.binding_enabled,
    bindingIsDefault: row.binding_is_default,
    capability: row.capability,
    catalogCredentialRevisionSha256: rawSha256(
      row.catalog_credential_revision ?? "",
    ),
    costCurrency: row.cost_currency,
    displayName: row.display_name,
    driver: row.provider_driver,
    keyStatus: row.provider_key_status,
    maxCostMicrounits: row.max_cost_microunits,
    modelId: row.id,
    profileId: row.provider_profile_id,
    protocol: row.provider_protocol,
    providerConfigurationVersion: row.provider_configuration_version,
    providerModelId: row.provider_model_id,
    providerStatus: row.provider_status,
    status: row.status,
  });
}

function expectedStaticIdentity(
  baseline: ExactPublishedBaseline,
  policy: ModelContractUpgradePolicyContext,
) {
  return Object.freeze({
    archivedAt: null,
    bindingEnabled: baseline.bindingEnabled,
    bindingIsDefault: baseline.bindingIsDefault,
    capability: baseline.capability,
    catalogCredentialRevisionSha256:
      policy.catalogCredentialRevisionSha256ByProfileId[baseline.profileId] ??
        baseline.catalogCredentialRevisionSha256,
    costCurrency: baseline.costCurrency,
    displayName: baseline.displayName,
    driver: baseline.driver,
    keyStatus: baseline.keyStatus,
    maxCostMicrounits: baseline.maxCostMicrounits,
    modelId: baseline.modelId,
    profileId: baseline.profileId,
    protocol: baseline.protocol,
    providerConfigurationVersion: baseline.providerConfigurationVersion,
    providerModelId: baseline.providerModelId,
    providerStatus: baseline.providerStatus,
    status: "published",
  });
}

function acceptedStaticIdentity(
  baseline: ExactPublishedBaseline,
  transition: ApprovedTransition | undefined,
  row: ModelContractUpgradeSeedRow,
  policy: ModelContractUpgradePolicyContext,
) {
  const before = expectedStaticIdentity(baseline, policy);
  const actual = rowStaticIdentity(row);
  const beforeDifferences = differences(before, actual);
  if (beforeDifferences.length === 0) {
    return Object.freeze({
      differences: Object.freeze([]),
      state: "exact-pre" as const,
    });
  }
  if (transition?.targetIdentity) {
    const after = Object.freeze({
      ...before,
      displayName: transition.targetIdentity.displayName,
      protocol: transition.targetIdentity.protocol,
      providerModelId: transition.targetIdentity.providerModelId,
    });
    const afterDifferences = differences(after, actual);
    if (afterDifferences.length === 0) {
      return Object.freeze({
        differences: Object.freeze([]),
        state: "exact-post" as const,
      });
    }
    return Object.freeze({
      differences: Object.freeze(afterDifferences),
      state: "invalid" as const,
    });
  }
  return Object.freeze({
    differences: Object.freeze(beforeDifferences),
    state: "invalid" as const,
  });
}

function revisionSummary(revision: ModelReleaseRevision | undefined) {
  if (!revision) return null;
  return Object.freeze({
    compilerHash: revision.validation?.compilerHash,
    connectorFamily: revision.document?.connectorFamily,
    connectorVersion: revision.document?.connectorVersion,
    createdAt: revision.createdAt,
    documentHash: revision.hash,
    executionContractVersion: revision.document?.executionContract?.version,
    modelId: revision.modelId,
    predecessorRevisionId: revision.predecessorRevisionId ?? null,
    revisionId: revision.revisionId,
    revisionNumber: revision.revisionNumber,
    runtime: revision.document?.runtime,
    schemaHash: revision.document?.capabilitySchema
      ? canonicalContractFingerprint(revision.document.capabilitySchema)
      : null,
  });
}

function exactBaselineRevision(
  revision: ModelReleaseRevision,
  baseline: ExactPublishedBaseline,
) {
  return revision.modelId === baseline.modelId &&
    revision.revisionId === baseline.activeRevisionId &&
    revision.revisionNumber === baseline.activeRevisionNumber &&
    (revision.predecessorRevisionId ?? null) ===
      baseline.predecessorRevisionId &&
    revision.hash === baseline.activeDocumentHash &&
    revision.validation.compilerHash === baseline.activeCompilerHash &&
    canonicalContractFingerprint(revision.document.capabilitySchema) ===
      baseline.activeSchemaHash &&
    revision.document.connectorFamily === baseline.connectorFamily &&
    revision.document.connectorVersion === baseline.connectorVersion &&
    revision.document.executionContract.version ===
      baseline.executionContractVersion &&
    revision.document.runtime === baseline.runtime;
}

function exactPostRevision(
  state: ReturnType<typeof modelContractState>,
  baseline: ExactPublishedBaseline,
  transition: ApprovedTransition,
) {
  const active = state.active;
  const predecessor = state.history.at(-2);
  return Boolean(
    active && predecessor &&
      state.history.length === baseline.historyCount + 1 &&
      exactBaselineRevision(predecessor, baseline) &&
      active.revisionId !== baseline.activeRevisionId &&
      active.revisionNumber === baseline.activeRevisionNumber + 1 &&
      active.predecessorRevisionId === baseline.activeRevisionId &&
      active.hash === transition.expectedDocumentHash &&
      active.validation.compilerHash === transition.expectedCompilerHash &&
      canonicalContractFingerprint(active.document.capabilitySchema) ===
        transition.expectedCapabilitySchemaHash,
  );
}

function scalarCount(store: DatabaseSync, sql: string) {
  const row = store.prepare(sql).get() as { count?: number | bigint } | undefined;
  return Number(row?.count ?? 0);
}

function quietSnapshot(store: DatabaseSync) {
  return Object.freeze({
    activeTasks: scalarCount(store, `
      SELECT COUNT(*) AS count FROM generation_tasks
      WHERE state IN ('queued', 'running', 'retrying', 'recovering')
    `),
    attempts: scalarCount(
      store,
      "SELECT COUNT(*) AS count FROM generation_provider_attempts",
    ),
    canvases: scalarCount(
      store,
      "SELECT COUNT(*) AS count FROM canvas_documents",
    ),
    currentUnknownBillingTasks: scalarCount(store, `
      SELECT COUNT(*) AS count FROM generation_tasks
      WHERE error_code = 'OUTCOME_UNKNOWN_BILLING_RISK'
    `),
    unsettledProviderBoundaryUnknown: scalarCount(store, `
      SELECT COUNT(*) AS count FROM generation_provider_attempts
      WHERE evidence = 'provider-boundary'
        AND outcome = 'outcome-unknown'
        AND finished_at IS NULL
    `),
    mediaAssets: scalarCount(
      store,
      "SELECT COUNT(*) AS count FROM media_assets",
    ),
    mediaPublicationAttempts: scalarCount(
      store,
      "SELECT COUNT(*) AS count FROM media_publication_attempts",
    ),
    modelProfiles: scalarCount(
      store,
      "SELECT COUNT(*) AS count FROM model_profiles",
    ),
    publicTemplates: scalarCount(
      store,
      "SELECT COUNT(*) AS count FROM public_templates",
    ),
    publishedTemplates: scalarCount(store, `
      SELECT COUNT(*) AS count FROM public_templates
      WHERE status = 'published'
    `),
    tasks: scalarCount(store, "SELECT COUNT(*) AS count FROM generation_tasks"),
  });
}

function safeTableDigest(store: DatabaseSync, sql: string) {
  const rows = store.prepare(sql).all();
  return Object.freeze({
    rowCount: rows.length,
    sha256: snapshotHash(rows),
  });
}

/**
 * Content-identity proof for domains this migration must never write. The
 * selected columns intentionally exclude user Prompt, graph bodies, media
 * object keys, owners and Provider evidence while retaining each domain's
 * durable revision/state/checksum metadata.
 */
function unchangedDomainSnapshot(store: DatabaseSync) {
  return Object.freeze({
    canvasDocuments: safeTableDigest(store, `
      SELECT rowid, id, revision, graph_revision, updated_at,
        save_session_id, save_sequence
      FROM canvas_documents ORDER BY rowid
    `),
    generationAdmissionEvents: safeTableDigest(store, `
      SELECT id, task_id, execution_attempt, kind, admission_type, created_at
      FROM generation_admission_events ORDER BY id
    `),
    generationProviderAttempts: safeTableDigest(store, `
      SELECT id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, credential_revision, outcome,
        provider_task_id, failure_code, created_at, finished_at
      FROM generation_provider_attempts ORDER BY id
    `),
    generationTaskEvents: safeTableDigest(store, `
      SELECT id, task_id, state, error_code, created_at
      FROM generation_task_events ORDER BY id
    `),
    generationTasks: safeTableDigest(store, `
      SELECT rowid, id, canvas_id, node_id, kind, model,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        created_at, updated_at, estimated_cost_microunits,
        actual_cost_microunits, provider_profile_id, provider_model_id,
        result_asset_id, cost_currency, provider_task_id,
        provider_usage_tokens, credential_revision
      FROM generation_tasks ORDER BY rowid
    `),
    mediaAssets: safeTableDigest(store, `
      SELECT rowid, id, kind, byte_size, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height, storage_profile_id, created_at, updated_at
      FROM media_assets ORDER BY rowid
    `),
    mediaPublicationAttempts: safeTableDigest(store, `
      SELECT rowid, attempt_id, kind, asset_id, source, state, task_id,
        task_execution_attempt, byte_size, checksum_sha256, content_type,
        duration_seconds, duration_source, media_width, media_height,
        actual_cost_microunits, provider_usage_tokens, error_code,
        retry_count, adopted_at, adopted_canvas_id, created_at, updated_at
      FROM media_publication_attempts ORDER BY rowid
    `),
    projectMetadata: safeTableDigest(store, `
      SELECT rowid, id, is_project, created_at, updated_at, deleted_at
      FROM project_metadata ORDER BY rowid
    `),
    publicTemplates: safeTableDigest(store, `
      SELECT rowid, id, status, cover_asset_id, created_at, updated_at,
        archived_at
      FROM public_templates ORDER BY rowid
    `),
    userTemplates: safeTableDigest(store, `
      SELECT rowid, id, cover_asset_id, created_at, updated_at
      FROM user_templates ORDER BY rowid
    `),
  });
}

function referenceSnapshot(store: DatabaseSync, modelId: string) {
  const references = modelReferenceCounts(store, modelId);
  const templateIds = publishedTemplateIdsUsingModel(store, modelId);
  return Object.freeze({
    activeTasks: references.activeTasks,
    canvasDocuments: references.canvasDocuments,
    publishedTemplateCount: templateIds.length,
    publishedTemplateIdSetHash: snapshotHash(templateIds),
    tasks: references.tasks,
  });
}

function invalidRowReasons(row: ModelContractUpgradeSeedRow) {
  const reasons: string[] = [];
  if (!row.provider_driver) reasons.push("PROVIDER_DRIVER_MISSING");
  if (!row.provider_status) reasons.push("PROVIDER_STATUS_MISSING");
  if (!row.provider_key_status) reasons.push("PROVIDER_KEY_STATUS_MISSING");
  if (
    !Number.isSafeInteger(row.provider_configuration_version) ||
    Number(row.provider_configuration_version) < 1
  ) reasons.push("PROVIDER_CONFIGURATION_VERSION_INVALID");
  if (row.binding_enabled === null || row.binding_is_default === null) {
    reasons.push("MODEL_BINDING_MISSING");
  }
  return reasons;
}

function approvedDifferencePaths(
  transition: IncGen018ExactTransition,
  capabilityDifferences: readonly Difference[],
  documentDifferences: readonly Difference[],
) {
  if (transition === "exact-gpt-image-2-async-v2") {
    return capabilityDifferences.length === 0 &&
      documentDifferences.length > 0;
  }
  return capabilityDifferences.length === 1 &&
    capabilityDifferences[0]?.path === "$.inputPolicy" &&
    documentDifferences.length === 1 &&
    documentDifferences[0]?.path === "$.capabilitySchema.inputPolicy";
}

function classifyModel(
  store: DatabaseSync,
  row: ModelContractUpgradeSeedRow,
  policy: ModelContractUpgradePolicyContext,
) {
  const baseline = exactPublishedBaselines[
    row.id as keyof typeof exactPublishedBaselines
  ];
  const transition = approvedTransitions[
    row.id as keyof typeof approvedTransitions
  ];
  const rowSnapshot = Object.freeze({
    ...rowStaticIdentity(row),
    defaultParametersSha256: rawSha256(row.default_parameters),
  });
  const references = referenceSnapshot(store, row.id);
  if (!baseline) {
    return Object.freeze({
      action: "blocked-unclassified-drift" as const,
      activeCapabilityDifferences: Object.freeze([]),
      activeDocumentDifferences: Object.freeze([]),
      activeRevision: null,
      blockers: Object.freeze(["PUBLISHED_MODEL_NOT_IN_R0_BASELINE"]),
      displayName: row.display_name,
      catalogIdentityMatchesBaseline: false,
      executionIdentityExact: false,
      executionIdentityState: "invalid" as const,
      identityDifferences: Object.freeze([]),
      modelId: row.id,
      proposed: undefined,
      proposedCompilerHash: null,
      proposedDocumentHash: null,
      proposedSchemaHash: null,
      providerModelId: row.provider_model_id,
      referenceSnapshot: references,
      rowSnapshot,
      stateSnapshot: null,
      transition: undefined,
    });
  }
  const staticIdentity = acceptedStaticIdentity(
    baseline,
    transition,
    row,
    policy,
  );
  const identityDifferences = staticIdentity.differences;
  const invalidReasons = invalidRowReasons(row);
  let state: ReturnType<typeof modelContractState>;
  try {
    state = modelContractState(store, row.id);
  } catch {
    invalidReasons.push("MODEL_CONTRACT_EVENT_HISTORY_INVALID");
    state = Object.freeze({
      draftVersion: 0,
      history: Object.freeze([]),
      revoked: false,
    });
  }
  const stateSnapshot = Object.freeze({
    active: revisionSummary(state.active),
    draftVersion: state.draftVersion,
    hasDraft: Boolean(state.draft),
    history: Object.freeze(state.history.map((revision) => revisionSummary(revision))),
    historyCount: state.history.length,
    revoked: state.revoked,
  });
  if (state.revoked) invalidReasons.push("ACTIVE_REVISION_REVOKED");
  if (!state.active) invalidReasons.push("ACTIVE_REVISION_MISSING");
  for (const revision of state.history) {
    try {
      assertModelReleaseRevisionIntegrity(revision);
    } catch {
      invalidReasons.push("FROZEN_REVISION_INTEGRITY_INVALID");
      break;
    }
  }
  if (invalidReasons.length) {
    return Object.freeze({
      action: "blocked-invalid-active" as const,
      activeCapabilityDifferences: Object.freeze([]),
      activeDocumentDifferences: Object.freeze([]),
      activeRevision: revisionSummary(state.active),
      blockers: Object.freeze([...new Set(invalidReasons)].sort()),
      catalogIdentityMatchesBaseline: identityDifferences.length === 0,
      displayName: row.display_name,
      executionIdentityExact: false,
      executionIdentityState: "invalid" as const,
      identityDifferences: Object.freeze(identityDifferences),
      modelId: row.id,
      proposed: undefined,
      proposedCompilerHash: null,
      proposedDocumentHash: null,
      proposedSchemaHash: null,
      providerModelId: row.provider_model_id,
      referenceSnapshot: references,
      rowSnapshot,
      stateSnapshot,
      transition: undefined,
    });
  }
  if (identityDifferences.length || state.draft) {
    return Object.freeze({
      action: "blocked-unclassified-drift" as const,
      activeCapabilityDifferences: Object.freeze([]),
      activeDocumentDifferences: Object.freeze([]),
      activeRevision: revisionSummary(state.active),
      blockers: Object.freeze([
        ...(identityDifferences.length ? ["R0_STATIC_IDENTITY_DRIFT"] : []),
        ...(state.draft ? ["MODEL_CONTRACT_DRAFT_PRESENT"] : []),
      ]),
      catalogIdentityMatchesBaseline: identityDifferences.length === 0,
      displayName: row.display_name,
      executionIdentityExact: false,
      executionIdentityState: "invalid" as const,
      identityDifferences: Object.freeze(identityDifferences),
      modelId: row.id,
      proposed: undefined,
      proposedCompilerHash: null,
      proposedDocumentHash: null,
      proposedSchemaHash: null,
      providerModelId: row.provider_model_id,
      referenceSnapshot: references,
      rowSnapshot,
      stateSnapshot,
      transition: undefined,
    });
  }
  const active = state.active!;
  const rebuildingExecutionIdentity = Boolean(
    transition?.targetIdentity && staticIdentity.state === "exact-pre",
  );
  const targetIdentity = transition?.targetIdentity;
  let canonical: ReturnType<typeof resolveCanonicalPublishedModelContract>;
  try {
    canonical = resolveCanonicalPublishedModelContract({
      activeDocument: rebuildingExecutionIdentity ? undefined : active.document,
      capability: row.capability,
      costCurrency: row.cost_currency,
      defaultParameters: row.default_parameters,
      modelId: row.id,
      providerDriver: row.provider_driver!,
      providerModelId: targetIdentity?.providerModelId ?? row.provider_model_id,
      providerProfileId: row.provider_profile_id,
      providerProtocol: targetIdentity?.protocol ?? row.provider_protocol,
    });
  } catch (error) {
    const code = error instanceof CanonicalPublishedModelContractError
      ? error.code
      : "CANONICAL_RESOLUTION_FAILED";
    return Object.freeze({
      action: "blocked-invalid-active" as const,
      activeCapabilityDifferences: Object.freeze([]),
      activeDocumentDifferences: Object.freeze([]),
      activeRevision: revisionSummary(active),
      blockers: Object.freeze([code]),
      catalogIdentityMatchesBaseline: true,
      displayName: row.display_name,
      executionIdentityExact: false,
      executionIdentityState: "invalid" as const,
      identityDifferences: Object.freeze(identityDifferences),
      modelId: row.id,
      proposed: undefined,
      proposedCompilerHash: null,
      proposedDocumentHash: null,
      proposedSchemaHash: null,
      providerModelId: row.provider_model_id,
      referenceSnapshot: references,
      rowSnapshot,
      stateSnapshot,
      transition: undefined,
    });
  }
  const activeCapabilityDifferences = rebuildingExecutionIdentity
    ? differences(active.document.capabilitySchema, canonical.capabilitySchema)
    : canonical.activeCapabilityDifferences;
  const activeDocumentDifferences = rebuildingExecutionIdentity
    ? differences(active.document, canonical.targetDocument)
    : canonical.activeDocumentDifferences;
  let targetProof: ReturnType<typeof inspectModelReleaseDocument>;
  try {
    targetProof = inspectModelReleaseDocument(canonical.targetDocument);
  } catch {
    return Object.freeze({
      action: "blocked-invalid-active" as const,
      activeCapabilityDifferences,
      activeDocumentDifferences,
      activeRevision: revisionSummary(active),
      blockers: Object.freeze(["CANONICAL_TARGET_DOCUMENT_INVALID"]),
      catalogIdentityMatchesBaseline: true,
      displayName: row.display_name,
      executionIdentityExact: false,
      executionIdentityState: "invalid" as const,
      identityDifferences: Object.freeze(identityDifferences),
      modelId: row.id,
      proposed: undefined,
      proposedCompilerHash: null,
      proposedDocumentHash: null,
      proposedSchemaHash: canonical.capabilityFingerprint,
      providerModelId: row.provider_model_id,
      referenceSnapshot: references,
      rowSnapshot,
      stateSnapshot,
      transition: undefined,
    });
  }
  const proposedFields = {
    activeCapabilityDifferences,
    activeDocumentDifferences,
    activeRevision: revisionSummary(active),
    catalogIdentityMatchesBaseline: true,
    displayName: targetIdentity?.displayName ?? row.display_name,
    identityDifferences: Object.freeze(identityDifferences),
    modelId: row.id,
    proposed: canonical.targetDocument,
    proposedCompilerHash: targetProof.compilerHash,
    proposedDocumentHash: targetProof.documentHash,
    proposedSchemaHash: canonical.capabilityFingerprint,
    providerModelId: canonical.targetDocument.providerModelId,
    referenceSnapshot: references,
    rowSnapshot,
    stateSnapshot,
  } as const;
  if (transition) {
    const exactTargetProof =
      canonical.capabilityFingerprint === transition.expectedCapabilitySchemaHash &&
      targetProof.documentHash === transition.expectedDocumentHash &&
      targetProof.compilerHash === transition.expectedCompilerHash;
    const exactPreState =
      (!transition.targetIdentity || staticIdentity.state === "exact-pre") &&
      state.history.length === baseline.historyCount &&
      exactBaselineRevision(active, baseline) &&
      rawSha256(row.default_parameters) ===
      baseline.rawDefaultParametersSha256 &&
      approvedDifferencePaths(
        transition.transition,
        activeCapabilityDifferences,
        activeDocumentDifferences,
      );
    if (exactPreState && exactTargetProof) {
      return Object.freeze({
        ...proposedFields,
        action: "publish-revision" as const,
        blockers: Object.freeze([]),
        executionIdentityExact: true,
        executionIdentityState: "exact-pre" as const,
        transition: transition.transition,
      });
    }
    const exactPostState =
      (!transition.targetIdentity || staticIdentity.state === "exact-post") &&
      exactPostRevision(state, baseline, transition) &&
      rawSha256(row.default_parameters) ===
        rawSha256(JSON.stringify(canonical.capabilitySchema)) &&
      activeCapabilityDifferences.length === 0 &&
      activeDocumentDifferences.length === 0 &&
      exactTargetProof;
    if (exactPostState) {
      return Object.freeze({
        ...proposedFields,
        action: "none" as const,
        blockers: Object.freeze([]),
        executionIdentityExact: true,
        executionIdentityState: "exact-post" as const,
        transition: transition.transition,
      });
    }
    return Object.freeze({
      ...proposedFields,
      action: "blocked-unclassified-drift" as const,
      blockers: Object.freeze(["APPROVED_TARGET_NOT_EXACT_PRE_OR_POST_STATE"]),
      executionIdentityExact: false,
      executionIdentityState: "invalid" as const,
      transition: transition.transition,
    });
  }
  const exactCurrentState =
    state.history.length === baseline.historyCount &&
    exactBaselineRevision(active, baseline) &&
    rawSha256(row.default_parameters) === baseline.rawDefaultParametersSha256 &&
    activeCapabilityDifferences.length === 0 &&
    activeDocumentDifferences.length === 0 &&
    targetProof.documentHash === baseline.activeDocumentHash &&
    targetProof.compilerHash === baseline.activeCompilerHash &&
    canonical.capabilityFingerprint === baseline.activeSchemaHash;
  return Object.freeze({
    ...proposedFields,
    action: exactCurrentState
      ? "none" as const
      : "blocked-unclassified-drift" as const,
    blockers: exactCurrentState
      ? Object.freeze([])
      : Object.freeze(["NON_TARGET_PUBLISHED_MODEL_DRIFT"]),
    executionIdentityExact: exactCurrentState,
    executionIdentityState: exactCurrentState
      ? "exact-current" as const
      : "invalid" as const,
    transition: undefined,
  });
}

function modelContractUpgradePolicyHash(
  policy: ModelContractUpgradePolicyContext,
) {
  return snapshotHash({
    approvedTransitions,
    exactPublishedBaselines: Object.fromEntries(
      Object.entries(exactPublishedBaselines).map(([modelId, baseline]) => [
        modelId,
        expectedStaticIdentity(baseline, policy),
      ]),
    ),
    expectedMigrationModelIds,
    expectedPublishedModelIds,
  });
}

function planModelContractUpgradeWithPolicy(
  store: DatabaseSync,
  policy: ModelContractUpgradePolicyContext,
) {
  const schemaVersion = Number(
    (store.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
  );
  const quiet = quietSnapshot(store);
  const unchangedDomains = unchangedDomainSnapshot(store);
  const rows = modelContractUpgradeSeeds(store);
  const models = Object.freeze(
    rows.map((row) => classifyModel(store, row, policy)),
  );
  const actualModelIds = rows.map((row) => row.id).sort();
  const actualModelIdSet = new Set(actualModelIds);
  const missingExpectedModelIds = expectedPublishedModelIds.filter(
    (modelId) => !actualModelIdSet.has(modelId),
  );
  const unexpectedPublishedModelIds = actualModelIds.filter(
    (modelId) => !(modelId in exactPublishedBaselines),
  );
  const providerModelIds = rows.map((row) => row.provider_model_id).sort();
  const baselineSnapshotHash = snapshotHash({
    models: models.map((model) => ({
      referenceSnapshot: model.referenceSnapshot,
      rowSnapshot: model.rowSnapshot,
      stateSnapshot: model.stateSnapshot,
    })),
    quiet,
    schemaVersion,
    unchangedDomains,
  });
  const approvedBaselinePolicyHash = modelContractUpgradePolicyHash(policy);
  const planHash = snapshotHash({
    approvedBaselinePolicyHash,
    baselineSnapshotHash,
    missingExpectedModelIds,
    models: models.map((model) => ({
      action: model.action,
      activeCapabilityDifferences: model.activeCapabilityDifferences,
      activeDocumentDifferences: model.activeDocumentDifferences,
      blockers: model.blockers,
      identityDifferences: model.identityDifferences,
      modelId: model.modelId,
      proposedCompilerHash: model.proposedCompilerHash,
      proposedDocumentHash: model.proposedDocumentHash,
      proposedSchemaHash: model.proposedSchemaHash,
      transition: model.transition,
    })),
    unexpectedPublishedModelIds,
  });
  const actionCounts = Object.freeze({
    blockedInvalidActive: models.filter((model) =>
      model.action === "blocked-invalid-active"
    ).length,
    blockedUnclassifiedDrift: models.filter((model) =>
      model.action === "blocked-unclassified-drift"
    ).length,
    none: models.filter((model) => model.action === "none").length,
    publishRevision: models.filter((model) =>
      model.action === "publish-revision"
    ).length,
  });
  return Object.freeze({
    actionCounts,
    approvedBaselinePolicyHash,
    approvedModelCount: models.filter((model) =>
      model.catalogIdentityMatchesBaseline
    ).length,
    auditedModelCount: models.length,
    baselineSnapshotHash,
    catalogIdentityMatchCount: models.filter((model) =>
      model.catalogIdentityMatchesBaseline
    ).length,
    exactExecutionIdentityCount: models.filter((model) =>
      model.executionIdentityExact
    ).length,
    healthyModelCount: actionCounts.none,
    missingExpectedModelIds: Object.freeze(missingExpectedModelIds),
    models,
    paidProviderRequests: 0 as const,
    planHash,
    providerModelIds: Object.freeze(providerModelIds),
    providerModelSetHash: snapshotHash(providerModelIds),
    publishedModelCount: rows.length,
    quietSnapshot: quiet,
    schemaVersion,
    unchangedDomainSnapshot: unchangedDomains,
    unexpectedPublishedModelIds: Object.freeze(unexpectedPublishedModelIds),
  });
}

export function planModelContractUpgrade(store: DatabaseSync) {
  return planModelContractUpgradeWithPolicy(store, productionPolicyContext);
}

export type ModelContractUpgradePlan = ReturnType<
  typeof planModelContractUpgrade
>;

function activateTargetRelease(
  store: DatabaseSync,
  row: ModelContractUpgradeSeedRow,
  document: ModelReleaseDocument,
) {
  const baseline = exactPublishedBaselines[
    row.id as keyof typeof exactPublishedBaselines
  ];
  const transition = approvedTransitions[
    row.id as keyof typeof approvedTransitions
  ];
  const targetProof = inspectModelReleaseDocument(document);
  if (
    !baseline || !transition ||
    rawSha256(row.default_parameters) !== baseline.rawDefaultParametersSha256 ||
    canonicalContractFingerprint(document.capabilitySchema) !==
      transition.expectedCapabilitySchemaHash ||
    targetProof.documentHash !== transition.expectedDocumentHash ||
    targetProof.compilerHash !== transition.expectedCompilerHash
  ) throw new Error("目标模型激活身份与核准迁移不一致");
  const serialized = JSON.stringify(document.capabilitySchema);
  const targetDisplayName = transition.targetIdentity?.displayName ??
    baseline.displayName;
  const targetProviderModelId = transition.targetIdentity?.providerModelId ??
    baseline.providerModelId;
  const targetProtocol = transition.targetIdentity?.protocol ?? baseline.protocol;
  if (
    document.providerModelId !== targetProviderModelId ||
    document.providerProtocol !== targetProtocol
  ) throw new Error("目标模型文档与核准静态身份不一致");
  const timestamp = new Date().toISOString();
  const changed = store.prepare(`
    UPDATE model_profiles
    SET default_parameters = ?, display_name = ?, provider_model_id = ?,
      provider_protocol = ?, updated_at = ?
    WHERE id = ?
      AND display_name = ?
      AND capability = ?
      AND provider_profile_id = ?
      AND provider_model_id = ?
      AND provider_protocol = ?
      AND cost_currency = ?
      AND max_cost_microunits = ?
      AND default_parameters = ?
      AND status = 'published'
      AND archived_at IS NULL
      AND EXISTS (
        SELECT 1 FROM provider_profiles AS provider
        WHERE provider.id = model_profiles.provider_profile_id
          AND provider.driver = ?
          AND provider.status = ?
          AND provider.key_status = ?
          AND provider.provider_configuration_version = ?
          AND provider.catalog_credential_revision IS ?
      )
      AND EXISTS (
        SELECT 1 FROM node_model_bindings AS binding
        WHERE binding.model_id = model_profiles.id
          AND binding.node_type = model_profiles.capability
          AND binding.enabled = ?
          AND binding.is_default = ?
      )
  `).run(
    serialized,
    targetDisplayName,
    targetProviderModelId,
    targetProtocol,
    timestamp,
    row.id,
    baseline.displayName,
    baseline.capability,
    baseline.profileId,
    baseline.providerModelId,
    baseline.protocol,
    baseline.costCurrency,
    baseline.maxCostMicrounits,
    row.default_parameters,
    baseline.driver,
    baseline.providerStatus,
    baseline.keyStatus,
    baseline.providerConfigurationVersion,
    row.catalog_credential_revision,
    baseline.bindingEnabled,
    baseline.bindingIsDefault,
  );
  if (changed.changes !== 1) {
    throw new Error("目标模型published row CAS已变化，升级已阻断");
  }
}

function sameReferenceSnapshots(
  before: ModelContractUpgradePlan,
  after: ModelContractUpgradePlan,
) {
  return snapshotHash(before.models.map((model) => ({
    modelId: model.modelId,
    referenceSnapshot: model.referenceSnapshot,
  }))) === snapshotHash(after.models.map((model) => ({
    modelId: model.modelId,
    referenceSnapshot: model.referenceSnapshot,
  })));
}

type ModelContractUpgradeApplyInput = Readonly<{
  expectedBaselineSnapshotHash: string;
  expectedPlanHash: string;
}>;

function applyModelContractUpgradeWithPolicy(
  store: DatabaseSync,
  actorUserId: string,
  input: ModelContractUpgradeApplyInput,
  policy: ModelContractUpgradePolicyContext,
) {
  return inImmediateTransaction(store, () => {
    const before = planModelContractUpgradeWithPolicy(store, policy);
    if (before.baselineSnapshotHash !== input.expectedBaselineSnapshotHash) {
      throw new Error("dry-run基线快照已变化，升级CAS已阻断");
    }
    if (before.planHash !== input.expectedPlanHash) {
      throw new Error("dry-run计划摘要已变化，升级CAS已阻断");
    }
    const publishedDenominator = before.publishedModelCount;
    if (
      before.schemaVersion !== currentSchemaVersion ||
      before.auditedModelCount !== publishedDenominator ||
      before.catalogIdentityMatchCount !== publishedDenominator ||
      before.exactExecutionIdentityCount !== publishedDenominator ||
      before.missingExpectedModelIds.length ||
      before.unexpectedPublishedModelIds.length
    ) throw new Error("升级只允许在R0核准的当前schema/10模型精确基线上执行");
    if (
      before.quietSnapshot.activeTasks !== 0 ||
      before.quietSnapshot.currentUnknownBillingTasks !== 0 ||
      before.quietSnapshot.unsettledProviderBoundaryUnknown !== 0
    ) {
      throw new Error(
        "活动任务、当前unknown-billing任务或未收口Provider边界证据阻断合同升级",
      );
    }
    const blocked = before.models.filter((model) =>
      model.action === "blocked-invalid-active" ||
      model.action === "blocked-unclassified-drift"
    );
    if (blocked.length) {
      throw new Error(
        `存在未分类或无效的published模型合同，升级在写入前阻断: ${
          blocked.map((model) => model.modelId).join(",")
        }`,
      );
    }
    const publishable = before.models.filter((model) =>
      model.action === "publish-revision"
    );
    const publishableIds = publishable.map((model) => model.modelId).sort();
    const exactPostIds = before.models.filter((model) =>
      model.executionIdentityState === "exact-post" &&
      model.transition !== undefined
    ).map((model) => model.modelId).sort();
    const approvedStateIds = [...publishableIds, ...exactPostIds].sort();
    if (
      snapshotHash(approvedStateIds) !== snapshotHash(expectedMigrationModelIds)
    ) throw new Error("合同升级动作集合不等于全部核准精确迁移");
    const rowsById = new Map(
      modelContractUpgradeSeeds(store).map((row) => [row.id, row]),
    );
    const releases = publishable.map((model) => {
      const row = rowsById.get(model.modelId);
      const proposed = model.proposed;
      const transition = model.transition;
      const transitionPolicy = approvedTransitions[
        model.modelId as keyof typeof approvedTransitions
      ];
      if (!row || !proposed || !transition || !transitionPolicy) {
        throw new Error("合同升级目标缺少精确计划身份");
      }
      const release = upgradeModelContractRevision(store, actorUserId, {
        document: proposed,
        equivalentRuntimeSchemaTransition:
          transitionPolicy.equivalentRuntimeSchemaTransition,
        expectedActiveRevisionId: model.activeRevision!.revisionId,
        impact: emptyImpact,
      }, (revision) => activateTargetRelease(store, row, revision.document));
      if (!release.changed) throw new Error("核准迁移未创建新的immutable revision");
      return Object.freeze({
        changed: release.changed,
        modelId: model.modelId,
        providerModelId: model.providerModelId,
        revisionId: release.revision.revisionId,
        revisionNumber: release.revision.revisionNumber,
      });
    });
    const after = planModelContractUpgradeWithPolicy(store, policy);
    const afterPublishedDenominator = after.publishedModelCount;
    if (
      after.models.some((model) => model.action !== "none") ||
      afterPublishedDenominator !== publishedDenominator ||
      after.auditedModelCount !== afterPublishedDenominator ||
      after.healthyModelCount !== afterPublishedDenominator ||
      after.catalogIdentityMatchCount !== afterPublishedDenominator ||
      after.exactExecutionIdentityCount !== afterPublishedDenominator ||
      after.missingExpectedModelIds.length ||
      after.unexpectedPublishedModelIds.length ||
      after.quietSnapshot.activeTasks !== 0 ||
      after.quietSnapshot.currentUnknownBillingTasks !== 0 ||
      after.quietSnapshot.unsettledProviderBoundaryUnknown !== 0
    ) throw new Error("升级后10/10 published模型未达到精确健康终态");
    if (
      snapshotHash(before.quietSnapshot) !== snapshotHash(after.quietSnapshot) ||
      snapshotHash(before.unchangedDomainSnapshot) !==
        snapshotHash(after.unchangedDomainSnapshot) ||
      !sameReferenceSnapshots(before, after)
    ) throw new Error(
      "升级改变了任务、模板、Canvas、媒体或publication内容身份",
    );
    return Object.freeze({
      afterBaselineSnapshotHash: after.baselineSnapshotHash,
      afterPlanHash: after.planHash,
      beforeBaselineSnapshotHash: before.baselineSnapshotHash,
      beforePlanHash: before.planHash,
      changed: releases.length > 0,
      paidProviderRequests: 0 as const,
      upgradedModels: Object.freeze(releases),
    });
  });
}

export function applyModelContractUpgrade(
  store: DatabaseSync,
  actorUserId: string,
  input: ModelContractUpgradeApplyInput,
) {
  return applyModelContractUpgradeWithPolicy(
    store,
    actorUserId,
    input,
    productionPolicyContext,
  );
}

const safeTestCatalogCredentialRevision =
  "inc-gen-018-safe-test-ark-catalog-revision";

/**
 * Offline-only seam for the m102 production-shape fixture. It replaces only
 * the opaque Ark catalog credential-revision fingerprint, never a model,
 * Provider, protocol, revision, document, compiler or schema identity. The
 * normal planner, CLI and apply API always use the R0 production fingerprint.
 */
export function createIncGen018ModelContractUpgradeSafeTestHarness() {
  const testRepositoryRoot = process.env.UNBOUNDRY_TEST_REPOSITORY_ROOT;
  const originalRepositoryRoot = process.env.UNBOUNDRY_ORIGINAL_REPOSITORY_ROOT;
  if (
    process.env.UNBOUNDRY_SAFE_TEST !== "1" ||
    !testRepositoryRoot ||
    !originalRepositoryRoot ||
    realpathSync(testRepositoryRoot) !== realpathSync(process.cwd()) ||
    resolve(originalRepositoryRoot) === realpathSync(testRepositoryRoot)
  ) throw new Error("INC-GEN-018 test policy只允许隔离safe-test源码副本");
  const policy = Object.freeze({
    catalogCredentialRevisionSha256ByProfileId: Object.freeze({
      "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c":
        rawSha256(safeTestCatalogCredentialRevision),
    }),
  }) satisfies ModelContractUpgradePolicyContext;
  return Object.freeze({
    apply(
      store: DatabaseSync,
      actorUserId: string,
      input: ModelContractUpgradeApplyInput,
    ) {
      return applyModelContractUpgradeWithPolicy(
        store,
        actorUserId,
        input,
        policy,
      );
    },
    catalogCredentialRevision: safeTestCatalogCredentialRevision,
    plan(store: DatabaseSync) {
      return planModelContractUpgradeWithPolicy(store, policy);
    },
  });
}

export type ModelContractUpgradeResult = ReturnType<
  typeof applyModelContractUpgrade
>;

function fileSha256(path: string) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function parseCli(argv: readonly string[]) {
  let apply = false;
  let dataDirectory: string | undefined;
  let expectedAttestationSha256: string | undefined;
  let expectedBaselineHash: string | undefined;
  let expectedPlanHash: string | undefined;
  let stagingRoot: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--apply" && !apply) {
      apply = true;
      continue;
    }
    if ([
      "--data-dir",
      "--expected-attestation-sha256",
      "--expected-baseline-hash",
      "--expected-plan-hash",
      "--staging-root",
    ].includes(item) && argv[index + 1]) {
      const value = argv[++index];
      if (value.startsWith("--")) throw new Error("合同升级参数无效");
      if (item === "--data-dir" && !dataDirectory) dataDirectory = value;
      else if (item === "--staging-root" && !stagingRoot) stagingRoot = value;
      else if (item === "--expected-plan-hash" && !expectedPlanHash) {
        expectedPlanHash = value;
      } else if (item === "--expected-baseline-hash" && !expectedBaselineHash) {
        expectedBaselineHash = value;
      } else if (
        item === "--expected-attestation-sha256" &&
        !expectedAttestationSha256
      ) expectedAttestationSha256 = value;
      else throw new Error("合同升级参数无效");
      continue;
    }
    throw new Error("合同升级参数无效");
  }
  if (!dataDirectory || !isAbsolute(dataDirectory)) {
    throw new Error("必须用--data-dir提供绝对隔离数据目录");
  }
  if (apply && (!stagingRoot || !isAbsolute(stagingRoot))) {
    throw new Error("apply必须用--staging-root声明绝对恢复暂存根目录");
  }
  if (apply && !/^[a-f0-9]{64}$/.test(expectedBaselineHash ?? "")) {
    throw new Error("apply必须提供dry-run输出的--expected-baseline-hash");
  }
  if (apply && !/^[a-f0-9]{64}$/.test(expectedPlanHash ?? "")) {
    throw new Error("apply必须提供dry-run输出的--expected-plan-hash");
  }
  if (apply && !/^[a-f0-9]{64}$/.test(expectedAttestationSha256 ?? "")) {
    throw new Error("apply必须提供可信--expected-attestation-sha256");
  }
  return {
    apply,
    dataDirectory,
    expectedAttestationSha256,
    expectedBaselineHash,
    expectedPlanHash,
    stagingRoot,
  };
}

function attestApplyDirectory(
  dataDirectory: string,
  stagingRoot: string,
  databaseIdentity: Stats,
  expectedAttestationSha256: string,
) {
  const stagingIdentity = lstatSync(stagingRoot);
  if (stagingIdentity.isSymbolicLink() || !stagingIdentity.isDirectory()) {
    throw new Error("恢复暂存根目录身份无效");
  }
  const realData = realpathSync(dataDirectory);
  const dataIdentity = lstatSync(realData);
  if ((dataIdentity.mode & 0o077) !== 0) {
    throw new Error("恢复暂存数据目录必须为私有目录");
  }
  const realRoot = realpathSync(stagingRoot);
  const fixedLocalTemporaryRoot = process.platform === "darwin"
    ? "/private/var/folders"
    : "/tmp";
  const realTemporaryRoot = realpathSync(fixedLocalTemporaryRoot);
  if (
    realRoot !== "/var/lib/unboundry-rollbacks" &&
    realRoot !== realTemporaryRoot &&
    !realRoot.startsWith(`${realTemporaryRoot}${sep}`)
  ) throw new Error("恢复暂存根目录不在固定隔离allowlist");
  const withinRoot = relative(realRoot, realData);
  if (
    !withinRoot || withinRoot === ".." ||
    withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)
  ) throw new Error("apply数据目录必须是恢复暂存根目录的直接隔离后代");
  const configuredData = process.env.UNBOUNDRY_DATA_DIR &&
      isAbsolute(process.env.UNBOUNDRY_DATA_DIR)
    ? resolve(process.env.UNBOUNDRY_DATA_DIR)
    : undefined;
  const forbidden = [
    resolve(process.cwd(), "data"),
    "/var/lib/unboundry",
    "/opt/unboundry",
    ...(configuredData
      ? [existsSync(configuredData) ? realpathSync(configuredData) : configuredData]
      : []),
  ];
  if (forbidden.some((path) =>
    realData === path || realData.startsWith(`${path}${sep}`)
  )) throw new Error("禁止对应用或生产数据目录直接执行合同升级");
  const attestationPath = join(
    realData,
    ".model-contract-upgrade-recovery.json",
  );
  if (!existsSync(attestationPath)) throw new Error("恢复暂存证明文件不存在");
  const identity = lstatSync(attestationPath);
  if (
    identity.isSymbolicLink() || !identity.isFile() || identity.nlink !== 1 ||
    (identity.mode & 0o277) !== 0
  ) throw new Error("恢复暂存证明文件身份无效");
  const attestationBytes = readFileSync(attestationPath);
  if (
    createHash("sha256").update(attestationBytes).digest("hex") !==
      expectedAttestationSha256
  ) throw new Error("恢复暂存证明摘要与核准manifest不一致");
  const parsed = JSON.parse(
    attestationBytes.toString("utf8"),
  ) as Record<string, unknown>;
  const databasePath = join(realData, "unboundry.sqlite");
  if (
    parsed.purpose !== "INC-GEN-018" ||
    parsed.schemaVersion !== currentSchemaVersion ||
    parsed.dataDirectoryRealPath !== realData ||
    parsed.databaseFileName !== "unboundry.sqlite" ||
    parsed.databaseSizeBytes !== databaseIdentity.size ||
    parsed.databaseSha256 !== fileSha256(databasePath) ||
    typeof parsed.snapshotId !== "string" || !parsed.snapshotId.trim()
  ) throw new Error("恢复暂存证明与待升级数据库不匹配");
}

export function runModelContractUpgradeCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  const dataIdentity = lstatSync(options.dataDirectory);
  const databasePath = join(options.dataDirectory, "unboundry.sqlite");
  const databaseIdentity = lstatSync(databasePath);
  if (
    dataIdentity.isSymbolicLink() || !dataIdentity.isDirectory() ||
    databaseIdentity.isSymbolicLink() || !databaseIdentity.isFile() ||
    databaseIdentity.nlink !== 1 ||
    realpathSync(databasePath) !==
      join(realpathSync(options.dataDirectory), "unboundry.sqlite")
  ) throw new Error("合同升级数据目录身份无效");
  if (options.apply) {
    attestApplyDirectory(
      options.dataDirectory,
      options.stagingRoot!,
      databaseIdentity,
      options.expectedAttestationSha256!,
    );
  }
  const store = new DatabaseSync(databasePath, {
    readOnly: !options.apply,
    timeout: 5_000,
  });
  try {
    const plan = planModelContractUpgrade(store);
    const result = options.apply
      ? applyModelContractUpgrade(
          store,
          modelReleaseBootstrapActorUserId(store),
          {
            expectedBaselineSnapshotHash: options.expectedBaselineHash!,
            expectedPlanHash: options.expectedPlanHash!,
          },
        )
      : undefined;
    const report = Object.freeze({
      mode: options.apply ? "apply" : "dry-run",
      paidProviderRequests: 0 as const,
      plan,
      ...(result ? { result } : {}),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    store.close();
  }
}
