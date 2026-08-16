import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const ACTIVE_STATES = ["queued", "running", "retrying", "recovering"];
const MODELS = {
  text: "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
  image: "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
  video: "f2abd864-4e38-4081-af52-820629032033",
};
const NODE_TYPES = new Set(["group", "image", "text", "video"]);
const INPUT_MATRIX = {
  text: new Set(["text", "image", "video"]),
  image: new Set(["text", "image"]),
  video: new Set(["text", "image", "video"]),
};
const TEMPLATE_META = [
  {
    workflowId: "apparel_auto_launch_p0",
    id: "00000000-0000-4000-8000-000000000901",
    title: "服装一键上新｜P0主图与详情页",
    description: "上传一张服装图，自动提取商品事实并生成货架主图、试穿主图和详情页组图。",
    categories: ["电商"],
    previewImage: "/templates/ecommerce-womenswear-white-hero.jpg",
  },
  {
    workflowId: "apparel_auto_launch_p1",
    id: "00000000-0000-4000-8000-000000000902",
    title: "服装一键带货｜P1抖音OOTD与短视频",
    description: "复用同一份服装事实与参考图，生成OOTD种草图、动作封面、抖音短视频和发布文案。",
    categories: ["电商", "广告"],
    previewImage: "/templates/ecommerce-douyin-womenswear-15s.jpg",
  },
  {
    workflowId: "apparel_auto_launch_all",
    title: "服装一键自动上新｜主图详情页 + 抖音带货",
    description: "一次上传，自动分流生成P0主图/详情页和P1抖音带货全套素材；所有下游节点按多入参成功后再启动。",
    categories: ["电商", "广告"],
    previewImage: "/templates/ecommerce-womenswear-five-panel.jpg",
    id: "00000000-0000-4000-8000-000000000903",
  },
];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const values = new Map();
  let apply = false;
  let repairParentHierarchy = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--apply") {
      if (apply) fail("APPAREL_ARGUMENT_INVALID", "Duplicate --apply argument");
      apply = true;
      continue;
    }
    if (option === "--repair-parent-hierarchy") {
      if (repairParentHierarchy) fail("APPAREL_ARGUMENT_INVALID", "Duplicate --repair-parent-hierarchy argument");
      repairParentHierarchy = true;
      continue;
    }
    if (!["--data-dir", "--package", "--static-root"].includes(option)) {
      fail("APPAREL_ARGUMENT_INVALID", `Unknown argument: ${option}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || values.has(option)) {
      fail("APPAREL_ARGUMENT_INVALID", `Missing or duplicate value for ${option}`);
    }
    values.set(option, value);
    index += 1;
  }
  for (const required of ["--data-dir", "--package", "--static-root"]) {
    if (!values.has(required)) fail("APPAREL_ARGUMENT_INVALID", `${required} is required`);
  }
  return { apply, repairParentHierarchy, values };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedAbsolutePath(value, label) {
  if (!isAbsolute(value) || resolve(value) !== value || /[\0\r\n]/.test(value)) {
    fail("APPAREL_ARGUMENT_INVALID", `${label} must be a normalized absolute path`);
  }
  return value;
}

function isInside(parent, child) {
  const difference = relative(parent, child);
  return difference === "" || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`));
}

function scalar(database, sql, label) {
  const row = database.prepare(sql).get();
  const value = row && Object.values(row)[0];
  if (value === undefined) fail("APPAREL_DATABASE_INVALID", `${label} is unavailable`);
  return value;
}

function renderPrompt(prompt, pack) {
  const bindings = {
    source_image: "上游上传的服装参考图",
    product_facts: "上游提取的服装事实 JSON",
    normalized_garment_image: "上游标准化服装参考图",
    creative_direction: "上游元提示词生产导演 JSON",
    aspect_ratio: "9:16",
    shared_fidelity: pack.sharedRules.fidelity,
    negative_rules: pack.sharedRules.negative,
    shelf_hero: "上游生成的货架主图",
    try_on: "上游生成的试穿主图",
    detail_page: "上游生成的详情页组图",
    ootd_scene: "上游生成的OOTD种草图",
    pose_set: "上游生成的动作封面组",
    douyin_video: "上游生成的抖音短视频",
    douyin_caption: "上游生成的抖音发布文案",
  };
  return String(prompt ?? "").replace(/\{\{([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\}\}/g, (match, key, field) => {
    if (key === "creative_direction") return field ? `上游元提示词生产导演 JSON 中的 ${field}` : "上游元提示词生产导演 JSON";
    return bindings[key] ?? match;
  });
}

function node(id, type, title, position, style, data = {}) {
  return {
    id,
    type,
    ...(type === "group" ? {} : { parentId: "template-group" }),
    position,
    data: { label: type === "group" ? "Group" : `${type[0].toUpperCase()}${type.slice(1)}`, title, ...data },
    style,
    zIndex: type === "group" ? 0 : 1,
  };
}

function materializeWorkflow(workflow, pack, title) {
  const nodesById = new Map();
  const edges = [];
  const factsPrompt = renderPrompt(pack.factExtraction.prompt, pack);
  const nodeList = workflow.nodes;
  for (const [index, spec] of nodeList.entries()) {
    const x = 40 + (index % 4) * 720;
    const y = 40 + Math.floor(index / 4) * 560;
    let data = {};
    if (spec.role === "input") {
      data = { sourceKind: "image", imagePromptReady: false };
    } else if (spec.type === "image") {
      const aspectRatio = spec.id === "shelf_hero" ? "1:1" : spec.id === "pose_set" ? "9:16" : "3:4";
      data = {
        sourceKind: "image",
        imagePrompt: renderPrompt(spec.prompt, pack),
        imagePromptReady: true,
        imageAspectRatio: aspectRatio,
        imageQuality: "1k",
        imageModelId: MODELS.image,
      };
    } else if (spec.type === "video") {
      data = {
        sourceKind: "video",
        videoPrompt: renderPrompt(spec.prompt, pack),
        videoPromptReady: true,
        videoModelId: MODELS.video,
      };
    } else {
      const prompt = spec.promptRef === "factExtraction" ? factsPrompt : renderPrompt(spec.prompt, pack);
      data = { textPrompt: prompt, textPromptReady: true, textModelId: MODELS.text };
    }
    const height = spec.type === "video" ? 420 : spec.type === "image" ? 380 : 420;
    const materialized = node(`template-node-${index + 1}`, spec.type, spec.title, { x, y }, { width: 620, height }, data);
    nodesById.set(spec.id, { ...materialized, sourceSpecId: spec.id });
  }
  const idMap = new Map([...nodesById.entries()].map(([sourceId, item]) => [sourceId, item.id]));
  const inputOrderByTarget = new Map();
  for (const [index, [source, target]] of workflow.edges.entries()) {
    const sourceId = idMap.get(source);
    const targetId = idMap.get(target);
    if (!sourceId || !targetId) fail("APPAREL_GRAPH_INVALID", `Missing edge endpoint ${source}->${target}`);
    const order = (inputOrderByTarget.get(target) ?? 0) + 1;
    inputOrderByTarget.set(target, order);
    edges.push({
      id: `template-edge-${String(index + 1).padStart(3, "0")}`,
      source: sourceId,
      target: targetId,
      sourceHandle: "source",
      targetHandle: "target",
      type: "cuttable",
      data: { inputOrder: order },
    });
  }
  const width = Math.max(...[...nodesById.values()].map((item) => item.position.x + item.style.width)) + 80;
  const height = Math.max(...[...nodesById.values()].map((item) => item.position.y + item.style.height)) + 80;
  const group = node("template-group", "group", title, { x: -24, y: -24 }, { width, height }, { variant: "group", groupTemplate: true });
  return { version: 1, nodes: [group, ...[...nodesById.values()].map(({ sourceSpecId, ...item }) => item)], edges };
}

function combineWorkflows(p0, p1) {
  const shared = new Set(["upload_reference", "extract_product_facts", "normalize_garment"]);
  const nodes = [...p0.nodes.filter((item) => shared.has(item.id) || !p1.nodes.some((other) => other.id === item.id))];
  for (const item of p1.nodes) {
    if (!shared.has(item.id)) nodes.push(item);
  }
  const edges = [...p0.edges];
  for (const edge of p1.edges) {
    if (!edges.some((candidate) => candidate[0] === edge[0] && candidate[1] === edge[1])) edges.push(edge);
  }
  return { id: "apparel_auto_launch_all", title: "服装一键自动上新｜主图详情页 + 抖音带货", nodes, edges };
}

function validateGraph(graph, templateId) {
  if (graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 500 || graph.edges.length > 1000) {
    fail("APPAREL_GRAPH_INVALID", `Invalid graph envelope for ${templateId}`);
  }
  const nodes = new Map();
  for (const item of graph.nodes) {
    if (!text(item.id) || nodes.has(item.id) || !NODE_TYPES.has(item.type) || !Number.isFinite(item.position?.x) || !Number.isFinite(item.position?.y) || !text(item.data?.label)) {
      fail("APPAREL_GRAPH_INVALID", `Invalid node in ${templateId}`);
    }
    nodes.set(item.id, item);
  }
  let topLevelNodes = 0;
  for (const item of graph.nodes) {
    if (item.parentId === undefined) {
      topLevelNodes += 1;
      continue;
    }
    const parent = nodes.get(item.parentId);
    if (item.parentId === item.id || item.type === "group" || parent?.type !== "group") {
      fail("APPAREL_GRAPH_INVALID", `Invalid parent hierarchy in ${templateId}`);
    }
  }
  if (graph.nodes.length > 0 && topLevelNodes === 0) {
    fail("APPAREL_GRAPH_INVALID", `Template has no top-level node in ${templateId}`);
  }
  const incoming = new Map([...nodes.keys()].map((id) => [id, []]));
  const outgoing = new Map([...nodes.keys()].map((id) => [id, []]));
  const edgePairs = new Set();
  const orders = new Map();
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const pair = `${edge.source}\0${edge.target}`;
    if (!source || !target || source === target || edgePairs.has(pair) || !Number.isSafeInteger(edge.data?.inputOrder)) {
      fail("APPAREL_GRAPH_INVALID", `Invalid edge in ${templateId}`);
    }
    if (INPUT_MATRIX[target.type] && !INPUT_MATRIX[target.type].has(source.type)) {
      fail("APPAREL_GRAPH_INVALID", `Incompatible ${source.type}->${target.type} edge in ${templateId}`);
    }
    const targetOrders = orders.get(target.id) ?? new Set();
    if (targetOrders.has(edge.data.inputOrder)) fail("APPAREL_GRAPH_INVALID", `Duplicate input order in ${templateId}`);
    targetOrders.add(edge.data.inputOrder);
    orders.set(target.id, targetOrders);
    incoming.get(target.id).push(source.type);
    outgoing.get(source.id).push(target.id);
    edgePairs.add(pair);
  }
  const degree = new Map([...nodes.keys()].map((id) => [id, incoming.get(id).length]));
  const queue = [...degree.entries()].filter(([, value]) => value === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift();
    visited += 1;
    for (const target of outgoing.get(current)) {
      degree.set(target, degree.get(target) - 1);
      if (degree.get(target) === 0) queue.push(target);
    }
  }
  if (visited !== nodes.size) fail("APPAREL_GRAPH_INVALID", `Cycle detected in ${templateId}`);
  for (const item of graph.nodes) {
    if (item.type === "group") continue;
    if (item.parentId !== "template-group") fail("APPAREL_GRAPH_INVALID", `Invalid parent in ${templateId}`);
    if (item.data[`${item.type}PromptReady`] !== true) continue;
    if (item.data[`${item.type}ModelId`] !== MODELS[item.type]) fail("APPAREL_GRAPH_INVALID", `Missing ${item.type} model in ${templateId}`);
    if (item.type === "image" && (!incoming.get(item.id).includes("text") || !incoming.get(item.id).includes("image"))) {
      fail("APPAREL_GRAPH_INVALID", `Image output needs text and image inputs in ${templateId}`);
    }
    if (item.type === "video" && incoming.get(item.id).filter((type) => type === "image").length !== 1) {
      fail("APPAREL_GRAPH_INVALID", `Video output needs exactly one image input in ${templateId}`);
    }
  }
}

async function verifyCovers(staticRoot) {
  const results = [];
  for (const item of TEMPLATE_META) {
    const candidate = join(staticRoot, item.previewImage.slice(1));
    const canonical = await realpath(candidate);
    const details = await stat(canonical);
    if (!isInside(staticRoot, canonical) || !details.isFile() || details.size < 10_000) fail("APPAREL_COVER_INVALID", `Cover is missing or too small: ${item.previewImage}`);
    results.push({ path: item.previewImage, bytes: details.size });
  }
  return results;
}

function databaseHealth(database) {
  const schemaVersion = Number(scalar(database, "PRAGMA user_version", "schema version"));
  const quickCheck = String(scalar(database, "PRAGMA quick_check", "quick check"));
  const foreignKeys = Number(scalar(database, "SELECT COUNT(*) FROM pragma_foreign_key_check", "foreign key check"));
  const activeTasks = Number(database.prepare(`SELECT COUNT(*) AS count FROM generation_tasks WHERE state IN (${ACTIVE_STATES.map(() => "?").join(",")})`).get(...ACTIVE_STATES).count);
  if (schemaVersion !== 39 || quickCheck !== "ok" || foreignKeys !== 0 || activeTasks !== 0) fail("APPAREL_DATABASE_INVALID", "Database must be healthy schema39, FK0, active generation0");
  return { schemaVersion, quickCheck, foreignKeys, activeTasks };
}

function validateModels(database) {
  const rows = database.prepare(`SELECT model_profiles.id, model_profiles.capability, model_profiles.status, model_profiles.archived_at, node_model_bindings.enabled FROM model_profiles JOIN node_model_bindings ON node_model_bindings.model_id = model_profiles.id AND node_model_bindings.node_type = model_profiles.capability WHERE model_profiles.id IN (?, ?, ?)`).all(MODELS.text, MODELS.image, MODELS.video);
  if (rows.length !== 3) fail("APPAREL_MODEL_INVALID", "Exact text/image/video model bindings are incomplete");
  for (const [capability, id] of Object.entries(MODELS)) {
    const row = rows.find((item) => item.id === id && item.capability === capability);
    if (!row || row.status !== "published" || row.archived_at !== null || row.enabled !== 1) fail("APPAREL_MODEL_INVALID", `${capability} model is not published and enabled`);
  }
  return rows.map(({ id, capability }) => ({ id, capability }));
}

function matchesLegacySelfParentGraph(actualGraph, expectedGraph) {
  let actual;
  let expected;
  try {
    actual = JSON.parse(actualGraph);
    expected = JSON.parse(expectedGraph);
  } catch {
    return false;
  }
  const legacyGroup = actual?.nodes?.find((item) => item?.id === "template-group" && item?.type === "group");
  if (!legacyGroup || legacyGroup.parentId !== legacyGroup.id) return false;
  delete legacyGroup.parentId;
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function inspectRows(database, rows, { allowLegacySelfParent = false } = {}) {
  const lookup = database.prepare("SELECT id, title, description, category, graph, preview_image, status, created_by, updated_by, archived_at FROM public_templates WHERE id = ?");
  let existing = 0;
  let missing = 0;
  let repairable = 0;
  for (const expected of rows) {
    const actual = lookup.get(expected.id);
    if (!actual) {
      missing += 1;
      continue;
    }
    existing += 1;
    const metadataMatches = actual.title === expected.title
      && actual.description === expected.description
      && JSON.stringify(JSON.parse(actual.category)) === expected.category
      && actual.preview_image === expected.previewImage
      && actual.status === "published"
      && actual.created_by === null
      && actual.updated_by === null
      && actual.archived_at === null;
    const graphMatches = JSON.stringify(JSON.parse(actual.graph)) === expected.graph;
    if (metadataMatches && graphMatches) continue;
    if (allowLegacySelfParent && metadataMatches && matchesLegacySelfParentGraph(actual.graph, expected.graph)) {
      repairable += 1;
      continue;
    }
    {
      fail("APPAREL_TEMPLATE_CONFLICT", `Existing template differs from package: ${expected.id}`);
    }
  }
  return { existing, missing, repairable };
}

let database;
try {
  const { apply, repairParentHierarchy, values } = parseArguments(process.argv.slice(2));
  const dataDirectory = normalizedAbsolutePath(values.get("--data-dir"), "Data directory");
  const packagePath = normalizedAbsolutePath(values.get("--package"), "Package path");
  const staticRoot = normalizedAbsolutePath(values.get("--static-root"), "Static root");
  const databasePath = join(dataDirectory, "unboundry.sqlite");
  const [canonicalData, canonicalDatabase, canonicalPackage, canonicalStatic, databaseDetails] = await Promise.all([realpath(dataDirectory), realpath(databasePath), realpath(packagePath), realpath(staticRoot), stat(databasePath)]);
  if (canonicalData !== dataDirectory || canonicalDatabase !== databasePath || canonicalPackage !== packagePath || canonicalStatic !== staticRoot || !databaseDetails.isFile()) fail("APPAREL_ARGUMENT_INVALID", "Data, database, package and static paths must be canonical");
  const pack = JSON.parse(await readFile(packagePath, "utf8"));
  if (pack.kind !== "APPAREL_AUTO_LAUNCH_PROMPT_PACK" || pack.status !== "local-candidate") fail("APPAREL_PACKAGE_INVALID", "Unexpected package kind or status");
  const p0 = pack.workflows.find((item) => item.id === "apparel_auto_launch_p0");
  const p1 = pack.workflows.find((item) => item.id === "apparel_auto_launch_p1");
  if (!p0 || !p1) fail("APPAREL_PACKAGE_INVALID", "P0/P1 workflows are required");
  const combined = combineWorkflows(p0, p1);
  const workflowMap = new Map([[p0.id, p0], [p1.id, p1], [combined.id, combined]]);
  const rows = TEMPLATE_META.map((meta) => {
    const workflow = workflowMap.get(meta.workflowId);
    const graph = materializeWorkflow(workflow, pack, meta.title);
    validateGraph(graph, meta.id);
    return { ...meta, category: JSON.stringify(meta.categories), graph: JSON.stringify(graph) };
  });
  const packageSha256 = createHash("sha256").update(await readFile(packagePath)).digest("hex");
  const graphSha256 = createHash("sha256").update(rows.map((row) => `${row.id}\0${row.graph}\n`).join("")).digest("hex");
  const covers = await verifyCovers(canonicalStatic);
  database = new DatabaseSync(canonicalDatabase, { open: true, readOnly: !apply, timeout: 5000 });
  if (!apply) database.exec("PRAGMA query_only = ON");
  const beforeHealth = databaseHealth(database);
  const models = validateModels(database);
  const before = inspectRows(database, rows, { allowLegacySelfParent: repairParentHierarchy });
  if (repairParentHierarchy && before.missing !== 0) {
    fail("APPAREL_REPAIR_INVALID", "Parent hierarchy repair requires all three published templates to exist");
  }
  let inserted = 0;
  let repaired = 0;
  let timestamp = null;
  if (apply) {
    timestamp = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      databaseHealth(database);
      validateModels(database);
      inspectRows(database, rows, { allowLegacySelfParent: repairParentHierarchy });
      if (repairParentHierarchy) {
        const update = database.prepare("UPDATE public_templates SET graph = ?, updated_at = ? WHERE id = ?");
        const lookupGraph = database.prepare("SELECT graph FROM public_templates WHERE id = ?");
        for (const row of rows) {
          const actual = lookupGraph.get(row.id);
          if (!actual || JSON.stringify(JSON.parse(actual.graph)) === row.graph) continue;
          if (!matchesLegacySelfParentGraph(actual.graph, row.graph)) fail("APPAREL_TEMPLATE_CHANGED", `Repair precondition changed for ${row.id}`);
          const result = update.run(row.graph, timestamp, row.id);
          if (result.changes !== 1) fail("APPAREL_TEMPLATE_CHANGED", `Repair failed for ${row.id}`);
          repaired += 1;
        }
      } else {
        const insert = database.prepare("INSERT INTO public_templates (id, title, description, category, graph, cover_asset_id, preview_image, status, created_by, created_at, updated_by, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 'published', NULL, ?, NULL, ?, NULL)");
        for (const row of rows) {
          if (database.prepare("SELECT 1 FROM public_templates WHERE id = ?").get(row.id)) continue;
          const result = insert.run(row.id, row.title, row.description, row.category, row.graph, row.previewImage, timestamp, timestamp);
          if (result.changes !== 1) fail("APPAREL_TEMPLATE_CHANGED", `Insert failed for ${row.id}`);
          inserted += 1;
        }
      }
      inspectRows(database, rows);
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  const afterHealth = databaseHealth(database);
  const after = inspectRows(database, rows, { allowLegacySelfParent: repairParentHierarchy && !apply });
  process.stdout.write(`${JSON.stringify({ applied: apply, repairParentHierarchy, packageSha256, graphSha256, timestamp, inserted, repaired, before, after, health: afterHealth, unchangedHealth: JSON.stringify(beforeHealth) === JSON.stringify(afterHealth), models, covers, templates: rows.map((row) => ({ id: row.id, workflowId: row.workflowId, title: row.title, nodes: JSON.parse(row.graph).nodes.length, edges: JSON.parse(row.graph).edges.length, previewImage: row.previewImage })) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error?.code ?? "APPAREL_PUBLISH_FAILED", message: error?.message ?? "Apparel template package failed" })}\n`);
  process.exitCode = 1;
} finally {
  database?.close();
}
