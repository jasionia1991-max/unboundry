import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/**
 * Read duration from the media container on the server. Browser-provided node
 * metadata is intentionally never used for Provider admission.
 */
export async function probeTrustedMediaDuration(filePath: string) {
  let stdout = "";
  try {
    const result = await execute(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      {
        maxBuffer: 64 * 1_024,
        timeout: 20_000,
        windowsHide: true,
      },
    );
    stdout = result.stdout;
  } catch {
    throw new Error("服务端无法读取素材时长");
  }

  const durationSeconds = Number(stdout.trim());
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 7 * 24 * 60 * 60
  ) {
    throw new Error("服务端无法确认素材时长");
  }
  return Math.round(durationSeconds * 1_000) / 1_000;
}
