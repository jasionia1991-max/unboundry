import type { IncomingMessage, ServerResponse } from "node:http";

export type BoundedBodyErrorCode =
  | "BODY_TIMEOUT"
  | "PAYLOAD_TOO_LARGE"
  | "REQUEST_ABORTED";

export class BoundedBodyError extends Error {
  constructor(
    readonly code: BoundedBodyErrorCode,
    readonly statusCode: 400 | 408 | 413,
    message: string,
  ) {
    super(message);
    this.name = "BoundedBodyError";
  }
}

export function forfeitRequestKeepAlive(request: IncomingMessage) {
  (request as IncomingMessage & { shouldKeepAlive: boolean }).shouldKeepAlive = false;
}

/**
 * Give an unread request body an explicit owner while a structured rejection
 * is written. The socket is destroyed only after the response has flushed, so
 * a slow sender cannot keep streaming into a handler that already returned.
 */
export function rejectUnreadRequestBody(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.readableEnded || request.destroyed) return;
  forfeitRequestKeepAlive(request);
  request.once("error", () => undefined);
  request.pause();
  response.setHeader("Connection", "close");
  response.once("finish", () => {
    if (!request.complete && !request.destroyed) request.destroy();
  });
}

export type BoundedBodyOptions = Readonly<{
  idleTimeoutMs?: number;
  maximumBytes: number;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
}>;

export function declaredContentLength(request: IncomingMessage) {
  const header = request.headers["content-length"];
  if (typeof header !== "string" || !/^\d+$/.test(header)) return undefined;
  try {
    const value = BigInt(header);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  } catch {
    return undefined;
  }
}

export function assertDeclaredBodyWithin(
  request: IncomingMessage,
  maximumBytes: number,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be positive");
  }
  const declared = declaredContentLength(request);
  if (
    declared !== undefined &&
    (typeof declared === "bigint" || declared > maximumBytes)
  ) {
    forfeitRequestKeepAlive(request);
    request.pause();
    throw bodyError(
      "PAYLOAD_TOO_LARGE",
      413,
      "Request payload is too large",
    );
  }
  return typeof declared === "number" ? declared : undefined;
}

function validateOptions(options: BoundedBodyOptions) {
  const idleTimeoutMs = options.idleTimeoutMs ?? 15_000;
  const totalTimeoutMs = options.totalTimeoutMs ?? 120_000;
  if (
    !Number.isSafeInteger(options.maximumBytes) ||
    options.maximumBytes < 1 ||
    !Number.isSafeInteger(idleTimeoutMs) ||
    idleTimeoutMs < 1 ||
    !Number.isSafeInteger(totalTimeoutMs) ||
    totalTimeoutMs < idleTimeoutMs
  ) {
    throw new TypeError("Invalid bounded body options");
  }
  return { idleTimeoutMs, totalTimeoutMs };
}

function bodyError(
  code: BoundedBodyErrorCode,
  statusCode: 400 | 408 | 413,
  message: string,
) {
  return new BoundedBodyError(code, statusCode, message);
}

async function nextChunk(
  iterator: AsyncIterator<unknown>,
  timeoutMs: number,
  request: IncomingMessage,
  signal?: AbortSignal,
) {
  if (request.aborted || signal?.aborted) {
    throw bodyError(
      "REQUEST_ABORTED",
      400,
      "Request body was interrupted",
    );
  }
  return new Promise<IteratorResult<unknown>>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.off("aborted", onAbort);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(bodyError(
      "REQUEST_ABORTED",
      400,
      "Request body was interrupted",
    )));
    const timer = setTimeout(() => finish(() => reject(bodyError(
      "BODY_TIMEOUT",
      408,
      "Request body timed out",
    ))), timeoutMs);
    timer.unref?.();
    request.once("aborted", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    void iterator.next().then(
      (result) => finish(() => resolve(result)),
      () => onAbort(),
    );
  });
}

/**
 * Consume one request body with byte, idle, total and abort bounds. Awaiting the
 * chunk callback preserves Node stream backpressure for file spooling.
 */
export async function consumeBoundedBody(
  request: IncomingMessage,
  options: BoundedBodyOptions,
  consume: (chunk: Buffer) => Promise<void> | void,
) {
  const { idleTimeoutMs, totalTimeoutMs } = validateOptions(options);
  const declared = assertDeclaredBodyWithin(request, options.maximumBytes);

  const iterator = request.iterator({ destroyOnReturn: false });
  const started = Date.now();
  let size = 0;
  try {
    while (true) {
      const remaining = totalTimeoutMs - (Date.now() - started);
      if (remaining <= 0) {
        throw bodyError("BODY_TIMEOUT", 408, "Request body timed out");
      }
      const result = await nextChunk(
        iterator,
        Math.min(idleTimeoutMs, remaining),
        request,
        options.signal,
      );
      if (result.done) break;
      const chunk = Buffer.from(result.value as Uint8Array);
      size += chunk.length;
      if (size > options.maximumBytes) {
        throw bodyError(
          "PAYLOAD_TOO_LARGE",
          413,
          "Request payload is too large",
        );
      }
      await consume(chunk);
    }
    if (request.aborted || options.signal?.aborted) {
      throw bodyError(
        "REQUEST_ABORTED",
        400,
        "Request body was interrupted",
      );
    }
    if (typeof declared === "number" && size !== declared) {
      throw bodyError(
        "REQUEST_ABORTED",
        400,
        "Request body length did not match Content-Length",
      );
    }
    return size;
  } catch (error) {
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
    // A rejected sender forfeits keep-alive, but the socket is not destroyed
    // before the handler can flush its structured 408/413 response. Node closes
    // the connection after that response because shouldKeepAlive is false.
    request.once("error", () => undefined);
    forfeitRequestKeepAlive(request);
    request.pause();
    if (error instanceof BoundedBodyError) throw error;
    throw bodyError(
      "REQUEST_ABORTED",
      400,
      "Request body was interrupted",
    );
  }
}

export async function readBoundedBody(
  request: IncomingMessage,
  options: BoundedBodyOptions,
) {
  const chunks: Buffer[] = [];
  await consumeBoundedBody(request, options, (chunk) => {
    chunks.push(chunk);
  });
  return Buffer.concat(chunks);
}

/** Consume a provider result stream and cancel it exactly once on any failure. */
export async function consumeBoundedReadableStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  consume: (chunk: Buffer) => Promise<void> | void,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be positive");
  }
  const reader = stream.getReader();
  let cancelled = false;
  let completed = false;
  let size = 0;
  const cancel = async () => {
    if (cancelled || completed) return;
    cancelled = true;
    await reader.cancel().catch(() => undefined);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      const bytes = Buffer.from(value);
      size += bytes.length;
      if (size > maximumBytes) {
        throw bodyError(
          "PAYLOAD_TOO_LARGE",
          413,
          "Stream payload is too large",
        );
      }
      await consume(bytes);
    }
    return size;
  } catch (error) {
    await cancel();
    throw error;
  } finally {
    await cancel();
    reader.releaseLock();
  }
}
