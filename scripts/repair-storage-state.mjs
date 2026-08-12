import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import "./node-typescript-runtime.mjs";

const [
  { recordAudit },
  { currentSchemaVersion },
  { repairStorageProfileState },
] = await Promise.all([
  import("../server/audit.ts"),
  import("../server/database.ts"),
  import("../server/secureStorageProfiles.ts"),
]);

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new CliError(code, message);
}

function parseArguments(argv) {
  const values = new Map();
  const valueOptions = new Set(["--actor-login", "--data-dir"]);
  let apply = false;
  let backfill = false;
  let explicitDryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (["--apply", "--backfill", "--dry-run"].includes(option)) {
      const duplicate = option === "--apply"
        ? apply
        : option === "--backfill"
          ? backfill
          : explicitDryRun;
      if (duplicate) {
        fail("STORAGE_REPAIR_ARGUMENT_INVALID", "Duplicate storage repair flag");
      }
      if (option === "--apply") apply = true;
      else if (option === "--backfill") backfill = true;
      else explicitDryRun = true;
      continue;
    }
    if (!valueOptions.has(option)) {
      fail("STORAGE_REPAIR_ARGUMENT_INVALID", "Unknown storage repair argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("STORAGE_REPAIR_ARGUMENT_INVALID", "A storage repair value is missing");
    }
    if (values.has(option)) {
      fail("STORAGE_REPAIR_ARGUMENT_INVALID", "Duplicate storage repair argument");
    }
    values.set(option, value);
    index += 1;
  }
  if (apply && explicitDryRun) {
    fail("STORAGE_REPAIR_ARGUMENT_INVALID", "Choose either dry-run or apply");
  }
  for (const required of ["--actor-login", "--data-dir"]) {
    if (!values.has(required)) {
      fail("STORAGE_REPAIR_ARGUMENT_INVALID", "Required storage repair argument missing");
    }
  }
  return { apply, backfill, values };
}

function loginName(value) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/i.test(normalized)) {
    fail("STORAGE_REPAIR_ARGUMENT_INVALID", "Actor login name is invalid");
  }
  return normalized;
}

function normalizedAbsolutePath(value) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    normalize(value) !== value ||
    resolve(value) !== value
  ) {
    fail(
      "STORAGE_REPAIR_DATA_DIRECTORY_INVALID",
      "Data directory must be a normalized absolute path",
    );
  }
  return value;
}

async function existingDataDirectory(value) {
  const requested = normalizedAbsolutePath(value);
  const directoryDetails = await lstat(requested, { bigint: true }).catch(() => undefined);
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  if (
    currentUid === undefined ||
    !directoryDetails?.isDirectory() ||
    directoryDetails.isSymbolicLink() ||
    directoryDetails.uid !== currentUid ||
    (directoryDetails.mode & 0o022n) !== 0n
  ) {
    fail(
      "STORAGE_REPAIR_DATA_DIRECTORY_INVALID",
      "Data directory must be an existing real directory",
    );
  }
  const dataDirectory = await realpath(requested);
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const databaseDetails = await lstat(databasePath, { bigint: true }).catch(() => undefined);
  if (
    !databaseDetails?.isFile() ||
    databaseDetails.isSymbolicLink() ||
    databaseDetails.uid !== currentUid ||
    databaseDetails.nlink !== 1n ||
    (databaseDetails.mode & 0o022n) !== 0n ||
    databaseDetails.size < 1n
  ) {
    fail(
      "STORAGE_REPAIR_DATABASE_INVALID",
      "Application database must be an existing regular file",
    );
  }
  const canonicalDatabase = await realpath(databasePath);
  if (dirname(canonicalDatabase) !== dataDirectory) {
    fail(
      "STORAGE_REPAIR_DATABASE_INVALID",
      "Application database must stay inside the selected data directory",
    );
  }
  return { dataDirectory, databasePath: canonicalDatabase };
}

function openInspectionDatabase(databasePath) {
  const database = new DatabaseSync(databasePath, {
    readOnly: true,
    timeout: 5_000,
  });
  try {
    const schema = database.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get();
    if (Number(schema?.version) !== currentSchemaVersion) {
      fail(
        "STORAGE_REPAIR_SCHEMA_UNSUPPORTED",
        "Storage repair requires the current application schema",
      );
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function openApplyDatabase(databasePath) {
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const schema = database.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get();
    if (Number(schema?.version) !== currentSchemaVersion) {
      fail(
        "STORAGE_REPAIR_SCHEMA_UNSUPPORTED",
        "Storage repair requires the current application schema",
      );
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function activeAdmin(database, actorLogin) {
  const actor = database.prepare(`
    SELECT id FROM users
    WHERE login_name = ? COLLATE NOCASE AND role = 'admin' AND status = 'active'
  `).get(actorLogin);
  if (!actor) {
    fail(
      "STORAGE_REPAIR_ACTOR_INVALID",
      "Actor must be an existing active administrator",
    );
  }
  return actor;
}

function assertBackfillColumn(database) {
  const columns = database
    .prepare("PRAGMA table_info(media_assets)")
    .all()
    .map((column) => column.name);
  if (!columns.includes("storage_profile_id")) {
    fail(
      "STORAGE_REPAIR_SCHEMA_UNSUPPORTED",
      "Storage profile backfill column is unavailable",
    );
  }
}

async function withSelectedDataDirectory(dataDirectory, operation) {
  const previous = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.UNBOUNDRY_DATA_DIR;
    else process.env.UNBOUNDRY_DATA_DIR = previous;
  }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const actorLogin = loginName(parsed.values.get("--actor-login"));
  const { dataDirectory, databasePath } = await existingDataDirectory(
    parsed.values.get("--data-dir"),
  );
  const inspection = openInspectionDatabase(databasePath);
  let actor;
  try {
    actor = activeAdmin(inspection, actorLogin);
  } finally {
    inspection.close();
  }

  if (!parsed.apply) {
    const preview = await withSelectedDataDirectory(
      dataDirectory,
      () => repairStorageProfileState({ apply: false }),
    );
    let backfillRows = 0;
    if (parsed.backfill) {
      if (!preview.activeProfileId || !preview.profile) {
        fail(
          "STORAGE_REPAIR_ACTIVE_PROFILE_REQUIRED",
          "Backfill requires an active storage profile",
        );
      }
      const backfillInspection = openInspectionDatabase(databasePath);
      try {
        assertBackfillColumn(backfillInspection);
        backfillRows = Number(backfillInspection.prepare(`
          SELECT COUNT(*) AS count FROM media_assets
          WHERE storage_backend = 'oss' AND storage_profile_id IS NULL
        `).get()?.count ?? 0);
      } finally {
        backfillInspection.close();
      }
    }
    process.stdout.write(`${JSON.stringify({
      applied: false,
      backfillRows,
      changed: preview.changed,
      code: "STORAGE_REPAIR_DRY_RUN",
      mediaRoutingEnabledAfter: preview.mediaRoutingEnabled,
      profilePresent: Boolean(preview.profile),
    })}\n`);
    return;
  }

  let appliedBackfillRows = 0;
  const applyDatabase = openApplyDatabase(databasePath);
  let result;
  try {
    result = await withSelectedDataDirectory(dataDirectory, () =>
      repairStorageProfileState({
        actorUserId: actor.id,
        apply: true,
        database: applyDatabase,
        onCommit(database, repair) {
          const liveActor = activeAdmin(database, actorLogin);
          if (liveActor.id !== actor.id) {
            fail("STORAGE_REPAIR_ACTOR_CHANGED", "Actor identity changed before apply");
          }
          if (repair.activeProfileId && !repair.profile) {
            fail(
              "STORAGE_REPAIR_PROFILE_INVALID",
              "Selected storage profile is not safe to activate or backfill",
            );
          }
          if (parsed.backfill) {
            assertBackfillColumn(database);
            if (!repair.activeProfileId || !repair.profile) {
              fail(
                "STORAGE_REPAIR_ACTIVE_PROFILE_REQUIRED",
                "Backfill requires an active storage profile",
              );
            }
            appliedBackfillRows = Number(database.prepare(`
              UPDATE media_assets
              SET storage_profile_id = ?
              WHERE storage_backend = 'oss' AND storage_profile_id IS NULL
            `).run(repair.activeProfileId).changes);
          }
          recordAudit(database, liveActor.id, "repair_storage_profile_state", null, {
            backfillChanges: appliedBackfillRows,
            backfillRequested: parsed.backfill,
            changed: repair.changed,
            mediaRoutingEnabled: repair.mediaRoutingEnabled,
            operationId: repair.operationId,
            profileId: repair.activeProfileId || null,
          });
        },
      })
    );
  } finally {
    applyDatabase.close();
  }
  process.stdout.write(`${JSON.stringify({
    applied: true,
    backfillChanges: appliedBackfillRows,
    changed: result.changed,
    code: "STORAGE_REPAIR_APPLIED",
    mediaRoutingEnabled: result.mediaRoutingEnabled,
    profilePresent: Boolean(result.profile),
  })}\n`);
}

try {
  await main();
} catch (error) {
  const known = error instanceof CliError || (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("STORAGE_REPAIR_")
  );
  process.stderr.write(`${JSON.stringify({
    code: known ? error.code : "STORAGE_REPAIR_FAILED",
    message: error?.code === "STORAGE_REPAIR_RECOVERY_REQUIRED"
      ? "Storage repair recovery requires an explicit apply"
      : known
        ? error.message
        : "Storage repair failed safely",
  })}\n`);
  process.exitCode = 1;
}
