import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PackedClip = {
  end: number;
  name: string;
  size: number;
  start: number;
};

function run(command: string, args: string[], signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    signal?.addEventListener(
      "abort",
      () => {
        child.kill("SIGTERM");
      },
      { once: true },
    );
    child.on("close", (code) =>
      signal?.aborted
        ? reject(new Error("导出已取消"))
        : code === 0
        ? resolve(stdout)
        : reject(new Error(stderr.trim() || `${command} 运行失败`)),
    );
  });
}

async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 2 * 1024 * 1024 * 1024) {
      throw new Error("播放列表素材超过 2GB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function playlistExport(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") {
    response.statusCode = 405;
    response.end("只支持 POST");
    return;
  }

  let directory = "";
  const abort = new AbortController();
  request.once("aborted", () => abort.abort());
  response.once("close", () => {
    if (!response.writableEnded) abort.abort();
  });
  try {
    const payload = await body(request);
    if (payload.length < 5) throw new Error("导出数据不完整");
    const headerLength = payload.readUInt32BE(0);
    if (headerLength < 2 || headerLength > 1024 * 1024) {
      throw new Error("导出数据头无效");
    }
    const clips = JSON.parse(
      payload.subarray(4, 4 + headerLength).toString("utf8"),
    ) as PackedClip[];
    if (!Array.isArray(clips) || !clips.length || clips.length > 100) {
      throw new Error("播放列表片段数量无效");
    }

    directory = await mkdtemp(join(tmpdir(), "tapnow-playlist-"));
    let offset = 4 + headerLength;
    const inputs: string[] = [];
    for (const [index, clip] of clips.entries()) {
      if (
        !Number.isFinite(clip.size) ||
        !Number.isFinite(clip.start) ||
        !Number.isFinite(clip.end) ||
        clip.size <= 0 ||
        clip.start < 0 ||
        clip.end <= clip.start ||
        offset + clip.size > payload.length
      ) {
        throw new Error(`第 ${index + 1} 个片段无效`);
      }
      const path = join(directory, `input-${index}.media`);
      await writeFile(path, payload.subarray(offset, offset + clip.size));
      offset += clip.size;
      inputs.push(path);
    }
    if (offset !== payload.length) throw new Error("导出数据长度不一致");

    const firstProbe = JSON.parse(
      await run("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        inputs[0],
      ], abort.signal),
    ) as { streams?: Array<{ height?: number; width?: number }> };
    const firstVideo = firstProbe.streams?.[0];
    if (!firstVideo?.width || !firstVideo.height) {
      throw new Error("第一个片段没有可用视频");
    }
    const width = Math.max(2, Math.floor(firstVideo.width / 2) * 2);
    const height = Math.max(2, Math.floor(firstVideo.height / 2) * 2);
    const parts: string[] = [];

    for (const [index, clip] of clips.entries()) {
      const duration = clip.end - clip.start;
      const audioProbe = JSON.parse(
        await run("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_entries",
          "stream=index",
          "-of",
          "json",
          inputs[index],
        ], abort.signal),
      ) as { streams?: unknown[] };
      const output = join(directory, `part-${index}.mp4`);
      const args = [
        "-y",
        "-ss",
        String(clip.start),
        "-t",
        String(duration),
        "-i",
        inputs[index],
      ];
      if (!audioProbe.streams?.length) {
        args.push(
          "-f",
          "lavfi",
          "-t",
          String(duration),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
        );
      } else {
        args.push("-map", "0:v:0", "-map", "0:a:0");
      }
      args.push(
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-shortest",
        output,
      );
      await run("ffmpeg", args, abort.signal);
      parts.push(output);
    }

    const concatFile = join(directory, "concat.txt");
    await writeFile(
      concatFile,
      parts.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"),
    );
    const output = join(directory, "playlist.mp4");
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ], abort.signal);
    const result = await readFile(output);
    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Disposition", 'attachment; filename="playlist.mp4"');
    response.setHeader("Content-Length", String(result.length));
    response.setHeader("Content-Type", "video/mp4");
    response.end(result);
  } catch (error) {
    response.statusCode = 400;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(error instanceof Error ? error.message : "导出失败");
  } finally {
    if (directory) await rm(directory, { force: true, recursive: true });
  }
}
