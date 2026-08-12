import { runMediaProcess } from "./mediaProcess";

/**
 * Read duration (and video dimensions when a video stream exists) from the
 * media container on the server. Browser-provided node metadata is
 * intentionally never used for Provider admission.
 */
export async function probeTrustedMediaMetadata(filePath: string) {
  let stdout = "";
  try {
    const result = await runMediaProcess(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        filePath,
      ],
      {
        kind: "probe",
        stderrLimitBytes: 64 * 1_024,
        stdoutLimitBytes: 64 * 1_024,
        timeoutMs: 20_000,
      },
    );
    stdout = result.stdout;
  } catch {
    throw new Error("服务端无法读取素材时长");
  }

  let parsed: {
    format?: { duration?: unknown };
    streams?: Array<{ height?: unknown; width?: unknown }>;
  };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    throw new Error("服务端无法确认素材信息");
  }
  const durationSeconds = Number(parsed.format?.duration);
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 7 * 24 * 60 * 60
  ) {
    throw new Error("服务端无法确认素材时长");
  }
  const stream = parsed.streams?.[0];
  const width = stream && Number.isFinite(Number(stream.width))
    ? Number(stream.width)
    : undefined;
  const height = stream && Number.isFinite(Number(stream.height))
    ? Number(stream.height)
    : undefined;
  return {
    durationSeconds: Math.round(durationSeconds * 1_000) / 1_000,
    height,
    width,
  };
}
