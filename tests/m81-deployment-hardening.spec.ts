import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  createServer as createHttpServer,
  IncomingMessage,
  request as openHttpRequest,
  ServerResponse,
} from "node:http";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { lstatSync, renameSync, writeFileSync } from "node:fs";
import { createConnection, createServer, Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BackupInspectionError,
  databaseMatchesFrozenSchema37Contract,
  databaseMatchesFrozenSchema38Contract,
  inspectBackupDatabase,
} from "../server/backupInspection";
import { saveAccountCredential } from "../server/accountCredentials";
import {
  applyPendingSchemaMigrationsInTransaction,
  currentSchemaManifest,
  currentSchemaVersion,
  databaseHasCompleteLegacyMediaMetadata,
  databaseMatchesSchemaContract,
  openAppDatabase,
} from "../server/database";
import {
  createGenerationTaskStore,
  GenerationTaskRetryFenceError,
} from "../server/generationTaskStore";
import { buildAuthoritativeGenerationModelConfiguration } from
  "../server/authoritativeGenerationModelConfiguration";
import { authoritativeModelConfigurationRevision } from
  "../server/modelConfigurationIdentity";
import { assertRegisteredModelExecutionTotality } from
  "../server/modelExecutionRegistry";
import { bootstrapPublishedModelContracts } from
  "../server/modelReleaseBootstrap";
import { modelContractState } from "../server/modelReleaseRevisionStore";
import {
  providerConfigurationVersion,
  saveProviderProfile,
} from "../server/providerProfiles";
import {
  coordinateRuntimeShutdown,
  createRuntimeLifecycle,
  type RuntimeLifecycle,
  type ShutdownResult,
} from "../server/runtimeLifecycle";
import { createRuntimeRoleCoordinator } from "../server/runtimeRole";
import {
  acquireLegacyChildGuardian,
  LegacyChildGuardianError,
} from "../server/legacyChildGuardian";
import { applySecurityHeaders } from "../server/securityHeaders";
import {
  bridgeRuntimeMode,
  releaseRoleFromEnvironment,
} from "../server/bridgeRuntimeMode";
import {
  createLegacyRuntimeSupervisor,
  inspectLegacyActiveGenerationTasks,
  inspectLegacyMediaMetadataComplete,
  legacyRuntimeFingerprintDifferenceForTest,
  legacyRuntimeFinalizeObservationForTest,
  legacyRuntimeObservationDifferenceForTest,
  legacyRuntimeObservationFailureForTest,
  LegacyRuntimeDatabaseChangedError,
  type LegacyActiveTaskObservationPhase,
  type LegacyMediaObservationPhase,
} from "../server/legacyRuntimeSupervisor";
import {
  createLegacyReverseProxy,
  legacyBridgeMutationBlockCode,
} from "../server/legacyReverseProxy";
import type { LegacyRuntimeLauncher } from "../server/legacyRuntimeLauncher";
import {
  LegacyBridgeRequestError,
  legacyProxyRequestHeaders,
  parseLegacyBridgeRequestTarget,
} from "../server/legacyBridgeRequest";
import { knownModelParameterSchema } from "../types/modelParameters";
import { expect, test } from "./safe-test";

const port = Number(process.env.UNBOUNDRY_TEST_AUX_PORT);
const origin = `http://127.0.0.1:${port}`;
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const capturedOutput = new WeakMap<ChildProcess, string[]>();

test("release role and bridge-mode selection are exact and fail closed", () => {
  expect(releaseRoleFromEnvironment("0.6.0", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.1", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.2", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.3", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.4", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.5", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.6", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.7", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.8", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.9", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.10", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.11", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.12", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.13", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.14", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.15", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.16", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.17", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.18", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.19", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.20", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.21", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.22", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.23", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.24", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.25", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.26", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.27", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.28", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.29", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.30", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.31", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.32", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.33", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.34", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.35", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.36", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.37", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.38", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.39", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.40", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.41", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.42", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.43", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.44", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.45", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.46", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.47", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.48", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.49", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.50", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.51", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.52", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.53", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.54", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.55", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.56", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.57", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.58", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.60", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.61", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.63", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.64", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.65", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.66", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.68", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.69", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.6.70", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.7.0", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.7.1", {})).toBe("final");
  expect(releaseRoleFromEnvironment("0.5.2", {})).toBe("bridge");
  expect(releaseRoleFromEnvironment("0.5.2", {
    UNBOUNDRY_RELEASE_ROLE: "bridge",
  }))
    .toBe("bridge");
  expect(() => releaseRoleFromEnvironment("0.5.2", {
    UNBOUNDRY_RELEASE_ROLE: "candidate",
  })).toThrow(/UNBOUNDRY_RELEASE_ROLE_INVALID/);
  expect(() => releaseRoleFromEnvironment("0.5.2", {
    UNBOUNDRY_RELEASE_ROLE: "final",
  })).toThrow(/UNBOUNDRY_RELEASE_ROLE_MISMATCH/);
  expect(() => releaseRoleFromEnvironment("0.5.1", {})).toThrow(
    /UNBOUNDRY_RELEASE_VERSION_INVALID/,
  );
  expect(bridgeRuntimeMode({
    probe: { ok: true, schemaVersion: 37, standby: true },
    releaseRole: "bridge",
    runtimeRole: "active",
  })).toBe("legacy-schema37");
  for (const fixture of [
    {
      probe: { ok: true, schemaVersion: 37, standby: true } as const,
      releaseRole: "final" as const,
      runtimeRole: "active" as const,
    },
    {
      probe: { ok: true, schemaVersion: 37, standby: true } as const,
      releaseRole: "bridge" as const,
      runtimeRole: "standby" as const,
    },
    {
      probe: { ok: true, schemaVersion: 39, standby: false } as const,
      releaseRole: "bridge" as const,
      runtimeRole: "active" as const,
    },
    {
      probe: { ok: false } as const,
      releaseRole: "bridge" as const,
      runtimeRole: "active" as const,
    },
  ]) expect(bridgeRuntimeMode(fixture)).toBe("current");
});

test("legacy supervisor labels its bounded startup observation phases", async () => {
  const child = new EventEmitter() as ChildProcess;
  let childExitCode: number | null = null;
  Object.assign(child, {
    connected: true,
    signalCode: null,
    send: (_message: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null);
      queueMicrotask(() => {
        childExitCode = 0;
        child.emit("exit", 0, null);
      });
      return true;
    },
  });
  Object.defineProperty(child, "exitCode", {
    configurable: true,
    get: () => childExitCode,
  });
  const activePhases: LegacyActiveTaskObservationPhase[] = [];
  const mediaPhases: LegacyMediaObservationPhase[] = [];
  const launcher: LegacyRuntimeLauncher = {
    launch: async () => ({
      child,
      nonce: "00000000-0000-4000-8000-000000000037",
      target: {
        host: "127.0.0.1",
        port: 37,
        proxyNonce: "37".repeat(32),
      },
      warmup: {
        expectedDatabaseMutation: "legacy-media-checksum-backfill",
        providerRequests: 0,
      },
    }),
  };
  const supervisor = createLegacyRuntimeSupervisor({
    activeGenerationTasks: (phase) => {
      activePhases.push(phase);
      return 0;
    },
    dataDirectory: "/unused-under-injected-task-probe",
    launcher,
    legacyMediaMetadataComplete: (phase) => {
      mediaPhases.push(phase);
      return true;
    },
    legacyRoot: "/unused-under-injected-launcher",
    runtimeDirectory: "/unused-under-injected-runtime",
  });
  await supervisor.start();
  expect(activePhases).toEqual([
    "ACTIVE_PRELAUNCH",
    "ACTIVE_POST_WARMUP",
  ]);
  expect(mediaPhases).toEqual(["MEDIA_POST_WARMUP"]);
  await supervisor.shutdown();
  expect(activePhases).toEqual([
    "ACTIVE_PRELAUNCH",
    "ACTIVE_POST_WARMUP",
    "ACTIVE_SHUTDOWN",
  ]);
});

test("legacy fingerprint diagnostics use a fixed component and class priority", () => {
  const fingerprint = (overrides: Record<string, bigint> = {}) => ({
    ctimeNs: 1n,
    dev: 1n,
    ino: 1n,
    mode: 0o100600n,
    mtimeNs: 1n,
    nlink: 1n,
    size: 1n,
    uid: BigInt(process.getuid?.() ?? 0),
    ...overrides,
  });
  const before = {
    database: fingerprint(),
    directory: fingerprint({ mode: 0o40700n }),
    shm: fingerprint(),
    wal: fingerprint({ size: 32n }),
  };
  expect(legacyRuntimeFingerprintDifferenceForTest(before, {
    ...before,
    database: fingerprint({ mtimeNs: 2n }),
    wal: undefined,
  })).toEqual({ changeClass: "PRESENCE", component: "WAL" });
  expect(legacyRuntimeFingerprintDifferenceForTest(before, {
    ...before,
    database: fingerprint({ ino: 2n }),
    wal: fingerprint({ mtimeNs: 2n, size: 32n }),
  })).toEqual({ changeClass: "IDENTITY", component: "DATABASE" });
  expect(legacyRuntimeFingerprintDifferenceForTest(before, {
    ...before,
    database: fingerprint({ mtimeNs: 2n }),
    shm: fingerprint({ mtimeNs: 2n }),
  })).toEqual({ changeClass: "CONTENT_METADATA", component: "DATABASE" });
  expect(legacyRuntimeFingerprintDifferenceForTest(before, {
    ...before,
    shm: fingerprint({ ctimeNs: 2n, mtimeNs: 2n, size: 2n }),
  })).toBeUndefined();
  const zeroWalBefore = {
    ...before,
    wal: fingerprint({ size: 0n }),
  };
  expect(legacyRuntimeFingerprintDifferenceForTest(zeroWalBefore, {
    ...zeroWalBefore,
    shm: fingerprint({ mtimeNs: 2n }),
  })).toEqual({ changeClass: "CONTENT_METADATA", component: "SHM" });
});

test("legacy observation diagnostics tag unsafe and missing filesystem components", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-fingerprint-map-"));
  const dataDirectory = join(testRoot, "data");
  const missingDirectory = join(testRoot, "missing-data");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const databaseMovedPath = join(dataDirectory, "unboundry.sqlite.moved");
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const journalPath = `${databasePath}-journal`;
  let writer: DatabaseSync | undefined;
  const fileFingerprint = (path: string) => {
    const details = lstatSync(path, { bigint: true });
    return {
      ctimeNs: details.ctimeNs,
      dev: details.dev,
      ino: details.ino,
      mode: details.mode,
      mtimeNs: details.mtimeNs,
      nlink: details.nlink,
      size: details.size,
      uid: details.uid,
    };
  };
  try {
    expect(() => inspectLegacyActiveGenerationTasks(missingDirectory)).toThrow(
      /^LEGACY_RUNTIME_DATABASE_UNSAFE$/,
    );
    await mkdir(dataDirectory, { mode: 0o700 });
    writer = openAppDatabase(dataDirectory);
    rollbackMigration39To38(writer);
    rollbackMigration38To37(writer);
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writer.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm81-map-owner', 'm81-map-owner', 'M81 map owner', 'fixture-only',
        'user', 'active', '2026-08-09T00:00:00.000Z',
        '2026-08-09T00:00:00.000Z'
      )
    `).run();
    expect((await stat(walPath)).size).toBeGreaterThan(0);
    const before = {
      database: fileFingerprint(databasePath),
      directory: fileFingerprint(dataDirectory),
      shm: fileFingerprint(shmPath),
      wal: fileFingerprint(walPath),
    };

    await rename(databasePath, databaseMovedPath);
    expect(legacyRuntimeObservationDifferenceForTest(dataDirectory, before))
      .toEqual({ changeClass: "PRESENCE", component: "DATABASE" });
    const primaryError = new Error("LEGACY_RUNTIME_SCHEMA_CHANGED");
    const selectedFailure = legacyRuntimeObservationFailureForTest(
      "ACTIVE_POST_WARMUP",
      dataDirectory,
      before,
      primaryError,
    );
    expect(selectedFailure).toBeInstanceOf(LegacyRuntimeDatabaseChangedError);
    expect(String((selectedFailure as Error).message)).toBe(
      "LEGACY_RUNTIME_DATABASE_CHANGED:ACTIVE_POST_WARMUP:DATABASE:PRESENCE",
    );
    expect(() => inspectLegacyActiveGenerationTasks(dataDirectory)).toThrow(
      /^LEGACY_RUNTIME_DATABASE_UNSAFE$/,
    );
    await rename(databaseMovedPath, databasePath);

    expect(legacyRuntimeObservationFailureForTest(
      "ACTIVE_POST_WARMUP",
      dataDirectory,
      {
        ...before,
        database: fileFingerprint(databasePath),
        directory: fileFingerprint(dataDirectory),
        shm: fileFingerprint(shmPath),
        wal: fileFingerprint(walPath),
      },
      primaryError,
    )).toBe(primaryError);

    const closeError = new Error("LEGACY_RUNTIME_CLOSE_FAILED");
    let closeAttempts = 0;
    expect(() => legacyRuntimeFinalizeObservationForTest({
      close: () => {
        closeAttempts += 1;
        throw closeError;
      },
      dataDirectory,
      fingerprint: {
        ...before,
        database: fileFingerprint(databasePath),
        directory: fileFingerprint(dataDirectory),
        shm: fileFingerprint(shmPath),
        wal: fileFingerprint(walPath),
      },
      phase: "ACTIVE_POST_WARMUP",
    }, primaryError)).toThrow(closeError);
    expect(closeAttempts).toBe(1);

    await rename(databasePath, databaseMovedPath);
    expect(() => legacyRuntimeFinalizeObservationForTest({
      close: () => {
        closeAttempts += 1;
        throw closeError;
      },
      dataDirectory,
      fingerprint: before,
      phase: "ACTIVE_POST_WARMUP",
    }, primaryError)).toThrow(
      /^LEGACY_RUNTIME_DATABASE_CHANGED:ACTIVE_POST_WARMUP:DATABASE:PRESENCE$/,
    );
    expect(closeAttempts).toBe(2);
    await rename(databaseMovedPath, databasePath);

    await writeFile(journalPath, "journal", { mode: 0o600 });
    expect(legacyRuntimeObservationDifferenceForTest(dataDirectory, before))
      .toEqual({ changeClass: "PRESENCE", component: "JOURNAL" });
    await rm(journalPath);

    await chmod(walPath, 0o666);
    expect(legacyRuntimeObservationDifferenceForTest(dataDirectory, before))
      .toEqual({ changeClass: "IDENTITY", component: "WAL" });
    await chmod(walPath, 0o600);

    await chmod(shmPath, 0o666);
    expect(legacyRuntimeObservationDifferenceForTest(dataDirectory, before))
      .toEqual({ changeClass: "IDENTITY", component: "SHM" });
    await chmod(shmPath, 0o600);

    await rename(databasePath, databaseMovedPath);
    await writeFile(journalPath, "journal", { mode: 0o600 });
    await chmod(walPath, 0o666);
    expect(legacyRuntimeObservationDifferenceForTest(dataDirectory, before))
      .toEqual({ changeClass: "PRESENCE", component: "DATABASE" });
  } finally {
    try {
      await chmod(walPath, 0o600);
    } catch {}
    try {
      await rename(databaseMovedPath, databasePath);
    } catch {}
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("legacy post-warmup probes admit only stable WAL timestamp noise", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-stable-wal-"));
  const dataDirectory = join(testRoot, "data");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const fileFingerprint = (path: string) => {
    const details = lstatSync(path, { bigint: true });
    return {
      ctimeNs: details.ctimeNs,
      dev: details.dev,
      ino: details.ino,
      mode: details.mode,
      mtimeNs: details.mtimeNs,
      nlink: details.nlink,
      size: details.size,
      uid: details.uid,
    };
  };
  try {
    await mkdir(dataDirectory, { mode: 0o700 });
    await writeFile(databasePath, "database-bytes", { mode: 0o600 });
    await writeFile(walPath, "stable-wal-content", { mode: 0o600 });
    await writeFile(shmPath, "stable-shm-content", { mode: 0o600 });
    const before = {
      database: fileFingerprint(databasePath),
      directory: fileFingerprint(dataDirectory),
      shm: fileFingerprint(shmPath),
      wal: fileFingerprint(walPath),
      walContentSha256: await sha256(walPath),
    };
    const changedTime = new Date("2030-01-01T00:00:00.000Z");
    await utimes(walPath, changedTime, changedTime);
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      before,
      "ACTIVE_POST_WARMUP",
    )).toBeUndefined();
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      before,
      "MEDIA_POST_WARMUP",
    )).toBeUndefined();
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      before,
      "ACTIVE_SHUTDOWN",
    )).toEqual({ changeClass: "CONTENT_METADATA", component: "WAL" });
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      before,
      "ACTIVE_SHUTDOWN",
      undefined,
      {
        admitStableWalTimestamp: true,
        stableWalDeadlineAt: Date.now() + 5_000,
      },
    )).toBeUndefined();
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      before,
      "MEDIA_STANDALONE",
    )).toEqual({ changeClass: "CONTENT_METADATA", component: "WAL" });

    await writeFile(walPath, "stable-wal-contenX", { mode: 0o600 });
    for (const phase of [
      "ACTIVE_POST_WARMUP",
      "MEDIA_POST_WARMUP",
    ] as const) {
      expect(legacyRuntimeObservationDifferenceForTest(
        dataDirectory,
        before,
        phase,
      )).toEqual({ changeClass: "CONTENT_METADATA", component: "WAL" });
    }
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      before,
      "ACTIVE_SHUTDOWN",
      undefined,
      { admitStableWalTimestamp: true },
    )).toEqual({ changeClass: "CONTENT_METADATA", component: "WAL" });
    await writeFile(walPath, "stable-wal-content-extended", { mode: 0o600 });
    for (const phase of [
      "ACTIVE_POST_WARMUP",
      "MEDIA_POST_WARMUP",
    ] as const) {
      expect(legacyRuntimeObservationDifferenceForTest(
        dataDirectory,
        before,
        phase,
      )).toEqual({ changeClass: "CONTENT_METADATA", component: "WAL" });
    }
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      before,
      "ACTIVE_SHUTDOWN",
      undefined,
      { admitStableWalTimestamp: true },
    )).toEqual({ changeClass: "CONTENT_METADATA", component: "WAL" });

    for (const [index, phase] of ([
      "ACTIVE_POST_WARMUP",
      "MEDIA_POST_WARMUP",
    ] as const).entries()) {
      await writeFile(databasePath, "database-bytes", { mode: 0o600 });
      await writeFile(walPath, "stable-wal-content", { mode: 0o600 });
      const beforeHashWindow = {
        database: fileFingerprint(databasePath),
        directory: fileFingerprint(dataDirectory),
        shm: fileFingerprint(shmPath),
        wal: fileFingerprint(walPath),
        walContentSha256: await sha256(walPath),
      };
      const hashWindowTime = new Date(
        `${2031 + index}-01-01T00:00:00.000Z`,
      );
      await utimes(walPath, hashWindowTime, hashWindowTime);
      expect(legacyRuntimeObservationDifferenceForTest(
        dataDirectory,
        beforeHashWindow,
        phase,
        () => writeFileSync(databasePath, "database-byteX"),
      )).toEqual({ changeClass: "CONTENT_METADATA", component: "DATABASE" });
    }
    await writeFile(databasePath, "database-bytes", { mode: 0o600 });
    await writeFile(walPath, "stable-wal-content", { mode: 0o600 });
    const beforeShutdownHashWindow = {
      database: fileFingerprint(databasePath),
      directory: fileFingerprint(dataDirectory),
      shm: fileFingerprint(shmPath),
      wal: fileFingerprint(walPath),
      walContentSha256: await sha256(walPath),
    };
    await utimes(
      walPath,
      new Date("2033-01-01T00:00:00.000Z"),
      new Date("2033-01-01T00:00:00.000Z"),
    );
    expect(legacyRuntimeObservationDifferenceForTest(
      dataDirectory,
      beforeShutdownHashWindow,
      "ACTIVE_SHUTDOWN",
      () => writeFileSync(databasePath, "database-byteX"),
      { admitStableWalTimestamp: true },
    )).toEqual({ changeClass: "CONTENT_METADATA", component: "DATABASE" });
  } finally {
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("legacy child guardian excludes overlap and rejects a forged contract", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-guardian-"));
  const dataDirectory = join(testRoot, "data");
  const runtimeDirectory = join(testRoot, "runtime");
  const forgedRuntimeDirectory = join(testRoot, "forged-runtime");
  await mkdir(dataDirectory, { mode: 0o700 });
  await mkdir(runtimeDirectory, { mode: 0o700 });
  await mkdir(forgedRuntimeDirectory, { mode: 0o700 });
  let first: ReturnType<typeof acquireLegacyChildGuardian> | undefined;
  let replacement: ReturnType<typeof acquireLegacyChildGuardian> | undefined;
  let orphanParent: ChildProcess | undefined;
  let orphanPid: number | undefined;
  try {
    first = acquireLegacyChildGuardian({ dataDirectory, runtimeDirectory });
    expect(() => acquireLegacyChildGuardian({ dataDirectory, runtimeDirectory }))
      .toThrow(LegacyChildGuardianError);
    first.assertHeld();
    first.release();
    first = undefined;
    replacement = acquireLegacyChildGuardian({ dataDirectory, runtimeDirectory });
    replacement.assertHeld();
    replacement.release();
    replacement = undefined;

    const guardianModule = pathToFileURL(
      join(process.cwd(), "server/legacyChildGuardian.ts"),
    ).href;
    const guardianWorkerSource = `
      import { acquireLegacyChildGuardian } from ${JSON.stringify(guardianModule)};
      const guardian = acquireLegacyChildGuardian({
        dataDirectory: process.env.UNBOUNDRY_GUARDIAN_DATA,
        runtimeDirectory: process.env.UNBOUNDRY_GUARDIAN_RUNTIME,
      });
      guardian.assertHeld();
      process.send?.({ type: "guardian-held", pid: process.pid });
      setInterval(() => guardian.assertHeld(), 50);
    `;
    const guardianParentSource = `
      import { spawn } from "node:child_process";
      const child = spawn(process.execPath, [
        "--no-warnings",
        "--experimental-strip-types",
        "--input-type=module",
        "--eval",
        process.env.UNBOUNDRY_GUARDIAN_WORKER_SOURCE,
      ], {
        env: process.env,
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      child.on("message", (message) => process.send?.(message));
      child.on("error", (error) => {
        process.send?.({ type: "guardian-child-error", message: error.message });
      });
      setInterval(() => {}, 1_000);
    `;
    orphanParent = spawn(process.execPath, [
      "--input-type=module",
      "--eval",
      guardianParentSource,
    ], {
      env: {
        ...process.env,
        UNBOUNDRY_GUARDIAN_DATA: dataDirectory,
        UNBOUNDRY_GUARDIAN_RUNTIME: runtimeDirectory,
        UNBOUNDRY_GUARDIAN_WORKER_SOURCE: guardianWorkerSource,
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    orphanPid = await withTimeout(
      new Promise<number>((resolve, reject) => {
        orphanParent!.on("message", (message: unknown) => {
          if (
            message && typeof message === "object" &&
            "type" in message && message.type === "guardian-held" &&
            "pid" in message && typeof message.pid === "number"
          ) resolve(message.pid);
          if (
            message && typeof message === "object" &&
            "type" in message && message.type === "guardian-child-error"
          ) reject(new Error(JSON.stringify(message)));
        });
        orphanParent!.once("error", reject);
        orphanParent!.once("exit", (code, signal) => {
          reject(new Error(`guardian parent exited early: ${code}/${signal}`));
        });
      }),
      5_000,
      "guardian child did not acquire its lease",
    );
    expect(() => acquireLegacyChildGuardian({ dataDirectory, runtimeDirectory }))
      .toThrow(/LEGACY_CHILD_GUARDIAN_UNAVAILABLE/);
    expect(orphanParent.kill("SIGKILL")).toBe(true);
    await waitForChildExit(
      orphanParent,
      5_000,
      "guardian parent did not exit after SIGKILL",
    );
    expect(() => process.kill(orphanPid!, 0)).not.toThrow();
    expect(() => acquireLegacyChildGuardian({ dataDirectory, runtimeDirectory }))
      .toThrow(/LEGACY_CHILD_GUARDIAN_UNAVAILABLE/);
    process.kill(orphanPid, "SIGKILL");
    await waitForPidExit(orphanPid, 5_000);
    orphanPid = undefined;
    replacement = acquireLegacyChildGuardian({ dataDirectory, runtimeDirectory });
    replacement.assertHeld();
    replacement.release();
    replacement = undefined;

    const forgedPath = join(
      forgedRuntimeDirectory,
      "legacy-child-role.sqlite",
    );
    const forged = new DatabaseSync(forgedPath);
    forged.exec(`
      CREATE TABLE legacy_child_guardian_contract (
        id INTEGER PRIMARY KEY,
        format TEXT NOT NULL,
        version INTEGER NOT NULL,
        extra TEXT
      );
      INSERT INTO legacy_child_guardian_contract (id, format, version)
      VALUES (1, 'unboundry-legacy-child-guardian', 1);
    `);
    forged.close();
    await chmod(forgedPath, 0o600);
    const before = await readFile(forgedPath);
    expect(() => acquireLegacyChildGuardian({
      dataDirectory,
      runtimeDirectory: forgedRuntimeDirectory,
    })).toThrow(/LEGACY_CHILD_GUARDIAN_UNSAFE/);
    expect(await readFile(forgedPath)).toEqual(before);
  } finally {
    try {
      first?.release();
    } catch {}
    try {
      replacement?.release();
    } catch {}
    if (orphanParent && !childExited(orphanParent)) {
      orphanParent.kill("SIGKILL");
      await waitForChildExit(
        orphanParent,
        5_000,
        "guardian parent cleanup did not complete",
      ).catch(() => undefined);
    }
    if (orphanPid !== undefined) {
      try {
        process.kill(orphanPid, "SIGKILL");
      } catch {}
      await waitForPidExit(orphanPid, 5_000).catch(() => undefined);
    }
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("legacy bridge target and proxy identity have one canonical interpretation", () => {
  expect(parseLegacyBridgeRequestTarget("/")).toEqual({
    canonicalOriginForm: "/",
    decodedPath: "/",
    lowerPath: "/",
  });
  expect(parseLegacyBridgeRequestTarget(
    "/API/Canvas/%E4%B8%AD%E6%96%87?q=%E4%B8%AD",
  )).toEqual({
    canonicalOriginForm: "/API/Canvas/%E4%B8%AD%E6%96%87?q=%E4%B8%AD",
    decodedPath: "/API/Canvas/中文",
    lowerPath: "/api/canvas/中文",
  });
  for (const target of [
    "http://canvas.mymy.ltd/api/version",
    "//canvas.mymy.ltd/api/version",
    "/api/version#fragment",
    "/api\\version",
    "/api//version",
    "/api/version/",
    "/api/./version",
    "/api/%2e%2e/version",
    "/api%2fversion",
    "/api%5cversion",
    "/api/%76ersion",
    "/api/%25version",
    "/api/%0aversion",
    "/api/%zzversion",
  ]) {
    expect(() => parseLegacyBridgeRequestTarget(target), target).toThrow(
      LegacyBridgeRequestError,
    );
  }

  const previousSafeTest = process.env.UNBOUNDRY_SAFE_TEST;
  const previousTestPort = process.env.UNBOUNDRY_TEST_PORT;
  const previousTrustProxy = process.env.UNBOUNDRY_TRUST_PROXY;
  process.env.UNBOUNDRY_SAFE_TEST = "1";
  process.env.UNBOUNDRY_TEST_PORT = "48181";
  process.env.UNBOUNDRY_TRUST_PROXY = "1";
  try {
    const request = new IncomingMessage(new Socket());
    Object.defineProperty(request.socket, "remoteAddress", {
      configurable: true,
      value: "127.0.0.1",
    });
    request.headers = {
      host: "127.0.0.1:48181",
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-proto": "https",
    };
    request.rawHeaders = [
      "Host", "127.0.0.1:48181",
      "X-Forwarded-For", "203.0.113.9",
      "X-Forwarded-Proto", "https",
    ];
    expect(legacyProxyRequestHeaders(request, {
      host: "127.0.0.1",
      port: 48182,
      proxyNonce: "81".repeat(32),
    }).headers).toMatchObject({
      host: "127.0.0.1:48181",
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-host": "127.0.0.1:48181",
      "x-forwarded-port": "48181",
      "x-forwarded-proto": "https",
      "x-real-ip": "203.0.113.9",
      "x-unboundry-legacy-proxy": "81".repeat(32),
    });
    request.rawHeaders.push("X-Forwarded-For", "198.51.100.4");
    expect(() => legacyProxyRequestHeaders(request, {
      host: "127.0.0.1",
      port: 48182,
      proxyNonce: "81".repeat(32),
    })).toThrow(/BRIDGE_PROXY_HEADERS_INVALID/);
    request.rawHeaders = ["Host", "attacker.invalid:48181"];
    request.headers = { host: "attacker.invalid:48181" };
    expect(() => legacyProxyRequestHeaders(request, {
      host: "127.0.0.1",
      port: 48182,
      proxyNonce: "81".repeat(32),
    })).toThrow(/safe-test Host is not runner-attested/);
  } finally {
    if (previousSafeTest === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
    else process.env.UNBOUNDRY_SAFE_TEST = previousSafeTest;
    if (previousTestPort === undefined) delete process.env.UNBOUNDRY_TEST_PORT;
    else process.env.UNBOUNDRY_TEST_PORT = previousTestPort;
    if (previousTrustProxy === undefined) delete process.env.UNBOUNDRY_TRUST_PROXY;
    else process.env.UNBOUNDRY_TRUST_PROXY = previousTrustProxy;
  }
});

test("legacy bridge classifies every exact-old top-level mount by method", () => {
  const fixture = (method: string, url: string) => ({ method, url } as IncomingMessage);
  const localMatrix = [
    ["GET", "/api/auth/status"],
    ["POST", "/api/auth/login"],
    ["GET", "/api/account-context"],
    ["PUT", "/api/account-credentials/00000000-0000-4000-8000-000000000001"],
    ["GET", "/api/models"],
    ["PATCH", "/api/admin/models/model-id"],
    ["POST", "/api/templates"],
    ["PATCH", "/api/admin/templates/00000000-0000-4000-8000-000000000001"],
    ["GET", "/api/agent-config"],
    ["GET", "/api/characters"],
    ["GET", "/api/library"],
    ["PATCH", "/api/admin/providers/00000000-0000-4000-8000-000000000001"],
    ["POST", "/api/admin/provider-catalog/00000000-0000-4000-8000-000000000001/import"],
    ["PATCH", "/api/admin/storage/profiles/00000000-0000-4000-8000-000000000001"],
    ["PUT", "/api/canvas/project"],
    ["POST", "/api/history/account"],
    ["PUT", "/api/project-title/project"],
    ["POST", "/api/projects/project/clone"],
    ["GET", "/api/assets/asset"],
    ["HEAD", "/api/video-assets/video"],
    ["GET", "/api/media-metadata/image/asset"],
    ["GET", "/api/openapi.json"],
  ] as const;
  for (const [method, path] of localMatrix) {
    expect(legacyBridgeMutationBlockCode(fixture(method, path)), `${method} ${path}`)
      .toBeUndefined();
  }
  const blockedMatrix = [
    ["GET", "/api/generation-tasks"],
    ["GET", "/API/generation-tasks.json"],
    ["POST", "/api/playlist/export"],
    ["POST", "/api/playlist/thumbnails/item"],
    ["POST", "/api/assets/asset"],
    ["DELETE", "/api/admin/users/user"],
    ["POST", "/api/admin/providers/profile/test"],
    ["GET", "/api/admin/provider-catalog/profile/readonly/balance"],
    ["POST", "/api/admin/storage/profiles/profile/test"],
    ["PUT", "/api/admin/generation-safety"],
    ["DELETE", "/api/projects/project"],
    ["GET", "/api"],
    ["GET", "/API.foo"],
    ["GET", "/api/unknown-mount"],
    ["POST", "/api/unknown-mount"],
  ] as const;
  for (const [method, path] of blockedMatrix) {
    expect(legacyBridgeMutationBlockCode(fixture(method, path)), `${method} ${path}`)
      .toMatch(/^BRIDGE_LEGACY_/);
  }
});

test("legacy supervisor proxies streams once, blocks costly mutation, fails closed, and drains", async () => {
  let unsafeLaunches = 0;
  const unsafeSupervisor = createLegacyRuntimeSupervisor({
    activeGenerationTasks: () => 1,
    dataDirectory: "/unused-under-injected-task-probe",
    launcher: {
      launch: async () => {
        unsafeLaunches += 1;
        throw new Error("must not launch");
      },
    },
    legacyRoot: "/unused-under-injected-launcher",
    runtimeDirectory: "/unused-under-injected-runtime",
  });
  await expect(unsafeSupervisor.start()).rejects.toThrow(
    /LEGACY_RUNTIME_ACTIVE_TASKS_PRESENT/,
  );
  expect(unsafeLaunches).toBe(0);
  let upstreamRequests = 0;
  const upstream = createHttpServer((request, response) => {
    upstreamRequests += 1;
    expect(request.headers).toMatchObject({
      host: `127.0.0.1:${process.env.UNBOUNDRY_TEST_PORT}`,
      "x-forwarded-for": "127.0.0.1",
      "x-forwarded-proto": "http",
      "x-unboundry-legacy-proxy": "81".repeat(32),
    });
    if (request.url === "/version") {
      response.setHeader("Content-Type", "application/json");
      response.end('{"version":"0.5.2"}');
      return;
    }
    if (request.url === "/range") {
      response.statusCode = 206;
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Range", "bytes 1-3/5");
      response.end("bcd");
      return;
    }
    response.statusCode = 200;
    request.pipe(response);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("upstream unavailable");
  const child = new EventEmitter() as ChildProcess;
  let fakeExitCode: number | null = null;
  Object.assign(child, {
    signalCode: null,
    connected: true,
    kill: () => true,
    send: (_message: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null);
      queueMicrotask(() => {
        fakeExitCode = 0;
        child.emit("exit", 0, null);
      });
      return true;
    },
  });
  Object.defineProperty(child, "exitCode", {
    configurable: true,
    get: () => fakeExitCode,
  });
  const launcher: LegacyRuntimeLauncher = {
    launch: async () => ({
      child,
      nonce: "00000000-0000-4000-8000-000000000081",
      target: {
        host: "127.0.0.1",
        port: address.port,
        proxyNonce: "81".repeat(32),
      },
      warmup: {
        expectedDatabaseMutation: "legacy-media-checksum-backfill",
        providerRequests: 0,
      },
    }),
  };
  let activeTasks = 0;
  const supervisor = createLegacyRuntimeSupervisor({
    activeGenerationTasks: () => activeTasks,
    dataDirectory: "/unused-under-injected-task-probe",
    launcher,
    legacyRoot: "/unused-under-injected-launcher",
    legacyMediaMetadataComplete: () => true,
    runtimeDirectory: "/unused-under-injected-runtime",
    shutdownDeadlineMs: 2_000,
  });
  await supervisor.start();
  expect(supervisor.isReady()).toBe(true);
  const lifecycle = createRuntimeLifecycle();
  const proxy = createLegacyReverseProxy({ lifecycle, supervisor });
  const frontend = createHttpServer((request, response) =>
    proxy.middleware(request, response));
  await new Promise<void>((resolve) => frontend.listen(0, "127.0.0.1", resolve));
  const frontendAddress = frontend.address();
  if (!frontendAddress || typeof frontendAddress === "string") {
    throw new Error("frontend unavailable");
  }
  const bridgeOrigin = `http://127.0.0.1:${frontendAddress.port}`;
  const previousSafeTest = process.env.UNBOUNDRY_SAFE_TEST;
  const previousTestPort = process.env.UNBOUNDRY_TEST_PORT;
  const previousTrustProxy = process.env.UNBOUNDRY_TRUST_PROXY;
  process.env.UNBOUNDRY_SAFE_TEST = "1";
  process.env.UNBOUNDRY_TEST_PORT = String(frontendAddress.port);
  process.env.UNBOUNDRY_TRUST_PROXY = "1";
  try {
    const rawBridge = (requestText: string) => new Promise<string>(
      (resolve, reject) => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: frontendAddress.port,
        }, () => socket.end(requestText));
        let response = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => { response += chunk; });
        socket.on("end", () => resolve(response));
        socket.on("error", reject);
      },
    );
    expect(await (await fetch(`${bridgeOrigin}/version`)).json()).toEqual({
      version: "0.5.2",
    });
    const ranged = await fetch(`${bridgeOrigin}/range`, {
      headers: { Range: "bytes=1-3" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(await ranged.text()).toBe("bcd");
    const streamedLocalWrite = await fetch(`${bridgeOrigin}/api/auth/login`, {
      body: "abc",
      headers: { "Content-Type": "text/plain" },
      method: "POST",
    });
    expect(streamedLocalWrite.status).toBe(200);
    expect(await streamedLocalWrite.text()).toBe("abc");
    const requestsBeforeBlockedMutation = upstreamRequests;
    const blockedGeneration = await fetch(`${bridgeOrigin}/api/generation-tasks`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(blockedGeneration.status).toBe(503);
    expect(blockedGeneration.headers.get("retry-after")).toBe("5");
    expect(await blockedGeneration.json()).toMatchObject({
      code: "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const blockedGenerationRead = await fetch(
      `${bridgeOrigin}/api/generation-tasks?canvasId=legacy`,
    );
    expect(blockedGenerationRead.status).toBe(503);
    expect(await blockedGenerationRead.json()).toMatchObject({
      code: "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    for (const path of [
      "/API/generation-tasks",
      "/api/generation-tasks.json",
    ]) {
      const blockedAlias = await fetch(`${bridgeOrigin}${path}`);
      expect(blockedAlias.status).toBe(503);
      expect(await blockedAlias.json()).toMatchObject({
        code: "BRIDGE_LEGACY_GENERATION_MUTATION_DISABLED",
      });
      expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    }
    for (const path of ["/api", "/API.foo"]) {
      const blockedUnknownApiMount = await fetch(`${bridgeOrigin}${path}`);
      expect(blockedUnknownApiMount.status).toBe(503);
      expect(await blockedUnknownApiMount.json()).toMatchObject({
        code: "BRIDGE_LEGACY_ROUTE_METHOD_DISABLED",
      });
      expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    }
    const invalidEncodedDelimiter = await fetch(
      `${bridgeOrigin}/api%2Fgeneration-tasks`,
    );
    expect(invalidEncodedDelimiter.status).toBe(400);
    expect(await invalidEncodedDelimiter.json()).toMatchObject({
      code: "BRIDGE_REQUEST_TARGET_INVALID",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const blockedMedia = await fetch(`${bridgeOrigin}/api/video-assets/item`, {
      method: "DELETE",
    });
    expect(blockedMedia.status).toBe(503);
    expect(await blockedMedia.json()).toMatchObject({
      code: "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const blockedPlaylistPublication = await fetch(
      `${bridgeOrigin}/api/playlist/export`,
      {
        body: JSON.stringify({ mode: "asset" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(blockedPlaylistPublication.status).toBe(503);
    expect(await blockedPlaylistPublication.json()).toMatchObject({
      code: "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const blockedExternal = await fetch(
      `${bridgeOrigin}/api/admin/provider-catalog/profile/readonly/balance`,
    );
    expect(blockedExternal.status).toBe(503);
    expect(await blockedExternal.json()).toMatchObject({
      code: "BRIDGE_LEGACY_EXTERNAL_REQUEST_DISABLED",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const blockedAdminDeletion = await fetch(
      `${bridgeOrigin}/api/admin/users/ordinary-user`,
      { method: "DELETE" },
    );
    expect(blockedAdminDeletion.status).toBe(503);
    expect(await blockedAdminDeletion.json()).toMatchObject({
      code: "BRIDGE_LEGACY_ACCOUNT_DELETION_DISABLED",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const blockedThumbnail = await fetch(
      `${bridgeOrigin}/api/playlist/thumbnails/m81`,
      {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(blockedThumbnail.status).toBe(503);
    expect(await blockedThumbnail.json()).toMatchObject({
      code: "BRIDGE_LEGACY_MEDIA_MUTATION_DISABLED",
    });
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const absoluteForm = await rawBridge([
      `GET http://127.0.0.1:${frontendAddress.port}/range HTTP/1.1`,
      `Host: 127.0.0.1:${frontendAddress.port}`,
      "Connection: close",
      "",
      "",
    ].join("\r\n"));
    expect(absoluteForm).toContain(" 400 ");
    expect(absoluteForm).toContain("BRIDGE_REQUEST_TARGET_INVALID");
    const duplicateForwarding = await rawBridge([
      "GET /range HTTP/1.1",
      `Host: 127.0.0.1:${frontendAddress.port}`,
      "X-Forwarded-For: 203.0.113.8",
      "X-Forwarded-For: 198.51.100.9",
      "Connection: close",
      "",
      "",
    ].join("\r\n"));
    expect(duplicateForwarding).toContain(" 400 ");
    expect(duplicateForwarding).toContain("BRIDGE_PROXY_HEADERS_INVALID");
    const nominatedForwarding = await rawBridge([
      "GET /range HTTP/1.1",
      `Host: 127.0.0.1:${frontendAddress.port}`,
      "X-Forwarded-For: 203.0.113.8",
      "Connection: x-forwarded-for, close",
      "",
      "",
    ].join("\r\n"));
    expect(nominatedForwarding).toContain(" 400 ");
    expect(nominatedForwarding).toContain("BRIDGE_PROXY_HEADERS_INVALID");
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation);
    const forgedInternalHeader = await fetch(`${bridgeOrigin}/range`, {
      headers: { "X-Unboundry-Legacy-Proxy": "attacker" },
    });
    expect(forgedInternalHeader.status).toBe(206);
    expect(upstreamRequests).toBe(requestsBeforeBlockedMutation + 1);
    fakeExitCode = 1;
    child.emit("exit", 1, null);
    expect(supervisor.state()).toBe("failed");
    const failed = await fetch(`${bridgeOrigin}/after-child-crash`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      code: "SERVICE_LEGACY_RUNTIME_UNAVAILABLE",
    });
    await supervisor.shutdown();
    expect(supervisor.state()).toBe("stopped");
    const drainChild = new EventEmitter() as ChildProcess;
    let drainExitCode: number | null = null;
    Object.assign(drainChild, {
      signalCode: null,
      send: (_message: unknown, callback?: (error: Error | null) => void) => {
        callback?.(null);
        queueMicrotask(() => {
          drainExitCode = 0;
          drainChild.emit("exit", 0, null);
        });
        return true;
      },
    });
    Object.defineProperty(drainChild, "exitCode", {
      configurable: true,
      get: () => drainExitCode,
    });
    const shutdownInspections: Array<unknown> = [];
    const drainSupervisor = createLegacyRuntimeSupervisor({
      activeGenerationTasks: (phase, inspection) => {
        if (phase === "ACTIVE_SHUTDOWN") {
          shutdownInspections.push(inspection);
        }
        return activeTasks;
      },
      dataDirectory: "/unused-under-injected-task-probe",
      launcher: {
        launch: async () => ({
          child: drainChild,
          nonce: "00000000-0000-4000-8000-000000000182",
          target: {
            host: "127.0.0.1",
            port: address.port,
            proxyNonce: "82".repeat(32),
          },
          warmup: {
            expectedDatabaseMutation: "legacy-media-checksum-backfill",
            providerRequests: 0,
          },
        }),
      },
      legacyRoot: "/unused-under-injected-launcher",
      legacyMediaMetadataComplete: () => true,
      runtimeDirectory: "/unused-under-injected-runtime",
      shutdownDeadlineMs: 2_000,
    });
    await drainSupervisor.start();
    activeTasks = 1;
    const stopping = drainSupervisor.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(drainSupervisor.state()).toBe("stopping");
    activeTasks = 0;
    await stopping;
    expect(drainSupervisor.state()).toBe("stopped");
    expect(shutdownInspections).toHaveLength(2);
    expect(shutdownInspections[0]).toMatchObject({
      settleStableWalTimestamp: true,
    });
    expect(Number(
      (shutdownInspections[0] as { stableWalDeadlineAt?: number })
        .stableWalDeadlineAt,
    )).toBeGreaterThan(Date.now() - 2_000);
    expect(shutdownInspections[1]).toBeUndefined();

    const strictChild = new EventEmitter() as ChildProcess;
    let strictShutdownMessages = 0;
    Object.assign(strictChild, {
      signalCode: null,
      send: () => {
        strictShutdownMessages += 1;
        return true;
      },
    });
    Object.defineProperty(strictChild, "exitCode", {
      configurable: true,
      get: () => null,
    });
    const strictInspections: Array<unknown> = [];
    let strictShutdownCalls = 0;
    const strictSupervisor = createLegacyRuntimeSupervisor({
      activeGenerationTasks: (phase, inspection) => {
        if (phase !== "ACTIVE_SHUTDOWN") return 0;
        strictInspections.push(inspection);
        strictShutdownCalls += 1;
        if (strictShutdownCalls === 1) return 1;
        throw new LegacyRuntimeDatabaseChangedError("ACTIVE_SHUTDOWN", {
          changeClass: "CONTENT_METADATA",
          component: "WAL",
        });
      },
      dataDirectory: "/unused-under-injected-task-probe",
      launcher: {
        launch: async () => ({
          child: strictChild,
          nonce: "00000000-0000-4000-8000-000000000183",
          target: {
            host: "127.0.0.1",
            port: address.port,
            proxyNonce: "83".repeat(32),
          },
          warmup: {
            expectedDatabaseMutation: "legacy-media-checksum-backfill",
            providerRequests: 0,
          },
        }),
      },
      legacyRoot: "/unused-under-injected-launcher",
      legacyMediaMetadataComplete: () => true,
      runtimeDirectory: "/unused-under-injected-runtime",
      shutdownDeadlineMs: 2_000,
    });
    await strictSupervisor.start();
    await expect(strictSupervisor.shutdown()).rejects.toThrow(
      /^LEGACY_RUNTIME_DATABASE_CHANGED:ACTIVE_SHUTDOWN:WAL:CONTENT_METADATA$/,
    );
    expect(strictSupervisor.state()).toBe("failed");
    expect(strictShutdownMessages).toBe(0);
    expect(strictInspections).toHaveLength(2);
    expect(strictInspections[0]).toMatchObject({
      settleStableWalTimestamp: true,
    });
    expect(strictInspections[1]).toBeUndefined();
    strictChild.emit("exit", 1, null);
  } finally {
    if (previousSafeTest === undefined) delete process.env.UNBOUNDRY_SAFE_TEST;
    else process.env.UNBOUNDRY_SAFE_TEST = previousSafeTest;
    if (previousTestPort === undefined) delete process.env.UNBOUNDRY_TEST_PORT;
    else process.env.UNBOUNDRY_TEST_PORT = previousTestPort;
    if (previousTrustProxy === undefined) delete process.env.UNBOUNDRY_TRUST_PROXY;
    else process.env.UNBOUNDRY_TRUST_PROXY = previousTrustProxy;
    await new Promise<void>((resolve) => frontend.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

function childExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForChildExit(
  child: ChildProcess,
  milliseconds: number,
  message: string,
) {
  if (childExited(child)) return Promise.resolve();
  return withTimeout(
    new Promise<void>((resolve) => {
      const finish = () => resolve();
      child.once("exit", finish);
      if (childExited(child)) {
        child.removeListener("exit", finish);
        resolve();
      }
    }),
    milliseconds,
    message,
  );
}

async function waitForPidExit(pid: number, milliseconds: number) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (
        error && typeof error === "object" && "code" in error &&
        error.code === "ESRCH"
      ) return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`guardian child ${pid} did not exit`);
}

async function startServer(
  dataDirectory: string,
  options: {
    captureOutput?: boolean;
    environment?: NodeJS.ProcessEnv;
    preview?: boolean;
    waitPath?: string;
  } = {},
) {
  const child = spawn(
    process.execPath,
    [
      vite,
      ...(options.preview ? ["preview"] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_TEST_AUTH_BYPASS: undefined,
        UNBOUNDRY_TRUST_PROXY: "1",
        // Production preview must not see the safe-runner environment, while
        // dev fixtures deliberately exercise guarded test-only hooks. The
        // preload captures the allowed loopback ports before scrubbing them.
        UNBOUNDRY_OFFLINE_GUARD_SCRUB_TEST_ENV: options.preview
          ? "1"
          : undefined,
        ...options.environment,
      },
      stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
    },
  );
  if (options.captureOutput) {
    const output: string[] = [];
    capturedOutput.set(child, output);
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childExited(child)) break;
    try {
      if ((await fetch(`${origin}${options.waitPath ?? "/api/health/live"}`, {
        signal: AbortSignal.timeout(500),
      })).ok) {
        return child;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopServer(child);
  throw new Error(
    `M81 deployment hardening server did not start\n${
      capturedOutput.get(child)?.join("") ?? ""
    }`,
  );
}

async function stopServer(child: ChildProcess) {
  if (childExited(child)) return;
  const gracefulExit = waitForChildExit(
    child,
    5_000,
    "server did not stop after SIGTERM",
  );
  child.kill("SIGTERM");
  try {
    await gracefulExit;
  } catch {
    if (childExited(child)) return;
    const forcedExit = waitForChildExit(
      child,
      5_000,
      "server did not stop after SIGKILL",
    );
    child.kill("SIGKILL");
    await forcedExit;
  }
}

function outputOf(child: ChildProcess) {
  return capturedOutput.get(child)?.join("") ?? "";
}

async function lifecycleReadiness(lifecycle: RuntimeLifecycle) {
  const socket = new Socket();
  const incoming = new IncomingMessage(socket);
  incoming.method = "GET";
  incoming.url = "/";
  const events = new EventEmitter();
  let body = "";
  const response = Object.assign(events, {
    destroyed: false,
    headersSent: false,
    setHeader() {},
    statusCode: 200,
    writableEnded: false,
    end(value?: string) {
      body = value ?? "";
      this.writableEnded = true;
      events.emit("finish");
    },
  }) as unknown as ServerResponse;
  const finished = new Promise<void>((resolve) => {
    response.once("finish", resolve);
  });
  try {
    lifecycle.healthApi(incoming, response, "ready");
    await finished;
    return {
      body: body ? JSON.parse(body) as Record<string, unknown> : {},
      status: response.statusCode,
    };
  } finally {
    socket.destroy();
  }
}

async function expectPortAvailable() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ exclusive: true, host: "127.0.0.1", port }, () => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => error ? reject(error) : resolve());
  });
}

function assertSecurityHeaders(
  response: Response,
  development: boolean,
  framePolicy: {
    allowSameOriginChildFrames?: boolean;
    allowSameOriginEmbedding?: boolean;
  } = {},
) {
  const policy = response.headers.get("content-security-policy") ?? "";
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("base-uri 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain(
    `frame-ancestors ${
      framePolicy.allowSameOriginEmbedding ? "'self'" : "'none'"
    }`,
  );
  expect(policy).toContain(
    `frame-src ${
      framePolicy.allowSameOriginChildFrames ? "'self'" : "'none'"
    }`,
  );
  expect(policy).toContain(
    "img-src 'self' blob: data: https://*.aliyuncs.com",
  );
  expect(policy).toContain(
    "media-src 'self' blob: data: https://*.aliyuncs.com",
  );
  expect(policy).not.toContain("script-src https://*.aliyuncs.com");
  expect(policy).not.toContain("connect-src https://*.aliyuncs.com");
  expect(policy).toContain(
    development
      ? "connect-src 'self' ws: wss:"
      : "connect-src 'self'",
  );
  if (development) {
    expect(policy).toContain("script-src 'self' 'unsafe-inline'");
  } else {
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain(" ws:");
  }
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe(
    framePolicy.allowSameOriginEmbedding ? "SAMEORIGIN" : "DENY",
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(response.headers.get("permissions-policy")).toContain("microphone=(self)");
  expect(response.headers.get("cross-origin-embedder-policy")).toBeNull();
}

function rawHttp(requestText: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.end(requestText);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error("raw HTTP request timed out"));
    });
  });
}

function slowChunkedHttp(requestHead: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(requestHead);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error("slow chunked request was not closed"));
    });
  });
}

function openServerEventStream() {
  return new Promise<{
    close: () => void;
    closed: Promise<void>;
    status: number;
    text: () => string;
  }>((resolve, reject) => {
    const request = openHttpRequest(`${origin}/api/updates`, (response) => {
      let body = "";
      let settled = false;
      let settleClosed: (() => void) | undefined;
      const closed = new Promise<void>((resolveClosed) => {
        settleClosed = resolveClosed;
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        settleClosed?.();
      };
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.once("aborted", finish);
      response.once("close", finish);
      response.once("end", finish);
      response.once("error", finish);
      resolve({
        close: () => response.destroy(),
        closed,
        status: response.statusCode ?? 0,
        text: () => body,
      });
    });
    request.once("error", reject);
    request.end();
  });
}

async function expectMissing(path: string) {
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function optionalFileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) return 0;
    throw error;
  }
}

async function directoryFingerprint(root: string) {
  const entries: string[] = [];
  async function visit(directory: string, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(`d:${relativePath}`);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const metadata = await stat(absolutePath);
        entries.push(
          `f:${relativePath}:${metadata.size}:${await sha256(absolutePath)}`,
        );
      } else {
        entries.push(`o:${relativePath}`);
      }
    }
  }
  await visit(root);
  return entries.sort();
}

const startupProviderFixtureLogName =
  ".unboundry-startup-provider-fixture.log";

async function seedQueuedStartupGenerationFixture(
  dataDirectory: string,
  fixtureId: string,
) {
  await mkdir(dataDirectory, { recursive: true });
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    // Greenfield publication owns an exactly empty directory. Create the
    // current database before Provider persistence creates secrets/lock files.
    const database = openAppDatabase(dataDirectory);
    try {
      const profile = await saveProviderProfile({
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        driver: "volcengine-ark",
        label: `M81 startup ${fixtureId}`,
      });
      const ownerId = `${fixtureId}-owner`;
      const textModelId = `${fixtureId}-text-model`;
      const textProviderModelId = "doubao-seed-2-0-lite-260428";
      const videoModelId = `${fixtureId}-video-model`;
      const videoProviderModelId = "doubao-seedance-2-0-mini-260615";
      const timestamp = "2026-08-11T08:00:00.000Z";
      const textParameterSchema = knownModelParameterSchema({
        capability: "text",
        providerDriver: "volcengine-ark",
        providerModelId: textProviderModelId,
      });
      const videoParameterSchema = knownModelParameterSchema({
        capability: "video",
        providerDriver: "volcengine-ark",
        providerModelId: videoProviderModelId,
      });
      database.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'fixture-only', 'user', 'active', ?, ?)
      `).run(ownerId, ownerId, `M81 ${fixtureId}`, timestamp, timestamp);
      database.prepare(`
        UPDATE provider_profiles
        SET status = 'enabled', key_status = 'valid', key_checked_at = ?
        WHERE id = ?
      `).run(timestamp, profile.id);
      const insertModel = database.prepare(`
        INSERT INTO model_profiles (
          id, display_name, provider_profile_id, provider_model_id,
          capability, status, default_parameters, created_at, updated_at,
          max_cost_microunits, cost_currency, provider_protocol
        ) VALUES (
          ?, ?, ?, ?, ?, 'published', ?, ?, ?,
          100000, 'CNY', 'native'
        )
      `);
      insertModel.run(
        textModelId,
        `M81 ${fixtureId} text`,
        profile.id,
        textProviderModelId,
        "text",
        JSON.stringify(textParameterSchema),
        timestamp,
        timestamp,
      );
      insertModel.run(
        videoModelId,
        `M81 ${fixtureId} video`,
        profile.id,
        videoProviderModelId,
        "video",
        JSON.stringify(videoParameterSchema),
        timestamp,
        timestamp,
      );
      const insertBinding = database.prepare(`
        INSERT INTO node_model_bindings (
          node_type, model_id, enabled, is_default, sort_order,
          created_at, updated_at
        ) VALUES (?, ?, 1, 1, 1, ?, ?)
      `);
      insertBinding.run("text", textModelId, timestamp, timestamp);
      insertBinding.run("video", videoModelId, timestamp, timestamp);
      bootstrapPublishedModelContracts(database, ownerId);
      const textModelRelease = modelContractState(database, textModelId).active;
      const videoModelRelease = modelContractState(database, videoModelId).active;
      if (!textModelRelease || !videoModelRelease) {
        throw new Error("M81 startup fixture model contracts were not published");
      }
      database.prepare(`
        UPDATE generation_safety_settings
        SET
          global_enabled = 1,
          emergency_stop = 0,
          per_user_concurrency = 5,
          requests_per_minute = 120,
          text_concurrency = 3,
          video_concurrency = 3,
          updated_at = ?
        WHERE id = 1
      `).run(timestamp);
      const credential = await saveAccountCredential(
        database,
        ownerId,
        profile.id,
        "m81-startup-fake-provider-key",
      );
      const tasks = createGenerationTaskStore(dataDirectory);
      try {
        const providerVersion = providerConfigurationVersion(profile);
        const textNodeId = `${fixtureId}-node`;
        const textParameters = {
          inputs: [],
          responseFormat: "text",
          thinkingLevel: "minimal",
        };
        const textPrompt =
          "start this committed task without a generation HTTP request";
        const textGenerationInputKey =
          `m81:${fixtureId}:${textNodeId}:input`;
        const textGenerationOwnershipKey =
          `m81:${fixtureId}:${textNodeId}:ownership`;
        const textModelInputContractFingerprint =
          `m81:${fixtureId}:text-contract`;
        const textModelConfigurationRevision =
          authoritativeModelConfigurationRevision({
            capability: "text",
            id: textModelId,
            modelConfigurationUpdatedAt: timestamp,
            parameterSchema: textModelRelease.document.capabilitySchema,
            providerDriver: "volcengine-ark",
            providerModelId: textProviderModelId,
          });
        const textExecution = assertRegisteredModelExecutionTotality({
          capability: "text",
          capabilitySchema: textModelRelease.document.capabilitySchema,
          providerDriver: "volcengine-ark",
          providerModelId: textProviderModelId,
          providerProtocol: "native",
          revisionIdentity: textModelRelease.revisionId,
        });
        const admitted = tasks.admitAuthoritativeOrGet({
          canvasId: `${fixtureId}-canvas`,
          costCurrency: "CNY",
          credentialRevision: credential.credentialVersion,
          estimatedCostMicrounits: 100_000,
          idempotencyKey: `${fixtureId}-startup-key`,
          kind: "text",
          model: textModelId,
          modelConfiguration: buildAuthoritativeGenerationModelConfiguration({
            credentialVersion: credential.credentialVersion,
            generationInputKey: textGenerationInputKey,
            generationOwnershipKey: textGenerationOwnershipKey,
            modelCapability: "text",
            modelConfigurationRevision: textModelConfigurationRevision,
            modelExecutionAdapterId: textExecution.adapterId,
            modelId: textModelId,
            modelInputContractFingerprint:
              textModelInputContractFingerprint,
            modelReleaseRevision: textModelRelease,
            modelResultCount: textExecution.resultCount,
            parameterSchema: textModelRelease.document.capabilitySchema,
            providerConfigurationVersion: providerVersion,
            providerDriver: "volcengine-ark",
            providerModelId: textProviderModelId,
            providerProfileId: profile.id,
            providerProtocol: "native",
          }),
          nodeId: textNodeId,
          ownerId,
          parameters: textParameters,
          prompt: textPrompt,
          providerModelId: textProviderModelId,
          providerProfileId: profile.id,
          requestIntent: {
            canvasId: `${fixtureId}-canvas`,
            generationIdentityVersion: 2,
            generationInputKey: textGenerationInputKey,
            generationOwnershipKey: textGenerationOwnershipKey,
            kind: "text",
            model: textModelId,
            modelConfigurationRevision: textModelConfigurationRevision,
            modelInputContractFingerprint:
              textModelInputContractFingerprint,
            modelReleaseRevision: textModelRelease.revisionId,
            nodeId: textNodeId,
            parameters: textParameters,
            prompt: textPrompt,
          },
        });
        expect(admitted.created).toBe(true);
        const videoModelConfigurationRevision =
          authoritativeModelConfigurationRevision({
            capability: "video",
            id: videoModelId,
            modelConfigurationUpdatedAt: timestamp,
            parameterSchema: videoModelRelease.document.capabilitySchema,
            providerDriver: "volcengine-ark",
            providerModelId: videoProviderModelId,
          });
        const videoExecution = assertRegisteredModelExecutionTotality({
          capability: "video",
          capabilitySchema: videoModelRelease.document.capabilitySchema,
          providerDriver: "volcengine-ark",
          providerModelId: videoProviderModelId,
          providerProtocol: "native",
          revisionIdentity: videoModelRelease.revisionId,
        });
        const admitVideo = (suffix: string) => {
          const canvasId = `${fixtureId}-canvas`;
          const nodeId = `${fixtureId}-${suffix}-node`;
          const parameters = {};
          const prompt =
            "recover committed video work without submitting again";
          const generationInputKey =
            `m81:${fixtureId}:${nodeId}:input`;
          const generationOwnershipKey =
            `m81:${fixtureId}:${nodeId}:ownership`;
          const modelInputContractFingerprint =
            `m81:${fixtureId}:${suffix}:video-contract`;
          return tasks.admitAuthoritativeOrGet({
            canvasId,
            costCurrency: "CNY",
            credentialRevision: credential.credentialVersion,
            estimatedCostMicrounits: 100_000,
            idempotencyKey: `${fixtureId}-${suffix}-key`,
            kind: "video",
            model: videoModelId,
            modelConfiguration: buildAuthoritativeGenerationModelConfiguration({
              credentialVersion: credential.credentialVersion,
              generationInputKey,
              generationOwnershipKey,
              modelCapability: "video",
              modelConfigurationRevision: videoModelConfigurationRevision,
              modelExecutionAdapterId: videoExecution.adapterId,
              modelId: videoModelId,
              modelInputContractFingerprint,
              modelReleaseRevision: videoModelRelease,
              modelResultCount: videoExecution.resultCount,
              parameterSchema: videoModelRelease.document.capabilitySchema,
              providerConfigurationVersion: providerVersion,
              providerDriver: "volcengine-ark",
              providerModelId: videoProviderModelId,
              providerProfileId: profile.id,
              providerProtocol: "native",
            }),
            nodeId,
            ownerId,
            parameters,
            prompt,
            providerModelId: videoProviderModelId,
            providerProfileId: profile.id,
            requestIntent: {
              canvasId,
              generationIdentityVersion: 2,
              generationInputKey,
              generationOwnershipKey,
              kind: "video",
              model: videoModelId,
              modelConfigurationRevision: videoModelConfigurationRevision,
              modelInputContractFingerprint,
              modelReleaseRevision: videoModelRelease.revisionId,
              nodeId,
              parameters,
              prompt,
            },
          }).task;
        };
        const accepted = tasks.transition(
          admitVideo("accepted").id,
          "running",
        )!;
        tasks.recordProviderAttempt(accepted.id);
        const providerTaskId = `${fixtureId}-provider-task`;
        tasks.setProviderTaskId(accepted.id, providerTaskId);
        const preBoundary = tasks.transition(
          admitVideo("pre-boundary").id,
          "running",
        )!;
        const retrying = admitVideo("retrying");
        database.exec("BEGIN IMMEDIATE");
        try {
          database.prepare(`
            UPDATE generation_tasks
            SET state = 'retrying', updated_at = ?
            WHERE id = ? AND state = 'queued'
          `).run(timestamp, retrying.id);
          database.prepare(`
            INSERT INTO generation_task_events (
              task_id, state, created_at
            ) VALUES (?, 'retrying', ?)
          `).run(retrying.id, timestamp);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        return {
          acceptedTaskId: accepted.id,
          ownerId,
          preBoundaryTaskId: preBoundary.id,
          providerTaskId,
          retryingTaskId: retrying.id,
          taskId: admitted.task.id,
        };
      } finally {
        tasks.close();
      }
    } finally {
      database.close();
    }
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
  }
}

async function moveProviderFixtureCache(
  dataDirectory: string,
) {
  await mkdir(dataDirectory, { recursive: true });
  const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  try {
    // Keep the greenfield bootstrap ahead of secret-store residue here too.
    const database = openAppDatabase(dataDirectory);
    database.close();
    await saveProviderProfile({
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      driver: "volcengine-ark",
      label: "M81 provider cache sink",
    });
  } finally {
    if (previousDataDirectory === undefined) {
      delete process.env.UNBOUNDRY_DATA_DIR;
    } else {
      process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
    }
  }
}

function makeStandaloneDatabase(dataDirectory: string) {
  const database = openAppDatabase(dataDirectory);
  database.exec(`
    PRAGMA wal_checkpoint(TRUNCATE);
    PRAGMA journal_mode = DELETE;
  `);
  database.close();
}

type OldLocalUploadCandidate = Readonly<{
  assetId: string;
  attemptId: string;
  bytes: Buffer;
  ownerId: string;
  stagingName: string;
  storageName: string;
}>;

function insertOldLocalUploadCandidate(
  database: DatabaseSync,
  fixtureId: string,
): OldLocalUploadCandidate {
  const ownerId = `${fixtureId}-owner`;
  const assetId = `${fixtureId}-asset`;
  const attemptId = `${fixtureId}-attempt`;
  const storageName = `${assetId}.png`;
  const stagingName = `.publication-${fixtureId}.generating`;
  const bytes = Buffer.from(`M81 old local upload ${fixtureId}`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const timestamp = new Date().toISOString();
  const oldTimestamp = "2000-01-01T00:00:00.000Z";
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'fixture-only', 'user', 'active', ?, ?)
  `).run(ownerId, ownerId, `M81 ${fixtureId}`, timestamp, timestamp);
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, storage_profile_id, object_key, content_type,
      checksum_sha256, storage_status, duration_seconds, duration_source,
      duration_status, media_width, media_height
    ) VALUES (
      'image', ?, ?, ?, ?, ?, ?, 'local', NULL, ?, 'image/png', ?,
      'ready', NULL, NULL, 'not-applicable', 2, 3
    )
  `).run(
    assetId,
    ownerId,
    storageName,
    bytes.length,
    oldTimestamp,
    oldTimestamp,
    storageName,
    digest,
  );
  database.prepare(`
    INSERT INTO media_publication_attempts (
      attempt_id, owner_id, kind, asset_id, source, state,
      storage_backend, final_storage_name, object_key, storage_profile_id,
      staging_name, task_id, task_execution_attempt, history_label,
      byte_size, checksum_sha256, content_type, media_width, media_height,
      created_at, updated_at
    ) VALUES (
      ?, ?, 'image', ?, 'upload', 'published',
      'local', ?, ?, NULL, ?, NULL, NULL, NULL,
      ?, ?, 'image/png', 2, 3, ?, ?
    )
  `).run(
    attemptId,
    ownerId,
    assetId,
    storageName,
    storageName,
    stagingName,
    bytes.length,
    digest,
    oldTimestamp,
    oldTimestamp,
  );
  return { assetId, attemptId, bytes, ownerId, stagingName, storageName };
}

async function writeOldLocalUploadCandidate(
  dataDirectory: string,
  candidate: OldLocalUploadCandidate,
) {
  const mediaDirectory = join(dataDirectory, "media");
  await mkdir(mediaDirectory, { recursive: true });
  await writeFile(join(mediaDirectory, candidate.storageName), candidate.bytes, {
    flag: "wx",
  });
}

function rollbackMigration39To38(database: DatabaseSync) {
  if (Number((database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  }).user_version) === 42) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE media_capacity_reservations;
      DROP TABLE workflow_run_locks;
      DROP TABLE workflow_run_nodes;
      DROP TABLE workflow_runs;
      DELETE FROM schema_migrations WHERE version = 42;
      PRAGMA user_version = 41;
      COMMIT;
    `);
  }
  if (Number((database.prepare("PRAGMA user_version").get() as {
    user_version: number;
  }).user_version) === 41) {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TABLE seedance_character_compliance_attempts;
      DROP TABLE seedance_character_compliance_checks;
      DROP TABLE seedance_character_compliance_disclosures;
      DROP TABLE seedance_asset_bindings;
      DROP TABLE seedance_authorization_sessions;
      DROP TABLE seedance_identity_groups;
      DROP INDEX media_assets_owner_kind_id;
      DELETE FROM schema_migrations WHERE version >= 40;
      PRAGMA user_version = 39;
      COMMIT;
    `);
  }
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TEMP TABLE generation_ledger_sequences_schema39 (
        name TEXT PRIMARY KEY,
        seq INTEGER NOT NULL
      );
      INSERT INTO generation_ledger_sequences_schema39 (name, seq)
      SELECT name, seq
      FROM sqlite_sequence
      WHERE name IN ('generation_task_events', 'generation_provider_attempts');

      DROP TRIGGER generation_tasks_capture_model_display_name;
      DROP TRIGGER media_publication_guard_task_delete;
      DROP TRIGGER media_publication_guard_owner_delete;
      DROP TRIGGER account_delete_guard_generation_task_insert;
      DROP TRIGGER account_delete_guard_generation_task_activation;
      DROP TABLE generation_admission_events;
      DROP TABLE account_provider_credential_epochs;

      ALTER TABLE generation_task_events
        RENAME TO generation_task_events_schema39;
      ALTER TABLE generation_provider_attempts
        RENAME TO generation_provider_attempts_schema39;
      ALTER TABLE media_publication_attempts
        RENAME TO media_publication_attempts_schema39;
      ALTER TABLE generation_tasks
        RENAME TO generation_tasks_schema39;

      CREATE TABLE generation_tasks (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('text', 'image', 'video', 'audio')
        ),
        prompt TEXT NOT NULL,
        model TEXT,
        parameters TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'queued',
            'running',
            'success',
            'failed',
            'cancelled',
            'retrying',
            'recovering'
          )
        ),
        attempt INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        owner_id TEXT,
        estimated_cost_microunits INTEGER CHECK (
          estimated_cost_microunits IS NULL
          OR estimated_cost_microunits >= 0
        ),
        actual_cost_microunits INTEGER CHECK (
          actual_cost_microunits IS NULL
          OR actual_cost_microunits >= 0
        ),
        provider_profile_id TEXT,
        provider_model_id TEXT,
        result_asset_id TEXT,
        cost_currency TEXT NOT NULL DEFAULT 'USD' CHECK (
          cost_currency IN ('USD', 'CNY')
        ),
        provider_task_id TEXT,
        provider_usage_tokens INTEGER CHECK (
          provider_usage_tokens IS NULL OR provider_usage_tokens >= 0
        ),
        model_configuration TEXT NOT NULL DEFAULT '{}',
        result_text TEXT CHECK (
          result_text IS NULL OR length(result_text) BETWEEN 1 AND 200000
        ),
        UNIQUE (canvas_id, idempotency_key)
      );
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration, result_text
      )
      SELECT
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt, error_code,
        error_message, created_at, updated_at, owner_id,
        estimated_cost_microunits, actual_cost_microunits,
        provider_profile_id, provider_model_id, result_asset_id,
        cost_currency, provider_task_id, provider_usage_tokens,
        model_configuration, result_text
      FROM generation_tasks_schema39;

      CREATE TABLE generation_task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'queued',
            'running',
            'success',
            'failed',
            'cancelled',
            'retrying',
            'recovering'
          )
        ),
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
      );
      INSERT INTO generation_task_events (
        id, task_id, state, error_code, error_message, created_at
      )
      SELECT id, task_id, state, error_code, error_message, created_at
      FROM generation_task_events_schema39;

      CREATE TABLE generation_provider_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        execution_attempt INTEGER NOT NULL CHECK (execution_attempt >= 1),
        provider_profile_id TEXT NOT NULL,
        provider_model_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('text', 'image', 'video', 'audio')
        ),
        evidence TEXT NOT NULL CHECK (
          evidence IN ('historical-execution-attempt', 'provider-boundary')
        ),
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        UNIQUE (task_id, execution_attempt)
      );
      INSERT INTO generation_provider_attempts (
        id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, evidence, created_at
      )
      SELECT
        id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, evidence, created_at
      FROM generation_provider_attempts_schema39;
      ALTER TABLE "generation_provider_attempts" ADD COLUMN "owner_id" TEXT;
      UPDATE generation_provider_attempts
      SET owner_id = (
        SELECT generation_provider_attempts_schema39.owner_id
        FROM generation_provider_attempts_schema39
        WHERE generation_provider_attempts_schema39.id =
          generation_provider_attempts.id
      );

      CREATE TABLE media_publication_attempts (
        attempt_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
        asset_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('upload', 'generation')),
        state TEXT NOT NULL CHECK (
          state IN (
            'reserved', 'staged', 'external-ready',
            'compensating', 'published', 'failed'
          )
        ),
        storage_backend TEXT NOT NULL CHECK (storage_backend IN ('local', 'oss')),
        final_storage_name TEXT NOT NULL,
        object_key TEXT NOT NULL,
        storage_profile_id TEXT,
        staging_name TEXT NOT NULL UNIQUE,
        task_id TEXT,
        task_execution_attempt INTEGER CHECK (
          task_execution_attempt IS NULL OR task_execution_attempt >= 1
        ),
        history_label TEXT,
        byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
        checksum_sha256 TEXT,
        content_type TEXT NOT NULL,
        duration_seconds REAL,
        duration_source TEXT CHECK (
          duration_source IS NULL
          OR duration_source IN ('server-probe', 'provider-task')
        ),
        media_width INTEGER CHECK (media_width IS NULL OR media_width > 0),
        media_height INTEGER CHECK (media_height IS NULL OR media_height > 0),
        actual_cost_microunits INTEGER CHECK (
          actual_cost_microunits IS NULL OR actual_cost_microunits >= 0
        ),
        provider_usage_tokens INTEGER CHECK (
          provider_usage_tokens IS NULL OR provider_usage_tokens >= 0
        ),
        error_code TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        adopted_at TEXT,
        adopted_canvas_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE,
        CHECK (
          (source = 'upload' AND task_id IS NULL AND task_execution_attempt IS NULL)
          OR
          (source = 'generation' AND task_id IS NOT NULL AND task_execution_attempt IS NOT NULL)
        ),
        CHECK (
          (adopted_at IS NULL AND adopted_canvas_id IS NULL)
          OR
          (source = 'upload' AND adopted_at IS NOT NULL AND adopted_canvas_id IS NOT NULL)
        )
      );
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, storage_profile_id,
        staging_name, task_id, task_execution_attempt, history_label,
        byte_size, checksum_sha256, content_type, duration_seconds,
        duration_source, media_width, media_height, actual_cost_microunits,
        provider_usage_tokens, error_code, retry_count, adopted_at,
        adopted_canvas_id, created_at, updated_at
      )
      SELECT
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, storage_profile_id,
        staging_name, task_id, task_execution_attempt, history_label,
        byte_size, checksum_sha256, content_type, duration_seconds,
        duration_source, media_width, media_height, actual_cost_microunits,
        provider_usage_tokens, error_code, retry_count, adopted_at,
        adopted_canvas_id, created_at, updated_at
      FROM media_publication_attempts_schema39;

      DROP TABLE generation_task_events_schema39;
      DROP TABLE generation_provider_attempts_schema39;
      DROP TABLE media_publication_attempts_schema39;
      DROP TABLE generation_tasks_schema39;

      UPDATE sqlite_sequence
      SET seq = MAX(
        seq,
        COALESCE((
          SELECT saved.seq
          FROM generation_ledger_sequences_schema39 AS saved
          WHERE saved.name = sqlite_sequence.name
        ), 0)
      )
      WHERE name IN ('generation_task_events', 'generation_provider_attempts');
      INSERT INTO sqlite_sequence (name, seq)
      SELECT saved.name, saved.seq
      FROM generation_ledger_sequences_schema39 AS saved
      WHERE NOT EXISTS (
        SELECT 1 FROM sqlite_sequence AS current
        WHERE current.name = saved.name
      );
      DROP TABLE generation_ledger_sequences_schema39;

      CREATE INDEX generation_tasks_canvas_updated
        ON generation_tasks (canvas_id, updated_at DESC);
      CREATE INDEX generation_tasks_owner_canvas_updated
        ON generation_tasks (owner_id, canvas_id, updated_at DESC);
      CREATE INDEX generation_tasks_owner_state_created
        ON generation_tasks (owner_id, state, created_at DESC);
      CREATE INDEX generation_tasks_result_asset
        ON generation_tasks (result_asset_id)
        WHERE result_asset_id IS NOT NULL;
      CREATE INDEX generation_tasks_currency_created
        ON generation_tasks (cost_currency, created_at DESC);
      CREATE UNIQUE INDEX generation_tasks_provider_task
        ON generation_tasks (provider_profile_id, provider_task_id)
        WHERE provider_task_id IS NOT NULL;
      CREATE INDEX generation_task_events_task_created
        ON generation_task_events (task_id, created_at ASC, id ASC);
      CREATE INDEX generation_provider_attempts_profile_kind_created
        ON generation_provider_attempts (
          provider_profile_id, kind, created_at DESC, id DESC
        );
      CREATE INDEX generation_provider_attempts_task_created
        ON generation_provider_attempts (task_id, created_at ASC, id ASC);
      CREATE INDEX IF NOT EXISTS generation_provider_attempts_owner_profile_created
        ON generation_provider_attempts (
          owner_id,
          provider_profile_id,
          created_at DESC
        );
      CREATE UNIQUE INDEX media_publication_attempts_active_asset
        ON media_publication_attempts (kind, asset_id)
        WHERE state IN ('reserved', 'staged', 'external-ready', 'compensating');
      CREATE UNIQUE INDEX media_publication_attempts_active_task
        ON media_publication_attempts (task_id, task_execution_attempt)
        WHERE task_id IS NOT NULL
          AND state IN ('reserved', 'staged', 'external-ready', 'compensating');
      CREATE INDEX media_publication_attempts_owner_state_updated
        ON media_publication_attempts (owner_id, state, updated_at DESC);

      CREATE TRIGGER IF NOT EXISTS generation_tasks_capture_model_display_name
      AFTER INSERT ON generation_tasks
      WHEN
        NEW.model IS NOT NULL
        AND json_valid(NEW.model_configuration)
        AND EXISTS (
          SELECT 1 FROM model_profiles WHERE id = NEW.model
        )
        AND (
          json_type(NEW.model_configuration, '$.displayName') IS NULL
          OR (
            json_type(NEW.model_configuration, '$.displayName') = 'text'
            AND trim(json_extract(NEW.model_configuration, '$.displayName')) = ''
          )
        )
      BEGIN
        UPDATE generation_tasks
        SET model_configuration = json_set(
          model_configuration,
          '$.displayName',
          (SELECT display_name FROM model_profiles WHERE id = NEW.model)
        )
        WHERE id = NEW.id;
      END;
      CREATE TRIGGER media_publication_guard_task_delete
        BEFORE DELETE ON generation_tasks
        WHEN EXISTS (
          SELECT 1 FROM media_publication_attempts
          WHERE task_id = OLD.id
            AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
        )
      BEGIN
        SELECT RAISE(ABORT, 'active media publication blocks task deletion');
      END;
      CREATE TRIGGER media_publication_guard_owner_delete
        BEFORE DELETE ON users
        WHEN EXISTS (
          SELECT 1 FROM media_publication_attempts
          WHERE owner_id = OLD.id
            AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
        )
      BEGIN
        SELECT RAISE(ABORT, 'active media publication blocks owner deletion');
      END;
      CREATE TRIGGER account_delete_guard_generation_task_insert
        BEFORE INSERT ON generation_tasks
        WHEN NEW.owner_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = NEW.owner_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks generation task mutation');
      END;
      CREATE TRIGGER account_delete_guard_generation_task_activation
        BEFORE UPDATE OF owner_id, state ON generation_tasks
        WHEN NEW.owner_id IS NOT NULL
          AND NEW.state IN ('queued', 'running', 'retrying', 'recovering')
          AND EXISTS (
            SELECT 1 FROM account_delete_intents
            WHERE owner_id = NEW.owner_id
          )
      BEGIN
        SELECT RAISE(ABORT, 'account deletion blocks generation task mutation');
      END;

      DELETE FROM schema_migrations WHERE version = 39;
      PRAGMA user_version = 38;
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function rollbackMigration38To37(database: DatabaseSync) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      DROP TRIGGER account_delete_guard_generation_task_activation;
      DROP TRIGGER account_delete_guard_generation_task_insert;
      DROP TRIGGER account_delete_guard_public_template_actor_update;
      DROP TRIGGER account_delete_guard_public_template_insert;
      DROP TRIGGER account_delete_guard_session_insert;
      DROP TRIGGER account_delete_guard_user_template_insert;
      DROP TRIGGER account_delete_guard_user_template_owner_update;
      DROP TRIGGER account_delete_guard_user_reactivation;
      DROP TRIGGER media_publication_guard_task_delete;
      DROP TRIGGER media_publication_guard_owner_delete;
      DROP TABLE media_publication_attempts;
      DROP TABLE media_delete_intents;
      DROP TABLE account_delete_intents;
      DELETE FROM schema_migrations WHERE version = 38;
      PRAGMA user_version = 37;
      COMMIT;
    `);
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function recreateV5ModelProfiles(
  database: DatabaseSync,
  existingCostColumns: "cost" | "max" | "none",
) {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("DROP TABLE model_profiles");
  // Keep this base table and index aligned with immutable migration v5. The
  // v21 prepare hook has explicit, known-safe repairs for either missing cost
  // column; the final exact sqlite_schema text depends on their append order.
  database.exec(`
      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        provider_profile_id TEXT NOT NULL,
        provider_model_id TEXT NOT NULL,
        capability TEXT NOT NULL CHECK (
          capability IN ('text', 'image', 'video', 'audio')
        ),
        status TEXT NOT NULL CHECK (
          status IN ('draft', 'published', 'disabled')
        ),
        default_parameters TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id)
      );
      CREATE INDEX IF NOT EXISTS model_profiles_capability_status
        ON model_profiles (capability, status, updated_at DESC);
    `);
  if (existingCostColumns === "max") {
    database.exec(`
      ALTER TABLE model_profiles
        ADD COLUMN max_cost_microunits INTEGER NOT NULL DEFAULT 0
        CHECK (max_cost_microunits BETWEEN 0 AND 100000000);
    `);
  }
  if (existingCostColumns === "cost") {
    database.exec(`
      ALTER TABLE model_profiles
        ADD COLUMN cost_currency TEXT NOT NULL DEFAULT 'USD'
        CHECK (cost_currency IN ('USD', 'CNY'));
    `);
  }
}

function recreateV21MissingCatalogTables(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`
    DROP TABLE node_model_bindings;
    DROP TABLE model_profiles;
    DROP TABLE admin_audit_events;
    DROP TABLE users;
  `);
}

function initializePrivateSyntheticSchema(
  dataDirectory: string,
  targetVersion: number,
) {
  const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
  let transactionOpen = false;
  try {
    // Match the greenfield sqlite_schema text exactly. The physical-schema
    // contract intentionally includes declaration whitespace, so this fixture
    // must not use source indentation that production never persists.
    database.exec(
      "PRAGMA foreign_keys = ON;" +
        "CREATE TABLE schema_migrations (\n" +
        "      version INTEGER PRIMARY KEY,\n" +
        "      name TEXT NOT NULL,\n" +
        "      applied_at TEXT NOT NULL\n" +
        "    );" +
        "BEGIN IMMEDIATE;",
    );
    transactionOpen = true;
    applyPendingSchemaMigrationsInTransaction(database, {
      appliedAt: () => "2026-08-12T00:00:00.000Z",
      sourceVersion: 0,
      targetVersion,
    });
    database.exec("COMMIT");
    transactionOpen = false;
    return database;
  } catch (error) {
    if (transactionOpen && database.isTransaction) database.exec("ROLLBACK");
    database.close();
    throw error;
  }
}

const productionHistoricAssetHistorySql = `CREATE TABLE asset_history (
      account_id TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      preview TEXT NOT NULL,
      created_at TEXT NOT NULL, owner_id TEXT,
      PRIMARY KEY (account_id, id)
    )`;

const productionHistoricProviderProfilesSql = `CREATE TABLE provider_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        driver TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('disabled', 'enabled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , key_status TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (key_status IN ('unchecked', 'valid', 'invalid', 'unknown')), key_checked_at TEXT, catalog_key_status TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (
          catalog_key_status IN (
            'unchecked',
            'valid',
            'invalid',
            'permission',
            'unknown'
          )
        ), catalog_checked_at TEXT, catalog_synced_at TEXT, catalog_last_error_code TEXT, catalog_models TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(catalog_models)), catalog_endpoints TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(catalog_endpoints)), catalog_model_count INTEGER NOT NULL DEFAULT 0
        CHECK (catalog_model_count >= 0), catalog_endpoint_count INTEGER NOT NULL DEFAULT 0
        CHECK (catalog_endpoint_count >= 0), catalog_control_request_count INTEGER NOT NULL DEFAULT 0
        CHECK (catalog_control_request_count >= 0), catalog_credential_revision TEXT, provider_configuration_version INTEGER NOT NULL DEFAULT 0
        CHECK (provider_configuration_version >= 0), catalog_sync_token TEXT, catalog_diagnostics TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(catalog_diagnostics)))`;

const productionHistoricTableSqlHashes = Object.freeze({
  asset_history:
    "0053af18d88bd9872c210fa69fba542dd7254ba0f7e6d6c736e3635e5ca65300",
  provider_profiles:
    "47a50d882fbf7e6c5045800b3fa66b4ddb7ccba9f1a2a0646c81ec3b816d87e2",
});

function tableSchemaSql(database: DatabaseSync, tableName: string) {
  const row = database.prepare(`
    SELECT sql
    FROM sqlite_schema
    WHERE type = 'table' AND name = ? AND tbl_name = ?
  `).get(tableName, tableName) as { sql?: unknown } | undefined;
  return String(row?.sql ?? "");
}

function tableSchemaSqlHash(database: DatabaseSync, tableName: string) {
  return createHash("sha256")
    .update(tableSchemaSql(database, tableName))
    .digest("hex");
}

function tablePragmaFingerprint(database: DatabaseSync, tableName: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
    throw new Error("Unsafe table name in schema fixture");
  }
  const indexes = database.prepare(
    `PRAGMA index_list("${tableName}")`,
  ).all() as Array<{ name?: unknown }>;
  return JSON.stringify({
    columns: database.prepare(`PRAGMA table_xinfo("${tableName}")`).all(),
    foreignKeys: database
      .prepare(`PRAGMA foreign_key_list("${tableName}")`)
      .all(),
    indexColumns: indexes.map((index) => {
      const indexName = String(index.name ?? "");
      if (!/^[a-z][a-z0-9_]*$/.test(indexName)) {
        throw new Error("Unsafe index name in schema fixture");
      }
      return {
        columns: database.prepare(`PRAGMA index_xinfo("${indexName}")`).all(),
        name: indexName,
      };
    }),
    indexes,
    tableFlags: (database.prepare(
      `PRAGMA table_list("${tableName}")`,
    ).all() as Array<{ strict?: unknown; wr?: unknown }>).map((table) => ({
      strict: Number(table.strict),
      wr: Number(table.wr),
    })),
  });
}

function rewriteTableSchemaSql(
  database: DatabaseSync,
  tableName: string,
  sql: string,
) {
  const schemaVersion = Number((database.prepare("PRAGMA schema_version").get() as {
    schema_version?: unknown;
  }).schema_version);
  database.exec("PRAGMA writable_schema = ON");
  try {
    const result = database.prepare(`
      UPDATE sqlite_schema
      SET sql = ?
      WHERE type = 'table' AND name = ? AND tbl_name = ?
    `).run(sql, tableName, tableName);
    expect(Number(result.changes)).toBe(1);
  } finally {
    database.exec("PRAGMA writable_schema = OFF");
  }
  database.exec(`PRAGMA schema_version = ${schemaVersion + 1}`);
}

function expectBackupSchemaRejected(databasePath: string, inspectionRoot: string) {
  let error: unknown;
  try {
    inspectBackupDatabase(databasePath, inspectionRoot);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(BackupInspectionError);
  expect((error as BackupInspectionError).code).toBe(
    "BACKUP_DATABASE_SCHEMA_UNSUPPORTED",
  );
}

function cookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function request(
  path: string,
  options: RequestInit & {
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const { cookie: session, headers, ...init } = options;
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
  });
}

async function bootstrapAdmin() {
  const bootstrap = await request("/api/auth/bootstrap", {
    body: JSON.stringify({
      displayName: "Owner",
      loginName: "owner",
      password: "owner-password-123",
    }),
    headers: { "X-Forwarded-For": "127.0.0.1" },
    method: "POST",
  });
  expect(bootstrap.ok).toBe(true);
  return cookie(bootstrap);
}

function initializePrivateSyntheticGreenfield(dataDirectory: string) {
  const database = openAppDatabase(dataDirectory);
  try {
    expect(database.prepare("PRAGMA user_version").get()).toEqual({
      user_version: currentSchemaVersion,
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM users").get())
      .toEqual({ count: 0 });
  } finally {
    database.close();
  }
}

test("trusted proxy mode blocks remote bootstrap through forwarded IP", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-bootstrap-"));
  let server: ChildProcess | undefined;
  try {
    initializePrivateSyntheticGreenfield(dataDirectory);
    server = await startServer(dataDirectory, {
      waitPath: "/api/health/ready",
    });

    const remote = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Remote",
        loginName: "remote",
        password: "remote-pass-123",
      }),
      headers: { "X-Forwarded-For": "203.0.113.9" },
      method: "POST",
    });
    expect(remote.status).toBe(403);
    expect(await remote.text()).toContain("首次管理员只能在服务器本机创建");

    const local = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Owner",
        loginName: "owner",
        password: "owner-password-123",
      }),
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(local.status).toBe(201);
    expect(cookie(local)).not.toBe("");
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("trusted proxy mode requires https forwarding for storage writes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-storage-"));
  let server: ChildProcess | undefined;
  try {
    initializePrivateSyntheticGreenfield(dataDirectory);
    server = await startServer(dataDirectory, {
      waitPath: "/api/health/ready",
    });
    const adminCookie = await bootstrapAdmin();
    const profile = {
      accessKeyId: "m81-test-access-key-id",
      accessKeySecret: "m81-test-secret-key",
      bucket: "m81-private-bucket",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      label: "M81 Test OSS",
      region: "oss-cn-hangzhou",
    };

    const plain = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "127.0.0.1" },
      method: "POST",
    });
    expect(plain.status).toBe(400);
    expect(await plain.text()).toContain("HTTPS");

    const secure = await request("/api/admin/storage/profiles", {
      body: JSON.stringify(profile),
      cookie: adminCookie,
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "X-Forwarded-Proto": "https",
      },
      method: "POST",
    });
    expect(secure.status).toBe(201);

    const readThroughProxy = await request("/api/admin/storage", {
      cookie: adminCookie,
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    expect(readThroughProxy.status).toBe(200);

    const direct = await request("/api/admin/storage/profiles", {
      body: JSON.stringify({ ...profile, label: "M81 Direct OSS" }),
      cookie: adminCookie,
      method: "POST",
    });
    expect(direct.status).toBe(201);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("active startup atomically bootstraps only an empty private data directory", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-greenfield-startup-"));
  const freshDataDirectory = join(testRoot, "fresh-data");
  const preexistingDataDirectory = join(testRoot, "preexisting-data");
  const preexistingDatabasePath = join(
    preexistingDataDirectory,
    "unboundry.sqlite",
  );
  let server: ChildProcess | undefined;
  try {
    await mkdir(freshDataDirectory, { mode: 0o700 });
    server = await startServer(freshDataDirectory, {
      waitPath: "/api/health/ready",
    });
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      mode: "active",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    await stopServer(server);
    server = undefined;

    const initialized = new DatabaseSync(
      join(freshDataDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    try {
      expect(initialized.prepare("PRAGMA user_version").get()).toEqual({
        user_version: currentSchemaVersion,
      });
      expect(databaseMatchesSchemaContract(initialized)).toBe(true);
      expect(databaseHasCompleteLegacyMediaMetadata(initialized)).toBe(true);
      expect(initialized.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      initialized.close();
    }
    expect(
      (await readdir(freshDataDirectory)).filter((name) =>
        name.startsWith(".unboundry-greenfield-")
      ),
    ).toEqual([]);

    await mkdir(preexistingDataDirectory, { mode: 0o700 });
    await writeFile(preexistingDatabasePath, new Uint8Array(), {
      flag: "wx",
      mode: 0o600,
    });
    const beforePreexistingStartup = await directoryFingerprint(
      preexistingDataDirectory,
    );
    server = await startServer(preexistingDataDirectory);
    const blocked = await fetch(`${origin}/api/health/ready`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      code: "DATABASE_FILE_INVALID",
    });
    expect(await directoryFingerprint(preexistingDataDirectory)).toEqual(
      beforePreexistingStartup,
    );
    await stopServer(server);
    server = undefined;

    for (const residue of [
      {
        name: "media",
        prepare: async (directory: string) => {
          const media = join(directory, "media");
          await mkdir(media, { mode: 0o700 });
          await writeFile(join(media, "orphan-image.bin"), "synthetic-media", {
            flag: "wx",
            mode: 0o600,
          });
        },
      },
      {
        name: "secrets",
        prepare: async (directory: string) => {
          const secrets = join(directory, "secrets");
          await mkdir(secrets, { mode: 0o700 });
          await writeFile(
            join(secrets, "config-master.key"),
            new Uint8Array(32).fill(0x81),
            { flag: "wx", mode: 0o600 },
          );
        },
      },
      {
        name: "unknown",
        prepare: (directory: string) =>
          writeFile(join(directory, "unexpected-residue"), "synthetic-residue", {
            flag: "wx",
            mode: 0o600,
          }),
      },
    ]) {
      const residualDataDirectory = join(
        testRoot,
        `preexisting-${residue.name}`,
      );
      await mkdir(residualDataDirectory, { mode: 0o700 });
      await residue.prepare(residualDataDirectory);
      const beforeResidualStartup = await directoryFingerprint(
        residualDataDirectory,
      );
      server = await startServer(residualDataDirectory);
      const residualBlocked = await fetch(`${origin}/api/health/ready`);
      expect(residualBlocked.status).toBe(503);
      expect(await residualBlocked.json()).toMatchObject({
        code: "DATABASE_FILE_INVALID",
      });
      expect(await directoryFingerprint(residualDataDirectory)).toEqual(
        beforeResidualStartup,
      );
      expect(await readdir(residualDataDirectory)).not.toContain(
        "unboundry.sqlite",
      );
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("liveness stays process-only while readiness verifies the current schema without creating data", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-health-"));
  const missingDataDirectory = join(testRoot, "missing-data");
  let server: ChildProcess | undefined;
  try {
    server = await startServer(missingDataDirectory);
    const live = await fetch(`${origin}/api/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: "live" });

    const notReady = await fetch(`${origin}/api/health/ready`);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({
      code: "DATABASE_DIRECTORY_INVALID",
    });
    await expectMissing(missingDataDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("exact production historic schema-37 SQL is bridge and final compatible", async () => {
  const inspectionRoot = await mkdtemp(
    join(tmpdir(), "unboundry-m81-production-schema37-"),
  );
  const databasePath = join(inspectionRoot, "unboundry.sqlite");
  let database: DatabaseSync | undefined;
  try {
    database = initializePrivateSyntheticSchema(inspectionRoot, 37);
    const semanticsBefore = Object.freeze({
      asset_history: tablePragmaFingerprint(database, "asset_history"),
      provider_profiles: tablePragmaFingerprint(database, "provider_profiles"),
    });

    rewriteTableSchemaSql(
      database,
      "asset_history",
      productionHistoricAssetHistorySql,
    );
    rewriteTableSchemaSql(
      database,
      "provider_profiles",
      productionHistoricProviderProfilesSql,
    );

    for (const tableName of ["asset_history", "provider_profiles"] as const) {
      expect(tableSchemaSqlHash(database, tableName)).toBe(
        productionHistoricTableSqlHashes[tableName],
      );
      expect(tablePragmaFingerprint(database, tableName)).toBe(
        semanticsBefore[tableName],
      );
    }
    expect(database.prepare("PRAGMA integrity_check").all()).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(databaseMatchesFrozenSchema37Contract(database)).toBe(true);
    database.close();
    database = undefined;

    expect(inspectBackupDatabase(databasePath, inspectionRoot)).toMatchObject({
      foreignKeyViolations: 0,
      integrityCheck: "ok",
      userVersion: 37,
    });

    database = new DatabaseSync(databasePath);
    database.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(database, {
      sourceVersion: 37,
      targetVersion: 38,
    });
    database.exec("COMMIT");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(databaseMatchesFrozenSchema38Contract(database)).toBe(true);
    database.close();
    database = undefined;

    expect(inspectBackupDatabase(databasePath, inspectionRoot)).toMatchObject({
      foreignKeyViolations: 0,
      integrityCheck: "ok",
      userVersion: 38,
    });

    database = new DatabaseSync(databasePath);
    database.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(database, { sourceVersion: 38 });
    database.exec("COMMIT");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(databaseMatchesSchemaContract(database)).toBe(true);
    for (const tableName of ["asset_history", "provider_profiles"] as const) {
      expect(tableSchemaSqlHash(database, tableName)).toBe(
        productionHistoricTableSqlHashes[tableName],
      );
      expect(tablePragmaFingerprint(database, tableName)).toBe(
        semanticsBefore[tableName],
      );
    }
    database.close();
    database = undefined;

    expect(inspectBackupDatabase(databasePath, inspectionRoot)).toMatchObject({
      foreignKeyViolations: 0,
      integrityCheck: "ok",
      userVersion: currentSchemaVersion,
    });
  } finally {
    database?.close();
    await rm(inspectionRoot, { force: true, recursive: true });
  }
});

test("near-miss and semantic variants of production schema SQL stay rejected", async () => {
  const testRoot = await mkdtemp(
    join(tmpdir(), "unboundry-m81-production-schema37-near-miss-"),
  );
  const fixtures = [
    {
      acceptedHashes: [
        "700ecc72764b59b1bcd84eb921cab728e5f66e8c4f2affd70a41e6a51aade6c6",
        productionHistoricTableSqlHashes.asset_history,
      ],
      name: "asset-whitespace",
      nearMissSql: productionHistoricAssetHistorySql.replace(
        "      account_id TEXT NOT NULL",
        "       account_id TEXT NOT NULL",
      ),
      preservesPragmas: true,
      tableName: "asset_history",
    },
    {
      acceptedHashes: [
        "5a123ee9694b90e7bfb5cd43bcb4df3b00a367ac25974f48052068b178085809",
        productionHistoricTableSqlHashes.provider_profiles,
      ],
      name: "provider-whitespace",
      nearMissSql: productionHistoricProviderProfilesSql.replace(
        "catalog_diagnostics TEXT NOT NULL",
        "catalog_diagnostics  TEXT NOT NULL",
      ),
      preservesPragmas: true,
      tableName: "provider_profiles",
    },
    {
      acceptedHashes: [
        "700ecc72764b59b1bcd84eb921cab728e5f66e8c4f2affd70a41e6a51aade6c6",
        productionHistoricTableSqlHashes.asset_history,
      ],
      name: "asset-nullable-account",
      nearMissSql: productionHistoricAssetHistorySql.replace(
        "account_id TEXT NOT NULL",
        "account_id TEXT",
      ),
      preservesPragmas: false,
      tableName: "asset_history",
    },
    {
      acceptedHashes: [
        "5a123ee9694b90e7bfb5cd43bcb4df3b00a367ac25974f48052068b178085809",
        productionHistoricTableSqlHashes.provider_profiles,
      ],
      name: "provider-disabled-json-check",
      nearMissSql: productionHistoricProviderProfilesSql.replace(
        "CHECK (json_valid(catalog_diagnostics))",
        "CHECK (1)",
      ),
      preservesPragmas: true,
      tableName: "provider_profiles",
    },
  ] as const;

  try {
    for (const fixture of fixtures) {
      const inspectionRoot = join(testRoot, fixture.name);
      const databasePath = join(inspectionRoot, "unboundry.sqlite");
      await mkdir(inspectionRoot, { mode: 0o700 });
      let database: DatabaseSync | undefined;
      try {
        database = initializePrivateSyntheticSchema(inspectionRoot, 37);
        const semanticsBefore = tablePragmaFingerprint(
          database,
          fixture.tableName,
        );
        rewriteTableSchemaSql(
          database,
          fixture.tableName,
          fixture.nearMissSql,
        );
        const semanticsAfter = tablePragmaFingerprint(
          database,
          fixture.tableName,
        );
        if (fixture.preservesPragmas) {
          expect(semanticsAfter).toBe(semanticsBefore);
        } else {
          expect(semanticsAfter).not.toBe(semanticsBefore);
        }
        expect(fixture.acceptedHashes).not.toContain(
          tableSchemaSqlHash(database, fixture.tableName),
        );
        expect(database.prepare("PRAGMA integrity_check").all()).toEqual([
          { integrity_check: "ok" },
        ]);
        expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(databaseMatchesFrozenSchema37Contract(database)).toBe(false);
        database.close();
        database = undefined;
        expectBackupSchemaRejected(databasePath, inspectionRoot);

        database = new DatabaseSync(databasePath);
        database.exec("BEGIN IMMEDIATE");
        applyPendingSchemaMigrationsInTransaction(database, {
          sourceVersion: 37,
          targetVersion: 38,
        });
        database.exec("COMMIT");
        expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(databaseMatchesFrozenSchema38Contract(database)).toBe(false);
        database.close();
        database = undefined;
        expectBackupSchemaRejected(databasePath, inspectionRoot);

        database = new DatabaseSync(databasePath);
        database.exec("BEGIN IMMEDIATE");
        applyPendingSchemaMigrationsInTransaction(database, {
          sourceVersion: 38,
        });
        database.exec("COMMIT");
        expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(databaseMatchesSchemaContract(database)).toBe(false);
        database.close();
        database = undefined;
        expectBackupSchemaRejected(databasePath, inspectionRoot);
      } finally {
        database?.close();
      }
    }
  } finally {
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("bridge schema-37 routing and exact schema-38 startup never run implicit migration work", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-schema37-role-"));
  const dataDirectory = join(testRoot, "data");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const schema38Directory = join(testRoot, "schema38-data");
  const schema38Path = join(schema38Directory, "unboundry.sqlite");
  const schema38LatchDirectory = join(testRoot, "schema38-latch-data");
  const schema38LatchPath = join(schema38LatchDirectory, "unboundry.sqlite");
  const hotWalSource = join(testRoot, "hot-wal-source");
  const hotWalTarget = join(testRoot, "hot-wal-target");
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(dataDirectory);
    const database = openAppDatabase(dataDirectory);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm81-schema37-owner', 'm81-schema37-owner', 'M81 schema 37 owner',
        'fixture-only', 'user', 'active',
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      )
    `).run();
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at
      ) VALUES (
        'm81-schema37-owner', 'm81-schema37-project',
        'Preserved schema 37 project', 37, 1, 37
      )
    `).run();
    rollbackMigration39To38(database);
    rollbackMigration38To37(database);
    expect(databaseMatchesFrozenSchema37Contract(database)).toBe(true);
    database.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA journal_mode = DELETE;
    `);
    database.close();

    await expectMissing(`${databasePath}-journal`);
    await expectMissing(`${databasePath}-wal`);
    await expectMissing(`${databasePath}-shm`);
    const beforeDeleteProbe = await directoryFingerprint(dataDirectory);
    expect(inspectLegacyActiveGenerationTasks(
      dataDirectory,
      "ACTIVE_PRELAUNCH",
    )).toBe(0);
    expect(inspectLegacyMediaMetadataComplete(
      dataDirectory,
      "MEDIA_STANDALONE",
    )).toBe(true);
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDeleteProbe);

    await writeFile(`${databasePath}-wal`, new Uint8Array(), { mode: 0o600 });
    await writeFile(`${databasePath}-shm`, new Uint8Array(), { mode: 0o600 });
    const beforeImmutableZeroWalProbe = await directoryFingerprint(dataDirectory);
    expect(inspectLegacyActiveGenerationTasks(
      dataDirectory,
      "ACTIVE_PRELAUNCH",
    )).toBe(0);
    expect(await directoryFingerprint(dataDirectory)).toEqual(
      beforeImmutableZeroWalProbe,
    );
    await rm(`${databasePath}-wal`);
    await rm(`${databasePath}-shm`);

    const liveWriter = new DatabaseSync(databasePath, { timeout: 5_000 });
    try {
      liveWriter.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA wal_autocheckpoint = 0;
      `);
      liveWriter.prepare(`
        UPDATE project_metadata SET title = ? WHERE id = ?
      `).run("Preserved schema 37 project in WAL", "m81-schema37-project");
      expect((await stat(`${databasePath}-wal`)).size).toBeGreaterThan(0);
      const beforeLiveWalDatabase = await sha256(databasePath);
      const beforeLiveWal = await sha256(`${databasePath}-wal`);
      const beforeLiveWalEntries = (await readdir(dataDirectory)).sort();
      expect(inspectLegacyActiveGenerationTasks(
        dataDirectory,
        "ACTIVE_POST_WARMUP",
      )).toBe(0);
      expect(inspectLegacyActiveGenerationTasks(
        dataDirectory,
        "ACTIVE_SHUTDOWN",
        {
          settleStableWalTimestamp: true,
          stableWalDeadlineAt: Date.now() + 5_000,
        },
      )).toBe(0);
      expect(inspectLegacyMediaMetadataComplete(
        dataDirectory,
        "MEDIA_POST_WARMUP",
      )).toBe(true);
      expect(await sha256(databasePath)).toBe(beforeLiveWalDatabase);
      expect(await sha256(`${databasePath}-wal`)).toBe(beforeLiveWal);
      expect((await readdir(dataDirectory)).sort()).toEqual(beforeLiveWalEntries);
    } finally {
      try {
        liveWriter.prepare(`
          UPDATE project_metadata SET title = ? WHERE id = ?
        `).run("Preserved schema 37 project", "m81-schema37-project");
      } finally {
        liveWriter.close();
      }
    }
    const deleteMode = new DatabaseSync(databasePath);
    try {
      deleteMode.exec(`
        PRAGMA wal_checkpoint(TRUNCATE);
        PRAGMA journal_mode = DELETE;
      `);
    } finally {
      deleteMode.close();
    }

    const beforeSchema37Classification = await directoryFingerprint(
      dataDirectory,
    );
    const finalSchema37Lifecycle = createRuntimeLifecycle({
      dataDirectory,
      legacyStandbyDatabaseGuard: databaseMatchesFrozenSchema37Contract,
      logger: () => undefined,
    });
    const exactSchema37Probe = finalSchema37Lifecycle.probeDatabase();
    expect(exactSchema37Probe).toEqual({
      ok: true,
      schemaVersion: 37,
      standby: true,
    });
    // The checked-out package is the v0.5.2 bridge candidate. An active exact
    // schema-37 process therefore delegates to the attested v0.5.1 engine; it
    // must not be launched here and mislabelled as a v0.6 final standby. m92
    // owns that exact bridge process plus the explicit final-standby lifecycle
    // contract, while m10 owns the artifact-bound bridge -> migration -> final
    // sequence. Keep only the role-independent final lifecycle latch here.
    expect(bridgeRuntimeMode({
      probe: exactSchema37Probe,
      releaseRole: "bridge",
      runtimeRole: "active",
    })).toBe("legacy-schema37");
    expect(bridgeRuntimeMode({
      probe: exactSchema37Probe,
      releaseRole: "final",
      runtimeRole: "active",
    })).toBe("current");
    expect(
      finalSchema37Lifecycle.observeStartupDatabaseProbe(exactSchema37Probe),
    ).toBe(false);
    expect(await directoryFingerprint(dataDirectory)).toEqual(
      beforeSchema37Classification,
    );

    const damagedForeignKey = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: false,
    });
    damagedForeignKey.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, expires_at, created_at, last_seen_at
      ) VALUES (
        'm81-schema37-orphan-session', 'm81-schema37-orphan-token',
        'm81-schema37-missing-user', '2099-01-01T00:00:00.000Z',
        '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z'
      )
    `).run();
    expect(damagedForeignKey.prepare("PRAGMA foreign_key_check").all())
      .toMatchObject([{
        parent: "users",
        table: "sessions",
      }]);
    damagedForeignKey.close();
    const beforeForeignKeyProbe = await directoryFingerprint(dataDirectory);
    const damagedSchema37Lifecycle = createRuntimeLifecycle({
      dataDirectory,
      legacyStandbyDatabaseGuard: databaseMatchesFrozenSchema37Contract,
      logger: () => undefined,
    });
    expect(damagedSchema37Lifecycle.probeDatabase()).toEqual({
      code: "DATABASE_INTEGRITY_FAILED",
      ok: false,
    });
    expect(await lifecycleReadiness(damagedSchema37Lifecycle)).toMatchObject({
      body: { code: "DATABASE_INTEGRITY_FAILED" },
      status: 503,
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(
      beforeForeignKeyProbe,
    );
    const repairForeignKey = new DatabaseSync(databasePath);
    repairForeignKey.exec(`
      DELETE FROM sessions WHERE id = 'm81-schema37-orphan-session'
    `);
    repairForeignKey.close();

    const fixtureMigration = new DatabaseSync(databasePath);
    fixtureMigration.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(fixtureMigration, {
      sourceVersion: 37,
    });
    fixtureMigration.exec("COMMIT");
    fixtureMigration.close();

    const migrated = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(migrated.prepare("PRAGMA user_version").get()).toEqual({
        user_version: currentSchemaVersion,
      });
      expect(migrated.prepare(`
        SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1
      `).get()).toEqual(currentSchemaManifest.at(-1));
      expect(migrated.prepare(`
        SELECT title, updated_at FROM project_metadata
        WHERE owner_id = 'm81-schema37-owner'
          AND id = 'm81-schema37-project'
      `).get()).toEqual({
        title: "Preserved schema 37 project",
        updated_at: 37,
      });
      expect(migrated.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
    } finally {
      migrated.close();
    }

    await mkdir(schema38Directory);
    const exact38 = openAppDatabase(schema38Directory);
    exact38.exec(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES
        (
          'm81-schema38-owner', 'm81-schema38-owner', 'M81 schema 38 owner',
          'fixture-only', 'user', 'active',
          '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z'
        ),
        (
          'm81-schema38-deleted-key-owner',
          'm81-schema38-deleted-key-owner',
          'M81 schema 38 deleted key owner', 'fixture-only', 'user', 'active',
          '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z'
        );
      INSERT INTO provider_profiles (
        id, display_name, driver, status, created_at, updated_at
      ) VALUES (
        'm81-schema38-provider', 'M81 schema 38 provider', 'openrouter',
        'enabled', '2026-08-11T00:00:00.000Z',
        '2026-08-11T00:00:00.000Z'
      );
      INSERT INTO account_provider_credentials (
        account_id, provider_profile_id, encrypted_key, key_status,
        credential_version, updated_at
      ) VALUES (
        'm81-schema38-owner', 'm81-schema38-provider', 'fixture-only',
        'unchecked', 7, '2026-08-11T00:00:00.000Z'
      );
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
        request_fingerprint, state, attempt, created_at, updated_at, owner_id,
        provider_profile_id, provider_model_id, provider_task_id,
        model_configuration, credential_revision
      ) VALUES (
        'm81-schema38-task', 'm81-schema38-canvas', 'm81-schema38-node',
        'image', 'preserve exact schema 38 migration evidence', '{}',
        'm81-schema38-key', 'm81-schema38-fingerprint', 'success', 3,
        '2026-08-11T00:00:00.000Z', '2026-08-11T00:03:00.000Z',
        'm81-schema38-owner', 'm81-schema38-provider',
        'm81-schema38-model', 'm81-schema38-provider-task',
        '{"credentialVersion":7}', 7
      ), (
        'm81-schema38-gap-task', 'm81-schema38-gap-canvas',
        'm81-schema38-gap-node', 'image',
        'block an unresolved older schema 38 paid attempt', '{}',
        'm81-schema38-gap-key', 'm81-schema38-gap-fingerprint', 'failed', 2,
        '2026-08-11T00:04:00.000Z', '2026-08-11T00:06:00.000Z',
        'm81-schema38-owner', 'm81-schema38-provider',
        'm81-schema38-model', NULL, '{"credentialVersion":7}', 7
      ), (
        'm81-schema38-high-water-task', 'm81-schema38-high-water-canvas',
        'm81-schema38-high-water-node', 'image',
        'preserve a revision newer than the current schema 38 credential', '{}',
        'm81-schema38-high-water-key', 'm81-schema38-high-water-fingerprint',
        'failed', 1, '2026-08-11T00:07:00.000Z',
        '2026-08-11T00:08:00.000Z', 'm81-schema38-owner',
        'm81-schema38-provider', 'm81-schema38-model', NULL,
        '{"credentialVersion":11}', 11
      ), (
        'm81-schema38-deleted-key-task',
        'm81-schema38-deleted-key-canvas', 'm81-schema38-deleted-key-node',
        'image', 'preserve the high water after a credential was deleted',
        '{}', 'm81-schema38-deleted-key',
        'm81-schema38-deleted-key-fingerprint', 'failed', 1,
        '2026-08-11T00:09:00.000Z', '2026-08-11T00:10:00.000Z',
        'm81-schema38-deleted-key-owner', 'm81-schema38-provider',
        'm81-schema38-model', NULL, '{"credentialVersion":13}', 13
      ), (
        'm81-schema38-invalid-key-task',
        'm81-schema38-invalid-key-canvas', 'm81-schema38-invalid-key-node',
        'image', 'malformed historical JSON must not lower the safe high water',
        '{}', 'm81-schema38-invalid-key',
        'm81-schema38-invalid-key-fingerprint', 'failed', 1,
        '2026-08-11T00:11:00.000Z', '2026-08-11T00:12:00.000Z',
        'm81-schema38-owner', 'm81-schema38-provider',
        'm81-schema38-model', NULL, '{}', 0
      );
      INSERT INTO generation_task_events (
        id, task_id, state, error_code, created_at
      ) VALUES (
        41, 'm81-schema38-task', 'success', NULL,
        '2026-08-11T00:03:00.000Z'
      ), (
        42, 'm81-schema38-gap-task', 'failed', NULL,
        '2026-08-11T00:06:00.000Z'
      ), (
        43, 'm81-schema38-high-water-task', 'failed', 'AUTH',
        '2026-08-11T00:08:00.000Z'
      ), (
        44, 'm81-schema38-deleted-key-task', 'failed', 'AUTH',
        '2026-08-11T00:10:00.000Z'
      );
      UPDATE generation_tasks
      SET error_code = 'AUTH', error_message = 'historical credential rejected'
      WHERE id IN (
        'm81-schema38-high-water-task',
        'm81-schema38-deleted-key-task'
      );
      INSERT INTO generation_provider_attempts (
        id, task_id, execution_attempt, provider_profile_id,
        provider_model_id, kind, evidence, created_at, owner_id,
        credential_revision, outcome, provider_task_id, finished_at
      ) VALUES
        (
          51, 'm81-schema38-task', 1, 'm81-schema38-provider',
          'm81-schema38-model', 'image', 'provider-boundary',
          '2026-08-11T00:01:00.000Z', 'm81-schema38-owner', 7,
          'outcome-unknown', NULL, NULL
        ),
        (
          52, 'm81-schema38-task', 2, 'm81-schema38-provider',
          'm81-schema38-model', 'image', 'provider-boundary',
          '2026-08-11T00:02:00.000Z', 'm81-schema38-owner', 7,
          'completed', 'm81-schema38-provider-task',
          '2026-08-11T00:03:00.000Z'
        ),
        (
          53, 'm81-schema38-gap-task', 1, 'm81-schema38-provider',
          'm81-schema38-model', 'image', 'provider-boundary',
          '2026-08-11T00:05:00.000Z', 'm81-schema38-owner', 7,
          'outcome-unknown', NULL, NULL
        ),
        (
          54, 'm81-schema38-high-water-task', 1,
          'm81-schema38-provider', 'm81-schema38-model', 'image',
          'provider-boundary', '2026-08-11T00:07:00.000Z',
          'm81-schema38-owner', 11, 'definitive-rejected', NULL,
          '2026-08-11T00:08:00.000Z'
        ),
        (
          55, 'm81-schema38-deleted-key-task', 1,
          'm81-schema38-provider', 'm81-schema38-model', 'image',
          'provider-boundary', '2026-08-11T00:09:00.000Z',
          'm81-schema38-deleted-key-owner', 13, 'definitive-rejected', NULL,
          '2026-08-11T00:10:00.000Z'
        );
      UPDATE sqlite_sequence SET seq = 91
      WHERE name = 'generation_task_events';
      UPDATE sqlite_sequence SET seq = 92
      WHERE name = 'generation_provider_attempts';
    `);
    rollbackMigration39To38(exact38);
    exact38.prepare(`
      UPDATE generation_tasks
      SET model_configuration = '{not-json'
      WHERE id = 'm81-schema38-invalid-key-task'
    `).run();
    expect(databaseMatchesFrozenSchema38Contract(exact38)).toBe(true);
    expect(exact38.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(exact38.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 38,
    });
    expect(exact38.prepare(`
      SELECT name, seq FROM sqlite_sequence
      WHERE name IN ('generation_task_events', 'generation_provider_attempts')
      ORDER BY name
    `).all()).toEqual([
      { name: "generation_provider_attempts", seq: 92 },
      { name: "generation_task_events", seq: 91 },
    ]);
    exact38.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA journal_mode = DELETE;
    `);
    exact38.close();

    await mkdir(schema38LatchDirectory);
    await copyFile(schema38Path, schema38LatchPath);
    server = await startServer(schema38LatchDirectory, {
      waitPath: "/api/health/live",
    });
    const schema38LatchInitial = await fetch(`${origin}/api/health/ready`);
    expect(schema38LatchInitial.status).toBe(503);
    expect(await schema38LatchInitial.json()).toMatchObject({
      code: "SERVICE_RESTART_REQUIRED",
      mode: "schema39-restart-required",
      mutationsAccepted: false,
    });
    const schema38LatchMigration = new DatabaseSync(schema38LatchPath);
    schema38LatchMigration.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(schema38LatchMigration, {
      sourceVersion: 38,
    });
    schema38LatchMigration.exec("COMMIT");
    schema38LatchMigration.close();
    const schema38LatchReady = await fetch(`${origin}/api/health/ready`);
    expect(schema38LatchReady.status).toBe(503);
    expect(await schema38LatchReady.json()).toMatchObject({
      code: "SERVICE_RESTART_REQUIRED",
      mode: "schema39-restart-required",
      mutationsAccepted: false,
    });
    await stopServer(server);
    server = undefined;

    const beforeSchema38Default = await directoryFingerprint(schema38Directory);
    server = await startServer(schema38Directory, {
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: undefined },
    });
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const schema38DefaultReady = await fetch(`${origin}/api/health/ready`);
    expect(schema38DefaultReady.status).toBe(503);
    expect(await schema38DefaultReady.json()).toMatchObject({
      code: "SERVICE_RESTART_REQUIRED",
      mode: "schema39-restart-required",
      mutationsAccepted: false,
    });
    expect(await directoryFingerprint(schema38Directory)).toEqual(
      beforeSchema38Default,
    );
    await stopServer(server);
    server = undefined;

    await expect(startServer(schema38Directory, {
      captureOutput: true,
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: "1" },
    })).rejects.toThrow(
      "UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION is retired; use the one-shot schema migration CLI",
    );
    expect(await directoryFingerprint(schema38Directory)).toEqual(
      beforeSchema38Default,
    );

    const schema38FixtureMigration = new DatabaseSync(schema38Path);
    schema38FixtureMigration.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(schema38FixtureMigration, {
      sourceVersion: 38,
    });
    schema38FixtureMigration.exec("COMMIT");
    schema38FixtureMigration.close();

    const migrated38 = new DatabaseSync(schema38Path, { readOnly: true });
    try {
      expect(migrated38.prepare("PRAGMA user_version").get()).toEqual({
        user_version: currentSchemaVersion,
      });
      expect(migrated38.prepare(`
        SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1
      `).get()).toEqual({
        name: "server-authoritative-workflow-runs",
        version: 42,
      });
      expect(migrated38.prepare(`
        SELECT credential_revision FROM account_provider_credential_epochs
        WHERE account_id = 'm81-schema38-owner'
          AND provider_profile_id = 'm81-schema38-provider'
      `).get()).toEqual({ credential_revision: 11 });
      expect(migrated38.prepare(`
        SELECT credential_revision FROM account_provider_credential_epochs
        WHERE account_id = 'm81-schema38-deleted-key-owner'
          AND provider_profile_id = 'm81-schema38-provider'
      `).get()).toEqual({ credential_revision: 13 });
      expect(migrated38.prepare(`
        SELECT credential_revision FROM generation_tasks
        WHERE id = 'm81-schema38-invalid-key-task'
      `).get()).toEqual({ credential_revision: 0 });
      expect(migrated38.prepare(`
        SELECT attempt, credential_revision, provider_task_id, state
        FROM generation_tasks WHERE id = 'm81-schema38-task'
      `).get()).toEqual({
        attempt: 3,
        credential_revision: 7,
        provider_task_id: "m81-schema38-provider-task",
        state: "success",
      });
      expect(migrated38.prepare(`
        SELECT
          execution_attempt, credential_revision, outcome, provider_task_id,
          failure_code, finished_at
        FROM generation_provider_attempts
        WHERE task_id = 'm81-schema38-task'
        ORDER BY execution_attempt
      `).all()).toEqual([
        {
          credential_revision: 7,
          execution_attempt: 1,
          failure_code: null,
          finished_at: null,
          outcome: "outcome-unknown",
          provider_task_id: null,
        },
        {
          credential_revision: 7,
          execution_attempt: 2,
          failure_code: null,
          finished_at: "2026-08-11T00:03:00.000Z",
          outcome: "completed",
          provider_task_id: "m81-schema38-provider-task",
        },
      ]);
      expect(migrated38.prepare(`
        SELECT COUNT(*) AS count FROM generation_admission_events
      `).get()).toEqual({ count: 0 });
      expect(migrated38.prepare(`
        SELECT attempt, credential_revision, provider_task_id, state
        FROM generation_tasks WHERE id = 'm81-schema38-gap-task'
      `).get()).toEqual({
        attempt: 2,
        credential_revision: 7,
        provider_task_id: null,
        state: "failed",
      });
      expect(migrated38.prepare(`
        SELECT execution_attempt, outcome, provider_task_id
        FROM generation_provider_attempts
        WHERE task_id = 'm81-schema38-gap-task'
      `).get()).toEqual({
        execution_attempt: 1,
        outcome: "outcome-unknown",
        provider_task_id: null,
      });
      expect(migrated38.prepare(`
        SELECT name, seq FROM sqlite_sequence
        WHERE name IN ('generation_task_events', 'generation_provider_attempts')
        ORDER BY name
      `).all()).toEqual([
        { name: "generation_provider_attempts", seq: 92 },
        { name: "generation_task_events", seq: 91 },
      ]);
      const providerAttemptsAfterMigration = migrated38.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get() as { count: number };
      // Every paid Provider boundary is journaled first. The explicit schema
      // role preserving all five rows is deterministic Provider=0 proof.
      expect(providerAttemptsAfterMigration).toEqual({ count: 5 });
      expect(migrated38.prepare(`
        SELECT owner_id, credential_revision, outcome
        FROM generation_provider_attempts
        WHERE task_id IN (
          'm81-schema38-high-water-task',
          'm81-schema38-deleted-key-task'
        )
        ORDER BY credential_revision
      `).all()).toEqual([
        {
          credential_revision: 11,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-owner",
        },
        {
          credential_revision: 13,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-deleted-key-owner",
        },
      ]);
      expect(migrated38.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      migrated38.close();
    }

    const previousDataDirectory = process.env.UNBOUNDRY_DATA_DIR;
    process.env.UNBOUNDRY_DATA_DIR = schema38Directory;
    const migratedCredentials = new DatabaseSync(schema38Path);
    migratedCredentials.exec("PRAGMA foreign_keys = ON");
    try {
      await expect(saveAccountCredential(
        migratedCredentials,
        "m81-schema38-owner",
        "m81-schema38-provider",
        "m81-schema38-rotated-key-12",
      )).resolves.toMatchObject({ credentialVersion: 12 });
      await expect(saveAccountCredential(
        migratedCredentials,
        "m81-schema38-deleted-key-owner",
        "m81-schema38-provider",
        "m81-schema38-readded-key-14",
      )).resolves.toMatchObject({ credentialVersion: 14 });
      expect(migratedCredentials.prepare(`
        SELECT account_id, credential_revision
        FROM account_provider_credential_epochs
        WHERE provider_profile_id = 'm81-schema38-provider'
        ORDER BY account_id
      `).all()).toEqual([
        {
          account_id: "m81-schema38-deleted-key-owner",
          credential_revision: 14,
        },
        { account_id: "m81-schema38-owner", credential_revision: 12 },
      ]);
      expect(migratedCredentials.prepare(`
        SELECT owner_id, credential_revision, outcome
        FROM generation_provider_attempts
        WHERE task_id IN (
          'm81-schema38-high-water-task',
          'm81-schema38-deleted-key-task'
        )
        ORDER BY credential_revision
      `).all()).toEqual([
        {
          credential_revision: 11,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-owner",
        },
        {
          credential_revision: 13,
          outcome: "definitive-rejected",
          owner_id: "m81-schema38-deleted-key-owner",
        },
      ]);
    } finally {
      migratedCredentials.close();
      if (previousDataDirectory === undefined) {
        delete process.env.UNBOUNDRY_DATA_DIR;
      } else {
        process.env.UNBOUNDRY_DATA_DIR = previousDataDirectory;
      }
    }

    const migratedStore = createGenerationTaskStore(schema38Directory);
    try {
      const retryTask = migratedStore.get("m81-schema38-gap-task")!;
      const retryInputKey = "m81-schema38-gap-input-key";
      const retryOwnershipKey = "m81-schema38-gap-ownership-key";
      const retryCanvasRevision = 1;
      const retryCanvas = openAppDatabase(schema38Directory);
      try {
        retryCanvas.prepare(`
          INSERT INTO canvas_documents (
            owner_id, id, revision, graph_revision, nodes, edges, viewport,
            updated_at, save_session_id, save_sequence
          ) VALUES (?, ?, 1, ?, ?, '[]', '{}', ?, NULL, 0)
        `).run(
          retryTask.ownerId!,
          retryTask.canvasId,
          retryCanvasRevision,
          JSON.stringify([{
            data: {
              imageGenerationInputKey: retryInputKey,
              imageGenerationOwnershipKey: retryOwnershipKey,
              imageGenerationTaskId: retryTask.id,
            },
            id: retryTask.nodeId,
            type: retryTask.kind,
          }]),
          retryTask.updatedAt,
        );
      } finally {
        retryCanvas.close();
      }
      expect(
        migratedStore.hasUnsafeProviderAttemptForNewPaidRetry(
          "m81-schema38-gap-task",
        ),
      ).toBe(true);
      expect(() => migratedStore.admitRetry({
        canvasId: retryTask.canvasId,
        expectedAttempt: retryTask.attempt,
        expectedCanvasRevision: retryCanvasRevision,
        expectedFixtureScopeId: "",
        expectedGenerationInputKey: retryInputKey,
        expectedGenerationOwnershipKey: retryOwnershipKey,
        expectedModelConfigurationRevision: "m81-legacy-config",
        expectedModelInputContractFingerprint: "mic2:m81-legacy-contract",
        expectedModelReleaseRevision: "00000000-0000-4000-8000-000000000081",
        expectedUpdatedAt: retryTask.updatedAt,
        kind: retryTask.kind,
        mode: "new-paid-attempt",
        nodeId: retryTask.nodeId,
        snapshot: {
          credentialRevision: 7,
          modelConfiguration: {},
          providerModelId: "m81-schema38-model",
          providerProfileId: "m81-schema38-provider",
        },
        taskId: "m81-schema38-gap-task",
      })).toThrow(GenerationTaskRetryFenceError);
    } finally {
      migratedStore.close();
    }
    const afterBlockedRetry = new DatabaseSync(schema38Path, { readOnly: true });
    try {
      expect(afterBlockedRetry.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 5 });
    } finally {
      afterBlockedRetry.close();
    }

    await Promise.all([mkdir(hotWalSource), mkdir(hotWalTarget)]);
    writer = openAppDatabase(hotWalSource);
    rollbackMigration39To38(writer);
    rollbackMigration38To37(writer);
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    writer.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      ) VALUES (
        'm81-hot-wal-owner', 'm81-hot-wal-owner', 'M81 hot WAL owner',
        'fixture-only', 'user', 'active',
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      )
    `).run();
    const hotWalSourcePath = join(hotWalSource, "unboundry.sqlite");
    const hotWalTargetPath = join(hotWalTarget, "unboundry.sqlite");
    expect((await stat(`${hotWalSourcePath}-wal`)).size).toBeGreaterThan(0);
    await copyFile(hotWalSourcePath, hotWalTargetPath);
    await copyFile(`${hotWalSourcePath}-wal`, `${hotWalTargetPath}-wal`);
    await expectMissing(`${hotWalTargetPath}-shm`);
    const beforeUnsafeMigration = await directoryFingerprint(hotWalTarget);

    server = await startServer(hotWalTarget, {
      environment: { UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION: undefined },
    });
    const unsafeReady = await fetch(`${origin}/api/health/ready`);
    expect(unsafeReady.status).toBe(503);
    expect(await unsafeReady.json()).toMatchObject({
      code: "DATABASE_FILE_UNAVAILABLE",
    });
    expect(await directoryFingerprint(hotWalTarget)).toEqual(
      beforeUnsafeMigration,
    );
  } finally {
    if (server) await stopServer(server);
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("server configure waits for media-only startup recovery before liveness is reachable", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-media-recovery-"));
  let server: ChildProcess | undefined;
  const ownerId = "m81-startup-recovery-owner";
  const assetId = "m81-startup-unadopted-upload";
  const storageName = `${assetId}.png`;
  const bytes = Buffer.from("m81 startup recovery exact local object");
  const digest = createHash("sha256").update(bytes).digest("hex");
  try {
    const database = openAppDatabase(dataDirectory);
    try {
      const timestamp = new Date().toISOString();
      const oldTimestamp = "2000-01-01T00:00:00.000Z";
      database.prepare(`
        INSERT INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        ) VALUES (?, ?, 'M81 startup owner', 'fixture-only', 'user', 'active', ?, ?)
      `).run(ownerId, ownerId, timestamp, timestamp);
      database.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, storage_profile_id, object_key, content_type,
          checksum_sha256, storage_status, duration_seconds, duration_source,
          duration_status, media_width, media_height
        ) VALUES (
          'image', ?, ?, ?, ?, ?, ?, 'local', NULL, ?, 'image/png', ?,
          'ready', NULL, NULL, 'not-applicable', 2, 3
        )
      `).run(
        assetId,
        ownerId,
        storageName,
        bytes.length,
        oldTimestamp,
        oldTimestamp,
        storageName,
        digest,
      );
      database.prepare(`
        INSERT INTO media_publication_attempts (
          attempt_id, owner_id, kind, asset_id, source, state,
          storage_backend, final_storage_name, object_key, storage_profile_id,
          staging_name, task_id, task_execution_attempt, history_label,
          byte_size, checksum_sha256, content_type, media_width, media_height,
          created_at, updated_at
        ) VALUES (
          'm81-startup-attempt', ?, 'image', ?, 'upload', 'published',
          'local', ?, ?, NULL, '.publication-m81-startup.generating',
          NULL, NULL, NULL, ?, ?, 'image/png', 2, 3, ?, ?
        )
      `).run(
        ownerId,
        assetId,
        storageName,
        storageName,
        bytes.length,
        digest,
        oldTimestamp,
        oldTimestamp,
      );
    } finally {
      database.close();
    }
    await mkdir(join(dataDirectory, "media"), { recursive: true });
    await writeFile(join(dataDirectory, "media", storageName), bytes, {
      flag: "wx",
    });

    server = await startServer(dataDirectory);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    await expectMissing(join(dataDirectory, "media", storageName));
    const recovered = openAppDatabase(dataDirectory);
    try {
      expect(recovered.prepare(`
        SELECT state, error_code, adopted_at
        FROM media_publication_attempts WHERE attempt_id = 'm81-startup-attempt'
      `).get()).toEqual({
        adopted_at: null,
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(recovered.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(ownerId, assetId)).toEqual({ count: 0 });
      expect(recovered.prepare(`
        SELECT state FROM media_delete_intents
        WHERE owner_id = ? AND kind = 'image' AND asset_id = ?
      `).get(ownerId, assetId)).toEqual({ state: "tombstone" });
      expect(recovered.prepare(`
        SELECT COUNT(*) AS count FROM generation_provider_attempts
      `).get()).toEqual({ count: 0 });
    } finally {
      recovered.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("restore-incomplete blocks old media recovery without changing durable evidence", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-restore-incomplete-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const markerPath = join(dataDirectory, ".unboundry-restore-incomplete");
  let server: ChildProcess | undefined;
  try {
    const database = openAppDatabase(dataDirectory);
    const candidate = insertOldLocalUploadCandidate(
      database,
      "m81-restore-incomplete",
    );
    database.close();
    await writeOldLocalUploadCandidate(dataDirectory, candidate);
    await writeFile(markerPath, "restore publication is incomplete", { flag: "wx" });
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      code: "DATABASE_RESTORE_INCOMPLETE",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);

    const preserved = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(preserved.prepare(`
        SELECT publication.state, publication.error_code,
               media.storage_status
        FROM media_publication_attempts AS publication
        JOIN media_assets AS media
          ON media.owner_id = publication.owner_id
          AND media.kind = publication.kind
          AND media.id = publication.asset_id
        WHERE publication.attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: null,
        state: "published",
        storage_status: "ready",
      });
    } finally {
      preserved.close();
    }
    expect(
      await readFile(join(dataDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    await rm(markerPath);
    const beforeDeferredProbe = await directoryFingerprint(dataDirectory);
    const sameProcess = await fetch(`${origin}/api/health/ready`);
    expect(sameProcess.status).toBe(503);
    expect(await sameProcess.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(
      beforeDeferredProbe,
    );
    expect(
      await readFile(join(dataDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    await stopServer(server);
    server = undefined;
    server = await startServer(dataDirectory);
    const recovered = await fetch(`${origin}/api/health/ready`);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: "ready" });
    await expectMissing(join(dataDirectory, "media", candidate.storageName));
    const cleaned = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(cleaned.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
    } finally {
      cleaned.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("failed startup media cleanup stays not-ready until a restart retries it", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-media-blocked-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const mediaDirectory = join(dataDirectory, "media");
  let server: ChildProcess | undefined;
  try {
    const database = openAppDatabase(dataDirectory);
    const candidate = insertOldLocalUploadCandidate(database, "m81-media-blocked");
    database.close();
    await writeOldLocalUploadCandidate(dataDirectory, candidate);
    const stagingDirectory = join(mediaDirectory, candidate.stagingName);
    const stagingBlocker = join(stagingDirectory, "non-empty");
    await mkdir(stagingDirectory);
    await writeFile(stagingBlocker, "force staging cleanup to fail", {
      flag: "wx",
    });

    server = await startServer(dataDirectory);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const blocked = await fetch(`${origin}/api/health/ready`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });

    const durable = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(durable.prepare(`
        SELECT publication.state, publication.error_code,
               media.storage_status
        FROM media_publication_attempts AS publication
        JOIN media_assets AS media
          ON media.owner_id = publication.owner_id
          AND media.kind = publication.kind
          AND media.id = publication.asset_id
        WHERE publication.attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "compensating",
        storage_status: "failed",
      });
    } finally {
      durable.close();
    }
    await expectMissing(join(mediaDirectory, candidate.storageName));
    expect(await readFile(stagingBlocker, "utf8")).toBe(
      "force staging cleanup to fail",
    );

    await stopServer(server);
    server = undefined;
    await rm(stagingDirectory, { force: true, recursive: true });
    server = await startServer(dataDirectory);
    const recovered = await fetch(`${origin}/api/health/ready`);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: "ready" });
    await expectMissing(join(mediaDirectory, candidate.storageName));

    const cleaned = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(cleaned.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(cleaned.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(candidate.ownerId, candidate.assetId)).toEqual({ count: 0 });
    } finally {
      cleaned.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("listening starts one committed queued task while startup gates keep blocked modes Provider-free", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-generation-startup-"));
  const activeDirectory = join(testRoot, "active");
  const oldSchemaDirectory = join(testRoot, "old-schema");
  const restoreDirectory = join(testRoot, "restore-marker");
  const cacheSinkDirectory = join(testRoot, "provider-cache-sink");
  let server: ChildProcess | undefined;
  try {
    const active = await seedQueuedStartupGenerationFixture(
      activeDirectory,
      "m81-startup-active",
    );
    await seedQueuedStartupGenerationFixture(
      oldSchemaDirectory,
      "m81-startup-old",
    );
    await seedQueuedStartupGenerationFixture(
      restoreDirectory,
      "m81-startup-restore",
    );
    await moveProviderFixtureCache(cacheSinkDirectory);
    makeStandaloneDatabase(activeDirectory);
    makeStandaloneDatabase(restoreDirectory);
    const oldSchema = openAppDatabase(oldSchemaDirectory);
    rollbackMigration39To38(oldSchema);
    oldSchema.exec(`
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA journal_mode = DELETE;
    `);
    oldSchema.close();
    await writeFile(
      join(restoreDirectory, ".unboundry-restore-incomplete"),
      "M81 controlled incomplete restore",
      { flag: "wx" },
    );

    const fakeProviderEnvironment = {
      UNBOUNDRY_SAFE_TEST: "1",
      UNBOUNDRY_TEST_GENERATION_STARTUP_FAKE_PROVIDER: "1",
    };
    const activeLog = join(activeDirectory, startupProviderFixtureLogName);
    const activeBeforeMaintenance = await directoryFingerprint(activeDirectory);
    server = await startServer(activeDirectory, {
      environment: {
        ...fakeProviderEnvironment,
        UNBOUNDRY_MAINTENANCE_MODE: "1",
      },
      waitPath: "/api/health/ready",
    });
    const maintenanceReady = await fetch(`${origin}/api/health/ready`);
    expect(maintenanceReady.status).toBe(200);
    expect(await maintenanceReady.json()).toMatchObject({
      mode: "maintenance-api-blocked",
      mutationsAccepted: false,
      status: "ready",
    });
    expect(await directoryFingerprint(activeDirectory)).toEqual(
      activeBeforeMaintenance,
    );
    await expectMissing(activeLog);
    await stopServer(server);
    server = undefined;

    const activeBeforeFailure = await directoryFingerprint(activeDirectory);
    server = await startServer(activeDirectory, {
      environment: {
        ...fakeProviderEnvironment,
        UNBOUNDRY_TEST_GENERATION_STARTUP_FAILURE: "1",
      },
    });
    const failedStartupReady = await fetch(`${origin}/api/health/ready`);
    expect(failedStartupReady.status).toBe(503);
    expect(await failedStartupReady.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(await directoryFingerprint(activeDirectory)).toEqual(
      activeBeforeFailure,
    );
    await expectMissing(activeLog);
    await stopServer(server);
    server = undefined;

    server = await startServer(activeDirectory, {
      environment: fakeProviderEnvironment,
      waitPath: "/api/health/ready",
    });
    const activeReady = await fetch(`${origin}/api/health/ready`);
    expect(activeReady.status).toBe(200);
    expect(await activeReady.json()).toMatchObject({
      databaseProbe: "read-only",
      mode: "active",
      status: "ready",
    });
    const providerRequests = (await readFile(activeLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string; url: string });
    expect(providerRequests).toHaveLength(2);
    expect(providerRequests.filter((request) =>
      request.method === "POST" && request.url.endsWith("/responses")
    )).toEqual([{
      method: "POST",
      url: "https://ark.cn-beijing.volces.com/api/v3/responses",
    }]);
    expect(providerRequests.filter((request) =>
      request.method === "POST" &&
      request.url.includes("/contents/generations/tasks")
    )).toEqual([]);
    expect(providerRequests.filter((request) =>
      request.method === "GET" &&
      request.url.endsWith(`/contents/generations/tasks/${active.providerTaskId}`)
    )).toHaveLength(1);
    const completed = new DatabaseSync(
      join(activeDirectory, "unboundry.sqlite"),
      { readOnly: true },
    );
    try {
      expect(completed.prepare(`
        SELECT attempt, result_text, state
        FROM generation_tasks WHERE id = ?
      `).get(active.taskId)).toEqual({
        attempt: 1,
        result_text: "M81 startup worker fake Provider result",
        state: "success",
      });
      expect(completed.prepare(`
        SELECT execution_attempt, outcome
        FROM generation_provider_attempts WHERE task_id = ?
      `).all(active.taskId)).toEqual([{
        execution_attempt: 1,
        outcome: "completed",
      }]);
      expect(completed.prepare(`
        SELECT error_code, state FROM generation_tasks WHERE id = ?
      `).get(active.acceptedTaskId)).toEqual({
        error_code: "PROVIDER_FAILED",
        state: "failed",
      });
      expect(completed.prepare(`
        SELECT execution_attempt, outcome
        FROM generation_provider_attempts WHERE task_id = ?
      `).all(active.acceptedTaskId)).toEqual([{
        execution_attempt: 1,
        outcome: "provider-failed",
      }]);
      expect(completed.prepare(`
        SELECT error_code, state FROM generation_tasks WHERE id = ?
      `).get(active.preBoundaryTaskId)).toEqual({
        error_code: "SERVICE_RESTARTED",
        state: "failed",
      });
      expect(completed.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts WHERE task_id = ?
      `).get(active.preBoundaryTaskId)).toEqual({ count: 0 });
      expect(completed.prepare(`
        SELECT error_code, state FROM generation_tasks WHERE id = ?
      `).get(active.retryingTaskId)).toEqual({
        error_code: "RETRY_INTERRUPTED",
        state: "failed",
      });
      expect(completed.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts WHERE task_id = ?
      `).get(active.retryingTaskId)).toEqual({ count: 0 });
    } finally {
      completed.close();
    }
    await stopServer(server);
    server = undefined;

    for (const blocked of [
      {
        code: "SERVICE_RESTART_REQUIRED",
        directory: oldSchemaDirectory,
      },
      {
        code: "DATABASE_RESTORE_INCOMPLETE",
        directory: restoreDirectory,
      },
    ]) {
      const log = join(blocked.directory, startupProviderFixtureLogName);
      const before = await directoryFingerprint(blocked.directory);
      server = await startServer(blocked.directory, {
        environment: fakeProviderEnvironment,
      });
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({ code: blocked.code });
      expect(await directoryFingerprint(blocked.directory)).toEqual(before);
      await expectMissing(log);
      if (blocked.directory === restoreDirectory) {
        await rm(join(restoreDirectory, ".unboundry-restore-incomplete"));
        const sameProcess = await fetch(`${origin}/api/health/ready`);
        expect(sameProcess.status).toBe(503);
        expect(await sameProcess.json()).toMatchObject({
          code: "DATABASE_UNAVAILABLE",
        });
        await expectMissing(log);
      }
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("listening installs allowlisted terminal detach when no generation task is active", async () => {
  const fixtureId = "m81-idle-terminal-detach";
  const dataDirectory = await mkdtemp(
    join(tmpdir(), "unboundry-m81-idle-terminal-detach-"),
  );
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const providerLog = join(dataDirectory, startupProviderFixtureLogName);
  let server: ChildProcess | undefined;
  try {
    const fixture = await seedQueuedStartupGenerationFixture(
      dataDirectory,
      fixtureId,
    );
    let unrelatedTaskBefore: Record<string, unknown> | undefined;
    let unrelatedAttemptBefore: Record<string, unknown> | undefined;
    let unrelatedEventCountBefore = 0;
    const database = openAppDatabase(dataDirectory);
    try {
      const task = database.prepare(`
        SELECT canvas_id, kind, node_id FROM generation_tasks WHERE id = ?
      `).get(fixture.taskId) as {
        canvas_id: string;
        kind: string;
        node_id: string;
      };
      const timestamp = "2026-09-01T00:00:00.000Z";
      database.prepare(`
        UPDATE generation_tasks
        SET state = 'failed', error_code = 'M81_IDLE_TERMINAL',
            error_message = 'terminal fixture', updated_at = ?
        WHERE state IN ('queued', 'running', 'recovering', 'retrying')
      `).run(timestamp);
      database.prepare(`
        UPDATE generation_tasks
        SET canvas_id = 'm81-unrelated-outcome-unknown-canvas',
            provider_task_id = NULL,
            error_code = 'OUTCOME_UNKNOWN_BILLING_RISK',
            error_message = 'must remain untouched by terminal-only startup',
            updated_at = ?
        WHERE id = ?
      `).run(timestamp, fixture.acceptedTaskId);
      database.prepare(`
        UPDATE generation_provider_attempts
        SET outcome = 'outcome-unknown', provider_task_id = NULL,
            failure_code = 'OUTCOME_UNKNOWN_BILLING_RISK', finished_at = NULL
        WHERE task_id = ?
      `).run(fixture.acceptedTaskId);
      unrelatedTaskBefore = database.prepare(`
        SELECT canvas_id, error_code, error_message, provider_task_id, state,
               updated_at
        FROM generation_tasks WHERE id = ?
      `).get(fixture.acceptedTaskId) as Record<string, unknown>;
      unrelatedAttemptBefore = database.prepare(`
        SELECT execution_attempt, failure_code, finished_at, outcome,
               provider_task_id
        FROM generation_provider_attempts WHERE task_id = ?
      `).get(fixture.acceptedTaskId) as Record<string, unknown>;
      unrelatedEventCountBefore = (database.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?
      `).get(fixture.acceptedTaskId) as { count: number }).count;
      database.prepare(`
        INSERT INTO canvas_documents (
          owner_id, id, revision, graph_revision, nodes, edges, viewport,
          updated_at, save_session_id, save_sequence
        ) VALUES (?, ?, 1, 1, ?, '[]', '{}', ?, NULL, 0)
      `).run(
        fixture.ownerId,
        task.canvas_id,
        JSON.stringify([{
          data: {
            textGenerating: true,
            textGenerationInputKey: "m81-idle-input",
            textGenerationOwnershipKey: "m81-idle-ownership",
            textGenerationTaskId: fixture.taskId,
            workflowExecutionRunId: "m81-idle-run",
          },
          id: task.node_id,
          type: task.kind,
        }]),
        timestamp,
      );
    } finally {
      database.close();
    }
    makeStandaloneDatabase(dataDirectory);

    server = await startServer(dataDirectory, {
      environment: {
        UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST: JSON.stringify([{
          accountId: fixture.ownerId,
          canvasId: `${fixtureId}-canvas`,
        }]),
        UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE: "allowlist",
      },
      waitPath: "/api/health/ready",
    });

    let detached:
      | { graph_revision: number; nodes: string; revision: number }
      | undefined;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const read = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const row = read.prepare(`
          SELECT graph_revision, nodes, revision FROM canvas_documents
          WHERE owner_id = ? AND id = ?
        `).get(fixture.ownerId, `${fixtureId}-canvas`) as {
          graph_revision: number;
          nodes: string;
          revision: number;
        };
        const data = (JSON.parse(row.nodes) as Array<{
          data: Record<string, unknown>;
        }>)[0]?.data;
        if (
          data?.textGenerating === false &&
          data.textGenerationTaskId === undefined &&
          data.workflowExecutionRunId === undefined
        ) {
          detached = row;
          break;
        }
      } finally {
        read.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(detached).toMatchObject({ graph_revision: 2, revision: 2 });
    await expectMissing(providerLog);
    const preserved = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(preserved.prepare(`
        SELECT canvas_id, error_code, error_message, provider_task_id, state,
               updated_at
        FROM generation_tasks WHERE id = ?
      `).get(fixture.acceptedTaskId)).toEqual(unrelatedTaskBefore);
      expect(preserved.prepare(`
        SELECT execution_attempt, failure_code, finished_at, outcome,
               provider_task_id
        FROM generation_provider_attempts WHERE task_id = ?
      `).get(fixture.acceptedTaskId)).toEqual(unrelatedAttemptBefore);
      expect(preserved.prepare(`
        SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?
      `).get(fixture.acceptedTaskId)).toEqual({
        count: unrelatedEventCountBefore,
      });
    } finally {
      preserved.close();
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness leaves inactive generation evidence and the database bytes unchanged", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-ready-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const task = store.create({
      canvasId: "m81-readiness-canvas",
      idempotencyKey: "m81-readiness-request",
      kind: "image",
      nodeId: "m81-readiness-node",
      prompt: "readiness must never mutate this inactive synthetic task",
    }).task;
    store.transition(task.id, "running");
    store.transition(task.id, "failed", {
      code: "M81_INACTIVE_FIXTURE",
      message: "synthetic terminal evidence",
    });
    store.close();
    expect(await optionalFileSize(`${databasePath}-wal`)).toBe(0);
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);

    const database = new DatabaseSync(
      `${pathToFileURL(databasePath).href}?immutable=1`,
      { readOnly: true },
    );
    try {
      expect(
        database.prepare("SELECT state FROM generation_tasks WHERE id = ?")
          .get(task.id),
      ).toEqual({ state: "failed" });
      expect(
        database.prepare(
          "SELECT COUNT(*) AS count FROM generation_task_events WHERE task_id = ?",
        ).get(task.id),
      ).toEqual({ count: 3 });
    } finally {
      database.close();
    }
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness reads a committed WAL without changing database or WAL bytes", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-live-wal-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    const store = createGenerationTaskStore(dataDirectory);
    const task = store.create({
      canvasId: "m81-live-wal-canvas",
      idempotencyKey: "m81-live-wal-request",
      kind: "image",
      nodeId: "m81-live-wal-node",
      prompt: "WAL readiness must remain observational for inactive evidence",
    }).task;
    store.transition(task.id, "running");
    store.transition(task.id, "failed", {
      code: "M81_INACTIVE_FIXTURE",
      message: "synthetic terminal evidence",
    });
    store.close();

    writer = openAppDatabase(dataDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = ${currentSchemaVersion - 1};
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA user_version = ${currentSchemaVersion};
    `);
    const immutableMain = new DatabaseSync(
      `${pathToFileURL(databasePath).href}?immutable=1`,
      { readOnly: true },
    );
    try {
      expect(immutableMain.prepare("PRAGMA user_version").get()).toEqual({
        user_version: currentSchemaVersion - 1,
      });
    } finally {
      immutableMain.close();
    }
    expect((await stat(`${databasePath}-wal`)).size).toBeGreaterThan(0);
    expect((await stat(`${databasePath}-shm`)).isFile()).toBe(true);
    const beforeEntries = (await readdir(dataDirectory)).sort();
    const beforeDatabase = await sha256(databasePath);
    const beforeWal = await sha256(`${databasePath}-wal`);
    const beforeTask = writer.prepare(`
      SELECT state,
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events
      FROM generation_tasks
      WHERE id = ?
    `).get(task.id, task.id);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    expect(await sha256(databasePath)).toBe(beforeDatabase);
    expect(await sha256(`${databasePath}-wal`)).toBe(beforeWal);
    expect((await readdir(dataDirectory)).sort()).toEqual(beforeEntries);
    expect(writer.prepare(`
      SELECT state,
        (SELECT COUNT(*) FROM generation_task_events WHERE task_id = ?) AS events
      FROM generation_tasks
      WHERE id = ?
    `).get(task.id, task.id)).toEqual(beforeTask);
  } finally {
    if (server) await stopServer(server);
    writer?.close();
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness fails closed for a hot WAL without SHM until an owned connection recovers it", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-wal-recovery-"));
  const sourceDirectory = join(testRoot, "source");
  const targetDirectory = join(testRoot, "target");
  const sourcePath = join(sourceDirectory, "unboundry.sqlite");
  const targetPath = join(targetDirectory, "unboundry.sqlite");
  let recovery: DatabaseSync | undefined;
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    writer = openAppDatabase(sourceDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = ${currentSchemaVersion - 1};
      PRAGMA wal_checkpoint(TRUNCATE);
      PRAGMA user_version = ${currentSchemaVersion};
    `);
    expect((await stat(`${sourcePath}-wal`)).size).toBeGreaterThan(0);
    await copyFile(sourcePath, targetPath);
    await copyFile(`${sourcePath}-wal`, `${targetPath}-wal`);
    expect((await readdir(targetDirectory)).sort()).toEqual([
      "unboundry.sqlite",
      "unboundry.sqlite-wal",
    ]);
    const beforeDatabase = await sha256(targetPath);
    const beforeWal = await sha256(`${targetPath}-wal`);

    server = await startServer(targetDirectory);
    const blocked = await fetch(`${origin}/api/health/ready`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({
      code: "DATABASE_FILE_UNAVAILABLE",
    });
    expect(await sha256(targetPath)).toBe(beforeDatabase);
    expect(await sha256(`${targetPath}-wal`)).toBe(beforeWal);
    expect((await readdir(targetDirectory)).sort()).toEqual([
      "unboundry.sqlite",
      "unboundry.sqlite-wal",
    ]);

    recovery = new DatabaseSync(targetPath);
    expect(recovery.prepare("PRAGMA user_version").get()).toEqual({
      user_version: currentSchemaVersion,
    });
    expect((await stat(`${targetPath}-shm`)).isFile()).toBe(true);
    const recovered = await fetch(`${origin}/api/health/ready`);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: "ready" });
  } finally {
    if (server) await stopServer(server);
    recovery?.close();
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("a hot-WAL pending upload remains not-ready until a new process recovers it", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-wal-pending-"));
  const sourceDirectory = join(testRoot, "source");
  const targetDirectory = join(testRoot, "target");
  const sourcePath = join(sourceDirectory, "unboundry.sqlite");
  const targetPath = join(targetDirectory, "unboundry.sqlite");
  let recovery: DatabaseSync | undefined;
  let server: ChildProcess | undefined;
  let writer: DatabaseSync | undefined;
  try {
    await mkdir(sourceDirectory);
    await mkdir(targetDirectory);
    writer = openAppDatabase(sourceDirectory);
    writer.exec(`
      PRAGMA wal_autocheckpoint = 0;
      PRAGMA user_version = ${currentSchemaVersion - 1};
      PRAGMA wal_checkpoint(TRUNCATE);
    `);
    const candidate = insertOldLocalUploadCandidate(writer, "m81-wal-pending");
    writer.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
    expect((await stat(`${sourcePath}-wal`)).size).toBeGreaterThan(0);
    await copyFile(sourcePath, targetPath);
    await copyFile(`${sourcePath}-wal`, `${targetPath}-wal`);
    await writeOldLocalUploadCandidate(targetDirectory, candidate);
    await expectMissing(`${targetPath}-shm`);
    const beforeDatabase = await sha256(targetPath);
    const beforeWal = await sha256(`${targetPath}-wal`);

    server = await startServer(targetDirectory);
    const hotWal = await fetch(`${origin}/api/health/ready`);
    expect(hotWal.status).toBe(503);
    expect(await hotWal.json()).toMatchObject({
      code: "DATABASE_FILE_UNAVAILABLE",
    });
    expect(await sha256(targetPath)).toBe(beforeDatabase);
    expect(await sha256(`${targetPath}-wal`)).toBe(beforeWal);
    expect(
      await readFile(join(targetDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    recovery = new DatabaseSync(targetPath);
    expect(recovery.prepare("PRAGMA user_version").get()).toEqual({
      user_version: currentSchemaVersion,
    });
    expect(recovery.prepare(`
      SELECT state, error_code FROM media_publication_attempts
      WHERE attempt_id = ?
    `).get(candidate.attemptId)).toEqual({
      error_code: null,
      state: "published",
    });
    expect((await stat(`${targetPath}-shm`)).isFile()).toBe(true);

    const sameProcess = await fetch(`${origin}/api/health/ready`);
    expect(sameProcess.status).toBe(503);
    expect(await sameProcess.json()).toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
    expect(
      await readFile(join(targetDirectory, "media", candidate.storageName)),
    ).toEqual(candidate.bytes);

    await stopServer(server);
    server = undefined;
    server = await startServer(targetDirectory);
    const restarted = await fetch(`${origin}/api/health/ready`);
    expect(restarted.status).toBe(200);
    expect(await restarted.json()).toMatchObject({ status: "ready" });
    await expectMissing(join(targetDirectory, "media", candidate.storageName));
    recovery.close();
    recovery = undefined;

    const cleaned = new DatabaseSync(targetPath, { readOnly: true });
    try {
      expect(cleaned.prepare(`
        SELECT state, error_code FROM media_publication_attempts
        WHERE attempt_id = ?
      `).get(candidate.attemptId)).toEqual({
        error_code: "MEDIA_RECOVERY_UNADOPTED_UPLOAD",
        state: "failed",
      });
      expect(cleaned.prepare(`
        SELECT COUNT(*) AS count FROM media_assets
        WHERE owner_id = ? AND kind = 'image' AND id = ?
      `).get(candidate.ownerId, candidate.assetId)).toEqual({ count: 0 });
    } finally {
      cleaned.close();
    }
  } finally {
    if (server) await stopServer(server);
    recovery?.close();
    writer?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness rejects a counterfeit current-schema ledger without changing it", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-counterfeit-"));
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  let server: ChildProcess | undefined;
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const insert = database.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `);
    for (const migration of currentSchemaManifest) {
      insert.run(migration.version, migration.name, "2026-08-09T00:00:00.000Z");
    }
    database.exec(`PRAGMA user_version = ${currentSchemaVersion}`);
    database.close();
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory);
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      code: "DATABASE_SCHEMA_MISMATCH",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness accepts the historical v31-to-v32 public template column order", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-v31-v32-"));
  let server: ChildProcess | undefined;
  try {
    const database = initializePrivateSyntheticSchema(dataDirectory, 31);
    database.exec("DROP TABLE public_templates");
    // Keep this SQL text aligned with the known hot-reload v31 migration.
    // Exact sqlite_schema fingerprints are intentional: a whitespace-erasing
    // pseudo-lexer can merge declarations with different SQLite semantics.
    database.exec(`
        CREATE TABLE public_templates (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT CHECK (category IS NULL OR json_valid(category)),
          graph TEXT NOT NULL,
          cover_asset_id TEXT,
          preview_image TEXT,
          status TEXT NOT NULL DEFAULT 'published'
            CHECK (status IN ('draft', 'published', 'archived')),
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_by TEXT,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY (created_by) REFERENCES users(id),
          FOREIGN KEY (updated_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS public_templates_status_updated
          ON public_templates (status, updated_at DESC);
      `);
    // Ordinary current-runtime opens are intentionally migration-free. Replay
    // the real immutable v32 prepare hook through the explicit fixture-only
    // migration primitive, from an exact synthetic v31 ledger.
    database.exec("BEGIN IMMEDIATE");
    applyPendingSchemaMigrationsInTransaction(database, { sourceVersion: 31 });
    database.exec("COMMIT");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(databaseMatchesSchemaContract(database)).toBe(true);
    expect(databaseHasCompleteLegacyMediaMetadata(database)).toBe(true);
    database.close();
    const beforeDirectory = await directoryFingerprint(dataDirectory);

    server = await startServer(dataDirectory, {
      waitPath: "/api/health/ready",
    });
    const ready = await fetch(`${origin}/api/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      databaseProbe: "read-only",
      schemaVersion: currentSchemaVersion,
      status: "ready",
    });
    expect(await directoryFingerprint(dataDirectory)).toEqual(beforeDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("readiness accepts exact known migration repair shapes", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-v21-repair-"));
  let server: ChildProcess | undefined;
  try {
    const fixtures = [
      {
        directory: join(testRoot, "missing-catalog-tables"),
        prepare: recreateV21MissingCatalogTables,
      },
      ...(["none", "max", "cost"] as const).map((existingCostColumns) => ({
        directory: join(testRoot, `model-${existingCostColumns}`),
        prepare: (database: DatabaseSync) =>
          recreateV5ModelProfiles(database, existingCostColumns),
      })),
    ];

    for (const fixture of fixtures) {
      await mkdir(fixture.directory);
      const database = initializePrivateSyntheticSchema(fixture.directory, 20);
      fixture.prepare(database);
      // These are exact synthetic v20 sources with deliberately pre-existing
      // or absent prepare-hook shapes. Only the fixture explicitly migrates;
      // the runtime under test remains current-schema-only and read-only.
      database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
      applyPendingSchemaMigrationsInTransaction(database, { sourceVersion: 20 });
      database.exec("COMMIT");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(databaseMatchesSchemaContract(database)).toBe(true);
      expect(databaseHasCompleteLegacyMediaMetadata(database)).toBe(true);
      database.close();
      const beforeDirectory = await directoryFingerprint(fixture.directory);

      server = await startServer(fixture.directory, {
        waitPath: "/api/health/ready",
      });
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({
        databaseProbe: "read-only",
        schemaVersion: currentSchemaVersion,
        status: "ready",
      });
      expect(await directoryFingerprint(fixture.directory)).toEqual(
        beforeDirectory,
      );
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("readiness rejects missing or semantically damaged current-schema objects", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-schema-contract-"));
  let server: ChildProcess | undefined;
  try {
    const cases = [
      {
        directory: join(testRoot, "missing-schema39-credential-epochs"),
        damage: "DROP TABLE account_provider_credential_epochs",
      },
      {
        directory: join(testRoot, "missing-schema39-admission-ledger"),
        damage: "DROP TABLE generation_admission_events",
      },
      {
        directory: join(testRoot, "missing-schema39-owner-idempotency"),
        damage: "DROP INDEX generation_tasks_owner_idempotency",
      },
      {
        directory: join(testRoot, "missing-schema39-attempt-circuit"),
        damage: "DROP INDEX generation_provider_attempts_circuit",
      },
      {
        directory: join(testRoot, "missing-table"),
        damage: "DROP TABLE user_templates",
      },
      {
        directory: join(testRoot, "missing-index"),
        damage: "DROP INDEX node_model_bindings_one_default",
      },
      {
        directory: join(testRoot, "missing-canonical-users-index"),
        damage: "DROP INDEX users_status_role",
      },
      {
        directory: join(testRoot, "false-partial-index"),
        damage: `
          DROP INDEX node_model_bindings_one_default;
          CREATE UNIQUE INDEX node_model_bindings_one_default
          ON node_model_bindings (node_type)
          WHERE 0;
        `,
      },
      {
        directory: join(testRoot, "no-op-trigger"),
        damage: `
          DROP TRIGGER archived_models_cannot_enable_binding_insert;
          CREATE TRIGGER archived_models_cannot_enable_binding_insert
          BEFORE INSERT ON node_model_bindings
          BEGIN
            SELECT 1;
          END;
        `,
      },
      {
        directory: join(testRoot, "literal-case-trigger"),
        damage: `
          DROP TRIGGER model_profiles_capture_first_publish_insert;
          CREATE TRIGGER model_profiles_capture_first_publish_insert
          AFTER INSERT ON model_profiles
          WHEN NEW.status = 'PUBLISHED' AND NEW.published_at IS NULL
          BEGIN
            UPDATE model_profiles
            SET published_at = NEW.updated_at
            WHERE id = NEW.id AND published_at IS NULL;
          END;
        `,
      },
      {
        directory: join(testRoot, "split-integer-type"),
        damage: `
          ALTER TABLE schema_migrations
          RENAME TO schema_migrations_original;
          CREATE TABLE schema_migrations (
            version I NTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          );
          INSERT INTO schema_migrations (version, name, applied_at)
          SELECT version, name, applied_at
          FROM schema_migrations_original;
          DROP TABLE schema_migrations_original;
        `,
      },
      {
        directory: join(testRoot, "extra-destructive-trigger"),
        damage: `
          CREATE TRIGGER unexpected_users_delete
          AFTER INSERT ON users
          BEGIN
            DELETE FROM users WHERE id = NEW.id;
          END;
        `,
      },
      {
        directory: join(testRoot, "extra-unique-index"),
        damage: `
          CREATE UNIQUE INDEX unexpected_users_display_name
          ON users (display_name);
        `,
      },
      {
        directory: join(testRoot, "extra-view"),
        damage: `
          CREATE VIEW unexpected_active_users AS
          SELECT id FROM users WHERE status = 'active';
        `,
      },
    ];
    for (const fixture of cases) {
      await mkdir(fixture.directory);
      const database = openAppDatabase(fixture.directory);
      database.exec(fixture.damage);
      database.close();
      const beforeDirectory = await directoryFingerprint(fixture.directory);

      server = await startServer(fixture.directory);
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        code: "DATABASE_SCHEMA_MISMATCH",
      });
      expect(await directoryFingerprint(fixture.directory)).toEqual(
        beforeDirectory,
      );
      await stopServer(server);
      server = undefined;
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("malformed mounted paths return controlled 400 responses without killing the process", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-url-"));
  let server: ChildProcess | undefined;
  try {
    initializePrivateSyntheticGreenfield(dataDirectory);
    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
      waitPath: "/api/health/ready",
    });
    const originalPid = server.pid;
    const paths = [
      "/api/canvas/%",
      "/api/canvas/%C0%AF",
      "/api/canvas/%2Fetc",
      "/api/canvas/%5Cetc",
      "/api/canvas/%00",
      `/api/canvas/${"a".repeat(4_100)}`,
    ];
    for (const path of paths) {
      const response = await rawHttp(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
      expect(response).toContain(" 400 ");
      expect(response).toContain('"code":"MALFORMED_URL"');
      expect(server.pid).toBe(originalPid);
      expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    }
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("JSON body failures and request IDs have stable safe classifications", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-json-"));
  const sensitiveCanary = "m81-cookie-password-api-key-prompt-secret";
  let server: ChildProcess | undefined;
  try {
    initializePrivateSyntheticGreenfield(dataDirectory);
    server = await startServer(dataDirectory, {
      captureOutput: true,
      waitPath: "/api/health/ready",
    });
    const spoofedId = "attacker-controlled-request-id";
    const live = await fetch(`${origin}/api/health/live`, {
      headers: { "X-Request-ID": spoofedId },
    });
    const requestId = live.headers.get("x-request-id") ?? "";
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(requestId).not.toBe(spoofedId);

    const cases: Array<{
      body: BodyInit;
      code: string;
      contentType: string;
      status: number;
    }> = [
      {
        body: "",
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: `{${sensitiveCanary}`,
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: new Uint8Array([0xc3, 0x28]),
        contentType: "application/json",
        code: "INVALID_JSON",
        status: 400,
      },
      {
        body: "{}",
        contentType: "text/plain",
        code: "UNSUPPORTED_MEDIA_TYPE",
        status: 415,
      },
      {
        body: JSON.stringify({ padding: "x".repeat(70_000) }),
        contentType: "application/json",
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      },
    ];
    for (const fixture of cases) {
      const response = await fetch(`${origin}/api/auth/bootstrap`, {
        body: fixture.body,
        headers: {
          Authorization: `Bearer ${sensitiveCanary}`,
          "Content-Type": fixture.contentType,
          Cookie: `session=${sensitiveCanary}`,
          "X-Forwarded-For": "127.0.0.1",
        },
        method: "POST",
      });
      expect(response.status).toBe(fixture.status);
      expect(await response.json()).toMatchObject({
        code: fixture.code,
        requestId: response.headers.get("x-request-id"),
      });
    }
    const chunkedPayload = JSON.stringify({ padding: "x".repeat(70_000) });
    const chunked = await rawHttp([
      "POST /api/auth/bootstrap HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "X-Forwarded-For: 127.0.0.1",
      "Connection: close",
      "",
      chunkedPayload.length.toString(16),
      chunkedPayload,
      "0",
      "",
      "",
    ].join("\r\n"));
    expect(chunked).toContain(" 413 ");
    expect(chunked).toContain('"code":"PAYLOAD_TOO_LARGE"');

    const compatibleWithoutContentType = await fetch(
      `${origin}/api/auth/bootstrap`,
      {
        body: Buffer.from(JSON.stringify({
          displayName: "Compatible Owner",
          loginName: "compatible-owner",
          password: "compatible-password-123",
        })),
        headers: { "X-Forwarded-For": "127.0.0.1" },
        method: "POST",
      },
    );
    expect(compatibleWithoutContentType.status).toBe(201);
    const structuredJsonSuffix = await fetch(`${origin}/api/auth/login`, {
      body: JSON.stringify({
        loginName: "compatible-owner",
        password: "compatible-password-123",
      }),
      headers: {
        "Content-Type": "application/problem+json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(structuredJsonSuffix.status).toBe(200);
    const unauthorized = await fetch(`${origin}/api/auth/login`, {
      body: JSON.stringify({
        loginName: "compatible-owner",
        password: "incorrect-password-123",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    const duplicateBootstrap = await fetch(`${origin}/api/auth/bootstrap`, {
      body: JSON.stringify({
        displayName: "Duplicate Owner",
        loginName: "duplicate-owner",
        password: "duplicate-password-123",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "127.0.0.1",
      },
      method: "POST",
    });
    expect(duplicateBootstrap.status).toBe(409);
    await expect.poll(() => outputOf(server!).includes('"event":"request"'))
      .toBe(true);
    await expect.poll(() => outputOf(server!).includes('"code":"HTTP_401"'))
      .toBe(true);
    await expect.poll(() => outputOf(server!).includes('"code":"HTTP_409"'))
      .toBe(true);
    expect(outputOf(server)).not.toContain(sensitiveCanary);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("malformed encoded upload names fail before any media path is created", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-filename-"));
  let server: ChildProcess | undefined;
  try {
    initializePrivateSyntheticGreenfield(dataDirectory);
    server = await startServer(dataDirectory, {
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
      waitPath: "/api/health/ready",
    });
    const uploads = [
      { contentType: "image/png", path: "/api/assets/m81-bad-name" },
      { contentType: "audio/mpeg", path: "/api/audio-assets/m81-bad-name.mp3" },
      { contentType: "video/mp4", path: "/api/video-assets/m81-bad-name.mp4" },
    ];
    for (const upload of uploads) {
      const response = await fetch(`${origin}${upload.path}`, {
        body: new Uint8Array(),
        headers: {
          "Content-Type": upload.contentType,
          "X-File-Name": "%",
        },
        method: "POST",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "MALFORMED_URL" });
    }
    await expectMissing(join(dataDirectory, "media"));
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("maintenance allows only health and version APIs without initializing data", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-maintenance-"));
  const dataDirectory = join(testRoot, "missing-data");
  let server: ChildProcess | undefined;
  try {
    server = await startServer(dataDirectory, {
      environment: {
        UNBOUNDRY_MAINTENANCE_MODE: "1",
        UNBOUNDRY_TEST_AUTH_BYPASS: "1",
      },
    });
    const blocked = await request("/api/auth/bootstrap", {
      body: JSON.stringify({
        displayName: "Must not be created",
        loginName: "blocked-owner",
        password: "blocked-password-123",
      }),
      method: "POST",
    });
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await blocked.json()).toMatchObject({
      code: "SERVICE_MAINTENANCE",
    });
    for (const path of [
      "/api/auth/status",
      "/api/generation-tasks/status",
    ]) {
      const sideEffectingRead = await fetch(`${origin}${path}`);
      expect(sideEffectingRead.status).toBe(503);
      expect(await sideEffectingRead.json()).toMatchObject({
        code: "SERVICE_MAINTENANCE",
      });
    }
    const updates = await fetch(`${origin}/api/updates`);
    expect(updates.status).toBe(503);
    expect(await updates.json()).toMatchObject({
      code: "SERVICE_MAINTENANCE",
    });
    const version = await fetch(`${origin}/api/version`);
    expect(version.status).toBe(200);
    expect(await version.json()).toHaveProperty("version");
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
    const slowChunked = await slowChunkedHttp([
      "POST /api/auth/bootstrap HTTP/1.1",
      `Host: 127.0.0.1:${port}`,
      "Content-Type: application/json",
      "Transfer-Encoding: chunked",
      "Connection: keep-alive",
      "",
      "1000",
      "{\"displayName\":\"never-finished",
    ].join("\r\n"));
    expect(slowChunked).toContain(" 503 ");
    expect(slowChunked).toContain("Connection: close");
    await expectMissing(dataDirectory);
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("standby and read-only runtime roles expose only health/version with zero writes", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-non-active-role-"));
  let server: ChildProcess | undefined;
  try {
    for (const role of ["standby", "read-only"] as const) {
      const dataDirectory = join(testRoot, `missing-data-${role}`);
      server = await startServer(dataDirectory, {
        environment: {
          UNBOUNDRY_RUNTIME_ROLE: role,
          UNBOUNDRY_TEST_AUTH_BYPASS: "1",
        },
      });
      const live = await fetch(`${origin}/api/health/live`);
      expect(live.status).toBe(200);
      const ready = await fetch(`${origin}/api/health/ready`);
      expect(ready.status).toBe(503);
      expect(await ready.json()).toMatchObject({
        code: "DATABASE_DIRECTORY_INVALID",
      });
      const version = await fetch(`${origin}/api/version`);
      expect(version.status).toBe(200);
      expect(await version.json()).toHaveProperty("version");
      for (const request of [
        { method: "GET", path: "/api/auth/status" },
        { method: "GET", path: "/api/generation-tasks/status" },
        { method: "GET", path: "/api/updates" },
        { method: "POST", path: "/api/auth/bootstrap" },
      ]) {
        const blocked = await fetch(`${origin}${request.path}`, {
          ...(request.method === "POST"
            ? {
                body: JSON.stringify({
                  displayName: "Must not be created",
                  loginName: "blocked-owner",
                  password: "blocked-password-123",
                }),
                headers: { "Content-Type": "application/json" },
              }
            : {}),
          method: request.method,
        });
        expect(blocked.status).toBe(503);
        expect(await blocked.json()).toMatchObject({
          code: "SERVICE_RUNTIME_ROLE_NOT_ACTIVE",
        });
      }
      await expectMissing(dataDirectory);
      await stopServer(server);
      server = undefined;

      const validDataDirectory = join(testRoot, `valid-data-${role}`);
      await mkdir(validDataDirectory, { mode: 0o700 });
      initializePrivateSyntheticGreenfield(validDataDirectory);
      const before = await directoryFingerprint(validDataDirectory);
      server = await startServer(validDataDirectory, {
        environment: {
          UNBOUNDRY_RUNTIME_ROLE: role,
          UNBOUNDRY_TEST_AUTH_BYPASS: "1",
        },
      });
      const validReady = await fetch(`${origin}/api/health/ready`);
      expect(validReady.status).toBe(503);
      expect(await validReady.json()).toMatchObject({
        activeLeaseHeld: false,
        code: "SERVICE_RUNTIME_ROLE_NOT_ACTIVE",
        databaseProbe: "read-only",
        mode: `${role}-api-blocked`,
        mutationsAccepted: false,
        runtimeRole: role,
        status: "not-ready",
      });
      expect(await directoryFingerprint(validDataDirectory)).toEqual(before);
      await stopServer(server);
      server = undefined;
      expect(await directoryFingerprint(validDataDirectory)).toEqual(before);
    }
  } finally {
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("shutdown waits for handler cleanup and has a hard close-failure exit", async () => {
  const lifecycle = createRuntimeLifecycle({
    dataDirectory: join(tmpdir(), "unboundry-m81-unused-lifecycle-data"),
    logger: () => undefined,
    shutdownDeadlineMs: 1_000,
  });
  let releaseCleanup: (() => void) | undefined;
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const handler = lifecycle.trackHandler(async () => {
    await cleanupGate;
  });
  const drain = lifecycle.beginShutdown();
  let drainSettled = false;
  void drain.then(() => { drainSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  expect(lifecycle.getInFlightRequests()).toBe(0);
  expect(lifecycle.getActiveHandlers()).toBe(1);
  expect(drainSettled).toBe(false);
  releaseCleanup?.();
  await handler;
  expect(await drain).toEqual({
    activeHandlers: 0,
    drained: true,
    inFlightRequests: 0,
  });

  const drainedResult: ShutdownResult = {
    activeHandlers: 0,
    drained: true,
    inFlightRequests: 0,
  };
  let synchronousFailureConnectionsClosed = 0;
  const synchronousFailureDiagnostics: unknown[] = [];
  expect(await coordinateRuntimeShutdown({
    beginShutdown: async () => drainedResult,
    close: () => { throw new Error("synthetic synchronous close failure"); },
    closeAllConnections: () => { synchronousFailureConnectionsClosed += 1; },
    deadlineMs: 20,
    hardExitGraceMs: 20,
    reportFailure: (diagnostic) => {
      synchronousFailureDiagnostics.push(diagnostic);
    },
  })).toBe(1);
  expect(synchronousFailureConnectionsClosed).toBe(1);
  expect(synchronousFailureDiagnostics).toEqual([{
    causeCode: "RUNTIME_SHUTDOWN_UNCLASSIFIED",
    code: "RUNTIME_SHUTDOWN_FAILED",
  }]);

  let hungCloseConnectionsClosed = 0;
  const hungCloseDiagnostics: unknown[] = [];
  expect(await coordinateRuntimeShutdown({
    beginShutdown: async () => drainedResult,
    close: () => new Promise<void>(() => undefined),
    closeAllConnections: () => { hungCloseConnectionsClosed += 1; },
    deadlineMs: 0,
    hardExitGraceMs: 20,
    reportFailure: (diagnostic) => {
      hungCloseDiagnostics.push(diagnostic);
    },
  })).toBe(1);
  expect(hungCloseConnectionsClosed).toBe(1);
  expect(hungCloseDiagnostics).toEqual([{
    causeCode: "RUNTIME_SHUTDOWN_DEADLINE_EXCEEDED",
    code: "RUNTIME_SHUTDOWN_FAILED",
  }]);

  const databaseFailureDiagnostics: unknown[] = [];
  expect(await coordinateRuntimeShutdown({
    beginShutdown: async () => {
      throw new LegacyRuntimeDatabaseChangedError("ACTIVE_SHUTDOWN", {
        changeClass: "CONTENT_METADATA",
        component: "WAL",
      });
    },
    close: () => undefined,
    deadlineMs: 20,
    reportFailure: (diagnostic) => {
      databaseFailureDiagnostics.push(diagnostic);
    },
  })).toBe(1);
  expect(databaseFailureDiagnostics).toEqual([{
    causeCode:
      "LEGACY_RUNTIME_DATABASE_CHANGED:ACTIVE_SHUTDOWN:WAL:CONTENT_METADATA",
    code: "RUNTIME_SHUTDOWN_FAILED",
  }]);
});

test("programmatic Vite close drains durable generation and permits a fresh active runtime", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-programmatic-close-"));
  const dataDirectory = join(testRoot, "data");
  const runtimeDirectory = join(testRoot, "runtime");
  let child: ChildProcess | undefined;
  try {
    const fixture = await seedQueuedStartupGenerationFixture(
      dataDirectory,
      "m81-programmatic-close",
    );
    makeStandaloneDatabase(dataDirectory);
    const bootstrap = String.raw`
      import { readFile } from "node:fs/promises";
      import { join, resolve } from "node:path";
      import { createServer, loadConfigFromFile } from "vite";

      const [dataDirectory, runtimeDirectory, rawPort] = process.argv.slice(1);
      const port = Number(rawPort);
      const providerLog = join(
        dataDirectory,
        ".unboundry-startup-provider-fixture.log",
      );
      const startupWorkerLog = join(
        dataDirectory,
        ".unboundry-startup-worker-observer.log",
      );
      const start = async () => {
        const server = await createServer({
          configFile: resolve("vite.config.ts"),
          logLevel: "silent",
          server: {
            hmr: false,
            host: "127.0.0.1",
            port,
            strictPort: true,
            ws: false,
          },
        });
        await server.listen();
        return server;
      };

      const first = await start();
      await import("./scripts/node-typescript-runtime.mjs");
      const runtimeRole = await import("./server/runtimeRole.ts");
      const buildConfiguration = await loadConfigFromFile(
        { command: "build", mode: "production" },
        resolve("vite.config.ts"),
      );
      if (!buildConfiguration?.config) {
        throw new Error("Build config isolation probe failed");
      }
      let readyAfterBuildLoad;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await fetch(
          "http://127.0.0.1:" + port + "/api/health/ready",
        );
        const body = await response.json();
        if (response.status === 200) {
          readyAfterBuildLoad = body;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!readyAfterBuildLoad) {
        throw new Error("Build config load altered active runtime readiness");
      }
      const secondDataDirectory = dataDirectory + "-overlap";
      const secondRuntimeDirectory = runtimeDirectory + "-overlap";
      process.env.UNBOUNDRY_DATA_DIR = secondDataDirectory;
      process.env.UNBOUNDRY_RUNTIME_DIR = secondRuntimeDirectory;
      await import("node:fs/promises").then(({ cp, mkdir }) =>
        mkdir(secondDataDirectory, { recursive: true }).then(() =>
          cp(dataDirectory + "/unboundry.sqlite", secondDataDirectory + "/unboundry.sqlite")
        )
      );
      let overlappingConfigurationRejected = false;
      let overlap;
      try {
        overlap = await createServer({
          configFile: resolve("vite.config.ts"),
          logLevel: "silent",
          server: { hmr: false, middlewareMode: true, ws: false },
        });
      } catch (error) {
        overlappingConfigurationRejected = /(?:active runtime|restart required)/i
          .test(error instanceof Error ? error.message : String(error));
      } finally {
        await overlap?.close();
      }
      if (!overlappingConfigurationRejected) {
        throw new Error("Overlapping runtime configuration was not rejected");
      }
      process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
      process.env.UNBOUNDRY_RUNTIME_DIR = runtimeDirectory;
      const readyAfterOverlap = await fetch(
        "http://127.0.0.1:" + port + "/api/health/ready",
      );
      if (readyAfterOverlap.status !== 200) {
        throw new Error("Rejected overlap altered first runtime context");
      }
      let providerStarted = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          providerStarted = (await readFile(providerLog, "utf8")).length > 0;
        } catch {}
        if (providerStarted) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!providerStarted) throw new Error("Provider execution did not start");
      await first.close();

      const handoff = runtimeRole.createRuntimeRoleCoordinator({
        dataDirectory,
        role: "active",
        runtimeDirectory,
      });
      const handoffSnapshot = handoff.snapshot();
      handoff.close();

      const second = await start();
      let secondReady;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await fetch(
          "http://127.0.0.1:" + port + "/api/health/ready",
        );
        const body = await response.json();
        if (response.status === 200) {
          secondReady = body;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!secondReady) throw new Error("Second runtime never became ready");
      await second.close();
      // Vite 8's three denied wildcard availability probes set the inherited
      // offline guard exit code; the safe runner audits their exact shape.
      process.exitCode = 0;
      process.stdout.write(JSON.stringify({
        handoffSnapshot,
        overlappingConfigurationRejected,
        providerLog: await readFile(providerLog, "utf8"),
        readyAfterBuildLoad,
        readyAfterOverlap: await readyAfterOverlap.json(),
        secondReady,
        startupWorkerLog: await readFile(startupWorkerLog, "utf8"),
        restarted: true,
      }));
    `;
    child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      bootstrap,
      dataDirectory,
      runtimeDirectory,
      String(port),
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_RUNTIME_DIR: runtimeDirectory,
        UNBOUNDRY_TEST_GENERATION_STARTUP_FAKE_PROVIDER: "1",
        UNBOUNDRY_TEST_GENERATION_STARTUP_HANG: "1",
        UNBOUNDRY_TEST_GENERATION_STARTUP_OBSERVE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    await waitForChildExit(
      child,
      20_000,
      `programmatic Vite close did not settle: ${stderr}`,
    );
    if (child.exitCode !== 0) {
      throw new Error(
        `Programmatic Vite child exited ${child.exitCode}: ${stderr || stdout}`,
      );
    }
    const evidence = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as {
      handoffSnapshot: { activeLeaseHeld: boolean; role: string };
      overlappingConfigurationRejected: boolean;
      providerLog: string;
      readyAfterBuildLoad: {
        activeLeaseHeld: boolean;
        mode: string;
        mutationsAccepted: boolean;
      };
      readyAfterOverlap: {
        activeLeaseHeld: boolean;
        mode: string;
        mutationsAccepted: boolean;
      };
      secondReady: {
        activeLeaseHeld: boolean;
        mode: string;
        mutationsAccepted: boolean;
      };
      startupWorkerLog: string;
      restarted: boolean;
    };
    expect(evidence).toMatchObject({
      handoffSnapshot: { activeLeaseHeld: true, role: "active" },
      overlappingConfigurationRejected: true,
      readyAfterBuildLoad: {
        activeLeaseHeld: true,
        mode: "active",
        mutationsAccepted: true,
      },
      readyAfterOverlap: {
        activeLeaseHeld: true,
        mode: "active",
        mutationsAccepted: true,
      },
      secondReady: {
        activeLeaseHeld: true,
        mode: "active",
        mutationsAccepted: true,
      },
      restarted: true,
    });
    expect(evidence.providerLog.trim().split("\n")).not.toHaveLength(0);
    expect(evidence.startupWorkerLog.trim().split("\n")).toHaveLength(2);
    const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"), {
      readOnly: true,
    });
    try {
      expect(database.prepare(`
        SELECT error_code, state FROM generation_tasks WHERE id = ?
      `).get(fixture.taskId)).toEqual({
        error_code: "AUTOMATIC_RESULT_RECOVERY",
        state: "recovering",
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM generation_provider_attempts
        WHERE task_id = ? AND execution_attempt = 1
      `).get(fixture.taskId)).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  } finally {
    if (child && !childExited(child)) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 5_000, "programmatic close child stuck")
        .catch(() => undefined);
    }
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("startup media recovery remains inside the active drain until it settles", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-media-drain-"));
  const dataDirectory = join(testRoot, "data");
  const runtimeDirectory = join(testRoot, "runtime");
  const recoveryGate = join(testRoot, "release-media-recovery");
  const enteredMarker = `${recoveryGate}.entered`;
  let child: ChildProcess | undefined;
  try {
    makeStandaloneDatabase(dataDirectory);
    const bootstrap = String.raw`
      import { resolve } from "node:path";
      import { createServer } from "vite";

      await createServer({
        configFile: resolve("vite.config.ts"),
        logLevel: "silent",
        server: { hmr: false, middlewareMode: true, ws: false },
      });
      await new Promise(() => undefined);
    `;
    child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_RUNTIME_DIR: runtimeDirectory,
        UNBOUNDRY_TEST_MEDIA_STARTUP_RECOVERY_GATE: recoveryGate,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await stat(enteredMarker);
        break;
      } catch {}
      if (childExited(child)) {
        throw new Error("Media startup child exited before entering its drain");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await stat(enteredMarker);
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(childExited(child)).toBe(false);
    expect(() => createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      runtimeDirectory,
    })).toThrow();

    await writeFile(recoveryGate, "release\n", { flag: "wx" });
    await waitForChildExit(
      child,
      10_000,
      "Media startup drain did not settle after its gate was released",
    );
    expect(child.exitCode).toBe(0);
    const handoff = createRuntimeRoleCoordinator({
      dataDirectory,
      role: "active",
      runtimeDirectory,
    });
    expect(handoff.snapshot()).toMatchObject({
      activeLeaseHeld: true,
      role: "active",
    });
    handoff.close();
  } finally {
    if (child && !childExited(child)) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 5_000, "media startup drain child stuck")
        .catch(() => undefined);
    }
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("controlled Vite configure failure releases its active lease for a retry", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-configure-failure-"));
  const dataDirectory = join(testRoot, "data");
  const runtimeDirectory = join(testRoot, "runtime");
  let child: ChildProcess | undefined;
  try {
    makeStandaloneDatabase(dataDirectory);
    const bootstrap = String.raw`
      import { resolve } from "node:path";
      import { createServer } from "vite";

      const [dataDirectory, runtimeDirectory] = process.argv.slice(1);
      const originalProcessOnce = process.once;
      const create = () => createServer({
        configFile: resolve("vite.config.ts"),
        logLevel: "silent",
        server: { hmr: false, middlewareMode: true, ws: false },
      });

      process.env.UNBOUNDRY_TEST_RUNTIME_CONFIGURE_FAILURE = "1";
      let controlledFailure = false;
      try {
        await create();
      } catch (error) {
        controlledFailure = /controlled runtime configure failure/i.test(
          error instanceof Error ? error.message : String(error),
        );
      }
      if (!controlledFailure) throw new Error("Controlled failure was not observed");
      if (process.once !== originalProcessOnce) {
        throw new Error("Config resolution leaked a process.once override");
      }
      delete process.env.UNBOUNDRY_TEST_RUNTIME_CONFIGURE_FAILURE;
      const retry = await create();
      await retry.close();
      process.stdout.write(JSON.stringify({ controlledFailure, retried: true }));
    `;
    child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      bootstrap,
      dataDirectory,
      runtimeDirectory,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UNBOUNDRY_DATA_DIR: dataDirectory,
        UNBOUNDRY_RUNTIME_DIR: runtimeDirectory,
        UNBOUNDRY_TEST_RUNTIME_CONFIGURE_FAILURE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    await waitForChildExit(
      child,
      15_000,
      `controlled configure failure child stuck: ${stderr}`,
    );
    expect(child.exitCode).toBe(0);
    expect(JSON.parse(stdout.trim().split("\n").at(-1) ?? "")).toEqual({
      controlledFailure: true,
      retried: true,
    });
  } finally {
    if (child && !childExited(child)) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 5_000, "configure failure child stuck")
        .catch(() => undefined);
    }
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("business schema admission retries a transient readiness guard", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "unboundry-m81-admission-retry-"));
  const sockets: Socket[] = [];
  let primedHandlerDatabase: DatabaseSync | undefined;
  try {
    const database = openAppDatabase(dataDirectory);
    database.close();
    let admitted = false;
    let replaceDuringNextSuccessfulProbe = false;
    const lifecycle = createRuntimeLifecycle({
      dataDirectory,
      logger: () => undefined,
      readinessDatabaseGuard: () => {
        if (replaceDuringNextSuccessfulProbe) {
          replaceDuringNextSuccessfulProbe = false;
          const databasePath = join(dataDirectory, "unboundry.sqlite");
          const displaced = join(dataDirectory, "unboundry-probe-race.sqlite");
          const replacementDirectory = join(dataDirectory, "probe-race-replacement");
          const replacement = openAppDatabase(replacementDirectory);
          replacement.exec(
            "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;",
          );
          replacement.close();
          renameSync(databasePath, displaced);
          renameSync(
            join(replacementDirectory, "unboundry.sqlite"),
            databasePath,
          );
        }
        return admitted;
      },
    });
    async function dispatch(
      target = lifecycle,
      onPassed?: () => void,
    ) {
      const socket = new Socket();
      sockets.push(socket);
      const incoming = new IncomingMessage(socket);
      incoming.method = "GET";
      incoming.url = "/models";
      const headers = new Map<string, string>();
      const responseEvents = new EventEmitter();
      const response = Object.assign(responseEvents, {
        destroyed: false,
        headersSent: false,
        setHeader(name: string, value: string) {
          headers.set(name.toLowerCase(), String(value));
        },
        statusCode: 200,
        writableEnded: false,
        end() {
          this.writableEnded = true;
          responseEvents.emit("finish");
        },
      }) as unknown as ServerResponse;
      let passed = false;
      const finished = new Promise<void>((resolveDone) => {
        response.once("finish", resolveDone);
      });
      target.middleware(incoming, response, () => {
        passed = true;
        onPassed?.();
        response.statusCode = 204;
        response.end();
      });
      await finished;
      return { passed, status: response.statusCode };
    }
    async function readiness(target = lifecycle) {
      const socket = new Socket();
      sockets.push(socket);
      const incoming = new IncomingMessage(socket);
      incoming.method = "GET";
      incoming.url = "/";
      const responseEvents = new EventEmitter();
      let body = "";
      const response = Object.assign(responseEvents, {
        destroyed: false,
        headersSent: false,
        setHeader() {},
        statusCode: 200,
        writableEnded: false,
        end(value?: string) {
          body = value ?? "";
          this.writableEnded = true;
          responseEvents.emit("finish");
        },
      }) as unknown as ServerResponse;
      const finished = new Promise<void>((resolveDone) => {
        response.once("finish", resolveDone);
      });
      target.healthApi(incoming, response, "ready");
      await finished;
      return {
        body: body ? JSON.parse(body) as Record<string, unknown> : {},
        status: response.statusCode,
      };
    }
    expect(await dispatch()).toEqual({ passed: false, status: 503 });
    admitted = true;
    replaceDuringNextSuccessfulProbe = true;
    // No database identity has been admitted yet. A replacement during this
    // first successful probe rejects that request, then a fresh exact probe may
    // safely admit the replacement; the active-identity restart latch is
    // exercised independently below.
    expect(await dispatch()).toEqual({ passed: false, status: 503 });
    expect(await readiness()).toMatchObject({
      body: {
        databaseProbe: "read-only",
        schemaVersion: currentSchemaVersion,
        status: "ready",
      },
      status: 200,
    });
    expect(await dispatch()).toEqual({ passed: true, status: 204 });

    const databasePath = join(dataDirectory, "unboundry.sqlite");
    const freshLifecycle = createRuntimeLifecycle({
      dataDirectory,
      logger: () => undefined,
      readinessDatabaseGuard: () => true,
    });
    expect(await dispatch(freshLifecycle, () => {
      primedHandlerDatabase = openAppDatabase(dataDirectory);
      primedHandlerDatabase.prepare("SELECT 1").get();
    })).toEqual({ passed: true, status: 204 });
    primedHandlerDatabase!.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;",
    );

    const currentDisplaced = join(dataDirectory, "unboundry-current.sqlite");
    const exact39Directory = join(dataDirectory, "exact39-fixture");
    const exact39Path = join(exact39Directory, "unboundry.sqlite");
    const exact39 = openAppDatabase(exact39Directory);
    exact39.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
    exact39.close();
    await rename(databasePath, currentDisplaced);
    await rename(exact39Path, databasePath);
    expect(await dispatch(freshLifecycle)).toEqual({ passed: false, status: 503 });
    expect(await readiness(freshLifecycle)).toMatchObject({
      body: {
        code: "SERVICE_RESTART_REQUIRED",
        mode: "database-restart-required",
        mutationsAccepted: false,
      },
      status: 503,
    });
    await rename(databasePath, exact39Path);
    await rename(currentDisplaced, databasePath);
    primedHandlerDatabase!.close();
    primedHandlerDatabase = undefined;

    const schema37Directory = join(dataDirectory, "schema37-fixture");
    await mkdir(schema37Directory);
    const schema37Path = join(schema37Directory, "unboundry.sqlite");
    await copyFile(databasePath, schema37Path);
    const schema37 = new DatabaseSync(schema37Path);
    rollbackMigration39To38(schema37);
    rollbackMigration38To37(schema37);
    schema37.close();
    const currentBytes = await readFile(databasePath);
    const schema37Bytes = await readFile(schema37Path);
    const schemaTransitionLifecycle = createRuntimeLifecycle({
      dataDirectory,
      logger: () => undefined,
      readinessDatabaseGuard: () => true,
    });
    expect(await dispatch(schemaTransitionLifecycle)).toEqual({
      passed: true,
      status: 204,
    });
    await rename(databasePath, currentDisplaced);
    await rename(schema37Path, databasePath);
    expect(await dispatch(schemaTransitionLifecycle)).toEqual({
      passed: false,
      status: 503,
    });
    expect(await readFile(databasePath)).toEqual(schema37Bytes);
    expect(await readFile(currentDisplaced)).toEqual(currentBytes);

    await rename(databasePath, schema37Path);
    await rename(currentDisplaced, databasePath);
    // This lifecycle had already admitted the original inode. Replacing it
    // with schema 37 permanently trips the stronger active-identity restart
    // latch; restoring the current schema cannot hot-admit a different path identity.
    expect(await dispatch(schemaTransitionLifecycle)).toEqual({
      passed: false,
      status: 503,
    });
    expect(await readiness(schemaTransitionLifecycle)).toMatchObject({
      body: {
        code: "SERVICE_RESTART_REQUIRED",
        mode: "database-restart-required",
      },
      status: 503,
    });
    const restartedLifecycle = createRuntimeLifecycle({
      dataDirectory,
      logger: () => undefined,
      readinessDatabaseGuard: () => true,
    });
    expect(await dispatch(restartedLifecycle)).toEqual({
      passed: true,
      status: 204,
    });
    await chmod(dataDirectory, 0o777);
    expect(await dispatch(restartedLifecycle)).toEqual({
      passed: false,
      status: 503,
    });
    expect(await readiness(restartedLifecycle)).toMatchObject({
      body: {
        code: "SERVICE_RESTART_REQUIRED",
        mode: "database-restart-required",
      },
      status: 503,
    });
    await chmod(dataDirectory, 0o700);

    const deletionLifecycle = createRuntimeLifecycle({
      dataDirectory,
      logger: () => undefined,
      readinessDatabaseGuard: () => true,
    });
    expect(await dispatch(deletionLifecycle)).toEqual({
      passed: true,
      status: 204,
    });
    const currentBeforeDelete = await readFile(databasePath);
    await rename(databasePath, currentDisplaced);
    expect(await dispatch(deletionLifecycle)).toEqual({
      passed: false,
      status: 503,
    });
    expect(await readiness(deletionLifecycle)).toMatchObject({
      body: { code: "SERVICE_RESTART_REQUIRED" },
      status: 503,
    });
    expect(await readFile(currentDisplaced)).toEqual(currentBeforeDelete);

    const directoryIdentityDirectory = join(
      dataDirectory,
      "directory-identity-fixture",
    );
    const directoryIdentityDisplaced = join(
      dataDirectory,
      "directory-identity-displaced",
    );
    const directoryIdentityPath = join(
      directoryIdentityDirectory,
      "unboundry.sqlite",
    );
    const directoryIdentityDatabase = openAppDatabase(
      directoryIdentityDirectory,
    );
    directoryIdentityDatabase.exec(
      "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;",
    );
    directoryIdentityDatabase.close();
    const directoryIdentityLifecycle = createRuntimeLifecycle({
      dataDirectory: directoryIdentityDirectory,
      logger: () => undefined,
      readinessDatabaseGuard: () => true,
    });
    expect(await dispatch(directoryIdentityLifecycle)).toEqual({
      passed: true,
      status: 204,
    });
    await rename(directoryIdentityDirectory, directoryIdentityDisplaced);
    await mkdir(directoryIdentityDirectory, { mode: 0o700 });
    await rename(
      join(directoryIdentityDisplaced, "unboundry.sqlite"),
      directoryIdentityPath,
    );
    expect(await dispatch(directoryIdentityLifecycle)).toEqual({
      passed: false,
      status: 503,
    });
    expect(await readiness(directoryIdentityLifecycle)).toMatchObject({
      body: {
        code: "SERVICE_RESTART_REQUIRED",
        mode: "database-restart-required",
      },
      status: 503,
    });
  } finally {
    primedHandlerDatabase?.close();
    sockets.forEach((socket) => socket.destroy());
    await rm(dataDirectory, { force: true, recursive: true });
  }
});

test("dev and preview own shutdown signals without erasing host listeners", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "unboundry-m81-shutdown-"));
  let server: ChildProcess | undefined;
  let updates: Awaited<ReturnType<typeof openServerEventStream>> | undefined;
  try {
    const productionTestEnvironmentError =
      "UNBOUNDRY_PRODUCTION_TEST_ENV_FORBIDDEN: preview and production runtime reject UNBOUNDRY_SAFE_TEST and UNBOUNDRY_TEST_*";
    for (const rejected of [
      { label: "preview-test-env", preview: true, production: false },
      { label: "production-test-env", preview: false, production: true },
    ]) {
      const rejectedDataDirectory = join(testRoot, rejected.label);
      const rejectedChild = spawn(
        process.execPath,
        [
          vite,
          ...(rejected.preview ? ["preview"] : []),
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "--strictPort",
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: rejected.production ? "production" : undefined,
            UNBOUNDRY_DATA_DIR: rejectedDataDirectory,
            UNBOUNDRY_TEST_AUTH_BYPASS: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const output: string[] = [];
      capturedOutput.set(rejectedChild, output);
      rejectedChild.stdout?.on("data", (chunk) => output.push(String(chunk)));
      rejectedChild.stderr?.on("data", (chunk) => output.push(String(chunk)));
      await waitForChildExit(
        rejectedChild,
        5_000,
        `${rejected.label} did not fail before startup`,
      );
      expect(rejectedChild.exitCode).not.toBe(0);
      expect(rejectedChild.signalCode).toBeNull();
      expect(outputOf(rejectedChild)).toContain(productionTestEnvironmentError);
      await expect(access(rejectedDataDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expectPortAvailable();
    }

    const cases: Array<{
      label: string;
      preview: boolean;
      signal: NodeJS.Signals;
    }> = [
      { label: "dev-term", preview: false, signal: "SIGTERM" },
      { label: "preview-term", preview: true, signal: "SIGTERM" },
      { label: "preview-int", preview: true, signal: "SIGINT" },
    ];
    for (const fixture of cases) {
      const dataDirectory = join(testRoot, fixture.label);
      const sentinelModule = join(dataDirectory, "signal-sentinel.mjs");
      const sentinelOutput = join(dataDirectory, "signal-sentinel.log");
      await mkdir(dataDirectory);
      // Greenfield bootstrap rejects any pre-existing residue by contract.
      initializePrivateSyntheticGreenfield(dataDirectory);
      await writeFile(sentinelModule, `
        import { appendFileSync } from "node:fs";
        const output = ${JSON.stringify(sentinelOutput)};
        const record = (label) => () => appendFileSync(output, label + "\\n");
        process.on("SIGTERM", record("listener-one"));
        process.on("SIGTERM", record("listener-two"));
        process.on("SIGINT", record("listener-one"));
        process.on("SIGINT", record("listener-two"));
        const originalOnce = process.once;
        let lateRegistered = false;
        process.once = function (event, listener) {
          const result = Reflect.apply(originalOnce, this, [event, listener]);
          if (
            !lateRegistered &&
            event === "SIGTERM" &&
            listener?.name === "parentSigtermCallback"
          ) {
            lateRegistered = true;
            process.on("SIGTERM", record("listener-late"));
          }
          return result;
        };
      `);
      server = await startServer(dataDirectory, {
        captureOutput: true,
        environment: {
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${
            pathToFileURL(sentinelModule).href
          }`.trim(),
        },
        preview: fixture.preview,
        waitPath: "/api/health/ready",
      });
      updates = await openServerEventStream();
      expect(updates.status).toBe(200);
      await expect.poll(updates.text).toContain('"version"');

      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        server!.once("exit", (code, signal) => resolve({ code, signal }));
      });
      expect(server.kill(fixture.signal)).toBe(true);
      await expect.poll(updates.text).toContain("event: shutdown");
      await expect.poll(updates.text).toContain('"retryAfterSeconds"');
      await withTimeout(updates.closed, 5_000, "shutdown SSE did not close");

      const result = await withTimeout(
        exited,
        5_000,
        "server did not exit after drain",
      );
      expect(result).toEqual({ code: 0, signal: null });
      await expect.poll(
        () => outputOf(server!).includes('"code":"SHUTDOWN_DRAINED"'),
      ).toBe(true);
      const expectedListeners = fixture.signal === "SIGTERM"
        ? ["listener-late", "listener-one", "listener-two"]
        : ["listener-one", "listener-two"];
      expect((await readFile(sentinelOutput, "utf8")).trim().split("\n").sort())
        .toEqual(expectedListeners);
      expect(outputOf(server)).not.toMatch(/cookie|password|api.?key|prompt/i);
      updates.close();
      updates = undefined;
      await stopServer(server);
      server = undefined;
    }
  } finally {
    updates?.close();
    if (server) await stopServer(server);
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("dev and preview apply security headers while HSTS requires trusted effective HTTPS", async () => {
  const tlsSocket = new Socket();
  Object.defineProperty(tlsSocket, "encrypted", { value: true });
  const tlsRequest = new IncomingMessage(tlsSocket);
  const tlsResponse = new ServerResponse(tlsRequest);
  try {
    applySecurityHeaders(tlsRequest, tlsResponse, {
      allowDevelopmentHmr: false,
    });
    expect(tlsResponse.getHeader("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  } finally {
    tlsResponse.destroy();
    tlsRequest.destroy();
    tlsSocket.destroy();
  }

  for (const fixture of [
    { development: true, preview: false, trustProxy: "1" },
    { development: false, preview: true, trustProxy: "0" },
  ]) {
    const dataDirectory = await mkdtemp(
      join(tmpdir(), `unboundry-m81-security-${fixture.preview ? "preview" : "dev"}-`),
    );
    let server: ChildProcess | undefined;
    try {
      server = await startServer(dataDirectory, {
        environment: { UNBOUNDRY_TRUST_PROXY: fixture.trustProxy },
        preview: fixture.preview,
      });
      for (const route of [
        { path: "/", status: 200 },
        { path: "/api/health/live", status: 200 },
        { path: "/not-a-security-exception", status: 200 },
        {
          path: "/__responsive-preview/1280x720",
          status: 200,
          allowSameOriginChildFrames: fixture.development,
        },
        {
          path: "/__fixture/shell.empty.primary?embedded=1280x720",
          status: 200,
          allowSameOriginEmbedding: fixture.development,
        },
        { path: "/__responsive-preview/1280x721", status: 200 },
        {
          path: "/__fixture/shell.empty.primary?embedded=1280x721",
          status: 200,
        },
      ] as const) {
        const response = await fetch(`${origin}${route.path}`);
        expect(response.status).toBe(route.status);
        assertSecurityHeaders(response, fixture.development, {
          allowSameOriginChildFrames:
            "allowSameOriginChildFrames" in route &&
            route.allowSameOriginChildFrames,
          allowSameOriginEmbedding:
            "allowSameOriginEmbedding" in route &&
            route.allowSameOriginEmbedding,
        });
        expect(response.headers.get("strict-transport-security")).toBeNull();
      }

      const forwardedHttps = await fetch(`${origin}/api/health/live`, {
        headers: { "X-Forwarded-Proto": "https" },
      });
      assertSecurityHeaders(forwardedHttps, fixture.development);
      if (fixture.trustProxy === "1") {
        expect(forwardedHttps.headers.get("strict-transport-security")).toBe(
          "max-age=31536000; includeSubDomains",
        );
      } else {
        expect(forwardedHttps.headers.get("strict-transport-security")).toBeNull();
      }

      const ambiguousForwarding = await fetch(`${origin}/api/health/live`, {
        headers: { "X-Forwarded-Proto": "https, http" },
      });
      expect(ambiguousForwarding.headers.get("strict-transport-security")).toBeNull();
    } finally {
      if (server) await stopServer(server);
      await rm(dataDirectory, { force: true, recursive: true });
    }
  }
});

test("an invalid database identity fails closed before handlers and liveness remains available", async () => {
  const secretCanary = "cookie-password-apikey-prompt-canary";
  const dataDirectory = await mkdtemp(
    join(tmpdir(), `unboundry-m81-${secretCanary}-`),
  );
  let server: ChildProcess | undefined;
  try {
    await mkdir(join(dataDirectory, "unboundry.sqlite"));
    server = await startServer(dataDirectory, {
      captureOutput: true,
      environment: { UNBOUNDRY_TEST_AUTH_BYPASS: "1" },
    });
    const failed = await fetch(`${origin}/api/media-metadata/image/missing`);
    expect(failed.status).toBe(503);
    assertSecurityHeaders(failed, true);
    const body = await failed.text();
    expect(body).toContain('"code":"SERVICE_DATABASE_UNAVAILABLE"');
    expect(body).not.toContain(secretCanary);
    await expect.poll(
      () => outputOf(server!).includes('"code":"SERVICE_DATABASE_UNAVAILABLE"'),
    ).toBe(true);
    expect(outputOf(server)).not.toContain(secretCanary);
    expect((await fetch(`${origin}/api/health/live`)).status).toBe(200);
  } finally {
    if (server) await stopServer(server);
    await rm(dataDirectory, { force: true, recursive: true });
  }
});
