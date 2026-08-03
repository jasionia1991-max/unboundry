import type { PlaylistClip } from "./ProbeNode";

type PackedClip = {
  end: number;
  name: string;
  size: number;
  start: number;
};

export async function mergePlaylist(clips: PlaylistClip[]) {
  const files = await Promise.all(
    clips.map(async (clip) => {
      const response = await fetch(clip.src);
      if (!response.ok) throw new Error(`无法读取片段：${clip.title}`);
      return response.blob();
    }),
  );
  const metadata: PackedClip[] = files.map((file, index) => ({
    end: clips[index].end,
    name: `${clips[index].title || `片段 ${index + 1}`}.mp4`,
    size: file.size,
    start: clips[index].start,
  }));
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.byteLength);
  const response = await fetch("/api/playlist/export", {
    body: new Blob([length, header, ...files]),
    headers: { "Content-Type": "application/octet-stream" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "合并视频失败");
  }
  return response.blob();
}
