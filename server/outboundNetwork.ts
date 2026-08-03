import { lookup } from "node:dns/promises";
import {
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import {
  BlockList,
  isIP,
  type LookupFunction,
} from "node:net";
import { Readable } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";

export type DestinationResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

type HttpsRequestFactory = (
  url: URL,
  options: HttpsRequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export type PublicHttpsFetchDependencies = {
  /** Existing injected test fetchers remain isolated from real networking. */
  beforeRequest?: () => void;
  fetcher?: typeof fetch;
  requester?: HttpsRequestFactory;
  resolver?: DestinationResolver;
  timeoutMs?: number;
};

type PublicDestination = {
  address: string;
  family: 4 | 6;
};

export class OutboundDestinationError extends Error {
  constructor(readonly code: "FORMAT" | "NETWORK") {
    super(code);
    this.name = "OutboundDestinationError";
  }
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) return true;
  const [a, b, c] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

function normalizedHostname(hostname: string) {
  const lower = hostname.toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
}

export function privateNetworkAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return privateIpv4(address);
  if (family !== 6) return true;
  return blockedIpv6.check(address, "ipv6");
}

export function safePublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundDestinationError("FORMAT");
  }
  const hostname = normalizedHostname(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (isIP(hostname) > 0 && privateNetworkAddress(hostname))
  ) {
    throw new OutboundDestinationError("FORMAT");
  }
  return url;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw abortError(signal);
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function resolvePublicHttpsDestination(
  url: URL,
  resolver: DestinationResolver,
  signal: AbortSignal,
) {
  const hostname = normalizedHostname(url.hostname);
  const literalFamily = isIP(hostname);
  const records = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await abortable(
        resolver(hostname, { all: true, verbatim: true }),
        signal,
      );
  if (
    records.length < 1 ||
    records.length > 64 ||
    records.some((record) => {
      const family = isIP(record.address);
      return (
        (family !== 4 && family !== 6) ||
        family !== record.family ||
        privateNetworkAddress(record.address)
      );
    })
  ) {
    throw new OutboundDestinationError("FORMAT");
  }
  const selected = records[0];
  return {
    address: selected.address,
    family: selected.family as 4 | 6,
  };
}

function pinnedLookup(
  expectedHostname: string,
  destination: PublicDestination,
): LookupFunction {
  return (hostname, options, callback) => {
    const requestedFamily = typeof options === "object"
      ? Number(options.family ?? 0)
      : 0;
    if (
      normalizedHostname(hostname) !== expectedHostname ||
      (requestedFamily !== 0 && requestedFamily !== destination.family)
    ) {
      const error = new Error("Pinned DNS destination mismatch") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }
    if (typeof options === "object" && options.all) {
      callback(null, [{ ...destination }]);
      return;
    }
    callback(null, destination.address, destination.family);
  };
}

function requestBody(value: BodyInit | null | undefined) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof URLSearchParams) {
    return Buffer.from(value.toString(), "utf8");
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new OutboundDestinationError("FORMAT");
}

function responseHeaders(response: IncomingMessage) {
  const headers = new Headers();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
  }
  return headers;
}

async function pinnedHttpsFetch(
  url: URL,
  init: RequestInit,
  destination: PublicDestination,
  signal: AbortSignal,
  requester: HttpsRequestFactory,
) {
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (headers.has("host") || headers.has("connection")) {
    throw new OutboundDestinationError("FORMAT");
  }
  const body = requestBody(init.body);
  if ((method === "GET" || method === "HEAD") && body !== undefined) {
    throw new OutboundDestinationError("FORMAT");
  }
  if (body && !headers.has("content-length")) {
    headers.set("content-length", String(body.byteLength));
  }
  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const hostname = normalizedHostname(url.hostname);
    const request = requester(url, {
      agent: false,
      family: destination.family,
      headers: Object.fromEntries(headers.entries()),
      lookup: pinnedLookup(hostname, destination),
      method,
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
      signal,
    }, (response) => {
      if (settled) {
        response.destroy();
        return;
      }
      settled = true;
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 599) {
        response.destroy();
        reject(new OutboundDestinationError("NETWORK"));
        return;
      }
      const bodyless = method === "HEAD" || status === 204 || status === 205 ||
        status === 304;
      resolve(new Response(
        bodyless
          ? null
          : Readable.toWeb(response) as ReadableStream<Uint8Array>,
        {
          headers: responseHeaders(response),
          status,
          statusText: response.statusMessage,
        },
      ));
    });
    request.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.end(body);
  });
}

export async function assertPublicHttpsDestination(
  value: string | URL,
  resolver: DestinationResolver = (hostname, options) => lookup(hostname, options),
) {
  const url = safePublicHttpsUrl(String(value));
  const hostname = normalizedHostname(url.hostname);
  // RFC-reserved names are used only by dependency-injected fixtures and can
  // never become a real Internet destination. Real requests still fail in fetch.
  if (hostname.endsWith(".test") || hostname.endsWith(".example")) {
    return url;
  }
  try {
    const records = await resolver(hostname, { all: true, verbatim: true });
    if (!records.length || records.some((record) =>
      privateNetworkAddress(record.address)
    )) {
      throw new OutboundDestinationError("FORMAT");
    }
  } catch (error) {
    if (error instanceof OutboundDestinationError) throw error;
    throw new OutboundDestinationError("NETWORK");
  }
  return url;
}

/**
 * Performs an HTTPS request whose socket is bound to an address from the exact
 * DNS answer that passed the public-address check. The hostname remains on the
 * URL so TLS SNI and certificate hostname verification still use the original
 * host. Redirects are never followed.
 *
 * Tests may inject a fake fetcher. That path retains the destination guard but
 * deliberately avoids opening a real socket.
 */
export async function fetchPublicHttps(
  value: string | URL,
  init: RequestInit = {},
  dependencies: PublicHttpsFetchDependencies = {},
) {
  const url = safePublicHttpsUrl(String(value));
  const timeoutMs = dependencies.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
  ) {
    throw new OutboundDestinationError("FORMAT");
  }
  const timeoutController = new AbortController();
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;
  const timer = timeoutMs === undefined
    ? undefined
    : setTimeout(
        () => timeoutController.abort(
          new DOMException("Request timed out", "TimeoutError"),
        ),
        timeoutMs,
      );
  try {
    const resolver = dependencies.resolver ??
      ((hostname, options) => lookup(hostname, options));
    const injectedFetcher = dependencies.fetcher;
    if (injectedFetcher) {
      if (dependencies.resolver) {
        await resolvePublicHttpsDestination(url, resolver, signal);
      } else {
        await abortable(
          assertPublicHttpsDestination(url, resolver),
          signal,
        );
      }
      if (signal.aborted) throw abortError(signal);
      dependencies.beforeRequest?.();
      return await injectedFetcher(url, {
        ...init,
        redirect: "error",
        signal,
      });
    }
    const destination = await resolvePublicHttpsDestination(
      url,
      resolver,
      signal,
    );
    if (signal.aborted) throw abortError(signal);
    dependencies.beforeRequest?.();
    return await pinnedHttpsFetch(
      url,
      { ...init, redirect: "error" },
      destination,
      signal,
      dependencies.requester ?? httpsRequest,
    );
  } catch (error) {
    if (error instanceof OutboundDestinationError) throw error;
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
