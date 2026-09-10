import type { IncomingMessage, ServerResponse } from "node:http";
import { requestIdentity } from "./auth";
import { decodedRequestPath, readJsonBody } from "./httpRequest";
import { ResourceBudgetError } from "./resourceBudget";
import {
  WorkflowContinuationError,
  workflowRunApplication,
} from "./workflowRunService";

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export async function workflowRunsApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { code: "AUTH_REQUIRED", error: "Please sign in" });
    return;
  }
  const ownerId = identity.bypass ? "__test__" : identity.userId;
  const path = decodedRequestPath(request).replace(/^\/+/, "");
  try {
    if (request.method === "GET" && path === "") {
      const url = new URL(request.url ?? "", "http://127.0.0.1");
      const canvasId = url.searchParams.get("canvasId") ?? "";
      if (!/^[a-z0-9._-]{1,120}$/i.test(canvasId)) {
        json(response, 400, { code: "CANVAS_ID_INVALID", error: "Invalid canvas ID" });
        return;
      }
      json(response, 200, { runs: workflowRunApplication.list(ownerId, canvasId) });
      return;
    }
    if (request.method === "POST" && path === "") {
      const body = await readJsonBody<{
        canvasId?: unknown;
        clientSemanticFingerprint?: unknown;
        groupId?: unknown;
      }>(
        request,
        8 * 1_024,
      );
      if (
        typeof body.canvasId !== "string" ||
        !/^[a-z0-9._-]{1,120}$/i.test(body.canvasId) ||
        typeof body.clientSemanticFingerprint !== "string" ||
        !/^wf1-[a-z0-9-]{5,80}$/i.test(body.clientSemanticFingerprint) ||
        typeof body.groupId !== "string" ||
        !/^[a-z0-9._-]{1,160}$/i.test(body.groupId)
      ) {
        json(response, 400, { code: "WORKFLOW_RUN_INVALID", error: "整组执行目标无效" });
        return;
      }
      const run = await workflowRunApplication.create({
        canvasId: body.canvasId,
        clientSemanticFingerprint: body.clientSemanticFingerprint,
        groupId: body.groupId,
        ownerId,
      });
      json(response, 202, run);
      return;
    }
    const stop = path.match(/^([a-z0-9-]{36})\/stop$/i);
    if (request.method === "POST" && stop) {
      const run = workflowRunApplication.stop(ownerId, stop[1]);
      if (!run) {
        json(response, 404, { code: "WORKFLOW_RUN_NOT_FOUND", error: "整组执行不存在" });
        return;
      }
      json(response, 200, run);
      return;
    }
    const continuationPreview = path.match(
      /^([a-z0-9-]{36})\/continuation-preview$/i,
    );
    if (request.method === "GET" && continuationPreview) {
      const preview = workflowRunApplication.continuationPreview(
        ownerId,
        continuationPreview[1],
      );
      json(response, 200, preview);
      return;
    }
    const continuationRelation = path.match(
      /^([a-z0-9-]{36})\/continuation$/i,
    );
    if (request.method === "GET" && continuationRelation) {
      json(response, 200, workflowRunApplication.continuation(
        ownerId,
        continuationRelation[1],
      ));
      return;
    }
    const continueRun = path.match(/^([a-z0-9-]{36})\/continue$/i);
    if (request.method === "POST" && continueRun) {
      const body = await readJsonBody<{
        intentId?: unknown;
        previewDigest?: unknown;
      }>(request, 8 * 1_024);
      if (
        typeof body.intentId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,256}$/.test(body.intentId) ||
        typeof body.previewDigest !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,256}$/.test(body.previewDigest)
      ) {
        json(response, 400, {
          code: "WORKFLOW_CONTINUATION_INTENT_INVALID",
          error: "继续整组执行的意图无效",
        });
        return;
      }
      const created = await workflowRunApplication.continue({
        intentId: body.intentId,
        ownerId,
        parentRunId: continueRun[1],
        previewDigest: body.previewDigest,
      });
      json(response, 202, created);
      return;
    }
    if (request.method === "GET" && /^[a-z0-9-]{36}$/i.test(path)) {
      const run = workflowRunApplication.get(ownerId, path);
      if (!run) {
        json(response, 404, { code: "WORKFLOW_RUN_NOT_FOUND", error: "整组执行不存在" });
        return;
      }
      json(response, 200, run);
      return;
    }
    response.setHeader("Allow", "GET, POST");
    json(response, 404, { code: "WORKFLOW_ROUTE_NOT_FOUND", error: "Workflow endpoint not found" });
  } catch (error) {
    if (error instanceof WorkflowContinuationError) {
      json(response, error.statusCode, { code: error.code, error: error.message });
      return;
    }
    if (error instanceof ResourceBudgetError) {
      json(response, error.statusCode, { code: error.code, error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "整组执行暂时无法开始";
    const conflict = /正在|占用|UNIQUE|constraint/i.test(message);
    json(response, conflict ? 409 : 400, {
      code: conflict ? "WORKFLOW_RUN_CONFLICT" : "WORKFLOW_RUN_REJECTED",
      error: message,
    });
  }
}
