import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

const envelopeMode = "linux-bwrap-inherited-v1";
const hostNamespaceEvidencePath = "/run/unboundry-validation/host-namespaces.json";
const externalSelfTestHost = "192.0.2.1";
const externalSelfTestPort = 9;
const maximumSentinelBytes = 256;
const maximumHostNamespaceEvidenceBytes = 1024;
const maximumProcBytes = 1024 * 1024;
const noncePattern = /^[a-f0-9]{64}$/;
const environmentNames = Object.freeze([
  "UNBOUNDRY_LINUX_VALIDATION_HOST_NAMESPACE_SHA256",
  "UNBOUNDRY_LINUX_VALIDATION_NONCE",
  "UNBOUNDRY_LINUX_VALIDATION_SANDBOX",
  "UNBOUNDRY_LINUX_VALIDATION_SENTINEL",
]);

export class LinuxValidationSandboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LinuxValidationSandboxError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LinuxValidationSandboxError(code, message);
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail(
      "LINUX_VALIDATION_SANDBOX_UNAVAILABLE",
      "Linux validation sandbox ownership cannot be established",
    );
  }
  return BigInt(process.getuid());
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.uid === right.uid && left.mode === right.mode &&
    left.nlink === right.nlink && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function fixedPrivateSentinel(path, nonce) {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path) {
    fail(
      "LINUX_VALIDATION_SANDBOX_SENTINEL_INVALID",
      "Linux validation sandbox sentinel is not a canonical path",
    );
  }
  const parent = dirname(path);
  const parentDetails = lstatSync(parent, { bigint: true });
  if (
    realpathSync(parent) !== parent || !parentDetails.isDirectory() ||
    parentDetails.isSymbolicLink() || parentDetails.uid !== currentUid() ||
    (parentDetails.mode & 0o077n) !== 0n
  ) {
    fail(
      "LINUX_VALIDATION_SANDBOX_SENTINEL_INVALID",
      "Linux validation sandbox sentinel parent is not private",
    );
  }
  const lexical = lstatSync(path, { bigint: true });
  if (
    !lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1n ||
    lexical.uid !== currentUid() || (lexical.mode & 0o077n) !== 0n ||
    lexical.size < 64n || lexical.size > BigInt(maximumSentinelBytes)
  ) {
    fail(
      "LINUX_VALIDATION_SANDBOX_SENTINEL_INVALID",
      "Linux validation sandbox sentinel is not a private fixed file",
    );
  }
  const descriptor = openSync(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(lexical, before)) {
      fail(
        "LINUX_VALIDATION_SANDBOX_SENTINEL_CHANGED",
        "Linux validation sandbox sentinel changed before it was read",
      );
    }
    const buffer = Buffer.alloc(maximumSentinelBytes + 1);
    const bytesRead = readSync(
      descriptor,
      buffer,
      0,
      buffer.length,
      0,
    );
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(path, { bigint: true });
    if (
      bytesRead !== Number(before.size) || bytesRead > maximumSentinelBytes ||
      !sameFileIdentity(before, after) || !sameFileIdentity(before, pathAfter)
    ) {
      buffer.fill(0);
      fail(
        "LINUX_VALIDATION_SANDBOX_SENTINEL_CHANGED",
        "Linux validation sandbox sentinel changed while it was read",
      );
    }
    const value = buffer.subarray(0, bytesRead);
    const expected = Buffer.from(nonce, "utf8");
    const expectedWithNewline = Buffer.from(`${nonce}\n`, "utf8");
    const matches = value.equals(expected) || value.equals(expectedWithNewline);
    const sha256 = createHash("sha256").update(value).digest("hex");
    buffer.fill(0);
    expected.fill(0);
    expectedWithNewline.fill(0);
    if (!matches) {
      fail(
        "LINUX_VALIDATION_SANDBOX_SENTINEL_INVALID",
        "Linux validation sandbox sentinel does not match its nonce",
      );
    }
    return Object.freeze({ sha256 });
  } finally {
    closeSync(descriptor);
  }
}

function procDocument(path) {
  const value = readFileSync(path, "utf8");
  if (Buffer.byteLength(value, "utf8") > maximumProcBytes) {
    fail(
      "LINUX_VALIDATION_SANDBOX_PROC_INVALID",
      "Linux validation sandbox process evidence is oversized",
    );
  }
  return value;
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function fixedHostNamespaceEvidence(nonce, expectedSha256) {
  const path = hostNamespaceEvidencePath;
  let lexical;
  let parentDetails;
  let parentCanonical;
  let pathCanonical;
  try {
    parentCanonical = realpathSync(dirname(path));
    parentDetails = lstatSync(dirname(path), { bigint: true });
    pathCanonical = realpathSync(path);
    lexical = lstatSync(path, { bigint: true });
  } catch {
    fail(
      "LINUX_VALIDATION_SANDBOX_NAMESPACE_EVIDENCE_INVALID",
      "Linux validation host namespace evidence is unavailable",
    );
  }
  if (
    parentCanonical !== dirname(path) || !parentDetails.isDirectory() ||
    parentDetails.isSymbolicLink() || parentDetails.uid !== 0n ||
    (parentDetails.mode & 0o077n) !== 0n || pathCanonical !== path ||
    !lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1n ||
    lexical.uid !== 0n || (lexical.mode & 0o077n) !== 0n ||
    lexical.size < 1n ||
    lexical.size > BigInt(maximumHostNamespaceEvidenceBytes)
  ) {
    fail(
      "LINUX_VALIDATION_SANDBOX_NAMESPACE_EVIDENCE_INVALID",
      "Linux validation host namespace evidence is not a fixed private file",
    );
  }
  const descriptor = openSync(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(lexical, before)) {
      fail(
        "LINUX_VALIDATION_SANDBOX_NAMESPACE_EVIDENCE_CHANGED",
        "Linux validation host namespace evidence changed before it was read",
      );
    }
    const buffer = Buffer.alloc(maximumHostNamespaceEvidenceBytes + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(path, { bigint: true });
    if (
      bytesRead !== Number(before.size) ||
      bytesRead > maximumHostNamespaceEvidenceBytes ||
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(before, pathAfter)
    ) {
      buffer.fill(0);
      fail(
        "LINUX_VALIDATION_SANDBOX_NAMESPACE_EVIDENCE_CHANGED",
        "Linux validation host namespace evidence changed while it was read",
      );
    }
    let document;
    try {
      document = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    } catch {
      buffer.fill(0);
      fail(
        "LINUX_VALIDATION_SANDBOX_NAMESPACE_EVIDENCE_INVALID",
        "Linux validation host namespace evidence is not valid JSON",
      );
    }
    const sha256 = createHash("sha256")
      .update(buffer.subarray(0, bytesRead))
      .digest("hex");
    buffer.fill(0);
    const validNamespace = (value, kind) =>
      exactKeys(value, ["dev", "ino", "label"]) &&
      /^[0-9]+$/.test(String(value.dev ?? "")) &&
      /^[0-9]+$/.test(String(value.ino ?? "")) &&
      value.label === `${kind}:[${value.ino}]`;
    if (
      !exactKeys(document, ["format", "network", "nonce", "process", "version"]) ||
      document.format !== "unboundry-linux-host-namespace-evidence" ||
      document.version !== 1 || document.nonce !== nonce ||
      !noncePattern.test(expectedSha256) || sha256 !== expectedSha256 ||
      !validNamespace(document.network, "net") ||
      !validNamespace(document.process, "pid")
    ) {
      fail(
        "LINUX_VALIDATION_SANDBOX_NAMESPACE_EVIDENCE_INVALID",
        "Linux validation host namespace evidence does not match its contract",
      );
    }
    return Object.freeze({
      network: Object.freeze({ ...document.network }),
      process: Object.freeze({ ...document.process }),
      sha256,
    });
  } finally {
    closeSync(descriptor);
  }
}

function networkNamespaceEvidence(hostEvidence) {
  let current;
  let currentLabel;
  try {
    current = statSync("/proc/self/ns/net", { bigint: true });
    currentLabel = readlinkSync("/proc/self/ns/net", "utf8");
  } catch {
    fail(
      "LINUX_VALIDATION_SANDBOX_NETNS_INVALID",
      "Linux validation sandbox network namespace is unavailable",
    );
  }
  const namespacePattern = /^net:\[(\d+)\]$/;
  const currentMatch = namespacePattern.exec(currentLabel);
  if (
    !currentMatch || currentMatch[1] !== String(current.ino) ||
    hostEvidence.dev === String(current.dev) &&
      hostEvidence.ino === String(current.ino)
  ) {
    fail(
      "LINUX_VALIDATION_SANDBOX_NETNS_INVALID",
      "Linux validation sandbox did not enter a distinct network namespace",
    );
  }
  return Object.freeze({
    current: Object.freeze({ dev: String(current.dev), ino: String(current.ino) }),
    distinct: true,
    host: Object.freeze({ dev: hostEvidence.dev, ino: hostEvidence.ino }),
    hostEvidence: "injected-sha256-bound-json-v1",
  });
}

function processNamespaceEvidence(hostEvidence) {
  let current;
  let currentLabel;
  try {
    current = statSync("/proc/self/ns/pid", { bigint: true });
    currentLabel = readlinkSync("/proc/self/ns/pid", "utf8");
  } catch {
    fail(
      "LINUX_VALIDATION_SANDBOX_PIDNS_INVALID",
      "Linux validation sandbox process namespace is unavailable",
    );
  }
  const namespacePattern = /^pid:\[(\d+)\]$/;
  const currentMatch = namespacePattern.exec(currentLabel);
  const status = procDocument("/proc/self/status");
  const nspid = /^NSpid:\s+([0-9\s]+)$/m.exec(status)?.[1]
    ?.trim().split(/\s+/).map(Number);
  if (
    !currentMatch || currentMatch[1] !== String(current.ino) ||
    hostEvidence.dev === String(current.dev) &&
      hostEvidence.ino === String(current.ino) ||
    !Array.isArray(nspid) || nspid.length < 1 ||
    nspid.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    nspid.at(-1) !== process.pid
  ) {
    fail(
      "LINUX_VALIDATION_SANDBOX_PIDNS_INVALID",
      "Linux validation sandbox did not enter a distinct process namespace",
    );
  }
  return Object.freeze({
    current: Object.freeze({ dev: String(current.dev), ino: String(current.ino) }),
    distinct: true,
    host: Object.freeze({ dev: hostEvidence.dev, ino: hostEvidence.ino }),
    hostEvidence: "injected-sha256-bound-json-v1",
    nspid: Object.freeze(nspid),
  });
}

function capabilityEvidence() {
  const status = procDocument("/proc/self/status");
  const capabilityNames = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"];
  const sets = {};
  for (const name of capabilityNames) {
    const matches = [
      ...status.matchAll(new RegExp(`^${name}:\\s*([a-fA-F0-9]+)\\s*$`, "gm")),
    ];
    if (matches.length !== 1 || BigInt(`0x${matches[0][1]}`) !== 0n) {
      fail(
        "LINUX_VALIDATION_SANDBOX_CAPABILITY_INVALID",
        "Linux validation sandbox retained a capability",
      );
    }
    sets[name] = matches[0][1].toLowerCase();
  }
  const noNewPrivileges = [...status.matchAll(/^NoNewPrivs:\s*([01])\s*$/gm)];
  if (noNewPrivileges.length !== 1 || noNewPrivileges[0][1] !== "1") {
    fail(
      "LINUX_VALIDATION_SANDBOX_CAPABILITY_INVALID",
      "Linux validation sandbox can regain privileges across exec",
    );
  }
  return Object.freeze({
    allSetsEmpty: true,
    noNewPrivileges: true,
    sets: Object.freeze(sets),
  });
}

function interfaceEvidence() {
  const interfaces = networkInterfaces();
  const names = Object.keys(interfaces).sort();
  const loopback = interfaces.lo;
  if (
    JSON.stringify(names) !== JSON.stringify(["lo"]) ||
    !Array.isArray(loopback) || loopback.length < 1 ||
    loopback.some((entry) =>
      entry.internal !== true ||
      (entry.address !== "127.0.0.1" && entry.address !== "::1")
    )
  ) {
    fail(
      "LINUX_VALIDATION_SANDBOX_INTERFACE_INVALID",
      "Linux validation sandbox exposes a non-loopback interface",
    );
  }
  return Object.freeze({
    addresses: Object.freeze(loopback.map(({ address }) => address).sort()),
    names: Object.freeze(names),
    onlyLoopback: true,
  });
}

function routeEvidence() {
  const ipv4Lines = procDocument("/proc/net/route")
    .trim().split("\n").filter(Boolean);
  const ipv6Lines = procDocument("/proc/net/ipv6_route")
    .trim().split("\n").filter(Boolean);
  let rejectedDefaultRoutes = 0;
  let loopbackRouteRecords = 0;
  for (const line of ipv4Lines.slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 8) {
      fail(
        "LINUX_VALIDATION_SANDBOX_ROUTE_INVALID",
        "Linux validation sandbox IPv4 route evidence is malformed",
      );
    }
    const [name, destination, gateway, flagsSource] = fields;
    const flags = Number.parseInt(flagsSource, 16);
    const rejected = Number.isInteger(flags) && (flags & 0x0200) !== 0;
    if (
      name !== "lo" || !/^[a-fA-F0-9]{8}$/.test(destination) ||
      gateway !== "00000000" || destination === "00000000" && !rejected
    ) {
      fail(
        "LINUX_VALIDATION_SANDBOX_ROUTE_INVALID",
        "Linux validation sandbox exposes a usable IPv4 route",
      );
    }
    if (destination === "00000000") rejectedDefaultRoutes += 1;
    else loopbackRouteRecords += 1;
  }
  for (const line of ipv6Lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) {
      fail(
        "LINUX_VALIDATION_SANDBOX_ROUTE_INVALID",
        "Linux validation sandbox IPv6 route evidence is malformed",
      );
    }
    const [destination, prefixLength, , , gateway] = fields;
    const flags = Number.parseInt(fields[8], 16);
    const name = fields[9];
    const defaultRoute = /^0{32}$/.test(destination) && prefixLength === "00";
    const rejected = Number.isInteger(flags) && (flags & 0x0200) !== 0;
    if (
      name !== "lo" || !/^[a-fA-F0-9]{32}$/.test(destination) ||
      !/^[a-fA-F0-9]{2}$/.test(prefixLength) ||
      !/^0{32}$/.test(gateway) || defaultRoute && !rejected
    ) {
      fail(
        "LINUX_VALIDATION_SANDBOX_ROUTE_INVALID",
        "Linux validation sandbox exposes a usable IPv6 route",
      );
    }
    if (defaultRoute) rejectedDefaultRoutes += 1;
    else loopbackRouteRecords += 1;
  }
  return Object.freeze({
    externalRouteRecords: 0,
    loopbackRouteRecords,
    rejectedDefaultRoutes,
    usableDefaultRoutes: 0,
  });
}

async function externalSelfTest() {
  const outcome = await new Promise((resolveOutcome) => {
    let settled = false;
    let socket;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolveOutcome(value);
    };
    const timer = setTimeout(() => finish("TIMEOUT"), 1_000);
    try {
      socket = connect({ host: externalSelfTestHost, port: externalSelfTestPort });
      socket.once("connect", () => finish("CONNECTED"));
      socket.once("error", (error) => finish(String(error?.code ?? "UNKNOWN")));
    } catch (error) {
      finish(String(error?.code ?? "UNKNOWN"));
    }
  });
  if (!new Set([
    "EACCES",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETUNREACH",
    "EPERM",
  ]).has(outcome)) {
    fail(
      "LINUX_VALIDATION_SANDBOX_NETWORK_INVALID",
      "Linux validation sandbox external socket self-test was not denied",
    );
  }
  return Object.freeze({
    denied: true,
    host: externalSelfTestHost,
    outcome,
    port: externalSelfTestPort,
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function loopbackSelfTest() {
  const server = createServer((socket) => socket.end());
  try {
    await new Promise((resolveListen, rejectListen) => {
      const onError = (error) => {
        server.off("listening", onListening);
        rejectListen(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolveListen();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ exclusive: true, host: "127.0.0.1", port: 0 });
    });
    const address = server.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
      fail(
        "LINUX_VALIDATION_SANDBOX_LOOPBACK_INVALID",
        "Linux validation sandbox could not reserve a loopback listener",
      );
    }
    await new Promise((resolveConnect, rejectConnect) => {
      let settled = false;
      const socket = connect({ host: "127.0.0.1", port: address.port });
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) rejectConnect(error);
        else resolveConnect();
      };
      const timer = setTimeout(
        () => finish(new Error("Loopback self-test timed out")),
        1_000,
      );
      socket.once("connect", () => finish());
      socket.once("error", finish);
    });
    return Object.freeze({ address: "127.0.0.1", connected: true });
  } catch (error) {
    if (error instanceof LinuxValidationSandboxError) throw error;
    fail(
      "LINUX_VALIDATION_SANDBOX_LOOPBACK_INVALID",
      "Linux validation sandbox loopback self-test failed",
    );
  } finally {
    await closeServer(server).catch(() => {});
  }
}

async function inspectInheritedSandbox() {
  if (process.platform !== "linux") {
    fail(
      "LINUX_VALIDATION_SANDBOX_UNAVAILABLE",
      "Inherited Linux validation sandbox requires Linux",
    );
  }
  const mode = String(
    process.env.UNBOUNDRY_LINUX_VALIDATION_SANDBOX ?? "",
  );
  const nonce = String(process.env.UNBOUNDRY_LINUX_VALIDATION_NONCE ?? "");
  const hostNamespaceSha256 = String(
    process.env.UNBOUNDRY_LINUX_VALIDATION_HOST_NAMESPACE_SHA256 ?? "",
  );
  const sentinelPath = String(
    process.env.UNBOUNDRY_LINUX_VALIDATION_SENTINEL ?? "",
  );
  if (
    mode !== envelopeMode || !noncePattern.test(nonce) ||
    !noncePattern.test(hostNamespaceSha256) || !sentinelPath
  ) {
    fail(
      "LINUX_VALIDATION_SANDBOX_ENVIRONMENT_INVALID",
      "Inherited Linux validation sandbox environment is incomplete",
    );
  }
  let sentinel;
  let namespaces;
  let capabilities;
  let interfaces;
  let routes;
  try {
    sentinel = fixedPrivateSentinel(sentinelPath, nonce);
    const hostNamespaces = fixedHostNamespaceEvidence(
      nonce,
      hostNamespaceSha256,
    );
    const network = networkNamespaceEvidence(hostNamespaces.network);
    const process = processNamespaceEvidence(hostNamespaces.process);
    namespaces = Object.freeze({
      distinct: true,
      hostEvidenceSha256: hostNamespaces.sha256,
      network,
      process,
    });
    capabilities = capabilityEvidence();
    interfaces = interfaceEvidence();
    routes = routeEvidence();
  } catch (error) {
    if (error instanceof LinuxValidationSandboxError) throw error;
    fail(
      "LINUX_VALIDATION_SANDBOX_INVALID",
      "Inherited Linux validation sandbox evidence could not be authenticated",
    );
  }
  const external = await externalSelfTest();
  const loopback = await loopbackSelfTest();
  return Object.freeze({
    capabilities,
    contract: "unboundry-linux-validation-sandbox-v1",
    enforcementMode: envelopeMode,
    external,
    interfaces,
    loopback,
    namespaces,
    processTreeEnforced: true,
    routes,
    sentinelSha256: sentinel.sha256,
  });
}

let inheritedSandboxPromise;

export async function authenticateInheritedLinuxValidationSandbox() {
  const present = environmentNames.filter((name) =>
    process.env[name] !== undefined
  );
  if (present.length === 0) return undefined;
  if (present.length !== environmentNames.length) {
    fail(
      "LINUX_VALIDATION_SANDBOX_ENVIRONMENT_INVALID",
      "Inherited Linux validation sandbox environment is partial",
    );
  }
  inheritedSandboxPromise ??= inspectInheritedSandbox();
  return await inheritedSandboxPromise;
}
