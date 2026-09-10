import type { TransactionScopedCommand } from "./transactionCommand";

export const readGenerationPublicationSlotsCommand: TransactionScopedCommand<Readonly<{
  taskId: string; executionAttempt: number;
}>, readonly Record<string, unknown>[]> = {
  execute(scope, input) {
    const rows = scope.prepare(`SELECT publication.*, media.storage_status AS media_storage_status,
      media.byte_size AS asset_byte_size, media.checksum_sha256 AS asset_checksum_sha256,
      media.content_type AS asset_content_type, media.storage_backend AS asset_storage_backend,
      media.storage_profile_id AS asset_storage_profile_id, media.object_key AS asset_object_key,
      deletion.state AS deletion_state
      FROM media_publication_attempts AS publication
      LEFT JOIN media_assets AS media ON media.owner_id = publication.owner_id
        AND media.kind = publication.kind AND media.id = publication.asset_id
      LEFT JOIN media_delete_intents AS deletion ON deletion.owner_id = publication.owner_id
        AND deletion.kind = publication.kind AND deletion.asset_id = publication.asset_id
      WHERE publication.task_id = ? AND publication.task_execution_attempt = ?
      ORDER BY publication.output_slot, publication.attempt_id LIMIT 257`)
      .all(input.taskId, input.executionAttempt) as Record<string, unknown>[];
    if (rows.length > 256) throw new Error("Publication evidence exceeds its safe bound");
    return rows;
  },
};

/** Ordered existing candidates for local original-result settlement, bounded
 * one past the supported result count so excess evidence stays detectable. */
export const readPublishedOriginalMediaCandidateIdsCommand: TransactionScopedCommand<Readonly<{
  taskId: string; ownerId: string; kind: "audio" | "image" | "video"; executionAttempt: number;
}>, readonly string[]> = {
  execute(scope, input) {
    const rows = scope.prepare(`SELECT publication.asset_id FROM media_publication_attempts AS publication
      JOIN media_assets AS media ON media.owner_id = publication.owner_id
        AND media.kind = publication.kind AND media.id = publication.asset_id
      WHERE publication.source = 'generation' AND publication.state = 'published'
        AND publication.output_slot IS NOT NULL
        AND publication.task_id = ? AND publication.task_execution_attempt = ?
        AND publication.owner_id = ? AND publication.kind = ? AND media.storage_status = 'ready'
      ORDER BY publication.output_slot LIMIT 5`)
      .all(input.taskId, input.executionAttempt, input.ownerId, input.kind) as { asset_id: string }[];
    return rows.map((row) => row.asset_id);
  },
};

/** Bounded exact ledger rows, only for original-result concurrency validation. */
export const readGenerationRecoveryMediaCommand: TransactionScopedCommand<Readonly<{
  taskId: string; ownerId: string; resultAssetId?: string;
}>, Readonly<{ publications: readonly Readonly<Record<string, unknown>>[];
  assets: readonly Readonly<Record<string, unknown>>[] }>> = {
  execute(scope, input) {
    const publications = scope.prepare(`SELECT * FROM media_publication_attempts
      WHERE task_id = ? ORDER BY attempt_id LIMIT 257`).all(input.taskId) as Record<string, unknown>[];
    if (publications.length > 256) throw new Error("Recovery publication ledger exceeds its safe bound");
    const ids = [...new Set([...publications.flatMap((row) => typeof row.asset_id === "string" ? [row.asset_id] : []),
      ...(input.resultAssetId ? [input.resultAssetId] : [])])];
    const assets = ids.length ? scope.prepare(`SELECT * FROM media_assets
      WHERE owner_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY kind,id`)
      .all(input.ownerId, ...ids) as Record<string, unknown>[] : [];
    return { publications, assets };
  },
};

/** Small Media-owned scan projection; no result bytes or external work. */
export const readGenerationRecoveryPublicationStateCommand: TransactionScopedCommand<string,
  Readonly<{ pending: boolean; quarantined: boolean }>> = {
  execute(scope, taskId) {
    const row = scope.prepare(`SELECT
      MAX(CASE WHEN state IN ('reserved','staged','external-ready','compensating') THEN 1 ELSE 0 END) AS pending,
      MAX(CASE WHEN error_code = 'OSS_IDENTITY_QUARANTINED' THEN 1 ELSE 0 END) AS quarantined
      FROM media_publication_attempts WHERE task_id = ?`).get(taskId) as { pending: number | null; quarantined: number | null };
    return { pending: Boolean(row.pending), quarantined: Boolean(row.quarantined) };
  },
};

export type ReadyMediaAssetRow = Readonly<{
  byteSize: number;
  checksumSha256: string | null;
  contentType: string;
  createdAt: string;
  durationSeconds: number | null;
  durationStatus: "failed" | "not-applicable" | "pending" | "ready";
  height: number | null;
  hasTransparency: boolean | null;
  id: string;
  kind: "audio" | "image" | "video";
  mediaHeight: number | null;
  mediaWidth: number | null;
  storageBackend: "local" | "oss";
  storageStatus: "ready";
  width: number | null;
}>;

export const readReadyMediaAssetCommand: TransactionScopedCommand<Readonly<{
  assetId: string;
  kind: "audio" | "image" | "video";
  ownerId: string;
}>, ReadyMediaAssetRow | undefined> = {
  execute(scope, input) {
    const row = scope.prepare(`
      SELECT media.id, media.kind, media.byte_size, media.content_type,
             media.duration_seconds, media.media_height, media.media_width,
             media.storage_backend, media.checksum_sha256,
             media.duration_status, media.created_at,
             image_metadata.has_transparency
      FROM media_assets AS media
      LEFT JOIN media_image_metadata AS image_metadata
        ON image_metadata.owner_id = media.owner_id
        AND image_metadata.kind = media.kind
        AND image_metadata.asset_id = media.id
      WHERE media.owner_id = ? AND media.kind = ? AND media.id = ?
        AND media.storage_status = 'ready'
    `).get(input.ownerId, input.kind, input.assetId) as
      | {
          byte_size: number;
          checksum_sha256: string | null;
          content_type: string | null;
          created_at: string;
          duration_seconds: number | null;
          duration_status: "failed" | "not-applicable" | "pending" | "ready";
          id: string;
          kind: "audio" | "image" | "video";
          has_transparency: number | null;
          media_height: number | null;
          media_width: number | null;
          storage_backend: "local" | "oss";
        }
      | undefined;
    if (!row || !row.content_type) return undefined;
    return Object.freeze({
      byteSize: Number(row.byte_size),
      checksumSha256: row.checksum_sha256,
      contentType: row.content_type,
      createdAt: row.created_at,
      durationSeconds: row.duration_seconds,
      durationStatus: row.duration_status,
      height: row.media_height,
      hasTransparency: row.has_transparency === null
        ? null
        : row.has_transparency === 1,
      id: row.id,
      kind: row.kind,
      mediaHeight: row.media_height,
      mediaWidth: row.media_width,
      storageBackend: row.storage_backend,
      storageStatus: "ready",
      width: row.media_width,
    });
  },
};

export type ReadyMediaAssetIdentityRow = Readonly<{
  byteSize: number;
  checksumSha256: string | null;
  contentType: string | null;
  durationSeconds: number | null;
  durationStatus: "failed" | "not-applicable" | "pending" | "ready";
  id: string;
  kind: "audio" | "image" | "video";
  mediaHeight: number | null;
  mediaWidth: number | null;
  objectKey: string | null;
  storageBackend: "local" | "oss";
  storageName: string;
  storageProfileId: string | null;
  storageStatus: "ready";
}>;

/**
 * Media-owned transaction read for a complete frozen external identity.
 * Unlike the compatibility ready read above, this intentionally returns
 * nullable legacy metadata so the caller can fail closed without guessing.
 */
export const readReadyMediaAssetIdentityCommand: TransactionScopedCommand<Readonly<{
  assetId: string;
  kind: "audio" | "image" | "video";
  ownerId: string;
}>, ReadyMediaAssetIdentityRow | undefined> = {
  execute(scope, input) {
    const row = scope.prepare(`
      SELECT id, kind, byte_size, checksum_sha256, content_type,
             duration_seconds, duration_status, media_height, media_width,
             object_key, storage_backend, storage_name, storage_profile_id,
             storage_status
      FROM media_assets
      WHERE owner_id = ? AND kind = ? AND id = ?
        AND storage_status = 'ready'
    `).get(input.ownerId, input.kind, input.assetId) as
      | {
          byte_size: number;
          checksum_sha256: string | null;
          content_type: string | null;
          duration_seconds: number | null;
          duration_status: "failed" | "not-applicable" | "pending" | "ready";
          id: string;
          kind: "audio" | "image" | "video";
          media_height: number | null;
          media_width: number | null;
          object_key: string | null;
          storage_backend: "local" | "oss";
          storage_name: string;
          storage_profile_id: string | null;
          storage_status: "ready";
        }
      | undefined;
    if (!row) return undefined;
    return Object.freeze({
      byteSize: Number(row.byte_size),
      checksumSha256: row.checksum_sha256,
      contentType: row.content_type,
      durationSeconds: row.duration_seconds,
      durationStatus: row.duration_status,
      id: row.id,
      kind: row.kind,
      mediaHeight: row.media_height,
      mediaWidth: row.media_width,
      objectKey: row.object_key,
      storageBackend: row.storage_backend,
      storageName: row.storage_name,
      storageProfileId: row.storage_profile_id,
      storageStatus: row.storage_status,
    });
  },
};

export type PublishedGenerationMediaProjectionRow = Readonly<{
  assetId: string;
  attemptId: string;
  byteSize: number;
  checksumSha256: string;
  contentType: string;
  createdAt: string;
  durationSeconds: number | null;
  durationStatus: "failed" | "not-applicable" | "pending" | "ready";
  height: number | null;
  hasTransparency: boolean | null;
  storageBackend: "local" | "oss";
  width: number | null;
}>;

export const readPublishedGenerationMediaProjectionCommand:
  TransactionScopedCommand<Readonly<{
    executionAttempt: number;
    kind: "audio" | "image" | "video";
    ownerId: string;
    primaryAssetId: string;
    taskId: string;
  }>, readonly PublishedGenerationMediaProjectionRow[]> = {
    execute(scope, input) {
      const rows = scope.prepare(`
        SELECT publication.asset_id, publication.attempt_id,
               publication.created_at, media.byte_size, media.checksum_sha256,
               media.content_type, media.duration_seconds,
               media.duration_status, media.media_height, media.media_width,
               media.storage_backend, image_metadata.has_transparency
        FROM media_publication_attempts AS publication
        JOIN media_assets AS media
          ON media.owner_id = publication.owner_id
          AND media.kind = publication.kind
          AND media.id = publication.asset_id
        LEFT JOIN media_image_metadata AS image_metadata
          ON image_metadata.owner_id = media.owner_id
          AND image_metadata.kind = media.kind
          AND image_metadata.asset_id = media.id
        WHERE publication.source = 'generation'
          AND publication.state = 'published'
          AND (publication.output_slot IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM media_publication_attempts AS mapped
        WHERE mapped.task_id = publication.task_id
          AND mapped.task_execution_attempt = publication.task_execution_attempt
          AND mapped.output_slot IS NOT NULL AND mapped.state = 'published'
      ))
          AND publication.task_id = ?
          AND publication.task_execution_attempt = ?
          AND publication.owner_id = ?
          AND publication.kind = ?
          AND media.storage_status = 'ready'
        ORDER BY CASE WHEN publication.asset_id = ? THEN 0 ELSE 1 END,
                 publication.output_slot, publication.created_at, publication.attempt_id
      `).all(
        input.taskId,
        input.executionAttempt,
        input.ownerId,
        input.kind,
        input.primaryAssetId,
      ) as Array<{
        asset_id: string;
        attempt_id: string;
        byte_size: number;
        checksum_sha256: string | null;
        content_type: string | null;
        created_at: string;
        duration_seconds: number | null;
        duration_status: "failed" | "not-applicable" | "pending" | "ready";
        has_transparency: number | null;
        media_height: number | null;
        media_width: number | null;
        storage_backend: "local" | "oss";
      }>;
      return Object.freeze(rows.flatMap((row) =>
        row.checksum_sha256 && row.content_type
          ? [Object.freeze({
              assetId: row.asset_id,
              attemptId: row.attempt_id,
              byteSize: Number(row.byte_size),
              checksumSha256: row.checksum_sha256,
              contentType: row.content_type,
              createdAt: row.created_at,
              durationSeconds: row.duration_seconds,
              durationStatus: row.duration_status,
              height: row.media_height,
              hasTransparency: row.has_transparency === null
                ? null
                : row.has_transparency === 1,
              storageBackend: row.storage_backend,
              width: row.media_width,
            })]
          : [],
      ));
    },
  };

export const transferAccountMediaCommand: TransactionScopedCommand<Readonly<{
  assetId: string;
  kind: "audio" | "image" | "video";
  ownerId: string;
  rootOwnerId: string;
}>, number> = {
  execute(scope, input) {
    return Number(scope.prepare(`
      UPDATE media_assets
      SET owner_id = ?
      WHERE owner_id = ? AND kind = ? AND id = ?
        AND storage_status = 'ready'
    `).run(
      input.rootOwnerId,
      input.ownerId,
      input.kind,
      input.assetId,
    ).changes);
  },
};

/** Promote only the verified canonical row; all duplicate evidence remains intact. */
export const promoteGenerationPublicationCanonicalSlotCommand: TransactionScopedCommand<Readonly<{
  ownerId: string; taskId: string; executionAttempt: number;
  kind: "image" | "video" | "audio"; adoptionReceiptId: string;
  canonicalAttemptId: string; canonicalAssetId: string;
  aliasAttemptId: string; aliasAssetId: string; outputSetCount: 1;
}>, void> = {
  execute(scope, input) {
    const rows = scope.prepare(`SELECT publication.*, media.storage_status,
      media.byte_size AS media_byte_size, media.checksum_sha256 AS media_checksum,
      media.content_type AS media_content_type, media.storage_backend AS media_storage_backend,
      media.storage_profile_id AS media_storage_profile_id, media.object_key AS media_object_key
      FROM media_publication_attempts AS publication
      LEFT JOIN media_assets AS media ON media.owner_id = publication.owner_id
        AND media.kind = publication.kind AND media.id = publication.asset_id
      WHERE publication.task_id = ? AND publication.task_execution_attempt = ?`)
      .all(input.taskId, input.executionAttempt) as Array<Record<string, unknown>>;
    const canonical = rows.find((row) => row.attempt_id === input.canonicalAttemptId);
    const alias = rows.find((row) => row.attempt_id === input.aliasAttemptId);
    if (rows.length !== 3 || !canonical || !alias || canonical === alias ||
        canonical.asset_id !== input.canonicalAssetId || alias.asset_id !== input.aliasAssetId ||
        canonical.asset_id === alias.asset_id || input.outputSetCount !== 1 ||
        rows.some((row) => row.owner_id !== input.ownerId || row.kind !== input.kind ||
          row.source !== "generation" || row.error_code === "OSS_IDENTITY_QUARANTINED") ||
        rows.filter((row) => row.state === "failed" && row.byte_size === 0).length !== 1 ||
        [canonical, alias].some((row) => row.state !== "published" ||
          row.storage_status !== "ready" || Number(row.byte_size) < 1 ||
          row.byte_size !== row.media_byte_size || row.checksum_sha256 !== row.media_checksum ||
          row.content_type !== row.media_content_type || row.storage_backend !== row.media_storage_backend ||
          row.storage_profile_id !== row.media_storage_profile_id || row.object_key !== row.media_object_key) ||
        canonical.checksum_sha256 !== alias.checksum_sha256 || canonical.byte_size !== alias.byte_size ||
        alias.output_slot !== null || alias.output_set_count !== null ||
        !(canonical.output_slot === null && canonical.output_set_count === null ||
          canonical.output_slot === 0 && canonical.output_set_count === 1)) {
      throw new Error("Canonical publication promotion evidence changed");
    }
    if (scope.prepare(`SELECT 1 FROM media_delete_intents WHERE owner_id = ?
        AND kind = ? AND asset_id IN (?, ?)`)
        .get(input.ownerId, input.kind, input.canonicalAssetId, input.aliasAssetId)) {
      throw new Error("Canonical publication deletion is pending");
    }
    if (canonical.output_slot === 0) return;
    const changed = scope.prepare(`UPDATE media_publication_attempts
      SET output_slot = 0, output_set_count = 1
      WHERE attempt_id = ? AND owner_id = ? AND kind = ? AND asset_id = ?
        AND task_id = ? AND task_execution_attempt = ? AND state = 'published'
        AND output_slot IS NULL AND output_set_count IS NULL`)
      .run(input.canonicalAttemptId, input.ownerId, input.kind, input.canonicalAssetId,
        input.taskId, input.executionAttempt);
    if (changed.changes !== 1) throw new Error("Canonical publication promotion lost ownership");
  },
};

export const preparePrivateAccountMediaDeletionCommand: TransactionScopedCommand<Readonly<{
  ownerId: string;
  timestamp: string;
}>, number> = {
  execute(scope, input) {
    const media = scope.prepare(`
      SELECT kind, id
      FROM media_assets
      WHERE owner_id = ?
      ORDER BY kind, id
    `).all(input.ownerId) as Array<{
      id: string;
      kind: "audio" | "image" | "video";
    }>;
    const upsertIntent = scope.prepare(`
      INSERT INTO media_delete_intents (
        owner_id, kind, asset_id, state, created_at, updated_at
      ) VALUES (?, ?, ?, 'delete-requested', ?, ?)
      ON CONFLICT(owner_id, kind, asset_id) DO UPDATE SET
        state = 'delete-requested', updated_at = excluded.updated_at
      WHERE media_delete_intents.state IN (
        'tombstone', 'delete-requested', 'delete-failed'
      )
    `);
    for (const row of media) {
      const intent = upsertIntent.run(
        input.ownerId,
        row.kind,
        row.id,
        input.timestamp,
        input.timestamp,
      );
      if (intent.changes !== 1) {
        throw new Error("Account media deletion changed concurrently");
      }
    }
    scope.prepare(`
      UPDATE media_assets
      SET storage_status = 'failed', duration_status = CASE
            WHEN kind = 'image' THEN 'not-applicable' ELSE 'failed' END,
          updated_at = ?
      WHERE owner_id = ?
    `).run(input.timestamp, input.ownerId);
    scope.prepare(`
      UPDATE media_publication_attempts
      SET state = 'failed', error_code = 'ACCOUNT_DELETE_REQUESTED',
          updated_at = ?
      WHERE owner_id = ? AND state = 'published'
    `).run(input.timestamp, input.ownerId);
    return media.length;
  },
};

export const registerLegacyMediaCommand: TransactionScopedCommand<Readonly<{
  items: readonly Readonly<{
    byteSize: number;
    id: string;
    kind: "audio" | "image" | "video";
    storageName: string;
  }>[];
  ownerId: string;
  timestamp: string;
}>, void> = {
  execute(scope, input) {
    const register = scope.prepare(`
      INSERT OR IGNORE INTO media_assets (
        kind, id, owner_id, storage_name, byte_size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of input.items) {
      register.run(
        item.kind,
        item.id,
        input.ownerId,
        item.storageName,
        item.byteSize,
        input.timestamp,
        input.timestamp,
      );
    }
  },
};

export type AccountMediaDeletionRow = Readonly<{
  id: string;
  kind: "audio" | "image" | "video";
  object_key: string | null;
  owner_id: string;
  storage_backend: string;
  storage_name: string;
  storage_profile_id: string | null;
}>;

export const finishAccountMediaDeletionCommand: TransactionScopedCommand<Readonly<{
  row: AccountMediaDeletionRow;
  timestamp: string;
}>, void> = {
  execute(scope, { row, timestamp }) {
    const removed = scope.prepare(`
      DELETE FROM media_assets
      WHERE owner_id = ? AND kind = ? AND id = ? AND storage_status = 'failed'
        AND storage_name = ? AND storage_backend = ?
        AND storage_profile_id IS ? AND object_key IS ?
    `).run(
      row.owner_id,
      row.kind,
      row.id,
      row.storage_name,
      row.storage_backend,
      row.storage_profile_id,
      row.object_key,
    );
    if (removed.changes !== 1) throw new Error("Account media changed concurrently");
    const completed = scope.prepare(`
      UPDATE media_delete_intents
      SET state = 'tombstone', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = 'delete-requested'
    `).run(timestamp, row.owner_id, row.kind, row.id);
    if (completed.changes !== 1) {
      throw new Error("Account media intent changed concurrently");
    }
  },
};

export const failAccountMediaDeletionCommand: TransactionScopedCommand<Readonly<{
  row: AccountMediaDeletionRow;
  timestamp: string;
}>, void> = {
  execute(scope, { row, timestamp }) {
    scope.prepare(`
      UPDATE media_delete_intents
      SET state = 'delete-failed', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state = 'delete-requested'
    `).run(timestamp, row.owner_id, row.kind, row.id);
  },
};

/** Any publication evidence must be reconciled before a paid result is declared absent. */
export const hasGenerationPublicationEvidenceCommand: TransactionScopedCommand<
  Readonly<{ taskId: string }>, boolean
> = {
  execute(scope, input) {
    return Boolean(scope.prepare(`SELECT 1 FROM media_publication_attempts
      WHERE task_id = ? LIMIT 1`).get(input.taskId));
  },
};
