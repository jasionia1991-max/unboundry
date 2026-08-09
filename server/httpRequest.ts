import { isUtf8 } from "node:buffer";
import type { IncomingMessage } from "node:http";

export type HttpRequestErrorCode =
  | "INVALID_JSON"
  | "MALFORMED_URL"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

export class HttpRequestError extends Error {
  readonly code: HttpRequestErrorCode;
  readonly statusCode: 400 | 413 | 415;

  constructor(
    code: HttpRequestErrorCode,
    statusCode: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "HttpRequestError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function requestError(
  code: HttpRequestErrorCode,
  statusCode: 400 | 413 | 415,
  message: string,
) {
  return new HttpRequestError(code, statusCode, message);
}

function jsonMediaType(value: string) {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType === "application/json") return true;
  if (!mediaType.startsWith("application/") || !mediaType.endsWith("+json")) {
    return false;
  }
  const subtype = mediaType.slice("application/".length);
  return (
    subtype.length > "+json".length &&
    /^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(subtype)
  );
}

function declaredBodyBytes(request: IncomingMessage) {
  const header = request.headers["content-length"];
  if (typeof header !== "string" || !/^\d+$/.test(header)) return undefined;
  try {
    return BigInt(header);
  } catch {
    return undefined;
  }
}

export function discardUnreadRequestBody(request: IncomingMessage) {
  if (request.readableEnded || request.destroyed) return;
  request.once("error", () => undefined);
  request.resume();
}

/**
 * Decode one URL-encoded value without exposing URIError to an HTTP handler.
 * The caller may use this for a mounted pathname or an encoded request header.
 */
export function decodeUrlComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw requestError(
      "MALFORMED_URL",
      400,
      "Request URL or encoded header is malformed",
    );
  }
}

/** Decode an encoded request header and drain its unread body on rejection. */
export function decodedRequestHeader(
  request: IncomingMessage,
  value: string,
) {
  try {
    return decodeUrlComponent(value);
  } catch (error) {
    discardUnreadRequestBody(request);
    throw error;
  }
}

/** Return the decoded, query-free pathname visible to the mounted handler. */
export function decodedRequestPath(request: IncomingMessage) {
  const rawPath = (request.url ?? "").split("?", 1)[0] ?? "";
  if (
    Buffer.byteLength(rawPath, "utf8") > 4_096 ||
    rawPath.includes("\0") ||
    rawPath.includes("\\") ||
    /%(?:2f|5c)/i.test(rawPath)
  ) {
    discardUnreadRequestBody(request);
    throw requestError("MALFORMED_URL", 400, "Request path is malformed");
  }
  let decoded: string;
  try {
    decoded = decodeUrlComponent(rawPath);
  } catch (error) {
    discardUnreadRequestBody(request);
    throw error;
  }
  if (
    Buffer.byteLength(decoded, "utf8") > 4_096 ||
    decoded.includes("\0") ||
    decoded.includes("\\")
  ) {
    discardUnreadRequestBody(request);
    throw requestError("MALFORMED_URL", 400, "Request path is malformed");
  }
  return decoded;
}

/**
 * Read and parse one bounded JSON request body.
 *
 * Content-Type is intentionally optional for v0.5.1 compatibility. When the
 * header is present it must be application/json or an application/*+json
 * structured suffix. Missing/empty/malformed JSON is always INVALID_JSON.
 */
export async function readJsonBody<T>(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<T> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer");
  }

  const contentType = request.headers["content-type"];
  if (
    contentType !== undefined &&
    (typeof contentType !== "string" || !jsonMediaType(contentType))
  ) {
    discardUnreadRequestBody(request);
    throw requestError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "Content-Type must be application/json",
    );
  }

  const declared = declaredBodyBytes(request);
  if (declared !== undefined && declared > BigInt(maximumBytes)) {
    discardUnreadRequestBody(request);
    throw requestError(
      "PAYLOAD_TOO_LARGE",
      413,
      "Request payload is too large",
    );
  }

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (
      const chunk of request.iterator({ destroyOnReturn: false })
    ) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maximumBytes) {
        throw requestError(
          "PAYLOAD_TOO_LARGE",
          413,
          "Request payload is too large",
        );
      }
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof HttpRequestError) {
      discardUnreadRequestBody(request);
      throw error;
    }
    throw requestError(
      "INVALID_JSON",
      400,
      "Request body was interrupted before valid JSON was received",
    );
  }
  if (request.aborted) {
    throw requestError(
      "INVALID_JSON",
      400,
      "Request body was interrupted before valid JSON was received",
    );
  }

  const body = Buffer.concat(chunks);
  try {
    if (!isUtf8(body)) throw new Error("Invalid UTF-8");
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw requestError(
      "INVALID_JSON",
      400,
      "Request body must contain valid JSON",
    );
  }
}
