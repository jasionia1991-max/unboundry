import type { DatabaseSync } from "node:sqlite";
import { accountAllowsDurableMediaReferenceCommand } from
  "./accountTransactionCommands";
import { openAppDatabase } from "./database";
import { adoptUploadedMediaReferences } from "./mediaLifecycle";
import type { MediaKind } from "./mediaRegistry";
import { executeTransactionScopedCommand } from "./transactionCommand";

export type MediaLibraryReferenceLease = Readonly<{
  commit(): void;
  rollback(): void;
}>;

export function beginMediaLibraryReference(input: Readonly<{
  assetId: string;
  kind: MediaKind;
  ownerId: string;
}>): MediaLibraryReferenceLease {
  const database = openAppDatabase();
  database.exec("BEGIN IMMEDIATE");
  let finished = false;
  try {
    const accountAllowed = executeTransactionScopedCommand(
      database,
      accountAllowsDurableMediaReferenceCommand,
      input.ownerId,
    );
    const allowed = database.prepare(`
      SELECT 1
      FROM media_assets AS media
      WHERE media.owner_id = ? AND media.kind = ? AND media.id = ?
        AND media.storage_status = 'ready'
        AND NOT EXISTS (
          SELECT 1 FROM media_delete_intents
          WHERE owner_id = media.owner_id AND kind = media.kind
            AND asset_id = media.id
        )
    `).get(input.ownerId, input.kind, input.assetId);
    if (!accountAllowed || !allowed) {
      throw new Error("素材不存在、未就绪或正在删除");
    }
    adoptUploadedMediaReferences(database, {
      canvasId: `library:${input.ownerId}`,
      ownerId: input.ownerId,
      references: [{ assetId: input.assetId, kind: input.kind }],
    });
    return Object.freeze({
      commit() {
        if (finished) return;
        database.exec("COMMIT");
        finished = true;
        database.close();
      },
      rollback() {
        if (finished) return;
        if (database.isTransaction) database.exec("ROLLBACK");
        finished = true;
        database.close();
      },
    });
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    database.close();
    throw error;
  }
}

export function composeMediaDeletionGuards(
  ...guards: Array<((database: DatabaseSync, input: Readonly<{
    assetId: string;
    kind: MediaKind;
    ownerId: string;
  }>) => void) | undefined>
) {
  return (database: DatabaseSync, input: Readonly<{
    assetId: string;
    kind: MediaKind;
    ownerId: string;
  }>) => {
    for (const guard of guards) guard?.(database, input);
  };
}
