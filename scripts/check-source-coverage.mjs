import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_VERSION = "22.23.1";
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = realpathSync(resolve(dirname(scriptPath), ".."));
const manifestPath = join(repositoryRoot, "scripts/source-coverage-manifest.json");
const sourcePattern = /\.(?:ts|tsx|js|mjs)$/;
const typeScriptPattern = /\.(?:ts|tsx)$/;
const javaScriptPattern = /\.(?:js|mjs)$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(`[source-coverage] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture === false ? "inherit" : "pipe",
    timeout: options.timeout ?? 10 * 60_000,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    fail(
      `${command} exited with status ${result.status}${
        details ? `:\n${details}` : ""
      }`,
    );
  }
  return result.stdout ?? "";
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(`${label} must be an array of strings`);
  }
  if (new Set(value).size !== value.length) fail(`${label} contains duplicates`);
}

function compareSets(actualValues, expectedValues, label) {
  const actual = [...new Set(actualValues)].sort();
  const expected = [...new Set(expectedValues)].sort();
  const missing = expected.filter((value) => !actual.includes(value));
  const extra = actual.filter((value) => !expected.includes(value));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `${label} is stale (missing: ${missing.join(", ") || "none"}; ` +
        `undeclared: ${extra.join(", ") || "none"})`,
    );
  }
}

function toRepositoryPath(absolutePath) {
  const path = relative(repositoryRoot, absolutePath).split(sep).join("/");
  if (path === ".." || path.startsWith("../") || isAbsolute(path)) return null;
  return path;
}

function currentSourceFiles() {
  const output = run("git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const files = output
    .split("\0")
    .filter(Boolean)
    .filter((file) => sourcePattern.test(file))
    .sort();

  for (const file of files) {
    if (file.startsWith("/") || file.split("/").includes("..")) {
      fail(`Git returned an unsafe source path: ${file}`);
    }
    const absolutePath = join(repositoryRoot, file);
    if (!existsSync(absolutePath)) fail(`tracked source is missing: ${file}`);
    if (!lstatSync(absolutePath).isFile()) {
      fail(`source must be a regular file, not a directory or symlink: ${file}`);
    }
  }
  return files;
}

function fileSha256(file) {
  return createHash("sha256")
    .update(readFileSync(join(repositoryRoot, file)))
    .digest("hex");
}

function loadManifest() {
  if (!existsSync(manifestPath)) fail("source coverage manifest does not exist");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`source coverage manifest is not valid JSON: ${error.message}`);
  }
  assertPlainObject(manifest, "manifest");
  if (manifest.schemaVersion !== 1) fail("manifest schemaVersion must be 1");
  if (manifest.expectedNode !== REQUIRED_NODE_VERSION) {
    fail(`manifest expectedNode must be exactly ${REQUIRED_NODE_VERSION}`);
  }
  assertString(manifest.tsconfig, "manifest.tsconfig");
  assertStringArray(manifest.infrastructureScripts, "manifest.infrastructureScripts");
  assertStringArray(manifest.automaticNpmRoots, "manifest.automaticNpmRoots");
  assertPlainObject(manifest.operationalScripts, "manifest.operationalScripts");
  return manifest;
}

function cleanChildEnvironment() {
  return {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
  };
}

function checkTypeScript(sourceFiles, tsconfig) {
  const configPath = join(repositoryRoot, tsconfig);
  if (!existsSync(configPath) || !lstatSync(configPath).isFile()) {
    fail(`TypeScript coverage config does not exist: ${tsconfig}`);
  }
  const compiler = join(repositoryRoot, "node_modules/typescript/bin/tsc");
  if (!existsSync(compiler) || !lstatSync(compiler).isFile()) {
    fail("the pinned local TypeScript compiler is missing");
  }
  const environment = cleanChildEnvironment();
  const listOutput = run(
    process.execPath,
    [compiler, "--project", configPath, "--listFilesOnly", "--pretty", "false"],
    { env: environment },
  );
  const listedRepositoryFiles = new Set();
  for (const line of listOutput.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const repositoryPath = toRepositoryPath(
      realpathSync(isAbsolute(trimmed) ? trimmed : resolve(repositoryRoot, trimmed)),
    );
    if (repositoryPath) listedRepositoryFiles.add(repositoryPath);
  }

  const current = sourceFiles.filter((file) => typeScriptPattern.test(file));
  const covered = current.filter((file) => listedRepositoryFiles.has(file));
  const missing = current.filter((file) => !listedRepositoryFiles.has(file));
  if (missing.length > 0) {
    fail(
      `tsc --listFilesOnly covers ${covered.length}/${current.length} current ` +
        `TypeScript sources; missing: ${missing.join(", ")}`,
    );
  }

  return { covered: covered.length, current: current.length };
}

function checkJavaScript(sourceFiles) {
  const current = sourceFiles.filter((file) => javaScriptPattern.test(file));
  const environment = cleanChildEnvironment();
  for (const file of current) {
    run(process.execPath, ["--check", join(repositoryRoot, file)], {
      env: environment,
    });
  }
  return { checked: current.length, current: current.length };
}

function npmScriptReferences(command) {
  const references = [];
  const pattern = /\bnpm\s+(?:(?:--[^\s]+)\s+)*(?:run|run-script)\s+([A-Za-z0-9:_-]+)/g;
  for (const match of command.matchAll(pattern)) references.push(match[1]);
  return references;
}

function automaticNpmScripts(packageScripts, roots) {
  for (const root of roots) {
    if (typeof packageScripts[root] !== "string") {
      fail(`automatic npm root does not exist: ${root}`);
    }
  }
  const reachable = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (reachable.has(name)) continue;
    reachable.add(name);
    for (const reference of npmScriptReferences(packageScripts[name])) {
      if (typeof packageScripts[reference] !== "string") {
        fail(`npm script ${name} references missing script ${reference}`);
      }
      pending.push(reference);
    }
  }
  return reachable;
}

function checkOperationalScripts(sourceFiles, manifest) {
  const operationalEntries = Object.entries(manifest.operationalScripts);
  const operationalFiles = operationalEntries.map(([file]) => file);
  const allTopLevelScripts = sourceFiles.filter((file) => /^scripts\/[^/]+\.mjs$/.test(file));
  const declaredScripts = [...manifest.infrastructureScripts, ...operationalFiles];
  compareSets(allTopLevelScripts, declaredScripts, "scripts/*.mjs partition");

  const overlap = manifest.infrastructureScripts.filter((file) =>
    operationalFiles.includes(file),
  );
  if (overlap.length > 0) {
    fail(`scripts cannot be both infrastructure and operational: ${overlap.join(", ")}`);
  }
  for (const file of manifest.infrastructureScripts) {
    if (!/^scripts\/[^/]+\.mjs$/.test(file)) {
      fail(`infrastructure script must be a top-level MJS file: ${file}`);
    }
  }

  const packagePath = join(repositoryRoot, "package.json");
  if (!existsSync(packagePath)) fail("package.json does not exist");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assertPlainObject(packageJson.scripts, "package.json scripts");
  const reachableNpmScripts = automaticNpmScripts(
    packageJson.scripts,
    manifest.automaticNpmRoots,
  );
  const sourceContents = new Map(
    sourceFiles.map((file) => [file, readFileSync(join(repositoryRoot, file), "utf8")]),
  );

  let behaviorCovered = 0;
  let frozen = 0;
  for (const [file, record] of operationalEntries) {
    if (!/^scripts\/[^/]+\.mjs$/.test(file)) {
      fail(`operational script must be a top-level MJS file: ${file}`);
    }
    assertPlainObject(record, `manifest.operationalScripts.${file}`);
    if (!sha256Pattern.test(record.scriptSha256 ?? "")) {
      fail(`${file} must have a lowercase SHA-256 scriptSha256`);
    }
    if (fileSha256(file) !== record.scriptSha256) {
      fail(`${file} changed after its behavior/freeze review; manifest is stale`);
    }

    if (record.mode === "behavior-test") {
      behaviorCovered += 1;
      assertString(record.target, `${file}.target`);
      assertString(record.marker, `${file}.marker`);
      if (!sha256Pattern.test(record.targetSha256 ?? "")) {
        fail(`${file} must have a lowercase SHA-256 targetSha256`);
      }
      if (
        !record.target.startsWith("tests/") &&
        !manifest.infrastructureScripts.includes(record.target)
      ) {
        fail(
          `${file} behavior target must live under tests/ or be declared ` +
            `gate infrastructure: ${record.target}`,
        );
      }
      if (!sourceContents.has(record.target)) {
        fail(`${file} behavior target is missing from current source: ${record.target}`);
      }
      const targetContents = sourceContents.get(record.target);
      if (!targetContents.includes(file)) {
        fail(`${file} behavior target no longer references the script`);
      }
      if (!targetContents.includes(record.marker)) {
        fail(`${file} behavior marker is stale or missing: ${record.marker}`);
      }
      if (fileSha256(record.target) !== record.targetSha256) {
        fail(`${file} behavior target changed after review; manifest is stale`);
      }
      continue;
    }

    if (record.mode !== "frozen") {
      fail(`${file} mode must be behavior-test or frozen`);
    }
    frozen += 1;
    assertString(record.reason, `${file}.reason`);
    if (record.reason.length < 20) fail(`${file} freeze reason is too short`);
    assertStringArray(record.manualNpmScripts, `${file}.manualNpmScripts`);

    const fileName = basename(file);
    const packageOccurrences = Object.entries(packageJson.scripts)
      .filter(([, command]) => command.includes(file) || command.includes(fileName))
      .map(([name]) => name);
    compareSets(
      packageOccurrences,
      record.manualNpmScripts,
      `${file} manual npm references`,
    );
    for (const manualName of record.manualNpmScripts) {
      if (reachableNpmScripts.has(manualName)) {
        fail(`${file} is frozen but reachable from automatic npm root via ${manualName}`);
      }
      for (const [candidateName, command] of Object.entries(packageJson.scripts)) {
        if (
          candidateName !== manualName &&
          npmScriptReferences(command).includes(manualName)
        ) {
          fail(
            `${file} is frozen but its manual npm entry ${manualName} is ` +
              `chained from package script ${candidateName}`,
          );
        }
      }
    }
    for (const automaticName of reachableNpmScripts) {
      const command = packageJson.scripts[automaticName];
      if (command.includes(file) || command.includes(fileName)) {
        fail(`${file} is frozen but executed by automatic npm script ${automaticName}`);
      }
    }

    for (const [candidate, contents] of sourceContents) {
      if (candidate === file) continue;
      if (contents.includes(file) || contents.includes(fileName)) {
        fail(`${file} is frozen but referenced from executable source ${candidate}`);
      }
      for (const manualName of record.manualNpmScripts) {
        if (contents.includes(manualName)) {
          fail(
            `${file} is frozen but its manual npm entry ${manualName} is ` +
              `referenced from executable source ${candidate}`,
          );
        }
      }
    }
  }

  if (operationalEntries.length !== 24) {
    fail(`exactly 24 operational MJS scripts are required, found ${operationalEntries.length}`);
  }
  return {
    behaviorCovered,
    frozen,
    total: operationalEntries.length,
  };
}

function main() {
  if (process.versions.node !== REQUIRED_NODE_VERSION) {
    fail(
      `this gate must run under exact Node ${REQUIRED_NODE_VERSION}; ` +
        `current is ${process.versions.node}`,
    );
  }
  const manifest = loadManifest();
  const sourcesBefore = currentSourceFiles();
  const operational = checkOperationalScripts(sourcesBefore, manifest);
  const typeScript = checkTypeScript(sourcesBefore, manifest.tsconfig);
  const javaScript = checkJavaScript(sourcesBefore);
  const sourcesAfter = currentSourceFiles();
  compareSets(sourcesAfter, sourcesBefore, "source inventory during gate run");

  console.log(
    JSON.stringify(
      {
        status: "pass",
        node: process.versions.node,
        sourceInventory: {
          current: sourcesBefore.length,
          stable: true,
        },
        typeScript,
        javaScript,
        operational,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
