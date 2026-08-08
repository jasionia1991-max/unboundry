import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { appendFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

const FORBIDDEN_PORT = 4173;
const BLOCKED_EXIT_CODE = 86;
const auditFile = process.env.UNBOUNDRY_TEST_NETWORK_AUDIT;
const initialAllowedPorts = new Set();
const registeredPortCounts = new Map();
const registeredOwnerPorts = new WeakMap();
const pendingPortRegistrations = new WeakSet();

if (process.env.UNBOUNDRY_SAFE_TEST !== "1" || !auditFile) {
  throw new Error(
    "offline-network-guard.mjs may only run through scripts/run-safe-tests.mjs",
  );
}

function audit(event, details = {}) {
  appendFileSync(
    auditFile,
    `${JSON.stringify({ event, pid: process.pid, ...details })}\n`,
    { encoding: "utf8", flag: "a" },
  );
}

function normalizedHost(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw.startsWith("[") && raw.endsWith("]")
    ? raw.slice(1, -1)
    : raw;
}

function isIpv6Loopback(host) {
  try {
    return new URL(`http://[${host}]/`).hostname === "[::1]";
  } catch {
    return false;
  }
}

function isLoopbackHost(value) {
  const host = normalizedHost(value);
  if (host === "localhost") return true;
  const family = net.isIP(host);
  if (family === 4) return Number(host.split(".")[0]) === 127;
  return family === 6 && isIpv6Loopback(host);
}

function safePort(value, fallback, kind, host) {
  const candidate = value === undefined || value === null || value === ""
    ? fallback
    : value;
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    blocked(kind, host, candidate, "invalid_port");
  }
  return port;
}

function blocked(kind, host, port, reason = "non_loopback") {
  if (!process.exitCode) process.exitCode = BLOCKED_EXIT_CODE;
  const details = {
    host: normalizedHost(host) || null,
    kind,
    port: Number.isFinite(Number(port)) ? Number(port) : null,
    reason,
  };
  audit("node_network_blocked", details);
  const error = new Error(
    `[offline-network] blocked ${kind} ${details.host ?? "unknown"}:${
      details.port ?? ""
    } (${reason})`,
  );
  error.code = "UNBOUNDRY_OFFLINE_NETWORK_BLOCKED";
  error.kind = kind;
  error.reason = reason;
  throw error;
}

function loadInitialAllowedPorts() {
  for (const name of ["UNBOUNDRY_TEST_PORT", "UNBOUNDRY_TEST_AUX_PORT"]) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    const port = safePort(raw, undefined, `guard.${name}`, "localhost");
    if (port === 0) {
      blocked(`guard.${name}`, "localhost", port, "invalid_initial_port");
    }
    if (port === FORBIDDEN_PORT) {
      blocked(`guard.${name}`, "localhost", port, "forbidden_port");
    }
    initialAllowedPorts.add(port);
  }
}

function isAllowedLoopbackPort(port) {
  return initialAllowedPorts.has(port) || (registeredPortCounts.get(port) ?? 0) > 0;
}

function registerOwnerPort(owner, kind) {
  const address = owner.address();
  if (!address || typeof address === "string") {
    blockUnixSocket(kind);
  }
  const target = assertLoopbackTarget(kind, address.address, address.port, {
    allowUnregisteredPort: true,
  });
  const previous = registeredOwnerPorts.get(owner);
  if (previous !== undefined) releaseOwnerPort(owner, kind);
  registeredOwnerPorts.set(owner, target.port);
  registeredPortCounts.set(
    target.port,
    (registeredPortCounts.get(target.port) ?? 0) + 1,
  );
  audit("node_loopback_port_registered", {
    kind,
    port: target.port,
  });
  owner.once("close", () => releaseOwnerPort(owner, kind));
}

function releaseOwnerPort(owner, kind) {
  const port = registeredOwnerPorts.get(owner);
  if (port === undefined) return;
  registeredOwnerPorts.delete(owner);
  const remaining = (registeredPortCounts.get(port) ?? 1) - 1;
  if (remaining > 0) registeredPortCounts.set(port, remaining);
  else registeredPortCounts.delete(port);
  audit("node_loopback_port_unregistered", { kind, port });
}

function armPortRegistration(owner, kind) {
  if (pendingPortRegistrations.has(owner) || registeredOwnerPorts.has(owner)) return;
  pendingPortRegistrations.add(owner);
  owner.once("listening", () => {
    pendingPortRegistrations.delete(owner);
    try {
      registerOwnerPort(owner, kind);
    } catch (error) {
      try {
        owner.close();
      } catch {}
      throw error;
    }
  });
}

loadInitialAllowedPorts();

function assertLoopbackTarget(
  kind,
  host,
  port,
  {
    allowUnregisteredPort = false,
    defaultHost = "localhost",
    defaultPort,
  } = {},
) {
  const targetHost = normalizedHost(host || defaultHost);
  const targetPort = safePort(port, defaultPort, kind, targetHost);
  if (targetPort === FORBIDDEN_PORT) {
    blocked(kind, targetHost, targetPort, "forbidden_port");
  }
  if (!isLoopbackHost(targetHost)) {
    blocked(kind, targetHost, targetPort, "non_loopback");
  }
  if (!allowUnregisteredPort && !isAllowedLoopbackPort(targetPort)) {
    blocked(kind, targetHost, targetPort, "unregistered_loopback_port");
  }
  return { host: targetHost, port: targetPort };
}

function assertLoopbackLocalAddress(kind, value) {
  if (value !== undefined && value !== null && value !== "" && !isLoopbackHost(value)) {
    blocked(kind, value, undefined, "non_loopback_local_address");
  }
}

function assertSafeLocalBinding(kind, options) {
  assertLoopbackLocalAddress(kind, options?.localAddress);
  if (options?.localPort !== undefined) {
    const localPort = safePort(
      options.localPort,
      undefined,
      `${kind}.localPort`,
      options.localAddress ?? "localhost",
    );
    if (localPort === FORBIDDEN_PORT) {
      blocked(
        `${kind}.localPort`,
        options.localAddress ?? "localhost",
        localPort,
        "forbidden_port",
      );
    }
  }
}

function blockUnixSocket(kind) {
  blocked(kind, "unix-socket", undefined, "unix_socket_forbidden");
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function validatedHostOption(kind, options, key) {
  if (!hasOwn(options, key)) return undefined;
  const value = options[key];
  if (typeof value !== "string" || value.trim() === "") {
    blocked(kind, key, undefined, "invalid_host_override");
  }
  if (!isLoopbackHost(value)) {
    blocked(kind, value, undefined, "non_loopback_host_override");
  }
  return value;
}

function assertNoCustomLookup(kind, options, allowed = []) {
  if (
    options &&
    typeof options.lookup === "function" &&
    !allowed.includes(options.lookup)
  ) {
    blocked(kind, "custom-lookup", undefined, "custom_lookup_forbidden");
  }
}

function assertNoCustomConnection(kind, options) {
  if (options && typeof options.createConnection === "function") {
    blocked(
      kind,
      "custom-connection",
      undefined,
      "custom_connection_forbidden",
    );
  }
  if (options?.socket) {
    blocked(kind, "preconnected-socket", undefined, "socket_forbidden");
  }
  if (options?.fd !== undefined || options?.handle !== undefined) {
    blocked(kind, "inherited-handle", undefined, "handle_forbidden");
  }
}

function assertLookupResult(kind, result) {
  const entries = Array.isArray(result) ? result : [result];
  for (const entry of entries) {
    const address = typeof entry === "string" ? entry : entry?.address;
    if (!address || !isLoopbackHost(address)) {
      blocked(kind, address ?? "unknown", undefined, "dns_result_non_loopback");
    }
  }
}

// DNS lookup is permitted only for an already-loopback literal or localhost.
// Resolver/resolve/reverse APIs always emit DNS traffic, so they are blocked.
const originalDnsLookup = dns.lookup;
dns.lookup = function guardedDnsLookup(hostname, ...args) {
  if (!isLoopbackHost(hostname)) {
    blocked("dns.lookup", hostname, undefined, "dns_name_non_loopback");
  }
  const callbackIndex = args.findLastIndex((value) => typeof value === "function");
  if (callbackIndex >= 0) {
    const callback = args[callbackIndex];
    args[callbackIndex] = (error, address, family) => {
      if (error) return callback(error, address, family);
      try {
        assertLookupResult("dns.lookup.result", address);
      } catch (guardError) {
        return callback(guardError);
      }
      return callback(null, address, family);
    };
  }
  return Reflect.apply(originalDnsLookup, this, [hostname, ...args]);
};

const promiseDnsApis = [...new Set([dns.promises, dnsPromises])];
for (const api of promiseDnsApis) {
  const originalLookup = api.lookup;
  api.lookup = async function guardedDnsPromisesLookup(hostname, ...args) {
    if (!isLoopbackHost(hostname)) {
      blocked(
        "dns.promises.lookup",
        hostname,
        undefined,
        "dns_name_non_loopback",
      );
    }
    const result = await Reflect.apply(originalLookup, this, [hostname, ...args]);
    assertLookupResult("dns.promises.lookup.result", result);
    return result;
  };
}

function installAlwaysBlockedMethod(target, name, kind) {
  if (!target || typeof target[name] !== "function") return;
  target[name] = function guardedDnsResolverMethod(...args) {
    const host = typeof args[0] === "string" ? args[0] : "dns-query";
    blocked(kind, host, undefined, "raw_dns_forbidden");
  };
}

const dnsQueryMethods = [
  "lookupService",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
  "reverse",
];
for (const method of dnsQueryMethods) {
  installAlwaysBlockedMethod(dns, method, `dns.${method}`);
  for (const api of promiseDnsApis) {
    installAlwaysBlockedMethod(api, method, `dns.promises.${method}`);
  }
}

const resolverPrototypes = [...new Set([
  dns.Resolver?.prototype,
  ...promiseDnsApis.map((api) => api.Resolver?.prototype),
])].filter(Boolean);
for (const prototype of resolverPrototypes) {
  for (const method of Object.getOwnPropertyNames(prototype)) {
    if (method === "constructor" || method === "cancel" || method === "setLocalAddress") {
      continue;
    }
    if (method === "setServers") continue;
    if (/^(?:resolve|reverse|lookupService)/.test(method)) {
      installAlwaysBlockedMethod(prototype, method, `dns.Resolver.${method}`);
    }
  }
}

function netConnectionTarget(args) {
  const first = args[0];
  if (Array.isArray(first)) return netConnectionTarget(first);
  if (typeof first === "string" && !/^\d+$/.test(first)) {
    return { path: first };
  }
  if (
    typeof first === "number" ||
    (typeof first === "string" && /^\d+$/.test(first))
  ) {
    return {
      host: typeof args[1] === "string" ? args[1] : "localhost",
      options: {},
      port: first,
    };
  }
  if (first && typeof first === "object") {
    if (typeof first.path === "string") return { path: first.path, options: first };
    return {
      host: first.host ?? "localhost",
      options: first,
      port: first.port,
    };
  }
  return { host: "invalid", options: {}, port: undefined };
}

function assertNetConnection(kind, args) {
  const target = netConnectionTarget(args);
  if (target.path) blockUnixSocket(kind);
  assertNoCustomLookup(kind, target.options, [originalDnsLookup, dns.lookup]);
  assertNoCustomConnection(kind, target.options);
  assertSafeLocalBinding(kind, target.options);
  return assertLoopbackTarget(kind, target.host, target.port);
}

const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  assertNetConnection("net.Socket.connect", args);
  return Reflect.apply(originalSocketConnect, this, args);
};

const originalCreateConnection = net.createConnection;
net.createConnection = function guardedCreateConnection(...args) {
  assertNetConnection("net.createConnection", args);
  return Reflect.apply(originalCreateConnection, this, args);
};
const originalNetConnect = net.connect;
net.connect = function guardedNetConnect(...args) {
  assertNetConnection("net.connect", args);
  return Reflect.apply(originalNetConnect, this, args);
};

function serverListenTarget(args) {
  const first = args[0];
  if (typeof first === "string") return { path: first };
  if (typeof first === "number") {
    return {
      explicitHost: typeof args[1] === "string",
      host: typeof args[1] === "string" ? args[1] : undefined,
      port: first,
    };
  }
  if (first && typeof first === "object") {
    if (
      typeof first.path === "string" ||
      first.fd !== undefined ||
      first.handle !== undefined
    ) {
      return { path: first.path ?? "inherited-handle" };
    }
    return {
      explicitHost: typeof first.host === "string" && first.host.trim() !== "",
      host: first.host,
      port: first.port,
    };
  }
  return { explicitHost: false, host: undefined, port: undefined };
}

const originalServerListen = net.Server.prototype.listen;
net.Server.prototype.listen = function guardedServerListen(...args) {
  const target = serverListenTarget(args);
  if (target.path) blockUnixSocket("net.Server.listen");
  if (!target.explicitHost) {
    blocked(
      "net.Server.listen",
      "unspecified",
      target.port,
      "explicit_loopback_bind_required",
    );
  }
  assertLoopbackTarget("net.Server.listen", target.host, target.port, {
    allowUnregisteredPort: true,
  });
  armPortRegistration(this, "net.Server.listen");
  return Reflect.apply(originalServerListen, this, args);
};

function httpRequestTarget(args, protocol) {
  const first = args[0];
  let parsedUrl;
  let options = {};
  if (typeof first === "string" || first instanceof URL) {
    try {
      parsedUrl = new URL(first);
    } catch {
      blocked(`${protocol}.request`, "invalid-url", undefined, "invalid_url");
    }
    if (args[1] && typeof args[1] === "object") options = args[1];
  } else if (first && typeof first === "object") {
    options = first;
  } else {
    blocked(`${protocol}.request`, "invalid-options", undefined, "invalid_options");
  }

  if (options.socketPath !== undefined) blockUnixSocket(`${protocol}.request`);
  assertNoCustomLookup(`${protocol}.request`, options);
  assertNoCustomConnection(`${protocol}.request`, options);
  assertSafeLocalBinding(`${protocol}.request`, options);

  const expectedProtocol = `${protocol}:`;
  const requestedProtocol = hasOwn(options, "protocol")
    ? String(options.protocol)
    : parsedUrl?.protocol ?? expectedProtocol;
  if (requestedProtocol !== expectedProtocol) {
    blocked(`${protocol}.request`, requestedProtocol, undefined, "protocol_override");
  }

  const hostnameOverride = validatedHostOption(
    `${protocol}.request`,
    options,
    "hostname",
  );
  const hostOverride = validatedHostOption(
    `${protocol}.request`,
    options,
    "host",
  );
  const host = hostnameOverride ?? hostOverride ?? parsedUrl?.hostname ?? "localhost";
  const port = hasOwn(options, "port")
    ? options.port
    : parsedUrl?.port || (protocol === "https" ? 443 : 80);
  return { host, options, port };
}

function assertHttpRequest(kind, args, protocol) {
  const target = httpRequestTarget(args, protocol);
  // A local fake proxy may legitimately provide an Agent. Its eventual DNS,
  // TCP and TLS operations still pass through the guarded built-ins below and
  // the kernel sandbox, so rejecting the Agent object itself would only break
  // safe transport tests without adding an escape path.
  const defaultAgent = protocol === "https" ? https.globalAgent : http.globalAgent;
  if (
    target.options.agent &&
    target.options.agent !== defaultAgent
  ) {
    audit("node_logical_target_via_guarded_agent", {
      host: normalizedHost(target.host),
      kind,
      port: Number(target.port),
    });
    return { host: normalizedHost(target.host), port: Number(target.port) };
  }
  return assertLoopbackTarget(kind, target.host, target.port);
}

for (const [module, protocol] of [
  [http, "http"],
  [https, "https"],
]) {
  const originalRequest = module.request;
  module.request = function guardedRequest(...args) {
    assertHttpRequest(`${protocol}.request`, args, protocol);
    return Reflect.apply(originalRequest, this, args);
  };
  const originalGet = module.get;
  module.get = function guardedGet(...args) {
    assertHttpRequest(`${protocol}.get`, args, protocol);
    return Reflect.apply(originalGet, this, args);
  };
}

function tlsConnectionTarget(args) {
  const first = args[0];
  if (first && typeof first === "object") {
    return {
      host: validatedHostOption("tls.connect", first, "host") ?? "localhost",
      options: first,
      port: first.port,
    };
  }
  const base = {
    host: typeof args[1] === "string" ? args[1] : "localhost",
    port: first,
  };
  const optionsIndex = typeof args[1] === "string" ? 2 : 1;
  const options = args[optionsIndex] && typeof args[optionsIndex] === "object"
    ? args[optionsIndex]
    : {};
  return {
    host: validatedHostOption("tls.connect", options, "host") ?? base.host,
    options,
    port: hasOwn(options, "port") ? options.port : base.port,
  };
}

const originalTlsConnect = tls.connect;
tls.connect = function guardedTlsConnect(...args) {
  const target = tlsConnectionTarget(args);
  if (target.options.path !== undefined) blockUnixSocket("tls.connect");
  assertNoCustomLookup("tls.connect", target.options);
  assertNoCustomConnection("tls.connect", target.options);
  assertSafeLocalBinding("tls.connect", target.options);
  assertLoopbackTarget("tls.connect", target.host, target.port, {
    defaultPort: 443,
  });
  return Reflect.apply(originalTlsConnect, this, args);
};

const originalHttp2Connect = http2.connect;
http2.connect = function guardedHttp2Connect(authority, options, listener) {
  let target;
  try {
    target = authority instanceof URL ? authority : new URL(authority);
  } catch {
    blocked("http2.connect", "invalid-authority", undefined, "invalid_url");
  }
  const requestOptions = options && typeof options === "object" ? options : {};
  assertNoCustomLookup("http2.connect", requestOptions);
  assertNoCustomConnection("http2.connect", requestOptions);
  assertSafeLocalBinding("http2.connect", requestOptions);
  if (!new Set(["http:", "https:"]).has(target.protocol)) {
    blocked("http2.connect", target.hostname, target.port, "invalid_protocol");
  }
  assertLoopbackTarget(
    "http2.connect",
    target.hostname,
    target.port || (target.protocol === "https:" ? 443 : 80),
  );
  return Reflect.apply(originalHttp2Connect, this, [authority, options, listener]);
};

const udpTargets = new WeakMap();
const udpSafeBindRequested = new WeakSet();
const originalDgramCreateSocket = dgram.createSocket;
dgram.createSocket = function guardedDgramCreateSocket(options, callback) {
  if (options && typeof options === "object") {
    assertNoCustomLookup("dgram.createSocket", options);
  }
  return Reflect.apply(originalDgramCreateSocket, this, [options, callback]);
};

function dgramBindTarget(args) {
  const first = args[0];
  if (first && typeof first === "object") {
    if (first.fd !== undefined) return { path: "inherited-handle" };
    return {
      explicitHost:
        typeof first.address === "string" && first.address.trim() !== "",
      host: first.address,
      port: first.port ?? 0,
    };
  }
  return {
    explicitHost: typeof args[1] === "string" && args[1].trim() !== "",
    host: typeof args[1] === "string" ? args[1] : undefined,
    port: typeof first === "number" ? first : 0,
  };
}

const originalDgramBind = dgram.Socket.prototype.bind;
dgram.Socket.prototype.bind = function guardedDgramBind(...args) {
  const target = dgramBindTarget(args);
  if (target.path) blockUnixSocket("dgram.Socket.bind");
  if (!target.explicitHost) {
    blocked(
      "dgram.Socket.bind",
      "unspecified",
      target.port,
      "explicit_loopback_bind_required",
    );
  }
  assertLoopbackTarget("dgram.Socket.bind", target.host, target.port, {
    allowUnregisteredPort: true,
  });
  udpSafeBindRequested.add(this);
  armPortRegistration(this, "dgram.Socket.bind");
  return Reflect.apply(originalDgramBind, this, args);
};

const originalDgramConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function guardedDgramConnect(...args) {
  if (!udpSafeBindRequested.has(this)) {
    blocked(
      "dgram.Socket.connect",
      "unspecified",
      args[0],
      "explicit_loopback_bind_required",
    );
  }
  const port = args[0];
  const host = typeof args[1] === "string" ? args[1] : "localhost";
  const target = assertLoopbackTarget("dgram.Socket.connect", host, port);
  udpTargets.set(this, target);
  return Reflect.apply(originalDgramConnect, this, args);
};

function dgramSendTarget(socket, args) {
  const tail = args.slice(1);
  if (typeof tail.at(-1) === "function") tail.pop();
  if (tail.length === 0) return udpTargets.get(socket);
  if (typeof tail[0] !== "number") return undefined;
  if (
    tail.length >= 3 &&
    typeof tail[1] === "number" &&
    typeof tail[2] === "number"
  ) {
    return { host: typeof tail[3] === "string" ? tail[3] : "localhost", port: tail[2] };
  }
  return { host: typeof tail[1] === "string" ? tail[1] : "localhost", port: tail[0] };
}

const originalDgramSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedDgramSend(...args) {
  if (!udpSafeBindRequested.has(this)) {
    blocked(
      "dgram.Socket.send",
      "unspecified",
      undefined,
      "explicit_loopback_bind_required",
    );
  }
  const target = dgramSendTarget(this, args);
  if (!target) {
    blocked("dgram.Socket.send", "unknown", undefined, "missing_udp_target");
  }
  assertLoopbackTarget("dgram.Socket.send", target.host, target.port);
  return Reflect.apply(originalDgramSend, this, args);
};

for (const method of [
  "addMembership",
  "addSourceSpecificMembership",
  "dropMembership",
  "dropSourceSpecificMembership",
  "setMulticastInterface",
]) {
  const original = dgram.Socket.prototype[method];
  if (typeof original !== "function") continue;
  dgram.Socket.prototype[method] = function guardedMulticast(...args) {
    blocked(`dgram.Socket.${method}`, "multicast", undefined, "multicast_forbidden");
  };
}
const originalSetBroadcast = dgram.Socket.prototype.setBroadcast;
dgram.Socket.prototype.setBroadcast = function guardedSetBroadcast(value) {
  if (value) {
    blocked("dgram.Socket.setBroadcast", "broadcast", undefined, "broadcast_forbidden");
  }
  return Reflect.apply(originalSetBroadcast, this, [value]);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = function guardedFetch(input, init) {
  let url;
  try {
    url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
  } catch {
    blocked("fetch", "invalid-url", undefined, "invalid_url");
  }
  if (url.protocol === "data:" || url.protocol === "blob:") {
    return originalFetch(input, init);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    blocked("fetch", url.protocol, undefined, "invalid_protocol");
  }
  if (
    init?.dispatcher !== undefined ||
    init?.agent !== undefined ||
    init?.lookup !== undefined ||
    init?.createConnection !== undefined
  ) {
    blocked("fetch", url.hostname, url.port, "custom_transport_forbidden");
  }
  assertLoopbackTarget(
    "fetch",
    url.hostname,
    url.port || (url.protocol === "https:" ? 443 : 80),
  );
  return originalFetch(input, init);
};

syncBuiltinESMExports();
audit("node_guard_loaded", {
  initialAllowedPorts: [...initialAllowedPorts].sort((left, right) => left - right),
  node: process.versions.node,
});
