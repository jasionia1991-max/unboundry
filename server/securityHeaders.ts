import type { IncomingMessage, ServerResponse } from "node:http";

export type SecurityHeaderOptions = Readonly<{
  allowDevelopmentHmr: boolean;
  allowSameOriginChildFrames?: boolean;
  allowSameOriginEmbedding?: boolean;
}>;

const oneYearSeconds = 31_536_000;

function loopbackAddress(address: string | undefined) {
  const normalized = String(address ?? "").toLowerCase();
  return normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1";
}

function effectiveHttpsFromTrustedProxy(request: IncomingMessage) {
  if ((request.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted) {
    return true;
  }
  if (process.env.UNBOUNDRY_TRUST_PROXY !== "1") return false;
  if (!loopbackAddress(request.socket.remoteAddress)) return false;
  const forwarded = request.headers["x-forwarded-proto"];
  return typeof forwarded === "string" && forwarded.trim().toLowerCase() === "https";
}

function contentSecurityPolicy({
  allowDevelopmentHmr,
  allowSameOriginChildFrames = false,
  allowSameOriginEmbedding = false,
}: SecurityHeaderOptions) {
  const connectSources = allowDevelopmentHmr
    ? "'self' ws: wss:"
    : "'self'";
  const scriptSources = allowDevelopmentHmr
    ? "'self' 'unsafe-inline'"
    : "'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${allowSameOriginEmbedding ? "'self'" : "'none'"}`,
    `frame-src ${allowSameOriginChildFrames ? "'self'" : "'none'"}`,
    "form-action 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' blob: data: https://*.aliyuncs.com",
    "media-src 'self' blob: data: https://*.aliyuncs.com",
    `connect-src ${connectSources}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

export function applySecurityHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  options: SecurityHeaderOptions,
) {
  if (response.headersSent) return;
  response.setHeader("Content-Security-Policy", contentSecurityPolicy(options));
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(self), payment=(), usb=()",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "X-Frame-Options",
    options.allowSameOriginEmbedding ? "SAMEORIGIN" : "DENY",
  );
  if (effectiveHttpsFromTrustedProxy(request)) {
    response.setHeader(
      "Strict-Transport-Security",
      `max-age=${oneYearSeconds}; includeSubDomains`,
    );
  }
}
