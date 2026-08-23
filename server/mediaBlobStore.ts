export type MediaBlobBackend = "local" | "memory" | "oss";

export type MediaBlobReference = Readonly<{
  backend: MediaBlobBackend;
  objectKey: string;
  storageProfileId?: string;
}>;

export type MediaBlobMetadata = Readonly<{
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  reference: MediaBlobReference;
}>;

export type PutMediaBlobInput = Readonly<{
  contentType: string;
  objectKey: string;
  storageProfileId?: string;
} & (
  | { bytes: Uint8Array; sourceFile?: never }
  | {
    bytes?: never;
    sourceFile: Readonly<{
      byteSize: number;
      checksumSha256: string;
      path: string;
    }>;
  }
)>;

export type SignedMediaBlobRead = Readonly<{
  expiresAt: string;
  url: string;
}>;

export type ReadMediaBlobInput = Readonly<{
  maximumBytes: number;
  signal?: AbortSignal;
}>;

/**
 * Physical object operations only. Publication, history, ownership and
 * Generation transitions remain outside this port.
 */
export interface MediaBlobStore {
  delete(reference: MediaBlobReference): Promise<void>;
  head(reference: MediaBlobReference): Promise<MediaBlobMetadata | undefined>;
  put(input: PutMediaBlobInput): Promise<MediaBlobMetadata>;
  read(
    reference: MediaBlobReference,
    input: ReadMediaBlobInput,
  ): Promise<Uint8Array>;
  signRead(
    reference: MediaBlobReference,
    lifetimeSeconds: number,
  ): Promise<SignedMediaBlobRead>;
}

export class MediaBlobStoreError extends Error {
  constructor(
    readonly code:
      | "INVALID_REFERENCE"
      | "PROFILE_UNAVAILABLE"
      | "READ_TOO_LARGE"
      | "UNSUPPORTED_OPERATION",
    message: string,
  ) {
    super(message);
    this.name = "MediaBlobStoreError";
  }
}
