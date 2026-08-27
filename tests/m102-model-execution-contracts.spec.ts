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
  defaultParameterSchema,
  knownModelParameterSchema,
} from "../types/modelParameters";
import {
  pollContractRelayMediaTask,
  submitContractRelayMedia,
} from "../server/relayProviderAdapters";
import { modelReleaseBootstrapActorUserId } from "../server/modelReleaseBootstrap";
import { modelContractTemplateCompatibilitySignature } from "../server/modelCatalog";
import {
  assertGenerationTaskModelReleaseSnapshotIntegrity,
  relayMediaParametersForTask,
} from "../server/generationTasks";
import {
  applyModelContractUpgrade,
  planModelContractUpgrade,
  runModelContractUpgradeCli,
} from "../server/modelContractUpgrade";

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
    const current = releaseDocument();
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

function productionGkTemplateRows(modelId = "model-gk-video-3") {
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
        videoParameters: productionGkAudit.normalizedNodeContract.parameters,
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
        ('provider-ark', 'volcengine-ark', 'enabled', 'valid', 'catalog-ark-1', 1);
    `);
    const rows = [
      ["model-text", "text", "doubao-seed-2-0-lite-260428", "provider-ark", "native"],
      ["model-image-gemini", "image", "gemini-3-pro-image-preview", "provider-relay", "native"],
      ["model-image-gpt", "image", "gpt-image-2", "provider-relay", "gpt-image"],
      ["model-video-seedance", "video", "doubao-seedance-2-0-mini-260615", "provider-ark", "media-generate"],
      ["model-video-grok-imagine", "video", "grok-imagine-video-1.5-preview", "provider-relay", "media-generate"],
      ["model-video-kling", "video", "kling-v3-omni-cankao", "provider-relay", "media-generate"],
      ["model-audio-mureka", "audio", "mureka-9", "provider-relay", "media-generate"],
      ["model-audio-tts", "audio", "doubao-tts-2.0", "provider-relay", "media-generate"],
      ["model-audio-suno", "audio", "suno-v4.5", "provider-relay", "media-generate"],
      ["model-gk-video-3", "video", "grok-video-3", "provider-relay", "media-generate"],
      ["model-kwvideo-v2", "video", "kwvideo-v2", "provider-relay", "media-generate"],
    ] as const;
    for (const [id, capability, providerModelId, providerProfileId, providerProtocol] of rows) {
      const providerDriver = providerProfileId === "provider-ark"
        ? "volcengine-ark"
        : "multi-protocol-relay";
      const capabilitySchema = knownModelParameterSchema({
        capability,
        providerDriver,
        providerModelId,
      });
      store.prepare(`
        INSERT INTO model_profiles VALUES (?, ?, ?, ?, ?, ?, 'published', NULL, ?, ?)
      `).run(
        id,
        capability,
        JSON.stringify(capabilitySchema),
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
        capabilitySchema,
        modelId: id,
        providerDriver,
        providerModelId,
        providerProfileId,
        providerProtocol,
      });
      const document = id === "model-gk-video-3"
        ? {
            ...currentDocument,
            executionContract: {
              ...currentDocument.executionContract,
              version: 1 as const,
            },
          }
        : currentDocument;
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
    for (const row of productionGkTemplateRows()) {
      store.prepare("INSERT INTO public_templates VALUES (?, ?, 'published')")
        .run(row.id, row.graph);
    }
    store.prepare("INSERT INTO canvas_documents VALUES (?)")
      .run(JSON.stringify([{ data: { videoModelId: "model-kwvideo-v2" } }]));
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
    expect(plan.models.find((model) => model.providerModelId === "kwvideo-v2"))
      .toMatchObject({ action: "archive", hasTextFoundation: false });
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
    expect(() => applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: invalidCredentialPlan.baselineSnapshotHash,
    })).toThrow(/Provider状态或配置版本/);
    store.prepare("DELETE FROM account_provider_credentials").run();
    store.prepare("DELETE FROM node_model_bindings WHERE model_id = 'model-gk-video-3'").run();
    expect(() => applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
    }))
      .toThrow(/模型能力绑定不存在/);
    expect(modelContractState(store, "model-gk-video-3").history).toHaveLength(1);
    expect(store.prepare("SELECT status, archived_at FROM model_profiles WHERE id = 'model-kwvideo-v2'").get())
      .toEqual({ status: "published", archived_at: null });
    store.prepare("INSERT INTO node_model_bindings VALUES ('video', 'model-gk-video-3', 1, 0, ?)")
      .run("2026-08-27T00:00:00.000Z");
    const applied = applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: plan.baselineSnapshotHash,
    });
    expect(applied).toMatchObject({
      archivedKwvideo: true,
      gkRevisionChanged: true,
      gkRevisionNumber: 2,
      paidProviderRequests: 0,
    });
    expect(modelContractState(store, "model-gk-video-3").history).toHaveLength(2);
    expect(store.prepare("SELECT status, archived_at FROM model_profiles WHERE id = 'model-kwvideo-v2'").get())
      .toMatchObject({ status: "disabled", archived_at: expect.any(String) });
    const repeatedPlan = planModelContractUpgrade(store);
    const repeated = applyModelContractUpgrade(store, "admin-a", {
      expectedBaselineSnapshotHash: repeatedPlan.baselineSnapshotHash,
    });
    expect(repeated).toMatchObject({
      archivedKwvideo: false,
      gkRevisionChanged: false,
      gkRevisionNumber: 2,
      paidProviderRequests: 0,
    });
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

test("GK transport accepts only exact task, status and single-result fields", async () => {
  const calls: Array<{ body?: unknown; url: string }> = [];
  const responses = [
    { task_id: "task-gk-001" },
    { result_url: "https://cdn.example.test/result.mp4", state: "success" },
  ];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      url: String(input),
    });
    return new Response(JSON.stringify(responses.shift()), {
      headers: { "Content-Type": "application/json" },
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
  }, gkContract, { fetcher });
  expect(submission.externalTaskId).toBe("task-gk-001");
  const result = await pollContractRelayMediaTask(connection, {
    capability: "video",
    externalTaskId: submission.externalTaskId,
    providerProtocol: "media-generate",
  }, gkContract, { fetcher });
  expect(result).toMatchObject({
    outputs: [{ transientUrl: "https://cdn.example.test/result.mp4" }],
    state: "success",
  });
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
      isDefault: true,
      providerModelId: "fixture-image-model",
      providerProfileId: provider.id,
      sortOrder: 1,
      status: "published",
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
  await expect(page.getByText("本地验证通过；Provider 请求为 0。")).toBeVisible();
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：无")).toBeVisible();
  await expect(page.locator("#model-contract-preview")).toContainText("fixture-image-model");
  await page.getByRole("button", { name: "已保存草稿", exact: true }).click();
  await expect(page.locator("#model-contract-preview")).toContainText("已保存草稿：无");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存；本次没有调用 Provider。")).toBeVisible();
  await page.getByRole("button", { name: "已保存草稿", exact: true }).click();
  await expect(page.locator("#model-contract-preview")).toContainText("fixture-image-model");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByText("当前页面：无未保存修改 · 已保存草稿：无 · 当前发布版本：1")).toBeVisible();
  await expect(validateButton).toBeEnabled();
  await expect(page.getByText("草稿发生并发冲突，没有覆盖另一位管理员。")).toHaveCount(0);
});
