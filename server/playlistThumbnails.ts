import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Sheet = {
  columns: number;
  count: number;
  frameHeight: number;
  frameWidth: number;
  image: Buffer;
  interval: number;
  rows: number;
};

const cache = new Map<string, Sheet>();

function run(command: string, args: string[], signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    signal.addEventListener("abort", () => child.kill("SIGTERM"), {
      once: true,
    });
    child.on("close", (code) =>
      signal.aborted
        ? reject(new Error("缩略图生成已取消"))
        : code === 0
          ? resolve(stdout)
          : reject(new Error(stderr.trim() || `${command} 运行失败`)),
    );
  });
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 1024 * 1024 * 1024) {
      throw new Error("视频素材超过 1GB");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function playlistThumbnails(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") {
    response.statusCode = 405;
    response.end("只支持 POST");
    return;
  }

  const abort = new AbortController();
  let directory = "";
  request.once("aborted", () => abort.abort());
  response.once("close", () => {
    if (!response.writableEnded) abort.abort();
  });

  try {
    const payload = await readBody(request);
    if (!payload.length) throw new Error("视频素材为空");
    const key = createHash("sha256").update(payload).digest("hex");
    let sheet = cache.get(key);

    if (!sheet) {
      directory = await mkdtemp(join(tmpdir(), "tapnow-thumbnails-"));
      const input = join(directory, "input.media");
      const output = join(directory, "sheet.jpg");
      await writeFile(input, payload);
      const probe = JSON.parse(
        await run(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "format=duration:stream=width,height",
            "-of",
            "json",
            input,
          ],
          abort.signal,
        ),
      ) as {
        format?: { duration?: string };
        streams?: Array<{ height?: number; width?: number }>;
      };
      const stream = probe.streams?.[0];
      const duration = Number(probe.format?.duration);
      if (!stream?.width || !stream.height || !Number.isFinite(duration)) {
        throw new Error("视频没有可用画面");
      }

      const frameWidth = 96;
      const frameHeight = Math.max(
        2,
        Math.round((frameWidth * stream.height) / stream.width / 2) * 2,
      );
      const columns = 10;
      const maxRows = Math.max(1, Math.floor(16_000 / frameHeight));
      const maxFrames = columns * maxRows;
      const interval = Math.max(0.1, duration / maxFrames);
      const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration / interval)));
      const rows = Math.ceil(count / columns);

      await run(
        "ffmpeg",
        [
          "-y",
          "-i",
          input,
          "-vf",
          `fps=1/${interval},scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=decrease,pad=${frameWidth}:${frameHeight}:(ow-iw)/2:(oh-ih)/2:black,tile=${columns}x${rows}`,
          "-frames:v",
          "1",
          "-c:v",
          "mjpeg",
          "-q:v",
          "4",
          output,
        ],
        abort.signal,
      );

      sheet = {
        columns,
        count,
        frameHeight,
        frameWidth,
        image: await readFile(output),
        interval,
        rows,
      };
      cache.set(key, sheet);
      if (cache.size > 24) cache.delete(cache.keys().next().value!);
    }

    response.statusCode = 200;
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("Content-Type", "image/jpeg");
    response.setHeader("X-Thumbnail-Columns", String(sheet.columns));
    response.setHeader("X-Thumbnail-Count", String(sheet.count));
    response.setHeader("X-Thumbnail-Frame-Height", String(sheet.frameHeight));
    response.setHeader("X-Thumbnail-Frame-Width", String(sheet.frameWidth));
    response.setHeader("X-Thumbnail-Interval", String(sheet.interval));
    response.setHeader("X-Thumbnail-Rows", String(sheet.rows));
    response.end(sheet.image);
  } catch (error) {
    response.statusCode = 400;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(error instanceof Error ? error.message : "缩略图生成失败");
  } finally {
    if (directory) await rm(directory, { force: true, recursive: true });
  }
}
