import { recoveryCasePhases, recoveryCaseReasons, recoveryPublicActions, recoveryPublicStatuses } from "../types/generationRecovery";

const taskParameter = { name: "taskId", in: "path", required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9._-]{1,120}$" } };
const commandHeader = { name: "X-Unboundry-Recovery-Command", in: "header", required: true,
  schema: { type: "string", const: "v1" } };
const summary = {
  type: "object", additionalProperties: false,
  required: ["taskId", "caseId", "canvasId", "nodeId", "kind", "executionAttempt", "phase",
    "caseEventId", "progressVersion", "updatedAt", "unread", "reasonCode", "summary", "status", "action"],
  properties: {
    taskId: { type: "string" }, caseId: { type: "string" }, canvasId: { type: "string" }, nodeId: { type: "string" },
    kind: { type: "string", enum: ["text", "image", "video", "audio"] }, executionAttempt: { type: "integer", minimum: 1 },
    phase: { type: "string", enum: recoveryCasePhases }, caseEventId: { type: "integer", minimum: 1 },
    progressVersion: { type: "integer", minimum: 0 }, updatedAt: { type: "string", format: "date-time" },
    lastCheckedAt: { type: "string", format: "date-time" }, nextCheckAt: { type: "string", format: "date-time" },
    unread: { type: "boolean" }, reasonCode: { type: "string", enum: recoveryCaseReasons }, summary: { type: "string" },
    status: { type: "string", enum: recoveryPublicStatuses }, action: { type: "string", enum: recoveryPublicActions },
  },
};
const adminSummary = {
  ...summary,
  required: [...summary.required, "ownerId", "originalCreatedAt", "openedAt", "overdue", "followUpDue"],
  properties: {
    ...summary.properties,
    ownerId: { type: "string", description: "任务所有者；仅管理员可跨owner查看" },
    modelId: { type: "string", maxLength: 200, description: "应用侧模型标识" },
    providerModelId: { type: "string", maxLength: 200, description: "已登记的平台模型标识，不含请求凭据" },
    originalCreatedAt: { type: "string", format: "date-time", description: "原生成任务创建时间" },
    attemptStartedAt: { type: "string", format: "date-time", description: "原Provider尝试开始时间（若有可信记录）" },
    openedAt: { type: "string", format: "date-time", description: "First durable case event; used for queue age" },
    overdue: { type: "boolean", description: "Unclaimed queued work older than 24 hours" },
    followUpDue: { type: "boolean", description: "Claimed work without progress for 24 hours" },
    claimedBy: { type: "string", description: "Active administrator claim owner" },
    claimLeaseUntil: { type: "string", format: "date-time", description: "Current administrator claim lease expiry" },
  },
};
const auditEntry = {
  type: "object", additionalProperties: false,
  required: ["id", "action", "actor", "createdAt"],
  properties: {
    id: { type: "integer", minimum: 1 },
    action: { type: "string", enum: [
      "generation_recovery.case_acknowledged",
      "generation_recovery.case_checked",
      "generation_recovery.case_claimed",
      "generation_recovery.case_closed",
      "generation_recovery.case_opened",
      "generation_recovery.case_progressed",
      "generation_recovery.original_attach_provider_task",
      "generation_recovery.original_resume",
      "generation_recovery.original_result_admit",
      "generation_recovery.original_settlement",
    ] },
    actor: { type: "string", maxLength: 80 },
    createdAt: { type: "string", format: "date-time" },
  },
};
const detailResponse = { description: "Safe progress for the authorized task; absence is null",
  content: { "application/json": { schema: { type: "object", required: ["enabled", "case"],
    properties: { enabled: { type: "boolean" }, case: { anyOf: [summary, { type: "null" }] } },
    additionalProperties: false } } } };
const adminDetailResponse = { description: "Admin-only safe progress and bounded recovery audit; absence is null",
  content: { "application/json": { schema: { type: "object", required: ["enabled", "case", "audit"],
    properties: {
      enabled: { type: "boolean" },
      case: { anyOf: [adminSummary, summary, { type: "null" }] },
      audit: { type: "array", items: auditEntry, maxItems: 50 },
    },
    additionalProperties: false } } } };
const adminMutationResponse = { description: "Admin-only safe progress after a maintenance command; absence is null",
  content: { "application/json": { schema: { type: "object", required: ["enabled", "case"],
    properties: {
      enabled: { type: "boolean" },
      case: { anyOf: [adminSummary, summary, { type: "null" }] },
    },
    additionalProperties: false } } } };
const responses = { "200": detailResponse, "400": { description: "Invalid strict command" },
  "401": { description: "Valid real session required; test bypass rejected" },
  "403": { description: "Admin role plus manage_generation_recovery, or trusted origin required" },
  "404": { description: "Task absent or inaccessible" }, "409": { description: "Progress changed" },
  "429": { description: "Bounded request rate exceeded" }, "503": { description: "Maintenance disabled, frozen or unavailable" } };
function command(operationId: string, action: "claim" | "inspect" | "progress" | "read") {
  return { post: { operationId, summary: action === "inspect" ? "Bounded read of the original request; never submits generation" : "Update recovery progress",
    parameters: [taskParameter, commandHeader], requestBody: { required: true, content: { "application/json": {
      schema: { type: "object", additionalProperties: false,
        required: ["commandId", "expectedCaseEventId", ...(action === "read" ? ["progressVersion"] : []), ...(action === "progress" ? ["phase"] : [])],
        properties: { commandId: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,160}$" }, expectedCaseEventId: { type: "integer", minimum: 1 },
          ...(action === "read" ? { progressVersion: { type: "integer", minimum: 1 } } : {}),
          ...(action === "progress" ? { phase: { type: "string", const: "waiting_provider" } } : {}) },
      },
    } } }, responses: { ...responses, "200": action === "read" ? detailResponse : adminMutationResponse } } };
}
const ownerListResponse = { description: "Owner-filtered progress page",
  content: { "application/json": { schema: { type: "object", required: ["enabled", "cases"],
    properties: { enabled: { type: "boolean" }, cases: { type: "array", items: summary },
      nextCursor: { type: "string" } }, additionalProperties: false } } } };
const adminListResponse = { description: "Admin-only bounded maintenance page. Results prioritize overdue unclaimed cases across pages; the opaque cursor freezes the event and age snapshot. Corrupt records remain visible as safe summaries.",
  content: { "application/json": { schema: { type: "object", required: ["enabled", "cases", "corrupt", "unavailableCount"],
    properties: {
      enabled: { type: "boolean" },
      cases: { type: "array", items: adminSummary },
      corrupt: { type: "array", maxItems: 200, items: {
        type: "object", additionalProperties: false,
        required: ["taskId", "eventId", "reason"],
        properties: {
          taskId: { type: "string" }, eventId: { type: "integer", minimum: 1 },
          reason: { type: "string", enum: ["invalid_event", "unsupported_event", "task_missing"] },
        },
      } },
      unavailableCount: { type: "integer", minimum: 0 },
      nextCursor: { type: "string" },
    },
    additionalProperties: false } } } };
export const generationRecoveryOpenApiPaths = {
  "/api/generation-recovery": { get: { operationId: "listOwnerGenerationRecovery", summary: "Read up to 50 owned task progress records",
    parameters: [{ name: "taskIds", in: "query", schema: { type: "string" }, description: "Comma-separated task IDs, at most 50" }],
    responses: { ...responses, "200": ownerListResponse } } },
  "/api/generation-recovery/{taskId}": { get: { operationId: "readOwnerGenerationRecovery", parameters: [taskParameter], responses } },
  "/api/generation-recovery/{taskId}/read": command("acknowledgeGenerationRecovery", "read"),
  "/api/admin/generation-recovery": { get: { operationId: "listAdminGenerationRecovery", summary: "Admin-only bounded maintenance queue",
    parameters: [{ name: "after", in: "query", description: "Opaque administrator sort cursor; it freezes the event and age snapshot across pages", schema: { type: "string", maxLength: 240 } },
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }],
    responses: { ...responses, "200": adminListResponse } } },
  "/api/admin/generation-recovery/{taskId}": { get: { operationId: "readAdminGenerationRecovery", parameters: [taskParameter],
    responses: { ...responses, "200": adminDetailResponse } } },
  "/api/admin/generation-recovery/{taskId}/claim": command("claimGenerationRecovery", "claim"),
  "/api/admin/generation-recovery/{taskId}/inspect": command("inspectOriginalGenerationRecovery", "inspect"),
  "/api/admin/generation-recovery/{taskId}/progress": command("progressGenerationRecovery", "progress"),
};
