import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import {
  safeAliyunOssConnectionError,
  testAliyunOssConnection,
} from "./aliyunOss";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import { clientAddress, requestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import { hasPermission } from "./permissions";
import {
  activateStorageProfile,
  deleteStorageProfile,
  listStorageProfiles,
  markStorageProfileVerified,
  publicStorageProfile,
  readableStorageProfile,
  saveStorageProfile,
  setStorageMediaRouting,
} from "./secureStorageProfiles";

type StorageTotals = {
  bytes: number;
  checksummed: number;
  objects: number;
};

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

function localRequest(request: IncomingMessage) {
  const address = clientAddress(request);
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function secureMutationTransport(request: IncomingMessage) {
  const encrypted = Boolean(
    (request.socket as typeof request.socket & { encrypted?: boolean })
      .encrypted,
  );
  if (process.env.UNBOUNDRY_TRUST_PROXY === "1") {
    if (encrypted) return true;
    if (request.headers["x-forwarded-proto"] === "https") return true;
    // 直连应用（SSH/本机 curl）不带 X-Forwarded-For，仍按本机放行；
    // 经反代进来的请求必须携带 https 协议标记，否则拒绝存储写操作。
    if (!request.headers["x-forwarded-for"]) return localRequest(request);
    return false;
  }
  if (localRequest(request)) return true;
  if (request.headers["x-forwarded-proto"] === "https") return true;
  return encrypted;
}

function audit(
  store: DatabaseSync,
  actorUserId: string,
  action: string,
  profileId: string,
  details: Record<string, unknown> = {},
) {
  store
    .prepare(`
      INSERT INTO admin_audit_events (
        actor_user_id, action, target_user_id, details, created_at
      )
      VALUES (?, ?, NULL, ?, ?)
    `)
    .run(
      actorUserId,
      action,
      JSON.stringify({ profileId, ...details }),
      new Date().toISOString(),
    );
}

function recordStorageAudit(
  actorUserId: string,
  action: string,
  profileId: string,
  details: Record<string, unknown> = {},
) {
  const store = openAppDatabase();
  try {
    store.exec("BEGIN IMMEDIATE");
    try {
      assertAccountMutationAllowed(store, actorUserId);
      audit(store, actorUserId, action, profileId, details);
      store.exec("COMMIT");
    } catch (error) {
      if (store.isTransaction) store.exec("ROLLBACK");
      throw error;
    }
  } finally {
    store.close();
  }
}

function respondAccountMutationConflict(
  response: ServerResponse,
  error: unknown,
) {
  if (!(error instanceof AccountMutationBlockedError)) return false;
  json(response, 409, { code: error.code, error: error.message });
  return true;
}

async function statusBody() {
  const local = db()
    .prepare(`
      SELECT
        COUNT(*) AS objects,
        COALESCE(SUM(byte_size), 0) AS bytes,
        COALESCE(SUM(
          CASE WHEN checksum_sha256 IS NOT NULL THEN 1 ELSE 0 END
        ), 0) AS checksummed
      FROM media_assets
      WHERE storage_backend = 'local' AND storage_status = 'ready'
    `)
    .get() as StorageTotals;
  const document = await listStorageProfiles();
  const readable = await readableStorageProfile();
  const rawMediaRoutingEnabled = Boolean(document.mediaRoutingEnabled);
  const mediaRoutingEnabled = Boolean(
    document.mediaRoutingEnabled &&
      document.profiles.some(
        (profile) =>
          profile.id === document.activeProfileId &&
          profile.status === "active",
      ),
  );
  const ossRows = db()
    .prepare(`
      SELECT kind, COUNT(*) AS count
      FROM media_assets
      WHERE storage_backend = 'oss' AND storage_status = 'ready'
      GROUP BY kind
    `)
    .all() as Array<{ count: number; kind: "audio" | "image" | "video" }>;
  const objectCounts: Record<string, number> = {
    audio: 0,
    image: 0,
    video: 0,
  };
  for (const row of ossRows) objectCounts[row.kind] = Number(row.count);
  const ossObjects =
    objectCounts.audio + objectCounts.image + objectCounts.video;
  let warning: string | undefined;
  if (ossObjects > 0 && !readable) {
    warning = `当前有 ${ossObjects} 个云端素材，但没有可用的读取配置，这些素材暂时无法显示`;
  } else if (rawMediaRoutingEnabled && !mediaRoutingEnabled) {
    warning = "云路由开关与正式配置不一致，新素材当前仍写入本机存储";
  }
  return {
    activeBackend: mediaRoutingEnabled ? "oss" : "local",
    browserStoresSecrets: false,
    cloudRequestsEnabled: mediaRoutingEnabled,
    warning,
    local: {
      bytes: Number(local.bytes),
      checksummed: Number(local.checksummed),
      enabled: true,
      objects: Number(local.objects),
    },
    oss: {
      activeProfileId: document.activeProfileId ?? "",
      effectiveMediaRoutingEnabled: mediaRoutingEnabled,
      mediaRoutingEnabled,
      objectCounts,
      profiles: document.profiles.map(publicStorageProfile),
      provider: "aliyun-oss",
      rawMediaRoutingEnabled,
      readableProfileAvailable: Boolean(readable),
      sdkInstalled: true,
    },
  };
}

export async function adminStorageApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const identity = requestIdentity(request);
  if (!identity || !hasPermission(identity, "manage_storage")) {
    json(response, 403, { error: "Administrator access required" });
    return;
  }
  const path = decodedRequestPath(request)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (request.method === "GET" && !path) {
    try {
      json(response, 200, await statusBody());
    } catch {
      json(response, 500, { error: "Storage status is unavailable" });
    }
    return;
  }

  if (!secureMutationTransport(request)) {
    json(response, 400, { error: "HTTPS is required to change OSS settings" });
    return;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "")) {
    try {
      // Fast rejection prevents a known deletion intent from starting a
      // remote OSS verification. Each final document commit repeats this
      // check under BEGIN IMMEDIATE.
      assertAccountMutationAllowed(db(), identity.userId);
    } catch (error) {
      if (respondAccountMutationConflict(response, error)) return;
      throw error;
    }
  }

  if (request.method === "POST" && path === "profiles") {
    try {
      const profile = await saveStorageProfile(
        await readJsonBody<Record<string, unknown>>(request, 16 * 1_024),
        undefined,
        identity.userId,
        (store, committed) => {
          audit(
            store,
            identity.userId,
            "create_storage_profile",
            committed.id,
          );
        },
      );
      json(response, 201, { profile: publicStorageProfile(profile) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, { error: "OSS configuration could not be saved" });
    }
    return;
  }

  if (request.method === "POST" && path === "media-routing") {
    try {
      const body = await readJsonBody<Record<string, unknown>>(
        request,
        16 * 1_024,
      );
      if (typeof body.enabled !== "boolean") {
        throw new Error("Invalid media routing state");
      }
      const state = await setStorageMediaRouting(
        body.enabled,
        identity.userId,
        (store, committed) => {
          audit(
            store,
            identity.userId,
            committed.enabled
              ? "enable_storage_media_routing"
              : "disable_storage_media_routing",
            committed.profile?.id ?? "",
          );
        },
      );
      json(response, 200, {
        activeBackend: state.enabled ? "oss" : "local",
        mediaRoutingEnabled: state.enabled,
      });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, {
        error: "请先选择已测试通过的正式OSS配置",
      });
    }
    return;
  }

  const profileMatch = /^profiles\/([a-f0-9-]{36})$/.exec(path);
  if (request.method === "PATCH" && profileMatch) {
    try {
      const profile = await saveStorageProfile(
        await readJsonBody<Record<string, unknown>>(request, 16 * 1_024),
        profileMatch[1],
        identity.userId,
        (store, committed) => {
          audit(
            store,
            identity.userId,
            "update_storage_profile",
            committed.id,
          );
        },
      );
      json(response, 200, { profile: publicStorageProfile(profile) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, { error: "OSS configuration could not be updated" });
    }
    return;
  }

  if (request.method === "DELETE" && profileMatch) {
    try {
      await deleteStorageProfile(
        profileMatch[1],
        identity.userId,
        (store) => {
          audit(
            store,
            identity.userId,
            "delete_storage_profile",
            profileMatch[1],
          );
        },
      );
      json(response, 200, { deleted: true });
    } catch (error) {
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, { error: "OSS configuration could not be deleted" });
    }
    return;
  }

  const testMatch = /^profiles\/([a-f0-9-]{36})\/test$/.exec(path);
  if (request.method === "POST" && testMatch) {
    let checked:
      | {
          profile: Awaited<ReturnType<typeof listStorageProfiles>>["profiles"][number];
          result: Awaited<ReturnType<typeof testAliyunOssConnection>>;
        }
      | undefined;
    try {
      const document = await listStorageProfiles();
      const profile = document.profiles.find(
        (candidate) => candidate.id === testMatch[1],
      );
      if (!profile) throw new Error("Storage profile not found");
      const result = await testAliyunOssConnection(profile);
      checked = { profile, result };
    } catch (error) {
      const safeError = safeAliyunOssConnectionError(error);
      try {
        recordStorageAudit(
          identity.userId,
          "verify_storage_profile_failed",
          testMatch[1],
          { errorCode: safeError.code },
        );
      } catch (auditError) {
        if (respondAccountMutationConflict(response, auditError)) return;
        throw auditError;
      }
      json(response, 400, {
        code: safeError.code,
        error: safeError.message,
      });
      return;
    }
    const { profile: testedProfile, result: testResult } = checked;
    try {
      const verified = await markStorageProfileVerified(
        testedProfile.id,
        identity.userId,
        (store, committed) => {
          audit(store, identity.userId, "verify_storage_profile", committed.id, {
            cleanupVerified: testResult.cleanupVerified,
            signedReadVerified: testResult.signedReadVerified,
          });
        },
        testedProfile,
      );
      json(response, 200, {
        profile: publicStorageProfile(verified),
        test: {
          cleanupVerified: testResult.cleanupVerified,
          elapsedMs: testResult.elapsedMs,
          signedReadVerified: testResult.signedReadVerified,
        },
      });
    } catch (error) {
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, {
        error: "OSS verification result could not be saved",
      });
    }
    return;
  }

  const activateMatch = /^profiles\/([a-f0-9-]{36})\/activate$/.exec(path);
  if (request.method === "POST" && activateMatch) {
    try {
      const profile = await activateStorageProfile(
        activateMatch[1],
        identity.userId,
        (store, committed) => {
          audit(
            store,
            identity.userId,
            "activate_storage_profile",
            committed.id,
          );
        },
      );
      json(response, 200, {
        mediaRoutingEnabled: false,
        profile: publicStorageProfile(profile),
      });
    } catch (error) {
      if (respondAccountMutationConflict(response, error)) return;
      json(response, 400, {
        error: "Only a successfully tested configuration can be selected",
      });
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  json(response, 404, { error: "Storage endpoint not found" });
}
