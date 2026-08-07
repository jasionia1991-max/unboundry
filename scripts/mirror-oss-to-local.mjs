import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import OSS from "ali-oss";
import { DatabaseSync } from "node:sqlite";
import { appDataDirectory } from "../server/database.ts";
import {
  listStorageProfiles,
  readableStorageProfile,
} from "../server/secureStorageProfiles.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const profileId = argument("--profile-id");
const prefix = (argument("--prefix") ?? "objects/").replace(/^\/+|\/+$/g, "");
const dryRun = argument("--dry-run") !== undefined;
const destination = resolve(
  argument("--dest-dir") ?? join(process.cwd(), "backups", "oss-mirror"),
);
const dataDirectory = resolve(
  argument("--data-dir") ?? appDataDirectory(),
);

const document = await listStorageProfiles();
const profile = profileId
  ? document.profiles.find(
      (candidate) =>
        candidate.id === profileId &&
        (candidate.status === "active" || candidate.status === "verified"),
    )
  : await readableStorageProfile();
if (!profile) {
  throw new Error("没有可用的 OSS 读取配置（请先测试并选为正式配置）");
}

const client = new OSS({
  accessKeyId: profile.accessKeyId,
  accessKeySecret: profile.accessKeySecret,
  authorizationV4: true,
  bucket: profile.bucket,
  endpoint: profile.endpoint,
  region: profile.region,
  secure: true,
  timeout: 120_000,
});

const objects = [];
let marker;
do {
  const listParams = {
    "max-keys": 1000,
    prefix: `${prefix}/`,
  };
  if (marker) listParams.marker = marker;
  const result = await client.list(listParams);
  objects.push(
    ...(result.objects ?? [])
      .filter((object) => !object.name.startsWith("objects/backups/"))
      .map((object) => ({
        name: object.name,
        size: Number(object.size),
      })),
  );
  marker = result.nextMarker;
} while (marker);

console.log(
  JSON.stringify({
    bucket: profile.bucket,
    dryRun,
    objects: objects.length,
    prefix,
    totalBytes: objects.reduce((total, object) => total + object.size, 0),
  }),
);
if (dryRun) process.exit(0);

await mkdir(destination, { recursive: true });
const database = new DatabaseSync(
  join(dataDirectory, "tapnow.sqlite"),
  { readOnly: true },
);
const checksumByKey = new Map(
  database
    .prepare(`
      SELECT object_key, checksum_sha256
      FROM media_assets
      WHERE storage_backend = 'oss' AND checksum_sha256 IS NOT NULL
    `)
    .all()
    .map((row) => [row.object_key, row.checksum_sha256]),
);
database.close();

const mismatches = [];
let downloaded = 0;
for (const object of objects) {
  const url = client.signatureUrlV4(
    "GET",
    600,
    { headers: {} },
    object.name,
  );
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    mismatches.push({ name: object.name, reason: `HTTP ${response.status}` });
    continue;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = join(destination, object.name);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  downloaded += 1;
  const actual = createHash("sha256").update(bytes).digest("hex");
  const expected = checksumByKey.get(object.name);
  if (expected && actual !== expected) {
    mismatches.push({ name: object.name, reason: "SHA-256 mismatch" });
  }
}

console.log(
  JSON.stringify({
    downloaded,
    mismatches,
  }),
);
