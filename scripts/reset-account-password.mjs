import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import "./node-typescript-runtime.mjs";

const [
  {
    AccountMutationBlockedError,
    assertAccountMutationAllowed,
  },
  { recordAudit },
  { hashPassword },
  { currentSchemaVersion },
] = await Promise.all([
  import("../server/accountMutationFence.ts"),
  import("../server/audit.ts"),
  import("../server/auth.ts"),
  import("../server/database.ts"),
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
  const valueOptions = new Set([
    "--actor-login",
    "--data-dir",
    "--password-file",
    "--target-login",
  ]);
  let apply = false;
  let explicitDryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--apply" || option === "--dry-run") {
      if (option === "--apply" ? apply : explicitDryRun) {
        fail("PASSWORD_RESET_ARGUMENT_INVALID", "Duplicate operation mode");
      }
      if (option === "--apply") apply = true;
      else explicitDryRun = true;
      continue;
    }
    if (!valueOptions.has(option)) {
      fail("PASSWORD_RESET_ARGUMENT_INVALID", "Unknown password reset argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("PASSWORD_RESET_ARGUMENT_INVALID", "A password reset value is missing");
    }
    if (values.has(option)) {
      fail("PASSWORD_RESET_ARGUMENT_INVALID", "Duplicate password reset argument");
    }
    values.set(option, value);
    index += 1;
  }
  if (apply && explicitDryRun) {
    fail("PASSWORD_RESET_ARGUMENT_INVALID", "Choose either dry-run or apply");
  }
  for (const required of ["--actor-login", "--data-dir", "--target-login"]) {
    if (!values.has(required)) {
      fail("PASSWORD_RESET_ARGUMENT_INVALID", "Required password reset argument missing");
    }
  }
  if (!apply && values.has("--password-file")) {
    fail(
      "PASSWORD_RESET_ARGUMENT_INVALID",
      "Dry-run never accepts or reads password material",
    );
  }
  return { apply, values };
}

function loginName(value) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/i.test(normalized)) {
    fail("PASSWORD_RESET_ARGUMENT_INVALID", "Account login name is invalid");
  }
  return normalized;
}

function normalizedAbsolutePath(value, code, label) {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    normalize(value) !== value ||
    resolve(value) !== value
  ) {
    fail(code, `${label} must be a normalized absolute path`);
  }
  return value;
}

async function existingDatabasePath(value) {
  const requested = normalizedAbsolutePath(
    value,
    "PASSWORD_RESET_DATA_DIRECTORY_INVALID",
    "Data directory",
  );
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
      "PASSWORD_RESET_DATA_DIRECTORY_INVALID",
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
      "PASSWORD_RESET_DATABASE_INVALID",
      "Application database must be an existing regular file",
    );
  }
  const canonicalDatabase = await realpath(databasePath);
  if (dirname(canonicalDatabase) !== dataDirectory) {
    fail(
      "PASSWORD_RESET_DATABASE_INVALID",
      "Application database must stay inside the selected data directory",
    );
  }
  return canonicalDatabase;
}

function openExistingDatabase(databasePath, readOnly) {
  const database = new DatabaseSync(databasePath, {
    readOnly,
    timeout: 5_000,
  });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const schema = database.prepare(
      "SELECT MAX(version) AS version FROM schema_migrations",
    ).get();
    if (Number(schema?.version) !== currentSchemaVersion) {
      fail(
        "PASSWORD_RESET_SCHEMA_UNSUPPORTED",
        "Password reset requires the current application schema",
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
      "PASSWORD_RESET_ACTOR_INVALID",
      "Actor must be an existing active administrator",
    );
  }
  return actor;
}

function targetAccount(database, targetLogin) {
  const target = database.prepare(`
    SELECT id FROM users WHERE login_name = ? COLLATE NOCASE
  `).get(targetLogin);
  if (!target) {
    fail("PASSWORD_RESET_TARGET_NOT_FOUND", "Target account does not exist");
  }
  return target;
}

async function passwordFromFile(value) {
  const path = normalizedAbsolutePath(
    value,
    "PASSWORD_RESET_PASSWORD_FILE_INVALID",
    "Password file",
  );
  const before = await lstat(path, { bigint: true }).catch(() => undefined);
  const currentUid = typeof process.getuid === "function"
    ? BigInt(process.getuid())
    : undefined;
  if (
    currentUid === undefined ||
    !before?.isFile() ||
    before.isSymbolicLink() ||
    (before.mode & 0o777n) !== 0o600n ||
    before.nlink !== 1n ||
    before.size < 1n ||
    before.size > 4_096n ||
    before.uid !== currentUid
  ) {
    fail(
      "PASSWORD_RESET_PASSWORD_FILE_INVALID",
      "Password file must be a private 0600 regular file owned by this user",
    );
  }
  let handle;
  let scratch;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.uid !== before.uid ||
      opened.nlink !== 1n ||
      (opened.mode & 0o777n) !== 0o600n ||
      opened.size !== before.size ||
      opened.mtimeNs !== before.mtimeNs ||
      opened.ctimeNs !== before.ctimeNs ||
      opened.size < 1n ||
      opened.size > 4_096n
    ) {
      fail(
        "PASSWORD_RESET_PASSWORD_FILE_INVALID",
        "Password file changed while it was being opened",
      );
    }
    const expectedSize = Number(opened.size);
    scratch = Buffer.alloc(expectedSize + 1);
    let position = 0;
    while (position < scratch.length) {
      const { bytesRead } = await handle.read(
        scratch,
        position,
        scratch.length - position,
        position,
      );
      if (!bytesRead) break;
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      position !== expectedSize ||
      !after.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.uid !== opened.uid ||
      after.nlink !== opened.nlink ||
      (after.mode & 0o777n) !== (opened.mode & 0o777n) ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs
    ) {
      fail(
        "PASSWORD_RESET_PASSWORD_FILE_INVALID",
        "Password file changed while it was being read",
      );
    }
    const password = scratch.subarray(0, expectedSize).toString("utf8")
      .replace(/\r?\n$/, "");
    scratch.fill(0);
    scratch = undefined;
    return password;
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail("PASSWORD_RESET_PASSWORD_FILE_INVALID", "Password file cannot be read safely");
  } finally {
    scratch?.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

function passwordFromHiddenTty() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    fail(
      "PASSWORD_RESET_PASSWORD_INPUT_REQUIRED",
      "Apply requires a hidden TTY or an absolute private password file",
    );
  }
  process.stderr.write(`${JSON.stringify({
    code: "PASSWORD_RESET_PASSWORD_REQUIRED",
    prompt: "Enter the new password; input is hidden",
  })}\n`);
  return new Promise((resolvePassword, rejectPassword) => {
    const input = process.stdin;
    const wasRaw = Boolean(input.isRaw);
    let value = "";
    let settled = false;
    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectPassword(error);
      else resolvePassword(value);
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new CliError("PASSWORD_RESET_CANCELLED", "Password reset cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = [...value].slice(0, -1).join("");
          continue;
        }
        if (character >= " " && character !== "\u007f") value += character;
        if ([...value].length > 200) {
          finish(new CliError("PASSWORD_RESET_PASSWORD_INVALID", "Password is too long"));
          return;
        }
      }
    };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function validatePassword(value) {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    value.length > 200 ||
    /[\0\r\n]/.test(value)
  ) {
    fail("PASSWORD_RESET_PASSWORD_INVALID", "Password must contain 12 to 200 characters");
  }
  return value;
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const actorLogin = loginName(parsed.values.get("--actor-login"));
  const targetLogin = loginName(parsed.values.get("--target-login"));
  const databasePath = await existingDatabasePath(parsed.values.get("--data-dir"));

  const inspection = openExistingDatabase(databasePath, true);
  let actor;
  let target;
  let sessions;
  try {
    actor = activeAdmin(inspection, actorLogin);
    target = targetAccount(inspection, targetLogin);
    sessions = Number(inspection.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?",
    ).get(target.id)?.count ?? 0);
  } finally {
    inspection.close();
  }
  if (!parsed.apply) {
    process.stdout.write(`${JSON.stringify({
      applied: false,
      code: "PASSWORD_RESET_DRY_RUN",
      sessionsToRevoke: sessions,
    })}\n`);
    return;
  }

  const password = validatePassword(
    parsed.values.has("--password-file")
      ? await passwordFromFile(parsed.values.get("--password-file"))
      : await passwordFromHiddenTty(),
  );
  const passwordHash = await hashPassword(password);
  const database = openExistingDatabase(databasePath, false);
  let sessionsRevoked = 0;
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const liveActor = activeAdmin(database, actorLogin);
      const liveTarget = targetAccount(database, targetLogin);
      if (liveActor.id !== actor.id || liveTarget.id !== target.id) {
        fail("PASSWORD_RESET_ACCOUNT_CHANGED", "Account identity changed before apply");
      }
      assertAccountMutationAllowed(database, liveActor.id);
      assertAccountMutationAllowed(database, liveTarget.id, {
        allowDisabled: true,
      });
      const updated = database.prepare(`
        UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
      `).run(passwordHash, new Date().toISOString(), liveTarget.id);
      if (updated.changes !== 1) {
        fail("PASSWORD_RESET_TARGET_NOT_FOUND", "Target account does not exist");
      }
      sessionsRevoked = Number(database.prepare(
        "DELETE FROM sessions WHERE user_id = ?",
      ).run(liveTarget.id).changes);
      recordAudit(
        database,
        liveActor.id,
        "reset_password_emergency",
        liveTarget.id,
        { sessionsRevoked },
      );
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  process.stdout.write(`${JSON.stringify({
    applied: true,
    code: "PASSWORD_RESET_APPLIED",
    sessionsRevoked,
  })}\n`);
}

try {
  await main();
} catch (error) {
  const known = error instanceof CliError || error instanceof AccountMutationBlockedError;
  process.stderr.write(`${JSON.stringify({
    code: known ? error.code : "PASSWORD_RESET_FAILED",
    message: error instanceof AccountMutationBlockedError
      ? "Account mutation is blocked"
      : known
        ? error.message
        : "Password reset failed safely",
  })}\n`);
  process.exitCode = known && error.code === "PASSWORD_RESET_CANCELLED" ? 130 : 1;
}
