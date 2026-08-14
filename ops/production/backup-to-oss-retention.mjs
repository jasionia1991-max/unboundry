import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import OSS from "ali-oss";
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
// 默认放进 objects/backups/：与现有 RAM 最小权限（objects/*）兼容。
// 若后续在阿里云 RAM 策略中放行 backups/*，可改回 --prefix backups。
const prefix = (argument("--prefix") ?? "objects/backups").replace(
  /^\/+|\/+$/g,
  "",
);
const dryRun = process.argv.includes("--dry-run");
const stagingRoot = resolve(
  argument("--backup-root") ??
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
  await client.put(object.objectKey, object.full, {
    headers: {
      "Content-Type": object.contentType,
      "x-oss-forbid-overwrite": "true",
      "x-oss-meta-sha256": object.checksumSha256,
      "x-oss-object-acl": "private",
    },
    mime: object.contentType,
  });
}
await client.put(manifestObjectKey, manifestPath, {
  headers: {
    "Content-Type": "application/json",
    "x-oss-forbid-overwrite": "true",
    "x-oss-meta-sha256": createHash("sha256")
      .update(manifestBytes)
      .digest("hex"),
    "x-oss-object-acl": "private",
  },
  mime: "application/json",
});

if (retainDays > 0) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const staleDirectories = (await readdir(stagingRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== stamp)
    .map((entry) => ({
      name: entry.name,
      time: Date.parse(`${entry.name.slice(0, 10)}T00:00:00.000Z`),
    }))
    .filter(({ time }) => Number.isFinite(time) && time < cutoff)
    .sort((left, right) => left.name.localeCompare(right.name));
  let deletedObjects = 0;
  let incompleteLocalBackups = 0;
  for (const stale of staleDirectories) {
    const localDirectory = join(stagingRoot, stale.name);
    const localManifestPath = join(localDirectory, "oss-backup-manifest.json");
    const localManifestBytes = await readFile(localManifestPath, "utf8").catch(
      (error) => {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (!localManifestBytes) {
      await rm(localDirectory, { recursive: true });
      incompleteLocalBackups += 1;
      continue;
    }
    const localManifest = JSON.parse(localManifestBytes);
    const expectedPrefix = `${prefix}/${stale.name}`;
    if (
      localManifest?.format !== 1 ||
      localManifest?.prefix !== expectedPrefix ||
      !Array.isArray(localManifest?.objects) ||
      localManifest.objects.length < 1 ||
      localManifest.objects.length > 10_000
    ) {
      throw new Error("Stale backup manifest is invalid");
    }
    const keys = localManifest.objects.map((object) => object?.objectKey);
    const expectedStart = `${expectedPrefix}/`;
    if (
      keys.some((key) => typeof key !== "string" || !key.startsWith(expectedStart)) ||
      new Set(keys).size !== keys.length
    ) {
      throw new Error("Stale backup object inventory is invalid");
    }
    for (const key of keys) {
      await client.delete(key);
      deletedObjects += 1;
    }
    await client.delete(`${expectedPrefix}/oss-backup-manifest.json`);
    deletedObjects += 1;
    await rm(localDirectory, { recursive: true });
  }
  console.log(JSON.stringify({
    deletedObjects,
    incompleteLocalBackups,
    prunedBackups: staleDirectories.length,
    retainDays,
    retentionMode: "local-manifest-inventory",
  }));
}
