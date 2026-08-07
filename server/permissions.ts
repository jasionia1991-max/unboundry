import type { DatabaseSync } from "node:sqlite";
import {
  ADMIN_ONLY_PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  isAccountPermission,
  type AccountPermission,
} from "../types/accountPermissions";
import { recordAudit } from "./audit";
import type { RequestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";

const defaultPermissionSet = new Set<AccountPermission>(
  DEFAULT_USER_PERMISSIONS,
);
const adminOnlyPermissionSet = new Set<AccountPermission>(
  ADMIN_ONLY_PERMISSIONS,
);

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

function storedPermissionRows(
  store: DatabaseSync,
  accountId: string,
): AccountPermission[] {
  const rows = store
    .prepare(`
      SELECT permission
      FROM account_permissions
      WHERE account_id = ?
    `)
    .all(accountId) as Array<{ permission: string }>;
  return rows
    .map((row) => row.permission)
    .filter(isAccountPermission);
}

/** 账号实际权限 = 默认集 ∪ 额外授予集；管理员恒为全量。 */
export function accountPermissionSet(
  store: DatabaseSync,
  accountId: string,
): Set<AccountPermission> {
  return new Set([
    ...DEFAULT_USER_PERMISSIONS,
    ...storedPermissionRows(store, accountId),
  ]);
}

/** 统一鉴权入口：管理员恒真；普通账号按默认集 + 额外授予集判断。 */
export function hasPermission(
  identity: RequestIdentity | undefined,
  permission: AccountPermission,
  store: DatabaseSync = db(),
): boolean {
  if (!identity) return false;
  if (identity.role === "admin") return true;
  if (defaultPermissionSet.has(permission)) return true;
  const row = store
    .prepare(`
      SELECT 1
      FROM account_permissions
      WHERE account_id = ? AND permission = ?
    `)
    .get(identity.userId, permission);
  return Boolean(row);
}

/**
 * 写入账号「额外授予集」：默认权限不可写、不可撤销；管理员目标恒全量，
 * 且禁止修改自己的权限；超级权限（manage_accounts/manage_permissions）
 * 不可授予非管理员。事务 + 审计。
 */
export function setAccountPermissions(
  store: DatabaseSync,
  actorId: string,
  accountId: string,
  requestedPermissions: readonly string[],
): { added: AccountPermission[]; removed: AccountPermission[] } {
  if (actorId === accountId) {
    throw new Error("不能修改自己的权限");
  }
  if (
    !Array.isArray(requestedPermissions) ||
    requestedPermissions.some((value) => !isAccountPermission(value))
  ) {
    throw new Error("权限列表包含未知值");
  }
  const target = store
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(accountId) as { role: "admin" | "user" } | undefined;
  if (!target) throw new Error("账号不存在");
  if (target.role === "admin") {
    throw new Error("管理员账号恒有全部权限，无需设置");
  }
  const requested = new Set<AccountPermission>(requestedPermissions);
  for (const adminOnly of adminOnlyPermissionSet) {
    if (requested.has(adminOnly)) {
      throw new Error("该权限不能授予普通账号");
    }
  }

  const before = new Set<AccountPermission>(
    storedPermissionRows(store, accountId),
  );
  const nextExtra = new Set<AccountPermission>();
  for (const permission of ALL_PERMISSIONS) {
    if (defaultPermissionSet.has(permission)) continue;
    if (requested.has(permission)) nextExtra.add(permission);
  }

  const added: AccountPermission[] = [];
  const removed: AccountPermission[] = [];
  const timestamp = new Date().toISOString();
  store.exec("BEGIN IMMEDIATE");
  try {
    for (const permission of nextExtra) {
      if (before.has(permission)) continue;
      store
        .prepare(`
          INSERT INTO account_permissions (
            account_id, permission, granted_by, created_at
          )
          VALUES (?, ?, ?, ?)
        `)
        .run(accountId, permission, actorId, timestamp);
      added.push(permission);
    }
    for (const permission of before) {
      if (defaultPermissionSet.has(permission) || nextExtra.has(permission)) {
        continue;
      }
      store
        .prepare(`
          DELETE FROM account_permissions
          WHERE account_id = ? AND permission = ?
        `)
        .run(accountId, permission);
      removed.push(permission);
    }
    recordAudit(store, actorId, "account_permissions.update", accountId, {
      added,
      removed,
    });
    store.exec("COMMIT");
  } catch (error) {
    store.exec("ROLLBACK");
    throw error;
  }
  return { added, removed };
}
