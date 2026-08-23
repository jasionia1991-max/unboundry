import type { IncomingMessage, ServerResponse } from "node:http";
import { requestIdentity } from "./auth";
import {
  imageToolCapabilitySnapshot,
  type ImageToolGenerationCapability,
} from "./imageToolCapabilityRegistry";

let generationCapabilityQuery:
  | ((ownerId: string) => Promise<ImageToolGenerationCapability>)
  | undefined;

export function configureImageToolGenerationCapabilityQuery(
  query: (ownerId: string) => Promise<ImageToolGenerationCapability>,
) {
  if (generationCapabilityQuery && generationCapabilityQuery !== query) {
    throw new Error("Image tool generation capability query is already configured");
  }
  generationCapabilityQuery = query;
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

export const imageToolApplicationApi = Object.freeze({
  configureGenerationCapabilityQuery:
    configureImageToolGenerationCapabilityQuery,
  httpHandler: imageToolCapabilitiesApi,
});
