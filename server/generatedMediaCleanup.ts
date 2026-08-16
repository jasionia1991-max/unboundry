import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { deletePrivateAliyunOssObject } from "./aliyunOss";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  readableMediaForOwner,
  type MediaKind,
} from "./mediaRegistry";
import { storageProfileForDestructiveMedia } from "./secureStorageProfiles";

/**
 * Compensates a private media save when the owning relay task is cancelled or
 * loses its terminal-state race. Failed OSS deletion stays registered as a
 * failed internal record so it can be audited instead of becoming visible.
 */
export async function removeUnpublishedGeneratedMedia(input: {
  assetId: string;
  kind: MediaKind;
  ownerId: string;
}) {
  const media = readableMediaForOwner(input.ownerId, input.kind, input.assetId);
  if (!media) return true;
  const hidden = openAppDatabase();
  try {
    hidden.exec("BEGIN IMMEDIATE");
    const success = hidden.prepare(`
      SELECT 1 FROM generation_tasks
      WHERE owner_id = ? AND kind = ? AND result_asset_id = ?
        AND state = 'success'
      LIMIT 1
    `).get(input.ownerId, input.kind, input.assetId);
    if (success) throw new Error("Published generation result cannot be compensated");
    hidden.prepare(`
      UPDATE media_assets
      SET storage_status = 'failed', updated_at = ?
      WHERE owner_id = ? AND kind = ? AND id = ?
        AND storage_status IN ('pending', 'ready', 'failed')
    `).run(new Date().toISOString(), input.ownerId, input.kind, input.assetId);
    hidden.prepare(`
      DELETE FROM asset_history
      WHERE account_id = ? AND owner_id = ? AND id = ? AND kind = ?
    `).run(input.ownerId, input.ownerId, input.assetId, input.kind);
    hidden.prepare(`
      UPDATE generation_tasks
      SET result_asset_id = NULL, updated_at = ?
      WHERE owner_id = ? AND kind = ? AND result_asset_id = ?
        AND state <> 'success'
    `).run(new Date().toISOString(), input.ownerId, input.kind, input.assetId);
    hidden.prepare(`
      UPDATE media_publication_attempts
      SET state = 'compensating', error_code = 'MEDIA_RESULT_DISCARDED',
          retry_count = retry_count + 1, updated_at = ?
      WHERE owner_id = ? AND kind = ? AND asset_id = ?
        AND state <> 'failed'
    `).run(new Date().toISOString(), input.ownerId, input.kind, input.assetId);
    hidden.exec("COMMIT");
  } catch (error) {
    if (hidden.isTransaction) hidden.exec("ROLLBACK");
    throw error;
  } finally {
    hidden.close();
  }
  let externalRemoved = false;
  if (media.storageBackend === "oss") {
    try {
      const profile = await storageProfileForDestructiveMedia(media);
      if (!profile || !media.objectKey) throw new Error("OSS unavailable");
      await deletePrivateAliyunOssObject(media.objectKey, profile);
      externalRemoved = true;
    } catch {
      externalRemoved = false;
    }
  } else {
    if (
      !media.storageName ||
      basename(media.storageName) !== media.storageName
    ) throw new Error("Invalid generated media path");
    await rm(join(appDataDirectory(), "media", media.storageName), {
      force: true,
    });
    externalRemoved = true;
  }

  const store = openAppDatabase();
  try {
    store.exec("BEGIN IMMEDIATE");
    if (externalRemoved) {
      store.prepare(`
        DELETE FROM media_assets
        WHERE owner_id = ? AND kind = ? AND id = ?
      `).run(input.ownerId, input.kind, input.assetId);
      store.prepare(`
        UPDATE media_publication_attempts
        SET state = 'failed', updated_at = ?
        WHERE owner_id = ? AND kind = ? AND asset_id = ?
          AND state = 'compensating'
      `).run(new Date().toISOString(), input.ownerId, input.kind, input.assetId);
    } else {
      store.prepare(`
        UPDATE media_assets
        SET storage_status = 'failed', updated_at = ?
        WHERE owner_id = ? AND kind = ? AND id = ?
      `).run(
        new Date().toISOString(),
        input.ownerId,
        input.kind,
        input.assetId,
      );
    }
    store.exec("COMMIT");
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  } finally {
    store.close();
  }
  return externalRemoved;
}
