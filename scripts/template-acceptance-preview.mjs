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
import { readFile, unlink } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createServer as createHttpServer } from "node:http";
import { build as viteBuild, createServer } from "vite";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { MEDIA_PUBLICATION_FIXTURE, seedMediaPublicationLegacyDatabase } from "./media-publication-product-fixture.mjs";

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
const mediaPublicationScenario = acceptanceScenario === "media-publication";
const videoQueryWorkflowScenario = acceptanceScenario === "video-query-workflow";
const videoQueryWorkflowBaselineOnly = videoQueryWorkflowScenario &&
  process.env.UNBOUNDRY_VIDEO_QUERY_BASELINE_ONLY === "1";
if (!["generation-status", "node-recovery", "media-publication", "video-query-workflow", "templates"].includes(acceptanceScenario)) {
  throw new Error(`Unknown local acceptance scenario: ${acceptanceScenario}`);
}
const nodeRecoveryScenario = acceptanceScenario === "node-recovery";
const generationScenario = acceptanceScenario === "generation-status" || nodeRecoveryScenario || mediaPublicationScenario || videoQueryWorkflowScenario;
// The node-recovery acceptance uses the real local application commands. The
// fixture and its loopback provider are still synthetic, but the task/case
// records, recovery commands, Canvas projection, and one-node retry all use
// the same server modules as the product.
const nodeRecoveryProductMode = nodeRecoveryScenario;
const mediaPublicationProductMode = mediaPublicationScenario;
const videoQueryWorkflowProductMode = videoQueryWorkflowScenario;
if (nodeRecoveryProductMode || mediaPublicationProductMode) {
  process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
}
if (videoQueryWorkflowProductMode) {
  // Recovery-case reads reject bypass identities. This scenario seeds a real
  // private session for its temporary owner before serving any product route.
  process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "0";
}
if (nodeRecoveryProductMode) {
  process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED = "1";
  // Keep the manual demonstration idle until its control buttons invoke the
  // real recovery commands. The scheduled worker is covered by its regression suite.
  process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP = "1";
  process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = "1";
}
if (mediaPublicationProductMode) {
  process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = "1";
}
if (videoQueryWorkflowProductMode) {
  process.env.UNBOUNDRY_TEST_RELAY_MEDIA_FETCHER = "1";
  process.env.UNBOUNDRY_GENERATION_RECOVERY_CASES_ENABLED = "1";
  // The product worker owns the 30-second recovery sweep in this scenario;
  // the acceptance runner waits long enough to observe its real tick.
  process.env.UNBOUNDRY_DISABLE_GENERATION_RECOVERY_SWEEP = "0";
}
if (videoQueryWorkflowScenario) {
  const nativeConsoleError = console.error.bind(console);
  console.error = (...args) => {
    for (const arg of args) {
      if (typeof arg !== "string") continue;
      try {
        const event = JSON.parse(arg);
        if (event?.event === "generation-diagnostic" && typeof event.stage === "string") {
          videoQueryWorkflowDiagnosticStageCounts.set(
            event.stage,
            (videoQueryWorkflowDiagnosticStageCounts.get(event.stage) ?? 0) + 1,
          );
          videoQueryWorkflowDiagnosticEvents.push({
            taskId: event.taskId ?? null,
            stage: event.stage,
            sourceErrorCode: event.sourceErrorCode ?? null,
            errorName: event.errorName ?? null,
            errorCode: event.errorCode ?? null,
            causeCode: event.causeCode ?? null,
          });
          if (event.stage === "accepted-video-query-recovery") {
            videoQueryWorkflowAcceptedRecoveryDiagnosticCount += 1;
          }
        }
      } catch {
        // Keep ordinary diagnostics untouched; only the structured stage is evidence.
      }
    }
    nativeConsoleError(...args);
  };
}
const generationBaselineRoot = generationScenario && !videoQueryWorkflowScenario
  ? realpathSync(required("UNBOUNDRY_GENERATION_STATUS_BASELINE_ROOT"))
  : undefined;
const generationBaselineManifest = generationScenario && !videoQueryWorkflowScenario
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
const nodeRecoveryChecks = {
  transient: "idle",
  save: "idle",
  retry: "idle",
  unknown: "idle",
};
const nodeRecoveryState = {
  retryMode: "",
  retryAccepted: false,
  saveFaultRemaining: 0,
  saveFaultStatuses: [],
};
const recoveryCaseSummaryKeys = Object.freeze([
  "taskId", "caseId", "canvasId", "nodeId", "kind", "executionAttempt", "phase",
  "caseEventId", "progressVersion", "updatedAt", "unread", "reasonCode", "summary",
  "status", "action",
]);
const recoveryCaseSummaryOptionalKeys = Object.freeze(["lastCheckedAt", "nextCheckAt"]);
const nodeRecoveryRecoveryCases = new Map();
let nodeRecoveryMaintenanceStage = "queued";
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
let nodeRecoveryFixture;
let nodeRecoveryProductFixture;
let nodeRecoveryProductProvider;
let nodeRecoveryProductNativeFetch;
let nodeRecoveryProductProviderPort;
const nodeRecoveryProviderStats = {
  posts: 0,
  gets: 0,
  mediaGets: 0,
  requests: [],
};
const mediaPublicationProviderUrl = "https://media-publication-relay.example.test";
const mediaPublicationProviderResultPath = "/media-publication-child-result.mp4";
const videoQueryWorkflowFixtureIds = Object.freeze({
  activeGroupId: "video-query-workflow-active-group",
  activeVideoNodeId: "video-query-workflow-active-video",
  activeTailTextNodeId: "video-query-workflow-active-tail-text",
  historyGroupId: "video-query-workflow-history-group",
  historyVideoNodeId: "video-query-workflow-history-video",
  historyTailTextNodeId: "video-query-workflow-history-tail-text",
});
let mediaPublicationProvider;
let mediaPublicationNativeFetch;
let mediaPublicationProviderPort;
let videoQueryWorkflowProviderLockDatabase;
let videoQueryWorkflowProviderLockTimer;
let videoQueryWorkflowProviderProfileLockInjected = false;
const mediaPublicationProviderStats = {
  posts: 0,
  videoPosts: 0,
  imagePosts: 0,
  unknownPosts: 0,
  postsByModel: {},
  gets: 0,
  mediaGets: 0,
  requests: [],
};
let mediaPublicationInitialVideoProviderPosts = 0;
let videoQueryWorkflowProviderStatusFailures = 0;
let videoQueryWorkflowRunId = "";
let videoQueryWorkflowHistoricalRunId = "";
let videoQueryWorkflowHistoricalOriginalTaskId = "";
let videoQueryWorkflowHistoricalOriginalProviderTaskId = "";
let videoQueryWorkflowHistoricalContinuationRunId = "";
let videoQueryWorkflowHistoricalFaultInjected = false;
let videoQueryWorkflowHistoricalSyncResult;
let videoQueryWorkflowProviderPhases = new Map();
let videoQueryWorkflowArkInputVideoSeen = false;
let videoQueryWorkflowAcceptedRecoveryDiagnosticCount = 0;
const videoQueryWorkflowDiagnosticStageCounts = new Map();
const videoQueryWorkflowDiagnosticEvents = [];
let videoQueryWorkflowInitialCanvas;
const videoQueryWorkflowChecks = {
  start: "idle",
  refresh: "idle",
  historySync: "idle",
  historyContinuation: "idle",
};
let videoQueryWorkflowHistoryResult;
let videoQueryWorkflowSemanticFingerprint = "";
let videoQueryWorkflowHistoricalSemanticFingerprint = "";
let videoQueryWorkflowGraphRevision = 0;
const nodeRecoveryProductChecks = {
  original: "idle",
  maintenance: "idle",
  retry: "idle",
};
const nodeRecoveryProductStats = {
  claims: 0,
  inspections: 0,
  progress: 0,
  admissions: 0,
};
const mediaPublicationChecks = { saveRace: "idle", adoption: "idle", continuation: "idle", normal: "idle" };
const mediaPublicationCounters = { providerPosts: 0, providerStatusGets: 0, providerMediaGets: 0, taskSuccesses: 0 };
let mediaPublicationFixture;
let mediaPublicationAdapter;
let mediaPublicationProductModules;
let mediaPublicationLastResults = {};
const startedAt = new Date();
const expiresAt = new Date(startedAt.getTime() + (mediaPublicationScenario ? 24 : (nodeRecoveryScenario || videoQueryWorkflowScenario) ? 12 : 2) * 60 * 60_000);
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
async function api(path, method = "GET", body, contentType, extraHeaders = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "x-acceptance-setup": setupToken,
      ...(adminCookie ? { Cookie: adminCookie.split(";")[0] } : {}),
      ...extraHeaders,
      ...(body ? { "Content-Type": contentType ?? (Buffer.isBuffer(body) ? "image/png" : "application/json") } : {}),
    },
    ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null);
    const code = typeof payload?.code === "string" ? payload.code : typeof payload?.error?.code === "string" ? payload.error.code : "UNKNOWN";
    const detail = videoQueryWorkflowScenario && path === "/api/workflow-runs"
      ? `, detail=${JSON.stringify(payload)}` : "";
    throw new Error(`Acceptance setup API ${path}: HTTP ${response.status}, code=${code}${detail}`);
  }
  return response;
}

const nodeRecoveryProductProviderUrl = "https://node-recovery-relay.example.test";
const nodeRecoveryProductResultPath = "/node-recovery-result.mp4";

async function startNodeRecoveryProductProvider() {
  if (!nodeRecoveryProductMode || nodeRecoveryProductProvider) return;
  nodeRecoveryProductNativeFetch = globalThis.fetch;
  const resultPath = join(sourceRoot, "client/public/fixtures/video-success.mp4");
  if (!existsSync(resultPath)) throw new Error("Node recovery loopback result fixture is missing");
  const resultBytes = readFileSync(resultPath);
  nodeRecoveryProductProvider = createHttpServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = req.method ?? "GET";
      const providerTaskId = requestUrl.searchParams.get("task_id");
      nodeRecoveryProviderStats.requests.push({ method, path: requestUrl.pathname, taskId: providerTaskId });
      if (method === "POST" && requestUrl.pathname === "/v1/media/generate") {
        for await (const chunk of req) void chunk;
        nodeRecoveryProviderStats.posts += 1;
        json(res, 200, { task_id: "node-recovery-child-provider" });
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/v1/skills/task-status") {
        nodeRecoveryProviderStats.gets += 1;
        if (!providerTaskId) {
          json(res, 400, { error: "missing task_id" });
          return;
        }
        if (providerTaskId === "node-recovery-maintenance-provider") {
          json(res, 200, { state: "running", task_id: providerTaskId });
          return;
        }
        if (["node-recovery-original-provider", "node-recovery-maintenance-result-provider", "node-recovery-child-provider"].includes(providerTaskId)) {
          json(res, 200, {
            is_final: true,
            result_type: "video",
            result_url: `${nodeRecoveryProductProviderUrl}${nodeRecoveryProductResultPath}`,
            state: "success",
            task_id: providerTaskId,
          });
          return;
        }
        json(res, 404, { error: "task not found" });
        return;
      }
      if (method === "GET" && requestUrl.pathname === nodeRecoveryProductResultPath) {
        nodeRecoveryProviderStats.mediaGets += 1;
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": resultBytes.byteLength, "Cache-Control": "no-store" });
        res.end(resultBytes);
        return;
      }
      json(res, 404, { error: "loopback provider route not found" });
    })().catch((error) => {
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "loopback provider failed" });
      else res.end();
    });
  });
  await new Promise((resolve, reject) => {
    nodeRecoveryProductProvider.once("error", reject);
    nodeRecoveryProductProvider.listen(0, "127.0.0.1", () => resolve());
  });
  const address = nodeRecoveryProductProvider.address();
  if (!address || typeof address === "string" || !Number.isInteger(address.port)) {
    throw new Error("Node recovery loopback provider did not expose a dynamic port");
  }
  nodeRecoveryProductProviderPort = address.port;
  globalThis.fetch = (input, init) => {
    let requestUrl;
    try {
      requestUrl = typeof input === "string" || input instanceof URL
        ? new URL(input.toString())
        : new URL(input.url);
    } catch {
      return nodeRecoveryProductNativeFetch(input, init);
    }
    if (requestUrl.hostname !== "node-recovery-relay.example.test") {
      return nodeRecoveryProductNativeFetch(input, init);
    }
    const rewritten = `http://127.0.0.1:${nodeRecoveryProductProviderPort}${requestUrl.pathname}${requestUrl.search}`;
    const rewrittenInput = typeof input === "object" && input instanceof Request
      ? new Request(rewritten, input)
      : rewritten;
    return nodeRecoveryProductNativeFetch(rewrittenInput, init);
  };
}

async function stopNodeRecoveryProductProvider() {
  if (nodeRecoveryProductNativeFetch) {
    globalThis.fetch = nodeRecoveryProductNativeFetch;
    nodeRecoveryProductNativeFetch = undefined;
  }
  const provider = nodeRecoveryProductProvider;
  nodeRecoveryProductProvider = undefined;
  nodeRecoveryProductProviderPort = undefined;
  if (provider) await new Promise((resolve) => provider.close(() => resolve()));
}

async function startMediaPublicationProvider() {
  if (!(mediaPublicationProductMode || videoQueryWorkflowProductMode) || mediaPublicationProvider) return;
  mediaPublicationNativeFetch = globalThis.fetch;
  const resultPath = join(sourceRoot, "client/public/fixtures/video-success.mp4");
  if (!existsSync(resultPath)) throw new Error("Media publication loopback result fixture is missing");
  const resultBytes = readFileSync(resultPath);
  mediaPublicationProvider = createHttpServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = req.method ?? "GET";
      const providerTaskId = requestUrl.searchParams.get("task_id");
      const request = { method, path: requestUrl.pathname, taskId: providerTaskId };
      if (method === "POST" && requestUrl.pathname === "/v1/media/generate") {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString("utf8");
        let body;
        try { body = JSON.parse(raw); } catch { body = undefined; }
        const model = typeof body?.model === "string" ? body.model : "";
        const capability = model === mediaPublicationFixture.models.video.providerModelId
          ? "video"
          : model === mediaPublicationFixture.models.image.providerModelId
            ? "image"
            : "unknown";
        request.model = model || "<missing>";
        request.capability = capability;
        const promptText = typeof body?.prompt === "string"
          ? body.prompt
          : typeof body?.input?.prompt === "string"
            ? body.input.prompt
            : "";
        const phase = videoQueryWorkflowProductMode && !videoQueryWorkflowBaselineOnly &&
          (promptText.includes("历史事故") || mediaPublicationProviderStats.videoPosts === 0)
          ? "history"
          : "active";
        request.phase = videoQueryWorkflowProductMode ? phase : undefined;
        mediaPublicationProviderStats.posts += 1;
        mediaPublicationProviderStats[`${capability}Posts`] += 1;
        const modelKey = model || "<missing>";
        mediaPublicationProviderStats.postsByModel[modelKey] =
          (mediaPublicationProviderStats.postsByModel[modelKey] ?? 0) + 1;
        mediaPublicationProviderStats.requests.push(request);
        const taskPrefix = videoQueryWorkflowProductMode
          ? `video-query-workflow-${phase}-provider`
          : "media-publication-child-provider";
        const taskId = `${taskPrefix}-${mediaPublicationProviderStats.posts}`;
        request.providerTaskId = taskId;
        if (videoQueryWorkflowProductMode) {
          videoQueryWorkflowProviderPhases.set(taskId, phase);
          if (phase === "history" && !videoQueryWorkflowHistoricalOriginalProviderTaskId) {
            videoQueryWorkflowHistoricalOriginalProviderTaskId = taskId;
          }
        }
        json(res, 200, { task_id: taskId });
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/v1/responses") {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = undefined; }
        const content = Array.isArray(body?.input?.[0]?.content) ? body.input[0].content : [];
        const prompt = content.find((part) => part?.type === "input_text")?.text;
        const inputVideo = content.find((part) => part?.type === "input_video");
        const phase = videoQueryWorkflowProductMode && !videoQueryWorkflowBaselineOnly &&
          typeof prompt === "string" && prompt.includes("历史事故")
          ? "history"
          : "active";
        // Ark's response id contract permits the `resp_` prefix and only
        // lower-case letters, digits, dots, colons and dashes afterwards.
        // Keep the fixture id valid so the real text task can cross the same
        // response validation boundary as production.
        const responseId = `resp_video-query-workflow-${phase}-${mediaPublicationProviderStats.requests.length + 1}`;
        if (videoQueryWorkflowProductMode && inputVideo) videoQueryWorkflowArkInputVideoSeen = true;
        mediaPublicationProviderStats.requests.push({
          ...request,
          capability: "text",
          model: body?.model ?? "<missing>",
          phase: videoQueryWorkflowProductMode ? phase : undefined,
          inputVideo: Boolean(inputVideo),
        });
        if (typeof prompt !== "string" || !prompt.trim()) {
          json(res, 400, { error: { message: "文字请求缺少提示词" } });
          return;
        }
        json(res, 200, {
          id: responseId,
          output: [{
            content: [{ text: "视频查询尾部文字已自动完成", type: "output_text" }],
            status: "completed",
            type: "message",
          }],
          status: "completed",
          usage: { total_tokens: 1 },
        });
        return;
      }
      mediaPublicationProviderStats.requests.push(request);
      if (method === "GET" && requestUrl.pathname === "/v1/media/status") {
        mediaPublicationProviderStats.gets += 1;
        const phase = videoQueryWorkflowProviderPhases.get(providerTaskId) ?? "active";
        request.phase = videoQueryWorkflowProductMode ? phase : undefined;
        if (!providerTaskId || !/^(?:media-publication-child-provider|video-query-workflow-(?:active|history)-provider)-\d+$/.test(providerTaskId)) {
          json(res, 404, { error: "task not found" });
          return;
        }
        if (phase === "history" && videoQueryWorkflowProductMode && !videoQueryWorkflowHistoricalFaultInjected) {
          await simulateVideoQueryWorkflowHistoricalFailure(providerTaskId);
        }
        if (phase === "active" && videoQueryWorkflowProductMode && videoQueryWorkflowProviderStatusFailures < 2) {
          videoQueryWorkflowProviderStatusFailures += 1;
          json(res, 503, { error: "本地模拟的短暂查询中断" });
          if (videoQueryWorkflowProviderStatusFailures === 1) holdVideoQueryWorkflowProviderProfileLock();
          return;
        }
        json(res, 200, {
          is_final: true,
          result_type: "video",
          result_url: `${mediaPublicationProviderUrl}${mediaPublicationProviderResultPath}`,
          state: "success",
          task_id: providerTaskId,
        });
        return;
      }
      if (method === "GET" && requestUrl.pathname.startsWith("/v1/responses/")) {
        const responseId = decodeURIComponent(requestUrl.pathname.slice("/v1/responses/".length));
        if (!/^resp_video-query-workflow-(?:active|history)-\d+$/.test(responseId)) {
          json(res, 404, { error: { message: "response not found" } });
          return;
        }
        json(res, 200, {
          id: responseId,
          output: [{
            content: [{ text: "视频查询尾部文字已自动完成", type: "output_text" }],
            status: "completed",
            type: "message",
          }],
          status: "completed",
          usage: { total_tokens: 1 },
        });
        return;
      }
      if (method === "GET" && requestUrl.pathname === mediaPublicationProviderResultPath) {
        mediaPublicationProviderStats.mediaGets += 1;
        res.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Length": resultBytes.byteLength,
          "Content-Type": "video/mp4",
        });
        res.end(resultBytes);
        return;
      }
      json(res, 404, { error: "loopback provider route not found" });
    })().catch((error) => {
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: "loopback provider failed" });
      else res.end();
    });
  });
  await new Promise((resolve, reject) => {
    mediaPublicationProvider.once("error", reject);
    mediaPublicationProvider.listen(0, "127.0.0.1", () => resolve());
  });
  const address = mediaPublicationProvider.address();
  if (!address || typeof address === "string" || !Number.isInteger(address.port)) {
    throw new Error("Media publication loopback provider did not expose a dynamic port");
  }
  mediaPublicationProviderPort = address.port;
  globalThis.fetch = (input, init) => {
    let requestUrl;
    try {
      requestUrl = typeof input === "string" || input instanceof URL
        ? new URL(input.toString())
        : new URL(input.url);
    } catch {
      return mediaPublicationNativeFetch(input, init);
    }
    if (requestUrl.hostname !== "media-publication-relay.example.test") {
      return mediaPublicationNativeFetch(input, init);
    }
    const rewritten = `http://127.0.0.1:${mediaPublicationProviderPort}${requestUrl.pathname}${requestUrl.search}`;
    const rewrittenInput = typeof input === "object" && input instanceof Request
      ? new Request(rewritten, input)
      : rewritten;
    return mediaPublicationNativeFetch(rewrittenInput, init);
  };
}

async function stopMediaPublicationProvider() {
  if (videoQueryWorkflowProviderLockTimer) {
    clearTimeout(videoQueryWorkflowProviderLockTimer);
    videoQueryWorkflowProviderLockTimer = undefined;
  }
  try { videoQueryWorkflowProviderLockDatabase?.exec("ROLLBACK"); } catch {}
  try { videoQueryWorkflowProviderLockDatabase?.close(); } catch {}
  videoQueryWorkflowProviderLockDatabase = undefined;
  if (mediaPublicationNativeFetch) {
    globalThis.fetch = mediaPublicationNativeFetch;
    mediaPublicationNativeFetch = undefined;
  }
  const provider = mediaPublicationProvider;
  mediaPublicationProvider = undefined;
  mediaPublicationProviderPort = undefined;
  if (provider) await new Promise((resolve) => provider.close(() => resolve()));
}

function holdVideoQueryWorkflowProviderProfileLock() {
  if (!videoQueryWorkflowProductMode || videoQueryWorkflowProviderLockDatabase) return;
  const lockPath = join(dataRoot, "secrets", "provider-profile-write-lock.sqlite");
  const lockDatabase = new DatabaseSync(lockPath, { timeout: 0 });
  lockDatabase.exec("PRAGMA busy_timeout = 0");
  lockDatabase.exec(`
    CREATE TABLE IF NOT EXISTS provider_profile_write_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1), marker INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO provider_profile_write_lock (id, marker) VALUES (1, 0);
  `);
  lockDatabase.exec("BEGIN IMMEDIATE");
  videoQueryWorkflowProviderLockDatabase = lockDatabase;
  videoQueryWorkflowProviderProfileLockInjected = true;
  videoQueryWorkflowProviderLockTimer = setTimeout(() => {
    try { lockDatabase.exec("ROLLBACK"); } catch {}
    try { lockDatabase.close(); } catch {}
    if (videoQueryWorkflowProviderLockDatabase === lockDatabase) videoQueryWorkflowProviderLockDatabase = undefined;
    videoQueryWorkflowProviderLockTimer = undefined;
  }, 6_500);
  videoQueryWorkflowProviderLockTimer.unref?.();
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
const generationStateLabels = Object.freeze({ failed: "明确失败", running: "运行中", success: "成功" });

function generationJournalSnapshot() {
  if (!generationFixture) return undefined;
  return {
    schemaVersion: 1,
    scenario: acceptanceScenario,
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
      projectedNodeData: task.state === "success"
        ? generationTaskResult(task)
        : task.state === "failed"
          ? { ...generationNodeData(task.kind, "shared", task, task.identity, false), ...generationTaskFailure(task) }
          : generationNodeData(task.kind, "shared", task, task.identity, true),
    })),
    sentinels: generationFixture.sentinels,
    ...(nodeRecoveryScenario
      ? {
          checks: { ...nodeRecoveryChecks },
          retryMode: nodeRecoveryState.retryMode || undefined,
          retryAccepted: nodeRecoveryState.retryAccepted,
          saveFaultRemaining: nodeRecoveryState.saveFaultRemaining,
          preservedSuccessNodeIds: nodeRecoveryFixture?.successNodes?.map((node) => node.id) ?? [],
          recoveryCases: nodeRecoveryRecoveryPublicCases(),
        }
      : {}),
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

function nodeRecoveryRecoveryCasePublic(state) {
  const value = {
    taskId: state.taskId,
    caseId: state.caseId,
    canvasId: state.canvasId,
    nodeId: state.nodeId,
    kind: state.kind,
    executionAttempt: state.executionAttempt,
    phase: state.phase,
    caseEventId: state.caseEventId,
    progressVersion: state.progressVersion,
    updatedAt: state.updatedAt,
    ...(state.lastCheckedAt ? { lastCheckedAt: state.lastCheckedAt } : {}),
    ...(state.nextCheckAt ? { nextCheckAt: state.nextCheckAt } : {}),
    unread: state.progressVersion > state.lastReadProgressVersion,
    reasonCode: state.reasonCode,
    summary: state.summary,
    status: state.status,
    action: state.action,
  };
  const keys = Object.keys(value).sort();
  const allowed = [...recoveryCaseSummaryKeys, ...recoveryCaseSummaryOptionalKeys].sort();
  if (keys.some((key) => !allowed.includes(key)) ||
      !recoveryCaseSummaryKeys.every((key) => keys.includes(key))) {
    throw new Error("Synthetic recovery summary escaped the flat owner DTO");
  }
  return value;
}

function nodeRecoveryRecoveryCaseState(caseKey) {
  return nodeRecoveryRecoveryCases.get(caseKey);
}

function updateNodeRecoveryRecoveryCase(caseKey, patch) {
  const state = nodeRecoveryRecoveryCaseState(caseKey);
  if (!state) throw new AcceptanceControlError("本地维护案例尚未准备完成。", "NODE_RECOVERY_RECOVERY_NOT_READY", 503);
  const changed = Object.entries(patch).some(([key, value]) => state[key] !== value);
  if (!changed) return state;
  Object.assign(state, patch);
  state.caseEventId += 1;
  state.progressVersion += 1;
  state.updatedAt = new Date().toISOString();
  return state;
}

function syncNodeRecoveryRecoveryCases() {
  if (!nodeRecoveryFixture || nodeRecoveryRecoveryCases.size === 0) return;
  const original = nodeRecoveryFixture.v4.cases.originalResult;
  const originalState = nodeRecoveryRecoveryCaseState("originalResult");
  const originalTask = generationTasks.get(original.taskId);
  if (originalState && originalTask?.state === "success") {
    updateNodeRecoveryRecoveryCase("originalResult", {
      phase: "result_recovered",
      reasonCode: "result_recovery_pending",
      summary: "原结果已自动找回，已回到当前节点；无需再点恢复或重新生成",
      status: "result_recovered",
      action: "view_result",
      nextCheckAt: undefined,
    });
  }
  const retry = nodeRecoveryFixture.v4.cases.failedVideo;
  const retryState = nodeRecoveryRecoveryCaseState("failedVideo");
  const retryTask = generationTasks.get(retry.taskId);
  if (retryState && retryTask?.state === "failed" && retryTask.newGenerationAllowed === true) {
    updateNodeRecoveryRecoveryCase("failedVideo", {
      phase: "ready_for_user",
      reasonCode: "operator_incident",
      summary: "已核实此视频可以继续；只重新生成当前视频，前面9个成功节点保持不变",
      status: "ready_for_user",
      action: "regenerate",
    });
  }
}

function nodeRecoveryRecoveryPublicCases(taskIds) {
  syncNodeRecoveryRecoveryCases();
  const requested = taskIds?.length ? new Set(taskIds) : undefined;
  return [...nodeRecoveryRecoveryCases.values()]
    .filter((state) => !requested || requested.has(state.taskId))
    .map(nodeRecoveryRecoveryCasePublic);
}

function nodeRecoveryRecoveryBatch(taskIds) {
  return { enabled: true, cases: nodeRecoveryRecoveryPublicCases(taskIds) };
}

function nodeRecoveryRecoveryDetail(taskId) {
  const summary = nodeRecoveryRecoveryPublicCases().find((item) => item.taskId === taskId) ?? null;
  return { enabled: true, case: summary };
}

function acknowledgeNodeRecoveryRecovery(taskId, body) {
  const state = [...nodeRecoveryRecoveryCases.values()].find((item) => item.taskId === taskId);
  if (!state) throw new AcceptanceControlError("未找到可访问的本地处理事项。", "RECOVERY_NOT_FOUND", 404);
  const keys = Object.keys(body ?? {}).sort();
  if (keys.join(",") !== ["commandId", "expectedCaseEventId", "progressVersion"].sort().join(",") ||
      typeof body.commandId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(body.commandId) ||
      !Number.isSafeInteger(body.expectedCaseEventId) || body.expectedCaseEventId < 1 ||
      !Number.isSafeInteger(body.progressVersion) || body.progressVersion < 1) {
    throw new AcceptanceControlError("处理操作参数无效。", "RECOVERY_INVALID_COMMAND", 400);
  }
  if (state.caseEventId !== body.expectedCaseEventId || state.progressVersion !== body.progressVersion) {
    throw new AcceptanceControlError("处理进度已更新，请查看最新状态。", "RECOVERY_CONFLICT", 409);
  }
  state.lastReadProgressVersion = state.progressVersion;
  persistGenerationJournal("nodeRecoveryRecoveryRead", {
    taskId,
    caseId: state.caseId,
    progressVersion: state.progressVersion,
    commandId: body.commandId,
  });
  return nodeRecoveryRecoveryDetail(taskId);
}

function nodeRecoveryStatusPayload() {
  if (!generationFixture || !nodeRecoveryFixture) {
    return { scenario: "node-recovery", ready: false };
  }
  syncNodeRecoveryRecoveryCases();
  return {
    scenario: "node-recovery",
    ready,
    canvasId: generationFixture.canvasId,
    title: nodeRecoveryFixture.title,
    tasks: [...generationTasks.values()].map((task) => generationTaskPublic(task)),
    checks: { ...nodeRecoveryChecks },
    retryMode: nodeRecoveryState.retryMode || undefined,
    retryAccepted: nodeRecoveryState.retryAccepted,
    saveFaultRemaining: nodeRecoveryState.saveFaultRemaining,
    observations: Object.fromEntries(generationObservations),
    preserve: {
      expectedSuccessNodeCount: nodeRecoveryFixture.preservedSuccessNodeCount,
      successNodeIds: nodeRecoveryFixture.successNodes.map((node) => node.id),
      successNodesStillPresent: nodeRecoveryFixture.successNodes.every((node) =>
        generationTasks.get(node.taskId ?? node.id)?.state === "success"),
    },
    recovery: {
      syntheticOnly: true,
      cases: nodeRecoveryRecoveryPublicCases(),
    },
    syntheticLayer: {
      providerRequests: 0,
      paidProviderRequests: 0,
      taskStorage: "temporary acceptance journal and API projection",
      fixturePath: "tests/fixtures/node-recovery-acceptance.json",
      retryPath: nodeRecoveryFixture.retry.retryPath,
    },
    productLayer: {
      canvasWrites: generationCounters.browserCanvasWrites,
      generationPosts: generationCounters.generationPosts,
      statusReads: generationCounters.statusReads,
      detailReads: generationCounters.detailReads,
      maxInFlightDetailReads: generationCounters.maxInFlightDetailReads,
      canvasCommands: generationCounters.browserCanvasCommandWrites,
    },
    counters: {
      statusReads: generationCounters.statusReads,
      detailReads: generationCounters.detailReads,
      generationDeletes: generationCounters.generationDeletes,
      generationPosts: generationCounters.generationPosts,
      syntheticProjectionPublications: generationCounters.syntheticProjectionWrites,
      providerRequests: 0,
      paidProviderRequests: 0,
      canvasWrites: {
        browser: generationCounters.browserCanvasWrites,
        browserCommands: generationCounters.browserCanvasCommandWrites,
        control: generationCounters.controlCanvasWrites,
      },
    },
    sentinels: generationFixture.sentinels,
    journalPath: generationJournalPath,
    instructions: "V4 三项均在同一页观察；任务/维护案例为本地合成数据，不代表真实后端、Provider 或付款证据。",
    expiresAt: expiresAt.toISOString(),
  };
}

function generationStatusPayload() {
  if (!generationFixture) return { scenario: acceptanceScenario, ready: false };
  if (nodeRecoveryScenario) return nodeRecoveryStatusPayload();
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

async function loadMediaPublicationSourceModules() {
  if (mediaPublicationAdapter && mediaPublicationProductModules) return;
  const modulePath = (name) => ssrModuleUrl(join(sourceRoot, name));
  mediaPublicationAdapter ??= await loadAcceptanceSourceModule(modulePath("server/generationResultAdoptionWorkflowAdapter.ts"));
  mediaPublicationProductModules ??= {
    generationResultCommit: await loadAcceptanceSourceModule(modulePath("server/generationResultCommit.ts")),
    generationCanvasProjection: await loadAcceptanceSourceModule(modulePath("server/generationCanvasProjection.ts")),
    generationTaskStore: await loadAcceptanceSourceModule(modulePath("server/generationTaskStore.ts")),
    generationTasks: await loadAcceptanceSourceModule(modulePath("server/generationTasks.ts")),
    providerMedia: await loadAcceptanceSourceModule(modulePath("server/providerMedia.ts")),
    workflowRunService: await loadAcceptanceSourceModule(modulePath("server/workflowRunService.ts")),
    videoStorage: await loadAcceptanceSourceModule(modulePath("server/videoStorage.ts")),
  };
}

async function readMediaPublicationDatabase(read) {
  const databaseModule = await loadAcceptanceSourceModule(ssrModuleUrl(join(sourceRoot, "server/database.ts")));
  const database = databaseModule.openAppDatabase(dataRoot);
  try { return await read(database); }
  finally { database.close(); }
}

async function configureVideoQueryWorkflowReferenceStore() {
  if (!videoQueryWorkflowProductMode) return;
  await loadMediaPublicationSourceModules();
  const referenceStoreModule = await loadAcceptanceSourceModule(
    ssrModuleUrl(join(sourceRoot, "server/mediaProviderReferenceStore.ts")),
  );
  // Load the real composition before replacing only the temporary video locator.
  // The first lazy workflow route must not overwrite this isolated adapter.
  await loadAcceptanceSourceModule(ssrModuleUrl(join(sourceRoot, "server/applicationComposition.ts")));
  const fallback = referenceStoreModule.ownerMediaProviderReferenceStore;
  const providerMedia = mediaPublicationProductModules.providerMedia;
  providerMedia.configureProviderReferenceStore({
    async acquire(input) {
      if (input.ownerId !== MEDIA_PUBLICATION_FIXTURE.ownerId || input.kind !== "video") {
        return fallback.acquire(input);
      }
      const media = await readMediaPublicationDatabase((database) => database.prepare(`
        SELECT id, byte_size AS byteSize, checksum_sha256 AS checksumSha256,
          content_type AS contentType, duration_seconds AS durationSeconds,
          duration_source AS durationSource, duration_status AS durationStatus,
          media_width AS mediaWidth, media_height AS mediaHeight, storage_status AS storageStatus
        FROM media_assets WHERE owner_id = ? AND id = ? AND kind = 'video'
      `).get(input.ownerId, input.assetId));
      if (!media || media.storageStatus !== "ready") {
        return fallback.acquire(input);
      }
      return {
        assetId: media.id,
        byteSize: Number(media.byteSize),
        checksumSha256: String(media.checksumSha256),
        contentType: String(media.contentType),
        durationSeconds: media.durationSeconds == null ? null : Number(media.durationSeconds),
        durationSource: media.durationSource ?? null,
        durationStatus: media.durationStatus ?? "ready",
        kind: "video",
        leaseId: `video-query-workflow-relay-${randomUUID()}`,
        locator: {
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          transport: "signed-url",
          url: `${mediaPublicationProviderUrl}${mediaPublicationProviderResultPath}`,
        },
        mediaHeight: media.mediaHeight == null ? null : Number(media.mediaHeight),
        mediaWidth: media.mediaWidth == null ? null : Number(media.mediaWidth),
        ownerId: input.ownerId,
      };
    },
    async release(lease) {
      if (String(lease.leaseId).startsWith("video-query-workflow-relay-")) return;
      return fallback.release(lease);
    },
  });
}

async function simulateVideoQueryWorkflowHistoricalFailure(providerTaskId) {
  if (!videoQueryWorkflowProductMode || videoQueryWorkflowHistoricalFaultInjected ||
      !videoQueryWorkflowHistoricalRunId || providerTaskId !== videoQueryWorkflowHistoricalOriginalProviderTaskId) {
    return;
  }
  const updatedAt = new Date().toISOString();
  await readMediaPublicationDatabase((database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const task = database.prepare(`
        SELECT task.id, task.state, task.node_id AS nodeId, task.attempt,
          task.provider_task_id AS providerTaskId
        FROM generation_tasks AS task JOIN workflow_run_nodes AS node ON node.task_id = task.id
        WHERE task.owner_id = ? AND task.canvas_id = ? AND node.run_id = ?
          AND node.node_id = ? AND task.provider_task_id = ?
      `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId,
        videoQueryWorkflowHistoricalRunId, videoQueryWorkflowFixtureIds.historyVideoNodeId, providerTaskId);
      const run = database.prepare(`
        SELECT id, state, reservation_id AS reservationId FROM workflow_runs
        WHERE owner_id = ? AND id = ?
      `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, videoQueryWorkflowHistoricalRunId);
      if (!task || task.state === "success" || task.providerTaskId !== providerTaskId || !run || run.state === "failed") {
        database.exec("ROLLBACK");
        return;
      }
      database.prepare(`
        UPDATE workflow_run_nodes
        SET state = 'failed', projection_state = 'pending', error_code = 'GENERATION_FAILED',
          error_message = '历史运行在 Provider 查询期间意外终止', updated_at = ?
        WHERE run_id = ? AND node_id = ?
      `).run(updatedAt, videoQueryWorkflowHistoricalRunId, videoQueryWorkflowFixtureIds.historyVideoNodeId);
      database.prepare(`
        UPDATE workflow_run_nodes
        SET state = 'blocked', projection_state = 'pending', error_code = 'UPSTREAM_FAILED',
          error_message = '历史视频节点未结算，等待窄范围找回', updated_at = ?
        WHERE run_id = ? AND node_id = ?
      `).run(updatedAt, videoQueryWorkflowHistoricalRunId, videoQueryWorkflowFixtureIds.historyTailTextNodeId);
      database.prepare(`
        UPDATE workflow_runs
        SET state = 'failed', stop_requested = 0, error_code = 'GENERATION_FAILED',
          error_message = '历史运行在 Provider 查询期间意外终止', updated_at = ?
        WHERE owner_id = ? AND id = ?
      `).run(updatedAt, MEDIA_PUBLICATION_FIXTURE.ownerId, videoQueryWorkflowHistoricalRunId);
      database.prepare("DELETE FROM workflow_run_locks WHERE run_id = ?").run(videoQueryWorkflowHistoricalRunId);
      if (run.reservationId) {
        database.prepare(`
          UPDATE media_capacity_reservations
          SET state = 'released', released_at = COALESCE(released_at, ?), updated_at = ?
          WHERE id = ?
        `).run(updatedAt, updatedAt, run.reservationId);
      }
      database.exec("COMMIT");
      videoQueryWorkflowHistoricalOriginalTaskId = task.id;
      videoQueryWorkflowHistoricalFaultInjected = true;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  });
}

async function mediaPublicationTaskSnapshot() {
  return readMediaPublicationDatabase((database) => {
    const tasks = database.prepare(`
      SELECT id, node_id AS nodeId, kind, state, attempt, result_asset_id AS resultAssetId,
        error_code AS errorCode, provider_task_id AS providerTaskId
      FROM generation_tasks WHERE owner_id = ? AND canvas_id = ? ORDER BY id
    `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId);
    const canvas = database.prepare(`
      SELECT revision, graph_revision AS graphRevision, nodes, edges, viewport
      FROM canvas_documents WHERE owner_id = ? AND id = ?
    `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId);
    const parent = database.prepare(`
      SELECT id, state, graph_revision AS graphRevision FROM workflow_runs
      WHERE owner_id = ? AND id = ?
    `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.parentRunId);
    const child = database.prepare(`
      SELECT child_run_id AS childRunId, preview_digest AS previewDigest,
        selected_node_ids_json AS selectedNodeIds, frozen_external_inputs_json AS externalInputs
      FROM workflow_run_continuations WHERE owner_id = ? AND parent_run_id = ?
    `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.parentRunId);
    const childNodes = child
      ? database.prepare(`
          SELECT run_id AS runId, node_id AS nodeId, kind, plan_index AS planIndex,
            state, task_id AS taskId, projection_state AS projectionState,
            error_code AS errorCode, error_message AS errorMessage
          FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
        `).all(child.childRunId)
      : [];
    const canvasNodes = canvas?.nodes ? JSON.parse(canvas.nodes) : [];
    const pngNode = canvasNodes.find((node) => node.id === MEDIA_PUBLICATION_FIXTURE.pngNodeId);
    const saveRaceNode = canvasNodes.find((node) => node.id === MEDIA_PUBLICATION_FIXTURE.saveRaceNodeId);
    const successNodeIds = tasks.filter((task) => task.state === "success").map((task) => task.nodeId);
    return {
      tasks,
      canvas: canvas ? { ...canvas, nodes: canvasNodes, edges: JSON.parse(canvas.edges), viewport: JSON.parse(canvas.viewport) } : null,
      parent: parent ?? null,
      child: child ? { ...child, selectedNodeIds: JSON.parse(child.selectedNodeIds), externalInputs: JSON.parse(child.externalInputs) } : null,
      childNodes,
      pngNode: pngNode ? { id: pngNode.id, assetId: pngNode.data?.assetId ?? null, imageSrc: pngNode.data?.imageSrc ?? null } : null,
      saveRaceNode: saveRaceNode ? {
        id: saveRaceNode.id,
        assetId: saveRaceNode.data?.assetId ?? null,
        videoSrc: saveRaceNode.data?.videoSrc ?? null,
      } : null,
      successNodeIds,
    };
  });
}

const acceptanceDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForMediaPublicationChild(childRunId) {
  const deadline = Date.now() + 45_000;
  let lastSnapshot;
  while (Date.now() < deadline) {
    lastSnapshot = await mediaPublicationTaskSnapshot();
    const candidateNodes = lastSnapshot.childNodes.filter((node) =>
      [MEDIA_PUBLICATION_FIXTURE.pendingNodeId, MEDIA_PUBLICATION_FIXTURE.pendingTailNodeId]
        .includes(node.nodeId),
    );
    const candidateTasks = candidateNodes
      .map((node) => lastSnapshot.tasks.find((task) => task.id === node.taskId))
      .filter(Boolean);
    const failure = candidateNodes.find((node) =>
      ["failed", "blocked", "cancelled"].includes(node.state),
    ) ?? candidateTasks.find((task) => ["failed", "cancelled"].includes(task.state));
    if (failure) {
      throw new AcceptanceControlError(
        `下游视频未能自动完成：${failure.errorMessage ?? failure.errorCode ?? failure.state}`,
        "MEDIA_CONTINUATION_CHILD_FAILED",
        503,
      );
    }
    const projected = candidateNodes.length === 2 &&
      candidateNodes.every((node) => node.state === "success" && node.projectionState === "applied") &&
      candidateTasks.length === 2 && candidateTasks.every((task) => task.state === "success");
    const canvasNodes = new Map((lastSnapshot.canvas?.nodes ?? []).map((node) => [node.id, node]));
    const visible = [MEDIA_PUBLICATION_FIXTURE.pendingNodeId, MEDIA_PUBLICATION_FIXTURE.pendingTailNodeId]
      .every((nodeId) => {
        const node = canvasNodes.get(nodeId);
        return typeof node?.data?.assetId === "string" &&
          node.data.assetId.length > 0 &&
          typeof node.data?.videoSrc === "string" &&
          node.data.videoSrc.length > 0;
      });
    if (String(lastSnapshot.child?.childRunId ?? "") === childRunId && projected && visible) {
      return lastSnapshot;
    }
    await acceptanceDelay(250);
  }
  const state = lastSnapshot?.childNodes.map((node) => `${node.nodeId}:${node.state}/${node.projectionState}`).join(", ") ?? "无节点状态";
  throw new AcceptanceControlError(
    `下游视频仍在自动保存，暂未完成（${state}）。请稍后查看本页状态。`,
    "MEDIA_CONTINUATION_CHILD_PENDING",
    503,
  );
}

function mediaPublicationPreservedFingerprint(canvas) {
  const ids = new Set(MEDIA_PUBLICATION_FIXTURE.preservedNodeIds);
  const nodes = (canvas?.nodes ?? []).filter((node) => ids.has(node.id)).map((node) => ({
    id: node.id, type: node.type, parentId: node.parentId ?? null,
    position: node.position, style: node.style, data: node.data,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const edges = (canvas?.edges ?? []).filter((edge) => ids.has(edge.source) || ids.has(edge.target))
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? "", targetHandle: edge.targetHandle ?? "" }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return digest({ nodes, edges });
}

async function mediaPublicationStatusPayload() {
  if (!mediaPublicationFixture || !generationFixture) return { scenario: "media-publication", ready: false };
  const snapshot = await mediaPublicationTaskSnapshot();
  const preserveFingerprint = mediaPublicationPreservedFingerprint(snapshot.canvas);
  const successNodeIds = snapshot.successNodeIds.filter((id) => MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.includes(id));
  const adoptionTask = snapshot.tasks.find((task) => task.id === MEDIA_PUBLICATION_FIXTURE.adoptionTaskId);
  const child = snapshot.child;
  return {
    scenario: "media-publication",
    ready,
    syntheticOnly: true,
    actualProductCommands: true,
    paidProviderRequests: 0,
    canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
    groupId: MEDIA_PUBLICATION_FIXTURE.groupId,
    checks: { ...mediaPublicationChecks },
    counters: {
      ...mediaPublicationCounters,
      taskSuccesses: snapshot.tasks.filter((task) => task.state === "success").length,
      providerPosts: mediaPublicationProviderStats.posts,
      videoProviderPosts: mediaPublicationProviderStats.videoPosts,
      imageProviderPosts: mediaPublicationProviderStats.imagePosts,
      unknownProviderPosts: mediaPublicationProviderStats.unknownPosts,
      providerPostsByModel: mediaPublicationProviderStats.postsByModel,
      providerStatusGets: mediaPublicationProviderStats.gets,
      providerMediaGets: mediaPublicationProviderStats.mediaGets,
    },
    workflow: {
      parentRunId: MEDIA_PUBLICATION_FIXTURE.parentRunId,
      parentState: snapshot.parent?.state ?? "unknown",
      childRunId: child?.childRunId ?? null,
      candidateNodeIds: [MEDIA_PUBLICATION_FIXTURE.pendingNodeId, MEDIA_PUBLICATION_FIXTURE.pendingTailNodeId],
      preservedNodeIds: MEDIA_PUBLICATION_FIXTURE.preservedNodeIds,
      childExternalNodeIds: (child?.externalInputs ?? []).map((item) => item.nodeId),
      childSelectedNodeIds: child?.selectedNodeIds ?? [],
      childNodes: snapshot.childNodes,
    },
    adoption: {
      taskId: MEDIA_PUBLICATION_FIXTURE.adoptionTaskId,
      state: adoptionTask?.state ?? "unknown",
      canonicalAssetId: adoptionTask?.resultAssetId ?? null,
      projection: mediaPublicationLastResults.adoption?.projection ?? null,
      idempotentReplay: mediaPublicationLastResults.adoption?.idempotentReplay ?? false,
    },
    preserve: {
      expectedSuccessNodeCount: MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.length,
      successNodeCount: successNodeIds.length,
      successNodeIds,
      successNodesStillPresent: successNodeIds.length === MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.length,
      successContentLayoutAndEdgesUnchanged: preserveFingerprint === mediaPublicationFixture.initialPreservedFingerprint,
    },
    canvas: {
      revision: snapshot.canvas?.revision ?? null,
      graphRevision: snapshot.canvas?.graphRevision ?? null,
      adoptionNodeAssetId: snapshot.canvas?.nodes?.find((node) => node.id === MEDIA_PUBLICATION_FIXTURE.adoptionNodeId)?.data?.assetId ?? null,
      adoptionNodeImageSrc: snapshot.canvas?.nodes?.find((node) => node.id === MEDIA_PUBLICATION_FIXTURE.adoptionNodeId)?.data?.imageSrc ?? null,
      continuationVideoNodes: [MEDIA_PUBLICATION_FIXTURE.pendingNodeId, MEDIA_PUBLICATION_FIXTURE.pendingTailNodeId]
        .map((nodeId) => {
          const node = snapshot.canvas?.nodes?.find((candidate) => candidate.id === nodeId);
          return {
            nodeId,
            assetId: node?.data?.assetId ?? null,
            videoSrc: node?.data?.videoSrc ?? null,
          };
        }),
      pngNodeAssetId: snapshot.pngNode?.assetId ?? null,
      pngNodeImageSrc: snapshot.pngNode?.imageSrc ?? null,
      saveRaceNodeAssetId: snapshot.saveRaceNode?.assetId ?? null,
      saveRaceNodeVideoSrc: snapshot.saveRaceNode?.videoSrc ?? null,
    },
    evidence: {
      initialVideoProviderPosts: mediaPublicationInitialVideoProviderPosts,
      videoProviderPosts: mediaPublicationProviderStats.videoPosts,
      imageProviderPosts: mediaPublicationProviderStats.imagePosts,
      unknownProviderPosts: mediaPublicationProviderStats.unknownPosts,
      providerPostsByModel: mediaPublicationProviderStats.postsByModel,
      continuationVideoPostCount: mediaPublicationLastResults.continuation?.downstreamVideoProviderPosts ?? null,
      continuationVideoPostCountMatches: mediaPublicationChecks.continuation !== "done" ||
        mediaPublicationLastResults.continuation?.downstreamVideoProviderPosts === 2,
      noDuplicateContinuationVideoPost: mediaPublicationChecks.continuation !== "done" ||
        mediaPublicationProviderStats.videoPosts <= mediaPublicationInitialVideoProviderPosts + 2,
      noWholeGroupReplay: successNodeIds.length === MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.length,
      parentImmutableAfterContinuation: snapshot.parent?.state === "failed",
      childResultsProjected: [MEDIA_PUBLICATION_FIXTURE.pendingNodeId, MEDIA_PUBLICATION_FIXTURE.pendingTailNodeId]
        .every((nodeId) => {
          const node = snapshot.canvas?.nodes?.find((candidate) => candidate.id === nodeId);
          return typeof node?.data?.assetId === "string" && typeof node?.data?.videoSrc === "string";
        }),
      pngImageReferencePresent: snapshot.pngNode?.assetId === MEDIA_PUBLICATION_FIXTURE.pngAssetId &&
        snapshot.pngNode?.imageSrc === `/api/assets/${MEDIA_PUBLICATION_FIXTURE.pngAssetId}`,
      adoptedPngVisible: snapshot.canvas?.nodes?.some((node) =>
        node.id === MEDIA_PUBLICATION_FIXTURE.adoptionNodeId &&
        node.data?.assetId === MEDIA_PUBLICATION_FIXTURE.canonicalAssetId &&
        node.data?.imageSrc === `/api/assets/${MEDIA_PUBLICATION_FIXTURE.canonicalAssetId}`,
      ) === true,
      saveRaceVideoVisible: mediaPublicationChecks.saveRace !== "done" ||
        (typeof snapshot.saveRaceNode?.assetId === "string" &&
          snapshot.saveRaceNode.videoSrc === `/api/video-assets/${snapshot.saveRaceNode.assetId}`),
    },
    expiresAt: expiresAt.toISOString(),
  };
}

async function videoQueryWorkflowSnapshot() {
  return readMediaPublicationDatabase((database) => {
    const targetIds = [
      videoQueryWorkflowFixtureIds.activeVideoNodeId,
      videoQueryWorkflowFixtureIds.activeTailTextNodeId,
      videoQueryWorkflowFixtureIds.historyVideoNodeId,
      videoQueryWorkflowFixtureIds.historyTailTextNodeId,
    ];
    const placeholders = targetIds.map(() => "?").join(",");
    const tasks = database.prepare(`
      SELECT id, node_id AS nodeId, kind, state, attempt, result_asset_id AS resultAssetId,
        result_text AS resultText, error_code AS errorCode, provider_task_id AS providerTaskId
      FROM generation_tasks
      WHERE owner_id = ? AND canvas_id = ? AND node_id IN (${placeholders})
      ORDER BY id
    `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId, ...targetIds);
    const run = videoQueryWorkflowRunId
      ? database.prepare(`
          SELECT id, state, graph_revision AS graphRevision, semantic_fingerprint AS semanticFingerprint,
            error_code AS errorCode, error_message AS errorMessage
          FROM workflow_runs WHERE owner_id = ? AND id = ?
        `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, videoQueryWorkflowRunId)
      : null;
    const historyRun = videoQueryWorkflowHistoricalRunId
      ? database.prepare(`
          SELECT id, state, graph_revision AS graphRevision, semantic_fingerprint AS semanticFingerprint,
            error_code AS errorCode, error_message AS errorMessage
          FROM workflow_runs WHERE owner_id = ? AND id = ?
        `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, videoQueryWorkflowHistoricalRunId)
      : null;
    const runNodes = videoQueryWorkflowRunId
      ? database.prepare(`
          SELECT run_id AS runId, node_id AS nodeId, kind, plan_index AS planIndex,
            state, task_id AS taskId, projection_state AS projectionState,
            error_code AS errorCode, error_message AS errorMessage
          FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
        `).all(videoQueryWorkflowRunId)
      : [];
    const historyRunNodes = videoQueryWorkflowHistoricalRunId
      ? database.prepare(`
          SELECT run_id AS runId, node_id AS nodeId, kind, plan_index AS planIndex,
            state, task_id AS taskId, projection_state AS projectionState,
            error_code AS errorCode, error_message AS errorMessage
          FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
        `).all(videoQueryWorkflowHistoricalRunId)
      : [];
    const canvas = database.prepare(`
      SELECT revision, graph_revision AS graphRevision, nodes, edges, viewport
      FROM canvas_documents WHERE owner_id = ? AND id = ?
    `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId);
    const document = canvas
      ? { ...canvas, nodes: JSON.parse(canvas.nodes), edges: JSON.parse(canvas.edges), viewport: JSON.parse(canvas.viewport) }
      : null;
    const taskEvents = (taskId) => taskId
      ? database.prepare(`
          SELECT state, error_code AS errorCode, error_message AS errorMessage, created_at AS createdAt
          FROM generation_task_events WHERE task_id = ? ORDER BY id
        `).all(taskId)
      : [];
    const nodeSummary = (nodeId, taskId) => {
      const node = document?.nodes?.find((candidate) => candidate.id === nodeId);
      const task = taskId ? tasks.find((candidate) => candidate.id === taskId) : null;
      return {
        task: task ?? null,
        events: task ? taskEvents(task.id) : [],
        node: node ? {
          id: node.id,
          position: node.position,
          assetId: node.data?.assetId ?? null,
          videoSrc: node.data?.videoSrc ?? null,
          content: node.data?.content ?? null,
          generating: node.data?.videoGenerating ?? node.data?.textGenerating ?? null,
          errorCode: node.data?.videoGenerationErrorCode ?? node.data?.textGenerationErrorCode ?? null,
        } : null,
      };
    };
    const activeVideoRunNode = runNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.activeVideoNodeId);
    const activeTailRunNode = runNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.activeTailTextNodeId);
    const historyVideoRunNode = historyRunNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.historyVideoNodeId);
    const historyTailRunNode = historyRunNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.historyTailTextNodeId);
    const child = videoQueryWorkflowHistoricalRunId
      ? database.prepare(`
          SELECT id, child_run_id AS childRunId, preview_digest AS previewDigest,
            selected_node_ids_json AS selectedNodeIds, frozen_external_inputs_json AS externalInputs,
            canonical_adoption_receipt_id AS canonicalAdoptionReceiptId
          FROM workflow_run_continuations WHERE owner_id = ? AND parent_run_id = ?
        `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, videoQueryWorkflowHistoricalRunId)
      : null;
    const childNodes = child
      ? database.prepare(`
          SELECT run_id AS runId, node_id AS nodeId, kind, plan_index AS planIndex,
            state, task_id AS taskId, projection_state AS projectionState,
            error_code AS errorCode, error_message AS errorMessage
          FROM workflow_run_nodes WHERE run_id = ? ORDER BY plan_index
        `).all(child.childRunId)
      : [];
    const continuationTailNode = childNodes.find((node) =>
      node.nodeId === videoQueryWorkflowFixtureIds.historyTailTextNodeId,
    );
    const historyTailTaskId = continuationTailNode?.taskId ?? historyTailRunNode?.taskId;
    const historicalAdoptionCount = database.prepare(`
      SELECT COUNT(*) AS count FROM generation_result_adoptions
      WHERE owner_id = ? AND task_id = ?
    `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, videoQueryWorkflowHistoricalOriginalTaskId || "").count;
    return {
      run: run ?? null,
      runNodes,
      historyRun: historyRun ?? null,
      historyRunNodes,
      tasks,
      canvas: document,
      video: nodeSummary(videoQueryWorkflowFixtureIds.activeVideoNodeId, activeVideoRunNode?.taskId),
      tailText: nodeSummary(videoQueryWorkflowFixtureIds.activeTailTextNodeId, activeTailRunNode?.taskId),
      historyVideo: nodeSummary(videoQueryWorkflowFixtureIds.historyVideoNodeId, videoQueryWorkflowHistoricalOriginalTaskId || historyVideoRunNode?.taskId),
      historyTailText: nodeSummary(videoQueryWorkflowFixtureIds.historyTailTextNodeId, historyTailTaskId),
      child: child ? {
        ...child,
        selectedNodeIds: JSON.parse(child.selectedNodeIds),
        externalInputs: JSON.parse(child.externalInputs),
      } : null,
      childNodes,
      historicalAdoptionCount: Number(historicalAdoptionCount ?? 0),
    };
  });
}

async function videoQueryWorkflowStatusPayload() {
  if (!generationFixture || !mediaPublicationFixture || !videoQueryWorkflowSemanticFingerprint) {
    return { scenario: "video-query-workflow", ready: false, checks: { ...videoQueryWorkflowChecks } };
  }
  const snapshot = await videoQueryWorkflowSnapshot();
  if (videoQueryWorkflowChecks.start === "running" && snapshot.run?.state === "success" &&
      snapshot.video.task?.state === "success" && snapshot.video.node?.videoSrc &&
      snapshot.tailText.task?.state === "success" && snapshot.tailText.node?.content) {
    videoQueryWorkflowChecks.start = "done";
  }
  if (videoQueryWorkflowChecks.refresh === "running" && videoQueryWorkflowChecks.start === "done") {
    videoQueryWorkflowChecks.refresh = "done";
  }
  const responseRequests = mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/responses");
  const activeVideoPosts = mediaPublicationProviderStats.requests.filter((request) =>
    request.path === "/v1/media/generate" && request.phase === "active" && request.capability === "video",
  ).length;
  const historyVideoPosts = mediaPublicationProviderStats.requests.filter((request) =>
    request.path === "/v1/media/generate" && request.phase === "history" && request.capability === "video",
  ).length;
  const activeTextResponses = responseRequests.filter((request) => request.phase === "active").length;
  const historyTextResponses = responseRequests.filter((request) => request.phase === "history").length;
  const preservedCanvas = videoQueryWorkflowInitialCanvas;
  const currentCanvas = snapshot.canvas;
  const preservedNodesRemain = Boolean(preservedCanvas && currentCanvas) &&
    mediaPublicationPreservedFingerprint({
      nodes: currentCanvas.nodes,
      edges: currentCanvas.edges,
    }) === mediaPublicationPreservedFingerprint({
      nodes: preservedCanvas.nodes,
      edges: preservedCanvas.edges,
    });
  return {
    scenario: "video-query-workflow",
    ready,
    actualProductCommands: true,
    syntheticOnly: true,
    paidProviderRequests: 0,
    canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
    groupId: videoQueryWorkflowFixtureIds.activeGroupId,
    checks: { ...videoQueryWorkflowChecks },
    workflow: {
      runId: videoQueryWorkflowRunId || null,
      state: snapshot.run?.state ?? "not-started",
      semanticFingerprint: snapshot.run?.semanticFingerprint ?? videoQueryWorkflowSemanticFingerprint,
      graphRevision: snapshot.run?.graphRevision ?? videoQueryWorkflowGraphRevision,
      nodes: snapshot.runNodes,
    },
    video: snapshot.video,
    tailText: snapshot.tailText,
    history: {
      runId: videoQueryWorkflowHistoricalRunId || null,
      state: snapshot.historyRun?.state ?? "not-started",
      semanticFingerprint: snapshot.historyRun?.semanticFingerprint ?? videoQueryWorkflowHistoricalSemanticFingerprint,
      graphRevision: snapshot.historyRun?.graphRevision ?? videoQueryWorkflowGraphRevision,
      status: videoQueryWorkflowChecks.historyContinuation,
      synchronized: videoQueryWorkflowChecks.historySync === "done",
      continued: videoQueryWorkflowChecks.historyContinuation === "done",
      syncStatus: videoQueryWorkflowHistoricalSyncResult?.status ?? null,
      originalTaskId: videoQueryWorkflowHistoricalOriginalTaskId || null,
      originalProviderTaskId: videoQueryWorkflowHistoricalOriginalProviderTaskId || null,
      originalTask: snapshot.historyVideo.task,
      originalNode: snapshot.historyVideo.node,
      runNodes: snapshot.historyRunNodes,
      childRunId: snapshot.child?.childRunId ?? (videoQueryWorkflowHistoricalContinuationRunId || null),
      childSelectedNodeIds: snapshot.child?.selectedNodeIds ?? [],
      childExternalInputs: snapshot.child?.externalInputs ?? [],
      childNodes: snapshot.childNodes,
      downstreamNodeIds: [videoQueryWorkflowFixtureIds.historyTailTextNodeId],
      generationResultAdoptions: snapshot.historicalAdoptionCount,
    },
    provider: {
      posts: mediaPublicationProviderStats.posts,
      videoPosts: mediaPublicationProviderStats.videoPosts,
      statusGets: mediaPublicationProviderStats.gets,
      activeVideoPosts,
      historyVideoPosts,
      activeTextResponses,
      historyTextResponses,
      textResponses: responseRequests.length,
      arkInputVideoSeen: videoQueryWorkflowArkInputVideoSeen,
      profileLockInjected: videoQueryWorkflowProviderProfileLockInjected,
      queryInterruptions: videoQueryWorkflowProviderStatusFailures,
      acceptedVideoQueryRecoveryDiagnosticCount: videoQueryWorkflowAcceptedRecoveryDiagnosticCount,
      diagnosticStageCounts: Object.fromEntries(videoQueryWorkflowDiagnosticStageCounts),
      profileLockBusyObserved: videoQueryWorkflowProviderProfileLockInjected &&
        videoQueryWorkflowDiagnosticEvents.some((event) => event.taskId === snapshot.video.task?.id &&
          event.stage === "accepted-video-query-recovery" && event.errorName === "ProviderProfileLockBusyError" &&
          event.sourceErrorCode === "PROVIDER_LOCK_BUSY" && event.causeCode === "SQLITE_LOCK_CONTENTION"),
    },
    preserve: {
      activeResultVisible: typeof snapshot.video.node?.videoSrc === "string" && snapshot.video.node.videoSrc.length > 0,
      tailTextVisible: typeof snapshot.tailText.node?.content === "string" && snapshot.tailText.node.content.includes("视频查询尾部文字"),
      activeNodesRemainInCanvas: Boolean(snapshot.video.node && snapshot.tailText.node),
      historicalNodesRemainInCanvas: Boolean(snapshot.historyVideo.node && snapshot.historyTailText.node),
      preservedBaselineUnchanged: preservedNodesRemain,
      historicalParentUnchanged: snapshot.historyRun?.state === "failed",
      historyVideoNoSecondProviderPost: historyVideoPosts === 1,
      historyTailOnly: videoQueryWorkflowChecks.historyContinuation !== "done" ||
        (snapshot.child?.selectedNodeIds?.length === 1 &&
          snapshot.child.selectedNodeIds[0] === videoQueryWorkflowFixtureIds.historyTailTextNodeId),
    },
    expiresAt: expiresAt.toISOString(),
  };
}

async function waitForVideoQueryWorkflowCompletion() {
  const deadline = Date.now() + 90_000;
  let last;
  while (Date.now() < deadline) {
    last = await videoQueryWorkflowSnapshot();
    const videoReady = last.video.task?.state === "success" && typeof last.video.node?.videoSrc === "string";
    const tailReady = last.tailText.task?.state === "success" && typeof last.tailText.node?.content === "string" && last.tailText.node.content.includes("视频查询尾部文字");
    if (videoReady && tailReady) return last;
    const failure = [last.video.task, last.tailText.task].find((task) => ["failed", "cancelled"].includes(task?.state));
    if (failure) throw new AcceptanceControlError(
      `视频查询恢复未完成：${failure.errorCode ?? failure.state}`,
      "VIDEO_QUERY_WORKFLOW_FAILED",
      503,
    );
    await acceptanceDelay(250);
  }
  throw new AcceptanceControlError("视频查询仍在自动恢复，请稍后查看右侧画布。", "VIDEO_QUERY_WORKFLOW_PENDING", 503);
}

async function waitForVideoQueryWorkflowHistoricalLifecycle() {
  const deadline = Date.now() + 90_000;
  let last;
  while (Date.now() < deadline) {
    last = await videoQueryWorkflowSnapshot();
    const task = last.historyVideo.task;
    const runFailed = last.historyRun?.state === "failed";
    const nodeFailed = last.historyRunNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.historyVideoNodeId)?.state === "failed";
    const tailBlocked = last.historyRunNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.historyTailTextNodeId)?.state === "blocked";
    if (videoQueryWorkflowHistoricalFaultInjected && runFailed && nodeFailed && tailBlocked &&
        task?.state === "success" && typeof task.resultAssetId === "string" && task.resultAssetId) {
      return last;
    }
    const failure = task && ["failed", "cancelled"].includes(task.state) ? task : undefined;
    if (failure) throw new AcceptanceControlError(
      `历史原视频任务未能保存：${failure.errorCode ?? failure.state}`,
      "VIDEO_QUERY_WORKFLOW_HISTORY_SEED_FAILED",
      503,
    );
    await acceptanceDelay(250);
  }
  throw new AcceptanceControlError(
    `历史原视频尚未形成可找回证据：${last?.historyRun?.state ?? "无运行状态"}`,
    "VIDEO_QUERY_WORKFLOW_HISTORY_SEED_PENDING",
    503,
  );
}

async function runVideoQueryWorkflowStart() {
  if (videoQueryWorkflowChecks.start !== "idle") return videoQueryWorkflowStatusPayload();
  if (!videoQueryWorkflowSemanticFingerprint) throw new AcceptanceControlError("视频查询验收画布尚未准备完成。", "VIDEO_QUERY_WORKFLOW_NOT_READY", 503);
  const created = await api("/api/workflow-runs", "POST", {
    canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
    clientSemanticFingerprint: videoQueryWorkflowSemanticFingerprint,
    groupId: videoQueryWorkflowFixtureIds.activeGroupId,
  });
  const body = await created.json();
  const runId = body?.run?.id ?? body?.id;
  if (typeof runId !== "string" || !runId) throw new AcceptanceControlError("本地工作流没有成功启动。", "VIDEO_QUERY_WORKFLOW_START_FAILED", 503);
  videoQueryWorkflowRunId = runId;
  videoQueryWorkflowChecks.start = "running";
  return videoQueryWorkflowStatusPayload();
}

async function runVideoQueryWorkflowRefresh() {
  if (!["running", "done"].includes(videoQueryWorkflowChecks.start)) throw new AcceptanceControlError("请先启动第1项自动恢复。", "VIDEO_QUERY_WORKFLOW_ORDER", 409);
  const before = await videoQueryWorkflowSnapshot();
  const after = await videoQueryWorkflowSnapshot();
  if (!after.video.node || !after.tailText.node ||
      before.video.node?.position?.x !== after.video.node?.position?.x ||
      before.video.node?.position?.y !== after.video.node?.position?.y ||
      before.tailText.node?.position?.x !== after.tailText.node?.position?.x ||
      before.tailText.node?.position?.y !== after.tailText.node?.position?.y) {
    throw new AcceptanceControlError("刷新后结果或节点位置没有保持。", "VIDEO_QUERY_WORKFLOW_REFRESH_FAILED", 503);
  }
  const activeVideoPosts = mediaPublicationProviderStats.requests.filter((request) =>
    request.path === "/v1/media/generate" && request.phase === "active" && request.capability === "video",
  ).length;
  if (activeVideoPosts > 1) {
    throw new AcceptanceControlError("刷新期间重复提交了视频 Provider 请求。", "VIDEO_QUERY_WORKFLOW_DUPLICATE_ADMIT", 503);
  }
  videoQueryWorkflowChecks.refresh = "running";
  return videoQueryWorkflowStatusPayload();
}

async function runVideoQueryWorkflowHistorySync() {
  if (videoQueryWorkflowChecks.refresh !== "done") throw new AcceptanceControlError("请先完成前两项。", "VIDEO_QUERY_WORKFLOW_ORDER", 409);
  if (videoQueryWorkflowChecks.historySync !== "idle") return videoQueryWorkflowStatusPayload();
  const before = await videoQueryWorkflowSnapshot();
  const originalTask = before.historyVideo.task;
  if (!videoQueryWorkflowHistoricalRunId || !videoQueryWorkflowHistoricalOriginalTaskId ||
      originalTask?.state !== "success" || !originalTask.resultAssetId) {
    throw new AcceptanceControlError("历史原视频证据尚未完整保存，请稍后重试。", "VIDEO_QUERY_WORKFLOW_HISTORY_NOT_READY", 409);
  }
  await loadMediaPublicationSourceModules();
  const input = {
    canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
    executionAttempt: Number(originalTask.attempt),
    nodeId: videoQueryWorkflowFixtureIds.historyVideoNodeId,
    ownerId: MEDIA_PUBLICATION_FIXTURE.ownerId,
    runId: videoQueryWorkflowHistoricalRunId,
    taskId: videoQueryWorkflowHistoricalOriginalTaskId,
  };
  const result = await readMediaPublicationDatabase((database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const inspected = mediaPublicationProductModules.workflowRunService.inspectHistoricalWorkflowResultSyncInTransaction(database, input);
      const synced = inspected.status === "ready"
        ? mediaPublicationProductModules.workflowRunService.syncHistoricalWorkflowResultInTransaction(database, input)
        : inspected;
      database.exec("COMMIT");
      return synced;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  });
  videoQueryWorkflowHistoricalSyncResult = result;
  if (!result || !["applied", "already-synced"].includes(result.status)) {
    throw new AcceptanceControlError(
      `历史原视频找回未完成：${result?.reason ?? result?.status ?? "未知原因"}`,
      "VIDEO_QUERY_WORKFLOW_HISTORY_SYNC_FAILED",
      503,
    );
  }
  const after = await videoQueryWorkflowSnapshot();
  if (after.historyVideo.node?.assetId !== originalTask.resultAssetId ||
      typeof after.historyVideo.node?.videoSrc !== "string" ||
      after.historyVideo.node.videoSrc.length === 0 ||
      after.historicalAdoptionCount !== 0) {
    throw new AcceptanceControlError("历史同步没有只投影原视频，未继续后续节点。", "VIDEO_QUERY_WORKFLOW_HISTORY_SYNC_VERIFY_FAILED", 503);
  }
  videoQueryWorkflowChecks.historySync = "done";
  videoQueryWorkflowHistoryResult = result;
  return videoQueryWorkflowStatusPayload();
}

async function runVideoQueryWorkflowHistoryContinuation() {
  if (videoQueryWorkflowChecks.historySync !== "done") throw new AcceptanceControlError("请先点击“找回原视频”。", "VIDEO_QUERY_WORKFLOW_ORDER", 409);
  if (videoQueryWorkflowChecks.historyContinuation !== "idle") return videoQueryWorkflowStatusPayload();
  if (!videoQueryWorkflowHistoricalRunId) throw new AcceptanceControlError("历史整组执行尚未准备完成。", "VIDEO_QUERY_WORKFLOW_HISTORY_NOT_READY", 409);
  const previewResponse = await api(`/api/workflow-runs/${videoQueryWorkflowHistoricalRunId}/continuation-preview`);
  const preview = await previewResponse.json();
  if (!Array.isArray(preview?.candidateNodeIds) ||
      preview.candidateNodeIds.length !== 1 ||
      preview.candidateNodeIds[0] !== videoQueryWorkflowFixtureIds.historyTailTextNodeId ||
      !Array.isArray(preview.externalInputs) ||
      !preview.externalInputs.some((input) => input.nodeId === videoQueryWorkflowFixtureIds.historyVideoNodeId && input.sourceTaskId === videoQueryWorkflowHistoricalOriginalTaskId)) {
    throw new AcceptanceControlError("继续预览没有锁定历史尾部节点，已停止提交。", "VIDEO_QUERY_WORKFLOW_HISTORY_PREVIEW_FAILED", 503);
  }
  const beforeCounts = {
    historyVideoPosts: mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/media/generate" && request.phase === "history" && request.capability === "video").length,
    historyTextResponses: mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/responses" && request.phase === "history").length,
  };
  const intentId = `video-query-workflow-history-${randomUUID()}`;
  const continued = await api(`/api/workflow-runs/${videoQueryWorkflowHistoricalRunId}/continue`, "POST", {
    intentId,
    previewDigest: preview.previewDigest,
  });
  const body = await continued.json();
  const childRunId = body?.run?.id ?? body?.continuation?.childRunId;
  if (typeof childRunId !== "string" || !childRunId) throw new AcceptanceControlError("历史尾部没有成功进入继续执行。", "VIDEO_QUERY_WORKFLOW_HISTORY_CONTINUE_FAILED", 503);
  videoQueryWorkflowHistoricalContinuationRunId = childRunId;
  const deadline = Date.now() + 90_000;
  let last;
  while (Date.now() < deadline) {
    last = await videoQueryWorkflowSnapshot();
    const tailNode = last.childNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.historyTailTextNodeId);
    const tailTask = tailNode?.taskId ? last.tasks.find((task) => task.id === tailNode.taskId) : null;
    if (tailNode?.state === "success" && tailNode.projectionState === "applied" &&
        tailTask?.state === "success" && typeof last.historyTailText.node?.content === "string" &&
        last.historyTailText.node.content.includes("视频查询尾部文字")) {
      const historyVideoPosts = mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/media/generate" && request.phase === "history" && request.capability === "video").length;
      const historyTextResponses = mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/responses" && request.phase === "history").length;
      if (historyVideoPosts !== beforeCounts.historyVideoPosts || historyTextResponses !== beforeCounts.historyTextResponses + 1 ||
          !videoQueryWorkflowArkInputVideoSeen) {
        throw new AcceptanceControlError("继续执行没有满足尾部单次提交或 input_video 证据。", "VIDEO_QUERY_WORKFLOW_HISTORY_CONTINUE_EVIDENCE_FAILED", 503);
      }
      videoQueryWorkflowChecks.historyContinuation = "done";
      return videoQueryWorkflowStatusPayload();
    }
    const failure = [tailNode, tailTask].find((item) => ["failed", "cancelled", "blocked"].includes(item?.state));
    if (failure) throw new AcceptanceControlError(
      `历史尾部未能完成：${failure.errorCode ?? failure.state}`,
      "VIDEO_QUERY_WORKFLOW_HISTORY_CONTINUE_FAILED",
      503,
    );
    await acceptanceDelay(250);
  }
  throw new AcceptanceControlError("历史尾部仍在保存，请稍后查看右侧画布。", "VIDEO_QUERY_WORKFLOW_HISTORY_CONTINUE_PENDING", 503);
}

async function runMediaPublicationSaveRace() {
  if (mediaPublicationChecks.saveRace !== "idle") return mediaPublicationStatusPayload();
  await loadMediaPublicationSourceModules();
  const before = await (await api(`/api/canvas/${MEDIA_PUBLICATION_FIXTURE.canvasId}`)).json();
  const beforeFingerprint = mediaPublicationPreservedFingerprint(before);
  const video = await readFile(join(sourceRoot, "client", "public", "fixtures", "video-success.mp4"));
  const modules = mediaPublicationProductModules;
  const store = modules.generationTaskStore.createGenerationTaskStore(dataRoot, { recoverRunning: false });
  let savePromise;
  let releaseBody;
  try {
    const created = store.create({
      canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
      credentialRevision: mediaPublicationFixture.videoCredentialVersion,
      idempotencyKey: `media-acceptance-save-race-${randomUUID()}`,
      kind: "video",
      model: mediaPublicationFixture.saveRaceModelConfiguration.modelId,
      modelConfiguration: mediaPublicationFixture.saveRaceModelConfiguration,
      nodeId: MEDIA_PUBLICATION_FIXTURE.saveRaceNodeId,
      ownerId: MEDIA_PUBLICATION_FIXTURE.ownerId,
      parameters: mediaPublicationFixture.saveRaceParameters,
      prompt: mediaPublicationFixture.saveRacePrompt,
      providerModelId: mediaPublicationFixture.models.video.providerModelId,
      providerProfileId: mediaPublicationFixture.models.video.providerProfileId,
    }).task;
    const running = store.transition(created.id, "running");
    if (!running) throw new Error("保存竞争验收任务没有进入运行中");
    store.recordProviderAttempt(created.id);

    let pulled;
    const pulledPromise = new Promise((resolve) => { pulled = resolve; });
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    let delivered = false;
    const body = new ReadableStream({
      pull(controller) {
        if (delivered) return;
        delivered = true;
        pulled();
        return released.then(() => {
          controller.enqueue(new Uint8Array(video));
          controller.close();
        });
      },
    }, { highWaterMark: 0 });
    releaseBody = () => release?.();
    savePromise = modules.videoStorage.saveGeneratedMp4({
      body,
      label: "媒体保存竞争视频",
      ownerId: MEDIA_PUBLICATION_FIXTURE.ownerId,
      task: {
        actualCostMicrounits: 0,
        executionAttempt: running.attempt,
        outputSetCount: 1,
        outputSlot: 0,
        taskId: created.id,
      },
    });
    await Promise.race([pulledPromise, savePromise]);

    const readLiveState = () => readMediaPublicationDatabase((database) => ({
      task: database.prepare(`
        SELECT state, result_asset_id AS resultAssetId
        FROM generation_tasks WHERE id = ?
      `).get(created.id),
      publication: database.prepare(`
        SELECT attempt_id AS attemptId, state, asset_id AS assetId
        FROM media_publication_attempts
        WHERE task_id = ? AND task_execution_attempt = ?
      `).get(created.id, running.attempt),
    }));
    const duringBefore = await readLiveState();
    await modules.generationTasks.runGenerationRecoverySweep({
      hasPendingGenerated: () => true,
      recoverPending: () => modules.generationResultCommit.recoverPendingGenerationMediaResults(),
      store,
    });
    const duringAfter = await readLiveState();
    if (duringBefore.task?.state !== "running" || duringBefore.publication?.state !== "reserved" ||
        duringAfter.task?.state !== "running" || duringAfter.publication?.state !== "reserved") {
      throw new AcceptanceControlError(
        "视频仍在保存时，自动恢复扫描改变了任务或预留记录。",
        "MEDIA_SAVE_RACE_LIVE_LEASE_BROKEN",
        503,
      );
    }

    releaseBody();
    const saved = await savePromise;
    if (!saved?.publicationToken) throw new Error("保存竞争没有返回发布凭据");
    const published = modules.generationResultCommit.publishGenerationMediaCandidate(saved.publicationToken);
    if (published.state !== "published") throw new Error("保存竞争候选视频没有发布");
    const committed = modules.generationResultCommit.commitGenerationMediaOutputSet({
      assetIds: [saved.assetId],
      executionAttempt: running.attempt,
      kind: "video",
      ownerId: MEDIA_PUBLICATION_FIXTURE.ownerId,
      taskId: created.id,
    });
    if (committed.state !== "success" || committed.projectionState !== "applied") {
      const diagnostic = await readMediaPublicationDatabase((database) => {
        database.exec("BEGIN DEFERRED");
        try {
          const built = modules.generationCanvasProjection.buildCanvasProjectionIdentity({
            database, taskId: created.id, kind: "video",
            canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
            nodeId: MEDIA_PUBLICATION_FIXTURE.saveRaceNodeId,
            ownerId: MEDIA_PUBLICATION_FIXTURE.ownerId,
          });
          return built.status === "failed" ? built.reason : `bindingMatches=${built.projection.bindingMatches}`;
        } finally { database.exec("ROLLBACK"); }
      });
      console.error(`[media-publication-acceptance] projection diagnostic: ${diagnostic}`);
      throw new AcceptanceControlError(
        `视频保存完成但画布投影未成功（${committed.projectionState}）。`,
        "MEDIA_SAVE_RACE_PROJECTION_FAILED",
        503,
      );
    }
    const after = await (await api(`/api/canvas/${MEDIA_PUBLICATION_FIXTURE.canvasId}`)).json();
    const node = after.nodes.find((candidate) => candidate.id === MEDIA_PUBLICATION_FIXTURE.saveRaceNodeId);
    const localVideoResponse = await fetch(`${origin}/api/video-assets/${encodeURIComponent(saved.assetId)}`, {
      headers: { Cookie: adminCookie },
      redirect: "manual",
    });
    const downloadedVideo = Buffer.from(await localVideoResponse.arrayBuffer());
    const localVideoVisible = localVideoResponse.status === 200 &&
      localVideoResponse.headers.get("content-type")?.startsWith("video/mp4") === true &&
      downloadedVideo.equals(video);
    if (mediaPublicationPreservedFingerprint(after) !== beforeFingerprint ||
        node?.data?.assetId !== saved.assetId ||
        node?.data?.videoSrc !== `/api/video-assets/${saved.assetId}` ||
        !localVideoVisible) {
      throw new AcceptanceControlError(
        "保存完成后视频没有安全投影到预置节点，或原成功节点内容发生变化。",
        "MEDIA_SAVE_RACE_PRESERVE_FAILED",
        503,
      );
    }
    const finalState = await readMediaPublicationDatabase((database) => ({
      task: database.prepare(`
        SELECT state, result_asset_id AS resultAssetId
        FROM generation_tasks WHERE id = ?
      `).get(created.id),
      publication: database.prepare(`
        SELECT attempt_id AS attemptId, state, asset_id AS assetId
        FROM media_publication_attempts
        WHERE task_id = ? AND task_execution_attempt = ?
      `).get(created.id, running.attempt),
      media: database.prepare(`
        SELECT storage_status AS storageStatus, storage_backend AS storageBackend,
          byte_size AS byteSize, checksum_sha256 AS checksumSha256,
          duration_seconds AS durationSeconds
        FROM media_assets WHERE owner_id = ? AND kind = 'video' AND id = ?
      `).get(MEDIA_PUBLICATION_FIXTURE.ownerId, saved.assetId),
    }));
    mediaPublicationLastResults.saveRace = {
      afterRevision: after.revision,
      assetId: saved.assetId,
      localVideoStatus: localVideoResponse.status,
      automatic: true,
      beforeRevision: before.revision,
      duringRecovery: { before: duringBefore, after: duringAfter },
      finalState,
      videoByteSize: video.length,
      videoChecksumSha256: createHash("sha256").update(video).digest("hex"),
      productSaveAndRecoveryRace: true,
    };
    mediaPublicationChecks.saveRace = "done";
    return mediaPublicationStatusPayload();
  } finally {
    releaseBody?.();
    if (savePromise) await savePromise.catch(() => undefined);
    store.close();
  }
}

async function runMediaPublicationAdoption() {
  if (mediaPublicationChecks.adoption !== "idle") return mediaPublicationStatusPayload();
  await loadMediaPublicationSourceModules();
  const input = {
    ownerId: MEDIA_PUBLICATION_FIXTURE.ownerId,
    taskId: MEDIA_PUBLICATION_FIXTURE.adoptionTaskId,
    executionAttempt: 1,
    kind: "image",
    incidentDigest: "d".repeat(64),
    canonicalAttemptId: MEDIA_PUBLICATION_FIXTURE.canonicalAttemptId,
    aliasAttemptId: MEDIA_PUBLICATION_FIXTURE.aliasAttemptId,
    mode: "apply",
  };
  const first = await mediaPublicationAdapter.applyRealGenerationResultAdoption(input);
  const second = await mediaPublicationAdapter.applyRealGenerationResultAdoption(input);
  if (!first || first.projection !== "project-canonical" || !second?.idempotent || second.providerPostCount !== 0) {
    throw new AcceptanceControlError("原 PNG 结果没有通过真实采用与幂等复核，未继续提交新请求。", "MEDIA_ADOPTION_VERIFY_FAILED", 503);
  }
  const canvas = await (await api(`/api/canvas/${MEDIA_PUBLICATION_FIXTURE.canvasId}`)).json();
  const node = canvas.nodes.find((candidate) => candidate.id === MEDIA_PUBLICATION_FIXTURE.adoptionNodeId);
  if (node?.data?.assetId !== MEDIA_PUBLICATION_FIXTURE.canonicalAssetId ||
      node?.data?.imageSrc !== `/api/assets/${MEDIA_PUBLICATION_FIXTURE.canonicalAssetId}`) {
    throw new AcceptanceControlError("原 PNG 结果已核对，但画布节点没有指向已保存素材。", "MEDIA_ADOPTION_PROJECTION_FAILED", 503);
  }
  mediaPublicationCounters.taskSuccesses = 1;
  mediaPublicationLastResults.adoption = { first, second, projection: first.projection, idempotentReplay: second.idempotent };
  mediaPublicationChecks.adoption = "done";
  return mediaPublicationStatusPayload();
}

async function runMediaPublicationContinuation() {
  if (mediaPublicationChecks.continuation !== "idle") return mediaPublicationStatusPayload();
  if (mediaPublicationChecks.adoption !== "done") {
    throw new AcceptanceControlError("请先点第2项，系统会先自动找回原 PNG 结果。", "MEDIA_CONTINUATION_ADOPTION_REQUIRED", 409);
  }
  const providerPostsBefore = mediaPublicationProviderStats.posts;
  const videoProviderPostsBefore = mediaPublicationProviderStats.videoPosts;
  const previewResponse = await api(`/api/workflow-runs/${MEDIA_PUBLICATION_FIXTURE.parentRunId}/continuation-preview`);
  const preview = await previewResponse.json();
  if (preview.parentState !== "failed" || preview.candidateNodeIds.length !== 2 || preview.externalInputs.length !== 1 || preview.externalInputs[0].nodeId !== MEDIA_PUBLICATION_FIXTURE.adoptionNodeId) {
    throw new AcceptanceControlError("系统没有形成只继续未完成节点的安全预览，未提交。", "MEDIA_CONTINUATION_PREVIEW_FAILED", 503);
  }
  const intentId = `media-acceptance-${randomUUID()}`;
  const createdResponse = await api(`/api/workflow-runs/${MEDIA_PUBLICATION_FIXTURE.parentRunId}/continue`, "POST", { intentId, previewDigest: preview.previewDigest });
  const created = await createdResponse.json();
  const relation = await (await api(`/api/workflow-runs/${MEDIA_PUBLICATION_FIXTURE.parentRunId}/continuation`)).json();
  if (relation.continuation?.previewDigest !== preview.previewDigest || relation.continuation?.childRunId !== created.run?.id) {
    throw new AcceptanceControlError("继续任务已经提交，但系统找回的关系与本次预览不一致。", "MEDIA_CONTINUATION_RELATION_MISMATCH", 503);
  }
  const settled = await waitForMediaPublicationChild(created.run.id);
  const downstreamProviderPosts = mediaPublicationProviderStats.posts - providerPostsBefore;
  const downstreamVideoProviderPosts = mediaPublicationProviderStats.videoPosts - videoProviderPostsBefore;
  const expectedVideoProviderPosts = mediaPublicationInitialVideoProviderPosts + 2;
  if (downstreamVideoProviderPosts !== 2 ||
      mediaPublicationProviderStats.videoPosts !== expectedVideoProviderPosts ||
      mediaPublicationProviderStats.imagePosts !== 0 ||
      mediaPublicationProviderStats.unknownPosts !== 0 ||
      downstreamProviderPosts !== 2) {
    throw new AcceptanceControlError(
      `下游视频提交次数不符合预期（按请求模型识别：本次视频 ${downstreamVideoProviderPosts}，累计视频 ${mediaPublicationProviderStats.videoPosts}，图片 ${mediaPublicationProviderStats.imagePosts}，未知 ${mediaPublicationProviderStats.unknownPosts}）。`,
      "MEDIA_CONTINUATION_PROVIDER_COUNT",
      503,
    );
  }
  mediaPublicationLastResults.continuation = {
    preview,
    created,
    relation,
    settledChild: settled.childNodes,
    providerPostsBefore,
    videoProviderPostsBefore,
    providerPosts: mediaPublicationProviderStats.posts,
    downstreamProviderPosts,
    downstreamVideoProviderPosts,
    providerPostsByModel: { ...mediaPublicationProviderStats.postsByModel },
    getOnlyReconciliation: true,
  };
  mediaPublicationChecks.continuation = "done";
  return mediaPublicationStatusPayload();
}

async function runMediaPublicationNormal() {
  if (mediaPublicationChecks.normal !== "idle") return mediaPublicationStatusPayload();
  const snapshot = await mediaPublicationTaskSnapshot();
  if (snapshot.parent?.state !== "failed" || mediaPublicationChecks.continuation !== "done") {
    throw new AcceptanceControlError("请先完成前3项，系统才能核对正常功能仍保留。", "MEDIA_NORMAL_REGRESSION_ORDER", 409);
  }
  const continuationResultsVisible = [MEDIA_PUBLICATION_FIXTURE.pendingNodeId, MEDIA_PUBLICATION_FIXTURE.pendingTailNodeId]
    .every((nodeId) => {
      const node = snapshot.canvas?.nodes?.find((candidate) => candidate.id === nodeId);
      return typeof node?.data?.assetId === "string" && typeof node.data?.videoSrc === "string";
    });
  const adoptedPngVisible = snapshot.canvas?.nodes?.some((node) =>
    node.id === MEDIA_PUBLICATION_FIXTURE.adoptionNodeId &&
    node.data?.assetId === MEDIA_PUBLICATION_FIXTURE.canonicalAssetId &&
    node.data?.imageSrc === `/api/assets/${MEDIA_PUBLICATION_FIXTURE.canonicalAssetId}`,
  ) === true;
  if (mediaPublicationPreservedFingerprint(snapshot.canvas) !== mediaPublicationFixture.initialPreservedFingerprint || snapshot.successNodeIds.filter((id) => MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.includes(id)).length !== MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.length || snapshot.pngNode?.assetId !== MEDIA_PUBLICATION_FIXTURE.pngAssetId || snapshot.pngNode?.imageSrc !== `/api/assets/${MEDIA_PUBLICATION_FIXTURE.pngAssetId}` || !adoptedPngVisible || !continuationResultsVisible) {
    throw new AcceptanceControlError("正常功能核对失败：成功节点没有完整保留。", "MEDIA_NORMAL_REGRESSION_FAILED", 503);
  }
  mediaPublicationLastResults.normal = { canvasRead: true, preservedSuccessNodes: true, continuationResultsVisible: true, parentImmutable: true };
  mediaPublicationChecks.normal = "done";
  return mediaPublicationStatusPayload();
}

async function startMediaPublicationAction(action) {
  if (action === "save-race") return runMediaPublicationSaveRace();
  if (action === "adoption") return runMediaPublicationAdoption();
  if (action === "continuation") return runMediaPublicationContinuation();
  if (action === "normal") return runMediaPublicationNormal();
  throw new AcceptanceControlError("未知验收项目。", "MEDIA_ACCEPTANCE_ACTION_INVALID", 400);
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
    ...(kind === "video" ? { videoGeneratedResult: true } : {}),
    ...(kind === "audio" ? { audioGeneratedResult: true, audioResultChoices: [{ ...task.resultMedia, assetId: task.assetId, url: resultUrl, role: "primary" }] } : {}),
  };
}

function generationTaskFailure(task) {
  const kind = task.kind;
  return {
    [`${kind}Generating`]: false,
    [`${kind}GenerationTaskId`]: task.id,
    [`${kind}GenerationError`]: task.errorMessage,
    [`${kind}GenerationErrorCode`]: task.errorCode,
    [`${kind}GenerationInputKey`]: task.generationInputKey,
    [`${kind}GenerationModelConfigurationRevision`]: task.modelConfigurationRevision,
    [`${kind}GenerationModelReleaseRevision`]: task.modelReleaseRevision,
    [`${kind}GenerationOwnershipKey`]: task.generationOwnershipKey,
    [`${kind}GenerationRetryAllowed`]: task.retryAllowed === true,
    [`${kind}GenerationRetryBlockCode`]: task.retryBlockCode,
    [`${kind}GenerationRetryBlockReason`]: task.retryBlockReason,
    newGenerationAllowed: task.newGenerationAllowed,
    newGenerationBlockReason: task.newGenerationBlockReason,
    replacementTaskId: task.replacementTaskId,
    ...(kind === "video"
      ? { videoGenerationModelInputContractFingerprint: task.modelInputContractFingerprint }
      : { [`${kind}GenerationContractFingerprint`]: task.modelInputContractFingerprint }),
    ...(task.rawProviderMessage
      ? { providerRawError: task.rawProviderMessage, [`${kind}GenerationRawError`]: task.rawProviderMessage }
      : {}),
  };
}

async function persistGenerationProjection(task) {
  if (task.projectionPersisted || task.state !== "success") return;
  if (nodeRecoveryScenario && task.nodeId === nodeRecoveryFixture?.automaticRecovery.save.id &&
      nodeRecoveryState.saveFaultRemaining > 0) {
    nodeRecoveryState.saveFaultRemaining -= 1;
    persistGenerationJournal('syntheticProjectionDeferred', { taskId: task.id, remaining: nodeRecoveryState.saveFaultRemaining });
    return;
  }
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
      if (!nodeRecoveryScenario) await persistGenerationProjection(task);
      persistGenerationJournal("taskSuccess", { taskId: task.id, projectionPersisted: task.projectionPersisted });
    }
    if (task.state === 'success' && !task.projectionPersisted) await persistGenerationProjection(task);
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
  const definition = nodeRecoveryScenario && task
    ? nodeRecoveryFixture?.nodes.find(node => node.id === task.nodeId)
    : undefined;
  const data = {
    label: definition?.label ?? kind[0].toUpperCase() + kind.slice(1),
    title: definition?.title ?? `${({text: "文字", image: "图片", video: "视频", audio: "音频"})[kind]}查询验收`,
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
  if (nodeRecoveryScenario) return nodeRecoveryCanvasNodes();
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

function nodeRecoveryCanvasNodes() {
  if (!nodeRecoveryFixture) return [];
  return nodeRecoveryFixture.nodes.map((definition) => {
    const task = generationTasks.get(definition.id);
    if (!task) throw new Error(`Node recovery fixture task is missing: ${definition.id}`);
    const data = {
      ...generationNodeData(task.kind, "shared", task, task.identity, task.state === "running" || (task.state === "success" && !task.projectionPersisted)),
      label: definition.label,
      title: definition.title ?? definition.label,
      ...(task.state === "success" && task.projectionPersisted ? generationTaskResult(task) : {}),
      ...(task.state === "failed" ? generationTaskFailure(task) : {}),
    };
    return {
      id: definition.id,
      type: definition.type,
      position: definition.position,
      data,
      style: definition.style ?? {
        width: definition.type === "image" ? 300 : 260,
        height: definition.type === "image" ? 190 : 220,
      },
    };
  });
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
  if (nodeRecoveryScenario || videoQueryWorkflowScenario) return Object.freeze({
    candidateLoaded: candidateHits,
    candidate: { root: realpathSync(candidateRoot), sha256: generationBuildDigest(candidateRoot), manifest: generationBundleManifest(candidateRoot) },
    candidateSource: Object.fromEntries(generationBaselineFiles.map(file => [file,
      createHash('sha256').update(readFileSync(join(sourceRoot, file))).digest('hex')])),
  });
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
  const root = generationBuilds[match[1]]?.root;
  if (!root) return undefined;
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

function nodeRecoveryGuideHtml() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地验收 · 失败节点恢复</title>
<style>*{box-sizing:border-box}body{margin:0;font:15px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f4;color:#222}.layout{display:grid;grid-template-columns:350px minmax(600px,1fr);height:100vh}.guide{overflow:auto;padding:20px}h1{font-size:23px;margin:0 0 10px}h2{font-size:18px;margin:0 0 7px}p{margin:8px 0}section{background:#fff;border:1px solid #ddd;border-radius:12px;padding:16px;margin:14px 0}button{font:inherit;border:1px solid #aaa;border-radius:8px;background:white;padding:8px 12px;margin:4px 4px 4px 0;cursor:pointer}button.primary{background:#222;color:white}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:3px solid #417ca8;outline-offset:2px}.expect{background:#eef4ef;border-radius:7px;padding:10px}.feedback{color:#3d6250}.error{color:#a12424;background:#fff0f0;padding:12px;overflow-wrap:anywhere}.muted{font-size:13px;color:#666}iframe{width:100%;height:100%;border:0;background:#111}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin-top:16px}</style>
<div class="layout"><main class="guide"><h1>这次验收3项</h1><p>右边就是测试画布，不用切换标签。<b>全部是模拟任务，不会扣费，本轮还没上线</b>。</p><div id="error" class="error" role="alert" hidden></div><p id="connection" class="feedback" role="status">正在准备画布…</p>
<section><h2>1. 自动找回原结果</h2><p>点一次按钮。右边会自动移到并选中原节点，模拟短暂查询故障；等待同一节点出现原结果，期间不用点“恢复”或重新生成。</p><button class="primary" data-action="transient">开始自动找回原结果</button><p class="expect">看选中的文字框：先是等待状态，随后同一位置自动出现“短暂故障已自动越过 · 结果已回到当前节点”。不用点重试，也不用复制内容。</p><p id="transient-status" class="feedback" role="status"></p></section>
<section><h2>2. 维护进度能在重开后看见</h2><p>点一次按钮。左侧会自动展示中文阶段“已登记待处理 → 维护人员已接手 → 正在等待平台回复”，不需要你填写任务号或切换页面。</p><button class="primary" data-action="maintenance-start">开始维护进度演示</button><button data-action="maintenance-reopen">重新打开处理进度</button><p id="maintenance-status" class="feedback" role="status">尚未开始维护进度演示。</p><p class="expect">最后应看到“维护人员已接手，正在等待平台回复”。点“重新打开处理进度”后，这个阶段仍应显示；这里模拟维护人员接手，方便你检查页面显示。</p></section>
<section><h2>3. 已核实失败，只补当前视频</h2><p>选一种已核实的失败原因，右边会自动定位到失败视频。点击视频，再点节点输入框右下角的白色向上箭头；只观察当前视频出现结果。</p><button class="primary" data-mode="balance-denied">演示：余额问题已核实未受理</button><button data-mode="provider-failed">演示：平台最终失败已核实</button><p class="expect">只补出这个视频；前面的9个成功节点、位置、内容和连线保留。两种原因都是模拟的，不会调用真实模型。</p><button data-action="overview">查看全部</button><p id="retry-status" class="feedback" role="status"></p></section>
<details id="v3-regression"><summary>已通过的 V3 基础回归（内部保留，不是本轮三项）</summary><p>下面按钮只供工程复核保留：图片保存恢复和未知请求保护仍可复查，用户无需操作。</p><button class="primary" data-action="save">开始图片保存恢复</button><button data-action="refresh">刷新右侧画布</button><button data-action="unknown">查看无法确认的节点</button><p id="save-status" class="feedback" role="status"></p><p class="expect">图片保存恢复后刷新仍在原处；未知请求仍显示保护说明并禁用 Generate，不会重复提交。</p></details>
<p><b>检查完三项后，回到对话回复“V4 三项通过”，或告诉我哪一项不符合。右侧节点的白框也应完整包住卡片，底边没有缺口。</b></p><details><summary>工程记录（验收不需要读）</summary><p class="muted">右侧运行当前产品代码；任务、故障、结果和维护案例由本地合成服务提供。owner batch/detail/read 只返回严格 flat RecoveryCaseSummary 投影；真实HTTP准入、付费保护、维护接手和撤销演练另有自动测试。模拟状态不能证明真实旧任务已解除未知状态。</p><pre id="evidence"></pre></details><button data-action="finish">结束本次验收</button></main><iframe id="canvas" title="本地测试画布" src="/__acceptance/generation-entry?variant=candidate"></iframe></div>
<script>
const el=id=>document.getElementById(id);let state,busy=false,stopped=false;
const recoveryTaskIds=['node-recovery-auto-transient','node-recovery-text-unknown','node-recovery-video-failed'];
const phaseLabels={queued:'已登记待处理',claimed:'维护人员已接手',waiting_provider:'正在等待平台回复',result_recovered:'原结果已找回',ready_for_user:'可以只补当前视频'};
async function request(path,body){const r=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Error(d.error||'验收服务暂不可用');return d;}
async function snapshot(){const status=await request('/__acceptance/node-recovery/status');const batch=await request('/api/generation-recovery?taskIds='+encodeURIComponent(recoveryTaskIds.join(',')));return Object.assign(status,{recovery:batch});}
function focusCanvasNode(nodeId){if(!nodeId)return;const frame=el('canvas');let attempts=0,searchOpened=false;const later=(fn)=>{if(attempts++<150)window.setTimeout(fn,100);};const choose=()=>{const doc=frame.contentDocument;const result=doc&&Array.from(doc.querySelectorAll('[data-testid="node-search-results"] [data-node-id]')).find((entry)=>entry.getAttribute('data-node-id')===nodeId);if(result){result.click();return;}later(choose);};const open=()=>{const doc=frame.contentDocument;const world=doc&&doc.querySelector('[data-testid="canvas-world"][data-persistence-ready="true"]');const search=doc&&doc.querySelector('[data-testid="node-search"]');if(world&&search&&!searchOpened){searchOpened=true;search.click();choose();return;}later(open);};open();}
function reload(focusNodeId){const frame=el('canvas');if(focusNodeId)frame.addEventListener('load',()=>focusCanvasNode(focusNodeId),{once:true});frame.src='/__acceptance/generation-entry?variant=candidate&reload='+Date.now();}
function focusIdFor(button){return button.dataset.action==='transient'?'node-recovery-auto-transient':button.dataset.action==='unknown'?'node-recovery-text-unknown':undefined;}
function render(d){state=d;el('connection').textContent=d.ready?'画布已准备好；三项都在本页观察。页面开放至 '+new Date(d.expiresAt).toLocaleString('zh-CN')+'。':'画布正在准备…';const task=id=>d.tasks.find(t=>t.id===id);const cases=d.recovery?.cases||[];const recovery=(id)=>cases.find(item=>item.taskId===id);const original=recovery('node-recovery-auto-transient');const maintenance=recovery('node-recovery-text-unknown');const failed=recovery('node-recovery-video-failed');el('transient-status').textContent=task('node-recovery-auto-transient')?.state==='success'?(original?.status==='result_recovered'?'原结果已找回并回到当前节点，请核对右侧文字。':'模拟结果已返回，请核对右侧文字。'):'';el('maintenance-status').textContent=maintenance?(phaseLabels[maintenance.phase]+'：'+maintenance.summary):'尚未开始维护进度演示。';el('save-status').textContent=task('node-recovery-auto-save')?.canvasProjectionState==='applied'?'模拟保存已恢复，请刷新右侧检查。':'';el('retry-status').textContent=d.retryAccepted?'本场景已提交新视频任务，请等结果出现。':failed?.status==='ready_for_user'?'已核实失败；只允许当前视频继续。':'';el('evidence').textContent=JSON.stringify({checks:d.checks,recovery:d.recovery,product:d.productLayer,synthetic:d.syntheticLayer,preserve:d.preserve},null,2);document.querySelectorAll('button[data-action="transient"],button[data-action="save"]').forEach(b=>b.disabled=busy||d.checks[b.dataset.action]!=='idle');const maintenanceFinished=maintenance?.phase==='waiting_provider';const maintenanceStart=document.querySelector('button[data-action="maintenance-start"]');if(maintenanceStart)maintenanceStart.disabled=busy||maintenanceFinished;const maintenanceReopen=document.querySelector('button[data-action="maintenance-reopen"]');if(maintenanceReopen)maintenanceReopen.disabled=busy||!maintenance;}
async function refresh(force=false){if(stopped||(busy&&!force))return;try{render(await snapshot());}catch(e){el('error').hidden=false;el('error').textContent=e.message+'。请回对话告诉我，暂时不用继续操作。';}}
async function runMaintenanceDemo(){for(const phase of ['queued','claimed','waiting_provider']){await request('/__acceptance/node-recovery/recovery-stage',{phase});await refresh(true);if(phase!=='waiting_provider')await new Promise(resolve=>window.setTimeout(resolve,700));}}
async function reopenMaintenance(){const detail=await request('/api/generation-recovery/node-recovery-text-unknown');if(detail.case?.unread)await request('/api/generation-recovery/node-recovery-text-unknown/read',{commandId:'local-reopen-'+Date.now(),expectedCaseEventId:detail.case.caseEventId,progressVersion:detail.case.progressVersion});await refresh(true);}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled||busy)return;busy=true;el('error').hidden=true;try{if(b.dataset.action==='finish'){await request('/__acceptance/stop',{});stopped=true;document.body.textContent='本次验收已结束，可以关闭页面。';return;}if(b.dataset.action==='refresh'){reload();return;}if(b.dataset.action==='maintenance-start'){await runMaintenanceDemo();return;}if(b.dataset.action==='maintenance-reopen'){await reopenMaintenance();return;}if(b.dataset.mode){render(await request('/__acceptance/node-recovery/retry-mode',{mode:b.dataset.mode}));}else if(['transient','save'].includes(b.dataset.action)){render(Object.assign(await request('/__acceptance/node-recovery/start',{action:b.dataset.action}),{recovery:state?.recovery}));}else{await request('/__acceptance/node-recovery/focus',{action:b.dataset.action});}reload(focusIdFor(b));}catch(e){el('error').hidden=false;el('error').textContent=e.message;}finally{busy=false;await refresh();}});
setInterval(()=>refresh(),1000);refresh();
</script></html>`;
}

function nodeRecoveryProductGuideHtml() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地验收 · 失败节点恢复</title>
<style>*{box-sizing:border-box}body{margin:0;font:15px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f4;color:#222}.layout{display:grid;grid-template-columns:minmax(360px,460px) minmax(600px,1fr);height:100vh}.guide{overflow:auto;padding:20px}h1{font-size:23px;margin:0 0 10px}h2{font-size:18px;margin:0 0 7px}p{margin:8px 0}section{background:#fff;border:1px solid #ddd;border-radius:12px;padding:16px;margin:14px 0}button{font:inherit;border:1px solid #aaa;border-radius:8px;background:white;padding:8px 12px;margin:4px 4px 4px 0;cursor:pointer}button.primary{background:#222;color:white}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:3px solid #417ca8;outline-offset:2px}.expect{background:#eef4ef;border-radius:7px;padding:10px}.feedback{color:#3d6250}.error{color:#a12424;background:#fff0f0;padding:12px;overflow-wrap:anywhere}.muted{font-size:13px;color:#666}.role{border-top:1px solid #e1e1e1;padding:10px 0}.role:first-child{border-top:0}.role strong{display:block}.role code{font-size:12px;overflow-wrap:anywhere}iframe{width:100%;height:100%;border:0;background:#111}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin-top:16px}</style>
<div class="layout"><main class="guide"><p class="muted">本地测试 · 全部使用模拟数据，不扣费 · 尚未上线</p><h1 id="guide-title">这次验收3项</h1><p id="guide-intro">按左侧 1→2→3 操作，右侧会自动定位要看的节点。前面九个“已成功节点”是对照，不用逐个点击。</p><div id="error" class="error" role="alert" hidden></div><p id="connection" class="feedback" role="status">正在准备本地任务…</p>
<section><h2>1. 原来的视频能自动找回来吗？</h2><p>点“开始找回原结果”，看右侧的“原结果找回（视频）”。等视频出现后，再点“刷新右侧画布”。</p><button class="primary" data-action="original">开始找回原结果</button><p id="original-status" class="feedback" role="status">尚未执行。</p><p class="expect">预期：视频自动出现在原节点里，刷新后还在；前面已成功的内容和连线不变。</p></section>
<section><h2>2. 维护接手后，能接着工作吗？</h2><p>点“开始维护处理”，看右侧的“维护后找回结果（视频）”。这里模拟维护人员已经拿到结果，你不用做任何技术检查。再点“查看仍未确认的节点”，看另一种暂时没有结论的情况。</p><button class="primary" data-action="maintenance">开始维护处理</button><button data-action="focus-unresolved">查看仍未确认的节点</button><p id="maintenance-status" class="feedback" role="status">尚未执行。</p><p class="expect">预期：右侧“维护后找回结果”节点出现结果；“平台未确认”节点仍显示未解决，不会把等待写成成功。</p></section>
<section id="single-video-recheck"><h2>3. 能只重新生成失败的视频吗？</h2><p>这个视频已确认生成失败。点“继续当前视频”，等右侧的“失败视频 · 仅此节点补跑”出现视频。</p><button class="primary" data-action="retry">继续当前视频</button><p id="retry-status" class="feedback" role="status">尚未执行。</p><p class="expect">预期：只有这个失败节点重新生成。前面九个已成功节点的内容、位置、连线都不变。</p></section>
<section><h2>当前演示进度</h2><p id="guide-progress">三个结果都符合上面的说明，就回复“3项通过”。有不符合的，告诉我第几项。</p><button data-action="refresh-canvas">刷新右侧画布</button><div id="roles"></div></section>
<details><summary>工程证据（用户不需要操作）</summary><pre id="evidence"></pre></details><button data-action="finish">结束本次验收</button></main><iframe id="canvas" title="本地测试画布" src="/__acceptance/generation-entry?variant=candidate"></iframe></div>
<script>
const el=id=>document.getElementById(id);const recheckThree=new URLSearchParams(window.location.search).get('recheck')==='3';let state,busy=false,stopped=false,timer,refreshing=false,retryError='';document.documentElement.dataset.acceptanceBusy='false';
function applyRecheckCopy(){if(!recheckThree)return;el('guide-title').textContent='这次只重验第3项';el('guide-intro').textContent='第1、2项已通过；点继续当前视频，看到视频后刷新确认仍在。';el('guide-progress').textContent='第3项符合后，回复“第3项通过”。有不符合的，告诉我哪一项。';}
const roleLabels={originalResult:'原结果找回',maintenance:'平台未确认',maintenanceResult:'维护后找回结果',failedVideo:'当前失败视频'};
const phaseLabels={queued:'已登记待处理',claimed:'维护人员已接手',waiting_provider:'正在等待平台回复',result_recovered:'原结果已找回',ready_for_user:'可继续当前节点',unresolved:'仍未解决'};
async function request(path,body){const response=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});let data;try{data=await response.json();}catch{throw Error('验收服务返回了无法读取的内容。');}if(!response.ok)throw Error(data.error||'验收服务返回错误。');return data;}
function esc(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function focusCanvasNode(nodeId){return new Promise((resolve,reject)=>{if(!nodeId){reject(Error('没有找到验收节点。'));return;}const frame=el('canvas');let attempts=0,searchOpened=false;const later=fn=>{if(attempts++<150)window.setTimeout(fn,100);else reject(Error('测试画布仍未准备好，请稍后再试。'));};const verify=()=>{const world=frame.contentDocument?.querySelector('[data-testid="canvas-world"]');if(world?.getAttribute('data-persistence-ready')==='true'&&world.getAttribute('data-primary-node')===nodeId&&world.getAttribute('data-selected-node-count')==='1'){resolve();return;}later(verify);};const choose=()=>{const doc=frame.contentDocument;const result=doc&&Array.from(doc.querySelectorAll('[data-testid="node-search-results"] [data-node-id]')).find(entry=>entry.getAttribute('data-node-id')===nodeId);if(result){result.click();verify();return;}later(choose);};const open=()=>{const doc=frame.contentDocument;const world=doc&&doc.querySelector('[data-testid="canvas-world"][data-persistence-ready="true"]');const search=doc&&doc.querySelector('[data-testid="node-search"]');if(world&&search&&!searchOpened){searchOpened=true;search.click();choose();return;}later(open);};open();});}
async function clickProductVideoGenerate(nodeId){if(!nodeId)throw Error('没有找到当前视频节点。');for(let attempt=0;attempt<100;attempt++){const doc=el('canvas').contentDocument;const world=doc?.querySelector('[data-testid="canvas-world"]');const targetSelected=world?.getAttribute('data-persistence-ready')==='true'&&world.getAttribute('data-primary-node')===nodeId&&world.getAttribute('data-selected-node-count')==='1';const creator=doc&&Array.from(doc.querySelectorAll('[data-testid="video-creator"]')).find(entry=>entry.getAttribute('data-id')?.split(/\s+/).includes(nodeId));const button=creator?.querySelector('button.video-creator-generate[aria-label="Generate"]');if(targetSelected&&button&&!button.disabled){button.click();return;}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('当前视频还不能继续，请保留右侧提示并告诉我。');}

function taskText(item){if(!item)return '任务尚未读取';return ({queued:'等待生成',running:'生成中',recovering:'正在找回结果',success:'结果已保存',failed:'原生成未成功',cancelled:'已取消'})[item.state]||'记录已保留';}
function render(data){state=data;el('connection').textContent=data.ready?(recheckThree?'画布已准备好，请继续第3项。':'画布已准备好，从第1项开始。'):'本地任务仍在准备。';const roleEntries=Object.entries(data.roles||{});el('roles').innerHTML=roleEntries.map(([role,value])=>{const task=value.childTask??value.currentTask;const item=value.case;return '<div class="role"><strong>'+esc(roleLabels[role]||role)+'</strong><code>任务：'+esc(taskText(task))+'</code><br><code>维护：'+esc(value.childTask?.state==='success'?'本轮已完成，原失败记录保留':item?item.summary:'尚未读取')+'</code></div>';}).join('');const original=data.roles?.originalResult;const maintenance=data.roles?.maintenance;const maintenanceResult=data.roles?.maintenanceResult;const failed=data.roles?.failedVideo;const resultRecovered=data.maintenanceDemonstration?.resultRecovered===true;const unresolved=data.maintenanceDemonstration?.unresolved===true;el('original-status').textContent=data.checks.original==='done'?(original?.currentTask?.state==='success'?'原任务结果已保存；请在右侧确认同一节点。':'检查已执行，请查看右侧原节点。'):'尚未执行。';el('maintenance-status').textContent=data.checks.maintenance==='done'?(resultRecovered&&unresolved?'维护后结果已找回；另一个平台未确认事项仍保留为未解决。':maintenanceResult?.currentTask?.state==='success'?'维护后结果已找回，但未确认事项还需保留检查。':unresolved?'未确认事项已接手并保留为未解决，结果节点请查看右侧。':'维护检查已执行，请查看右侧状态。'):'尚未执行。';const retryStatus=el('retry-status');retryStatus.textContent=retryError||(data.checks.retry==='done'?(failed?.childTaskId?'已为当前视频创建新任务并返回结果；原失败任务仍保留。':'单节点准入已执行，请查看右侧视频。'):'尚未执行。');retryStatus.style.color=retryError?'#a12424':'';el('evidence').textContent=JSON.stringify({checks:data.checks,roles:data.roles,maintenanceDemonstration:data.maintenanceDemonstration,recovery:data.recovery,product:data.productLayer,synthetic:data.syntheticLayer,preserve:data.preserve,results:data.results,counters:data.counters},null,2);const canRetry=failed?.currentTask?.state==='failed'&&failed.currentTask.newGenerationAllowed===true;document.querySelectorAll('button[data-action="original"]').forEach(button=>button.disabled=busy||data.checks.original!=='idle');document.querySelectorAll('button[data-action="maintenance"]').forEach(button=>button.disabled=busy||data.checks.maintenance!=='idle');document.querySelectorAll('button[data-action="retry"]').forEach(button=>button.disabled=busy||data.checks.retry!=='idle'||!canRetry);}
async function refresh(){clearTimeout(timer);if(stopped||busy||refreshing)return;refreshing=true;try{render(await request('/__acceptance/node-recovery/status'));}catch(error){el('error').hidden=false;el('error').textContent=error.message+' 请把这条提示发回对话。';}finally{refreshing=false;if(!stopped)timer=window.setTimeout(refresh,5000);}}
document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button||button.disabled||busy)return;busy=true;document.documentElement.dataset.acceptanceBusy='true';el('error').hidden=true;try{if(button.dataset.action==='finish'){await request('/__acceptance/stop',{});stopped=true;document.body.textContent='本次验收已结束，可以关闭页面。';return;}if(button.dataset.action==='refresh-canvas'){el('canvas').contentWindow.location.reload();return;}if(button.dataset.action==='focus-unresolved'){await focusCanvasNode(state?.roles?.maintenance?.nodeId);return;}if(button.dataset.action==='original'||button.dataset.action==='maintenance'||button.dataset.action==='retry'){const role=button.dataset.action==='original'?'originalResult':button.dataset.action==='maintenance'?'maintenanceResult':'failedVideo';if(button.dataset.action==='retry')retryError='';await focusCanvasNode(state?.roles?.[role]?.nodeId);if(button.dataset.action==='retry')await clickProductVideoGenerate(state?.roles?.[role]?.nodeId);const data=await request('/__acceptance/node-recovery/'+button.dataset.action,{});if(button.dataset.action==='retry')retryError='';render(data);} }catch(error){if(button.dataset.action==='retry')retryError=error.message;el('error').hidden=false;el('error').textContent=error.message;}finally{busy=false;document.documentElement.dataset.acceptanceBusy='false';await refresh();}});window.addEventListener('pagehide',()=>{clearTimeout(timer);});window.addEventListener('pageshow',()=>{if(!stopped)refresh();});applyRecheckCopy();refresh();
</script></html>`;
}


function mediaPublicationGuideHtml() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>图片保存恢复 · 本地验收</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f6;color:#262626;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.layout{display:grid;grid-template-columns:390px 1fr;height:100vh}.guide{overflow:auto;padding:22px}.canvas-area{min-width:0;background:#050505}iframe{border:0;width:100%;height:100%;display:block}h1{font-size:25px;line-height:1.4;margin:0 0 12px}h2{font-size:18px;margin:0 0 8px}p{margin:8px 0}.muted{font-size:14px;color:#666}.safe,.expect{background:#eaf3ed;padding:12px;border-radius:9px}.card{padding:18px;background:white;border:1px solid #ddd;border-radius:12px;margin:16px 0}.card.done{border-color:#80a990}.status{font-size:14px;color:#37644a}.error{padding:12px;background:#fff0ed;color:#9b2929;border-radius:8px;overflow-wrap:anywhere}button{font:inherit;cursor:pointer;padding:9px 12px;border-radius:8px;background:#fff;border:1px solid #aaa;margin:5px 5px 5px 0}button.primary{background:#242424;border-color:#242424;color:white}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #5486c0;outline-offset:3px}details{font-size:13px;color:#666}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}@media(max-width:800px){.layout{grid-template-columns:320px minmax(400px,1fr)}.guide{padding:14px}}
</style><div class="layout"><main class="guide"><h1>这次检查四项</h1><p class="safe">右边就是测试画布，不用换标签页。演示完成后右侧会自动重新读取画布。全部使用模拟任务和素材，<b>不会扣费，尚未上线。</b></p><p id="ready" class="muted">正在准备测试画布…</p><div id="error" class="error" role="alert" hidden></div>
<section class="card" id="card-saveRace"><h2>1. 保存遇到后台检查，视频还能正常出现吗？</h2><p>点下面按钮，右边会定位到「保存恢复演示」。等视频出现，期间不用点重试。</p><button class="primary" data-action="save-race">开始保存恢复演示</button><p class="expect"><b>你要看：</b>视频自动出现并能播放，没有停在红色失败提示。</p><p class="status" id="text-saveRace">尚未开始。</p></section>
<section class="card" id="card-adoption"><h2>2. 以前失败的图片能找回来吗？</h2><p>点下面按钮，查看右边「找回已有图片」节点。</p><button class="primary" data-action="adoption" disabled>找回已有图片</button><p class="expect"><b>你要看：</b>原来的空框出现图片。再点「刷新右侧画布」，图片仍在，没有重复结果。</p><button data-action="refresh-canvas">刷新右侧画布</button><p class="status" id="text-adoption">请先完成第1项。</p></section>
<section class="card" id="card-continuation"><h2>3. 能只做完后面的节点吗？</h2><p>点下面按钮，等右边两个未完成的视频出现结果。它们使用第2项找回的图片。</p><button class="primary" data-action="continuation" disabled>继续未完成节点</button><p class="expect"><b>你要看：</b>两个视频自动完成，前面已成功的文字、图片没有重新生成，也没有移动。</p><p class="status" id="text-continuation">请先完成第2项。</p></section>
<section class="card" id="card-normal"><h2>4. 原来的画布操作还正常吗？</h2><p>先点下面「核对原内容是否保留」定位图片，再打开顶部「浏览全部」。从右侧加号拖到空白处，选「文本生成」；再拖动画布、缩放并刷新。这里只检查创建节点，不用点生成箭头。</p><p class="expect"><b>你要看：</b>白框完整，菜单没有被输入框挡住，拖线菜单能操作，刷新后内容、位置和连线仍在。</p><button data-action="refresh-canvas">刷新右侧画布</button><button class="primary" data-action="normal" disabled>核对原内容是否保留</button><p class="status" id="text-normal">请先完成第3项。</p></section>
<p id="summary" class="muted"></p><p><b>四项都符合后，在对话里回复「四项通过」。不符合就告诉我第几项。</b></p><p class="muted">页面上的完成提示只表示系统操作已完成，实际体验仍由你确认。</p><details><summary>工程记录（你不用操作）</summary><pre id="evidence"></pre></details><button id="finish">结束本次验收</button></main><div class="canvas-area"><iframe id="canvas" title="本地测试画布" src="/__acceptance/generation-entry?variant=candidate"></iframe></div></div>
<script>
let state,busy=false,stopped=false,timer;
const byId=id=>document.getElementById(id);
const keys={'save-race':'saveRace',adoption:'adoption',continuation:'continuation',normal:'normal'};
const labels={saveRace:'演示已完成，请确认右侧视频可以播放。',adoption:'原图片已接回，请确认并刷新右侧画布。',continuation:'后面的两个视频已完成，请确认原成功节点仍在。',normal:'原内容核对完成，请确认上面的画布操作也正常。'};
const targets={'save-race':'media-publication-save-race-video',adoption:'media-publication-adoption-image',continuation:'media-publication-pending-video',normal:'media-publication-normal-png'};
async function request(path,body){const r=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||d.message||'本地验收服务暂时不可用');return d;}
function render(data){state=data;const checks=data.checks||{};byId('ready').textContent=data.ready?'画布已准备好。页面开放至 '+new Date(data.expiresAt).toLocaleString('zh-CN')+'。':'正在准备测试画布…';for(const [key,label] of Object.entries(labels)){const done=checks[key]==='done';byId('card-'+key).classList.toggle('done',done);if(done)byId('text-'+key).textContent=label;else if(key==='adoption'&&checks.saveRace==='done')byId('text-'+key).textContent='可以开始第2项。';else if(key==='continuation'&&checks.adoption==='done')byId('text-'+key).textContent='可以开始第3项。';else if(key==='normal'&&checks.continuation==='done')byId('text-'+key).textContent='现在可以检查画布操作。';}document.querySelector('[data-action="save-race"]').disabled=busy||!data.ready||checks.saveRace==='done';document.querySelector('[data-action="adoption"]').disabled=busy||checks.saveRace!=='done'||checks.adoption==='done';document.querySelector('[data-action="continuation"]').disabled=busy||checks.adoption!=='done'||checks.continuation==='done';document.querySelector('[data-action="normal"]').disabled=busy||checks.continuation!=='done';byId('summary').textContent=data.preserve?.successContentLayoutAndEdgesUnchanged?'已核对：原成功节点的内容、位置和连线保持。':'';byId('evidence').textContent=JSON.stringify(data,null,2);}
function focusCanvasNode(id){return new Promise((resolve,reject)=>{let attempts=0;const tick=()=>{const doc=byId('canvas').contentDocument;const world=doc?.querySelector('[data-testid="canvas-world"][data-persistence-ready="true"]');if(world){const dialog=doc.querySelector('[data-testid="node-search-dialog"]');if(!dialog){doc.querySelector('[data-testid="node-search"]')?.click();}else{const all=Array.from(dialog.querySelectorAll('[aria-label="节点类型"] button')).find(el=>el.textContent.trim()==='全部');const input=dialog.querySelector('input[type="search"]');let changed=false;if(all?.getAttribute('aria-pressed')!=='true'){all?.click();changed=true;}if(input?.value){const win=doc.defaultView;Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new win.Event('input',{bubbles:true}));changed=true;}if(!changed){const result=Array.from(dialog.querySelectorAll('[data-testid="node-search-results"] [data-node-id]')).find(el=>el.getAttribute('data-node-id')===id);if(result){result.click();resolve();return;}}}}if(++attempts<100)setTimeout(tick,100);else reject(Error('未能定位到测试节点，画布可能仍在加载。请稍后再点本项。'));};tick();});}
async function reloadCanvas(){const frame=byId('canvas');await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{frame.removeEventListener('load',loaded);reject(Error('测试画布重新加载超时，请刷新右侧画布。'));},15000);const loaded=()=>{clearTimeout(timeout);resolve();};frame.addEventListener('load',loaded,{once:true});frame.contentWindow.location.reload();});}
async function refresh(){clearTimeout(timer);if(stopped||busy)return;try{render(await request('/__acceptance/media-publication/status'));if(byId('error').dataset.kind==='read')byId('error').hidden=true;}catch(e){byId('error').hidden=false;byId('error').textContent=e.message;byId('error').dataset.kind='read';}finally{if(!stopped)timer=setTimeout(refresh,3000);}}
document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button||button.disabled||busy)return;if(button.id==='finish'){await request('/__acceptance/stop',{});stopped=true;document.body.textContent='本次验收已结束，可以关闭页面。';return;}const action=button.dataset.action;if(action==='refresh-canvas'){byId('canvas').contentWindow.location.reload();return;}if(!keys[action])return;busy=true;clearTimeout(timer);byId('error').hidden=true;const original=button.textContent;button.textContent='系统处理中…';render(state||{});try{const data=await request('/__acceptance/media-publication/start',{action});render(data);if(action!=='normal')await reloadCanvas();await focusCanvasNode(targets[action]);}catch(e){byId('error').hidden=false;byId('error').textContent=e.message;byId('error').dataset.kind='action';}finally{button.textContent=original;busy=false;await refresh();}});window.addEventListener('pagehide',()=>clearTimeout(timer));refresh();
</script></html>`;
}

function videoQueryWorkflowGuideHtml() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>视频查询恢复 · 本地验收</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f5f6;color:#262626;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.layout{display:grid;grid-template-columns:410px 1fr;height:100vh}.guide{overflow:auto;padding:22px}.canvas-area{min-width:0;background:#050505}iframe{border:0;width:100%;height:100%;display:block}h1{font-size:25px;line-height:1.4;margin:0 0 12px}h2{font-size:18px;margin:0 0 8px}p{margin:8px 0}.muted{font-size:14px;color:#666}.safe,.expect{background:#eaf3ed;padding:12px;border-radius:9px}.card{padding:18px;background:white;border:1px solid #ddd;border-radius:12px;margin:16px 0}.card.done{border-color:#80a990}.status{font-size:14px;color:#37644a}.error{padding:12px;background:#fff0ed;color:#9b2929;border-radius:8px;overflow-wrap:anywhere}button{font:inherit;cursor:pointer;padding:9px 12px;border-radius:8px;background:#fff;border:1px solid #aaa;margin:5px 5px 5px 0}button.primary{background:#242424;border-color:#242424;color:white}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:3px solid #5486c0;outline-offset:3px}details{font-size:13px;color:#666}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}@media(max-width:900px){.layout{grid-template-columns:350px minmax(400px,1fr)}.guide{padding:14px}}
</style><div class="layout"><main class="guide"><h1>视频查询恢复验收</h1><p class="safe">本页和右侧画布是一套本地测试。只使用模拟平台，不扣费，也不会影响线上数据。</p><p id="ready" class="muted">正在准备测试画布…</p><div id="error" class="error" role="alert" hidden></div>
<section class="card" id="card-start"><h2>1. 临时中断后，视频和尾文字会自动完成吗？</h2><p>点击一次后，系统会真实创建一组本地工作流。模拟平台会短暂中断查询。请等约1～2分钟，期间不用点重试。</p><button class="primary" data-action="start">开始自动恢复</button><p class="expect"><b>你要看：</b>同一个视频节点自动出现结果，尾部文字也自动完成；页面没有要求你重复提交。</p><p class="status" id="status-start">尚未开始。</p></section>
<section class="card" id="card-refresh"><h2>2. 刷新后，恢复中的结果还在原位置吗？</h2><p>启动第1项后，立即点下面按钮也可以；它会重新打开右侧画布，仍继续刚才那一次任务。</p><button data-action="refresh" disabled>刷新并检查恢复结果</button><p class="expect"><b>你要看：</b>视频和尾文字仍在原节点，位置和连线没有变化，也没有新增一次平台提交。</p><p class="status" id="status-refresh">请先完成第1项。</p></section>
<section class="card" id="card-history"><h2>3. 找回历史视频后，只继续尾部节点吗？</h2><p>先点“找回原视频”，确认历史视频回到原节点；再单独点“继续剩余节点”，只生成尾部文字。</p><button class="primary" data-action="history-sync" disabled>找回原视频</button><button data-action="history-continue" disabled>继续剩余节点</button><p class="expect"><b>你要看：</b>历史视频不会再次提交平台请求，只生成尾部文字；已有内容、位置和连线保持不变。</p><p class="status" id="status-history">请先完成第2项。</p></section>
<p><b>三项都符合后，在对话里回复“3项通过”；哪一项不符合，就告诉我第几项。</b></p><p class="muted">页面的绿色提示只表示本地流程已完成，最终是否符合你的实际使用体验由你确认。</p><details><summary>工程记录（你不用操作）</summary><pre id="evidence"></pre></details><button id="finish">结束本次验收</button></main><div class="canvas-area"><iframe id="canvas" title="视频查询恢复测试画布" src="/__acceptance/generation-entry?variant=candidate"></iframe></div></div>
<script>
let state,busy=false,stopped=false,timer;
const byId=id=>document.getElementById(id);
async function request(path,body){const r=await fetch(path,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||d.message||'本地验收服务暂时不可用');return d;}
function render(data){state=data;const checks=data.checks||{};byId('ready').textContent=data.ready?'画布已准备好。按1→2→3操作。':'正在准备测试画布…';const startDone=checks.start==='done';const refreshDone=checks.refresh==='done';const syncDone=checks.historySync==='done';const continuationDone=checks.historyContinuation==='done';byId('card-start').classList.toggle('done',startDone);byId('card-refresh').classList.toggle('done',refreshDone);byId('card-history').classList.toggle('done',continuationDone);byId('status-start').textContent=startDone?'视频和尾文字已自动完成，请检查右侧画布。':checks.start==='running'?'正在查询平台结果；遇到短暂中断会自动等待，不用重试。':'尚未开始。';byId('status-refresh').textContent=refreshDone?'刷新后结果仍在原节点，请继续第3项。':checks.refresh==='running'?'画布已重新加载，正在等待原任务结果。':startDone?'可以开始第2项。':'请先开始第1项。';byId('status-history').textContent=continuationDone?'历史视频保留在原节点，只生成了尾部文字。':syncDone?'原视频已找回。现在可以继续剩余节点。':refreshDone?'可以先找回原视频。':'请先完成第2项。';byId('evidence').textContent=JSON.stringify(data,null,2);document.querySelector('[data-action="start"]').disabled=busy||!data.ready||checks.start!=='idle';document.querySelector('[data-action="refresh"]').disabled=busy||!['running','done'].includes(checks.start)||refreshDone;document.querySelector('[data-action="history-sync"]').disabled=busy||!startDone||!refreshDone||checks.historySync!=='idle';document.querySelector('[data-action="history-continue"]').disabled=busy||!syncDone||checks.historyContinuation!=='idle';}
async function refresh(){clearTimeout(timer);if(stopped||busy)return;try{render(await request('/__acceptance/video-query-workflow/status'));}catch(error){byId('error').hidden=false;byId('error').textContent=error.message;}finally{if(!stopped)timer=setTimeout(refresh,1500);}}
async function reloadCanvas(focusId){const frame=byId('canvas');await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{frame.removeEventListener('load',loaded);reject(Error('右侧画布刷新超时，请稍后重试。'));},15000);const loaded=()=>{clearTimeout(timeout);resolve();};frame.addEventListener('load',loaded,{once:true});frame.contentWindow.location.reload();});if(focusId)await focusCanvasNode(focusId);}
function focusCanvasNode(id){return new Promise((resolve,reject)=>{if(!id){reject(Error('没有找到对应的验收节点。'));return;}const frame=byId('canvas');let attempts=0;const tick=()=>{const doc=frame.contentDocument;const world=doc?.querySelector('[data-testid="canvas-world"][data-persistence-ready="true"]');if(world){const dialog=doc.querySelector('[data-testid="node-search-dialog"]');if(!dialog){doc.querySelector('[data-testid="node-search"]')?.click();}else{const all=Array.from(dialog.querySelectorAll('[aria-label="节点类型"] button')).find(el=>el.textContent.trim()==='全部');const input=dialog.querySelector('input[type="search"]');if(all?.getAttribute('aria-pressed')!=='true')all?.click();if(input?.value){const win=doc.defaultView;Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new win.Event('input',{bubbles:true}));}const result=Array.from(dialog.querySelectorAll('[data-testid="node-search-results"] [data-node-id]')).find(el=>el.getAttribute('data-node-id')===id);if(result){result.click();resolve();return;}}}if(++attempts<150)window.setTimeout(tick,100);else reject(Error('未能定位到对应节点，请稍后再试。'));};tick();});}
document.addEventListener('click',async event=>{const button=event.target.closest('button');if(!button||button.disabled||busy)return;if(button.id==='finish'){await request('/__acceptance/stop',{});stopped=true;document.body.textContent='本次验收已结束，可以关闭页面。';return;}const action=button.dataset.action;if(!action)return;busy=true;const label=button.textContent;button.textContent='系统处理中…';byId('error').hidden=true;try{const data=await request('/__acceptance/video-query-workflow/'+action,{});render(data);const focusId=action==='start'||action==='refresh'?'video-query-workflow-active-video':action==='history-sync'?'video-query-workflow-history-video':action==='history-continue'?'video-query-workflow-history-tail-text':undefined;await reloadCanvas(focusId);}catch(error){byId('error').hidden=false;byId('error').textContent=error.message;}finally{button.textContent=label;busy=false;await refresh();}});window.addEventListener('pagehide',()=>clearTimeout(timer));refresh();
</script></html>`;
}

function generationGuideHtmlSimple() {
  if (mediaPublicationScenario) return mediaPublicationGuideHtml();
  if (videoQueryWorkflowScenario) return videoQueryWorkflowGuideHtml();
  if (nodeRecoveryProductMode) return nodeRecoveryProductGuideHtml();
  if (nodeRecoveryScenario) return nodeRecoveryGuideHtml();
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

function readNodeRecoveryFixture() {
  const fixturePath = join(sourceRoot, "tests/fixtures/node-recovery-acceptance.json");
  if (!existsSync(fixturePath) || !inside(sourceRoot, realpathSync(fixturePath))) {
    throw new Error("Node recovery acceptance fixture is missing or outside the source snapshot");
  }
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    throw new Error(`Node recovery acceptance fixture is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const successNodes = Array.isArray(fixture?.successNodes) ? fixture.successNodes : [];
  const automatic = [fixture?.automaticRecovery?.transient, fixture?.automaticRecovery?.save];
  const special = [fixture?.retry, fixture?.unknown];
  const nodes = [...successNodes, ...automatic, ...special];
  const ids = nodes.map((node) => node?.id);
  const successIds = new Set(successNodes.map((node) => node?.id));
  const edges = Array.isArray(fixture?.preservedEdges) ? fixture.preservedEdges : [];
  const validTypes = new Set(["audio", "image", "text", "video"]);
  const recoveryCases = fixture?.v4?.cases;
  const recoveryCaseValues = recoveryCases && typeof recoveryCases === "object"
    ? Object.values(recoveryCases) : [];
  const validRecoveryReasons = new Set(["outcome_unknown", "operator_incident", "result_recovery_pending"]);
  const validMaintenancePhases = ["queued", "claimed", "waiting_provider"];
  if (fixture?.schemaVersion !== 1 || fixture?.scenario !== "node-recovery" ||
      fixture.syntheticOnly !== true || fixture.preservedSuccessNodeCount !== 9 ||
      successNodes.length !== fixture.preservedSuccessNodeCount ||
      nodes.some((node) => !node || typeof node.id !== "string" ||
        !/^node-recovery-[a-z0-9-]+$/.test(node.id) || !validTypes.has(node.type) ||
        !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) ||
      new Set(ids).size !== nodes.length ||
      edges.some((edge) => !edge || typeof edge.id !== "string" || !successIds.has(edge.source) || !successIds.has(edge.target)) ||
      !fixture.retry || fixture.retry.type !== "video" ||
      !fixture.retry.modes || typeof fixture.retry.modes !== "object" ||
      !fixture.retry.modes["balance-denied"] || !fixture.retry.modes["provider-failed"] ||
      !fixture.unknown || fixture.unknown.type !== "text" ||
      fixture.unknown.retryAllowed !== false ||
      fixture.retry.retryPath !== "/api/generation-tasks" ||
      fixture.v4?.syntheticOnly !== true ||
      JSON.stringify(fixture.v4?.maintenancePhases) !== JSON.stringify(validMaintenancePhases) ||
      !recoveryCases || Object.keys(recoveryCases).sort().join(",") !== "failedVideo,maintenance,originalResult" ||
      recoveryCaseValues.length !== 3 ||
      recoveryCaseValues.some((item) => !item || typeof item.caseId !== "string" ||
        !/^node-recovery-case-[a-z0-9-]+$/.test(item.caseId) || typeof item.taskId !== "string" ||
        !ids.includes(item.nodeId) || !validTypes.has(item.kind) || item.executionAttempt !== 1 ||
        !validRecoveryReasons.has(item.reasonCode)) ||
      new Set(recoveryCaseValues.map((item) => item.caseId)).size !== recoveryCaseValues.length ||
      recoveryCases.originalResult.taskId !== fixture.automaticRecovery.transient.id ||
      recoveryCases.originalResult.nodeId !== fixture.automaticRecovery.transient.id ||
      recoveryCases.originalResult.kind !== fixture.automaticRecovery.transient.type ||
      recoveryCases.maintenance.taskId !== fixture.unknown.id ||
      recoveryCases.maintenance.nodeId !== fixture.unknown.id ||
      recoveryCases.maintenance.kind !== fixture.unknown.type ||
      recoveryCases.failedVideo.taskId !== fixture.retry.id ||
      recoveryCases.failedVideo.nodeId !== fixture.retry.id ||
      recoveryCases.failedVideo.kind !== fixture.retry.type) {
    throw new Error("Node recovery acceptance fixture does not match its narrow schema");
  }
  return {
    ...fixture,
    nodes: nodes.map((node) => ({ ...node, title: node.title ?? node.label ?? node.id })),
    successNodes: successNodes.map((node) => ({ ...node })),
    preservedEdges: edges.map((edge) => ({ ...edge })),
  };
}

function ssrModuleUrl(path) {
  return `/@fs/${path.split(sep).join("/")}`;
}

function productRole(role) {
  const value = nodeRecoveryProductFixture?.roles?.[role];
  if (!value) throw new AcceptanceControlError("本地产品夹具尚未准备完成。", "NODE_RECOVERY_PRODUCT_NOT_READY", 503);
  return value;
}

let nodeRecoveryProductPreservedBaseline;
function preservedSuccessFingerprint(canvas) {
  const ids = new Set(nodeRecoveryProductFixture.preservedSuccessNodeIds);
  const nodes = (canvas.nodes ?? []).filter(node => ids.has(node.id)).map(node => ({
    id: node.id, type: node.type, position: node.position,
    width: node.style?.width, height: node.style?.height,
    content: node.data?.content, textPrompt: node.data?.textPrompt, title: node.data?.title,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const edges = (canvas.edges ?? []).filter(edge => ids.has(edge.source) && ids.has(edge.target))
    .map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle ?? "", targetHandle: edge.targetHandle ?? "" }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify({ nodes, edges })).digest("hex");
}

async function nodeRecoveryProductStatusPayload() {
  if (!generationFixture || !nodeRecoveryProductFixture) {
    return { scenario: "node-recovery", ready: false };
  }
  const fixtureScopeId = nodeRecoveryProductFixture.fixtureScopeId;
  const taskResponse = await api(
    `/api/generation-tasks?canvasId=${encodeURIComponent(generationFixture.canvasId)}&fixtureScopeId=${encodeURIComponent(fixtureScopeId)}`,
  );
  const taskPayload = await taskResponse.json();
  const tasks = Array.isArray(taskPayload?.tasks) ? taskPayload.tasks : [];
  const taskIds = Object.values(nodeRecoveryProductFixture.roles).flatMap((role) =>
    typeof role?.taskId === "string" ? [role.taskId] : []);
  const recoveryResponse = await api(
    `/api/generation-recovery?taskIds=${encodeURIComponent([...new Set(taskIds)].join(","))}`,
  );
  const recoveryPayload = await recoveryResponse.json();
  const canvas = await (await api(`/api/canvas/${generationFixture.canvasId}`)).json();
  const successIds = new Set(nodeRecoveryProductFixture.preservedSuccessNodeIds);
  const preservedNodes = Array.isArray(canvas?.nodes)
    ? canvas.nodes.filter((node) => successIds.has(node?.id)) : [];
  const targetIds = new Set(nodeRecoveryProductFixture.targetNodeIds);
  const resultNodes = Array.isArray(canvas?.nodes)
    ? canvas.nodes.filter((node) => targetIds.has(node?.id)).map((node) => ({
        id: node.id,
        type: node.type,
        hasResult: Boolean(node.data?.videoSrc || node.data?.assetId || node.data?.groupRunSuccessResultKey),
        taskId: node.data?.videoGenerationTaskId ?? node.data?.groupRunSuccessTaskId,
        videoSrc: node.data?.videoSrc,
      })) : [];
  const caseItems = Array.isArray(recoveryPayload?.cases) ? recoveryPayload.cases : [];
  const roleStatus = Object.fromEntries(Object.entries(nodeRecoveryProductFixture.roles).map(([role, value]) => {
    const currentTask = tasks.find((task) => task.id === value.taskId) ??
      tasks.find((task) => task.replacesTaskId === value.taskId && task.nodeId === value.nodeId);
    const currentCase = caseItems.find((item) => item.taskId === value.taskId);
    return [role, {
      case: currentCase,
      childTaskId: value.childTaskId,
      childTask: tasks.find(task => task.id === value.childTaskId),
      currentTask,
      nodeId: value.nodeId,
      taskId: value.taskId,
    }];
  }));
  const maintenanceResult = roleStatus.maintenanceResult;
  const maintenanceUnresolved = roleStatus.maintenance;
  const maintenanceDemonstration = {
    resultRecovered: maintenanceResult?.currentTask?.state === "success" &&
      maintenanceResult?.case?.phase === "result_recovered",
    resultTaskId: maintenanceResult?.taskId,
    unresolved: ["failed", "recovering"].includes(maintenanceUnresolved?.currentTask?.state) &&
      ["waiting_provider", "unresolved"].includes(maintenanceUnresolved?.case?.phase),
    unresolvedTaskId: maintenanceUnresolved?.taskId,
  };
  return {
    scenario: "node-recovery",
    ready,
    actualProductCommands: true,
    canvasId: generationFixture.canvasId,
    title: "失败节点恢复 · V4 同页三项本地验收",
    phase: "candidate",
    tasks,
    checks: { ...nodeRecoveryProductChecks },
    roles: roleStatus,
    recovery: {
      syntheticFixture: true,
      cases: caseItems,
      endpoint: "/api/generation-recovery",
    },
    maintenanceDemonstration,
    preserve: {
      expectedSuccessNodeCount: nodeRecoveryProductFixture.preservedSuccessNodeCount,
      successNodeIds: nodeRecoveryProductFixture.preservedSuccessNodeIds,
      successNodesPresent: preservedNodes.length === nodeRecoveryProductFixture.preservedSuccessNodeCount,
      successNodesStillPresent: preservedNodes.length === nodeRecoveryProductFixture.preservedSuccessNodeCount,
      successContentLayoutAndEdgesUnchanged: preservedSuccessFingerprint(canvas) === nodeRecoveryProductPreservedBaseline,
    },
    results: resultNodes,
    syntheticLayer: {
      fixturePath: "tests/fixtures/node-recovery-acceptance.json",
      taskStorage: "temporary application SQLite through real product task/case commands",
      providerMode: "dynamic loopback fake Provider only",
      providerRequests: nodeRecoveryProviderStats.posts + nodeRecoveryProviderStats.gets + nodeRecoveryProviderStats.mediaGets,
      providerPosts: nodeRecoveryProviderStats.posts,
      providerStatusGets: nodeRecoveryProviderStats.gets,
      providerMediaGets: nodeRecoveryProviderStats.mediaGets,
      externalProviderPosts: 0,
      paidProviderRequests: 0,
    },
    productLayer: {
      actualTaskList: true,
      actualRecoveryOwnerRead: true,
      actualCanvasRead: true,
      recoveryCommands: {
        claim: nodeRecoveryProductStats.claims,
        inspect: nodeRecoveryProductStats.inspections,
        progress: nodeRecoveryProductStats.progress,
      },
      newGenerationAdmissions: nodeRecoveryProductStats.admissions,
      canvasWrites: generationCounters.browserCanvasWrites,
      generationPosts: generationCounters.generationPosts,
      statusReads: generationCounters.statusReads,
      detailReads: generationCounters.detailReads,
      maxInFlightDetailReads: generationCounters.maxInFlightDetailReads,
      canvasCommands: generationCounters.browserCanvasCommandWrites,
    },
    counters: {
      statusReads: generationCounters.statusReads,
      detailReads: generationCounters.detailReads,
      generationDeletes: generationCounters.generationDeletes,
      generationPosts: generationCounters.generationPosts,
      syntheticProjectionPublications: generationCounters.syntheticProjectionWrites,
      providerRequests: nodeRecoveryProviderStats.posts + nodeRecoveryProviderStats.gets + nodeRecoveryProviderStats.mediaGets,
      paidProviderRequests: 0,
      canvasWrites: {
        browser: generationCounters.browserCanvasWrites,
        browserCommands: generationCounters.browserCanvasCommandWrites,
        control: generationCounters.controlCanvasWrites,
      },
    },
    canvas: {
      revision: canvas?.revision,
      graphRevision: canvas?.graphRevision,
      loadToken: canvas?.loadToken,
      resultNodes,
    },
    sentinels: generationFixture.sentinels,
    journalPath: generationJournalPath,
    retryPath: "/api/generation-tasks/<taskId> (new POST only after protected admission)",
    expiresAt: expiresAt.toISOString(),
    instructions: "三项调用真实本地任务、维护命令、结果保存和单节点准入；数据与假 Provider 仅存在于隔离验收环境，不代表真实平台或付款证据。",
  };
}

async function productAdminCase(taskId) {
  const response = await api(`/api/admin/generation-recovery/${encodeURIComponent(taskId)}`);
  const body = await response.json();
  if (!body?.case || !Number.isSafeInteger(body.case.caseEventId)) {
    throw new AcceptanceControlError("维护事项当前不可读取，请刷新验收页。", "NODE_RECOVERY_CASE_UNAVAILABLE", 503);
  }
  return body.case;
}

async function productRecoveryCommand(taskId, action, caseItem, extra = {}) {
  const commandId = `node-recovery-product-${action}-${randomUUID()}`;
  const body = { commandId, expectedCaseEventId: caseItem.caseEventId, ...extra };
  return api(`/api/admin/generation-recovery/${encodeURIComponent(taskId)}/${action}`, "POST", body, undefined, {
    "x-unboundry-recovery-command": "v1",
  });
}

async function runNodeRecoveryProductOriginal() {
  if (nodeRecoveryProductChecks.original !== "idle") {
    throw new AcceptanceControlError("原结果找回已经完成，请到右侧查看同一节点。", "NODE_RECOVERY_PRODUCT_ALREADY_DONE");
  }
  const role = productRole("originalResult");
  let caseItem = await productAdminCase(role.taskId);
  await productRecoveryCommand(role.taskId, "claim", caseItem);
  nodeRecoveryProductStats.claims += 1;
  caseItem = await productAdminCase(role.taskId);
  nodeRecoveryProductStats.inspections += 1;
  await productRecoveryCommand(role.taskId, "inspect", caseItem);
  nodeRecoveryProductChecks.original = "done";
  persistGenerationJournal("productOriginalRecoveryApplied", {
    taskId: role.taskId,
    caseId: role.caseId,
    actualCommand: "admin inspect -> protected adapter evidence -> original result save",
    providerPosts: nodeRecoveryProviderStats.posts,
  });
  return nodeRecoveryProductStatusPayload();
}

async function runNodeRecoveryProductMaintenance() {
  if (nodeRecoveryProductChecks.maintenance !== "idle") {
    throw new AcceptanceControlError("维护演示已经完成，请查看当前平台未确认状态。", "NODE_RECOVERY_PRODUCT_ALREADY_DONE");
  }
  const resultRole = productRole("maintenanceResult");
  let caseItem = await productAdminCase(resultRole.taskId);
  await productRecoveryCommand(resultRole.taskId, "claim", caseItem);
  nodeRecoveryProductStats.claims += 1;
  caseItem = await productAdminCase(resultRole.taskId);
  nodeRecoveryProductStats.inspections += 1;
  try {
    await productRecoveryCommand(resultRole.taskId, "inspect", caseItem);
  } catch (error) {
    let readback;
    try {
      readback = await nodeRecoveryProductStatusPayload();
    } catch {
      throw error;
    }
    const observed = readback.roles?.maintenanceResult;
    const observedTask = observed?.currentTask;
    const observedCase = observed?.case;
    const alreadyRecovered = readback.canvasId === generationFixture.canvasId &&
      observed?.taskId === resultRole.taskId &&
      observedTask?.id === resultRole.taskId &&
      observedTask?.canvasId === generationFixture.canvasId &&
      observedTask?.nodeId === resultRole.nodeId &&
      observedTask?.kind === resultRole.kind &&
      observedTask?.attempt === resultRole.executionAttempt &&
      observedCase?.caseId === resultRole.caseId &&
      observedCase?.taskId === resultRole.taskId &&
      observedCase?.canvasId === generationFixture.canvasId &&
      observedCase?.nodeId === resultRole.nodeId &&
      observedCase?.kind === resultRole.kind &&
      observedCase?.executionAttempt === resultRole.executionAttempt &&
      observedCase?.phase === "result_recovered" &&
      observedTask?.state === "success";
    if (!alreadyRecovered) throw error;
    persistGenerationJournal("productMaintenanceResultAlreadyRecovered", {
      taskId: resultRole.taskId,
      caseId: resultRole.caseId,
      actualCommand: "inspect conflict -> exact task/case readback",
      inspectError: String(error),
      providerPosts: nodeRecoveryProviderStats.posts,
    });
  }

  const unresolvedRole = productRole("maintenance");
  caseItem = await productAdminCase(unresolvedRole.taskId);
  await productRecoveryCommand(unresolvedRole.taskId, "claim", caseItem);
  nodeRecoveryProductStats.claims += 1;
  caseItem = await productAdminCase(unresolvedRole.taskId);
  await productRecoveryCommand(unresolvedRole.taskId, "progress", caseItem, { phase: "waiting_provider" });
  nodeRecoveryProductStats.progress += 1;
  caseItem = await productAdminCase(unresolvedRole.taskId);
  nodeRecoveryProductStats.inspections += 1;
  await productRecoveryCommand(unresolvedRole.taskId, "inspect", caseItem);
  nodeRecoveryProductChecks.maintenance = "done";
  persistGenerationJournal("productMaintenanceCaseHandled", {
    resultTaskId: resultRole.taskId,
    resultCaseId: resultRole.caseId,
    unresolvedTaskId: unresolvedRole.taskId,
    unresolvedCaseId: unresolvedRole.caseId,
    actualCommands: ["claim(result)", "inspect(result)", "claim(unresolved)", "progress(unresolved)", "inspect(unresolved)"],
    providerPosts: nodeRecoveryProviderStats.posts,
  });
  return nodeRecoveryProductStatusPayload();
}

async function runNodeRecoveryProductRetry() {
  if (nodeRecoveryProductChecks.retry !== "idle") {
    throw new AcceptanceControlError("当前视频已开始新一轮，请等待结果出现。", "NODE_RECOVERY_PRODUCT_ALREADY_DONE");
  }
  const role = productRole("failedVideo");
  const status = await nodeRecoveryProductStatusPayload();
  const current = status.tasks.find((task) => task.id === role.taskId);
  if (!current || current.state !== "failed") {
    throw new AcceptanceControlError("当前视频尚未通过受保护的失败结算，未提交新请求。", "NODE_RECOVERY_PRODUCT_NOT_ADMITTED");
  }
  // The guide clicks the real Video Creator button. Observe its normal client
  // lifecycle and product admission instead of submitting a second helper POST.
  const deadline = Date.now() + 30_000;
  let last;
  let observedChild;
  let childTaskId;
  while (Date.now() < deadline) {
    const payload = await (await api(`/api/generation-tasks?canvasId=${encodeURIComponent(generationFixture.canvasId)}&fixtureScopeId=${encodeURIComponent(nodeRecoveryProductFixture.fixtureScopeId)}`)).json();
    const candidates = (payload.tasks ?? []).filter(task => task.nodeId === role.nodeId && task.kind === "video" && task.id !== role.taskId);
    if (candidates.length > 1) throw new AcceptanceControlError("当前节点出现多个新任务，验收已停止。", "NODE_RECOVERY_PRODUCT_ADMISSION_INVALID", 503);
    last = candidates[0];
    if (last) { observedChild = last; childTaskId = last.id; role.childTaskId = childTaskId; }
    const child = last ?? observedChild;
    if (child?.state === "success") break;
    if (child?.state === "failed" || child?.state === "cancelled") {
      throw new AcceptanceControlError("单节点新一轮未成功，前面节点没有重新提交。", "NODE_RECOVERY_PRODUCT_RETRY_FAILED", 503);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!observedChild) {
    throw new AcceptanceControlError(
      "没有检测到当前视频的新任务，暂未确认产品已提交；请查看右侧生成按钮和本卡提示。",
      "NODE_RECOVERY_PRODUCT_NOT_SUBMITTED",
      409,
    );
  }
  if (observedChild.state !== "success") {
    throw new AcceptanceControlError("当前视频的新任务已提交，结果仍在保存，请刷新验收页查看原任务和新任务。", "NODE_RECOVERY_PRODUCT_RETRY_PENDING", 503);
  }
  const fixtureModule = await loadAcceptanceSourceModule(
    ssrModuleUrl(join(sourceRoot, "scripts/node-recovery-product-fixture.ts")),
  );
  let verification;
  try {
    verification = await fixtureModule.verifyNodeRecoveryProductRetry({
      canvasId: generationFixture.canvasId,
      childTaskId,
      dataDirectory: dataRoot,
      expectedChildProviderTaskId: "node-recovery-child-provider",
      expectedModelId: nodeRecoveryProductFixture.modelId,
      expectedParentProviderTaskId: role.providerTaskId,
      expectedProviderModelId: nodeRecoveryProductFixture.providerModelId,
      expectedProviderProfileId: nodeRecoveryProductFixture.profileId,
      expectedFixtureScopeId: nodeRecoveryProductFixture.fixtureScopeId,
      nodeId: role.nodeId,
      ownerId: nodeRecoveryProductFixture.ownerId,
      parentTaskId: role.taskId,
    });
  } catch {
    throw new AcceptanceControlError(
      "单节点新任务未通过临时数据库身份核验，验收已停止。",
      "NODE_RECOVERY_PRODUCT_ADMISSION_INVALID",
      503,
    );
  }
  nodeRecoveryProductStats.admissions += 1;
  nodeRecoveryProductChecks.retry = "done";
  persistGenerationJournal("productSingleNodeAdmissionApplied", {
    oldTaskId: role.taskId,
    taskId: childTaskId,
    actualCommand: "protected failure settlement -> real Video Creator click -> product admission -> loopback provider result",
    providerPosts: nodeRecoveryProviderStats.posts,
    verification,
  });
  return nodeRecoveryProductStatusPayload();
}

async function focusNodeRecoveryProduct(nodeId) {
  if (typeof nodeId !== "string" || !nodeRecoveryProductFixture.targetNodeIds.includes(nodeId)) {
    throw new AcceptanceControlError("画布节点定位参数无效。", "NODE_RECOVERY_PRODUCT_FOCUS_INVALID", 400);
  }
  return nodeRecoveryProductStatusPayload();
}

async function initializeNodeRecoveryProductFixture(canvasId, ownerId) {
  if (typeof ownerId !== "string" || ownerId.length === 0) {
    throw new Error("Node recovery product fixture requires the bootstrap owner identity");
  }
  nodeRecoveryFixture = readNodeRecoveryFixture();
  const fixtureModule = await loadAcceptanceSourceModule(
    ssrModuleUrl(join(sourceRoot, "scripts/node-recovery-product-fixture.ts")),
  );
  nodeRecoveryProductFixture = await fixtureModule.initializeNodeRecoveryProductFixture({
    canvasId,
    ownerId,
    sourceRoot,
  });
  const sentinels = nodeRecoveryProductFixture.preservedSuccessNodeIds.map((id) => ({
    id,
    kind: "text",
    state: "success",
    binding: `preserved-${id}`,
  }));
  generationFixture = {
    canvasId,
    events: [],
    modelCatalog: { generationEnabled: true, models: [] },
    phase: "candidate",
    sentinels,
  };
  generationTasks.clear();
  generationObservations.clear();
  generationBuilds = await buildGenerationClients();
  nodeRecoveryProductPreservedBaseline = preservedSuccessFingerprint(await (await api(`/api/canvas/${canvasId}`)).json());
  generationJournalPath = join(dataRoot, "node-recovery-product-acceptance-journal.json");
  persistGenerationJournal("productFixtureReady", {
    canvasId,
    scenario: "node-recovery",
    taskCount: Object.keys(nodeRecoveryProductFixture.roles).length,
    preservedSuccessNodeCount: nodeRecoveryProductFixture.preservedSuccessNodeCount,
    providerMode: "dynamic-loopback",
  });
  return nodeRecoveryProductFixture;
}

async function initializeNodeRecoveryFixture(canvasId, ownerId) {
  nodeRecoveryFixture = readNodeRecoveryFixture();
  if (nodeRecoveryProductMode) return initializeNodeRecoveryProductFixture(canvasId, ownerId);
  const moduleUrl = (path) => `/@fs/${path.split(sep).join("/")}`;
  const modelParameters = await loadAcceptanceSourceModule(moduleUrl(join(sourceRoot, "types/modelParameters.ts")));
  const workflow = await loadAcceptanceSourceModule(moduleUrl(join(sourceRoot, "client/src/generation/workflowNodeExecutors.ts")));
  generationRuntime = {
    defaultParameterValues: modelParameters.defaultParameterValues,
    knownModelParameterSchema: modelParameters.knownModelParameterSchema,
    currentWorkflowGenerationBinding: workflow.currentWorkflowGenerationBinding,
  };
  generationRuntime.schemas = Object.fromEntries(generationKinds.map((kind) => [
    kind,
    generationRuntime.knownModelParameterSchema({
      capability: kind,
      providerDriver: generationModelInputs[kind].providerDriver,
      providerModelId: generationModelInputs[kind].providerModelId,
    }),
  ]));
  const models = Object.fromEntries(generationKinds.map((kind) => [kind, [{
    capability: kind,
    displayName: `Node recovery ${kind}`,
    generationAvailable: true,
    generationUnavailableReason: "",
    generationUnavailableReasonCode: null,
    ...generationModelInputs[kind],
    isDefault: true,
    parameterSchema: generationRuntime.schemas[kind],
  }]]));
  const fixtureNodes = nodeRecoveryFixture.nodes.map((definition) => ({
    id: definition.id,
    type: definition.type,
    position: definition.position,
    data: {
      ...generationNodeData(definition.type, "shared", undefined, undefined, false),
      label: definition.label,
      title: definition.title,
    },
    style: definition.style ?? {
      width: definition.type === "image" ? 300 : 260,
      height: definition.type === "image" ? 190 : 220,
    },
  }));
  const graph = {
    apply: () => ({ status: "rejected" }),
    snapshot: () => ({ edges: [], nodes: fixtureNodes }),
  };
  const transientId = nodeRecoveryFixture.automaticRecovery.transient.id;
  const saveId = nodeRecoveryFixture.automaticRecovery.save.id;
  const retryId = nodeRecoveryFixture.retry.id;
  const unknownId = nodeRecoveryFixture.unknown.id;
  for (const definition of nodeRecoveryFixture.nodes) {
    const binding = generationRuntime.currentWorkflowGenerationBinding({
      context: { canvasId, graph, isFixture: true, modelCatalog: { models, status: "ready" } },
      kind: definition.type,
      nodeId: definition.id,
    });
    if (!binding) throw new Error(`Could not derive node recovery generation binding for ${definition.id}`);
    const identity = {
      generationIdentityVersion: 2,
      generationInputKey: binding.inputFingerprint,
      generationOwnershipKey: binding.ownershipKey,
      modelConfigurationRevision: binding.modelConfigurationRevision,
      modelInputContractFingerprint: binding.inputContractFingerprint,
      modelReleaseRevision: binding.modelReleaseRevision,
    };
    const id = definition.id;
    const result = generationResultFor(definition.type, id);
    const mediaBytes = definition.type === "image"
      ? readFileSync(join(sourceRoot, "spec/reference/upstream-v2.12.2-dense/15-ai-image-creator-result-1280x720.png"))
      : definition.type === "video"
        ? readFileSync(join(sourceRoot, "client/public/fixtures/video-success.mp4"))
        : undefined;
    let registeredMedia;
    if (mediaBytes) {
      await api(result.resultUrl, "POST", mediaBytes, result.mediaContentType);
      registeredMedia = await (await api(`/api/media-metadata/${definition.type}/${result.assetId}`)).json();
      const storedBytes = Buffer.from(await (await api(result.resultUrl)).arrayBuffer());
      const checksumSha256 = createHash("sha256").update(storedBytes).digest("hex");
      if (checksumSha256 !== createHash("sha256").update(mediaBytes).digest("hex") ||
          registeredMedia.storageBackend !== "local" || registeredMedia.byteSize !== mediaBytes.length) {
        throw new Error(`Node recovery media fixture was not registered exactly: ${id}`);
      }
      registeredMedia = { ...registeredMedia, checksumSha256 };
    }
    const successDefinition = nodeRecoveryFixture.successNodes.find((node) => node.id === id);
    const mode = id === retryId ? "provider-failed" : undefined;
    const failure = id === retryId
      ? nodeRecoveryFixture.retry.modes[mode]
      : id === unknownId
        ? nodeRecoveryFixture.unknown
        : undefined;
    const initialState = successDefinition ? "success" : (id === transientId || id === saveId ? "running" : "failed");
    const task = {
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
      errorCode: failure?.errorCode,
      errorMessage: failure ? `${failure.errorMessage}\n${failure.rawProviderMessage ?? ""}` : undefined,
      fixtureScopeId: "",
      id,
      kind: definition.type,
      model: generationModelInputs[definition.type].id,
      nodeId: definition.id,
      prompt: `${definition.type} 原始提示词`,
      retryAllowed: false,
      retryBlockCode: failure?.retryBlockCode,
      retryBlockReason: failure?.retryBlockReason,
      newGenerationAllowed: id === retryId ? true : id === unknownId ? false : undefined,
      newGenerationBlockReason: id === unknownId ? failure?.retryBlockReason : undefined,
      replacementTaskId: undefined,
      rawProviderMessage: failure?.rawProviderMessage,
      resultText: successDefinition?.resultText ?? definition.resultText ?? result.resultText,
      state: initialState,
      updatedAt: new Date().toISOString(),
      acceptancePhase: "shared",
      maxInFlightReads: 0,
      identity,
      projectionPersisted: initialState === "success",
      canvasProjectionState: initialState === "success" ? "applied" : "pending",
      fault: {
        continuous: false,
        remainingFailures: 0,
        statuses: [],
        terminalOnRecovery: false,
      },
    };
    generationTasks.set(id, task);
  }
  const sentinels = nodeRecoveryFixture.successNodes.map((node) => ({
    id: `${node.id}-sentinel`,
    kind: node.type,
    state: "success",
    binding: `preserved-${node.id}`,
  }));
  generationFixture = {
    canvasId,
    events: [],
    modelCatalog: { generationEnabled: true, models: generationKinds.flatMap((kind) => models[kind]) },
    phase: "candidate",
    sentinels,
  };
  const recoveryOpenedAt = new Date().toISOString();
  const recoveryDefinitions = nodeRecoveryFixture.v4.cases;
  nodeRecoveryRecoveryCases.clear();
  nodeRecoveryMaintenanceStage = "queued";
  for (const [caseKey, definition] of Object.entries(recoveryDefinitions)) {
    const initial = caseKey === "failedVideo"
      ? {
          phase: "ready_for_user",
          reasonCode: "operator_incident",
          summary: "已核实此视频可以继续；只重新生成当前视频，前面9个成功节点保持不变",
          status: "ready_for_user",
          action: "regenerate",
        }
      : {
          phase: "queued",
          reasonCode: caseKey === "maintenance" ? "outcome_unknown" : "result_recovery_pending",
          summary: caseKey === "maintenance"
            ? "已登记待处理；你不用查任务号或重复提交"
            : "系统正在准备原请求的自动找回；你不用点击恢复",
          status: "queued",
          action: "view_progress",
        };
    nodeRecoveryRecoveryCases.set(caseKey, {
      ...definition,
      canvasId,
      phase: initial.phase,
      reasonCode: initial.reasonCode,
      summary: initial.summary,
      status: initial.status,
      action: initial.action,
      caseEventId: 1,
      progressVersion: 1,
      lastReadProgressVersion: 0,
      openedAt: recoveryOpenedAt,
      updatedAt: recoveryOpenedAt,
    });
  }
  generationBuilds = await buildGenerationClients();
  generationJournalPath = join(dataRoot, "node-recovery-acceptance-journal.json");
  persistGenerationJournal("fixtureReady", {
    canvasId,
    scenario: "node-recovery",
    taskCount: generationTasks.size,
    preservedSuccessNodeCount: nodeRecoveryFixture.preservedSuccessNodeCount,
  });
  return models;
}

async function initializeGenerationFixture(canvasId, ownerId) {
  validateGenerationBaseline();
  if (nodeRecoveryScenario) return initializeNodeRecoveryFixture(canvasId, ownerId);
  generationRuntime = {};
  const moduleUrl = (path) => `/@fs/${path.split(sep).join("/")}`;
  const modelParameters = await loadAcceptanceSourceModule(moduleUrl(join(sourceRoot, "types/modelParameters.ts")));
  const workflow = await loadAcceptanceSourceModule(moduleUrl(join(sourceRoot, "client/src/generation/workflowNodeExecutors.ts")));
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

function nodeRecoveryTask(id) {
  const task = generationTasks.get(id);
  if (!task) throw new AcceptanceControlError("找不到这个本地验收任务，请刷新验收页。", "NODE_RECOVERY_TASK_NOT_FOUND", 404);
  return task;
}

function requireNodeRecoveryObserved(id) {
  const task = nodeRecoveryTask(id);
  const observation = generationObservations.get(id);
  if (!observation || observation.successfulReads < 1 || Date.now() - observation.lastSuccessAt > 30000) {
    throw new AcceptanceControlError("请先打开同页测试画布，让当前演示任务完成一次正常状态读取。", "NODE_RECOVERY_CANVAS_NOT_READY");
  }
  return task;
}

function armNodeRecoveryTask(task, statuses) {
  task.state = "running";
  task.errorCode = undefined;
  task.errorMessage = undefined;
  task.retryAllowed = false;
  task.retryBlockCode = undefined;
  task.retryBlockReason = undefined;
  task.projectionPersisted = false;
  task.canvasProjectionState = "pending";
  task.fault = {
    continuous: false,
    remainingFailures: statuses.length,
    statuses: [...statuses],
    terminalOnRecovery: true,
  };
  task.updatedAt = new Date().toISOString();
}

async function startNodeRecoveryDemo(action) {
  if (!nodeRecoveryFixture) throw new AcceptanceControlError("本地验收夹具尚未准备完成。", "NODE_RECOVERY_NOT_READY", 503);
  if (!["transient", "save"].includes(action)) {
    throw new AcceptanceControlError("未知的自动恢复演示。", "NODE_RECOVERY_UNKNOWN_DEMO", 400);
  }
  if (nodeRecoveryChecks[action] !== "idle") {
    throw new AcceptanceControlError("这一项已经启动；请回到测试画布观察结果。", "NODE_RECOVERY_DEMO_STARTED");
  }
  const definition = nodeRecoveryFixture.automaticRecovery[action];
  const task = nodeRecoveryTask(definition.id);
  armNodeRecoveryTask(task, definition.faultStatuses);
  const observation = generationObservations.get(task.id) ?? { successfulReads: 0, failedReads: 0, lastSuccessAt: 0 };
  observation.failedReads = 0;
  generationObservations.set(task.id, observation);
  if (action === "save") {
    nodeRecoveryState.saveFaultRemaining = definition.faultStatuses.length;
    nodeRecoveryState.saveFaultStatuses = [...definition.faultStatuses];
  }
  nodeRecoveryChecks[action] = "started";
  await focusNodeRecovery(action);
  persistGenerationJournal("nodeRecoveryDemoStarted", {
    action,
    taskId: task.id,
    faultStatuses: definition.faultStatuses,
    productMustRecover: true,
  });
  return nodeRecoveryStatusPayload();
}

async function setNodeRecoveryRetryMode(mode) {
  if (!nodeRecoveryFixture || !nodeRecoveryFixture.retry.modes[mode]) {
    throw new AcceptanceControlError("请选择余额拒绝或平台最终失败。", "NODE_RECOVERY_UNKNOWN_RETRY_MODE", 400);
  }
  // Explicitly prepare another independent synthetic case; never mutate a real task.
  for (const [id, item] of generationTasks) {
    if (item.nodeId === nodeRecoveryFixture.retry.id && id !== nodeRecoveryFixture.retry.id) generationTasks.delete(id);
  }
  nodeRecoveryState.retryAccepted = false;
  nodeRecoveryState.newTaskId = undefined;
  const task = nodeRecoveryTask(nodeRecoveryFixture.retry.id);
  if (task.state !== "failed" || task.attempt !== 1) {
    throw new AcceptanceControlError("失败视频状态已变化，请重新准备本地验收数据。", "NODE_RECOVERY_RETRY_TASK_CHANGED");
  }
  const modeDefinition = nodeRecoveryFixture.retry.modes[mode];
  nodeRecoveryState.retryMode = mode;
  task.errorCode = modeDefinition.errorCode;
  task.errorMessage = `${modeDefinition.errorMessage}\n${modeDefinition.rawProviderMessage ?? ""}`;
  task.retryAllowed = false;
  task.newGenerationAllowed = true;
  task.retryBlockCode = undefined;
  task.retryBlockReason = undefined;
  task.failureMode = mode;
  nodeRecoveryChecks.retry = "armed";
  await focusNodeRecovery("retry");
  persistGenerationJournal("nodeRecoveryRetryMode", { taskId: task.id, mode });
  return nodeRecoveryStatusPayload();
}

function markNodeRecoveryUnknown() {
  const task = nodeRecoveryTask(nodeRecoveryFixture.unknown.id);
  if (task.state !== "failed" || task.retryAllowed !== false ||
      task.errorCode !== nodeRecoveryFixture.unknown.errorCode) {
    throw new AcceptanceControlError("无法确认案例状态已变化，请重新准备本地验收数据。", "NODE_RECOVERY_UNKNOWN_TASK_CHANGED");
  }
  nodeRecoveryChecks.unknown = "user-recheck";
  persistGenerationJournal("nodeRecoveryUnknownViewed", {
    taskId: task.id,
    retryAllowed: task.retryAllowed,
    providerRequests: 0,
  });
  return nodeRecoveryStatusPayload();
}

function setNodeRecoveryMaintenanceStage(phase) {
  const phases = nodeRecoveryFixture?.v4?.maintenancePhases;
  if (!Array.isArray(phases) || !phases.includes(phase)) {
    throw new AcceptanceControlError("维护进度演示阶段无效。", "NODE_RECOVERY_INVALID_MAINTENANCE_PHASE", 400);
  }
  const currentIndex = phases.indexOf(nodeRecoveryMaintenanceStage);
  const nextIndex = phases.indexOf(phase);
  if (nextIndex < currentIndex) {
    throw new AcceptanceControlError("维护进度只能向前演示，请重新准备本地验收数据。", "NODE_RECOVERY_MAINTENANCE_PHASE_REWIND");
  }
  nodeRecoveryMaintenanceStage = phase;
  const patch = phase === "queued"
    ? {
        phase: "queued",
        reasonCode: "outcome_unknown",
        summary: "已登记待处理；你不用查任务号或重复提交",
        status: "queued",
        action: "view_progress",
        lastCheckedAt: undefined,
        nextCheckAt: undefined,
      }
    : phase === "claimed"
      ? {
          phase: "claimed",
          reasonCode: "outcome_unknown",
          summary: "维护人员已接手，正在核对原请求；原任务仍受保护",
          status: "claimed",
          action: "view_progress",
          lastCheckedAt: undefined,
          nextCheckAt: undefined,
        }
      : {
          phase: "waiting_provider",
          reasonCode: "outcome_unknown",
          summary: "维护人员已接手，正在等待平台回复；原任务仍受保护",
          status: "waiting_provider",
          action: "view_progress",
          lastCheckedAt: new Date().toISOString(),
          nextCheckAt: new Date(Date.now() + 30000).toISOString(),
        };
  updateNodeRecoveryRecoveryCase("maintenance", patch);
  persistGenerationJournal("nodeRecoveryMaintenanceStage", {
    taskId: nodeRecoveryFixture.v4.cases.maintenance.taskId,
    caseId: nodeRecoveryFixture.v4.cases.maintenance.caseId,
    phase,
    syntheticOnly: true,
  });
  return nodeRecoveryStatusPayload();
}

async function focusNodeRecovery(action) {
  const definition = action === 'retry' ? nodeRecoveryFixture.retry
    : action === 'unknown' ? nodeRecoveryFixture.unknown
    : nodeRecoveryFixture.automaticRecovery[action];
  const document = await (await api(`/api/canvas/${generationFixture.canvasId}`)).json();
  await generationDocumentPut({ ...document,
    viewport: action === 'overview' ? { x: 160, y: 120, zoom: 0.45 }
      : { x: 350 - definition.position.x * 0.7, y: 150 - definition.position.y * 0.7, zoom: 0.7 },
  }, 'control');
  return nodeRecoveryStatusPayload();
}

function nodeRecoveryRetryRequest(body) {
  const task = nodeRecoveryTask(nodeRecoveryFixture.retry.id);
  if (nodeRecoveryState.retryAccepted) {
    const admitted = generationTasks.get(nodeRecoveryState.newTaskId);
    if (admitted?.idempotencyKey === body.idempotencyKey) return generationTaskPublic(admitted);
    throw new AcceptanceControlError('本场景的视频已提交，请等待结果。', 'NODE_RECOVERY_ALREADY_ADMITTED');
  }
  if (!body || body.replacesTaskId !== task.id || task.newGenerationAllowed !== true ||
      task.state !== 'failed' || !nodeRecoveryState.retryMode ||
      body.canvasId !== task.canvasId || body.nodeId !== task.nodeId || body.kind !== 'video' ||
      body.model !== task.model || body.generationInputKey !== task.generationInputKey ||
      body.generationOwnershipKey !== task.generationOwnershipKey ||
      body.modelConfigurationRevision !== task.modelConfigurationRevision ||
      body.modelInputContractFingerprint !== task.modelInputContractFingerprint ||
      body.modelReleaseRevision !== task.modelReleaseRevision ||
      typeof body.idempotencyKey !== 'string' || !body.idempotencyKey) {
    throw new AcceptanceControlError('当前视频的失败任务或输入不匹配，未提交。', 'NODE_RECOVERY_NEW_INTENT_MISMATCH');
  }
  const child = { ...task, id: `node-recovery-rerun-${randomUUID()}`, idempotencyKey: body.idempotencyKey,
    attempt: 1, state: 'running', errorCode: undefined, errorMessage: undefined,
    newGenerationAllowed: false, retryAllowed: false, retryBlockCode: undefined,
    retryBlockReason: undefined, newGenerationBlockReason: undefined,
    rawProviderMessage: undefined, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    projectionPersisted: false, canvasProjectionState: 'pending',
    canvasRevision: body.canvasRevision,
    fault: { continuous: false, remainingFailures: 0, statuses: [], terminalOnRecovery: true },
  };
  task.newGenerationAllowed = false;
  task.newGenerationBlockReason = '当前视频已有新一轮任务，正在等待结果';
  nodeRecoveryState.retryAccepted = true;
  nodeRecoveryState.newTaskId = child.id;
  nodeRecoveryChecks.retry = 'accepted';
  generationTasks.set(child.id, child);
  persistGenerationJournal('nodeRecoveryNewIntentAccepted', {
    oldTaskId: task.id, taskId: child.id, oldState: task.state, mode: nodeRecoveryState.retryMode,
    providerRequests: 0, paidProviderRequests: 0,
  });
  return generationTaskPublic(child);
}


let productSmokeStarted = false;
async function smokeNodeRecoveryProductGuide({ order = "user" } = {}) {
  if (!['user', 'retry-first'].includes(order)) {
    throw new AcceptanceControlError("验收顺序参数无效。", "PRODUCT_SMOKE_INVALID_ORDER", 400);
  }
  if (productSmokeStarted || Object.values(nodeRecoveryProductChecks).some(value => value !== "idle")) {
    throw new AcceptanceControlError("请使用新的临时验收实例运行浏览器检查。", "PRODUCT_SMOKE_REQUIRES_FRESH_DATA", 409);
  }
  productSmokeStarted = true;
  const { chromium, expect } = await import('@playwright/test');
  let browser, context, page;
  let smokeStage = 'launch';
  const forbidden = [], pageErrors = [];
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      forbidden.push(url.origin);
      return route.abort('blockedbyclient');
    });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => pageErrors.push(error.message));
    const frame = page.frameLocator('#canvas');
    const node = role => frame.locator(`.react-flow__node[data-id="${productRole(role).nodeId}"]`);
    const waitForGuideIdle = async (stage, timeout = 15_000) => {
      smokeStage = stage;
      await page.waitForFunction(
        () => document.documentElement.dataset.acceptanceBusy === 'false',
        undefined,
        { timeout },
      );
    };
    const clickGuideButton = async (name, stage) => {
      await waitForGuideIdle(`${stage}:before-click-idle`);
      smokeStage = `${stage}:connection`;
      await expect(page.locator('#connection')).toContainText('画布已准备好', { timeout: 15_000 });
      smokeStage = `${stage}:button-enabled`;
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeEnabled({ timeout: 15_000 });
      smokeStage = `${stage}:click`;
      await button.click();
    };
    const select = async role => {
      smokeStage = `select:${role}:open-search`;
      await frame.getByTestId('node-search').click();
      smokeStage = `select:${role}:choose-result`;
      await frame.locator(`[data-testid="node-search-results"] [data-node-id="${productRole(role).nodeId}"]`).click();
      smokeStage = `select:${role}:identity`;
      await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-primary-node', productRole(role).nodeId, { timeout: 15_000 });
      await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-selected-node-count', '1', { timeout: 15_000 });
    };
    const videoVisible = async role => {
      const video = node(role).getByTestId('video-node-preview');
      await expect(video).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => video.evaluate(element => Boolean(
        element.readyState >= 2 && element.currentSrc && !element.error &&
        element.videoWidth > 0 && Number.isFinite(element.duration) && element.duration > 0
      )), { timeout: 30_000 }).toBe(true);
      await expect(node(role).locator('.media-load-fallback')).toHaveCount(0);
      await expect(node(role).locator('.provider-error-notice')).toHaveCount(0);
    };
    const assertUnknownCreator = async stage => {
      smokeStage = `${stage}:creator`;
      const unknownCreator = frame.locator(`[data-testid="video-creator"][data-id~="${productRole('maintenance').nodeId}"]`);
      await expect(unknownCreator).toHaveCount(1, { timeout: 15_000 });
      const unknownGenerate = unknownCreator.locator('button.video-creator-generate');
      await expect(unknownGenerate).toHaveCount(1, { timeout: 15_000 });
      const buttonState = await unknownGenerate.evaluate(button => ({
        ariaLabel: button.getAttribute('aria-label'),
        disabled: button.disabled,
      }));
      const allowedBusyLabels = new Set(['取消生成', 'Generating...', 'Submitting...', '正在保存画布…']);
      smokeStage = `${stage}:button-state`;
      if (buttonState.ariaLabel === 'Generate') {
        await expect(unknownGenerate).toBeDisabled({ timeout: 15_000 });
      } else if (!allowedBusyLabels.has(buttonState.ariaLabel) ||
        (buttonState.ariaLabel !== '取消生成' && !buttonState.disabled)) {
        throw new Error(`平台未确认节点的生成按钮状态不安全：${buttonState.ariaLabel ?? '无aria-label'}`);
      }
    };
    const runOriginal = async () => {
      await clickGuideButton('开始找回原结果', '1:original');
      await waitForGuideIdle('1:after-click-idle');
      smokeStage = '1:original-status';
      await expect(page.locator('#original-status')).toContainText('原任务结果已保存', { timeout: 30_000 });
      smokeStage = '1:original-media';
      await videoVisible('originalResult');
    };
    const runMaintenance = async () => {
      await clickGuideButton('开始维护处理', '2:maintenance');
      await waitForGuideIdle('2:after-click-idle');
      smokeStage = '2:maintenance-status';
      await expect(page.locator('#maintenance-status')).toContainText('维护后结果已找回', { timeout: 30_000 });
      smokeStage = '2:maintenance-media';
      await videoVisible('maintenanceResult');
    };
    const runRetry = async () => {
      await clickGuideButton('继续当前视频', '3:retry');
      await waitForGuideIdle('3:after-click-idle', 45_000);
      smokeStage = '3:retry-status';
      await expect(page.locator('#retry-status')).toContainText('已为当前视频创建新任务', { timeout: 30_000 });
      smokeStage = '3:retry-media';
      await videoVisible('failedVideo');
    };
    const assertUnknown = async () => {
      await clickGuideButton('查看仍未确认的节点', 'unknown');
      await waitForGuideIdle('unknown:after-click-idle');
      smokeStage = 'unknown:status';
      await expect(node('maintenance')).toContainText('正在等待平台回复', { timeout: 30_000 });
      await assertUnknownCreator('unknown');
    };
    const refreshAndAssert = async roles => {
      await waitForGuideIdle(`refresh:${roles.join(',')}:before-click-idle`);
      await expect(page.locator('#connection')).toContainText('画布已准备好', { timeout: 15_000 });
      smokeStage = `refresh:${roles.join(',')}:click`;
      const reloadMarker = `${Date.now()}-${Math.random()}`;
      await page.locator('#canvas').evaluate((iframe, marker) => {
        iframe.setAttribute('data-acceptance-reload', marker);
        iframe.addEventListener('load', () => {
          if (iframe.getAttribute('data-acceptance-reload') === marker) {
            iframe.setAttribute('data-acceptance-reload', `${marker}:loaded`);
          }
        }, { once: true });
      }, reloadMarker);
      await page.getByRole('button', { name: '刷新右侧画布', exact: true }).click();
      await page.waitForFunction(
        marker => document.querySelector('#canvas')?.getAttribute('data-acceptance-reload') === `${marker}:loaded`,
        reloadMarker,
        { timeout: 30_000 },
      );
      await waitForGuideIdle(`refresh:${roles.join(',')}:guide-idle`);
      smokeStage = `refresh:${roles.join(',')}:ready`;
      await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-persistence-ready', 'true', { timeout: 30_000 });
      for (const role of roles) {
        smokeStage = `refresh:${roles.join(',')}:select:${role}`;
        await select(role);
        smokeStage = `refresh:${roles.join(',')}:media:${role}`;
        await videoVisible(role);
      }
      smokeStage = `refresh:${roles.join(',')}:unknown`;
      await select('maintenance');
      await expect(node('maintenance')).toContainText('正在等待平台回复');
      await assertUnknownCreator(`refresh:${roles.join(',')}:unknown`);
    };
    smokeStage = 'initial:goto';
    await page.goto(`${origin}/__acceptance`);
    smokeStage = 'initial:ready';
    await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-persistence-ready', 'true', { timeout: 30_000 });
    if (order === 'retry-first') {
      await runRetry();
      await runOriginal();
      await runMaintenance();
      await refreshAndAssert(['failedVideo', 'originalResult', 'maintenanceResult']);
    } else {
      await runOriginal();
      await runMaintenance();
      await assertUnknown();
      await refreshAndAssert(['originalResult', 'maintenanceResult']);
      await runRetry();
      await refreshAndAssert(['failedVideo', 'originalResult', 'maintenanceResult']);
    }
    await select('maintenanceResult');
    const status = await nodeRecoveryProductStatusPayload();
    expect(status.preserve.successContentLayoutAndEdgesUnchanged).toBe(true);
    expect(status.maintenanceDemonstration).toMatchObject({ resultRecovered: true, unresolved: true });
    expect(nodeRecoveryProviderStats.posts).toBe(1);
    expect(generationCounters.generationPosts).toBe(1);
    expect(pageErrors).toEqual([]);
    expect(forbidden).toEqual([]);
    const screenshotPath = join(testRoot, 'node-recovery-product-smoke.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const report = { status: 'TECHNICAL_PASS', syntheticOnly: true, browser: 'isolated-headless',
      order: order === 'retry-first' ? '3-1-2' : '1-2-refresh-unknown-3',
      childTestedBeforeOtherRefresh: order === 'retry-first', retryAfterRefreshTested: order === 'user',
      originalResultVisible: true, maintenanceResultVisible: true,
      unresolvedPreserved: true, refreshPreserved: true, successNodesUnchanged: true,
      actualProductButtons: true, providerPosts: nodeRecoveryProviderStats.posts,
      pageErrors, forbidden, screenshotPath, product: status.productLayer, synthetic: status.syntheticLayer };
    writeFileSync(join(testRoot, 'node-recovery-product-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[node-recovery-product-smoke-pass] ${JSON.stringify(report)}`);
    return report;
  } catch (error) {
    const iframeDiagnostics = page
      ? await page.locator('#canvas').evaluate((iframe, targetNodeId) => {
        const doc = iframe.contentDocument;
        const visible = element => Boolean(element && element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none');
        const world = doc?.querySelector('[data-testid="canvas-world"]');
        const creators = Array.from(doc?.querySelectorAll('[data-testid="video-creator"]') ?? [])
          .filter(creator => creator.getAttribute('data-id')?.split(/\s+/).includes(targetNodeId));
        const errors = Array.from(doc?.querySelectorAll('.video-node-upload-error,.provider-error-notice') ?? [])
          .filter(visible)
          .map(element => ({ className: String(element.className), text: element.textContent?.trim().slice(0, 500) }));
        return {
          world: world ? {
            persistenceReady: world.getAttribute('data-persistence-ready'),
            primaryNode: world.getAttribute('data-primary-node'),
            selectedNodeCount: world.getAttribute('data-selected-node-count'),
          } : null,
          targetNodeId,
          targetCreators: creators.map(creator => {
            const button = creator.querySelector('button.video-creator-generate');
            return {
              creatorDataId: creator.getAttribute('data-id'),
              creatorVisible: visible(creator),
              ariaLabel: button?.getAttribute('aria-label') ?? null,
              disabled: button?.disabled ?? null,
              buttonVisible: visible(button),
            };
          }),
          visibleErrors: errors,
        };
      }, nodeRecoveryProductFixture?.roles?.failedVideo?.nodeId ?? null).catch(diagnosticError => ({
        error: String(diagnosticError),
      }))
      : null;
    console.error('[node-recovery-product-smoke-failed]', JSON.stringify({ message: String(error),
      stage: smokeStage,
      iframeDiagnostics,
      text: page ? await page.locator('body').innerText({ timeout: 1000 }).then(text => text.slice(0, 2000)).catch(() => '') : '',
      pageErrors, forbidden }));
    throw error;
  } finally {
    try {
      await context?.close();
    } finally {
      await browser?.close();
    }
  }
}

async function smokeNodeRecoveryGuide() {
  const { chromium, expect } = await import('@playwright/test');
  const savedTasks = structuredClone([...generationTasks]);
  const savedChecks = { ...nodeRecoveryChecks };
  const savedState = structuredClone(nodeRecoveryState);
  const savedRecoveryCases = structuredClone([...nodeRecoveryRecoveryCases]);
  const savedMaintenanceStage = nodeRecoveryMaintenanceStage;
  const savedCounters = { ...generationCounters };
  const savedCanvas = await (await api(`/api/canvas/${generationFixture.canvasId}`)).json();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
  const forbidden = [];
  const pageErrors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    forbidden.push(url.origin);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(15000);
  const frame = page.frameLocator('#canvas');
  const loaded = () => expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-persistence-ready', 'true', { timeout: 20000 });
  const nodeIsInVisibleWorld = (node) => node.evaluate((element) => {
    const world = element.ownerDocument.querySelector('[data-testid="canvas-world"]');
    if (!world) return false;
    const nodeRect = element.getBoundingClientRect();
    const worldRect = world.getBoundingClientRect();
    const visibleWidth = Math.min(nodeRect.right, worldRect.right) - Math.max(nodeRect.left, worldRect.left);
    const visibleHeight = Math.min(nodeRect.bottom, worldRect.bottom) - Math.max(nodeRect.top, worldRect.top);
    return nodeRect.width > 0 && nodeRect.height > 0 &&
      visibleWidth >= Math.min(32, nodeRect.width) && visibleHeight >= Math.min(32, nodeRect.height);
  });
  const report = { steps: [], generationPosts: 0, providerRequests: 0, pageErrors, forbidden };
  try {
    await page.goto(`${origin}/__acceptance`);
    await loaded();
    await expect(page.getByRole('heading', { name: '这次验收3项', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1. 自动找回原结果', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '2. 维护进度能在重开后看见', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '3. 已核实失败，只补当前视频', exact: true })).toBeVisible();
    await expect(page.getByText('全部是模拟任务，不会扣费，本轮还没上线', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '开始自动找回原结果', exact: true }).click();
    await loaded();
    const transientNode = frame.locator('.react-flow__node[data-id="node-recovery-auto-transient"]');
    await expect(transientNode).toBeVisible({ timeout: 20000 });
    await expect.poll(() => nodeIsInVisibleWorld(transientNode)).toBe(true);
    await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-primary-node', 'node-recovery-auto-transient');
    await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-selected-node-count', '1');
    await expect(transientNode).toHaveClass(/selected/);
    await expect(transientNode).not.toContainText('短暂故障已自动越过');
    report.steps.push('transient-focused-before-result');
    await expect(transientNode).toContainText('短暂故障已自动越过', { timeout: 20000 });
    expect(generationObservations.get('node-recovery-auto-transient')?.failedReads).toBe(2);
    expect(generationCounters.generationPosts).toBe(0);
    report.steps.push('transient-focused-visible-and-recovered');
    const summaryKeys = [...recoveryCaseSummaryKeys, ...recoveryCaseSummaryOptionalKeys];
    const ownerBatch = await (await fetch(`${origin}/api/generation-recovery?taskIds=node-recovery-auto-transient,node-recovery-text-unknown,node-recovery-video-failed`)).json();
    expect(ownerBatch.enabled).toBe(true);
    expect(ownerBatch.cases).toHaveLength(3);
    for (const item of ownerBatch.cases) {
      expect(Object.keys(item).every((key) => summaryKeys.includes(key))).toBe(true);
      expect(recoveryCaseSummaryKeys.every((key) => Object.hasOwn(item, key))).toBe(true);
    }
    expect(ownerBatch.cases.find((item) => item.taskId === 'node-recovery-auto-transient')?.status).toBe('result_recovered');
    report.steps.push('owner-flat-summary-original-result');
    await page.getByRole('button', { name: '开始维护进度演示', exact: true }).click();
    await expect(page.locator('#maintenance-status')).toContainText('正在等待平台回复');
    await page.getByRole('button', { name: '重新打开处理进度', exact: true }).click();
    await expect(page.locator('#maintenance-status')).toContainText('正在等待平台回复');
    const reopened = await (await fetch(`${origin}/api/generation-recovery/node-recovery-text-unknown`)).json();
    expect(reopened.case?.phase).toBe('waiting_provider');
    report.steps.push('maintenance-progress-reopened');
    await page.locator('#v3-regression').locator('summary').click();
    await page.getByRole('button', { name: '开始图片保存恢复', exact: true }).click();
    await loaded();
    const image = frame.getByTestId('image-node-node-recovery-auto-save').locator('img').first();
    await expect(image).toBeVisible({ timeout: 20000 });
    await expect.poll(() => generationTasks.get('node-recovery-auto-save')?.projectionPersisted).toBe(true);
    await page.getByRole('button', { name: '刷新右侧画布', exact: true }).click();
    await loaded();
    await expect(image).toBeVisible();
    expect(generationCounters.generationPosts).toBe(0);
    report.steps.push('same-result-save-and-refresh');
    for (const label of ['演示：余额问题已核实未受理', '演示：平台最终失败已核实']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await loaded();
      const node = frame.locator('.react-flow__node[data-id="node-recovery-video-failed"]');
      await node.click({ position: { x: 8, y: 8 } });
      const creator = frame.getByTestId('video-creator');
      const generate = creator.getByRole('button', { name: 'Generate', exact: true });
      await expect(generate).toBeEnabled();
      const beforePosts = generationCounters.generationPosts;
      await generate.click();
      await expect.poll(() => generationCounters.generationPosts).toBe(beforePosts + 1);
      await expect(node.locator('video')).toHaveAttribute('src', /video-assets/, { timeout: 20000 });
      await page.getByRole('button', { name: '刷新右侧画布', exact: true }).click();
      await loaded();
      await expect(node.locator('video')).toHaveAttribute('src', /video-assets/);
      report.steps.push(label);
    }
    await page.getByRole('button', { name: '查看无法确认的节点', exact: true }).click();
    await loaded();
    const unknownNode = frame.locator('.react-flow__node[data-id="node-recovery-text-unknown"]');
    await expect(unknownNode).toBeVisible({ timeout: 20000 });
    await expect.poll(() => nodeIsInVisibleWorld(unknownNode)).toBe(true);
    await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-primary-node', 'node-recovery-text-unknown');
    await expect(frame.getByTestId('canvas-world')).toHaveAttribute('data-selected-node-count', '1');
    await expect(unknownNode).toHaveClass(/selected/);
    await expect(unknownNode.getByRole('textbox', { name: 'Text 标题', exact: true })).toHaveValue('无法确认的旧请求');
    const unknownCreator = frame.getByTestId('text-creator');
    await expect(unknownCreator).toBeVisible();
    await expect.poll(() => nodeIsInVisibleWorld(unknownCreator)).toBe(true);
    await expect(unknownCreator.getByText(/为避免重复付费/)).toBeInViewport({ ratio: 1 });
    await expect(unknownCreator.getByRole('button', { name: 'Generate', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(unknownCreator).toContainText('为避免重复付费');
    await expect(unknownCreator.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
    await expect(frame.locator('.text-node-generation-notice')).toContainText(/原请求|原任务|无法确认|不能重新/);
    report.steps.push('unknown-focused-visible-creator-protected');
    const currentCanvas = await (await api(`/api/canvas/${generationFixture.canvasId}`)).json();
    const successIds = new Set(nodeRecoveryFixture.successNodes.map(node => node.id));
    expect(currentCanvas.nodes.filter(node => successIds.has(node.id))).toEqual(savedCanvas.nodes.filter(node => successIds.has(node.id)));
    expect(currentCanvas.edges).toEqual(savedCanvas.edges);
    expect(pageErrors).toEqual([]);
    expect(forbidden).toEqual([]);
    expect(generationCounters.generationPosts).toBe(2);
    report.generationPosts = generationCounters.generationPosts;
    console.log(`[node-recovery-guide-smoke-pass] ${JSON.stringify(report)}`);
  } catch (error) {
    console.error('[node-recovery-guide-smoke-failed]', JSON.stringify({ report,
      pageText: (await page.locator('body').innerText()).slice(0, 12000),
      frames: await Promise.all(page.frames().map(async frame => ({ url: frame.url(), text: (await frame.locator('body').innerText()).slice(0, 12000) }))),
      status: nodeRecoveryStatusPayload(),
    }));
    throw error;
  } finally {
    await context.close();
    await browser.close();
    generationTasks.clear();
    for (const [key, task] of savedTasks) generationTasks.set(key, task);
    generationObservations.clear();
    Object.assign(nodeRecoveryChecks, savedChecks);
    Object.assign(nodeRecoveryState, savedState);
    nodeRecoveryRecoveryCases.clear();
    for (const [key, state] of savedRecoveryCases) nodeRecoveryRecoveryCases.set(key, state);
    nodeRecoveryMaintenanceStage = savedMaintenanceStage;
    const currentCanvas = await (await api(`/api/canvas/${generationFixture.canvasId}`)).json();
    await generationDocumentPut({ ...currentCanvas, nodes: savedCanvas.nodes,
      edges: savedCanvas.edges, viewport: savedCanvas.viewport }, 'control');
    Object.assign(generationCounters, savedCounters);
    persistGenerationJournal('guideSmokeReset', { syntheticOnly: true, userAcceptance: 'NOT_RUN' });
  }
}

async function videoQueryWorkflowDatabaseIdentity() {
  return readMediaPublicationDatabase((database) => ({
    taskIds: database.prepare(`
      SELECT id FROM generation_tasks WHERE owner_id = ? AND canvas_id = ?
    `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId).map((row) => row.id),
    runIds: database.prepare(`
      SELECT id FROM workflow_runs WHERE owner_id = ? AND canvas_id = ?
    `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId).map((row) => row.id),
    receiptIds: database.prepare(`
      SELECT operation_id AS operationId FROM canvas_operation_receipts
      WHERE owner_id = ? AND canvas_id = ?
    `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId).map((row) => row.operationId),
  }));
}

function sqlIdList(ids) {
  return ids.map(() => "?").join(",");
}

async function resetVideoQueryWorkflowAfterSmoke(saved) {
  try { videoQueryWorkflowProviderLockDatabase?.exec("ROLLBACK"); } catch {}
  try { videoQueryWorkflowProviderLockDatabase?.close(); } catch {}
  videoQueryWorkflowProviderLockDatabase = undefined;
  if (videoQueryWorkflowProviderLockTimer) {
    clearTimeout(videoQueryWorkflowProviderLockTimer);
    videoQueryWorkflowProviderLockTimer = undefined;
  }
  const cleanup = await readMediaPublicationDatabase((database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const baselineTaskIds = new Set(saved.database.taskIds);
      const baselineRunIds = new Set(saved.database.runIds);
      const baselineReceiptIds = new Set(saved.database.receiptIds);
      const currentTasks = database.prepare(`
        SELECT id, result_asset_id AS resultAssetId FROM generation_tasks
        WHERE owner_id = ? AND canvas_id = ?
      `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId);
      const dynamicTaskRows = currentTasks.filter((row) => !baselineTaskIds.has(row.id));
      const dynamicTaskIds = dynamicTaskRows.map((row) => row.id);
      const dynamicAssetIds = dynamicTaskRows.map((row) => row.resultAssetId).filter(Boolean);
      const currentRuns = database.prepare(`
        SELECT id FROM workflow_runs WHERE owner_id = ? AND canvas_id = ?
      `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId);
      const dynamicRunIds = currentRuns.map((row) => row.id).filter((id) => !baselineRunIds.has(id));
      const continuationWhere = [
        ...dynamicRunIds,
        ...(videoQueryWorkflowHistoricalRunId ? [videoQueryWorkflowHistoricalRunId] : []),
      ];
      if (continuationWhere.length > 0) {
        const placeholders = sqlIdList(continuationWhere);
        database.prepare(`
          DELETE FROM workflow_run_continuations
          WHERE owner_id = ? AND (parent_run_id IN (${placeholders}) OR child_run_id IN (${placeholders}))
        `).run(MEDIA_PUBLICATION_FIXTURE.ownerId, ...continuationWhere, ...continuationWhere);
      }
      if (dynamicRunIds.length > 0) {
        database.prepare(`DELETE FROM workflow_runs WHERE owner_id = ? AND id IN (${sqlIdList(dynamicRunIds)})`)
          .run(MEDIA_PUBLICATION_FIXTURE.ownerId, ...dynamicRunIds);
      }
      if (dynamicTaskIds.length > 0) {
        database.prepare(`DELETE FROM generation_tasks WHERE owner_id = ? AND id IN (${sqlIdList(dynamicTaskIds)})`)
          .run(MEDIA_PUBLICATION_FIXTURE.ownerId, ...dynamicTaskIds);
      }
      if (saved.historyRunId) {
        database.prepare(`
          UPDATE workflow_runs SET state = ?, stop_requested = ?, graph_revision = ?,
            semantic_fingerprint = ?, error_code = ?, error_message = ?, updated_at = ?
          WHERE owner_id = ? AND id = ?
        `).run(
          saved.historyRun.state,
          Number(saved.historyRun.stopRequested ?? 0),
          Number(saved.historyRun.graphRevision),
          saved.historyRun.semanticFingerprint,
          saved.historyRun.errorCode,
          saved.historyRun.errorMessage,
          new Date().toISOString(),
          MEDIA_PUBLICATION_FIXTURE.ownerId,
          saved.historyRunId,
        );
        for (const row of saved.historyRunNodes) {
          database.prepare(`
            UPDATE workflow_run_nodes SET state = ?, task_id = ?, projection_state = ?,
              error_code = ?, error_message = ?, updated_at = ?
            WHERE run_id = ? AND node_id = ?
          `).run(
            row.state,
            row.taskId,
            row.projectionState,
            row.errorCode,
            row.errorMessage,
            new Date().toISOString(),
            saved.historyRunId,
            row.nodeId,
          );
        }
      }
      const currentReceipts = database.prepare(`
        SELECT operation_id AS operationId FROM canvas_operation_receipts
        WHERE owner_id = ? AND canvas_id = ?
      `).all(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId);
      const dynamicReceiptIds = currentReceipts.map((row) => row.operationId).filter((id) => !baselineReceiptIds.has(id));
      if (dynamicReceiptIds.length > 0) {
        database.prepare(`
          DELETE FROM canvas_operation_receipts WHERE owner_id = ? AND canvas_id = ?
            AND operation_id IN (${sqlIdList(dynamicReceiptIds)})
        `).run(MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId, ...dynamicReceiptIds);
      }
      if (dynamicAssetIds.length > 0) {
        database.prepare(`DELETE FROM media_assets WHERE owner_id = ? AND id IN (${sqlIdList(dynamicAssetIds)})`)
          .run(MEDIA_PUBLICATION_FIXTURE.ownerId, ...dynamicAssetIds);
      }
      // Fixture reset is not a user save: the real Canvas save command
      // correctly retains server-owned result fields omitted by a client. Here
      // restore the exact saved temporary document together with its receipts.
      database.prepare(`UPDATE canvas_documents SET nodes = ?, edges = ?, viewport = ?,
        revision = revision + 1, graph_revision = graph_revision + 1, updated_at = ?,
        save_session_id = ?, save_sequence = 1 WHERE owner_id = ? AND id = ?`).run(
        JSON.stringify(saved.canvas.nodes), JSON.stringify(saved.canvas.edges), JSON.stringify(saved.canvas.viewport),
        new Date().toISOString(), `acceptance-reset-${randomUUID()}`, MEDIA_PUBLICATION_FIXTURE.ownerId,
        MEDIA_PUBLICATION_FIXTURE.canvasId);
      database.exec("COMMIT");
      return { dynamicTaskIds, dynamicRunIds, dynamicAssetIds, dynamicReceiptIds };
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  });
  const restoredCanvas = await (await api(`/api/canvas/${generationFixture.canvasId}`)).json();
  for (const id of [videoQueryWorkflowFixtureIds.activeVideoNodeId, videoQueryWorkflowFixtureIds.historyVideoNodeId]) {
    const original = saved.canvas.nodes.find((node) => node.id === id);
    const restored = restoredCanvas.nodes.find((node) => node.id === id);
    if (JSON.stringify(restored?.data) !== JSON.stringify(original?.data)) {
      throw new Error("Acceptance reset retained stale generated video fields");
    }
  }
  await readMediaPublicationDatabase((database) => {
    database.prepare(`
      UPDATE workflow_runs SET graph_revision = ?, updated_at = ?
      WHERE owner_id = ? AND id = ?
    `).run(
      Number(restoredCanvas.graphRevision ?? restoredCanvas.revision),
      new Date().toISOString(),
      MEDIA_PUBLICATION_FIXTURE.ownerId,
      saved.historyRunId,
    );
  });
  for (const assetId of cleanup.dynamicAssetIds) {
    const storageName = `${assetId}.mp4`;
    await unlink(join(dataRoot, "media", storageName)).catch(() => undefined);
  }
  videoQueryWorkflowRunId = saved.activeRunId;
  videoQueryWorkflowHistoricalContinuationRunId = saved.historicalContinuationRunId;
  videoQueryWorkflowHistoricalSyncResult = saved.historicalSyncResult;
  videoQueryWorkflowHistoryResult = saved.historyResult;
  videoQueryWorkflowHistoricalFaultInjected = saved.historicalFaultInjected;
  videoQueryWorkflowHistoricalOriginalTaskId = saved.historicalOriginalTaskId;
  videoQueryWorkflowHistoricalOriginalProviderTaskId = saved.historicalOriginalProviderTaskId;
  videoQueryWorkflowGraphRevision = Number(restoredCanvas.graphRevision ?? restoredCanvas.revision);
  Object.assign(videoQueryWorkflowChecks, saved.checks);
  Object.assign(mediaPublicationProviderStats, {
    posts: saved.providerStats.posts,
    videoPosts: saved.providerStats.videoPosts,
    imagePosts: saved.providerStats.imagePosts,
    unknownPosts: saved.providerStats.unknownPosts,
    gets: saved.providerStats.gets,
    mediaGets: saved.providerStats.mediaGets,
  });
  mediaPublicationProviderStats.postsByModel = { ...saved.providerStats.postsByModel };
  mediaPublicationProviderStats.requests.splice(0, mediaPublicationProviderStats.requests.length, ...saved.providerStats.requests);
  videoQueryWorkflowProviderStatusFailures = saved.providerStatusFailures;
  videoQueryWorkflowProviderPhases = new Map(saved.providerPhases);
  videoQueryWorkflowArkInputVideoSeen = saved.arkInputVideoSeen;
  videoQueryWorkflowProviderProfileLockInjected = saved.providerProfileLockInjected;
  videoQueryWorkflowAcceptedRecoveryDiagnosticCount = saved.acceptedRecoveryDiagnosticCount;
  videoQueryWorkflowDiagnosticStageCounts.clear();
  for (const [stage, count] of saved.diagnosticStageCounts) videoQueryWorkflowDiagnosticStageCounts.set(stage, count);
  videoQueryWorkflowDiagnosticEvents.splice(0, videoQueryWorkflowDiagnosticEvents.length, ...saved.diagnosticEvents);
  videoQueryWorkflowInitialCanvas = saved.initialCanvas;
  return cleanup;
}

let videoQueryWorkflowProductSmokeStarted = false;
async function smokeVideoQueryWorkflowGuide() {
  if (!videoQueryWorkflowScenario || videoQueryWorkflowProductSmokeStarted) return undefined;
  videoQueryWorkflowProductSmokeStarted = true;
  const { chromium, expect } = await import("@playwright/test");
  const before = await videoQueryWorkflowSnapshot();
  const saved = {
    activeRunId: videoQueryWorkflowRunId,
    historicalContinuationRunId: videoQueryWorkflowHistoricalContinuationRunId,
    historicalSyncResult: videoQueryWorkflowHistoricalSyncResult,
    historyResult: videoQueryWorkflowHistoryResult,
    historicalFaultInjected: videoQueryWorkflowHistoricalFaultInjected,
    historicalOriginalTaskId: videoQueryWorkflowHistoricalOriginalTaskId,
    historicalOriginalProviderTaskId: videoQueryWorkflowHistoricalOriginalProviderTaskId,
    checks: { ...videoQueryWorkflowChecks },
    providerStats: {
      posts: mediaPublicationProviderStats.posts,
      videoPosts: mediaPublicationProviderStats.videoPosts,
      imagePosts: mediaPublicationProviderStats.imagePosts,
      unknownPosts: mediaPublicationProviderStats.unknownPosts,
      gets: mediaPublicationProviderStats.gets,
      mediaGets: mediaPublicationProviderStats.mediaGets,
      postsByModel: { ...mediaPublicationProviderStats.postsByModel },
      requests: [...mediaPublicationProviderStats.requests],
    },
    providerStatusFailures: videoQueryWorkflowProviderStatusFailures,
    providerPhases: [...videoQueryWorkflowProviderPhases],
    arkInputVideoSeen: videoQueryWorkflowArkInputVideoSeen,
    providerProfileLockInjected: videoQueryWorkflowProviderProfileLockInjected,
    acceptedRecoveryDiagnosticCount: videoQueryWorkflowAcceptedRecoveryDiagnosticCount,
    diagnosticStageCounts: [...videoQueryWorkflowDiagnosticStageCounts],
    diagnosticEvents: [...videoQueryWorkflowDiagnosticEvents],
    initialCanvas: structuredClone(videoQueryWorkflowInitialCanvas),
    canvas: structuredClone(before.canvas),
    database: await videoQueryWorkflowDatabaseIdentity(),
    historyRunId: videoQueryWorkflowHistoricalRunId,
    historyRun: before.historyRun ? {
      state: before.historyRun.state,
      stopRequested: before.historyRun.stopRequested ?? 0,
      graphRevision: before.historyRun.graphRevision,
      semanticFingerprint: before.historyRun.semanticFingerprint,
      errorCode: before.historyRun.errorCode,
      errorMessage: before.historyRun.errorMessage,
    } : null,
    historyRunNodes: before.historyRunNodes.map((row) => ({ ...row })),
  };
  let browser;
  let context;
  let page;
  const forbidden = [];
  const pageErrors = [];
  let smokeStage = "launch";
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: "block" });
    context.on("request", (request) => {
      if (request.method() !== "POST" || !/\/api\/canvases\/[^/]+\/commands$/.test(new URL(request.url()).pathname)) return;
      try {
        const command = request.postDataJSON();
        console.log("[video-query-canvas-command]", JSON.stringify({
          kind: command.kind, changes: command.changes, topologyOperation: command.topologyOperation,
        }));
      } catch { /* Diagnostic observation never changes the request. */ }
    });
    await context.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin === origin || ["data:", "blob:"].includes(requestUrl.protocol)) return route.continue();
      forbidden.push(requestUrl.origin);
      return route.abort("blockedbyclient");
    });
    page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const frame = page.frameLocator("#canvas");
    smokeStage = "goto";
    await page.goto(`${origin}/__acceptance`);
    await expect(page.getByRole("heading", { name: "视频查询恢复验收", exact: true })).toBeVisible();
    await expect(frame.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true", { timeout: 30_000 });
    smokeStage = "start";
    const startButton = page.getByRole("button", { name: "开始自动恢复", exact: true });
    await expect(startButton).toBeEnabled();
    await startButton.click();
    smokeStage = "refresh-during-recovery";
    await expect.poll(async () => (await videoQueryWorkflowSnapshot()).video.task?.state,
      { timeout: 30_000 }).toBe("recovering");
    const recoveringIdentity = (await videoQueryWorkflowSnapshot()).video.task;
    const refreshButton = page.getByRole("button", { name: "刷新并检查恢复结果", exact: true });
    await expect(refreshButton).toBeEnabled({ timeout: 10_000 });
    await refreshButton.click();
    await expect(page.locator("#status-refresh")).toContainText("刷新后结果仍在原节点", { timeout: 90_000 });
    await expect(refreshButton).toHaveText("刷新并检查恢复结果", { timeout: 30_000 });
    await expect(frame.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
    smokeStage = "active-result";
    await expect(page.locator("#status-start")).toContainText("视频和尾文字已自动完成", { timeout: 90_000 });
    await expect(frame.locator(`.react-flow__node[data-id="${videoQueryWorkflowFixtureIds.activeVideoNodeId}"]`)).toBeInViewport({ ratio: 0.5, timeout: 20_000 });
    await expect(frame.locator(`.react-flow__node[data-id="${videoQueryWorkflowFixtureIds.activeVideoNodeId}"]`)).toContainText("临时中断自动视频");
    const active = await videoQueryWorkflowSnapshot();
    expect(active.run?.state).toBe("success");
    expect(active.video.task?.state).toBe("success");
    expect(active.video.task?.attempt).toBe(1);
    expect(active.video.task?.id).toBe(recoveringIdentity.id);
    expect(active.video.task?.providerTaskId).toBe(recoveringIdentity.providerTaskId);
    expect(active.tailText.task?.state).toBe("success");
    expect(active.video.node?.videoSrc).toEqual(expect.any(String));
    const activePlayer = frame.locator(`.react-flow__node[data-id="${videoQueryWorkflowFixtureIds.activeVideoNodeId}"] video`);
    await expect(activePlayer).toBeVisible();
    await expect.poll(() => activePlayer.evaluate((video) => video.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    expect(active.tailText.node?.content).toContain("视频查询尾部文字");
    expect(videoQueryWorkflowProviderProfileLockInjected).toBe(true);
    const activeRecoveryEvents = (active.video.events ?? []).filter((event) =>
      event.state === "recovering" || event.errorCode === "AUTOMATIC_RESULT_RECOVERY",
    );
    expect(activeRecoveryEvents.length).toBeGreaterThan(0);
    expect(videoQueryWorkflowAcceptedRecoveryDiagnosticCount).toBeGreaterThan(0);
    const activeLockDiagnostic = videoQueryWorkflowDiagnosticEvents.find((event) =>
      event.taskId === active.video.task.id && event.stage === "accepted-video-query-recovery" &&
      event.errorName === "ProviderProfileLockBusyError" && event.sourceErrorCode === "PROVIDER_LOCK_BUSY" &&
      event.causeCode === "SQLITE_LOCK_CONTENTION");
    expect(activeLockDiagnostic).toBeTruthy();
    const activeVideoPosts = mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/media/generate" && request.phase === "active" && request.capability === "video");
    const activeTextResponses = mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/responses" && request.phase === "active");
    expect(activeVideoPosts).toHaveLength(1);
    expect(activeTextResponses).toHaveLength(1);
    smokeStage = "history-sync";
    const syncButton = page.getByRole("button", { name: "找回原视频", exact: true });
    await expect(syncButton).toBeEnabled({ timeout: 20_000 });
    await syncButton.click();
    await expect(page.locator("#status-history")).toContainText("原视频已找回", { timeout: 20_000 });
    await expect(frame.locator(`.react-flow__node[data-id="${videoQueryWorkflowFixtureIds.historyVideoNodeId}"]`)).toBeInViewport({ ratio: 0.5, timeout: 20_000 });
    await expect(syncButton).toHaveText("找回原视频", { timeout: 30_000 });
    await expect(frame.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
    smokeStage = "history-continue";
    const continueButton = page.getByRole("button", { name: "继续剩余节点", exact: true });
    await expect(continueButton).toBeEnabled({ timeout: 20_000 });
    await continueButton.click();
    await expect(page.locator("#status-history")).toContainText("只生成了尾部文字", { timeout: 90_000 });
    await expect(frame.locator(`.react-flow__node[data-id="${videoQueryWorkflowFixtureIds.historyTailTextNodeId}"]`)).toBeInViewport({ ratio: 0.5, timeout: 20_000 });
    await expect(continueButton).toHaveText("继续剩余节点", { timeout: 30_000 });
    await expect(frame.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true");
    await expect(frame.locator(`.react-flow__node[data-id="${videoQueryWorkflowFixtureIds.historyTailTextNodeId}"]`)).toContainText("视频查询尾部文字已自动完成");
    const completed = await videoQueryWorkflowSnapshot();
    const historyVideoPosts = mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/media/generate" && request.phase === "history" && request.capability === "video");
    const historyTextResponses = mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/responses" && request.phase === "history");
    expect(historyVideoPosts).toHaveLength(1);
    expect(historyTextResponses).toHaveLength(1);
    expect(videoQueryWorkflowArkInputVideoSeen).toBe(true);
    expect(completed.historyVideo.task?.id).toBe(saved.historicalOriginalTaskId);
    expect(completed.historyVideo.task?.attempt).toBe(1);
    expect(completed.historyRun?.state).toBe("failed");
    expect(completed.child?.selectedNodeIds).toEqual([videoQueryWorkflowFixtureIds.historyTailTextNodeId]);
    expect(completed.historyTailText.task?.state).toBe("success");
    expect(completed.historyTailText.node?.content).toContain("视频查询尾部文字");
    expect(completed.historicalAdoptionCount).toBe(0);
    expect(mediaPublicationPreservedFingerprint(completed.canvas)).toBe(
      mediaPublicationPreservedFingerprint(saved.initialCanvas),
    );
    expect(pageErrors).toEqual([]);
    expect(forbidden).toEqual([]);
    const screenshotPath = join(testRoot, "video-query-workflow-product-smoke.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const report = {
      status: "TECHNICAL_PASS",
      syntheticOnly: true,
      browser: "isolated-headless",
      actualProductButtons: true,
      iframeTested: true,
      active: {
        providerVideoPosts: activeVideoPosts.length,
        tailTextProviderPosts: activeTextResponses.length,
        queryInterruptions: videoQueryWorkflowProviderStatusFailures,
        profileLockInjected: videoQueryWorkflowProviderProfileLockInjected,
        profileLockBusyObserved: Boolean(activeLockDiagnostic),
        lockDiagnostic: activeLockDiagnostic,
        acceptedVideoQueryRecoveryDiagnosticCount: videoQueryWorkflowAcceptedRecoveryDiagnosticCount,
        taskEventEvidence: active.video.events,
        runState: completed.run?.state,
        videoTaskId: completed.video.task?.id,
        videoAttempt: completed.video.task?.attempt,
        videoProviderTaskId: completed.video.task?.providerTaskId,
        videoState: completed.video.task?.state,
        tailTaskId: completed.tailText.task?.id,
        tailAttempt: completed.tailText.task?.attempt,
        tailState: completed.tailText.task?.state,
        videoVisible: Boolean(completed.video.node?.videoSrc),
        tailVisible: Boolean(completed.tailText.node?.content),
      },
      history: {
        originalTaskId: completed.historyVideo.task?.id,
        originalAttempt: completed.historyVideo.task?.attempt,
        originalProviderTaskId: completed.historyVideo.task?.providerTaskId,
        parentState: completed.historyRun?.state,
        syncStatus: videoQueryWorkflowHistoricalSyncResult?.status,
        continuationChildRunId: completed.child?.childRunId,
        selectedNodeIds: completed.child?.selectedNodeIds,
        providerVideoPosts: historyVideoPosts.length,
        tailTextResponses: historyTextResponses.length,
        arkInputVideoSeen: videoQueryWorkflowArkInputVideoSeen,
        generationResultAdoptions: completed.historicalAdoptionCount,
      },
      preservedBaselineUnchanged: mediaPublicationPreservedFingerprint(completed.canvas) === mediaPublicationPreservedFingerprint(saved.initialCanvas),
      pageErrors,
      forbidden,
      screenshotPath,
      resetForUser: true,
    };
    // A second real admitted request validates the bounded-recovery UI. Only
    // the deadline command receives a test clock; Provider identity/timestamps
    // and the worker/client remain real and unchanged.
    smokeStage = "expiry-reset";
    await page.goto("about:blank");
    await resetVideoQueryWorkflowAfterSmoke(saved);
    await page.goto(`${origin}/__acceptance`);
    await expect(frame.getByTestId("canvas-world")).toHaveAttribute("data-persistence-ready", "true", { timeout: 30_000 });
    await page.getByRole("button", { name: "开始自动恢复", exact: true }).click();
    await expect.poll(async () => (await videoQueryWorkflowSnapshot()).video.task?.state,
      { timeout: 30_000 }).toBe("recovering");
    smokeStage = "expiry-durable-marker";
    const beforeExpiry = await videoQueryWorkflowSnapshot();
    const recoveryQueries = await loadAcceptanceSourceModule(ssrModuleUrl(join(sourceRoot, "server/generationRecoveryTaskQueries.ts")));
    const window = await readMediaPublicationDatabase((database) =>
      recoveryQueries.originalRecoveryWindow(database, beforeExpiry.video.task.id));
    expect(window?.automaticDeadlineAt).toEqual(expect.any(String));
    const expiryStore = mediaPublicationProductModules.generationTaskStore.createGenerationTaskStore(dataRoot, { recoverRunning: false });
    try {
      const expired = expiryStore.markRecoveryWindowExhaustedIfDue(beforeExpiry.video.task.id,
        new Date(Date.parse(window.automaticDeadlineAt) + 1));
      expect(expired?.state).toBe("recovering");
      expect(expired?.errorCode).toBe("AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED");
    } finally { expiryStore.close(); }
    const expiryGets = mediaPublicationProviderStats.gets;
    const expiryNode = frame.locator(`.react-flow__node[data-id="${videoQueryWorkflowFixtureIds.activeVideoNodeId}"]`);
    await expect(expiryNode.locator(".provider-error-notice")).toContainText("原请求记录已保留", { timeout: 20_000 });
    await expect(expiryNode.locator(".video-node-generating")).toHaveCount(0);
    await expect(expiryNode).not.toContainText("维护人员已跟进");
    await expect(expiryNode.getByRole("button", { name: /重试|重新检查/ })).toHaveCount(0);
    await page.getByRole("button", { name: "刷新并检查恢复结果", exact: true }).click();
    await expect(expiryNode.locator(".provider-error-notice")).toContainText("不会重复付费提交", { timeout: 20_000 });
    // Include at least one actual 30-second automatic sweep after expiry.
    await acceptanceDelay(35_000);
    await expect(expiryNode.locator(".video-node-generating")).toHaveCount(0);
    await expect(expiryNode).not.toContainText("视频暂时无法显示");
    await expect(expiryNode.getByRole("button", { name: /重新加载|重新上传/ })).toHaveCount(0);
    expect(mediaPublicationProviderStats.gets).toBe(expiryGets);
    const afterExpiry = await videoQueryWorkflowSnapshot();
    expect(afterExpiry.video.task.id).toBe(beforeExpiry.video.task.id);
    expect(afterExpiry.video.task.attempt).toBe(1);
    expect(afterExpiry.video.task.providerTaskId).toBe(beforeExpiry.video.task.providerTaskId);
    expect(afterExpiry.video.task.state).toBe("recovering");
    expect(afterExpiry.run.state).toBe("running");
    expect(afterExpiry.tailText.task).toBeNull();
    const lockCount = await readMediaPublicationDatabase((database) => database.prepare(
      "SELECT COUNT(*) AS count FROM workflow_run_locks WHERE run_id = ?").get(afterExpiry.run.id).count);
    expect(Number(lockCount)).toBeGreaterThan(0);
    const expiryPosts = mediaPublicationProviderStats.requests.filter((request) =>
      request.path === "/v1/media/generate" && request.phase === "active").length;
    expect(expiryPosts).toBe(1);
    expect(mediaPublicationPreservedFingerprint(afterExpiry.canvas)).toBe(mediaPublicationPreservedFingerprint(saved.initialCanvas));
    const expiryScreenshot = join(testRoot, "video-query-workflow-expiry-smoke.png");
    await page.screenshot({ path: expiryScreenshot, fullPage: true });
    expect(pageErrors).toEqual([]);
    expect(forbidden).toEqual([]);
    report.expiryUi = {
      testClockOnly: true, taskId: afterExpiry.video.task.id, attempt: afterExpiry.video.task.attempt,
      providerTaskId: afterExpiry.video.task.providerTaskId, state: afterExpiry.video.task.state,
      errorCode: afterExpiry.video.task.errorCode, videoPosts: expiryPosts, additionalGets: 0,
      refreshPreserved: true, spinnerStopped: true, honestWaitingNotice: true,
      runLocksPreserved: true, sweepObservedMs: 35_000, screenshotPath: expiryScreenshot,
    };
    writeFileSync(join(testRoot, "video-query-workflow-product-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[video-query-workflow-product-smoke-pass] ${JSON.stringify(report)}`);
    return report;
  } catch (error) {
    console.error("[video-query-workflow-product-smoke-failed]", JSON.stringify({
      stage: smokeStage,
      message: String(error),
      pageErrors,
      forbidden,
      snapshot: await videoQueryWorkflowSnapshot().catch(() => null),
      body: page ? await page.locator("body").innerText().catch(() => "") : "",
    }));
    throw error;
  } finally {
    try { await context?.close(); } finally { await browser?.close(); }
    await resetVideoQueryWorkflowAfterSmoke(saved);
  }
}

const guide = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剩余修复 · 本地验收</title>
<style>body{margin:0;background:#f5f5f5;color:#242424;font:16px/1.65 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:900px;margin:40px auto;padding:0 24px}h1{font-size:30px;margin:8px 0}h2{font-size:19px}p{color:#565656}section{background:white;border:1px solid #ddd;border-radius:14px;padding:22px;margin:18px 0}button,a.primary{font:inherit;display:inline-block;border:1px solid #aaa;border-radius:8px;padding:9px 16px;background:white;color:#222;cursor:pointer;text-decoration:none}a.primary{background:#222;color:#fff;border-color:#222}.badge{font-size:13px;letter-spacing:1px}li{margin:10px 0}table{width:100%;border-collapse:collapse;text-align:left}td,th{padding:10px;border-bottom:1px solid #eee;overflow-wrap:anywhere}.tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}#result{overflow:auto}small{color:#777}button:focus-visible,a:focus-visible{outline:3px solid #555;outline-offset:3px}</style>
<main><span class="badge">本地验收 · 独立测试数据</span><h1>只需复验图片菜单遮挡</h1><p>你已确认其他项目通过。这次只检查图片顶部「浏览全部」菜单是否完整显示、能够点击。这里使用独立测试数据，修复尚未上线。</p>
<section><h2>本次检查这一个问题</h2><ol><li>打开测试画布，点击分组内的「图片裁剪与连线」，让顶部工具栏和下方输入框都出现。</li><li>点击顶部三点按钮「浏览全部」。检查菜单底部的「角色可信素材」「角色风险预检」「快速切分」：应显示在输入框上方，不能被盖住。</li><li>点击最下面可用的「快速切分」，应打开切分窗口；按 Esc 或窗口里的取消退出。再打开「浏览全部」，点击「调整像素」检查能打开并取消。</li><li>缩放、平移画布后再打开菜单。菜单项仍能看见和点击，取消后原图、节点位置和输入框保持正常。</li></ol><a id="canvas-link" class="primary" target="_blank" rel="noopener">打开测试画布</a><p><small>灰色项目表示功能当前不可用，仍应完整可见；本次不用提交生成、切分结果或修改图片。检查通过后，在对话里回复「菜单遮挡通过」。</small></p></section>
<details><summary>已通过项目和演示开关（无需重做）</summary><section><p>第1～5组，包括中文名称、模板筛选/保存、拖线菜单与稳定性、裁剪/工具、更新后文字保留、历史图片与速度，均已按你的确认记录通过。每日自动备份及视频、音频空按钮仍暂缓。</p><a class="primary" href="/canvas/projects" target="_blank" rel="noopener">打开工作空间</a> <a class="primary" href="/admin/templates" target="_blank" rel="noopener">打开模板管理</a><div class="tools"><button id="tools">切换图片工具状态</button><span id="tools-mode" role="status"></span></div><div class="tools"><button id="slow" aria-pressed="false">开启慢速演示</button><span id="mode" role="status">正常速度</span></div><button id="maintenance">模拟维护恢复</button><span id="maintenance-mode" role="status"></span></section><section><h2>模板保存核对（已通过，留作参考）</h2><button id="check">核对已保存内容</button><div id="result" role="status">点击按钮查看。</div></section></details><p id="expiry"></p><p><button id="finish">结束本次验收并清理测试数据</button></p></main>
<script>const slowButton=document.getElementById('slow'), mode=document.getElementById('mode');async function status(){const r=await fetch('/__acceptance/status');if(!r.ok)throw Error('验收服务已停止');const d=await r.json();slowButton.textContent=d.slow?'关闭慢速演示':'开启慢速演示';slowButton.setAttribute('aria-pressed',String(d.slow));mode.textContent=d.slow?'慢速演示已开启':'正常速度';document.getElementById('expiry').textContent='本次临时页面开放至 '+new Date(d.expiresAt).toLocaleTimeString('zh-CN')+'。到时自动关闭。';}slowButton.onclick=async()=>{slowButton.disabled=true;try{const r=await fetch('/__acceptance/toggle-slow',{method:'POST'});if(!r.ok)throw Error('切换失败');await status();}catch(e){mode.textContent=e.message;}finally{slowButton.disabled=false;}};document.getElementById('check').onclick=async()=>{const box=document.getElementById('result');box.textContent='正在读取…';try{const r=await fetch('/__acceptance/results');if(!r.ok)throw Error('读取失败');const d=await r.json();const table=document.createElement('table'),head=table.insertRow();['原模板','当前名称','当前说明','图内容'].forEach(t=>{const th=document.createElement('th');th.textContent=t;head.append(th);});d.items.forEach(item=>{const row=table.insertRow();[item.label,item.title??'模板未找到',item.description??'',item.graphUnchanged?'与初始相同，已保留':'与初始不同，请核对'].forEach(t=>row.insertCell().textContent=t);});box.replaceChildren(table);}catch(e){box.textContent=e.message;}};status().catch(e=>mode.textContent=e.message);</script><script>async function refreshScenarios(){const d=await(await fetch('/__acceptance/status')).json();document.getElementById('canvas-link').href=d.projects[1].url;document.getElementById('tools-mode').textContent=d.toolsAvailable?'可用入口演示（生成未开放）':'不可用演示';}async function toggleScenario(path,box,onSuccess){try{const r=await fetch(path,{method:'POST'});if(!r.ok)throw Error('切换失败，验收服务可能已停止');await onSuccess();}catch(e){document.getElementById(box).textContent=e.message;}}document.getElementById('tools').onclick=()=>toggleScenario('/__acceptance/toggle-tools','tools-mode',refreshScenarios);document.getElementById('maintenance').onclick=()=>toggleScenario('/__acceptance/toggle-maintenance','maintenance-mode',async()=>{document.getElementById('maintenance-mode').textContent='模拟维护中。请回到画布等待，开始后约35～65秒出现更新提示。';});refreshScenarios().catch(e=>document.getElementById('tools-mode').textContent=e.message);document.getElementById('finish').onclick=async()=>{const r=await fetch('/__acceptance/stop',{method:'POST'});if(r.ok)document.body.textContent='本次验收已结束。你可以关闭这些验收标签页；再次双击启动文件会准备一份新的测试数据。';};</script></html>`;

// A second restrictive policy also fences the user's unsandboxed browser.
const browserPolicy = `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src ${nodeRecoveryScenario || mediaPublicationScenario || videoQueryWorkflowScenario ? "'self'" : "'none'"}; object-src 'none'; base-uri 'self'; form-action 'self'`;
const plugin = {
  name: "isolated-template-manual-acceptance",
  enforce: "pre",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const originalSetHeader = res.setHeader.bind(res);
      res.setHeader = (name, value) => {
        const header = name.toLowerCase();
        if ((nodeRecoveryScenario || mediaPublicationScenario || videoQueryWorkflowScenario) && header === "x-frame-options") {
          return originalSetHeader(name, "SAMEORIGIN");
        }
        if (header === "content-security-policy") {
          const policies = (Array.isArray(value) ? value : [value]).map(policy =>
            (nodeRecoveryScenario || mediaPublicationScenario || videoQueryWorkflowScenario)
              ? String(policy).replace(/frame-ancestors\s+[^;]+/g, "frame-ancestors 'self'")
              : policy);
          return originalSetHeader(name, [...policies, browserPolicy]);
        }
        return originalSetHeader(name, value);
      };
      originalSetHeader("Content-Security-Policy", browserPolicy);
      if (nodeRecoveryScenario || mediaPublicationScenario || videoQueryWorkflowScenario) originalSetHeader("X-Frame-Options", "SAMEORIGIN");
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
      const nodeRecoveryRetryMatch = nodeRecoveryScenario && !nodeRecoveryProductMode && method === "POST" && url.pathname === "/api/generation-tasks";
      const nodeRecoveryPreflight = nodeRecoveryScenario && !nodeRecoveryProductMode && method === "POST" && url.pathname === "/api/generation-tasks/preflight";
      const nodeRecoveryRecoveryReadMatch = nodeRecoveryScenario && !nodeRecoveryProductMode && method === "POST" &&
        /^\/api\/generation-recovery\/[^/]+\/read$/.test(url.pathname);
      const nodeRecoveryProductWrite = nodeRecoveryProductMode && method === "POST" && (
        url.pathname === "/api/generation-tasks" || url.pathname === "/api/generation-tasks/preflight" ||
        /^\/api\/generation-recovery\/[^/]+\/read$/.test(url.pathname)
      );
      const nodeRecoveryProductControl = nodeRecoveryProductMode && method === "POST" &&
        /^\/__acceptance\/node-recovery\/(?:original|maintenance|retry|focus|product-smoke)$/.test(url.pathname);
      const mediaPublicationControl = mediaPublicationScenario && method === "POST" &&
        /^\/__acceptance\/media-publication\/(?:start)$/.test(url.pathname);
      const videoQueryWorkflowControl = videoQueryWorkflowProductMode && method === "POST" &&
        /^\/__acceptance\/video-query-workflow\/(?:start|refresh|history-sync|history-continue)$/.test(url.pathname);
      const localEdit = templatePath ||
        (url.pathname === "/api/projects" && method === "POST") ||
        (/^\/api\/projects\/[a-z0-9._-]+(?:\/clone)?$/i.test(url.pathname) && ["POST", "DELETE"].includes(method)) ||
        (/^\/api\/(?:project-title|canvas)\/[a-z0-9._-]+$/i.test(url.pathname) && ["PUT", "DELETE"].includes(method)) ||
        (/^\/api\/canvases\/[a-z0-9._-]+\/commands$/i.test(url.pathname) && method === "POST") ||
        (/^\/api\/assets\/[a-z0-9._-]+$/i.test(url.pathname) && ["POST", "DELETE"].includes(method)) ||
        (/^\/api\/history\/[a-z0-9._-]+$/i.test(url.pathname) && method === "POST") ||
        (url.pathname === "/__acceptance/stop" && method === "POST") ||
        (/^\/__acceptance\/toggle-(?:slow|tools|maintenance)$/.test(url.pathname) && method === "POST") ||
        (generationScenario && /^\/__acceptance\/generation\/(?:activate|plan|restore|complete|delay|check)$/.test(url.pathname) && method === "POST") ||
        (nodeRecoveryScenario && !nodeRecoveryProductMode && /^\/__acceptance\/node-recovery\/(?:start|retry-mode|mark-unknown|focus|recovery-stage)$/.test(url.pathname) && method === "POST") ||
        Boolean(nodeRecoveryRetryMatch || nodeRecoveryPreflight || nodeRecoveryRecoveryReadMatch || nodeRecoveryProductControl || nodeRecoveryProductWrite || mediaPublicationControl || videoQueryWorkflowControl);
      if (!setup && generationScenario && method === "PUT" && /^\/api\/canvas\/[a-z0-9._-]+$/i.test(url.pathname)) {
        generationCounters.browserCanvasWrites += 1;
        persistGenerationJournal("browserCanvasWrite", { path: url.pathname, source: generationLastWriteSource });
      }
      if (!setup && generationScenario && ["POST", "DELETE"].includes(method) && /^\/api\/generation-tasks(?:\/|$)/.test(url.pathname) &&
          !nodeRecoveryRetryMatch && !nodeRecoveryPreflight && !nodeRecoveryProductWrite) {
        generationCounters.generationPosts += method === "POST" ? 1 : 0;
        generationCounters.generationDeletes += method === "DELETE" ? 1 : 0;
        persistGenerationJournal("generationMutationAttemptRejected", { method, path: url.pathname });
      }
      if (!setup && nodeRecoveryProductMode && method === "POST" && url.pathname === "/api/generation-tasks") {
        generationCounters.generationPosts += 1;
        persistGenerationJournal("productBrowserGenerationSubmission", { method, path: url.pathname });
      }
      if (!setup && generationScenario && method === "POST" && /^\/api\/canvases\/[a-z0-9._-]+\/commands$/i.test(url.pathname)) {
        generationCounters.browserCanvasCommandWrites += 1;
        persistGenerationJournal("browserCanvasCommandWrite", { path: url.pathname, source: generationLastWriteSource });

      }
      if (!setup && !["GET", "HEAD"].includes(method) && !localEdit) {
        json(res, 403, { error: "本地验收只开放测试数据编辑，生成与外部操作未开放" }); return;
      }
      if (!setup && nodeRecoveryPreflight) {
        void readRequestJson(req).then(async body => {
          const canvas = await (await api(`/api/canvas/${generationFixture.canvasId}`)).json();
          const canvasRevision = canvas.graphRevision ?? canvas.revision;
          const allowed = body.canvasId === generationFixture.canvasId && body.nodeId === nodeRecoveryFixture.retry.id && body.kind === 'video' && body.canvasRevision === canvasRevision;
          json(res, 200, { canvasRevision, canSubmit: allowed, canEnqueue: allowed, problems: allowed ? [] : [{ code: 'FIXTURE_ONLY', message: '只开放当前画布版本的本地失败视频案例' }] });
        }).catch(() => json(res, 400, { error: '预检请求无效' }));
        return;
      }
      if (!setup && nodeRecoveryRetryMatch) {
        const taskId = nodeRecoveryFixture.retry.id;
        generationCounters.generationPosts += 1;
        persistGenerationJournal("nodeRecoveryRetryPost", { taskId, path: url.pathname, providerRequests: 0 });
        void readRequestJson(req).then((body) => json(res, 200, nodeRecoveryRetryRequest(body))).catch((error) => {
          if (error instanceof AcceptanceControlError) {
            json(res, error.status, { error: error.message, code: error.code });
            return;
          }
          console.error(error);
          json(res, 500, { error: "本地验收补跑请求无法解析", code: "NODE_RECOVERY_RETRY_REQUEST_INVALID" });
        });
        return;
      }
      if (!setup && !mediaPublicationProductMode && url.pathname === "/api/updates" && method === "GET") {
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
      if (!setup && generationScenario && !nodeRecoveryProductMode && !mediaPublicationProductMode && !videoQueryWorkflowProductMode && method === "GET" && url.pathname === `/api/canvas/${generationFixture?.canvasId}`) {
        void api(url.pathname).then((response) => response.json()).then((document) => {
          const seen = new Set();
          const nodes = document.nodes.map((node) => {
            const task = [...generationTasks.values()].reverse().find((candidate) => candidate.nodeId === node.id);
            if (!task) return node;
            if (seen.has(task.id) || node.type !== task.kind || task.canvasId !== generationFixture.canvasId) throw new Error("Synthetic canvas identity mismatch");
            if (nodeRecoveryScenario && nodeRecoveryFixture?.successNodes.some((definition) =>
              definition.id === node.id &&
              (node.position?.x !== definition.position.x || node.position?.y !== definition.position.y))) {
              throw new Error("Node recovery changed a preserved success node position");
            }
            seen.add(task.id);
            return { ...node, data: { ...node.data,
              ...generationNodeData(task.kind, "shared", task, task.identity, task.state === "running" || (task.state === "success" && !task.projectionPersisted)),
              ...(task.state === "success" && task.projectionPersisted ? generationTaskResult(task) : {}),
              ...(task.state === "failed" ? generationTaskFailure(task) : {}),
            } };
          });
          if (seen.size !== new Set([...generationTasks.values()].map(task => task.nodeId)).size) throw new Error("Synthetic canvas lost a task node");
          if (nodeRecoveryScenario) {
            const actualEdges = (document.edges ?? []).map((edge) => `${edge.id}:${edge.source}:${edge.target}`).sort();
            const expectedEdges = nodeRecoveryFixture.preservedEdges
              .map((edge) => `${edge.id}:${edge.source}:${edge.target}`).sort();
            if (actualEdges.join("\n") !== expectedEdges.join("\n")) {
              throw new Error("Node recovery changed a preserved success edge");
            }
          }
          json(res, 200, { ...document, nodes });
        }).catch((error) => { console.error(error); if (!res.headersSent) json(res, 500, { error: "synthetic canvas read failed" }); });
        return;
      }
      if (!setup && generationScenario && !nodeRecoveryProductMode && !mediaPublicationProductMode && !videoQueryWorkflowProductMode && url.pathname === "/api/models" && method === "GET") {
        json(res, 200, generationFixture?.modelCatalog ?? { generationEnabled: false, models: [] }); return;
      }
      if (!setup && generationScenario && !nodeRecoveryProductMode && !mediaPublicationProductMode && !videoQueryWorkflowProductMode && url.pathname === "/api/generation-tasks/status" && method === "GET") {
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
      if (!setup && generationScenario && !nodeRecoveryProductMode && !mediaPublicationProductMode && !videoQueryWorkflowProductMode && url.pathname === "/api/generation-tasks" && method === "GET") {
        json(res, 200, { tasks: [...generationTasks.values()].map(generationTaskPublic) }); return;
      }
      if (!setup && nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === "/api/generation-recovery" && method === "GET") {
        const keys = [...url.searchParams.keys()];
        if (keys.some((key) => key !== "taskIds")) {
          json(res, 400, { error: "处理操作参数无效。", code: "RECOVERY_INVALID_COMMAND" }); return;
        }
        const rawTaskIds = url.searchParams.get("taskIds");
        const taskIds = rawTaskIds === null || rawTaskIds.trim() === ""
          ? undefined
          : [...new Set(rawTaskIds.split(",").filter(Boolean))];
        if (taskIds && (taskIds.length > 50 || taskIds.some((id) => !/^[A-Za-z0-9._-]{1,120}$/.test(id)))) {
          json(res, 400, { error: "处理操作参数无效。", code: "RECOVERY_INVALID_COMMAND" }); return;
        }
        json(res, 200, nodeRecoveryRecoveryBatch(taskIds)); return;
      }
      if (!setup && nodeRecoveryScenario && !nodeRecoveryProductMode && /^\/api\/generation-recovery\/[^/]+(?:\/read)?$/.test(url.pathname) &&
          url.pathname !== "/api/generation-recovery" && url.searchParams.size === 0) {
        const parts = url.pathname.split("/");
        const taskId = decodeURIComponent(parts[parts.length - (parts.at(-1) === "read" ? 2 : 1)]);
        if (method === "GET" && parts.at(-1) !== "read") {
          json(res, 200, nodeRecoveryRecoveryDetail(taskId)); return;
        }
        if (method === "POST" && parts.at(-1) === "read") {
          void readRequestJson(req).then((body) => json(res, 200, acknowledgeNodeRecoveryRecovery(taskId, body))).catch((error) => {
            if (error instanceof AcceptanceControlError) {
              json(res, error.status, { error: error.message, code: error.code }); return;
            }
            json(res, 400, { error: "处理操作参数无效。", code: "RECOVERY_INVALID_COMMAND" });
          });
          return;
        }
      }
      if (!setup && nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === '/api/generation-tasks/by-idempotency' && method === 'GET') {
        const task = [...generationTasks.values()].find(task => task.idempotencyKey === url.searchParams.get('idempotencyKey'));
        if (task) json(res, 200, generationTaskPublic(task));
        else json(res, 404, { error: 'synthetic task not found', code: 'TASK_NOT_FOUND' });
        return;
      }
      if (!setup && generationScenario && !nodeRecoveryProductMode && !mediaPublicationProductMode && !videoQueryWorkflowProductMode && /^\/api\/generation-tasks\/[^/]+$/.test(url.pathname) && method === "GET") {
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
        if ((nodeRecoveryScenario || videoQueryWorkflowScenario) ? variant !== "candidate" : !["candidate", "baseline"].includes(variant)) { json(res, 400, { error: "未知 client variant" }); return; }
        const cookie = `unboundry_generation_client=${variant}; Path=/; SameSite=Lax`;
        res.writeHead(302, { Location: `/canvas/${generationFixture?.canvasId ?? ""}`, "Set-Cookie": [adminCookie, cookie], "Cache-Control": "no-store" });
        res.end(); return;
      }
      if (generationScenario && method === "GET") {
        const staticPath = generationStaticPath(url.pathname);
        const canvasEntry = /^\/canvas(?:\/[^/]+)?$/.test(url.pathname) || url.pathname === "/canvas/projects";
        const cookieMatch = /(?:^|;\s*)unboundry_generation_client=(candidate|baseline)/.exec(String(req.headers.cookie ?? ""));
        const entryPath = canvasEntry && cookieMatch && generationBuilds?.[cookieMatch[1]]
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
          if (nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/status" && method === "GET") {
            json(res, 200, await nodeRecoveryProductStatusPayload()); return;
          }
          if (nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/product-smoke" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, await smokeNodeRecoveryProductGuide({ order: body.order ?? "user" })); return;
          }
          if (nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/original" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, await runNodeRecoveryProductOriginal()); return;
          }
          if (nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/maintenance" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, await runNodeRecoveryProductMaintenance()); return;
          }
          if (nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/retry" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, await runNodeRecoveryProductRetry()); return;
          }
          if (nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/focus" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, await focusNodeRecoveryProduct(body.nodeId)); return;
          }
          if (mediaPublicationScenario && url.pathname === "/__acceptance/media-publication/status" && method === "GET") {
            json(res, 200, await mediaPublicationStatusPayload()); return;
          }
          if (mediaPublicationScenario && url.pathname === "/__acceptance/media-publication/start" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, await startMediaPublicationAction(body.action)); return;
          }
          if (videoQueryWorkflowScenario && url.pathname === "/__acceptance/video-query-workflow/status" && method === "GET") {
            json(res, 200, await videoQueryWorkflowStatusPayload()); return;
          }
          if (videoQueryWorkflowScenario && url.pathname === "/__acceptance/video-query-workflow/start" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, await runVideoQueryWorkflowStart()); return;
          }
          if (videoQueryWorkflowScenario && url.pathname === "/__acceptance/video-query-workflow/refresh" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, await runVideoQueryWorkflowRefresh()); return;
          }
          if (videoQueryWorkflowScenario && url.pathname === "/__acceptance/video-query-workflow/history-sync" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, await runVideoQueryWorkflowHistorySync()); return;
          }
          if (videoQueryWorkflowScenario && url.pathname === "/__acceptance/video-query-workflow/history-continue" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, await runVideoQueryWorkflowHistoryContinuation()); return;
          }
          if (url.pathname === "/__acceptance/status" && method === "GET") {
            json(res, 200, generationScenario
              ? nodeRecoveryProductMode
                ? { ...await nodeRecoveryProductStatusPayload(), slow, toolsAvailable, maintenanceUntil }
                : mediaPublicationScenario
                  ? { ...await mediaPublicationStatusPayload(), slow, toolsAvailable, maintenanceUntil }
                  : videoQueryWorkflowScenario
                    ? { ...await videoQueryWorkflowStatusPayload(), slow, toolsAvailable, maintenanceUntil }
                  : { ...generationStatusPayload(), slow, toolsAvailable, maintenanceUntil }
              : { slow, toolsAvailable, maintenanceUntil, projects, expiresAt: expiresAt.toISOString() }); return;
          }
          if (generationScenario && url.pathname === "/__acceptance/generation/status" && method === "GET") {
            json(res, 200, nodeRecoveryProductMode
              ? await nodeRecoveryProductStatusPayload()
              : mediaPublicationScenario
                ? await mediaPublicationStatusPayload()
                : videoQueryWorkflowScenario
                  ? await videoQueryWorkflowStatusPayload()
                : generationStatusPayload()); return;
          }
          if (nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/status" && method === "GET") {
            json(res, 200, nodeRecoveryStatusPayload()); return;
          }
          if (nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/start" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, await startNodeRecoveryDemo(body.action)); return;
          }
          if (nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/retry-mode" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, await setNodeRecoveryRetryMode(body.mode)); return;
          }
          if (nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/mark-unknown" && method === "POST") {
            await readRequestJson(req);
            json(res, 200, markNodeRecoveryUnknown()); return;
          }
          if (nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/focus" && method === "POST") {
            const body = await readRequestJson(req);
            if (!['unknown', 'overview'].includes(body.action)) throw new AcceptanceControlError('未知画布定位', 'INVALID_FOCUS', 400);
            json(res, 200, await focusNodeRecovery(body.action)); return;
          }
          if (nodeRecoveryScenario && !nodeRecoveryProductMode && url.pathname === "/__acceptance/node-recovery/recovery-stage" && method === "POST") {
            const body = await readRequestJson(req);
            json(res, 200, setNodeRecoveryMaintenanceStage(body.phase)); return;
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

// Seed the deliberately old-schema fixture before the real application opens
// its current-schema database and starts workers. This loader has no app plugin.
if (mediaPublicationScenario || videoQueryWorkflowScenario) {
  const seedLoader = await createServer({
    configFile: false,
    root: sourceRoot,
    server: { middlewareMode: true, host: "127.0.0.1", hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  try { await prepareMediaPublicationAcceptance(seedLoader); }
  finally { await seedLoader.close(); }
}
// Vite's default config bundler and ssrLoadModule create separate module
// instances. This scenario uses one loader for the unmodified product config
// and the local reference adapter so HTTP handlers see the same composition.
const productRuntimeLoader = videoQueryWorkflowScenario ? await createServer({
  configFile: false, root: sourceRoot, appType: "custom",
  server: { middlewareMode: true, host: "127.0.0.1", hmr: false, ws: false, watch: null },
}) : undefined;
const productConfigModule = productRuntimeLoader
  ? await productRuntimeLoader.ssrLoadModule(ssrModuleUrl(join(sourceRoot, "vite.config.ts"))) : undefined;
const productConfig = productConfigModule
  ? await productConfigModule.default({ command: "serve", mode: "development", isPreview: false, isSsrBuild: false }) : undefined;
const server = await createServer({
  ...(productConfig ?? {}),
  configFile: productConfig ? false : join(sourceRoot, "vite.config.ts"),
  plugins: [...(productConfig?.plugins ?? []), plugin],
  server: { ...(productConfig?.server ?? {}), host: "127.0.0.1", port, strictPort: true, hmr: false, open: false },
});
function loadAcceptanceSourceModule(path) {
  return (productRuntimeLoader ?? server).ssrLoadModule(path);
}
let stopping;
async function stop() {
  if (!stopping) {
    for (const stream of [...updateStreams]) stream.end();
    await stopNodeRecoveryProductProvider();
    await stopMediaPublicationProvider();
    stopping = server.close().finally(() => productRuntimeLoader?.close());
  }
  await stopping;
}
async function prepareMediaPublicationAcceptance(seedLoader) {
  // Seed the legacy-to-44 fixture before the browser can read it. The
  // fixture only uses local SQLite and local media bytes; no provider call is
  // made by this setup path.
  const moduleUrl = (path) => ssrModuleUrl(path.split(sep).join("/"));
  const databaseModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/database.ts")));
  const semanticModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "types/workflowSemanticPlan.ts")));
  const releaseDefaultsModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/modelReleaseDefaults.ts")));
  const releaseRevisionModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/modelReleaseRevisionStore.ts")));
  const modelParametersModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "types/modelParameters.ts")));
  const providerProfilesModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/providerProfiles.ts")));
  const accountCredentialsModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/accountCredentials.ts")));
  const modelReleaseBootstrapModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/modelReleaseBootstrap.ts")));
  const modelCatalogModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/modelCatalog.ts")));
  const inputPreflightModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "server/inputPreflight.ts")));
  const identityModule = await seedLoader.ssrLoadModule(moduleUrl(join(sourceRoot, "types/generationIdentity.ts")));
  const seeded = await seedMediaPublicationLegacyDatabase({
    databaseModule,
    semanticModule,
    releaseDefaultsModule,
    releaseRevisionModule,
    modelParametersModule,
    providerProfilesModule,
    accountCredentialsModule,
    modelReleaseBootstrapModule,
    modelCatalogModule,
    inputPreflightModule,
    identityModule,
    dataDirectory: dataRoot,
  });
  mediaPublicationFixture = Object.freeze({
    ...seeded,
    initialPreservedFingerprint: mediaPublicationPreservedFingerprint(seeded.graph),
  });
  projects.push({
    id: MEDIA_PUBLICATION_FIXTURE.canvasId,
    title: videoQueryWorkflowScenario ? "视频查询恢复 · 三项本地验收" : "媒体发布恢复 · 四项同页验收",
    url: `/canvas/${MEDIA_PUBLICATION_FIXTURE.canvasId}`,
  });
  generationFixture = {
    canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
    events: [],
    modelCatalog: { generationEnabled: true, models: [] },
    phase: "candidate",
    sentinels: [],
  };
  generationBuilds = await buildGenerationClients();
  generationJournalPath = join(dataRoot, "media-publication-acceptance-journal.json");
  adminCookie = "unboundry-media-acceptance=bypass; Path=/; SameSite=Lax";
  if (videoQueryWorkflowScenario) {
    // Owner recovery reads deliberately use normal authentication, not the
    // generation API test bypass. Give this temporary owner a real local session.
    const token = randomUUID() + randomUUID();
    const database = databaseModule.openAppDatabase(dataRoot);
    try {
      const now = new Date().toISOString();
      database.prepare("UPDATE project_metadata SET title = ? WHERE owner_id = ? AND id = ?").run(
        "视频查询恢复 · 三项本地验收", MEDIA_PUBLICATION_FIXTURE.ownerId, MEDIA_PUBLICATION_FIXTURE.canvasId);
      database.prepare(`INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), createHash("sha256").update(token).digest("hex"),
        MEDIA_PUBLICATION_FIXTURE.ownerId, expiresAt.toISOString(), now, now);
    } finally { database.close(); }
    adminCookie = `unboundry_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
  }
}

async function initializeVideoQueryWorkflowFixture() {
  if (!videoQueryWorkflowProductMode || !mediaPublicationFixture || !generationFixture) return;
  const semanticModule = await loadAcceptanceSourceModule(ssrModuleUrl(join(sourceRoot, "types/workflowSemanticPlan.ts")));
  const canvas = await (await api(`/api/canvas/${MEDIA_PUBLICATION_FIXTURE.canvasId}`)).json();
  const videoModel = mediaPublicationFixture.models.video;
  const textModel = mediaPublicationFixture.models.text;
  const makeGroup = (id, title, y) => ({
    id,
    type: "group",
    position: { x: 1240, y },
    data: { label: "Group", title },
    style: { width: 760, height: 430 },
  });
  const makeVideo = ({ group, id, title, prompt }) => ({
    id,
    parentId: group.id,
    extent: "parent",
    type: "video",
    position: { x: 50, y: 100 },
    data: {
      label: "Video",
      title,
      videoModelId: videoModel.id,
      // The frozen relay contract for grok-imagine-video-1.5-preview accepts
      // exactly one image first-frame input. Keep this same persisted input in
      // the candidate and baseline workflow so an admission rejection cannot
      // be mistaken for the query-recovery fault.
      videoParameters: { aspectRatio: "16:9", duration: 5, generateAudio: true, inputMode: "reference", outputCount: 1, resolution: "480p" },
      videoPrompt: prompt,
      videoPromptReady: true,
    },
    style: { width: 300, height: 220 },
  });
  const makeTailText = ({ group, id, title, prompt }) => ({
    id,
    parentId: group.id,
    extent: "parent",
    type: "text",
    position: { x: 410, y: 100 },
    data: {
      label: "Text",
      title,
      textModelId: textModel.id,
      textPrompt: prompt,
      textPromptReady: true,
    },
    style: { width: 300, height: 220 },
  });
  const activeGroup = makeGroup(videoQueryWorkflowFixtureIds.activeGroupId, "视频查询自动恢复验收", 80);
  const activeVideo = makeVideo({
    group: activeGroup,
    id: videoQueryWorkflowFixtureIds.activeVideoNodeId,
    title: "临时中断自动视频",
    prompt: "本地验收：模拟查询短暂中断后自动恢复的视频",
  });
  const activeTailText = makeTailText({
    group: activeGroup,
    id: videoQueryWorkflowFixtureIds.activeTailTextNodeId,
    title: "自动完成的尾文字",
    prompt: "本地验收：生成视频后的尾部文字",
  });
  const referenceImage = (canvas.nodes ?? []).find((node) =>
    node.id === MEDIA_PUBLICATION_FIXTURE.pngNodeId &&
    node.type === "image" &&
    node.data?.assetId === MEDIA_PUBLICATION_FIXTURE.pngAssetId &&
    node.data?.imageSrc === `/api/assets/${MEDIA_PUBLICATION_FIXTURE.pngAssetId}`,
  );
  if (!referenceImage) {
    throw new Error("视频查询验收缺少可复用的 ready PNG first-frame reference");
  }
  const activeReference = {
    id: "video-query-active-reference-image",
    source: referenceImage.id,
    target: activeVideo.id,
    data: { inputOrder: 1, inputRole: "first-frame" },
  };
  const activeDependency = { id: "video-query-active-to-tail", source: activeVideo.id, target: activeTailText.id };
  const activeSemantic = semanticModule.compileFrozenWorkflowSemanticPlan({
    edges: [activeReference, activeDependency],
    groupId: activeGroup.id,
    nodes: [referenceImage, activeGroup, activeVideo, activeTailText],
  });
  if (!activeSemantic.executableNodeIds.includes(activeVideo.id) || !activeSemantic.executableNodeIds.includes(activeTailText.id) ||
      activeSemantic.executableNodeIds.length !== 2) {
    throw new Error("视频查询验收活动工作流没有形成可执行的视频与尾部节点");
  }
  videoQueryWorkflowSemanticFingerprint = activeSemantic.semanticFingerprint;
  const historyDefinitions = videoQueryWorkflowBaselineOnly ? [] : (() => {
    const historyGroup = makeGroup(videoQueryWorkflowFixtureIds.historyGroupId, "历史视频找回与尾部继续", 600);
    const historyVideo = makeVideo({
      group: historyGroup,
      id: videoQueryWorkflowFixtureIds.historyVideoNodeId,
      title: "历史事故原视频",
      prompt: "本地验收：历史事故原视频，保留原任务身份",
    });
    const historyTailText = makeTailText({
      group: historyGroup,
      id: videoQueryWorkflowFixtureIds.historyTailTextNodeId,
      title: "历史尾部文字",
      prompt: "本地验收：历史事故视频后的尾部文字",
    });
    const historyReference = {
      id: "video-query-history-reference-image",
      source: referenceImage.id,
      target: historyVideo.id,
      data: { inputOrder: 1, inputRole: "first-frame" },
    };
    const historyDependency = { id: "video-query-history-to-tail", source: historyVideo.id, target: historyTailText.id };
    const historySemantic = semanticModule.compileFrozenWorkflowSemanticPlan({
      edges: [historyReference, historyDependency],
      groupId: historyGroup.id,
      nodes: [referenceImage, historyGroup, historyVideo, historyTailText],
    });
    if (!historySemantic.executableNodeIds.includes(historyVideo.id) || !historySemantic.executableNodeIds.includes(historyTailText.id)) {
      throw new Error("视频查询历史工作流没有形成可执行的视频与尾部节点");
    }
    return { historyGroup, historyVideo, historyTailText, historyReference, historyDependency, historySemantic };
  })();
  videoQueryWorkflowHistoricalSemanticFingerprint = historyDefinitions.historySemantic?.semanticFingerprint ?? "";
  const nodes = [
    ...(canvas.nodes ?? []),
    activeGroup,
    activeVideo,
    activeTailText,
    ...(historyDefinitions.historyGroup ? [historyDefinitions.historyGroup, historyDefinitions.historyVideo, historyDefinitions.historyTailText] : []),
  ];
  const edges = [
    ...(canvas.edges ?? []),
    activeReference,
    activeDependency,
    ...(historyDefinitions.historyReference ? [historyDefinitions.historyReference] : []),
    ...(historyDefinitions.historyDependency ? [historyDefinitions.historyDependency] : []),
  ];
  await generationDocumentPut({
    ...canvas,
    nodes,
    edges,
    viewport: canvas.viewport,
  }, "control");
  const committed = await (await api(`/api/canvas/${MEDIA_PUBLICATION_FIXTURE.canvasId}`)).json();
  // Admission checks the complete persisted graph, including the external
  // reference's parent and input edges. Compile that exact graph as the UI does.
  videoQueryWorkflowSemanticFingerprint = semanticModule.compileFrozenWorkflowSemanticPlan({
    nodes: committed.nodes, edges: committed.edges, groupId: activeGroup.id,
  }).semanticFingerprint;
  if (historyDefinitions.historyGroup) {
    videoQueryWorkflowHistoricalSemanticFingerprint = semanticModule.compileFrozenWorkflowSemanticPlan({
      nodes: committed.nodes, edges: committed.edges, groupId: historyDefinitions.historyGroup.id,
    }).semanticFingerprint;
  }
  videoQueryWorkflowGraphRevision = Number(committed.graphRevision ?? committed.revision ?? 0);
  videoQueryWorkflowInitialCanvas = {
    revision: committed.revision,
    graphRevision: committed.graphRevision,
    nodes: committed.nodes,
    edges: committed.edges,
    viewport: committed.viewport,
    preservedNodes: (canvas.nodes ?? []).map((node) => ({ id: node.id, parentId: node.parentId ?? null, position: node.position, style: node.style, data: node.data })).sort((a, b) => a.id.localeCompare(b.id)),
    preservedEdges: (canvas.edges ?? []).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? "", targetHandle: edge.targetHandle ?? "" })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function startVideoQueryWorkflowHistoricalRun() {
  if (!videoQueryWorkflowProductMode || !videoQueryWorkflowHistoricalSemanticFingerprint) return;
  const created = await api("/api/workflow-runs", "POST", {
    canvasId: MEDIA_PUBLICATION_FIXTURE.canvasId,
    clientSemanticFingerprint: videoQueryWorkflowHistoricalSemanticFingerprint,
    groupId: videoQueryWorkflowFixtureIds.historyGroupId,
  });
  const body = await created.json();
  const runId = body?.run?.id ?? body?.id;
  if (typeof runId !== "string" || !runId) throw new Error("历史视频验收运行没有成功启动");
  videoQueryWorkflowHistoricalRunId = runId;
  const seeded = await waitForVideoQueryWorkflowHistoricalLifecycle();
  videoQueryWorkflowHistoricalOriginalTaskId = seeded.historyVideo.task?.id ?? "";
  videoQueryWorkflowHistoricalOriginalProviderTaskId = seeded.historyVideo.task?.providerTaskId ?? videoQueryWorkflowHistoricalOriginalProviderTaskId;
  if (!videoQueryWorkflowHistoricalOriginalTaskId || !videoQueryWorkflowHistoricalOriginalProviderTaskId) {
    throw new Error("历史视频验收没有保留原始 task/provider 身份");
  }
}

/**
 * The frozen old server is run in a separate process by run-safe-tests. It
 * deliberately receives only the active two-node graph: the old workflow
 * runner can then reproduce the historical split where the accepted Provider
 * task eventually becomes success while its failed run/node stays blank and
 * no downstream task is admitted.
 */
async function runVideoQueryWorkflowBaselineOnly() {
  if (!videoQueryWorkflowBaselineOnly) return undefined;
  await runVideoQueryWorkflowStart();
  // The original product intentionally leaves failed tasks alone for two
  // minutes before its 30-second worker retries the accepted request.
  const deadline = Date.now() + 240_000;
  let last;
  while (Date.now() < deadline) {
    last = await videoQueryWorkflowSnapshot();
    const videoTask = last.video.task;
    const videoRunNode = last.runNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.activeVideoNodeId);
    const tailRunNode = last.runNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.activeTailTextNodeId);
    const videoVisible = typeof last.video.node?.videoSrc === "string" && last.video.node.videoSrc.length > 0;
    const tailVisible = typeof last.tailText.node?.content === "string" && last.tailText.node.content.length > 0;
    const videoProviderPosts = mediaPublicationProviderStats.requests.filter((request) =>
      request.path === "/v1/media/generate" && request.phase === "active" && request.capability === "video",
    ).length;
    const tailProviderPosts = mediaPublicationProviderStats.requests.filter((request) =>
      (request.path === "/v1/responses" || request.path === "/v1/media/generate") &&
      request.phase === "active" && request.capability === "text",
    ).length;
    const lockDiagnostic = videoQueryWorkflowDiagnosticEvents.find((event) =>
      event.errorName === "ProviderProfileLockBusyError",
    );
    const lockFailureEvent = (last.video.events ?? []).find((event) =>
      event.errorCode === "RESULT_DELAYED" || event.errorCode === "PROVIDER_LOCK_BUSY",
    );
    const oldSplitReproduced = last.run?.state === "failed" &&
      videoRunNode?.state === "failed" &&
      videoTask?.state === "success" &&
      !last.tailText.task &&
      tailRunNode?.taskId == null &&
      !videoVisible && !tailVisible &&
      videoProviderPosts === 1 && tailProviderPosts === 0 &&
      videoQueryWorkflowProviderProfileLockInjected &&
      Boolean(lockDiagnostic) && Boolean(lockFailureEvent);
    if (oldSplitReproduced) break;
    await acceptanceDelay(250);
  }
  if (!last) throw new Error("冻结旧实现没有返回工作流证据");
  const videoProviderPosts = mediaPublicationProviderStats.requests.filter((request) =>
    request.path === "/v1/media/generate" && request.phase === "active" && request.capability === "video",
  ).length;
  const tailProviderPosts = mediaPublicationProviderStats.requests.filter((request) =>
    (request.path === "/v1/responses" || request.path === "/v1/media/generate") &&
    request.phase === "active" && request.capability === "text",
  ).length;
  const videoVisible = typeof last.video.node?.videoSrc === "string" && last.video.node.videoSrc.length > 0;
  const tailVisible = typeof last.tailText.node?.content === "string" && last.tailText.node.content.length > 0;
  const videoRunNode = last.runNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.activeVideoNodeId);
  const tailRunNode = last.runNodes.find((node) => node.nodeId === videoQueryWorkflowFixtureIds.activeTailTextNodeId);
  const lockDiagnostic = videoQueryWorkflowDiagnosticEvents.find((event) =>
    event.errorName === "ProviderProfileLockBusyError",
  );
  const lockFailureEvent = (last.video.events ?? []).find((event) =>
    event.errorCode === "RESULT_DELAYED" || event.errorCode === "PROVIDER_LOCK_BUSY",
  );
  if (last.run?.state !== "failed" || videoRunNode?.state !== "failed" ||
      last.video.task?.state !== "success" || last.tailText.task || tailRunNode?.taskId != null ||
      videoVisible || tailVisible || videoProviderPosts !== 1 || tailProviderPosts !== 0 ||
      !videoQueryWorkflowProviderProfileLockInjected || !lockDiagnostic || !lockFailureEvent) {
    console.error("[video-query-baseline-incomplete]", JSON.stringify({ run: last.run, video: last.video, tail: last.tailText, videoProviderPosts, tailProviderPosts, lockDiagnostic, lockFailureEvent }));
    throw new Error("冻结旧实现没有复现已受理任务成功但工作流失败且画布空白的分裂结果");
  }
  const diagnostics = Object.fromEntries(videoQueryWorkflowDiagnosticStageCounts);
  const report = {
    status: "EXPECTED_FAILURE_REPRODUCED",
    baselineOnly: true,
    browser: false,
    historyStarted: false,
    activeGroupOnly: true,
    videoProviderPosts,
    tailProviderPosts,
    taskState: last.video.task.state,
    taskId: last.video.task.id,
    taskAttempt: last.video.task.attempt,
    providerTaskId: last.video.task.providerTaskId,
    runId: last.run?.id ?? videoQueryWorkflowRunId,
    runState: last.run?.state,
    videoRunNodeState: videoRunNode?.state ?? null,
    tailRunNodeState: tailRunNode?.state ?? null,
    videoVisible,
    tailVisible,
    profileLockInjected: videoQueryWorkflowProviderProfileLockInjected,
    queryInterruptions: videoQueryWorkflowProviderStatusFailures,
    statusGets: mediaPublicationProviderStats.gets,
    lockDiagnostic,
    lockFailureEvent,
    diagnosticStageCounts: diagnostics,
    diagnosticEvents: videoQueryWorkflowDiagnosticEvents,
    paidProviderRequests: 0,
    resetForUser: true,
  };
  writeFileSync(join(testRoot, "video-query-workflow-baseline.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`[video-query-workflow-baseline] ${JSON.stringify(report)}`);
  return report;
}
process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
try {
  await server.listen();
  if (mediaPublicationScenario || videoQueryWorkflowScenario) {
    await startMediaPublicationProvider();
    if (videoQueryWorkflowScenario) {
      await initializeVideoQueryWorkflowFixture();
      if (!videoQueryWorkflowBaselineOnly) {
        await loadMediaPublicationSourceModules();
        await configureVideoQueryWorkflowReferenceStore();
        await startVideoQueryWorkflowHistoricalRun();
      }
    }
    mediaPublicationInitialVideoProviderPosts = mediaPublicationProviderStats.videoPosts;
  }
  let ownerId = MEDIA_PUBLICATION_FIXTURE.ownerId;
  if (!mediaPublicationScenario && !videoQueryWorkflowScenario) {
    const bootstrap = await api("/api/auth/bootstrap", "POST", {
      displayName: "本地验收管理员", loginName: "acceptance", password: `local-${randomUUID()}`,
    });
    adminCookie = bootstrap.headers.get("set-cookie");
    if (!adminCookie) throw new Error("Temporary admin session was not created");
    const bootstrapBody = await bootstrap.clone().json();
    ownerId = bootstrapBody?.user?.id;
  }
  if (generationScenario && (typeof ownerId !== "string" || ownerId.length === 0)) {
    throw new Error("Temporary generation acceptance session did not return its owner identity");
  }
  if (generationScenario && !mediaPublicationScenario && !videoQueryWorkflowScenario) {
    const title = nodeRecoveryScenario
      ? "失败节点恢复 · V4 同页三项本地验收"
      : "状态查询验收 · 四类节点与回退演练";
    const item = await (await api("/api/projects", "POST", { title })).json();
    projects.push({ id: item.id, title, url: `/canvas/${item.id}` });
    if (nodeRecoveryProductMode) await startNodeRecoveryProductProvider();
    await initializeGenerationFixture(item.id, ownerId);
    if (!nodeRecoveryProductMode) {
      const baseline = await (await api(`/api/canvas/${item.id}`)).json();
      await generationDocumentPut({
        ...baseline,
        nodes: generationCanvasNodes(),
        edges: nodeRecoveryScenario ? nodeRecoveryFixture.preservedEdges : [],
      }, "control");
      persistGenerationJournal("canvasSeed", {
        nodeCount: generationTasks.size,
        phase: "candidate",
        sharedTaskIds: [...generationTasks.keys()],
        preservedSuccessNodeCount: nodeRecoveryScenario ? nodeRecoveryFixture.preservedSuccessNodeCount : undefined,
      });
    }
  } else if (!generationScenario) {
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
  if (videoQueryWorkflowBaselineOnly) {
    await runVideoQueryWorkflowBaselineOnly();
  } else {
  ready = true;
  if (nodeRecoveryScenario && !nodeRecoveryProductMode) await smokeNodeRecoveryGuide();
  if (videoQueryWorkflowScenario) await smokeVideoQueryWorkflowGuide();
  const receipt = generationScenario
      ? {
        status: "USER_RECHECK",
        scenario: acceptanceScenario,
        url: `${origin}/__acceptance`,
        appUrl: `${origin}/__acceptance/generation-entry?variant=candidate`,
        guideUrl: `${origin}/__acceptance`,
        expiresAt: expiresAt.toISOString(), pid: process.pid, dataRoot, projects,
        canvasId: generationFixture.canvasId,
        taskIds: nodeRecoveryProductMode
          ? Object.values(nodeRecoveryProductFixture.roles).map((role) => role.taskId)
          : mediaPublicationScenario
            ? [
                ...MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.map((nodeId) =>
                  `media-publication-preserved-task-${nodeId.slice(-2)}`),
                MEDIA_PUBLICATION_FIXTURE.adoptionTaskId,
              ]
            : videoQueryWorkflowScenario
              ? [
                  videoQueryWorkflowHistoricalOriginalTaskId,
                  videoQueryWorkflowRunId,
                  videoQueryWorkflowHistoricalRunId,
                ].filter(Boolean)
            : [...generationTasks.keys()],
        sentinels: generationFixture.sentinels,
        syntheticOnly: true,
        taskStorage: (nodeRecoveryProductMode || videoQueryWorkflowProductMode)
          ? "temporary application SQLite through real product task/case commands"
          : mediaPublicationScenario
            ? "temporary application SQLite through real workflow/adoption commands"
            : "acceptance journal and API projection; not generation_tasks SQLite or Provider evidence",
        providerPolicy: nodeRecoveryProductMode
          ? "dynamic loopback fake Provider only; external calls blocked; verify safe-runner network audit"
          : mediaPublicationScenario
            ? "dynamic loopback fake Provider only; external/paid calls blocked; upstream 0 and continuation downstream 2"
            : "external calls blocked; verify safe-runner network audit",
        journalPath: generationJournalPath,
        builds: generationBuilds,
        sourceModules: {
          candidate: generationBuilds.candidateSource,
          baseline: generationBuilds.baselineSource,
        },
        ...(mediaPublicationScenario
          ? {
              actualProductCommands: true,
              preservedSuccessNodeCount: MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.length,
              continuationPath: "/api/workflow-runs/:parentRunId/continue (one child, GET-only reattach)",
              providerRequests: mediaPublicationProviderStats.posts + mediaPublicationProviderStats.gets + mediaPublicationProviderStats.mediaGets,
              providerPosts: mediaPublicationProviderStats.posts,
              paidProviderRequests: 0,
            }
          : videoQueryWorkflowScenario
            ? {
                actualProductCommands: true,
                preservedSuccessNodeCount: MEDIA_PUBLICATION_FIXTURE.preservedNodeIds.length,
                recoveryPath: "/api/workflow-runs (real query/recovery/publication) with narrow historical sync then continuation",
                providerRequests: mediaPublicationProviderStats.posts + mediaPublicationProviderStats.gets + mediaPublicationProviderStats.mediaGets + mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/responses").length,
                providerPosts: mediaPublicationProviderStats.posts,
                activeVideoProviderPosts: mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/media/generate" && request.phase === "active" && request.capability === "video").length,
                historicalVideoProviderPosts: mediaPublicationProviderStats.requests.filter((request) => request.path === "/v1/media/generate" && request.phase === "history" && request.capability === "video").length,
                paidProviderRequests: 0,
                productSmoke: join(testRoot, "video-query-workflow-product-smoke.json"),
              }
          : nodeRecoveryScenario
          ? nodeRecoveryProductMode
            ? {
                actualProductCommands: true,
                preservedSuccessNodeCount: nodeRecoveryProductFixture.preservedSuccessNodeCount,
                retryPath: "/api/generation-tasks (new POST only after protected admission)",
                providerRequests: nodeRecoveryProviderStats.posts + nodeRecoveryProviderStats.gets + nodeRecoveryProviderStats.mediaGets,
                providerPosts: nodeRecoveryProviderStats.posts,
                paidProviderRequests: 0,
              }
            : {
                preservedSuccessNodeCount: nodeRecoveryFixture.preservedSuccessNodeCount,
                retryPath: nodeRecoveryFixture.retry.retryPath,
                providerRequests: 0,
                paidProviderRequests: 0,
              }
          : {}),
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
  }
} finally {
  await stop();
}
// Vite's denied wildcard capability probe leaves the offline guard exit code
// set. The owning runner independently audits every network attempt before
// accepting this successful, fully closed session (as for the signal path).
process.exit(0);
