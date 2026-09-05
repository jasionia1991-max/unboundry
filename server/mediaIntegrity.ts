import { createHash } from "node:crypto";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";

const checksumPattern = /^[a-f0-9]{64}$/i;
const mediaKinds = new Set(["audio", "image", "video"]);
const supportedSchemaVersions = new Set([37, 38, 39, 40, 41, 42, 43]);
const activePublicationStates = new Set([
  "reserved",
  "staged",
  "external-ready",
  "compensating",
]);

export type MediaIntegrityIssueCode =
  | "MEDIA_INTEGRITY_ACCOUNT_DELETE_ACTIVE"
  | "MEDIA_INTEGRITY_ACCOUNT_DELETE_FAILED"
  | "MEDIA_INTEGRITY_CHECKSUM_MISMATCH"
  | "MEDIA_INTEGRITY_CHECKSUM_MISSING"
  | "MEDIA_INTEGRITY_DURATION_METADATA_INVALID"
  | "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING"
  | "MEDIA_INTEGRITY_DELETE_ACTIVE"
  | "MEDIA_INTEGRITY_DELETE_FAILED"
  | "MEDIA_INTEGRITY_HISTORY_MEDIA_KIND_MISMATCH"
  | "MEDIA_INTEGRITY_HISTORY_MEDIA_MISSING"
  | "MEDIA_INTEGRITY_HISTORY_MEDIA_NOT_READY"
  | "MEDIA_INTEGRITY_HISTORY_MEDIA_OWNER_MISMATCH"
  | "MEDIA_INTEGRITY_IMAGE_DIMENSIONS_MISSING"
  | "MEDIA_INTEGRITY_LOCAL_FILE_MISSING"
  | "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN"
  | "MEDIA_INTEGRITY_LOCAL_SIZE_MISMATCH"
  | "MEDIA_INTEGRITY_OSS_EVIDENCE_MISSING"
  | "MEDIA_INTEGRITY_OSS_EVIDENCE_UNUSED"
  | "MEDIA_INTEGRITY_OSS_OBJECT_KEY_MISSING"
  | "MEDIA_INTEGRITY_OSS_PROFILE_MISSING"
  | "MEDIA_INTEGRITY_OSS_SIZE_MISMATCH"
  | "MEDIA_INTEGRITY_PUBLICATION_ACTIVE"
  | "MEDIA_INTEGRITY_PUBLICATION_COMPENSATING"
  | "MEDIA_INTEGRITY_PUBLICATION_FINAL_MISSING"
  | "MEDIA_INTEGRITY_PUBLICATION_FINAL_MISMATCH"
  | "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISMATCH"
  | "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISSING"
  | "MEDIA_INTEGRITY_PUBLICATION_STAGING_MISMATCH"
  | "MEDIA_INTEGRITY_PUBLICATION_STAGING_MISSING"
  | "MEDIA_INTEGRITY_PUBLICATION_TASK_MISMATCH"
  | "MEDIA_INTEGRITY_PUBLICATION_TASK_MISSING"
  | "MEDIA_INTEGRITY_READY_METADATA_INVALID"
  | "MEDIA_INTEGRITY_STATUS_FAILED"
  | "MEDIA_INTEGRITY_STATUS_PENDING"
  | "MEDIA_INTEGRITY_STORAGE_BACKEND_INVALID"
  | "MEDIA_INTEGRITY_STORAGE_NAME_INVALID"
  | "MEDIA_INTEGRITY_TASK_HISTORY_MISMATCH"
  | "MEDIA_INTEGRITY_TASK_HISTORY_MISSING"
  | "MEDIA_INTEGRITY_TASK_RESULT_ID_MISSING"
  | "MEDIA_INTEGRITY_TASK_RESULT_KIND_MISMATCH"
  | "MEDIA_INTEGRITY_TASK_RESULT_MISSING"
  | "MEDIA_INTEGRITY_TASK_RESULT_NOT_READY"
  | "MEDIA_INTEGRITY_TASK_RESULT_OWNER_MISMATCH"
  | "MEDIA_INTEGRITY_TASK_RESULT_SHARED"
  | "MEDIA_INTEGRITY_UPLOAD_ADOPTION_MISMATCH"
  | "MEDIA_INTEGRITY_UPLOAD_ADOPTION_PROVENANCE_MISSING"
  | "MEDIA_INTEGRITY_UPLOAD_UNADOPTED"
  | "MEDIA_INTEGRITY_VIDEO_DIMENSIONS_MISSING";

export type MediaIntegrityFileEvidence = Readonly<{
  logicalPath: string;
  sha256: string;
  size: number;
}>;

export type MediaIntegrityOssEvidence = Readonly<{
  byteSize: number;
  checksumSha256: string;
  objectKey: string;
  versionId: string;
}>;

export type MediaIntegrityIssue = Readonly<{
  assetId?: string;
  attemptId?: string;
  backupBlocking: boolean;
  code: MediaIntegrityIssueCode;
  kind?: string;
  logicalPath?: string;
  ownerId?: string;
  severity: "error" | "warning";
  state?: string;
  storageBackend?: string;
  taskId?: string;
}>;

export type MediaIntegrityCounts = Readonly<{
  accountDeleteIntents: number;
  activeDeleteIntents: number;
  activePublicationAttempts: number;
  assets: number;
  backupBlockingIssues: number;
  failed: number;
  failedDeleteIntents: number;
  files: number;
  issues: number;
  ossEvidence: number;
  pending: number;
  publicationAttempts: number;
  ready: number;
}>;

export type MediaIntegrityReport = Readonly<{
  backupComplete: boolean;
  clean: boolean;
  counts: MediaIntegrityCounts;
  databaseLogicalSha256: string;
  evidenceSha256: string;
  issues: readonly MediaIntegrityIssue[];
  schemaVersion: number;
  sha256: string;
  version: 1;
}>;

export type MediaIntegritySummary = Readonly<{
  backupBlockingIssues: number;
  clean: boolean;
  evidenceSha256: string;
  issues: number;
  sha256: string;
}>;

export class MediaIntegrityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MediaIntegrityError";
    this.code = code;
  }
}

type MediaRow = Readonly<{
  byte_size: bigint;
  checksum_sha256: string | null;
  content_type: string;
  duration_seconds: number | null;
  duration_source: string | null;
  duration_status: string;
  id: string;
  kind: string;
  media_height: bigint | null;
  media_width: bigint | null;
  object_key: string | null;
  owner_id: string;
  storage_backend: string;
  storage_name: string;
  storage_profile_id: string | null;
  storage_status: string;
}>;

type TaskRow = Readonly<{
  attempt: bigint;
  id: string;
  kind: string;
  owner_id: string | null;
  result_asset_id: string | null;
  state: string;
}>;

type HistoryRow = Readonly<{
  account_id: string;
  id: string;
  kind: string;
  owner_id: string | null;
  preview: string;
}>;

type PublicationRow = Readonly<{
  adopted_at: string | null;
  adopted_canvas_id: string | null;
  asset_id: string;
  attempt_id: string;
  byte_size: bigint;
  checksum_sha256: string | null;
  content_type: string;
  duration_seconds: number | null;
  duration_source: string | null;
  final_storage_name: string;
  kind: string;
  media_height: bigint | null;
  media_width: bigint | null;
  object_key: string;
  owner_id: string;
  source: string;
  staging_name: string;
  state: string;
  storage_backend: string;
  storage_profile_id: string | null;
  task_execution_attempt: bigint | null;
  task_id: string | null;
}>;

type DeleteIntentRow = Readonly<{
  asset_id: string;
  kind: string;
  owner_id: string;
  state: string;
}>;

type AccountDeleteIntentRow = Readonly<{
  owner_id: string;
  state: string;
}>;

type CanvasRow = Readonly<{
  id: string;
  nodes: string;
  owner_id: string | null;
}>;

function fail(code: string, message: string): never {
  throw new MediaIntegrityError(code, message);
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("MEDIA_REPORT_INVALID", "Report contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return fail("MEDIA_REPORT_INVALID", "Report contains an unsupported value");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeInteger(value: bigint) {
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : undefined;
}

function validLogicalPath(path: string) {
  return Boolean(
    path &&
    path.length <= 1_024 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part && part !== "." && part !== ".."),
  );
}

function validStorageName(name: string) {
  return Boolean(
    name &&
    name.length <= 240 &&
    basename(name) === name &&
    name !== "." &&
    name !== ".." &&
    !name.includes("\\"),
  );
}

function queryRows<T>(database: DatabaseSync, sql: string): T[] {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  return statement.all() as unknown as T[];
}

function scalarInteger(database: DatabaseSync, sql: string) {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  const row = statement.get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  return typeof value === "bigint" ? safeInteger(value) : undefined;
}

function assetKey(kind: string, id: string) {
  return `${kind}\0${id}`;
}

function historyKey(accountId: string, id: string) {
  return `${accountId}\0${id}`;
}

function canvasKey(ownerId: string, canvasId: string) {
  return `${ownerId}\0${canvasId}`;
}

function canvasContainsMediaReference(
  canvas: CanvasRow | undefined,
  kind: string,
  assetId: string,
) {
  if (!canvas) return false;
  try {
    const nodes = JSON.parse(canvas.nodes) as unknown;
    return Array.isArray(nodes) && nodes.some((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const node = raw as Record<string, unknown>;
      if (node.type !== kind) return false;
      if (!node.data || typeof node.data !== "object" || Array.isArray(node.data)) {
        return false;
      }
      const data = node.data as Record<string, unknown>;
      return data.assetId === assetId ||
        (kind === "image" && (
          data.imageToolMaskAssetId === assetId ||
          data.imageToolPreparedAssetId === assetId
        ));
    });
  } catch {
    return false;
  }
}

function previewFor(kind: string, id: string) {
  return kind === "video"
    ? `/api/video-assets/${id}`
    : kind === "audio"
      ? `/api/audio-assets/${id}`
      : `/api/assets/${id}`;
}

function issueSortKey(issue: MediaIntegrityIssue) {
  return [
    issue.code,
    issue.kind ?? "",
    issue.assetId ?? "",
    issue.taskId ?? "",
    issue.attemptId ?? "",
    issue.logicalPath ?? "",
    issue.ownerId ?? "",
    issue.state ?? "",
    issue.storageBackend ?? "",
  ].join("\0");
}

function evidenceMaps(
  files: readonly MediaIntegrityFileEvidence[],
  ossEvidence: readonly MediaIntegrityOssEvidence[],
) {
  const fileMap = new Map<string, MediaIntegrityFileEvidence>();
  for (const file of files) {
    if (
      !validLogicalPath(file.logicalPath) ||
      !Number.isSafeInteger(file.size) || file.size < 0 ||
      !checksumPattern.test(file.sha256) ||
      fileMap.has(file.logicalPath)
    ) fail("MEDIA_REPORT_EVIDENCE_INVALID", "Local media evidence is invalid");
    fileMap.set(file.logicalPath, Object.freeze({
      ...file,
      sha256: file.sha256.toLowerCase(),
    }));
  }
  const ossMap = new Map<string, MediaIntegrityOssEvidence>();
  for (const evidence of ossEvidence) {
    if (
      !evidence.objectKey || evidence.objectKey.length > 1_024 ||
      evidence.objectKey.includes("\0") ||
      !evidence.versionId || evidence.versionId.length > 1_024 ||
      evidence.versionId.includes("\0") ||
      !Number.isSafeInteger(evidence.byteSize) || evidence.byteSize < 0 ||
      !checksumPattern.test(evidence.checksumSha256) ||
      ossMap.has(evidence.objectKey)
    ) fail("MEDIA_REPORT_EVIDENCE_INVALID", "OSS media evidence is invalid");
    ossMap.set(evidence.objectKey, Object.freeze({
      ...evidence,
      checksumSha256: evidence.checksumSha256.toLowerCase(),
    }));
  }
  return { fileMap, ossMap };
}

function evidenceSha256(
  fileMap: ReadonlyMap<string, MediaIntegrityFileEvidence>,
  ossMap: ReadonlyMap<string, MediaIntegrityOssEvidence>,
) {
  const files = [...fileMap.values()].sort((left, right) =>
    left.logicalPath < right.logicalPath
      ? -1
      : left.logicalPath > right.logicalPath ? 1 : 0);
  const ossEvidence = [...ossMap.values()].sort((left, right) =>
    left.objectKey < right.objectKey
      ? -1
      : left.objectKey > right.objectKey ? 1 : 0);
  return sha256(stableJson({ files, ossEvidence }));
}

export function summarizeMediaIntegrity(
  report: MediaIntegrityReport,
): MediaIntegritySummary {
  return Object.freeze({
    backupBlockingIssues: report.counts.backupBlockingIssues,
    clean: report.clean,
    evidenceSha256: report.evidenceSha256,
    issues: report.counts.issues,
    sha256: report.sha256,
  });
}

export function inspectMediaIntegrity(input: Readonly<{
  databaseLogicalSha256: string;
  databasePath: string;
  files: readonly MediaIntegrityFileEvidence[];
  ossEvidence?: readonly MediaIntegrityOssEvidence[];
  storageProfileIds: readonly string[];
}>): MediaIntegrityReport {
  if (!checksumPattern.test(input.databaseLogicalSha256)) {
    fail("MEDIA_REPORT_DATABASE_INVALID", "Database fingerprint is invalid");
  }
  const { fileMap, ossMap } = evidenceMaps(
    input.files,
    input.ossEvidence ?? [],
  );
  const storageProfileIds = new Set(input.storageProfileIds);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(input.databasePath, {
      readOnly: true,
      timeout: 5_000,
    });
  } catch {
    fail("MEDIA_REPORT_DATABASE_UNAVAILABLE", "Media database is unavailable");
  }

  try {
    database.exec("BEGIN");
    const schemaVersion = scalarInteger(database, "PRAGMA user_version");
    if (schemaVersion === undefined || !supportedSchemaVersions.has(schemaVersion)) {
      fail(
        "MEDIA_REPORT_SCHEMA_UNSUPPORTED",
        "Media report requires schema 37, 38, 39, 40, 41, 42 or 43",
      );
    }
    const media = queryRows<MediaRow>(database, `
      SELECT
        kind, id, owner_id, storage_name, byte_size, storage_backend,
        storage_profile_id, object_key, content_type, checksum_sha256,
        storage_status, duration_seconds, duration_source, duration_status,
        media_width, media_height
      FROM media_assets
      ORDER BY kind, id
    `);
    const tasks = queryRows<TaskRow>(database, `
      SELECT id, owner_id, kind, state, attempt, result_asset_id
      FROM generation_tasks
      WHERE kind IN ('image', 'video', 'audio')
      ORDER BY id
    `);
    const histories = queryRows<HistoryRow>(database, `
      SELECT account_id, id, kind, owner_id, preview
      FROM asset_history
      WHERE kind IN ('image', 'video', 'audio')
      ORDER BY account_id, id
    `);
    const canvases = queryRows<CanvasRow>(database, `
      SELECT owner_id, id, nodes
      FROM canvas_documents
      ORDER BY owner_id, id
    `);
    const publications = schemaVersion >= 38
      ? queryRows<PublicationRow>(database, `
          SELECT
            attempt_id, owner_id, kind, asset_id, source, state,
            storage_backend, final_storage_name, object_key,
            storage_profile_id, staging_name, task_id,
            task_execution_attempt, byte_size, checksum_sha256,
            content_type, duration_seconds, duration_source,
            media_width, media_height, adopted_at, adopted_canvas_id
          FROM media_publication_attempts
          ORDER BY attempt_id
        `)
      : [];
    const deleteIntents = schemaVersion >= 38
      ? queryRows<DeleteIntentRow>(database, `
          SELECT owner_id, kind, asset_id, state
          FROM media_delete_intents
          WHERE state <> 'tombstone'
          ORDER BY owner_id, kind, asset_id
        `)
      : [];
    const accountDeleteIntents = schemaVersion >= 38
      ? queryRows<AccountDeleteIntentRow>(database, `
          SELECT owner_id, state
          FROM account_delete_intents
          ORDER BY owner_id
        `)
      : [];

    const issues: MediaIntegrityIssue[] = [];
    const add = (issue: MediaIntegrityIssue) => {
      issues.push(Object.freeze(issue));
    };
    const mediaByKey = new Map(media.map((row) => [assetKey(row.kind, row.id), row]));
    const mediaById = new Map<string, MediaRow[]>();
    for (const row of media) {
      const rows = mediaById.get(row.id) ?? [];
      rows.push(row);
      mediaById.set(row.id, rows);
    }
    const tasksById = new Map(tasks.map((row) => [row.id, row]));
    const historiesByKey = new Map(
      histories.map((row) => [historyKey(row.account_id, row.id), row]),
    );
    const canvasesByKey = new Map(
      canvases.filter((row) => row.owner_id !== null).map((row) => [
        canvasKey(row.owner_id!, row.id),
        row,
      ]),
    );
    const referencedFiles = new Set<string>();
    const usedOssEvidence = new Set<string>();

    for (const row of media) {
      const context = {
        assetId: row.id,
        kind: row.kind,
        state: row.storage_status,
        storageBackend: row.storage_backend,
      } as const;
      const remoteIncomplete = row.storage_backend === "oss" && Boolean(row.object_key);
      if (row.storage_status === "pending") {
        add({
          ...context,
          backupBlocking: remoteIncomplete,
          code: "MEDIA_INTEGRITY_STATUS_PENDING",
          severity: remoteIncomplete ? "error" : "warning",
        });
      } else if (row.storage_status === "failed") {
        add({
          ...context,
          backupBlocking: remoteIncomplete,
          code: "MEDIA_INTEGRITY_STATUS_FAILED",
          severity: remoteIncomplete ? "error" : "warning",
        });
      }
      const byteSize = safeInteger(row.byte_size);
      if (
        row.storage_status === "ready" &&
        (byteSize === undefined || byteSize < 1 || !row.content_type ||
          !mediaKinds.has(row.kind))
      ) {
        add({
          ...context,
          backupBlocking: true,
          code: "MEDIA_INTEGRITY_READY_METADATA_INVALID",
          severity: "error",
        });
      }
      if (
        row.storage_status === "ready" && row.kind === "image" &&
        (row.media_width === null || row.media_height === null ||
          safeInteger(row.media_width) === undefined ||
          safeInteger(row.media_height) === undefined ||
          row.media_width < 1n || row.media_height < 1n)
      ) {
        add({
          ...context,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_IMAGE_DIMENSIONS_MISSING",
          severity: "error",
        });
      }
      if (
        row.storage_status === "ready" && row.kind === "image" &&
        (row.duration_seconds !== null || row.duration_source !== null ||
          row.duration_status !== "not-applicable")
      ) {
        add({
          ...context,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_DURATION_METADATA_INVALID",
          severity: "error",
        });
      }
      if (
        row.storage_status === "ready" &&
        (row.kind === "audio" || row.kind === "video") &&
        (row.duration_status !== "ready" || row.duration_seconds === null ||
          !Number.isFinite(row.duration_seconds) || row.duration_seconds <= 0 ||
          (row.duration_source !== "server-probe" &&
            row.duration_source !== "provider-task"))
      ) {
        const admittedLegacyBackfill = schemaVersion === 37 &&
          row.duration_status === "pending" &&
          row.duration_seconds === null && row.duration_source === null;
        add({
          ...context,
          backupBlocking: false,
          code: admittedLegacyBackfill
            ? "MEDIA_INTEGRITY_LEGACY_DURATION_PENDING"
            : "MEDIA_INTEGRITY_DURATION_METADATA_INVALID",
          severity: admittedLegacyBackfill ? "warning" : "error",
        });
      }
      if (
        row.storage_status === "ready" && row.kind === "video" &&
        (row.media_width === null || row.media_height === null ||
          safeInteger(row.media_width) === undefined ||
          safeInteger(row.media_height) === undefined ||
          row.media_width < 1n || row.media_height < 1n)
      ) {
        add({
          ...context,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_VIDEO_DIMENSIONS_MISSING",
          severity: "error",
        });
      }
      if (row.storage_backend === "local") {
        if (!validStorageName(row.storage_name)) {
          add({
            ...context,
            backupBlocking: true,
            code: "MEDIA_INTEGRITY_STORAGE_NAME_INVALID",
            severity: "error",
          });
          continue;
        }
        referencedFiles.add(row.storage_name);
        const file = fileMap.get(row.storage_name);
        if (row.storage_status === "ready" && !file) {
          add({
            ...context,
            backupBlocking: true,
            code: "MEDIA_INTEGRITY_LOCAL_FILE_MISSING",
            logicalPath: row.storage_name,
            severity: "error",
          });
        }
        if (file && byteSize !== undefined && file.size !== byteSize) {
          add({
            ...context,
            backupBlocking: row.storage_status === "ready",
            code: "MEDIA_INTEGRITY_LOCAL_SIZE_MISMATCH",
            logicalPath: row.storage_name,
            severity: row.storage_status === "ready" ? "error" : "warning",
          });
        }
        if (row.storage_status === "ready" && !checksumPattern.test(row.checksum_sha256 ?? "")) {
          add({
            ...context,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_CHECKSUM_MISSING",
            logicalPath: row.storage_name,
            severity: "warning",
          });
        } else if (
          file && checksumPattern.test(row.checksum_sha256 ?? "") &&
          file.sha256 !== row.checksum_sha256!.toLowerCase()
        ) {
          add({
            ...context,
            backupBlocking: row.storage_status === "ready",
            code: "MEDIA_INTEGRITY_CHECKSUM_MISMATCH",
            logicalPath: row.storage_name,
            severity: row.storage_status === "ready" ? "error" : "warning",
          });
        }
      } else if (row.storage_backend === "oss") {
        const anyEvidence = row.object_key
          ? ossMap.get(row.object_key)
          : undefined;
        if (anyEvidence) usedOssEvidence.add(anyEvidence.objectKey);
        if (!row.object_key) {
          add({
            ...context,
            backupBlocking: row.storage_status === "ready",
            code: "MEDIA_INTEGRITY_OSS_OBJECT_KEY_MISSING",
            severity: "error",
          });
        }
        if (
          !row.storage_profile_id ||
          !storageProfileIds.has(row.storage_profile_id)
        ) {
          add({
            ...context,
            backupBlocking: true,
            code: "MEDIA_INTEGRITY_OSS_PROFILE_MISSING",
            severity: "error",
          });
        }
        if (row.storage_status === "ready") {
          const evidence = anyEvidence;
          const checksumPresent = checksumPattern.test(
            row.checksum_sha256 ?? "",
          );
          if (!checksumPresent) {
            add({
              ...context,
              backupBlocking: true,
              code: "MEDIA_INTEGRITY_CHECKSUM_MISSING",
              severity: "error",
            });
          }
          if (!evidence) {
            add({
              ...context,
              backupBlocking: true,
              code: "MEDIA_INTEGRITY_OSS_EVIDENCE_MISSING",
              severity: "error",
            });
          } else {
            usedOssEvidence.add(evidence.objectKey);
            if (byteSize === undefined || evidence.byteSize !== byteSize) {
              add({
                ...context,
                backupBlocking: true,
                code: "MEDIA_INTEGRITY_OSS_SIZE_MISMATCH",
                severity: "error",
              });
            }
            if (checksumPresent &&
              evidence.checksumSha256 !== row.checksum_sha256!.toLowerCase()
            ) {
              add({
                ...context,
                backupBlocking: true,
                code: "MEDIA_INTEGRITY_CHECKSUM_MISMATCH",
                severity: "error",
              });
            }
          }
        }
      } else {
        add({
          ...context,
          backupBlocking: true,
          code: "MEDIA_INTEGRITY_STORAGE_BACKEND_INVALID",
          severity: "error",
        });
      }
    }

    for (const publication of publications) {
      const active = activePublicationStates.has(publication.state);
      const context = {
        assetId: publication.asset_id,
        attemptId: publication.attempt_id,
        kind: publication.kind,
        state: publication.state,
        storageBackend: publication.storage_backend,
      } as const;
      if (
        publication.storage_backend === "oss" &&
        (
          !publication.storage_profile_id ||
          !storageProfileIds.has(publication.storage_profile_id)
        )
      ) {
        add({
          ...context,
          backupBlocking: true,
          code: "MEDIA_INTEGRITY_OSS_PROFILE_MISSING",
          severity: "error",
        });
      }
      if (active) {
        add({
          ...context,
          backupBlocking: publication.storage_backend === "oss" &&
            Boolean(publication.object_key),
          code: publication.state === "compensating"
            ? "MEDIA_INTEGRITY_PUBLICATION_COMPENSATING"
            : "MEDIA_INTEGRITY_PUBLICATION_ACTIVE",
          severity: "error",
        });
        if (validStorageName(publication.staging_name)) {
          referencedFiles.add(publication.staging_name);
        }
        if (validStorageName(publication.final_storage_name)) {
          referencedFiles.add(publication.final_storage_name);
        }
      }
      if (
        publication.source === "upload" &&
        publication.state === "published" &&
        publication.adopted_at === null
      ) {
        add({
          ...context,
          backupBlocking: true,
          code: "MEDIA_INTEGRITY_UPLOAD_UNADOPTED",
          severity: "error",
        });
      } else if (
        publication.source === "upload" &&
        publication.state === "published"
      ) {
        const adoptionCanvas = publication.adopted_canvas_id
          ? canvasesByKey.get(canvasKey(
              publication.owner_id,
              publication.adopted_canvas_id,
            ))
          : undefined;
        if (!adoptionCanvas) {
          // Project deletion intentionally removes canvas_documents while
          // preserving media. The journal remains durable provenance, but the
          // original graph can no longer be re-proved.
          add({
            ...context,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_UPLOAD_ADOPTION_PROVENANCE_MISSING",
            severity: "warning",
          });
        } else if (!canvasContainsMediaReference(
          adoptionCanvas,
          publication.kind,
          publication.asset_id,
        )) {
          // Adoption records the successful commit point; it is not an
          // immutable promise that the canvas will retain that node forever.
          // A later edit can legitimately remove or replace the reference.
          add({
            ...context,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_UPLOAD_ADOPTION_MISMATCH",
            severity: "warning",
          });
        }
      }
      if (publication.state !== "failed") {
        const linked = mediaByKey.get(assetKey(publication.kind, publication.asset_id));
        if (!linked) {
          add({
            ...context,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISSING",
            severity: "error",
          });
        } else {
          const expectedStatus = publication.state === "published"
            ? "ready"
            : publication.state === "compensating" ? "failed" : "pending";
          if (
            linked.owner_id !== publication.owner_id ||
            linked.storage_backend !== publication.storage_backend ||
            linked.storage_name !== publication.final_storage_name ||
            (linked.object_key ?? "") !== publication.object_key ||
            linked.storage_profile_id !== publication.storage_profile_id ||
            linked.storage_status !== expectedStatus ||
            linked.byte_size !== publication.byte_size ||
            linked.checksum_sha256 !== publication.checksum_sha256 ||
            linked.content_type !== publication.content_type ||
            linked.duration_seconds !== publication.duration_seconds ||
            linked.duration_source !== publication.duration_source ||
            linked.media_width !== publication.media_width ||
            linked.media_height !== publication.media_height
          ) {
            add({
              ...context,
              backupBlocking: false,
              code: "MEDIA_INTEGRITY_PUBLICATION_MEDIA_MISMATCH",
              severity: "error",
            });
          }
        }
      }
      if (
        ["staged", "external-ready"].includes(publication.state) &&
        !fileMap.has(publication.staging_name)
      ) {
        add({
          ...context,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_PUBLICATION_STAGING_MISSING",
          logicalPath: publication.staging_name,
          severity: "error",
        });
      }
      const staging = fileMap.get(publication.staging_name);
      const publicationSize = safeInteger(publication.byte_size);
      if (
        staging && publicationSize !== undefined && publicationSize > 0 &&
        (staging.size !== publicationSize ||
          checksumPattern.test(publication.checksum_sha256 ?? "") &&
          staging.sha256 !== publication.checksum_sha256!.toLowerCase())
      ) {
        add({
          ...context,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_PUBLICATION_STAGING_MISMATCH",
          logicalPath: publication.staging_name,
          severity: "error",
        });
      }
      if (
        publication.state === "external-ready" &&
        publication.storage_backend === "local"
      ) {
        const finalFile = fileMap.get(publication.final_storage_name);
        if (!finalFile) {
          add({
            ...context,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_PUBLICATION_FINAL_MISSING",
            logicalPath: publication.final_storage_name,
            severity: "error",
          });
        } else if (
          publicationSize === undefined || finalFile.size !== publicationSize ||
          !checksumPattern.test(publication.checksum_sha256 ?? "") ||
          finalFile.sha256 !== publication.checksum_sha256!.toLowerCase()
        ) {
          add({
            ...context,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_PUBLICATION_FINAL_MISMATCH",
            logicalPath: publication.final_storage_name,
            severity: "error",
          });
        }
      }
      if (publication.source === "generation" && publication.state !== "failed") {
        const task = publication.task_id
          ? tasksById.get(publication.task_id)
          : undefined;
        if (!task) {
          add({
            ...context,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_PUBLICATION_TASK_MISSING",
            severity: "error",
            taskId: publication.task_id ?? undefined,
          });
        } else {
          const attempt = safeInteger(task.attempt);
          const publicationAttempt = publication.task_execution_attempt === null
            ? undefined
            : safeInteger(publication.task_execution_attempt);
          const isAlternate = task.result_asset_id !== null &&
            task.result_asset_id !== publication.asset_id;
          const activeTaskMatches = publication.state === "published"
            ? task.state === "success"
              ? task.result_asset_id === publication.asset_id || isAlternate
              : task.result_asset_id === null &&
                ["running", "recovering"].includes(task.state)
            : publication.state === "compensating"
              ? task.state === "success"
                ? isAlternate
                : task.result_asset_id === null
              : task.state === "success"
                ? isAlternate
                : task.result_asset_id === null &&
                  ["running", "recovering"].includes(task.state);
          if (
            task.owner_id !== publication.owner_id ||
            task.kind !== publication.kind ||
            attempt === undefined || attempt !== publicationAttempt ||
            !activeTaskMatches
          ) {
            add({
              ...context,
              backupBlocking: false,
              code: "MEDIA_INTEGRITY_PUBLICATION_TASK_MISMATCH",
              severity: "error",
              taskId: task.id,
            });
          }
        }
      }
    }

    for (const intent of deleteIntents) {
      add({
        assetId: intent.asset_id,
        backupBlocking: true,
        code: intent.state === "delete-failed"
          ? "MEDIA_INTEGRITY_DELETE_FAILED"
          : "MEDIA_INTEGRITY_DELETE_ACTIVE",
        kind: intent.kind,
        ownerId: intent.owner_id,
        severity: "error",
        state: intent.state,
      });
    }
    for (const intent of accountDeleteIntents) {
      add({
        backupBlocking: true,
        code: intent.state === "failed"
          ? "MEDIA_INTEGRITY_ACCOUNT_DELETE_FAILED"
          : "MEDIA_INTEGRITY_ACCOUNT_DELETE_ACTIVE",
        ownerId: intent.owner_id,
        severity: "error",
        state: intent.state,
      });
    }

    const resultOwners = new Map<string, string[]>();
    for (const task of tasks) {
      if (task.state === "success" && !task.result_asset_id) {
        add({
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_TASK_RESULT_ID_MISSING",
          kind: task.kind,
          severity: "error",
          taskId: task.id,
        });
        continue;
      }
      if (!task.result_asset_id) continue;
      const key = assetKey(task.kind, task.result_asset_id);
      const owners = resultOwners.get(key) ?? [];
      owners.push(task.id);
      resultOwners.set(key, owners);
      const result = mediaByKey.get(key);
      if (!result) {
        const wrongKind = (mediaById.get(task.result_asset_id) ?? []).length > 0;
        add({
          assetId: task.result_asset_id,
          backupBlocking: false,
          code: wrongKind
            ? "MEDIA_INTEGRITY_TASK_RESULT_KIND_MISMATCH"
            : "MEDIA_INTEGRITY_TASK_RESULT_MISSING",
          kind: task.kind,
          severity: "error",
          taskId: task.id,
        });
        continue;
      }
      if (result.owner_id !== task.owner_id) {
        add({
          assetId: task.result_asset_id,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_TASK_RESULT_OWNER_MISMATCH",
          kind: task.kind,
          severity: "error",
          taskId: task.id,
        });
      }
      if (task.state === "success" && result.storage_status !== "ready") {
        add({
          assetId: task.result_asset_id,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_TASK_RESULT_NOT_READY",
          kind: task.kind,
          severity: "error",
          taskId: task.id,
        });
      }
      if (task.state === "success") {
        const history = task.owner_id
          ? historiesByKey.get(historyKey(task.owner_id, task.result_asset_id))
          : undefined;
        if (!history) {
          add({
            assetId: task.result_asset_id,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_TASK_HISTORY_MISSING",
            kind: task.kind,
            severity: "error",
            taskId: task.id,
          });
        } else if (
          history.owner_id !== task.owner_id || history.kind !== task.kind ||
          history.preview !== previewFor(task.kind, task.result_asset_id)
        ) {
          add({
            assetId: task.result_asset_id,
            backupBlocking: false,
            code: "MEDIA_INTEGRITY_TASK_HISTORY_MISMATCH",
            kind: task.kind,
            severity: "error",
            taskId: task.id,
          });
        }
      }
    }
    for (const [key, taskIds] of resultOwners) {
      if (taskIds.length < 2) continue;
      const separator = key.indexOf("\0");
      const kind = key.slice(0, separator);
      const assetId = key.slice(separator + 1);
      for (const taskId of taskIds.sort()) {
        add({
          assetId,
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_TASK_RESULT_SHARED",
          kind,
          severity: "error",
          taskId,
        });
      }
    }

    for (const history of histories) {
      const linked = mediaByKey.get(assetKey(history.kind, history.id));
      const context = {
        assetId: history.id,
        backupBlocking: false,
        kind: history.kind,
        severity: "error" as const,
      };
      if (!linked) {
        add({
          ...context,
          code: (mediaById.get(history.id) ?? []).length > 0
            ? "MEDIA_INTEGRITY_HISTORY_MEDIA_KIND_MISMATCH"
            : "MEDIA_INTEGRITY_HISTORY_MEDIA_MISSING",
        });
        continue;
      }
      if (
        history.account_id !== linked.owner_id ||
        history.owner_id !== linked.owner_id
      ) {
        add({
          ...context,
          code: "MEDIA_INTEGRITY_HISTORY_MEDIA_OWNER_MISMATCH",
        });
      }
      if (linked.storage_status !== "ready") {
        add({
          ...context,
          code: "MEDIA_INTEGRITY_HISTORY_MEDIA_NOT_READY",
          state: linked.storage_status,
          storageBackend: linked.storage_backend,
        });
      }
    }
    for (const file of fileMap.values()) {
      if (!referencedFiles.has(file.logicalPath)) {
        add({
          backupBlocking: false,
          code: "MEDIA_INTEGRITY_LOCAL_FILE_ORPHAN",
          logicalPath: file.logicalPath,
          severity: "warning",
        });
      }
    }
    for (const evidence of ossMap.values()) {
      if (!usedOssEvidence.has(evidence.objectKey)) {
        add({
          backupBlocking: true,
          code: "MEDIA_INTEGRITY_OSS_EVIDENCE_UNUSED",
          logicalPath: evidence.objectKey,
          severity: "error",
          storageBackend: "oss",
        });
      }
    }

    const sortedIssues = [...issues].sort((left, right) =>
      issueSortKey(left).localeCompare(issueSortKey(right)));
    const counts: MediaIntegrityCounts = Object.freeze({
      accountDeleteIntents: accountDeleteIntents.length,
      activeDeleteIntents: deleteIntents.filter(({ state }) =>
        state === "delete-requested").length,
      activePublicationAttempts: publications.filter(({ state }) =>
        activePublicationStates.has(state)).length,
      assets: media.length,
      backupBlockingIssues: sortedIssues.filter(({ backupBlocking }) =>
        backupBlocking).length,
      failed: media.filter(({ storage_status }) => storage_status === "failed").length,
      failedDeleteIntents: deleteIntents.filter(({ state }) =>
        state === "delete-failed").length,
      files: fileMap.size,
      issues: sortedIssues.length,
      ossEvidence: ossMap.size,
      pending: media.filter(({ storage_status }) => storage_status === "pending").length,
      publicationAttempts: publications.length,
      ready: media.filter(({ storage_status }) => storage_status === "ready").length,
    });
    const core = Object.freeze({
      backupComplete: counts.backupBlockingIssues === 0,
      clean: counts.issues === 0,
      counts,
      databaseLogicalSha256: input.databaseLogicalSha256.toLowerCase(),
      evidenceSha256: evidenceSha256(fileMap, ossMap),
      issues: Object.freeze(sortedIssues),
      schemaVersion,
      version: 1 as const,
    });
    return Object.freeze({
      ...core,
      sha256: sha256(stableJson(core)),
    });
  } catch (error) {
    if (error instanceof MediaIntegrityError) throw error;
    return fail(
      "MEDIA_REPORT_DATABASE_INVALID",
      "Media database could not be inspected",
    );
  } finally {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
  }
}
