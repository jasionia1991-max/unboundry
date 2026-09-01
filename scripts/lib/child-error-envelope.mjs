import { TextDecoder } from "node:util";

const maximumEnvelopeLineBytes = 4 * 1_024;
const maximumEnvelopeTextCharacters = 2 * 1_024;
const errorCodePattern = /^[A-Z][A-Z0-9_]{0,127}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });
const allowedWarningPatterns = Object.freeze([
  /^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/,
  /^\(node:\d+\) ExperimentalWarning: (?:SQLite|stripTypeScriptTypes) is an experimental feature and might change at any time$/,
]);

export const schemaMigrationChildErrorCodes = Object.freeze([
  "SCHEMA_MIGRATION_ACTIVE_GENERATION_TASKS",
  "SCHEMA_MIGRATION_ACTIVE_MEDIA",
  "SCHEMA_MIGRATION_ARGUMENT_INVALID",
  "SCHEMA_MIGRATION_BACKFILL_INCOMPLETE",
  "SCHEMA_MIGRATION_DATABASE_CHANGED",
  "SCHEMA_MIGRATION_DATABASE_CLOSE_UNKNOWN",
  "SCHEMA_MIGRATION_DATABASE_INVALID",
  "SCHEMA_MIGRATION_DATA_DIRECTORY_CHANGED",
  "SCHEMA_MIGRATION_DATA_DIRECTORY_INVALID",
  "SCHEMA_MIGRATION_FAILED",
  "SCHEMA_MIGRATION_FAILED_COMMIT",
  "SCHEMA_MIGRATION_FAILED_DRAIN",
  "SCHEMA_MIGRATION_FAILED_MARKER_CLEAR",
  "SCHEMA_MIGRATION_FAILED_MEDIA_BACKFILL",
  "SCHEMA_MIGRATION_FAILED_MEDIA_BACKFILL_PROBE",
  "SCHEMA_MIGRATION_FAILED_MEDIA_FULL_VERIFY",
  "SCHEMA_MIGRATION_FAILED_MEDIA_FULL_VERIFY_PROBE",
  "SCHEMA_MIGRATION_FAILED_OWNER_ACQUIRE",
  "SCHEMA_MIGRATION_FAILED_OWNER_RELEASE",
  "SCHEMA_MIGRATION_FAILED_POST_COMMIT_VERIFY",
  "SCHEMA_MIGRATION_FAILED_PREFLIGHT",
  "SCHEMA_MIGRATION_FAILED_RESULT",
  "SCHEMA_MIGRATION_FAILED_SCHEMA38_APPLY",
  "SCHEMA_MIGRATION_FAILED_SCHEMA39_APPLY",
  "SCHEMA_MIGRATION_FAILED_SCHEMA40_APPLY",
  "SCHEMA_MIGRATION_FAILED_SCHEMA41_APPLY",
  "SCHEMA_MIGRATION_FAILED_SCHEMA42_APPLY",
  "SCHEMA_MIGRATION_FAILED_SCRATCH_CLEANUP",
  "SCHEMA_MIGRATION_FAILED_TARGET_LOGICAL_INSPECTION",
  "SCHEMA_MIGRATION_FAILED_TARGET_VALIDATION",
  "SCHEMA_MIGRATION_GENERATION_NOT_FROZEN",
  "SCHEMA_MIGRATION_GUARDIAN_UNAVAILABLE",
  "SCHEMA_MIGRATION_GUARDIAN_UNSAFE",
  "SCHEMA_MIGRATION_LOCK_UNAVAILABLE",
  "SCHEMA_MIGRATION_MARKER_CHANGED",
  "SCHEMA_MIGRATION_MARKER_CONFLICT",
  "SCHEMA_MIGRATION_MARKER_INVALID",
  "SCHEMA_MIGRATION_MARKER_MISMATCH",
  "SCHEMA_MIGRATION_NATIVE_DURATION_PROBE_INCOMPLETE",
  "SCHEMA_MIGRATION_NOT_REQUIRED",
  "SCHEMA_MIGRATION_PATH_INVALID",
  "SCHEMA_MIGRATION_PLATFORM_UNSUPPORTED",
  "SCHEMA_MIGRATION_RECOVERY_REQUIRED",
  "SCHEMA_MIGRATION_RESTORE_INCOMPLETE",
  "SCHEMA_MIGRATION_RUNTIME_LEASE_UNAVAILABLE",
  "SCHEMA_MIGRATION_RUNTIME_LEASE_UNSAFE",
  "SCHEMA_MIGRATION_SCHEMA38_REJECTED",
  "SCHEMA_MIGRATION_SCRATCH_INVALID",
  "SCHEMA_MIGRATION_SOURCE_INVALID",
  "SCHEMA_MIGRATION_SOURCE_SHA_MISMATCH",
  "SCHEMA_MIGRATION_TARGET_INVALID",
  "SCHEMA_MIGRATION_TEST_CLOCK_FORBIDDEN",
  "SCHEMA_MIGRATION_TEST_DURATION_PROBE_FORBIDDEN",
  "SCHEMA_MIGRATION_UNSETTLED_PROVIDER_ATTEMPTS",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function boundedText(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maximumEnvelopeTextCharacters &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function envelopeCode(value, protocol) {
  if (
    protocol.envelope === "code-message" &&
    exactKeys(value, ["code", "message"]) &&
    boundedText(value.message)
  ) return value.code;
  if (
    protocol.envelope === "ok-code-error" &&
    exactKeys(value, ["code", "error", "ok"]) &&
    value.ok === false && boundedText(value.error)
  ) return value.code;
  return undefined;
}

export function parseChildErrorEnvelope(stderr, protocol) {
  const codePrefixes = Array.isArray(protocol?.codePrefixes)
    ? protocol.codePrefixes
    : [protocol?.codePrefix];
  if (
    !Buffer.isBuffer(stderr) ||
    !protocol || codePrefixes.length === 0 ||
    codePrefixes.some((prefix) => typeof prefix !== "string" || !prefix) ||
    !["code-message", "ok-code-error"].includes(protocol.envelope)
  ) return undefined;
  let source;
  try {
    source = decoder.decode(stderr);
  } catch {
    return undefined;
  }
  let accepted;
  for (const rawLine of source.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) continue;
    if (Buffer.byteLength(line, "utf8") > maximumEnvelopeLineBytes) {
      return undefined;
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      if (allowedWarningPatterns.some((pattern) => pattern.test(line))) continue;
      return undefined;
    }
    const code = envelopeCode(value, protocol);
    if (
      typeof code !== "string" || !errorCodePattern.test(code) ||
      !codePrefixes.some((prefix) => code.startsWith(prefix)) ||
      accepted !== undefined
    ) return undefined;
    if (
      Array.isArray(protocol.allowedCodes) &&
      !protocol.allowedCodes.includes(code)
    ) return undefined;
    accepted = Object.freeze({ code });
  }
  return accepted;
}
