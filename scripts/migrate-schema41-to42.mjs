import { resolve } from "node:path";
import "./node-typescript-runtime.mjs";

const {
  migrateSchema41To42,
  Schema41To42MigrationError,
} = await import("../server/schema41To42Migration.ts");

function fail(message) {
  throw new Schema41To42MigrationError(
    "SCHEMA_MIGRATION_ARGUMENT_INVALID",
    message,
  );
}

function parseArguments(argv) {
  const values = new Map();
  let mode;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "--dry-run") {
      if (mode) fail("Migration mode is duplicated");
      mode = argument === "--apply" ? "apply" : "dry-run";
      continue;
    }
    if (![
      "--data-dir",
      "--expected-logical-sha256",
      "--runtime-dir",
      "--scratch-root",
    ].includes(argument)) fail("Unknown migration argument");
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(argument)) {
      fail("Migration argument is missing or duplicated");
    }
    values.set(argument, value);
    index += 1;
  }
  if (
    !mode || !values.has("--data-dir") ||
    !values.has("--expected-logical-sha256") ||
    !values.has("--runtime-dir")
  ) {
    fail(
      "Migration requires one explicit mode, data directory, runtime directory, and expected logical SHA-256",
    );
  }
  for (const key of ["--data-dir", "--runtime-dir", "--scratch-root"]) {
    const value = values.get(key);
    if (value && resolve(value) !== value) fail(`${key} must be normalized and absolute`);
  }
  return {
    dataDirectory: values.get("--data-dir"),
    expectedSourceLogicalSha256: values.get("--expected-logical-sha256"),
    mode,
    runtimeDirectory: values.get("--runtime-dir"),
    scratchRoot: values.get("--scratch-root"),
  };
}

try {
  const result = await migrateSchema41To42(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  const code = error instanceof Schema41To42MigrationError
    ? error.code
    : "SCHEMA_MIGRATION_FAILED";
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code,
    error: error instanceof Error ? error.message : "Schema migration failed",
  })}\n`);
  process.exitCode = 1;
}
