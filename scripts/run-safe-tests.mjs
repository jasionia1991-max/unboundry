import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const EXPECTED_NODE = "22.23.1";
const EXPECTED_NPM = "10.9.8";
const FORBIDDEN_PORT = 4173;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = realpathSync(resolve(dirname(scriptPath), ".."));
let activeSuiteRoot;
let listener4173Baseline;
let workspaceBaseline;

function fail(message) {
  throw new Error(`[safe-runner] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: options.capture ? "utf8" : undefined,
    env: options.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? "pipe" : "inherit",
    timeout: options.timeout ?? 20 * 60_000,
  });
  if (result.error) throw result.error;
  if (options.allowFailure !== true && result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    fail(`${command} exited with status ${result.status}`);
  }
  return result;
}

async function terminateOwnedProcessGroup(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 1) return;
  if (!signalOwnedProcessGroup(processGroupId, "SIGTERM")) return;
  await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  signalOwnedProcessGroup(processGroupId, "SIGKILL");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!ownedProcessGroupExists(processGroupId)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  fail(`owned process group ${processGroupId} did not fully exit`);
}

function signalOwnedProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function ownedProcessGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function runManaged(command, args, options = {}) {
  const capture = options.capture === true;
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    detached: true,
    env: options.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const processGroupId = child.pid;
  if (!Number.isInteger(processGroupId)) fail(`failed to start ${command}`);
  const chunks = { stderr: [], stdout: [] };
  let capturedBytes = 0;
  let outputExceeded = false;
  let forceKillTimer;
  const stopOwnedGroup = () => {
    signalOwnedProcessGroup(processGroupId, "SIGTERM");
    if (!forceKillTimer) {
      forceKillTimer = setTimeout(
        () => signalOwnedProcessGroup(processGroupId, "SIGKILL"),
        750,
      );
    }
  };
  const captureChunk = (stream, chunk) => {
    capturedBytes += chunk.length;
    if (capturedBytes > 64 * 1024 * 1024) {
      outputExceeded = true;
      stopOwnedGroup();
      return;
    }
    chunks[stream].push(chunk);
  };
  if (capture) {
    child.stdout.on("data", (chunk) => captureChunk("stdout", chunk));
    child.stderr.on("data", (chunk) => captureChunk("stderr", chunk));
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    stopOwnedGroup();
  }, options.timeout ?? 20 * 60_000);
  let status;
  let signal;
  try {
    ({ code: status, signal } = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, exitSignal) =>
        resolveExit({ code, signal: exitSignal }),
      );
    }));
  } finally {
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    await terminateOwnedProcessGroup(processGroupId);
  }
  const result = {
    signal,
    status: status ?? (timedOut ? 124 : 1),
    stderr: Buffer.concat(chunks.stderr).toString("utf8"),
    stdout: Buffer.concat(chunks.stdout).toString("utf8"),
    timedOut,
  };
  if (timedOut) fail(`${command} timed out after ${options.timeout ?? 20 * 60_000}ms`);
  if (outputExceeded) fail(`${command} exceeded the output limit`);
  if (options.allowFailure !== true && result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout);
      process.stderr.write(result.stderr);
    }
    fail(`${command} exited with status ${result.status}`);
  }
  return result;
}

function listener4173Snapshot() {
  const result = run(
    "/usr/sbin/lsof",
    ["-nP", "-iTCP:4173", "-sTCP:LISTEN", "-FpcRLT"],
    { allowFailure: true, capture: true },
  );
  if (![0, 1].includes(result.status)) {
    fail(`could not observe port 4173 listener (lsof ${result.status})`);
  }
  return result.stdout.trim().split("\n").filter(Boolean).sort().join("\n");
}

function assertListener4173Unchanged() {
  const current = listener4173Snapshot();
  if (current !== listener4173Baseline) {
    fail("the passive 4173 listener identity changed during the safe run");
  }
  return createHash("sha256").update(current || "no-listener").digest("hex");
}

function workspaceFingerprint() {
  const hash = createHash("sha256");
  const head = run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
  hash.update(`${head}\0`);
  for (const file of workingSourceFiles()) {
    const path = join(repositoryRoot, file);
    const stat = lstatSync(path);
    if (!stat.isFile()) fail(`workspace fingerprint only accepts files: ${file}`);
    hash.update(`${file}\0${stat.mode}\0${stat.size}\0`);
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return { head, sha256: hash.digest("hex") };
}

function ensureNode22() {
  if (process.versions.node === EXPECTED_NODE) return;
  const configured = process.env.UNBOUNDRY_NODE22_BINARY;
  const candidates = [
    configured,
    "/Users/mymy/.hermes/node/bin/node",
  ].filter(Boolean);
  const node = candidates.find((candidate) => existsSync(candidate));
  if (!node) {
    fail(`Node ${EXPECTED_NODE} was not found; set UNBOUNDRY_NODE22_BINARY`);
  }
  const version = run(node, ["-p", "process.versions.node"], {
    capture: true,
  }).stdout.trim();
  if (version !== EXPECTED_NODE) {
    fail(`configured Node is ${version}, expected ${EXPECTED_NODE}`);
  }
  const result = spawnSync(node, [scriptPath, ...process.argv.slice(2)], {
    cwd: repositoryRoot,
    env: { ...process.env, UNBOUNDRY_NODE22_REEXEC: "1" },
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

ensureNode22();

function parseArguments(values) {
  const parsed = {
    command: "full",
    repeat: 1,
    specs: [],
  };
  const args = [...values];
  if (args[0] && !args[0].startsWith("--")) parsed.command = args.shift();
  while (args.length > 0) {
    const argument = args.shift();
    if (argument === "--spec") {
      const value = args.shift();
      if (!value) fail("--spec requires a path or unique substring");
      parsed.specs.push(value);
    } else if (argument === "--repeat") {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        fail("--repeat must be an integer from 1 to 10");
      }
      parsed.repeat = value;
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }
  if (!["preflight", "list", "run", "full"].includes(parsed.command)) {
    fail(`unknown command: ${parsed.command}`);
  }
  return parsed;
}

function gitFiles(...pathspecs) {
  const result = run("git", ["ls-files", "-z", "--", ...pathspecs], {
    capture: true,
  });
  return result.stdout.split("\0").filter(Boolean).sort();
}

function workingSourceFiles() {
  const result = run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { capture: true },
  );
  return result.stdout.split("\0").filter(Boolean).sort();
}

function createTrackedSnapshot(suiteRoot) {
  const sourceRoot = join(suiteRoot, "source");
  mkdirSync(sourceRoot, { recursive: true });
  const files = workingSourceFiles();
  for (const file of files) {
    const source = join(repositoryRoot, file);
    const destination = join(sourceRoot, file);
    if (!isInside(repositoryRoot, resolve(source))) fail(`source path escaped: ${file}`);
    const stat = lstatSync(source);
    if (!stat.isFile()) fail(`tracked snapshot only accepts regular files: ${file}`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  run("/usr/bin/git", ["-c", "init.templateDir=", "init", "--quiet"], {
    cwd: sourceRoot,
  });
  run("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "add", "--all"], {
    cwd: sourceRoot,
  });
  const installedBrowserRoot = "/Users/mymy/Library/Caches/ms-playwright";
  const browserRoot = join(suiteRoot, "playwright-browsers");
  mkdirSync(browserRoot, { recursive: true });
  for (const directory of ["chromium-1234", "chromium_headless_shell-1234"]) {
    const source = join(installedBrowserRoot, directory);
    if (!existsSync(source)) fail(`missing prepared Playwright browser ${directory}`);
    run("/bin/cp", ["-cR", source, join(browserRoot, directory)]);
  }
  return { browserRoot, files, sourceRoot };
}

async function prepareDependencies(sourceRoot, browserRoot, suiteRoot, offlineInstall) {
  const modulesDestination = join(sourceRoot, "node_modules");
  if (!offlineInstall) {
    const modulesSource = join(repositoryRoot, "node_modules");
    if (!existsSync(modulesSource)) {
      fail("node_modules is missing; dependency preparation is required");
    }
    run("/bin/cp", ["-cR", modulesSource, modulesDestination]);
  } else {
    const testRoot = mkdtempSync(join(suiteRoot, "offline-install-"));
    const dataDirectory = join(testRoot, "data");
    const auditFile = join(testRoot, "network-audit.jsonl");
    const reportFile = join(testRoot, "unused-report.json");
    const cacheSource = "/Users/mymy/.npm/_cacache";
    const cacheRoot = join(testRoot, "npm-cache");
    mkdirSync(dataDirectory, { recursive: true });
    writeFileSync(auditFile, "", "utf8");
    writeFileSync(join(testRoot, "empty-npmrc"), "", "utf8");
    writeFileSync(join(testRoot, "empty-global-npmrc"), "", "utf8");
    if (!existsSync(cacheSource)) fail("the prepared npm content-addressable cache is missing");
    mkdirSync(cacheRoot, { recursive: true });
    run("/bin/cp", ["-cR", cacheSource, join(cacheRoot, "_cacache")]);
    const port = await freePort();
    const auxiliaryPort = await freePort(new Set([port]));
    const env = sanitizedEnvironment({
      auxiliaryPort,
      auditFile,
      browserRoot,
      dataDirectory,
      port,
      reportFile,
      sourceRoot,
      spec: join(sourceRoot, "tests/m0-shell.spec.ts"),
      testRoot,
    });
    env.npm_config_cache = cacheRoot;
    env.npm_config_globalconfig = join(testRoot, "empty-global-npmrc");
    env.npm_config_userconfig = join(testRoot, "empty-npmrc");
    const npmCli = "/Users/mymy/.hermes/node/lib/node_modules/npm/bin/npm-cli.js";
    const dependencyInputs = ["package.json", "package-lock.json"];
    const before = Object.fromEntries(
      dependencyInputs.map((file) => [
        file,
        createHash("sha256").update(readFileSync(join(sourceRoot, file))).digest("hex"),
      ]),
    );
    try {
      await sandboxedNode(sourceRoot, testRoot, env, [
        npmCli,
        "ci",
        "--offline",
        "--ignore-scripts",
        "--audit=false",
        "--fund=false",
      ], { timeout: 10 * 60_000 });
      await sandboxedNode(sourceRoot, testRoot, env, [npmCli, "ls", "--all"], {
        capture: true,
        timeout: 5 * 60_000,
      });
      const after = Object.fromEntries(
        dependencyInputs.map((file) => [
          file,
          createHash("sha256").update(readFileSync(join(sourceRoot, file))).digest("hex"),
        ]),
      );
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        fail("offline npm ci changed package.json or package-lock.json");
      }
      assertAudit(auditFile, new Set([port, auxiliaryPort]));
      console.log(JSON.stringify({ dependencyInstall: "offline-pass", npm: EXPECTED_NPM }));
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  }
  if (!existsSync(join(modulesDestination, "@playwright/test/cli.js"))) {
    fail("isolated source is missing Playwright dependencies");
  }
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function npmVersion() {
  const nodeDirectory = dirname(process.execPath);
  const env = {
    HOME: process.env.HOME,
    PATH: `${nodeDirectory}:${process.env.PATH ?? ""}`,
  };
  return run("npm", ["--version"], { capture: true, env }).stdout.trim();
}

function preflight() {
  if (realpathSync(process.cwd()) !== repositoryRoot) {
    fail(`run from repository root ${repositoryRoot}`);
  }
  if (process.versions.node !== EXPECTED_NODE) {
    fail(`Node ${EXPECTED_NODE} required, got ${process.versions.node}`);
  }
  const npm = npmVersion();
  if (npm !== EXPECTED_NPM) fail(`npm ${EXPECTED_NPM} required, got ${npm}`);
  if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
    fail("the current offline gate requires macOS sandbox-exec");
  }
  const branch = run("git", ["branch", "--show-current"], {
    capture: true,
  }).stdout.trim();
  if (branch !== "codex/unboundry-offline-remediation-2026-08-09") {
    fail(`unexpected branch ${branch}`);
  }
  const versionFile = readFileSync(join(repositoryRoot, ".node-version"), "utf8").trim();
  if (versionFile !== EXPECTED_NODE) fail(".node-version is not pinned correctly");

  const specs = workingSourceFiles()
    .filter((file) => /^tests\/[^/]+\.spec\.ts$/.test(file))
    .sort();
  if (specs.length === 0) fail("no tracked Playwright specs found");
  const directImports = [];
  const forbiddenModifiers = [];
  const skipSites = [];
  for (const file of specs) {
    const source = readFileSync(join(repositoryRoot, file), "utf8");
    if (/from\s+["']@playwright\/test["']/.test(source)) directImports.push(file);
    if (/\b(?:test|describe)\.(?:only|fixme)\s*\(/.test(source)) {
      forbiddenModifiers.push(file);
    }
    if (/\b(?:test|describe)\.skip\s*\(/.test(source)) skipSites.push(file);
  }
  if (directImports.length > 0) {
    fail(`specs bypass safe-test: ${directImports.join(", ")}`);
  }
  if (forbiddenModifiers.length > 0) {
    fail(`only/fixme is forbidden: ${forbiddenModifiers.join(", ")}`);
  }
  if (skipSites.length !== 0) {
    fail(`unexpected skip sites: ${skipSites.join(", ") || "none"}`);
  }

  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, "tests/safe-test-manifest.json"), "utf8"),
  );
  const expectedModes = ["dev", "hybrid", "node", "preview", "self"];
  if (Object.keys(manifest).sort().join("|") !== expectedModes.sort().join("|")) {
    fail("safe-test-manifest.json has unexpected modes");
  }
  const manifested = expectedModes.flatMap((mode) => manifest[mode]).sort();
  if (
    new Set(manifested).size !== manifested.length ||
    manifested.join("\n") !== specs.join("\n")
  ) {
    fail("safe test manifest must be a duplicate-free exact 109-spec partition");
  }
  const expectedModeCounts = { dev: 74, hybrid: 4, node: 21, preview: 2, self: 8 };
  for (const mode of expectedModes) {
    if (manifest[mode].length !== expectedModeCounts[mode]) {
      fail(`unexpected ${mode} spec count ${manifest[mode].length}`);
    }
  }
  if (specs.length !== 109) fail(`expected 109 isolated specs, found ${specs.length}`);

  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );
  if (packageJson.packageManager !== `npm@${EXPECTED_NPM}`) {
    fail(`packageManager must be npm@${EXPECTED_NPM}`);
  }
  console.log(
    JSON.stringify({
      branch,
      node: process.versions.node,
      npm,
      modes: Object.fromEntries(
        expectedModes.map((mode) => [mode, manifest[mode].length]),
      ),
      skipSites: 0,
      specs: specs.length,
      status: "preflight-pass",
    }),
  );
  return specs;
}

async function freePort(excluded = new Set()) {
  return await new Promise((resolvePort, reject) => {
    const candidate = randomInt(42_000, 60_001);
    if (candidate === FORBIDDEN_PORT || excluded.has(candidate)) {
      freePort(excluded).then(resolvePort, reject);
      return;
    }
    const server = net.createServer();
    server.unref();
    server.on("error", (error) => {
      if (error && ["EADDRINUSE", "EACCES"].includes(error.code)) {
        freePort(excluded).then(resolvePort, reject);
      } else reject(error);
    });
    server.listen({ host: "127.0.0.1", port: candidate }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(port);
      });
    });
  });
}

async function assertPortBindable(port) {
  await new Promise((resolveBind, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolveBind();
      });
    });
  });
}

function sandboxProfile(testRoot, sourceRoot) {
  const quote = (value) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const userHome = "/Users/mymy";
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    `(deny network-bind (local ip "localhost:${FORBIDDEN_PORT}"))`,
    `(deny network-inbound (local ip "localhost:${FORBIDDEN_PORT}"))`,
    `(deny network-outbound (remote ip "localhost:${FORBIDDEN_PORT}"))`,
    `(deny file-read* file-write* (subpath "${quote(repositoryRoot)}"))`,
    '(deny file-read* file-write* (subpath "/Users/mymy/Documents"))',
    '(deny file-read* file-write* (subpath "/Users/mymy/Desktop"))',
    '(deny file-read* file-write* (subpath "/Users/mymy/Downloads"))',
    '(deny file-read* file-write* (subpath "/var/lib/unboundry"))',
    '(deny file-read* file-write* (subpath "/Volumes"))',
    `(deny file-read* file-write* (subpath "${quote(join(userHome, ".ssh"))}"))`,
    `(deny file-read* file-write* (subpath "${quote(join(userHome, ".aws"))}"))`,
    `(deny file-read* file-write* (subpath "${quote(join(userHome, ".docker"))}"))`,
    `(deny file-read* file-write* (subpath "${quote(join(userHome, ".config"))}"))`,
    `(deny file-read* file-write* (literal "${quote(join(userHome, ".npmrc"))}"))`,
    `(deny file-read* file-write* (subpath "${quote(join(userHome, "Library/Keychains"))}"))`,
    `(allow file-read* file-write* (subpath "${quote(testRoot)}"))`,
    `(allow file-read* file-write* (subpath "${quote(sourceRoot)}"))`,
  ].join("\n");
}

function sanitizedEnvironment({
  auxiliaryPort,
  auditFile,
  browserRoot,
  dataDirectory,
  port,
  reportFile,
  sourceRoot,
  spec,
  testRoot,
}) {
  const nodeDirectory = dirname(process.execPath);
  const temporaryHome = join(testRoot, "home");
  mkdirSync(temporaryHome, { recursive: true });
  const guard = join(sourceRoot, "scripts/offline-network-guard.mjs");
  const sentinel = join(testRoot, ".unboundry-safe-owner");
  const sentinelNonce = randomUUID();
  writeFileSync(sentinel, `${sentinelNonce}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(sentinel, 0o600);
  return {
    HOME: temporaryHome,
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: `--import=${guard}`,
    PATH: `${nodeDirectory}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    PLAYWRIGHT_BROWSERS_PATH: browserRoot,
    TMP: testRoot,
    TMPDIR: testRoot,
    TEMP: testRoot,
    UNBOUNDRY_DATA_DIR: dataDirectory,
    UNBOUNDRY_SAFE_TEST: "1",
    UNBOUNDRY_SAFE_RUN_NONCE: sentinelNonce,
    UNBOUNDRY_SAFE_RUN_SENTINEL: sentinel,
    UNBOUNDRY_ORIGINAL_REPOSITORY_ROOT: repositoryRoot,
    UNBOUNDRY_SYSTEM_TEMPORARY_ROOT: realpathSync(tmpdir()),
    UNBOUNDRY_TEST_AUX_PORT: String(auxiliaryPort),
    UNBOUNDRY_TEST_NETWORK_AUDIT: auditFile,
    UNBOUNDRY_TEST_PORT: String(port),
    UNBOUNDRY_TEST_PREVIEW:
      basename(spec) === "fixture-production.spec.ts" ||
      basename(spec) === "m79-canvas-smoothness.spec.ts"
        ? "1"
        : "0",
    UNBOUNDRY_TEST_REPORT: reportFile,
    UNBOUNDRY_TEST_REPOSITORY_ROOT: sourceRoot,
    UNBOUNDRY_TEST_ROOT: testRoot,
    UNBOUNDRY_TEST_SPEC: spec,
    UNBOUNDRY_VITE_CACHE_DIR: join(testRoot, "vite-cache"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
}

function collectReportEntries(reportFile, sourceRoot) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const entries = [];
  const visit = (suite, parents = []) => {
    const nextParents = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      const rawFile = spec.file ?? suite.file ?? "unknown";
      const reportedAbsolute = resolve(sourceRoot, rawFile);
      const testDirectoryCandidate = resolve(sourceRoot, "tests", rawFile);
      const absoluteFile =
        !rawFile.includes("/") && existsSync(testDirectoryCandidate)
          ? testDirectoryCandidate
          : reportedAbsolute;
      const file = isInside(sourceRoot, absoluteFile)
        ? relative(sourceRoot, absoluteFile)
        : rawFile;
      for (const test of spec.tests ?? []) {
        const titlePath = [...nextParents, spec.title, test.title]
          .filter(Boolean)
          .join(" > ");
        const project = test.projectName ?? "default";
        entries.push({
          errors: (test.results ?? [])
            .flatMap((result) => result.errors ?? (result.error ? [result.error] : []))
            .map((error) => String(error?.message ?? error).slice(0, 2_000)),
          file,
          id: test.testId ?? `${file}\0${titlePath}\0${project}`,
          project,
          results: test.results ?? [],
          status: test.status,
          titlePath,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, nextParents);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return { entries, report };
}

function parseExecutionReport(reportFile, sourceRoot) {
  const { entries, report } = collectReportEntries(reportFile, sourceRoot);
  const summary = {
    failed: 0,
    failures: [],
    ids: entries.map((entry) => entry.id).sort(),
    passed: 0,
    reportErrors: 0,
    retries: 0,
    skipped: 0,
    tests: entries.length,
  };
  for (const entry of entries) {
    if (entry.results.length > 1) summary.retries += entry.results.length - 1;
    const status = entry.results.at(-1)?.status ?? entry.status ?? "missing";
    if (status === "passed") summary.passed += 1;
    else if (status === "skipped") summary.skipped += 1;
    else {
      summary.failed += 1;
      summary.failures.push({
        errors: entry.errors,
        id: entry.id,
        status,
        title: entry.titlePath,
      });
    }
  }
  for (const error of report.errors ?? []) {
    summary.reportErrors += 1;
    summary.failures.push({
      errors: [String(error?.message ?? error).slice(0, 2_000)],
      id: "report-error",
      status: "error",
      title: "Playwright report error",
    });
  }
  return summary;
}

function parseDiscoveryReport(reportFile, sourceRoot) {
  const { entries, report } = collectReportEntries(reportFile, sourceRoot);
  if ((report.errors ?? []).length > 0) {
    fail(`discovery contained reporter errors: ${JSON.stringify(report.errors)}`);
  }
  const ids = entries.map((entry) => entry.id).sort();
  if (new Set(ids).size !== ids.length) fail("discovery returned duplicate test IDs");
  const files = [...new Set(entries.map((entry) => entry.file))].sort();
  return { files, ids, tests: entries.length };
}

function assertAudit(auditFile, allowedProbePorts = new Set()) {
  const lines = readFileSync(auditFile, "utf8").split("\n").filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));
  const allBlocked = events.filter((event) => String(event.event).includes("blocked"));
  const wildcardHosts = new Set([
    "0.0.0.0",
    "::",
    "0000:0000:0000:0000:0000:0000:0000:0000",
  ]);
  const expectedViteProbes = allBlocked.filter(
    (event) =>
      event.event === "node_network_blocked" &&
      event.kind === "net.Server.listen" &&
      event.reason === "non_loopback" &&
      wildcardHosts.has(event.host) &&
      allowedProbePorts.has(event.port),
  );
  const blocked = allBlocked.filter((event) => !expectedViteProbes.includes(event));
  const loaded = events.filter((event) => event.event === "node_guard_loaded").length;
  if (loaded === 0) fail("offline Node guard did not report loading");
  if (blocked.length > 0) {
    fail(`non-loopback or forbidden network was attempted: ${JSON.stringify(blocked)}`);
  }
  return { blocked: 0, deniedViteWildcardProbes: expectedViteProbes.length, guardLoads: loaded };
}

async function sandboxedPlaywright(sourceRoot, testRoot, env, extraArgs = []) {
  const profile = join(testRoot, "sandbox.sb");
  writeFileSync(profile, sandboxProfile(testRoot, sourceRoot), "utf8");
  const cli = join(sourceRoot, "node_modules/@playwright/test/cli.js");
  return await runManaged(
    "/usr/bin/sandbox-exec",
    [
      "-f",
      profile,
      process.execPath,
      cli,
      "test",
      "--config",
      join(sourceRoot, "playwright.safe.config.ts"),
      ...extraArgs,
    ],
    { allowFailure: true, cwd: sourceRoot, env, timeout: 20 * 60_000 },
  );
}

async function sandboxedNode(sourceRoot, testRoot, env, args, options = {}) {
  const profile = join(testRoot, "sandbox.sb");
  writeFileSync(profile, sandboxProfile(testRoot, sourceRoot), "utf8");
  return await runManaged(
    "/usr/bin/sandbox-exec",
    ["-f", profile, process.execPath, ...args],
    {
      allowFailure: options.allowFailure,
      capture: options.capture,
      cwd: sourceRoot,
      env,
      timeout: options.timeout,
    },
  );
}

async function validateFileAndCredentialIsolation(sourceRoot, testRoot, env) {
  const targets = [
    { path: join(repositoryRoot, "package.json") },
    { path: join(repositoryRoot, "data", "unboundry.sqlite") },
    {
      path: join(repositoryRoot, "backups"),
      writePath: join(repositoryRoot, "backups", ".unboundry-forbidden-write"),
    },
    { path: join(repositoryRoot, ".git", "config") },
  ];
  const program = String.raw`
    import { closeSync, openSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
    const targets = JSON.parse(process.argv[1]);
    const sensitive = Object.keys(process.env).filter((name) =>
      /(?:^|_)(?:AWS|OSS|PROVIDER|API_KEY|ACCESS_KEY|SECRET|TOKEN|CREDENTIAL|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)(?:_|$)/i.test(name),
    );
    if (sensitive.length > 0) throw new Error("sensitive environment leaked: " + sensitive.join(","));
    let denied = 0;
    for (const [index, record] of targets.entries()) {
      const target = record.path;
      const link = process.env.UNBOUNDRY_TEST_ROOT + "/deny-link-" + index;
      symlinkSync(target, link);
      const operations = [
        () => { const descriptor = openSync(target, "r"); closeSync(descriptor); },
        () => statSync(target),
        () => readFileSync(target),
        () => writeFileSync(record.writePath ?? target, "forbidden"),
        () => statSync(link),
        () => readFileSync(link),
      ];
      for (const operation of operations) {
        try {
          operation();
          throw new Error("sandbox unexpectedly allowed real path: " + target);
        } catch (error) {
          if (String(error?.message ?? error).startsWith("sandbox unexpectedly")) throw error;
          if (!["EACCES", "EPERM"].includes(error?.code)) {
            throw new Error("real path was not denied by the kernel: " + target + " (" + error?.code + ")");
          }
          denied += 1;
        }
      }
      unlinkSync(link);
    }
    console.log(JSON.stringify({ credentialKeys: 0, deniedOperations: denied, successfulRealPathOperations: 0 }));
  `;
  const result = await sandboxedNode(
    sourceRoot,
    testRoot,
    env,
    ["--input-type=module", "-e", program, JSON.stringify(targets)],
    { capture: true },
  );
  const evidence = JSON.parse(result.stdout.trim().split("\n").at(-1));
  if (evidence.deniedOperations !== targets.length * 6) {
    fail("file-isolation negative control did not deny every operation");
  }
  console.log(JSON.stringify({ fileIsolation: "pass", ...evidence }));
}

async function validateManagedTimeoutCleanup(sourceRoot, testRoot, env) {
  const evidenceFile = join(testRoot, "managed-timeout.json");
  const program = String.raw`
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    import net from "node:net";
    process.on("SIGTERM", () => {});
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    ], { env: process.env, stdio: "ignore" });
    const server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({
        host: "127.0.0.1",
        port: Number(process.env.UNBOUNDRY_TEST_AUX_PORT),
      }, resolve);
    });
    writeFileSync(process.argv[1], JSON.stringify({
      childPid: child.pid,
      processGroupId: process.pid,
    }));
    setInterval(() => {}, 1000);
  `;
  let timedOutAsExpected = false;
  try {
    await sandboxedNode(
      sourceRoot,
      testRoot,
      env,
      ["--input-type=module", "-e", program, evidenceFile],
      { capture: true, timeout: 250 },
    );
  } catch (error) {
    timedOutAsExpected = String(error?.message ?? error).includes("timed out");
    if (!timedOutAsExpected) throw error;
  }
  if (!timedOutAsExpected || !existsSync(evidenceFile)) {
    fail("managed timeout negative control did not reach its hanging process tree");
  }
  const evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
  if (ownedProcessGroupExists(evidence.processGroupId)) {
    fail("managed timeout left its owned process group running");
  }
  for (const pid of [evidence.processGroupId, evidence.childPid]) {
    try {
      process.kill(pid, 0);
      fail(`managed timeout left pid ${pid} running`);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  await assertPortBindable(Number(env.UNBOUNDRY_TEST_AUX_PORT));
  console.log(JSON.stringify({
    managedTimeoutCleanup: "pass",
    processGroupGone: true,
    testPortReleased: Number(env.UNBOUNDRY_TEST_AUX_PORT),
  }));
}

async function validateSource(sourceRoot, browserRoot, suiteRoot) {
  const testRoot = mkdtempSync(join(suiteRoot, "source-validation-"));
  const dataDirectory = join(testRoot, "data");
  mkdirSync(dataDirectory, { recursive: true });
  const auditFile = join(testRoot, "network-audit.jsonl");
  const reportFile = join(testRoot, "unused-report.json");
  writeFileSync(auditFile, "", "utf8");
  const port = await freePort();
  const auxiliaryPort = await freePort(new Set([port]));
  const env = sanitizedEnvironment({
    auxiliaryPort,
    auditFile,
    browserRoot,
    dataDirectory,
    port,
    reportFile,
    sourceRoot,
    spec: join(sourceRoot, "tests/m0-shell.spec.ts"),
    testRoot,
  });
  const tsc = join(sourceRoot, "node_modules/typescript/bin/tsc");
  const vite = join(sourceRoot, "node_modules/vite/bin/vite.js");

  try {
    await validateFileAndCredentialIsolation(sourceRoot, testRoot, env);
    await sandboxedNode(sourceRoot, testRoot, env, [
      join(sourceRoot, "scripts/check-offline-network-guard.mjs"),
    ]);
    await validateManagedTimeoutCleanup(sourceRoot, testRoot, env);
    await sandboxedNode(sourceRoot, testRoot, env, [
      join(sourceRoot, "scripts/check-greenfield.mjs"),
    ]);
    await sandboxedNode(sourceRoot, testRoot, env, [
      join(sourceRoot, "scripts/check-source-coverage.mjs"),
    ]);
    await sandboxedNode(sourceRoot, testRoot, env, [
      "--test",
      join(sourceRoot, "tests/source-coverage-behavior.test.mjs"),
    ]);
    await sandboxedNode(sourceRoot, testRoot, env, [
      tsc,
      "--project",
      join(sourceRoot, "tsconfig.check.json"),
      "--noEmit",
    ]);
    const listed = (
      await sandboxedNode(
        sourceRoot,
        testRoot,
        env,
        [
          tsc,
          "--project",
          join(sourceRoot, "tsconfig.check.json"),
          "--listFilesOnly",
        ],
        { capture: true },
      )
    ).stdout
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .map((file) => resolve(file))
      .filter(
        (file) =>
          isInside(sourceRoot, file) &&
          !isInside(join(sourceRoot, "node_modules"), file),
      )
      .map((file) => relative(sourceRoot, file))
      .filter((file) => /\.tsx?$/.test(file))
      .sort();
    const trackedTypescript = workingSourceFiles()
      .filter((file) => /\.tsx?$/.test(file))
      .sort();
    const listedSet = new Set(listed);
    const missingTypescript = trackedTypescript.filter((file) => !listedSet.has(file));
    const staleTypescript = listed.filter((file) => !trackedTypescript.includes(file));
    if (missingTypescript.length > 0 || staleTypescript.length > 0) {
      fail(
        `TypeScript coverage differs: ${JSON.stringify({
          missingTypescript,
          staleTypescript,
        })}`,
      );
    }

    const scripts = workingSourceFiles().filter((file) => /\.(?:c?js|mjs)$/.test(file));
    for (const script of scripts) {
      await sandboxedNode(sourceRoot, testRoot, env, ["--check", join(sourceRoot, script)]);
    }
    await sandboxedNode(sourceRoot, testRoot, env, [vite, "build"]);
    await sandboxedNode(sourceRoot, testRoot, env, [
      join(sourceRoot, "scripts/check-restart-persistence.mjs"),
    ]);
    const audit = assertAudit(auditFile, new Set([port, auxiliaryPort]));
    console.log(
      JSON.stringify({
        ...audit,
        javascriptSyntaxChecked: scripts.length,
        sourceValidation: "pass",
        typescriptTracked: trackedTypescript.length,
        typescriptTypechecked: listedSet.size,
      }),
    );
  } finally {
    rmSync(testRoot, { force: true, recursive: true });
  }
}

async function executeSpec(
  spec,
  suiteRoot,
  sourceRoot,
  browserRoot,
  iteration,
  expectedIds,
) {
  const slug = basename(spec, ".spec.ts").replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const testRoot = mkdtempSync(join(suiteRoot, `${String(iteration).padStart(2, "0")}-${slug}-`));
  const dataDirectory = join(testRoot, "data");
  mkdirSync(dataDirectory, { recursive: true });
  const auditFile = join(testRoot, "network-audit.jsonl");
  const reportFile = join(testRoot, "report.json");
  writeFileSync(auditFile, "", "utf8");
  const port = await freePort();
  const auxiliaryPort = await freePort(new Set([port]));
  const env = sanitizedEnvironment({
    auxiliaryPort,
    auditFile,
    browserRoot,
    dataDirectory,
    port,
    reportFile,
    sourceRoot,
    spec: join(sourceRoot, spec),
    testRoot,
  });
  try {
    console.log(`[safe-runner] ${spec} (iteration ${iteration}, ports ${port}/${auxiliaryPort})`);
    const result = await sandboxedPlaywright(sourceRoot, testRoot, env);
    if (!existsSync(reportFile)) fail(`missing Playwright report for ${spec}`);
    const report = parseExecutionReport(reportFile, sourceRoot);
    const audit = assertAudit(auditFile, new Set([port, auxiliaryPort]));
    if (report.ids.join("\n") !== expectedIds.join("\n")) {
      fail(`${spec} executed a different test-ID set than discovery`);
    }
    const ok =
      result.status === 0 &&
      report.failed === 0 &&
      report.reportErrors === 0 &&
      report.skipped === 0 &&
      report.retries === 0 &&
      report.tests === report.passed;
    const summary = { ...audit, ...report, iteration, ok, spec };
    if (!ok) {
      console.error(
        `[safe-runner] product failures in ${spec}: ${JSON.stringify({
          failed: report.failed,
          failures: report.failures,
          skipped: report.skipped,
          status: result.status,
        })}`,
      );
    }
    return summary;
  } finally {
    rmSync(testRoot, { force: true, recursive: true });
  }
}

async function discover(specs, suiteRoot, sourceRoot, browserRoot) {
  const testRoot = mkdtempSync(join(suiteRoot, "discovery-"));
  const dataDirectory = join(testRoot, "data");
  mkdirSync(dataDirectory, { recursive: true });
  const auditFile = join(testRoot, "network-audit.jsonl");
  const reportFile = join(testRoot, "report.json");
  writeFileSync(auditFile, "", "utf8");
  const port = await freePort();
  const auxiliaryPort = await freePort(new Set([port]));
  const env = sanitizedEnvironment({
    auxiliaryPort,
    auditFile,
    browserRoot,
    dataDirectory,
    port,
    reportFile,
    sourceRoot,
    spec: "*",
    testRoot,
  });
  env.UNBOUNDRY_TEST_SPEC = "*";
  try {
    const result = await sandboxedPlaywright(sourceRoot, testRoot, env, ["--list"]);
    if (result.status !== 0 || !existsSync(reportFile)) {
      fail(`test discovery failed in isolated root ${testRoot}`);
    }
    const discovery = parseDiscoveryReport(reportFile, sourceRoot);
    const audit = assertAudit(auditFile, new Set([port, auxiliaryPort]));
    if (discovery.files.join("\n") !== specs.join("\n")) {
      fail(
        `runtime discovery file set differs from the manifest: ${JSON.stringify({
          expected: specs,
          runtime: discovery.files,
        })}`,
      );
    }
    if (discovery.tests !== 804) {
      fail(`the frozen 804-test inventory changed to ${discovery.tests}`);
    }
    const idsByFile = {};
    const { entries } = collectReportEntries(reportFile, sourceRoot);
    for (const spec of specs) {
      idsByFile[spec] = entries
        .filter((entry) => entry.file === spec)
        .map((entry) => entry.id)
        .sort();
      if (idsByFile[spec].length === 0) fail(`discovery found no tests for ${spec}`);
    }
    console.log(
      JSON.stringify({
        ...audit,
        discoveredSpecs: discovery.files.length,
        discoveredTests: discovery.tests,
      }),
    );
    return { ...discovery, idsByFile };
  } finally {
    rmSync(testRoot, { force: true, recursive: true });
  }
}

function selectedSpecs(allSpecs, selectors) {
  if (selectors.length === 0) return allSpecs;
  const selected = allSpecs.filter((file) =>
    selectors.some((selector) => file === selector || file.includes(selector)),
  );
  for (const selector of selectors) {
    const matches = allSpecs.filter(
      (file) => file === selector || file.includes(selector),
    );
    if (matches.length !== 1) {
      fail(`--spec ${selector} must match exactly one tracked spec, got ${matches.length}`);
    }
  }
  return selected;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  listener4173Baseline = listener4173Snapshot();
  workspaceBaseline = workspaceFingerprint();
  const allSpecs = preflight();
  const specs = selectedSpecs(allSpecs, options.specs);
  if (options.command === "preflight") return;

  const systemTemporaryRoot = realpathSync(tmpdir());
  const suiteRoot = mkdtempSync(join(systemTemporaryRoot, "unboundry-safe-suite-"));
  activeSuiteRoot = suiteRoot;
  if (!isInside(systemTemporaryRoot, suiteRoot)) fail("suite root escaped system temp");
  const { browserRoot, sourceRoot } = createTrackedSnapshot(suiteRoot);
  await prepareDependencies(
    sourceRoot,
    browserRoot,
    suiteRoot,
    options.command === "run" || options.command === "full",
  );
  if (options.command === "run" || options.command === "full") {
    await validateSource(sourceRoot, browserRoot, suiteRoot);
  }
  const discovery = await discover(
    allSpecs,
    suiteRoot,
    sourceRoot,
    browserRoot,
  );
  if (options.command === "list") {
    return;
  }

  const summaries = [];
  for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
    for (const spec of specs) {
      summaries.push(
        await executeSpec(
          spec,
          suiteRoot,
          sourceRoot,
          browserRoot,
          iteration,
          discovery.idsByFile[spec],
        ),
      );
    }
  }
  const aggregate = summaries.reduce(
    (value, item) => ({
      blocked: value.blocked + item.blocked,
      deniedViteWildcardProbes:
        value.deniedViteWildcardProbes + item.deniedViteWildcardProbes,
      failed: value.failed + item.failed,
      failures: [...value.failures, ...item.failures.map((failure) => ({ ...failure, spec: item.spec }))],
      passed: value.passed + item.passed,
      reportErrors: value.reportErrors + item.reportErrors,
      retries: value.retries + item.retries,
      skipped: value.skipped + item.skipped,
      tests: value.tests + item.tests,
    }),
    {
      blocked: 0,
      deniedViteWildcardProbes: 0,
      failed: 0,
      failures: [],
      passed: 0,
      reportErrors: 0,
      retries: 0,
      skipped: 0,
      tests: 0,
    },
  );
  const expectedExecutedTests = specs.reduce(
    (count, spec) => count + discovery.idsByFile[spec].length * options.repeat,
    0,
  );
  if (aggregate.tests !== expectedExecutedTests) {
    fail(`execution count ${aggregate.tests} differs from expected ${expectedExecutedTests}`);
  }
  const finalSummary = {
    ...aggregate,
    discoveredSpecs: discovery.files.length,
    discoveredTests: discovery.tests,
    executedSpecs: specs.length,
    expectedExecutedTests,
    node: process.versions.node,
    npm: EXPECTED_NPM,
    repeat: options.repeat,
    source: workspaceBaseline,
  };
  writeFileSync(
    join(suiteRoot, "summary.json"),
    `${JSON.stringify(finalSummary, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(finalSummary));
  if (
    finalSummary.failed !== 0 ||
    finalSummary.reportErrors !== 0 ||
    finalSummary.skipped !== 0 ||
    finalSummary.retries !== 0 ||
    finalSummary.blocked !== 0
  ) {
    fail("one or more product tests failed; see the complete summary above");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => {
    const cleanupErrors = [];
    if (activeSuiteRoot) {
      try {
        rmSync(activeSuiteRoot, { force: true, recursive: true });
        if (existsSync(activeSuiteRoot)) fail(`suite root still exists: ${activeSuiteRoot}`);
        console.log(`[safe-runner] cleaned ${activeSuiteRoot}`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      if (listener4173Baseline !== undefined) {
        const listenerHash = assertListener4173Unchanged();
        console.log(JSON.stringify({ listener4173: "unchanged", listenerHash }));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (workspaceBaseline) {
        const current = workspaceFingerprint();
        if (current.sha256 !== workspaceBaseline.sha256) {
          fail("the original workspace changed while the isolated suite was running");
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      for (const error of cleanupErrors) {
        console.error(error instanceof Error ? error.stack : error);
      }
      process.exitCode = 1;
    }
  });
