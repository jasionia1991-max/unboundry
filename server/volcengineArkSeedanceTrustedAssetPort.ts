import { BoundedTokenBuckets } from "./requestAdmission";
import type {
  SeedanceProviderAsset,
  SeedanceProviderIdentity,
  SeedanceTrustedAssetPort,
} from "./seedanceTrustedAssetPort";
import {
  requestVolcengineArkSeedanceAssetControlPlane,
  VOLCENGINE_ARK_CONTROL_PLANE_REGION,
  VolcengineArkControlPlaneError,
  type VolcengineArkControlPlaneCredentials,
  type VolcengineArkSeedanceAssetAction,
} from "./volcengineArkControlPlane";

type JsonObject = Record<string, unknown>;

export type SeedanceTrustedAssetProviderErrorCode =
  | "AUTH"
  | "FORMAT"
  | "IDENTITY_MISMATCH"
  | "NETWORK"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "REMOTE";

export class SeedanceTrustedAssetProviderError extends Error {
  constructor(readonly code: SeedanceTrustedAssetProviderErrorCode) {
    super(
      code === "IDENTITY_MISMATCH"
        ? "方舟可信素材账号身份已变化"
        : code === "RATE_LIMIT"
        ? "方舟可信素材控制面请求过于频繁"
        : code === "FORMAT"
        ? "方舟可信素材响应格式无效"
        : code === "AUTH"
        ? "方舟可信素材控制面凭证无效"
        : code === "PERMISSION"
        ? "方舟可信素材控制面权限不足"
        : code === "NETWORK"
        ? "无法连接方舟可信素材控制面"
        : "方舟可信素材控制面暂时不可用",
    );
    this.name = "SeedanceTrustedAssetProviderError";
  }
}

export type VolcengineArkSeedanceTrustedAssetOptions = Readonly<{
  fetcher?: typeof fetch;
  now?: () => Date;
  nowMilliseconds?: () => number;
  onControlRequest?: (action: VolcengineArkSeedanceAssetAction) => void;
  qpm?: number;
  timeoutMs?: number;
}>;

function fail(code: SeedanceTrustedAssetProviderErrorCode): never {
  throw new SeedanceTrustedAssetProviderError(code);
}

function object(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function valueAt(value: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    if (value[key] !== undefined) return value[key];
  }
  return undefined;
}

function result(body: JsonObject) {
  return object(valueAt(body, "Result", "result")) ?? fail("FORMAT");
}

function requiredProviderId(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9._:-]{1,512}$/.test(value)
  ) fail("FORMAT");
  return value;
}

function optionalProviderText(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 512) fail("FORMAT");
  return value;
}

function httpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 16_384) fail("FORMAT");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("FORMAT");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) fail("FORMAT");
  return parsed.toString();
}

function expiresAt(value: unknown, now: Date) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    fail("FORMAT");
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400) {
    fail("FORMAT");
  }
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function providerErrorCode(body: JsonObject) {
  const metadata = object(valueAt(body, "ResponseMetadata", "response_metadata"));
  const error = object(valueAt(metadata ?? {}, "Error", "error"));
  return optionalProviderText(valueAt(error ?? {}, "Code", "code"));
}

function sameIdentity(
  expected: SeedanceProviderIdentity,
  actual: SeedanceProviderIdentity,
) {
  return expected.accountFingerprint === actual.accountFingerprint &&
    expected.profileId === actual.profileId &&
    expected.project === actual.project &&
    expected.region === actual.region;
}

function mapAssetStatus(value: string | null) {
  const status = value?.toLowerCase().replace(/[\s_-]+/g, "") ?? "";
  if (["active", "available", "ready", "success", "succeeded"].includes(status)) {
    return "ACTIVE" as const;
  }
  if (["processing", "pending", "creating", "submitted"].includes(status)) {
    return "ASSET_PROCESSING" as const;
  }
  if (["consistencyfailed", "inconsistent"].includes(status)) {
    return "CONSISTENCY_FAILED" as const;
  }
  if (["rejected", "failed", "invalid"].includes(status)) {
    return "REJECTED" as const;
  }
  if (["revoked"].includes(status)) return "REVOKED" as const;
  if (["deleted"].includes(status)) return "DELETED" as const;
  if (["expired"].includes(status)) return "ENTITLEMENT_EXPIRED" as const;
  return "FAILED" as const;
}

export function createVolcengineArkSeedanceTrustedAssetPort(
  input: Readonly<{
    credentials: VolcengineArkControlPlaneCredentials;
    identity: SeedanceProviderIdentity;
    providerDisplayName: string;
  }>,
  options: VolcengineArkSeedanceTrustedAssetOptions = {},
): SeedanceTrustedAssetPort {
  if (
    input.identity.region !== VOLCENGINE_ARK_CONTROL_PLANE_REGION ||
    input.credentials.region !== undefined &&
      input.credentials.region !== input.identity.region ||
    input.credentials.projectName !== undefined &&
      input.credentials.projectName !== input.identity.project ||
    !input.providerDisplayName.trim()
  ) fail("IDENTITY_MISMATCH");
  const qpm = options.qpm ?? 3;
  if (!Number.isSafeInteger(qpm) || qpm < 1 || qpm > 120) fail("FORMAT");
  const gate = new BoundedTokenBuckets({
    capacity: qpm,
    idleTtlMs: 60 * 60 * 1_000,
    maxKeys: 1,
    now: options.nowMilliseconds,
    refillTokensPerSecond: qpm / 60,
  });
  const now = options.now ?? (() => new Date());

  const request = async (
    identity: SeedanceProviderIdentity,
    action: VolcengineArkSeedanceAssetAction,
    payload: JsonObject,
    allowedProviderErrorCodes: readonly string[] = [],
  ) => {
    if (!sameIdentity(input.identity, identity)) fail("IDENTITY_MISMATCH");
    const admission = gate.consume(identity.accountFingerprint);
    if (!admission.allowed) fail("RATE_LIMIT");
    try {
      options.onControlRequest?.(action);
      return await requestVolcengineArkSeedanceAssetControlPlane(
        input.credentials,
        action,
        { ...payload, ProjectName: identity.project },
        {
          allowedProviderErrorCodes,
          fetcher: options.fetcher,
          now,
          timeoutMs: options.timeoutMs,
        },
      );
    } catch (error) {
      if (error instanceof SeedanceTrustedAssetProviderError) throw error;
      if (error instanceof VolcengineArkControlPlaneError) fail(error.code);
      fail("REMOTE");
    }
  };

  const port: SeedanceTrustedAssetPort = {
    async capability(identity) {
      if (!sameIdentity(input.identity, identity)) fail("IDENTITY_MISMATCH");
      return Object.freeze({
        branch: "A",
        canCreateAuthorizationSession: true,
        canInspectAsset: true,
        providerDisplayName: input.providerDisplayName.trim(),
      });
    },
    async createAuthorizationSession({ identity }) {
      const response = await request(
        identity,
        "CreateVisualValidateSession",
        {},
      );
      const payload = result(response);
      return Object.freeze({
        authorizationUrl: httpsUrl(valueAt(payload, "H5Link", "h5_link")),
        expiresAt: expiresAt(
          valueAt(payload, "ExpiresIn", "expires_in", "ExpireTime", "expire_time"),
          now(),
        ),
        providerGroupId: null,
        providerSessionId: requiredProviderId(
          valueAt(payload, "BytedToken", "byted_token"),
        ),
        providerStatus: "WAITING_AUTHORIZATION",
        status: "WAITING_AUTHORIZATION",
      });
    },
    async inspectAuthorizationSession({ identity, providerSessionId }) {
      const response = await request(
        identity,
        "GetVisualValidateResult",
        { BytedToken: requiredProviderId(providerSessionId) },
        ["ValidatePending"],
      );
      const errorCode = providerErrorCode(response);
      if (errorCode === "ValidatePending") {
        return Object.freeze({
          expiresAt: null,
          providerGroupId: null,
          providerSessionId,
          providerStatus: "ValidatePending",
          status: "WAITING_AUTHORIZATION",
        });
      }
      const payload = result(response);
      return Object.freeze({
        expiresAt: null,
        providerGroupId: requiredProviderId(
          valueAt(payload, "GroupId", "group_id"),
        ),
        providerSessionId,
        providerStatus: "AUTHORIZED",
        status: "AUTHORIZATION_COMPLETED",
      });
    },
    async createAsset({ identity, providerGroupId, source }) {
      if (
        source.kind !== "image" ||
        source.contentType.toLowerCase() === "image/svg+xml" ||
        !/^image\/[a-z0-9.+-]{1,64}$/i.test(source.contentType) ||
        !/^[a-f0-9]{64}$/.test(source.checksumSha256)
      ) fail("FORMAT");
      const response = await request(identity, "CreateAsset", {
        AssetType: "Image",
        GroupId: requiredProviderId(providerGroupId),
        Name: `unboundry-${source.checksumSha256.slice(0, 16)}`,
        URL: httpsUrl(source.providerUrl),
      });
      const payload = result(response);
      return Object.freeze({
        checkedAt: now().toISOString(),
        expiresAt: null,
        providerAssetId: requiredProviderId(valueAt(payload, "Id", "id")),
        providerAssetType: "Image",
        providerStatus: optionalProviderText(valueAt(payload, "Status", "status")) ??
          "Processing",
        status: "ASSET_PROCESSING",
      });
    },
    async inspectAsset({ identity, providerAssetId }) {
      const response = await request(identity, "GetAsset", {
        Id: requiredProviderId(providerAssetId),
      });
      const outer = result(response);
      const payload = object(valueAt(outer, "Asset", "asset")) ?? outer;
      const returnedId = requiredProviderId(
        valueAt(payload, "Id", "id", "AssetId", "asset_id"),
      );
      if (returnedId !== providerAssetId) fail("IDENTITY_MISMATCH");
      const providerStatus = optionalProviderText(valueAt(payload, "Status", "status"));
      return Object.freeze({
        checkedAt: now().toISOString(),
        expiresAt: expiresAt(
          valueAt(payload, "ExpireTime", "expire_time", "ExpiresAt", "expires_at"),
          now(),
        ),
        providerAssetId: returnedId,
        providerAssetType: optionalProviderText(
          valueAt(payload, "AssetType", "asset_type", "Type", "type"),
        ) ?? "Image",
        providerStatus,
        status: mapAssetStatus(providerStatus),
      } satisfies SeedanceProviderAsset);
    },
  };
  return Object.freeze(port);
}
