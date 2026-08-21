import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { appDataDirectory, openAppDatabase } from "./database";
import { requestIdentity } from "./auth";

export type MediaKind = "audio" | "image" | "video";
export type MediaStorageBackend = "local" | "oss";

export type MediaRecord = {
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  durationSeconds: number | null;
  durationSource: "provider-task" | "server-probe" | null;
  durationStatus: "failed" | "not-applicable" | "pending" | "ready";
  mediaHeight: number | null;
  mediaWidth: number | null;
  objectKey: string;
  storageBackend: MediaStorageBackend;
  storageProfileId: string | null;
  storageName: string;
  storageStatus: "failed" | "pending" | "ready";
};

export type MediaDeletionResult =
  | { action: "deferred"; media?: MediaRecord }
  | { action: "physical"; media: MediaRecord };

let database: DatabaseSync | undefined;
let databaseDirectory = "";
const processStartupMediaDeleteCutoff = new Date().toISOString();

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

export function mayReadMedia(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
) {
  const identity = requestIdentity(request);
  if (!identity) return false;
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  return Boolean(
    db()
      .prepare(`
        SELECT 1
        FROM media_assets
        WHERE kind = ? AND id = ? AND owner_id = ?
          AND storage_status = 'ready'
      `)
      .get(kind, id, ownerId),
  );
}

export function readableMedia(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
): MediaRecord | undefined {
  const identity = requestIdentity(request);
  if (!identity) return undefined;
  return readyMediaForOwner(
    identity.bypass ? "__test__" : identity.userId,
    kind,
    id,
  );
}

export function ownedMedia(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
) {
  const identity = requestIdentity(request);
  if (!identity) return undefined;
  return readableMediaForOwner(
    identity.bypass ? "__test__" : identity.userId,
    kind,
    id,
  );
}

export function readableMediaForOwner(
  ownerId: string,
  kind: MediaKind,
  id: string,
): MediaRecord | undefined {
  const row = db()
    .prepare(`
      SELECT
        byte_size, checksum_sha256, content_type, duration_seconds,
        duration_source, duration_status, media_height, media_width,
        object_key, storage_backend, storage_profile_id,
        storage_name, storage_status
      FROM media_assets
      WHERE kind = ? AND id = ? AND owner_id = ?
    `)
    .get(kind, id, ownerId) as
    | {
        byte_size: number;
        checksum_sha256: string;
        content_type: string;
        duration_seconds: number | null;
        duration_source: "provider-task" | "server-probe" | null;
        duration_status: "failed" | "not-applicable" | "pending" | "ready";
        media_height: number | null;
        media_width: number | null;
        object_key: string;
        storage_backend: MediaStorageBackend;
        storage_profile_id: string | null;
        storage_name: string;
        storage_status: "failed" | "pending" | "ready";
      }
    | undefined;
  if (!row) return undefined;
  return {
    byteSize: Number(row.byte_size),
    checksumSha256: row.checksum_sha256,
    contentType: row.content_type,
    durationSeconds:
      row.duration_seconds === null ? null : Number(row.duration_seconds),
    durationSource: row.duration_source,
    durationStatus: row.duration_status,
    mediaHeight: row.media_height,
    mediaWidth: row.media_width,
    objectKey: row.object_key,
    storageBackend: row.storage_backend,
    storageProfileId: row.storage_profile_id,
    storageName: row.storage_name,
    storageStatus: row.storage_status,
  };
}

export function readyMediaForOwner(
  ownerId: string,
  kind: MediaKind,
  id: string,
) {
  const media = readableMediaForOwner(ownerId, kind, id);
  return media?.storageStatus === "ready" ? media : undefined;
}

export function mayWriteMedia(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
) {
  const identity = requestIdentity(request);
  if (!identity) return false;
  if (identity.bypass) return true;
  const row = db()
    .prepare("SELECT owner_id FROM media_assets WHERE kind = ? AND id = ?")
    .get(kind, id) as { owner_id: string } | undefined;
  return !row || row.owner_id === identity.userId;
}

export function registerMedia(
  request: IncomingMessage,
  input: {
    byteSize: number;
    checksumSha256: string;
    contentType: string;
    durationSeconds?: number;
    id: string;
    kind: MediaKind;
    mediaHeight?: number;
    mediaWidth?: number;
    objectKey?: string;
    storageBackend?: MediaStorageBackend;
    storageProfileId?: string;
    storageName: string;
    storageStatus?: "failed" | "pending" | "ready";
  },
) {
  const identity = requestIdentity(request);
  if (!identity) return;
  return registerMediaForOwner(
    identity.bypass ? "__test__" : identity.userId,
    input,
  );
}

export function registerMediaForOwner(
  ownerId: string,
  input: {
    byteSize: number;
    checksumSha256: string;
    contentType: string;
    durationSeconds?: number;
    id: string;
    kind: MediaKind;
    mediaHeight?: number;
    mediaWidth?: number;
    objectKey?: string;
    storageBackend?: MediaStorageBackend;
    storageProfileId?: string;
    storageName: string;
    storageStatus?: "failed" | "pending" | "ready";
  },
) {
  const timestamp = new Date().toISOString();
  const result = db()
    .prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, storage_profile_id, object_key, content_type,
        checksum_sha256, storage_status, duration_seconds, duration_source,
        duration_status, media_width, media_height
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, id) DO UPDATE SET
        storage_name = excluded.storage_name,
        byte_size = excluded.byte_size,
        updated_at = excluded.updated_at,
        storage_backend = excluded.storage_backend,
        storage_profile_id = excluded.storage_profile_id,
        object_key = excluded.object_key,
        content_type = excluded.content_type,
        checksum_sha256 = excluded.checksum_sha256,
        storage_status = excluded.storage_status,
        duration_seconds = excluded.duration_seconds,
        duration_source = excluded.duration_source,
        duration_status = excluded.duration_status,
        media_width = excluded.media_width,
        media_height = excluded.media_height
      WHERE media_assets.owner_id = excluded.owner_id
    `)
    .run(
      input.kind,
      input.id,
      ownerId,
      input.storageName,
      input.byteSize,
      timestamp,
      timestamp,
      input.storageBackend ?? "local",
      input.storageProfileId ?? null,
      input.objectKey ?? input.storageName,
      input.contentType,
      input.checksumSha256,
      input.storageStatus ?? "ready",
      input.durationSeconds ?? null,
      input.durationSeconds === undefined ? null : "server-probe",
      input.durationSeconds === undefined
        ? input.kind === "image" ? "not-applicable" : "pending"
        : "ready",
      input.mediaWidth ?? null,
      input.mediaHeight ?? null,
    );
  if (result.changes !== 1) throw new Error("Asset belongs to another account");
}

export function unregisterMedia(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
) {
  const identity = requestIdentity(request);
  if (!identity) return;
  db()
    .prepare(`
      DELETE FROM media_assets
      WHERE kind = ? AND id = ? AND owner_id = ?
    `)
    .run(kind, id, identity.bypass ? "__test__" : identity.userId);
}

export function beginMediaDeletion(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
  assertDeletionAllowedInTransaction?: (
    database: DatabaseSync,
    input: Readonly<{ assetId: string; kind: MediaKind; ownerId: string }>,
  ) => void,
): MediaDeletionResult | undefined {
  const identity = requestIdentity(request);
  if (!identity) return undefined;
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const media = readableMediaForOwner(ownerId, kind, id);
    if (!media) {
      const timestamp = new Date().toISOString();
      database.prepare(`
        INSERT INTO media_delete_intents (
          owner_id, kind, asset_id, state, created_at, updated_at
        ) VALUES (?, ?, ?, 'tombstone', ?, ?)
        ON CONFLICT(owner_id, kind, asset_id) DO NOTHING
      `).run(ownerId, kind, id, timestamp, timestamp);
      database.exec("COMMIT");
      return { action: "deferred" };
    }
    assertDeletionAllowedInTransaction?.(database, {
      assetId: id,
      kind,
      ownerId,
    });
    const publication = database.prepare(`
      SELECT attempt_id, source, state, error_code
      FROM media_publication_attempts
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
      ORDER BY created_at DESC, attempt_id DESC
      LIMIT 1
    `).get(ownerId, kind, id) as
      | {
          attempt_id: string;
          error_code: string | null;
          source: string;
          state: string;
        }
      | undefined;
    const deferredPublicationCleanup = Boolean(
      publication?.source === "upload" &&
      (
        ["reserved", "staged", "external-ready"].includes(
          publication.state,
        ) ||
        publication.state === "compensating" &&
          publication.error_code === "MEDIA_DELETE_DEFERRED"
      ),
    );
    if (
      publication &&
      ["reserved", "staged", "external-ready", "compensating"].includes(
        publication.state,
      ) &&
      !deferredPublicationCleanup &&
      !(
        publication.source === "upload" &&
        publication.state === "compensating" &&
        ["MEDIA_DELETE_REQUESTED", "MEDIA_DELETE_FAILED"].includes(
          publication.error_code ?? "",
        )
      )
    ) {
      throw new Error("Media publication is still active");
    }
    const timestamp = new Date().toISOString();
    const intent = database.prepare(`
      SELECT state, updated_at
      FROM media_delete_intents
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
    `).get(ownerId, kind, id) as
      | { state: string; updated_at: string }
      | undefined;
    if (deferredPublicationCleanup) {
      if (intent && intent.state !== "tombstone") {
        throw new Error("Media deletion is already active");
      }
      database.prepare(`
        INSERT INTO media_delete_intents (
          owner_id, kind, asset_id, state, created_at, updated_at
        ) VALUES (?, ?, ?, 'tombstone', ?, ?)
        ON CONFLICT(owner_id, kind, asset_id) DO UPDATE SET
          updated_at = excluded.updated_at
        WHERE media_delete_intents.state = 'tombstone'
      `).run(ownerId, kind, id, timestamp, timestamp);
    } else if (!intent) {
      database.prepare(`
        INSERT INTO media_delete_intents (
          owner_id, kind, asset_id, state, created_at, updated_at
        ) VALUES (?, ?, ?, 'delete-requested', ?, ?)
      `).run(ownerId, kind, id, timestamp, timestamp);
    } else if (intent.state === "delete-requested") {
      if (intent.updated_at >= processStartupMediaDeleteCutoff) {
        throw new Error("Media deletion is already active");
      }
      const reclaimed = database.prepare(`
        UPDATE media_delete_intents
        SET updated_at = ?
        WHERE owner_id = ? AND kind = ? AND asset_id = ?
          AND state = 'delete-requested' AND updated_at = ?
      `).run(timestamp, ownerId, kind, id, intent.updated_at);
      if (reclaimed.changes !== 1) throw new Error("Media changed concurrently");
    } else {
      const claimed = database.prepare(`
        UPDATE media_delete_intents
        SET state = 'delete-requested', updated_at = ?
        WHERE owner_id = ? AND kind = ? AND asset_id = ?
          AND state IN ('tombstone', 'delete-failed')
      `).run(timestamp, ownerId, kind, id);
      if (claimed.changes !== 1) throw new Error("Media deletion is already active");
    }
    const hidden = database.prepare(`
      UPDATE media_assets
      SET storage_status = 'failed', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND id = ?
        AND storage_status IN ('pending', 'ready', 'failed')
    `).run(timestamp, ownerId, kind, id);
    if (hidden.changes !== 1) throw new Error("Media changed concurrently");
    database.prepare(`
      DELETE FROM asset_history
      WHERE account_id = ? AND owner_id = ? AND id = ? AND kind = ?
    `).run(ownerId, ownerId, id, kind);
    const journal = deferredPublicationCleanup
      ? database.prepare(`
          UPDATE media_publication_attempts
          SET state = 'compensating', error_code = 'MEDIA_DELETE_DEFERRED',
              retry_count = retry_count + 1, updated_at = ?
          WHERE attempt_id = ? AND source = 'upload'
            AND (
              state IN ('reserved', 'staged', 'external-ready')
              OR (state = 'compensating' AND error_code = 'MEDIA_DELETE_DEFERRED')
            )
        `).run(timestamp, publication!.attempt_id)
      : database.prepare(`
          UPDATE media_publication_attempts
          SET state = 'compensating', error_code = 'MEDIA_DELETE_REQUESTED',
              retry_count = retry_count + 1, updated_at = ?
          WHERE owner_id = ? AND kind = ? AND asset_id = ?
            AND (
              state = 'published'
              OR (
                state = 'compensating'
                AND error_code IN ('MEDIA_DELETE_REQUESTED', 'MEDIA_DELETE_FAILED')
              )
            )
        `).run(timestamp, ownerId, kind, id);
    if (
      publication &&
      (deferredPublicationCleanup || publication.state === "published" ||
        publication.state === "compensating") &&
      journal.changes !== 1
    ) {
      throw new Error("Media changed concurrently");
    }
    database.exec("COMMIT");
    return deferredPublicationCleanup
      ? { action: "deferred", media }
      : { action: "physical", media };
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export function finishMediaDeletion(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
  media: MediaRecord,
) {
  const identity = requestIdentity(request);
  if (!identity) return false;
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const removed = database.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = ? AND kind = ? AND id = ? AND storage_status = 'failed'
        AND storage_name = ? AND storage_backend = ?
        AND storage_profile_id IS ? AND object_key = ?
    `).run(
      ownerId,
      kind,
      id,
      media.storageName,
      media.storageBackend,
      media.storageProfileId,
      media.objectKey,
    );
    if (removed.changes !== 1) throw new Error("Media changed concurrently");
    database.prepare(`
      UPDATE media_publication_attempts
      SET state = 'failed', error_code = 'MEDIA_DELETED', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = 'compensating'
        AND error_code = 'MEDIA_DELETE_REQUESTED'
    `).run(new Date().toISOString(), ownerId, kind, id);
    const completed = database.prepare(`
      UPDATE media_delete_intents
      SET state = 'tombstone', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = 'delete-requested'
    `).run(new Date().toISOString(), ownerId, kind, id);
    if (completed.changes !== 1) throw new Error("Media changed concurrently");
    database.exec("COMMIT");
    return true;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export function markMediaDeletionFailed(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
) {
  const identity = requestIdentity(request);
  if (!identity) return false;
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const timestamp = new Date().toISOString();
    const failed = database.prepare(`
      UPDATE media_delete_intents
      SET state = 'delete-failed', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = 'delete-requested'
    `).run(timestamp, ownerId, kind, id);
    if (failed.changes !== 1) {
      database.exec("ROLLBACK");
      return false;
    }
    database.prepare(`
      UPDATE media_publication_attempts
      SET error_code = 'MEDIA_DELETE_FAILED', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = 'compensating'
        AND error_code = 'MEDIA_DELETE_REQUESTED'
    `).run(timestamp, ownerId, kind, id);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
