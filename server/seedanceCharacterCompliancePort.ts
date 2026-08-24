import type {
  SeedanceCharacterComplianceCapability,
  SeedanceCharacterComplianceRiskCode,
  SeedanceCharacterComplianceState,
} from "../types/seedanceCharacterCompliance";

export type SeedanceCharacterComplianceProviderIdentity = Readonly<{
  accountFingerprint: string;
  configurationVersion: number;
  credentialVersion: number;
  policyRevision: string;
  profileId: string;
  region: string;
}>;

export type SeedanceCharacterComplianceProviderResult = Readonly<{
  checkedAt: string | null;
  expiresAt: string | null;
  providerCheckId: string;
  providerStatus: string | null;
  riskCodes: readonly SeedanceCharacterComplianceRiskCode[];
  state: SeedanceCharacterComplianceState;
}>;

export type SeedanceCharacterComplianceProviderDiagnostic = Readonly<{
  httpStatus: number | null;
  providerCode: string | null;
  requestId: string | null;
}>;

export class SeedanceCharacterComplianceProviderError extends Error {
  constructor(
    readonly code: "AUTH" | "FORMAT" | "NETWORK" | "PERMISSION" |
      "RATE_LIMIT" | "REMOTE",
    readonly retryable: boolean,
    readonly admission: "definitive-not-accepted" | "outcome-unknown" =
      "outcome-unknown",
    readonly diagnostic: SeedanceCharacterComplianceProviderDiagnostic = {
      httpStatus: null,
      providerCode: null,
      requestId: null,
    },
  ) {
    super("角色风险预检服务暂时不可用");
    this.name = "SeedanceCharacterComplianceProviderError";
  }
}

export interface SeedanceCharacterCompliancePort {
  capability(
    identity: SeedanceCharacterComplianceProviderIdentity,
  ): Promise<SeedanceCharacterComplianceCapability>;
  create(input: Readonly<{
    idempotencyKey: string;
    identity: SeedanceCharacterComplianceProviderIdentity;
    source: Readonly<{
      assetId: string;
      checksumSha256: string;
      contentType: string;
      kind: "image";
      modelConfigurationRevision: string;
      modelId: string;
    }>;
  }>): Promise<SeedanceCharacterComplianceProviderResult>;
  inspect(input: Readonly<{
    identity: SeedanceCharacterComplianceProviderIdentity;
    providerCheckId: string;
  }>): Promise<SeedanceCharacterComplianceProviderResult>;
  reconcile(input: Readonly<{
    idempotencyKey: string;
    identity: SeedanceCharacterComplianceProviderIdentity;
  }>): Promise<SeedanceCharacterComplianceProviderResult | undefined>;
  cancel(input: Readonly<{
    identity: SeedanceCharacterComplianceProviderIdentity;
    providerCheckId: string;
  }>): Promise<SeedanceCharacterComplianceProviderResult>;
}
