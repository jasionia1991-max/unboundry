import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { validatePng } from "./assetStorage";
import { appDataDirectory } from "./database";
import { runMediaProcess, MediaProcessError } from "./mediaProcess";
import { ProviderResultMediaError } from "./providerResultMedia";
import { reserveMediaResources, ResourceBudgetError } from "./resourceBudget";

const maximumImageBytes = 20 * 1024 * 1024;
const maximumImagePixels = 40_000_000;
const acceptedSourceTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

async function readBoundedImage(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) {
        throw new ProviderResultMediaError("CANCELLED", "已停止等待模型结果");
      }
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumImageBytes) {
        throw new ProviderResultMediaError("FORMAT", "模型返回的图片过大");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ProviderResultMediaError) throw error;
    throw new ProviderResultMediaError("NETWORK", "模型结果暂时无法下载");
  } finally {
    reader.releaseLock();
  }
}

function safeImageProbe(value: unknown) {
  const record = value && typeof value === "object"
    ? value as { streams?: Array<Record<string, unknown>> }
    : undefined;
  const stream = record?.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (
    !Number.isSafeInteger(width) || width < 1 ||
    !Number.isSafeInteger(height) || height < 1 ||
    width * height > maximumImagePixels
  ) {
    throw new ProviderResultMediaError("FORMAT", "模型返回的图片尺寸无效");
  }
  return { height, width };
}

function mappedProcessError(error: unknown) {
  if (error instanceof ProviderResultMediaError) return error;
  if (error instanceof ResourceBudgetError) return error;
  if (error instanceof MediaProcessError && error.code === "ABORTED") {
    return new ProviderResultMediaError("CANCELLED", "已停止等待模型结果");
  }
  return new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
}

/**
 * Decode an untrusted Provider image in a bounded child process and emit the
 * canonical PNG bytes used by the existing durable image-asset contract.
 */
export async function normalizeProviderImageToPng(input: Readonly<{
  body: ReadableStream<Uint8Array>;
  contentType: string;
  ownerId: string;
  signal?: AbortSignal;
}>) {
  if (!acceptedSourceTypes.has(input.contentType)) {
    await input.body.cancel().catch(() => undefined);
    throw new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
  }
  const root = appDataDirectory();
  await mkdir(root, { recursive: true });
  const release = await reserveMediaResources({
    bytes: maximumImageBytes * 2,
    directory: root,
    ownerId: input.ownerId,
  });
  let directory = "";
  try {
    const source = await readBoundedImage(input.body, input.signal);
    if (input.contentType === "image/png") {
      try {
        validatePng(source);
        return source;
      } catch {
        throw new ProviderResultMediaError("FORMAT", "模型结果格式不受支持");
      }
    }
    directory = await mkdtemp(join(root, "provider-image-"));
    const sourcePath = join(directory, "source.bin");
    const outputPath = join(directory, "normalized.png");
    const handle = await open(sourcePath, "wx", 0o600);
    try {
      await handle.writeFile(source);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const probe = JSON.parse((await runMediaProcess("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      sourcePath,
    ], {
      kind: "probe",
      signal: input.signal,
      stderrLimitBytes: 16 * 1024,
      stdoutLimitBytes: 16 * 1024,
      timeoutMs: 20_000,
    })).stdout);
    safeImageProbe(probe);
    await runMediaProcess("ffmpeg", [
      "-v", "error",
      "-y",
      "-i", sourcePath,
      "-map", "0:v:0",
      "-frames:v", "1",
      "-an", "-sn", "-dn",
      "-pix_fmt", "rgba",
      "-compression_level", "6",
      "-fs", String(maximumImageBytes + 1),
      outputPath,
    ], {
      kind: "encode",
      signal: input.signal,
      stderrLimitBytes: 32 * 1024,
      stdoutLimitBytes: 1_024,
      timeoutMs: 120_000,
    });
    const normalized = await readFile(outputPath);
    if (normalized.length < 1 || normalized.length > maximumImageBytes) {
      throw new ProviderResultMediaError("FORMAT", "模型返回的图片过大");
    }
    validatePng(normalized);
    return normalized;
  } catch (error) {
    throw mappedProcessError(error);
  } finally {
    if (directory) await rm(directory, { force: true, recursive: true });
    release();
  }
}
