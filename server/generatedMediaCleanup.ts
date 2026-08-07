import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { deletePrivateAliyunOssObject } from "./aliyunOss";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  readableMediaForOwner,
  type MediaKind,
} from "./mediaRegistry";
import { storageProfileForMedia } from "./secureStorageProfiles";

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
  let externalRemoved = false;
  if (media.storageBackend === "oss") {
    try {
      const profile = await storageProfileForMedia(media);
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
    store.prepare(`
      DELETE FROM asset_history
      WHERE account_id = ? AND owner_id = ? AND id = ? AND kind = ?
    `).run(input.ownerId, input.ownerId, input.assetId, input.kind);
    if (externalRemoved) {
      store.prepare(`
        DELETE FROM media_assets
        WHERE owner_id = ? AND kind = ? AND id = ?
      `).run(input.ownerId, input.kind, input.assetId);
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
