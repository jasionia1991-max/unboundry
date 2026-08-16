import type { PlaylistClip } from "./ProbeNode";

export type PublishedPlaylistAsset = {
  assetId: string;
  byteSize: number;
  contentType: "video/mp4";
  durationSeconds: number;
  fileName: string;
  mediaHeight?: number;
  mediaWidth?: number;
  storageBackend: "local" | "oss";
  url: string;
};

export class PlaylistExportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PlaylistExportError";
  }
}

function assetIdFromVideoSource(src: string) {
  const url = new URL(src, window.location.origin);
  if (url.origin !== window.location.origin) return undefined;
  const match = url.pathname.match(/^\/api\/video-assets\/([^/]+)$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function exportClips(clips: PlaylistClip[]) {
  return clips.map((clip) => {
    const assetId = assetIdFromVideoSource(clip.src);
    const source = new URL(clip.src, window.location.origin);
    const fixturePath = source.origin === window.location.origin &&
        /^\/fixtures\/[a-z0-9][a-z0-9._-]{0,120}\.mp4$/i.test(source.pathname)
      ? source.pathname
      : undefined;
    if (!assetId && !fixturePath) {
      throw new Error(`片段不是已保存的视频素材：${clip.title}`);
    }
    return {
      assetId,
      end: clip.end,
      fixturePath,
      start: clip.start,
    };
  });
}

async function exportRequest(
  clips: PlaylistClip[],
  input: {
    assetId?: string;
    fileName: string;
    mode: "asset" | "download";
  },
) {
  return fetch("/api/playlist/export", {
    body: JSON.stringify({ ...input, clips: exportClips(clips) }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function downloadMergedPlaylist(
  clips: PlaylistClip[],
  fileName = "Playlist.mp4",
) {
  const payload = JSON.stringify({
    clips: exportClips(clips),
    fileName,
    mode: "download",
  });
  const form = document.createElement("form");
  form.action = "/api/playlist/export";
  form.hidden = true;
  form.method = "POST";
  // A native navigation consumes Content-Disposition without materializing a
  // potentially 500MiB Blob in the renderer. A server-side failure remains
  // visible in the new tab instead of replacing the editor.
  form.target = "_blank";
  const input = document.createElement("input");
  input.name = "payload";
  input.type = "hidden";
  input.value = payload;
  form.append(input);

  document.body.append(form);
  form.submit();
  form.remove();
}

export async function publishPlaylist(
  clips: PlaylistClip[],
  assetId: string,
  fileName = "Playlist.mp4",
) {
  const response = await exportRequest(clips, {
    assetId,
    fileName,
    mode: "asset",
  });
  const asset = await response.json().catch(() => undefined) as
    | PublishedPlaylistAsset & { error?: string }
    | undefined;
  if (!response.ok || !asset) {
    throw new PlaylistExportError(
      asset?.error || "视频保存失败",
      response.status,
    );
  }
  return asset;
}
