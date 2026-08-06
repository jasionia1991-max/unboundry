import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appDataDirectory } from "./database";

function paths() {
  return {
    directory: join(appDataDirectory(), "secrets"),
    key: join(appDataDirectory(), "secrets", "config-master.key"),
  };
}

/** AES-256-GCM master key shared by all encrypted secret stores. */
export async function secretStoreEncryptionKey() {
  const target = paths();
  await mkdir(target.directory, { mode: 0o700, recursive: true });
  try {
    const existing = await readFile(target.key);
    if (existing.length !== 32) throw new Error("Invalid secret-store key");
    return existing;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const created = randomBytes(32);
  try {
    await writeFile(target.key, created, { flag: "wx", mode: 0o600 });
    return created;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      const existing = await readFile(target.key);
      if (existing.length !== 32) throw new Error("Invalid secret-store key");
      return existing;
    }
    throw error;
  }
}
