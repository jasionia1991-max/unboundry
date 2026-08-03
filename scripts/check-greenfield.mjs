import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["client", "tests"];
const files = ["package.json", "package-lock.json", "vite.config.ts"];
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".ts", ".tsx"]);
const forbidden = /lumino/i;

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collect(path)));
    } else if (textExtensions.has(extname(entry.name))) {
      result.push(path);
    }
  }

  return result;
}

for (const root of roots) {
  files.push(...(await collect(root)));
}

const violations = [];
for (const file of files) {
  if (forbidden.test(file) || forbidden.test(await readFile(file, "utf8"))) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  throw new Error(`Forbidden implementation dependency found: ${violations.join(", ")}`);
}

console.log(`Greenfield check passed (${files.length} implementation files).`);
