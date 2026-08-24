import type { NodeInputSnapshot } from "../types/nodeInputs";
import type { SeedanceCharacterComplianceContext } from
  "./seedanceCharacterComplianceApplication";
import type { SeedanceCharacterComplianceCheckRecord } from
  "./seedanceCharacterComplianceStore";

type Store = Readonly<{
  checkById(ownerId: string, id: string):
    SeedanceCharacterComplianceCheckRecord | undefined;
  currentForSource(ownerId: string, assetId: string):
    SeedanceCharacterComplianceCheckRecord | undefined;
}>;

type Source = Readonly<{
  checksumSha256: string;
  storageStatus: "failed" | "pending" | "ready";
}>;

export type SeedanceCharacterReferenceOptions = Readonly<{
  context(ownerId: string): Promise<SeedanceCharacterComplianceContext | undefined>;
  media(ownerId: string, assetId: string): Source | undefined;
  model(ownerId: string, modelId: string): Readonly<{
    configurationRevision: string;
  }> | undefined;
  now?: () => Date;
  store: Store;
}>;

export class SeedanceCharacterReferenceError extends Error {
  constructor(readonly code:
    | "CHECK_INVALID"
    | "CHECK_STALE"
    | "FORMAL_BYPASS_UNAVAILABLE"
    | "OWNER_MISMATCH"
    | "RISK_PRECHECK_ONLY") {
    super(code === "RISK_PRECHECK_ONLY"
      ? "角色风险预检不是 Seedance 正式旁路票据，已在付费前停止"
      : code === "FORMAL_BYPASS_UNAVAILABLE"
        ? "当前没有可核验的 Seedance 正式角色旁路合同，已在付费前停止"
        : code === "OWNER_MISMATCH"
          ? "角色风险预检不属于当前账号，已在付费前停止"
          : "角色风险预检已失效或与当前图片不一致，已在付费前停止");
    this.name = "SeedanceCharacterReferenceError";
  }
}

function isCharacterRole(snapshot: NodeInputSnapshot) {
  return snapshot.kind === "image" &&
    (snapshot.role === "subject" || snapshot.role === "reference-image");
}

function active(record: SeedanceCharacterComplianceCheckRecord, now: Date) {
  return record.state === "APPROVED" && Boolean(record.checkedAt) &&
    Boolean(record.expiresAt) && Date.parse(record.expiresAt!) > now.getTime();
}

function exactSnapshot(
  snapshot: NonNullable<NodeInputSnapshot["characterCompliance"]>,
  record: SeedanceCharacterComplianceCheckRecord,
) {
  return snapshot.branch === "B" && snapshot.checkId === record.id &&
    snapshot.checkedAt === record.checkedAt &&
    snapshot.expiresAt === record.expiresAt &&
    snapshot.modelConfigurationRevision === record.modelConfigurationRevision &&
    snapshot.modelId === record.modelId &&
    snapshot.policyRevision === record.policyRevision &&
    snapshot.providerAccountFingerprint === record.providerAccountFingerprint &&
    snapshot.providerConfigurationVersion === record.providerConfigurationVersion &&
    snapshot.providerCredentialVersion === record.providerCredentialVersion &&
    snapshot.providerProfileId === record.providerProfileId &&
    snapshot.sourceChecksumSha256 === record.sourceChecksumSha256;
}

export function createSeedanceCharacterReferenceResolver(
  options: SeedanceCharacterReferenceOptions,
) {
  return async (input: Readonly<{
    generation: Readonly<{
      credentialVersion: number;
      modelId: string;
      providerConfigurationVersion: number;
      providerProfileId: string;
    }>;
    inputs: readonly NodeInputSnapshot[];
    ownerId: string;
    phase: "provider-submit" | "task-create";
  }>): Promise<NodeInputSnapshot[]> => {
    const now = (options.now ?? (() => new Date()))();
    const output: NodeInputSnapshot[] = [];
    for (const snapshot of input.inputs) {
      if (!isCharacterRole(snapshot) || !snapshot.assetId) {
        if (snapshot.characterCompliance) {
          throw new SeedanceCharacterReferenceError("CHECK_INVALID");
        }
        output.push({ ...snapshot, characterCompliance: undefined });
        continue;
      }
      const persisted = snapshot.characterCompliance;
      const record = persisted
        ? options.store.checkById(input.ownerId, persisted.checkId)
        : options.store.currentForSource(input.ownerId, snapshot.assetId);
      if (!record) {
        if (persisted) throw new SeedanceCharacterReferenceError("OWNER_MISMATCH");
        output.push({ ...snapshot, characterCompliance: undefined });
        continue;
      }
      if (record.ownerId !== input.ownerId) {
        throw new SeedanceCharacterReferenceError("OWNER_MISMATCH");
      }
      const source = options.media(input.ownerId, snapshot.assetId);
      if (!source || source.storageStatus !== "ready" ||
          record.sourceAssetId !== snapshot.assetId ||
          record.sourceChecksumSha256 !== source.checksumSha256 ||
          !active(record, now)) {
        throw new SeedanceCharacterReferenceError("CHECK_STALE");
      }
      if (record.branch !== "B") {
        throw new SeedanceCharacterReferenceError("RISK_PRECHECK_ONLY");
      }
      const context = await options.context(input.ownerId);
      const model = options.model(input.ownerId, input.generation.modelId);
      if (!context || !model ||
          record.modelId !== input.generation.modelId ||
          record.modelConfigurationRevision !== model.configurationRevision ||
          record.providerProfileId !== input.generation.providerProfileId ||
          record.providerConfigurationVersion !==
            input.generation.providerConfigurationVersion ||
          record.providerCredentialVersion !== input.generation.credentialVersion ||
          record.providerProfileId !== context.identity.profileId ||
          record.providerRegion !== context.identity.region ||
          record.providerAccountFingerprint !== context.identity.accountFingerprint ||
          record.providerConfigurationVersion !== context.identity.configurationVersion ||
          record.providerCredentialVersion !== context.identity.credentialVersion ||
          record.policyRevision !== context.identity.policyRevision ||
          !record.providerCheckId) {
        throw new SeedanceCharacterReferenceError("FORMAL_BYPASS_UNAVAILABLE");
      }
      const capability = await context.port.capability(context.identity)
        .catch(() => undefined);
      if (capability?.branch !== "B" ||
          !capability.formalSeedanceTicketAccepted) {
        throw new SeedanceCharacterReferenceError("FORMAL_BYPASS_UNAVAILABLE");
      }
      if (persisted && !exactSnapshot(persisted, record)) {
        throw new SeedanceCharacterReferenceError("CHECK_INVALID");
      }
      if (input.phase === "provider-submit") {
        const inspected = await context.port.inspect({
          identity: context.identity,
          providerCheckId: record.providerCheckId,
        }).catch(() => undefined);
        if (!inspected || inspected.state !== "APPROVED" ||
            inspected.providerCheckId !== record.providerCheckId ||
            inspected.checkedAt !== record.checkedAt ||
            inspected.expiresAt !== record.expiresAt) {
          throw new SeedanceCharacterReferenceError("CHECK_STALE");
        }
      }
      output.push({
        ...snapshot,
        characterCompliance: Object.freeze({
          branch: "B" as const,
          checkId: record.id,
          checkedAt: record.checkedAt!,
          expiresAt: record.expiresAt!,
          modelConfigurationRevision: record.modelConfigurationRevision,
          modelId: record.modelId,
          policyRevision: record.policyRevision,
          providerAccountFingerprint: record.providerAccountFingerprint!,
          providerConfigurationVersion: record.providerConfigurationVersion!,
          providerCredentialVersion: record.providerCredentialVersion!,
          providerProfileId: record.providerProfileId,
          sourceChecksumSha256: record.sourceChecksumSha256,
        }),
      });
    }
    return output;
  };
}

type Resolver = ReturnType<typeof createSeedanceCharacterReferenceResolver>;
let resolver: Resolver | undefined;

export function configureSeedanceCharacterReferenceResolver(next: Resolver) {
  if (resolver && resolver !== next) {
    throw new Error("Seedance character reference resolver is already configured");
  }
  resolver = next;
}

export async function resolveSeedanceCharacterReferences(input: Readonly<{
  generation: Readonly<{
    credentialVersion: number;
    modelId: string;
    providerConfigurationVersion: number;
    providerProfileId: string;
  }>;
  inputs: readonly NodeInputSnapshot[];
  ownerId: string;
  phase: "provider-submit" | "task-create";
}>) {
  if (!resolver) {
    if (input.inputs.some((item) => item.characterCompliance)) {
      throw new SeedanceCharacterReferenceError("FORMAL_BYPASS_UNAVAILABLE");
    }
    return input.inputs.map((item) => ({
      ...item,
      characterCompliance: undefined,
    }));
  }
  return resolver(input);
}
