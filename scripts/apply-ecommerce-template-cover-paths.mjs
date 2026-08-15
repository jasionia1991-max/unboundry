import { readFile, realpath, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, join, resolve } from "node:path";

const ACTIVE_STATES = ["queued", "running", "retrying", "recovering"];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const values = new Map();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--apply") {
      if (apply) fail("COVER_ARGUMENT_INVALID", "Duplicate --apply argument");
      apply = true;
      continue;
    }
    if (!["--data-dir", "--manifest"].includes(option)) {
      fail("COVER_ARGUMENT_INVALID", `Unknown argument: ${option}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(option)) {
      fail("COVER_ARGUMENT_INVALID", `Missing or duplicate value for ${option}`);
    }
    values.set(option, value);
    index += 1;
  }
  if (!values.has("--data-dir") || !values.has("--manifest")) {
    fail("COVER_ARGUMENT_INVALID", "--data-dir and --manifest are required");
  }
  return { apply, values };
}

function absolutePath(value, label) {
  if (!isAbsolute(value) || resolve(value) !== value || /[\0\r\n]/.test(value)) {
    fail("COVER_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
  }
  return value;
}

function scalar(database, sql, label) {
  const row = database.prepare(sql).get();
  const value = row && Object.values(row)[0];
  if (value === undefined) fail("COVER_DATABASE_INVALID", `${label} is unavailable`);
  return value;
}

function inspect(database, expected) {
  const schemaVersion = Number(scalar(database, "PRAGMA user_version", "schema version"));
  const quickCheck = String(scalar(database, "PRAGMA quick_check", "quick_check"));
  const foreignKeys = Number(scalar(
    database,
    "SELECT COUNT(*) FROM pragma_foreign_key_check",
    "foreign key check",
  ));
  const activeTasks = Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM generation_tasks
    WHERE state IN (${ACTIVE_STATES.map(() => "?").join(", ")})
  `).get(...ACTIVE_STATES).count);
  if (schemaVersion !== 39 || quickCheck !== "ok" || foreignKeys !== 0) {
    fail("COVER_DATABASE_INVALID", "Database must be healthy schema39 with no foreign-key violations");
  }
  if (activeTasks !== 0) {
    fail("COVER_ACTIVE_GENERATION_TASKS", "Template covers cannot change while generation tasks are active");
  }

  const lookup = database.prepare(`
    SELECT id, title, preview_image, status
    FROM public_templates
    WHERE id = ?
  `);
  const rows = expected.map((item) => {
    const row = lookup.get(item.templateId);
    const previewImage = `/templates/${item.target}`;
    if (!row || row.title !== item.templateTitle || row.status !== "published") {
      fail("COVER_TEMPLATE_MISMATCH", `Published template identity mismatch: ${item.templateId}`);
    }
    if (row.preview_image !== null && row.preview_image !== "" && row.preview_image !== previewImage) {
      fail("COVER_TEMPLATE_CONFLICT", `Template already has an unexpected cover: ${item.templateId}`);
    }
    return {
      id: row.id,
      previewImage,
      previousPreviewImage: row.preview_image,
      title: row.title,
    };
  });
  return { activeTasks, foreignKeys, quickCheck, rows, schemaVersion };
}

let database;
try {
  const { apply, values } = parseArguments(process.argv.slice(2));
  const dataDirectory = absolutePath(values.get("--data-dir"), "Data directory");
  const manifestPath = absolutePath(values.get("--manifest"), "Manifest path");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const [canonicalData, canonicalDatabase, canonicalManifest, databaseDetails] = await Promise.all([
    realpath(dataDirectory),
    realpath(databasePath),
    realpath(manifestPath),
    stat(databasePath),
  ]);
  if (
    canonicalData !== dataDirectory || canonicalDatabase !== databasePath ||
    canonicalManifest !== manifestPath || !databaseDetails.isFile()
  ) fail("COVER_ARGUMENT_INVALID", "Data or manifest path is not canonical");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest?.version !== 1 || !Array.isArray(manifest.covers) ||
    manifest.covers.length !== 16 ||
    new Set(manifest.covers.map((item) => item.templateId)).size !== 16 ||
    manifest.covers.some((item) =>
      !/^00000000-0000-4000-8000-0000000001(?:0[1-9]|1[0-6])$/.test(item.templateId) ||
      typeof item.templateTitle !== "string" || !item.templateTitle ||
      !/^ecommerce-[a-z0-9-]+\.jpg$/.test(item.target))
  ) fail("COVER_MANIFEST_INVALID", "Cover manifest must declare the exact 16 ecommerce templates");

  database = new DatabaseSync(databasePath, {
    open: true,
    readOnly: !apply,
    timeout: 5_000,
  });
  if (!apply) database.exec("PRAGMA query_only = ON");
  const before = inspect(database, manifest.covers);
  let changed = 0;
  let timestamp = null;
  if (apply) {
    timestamp = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      inspect(database, manifest.covers);
      const update = database.prepare(`
        UPDATE public_templates
        SET preview_image = ?, updated_at = ?
        WHERE id = ?
          AND status = 'published'
          AND (preview_image IS NULL OR preview_image = '' OR preview_image = ?)
      `);
      for (const row of before.rows) {
        const result = update.run(row.previewImage, timestamp, row.id, row.previewImage);
        if (result.changes !== 1) {
          fail("COVER_TEMPLATE_CHANGED", `Template changed during update: ${row.id}`);
        }
        if (row.previousPreviewImage !== row.previewImage) changed += 1;
      }
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  const after = inspect(database, manifest.covers);
  process.stdout.write(`${JSON.stringify({
    applied: apply,
    changed,
    timestamp,
    schemaVersion: after.schemaVersion,
    quickCheck: after.quickCheck,
    foreignKeys: after.foreignKeys,
    activeTasks: after.activeTasks,
    templates: after.rows.map(({ id, previewImage, title }) => ({ id, previewImage, title })),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    code: error?.code ?? "COVER_UPDATE_FAILED",
    message: error?.message ?? "Template cover update failed",
  })}\n`);
  process.exitCode = 1;
} finally {
  database?.close();
}
