import { resolve } from "node:path";
import "./node-typescript-runtime.mjs";

const {
  SchemaMigrationError,
  migrateSchema37To39,
} = await import("../server/schemaMigration.ts");

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new CliError(code, message);
}

function normalizedAbsolute(value, label) {
  if (!value || resolve(value) !== value) {
    fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", `${label} must be normalized and absolute`);
  }
  return value;
}

function parseArguments(argv) {
  const values = new Map();
  let mode;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "--dry-run") {
      if (mode) fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Migration mode is duplicated");
      mode = argument === "--apply" ? "apply" : "dry-run";
      continue;
    }
    if (![
      "--data-dir",
      "--expected-logical-sha256",
      "--scratch-root",
      "--test-duration-probe-audit",
      "--test-duration-probe-executable",
    ].includes(argument)) {
      fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Unknown migration argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(argument)) {
      fail("SCHEMA_MIGRATION_ARGUMENT_INVALID", "Migration argument is missing or duplicated");
    }
    values.set(argument, value);
    index += 1;
  }
  if (!mode || !values.has("--data-dir") || !values.has("--expected-logical-sha256")) {
    fail(
      "SCHEMA_MIGRATION_ARGUMENT_INVALID",
      "Migration requires one explicit mode, data directory, and expected logical SHA-256",
    );
  }
  return {
    dataDirectory: normalizedAbsolute(values.get("--data-dir"), "Data directory"),
    expectedSourceLogicalSha256: values.get("--expected-logical-sha256"),
    mode,
    scratchRoot: values.has("--scratch-root")
      ? normalizedAbsolute(values.get("--scratch-root"), "Scratch root")
      : undefined,
    testDurationProbe: values.has("--test-duration-probe-audit") &&
        values.has("--test-duration-probe-executable")
      ? {
          auditPath: normalizedAbsolute(
            values.get("--test-duration-probe-audit"),
            "Test duration probe audit",
          ),
          executable: normalizedAbsolute(
            values.get("--test-duration-probe-executable"),
            "Test duration probe executable",
          ),
        }
      : values.has("--test-duration-probe-audit") ||
          values.has("--test-duration-probe-executable")
        ? fail(
            "SCHEMA_MIGRATION_ARGUMENT_INVALID",
            "Test duration probe arguments must be supplied together",
          )
        : undefined,
  };
}

function redact(message, paths) {
  let safe = String(message || "Schema migration failed");
  for (const path of paths.sort((left, right) => right.length - left.length)) {
    safe = safe.replaceAll(path, "[path]");
  }
  return safe;
}

let pathArguments = [];
try {
  const options = parseArguments(process.argv.slice(2));
  pathArguments = [options.dataDirectory, options.scratchRoot].filter(Boolean);
  const result = await migrateSchema37To39(options);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  const known = error instanceof SchemaMigrationError || error instanceof CliError;
  const code = known ? error.code : "SCHEMA_MIGRATION_FAILED";
  const message = redact(
    known ? error.message : "Schema migration failed",
    pathArguments,
  );
  process.stderr.write(`${JSON.stringify({ ok: false, code, error: message })}\n`);
  process.exitCode = 1;
}
