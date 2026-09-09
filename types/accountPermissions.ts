// 账号能力权限的唯一枚举来源：前后端、OpenAPI 与测试共用本文件。
// 新增管理能力时必须先在此登记，再接入服务端守卫与前端 UI。

export type AccountPermission =
  | "manage_accounts"
  | "manage_models"
  | "manage_providers"
  | "manage_storage"
  | "manage_generation_safety"
  | "manage_generation_recovery"
  | "manage_public_templates"
  | "manage_permissions"
  | "manage_projects"
  | "generate"
  | "group_download"
  | "manage_own_templates"
  | "manage_own_credentials";

export const ALL_PERMISSIONS: readonly AccountPermission[] = [
  "manage_accounts",
  "manage_models",
  "manage_providers",
  "manage_storage",
  "manage_generation_safety",
  "manage_generation_recovery",
  "manage_public_templates",
  "manage_permissions",
  "manage_projects",
  "generate",
  "group_download",
  "manage_own_templates",
  "manage_own_credentials",
];

// 普通账号默认能力 = 现状能力，不得随意增删（防功能回退或越权）。
export const DEFAULT_USER_PERMISSIONS: readonly AccountPermission[] = [
  "manage_projects",
  "generate",
  "group_download",
  "manage_own_templates",
  "manage_own_credentials",
];

// 超级权限：不授予非管理员，避免权限提升链。
export const ADMIN_ONLY_PERMISSIONS: readonly AccountPermission[] = [
  "manage_accounts",
  "manage_permissions",
  "manage_generation_recovery",
];

export function isAccountPermission(
  value: unknown,
): value is AccountPermission {
  return (
    typeof value === "string" &&
    (ALL_PERMISSIONS as readonly string[]).includes(value)
  );
}

export function permissionLabel(permission: AccountPermission): string {
  const labels: Record<AccountPermission, string> = {
    manage_accounts: "账号管理",
    manage_models: "模型中心",
    manage_providers: "平台连接",
    manage_storage: "存储中心",
    manage_generation_safety: "生成安全",
    manage_generation_recovery: "生成维护",
    manage_public_templates: "公共模板管理",
    manage_permissions: "权限管理",
    manage_projects: "项目管理",
    generate: "发起生成",
    group_download: "批量下载",
    manage_own_templates: "我的模板",
    manage_own_credentials: "我的连接",
  };
  return labels[permission];
}
