import type { NodeInputKind, NodeInputState } from "../../../types/nodeInputs";

export type TrustedMediaMetadata = {
  assetId: string;
  byteSize: number;
  contentType: string;
  durationSeconds: number | null;
  durationStatus: "failed" | "not-applicable" | "pending" | "ready";
  kind: Exclude<NodeInputKind, "text">;
  mediaHeight?: number | null;
  mediaWidth?: number | null;
  storageBackend: "local" | "oss";
};

export function hasTrustedMediaDimensions(
  metadata: Pick<TrustedMediaMetadata, "mediaHeight" | "mediaWidth">,
): metadata is typeof metadata & { mediaHeight: number; mediaWidth: number } {
  return Number.isSafeInteger(metadata.mediaHeight) &&
    Number(metadata.mediaHeight) > 0 &&
    Number.isSafeInteger(metadata.mediaWidth) &&
    Number(metadata.mediaWidth) > 0;
}

export function hasCompleteTrustedMediaMetadata(
  kind: Exclude<NodeInputKind, "text">,
  data: Readonly<Record<string, unknown>>,
) {
  if (
    data.mediaMetadataSource !== "server" ||
    !Number.isSafeInteger(data.mediaByteSize) ||
    Number(data.mediaByteSize) < 1 ||
    typeof data.mediaContentType !== "string" ||
    !data.mediaContentType.trim() ||
    data.mediaMetadataStatus !== "ready" ||
    (data.mediaStorageBackend !== "local" &&
      data.mediaStorageBackend !== "oss")
  ) return false;
  if (
    (kind === "image" || kind === "video") &&
    !hasTrustedMediaDimensions({
      mediaHeight: data.mediaHeight as number | null | undefined,
      mediaWidth: data.mediaWidth as number | null | undefined,
    })
  ) return false;
  return kind === "image" ||
    (
      Number.isFinite(Number(data.mediaDurationSeconds)) &&
      Number(data.mediaDurationSeconds) > 0
    );
}

export function mediaUploadState(
  inputState: Extract<NodeInputState, "uploading" | "invalid">,
  inputStateReason: string,
) {
  return {
    inputViewState: inputState,
    inputViewStateReason: inputStateReason,
  } as const;
}

export function effectiveMediaInputState(
  data: Readonly<{
    inputState?: NodeInputState;
    inputViewState?: NodeInputState;
  }>,
) {
  return data.inputViewState ?? data.inputState;
}

export function effectiveMediaInputStateReason(
  data: Readonly<{
    inputStateReason?: string;
    inputViewStateReason?: string;
  }>,
) {
  return data.inputViewStateReason ?? data.inputStateReason;
}

export function trustedMediaPatch(metadata: TrustedMediaMetadata) {
  const metadataStatus: "failed" | "pending" | "ready" = metadata.kind === "image"
    ? "ready"
    : metadata.durationStatus === "not-applicable"
      ? "failed"
      : metadata.durationStatus;
  const inputState: Extract<NodeInputState, "invalid" | "ready"> =
    metadataStatus === "ready" ? "ready" : "invalid";
  const inputStateReason = metadataStatus === "pending"
    ? "服务端仍在确认素材时长，请稍后刷新页面重试"
    : metadataStatus === "failed"
      ? "服务端无法确认素材时长，请重新上传"
      : undefined;
  return {
    inputState,
    inputStateReason,
    inputViewState: undefined,
    inputViewStateReason: undefined,
    mediaByteSize: metadata.byteSize,
    mediaContentType: metadata.contentType,
    mediaDurationSeconds: metadata.durationSeconds ?? undefined,
    mediaHeight: metadata.mediaHeight ?? undefined,
    mediaMetadataSource: "server" as const,
    mediaMetadataStatus: metadataStatus,
    mediaStorageBackend: metadata.storageBackend,
    mediaWidth: metadata.mediaWidth ?? undefined,
  };
}

export async function fetchTrustedMediaMetadata(
  kind: Exclude<NodeInputKind, "text">,
  assetId: string,
  signal?: AbortSignal,
) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(
      `/api/media-metadata/${kind}/${encodeURIComponent(assetId)}`,
      { cache: "no-store", signal },
    );
    const body = await response.json() as TrustedMediaMetadata & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "服务端无法确认素材信息");
    if (
      kind === "image" ||
      body.durationStatus !== "pending" ||
      attempt === maxAttempts
    ) return body;
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        globalThis.clearTimeout(timeout);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      const timeout = globalThis.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, 250);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new Error("服务端无法确认素材信息");
}
