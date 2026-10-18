import {
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  type AccountPermission,
} from "../../../types/accountPermissions";

export type AuthUser = {
  displayName: string;
  id: string;
  loginName: string;
  protected?: boolean;
  role: "admin" | "user";
  status: "active" | "disabled";
};

export type AuthStatus = {
  authenticated: boolean;
  bootstrapRequired: boolean;
  permissions?: AccountPermission[];
  user?: AuthUser;
};

export type AccountPermissionDetails = {
  defaultPermissions: AccountPermission[];
  effectivePermissions: AccountPermission[];
  extraPermissions: AccountPermission[];
  permissions: AccountPermission[];
};

export function orderedPermissions(permissions: readonly AccountPermission[]) {
  return [...new Set(permissions)].sort(
    (left, right) =>
      ALL_PERMISSIONS.indexOf(left) - ALL_PERMISSIONS.indexOf(right),
  );
}

export function samePermissions(
  left: readonly AccountPermission[],
  right: readonly AccountPermission[],
) {
  const orderedLeft = orderedPermissions(left);
  const orderedRight = orderedPermissions(right);
  return orderedLeft.length === orderedRight.length &&
    orderedLeft.every((permission, index) => permission === orderedRight[index]);
}

export function permissionDetailsFromResponse(body: {
  defaultPermissions?: AccountPermission[];
  effectivePermissions?: AccountPermission[];
  extraPermissions?: AccountPermission[];
  permissions: AccountPermission[];
}): AccountPermissionDetails {
  const defaultPermissions = body.defaultPermissions ??
    [...DEFAULT_USER_PERMISSIONS];
  const effectivePermissions = body.effectivePermissions ?? body.permissions;
  const extraPermissions = body.extraPermissions ??
    effectivePermissions.filter(
      (permission) => !defaultPermissions.includes(permission),
    );
  return {
    defaultPermissions: orderedPermissions(defaultPermissions),
    effectivePermissions: orderedPermissions(effectivePermissions),
    extraPermissions: orderedPermissions(extraPermissions),
    permissions: orderedPermissions(body.permissions),
  };
}

export function hasClientPermission(
  permissions: readonly AccountPermission[] | undefined,
  permission: AccountPermission,
  role?: AuthUser["role"],
) {
  // 管理员恒有全部权限；前端权限只做展示，安全以后端校验为准。
  if (role === "admin") return true;
  return permissions?.includes(permission) ?? false;
}
