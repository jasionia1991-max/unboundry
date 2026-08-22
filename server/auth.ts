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
import { rejectUnreadRequestBody } from "./boundedBody";
import { appDataDirectory, openAppDatabase } from "./database";
import {
  decodedRequestPath,
  HttpRequestError,
  readJsonBody,
} from "./httpRequest";
import {
  admitLoginAttempt,
  RequestAdmissionError,
  trustedClientAddress,
} from "./requestAdmission";
import {
  AccountPermissionMutationBlockedError,
  accountPermissionSet,
  accountExtraPermissionsFromWriteInput,
  accountPermissionSnapshot,
  hasPermission,
  setAccountExtraPermissions,
} from "./permissions";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import { storageProfileForDestructiveMedia } from "./secureStorageProfiles";
import {
  ALL_PERMISSIONS,
  type AccountPermission,
} from "../types/accountPermissions";
import {
  persistedMediaReferenceFromSource,
  persistedTemplateMediaReferences,
  type PersistedMediaReference,
} from "../types/persistedMediaSources";
import {
  claimLegacyCanvasDataCommand,
  deleteAccountCanvasDataCommand,
  deleteAccountHistoryCommand,
} from "./canvasTransactionCommands";
import {
  claimLegacyGenerationDataCommand,
  deleteAccountGenerationDataCommand,
} from "./generationTransactionCommands";
import {
  failAccountMediaDeletionCommand,
  finishAccountMediaDeletionCommand,
  preparePrivateAccountMediaDeletionCommand,
  registerLegacyMediaCommand,
  transferAccountMediaCommand,
} from "./mediaTransactionCommands";
import {
  claimLegacyProjectDataCommand,
  deleteAccountProjectDataCommand,
} from "./projectTransactionCommands";
import { transferAndDeleteAccountTemplatesCommand } from "./templateTransactionCommands";
import { executeTransactionScopedCommand } from "./transactionCommand";

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
let legacyProviderKeyMigration: (() => Promise<unknown>) | undefined;

export function configureLegacyProviderKeyMigration(
  migrate: () => Promise<unknown>,
) {
  if (legacyProviderKeyMigration && legacyProviderKeyMigration !== migrate) {
    throw new Error("Legacy Provider key migration is already configured");
  }
  legacyProviderKeyMigration = migrate;
}
const activeAccountDeletionOwners = new Set<string>();
const activeAccountDeletionActorCounts = new Map<string, number>();
const activeAccountMutationCounts = new Map<string, number>();
const nonMutatingMethods = new Set(["GET", "HEAD", "OPTIONS"]);

type AccountMediaRow = {
  id: string;
  kind: "audio" | "image" | "video";
  object_key: string | null;
  owner_id: string;
  storage_backend: string;
  storage_name: string;
  storage_profile_id: string | null;
};

class AccountDeletionActiveError extends Error {}
class AccountDeletionGenerationActiveError extends Error {}
class AccountDeletionReferencedError extends Error {}
class AccountDeletionNotFoundError extends Error {}
class AccountDeletionProtectedError extends Error {}
class AccountDeletionFinalizeError extends Error {}
class AccountMediaCleanupError extends Error {}

type AccountDeletionClaim = Readonly<{
  privateMediaCount: number;
  rootOwnerId: string;
  target: UserRow;
  transferredMediaCount: number;
  transferredTemplateCount: number;
}>;

export type AdminUsersExecution = Readonly<{
  beforeFinalAudit?: () => void;
  beforePhysicalMediaDelete?: (row: Readonly<AccountMediaRow>) =>
    Promise<void> | void;
  deleteExternalObject?: typeof deletePrivateAliyunOssObject;
}>;
export type AuthApiExecution = Readonly<{
  beforePasswordCommit?: () => Promise<void> | void;
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

function rejectMutation(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
) {
  if (!nonMutatingMethods.has((request.method ?? "GET").toUpperCase())) {
    rejectUnreadRequestBody(request, response);
  }
  json(response, status, body);
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
  return trustedClientAddress(request);
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

function authenticate(request: IncomingMessage) {
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

function registerActiveAccountMutation(
  userId: string,
  response: ServerResponse,
) {
  activeAccountMutationCounts.set(
    userId,
    (activeAccountMutationCounts.get(userId) ?? 0) + 1,
  );
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    response.off("finish", release);
    response.off("close", release);
    const remaining = (activeAccountMutationCounts.get(userId) ?? 1) - 1;
    if (remaining > 0) activeAccountMutationCounts.set(userId, remaining);
    else activeAccountMutationCounts.delete(userId);
  };
  response.once("finish", release);
  response.once("close", release);
  return release;
}

export function authGate(
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
          protected, created_at, updated_at
        )
        VALUES (
          '__test__', '__test__', 'Test User', 'test-only', 'admin', 'active',
          1, ?, ?
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
    rejectMutation(request, response, 403, { error: "请求来源无效" });
    return;
  }
  const session = authenticate(request);
  if (!session) {
    rejectMutation(request, response, 401, { error: "请先登录" });
    return;
  }
  const method = (request.method ?? "GET").toUpperCase();
  if (nonMutatingMethods.has(method)) {
    next();
    return;
  }
  if (accountDeleteIntent(db(), session.identity.userId)) {
    rejectMutation(request, response, 409, {
      code: "ACCOUNT_DELETE_ACTIVE",
      error: "账号删除正在进行，不能开始新的修改",
    });
    return;
  }
  const release = registerActiveAccountMutation(
    session.identity.userId,
    response,
  );
  try {
    next();
  } catch (error) {
    release();
    throw error;
  }
}

export function authApi(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>;
export function authApi(
  request: IncomingMessage,
  response: ServerResponse,
  execution: AuthApiExecution,
): Promise<void>;
export async function authApi(
  request: IncomingMessage,
  response: ServerResponse,
  executionInput?: unknown,
) {
  const execution = executionInput && typeof executionInput === "object"
    ? executionInput as AuthApiExecution
    : {};
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
    const session = authenticate(request);
    json(response, 200, {
      authenticated: Boolean(session),
      bootstrapRequired: count === 0,
      user: session ? publicUser(session.row) : undefined,
    });
    return;
  }

  if (request.method === "POST" && path === "bootstrap") {
    if (!isMutationAllowed(request)) {
      rejectMutation(request, response, 403, { error: "请求来源无效" });
      return;
    }
    if (!isLoopback(request) && process.env.UNBOUNDRY_BOOTSTRAP_REMOTE !== "1") {
      rejectMutation(request, response, 403, {
        error: "首次管理员只能在服务器本机创建",
      });
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
        executeTransactionScopedCommand(store, claimLegacyCanvasDataCommand, userId);
        executeTransactionScopedCommand(store, claimLegacyProjectDataCommand, userId);
        executeTransactionScopedCommand(store, claimLegacyGenerationDataCommand, userId);
        executeTransactionScopedCommand(store, registerLegacyMediaCommand, {
          items: media,
          ownerId: userId,
          timestamp,
        });
        recordAudit(store, userId, "bootstrap_admin", userId, {
          claimedMedia: media.length,
        });
        createSession(store, userId, response);
        store.exec("COMMIT");
      } catch (error) {
        store.exec("ROLLBACK");
        throw error;
      }
      await legacyProviderKeyMigration?.().catch(() => undefined);
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
      rejectMutation(request, response, 403, { error: "请求来源无效" });
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
      const releasePasswordCheck = admitLoginAttempt(request, loginName);
      let row: UserRow | undefined;
      let valid = false;
      try {
        if (/^[a-z0-9][a-z0-9._-]{2,39}$/i.test(loginName)) {
          row = store
            .prepare("SELECT * FROM users WHERE login_name = ? COLLATE NOCASE")
            .get(loginName) as UserRow | undefined;
        }
        valid = await verifyPassword(password, row?.password_hash);
      } finally {
        releasePasswordCheck();
      }
      if (!valid || !row || row.status !== "active") {
        json(response, 401, { error: "账号或密码不正确，或账号已停用" });
        return;
      }
      createSession(store, row.id, response);
      json(response, 200, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof RequestAdmissionError) {
        response.setHeader("Retry-After", String(error.retryAfterSeconds));
        json(response, error.statusCode, {
          code: error.code,
          error: "登录请求过多，请稍后再试",
        });
        return;
      }
      if (error instanceof HttpRequestError) throw error;
      json(response, 400, { error: "登录信息无效" });
    }
    return;
  }

  if (request.method === "POST" && path === "password") {
    if (!isMutationAllowed(request)) {
      rejectMutation(request, response, 403, { error: "请求来源无效" });
      return;
    }
    if (process.env.UNBOUNDRY_TEST_AUTH_BYPASS === "1") {
      rejectMutation(request, response, 400, {
        error: "测试模式不支持修改密码",
      });
      return;
    }
    const session = authenticate(request);
    if (!session) {
      rejectMutation(request, response, 401, { error: "请先登录" });
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
      await execution.beforePasswordCommit?.();
      let row: UserRow;
      store.exec("BEGIN IMMEDIATE");
      try {
        assertAccountMutationAllowed(store, session.identity.userId);
        const changed = store
          .prepare(`
            UPDATE users
            SET password_hash = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(
            passwordHash,
            new Date().toISOString(),
            session.identity.userId,
          );
        if (changed.changes !== 1) {
          throw new AccountMutationBlockedError("ACCOUNT_DISABLED");
        }
        // 吊销除当前会话外的全部会话，强制其他设备重新登录。
        store
          .prepare(`
            DELETE FROM sessions
            WHERE user_id = ? AND token_hash != ?
          `)
          .run(session.identity.userId, currentTokenHash);
        recordAudit(
          store,
          session.identity.userId,
          "password_change",
          session.identity.userId,
          {},
        );
        row = store.prepare("SELECT * FROM users WHERE id = ?").get(
          session.identity.userId,
        ) as UserRow;
        store.exec("COMMIT");
      } catch (error) {
        if (store.isTransaction) store.exec("ROLLBACK");
        throw error;
      }
      json(response, 200, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
      json(response, 400, {
        error: error instanceof Error ? error.message : "密码修改失败",
      });
    }
    return;
  }

  if (request.method === "POST" && path === "logout") {
    if (!isMutationAllowed(request)) {
      rejectMutation(request, response, 403, { error: "请求来源无效" });
      return;
    }
    clearSession(request, response);
    rejectMutation(request, response, 200, { loggedOut: true });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  rejectMutation(request, response, 404, { error: "登录接口不存在" });
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

type PublicTemplateTransferRow = Readonly<{
  cover_asset_id: string | null;
  created_by: string | null;
  graph: string;
  id: string;
  preview_image: string | null;
  updated_by: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function templateGraphNodes(value: string) {
  let graph: unknown;
  try {
    graph = JSON.parse(value) as unknown;
  } catch {
    throw new AccountDeletionReferencedError(
      "Public template graph cannot be transferred safely",
    );
  }
  if (
    !isRecord(graph) || graph.version !== 1 ||
    !Array.isArray(graph.nodes) || graph.nodes.length > 500 ||
    !Array.isArray(graph.edges) || graph.edges.length > 1_000
  ) {
    throw new AccountDeletionReferencedError(
      "Public template graph cannot be transferred safely",
    );
  }
  return graph.nodes;
}

function requiredPublicTemplateMedia(
  store: DatabaseSync,
  ownerId: string,
  templates: readonly PublicTemplateTransferRow[],
) {
  const references = new Map<string, PersistedMediaReference>();
  const retain = (reference: PersistedMediaReference) => {
    references.set(`${reference.kind}\0${reference.assetId}`, reference);
  };
  const retainTypedReference = (reference: PersistedMediaReference) => {
    const media = store.prepare(`
      SELECT owner_id, storage_status
      FROM media_assets
      WHERE kind = ? AND id = ?
      LIMIT 1
    `).get(reference.kind, reference.assetId) as
      | { owner_id: string; storage_status: string }
      | undefined;
    if (!media || media.storage_status !== "ready") {
      throw new AccountDeletionReferencedError(
        "Public template media cannot be transferred safely",
      );
    }
    if (media.owner_id === ownerId) retain(reference);
  };
  for (const template of templates) {
    if (template.cover_asset_id) {
      const covers = store.prepare(`
        SELECT kind, owner_id, storage_status
        FROM media_assets
        WHERE id = ? AND kind IN ('image', 'video')
        ORDER BY kind
      `).all(template.cover_asset_id) as Array<{
        kind: "image" | "video";
        owner_id: string;
        storage_status: string;
      }>;
      const ownedCovers = covers.filter((cover) => cover.owner_id === ownerId);
      if (ownedCovers.length > 0 && (
        ownedCovers.length !== 1 || covers.length !== 1 ||
        ownedCovers[0].storage_status !== "ready"
      )) {
        throw new AccountDeletionReferencedError(
          "Public template cover cannot be transferred safely",
        );
      }
      if (ownedCovers.length === 1) {
        retain({
          assetId: template.cover_asset_id,
          kind: ownedCovers[0].kind,
        });
      }
    }
    if (template.preview_image) {
      let previewReference: PersistedMediaReference | undefined;
      try {
        previewReference = persistedMediaReferenceFromSource(
          template.preview_image,
        );
      } catch {
        throw new AccountDeletionReferencedError(
          "Public template preview cannot be transferred safely",
        );
      }
      if (previewReference) retainTypedReference(previewReference);
    }
    let graphReferences: PersistedMediaReference[];
    try {
      graphReferences = persistedTemplateMediaReferences(
        templateGraphNodes(template.graph),
      );
    } catch (error) {
      if (error instanceof AccountDeletionReferencedError) throw error;
      throw new AccountDeletionReferencedError(
        "Public template media cannot be transferred safely",
      );
    }
    for (const reference of graphReferences) retainTypedReference(reference);
  }
  for (const reference of references.values()) {
    const media = store.prepare(`
      SELECT 1
      FROM media_assets
      WHERE owner_id = ? AND kind = ? AND id = ?
        AND storage_status = 'ready'
      LIMIT 1
    `).get(ownerId, reference.kind, reference.assetId);
    if (!media) {
      throw new AccountDeletionReferencedError(
        "Public template media cannot be transferred safely",
      );
    }
  }
  return [...references.values()];
}

function preparePrivateAccountMediaDeletion(
  store: DatabaseSync,
  ownerId: string,
  timestamp: string,
) {
  try {
    return executeTransactionScopedCommand(
      store,
      preparePrivateAccountMediaDeletionCommand,
      { ownerId, timestamp },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Account media deletion changed concurrently"
    ) {
      throw new AccountDeletionActiveError(error.message);
    }
    throw error;
  }
}

function accountDeletionRoot(store: DatabaseSync) {
  const roots = store.prepare(`
    SELECT id
    FROM users
    WHERE protected = 1 AND role = 'admin' AND status = 'active'
    ORDER BY created_at ASC, rowid ASC
    LIMIT 2
  `).all() as Array<{ id: string }>;
  if (roots.length !== 1) {
    throw new AccountDeletionReferencedError(
      "Exactly one active protected administrator is required",
    );
  }
  return roots[0].id;
}

function hasBlockingGenerationWork(store: DatabaseSync, ownerId: string) {
  return Boolean(store.prepare(`
    SELECT 1
    FROM generation_tasks AS task
    WHERE task.owner_id = ?
      AND (
        task.state IN ('queued', 'running', 'retrying', 'recovering')
        OR EXISTS (
          SELECT 1
          FROM generation_provider_attempts AS attempt
          WHERE attempt.task_id = task.id
            AND attempt.outcome IN (
              'boundary-claimed', 'accepted',
              'response-received', 'outcome-unknown'
            )
            AND NOT (
              task.state = 'cancelled'
              AND task.error_code = 'USER_ABANDONED'
              AND (
                (
                  task.provider_task_id IS NOT NULL
                  AND attempt.provider_task_id = task.provider_task_id
                  AND attempt.outcome IN ('accepted', 'response-received')
                )
                OR (
                  task.provider_task_id IS NULL
                  AND attempt.provider_task_id IS NULL
                  AND attempt.execution_attempt = task.attempt
                  AND attempt.outcome = 'response-received'
                )
              )
            )
        )
      )
    LIMIT 1
  `).get(ownerId));
}

function beginAccountDeletion(
  store: DatabaseSync,
  actorId: string,
  ownerId: string,
): AccountDeletionClaim {
  store.exec("BEGIN IMMEDIATE");
  try {
    if (actorId === ownerId) {
      throw new Error("不能删除当前登录的管理员账号");
    }
    const target = store.prepare("SELECT * FROM users WHERE id = ?").get(
      ownerId,
    ) as UserRow | undefined;
    if (!target) throw new AccountDeletionNotFoundError("账号不存在");
    if (target.protected) {
      throw new AccountDeletionProtectedError("最高权限账号受保护，不能删除");
    }
    if (
      (activeAccountMutationCounts.get(ownerId) ?? 0) > 0 ||
      (activeAccountDeletionActorCounts.get(ownerId) ?? 0) > 0
    ) {
      throw new AccountDeletionActiveError(
        "Account mutation is still active",
      );
    }
    const rootOwnerId = accountDeletionRoot(store);
    const intent = accountDeleteIntent(store, ownerId);
    if (target.role === "admin" && target.status === "active" && !intent) {
      const activeAdmins = Number((store.prepare(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'admin' AND status = 'active'
      `).get() as { count: number }).count);
      if (activeAdmins <= 1) throw new Error("不能删除最后一个管理员账号");
    }
    if (hasActiveOwnerMediaPublications(store, ownerId)) {
      throw new Error("active media publication blocks account deletion");
    }
    if (hasBlockingGenerationWork(store, ownerId)) {
      throw new AccountDeletionGenerationActiveError(
        "Active or unresolved generation work blocks account deletion",
      );
    }
    const publicTemplates = store.prepare(`
      SELECT id, graph, cover_asset_id, preview_image, created_by, updated_by
      FROM public_templates
      ORDER BY id
    `).all() as PublicTemplateTransferRow[];
    const retainedMedia = requiredPublicTemplateMedia(
      store,
      ownerId,
      publicTemplates,
    );
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
    for (const reference of retainedMedia) {
      const transferred = executeTransactionScopedCommand(
        store,
        transferAccountMediaCommand,
        {
          assetId: reference.assetId,
          kind: reference.kind,
          ownerId,
          rootOwnerId,
        },
      );
      if (transferred !== 1) {
        throw new AccountDeletionReferencedError(
          "Public template media changed concurrently",
        );
      }
    }
    const transferredTemplateCount = executeTransactionScopedCommand(
      store,
      transferAndDeleteAccountTemplatesCommand,
      { ownerId, rootOwnerId },
    );
    const disabled = store.prepare(`
      UPDATE users SET status = 'disabled', updated_at = ?
      WHERE id = ?
    `).run(timestamp, ownerId);
    if (disabled.changes !== 1) throw new Error("账号不存在");
    store.prepare("DELETE FROM sessions WHERE user_id = ?").run(ownerId);
    const privateMediaCount = preparePrivateAccountMediaDeletion(
      store,
      ownerId,
      timestamp,
    );
    executeTransactionScopedCommand(store, deleteAccountHistoryCommand, ownerId);
    store.exec("COMMIT");
    return {
      privateMediaCount,
      rootOwnerId,
      target,
      transferredMediaCount: retainedMedia.length,
      transferredTemplateCount,
    };
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

function markAccountDeletionFailed(
  store: DatabaseSync,
  ownerId: string,
  errorCode = "ACCOUNT_MEDIA_CLEANUP_FAILED",
) {
  store.prepare(`
    UPDATE account_delete_intents
    SET state = 'failed', error_code = ?,
        updated_at = ?
    WHERE owner_id = ? AND state = 'running'
  `).run(errorCode, new Date().toISOString(), ownerId);
}

function finishAccountDeletion(
  store: DatabaseSync,
  actorId: string,
  ownerId: string,
  claim: AccountDeletionClaim,
  beforeFinalAudit?: () => void,
) {
  store.exec("BEGIN IMMEDIATE");
  try {
    const intent = store.prepare(`
      SELECT 1 FROM account_delete_intents
      WHERE owner_id = ? AND state = 'running'
    `).get(ownerId);
    if (!intent) throw new AccountDeletionActiveError("Account deletion claim was lost");
    const actor = store.prepare(`
      SELECT 1
      FROM users AS actor
      WHERE actor.id = ? AND actor.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM account_delete_intents
          WHERE owner_id = actor.id
        )
    `).get(actorId);
    if (!actor) throw new AccountDeletionActiveError("Deleting actor is unavailable");
    const target = store.prepare(`
      SELECT 1 FROM users
      WHERE id = ? AND protected = 0 AND status = 'disabled'
    `).get(ownerId);
    if (!target) throw new AccountDeletionActiveError("Account deletion target changed");
    if (accountDeletionRoot(store) !== claim.rootOwnerId) {
      throw new AccountDeletionActiveError("Protected administrator changed");
    }
    if (hasActiveOwnerMediaPublications(store, ownerId)) {
      throw new Error("active media publication blocks account deletion");
    }
    if (hasBlockingGenerationWork(store, ownerId)) {
      throw new AccountDeletionGenerationActiveError(
        "Active or unresolved generation work blocks account deletion",
      );
    }
    const remainingMedia = Number((store.prepare(`
      SELECT COUNT(*) AS count FROM media_assets WHERE owner_id = ?
    `).get(ownerId) as { count: number }).count);
    const pendingMedia = Number((store.prepare(`
      SELECT COUNT(*) AS count
      FROM media_delete_intents
      WHERE owner_id = ? AND state <> 'tombstone'
    `).get(ownerId) as { count: number }).count);
    if (remainingMedia !== 0 || pendingMedia !== 0) {
      throw new AccountMediaCleanupError("Account media cleanup is incomplete");
    }
    const privateTemplates = Number((store.prepare(`
      SELECT COUNT(*) AS count FROM user_templates WHERE owner_id = ?
    `).get(ownerId) as { count: number }).count);
    const publicTemplates = Number((store.prepare(`
      SELECT COUNT(*) AS count FROM public_templates
      WHERE created_by = ? OR updated_by = ?
    `).get(ownerId, ownerId) as { count: number }).count);
    if (privateTemplates !== 0 || publicTemplates !== 0) {
      throw new AccountDeletionReferencedError("Account template transfer is incomplete");
    }
    executeTransactionScopedCommand(store, deleteAccountGenerationDataCommand, ownerId);
    store.prepare(
      "DELETE FROM account_provider_credentials WHERE account_id = ?",
    ).run(ownerId);
    store.prepare("DELETE FROM account_permissions WHERE account_id = ?").run(ownerId);
    store.prepare("DELETE FROM account_permissions WHERE granted_by = ?").run(ownerId);
    executeTransactionScopedCommand(store, deleteAccountCanvasDataCommand, ownerId);
    executeTransactionScopedCommand(store, deleteAccountProjectDataCommand, ownerId);
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
    const leftoverPrivateRoots = Number((store.prepare(`
      SELECT (
        (SELECT COUNT(*) FROM generation_tasks WHERE owner_id = ?)
        + (SELECT COUNT(*) FROM generation_provider_attempts WHERE owner_id = ?)
        + (SELECT COUNT(*) FROM generation_admission_events WHERE owner_id = ?)
        + (SELECT COUNT(*) FROM account_provider_credentials WHERE account_id = ?)
        + (SELECT COUNT(*) FROM account_provider_credential_epochs WHERE account_id = ?)
      ) AS count
    `).get(ownerId, ownerId, ownerId, ownerId, ownerId) as { count: number }).count);
    if (leftoverPrivateRoots !== 0) throw new Error("账号私有数据行清理失败");
    beforeFinalAudit?.();
    recordAudit(store, actorId, "delete_user", ownerId, {
      loginName: claim.target.login_name,
      privateMediaCount: claim.privateMediaCount,
      role: claim.target.role,
      rootOwnerId: claim.rootOwnerId,
      transferredMediaCount: claim.transferredMediaCount,
      transferredTemplateCount: claim.transferredTemplateCount,
    });
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
      json(response, 200, accountPermissionSnapshot(store, targetId));
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
        const body = await readJsonBody<{
          extraPermissions?: unknown;
          permissions?: unknown;
        }>(
          request,
          64 * 1_024,
        );
        const extraPermissions = accountExtraPermissionsFromWriteInput(body);
        const { added, removed } = setAccountExtraPermissions(
          store,
          identity.userId,
          targetId,
          extraPermissions,
        );
        json(response, 200, {
          added,
          removed,
          ...accountPermissionSnapshot(store, targetId),
        });
      } catch (error) {
        if (error instanceof HttpRequestError) throw error;
        const message = error instanceof Error ? error.message : "权限保存失败";
        if (error instanceof AccountPermissionMutationBlockedError) {
          json(response, 409, { code: error.code, error: message });
          return;
        }
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
      const passwordHash = await hashPassword(input.password);
      let row: UserRow;
      store.exec("BEGIN IMMEDIATE");
      try {
        assertAccountMutationAllowed(store, identity.userId);
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
            passwordHash,
            role,
            timestamp,
            timestamp,
          );
        recordAudit(store, identity.userId, "create_user", id, {
          loginName: input.loginName,
          role,
        });
        row = store.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
        store.exec("COMMIT");
      } catch (error) {
        if (store.isTransaction) store.exec("ROLLBACK");
        throw error;
      }
      json(response, 201, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
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
      let row: UserRow;
      store.exec("BEGIN IMMEDIATE");
      try {
        assertAccountMutationAllowed(store, identity.userId);
        const protectedTarget = store.prepare(`
          SELECT protected FROM users WHERE id = ?
        `).get(targetId) as { protected: number } | undefined;
        if (!protectedTarget) throw new Error("账号不存在");
        if (protectedTarget.protected) {
          throw new AccountDeletionProtectedError(
            "最高权限账号受保护，不能重置密码",
          );
        }
        if (accountDeleteIntent(store, targetId)) {
          throw new AccountMutationBlockedError("ACCOUNT_DELETE_ACTIVE");
        }
        const changed = store.prepare(`
          UPDATE users
          SET password_hash = ?, updated_at = ?
          WHERE id = ?
        `).run(passwordHash, new Date().toISOString(), targetId);
        if (changed.changes !== 1) throw new Error("账号不存在");
        // 管理员重置密码后吊销目标账号全部会话。
        store.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
        recordAudit(store, identity.userId, "reset_password", targetId, {});
        row = store.prepare("SELECT * FROM users WHERE id = ?").get(
          targetId,
        ) as UserRow;
        store.exec("COMMIT");
      } catch (error) {
        if (store.isTransaction) store.exec("ROLLBACK");
        throw error;
      }
      json(response, 200, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
      if (error instanceof AccountDeletionProtectedError) {
        json(response, 403, { error: error.message });
        return;
      }
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
      let row: UserRow;
      store.exec("BEGIN IMMEDIATE");
      try {
        assertAccountMutationAllowed(store, identity.userId);
        const currentTarget = store.prepare("SELECT * FROM users WHERE id = ?").get(
          path,
        ) as UserRow | undefined;
        if (!currentTarget) throw new Error("账号不存在");
        if (currentTarget.protected) {
          throw new AccountDeletionProtectedError(
            "最高权限账号受保护，不能修改",
          );
        }
        if (accountDeleteIntent(store, path)) {
          throw new AccountMutationBlockedError("ACCOUNT_DELETE_ACTIVE");
        }
        if (
          body.status === "disabled" &&
          (activeAccountDeletionActorCounts.get(path) ?? 0) > 0
        ) {
          throw new AccountMutationBlockedError("ACCOUNT_DELETE_ACTIVE");
        }
        if (
          currentTarget.status !== "active" &&
          body.status !== undefined &&
          body.status !== "active"
        ) {
          throw new AccountMutationBlockedError("ACCOUNT_DISABLED");
        }
        if (body.status !== undefined) {
          const changed = store.prepare(`
            UPDATE users SET status = ?, updated_at = ? WHERE id = ?
          `).run(body.status, new Date().toISOString(), path);
          if (changed.changes !== 1) throw new Error("账号不存在");
          if (body.status === "disabled") {
            store.prepare("DELETE FROM sessions WHERE user_id = ?").run(path);
          }
          recordAudit(store, identity.userId, "set_user_status", path, {
            status: body.status,
          });
        }
        if (body.role !== undefined) {
          const changed = store.prepare(`
            UPDATE users SET role = ?, updated_at = ? WHERE id = ?
          `).run(body.role, new Date().toISOString(), path);
          if (changed.changes !== 1) throw new Error("账号不存在");
          recordAudit(store, identity.userId, "set_user_role", path, {
            role: body.role,
          });
        }
        row = store.prepare("SELECT * FROM users WHERE id = ?").get(path) as UserRow;
        store.exec("COMMIT");
      } catch (error) {
        if (store.isTransaction) store.exec("ROLLBACK");
        throw error;
      }
      json(response, 200, { user: publicUser(row) });
    } catch (error) {
      if (error instanceof HttpRequestError) throw error;
      if (error instanceof AccountMutationBlockedError) {
        json(response, 409, { code: error.code, error: error.message });
        return;
      }
      if (error instanceof AccountDeletionProtectedError) {
        json(response, 403, { error: error.message });
        return;
      }
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
    const targetId = path;
    const actorId = identity.userId;
    activeAccountDeletionActorCounts.set(
      actorId,
      (activeAccountDeletionActorCounts.get(actorId) ?? 0) + 1,
    );
    let ownsProcessClaim = false;
    try {
      if (activeAccountDeletionOwners.has(targetId)) {
        throw new AccountDeletionActiveError("Account deletion is already active");
      }
      activeAccountDeletionOwners.add(targetId);
      ownsProcessClaim = true;
      const claim = beginAccountDeletion(store, identity.userId, targetId);
      const mediaRows = store.prepare(`
        SELECT
          media.id, media.kind, media.owner_id, media.storage_backend,
          media.storage_name, media.object_key, media.storage_profile_id
        FROM media_assets AS media
        JOIN media_delete_intents AS deletion
          ON deletion.owner_id = media.owner_id
          AND deletion.kind = media.kind
          AND deletion.asset_id = media.id
        WHERE media.owner_id = ?
          AND deletion.state IN ('delete-requested', 'delete-failed')
        ORDER BY media.kind, media.id
      `).all(targetId) as AccountMediaRow[];
      try {
        await removeAccountMediaFiles(store, mediaRows, execution);
      } catch (error) {
        markAccountDeletionFailed(store, targetId);
        throw new AccountMediaCleanupError(
          error instanceof Error ? error.message : "账号媒体清理失败",
        );
      }
      try {
        finishAccountDeletion(
          store,
          identity.userId,
          targetId,
          claim,
          execution.beforeFinalAudit,
        );
      } catch (error) {
        markAccountDeletionFailed(store, targetId, "ACCOUNT_FINALIZE_FAILED");
        if (
          error instanceof AccountDeletionActiveError ||
          error instanceof AccountDeletionGenerationActiveError ||
          error instanceof AccountDeletionReferencedError ||
          error instanceof AccountMediaCleanupError ||
          activePublicationDeleteError(error)
        ) throw error;
        throw new AccountDeletionFinalizeError(
          error instanceof Error ? error.message : "账号删除收口失败",
        );
      }
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
      } else if (error instanceof AccountDeletionNotFoundError) {
        json(response, 404, { error: message });
      } else if (error instanceof AccountDeletionProtectedError) {
        json(response, 403, { error: message });
      } else if (error instanceof AccountDeletionFinalizeError) {
        json(response, 503, {
          code: "ACCOUNT_DELETE_FINALIZE_FAILED",
          error: "账号删除未能安全收口，可重试删除",
        });
      } else {
        json(response, 400, { error: message });
      }
    } finally {
      if (ownsProcessClaim) activeAccountDeletionOwners.delete(targetId);
      const remainingActorDeletes =
        (activeAccountDeletionActorCounts.get(actorId) ?? 1) - 1;
      if (remainingActorDeletes > 0) {
        activeAccountDeletionActorCounts.set(actorId, remainingActorDeletes);
      } else {
        activeAccountDeletionActorCounts.delete(actorId);
      }
    }
    return;
  }

  response.setHeader("Allow", "GET, POST, PATCH, DELETE");
  json(response, 404, { error: "账号接口不存在" });
}

async function removeAccountMediaFiles(
  store: DatabaseSync,
  rows: readonly AccountMediaRow[],
  execution: AdminUsersExecution,
) {
  const profiles = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof storageProfileForDestructiveMedia>>>
  >();
  for (const row of rows) {
    try {
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
    } catch (error) {
      markAccountMediaDeletionFailed(store, row);
      throw error;
    }
  }
  for (const row of rows) {
    try {
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
      finishAccountMediaDeletion(store, row);
    } catch (error) {
      markAccountMediaDeletionFailed(store, row);
      throw error;
    }
  }
}

function finishAccountMediaDeletion(
  store: DatabaseSync,
  row: AccountMediaRow,
) {
  store.exec("BEGIN IMMEDIATE");
  try {
    executeTransactionScopedCommand(store, finishAccountMediaDeletionCommand, {
      row,
      timestamp: new Date().toISOString(),
    });
    store.exec("COMMIT");
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}

function markAccountMediaDeletionFailed(
  store: DatabaseSync,
  row: AccountMediaRow,
) {
  store.exec("BEGIN IMMEDIATE");
  try {
    executeTransactionScopedCommand(store, failAccountMediaDeletionCommand, {
      row,
      timestamp: new Date().toISOString(),
    });
    store.exec("COMMIT");
  } catch (error) {
    if (store.isTransaction) store.exec("ROLLBACK");
    throw error;
  }
}
