import type {
  SeedanceTrustedAssetCapability,
  SeedanceTrustedAssetStatus,
} from "../types/seedanceTrustedAssets";

export type SeedanceProviderIdentity = Readonly<{
  accountFingerprint: string;
  profileId: string;
  project: string;
  region: string;
}>;

export type SeedanceTrustedAssetProviderErrorCode =
  | "AUTH"
  | "FORMAT"
  | "IDENTITY_MISMATCH"
  | "NETWORK"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "REMOTE";

export type SeedanceTrustedAssetProviderDiagnostic = Readonly<{
  httpStatus: number | null;
  providerCode: string | null;
  requestId: string | null;
}>;

const emptyProviderDiagnostic: SeedanceTrustedAssetProviderDiagnostic =
  Object.freeze({ httpStatus: null, providerCode: null, requestId: null });

export class SeedanceTrustedAssetProviderError extends Error {
  readonly diagnostic: SeedanceTrustedAssetProviderDiagnostic;

  constructor(
    readonly code: SeedanceTrustedAssetProviderErrorCode,
    diagnostic: SeedanceTrustedAssetProviderDiagnostic = emptyProviderDiagnostic,
  ) {
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
    this.diagnostic = Object.freeze({ ...diagnostic });
    this.name = "SeedanceTrustedAssetProviderError";
  }
}

export function seedanceProviderFailureStatus(
  operation: "CREATE_ASSET_FAILED" | "CREATE_SESSION_FAILED" |
    "INSPECT_ASSET_FAILED" | "INSPECT_SESSION_FAILED",
  error: unknown,
) {
  if (!(error instanceof SeedanceTrustedAssetProviderError)) return operation;
  const parts: string[] = [operation, error.code];
  if (error.diagnostic.httpStatus !== null) {
    parts.push(`HTTP_${error.diagnostic.httpStatus}`);
  }
  if (error.diagnostic.providerCode) {
    parts.push(`PROVIDER_${error.diagnostic.providerCode}`);
  }
  if (error.diagnostic.requestId) {
    parts.push(`REQUEST_${error.diagnostic.requestId}`);
  }
  return parts.join("|").slice(0, 512);
}

export type SeedanceProviderAuthorizationSession = Readonly<{
  expiresAt: string | null;
  providerGroupId: string | null;
  providerSessionId: string;
  providerStatus: string | null;
  status: SeedanceTrustedAssetStatus;
}>;

export type SeedanceProviderAuthorizationSessionCreated =
  SeedanceProviderAuthorizationSession & Readonly<{
    authorizationUrl: string;
  }>;

export type SeedanceProviderAsset = Readonly<{
  checkedAt: string;
  expiresAt: string | null;
  providerAssetId: string;
  providerAssetType: string;
  providerStatus: string | null;
  status: SeedanceTrustedAssetStatus;
}>;

export interface SeedanceTrustedAssetPort {
  capability(
    identity: SeedanceProviderIdentity,
  ): Promise<SeedanceTrustedAssetCapability>;
  createAuthorizationSession(input: Readonly<{
    idempotencyKey: string;
    identity: SeedanceProviderIdentity;
    providerGroupId: string | null;
  }>): Promise<SeedanceProviderAuthorizationSessionCreated>;
  inspectAuthorizationSession(input: Readonly<{
    identity: SeedanceProviderIdentity;
    providerSessionId: string;
  }>): Promise<SeedanceProviderAuthorizationSession>;
  createAsset(input: Readonly<{
    idempotencyKey: string;
    identity: SeedanceProviderIdentity;
    providerGroupId: string;
    source: Readonly<{
      assetId: string;
      checksumSha256: string;
      contentType: string;
      kind: "image";
      providerUrl: string;
    }>;
  }>): Promise<SeedanceProviderAsset>;
  inspectAsset(input: Readonly<{
    identity: SeedanceProviderIdentity;
    providerAssetId: string;
  }>): Promise<SeedanceProviderAsset>;
}
