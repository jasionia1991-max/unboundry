import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { auditEvents, inImmediateTransaction, recordAudit } from "./audit";
import {
  compileModelContractRequest,
  compileModelExecutionContract,
} from "./modelExecutionContractCompiler";
import {
  assertCurrentModelReleasePolicy,
  assertExecutionVersionTransition,
  currentModelReleasePolicyDrift,
} from "./currentModelReleasePolicy";
export {
  currentModelReleasePolicyDrift,
  ModelContractPolicyError,
} from "./currentModelReleasePolicy";
import type { ModelExecutionContract } from "../types/modelExecutionContracts";
import type {
  ModelContractDraft,
  ModelContractState,
  ModelContractValidation,
  ModelReleaseDocument,
  ModelReleaseRevision,
} from "../types/modelReleaseRevisions";

const actions = [
  "model_contract.draft",
  "model_contract.validate",
  "model_contract.publish",
  "model_contract.rollback",
  "model_contract.revoke",
  "model_contract.restore",
] as const;
const bootstrapAction = "model_contract.bootstrap_complete" as const;

export class ModelContractConflictError extends Error {
  readonly code = "MODEL_CONTRACT_DRAFT_CONFLICT";
}

export class ModelContractIntegrityError extends Error {
  constructor(
    readonly code:
      | "FROZEN_REVISION_COMPILER_HASH_MISMATCH"
      | "FROZEN_REVISION_DOCUMENT_HASH_MISMATCH"
      | "FROZEN_REVISION_DOCUMENT_INVALID"
      | "FROZEN_REVISION_IDENTITY_INVALID"
      | "FROZEN_REVISION_RUNTIME_VERSION_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "ModelContractIntegrityError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (record(value)) return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])]),
  );
  return value;
}

function documentHash(document: ModelReleaseDocument) {
  return createHash("sha256")
    .update(JSON.stringify(stable(document)))
    .digest("hex");
}

export function inspectModelReleaseDocument(document: ModelReleaseDocument) {
  const compiled = validateFrozenDocument(document);
  return Object.freeze({
    compilerHash: compiled.hash,
    documentHash: documentHash(document),
  });
}

/**
 * Revalidates the immutable release snapshot carried by a task before a
 * Provider boundary. Running tasks intentionally do not have to match the
 * newest active revision, but their own document, compiler proof and hash must
 * remain internally exact.
 */
export function assertModelReleaseRevisionIntegrity(
  input: unknown,
): asserts input is ModelReleaseRevision {
  if (!record(input) || !record(input.document) || !record(input.validation)) {
    throw new ModelContractIntegrityError(
      "FROZEN_REVISION_IDENTITY_INVALID",
      "模型合同快照无效",
    );
  }
  const revision = input as unknown as ModelReleaseRevision;
  if (
    !/^[0-9a-f-]{36}$/i.test(String(revision.revisionId)) ||
    !Number.isSafeInteger(revision.revisionNumber) ||
    revision.revisionNumber < 1 ||
    revision.modelId !== revision.document.modelId ||
    revision.validation.paidProviderRequests !== 0
  ) throw new ModelContractIntegrityError(
    "FROZEN_REVISION_IDENTITY_INVALID",
    "模型合同快照身份无效",
  );
  let compiled: ReturnType<typeof validateFrozenDocument>;
  try {
    compiled = validateFrozenDocument(revision.document);
  } catch (error) {
    if (error instanceof ModelContractIntegrityError) throw error;
    throw new ModelContractIntegrityError(
      "FROZEN_REVISION_DOCUMENT_INVALID",
      "模型合同快照未通过有限安全规则",
    );
  }
  if (revision.hash !== documentHash(revision.document)) {
    throw new ModelContractIntegrityError(
      "FROZEN_REVISION_DOCUMENT_HASH_MISMATCH",
      "模型合同快照文档哈希不一致",
    );
  }
  if (revision.validation.compilerHash !== compiled.hash) {
    throw new ModelContractIntegrityError(
      "FROZEN_REVISION_COMPILER_HASH_MISMATCH",
      "模型合同快照编译哈希不一致",
    );
  }
}

function validModelId(modelId: string) {
  if (!/^[a-z0-9-]{3,80}$/i.test(modelId)) throw new Error("模型ID无效");
  return modelId;
}

const supportedRuntimeVersions = Object.freeze({
  "generic-async-media": Object.freeze({ 1: [1, 2] }),
  "specialized-code": Object.freeze({ 1: [1] }),
  "openai-chat": Object.freeze({ 1: [1] }),
  "openai-responses": Object.freeze({ 1: [1] }),
  "claude-messages": Object.freeze({ 1: [1] }),
  "gemini-generate-content": Object.freeze({ 1: [1] }),
  "gpt-image": Object.freeze({ 1: [1] }),
  "ark-native": Object.freeze({ 1: [1] }),
  "mureka-native": Object.freeze({ 1: [1] }),
} as const);

function assertRuntimeVersionSupported(document: ModelReleaseDocument) {
  const connector = supportedRuntimeVersions[document.connectorFamily];
  const versions = connector?.[
    document.connectorVersion as keyof typeof connector
  ] as readonly number[] | undefined;
  if (!versions?.includes(document.executionContract.version)) {
    throw new ModelContractIntegrityError(
      "FROZEN_REVISION_RUNTIME_VERSION_UNSUPPORTED",
      `运行时不支持 ${document.connectorFamily}/${document.connectorVersion}/contract-${document.executionContract.version}`,
    );
  }
}

function validateFrozenDocument(document: ModelReleaseDocument) {
  validModelId(document.modelId);
  if (
    !["blocked", "declarative", "specialized-code"].includes(document.runtime) ||
    !["EXACT", "GENERIC_GUESS", "SPECIALIZED", "UNKNOWN"].includes(document.evidence) ||
    !/^[a-z0-9._:-]{1,120}(?:\/[a-z0-9._:-]{1,120})?$/i.test(
      document.providerModelId,
    ) ||
    document.providerModelId.length > 160 ||
    !/^[a-z0-9-]{3,120}$/i.test(document.providerProfileId) ||
    !Number.isSafeInteger(document.connectorVersion) ||
    document.connectorVersion < 1 ||
    document.documentation.length > 20 ||
    (document.evidence === "EXACT" &&
      document.providerModelId !== "grok-video-3" &&
      document.documentation.length < 1) ||
    document.documentation.some((item) => {
      try {
        const url = new URL(item.url);
        return url.protocol !== "https:" ||
          Boolean(url.username || url.password || url.search || url.hash) ||
          !/^\d{4}-\d{2}-\d{2}/.test(item.checkedAt);
      } catch {
        return true;
      }
    })
  ) throw new Error("模型发布文档身份或官方来源无效");
  assertRuntimeVersionSupported(document);
  const compiled = compileModelExecutionContract(document.executionContract);
  if (
    compiled.contract.connectorFamily !== document.connectorFamily ||
    compiled.contract.connectorVersion !== document.connectorVersion
  ) throw new Error("connector与执行合同版本不一致");
  const exactDeclarative = document.providerModelId === "grok-video-3";
  if (
    (document.runtime === "declarative" && (
      document.evidence !== "EXACT" ||
      (exactDeclarative && (
        document.providerProtocol !== "media-generate" ||
        document.connectorFamily !== "generic-async-media"
      ))
    )) ||
    (document.runtime === "blocked" && document.evidence !== "UNKNOWN") ||
    (document.evidence === "UNKNOWN" && document.runtime !== "blocked") ||
    (document.runtime === "specialized-code" && exactDeclarative)
  ) throw new Error("runtime必须与代码拥有的connector和证据等级一致");
  const parameterKeys = new Set(document.capabilitySchema.fields.map((field) => field.key));
  const providerParameterKeys = new Set(
    document.capabilitySchema.fields
      .map((field) => field.key)
      .filter((key) => key !== "inputMode" && key !== "outputCount"),
  );
  for (const executionMode of compiled.contract.modes) {
    for (const item of executionMode.bindings) {
      if (item.source.kind === "parameter" && !parameterKeys.has(item.source.key)) {
        throw new Error(`请求绑定引用了schema中不存在的参数 ${item.source.key}`);
      }
    }
    if (document.runtime === "declarative") {
      for (const key of providerParameterKeys) {
        const count = executionMode.bindings.filter((item) =>
          item.source.kind === "parameter" && item.source.key === key
        ).length;
        if (count !== 1) {
          throw new Error(`声明式模式必须且只能消费一次模型参数 ${key}`);
        }
      }
    }
  }
  return compiled;
}

function validateCurrentReleaseDocument(document: ModelReleaseDocument) {
  const compiled = validateFrozenDocument(document);
  assertCurrentModelReleasePolicy(document, compiled.hash);
  return compiled;
}

function compiledPreview(
  document: ModelReleaseDocument,
  contract: ModelExecutionContract,
): ModelContractValidation["preview"] {
  const parameters = Object.fromEntries(
    document.capabilitySchema.fields.map((field) => [field.key, field.defaultValue]),
  );
  return Object.freeze({
    modes: Object.freeze(contract.modes.map((mode) => {
      let order = 1;
      const inputs = mode.roles.flatMap((role) =>
        Array.from({ length: role.minItems }, (_, index) => ({
          kind: role.kind,
          order: order++,
          roleId: role.id,
          value: role.shape === "url"
            ? `https://example.invalid/${role.id}-${index + 1}`
            : `file-example-${role.id}-${index + 1}`,
        })),
      );
      const blocked = mode.runtime === "blocked" || mode.evidence === "UNKNOWN";
      const request = blocked
        ? {
            body: Object.freeze({}),
            method: contract.create.method,
            path: contract.create.path,
            query: Object.freeze({}),
          }
        : compileModelContractRequest(contract, {
            inputs,
            modelId: document.providerModelId,
            parameters,
            prompt: "示例提示词",
          });
      return Object.freeze({
        ...(blocked
          ? { blockedReason: "该模式缺少精确Provider证据，新任务已阻断" }
          : {}),
        body: request.body,
        ...(mode.evidence ? { evidence: mode.evidence } : {}),
        method: request.method,
        modeId: mode.id,
        path: request.path,
        query: request.query,
        ...(mode.runtime ? { runtime: mode.runtime } : {}),
      });
    })),
  });
}

export function validateModelContractDocument(
  document: ModelReleaseDocument,
  validationInput?: Partial<Pick<ModelContractValidation, "impact" | "preview">>,
) {
  const compiled = validateCurrentReleaseDocument(document);
  return Object.freeze({
    compilerHash: compiled.hash,
    impact: validationInput?.impact ?? {
      incompatibleTemplateIds: [],
      templateIds: [],
    },
    paidProviderRequests: 0,
    preview: validationInput?.preview ?? compiledPreview(
      document,
      compiled.contract,
    ),
    validatedAt: new Date().toISOString(),
  } satisfies ModelContractValidation);
}

function assertPublishedRoleIdentities(
  history: readonly ModelReleaseRevision[],
  document: ModelReleaseDocument,
) {
  const identities = new Map<string, string>();
  for (const revision of history) {
    for (const mode of revision.document.executionContract.modes) {
      for (const role of mode.roles) {
        identities.set(role.id, JSON.stringify({
          kind: role.kind,
          maxItems: role.maxItems,
          minItems: role.minItems,
          ordered: role.ordered,
          shape: role.shape,
        }));
      }
    }
  }
  for (const mode of document.executionContract.modes) {
    for (const role of mode.roles) {
      const identity = JSON.stringify({
        kind: role.kind,
        maxItems: role.maxItems,
        minItems: role.minItems,
        ordered: role.ordered,
        shape: role.shape,
      });
      const prior = identities.get(role.id);
      if (prior && prior !== identity) {
        throw new Error(`已发布角色ID ${role.id} 不得复用为不同语义`);
      }
    }
  }
  const currentRoleIds = new Set(
    document.executionContract.modes.flatMap((mode) => mode.roles.map((role) => role.id)),
  );
  for (const priorRoleId of identities.keys()) {
    if (!currentRoleIds.has(priorRoleId)) {
      throw new Error(`已发布角色ID ${priorRoleId} 不得删除`);
    }
  }
}

function stateFromEvents(store: DatabaseSync, modelId: string): ModelContractState {
  const relevant = auditEvents(store, actions).filter(
    (event) => event.details.modelId === modelId,
  );
  const history: ModelReleaseRevision[] = [];
  let draft: ModelContractDraft | undefined;
  let draftVersion = 0;
  let revoked = false;
  for (const event of relevant) {
    if (event.action === "model_contract.draft" || event.action === "model_contract.validate") {
      draft = event.details.draft as ModelContractDraft;
      draftVersion = Math.max(draftVersion, draft?.draftVersion ?? 0);
    } else if (
      event.action === "model_contract.publish" ||
      event.action === "model_contract.rollback"
    ) {
      const revision = event.details.revision as ModelReleaseRevision;
      if (revision?.modelId === modelId) history.push(revision);
      draft = undefined;
    } else if (event.action === "model_contract.revoke") {
      revoked = true;
    } else if (event.action === "model_contract.restore") {
      revoked = false;
    }
  }
  return Object.freeze({
    ...(history.length && !revoked ? { active: history.at(-1) } : {}),
    ...(draft ? { draft } : {}),
    draftVersion,
    history: Object.freeze(history),
    revoked,
  });
}

export function modelContractState(store: DatabaseSync, modelId: string) {
  return stateFromEvents(store, validModelId(modelId));
}

export function modelContractsRequired(store: DatabaseSync) {
  return auditEvents(store, [bootstrapAction]).length > 0;
}

export function markModelContractsRequired(
  store: DatabaseSync,
  actorUserId: string,
  details: Readonly<{ modelIds: readonly string[]; total: number }>,
) {
  return inImmediateTransaction(store, () => {
    if (modelContractsRequired(store)) return false;
    recordAudit(store, actorUserId, bootstrapAction, null, {
      modelIds: [...details.modelIds].sort(),
      paidProviderRequests: 0,
      total: details.total,
    });
    return true;
  });
}

export function saveModelContractDraft(
  store: DatabaseSync,
  actorUserId: string,
  document: ModelReleaseDocument,
  expectedDraftVersion: number,
  validationInput?: Partial<Pick<ModelContractValidation, "impact" | "preview">>,
) {
  validModelId(document.modelId);
  return inImmediateTransaction(store, () => {
    const actual = stateFromEvents(store, document.modelId).draftVersion;
    if (actual !== expectedDraftVersion) {
      throw new ModelContractConflictError(
        `草稿已由其他管理员更新（当前版本 ${actual}）`,
      );
    }
    const draft: ModelContractDraft = Object.freeze({
      document: structuredClone(document),
      draftVersion: actual + 1,
      modelId: document.modelId,
      savedAt: new Date().toISOString(),
      ...(validationInput
        ? { validation: validateModelContractDocument(document, validationInput) }
        : {}),
    });
    recordAudit(store, actorUserId, "model_contract.draft", null, {
      draft,
      modelId: document.modelId,
    });
    return draft;
  });
}

export function validateModelContractDraft(
  store: DatabaseSync,
  actorUserId: string,
  modelId: string,
  expectedDraftVersion: number,
  validationInput?: Partial<Pick<ModelContractValidation, "impact" | "preview">>,
) {
  return inImmediateTransaction(store, () => {
    const draft = stateFromEvents(store, validModelId(modelId)).draft;
    if (!draft || draft.draftVersion !== expectedDraftVersion) {
      throw new ModelContractConflictError("草稿版本已变化，请重新加载");
    }
    const validation = validateModelContractDocument(
      draft.document,
      validationInput,
    );
    const validated = Object.freeze({ ...draft, validation });
    recordAudit(store, actorUserId, "model_contract.validate", null, {
      draft: validated,
      modelId,
    });
    return validated;
  });
}

export function publishModelContract(
  store: DatabaseSync,
  actorUserId: string,
  modelId: string,
  expectedDraftVersion: number,
  onActivate?: (revision: ModelReleaseRevision) => void,
) {
  return inImmediateTransaction(store, () => {
    const state = stateFromEvents(store, validModelId(modelId));
    const validatedDraft = state.draft;
    if (!validatedDraft || validatedDraft.draftVersion !== expectedDraftVersion) {
      throw new ModelContractConflictError("草稿版本已变化，发布已阻断");
    }
    if (!validatedDraft.validation) throw new Error("请先完成本地验证");
    const compiled = validateCurrentReleaseDocument(validatedDraft.document);
    assertPublishedRoleIdentities(state.history, validatedDraft.document);
    if (compiled.hash !== validatedDraft.validation.compilerHash ||
      validatedDraft.validation.impact.incompatibleTemplateIds.length) {
      throw new Error("验证已失效或存在不兼容模板，发布已阻断");
    }
    const predecessor = state.history.at(-1);
    assertExecutionVersionTransition(predecessor, validatedDraft.document);
    const revision: ModelReleaseRevision = Object.freeze({
      createdAt: new Date().toISOString(),
      document: structuredClone(validatedDraft.document),
      hash: documentHash(validatedDraft.document),
      modelId: validatedDraft.modelId,
      ...(predecessor ? { predecessorRevisionId: predecessor.revisionId } : {}),
      revisionId: randomUUID(),
      revisionNumber: (predecessor?.revisionNumber ?? 0) + 1,
      validation: structuredClone(validatedDraft.validation),
    });
    onActivate?.(revision);
    recordAudit(store, actorUserId, "model_contract.publish", null, {
      modelId: revision.modelId,
      revision,
    });
    return revision;
  });
}

/**
 * Explicit, CAS-bound upgrade path for code-owned release policies. Unlike
 * bootstrap, this never skips a detected drift and never rewrites history.
 * Validation, activation and the immutable publish event share one SQLite
 * transaction; a failure leaves draft, history, active bindings and templates
 * unchanged.
 */
export function upgradeModelContractRevision(
  store: DatabaseSync,
  actorUserId: string,
  input: Readonly<{
    document: ModelReleaseDocument;
    expectedActiveRevisionId: string;
    impact: ModelContractValidation["impact"];
  }>,
  onActivate?: (revision: ModelReleaseRevision) => void,
) {
  const operation = () => {
    const state = stateFromEvents(store, validModelId(input.document.modelId));
    const predecessor = state.history.at(-1);
    if (
      state.revoked ||
      !predecessor ||
      predecessor.revisionId !== input.expectedActiveRevisionId
    ) {
      throw new ModelContractConflictError(
        "活动模型合同已变化，升级已阻断",
      );
    }
    assertModelReleaseRevisionIntegrity(predecessor);
    const nextHash = documentHash(input.document);
    if (predecessor.hash === nextHash) {
      return Object.freeze({ changed: false as const, revision: predecessor });
    }
    const validation = validateModelContractDocument(input.document, {
      impact: input.impact,
    });
    if (validation.impact.incompatibleTemplateIds.length) {
      throw new Error("存在不兼容模板，合同升级已阻断");
    }
    assertPublishedRoleIdentities(state.history, input.document);
    assertExecutionVersionTransition(predecessor, input.document);
    const revision: ModelReleaseRevision = Object.freeze({
      createdAt: new Date().toISOString(),
      document: structuredClone(input.document),
      hash: nextHash,
      modelId: input.document.modelId,
      predecessorRevisionId: predecessor.revisionId,
      revisionId: randomUUID(),
      revisionNumber: predecessor.revisionNumber + 1,
      validation: structuredClone(validation),
    });
    onActivate?.(revision);
    recordAudit(store, actorUserId, "model_contract.publish", null, {
      modelId: revision.modelId,
      releasePolicyUpgrade: true,
      revision,
    });
    return Object.freeze({ changed: true as const, revision });
  };
  return store.isTransaction
    ? operation()
    : inImmediateTransaction(store, operation);
}

export function rollbackModelContract(
  store: DatabaseSync,
  actorUserId: string,
  modelId: string,
  targetRevisionId: string,
  onActivate?: (revision: ModelReleaseRevision) => void,
) {
  return inImmediateTransaction(store, () => {
    const state = stateFromEvents(store, validModelId(modelId));
    const target = state.history.find((item) => item.revisionId === targetRevisionId);
    const predecessor = state.history.at(-1);
    if (!target || !predecessor) throw new Error("回滚目标不存在");
    assertModelReleaseRevisionIntegrity(target);
    assertCurrentModelReleasePolicy(target.document);
    const revision: ModelReleaseRevision = Object.freeze({
      ...structuredClone(target),
      createdAt: new Date().toISOString(),
      predecessorRevisionId: predecessor.revisionId,
      revisionId: randomUUID(),
      revisionNumber: predecessor.revisionNumber + 1,
    });
    onActivate?.(revision);
    recordAudit(store, actorUserId, "model_contract.rollback", null, {
      modelId,
      revision,
      rolledBackToRevisionId: targetRevisionId,
    });
    return revision;
  });
}

export function setModelContractRevoked(
  store: DatabaseSync,
  actorUserId: string,
  modelId: string,
  revoked: boolean,
) {
  validModelId(modelId);
  return inImmediateTransaction(store, () => {
    const state = stateFromEvents(store, modelId);
    if (!state.history.length) throw new Error("模型尚无已发布合同");
    recordAudit(
      store,
      actorUserId,
      revoked ? "model_contract.revoke" : "model_contract.restore",
      null,
      { modelId, revisionId: state.history.at(-1)!.revisionId },
    );
    return modelContractState(store, modelId);
  });
}
