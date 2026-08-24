import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fileConstants,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  databaseMatchesFrozenSchema37Contract,
  inspectLockedBackupDatabase,
} from "../server/backupInspection";
import {
  applyPendingSchemaMigrationsInTransaction,
  currentSchemaVersion,
  databaseHasCompleteLegacyMediaMetadata,
  databaseMatchesMigrationManifest,
  databaseMatchesSchemaContract,
  migrationIncompleteMarker,
  openAppDatabase,
  type CurrentDatabaseOpenCheckpoint,
  setAfterGreenfieldDatabasePublishForTests,
  setDuringCurrentDatabaseOpenForTests,
  setDuringGreenfieldDatabaseInitializationForTests,
} from "../server/database";
import {
  migrateSchema37To39,
  SchemaMigrationError,
} from "../server/schemaMigration";
import { createRuntimeRoleCoordinator } from "../server/runtimeRole";
import { acquireLegacyChildGuardian } from "../server/legacyChildGuardian";
import { expect, test } from "./safe-test";

const executeFile = promisify(execFile);
const migrationScript = join(
  process.cwd(),
  "scripts/migrate-schema37-to39.mjs",
);

const currentOpenChildBootstrap = `
  import { createServer } from "vite";
  import { existsSync, writeFileSync } from "node:fs";
  const [dataDirectory, startedPath, checkpointPlanJson] = process.argv.slice(1);
  const checkpointPlans = JSON.parse(checkpointPlanJson);
  const server = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { hmr: false, middlewareMode: true, ws: false },
  });
  try {
    const module = await server.ssrLoadModule("/server/database.ts");
    if (checkpointPlans.length > 0) {
      const completed = new Set();
      module.setDuringCurrentDatabaseOpenForTests((checkpoint) => {
        const plan = checkpointPlans.find((item) => item.checkpoint === checkpoint);
        if (!plan || completed.has(checkpoint)) return;
        completed.add(checkpoint);
        writeFileSync(plan.readyPath, "ready", { flag: "wx", mode: 0o600 });
        while (plan.releasePath && !existsSync(plan.releasePath)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      });
    }
    writeFileSync(startedPath, "started", { flag: "wx", mode: 0o600 });
    const database = module.openAppDatabase(dataDirectory);
    const version = database.prepare("PRAGMA user_version").get().user_version;
    database.close();
    process.stdout.write(JSON.stringify({ pid: process.pid, version }));
  } finally {
    await server.close();
  }
`;

type CurrentOpenCheckpointPlan = Readonly<{
  checkpoint: CurrentDatabaseOpenCheckpoint;
  readyPath: string;
  releasePath: string;
}>;

function runCurrentOpenChild(
  dataDirectory: string,
  startedPath: string,
  checkpointPlans: readonly CurrentOpenCheckpointPlan[] = [],
) {
  return new Promise<{ pid: number; version: number }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      currentOpenChildBootstrap,
      dataDirectory,
      startedPath,
      JSON.stringify(checkpointPlans),
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Current-open child exited with ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout) as { pid: number; version: number });
    });
  });
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function createExactSchema(
  dataDirectory: string,
  targetVersion: 37 | 38,
) {
  await mkdir(dataDirectory, { mode: 0o700 });
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "PRAGMA foreign_keys = ON;" +
        "CREATE TABLE IF NOT EXISTS schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    );BEGIN IMMEDIATE;",
    );
    applyPendingSchemaMigrationsInTransaction(database, {
      appliedAt: () => "2026-08-12T00:00:00.000Z",
      sourceVersion: 0,
      targetVersion,
    });
    database.exec("COMMIT; PRAGMA journal_mode = DELETE;");
  } finally {
    database.close();
  }
  await chmod(databasePath, 0o600);
  return databasePath;
}

function expectedLogicalSha(databasePath: string, inspectionRoot: string) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("BEGIN IMMEDIATE");
    return inspectLockedBackupDatabase(database, inspectionRoot).logicalSha256;
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
}

async function sourceFingerprint(dataDirectory: string) {
  const names = (await readdir(dataDirectory)).sort();
  const files = await Promise.all(names.map(async (name) => ({
    name,
    sha256: createHash("sha256")
      .update(await readFile(join(dataDirectory, name)))
      .digest("hex"),
  })));
  return { files, names };
}

function exactPathFingerprint(path: string) {
  const details = lstatSync(path, { bigint: true });
  return Object.freeze({
    bytes: details.isSymbolicLink()
      ? `symlink:${readlinkSync(path)}`
      : readFileSync(path).toString("base64"),
    ctimeNs: details.ctimeNs.toString(),
    dev: details.dev.toString(),
    gid: details.gid.toString(),
    ino: details.ino.toString(),
    mode: details.mode.toString(),
    mtimeNs: details.mtimeNs.toString(),
    nlink: details.nlink.toString(),
    rdev: details.rdev.toString(),
    size: details.size.toString(),
    uid: details.uid.toString(),
  });
}

function withSafeMigrationClock<T>(operation: () => Promise<T>) {
  const previousSafe = process.env.UNBOUNDRY_SAFE_TEST;
  const previousClock = process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK;
  process.env.UNBOUNDRY_SAFE_TEST = "1";
  process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK = "1";
  return operation().finally(() => {
    if (previousSafe === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
    else process.env.UNBOUNDRY_SAFE_TEST = previousSafe;
    if (previousClock === undefined) {
      delete process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK;
    } else {
      process.env.UNBOUNDRY_SCHEMA_MIGRATION_TEST_CLOCK = previousClock;
    }
  });
}

function createSafeDurationProbe(root: string) {
  const executable = join(root, "m91-safe-ffprobe");
  const auditPath = join(root, "m91-duration-probe-audit.jsonl");
  writeFileSync(executable, `#!/bin/sh
set -eu
expected='-v error -protocol_whitelist file,pipe -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 /dev/fd/3'
test "$#" -eq 9
test "$*" = "$expected"
test -r /dev/fd/3
test "$(wc -c < /dev/fd/3 | tr -d ' ')" -gt 0
printf '7.125\\n'
`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  writeFileSync(auditPath, "", { mode: 0o600 });
  chmodSync(auditPath, 0o600);
  return Object.freeze({ auditPath, executable });
}

function createShortPcmWav() {
  const channels = 1;
  const sampleRate = 8_000;
  const bitsPerSample = 16;
  const sampleCount = sampleRate / 4;
  const blockAlign = channels * bitsPerSample / 8;
  const dataBytes = sampleCount * blockAlign;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * blockAlign, 28);
  bytes.writeUInt16LE(blockAlign, 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

test("ordinary open is current-only while greenfield publication remains atomic", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-open-"));
  const greenfield = join(root, "greenfield");
  const greenfieldReplacement = join(root, "greenfield-replacement");
  const greenfieldRace = join(root, "greenfield-race");
  const greenfieldResidue = join(root, "greenfield-residue");
  const greenfieldThrow = join(root, "greenfield-throw");
  const greenfieldDirectorySwap = join(root, "greenfield-directory-swap");
  const greenfieldConcurrent = join(root, "greenfield-concurrent");
  const greenfieldMarkerRewrite = join(root, "greenfield-marker-rewrite");
  const greenfieldFinalFailure = join(root, "greenfield-final-failure");
  const currentSnapshotRace = join(root, "current-snapshot-race");
  const injectedSidecarRace = join(root, "injected-sidecar-race");
  const currentInitializing = join(root, "current-initializing");
  const currentReleased = join(root, "current-released");
  const currentForeignReservation = join(root, "current-foreign-reservation");
  const orphanSidecars = join(root, "orphan-sidecars");
  const legacy = join(root, "legacy");
  try {
    const initialized = openAppDatabase(greenfield);
    expect(databaseMatchesMigrationManifest(initialized)).toBe(true);
    expect(databaseMatchesSchemaContract(initialized)).toBe(true);
    expect(initialized.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    initialized.close();
    expect((await readdir(greenfield)).some((name) =>
      name.startsWith(".unboundry-greenfield-"))).toBe(false);
    const reopened = openAppDatabase(greenfield);
    expect(reopened.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "wal",
    });
    reopened.close();
    expect(await readdir(greenfield)).not.toContain(
      ".unboundry-current-database-open-reservation",
    );

    const reservationName = ".unboundry-current-database-open-reservation";

    openAppDatabase(currentInitializing).close();
    const initializingDatabasePath = join(
      currentInitializing,
      "unboundry.sqlite",
    );
    const initializingLogicalSha = expectedLogicalSha(
      initializingDatabasePath,
      root,
    );
    const initializingOwnerCreated = join(root, "initializing-owner-created");
    const initializingOwnerCreateRelease = join(
      root,
      "initializing-owner-create-release",
    );
    const initializingOwnerInspected = join(
      root,
      "initializing-owner-inspected",
    );
    const initializingOwnerInspectionRelease = join(
      root,
      "initializing-owner-inspection-release",
    );
    const initializingContenderPinned = join(
      root,
      "initializing-contender-pinned",
    );
    const initializingContenderPinRelease = join(
      root,
      "initializing-contender-pin-release",
    );
    const initializingContenderActive = join(
      root,
      "initializing-contender-active",
    );
    const initializingContenderActiveRelease = join(
      root,
      "initializing-contender-active-release",
    );
    const initializingOwner = runCurrentOpenChild(
      currentInitializing,
      join(root, "initializing-owner-started"),
      [
        {
          checkpoint: "reservation-created-before-document",
          readyPath: initializingOwnerCreated,
          releasePath: initializingOwnerCreateRelease,
        },
        {
          checkpoint: "inspection-schema-validated",
          readyPath: initializingOwnerInspected,
          releasePath: initializingOwnerInspectionRelease,
        },
      ],
    );
    await waitForFile(initializingOwnerCreated);
    expect(await readFile(join(currentInitializing, reservationName))).toHaveLength(0);
    const initializingContender = runCurrentOpenChild(
      currentInitializing,
      join(root, "initializing-contender-started"),
      [
        {
          checkpoint: "competing-reservation-pinned",
          readyPath: initializingContenderPinned,
          releasePath: initializingContenderPinRelease,
        },
        {
          checkpoint: "competing-reservation-active",
          readyPath: initializingContenderActive,
          releasePath: initializingContenderActiveRelease,
        },
      ],
    );
    await waitForFile(initializingContenderPinned);
    await writeFile(initializingOwnerCreateRelease, "release", {
      flag: "wx",
      mode: 0o600,
    });
    await waitForFile(initializingOwnerInspected);
    expect((await readFile(join(currentInitializing, reservationName))).length)
      .toBeGreaterThan(0);
    await writeFile(initializingContenderPinRelease, "release", {
      flag: "wx",
      mode: 0o600,
    });
    await waitForFile(initializingContenderActive);
    await writeFile(initializingContenderActiveRelease, "release", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(initializingOwnerInspectionRelease, "release", {
      flag: "wx",
      mode: 0o600,
    });
    const initializingOpens = await Promise.all([
      initializingOwner,
      initializingContender,
    ]);
    expect(new Set(initializingOpens.map((item) => item.pid)).size).toBe(2);
    expect(new Set(initializingOpens.map((item) => item.version))).toEqual(
      new Set([currentSchemaVersion]),
    );
    expect(expectedLogicalSha(initializingDatabasePath, root)).toBe(
      initializingLogicalSha,
    );
    expect(await readdir(currentInitializing)).toEqual(["unboundry.sqlite"]);

    openAppDatabase(currentReleased).close();
    const releasedDatabasePath = join(currentReleased, "unboundry.sqlite");
    const releasedLogicalSha = expectedLogicalSha(releasedDatabasePath, root);
    const releasedOwnerInspected = join(root, "released-owner-inspected");
    const releasedOwnerInspectionRelease = join(
      root,
      "released-owner-inspection-release",
    );
    const releasedContenderPinned = join(root, "released-contender-pinned");
    const releasedContenderPinRelease = join(
      root,
      "released-contender-pin-release",
    );
    const releasedOwner = runCurrentOpenChild(
      currentReleased,
      join(root, "released-owner-started"),
      [{
        checkpoint: "inspection-schema-validated",
        readyPath: releasedOwnerInspected,
        releasePath: releasedOwnerInspectionRelease,
      }],
    );
    await waitForFile(releasedOwnerInspected);
    const releasedContender = runCurrentOpenChild(
      currentReleased,
      join(root, "released-contender-started"),
      [{
        checkpoint: "competing-reservation-pinned",
        readyPath: releasedContenderPinned,
        releasePath: releasedContenderPinRelease,
      }],
    );
    await waitForFile(releasedContenderPinned);
    await writeFile(releasedOwnerInspectionRelease, "release", {
      flag: "wx",
      mode: 0o600,
    });
    const releasedOwnerResult = await releasedOwner;
    expect(await readdir(currentReleased)).not.toContain(reservationName);
    await writeFile(releasedContenderPinRelease, "release", {
      flag: "wx",
      mode: 0o600,
    });
    const releasedContenderResult = await releasedContender;
    const releasedOpens = [releasedOwnerResult, releasedContenderResult];
    expect(new Set(releasedOpens.map((item) => item.pid)).size).toBe(2);
    expect(new Set(releasedOpens.map((item) => item.version))).toEqual(
      new Set([currentSchemaVersion]),
    );
    expect(expectedLogicalSha(releasedDatabasePath, root)).toBe(
      releasedLogicalSha,
    );
    expect(await readdir(currentReleased)).toEqual(["unboundry.sqlite"]);

    for (const variant of ["hot-wal", "zero-wal"] as const) {
      const dataDirectory = join(root, `current-sidecar-close-${variant}`);
      openAppDatabase(dataDirectory).close();
      const databasePath = join(dataDirectory, "unboundry.sqlite");
      const rowId = `m91-sidecar-close-${variant}`;
      let keeper: DatabaseSync | undefined = new DatabaseSync(databasePath, {
        timeout: 5_000,
      });
      const checkpointReady = join(root, `${variant}-before-writer-ready`);
      const checkpointRelease = join(root, `${variant}-before-writer-release`);
      let child: ReturnType<typeof runCurrentOpenChild> | undefined;
      let checkpointReleased = false;
      try {
        expect(keeper.prepare("PRAGMA journal_mode").get()).toEqual({
          journal_mode: "wal",
        });
        keeper.prepare(`
          INSERT INTO project_metadata (
            owner_id, id, title, updated_at, is_project, created_at, deleted_at
          ) VALUES (NULL, ?, ?, 1, 1, 1, NULL)
        `).run(rowId, variant);
        const logicalSha = expectedLogicalSha(databasePath, root);
        if (variant === "zero-wal") {
          keeper.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        }
        const walBefore = lstatSync(`${databasePath}-wal`, { bigint: true });
        const shmBefore = lstatSync(`${databasePath}-shm`, { bigint: true });
        expect(walBefore.isFile()).toBe(true);
        expect(shmBefore.isFile()).toBe(true);
        if (variant === "hot-wal") {
          expect(walBefore.size).toBeGreaterThan(0n);
        } else {
          expect(walBefore.size).toBe(0n);
        }
        child = runCurrentOpenChild(
          dataDirectory,
          join(root, `${variant}-child-started`),
          [{
            checkpoint: "before-writer-sidecar-validation",
            readyPath: checkpointReady,
            releasePath: checkpointRelease,
          }],
        );
        await waitForFile(checkpointReady);

        // The child has captured and validated the pair and still owns its
        // inspection transaction. Closing the former last writer must not let
        // SQLite remove or replace those pinned sidecars before the child
        // acquires its own writer lock.
        keeper.close();
        keeper = undefined;
        for (const [path, before] of [
          [`${databasePath}-wal`, walBefore],
          [`${databasePath}-shm`, shmBefore],
        ] as const) {
          const after = lstatSync(path, { bigint: true });
          expect({
            dev: after.dev,
            ino: after.ino,
            mode: after.mode,
            nlink: after.nlink,
            uid: after.uid,
          }).toEqual({
            dev: before.dev,
            ino: before.ino,
            mode: before.mode,
            nlink: 1n,
            uid: before.uid,
          });
        }
        await writeFile(checkpointRelease, "release", {
          flag: "wx",
          mode: 0o600,
        });
        checkpointReleased = true;
        const opened = await child;
        expect(opened.version).toBe(currentSchemaVersion);
        expect(expectedLogicalSha(databasePath, root)).toBe(logicalSha);
        const verification = openAppDatabase(dataDirectory);
        try {
          expect(verification.prepare(`
            SELECT title FROM project_metadata WHERE id = ?
          `).get(rowId)).toEqual({ title: variant });
        } finally {
          verification.close();
        }
        expect(await readdir(dataDirectory)).toEqual(["unboundry.sqlite"]);
      } finally {
        if (keeper) {
          try {
            keeper.close();
          } catch {
            // Preserve the test failure while releasing the WAL keeper.
          }
        }
        if (child && !checkpointReleased) {
          try {
            await writeFile(checkpointRelease, "release", {
              flag: "wx",
              mode: 0o600,
            });
          } catch {
            // The child may have failed before reaching the checkpoint.
          }
          await child.catch(() => undefined);
        }
      }
    }

    openAppDatabase(currentForeignReservation).close();
    const foreignReservationPath = join(
      currentForeignReservation,
      ".unboundry-current-database-open-reservation",
    );
    const foreignReservation = `${JSON.stringify({
      contract: "unboundry-current-database-open-reservation-v1",
      nonce: "00000000-0000-4000-8000-000000000000",
      pid: process.pid,
    })}\n`;
    await writeFile(foreignReservationPath, foreignReservation, {
      flag: "wx",
      mode: 0o600,
    });
    expect(() => openAppDatabase(currentForeignReservation)).toThrow(
      "Application data maintenance is incomplete",
    );
    expect(await readFile(foreignReservationPath, "utf8")).toBe(
      foreignReservation,
    );

    await createExactSchema(legacy, 37);
    const before = await sourceFingerprint(legacy);
    expect(() => openAppDatabase(legacy)).toThrow(
      "Application database is not the exact current schema",
    );
    expect(await sourceFingerprint(legacy)).toEqual(before);

    const preexistingEmpty = join(root, "preexisting-empty");
    await mkdir(preexistingEmpty, { mode: 0o700 });
    await writeFile(join(preexistingEmpty, "unboundry.sqlite"), "", {
      mode: 0o600,
    });
    expect(() => openAppDatabase(preexistingEmpty)).toThrow();
    expect((await readFile(join(preexistingEmpty, "unboundry.sqlite"))).length)
      .toBe(0);

    const replacementPath = await createExactSchema(greenfieldReplacement, 37);
    const displacedPublished = join(
      greenfieldRace,
      "unboundry-published-current.sqlite",
    );
    setAfterGreenfieldDatabasePublishForTests((publishedPath) => {
      renameSync(publishedPath, displacedPublished);
      renameSync(replacementPath, publishedPath);
    });
    try {
      expect(() => openAppDatabase(greenfieldRace)).toThrow();
    } finally {
      setAfterGreenfieldDatabasePublishForTests(undefined);
    }
    const rejectedReplacement = new DatabaseSync(
      join(greenfieldRace, "unboundry.sqlite"),
      { readOnly: true },
    );
    expect(rejectedReplacement.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    rejectedReplacement.close();
    const displacedCurrent = new DatabaseSync(displacedPublished, {
      readOnly: true,
    });
    expect(databaseMatchesMigrationManifest(displacedCurrent)).toBe(true);
    expect(databaseMatchesSchemaContract(displacedCurrent)).toBe(true);
    displacedCurrent.close();
    expect(await readdir(greenfieldRace)).toContain(migrationIncompleteMarker);
    expect(() => openAppDatabase(greenfieldRace)).toThrow(
      "Application data maintenance is incomplete",
    );

    setDuringGreenfieldDatabaseInitializationForTests((checkpoint) => {
      if (checkpoint === "reservation-closed") {
        writeFileSync(join(greenfieldResidue, "foreign-residue"), "foreign", {
          mode: 0o600,
        });
      }
    });
    try {
      expect(() => openAppDatabase(greenfieldResidue)).toThrow(
        "Application data directory entries changed",
      );
    } finally {
      setDuringGreenfieldDatabaseInitializationForTests(undefined);
    }
    expect(await readFile(join(greenfieldResidue, "foreign-residue"), "utf8"))
      .toBe("foreign");
    expect(await readdir(greenfieldResidue)).toContain(
      migrationIncompleteMarker,
    );
    expect(() => openAppDatabase(greenfieldResidue)).toThrow(
      "Application data maintenance is incomplete",
    );

    setAfterGreenfieldDatabasePublishForTests(() => {
      throw new Error("simulated post-publish failure");
    });
    try {
      expect(() => openAppDatabase(greenfieldThrow)).toThrow(
        "simulated post-publish failure",
      );
    } finally {
      setAfterGreenfieldDatabasePublishForTests(undefined);
    }
    expect(await readdir(greenfieldThrow)).toEqual([]);

    const displacedGreenfieldDirectory = join(
      root,
      "greenfield-directory-swap-original",
    );
    setDuringGreenfieldDatabaseInitializationForTests((checkpoint) => {
      if (checkpoint === "database-closed") {
        renameSync(greenfieldDirectorySwap, displacedGreenfieldDirectory);
        mkdirSync(greenfieldDirectorySwap, { mode: 0o700 });
        writeFileSync(
          join(greenfieldDirectorySwap, "foreign-directory-entry"),
          "foreign-directory",
          { mode: 0o600 },
        );
      }
    });
    try {
      expect(() => openAppDatabase(greenfieldDirectorySwap)).toThrow(
        "Application data directory changed",
      );
    } finally {
      setDuringGreenfieldDatabaseInitializationForTests(undefined);
    }
    expect(await readFile(
      join(greenfieldDirectorySwap, "foreign-directory-entry"),
      "utf8",
    )).toBe("foreign-directory");
    expect(await readdir(greenfieldDirectorySwap)).toContain(
      migrationIncompleteMarker,
    );
    expect(() => openAppDatabase(greenfieldDirectorySwap)).toThrow(
      "Application data maintenance is incomplete",
    );
    expect(await readdir(displacedGreenfieldDirectory)).toContain(
      migrationIncompleteMarker,
    );

    setDuringGreenfieldDatabaseInitializationForTests((checkpoint) => {
      if (checkpoint === "marker-published") {
        expect(() => openAppDatabase(greenfieldConcurrent)).toThrow(
          "Application data maintenance is incomplete",
        );
      }
    });
    try {
      const concurrent = openAppDatabase(greenfieldConcurrent);
      concurrent.close();
    } finally {
      setDuringGreenfieldDatabaseInitializationForTests(undefined);
    }
    expect(await readdir(greenfieldConcurrent)).toEqual([
      "unboundry.sqlite",
    ]);

    setDuringGreenfieldDatabaseInitializationForTests((checkpoint) => {
      if (checkpoint === "marker-published") {
        const markerPath = join(
          greenfieldMarkerRewrite,
          migrationIncompleteMarker,
        );
        const before = lstatSync(markerPath);
        const marker = readFileSync(markerPath);
        marker[0] = marker[0] === 0x7b ? 0x5b : 0x7b;
        writeFileSync(markerPath, marker);
        utimesSync(markerPath, before.atime, before.mtime);
      }
    });
    try {
      expect(() => openAppDatabase(greenfieldMarkerRewrite)).toThrow(
        "Greenfield initialization entry changed",
      );
    } finally {
      setDuringGreenfieldDatabaseInitializationForTests(undefined);
    }
    expect(await readdir(greenfieldMarkerRewrite)).toContain(
      migrationIncompleteMarker,
    );
    expect(() => openAppDatabase(greenfieldMarkerRewrite)).toThrow(
      "Application data maintenance is incomplete",
    );

    let finalPublishedIdentity:
      | Readonly<{ dev: bigint; ino: bigint }>
      | undefined;
    setDuringGreenfieldDatabaseInitializationForTests((checkpoint) => {
      if (checkpoint === "final-validation-complete") {
        const names = readdirSync(greenfieldFinalFailure);
        expect(names).toContain(migrationIncompleteMarker);
        expect(names).toContain("unboundry.sqlite");
        const published = lstatSync(
          join(greenfieldFinalFailure, "unboundry.sqlite"),
          { bigint: true },
        );
        finalPublishedIdentity = Object.freeze({
          dev: published.dev,
          ino: published.ino,
        });
        expect(() => openAppDatabase(greenfieldFinalFailure)).toThrow(
          "Application data maintenance is incomplete",
        );
        throw new Error("simulated post-commit validation observer failure");
      }
    });
    try {
      expect(() => openAppDatabase(greenfieldFinalFailure)).toThrow(
        "simulated post-commit validation observer failure",
      );
    } finally {
      setDuringGreenfieldDatabaseInitializationForTests(undefined);
    }
    expect(await readdir(greenfieldFinalFailure)).toContain(
      migrationIncompleteMarker,
    );
    const retainedPublished = lstatSync(
      join(greenfieldFinalFailure, "unboundry.sqlite"),
      { bigint: true },
    );
    expect(finalPublishedIdentity).toBeDefined();
    expect({ dev: retainedPublished.dev, ino: retainedPublished.ino }).toEqual(
      finalPublishedIdentity,
    );
    const retainedCurrent = new DatabaseSync(
      join(greenfieldFinalFailure, "unboundry.sqlite"),
      { readOnly: true },
    );
    expect(databaseMatchesMigrationManifest(retainedCurrent)).toBe(true);
    expect(databaseMatchesSchemaContract(retainedCurrent)).toBe(true);
    retainedCurrent.close();
    expect(() => openAppDatabase(greenfieldFinalFailure)).toThrow(
      "Application data maintenance is incomplete",
    );

    const snapshotDatabase = openAppDatabase(currentSnapshotRace);
    snapshotDatabase.close();
    expect(await readdir(currentSnapshotRace)).toEqual(["unboundry.sqlite"]);
    let concurrentSnapshotCommit = 0;
    setDuringCurrentDatabaseOpenForTests((checkpoint, databasePath) => {
      if (checkpoint === "inspection-schema-validated") {
        const concurrent = new DatabaseSync(databasePath, { timeout: 0 });
        try {
          concurrent.prepare(`
            INSERT INTO project_metadata (
              owner_id, id, title, updated_at, is_project, created_at,
              deleted_at
            ) VALUES (
              NULL, 'm91-snapshot-race', 'snapshot race', 1, 1, 1, NULL
            )
          `).run();
          concurrentSnapshotCommit += 1;
        } finally {
          concurrent.close();
        }
      }
    });
    try {
      expect(() => openAppDatabase(currentSnapshotRace)).toThrow(
        "Application database changed while opening",
      );
    } finally {
      setDuringCurrentDatabaseOpenForTests(undefined);
    }
    expect(concurrentSnapshotCommit).toBe(1);
    const snapshotResult = new DatabaseSync(
      join(currentSnapshotRace, "unboundry.sqlite"),
      { readOnly: true },
    );
    expect(snapshotResult.prepare(`
      SELECT title FROM project_metadata WHERE id = 'm91-snapshot-race'
    `).get()).toEqual({ title: "snapshot race" });
    snapshotResult.close();

    const injectedDatabase = openAppDatabase(injectedSidecarRace);
    injectedDatabase.close();
    expect(await readdir(injectedSidecarRace)).toEqual(["unboundry.sqlite"]);
    const injectedDatabasePath = join(
      injectedSidecarRace,
      "unboundry.sqlite",
    );
    const injectedExternalPath = join(root, "injected-sidecar-external");
    await writeFile(injectedExternalPath, "injected-external", { mode: 0o600 });
    const injectedSidecarPath = `${injectedDatabasePath}-shm`;
    let injectedSidecarBefore:
      | ReturnType<typeof exactPathFingerprint>
      | undefined;
    setDuringCurrentDatabaseOpenForTests((checkpoint) => {
      if (checkpoint === "before-writer-sidecar-validation") {
        expect(() => openAppDatabase(injectedSidecarRace)).toThrow(
          "Application data maintenance is incomplete",
        );
        symlinkSync(injectedExternalPath, injectedSidecarPath);
        injectedSidecarBefore = exactPathFingerprint(injectedSidecarPath);
      }
    });
    const injectedMainBefore = exactPathFingerprint(injectedDatabasePath);
    const injectedExternalBefore = exactPathFingerprint(injectedExternalPath);
    try {
      expect(() => openAppDatabase(injectedSidecarRace)).toThrow(
        "Current database sidecar is unsafe",
      );
    } finally {
      setDuringCurrentDatabaseOpenForTests(undefined);
    }
    expect(injectedSidecarBefore).toBeDefined();
    expect(exactPathFingerprint(injectedSidecarPath)).toEqual(
      injectedSidecarBefore,
    );
    expect(exactPathFingerprint(injectedDatabasePath)).toEqual(
      injectedMainBefore,
    );
    expect(exactPathFingerprint(injectedExternalPath)).toEqual(
      injectedExternalBefore,
    );

    const sidecarCases = [
      { kind: "symlink", suffix: "-wal" },
      { kind: "hardlink", suffix: "-shm" },
      { kind: "unsafe-mode", suffix: "-journal" },
      { kind: "orphan", suffix: "-journal" },
      { kind: "orphan", suffix: "-shm" },
      { kind: "orphan", suffix: "-wal" },
    ] as const;
    await mkdir(orphanSidecars, { mode: 0o700 });
    for (const [index, sidecarCase] of sidecarCases.entries()) {
      const dataDirectory = join(orphanSidecars, String(index));
      const database = openAppDatabase(dataDirectory);
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      database.close();
      const databasePath = join(dataDirectory, "unboundry.sqlite");
      const externalPath = join(root, `sidecar-external-${index}`);
      await writeFile(externalPath, `external-${index}`, { mode: 0o600 });
      const sidecarPath = `${databasePath}${sidecarCase.suffix}`;
      if (sidecarCase.kind === "symlink") {
        await symlink(externalPath, sidecarPath);
      } else if (sidecarCase.kind === "hardlink") {
        linkSync(externalPath, sidecarPath);
      } else if (sidecarCase.kind === "unsafe-mode") {
        writeFileSync(sidecarPath, "unsafe-sidecar", { mode: 0o600 });
        chmodSync(sidecarPath, 0o666);
      } else {
        writeFileSync(sidecarPath, `orphan-${sidecarCase.suffix}`, {
          mode: 0o600,
        });
      }
      const mainBefore = exactPathFingerprint(databasePath);
      const sidecarBefore = exactPathFingerprint(sidecarPath);
      const externalBefore = exactPathFingerprint(externalPath);
      expect(() => openAppDatabase(dataDirectory)).toThrow();
      expect(exactPathFingerprint(databasePath)).toEqual(mainBefore);
      expect(exactPathFingerprint(sidecarPath)).toEqual(sidecarBefore);
      expect(exactPathFingerprint(externalPath)).toEqual(externalBefore);
    }
  } finally {
    setAfterGreenfieldDatabasePublishForTests(undefined);
    setDuringCurrentDatabaseOpenForTests(undefined);
    setDuringGreenfieldDatabaseInitializationForTests(undefined);
    await rm(root, { force: true, recursive: true });
  }
});

test("quiet gate uses 60 seconds and rechecks active and unsettled paid work", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-quiet-"));
  const activeDirectory = join(root, "active");
  const paidDirectory = join(root, "paid");
  try {
    const activePath = await createExactSchema(activeDirectory, 37);
    const active = new DatabaseSync(activePath);
    active.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt,
        created_at, updated_at
      ) VALUES (
        'm91-active', 'canvas', 'node', 'image', 'prompt', NULL,
        '{}', 'idem', 'fingerprint', 'queued', 0,
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
      )
    `).run();
    active.close();
    let activeSha = expectedLogicalSha(activePath, root);
    await expect(migrateSchema37To39({
      dataDirectory: activeDirectory,
      expectedSourceLogicalSha256: activeSha,
      mode: "dry-run",
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_ACTIVE_GENERATION_TASKS" });
    const clear = new DatabaseSync(activePath);
    clear.exec("DELETE FROM generation_tasks WHERE id = 'm91-active'");
    clear.close();
    activeSha = expectedLogicalSha(activePath, root);
    let slept = -1;
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: activeDirectory,
        expectedSourceLogicalSha256: activeSha,
        mode: "apply",
        scratchRoot: root,
        testClock: {
          drainMilliseconds: 60_000,
          sleep: async (milliseconds) => {
            slept = milliseconds;
            const second = new DatabaseSync(activePath, { timeout: 0 });
            try {
              expect(() => second.exec("BEGIN IMMEDIATE")).toThrow();
            } finally {
              second.close();
            }
          },
        },
      })).resolves.toMatchObject({ status: "complete" });
    });
    expect(slept).toBe(60_000);
    const migratedActive = new DatabaseSync(activePath, { readOnly: true });
    expect(migratedActive.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 40,
    });
    migratedActive.close();

    const paidPath = await createExactSchema(paidDirectory, 37);
    const paid = new DatabaseSync(paidPath);
    paid.exec(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        created_at, updated_at, provider_profile_id, provider_model_id
      ) VALUES (
        'm91-paid-unknown', 'canvas', 'node', 'image', 'prompt', NULL,
        '{}', 'idem', 'fingerprint', 'failed', 1, 'TIMEOUT',
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
        'provider', 'model'
      );
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at
      ) VALUES (
        'm91-paid-unknown', 1, 'provider', 'model', 'image',
        'provider-boundary', '2026-08-12T00:00:00.000Z'
      );
    `);
    paid.close();
    const paidSha = expectedLogicalSha(paidPath, root);
    await expect(migrateSchema37To39({
      dataDirectory: paidDirectory,
      expectedSourceLogicalSha256: paidSha,
      mode: "dry-run",
      scratchRoot: root,
    })).rejects.toMatchObject({
      code: "SCHEMA_MIGRATION_UNSETTLED_PROVIDER_ATTEMPTS",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("schema checkpoint failures roll back atomically and retain recovery marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-schema38-crash-"));
  const dataDirectory = join(root, "data");
  try {
    const databasePath = await createExactSchema(dataDirectory, 37);
    const expectedSha = expectedLogicalSha(databasePath, root);
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "schema-38-applied") {
            throw new Error("simulated schema-38 process loss");
          }
        },
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_SCHEMA38_APPLY",
      });
    });
    const rolledBack = new DatabaseSync(databasePath, { readOnly: true });
    expect(rolledBack.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect(databaseMatchesFrozenSchema37Contract(rolledBack)).toBe(true);
    rolledBack.close();
    expect(await readdir(dataDirectory)).toContain(migrationIncompleteMarker);

    await withSafeMigrationClock(async () => {
      const result = await migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      });
      expect(result).toMatchObject({ recovered: true, status: "complete" });
    });

    const schema40Directory = join(root, "schema40-data");
    const schema40Path = await createExactSchema(schema40Directory, 37);
    const schema40Sha = expectedLogicalSha(schema40Path, root);
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: schema40Directory,
        expectedSourceLogicalSha256: schema40Sha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "schema-40-applied") {
            throw new Error("simulated schema-40 process loss");
          }
        },
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_SCHEMA40_APPLY",
      });
    });
    const schema40RolledBack = new DatabaseSync(schema40Path, { readOnly: true });
    expect(schema40RolledBack.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect(databaseMatchesFrozenSchema37Contract(schema40RolledBack)).toBe(true);
    schema40RolledBack.close();
    expect(await readdir(schema40Directory)).toContain(migrationIncompleteMarker);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("write lock serializes migrators and blocks replacement TOCTOU", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-lock-"));
  const dataDirectory = join(root, "data");
  const replacementDirectory = join(root, "replacement");
  try {
    const databasePath = await createExactSchema(dataDirectory, 37);
    await mkdir(replacementDirectory, { mode: 0o700 });
    const replacementPath = join(replacementDirectory, "unboundry.sqlite");
    await copyFile(databasePath, replacementPath);
    await chmod(replacementPath, 0o600);
    const displacedPath = join(dataDirectory, "unboundry-displaced.sqlite");
    const dryRunDisplacedPath = join(
      dataDirectory,
      "unboundry-dry-run-displaced.sqlite",
    );
    const expectedSha = expectedLogicalSha(databasePath, root);
    expect(expectedLogicalSha(replacementPath, root)).toBe(expectedSha);
    await expect(migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSha,
      mode: "dry-run",
      onCheckpoint: (checkpoint) => {
        if (checkpoint === "source-locked") {
          renameSync(databasePath, dryRunDisplacedPath);
          renameSync(replacementPath, databasePath);
        }
      },
      scratchRoot: root,
    })).rejects.toMatchObject({
      code: "SCHEMA_MIGRATION_DATABASE_CHANGED",
    });
    expect(await readdir(dataDirectory)).not.toContain(
      migrationIncompleteMarker,
    );
    renameSync(databasePath, replacementPath);
    renameSync(dryRunDisplacedPath, databasePath);
    let releaseDrain!: () => void;
    let drainStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      drainStarted = resolveStarted;
    });
    const release = new Promise<void>((resolveRelease) => {
      releaseDrain = resolveRelease;
    });
    await withSafeMigrationClock(async () => {
      const first = migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: {
          drainMilliseconds: 0,
          sleep: async () => {
            drainStarted();
            await release;
          },
        },
      });
      await started;
      await expect(migrateSchema37To39({
        busyTimeoutMilliseconds: 0,
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_RUNTIME_LEASE_UNAVAILABLE",
      });
      await expect(migrateSchema37To39({
        busyTimeoutMilliseconds: 0,
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        runtimeDirectory: join(root, "secondary-migration-runtime"),
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_LOCK_UNAVAILABLE" });
      renameSync(databasePath, displacedPath);
      renameSync(replacementPath, databasePath);
      releaseDrain();
      await expect(first).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_DATABASE_CHANGED",
      });
    });
    expect(await readdir(dataDirectory)).toContain(migrationIncompleteMarker);
    const rolledBack = new DatabaseSync(displacedPath, { readOnly: true });
    expect(rolledBack.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect(databaseMatchesFrozenSchema37Contract(rolledBack)).toBe(true);
    rolledBack.close();
    const replacement = new DatabaseSync(databasePath, { readOnly: true });
    expect(replacement.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    replacement.close();

    renameSync(databasePath, replacementPath);
    renameSync(displacedPath, databasePath);
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).resolves.toMatchObject({ recovered: true, status: "complete" });
    });
    const current = new DatabaseSync(databasePath, { readOnly: true });
    expect(current.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 40,
    });
    current.close();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("marker, directory identity, and dangling links fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-links-"));
  const danglingDatabase = join(root, "dangling-db");
  const danglingMarker = join(root, "dangling-marker");
  const danglingRestore = join(root, "dangling-restore");
  const deletedMarker = join(root, "deleted-marker");
  const replacedDirectory = join(root, "replaced-directory");
  const replacedMarker = join(root, "replaced-marker");
  const migratorMarker = join(root, "migrator-marker");
  try {
    await mkdir(danglingDatabase, { mode: 0o700 });
    await symlink(
      join(root, "missing.sqlite"),
      join(danglingDatabase, "unboundry.sqlite"),
    );
    expect(() => openAppDatabase(danglingDatabase)).toThrow(
      "Application database must be an owned regular file",
    );

    await mkdir(danglingMarker, { mode: 0o700 });
    await symlink(
      join(root, "missing-marker"),
      join(danglingMarker, migrationIncompleteMarker),
    );
    expect(() => openAppDatabase(danglingMarker)).toThrow(
      "Application data maintenance is incomplete",
    );

    await createExactSchema(danglingRestore, 37);
    const restoreSha = expectedLogicalSha(
      join(danglingRestore, "unboundry.sqlite"),
      root,
    );
    await symlink(
      join(root, "missing-restore-marker"),
      join(danglingRestore, ".unboundry-restore-incomplete"),
    );
    await expect(migrateSchema37To39({
      dataDirectory: danglingRestore,
      expectedSourceLogicalSha256: restoreSha,
      mode: "dry-run",
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_RESTORE_INCOMPLETE" });

    const migratorPath = await createExactSchema(migratorMarker, 37);
    const migratorSha = expectedLogicalSha(migratorPath, root);
    await symlink(
      join(root, "missing-migrator-marker"),
      join(migratorMarker, migrationIncompleteMarker),
    );
    await expect(migrateSchema37To39({
      dataDirectory: migratorMarker,
      expectedSourceLogicalSha256: migratorSha,
      mode: "dry-run",
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_MARKER_INVALID" });

    const deletedMarkerPath = await createExactSchema(deletedMarker, 37);
    const deletedMarkerSha = expectedLogicalSha(deletedMarkerPath, root);
    const displacedDeletedMarker = join(root, "deleted-marker-original.json");
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: deletedMarker,
        expectedSourceLogicalSha256: deletedMarkerSha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "drain-complete") {
            renameSync(
              join(deletedMarker, migrationIncompleteMarker),
              displacedDeletedMarker,
            );
          }
        },
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_MARKER_CHANGED" });
    });
    expect(await readdir(deletedMarker)).toContain(migrationIncompleteMarker);
    expect(JSON.parse(await readFile(
      join(deletedMarker, migrationIncompleteMarker),
      "utf8",
    ))).toMatchObject({
      expectedSourceLogicalSha256: deletedMarkerSha,
      sourceVersion: 37,
      targetVersion: 40,
    });
    const deletedMarkerSource = new DatabaseSync(deletedMarkerPath, {
      readOnly: true,
    });
    expect(deletedMarkerSource.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    deletedMarkerSource.close();

    const replacedMarkerPath = await createExactSchema(replacedMarker, 37);
    const replacedMarkerSha = expectedLogicalSha(replacedMarkerPath, root);
    const displacedReplacedMarker = join(root, "replaced-marker-original.json");
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: replacedMarker,
        expectedSourceLogicalSha256: replacedMarkerSha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "drain-complete") {
            const markerPath = join(replacedMarker, migrationIncompleteMarker);
            renameSync(markerPath, displacedReplacedMarker);
            writeFileSync(markerPath, "replacement marker\n", {
              mode: 0o600,
            });
          }
        },
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_MARKER_INVALID" });
    });
    expect(await readFile(
      join(replacedMarker, migrationIncompleteMarker),
      "utf8",
    )).toBe("replacement marker\n");
    expect(() => openAppDatabase(replacedMarker)).toThrow(
      "Application data maintenance is incomplete",
    );
    const replacedMarkerSource = new DatabaseSync(replacedMarkerPath, {
      readOnly: true,
    });
    expect(replacedMarkerSource.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    replacedMarkerSource.close();

    const replacedDirectoryPath = await createExactSchema(
      replacedDirectory,
      37,
    );
    const replacedDirectorySha = expectedLogicalSha(replacedDirectoryPath, root);
    const displacedDirectory = join(root, "replaced-directory-original");
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: replacedDirectory,
        expectedSourceLogicalSha256: replacedDirectorySha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "drain-complete") {
            renameSync(replacedDirectory, displacedDirectory);
            mkdirSync(replacedDirectory, { mode: 0o700 });
            renameSync(
              join(displacedDirectory, "unboundry.sqlite"),
              join(replacedDirectory, "unboundry.sqlite"),
            );
          }
        },
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_GUARDIAN_UNSAFE" });
    });
    expect(await readdir(displacedDirectory)).toContain(
      migrationIncompleteMarker,
    );
    expect(await readdir(replacedDirectory)).not.toContain(
      migrationIncompleteMarker,
    );
    const replacedDirectorySource = new DatabaseSync(
      join(replacedDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    expect(replacedDirectorySource.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    replacedDirectorySource.close();
    expect(() => openAppDatabase(replacedDirectory)).toThrow(
      "Application database is not the exact current schema",
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("dry-run and CLI validate exact v37 plus logical SHA without source writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-dry-run-"));
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  try {
    const databasePath = await createExactSchema(dataDirectory, 37);
    const source = new DatabaseSync(databasePath, { readOnly: true });
    expect(databaseMatchesFrozenSchema37Contract(source)).toBe(true);
    source.close();
    const expectedSha = expectedLogicalSha(databasePath, root);
    const before = await sourceFingerprint(dataDirectory);

    const result = await migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSha,
      mode: "dry-run",
      scratchRoot: root,
    });
    expect(result).toMatchObject({
      drainMilliseconds: 60_000,
      mode: "dry-run",
      sourceVersion: 37,
      status: "ready",
      targetVersion: 40,
    });
    expect(await sourceFingerprint(dataDirectory)).toEqual(before);

    await expect(executeFile(process.execPath, [
      migrationScript,
      "--dry-run",
      "--data-dir",
      dataDirectory,
      "--expected-logical-sha256",
      expectedSha,
      "--scratch-root",
      root,
    ], { env: process.env, timeout: 10_000 })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("SCHEMA_MIGRATION_ARGUMENT_INVALID"),
    });
    expect(await sourceFingerprint(dataDirectory)).toEqual(before);

    const cliLeaseOwner = createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      runtimeDirectory,
    });
    let cliLeaseFailure:
      | (Error & { code?: number; stderr?: string })
      | undefined;
    try {
      await executeFile(process.execPath, [
        migrationScript,
        "--dry-run",
        "--data-dir",
        dataDirectory,
        "--expected-logical-sha256",
        expectedSha,
        "--runtime-dir",
        runtimeDirectory,
        "--scratch-root",
        root,
      ], { env: process.env, timeout: 10_000 });
    } catch (error) {
      cliLeaseFailure = error as Error & { code?: number; stderr?: string };
    } finally {
      cliLeaseOwner.close();
    }
    expect(cliLeaseFailure?.code).toBe(1);
    expect(JSON.parse(cliLeaseFailure?.stderr ?? "{}")).toMatchObject({
      code: "SCHEMA_MIGRATION_RUNTIME_LEASE_UNAVAILABLE",
      ok: false,
    });
    expect(await sourceFingerprint(dataDirectory)).toEqual(before);

    const cli = await executeFile(process.execPath, [
      migrationScript,
      "--dry-run",
      "--data-dir",
      dataDirectory,
      "--expected-logical-sha256",
      expectedSha,
      "--runtime-dir",
      runtimeDirectory,
      "--scratch-root",
      root,
    ], { env: process.env, timeout: 10_000 });
    expect(JSON.parse(cli.stdout)).toMatchObject({
      mode: "dry-run",
      ok: true,
      status: "ready",
    });
    expect(await sourceFingerprint(dataDirectory)).toEqual(before);

    await expect(migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: "0".repeat(64),
      mode: "dry-run",
      scratchRoot: root,
    })).rejects.toMatchObject({
      code: "SCHEMA_MIGRATION_SOURCE_SHA_MISMATCH",
    });
    expect(await sourceFingerprint(dataDirectory)).toEqual(before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("migration owns the runtime lease and releases it after success or failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-runtime-lease-"));
  const dataDirectory = join(root, "data");
  const runtimeDirectory = join(root, "runtime");
  const swappedDataDirectory = join(root, "swapped-data");
  const swappedRuntimeDirectory = join(root, "swapped-runtime");
  const displacedRuntimeDirectory = join(root, "swapped-runtime-displaced");
  const guardianSwapDataDirectory = join(root, "guardian-swap-data");
  const guardianSwapRuntimeDirectory = join(root, "guardian-swap-runtime");
  const closeUnknownDataDirectory = join(root, "close-unknown-data");
  const closeUnknownRuntimeDirectory = join(root, "close-unknown-runtime");
  const releaseUnknownDataDirectory = join(root, "release-unknown-data");
  const releaseUnknownRuntimeDirectory = join(root, "release-unknown-runtime");
  const unsafeDataDirectory = join(root, "unsafe-data");
  const unsafeRuntimeDirectory = join(root, "unsafe-runtime");
  try {
    const databasePath = await createExactSchema(dataDirectory, 37);
    const expectedSha = expectedLogicalSha(databasePath, root);
    const sourceBeforeConflict = await sourceFingerprint(dataDirectory);
    const activeRuntime = createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      runtimeDirectory,
    });
    try {
      await expect(migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "dry-run",
        runtimeDirectory,
        scratchRoot: root,
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_RUNTIME_LEASE_UNAVAILABLE",
      });
      expect(await sourceFingerprint(dataDirectory)).toEqual(
        sourceBeforeConflict,
      );
    } finally {
      activeRuntime.close();
    }

    const guardianBeforeConflict = await sourceFingerprint(dataDirectory);
    const occupiedGuardian = acquireLegacyChildGuardian({
      dataDirectory,
      runtimeDirectory,
    });
    try {
      await expect(migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "dry-run",
        runtimeDirectory,
        scratchRoot: root,
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_GUARDIAN_UNAVAILABLE",
      });
      expect(await sourceFingerprint(dataDirectory)).toEqual(
        guardianBeforeConflict,
      );
    } finally {
      occupiedGuardian.release();
    }

    const successfulDryRun = await migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSha,
      mode: "dry-run",
      runtimeDirectory,
      scratchRoot: root,
    });
    expect(successfulDryRun.status).toBe("ready");
    const ownerAfterSuccess = createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      runtimeDirectory,
    });
    expect(ownerAfterSuccess.snapshot().activeLeaseHeld).toBe(true);
    ownerAfterSuccess.close();

    const sourceBeforeFailure = await sourceFingerprint(dataDirectory);
    await expect(migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: "0".repeat(64),
      mode: "dry-run",
      runtimeDirectory,
      scratchRoot: root,
    })).rejects.toMatchObject({
      code: "SCHEMA_MIGRATION_SOURCE_SHA_MISMATCH",
    });
    expect(await sourceFingerprint(dataDirectory)).toEqual(sourceBeforeFailure);
    const ownerAfterFailure = createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      runtimeDirectory,
    });
    expect(ownerAfterFailure.snapshot().activeLeaseHeld).toBe(true);
    ownerAfterFailure.close();

    const swappedDatabasePath = await createExactSchema(
      swappedDataDirectory,
      37,
    );
    const swappedExpectedSha = expectedLogicalSha(swappedDatabasePath, root);
    const swappedDatabaseBefore = createHash("sha256")
      .update(await readFile(swappedDatabasePath))
      .digest("hex");
    let runtimeSwapped = false;
    await expect(migrateSchema37To39({
      dataDirectory: swappedDataDirectory,
      expectedSourceLogicalSha256: swappedExpectedSha,
      mode: "apply",
      onCheckpoint: (checkpoint) => {
        if (checkpoint !== "source-locked" || runtimeSwapped) return;
        runtimeSwapped = true;
        renameSync(swappedRuntimeDirectory, displacedRuntimeDirectory);
        mkdirSync(swappedRuntimeDirectory, { mode: 0o700 });
      },
      runtimeDirectory: swappedRuntimeDirectory,
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_GUARDIAN_UNSAFE" });
    expect(runtimeSwapped).toBe(true);
    expect(createHash("sha256")
      .update(await readFile(swappedDatabasePath))
      .digest("hex")).toBe(swappedDatabaseBefore);
    expect(expectedLogicalSha(swappedDatabasePath, root)).toBe(
      swappedExpectedSha,
    );
    const swappedSource = new DatabaseSync(swappedDatabasePath, {
      readOnly: true,
    });
    expect(swappedSource.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    swappedSource.close();

    const guardianSwapDatabasePath = await createExactSchema(
      guardianSwapDataDirectory,
      37,
    );
    const guardianSwapExpectedSha = expectedLogicalSha(
      guardianSwapDatabasePath,
      root,
    );
    const guardianSwapBefore = await sourceFingerprint(
      guardianSwapDataDirectory,
    );
    const guardianPath = join(
      guardianSwapRuntimeDirectory,
      "legacy-child-role.sqlite",
    );
    const displacedGuardianPath = `${guardianPath}.displaced`;
    let guardianSwapped = false;
    await expect(migrateSchema37To39({
      dataDirectory: guardianSwapDataDirectory,
      expectedSourceLogicalSha256: guardianSwapExpectedSha,
      mode: "apply",
      onCheckpoint: (checkpoint) => {
        if (checkpoint !== "source-locked" || guardianSwapped) return;
        guardianSwapped = true;
        renameSync(guardianPath, displacedGuardianPath);
        writeFileSync(guardianPath, "", { flag: "wx", mode: 0o600 });
      },
      runtimeDirectory: guardianSwapRuntimeDirectory,
      scratchRoot: root,
    })).rejects.toMatchObject({
      code: "SCHEMA_MIGRATION_GUARDIAN_UNSAFE",
    });
    expect(guardianSwapped).toBe(true);
    expect(await sourceFingerprint(guardianSwapDataDirectory)).toEqual(
      guardianSwapBefore,
    );
    const guardianSwapSource = new DatabaseSync(guardianSwapDatabasePath, {
      readOnly: true,
    });
    expect(guardianSwapSource.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    guardianSwapSource.close();
    let guardianSwapHandoffError: unknown;
    try {
      createRuntimeRoleCoordinator({
        dataDirectory: guardianSwapDataDirectory,
        role: "active",
        runtimeDirectory: guardianSwapRuntimeDirectory,
      });
    } catch (error) {
      guardianSwapHandoffError = error;
    }
    expect(guardianSwapHandoffError).toMatchObject({
      code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
    });

    const closeUnknownDatabasePath = await createExactSchema(
      closeUnknownDataDirectory,
      37,
    );
    const closeUnknownExpectedSha = expectedLogicalSha(
      closeUnknownDatabasePath,
      root,
    );
    const closeUnknownBefore = await sourceFingerprint(closeUnknownDataDirectory);
    const originalDatabaseClose = DatabaseSync.prototype.close;
    let closeUnknownFailure: unknown;
    try {
      DatabaseSync.prototype.close = function () {
        throw new Error("m91 injected application database close uncertainty");
      };
      await migrateSchema37To39({
        dataDirectory: closeUnknownDataDirectory,
        expectedSourceLogicalSha256: closeUnknownExpectedSha,
        mode: "dry-run",
        runtimeDirectory: closeUnknownRuntimeDirectory,
        scratchRoot: root,
      });
    } catch (error) {
      closeUnknownFailure = error;
    } finally {
      DatabaseSync.prototype.close = originalDatabaseClose;
    }
    expect(closeUnknownFailure).toMatchObject({
      code: "SCHEMA_MIGRATION_DATABASE_CLOSE_UNKNOWN",
    });
    expect(await sourceFingerprint(closeUnknownDataDirectory)).toEqual(
      closeUnknownBefore,
    );
    let closeUnknownHandoffError: unknown;
    try {
      createRuntimeRoleCoordinator({
        dataDirectory: closeUnknownDataDirectory,
        role: "active",
        runtimeDirectory: closeUnknownRuntimeDirectory,
      });
    } catch (error) {
      closeUnknownHandoffError = error;
    }
    expect(closeUnknownHandoffError).toMatchObject({
      code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
    });

    const releaseUnknownDatabasePath = await createExactSchema(
      releaseUnknownDataDirectory,
      37,
    );
    const releaseUnknownExpectedSha = expectedLogicalSha(
      releaseUnknownDatabasePath,
      root,
    );
    const releaseUnknownBefore = await sourceFingerprint(
      releaseUnknownDataDirectory,
    );
    const releaseUnknownGuardianPath = join(
      releaseUnknownRuntimeDirectory,
      "legacy-child-role.sqlite",
    );
    let guardianCloseCalls = 0;
    let releaseUnknownFailure: unknown;
    try {
      DatabaseSync.prototype.close = function () {
        const databaseList = this.prepare("PRAGMA database_list").all() as Array<{
          file?: unknown;
          name?: unknown;
        }>;
        const main = databaseList.find(({ name }) => name === "main");
        if (main?.file === releaseUnknownGuardianPath) {
          guardianCloseCalls += 1;
          throw new Error("m91 injected guardian release uncertainty");
        }
        return originalDatabaseClose.call(this);
      };
      await migrateSchema37To39({
        dataDirectory: releaseUnknownDataDirectory,
        expectedSourceLogicalSha256: releaseUnknownExpectedSha,
        mode: "dry-run",
        runtimeDirectory: releaseUnknownRuntimeDirectory,
        scratchRoot: root,
      });
    } catch (error) {
      releaseUnknownFailure = error;
    } finally {
      DatabaseSync.prototype.close = originalDatabaseClose;
    }
    expect(guardianCloseCalls).toBe(1);
    expect(releaseUnknownFailure).toMatchObject({
      code: "SCHEMA_MIGRATION_GUARDIAN_UNSAFE",
    });
    expect(await sourceFingerprint(releaseUnknownDataDirectory)).toEqual(
      releaseUnknownBefore,
    );
    let releaseUnknownHandoffError: unknown;
    try {
      createRuntimeRoleCoordinator({
        dataDirectory: releaseUnknownDataDirectory,
        role: "active",
        runtimeDirectory: releaseUnknownRuntimeDirectory,
      });
    } catch (error) {
      releaseUnknownHandoffError = error;
    }
    expect(releaseUnknownHandoffError).toMatchObject({
      code: "RUNTIME_ACTIVE_LEASE_UNAVAILABLE",
    });

    const unsafeDatabasePath = await createExactSchema(
      unsafeDataDirectory,
      37,
    );
    const unsafeExpectedSha = expectedLogicalSha(unsafeDatabasePath, root);
    const unsafeSourceBefore = await sourceFingerprint(unsafeDataDirectory);
    await mkdir(unsafeRuntimeDirectory, { mode: 0o700 });
    const unsafeLeasePath = join(unsafeRuntimeDirectory, "active-role.sqlite");
    const unsafeLease = new DatabaseSync(unsafeLeasePath);
    unsafeLease.exec("CREATE TABLE wrong_contract (id INTEGER PRIMARY KEY)");
    unsafeLease.close();
    chmodSync(unsafeLeasePath, 0o600);
    await expect(migrateSchema37To39({
      dataDirectory: unsafeDataDirectory,
      expectedSourceLogicalSha256: unsafeExpectedSha,
      mode: "dry-run",
      runtimeDirectory: unsafeRuntimeDirectory,
      scratchRoot: root,
    })).rejects.toMatchObject({
      code: "SCHEMA_MIGRATION_RUNTIME_LEASE_UNSAFE",
    });
    expect(await sourceFingerprint(unsafeDataDirectory)).toEqual(
      unsafeSourceBefore,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("apply enforces the quiet gate, strict backfill, marker recovery, and exact-v38 rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "unboundry-m91-apply-"));
  const dataDirectory = join(root, "data");
  const durationDirectory = join(root, "duration");
  const realFfprobeDirectory = join(root, "real-ffprobe");
  const ossChecksumDirectory = join(root, "oss-checksum");
  const schema38Directory = join(root, "schema38");
  const staleChecksumDirectory = join(root, "stale-checksum");
  try {
    const staleChecksumPath = await createExactSchema(
      staleChecksumDirectory,
      37,
    );
    const staleChecksumBytes = Buffer.from("m91 missing media bytes");
    const staleChecksum = new DatabaseSync(staleChecksumPath);
    staleChecksum.exec("PRAGMA foreign_keys = ON");
    staleChecksum.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm91-stale-owner', 'm91-stale-owner', 'M91 stale owner',
        'fixture-only', 'user', 'active',
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
      )
    `).run();
    staleChecksum.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'image', 'm91-stale-image', 'm91-stale-owner',
        'm91-stale-image.png', ?, '2026-08-12T00:00:00.000Z',
        '2026-08-12T00:00:00.000Z', 'local', NULL,
        'm91-stale-image.png', 'image/png', ?, 'ready', NULL, NULL,
        'not-applicable', 1, 1
      )
    `).run(
      staleChecksumBytes.length,
      createHash("sha256").update(staleChecksumBytes).digest("hex"),
    );
    staleChecksum.close();
    await mkdir(join(staleChecksumDirectory, "media"), { mode: 0o700 });
    const staleChecksumSha = expectedLogicalSha(staleChecksumPath, root);
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: staleChecksumDirectory,
        expectedSourceLogicalSha256: staleChecksumSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_MEDIA_FULL_VERIFY",
      });
    });
    expect(await readdir(staleChecksumDirectory)).toContain(
      migrationIncompleteMarker,
    );
    const staleChecksumRolledBack = new DatabaseSync(staleChecksumPath, {
      readOnly: true,
    });
    expect(staleChecksumRolledBack.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect(databaseMatchesFrozenSchema37Contract(staleChecksumRolledBack)).toBe(
      true,
    );
    staleChecksumRolledBack.close();

    const ossChecksumPath = await createExactSchema(ossChecksumDirectory, 37);
    const ossChecksum = new DatabaseSync(ossChecksumPath);
    ossChecksum.exec("PRAGMA foreign_keys = ON");
    ossChecksum.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm91-oss-owner', 'm91-oss-owner', 'M91 OSS owner',
        'fixture-only', 'user', 'active',
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
      )
    `).run();
    const insertInvalidOssChecksum = ossChecksum.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'image', ?, 'm91-oss-owner', ?, ?,
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
        'oss', 'm91-storage-profile', ?, 'image/png', ?, 'ready',
        NULL, NULL, 'not-applicable', 1, 1
      )
    `);
    insertInvalidOssChecksum.run(
      "m91-oss-null-checksum",
      "m91-oss-null-checksum.png",
      staleChecksumBytes.length,
      "fixtures/m91-oss-null-checksum.png",
      null,
    );
    insertInvalidOssChecksum.run(
      "m91-oss-invalid-checksum",
      "m91-oss-invalid-checksum.png",
      staleChecksumBytes.length,
      "fixtures/m91-oss-invalid-checksum.png",
      "not-a-sha256",
    );
    ossChecksum.close();
    const ossChecksumSha = expectedLogicalSha(ossChecksumPath, root);
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: ossChecksumDirectory,
        expectedSourceLogicalSha256: ossChecksumSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_MEDIA_BACKFILL",
      });
    });
    expect(await readdir(ossChecksumDirectory)).toContain(
      migrationIncompleteMarker,
    );
    const ossChecksumRolledBack = new DatabaseSync(ossChecksumPath, {
      readOnly: true,
    });
    expect(ossChecksumRolledBack.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect(databaseMatchesFrozenSchema37Contract(ossChecksumRolledBack)).toBe(
      true,
    );
    expect(ossChecksumRolledBack.prepare(`
      SELECT id, checksum_sha256
      FROM media_assets
      ORDER BY id
    `).all()).toEqual([
      { checksum_sha256: "not-a-sha256", id: "m91-oss-invalid-checksum" },
      { checksum_sha256: null, id: "m91-oss-null-checksum" },
    ]);
    ossChecksumRolledBack.close();

    const durationPath = await createExactSchema(durationDirectory, 37);
    const durationBytes = Buffer.from("m91 exact legacy audio duration bytes");
    const durationName = "m91-legacy-audio.bin";
    const durationMediaPath = join(durationDirectory, "media", durationName);
    const durationDisplacedPath = join(
      durationDirectory,
      "media/m91-legacy-audio-displaced.bin",
    );
    const durationReplacementPath = join(
      durationDirectory,
      "media/m91-legacy-audio-replacement.bin",
    );
    const durationDatabase = new DatabaseSync(durationPath);
    durationDatabase.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm91-duration-owner', 'm91-duration-owner', 'M91 duration owner',
        'fixture-only', 'user', 'active',
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
      )
    `).run();
    durationDatabase.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'audio', 'm91-duration-audio', 'm91-duration-owner', ?, ?,
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
        'local', NULL, ?, 'audio/mpeg', ?, 'ready', NULL, NULL, 'pending',
        NULL, NULL
      )
    `).run(
      durationName,
      durationBytes.length,
      durationName,
      createHash("sha256").update(durationBytes).digest("hex"),
    );
    const insertInvalidDuration = durationDatabase.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        ?, ?, 'm91-duration-owner', ?, ?,
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
        'local', NULL, ?, ?, ?, 'ready', NULL, NULL, ?, ?, ?
      )
    `);
    insertInvalidDuration.run(
      "audio",
      "m91-duration-failed-audio",
      "m91-duration-failed-audio.bin",
      durationBytes.length,
      "m91-duration-failed-audio.bin",
      "audio/mpeg",
      createHash("sha256").update(durationBytes).digest("hex"),
      "failed",
      null,
      null,
    );
    insertInvalidDuration.run(
      "video",
      "m91-duration-not-applicable-video",
      "m91-duration-not-applicable-video.bin",
      durationBytes.length,
      "m91-duration-not-applicable-video.bin",
      "video/mp4",
      createHash("sha256").update(durationBytes).digest("hex"),
      "not-applicable",
      1,
      1,
    );
    durationDatabase.close();
    await mkdir(join(durationDirectory, "media"), { mode: 0o700 });
    await writeFile(durationMediaPath, durationBytes, { mode: 0o600 });
    await writeFile(
      join(durationDirectory, "media/m91-duration-failed-audio.bin"),
      durationBytes,
      { mode: 0o600 },
    );
    await writeFile(
      join(durationDirectory, "media/m91-duration-not-applicable-video.bin"),
      durationBytes,
      { mode: 0o600 },
    );
    const durationReplacementBytes = Buffer.alloc(durationBytes.length, 0x79);
    await writeFile(durationReplacementPath, durationReplacementBytes, {
      mode: 0o600,
    });
    const durationExpectedSha = expectedLogicalSha(durationPath, root);
    const durationProbe = createSafeDurationProbe(root);
    let durationReplaced = false;
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: durationDirectory,
        expectedSourceLogicalSha256: durationExpectedSha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "duration-probe-complete" && !durationReplaced) {
            durationReplaced = true;
            renameSync(durationMediaPath, durationDisplacedPath);
            renameSync(durationReplacementPath, durationMediaPath);
          }
        },
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
        testDurationProbe: durationProbe,
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_MEDIA_BACKFILL",
      });
    });
    expect(await readdir(durationDirectory)).toContain(migrationIncompleteMarker);
    const durationRolledBack = new DatabaseSync(durationPath, { readOnly: true });
    expect(durationRolledBack.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect(durationRolledBack.prepare(`
      SELECT id, duration_seconds, duration_source, duration_status
      FROM media_assets
      WHERE id LIKE 'm91-duration-%'
      ORDER BY id
    `).all()).toEqual([
      {
        duration_seconds: null,
        duration_source: null,
        duration_status: "pending",
        id: "m91-duration-audio",
      },
      {
        duration_seconds: null,
        duration_source: null,
        duration_status: "failed",
        id: "m91-duration-failed-audio",
      },
      {
        duration_seconds: null,
        duration_source: null,
        duration_status: "not-applicable",
        id: "m91-duration-not-applicable-video",
      },
    ]);
    durationRolledBack.close();
    renameSync(durationMediaPath, durationReplacementPath);
    renameSync(durationDisplacedPath, durationMediaPath);
    writeFileSync(durationProbe.executable, "#!/bin/sh\nexit 1\n", {
      mode: 0o700,
    });
    chmodSync(durationProbe.executable, 0o700);
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory: durationDirectory,
        expectedSourceLogicalSha256: durationExpectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
        testDurationProbe: durationProbe,
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_MEDIA_BACKFILL_PROBE",
      });
    });
    createSafeDurationProbe(root);
    const durationRecovered = await withSafeMigrationClock(() =>
      migrateSchema37To39({
        dataDirectory: durationDirectory,
        expectedSourceLogicalSha256: durationExpectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
        testDurationProbe: durationProbe,
      })
    );
    expect(durationRecovered).toMatchObject({
      backfilledDurations: 3,
      nativeDurationProbes: 6,
      recovered: true,
      status: "complete",
      targetVersion: 40,
    });
    expect(durationRecovered.nativeDurationProbeAuditSha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    const durationCurrent = new DatabaseSync(durationPath, { readOnly: true });
    expect(durationCurrent.prepare(`
      SELECT id, duration_seconds, duration_source, duration_status
      FROM media_assets
      WHERE id LIKE 'm91-duration-%'
      ORDER BY id
    `).all()).toEqual([
      {
        duration_seconds: 7.125,
        duration_source: "server-probe",
        duration_status: "ready",
        id: "m91-duration-audio",
      },
      {
        duration_seconds: 7.125,
        duration_source: "server-probe",
        duration_status: "ready",
        id: "m91-duration-failed-audio",
      },
      {
        duration_seconds: 7.125,
        duration_source: "server-probe",
        duration_status: "ready",
        id: "m91-duration-not-applicable-video",
      },
    ]);
    durationCurrent.close();

    const invalidDurationCurrent = new DatabaseSync(durationPath);
    invalidDurationCurrent.prepare(`
      UPDATE media_assets
      SET duration_status = 'failed'
      WHERE id = 'm91-duration-failed-audio'
    `).run();
    invalidDurationCurrent.close();
    const rejectedDurationCurrent = new DatabaseSync(durationPath, {
      readOnly: true,
    });
    expect(databaseHasCompleteLegacyMediaMetadata(rejectedDurationCurrent)).toBe(
      false,
    );
    rejectedDurationCurrent.close();
    expect(() => openAppDatabase(durationDirectory)).toThrow(
      "Application database is not the exact current schema",
    );
    const restoredDurationCurrent = new DatabaseSync(durationPath);
    restoredDurationCurrent.prepare(`
      UPDATE media_assets
      SET duration_status = 'ready'
      WHERE id = 'm91-duration-failed-audio'
    `).run();
    restoredDurationCurrent.close();

    const invalidChecksumCurrent = new DatabaseSync(durationPath);
    invalidChecksumCurrent.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'image', 'm91-current-invalid-checksum', 'm91-duration-owner',
        'm91-current-invalid-checksum.png', 1,
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
        'oss', 'm91-storage-profile', 'fixtures/m91-current-invalid-checksum.png',
        'image/png', 'not-a-sha256', 'ready', NULL, NULL,
        'not-applicable', 1, 1
      )
    `).run();
    invalidChecksumCurrent.close();
    const rejectedChecksumCurrent = new DatabaseSync(durationPath, {
      readOnly: true,
    });
    expect(databaseHasCompleteLegacyMediaMetadata(rejectedChecksumCurrent)).toBe(
      false,
    );
    rejectedChecksumCurrent.close();
    expect(() => openAppDatabase(durationDirectory)).toThrow(
      "Application database is not the exact current schema",
    );
    const restoredChecksumCurrent = new DatabaseSync(durationPath);
    restoredChecksumCurrent.prepare(`
      DELETE FROM media_assets WHERE id = 'm91-current-invalid-checksum'
    `).run();
    restoredChecksumCurrent.close();
    const acceptedCurrent = openAppDatabase(durationDirectory);
    acceptedCurrent.close();

    const ffprobePath = (process.env.PATH ?? "")
      .split(":")
      .filter(Boolean)
      .map((directory) => join(directory, "ffprobe"))
      .find((candidate) => {
        try {
          accessSync(candidate, fileConstants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
    expect(
      ffprobePath,
      "the safe-runner PATH must provide the real ffprobe executable",
    ).toBeTruthy();
    const realFfprobePath = await createExactSchema(realFfprobeDirectory, 37);
    const wavBytes = createShortPcmWav();
    const wavName = "m91-real-ffprobe.wav";
    const realFfprobeDatabase = new DatabaseSync(realFfprobePath);
    realFfprobeDatabase.exec("PRAGMA foreign_keys = ON");
    realFfprobeDatabase.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm91-real-ffprobe-owner', 'm91-real-ffprobe-owner',
        'M91 real ffprobe owner', 'fixture-only', 'user', 'active',
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
      )
    `).run();
    realFfprobeDatabase.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'audio', 'm91-real-ffprobe-audio', 'm91-real-ffprobe-owner', ?, ?,
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
        'local', NULL, ?, 'audio/wav', ?, 'ready', NULL, NULL, 'pending',
        NULL, NULL
      )
    `).run(
      wavName,
      wavBytes.length,
      wavName,
      createHash("sha256").update(wavBytes).digest("hex"),
    );
    expect(databaseMatchesFrozenSchema37Contract(realFfprobeDatabase)).toBe(
      true,
    );
    realFfprobeDatabase.close();
    await mkdir(join(realFfprobeDirectory, "media"), { mode: 0o700 });
    await writeFile(join(realFfprobeDirectory, "media", wavName), wavBytes, {
      mode: 0o600,
    });
    const realFfprobeExpectedSha = expectedLogicalSha(realFfprobePath, root);
    const realFfprobeResult = await withSafeMigrationClock(() =>
      migrateSchema37To39({
        dataDirectory: realFfprobeDirectory,
        expectedSourceLogicalSha256: realFfprobeExpectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: { drainMilliseconds: 0, sleep: async () => undefined },
      })
    );
    expect(realFfprobeResult).toMatchObject({
      backfilledDurations: 1,
      nativeDurationProbes: 2,
      status: "complete",
      targetVersion: 40,
    });
    const realFfprobeCurrent = new DatabaseSync(realFfprobePath, {
      readOnly: true,
    });
    expect(realFfprobeCurrent.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 40,
    });
    const probedDuration = realFfprobeCurrent.prepare(`
      SELECT duration_seconds, duration_source, duration_status
      FROM media_assets
      WHERE kind = 'audio' AND id = 'm91-real-ffprobe-audio'
    `).get() as {
      duration_seconds: number;
      duration_source: string;
      duration_status: string;
    };
    expect(probedDuration.duration_source).toBe("server-probe");
    expect(probedDuration.duration_status).toBe("ready");
    expect(probedDuration.duration_seconds).toBeGreaterThan(0.24);
    expect(probedDuration.duration_seconds).toBeLessThan(0.26);
    realFfprobeCurrent.close();
    const realFfprobeOpened = openAppDatabase(realFfprobeDirectory);
    expect(databaseMatchesMigrationManifest(realFfprobeOpened)).toBe(true);
    expect(databaseMatchesSchemaContract(realFfprobeOpened)).toBe(true);
    realFfprobeOpened.close();

    const databasePath = await createExactSchema(dataDirectory, 37);
    const mediaBytes = Buffer.from("m91 exact legacy media");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("PRAGMA foreign_keys = ON");
    legacy.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm91-owner', 'm91-owner', 'M91 owner', 'fixture-only', 'user',
        'active', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
      )
    `).run();
    legacy.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      ) VALUES (
        'image', 'm91-image', 'm91-owner', 'm91-image.png', ?,
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
        'local', NULL, 'm91-image.png', 'image/png', NULL, 'ready',
        NULL, NULL, 'not-applicable', 1, 1
      )
    `).run(mediaBytes.length);
    legacy.close();
    await mkdir(join(dataDirectory, "media"), { mode: 0o700 });
    await writeFile(join(dataDirectory, "media/m91-image.png"), mediaBytes, {
      mode: 0o600,
    });
    const mediaPath = join(dataDirectory, "media/m91-image.png");
    const displacedMediaPath = join(
      dataDirectory,
      "media/m91-image-displaced.png",
    );
    const replacementMediaPath = join(
      dataDirectory,
      "media/m91-image-replacement.png",
    );
    const replacementMediaBytes = Buffer.alloc(mediaBytes.length, 0x78);
    await writeFile(replacementMediaPath, replacementMediaBytes, {
      mode: 0o600,
    });
    const expectedSha = expectedLogicalSha(databasePath, root);
    let mediaReplaced = false;

    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "backfill-row" && !mediaReplaced) {
            mediaReplaced = true;
            renameSync(mediaPath, displacedMediaPath);
            renameSync(replacementMediaPath, mediaPath);
          }
        },
        scratchRoot: root,
        testClock: {
          drainMilliseconds: 0,
          sleep: async () => undefined,
        },
      })).rejects.toBeInstanceOf(SchemaMigrationError);
    });
    expect(await readFile(mediaPath)).toEqual(replacementMediaBytes);
    expect(await readdir(dataDirectory)).toContain(migrationIncompleteMarker);
    const rolledBack = new DatabaseSync(databasePath, { readOnly: true });
    expect(rolledBack.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 37,
    });
    expect(databaseMatchesFrozenSchema37Contract(rolledBack)).toBe(true);
    expect(rolledBack.prepare(`
      SELECT checksum_sha256 FROM media_assets WHERE id = 'm91-image'
    `).get()).toEqual({ checksum_sha256: null });
    rolledBack.close();
    expect(() => openAppDatabase(dataDirectory)).toThrow(
      "Application data maintenance is incomplete",
    );
    await expect(migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSha,
      mode: "dry-run",
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_RECOVERY_REQUIRED" });

    renameSync(mediaPath, replacementMediaPath);
    renameSync(displacedMediaPath, mediaPath);

    let postCommitMediaReplaced = false;
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        onCheckpoint: (checkpoint) => {
          if (checkpoint === "schema-committed" && !postCommitMediaReplaced) {
            postCommitMediaReplaced = true;
            renameSync(mediaPath, displacedMediaPath);
            renameSync(replacementMediaPath, mediaPath);
          }
        },
        scratchRoot: root,
        testClock: {
          drainMilliseconds: 0,
          sleep: async () => undefined,
        },
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_POST_COMMIT_VERIFY",
      });
    });
    expect(await readdir(dataDirectory)).toContain(migrationIncompleteMarker);
    const committed = new DatabaseSync(databasePath, { readOnly: true });
    expect(committed.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 40,
    });
    expect(databaseHasCompleteLegacyMediaMetadata(committed)).toBe(true);
    committed.close();
    // The schema is already current, so an incremental backfill has no rows.
    // Recovery must nevertheless rebuild physical evidence and keep the marker
    // while the post-COMMIT replacement remains at the ready-local path.
    await withSafeMigrationClock(async () => {
      await expect(migrateSchema37To39({
        dataDirectory,
        expectedSourceLogicalSha256: expectedSha,
        mode: "apply",
        scratchRoot: root,
        testClock: {
          drainMilliseconds: 0,
          sleep: async () => undefined,
        },
      })).rejects.toMatchObject({
        code: "SCHEMA_MIGRATION_FAILED_MEDIA_FULL_VERIFY",
      });
    });
    expect(await readdir(dataDirectory)).toContain(migrationIncompleteMarker);
    renameSync(mediaPath, replacementMediaPath);
    renameSync(displacedMediaPath, mediaPath);

    const otherCurrentDirectory = join(root, "other-current");
    const otherCurrentPath = await createExactSchema(otherCurrentDirectory, 38);
    const otherCurrent = new DatabaseSync(otherCurrentPath);
    otherCurrent.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(otherCurrent, {
      sourceVersion: 38,
    });
    otherCurrent.exec("COMMIT");
    otherCurrent.close();
    const committedDisplaced = join(dataDirectory, "committed-v39.sqlite");
    renameSync(databasePath, committedDisplaced);
    renameSync(otherCurrentPath, databasePath);
    await expect(migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSha,
      mode: "apply",
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_DATABASE_CHANGED" });
    expect(await readdir(dataDirectory)).toContain(migrationIncompleteMarker);
    renameSync(databasePath, otherCurrentPath);
    renameSync(committedDisplaced, databasePath);
    await expect(migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSha,
      mode: "dry-run",
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_RECOVERY_REQUIRED" });

    const recovered = await withSafeMigrationClock(() => migrateSchema37To39({
      dataDirectory,
      expectedSourceLogicalSha256: expectedSha,
      mode: "apply",
      scratchRoot: root,
      testClock: {
        drainMilliseconds: 0,
        sleep: async () => undefined,
      },
    }));
    expect(recovered).toMatchObject({
      backfilledChecksums: 0,
      mode: "apply",
      recovered: true,
      status: "complete",
      targetVersion: 40,
    });
    expect(await readdir(dataDirectory)).not.toContain(migrationIncompleteMarker);
    const current = openAppDatabase(dataDirectory);
    expect(databaseHasCompleteLegacyMediaMetadata(current)).toBe(true);
    expect(current.prepare(`
      SELECT checksum_sha256 FROM media_assets WHERE id = 'm91-image'
    `).get()).toEqual({
      checksum_sha256: createHash("sha256").update(mediaBytes).digest("hex"),
    });
    current.close();
    expect(recovered.targetLogicalSha256).toBe(
      expectedLogicalSha(databasePath, root),
    );

    const schema38Path = await createExactSchema(schema38Directory, 38);
    const schema38Sha = expectedLogicalSha(schema38Path, root);
    const before38 = await sourceFingerprint(schema38Directory);
    await expect(migrateSchema37To39({
      dataDirectory: schema38Directory,
      expectedSourceLogicalSha256: schema38Sha,
      mode: "apply",
      scratchRoot: root,
    })).rejects.toMatchObject({ code: "SCHEMA_MIGRATION_SCHEMA38_REJECTED" });
    expect(await sourceFingerprint(schema38Directory)).toEqual(before38);
    const rejected38 = new DatabaseSync(schema38Path, { readOnly: true });
    expect(rejected38.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 38,
    });
    rejected38.close();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
