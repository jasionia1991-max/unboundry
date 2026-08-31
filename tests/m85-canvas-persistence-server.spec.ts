import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./safe-test";
import { authGate } from "../server/auth";
import {
  canvasSaveHighWaterTableExistsForTests,
  canvasSaveSessionHighWaterForTests,
  canvasPersistence,
  reserveCanvasSaveSessionHighWaterForTests,
  resetCanvasPersistenceConnectionForTests,
  setCanvasPersistenceBarriersForTests,
} from "../server/canvasPersistence";
import { openAppDatabase } from "../server/database";
import { stableValueFingerprint } from "../types/canvasFingerprint";
import { deleteProjectRows } from "../server/projects";
import {
  canvasLegacyGenerationReconciliation,
  legacyTerminalDetachApplicationIdForBinding,
  legacyTerminalNodeDataFingerprint,
  runAllowlistedLegacyTerminalDetachSweep,
} from
  "../server/canvasLegacyGenerationReconciliation";
import {
  groupResultProjectionApplicationId,
  groupResultSemanticRevision,
} from "../client/src/generation/groupResultProjection";

type ApiResult = {
  body: Record<string, unknown>;
  status: number;
};

type CanvasSeed = {
  graphRevision?: number;
  nodes?: unknown[];
  revision?: number;
  saveSequence?: number;
  saveSessionId?: string | null;
};

type Harness = {
  api: (
    method: string,
    canvasId: string,
    body?: unknown,
    options?: { cookie?: string; headers?: Record<string, string> },
  ) => Promise<ApiResult>;
  reconcile: (
    method: string,
    canvasId: string,
    operation: "generation-reconciliation-policy" | "generation-terminal-detach",
    body?: unknown,
    options?: { cookie?: string; headers?: Record<string, string> },
  ) => Promise<ApiResult>;
  dataDirectory: string;
  origin: string;
};

const viewport = { x: 0, y: 0, zoom: 1 };
const loadTokenPattern = /^v1\.[A-Za-z0-9_-]{43}$/;
const saveEpochPattern = /^v1\.[A-Za-z0-9_-]{22}$/;

function loadTokenFrom(result: ApiResult) {
  expect(result.body.loadToken).toEqual(
    expect.stringMatching(loadTokenPattern),
  );
  const token = result.body.loadToken;
  if (typeof token !== "string") {
    throw new Error("Canvas response did not contain a load token");
  }
  return token;
}

function restoreEnvironment(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function withCanvasServer(
  name: string,
  run: (harness: Harness) => Promise<void>,
  options: { authBypass?: boolean } = {},
) {
  const dataDirectory = await mkdtemp(join(tmpdir(), `unboundry-${name}-`));
  const previousDirectory = process.env.UNBOUNDRY_DATA_DIR;
  const previousBypass = process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  const previousBarrier =
    process.env.UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER;
  process.env.UNBOUNDRY_DATA_DIR = dataDirectory;
  if (options.authBypass === false) {
    delete process.env.UNBOUNDRY_TEST_AUTH_BYPASS;
  } else {
    process.env.UNBOUNDRY_TEST_AUTH_BYPASS = "1";
  }
  process.env.UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER = "1";
  const server = createServer((request, response) => {
    const route = request.url ?? "/";
    const dispatch = () => {
      if (route.startsWith("/api/canvases/")) {
        request.url = route.slice("/api/canvases/".length) || "/";
        void canvasLegacyGenerationReconciliation(request, response).catch(() => {
          if (response.writableEnded || response.destroyed) return;
          response.statusCode = 500;
          response.end(JSON.stringify({ code: "INTERNAL_ERROR" }));
        });
        return;
      }
      if (!route.startsWith("/api/canvas/")) {
        response.statusCode = 404;
        response.end();
        return;
      }
      request.url = route.slice("/api/canvas".length) || "/";
      void canvasPersistence(request, response).catch(() => {
        if (response.writableEnded || response.destroyed) return;
        response.statusCode = 500;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({
          code: "INTERNAL_ERROR",
          error: "Internal server error",
        }));
      });
    };
    void authGate(request, response, dispatch);
  });
  try {
    if (options.authBypass !== false) seedUser(dataDirectory, "__test__");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Canvas persistence test server has no TCP address");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const api = async (
      method: string,
      canvasId: string,
      body?: unknown,
      requestOptions: {
        cookie?: string;
        headers?: Record<string, string>;
      } = {},
    ): Promise<ApiResult> => {
      const response = await fetch(`${origin}/api/canvas/${canvasId}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...requestOptions.headers,
          ...(requestOptions.cookie ? { Cookie: requestOptions.cookie } : {}),
        },
        method,
      });
      const text = await response.text();
      return {
        body: text ? JSON.parse(text) as Record<string, unknown> : {},
        status: response.status,
      };
    };
    const reconcile: Harness["reconcile"] = async (
      method,
      canvasId,
      operation,
      body,
      requestOptions = {},
    ) => {
      const response = await fetch(
        `${origin}/api/canvases/${canvasId}/${operation}`,
        {
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: {
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...requestOptions.headers,
            ...(requestOptions.cookie ? { Cookie: requestOptions.cookie } : {}),
          },
          method,
        },
      );
      const text = await response.text();
      return {
        body: text ? JSON.parse(text) as Record<string, unknown> : {},
        status: response.status,
      };
    };
    await run({ api, dataDirectory, origin, reconcile });
  } finally {
    setCanvasPersistenceBarriersForTests();
    await stopServer(server).catch(() => undefined);
    resetCanvasPersistenceConnectionForTests();
    restoreEnvironment(
      "UNBOUNDRY_TEST_CANVAS_PERSISTENCE_BARRIER",
      previousBarrier,
    );
    restoreEnvironment("UNBOUNDRY_TEST_AUTH_BYPASS", previousBypass);
    restoreEnvironment("UNBOUNDRY_DATA_DIR", previousDirectory);
    await rm(dataDirectory, { force: true, recursive: true });
  }
}

function databaseAt(dataDirectory: string) {
  return new DatabaseSync(join(dataDirectory, "unboundry.sqlite"));
}

function seedUser(dataDirectory: string, ownerId: string) {
  const timestamp = new Date().toISOString();
  const store = openAppDatabase(dataDirectory);
  try {
    store.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES (
        ?, ?, 'Test User', 'test-only', 'user', 'active',
        ?, ?
      )
    `).run(ownerId, ownerId, timestamp, timestamp);
  } finally {
    store.close();
  }
}

function seedProject(
  dataDirectory: string,
  canvasId: string,
  seed: CanvasSeed = {},
  ownerId = "__test__",
) {
  const store = openAppDatabase(dataDirectory);
  const timestamp = new Date().toISOString();
  const updatedAt = 1_700_000_000_000;
  try {
    store.prepare(`
      INSERT OR IGNORE INTO users (
        id, login_name, display_name, password_hash, role, status,
        created_at, updated_at
      )
      VALUES (
        ?, ?, 'Test User', 'test-only', 'admin', 'active',
        ?, ?
      )
    `).run(ownerId, ownerId, timestamp, timestamp);
    store.prepare(`
      INSERT INTO project_metadata (
        owner_id, id, title, updated_at, is_project, created_at, deleted_at
      )
      VALUES (?, ?, 'Synthetic project', ?, 1, ?, NULL)
    `).run(ownerId, canvasId, updatedAt, updatedAt);
    store.prepare(`
      INSERT INTO canvas_documents (
        owner_id, id, revision, graph_revision, nodes, edges, viewport,
        updated_at, save_session_id, save_sequence
      )
      VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
    `).run(
      ownerId,
      canvasId,
      seed.revision ?? 1,
      seed.graphRevision ?? 1,
      JSON.stringify(seed.nodes ?? [{ id: "before" }]),
      JSON.stringify(viewport),
      timestamp,
      seed.saveSessionId ?? null,
      seed.saveSequence ?? 0,
    );
  } finally {
    store.close();
  }
  return { updatedAt };
}

function seedAuthenticatedSession(
  dataDirectory: string,
  ownerId: string,
) {
  const token = `m85-${ownerId}-${randomUUID()}`;
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const store = openAppDatabase(dataDirectory);
  try {
    store.prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, expires_at, created_at, last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      createHash("sha256").update(token).digest("hex"),
      ownerId,
      expiresAt,
      timestamp,
      timestamp,
    );
  } finally {
    store.close();
  }
  return `unboundry_session=${token}`;
}

function seedGenerationTask(
  dataDirectory: string,
  input: {
    canvasId: string;
    kind: "audio" | "image" | "text" | "video";
    nodeId: string;
    ownerId: string;
    resultText?: string;
    state: "cancelled" | "failed" | "running" | "success";
    taskId: string;
  },
) {
  const store = openAppDatabase(dataDirectory);
  const timestamp = "2026-08-26T00:00:00.000Z";
  try {
    store.prepare(`
      INSERT INTO generation_tasks (
        id, canvas_id, node_id, kind, prompt, model, parameters,
        idempotency_key, request_fingerprint, state, attempt,
        created_at, updated_at, owner_id, cost_currency,
        model_configuration, credential_revision
      ) VALUES (?, ?, ?, ?, 'fixture', 'fixture-model', '{}', ?, ?, ?, 2,
        ?, ?, ?, 'CNY', '{}', 0)
    `).run(
      input.taskId,
      input.canvasId,
      input.nodeId,
      input.kind,
      `idem-${input.taskId}`,
      `fingerprint-${input.taskId}`,
      input.state,
      timestamp,
      timestamp,
      input.ownerId,
    );
    if (input.resultText !== undefined) {
      store.prepare("UPDATE generation_tasks SET result_text = ? WHERE id = ?")
        .run(input.resultText, input.taskId);
    }
    store.prepare(`
      INSERT INTO generation_provider_attempts (
        task_id, execution_attempt, provider_profile_id, provider_model_id,
        kind, evidence, created_at, owner_id, credential_revision, outcome,
        provider_task_id, finished_at
      ) VALUES (?, 2, 'profile-fixture', 'model-fixture', ?,
        'historical-execution-attempt', ?, ?, 0, 'completed',
        'provider-task-fixture', ?)
    `).run(input.taskId, input.kind, timestamp, input.ownerId, timestamp);
  } finally {
    store.close();
  }
}

function saveBody(
  nodeId: string,
  revision: number,
  saveSessionId: string,
  saveSequence: number,
  observedRevision?: number,
  observedLoadToken?: string,
  saveAttemptId?: string,
) {
  return {
    edges: [],
    nodes: [{ id: nodeId }],
    ...(observedLoadToken === undefined ? {} : { observedLoadToken }),
    ...(observedRevision === undefined ? {} : { observedRevision }),
    revision,
    ...(saveAttemptId === undefined ? {} : { saveAttemptId }),
    saveSequence,
    saveSessionId,
    viewport,
  };
}

test("legacy terminal detach is owner-scoped, atomic, idempotent and fail-closed", async () => {
  const previousMode = process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE;
  const previousAllowlist =
    process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST;
  process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "on";
  delete process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST;
  try {
    await withCanvasServer("legacy-terminal-detach", async ({
      dataDirectory,
      reconcile,
    }) => {
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const canvasId = `m85-terminal-${randomUUID()}`;
      const longInputFingerprint = JSON.stringify({
        inputs: [],
        modelId: "model-a",
        parameters: {},
        prompt: "测试长提示词".repeat(4_000),
      });
      expect(longInputFingerprint.length).toBeGreaterThan(16 * 1024);
      expect(longInputFingerprint.length).toBeLessThanOrEqual(100_000);
      const node = (input: {
        inputFingerprint?: string;
        kind: "image" | "text";
        nodeId: string;
        ownershipKey: string;
        runId: string;
        taskId: string;
      }) => ({
        data: {
          [`${input.kind}Generating`]: true,
          [`${input.kind}GenerationError`]: "old terminal error",
          [`${input.kind}GenerationInputKey`]:
            input.inputFingerprint ?? `input-${input.nodeId}`,
          [`${input.kind}GenerationOwnershipKey`]: input.ownershipKey,
          [`${input.kind}GenerationTaskId`]: input.taskId,
          label: input.nodeId,
          userField: `preserve-${input.nodeId}`,
          workflowExecutionRunId: input.runId,
        },
        id: input.nodeId,
        position: { x: 0, y: 0 },
        type: input.kind,
      });
      const terminalNode = node({
        inputFingerprint: longInputFingerprint,
        kind: "text",
        nodeId: "text-terminal",
        ownershipKey: "owner-terminal",
        runId: "run-terminal",
        taskId: "task-terminal",
      });
      const activeNode = node({
        kind: "image",
        nodeId: "image-active",
        ownershipKey: "owner-active",
        runId: "run-active",
        taskId: "task-active",
      });
      const conflictNode = node({
        kind: "text",
        nodeId: "text-conflict",
        ownershipKey: "canvas-owner-conflict",
        runId: "run-conflict",
        taskId: "task-conflict",
      });
      const successResultKey = stableValueFingerprint({
        content: "server result",
        contentHtml: "<p>server result</p>",
      });
      const proofNodeBase = node({
        kind: "text",
        nodeId: "text-proof",
        ownershipKey: "owner-proof",
        runId: "run-proof",
        taskId: "task-proof",
      });
      const proofNode = {
        ...proofNodeBase,
        data: {
          ...proofNodeBase.data,
          content: "server result",
          contentHtml: "<p>server result</p>",
          groupRunSuccessOwnershipKey: "owner-proof",
          groupRunSuccessResultKey: successResultKey,
          groupRunSuccessTaskId: "task-proof",
        },
      };
      seedUser(dataDirectory, ownerId);
      seedUser(dataDirectory, otherOwnerId);
      seedProject(dataDirectory, canvasId, {
        graphRevision: 11,
        nodes: [terminalNode, activeNode, conflictNode, proofNode],
        revision: 7,
      }, ownerId);
      seedGenerationTask(dataDirectory, {
        canvasId,
        kind: "text",
        nodeId: "text-terminal",
        ownerId,
        state: "failed",
        taskId: "task-terminal",
      });
      seedGenerationTask(dataDirectory, {
        canvasId,
        kind: "image",
        nodeId: "image-active",
        ownerId,
        state: "running",
        taskId: "task-active",
      });
      seedGenerationTask(dataDirectory, {
        canvasId,
        kind: "text",
        nodeId: "text-conflict",
        ownerId,
        state: "failed",
        taskId: "task-conflict",
      });
      seedGenerationTask(dataDirectory, {
        canvasId,
        kind: "text",
        nodeId: "text-proof",
        ownerId,
        resultText: "server result",
        state: "success",
        taskId: "task-proof",
      });
      const ownerCookie = seedAuthenticatedSession(dataDirectory, ownerId);
      const otherCookie = seedAuthenticatedSession(dataDirectory, otherOwnerId);
      const body = (input: {
        inputFingerprint: string;
        kind: "image" | "text";
        nodeId: string;
        ownershipKey: string;
        runId: string;
        taskId: string;
      }) => {
        const seededNode = [terminalNode, activeNode, conflictNode, proofNode].find(
          (candidate) => candidate.id === input.nodeId,
        );
        if (!seededNode) throw new Error("missing terminal fixture node");
        const binding = {
          accountId: ownerId,
          canvasId,
          nodeDataFingerprint: legacyTerminalNodeDataFingerprint(seededNode.data),
          ...input,
        };
        return {
          accountId: ownerId,
          applicationId: legacyTerminalDetachApplicationIdForBinding(binding),
          canvasId,
          nodeDataFingerprint: binding.nodeDataFingerprint,
          observedTerminalState: "failed",
          ...input,
        };
      };
      expect(await reconcile(
        "GET",
        canvasId,
        "generation-reconciliation-policy",
        undefined,
        { cookie: otherCookie },
      )).toEqual({
        body: { code: "CANVAS_NOT_FOUND", error: "Canvas not found" },
        status: 404,
      });
      expect(await reconcile(
        "GET",
        canvasId,
        "generation-reconciliation-policy",
        undefined,
        { cookie: ownerCookie },
      )).toEqual({ body: { mode: "on", writeEnabled: true }, status: 200 });

      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "off";
      expect(await reconcile(
        "GET",
        canvasId,
        "generation-reconciliation-policy",
        undefined,
        { cookie: ownerCookie },
      )).toEqual({ body: { mode: "off", writeEnabled: false }, status: 200 });
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "allowlist";
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST = "[]";
      expect(await reconcile(
        "GET",
        canvasId,
        "generation-reconciliation-policy",
        undefined,
        { cookie: ownerCookie },
      )).toEqual({ body: { mode: "allowlist", writeEnabled: false }, status: 200 });
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        body({
          inputFingerprint: longInputFingerprint,
          kind: "text",
          nodeId: "text-terminal",
          ownershipKey: "owner-terminal",
          runId: "run-terminal",
          taskId: "task-terminal",
        }),
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "LEGACY_RECONCILIATION_WRITE_DISABLED" },
        status: 409,
      });
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST =
        JSON.stringify([{ accountId: ownerId, canvasId }]);
      expect(await reconcile(
        "GET",
        canvasId,
        "generation-reconciliation-policy",
        undefined,
        { cookie: ownerCookie },
      )).toEqual({ body: { mode: "allowlist", writeEnabled: true }, status: 200 });

      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "detect";
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        body({
          inputFingerprint: longInputFingerprint,
          kind: "text",
          nodeId: "text-terminal",
          ownershipKey: "owner-terminal",
          runId: "run-terminal",
          taskId: "task-terminal",
        }),
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "LEGACY_RECONCILIATION_WRITE_DISABLED" },
        status: 409,
      });
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "on";

      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        body({
          inputFingerprint: "x".repeat(100_001),
          kind: "text",
          nodeId: "text-terminal",
          ownershipKey: "owner-terminal",
          runId: "run-terminal",
          taskId: "task-terminal",
        }),
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "GENERATION_TERMINAL_DETACH_INVALID" },
        status: 400,
      });

      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        body({
          inputFingerprint: "input-image-active",
          kind: "image",
          nodeId: "image-active",
          ownershipKey: "owner-active",
          runId: "run-active",
          taskId: "task-active",
        }),
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "GENERATION_TERMINAL_TASK_CONFLICT" },
        status: 409,
      });
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        {
          ...body({
            inputFingerprint: longInputFingerprint,
            kind: "text",
            nodeId: "text-terminal",
            ownershipKey: "owner-terminal",
            runId: "run-terminal",
            taskId: "task-terminal",
          }),
          observedTerminalState: "success",
        },
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "GENERATION_TERMINAL_STATE_CONFLICT" },
        status: 409,
      });
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        body({
          inputFingerprint: "input-text-conflict",
          kind: "text",
          nodeId: "text-conflict",
          ownershipKey: "request-owner-conflict",
          runId: "run-conflict",
          taskId: "task-conflict",
        }),
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "GENERATION_TERMINAL_BINDING_CONFLICT" },
        status: 409,
      });
      const successProofBinding = {
        accountId: ownerId,
        canvasId,
        inputFingerprint: "input-text-proof",
        kind: "text" as const,
        nodeDataFingerprint: legacyTerminalNodeDataFingerprint(proofNode.data),
        nodeId: "text-proof",
        observedTerminalState: "success" as const,
        ownershipKey: "owner-proof",
        resultKey: successResultKey,
        runId: "run-proof",
        taskId: "task-proof",
      };
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        {
          ...successProofBinding,
          applicationId: legacyTerminalDetachApplicationIdForBinding({
            ...successProofBinding,
            resultKey: "wrong-result-key",
          }),
          resultKey: "wrong-result-key",
        },
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "GENERATION_TERMINAL_PROOF_CONFLICT" },
        status: 409,
      });
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        {
          ...successProofBinding,
          applicationId: legacyTerminalDetachApplicationIdForBinding(
            successProofBinding,
          ),
        },
        { cookie: ownerCookie },
      ))).toMatchObject({ body: { status: "detached" }, status: 200 });
      const editedNodeRequest = body({
        inputFingerprint: longInputFingerprint,
        kind: "text",
        nodeId: "text-terminal",
        ownershipKey: "owner-terminal",
        runId: "run-terminal",
        taskId: "task-terminal",
      });
      editedNodeRequest.nodeDataFingerprint = legacyTerminalNodeDataFingerprint({
        ...terminalNode.data,
        userField: "edited-after-detection",
      });
      editedNodeRequest.applicationId = legacyTerminalDetachApplicationIdForBinding(
        {
          accountId: editedNodeRequest.accountId,
          canvasId: editedNodeRequest.canvasId,
          inputFingerprint: editedNodeRequest.inputFingerprint,
          kind: editedNodeRequest.kind,
          nodeDataFingerprint: editedNodeRequest.nodeDataFingerprint,
          nodeId: editedNodeRequest.nodeId,
          ownershipKey: editedNodeRequest.ownershipKey,
          runId: editedNodeRequest.runId,
          taskId: editedNodeRequest.taskId,
        },
      );
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        editedNodeRequest,
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "GENERATION_TERMINAL_BINDING_CONFLICT" },
        status: 409,
      });

      const beforeStore = databaseAt(dataDirectory);
      const before = {
        attempts: beforeStore.prepare(
          "SELECT COUNT(*) AS count FROM generation_provider_attempts",
        ).get(),
        tasks: beforeStore.prepare(
          "SELECT id, state, attempt FROM generation_tasks ORDER BY id",
        ).all(),
      };
      beforeStore.close();
      const detachRequest = body({
        inputFingerprint: longInputFingerprint,
        kind: "text",
        nodeId: "text-terminal",
        ownershipKey: "owner-terminal",
        runId: "run-terminal",
        taskId: "task-terminal",
      });
      const detached = await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        detachRequest,
        { cookie: ownerCookie },
      );
      expect(detached.status).toBe(200);
      expect(detached.body.status).toBe("detached");
      expect(detached.body.document).toMatchObject({
        graphRevision: 13,
        revision: 9,
      });
      const detachedDocument = detached.body.document as { nodes: Array<{
        data: Record<string, unknown>;
        id: string;
      }> };
      expect(detachedDocument.nodes.find((item) => item.id === "text-terminal")?.data)
        .toEqual({
          label: "text-terminal",
          legacyTerminalDetachApplicationId: detachRequest.applicationId,
          textGenerating: false,
          userField: "preserve-text-terminal",
        });
      const repeated = await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        detachRequest,
        { cookie: ownerCookie },
      );
      expect(repeated).toMatchObject({
        body: {
          document: { graphRevision: 13, revision: 9 },
          status: "already-detached",
        },
        status: 200,
      });
      expect((await reconcile(
        "POST",
        canvasId,
        "generation-terminal-detach",
        body({
          inputFingerprint: longInputFingerprint,
          kind: "text",
          nodeId: "text-terminal",
          ownershipKey: "wrong-after-detach",
          runId: "run-terminal",
          taskId: "task-terminal",
        }),
        { cookie: ownerCookie },
      ))).toMatchObject({
        body: { code: "GENERATION_TERMINAL_BINDING_CONFLICT" },
        status: 409,
      });
      const afterStore = databaseAt(dataDirectory);
      const after = {
        attempts: afterStore.prepare(
          "SELECT COUNT(*) AS count FROM generation_provider_attempts",
        ).get(),
        tasks: afterStore.prepare(
          "SELECT id, state, attempt FROM generation_tasks ORDER BY id",
        ).all(),
      };
      afterStore.close();
      expect(after).toEqual(before);
    }, { authBypass: false });
  } finally {
    restoreEnvironment(
      "UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE",
      previousMode,
    );
    restoreEnvironment(
      "UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST",
      previousAllowlist,
    );
  }
});

test("server sweep detaches only allowlisted failed/cancelled exact bindings without touching ledgers", async () => {
  const previousMode = process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE;
  const previousAllowlist =
    process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST;
  process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "allowlist";
  try {
    await withCanvasServer("legacy-terminal-sweep", async ({
      api,
      dataDirectory,
    }) => {
      const ownerId = randomUUID();
      const canvasId = `m85-terminal-sweep-${randomUUID()}`;
      const excludedCanvasId = `m85-terminal-excluded-${randomUUID()}`;
      const boundNode = (input: {
        kind: "image" | "text";
        nodeId: string;
        stateLabel: string;
        taskId: string;
      }) => ({
        data: {
          [`${input.kind}Generating`]: true,
          [`${input.kind}GenerationError`]: `old-${input.stateLabel}`,
          [`${input.kind}GenerationInputKey`]: `input-${input.nodeId}`,
          [`${input.kind}GenerationOwnershipKey`]: `ownership-${input.nodeId}`,
          [`${input.kind}GenerationTaskId`]: input.taskId,
          label: input.stateLabel,
          userField: `preserve-${input.nodeId}`,
          workflowExecutionRunId: `run-${input.nodeId}`,
        },
        id: input.nodeId,
        position: { x: 0, y: 0 },
        type: input.kind,
      });
      const failed = boundNode({
        kind: "image",
        nodeId: "image-failed",
        stateLabel: "failed",
        taskId: "task-sweep-failed",
      });
      const cancelled = boundNode({
        kind: "text",
        nodeId: "text-cancelled",
        stateLabel: "cancelled",
        taskId: "task-sweep-cancelled",
      });
      const recoverable = boundNode({
        kind: "image",
        nodeId: "image-recoverable",
        stateLabel: "recoverable",
        taskId: "task-sweep-recoverable",
      });
      const success = boundNode({
        kind: "text",
        nodeId: "text-success",
        stateLabel: "success",
        taskId: "task-sweep-success",
      });
      const running = boundNode({
        kind: "image",
        nodeId: "image-running",
        stateLabel: "running",
        taskId: "task-sweep-running",
      });
      const mismatch = boundNode({
        kind: "text",
        nodeId: "text-mismatch",
        stateLabel: "mismatch",
        taskId: "different-canvas-task",
      });
      const excluded = boundNode({
        kind: "image",
        nodeId: "image-excluded",
        stateLabel: "excluded",
        taskId: "task-sweep-excluded",
      });
      seedUser(dataDirectory, ownerId);
      const ownerCookie = seedAuthenticatedSession(dataDirectory, ownerId);
      seedProject(dataDirectory, canvasId, {
        graphRevision: 9,
        nodes: [failed, cancelled, recoverable, success, running, mismatch],
        revision: 6,
      }, ownerId);
      seedProject(dataDirectory, excludedCanvasId, {
        graphRevision: 4,
        nodes: [excluded],
        revision: 3,
      }, ownerId);
      for (const fixture of [
        { kind: "image" as const, nodeId: "image-failed", state: "failed" as const, taskId: "task-sweep-failed" },
        { kind: "text" as const, nodeId: "text-cancelled", state: "cancelled" as const, taskId: "task-sweep-cancelled" },
        { kind: "image" as const, nodeId: "image-recoverable", state: "failed" as const, taskId: "task-sweep-recoverable" },
        { kind: "text" as const, nodeId: "text-success", state: "success" as const, taskId: "task-sweep-success" },
        { kind: "image" as const, nodeId: "image-running", state: "running" as const, taskId: "task-sweep-running" },
        { kind: "text" as const, nodeId: "text-mismatch", state: "failed" as const, taskId: "task-sweep-mismatch" },
      ]) {
        seedGenerationTask(dataDirectory, { canvasId, ownerId, ...fixture });
      }
      const recoverableStore = databaseAt(dataDirectory);
      try {
        recoverableStore.prepare(`
          UPDATE generation_tasks
          SET provider_task_id = 'provider-task-sweep-recoverable'
          WHERE id = 'task-sweep-recoverable'
        `).run();
        recoverableStore.prepare(`
          UPDATE generation_provider_attempts
          SET outcome = 'accepted',
              provider_task_id = 'provider-task-sweep-recoverable',
              finished_at = NULL
          WHERE task_id = 'task-sweep-recoverable'
        `).run();
      } finally {
        recoverableStore.close();
      }
      seedGenerationTask(dataDirectory, {
        canvasId: excludedCanvasId,
        kind: "image",
        nodeId: "image-excluded",
        ownerId,
        state: "failed",
        taskId: "task-sweep-excluded",
      });
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST =
        JSON.stringify([
          { accountId: ownerId, canvasId },
          { accountId: ownerId, canvasId },
        ]);
      const ledger = () => {
        const store = databaseAt(dataDirectory);
        try {
          return Object.fromEntries([
            "generation_tasks",
            "generation_task_events",
            "generation_admission_events",
            "generation_provider_attempts",
            "media_assets",
            "media_publication_attempts",
          ].map((table) => [
            table,
            store.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
          ]));
        } finally {
          store.close();
        }
      };
      const beforeLedger = ledger();
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "detect";
      expect(await runAllowlistedLegacyTerminalDetachSweep({ dataDirectory }))
        .toEqual({
          canvasesFailed: 0,
          canvasesVisited: 0,
          nodesDetached: 0,
        });
      expect((await api("GET", canvasId, undefined, {
        cookie: ownerCookie,
      })).body).toMatchObject({ graphRevision: 9, revision: 6 });
      expect(ledger()).toEqual(beforeLedger);
      process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE = "allowlist";
      expect(await runAllowlistedLegacyTerminalDetachSweep({ dataDirectory }))
        .toEqual({
          canvasesFailed: 0,
          canvasesVisited: 1,
          nodesDetached: 2,
        });
      const allowed = await api("GET", canvasId, undefined, {
        cookie: ownerCookie,
      });
      expect(allowed.body).toMatchObject({ graphRevision: 10, revision: 7 });
      const allowedNodes = allowed.body.nodes as Array<{
        data: Record<string, unknown>;
        id: string;
      }>;
      for (const [nodeId, kind] of [
        ["image-failed", "image"],
        ["text-cancelled", "text"],
      ] as const) {
        const data = allowedNodes.find((node) => node.id === nodeId)?.data;
        expect(data).toMatchObject({
          [`${kind}Generating`]: false,
          label: kind === "image" ? "failed" : "cancelled",
          userField: `preserve-${nodeId}`,
        });
        expect(data?.workflowExecutionRunId).toBeUndefined();
        expect(data?.[`${kind}GenerationTaskId`]).toBeUndefined();
        expect(data?.[`${kind}GenerationOwnershipKey`]).toBeUndefined();
        expect(data?.[`${kind}GenerationInputKey`]).toBeUndefined();
        expect(data?.legacyTerminalDetachApplicationId).toEqual(
          expect.stringMatching(/^legacy-terminal-detach:/),
        );
      }
      expect(allowedNodes.find((node) => node.id === "text-success")).toEqual(success);
      expect(allowedNodes.find((node) => node.id === "image-recoverable"))
        .toEqual(recoverable);
      expect(allowedNodes.find((node) => node.id === "image-running")).toEqual(running);
      expect(allowedNodes.find((node) => node.id === "text-mismatch")).toEqual(mismatch);
      const excludedAfter = await api("GET", excludedCanvasId, undefined, {
        cookie: ownerCookie,
      });
      expect(excludedAfter.body).toMatchObject({
        graphRevision: 4,
        nodes: [excluded],
        revision: 3,
      });
      expect(ledger()).toEqual(beforeLedger);

      expect(await runAllowlistedLegacyTerminalDetachSweep({ dataDirectory }))
        .toEqual({
          canvasesFailed: 0,
          canvasesVisited: 1,
          nodesDetached: 0,
        });
      expect((await api("GET", canvasId, undefined, {
        cookie: ownerCookie,
      })).body).toMatchObject({ graphRevision: 10, revision: 7 });
      expect(ledger()).toEqual(beforeLedger);
    }, { authBypass: false });
  } finally {
    restoreEnvironment(
      "UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE",
      previousMode,
    );
    restoreEnvironment(
      "UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST",
      previousAllowlist,
    );
  }
});

async function saveWithCurrentBaseline(
  api: Harness["api"],
  canvasId: string,
  body: Record<string, unknown>,
  options?: { cookie?: string; headers?: Record<string, string> },
) {
  const baseline = await api("GET", canvasId, undefined, options);
  return api(
    "PUT",
    canvasId,
    baseline.status === 200
      ? {
          ...body,
          observedLoadToken: loadTokenFrom(baseline),
          observedRevision: baseline.body.revision,
        }
      : body,
    options,
  );
}

test("per-session high-water rejects A3 -> B1 -> A2 while cross-session last writer still wins", async () => {
  await withCanvasServer("canvas-high-water", async ({ api }) => {
    const canvasId = `m85-high-water-${randomUUID()}`;
    const sessionA = "session-a-12345678";
    const sessionB = "session-b-12345678";

    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("A1", 0, sessionA, 1),
    )).status).toBe(200);
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("A3", 1, sessionA, 3),
    )).status).toBe(200);
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("B1", 1, sessionB, 1),
    )).status).toBe(200);

    const lateA2 = await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("A2-must-not-win", 1, sessionA, 2),
    );
    expect(lateA2).toEqual({
      body: {
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: 3,
        currentRevision: 3,
        currentWriterSequence: 1,
        currentWriterSessionId: sessionB,
        error: "Superseded same-session save",
        rejectedAttemptId: null,
        rejectedSequence: 2,
        rejectedSessionId: sessionA,
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 3,
      },
      status: 409,
    });
    expect((await api("GET", canvasId)).body.nodes).toEqual([{ id: "B1" }]);

    const lastA4 = await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("A4-last-writer", 1, sessionA, 4),
    );
    expect(lastA4).toEqual({
      body: {
        graphRevision: 4,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 4,
      },
      status: 200,
    });
    expect((await api("GET", canvasId)).body.nodes).toEqual([
      { id: "A4-last-writer" },
    ]);

    const observedNoSession = await api("PUT", canvasId, {
      edges: [],
      nodes: [{ id: "observed-no-session-last-writer" }],
      observedLoadToken: loadTokenFrom(lastA4),
      observedRevision: lastA4.body.revision,
      revision: 4,
      viewport,
    });
    expect(observedNoSession).toEqual({
      body: {
        graphRevision: 5,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 5,
      },
      status: 200,
    });
    expect(await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("A3-after-legacy-must-not-win", 1, sessionA, 3),
    )).toEqual({
      body: {
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: 5,
        currentRevision: 5,
        currentWriterSequence: 0,
        currentWriterSessionId: null,
        error: "Superseded same-session save",
        rejectedAttemptId: null,
        rejectedSequence: 3,
        rejectedSessionId: sessionA,
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 4,
      },
      status: 409,
    });
    expect((await api("GET", canvasId)).body.nodes).toEqual([
      { id: "observed-no-session-last-writer" },
    ]);
  });
});

test("GET reports owner-scoped writer and TEMP high-water metadata without creating entries", async () => {
  await withCanvasServer("canvas-read-fence-metadata", async ({ api }) => {
    const canvasId = `m85-read-fence-${randomUUID()}`;
    const sessionA = "read-fence-session-a";
    const sessionB = "read-fence-session-b";
    const unknownSession = "read-fence-session-unknown";
    const attemptA1 = randomUUID();
    const attemptA3 = randomUUID();
    const attemptB1 = randomUUID();
    const sessionHeader = (saveSessionId: string) => ({
      headers: { "X-Unboundry-Canvas-Save-Session": saveSessionId },
    });

    const savedA1 = await api(
      "PUT",
      canvasId,
      saveBody("read-fence-A1", 0, sessionA, 1, undefined, undefined, attemptA1),
    );
    expect(savedA1.status).toBe(200);
    const tokenA1 = loadTokenFrom(savedA1);
    const savedA3 = await api(
      "PUT",
      canvasId,
      saveBody("read-fence-A3", 1, sessionA, 3, 1, tokenA1, attemptA3),
    );
    expect(savedA3.status).toBe(200);
    const tokenA3 = loadTokenFrom(savedA3);

    const currentA = await api(
      "GET",
      canvasId,
      undefined,
      sessionHeader(sessionA),
    );
    expect(currentA.body).toMatchObject({
      currentWriterSequence: 3,
      currentWriterSessionId: sessionA,
      saveEpoch: expect.stringMatching(saveEpochPattern),
      sessionHighWaterAttemptId: attemptA3,
      sessionHighWaterSequence: 3,
    });
    const firstEpoch = currentA.body.saveEpoch;

    expect((await api(
      "PUT",
      canvasId,
      saveBody("read-fence-B1", 2, sessionB, 1, 2, tokenA3, attemptB1),
    )).status).toBe(200);

    expect((await api(
      "GET",
      canvasId,
      undefined,
      sessionHeader(sessionA),
    )).body).toMatchObject({
      currentWriterSequence: 1,
      currentWriterSessionId: sessionB,
      saveEpoch: firstEpoch,
      sessionHighWaterAttemptId: attemptA3,
      sessionHighWaterSequence: 3,
    });
    expect((await api(
      "GET",
      canvasId,
      undefined,
      sessionHeader(sessionB),
    )).body).toMatchObject({
      currentWriterSequence: 1,
      currentWriterSessionId: sessionB,
      saveEpoch: firstEpoch,
      sessionHighWaterAttemptId: attemptB1,
      sessionHighWaterSequence: 1,
    });

    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: unknownSession,
    })).toBeUndefined();
    expect((await api(
      "GET",
      canvasId,
      undefined,
      sessionHeader(unknownSession),
    )).body).toMatchObject({
      currentWriterSequence: 1,
      currentWriterSessionId: sessionB,
      saveEpoch: firstEpoch,
      sessionHighWaterAttemptId: null,
      sessionHighWaterSequence: 0,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: unknownSession,
    })).toBeUndefined();

    resetCanvasPersistenceConnectionForTests();
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionB,
    })).toBeUndefined();
    const restartedB = await api(
      "GET",
      canvasId,
      undefined,
      sessionHeader(sessionB),
    );
    expect(restartedB.body).toMatchObject({
      currentWriterSequence: 1,
      currentWriterSessionId: sessionB,
      saveEpoch: expect.stringMatching(saveEpochPattern),
      sessionHighWaterAttemptId: null,
      sessionHighWaterSequence: 1,
    });
    expect(restartedB.body.saveEpoch).not.toBe(firstEpoch);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionB,
    })).toBeUndefined();
  });
});

test("same-session duplicate attempts identify the accepted payload after another writer wins", async () => {
  await withCanvasServer("canvas-duplicate-attempt", async ({ api }) => {
    const canvasId = `m85-duplicate-attempt-${randomUUID()}`;
    const sharedSession = "duplicate-shared-session";
    const writerCSession = "duplicate-writer-c-session";
    const attemptA = randomUUID();
    const attemptB = randomUUID();
    const attemptC = randomUUID();

    const savedB = await api(
      "PUT",
      canvasId,
      saveBody("duplicate-B-wins-seq1", 0, sharedSession, 1, undefined, undefined, attemptB),
    );
    expect(savedB.status).toBe(200);
    const tokenB = loadTokenFrom(savedB);
    const savedC = await api(
      "PUT",
      canvasId,
      saveBody("duplicate-C-current", 1, writerCSession, 1, 1, tokenB, attemptC),
    );
    expect(savedC.status).toBe(200);
    const tokenC = loadTokenFrom(savedC);

    expect(await api(
      "PUT",
      canvasId,
      saveBody("duplicate-A-never-saved", 2, sharedSession, 1, 2, tokenC, attemptA),
    )).toEqual({
      body: {
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: 2,
        currentRevision: 2,
        currentWriterSequence: 1,
        currentWriterSessionId: writerCSession,
        error: "Superseded same-session save",
        rejectedAttemptId: attemptA,
        rejectedSequence: 1,
        rejectedSessionId: sharedSession,
        sessionHighWaterAttemptId: attemptB,
        sessionHighWaterSequence: 1,
      },
      status: 409,
    });
    expect((await api("GET", canvasId, undefined, {
      headers: { "X-Unboundry-Canvas-Save-Session": sharedSession },
    })).body).toMatchObject({
      currentWriterSequence: 1,
      currentWriterSessionId: writerCSession,
      nodes: [{ id: "duplicate-C-current" }],
      sessionHighWaterAttemptId: attemptB,
      sessionHighWaterSequence: 1,
    });
  });
});

test("GET returns stable fenced 404 metadata and rejects an invalid save-session header", async () => {
  await withCanvasServer("canvas-read-fence-errors", async ({ api }) => {
    const canvasId = `m85-read-fence-missing-${randomUUID()}`;
    const session = "read-fence-missing-session";
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBeUndefined();
    expect(canvasSaveHighWaterTableExistsForTests()).toBe(false);

    const missing = await api("GET", canvasId, undefined, {
      headers: { "X-Unboundry-Canvas-Save-Session": session },
    });
    expect(missing).toEqual({
      body: {
        code: "CANVAS_NOT_FOUND",
        currentWriterSequence: 0,
        currentWriterSessionId: null,
        error: "Canvas not found",
        saveEpoch: expect.stringMatching(saveEpochPattern),
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 0,
      },
      status: 404,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBeUndefined();
    expect(canvasSaveHighWaterTableExistsForTests()).toBe(false);

    expect(await api("GET", canvasId, undefined, {
      headers: { "X-Unboundry-Canvas-Save-Session": "bad!" },
    })).toEqual({
      body: {
        code: "CANVAS_SAVE_SESSION_INVALID",
        error: "Invalid canvas save session header",
      },
      status: 400,
    });
    expect(await api(
      "PUT",
      canvasId,
      saveBody("invalid-attempt", 0, session, 1, undefined, undefined, "bad!"),
    )).toEqual({
      body: {
        code: "CANVAS_DOCUMENT_INVALID",
        error: "Invalid canvas document",
      },
      status: 400,
    });
    expect(await api("PUT", canvasId, {
      edges: [],
      nodes: [{ id: "orphan-attempt" }],
      revision: 0,
      saveAttemptId: randomUUID(),
      viewport,
    })).toEqual({
      body: {
        code: "CANVAS_DOCUMENT_INVALID",
        error: "Invalid canvas document",
      },
      status: 400,
    });
  });
});

test("canvas methods expose the real auth-gate 401 and mutation-origin 403 contracts", async () => {
  await withCanvasServer(
    "canvas-delete-auth-contract",
    async ({ api }) => {
      const canvasId = `m85-delete-auth-${randomUUID()}`;
      expect(await api("GET", canvasId)).toEqual({
        body: { error: "请先登录" },
        status: 401,
      });
      const putBody = saveBody(
        "auth-gate-must-not-save",
        0,
        "auth-gate-save-session",
        1,
      );
      expect(await api("PUT", canvasId, putBody)).toEqual({
        body: { error: "请先登录" },
        status: 401,
      });
      expect(await api("PUT", canvasId, putBody, {
        headers: { Origin: "https://invalid.example" },
      })).toEqual({
        body: { error: "请求来源无效" },
        status: 403,
      });
      expect(await api("DELETE", canvasId)).toEqual({
        body: { error: "请先登录" },
        status: 401,
      });
      expect(await api("DELETE", canvasId, undefined, {
        headers: { Origin: "https://invalid.example" },
      })).toEqual({
        body: { error: "请求来源无效" },
        status: 403,
      });
    },
    { authBypass: false },
  );
});

test("seq3 commits while seq2 is deterministically paused before BEGIN and seq2 is then rejected", async () => {
  await withCanvasServer("canvas-sequence-window", async ({ api }) => {
    const canvasId = `m85-sequence-window-${randomUUID()}`;
    const session = "sequence-window-session";
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("window-seq1", 0, session, 1),
    )).status).toBe(200);

    let markSequence2Waiting = () => {};
    let releaseSequence2 = () => {};
    const sequence2Waiting = new Promise<void>((resolve) => {
      markSequence2Waiting = resolve;
    });
    const sequence2Released = new Promise<void>((resolve) => {
      releaseSequence2 = resolve;
    });
    setCanvasPersistenceBarriersForTests({
      beforeTransaction: async ({ canvasId: pendingId, saveSequence }) => {
        if (pendingId !== canvasId || saveSequence !== 2) return;
        markSequence2Waiting();
        await sequence2Released;
      },
    });

    const pendingSequence2 = saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("window-seq2-must-not-win", 1, session, 2),
    );
    await sequence2Waiting;
    try {
      expect(await saveWithCurrentBaseline(
        api,
        canvasId,
        saveBody("window-seq3", 1, session, 3),
      )).toEqual({
        body: {
          graphRevision: 2,
          loadToken: expect.stringMatching(loadTokenPattern),
          revision: 2,
        },
        status: 200,
      });
    } finally {
      releaseSequence2();
    }

    expect(await pendingSequence2).toEqual({
      body: {
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: 2,
        currentRevision: 2,
        currentWriterSequence: 3,
        currentWriterSessionId: session,
        error: "Superseded same-session save",
        rejectedAttemptId: null,
        rejectedSequence: 2,
        rejectedSessionId: session,
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 3,
      },
      status: 409,
    });
    expect((await api("GET", canvasId)).body.nodes).toEqual([
      { id: "window-seq3" },
    ]);
  });
});

test("restart-empty TEMP hands persistent A3 to B1 before rejecting late A2", async () => {
  await withCanvasServer("canvas-restart-session-handoff", async ({ api }) => {
    const canvasId = `m85-restart-session-${randomUUID()}`;
    const sessionA = "restart-session-a";
    const sessionB = "restart-session-b";
    const sessionC = "restart-session-c";
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("restart-A1", 0, sessionA, 1),
    )).status).toBe(200);
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("restart-A3", 1, sessionA, 3),
    )).status).toBe(200);

    resetCanvasPersistenceConnectionForTests();
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBeUndefined();
    setCanvasPersistenceBarriersForTests({
      globalHighWaterLimit: 2,
      ownerHighWaterLimit: 2,
    });

    expect(await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("restart-B1", 1, sessionB, 1),
    )).toEqual({
      body: {
        graphRevision: 3,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 3,
      },
      status: 200,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBe(3);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionB,
    })).toBe(1);
    expect(await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("restart-C1-capacity", 1, sessionC, 1),
    )).toEqual({
      body: {
        code: "CANVAS_SAVE_SESSION_CAPACITY",
        error: "Canvas save session capacity reached",
      },
      status: 503,
    });

    expect(await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("restart-A2-must-not-win", 1, sessionA, 2),
    )).toEqual({
      body: {
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: 3,
        currentRevision: 3,
        currentWriterSequence: 1,
        currentWriterSessionId: sessionB,
        error: "Superseded same-session save",
        rejectedAttemptId: null,
        rejectedSequence: 2,
        rejectedSessionId: sessionA,
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 3,
      },
      status: 409,
    });
    expect((await api("GET", canvasId)).body.nodes).toEqual([
      { id: "restart-B1" },
    ]);
  });
});

test("load tokens are bound to one canvas and claimed revision", async () => {
  await withCanvasServer("canvas-load-token-scope", async ({ api, dataDirectory }) => {
    const sourceId = `m85-token-source-${randomUUID()}`;
    const targetId = `m85-token-target-${randomUUID()}`;
    seedProject(dataDirectory, sourceId, {
      graphRevision: 0,
      revision: 0,
      saveSequence: 0,
      saveSessionId: null,
    });
    seedProject(dataDirectory, targetId, {
      graphRevision: 0,
      revision: 0,
      saveSequence: 0,
      saveSessionId: null,
    });

    const sourceToken = loadTokenFrom(await api("GET", sourceId));
    const targetToken = loadTokenFrom(await api("GET", targetId));
    expect(targetToken).not.toBe(sourceToken);

    expect(await api(
      "PUT",
      targetId,
      saveBody(
        "wrong-canvas-token-must-not-win",
        0,
        "token-scope-session",
        1,
        0,
        sourceToken,
      ),
    )).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });
    expect(await api(
      "PUT",
      targetId,
      saveBody(
        "tampered-revision-must-not-win",
        0,
        "token-scope-session",
        1,
        1,
        targetToken,
      ),
    )).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });
    expect((await api("GET", targetId)).body.nodes).toEqual([{ id: "before" }]);

    const accepted = await api(
      "PUT",
      targetId,
      saveBody(
        "correct-target-baseline",
        0,
        "token-scope-session",
        1,
        0,
        targetToken,
      ),
    );
    expect(accepted).toEqual({
      body: {
        graphRevision: 1,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 1,
      },
      status: 200,
    });
    expect(loadTokenFrom(accepted)).not.toBe(targetToken);
  });
});

test("load tokens are bound to the authenticated owner even for default canvases", async () => {
  await withCanvasServer(
    "canvas-load-token-owner",
    async ({ api, dataDirectory }) => {
      const ownerA = "m85-owner-a";
      const ownerB = "m85-owner-b";
      seedProject(dataDirectory, "default", {
        graphRevision: 0,
        revision: 0,
        saveSequence: 0,
        saveSessionId: null,
      }, ownerA);
      seedProject(dataDirectory, "default", {
        graphRevision: 0,
        revision: 0,
        saveSequence: 0,
        saveSessionId: null,
      }, ownerB);
      const ownerACookie = seedAuthenticatedSession(dataDirectory, ownerA);
      const ownerBCookie = seedAuthenticatedSession(dataDirectory, ownerB);

      const ownerAToken = loadTokenFrom(
        await api("GET", "default", undefined, { cookie: ownerACookie }),
      );
      expect(await api(
        "PUT",
        "default",
        saveBody(
          "owner-a-token-must-not-write-owner-b",
          0,
          "owner-scope-session",
          1,
          0,
          ownerAToken,
        ),
        { cookie: ownerBCookie },
      )).toEqual({
        body: {
          code: "CANVAS_LOAD_REQUIRED",
          error: "Canvas must be loaded successfully before saving",
        },
        status: 409,
      });
      expect((await api(
        "GET",
        "default",
        undefined,
        { cookie: ownerBCookie },
      )).body.nodes).toEqual([{ id: "before" }]);

      const ownerBLoad = await api(
        "GET",
        "default",
        undefined,
        { cookie: ownerBCookie },
      );
      const ownerBToken = loadTokenFrom(ownerBLoad);
      expect(ownerBToken).not.toBe(ownerAToken);
      expect((await api(
        "PUT",
        "default",
        saveBody(
          "owner-b-correct-baseline",
          0,
          "owner-scope-session",
          1,
          0,
          ownerBToken,
        ),
        { cookie: ownerBCookie },
      )).status).toBe(200);

      expect((await api(
        "GET",
        "default",
        undefined,
        {
          cookie: ownerACookie,
          headers: {
            "X-Unboundry-Canvas-Save-Session": "owner-scope-session",
          },
        },
      )).body).toMatchObject({
        currentWriterSequence: 0,
        currentWriterSessionId: null,
        nodes: [{ id: "before" }],
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 0,
      });
      expect((await api(
        "GET",
        "default",
        undefined,
        {
          cookie: ownerBCookie,
          headers: {
            "X-Unboundry-Canvas-Save-Session": "owner-scope-session",
          },
        },
      )).body).toMatchObject({
        currentWriterSequence: 1,
        currentWriterSessionId: "owner-scope-session",
        nodes: [{ id: "owner-b-correct-baseline" }],
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 1,
      });
    },
    { authBypass: false },
  );
});

test("an older issued baseline on the same canvas still permits DATA-005 last-writer-wins", async () => {
  await withCanvasServer("canvas-old-baseline-lww", async ({ api, dataDirectory }) => {
    const canvasId = `m85-old-baseline-${randomUUID()}`;
    seedProject(dataDirectory, canvasId);
    const oldBaseline = await api("GET", canvasId);
    expect(oldBaseline.body.revision).toBe(1);
    const oldToken = loadTokenFrom(oldBaseline);

    const writerB = await api(
      "PUT",
      canvasId,
      saveBody("writer-B", 1, "old-baseline-session-b", 1, 1, oldToken),
    );
    expect(writerB.status).toBe(200);
    expect(writerB.body.revision).toBe(2);

    const writerA = await api(
      "PUT",
      canvasId,
      saveBody("writer-A-last", 1, "old-baseline-session-a", 1, 1, oldToken),
    );
    expect(writerA).toEqual({
      body: {
        graphRevision: 3,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 3,
      },
      status: 200,
    });
    expect((await api("GET", canvasId)).body.nodes).toEqual([
      { id: "writer-A-last" },
    ]);
  });

  await withCanvasServer("canvas-generation-projection-cas", async ({ api, dataDirectory }) => {
    const canvasId = `m85-projection-cas-${randomUUID()}`;
    const inputFingerprint = JSON.stringify({
      inputs: [],
      modelId: "model-a",
      parameters: {},
      prompt: "测试长提示词".repeat(180),
    });
    expect(inputFingerprint.length).toBeGreaterThan(512);
    expect(inputFingerprint.length).toBeLessThanOrEqual(100_000);
    const boundNode = {
      data: {
        label: "文案",
        textGenerationInputKey: inputFingerprint,
        textGenerationOwnershipKey: "owner-a",
        textGenerationTaskId: "task-a",
        textPrompt: "old prompt",
        workflowExecutionRunId: "run-a",
      },
      id: "text-a",
      position: { x: 0, y: 0 },
      type: "text",
    };
    seedProject(dataDirectory, canvasId, { nodes: [boundNode] });
    const staleProjectionBaseline = await api("GET", canvasId);
    const staleToken = loadTokenFrom(staleProjectionBaseline);

    const editedNode = {
      ...boundNode,
      data: {
        ...boundNode.data,
        label: "另一标签修改的标题",
        userField: "preserve concurrent edit",
      },
    };
    expect((await api("PUT", canvasId, {
      edges: [],
      nodes: [editedNode],
      observedLoadToken: staleToken,
      observedRevision: 1,
      revision: 1,
      saveSequence: 1,
      saveSessionId: "semantic-writer-session",
      viewport,
    })).status).toBe(200);

    const resultKey = "result-a";
    const projectionBase = {
      inputFingerprint,
      kind: "text" as const,
      nodeId: "text-a",
      ownershipKey: "owner-a",
      resultKey,
      runId: "run-a",
      taskId: "task-a",
    };
    const projection = {
      accountId: "__test__",
      applicationId: groupResultProjectionApplicationId(projectionBase),
      ...projectionBase,
      semanticRevision: groupResultSemanticRevision(projectionBase),
    };
    const oversizedProjectionBase = {
      ...projectionBase,
      inputFingerprint: "x".repeat(100_001),
    };
    expect(await api("PUT", canvasId, {
      edges: [],
      generationProjection: {
        ...projection,
        inputFingerprint: oversizedProjectionBase.inputFingerprint,
        semanticRevision: groupResultSemanticRevision(oversizedProjectionBase),
      },
      nodes: [boundNode],
      observedLoadToken: staleToken,
      observedRevision: 1,
      revision: 1,
      saveSequence: 1,
      saveSessionId: "oversized-projection-session",
      viewport,
    })).toMatchObject({
      body: { code: "CANVAS_DOCUMENT_INVALID" },
      status: 400,
    });
    expect(await api("PUT", canvasId, {
      edges: [],
      generationProjection: projection,
      nodes: [{
        ...boundNode,
        data: {
          ...boundNode.data,
          content: "old result must not overwrite",
          contentHtml: "<p>old result must not overwrite</p>",
          groupRunSuccessOwnershipKey: "owner-a",
          groupRunSuccessResultKey: resultKey,
          groupRunSuccessTaskId: "task-a",
        },
      }],
      observedLoadToken: staleToken,
      observedRevision: 1,
      revision: 1,
      saveSequence: 1,
      saveSessionId: "projection-writer-session",
      viewport,
    })).toEqual({
      body: {
        code: "CANVAS_GENERATION_PROJECTION_CONFLICT",
        error: "Generation result projection no longer matches the current node",
      },
      status: 409,
    });
    const freshProjectionBaseline = await api("GET", canvasId);
    expect(freshProjectionBaseline.body.nodes).toEqual([editedNode]);
    expect(await api("PUT", canvasId, {
      edges: [],
      generationProjection: projection,
      nodes: [{
        ...editedNode,
        data: {
          ...editedNode.data,
          content: "fresh result",
          contentHtml: "<p>fresh result</p>",
          groupRunSuccessOwnershipKey: "owner-a",
          groupRunSuccessResultKey: resultKey,
          groupRunSuccessTaskId: "task-a",
        },
      }],
      observedLoadToken: loadTokenFrom(freshProjectionBaseline),
      observedRevision: 2,
      revision: 2,
      saveSequence: 1,
      saveSessionId: "fresh-projection-session",
      viewport,
    })).toMatchObject({ body: { revision: 3 }, status: 200 });
    expect((await api("GET", canvasId)).body.nodes).toEqual([{
      ...editedNode,
      data: {
        ...editedNode.data,
        content: "fresh result",
        contentHtml: "<p>fresh result</p>",
        groupRunSuccessOwnershipKey: "owner-a",
        groupRunSuccessResultKey: resultKey,
        groupRunSuccessTaskId: "task-a",
      },
    }]);
  });
});

test("observed revision and load token must be supplied together", async () => {
  await withCanvasServer("canvas-observed-pair", async ({ api }) => {
    const canvasId = `m85-observed-pair-${randomUUID()}`;
    const base = saveBody("invalid-observed-pair", 0, "observed-pair-session", 1);
    expect(await api("PUT", canvasId, {
      ...base,
      observedRevision: 0,
    })).toEqual({
      body: {
        code: "CANVAS_DOCUMENT_INVALID",
        error: "Invalid canvas document",
      },
      status: 400,
    });
    expect(await api("PUT", canvasId, {
      ...base,
      observedLoadToken: `v1.${"A".repeat(43)}`,
    })).toEqual({
      body: {
        code: "CANVAS_DOCUMENT_INVALID",
        error: "Invalid canvas document",
      },
      status: 400,
    });
    expect((await api("GET", canvasId)).status).toBe(404);
  });
});

test("every existing-canvas save needs a valid load baseline while creation remains compatible", async () => {
  await withCanvasServer("canvas-candidate-baseline", async ({ api, dataDirectory }) => {
    const existingId = `m85-candidate-existing-${randomUUID()}`;
    const createdId = `m85-candidate-created-${randomUUID()}`;
    const session = "candidate-baseline-session";
    const rejectedAttempt = randomUUID();
    const validAttempt = randomUUID();
    const createAttempt = randomUUID();
    const { updatedAt } = seedProject(dataDirectory, existingId);

    expect(await api(
      "PUT",
      existingId,
      saveBody(
        "candidate-without-baseline-must-not-win",
        1,
        session,
        1,
        undefined,
        undefined,
        rejectedAttempt,
      ),
    )).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });
    expect(canvasSaveHighWaterTableExistsForTests()).toBe(false);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId: existingId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBeUndefined();
    const afterRejected = databaseAt(dataDirectory);
    try {
      expect(afterRejected.prepare(`
        SELECT revision, graph_revision, nodes, save_session_id, save_sequence
        FROM canvas_documents
        WHERE owner_id = '__test__' AND id = ?
      `).get(existingId)).toEqual({
        graph_revision: 1,
        nodes: JSON.stringify([{ id: "before" }]),
        revision: 1,
        save_sequence: 0,
        save_session_id: null,
      });
      expect(afterRejected.prepare(`
        SELECT updated_at FROM project_metadata
        WHERE owner_id = '__test__' AND id = ?
      `).get(existingId)).toEqual({ updated_at: updatedAt });
    } finally {
      afterRejected.close();
    }

    const loaded = await api("GET", existingId);
    expect(loaded.body).toMatchObject({
      nodes: [{ id: "before" }],
      revision: 1,
    });
    const loadToken = loadTokenFrom(loaded);
    expect(canvasSaveHighWaterTableExistsForTests()).toBe(false);
    expect(await api(
      "PUT",
      existingId,
      saveBody(
        "candidate-with-valid-baseline",
        1,
        session,
        1,
        1,
        loadToken,
        validAttempt,
      ),
    )).toEqual({
      body: {
        graphRevision: 2,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 2,
      },
      status: 200,
    });

    expect(await api(
      "PUT",
      existingId,
      saveBody("v0.5.1-without-attempt", 2, session, 2),
    )).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });
    expect((await api("GET", existingId)).body).toMatchObject({
      graphRevision: 2,
      nodes: [{ id: "candidate-with-valid-baseline" }],
      revision: 2,
    });
    expect(await api(
      "PUT",
      createdId,
      saveBody(
        "candidate-creates-confirmed-missing-canvas",
        0,
        "candidate-create-session",
        1,
        undefined,
        undefined,
        createAttempt,
      ),
    )).toEqual({
      body: {
        graphRevision: 1,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 1,
      },
      status: 200,
    });
  });
});

test("direct canvas deletion clears only its owner/canvas high-water", async () => {
  await withCanvasServer("canvas-delete-high-water", async ({ api }) => {
    const canvasId = `m85-delete-high-water-${randomUUID()}`;
    const otherCanvasId = `m85-delete-high-water-other-${randomUUID()}`;
    const session = "delete-high-water-session";
    const otherSession = "delete-high-water-other-session";
    expect((await api(
      "PUT",
      canvasId,
      saveBody("before-direct-delete", 0, session, 1),
    )).status).toBe(200);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBe(1);
    expect((await api(
      "PUT",
      otherCanvasId,
      saveBody("other-canvas", 0, otherSession, 1),
    )).status).toBe(200);

    expect((await api("DELETE", canvasId)).status).toBe(204);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBeUndefined();
    expect(canvasSaveSessionHighWaterForTests({
      canvasId: otherCanvasId,
      ownerId: "__test__",
      saveSessionId: otherSession,
    })).toBe(1);
    expect((await api(
      "PUT",
      canvasId,
      saveBody("after-direct-delete", 0, session, 1),
    )).status).toBe(200);
  });
});

test("a scoped process-epoch load token rejects A2 after A3 -> B1 -> restart until a fresh GET", async () => {
  await withCanvasServer("canvas-restart-load-token", async ({ api }) => {
    const canvasId = `m85-restart-load-token-${randomUUID()}`;
    const sessionA = "load-token-session-a";
    const sessionB = "load-token-session-b";

    expect((await api(
      "PUT",
      canvasId,
      saveBody("load-token-A1", 0, sessionA, 1),
    )).status).toBe(200);
    const firstLoad = await api("GET", canvasId);
    expect(firstLoad.body.revision).toBe(1);
    const firstLoadToken = loadTokenFrom(firstLoad);

    const savedA3 = await api(
      "PUT",
      canvasId,
      saveBody("load-token-A3", 1, sessionA, 3, 1, firstLoadToken),
    );
    expect(savedA3).toEqual({
      body: {
        graphRevision: 2,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 2,
      },
      status: 200,
    });
    const a3LoadToken = loadTokenFrom(savedA3);
    expect(a3LoadToken).not.toBe(firstLoadToken);
    const savedB1 = await api(
      "PUT",
      canvasId,
      saveBody("load-token-B1", 1, sessionB, 1, 2, a3LoadToken),
    );
    expect(savedB1).toEqual({
      body: {
        graphRevision: 3,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 3,
      },
      status: 200,
    });
    expect(loadTokenFrom(savedB1)).not.toBe(a3LoadToken);

    resetCanvasPersistenceConnectionForTests();
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBeUndefined();
    const lateA2 = await api(
      "PUT",
      canvasId,
      saveBody(
        "load-token-A2-must-not-win",
        1,
        sessionA,
        2,
        1,
        firstLoadToken,
      ),
    );
    expect(lateA2).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });
    // The rejected old-epoch request must also roll back its attempted
    // persistent-writer handoff into the fresh TEMP table.
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionB,
    })).toBeUndefined();

    const freshLoad = await api("GET", canvasId);
    expect(freshLoad.body).toMatchObject({
      graphRevision: 3,
      nodes: [{ id: "load-token-B1" }],
      revision: 3,
    });
    const freshLoadToken = loadTokenFrom(freshLoad);
    expect(freshLoadToken).not.toBe(firstLoadToken);

    const savedA4 = await api(
      "PUT",
      canvasId,
      saveBody("load-token-A4", 1, sessionA, 4, 3, freshLoadToken),
    );
    expect(savedA4).toEqual({
      body: {
        graphRevision: 4,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 4,
      },
      status: 200,
    });
    expect(loadTokenFrom(savedA4)).not.toBe(freshLoadToken);
    expect((await api("GET", canvasId)).body.nodes).toEqual([
      { id: "load-token-A4" },
    ]);
  });
});

test("restart fail-closes legacy A2 after persisted A3 -> B1 state loses its TEMP high-water", async () => {
  await withCanvasServer("canvas-restart-legacy-fail-closed", async ({ api, dataDirectory }) => {
    const canvasId = `m85-restart-legacy-${randomUUID()}`;
    const sessionA = "restart-legacy-session-a";
    const sessionB = "restart-legacy-session-b";
    // Reconstruct the exact old-server state after accepted legacy A3 then
    // cross-session legacy B1: A's seq3 fence is connection-local while B1 is
    // the only durable writer. The reset below is the vulnerable boundary.
    seedProject(dataDirectory, canvasId, {
      graphRevision: 3,
      nodes: [{ id: "legacy-restart-B1" }],
      revision: 3,
      saveSequence: 1,
      saveSessionId: sessionB,
    });
    expect(reserveCanvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSequence: 3,
      saveSessionId: sessionA,
    })).toBe(true);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBe(3);

    resetCanvasPersistenceConnectionForTests();
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBeUndefined();

    const beforeRejected = databaseAt(dataDirectory);
    let durableRowBefore: unknown;
    let projectRecencyBefore: unknown;
    try {
      durableRowBefore = beforeRejected.prepare(`
        SELECT revision, graph_revision, nodes, edges, viewport, updated_at,
               save_session_id, save_sequence
        FROM canvas_documents
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId);
      projectRecencyBefore = beforeRejected.prepare(`
        SELECT updated_at FROM project_metadata
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId);
    } finally {
      beforeRejected.close();
    }

    expect(await api(
      "PUT",
      canvasId,
      saveBody("legacy-restart-A2-must-not-win", 1, sessionA, 2),
    )).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionB,
    })).toBeUndefined();
    const afterRejected = databaseAt(dataDirectory);
    try {
      expect(afterRejected.prepare(`
        SELECT revision, graph_revision, nodes, edges, viewport, updated_at,
               save_session_id, save_sequence
        FROM canvas_documents
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toEqual(durableRowBefore);
      expect(afterRejected.prepare(`
        SELECT updated_at FROM project_metadata
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toEqual(projectRecencyBefore);
    } finally {
      afterRejected.close();
    }
    expect((await api("GET", canvasId)).body).toMatchObject({
      currentWriterSequence: 1,
      currentWriterSessionId: sessionB,
      graphRevision: 3,
      nodes: [{ id: "legacy-restart-B1" }],
      revision: 3,
    });
  });
});

test("one TEMP slot cannot partially retain a durable writer when the incoming session has no slot", async () => {
  await withCanvasServer("canvas-single-slot-rollback", async ({ api, dataDirectory }) => {
    const canvasId = `m85-single-slot-${randomUUID()}`;
    const sessionA = "single-slot-session-a";
    const sessionB = "single-slot-session-b";
    const { updatedAt } = seedProject(dataDirectory, canvasId, {
      saveSequence: 3,
      saveSessionId: sessionA,
    });
    setCanvasPersistenceBarriersForTests({
      globalHighWaterLimit: 1,
      ownerHighWaterLimit: 1,
    });

    expect(await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("single-slot-B1-must-not-partially-win", 1, sessionB, 1),
    )).toEqual({
      body: {
        code: "CANVAS_SAVE_SESSION_CAPACITY",
        error: "Canvas save session capacity reached",
      },
      status: 503,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBeUndefined();
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionB,
    })).toBeUndefined();
    expect((await api("GET", canvasId)).body).toMatchObject({
      currentWriterSequence: 3,
      currentWriterSessionId: sessionA,
      nodes: [{ id: "before" }],
      revision: 1,
    });
    const afterRejected = databaseAt(dataDirectory);
    try {
      expect(afterRejected.prepare(`
        SELECT updated_at FROM project_metadata
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toEqual({ updated_at: updatedAt });
    } finally {
      afterRejected.close();
    }

    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("single-slot-A4", 1, sessionA, 4),
    )).status).toBe(200);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBe(4);
  });
});

test("100 deterministic cross-session save orderings preserve every session high-water without sleeps", async () => {
  await withCanvasServer("canvas-interleaving-matrix", async ({ api }) => {
    const canvasId = `m85-interleaving-${randomUUID()}`;
    const sessions = [
      "matrix-session-a",
      "matrix-session-b",
      "matrix-session-c",
      "matrix-session-d",
    ];
    const shuffledSequences = sessions.map((_, sessionIndex) => {
      const values = Array.from({ length: 25 }, (_unused, index) => index + 1);
      let state = 0x6d2b79f5 ^ ((sessionIndex + 1) * 0x9e3779b9);
      for (let index = values.length - 1; index > 0; index -= 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const swapIndex = (state >>> 0) % (index + 1);
        [values[index], values[swapIndex]] = [
          values[swapIndex],
          values[index],
        ];
      }
      return values;
    });
    const highWater = new Map<string, number>();
    let expectedGraphRevision = 0;
    let expectedRevision = 0;
    let expectedNodeId = "";
    let expectedWriterSequence = 0;
    let expectedWriterSession: string | null = null;

    for (let caseIndex = 0; caseIndex < 100; caseIndex += 1) {
      const sessionIndex = caseIndex % sessions.length;
      const position = Math.floor(caseIndex / sessions.length);
      const session = sessions[sessionIndex];
      const sequence = shuffledSequences[sessionIndex][position];
      const nodeId = `case-${caseIndex}-${sessionIndex}-${sequence}`;
      const previousHighWater = highWater.get(session) ?? 0;
      const result = await saveWithCurrentBaseline(
        api,
        canvasId,
        saveBody(
          nodeId,
          expectedRevision === 0 ? 0 : 1,
          session,
          sequence,
        ),
      );
      if (sequence <= previousHighWater) {
        expect(result.status, `interleaving case ${caseIndex}`).toBe(409);
        expect(result.body).toMatchObject({
          code: "CANVAS_SAVE_SUPERSEDED",
          currentGraphRevision: expectedGraphRevision,
          currentRevision: expectedRevision,
          currentWriterSequence: expectedWriterSequence,
          currentWriterSessionId: expectedWriterSession,
          rejectedAttemptId: null,
          rejectedSequence: sequence,
          rejectedSessionId: session,
          sessionHighWaterAttemptId: null,
          sessionHighWaterSequence: previousHighWater,
        });
        expect(Object.hasOwn(result.body, "revision")).toBe(false);
        expect(Object.hasOwn(result.body, "saveSessionId")).toBe(false);
      } else {
        highWater.set(session, sequence);
        expectedRevision += 1;
        expectedGraphRevision += 1;
        expectedNodeId = nodeId;
        expectedWriterSequence = sequence;
        expectedWriterSession = session;
        expect(result, `interleaving case ${caseIndex}`).toEqual({
          body: {
            graphRevision: expectedGraphRevision,
            loadToken: expect.stringMatching(loadTokenPattern),
            revision: expectedRevision,
          },
          status: 200,
        });
      }
    }

    const stored = await api("GET", canvasId);
    expect(stored.status).toBe(200);
    expect(stored.body).toMatchObject({
      graphRevision: expectedGraphRevision,
      nodes: [{ id: expectedNodeId }],
      revision: expectedRevision,
    });
    for (const session of sessions) {
      expect(canvasSaveSessionHighWaterForTests({
        canvasId,
        ownerId: "__test__",
        saveSessionId: session,
      })).toBe(highWater.get(session));
    }
  });
});

test("the bounded TEMP high-water table rejects new sessions without evicting existing sessions", async () => {
  await withCanvasServer("canvas-high-water-cap", async ({ api }) => {
    const canvasId = `m85-high-water-cap-${randomUUID()}`;
    const sessionA = "capacity-session-a";
    const sessionB = "capacity-session-b";
    const sessionC = "capacity-session-c";
    setCanvasPersistenceBarriersForTests({
      globalHighWaterLimit: 2,
      ownerHighWaterLimit: 2,
    });

    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("capacity-A1", 0, sessionA, 1),
    )).status).toBe(200);
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("capacity-B1", 1, sessionB, 1),
    )).status).toBe(200);
    expect(await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("capacity-C1", 1, sessionC, 1),
    )).toEqual({
      body: {
        code: "CANVAS_SAVE_SESSION_CAPACITY",
        error: "Canvas save session capacity reached",
      },
      status: 503,
    });

    expect(await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("capacity-A1-stale", 1, sessionA, 1),
    )).toEqual({
      body: {
        code: "CANVAS_SAVE_SUPERSEDED",
        currentGraphRevision: 2,
        currentRevision: 2,
        currentWriterSequence: 1,
        currentWriterSessionId: sessionB,
        error: "Superseded same-session save",
        rejectedAttemptId: null,
        rejectedSequence: 1,
        rejectedSessionId: sessionA,
        sessionHighWaterAttemptId: null,
        sessionHighWaterSequence: 1,
      },
      status: 409,
    });
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("capacity-A2", 1, sessionA, 2),
    )).status).toBe(200);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionA,
    })).toBe(2);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionB,
    })).toBe(1);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: sessionC,
    })).toBeUndefined();
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("capacity-C1-retry", 1, sessionC, 1),
    )).status).toBe(503);
  });
});

test("per-owner TEMP quotas isolate owners while the global cap remains hard", async () => {
  await withCanvasServer("canvas-owner-cap", async ({ dataDirectory }) => {
    for (const ownerId of ["owner-cap-a", "owner-cap-b", "owner-cap-c"]) {
      seedUser(dataDirectory, ownerId);
    }
    setCanvasPersistenceBarriersForTests({
      globalHighWaterLimit: 4,
      ownerHighWaterLimit: 2,
    });
    const reserve = (ownerId: string, sessionIndex: number) =>
      reserveCanvasSaveSessionHighWaterForTests({
        canvasId: `owner-cap-canvas-${sessionIndex}`,
        ownerId,
        saveSequence: sessionIndex + 1,
        saveSessionId: `owner-cap-session-${sessionIndex}`,
      });

    expect(reserve("owner-cap-a", 0)).toBe(true);
    expect(reserve("owner-cap-a", 1)).toBe(true);
    expect(reserve("owner-cap-a", 2)).toBe(false);
    // Owner A exhausting its own quota must not consume owner B's quota.
    expect(reserve("owner-cap-b", 0)).toBe(true);
    expect(reserve("owner-cap-b", 1)).toBe(true);
    expect(reserve("owner-cap-b", 2)).toBe(false);
    // Four retained keys now fill the independent global cap.
    expect(reserve("owner-cap-c", 0)).toBe(false);

    for (const ownerId of ["owner-cap-a", "owner-cap-b"]) {
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: "owner-cap-canvas-0",
        ownerId,
        saveSessionId: "owner-cap-session-0",
      })).toBe(1);
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: "owner-cap-canvas-1",
        ownerId,
        saveSessionId: "owner-cap-session-1",
      })).toBe(2);
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: "owner-cap-canvas-2",
        ownerId,
        saveSessionId: "owner-cap-session-2",
      })).toBeUndefined();
    }
  });
});

test("capacity reclamation removes only exact tombstoned project high-waters", async () => {
  await withCanvasServer("canvas-tombstone-capacity", async ({ api, dataDirectory }) => {
    const deletedCanvasId = `m85-cap-deleted-${randomUUID()}`;
    const liveCanvasId = `m85-cap-live-${randomUUID()}`;
    const incomingCanvasId = `m85-cap-incoming-${randomUUID()}`;
    const deletedSession = "tombstone-cap-deleted-session";
    const liveSession = "tombstone-cap-live-session";
    const incomingSession = "tombstone-cap-incoming-session";
    seedProject(dataDirectory, deletedCanvasId);
    seedProject(dataDirectory, liveCanvasId);
    seedProject(dataDirectory, incomingCanvasId);
    setCanvasPersistenceBarriersForTests({
      globalHighWaterLimit: 2,
      ownerHighWaterLimit: 2,
    });
    expect(reserveCanvasSaveSessionHighWaterForTests({
      canvasId: deletedCanvasId,
      ownerId: "__test__",
      saveSequence: 1,
      saveSessionId: deletedSession,
    })).toBe(true);
    expect(reserveCanvasSaveSessionHighWaterForTests({
      canvasId: liveCanvasId,
      ownerId: "__test__",
      saveSequence: 1,
      saveSessionId: liveSession,
    })).toBe(true);

    const deletion = databaseAt(dataDirectory);
    deletion.exec("BEGIN IMMEDIATE");
    try {
      deleteProjectRows(
        deletion,
        "__test__",
        deletedCanvasId,
        1_800_000_000_000,
        false,
      );
      deletion.exec("COMMIT");
    } catch (error) {
      if (deletion.isTransaction) deletion.exec("ROLLBACK");
      throw error;
    } finally {
      deletion.close();
    }
    expect(canvasSaveSessionHighWaterForTests({
      canvasId: deletedCanvasId,
      ownerId: "__test__",
      saveSessionId: deletedSession,
    })).toBe(1);

    expect((await saveWithCurrentBaseline(
      api,
      incomingCanvasId,
      saveBody("capacity-after-tombstone", 1, incomingSession, 1),
    )).status).toBe(200);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId: deletedCanvasId,
      ownerId: "__test__",
      saveSessionId: deletedSession,
    })).toBeUndefined();
    expect(canvasSaveSessionHighWaterForTests({
      canvasId: liveCanvasId,
      ownerId: "__test__",
      saveSessionId: liveSession,
    })).toBe(1);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId: incomingCanvasId,
      ownerId: "__test__",
      saveSessionId: incomingSession,
    })).toBe(1);
    expect((await api("GET", liveCanvasId)).body.nodes).toEqual([{ id: "before" }]);
  });
});

test("capacity reclamation removes a physically deleted account without touching an active account", async () => {
  await withCanvasServer(
    "canvas-deleted-owner-capacity",
    async ({ api, dataDirectory }) => {
      const deletedOwner = `m85-deleted-owner-${randomUUID()}`;
      const liveOwner = `m85-live-owner-${randomUUID()}`;
      const incomingOwner = `m85-incoming-owner-${randomUUID()}`;
      const deletedSession = "deleted-owner-cap-session";
      const liveSession = "live-owner-cap-session";
      const incomingSession = "incoming-owner-cap-session";
      const liveCanvasId = `m85-live-owner-canvas-${randomUUID()}`;
      const incomingCanvasId = `m85-incoming-owner-canvas-${randomUUID()}`;
      seedUser(dataDirectory, deletedOwner);
      seedProject(dataDirectory, liveCanvasId, {}, liveOwner);
      seedProject(dataDirectory, incomingCanvasId, {}, incomingOwner);
      const liveCookie = seedAuthenticatedSession(dataDirectory, liveOwner);
      const incomingCookie = seedAuthenticatedSession(dataDirectory, incomingOwner);
      setCanvasPersistenceBarriersForTests({
        globalHighWaterLimit: 2,
        ownerHighWaterLimit: 2,
      });
      expect(reserveCanvasSaveSessionHighWaterForTests({
        canvasId: "deleted-owner-orphan-canvas",
        ownerId: deletedOwner,
        saveSequence: 1,
        saveSessionId: deletedSession,
      })).toBe(true);
      expect(reserveCanvasSaveSessionHighWaterForTests({
        canvasId: liveCanvasId,
        ownerId: liveOwner,
        saveSequence: 1,
        saveSessionId: liveSession,
      })).toBe(true);

      const deletion = databaseAt(dataDirectory);
      try {
        deletion.exec("PRAGMA foreign_keys = ON");
        expect(deletion.prepare("DELETE FROM users WHERE id = ?").run(deletedOwner).changes)
          .toBe(1);
        expect(deletion.prepare("SELECT 1 FROM users WHERE id = ?").get(deletedOwner))
          .toBeUndefined();
      } finally {
        deletion.close();
      }
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: "deleted-owner-orphan-canvas",
        ownerId: deletedOwner,
        saveSessionId: deletedSession,
      })).toBe(1);

      expect((await saveWithCurrentBaseline(
        api,
        incomingCanvasId,
        saveBody("incoming-after-account-delete", 1, incomingSession, 1),
        { cookie: incomingCookie },
      )).status).toBe(200);
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: "deleted-owner-orphan-canvas",
        ownerId: deletedOwner,
        saveSessionId: deletedSession,
      })).toBeUndefined();
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: liveCanvasId,
        ownerId: liveOwner,
        saveSessionId: liveSession,
      })).toBe(1);
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: incomingCanvasId,
        ownerId: incomingOwner,
        saveSessionId: incomingSession,
      })).toBe(1);
      expect((await api(
        "GET",
        liveCanvasId,
        undefined,
        { cookie: liveCookie },
      )).body.nodes).toEqual([{ id: "before" }]);
    },
    { authBypass: false },
  );
});

test("one-slot deleted-account cleanup and incoming candidate save roll back together on fault", async () => {
  await withCanvasServer(
    "canvas-deleted-owner-rollback",
    async ({ api, dataDirectory }) => {
      const deletedOwner = `m85-fault-deleted-owner-${randomUUID()}`;
      const incomingOwner = `m85-fault-incoming-owner-${randomUUID()}`;
      const deletedSession = "fault-deleted-owner-session";
      const incomingSession = "fault-incoming-owner-session";
      const incomingAttempt = randomUUID();
      const incomingCanvasId = `m85-fault-incoming-canvas-${randomUUID()}`;
      seedUser(dataDirectory, deletedOwner);
      const { updatedAt } = seedProject(
        dataDirectory,
        incomingCanvasId,
        {},
        incomingOwner,
      );
      const incomingCookie = seedAuthenticatedSession(dataDirectory, incomingOwner);
      const baseline = await api(
        "GET",
        incomingCanvasId,
        undefined,
        { cookie: incomingCookie },
      );
      expect(baseline.body.revision).toBe(1);
      const baselineToken = loadTokenFrom(baseline);
      const incomingBody = saveBody(
        "incoming-after-orphan-cleanup",
        1,
        incomingSession,
        1,
        1,
        baselineToken,
        incomingAttempt,
      );
      setCanvasPersistenceBarriersForTests({
        globalHighWaterLimit: 1,
        ownerHighWaterLimit: 1,
      });
      expect(reserveCanvasSaveSessionHighWaterForTests({
        canvasId: "fault-deleted-owner-orphan-canvas",
        ownerId: deletedOwner,
        saveSequence: 1,
        saveSessionId: deletedSession,
      })).toBe(true);

      const deletion = databaseAt(dataDirectory);
      try {
        deletion.exec("PRAGMA foreign_keys = ON");
        expect(deletion.prepare("DELETE FROM users WHERE id = ?").run(deletedOwner).changes)
          .toBe(1);
      } finally {
        deletion.close();
      }
      setCanvasPersistenceBarriersForTests({
        afterUpsert: () => {
          throw new Error("synthetic deleted-owner cleanup fault");
        },
        globalHighWaterLimit: 1,
        ownerHighWaterLimit: 1,
      });

      expect(await api(
        "PUT",
        incomingCanvasId,
        incomingBody,
        { cookie: incomingCookie },
      )).toEqual({
        body: { code: "INTERNAL_ERROR", error: "Internal server error" },
        status: 500,
      });
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: "fault-deleted-owner-orphan-canvas",
        ownerId: deletedOwner,
        saveSessionId: deletedSession,
      })).toBe(1);
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: incomingCanvasId,
        ownerId: incomingOwner,
        saveSessionId: incomingSession,
      })).toBeUndefined();
      const afterFailure = databaseAt(dataDirectory);
      try {
        expect(afterFailure.prepare(`
          SELECT revision, graph_revision, nodes, save_session_id, save_sequence
          FROM canvas_documents
          WHERE owner_id = ? AND id = ?
        `).get(incomingOwner, incomingCanvasId)).toEqual({
          graph_revision: 1,
          nodes: JSON.stringify([{ id: "before" }]),
          revision: 1,
          save_sequence: 0,
          save_session_id: null,
        });
        expect(afterFailure.prepare(`
          SELECT updated_at FROM project_metadata
          WHERE owner_id = ? AND id = ?
        `).get(incomingOwner, incomingCanvasId)).toEqual({ updated_at: updatedAt });
      } finally {
        afterFailure.close();
      }

      setCanvasPersistenceBarriersForTests({
        globalHighWaterLimit: 1,
        ownerHighWaterLimit: 1,
      });
      expect((await api(
        "PUT",
        incomingCanvasId,
        incomingBody,
        { cookie: incomingCookie },
      )).status).toBe(200);
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: "fault-deleted-owner-orphan-canvas",
        ownerId: deletedOwner,
        saveSessionId: deletedSession,
      })).toBeUndefined();
      expect(canvasSaveSessionHighWaterForTests({
        canvasId: incomingCanvasId,
        ownerId: incomingOwner,
        saveSessionId: incomingSession,
      })).toBe(1);
    },
    { authBypass: false },
  );
});

test("revision zero rejects missing, invented and old-epoch load tokens before accepting a fresh GET token", async () => {
  await withCanvasServer("canvas-revision-zero", async ({ api, dataDirectory }) => {
    const canvasId = `m85-revision-zero-${randomUUID()}`;
    seedProject(dataDirectory, canvasId, {
      graphRevision: 0,
      revision: 0,
      saveSequence: 0,
      saveSessionId: null,
    });
    const loaded = await api("GET", canvasId);
    expect(loaded.status).toBe(200);
    expect(loaded.body.revision).toBe(0);
    const firstLoadToken = loadTokenFrom(loaded);

    const blind = await api(
      "PUT",
      canvasId,
      saveBody("blind-must-not-win", 0, "revision-zero-session", 1),
    );
    expect(blind).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });
    expect(Object.hasOwn(blind.body, "revision")).toBe(false);
    expect(Object.hasOwn(blind.body, "graphRevision")).toBe(false);

    const missingToken = await api(
      "PUT",
      canvasId,
      saveBody("loaded-zero", 0, "revision-zero-session", 1, 0),
    );
    expect(missingToken).toEqual({
      body: {
        code: "CANVAS_DOCUMENT_INVALID",
        error: "Invalid canvas document",
      },
      status: 400,
    });

    const inventedToken = await api(
      "PUT",
      canvasId,
      saveBody(
        "invented-token-must-not-win",
        0,
        "revision-zero-session",
        1,
        0,
        randomUUID(),
      ),
    );
    expect(inventedToken).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });

    resetCanvasPersistenceConnectionForTests();
    const oldEpochToken = await api(
      "PUT",
      canvasId,
      saveBody(
        "old-epoch-token-must-not-win",
        0,
        "revision-zero-session",
        1,
        0,
        firstLoadToken,
      ),
    );
    expect(oldEpochToken).toEqual({
      body: {
        code: "CANVAS_LOAD_REQUIRED",
        error: "Canvas must be loaded successfully before saving",
      },
      status: 409,
    });

    const reloaded = await api("GET", canvasId);
    const freshLoadToken = loadTokenFrom(reloaded);
    expect(freshLoadToken).not.toBe(firstLoadToken);
    const observed = await api(
      "PUT",
      canvasId,
      saveBody(
        "loaded-zero",
        0,
        "revision-zero-session",
        1,
        0,
        freshLoadToken,
      ),
    );
    expect(observed).toEqual({
      body: {
        graphRevision: 1,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 1,
      },
      status: 200,
    });
    expect(loadTokenFrom(observed)).not.toBe(freshLoadToken);
    expect((await api("GET", canvasId)).body.nodes).toEqual([
      { id: "loaded-zero" },
    ]);
  });
});

test("a delete committed after body validation is reread under the save transaction and blocks resurrection", async () => {
  await withCanvasServer("canvas-delete-save", async ({ api, dataDirectory }) => {
    const canvasId = `m85-delete-save-${randomUUID()}`;
    const session = "delete-save-session";
    seedProject(dataDirectory, canvasId, {
      saveSequence: 1,
      saveSessionId: session,
    });
    expect((await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("before-delete-seq2", 1, session, 2),
    )).status).toBe(200);
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBe(2);

    let releaseSave = () => {};
    let markBodyValidated = () => {};
    const bodyValidated = new Promise<void>((resolve) => {
      markBodyValidated = resolve;
    });
    const saveReleased = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    setCanvasPersistenceBarriersForTests({
      beforeTransaction: async ({ canvasId: pendingId }) => {
        if (pendingId !== canvasId) return;
        markBodyValidated();
        await saveReleased;
      },
    });

    const pendingSave = saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("must-not-resurrect", 2, session, 3),
    );
    await bodyValidated;
    const deletion = databaseAt(dataDirectory);
    try {
      deletion.exec("BEGIN IMMEDIATE");
      deletion.prepare(`
        UPDATE project_metadata
        SET is_project = 0, deleted_at = ?
        WHERE owner_id = '__test__' AND id = ? AND deleted_at IS NULL
      `).run(Date.now(), canvasId);
      deletion.prepare(`
        DELETE FROM canvas_documents
        WHERE owner_id = '__test__' AND id = ?
      `).run(canvasId);
      deletion.exec("COMMIT");
    } catch (error) {
      if (deletion.isTransaction) deletion.exec("ROLLBACK");
      throw error;
    } finally {
      deletion.close();
      releaseSave();
    }

    expect(await pendingSave).toEqual({
      body: {
        code: "CANVAS_PROJECT_DELETED",
        error: "项目已删除，请返回工作空间",
      },
      status: 409,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBeUndefined();
    const checked = databaseAt(dataDirectory);
    try {
      expect(checked.prepare(`
        SELECT is_project, deleted_at
        FROM project_metadata
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toMatchObject({
        is_project: 0,
        deleted_at: expect.any(Number),
      });
      expect(checked.prepare(`
        SELECT 1 FROM canvas_documents
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toBeUndefined();
    } finally {
      checked.close();
    }
  });
});

test("a post-write fault rolls back canvas, project recency and session high-water together", async () => {
  await withCanvasServer("canvas-rollback", async ({ api, dataDirectory }) => {
    const canvasId = `m85-rollback-${randomUUID()}`;
    const session = "rollback-session-1234";
    const failedAttempt = randomUUID();
    const retryAttempt = randomUUID();
    const { updatedAt } = seedProject(dataDirectory, canvasId, {
      saveSequence: 1,
      saveSessionId: session,
    });
    const baseline = await api("GET", canvasId);
    expect(baseline.body.revision).toBe(1);
    const baselineToken = loadTokenFrom(baseline);
    setCanvasPersistenceBarriersForTests({
      afterUpsert: () => {
        throw new Error("synthetic post-write fault");
      },
    });

    const failed = await api(
      "PUT",
      canvasId,
      saveBody(
        "rolled-back",
        1,
        session,
        2,
        1,
        baselineToken,
        failedAttempt,
      ),
    );
    expect(failed).toEqual({
      body: { code: "INTERNAL_ERROR", error: "Internal server error" },
      status: 500,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBeUndefined();
    expect((await api("GET", canvasId, undefined, {
      headers: { "X-Unboundry-Canvas-Save-Session": session },
    })).body).toMatchObject({
      sessionHighWaterAttemptId: null,
      sessionHighWaterSequence: 1,
    });
    const afterFailure = databaseAt(dataDirectory);
    try {
      expect(afterFailure.prepare(`
        SELECT revision, graph_revision, nodes, save_session_id, save_sequence
        FROM canvas_documents
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toEqual({
        graph_revision: 1,
        nodes: JSON.stringify([{ id: "before" }]),
        revision: 1,
        save_sequence: 1,
        save_session_id: session,
      });
      expect(afterFailure.prepare(`
        SELECT updated_at FROM project_metadata
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toEqual({ updated_at: updatedAt });
    } finally {
      afterFailure.close();
    }

    setCanvasPersistenceBarriersForTests();
    const retried = await api(
      "PUT",
      canvasId,
      saveBody(
        "committed",
        1,
        session,
        2,
        1,
        baselineToken,
        retryAttempt,
      ),
    );
    expect(retried).toEqual({
      body: {
        graphRevision: 2,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 2,
      },
      status: 200,
    });
    expect(canvasSaveSessionHighWaterForTests({
      canvasId,
      ownerId: "__test__",
      saveSessionId: session,
    })).toBe(2);
    expect((await api("GET", canvasId, undefined, {
      headers: { "X-Unboundry-Canvas-Save-Session": session },
    })).body).toMatchObject({
      nodes: [{ id: "committed" }],
      sessionHighWaterAttemptId: retryAttempt,
      sessionHighWaterSequence: 2,
    });
  });
});

test("a SQLite write fault is a structured 500, not a validation 400, and remains retryable", async () => {
  await withCanvasServer("canvas-db-fault", async ({ api, dataDirectory }) => {
    const canvasId = `m85-db-fault-${randomUUID()}`;
    const session = "database-fault-session";
    seedProject(dataDirectory, canvasId, {
      saveSequence: 1,
      saveSessionId: session,
    });
    let faultCount = 0;
    setCanvasPersistenceBarriersForTests({
      afterUpsert: () => {
        faultCount += 1;
        const synthetic = new DatabaseSync(":memory:");
        try {
          synthetic.exec(`
            CREATE TABLE forced_sqlite_fault (value TEXT UNIQUE);
            INSERT INTO forced_sqlite_fault VALUES ('duplicate');
            INSERT INTO forced_sqlite_fault VALUES ('duplicate');
          `);
        } finally {
          synthetic.close();
        }
      },
    });
    try {
      const failed = await saveWithCurrentBaseline(
        api,
        canvasId,
        saveBody("db-fault", 1, session, 2),
      );
      expect(failed).toEqual({
        body: { code: "INTERNAL_ERROR", error: "Internal server error" },
        status: 500,
      });
    } finally {
      setCanvasPersistenceBarriersForTests();
    }
    expect(faultCount).toBe(1);
    const unchanged = databaseAt(dataDirectory);
    try {
      expect(unchanged.prepare(`
        SELECT revision, nodes, save_sequence
        FROM canvas_documents
        WHERE owner_id = '__test__' AND id = ?
      `).get(canvasId)).toEqual({
        nodes: JSON.stringify([{ id: "before" }]),
        revision: 1,
        save_sequence: 1,
      });
    } finally {
      unchanged.close();
    }

    const retried = await saveWithCurrentBaseline(
      api,
      canvasId,
      saveBody("after-db-fault", 1, session, 2),
    );
    expect(retried).toEqual({
      body: {
        graphRevision: 2,
        loadToken: expect.stringMatching(loadTokenPattern),
        revision: 2,
      },
      status: 200,
    });
  });
});
