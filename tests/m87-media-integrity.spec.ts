import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./safe-test";
import { openAppDatabase } from "../server/database";
import { inspectMediaIntegrity } from "../server/mediaIntegrity";

const execute = promisify(execFile);
const timestamp = "2026-08-09T00:00:00.000Z";
const digestA = createHash("sha256").update("aaaaa").digest("hex");
const digestB = createHash("sha256").update("bbbbb").digest("hex");
const logicalDatabaseHash = "1".repeat(64);

async function fixtureRoot(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await chmod(root, 0o700);
  const dataDirectory = join(root, "data");
  const mediaDirectory = join(dataDirectory, "media");
  await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
  await chmod(dataDirectory, 0o700);
  await chmod(mediaDirectory, 0o700);
  return { dataDirectory, mediaDirectory, root };
}

function seedUser(database: ReturnType<typeof openAppDatabase>) {
  database.prepare(`
    INSERT INTO users (
      id, login_name, display_name, password_hash, role, status, protected,
      created_at, updated_at
    ) VALUES ('media-user', 'media-user', 'Media User', 'disabled',
      'admin', 'active', 1, ?, ?)
  `).run(timestamp, timestamp);
}

function insertMedia(
  database: ReturnType<typeof openAppDatabase>,
  input: {
    checksum?: string;
    durationSeconds?: number | null;
    durationSource?: "provider-task" | "server-probe" | null;
    durationStatus?: "failed" | "not-applicable" | "pending" | "ready";
    height?: number | null;
    id: string;
    kind?: "audio" | "image" | "video";
    name: string;
    size?: number;
    status?: "failed" | "pending" | "ready";
    width?: number | null;
  },
) {
  const kind = input.kind ?? "image";
  database.prepare(`
    INSERT INTO media_assets (
      kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
      storage_backend, object_key, content_type, checksum_sha256,
      storage_status, duration_seconds, duration_source, duration_status,
      media_width, media_height
    ) VALUES (?, ?, 'media-user', ?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    kind,
    input.id,
    input.name,
    input.size ?? 5,
    timestamp,
    timestamp,
    input.name,
    kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
    input.checksum ?? digestA,
    input.status ?? "ready",
    input.durationSeconds === undefined ? (kind === "image" ? null : 1) : input.durationSeconds,
    input.durationSource === undefined
      ? kind === "image" ? null : "server-probe"
      : input.durationSource,
    input.durationStatus ?? (kind === "image" ? "not-applicable" : "ready"),
    input.width === undefined ? (kind === "audio" ? null : 1) : input.width,
    input.height === undefined ? (kind === "audio" ? null : 1) : input.height,
  );
}

function insertTask(
  database: ReturnType<typeof openAppDatabase>,
  input: {
    id: string;
    resultAssetId?: string;
    state: "running" | "success";
  },
) {
  database.prepare(`
    INSERT INTO generation_tasks (
      id, canvas_id, node_id, kind, prompt, parameters, idempotency_key,
      request_fingerprint, state, attempt, created_at, updated_at, owner_id,
      result_asset_id, model_configuration
    ) VALUES (?, 'media-canvas', ?, 'image', 'safe', '{}', ?, ?, ?, 1,
      ?, ?, 'media-user', ?, '{}')
  `).run(
    input.id,
    `node-${input.id}`,
    `key-${input.id}`,
    `fingerprint-${input.id}`,
    input.state,
    timestamp,
    timestamp,
    input.resultAssetId ?? null,
  );
}

function insertHistory(
  database: ReturnType<typeof openAppDatabase>,
  id: string,
) {
  database.prepare(`
    INSERT INTO asset_history (
      account_id, id, kind, label, preview, created_at, owner_id
    ) VALUES ('media-user', ?, 'image', 'Generated image', ?, ?, 'media-user')
  `).run(id, `/api/assets/${id}`, timestamp);
}

test("media integrity report is deterministic for a coherent schema-38 publication", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-clean-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, { id: "ready-image", name: "ready-image.png" });
    insertTask(database, {
      id: "ready-task",
      resultAssetId: "ready-image",
      state: "success",
    });
    insertHistory(database, "ready-image");
    database.close();

    const input = {
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [{
        logicalPath: "ready-image.png",
        sha256: digestA,
        size: 5,
      }],
      storageProfileIds: [],
    } as const;
    const first = inspectMediaIntegrity(input);
    const second = inspectMediaIntegrity(input);
    expect(first).toMatchObject({
      backupComplete: true,
      clean: true,
      counts: {
        assets: 1,
        issues: 0,
        publicationAttempts: 0,
        ready: 1,
      },
      schemaVersion: 38,
      version: 1,
    });
    expect(second).toEqual(first);
    expect(first.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("schema-37 reports omit publication rows and evidence hashes bind sorted local and OSS proof", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-schema37-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, { id: "legacy-image", name: "legacy.png" });
    database.exec(`
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
    `);
    database.close();
    const base = {
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [
        { logicalPath: "z-orphan.bin", sha256: digestB, size: 5 },
        { logicalPath: "legacy.png", sha256: digestA, size: 5 },
      ],
      ossEvidence: [
        {
          byteSize: 5,
          checksumSha256: digestA,
          objectKey: "objects/z",
          versionId: "version-z",
        },
        {
          byteSize: 5,
          checksumSha256: digestB,
          objectKey: "objects/a",
          versionId: "version-a",
        },
      ],
      storageProfileIds: [],
    } as const;
    const first = inspectMediaIntegrity(base);
    const reordered = inspectMediaIntegrity({
      ...base,
      files: [...base.files].reverse(),
      ossEvidence: [...base.ossEvidence].reverse(),
    });
    const changedVersion = inspectMediaIntegrity({
      ...base,
      ossEvidence: base.ossEvidence.map((item) => item.objectKey === "objects/a"
        ? { ...item, versionId: "version-a-2" }
        : item),
    });
    expect(first).toMatchObject({
      counts: { publicationAttempts: 0 },
      schemaVersion: 37,
    });
    expect(reordered).toEqual(first);
    expect(changedVersion.evidenceSha256).not.toBe(first.evidenceSha256);
    expect(changedVersion.sha256).not.toBe(first.sha256);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("ready duration, video dimensions, and publication metadata drift are reported", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-metadata-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, {
      durationSeconds: null,
      durationSource: null,
      durationStatus: "pending",
      id: "bad-audio",
      kind: "audio",
      name: "bad-audio.mp3",
    });
    insertMedia(database, {
      height: null,
      id: "bad-video",
      kind: "video",
      name: "bad-video.mp4",
      width: null,
    });
    insertMedia(database, { id: "drift-image", name: "drift.png" });
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, byte_size, checksum_sha256, media_width, media_height,
        created_at, updated_at
      ) VALUES (
        'published-drift', 'media-user', 'image', 'drift-image', 'upload',
        'published', 'local', 'drift.png', 'drift.png',
        '.publication-published-drift.generating', 'image/png', 5, ?, 1, 1,
        ?, ?
      )
    `).run(digestB, timestamp, timestamp);
    database.close();
    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [
        { logicalPath: "bad-audio.mp3", sha256: digestA, size: 5 },
        { logicalPath: "bad-video.mp4", sha256: digestA, size: 5 },
        { logicalPath: "drift.png", sha256: digestA, size: 5 },
      ],
      storageProfileIds: [],
    });
    expect(report.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "MEDIA_INTEGRITY_DURATION_METADATA_INVALID",
      "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISMATCH",
      "MEDIA_INTEGRITY_VIDEO_DIMENSIONS_MISSING",
    ]));
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("OSS media and publication journals bind to decrypted storage profile ids without exposing them", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-storage-profile-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    database.prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height, storage_profile_id
      ) VALUES (
        'image', 'remote-image', 'media-user', 'remote-image.png', 5, ?, ?,
        'oss', 'objects/remote-image', 'image/png', ?, 'ready', NULL, NULL,
        'not-applicable', 1, 1, 'private-profile-id'
      )
    `).run(timestamp, timestamp, digestA);
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, storage_profile_id,
        staging_name, content_type, created_at, updated_at
      ) VALUES (
        'failed-remote-publication', 'media-user', 'image', 'failed-remote',
        'upload', 'failed', 'oss', 'failed-remote.png',
        'objects/failed-remote', 'private-profile-id',
        '.publication-failed-remote.generating', 'image/png', ?, ?
      )
    `).run(timestamp, timestamp);
    database.close();
    const input = {
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [],
      ossEvidence: [{
        byteSize: 5,
        checksumSha256: digestA,
        objectKey: "objects/remote-image",
        versionId: "remote-version",
      }],
    } as const;
    const missing = inspectMediaIntegrity({
      ...input,
      storageProfileIds: [],
    });
    const profileIssues = missing.issues.filter(({ code }) =>
      code === "MEDIA_INTEGRITY_OSS_PROFILE_MISSING"
    );
    expect(profileIssues).toHaveLength(2);
    expect(profileIssues.every(({ backupBlocking }) => backupBlocking)).toBe(true);
    expect(JSON.stringify(profileIssues)).not.toContain("private-profile-id");
    expect(missing.backupComplete).toBe(false);

    const exact = inspectMediaIntegrity({
      ...input,
      storageProfileIds: ["private-profile-id"],
    });
    expect(exact.clean).toBe(true);
    expect(exact.backupComplete).toBe(true);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("generic history rows report exact owner, kind, and readiness drift without a success task", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-history-relationship-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (
        'other-media-user', 'other-media-user', 'Other Media User', 'disabled',
        'user', 'active', 0, ?, ?
      )
    `).run(timestamp, timestamp);
    insertMedia(database, { id: "history-owner", name: "history-owner.png" });
    insertMedia(database, { id: "history-kind", name: "history-kind.png" });
    insertMedia(database, {
      id: "history-pending",
      name: "history-pending.png",
      status: "pending",
    });
    const insert = database.prepare(`
      INSERT INTO asset_history (
        account_id, id, kind, label, preview, created_at, owner_id
      ) VALUES (?, ?, ?, 'History relationship', ?, ?, ?)
    `);
    insert.run(
      "media-user",
      "history-owner",
      "image",
      "/api/assets/history-owner",
      timestamp,
      "other-media-user",
    );
    insert.run(
      "media-user",
      "history-kind",
      "video",
      "/api/video-assets/history-kind",
      timestamp,
      "media-user",
    );
    insert.run(
      "media-user",
      "history-pending",
      "image",
      "/api/assets/history-pending",
      timestamp,
      "media-user",
    );
    database.close();

    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: [
        { logicalPath: "history-kind.png", sha256: digestA, size: 5 },
        { logicalPath: "history-owner.png", sha256: digestA, size: 5 },
        { logicalPath: "history-pending.png", sha256: digestA, size: 5 },
      ],
      storageProfileIds: [],
    });
    const relationshipIssues = report.issues.filter(({ code }) =>
      code.startsWith("MEDIA_INTEGRITY_HISTORY_MEDIA_")
    );
    expect(relationshipIssues.map(({ code }) => code)).toEqual([
      "MEDIA_INTEGRITY_HISTORY_MEDIA_KIND_MISMATCH",
      "MEDIA_INTEGRITY_HISTORY_MEDIA_NOT_READY",
      "MEDIA_INTEGRITY_HISTORY_MEDIA_OWNER_MISMATCH",
    ]);
    expect(relationshipIssues.every(({ backupBlocking }) => !backupBlocking))
      .toBe(true);
    expect(report.clean).toBe(false);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("media integrity reports orphan, status, checksum, journal, task, and dimension faults without mutation", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-matrix-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    insertMedia(database, { id: "checksum-image", name: "checksum.png" });
    insertTask(database, {
      id: "checksum-task",
      resultAssetId: "checksum-image",
      state: "success",
    });
    insertHistory(database, "checksum-image");
    insertMedia(database, { id: "missing-image", name: "missing.png" });
    insertMedia(database, {
      height: null,
      id: "dimension-image",
      name: "dimension.png",
      width: null,
    });
    insertMedia(database, {
      id: "pending-image",
      name: "pending.png",
      status: "pending",
    });
    insertMedia(database, {
      id: "failed-image",
      name: "failed.png",
      status: "failed",
    });
    insertTask(database, { id: "missing-result-task", state: "success" });
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, byte_size, checksum_sha256, created_at, updated_at
      ) VALUES (
        'active-upload', 'media-user', 'image', 'pending-image', 'upload',
        'staged', 'local', 'pending.png', 'pending.png',
        '.publication-active-upload.generating', 'image/png', 5, ?, ?, ?
      )
    `).run(digestA, timestamp, timestamp);
    database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, created_at, updated_at
      ) VALUES (
        'compensating-upload', 'media-user', 'image', 'lost-image', 'upload',
        'compensating', 'local', 'lost.png', 'lost.png',
        '.publication-compensating-upload.generating', 'image/png', ?, ?
      )
    `).run(timestamp, timestamp);
    database.close();
    const databasePath = join(fixture.dataDirectory, "unboundry.sqlite");
    const before = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath,
      files: [
        { logicalPath: "checksum.png", sha256: digestB, size: 5 },
        { logicalPath: "dimension.png", sha256: digestA, size: 5 },
        { logicalPath: "orphan.bin", sha256: digestA, size: 5 },
      ],
      storageProfileIds: [],
    });
    const after = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    expect(after).toBe(before);
    expect(report.clean).toBe(false);
    expect(report.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "MEDIA_INTEGRITY_CHECKSUM_MISMATCH",
      "MEDIA_INTEGRITY_IMAGE_DIMENSIONS_MISSING",
      "MEDIA_INTEGRITY_LOCAL_FILE_MISSING",
      "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
      "MEDIA_INTEGRITY_PUBLICATION_ACTIVE",
      "MEDIA_INTEGRITY_PUBLICATION_COMPENSATING",
      "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISSING",
      "MEDIA_INTEGRITY_PUBLICATION_STAGING_MISSING",
      "MEDIA_INTEGRITY_STATUS_FAILED",
      "MEDIA_INTEGRITY_STATUS_PENDING",
      "MEDIA_INTEGRITY_TASK_RESULT_ID_MISSING",
    ]));
    const codes = report.issues.map(({ code }) => code);
    expect(codes).toEqual([...codes].sort());
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("media integrity distinguishes upload adoption warnings from durable deletion blockers", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-lifecycle-");
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    seedUser(database);
    database.prepare(`
      INSERT INTO users (
        id, login_name, display_name, password_hash, role, status, protected,
        created_at, updated_at
      ) VALUES (?, ?, ?, 'disabled', 'user', 'active', 0, ?, ?)
    `).run(
      "media-user-delete-failed",
      "media-user-delete-failed",
      "Media User Delete Failed",
      timestamp,
      timestamp,
    );
    database.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at, deleted_at
      ) VALUES ('media-user', 'adoption-canvas', 'Adoption canvas', 1, 1, 1, NULL)
    `).run();
    database.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      ) VALUES (
        'media-user', 'adoption-canvas', 1, 1, ?, '[]',
        '{"x":0,"y":0,"zoom":1}', ?, NULL, 0
      )
    `).run(JSON.stringify([{
      data: { assetId: "adoption-coherent" },
      id: "image-node",
      type: "image",
    }]), timestamp);

    const publications = [
      {
        adoptedAt: timestamp,
        adoptedCanvasId: "adoption-canvas",
        assetId: "adoption-coherent",
        attemptId: "published-adoption-coherent",
      },
      {
        adoptedAt: timestamp,
        adoptedCanvasId: "adoption-canvas",
        assetId: "adoption-mismatch",
        attemptId: "published-adoption-mismatch",
      },
      {
        adoptedAt: timestamp,
        adoptedCanvasId: "missing-adoption-canvas",
        assetId: "adoption-provenance-missing",
        attemptId: "published-adoption-provenance-missing",
      },
      {
        adoptedAt: null,
        adoptedCanvasId: null,
        assetId: "upload-unadopted",
        attemptId: "published-upload-unadopted",
      },
    ] as const;
    const insertPublication = database.prepare(`
      INSERT INTO media_publication_attempts (
        attempt_id, owner_id, kind, asset_id, source, state,
        storage_backend, final_storage_name, object_key, staging_name,
        content_type, byte_size, checksum_sha256, media_width, media_height,
        adopted_at, adopted_canvas_id, created_at, updated_at
      ) VALUES (
        ?, 'media-user', 'image', ?, 'upload', 'published',
        'local', ?, ?, ?, 'image/png', 5, ?, 1, 1, ?, ?, ?, ?
      )
    `);
    for (const publication of publications) {
      const storageName = `${publication.assetId}.png`;
      insertMedia(database, {
        id: publication.assetId,
        name: storageName,
      });
      insertPublication.run(
        publication.attemptId,
        publication.assetId,
        storageName,
        storageName,
        `.publication-${publication.attemptId}.generating`,
        digestA,
        publication.adoptedAt,
        publication.adoptedCanvasId,
        timestamp,
        timestamp,
      );
    }
    database.prepare(`
      INSERT INTO media_delete_intents (
        owner_id, kind, asset_id, state, created_at, updated_at
      ) VALUES ('media-user', 'image', 'delete-active', 'delete-requested', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO media_delete_intents (
        owner_id, kind, asset_id, state, created_at, updated_at
      ) VALUES ('media-user', 'video', 'delete-failed', 'delete-failed', ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES ('media-user', 'running', NULL, 0, ?, ?)
    `).run(timestamp, timestamp);
    database.prepare(`
      INSERT INTO account_delete_intents (
        owner_id, state, error_code, retry_count, created_at, updated_at
      ) VALUES (
        'media-user-delete-failed', 'failed',
        'ACCOUNT_MEDIA_CLEANUP_FAILED', 1, ?, ?
      )
    `).run(timestamp, timestamp);
    database.close();

    const report = inspectMediaIntegrity({
      databaseLogicalSha256: logicalDatabaseHash,
      databasePath: join(fixture.dataDirectory, "unboundry.sqlite"),
      files: publications.map(({ assetId }) => ({
        logicalPath: `${assetId}.png`,
        sha256: digestA,
        size: 5,
      })),
      storageProfileIds: [],
    });
    const lifecycleIssues = report.issues.filter(({ code }) =>
      code.includes("_ADOPTION_") ||
      code.endsWith("_UPLOAD_UNADOPTED") ||
      code.includes("_DELETE_"));
    expect(lifecycleIssues.map(({ code }) => code)).toEqual([
      "MEDIA_INTEGRITY_ACCOUNT_DELETE_ACTIVE",
      "MEDIA_INTEGRITY_ACCOUNT_DELETE_FAILED",
      "MEDIA_INTEGRITY_DELETE_ACTIVE",
      "MEDIA_INTEGRITY_DELETE_FAILED",
      "MEDIA_INTEGRITY_UPLOAD_ADOPTION_MISMATCH",
      "MEDIA_INTEGRITY_UPLOAD_ADOPTION_PROVENANCE_MISSING",
      "MEDIA_INTEGRITY_UPLOAD_UNADOPTED",
    ]);
    expect(lifecycleIssues.filter(({ backupBlocking }) => backupBlocking)
      .map(({ code }) => code)).toEqual([
        "MEDIA_INTEGRITY_ACCOUNT_DELETE_ACTIVE",
        "MEDIA_INTEGRITY_ACCOUNT_DELETE_FAILED",
        "MEDIA_INTEGRITY_DELETE_ACTIVE",
        "MEDIA_INTEGRITY_DELETE_FAILED",
        "MEDIA_INTEGRITY_UPLOAD_UNADOPTED",
      ]);
    expect(lifecycleIssues.filter(({ severity }) => severity === "warning")
      .map(({ code }) => code)).toEqual([
        "MEDIA_INTEGRITY_UPLOAD_ADOPTION_MISMATCH",
        "MEDIA_INTEGRITY_UPLOAD_ADOPTION_PROVENANCE_MISSING",
      ]);
    expect(report.issues.filter(({ assetId }) =>
      assetId === "adoption-coherent"
    )).toEqual([]);
    expect(report.backupComplete).toBe(false);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("the read-only media report CLI requires a frozen absolute source and leaves it unchanged", async () => {
  const fixture = await fixtureRoot("unboundry-media-integrity-cli-");
  const scratchRoot = join(fixture.root, "scratch");
  await mkdir(scratchRoot, { mode: 0o700 });
  try {
    const database = openAppDatabase(fixture.dataDirectory);
    database.close();
    const databasePath = join(fixture.dataDirectory, "unboundry.sqlite");
    const before = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    const result = await execute(process.execPath, [
      "scripts/report-media-integrity.mjs",
      "--data-dir",
      fixture.dataDirectory,
      "--scratch-root",
      scratchRoot,
      "--source-frozen",
    ], { cwd: process.cwd() });
    expect(JSON.parse(result.stdout)).toMatchObject({
      clean: true,
      schemaVersion: 38,
      version: 1,
    });
    const after = createHash("sha256").update(await readFile(databasePath)).digest("hex");
    expect(after).toBe(before);
    expect(await readdir(scratchRoot)).toEqual([]);

    let rejected: Error & { stderr?: string } | undefined;
    try {
      await execute(process.execPath, [
        "scripts/report-media-integrity.mjs",
        "--data-dir",
        fixture.dataDirectory,
      ], { cwd: process.cwd() });
    } catch (error) {
      rejected = error as Error & { stderr?: string };
    }
    expect(JSON.parse(rejected?.stderr ?? "{}")).toMatchObject({
      code: "MEDIA_REPORT_ARGUMENT_INVALID",
    });
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});
