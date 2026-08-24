import { randomUUID } from "node:crypto";
import type { ProviderReferenceStore } from "./providerReferenceStore";
import {
  SeedanceTrustedAssetApplicationError,
  type SeedanceTrustedAssetApplication,
} from "./seedanceTrustedAssetApplicationApi";
import type {
  SeedanceProviderIdentity,
  SeedanceTrustedAssetPort,
} from "./seedanceTrustedAssetPort";
import {
  SeedanceTrustedAssetProviderError,
  seedanceProviderFailureStatus,
} from "./seedanceTrustedAssetPort";
import {
  seedanceControlIdempotencyKey,
  type SeedanceAssetBindingRecord,
  type SeedanceAuthorizationSessionRecord,
  type SeedanceIdentityGroupRecord,
} from "./seedanceTrustedAssetStore";

type TrustedAssetStore = Readonly<{
  bindingById(ownerId: string, id: string): SeedanceAssetBindingRecord | undefined;
  bindingForGroup(input: Readonly<{
    groupId: string;
    identity: SeedanceProviderIdentity;
    ownerId: string;
  }>): SeedanceAssetBindingRecord | undefined;
  bindingForSource(input: Readonly<{
    identity: SeedanceProviderIdentity;
    ownerId: string;
    sourceAssetId: string;
  }>): SeedanceAssetBindingRecord | undefined;
  groupById(ownerId: string, id: string): SeedanceIdentityGroupRecord | undefined;
  groupByIdempotencyKey(input: Readonly<{
    identity: SeedanceProviderIdentity;
    key: string;
    ownerId: string;
  }>): SeedanceIdentityGroupRecord | undefined;
  sessionById(ownerId: string, id: string): SeedanceAuthorizationSessionRecord | undefined;
  sessionByIdempotencyKey(input: Readonly<{
    identity: SeedanceProviderIdentity;
    key: string;
    ownerId: string;
  }>): SeedanceAuthorizationSessionRecord | undefined;
  upsertBinding(record: SeedanceAssetBindingRecord): SeedanceAssetBindingRecord;
  upsertGroup(record: SeedanceIdentityGroupRecord): SeedanceIdentityGroupRecord;
  upsertSession(record: SeedanceAuthorizationSessionRecord): SeedanceAuthorizationSessionRecord;
}>;

type TrustedAssetSource = Readonly<{
  checksumSha256: string;
  contentType: string;
  storageStatus: "failed" | "pending" | "ready";
}>;

export type SeedanceTrustedAssetContext = Readonly<{
  identity: SeedanceProviderIdentity;
  port: SeedanceTrustedAssetPort;
}>;

export type SeedanceTrustedAssetApplicationOptions = Readonly<{
  context(ownerId: string): Promise<SeedanceTrustedAssetContext | undefined>;
  media(ownerId: string, assetId: string): TrustedAssetSource | undefined;
  now?: () => Date;
  providerReferences: ProviderReferenceStore;
  store: TrustedAssetStore;
}>;

function fail(
  code: ConstructorParameters<typeof SeedanceTrustedAssetApplicationError>[0],
  message: string,
): never {
  throw new SeedanceTrustedAssetApplicationError(code, message);
}

function sameIdentity(
  left: SeedanceProviderIdentity,
  right: SeedanceProviderIdentity,
) {
  return left.profileId === right.profileId &&
    left.accountFingerprint === right.accountFingerprint &&
    left.region === right.region && left.project === right.project;
}

function sourceFor(
  options: SeedanceTrustedAssetApplicationOptions,
  ownerId: string,
  assetId: string,
) {
  const media = options.media(ownerId, assetId);
  if (
    !media || media.storageStatus !== "ready" ||
    !/^image\//i.test(media.contentType) ||
    media.contentType.toLowerCase() === "image/svg+xml" ||
    !/^[a-f0-9]{64}$/.test(media.checksumSha256)
  ) fail("SOURCE_NOT_FOUND", "图片素材不存在、未就绪或不属于当前账号");
  return media;
}

function sessionView(record: SeedanceAuthorizationSessionRecord) {
  return Object.freeze({
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    id: record.id,
    status: record.status,
    updatedAt: record.updatedAt,
  });
}

function bindingView(record: SeedanceAssetBindingRecord) {
  return Object.freeze({
    checkedAt: record.checkedAt,
    createdAt: record.createdAt,
    failure: record.failureCode && record.failureMessage
      ? Object.freeze({ code: record.failureCode, message: record.failureMessage })
      : null,
    id: record.id,
    source: Object.freeze({
      assetId: record.sourceAssetId,
      checksumSha256: record.sourceChecksumSha256,
      kind: "image" as const,
    }),
    status: record.status,
    updatedAt: record.updatedAt,
  });
}

async function requiredContext(
  options: SeedanceTrustedAssetApplicationOptions,
  ownerId: string,
) {
  const context = await options.context(ownerId);
  if (!context) fail("CAPABILITY_UNAVAILABLE", "当前方舟可信素材能力不可用");
  return context;
}

export function createSeedanceTrustedAssetApplication(
  options: SeedanceTrustedAssetApplicationOptions,
): SeedanceTrustedAssetApplication {
  const now = () => (options.now ?? (() => new Date()))().toISOString();

  const createAsset = async (input: Readonly<{
    binding: SeedanceAssetBindingRecord;
    context: SeedanceTrustedAssetContext;
    group: SeedanceIdentityGroupRecord;
    media: TrustedAssetSource;
  }>) => {
    if (!input.group.providerGroupId) {
      fail("CONFLICT", "真人授权尚未返回可用的方舟分组");
    }
    if (input.binding.providerAssetId) return input.binding;
    if (input.binding.status === "PENDING_ACCEPTANCE") {
      fail("CONFLICT", "方舟素材创建结果尚待人工核对，系统不会重复提交");
    }
    const startedAt = now();
    const started = options.store.upsertBinding({
      ...input.binding,
      failureCode: null,
      failureMessage: null,
      status: "PENDING_ACCEPTANCE",
      updatedAt: startedAt,
    });
    let lease;
    try {
      lease = await options.providerReferences.acquire({
        assetId: started.sourceAssetId,
        kind: "image",
        maximumBytes: 20 * 1024 * 1024,
        ownerId: started.ownerId,
        preferredTransports: ["signed-url"],
      });
      if (lease.checksumSha256 !== started.sourceChecksumSha256 ||
          lease.locator.transport !== "signed-url") {
        fail("CONFLICT", "图片已变化或暂时无法安全交给方舟");
      }
      const created = await input.context.port.createAsset({
        idempotencyKey: started.idempotencyKey,
        identity: input.context.identity,
        providerGroupId: input.group.providerGroupId,
        source: {
          assetId: started.sourceAssetId,
          checksumSha256: started.sourceChecksumSha256,
          contentType: input.media.contentType,
          kind: "image",
          providerUrl: lease.locator.url,
        },
      });
      return options.store.upsertBinding({
        ...started,
        checkedAt: created.checkedAt,
        providerAssetId: created.providerAssetId,
        providerAssetType: created.providerAssetType,
        providerStatus: created.providerStatus,
        status: created.status,
        updatedAt: now(),
      });
    } catch (error) {
      if (error instanceof SeedanceTrustedAssetApplicationError) throw error;
      options.store.upsertBinding({
        ...started,
        failureCode: error instanceof SeedanceTrustedAssetProviderError
          ? `PROVIDER_${error.code}`
          : "PROVIDER_CREATE_FAILED",
        failureMessage: "方舟素材创建未完成，请核对状态后再处理",
        providerStatus: seedanceProviderFailureStatus(
          "CREATE_ASSET_FAILED",
          error,
        ),
        status: "FAILED",
        updatedAt: now(),
      });
      fail("CAPABILITY_UNAVAILABLE", "方舟素材创建未完成，请稍后核对");
    } finally {
      if (lease) await options.providerReferences.release(lease).catch(() => undefined);
    }
  };

  const inspectRemoteAsset = async (input: Readonly<{
    binding: SeedanceAssetBindingRecord;
    context: SeedanceTrustedAssetContext;
  }>) => {
    if (!input.binding.providerAssetId ||
        !["ACTIVE", "ASSET_PROCESSING", "LINKED_UNVERIFIED"].includes(
          input.binding.status,
        )) {
      return input.binding;
    }
    let inspected;
    try {
      inspected = await input.context.port.inspectAsset({
        identity: input.context.identity,
        providerAssetId: input.binding.providerAssetId,
      });
    } catch (error) {
      options.store.upsertBinding({
        ...input.binding,
        failureCode: error instanceof SeedanceTrustedAssetProviderError
          ? `PROVIDER_${error.code}`
          : "PROVIDER_INSPECT_FAILED",
        failureMessage: "方舟素材状态查询未完成，请稍后重试",
        providerStatus: seedanceProviderFailureStatus(
          "INSPECT_ASSET_FAILED",
          error,
        ),
        updatedAt: now(),
      });
      fail("CAPABILITY_UNAVAILABLE", "方舟素材状态查询未完成，请稍后重试");
    }
    return options.store.upsertBinding({
      ...input.binding,
      checkedAt: inspected.checkedAt,
      failureCode: null,
      failureMessage: null,
      providerAssetType: inspected.providerAssetType,
      providerStatus: inspected.providerStatus,
      status: inspected.status,
      updatedAt: now(),
    });
  };

  return Object.freeze({
    async capability(ownerId) {
      const context = await requiredContext(options, ownerId);
      return context.port.capability(context.identity);
    },
    async createAuthorizationSession({ assetId, ownerId }) {
      const media = sourceFor(options, ownerId, assetId);
      const context = await requiredContext(options, ownerId);
      const timestamp = now();
      const groupKey = seedanceControlIdempotencyKey({
        identity: context.identity,
        operation: "group",
        ownerId,
      });
      let group = options.store.groupByIdempotencyKey({
        identity: context.identity,
        key: groupKey,
        ownerId,
      });
      if (!group) {
        group = options.store.upsertGroup({
          ...context.identity,
          acceptedAt: null,
          authorizationStatus: "NOT_STARTED",
          createdAt: timestamp,
          expiresAt: null,
          id: randomUUID(),
          idempotencyKey: groupKey,
          ownerId,
          providerGroupId: null,
          providerStatus: null,
          revokedAt: null,
          updatedAt: timestamp,
        });
      }
      const source = {
        assetId,
        checksumSha256: media.checksumSha256,
        kind: "image" as const,
      };
      const bindingKey = seedanceControlIdempotencyKey({
        identity: context.identity,
        operation: "asset",
        ownerId,
        source,
      });
      let binding = options.store.bindingForSource({
        identity: context.identity,
        ownerId,
        sourceAssetId: assetId,
      });
      if (!binding || binding.sourceChecksumSha256 !== media.checksumSha256) {
        binding = options.store.upsertBinding({
          ...context.identity,
          checkedAt: null,
          createdAt: timestamp,
          failureCode: null,
          failureMessage: null,
          groupId: group.id,
          id: randomUUID(),
          idempotencyKey: bindingKey,
          ownerId,
          providerAssetId: null,
          providerAssetType: null,
          providerStatus: null,
          sourceAssetId: assetId,
          sourceChecksumSha256: media.checksumSha256,
          sourceKind: "image",
          status: "NOT_STARTED",
          updatedAt: timestamp,
        });
      }
      const sessionKey = seedanceControlIdempotencyKey({
        identity: context.identity,
        operation: "session",
        ownerId,
        source,
      });
      const existing = options.store.sessionByIdempotencyKey({
        identity: context.identity,
        key: sessionKey,
        ownerId,
      });
      if (existing) return sessionView(existing);
      const session: SeedanceAuthorizationSessionRecord = {
        ...context.identity,
        createdAt: timestamp,
        expiresAt: null,
        groupId: group.id,
        id: randomUUID(),
        idempotencyKey: sessionKey,
        ownerId,
        providerSessionId: null,
        providerStatus: null,
        status: "SESSION_PENDING",
        updatedAt: timestamp,
      };
      options.store.upsertSession(session);
      if (group.authorizationStatus === "AUTHORIZATION_COMPLETED" &&
          group.providerGroupId) {
        binding = await createAsset({ binding, context, group, media });
        const completed = options.store.upsertSession({
          ...session,
          status: binding.status,
          updatedAt: now(),
        });
        return sessionView(completed);
      }
      try {
        const created = await context.port.createAuthorizationSession({
          idempotencyKey: sessionKey,
          identity: context.identity,
          providerGroupId: group.providerGroupId,
        });
        group = options.store.upsertGroup({
          ...group,
          authorizationStatus: created.status,
          providerGroupId: created.providerGroupId ?? group.providerGroupId,
          providerStatus: created.providerStatus,
          updatedAt: now(),
        });
        const saved = options.store.upsertSession({
          ...session,
          expiresAt: created.expiresAt,
          providerSessionId: created.providerSessionId,
          providerStatus: created.providerStatus,
          status: created.status,
          updatedAt: now(),
        });
        return Object.freeze({ ...sessionView(saved), authorizationUrl: created.authorizationUrl });
      } catch (error) {
        options.store.upsertSession({
          ...session,
          providerStatus: seedanceProviderFailureStatus(
            "CREATE_SESSION_FAILED",
            error,
          ),
          status: "FAILED",
          updatedAt: now(),
        });
        fail("CAPABILITY_UNAVAILABLE", "方舟真人授权会话创建失败");
      }
    },
    async createTrustedBinding({ assetId, ownerId, providerAssetId }) {
      const media = sourceFor(options, ownerId, assetId);
      const context = await requiredContext(options, ownerId);
      const groupKey = seedanceControlIdempotencyKey({
        identity: context.identity,
        operation: "group",
        ownerId,
      });
      const group = options.store.groupByIdempotencyKey({
        identity: context.identity,
        key: groupKey,
        ownerId,
      });
      if (!group) fail("CONFLICT", "当前账号尚无可复用的真人授权组");
      const timestamp = now();
      const source = { assetId, checksumSha256: media.checksumSha256, kind: "image" as const };
      const existing = options.store.bindingForSource({
        identity: context.identity,
        ownerId,
        sourceAssetId: assetId,
      });
      const pending = options.store.upsertBinding({
        ...context.identity,
        checkedAt: null,
        createdAt: existing?.createdAt ?? timestamp,
        failureCode: null,
        failureMessage: null,
        groupId: group.id,
        id: existing?.id ?? randomUUID(),
        idempotencyKey: seedanceControlIdempotencyKey({
          identity: context.identity,
          operation: "asset",
          ownerId,
          source,
        }),
        ownerId,
        providerAssetId,
        providerAssetType: null,
        providerStatus: null,
        sourceAssetId: assetId,
        sourceChecksumSha256: media.checksumSha256,
        sourceKind: "image",
        status: "LINKED_UNVERIFIED",
        updatedAt: timestamp,
      });
      let inspected;
      try {
        inspected = await context.port.inspectAsset({
          identity: context.identity,
          providerAssetId,
        });
      } catch (error) {
        return bindingView(options.store.upsertBinding({
          ...pending,
          failureCode: error instanceof SeedanceTrustedAssetProviderError
            ? `PROVIDER_${error.code}`
            : "PROVIDER_INSPECT_FAILED",
          failureMessage: "方舟素材状态查询未完成，请稍后重试",
          providerStatus: seedanceProviderFailureStatus(
            "INSPECT_ASSET_FAILED",
            error,
          ),
          updatedAt: now(),
        }));
      }
      return bindingView(options.store.upsertBinding({
        ...pending,
        checkedAt: inspected.checkedAt,
        providerAssetType: inspected.providerAssetType,
        providerStatus: inspected.providerStatus,
        status: inspected.status,
        updatedAt: now(),
      }));
    },
    async readAuthorizationSession({ ownerId, sessionId }) {
      const existing = options.store.sessionById(ownerId, sessionId);
      if (!existing) return undefined;
      const context = await requiredContext(options, ownerId);
      if (!sameIdentity(existing, context.identity)) {
        fail("CONFLICT", "方舟账号身份已变化，不能复用旧授权会话");
      }
      let saved = existing;
      if (saved.providerSessionId &&
          ["SESSION_PENDING", "WAITING_AUTHORIZATION"].includes(saved.status)) {
        let inspected;
        try {
          inspected = await context.port.inspectAuthorizationSession({
            identity: context.identity,
            providerSessionId: saved.providerSessionId,
          });
        } catch (error) {
          options.store.upsertSession({
            ...saved,
            providerStatus: seedanceProviderFailureStatus(
              "INSPECT_SESSION_FAILED",
              error,
            ),
            updatedAt: now(),
          });
          fail("CAPABILITY_UNAVAILABLE", "方舟真人授权状态查询失败");
        }
        saved = options.store.upsertSession({
          ...saved,
          expiresAt: inspected.expiresAt,
          providerStatus: inspected.providerStatus,
          status: inspected.status,
          updatedAt: now(),
        });
        const group = saved.groupId
          ? options.store.groupById(ownerId, saved.groupId)
          : undefined;
        if (group && inspected.status === "AUTHORIZATION_COMPLETED" &&
            inspected.providerGroupId) {
          const authorizedGroup = options.store.upsertGroup({
            ...group,
            acceptedAt: now(),
            authorizationStatus: inspected.status,
            expiresAt: inspected.expiresAt,
            providerGroupId: inspected.providerGroupId,
            providerStatus: inspected.providerStatus,
            updatedAt: now(),
          });
          const binding = options.store.bindingForGroup({
            groupId: group.id,
            identity: context.identity,
            ownerId,
          });
          if (binding) {
            const media = sourceFor(options, ownerId, binding.sourceAssetId);
            const created = await createAsset({
              binding,
              context,
              group: authorizedGroup,
              media,
            });
            return sessionView(options.store.upsertSession({
              ...saved,
              status: created.status,
              updatedAt: now(),
            }));
          }
        }
      }
      if (saved.status === "ASSET_PROCESSING" && saved.groupId) {
        const binding = options.store.bindingForGroup({
          groupId: saved.groupId,
          identity: context.identity,
          ownerId,
        });
        if (binding) {
          const inspected = await inspectRemoteAsset({ binding, context });
          saved = options.store.upsertSession({
            ...saved,
            status: inspected.status,
            updatedAt: now(),
          });
        }
      }
      return sessionView(saved);
    },
    async readTrustedBinding({ assetId, ownerId }) {
      const media = sourceFor(options, ownerId, assetId);
      const context = await requiredContext(options, ownerId);
      const binding = options.store.bindingForSource({
        identity: context.identity,
        ownerId,
        sourceAssetId: assetId,
      });
      if (!binding) return undefined;
      if (binding.sourceChecksumSha256 !== media.checksumSha256) {
        return bindingView(options.store.upsertBinding({
          ...binding,
          failureCode: "SOURCE_CHECKSUM_CHANGED",
          failureMessage: "图片内容已变化，需要重新处理可信素材",
          status: "STALE_SOURCE",
          updatedAt: now(),
        }));
      }
      return bindingView(await inspectRemoteAsset({ binding, context }));
    },
  });
}
