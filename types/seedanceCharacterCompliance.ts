export const seedanceCharacterComplianceBranches = ["A", "B", "C"] as const;
export type SeedanceCharacterComplianceBranch =
  typeof seedanceCharacterComplianceBranches[number];

export const seedanceCharacterComplianceStates = [
  "NOT_REQUIRED",
  "NOT_SUBMITTED",
  "DISCLOSURE_REQUIRED",
  "QUEUED",
  "CHECKING",
  "APPROVED",
  "REJECTED_REAL_PERSON",
  "REJECTED_PUBLIC_FIGURE",
  "REJECTED_COPYRIGHT_IP",
  "REJECTED_MINOR_OR_SENSITIVE",
  "REJECTED_UNCERTAIN",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "STALE_SOURCE",
  "EXPIRED",
  "REVOKED",
] as const;

export type SeedanceCharacterComplianceState =
  typeof seedanceCharacterComplianceStates[number];

export const seedanceCharacterComplianceRiskCodes = [
  "REAL_PERSON",
  "PUBLIC_FIGURE",
  "COPYRIGHT_IP",
  "MINOR_OR_SENSITIVE",
  "UNCERTAIN",
] as const;
export type SeedanceCharacterComplianceRiskCode =
  typeof seedanceCharacterComplianceRiskCodes[number];

export type SeedanceCharacterComplianceCapability = Readonly<{
  available: boolean;
  branch: SeedanceCharacterComplianceBranch;
  canCreateChecks: boolean;
  formalSeedanceTicketAccepted: boolean;
  productName: "角色风险预检";
  providerDisplayName: string | null;
  reason: string;
  reasonCode:
    | "AVAILABLE"
    | "NO_COMPLIANT_PROVIDER"
    | "PROVIDER_CONFIGURATION_UNAVAILABLE";
}>;

export type SeedanceCharacterComplianceSource = Readonly<{
  assetId: string;
  checksumSha256: string;
  kind: "image";
  modelConfigurationRevision: string;
  modelId: string;
}>;

export type SeedanceCharacterComplianceCheckView = Readonly<{
  branch: SeedanceCharacterComplianceBranch;
  checkedAt: string | null;
  createdAt: string;
  disclosureVersion: string;
  expiresAt: string | null;
  id: string;
  providerDisplayName: string | null;
  riskCodes: readonly SeedanceCharacterComplianceRiskCode[];
  source: SeedanceCharacterComplianceSource;
  state: SeedanceCharacterComplianceState;
  updatedAt: string;
}>;

export function isSeedanceCharacterComplianceState(
  value: unknown,
): value is SeedanceCharacterComplianceState {
  return typeof value === "string" &&
    (seedanceCharacterComplianceStates as readonly string[]).includes(value);
}

export function isSeedanceCharacterComplianceBranch(
  value: unknown,
): value is SeedanceCharacterComplianceBranch {
  return typeof value === "string" &&
    (seedanceCharacterComplianceBranches as readonly string[]).includes(value);
}
