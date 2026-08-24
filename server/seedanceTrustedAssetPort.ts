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
    }>;
  }>): Promise<SeedanceProviderAsset>;
  inspectAsset(input: Readonly<{
    identity: SeedanceProviderIdentity;
    providerAssetId: string;
  }>): Promise<SeedanceProviderAsset>;
}
