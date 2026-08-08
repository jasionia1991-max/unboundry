import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPrivateAliyunOssReadUrl } from "../../server/aliyunOss";
import { activeStorageProfile } from "../../server/secureStorageProfiles";

/**
 * Production-only acceptance retained from the original m13 suite.
 * It is deliberately not registered as an automatic test: it reads a real
 * database and performs real OSS Range/full reads, so it requires a separate
 * future user authorization and may never run in the offline Goal.
 */
export async function verifyRealOssRangeAndCompleteRead(dataDirectory: string) {
  const database = new DatabaseSync(join(dataDirectory, "unboundry.sqlite"), {
    readOnly: true,
  });
  const media = database
    .prepare(`
      SELECT object_key, byte_size, checksum_sha256
      FROM media_assets
      WHERE kind = 'image'
        AND storage_backend = 'oss'
        AND storage_status = 'ready'
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get() as
    | { byte_size: number; checksum_sha256: string; object_key: string }
    | undefined;
  database.close();
  if (!media) throw new Error("No ready OSS image is available for verification");
  const profile = await activeStorageProfile();
  if (!profile) throw new Error("No active OSS profile is available");
  const signedUrl = await createPrivateAliyunOssReadUrl(
    media.object_key,
    profile,
    60,
  );
  const range = await fetch(signedUrl, { headers: { Range: "bytes=0-0" } });
  if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 1) {
    throw new Error("Real OSS Range verification failed");
  }
  const complete = await fetch(signedUrl);
  const bytes = Buffer.from(await complete.arrayBuffer());
  if (
    complete.status !== 200 ||
    bytes.length !== Number(media.byte_size) ||
    createHash("sha256").update(bytes).digest("hex") !== media.checksum_sha256
  ) {
    throw new Error("Real OSS complete-read verification failed");
  }
}
