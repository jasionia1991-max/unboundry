import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { requestIdentity } from "./auth";
import { createRuntimeDatabaseTransactionRunner } from "./database";
import {
  canvasCommandWriteContract,
  parseCanvasUserCommand,
  type AuthoritativeCanvasDocument,
  type CanvasCommandConflictResponse,
  type CanvasCommandSuccessResponse,
} from "../types/canvasCommands";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import {
  canvasLoadTokenEpochForApplication,
  canvasLoadTokenForApplication,
  validCanvasLoadTokenForApplication,
} from "./canvasPersistence";
import {
  applyCanvasUserCommandInTransaction,
  CanvasMutationGatewayCapacityError,
  CanvasMutationGatewayUnavailableError,
  type CanvasMutationGatewayResult,
} from "./canvasMutationGateway";
import {
  canvasClientBuildFromHeader,
  discardDeferredCanvasObservability,
  flushDeferredCanvasObservability,
  recordCanvasRouteEvent,
} from "./canvasObservability";

type CanvasCommandsApiOptions = Readonly<{
  database?: () => DatabaseSync;
  closeDatabaseAfterRequest?: boolean;
}>;

const conflictMessages = Object.freeze({
  CANVAS_ALREADY_EXISTS: "Canvas already exists",
  CANVAS_LEGACY_RECONCILE_REQUIRED:
    "Canvas must be reconciled with the authoritative document",
  CANVAS_LOAD_REQUIRED: "Canvas must be loaded successfully before saving",
  CANVAS_MEDIA_UNAVAILABLE: "Canvas media is no longer available",
  CANVAS_OPERATION_REUSED: "Canvas operation identity was reused with another payload",
  CANVAS_PROJECT_DELETED: "项目已删除，请返回工作空间",
  CANVAS_PROJECT_NOT_OWNED: "项目不存在或不属于当前账号",
  CANVAS_SAVE_SUPERSEDED: "Superseded same-session command",
  CANVAS_SERVER_OWNERSHIP_CONFLICT: "Canvas authority changed; refresh before retrying",
  CANVAS_TOPOLOGY_CONFLICT: "Canvas topology changed; refresh before retrying",
  GENERATION_TERMINAL_BINDING_CONFLICT: "Canvas no longer matches the terminal task",
  GENERATION_TERMINAL_PROOF_CONFLICT: "Canvas result proof no longer matches",
  GENERATION_TERMINAL_STATE_CONFLICT: "Generation task terminal state changed",
  GENERATION_TERMINAL_TASK_CONFLICT: "Generation task is no longer terminal",
  WORKFLOW_GRAPH_LOCKED: "整组执行中的相关节点或连线暂不能修改；其他画布内容仍可编辑",
} as const);

function requestId(response: ServerResponse) {
  const existing = response.getHeader("X-Request-ID");
  const value = typeof existing === "string" && existing.length >= 8
    ? existing
    : randomUUID();
  response.setHeader("X-Request-ID", value);
  return value;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function routeOutcome(
  result: CanvasMutationGatewayResult | Readonly<{
    code: "CANVAS_OPERATION_REUSED";
  }>,
) {
  if ("code" in result) {
    return "command.rejected-conflict.CANVAS_OPERATION_REUSED";
  }
  if (result.outcome === "APPLIED") return "command.applied";
  if (result.outcome === "NO_OP") return "command.no-op";
  return `command.rejected-conflict.${result.conflictCode ??
    "CANVAS_SERVER_OWNERSHIP_CONFLICT"}`;
}

function currentEnvelope(
  ownerId: string,
  canvasId: string,
  document: AuthoritativeCanvasDocument,
) {
  return {
    authoritativeDocument: document,
    currentDocumentRevision: document.revision,
    currentInputGraphRevision: document.graphRevision,
    currentLoadToken: canvasLoadTokenForApplication(
      ownerId,
      canvasId,
      document.revision,
    ),
  };
}

function sendGatewayResult(
  response: ServerResponse,
  ownerId: string,
  canvasId: string,
  currentRequestId: string,
  result: CanvasMutationGatewayResult,
) {
  const common = {
    ...currentEnvelope(ownerId, canvasId, result.authoritativeDocument),
    operationDocumentRevision: result.operationDocumentRevision,
    operationId: result.operationId,
    operationInputGraphRevision: result.operationInputGraphRevision,
    originalRequestId: result.originalRequestId,
    replayed: result.replayed,
    requestId: currentRequestId,
  };
  response.setHeader(
    "X-Unboundry-Canvas-Write-Contract",
    canvasCommandWriteContract,
  );
  if (result.outcome === "REJECTED_CONFLICT") {
    const code = result.conflictCode ?? "CANVAS_SERVER_OWNERSHIP_CONFLICT";
    const body: CanvasCommandConflictResponse = {
      ...common,
      code,
      error: conflictMessages[code],
    };
    json(response, result.httpStatus, body);
    return;
  }
  const originalStatus = result.outcome === "APPLIED"
    ? "applied" as const
    : "already-applied" as const;
  const body: CanvasCommandSuccessResponse = {
    ...common,
    originalStatus,
    status: result.replayed ? "already-applied" : originalStatus,
  };
  json(response, 200, body);
}

export function createCanvasCommandsApi(options: CanvasCommandsApiOptions = {}) {
  const transactions = createRuntimeDatabaseTransactionRunner();
  return async function canvasCommandsApi(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const currentRequestId = requestId(response);
    const clientBuild = canvasClientBuildFromHeader(
      request.headers["x-unboundry-client-build"],
    );
    const recordRoute = (
      outcome: string,
      capability: string = canvasCommandWriteContract,
    ) =>
      recordCanvasRouteEvent({
        callerSymbol: "client.canvasPersistenceFacade",
        capability,
        clientBuild,
        operation: "typed-user-command",
        outcome,
        requestId: currentRequestId,
        route: "canvas.commands",
        runId: null,
        serverClass: "T",
        taskId: null,
      });
    response.setHeader(
      "X-Unboundry-Canvas-Write-Contract",
      canvasCommandWriteContract,
    );
    const path = decodedRequestPath(request);
    const match = /^\/([a-z0-9._-]+)\/commands$/i.exec(path);
    if (!match) {
      recordRoute("command.rejected.CANVAS_COMMAND_ROUTE_NOT_FOUND", "none");
      json(response, 404, {
        code: "CANVAS_COMMAND_ROUTE_NOT_FOUND",
        error: "Canvas command route not found",
        requestId: currentRequestId,
      });
      return;
    }
    if (request.method !== "POST") {
      recordRoute("command.rejected.METHOD_NOT_ALLOWED", "none");
      response.setHeader("Allow", "POST");
      json(response, 405, {
        code: "METHOD_NOT_ALLOWED",
        error: "Method not allowed",
        requestId: currentRequestId,
      });
      return;
    }
    const contract = request.headers["x-unboundry-canvas-write-contract"];
    if (contract !== canvasCommandWriteContract) {
      recordRoute("command.rejected.CANVAS_WRITE_CONTRACT_UNSUPPORTED", "unsupported");
      json(response, 400, {
        code: "CANVAS_WRITE_CONTRACT_UNSUPPORTED",
        error: "Canvas write contract is unsupported",
        operationId: null,
        requestId: currentRequestId,
      });
      return;
    }
    const identity = requestIdentity(request);
    if (!identity) {
      recordRoute("command.rejected.AUTH_REQUIRED");
      json(response, 401, {
        code: "AUTH_REQUIRED",
        error: "Please sign in",
        operationId: null,
        requestId: currentRequestId,
      });
      return;
    }
    let rawCommand: unknown;
    try {
      rawCommand = await readJsonBody<unknown>(request, 1_000_000);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        recordRoute(`command.rejected.${error.code}`);
      }
      throw error;
    }
    const parsed = parseCanvasUserCommand(rawCommand);
    if (!parsed.ok) {
      recordRoute(`command.rejected.${parsed.code}`);
      json(response, 400, {
        code: parsed.code,
        error: "Invalid Canvas command",
        operationId: null,
        requestId: currentRequestId,
      });
      return;
    }
    const canvasId = match[1]!;
    const ownerId = identity.userId;
    const injectedDatabase = options.database?.();
    const apply = (database: DatabaseSync) => {
      try {
        return applyCanvasUserCommandInTransaction({
          canvasId, command: parsed.value, database,
          loadTokenEpoch: canvasLoadTokenEpochForApplication(), ownerId,
          requestId: currentRequestId,
          validLoadToken: validCanvasLoadTokenForApplication,
        });
      } catch (error) {
        discardDeferredCanvasObservability(database);
        throw error;
      }
    };
    try {
      const result = injectedDatabase
        ? (() => {
            injectedDatabase.exec("BEGIN IMMEDIATE");
            try {
              const result = apply(injectedDatabase);
              injectedDatabase.exec("COMMIT");
              flushDeferredCanvasObservability(injectedDatabase);
              return result;
            } catch (error) {
              if (injectedDatabase.isTransaction) injectedDatabase.exec("ROLLBACK");
              discardDeferredCanvasObservability(injectedDatabase);
              throw error;
            }
          })()
        : transactions.run(apply, flushDeferredCanvasObservability);
      if ("outcome" in result) {
        recordRoute(routeOutcome(result));
        sendGatewayResult(
          response,
          ownerId,
          canvasId,
          currentRequestId,
          result,
        );
        return;
      }
      if (result.code === "CANVAS_NOT_FOUND") {
        recordRoute("command.rejected.CANVAS_NOT_FOUND");
        json(response, 404, {
          code: result.code,
          error: "Canvas not found",
          operationId: parsed.value.operationId,
          requestId: currentRequestId,
        });
        return;
      }
      recordRoute(routeOutcome(result));
      json(response, 409, {
        ...currentEnvelope(
          ownerId,
          canvasId,
          result.authoritativeDocument,
        ),
        code: result.code,
        error: conflictMessages.CANVAS_OPERATION_REUSED,
        operationDocumentRevision: result.operationDocumentRevision,
        operationId: result.operationId,
        operationInputGraphRevision: result.operationInputGraphRevision,
        originalRequestId: result.originalRequestId,
        replayed: result.replayed,
        requestId: currentRequestId,
      });
    } catch (error) {
      if (error instanceof CanvasMutationGatewayCapacityError ||
          error instanceof CanvasMutationGatewayUnavailableError) {
        recordRoute(`command.failed.${error.code}`);
        json(response, 503, {
          code: error.code,
          error: error.message,
          operationId: parsed.value.operationId,
          requestId: currentRequestId,
        });
        return;
      }
      throw error;
    }
  };
}

export const canvasCommandsApi = createCanvasCommandsApi();
