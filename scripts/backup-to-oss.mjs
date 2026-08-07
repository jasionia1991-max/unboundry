import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import OSS from "ali-oss";
import {
  uploadPrivateAliyunOssObject,
} from "../server/aliyunOss.ts";
import { appDataDirectory } from "../server/database.ts";
import {
  listStorageProfiles,
  readableStorageProfile,
} from "../server/secureStorageProfiles.ts";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function contentTypeFor(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".sqlite")) return "application/octet-stream";
  return "application/octet-stream";
}

const dataDirectory = resolve(
  argument("--data-dir") ?? appDataDirectory(),
);
const profileId = argument("--profile-id");
const prefix = (argument("--prefix") ?? "backups").replace(/^\/+|\/+$/g, "");
const dryRun = argument("--dry-run") !== undefined;
const stagingRoot = resolve(
  argument("--staging-root") ??
    join(process.cwd(), "tmp", "oss-backup-staging"),
);
const retainDays = Number(argument("--retain-days") ?? "0");

const document = await listStorageProfiles();
const profile = profileId
  ? document.profiles.find(
      (candidate) =>
        candidate.id === profileId &&
        (candidate.status === "active" || candidate.status === "verified"),
    )
  : await readableStorageProfile();
if (!profile) {
  throw new Error("没有可用的 OSS 备份配置（请先测试并选为正式配置）");
}

await mkdir(stagingRoot, { recursive: true });
const backupOutput = execFileSync(
  process.execPath,
  [
    "scripts/backup-data.mjs",
    "--data-dir",
    dataDirectory,
    "--backup-root",
    stagingRoot,
  ],
  { encoding: "utf8" },
);
const backupDirectory = JSON.parse(backupOutput.trim()).backupDirectory;
const stamp = basename(backupDirectory);

const files = [];
async function visit(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    if (entry.isFile()) files.push(relative(backupDirectory, path));
  }
}
await visit(backupDirectory);
files.sort((left, right) => left.localeCompare(right));

const objects = [];
for (const file of files) {
  const full = join(backupDirectory, file);
  const details = await stat(full);
  objects.push({
    byteSize: details.size,
    checksumSha256: await sha256(full),
    contentType: contentTypeFor(file),
    file: file.replaceAll("\\", "/"),
    full,
    objectKey: `${prefix}/${stamp}/${file.replaceAll("\\", "/")}`,
  });
}

const manifest = {
  bucket: profile.bucket,
  createdAt: new Date().toISOString(),
  format: 1,
  objects: objects.map((object) => ({
    byteSize: object.byteSize,
    checksumSha256: object.checksumSha256,
    objectKey: object.objectKey,
    path: object.file,
  })),
  prefix: `${prefix}/${stamp}`,
  profileId: profile.id,
};
const manifestPath = join(
  backupDirectory,
  "oss-backup-manifest.json",
);
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(manifestPath, manifestBytes, { flag: "wx" });
const manifestObjectKey = `${prefix}/${stamp}/oss-backup-manifest.json`;

console.log(
  JSON.stringify({
    bucket: profile.bucket,
    dryRun,
    files: objects.length,
    manifestObjectKey,
    profileId: profile.id,
    totalBytes: objects.reduce((total, object) => total + object.byteSize, 0),
  }),
);

if (dryRun) process.exit(0);

for (const object of objects) {
  await uploadPrivateAliyunOssObject({
    byteSize: object.byteSize,
    checksumSha256: object.checksumSha256,
    contentType: object.contentType,
    credentials: profile,
    filePath: object.full,
    objectKey: object.objectKey,
  });
}
await uploadPrivateAliyunOssObject({
  byteSize: manifestBytes.length,
  checksumSha256: createHash("sha256")
    .update(manifestBytes)
    .digest("hex"),
  contentType: "application/json",
  credentials: profile,
  filePath: manifestPath,
  objectKey: manifestObjectKey,
});

if (retainDays > 0) {
  const client = new OSS({
    accessKeyId: profile.accessKeyId,
    accessKeySecret: profile.accessKeySecret,
    authorizationV4: true,
    bucket: profile.bucket,
    endpoint: profile.endpoint,
    region: profile.region,
    secure: true,
    timeout: 60_000,
  });
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  let marker;
  const stale = [];
  do {
    const result = await client.list({
      marker,
      "max-keys": 1000,
      prefix: `${prefix}/`,
    });
    for (const object of result.objects ?? []) {
      const day = object.name
        .slice(prefix.length + 1)
        .split("/")[0]
        ?.slice(0, 10);
      const time = Date.parse(`${day}T00:00:00.000Z`);
      if (Number.isFinite(time) && time < cutoff) stale.push(object.name);
    }
    marker = result.nextMarker;
  } while (marker);
  for (const name of stale) {
    await client.delete(name);
  }
  console.log(
    JSON.stringify({
      pruned: stale.length,
      retainDays,
    }),
  );
}
