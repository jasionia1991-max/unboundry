import { spawn, spawnSync } from "node:child_process";
import { constants as bufferConstants } from "node:buffer";
import {
  chmodSync,
  closeSync,
  constants as fileConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
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
const USER_HOME = "/Users/mymy";
const EXACT_V051_SPEC = "tests/m92-version-compatibility.spec.ts";
const IMMUTABLE_RELEASE_SPEC = "tests/m94-immutable-release.spec.ts";
const EXACT_V051 = Object.freeze({
  annotatedTagObject: "2e556760b693d1cee1b8b37db3e6747a916bcaf2",
  archiveSha256:
    "e7a619c4d9dbaca14d1032ef18f83f81dcfb36c9402976debc4f8f546c8bb5d0",
  commitTree: "0990690bd9828757b82f59861f950ce6ff9ed4f8",
  files: Object.freeze({
    "package.json": "142da3969ae57ca686507377777b67783e9375474282467bc54dd9c77c60fa91",
    "server/canvasPersistence.ts":
      "ec1b2612fc8b974347744eee97bc2428ae1c29ab0c89177f5e50f2ef05923a7b",
    "server/database.ts":
      "3d907b9ea518b5e6ec3c1a03d0c68877cd8a28c49d3d20add173efc777103ed4",
    "vite.config.ts":
      "759d61ec22585cb447e80edd675efd0af1228a61448fd0e6829998ad46065786",
  }),
  peeledCommit: "7f7d6177a564056a6f41ff83dfb7ba913b21603b",
  tag: "v0.5.1",
  trackedEntries: 371,
});
const EXACT_V051_ATTESTATION_CONTRACT =
  "unboundry-v051-safe-runner-attestation-v2";
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = realpathSync(resolve(dirname(scriptPath), ".."));
let activeSuiteRoot;
let exactV051Attestation;
let listener4173Baseline;
let privateNodePath;
let privateNodeRuntimeRoot;
let privateNpmCliPath;
let snapshotBaseline;
let snapshotSourceRoot;
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
  const head = run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
  const files = workingSourceFiles();
  const records = sourceFileRecords(repositoryRoot, files, "workspace source");
  return Object.freeze({
    files: Object.freeze([...files]),
    head,
    sha256: sourceRecordsFingerprint(head, records),
  });
}

function readRegularFileOnce(path, label) {
  const beforeOpen = lstatSync(path, { bigint: true });
  if (
    !beforeOpen.isFile() || beforeOpen.isSymbolicLink() || beforeOpen.nlink !== 1n
  ) fail(`${label} only accepts regular single-linked files`);
  const descriptor = openSync(
    path,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const afterOpen = lstatSync(path, { bigint: true });
    if (
      !opened.isFile() || opened.nlink !== 1n ||
      !afterOpen.isFile() || afterOpen.isSymbolicLink() || afterOpen.nlink !== 1n
    ) {
      fail(`${label} only accepts regular single-linked files`);
    }
    for (const current of [opened, afterOpen]) {
      if (
        current.dev !== beforeOpen.dev || current.ino !== beforeOpen.ino ||
        current.mode !== beforeOpen.mode || current.size !== beforeOpen.size ||
        current.mtimeNs !== beforeOpen.mtimeNs || current.ctimeNs !== beforeOpen.ctimeNs
      ) fail(`${label} changed while it was opened`);
    }
    if (opened.size > BigInt(bufferConstants.MAX_LENGTH)) {
      fail(`${label} exceeds the safe file-size limit`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read === 0) fail(`${label} changed while it was read`);
      offset += read;
    }
    const afterReadDescriptor = fstatSync(descriptor, { bigint: true });
    const afterReadPath = lstatSync(path, { bigint: true });
    for (const current of [afterReadDescriptor, afterReadPath]) {
      if (
        !current.isFile() || current.dev !== opened.dev ||
        current.ino !== opened.ino || current.mode !== opened.mode ||
        current.nlink !== opened.nlink || current.size !== opened.size ||
        current.mtimeNs !== opened.mtimeNs || current.ctimeNs !== opened.ctimeNs
      ) fail(`${label} changed while it was read`);
    }
    if (afterReadPath.isSymbolicLink()) fail(`${label} changed while it was read`);
    return Object.freeze({
      bytes,
      mode: Number(opened.mode),
      size: Number(opened.size),
    });
  } finally {
    closeSync(descriptor);
  }
}

function sourceFileRecords(root, files, label) {
  return files.map((file) => {
    const lexicalPath = join(root, file);
    let parent;
    try {
      parent = realpathSync(dirname(lexicalPath));
    } catch {
      fail(`${label} parent is missing: ${file}`);
    }
    if (!isInside(root, parent)) fail(`${label} parent escaped: ${file}`);
    const path = join(parent, basename(file));
    if (path !== lexicalPath) fail(`${label} path changed: ${file}`);
    const record = readRegularFileOnce(path, `${label} ${file}`);
    return Object.freeze({ file, ...record });
  });
}

function sourceRecordsFingerprint(head, records) {
  const hash = createHash("sha256");
  hash.update(`${head}\0`);
  for (const { bytes, file, mode, size } of records) {
    hash.update(`${file}\0${mode}\0${size}\0`);
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function snapshotFingerprint(sourceRoot, files, head) {
  const records = sourceFileRecords(sourceRoot, files, "tracked snapshot");
  return Object.freeze({
    files: Object.freeze([...files]),
    head,
    sha256: sourceRecordsFingerprint(head, records),
  });
}

function snapshotUnexpectedFiles(sourceRoot, expectedFiles) {
  const expected = new Set(expectedFiles);
  const unexpected = [];
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (
        prefix === "" &&
        (name === ".git" || name === "dist" || name === "node_modules")
      ) continue;
      const absolutePath = join(directory, name);
      const details = lstatSync(absolutePath);
      if (details.isDirectory() && !details.isSymbolicLink()) {
        walk(absolutePath, path);
      } else if (!expected.has(path)) {
        unexpected.push(path);
      }
    }
  };
  try {
    walk(sourceRoot);
  } catch {
    return ["<unreadable-snapshot-tree>"];
  }
  return unexpected;
}

function assertTrackedSnapshotUnchanged() {
  if (!snapshotBaseline || !snapshotSourceRoot) return;
  const current = snapshotFingerprint(
    snapshotSourceRoot,
    snapshotBaseline.files,
    snapshotBaseline.head,
  );
  if (
    current.files.join("\n") !== snapshotBaseline.files.join("\n") ||
    current.sha256 !== snapshotBaseline.sha256 ||
    snapshotUnexpectedFiles(snapshotSourceRoot, snapshotBaseline.files).length > 0
  ) {
    fail("the isolated tracked source snapshot changed during the safe run");
  }
  return current.sha256;
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
  const head = run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
  const files = [...workspaceBaseline.files];
  const records = sourceFileRecords(repositoryRoot, files, "workspace source");
  const capturedWorkspace = Object.freeze({
    head,
    sha256: sourceRecordsFingerprint(head, records),
  });
  if (capturedWorkspace.sha256 !== workspaceBaseline.sha256) {
    fail("the original workspace changed while its isolated snapshot was captured");
  }
  for (const { bytes, file, mode } of records) {
    const destination = join(sourceRoot, file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: "wx", mode: mode & 0o777 });
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
  const installedNodeRuntimeRoot = realpathSync(
    resolve(dirname(process.execPath), ".."),
  );
  privateNodeRuntimeRoot = join(suiteRoot, "node-runtime");
  run("/bin/cp", ["-cR", installedNodeRuntimeRoot, privateNodeRuntimeRoot]);
  privateNodeRuntimeRoot = realpathSync(privateNodeRuntimeRoot);
  privateNodePath = realpathSync(join(privateNodeRuntimeRoot, "bin/node"));
  privateNpmCliPath = realpathSync(
    join(privateNodeRuntimeRoot, "lib/node_modules/npm/bin/npm-cli.js"),
  );
  return { browserRoot, capturedWorkspace, files, sourceRoot };
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
    const npmCli = privateNpmCliPath;
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
    fail("safe test manifest must be a duplicate-free exact 117-spec partition");
  }
  const expectedModeCounts = { dev: 74, hybrid: 4, node: 28, preview: 2, self: 9 };
  for (const mode of expectedModes) {
    if (manifest[mode].length !== expectedModeCounts[mode]) {
      fail(`unexpected ${mode} spec count ${manifest[mode].length}`);
    }
  }
  if (specs.length !== 117) fail(`expected 117 isolated specs, found ${specs.length}`);

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

function sandboxProfile(testRoot, sourceRoot, configuredBrowserRoot) {
  const quote = (value) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  if (!privateNodeRuntimeRoot || !privateNodePath || !privateNpmCliPath) {
    fail("the isolated Node runtime is not prepared");
  }
  const browserRoot = realpathSync(configuredBrowserRoot);
  if (
    [testRoot, sourceRoot, browserRoot, privateNodeRuntimeRoot].some((path) =>
      isInside(USER_HOME, path)
    )
  ) fail("isolated safe-runner roots must remain outside the real user home");
  const denyExcept = (operation, root, exceptions) => {
    const outsideExceptions = exceptions.length === 1
      ? `(require-not (subpath "${quote(exceptions[0])}"))`
      : `(require-not (require-any ${
        exceptions.map((path) => `(subpath "${quote(path)}")`).join(" ")
      }))`;
    return `(deny ${operation} (require-all (subpath "${quote(root)}") ${outsideExceptions}))`;
  };
  const sourceWritableRoots = [
    join(sourceRoot, "dist"),
    join(sourceRoot, "node_modules"),
  ];
  const rules = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    `(deny network-bind (local ip "localhost:${FORBIDDEN_PORT}"))`,
    `(deny network-inbound (local ip "localhost:${FORBIDDEN_PORT}"))`,
    `(deny network-outbound (remote ip "localhost:${FORBIDDEN_PORT}"))`,
    `(deny file-read* file-write* (subpath "${quote(USER_HOME)}"))`,
    `(deny file-read* file-write* (subpath "${quote(repositoryRoot)}"))`,
    '(deny file-read* file-write* (subpath "/var/lib/unboundry"))',
    '(deny file-read* file-write* (subpath "/Volumes"))',
    `(allow file-read* (subpath "${quote(privateNodeRuntimeRoot)}"))`,
    `(deny file-write* (subpath "${quote(privateNodeRuntimeRoot)}"))`,
    `(allow file-read* file-write* (subpath "${quote(testRoot)}"))`,
    `(allow file-read* (subpath "${quote(browserRoot)}"))`,
    `(deny file-write* (subpath "${quote(browserRoot)}"))`,
    `(allow file-read* (subpath "${quote(sourceRoot)}"))`,
    denyExcept("file-write*", sourceRoot, sourceWritableRoots),
    ...sourceWritableRoots.map((path) =>
      `(allow file-write* (subpath "${quote(path)}"))`
    ),
  ];
  if (exactV051Attestation) {
    rules.push(
      `(allow file-read* (subpath "${quote(exactV051Attestation.root)}"))`,
      `(deny file-write* (subpath "${quote(exactV051Attestation.root)}"))`,
      `(allow file-read* (subpath "${quote(exactV051Attestation.runtimeRoot)}"))`,
      `(deny file-write* (subpath "${quote(exactV051Attestation.runtimeRoot)}"))`,
    );
  }
  return rules.join("\n");
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
  if (!privateNodePath) fail("the isolated Node runtime is not prepared");
  const nodeDirectory = dirname(privateNodePath);
  const temporaryHome = join(testRoot, "home");
  mkdirSync(temporaryHome, { recursive: true });
  const guard = join(sourceRoot, "scripts/offline-network-guard.mjs");
  const sentinel = join(testRoot, ".unboundry-safe-owner");
  const sentinelNonce = randomUUID();
  writeFileSync(sentinel, `${sentinelNonce}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(sentinel, 0o600);
  const environment = {
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
  for (const name of [
    "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION",
    "UNBOUNDRY_MAINTENANCE_MODE",
    "UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK",
    "UNBOUNDRY_TEST_AUTH_BYPASS",
  ]) {
    delete environment[name];
  }
  return environment;
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
  const auditDetails = lstatSync(auditFile);
  if (
    !auditDetails.isFile() || auditDetails.isSymbolicLink() ||
    auditDetails.nlink !== 1
  ) fail("network audit is not a regular single-linked file");
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
  writeFileSync(
    profile,
    sandboxProfile(testRoot, sourceRoot, env.PLAYWRIGHT_BROWSERS_PATH),
    "utf8",
  );
  const cli = join(sourceRoot, "node_modules/@playwright/test/cli.js");
  return await runManaged(
    "/usr/bin/sandbox-exec",
    [
      "-f",
      profile,
      privateNodePath,
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
  writeFileSync(
    profile,
    sandboxProfile(testRoot, sourceRoot, env.PLAYWRIGHT_BROWSERS_PATH),
    "utf8",
  );
  return await runManaged(
    "/usr/bin/sandbox-exec",
    ["-f", profile, privateNodePath, ...args],
    {
      allowFailure: options.allowFailure,
      capture: options.capture,
      cwd: options.cwd ?? sourceRoot,
      env,
      timeout: options.timeout,
    },
  );
}

async function sandboxedCommand(
  sourceRoot,
  testRoot,
  env,
  command,
  args,
  options = {},
) {
  const profile = join(testRoot, "sandbox.sb");
  writeFileSync(
    profile,
    sandboxProfile(testRoot, sourceRoot, env.PLAYWRIGHT_BROWSERS_PATH),
    "utf8",
  );
  return await runManaged(
    "/usr/bin/sandbox-exec",
    ["-f", profile, command, ...args],
    {
      allowFailure: options.allowFailure,
      capture: options.capture,
      cwd: options.cwd ?? sourceRoot,
      env,
      timeout: options.timeout,
    },
  );
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobObjectId(value) {
  return createHash("sha1")
    .update(`blob ${value.length}\0`)
    .update(value)
    .digest("hex");
}

function exactV051GitBytes(path) {
  const result = spawnSync(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "-C",
      repositoryRoot,
      "show",
      `${EXACT_V051.peeledCommit}:${path}`,
    ],
    {
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail(`could not read exact ${EXACT_V051.peeledCommit}:${path}`);
  }
  return result.stdout;
}

function exactV051TreeEntries() {
  const result = spawnSync(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "-C",
      repositoryRoot,
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      EXACT_V051.peeledCommit,
    ],
    {
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail("could not list the immutable exact v0.5.1 commit tree");
  }
  const entries = result.stdout.toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^([0-7]{6}) (\S+) ([a-f0-9]{40})\t(.+)$/.exec(record);
      if (!match) fail("exact v0.5.1 commit tree contains an invalid entry");
      const [, mode, type, objectId, path] = match;
      if (
        mode !== "100644" || type !== "blob" || path.startsWith("/") ||
        path.split("/").some((part) => part === "" || part === "." || part === "..")
      ) fail(`exact v0.5.1 commit tree contains an unsupported entry: ${path}`);
      return Object.freeze({ objectId, path });
    });
  if (
    entries.length !== EXACT_V051.trackedEntries ||
    new Set(entries.map(({ path }) => path)).size !== entries.length ||
    entries.some(({ path }) => path === "dist" || path.startsWith("dist/") ||
      path === "node_modules" || path.startsWith("node_modules/"))
  ) fail("exact v0.5.1 complete-tree inventory does not match the frozen contract");
  return entries;
}

function validateExactV051GitObject() {
  const tagObject = run(
    "/usr/bin/git",
    ["--no-replace-objects", "rev-parse", EXACT_V051.tag],
    { capture: true },
  ).stdout.trim();
  const peeledCommit = run(
    "/usr/bin/git",
    ["--no-replace-objects", "rev-parse", `${EXACT_V051.tag}^{}`],
    { capture: true },
  ).stdout.trim();
  const objectType = run(
    "/usr/bin/git",
    ["--no-replace-objects", "cat-file", "-t", EXACT_V051.annotatedTagObject],
    { capture: true },
  ).stdout.trim();
  const pinnedPeeledCommit = run(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "rev-parse",
      `${EXACT_V051.annotatedTagObject}^{}`,
    ],
    { capture: true },
  ).stdout.trim();
  const commitType = run(
    "/usr/bin/git",
    ["--no-replace-objects", "cat-file", "-t", EXACT_V051.peeledCommit],
    { capture: true },
  ).stdout.trim();
  const commitTree = run(
    "/usr/bin/git",
    ["--no-replace-objects", "rev-parse", `${EXACT_V051.peeledCommit}^{tree}`],
    { capture: true },
  ).stdout.trim();
  const treeType = run(
    "/usr/bin/git",
    ["--no-replace-objects", "cat-file", "-t", EXACT_V051.commitTree],
    { capture: true },
  ).stdout.trim();
  if (
    tagObject !== EXACT_V051.annotatedTagObject ||
    peeledCommit !== EXACT_V051.peeledCommit ||
    pinnedPeeledCommit !== EXACT_V051.peeledCommit ||
    commitTree !== EXACT_V051.commitTree || objectType !== "tag" ||
    commitType !== "commit" || treeType !== "tree"
  ) {
    fail(
      "exact v0.5.1 tag, commit, or complete tree identity does not match the frozen contract",
    );
  }
  for (const [path, expectedSha256] of Object.entries(EXACT_V051.files)) {
    if (sha256Bytes(exactV051GitBytes(path)) !== expectedSha256) {
      fail(`exact v0.5.1 blob hash changed: ${path}`);
    }
  }
}

function validateExtractedExactV051Files(
  runtimeRoot,
  { allowBuildOutputs = false } = {},
) {
  const entries = exactV051TreeEntries();
  const expectedPaths = entries.map(({ path }) => path).sort();
  const actualPaths = [];
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      const absolutePath = join(directory, name);
      const details = lstatSync(absolutePath);
      if (
        allowBuildOutputs && prefix === "" &&
        (name === "dist" || name === "node_modules")
      ) {
        if (!details.isDirectory() || details.isSymbolicLink()) {
          fail(`exact v0.5.1 build output root is unsafe: ${path}`);
        }
        continue;
      }
      if (details.isDirectory() && !details.isSymbolicLink()) {
        walk(absolutePath, path);
      } else {
        actualPaths.push(path);
      }
    }
  };
  walk(runtimeRoot);
  actualPaths.sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    fail("extracted exact v0.5.1 complete-tree inventory changed");
  }
  for (const { objectId, path } of entries) {
    const extractedPath = join(runtimeRoot, path);
    const details = lstatSync(extractedPath);
    const bytes = readFileSync(extractedPath);
    if (
      !details.isFile() || details.isSymbolicLink() || details.nlink !== 1 ||
      (details.mode & 0o777) !== 0o644 || gitBlobObjectId(bytes) !== objectId
    ) fail(`extracted exact-tag tree entry does not match: ${path}`);
  }
  for (const [path, expectedSha256] of Object.entries(EXACT_V051.files)) {
    const extractedPath = join(runtimeRoot, path);
    const details = lstatSync(extractedPath);
    if (
      !details.isFile() || details.isSymbolicLink() ||
      sha256Bytes(readFileSync(extractedPath)) !== expectedSha256
    ) fail(`extracted exact-tag blob does not match: ${path}`);
  }
  const packageJson = JSON.parse(readFileSync(join(runtimeRoot, "package.json"), "utf8"));
  if (packageJson.version !== "0.5.1") {
    fail("extracted exact-tag package version is not 0.5.1");
  }
}

function extractExactV051Runtime(runtimeRoot) {
  const archive = spawnSync(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "-c",
      "tar.umask=0002",
      "-C",
      repositoryRoot,
      "archive",
      "--format=tar",
      EXACT_V051.peeledCommit,
    ],
    {
      encoding: null,
      maxBuffer: 256 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (archive.error) throw archive.error;
  if (archive.status !== 0 || !Buffer.isBuffer(archive.stdout)) {
    fail("could not archive the immutable exact v0.5.1 commit");
  }
  const archiveSha256 = sha256Bytes(archive.stdout);
  if (archiveSha256 !== EXACT_V051.archiveSha256) {
    fail("exact v0.5.1 complete-tree archive does not match the frozen contract");
  }
  const extracted = spawnSync(
    "/usr/bin/tar",
    ["-x", "-C", runtimeRoot],
    {
      encoding: "utf8",
      input: archive.stdout,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (extracted.error) throw extracted.error;
  if (extracted.status !== 0) {
    process.stderr.write(extracted.stderr ?? "");
    fail("could not extract the exact v0.5.1 tag archive");
  }
  validateExtractedExactV051Files(runtimeRoot);
  return archiveSha256;
}

function validateExactV051RawEvidence(raw, nonce) {
  const shaPattern = /^[a-f0-9]{64}$/;
  if (
    !raw || typeof raw !== "object" ||
    raw.contract !== "unboundry-v051-exact-runtime-rehearsal-v3" ||
    raw.nonce !== nonce ||
    !raw.schema37Wire || !raw.schema39Rejection
  ) fail("exact v0.5.1 rehearsal did not produce the required evidence contract");
  const schema37 = raw.schema37Wire;
  if (
    schema37.acceptsCurrentFenceFields !== true ||
    schema37.hiddenCommitGraphRevision !== 8 ||
    schema37.hiddenCommitRevision !== 8 ||
    schema37.loadIncludesLoadToken !== false || schema37.loginStatus !== 200 ||
    schema37.oldSuccessIncludesLoadToken !== false ||
    schema37.preservesUnknownNodeData !== true || schema37.reloadRevision !== 8 ||
    schema37.version !== "0.5.1" || schema37.versionStatus !== 200 ||
    !shaPattern.test(String(schema37.initialSchema37LogicalSha256 ?? "")) ||
    !shaPattern.test(String(schema37.hiddenCommitLogicalSha256 ?? "")) ||
    schema37.hiddenCommitLogicalSha256 ===
      schema37.initialSchema37LogicalSha256
  ) fail("exact v0.5.1 schema-37 wire rehearsal is incomplete");
  const schema39 = raw.schema39Rejection;
  if (
    !shaPattern.test(String(schema39.beforeLogicalSha256 ?? "")) ||
    schema39.afterLogicalSha256 !== schema39.beforeLogicalSha256 ||
    schema39.databaseBytesChanged !== true ||
    schema39.firstDatabaseRequestFailed !== true ||
    schema39.integrityCheck !== "ok" || schema39.journalModeBefore !== "delete" ||
    schema39.journalModeAfter !== "wal" || schema39.logicalRowsUnchanged !== true ||
    schema39.migrationJournalModeBeforeNormalization !== "wal" ||
    !Number.isInteger(schema39.processExitCode) || schema39.processExitCode === 0 ||
    schema39.rejectionMessage !==
      "Unknown database migration 38:durable-media-publications" ||
    schema39.requestTransportFailed !== true ||
    !Array.isArray(schema39.sidecarsAfterExit) ||
    schema39.sidecarsAfterExit.length > 2 ||
    new Set(schema39.sidecarsAfterExit).size !==
      schema39.sidecarsAfterExit.length ||
    schema39.sidecarsAfterExit.some((entry) =>
      entry !== "unboundry.sqlite-shm" && entry !== "unboundry.sqlite-wal"
    ) ||
    JSON.stringify(schema39.sidecarsAfterExit) !==
      JSON.stringify([...schema39.sidecarsAfterExit].sort()) ||
    schema39.rollbackBaselineNormalizedByCurrent !== true ||
    JSON.stringify(schema39.rollbackCheckpoint) !==
      JSON.stringify({ busy: 0, checkpointed: 0, log: 0 }) ||
    schema39.userVersion !== 39 ||
    schema39.versionEndpointBeforeDatabaseOpen !== true ||
    schema39.latestMigration?.version !== 39 ||
    schema39.latestMigration?.name !==
      "atomic-generation-admission-and-credential-scope"
  ) fail("exact v0.5.1 schema-39 rejection rehearsal is incomplete");
}

function exactV051AttestationEnvironment() {
  if (!exactV051Attestation) {
    fail("exact v0.5.1 runner attestation was not prepared");
  }
  return {
    UNBOUNDRY_V051_ATTESTATION_NONCE: exactV051Attestation.nonce,
    UNBOUNDRY_V051_ATTESTATION_PATH: exactV051Attestation.path,
    UNBOUNDRY_V051_ATTESTATION_SHA256: exactV051Attestation.sha256,
    UNBOUNDRY_V051_RUNTIME_ROOT: exactV051Attestation.runtimeRoot,
  };
}

function assertExactV051AttestationUnchanged() {
  if (!exactV051Attestation) return;
  let currentDetails;
  let root;
  let evidence;
  let bytes;
  try {
    root = lstatSync(exactV051Attestation.root);
    evidence = lstatSync(exactV051Attestation.path);
    bytes = readFileSync(exactV051Attestation.path);
    currentDetails = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("exact v0.5.1 runner attestation is unreadable or invalid");
  }
  if (
    realpathSync(exactV051Attestation.root) !== exactV051Attestation.root ||
    realpathSync(exactV051Attestation.path) !== exactV051Attestation.path ||
    !root.isDirectory() || root.isSymbolicLink() ||
    (root.mode & 0o777) !== 0o500 ||
    !evidence.isFile() || evidence.isSymbolicLink() || evidence.nlink !== 1 ||
    (evidence.mode & 0o777) !== 0o400 ||
    sha256Bytes(bytes) !== exactV051Attestation.sha256 ||
    JSON.stringify(currentDetails) !== JSON.stringify(exactV051Attestation.details)
  ) fail("exact v0.5.1 runner attestation changed after preparation");
}

async function prepareExactV051Attestation(sourceRoot, browserRoot, suiteRoot) {
  validateExactV051GitObject();
  const rehearsalRoot = mkdtempSync(join(suiteRoot, "exact-v051-rehearsal-"));
  chmodSync(rehearsalRoot, 0o700);
  const runtimeRoot = join(rehearsalRoot, "runtime");
  const workRoot = join(rehearsalRoot, "work");
  const runnerDataDirectory = join(rehearsalRoot, "runner-data");
  const cacheRoot = join(rehearsalRoot, "npm-cache");
  const attestationRoot = join(rehearsalRoot, "attestation");
  for (const directory of [
    runtimeRoot,
    workRoot,
    runnerDataDirectory,
    cacheRoot,
    attestationRoot,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const archiveSha256 = extractExactV051Runtime(runtimeRoot);
  const auditFile = join(rehearsalRoot, "network-audit.jsonl");
  const reportFile = join(rehearsalRoot, "unused-report.json");
  const rawEvidencePath = join(workRoot, "raw-evidence.json");
  const attestationPath = join(attestationRoot, "attestation.json");
  writeFileSync(auditFile, "", { encoding: "utf8", mode: 0o600 });
  chmodSync(auditFile, 0o600);
  writeFileSync(join(rehearsalRoot, "empty-npmrc"), "", "utf8");
  writeFileSync(join(rehearsalRoot, "empty-global-npmrc"), "", "utf8");
  const port = await freePort();
  const auxiliaryPort = await freePort(new Set([port]));
  const env = sanitizedEnvironment({
    auxiliaryPort,
    auditFile,
    browserRoot,
    dataDirectory: runnerDataDirectory,
    port,
    reportFile,
    sourceRoot,
    spec: join(sourceRoot, EXACT_V051_SPEC),
    testRoot: rehearsalRoot,
  });
  const cacheSource = "/Users/mymy/.npm/_cacache";
  if (!existsSync(cacheSource)) {
    fail("the prepared npm cache required for exact v0.5.1 is missing");
  }
  run("/bin/cp", ["-cR", cacheSource, join(cacheRoot, "_cacache")]);
  env.npm_config_cache = cacheRoot;
  env.npm_config_globalconfig = join(rehearsalRoot, "empty-global-npmrc");
  env.npm_config_userconfig = join(rehearsalRoot, "empty-npmrc");
  const npmCli = privateNpmCliPath;
  if (!lstatSync(npmCli).isFile()) {
    fail("the pinned npm CLI required for exact v0.5.1 is missing");
  }
  const dependencyInputs = ["package.json", "package-lock.json"];
  const dependencyHashes = () => Object.fromEntries(
    dependencyInputs.map((file) => [
      file,
      sha256Bytes(readFileSync(join(runtimeRoot, file))),
    ]),
  );
  const dependencyHashesBefore = dependencyHashes();
  await sandboxedNode(sourceRoot, rehearsalRoot, env, [
    npmCli,
    "ci",
    "--offline",
    "--ignore-scripts",
    "--audit=false",
    "--fund=false",
  ], { cwd: runtimeRoot, timeout: 10 * 60_000 });
  if (JSON.stringify(dependencyHashes()) !== JSON.stringify(dependencyHashesBefore)) {
    fail("exact v0.5.1 npm ci changed package.json or package-lock.json");
  }
  await sandboxedNode(sourceRoot, rehearsalRoot, env, [npmCli, "ls", "--all"], {
    capture: true,
    cwd: runtimeRoot,
    timeout: 5 * 60_000,
  });
  await sandboxedNode(sourceRoot, rehearsalRoot, env, [
    join(runtimeRoot, "node_modules/typescript/bin/tsc"),
    "--noEmit",
  ], { cwd: runtimeRoot, timeout: 5 * 60_000 });
  await sandboxedNode(sourceRoot, rehearsalRoot, env, [
    join(runtimeRoot, "node_modules/vite/bin/vite.js"),
    "build",
  ], { cwd: runtimeRoot, timeout: 5 * 60_000 });
  const builtIndex = join(runtimeRoot, "dist/client/index.html");
  const builtIndexDetails = lstatSync(builtIndex);
  if (!builtIndexDetails.isFile() || builtIndexDetails.isSymbolicLink()) {
    fail("exact v0.5.1 build did not publish dist/client/index.html");
  }
  const nonce = randomUUID();
  const checker = join(sourceRoot, "scripts/check-v051-exact-runtime.mjs");
  await sandboxedNode(
    sourceRoot,
    rehearsalRoot,
    env,
    [checker, JSON.stringify({
      nonce,
      outputPath: rawEvidencePath,
      port: auxiliaryPort,
      runtimeRoot,
      workRoot,
    })],
    { capture: true, timeout: 5 * 60_000 },
  );
  validateExtractedExactV051Files(runtimeRoot, { allowBuildOutputs: true });
  const rawEvidenceDetails = lstatSync(rawEvidencePath);
  if (
    !rawEvidenceDetails.isFile() || rawEvidenceDetails.isSymbolicLink() ||
    rawEvidenceDetails.nlink !== 1 || (rawEvidenceDetails.mode & 0o777) !== 0o400
  ) fail("exact v0.5.1 raw evidence is not a private immutable file");
  const rawEvidence = JSON.parse(readFileSync(rawEvidencePath, "utf8"));
  validateExactV051RawEvidence(rawEvidence, nonce);
  const audit = assertAudit(auditFile, new Set([port, auxiliaryPort]));
  const attestation = Object.freeze({
    build: Object.freeze({
      npmCiOffline: true,
      npmIgnoreScripts: true,
      typescriptNoEmit: true,
      viteBuild: true,
    }),
    contract: EXACT_V051_ATTESTATION_CONTRACT,
    exactTag: Object.freeze({
      annotatedTagObject: EXACT_V051.annotatedTagObject,
      archiveSha256,
      commitTree: EXACT_V051.commitTree,
      completeTreeVerified: true,
      files: EXACT_V051.files,
      peeledCommit: EXACT_V051.peeledCommit,
      tag: EXACT_V051.tag,
      trackedEntries: EXACT_V051.trackedEntries,
    }),
    network: Object.freeze({
      blocked: audit.blocked,
      forbiddenPort: FORBIDDEN_PORT,
      loopbackPort: auxiliaryPort,
    }),
    nonce,
    rehearsal: rawEvidence,
    runtimeRoot,
    source: Object.freeze({
      head: workspaceBaseline.head,
      sha256: workspaceBaseline.sha256,
    }),
  });
  writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o400,
  });
  chmodSync(attestationPath, 0o400);
  chmodSync(attestationRoot, 0o500);
  exactV051Attestation = Object.freeze({
    details: attestation,
    nonce,
    path: attestationPath,
    root: attestationRoot,
    runtimeRoot,
    sha256: sha256Bytes(readFileSync(attestationPath)),
  });
  assertExactV051AttestationUnchanged();
  console.log(JSON.stringify({
    exactV051: "attested",
    evidenceSha256: exactV051Attestation.sha256,
    externalNetworkAttempts: audit.blocked,
    forbiddenPort: FORBIDDEN_PORT,
  }));
}

async function validateFileAndCredentialIsolation(sourceRoot, testRoot, env) {
  const targets = [
    {
      label: "live package manifest",
      operations: [
        "direct-open", "direct-stat", "direct-read", "direct-write",
        "symlink-stat", "symlink-read",
      ],
      path: join(repositoryRoot, "package.json"),
    },
    {
      label: "live application database",
      operations: [
        "direct-open", "direct-stat", "direct-read", "direct-write",
        "symlink-stat", "symlink-read",
      ],
      path: join(repositoryRoot, "data", "unboundry.sqlite"),
    },
    {
      label: "live backup directory",
      operations: [
        "direct-open", "direct-stat", "direct-read", "direct-write",
        "symlink-stat", "symlink-read",
      ],
      path: join(repositoryRoot, "backups"),
      writePath: join(repositoryRoot, "backups", ".unboundry-forbidden-write"),
    },
    {
      label: "live Git configuration",
      operations: [
        "direct-open", "direct-stat", "direct-read", "direct-write",
        "symlink-stat", "symlink-read",
      ],
      path: join(repositoryRoot, ".git", "config"),
    },
    {
      label: "isolated tracked source",
      operations: ["direct-write", "symlink-write"],
      path: join(sourceRoot, "package.json"),
    },
    {
      label: "isolated tracked source new entry",
      operations: ["direct-write"],
      path: join(sourceRoot, "package.json"),
      writePath: join(sourceRoot, ".unboundry-forbidden-create"),
    },
    {
      label: "isolated browser runtime",
      operations: ["direct-write", "symlink-write"],
      path: join(
        realpathSync(env.PLAYWRIGHT_BROWSERS_PATH),
        "chromium-1234",
        "INSTALLATION_COMPLETE",
      ),
    },
    {
      label: "isolated browser runtime new entry",
      operations: ["direct-write"],
      path: join(
        realpathSync(env.PLAYWRIGHT_BROWSERS_PATH),
        "chromium-1234",
        "INSTALLATION_COMPLETE",
      ),
      writePath: join(
        realpathSync(env.PLAYWRIGHT_BROWSERS_PATH),
        ".unboundry-forbidden-create",
      ),
    },
    {
      label: "isolated Node runtime",
      operations: ["direct-write", "symlink-write"],
      path: privateNodePath,
    },
    {
      label: "isolated Node runtime new entry",
      operations: ["direct-write"],
      path: privateNodePath,
      writePath: join(privateNodeRuntimeRoot, ".unboundry-forbidden-create"),
    },
  ];
  const credentialPath = join(USER_HOME, ".codex", "auth.json");
  const credentialFilePresent = existsSync(credentialPath);
  if (credentialFilePresent) {
    targets.push({
      credential: true,
      label: "real user credential",
      operations: ["direct-read", "symlink-read"],
      path: credentialPath,
    });
  }
  const expectedDeniedOperations = targets.reduce(
    (count, target) => count + target.operations.length,
    0,
  );
  const program = String.raw`
    import { closeSync, openSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
    const targets = JSON.parse(process.argv[1]);
    const sensitive = Object.keys(process.env).filter((name) =>
      /(?:^|_)(?:AWS|OSS|PROVIDER|API_KEY|ACCESS_KEY|SECRET|TOKEN|CREDENTIAL|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)(?:_|$)/i.test(name),
    );
    if (sensitive.length > 0) throw new Error("sensitive environment leaked: " + sensitive.join(","));
    let denied = 0;
    let credentialReadControls = 0;
    for (const [index, record] of targets.entries()) {
      const target = record.path;
      const link = process.env.UNBOUNDRY_TEST_ROOT + "/deny-link-" + index;
      symlinkSync(target, link);
      const operations = {
        "direct-open": () => { const descriptor = openSync(target, "r"); closeSync(descriptor); },
        "direct-stat": () => statSync(target),
        "direct-read": () => { readFileSync(target); },
        "direct-write": () => writeFileSync(record.writePath ?? target, "forbidden"),
        "symlink-stat": () => statSync(link),
        "symlink-read": () => { readFileSync(link); },
        "symlink-write": () => writeFileSync(link, "forbidden"),
      };
      for (const operationName of record.operations) {
        const operation = operations[operationName];
        if (!operation) throw new Error("unknown file-isolation operation");
        try {
          operation();
          throw new Error(
            "sandbox unexpectedly allowed " + record.label + " operation " + operationName
          );
        } catch (error) {
          if (String(error?.message ?? error).startsWith("sandbox unexpectedly")) throw error;
          if (!["EACCES", "EPERM"].includes(error?.code)) {
            throw new Error(
              record.label + " was not denied by the kernel for " + operationName +
              " (" + error?.code + ")"
            );
          }
          denied += 1;
          if (record.credential) credentialReadControls += 1;
        }
      }
      unlinkSync(link);
    }
    console.log(JSON.stringify({
      credentialKeys: 0,
      credentialReadControls,
      deniedOperations: denied,
      successfulRealPathOperations: 0,
    }));
  `;
  const result = await sandboxedNode(
    sourceRoot,
    testRoot,
    env,
    ["--input-type=module", "-e", program, JSON.stringify(targets)],
    { capture: true },
  );
  const evidence = JSON.parse(result.stdout.trim().split("\n").at(-1));
  if (evidence.deniedOperations !== expectedDeniedOperations) {
    fail("file-isolation negative control did not deny every operation");
  }
  const expectedCredentialReadControls = credentialFilePresent ? 2 : 0;
  if (evidence.credentialReadControls !== expectedCredentialReadControls) {
    fail("credential-isolation negative control was incomplete");
  }
  console.log(JSON.stringify({
    credentialFilePresent,
    fileIsolation: "pass",
    ...evidence,
  }));
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
    const trackedTypescript = snapshotBaseline.files
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

    const scripts = snapshotBaseline.files
      .filter((file) => /\.(?:c?js|mjs)$/.test(file));
    for (const script of scripts) {
      await sandboxedNode(sourceRoot, testRoot, env, ["--check", join(sourceRoot, script)]);
    }
    await sandboxedNode(
      sourceRoot,
      testRoot,
      { ...env, UNBOUNDRY_OFFLINE_GUARD_SCRUB_TEST_ENV: "1" },
      [vite, "build"],
    );
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
    assertTrackedSnapshotUnchanged();
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
  if (spec === EXACT_V051_SPEC) {
    Object.assign(env, exactV051AttestationEnvironment());
  }
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
    if (spec === EXACT_V051_SPEC) assertExactV051AttestationUnchanged();
    assertTrackedSnapshotUnchanged();
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
    if (discovery.tests !== 931) {
      fail(`the frozen 931-test inventory changed to ${discovery.tests}`);
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
    assertTrackedSnapshotUnchanged();
    rmSync(testRoot, { force: true, recursive: true });
  }
}

function immutableReleaseLibc() {
  if (process.platform !== "linux") return "none";
  return process.report?.getReport()?.header?.glibcVersionRuntime ? "glibc" : "musl";
}

function immutableReleaseControllerEnvironment(fixtureRoot) {
  const home = join(fixtureRoot, "controller-home");
  const temporary = join(fixtureRoot, "controller-temp");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  return {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    LOGNAME: "unboundry-release-test",
    NODE_NO_WARNINGS: "1",
    PATH: `${dirname(privateNodePath)}:/usr/bin:/bin`,
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    TZ: "UTC",
    USER: "unboundry-release-test",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
}

function writeImmutableReleaseFixtureFile(path, contents, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { flag: "wx", mode });
}

function makeImmutableReleaseFixtureRemovable(root) {
  if (!existsSync(root) || !isInside(activeSuiteRoot, root)) return;
  const visit = (directory) => {
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path);
      else if (!entry.isSymbolicLink()) chmodSync(path, 0o600);
    }
  };
  visit(root);
}

async function createImmutableReleaseFixture(
  suiteRoot,
  sourceRoot,
  browserRoot,
  iteration,
  variant,
) {
  const root = mkdtempSync(join(
    suiteRoot,
    `immutable-release-${String(iteration).padStart(2, "0")}-${variant}-`,
  ));
  chmodSync(root, 0o700);
  const repository = join(root, "repo");
  const releases = join(root, "releases");
  const scratch = join(root, "scratch");
  const npmCache = join(root, "npm-cache");
  const setupCache = join(root, "setup-cache");
  const toolsRoot = join(root, "tools");
  const dataDirectory = join(root, "setup-data");
  const auditFile = join(root, "setup-network-audit.jsonl");
  const reportFile = join(root, "unused-report.json");
  const hostAliasCanary = join(
    "/System/Volumes/Data",
    root,
    "host-alias-canary",
  );
  for (const directory of [
    repository,
    releases,
    scratch,
    npmCache,
    setupCache,
    toolsRoot,
    dataDirectory,
  ]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(auditFile, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(join(root, "host-alias-canary"), "host-alias-secret\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const port = await freePort();
  const auxiliaryPort = await freePort(new Set([port]));
  const setupEnvironment = sanitizedEnvironment({
    auxiliaryPort,
    auditFile,
    browserRoot,
    dataDirectory,
    port,
    reportFile,
    sourceRoot,
    spec: join(sourceRoot, IMMUTABLE_RELEASE_SPEC),
    testRoot: root,
  });
  setupEnvironment.GIT_CONFIG_GLOBAL = "/dev/null";
  setupEnvironment.GIT_CONFIG_NOSYSTEM = "1";
  setupEnvironment.npm_config_cache = setupCache;
  setupEnvironment.npm_config_globalconfig = join(root, "empty-global-npmrc");
  setupEnvironment.npm_config_userconfig = join(root, "empty-npmrc");
  writeImmutableReleaseFixtureFile(setupEnvironment.npm_config_globalconfig, "");
  writeImmutableReleaseFixtureFile(setupEnvironment.npm_config_userconfig, "");

  const ffmpegExecutable = join(toolsRoot, "ffmpeg");
  const ffprobeExecutable = join(toolsRoot, "ffprobe");
  writeImmutableReleaseFixtureFile(
    ffmpegExecutable,
    "#!/bin/sh\nprintf 'ffmpeg version m94-synthetic\\n'\n",
    0o500,
  );
  writeImmutableReleaseFixtureFile(
    ffprobeExecutable,
    "#!/bin/sh\nprintf 'ffprobe version m94-synthetic\\n'\n",
    0o500,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "scripts/build-release.mjs"),
    readFileSync(join(sourceRoot, "scripts/build-release.mjs")),
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "scripts/offline-network-guard.mjs"),
    readFileSync(join(sourceRoot, "scripts/offline-network-guard.mjs")),
  );
  writeImmutableReleaseFixtureFile(join(repository, ".env.example"), "DOCUMENTED_ONLY=1\n");
  writeImmutableReleaseFixtureFile(
    join(repository, "package.json"),
    `${JSON.stringify({
      dependencies: {
        "@vitejs/plugin-react": "file:vendor/vitejs-plugin-react-1.0.0.tgz",
        vite: "file:vendor/vite-1.0.0.tgz",
      },
      devDependencies: {
        "@playwright/test": "file:vendor/playwright-test-1.0.0.tgz",
        typescript: "file:vendor/typescript-1.0.0.tgz",
      },
      engines: { node: ">=22.23.1 <23", npm: EXPECTED_NPM },
      name: "m94-immutable-fixture",
      packageManager: `npm@${EXPECTED_NPM}`,
      private: true,
      scripts: { build: "tsc --noEmit && vite build" },
      type: "module",
      version: "0.0.0-m94",
    }, null, 2)}\n`,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vendor/playwright-test/package.json"),
    `${JSON.stringify({
      name: "@playwright/test",
      type: "module",
      version: "1.0.0",
    })}\n`,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vendor/typescript/package.json"),
    `${JSON.stringify({
      bin: { tsc: "bin/tsc" },
      name: "typescript",
      type: "module",
      version: "1.0.0",
    })}\n`,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vendor/typescript/bin/tsc"),
    'import { access } from "node:fs/promises";\nawait access("tsconfig.json");\n',
    0o500,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vendor/vite/package.json"),
    `${JSON.stringify({
      bin: { vite: "bin/vite.js" },
      name: "vite",
      type: "module",
      version: "1.0.0",
    })}\n`,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vendor/vite/bin/vite.js"),
    variant === "malicious"
      ? 'import { readFile, writeFile } from "node:fs/promises";\n' +
        `await readFile(${JSON.stringify(hostAliasCanary)});\n` +
        'await writeFile("server/runtime.ts", "export const compromised = true;\\n");\n'
      : 'import { mkdir, writeFile } from "node:fs/promises";\n' +
        'await mkdir("dist/client", { recursive: true });\n' +
        'await writeFile("dist/client/index.html", "immutable fixture\\n");\n',
    0o500,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vendor/plugin-react/package.json"),
    `${JSON.stringify({
      exports: "./dist/index.js",
      name: "@vitejs/plugin-react",
      type: "module",
      version: "1.0.0",
    })}\n`,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vendor/plugin-react/dist/index.js"),
    "export default function react() { return {}; }\n",
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        strict: true,
        target: "ES2022",
      },
      include: ["server", "types", "vite.config.ts"],
    }, null, 2)}\n`,
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "vite.config.ts"),
    'import { defineConfig } from "vite";\n' +
      'export default defineConfig({ root: "client", build: { outDir: "../dist/client" } });\n',
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "client/index.html"),
    "<!doctype html><title>immutable fixture</title>\n",
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "server/runtime.ts"),
    "export const fixture = true;\n",
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "types/runtime.ts"),
    "export type Fixture = true;\n",
  );
  writeImmutableReleaseFixtureFile(
    join(repository, "spec/unboundry-state-fixtures.json"),
    '{"fixtures":[]}\n',
  );

  await sandboxedCommand(
    sourceRoot,
    root,
    setupEnvironment,
    "/usr/bin/git",
    ["-c", "init.templateDir=", "init", "--quiet"],
    { cwd: repository },
  );
  for (const packagePath of [
    "./vendor/playwright-test",
    "./vendor/typescript",
    "./vendor/vite",
    "./vendor/plugin-react",
  ]) {
    await sandboxedNode(sourceRoot, root, setupEnvironment, [
      privateNpmCliPath,
      "pack",
      packagePath,
      "--pack-destination",
      "vendor",
      "--ignore-scripts",
      "--offline",
    ], { cwd: repository });
  }
  await sandboxedNode(sourceRoot, root, setupEnvironment, [
    privateNpmCliPath,
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
  ], { cwd: repository });
  const packageDocument = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(repository, "package-lock.json"), "utf8"));
  const registryRecords = [
    {
      dependencySection: "devDependencies",
      name: "@playwright/test",
      nodeModulesPath: "node_modules/@playwright/test",
      tarball: join(repository, "vendor/playwright-test-1.0.0.tgz"),
      url: "https://registry.npmjs.org/@playwright/test/-/test-1.0.0.tgz",
    },
    {
      dependencySection: "devDependencies",
      name: "typescript",
      nodeModulesPath: "node_modules/typescript",
      tarball: join(repository, "vendor/typescript-1.0.0.tgz"),
      url: "https://registry.npmjs.org/typescript/-/typescript-1.0.0.tgz",
    },
    {
      dependencySection: "dependencies",
      name: "vite",
      nodeModulesPath: "node_modules/vite",
      tarball: join(repository, "vendor/vite-1.0.0.tgz"),
      url: "https://registry.npmjs.org/vite/-/vite-1.0.0.tgz",
    },
    {
      dependencySection: "dependencies",
      name: "@vitejs/plugin-react",
      nodeModulesPath: "node_modules/@vitejs/plugin-react",
      tarball: join(repository, "vendor/vitejs-plugin-react-1.0.0.tgz"),
      url: "https://registry.npmjs.org/@vitejs/plugin-react/-/plugin-react-1.0.0.tgz",
    },
  ];
  for (const record of registryRecords) {
    const lockEntry = packageLock.packages?.[record.nodeModulesPath];
    if (!lockEntry || typeof lockEntry.integrity !== "string") {
      fail(`immutable release fixture lock omitted ${record.nodeModulesPath}`);
    }
    packageDocument[record.dependencySection][record.name] = "1.0.0";
    packageLock.packages[""][record.dependencySection][record.name] = "1.0.0";
    lockEntry.resolved = record.url;
    record.integrity = lockEntry.integrity;
  }
  writeFileSync(
    join(repository, "package.json"),
    `${JSON.stringify(packageDocument, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  writeFileSync(
    join(repository, "package-lock.json"),
    `${JSON.stringify(packageLock, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const cacheProgram = String.raw`
    import { readFile } from "node:fs/promises";
    import { createRequire } from "node:module";
    const [cacachePath, cachePath, recordsJson] = process.argv.slice(1);
    const cacache = createRequire(import.meta.url)(cacachePath);
    for (const record of JSON.parse(recordsJson)) {
      await cacache.put(cachePath, record.url, await readFile(record.tarball), {
        integrity: record.integrity,
      });
    }
  `;
  await sandboxedNode(sourceRoot, root, setupEnvironment, [
    "--input-type=module",
    "-e",
    cacheProgram,
    join(privateNodeRuntimeRoot, "lib/node_modules/npm/node_modules/cacache/lib/index.js"),
    join(npmCache, "_cacache"),
    JSON.stringify(registryRecords),
  ], { cwd: repository });
  await sandboxedCommand(
    sourceRoot,
    root,
    setupEnvironment,
    "/usr/bin/git",
    ["add", "--all"],
    { cwd: repository },
  );
  await sandboxedCommand(
    sourceRoot,
    root,
    setupEnvironment,
    "/usr/bin/git",
    [
      "-c",
      "user.name=M94",
      "-c",
      "user.email=m94@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: repository },
  );
  const commit = (
    await sandboxedCommand(
      sourceRoot,
      root,
      setupEnvironment,
      "/usr/bin/git",
      ["rev-parse", "HEAD"],
      { capture: true, cwd: repository },
    )
  ).stdout.trim();
  mkdirSync(join(repository, ".git/info"), { recursive: true, mode: 0o700 });
  writeFileSync(join(repository, ".git/info/exclude"), "working-copy-only.txt\n", {
    encoding: "utf8",
    flag: "a",
  });
  const setupAudit = assertAudit(auditFile, new Set([port, auxiliaryPort]));
  return Object.freeze({
    commit,
    ffmpegExecutable,
    ffprobeExecutable,
    npmCache,
    releases,
    repository,
    root,
    scratch,
    setupAudit,
    setupEnvironment,
  });
}

function immutableReleaseBuilderArguments(fixture) {
  return [
    join(fixture.repository, "scripts/build-release.mjs"),
    "--artifact-class",
    "synthetic-test",
    "--commit",
    fixture.commit,
    "--ffmpeg-executable",
    fixture.ffmpegExecutable,
    "--ffprobe-executable",
    fixture.ffprobeExecutable,
    "--release-root",
    fixture.releases,
    "--scratch-root",
    fixture.scratch,
    "--npm-cache",
    fixture.npmCache,
    "--target-platform",
    process.platform,
    "--target-arch",
    process.arch,
    "--target-libc",
    immutableReleaseLibc(),
  ];
}

async function runImmutableReleaseBuilder(fixture) {
  return await runManaged(
    privateNodePath,
    immutableReleaseBuilderArguments(fixture),
    {
      allowFailure: true,
      capture: true,
      cwd: fixture.repository,
      env: immutableReleaseControllerEnvironment(fixture.root),
      timeout: 2 * 60_000,
    },
  );
}

function parseImmutableReleaseFailure(result, expectedCode) {
  if (result.status === 0) fail(`immutable release builder unexpectedly passed ${expectedCode}`);
  let record;
  try {
    record = JSON.parse(result.stderr.trim());
  } catch {
    fail(`immutable release builder did not emit JSON for ${expectedCode}`);
  }
  if (record?.code !== expectedCode) {
    fail(`immutable release builder returned ${record?.code ?? "no code"}, expected ${expectedCode}`);
  }
  return record;
}

function immutableReleaseEntries(path) {
  return readdirSync(path).sort();
}

async function runImmutableReleaseOperationalCheck(
  suiteRoot,
  sourceRoot,
  browserRoot,
  iteration,
) {
  // synthetic local-tarball operational fixture exercises Darwin builder mechanics without publishing npm bin links
  let clean;
  let malicious;
  try {
    clean = await createImmutableReleaseFixture(
      suiteRoot,
      sourceRoot,
      browserRoot,
      iteration,
      "clean",
    );
    const result = await runImmutableReleaseBuilder(clean);
    if (result.status !== 0) {
      fail(`clean immutable release build failed: ${result.stderr.trim()}`);
    }
    const summary = JSON.parse(result.stdout.trim());
    const releaseDirectory = join(clean.releases, clean.commit);
    if (
      summary.commit !== clean.commit || summary.releaseDirectory !== releaseDirectory ||
      summary.artifactClass !== "synthetic-test" ||
      summary.buildPlatform !== process.platform || summary.buildArch !== process.arch ||
      summary.buildLibc !== immutableReleaseLibc() ||
      summary.admission?.rule !== "marker-absent-directory-0500-manifest-verified"
    ) fail("clean immutable release summary did not match its pinned fixture");
    const releaseDetails = lstatSync(releaseDirectory);
    if (!releaseDetails.isDirectory() || releaseDetails.isSymbolicLink() ||
      (releaseDetails.mode & 0o777) !== 0o500) {
      fail("immutable release directory was not published read-only");
    }
    const rootEntries = immutableReleaseEntries(releaseDirectory);
    for (const required of [
      "client",
      "dist",
      "node_modules",
      "package-lock.json",
      "package.json",
      "release-manifest.json",
      "server",
      "spec",
      "types",
      "vite.config.ts",
    ]) {
      if (!rootEntries.includes(required)) fail(`immutable release omitted ${required}`);
    }
    if (rootEntries.includes(".env.example") || rootEntries.includes(".incomplete")) {
      fail("immutable release published a forbidden root entry");
    }
    if (immutableReleaseEntries(join(releaseDirectory, "node_modules")).includes(".bin")) {
      fail("immutable release published npm bin links");
    }
    const publishedPlaywrightScope = join(releaseDirectory, "node_modules/@playwright");
    const publishedPlaywrightScopeDetails = lstatSync(publishedPlaywrightScope);
    if (
      !publishedPlaywrightScopeDetails.isDirectory() ||
      publishedPlaywrightScopeDetails.isSymbolicLink() ||
      immutableReleaseEntries(publishedPlaywrightScope).length !== 0
    ) {
      fail("immutable release retained a Playwright development package");
    }
    const manifestBytes = readFileSync(summary.manifestPath);
    if (sha256Bytes(manifestBytes) !== summary.manifestSha256) {
      fail("immutable release manifest digest did not match the summary");
    }
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (
      manifest.format !== "unboundry-immutable-release" ||
      manifest.artifactClass !== "synthetic-test" ||
      manifest.commit !== clean.commit ||
      manifest.build?.networkSandboxVerified !== true ||
      manifest.build?.networkAudit?.blockedAttempts !== 0 ||
      manifest.build?.networkAudit?.guardLoads < 2 ||
      !/^[0-9a-f]{40}$/.test(String(manifest.sourceTree ?? "")) ||
      manifest.runtime?.command !== privateNodePath || manifest.runtime?.cwd !== "." ||
      manifest.runtime?.health?.version !== "0.0.0-m94"
    ) fail("immutable release manifest did not satisfy the synthetic contract");
    const prerequisiteByName = new Map(
      (manifest.hostPrerequisites?.executables ?? []).map((entry) => [entry.name, entry]),
    );
    if (prerequisiteByName.size !== 3) {
      fail("immutable release manifest contained an unexpected host prerequisite");
    }
    const nodePrerequisite = prerequisiteByName.get("node");
    if (
      nodePrerequisite?.path !== privateNodePath || nodePrerequisite.required !== true ||
      JSON.stringify(nodePrerequisite.arguments) !== JSON.stringify(["--version"]) ||
      nodePrerequisite.sha256 !== sha256Bytes(readFileSync(privateNodePath)) ||
      nodePrerequisite.versionOutputSha256 !== sha256Bytes(`v${EXPECTED_NODE}`) ||
      nodePrerequisite.versionPattern !== `^v${EXPECTED_NODE.replaceAll(".", "\\.")}$`
    ) fail("immutable release manifest did not pin the Node prerequisite");
    for (const [name, path] of [
      ["ffmpeg", clean.ffmpegExecutable],
      ["ffprobe", clean.ffprobeExecutable],
    ]) {
      const prerequisite = prerequisiteByName.get(name);
      const version = `${name} version m94-synthetic`;
      if (
        prerequisite?.path !== path || prerequisite.required !== true ||
        JSON.stringify(prerequisite.arguments) !== JSON.stringify(["-version"]) ||
        prerequisite.sha256 !== sha256Bytes(readFileSync(path)) ||
        prerequisite.versionOutputSha256 !== sha256Bytes(version) ||
        prerequisite.versionPattern !==
          `^${name} version [^\\r\\n]+(?:\\r?\\n[\\s\\S]*)?$`
      ) fail(`immutable release manifest did not pin the ${name} prerequisite`);
    }
    const expectedRuntimeArguments = [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--configLoader",
      "runner",
      "--host",
      "127.0.0.1",
      "--port",
      "${UNBOUNDRY_PORT}",
      "--strictPort",
    ];
    if (JSON.stringify(manifest.runtime?.arguments) !== JSON.stringify(expectedRuntimeArguments)) {
      fail("immutable release runtime command is not pinned");
    }
    const manifestPaths = new Set((manifest.files ?? []).map((entry) => entry.path));
    if (!manifestPaths.has("node_modules/@playwright")) {
      fail("immutable release manifest omitted the empty Playwright scope regression fixture");
    }
    if ([...manifestPaths].some((path) => path.startsWith("node_modules/@playwright/"))) {
      fail("immutable release manifest retained a Playwright development package");
    }
    for (const required of [
      "dist/client/index.html",
      "node_modules/@vitejs/plugin-react/dist/index.js",
      "node_modules/vite/bin/vite.js",
      "server/runtime.ts",
      "spec/unboundry-state-fixtures.json",
      "types/runtime.ts",
      "vite.config.ts",
    ]) {
      if (!manifestPaths.has(required)) fail(`immutable release manifest omitted ${required}`);
    }
    if ([...manifestPaths].some((path) =>
      path === "node_modules/typescript" || path.startsWith("node_modules/typescript/")
    )) fail("immutable release published the TypeScript development dependency");
    if ((manifest.files ?? []).some((entry) =>
      String(entry.path).startsWith("node_modules/.bin") ||
      (entry.type !== "directory" && (
        entry.type !== "file" || !Number.isInteger(entry.size) ||
        !/^[0-9a-f]{64}$/.test(String(entry.sha256 ?? ""))
      ))
    )) fail("immutable release manifest contains an invalid inventory entry");
    const repeated = await runImmutableReleaseBuilder(clean);
    parseImmutableReleaseFailure(repeated, "RELEASE_TARGET_EXISTS");
    if (!readFileSync(summary.manifestPath).equals(manifestBytes)) {
      fail("repeat immutable release attempt changed the admitted manifest");
    }

    malicious = await createImmutableReleaseFixture(
      suiteRoot,
      sourceRoot,
      browserRoot,
      iteration,
      "malicious",
    );
    const maliciousResult = await runImmutableReleaseBuilder(malicious);
    const maliciousFailure = parseImmutableReleaseFailure(
      maliciousResult,
      "RELEASE_COMMAND_FAILED",
    );
    if (
      !String(maliciousFailure.message).includes(
        "fail-closed incomplete release reservation retained",
      ) || String(maliciousFailure.message).includes(malicious.root)
    ) fail("malicious immutable release failure disclosure was unsafe");
    if (
      JSON.stringify(immutableReleaseEntries(malicious.releases)) !==
        JSON.stringify([malicious.commit]) ||
      JSON.stringify(immutableReleaseEntries(join(malicious.releases, malicious.commit))) !==
        JSON.stringify([".incomplete"]) ||
      immutableReleaseEntries(malicious.scratch).length !== 0
    ) fail("malicious immutable release did not retain exactly one incomplete reservation");

    const evidence = Object.freeze({
      builderInvocations: 3,
      cleanBuilds: 1,
      iteration,
      maliciousRejections: 1,
      manifestSha256: summary.manifestSha256,
      npmBinLinksPublished: 0,
      repeatRejections: 1,
      setupGuardLoads: clean.setupAudit.guardLoads + malicious.setupAudit.guardLoads,
      status: "pass",
    });
    console.log(JSON.stringify({ operationalCheck: "immutable-release-builder", ...evidence }));
    return evidence;
  } finally {
    for (const fixture of [clean, malicious]) {
      if (!fixture) continue;
      makeImmutableReleaseFixtureRemovable(fixture.root);
      rmSync(fixture.root, { force: true, recursive: true });
    }
    assertTrackedSnapshotUnchanged();
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
  chmodSync(suiteRoot, 0o700);
  activeSuiteRoot = suiteRoot;
  if (!isInside(systemTemporaryRoot, suiteRoot)) fail("suite root escaped system temp");
  const { browserRoot, capturedWorkspace, files, sourceRoot } =
    createTrackedSnapshot(suiteRoot);
  if (
    capturedWorkspace.head !== workspaceBaseline.head ||
    capturedWorkspace.sha256 !== workspaceBaseline.sha256
  ) fail("the isolated source snapshot is not bound to the workspace baseline");
  await prepareDependencies(
    sourceRoot,
    browserRoot,
    suiteRoot,
    options.command === "run" || options.command === "full",
  );
  snapshotSourceRoot = sourceRoot;
  snapshotBaseline = snapshotFingerprint(sourceRoot, files, capturedWorkspace.head);
  assertTrackedSnapshotUnchanged();
  if (
    options.command === "full" ||
    (options.command === "run" && specs.includes(EXACT_V051_SPEC))
  ) {
    await prepareExactV051Attestation(sourceRoot, browserRoot, suiteRoot);
  }
  if (options.command === "run" || options.command === "full") {
    await validateSource(sourceRoot, browserRoot, suiteRoot);
  }
  assertTrackedSnapshotUnchanged();
  const discovery = await discover(
    allSpecs,
    suiteRoot,
    sourceRoot,
    browserRoot,
  );
  assertTrackedSnapshotUnchanged();
  if (options.command === "list") {
    return;
  }

  const immutableReleaseSelected =
    options.command === "full" || specs.includes(IMMUTABLE_RELEASE_SPEC);
  const immutableReleaseOperationalEvidence = [];
  if (immutableReleaseSelected) {
    for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
      try {
        immutableReleaseOperationalEvidence.push(
          await runImmutableReleaseOperationalCheck(
            suiteRoot,
            sourceRoot,
            browserRoot,
            iteration,
          ),
        );
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error)
          .replaceAll(suiteRoot, "<suite-root>")
          .slice(0, 2_000);
        const evidence = Object.freeze({ iteration, message, status: "failed" });
        immutableReleaseOperationalEvidence.push(evidence);
        console.error(JSON.stringify({
          operationalCheck: "immutable-release-builder",
          ...evidence,
        }));
      }
    }
  }
  if (
    immutableReleaseOperationalEvidence.length !==
      (immutableReleaseSelected ? options.repeat : 0)
  ) fail("immutable release operational checker execution count is inexact");

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
    operational: Object.freeze({
      immutableReleaseBuilder: Object.freeze({
        attempts: immutableReleaseOperationalEvidence.length,
        builderInvocations: immutableReleaseOperationalEvidence.reduce(
          (count, evidence) => count + (evidence.builderInvocations ?? 0),
          0,
        ),
        expectedAttempts: immutableReleaseSelected ? options.repeat : 0,
        expectedBuilderInvocations: immutableReleaseSelected ? options.repeat * 3 : 0,
        failed: immutableReleaseOperationalEvidence.filter(
          (evidence) => evidence.status !== "pass",
        ).length,
        failures: immutableReleaseOperationalEvidence
          .filter((evidence) => evidence.status !== "pass")
          .map((evidence) => ({
            iteration: evidence.iteration,
            message: evidence.message,
          })),
        passed: immutableReleaseOperationalEvidence.filter(
          (evidence) => evidence.status === "pass",
        ).length,
        selected: immutableReleaseSelected,
      }),
    }),
    repeat: options.repeat,
    source: Object.freeze({
      files: workspaceBaseline.files.length,
      head: workspaceBaseline.head,
      sha256: workspaceBaseline.sha256,
      snapshotSha256: snapshotBaseline.sha256,
    }),
  };
  writeFileSync(
    join(suiteRoot, "summary.json"),
    `${JSON.stringify(finalSummary, null, 2)}\n`,
    "utf8",
  );
  assertTrackedSnapshotUnchanged();
  console.log(JSON.stringify(finalSummary));
  if (
    finalSummary.failed !== 0 ||
    finalSummary.reportErrors !== 0 ||
    finalSummary.skipped !== 0 ||
    finalSummary.retries !== 0 ||
    finalSummary.blocked !== 0 ||
    finalSummary.operational.immutableReleaseBuilder.failed !== 0 ||
    finalSummary.operational.immutableReleaseBuilder.builderInvocations !==
      finalSummary.operational.immutableReleaseBuilder.expectedBuilderInvocations
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
      if (exactV051Attestation) {
        try {
          assertExactV051AttestationUnchanged();
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          if (existsSync(exactV051Attestation.path)) {
            chmodSync(exactV051Attestation.path, 0o600);
          }
          if (existsSync(exactV051Attestation.root)) {
            chmodSync(exactV051Attestation.root, 0o700);
          }
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        if (snapshotBaseline && snapshotSourceRoot) {
          const snapshotHash = assertTrackedSnapshotUnchanged();
          console.log(JSON.stringify({ snapshot: "unchanged", snapshotHash }));
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
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
