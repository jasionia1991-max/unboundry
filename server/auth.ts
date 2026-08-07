import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { deletePrivateAliyunOssObject } from "./aliyunOss";
import { recordAudit } from "./audit";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  accountPermissionSet,
  hasPermission,
  setAccountPermissions,
} from "./permissions";
import { storageProfileForMedia } from "./secureStorageProfiles";
import {
  ALL_PERMISSIONS,
  type AccountPermission,
} from "../types/accountPermissions";

export type RequestIdentity = {
  bypass: boolean;
  displayName: string;
  role: "admin" | "user";
  userId: string;
};

type UserRow = {
  display_name: string;
  id: string;
  login_name: string;
  password_hash: string;
  role: "admin" | "user";
  status: "active" | "disabled";
};

type UserInput = {
  displayName?: unknown;
  loginName?: unknown;
  password?: unknown;
};

const cookieName = "unboundry_session";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const requestIdentities = new WeakMap<IncomingMessage, RequestIdentity>();
// 用户 ID 支持 UUID 与测试/早期写入的非 UUID ID（如 __test__、cua-tester）。
const userIdPattern = /^[a-z0-9._-]{1,80}$/i;
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

function cookieValue(request: IncomingMessage, name: string) {
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const [candidate, ...value] = part.trim().split("=");
    if (candidate === name) return value.join("=");
  }
}

function sessionCookie(token: string, maxAge: number) {
  const secure =
    process.env.UNBOUNDRY_SECURE_COOKIES === "1" ||
    process.env.NODE_ENV === "production";
  return [
    `${cookieName}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function passwordInput(input: UserInput) {
  const loginName =
    typeof input.loginName === "string"
      ? input.loginName.trim().toLocaleLowerCase()
      : "";
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (
    !/^[a-z0-9][a-z0-9._-]{2,39}$/i.test(loginName) ||
    displayName.length < 1 ||
    displayName.length > 60 ||
    password.length < 12 ||
    password.length > 200
  ) {
    throw new Error("账号名需为 3–40 位，密码至少 12 位");
  }
  return { displayName, loginName, password };
}

async function readBody<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1_024) throw new Error("请求内容过大");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16_384, p: 1, r: 8 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derivePassword(password, salt);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, encoded?: string) {
  const fallback =
    "scrypt$16384$8$1$00000000000000000000000000000000$" + "00".repeat(64);
  const parts = (encoded ?? fallback).split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "16384" ||
    parts[2] !== "8" ||
    parts[3] !== "1"
  ) {
    return false;
  }
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  const actual = await derivePassword(password, salt);
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

function publicUser(row: UserRow) {
  return {
    displayName: row.display_name,
    id: row.id,
    loginName: row.login_name,
    role: row.role,
    status: row.status,
  };
}

/**
 * 真实客户端地址。应用直接暴露时用 socket 地址；
 * 部署在反代（Caddy/nginx）后面时（UNBOUNDRY_TRUST_PROXY=1）取
 * X-Forwarded-For 的第一个 IP，防止把反代当成本机而放开管理边界。
 */
export function clientAddress(request: IncomingMessage) {
  if (process.env.UNBOUNDRY_TRUST_PROXY === "1") {
    const forwarded = String(request.headers["x-forwarded-for"] ?? "")
      .split(",")[0]
      ?.trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress ?? "";
}

function isLoopback(request: IncomingMessage) {
  const address = clientAddress(request);
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function isMutationAllowed(request: IncomingMessage) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method ?? "")) return true;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function existingMedia() {
  const directory = join(appDataDirectory(), "media");
  const entries: Array<{
    byteSize: number;
    id: string;
    kind: "audio" | "image" | "video";
    storageName: string;
  }> = [];
  try {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (!item.isFile() || item.name.endsWith(".uploading")) continue;
      const extension = item.name.split(".").at(-1)?.toLocaleLowerCase();
      const kind =
        extension === "png"
          ? "image"
          : extension === "mp4"
            ? "video"
            : ["wav", "mp3", "m4a", "aac"].includes(extension ?? "")
              ? "audio"
              : undefined;
      if (!kind) continue;
      entries.push({
        byteSize: (await stat(join(directory, item.name))).size,
        id: kind === "image" ? item.name.replace(/\.png$/i, "") : item.name,
        kind,
        storageName: item.name,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return entries;
}

function createSession(
  store: DatabaseSync,
  userId: string,
  response: ServerResponse,
) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  store
    .prepare(`
      INSERT INTO sessions (
        id, token_hash, user_id, expires_at, created_at, last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      tokenHash(token),
      userId,
      new Date(now.getTime() + sessionLifetimeMs).toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
  response.setHeader(
    "Set-Cookie",
    sessionCookie(token, Math.floor(sessionLifetimeMs / 1_000)),
  );
}

function clearSession(request: IncomingMessage, response: ServerResponse) {
  const token = cookieValue(request, cookieName);
  if (token) {
    db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }
  response.setHeader("Set-Cookie", sessionCookie("", 0));
}

async function authenticate(request: IncomingMessage) {
  const token = cookieValue(request, cookieName);
  if (!token) return undefined;
  const row = db()
    .prepare(`
      SELECT
        users.id,
        users.login_name,
        users.display_name,
        users.password_hash,
        users.role,
        users.status
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE
        sessions.token_hash = ?
        AND sessions.expires_at > ?
        AND users.status = 'active'
    `)
    .get(tokenHash(token), new Date().toISOString()) as UserRow | undefined;
  if (!row) return undefined;
  const identity: RequestIdentity = {
    bypass: false,
    displayName: row.display_name,
    role: row.role,
    userId: row.id,
  };
  requestIdentities.set(request, identity);
  return { identity, row };
}

export function requestIdentity(request: IncomingMessage) {
  return requestIdentities.get(request);
}

export async function authGate(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  if (process.env.UNBOUNDRY_TEST_AUTH_BYPASS === "1") {
    const timestamp = new Date().toISOString();
    db()
      .prepare(`
        INSERT OR IGNORE INTO users (
          id, login_name, display_name, password_hash, role, status,
          created_at, updated_at
        )
        VALUES (
          '__test__', '__test__', 'Test User', 'test-only', 'admin', 'active',
          ?, ?
        )
      `)
      .run(timestamp, timestamp);
    requestIdentities.set(request, {
      bypass: true,
      displayName: "Test User",
      role: "admin",
      userId: "__test__",
    });
    next();
    return;
  }
  if (!isMutationAllowed(request)) {
    json(response, 403, { error: "请求来源无效" });
    return;
  }
  if (!(await authenticate(request))) {
    json(response, 401, { error: "请先登录" });
    return;
  }
  next();
}

export async function authApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );
  const store = db();

  if (request.method === "GET" && path === "status") {
    if (process.env.UNBOUNDRY_TEST_AUTH_BYPASS === "1") {
      json(response, 200, {
        authenticated: true,
        bootstrapRequired: false,
        user: {
          displayName: "Test User",
          id: "__test__",
          loginName: "test-user",
          role: "admin",
          status: "active",
        },
      });
      return;
    }
    const count = Number(
      (store.prepare("SELECT COUNT(*) AS count FROM users").get() as {
        count: number;
      }).count,
    );
    const session = await authenticate(request);
    json(response, 200, {
      authenticated: Boolean(session),
      bootstrapRequired: count === 0,
      user: session ? publicUser(session.row) : undefined,
    });
    return;
  }

  if (request.method === "POST" && path === "bootstrap") {
    if (!isMutationAllowed(request)) {
      json(response, 403, { error: "请求来源无效" });
      return;
    }
    if (!isLoopback(request) && process.env.UNBOUNDRY_BOOTSTRAP_REMOTE !== "1") {
      json(response, 403, { error: "首次管理员只能在服务器本机创建" });
      return;
    }
    try {
      const input = passwordInput(await readBody<UserInput>(request));
      const passwordHash = await hashPassword(input.password);
      const media = await existingMedia();
      const userId = randomUUID();
      const timestamp = new Date().toISOString();
      store.exec("BEGIN IMMEDIATE");
      try {
        const count = Number(
          (store.prepare("SELECT COUNT(*) AS count FROM users").get() as {
            count: number;
          }).count,
        );
        if (count !== 0) throw new Error("管理员已经创建");
        store
          .prepare(`
            INSERT INTO users (
              id, login_name, display_name, password_hash, role, status,
              created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)
          `)
          .run(
            userId,
            input.loginName,
            input.displayName,
            passwordHash,
            timestamp,
            timestamp,
          );
        store
          .prepare("UPDATE canvas_documents SET owner_id = ? WHERE owner_id IS NULL")
          .run(userId);
        store
          .prepare("UPDATE project_metadata SET owner_id = ? WHERE owner_id IS NULL")
          .run(userId);
        store
          .prepare("UPDATE asset_history SET owner_id = ? WHERE owner_id IS NULL")
          .run(userId);
        store
          .prepare("UPDATE generation_tasks SET owner_id = ? WHERE owner_id IS NULL")
          .run(userId);
        const register = store.prepare(`
          INSERT OR IGNORE INTO media_assets (
            kind, id, owner_id, storage_name, byte_size, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of media) {
          register.run(
            item.kind,
            item.id,
            userId,
            item.storageName,
            item.byteSize,
            timestamp,
            timestamp,
          );
        }
        recordAudit(store, userId, "bootstrap_admin", userId, {
          claimedMedia: media.length,
        });
        createSession(store, userId, response);
        store.exec("COMMIT");
      } catch (error) {
        store.exec("ROLLBACK");
        throw error;
      }
      await import("./providerProfiles")
        .then((module) => module.migrateLegacyProviderKeysIfNeeded())
        .catch(() => undefined);
      const row = store
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(userId) as UserRow;
      json(response, 201, { user: publicUser(row) });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法创建管理员";
      json(response, message === "管理员已经创建" ? 409 : 400, {
        error: message,
      });
    }
    return;
  }

  if (request.method === "POST" && path === "login") {
    if (!isMutationAllowed(request)) {
      json(response, 403, { error: "请求来源无效" });
      return;
    }
    try {
      const body = await readBody<{ loginName?: unknown; password?: unknown }>(
        request,
      );
      const loginName =
        typeof body.loginName === "string"
          ? body.loginName.trim().toLocaleLowerCase()
          : "";
      const password = typeof body.password === "string" ? body.password : "";
      const row = store
        .prepare("SELECT * FROM users WHERE login_name = ? COLLATE NOCASE")
        .get(loginName) as UserRow | undefined;
      const valid = await verifyPassword(password, row?.password_hash);
      if (!valid || !row || row.status !== "active") {
        json(response, 401, { error: "账号或密码不正确，或账号已停用" });
        return;
      }
      createSession(store, row.id, response);
      json(response, 200, { user: publicUser(row) });
    } catch {
      json(response, 400, { error: "登录信息无效" });
    }
    return;
  }

  if (request.method === "POST" && path === "logout") {
    if (!isMutationAllowed(request)) {
      json(response, 403, { error: "请求来源无效" });
      return;
    }
    clearSession(request, response);
    json(response, 200, { loggedOut: true });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  json(response, 404, { error: "登录接口不存在" });
}

export function accountContextApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "账号上下文只支持读取" });
    return;
  }
  const identity = requestIdentity(request);
  if (!identity) {
    json(response, 401, { error: "请先登录" });
    return;
  }
  const row = db().prepare("SELECT * FROM users WHERE id = ?").get(
    identity.userId,
  ) as UserRow | undefined;
  if (!row) {
    json(response, 404, { error: "账号不存在" });
    return;
  }
  const permissionList: AccountPermission[] =
    row.role === "admin"
      ? [...ALL_PERMISSIONS]
      : [...accountPermissionSet(db(), row.id)].sort(
          (left, right) =>
            ALL_PERMISSIONS.indexOf(left) - ALL_PERMISSIONS.indexOf(right),
        );
  const has = (permission: AccountPermission) =>
    permissionList.includes(permission);
  json(response, 200, {
    legacyPermissions: {
      manageOwnCredentials: has("manage_own_credentials"),
      manageAccounts: has("manage_accounts"),
      manageModels: has("manage_models"),
      manageProviders: has("manage_providers"),
      manageStorage: has("manage_storage"),
      readOwnData: true,
      submitOwnTasks: true,
      writeOwnData: true,
    },
    permissions: permissionList,
    user: publicUser(row),
    workspace: {
      id: `personal:${row.id}`,
      teamEnabled: false,
      type: "personal",
    },
  });
}

export async function adminUsersApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (!isMutationAllowed(request)) {
    json(response, 403, { error: "请求来源无效" });
    return;
  }
  const identity = requestIdentity(request);
  if (!identity || !hasPermission(identity, "manage_accounts")) {
    json(response, 403, { error: "只有管理员可以操作账号" });
    return;
  }
  const store = db();
  const path = decodeURIComponent((request.url ?? "").split("?")[0]).replace(
    /^\/+/,
    "",
  );

  const permissionMatch = path.match(
    /^([a-z0-9._-]{1,80})\/permissions$/i,
  );
  if (permissionMatch) {
    if (!hasPermission(identity, "manage_permissions")) {
      json(response, 403, { error: "需要权限管理权限" });
      return;
    }
    const targetId = permissionMatch[1];
    const target = store
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(targetId) as { role: "admin" | "user" } | undefined;
    if (!target) {
      json(response, 404, { error: "账号不存在" });
      return;
    }
    if (request.method === "GET") {
      const permissions: AccountPermission[] =
        target.role === "admin"
          ? [...ALL_PERMISSIONS]
          : [...accountPermissionSet(store, targetId)].sort(
              (left, right) =>
                ALL_PERMISSIONS.indexOf(left) - ALL_PERMISSIONS.indexOf(right),
            );
      json(response, 200, { permissions });
      return;
    }
    if (request.method === "PUT") {
      try {
        const body = await readBody<{ permissions?: unknown }>(request);
        if (!Array.isArray(body.permissions)) {
          throw new Error("权限列表无效");
        }
        const { added, removed } = setAccountPermissions(
          store,
          identity.userId,
          targetId,
          body.permissions,
        );
        const permissions: AccountPermission[] = [
          ...accountPermissionSet(store, targetId),
        ].sort(
          (left, right) =>
            ALL_PERMISSIONS.indexOf(left) - ALL_PERMISSIONS.indexOf(right),
        );
        json(response, 200, { added, permissions, removed });
      } catch (error) {
        const message = error instanceof Error ? error.message : "权限保存失败";
        json(response, message === "账号不存在" ? 404 : 400, {
          error: message,
        });
      }
      return;
    }
    response.setHeader("Allow", "GET, PUT");
    json(response, 405, { error: "权限接口只支持读取与写入" });
    return;
  }

  if (request.method === "GET" && !path) {
    const users = (
      store
        .prepare(`
          SELECT id, login_name, display_name, role, status
          FROM users
          ORDER BY created_at ASC
        `)
        .all() as UserRow[]
    ).map(publicUser);
    json(response, 200, { users });
    return;
  }

  if (request.method === "POST" && !path) {
    try {
      const input = passwordInput(await readBody<UserInput>(request));
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      store
        .prepare(`
          INSERT INTO users (
            id, login_name, display_name, password_hash, role, status,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)
        `)
        .run(
          id,
          input.loginName,
          input.displayName,
          await hashPassword(input.password),
          timestamp,
          timestamp,
        );
      recordAudit(store, identity.userId, "create_user", id, {
        loginName: input.loginName,
      });
      const row = store.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
      json(response, 201, { user: publicUser(row) });
    } catch (error) {
      const message = String((error as Error).message ?? "");
      json(response, /UNIQUE/i.test(message) ? 409 : 400, {
        error: /UNIQUE/i.test(message) ? "账号名已存在" : "账号信息无效",
      });
    }
    return;
  }

  if (request.method === "PATCH" && userIdPattern.test(path)) {
    try {
      const body = await readBody<{ status?: unknown }>(request);
      if (body.status !== "active" && body.status !== "disabled") {
        throw new Error("Invalid status");
      }
      if (path === identity.userId && body.status === "disabled") {
        json(response, 400, { error: "不能停用当前登录的管理员" });
        return;
      }
      const result = store
        .prepare(`
          UPDATE users SET status = ?, updated_at = ? WHERE id = ?
        `)
        .run(body.status, new Date().toISOString(), path);
      if (result.changes !== 1) {
        json(response, 404, { error: "账号不存在" });
        return;
      }
      if (body.status === "disabled") {
        store.prepare("DELETE FROM sessions WHERE user_id = ?").run(path);
      }
      recordAudit(store, identity.userId, "set_user_status", path, {
        status: body.status,
      });
      const row = store.prepare("SELECT * FROM users WHERE id = ?").get(path) as UserRow;
      json(response, 200, { user: publicUser(row) });
    } catch {
      json(response, 400, { error: "账号状态无效" });
    }
    return;
  }

  if (request.method === "DELETE" && userIdPattern.test(path)) {
    try {
      const targetId = path;
      if (targetId === identity.userId) {
        json(response, 400, { error: "不能删除当前登录的管理员账号" });
        return;
      }
      const target = store.prepare("SELECT * FROM users WHERE id = ?").get(
        targetId,
      ) as UserRow | undefined;
      if (!target) {
        json(response, 404, { error: "账号不存在" });
        return;
      }
      if (target.role === "admin") {
        const activeAdmins = Number(
          (
            store
              .prepare(`
                SELECT COUNT(*) AS count
                FROM users
                WHERE role = 'admin' AND status = 'active'
              `)
              .get() as { count: number }
          ).count,
        );
        if (activeAdmins <= 1) {
          json(response, 400, { error: "不能删除最后一个管理员账号" });
          return;
        }
      }

      const mediaRows = store
        .prepare(`
          SELECT storage_backend, storage_name, object_key, storage_profile_id
          FROM media_assets
          WHERE owner_id = ?
        `)
        .all(targetId) as Array<{
        objectKey: string | null;
        storageBackend: string;
        storageProfileId: string | null;
        storageName: string;
      }>;

      store.exec("BEGIN IMMEDIATE");
      try {
        store.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
        store
          .prepare(`
            DELETE FROM generation_provider_attempts
            WHERE task_id IN (
              SELECT id FROM generation_tasks WHERE owner_id = ?
            )
          `)
          .run(targetId);
        store
          .prepare(`
            DELETE FROM generation_task_events
            WHERE task_id IN (
              SELECT id FROM generation_tasks WHERE owner_id = ?
            )
          `)
          .run(targetId);
        store.prepare("DELETE FROM generation_tasks WHERE owner_id = ?").run(targetId);
        store
          .prepare("DELETE FROM account_provider_credentials WHERE account_id = ?")
          .run(targetId);
        store
          .prepare("DELETE FROM account_permissions WHERE account_id = ?")
          .run(targetId);
        store
          .prepare("DELETE FROM account_permissions WHERE granted_by = ?")
          .run(targetId);
        store.prepare("DELETE FROM canvas_documents WHERE owner_id = ?").run(targetId);
        store.prepare("DELETE FROM project_metadata WHERE owner_id = ?").run(targetId);
        store
          .prepare("DELETE FROM asset_history WHERE owner_id = ? OR account_id = ?")
          .run(targetId, targetId);
        store.prepare("DELETE FROM media_assets WHERE owner_id = ?").run(targetId);
        store
          .prepare(
            "DELETE FROM admin_audit_events WHERE actor_user_id = ? OR target_user_id = ?",
          )
          .run(targetId, targetId);
        const removed = store.prepare("DELETE FROM users WHERE id = ?").run(targetId);
        if (removed.changes !== 1) {
          store.exec("ROLLBACK");
          json(response, 404, { error: "账号不存在" });
          return;
        }
        const leftoverPermissions = Number(
          (
            store
              .prepare(`
                SELECT COUNT(*) AS count
                FROM account_permissions
                WHERE account_id = ? OR granted_by = ?
              `)
              .get(targetId, targetId) as { count: number }
          ).count,
        );
        if (leftoverPermissions !== 0) {
          store.exec("ROLLBACK");
          throw new Error("账号权限行清理失败");
        }
        store.exec("COMMIT");
      } catch (error) {
        store.exec("ROLLBACK");
        throw error;
      }

      recordAudit(store, identity.userId, "delete_user", targetId, {
        loginName: target.login_name,
        role: target.role,
      });
      await removeAccountMediaFiles(mediaRows);
      json(response, 200, { deleted: true, userId: targetId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "账号删除失败";
      json(response, 400, { error: message });
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  json(response, 404, { error: "账号接口不存在" });
}

async function removeAccountMediaFiles(
  rows: Array<{
    objectKey: string | null;
    storageBackend: string;
    storageProfileId: string | null;
    storageName: string;
  }>,
) {
  for (const row of rows) {
    try {
      if (row.storageBackend === "oss") {
        const profile = await storageProfileForMedia(row);
        if (profile && row.objectKey) {
          await deletePrivateAliyunOssObject(row.objectKey, profile);
        }
      } else if (
        row.storageName &&
        basename(row.storageName) === row.storageName
      ) {
        await rm(join(appDataDirectory(), "media", row.storageName), {
          force: true,
        });
      }
    } catch {
      // 账号删除不因媒体文件清理失败而中断；记录行已删除，残留文件由存储清理兜底。
    }
  }
}
