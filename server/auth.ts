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
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import {
  accountPermissionSet,
  hasPermission,
  setAccountPermissions,
} from "./permissions";
import { storageProfileForDestructiveMedia } from "./secureStorageProfiles";
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
  protected: number;
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
const processStartupAccountDeleteCutoff = new Date().toISOString();

type AccountMediaRow = {
  id: string;
  kind: "audio" | "image" | "video";
  object_key: string | null;
  storage_backend: string;
  storage_name: string;
  storage_profile_id: string | null;
};

class AccountDeletionActiveError extends Error {}
class AccountDeletionGenerationActiveError extends Error {}
class AccountDeletionReferencedError extends Error {}
class AccountMediaCleanupError extends Error {}

export type AdminUsersExecution = Readonly<{
  beforePhysicalMediaDelete?: (row: Readonly<AccountMediaRow>) =>
    Promise<void> | void;
  deleteExternalObject?: typeof deletePrivateAliyunOssObject;
}>;
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

function passwordOnlyInput(value: unknown) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 12 || password.length > 200) {
    throw new Error("密码至少 12 位");
  }
  return password;
}

function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16_384, p: 1, r: 8 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
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
    protected: Boolean(row.protected),
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
        users.protected,
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
  const path = decodedRequestPath(request).replace(
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
          protected: true,
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
      const input = passwordInput(
        await readJsonBody<UserInput>(request, 64 * 1_024),
      );
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
              protected, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, ?)
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
      if (error instanceof HttpRequestError) throw error;
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
      const body = await readJsonBody<{
        loginName?: unknown;
        password?: unknown;
      }>(
        request,
        64 * 1_024,
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
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      json(response, 400, { error: "登录信息无效" });
    }
    return;
  }

  if (request.method === "POST" && path === "password") {
    if (!isMutationAllowed(request)) {
      json(response, 403, { error: "请求来源无效" });
      return;
    }
    if (process.env.UNBOUNDRY_TEST_AUTH_BYPASS === "1") {
      json(response, 400, { error: "测试模式不支持修改密码" });
      return;
    }
    const session = await authenticate(request);
    if (!session) {
      json(response, 401, { error: "请先登录" });
      return;
    }
    try {
      const body = await readJsonBody<{
        currentPassword?: unknown;
        newPassword?: unknown;
      }>(request, 64 * 1_024);
      const currentPassword =
        typeof body.currentPassword === "string" ? body.currentPassword : "";
      const newPassword = passwordOnlyInput(body.newPassword);
      const valid = await verifyPassword(currentPassword, session.row.password_hash);
      if (!valid) {
        json(response, 400, { error: "当前密码不正确" });
        return;
      }
      const passwordHash = await hashPassword(newPassword);
      const currentTokenHash = tokenHash(
        cookieValue(request, cookieName) ?? "",
      );
      store
        .prepare(`
          UPDATE users
          SET password_hash = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(passwordHash, new Date().toISOString(), session.identity.userId);
      // 吊销除当前会话外的全部会话，强制其他设备重新登录。
      store
        .prepare(`
          DELETE FROM sessions
          WHERE user_id = ? AND token_hash != ?
        `)
        .run(session.identity.userId, currentTokenHash);
      recordAudit(store, session.identity.userId, "password_change", session.identity.userId, {});
      const row = store.prepare("SELECT * FROM users WHERE id = ?").get(
        session.identity.userId,
      ) as UserRow;
      json(response, 200, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      json(response, 400, {
        error: error instanceof Error ? error.message : "密码修改失败",
      });
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

export function hasActiveOwnerMediaPublications(
  store: DatabaseSync,
  ownerId: string,
) {
  return Boolean(store.prepare(`
    SELECT 1
    FROM media_publication_attempts
    WHERE owner_id = ?
      AND state IN ('reserved', 'staged', 'external-ready', 'compensating')
    LIMIT 1
  `).get(ownerId));
}

function activePublicationDeleteError(error: unknown) {
  return error instanceof Error &&
    error.message.includes("active media publication blocks");
}

function accountDeleteIntent(store: DatabaseSync, ownerId: string) {
  return store.prepare(`
    SELECT state, updated_at
    FROM account_delete_intents
    WHERE owner_id = ?
  `).get(ownerId) as { state: "failed" | "running"; updated_at: string } | undefined;
}

function beginAccountDeletion(store: DatabaseSync, ownerId: string) {
  store.exec("BEGIN IMMEDIATE");
  try {
    const intent = accountDeleteIntent(store, ownerId);
    if (
      intent?.state === "running" &&
      intent.updated_at >= processStartupAccountDeleteCutoff
    ) {
      throw new AccountDeletionActiveError("Account deletion is already active");
    }
    if (hasActiveOwnerMediaPublications(store, ownerId)) {
      throw new Error("active media publication blocks account deletion");
    }
    const activeGenerationTask = store.prepare(`
      SELECT 1 FROM generation_tasks
      WHERE owner_id = ?
        AND state IN ('queued', 'running', 'retrying', 'recovering')
      LIMIT 1
    `).get(ownerId);
    if (activeGenerationTask) {
      throw new AccountDeletionGenerationActiveError(
        "Active generation task blocks account deletion",
      );
    }
    const retainedTemplateReference = store.prepare(`
      SELECT 1 FROM user_templates WHERE owner_id = ?
      UNION ALL
      SELECT 1 FROM public_templates
      WHERE created_by = ? OR updated_by = ?
      LIMIT 1
    `).get(ownerId, ownerId, ownerId);
    if (retainedTemplateReference) {
      throw new AccountDeletionReferencedError(
        "Account is retained by template ownership",
      );
    }
    const timestamp = new Date().toISOString();
    if (!intent) {
      store.prepare(`
        INSERT INTO account_delete_intents (
          owner_id, state, error_code, retry_count, created_at, updated_at
        ) VALUES (?, 'running', NULL, 0, ?, ?)
      `).run(ownerId, timestamp, timestamp);
    } else {
      const claimed = store.prepare(`
        UPDATE account_delete_intents
        SET state = 'running', error_code = NULL,
            retry_count = retry_count + 1, updated_at = ?
        WHERE owner_id = ? AND state = ? AND updated_at = ?
      `).run(timestamp, ownerId, intent.state, intent.updated_at);
      if (claimed.changes !== 1) {
        throw new AccountDeletionActiveError("Account deletion changed concurrently");
      }
    }
    const disabled = store.prepare(`
      UPDATE users SET status = 'disabled', updated_at = ?
      WHERE id = ?
    `).run(timestamp, ownerId);
    if (disabled.changes !== 1) throw new Error("账号不存在");
    store.prepare("DELETE FROM sessions WHERE user_id = ?").run(ownerId);
    store.prepare(`
      UPDATE media_assets
      SET storage_status = 'failed', duration_status = CASE
            WHEN kind = 'image' THEN 'not-applicable' ELSE 'failed' END,
          updated_at = ?
      WHERE owner_id = ?
    `).run(timestamp, ownerId);
    store.prepare(`
      DELETE FROM asset_history WHERE owner_id = ? OR account_id = ?
    `).run(ownerId, ownerId);
    store.exec("COMMIT");
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

function markAccountDeletionFailed(store: DatabaseSync, ownerId: string) {
  store.prepare(`
    UPDATE account_delete_intents
    SET state = 'failed', error_code = 'ACCOUNT_MEDIA_CLEANUP_FAILED',
        updated_at = ?
    WHERE owner_id = ? AND state = 'running'
  `).run(new Date().toISOString(), ownerId);
}

function finishAccountDeletion(store: DatabaseSync, ownerId: string) {
  store.exec("BEGIN IMMEDIATE");
  try {
    const intent = store.prepare(`
      SELECT 1 FROM account_delete_intents
      WHERE owner_id = ? AND state = 'running'
    `).get(ownerId);
    if (!intent) throw new AccountDeletionActiveError("Account deletion claim was lost");
    if (hasActiveOwnerMediaPublications(store, ownerId)) {
      throw new Error("active media publication blocks account deletion");
    }
    store.prepare(`
      DELETE FROM generation_provider_attempts
      WHERE task_id IN (
        SELECT id FROM generation_tasks WHERE owner_id = ?
      )
    `).run(ownerId);
    store.prepare(`
      DELETE FROM generation_task_events
      WHERE task_id IN (
        SELECT id FROM generation_tasks WHERE owner_id = ?
      )
    `).run(ownerId);
    store.prepare("DELETE FROM generation_tasks WHERE owner_id = ?").run(ownerId);
    store.prepare(
      "DELETE FROM account_provider_credentials WHERE account_id = ?",
    ).run(ownerId);
    store.prepare("DELETE FROM account_permissions WHERE account_id = ?").run(ownerId);
    store.prepare("DELETE FROM account_permissions WHERE granted_by = ?").run(ownerId);
    store.prepare("DELETE FROM canvas_documents WHERE owner_id = ?").run(ownerId);
    store.prepare("DELETE FROM project_metadata WHERE owner_id = ?").run(ownerId);
    store.prepare(`
      DELETE FROM asset_history WHERE owner_id = ? OR account_id = ?
    `).run(ownerId, ownerId);
    store.prepare("DELETE FROM media_assets WHERE owner_id = ?").run(ownerId);
    store.prepare(`
      DELETE FROM admin_audit_events
      WHERE actor_user_id = ? OR target_user_id = ?
    `).run(ownerId, ownerId);
    const removed = store.prepare("DELETE FROM users WHERE id = ?").run(ownerId);
    if (removed.changes !== 1) throw new Error("账号不存在");
    const leftoverPermissions = Number((store.prepare(`
      SELECT COUNT(*) AS count
      FROM account_permissions
      WHERE account_id = ? OR granted_by = ?
    `).get(ownerId, ownerId) as { count: number }).count);
    if (leftoverPermissions !== 0) throw new Error("账号权限行清理失败");
    store.exec("COMMIT");
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

export function adminUsersApi(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>;
export function adminUsersApi(
  request: IncomingMessage,
  response: ServerResponse,
  execution: AdminUsersExecution,
): Promise<void>;
export async function adminUsersApi(
  request: IncomingMessage,
  response: ServerResponse,
  execution: AdminUsersExecution = {},
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
  const path = decodedRequestPath(request).replace(
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
      .prepare("SELECT role, protected FROM users WHERE id = ?")
      .get(targetId) as { role: "admin" | "user"; protected: number } | undefined;
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
        if (targetId === identity.userId) {
          json(response, 400, { error: "不能修改自己的权限" });
          return;
        }
        if (target.protected) {
          json(response, 403, { error: "最高权限账号受保护，不能修改权限" });
          return;
        }
        const body = await readJsonBody<{ permissions?: unknown }>(
          request,
          64 * 1_024,
        );
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
        if (error instanceof HttpRequestError) throw error;
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
          SELECT id, login_name, display_name, role, status, protected
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
      const body = await readJsonBody<UserInput & { role?: unknown }>(
        request,
        64 * 1_024,
      );
      const input = passwordInput(body);
      const role = body.role === "admin" ? "admin" : "user";
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      store
        .prepare(`
          INSERT INTO users (
            id, login_name, display_name, password_hash, role, status,
            protected, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)
        `)
        .run(
          id,
          input.loginName,
          input.displayName,
          await hashPassword(input.password),
          role,
          timestamp,
          timestamp,
        );
      recordAudit(store, identity.userId, "create_user", id, {
        loginName: input.loginName,
        role,
      });
      const row = store.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
      json(response, 201, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      const message = String((error as Error).message ?? "");
      json(response, /UNIQUE/i.test(message) ? 409 : 400, {
        error: /UNIQUE/i.test(message) ? "账号名已存在" : "账号信息无效",
      });
    }
    return;
  }

  const passwordMatch = path.match(
    /^([a-z0-9._-]{1,80})\/password$/i,
  );
  if (request.method === "POST" && passwordMatch) {
    try {
      const targetId = passwordMatch[1];
      const target = store.prepare("SELECT * FROM users WHERE id = ?").get(
        targetId,
      ) as UserRow | undefined;
      if (!target) {
        json(response, 404, { error: "账号不存在" });
        return;
      }
      if (target.protected) {
        json(response, 403, { error: "最高权限账号受保护，不能重置密码" });
        return;
      }
      const body = await readJsonBody<{ newPassword?: unknown }>(
        request,
        64 * 1_024,
      );
      const newPassword = passwordOnlyInput(body.newPassword);
      const passwordHash = await hashPassword(newPassword);
      store
        .prepare(`
          UPDATE users
          SET password_hash = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(passwordHash, new Date().toISOString(), targetId);
      // 管理员重置密码后吊销目标账号全部会话。
      store.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
      recordAudit(store, identity.userId, "reset_password", targetId, {});
      const row = store.prepare("SELECT * FROM users WHERE id = ?").get(
        targetId,
      ) as UserRow;
      json(response, 200, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      json(response, 400, {
        error: error instanceof Error ? error.message : "密码重置失败",
      });
    }
    return;
  }

  if (request.method === "PATCH" && userIdPattern.test(path)) {
    try {
      const body = await readJsonBody<{
        role?: unknown;
        status?: unknown;
      }>(request, 64 * 1_024);
      if (
        body.status !== undefined &&
        body.status !== "active" &&
        body.status !== "disabled"
      ) {
        throw new Error("Invalid status");
      }
      if (
        body.role !== undefined &&
        body.role !== "admin" &&
        body.role !== "user"
      ) {
        throw new Error("Invalid role");
      }
      if (body.status === undefined && body.role === undefined) {
        throw new Error("No change");
      }
      const target = store.prepare("SELECT * FROM users WHERE id = ?").get(
        path,
      ) as UserRow | undefined;
      if (!target) {
        json(response, 404, { error: "账号不存在" });
        return;
      }
      if (target.protected) {
        json(response, 403, { error: "最高权限账号受保护，不能修改" });
        return;
      }
      if (path === identity.userId && body.status === "disabled") {
        json(response, 400, { error: "不能停用当前登录的管理员" });
        return;
      }
      if (path === identity.userId && body.role !== undefined) {
        json(response, 400, { error: "不能修改自己的角色" });
        return;
      }
      if (body.status !== undefined) {
        store
          .prepare(`
            UPDATE users SET status = ?, updated_at = ? WHERE id = ?
          `)
          .run(body.status, new Date().toISOString(), path);
        if (body.status === "disabled") {
          store.prepare("DELETE FROM sessions WHERE user_id = ?").run(path);
        }
        recordAudit(store, identity.userId, "set_user_status", path, {
          status: body.status,
        });
      }
      if (body.role !== undefined) {
        store
          .prepare(`
            UPDATE users SET role = ?, updated_at = ? WHERE id = ?
          `)
          .run(body.role, new Date().toISOString(), path);
        recordAudit(store, identity.userId, "set_user_role", path, {
          role: body.role,
        });
      }
      const row = store.prepare("SELECT * FROM users WHERE id = ?").get(path) as UserRow;
      json(response, 200, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (
        error instanceof Error &&
        error.message.includes("account deletion blocks user reactivation")
      ) {
        json(response, 409, {
          code: "ACCOUNT_DELETE_ACTIVE",
          error: "账号删除正在进行，不能重新启用",
        });
        return;
      }
      json(response, 400, {
        error: error instanceof Error ? error.message : "账号修改无效",
      });
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
      if (target.protected) {
        json(response, 403, { error: "最高权限账号受保护，不能删除" });
        return;
      }
      const existingDeleteIntent = accountDeleteIntent(store, targetId);
      if (target.role === "admin" && !existingDeleteIntent) {
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

      beginAccountDeletion(store, targetId);
      const mediaRows = store.prepare(`
        SELECT
          id, kind, storage_backend, storage_name, object_key,
          storage_profile_id
        FROM media_assets
        WHERE owner_id = ?
        ORDER BY kind, id
      `).all(targetId) as AccountMediaRow[];
      try {
        await removeAccountMediaFiles(mediaRows, execution);
      } catch (error) {
        markAccountDeletionFailed(store, targetId);
        throw new AccountMediaCleanupError(
          error instanceof Error ? error.message : "账号媒体清理失败",
        );
      }
      try {
        finishAccountDeletion(store, targetId);
      } catch (error) {
        markAccountDeletionFailed(store, targetId);
        throw error;
      }

      recordAudit(store, identity.userId, "delete_user", targetId, {
        loginName: target.login_name,
        role: target.role,
      });
      json(response, 200, { deleted: true, userId: targetId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "账号删除失败";
      if (activePublicationDeleteError(error)) {
        json(response, 409, {
          code: "MEDIA_PUBLICATION_ACTIVE",
          error: "账号仍有媒体正在收口，请稍后再删除",
        });
      } else if (error instanceof AccountDeletionActiveError) {
        json(response, 409, {
          code: "ACCOUNT_DELETE_ACTIVE",
          error: "账号删除正在进行，请稍后重试",
        });
      } else if (error instanceof AccountDeletionGenerationActiveError) {
        json(response, 409, {
          code: "ACCOUNT_DELETE_TASK_ACTIVE",
          error: "账号仍有生成任务正在执行，请先等待或取消任务",
        });
      } else if (error instanceof AccountDeletionReferencedError) {
        json(response, 409, {
          code: "ACCOUNT_DELETE_REFERENCED",
          error: "账号仍被模板引用，暂不能删除",
        });
      } else if (error instanceof AccountMediaCleanupError) {
        json(response, 503, {
          code: "ACCOUNT_MEDIA_CLEANUP_FAILED",
          error: "账号媒体未能安全清理，可重试删除",
        });
      } else {
        json(response, 400, { error: message });
      }
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  json(response, 404, { error: "账号接口不存在" });
}

async function removeAccountMediaFiles(
  rows: readonly AccountMediaRow[],
  execution: AdminUsersExecution,
) {
  const profiles = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof storageProfileForDestructiveMedia>>>
  >();
  for (const row of rows) {
    if (row.storage_backend === "local") {
      if (
        !row.storage_name ||
        basename(row.storage_name) !== row.storage_name
      ) {
        throw new Error("Local media path is invalid");
      }
      continue;
    }
    if (row.storage_backend !== "oss") {
      throw new Error("Media storage backend is invalid");
    }
    if (!row.object_key) throw new Error("OSS media object key is missing");
    if (!row.storage_profile_id) {
      throw new Error("OSS media profile evidence is missing");
    }
    const key = row.storage_profile_id;
    if (profiles.has(key)) continue;
    const profile = await storageProfileForDestructiveMedia({
      storageProfileId: row.storage_profile_id,
    });
    if (!profile) throw new Error("OSS media profile is unavailable");
    profiles.set(key, profile);
  }
  for (const row of rows) {
    await execution.beforePhysicalMediaDelete?.(row);
    if (row.storage_backend === "oss") {
      const profile = profiles.get(
        row.storage_profile_id ?? "",
      );
      if (!profile || !row.object_key) {
        throw new Error("OSS media cleanup evidence was lost");
      }
      await (execution.deleteExternalObject ?? deletePrivateAliyunOssObject)(
        row.object_key,
        profile,
      );
    } else {
      await rm(join(appDataDirectory(), "media", row.storage_name), {
        force: true,
      });
    }
  }
}
