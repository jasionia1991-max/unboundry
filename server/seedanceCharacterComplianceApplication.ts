import { createHash, randomUUID } from "node:crypto";
import type {
  SeedanceCharacterComplianceCapability,
  SeedanceCharacterComplianceCheckView,
  SeedanceCharacterComplianceState,
} from "../types/seedanceCharacterCompliance";
import type {
  SeedanceCharacterCompliancePort,
  SeedanceCharacterComplianceProviderIdentity,
  SeedanceCharacterComplianceProviderResult,
} from "./seedanceCharacterCompliancePort";
import { SeedanceCharacterComplianceProviderError } from
  "./seedanceCharacterCompliancePort";
import type {
  SeedanceCharacterComplianceAttemptRecord,
  SeedanceCharacterComplianceCheckRecord,
} from "./seedanceCharacterComplianceStore";
import type { createSeedanceCharacterComplianceStore } from
  "./seedanceCharacterComplianceStore";

type Store = ReturnType<typeof createSeedanceCharacterComplianceStore>;

export type SeedanceCharacterComplianceContext = Readonly<{
  identity: SeedanceCharacterComplianceProviderIdentity;
  port: SeedanceCharacterCompliancePort;
}>;

export type SeedanceCharacterComplianceApplication = Readonly<{
  cancelCheck(input: Readonly<{ checkId: string; ownerId: string }>):
    Promise<SeedanceCharacterComplianceCheckView>;
  capability(ownerId: string): Promise<SeedanceCharacterComplianceCapability>;
  createCheck(input: Readonly<{
    assetId: string;
    disclosureAccepted: boolean;
    disclosureVersion: string;
    modelConfigurationRevision: string;
    modelId: string;
    ownerId: string;
  }>): Promise<SeedanceCharacterComplianceCheckView>;
  currentForSource(input: Readonly<{ assetId: string; ownerId: string }>):
    Promise<SeedanceCharacterComplianceCheckView | undefined>;
  readCheck(input: Readonly<{ checkId: string; ownerId: string }>):
    Promise<SeedanceCharacterComplianceCheckView | undefined>;
  retryCheck(input: Readonly<{ checkId: string; ownerId: string }> ):
    Promise<SeedanceCharacterComplianceCheckView>;
}>;

export class SeedanceCharacterComplianceApplicationError extends Error {
  constructor(
    readonly code: "CAPABILITY_UNAVAILABLE" | "CHECK_NOT_FOUND" |
      "CONFLICT" | "DISCLOSURE_REQUIRED" | "SOURCE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "SeedanceCharacterComplianceApplicationError";
  }
}

type Options = Readonly<{
  context(ownerId: string): Promise<SeedanceCharacterComplianceContext | undefined>;
  media(ownerId: string, assetId: string): Readonly<{
    checksumSha256: string;
    contentType: string;
    storageStatus: "failed" | "pending" | "ready";
  }> | undefined;
  model(ownerId: string, modelId: string): Readonly<{
    configurationRevision: string;
  }> | undefined;
  now?: () => Date;
  store: Store;
}>;

const closedCapability = Object.freeze({
  available: false,
  branch: "C" as const,
  canCreateChecks: false,
  formalSeedanceTicketAccepted: false,
  productName: "角色风险预检" as const,
  providerDisplayName: null,
  reason: "没有同时满足用途、数据处理与风险分类合同的正式审核 Provider，入口已关闭",
  reasonCode: "NO_COMPLIANT_PROVIDER" as const,
});

function fail(
  code: ConstructorParameters<typeof SeedanceCharacterComplianceApplicationError>[0],
  message: string,
): never {
  throw new SeedanceCharacterComplianceApplicationError(code, message);
}

function identifier(value: string, label: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(normalized)) {
    fail("CONFLICT", `${label}无效`);
  }
  return normalized;
}

function revisionIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized)) {
    fail("CONFLICT", `${label}无效`);
  }
  return normalized;
}

function sourceFor(options: Options, ownerId: string, assetId: string) {
  const source = options.media(ownerId, assetId);
  if (
    !source || source.storageStatus !== "ready" ||
    !/^image\/(?:png|jpeg|webp)$/i.test(source.contentType) ||
    !/^[a-f0-9]{64}$/.test(source.checksumSha256)
  ) fail("SOURCE_NOT_FOUND", "图片素材不存在、未就绪或不属于当前账号");
  return source;
}

function idempotencyKey(input: Readonly<{
  disclosureVersion: string;
  identity: SeedanceCharacterComplianceProviderIdentity;
  modelConfigurationRevision: string;
  modelId: string;
  ownerId: string;
  sourceAssetId: string;
  sourceChecksumSha256: string;
}>) {
  return createHash("sha256").update(JSON.stringify({
    ...input,
    scope: "unboundry-seedance-character-compliance-v1",
  })).digest("hex");
}

function view(record: SeedanceCharacterComplianceCheckRecord):
  SeedanceCharacterComplianceCheckView {
  return Object.freeze({
    branch: record.branch,
    checkedAt: record.checkedAt,
    createdAt: record.createdAt,
    disclosureVersion: record.disclosureId.split(":").at(-1) ?? "unknown",
    expiresAt: record.expiresAt,
    id: record.id,
    providerDisplayName: record.providerDisplayName,
    riskCodes: Object.freeze([...record.riskCodes]),
    source: Object.freeze({
      assetId: record.sourceAssetId,
      checksumSha256: record.sourceChecksumSha256,
      kind: "image" as const,
      modelConfigurationRevision: record.modelConfigurationRevision,
      modelId: record.modelId,
    }),
    state: record.state,
    updatedAt: record.updatedAt,
  });
}

function providerFailureState(error: unknown): SeedanceCharacterComplianceState {
  return error instanceof SeedanceCharacterComplianceProviderError &&
    error.retryable && error.admission === "definitive-not-accepted"
    ? "FAILED_RETRYABLE"
    : "FAILED_TERMINAL";
}

function identityMatches(
  record: SeedanceCharacterComplianceCheckRecord,
  identity: SeedanceCharacterComplianceProviderIdentity,
) {
  return record.providerProfileId === identity.profileId &&
    record.providerRegion === identity.region &&
    record.providerAccountFingerprint === identity.accountFingerprint &&
    record.providerConfigurationVersion === identity.configurationVersion &&
    record.providerCredentialVersion === identity.credentialVersion &&
    record.policyRevision === identity.policyRevision;
}

function attempt(
  record: SeedanceCharacterComplianceCheckRecord,
  operation: SeedanceCharacterComplianceAttemptRecord["operation"],
  attemptNumber: number,
  outcome: SeedanceCharacterComplianceAttemptRecord["outcome"],
  timestamp: string,
): SeedanceCharacterComplianceAttemptRecord {
  return Object.freeze({
    attemptNumber,
    checkId: record.id,
    createdAt: timestamp,
    diagnostic: Object.freeze({
      httpStatus: null,
      providerCode: null,
      requestId: null,
    }),
    failureCode: null,
    id: `${record.id}:${operation}:${attemptNumber}`,
    operation,
    outcome,
    ownerId: record.ownerId,
    providerStatus: null,
    state: record.state,
    updatedAt: timestamp,
  });
}

function withProviderResult(
  record: SeedanceCharacterComplianceCheckRecord,
  result: SeedanceCharacterComplianceProviderResult,
  timestamp: string,
) {
  return Object.freeze({
    ...record,
    checkedAt: result.checkedAt,
    expiresAt: result.expiresAt,
    failureCode: null,
    providerCheckId: result.providerCheckId,
    providerStatus: result.providerStatus,
    riskCodes: Object.freeze([...result.riskCodes]),
    state: result.state,
    updatedAt: timestamp,
  });
}

export function createSeedanceCharacterComplianceApplication(
  options: Options,
): SeedanceCharacterComplianceApplication {
  const now = () => (options.now ?? (() => new Date()))().toISOString();

  const reconcileIdentity = async (
    record: SeedanceCharacterComplianceCheckRecord,
  ) => {
    const source = options.media(record.ownerId, record.sourceAssetId);
    if (!source || source.checksumSha256 !== record.sourceChecksumSha256) {
      return options.store.saveCheck({
        ...record,
        failureCode: "SOURCE_CHANGED",
        state: "STALE_SOURCE",
        updatedAt: now(),
      });
    }
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(now())) {
      return options.store.saveCheck({
        ...record,
        failureCode: "CHECK_EXPIRED",
        state: "EXPIRED",
        updatedAt: now(),
      });
    }
    const model = options.model(record.ownerId, record.modelId);
    const context = await options.context(record.ownerId);
    if (!model || model.configurationRevision !== record.modelConfigurationRevision) {
      return options.store.saveCheck({
        ...record,
        failureCode: "MODEL_CONFIGURATION_CHANGED",
        state: "EXPIRED",
        updatedAt: now(),
      });
    }
    if (!context || !identityMatches(record, context.identity)) {
      return options.store.saveCheck({
        ...record,
        failureCode: "PROVIDER_IDENTITY_CHANGED",
        state: "FAILED_TERMINAL",
        updatedAt: now(),
      });
    }
    return record;
  };

  const inspectIfPending = async (
    record: SeedanceCharacterComplianceCheckRecord,
  ) => {
    if (!["QUEUED", "CHECKING"].includes(record.state)) {
      return record;
    }
    if (!record.providerCheckId) {
      const latestCreate = options.store.latestAttempt(
        record.ownerId,
        record.id,
        "create",
      );
      if (latestCreate?.outcome === "outcome-unknown" ||
          latestCreate?.outcome === "admission-pending") {
        return options.store.saveCheck({
          ...record,
          failureCode: "PROVIDER_OUTCOME_UNKNOWN_NO_AUTORETRY",
          state: "FAILED_TERMINAL",
          updatedAt: now(),
        });
      }
      return record;
    }
    const context = await options.context(record.ownerId);
    if (!context || !identityMatches(record, context.identity)) {
      return options.store.saveCheck({
        ...record,
        failureCode: "PROVIDER_IDENTITY_CHANGED",
        state: "FAILED_TERMINAL",
        updatedAt: now(),
      });
    }
    const timestamp = now();
    const attemptNumber = options.store.nextAttemptNumber(record.ownerId, record.id);
    const pendingAttempt = options.store.saveAttempt(attempt(
      { ...record, state: "CHECKING" }, "inspect", attemptNumber,
      "outcome-unknown", timestamp,
    ));
    try {
      const result = await context.port.inspect({
        identity: context.identity,
        providerCheckId: record.providerCheckId,
      });
      const saved = options.store.saveCheck(withProviderResult(record, result, now()));
      options.store.saveAttempt({
        ...pendingAttempt,
        outcome: "response-received",
        providerStatus: result.providerStatus,
        state: result.state,
        updatedAt: now(),
      });
      return saved;
    } catch (error) {
      const state = providerFailureState(error);
      options.store.saveAttempt({
        ...pendingAttempt,
        diagnostic: error instanceof SeedanceCharacterComplianceProviderError
          ? error.diagnostic
          : pendingAttempt.diagnostic,
        failureCode: error instanceof SeedanceCharacterComplianceProviderError
          ? `PROVIDER_${error.code}` : "PROVIDER_INSPECT_FAILED",
        outcome: error instanceof SeedanceCharacterComplianceProviderError &&
          error.admission === "definitive-not-accepted"
          ? "provider-failed" : "outcome-unknown",
        state,
        updatedAt: now(),
      });
      return options.store.saveCheck({
        ...record,
        failureCode: "PROVIDER_INSPECT_FAILED",
        state,
        updatedAt: now(),
      });
    }
  };

  const reconcileOutcomeUnknown = async (
    record: SeedanceCharacterComplianceCheckRecord,
  ) => {
    if (!["QUEUED", "CHECKING", "FAILED_TERMINAL"].includes(record.state)) {
      return record;
    }
    const latestCreate = options.store.latestAttempt(
      record.ownerId,
      record.id,
      "create",
    );
    if (!latestCreate || !["admission-pending", "outcome-unknown"].includes(
      latestCreate.outcome,
    )) return record;
    const context = await options.context(record.ownerId);
    if (!context || !identityMatches(record, context.identity)) return record;
    const result = await context.port.reconcile({
      idempotencyKey: record.idempotencyKey,
      identity: context.identity,
    }).catch(() => undefined);
    if (!result) return record;
    const saved = options.store.saveCheck(withProviderResult(record, result, now()));
    options.store.saveAttempt({
      ...latestCreate,
      outcome: "response-received",
      providerStatus: result.providerStatus,
      state: result.state,
      updatedAt: now(),
    });
    return saved;
  };

  const read = async (record: SeedanceCharacterComplianceCheckRecord) =>
    inspectIfPending(await reconcileOutcomeUnknown(await reconcileIdentity(record)));

  const submitCreate = async (
    record: SeedanceCharacterComplianceCheckRecord,
    context: SeedanceCharacterComplianceContext,
    claimedAttempt?: SeedanceCharacterComplianceAttemptRecord,
  ) => {
    const source = sourceFor(options, record.ownerId, record.sourceAssetId);
    const createAttempt = claimedAttempt
      ? options.store.saveAttempt({ ...claimedAttempt, outcome: "outcome-unknown" })
      : options.store.saveAttempt(attempt(
          record,
          "create",
          options.store.nextAttemptNumber(record.ownerId, record.id),
          "outcome-unknown",
          now(),
        ));
    const submittedRecord = claimedAttempt
      ? options.store.saveCheck({
          ...record,
          failureCode: null,
          state: "QUEUED",
          updatedAt: createAttempt.updatedAt,
        })
      : record;
    try {
      const result = await context.port.create({
        idempotencyKey: record.idempotencyKey,
        identity: context.identity,
        source: {
          assetId: record.sourceAssetId,
          checksumSha256: source.checksumSha256,
          contentType: source.contentType,
          kind: "image",
          modelConfigurationRevision: record.modelConfigurationRevision,
          modelId: record.modelId,
        },
      });
      const saved = options.store.saveCheck(withProviderResult(
        submittedRecord,
        result,
        now(),
      ));
      options.store.saveAttempt({
        ...createAttempt,
        outcome: "response-received",
        providerStatus: result.providerStatus,
        state: result.state,
        updatedAt: now(),
      });
      return saved;
    } catch (error) {
      const state = providerFailureState(error);
      const saved = options.store.saveCheck({
        ...submittedRecord,
        failureCode: error instanceof SeedanceCharacterComplianceProviderError
          ? `PROVIDER_${error.code}` : "PROVIDER_CREATE_OUTCOME_UNKNOWN",
        state,
        updatedAt: now(),
      });
      options.store.saveAttempt({
        ...createAttempt,
        diagnostic: error instanceof SeedanceCharacterComplianceProviderError
          ? error.diagnostic : createAttempt.diagnostic,
        failureCode: saved.failureCode,
        outcome: error instanceof SeedanceCharacterComplianceProviderError &&
          error.admission === "definitive-not-accepted"
          ? "provider-failed" : "outcome-unknown",
        state,
        updatedAt: now(),
      });
      return saved;
    }
  };

  return Object.freeze({
    async capability(ownerId) {
      const context = await options.context(ownerId);
      if (!context) return closedCapability;
      try {
        const capability = await context.port.capability(context.identity);
        return capability.available && capability.canCreateChecks
          ? capability
          : Object.freeze({
              ...closedCapability,
              reason: capability.reason,
              reasonCode: "PROVIDER_CONFIGURATION_UNAVAILABLE" as const,
            });
      } catch {
        return Object.freeze({
          ...closedCapability,
          reason: "角色风险预检 Provider 配置当前不可用，入口已关闭",
          reasonCode: "PROVIDER_CONFIGURATION_UNAVAILABLE" as const,
        });
      }
    },
    async createCheck(input) {
      if (!input.disclosureAccepted) {
        fail("DISCLOSURE_REQUIRED", "提交前必须确认角色风险预检的数据处理说明");
      }
      const assetId = identifier(input.assetId, "图片素材");
      const modelId = identifier(input.modelId, "模型");
      const submittedModelConfigurationRevision = identifier(
        input.modelConfigurationRevision,
        "模型配置版本",
      );
      const disclosureVersion = revisionIdentifier(
        input.disclosureVersion,
        "披露版本",
      );
      const source = sourceFor(options, input.ownerId, assetId);
      const model = options.model(input.ownerId, modelId);
      if (!model || model.configurationRevision !== submittedModelConfigurationRevision) {
        fail("CONFLICT", "模型配置已变化，请刷新后重新提交");
      }
      const modelConfigurationRevision = model.configurationRevision;
      const context = await options.context(input.ownerId);
      if (!context) fail("CAPABILITY_UNAVAILABLE", closedCapability.reason);
      const capability = await context.port.capability(context.identity)
        .catch(() => undefined);
      if (!capability?.available || !capability.canCreateChecks) {
        fail("CAPABILITY_UNAVAILABLE", "角色风险预检当前不可用，未发送图片");
      }
      const key = idempotencyKey({
        disclosureVersion,
        identity: context.identity,
        modelConfigurationRevision,
        modelId,
        ownerId: input.ownerId,
        sourceAssetId: assetId,
        sourceChecksumSha256: source.checksumSha256,
      });
      const existing = options.store.checkByIdempotency(input.ownerId, key);
      if (existing) return view(await read(existing));
      const timestamp = now();
      const disclosure = options.store.saveDisclosure({
        acceptedAt: timestamp,
        assetId,
        createdAt: timestamp,
        expiresAt: null,
        id: `${randomUUID()}:${disclosureVersion}`,
        ownerId: input.ownerId,
        revokedAt: null,
        version: disclosureVersion,
      });
      let record = options.store.saveCheck({
        branch: capability.branch,
        checkedAt: null,
        createdAt: timestamp,
        disclosureId: disclosure.id,
        expiresAt: null,
        failureCode: null,
        id: randomUUID(),
        idempotencyKey: key,
        modelConfigurationRevision,
        modelId,
        ownerId: input.ownerId,
        policyRevision: context.identity.policyRevision,
        providerAccountFingerprint: context.identity.accountFingerprint,
        providerCheckId: null,
        providerConfigurationVersion: context.identity.configurationVersion,
        providerCredentialVersion: context.identity.credentialVersion,
        providerDisplayName: capability.providerDisplayName,
        providerProfileId: context.identity.profileId,
        providerRegion: context.identity.region,
        providerStatus: null,
        riskCodes: [],
        sourceAssetId: assetId,
        sourceChecksumSha256: source.checksumSha256,
        state: "QUEUED",
        updatedAt: timestamp,
      });
      record = await submitCreate(record, context);
      return view(record);
    },
    async readCheck({ checkId, ownerId }) {
      const record = options.store.checkById(ownerId, checkId);
      return record ? view(await read(record)) : undefined;
    },
    async currentForSource({ assetId, ownerId }) {
      const record = options.store.currentForSource(ownerId, assetId);
      return record ? view(await read(record)) : undefined;
    },
    async retryCheck({ checkId, ownerId }) {
      const record = options.store.checkById(ownerId, checkId);
      if (!record) fail("CHECK_NOT_FOUND", "角色风险预检记录不存在");
      if (record.state !== "FAILED_RETRYABLE") {
        fail("CONFLICT", "只有明确未被 Provider 接收的失败可以重试");
      }
      const reconciled = await reconcileIdentity(record);
      if (reconciled.state !== "FAILED_RETRYABLE") return view(reconciled);
      const context = await options.context(ownerId);
      if (!context || !identityMatches(record, context.identity)) {
        fail("CAPABILITY_UNAVAILABLE", "Provider 身份已变化，不能重试");
      }
      const claimed = options.store.claimRetryAttempt(ownerId, checkId, now());
      if (!claimed) fail("CONFLICT", "无法安全重试该请求");
      return view(await submitCreate(record, context, claimed));
    },
    async cancelCheck({ checkId, ownerId }) {
      const record = options.store.checkById(ownerId, checkId);
      if (!record) fail("CHECK_NOT_FOUND", "角色风险预检记录不存在");
      if (!["QUEUED", "CHECKING", "FAILED_RETRYABLE"].includes(record.state)) {
        fail("CONFLICT", "当前角色风险预检状态不能取消");
      }
      const context = await options.context(ownerId);
      if (!context || !record.providerCheckId) {
        const timestamp = now();
        const saved = options.store.saveCheck({
          ...record,
          failureCode: "CANCELLED_LOCALLY",
          state: "REVOKED",
          updatedAt: timestamp,
        });
        options.store.saveAttempt(attempt(
          saved,
          "cancel",
          options.store.nextAttemptNumber(ownerId, checkId),
          "cancelled",
          timestamp,
        ));
        return view(saved);
      }
      const timestamp = now();
      const pendingAttempt = options.store.saveAttempt(attempt(
        record,
        "cancel",
        options.store.nextAttemptNumber(ownerId, checkId),
        "outcome-unknown",
        timestamp,
      ));
      try {
        const result = await context.port.cancel({
          identity: context.identity,
          providerCheckId: record.providerCheckId,
        });
        const saved = options.store.saveCheck(withProviderResult(record, result, now()));
        options.store.saveAttempt({
          ...pendingAttempt,
          outcome: "cancelled",
          providerStatus: result.providerStatus,
          state: saved.state,
          updatedAt: now(),
        });
        return view(saved);
      } catch (error) {
        options.store.saveAttempt({
          ...pendingAttempt,
          diagnostic: error instanceof SeedanceCharacterComplianceProviderError
            ? error.diagnostic : pendingAttempt.diagnostic,
          failureCode: "PROVIDER_CANCEL_OUTCOME_UNKNOWN",
          outcome: "outcome-unknown",
          state: "FAILED_TERMINAL",
          updatedAt: now(),
        });
        return view(options.store.saveCheck({
          ...record,
          failureCode: "PROVIDER_CANCEL_OUTCOME_UNKNOWN",
          state: "FAILED_TERMINAL",
          updatedAt: now(),
        }));
      }
    },
  });
}
