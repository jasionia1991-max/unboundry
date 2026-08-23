import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  AdmittedReleaseError,
  validateAdmittedRelease,
} from "./lib/admitted-release.mjs";
import {
  assertAttestedReleaseArtifacts,
  readReleaseAttestation,
  ReleaseAttestationError,
} from "./lib/release-attestation.mjs";

const FORMAT = "unboundry-release-ops-validation-v2";
const EVIDENCE_CLASS = "artifact-bound-static-contract";
const MAXIMUM_TEMPLATE_BYTES = 256 * 1024;
const releaseAttestationEnvironmentNames = Object.freeze([
  "UNBOUNDRY_BRIDGE_RELEASE_MANIFEST",
  "UNBOUNDRY_BRIDGE_RELEASE_MANIFEST_SHA256",
  "UNBOUNDRY_FINAL_RELEASE_MANIFEST",
  "UNBOUNDRY_FINAL_RELEASE_MANIFEST_SHA256",
  "UNBOUNDRY_RELEASE_ATTESTATION_PATH",
  "UNBOUNDRY_RELEASE_ATTESTATION_ROOT",
  "UNBOUNDRY_RELEASE_ATTESTATION_SHA256",
  "UNBOUNDRY_RELEASE_SOURCE_SHA256",
  "UNBOUNDRY_SAFE_RUN_NONCE",
  "UNBOUNDRY_SAFE_TEST",
  "UNBOUNDRY_TEST_ROOT",
]);
const exactNginxPlaceholders = Object.freeze([
  "UNBOUNDRY_SERVER_NAME",
  "UNBOUNDRY_TLS_CERTIFICATE",
  "UNBOUNDRY_TLS_CERTIFICATE_KEY",
  "UNBOUNDRY_TRAFFIC_MODE",
]);
const exactRuntimeEnvironment = Object.freeze({
  HOME: "/run/unboundry",
  NODE_ENV: "production",
  PATH: "/opt/node22/bin:/usr/bin:/bin",
  TEMP: "/run/unboundry",
  TMP: "/run/unboundry",
  TMPDIR: "/run/unboundry",
  UNBOUNDRY_DATA_DIR: "/var/lib/unboundry",
  UNBOUNDRY_RUNTIME_DIR: "/run/unboundry",
  UNBOUNDRY_RUNTIME_HOME: "/run/unboundry",
  UNBOUNDRY_RUNTIME_ROLE: "active",
  UNBOUNDRY_RUNTIME_TEMP: "/run/unboundry",
  UNBOUNDRY_SECURE_COOKIES: "1",
  UNBOUNDRY_TRUST_PROXY: "1",
  UNBOUNDRY_VITE_CACHE_DIR: "/var/cache/unboundry",
});
const exactUnsetEnvironment = Object.freeze([
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
  "UNBOUNDRY_LEGACY_RUNTIME_ROOT",
  "UNBOUNDRY_MAINTENANCE_MODE",
  "UNBOUNDRY_RELEASE_ROLE",
  "UNBOUNDRY_SAFE_TEST",
]);

class OpsValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OpsValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OpsValidationError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedAbsolutePath(value, label) {
  if (
    !value || !isAbsolute(value) || resolve(value) !== value ||
    value !== value.normalize("NFC") || /[\0\r\n]/.test(value)
  ) fail("OPS_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
  return value;
}

function parseArguments(argv) {
  if (argv.length !== 10) {
    fail(
      "OPS_ARGUMENT_INVALID",
      "Exactly the three ops templates and both release manifests are required",
    );
  }
  const allowed = new Set([
    "--bridge-release-manifest",
    "--final-release-manifest",
    "--migration-systemd-template",
    "--nginx-template",
    "--systemd-template",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || !value || value.startsWith("--") || values.has(name)) {
      fail("OPS_ARGUMENT_INVALID", "Template options are missing, duplicated, or unknown");
    }
    values.set(name, value);
  }
  return Object.freeze({
    bridgeManifest: normalizedAbsolutePath(
      values.get("--bridge-release-manifest"),
      "bridge release manifest",
    ),
    finalManifest: normalizedAbsolutePath(
      values.get("--final-release-manifest"),
      "final release manifest",
    ),
    migrationSystemd: normalizedAbsolutePath(
      values.get("--migration-systemd-template"),
      "migration systemd template",
    ),
    nginx: normalizedAbsolutePath(values.get("--nginx-template"), "nginx template"),
    systemd: normalizedAbsolutePath(
      values.get("--systemd-template"),
      "systemd template",
    ),
  });
}

async function releaseValidationExpectation(options) {
  const attestationEnvironmentPresent = releaseAttestationEnvironmentNames
    .filter((name) => process.env[name] !== undefined);
  if (attestationEnvironmentPresent.length === 0) {
    fail(
      "OPS_RELEASE_RELATIONSHIP_UNPROVEN",
      "Formal bridge-to-final parent commit evidence is required",
    );
  }
  if (
    process.env.UNBOUNDRY_SAFE_TEST !== "1" ||
    attestationEnvironmentPresent.length !== releaseAttestationEnvironmentNames.length
  ) fail("OPS_RELEASE_INVALID", "Partial release attestation environment is forbidden");
  try {
    const attestation = await readReleaseAttestation();
    if (
      attestation.manifestPaths.bridge !== options.bridgeManifest ||
      attestation.manifestPaths.final !== options.finalManifest
    ) fail("OPS_RELEASE_INVALID", "Release manifests do not match the runner attestation");
    return Object.freeze({
      expectation: attestation.expectation,
      manifestSha256: attestation.manifestSha256,
      relationship: attestation.relationship,
    });
  } catch (error) {
    if (error instanceof OpsValidationError) throw error;
    if (error instanceof ReleaseAttestationError) {
      fail("OPS_RELEASE_INVALID", "Release attestation failed closed");
    }
    throw error;
  }
}

async function validateReleasePair(options, validationExpectation) {
  try {
    const [bridge, final] = await Promise.all([
      validateAdmittedRelease({
        expectedManifestSha256: validationExpectation.manifestSha256.bridge,
        expectedRole: "bridge",
        manifestPath: options.bridgeManifest,
        testExpectation: validationExpectation.expectation,
      }),
      validateAdmittedRelease({
        expectedManifestSha256: validationExpectation.manifestSha256.final,
        expectedRole: "final",
        manifestPath: options.finalManifest,
        testExpectation: validationExpectation.expectation,
      }),
    ]);
    if (
      bridge.directory === final.directory ||
      dirname(bridge.directory) !== dirname(final.directory) ||
      bridge.releaseRoot !== final.releaseRoot ||
      JSON.stringify(bridge.rootIdentity) !== JSON.stringify(final.rootIdentity)
    ) fail("OPS_RELEASE_INVALID", "Bridge and final releases must be distinct siblings");
    assertAttestedReleaseArtifacts(validationExpectation, { bridge, final });
    return Object.freeze({ bridge, final });
  } catch (error) {
    if (error instanceof OpsValidationError) throw error;
    if (error instanceof AdmittedReleaseError) {
      fail("OPS_RELEASE_INVALID", "A release artifact failed closed admission");
    }
    if (error instanceof ReleaseAttestationError) {
      fail(
        "OPS_RELEASE_RELATIONSHIP_UNPROVEN",
        "Release manifests are not bound to the attested source pair",
      );
    }
    throw error;
  }
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    fail("OPS_PATH_UNSAFE", "POSIX ownership checks are required");
  }
  return process.getuid();
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.uid === right.uid &&
    left.gid === right.gid && left.nlink === right.nlink &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

async function readPinnedTemplate(path, label) {
  const before = await lstat(path).catch(() => undefined);
  if (
    !before?.isFile() || before.isSymbolicLink() || before.uid !== currentUid() ||
    before.nlink !== 1 || (before.mode & 0o022) !== 0 ||
    before.size <= 0 || before.size > MAXIMUM_TEMPLATE_BYTES
  ) fail("OPS_PATH_UNSAFE", `${label} must be a pinned, owner-controlled regular file`);
  if (await realpath(path).catch(() => undefined) !== path) {
    fail("OPS_PATH_UNSAFE", `${label} path must not traverse symbolic links`);
  }
  const bytes = await readFile(path);
  const after = await lstat(path).catch(() => undefined);
  if (!after || !sameFile(before, after) || bytes.length !== before.size) {
    fail("OPS_PATH_UNSAFE", `${label} changed while it was being read`);
  }
  const text = bytes.toString("utf8");
  if (
    !Buffer.from(text, "utf8").equals(bytes) || text.charCodeAt(0) === 0xfeff ||
    !text.endsWith("\n") || /\r|\0/.test(text) ||
    text.split("\n").some((line) => line.length > 4096) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
  ) fail("OPS_TEMPLATE_INVALID", `${label} must be canonical UTF-8 text`);
  return Object.freeze({ bytes, text });
}

function canonical(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripNginxComments(text) {
  let output = "";
  let quote = "";
  let escaped = false;
  let comment = false;
  for (const character of text) {
    if (comment) {
      if (character === "\n") {
        comment = false;
        output += character;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      output += character;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      output += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = quote === character ? "" : (quote || character);
      output += character;
      continue;
    }
    if (!quote && character === "#") {
      comment = true;
      continue;
    }
    output += character;
  }
  if (quote || escaped) fail("OPS_TEMPLATE_INVALID", "nginx template has an open quote");
  return output;
}

function nginxInventory(text) {
  const blocks = [];
  const directives = [];
  let buffer = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      buffer += character;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      buffer += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = quote === character ? "" : (quote || character);
      buffer += character;
      continue;
    }
    if (quote) {
      buffer += character;
      continue;
    }
    if (text.startsWith("{{", index)) {
      const close = text.indexOf("}}", index + 2);
      if (close < 0) fail("OPS_TEMPLATE_INVALID", "nginx placeholder is not closed");
      buffer += text.slice(index, close + 2);
      index = close + 1;
      continue;
    }
    if (character === "{") {
      const header = canonical(buffer);
      if (!header) fail("OPS_TEMPLATE_INVALID", "nginx block header is empty");
      blocks.push(header);
      buffer = "";
      continue;
    }
    if (character === ";") {
      const statement = canonical(buffer);
      if (!statement || !/^[a-z_][a-z0-9_]*(?:\s|$)/.test(statement)) {
        fail("OPS_TEMPLATE_INVALID", "nginx directive is malformed");
      }
      directives.push(statement.split(/\s/, 1)[0]);
      buffer = "";
      continue;
    }
    if (character === "}") {
      if (canonical(buffer)) {
        fail("OPS_TEMPLATE_INVALID", "nginx directive is missing a semicolon");
      }
      buffer = "";
      continue;
    }
    buffer += character;
  }
  if (quote || escaped || canonical(buffer)) {
    fail("OPS_TEMPLATE_INVALID", "nginx template ends with an incomplete statement");
  }
  return Object.freeze({ blocks, directives });
}

function assertExactNginxInventory(text) {
  const inventory = nginxInventory(text);
  const expectedBlocks = [
    'map "{{UNBOUNDRY_TRAFFIC_MODE}}" $unboundry_maintenance_mode',
    "upstream unboundry_active",
    "server",
    "location = /maintenance.html",
    "location @unboundry_api_maintenance",
    "location = /api/updates",
    "if ($unboundry_maintenance_mode = 1)",
    "location ^~ /api/",
    "if ($unboundry_maintenance_mode = 1)",
    "location ~ ^/(?:\\.(?!well-known(?:/|$))|(?:client|server|types|scripts|spec|tests|deploy|ops)/|package(?:-lock)?\\.json$|tsconfig(?:\\.[^/]+)?\\.json$)",
    "location = /robots.txt",
    "location /",
    "if ($unboundry_maintenance_mode = 1)",
  ].sort();
  if (JSON.stringify([...inventory.blocks].sort()) !== JSON.stringify(expectedBlocks)) {
    fail("OPS_TEMPLATE_INVALID", "nginx blocks do not match the exact location allowlist");
  }
  const expectedDirectiveCounts = Object.freeze({
    access_log: 1,
    active: 1,
    add_header: 4,
    client_body_timeout: 1,
    client_max_body_size: 1,
    default: 1,
    default_type: 2,
    error_page: 2,
    keepalive: 1,
    keepalive_timeout: 1,
    listen: 1,
    log_format: 1,
    maintenance: 1,
    proxy_buffering: 2,
    proxy_cache: 1,
    proxy_http_version: 3,
    proxy_intercept_errors: 3,
    proxy_next_upstream: 3,
    proxy_pass: 3,
    proxy_read_timeout: 3,
    proxy_request_buffering: 1,
    proxy_send_timeout: 3,
    proxy_set_header: 15,
    return: 6,
    root: 1,
    send_timeout: 3,
    server: 1,
    server_name: 1,
    server_tokens: 1,
    ssl_certificate: 1,
    ssl_certificate_key: 1,
    ssl_protocols: 1,
    try_files: 1,
  });
  const actualCounts = {};
  for (const directive of inventory.directives) {
    actualCounts[directive] = (actualCounts[directive] ?? 0) + 1;
  }
  const sorted = (value) => Object.fromEntries(Object.entries(value).sort());
  if (JSON.stringify(sorted(actualCounts)) !== JSON.stringify(sorted(expectedDirectiveCounts))) {
    fail("OPS_TEMPLATE_INVALID", "nginx directives do not match the exact allowlist");
  }
}

function blockEnd(text, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = quote === character ? "" : (quote || character);
      continue;
    }
    if (quote) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) break;
    }
  }
  fail("OPS_TEMPLATE_INVALID", "nginx template has unbalanced blocks");
}

function uniqueBlock(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1 || matches[0].index === undefined) {
    fail("OPS_TEMPLATE_INVALID", `nginx template requires one exact ${label} block`);
  }
  const open = matches[0].index + matches[0][0].lastIndexOf("{");
  const close = blockEnd(text, open);
  return text.slice(open + 1, close);
}

function literalBlockPattern(header) {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\s*\\{`, "g");
}

function directiveValues(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`\\b${escaped}\\s+([^;]+);`, "g"))]
    .map((match) => canonical(match[1]));
}

function directDirectiveValues(text, name) {
  const values = [];
  let buffer = "";
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (escaped) {
      escaped = false;
      if (depth === 0) buffer += character;
      continue;
    }
    if (quote && character === "\\") {
      escaped = true;
      if (depth === 0) buffer += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = quote === character ? "" : (quote || character);
      if (depth === 0) buffer += character;
      continue;
    }
    if (quote) {
      if (depth === 0) buffer += character;
      continue;
    }
    if (text.startsWith("{{", index)) {
      const close = text.indexOf("}}", index + 2);
      if (close < 0) fail("OPS_TEMPLATE_INVALID", "nginx placeholder is not closed");
      if (depth === 0) buffer += text.slice(index, close + 2);
      index = close + 1;
      continue;
    }
    if (character === "{") {
      depth += 1;
      if (depth === 1) buffer = "";
      continue;
    }
    if (character === "}") {
      if (depth <= 0) fail("OPS_TEMPLATE_INVALID", "nginx scope has an extra close brace");
      depth -= 1;
      if (depth === 0) buffer = "";
      continue;
    }
    if (character === ";") {
      if (depth === 0) {
        const statement = canonical(buffer);
        const match = /^([a-z_][a-z0-9_]*)\s+(.+)$/.exec(statement);
        if (!match) fail("OPS_TEMPLATE_INVALID", "nginx directive is malformed");
        if (match[1] === name) values.push(match[2]);
        buffer = "";
      }
      continue;
    }
    if (depth === 0) buffer += character;
  }
  if (quote || escaped || depth !== 0 || canonical(buffer)) {
    fail("OPS_TEMPLATE_INVALID", "nginx scope is incomplete");
  }
  return values;
}

function requireDirectDirective(text, name, value) {
  const values = directDirectiveValues(text, name);
  if (values.length !== 1 || values[0] !== value) {
    fail("OPS_TEMPLATE_INVALID", `${name} must be direct and have the one exact safe value`);
  }
}

function requireProxyContract(block, timeout) {
  requireDirectDirective(block, "proxy_pass", "http://unboundry_active");
  requireDirectDirective(block, "proxy_http_version", "1.1");
  requireDirectDirective(block, "proxy_next_upstream", "off");
  requireDirectDirective(block, "proxy_intercept_errors", "off");
  requireDirectDirective(block, "proxy_read_timeout", timeout);
  requireDirectDirective(block, "proxy_send_timeout", timeout);
  requireDirectDirective(block, "send_timeout", timeout);
  const forwarded = directDirectiveValues(block, "proxy_set_header");
  const exact = [
    "Connection \"\"",
    "Host $host",
    "X-Forwarded-For $remote_addr",
    "X-Forwarded-Proto https",
    "X-Request-ID $request_id",
  ].sort();
  if (JSON.stringify([...forwarded].sort()) !== JSON.stringify(exact)) {
    fail("OPS_TEMPLATE_INVALID", "proxy forwarding headers must match the exact contract");
  }
}

function requireMaintenanceGuard(block, status, label) {
  const guard = uniqueBlock(
    block,
    /\bif\s*\(\$unboundry_maintenance_mode\s*=\s*1\)\s*\{/g,
    `${label} maintenance guard`,
  );
  requireDirectDirective(guard, "return", status);
}

function placeholderNames(text) {
  const names = [...text.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)]
    .map((match) => match[1]);
  if (text.replace(/\{\{[A-Z][A-Z0-9_]*\}\}/g, "").match(/\{\{|\}\}/)) {
    fail("OPS_TEMPLATE_INVALID", "template contains a malformed placeholder");
  }
  return [...new Set(names)].sort();
}

function validateNginx(text) {
  const nginx = stripNginxComments(text);
  assertExactNginxInventory(nginx);
  const placeholders = placeholderNames(nginx);
  if (JSON.stringify(placeholders) !== JSON.stringify([...exactNginxPlaceholders].sort())) {
    fail("OPS_TEMPLATE_INVALID", "nginx placeholders do not match the exact allowlist");
  }
  if (
    /-----BEGIN |\b(?:password|token|secret|api[_-]?key)\s*=/i.test(nginx) ||
    /\b(?:0\.0\.0\.0|localhost)\b|\[::\]/i.test(nginx)
  ) fail("OPS_TEMPLATE_INVALID", "nginx template contains a host or secret-like value");
  const addresses = nginx.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  if (addresses.some((address) => address !== "127.0.0.1")) {
    fail("OPS_TEMPLATE_INVALID", "nginx template may contain only the exact loopback address");
  }
  blockEnd(`{${nginx}}`, 0);

  const map = uniqueBlock(
    nginx,
    /\bmap\s+"\{\{UNBOUNDRY_TRAFFIC_MODE\}\}"\s+\$unboundry_maintenance_mode\s*\{/g,
    "maintenance map",
  );
  requireDirectDirective(map, "default", "1");
  requireDirectDirective(map, "maintenance", "1");
  requireDirectDirective(map, "active", "0");

  const upstream = uniqueBlock(
    nginx,
    /\bupstream\s+unboundry_active\s*\{/g,
    "loopback upstream",
  );
  requireDirectDirective(upstream, "server", "127.0.0.1:4173");
  requireDirectDirective(upstream, "keepalive", "32");
  requireDirectDirective(
    nginx,
    "log_format",
    "unboundry_release '$request_id $remote_addr \"$request\" ' " +
      "'$status $request_length $bytes_sent ' '$request_time $upstream_response_time'",
  );
  requireDirectDirective(nginx, "server_tokens", "off");

  const server = uniqueBlock(nginx, /\bserver\s*\{/g, "TLS server");
  for (const [name, value] of [
    ["listen", "443 ssl"],
    ["server_name", "{{UNBOUNDRY_SERVER_NAME}}"],
    ["ssl_certificate", "{{UNBOUNDRY_TLS_CERTIFICATE}}"],
    ["ssl_certificate_key", "{{UNBOUNDRY_TLS_CERTIFICATE_KEY}}"],
    ["ssl_protocols", "TLSv1.2 TLSv1.3"],
    ["access_log", "/var/log/nginx/unboundry_release_access.log unboundry_release"],
    ["client_max_body_size", "600m"],
    ["client_body_timeout", "1h"],
    ["keepalive_timeout", "65s"],
  ]) requireDirectDirective(server, name, value);
  const errorPages = directDirectiveValues(server, "error_page").sort();
  if (JSON.stringify(errorPages) !== JSON.stringify([
    "418 =200 /maintenance.html",
    "503 =503 @unboundry_api_maintenance",
  ])) {
    fail("OPS_TEMPLATE_INVALID", "API maintenance must preserve HTTP 503");
  }

  const maintenance = uniqueBlock(
    server,
    /\blocation\s+=\s+\/maintenance\.html\s*\{/g,
    "static maintenance",
  );
  requireDirectDirective(maintenance, "root", "/opt/unboundry/shared/maintenance");
  requireDirectDirective(maintenance, "try_files", "/index.html =503");
  requireDirectDirective(maintenance, "default_type", "text/html");
  if (JSON.stringify(directDirectiveValues(maintenance, "add_header")) !== JSON.stringify([
    'Cache-Control "no-store" always',
  ])) fail("OPS_TEMPLATE_INVALID", "static maintenance headers must match the contract");

  const apiMaintenance = uniqueBlock(
    server,
    /\blocation\s+@unboundry_api_maintenance\s*\{/g,
    "API maintenance",
  );
  requireDirectDirective(apiMaintenance, "return", "503 '{\"error\":\"maintenance\"}'");
  requireDirectDirective(apiMaintenance, "default_type", "application/json");
  if (JSON.stringify(directDirectiveValues(apiMaintenance, "add_header").sort()) !== JSON.stringify([
    'Cache-Control "no-store" always',
    'Retry-After "120" always',
  ])) fail("OPS_TEMPLATE_INVALID", "API maintenance headers must match the contract");

  const updates = uniqueBlock(
    server,
    /\blocation\s+=\s+\/api\/updates\s*\{/g,
    "SSE",
  );
  requireMaintenanceGuard(updates, "503", "SSE");
  requireProxyContract(updates, "1h");
  requireDirectDirective(updates, "proxy_buffering", "off");
  requireDirectDirective(updates, "proxy_cache", "off");
  if (!directDirectiveValues(updates, "add_header").includes('X-Accel-Buffering "no" always')) {
    fail("OPS_TEMPLATE_INVALID", "SSE requires X-Accel-Buffering no");
  }

  const api = uniqueBlock(server, /\blocation\s+\^~\s+\/api\/\s*\{/g, "long API");
  requireMaintenanceGuard(api, "503", "API");
  requireProxyContract(api, "1h");
  requireDirectDirective(api, "proxy_request_buffering", "off");
  requireDirectDirective(api, "proxy_buffering", "off");

  const sensitivePaths = uniqueBlock(
    server,
    literalBlockPattern("location ~ ^/(?:\\.(?!well-known(?:/|$))|(?:client|server|types|scripts|spec|tests|deploy|ops)/|package(?:-lock)?\\.json$|tsconfig(?:\\.[^/]+)?\\.json$)"),
    "sensitive source path rejection",
  );
  requireDirectDirective(sensitivePaths, "return", "404");

  const robots = uniqueBlock(server, /\blocation\s+=\s+\/robots\.txt\s*\{/g, "robots rejection");
  requireDirectDirective(robots, "return", "404");

  const publicLocation = uniqueBlock(server, /\blocation\s+\/\s*\{/g, "public route");
  requireMaintenanceGuard(publicLocation, "418", "public route");
  requireProxyContract(publicLocation, "10m");

  const retryValues = directiveValues(nginx, "proxy_next_upstream");
  if (retryValues.length !== 3 || retryValues.some((value) => value !== "off") ||
      /\bproxy_next_upstream_(?:tries|timeout)\b/.test(nginx)) {
    fail("OPS_TEMPLATE_INVALID", "automatic proxy retry, including POST retry, is forbidden");
  }
  if (directiveValues(nginx, "proxy_pass").length !== 3) {
    fail("OPS_TEMPLATE_INVALID", "only the three declared routes may proxy to the runtime");
  }
  return Object.freeze({ placeholders, upstreamAddress: "127.0.0.1", upstreamPort: 4173 });
}

function parseSystemd(text, expectedSections = ["Unit", "Service", "Install"]) {
  const sections = new Map();
  let section;
  for (const [index, raw] of text.split("\n").entries()) {
    if (!raw || raw.startsWith("#") || raw.startsWith(";")) continue;
    if (/^\s|\s$/.test(raw) || raw.endsWith("\\")) {
      fail("OPS_TEMPLATE_INVALID", `systemd line ${index + 1} is not canonical`);
    }
    const heading = /^\[([A-Za-z]+)\]$/.exec(raw);
    if (heading) {
      section = heading[1];
      if (sections.has(section)) fail("OPS_TEMPLATE_INVALID", "systemd section is duplicated");
      sections.set(section, new Map());
      continue;
    }
    if (!section) fail("OPS_TEMPLATE_INVALID", "systemd directive precedes a section");
    const separator = raw.indexOf("=");
    const key = raw.slice(0, separator);
    const value = raw.slice(separator + 1);
    if (separator < 1 || !/^[A-Za-z][A-Za-z0-9]*$/.test(key)) {
      fail("OPS_TEMPLATE_INVALID", `systemd line ${index + 1} is invalid`);
    }
    const directives = sections.get(section);
    const values = directives.get(key) ?? [];
    values.push(value);
    directives.set(key, values);
  }
  if (JSON.stringify([...sections.keys()]) !== JSON.stringify(expectedSections)) {
    fail(
      "OPS_TEMPLATE_INVALID",
      `systemd sections must be ${expectedSections.join(", ")} in order`,
    );
  }
  return sections;
}

function validateMigrationSystemd(text) {
  const placeholders = placeholderNames(text);
  if (
    JSON.stringify(placeholders) !==
      JSON.stringify(["UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256"]) ||
    /-----BEGIN |\b(?:password|token|secret|api[_-]?key)\s*=/i.test(text)
  ) {
    fail(
      "OPS_TEMPLATE_INVALID",
      "migration systemd template has an invalid placeholder or secret",
    );
  }
  const sections = parseSystemd(text, ["Unit", "Service"]);
  const unit = sections.get("Unit");
  const service = sections.get("Service");
  const exactUnitValues = Object.freeze({
    After: "unboundry.service",
    Conflicts: "unboundry.service",
    Description: "Unboundry schema 37 to 39 one-shot migration",
    RequiresMountsFor: "/opt/unboundry/releases/v0.5.2 /var/lib/unboundry",
  });
  expectExactKeys(unit, Object.keys(exactUnitValues), "Migration Unit");
  for (const [key, value] of Object.entries(exactUnitValues)) {
    expectOne(unit, key, value);
  }
  const exactServiceValues = Object.freeze({
    AmbientCapabilities: "",
    CacheDirectory: "unboundry-migration",
    CacheDirectoryMode: "0700",
    CapabilityBoundingSet: "",
    ExecStart: "/opt/node22/bin/node /opt/unboundry/releases/v0.5.2/scripts/migrate-schema37-to39.mjs --apply --data-dir /var/lib/unboundry --runtime-dir /run/unboundry --expected-logical-sha256 {{UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256}} --scratch-root /var/cache/unboundry-migration",
    Group: "unboundry",
    InaccessiblePaths: "/home /root /media /mnt",
    KillMode: "mixed",
    KillSignal: "SIGTERM",
    LimitNOFILE: "1024",
    LockPersonality: "yes",
    NoNewPrivileges: "yes",
    PrivateDevices: "yes",
    PrivateNetwork: "yes",
    PrivateTmp: "yes",
    ProcSubset: "pid",
    ProtectClock: "yes",
    ProtectControlGroups: "yes",
    ProtectHome: "yes",
    ProtectHostname: "yes",
    ProtectKernelLogs: "yes",
    ProtectKernelModules: "yes",
    ProtectKernelTunables: "yes",
    ProtectProc: "invisible",
    ProtectSystem: "strict",
    ReadOnlyPaths: "/opt/unboundry/releases/v0.5.2",
    ReadWritePaths: "/var/lib/unboundry /run/unboundry /var/cache/unboundry-migration",
    RemoveIPC: "yes",
    RestrictAddressFamilies: "AF_UNIX",
    RestrictNamespaces: "yes",
    RestrictRealtime: "yes",
    RestrictSUIDSGID: "yes",
    RuntimeDirectory: "unboundry",
    RuntimeDirectoryMode: "0700",
    RuntimeDirectoryPreserve: "yes",
    SendSIGKILL: "yes",
    StandardError: "journal",
    StandardOutput: "journal",
    StateDirectory: "unboundry",
    StateDirectoryMode: "0700",
    SyslogIdentifier: "unboundry-migrate-schema37-to39",
    SystemCallArchitectures: "native",
    TasksMax: "64",
    TimeoutStartSec: "1h",
    TimeoutStopSec: "30s",
    Type: "oneshot",
    UMask: "0077",
    UnsetEnvironment: exactUnsetEnvironment.join(" "),
    User: "unboundry",
    WorkingDirectory: "/opt/unboundry/releases/v0.5.2",
  });
  expectExactKeys(
    service,
    [...Object.keys(exactServiceValues), "Environment"],
    "Migration Service",
  );
  for (const [key, value] of Object.entries(exactServiceValues)) {
    expectOne(service, key, value);
  }
  const environment = [...(service.get("Environment") ?? [])].sort();
  const expectedEnvironment = [
    '"HOME=/run/unboundry"',
    '"NODE_ENV=production"',
    '"PATH=/opt/node22/bin:/usr/bin:/bin"',
    '"TEMP=/run/unboundry"',
    '"TMP=/run/unboundry"',
    '"TMPDIR=/run/unboundry"',
  ].sort();
  if (JSON.stringify(environment) !== JSON.stringify(expectedEnvironment)) {
    fail(
      "OPS_TEMPLATE_INVALID",
      "migration environment does not match the exact allowlist",
    );
  }
  if (
    /\b(?:EnvironmentFile|PassEnvironment|ExecStartPre|ExecStartPost|ExecStopPost)=/
      .test(text)
  ) {
    fail(
      "OPS_TEMPLATE_INVALID",
      "migration external environment and hook expansion are forbidden",
    );
  }
  return Object.freeze({
    bridgeReleaseDirectory: "/opt/unboundry/releases/v0.5.2",
    dataDirectory: "/var/lib/unboundry",
    execStart: exactServiceValues.ExecStart,
    expectedSourceLogicalSha256Placeholder:
      "UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256",
    runtimeDirectory: "/run/unboundry",
    workingDirectory: exactServiceValues.WorkingDirectory,
  });
}

function expectExactKeys(section, allowed, label) {
  const actual = [...section.keys()].sort();
  const expected = [...allowed].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail("OPS_TEMPLATE_INVALID", `${label} directives do not match the exact allowlist`);
  }
}

function expectOne(section, key, value) {
  const values = section.get(key) ?? [];
  if (values.length !== 1 || values[0] !== value) {
    fail("OPS_TEMPLATE_INVALID", `${key} must have the one exact safe value`);
  }
}

function validateSystemd(text) {
  if (placeholderNames(text).length !== 0 || /-----BEGIN |\b(?:password|token|secret)=/i.test(text)) {
    fail("OPS_TEMPLATE_INVALID", "systemd template must not contain placeholders or secrets");
  }
  const sections = parseSystemd(text);
  const unit = sections.get("Unit");
  const service = sections.get("Service");
  const install = sections.get("Install");
  expectExactKeys(unit, [
    "After", "Description", "StartLimitBurst", "StartLimitIntervalSec", "Wants",
  ], "Unit");
  for (const [key, value] of [
    ["Description", "Unboundry immutable release runtime"],
    ["After", "network-online.target"],
    ["Wants", "network-online.target"],
    ["StartLimitIntervalSec", "300"],
    ["StartLimitBurst", "3"],
  ]) expectOne(unit, key, value);

  const exactServiceValues = Object.freeze({
    AmbientCapabilities: "",
    CacheDirectory: "unboundry",
    CacheDirectoryMode: "0700",
    CapabilityBoundingSet: "",
    ExecStart: "/opt/node22/bin/node /opt/unboundry/current/node_modules/vite/bin/vite.js preview --configLoader runner --host 127.0.0.1 --port 4173 --strictPort",
    Group: "unboundry",
    InaccessiblePaths: "/home /root /media /mnt",
    KillMode: "mixed",
    KillSignal: "SIGTERM",
    LimitNOFILE: "65536",
    LockPersonality: "yes",
    NoNewPrivileges: "yes",
    PrivateDevices: "yes",
    PrivateTmp: "yes",
    ProcSubset: "pid",
    ProtectClock: "yes",
    ProtectControlGroups: "yes",
    ProtectHome: "yes",
    ProtectHostname: "yes",
    ProtectKernelLogs: "yes",
    ProtectKernelModules: "yes",
    ProtectKernelTunables: "yes",
    ProtectProc: "invisible",
    ProtectSystem: "strict",
    ReadOnlyPaths: "/opt/unboundry/releases /opt/unboundry/current /opt/unboundry/shared/maintenance",
    ReadWritePaths: "/var/lib/unboundry /run/unboundry /var/cache/unboundry",
    RemoveIPC: "yes",
    Restart: "on-failure",
    RestartSec: "5s",
    RestrictAddressFamilies: "AF_UNIX AF_INET AF_INET6",
    RestrictNamespaces: "yes",
    RestrictRealtime: "yes",
    RestrictSUIDSGID: "yes",
    RuntimeDirectory: "unboundry",
    RuntimeDirectoryMode: "0700",
    RuntimeDirectoryPreserve: "yes",
    SendSIGKILL: "yes",
    StandardError: "journal",
    StandardOutput: "journal",
    StateDirectory: "unboundry",
    StateDirectoryMode: "0700",
    SyslogIdentifier: "unboundry",
    SystemCallArchitectures: "native",
    TasksMax: "512",
    TimeoutStartSec: "120s",
    TimeoutStopSec: "150s",
    Type: "simple",
    UMask: "0077",
    UnsetEnvironment: exactUnsetEnvironment.join(" "),
    User: "unboundry",
    WorkingDirectory: "/opt/unboundry/current",
  });
  expectExactKeys(
    service,
    [...Object.keys(exactServiceValues), "Environment"],
    "Service",
  );
  for (const [key, value] of Object.entries(exactServiceValues)) {
    expectOne(service, key, value);
  }

  const environment = new Map();
  for (const value of service.get("Environment") ?? []) {
    const match = /^"([A-Z][A-Z0-9_]*)=([^"\\]*)"$/.exec(value);
    if (!match || environment.has(match[1])) {
      fail("OPS_TEMPLATE_INVALID", "systemd Environment must be a unique literal allowlist");
    }
    environment.set(match[1], match[2]);
  }
  const actualEnvironment = Object.fromEntries([...environment.entries()].sort());
  if (JSON.stringify(actualEnvironment) !== JSON.stringify(exactRuntimeEnvironment)) {
    fail("OPS_TEMPLATE_INVALID", "runtime environment does not match the exact allowlist");
  }
  if (/\b(?:EnvironmentFile|PassEnvironment|ExecStartPre|ExecStartPost|ExecStopPost)=/.test(text)) {
    fail("OPS_TEMPLATE_INVALID", "external environment and hook expansion are forbidden");
  }
  expectExactKeys(install, ["WantedBy"], "Install");
  expectOne(install, "WantedBy", "multi-user.target");
  return Object.freeze({
    currentLink: "/opt/unboundry/current",
    dataDirectory: exactRuntimeEnvironment.UNBOUNDRY_DATA_DIR,
    environmentKeys: [...environment.keys()].sort(),
    execStart: exactServiceValues.ExecStart,
    runtimeDirectory: exactRuntimeEnvironment.UNBOUNDRY_RUNTIME_DIR,
    runtimePort: 4173,
  });
}

function materializeMigrationCommand(bridge) {
  const values = Object.freeze({
    "${UNBOUNDRY_DATA_DIR}": "/var/lib/unboundry",
    "${UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256}":
      "{{UNBOUNDRY_EXPECTED_SCHEMA37_LOGICAL_SHA256}}",
    "${UNBOUNDRY_MIGRATION_SCRATCH_ROOT}": "/var/cache/unboundry-migration",
    "${UNBOUNDRY_RUNTIME_DIR}": "/run/unboundry",
  });
  const arguments_ = bridge.manifest.migration.arguments.map((argument, index) => {
    if (index === 0) return join("/opt/unboundry/releases/v0.5.2", argument);
    return values[argument] ?? argument;
  });
  return ["/opt/node22/bin/node", ...arguments_].join(" ");
}

function assertArtifactOpsContract({ bridge, final }, systemd, migrationSystemd) {
  if (
    bridge.releaseId !== "v0.5.2" || bridge.version !== "0.5.2" ||
    final.releaseId !== "v0.6.0" || final.version !== "0.6.0" ||
    bridge.manifest.runtime.health.version !== "0.5.2" ||
    final.manifest.runtime.health.version !== "0.6.0"
  ) fail("OPS_CROSS_CONTRACT_INVALID", "Release versions do not match the ops contract");
  if (
    migrationSystemd.bridgeReleaseDirectory !==
      `/opt/unboundry/releases/${bridge.releaseId}` ||
    migrationSystemd.workingDirectory !==
      `/opt/unboundry/releases/${bridge.releaseId}` ||
    migrationSystemd.dataDirectory !== systemd.dataDirectory ||
    migrationSystemd.runtimeDirectory !== systemd.runtimeDirectory ||
    migrationSystemd.execStart !== materializeMigrationCommand(bridge)
  ) fail("OPS_CROSS_CONTRACT_INVALID", "Migration unit is not bound to the bridge artifact");
  const expectedRuntimeExecStart = [
    "/opt/node22/bin/node",
    "/opt/unboundry/current/node_modules/vite/bin/vite.js",
    ...bridge.manifest.runtime.arguments.slice(1).map((argument) =>
      argument === "${UNBOUNDRY_PORT}" ? String(systemd.runtimePort) : argument),
  ].join(" ");
  if (
    systemd.execStart !== expectedRuntimeExecStart ||
    JSON.stringify(bridge.manifest.runtime.arguments) !==
      JSON.stringify(final.manifest.runtime.arguments) ||
    bridge.manifest.runtime.cwd !== "." || final.manifest.runtime.cwd !== "."
  ) fail("OPS_CROSS_CONTRACT_INVALID", "Runtime unit is not shared by both artifacts");
}

function sameAdmittedRelease(left, right) {
  return left.directory === right.directory &&
    left.manifestSha256 === right.manifestSha256 &&
    left.inventorySha256 === right.inventorySha256 &&
    left.migrationArtifactSha256 === right.migrationArtifactSha256 &&
    left.releaseRoot === right.releaseRoot &&
    JSON.stringify(left.directoryIdentity) === JSON.stringify(right.directoryIdentity) &&
    JSON.stringify(left.rootIdentity) === JSON.stringify(right.rootIdentity);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (
    new Set([
      options.nginx,
      options.systemd,
      options.migrationSystemd,
      options.bridgeManifest,
      options.finalManifest,
    ]).size !== 5
  ) {
    fail("OPS_ARGUMENT_INVALID", "all ops inputs must be distinct files");
  }
  const [migrationSystemdFile, nginxFile, systemdFile] = await Promise.all([
    readPinnedTemplate(
      options.migrationSystemd,
      "migration systemd template",
    ),
    readPinnedTemplate(options.nginx, "nginx template"),
    readPinnedTemplate(options.systemd, "systemd template"),
  ]);
  const nginx = validateNginx(nginxFile.text);
  const systemd = validateSystemd(systemdFile.text);
  const migrationSystemd = validateMigrationSystemd(migrationSystemdFile.text);
  if (nginx.upstreamAddress !== "127.0.0.1" || nginx.upstreamPort !== systemd.runtimePort) {
    fail("OPS_CROSS_CONTRACT_INVALID", "nginx upstream and systemd listener do not match");
  }
  const validationExpectation = await releaseValidationExpectation(options);
  const releasesBefore = await validateReleasePair(options, validationExpectation);
  assertArtifactOpsContract(releasesBefore, systemd, migrationSystemd);
  const releasesAfter = await validateReleasePair(options, validationExpectation);
  if (
    !sameAdmittedRelease(releasesBefore.bridge, releasesAfter.bridge) ||
    !sameAdmittedRelease(releasesBefore.final, releasesAfter.final)
  ) fail("OPS_RELEASE_CHANGED", "Release artifacts changed during ops validation");
  process.stdout.write(`${JSON.stringify({
    crossContract: {
      currentLink: systemd.currentLink,
      dataDirectory: systemd.dataDirectory,
      loopbackAddress: nginx.upstreamAddress,
      port: nginx.upstreamPort,
      runtimeDirectory: systemd.runtimeDirectory,
      migrationBridgeReleaseDirectory:
        migrationSystemd.bridgeReleaseDirectory,
      migrationExpectedSourceLogicalSha256Placeholder:
        migrationSystemd.expectedSourceLogicalSha256Placeholder,
      bridgeManifestSha256: releasesBefore.bridge.manifestSha256,
      finalManifestSha256: releasesBefore.final.manifestSha256,
      releaseRelationship: validationExpectation.relationship,
    },
    evidenceClass: EVIDENCE_CLASS,
    format: FORMAT,
    limitations: [
      ...(validationExpectation.relationship.crossCommitProof
        ? []
        : ["cross-commit-proof-not-established"]),
      "nginx-t-not-executed",
      "systemd-analyze-not-executed",
      "production-host-not-inspected",
    ],
    nginx: {
      bytes: nginxFile.bytes.length,
      placeholders: nginx.placeholders,
      sha256: sha256(nginxFile.bytes),
    },
    migrationSystemd: {
      bytes: migrationSystemdFile.bytes.length,
      sha256: sha256(migrationSystemdFile.bytes),
    },
    releases: {
      bridge: {
        inventorySha256: releasesBefore.bridge.inventorySha256,
        manifestSha256: releasesBefore.bridge.manifestSha256,
        migrationArtifactSha256: releasesBefore.bridge.migrationArtifactSha256,
        releaseId: releasesBefore.bridge.releaseId,
        version: releasesBefore.bridge.version,
      },
      final: {
        inventorySha256: releasesBefore.final.inventorySha256,
        manifestSha256: releasesBefore.final.manifestSha256,
        releaseId: releasesBefore.final.releaseId,
        version: releasesBefore.final.version,
      },
    },
    systemd: {
      bytes: systemdFile.bytes.length,
      environmentKeys: systemd.environmentKeys,
      sha256: sha256(systemdFile.bytes),
    },
    valid: true,
  })}\n`);
}

main().catch((error) => {
  const known = error instanceof OpsValidationError;
  process.stderr.write(`${JSON.stringify({
    code: known ? error.code : "OPS_VALIDATION_FAILED",
    error: known ? error.message : "Release ops validation failed closed",
    evidenceClass: EVIDENCE_CLASS,
    format: FORMAT,
    valid: false,
  })}\n`);
  process.exitCode = 1;
});
