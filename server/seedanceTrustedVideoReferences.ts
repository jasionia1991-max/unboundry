import type { NodeInputSnapshot } from "../types/nodeInputs";
import type {
  SeedanceProviderIdentity,
  SeedanceTrustedAssetPort,
} from "./seedanceTrustedAssetPort";
import type { SeedanceAssetBindingRecord } from "./seedanceTrustedAssetStore";

type TrustedVideoStore = Readonly<{
  bindingById(ownerId: string, id: string): SeedanceAssetBindingRecord | undefined;
  bindingForSource(input: Readonly<{
    identity: SeedanceProviderIdentity;
    ownerId: string;
    sourceAssetId: string;
  }>): SeedanceAssetBindingRecord | undefined;
  upsertBinding(record: SeedanceAssetBindingRecord): SeedanceAssetBindingRecord;
}>;

type TrustedVideoSource = Readonly<{
  checksumSha256: string;
  storageStatus: "failed" | "pending" | "ready";
}>;

export type SeedanceTrustedVideoContext = Readonly<{
  identity: SeedanceProviderIdentity;
  port: SeedanceTrustedAssetPort;
}>;

export type SeedanceTrustedVideoReferenceOptions = Readonly<{
  context(
    ownerId: string,
    providerProfileId: string,
  ): Promise<SeedanceTrustedVideoContext | undefined>;
  media(ownerId: string, assetId: string): TrustedVideoSource | undefined;
  now?: () => Date;
  store: TrustedVideoStore;
}>;

export class SeedanceTrustedVideoReferenceError extends Error {
  constructor(readonly code: "IDENTITY" | "INVALID" | "STALE" | "UNAVAILABLE") {
    super(code === "STALE"
      ? "方舟可信素材已失效，请重新关联或验证后再生成"
      : code === "IDENTITY"
        ? "方舟可信素材所属账号已变化，不能用于本次生成"
        : code === "UNAVAILABLE"
          ? "方舟可信素材暂时无法核验，请稍后再试"
          : "方舟可信素材快照无效，请重新关联后再生成");
    this.name = "SeedanceTrustedVideoReferenceError";
  }
}

function sameIdentity(
  binding: SeedanceAssetBindingRecord,
  identity: SeedanceProviderIdentity,
) {
  return binding.profileId === identity.profileId &&
    binding.accountFingerprint === identity.accountFingerprint &&
    binding.region === identity.region && binding.project === identity.project;
}

function exactPersistedSnapshot(
  snapshot: NonNullable<NodeInputSnapshot["trustedAsset"]>,
  binding: SeedanceAssetBindingRecord,
) {
  return snapshot.bindingId === binding.id &&
    snapshot.providerAssetId === binding.providerAssetId &&
    snapshot.providerProfileId === binding.profileId &&
    snapshot.sourceChecksumSha256 === binding.sourceChecksumSha256 &&
    Number.isFinite(Date.parse(snapshot.checkedAt));
}

function activeAt(record: SeedanceAssetBindingRecord, current: Date) {
  if (record.status !== "ACTIVE" || !record.providerAssetId || !record.checkedAt) {
    return false;
  }
  const checked = Date.parse(record.checkedAt);
  return Number.isFinite(checked) && checked <= current.getTime();
}

export function createSeedanceTrustedVideoReferenceResolver(
  options: SeedanceTrustedVideoReferenceOptions,
) {
  return async (input: Readonly<{
    inputs: readonly NodeInputSnapshot[];
    ownerId: string;
    providerProfileId: string;
  }>): Promise<NodeInputSnapshot[]> => {
    const context = await options.context(input.ownerId, input.providerProfileId);
    const current = (options.now ?? (() => new Date()))();
    const output: NodeInputSnapshot[] = [];
    for (const snapshot of input.inputs) {
      if (snapshot.kind !== "image" || !snapshot.assetId) {
        if (snapshot.trustedAsset) throw new SeedanceTrustedVideoReferenceError("INVALID");
        output.push({ ...snapshot });
        continue;
      }
      const persisted = snapshot.trustedAsset;
      if (!context) {
        if (persisted) throw new SeedanceTrustedVideoReferenceError("IDENTITY");
        output.push({ ...snapshot, trustedAsset: undefined });
        continue;
      }
      const binding = persisted
        ? options.store.bindingById(input.ownerId, persisted.bindingId)
        : options.store.bindingForSource({
            identity: context.identity,
            ownerId: input.ownerId,
            sourceAssetId: snapshot.assetId,
          });
      if (!binding) {
        if (persisted) throw new SeedanceTrustedVideoReferenceError("INVALID");
        output.push({ ...snapshot, trustedAsset: undefined });
        continue;
      }
      if (!sameIdentity(binding, context.identity) ||
          binding.profileId !== input.providerProfileId) {
        throw new SeedanceTrustedVideoReferenceError("IDENTITY");
      }
      const media = options.media(input.ownerId, snapshot.assetId);
      if (!media || media.storageStatus !== "ready" ||
          media.checksumSha256 !== binding.sourceChecksumSha256 ||
          binding.sourceAssetId !== snapshot.assetId) {
        throw new SeedanceTrustedVideoReferenceError("STALE");
      }
      if (!activeAt(binding, current)) {
        if (persisted || binding.status === "STALE_SOURCE" ||
            ["REVOKED", "DELETED", "ENTITLEMENT_EXPIRED"].includes(binding.status)) {
          throw new SeedanceTrustedVideoReferenceError("STALE");
        }
        output.push({ ...snapshot, trustedAsset: undefined });
        continue;
      }
      if (persisted && !exactPersistedSnapshot(persisted, binding)) {
        throw new SeedanceTrustedVideoReferenceError("INVALID");
      }
      let inspected;
      try {
        inspected = await context.port.inspectAsset({
          identity: context.identity,
          providerAssetId: binding.providerAssetId!,
        });
      } catch {
        throw new SeedanceTrustedVideoReferenceError("UNAVAILABLE");
      }
      if (
        inspected.status !== "ACTIVE" ||
        inspected.providerAssetId !== binding.providerAssetId ||
        inspected.providerAssetType.toLowerCase() !== "image" ||
        inspected.expiresAt && Date.parse(inspected.expiresAt) <= current.getTime()
      ) throw new SeedanceTrustedVideoReferenceError("STALE");
      const verified = options.store.upsertBinding({
        ...binding,
        checkedAt: inspected.checkedAt,
        providerAssetType: inspected.providerAssetType,
        providerStatus: inspected.providerStatus,
        status: inspected.status,
        updatedAt: current.toISOString(),
      });
      output.push({
        ...snapshot,
        trustedAsset: Object.freeze({
          bindingId: verified.id,
          checkedAt: inspected.checkedAt,
          providerAssetId: verified.providerAssetId!,
          providerProfileId: verified.profileId,
          sourceChecksumSha256: verified.sourceChecksumSha256,
        }),
      });
    }
    return output;
  };
}

type Resolver = ReturnType<typeof createSeedanceTrustedVideoReferenceResolver>;
let resolver: Resolver | undefined;

export function configureSeedanceTrustedVideoReferenceResolver(next: Resolver) {
  if (resolver && resolver !== next) {
    throw new Error("Seedance trusted video reference resolver is already configured");
  }
  resolver = next;
}

export async function resolveSeedanceTrustedVideoReferences(input: Readonly<{
  inputs: readonly NodeInputSnapshot[];
  ownerId: string;
  providerProfileId: string;
}>) {
  if (!resolver) {
    if (input.inputs.some((item) => item.trustedAsset)) {
      throw new SeedanceTrustedVideoReferenceError("UNAVAILABLE");
    }
    return input.inputs.map((item) => ({ ...item, trustedAsset: undefined }));
  }
  return resolver(input);
}
