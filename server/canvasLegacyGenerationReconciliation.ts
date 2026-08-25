import type { IncomingMessage, ServerResponse } from "node:http";
import { appDataDirectory, openAppDatabase } from "./database";
import { requestIdentity } from "./auth";
import { decodedRequestPath, readJsonBody } from "./httpRequest";
import {
  readTerminalGenerationTaskBindingCommand,
} from "./generationTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";
import { canvasLoadTokenForApplication } from "./canvasPersistence";
import { stableValueFingerprint } from "../types/canvasFingerprint";

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

const idPattern = /^[a-z0-9._-]{1,200}$/i;
const bindingPattern = /^[\w.:/-]{1,2048}$/;

export function legacyTerminalDetachApplicationIdForBinding(input: Pick<
  TerminalDetachRequest,
  | "accountId"
  | "canvasId"
  | "inputFingerprint"
  | "kind"
  | "nodeDataFingerprint"
  | "nodeId"
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
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
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
    bindingPattern.test(input.inputFingerprint) &&
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

export async function canvasLegacyGenerationReconciliation(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const path = decodedRequestPath(request).replace(/^\/+/, "");
  const match = path.match(
    /^([a-z0-9._-]+)\/(generation-reconciliation-policy|generation-terminal-detach)$/i,
  );
  if (!match) {
    json(response, 404, { code: "CANVAS_RECONCILIATION_NOT_FOUND", error: "Not found" });
    return;
  }
  const canvasId = match[1];
  const operation = match[2];
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { code: "AUTH_REQUIRED", error: "Please sign in" });
    return;
  }
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const store = openAppDatabase(appDataDirectory());
  try {
    const owned = store.prepare(`
      SELECT 1 FROM canvas_documents WHERE owner_id = ? AND id = ?
    `).get(ownerId, canvasId);
    if (!owned) {
      json(response, 404, { code: "CANVAS_NOT_FOUND", error: "Canvas not found" });
      return;
    }
    const policy = rolloutPolicy(ownerId, canvasId);
    if (operation === "generation-reconciliation-policy") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        json(response, 405, { code: "METHOD_NOT_ALLOWED", error: "Method not allowed" });
        return;
      }
      json(response, 200, policy);
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      json(response, 405, { code: "METHOD_NOT_ALLOWED", error: "Method not allowed" });
      return;
    }
    if (!policy.writeEnabled) {
      json(response, 409, {
        code: "LEGACY_RECONCILIATION_WRITE_DISABLED",
        error: "Legacy generation reconciliation is detect-only",
      });
      return;
    }
    const body = await readJsonBody<unknown>(request, 16 * 1024);
    if (!validDetachRequest(body, canvasId) || body.accountId !== ownerId) {
      json(response, 400, {
        code: "GENERATION_TERMINAL_DETACH_INVALID",
        error: "Invalid terminal detach request",
      });
      return;
    }
    store.exec("BEGIN IMMEDIATE");
    try {
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
      if (!task) {
        store.exec("ROLLBACK");
        json(response, 409, {
          code: "GENERATION_TERMINAL_TASK_CONFLICT",
          error: "Generation task is not a matching terminal task",
        });
        return;
      }
      if (task.state !== body.observedTerminalState) {
        store.exec("ROLLBACK");
        json(response, 409, {
          code: "GENERATION_TERMINAL_STATE_CONFLICT",
          error: "Generation task terminal state changed",
        });
        return;
      }
      const authoritativeResultKey = authoritativeTaskResultKey(task);
      if (
        body.resultKey !== undefined &&
        body.resultKey !== authoritativeResultKey
      ) {
        store.exec("ROLLBACK");
        json(response, 409, {
          code: "GENERATION_TERMINAL_PROOF_CONFLICT",
          error: "Canvas success proof belongs to a different result",
        });
        return;
      }
      const row = store.prepare(`
        SELECT edges, graph_revision, nodes, revision, viewport
        FROM canvas_documents WHERE owner_id = ? AND id = ?
      `).get(ownerId, canvasId) as CanvasRow | undefined;
      if (!row) {
        store.exec("ROLLBACK");
        json(response, 404, { code: "CANVAS_NOT_FOUND", error: "Canvas not found" });
        return;
      }
      const nodes = JSON.parse(row.nodes) as unknown[];
      const index = nodes.findIndex((node) => record(node)?.id === body.nodeId);
      const node = index >= 0 ? record(nodes[index]) : undefined;
      const data = record(node?.data);
      if (!node || !data) {
        store.exec("ROLLBACK");
        json(response, 409, {
          code: "GENERATION_TERMINAL_BINDING_CONFLICT",
          error: "Canvas node no longer matches the terminal task",
        });
        return;
      }
      if (detachedAlready(data, body)) {
        store.exec("COMMIT");
        json(response, 200, {
          clearedFields: detachClearedFields(body),
          dataPatch: cleanupPatch(body),
          document: responseDocument(ownerId, canvasId, row),
          status: "already-detached",
        });
        return;
      }
      if (!exactBinding(node, data, body)) {
        store.exec("ROLLBACK");
        json(response, 409, {
          code: "GENERATION_TERMINAL_BINDING_CONFLICT",
          error: "Canvas node no longer matches the terminal task",
        });
        return;
      }
      const nextData = detachNodeData(data, body, authoritativeResultKey);
      if (!nextData) {
        store.exec("ROLLBACK");
        json(response, 409, {
          code: "GENERATION_TERMINAL_PROOF_CONFLICT",
          error: "Canvas success proof belongs to a different result",
        });
        return;
      }
      const nextNode = { ...node, data: nextData };
      nodes[index] = nextNode;
      const revision = row.revision + 1;
      const graphRevision = row.graph_revision + 1;
      const updated = store.prepare(`
        UPDATE canvas_documents
        SET nodes = ?, revision = ?, graph_revision = ?, updated_at = ?
        WHERE owner_id = ? AND id = ? AND revision = ?
      `).run(
        JSON.stringify(nodes),
        revision,
        graphRevision,
        new Date().toISOString(),
        ownerId,
        canvasId,
        row.revision,
      );
      if (updated.changes !== 1) throw new Error("Canvas terminal detach CAS failed");
      const nextRow = { ...row, graph_revision: graphRevision, nodes: JSON.stringify(nodes), revision };
      store.exec("COMMIT");
      json(response, 200, {
        clearedFields: detachClearedFields(body),
        dataPatch: cleanupPatch(body),
        document: responseDocument(ownerId, canvasId, nextRow),
        status: "detached",
      });
    } catch (error) {
      if (store.isTransaction) store.exec("ROLLBACK");
      throw error;
    }
  } finally {
    store.close();
  }
}
