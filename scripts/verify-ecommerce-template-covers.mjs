import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const sources = JSON.parse(await readFile(
  join(appRoot, "spec", "ecommerce-template-cover-sources.json"),
  "utf8",
));
const receipt = JSON.parse(await readFile(
  join(appRoot, "spec", "ecommerce-template-cover-receipt.json"),
  "utf8",
));
const sourceDirectory = join(appRoot, "client", "public", "templates");
const builtDirectory = join(appRoot, "dist", "client", "templates");

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Not a JPEG file");
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG marker");
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions not found");
}

if (sources.covers.length !== 16 || receipt.files.length !== 16) {
  throw new Error("Cover manifest must contain exactly 16 entries");
}
const sourceByTarget = new Map(sources.covers.map((item) => [item.target, item]));
const ids = new Set();
const pages = new Set();
const verified = [];

for (const expected of receipt.files) {
  const source = sourceByTarget.get(expected.target);
  if (!source) throw new Error(`Missing source declaration for ${expected.target}`);
  if (ids.has(source.templateId)) throw new Error(`Duplicate template id ${source.templateId}`);
  if (pages.has(source.sourcePage)) throw new Error(`Duplicate source page ${source.sourcePage}`);
  ids.add(source.templateId);
  pages.add(source.sourcePage);
  const sourceBytes = await readFile(join(sourceDirectory, expected.target));
  const digest = createHash("sha256").update(sourceBytes).digest("hex");
  const dimensions = jpegDimensions(sourceBytes);
  if (digest !== expected.sha256 || sourceBytes.length !== expected.bytes) {
    throw new Error(`Cover receipt mismatch: ${expected.target}`);
  }
  if (dimensions.width !== receipt.width || dimensions.height !== receipt.height) {
    throw new Error(`Cover dimensions mismatch: ${expected.target}`);
  }
  let built = false;
  try {
    const builtBytes = await readFile(join(builtDirectory, expected.target));
    built = builtBytes.equals(sourceBytes);
    if (!built) throw new Error(`Built cover differs: ${expected.target}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  verified.push({
    bytes: sourceBytes.length,
    built,
    previewImage: `/templates/${expected.target}`,
    sha256: digest,
    templateId: source.templateId,
  });
}

console.log(JSON.stringify({ count: verified.length, verified }, null, 2));
