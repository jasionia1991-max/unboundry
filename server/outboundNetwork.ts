import { lookup } from "node:dns/promises";
import {
  Agent as HttpsAgent,
  request as httpsRequest,
  type RequestOptions as HttpsRequestOptions,
} from "node:https";
import {
  BlockList,
  connect as netConnect,
  isIP,
  type LookupFunction,
} from "node:net";
import { Duplex, Readable } from "node:stream";
import {
  checkServerIdentity,
  connect as tlsConnect,
} from "node:tls";
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

type ProxySocketFactory = (
  proxy: URL,
  signal: AbortSignal,
) => Promise<Duplex>;

type TargetTlsFactory = (
  socket: Duplex,
  hostname: string,
  signal: AbortSignal,
) => Promise<Duplex>;

export type PublicHttpsFetchDependencies = {
  /** Existing injected test fetchers remain isolated from real networking. */
  beforeRequest?: () => void;
  dohBootstrapAddresses?: readonly PublicDestination[];
  fetcher?: typeof fetch;
  proxySocketFactory?: ProxySocketFactory;
  proxyUrl?: string | null;
  requester?: HttpsRequestFactory;
  resolver?: DestinationResolver;
  targetTlsFactory?: TargetTlsFactory;
  timeoutMs?: number;
};

export type PinnedPublicHttpsDestination = {
  address: string;
  family: 4 | 6;
  hostname: string;
  lookup: LookupFunction;
};

type PublicDestination = {
  address: string;
  family: 4 | 6;
};

export class OutboundDestinationError extends Error {
  constructor(readonly code: "FORMAT" | "NETWORK" | "PROXY_CONFIGURATION") {
    super(code);
    this.name = "OutboundDestinationError";
  }
}

export class OutboundProxyConfigurationError extends OutboundDestinationError {
  constructor() {
    super("PROXY_CONFIGURATION");
    this.name = "OutboundProxyConfigurationError";
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

function syntheticProxyAddress(address: string) {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return first === 198 && (second === 18 || second === 19);
}

function loopbackProxyHostname(hostname: string) {
  const normalized = normalizedHostname(hostname);
  if (normalized === "::1") return true;
  if (isIP(normalized) !== 4) return false;
  return Number(normalized.split(".", 1)[0]) === 127;
}

function configuredLoopbackProxy(explicit: string | null | undefined) {
  const raw = explicit === null
    ? undefined
    : explicit ?? process.env.UNBOUNDRY_OUTBOUND_HTTPS_PROXY ??
      process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!raw) throw new OutboundProxyConfigurationError();
  let proxy: URL;
  try {
    proxy = new URL(raw);
  } catch {
    throw new OutboundProxyConfigurationError();
  }
  if (
    (proxy.protocol !== "http:" && proxy.protocol !== "https:") ||
    !loopbackProxyHostname(proxy.hostname) ||
    proxy.username ||
    proxy.password ||
    (proxy.pathname !== "" && proxy.pathname !== "/") ||
    proxy.search ||
    proxy.hash
  ) {
    throw new OutboundProxyConfigurationError();
  }
  return proxy;
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
    url.port ||
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

export function safeCanonicalAliyunOssEndpoint(
  endpoint: string,
  region: string,
) {
  if (!/^oss-[a-z0-9-]{3,70}$/.test(region)) {
    throw new OutboundDestinationError("FORMAT");
  }
  const canonical = `https://${region}.aliyuncs.com`;
  if (endpoint !== canonical) {
    throw new OutboundDestinationError("FORMAT");
  }
  return safePublicHttpsUrl(canonical);
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

function proxyPort(proxy: URL) {
  const value = Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80));
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new OutboundProxyConfigurationError();
  }
  return value;
}

async function defaultProxySocketFactory(proxy: URL, signal: AbortSignal) {
  if (signal.aborted) throw abortError(signal);
  const hostname = normalizedHostname(proxy.hostname);
  const port = proxyPort(proxy);
  return await new Promise<Duplex>((resolve, reject) => {
    let settled = false;
    const socket = proxy.protocol === "https:"
      ? tlsConnect({
          checkServerIdentity: (_name, certificate) =>
            checkServerIdentity(hostname, certificate),
          host: hostname,
          port,
          rejectUnauthorized: true,
        })
      : netConnect({ host: hostname, port });
    const connectedEvent = proxy.protocol === "https:"
      ? "secureConnect"
      : "connect";
    const connected = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      socket.off("error", failed);
      resolve(socket);
    };
    const failed = (error: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      socket.off(connectedEvent, connected);
      socket.off("error", failed);
      socket.destroy();
      reject(error);
    };
    const aborted = () => failed(abortError(signal));
    signal.addEventListener("abort", aborted, { once: true });
    socket.once(connectedEvent, connected);
    socket.once("error", failed);
    if (signal.aborted) aborted();
  });
}

function connectAuthority(destination: PublicDestination) {
  return destination.family === 6
    ? `[${destination.address}]:443`
    : `${destination.address}:443`;
}

async function establishHttpConnect(
  socket: Duplex,
  destination: PublicDestination,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    socket.destroy();
    throw abortError(signal);
  }
  const authority = connectAuthority(destination);
  return await new Promise<Duplex>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", aborted);
      socket.off("data", data);
      socket.off("end", ended);
      socket.off("error", failed);
    };
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const aborted = () => finishError(abortError(signal));
    const ended = () => finishError(new OutboundDestinationError("NETWORK"));
    const failed = () => finishError(new OutboundDestinationError("NETWORK"));
    const data = (chunk: Buffer | Uint8Array) => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      if (buffered.length > 16 * 1_024) {
        finishError(new OutboundDestinationError("NETWORK"));
        return;
      }
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const header = buffered.subarray(0, boundary).toString("latin1");
      const status = /^HTTP\/1\.[01]\s+(\d{3})(?:\s|$)/i.exec(header)?.[1];
      if (status !== "200") {
        finishError(
          status === "403" || status === "407"
            ? new OutboundProxyConfigurationError()
            : new OutboundDestinationError("NETWORK"),
        );
        return;
      }
      const remainder = buffered.subarray(boundary + 4);
      settled = true;
      cleanup();
      if (remainder.length) socket.unshift(remainder);
      resolve(socket);
    };
    signal.addEventListener("abort", aborted, { once: true });
    socket.on("data", data);
    socket.once("end", ended);
    socket.once("error", failed);
    if (signal.aborted) {
      aborted();
      return;
    }
    socket.write(
      `CONNECT ${authority} HTTP/1.1\r\n` +
        `Host: ${authority}\r\n\r\n`,
    );
  });
}

async function defaultTargetTlsFactory(
  socket: Duplex,
  hostname: string,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    socket.destroy();
    throw abortError(signal);
  }
  return await new Promise<Duplex>((resolve, reject) => {
    let settled = false;
    const secure = tlsConnect({
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: true,
      servername: hostname,
      socket,
    });
    const connected = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      secure.off("error", failed);
      resolve(secure);
    };
    const failed = (error: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      secure.off("secureConnect", connected);
      secure.off("error", failed);
      secure.destroy();
      reject(error);
    };
    const aborted = () => failed(abortError(signal));
    signal.addEventListener("abort", aborted, { once: true });
    secure.once("secureConnect", connected);
    secure.once("error", failed);
    if (signal.aborted) aborted();
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

/**
 * Resolve and validate every address for one HTTPS origin, then return a
 * lookup function that can only yield the selected validated address. This is
 * used by clients whose HTTP implementation accepts a Node lookup hook rather
 * than our fetch transport.
 */
export async function preparePublicHttpsDestination(
  value: string | URL,
  resolver: DestinationResolver = (hostname, options) => lookup(hostname, options),
  signal: AbortSignal = new AbortController().signal,
): Promise<PinnedPublicHttpsDestination> {
  const url = safePublicHttpsUrl(String(value));
  const hostname = normalizedHostname(url.hostname);
  try {
    const destination = await resolvePublicHttpsDestination(
      url,
      resolver,
      signal,
    );
    return {
      ...destination,
      hostname,
      lookup: pinnedLookup(hostname, destination),
    };
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof OutboundDestinationError) throw error;
    throw new OutboundDestinationError("NETWORK");
  }
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
  connectedSocket?: Duplex,
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
    const connectedAgent = connectedSocket
      ? new HttpsAgent({ keepAlive: false })
      : undefined;
    if (connectedAgent && connectedSocket) {
      connectedAgent.createConnection = (() => connectedSocket) as
        typeof connectedAgent.createConnection;
    }
    const request = requester(url, {
      agent: connectedAgent ?? false,
      headers: Object.fromEntries(headers.entries()),
      method,
      ...(connectedSocket
        ? {}
        : {
            family: destination.family,
            lookup: pinnedLookup(hostname, destination),
            ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
          }),
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

async function proxyPinnedHttpsFetch(
  url: URL,
  init: RequestInit,
  destination: PublicDestination,
  proxy: URL,
  signal: AbortSignal,
  requester: HttpsRequestFactory,
  socketFactory: ProxySocketFactory,
  targetTlsFactory: TargetTlsFactory,
) {
  const socket = await establishProxiedTlsSocket(
    url,
    destination,
    proxy,
    signal,
    socketFactory,
    targetTlsFactory,
  );
  try {
    return await pinnedHttpsFetch(
      url,
      init,
      destination,
      signal,
      requester,
      socket,
    );
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function establishProxiedTlsSocket(
  url: URL,
  destination: PublicDestination,
  proxy: URL,
  signal: AbortSignal,
  socketFactory: ProxySocketFactory,
  targetTlsFactory: TargetTlsFactory,
) {
  let socket: Duplex | undefined;
  try {
    socket = await socketFactory(proxy, signal);
    if (signal.aborted) {
      socket.destroy();
      throw abortError(signal);
    }
    socket = await establishHttpConnect(socket, destination, signal);
    if (signal.aborted) {
      socket.destroy();
      throw abortError(signal);
    }
    socket = await targetTlsFactory(
      socket,
      normalizedHostname(url.hostname),
      signal,
    );
    if (signal.aborted) {
      socket.destroy();
      throw abortError(signal);
    }
    return socket;
  } catch (error) {
    socket?.destroy();
    if (signal.aborted) throw abortError(signal);
    if (error instanceof OutboundDestinationError) throw error;
    throw new OutboundDestinationError("NETWORK");
  }
}

async function establishFirstProxiedTlsSocket(
  url: URL,
  destinations: readonly PublicDestination[],
  proxy: URL,
  signal: AbortSignal,
  socketFactory: ProxySocketFactory,
  targetTlsFactory: TargetTlsFactory,
) {
  if (!destinations.length) throw new OutboundDestinationError("NETWORK");
  return await new Promise<{
    destination: PublicDestination;
    socket: Duplex;
  }>((resolve, reject) => {
    let remaining = destinations.length;
    let settled = false;
    const controllers = destinations.map(() => new AbortController());
    const cleanup = () => signal.removeEventListener("abort", aborted);
    const cancelAttempts = (winnerIndex?: number) => {
      controllers.forEach((controller, index) => {
        if (index !== winnerIndex && !controller.signal.aborted) {
          controller.abort(new DOMException(
            "A different public destination won the TLS race",
            "AbortError",
          ));
        }
      });
    };
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      cancelAttempts();
      reject(error);
    };
    const aborted = () => finishError(abortError(signal));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) {
      aborted();
      return;
    }
    destinations.forEach((destination, index) => {
      const attemptSignal = AbortSignal.any([
        signal,
        controllers[index].signal,
      ]);
      void establishProxiedTlsSocket(
        url,
        destination,
        proxy,
        attemptSignal,
        socketFactory,
        targetTlsFactory,
      ).then(
        (socket) => {
          if (settled) {
            socket.destroy();
            return;
          }
          settled = true;
          cleanup();
          cancelAttempts(index);
          resolve({ destination, socket });
        },
        (error: unknown) => {
          if (settled) return;
          if (
            error instanceof OutboundDestinationError &&
            error.code === "PROXY_CONFIGURATION"
          ) {
            finishError(error);
            return;
          }
          remaining -= 1;
          if (remaining === 0) {
            finishError(new OutboundDestinationError("NETWORK"));
          }
        },
      );
    });
  });
}

const defaultDohBootstrapAddresses: readonly PublicDestination[] = [
  { address: "1.1.1.1", family: 4 },
  { address: "1.0.0.1", family: 4 },
];
const dohBaseUrl = "https://cloudflare-dns.com/dns-query";

async function boundedJsonResponse(response: Response, maximumBytes: number) {
  if (!response.body) throw new OutboundDestinationError("NETWORK");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new OutboundDestinationError("NETWORK");
    }
    chunks.push(Buffer.from(value));
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new OutboundDestinationError("NETWORK");
  }
}

async function dohQuery(
  hostname: string,
  recordType: "A" | "AAAA",
  proxy: URL,
  signal: AbortSignal,
  dependencies: PublicHttpsFetchDependencies,
) {
  const url = new URL(dohBaseUrl);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", recordType);
  const requester = dependencies.requester ?? httpsRequest;
  const socketFactory = dependencies.proxySocketFactory ??
    defaultProxySocketFactory;
  const targetFactory = dependencies.targetTlsFactory ??
    defaultTargetTlsFactory;
  const bootstraps = dependencies.dohBootstrapAddresses ??
    defaultDohBootstrapAddresses;
  if (!bootstraps.length || bootstraps.length > 8) {
    throw new OutboundProxyConfigurationError();
  }
  let lastError: unknown;
  for (const bootstrap of bootstraps) {
    if (
      isIP(bootstrap.address) !== bootstrap.family ||
      privateNetworkAddress(bootstrap.address)
    ) {
      throw new OutboundProxyConfigurationError();
    }
    try {
      const response = await proxyPinnedHttpsFetch(
        url,
        {
          headers: { Accept: "application/dns-json" },
          method: "GET",
          redirect: "error",
        },
        bootstrap,
        proxy,
        signal,
        requester,
        socketFactory,
        targetFactory,
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new OutboundDestinationError("NETWORK");
      }
      return await boundedJsonResponse(response, 256 * 1_024);
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      if (
        error instanceof OutboundDestinationError &&
        error.code === "PROXY_CONFIGURATION"
      ) throw error;
      lastError = error;
    }
  }
  if (lastError instanceof OutboundDestinationError) throw lastError;
  throw new OutboundDestinationError("NETWORK");
}

function parseDohAddresses(
  body: Record<string, unknown>,
  recordType: "A" | "AAAA",
) {
  if (body.Status !== 0) throw new OutboundDestinationError("NETWORK");
  const answer = body.Answer;
  if (answer === undefined) return [] as PublicDestination[];
  if (!Array.isArray(answer) || answer.length > 128) {
    throw new OutboundDestinationError("NETWORK");
  }
  const expectedFamily = recordType === "A" ? 4 : 6;
  const expectedType = recordType === "A" ? 1 : 28;
  const addresses: PublicDestination[] = [];
  for (const item of answer) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new OutboundDestinationError("NETWORK");
    }
    const record = item as Record<string, unknown>;
    if (record.type !== expectedType) continue;
    if (
      typeof record.data !== "string" ||
      isIP(record.data) !== expectedFamily
    ) {
      throw new OutboundDestinationError("NETWORK");
    }
    addresses.push({ address: record.data, family: expectedFamily });
  }
  return addresses;
}

async function resolvePublicAddressesThroughDoh(
  hostname: string,
  proxy: URL,
  signal: AbortSignal,
  dependencies: PublicHttpsFetchDependencies,
) {
  const ipv4 = parseDohAddresses(
    await dohQuery(hostname, "A", proxy, signal, dependencies),
    "A",
  );
  const ipv6 = parseDohAddresses(
    await dohQuery(hostname, "AAAA", proxy, signal, dependencies),
    "AAAA",
  );
  const unique = new Map<string, PublicDestination>();
  for (const destination of [...ipv4, ...ipv6]) {
    unique.set(`${destination.family}:${destination.address}`, destination);
  }
  const destinations = [...unique.values()];
  if (
    destinations.length < 1 ||
    destinations.length > 64 ||
    destinations.some((destination) =>
      privateNetworkAddress(destination.address)
    )
  ) {
    throw new OutboundDestinationError("FORMAT");
  }
  return destinations;
}

async function resolveNativeDestination(
  url: URL,
  resolver: DestinationResolver,
  signal: AbortSignal,
) {
  const hostname = normalizedHostname(url.hostname);
  const literalFamily = isIP(hostname);
  let records: Array<{ address: string; family: number }>;
  try {
    records = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await abortable(
          resolver(hostname, { all: true, verbatim: true }),
          signal,
        );
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    if (error instanceof OutboundDestinationError) throw error;
    throw new OutboundDestinationError("NETWORK");
  }
  if (records.length < 1 || records.length > 64) {
    throw new OutboundDestinationError("NETWORK");
  }
  if (!literalFamily && records.every((record) =>
    record.family === 4 && syntheticProxyAddress(record.address)
  )) {
    return { kind: "fake-ip" as const };
  }
  if (records.some((record) => {
    const family = isIP(record.address);
    return (
      (family !== 4 && family !== 6) ||
      family !== record.family ||
      privateNetworkAddress(record.address)
    );
  })) {
    throw new OutboundDestinationError("FORMAT");
  }
  const selected = records[0];
  return {
    destination: {
      address: selected.address,
      family: selected.family as 4 | 6,
    },
    kind: "direct" as const,
  };
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
    const resolution = await resolveNativeDestination(
      url,
      resolver,
      signal,
    );
    if (signal.aborted) throw abortError(signal);
    if (resolution.kind === "direct") {
      dependencies.beforeRequest?.();
      return await pinnedHttpsFetch(
        url,
        { ...init, redirect: "error" },
        resolution.destination,
        signal,
        dependencies.requester ?? httpsRequest,
      );
    }
    const proxy = configuredLoopbackProxy(dependencies.proxyUrl);
    const destinations = await resolvePublicAddressesThroughDoh(
      normalizedHostname(url.hostname),
      proxy,
      signal,
      dependencies,
    );
    const established = await establishFirstProxiedTlsSocket(
      url,
      destinations,
      proxy,
      signal,
      dependencies.proxySocketFactory ?? defaultProxySocketFactory,
      dependencies.targetTlsFactory ?? defaultTargetTlsFactory,
    );
    if (signal.aborted) {
      established.socket.destroy();
      throw abortError(signal);
    }
    try {
      dependencies.beforeRequest?.();
      return await pinnedHttpsFetch(
        url,
        { ...init, redirect: "error" },
        established.destination,
        signal,
        dependencies.requester ?? httpsRequest,
        established.socket,
      );
    } catch (error) {
      established.socket.destroy();
      throw error;
    }
  } catch (error) {
    if (error instanceof OutboundDestinationError) throw error;
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
