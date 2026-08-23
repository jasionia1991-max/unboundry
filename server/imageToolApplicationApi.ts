import type { IncomingMessage, ServerResponse } from "node:http";
import {
  seedanceImageRoles,
  type SeedanceImageRole,
} from "../types/imageTools";
import { requestIdentity } from "./auth";
import { HttpRequestError, readJsonBody } from "./httpRequest";
import {
  imageToolCapabilitySnapshot,
  type ImageToolGenerationCapability,
} from "./imageToolCapabilityRegistry";
import {
  validateSeedanceAsset,
  type SeedanceValidationMedia,
  type SeedanceValidationModel,
} from "./seedanceAssetValidation";

let generationCapabilityQuery:
  | ((ownerId: string) => Promise<ImageToolGenerationCapability>)
  | undefined;
let seedanceValidationQueries: Readonly<{
  media: (ownerId: string, assetId: string) => SeedanceValidationMedia | undefined;
  model: (ownerId: string, modelId: string) => SeedanceValidationModel | undefined;
}> | undefined;

export function configureImageToolGenerationCapabilityQuery(
  query: (ownerId: string) => Promise<ImageToolGenerationCapability>,
) {
  if (generationCapabilityQuery && generationCapabilityQuery !== query) {
    throw new Error("Image tool generation capability query is already configured");
  }
  generationCapabilityQuery = query;
}

export function configureSeedanceAssetValidationQueries(
  queries: NonNullable<typeof seedanceValidationQueries>,
) {
  if (seedanceValidationQueries && seedanceValidationQueries !== queries) {
    throw new Error("Seedance asset validation queries are already configured");
  }
  seedanceValidationQueries = queries;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export async function imageToolCapabilitiesApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "Method not allowed" });
    return;
  }
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "请先登录" });
    return;
  }
  if (!generationCapabilityQuery) {
    json(response, 503, { error: "图片工具能力服务尚未就绪" });
    return;
  }
  try {
    const generation = await generationCapabilityQuery(
      identity.bypass ? "__test__" : identity.userId,
    );
    json(response, 200, imageToolCapabilitySnapshot({
      disabled: process.env.UNBOUNDRY_IMAGE_TOOL_DISABLED_OPERATIONS,
      generation,
    }));
  } catch {
    json(response, 503, { error: "图片工具能力暂时无法读取" });
  }
}

function boundedIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,160}$/.test(value)
    ? value
    : undefined;
}

export async function seedanceAssetValidationApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    json(response, 405, { error: "Method not allowed" });
    return;
  }
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "请先登录" });
    return;
  }
  if (!seedanceValidationQueries) {
    json(response, 503, { error: "Seedance 素材校验服务尚未就绪" });
    return;
  }
  try {
    const body = await readJsonBody<{
      assetId?: unknown;
      modelId?: unknown;
      role?: unknown;
    }>(request, 4 * 1024);
    const assetId = boundedIdentifier(body?.assetId);
    const modelId = boundedIdentifier(body?.modelId);
    const role = typeof body?.role === "string" &&
        (seedanceImageRoles as readonly string[]).includes(body.role)
      ? body.role as SeedanceImageRole
      : undefined;
    if (!assetId || !modelId || !role) {
      json(response, 400, { error: "素材、模型或角色无效" });
      return;
    }
    const ownerId = identity.bypass ? "__test__" : identity.userId;
    const model = seedanceValidationQueries.model(ownerId, modelId);
    if (!model) {
      json(response, 404, { error: "Seedance 模型不存在、已停用或未发布" });
      return;
    }
    const media = seedanceValidationQueries.media(ownerId, assetId);
    if (!media) {
      json(response, 404, { error: "图片不存在或无权访问" });
      return;
    }
    json(response, 200, validateSeedanceAsset({ assetId, media, model, role }));
  } catch (error) {
    if (error instanceof HttpRequestError) {
      json(response, error.statusCode, { code: error.code, error: error.message });
      return;
    }
    json(response, 500, { error: "Seedance 素材校验失败" });
  }
}

export const imageToolApplicationApi = Object.freeze({
  configureGenerationCapabilityQuery:
    configureImageToolGenerationCapabilityQuery,
  configureSeedanceValidationQueries:
    configureSeedanceAssetValidationQueries,
  httpHandler: imageToolCapabilitiesApi,
  validationHandler: seedanceAssetValidationApi,
});
