import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const ACTIVE_STATES = ["queued", "running", "retrying", "recovering"];
const EXPECTED_BATCH_IDS = new Map([2, 3].map((batchNumber) => [
  `ECOMMERCE_WORKFLOW_BATCH_${batchNumber}`,
  Array.from(
    { length: 12 },
    (_, index) => `00000000-0000-4000-8000-000000000${batchNumber}${String(index + 1).padStart(2, "0")}`,
  ),
]));
const EXPECTED_PRIORITIES = { P0: 5, P1: 6, P2: 1 };
const EXPECTED_MODELS = {
  text: "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
  image: "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
  video: "f2abd864-4e38-4081-af52-820629032033",
};
const NODE_INPUT_MATRIX = {
  text: new Set(["text", "image", "video", "audio"]),
  image: new Set(["text", "image"]),
  video: new Set(["text", "image", "video", "audio"]),
  audio: new Set(["text"]),
};
const NODE_TYPES = new Set(["audio", "group", "image", "playlist", "storyboard", "text", "video"]);

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
      if (apply) fail("BATCH2_ARGUMENT_INVALID", "Duplicate --apply argument");
      apply = true;
      continue;
    }
    if (!["--data-dir", "--package", "--static-root"].includes(option)) {
      fail("BATCH2_ARGUMENT_INVALID", `Unknown argument: ${option}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(option)) {
      fail("BATCH2_ARGUMENT_INVALID", `Missing or duplicate value for ${option}`);
    }
    values.set(option, value);
    index += 1;
  }
  for (const required of ["--data-dir", "--package", "--static-root"]) {
    if (!values.has(required)) fail("BATCH2_ARGUMENT_INVALID", `${required} is required`);
  }
  return { apply, values };
}

function normalizedAbsolutePath(value, label) {
  if (!isAbsolute(value) || resolve(value) !== value || /[\0\r\n]/.test(value)) {
    fail("BATCH2_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
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
  if (value === undefined) fail("BATCH2_DATABASE_INVALID", `${label} is unavailable`);
  return value;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function exactObject(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validatePackage(input) {
  const expectedIds = EXPECTED_BATCH_IDS.get(input?.batch);
  if (!exactObject(input, ["version", "batch", "models", "templates"]) ||
      input.version !== 1 || !expectedIds ||
      !exactObject(input.models, ["text", "image", "video"]) ||
      JSON.stringify(input.models) !== JSON.stringify(EXPECTED_MODELS) ||
      !Array.isArray(input.templates) || input.templates.length !== 12) {
    fail("BATCH2_PACKAGE_INVALID", "Package header or exact model contract is invalid");
  }
  const ids = input.templates.map((item) => item?.id);
  if (new Set(ids).size !== 12 || JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    fail("BATCH2_PACKAGE_INVALID", "Package must contain the exact ordered 12 template ids");
  }
  const priorities = { P0: 0, P1: 0, P2: 0 };
  const titles = new Set();
  for (const item of input.templates) {
    if (!Object.hasOwn(priorities, item.priority)) {
      fail("BATCH2_PACKAGE_INVALID", `Invalid priority for ${item.id}`);
    }
    priorities[item.priority] += 1;
    if (!text(item.title) || text(item.title).length > 100 || titles.has(item.title)) {
      fail("BATCH2_PACKAGE_INVALID", `Invalid or duplicate title for ${item.id}`);
    }
    titles.add(item.title);
    if (!text(item.description) || !text(item.intakePrompt) || !text(item.directorPrompt)) {
      fail("BATCH2_PACKAGE_INVALID", `Missing descriptive prompt fields for ${item.id}`);
    }
    if (!Array.isArray(item.categories) || item.categories.length < 1 ||
        item.categories.some((category) => !["广告", "电商", "生活", "工具"].includes(category))) {
      fail("BATCH2_PACKAGE_INVALID", `Invalid category for ${item.id}`);
    }
    if (!/^\/templates\/ecommerce-[a-z0-9-]+\.jpg$/.test(item.previewImage)) {
      fail("BATCH2_PACKAGE_INVALID", `Invalid preview path for ${item.id}`);
    }
    const references = item.referenceImages ?? ["2. 上传商品参考图"];
    if (!Array.isArray(references) || references.length < 1 || references.length > 3 ||
        references.some((title) => !text(title))) {
      fail("BATCH2_PACKAGE_INVALID", `Invalid reference-image declaration for ${item.id}`);
    }
    if (!Array.isArray(item.outputs) || item.outputs.length < 1 || item.outputs.length > 7) {
      fail("BATCH2_PACKAGE_INVALID", `Invalid output declaration for ${item.id}`);
    }
    for (const output of item.outputs) {
      if (!text(output?.title) || !text(output?.prompt) || !["image", "video"].includes(output?.type)) {
        fail("BATCH2_PACKAGE_INVALID", `Invalid output in ${item.id}`);
      }
      if (output.type === "image" && !["1:1", "3:4", "9:16"].includes(output.aspectRatio)) {
        fail("BATCH2_PACKAGE_INVALID", `Invalid image aspect ratio in ${item.id}`);
      }
      if (output.type === "video" && output.aspectRatio !== undefined) {
        fail("BATCH2_PACKAGE_INVALID", `Video aspect ratio belongs to the saved model defaults in ${item.id}`);
      }
    }
    if (item.publishingPrompt !== undefined && !text(item.publishingPrompt)) {
      fail("BATCH2_PACKAGE_INVALID", `Invalid publishing prompt for ${item.id}`);
    }
    if (item.storyboard !== undefined && (
      !Array.isArray(item.storyboard) || item.storyboard.length < 1 || item.storyboard.length > 8 ||
      item.storyboard.some((shot) => !text(shot?.duration) || !text(shot?.framing) ||
        !text(shot?.summary) || !text(shot?.dialogue))
    )) fail("BATCH2_PACKAGE_INVALID", `Invalid storyboard for ${item.id}`);
  }
  if (JSON.stringify(priorities) !== JSON.stringify(EXPECTED_PRIORITIES)) {
    fail("BATCH2_PACKAGE_INVALID", "Package priority distribution must be P0=5, P1=6, P2=1");
  }
  return input;
}

function node(id, type, title, position, style, data = {}) {
  return {
    id,
    type,
    position,
    parentId: "template-group",
    data: { label: type === "storyboard" ? "Storyboard/Table" : `${type[0].toUpperCase()}${type.slice(1)}`, title, ...data },
    style,
    zIndex: 1,
  };
}

function edge(index, source, target, inputOrder) {
  return {
    id: `template-edge-${String(index).padStart(2, "0")}`,
    source,
    target,
    sourceHandle: "source",
    targetHandle: "target",
    type: "cuttable",
    data: { inputOrder },
  };
}

function materializeTemplate(item, models) {
  const nodes = [];
  const edges = [];
  let edgeIndex = 1;
  const addEdge = (source, target, order) => edges.push(edge(edgeIndex++, source, target, order));
  nodes.push(node(
    "template-node-1",
    "text",
    "1. 商品事实与约束",
    { x: 40, y: 40 },
    { width: 520, height: 380 },
    { textPrompt: item.intakePrompt, textPromptReady: true, textModelId: models.text },
  ));

  const referenceTitles = item.referenceImages ?? ["2. 上传商品参考图"];
  const referenceIds = referenceTitles.map((title, index) => {
    const id = `template-node-${index + 2}`;
    nodes.push(node(
      id,
      "image",
      title,
      { x: 40 + (index % 2) * 390, y: 470 + Math.floor(index / 2) * 360 },
      { width: 350, height: 320 },
      { sourceKind: "image", imagePromptReady: false },
    ));
    return id;
  });

  const directorId = `template-node-${referenceIds.length + 2}`;
  nodes.push(node(
    directorId,
    "text",
    `${referenceIds.length + 2}. 元提示词·生产导演`,
    { x: 840, y: 40 },
    { width: 660, height: 500 },
    { textPrompt: item.directorPrompt, textPromptReady: true, textModelId: models.text },
  ));
  addEdge("template-node-1", directorId, 1);
  referenceIds.forEach((id, index) => addEdge(id, directorId, index + 2));

  const outputIds = [];
  item.outputs.forEach((output, index) => {
    const id = `template-node-${referenceIds.length + 3 + index}`;
    const column = index % 3;
    const row = Math.floor(index / 3);
    const data = output.type === "image"
      ? {
          sourceKind: "image",
          imagePrompt: output.prompt,
          imagePromptReady: true,
          imageAspectRatio: output.aspectRatio,
          imageQuality: "1k",
          imageModelId: models.image,
        }
      : {
          sourceKind: "video",
          videoPrompt: output.prompt,
          videoPromptReady: true,
          videoModelId: models.video,
        };
    nodes.push(node(
      id,
      output.type,
      output.title,
      { x: 1580 + column * 660, y: 40 + row * 440 },
      { width: 610, height: output.type === "video" ? 390 : 360 },
      data,
    ));
    addEdge(directorId, id, 1);
    const compatibleReferences = output.type === "video" ? referenceIds.slice(0, 1) : referenceIds;
    compatibleReferences.forEach((referenceId, referenceIndex) => addEdge(referenceId, id, referenceIndex + 2));
    outputIds.push(id);
  });

  const outputRows = Math.ceil(item.outputs.length / 3);
  let lowerY = Math.max(620, 40 + outputRows * 440);
  if (item.storyboard) {
    const id = `template-node-${referenceIds.length + 3 + item.outputs.length}`;
    nodes.push(node(
      id,
      "storyboard",
      "分镜与执行表",
      { x: 840, y: lowerY },
      { width: 1240, height: 520 },
      {
        storyboardShots: item.storyboard.map((shot, index) => ({
          number: index + 1,
          duration: shot.duration,
          framing: shot.framing,
          summary: shot.summary,
          dialogue: shot.dialogue,
          notes: "执行前核对商品事实与素材连续性。",
          mediaTone: index % 2 === 0 ? "desk" : "monitor",
          id: `shot-${index + 1}`,
          status: "complete",
        })),
      },
    ));
    addEdge("template-node-1", id, 1);
    addEdge(directorId, id, 2);
    lowerY += 580;
  }
  if (item.publishingPrompt) {
    const id = `template-node-${referenceIds.length + 3 + item.outputs.length + (item.storyboard ? 1 : 0)}`;
    nodes.push(node(
      id,
      "text",
      "发布文案与人工核验",
      { x: 840, y: lowerY },
      { width: 700, height: 380 },
      { textPrompt: item.publishingPrompt, textPromptReady: true, textModelId: models.text },
    ));
    addEdge("template-node-1", id, 1);
    addEdge(directorId, id, 2);
    lowerY += 440;
  }

  const right = Math.max(...nodes.map((item) => item.position.x + item.style.width));
  const bottom = Math.max(...nodes.map((item) => item.position.y + item.style.height));
  nodes.unshift({
    id: "template-group",
    type: "group",
    position: { x: -24, y: -24 },
    data: { label: "Group", title: item.title, variant: "group", groupTemplate: true },
    style: { width: right + 64, height: bottom + 64 },
    zIndex: 0,
  });
  return { version: 1, nodes, edges };
}

function validateGraph(graph, templateId) {
  if (graph?.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) ||
      graph.nodes.length > 500 || graph.edges.length > 1000) {
    fail("BATCH2_GRAPH_INVALID", `Invalid graph envelope for ${templateId}`);
  }
  const nodes = new Map();
  for (const item of graph.nodes) {
    if (!text(item?.id) || nodes.has(item.id) || !NODE_TYPES.has(item.type) ||
        !Number.isFinite(item.position?.x) || !Number.isFinite(item.position?.y) ||
        !text(item.data?.label)) {
      fail("BATCH2_GRAPH_INVALID", `Invalid or duplicate node in ${templateId}`);
    }
    nodes.set(item.id, item);
  }
  const edgeIds = new Set();
  const edgePairs = new Set();
  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  const degree = new Map([...nodes.keys()].map((id) => [id, 0]));
  const orders = new Map();
  for (const item of graph.edges) {
    const source = nodes.get(item?.source);
    const target = nodes.get(item?.target);
    const pair = `${item?.source}\0${item?.target}`;
    if (!text(item?.id) || edgeIds.has(item.id) || !source || !target || source === target || edgePairs.has(pair)) {
      fail("BATCH2_GRAPH_INVALID", `Invalid or duplicate edge in ${templateId}`);
    }
    if (NODE_INPUT_MATRIX[target.type] && NODE_INPUT_MATRIX[source.type] &&
        !NODE_INPUT_MATRIX[target.type].has(source.type)) {
      fail("BATCH2_GRAPH_INVALID", `Incompatible ${source.type}->${target.type} edge in ${templateId}`);
    }
    const order = item.data?.inputOrder;
    const targetOrders = orders.get(target.id) ?? new Set();
    if (!Number.isSafeInteger(order) || order < 1 || targetOrders.has(order)) {
      fail("BATCH2_GRAPH_INVALID", `Invalid input order in ${templateId}`);
    }
    targetOrders.add(order);
    orders.set(target.id, targetOrders);
    edgeIds.add(item.id);
    edgePairs.add(pair);
    adjacency.get(source.id).push(target.id);
    degree.set(target.id, degree.get(target.id) + 1);
  }
  const remaining = new Map(degree);
  while (remaining.size) {
    const ready = [...remaining].filter(([, value]) => value === 0).map(([id]) => id);
    if (!ready.length) fail("BATCH2_GRAPH_INVALID", `Cycle detected in ${templateId}`);
    for (const id of ready) {
      remaining.delete(id);
      for (const target of adjacency.get(id)) {
        if (remaining.has(target)) remaining.set(target, remaining.get(target) - 1);
      }
    }
  }
  for (const item of graph.nodes) {
    if (item.parentId && nodes.get(item.parentId)?.type !== "group") {
      fail("BATCH2_GRAPH_INVALID", `Invalid parent in ${templateId}`);
    }
    if (!["text", "image", "video"].includes(item.type)) continue;
    const promptReady = item.data[`${item.type}PromptReady`] === true;
    if (!promptReady) continue;
    const modelId = text(item.data[`${item.type}ModelId`]);
    if (modelId !== EXPECTED_MODELS[item.type]) {
      fail("BATCH2_GRAPH_INVALID", `Missing explicit ${item.type} model in ${templateId}`);
    }
    const incoming = graph.edges.filter((candidate) => candidate.target === item.id)
      .map((candidate) => nodes.get(candidate.source)?.type);
    if (item.type === "video" && incoming.filter((type) => type === "image").length !== 1) {
      fail("BATCH2_GRAPH_INVALID", `Video nodes must receive exactly one reference image in ${templateId}`);
    }
    if (item.type === "image" && (!incoming.includes("text") || !incoming.includes("image"))) {
      fail("BATCH2_GRAPH_INVALID", `Image outputs require text and image inputs in ${templateId}`);
    }
  }
}

async function verifyCovers(staticRoot, templates) {
  const results = [];
  for (const item of templates) {
    const candidate = join(staticRoot, item.previewImage.slice(1));
    const canonical = await realpath(candidate);
    const details = await stat(canonical);
    if (!isInside(staticRoot, canonical) || !details.isFile() || details.size < 10_000) {
      fail("BATCH2_COVER_INVALID", `Cover is missing or too small for ${item.id}`);
    }
    results.push({ id: item.id, path: item.previewImage, bytes: details.size });
  }
  return results;
}

function validateModelContracts(database, modelIds) {
  const rows = database.prepare(`
    SELECT
      model_profiles.id,
      model_profiles.display_name,
      model_profiles.capability,
      model_profiles.status,
      model_profiles.archived_at,
      model_profiles.default_parameters,
      node_model_bindings.enabled
    FROM model_profiles
    JOIN node_model_bindings
      ON node_model_bindings.model_id = model_profiles.id
      AND node_model_bindings.node_type = model_profiles.capability
    WHERE model_profiles.id IN (?, ?, ?)
  `).all(modelIds.text, modelIds.image, modelIds.video);
  if (rows.length !== 3) fail("BATCH2_MODEL_INVALID", "One or more exact model bindings are missing");
  for (const [capability, id] of Object.entries(modelIds)) {
    const row = rows.find((candidate) => candidate.id === id && candidate.capability === capability);
    if (!row || row.status !== "published" || row.archived_at !== null || row.enabled !== 1) {
      fail("BATCH2_MODEL_INVALID", `Exact ${capability} model is not published and enabled`);
    }
    let schema;
    try { schema = JSON.parse(row.default_parameters); } catch {}
    const supported = schema?.upstreamInputs;
    if (capability === "text" && (!supported?.text?.supported || !supported?.image?.supported)) {
      fail("BATCH2_MODEL_INVALID", "Text model no longer accepts the package text/image inputs");
    }
    if (capability === "image" && (!supported?.text?.supported || !supported?.image?.supported)) {
      fail("BATCH2_MODEL_INVALID", "Image model no longer accepts the package text/image inputs");
    }
    if (capability === "video" && Number(schema?.referenceInputs?.image) < 1) {
      fail("BATCH2_MODEL_INVALID", "Video model no longer accepts one reference image");
    }
  }
  return rows.map(({ id, display_name: displayName, capability }) => ({ id, displayName, capability }));
}

function databaseHealth(database) {
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
    fail("BATCH2_DATABASE_INVALID", "Database must be healthy schema39 with no foreign-key violations");
  }
  if (activeTasks !== 0) {
    fail("BATCH2_ACTIVE_GENERATION_TASKS", "Templates cannot be published while generation tasks are active");
  }
  return { schemaVersion, quickCheck, foreignKeys, activeTasks };
}

function normalizedJson(value, label) {
  try { return JSON.stringify(JSON.parse(value)); } catch {
    fail("BATCH2_TEMPLATE_CONFLICT", `${label} is not valid JSON`);
  }
}

function inspectRows(database, expectedRows) {
  const lookup = database.prepare(`
    SELECT id, title, description, category, graph, preview_image, status,
      created_by, updated_by, archived_at
    FROM public_templates
    WHERE id = ?
  `);
  let existing = 0;
  let missing = 0;
  for (const expected of expectedRows) {
    const row = lookup.get(expected.id);
    if (!row) {
      missing += 1;
      continue;
    }
    existing += 1;
    if (row.title !== expected.title || row.description !== expected.description ||
        normalizedJson(row.category, `${row.id} category`) !== expected.category ||
        normalizedJson(row.graph, `${row.id} graph`) !== expected.graph ||
        row.preview_image !== expected.previewImage || row.status !== "published" ||
        row.created_by !== null || row.updated_by !== null || row.archived_at !== null) {
      fail("BATCH2_TEMPLATE_CONFLICT", `Existing template differs from the package: ${expected.id}`);
    }
  }
  return { existing, missing };
}

let database;
try {
  const { apply, values } = parseArguments(process.argv.slice(2));
  const dataDirectory = normalizedAbsolutePath(values.get("--data-dir"), "Data directory");
  const packagePath = normalizedAbsolutePath(values.get("--package"), "Package path");
  const staticRoot = normalizedAbsolutePath(values.get("--static-root"), "Static root");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const [canonicalData, canonicalDatabase, canonicalPackage, canonicalStatic, databaseDetails] = await Promise.all([
    realpath(dataDirectory),
    realpath(databasePath),
    realpath(packagePath),
    realpath(staticRoot),
    stat(databasePath),
  ]);
  if (canonicalData !== dataDirectory || canonicalDatabase !== databasePath ||
      canonicalPackage !== packagePath || canonicalStatic !== staticRoot || !databaseDetails.isFile()) {
    fail("BATCH2_ARGUMENT_INVALID", "Data, database, package, and static paths must be canonical");
  }
  const packageData = validatePackage(JSON.parse(await readFile(packagePath, "utf8")));
  const materialized = packageData.templates.map((item) => ({
    id: item.id,
    priority: item.priority,
    title: item.title,
    description: item.description,
    category: JSON.stringify(item.categories),
    graph: JSON.stringify(materializeTemplate(item, packageData.models)),
    previewImage: item.previewImage,
  }));
  for (const row of materialized) validateGraph(JSON.parse(row.graph), row.id);
  const packageSha256 = createHash("sha256").update(await readFile(packagePath)).digest("hex");
  const graphSha256 = createHash("sha256")
    .update(materialized.map((item) => `${item.id}\0${item.graph}\n`).join(""))
    .digest("hex");
  const covers = await verifyCovers(canonicalStatic, packageData.templates);

  database = new DatabaseSync(canonicalDatabase, { open: true, readOnly: !apply, timeout: 5_000 });
  if (!apply) database.exec("PRAGMA query_only = ON");
  const beforeHealth = databaseHealth(database);
  const models = validateModelContracts(database, packageData.models);
  const before = inspectRows(database, materialized);
  let inserted = 0;
  let timestamp = null;
  if (apply) {
    timestamp = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      databaseHealth(database);
      validateModelContracts(database, packageData.models);
      inspectRows(database, materialized);
      const insert = database.prepare(`
        INSERT INTO public_templates (
          id, title, description, category, graph, cover_asset_id,
          preview_image, status, created_by, created_at,
          updated_by, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, 'published', NULL, ?, NULL, ?, NULL)
      `);
      for (const row of materialized) {
        const exists = database.prepare("SELECT 1 FROM public_templates WHERE id = ?").get(row.id);
        if (exists) continue;
        const result = insert.run(
          row.id, row.title, row.description, row.category, row.graph,
          row.previewImage, timestamp, timestamp,
        );
        if (result.changes !== 1) fail("BATCH2_TEMPLATE_CHANGED", `Insert failed for ${row.id}`);
        inserted += 1;
      }
      inspectRows(database, materialized);
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  const afterHealth = databaseHealth(database);
  const after = inspectRows(database, materialized);
  process.stdout.write(`${JSON.stringify({
    applied: apply,
    batch: packageData.batch,
    packageSha256,
    graphSha256,
    timestamp,
    inserted,
    before,
    after,
    health: afterHealth,
    unchangedHealth: JSON.stringify(beforeHealth) === JSON.stringify(afterHealth),
    models,
    covers: { count: covers.length, totalBytes: covers.reduce((sum, item) => sum + item.bytes, 0) },
    templates: materialized.map((item) => ({
      id: item.id,
      priority: item.priority,
      title: item.title,
      nodes: JSON.parse(item.graph).nodes.length,
      edges: JSON.parse(item.graph).edges.length,
      previewImage: item.previewImage,
    })),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    code: error?.code ?? "BATCH2_PUBLISH_FAILED",
    message: error?.message ?? "Ecommerce workflow package failed",
  })}\n`);
  process.exitCode = 1;
} finally {
  database?.close();
}
