import type { TransactionScopedCommand } from "./transactionCommand";

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
