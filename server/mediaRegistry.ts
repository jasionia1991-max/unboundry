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
  objectKey: string;
  storageBackend: MediaStorageBackend;
  storageName: string;
  storageStatus: "failed" | "pending" | "ready";
};

let database: DatabaseSync | undefined;
let databaseDirectory = "";

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
  if (identity.bypass) return true;
  return Boolean(
    db()
      .prepare(`
        SELECT 1
        FROM media_assets
        WHERE kind = ? AND id = ? AND owner_id = ?
      `)
      .get(kind, id, identity.userId),
  );
}

export function readableMedia(
  request: IncomingMessage,
  kind: MediaKind,
  id: string,
): MediaRecord | undefined {
  const identity = requestIdentity(request);
  if (!identity || identity.bypass) return undefined;
  return readableMediaForOwner(identity.userId, kind, id);
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
        duration_source, duration_status, object_key, storage_backend,
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
        object_key: string;
        storage_backend: MediaStorageBackend;
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
    objectKey: row.object_key,
    storageBackend: row.storage_backend,
    storageName: row.storage_name,
    storageStatus: row.storage_status,
  };
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
    objectKey?: string;
    storageBackend?: MediaStorageBackend;
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
    objectKey?: string;
    storageBackend?: MediaStorageBackend;
    storageName: string;
    storageStatus?: "failed" | "pending" | "ready";
  },
) {
  const timestamp = new Date().toISOString();
  const result = db()
    .prepare(`
      INSERT INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at,
        storage_backend, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, id) DO UPDATE SET
        storage_name = excluded.storage_name,
        byte_size = excluded.byte_size,
        updated_at = excluded.updated_at,
        storage_backend = excluded.storage_backend,
        object_key = excluded.object_key,
        content_type = excluded.content_type,
        checksum_sha256 = excluded.checksum_sha256,
        storage_status = excluded.storage_status,
        duration_seconds = excluded.duration_seconds,
        duration_source = excluded.duration_source,
        duration_status = excluded.duration_status
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
      input.objectKey ?? input.storageName,
      input.contentType,
      input.checksumSha256,
      input.storageStatus ?? "ready",
      input.durationSeconds ?? null,
      input.durationSeconds === undefined ? null : "server-probe",
      input.durationSeconds === undefined
        ? input.kind === "image" ? "not-applicable" : "pending"
        : "ready",
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
