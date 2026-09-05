import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import "./node-typescript-runtime.mjs";

const {
  BackupPackageError,
  inspectFrozenMediaIntegrity,
} = await import("../server/backupPackage.ts");

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
    (!isAbsolute(difference) &&
      difference !== ".." && !difference.startsWith(`..${sep}`));
}

function parseArguments(argv) {
  const values = new Map();
  const mirrors = [];
  const mediaWarnings = [];
  let sourceFrozen = false;
  let externalFreezeNonFinal = false;
  let historicalRecovery = false;
  let requireCleanMedia = false;
  const valueOptions = new Set([
    "--allow-media-warning",
    "--data-dir",
    "--expected-database-logical-sha256",
    "--expected-schema-version",
    "--generation-frozen-at",
    "--last-provider-admission-at",
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
    if (option === "--external-freeze-non-final") {
      if (externalFreezeNonFinal) {
        fail(
          "MEDIA_REPORT_ARGUMENT_INVALID",
          "External freeze mode is duplicated",
        );
      }
      externalFreezeNonFinal = true;
      continue;
    }
    if (option === "--historical-recovery") {
      if (historicalRecovery) {
        fail(
          "MEDIA_REPORT_ARGUMENT_INVALID",
          "Historical recovery mode is duplicated",
        );
      }
      historicalRecovery = true;
      continue;
    }
    if (option === "--require-clean-media") {
      if (requireCleanMedia || mediaWarnings.length) {
        fail(
          "MEDIA_REPORT_ARGUMENT_INVALID",
          "Media warning policy is duplicated or conflicting",
        );
      }
      requireCleanMedia = true;
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
    if (option === "--allow-media-warning") {
      if (
        requireCleanMedia ||
        !/^MEDIA_INTEGRITY_[A-Z0-9_]+$/.test(value) ||
        mediaWarnings.includes(value)
      ) {
        fail("MEDIA_REPORT_ARGUMENT_INVALID", "Media warning allowlist is invalid");
      }
      mediaWarnings.push(value);
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
  return {
    externalFreezeNonFinal,
    historicalRecovery,
    mediaWarnings,
    mirrors,
    requireCleanMedia,
    sourceFrozen,
    values,
  };
}

function parseFrozenSourceContract(values, historicalRecovery) {
  const names = [
    "--expected-database-logical-sha256",
    "--expected-schema-version",
    "--generation-frozen-at",
    "--last-provider-admission-at",
  ];
  const present = names.filter((name) => values.has(name));
  if (!present.length) return undefined;
  if (present.length !== names.length) {
    fail(
      "MEDIA_REPORT_ARGUMENT_INVALID",
      "Frozen source contract requires schema, logical SHA, freeze, and admission evidence",
    );
  }
  const expectedDatabaseLogicalSha256 = values.get(
    "--expected-database-logical-sha256",
  );
  const schemaText = values.get("--expected-schema-version");
  const expectedSchemaVersion = Number(schemaText);
  const generationFrozenAt = values.get("--generation-frozen-at");
  const admissionText = values.get("--last-provider-admission-at");
  const schemaAccepted = historicalRecovery
    ? [37, 38, 39, 40, 41, 42].includes(expectedSchemaVersion)
    : expectedSchemaVersion === 43;
  if (
    !/^[a-f0-9]{64}$/.test(expectedDatabaseLogicalSha256) ||
    !schemaAccepted ||
    String(expectedSchemaVersion) !== schemaText ||
    !generationFrozenAt ||
    !admissionText
  ) {
    fail("MEDIA_REPORT_ARGUMENT_INVALID", "Frozen source contract is invalid");
  }
  return {
    expectedDatabaseLogicalSha256,
    expectedSchemaVersion,
    freezeEvidence: {
      generationFrozenAt,
      lastProviderAdmissionAt: admissionText === "none" ? null : admissionText,
      sourceDatabaseLogicalSha256: expectedDatabaseLogicalSha256,
    },
  };
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
  const frozenSourceContract = parseFrozenSourceContract(
    parsed.values,
    parsed.historicalRecovery,
  );
  if (Boolean(frozenSourceContract) === parsed.externalFreezeNonFinal) {
    fail(
      "MEDIA_REPORT_ARGUMENT_INVALID",
      "Choose either a complete locked source contract or explicit external non-final freeze mode",
    );
  }
  if (parsed.historicalRecovery && !frozenSourceContract) {
    fail(
      "MEDIA_REPORT_ARGUMENT_INVALID",
      "Historical recovery requires a complete historical locked source contract",
    );
  }
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
    capturePurpose: parsed.historicalRecovery
      ? "historical-recovery"
      : "current-schema43",
    frozenSourceContract,
    mediaWarningAllowlist:
      parsed.requireCleanMedia || parsed.mediaWarnings.length
        ? parsed.mediaWarnings
        : undefined,
    ossMirrors: ossMirrors.length ? ossMirrors : undefined,
    scratchRoot,
    sourceDirectory,
    sourceFrozen: true,
  });
  process.stdout.write(`${JSON.stringify({
    ...report,
    captureMode: frozenSourceContract ? "locked-exact" : "external-unverified",
    finalCandidate: Boolean(frozenSourceContract) &&
      !parsed.historicalRecovery && report.schemaVersion === 43,
  })}\n`);
  if (
    !report.clean &&
    !parsed.requireCleanMedia &&
    parsed.mediaWarnings.length === 0
  ) process.exitCode = 2;
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
