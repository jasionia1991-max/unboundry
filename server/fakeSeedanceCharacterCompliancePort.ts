import type {
  SeedanceCharacterComplianceRiskCode,
  SeedanceCharacterComplianceState,
} from "../types/seedanceCharacterCompliance";
import type {
  SeedanceCharacterCompliancePort,
  SeedanceCharacterComplianceProviderResult,
} from "./seedanceCharacterCompliancePort";

type Fixture = Readonly<{
  decision: Extract<SeedanceCharacterComplianceState,
    "APPROVED" | "REJECTED_REAL_PERSON" | "REJECTED_PUBLIC_FIGURE" |
    "REJECTED_COPYRIGHT_IP" | "REJECTED_MINOR_OR_SENSITIVE" |
    "REJECTED_UNCERTAIN" | "FAILED_RETRYABLE" | "FAILED_TERMINAL">;
  riskCodes: readonly SeedanceCharacterComplianceRiskCode[];
}>;

export function createFakeSeedanceCharacterCompliancePort(options: Readonly<{
  fixtures: Readonly<Record<string, Fixture>>;
  onCreate?: () => void;
  now?: () => Date;
}>): SeedanceCharacterCompliancePort {
  const results = new Map<string, SeedanceCharacterComplianceProviderResult>();
  const resultsByIdempotencyKey = new Map<
    string,
    SeedanceCharacterComplianceProviderResult
  >();
  const now = () => (options.now ?? (() => new Date()))().toISOString();
  const port: SeedanceCharacterCompliancePort = {
    async capability() {
      return Object.freeze({
        available: true,
        branch: "A" as const,
        canCreateChecks: true,
        formalSeedanceTicketAccepted: false,
        productName: "角色风险预检" as const,
        providerDisplayName: "Fake 角色风险预检",
        reason: "仅用于零费用自动测试，不代表正式 Provider 能力",
        reasonCode: "AVAILABLE" as const,
      });
    },
    async create(input) {
      options.onCreate?.();
      const fixture = options.fixtures[input.source.assetId] ?? {
        decision: "REJECTED_UNCERTAIN" as const,
        riskCodes: ["UNCERTAIN" as const],
      };
      const providerCheckId = `fake-${input.idempotencyKey.slice(0, 24)}`;
      const timestamp = now();
      const result = Object.freeze({
        checkedAt: timestamp,
        expiresAt: new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1_000)
          .toISOString(),
        providerCheckId,
        providerStatus: fixture.decision,
        riskCodes: Object.freeze([...fixture.riskCodes]),
        state: fixture.decision,
      });
      results.set(providerCheckId, result);
      resultsByIdempotencyKey.set(input.idempotencyKey, result);
      return result;
    },
    async inspect({ providerCheckId }) {
      const result = results.get(providerCheckId);
      if (!result) throw new Error("Unknown fake compliance check");
      return result;
    },
    async reconcile({ idempotencyKey }) {
      return resultsByIdempotencyKey.get(idempotencyKey);
    },
    async cancel({ providerCheckId }) {
      const existing = results.get(providerCheckId);
      if (!existing) throw new Error("Unknown fake compliance check");
      const result = Object.freeze({
        ...existing,
        providerStatus: "CANCELLED",
        state: "REVOKED" as const,
      });
      results.set(providerCheckId, result);
      return result;
    },
  };
  return Object.freeze(port);
}
