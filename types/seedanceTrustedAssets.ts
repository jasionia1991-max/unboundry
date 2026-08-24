export const seedanceTrustedAssetBranches = ["A", "B", "C"] as const;

export type SeedanceTrustedAssetBranch =
  typeof seedanceTrustedAssetBranches[number];

export const seedanceTrustedAssetStatuses = [
  "NOT_STARTED",
  "SESSION_PENDING",
  "WAITING_AUTHORIZATION",
  "AUTHORIZATION_COMPLETED",
  "PENDING_ACCEPTANCE",
  "ASSET_PROCESSING",
  "LINKED_UNVERIFIED",
  "ACTIVE",
  "REJECTED",
  "CONSISTENCY_FAILED",
  "REVOKED",
  "DELETED",
  "ENTITLEMENT_EXPIRED",
  "STALE_SOURCE",
  "FAILED",
] as const;

export type SeedanceTrustedAssetStatus =
  typeof seedanceTrustedAssetStatuses[number];

export type SeedanceTrustedAssetCapability = Readonly<{
  branch: SeedanceTrustedAssetBranch;
  canCreateAuthorizationSession: boolean;
  canInspectAsset: boolean;
  providerDisplayName: string;
}>;

export type SeedanceAuthorizationSessionView = Readonly<{
  createdAt: string;
  expiresAt: string | null;
  id: string;
  status: SeedanceTrustedAssetStatus;
  updatedAt: string;
}>;

export type SeedanceAuthorizationSessionCreateView =
  SeedanceAuthorizationSessionView & Readonly<{
    /** Returned only by the create call and never persisted or returned by status reads. */
    authorizationUrl?: string;
  }>;

export type SeedanceTrustedBindingView = Readonly<{
  checkedAt: string | null;
  createdAt: string;
  failure: Readonly<{
    code: string;
    message: string;
  }> | null;
  id: string;
  source: Readonly<{
    assetId: string;
    checksumSha256: string;
    kind: "image";
  }>;
  status: SeedanceTrustedAssetStatus;
  updatedAt: string;
}>;

export const seedanceTrustedAssetStatusLabels = Object.freeze({
  ACTIVE: "方舟可信素材可用",
  ASSET_PROCESSING: "方舟正在处理",
  AUTHORIZATION_COMPLETED: "方舟正在处理",
  CONSISTENCY_FAILED: "素材未通过方舟校验",
  DELETED: "素材已撤销或不可用",
  ENTITLEMENT_EXPIRED: "当前账号权益不可用",
  FAILED: "处理失败，可查看原因",
  LINKED_UNVERIFIED: "已关联，等待方舟只读核验",
  NOT_STARTED: "尚未关联可信素材",
  PENDING_ACCEPTANCE: "方舟正在处理",
  REJECTED: "素材未通过方舟校验",
  REVOKED: "素材已撤销或不可用",
  SESSION_PENDING: "等待完成真人授权",
  STALE_SOURCE: "图片已变化，需要重新处理",
  WAITING_AUTHORIZATION: "等待完成真人授权",
} satisfies Record<SeedanceTrustedAssetStatus, string>);

export function isSeedanceTrustedAssetStatus(
  value: unknown,
): value is SeedanceTrustedAssetStatus {
  return typeof value === "string" &&
    (seedanceTrustedAssetStatuses as readonly string[]).includes(value);
}

export function isSeedanceTrustedAssetBranch(
  value: unknown,
): value is SeedanceTrustedAssetBranch {
  return typeof value === "string" &&
    (seedanceTrustedAssetBranches as readonly string[]).includes(value);
}
