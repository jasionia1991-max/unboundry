import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const names = new Set([
    "--base-manifest-sha256", "--covers-dir", "--overlay-commit",
    "--receipt", "--sources", "--release-dir",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name) || !value || value.startsWith("--") || values.has(name)) {
      fail("OVERLAY_ARGUMENT_INVALID", "Overlay arguments are incomplete or duplicated");
    }
    values.set(name, value);
  }
  if (values.size !== names.size) fail("OVERLAY_ARGUMENT_INVALID", "All overlay arguments are required");
  return values;
}

function normalizedAbsolutePath(value, label) {
  if (!isAbsolute(value) || resolve(value) !== value || /[\0\r\n]/.test(value)) {
    fail("OVERLAY_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function containsPath(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (
    difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference)
  );
}

async function inventoryRelease(releaseDirectory) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === "release-manifest.json") continue;
      const path = join(directory, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink() || (details.mode & 0o022) !== 0) {
        fail("OVERLAY_RELEASE_UNSAFE", `Unsafe release entry: ${relativePath}`);
      }
      if (details.isDirectory()) {
        if ((details.mode & 0o777) !== 0o500) {
          fail("OVERLAY_RELEASE_UNSAFE", `Directory is not mode 0500: ${relativePath}`);
        }
        files.push({ mode: 0o500, path: relativePath, type: "directory" });
        await visit(path, relativePath);
      } else if (details.isFile()) {
        const mode = details.mode & 0o777;
        if (details.nlink !== 1 || ![0o400, 0o500].includes(mode)) {
          fail("OVERLAY_RELEASE_UNSAFE", `File is not immutable: ${relativePath}`);
        }
        const bytes = await readFile(path);
        files.push({ mode, path: relativePath, sha256: sha256(bytes), size: bytes.length, type: "file" });
      } else {
        fail("OVERLAY_RELEASE_UNSAFE", `Special release entry: ${relativePath}`);
      }
    }
  }
  await visit(releaseDirectory);
  return files;
}

try {
  const values = parseArguments(process.argv.slice(2));
  const releaseDirectory = normalizedAbsolutePath(values.get("--release-dir"), "Release directory");
  const coversDirectory = normalizedAbsolutePath(values.get("--covers-dir"), "Covers directory");
  const sourcesPath = normalizedAbsolutePath(values.get("--sources"), "Sources manifest");
  const receiptPath = normalizedAbsolutePath(values.get("--receipt"), "Cover receipt");
  const expectedBaseManifestSha256 = values.get("--base-manifest-sha256");
  const overlayCommit = values.get("--overlay-commit");
  if (!/^[0-9a-f]{64}$/.test(expectedBaseManifestSha256) || !/^[0-9a-f]{40}$/.test(overlayCommit)) {
    fail("OVERLAY_ARGUMENT_INVALID", "Overlay hashes are malformed");
  }
  const [canonicalRelease, canonicalCovers, canonicalSources, canonicalReceipt] = await Promise.all([
    realpath(releaseDirectory), realpath(coversDirectory), realpath(sourcesPath), realpath(receiptPath),
  ]);
  if (
    canonicalRelease !== releaseDirectory || canonicalCovers !== coversDirectory ||
    canonicalSources !== sourcesPath || canonicalReceipt !== receiptPath ||
    basename(releaseDirectory) !== "v0.6.0" || containsPath(releaseDirectory, coversDirectory)
  ) fail("OVERLAY_ARGUMENT_INVALID", "Overlay paths are not canonical or isolated");

  const manifestPath = join(releaseDirectory, "release-manifest.json");
  const [baseManifestBytes, sourcesBytes, receiptBytes] = await Promise.all([
    readFile(manifestPath), readFile(sourcesPath), readFile(receiptPath),
  ]);
  if (sha256(baseManifestBytes) !== expectedBaseManifestSha256) {
    fail("OVERLAY_BASE_CHANGED", "Base release manifest does not match the authorized production artifact");
  }
  const manifest = JSON.parse(baseManifestBytes);
  const sources = JSON.parse(sourcesBytes);
  const receipt = JSON.parse(receiptBytes);
  if (
    manifest?.releaseId !== "v0.6.0" || manifest?.expectedVersion !== "0.6.0" ||
    manifest?.contentOverlay !== undefined || sources?.covers?.length !== 16 ||
    receipt?.files?.length !== 16
  ) fail("OVERLAY_INPUT_INVALID", "Base release or cover manifests are invalid");
  const receiptByTarget = new Map(receipt.files.map((item) => [item.target, item]));
  const targetDirectories = [
    join(releaseDirectory, "client", "public", "templates"),
    join(releaseDirectory, "dist", "client", "templates"),
  ];
  for (const targetDirectory of targetDirectories) await chmod(targetDirectory, 0o700);
  const covers = [];
  try {
    for (const source of sources.covers) {
      const expected = receiptByTarget.get(source.target);
      if (!expected || !/^ecommerce-[a-z0-9-]+\.jpg$/.test(source.target)) {
        fail("OVERLAY_INPUT_INVALID", `Invalid cover declaration: ${source.target}`);
      }
      const inputPath = join(coversDirectory, source.target);
      const bytes = await readFile(inputPath);
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
        fail("OVERLAY_INPUT_INVALID", `Cover receipt mismatch: ${source.target}`);
      }
      const paths = [];
      for (const targetDirectory of targetDirectories) {
        const outputPath = join(targetDirectory, source.target);
        try {
          await lstat(outputPath);
          fail("OVERLAY_TARGET_EXISTS", `Cover already exists in base release: ${source.target}`);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        await copyFile(inputPath, outputPath);
        await chmod(outputPath, 0o400);
        paths.push(relative(releaseDirectory, outputPath).split(sep).join("/"));
      }
      covers.push({
        paths,
        sha256: expected.sha256,
        size: expected.bytes,
        templateId: source.templateId,
      });
    }
  } finally {
    for (const targetDirectory of targetDirectories) await chmod(targetDirectory, 0o500);
  }

  manifest.contentOverlay = {
    appliedAt: new Date().toISOString(),
    baseManifestSha256: expectedBaseManifestSha256,
    covers,
    overlayCommit,
    receiptSha256: sha256(receiptBytes),
    sourcesSha256: sha256(sourcesBytes),
    type: "bounded-static-template-cover-overlay",
  };
  manifest.files = await inventoryRelease(releaseDirectory);
  await chmod(manifestPath, 0o600);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(manifestPath, 0o400);
  const finalManifestBytes = await readFile(manifestPath);
  const inventorySha256 = sha256(Buffer.from(JSON.stringify(manifest.files)));
  process.stdout.write(`${JSON.stringify({
    baseManifestSha256: expectedBaseManifestSha256,
    coverCount: covers.length,
    inventorySha256,
    manifestSha256: sha256(finalManifestBytes),
    overlayCommit,
    releaseId: manifest.releaseId,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    code: error?.code ?? "OVERLAY_BUILD_FAILED",
    message: error?.message ?? "Template cover overlay failed",
  })}\n`);
  process.exitCode = 1;
}
