import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import OSS from "ali-oss";

const singleValueOptions = new Set([
  "--backup-root",
  "--data-dir",
  "--expected-database-logical-sha256",
  "--expected-schema-version",
  "--generation-frozen-at",
  "--last-provider-admission-at",
  "--prefix",
  "--profile-id",
  "--recovery-public-key",
  "--retain-days",
  "--scratch-root",
  "--signing-private-key",
]);
const repeatedValueOptions = new Set([
  "--allow-media-warning",
  "--oss-mirror",
]);
const flagOptions = new Set(["--apply-retention", "--apply-upload"]);

function invalidArgument(message) {
  throw new Error(`SCHEMA42_OSS_BACKUP_ARGUMENT_INVALID: ${message}`);
}

function parseArguments(argv) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (flagOptions.has(option)) {
      if (flags.has(option)) invalidArgument(`${option} is duplicated`);
      flags.add(option);
      continue;
    }
    if (!singleValueOptions.has(option) && !repeatedValueOptions.has(option)) {
      invalidArgument(`unknown option ${String(option)}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      invalidArgument(`${option} requires one value`);
    }
    const current = values.get(option) ?? [];
    if (singleValueOptions.has(option) && current.length > 0) {
      invalidArgument(`${option} is duplicated`);
    }
    current.push(value);
    values.set(option, current);
    index += 1;
  }
  return Object.freeze({ flags, values });
}

const parsedArguments = parseArguments(process.argv.slice(2));

function valuesFor(name) {
  return parsedArguments.values.get(name) ?? [];
}

function requiredValue(name) {
  const values = valuesFor(name);
  if (values.length !== 1 || !values[0]) {
    throw new Error(`SCHEMA42_OSS_BACKUP_ARGUMENT_INVALID: ${name} is required exactly once`);
  }
  return values[0];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safePrefix(value) {
  const prefix = value.replace(/^\/+|\/+$/g, "");
  if (!/^objects\/backups\/[a-z0-9._/-]{1,180}$/i.test(prefix) || prefix.includes("..")) {
    throw new Error("SCHEMA42_OSS_BACKUP_ARGUMENT_INVALID: prefix is invalid");
  }
  return prefix;
}

async function packageFiles(packageDirectory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("SCHEMA42_OSS_BACKUP_PACKAGE_INVALID: symbolic link");
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new Error("SCHEMA42_OSS_BACKUP_PACKAGE_INVALID: special file");
      }
    }
  }
  await visit(packageDirectory);
  return files.sort((left, right) => left.localeCompare(right));
}

function contentTypeFor(path) {
  return path.endsWith(".json") ? "application/json" : "application/octet-stream";
}

const dataDirectory = resolve(requiredValue("--data-dir"));
const backupRoot = resolve(requiredValue("--backup-root"));
const scratchRoot = resolve(requiredValue("--scratch-root"));
const recoveryPublicKey = resolve(requiredValue("--recovery-public-key"));
const signingPrivateKey = resolve(requiredValue("--signing-private-key"));
const expectedDatabaseLogicalSha256 = requiredValue(
  "--expected-database-logical-sha256",
);
const expectedSchemaVersion = requiredValue("--expected-schema-version");
const generationFrozenAt = requiredValue("--generation-frozen-at");
const lastProviderAdmissionAt = requiredValue("--last-provider-admission-at");
const profileId = requiredValue("--profile-id");
const prefix = safePrefix(
  valuesFor("--prefix")[0] ?? `objects/backups/unboundry-schema${expectedSchemaVersion}`,
);
const applyUpload = parsedArguments.flags.has("--apply-upload");
const applyRetention = parsedArguments.flags.has("--apply-retention");
const retainDays = Number(valuesFor("--retain-days")[0] ?? "0");

if (!["42", "43", "44"].includes(expectedSchemaVersion) || !/^[a-f0-9]{64}$/.test(expectedDatabaseLogicalSha256)) {
  throw new Error(
    "SCHEMA42_OSS_BACKUP_ARGUMENT_INVALID: exact schema42, schema43 or schema44 and logical SHA are required",
  );
}
if (!Number.isSafeInteger(retainDays) || retainDays < 0 || retainDays > 3650) {
  throw new Error("SCHEMA42_OSS_BACKUP_ARGUMENT_INVALID: retain-days is invalid");
}
if (applyRetention && (!applyUpload || retainDays < 1)) {
  throw new Error(
    "SCHEMA42_OSS_BACKUP_ARGUMENT_INVALID: retention requires upload apply and positive retain-days",
  );
}

if (!process.execArgv.includes("--experimental-transform-types")) {
  const transformed = spawnSync(process.execPath, [
    "--experimental-transform-types",
    fileURLToPath(import.meta.url),
    ...process.argv.slice(2),
  ], { stdio: "inherit" });
  process.exit(transformed.status ?? 1);
}

// The explicit source directory owns both the database snapshot and its
// encrypted storage-profile document. Never inherit a different runtime data
// directory for the OSS destination identity.
process.env.UNBOUNDRY_DATA_DIR = dataDirectory;

// The wrapper is part of the release tree, not a standalone script. Resolve
// every executable/import from its immutable module location so systemd's
// WorkingDirectory cannot redirect the backup implementation.
const releaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backupScript = join(releaseRoot, "scripts", "backup-data.mjs");
const storageProfileModule = join(
  releaseRoot,
  "server",
  "secureStorageProfiles.ts",
);

const backupArguments = [
  backupScript,
  "--source-frozen",
  ...(expectedSchemaVersion !== "44" ? ["--historical-recovery"] : []),
  "--data-dir", dataDirectory,
  "--backup-root", backupRoot,
  "--scratch-root", scratchRoot,
  "--recovery-public-key", recoveryPublicKey,
  "--signing-private-key", signingPrivateKey,
  "--expected-database-logical-sha256", expectedDatabaseLogicalSha256,
  "--expected-schema-version", expectedSchemaVersion,
  "--generation-frozen-at", generationFrozenAt,
  "--last-provider-admission-at", lastProviderAdmissionAt,
];
for (const warning of valuesFor("--allow-media-warning")) {
  backupArguments.push("--allow-media-warning", warning);
}
for (const mirror of valuesFor("--oss-mirror")) {
  backupArguments.push("--oss-mirror", mirror);
}

const backupOutput = execFileSync(process.execPath, backupArguments, {
  cwd: releaseRoot,
  encoding: "utf8",
});
const backup = JSON.parse(backupOutput.trim());
if (
  backup?.captureMode !== "locked-exact" || backup?.finalCandidate !== (expectedSchemaVersion === "44") ||
  backup?.schemaVersion !== Number(expectedSchemaVersion) ||
  backup?.databaseLogicalSha256 !== expectedDatabaseLogicalSha256 ||
  typeof backup?.packageDirectory !== "string"
) {
  throw new Error("SCHEMA42_OSS_BACKUP_PACKAGE_INVALID: backup receipt mismatch");
}

const packageDirectory = resolve(backup.packageDirectory);
const stamp = basename(packageDirectory);
const objectPrefix = `${prefix}/${stamp}`;
const objects = [];
for (const fullPath of await packageFiles(packageDirectory)) {
  const bytes = await readFile(fullPath);
  const logicalPath = relative(packageDirectory, fullPath).replaceAll("\\", "/");
  objects.push({
    byteSize: bytes.length,
    checksumSha256: sha256(bytes),
    contentType: contentTypeFor(logicalPath),
    fullPath,
    logicalPath,
    objectKey: `${objectPrefix}/${logicalPath}`,
  });
}
if (objects.length < 1) {
  throw new Error("SCHEMA42_OSS_BACKUP_PACKAGE_INVALID: package is empty");
}

const { listStorageProfiles } = await import(
  pathToFileURL(storageProfileModule).href
);
const profileDocument = await listStorageProfiles();
const profile = profileDocument.profiles.find((candidate) =>
  candidate.id === profileId &&
  (candidate.status === "active" || candidate.status === "verified")
);
if (!profile) {
  throw new Error("SCHEMA42_OSS_BACKUP_PROFILE_INVALID: explicit profile is unavailable");
}

const manifest = {
  backupId: stamp,
  bucket: profile.bucket,
  captureMode: "locked-exact",
  createdAt: new Date().toISOString(),
  databaseLogicalSha256: expectedDatabaseLogicalSha256,
  format: 2,
  objects: objects.map(({ byteSize, checksumSha256, logicalPath, objectKey }) => ({
    byteSize,
    checksumSha256,
    objectKey,
    path: logicalPath,
  })),
  prefix: objectPrefix,
  profileId: profile.id,
  schemaVersion: Number(expectedSchemaVersion),
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestObjectKey = `${objectPrefix}/oss-backup-manifest.json`;

console.log(JSON.stringify({
  applyRetention,
  applyUpload,
  backupId: stamp,
  databaseLogicalSha256: expectedDatabaseLogicalSha256,
  files: objects.length,
  manifestObjectKey,
  schemaVersion: Number(expectedSchemaVersion),
  totalBytes: objects.reduce((total, object) => total + object.byteSize, 0),
}));

if (!applyUpload) process.exit(0);

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
for (const object of objects) {
  await client.put(object.objectKey, object.fullPath, {
    headers: {
      "Content-Type": object.contentType,
      "x-oss-forbid-overwrite": "true",
      "x-oss-meta-sha256": object.checksumSha256,
      "x-oss-object-acl": "private",
    },
    mime: object.contentType,
  });
}
await client.put(manifestObjectKey, manifestBytes, {
  headers: {
    "Content-Type": "application/json",
    "x-oss-forbid-overwrite": "true",
    "x-oss-meta-sha256": sha256(manifestBytes),
    "x-oss-object-acl": "private",
  },
  mime: "application/json",
});

if (applyRetention) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const candidates = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== stamp)
    .map((entry) => ({
      name: entry.name,
      time: Date.parse(entry.name.slice(0, 10)),
    }))
    .filter(({ time }) => Number.isFinite(time) && time < cutoff);
  for (const candidate of candidates) {
    const marker = join(backupRoot, candidate.name, "manifest.json");
    if (!(await stat(marker).catch(() => undefined))?.isFile()) {
      throw new Error("SCHEMA42_OSS_RETENTION_BLOCKED: local package is incomplete");
    }
    // Upload authorization never authorizes deletion. An exact remote deletion
    // manifest and a second reviewed operation are required before any delete.
    throw new Error(
      "SCHEMA42_OSS_RETENTION_BLOCKED: exact remote deletion manifest is required",
    );
  }
}
