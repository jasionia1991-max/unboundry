import { isIP } from "node:net";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
} from "node:http";
import type { LegacyRuntimeTarget } from "./legacyRuntimeLauncher.ts";

const maximumRequestTargetBytes = 16 * 1_024;
const unreservedByte = /^[A-Za-z0-9._~-]$/;
const visibleAscii = /^[\x21-\x7e]+$/;
const forbiddenProxyHeaders = new Set([
  "forwarded",
  "host",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-unboundry-legacy-proxy",
]);
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type LegacyBridgeRequestTarget = Readonly<{
  canonicalOriginForm: string;
  decodedPath: string;
  lowerPath: string;
}>;

export class LegacyBridgeRequestError extends Error {
  readonly code:
    | "BRIDGE_PROXY_HEADERS_INVALID"
    | "BRIDGE_REQUEST_TARGET_INVALID";

  constructor(
    code:
      | "BRIDGE_PROXY_HEADERS_INVALID"
      | "BRIDGE_REQUEST_TARGET_INVALID",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "LegacyBridgeRequestError";
    this.code = code;
  }
}

function invalidTarget(message: string): never {
  throw new LegacyBridgeRequestError("BRIDGE_REQUEST_TARGET_INVALID", message);
}

function invalidHeaders(message: string): never {
  throw new LegacyBridgeRequestError("BRIDGE_PROXY_HEADERS_INVALID", message);
}

function asciiLowercase(value: string) {
  return value.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32));
}

function canonicalPercentEncoding(value: string, path: boolean) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const code = character.charCodeAt(0);
    if (
      code < 0x21 || character === "\\" || character === "#" ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      invalidTarget("request target contains a forbidden character");
    }
    if (character !== "%") {
      output += character;
      continue;
    }
    const pair = value.slice(index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(pair)) {
      invalidTarget("request target contains an invalid percent escape");
    }
    const byte = Number.parseInt(pair, 16);
    const decoded = String.fromCharCode(byte);
    if (
      byte <= 0x20 || byte === 0x7f || byte === 0x25 || byte === 0x2f ||
      byte === 0x5c || byte === 0x23 || (path && byte === 0x3f) ||
      unreservedByte.test(decoded)
    ) {
      invalidTarget("request target contains an ambiguous percent escape");
    }
    if (pair !== pair.toUpperCase()) {
      invalidTarget("request target contains a non-canonical percent escape");
    }
    output += `%${pair}`;
    index += 2;
  }
  return output;
}

/**
 * Admit one unambiguous HTTP origin-form and return the sole decoded path used
 * by every bridge policy decision. The exact legacy runtime never sees a
 * second spelling of a path that the parent classified differently.
 */
export function parseLegacyBridgeRequestTarget(
  rawTarget: string | undefined,
): LegacyBridgeRequestTarget {
  if (
    typeof rawTarget !== "string" || rawTarget.length === 0 ||
    Buffer.byteLength(rawTarget, "utf8") > maximumRequestTargetBytes ||
    rawTarget[0] !== "/" || rawTarget.startsWith("//")
  ) invalidTarget("request target is not a bounded origin-form");
  if (rawTarget.includes("#") || rawTarget.includes("\\")) {
    invalidTarget("request target contains a fragment or backslash");
  }
  const separator = rawTarget.indexOf("?");
  const rawPath = separator < 0 ? rawTarget : rawTarget.slice(0, separator);
  const rawQuery = separator < 0 ? undefined : rawTarget.slice(separator + 1);
  if (
    rawPath.length > 1 &&
    (rawPath.endsWith("/") || rawPath.includes("//"))
  ) invalidTarget("request path is not canonical");
  if (rawQuery?.includes("?")) {
    invalidTarget("request query has an ambiguous delimiter");
  }
  const canonicalPath = canonicalPercentEncoding(rawPath, true);
  const canonicalQuery = rawQuery === undefined
    ? undefined
    : canonicalPercentEncoding(rawQuery, false);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(canonicalPath);
  } catch {
    invalidTarget("request path is not valid UTF-8");
  }
  if (
    decodedPath.normalize("NFC") !== decodedPath ||
    (decodedPath !== "/" && decodedPath.split("/").some((segment, index) =>
      index > 0 && (segment === "." || segment === ".." || segment === ""))
    )
  ) invalidTarget("request path has an ambiguous normalized form");
  return Object.freeze({
    canonicalOriginForm: canonicalQuery === undefined
      ? canonicalPath
      : `${canonicalPath}?${canonicalQuery}`,
    decodedPath,
    lowerPath: asciiLowercase(decodedPath),
  });
}

export function isParentAuthoritativeLegacyPath(lowerPath: string) {
  return lowerPath === "/api/health/live" ||
    lowerPath === "/api/health/ready" || lowerPath === "/api/version" ||
    lowerPath === "/api/updates";
}

function connectionTokens(headers: IncomingHttpHeaders) {
  return new Set(
    String(headers.connection ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function rawHeaderValues(request: IncomingMessage, expectedName: string) {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === expectedName) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function singleRawHeader(
  request: IncomingMessage,
  name: string,
  required = false,
) {
  const values = rawHeaderValues(request, name);
  if (values.length > 1 || (required && values.length !== 1)) {
    invalidHeaders(`${name} must be a single header field`);
  }
  const value = values[0];
  if (value !== undefined && (!visibleAscii.test(value) || value.includes(","))) {
    invalidHeaders(`${name} is not a strict single value`);
  }
  return value;
}

function validateConnectionNominations(request: IncomingMessage) {
  const values = rawHeaderValues(request, "connection");
  if (values.length > 1) {
    invalidHeaders("connection must be a single header field");
  }
  const value = values[0];
  if (value === undefined) return;
  if (!visibleAscii.test(value)) invalidHeaders("connection is invalid");
  for (const token of value.split(",")) {
    const name = token.trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) {
      invalidHeaders("connection token is invalid");
    }
    if (forbiddenProxyHeaders.has(name)) {
      invalidHeaders("connection nominates a bridge identity header");
    }
  }
}

function normalizedIp(raw: string) {
  const value = raw.trim();
  const family = isIP(value);
  if (family === 4) {
    const normalized = value.split(".").map((part) => String(Number(part))).join(".");
    if (isIP(normalized) !== 4) invalidHeaders("client address is invalid");
    return normalized;
  }
  if (family !== 6 || value.includes("%")) {
    invalidHeaders("client address is invalid");
  }
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    if (!hostname.startsWith("[") || !hostname.endsWith("]")) {
      invalidHeaders("client address is invalid");
    }
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    invalidHeaders("client address is invalid");
  }
}

function normalizedPort(raw: string | undefined) {
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]{0,4}$/.test(raw)) invalidHeaders("authority port is invalid");
  const port = Number(raw);
  if (port > 65_535) invalidHeaders("authority port is invalid");
  return String(port);
}

function normalizedAuthority(raw: string) {
  if (!visibleAscii.test(raw) || raw.length > 512 || /[@/?#\\,]/.test(raw)) {
    invalidHeaders("Host authority is invalid");
  }
  if (raw.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(raw);
    if (!match || isIP(match[1]!) !== 6) invalidHeaders("Host authority is invalid");
    const host = normalizedIp(match[1]!);
    const port = normalizedPort(match[2]);
    return Object.freeze({ authority: `[${host}]${port ? `:${port}` : ""}`, port });
  }
  const colon = raw.lastIndexOf(":");
  if (colon !== raw.indexOf(":")) invalidHeaders("Host authority is invalid");
  const rawHost = colon < 0 ? raw : raw.slice(0, colon);
  const port = colon < 0 ? undefined : normalizedPort(raw.slice(colon + 1));
  const host = rawHost.toLowerCase();
  if (isIP(host) !== 4 && (
    host.length > 253 || host.endsWith(".") ||
    !host.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )) invalidHeaders("Host authority is invalid");
  return Object.freeze({ authority: `${host}${port ? `:${port}` : ""}`, port });
}

function isLoopbackIp(value: string) {
  return value === "::1" || value === "127.0.0.1";
}

function admittedAuthority(
  authority: ReturnType<typeof normalizedAuthority>,
  request: IncomingMessage,
  peerIp: string,
) {
  if (process.env.UNBOUNDRY_SAFE_TEST === "1") {
    const expectedPort = String(process.env.UNBOUNDRY_TEST_PORT ?? "");
    const safe = /^(?:localhost|127\.0\.0\.1):(\d+)$/.exec(authority.authority);
    if (!safe || safe[1] !== expectedPort) {
      invalidHeaders("safe-test Host is not runner-attested");
    }
    return authority;
  }
  if (
    authority.authority !== "canvas.mymy.ltd" &&
    authority.authority !== "canvas.mymy.ltd:443"
  ) invalidHeaders("production Host is not the admitted public authority");
  const encrypted = "encrypted" in request.socket && request.socket.encrypted;
  const forwardedProto = rawHeaderValues(request, "x-forwarded-proto")[0];
  if (
    !encrypted && (!isLoopbackIp(peerIp) ||
      forwardedProto?.toLowerCase() !== "https")
  ) {
    invalidHeaders("production Host requires HTTPS forwarding semantics");
  }
  return Object.freeze({ authority: "canvas.mymy.ltd", port: "443" });
}

function copiedHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const namedByConnection = connectionTokens(headers);
  const output: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      value === undefined || hopByHopHeaders.has(normalized) ||
      forbiddenProxyHeaders.has(normalized) ||
      namedByConnection.has(normalized) || normalized.startsWith("x-forwarded-")
    ) continue;
    output[name] = value;
  }
  return output;
}

export function legacyProxyRequestHeaders(
  request: IncomingMessage,
  target: LegacyRuntimeTarget,
) {
  validateConnectionNominations(request);
  const host = normalizedAuthority(singleRawHeader(request, "host", true)!);
  const suppliedForwardedFor = singleRawHeader(request, "x-forwarded-for");
  const suppliedForwardedProto = singleRawHeader(request, "x-forwarded-proto");
  // These are always discarded, but duplicates are rejected so no downstream
  // component can disagree about whether a request was canonical.
  singleRawHeader(request, "forwarded");
  singleRawHeader(request, "x-real-ip");
  singleRawHeader(request, "x-forwarded-host");
  singleRawHeader(request, "x-forwarded-port");
  const peerIp = normalizedIp(String(request.socket.remoteAddress ?? ""));
  const trustProxy = process.env.UNBOUNDRY_TRUST_PROXY === "1";
  const clientIp = normalizedIp(
    trustProxy && isLoopbackIp(peerIp) && suppliedForwardedFor
      ? suppliedForwardedFor
      : peerIp,
  );
  const proto = trustProxy && isLoopbackIp(peerIp) && suppliedForwardedProto
    ? suppliedForwardedProto.toLowerCase()
    : ("encrypted" in request.socket && request.socket.encrypted ? "https" : "http");
  if (proto !== "http" && proto !== "https") {
    invalidHeaders("x-forwarded-proto must be http or https");
  }
  const externalAuthority = admittedAuthority(host, request, peerIp);
  const output = copiedHeaders(request.headers);
  output.host = externalAuthority.authority;
  output.forwarded = `for="${isIP(clientIp) === 6 ? `[${clientIp}]` : clientIp}";proto=${proto};host="${externalAuthority.authority}"`;
  output["x-forwarded-for"] = clientIp;
  output["x-forwarded-host"] = externalAuthority.authority;
  output["x-forwarded-port"] = externalAuthority.port ??
    (proto === "https" ? "443" : "80");
  output["x-forwarded-proto"] = proto;
  output["x-real-ip"] = clientIp;
  output["x-unboundry-legacy-proxy"] = target.proxyNonce;
  // The TCP destination remains the private supervised child regardless of the
  // external Host authority reconstructed above.
  return Object.freeze({ headers: output, target });
}
