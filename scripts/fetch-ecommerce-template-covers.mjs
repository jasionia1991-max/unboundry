import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const manifestPath = join(appRoot, "spec", "ecommerce-template-cover-sources.json");
const outputDirectory = join(appRoot, "client", "public", "templates");
const force = process.argv.includes("--force");

const document = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(document.covers) || document.covers.length !== 16) {
  throw new Error("Expected exactly 16 ecommerce cover declarations");
}

await mkdir(outputDirectory, { recursive: true });
const receipts = [];

for (const cover of document.covers) {
  if (!/^ecommerce-[a-z0-9-]+\.jpg$/.test(cover.target)) {
    throw new Error(`Unsafe cover target: ${cover.target}`);
  }
  const source = new URL(cover.sourceImage);
  if (source.protocol !== "https:" || source.hostname !== "images.unsplash.com") {
    throw new Error(`Unexpected cover source: ${cover.sourceImage}`);
  }
  const target = join(outputDirectory, cover.target);
  const temporary = `${target}.download`;
  if (!force) {
    try {
      const existing = await readFile(target);
      receipts.push({
        bytes: existing.length,
        sha256: createHash("sha256").update(existing).digest("hex"),
        target: cover.target,
        reused: true,
      });
      continue;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const response = await fetch(source, {
    headers: { "User-Agent": "Unboundry template-cover fetcher/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Cover download failed: ${response.status} ${source}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/jpeg")) {
    throw new Error(`Cover is not JPEG: ${contentType} ${source}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 40_000 || bytes.length > 5_000_000) {
    throw new Error(`Cover size is outside the admitted range: ${bytes.length} ${source}`);
  }
  await rm(temporary, { force: true });
  const handle = await open(temporary, "wx", 0o644);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  receipts.push({
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    target: cover.target,
    reused: false,
  });
}

console.log(JSON.stringify({ outputDirectory, receipts }, null, 2));
