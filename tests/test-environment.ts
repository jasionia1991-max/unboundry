import { appendFileSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const REQUIRED_NODE_VERSION = "22.23.1";
const FORBIDDEN_PORT = 4173;

function fail(message: string): never {
  throw new Error(`[safe-test] ${message}`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required; use scripts/run-safe-tests.mjs`);
  return value;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function parsePort(name: string): number {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    fail(`${name} must be a valid TCP port`);
  }
  if (value === FORBIDDEN_PORT) fail(`${name} must never be ${FORBIDDEN_PORT}`);
  return value;
}

export type SafeTestEnvironment = {
  auxiliaryPort: number;
  auditFile: string;
  dataDirectory: string;
  port: number;
  originalRepositoryRoot: string;
  repositoryRoot: string;
  testRoot: string;
};

let cachedEnvironment: SafeTestEnvironment | undefined;

export function safeTestEnvironment(): SafeTestEnvironment {
  if (cachedEnvironment) return cachedEnvironment;
  if (process.env.UNBOUNDRY_SAFE_TEST !== "1") {
    fail("UNBOUNDRY_SAFE_TEST=1 is missing; legacy/default test entry points are frozen");
  }
  if (process.versions.node !== REQUIRED_NODE_VERSION) {
    fail(`Node ${REQUIRED_NODE_VERSION} is required, got ${process.versions.node}`);
  }

  const repositoryRoot = realpathSync(required("UNBOUNDRY_TEST_REPOSITORY_ROOT"));
  // This path is resolved and injected by the parent supervisor. Do not call
  // realpath/stat on it inside the sandbox: successful metadata access to the
  // original repository is itself forbidden evidence.
  const originalRepositoryRoot = resolve(
    required("UNBOUNDRY_ORIGINAL_REPOSITORY_ROOT"),
  );
  const systemTemporaryRoot = realpathSync(
    required("UNBOUNDRY_SYSTEM_TEMPORARY_ROOT"),
  );
  const testRoot = realpathSync(required("UNBOUNDRY_TEST_ROOT"));
  const dataDirectory = realpathSync(required("UNBOUNDRY_DATA_DIR"));
  const auditFile = realpathSync(resolve(required("UNBOUNDRY_TEST_NETWORK_AUDIT")));
  const sentinel = realpathSync(required("UNBOUNDRY_SAFE_RUN_SENTINEL"));
  const nonce = required("UNBOUNDRY_SAFE_RUN_NONCE");

  if (
    !systemTemporaryRoot.startsWith("/private/var/folders/") &&
    systemTemporaryRoot !== "/private/tmp"
  ) {
    fail(`untrusted system temporary root: ${systemTemporaryRoot}`);
  }

  if (!isInside(systemTemporaryRoot, testRoot)) {
    fail(`test root must be under the system temporary root: ${testRoot}`);
  }
  if (!isInside(testRoot, dataDirectory)) {
    fail(`data directory must be inside this test root: ${dataDirectory}`);
  }
  if (!isInside(testRoot, auditFile)) {
    fail(`network audit must be inside this test root: ${auditFile}`);
  }
  if (!isInside(testRoot, sentinel)) fail("safe-run sentinel escaped this test root");
  if (readFileSync(sentinel, "utf8").trim() !== nonce) {
    fail("safe-run sentinel nonce does not match");
  }
  if (!lstatSync(sentinel).isFile() || !lstatSync(auditFile).isFile()) {
    fail("safe-run sentinel and network audit must be regular files");
  }
  if (repositoryRoot === originalRepositoryRoot) {
    fail("tests must run from an isolated source snapshot, never the original repository");
  }
  if (!isInside(systemTemporaryRoot, repositoryRoot)) {
    fail("isolated source snapshot must be inside the system temporary root");
  }

  const forbiddenDirectories = [
    resolve(originalRepositoryRoot, "data"),
    resolve(originalRepositoryRoot, "backups"),
    resolve(originalRepositoryRoot, "tmp"),
    "/var/lib/unboundry",
  ];
  for (const forbidden of forbiddenDirectories) {
    if (isInside(forbidden, dataDirectory) || isInside(dataDirectory, forbidden)) {
      fail(`data directory overlaps forbidden real data path: ${forbidden}`);
    }
  }
  if (!isAbsolute(dataDirectory) || !isAbsolute(auditFile)) {
    fail("data and audit paths must be absolute");
  }

  const nodeOptions = process.env.NODE_OPTIONS ?? "";
  const expectedNodeOptions = `--import=${join(
    repositoryRoot,
    "scripts/offline-network-guard.mjs",
  )}`;
  if (nodeOptions !== expectedNodeOptions) {
    fail("the Node offline network guard is not preloaded");
  }

  cachedEnvironment = {
    auxiliaryPort: parsePort("UNBOUNDRY_TEST_AUX_PORT"),
    auditFile,
    dataDirectory,
    originalRepositoryRoot,
    port: parsePort("UNBOUNDRY_TEST_PORT"),
    repositoryRoot,
    testRoot,
  };
  return cachedEnvironment;
}

export function isLoopbackTestUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (["about:", "blob:", "data:"].includes(url.protocol)) {
    return true;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return false;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:1" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!loopback) return false;
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:" || url.protocol === "wss:"
      ? 443
      : 80;
  if (port === FORBIDDEN_PORT) return false;
  const environment = safeTestEnvironment();
  return port === environment.port || port === environment.auxiliaryPort;
}

export function recordBlockedBrowserRequest(value: string): void {
  const { auditFile } = safeTestEnvironment();
  let target = "invalid-url";
  try {
    const url = new URL(value);
    target = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {}
  appendFileSync(
    auditFile,
    `${JSON.stringify({ event: "browser_request_blocked", target })}\n`,
    { encoding: "utf8" },
  );
}
