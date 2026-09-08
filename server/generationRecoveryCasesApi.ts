import type { IncomingMessage, ServerResponse } from "node:http";
import { requestIdentity } from "./auth";
import { hasPermission } from "./permissions";
import { decodedRequestPath, discardUnreadRequestBody, HttpRequestError, readJsonBody } from "./httpRequest";

// The application port supplies owner-filtered DTOs, never raw event envelopes.
export type GenerationRecoveryHttpPort = Readonly<{
  listOwner: (ownerId: string, taskIds: readonly string[]) => unknown;
  detailOwner: (ownerId: string, taskId: string) => unknown;
  listAdmin: (after: string | undefined, limit: number) => unknown;
  detailAdmin: (taskId: string) => unknown;
  mutate: (input: Readonly<{
    actorId: string;
    taskId: string;
    action: "claim" | "inspect" | "progress" | "read";
    commandId: string;
    expectedCaseEventId: number;
    progressVersion?: number;
    phase?: "waiting_provider";
  }>) => unknown | Promise<unknown>;
}>;

const identifier = /^[a-z0-9._-]{1,120}$/i;
const commandIdentifier = /^[a-z0-9._:-]{1,160}$/i;
const requests = new Map<string, { startedAt: number; count: number }>();
function allowedRate(key: string, maximum: number) {
  const now = Date.now();
  for (const [id, value] of requests) {
    if (now - value.startedAt >= 60_000) requests.delete(id);
  }
  const prior = requests.get(key);
  if (prior) return ++prior.count <= maximum;
  if (requests.size >= 10_000) return false;
  requests.set(key, { count: 1, startedAt: now });
  return true;
}
function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
function error(response: ServerResponse, status: number, code: string, message: string) {
  json(response, status, { code, error: message });
}
function writeOriginAllowed(request: IncomingMessage) {
  // A custom header prevents a simple cross-site form request, including one
  // without Origin. Same-origin fetch supplies it; this route never enables CORS.
  if (request.headers["x-unboundry-recovery-command"] !== "v1" ||
      request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host === request.headers.host && !parsed.username && !parsed.password;
  } catch { return false; }
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createGenerationRecoveryCasesApi(port: GenerationRecoveryHttpPort) {
  const handler = (admin: boolean) => async (request: IncomingMessage, response: ServerResponse) => {
    const reject = (status: number, code: string, message: string) => {
      if (request.method !== "GET") discardUnreadRequestBody(request);
      error(response, status, code, message);
    };
    const identity = requestIdentity(request);
    if (!identity || identity.bypass) {
      reject(401, "RECOVERY_SESSION_REQUIRED", "请重新登录后查看处理进度"); return;
    }
    if (admin && (identity.role !== "admin" ||
        !hasPermission(identity, "manage_generation_recovery"))) {
      reject(403, "RECOVERY_ADMIN_REQUIRED", "只有管理员可以处理生成维护事项"); return;
    }
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      reject(405, "RECOVERY_METHOD_NOT_ALLOWED", "不支持此操作"); return;
    }
    if (method === "POST" && !writeOriginAllowed(request)) {
      reject(403, "RECOVERY_ORIGIN_REJECTED", "请求来源无效"); return;
    }
    if (!allowedRate(`${identity.userId}:${method}`, method === "GET" ? 120 : 30)) {
      response.setHeader("Retry-After", "60");
      reject(429, "RECOVERY_RATE_LIMIT", "操作过于频繁，请稍后再试"); return;
    }
    const path = decodedRequestPath(request).replace(/^\/+|\/+$/g, "");
    const [taskId, action, extra] = path.split("/");
    const query = new URL(request.url ?? "/", "http://localhost").searchParams;
    try {
      if (method === "GET" && !path) {
        if (admin) {
          if ([...query.keys()].some((key) => !["after", "limit"].includes(key))) throw new Error("input");
          const afterValue = query.get("after");
          const after = afterValue === null || afterValue.trim() === "" ? undefined : afterValue;
          const limit = query.has("limit") ? Number(query.get("limit")) : 50;
          if ((after && after.length > 240) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("input");
          json(response, 200, await port.listAdmin(after, limit));
        } else {
          if ([...query.keys()].some((key) => key !== "taskIds")) throw new Error("input");
          const taskIds = [...new Set((query.get("taskIds") ?? "").split(",").filter(Boolean))];
          if (taskIds.length > 50 || taskIds.some((id) => !identifier.test(id))) throw new Error("input");
          json(response, 200, await port.listOwner(identity.userId, taskIds));
        }
        return;
      }
      if (!identifier.test(taskId) || extra || query.size) throw new Error("input");
      if (method === "GET" && !action) {
        json(response, 200, await (admin ? port.detailAdmin(taskId) : port.detailOwner(identity.userId, taskId)));
        return;
      }
      const actions = admin ? ["claim", "inspect", "progress"] : ["read"];
      if (method !== "POST" || !actions.includes(action)) {
        reject(404, "RECOVERY_ROUTE_NOT_FOUND", "没有此处理操作"); return;
      }
      const body = await readJsonBody<unknown>(request, 2_048);
      const allowedKeys = ["commandId", "expectedCaseEventId", ...(action === "read" ? ["progressVersion"] : []), ...(action === "progress" ? ["phase"] : [])];
      if (!plainObject(body) || Object.keys(body).some((key) => !allowedKeys.includes(key)) ||
          typeof body.commandId !== "string" || !commandIdentifier.test(body.commandId) ||
          !Number.isSafeInteger(body.expectedCaseEventId) || Number(body.expectedCaseEventId) < 1 ||
          (action === "read" && (!Number.isSafeInteger(body.progressVersion) || Number(body.progressVersion) < 1)) ||
          (action === "progress" && body.phase !== "waiting_provider")) throw new Error("input");
      json(response, 200, await port.mutate({
        actorId: identity.userId, taskId,
        action: action as "claim" | "inspect" | "progress" | "read",
        commandId: body.commandId,
        expectedCaseEventId: Number(body.expectedCaseEventId),
        ...(action === "read" ? { progressVersion: Number(body.progressVersion) } : {}),
        ...(action === "progress" ? { phase: "waiting_provider" as const } : {}),
      }));
    } catch (cause) {
      // No SQL, Provider response, prompt, or credential enters public errors.
      const code = cause && typeof cause === "object" && "code" in cause
        ? String(cause.code) : "";
      if (cause instanceof HttpRequestError) {
        reject(cause.statusCode, cause.code, "处理请求格式无效");
      } else if (code === "RECOVERY_DISABLED" || code === "RECOVERY_FROZEN") {
        reject(503, code, "生成维护暂不可操作，原任务已保留");
      } else if (code === "RECOVERY_CONFLICT" || code === "RECOVERY_CASE_CONFLICT" || code === "RECOVERY_CAS_CONFLICT") {
        reject(409, "RECOVERY_CONFLICT", "处理进度已更新，请查看最新状态");
      } else if (code === "RECOVERY_NOT_FOUND") {
        reject(404, code, "未找到可访问的处理事项");
      } else if (code === "RECOVERY_ADMIN_REQUIRED") {
        reject(403, code, "只有有效管理员可以处理此事项");
      } else if (code === "RECOVERY_INVALID_COMMAND") {
        reject(400, code, "处理操作参数无效");
      } else if (cause instanceof Error && cause.message === "input") {
        reject(400, "RECOVERY_INVALID_COMMAND", "处理操作参数无效");
      } else {
        reject(503, "RECOVERY_UNAVAILABLE", "暂时无法更新处理状态，原任务已保留");
      }
    }
  };
  return { admin: handler(true), owner: handler(false) };
}
