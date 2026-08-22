import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import {
  createPrivateAliyunOssReadUrl,
  deletePrivateAliyunOssObject,
  uploadPrivateAliyunOssObject,
  type AliyunOssCredentials,
} from "./aliyunOss";
import { consumeBoundedReadableStream } from "./boundedBody";
import {
  type MediaBlobMetadata,
  type MediaBlobReference,
  type MediaBlobStore,
  MediaBlobStoreError,
  type PutMediaBlobInput,
} from "./mediaBlobStore";
import { fetchPublicHttps } from "./outboundNetwork";
import {
  storageProfileById,
  storageProfileForMedia,
} from "./secureStorageProfiles";

function validObjectKey(value: string) {
  return value.length >= 1 && value.length <= 512 &&
    !value.includes("\0") && !value.includes("..") &&
    !value.startsWith("/");
}

function localObjectName(value: string) {
  if (!validObjectKey(value) || basename(value) !== value) {
    throw new MediaBlobStoreError(
      "INVALID_REFERENCE",
      "Invalid local media object key",
    );
  }
  return value;
}

function assertReference(
  reference: MediaBlobReference,
  backend: MediaBlobReference["backend"],
) {
  if (reference.backend !== backend || !validObjectKey(reference.objectKey)) {
    throw new MediaBlobStoreError(
      "INVALID_REFERENCE",
      "Invalid media blob reference",
    );
  }
}

function contentTypeForObjectKey(objectKey: string) {
  const extension = objectKey.split(".").at(-1)?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "mp4") return "video/mp4";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "aac") return "audio/aac";
  if (extension === "ogg") return "audio/ogg";
  return "application/octet-stream";
}

function inputMetadata(input: PutMediaBlobInput) {
  if (input.bytes) {
    if (input.bytes.byteLength < 1) {
      throw new MediaBlobStoreError(
        "INVALID_REFERENCE",
        "Media blob bytes cannot be empty",
      );
    }
    return {
      byteSize: input.bytes.byteLength,
      checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
    };
  }
  if (
    !Number.isSafeInteger(input.sourceFile.byteSize) ||
    input.sourceFile.byteSize < 1 ||
    !/^[a-f0-9]{64}$/i.test(input.sourceFile.checksumSha256) ||
    !isAbsolute(input.sourceFile.path)
  ) {
    throw new MediaBlobStoreError(
      "INVALID_REFERENCE",
      "Invalid media blob file source",
    );
  }
  return {
    byteSize: input.sourceFile.byteSize,
    checksumSha256: input.sourceFile.checksumSha256.toLowerCase(),
  };
}

function isMissingPath(error: unknown) {
  return typeof error === "object" && error !== null &&
    "code" in error && error.code === "ENOENT";
}

function signedLifetimeSeconds(value: number) {
  if (!Number.isFinite(value)) {
    throw new MediaBlobStoreError(
      "INVALID_REFERENCE",
      "Invalid signed media lifetime",
    );
  }
  return Math.max(60, Math.min(600, Math.floor(value)));
}

async function openedLocalFile(path: string) {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Media blob is not a file");
    return { handle, info };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function hashHandle(
  handle: Awaited<ReturnType<typeof open>>,
) {
  const checksum = createHash("sha256");
  const stream = handle.createReadStream({ autoClose: false });
  for await (const chunk of stream) checksum.update(chunk);
  return checksum.digest("hex");
}

export function createLocalMediaBlobStore(rootDirectory: string): MediaBlobStore {
  if (!isAbsolute(rootDirectory)) {
    throw new MediaBlobStoreError(
      "INVALID_REFERENCE",
      "Local media root must be absolute",
    );
  }
  const referenceFor = (objectKey: string): MediaBlobReference => ({
    backend: "local",
    objectKey: localObjectName(objectKey),
  });
  const pathFor = (reference: MediaBlobReference) => {
    assertReference(reference, "local");
    return join(rootDirectory, localObjectName(reference.objectKey));
  };
  const store: MediaBlobStore = {
    async delete(reference) {
      const path = pathFor(reference);
      const info = await lstat(path).catch((error) => {
        if (isMissingPath(error)) return undefined;
        throw error;
      });
      if (!info) return;
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new MediaBlobStoreError(
          "INVALID_REFERENCE",
          "Invalid local media object",
        );
      }
      await unlink(path);
    },
    async head(reference) {
      const path = pathFor(reference);
      const opened = await openedLocalFile(path).catch((error) => {
        if (isMissingPath(error)) return undefined;
        throw error;
      });
      if (!opened) return undefined;
      try {
        return {
          byteSize: opened.info.size,
          checksumSha256: await hashHandle(opened.handle),
          contentType: contentTypeForObjectKey(reference.objectKey),
          reference,
        };
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
    },
    async put(input) {
      const reference = referenceFor(input.objectKey);
      const metadata = inputMetadata(input);
      await mkdir(rootDirectory, { recursive: true });
      const target = pathFor(reference);
      if (input.bytes) {
        await writeFile(target, input.bytes, { flag: "wx", mode: 0o600 });
      } else {
        await copyFile(input.sourceFile.path, target, constants.COPYFILE_EXCL);
      }
      try {
        const stored = await store.head(reference);
        if (
          !stored || stored.byteSize !== metadata.byteSize ||
          stored.checksumSha256 !== metadata.checksumSha256
        ) {
          throw new Error("Stored media blob verification failed");
        }
        return { ...stored, contentType: input.contentType };
      } catch (error) {
        await unlink(target).catch(() => undefined);
        throw error;
      }
    },
    async read(reference, maximumBytes) {
      if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
        throw new MediaBlobStoreError("READ_TOO_LARGE", "Invalid read limit");
      }
      const opened = await openedLocalFile(pathFor(reference));
      try {
        if (opened.info.size > maximumBytes) {
          throw new MediaBlobStoreError(
            "READ_TOO_LARGE",
            "Media blob exceeds the read limit",
          );
        }
        return await opened.handle.readFile();
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
    },
    async signRead() {
      throw new MediaBlobStoreError(
        "UNSUPPORTED_OPERATION",
        "Local media blobs do not have signed URLs",
      );
    },
  };
  return Object.freeze(store);
}

export function createMemoryMediaBlobStore(): MediaBlobStore {
  const blobs = new Map<string, { bytes: Uint8Array; metadata: MediaBlobMetadata }>();
  const keyFor = (reference: MediaBlobReference) => {
    assertReference(reference, "memory");
    return reference.objectKey;
  };
  const store: MediaBlobStore = {
    async delete(reference) {
      blobs.delete(keyFor(reference));
    },
    async head(reference) {
      return blobs.get(keyFor(reference))?.metadata;
    },
    async put(input) {
      if (!input.bytes) {
        throw new MediaBlobStoreError(
          "UNSUPPORTED_OPERATION",
          "Memory blobs require byte input",
        );
      }
      if (!validObjectKey(input.objectKey)) {
        throw new MediaBlobStoreError(
          "INVALID_REFERENCE",
          "Invalid memory blob reference",
        );
      }
      const reference = { backend: "memory", objectKey: input.objectKey } as const;
      const metadata = {
        ...inputMetadata(input),
        contentType: input.contentType,
        reference,
      };
      blobs.set(input.objectKey, {
        bytes: Uint8Array.from(input.bytes),
        metadata,
      });
      return metadata;
    },
    async read(reference, maximumBytes) {
      const blob = blobs.get(keyFor(reference));
      if (!blob) throw new Error("Media blob is unavailable");
      if (blob.bytes.byteLength > maximumBytes) {
        throw new MediaBlobStoreError(
          "READ_TOO_LARGE",
          "Media blob exceeds the read limit",
        );
      }
      return Uint8Array.from(blob.bytes);
    },
    async signRead(reference, lifetimeSeconds) {
      const objectKey = keyFor(reference);
      if (!blobs.has(objectKey)) throw new Error("Media blob is unavailable");
      const lifetime = signedLifetimeSeconds(lifetimeSeconds);
      return {
        expiresAt: new Date(Date.now() + lifetime * 1_000).toISOString(),
        url: `https://memory.invalid/${encodeURIComponent(objectKey)}`,
      };
    },
  };
  return Object.freeze(store);
}

type AliyunBlobOperation = "delete" | "put" | "read";

export type AliyunMediaBlobDriver = Readonly<{
  deleteObject(
    reference: MediaBlobReference,
    credentials: AliyunOssCredentials,
  ): Promise<void>;
  headObject(
    reference: MediaBlobReference,
    credentials: AliyunOssCredentials,
  ): Promise<Omit<MediaBlobMetadata, "reference"> | undefined>;
  putObject(
    input: PutMediaBlobInput,
    credentials: AliyunOssCredentials,
  ): Promise<Omit<MediaBlobMetadata, "reference">>;
  readObject(
    reference: MediaBlobReference,
    maximumBytes: number,
    credentials: AliyunOssCredentials,
  ): Promise<Uint8Array>;
  signRead(
    reference: MediaBlobReference,
    lifetimeSeconds: number,
    credentials: AliyunOssCredentials,
  ): Promise<string>;
}>;

function responseByteSize(response: Response) {
  const range = response.headers.get("content-range");
  const ranged = range && /\/(\d+)$/.exec(range)?.[1];
  const value = Number(ranged ?? response.headers.get("content-length"));
  return Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

async function signedObjectResponse(
  reference: MediaBlobReference,
  credentials: AliyunOssCredentials,
  range?: string,
) {
  const url = await createPrivateAliyunOssReadUrl(
    reference.objectKey,
    credentials,
    300,
  );
  const response = await fetchPublicHttps(url, {
    headers: range ? { Range: range } : undefined,
    redirect: "error",
  }, { timeoutMs: 60_000 });
  if (!response.ok && response.status !== 206) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("OSS media blob read failed");
  }
  return response;
}

const defaultAliyunMediaBlobDriver: AliyunMediaBlobDriver = Object.freeze({
  async deleteObject(reference, credentials) {
    await deletePrivateAliyunOssObject(reference.objectKey, credentials);
  },
  async headObject(reference, credentials) {
    const response = await signedObjectResponse(
      reference,
      credentials,
      "bytes=0-0",
    );
    try {
      const byteSize = responseByteSize(response);
      const checksumSha256 = response.headers.get("x-oss-meta-sha256") ?? "";
      if (!byteSize || !/^[a-f0-9]{64}$/i.test(checksumSha256)) {
        throw new Error("OSS media blob metadata is incomplete");
      }
      return {
        byteSize,
        checksumSha256: checksumSha256.toLowerCase(),
        contentType: response.headers.get("content-type") ??
          contentTypeForObjectKey(reference.objectKey),
      };
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  },
  async putObject(input, credentials) {
    const metadata = inputMetadata(input);
    let temporaryDirectory: string | undefined;
    let filePath: string;
    if (input.bytes) {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "unboundry-blob-"));
      filePath = join(temporaryDirectory, "upload.bin");
      await writeFile(filePath, input.bytes, { flag: "wx", mode: 0o600 });
    } else {
      filePath = input.sourceFile.path;
    }
    try {
      await uploadPrivateAliyunOssObject({
        ...metadata,
        contentType: input.contentType,
        credentials,
        filePath,
        objectKey: input.objectKey,
      });
      return { ...metadata, contentType: input.contentType };
    } finally {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    }
  },
  async readObject(reference, maximumBytes, credentials) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new MediaBlobStoreError("READ_TOO_LARGE", "Invalid read limit");
    }
    const response = await signedObjectResponse(reference, credentials);
    const declared = responseByteSize(response);
    if (declared !== undefined && declared > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new MediaBlobStoreError(
        "READ_TOO_LARGE",
        "Media blob exceeds the read limit",
      );
    }
    if (!response.body) throw new Error("OSS media blob has no response body");
    const chunks: Buffer[] = [];
    await consumeBoundedReadableStream(response.body, maximumBytes, (chunk) => {
      chunks.push(chunk);
    });
    return Buffer.concat(chunks);
  },
  async signRead(reference, lifetimeSeconds, credentials) {
    return createPrivateAliyunOssReadUrl(
      reference.objectKey,
      credentials,
      lifetimeSeconds,
    );
  },
});

export function createAliyunMediaBlobStore(options: Readonly<{
  driver?: AliyunMediaBlobDriver;
  resolveProfile?: (
    reference: MediaBlobReference,
    operation: AliyunBlobOperation,
  ) => Promise<AliyunOssCredentials | undefined>;
}> = {}): MediaBlobStore {
  const driver = options.driver ?? defaultAliyunMediaBlobDriver;
  const resolveProfile = options.resolveProfile ?? (async (reference, operation) =>
    operation === "delete" || operation === "put"
      ? storageProfileById(reference.storageProfileId)
      : storageProfileForMedia({
          storageProfileId: reference.storageProfileId,
        }));
  const credentialsFor = async (
    reference: MediaBlobReference,
    operation: AliyunBlobOperation,
  ) => {
    assertReference(reference, "oss");
    const credentials = await resolveProfile(reference, operation);
    if (!credentials) {
      throw new MediaBlobStoreError(
        "PROFILE_UNAVAILABLE",
        "Media blob storage profile is unavailable",
      );
    }
    return credentials;
  };
  const store: MediaBlobStore = {
    async delete(reference) {
      await driver.deleteObject(
        reference,
        await credentialsFor(reference, "delete"),
      );
    },
    async head(reference) {
      const metadata = await driver.headObject(
        reference,
        await credentialsFor(reference, "read"),
      );
      return metadata ? { ...metadata, reference } : undefined;
    },
    async put(input) {
      const reference: MediaBlobReference = {
        backend: "oss",
        objectKey: input.objectKey,
        storageProfileId: input.storageProfileId,
      };
      const metadata = await driver.putObject(
        input,
        await credentialsFor(reference, "put"),
      );
      return { ...metadata, reference };
    },
    async read(reference, maximumBytes) {
      return driver.readObject(
        reference,
        maximumBytes,
        await credentialsFor(reference, "read"),
      );
    },
    async signRead(reference, lifetimeSeconds) {
      const lifetime = signedLifetimeSeconds(lifetimeSeconds);
      const url = await driver.signRead(
        reference,
        lifetime,
        await credentialsFor(reference, "read"),
      );
      return {
        expiresAt: new Date(Date.now() + lifetime * 1_000).toISOString(),
        url,
      };
    },
  };
  return Object.freeze(store);
}

export function createRoutedMediaBlobStore(stores: Readonly<{
  local: MediaBlobStore;
  memory?: MediaBlobStore;
  oss: MediaBlobStore;
}>): MediaBlobStore {
  const storeFor = (backend: MediaBlobReference["backend"]) => {
    const store = stores[backend];
    if (!store) {
      throw new MediaBlobStoreError(
        "UNSUPPORTED_OPERATION",
        `Media blob backend is unavailable: ${backend}`,
      );
    }
    return store;
  };
  const store: MediaBlobStore = {
    delete: (reference) => storeFor(reference.backend).delete(reference),
    head: (reference) => storeFor(reference.backend).head(reference),
    put: (input) => (input.storageProfileId ? stores.oss : stores.local).put(input),
    read: (reference, maximumBytes) =>
      storeFor(reference.backend).read(reference, maximumBytes),
    signRead: (reference, lifetimeSeconds) =>
      storeFor(reference.backend).signRead(reference, lifetimeSeconds),
  };
  return Object.freeze(store);
}

export function defaultMediaBlobStore(dataDirectory: string) {
  return createRoutedMediaBlobStore({
    local: createLocalMediaBlobStore(join(dataDirectory, "media")),
    oss: createAliyunMediaBlobStore(),
  });
}
