import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  SeedanceAuthorizationSessionCreateView,
  SeedanceAuthorizationSessionView,
  SeedanceTrustedAssetCapability,
  SeedanceTrustedBindingView,
} from "../types/seedanceTrustedAssets";
import { requestIdentity } from "./auth";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";

export type SeedanceTrustedAssetApplication = Readonly<{
  capability(ownerId: string): Promise<SeedanceTrustedAssetCapability>;
  createAuthorizationSession(input: Readonly<{
    assetId: string;
    ownerId: string;
  }>): Promise<SeedanceAuthorizationSessionCreateView>;
  createTrustedBinding(input: Readonly<{
    assetId: string;
    ownerId: string;
    providerAssetId: string;
  }>): Promise<SeedanceTrustedBindingView>;
  readAuthorizationSession(input: Readonly<{
    ownerId: string;
    sessionId: string;
  }>): Promise<SeedanceAuthorizationSessionView | undefined>;
  readTrustedBinding(input: Readonly<{
    assetId: string;
    ownerId: string;
  }>): Promise<SeedanceTrustedBindingView | undefined>;
}>;

export class SeedanceTrustedAssetApplicationError extends Error {
  constructor(
    readonly code:
      | "CAPABILITY_UNAVAILABLE"
      | "CONFLICT"
      | "ENTITLEMENT_EXPIRED"
      | "INVALID_PROVIDER_ASSET"
      | "SOURCE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "SeedanceTrustedAssetApplicationError";
  }
}

let application: SeedanceTrustedAssetApplication | undefined;

export function configureSeedanceTrustedAssetApplication(
  next: SeedanceTrustedAssetApplication,
) {
  if (application && application !== next) {
    throw new Error("Seedance trusted-asset application is already configured");
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
  return identity
    ? identity.bypass ? "__test__" : identity.userId
    : undefined;
}

function identifier(value: string) {
  return /^[A-Za-z0-9._-]{1,160}$/.test(value) ? value : undefined;
}

function unavailable(response: ServerResponse) {
  json(response, 503, {
    code: "SEEDANCE_TRUSTED_ASSET_UNAVAILABLE",
    error: "角色可信素材服务尚未就绪",
  });
}

function applicationFailure(
  response: ServerResponse,
  error: SeedanceTrustedAssetApplicationError,
) {
  const status = error.code === "SOURCE_NOT_FOUND"
    ? 404
    : error.code === "CONFLICT"
    ? 409
    : error.code === "INVALID_PROVIDER_ASSET"
    ? 400
    : 503;
  json(response, status, { code: error.code, error: error.message });
}

export async function seedanceTrustedAssetApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const owner = ownerId(request);
  if (!owner) {
    json(response, 401, { code: "AUTH_REQUIRED", error: "请先登录" });
    return;
  }
  if (!application) {
    unavailable(response);
    return;
  }
  try {
    const path = decodedRequestPath(request).replace(/^\/+|\/+$/g, "");
    if (path === "trusted-assets/capability") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      json(response, 200, await application.capability(owner));
      return;
    }
    const session = path.match(/^authorization-sessions\/([^/]+)$/);
    const sessionId = session ? identifier(session[1] ?? "") : undefined;
    if (session && !sessionId) {
      json(response, 400, { code: "SESSION_ID_INVALID", error: "授权会话无效" });
      return;
    }
    if (sessionId) {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      const result = await application.readAuthorizationSession({
        ownerId: owner,
        sessionId,
      });
      if (!result) {
        json(response, 404, { code: "SESSION_NOT_FOUND", error: "授权会话不存在" });
        return;
      }
      json(response, 200, result);
      return;
    }
    json(response, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof HttpRequestError) {
      json(response, error.statusCode, { code: error.code, error: error.message });
    } else if (error instanceof SeedanceTrustedAssetApplicationError) {
      applicationFailure(response, error);
    } else {
      json(response, 500, { error: "角色可信素材请求失败" });
    }
  }
}

export async function seedanceTrustedAssetMediaApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const owner = ownerId(request);
  if (!owner) {
    json(response, 401, { code: "AUTH_REQUIRED", error: "请先登录" });
    return;
  }
  if (!application) {
    unavailable(response);
    return;
  }
  try {
    const path = decodedRequestPath(request).replace(/^\/+|\/+$/g, "");
    const match = path.match(
      /^([^/]+)\/seedance\/(authorization-sessions|trusted-binding|trusted-bindings)$/,
    );
    const assetId = match ? identifier(match[1] ?? "") : undefined;
    if (match && !assetId) {
      json(response, 400, { code: "ASSET_ID_INVALID", error: "图片素材无效" });
      return;
    }
    if (!match || !assetId) {
      json(response, 404, { error: "Not found" });
      return;
    }
    const operation = match[2];
    if (operation === "authorization-sessions") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      json(response, 202, await application.createAuthorizationSession({
        assetId,
        ownerId: owner,
      }));
      return;
    }
    if (operation === "trusted-binding") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      const result = await application.readTrustedBinding({
        assetId,
        ownerId: owner,
      });
      if (!result) {
        json(response, 404, { code: "BINDING_NOT_FOUND", error: "可信素材关联不存在" });
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
    const body = await readJsonBody<{ providerAssetId?: unknown }>(
      request,
      2 * 1024,
    );
    const providerAssetId = typeof body?.providerAssetId === "string"
      ? identifier(body.providerAssetId)
      : undefined;
    if (!providerAssetId) {
      json(response, 400, {
        code: "PROVIDER_ASSET_ID_INVALID",
        error: "方舟素材标识无效",
      });
      return;
    }
    json(response, 202, await application.createTrustedBinding({
      assetId,
      ownerId: owner,
      providerAssetId,
    }));
  } catch (error) {
    if (error instanceof HttpRequestError) {
      json(response, error.statusCode, { code: error.code, error: error.message });
    } else if (error instanceof SeedanceTrustedAssetApplicationError) {
      applicationFailure(response, error);
    } else {
      json(response, 500, { error: "角色可信素材请求失败" });
    }
  }
}

export const seedanceTrustedAssetApplicationApi = Object.freeze({
  configure: configureSeedanceTrustedAssetApplication,
  httpHandler: seedanceTrustedAssetApi,
  mediaHttpHandler: seedanceTrustedAssetMediaApi,
});
