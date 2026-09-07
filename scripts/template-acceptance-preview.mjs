// Local manual acceptance only. Started by run-safe-tests.mjs acceptance.
import { randomUUID, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { build as viteBuild, createServer } from "vite";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Use run-safe-tests.mjs acceptance: missing ${name}`);
  return value;
};
if (required("UNBOUNDRY_SAFE_TEST") !== "1" ||
    required("UNBOUNDRY_TEST_TEMPLATE_ACCEPTANCE") !== "1" || process.versions.node !== "22.23.1") {
  throw new Error("Manual acceptance requires the isolated Node 22 safe runner");
}
const testRoot = realpathSync(required("UNBOUNDRY_TEST_ROOT"));
const sourceRoot = realpathSync(required("UNBOUNDRY_TEST_REPOSITORY_ROOT"));
const dataRoot = realpathSync(required("UNBOUNDRY_DATA_DIR"));
const systemRoot = realpathSync(required("UNBOUNDRY_SYSTEM_TEMPORARY_ROOT"));
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
};
const sentinel = realpathSync(required("UNBOUNDRY_SAFE_RUN_SENTINEL"));
if (!inside(systemRoot, testRoot) || !inside(systemRoot, sourceRoot) ||
    !inside(testRoot, dataRoot) || !inside(testRoot, sentinel) ||
    readFileSync(sentinel, "utf8").trim() !== required("UNBOUNDRY_SAFE_RUN_NONCE") ||
    process.env.NODE_OPTIONS !== `--import=${join(sourceRoot, "scripts/offline-network-guard.mjs")}`) {
  throw new Error("Manual acceptance isolation contract is invalid");
}
const port = Number(required("UNBOUNDRY_TEST_PORT"));
if (!Number.isInteger(port) || port < 42000 || port > 60000 || port === 4173) {
  throw new Error("Manual acceptance requires a dynamic safe-runner port");
}
const origin = `http://127.0.0.1:${port}`;
const packagedVersion = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")).version;
const acceptanceScenario = process.env.UNBOUNDRY_TEST_ACCEPTANCE_SCENARIO ?? "generation-status";
if (!["generation-status", "templates"].includes(acceptanceScenario)) {
  throw new Error(`Unknown local acceptance scenario: ${acceptanceScenario}`);
}
const generationScenario = acceptanceScenario === "generation-status";
const generationBaselineRoot = generationScenario
  ? realpathSync(required("UNBOUNDRY_GENERATION_STATUS_BASELINE_ROOT"))
  : undefined;
const generationBaselineManifest = generationScenario
  ? realpathSync(required("UNBOUNDRY_GENERATION_STATUS_BASELINE_MANIFEST"))
  : undefined;
const setupToken = randomUUID();
let adminCookie;
let ready = false;
let slow = false;
let graphReads = 0;
let toolsAvailable = false;
let maintenanceUntil = 0;
let demoVersion = "";
const updateStreams = new Set();
let finishSession;
const sessionFinished = new Promise((resolve) => { finishSession = resolve; });
const projects = [];
const mediaIds = [];
const operations = ["crop", "color-mark", "resize-pixels", "quick-split", "annotate", "save-to-library", "multi-angle", "redraw", "outpaint", "erase", "enhance-conservative", "enhance-creative", "remove-background", "seedance-validate", "download", "fullscreen", "lighting"];
const remoteOperations = new Set(["multi-angle", "redraw", "outpaint", "erase", "enhance-creative", "remove-background"]);
const fixtures = [];
const generationKinds = ["text", "image", "video", "audio"];
const generationPhases = ["candidate", "baseline", "re-enabled"];
const generationTasks = new Map();
// Helper-only observations; never sent as part of a product task response.
const generationObservations = new Map();
const generationChecks = { auto: "idle", manual: "idle", media: "idle" };
const generationCounters = {
  browserCanvasCommandWrites: 0,
  browserCanvasWrites: 0,
  controlCanvasWrites: 0,
  detailReads: 0,
  generationDeletes: 0,
  generationPosts: 0,
  maxInFlightDetailReads: 0,
  statusReads: 0,
  syntheticProjectionWrites: 0,
};
let generationDetailReadsInFlight = 0;
let generationFixture;
let generationJournalPath;
let generationBuilds;
let generationRuntime;
let generationProjectionInFlight = false;
let generationLastWriteSource = "browser";
let generationDelayNextMs = 0;
let generationDelayNextTaskId = "";
const startedAt = new Date();
const expiresAt = new Date(startedAt.getTime() + 2 * 60 * 60_000);
const digest = (graph) => createHash("sha256").update(JSON.stringify(graph)).digest("hex");
const generationBaselineFiles = Object.freeze([
  "client/src/generation/taskPolling.ts",
  "client/src/generation/generationTasks.ts",
]);
const generationBaselineSha256 = Object.freeze({
  "client/src/generation/taskPolling.ts": "ce9622994549a03fde72fe71cd31bd4ede7f53e66b5e64ab6ac5598c02c0b81b",
  "client/src/generation/generationTasks.ts": "9e88d0e71d822a03e28bc370805df48ff912eed81fc90142c6561fbf56816e5c",
});
const json = (res, status, value) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
};
function validateGenerationBaseline() {
  if (!generationScenario) return;
  if (!generationBaselineRoot || !generationBaselineManifest ||
      !inside(testRoot, generationBaselineRoot) ||
      !inside(testRoot, generationBaselineManifest)) {
    throw new Error("Generation baseline must remain inside the isolated test root");
  }
  const manifest = JSON.parse(readFileSync(generationBaselineManifest, "utf8"));
  if (manifest?.schemaVersion !== 1 ||
      manifest.head !== "955b9d2d89f76f8b91e71dd76cfb37ecad32cdc6" ||
      manifest.candidateHead !== process.env.UNBOUNDRY_SOURCE_HEAD ||
      Object.keys(manifest.files ?? {}).sort().join("\n") !== generationBaselineFiles.slice().sort().join("\n")) {
    throw new Error("Generation baseline manifest is not bound to the frozen source pair");
  }
  for (const file of generationBaselineFiles) {
    const expected = generationBaselineSha256[file];
    if (manifest.files[file] !== expected) {
      throw new Error(`Generation baseline SHA-256 mismatch in helper: ${file}`);
    }
    const path = join(generationBaselineRoot, file);
    const bytes = readFileSync(path);
    if (createHash("sha256").update(bytes).digest("hex") !== expected) {
      throw new Error(`Generation baseline bytes changed: ${file}`);
    }
  }
}
async function api(path, method = "GET", body, contentType) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "x-acceptance-setup": setupToken,
      ...(adminCookie ? { Cookie: adminCookie.split(";")[0] } : {}),
      ...(body ? { "Content-Type": contentType ?? (Buffer.isBuffer(body) ? "image/png" : "application/json") } : {}),
    },
    ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Acceptance setup API ${path}: HTTP ${response.status}`);
  return response;
}

const generationModelInputs = Object.freeze({
  audio: Object.freeze({
    configurationRevision: "a04100000000000000000001",
    id: "retry-ui-audio-model",
    providerDriver: "mureka",
    providerModelId: "mureka-9",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000001",
  }),
  image: Object.freeze({
    configurationRevision: "a04100000000000000000002",
    id: "retry-ui-image-model",
    providerDriver: "openrouter",
    providerModelId: "openai/gpt-image-2",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000002",
  }),
  text: Object.freeze({
    configurationRevision: "a04100000000000000000003",
    id: "retry-ui-text-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seed-2-0-lite-260428",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000003",
  }),
  video: Object.freeze({
    configurationRevision: "a04100000000000000000004",
    id: "retry-ui-video-model",
    providerDriver: "volcengine-ark",
    providerModelId: "doubao-seedance-2-0-mini-260615",
    releaseRevisionId: "a0410000-0000-4000-8000-000000000004",
  }),
});

const safeHtmlJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const generationStateLabels = Object.freeze({ running: "运行中", success: "成功" });

function generationJournalSnapshot() {
  if (!generationFixture) return undefined;
  return {
    schemaVersion: 1,
    scenario: "generation-status",
    canvasId: generationFixture.canvasId,
    phase: generationFixture.phase,
    builds: generationBuilds,
    counters: {
      statusReads: generationCounters.statusReads,
      detailReads: generationCounters.detailReads,
      generationDeletes: generationCounters.generationDeletes,
      maxInFlightDetailReads: generationCounters.maxInFlightDetailReads,
      generationPosts: generationCounters.generationPosts,
      syntheticProjectionPublications: generationCounters.syntheticProjectionWrites,
      canvasWrites: {
        browser: generationCounters.browserCanvasWrites,
        browserCommands: generationCounters.browserCanvasCommandWrites,
        control: generationCounters.controlCanvasWrites,
      },
    },
    tasks: [...generationTasks.values()].map((task) => ({
      id: task.id,
      phase: task.acceptancePhase,
      kind: task.kind,
      nodeId: task.nodeId,
      state: task.state,
      attempt: task.attempt,
      remainingFailures: task.fault.remainingFailures,
      continuous: task.fault.continuous,
      projectionPersisted: Boolean(task.projectionPersisted),
      generationInputKey: task.generationInputKey,
      generationOwnershipKey: task.generationOwnershipKey,
      publicTask: generationTaskPublic(task),
      projectedNodeData: task.state === "success" ? generationTaskResult(task) : generationNodeData(task.kind, "shared", task, task.identity, true),
    })),
    sentinels: generationFixture.sentinels,
    events: generationFixture.events.slice(-300),
  };
}

function persistGenerationJournal(event, details = {}) {
  if (!generationFixture || !generationJournalPath) return;
  generationFixture.events.push({ at: new Date().toISOString(), event, ...details });
  if (generationFixture.events.length > 1000) generationFixture.events.splice(0, generationFixture.events.length - 1000);
  writeFileSync(generationJournalPath, `${JSON.stringify(generationJournalSnapshot(), null, 2)}\n`, { mode: 0o600 });
}

function generationTaskPublic(task) {
  const base = { ...task };
  delete base.fault;
  delete base.projectionPersisted;
  delete base.acceptancePhase;
  delete base.identity;
  return base;
}

function generationStatusPayload() {
  if (!generationFixture) return { scenario: "generation-status", ready: false };
  return {
    scenario: "generation-status",
    ready,
    canvasId: generationFixture.canvasId,
    phase: generationFixture.phase,
    phases: generationPhases,
    projects,
    tasks: [...generationTasks.values()].map((task) => ({ ...generationTaskPublic(task), phase: task.acceptancePhase })),
    checks: generationChecks,
    observations: Object.fromEntries(generationObservations),
    serverTime: Date.now(),
    sentinels: generationFixture.sentinels,
    builds: generationBuilds,
    counters: {
      statusReads: generationCounters.statusReads,
      detailReads: generationCounters.detailReads,
      generationDeletes: generationCounters.generationDeletes,
      maxInFlightDetailReads: generationCounters.maxInFlightDetailReads,
      generationPosts: generationCounters.generationPosts,
      syntheticProjectionPublications: generationCounters.syntheticProjectionWrites,
      canvasWrites: {
        browser: generationCounters.browserCanvasWrites,
        browserCommands: generationCounters.browserCanvasCommandWrites,
        control: generationCounters.controlCanvasWrites,
      },
    },
    journalPath: generationJournalPath,
    syntheticOnly: true,
    taskStorage: "acceptance journal and API projection; not generation_tasks SQLite or Provider evidence",
    instructions: "先打开当前运行中节点完成初始GET，再在此页注入故障；持续失败恢复后重新检查。",
    expiresAt: expiresAt.toISOString(),
  };
}

async function readRequestJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString("utf8");
    if (raw.length > 1_000_000) throw new Error("Acceptance request body is too large");
  }
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Acceptance request body is invalid");
  return value;
}

function generationDocumentPut(document, source) {
  if (source === "control") generationCounters.controlCanvasWrites += 1;
  generationLastWriteSource = source;
  generationProjectionInFlight = source === "syntheticProjection";
  return api(`/api/canvas/${generationFixture.canvasId}`, "PUT", {
    revision: document.revision,
    observedRevision: document.revision,
    observedLoadToken: document.loadToken,
    saveAttemptId: randomUUID(),
    saveSequence: Number(document.revision ?? 0) + 1,
    saveSessionId: randomUUID(),
    viewport: document.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes: document.nodes,
    edges: document.edges,
  }).finally(() => {
    generationProjectionInFlight = false;
  });
}

function generationTaskResult(task) {
  const kind = task.kind;
  const resultUrl = task.resultUrl;
  const common = {
    [`${kind}Generating`]: false,
    [`${kind}GenerationTaskId`]: kind === "text" ? task.id : undefined,
    [`${kind}GenerationError`]: undefined,
    [`${kind}GenerationErrorCode`]: undefined,
    [`${kind}GenerationInputKey`]: undefined,
    [`${kind}GenerationModelConfigurationRevision`]: task.modelConfigurationRevision,
    [`${kind}GenerationModelReleaseRevision`]: task.modelReleaseRevision,
    [`${kind}GenerationOwnershipKey`]: undefined,
    [`${kind}GenerationRetryAllowed`]: undefined,
    [`${kind}GenerationRetryBlockCode`]: undefined,
    [`${kind}GenerationRetryBlockReason`]: undefined,
    groupRunSuccessInputFingerprint: task.generationInputKey,
    groupRunSuccessModelConfigurationRevision: task.modelConfigurationRevision,
    groupRunSuccessModelReleaseRevision: task.modelReleaseRevision,
    groupRunSuccessOwnershipKey: task.generationOwnershipKey,
    groupRunSuccessResultKey: kind === "text"
      ? JSON.stringify({ content: task.resultText, contentHtml: `<p>${task.resultText}</p>` })
      : resultUrl,
    groupRunSuccessTaskId: task.id,
    workflowExecutionRunId: undefined,
    ...(kind === "video"
      ? { videoGenerationModelInputContractFingerprint: task.modelInputContractFingerprint }
      : { [`${kind}GenerationContractFingerprint`]: task.modelInputContractFingerprint }),
  };
  if (kind === "text") return { ...common, content: task.resultText, contentHtml: `<p>${task.resultText}</p>`, textGenerationTaskId: task.id };
  return {
    ...common,
    assetId: task.assetId,
    inputState: "ready",
    inputStateReason: undefined,
    mediaByteSize: task.resultMedia.byteSize,
    mediaContentType: task.mediaContentType,
    mediaDurationSeconds: task.resultMedia.durationSeconds,
    mediaHeight: task.resultMedia.mediaHeight,
    mediaMetadataSource: "server",
    mediaMetadataStatus: "ready",
    mediaStorageBackend: "local",
    mediaWidth: task.resultMedia.mediaWidth,
    [`${kind}Src`]: resultUrl,
    ...(kind === "image" ? { imageGeneratedSuccess: true } : {}),
    ...(kind === "audio" ? { audioGeneratedResult: true, audioResultChoices: [{ ...task.resultMedia, assetId: task.assetId, url: resultUrl, role: "primary" }] } : {}),
  };
}

async function persistGenerationProjection(task) {
  if (task.projectionPersisted || task.state !== "success") return;
  // Model the server publication in this synthetic journal. Never submit a
  // client Canvas PUT to bypass the real authoritative projection contract.
  task.canvasProjectionState = "applied";
  task.projectionPersisted = true;
  generationCounters.syntheticProjectionWrites += 1;
  persistGenerationJournal("syntheticProjection", { taskId: task.id, nodeId: task.nodeId, state: task.state });
}

function generationFaultResponse(task) {
  if (task.fault.continuous) return { status: 503, code: "ACCEPTANCE_CONTINUOUS_FAILURE", message: "模拟持续失败：点击恢复后重新检查" };
  if (task.fault.remainingFailures > 0) {
    task.fault.remainingFailures -= 1;
    const status = task.fault.statuses.shift() ?? 503;
    return { status, code: "ACCEPTANCE_TRANSIENT_STATUS", message: `模拟 ${status} 状态查询故障` };
  }
  return undefined;
}

async function generationTaskResponse(task) {
  const observation = generationObservations.get(task.id) ?? { successfulReads: 0, failedReads: 0, lastSuccessAt: 0 };
  generationObservations.set(task.id, observation);
  generationCounters.detailReads += 1;
  generationDetailReadsInFlight += 1;
  task.activeReads = (task.activeReads ?? 0) + 1;
  task.maxInFlightReads = Math.max(task.maxInFlightReads ?? 0, task.activeReads);
  generationCounters.maxInFlightDetailReads = Math.max(generationCounters.maxInFlightDetailReads, generationDetailReadsInFlight);
  persistGenerationJournal("detailReadStart", { taskId: task.id, state: task.state, inFlight: generationDetailReadsInFlight, taskInFlight: task.activeReads });
  try {
    if (generationDelayNextTaskId === task.id && generationDelayNextMs > 0) {
      const delayMs = generationDelayNextMs;
      generationDelayNextTaskId = "";
      generationDelayNextMs = 0;
      persistGenerationJournal("detailReadDelayed", { taskId: task.id, delayMs });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
    const failure = generationFaultResponse(task);
    if (failure) {
      observation.failedReads += 1;
      persistGenerationJournal("detailReadFailure", { taskId: task.id, status: failure.status });
      return failure;
    }
    if (task.state === "running" && task.fault.terminalOnRecovery) {
      task.state = "success";
      task.updatedAt = new Date().toISOString();
      await persistGenerationProjection(task);
      persistGenerationJournal("taskSuccess", { taskId: task.id, projectionPersisted: true });
    }
    persistGenerationJournal("detailReadEnd", { taskId: task.id, state: task.state, inFlight: generationDetailReadsInFlight });
    observation.successfulReads += 1;
    observation.lastSuccessAt = Date.now();
    return { status: 200, task: generationTaskPublic(task) };
  } finally {
    generationDetailReadsInFlight -= 1;
    task.activeReads -= 1;
    persistGenerationJournal("detailReadClosed", { taskId: task.id, inFlight: generationDetailReadsInFlight, taskInFlight: task.activeReads });
  }
}

function generationPhaseNodeId(phase, kind) {
  return `generation-status-${kind}`;
}

function generationTaskId(phase, kind) {
  return `generation-status-${kind}`;
}

function generationResultFor(kind, id) {
  if (kind === "text") return { resultText: `本地验收文本结果 ${id}`, resultUrl: "" };
  const route = kind === "image" ? "assets" : kind === "video" ? "video-assets" : "audio-assets";
  const assetId = `${id}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`;
  return {
    assetId,
    mediaContentType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
    resultUrl: `/api/${route}/${assetId}`,
    resultText: "",
  };
}

function generationNodeData(kind, phase, task, identity, active) {
  const input = generationModelInputs[kind];
  const prompt = `${kind} 原始提示词`;
  const parameters = generationRuntime.defaultParameterValues(generationRuntime.schemas[kind]);
  const data = {
    label: kind[0].toUpperCase() + kind.slice(1),
    title: `${({text: "文字", image: "图片", video: "视频", audio: "音频"})[kind]}查询验收`,
    [`${kind}ModelId`]: input.id,
    [`${kind}Parameters`]: parameters,
    [`${kind}Prompt`]: prompt,
    ...(kind !== "text" ? { [`${kind}PromptReady`]: true } : { content: "" }),
  };
  if (identity) {
    data[`${kind}GenerationInputKey`] = identity.generationInputKey;
    data[`${kind}GenerationModelConfigurationRevision`] = identity.modelConfigurationRevision;
    data[`${kind}GenerationModelReleaseRevision`] = identity.modelReleaseRevision;
    data[`${kind}GenerationOwnershipKey`] = identity.generationOwnershipKey;
    data[`${kind}GenerationTaskId`] = active ? task.id : undefined;
    data[`${kind}Generating`] = Boolean(active);
    if (kind === "video") data.videoGenerationModelInputContractFingerprint = identity.modelInputContractFingerprint;
    else data[`${kind}GenerationContractFingerprint`] = identity.modelInputContractFingerprint;
  }
  return data;
}

function generationCanvasNodes() {
  const nodes = [];
  let index = 0;
  for (const kind of generationKinds) {
    const task = generationTasks.get(generationTaskId("shared", kind));
    nodes.push({
      id: generationPhaseNodeId("shared", kind),
      type: kind,
      position: { x: 100 + (index % 2) * 520, y: 90 + Math.floor(index / 2) * 460 },
      data: generationNodeData(kind, "shared", task, task?.identity, true),
      style: { width: kind === "image" ? 300 : 260, height: kind === "image" ? 190 : 220 },
    });
    index += 1;
  }
  return nodes;
}

function generationBuildDigest(root) {
  const hash = createHash("sha256");
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const details = statSync(absolute);
      const path = prefix ? `${prefix}/${name}` : name;
      if (details.isDirectory()) walk(absolute, path);
      else {
        hash.update(path);
        hash.update("\0");
        hash.update(readFileSync(absolute));
        hash.update("\0");
      }
    }
  };
  walk(root);
  return hash.digest("hex");
}

function generationBundleManifest(root) {
  const files = {};
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const details = statSync(absolute);
      const path = prefix ? `${prefix}/${name}` : name;
      if (details.isDirectory()) walk(absolute, path);
      else files[path] = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    }
  };
  walk(root);
  return files;
}

function generationSourcePlugin(variant, moduleRoot) {
  const hits = new Set();
  const files = new Map(generationBaselineFiles.map((file) => [
    realpathSync(resolve(sourceRoot, file)),
    readFileSync(join(moduleRoot, file), "utf8"),
  ]));
  return {
    name: `generation-status-${variant}-source-pair`,
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "generation-acceptance-build", content: JSON.stringify({ variant, sourceHashes: Object.fromEntries(generationBaselineFiles.map((file) => [file, createHash("sha256").update(readFileSync(join(moduleRoot, file))).digest("hex")])) }) }, injectTo: "head" }];
    },
    enforce: "pre",
    resolveId(id, importer) {
      const importerPath = importer?.split("?", 1)[0];
      const candidate = importerPath && id.startsWith(".")
        ? resolve(dirname(importerPath), id)
        : resolve(sourceRoot, id.split("?", 1)[0]);
      const withExtension = candidate.endsWith(".ts") ? candidate : `${candidate}.ts`;
      return files.has(candidate) ? candidate : files.has(withExtension) ? withExtension : null;
    },
    load(id) {
      const normalized = id.split("?", 1)[0];
      const source = files.get(normalized);
      if (source === undefined) return null;
      hits.add(normalized);
      return source;
    },
    assertHits() {
      const expected = [...files.keys()].sort();
      const actual = [...hits].sort();
      if (expected.join("\n") !== actual.join("\n")) {
        throw new Error(`${variant} Vite build did not load both status modules: ${actual.join(",")}`);
      }
      return actual;
    },
  };
}

async function buildGenerationClients() {
  const candidateRoot = join(testRoot, "generation-client-candidate");
  const baselineRoot = join(testRoot, "generation-client-baseline");
  mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
  mkdirSync(baselineRoot, { recursive: true, mode: 0o700 });
  const buildCommon = {
    configFile: join(sourceRoot, "vite.config.ts"),
    root: join(sourceRoot, "client"),
    build: { emptyOutDir: true, manifest: false },
  };
  const candidatePlugin = generationSourcePlugin("candidate", sourceRoot);
  await viteBuild({
    ...buildCommon,
    plugins: [candidatePlugin],
    base: "/__acceptance/client/candidate/",
    build: { ...buildCommon.build, outDir: candidateRoot },
  });
  const candidateHits = candidatePlugin.assertHits();
  const baselinePlugin = generationSourcePlugin("baseline", generationBaselineRoot);
  await viteBuild({
    ...buildCommon,
    base: "/__acceptance/client/baseline/",
    plugins: [baselinePlugin],
    build: { ...buildCommon.build, outDir: baselineRoot },
  });
  const baselineHits = baselinePlugin.assertHits();
  const candidateManifest = generationBundleManifest(candidateRoot);
  const baselineManifest = generationBundleManifest(baselineRoot);
  const candidateSource = Object.fromEntries(generationBaselineFiles.map((file) => [
    file,
    createHash("sha256").update(readFileSync(join(sourceRoot, file))).digest("hex"),
  ]));
  for (const file of generationBaselineFiles) {
    if (candidateSource[file] === generationBaselineSha256[file]) throw new Error(`Candidate module is unchanged: ${file}`);
  }
  return Object.freeze({
    candidateLoaded: candidateHits,
    candidate: { root: realpathSync(candidateRoot), sha256: generationBuildDigest(candidateRoot), manifest: candidateManifest },
    baseline: { root: realpathSync(baselineRoot), sha256: generationBuildDigest(baselineRoot), manifest: baselineManifest },
    candidateSource,
    baselineSource: Object.fromEntries(generationBaselineFiles.map((file) => [file, generationBaselineSha256[file]])),
    baselineReplaced: baselineHits,
  });
}

function generationStaticPath(urlPath) {
  const match = /^\/__acceptance\/client\/(candidate|baseline)(?:\/(.*))?$/.exec(urlPath);
  if (!match || !generationBuilds) return undefined;
  const root = generationBuilds[match[1]].root;
  const requested = match[2] || "index.html";
  const absolute = resolve(root, requested);
  if (!inside(root, absolute) || !existsSync(absolute) || !statSync(absolute).isFile()) return undefined;
  return absolute;
}

function generationContentType(path) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function generationGuideHtmlSimple() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地验收 · 按顺序检查三项</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f5f5;color:#242424;font:16px/1.7 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:860px;margin:30px auto;padding:0 22px}h1{font-size:28px;margin:5px 0}h2{font-size:20px;margin:0 0 8px}p{margin:9px 0}section{background:#fff;border:1px solid #ddd;border-radius:14px;padding:22px;margin:18px 0}.muted{color:#666;font-size:14px}.expect{padding:12px;background:#f3f6f4;border-radius:8px}.feedback{font-weight:600;min-height:28px}.error{color:#9e2323;background:#fff0f0;padding:14px;border-radius:8px}button,a{font:inherit}button{border:1px solid #aaa;border-radius:8px;background:#fff;color:#222;padding:9px 16px;margin:6px 5px 6px 0;cursor:pointer}button.primary{background:#222;color:#fff;border-color:#222}button:disabled{background:#eee;color:#777;border-color:#ddd;cursor:default}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #447daa;outline-offset:3px}details{margin:22px 0}summary{cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.card{border:1px solid #ddd;border-radius:8px;padding:12px}.card button{font-size:14px;padding:6px 9px}code{font-size:12px;overflow-wrap:anywhere}a{color:#285b91}
</style>
<main><p class="muted">仅本地 · 使用模拟任务和测试素材 · 不产生付费生成 · 尚未上线</p><h1>这次只检查三件事</h1><p>检查生成过程中连接出问题时，结果还能不能正常出现。<b>按下面 1 → 2 → 3 的顺序操作。</b></p>
<div id="error" class="error" role="alert" hidden><span id="error-text"></span> <button id="reconnect">重新连接验收页</button></div>
<section><h2>先打开测试画布</h2><p>点击下方按钮，打开黑色画布，停留几秒，再切回本页。后面只使用这两个标签页。</p><button id="canvas-link" class="primary">打开测试画布</button><p id="connection" class="muted" role="status">正在连接验收服务…</p></section>
<section id="check-auto"><h2>1. 短暂中断后，文字能自动出现吗？</h2><p>点下方按钮，再切到黑色画布，找到左上方的「文字查询验收」。等约 5～10 秒，期间不用点“重新检查”。</p><button id="auto" class="primary" data-check="auto" disabled>开始第 1 项：文字自动恢复</button><p id="auto-state" class="feedback" role="status">等待测试画布连接。</p><p class="expect"><b>你要看：</b>文字框里自动出现“本地验收文本结果…”，没有停在查询失败提示。出现了就可以继续第 2 项。</p></section>
<section id="check-manual"><h2>2. 持续中断后，图片能手动找回来吗？</h2><p>先点“开始第 2 项”，再到画布点击右上方的「图片查询验收」，等约 5～10 秒，看到查询失败提示和“重新检查任务状态”按钮。</p><button id="manual" class="primary" data-check="manual" disabled>开始第 2 项：让图片查询中断</button><p>看到提示后，切回本页点“恢复连接”，再到画布点图片节点的“重新检查任务状态”。</p><button id="resume" data-check="resume" disabled>恢复连接，准备手动检查</button><p id="manual-state" class="feedback" role="status">请先完成第 1 项。</p><p class="expect"><b>你要看：</b>先出现查询失败提示；按上面的步骤重新检查后，图片出现在原来的图片框里。</p></section>
<section id="check-media"><h2>3. 刷新后，四种结果还在吗？</h2><p>点下方按钮，再到画布等待下方的视频、音频出现播放控件。然后点浏览器的刷新按钮。</p><button id="media" class="primary" data-check="media" disabled>开始第 3 项：显示视频和音频</button><p id="media-state" class="feedback" role="status">请先完成第 2 项。</p><p class="expect"><b>你要看：</b>刷新后，文字和图片还在原处；视频和音频仍有播放控件，点击播放可用，没有空白或“素材不存在”。</p></section>
<p><b>检查完，在对话里回复“1 通过，2 通过，3 通过”；哪一步不符合，就告诉我那一步。</b></p><p class="muted">本页显示的是测试进度，是否符合你的实际体验由你确认。已完成的节点不会重新变回生成中。</p>
<details><summary>工程检查工具（验收不需要操作）</summary><section><div id="phase"></div><p><a href="/__acceptance/generation-entry?variant=candidate" target="_blank" rel="noopener">打开 candidate client</a> · <a href="/__acceptance/generation-entry?variant=baseline" target="_blank" rel="noopener">打开完整 baseline client</a></p><p class="muted">切换工程版本前先关闭旧画布，避免多个观察页。</p><button data-phase="candidate">candidate phase</button><button data-phase="baseline">baseline phase</button><button data-phase="re-enabled">re-enabled phase</button><div id="tasks" class="grid"></div><p id="evidence" class="muted"></p></section></details>
<p id="expiry" class="muted"></p><button id="finish">结束本次验收</button></main>
<script>
const labels={text:'文字',image:'图片',video:'视频',audio:'音频'};
const byId=(id)=>document.getElementById(id);
const esc=(value)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
let latest, busy=false, stopped=false, unavailable=false, timer, revision=0, canvasWindow;
const controllers=new Set();
async function request(path,body){
  const controller=new AbortController();controllers.add(controller);
  const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch(path,{signal:controller.signal,cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'验收服务返回错误，请重新连接。');
    return data;
  }catch(error){
    if(error.name==='AbortError'||error instanceof TypeError)throw Error('验收服务未连接。请点“重新连接验收页”；仍无法连接时回对话告诉我。');
    throw error;
  }finally{clearTimeout(timeout);controllers.delete(controller);}
}
function showError(error){byId('error-text').textContent=error.message;byId('error').hidden=false;}
function disableControls(){document.querySelectorAll('button[data-check],button[data-phase],button[data-action]').forEach(button=>button.disabled=true);}
function render(data){
  latest=data;
  const task=(kind)=>data.tasks.find(item=>item.kind===kind);
  const done=(kind)=>task(kind)?.state==='success';
  const observation=(kind)=>data.observations?.[task(kind)?.id]||{};
  const connected=(kind)=>observation(kind).successfulReads>=2&&data.serverTime-observation(kind).lastSuccessAt<=8000;
  const checks=data.checks||{};
  const autoFinished=checks.auto==='started'&&done('text')&&observation('text').failedReads>=2;
  const manualFinished=checks.manual==='restoring'&&done('image')&&observation('image').failedReads>=3;
  byId('connection').textContent=Object.keys(labels).every(done)?'四种结果已返回，无需再次中断。请按各项标准核对画布。':Object.keys(labels).some(connected)?'已连接测试画布。现在从第 1 项开始；后面按每张卡片的提示继续。':'尚未收到画布的正常查询。请打开测试画布停留几秒，再回本页。';
  byId('auto').disabled=busy||unavailable||done('text')||checks.auto!=='idle'||!connected('text');
  byId('auto').textContent=done('text')?'文字结果已返回':checks.auto==='started'?'第 1 项已开始':'开始第 1 项：文字自动恢复';
  byId('auto-state').textContent=done('text')?'文字结果已返回。请到画布确认文字确实出现，再继续第 2 项。':checks.auto==='started'?'正在等待文字自动恢复。请切到画布等待，约 5～10 秒；若停在查询失败，告诉我第 1 项未通过。':connected('text')?'可以开始。点击上方按钮，然后到画布看文字。':'请先打开测试画布。';
  byId('manual').disabled=busy||unavailable||!autoFinished||done('image')||checks.manual!=='idle'||!connected('image');
  byId('manual').textContent=done('image')?'图片结果已返回':checks.manual!=='idle'?'第 2 项已开始':'开始第 2 项：让图片查询中断';
  byId('resume').disabled=busy||unavailable||done('image')||checks.manual!=='interrupted'||observation('image').failedReads<3;
  byId('manual-state').textContent=done('image')?'图片结果已返回。请到画布确认图片在原节点里，再继续第 3 项。':checks.manual==='restoring'?'连接已恢复，图片还在等待你操作。请切到画布，点击图片节点的“重新检查任务状态”。':checks.manual==='interrupted'?(observation('image').failedReads>=3?'已模拟连续中断。请先到画布点击图片节点，确认出现查询失败提示，再回来点“恢复连接”。':'正在模拟中断。请到画布点击图片节点，等待查询失败提示出现。'):autoFinished?'可以开始第 2 项。':'请先按步骤完成第 1 项。';
  byId('media').disabled=busy||unavailable||!autoFinished||!manualFinished||checks.media!=='idle'||!connected('video')||!connected('audio');
  byId('media').textContent=done('video')&&done('audio')?'视频和音频结果已返回':checks.media==='started'?'第 3 项已开始':'开始第 3 项：显示视频和音频';
  byId('media-state').textContent=done('video')&&done('audio')?'四种结果都已返回。现在刷新黑色画布，检查结果保留及播放。':checks.media==='started'?'已准备视频和音频，等待画布读取。请切到画布，等播放控件出现后再刷新。':autoFinished&&manualFinished?'可以开始第 3 项。':'请先按步骤完成前两项。';
  if(done('text')&&!autoFinished)byId('auto-state').textContent='文字已由工程工具完成，本项自动恢复尚未检查。请重新启动验收环境。';
  if(done('image')&&!manualFinished)byId('manual-state').textContent='图片已由工程工具完成，本项手动恢复尚未检查。请重新启动验收环境。';
  if(checks.media!=='started'&&done('video')&&done('audio'))byId('media-state').textContent='视频和音频已由工程工具完成，请按前两项提示继续；需要重做时重新启动验收环境。';
  byId('phase').textContent='当前 phase：'+data.phase+'；Canvas：'+data.canvasId;
  if(!byId('tasks').children.length){byId('tasks').innerHTML=data.tasks.map(item=>'<div class="card"><b>'+labels[item.kind]+'</b><p id="technical-'+esc(item.kind)+'"></p>'+[['plan1','短暂中断 ×1'],['plan2','短暂中断 ×2'],['plan3','短暂中断 ×3'],['continuous','持续中断'],['delay','下一次查询延迟3秒'],['restore','恢复查询'],['complete','显示模拟结果']].map(([action,label])=>'<button data-action="'+action+'" data-id="'+esc(item.id)+'">'+label+'</button>').join('')+'</div>').join('');}
  for(const item of data.tasks){byId('technical-'+item.kind).textContent=item.id+' · '+(item.state==='success'?'已完成，不能再中断':'运行中');}
  document.querySelectorAll('button[data-action]').forEach(button=>button.disabled=busy||unavailable||data.tasks.find(item=>item.id===button.dataset.id)?.state!=='running');
  document.querySelectorAll('button[data-phase]').forEach(button=>button.disabled=busy||unavailable);
  byId('evidence').textContent='detail GET '+data.counters.detailReads+'；生成 POST '+data.counters.generationPosts+' / DELETE '+data.counters.generationDeletes+'；Canvas 浏览器写入 '+data.counters.canvasWrites.browser+'；journal '+data.journalPath+'。仅合成任务和投影，不是真实 Provider 证据。';
  byId('expiry').textContent='临时验收页面开放至 '+new Date(data.expiresAt).toLocaleTimeString('zh-CN')+'。结束后可双击“打开状态查询验收.command”重新准备测试数据。';
}
function schedule(){clearTimeout(timer);if(!stopped&&!unavailable)timer=setTimeout(refresh,1000);}
async function refresh(){
  if(stopped)return;if(busy){schedule();return;}
  const token=++revision;
  try{const data=await request('/__acceptance/generation/status');if(token!==revision||stopped)return;unavailable=false;render(data);}
  catch(error){if(token!==revision||stopped)return;unavailable=true;disableControls();showError(error);}
  finally{schedule();}
}
byId('canvas-link').onclick=()=>{if(canvasWindow&&!canvasWindow.closed){canvasWindow.focus();return;}canvasWindow=window.open('/__acceptance/generation-entry?variant=candidate','unboundry-status-query-canvas');if(!canvasWindow)showError(Error('浏览器没有打开画布，请允许本地页面打开测试标签后再试。'));};
byId('reconnect').onclick=()=>{byId('error').hidden=true;unavailable=false;refresh();};
document.addEventListener('click',async(event)=>{
  const button=event.target.closest('button');
  if(!button||button.disabled||busy||['canvas-link','reconnect'].includes(button.id))return;
  busy=true;const actionToken=++revision;clearTimeout(timer);disableControls();byId('error').hidden=true;
  try{
    if(button.id==='finish'){await request('/__acceptance/stop',{});stopped=true;document.body.textContent='本次验收已结束。可以关闭测试标签页。';return;}
    if(button.dataset.check){const data=await request('/__acceptance/generation/check',{action:button.dataset.check});if(stopped||actionToken!==revision)return;render(data);}
    else if(button.dataset.phase){await request('/__acceptance/generation/activate',{phase:button.dataset.phase});}
    else if(button.dataset.action){const action=button.dataset.action;await request('/__acceptance/generation/'+(action.startsWith('plan')||action==='continuous'?'plan':action),{taskId:button.dataset.id,...(action.startsWith('plan')?{failures:Number(action.slice(-1))}:action==='continuous'?{continuous:true}:{})});}
  }catch(error){if(!stopped&&actionToken===revision)showError(error);}
  finally{busy=false;if(latest&&!stopped)render(latest);if(!stopped)await refresh();}
});
window.addEventListener('pageshow',(event)=>{if(event.persisted){stopped=false;unavailable=false;refresh();}});
window.addEventListener('pagehide',()=>{stopped=true;++revision;clearTimeout(timer);controllers.forEach(controller=>controller.abort());});
refresh();
</script></html>`;
}

async function initializeGenerationFixture(canvasId) {
  validateGenerationBaseline();
  generationRuntime = {};
  const moduleUrl = (path) => `/@fs/${path.split(sep).join("/")}`;
  const modelParameters = await server.ssrLoadModule(moduleUrl(join(sourceRoot, "types/modelParameters.ts")));
  const workflow = await server.ssrLoadModule(moduleUrl(join(sourceRoot, "client/src/generation/workflowNodeExecutors.ts")));
  generationRuntime.defaultParameterValues = modelParameters.defaultParameterValues;
  generationRuntime.knownModelParameterSchema = modelParameters.knownModelParameterSchema;
  generationRuntime.currentWorkflowGenerationBinding = workflow.currentWorkflowGenerationBinding;
  generationRuntime.schemas = Object.fromEntries(generationKinds.map((kind) => [
    kind,
    modelParameters.knownModelParameterSchema({
      capability: kind,
      providerDriver: generationModelInputs[kind].providerDriver,
      providerModelId: generationModelInputs[kind].providerModelId,
    }),
  ]));
  const models = Object.fromEntries(generationKinds.map((kind) => [kind, [{
    capability: kind,
    displayName: `Retry UI ${kind}`,
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
    ...generationModelInputs[kind],
    isDefault: true,
    parameterSchema: generationRuntime.schemas[kind],
  }]]));
  const fixtureNodes = generationKinds.map((kind) => ({
    id: generationPhaseNodeId("shared", kind),
    type: kind,
    position: { x: 80, y: 80 },
    data: generationNodeData(kind, "shared", undefined, undefined, false),
    style: { width: 260, height: 220 },
  }));
  const graph = {
    apply: () => ({ status: "rejected" }),
    snapshot: () => ({ edges: [], nodes: fixtureNodes }),
  };
  for (const kind of generationKinds) {
    const node = fixtureNodes.find((candidate) => candidate.id === generationPhaseNodeId("shared", kind));
    const binding = generationRuntime.currentWorkflowGenerationBinding({
      context: { canvasId, graph, isFixture: true, modelCatalog: { models, status: "ready" } },
      kind,
      nodeId: node.id,
    });
    if (!binding) throw new Error(`Could not derive current generation binding for ${kind}`);
    const identity = {
      generationIdentityVersion: 2,
      generationInputKey: binding.inputFingerprint,
      generationOwnershipKey: binding.ownershipKey,
      modelConfigurationRevision: binding.modelConfigurationRevision,
      modelInputContractFingerprint: binding.inputContractFingerprint,
      modelReleaseRevision: binding.modelReleaseRevision,
    };
    const id = generationTaskId("shared", kind);
    const result = generationResultFor(kind, id);
    const mediaBytes = kind === "text" ? undefined : readFileSync(kind === "image"
      ? join(sourceRoot, "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png")
      : join(sourceRoot, "client/public/fixtures", kind === "video" ? "video-success.mp4" : "audio-success.mp3"));
    // Use the real local upload/registry contract so ordinary Canvas saves can
    // validate these fixtures. Synthetic task status is still helper-only.
    let registeredMedia;
    if (mediaBytes) {
      await api(result.resultUrl, "POST", mediaBytes, result.mediaContentType);
      registeredMedia = await (await api(`/api/media-metadata/${kind}/${result.assetId}`)).json();
      const storedBytes = Buffer.from(await (await api(result.resultUrl)).arrayBuffer());
      const checksumSha256 = createHash("sha256").update(storedBytes).digest("hex");
      if (checksumSha256 !== createHash("sha256").update(mediaBytes).digest("hex") ||
          registeredMedia.storageBackend !== "local" || registeredMedia.byteSize !== mediaBytes.length) {
        throw new Error("Acceptance media was not registered as the exact local fixture");
      }
      registeredMedia = { ...registeredMedia, checksumSha256 };
    }
    generationTasks.set(id, {
        ...identity,
        ...result,
        ...(result.assetId ? {
          resultAssetId: result.assetId,
          resultMedia: registeredMedia,
          resultOutputs: [{
            assetId: result.assetId,
            media: registeredMedia,
            role: "primary",
            url: result.resultUrl,
          }],
        } : {}),
        attempt: 1,
        activeReads: 0,
        canvasId,
        costCurrency: "CNY",
        createdAt: new Date().toISOString(),
        errorCode: undefined,
        errorMessage: undefined,
        fixtureScopeId: "",
        id,
        kind,
        model: generationModelInputs[kind].id,
        nodeId: generationPhaseNodeId("shared", kind),
        prompt: `${kind} 原始提示词`,
        retryAllowed: false,
        state: "running",
        updatedAt: new Date().toISOString(),
        acceptancePhase: "shared",
        maxInFlightReads: 0,
        identity,
        fault: { continuous: false, remainingFailures: 0, statuses: [], terminalOnRecovery: false },
      });
  }
  const sentinels = generationKinds.map((kind) => ({
    id: `generation-status-sentinel-${kind}`,
    kind,
    state: "success",
    binding: `sentinel-binding-${kind}`,
  }));
  generationFixture = { canvasId, events: [], modelCatalog: { generationEnabled: true, models: generationKinds.flatMap((kind) => models[kind]) }, phase: "candidate", sentinels };
  generationBuilds = await buildGenerationClients();
  generationJournalPath = join(dataRoot, "generation-status-acceptance-journal.json");
  persistGenerationJournal("fixtureReady", { canvasId, taskCount: generationTasks.size, sentinelCount: sentinels.length });
  return models;
}

async function activateGenerationPhase(phase) {
  if (!generationPhases.includes(phase)) throw new Error("未知验收 phase");
  generationFixture.phase = phase;
  persistGenerationJournal("phaseSwitch", { phase, canvasReset: false, taskIds: [...generationTasks.keys()] });
  return generationStatusPayload();
}

class AcceptanceControlError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function runningGenerationTask(taskId) {
  const task = generationTasks.get(taskId);
  if (!task) throw new AcceptanceControlError("找不到这个测试节点，请刷新验收说明页。", "ACCEPTANCE_TASK_NOT_FOUND", 404);
  if (task.state !== "running") throw new AcceptanceControlError("这个节点已完成，不能再模拟中断。结果已保留，请继续下一项检查。", "ACCEPTANCE_TASK_COMPLETED");
  return task;
}

function requireObservedGenerationTask(taskId) {
  const task = runningGenerationTask(taskId);
  const observation = generationObservations.get(taskId);
  // At least the identity GET and one watch GET must have reached the helper.
  if (!observation || observation.successfulReads < 2 || Date.now() - observation.lastSuccessAt > 8000) {
    throw new AcceptanceControlError("请先打开测试画布，停留几秒，再回到这里开始检查。", "ACCEPTANCE_CANVAS_NOT_READY");
  }
  return task;
}

function armGenerationFault({ taskId, failures, continuous }) {
  const task = runningGenerationTask(taskId);
  if (continuous) {
    task.fault = { continuous: true, remainingFailures: 0, statuses: [], terminalOnRecovery: false };
  } else {
    const count = Number(failures);
    if (!Number.isInteger(count) || count < 1 || count > 3) throw new AcceptanceControlError("请选择中断 1、2 或 3 次。", "ACCEPTANCE_INVALID_FAILURES", 400);
    task.fault = {
      continuous: false,
      remainingFailures: count,
      statuses: Array.from({ length: count }, (_, index) => index === 0 ? 500 : 503),
      terminalOnRecovery: false,
    };
  }
  persistGenerationJournal("faultPlan", { taskId, failures: task.fault.remainingFailures, continuous: task.fault.continuous });
  return generationTaskPublic(task);
}

function restoreGenerationFault(taskId) {
  const task = runningGenerationTask(taskId);
  task.fault.continuous = false;
  task.fault.remainingFailures = 0;
  task.fault.statuses = [];
  task.fault.terminalOnRecovery = false;
  persistGenerationJournal("faultRestore", { taskId });
  return generationTaskPublic(task);
}

function completeGenerationTask(taskId) {
  const task = runningGenerationTask(taskId);
  task.fault.continuous = false;
  task.fault.remainingFailures = 0;
  task.fault.statuses = [];
  task.fault.terminalOnRecovery = true;
  persistGenerationJournal("completePlan", { taskId });
  return generationTaskPublic(task);
}

function delayNextGenerationTask(taskId) {
  const task = runningGenerationTask(taskId);
  generationDelayNextTaskId = taskId;
  generationDelayNextMs = 3000;
  persistGenerationJournal("delayPlan", { taskId, delayMs: generationDelayNextMs });
  return generationTaskPublic(task);
}

function runGenerationCheck(action) {
  const id = (kind) => generationTaskId("shared", kind);
  const done = (kind) => generationTasks.get(id(kind))?.state === "success";
  if (action === "auto") {
    if (generationChecks.auto !== "idle") throw new AcceptanceControlError("第一项已经开始，请回画布查看文字结果。", "ACCEPTANCE_CHECK_STARTED");
    const task = requireObservedGenerationTask(id("text"));
    armGenerationFault({ taskId: task.id, failures: 2 });
    generationObservations.get(task.id).failedReads = 0;
    task.fault.terminalOnRecovery = true;
    generationChecks.auto = "started";
  } else if (action === "manual") {
    if (generationChecks.auto !== "started" || !done("text") || (generationObservations.get(id("text"))?.failedReads ?? 0) < 2) {
      throw new AcceptanceControlError("请先完成第一项文字自动恢复检查。直接显示模拟结果不算完成本项。", "ACCEPTANCE_PREVIOUS_CHECK");
    }
    if (generationChecks.manual !== "idle") throw new AcceptanceControlError("第二项已经开始，请按卡片中的下一步继续。", "ACCEPTANCE_CHECK_STARTED");
    const task = requireObservedGenerationTask(id("image"));
    armGenerationFault({ taskId: task.id, continuous: true });
    generationObservations.get(task.id).failedReads = 0;
    generationChecks.manual = "interrupted";
  } else if (action === "resume") {
    if (generationChecks.manual !== "interrupted" || (generationObservations.get(id("image"))?.failedReads ?? 0) < 3) {
      throw new AcceptanceControlError("请先到画布点击“图片查询验收”，等查询失败提示出现后再恢复连接。", "ACCEPTANCE_WAIT_FOR_PAUSE");
    }
    completeGenerationTask(id("image"));
    generationChecks.manual = "restoring";
  } else if (action === "media") {
    if (generationChecks.auto !== "started" || generationChecks.manual !== "restoring" || !done("text") || !done("image") ||
        (generationObservations.get(id("text"))?.failedReads ?? 0) < 2 || (generationObservations.get(id("image"))?.failedReads ?? 0) < 3) {
      throw new AcceptanceControlError("请先完成前两项中断与恢复检查，再检查刷新后的结果。", "ACCEPTANCE_PREVIOUS_CHECK");
    }
    if (generationChecks.media !== "idle") throw new AcceptanceControlError("第三项已经开始，请到画布查看并刷新。", "ACCEPTANCE_CHECK_STARTED");
    // Validate both before either mutation; no partial completion on rejection.
    for (const kind of ["video", "audio"]) requireObservedGenerationTask(id(kind));
    for (const kind of ["video", "audio"]) completeGenerationTask(id(kind));
    generationChecks.media = "started";
  } else {
    throw new AcceptanceControlError("这个检查按钮已失效，请刷新验收说明页。", "ACCEPTANCE_UNKNOWN_CHECK", 400);
  }
  persistGenerationJournal("guidedCheck", { action, checks: { ...generationChecks } });
  return generationStatusPayload();
}

const guide = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剩余修复 · 本地验收</title>
<style>body{margin:0;background:#f5f5f5;color:#242424;font:16px/1.65 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:900px;margin:40px auto;padding:0 24px}h1{font-size:30px;margin:8px 0}h2{font-size:19px}p{color:#565656}section{background:white;border:1px solid #ddd;border-radius:14px;padding:22px;margin:18px 0}button,a.primary{font:inherit;display:inline-block;border:1px solid #aaa;border-radius:8px;padding:9px 16px;background:white;color:#222;cursor:pointer;text-decoration:none}a.primary{background:#222;color:#fff;border-color:#222}.badge{font-size:13px;letter-spacing:1px}li{margin:10px 0}table{width:100%;border-collapse:collapse;text-align:left}td,th{padding:10px;border-bottom:1px solid #eee;overflow-wrap:anywhere}.tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}#result{overflow:auto}small{color:#777}button:focus-visible,a:focus-visible{outline:3px solid #555;outline-offset:3px}</style>
<main><span class="badge">本地验收 · 独立测试数据</span><h1>只需复验图片菜单遮挡</h1><p>你已确认其他项目通过。这次只检查图片顶部「浏览全部」菜单是否完整显示、能够点击。这里使用独立测试数据，修复尚未上线。</p>
<section><h2>本次检查这一个问题</h2><ol><li>打开测试画布，点击分组内的「图片裁剪与连线」，让顶部工具栏和下方输入框都出现。</li><li>点击顶部三点按钮「浏览全部」。检查菜单底部的「角色可信素材」「角色风险预检」「快速切分」：应显示在输入框上方，不能被盖住。</li><li>点击最下面可用的「快速切分」，应打开切分窗口；按 Esc 或窗口里的取消退出。再打开「浏览全部」，点击「调整像素」检查能打开并取消。</li><li>缩放、平移画布后再打开菜单。菜单项仍能看见和点击，取消后原图、节点位置和输入框保持正常。</li></ol><a id="canvas-link" class="primary" target="_blank" rel="noopener">打开测试画布</a><p><small>灰色项目表示功能当前不可用，仍应完整可见；本次不用提交生成、切分结果或修改图片。检查通过后，在对话里回复「菜单遮挡通过」。</small></p></section>
<details><summary>已通过项目和演示开关（无需重做）</summary><section><p>第1～5组，包括中文名称、模板筛选/保存、拖线菜单与稳定性、裁剪/工具、更新后文字保留、历史图片与速度，均已按你的确认记录通过。每日自动备份及视频、音频空按钮仍暂缓。</p><a class="primary" href="/canvas/projects" target="_blank" rel="noopener">打开工作空间</a> <a class="primary" href="/admin/templates" target="_blank" rel="noopener">打开模板管理</a><div class="tools"><button id="tools">切换图片工具状态</button><span id="tools-mode" role="status"></span></div><div class="tools"><button id="slow" aria-pressed="false">开启慢速演示</button><span id="mode" role="status">正常速度</span></div><button id="maintenance">模拟维护恢复</button><span id="maintenance-mode" role="status"></span></section><section><h2>模板保存核对（已通过，留作参考）</h2><button id="check">核对已保存内容</button><div id="result" role="status">点击按钮查看。</div></section></details><p id="expiry"></p><p><button id="finish">结束本次验收并清理测试数据</button></p></main>
<script>const slowButton=document.getElementById('slow'), mode=document.getElementById('mode');async function status(){const r=await fetch('/__acceptance/status');if(!r.ok)throw Error('验收服务已停止');const d=await r.json();slowButton.textContent=d.slow?'关闭慢速演示':'开启慢速演示';slowButton.setAttribute('aria-pressed',String(d.slow));mode.textContent=d.slow?'慢速演示已开启':'正常速度';document.getElementById('expiry').textContent='本次临时页面开放至 '+new Date(d.expiresAt).toLocaleTimeString('zh-CN')+'。到时自动关闭。';}slowButton.onclick=async()=>{slowButton.disabled=true;try{const r=await fetch('/__acceptance/toggle-slow',{method:'POST'});if(!r.ok)throw Error('切换失败');await status();}catch(e){mode.textContent=e.message;}finally{slowButton.disabled=false;}};document.getElementById('check').onclick=async()=>{const box=document.getElementById('result');box.textContent='正在读取…';try{const r=await fetch('/__acceptance/results');if(!r.ok)throw Error('读取失败');const d=await r.json();const table=document.createElement('table'),head=table.insertRow();['原模板','当前名称','当前说明','图内容'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th);});d.items.forEach(item=>{const row=table.insertRow();[item.label,item.title??'模板未找到',item.description??'',item.graphUnchanged?'与初始相同，已保留':'与初始不同，请核对'].forEach(t=>row.insertCell().textContent=t);});box.replaceChildren(table);}catch(e){box.textContent=e.message;}};status().catch(e=>mode.textContent=e.message);</script><script>async function refreshScenarios(){const d=await(await fetch('/__acceptance/status')).json();document.getElementById('canvas-link').href=d.projects[1].url;document.getElementById('tools-mode').textContent=d.toolsAvailable?'可用入口演示（生成未开放）':'不可用演示';}async function toggleScenario(path,box,onSuccess){try{const r=await fetch(path,{method:'POST'});if(!r.ok)throw Error('切换失败，验收服务可能已停止');await onSuccess();}catch(e){document.getElementById(box).textContent=e.message;}}document.getElementById('tools').onclick=()=>toggleScenario('/__acceptance/toggle-tools','tools-mode',refreshScenarios);document.getElementById('maintenance').onclick=()=>toggleScenario('/__acceptance/toggle-maintenance','maintenance-mode',async()=>{document.getElementById('maintenance-mode').textContent='模拟维护中。请回到画布等待，开始后约35～65秒出现更新提示。';});refreshScenarios().catch(e=>document.getElementById('tools-mode').textContent=e.message);document.getElementById('finish').onclick=async()=>{const r=await fetch('/__acceptance/stop',{method:'POST'});if(r.ok)document.body.textContent='本次验收已结束。你可以关闭这些验收标签页；再次双击启动文件会准备一份新的测试数据。';};</script></html>`;

// A second restrictive policy also fences the user's unsandboxed browser.
const browserPolicy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const plugin = {
  name: "isolated-template-manual-acceptance",
  enforce: "pre",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const originalSetHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) => originalSetHeader(name,
        name.toLowerCase() === "content-security-policy" ? [...(Array.isArray(value) ? value : [value]), browserPolicy] : value);
      originalSetHeader("Content-Security-Policy", browserPolicy);
      originalSetHeader("Cache-Control", "no-store");
      const url = new URL(req.url ?? "/", origin);
      if (req.headers.host !== `127.0.0.1:${port}` || url.origin !== origin ||
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers["sec-fetch-site"] === "cross-site") {
        json(res, 403, { error: "本地验收只接受本页请求" }); return;
      }
      const setup = req.headers["x-acceptance-setup"] === setupToken;
      const method = req.method ?? "GET";
      const templatePath = /^\/api\/admin\/templates(?:\/[a-f0-9-]+)?$/.test(url.pathname);
      const localEdit = templatePath ||
        (url.pathname === "/api/projects" && method === "POST") ||
        (/^\/api\/projects\/[a-z0-9._-]+(?:\/clone)?$/i.test(url.pathname) && ["POST", "DELETE"].includes(method)) ||
        (/^\/api\/(?:project-title|canvas)\/[a-z0-9._-]+$/i.test(url.pathname) && ["PUT", "DELETE"].includes(method)) ||
        (/^\/api\/canvases\/[a-z0-9._-]+\/commands$/i.test(url.pathname) && method === "POST") ||
        (/^\/api\/assets\/[a-z0-9._-]+$/i.test(url.pathname) && ["POST", "DELETE"].includes(method)) ||
        (/^\/api\/history\/[a-z0-9._-]+$/i.test(url.pathname) && method === "POST") ||
        (url.pathname === "/__acceptance/stop" && method === "POST") ||
        (/^\/__acceptance\/toggle-(?:slow|tools|maintenance)$/.test(url.pathname) && method === "POST") ||
        (generationScenario && /^\/__acceptance\/generation\/(?:activate|plan|restore|complete|delay|check)$/.test(url.pathname) && method === "POST");
      if (!setup && generationScenario && method === "PUT" && /^\/api\/canvas\/[a-z0-9._-]+$/i.test(url.pathname)) {
        generationCounters.browserCanvasWrites += 1;
        persistGenerationJournal("browserCanvasWrite", { path: url.pathname, source: generationLastWriteSource });
      }
      if (!setup && generationScenario && ["POST", "DELETE"].includes(method) && /^\/api\/generation-tasks(?:\/|$)/.test(url.pathname)) {
        generationCounters.generationPosts += method === "POST" ? 1 : 0;
        generationCounters.generationDeletes += method === "DELETE" ? 1 : 0;
        persistGenerationJournal("generationMutationAttemptRejected", { method, path: url.pathname });
      }
      if (!setup && generationScenario && method === "POST" && /^\/api\/canvases\/[a-z0-9._-]+\/commands$/i.test(url.pathname)) {
        generationCounters.browserCanvasCommandWrites += 1;
        persistGenerationJournal("browserCanvasCommandWrite", { path: url.pathname, source: generationLastWriteSource });
      }
      if (!setup && !["GET", "HEAD"].includes(method) && !localEdit) {
        json(res, 403, { error: "本地验收只开放测试数据编辑，生成与外部操作未开放" }); return;
      }
      if (!setup && url.pathname === "/api/updates" && method === "GET") {
        if (Date.now() < maintenanceUntil) {
          res.setHeader("Retry-After", "5"); json(res, 503, { error: "模拟维护中" }); return;
        }
        if (updateStreams.size >= 16) { json(res, 429, { error: "请关闭多余验收标签页" }); return; }
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        res.write(`retry: 1000\ndata: ${JSON.stringify({ version: demoVersion || packagedVersion })}\n\n`);
        updateStreams.add(res);
        const heartbeat = setInterval(() => { if (!res.destroyed) res.write(": acceptance heartbeat\n\n"); }, 15000);
        res.once("close", () => { clearInterval(heartbeat); updateStreams.delete(res); });
        return;
      }
      // Synthetic task projection is owned by the persistent acceptance journal.
      // The real Canvas save contract correctly strips client-supplied task state.
      if (!setup && generationScenario && method === "GET" && url.pathname === `/api/canvas/${generationFixture?.canvasId}`) {
        void api(url.pathname).then((response) => response.json()).then((document) => {
          const seen = new Set();
          const nodes = document.nodes.map((node) => {
            const task = [...generationTasks.values()].find((candidate) => candidate.nodeId === node.id);
            if (!task) return node;
            if (seen.has(task.id) || node.type !== task.kind || task.canvasId !== generationFixture.canvasId) throw new Error("Synthetic canvas identity mismatch");
            seen.add(task.id);
            return { ...node, data: { ...node.data,
              ...generationNodeData(task.kind, "shared", task, task.identity, task.state === "running"),
              ...(task.state === "success" ? generationTaskResult(task) : {}),
            } };
          });
          if (seen.size !== generationTasks.size) throw new Error("Synthetic canvas lost a task node");
          json(res, 200, { ...document, nodes });
        }).catch((error) => { console.error(error); if (!res.headersSent) json(res, 500, { error: "synthetic canvas read failed" }); });
        return;
      }
      if (!setup && generationScenario && url.pathname === "/api/models" && method === "GET") {
        json(res, 200, generationFixture?.modelCatalog ?? { generationEnabled: false, models: [] }); return;
      }
      if (!setup && generationScenario && url.pathname === "/api/generation-tasks/status" && method === "GET") {
        generationCounters.statusReads += 1;
        persistGenerationJournal("capabilityStatusRead");
        json(res, 200, {
          audioProviderConfigured: true,
          audioSubmissionEnabled: true,
          imageProviderConfigured: true,
          imageSubmissionEnabled: true,
          paidProviderRequests: 0,
          persistentQueueReady: true,
          providerConfigured: true,
          submissionEnabled: true,
          textProviderConfigured: true,
          textSubmissionEnabled: true,
          videoProviderConfigured: true,
          videoSubmissionEnabled: true,
        }); return;
      }
      if (!setup && generationScenario && url.pathname === "/api/generation-tasks" && method === "GET") {
        json(res, 200, { tasks: [...generationTasks.values()].map(generationTaskPublic) }); return;
      }
      if (!setup && generationScenario && /^\/api\/generation-tasks\/[^/]+$/.test(url.pathname) && method === "GET") {
        const taskId = decodeURIComponent(url.pathname.split("/").at(-1));
        const task = generationTasks.get(taskId);
        if (!task) { json(res, 404, { error: "synthetic task not found", code: "TASK_NOT_FOUND" }); return; }
        void generationTaskResponse(task).then((result) => {
          if (res.destroyed || res.writableEnded) {
            persistGenerationJournal("detailReadClientClosed", { taskId });
            return;
          }
          if (result.status === 200) json(res, 200, result.task);
          else json(res, result.status, { error: result.message, code: result.code });
        }).catch((error) => {
          console.error(error);
          if (!res.headersSent) json(res, 500, { error: "synthetic task projection failed", code: "ACCEPTANCE_PROJECTION_FAILED" });
        });
        return;
      }
      // Media bytes and metadata use the real local routes and registry.
      if (!setup && url.pathname === "/api/image-tools/capabilities" && method === "GET") {
        json(res, 200, { generatedAt: new Date().toISOString(), revision: toolsAvailable ? "aaaaaaaaaaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbbbbbbbbbb", operations: operations.map((operation) => ({
          operation, status: operation === "lighting" ? "paused" : !remoteOperations.has(operation) || toolsAvailable ? "available" : "unavailable",
          reason: operation === "lighting" ? "打光仍暂停" : !remoteOperations.has(operation) ? "本地工具可用" : toolsAvailable ? "验收演示：入口可打开，生成未开放" : "验收演示：图片工具暂不可用",
          reasonCode: operation === "lighting" ? "PAUSED_BY_SCOPE" : !remoteOperations.has(operation) || toolsAvailable ? "AVAILABLE" : "PROVIDER_UNAVAILABLE",
          expiresAt: new Date(Date.now() + 300000).toISOString(), maximumInputBytes: 20 * 1024 * 1024,
          maximumInputPixels: 4096 * 4096, outputContentTypes: ["image/png"], supportsAlpha: true, supportsMask: true, supportsReferenceImage: true,
        })) }); return;
      }
      if (generationScenario && method === "GET" && url.pathname === "/__acceptance/generation-entry") {
        const variant = url.searchParams.get("variant");
        if (!["candidate", "baseline"].includes(variant)) { json(res, 400, { error: "未知 client variant" }); return; }
        const cookie = `unboundry_generation_client=${variant}; Path=/; SameSite=Lax`;
        res.writeHead(302, { Location: `/canvas/${generationFixture?.canvasId ?? ""}`, "Set-Cookie": [adminCookie, cookie], "Cache-Control": "no-store" });
        res.end(); return;
      }
      if (generationScenario && method === "GET") {
        const staticPath = generationStaticPath(url.pathname);
        const canvasEntry = /^\/canvas(?:\/[^/]+)?$/.test(url.pathname) || url.pathname === "/canvas/projects";
        const cookieMatch = /(?:^|;\s*)unboundry_generation_client=(candidate|baseline)/.exec(String(req.headers.cookie ?? ""));
        const entryPath = canvasEntry && cookieMatch && generationBuilds
          ? join(generationBuilds[cookieMatch[1]].root, "index.html")
          : undefined;
        const file = staticPath ?? entryPath;
        if (file && inside(testRoot, file)) {
          res.writeHead(200, { "Content-Type": generationContentType(file), "Cache-Control": "no-store" });
          res.end(readFileSync(file)); return;
        }
      }
      if (url.pathname.startsWith("/__acceptance")) {
        void (async () => {
          if (!ready) { json(res, 503, { error: "正在准备测试模板" }); return; }
          if (url.pathname === "/__acceptance" && method === "GET") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": adminCookie, "Cache-Control": "no-store" });
            res.end(generationScenario ? generationGuideHtmlSimple() : guide); return;
          }
          if (url.pathname === "/__acceptance/status" && method === "GET") {
            json(res, 200, generationScenario
              ? { ...generationStatusPayload(), slow, toolsAvailable, maintenanceUntil }
              : { slow, toolsAvailable, maintenanceUntil, projects, expiresAt: expiresAt.toISOString() }); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/status" && method === "GET") {
            json(res, 200, generationStatusPayload()); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/check" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, runGenerationCheck(body.action)); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/activate" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, await activateGenerationPhase(body.phase)); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/plan" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, armGenerationFault(body)); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/restore" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, restoreGenerationFault(body.taskId)); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/complete" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, completeGenerationTask(body.taskId)); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/delay" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, delayNextGenerationTask(body.taskId)); return;
          }
          if (url.pathname === "/__acceptance/stop" && method === "POST") {
            json(res, 200, { stopped: true }); finishSession(); return;
          }
          if (url.pathname === "/__acceptance/toggle-slow" && method === "POST") {
            slow = !slow; graphReads = 0;
            json(res, 200, { slow }); return;
          }
          if (url.pathname === "/__acceptance/toggle-tools" && method === "POST") {
            toolsAvailable = !toolsAvailable; json(res, 200, { toolsAvailable }); return;
          }
          if (url.pathname === "/__acceptance/toggle-maintenance" && method === "POST") {
            maintenanceUntil = Date.now() + 35000;
            demoVersion = `${packagedVersion}-local-acceptance`;
            for (const stream of [...updateStreams]) stream.end();
            json(res, 200, { maintenanceUntil }); return;
          }
          if (url.pathname === "/__acceptance/results" && method === "GET") {
            const items = await Promise.all(fixtures.map(async (fixture) => {
              const item = (await (await api(`/api/admin/templates/${fixture.id}`)).json()).template;
              return { label: fixture.label, title: item?.title, description: item?.description,
                graphUnchanged: Boolean(item?.graph && digest(item.graph) === fixture.graphHash) };
            }));
            json(res, 200, { items }); return;
          }
          json(res, 404, { error: "验收入口不存在" });
        })().catch((error) => {
          if (error instanceof AcceptanceControlError) {
            if (!res.headersSent) json(res, error.status, { error: error.message, code: error.code });
            else res.end();
            return;
          }
          console.error(error);
          if (!res.headersSent) json(res, 500, { error: "验收服务暂时无法完成操作，请把本页提示发给我。", code: "ACCEPTANCE_SERVICE_ERROR" });
          else res.end();
        });
        return;
      }
      if (!setup && slow && (templatePath || url.pathname.startsWith("/api/image-edit-sources/"))) {
        const delay = method === "GET" && (/^\/api\/admin\/templates\/[a-f0-9-]+$/.test(url.pathname) || url.pathname.startsWith("/api/image-edit-sources/"))
          ? (++graphReads % 2 === 1 ? 6000 : 1000)
          : ["POST", "PATCH", "DELETE"].includes(method) ? 3000 : 0;
        if (delay) { setTimeout(() => { if (!res.destroyed) next(); }, delay); return; }
      }
      next();
    });
  },
};

const server = await createServer({
  configFile: join(sourceRoot, "vite.config.ts"),
  plugins: [plugin],
  server: { host: "127.0.0.1", port, strictPort: true, hmr: false, open: false },
});
let stopping;
async function stop() {
  if (!stopping) {
    for (const stream of [...updateStreams]) stream.end();
    stopping = server.close();
  }
  await stopping;
}
process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
try {
  await server.listen();
  const bootstrap = await api("/api/auth/bootstrap", "POST", {
    displayName: "本地验收管理员", loginName: "acceptance", password: `local-${randomUUID()}`,
  });
  adminCookie = bootstrap.headers.get("set-cookie");
  if (!adminCookie) throw new Error("Temporary admin session was not created");
  if (generationScenario) {
    const title = "状态查询验收 · 四类节点与回退演练";
    const item = await (await api("/api/projects", "POST", { title })).json();
    projects.push({ id: item.id, title, url: `/canvas/${item.id}` });
    await initializeGenerationFixture(item.id);
    const baseline = await (await api(`/api/canvas/${item.id}`)).json();
    await generationDocumentPut({ ...baseline, nodes: generationCanvasNodes(), edges: [] }, "control");
    persistGenerationJournal("canvasSeed", { nodeCount: 4, phase: "candidate", sharedTaskIds: [...generationTasks.keys()] });
  } else {
  const simpleGraph = (marker) => ({ version: 1, nodes: [{ id: `text-${marker}`, type: "text", position: { x: 350, y: 160 }, data: { title: marker, label: "Text", textPrompt: `这是${marker}的独立图内容` }, style: { width: 250, height: 250 } }], edges: [] });
  for (let index = 1; index <= 201; index += 1) {
    await api("/api/admin/templates", "POST", { title: `分页验收${String(index).padStart(3, "0")}`, graph: simpleGraph(`page-${index}`), status: "draft" });
  }
  for (const title of ["验收项目 · 可改中文名", "验收画布 · 文本图片与分组"]) {
    const item = await (await api("/api/projects", "POST", { title })).json();
    projects.push({ id: item.id, title, url: `/canvas/${item.id}` });
  }
  const png = readFileSync(join(sourceRoot, "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png"));
  for (let index = 1; index <= 27; index += 1) {
    const id = `acceptance-image-${index}.png`;
    await api(`/api/assets/${id}`, "POST", png);
    mediaIds.push(id);
    await api("/api/history/local-user", "POST", { id, kind: "image", label: `验收图片 ${index}`, preview: `/api/assets/${id}` });
  }
  const canvasId = projects[1].id;
  const baseline = await (await api(`/api/canvas/${canvasId}`)).json();
  const imageId = mediaIds[0];
  await api(`/api/canvas/${canvasId}`, "PUT", {
    revision: baseline.revision, observedRevision: baseline.revision, observedLoadToken: baseline.loadToken,
    saveAttemptId: randomUUID(), saveSequence: 1, saveSessionId: randomUUID(), viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "acceptance-group", type: "group", position: { x: 200, y: 180 }, data: { label: "Group", title: "分组连线验收" }, style: { width: 520, height: 360 } },
      { id: "acceptance-group-image", type: "image", parentId: "acceptance-group", extent: "parent", position: { x: 90, y: 75 },
        data: { label: "Image", title: "图片裁剪与连线", assetId: imageId, imageSrc: `/api/assets/${imageId}`, sourceKind: "image", imagePromptReady: true, mediaSizingMode: "manual" },
        style: { width: 300, height: 169 } },
    ], edges: [],
  });
  for (const [letter, fruit] of [["A", "苹果"], ["B", "香蕉"]]) {
    const graph = { version: 1, nodes: [{
      id: `acceptance-${letter}`, type: "text", position: { x: 0, y: 0 },
      data: { title: `${letter} 的${fruit}`, textPrompt: `这是模板 ${letter} 的${fruit}内容。保存其他模板时，这段内容应该保留。`, label: "Text" },
      style: { width: 320, height: 220 },
    }], edges: [] };
    const response = await api("/api/admin/templates", "POST", {
      title: `验收 ${letter} · ${fruit}`, description: `这是 ${letter} 的${fruit}模板，请只用于本地验收。`, category: ["工具"], graph,
    });
    const { template } = await response.json();
    fixtures.push({ id: template.id, label: `${letter} · ${fruit}`, graphHash: digest(template.graph) });
  }
  }
  ready = true;
  const receipt = generationScenario
    ? {
        status: "USER_RECHECK",
        scenario: "generation-status",
        url: `${origin}/__acceptance`,
        appUrl: `${origin}/__acceptance/generation-entry?variant=candidate`,
        guideUrl: `${origin}/__acceptance`,
        expiresAt: expiresAt.toISOString(), pid: process.pid, dataRoot, projects,
        canvasId: generationFixture.canvasId,
        taskIds: [...generationTasks.keys()],
        sentinels: generationFixture.sentinels,
        syntheticOnly: true,
    taskStorage: "acceptance journal and API projection; not generation_tasks SQLite or Provider evidence",
        providerPolicy: "external calls blocked; verify safe-runner network audit",
        journalPath: generationJournalPath,
        builds: generationBuilds,
        sourceModules: {
          candidate: generationBuilds.candidateSource,
          baseline: generationBuilds.baselineSource,
        },
      }
    : { status: "USER_RECHECK", url: `${origin}/__acceptance`, appUrl: `${origin}/admin/templates`,
        expiresAt: expiresAt.toISOString(), pid: process.pid, dataRoot, fixtures, projects, mediaIds,
        appSha256: createHash("sha256").update(readFileSync(join(sourceRoot, "client/src/App.tsx"))).digest("hex") };
  writeFileSync(join(testRoot, "manual-acceptance.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`[manual-acceptance-ready] ${JSON.stringify(receipt)}`);
  let expiryTimer;
  await Promise.race([
    sessionFinished,
    new Promise((resolve) => { expiryTimer = setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now())); }),
  ]);
  clearTimeout(expiryTimer);
} finally {
  await stop();
}
// Vite's denied wildcard capability probe leaves the offline guard exit code
// set. The owning runner independently audits every network attempt before
// accepting this successful, fully closed session (as for the signal path).
process.exit(0);
