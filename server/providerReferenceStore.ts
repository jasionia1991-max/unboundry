export type ProviderReferenceKind = "audio" | "image" | "video";

export type ProviderReferenceLocator =
  | Readonly<{ dataUrl: string; transport: "inline-data" }>
  | Readonly<{ expiresAt: string; transport: "signed-url"; url: string }>
  | Readonly<{ fileId: string; transport: "provider-file" }>;

export type ProviderReferenceLease = Readonly<{
  assetId: string;
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  durationSeconds?: number | null;
  durationSource?: "provider-task" | "server-probe" | null;
  durationStatus?: "failed" | "not-applicable" | "pending" | "ready";
  kind: ProviderReferenceKind;
  leaseId: string;
  locator: ProviderReferenceLocator;
  mediaHeight?: number | null;
  mediaWidth?: number | null;
  ownerId: string;
}>;

export type AcquireProviderReferenceInput = Readonly<{
  assetId: string;
  kind: ProviderReferenceKind;
  maximumBytes: number;
  ownerId: string;
  preferredTransports: readonly ProviderReferenceLocator["transport"][];
  signal?: AbortSignal;
}>;

/**
 * Temporary Provider-facing references only. Durable bytes, publication state
 * and Generation task state are deliberately absent from this contract.
 */
export interface ProviderReferenceStore {
  acquire(input: AcquireProviderReferenceInput): Promise<ProviderReferenceLease>;
  release(lease: ProviderReferenceLease): Promise<void>;
}

export class ProviderReferenceStoreError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_ACCESSIBLE" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "ProviderReferenceStoreError";
  }
}
