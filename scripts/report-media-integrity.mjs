import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  BackupPackageError,
  inspectFrozenMediaIntegrity,
} from "../server/backupPackage.ts";

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new CliError(code, message);
}

function normalizedAbsolutePath(value) {
  if (!value || resolve(value) !== value) {
    fail(
      "MEDIA_REPORT_ARGUMENT_INVALID",
      "All media report paths must be normalized absolute paths",
    );
  }
  return value;
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" ||
    (difference !== ".." && !difference.startsWith(`..${sep}`));
}

function parseArguments(argv) {
  const values = new Map();
  const mirrors = [];
  let sourceFrozen = false;
  const valueOptions = new Set([
    "--data-dir",
    "--oss-mirror",
    "--scratch-root",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--source-frozen") {
      if (sourceFrozen) {
        fail("MEDIA_REPORT_ARGUMENT_INVALID", "Duplicate source freeze confirmation");
      }
      sourceFrozen = true;
      continue;
    }
    if (!valueOptions.has(option)) {
      fail("MEDIA_REPORT_ARGUMENT_INVALID", "Unknown media report argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("MEDIA_REPORT_ARGUMENT_INVALID", "A media report argument value is missing");
    }
    index += 1;
    if (option === "--oss-mirror") {
      mirrors.push(value);
      continue;
    }
    if (values.has(option)) {
      fail("MEDIA_REPORT_ARGUMENT_INVALID", "Duplicate media report argument");
    }
    values.set(option, value);
  }
  if (!sourceFrozen || !values.has("--data-dir")) {
    fail(
      "MEDIA_REPORT_ARGUMENT_INVALID",
      "Media report requires an explicit frozen source directory",
    );
  }
  return { mirrors, sourceFrozen, values };
}

function parseMirror(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("MEDIA_REPORT_ARGUMENT_INVALID", "OSS mirrors must be JSON objects");
  }
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !== "filePath,objectKey,versionId" ||
    typeof parsed.filePath !== "string" || !parsed.filePath ||
    typeof parsed.objectKey !== "string" || !parsed.objectKey ||
    typeof parsed.versionId !== "string" || !parsed.versionId ||
    parsed.objectKey.includes("\0") || parsed.versionId.includes("\0")
  ) {
    fail(
      "MEDIA_REPORT_ARGUMENT_INVALID",
      "OSS mirrors require objectKey, versionId, and absolute filePath",
    );
  }
  return {
    filePath: normalizedAbsolutePath(parsed.filePath),
    objectKey: parsed.objectKey,
    versionId: parsed.versionId,
  };
}

async function assertMirrorsOutsideSource(sourceDirectory, scratchRoot, mirrors) {
  const canonicalSource = await realpath(sourceDirectory).catch(() => sourceDirectory);
  const canonicalScratch = scratchRoot
    ? await realpath(scratchRoot).catch(() => scratchRoot)
    : undefined;
  for (const mirror of mirrors) {
    const canonicalMirror = await realpath(mirror.filePath).catch(() => mirror.filePath);
    if (
      containsPath(canonicalSource, canonicalMirror) ||
      canonicalScratch && containsPath(canonicalScratch, canonicalMirror)
    ) {
      fail(
        "MEDIA_REPORT_ARGUMENT_INVALID",
        "OSS mirror files must stay outside source and scratch directories",
      );
    }
  }
}

function redactPaths(message, paths) {
  let safe = String(message || "Media integrity report failed");
  for (const path of [...paths].sort((left, right) => right.length - left.length)) {
    safe = safe.replaceAll(path, "[path]");
  }
  return safe;
}

let pathArguments = [];
try {
  const parsed = parseArguments(process.argv.slice(2));
  const sourceDirectory = normalizedAbsolutePath(parsed.values.get("--data-dir"));
  const scratchValue = parsed.values.get("--scratch-root");
  const scratchRoot = scratchValue
    ? normalizedAbsolutePath(scratchValue)
    : undefined;
  const ossMirrors = parsed.mirrors.map(parseMirror);
  pathArguments = [
    sourceDirectory,
    ...(scratchRoot ? [scratchRoot] : []),
    ...ossMirrors.map(({ filePath }) => filePath),
  ];
  await assertMirrorsOutsideSource(sourceDirectory, scratchRoot, ossMirrors);
  const report = await inspectFrozenMediaIntegrity({
    ossMirrors: ossMirrors.length ? ossMirrors : undefined,
    scratchRoot,
    sourceDirectory,
    sourceFrozen: true,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.clean) process.exitCode = 2;
} catch (error) {
  const known = error instanceof CliError || error instanceof BackupPackageError;
  process.stderr.write(`${JSON.stringify({
    code: known ? error.code : "MEDIA_REPORT_FAILED",
    message: redactPaths(
      known ? error.message : "Media integrity report failed",
      pathArguments,
    ),
  })}\n`);
  process.exitCode = 1;
}
