import type { IncomingMessage, ServerResponse } from "node:http";
import { requestIdentity } from "./auth";
import {
  SeedanceCharacterComplianceApplicationError,
  type SeedanceCharacterComplianceApplication,
} from "./seedanceCharacterComplianceApplication";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";

let application: SeedanceCharacterComplianceApplication | undefined;

export function configureSeedanceCharacterComplianceApplication(
  next: SeedanceCharacterComplianceApplication,
) {
  if (application && application !== next) {
    throw new Error("Seedance character-compliance application is already configured");
  }
  application = next;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function ownerId(request: IncomingMessage) {
  const identity = requestIdentity(request);
  return identity ? identity.bypass ? "__test__" : identity.userId : undefined;
}

function identifier(value: string) {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : undefined;
}

function failure(
  response: ServerResponse,
  error: SeedanceCharacterComplianceApplicationError,
) {
  const status = error.code === "SOURCE_NOT_FOUND" || error.code === "CHECK_NOT_FOUND"
    ? 404
    : error.code === "DISCLOSURE_REQUIRED" || error.code === "CONFLICT"
    ? 409
    : 503;
  json(response, status, { code: error.code, error: error.message });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  callback: (owner: string) => Promise<void>,
) {
  const owner = ownerId(request);
  if (!owner) {
    json(response, 401, { code: "AUTH_REQUIRED", error: "请先登录" });
    return;
  }
  if (!application) {
    json(response, 503, {
      code: "CHARACTER_COMPLIANCE_UNAVAILABLE",
      error: "角色风险预检服务尚未就绪",
    });
    return;
  }
  try {
    await callback(owner);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      json(response, error.statusCode, { code: error.code, error: error.message });
    } else if (error instanceof SeedanceCharacterComplianceApplicationError) {
      failure(response, error);
    } else {
      json(response, 500, { error: "角色风险预检请求失败" });
    }
  }
}

export async function seedanceCharacterComplianceApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  return handle(request, response, async (owner) => {
    const path = decodedRequestPath(request).replace(/^\/+|\/+$/g, "");
    if (path === "capability") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      json(response, 200, await application!.capability(owner));
      return;
    }
    const cancel = path.match(/^checks\/([^/]+)\/cancel$/);
    const retry = path.match(/^checks\/([^/]+)\/retry$/);
    const check = cancel ?? retry ?? path.match(/^checks\/([^/]+)$/);
    const checkId = check ? identifier(check[1] ?? "") : undefined;
    if (check && !checkId) {
      json(response, 400, { code: "CHECK_ID_INVALID", error: "预检标识无效" });
      return;
    }
    if (!checkId) {
      json(response, 404, { error: "Not found" });
      return;
    }
    if (cancel) {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      json(response, 200, await application!.cancelCheck({ checkId, ownerId: owner }));
      return;
    }
    if (retry) {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      json(response, 200, await application!.retryCheck({ checkId, ownerId: owner }));
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      json(response, 405, { error: "Method not allowed" });
      return;
    }
    const result = await application!.readCheck({ checkId, ownerId: owner });
    if (!result) {
      json(response, 404, { code: "CHECK_NOT_FOUND", error: "预检记录不存在" });
      return;
    }
    json(response, 200, result);
  });
}

export async function seedanceCharacterComplianceMediaApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  return handle(request, response, async (owner) => {
    const path = decodedRequestPath(request).replace(/^\/+|\/+$/g, "");
    const match = path.match(
      /^([^/]+)\/seedance\/(character-compliance-checks|character-compliance-current)$/,
    );
    const assetId = match ? identifier(match[1] ?? "") : undefined;
    if (!match || !assetId) {
      json(response, match ? 400 : 404, { error: match ? "图片素材无效" : "Not found" });
      return;
    }
    if (match[2] === "character-compliance-current") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      const result = await application!.currentForSource({ assetId, ownerId: owner });
      if (!result) {
        json(response, 404, { code: "CHECK_NOT_FOUND", error: "该图片没有预检记录" });
        return;
      }
      json(response, 200, result);
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      json(response, 405, { error: "Method not allowed" });
      return;
    }
    const body = await readJsonBody<Record<string, unknown>>(request, 4 * 1024);
    const disclosureVersion = typeof body?.disclosureVersion === "string"
      ? body.disclosureVersion : "";
    const modelConfigurationRevision =
      typeof body?.modelConfigurationRevision === "string"
        ? body.modelConfigurationRevision : "";
    const modelId = typeof body?.modelId === "string" ? body.modelId : "";
    if (!identifier(disclosureVersion) || !identifier(modelConfigurationRevision) ||
        !identifier(modelId) || typeof body?.disclosureAccepted !== "boolean") {
      json(response, 400, { code: "REQUEST_INVALID", error: "角色风险预检请求无效" });
      return;
    }
    json(response, 202, await application!.createCheck({
      assetId,
      disclosureAccepted: body.disclosureAccepted,
      disclosureVersion,
      modelConfigurationRevision,
      modelId,
      ownerId: owner,
    }));
  });
}

export const seedanceCharacterComplianceApplicationApi = Object.freeze({
  configure: configureSeedanceCharacterComplianceApplication,
  httpHandler: seedanceCharacterComplianceApi,
  mediaHttpHandler: seedanceCharacterComplianceMediaApi,
});
