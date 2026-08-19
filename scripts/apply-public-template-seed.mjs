import { readFile, realpath, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const ACTIVE_STATES = ["queued", "running", "retrying", "recovering"];
const CATEGORY_WHITELIST = new Set(["广告", "电商", "影视", "生活", "工具", "有趣", "ACG"]);
const NODE_TYPES = new Set(["audio", "group", "image", "playlist", "storyboard", "text", "video"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const values = new Map();
  const ids = [];
  let apply = false;
  let updateExisting = false;
  let all = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (apply) fail("SEED_ARGUMENT_INVALID", "Duplicate --apply argument");
      apply = true;
      continue;
    }
    if (argument === "--update-existing") {
      if (updateExisting) fail("SEED_ARGUMENT_INVALID", "Duplicate --update-existing argument");
      updateExisting = true;
      continue;
    }
    if (argument === "--all") {
      if (all) fail("SEED_ARGUMENT_INVALID", "Duplicate --all argument");
      all = true;
      continue;
    }
    if (argument === "--id") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("SEED_ARGUMENT_INVALID", "--id requires a value");
      ids.push(value);
      index += 1;
      continue;
    }
    if (!["--data-dir", "--seeds", "--static-root"].includes(argument)) {
      fail("SEED_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(argument)) {
      fail("SEED_ARGUMENT_INVALID", `Missing or duplicate value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  if (!values.has("--data-dir") || !values.has("--seeds") || !values.has("--static-root")) {
    fail("SEED_ARGUMENT_INVALID", "--data-dir, --seeds and --static-root are required");
  }
  if (!all && ids.length === 0) {
    fail("SEED_ARGUMENT_INVALID", "At least one --id is required unless --all is given");
  }
  if (all && ids.length > 0) {
    fail("SEED_ARGUMENT_INVALID", "--all and --id cannot be combined");
  }
  return { apply, ids, updateExisting, values };
}

function normalizedAbsolutePath(value, label) {
  if (!isAbsolute(value) || resolve(value) !== value || /[\0\r\n]/.test(value)) {
    fail("SEED_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
  }
  return value;
}

function isInside(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (
    !isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`)
  );
}

function scalar(database, sql, label) {
  const row = database.prepare(sql).get();
  const value = row && Object.values(row)[0];
  if (value === undefined) fail("SEED_DATABASE_INVALID", `${label} is unavailable`);
  return value;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function databaseHealth(database) {
  const schemaVersion = Number(scalar(database, "PRAGMA user_version", "schema version"));
  const quickCheck = String(scalar(database, "PRAGMA quick_check", "quick check"));
  const foreignKeys = Number(scalar(database, "SELECT COUNT(*) FROM pragma_foreign_key_check", "foreign key check"));
  const activeTasks = Number(database.prepare(`SELECT COUNT(*) AS count FROM generation_tasks WHERE state IN (${ACTIVE_STATES.map(() => "?").join(",")})`).get(...ACTIVE_STATES).count);
  if (schemaVersion < 31 || quickCheck !== "ok" || foreignKeys !== 0 || activeTasks !== 0) {
    fail("SEED_DATABASE_INVALID", "Database must be schema>=31, quick_check ok, FK0, active generation0");
  }
  return { schemaVersion, quickCheck, foreignKeys, activeTasks };
}

function validateGraph(graph, templateId) {
  if (graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
      graph.nodes.length < 2 || graph.nodes.length > 500 || graph.edges.length > 1000) {
    fail("SEED_GRAPH_INVALID", `Invalid graph envelope for ${templateId}`);
  }
  const nodes = new Map();
  for (const item of graph.nodes) {
    if (!text(item.id) || nodes.has(item.id) || !NODE_TYPES.has(item.type) ||
        !Number.isFinite(item.position?.x) || !Number.isFinite(item.position?.y) ||
        !text(item.data?.label) || !text(item.data?.title) ||
        !Number.isFinite(item.style?.width) || !Number.isFinite(item.style?.height)) {
      fail("SEED_GRAPH_INVALID", `Invalid node in ${templateId}`);
    }
    nodes.set(item.id, item);
  }
  const group = nodes.get("template-group");
  if (!group || group.type !== "group" || graph.nodes[0].id !== "template-group") {
    fail("SEED_GRAPH_INVALID", `Group must be the first node in ${templateId}`);
  }
  let childCount = 0;
  for (const item of graph.nodes) {
    if (item.type === "group") {
      if (item.parentId !== undefined) fail("SEED_GRAPH_INVALID", `Group parent must be absent in ${templateId}`);
      continue;
    }
    if (item.parentId !== "template-group") {
      fail("SEED_GRAPH_INVALID", `Child parent must be template-group in ${templateId}`);
    }
    childCount += 1;
  }
  if (childCount === 0) fail("SEED_GRAPH_INVALID", `Template has no child nodes in ${templateId}`);
  const edgePairs = new Set();
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const pair = `${edge.source}\0${edge.target}`;
    if (!source || !target || source === target || edgePairs.has(pair) ||
        edge.sourceHandle !== "source" || edge.targetHandle !== "target" ||
        edge.type !== "cuttable") {
      fail("SEED_GRAPH_INVALID", `Invalid edge in ${templateId}`);
    }
    edgePairs.add(pair);
  }
}

function validateSeed(seed, templateId) {
  if (!text(seed.title) || text(seed.title).length > 100 ||
      !text(seed.description) || !text(seed.previewImage) ||
      !seed.previewImage.startsWith("/templates/") ||
      !Array.isArray(seed.categories) || seed.categories.length < 1 ||
      seed.categories.some((category) => !CATEGORY_WHITELIST.has(category)) ||
      !seed.graph) {
    fail("SEED_RECORD_INVALID", `Invalid seed metadata for ${templateId}`);
  }
  validateGraph(seed.graph, templateId);
}

function inspectRows(database, rows) {
  const lookup = database.prepare("SELECT id, title, description, category, graph, preview_image, status, created_by, updated_by, archived_at FROM public_templates WHERE id = ?");
  const result = { missing: [], matching: [], conflicting: [] };
  for (const expected of rows) {
    const actual = lookup.get(expected.id);
    if (!actual) {
      result.missing.push(expected.id);
      continue;
    }
    const metadataMatches = actual.title === expected.title
      && actual.description === expected.description
      && JSON.stringify(JSON.parse(actual.category)) === expected.category
      && actual.preview_image === expected.previewImage;
    const graphMatches = JSON.stringify(JSON.parse(actual.graph)) === expected.graph;
    if (metadataMatches && graphMatches) {
      result.matching.push(expected.id);
    } else {
      result.conflicting.push(expected.id);
    }
  }
  return result;
}

let database;
try {
  const { apply, ids, updateExisting, values } = parseArguments(process.argv.slice(2));
  const dataDirectory = normalizedAbsolutePath(values.get("--data-dir"), "Data directory");
  const seedsPath = normalizedAbsolutePath(values.get("--seeds"), "Seeds path");
  const staticRoot = normalizedAbsolutePath(values.get("--static-root"), "Static root");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const [canonicalData, canonicalDatabase, canonicalSeeds, canonicalStatic, databaseDetails] = await Promise.all([
    realpath(dataDirectory),
    realpath(databasePath),
    realpath(seedsPath),
    realpath(staticRoot),
    stat(databasePath),
  ]);
  if (canonicalData !== dataDirectory || canonicalDatabase !== databasePath ||
      canonicalSeeds !== seedsPath || canonicalStatic !== staticRoot || !databaseDetails.isFile()) {
    fail("SEED_ARGUMENT_INVALID", "Data, database, seeds and static paths must be canonical");
  }
  const seedsDocument = JSON.parse(await readFile(seedsPath, "utf8"));
  if (!Array.isArray(seedsDocument)) fail("SEED_RECORD_INVALID", "Seeds document must be an array");
  const selectedSeeds = ids.length > 0
    ? seedsDocument.filter((seed) => ids.includes(seed.id))
    : seedsDocument;
  if (ids.length > 0 && selectedSeeds.length !== ids.length) {
    const found = new Set(selectedSeeds.map((seed) => seed.id));
    fail("SEED_RECORD_INVALID", `Missing requested seed ids: ${ids.filter((id) => !found.has(id)).join(", ")}`);
  }
  const rows = selectedSeeds.map((seed) => {
    validateSeed(seed, seed.id);
    return {
      id: seed.id,
      title: seed.title,
      description: seed.description,
      category: JSON.stringify(seed.categories),
      graph: JSON.stringify(seed.graph),
      previewImage: seed.previewImage,
    };
  });
  const coverResults = [];
  for (const row of rows) {
    const candidate = join(staticRoot, row.previewImage.slice(1));
    const canonical = await realpath(candidate);
    const details = await stat(canonical);
    if (!isInside(staticRoot, canonical) || !details.isFile() || details.size < 1_000) {
      fail("SEED_COVER_INVALID", `Cover is missing or too small: ${row.previewImage}`);
    }
    coverResults.push({ path: row.previewImage, bytes: details.size });
  }
  database = new DatabaseSync(canonicalDatabase, { open: true, readOnly: !apply, timeout: 5000 });
  if (!apply) database.exec("PRAGMA query_only = ON");
  const beforeHealth = databaseHealth(database);
  const before = inspectRows(database, rows);
  let inserted = 0;
  let updated = 0;
  let timestamp = null;
  if (apply) {
    if (before.conflicting.length > 0 && !updateExisting) {
      fail("SEED_TEMPLATE_CONFLICT", `Existing templates differ from seeds and --update-existing was not given: ${before.conflicting.join(", ")}`);
    }
    timestamp = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      databaseHealth(database);
      const insert = database.prepare("INSERT INTO public_templates (id, title, description, category, graph, cover_asset_id, preview_image, status, created_by, created_at, updated_by, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 'published', NULL, ?, NULL, ?, NULL)");
      const update = database.prepare("UPDATE public_templates SET title = ?, description = ?, category = ?, graph = ?, preview_image = ?, updated_at = ? WHERE id = ?");
      for (const row of rows) {
        const existing = database.prepare("SELECT 1 FROM public_templates WHERE id = ?").get(row.id);
        if (!existing) {
          const result = insert.run(row.id, row.title, row.description, row.category, row.graph, row.previewImage, timestamp, timestamp);
          if (result.changes !== 1) fail("SEED_TEMPLATE_CHANGED", `Insert failed for ${row.id}`);
          inserted += 1;
          continue;
        }
        const actual = database.prepare("SELECT title, description, category, graph, preview_image, status, created_by, updated_by, archived_at FROM public_templates WHERE id = ?").get(row.id);
        const metadataMatches = actual.title === row.title && actual.description === row.description
          && JSON.stringify(JSON.parse(actual.category)) === row.category
          && actual.preview_image === row.previewImage;
        const graphMatches = JSON.stringify(JSON.parse(actual.graph)) === row.graph;
        if (metadataMatches && graphMatches) continue;
        if (!updateExisting) fail("SEED_TEMPLATE_CONFLICT", `Existing template differs from seed: ${row.id}`);
        const result = update.run(row.title, row.description, row.category, row.graph, row.previewImage, timestamp, row.id);
        if (result.changes !== 1) fail("SEED_TEMPLATE_CHANGED", `Update failed for ${row.id}`);
        updated += 1;
      }
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  const afterHealth = databaseHealth(database);
  const after = inspectRows(database, rows);
  process.stdout.write(`${JSON.stringify({
    applied: apply,
    updateExisting,
    timestamp,
    inserted,
    updated,
    before,
    after,
    health: afterHealth,
    unchangedHealth: JSON.stringify(beforeHealth) === JSON.stringify(afterHealth),
    covers: coverResults,
    templates: rows.map((row) => ({ id: row.id, title: row.title, nodes: JSON.parse(row.graph).nodes.length, edges: JSON.parse(row.graph).edges.length, previewImage: row.previewImage })),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error?.code ?? "SEED_PUBLISH_FAILED", message: error?.message ?? "Public template seed apply failed" })}\n`);
  process.exitCode = 1;
} finally {
  database?.close();
}
