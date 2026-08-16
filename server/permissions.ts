import type { DatabaseSync } from "node:sqlite";
import {
  ADMIN_ONLY_PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  isAccountPermission,
  type AccountPermission,
} from "../types/accountPermissions";
import { recordAudit } from "./audit";
import {
  AccountMutationBlockedError,
  assertAccountMutationAllowed,
} from "./accountMutationFence";
import type { RequestIdentity } from "./auth";
import { appDataDirectory, openAppDatabase } from "./database";

const defaultPermissionSet = new Set<AccountPermission>(
  DEFAULT_USER_PERMISSIONS,
);
const adminOnlyPermissionSet = new Set<AccountPermission>(
  ADMIN_ONLY_PERMISSIONS,
);

export type AccountPermissionSnapshot = Readonly<{
  defaultPermissions: AccountPermission[];
  effectivePermissions: AccountPermission[];
  extraPermissions: AccountPermission[];
  /** Backward-compatible alias for effectivePermissions. */
  permissions: AccountPermission[];
}>;

export class AccountPermissionMutationBlockedError extends Error {
  constructor(
    readonly code: "ACCOUNT_DELETE_ACTIVE" | "ACCOUNT_INACTIVE",
    message: string,
  ) {
    super(message);
    this.name = "AccountPermissionMutationBlockedError";
  }
}

function assertPermissionMutationAllowed(
  store: DatabaseSync,
  accountId: string,
  subject: "actor" | "target",
  options: Readonly<{ allowDisabled?: boolean }> = {},
) {
  try {
    assertAccountMutationAllowed(store, accountId, options);
  } catch (error) {
    if (!(error instanceof AccountMutationBlockedError)) throw error;
    throw new AccountPermissionMutationBlockedError(
      error.code === "ACCOUNT_DELETE_ACTIVE"
        ? "ACCOUNT_DELETE_ACTIVE"
        : "ACCOUNT_INACTIVE",
      error.code === "ACCOUNT_DELETE_ACTIVE"
        ? "账号删除正在进行，不能修改权限"
        : subject === "actor"
          ? "操作账号当前不可修改权限"
          : "目标账号当前不可修改权限",
    );
  }
}

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

function sortedPermissions(values: Iterable<AccountPermission>) {
  return [...new Set(values)].sort(
    (left, right) =>
      ALL_PERMISSIONS.indexOf(left) - ALL_PERMISSIONS.indexOf(right),
  );
}

function validatedPermissionArray(
  value: unknown,
  label: string,
): AccountPermission[] {
  if (
    !Array.isArray(value) ||
    value.some((permission) => !isAccountPermission(permission))
  ) {
    throw new Error(`${label}列表包含未知值`);
  }
  return sortedPermissions(value);
}

/**
 * New clients submit the authoritative extra-grant set. The legacy
 * `permissions` field remains accepted as an effective set and is converted
 * to extras so an older client cannot make default permissions revocable.
 */
export function accountExtraPermissionsFromWriteInput(input: {
  extraPermissions?: unknown;
  permissions?: unknown;
}): AccountPermission[] {
  if (input.extraPermissions !== undefined) {
    if (input.permissions !== undefined) {
      throw new Error("不能同时提交权限与额外权限");
    }
    const extraPermissions = validatedPermissionArray(
      input.extraPermissions,
      "额外权限",
    );
    if (extraPermissions.some((permission) => defaultPermissionSet.has(permission))) {
      throw new Error("默认权限不能写入额外授权集");
    }
    return extraPermissions;
  }
  if (input.permissions === undefined) {
    throw new Error("权限列表无效");
  }
  return validatedPermissionArray(input.permissions, "权限").filter(
    (permission) => !defaultPermissionSet.has(permission),
  );
}

/** Explicit default/extra/effective permission contract for one account. */
export function accountPermissionSnapshot(
  store: DatabaseSync,
  accountId: string,
): AccountPermissionSnapshot {
  const target = store
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(accountId) as { role: "admin" | "user" } | undefined;
  if (!target) throw new Error("账号不存在");
  const defaultPermissions = target.role === "admin"
    ? [...ALL_PERMISSIONS]
    : [...DEFAULT_USER_PERMISSIONS];
  const extraPermissions = target.role === "admin"
    ? []
    : sortedPermissions(
        storedPermissionRows(store, accountId).filter(
          (permission) => !defaultPermissionSet.has(permission),
        ),
      );
  const effectivePermissions = target.role === "admin"
    ? [...ALL_PERMISSIONS]
    : sortedPermissions([...defaultPermissions, ...extraPermissions]);
  return {
    defaultPermissions,
    effectivePermissions,
    extraPermissions,
    permissions: [...effectivePermissions],
  };
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
  return setAccountExtraPermissions(
    store,
    actorId,
    accountId,
    accountExtraPermissionsFromWriteInput({ permissions: requestedPermissions }),
  );
}

/** Replace one ordinary account's authoritative extra-grant set. */
export function setAccountExtraPermissions(
  store: DatabaseSync,
  actorId: string,
  accountId: string,
  requestedExtraPermissions: readonly string[],
): { added: AccountPermission[]; removed: AccountPermission[] } {
  const nextExtra = new Set<AccountPermission>(
    accountExtraPermissionsFromWriteInput({
      extraPermissions: requestedExtraPermissions,
    }),
  );
  for (const adminOnly of adminOnlyPermissionSet) {
    if (nextExtra.has(adminOnly)) {
      throw new Error("该权限不能授予普通账号");
    }
  }

  const added: AccountPermission[] = [];
  const removed: AccountPermission[] = [];
  const timestamp = new Date().toISOString();
  store.exec("BEGIN IMMEDIATE");
  try {
    if (actorId === accountId) {
      throw new Error("不能修改自己的权限");
    }
    assertPermissionMutationAllowed(store, actorId, "actor");
    const actor = store
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(actorId) as
        | { role: "admin" | "user" }
        | undefined;
    const target = store
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(accountId) as
        | { role: "admin" | "user" }
        | undefined;
    if (!actor || actor.role !== "admin") {
      throw new AccountPermissionMutationBlockedError(
        "ACCOUNT_INACTIVE",
        "操作账号当前不可修改权限",
      );
    }
    if (!target) throw new Error("账号不存在");
    assertPermissionMutationAllowed(store, accountId, "target", {
      allowDisabled: true,
    });
    if (target.role === "admin") {
      throw new Error("管理员账号恒有全部权限，无需设置");
    }
    const before = new Set<AccountPermission>(
      storedPermissionRows(store, accountId).filter(
        (permission) => !defaultPermissionSet.has(permission),
      ),
    );
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
      if (nextExtra.has(permission)) continue;
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
