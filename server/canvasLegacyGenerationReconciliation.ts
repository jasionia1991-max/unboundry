import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { appDataDirectory, openAppDatabase } from "./database";
import { requestIdentity } from "./auth";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import {
  listFailedCancelledGenerationTaskBindingsCommand,
  readCanvasRouteGenerationEvidenceCommand,
  readTerminalGenerationTaskBindingCommand,
} from "./generationTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import {
  canvasLoadTokenEpochForApplication,
  canvasLoadTokenForApplication,
} from "./canvasPersistence";
import { detachLegacyTerminalInTransaction } from "./canvasMutationGateway";
import { stableValueFingerprint } from "../types/canvasFingerprint";
import {
  canvasClientBuildFromHeader,
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
  recordCanvasRouteEvent,
  type CanvasServerClass,
} from "./canvasObservability";

type GenerationKind = "audio" | "image" | "text" | "video";
type RolloutMode = "off" | "detect" | "allowlist" | "on";

type TerminalDetachRequest = {
  accountId: string;
  applicationId: string;
  canvasId: string;
  inputFingerprint: string;
  kind: GenerationKind;
  nodeDataFingerprint: string;
  nodeId: string;
  observedTerminalState: "cancelled" | "failed" | "success";
  ownershipKey: string;
  resultKey?: string;
  runId: string;
  taskId: string;
};

type CanvasRow = {
  edges: string;
  graph_revision: number;
  nodes: string;
  revision: number;
  viewport: string;
};

export type LegacyTerminalDetachSweepResult = Readonly<{
  canvasesFailed: number;
  canvasesVisited: number;
  nodesDetached: number;
}>;

const idPattern = /^[a-z0-9._-]{1,200}$/i;
const bindingPattern = /^[\w.:/-]{1,2048}$/;
const terminalDetachInputFingerprintMaxLength = 100_000;
const terminalDetachRequestMaxBytes = 1024 * 1024;

export function legacyTerminalDetachApplicationIdForBinding(input: Pick<
  TerminalDetachRequest,
  | "accountId"
  | "canvasId"
  | "inputFingerprint"
  | "kind"
  | "nodeDataFingerprint"
  | "nodeId"
  | "observedTerminalState"
  | "ownershipKey"
  | "resultKey"
  | "runId"
  | "taskId"
>) {
  return `legacy-terminal-detach:${stableValueFingerprint({
    accountId: input.accountId,
    canvasId: input.canvasId,
    inputFingerprint: input.inputFingerprint,
    kind: input.kind,
    nodeDataFingerprint: input.nodeDataFingerprint,
    nodeId: input.nodeId,
    observedTerminalState: input.observedTerminalState,
    ownershipKey: input.ownershipKey,
    resultKey: input.resultKey,
    runId: input.runId,
    taskId: input.taskId,
  })}`;
}

export function legacyTerminalNodeDataFingerprint(data: unknown) {
  return stableValueFingerprint(data);
}

function json(response: ServerResponse, status: number, body: unknown) {
  const requestId = String(response.getHeader("X-Request-Id") ?? randomUUID());
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Request-Id", requestId);
  response.end(JSON.stringify(body));
}

function rolloutMode(): RolloutMode {
  const value = process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_MODE;
  return value === "off" || value === "allowlist" || value === "on" ||
      value === "detect"
    ? value
    : "detect";
}

function allowlistEntries() {
  const raw = process.env.UNBOUNDRY_LEGACY_TERMINAL_RECONCILIATION_ALLOWLIST;
  if (!raw) return [] as Array<{ accountId: string; canvasId: string }>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const value = entry as { accountId?: unknown; canvasId?: unknown };
      return typeof value.accountId === "string" &&
          typeof value.canvasId === "string" && idPattern.test(value.accountId) &&
          idPattern.test(value.canvasId)
        ? [{ accountId: value.accountId, canvasId: value.canvasId }]
        : [];
    });
  } catch {
    return [];
  }
}

function rolloutPolicy(accountId: string, canvasId: string) {
  const mode = rolloutMode();
  return {
    mode,
    writeEnabled: mode === "on" ||
      (mode === "allowlist" && allowlistEntries().some((entry) =>
        entry.accountId === accountId && entry.canvasId === canvasId
      )),
  } as const;
}

function legacyDetachCapability(
  policy: ReturnType<typeof rolloutPolicy>,
  accountId: string,
  canvasId: string,
) {
  if (!policy.writeEnabled) return "legacy-detach-disabled";
  return allowlistEntries().some((entry) =>
      entry.accountId === accountId && entry.canvasId === canvasId
    )
    ? "legacy-detach-allowlisted"
    : "legacy-detach-global";
}

function legacyDetachOutcome(result: ReturnType<
  typeof detachLegacyTerminalInTransaction
>) {
  if (!result) return "legacy.rejected.CANVAS_NOT_FOUND";
  if ("code" in result) {
    return "command.rejected-conflict.CANVAS_OPERATION_REUSED";
  }
  if (result.outcome === "APPLIED") return "legacy.detached";
  if (result.outcome === "NO_OP") return "legacy.already-detached";
  return `command.rejected-conflict.${result.conflictCode ??
    "GENERATION_TERMINAL_BINDING_CONFLICT"}`;
}

function classifyLegacyDetachCandidate(
  store: ReturnType<typeof openAppDatabase>,
  input: Pick<
    TerminalDetachRequest,
    "canvasId" | "kind" | "nodeId" | "taskId"
  > & { ownerId: string },
): CanvasServerClass {
  const evidence = executeTransactionScopedCommand(
    store,
    readCanvasRouteGenerationEvidenceCommand,
    input,
  );
  if (!evidence) return "D";
  if (["queued", "running", "recovering", "retrying"].includes(
    evidence.state,
  )) return "T";
  if (evidence.generationIdentityVersion === 2) return "D";
  if (!["success", "failed", "cancelled"].includes(evidence.state)) {
    return "D";
  }
  return evidence.dangerousAttempt && evidence.state !== "success" ? "D" : "C";
}

function uniqueAllowlistEntries() {
  const seen = new Set<string>();
  return allowlistEntries().filter((entry) => {
    const key = `${entry.accountId}\0${entry.canvasId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function allowlistedLegacyTerminalDetachSweepEnabled() {
  const mode = rolloutMode();
  return (mode === "allowlist" || mode === "on") &&
    uniqueAllowlistEntries().length > 0;
}

function validDetachRequest(
  value: unknown,
  canvasId: string,
): value is TerminalDetachRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Partial<TerminalDetachRequest>;
  const allowedKeys = new Set([
    "accountId",
    "applicationId",
    "canvasId",
    "inputFingerprint",
    "kind",
    "nodeDataFingerprint",
    "nodeId",
    "observedTerminalState",
    "ownershipKey",
    "resultKey",
    "runId",
    "taskId",
  ]);
  return Object.keys(input).every((key) => allowedKeys.has(key)) &&
    input.canvasId === canvasId && typeof input.accountId === "string" &&
    idPattern.test(input.accountId) && typeof input.nodeId === "string" &&
    idPattern.test(input.nodeId) && typeof input.taskId === "string" &&
    idPattern.test(input.taskId) &&
    (input.kind === "audio" || input.kind === "image" ||
      input.kind === "text" || input.kind === "video") &&
    (input.observedTerminalState === "cancelled" ||
      input.observedTerminalState === "failed" ||
      input.observedTerminalState === "success") &&
    typeof input.applicationId === "string" && bindingPattern.test(input.applicationId) &&
    typeof input.inputFingerprint === "string" &&
    input.inputFingerprint.length > 0 &&
    input.inputFingerprint.length <= terminalDetachInputFingerprintMaxLength &&
    typeof input.nodeDataFingerprint === "string" &&
    bindingPattern.test(input.nodeDataFingerprint) &&
    typeof input.ownershipKey === "string" && bindingPattern.test(input.ownershipKey) &&
    (input.resultKey === undefined ||
      (typeof input.resultKey === "string" && bindingPattern.test(input.resultKey))) &&
    typeof input.runId === "string" && bindingPattern.test(input.runId) &&
    input.applicationId === legacyTerminalDetachApplicationIdForBinding({
      accountId: input.accountId,
      canvasId: input.canvasId,
      inputFingerprint: input.inputFingerprint,
      kind: input.kind,
      nodeDataFingerprint: input.nodeDataFingerprint,
      nodeId: input.nodeId,
      observedTerminalState: input.observedTerminalState,
      ownershipKey: input.ownershipKey,
      resultKey: input.resultKey,
      runId: input.runId,
      taskId: input.taskId,
    });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function detachedAlready(
  data: Record<string, unknown>,
  input: TerminalDetachRequest,
) {
  return data.legacyTerminalDetachApplicationId === input.applicationId &&
    data.workflowExecutionRunId === undefined &&
    data[`${input.kind}GenerationTaskId`] === undefined &&
    data[`${input.kind}GenerationOwnershipKey`] === undefined &&
    data[`${input.kind}GenerationInputKey`] === undefined &&
    data[`${input.kind}Generating`] !== true;
}

function exactBinding(
  node: Record<string, unknown>,
  data: Record<string, unknown>,
  input: TerminalDetachRequest,
) {
  return node.type === input.kind &&
    data.workflowExecutionRunId === input.runId &&
    data[`${input.kind}GenerationTaskId`] === input.taskId &&
    data[`${input.kind}GenerationOwnershipKey`] === input.ownershipKey &&
    data[`${input.kind}GenerationInputKey`] === input.inputFingerprint &&
    data[`${input.kind}Generating`] === true &&
    legacyTerminalNodeDataFingerprint(data) === input.nodeDataFingerprint;
}

function cleanupPatch(input: TerminalDetachRequest) {
  return {
    [`${input.kind}Generating`]: false,
    legacyTerminalDetachApplicationId: input.applicationId,
  } as Record<string, unknown>;
}

function detachClearedFields(input: TerminalDetachRequest) {
  return [
    "workflowExecutionRunId",
    `${input.kind}GenerationTaskId`,
    `${input.kind}GenerationOwnershipKey`,
    `${input.kind}GenerationInputKey`,
    `${input.kind}GenerationError`,
    `${input.kind}GenerationErrorCode`,
    `${input.kind}GenerationRetryAllowed`,
    `${input.kind}GenerationRetryBlockCode`,
    `${input.kind}GenerationRetryBlockReason`,
    "groupRunSuccessTaskId",
    "groupRunSuccessOwnershipKey",
    "groupRunSuccessResultKey",
  ];
}

function detachNodeData(
  data: Record<string, unknown>,
  input: TerminalDetachRequest,
  authoritativeResultKey: string | undefined,
) {
  const next = { ...data, ...cleanupPatch(input) };
  delete next.workflowExecutionRunId;
  for (const suffix of [
    "GenerationTaskId",
    "GenerationOwnershipKey",
    "GenerationInputKey",
    "GenerationError",
    "GenerationErrorCode",
    "GenerationRetryAllowed",
    "GenerationRetryBlockCode",
    "GenerationRetryBlockReason",
  ]) delete next[`${input.kind}${suffix}`];
  const proofFields = [
    "groupRunSuccessTaskId",
    "groupRunSuccessOwnershipKey",
    "groupRunSuccessResultKey",
  ] as const;
  const proofPresent = proofFields.some((field) => next[field] !== undefined);
  if (proofPresent) {
    if (
      next.groupRunSuccessTaskId !== input.taskId ||
      next.groupRunSuccessOwnershipKey !== input.ownershipKey ||
      typeof next.groupRunSuccessResultKey !== "string" ||
      input.resultKey === undefined ||
      authoritativeResultKey === undefined ||
      next.groupRunSuccessResultKey !== input.resultKey ||
      input.resultKey !== authoritativeResultKey
    ) return undefined;
    for (const field of proofFields) delete next[field];
  }
  return next;
}

function htmlForPlainText(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
  return `<p>${escaped}</p>`;
}

function authoritativeTaskResultKey(task: {
  kind: GenerationKind;
  resultAssetId: string | null;
  resultText: string | null;
  state: "cancelled" | "failed" | "success";
}) {
  if (task.state !== "success") return undefined;
  if (task.kind === "text") {
    const text = task.resultText?.trim() ?? "";
    return text
      ? stableValueFingerprint({ content: text, contentHtml: htmlForPlainText(text) })
      : undefined;
  }
  if (!task.resultAssetId) return undefined;
  const resultUrl = task.kind === "video"
    ? `/api/video-assets/${task.resultAssetId}`
    : task.kind === "audio"
      ? `/api/audio-assets/${task.resultAssetId}`
      : `/api/assets/${task.resultAssetId}`;
  return stableValueFingerprint(resultUrl);
}

function responseDocument(
  ownerId: string,
  canvasId: string,
  row: CanvasRow,
) {
  return {
    edges: JSON.parse(row.edges),
    graphRevision: row.graph_revision,
    loadToken: canvasLoadTokenForApplication(ownerId, canvasId, row.revision),
    nodes: JSON.parse(row.nodes),
    revision: row.revision,
    viewport: JSON.parse(row.viewport),
    ownerId,
    canvasId,
  };
}

function gatewayResponseDocument(
  ownerId: string,
  canvasId: string,
  document: Readonly<{
    edges: readonly unknown[];
    graphRevision: number;
    nodes: readonly unknown[];
    revision: number;
    viewport: { x: number; y: number; zoom: number };
  }>,
) {
  return {
    ...document,
    loadToken: canvasLoadTokenForApplication(ownerId, canvasId, document.revision),
    ownerId,
    canvasId,
  };
}

/**
 * Active-runtime safety net for legacy failed/cancelled bindings.
 *
 * The browser may be closed or may retain a stale local checkpoint/lease, so
 * terminal cleanup cannot rely on a client request. This sweep is deliberately
 * narrower than the HTTP endpoint: it only visits explicit allowlist entries,
 * never detaches success, and derives every proof field from the authoritative
 * task + Canvas rows inside one write transaction.
 */
export async function runAllowlistedLegacyTerminalDetachSweep(
  options: { dataDirectory?: string } = {},
): Promise<LegacyTerminalDetachSweepResult> {
  const entries = uniqueAllowlistEntries();
  if (!allowlistedLegacyTerminalDetachSweepEnabled()) {
    return { canvasesFailed: 0, canvasesVisited: 0, nodesDetached: 0 };
  }
  const store = openAppDatabase(options.dataDirectory ?? appDataDirectory());
  let canvasesFailed = 0;
  let nodesDetached = 0;
  try {
    for (const entry of entries) {
      const committedRoutes: Array<{
        kind: GenerationKind;
        outcome: string;
        requestId: string;
        runId: string;
        serverClass: CanvasServerClass;
        taskId: string;
      }> = [];
      try {
        store.exec("BEGIN IMMEDIATE");
        const exists = store.prepare(`
          SELECT 1 FROM canvas_documents WHERE owner_id = ? AND id = ?
        `).get(entry.accountId, entry.canvasId);
        if (!exists) {
          store.exec("COMMIT");
          continue;
        }
        const tasks = executeTransactionScopedCommand(
          store,
          listFailedCancelledGenerationTaskBindingsCommand,
          { canvasId: entry.canvasId, ownerId: entry.accountId },
        );
        let detachedForCanvas = 0;
        for (const task of tasks) {
          const row = store.prepare(`
            SELECT edges, graph_revision, nodes, revision, viewport
            FROM canvas_documents WHERE owner_id = ? AND id = ?
          `).get(entry.accountId, entry.canvasId) as CanvasRow | undefined;
          if (!row) continue;
          const nodes = JSON.parse(row.nodes) as unknown[];
          const index = nodes.findIndex((node) => record(node)?.id === task.nodeId);
          const node = index >= 0 ? record(nodes[index]) : undefined;
          const data = record(node?.data);
          if (!node || !data) continue;
          const inputFingerprint = data[`${task.kind}GenerationInputKey`];
          const ownershipKey = data[`${task.kind}GenerationOwnershipKey`];
          const runId = data.workflowExecutionRunId;
          if (
            typeof inputFingerprint !== "string" ||
            typeof ownershipKey !== "string" ||
            typeof runId !== "string"
          ) continue;
          const binding = {
            accountId: entry.accountId,
            canvasId: entry.canvasId,
            inputFingerprint,
            kind: task.kind,
            nodeDataFingerprint: legacyTerminalNodeDataFingerprint(data),
            nodeId: task.nodeId,
            observedTerminalState: task.state,
            ownershipKey,
            runId,
            taskId: task.taskId,
          } as const;
          const input: TerminalDetachRequest = {
            ...binding,
            applicationId: legacyTerminalDetachApplicationIdForBinding(binding),
          };
          if (!validDetachRequest(input, entry.canvasId)) continue;
          const serverClass = classifyLegacyDetachCandidate(store, {
            canvasId: entry.canvasId,
            kind: task.kind,
            nodeId: task.nodeId,
            ownerId: entry.accountId,
            taskId: task.taskId,
          });
          if (serverClass !== "C") continue;
          const authoritativeTask = executeTransactionScopedCommand(
            store,
            readTerminalGenerationTaskBindingCommand,
            {
              canvasId: entry.canvasId,
              kind: task.kind,
              nodeId: task.nodeId,
              ownerId: entry.accountId,
              taskId: task.taskId,
            },
          );
          const detachRequestId = randomUUID();
          const result = detachLegacyTerminalInTransaction({
            ...input,
            authoritativeResultKey: authoritativeTask
              ? authoritativeTaskResultKey(authoritativeTask)
              : undefined,
            database: store,
            loadTokenEpoch: canvasLoadTokenEpochForApplication(),
            loadTokenForRevision: (revision) => canvasLoadTokenForApplication(
              entry.accountId,
              entry.canvasId,
              revision,
            ),
            ownerId: entry.accountId,
            preconditionConflictCode: !authoritativeTask
              ? "GENERATION_TERMINAL_TASK_CONFLICT"
              : authoritativeTask.state !== task.state
                ? "GENERATION_TERMINAL_STATE_CONFLICT"
                : undefined,
            requestId: detachRequestId,
          });
          if (result) {
            committedRoutes.push({
              kind: input.kind,
              outcome: legacyDetachOutcome(result),
              requestId: detachRequestId,
              runId: input.runId,
              serverClass,
              taskId: input.taskId,
            });
          }
          if (result && "outcome" in result && result.outcome === "APPLIED") {
            detachedForCanvas += 1;
          }
        }
        store.exec("COMMIT");
        flushDeferredCanvasObservability(store);
        for (const route of committedRoutes) {
          recordCanvasRouteEvent({
            callerSymbol: "server.legacyTerminalDetachSweep",
            capability: "legacy-detach-allowlisted",
            clientBuild: "server",
            operation: "legacy-terminal-detach-sweep",
            outcome: route.outcome,
            requestId: route.requestId,
            route: "canvas.legacy-terminal-detach",
            runId: route.runId,
            serverClass: route.serverClass,
            taskId: route.taskId,
          });
        }
        nodesDetached += detachedForCanvas;
      } catch {
        if (store.isTransaction) store.exec("ROLLBACK");
        discardDeferredCanvasObservability(store);
        canvasesFailed += 1;
      }
    }
  } finally {
    store.close();
  }
  return {
    canvasesFailed,
    canvasesVisited: entries.length,
    nodesDetached,
  };
}

export async function canvasLegacyGenerationReconciliation(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const existingRequestId = response.getHeader("X-Request-Id");
  const requestId = typeof existingRequestId === "string" &&
      existingRequestId.length >= 8
    ? existingRequestId
    : randomUUID();
  response.setHeader("X-Request-Id", requestId);
  const clientBuild = canvasClientBuildFromHeader(
    request.headers["x-unboundry-client-build"],
  );
  const path = decodedRequestPath(request).replace(/^\/+/, "");
  const match = path.match(
    /^([a-z0-9._-]+)\/(generation-reconciliation-policy|generation-terminal-detach)$/i,
  );
  if (!match) {
    recordCanvasRouteEvent({
      callerSymbol: "client.legacyTerminalGenerationReconciler",
      capability: "unresolved",
      clientBuild,
      operation: "legacy-reconciliation-route",
      outcome: "legacy.rejected.CANVAS_RECONCILIATION_NOT_FOUND",
      requestId,
      route: "canvas.legacy-reconciliation",
      runId: null,
      serverClass: "D",
      taskId: null,
    });
    json(response, 404, {
      code: "CANVAS_RECONCILIATION_NOT_FOUND",
      error: "Not found",
      requestId,
    });
    return;
  }
  const canvasId = match[1];
  const operation = match[2];
  let capability = operation === "generation-reconciliation-policy"
    ? "legacy-policy-v1"
    : "legacy-detach-disabled";
  let routeRunId: string | null = null;
  let routeTaskId: string | null = null;
  let serverClass: CanvasServerClass = "T";
  const recordRoute = (outcome: string) => recordCanvasRouteEvent({
    callerSymbol: "client.legacyTerminalGenerationReconciler",
    capability,
    clientBuild,
    operation: operation === "generation-reconciliation-policy"
      ? "legacy-policy-read"
      : "legacy-terminal-detach",
    outcome,
    requestId,
    route: operation === "generation-reconciliation-policy"
      ? "canvas.legacy-reconciliation-policy"
      : "canvas.legacy-terminal-detach",
    runId: routeRunId,
    serverClass,
    taskId: routeTaskId,
  });
  const identity = requestIdentity(request);
  if (!identity) {
    recordRoute("legacy.rejected.AUTH_REQUIRED");
    json(response, 401, {
      code: "AUTH_REQUIRED",
      error: "Please sign in",
      requestId,
    });
    return;
  }
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const store = openAppDatabase(appDataDirectory());
  try {
    const owned = store.prepare(`
      SELECT 1 FROM canvas_documents WHERE owner_id = ? AND id = ?
    `).get(ownerId, canvasId);
    if (!owned) {
      serverClass = "D";
      recordRoute("legacy.rejected.CANVAS_NOT_FOUND");
      json(response, 404, {
        code: "CANVAS_NOT_FOUND",
        error: "Canvas not found",
        requestId,
      });
      return;
    }
    const policy = rolloutPolicy(ownerId, canvasId);
    if (operation === "generation-reconciliation-policy") {
      if (request.method !== "GET") {
        recordRoute("legacy.rejected.METHOD_NOT_ALLOWED");
        response.setHeader("Allow", "GET");
        json(response, 405, {
          code: "METHOD_NOT_ALLOWED",
          error: "Method not allowed",
          requestId,
        });
        return;
      }
      recordRoute(policy.writeEnabled
        ? "legacy.policy-write-enabled"
        : "legacy.policy-detect-only");
      json(response, 200, policy);
      return;
    }
    capability = legacyDetachCapability(policy, ownerId, canvasId);
    if (request.method !== "POST") {
      recordRoute("legacy.rejected.METHOD_NOT_ALLOWED");
      response.setHeader("Allow", "POST");
      json(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        error: "Method not allowed",
        requestId,
      });
      return;
    }
    if (!policy.writeEnabled) {
      recordRoute("legacy.reconcile-required");
      json(response, 409, {
        code: "LEGACY_RECONCILIATION_WRITE_DISABLED",
        error: "Legacy generation reconciliation is detect-only",
        requestId,
      });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody<unknown>(request, terminalDetachRequestMaxBytes);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        serverClass = "D";
        recordRoute(`legacy.rejected.${error.code}`);
      }
      throw error;
    }
    if (!validDetachRequest(body, canvasId) || body.accountId !== ownerId) {
      serverClass = "D";
      recordRoute("legacy.rejected.GENERATION_TERMINAL_DETACH_INVALID");
      json(response, 400, {
        code: "GENERATION_TERMINAL_DETACH_INVALID",
        error: "Invalid terminal detach request",
        requestId,
      });
      return;
    }
    routeRunId = body.runId;
    routeTaskId = body.taskId;
    store.exec("BEGIN IMMEDIATE");
    try {
      serverClass = classifyLegacyDetachCandidate(store, {
        canvasId,
        kind: body.kind,
        nodeId: body.nodeId,
        ownerId,
        taskId: body.taskId,
      });
      const task = executeTransactionScopedCommand(
        store,
        readTerminalGenerationTaskBindingCommand,
        {
          canvasId,
          kind: body.kind,
          nodeId: body.nodeId,
          ownerId,
          taskId: body.taskId,
        },
      );
      const authoritativeResultKey = task &&
          task.generationIdentityVersion !== 2
        ? authoritativeTaskResultKey(task)
        : undefined;
      const preconditionConflictCode = !task ||
          task.generationIdentityVersion === 2
        ? "GENERATION_TERMINAL_TASK_CONFLICT" as const
        : task.state !== body.observedTerminalState
          ? "GENERATION_TERMINAL_STATE_CONFLICT" as const
          : body.resultKey !== undefined && body.resultKey !== authoritativeResultKey
            ? "GENERATION_TERMINAL_PROOF_CONFLICT" as const
            : undefined;
      const result = detachLegacyTerminalInTransaction({
        ...body,
        authoritativeResultKey,
        database: store,
        loadTokenEpoch: canvasLoadTokenEpochForApplication(),
        loadTokenForRevision: (revision) => canvasLoadTokenForApplication(
          ownerId,
          canvasId,
          revision,
        ),
        ownerId,
        preconditionConflictCode,
        requestId,
      });
      if (!result) {
        store.exec("ROLLBACK");
        discardDeferredCanvasObservability(store);
        serverClass = "D";
        recordRoute("legacy.rejected.CANVAS_NOT_FOUND");
        json(response, 404, {
          code: "CANVAS_NOT_FOUND",
          error: "Canvas not found",
          requestId,
        });
        return;
      }
      store.exec("COMMIT");
      flushDeferredCanvasObservability(store);
      const committedOutcome = legacyDetachOutcome(result);
      if (committedOutcome !== "legacy.detached" &&
          committedOutcome !== "legacy.already-detached") {
        serverClass = "D";
      }
      recordRoute(committedOutcome);
      const document = gatewayResponseDocument(
        ownerId,
        canvasId,
        result.authoritativeDocument,
      );
      if ("code" in result) {
        json(response, 409, {
          authoritativeDocument: document,
          code: result.code,
          currentGraphRevision: result.authoritativeDocument.graphRevision,
          currentLoadToken: document.loadToken,
          currentRevision: result.authoritativeDocument.revision,
          error: "Canvas operation identity was already used",
          operationGraphRevision: result.operationInputGraphRevision,
          operationId: result.operationId,
          operationRevision: result.operationDocumentRevision,
          originalRequestId: result.originalRequestId,
          replayed: result.replayed,
          requestId,
          requiresAuthoritativeGet: true,
        });
        return;
      }
      if (result.outcome === "REJECTED_CONFLICT") {
        const messages: Record<string, string> = {
          CANVAS_TOPOLOGY_CONFLICT: "Canvas topology is invalid",
          GENERATION_TERMINAL_BINDING_CONFLICT:
            "Canvas node no longer matches the terminal task",
          GENERATION_TERMINAL_PROOF_CONFLICT:
            "Canvas success proof belongs to a different result",
          GENERATION_TERMINAL_STATE_CONFLICT:
            "Generation task terminal state changed",
          GENERATION_TERMINAL_TASK_CONFLICT:
            "Generation task is not a matching terminal task",
        };
        json(response, 409, {
          authoritativeDocument: document,
          code: result.conflictCode,
          currentGraphRevision: result.authoritativeDocument.graphRevision,
          currentLoadToken: document.loadToken,
          currentRevision: result.authoritativeDocument.revision,
          error: messages[String(result.conflictCode)] ?? "Terminal detach conflict",
          operationGraphRevision: result.operationInputGraphRevision,
          operationId: result.operationId,
          operationRevision: result.operationDocumentRevision,
          originalRequestId: result.originalRequestId,
          replayed: result.replayed,
          requestId,
          requiresAuthoritativeGet: true,
        });
        return;
      }
      json(response, 200, {
        clearedFields: detachClearedFields(body),
        dataPatch: cleanupPatch(body),
        document,
        operationGraphRevision: result.operationInputGraphRevision,
        operationId: result.operationId,
        operationRevision: result.operationDocumentRevision,
        originalRequestId: result.originalRequestId,
        replayed: result.replayed,
        requestId,
        status: result.outcome === "APPLIED" && !result.replayed
          ? "detached"
          : "already-detached",
      });
    } catch (error) {
      if (store.isTransaction) store.exec("ROLLBACK");
      discardDeferredCanvasObservability(store);
      throw error;
    }
  } finally {
    store.close();
  }
}
