import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import {
  accountCredentialKey,
  accountCredentialMaskFromKey,
  accountCredentialRevision,
  accountCredentialRow,
  deleteAccountCredential,
  saveAccountCredential,
  verifyAccountCredential,
} from "./accountCredentials";
import { AccountMutationBlockedError } from "./accountMutationFence";
import { requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { listProviderProfiles } from "./providerProfiles";

const profileIdPattern = /^[a-f0-9-]{36}$/i;

let database: DatabaseSync | undefined;
let databaseDirectory = "";

function db() {
  const directory = appDataDirectory();
  if (database && databaseDirectory === directory) return database;
  database?.close();
  database = openAppDatabase();
  databaseDirectory = directory;
  return database;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function respondAccountMutationConflict(
  response: ServerResponse,
  error: unknown,
) {
  if (!(error instanceof AccountMutationBlockedError)) return false;
  json(response, 409, { code: error.code, error: error.message });
  return true;
}

async function publishedProviderProfiles(store: DatabaseSync) {
  const rows = store
    .prepare(`
      SELECT DISTINCT provider_profile_id
      FROM model_profiles
      WHERE status = 'published'
    `)
    .all() as Array<{ provider_profile_id: string }>;
  return new Set(rows.map((row) => row.provider_profile_id));
}

export async function accountCredentialsApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "请先登录" });
    return;
  }
  const store = db();
  const path = decodedRequestPath(request).replace(
    /^\/+/,
    "",
  );

  if (request.method === "GET" && !path) {
    try {
      const document = await listProviderProfiles();
      const publishedIds = await publishedProviderProfiles(store);
      const items = [];
      for (const profile of document.profiles) {
        if (!publishedIds.has(profile.id)) continue;
        const row = accountCredentialRow(store, identity.userId, profile.id);
        const key = await accountCredentialKey(
          store,
          identity.userId,
          profile.id,
        );
        items.push({
          apiKeyMask: key ? accountCredentialMaskFromKey(key) : undefined,
          baseUrl: profile.baseUrl,
          credentialVersion: row
            ? Number(row.credential_version)
            : accountCredentialRevision(store, identity.userId, profile.id),
          driver: profile.driver,
          keyCheckedAt: row?.key_checked_at ?? undefined,
          keyStatus: row?.key_status ?? "unchecked",
          label: profile.label,
          profileId: profile.id,
          updatedAt: row?.updated_at ?? undefined,
        });
      }
      json(response, 200, { items });
    } catch {
      json(response, 500, { error: "平台密钥状态读取失败" });
    }
    return;
  }

  const match = path.match(/^([a-f0-9-]{36})(?:\/(verify))?$/i);
  if (!match) {
    response.setHeader("Allow", "GET, PUT, POST, DELETE");
    json(response, 404, { error: "平台密钥接口不存在" });
    return;
  }
  const profileId = match[1].toLocaleLowerCase();
  if (!profileIdPattern.test(profileId)) {
    json(response, 404, { error: "平台密钥接口不存在" });
    return;
  }

  if (request.method === "PUT" && !match[2]) {
    try {
      const body = await readJsonBody<{ apiKey?: unknown }>(
        request,
        64 * 1_024,
      );
      const result = await saveAccountCredential(
        store,
        identity.userId,
        profileId,
        typeof body.apiKey === "string" ? body.apiKey : "",
      );
      json(response, 200, result);
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, {
        error: error instanceof Error ? error.message : "平台密钥保存失败",
      });
    }
    return;
  }

  if (request.method === "POST" && match[2] === "verify") {
    try {
      const result = await verifyAccountCredential(
        store,
        identity.userId,
        profileId,
      );
      json(response, 200, {
        keyStatus: result.keyStatus,
        verification: {
          latencyMs: result.latencyMs,
          message: result.message,
          modelCount: result.modelCount,
          status: result.status,
        },
      });
    } catch (error) {
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, {
        error: error instanceof Error ? error.message : "平台密钥校验失败",
        keyStatus: "invalid",
      });
    }
    return;
  }

  if (request.method === "DELETE" && !match[2]) {
    try {
      if (!(await deleteAccountCredential(store, identity.userId, profileId))) {
        json(response, 404, { error: "平台密钥不存在" });
        return;
      }
      json(response, 200, { deleted: true, profileId });
    } catch (error) {
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, {
        error: error instanceof Error ? error.message : "平台密钥删除失败",
      });
    }
    return;
  }

  response.setHeader("Allow", "GET, PUT, POST, DELETE");
  json(response, 404, { error: "平台密钥接口不存在" });
}
