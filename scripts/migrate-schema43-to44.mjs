import { resolve } from "node:path";
import "./node-typescript-runtime.mjs";

const {
  migrateSchema43To44,
  Schema43To44MigrationError,
} = await import("../server/schema43To44Migration.ts");

function fail(message) {
  throw new Schema43To44MigrationError(
    "SCHEMA_MIGRATION_ARGUMENT_INVALID",
    message,
  );
}

function parseArguments(argv) {
  const values = new Map();
  let mode;
  let quiesced = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "--dry-run") {
      if (mode) fail("Migration mode is duplicated");
      mode = argument === "--apply" ? "apply" : "dry-run";
      continue;
    }
    if (argument === "--quiesced-active-preservation") {
      if (quiesced) fail("Quiesced preservation mode is duplicated");
      quiesced = true;
      continue;
    }
    if (![
      "--data-dir",
      "--expected-logical-sha256",
      "--runtime-dir",
      "--scratch-root",
      "--freeze-at",
      "--last-provider-admission-at",
      "--preserved-task-id",
      "--preserved-task-attempt",
      "--previous-pid",
      "--previous-pid-namespace",
      "--previous-pid-start-ticks",
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
  const quiescedKeys = [
    "--freeze-at",
    "--last-provider-admission-at",
    "--preserved-task-id",
    "--preserved-task-attempt",
    "--previous-pid",
    "--previous-pid-namespace",
    "--previous-pid-start-ticks",
  ];
  if (quiesced && quiescedKeys.some((key) => !values.has(key))) {
    fail(
      "Quiesced preservation requires freeze time, last admission time, preserved task identity, and stopped process proof",
    );
  }
  if (!quiesced && quiescedKeys.some((key) => values.has(key))) {
    fail("Quiesced preservation arguments require --quiesced-active-preservation");
  }
  const positiveSafeInteger = (key) => {
    const value = Number(values.get(key));
    if (!Number.isSafeInteger(value) || value < 1) {
      fail(`${key} must be a positive safe integer`);
    }
    return value;
  };
  return {
    dataDirectory: values.get("--data-dir"),
    expectedSourceLogicalSha256: values.get("--expected-logical-sha256"),
    mode,
    runtimeDirectory: values.get("--runtime-dir"),
    scratchRoot: values.get("--scratch-root"),
    ...(quiesced ? {
      quiescedSourceContract: {
        expectedDatabaseLogicalSha256: values.get("--expected-logical-sha256"),
        expectedSchemaVersion: 43,
        freezeEvidence: {
          generationFrozenAt: values.get("--freeze-at"),
          lastProviderAdmissionAt: values.get("--last-provider-admission-at") === "none"
            ? null
            : values.get("--last-provider-admission-at"),
          sourceDatabaseLogicalSha256: values.get("--expected-logical-sha256"),
        },
        preservedTask: {
          taskId: values.get("--preserved-task-id"),
          executionAttempt: positiveSafeInteger("--preserved-task-attempt"),
        },
        runtimeDirectory: values.get("--runtime-dir"),
        stoppedProcess: {
          pid: positiveSafeInteger("--previous-pid"),
          pidNamespace: values.get("--previous-pid-namespace"),
          startTicks: values.get("--previous-pid-start-ticks"),
        },
      },
    } : {}),
  };
}

try {
  const result = await migrateSchema43To44(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  const code = error instanceof Schema43To44MigrationError
    ? error.code
    : "SCHEMA_MIGRATION_FAILED";
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code,
    error: error instanceof Error ? error.message : "Schema migration failed",
  })}\n`);
  process.exitCode = 1;
}
