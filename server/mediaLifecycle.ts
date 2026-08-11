import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, open, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { deletePrivateAliyunOssObject } from "./aliyunOss";
import {
  appDataDirectory,
  currentSchemaManifest,
  currentSchemaVersion,
  openAppDatabase,
} from "./database";
import type {
  MediaKind,
  MediaRecord,
  MediaStorageBackend,
} from "./mediaRegistry";
import {
  readableMediaForOwner,
} from "./mediaRegistry";
import {
  storageProfileById,
  type AliyunStorageProfile,
} from "./secureStorageProfiles";
import { databaseMatchesSchemaContract } from "./runtimeLifecycle";
import { databaseMatchesFrozenSchema37Contract } from "./backupInspection";

const identifierPattern = /^[a-z0-9._-]+$/i;
const checksumPattern = /^[a-f0-9]{64}$/;
const activeStates = [
  "reserved",
  "staged",
  "external-ready",
  "compensating",
] as const;
const processStartupUploadRecoveryCutoff = new Date().toISOString();

type ActivePublicationState = (typeof activeStates)[number];

export class MediaPublicationConflictError extends Error {
  constructor() {
    super("Asset ID is unavailable");
    this.name = "MediaPublicationConflictError";
  }
}

export class MediaPublicationStateError extends Error {
  constructor(message = "Media publication changed concurrently") {
    super(message);
    this.name = "MediaPublicationStateError";
  }
}

export type GeneratedPublicationTask = {
  actualCostMicrounits: number;
  providerUsageTokens?: number;
  taskId: string;
};

export type MediaPublicationReservation = {
  attemptId: string;
  finalStorageName: string;
  id: string;
  kind: MediaKind;
  objectKey: string;
  ownerId: string;
  stagingName: string;
  storageBackend: MediaStorageBackend;
  storageProfileId: string | null;
  taskId?: string;
};

export type MediaPublicationMetadata = {
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  durationSeconds?: number;
  durationSource?: "provider-task" | "server-probe";
  mediaHeight?: number;
  mediaWidth?: number;
};

export type MediaPublicationExecution = Readonly<{
  beforePhysicalDelete?: (input: Readonly<{
    id: string;
    kind: MediaKind;
    media: MediaRecord;
  }>) => Promise<void> | void;
  beforeReservation?: () => Promise<void> | void;
  deleteExternalObject?: typeof deletePrivateAliyunOssObject;
  afterTransition?: (
    state: "external-ready" | "staged",
    reservation: MediaPublicationReservation,
  ) => Promise<void> | void;
}>;

type AttemptRow = {
  actual_cost_microunits: number | null;
  adopted_at: string | null;
  adopted_canvas_id: string | null;
  asset_id: string;
  attempt_id: string;
  byte_size: number;
  checksum_sha256: string | null;
  content_type: string;
  duration_seconds: number | null;
  duration_source: "provider-task" | "server-probe" | null;
  error_code: string | null;
  final_storage_name: string;
  history_label: string | null;
  kind: MediaKind;
  media_height: number | null;
  media_width: number | null;
  object_key: string;
  owner_id: string;
  provider_usage_tokens: number | null;
  source: "generation" | "upload";
  staging_name: string;
  state: ActivePublicationState | "failed" | "published";
  storage_backend: MediaStorageBackend;
  storage_profile_id: string | null;
  task_execution_attempt: number | null;
  task_id: string | null;
  updated_at: string;
};

type PendingGeneratedAttempt = AttemptRow & {
  media_storage_status: string | null;
  prompt: string;
  task_state: string;
};

function assertBasename(value: string, label: string) {
  if (
    value.length < 1 ||
    value.length > 240 ||
    basename(value) !== value ||
    value === "." ||
    value === ".."
  ) throw new Error(`Invalid ${label}`);
}

function assertReservationInput(input: {
  contentType: string;
  finalStorageName: string;
  id: string;
  kind: MediaKind;
  objectKey: string;
  ownerId: string;
  storageBackend: MediaStorageBackend;
  storageProfileId?: string;
}) {
  if (
    !identifierPattern.test(input.id) || input.id.length > 120 ||
    !identifierPattern.test(input.ownerId) || input.ownerId.length > 120 ||
    !["audio", "image", "video"].includes(input.kind) ||
    !["local", "oss"].includes(input.storageBackend) ||
    input.contentType.length < 1 || input.contentType.length > 160
  ) throw new Error("Invalid media publication reservation");
  assertBasename(input.finalStorageName, "media storage name");
  if (
    input.storageBackend === "local"
      ? input.objectKey !== input.finalStorageName
      : !input.objectKey.startsWith("objects/") || input.objectKey.includes("..")
  ) throw new Error("Invalid media object key");
  if (
    input.storageBackend === "oss" &&
    (!input.storageProfileId || input.storageProfileId.length > 120)
  ) throw new Error("Invalid media storage profile");
}

function transaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

function withDatabase<T>(operation: (database: DatabaseSync) => T) {
  const database = openAppDatabase();
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

function isConstraintError(error: unknown) {
  return error instanceof Error &&
    (error.message.includes("UNIQUE constraint failed") ||
      error.message.includes("constraint failed"));
}

export function reserveMediaPublication(input: {
  contentType: string;
  finalStorageName: string;
  historyLabel?: string;
  id: string;
  kind: MediaKind;
  objectKey: string;
  ownerId: string;
  storageBackend: MediaStorageBackend;
  storageProfileId?: string;
  task?: GeneratedPublicationTask;
}): MediaPublicationReservation {
  assertReservationInput(input);
  if (
    input.historyLabel !== undefined && input.historyLabel.length > 120 ||
    input.task &&
      (!identifierPattern.test(input.task.taskId) ||
        input.task.taskId.length > 120 ||
        !Number.isSafeInteger(input.task.actualCostMicrounits) ||
        input.task.actualCostMicrounits < 0 ||
        input.task.providerUsageTokens !== undefined &&
          (!Number.isSafeInteger(input.task.providerUsageTokens) ||
            input.task.providerUsageTokens < 0))
  ) throw new Error("Invalid media publication metadata");

  const attemptId = randomUUID();
  const stagingName = `.publication-${attemptId}.generating`;
  const timestamp = new Date().toISOString();
  return withDatabase((database) => transaction(database, () => {
    if (database.prepare(`
      SELECT 1 FROM account_delete_intents
      WHERE owner_id = ?
      LIMIT 1
    `).get(input.ownerId)) {
      throw new MediaPublicationConflictError();
    }
    if (database.prepare(`
      SELECT 1 FROM media_delete_intents
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
      LIMIT 1
    `).get(input.ownerId, input.kind, input.id)) {
      throw new MediaPublicationConflictError();
    }
    let taskAttempt: number | undefined;
    if (input.task) {
      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id
        FROM generation_tasks WHERE id = ?
      `).get(input.task.taskId) as
        | {
            attempt: number;
            kind: string;
            owner_id: string | null;
            result_asset_id: string | null;
            state: string;
          }
        | undefined;
      if (
        !task || task.owner_id !== input.ownerId || task.kind !== input.kind ||
        task.state !== "running" || task.result_asset_id !== null ||
        !Number.isSafeInteger(task.attempt) || task.attempt < 1
      ) {
        throw new MediaPublicationStateError(
          "Generation task cannot reserve this media result",
        );
      }
      taskAttempt = task.attempt;
    }
    try {
      database.prepare(`
        INSERT INTO media_assets (
          kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
          storage_backend, storage_profile_id, object_key, content_type,
          checksum_sha256, storage_status, duration_seconds, duration_source,
          duration_status, media_width, media_height
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, '', 'pending', NULL, NULL, ?, NULL, NULL)
      `).run(
        input.kind, input.id, input.ownerId, input.finalStorageName,
        timestamp, timestamp, input.storageBackend,
        input.storageProfileId ?? null, input.objectKey, input.contentType,
        input.kind === "image" ? "not-applicable" : "pending",
      );
      database.prepare(`
        INSERT INTO media_publication_attempts (
          attempt_id, owner_id, kind, asset_id, source, state,
          storage_backend, final_storage_name, object_key, storage_profile_id,
          staging_name, task_id, task_execution_attempt, history_label,
          content_type, actual_cost_microunits, provider_usage_tokens,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attemptId, input.ownerId, input.kind, input.id,
        input.task ? "generation" : "upload",
        input.storageBackend, input.finalStorageName, input.objectKey,
        input.storageProfileId ?? null, stagingName,
        input.task?.taskId ?? null, taskAttempt ?? null,
        input.historyLabel?.trim().slice(0, 120) || null,
        input.contentType, input.task?.actualCostMicrounits ?? null,
        input.task?.providerUsageTokens ?? null, timestamp, timestamp,
      );
    } catch (error) {
      if (isConstraintError(error)) throw new MediaPublicationConflictError();
      throw error;
    }
    if (input.task) {
      const linked = database.prepare(`
        UPDATE generation_tasks
        SET result_asset_id = ?, actual_cost_microunits = ?,
            provider_usage_tokens = ?, updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = ? AND state = 'running'
          AND attempt = ? AND result_asset_id IS NULL
      `).run(
        input.id, input.task.actualCostMicrounits,
        input.task.providerUsageTokens ?? null, timestamp,
        input.task.taskId, input.ownerId, input.kind, taskAttempt!,
      );
      if (linked.changes !== 1) throw new MediaPublicationStateError();
    }
    return {
      attemptId,
      finalStorageName: input.finalStorageName,
      id: input.id,
      kind: input.kind,
      objectKey: input.objectKey,
      ownerId: input.ownerId,
      stagingName,
      storageBackend: input.storageBackend,
      storageProfileId: input.storageProfileId ?? null,
      taskId: input.task?.taskId,
    };
  }));
}

function reservationTuple(reservation: MediaPublicationReservation) {
  return [
    reservation.attemptId, reservation.ownerId, reservation.kind,
    reservation.id, reservation.storageBackend, reservation.storageProfileId,
    reservation.objectKey, reservation.finalStorageName, reservation.stagingName,
  ] as const;
}

function readAttempt(
  database: DatabaseSync,
  reservation: MediaPublicationReservation,
) {
  return database.prepare(`
    SELECT * FROM media_publication_attempts
    WHERE attempt_id = ? AND owner_id = ? AND kind = ? AND asset_id = ?
      AND storage_backend = ? AND storage_profile_id IS ? AND object_key = ?
      AND final_storage_name = ? AND staging_name = ?
  `).get(...reservationTuple(reservation)) as AttemptRow | undefined;
}

function assertAttemptState(
  row: AttemptRow | undefined,
  ...states: AttemptRow["state"][]
) {
  if (!row || !states.includes(row.state)) throw new MediaPublicationStateError();
  return row;
}

export function stageMediaPublication(
  reservation: MediaPublicationReservation,
  metadata: MediaPublicationMetadata,
) {
  if (
    !Number.isSafeInteger(metadata.byteSize) || metadata.byteSize < 1 ||
    !checksumPattern.test(metadata.checksumSha256) ||
    metadata.contentType.length < 1 || metadata.contentType.length > 160 ||
    metadata.durationSeconds !== undefined &&
      (!Number.isFinite(metadata.durationSeconds) || metadata.durationSeconds <= 0) ||
    metadata.mediaWidth !== undefined &&
      (!Number.isSafeInteger(metadata.mediaWidth) || metadata.mediaWidth < 1) ||
    metadata.mediaHeight !== undefined &&
      (!Number.isSafeInteger(metadata.mediaHeight) || metadata.mediaHeight < 1)
  ) throw new Error("Invalid staged media metadata");
  withDatabase((database) => transaction(database, () => {
    assertAttemptState(readAttempt(database, reservation), "reserved");
    const timestamp = new Date().toISOString();
    const media = database.prepare(`
      UPDATE media_assets
      SET byte_size = ?, checksum_sha256 = ?, content_type = ?,
          duration_seconds = ?, duration_source = ?, duration_status = ?,
          media_width = ?, media_height = ?, updated_at = ?
      WHERE owner_id = ? AND kind = ? AND id = ? AND storage_status = 'pending'
        AND storage_name = ? AND storage_backend = ?
        AND storage_profile_id IS ? AND object_key = ?
    `).run(
      metadata.byteSize, metadata.checksumSha256, metadata.contentType,
      metadata.durationSeconds ?? null,
      metadata.durationSeconds === undefined
        ? null
        : metadata.durationSource ?? "server-probe",
      metadata.durationSeconds === undefined
        ? reservation.kind === "image" ? "not-applicable" : "pending"
        : "ready",
      metadata.mediaWidth ?? null, metadata.mediaHeight ?? null, timestamp,
      reservation.ownerId, reservation.kind, reservation.id,
      reservation.finalStorageName, reservation.storageBackend,
      reservation.storageProfileId, reservation.objectKey,
    );
    if (media.changes !== 1) throw new MediaPublicationStateError();
    const attempt = database.prepare(`
      UPDATE media_publication_attempts
      SET state = 'staged', byte_size = ?, checksum_sha256 = ?,
          content_type = ?, duration_seconds = ?, duration_source = ?,
          media_width = ?, media_height = ?, updated_at = ?
      WHERE attempt_id = ? AND state = 'reserved'
    `).run(
      metadata.byteSize, metadata.checksumSha256, metadata.contentType,
      metadata.durationSeconds ?? null,
      metadata.durationSeconds === undefined
        ? null
        : metadata.durationSource ?? "server-probe",
      metadata.mediaWidth ?? null, metadata.mediaHeight ?? null, timestamp,
      reservation.attemptId,
    );
    if (attempt.changes !== 1) throw new MediaPublicationStateError();
  }));
}

export function mediaPublicationStagingPath(
  reservation: MediaPublicationReservation,
) {
  return join(appDataDirectory(), "media", reservation.stagingName);
}

export function mediaPublicationFinalPath(
  reservation: MediaPublicationReservation,
) {
  return join(appDataDirectory(), "media", reservation.finalStorageName);
}

async function fsyncPath(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishLocalMediaPublication(
  reservation: MediaPublicationReservation,
) {
  if (reservation.storageBackend !== "local") throw new Error("Local publication expected");
  withDatabase((database) => {
    assertAttemptState(readAttempt(database, reservation), "staged", "external-ready");
  });
  const directory = join(appDataDirectory(), "media");
  await mkdir(directory, { recursive: true });
  await fsyncPath(mediaPublicationStagingPath(reservation));
  try {
    await link(
      mediaPublicationStagingPath(reservation),
      mediaPublicationFinalPath(reservation),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    const attempt = withDatabase((database) => readAttempt(database, reservation));
    if (!attempt?.checksum_sha256 || attempt.byte_size < 1) throw error;
    const info = await stat(mediaPublicationFinalPath(reservation));
    if (
      !info.isFile() || info.size !== attempt.byte_size ||
      await sha256File(mediaPublicationFinalPath(reservation)) !== attempt.checksum_sha256
    ) throw new MediaPublicationConflictError();
  }
  await fsyncPath(directory);
  markExternalMediaPublicationReady(reservation);
}

export function markExternalMediaPublicationReady(
  reservation: MediaPublicationReservation,
) {
  withDatabase((database) => transaction(database, () => {
    const row = assertAttemptState(
      readAttempt(database, reservation),
      "staged",
      "external-ready",
    );
    if (row.state === "external-ready") return;
    const changed = database.prepare(`
      UPDATE media_publication_attempts
      SET state = 'external-ready', updated_at = ?
      WHERE attempt_id = ? AND state = 'staged'
    `).run(new Date().toISOString(), reservation.attemptId);
    if (changed.changes !== 1) throw new MediaPublicationStateError();
  }));
}

function previewFor(kind: MediaKind, id: string) {
  return kind === "video"
    ? `/api/video-assets/${id}`
    : kind === "audio"
      ? `/api/audio-assets/${id}`
      : `/api/assets/${id}`;
}

function defaultLabel(kind: MediaKind) {
  return kind === "video" ? "生成视频" : kind === "audio" ? "生成音频" : "生成图片";
}

export function finalizeMediaPublication(
  reservation: MediaPublicationReservation,
) {
  withDatabase((database) => transaction(database, () => {
    const row = readAttempt(database, reservation);
    if (row?.state === "published") return;
    const attempt = assertAttemptState(row, "external-ready");
    if (
      attempt.byte_size < 1 || !attempt.checksum_sha256 ||
      !checksumPattern.test(attempt.checksum_sha256)
    ) throw new MediaPublicationStateError("Media publication is not verified");
    const timestamp = new Date().toISOString();
    if (attempt.task_id) {
      const task = database.prepare(`
        SELECT owner_id, kind, state, attempt, result_asset_id
        FROM generation_tasks WHERE id = ?
      `).get(attempt.task_id) as
        | {
            attempt: number;
            kind: string;
            owner_id: string | null;
            result_asset_id: string | null;
            state: string;
          }
        | undefined;
      if (
        !task || task.owner_id !== reservation.ownerId ||
        task.kind !== reservation.kind ||
        !["running", "recovering"].includes(task.state) ||
        task.attempt !== attempt.task_execution_attempt ||
        task.result_asset_id !== reservation.id
      ) throw new MediaPublicationStateError("Generation task lost publication ownership");
    }
    const ready = database.prepare(`
      UPDATE media_assets SET storage_status = 'ready', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND id = ? AND storage_status = 'pending'
        AND storage_name = ? AND storage_backend = ?
        AND storage_profile_id IS ? AND object_key = ?
    `).run(
      timestamp, reservation.ownerId, reservation.kind, reservation.id,
      reservation.finalStorageName, reservation.storageBackend,
      reservation.storageProfileId, reservation.objectKey,
    );
    if (ready.changes !== 1) throw new MediaPublicationStateError();
    if (attempt.history_label || attempt.task_id) {
      database.prepare(`
        INSERT INTO asset_history (
          account_id, id, kind, label, preview, created_at, owner_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET
          kind = excluded.kind, label = excluded.label,
          preview = excluded.preview, owner_id = excluded.owner_id
      `).run(
        reservation.ownerId, reservation.id, reservation.kind,
        attempt.history_label || defaultLabel(reservation.kind),
        previewFor(reservation.kind, reservation.id), timestamp,
        reservation.ownerId,
      );
    }
    if (attempt.task_id) {
      const completed = database.prepare(`
        UPDATE generation_tasks
        SET state = 'success', error_code = NULL, error_message = NULL,
            updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = ?
          AND attempt = ? AND state IN ('running', 'recovering')
          AND result_asset_id = ?
      `).run(
        timestamp, attempt.task_id, reservation.ownerId, reservation.kind,
        attempt.task_execution_attempt, reservation.id,
      );
      if (completed.changes !== 1) throw new MediaPublicationStateError();
      database.prepare(`
        INSERT INTO generation_task_events (
          task_id, state, error_code, error_message, created_at
        ) VALUES (?, 'success', NULL, NULL, ?)
      `).run(attempt.task_id, timestamp);
    }
    const published = database.prepare(`
      UPDATE media_publication_attempts
      SET state = 'published', updated_at = ?
      WHERE attempt_id = ? AND state = 'external-ready'
    `).run(timestamp, reservation.attemptId);
    if (published.changes !== 1) throw new MediaPublicationStateError();
  }));
}

export type DurableMediaReference = Readonly<{
  assetId: string;
  kind: MediaKind;
}>;

/**
 * A successful upload is not a durable user root until the canvas document
 * that names it commits. The canvas writer calls this while holding the same
 * BEGIN IMMEDIATE transaction used for the document upsert, so restart
 * compensation and first adoption are mutually exclusive.
 */
export function adoptUploadedMediaReferences(
  database: DatabaseSync,
  input: Readonly<{
    canvasId: string;
    ownerId: string;
    references: readonly DurableMediaReference[];
  }>,
) {
  const timestamp = new Date().toISOString();
  const unique = new Map(
    input.references.map((reference) => [
      `${reference.kind}\0${reference.assetId}`,
      reference,
    ]),
  );
  for (const reference of unique.values()) {
    const deletion = database.prepare(`
      SELECT 1 FROM media_delete_intents
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
      LIMIT 1
    `).get(input.ownerId, reference.kind, reference.assetId);
    // Delete intents are permanent identity tombstones. Check them even when
    // the upload was adopted previously (or no publication row exists), so a
    // late/new canvas save can never revive an identity whose cleanup won the
    // same SQLite writer-lock race.
    if (deletion) throw new MediaPublicationConflictError();
    const attempt = database.prepare(`
      SELECT attempt_id, state, adopted_at
      FROM media_publication_attempts
      WHERE owner_id = ? AND source = 'upload'
        AND kind = ? AND asset_id = ?
      ORDER BY created_at DESC, attempt_id DESC
      LIMIT 1
    `).get(input.ownerId, reference.kind, reference.assetId) as
      | { adopted_at: string | null; attempt_id: string; state: string }
      | undefined;
    if (!attempt || attempt.adopted_at) continue;
    if (attempt.state !== "published") {
      throw new MediaPublicationConflictError();
    }
    const adopted = database.prepare(`
      UPDATE media_publication_attempts
      SET adopted_at = ?, adopted_canvas_id = ?, updated_at = ?
      WHERE attempt_id = ? AND owner_id = ? AND source = 'upload'
        AND kind = ? AND asset_id = ? AND state = 'published'
        AND adopted_at IS NULL AND adopted_canvas_id IS NULL
        AND EXISTS (
          SELECT 1 FROM media_assets
          WHERE owner_id = ? AND kind = ? AND id = ?
            AND storage_status = 'ready'
        )
    `).run(
      timestamp,
      input.canvasId,
      timestamp,
      attempt.attempt_id,
      input.ownerId,
      reference.kind,
      reference.assetId,
      input.ownerId,
      reference.kind,
      reference.assetId,
    );
    if (adopted.changes !== 1) throw new MediaPublicationConflictError();
  }
}

export function failMediaPublication(
  reservation: MediaPublicationReservation,
  code = "MEDIA_PUBLICATION_FAILED",
) {
  return withDatabase((database) => transaction(database, () => {
    const attempt = readAttempt(database, reservation);
    if (!attempt || attempt.state === "failed") return false;
    if (attempt.state === "published") return false;
    const timestamp = new Date().toISOString();
    const marked = database.prepare(`
      UPDATE media_publication_attempts
      SET state = 'compensating', error_code = ?, retry_count = retry_count + 1,
          updated_at = ?
      WHERE attempt_id = ?
        AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
    `).run(code.slice(0, 80), timestamp, reservation.attemptId);
    if (marked.changes !== 1) throw new MediaPublicationStateError();
    database.prepare(`
      UPDATE media_assets
      SET storage_status = 'failed', duration_status = CASE
            WHEN kind = 'image' THEN 'not-applicable' ELSE 'failed' END,
          updated_at = ?
      WHERE owner_id = ? AND kind = ? AND id = ? AND storage_status <> 'ready'
    `).run(timestamp, reservation.ownerId, reservation.kind, reservation.id);
    database.prepare(`
      DELETE FROM asset_history
      WHERE account_id = ? AND owner_id = ? AND id = ? AND kind = ?
    `).run(
      reservation.ownerId, reservation.ownerId,
      reservation.id, reservation.kind,
    );
    if (attempt.task_id) {
      const failed = database.prepare(`
        UPDATE generation_tasks
        SET state = CASE
              WHEN state IN ('running', 'recovering') THEN 'failed' ELSE state END,
            result_asset_id = NULL,
            error_code = CASE
              WHEN state IN ('running', 'recovering') THEN ? ELSE error_code END,
            error_message = CASE
              WHEN state IN ('running', 'recovering')
              THEN '生成结果未能安全发布，系统未重新请求模型' ELSE error_message END,
            updated_at = ?
        WHERE id = ? AND owner_id = ? AND kind = ?
          AND attempt = ? AND state <> 'success' AND result_asset_id = ?
      `).run(
        code.slice(0, 80), timestamp, attempt.task_id,
        reservation.ownerId, reservation.kind,
        attempt.task_execution_attempt, reservation.id,
      );
      if (failed.changes === 1) {
        const state = database.prepare(
          "SELECT state FROM generation_tasks WHERE id = ?",
        ).get(attempt.task_id) as { state: string } | undefined;
        if (state?.state === "failed") {
          database.prepare(`
            INSERT INTO generation_task_events (
              task_id, state, error_code, error_message, created_at
            ) VALUES (?, 'failed', ?, ?, ?)
          `).run(
            attempt.task_id, code.slice(0, 80),
            "生成结果未能安全发布，系统未重新请求模型", timestamp,
          );
        }
      }
    }
    return true;
  }));
}

async function removeExternal(
  reservation: MediaPublicationReservation,
  media?: MediaRecord,
  profile?: AliyunStorageProfile,
  deleteExternalObject: typeof deletePrivateAliyunOssObject =
    deletePrivateAliyunOssObject,
) {
  if (reservation.storageBackend === "oss") {
    const credentials = profile ??
      await storageProfileById(reservation.storageProfileId);
    if (!credentials || !reservation.objectKey) {
      throw new Error("OSS unavailable");
    }
    await deleteExternalObject(reservation.objectKey, credentials);
  } else {
    const attempt = withDatabase((database) => readAttempt(database, reservation));
    if (
      attempt?.checksum_sha256 &&
      attempt.byte_size > 0 &&
      await validFile(mediaPublicationFinalPath(reservation), attempt)
    ) {
      await rm(mediaPublicationFinalPath(reservation), { force: true });
    }
  }
  await rm(mediaPublicationStagingPath(reservation), { force: true });
}

export async function compensateMediaPublication(
  reservation: MediaPublicationReservation,
  input?: {
    code?: string;
    deleteExternalObject?: typeof deletePrivateAliyunOssObject;
    media?: MediaRecord;
    profile?: AliyunStorageProfile;
  },
) {
  const compensating = failMediaPublication(reservation, input?.code);
  if (!compensating) return false;
  try {
    await removeExternal(
      reservation,
      input?.media,
      input?.profile,
      input?.deleteExternalObject,
    );
  } catch {
    return false;
  }
  return finishCompensatingMediaPublication(reservation);
}

function finishCompensatingMediaPublication(
  reservation: MediaPublicationReservation,
) {
  return withDatabase((database) => transaction(database, () => {
    const attempt = assertAttemptState(
      readAttempt(database, reservation),
      "compensating",
      "failed",
    );
    if (attempt.state === "compensating") {
      database.prepare(`
        UPDATE media_publication_attempts
        SET state = 'failed', updated_at = ?
        WHERE attempt_id = ? AND state = 'compensating'
      `).run(new Date().toISOString(), reservation.attemptId);
    }
    database.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = ? AND kind = ? AND id = ? AND storage_status = 'failed'
        AND storage_name = ? AND storage_backend = ?
        AND storage_profile_id IS ? AND object_key = ?
    `).run(
      reservation.ownerId, reservation.kind, reservation.id,
      reservation.finalStorageName, reservation.storageBackend,
      reservation.storageProfileId, reservation.objectKey,
    );
    return true;
  }));
}

export async function cleanupPublicationStaging(
  reservation: MediaPublicationReservation,
) {
  await rm(mediaPublicationStagingPath(reservation), { force: true });
}

export function pendingGeneratedPublicationTaskIds() {
  return new Set(withDatabase((database) =>
    (database.prepare(`
      SELECT publication.task_id AS id
      FROM media_publication_attempts AS publication
      JOIN generation_tasks AS task ON task.id = publication.task_id
      WHERE publication.source = 'generation'
        AND publication.state IN ('reserved', 'staged', 'external-ready')
        AND task.state = 'recovering'
    `).all() as Array<{ id: string }>).map(({ id }) => id)
  ));
}

export function hasPendingGeneratedMediaPublications() {
  return withDatabase((database) => Boolean(database.prepare(`
    SELECT 1 FROM media_publication_attempts
    WHERE source = 'generation'
      AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
    LIMIT 1
  `).get()));
}

export function hasPendingMediaDeletions(input?: { updatedBefore?: string }) {
  const updatedBefore = input?.updatedBefore ?? processStartupUploadRecoveryCutoff;
  return withDatabase((database) => Boolean(database.prepare(`
    SELECT 1
    FROM media_delete_intents AS deletion
    JOIN media_assets AS media
      ON media.owner_id = deletion.owner_id
      AND media.kind = deletion.kind
      AND media.id = deletion.asset_id
    WHERE deletion.state IN ('delete-requested', 'delete-failed')
      AND deletion.updated_at < ?
    LIMIT 1
  `).get(updatedBefore)));
}

type PendingMediaDeletion = Readonly<{
  asset_id: string;
  byte_size: number;
  checksum_sha256: string;
  content_type: string;
  duration_seconds: number | null;
  duration_source: "provider-task" | "server-probe" | null;
  duration_status: "failed" | "not-applicable" | "pending" | "ready";
  intent_state: "delete-failed" | "delete-requested";
  intent_updated_at: string;
  kind: MediaKind;
  media_height: number | null;
  media_width: number | null;
  object_key: string;
  owner_id: string;
  storage_backend: MediaStorageBackend;
  storage_name: string;
  storage_profile_id: string | null;
  storage_status: "failed" | "pending" | "ready";
}>;

function pendingMediaDeletions(updatedBefore: string) {
  return withDatabase((database) => database.prepare(`
    SELECT
      deletion.owner_id, deletion.kind, deletion.asset_id,
      deletion.state AS intent_state,
      deletion.updated_at AS intent_updated_at,
      media.storage_name, media.byte_size, media.storage_backend,
      media.storage_profile_id, media.object_key, media.content_type,
      media.checksum_sha256, media.storage_status, media.duration_seconds,
      media.duration_source, media.duration_status, media.media_width,
      media.media_height
    FROM media_delete_intents AS deletion
    JOIN media_assets AS media
      ON media.owner_id = deletion.owner_id
      AND media.kind = deletion.kind
      AND media.id = deletion.asset_id
    WHERE deletion.state IN ('delete-requested', 'delete-failed')
      AND deletion.updated_at < ?
    ORDER BY deletion.updated_at, deletion.owner_id,
             deletion.kind, deletion.asset_id
  `).all(updatedBefore) as PendingMediaDeletion[]);
}

function claimPendingMediaDeletion(row: PendingMediaDeletion) {
  return withDatabase((database) => transaction(database, () => {
    const timestamp = new Date().toISOString();
    const claimed = database.prepare(`
      UPDATE media_delete_intents
      SET state = 'delete-requested', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = ? AND updated_at = ?
    `).run(
      timestamp,
      row.owner_id,
      row.kind,
      row.asset_id,
      row.intent_state,
      row.intent_updated_at,
    );
    if (claimed.changes !== 1) return false;
    database.prepare(`
      UPDATE media_publication_attempts
      SET error_code = 'MEDIA_DELETE_REQUESTED', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND source = 'upload' AND state = 'compensating'
        AND error_code IN ('MEDIA_DELETE_REQUESTED', 'MEDIA_DELETE_FAILED')
    `).run(timestamp, row.owner_id, row.kind, row.asset_id);
    return true;
  }));
}

function finishPendingMediaDeletion(
  row: PendingMediaDeletion,
  success: boolean,
) {
  return withDatabase((database) => transaction(database, () => {
    const timestamp = new Date().toISOString();
    if (!success) {
      const failed = database.prepare(`
        UPDATE media_delete_intents
        SET state = 'delete-failed', updated_at = ?
        WHERE owner_id = ? AND kind = ? AND asset_id = ?
          AND state = 'delete-requested'
      `).run(timestamp, row.owner_id, row.kind, row.asset_id);
      if (failed.changes !== 1) return false;
      database.prepare(`
        UPDATE media_publication_attempts
        SET error_code = 'MEDIA_DELETE_FAILED', updated_at = ?
        WHERE owner_id = ? AND kind = ? AND asset_id = ?
          AND source = 'upload' AND state = 'compensating'
          AND error_code = 'MEDIA_DELETE_REQUESTED'
      `).run(timestamp, row.owner_id, row.kind, row.asset_id);
      return true;
    }
    const removed = database.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = ? AND kind = ? AND id = ?
        AND storage_status = 'failed' AND storage_name = ?
        AND storage_backend = ? AND storage_profile_id IS ?
        AND object_key = ?
    `).run(
      row.owner_id,
      row.kind,
      row.asset_id,
      row.storage_name,
      row.storage_backend,
      row.storage_profile_id,
      row.object_key,
    );
    if (removed.changes !== 1) throw new MediaPublicationStateError();
    database.prepare(`
      UPDATE media_publication_attempts
      SET state = 'failed', error_code = 'MEDIA_DELETED', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND source = 'upload' AND state = 'compensating'
        AND error_code = 'MEDIA_DELETE_REQUESTED'
    `).run(timestamp, row.owner_id, row.kind, row.asset_id);
    const completed = database.prepare(`
      UPDATE media_delete_intents
      SET state = 'tombstone', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = 'delete-requested'
    `).run(timestamp, row.owner_id, row.kind, row.asset_id);
    if (completed.changes !== 1) throw new MediaPublicationStateError();
    return true;
  }));
}

export async function recoverPendingMediaDeletions(input?: {
  deleteExternalObject?: typeof deletePrivateAliyunOssObject;
  updatedBefore?: string;
}) {
  const updatedBefore = input?.updatedBefore ?? processStartupUploadRecoveryCutoff;
  const outcomes: Array<{
    action: "blocked" | "deleted";
    assetId: string;
    kind: MediaKind;
    ownerId: string;
  }> = [];
  for (const row of pendingMediaDeletions(updatedBefore)) {
    if (!claimPendingMediaDeletion(row)) continue;
    const media: MediaRecord = {
      byteSize: row.byte_size,
      checksumSha256: row.checksum_sha256,
      contentType: row.content_type,
      durationSeconds: row.duration_seconds,
      durationSource: row.duration_source,
      durationStatus: row.duration_status,
      mediaHeight: row.media_height,
      mediaWidth: row.media_width,
      objectKey: row.object_key,
      storageBackend: row.storage_backend,
      storageName: row.storage_name,
      storageProfileId: row.storage_profile_id,
      storageStatus: row.storage_status,
    };
    let removed = false;
    try {
      if (row.storage_backend === "oss") {
        const profile = await storageProfileById(row.storage_profile_id);
        if (!profile || !row.object_key) throw new Error("OSS unavailable");
        await (input?.deleteExternalObject ?? deletePrivateAliyunOssObject)(
          row.object_key,
          profile,
        );
      } else {
        assertBasename(row.storage_name, "media storage name");
        await rm(join(appDataDirectory(), "media", row.storage_name), {
          force: true,
        });
      }
      removed = finishPendingMediaDeletion(row, true);
    } catch {
      finishPendingMediaDeletion(row, false);
    }
    outcomes.push({
      action: removed ? "deleted" : "blocked",
      assetId: row.asset_id,
      kind: row.kind,
      ownerId: row.owner_id,
    });
  }
  return outcomes;
}

export function hasPendingUploadMediaPublications(input?: {
  /** @deprecated Use updatedBefore. Kept for frozen-callsite compatibility. */
  createdBefore?: string;
  updatedBefore?: string;
}) {
  const updatedBefore = input?.updatedBefore ?? input?.createdBefore ??
    processStartupUploadRecoveryCutoff;
  return withDatabase((database) => Boolean(database.prepare(`
    SELECT 1 FROM media_publication_attempts
    WHERE source = 'upload'
      AND adopted_at IS NULL
      AND (
        state IN ('reserved', 'staged', 'external-ready', 'published')
        OR (
          state = 'compensating'
          AND COALESCE(error_code, '') NOT IN (
            'MEDIA_DELETE_REQUESTED', 'MEDIA_DELETE_FAILED'
          )
        )
      )
      AND updated_at < ?
    LIMIT 1
  `).get(updatedBefore)));
}

function pendingUploadAttempts(updatedBefore: string) {
  return withDatabase((database) => database.prepare(`
    SELECT * FROM media_publication_attempts
    WHERE source = 'upload'
      AND adopted_at IS NULL
      AND (
        state IN ('reserved', 'staged', 'external-ready', 'published')
        OR (
          state = 'compensating'
          AND COALESCE(error_code, '') NOT IN (
            'MEDIA_DELETE_REQUESTED', 'MEDIA_DELETE_FAILED'
          )
        )
      )
      AND updated_at < ?
    ORDER BY updated_at, attempt_id
  `).all(updatedBefore) as AttemptRow[]);
}

function claimUploadRecovery(
  reservation: MediaPublicationReservation,
  updatedBefore: string,
) {
  return withDatabase((database) => transaction(database, () => {
    const row = readAttempt(database, reservation);
    if (
      !row || row.source !== "upload" || row.adopted_at !== null ||
      row.updated_at >= updatedBefore ||
      ![
        "reserved",
        "staged",
        "external-ready",
        "published",
        "compensating",
      ].includes(row.state) ||
      row.state === "compensating" &&
        ["MEDIA_DELETE_REQUESTED", "MEDIA_DELETE_FAILED"].includes(
          row.error_code ?? "",
        )
    ) return false;
    const existingIntent = database.prepare(`
      SELECT state FROM media_delete_intents
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
    `).get(reservation.ownerId, reservation.kind, reservation.id) as
      | { state: string }
      | undefined;
    if (
      existingIntent &&
      existingIntent.state !== "tombstone"
    ) return false;
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO media_delete_intents (
        owner_id, kind, asset_id, state, created_at, updated_at
      ) VALUES (?, ?, ?, 'tombstone', ?, ?)
      ON CONFLICT(owner_id, kind, asset_id) DO UPDATE SET
        updated_at = excluded.updated_at
      WHERE media_delete_intents.state = 'tombstone'
    `).run(
      reservation.ownerId,
      reservation.kind,
      reservation.id,
      timestamp,
      timestamp,
    );
    const claimed = database.prepare(`
      UPDATE media_publication_attempts
      SET state = 'compensating',
          error_code = 'MEDIA_RECOVERY_UNADOPTED_UPLOAD',
          retry_count = retry_count + 1, updated_at = ?
      WHERE attempt_id = ? AND owner_id = ? AND source = 'upload'
        AND kind = ? AND asset_id = ? AND adopted_at IS NULL
        AND updated_at = ?
        AND (
          state IN ('reserved', 'staged', 'external-ready', 'published')
          OR (
            state = 'compensating'
            AND COALESCE(error_code, '') NOT IN (
              'MEDIA_DELETE_REQUESTED', 'MEDIA_DELETE_FAILED'
            )
          )
        )
    `).run(
      timestamp,
      reservation.attemptId,
      reservation.ownerId,
      reservation.kind,
      reservation.id,
      row.updated_at,
    );
    if (claimed.changes !== 1) throw new MediaPublicationStateError();
    database.prepare(`
      UPDATE media_assets
      SET storage_status = 'failed', duration_status = CASE
            WHEN kind = 'image' THEN 'not-applicable' ELSE 'failed' END,
          updated_at = ?
      WHERE owner_id = ? AND kind = ? AND id = ?
        AND storage_status IN ('pending', 'ready', 'failed')
    `).run(timestamp, reservation.ownerId, reservation.kind, reservation.id);
    database.prepare(`
      DELETE FROM asset_history
      WHERE account_id = ? AND owner_id = ? AND id = ? AND kind = ?
    `).run(
      reservation.ownerId,
      reservation.ownerId,
      reservation.id,
      reservation.kind,
    );
    return true;
  }));
}

function pendingGeneratedAttempts() {
  return withDatabase((database) => database.prepare(`
    SELECT publication.*, task.state AS task_state, task.prompt,
           media.storage_status AS media_storage_status
    FROM media_publication_attempts AS publication
    JOIN generation_tasks AS task ON task.id = publication.task_id
    LEFT JOIN media_assets AS media
      ON media.owner_id = publication.owner_id
      AND media.kind = publication.kind
      AND media.id = publication.asset_id
    WHERE publication.source = 'generation'
      AND publication.state IN (
        'reserved', 'staged', 'external-ready', 'compensating'
      )
    ORDER BY publication.created_at, publication.attempt_id
  `).all() as PendingGeneratedAttempt[]);
}

function reservationFromAttempt(row: AttemptRow): MediaPublicationReservation {
  return {
    attemptId: row.attempt_id,
    finalStorageName: row.final_storage_name,
    id: row.asset_id,
    kind: row.kind,
    objectKey: row.object_key,
    ownerId: row.owner_id,
    stagingName: row.staging_name,
    storageBackend: row.storage_backend,
    storageProfileId: row.storage_profile_id,
    taskId: row.task_id ?? undefined,
  };
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function validFile(path: string, row: AttemptRow) {
  try {
    const info = await stat(path);
    return info.isFile() && info.size === row.byte_size &&
      !!row.checksum_sha256 && await sha256File(path) === row.checksum_sha256;
  } catch {
    return false;
  }
}

export async function recoverPendingGeneratedMediaPublications() {
  const outcomes: Array<{
    action: "blocked" | "failed" | "finalized";
    assetId: string;
    taskId: string;
  }> = [];
  for (const row of pendingGeneratedAttempts()) {
    const reservation = reservationFromAttempt(row);
    if (
      !["running", "recovering"].includes(row.task_state) ||
      row.state === "compensating" || row.media_storage_status !== "pending"
    ) {
      await compensateMediaPublication(reservation, {
        code: "MEDIA_RECOVERY_TASK_TERMINAL",
      });
      outcomes.push({ action: "failed", assetId: row.asset_id, taskId: row.task_id! });
      continue;
    }
    if (reservation.storageBackend === "oss") {
      if (row.state === "external-ready") {
        // external-ready is written only after the OSS PUT and verification
        // HEAD both succeed. That durable database state is sufficient to
        // finish the task/media/history transaction after a restart without
        // another Provider or OSS request.
        finalizeMediaPublication(reservation);
        await cleanupPublicationStaging(reservation).catch(() => undefined);
        outcomes.push({
          action: "finalized",
          assetId: row.asset_id,
          taskId: row.task_id!,
        });
        continue;
      }
      outcomes.push({ action: "blocked", assetId: row.asset_id, taskId: row.task_id! });
      continue;
    }
    const finalValid = await validFile(mediaPublicationFinalPath(reservation), row);
    const stagingValid = await validFile(mediaPublicationStagingPath(reservation), row);
    if (!finalValid && !stagingValid) {
      await compensateMediaPublication(reservation, { code: "MEDIA_RECOVERY_EVIDENCE_MISSING" });
      outcomes.push({ action: "failed", assetId: row.asset_id, taskId: row.task_id! });
      continue;
    }
    if (row.state === "reserved") {
      // A reserved row has no committed complete-body proof. Even if a partial
      // file happens to match its zero/default metadata, never publish it.
      await compensateMediaPublication(reservation, { code: "MEDIA_RECOVERY_STAGE_MISSING" });
      outcomes.push({ action: "failed", assetId: row.asset_id, taskId: row.task_id! });
      continue;
    }
    if (!finalValid) await publishLocalMediaPublication(reservation);
    else if (row.state === "staged") markExternalMediaPublicationReady(reservation);
    finalizeMediaPublication(reservation);
    await cleanupPublicationStaging(reservation).catch(() => undefined);
    outcomes.push({ action: "finalized", assetId: row.asset_id, taskId: row.task_id! });
  }
  return outcomes;
}

/**
 * A browser upload has no durable canvas adoption proof. After a process loss,
 * never publish its stranded bytes automatically: hide the pending row first,
 * then remove only the exact object owned by its durable attempt. A failed OSS
 * cleanup remains compensating and therefore unreadable/retryable by audit.
 */
export async function recoverPendingUploadMediaPublications(input?: {
  /** @deprecated Use updatedBefore. Kept for frozen-callsite compatibility. */
  createdBefore?: string;
  deleteExternalObject?: typeof deletePrivateAliyunOssObject;
  updatedBefore?: string;
}) {
  const outcomes: Array<{
    action: "blocked" | "failed";
    assetId: string;
  }> = [];
  const updatedBefore = input?.updatedBefore ?? input?.createdBefore ??
    processStartupUploadRecoveryCutoff;
  for (const row of pendingUploadAttempts(updatedBefore)) {
    const reservation = reservationFromAttempt(row);
    const media = readableMediaForOwner(row.owner_id, row.kind, row.asset_id);
    const claimed = claimUploadRecovery(reservation, updatedBefore);
    if (!claimed) continue;
    let removed = false;
    try {
      await removeExternal(
        reservation,
        media,
        undefined,
        input?.deleteExternalObject,
      );
      removed = finishCompensatingMediaPublication(reservation);
    } catch {
      // The compensating journal, failed media row and tombstone are the
      // durable retry evidence. A later process may claim the old row again.
    }
    outcomes.push({
      action: removed ? "failed" : "blocked",
      assetId: row.asset_id,
    });
  }
  return outcomes;
}

type StartupMediaRecoveryGate = "blocked" | "clear" | "deferred";

let startupMediaRecoveryGate: StartupMediaRecoveryGate = "clear";

function databaseHasStartupMediaRecoveryCandidate(
  database: DatabaseSync,
  updatedBefore = processStartupUploadRecoveryCutoff,
) {
  const candidate = database.prepare(`
    SELECT (
      EXISTS (
        SELECT 1
        FROM media_delete_intents AS deletion
        JOIN media_assets AS media
          ON media.owner_id = deletion.owner_id
          AND media.kind = deletion.kind
          AND media.id = deletion.asset_id
        WHERE deletion.state IN ('delete-requested', 'delete-failed')
          AND deletion.updated_at < ?
      ) OR EXISTS (
        SELECT 1
        FROM media_publication_attempts
        WHERE source = 'upload'
          AND adopted_at IS NULL
          AND (
            state IN ('reserved', 'staged', 'external-ready', 'published')
            OR (
              state = 'compensating'
              AND COALESCE(error_code, '') NOT IN (
                'MEDIA_DELETE_REQUESTED', 'MEDIA_DELETE_FAILED'
              )
            )
          )
          AND updated_at < ?
      )
    ) AS required
  `).get(updatedBefore, updatedBefore) as
    | { required?: unknown }
    | undefined;
  return Number(candidate?.required) === 1;
}

type StartupMediaRecoveryProbe =
  | "clear"
  | "deferred"
  | "migrate-required"
  | "required";

const explicitMigrationSourceVersion = 37;

function databaseMatchesMigrationLedger(
  database: DatabaseSync,
  manifest: readonly Readonly<{ name: string; version: number }>[],
) {
  const ledger = database.prepare(
    "SELECT version, name FROM schema_migrations ORDER BY version",
  ).all() as Array<{ name?: unknown; version?: unknown }>;
  return ledger.length === manifest.length && ledger.every((row, index) =>
    Number(row.version) === manifest[index]?.version &&
    String(row.name) === manifest[index]?.name
  );
}

function databaseMatchesCurrentStartupContract(database: DatabaseSync) {
  const quickCheck = database.prepare("PRAGMA quick_check").all() as
    Array<{ quick_check?: unknown }>;
  const version = database.prepare("PRAGMA user_version").get() as
    | { user_version?: unknown }
    | undefined;
  return quickCheck.length === 1 &&
    String(quickCheck[0]?.quick_check) === "ok" &&
    Number(version?.user_version) === currentSchemaVersion &&
    databaseMatchesMigrationLedger(database, currentSchemaManifest) &&
    databaseMatchesSchemaContract(database);
}

async function probeStartupMediaRecovery(
  databasePath: string,
): Promise<StartupMediaRecoveryProbe> {
  let walBytes = 0;
  let sharedMemoryPresent = false;
  try {
    walBytes = (await stat(`${databasePath}-wal`)).size;
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) return "deferred";
  }
  try {
    sharedMemoryPresent = (await stat(`${databasePath}-shm`)).isFile();
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) return "deferred";
  }
  // Opening a hot WAL without its WAL index would create recovery sidecars and
  // erase the exact failure that the read-only readiness probe must report.
  if (walBytes > 0 && !sharedMemoryPresent) return "deferred";

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(
      walBytes > 0
        ? databasePath
        : `${pathToFileURL(databasePath).href}?immutable=1`,
      { readOnly: true, timeout: 1_000 },
    );
    const quickCheck = database.prepare("PRAGMA quick_check").all() as
      Array<{ quick_check?: unknown }>;
    if (
      quickCheck.length !== 1 ||
      String(quickCheck[0]?.quick_check) !== "ok"
    ) return "deferred";
    const version = database.prepare("PRAGMA user_version").get() as
      | { user_version?: unknown }
      | undefined;
    const userVersion = Number(version?.user_version);
    if (userVersion === explicitMigrationSourceVersion) {
      const schema37Manifest = currentSchemaManifest.filter(
        (migration) => migration.version <= explicitMigrationSourceVersion,
      );
      return databaseMatchesMigrationLedger(database, schema37Manifest) &&
          databaseMatchesFrozenSchema37Contract(database)
        ? "migrate-required"
        : "deferred";
    }
    if (userVersion !== currentSchemaVersion) {
      return "deferred";
    }
    if (
      !databaseMatchesMigrationLedger(database, currentSchemaManifest) ||
      !databaseMatchesSchemaContract(database)
    ) return "deferred";
    return databaseHasStartupMediaRecoveryCandidate(database)
      ? "required"
      : "clear";
  } catch {
    // Startup liveness is process-only. Invalid or inaccessible database state
    // remains untouched for the readiness probe to classify precisely.
    return "deferred";
  } finally {
    try {
      database?.close();
    } catch {
      // Read-only inspection must never turn process liveness into a DB write
      // or startup dependency. Readiness will classify the same source again.
    }
  }
}

export function mediaLifecycleStartupRecoveryAllowsReadiness(
  database: DatabaseSync,
) {
  if (startupMediaRecoveryGate === "clear") return true;
  // A physical cleanup that failed during this process's startup remains
  // durable and retryable, but it must not be hidden by the cleanup attempt's
  // updated timestamp moving past the frozen startup cutoff. Only a fresh
  // process may retry that evidence and clear this gate.
  if (startupMediaRecoveryGate === "blocked") return false;
  try {
    if (databaseHasStartupMediaRecoveryCandidate(database)) return false;
    startupMediaRecoveryGate = "clear";
    return true;
  } catch {
    return false;
  }
}

/**
 * Server-startup cleanup for browser uploads and user-requested deletions.
 * This deliberately excludes generation-task recovery, so starting the HTTP
 * server cannot submit, poll or otherwise touch a Provider. The process
 * startup cutoff used by both recoveries prevents same-process work from
 * being claimed, while BEGIN IMMEDIATE makes an old upload's cleanup race
 * atomically with a first canvas adoption.
 */
export async function recoverMediaLifecycleAtProcessStartup() {
  const empty = { deletions: [], uploads: [] };
  if (startupMediaRecoveryGate === "blocked") return empty;
  if (process.env.UNBOUNDRY_MAINTENANCE_MODE === "1") {
    startupMediaRecoveryGate = "deferred";
    return empty;
  }
  let dataDirectory: string;
  try {
    dataDirectory = appDataDirectory();
  } catch {
    startupMediaRecoveryGate = "deferred";
    return empty;
  }
  try {
    await lstat(join(dataDirectory, ".unboundry-restore-incomplete"));
    startupMediaRecoveryGate = "deferred";
    return empty;
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      startupMediaRecoveryGate = "deferred";
      return empty;
    }
  }
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  try {
    const databaseFile = await stat(databasePath);
    if (!databaseFile.isFile()) {
      startupMediaRecoveryGate = "deferred";
      return empty;
    }
  } catch {
    startupMediaRecoveryGate = "deferred";
    return empty;
  }
  let probe = await probeStartupMediaRecovery(databasePath);
  if (probe === "deferred") {
    startupMediaRecoveryGate = "deferred";
    return empty;
  }
  if (probe === "migrate-required") {
    if (process.env.UNBOUNDRY_EXPLICIT_SCHEMA_MIGRATION !== "1") {
      startupMediaRecoveryGate = "deferred";
      return empty;
    }
    // This opt-in process role is the sole startup writer bridge from the
    // frozen v37 contract. The read-only probe above rejects unknown,
    // damaged, restore-incomplete and unsafe hot-WAL sources before this path.
    startupMediaRecoveryGate = "blocked";
    let database: DatabaseSync | undefined;
    try {
      database = openAppDatabase(dataDirectory);
      if (!databaseMatchesCurrentStartupContract(database)) {
        startupMediaRecoveryGate = "deferred";
        return empty;
      }
    } catch {
      // openAppDatabase owns the migration transaction and rolls it back on
      // failure. Keep readiness closed without attempting media recovery.
      startupMediaRecoveryGate = "deferred";
      return empty;
    } finally {
      try {
        database?.close();
      } catch {
        startupMediaRecoveryGate = "deferred";
      }
    }
    if (startupMediaRecoveryGate === "deferred") return empty;
    probe = await probeStartupMediaRecovery(databasePath);
    if (probe === "deferred" || probe === "migrate-required") {
      startupMediaRecoveryGate = "deferred";
      return empty;
    }
  }
  if (probe === "clear") {
    startupMediaRecoveryGate = "clear";
    return empty;
  }
  // From the first writer-side recovery step until every physical cleanup has
  // succeeded, readiness stays closed. This also fails closed if an unexpected
  // exception escapes between the two recovery phases.
  startupMediaRecoveryGate = "blocked";
  const deletions = await recoverPendingMediaDeletions();
  const uploads = await recoverPendingUploadMediaPublications();
  const blocked =
    deletions.some((outcome) => outcome.action === "blocked") ||
    uploads.some((outcome) => outcome.action === "blocked");
  if (!blocked) startupMediaRecoveryGate = "clear";
  return { deletions, uploads };
}

export function publicationReservationForAttempt(attemptId: string) {
  if (!identifierPattern.test(attemptId) || attemptId.length > 120) return undefined;
  return withDatabase((database) => {
    const row = database.prepare(`
      SELECT * FROM media_publication_attempts WHERE attempt_id = ?
    `).get(attemptId) as AttemptRow | undefined;
    return row ? reservationFromAttempt(row) : undefined;
  });
}
