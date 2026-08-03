import type { NodeInputKind, NodeInputState } from "../../../types/nodeInputs";

export type TrustedMediaMetadata = {
  assetId: string;
  byteSize: number;
  contentType: string;
  durationSeconds: number | null;
  durationStatus: "failed" | "not-applicable" | "pending" | "ready";
  kind: Exclude<NodeInputKind, "text">;
  storageBackend: "local" | "oss";
};

export function mediaUploadState(
  inputState: Extract<NodeInputState, "uploading" | "invalid">,
  inputStateReason: string,
) {
  return {
    inputState,
    inputStateReason,
  } as const;
}

export function trustedMediaPatch(metadata: TrustedMediaMetadata) {
  const metadataStatus: "failed" | "pending" | "ready" = metadata.kind === "image"
    ? "ready"
    : metadata.durationStatus === "not-applicable"
      ? "failed"
      : metadata.durationStatus;
  return {
    inputState: "ready" as const,
    inputStateReason: undefined,
    mediaByteSize: metadata.byteSize,
    mediaContentType: metadata.contentType,
    mediaDurationSeconds: metadata.durationSeconds ?? undefined,
    mediaMetadataSource: "server" as const,
    mediaMetadataStatus: metadataStatus,
    mediaStorageBackend: metadata.storageBackend,
  };
}

export async function fetchTrustedMediaMetadata(
  kind: Exclude<NodeInputKind, "text">,
  assetId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `/api/media-metadata/${kind}/${encodeURIComponent(assetId)}`,
    { cache: "no-store", signal },
  );
  const body = await response.json() as TrustedMediaMetadata & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "服务端无法确认素材信息");
  return body;
}
