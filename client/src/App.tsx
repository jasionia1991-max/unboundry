import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ModelCatalogProvider } from "./models/ModelCatalog";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { GrayMenuSelect } from "./ui/GrayMenuSelect";
import {
  defaultParameterSchema,
  gptImageSizeMapEntryError,
  gptImageSizeTiers,
  isCustomParameterField,
  knownModelParameterSchema,
  parameterOptionCatalog,
  providerParameterSchema,
  textOnlyUpstreamInputs,
  youchuangGptImageSizes,
  type ModelCapability,
  type GptImageSizeMap,
  type GptImageSizeTier,
  type ModelInputRolePolicy,
  type ModelParameterAvailability,
  type ModelParameterField,
  type ModelNodeInputPolicy,
  type ModelParameterOption,
  type ModelReferenceMediaRule,
  type ModelParameterSchema,
  type ModelParameterValue,
  type ModelReferenceInputs,
  type ModelUpstreamInputKind,
} from "../../types/modelParameters";
import {
  relayProviderProtocols,
  providerProtocolSupportsCapability,
  type ProviderProtocol,
} from "../../types/relayProtocols";
import type {
  ModelContractBinding,
  ModelContractRole,
  ModelExecutionMode,
} from "../../types/modelExecutionContracts";
import type {
  ModelContractState,
  ModelReleaseDocument,
} from "../../types/modelReleaseRevisions";
import {
  ADMIN_ONLY_PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  permissionLabel,
  type AccountPermission,
} from "../../types/accountPermissions";
import { REAL_CATEGORIES } from "../../types/templateCategories";
import { usePageTitle } from "./pageIdentity";
import {
  pathWithCurrentCanvasSource,
} from "./navigation/canvasReturn";
import {
  SettingsPageHeader,
  settingsDestination,
} from "./navigation/SettingsPageHeader";
import { createGroupRunSummaryScope } from "./generation/groupRunSummary";
import { confirmGroupRunNavigation } from "./generation/groupRunCheckpoint";

const CanvasShell = lazy(async () => ({
  default: (await import("./canvas/CanvasShell")).CanvasShell,
}));
const WorkspacePage = lazy(async () => ({
  default: (await import("./projects/WorkspacePage")).WorkspacePage,
}));

type Fixture = {
  id: string;
  kind: string;
  status: string;
};

type FixtureState =
  | { state: "idle" }
  | { state: "loading"; id: string }
  | { state: "ready"; fixture: Fixture }
  | { state: "error"; message: string };

type AuthUser = {
  displayName: string;
  id: string;
  loginName: string;
  protected?: boolean;
  role: "admin" | "user";
  status: "active" | "disabled";
};

type AuthStatus = {
  authenticated: boolean;
  bootstrapRequired: boolean;
  permissions?: AccountPermission[];
  user?: AuthUser;
};

type AccountPermissionDetails = {
  defaultPermissions: AccountPermission[];
  effectivePermissions: AccountPermission[];
  extraPermissions: AccountPermission[];
  permissions: AccountPermission[];
};

function orderedPermissions(permissions: readonly AccountPermission[]) {
  return [...new Set(permissions)].sort(
    (left, right) =>
      ALL_PERMISSIONS.indexOf(left) - ALL_PERMISSIONS.indexOf(right),
  );
}

function samePermissions(
  left: readonly AccountPermission[],
  right: readonly AccountPermission[],
) {
  const orderedLeft = orderedPermissions(left);
  const orderedRight = orderedPermissions(right);
  return orderedLeft.length === orderedRight.length &&
    orderedLeft.every((permission, index) => permission === orderedRight[index]);
}

function permissionDetailsFromResponse(body: {
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

type AdminModel = {
  archived?: boolean;
  archivedAt?: string;
  canDelete?: boolean;
  capability: ModelCapability;
  contract?: {
    activeRevision?: number;
    evidence?: "EXACT" | "GENERIC_GUESS" | "SPECIALIZED" | "UNKNOWN";
    revoked: boolean;
    status: "draft" | "missing" | "published" | "revoked";
  };
  deleteBlockedReason?: string;
  displayName: string;
  enabled: boolean;
  everPublished?: boolean;
  id: string;
  isDefault: boolean;
  parameterConstraints?: ModelParameterSchema;
  parameterSchema: ModelParameterSchema;
  providerConnected: boolean;
  providerDriver: ProviderDriver;
  providerProfileId: string;
  providerModelId: string;
  providerName: string;
  providerProtocol?: ProviderProtocol;
  references?: {
    activeTasks: number;
    canvasDocuments: number;
    tasks: number;
  };
  sortOrder: number;
  status: "disabled" | "draft" | "published";
};

type ProviderDriver =
  | "mureka"
  | "multi-protocol-relay"
  | "openai-compatible"
  | "openrouter"
  | "volcengine-ark";

type AdminProviderProfile = {
  apiKeyMask?: string;
  baseUrl: string;
  driver: ProviderDriver;
  hasApiKey: boolean;
  id: string;
  keyStatus: "unchecked" | "valid" | "invalid" | "unknown";
  lastCheckedAt?: string;
  lastVerifiedAt?: string;
  label: string;
  modelCatalog?: AdminProviderModelCatalog;
  readOnlySummary?: AdminProviderReadOnlySummary;
  status: "saved" | "verified";
  updatedAt: string;
};

type AdminProviderModelCatalog = {
  accessKeyIdMask?: string;
  capabilityCounts?: {
    audio: number;
    image: number;
    text: number;
    unknown: number;
    video: number;
  };
  catalogSource?: "enhanced" | "enhanced+basic" | "basic-fallback";
  checkedAt?: string;
  configuredModelCount: number;
  controlRequestCount: number;
  credentialMode?: "none" | "profile-api-key" | "separate";
  description?: string;
  endpointCount: number;
  endpointLabel?: string;
  errorCode?: string;
  fallbackReason?: "EMPTY" | "NOT_SUPPORTED";
  hasCredentials: boolean;
  keyStatus: "invalid" | "permission" | "unchecked" | "unknown" | "valid";
  modelLabel?: string;
  modelCount: number;
  projectName?: string;
  rejectedModelCount?: number;
  reportedModelCount?: number;
  scope?: "account" | "manual" | "public";
  snapshotStale: boolean;
  support?: "full" | "manual" | "models" | "unsupported";
  supported?: boolean;
  supportsEndpoints?: boolean;
  supportsImport?: boolean;
  supportsReadOnlyManagement?: boolean;
  supportsSync?: boolean;
  syncedAt?: string;
};

type AdminProviderDiscoveredModel = {
  capability: ModelCapability | "unknown";
  discoveryId: string;
  displayName: string;
  metadata?: {
    contextLength?: number;
    inputModalities?: string[];
    modelType?: string;
    outputModalities?: string[];
    pricingHint?: string;
    pricingSummary?: string;
    protocols?: ProviderProtocol[];
    supportedParameters?: string[];
  };
  providerModelId: string;
  source: string;
  status: string;
};

type AdminProviderReadOnlyMetric = {
  available?: boolean;
  checkedAt?: string;
  parsed?: boolean;
  summary?: Record<string, boolean | number | string | null>;
};

type AdminProviderReadOnlySummary = {
  balance?: AdminProviderReadOnlyMetric;
  checkedAt?: string;
  usage?: AdminProviderReadOnlyMetric;
};

type AdminProviderReadOnlyDescriptor = {
  available: boolean;
  resources?: {
    balance?: { supported?: boolean };
    usage?: { supported?: boolean };
  };
};

type AdminProviderCatalogDetails = {
  endpoints: Array<{
    id: string;
    name: string;
    providerModelId?: string;
    source: string;
    status: string;
  }>;
  models: AdminProviderDiscoveredModel[];
  syncedAt?: string;
};

type AdminProviderStatus = {
  paidProviderRequests: 0;
  profiles: AdminProviderProfile[];
  providerSecretsStoredInBrowser: false;
  realGenerationEnabled: false;
  supportedDrivers: ProviderDriver[];
};

type AdminStorageStatus = {
  activeBackend: "local" | "oss";
  browserStoresSecrets: false;
  cloudRequestsEnabled: boolean;
  warning?: string;
  local: {
    bytes: number;
    checksummed: number;
    enabled: true;
    objects: number;
  };
  oss: {
    activeProfileId: string;
    effectiveMediaRoutingEnabled: boolean;
    mediaRoutingEnabled: boolean;
    objectCounts: Record<string, number>;
    profiles: AdminStorageProfile[];
    provider: "aliyun-oss";
    rawMediaRoutingEnabled: boolean;
    readableProfileAvailable: boolean;
    sdkInstalled: true;
  };
};

type AdminStorageProfile = {
  accessKeyIdMask: string;
  bucket: string;
  endpoint: string;
  hasAccessKeySecret: boolean;
  id: string;
  label: string;
  lastVerifiedAt?: string;
  provider: "aliyun-oss";
  region: string;
  status: "active" | "draft" | "verified";
  updatedAt: string;
};

type StorageTestFeedback = {
  message: string;
  status: "error" | "success";
};

type GenerationSafetySettings = {
  audioConcurrency: number;
  cooldownMinutes: number;
  emergencyStop: boolean;
  failureThreshold: number;
  globalEnabled: boolean;
  imageConcurrency: number;
  perUserConcurrency: number;
  requestsPerMinute: number;
  runningTaskPolicy: "cancel" | "wait";
  textConcurrency: number;
  updatedAt: string;
  videoConcurrency: number;
};

type AdminGenerationSafetyStatus = {
  historicalEstimatedProviderAttempts?: number;
  paidProviderRequests: number;
  providerConfigured: boolean;
  settings: GenerationSafetySettings;
};

type ApiContractOperation = {
  operationId: string;
  summary: string;
};

type ApiContractDocument = {
  info: {
    description: string;
    title: string;
    version: string;
  };
  openapi: string;
  paths: Record<string, Record<string, ApiContractOperation>>;
};

function decodedRouteComponent(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return !decoded ||
        decoded.length > 200 ||
        decoded.includes("/") ||
        decoded.includes("\\") ||
        decoded.includes("\0")
      ? undefined
      : decoded;
  } catch {
    return undefined;
  }
}

const fixtureMatch = window.location.pathname.match(/^\/__fixture\/([^/]+)$/);
const fixtureRouteId = fixtureMatch
  ? decodedRouteComponent(fixtureMatch[1])
  : undefined;
const responsivePreviewMatch = window.location.pathname.match(
  /^\/__responsive-preview\/(1280x720|1440x900|1512x982|1920x1080)$/,
);
const projectWorkspaceMatch = window.location.pathname === "/canvas/projects";
const projectCanvasMatch = window.location.pathname.match(/^\/canvas\/([^/]+)$/);
const projectCanvasId = projectCanvasMatch
  ? decodedRouteComponent(projectCanvasMatch[1])
  : undefined;

function ResponsivePreview({
  height,
  width,
}: {
  height: number;
  width: number;
}) {
  const [dpr, setDpr] = useState<number>();
  const [scale, setScale] = useState(() =>
    Math.min(
      (window.innerWidth - 32) / width,
      (window.innerHeight - 86) / height,
      1,
    ),
  );

  useEffect(() => {
    const updateScale = () =>
      setScale(
        Math.min(
          (window.innerWidth - 32) / width,
          (window.innerHeight - 86) / height,
          1,
        ),
      );
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [height, width]);

  return (
    <main
      className="responsive-preview"
      data-preview-height={height}
      data-preview-dpr={dpr}
      data-preview-scale={scale}
      data-preview-width={width}
      data-testid="responsive-preview"
    >
      <header className="responsive-preview-header">
        <div className="responsive-preview-target">
          <strong>{width} × {height} 真实布局预览</strong>
          <small>
            当前 DPR {dpr ?? "读取中"} · 最小支持宽度 1280px
          </small>
        </div>
        <span>
          当前缩放至 {Math.round(scale * 100)}%，仅用于适应内置浏览器窗口
        </span>
      </header>
      <div
        className="responsive-preview-frame"
        style={{ height: height * scale, width: width * scale }}
      >
        <iframe
          aria-label={`${width}×${height}画布`}
          onLoad={(event) =>
            setDpr(event.currentTarget.contentWindow?.devicePixelRatio)
          }
          src={`/__fixture/shell.empty.primary?embedded=${width}x${height}`}
          style={{
            height,
            transform: `scale(${scale})`,
            width,
          }}
          title={`${width}×${height}画布`}
        />
      </div>
    </main>
  );
}

async function jsonRequest<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || "操作失败，请重试");
  }
  return body;
}

function hasClientPermission(
  permissions: readonly AccountPermission[] | undefined,
  permission: AccountPermission,
  role?: AuthUser["role"],
) {
  // 管理员恒有全部权限；前端权限只做展示，安全以后端校验为准。
  if (role === "admin") return true;
  return permissions?.includes(permission) ?? false;
}

function AccountForm({
  bootstrap,
  onSuccess,
}: {
  bootstrap: boolean;
  onSuccess: (user: AuthUser) => void;
}) {
  usePageTitle("登录");
  const [displayName, setDisplayName] = useState("");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await jsonRequest<{ user: AuthUser }>(
        bootstrap ? "/api/auth/bootstrap" : "/api/auth/login",
        {
          body: JSON.stringify(
            bootstrap
              ? { displayName, loginName, password }
              : { loginName, password },
          ),
          method: "POST",
        },
      );
      onSuccess(result.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page" data-testid={bootstrap ? "bootstrap-page" : "login-page"}>
      <section className="auth-card">
        <span aria-hidden="true" className="auth-mark replica-mark" />
        <div className="auth-heading">
          <h1>{bootstrap ? "创建首位管理员" : "登录 Unboundry 画布"}</h1>
          <p>
            {bootstrap
              ? "只会在这台电脑上创建一次。现有画布和素材会归到这个管理员账号。"
              : "普通用户只使用管理员已经配置好的功能。"}
          </p>
        </div>
        <form onSubmit={submit}>
          {bootstrap && (
            <label>
              <span>显示名称</span>
              <input
                autoComplete="name"
                maxLength={60}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：mymy"
                required
                value={displayName}
              />
            </label>
          )}
          <label>
            <span>登录账号</span>
            <input
              autoCapitalize="none"
              autoComplete="username"
              maxLength={40}
              minLength={3}
              onChange={(event) => setLoginName(event.target.value)}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,39}"
              placeholder="3–40 位字母、数字或 . _ -"
              required
              value={loginName}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete={bootstrap ? "new-password" : "current-password"}
              maxLength={200}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 12 位"
              required
              type="password"
              value={password}
            />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button disabled={submitting} type="submit">
            {submitting
              ? "请稍候…"
              : bootstrap
                ? "创建管理员并进入画布"
                : "登录"}
          </button>
        </form>
        {bootstrap && (
          <p className="auth-safety">
            密码只在本机加密保存，不会发给模型服务。
          </p>
        )}
      </section>
    </main>
  );
}

function AdminAccounts({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<AuthUser>();
  const [permissionsByUser, setPermissionsByUser] = useState<
    Record<string, AccountPermissionDetails>
  >({});
  const [permissionLoadErrors, setPermissionLoadErrors] = useState<
    Record<string, string>
  >({});
  const [permissionDrafts, setPermissionDrafts] = useState<
    Record<string, AccountPermission[]>
  >({});
  const [permissionBusy, setPermissionBusy] = useState("");
  const [permissionError, setPermissionError] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [resetTarget, setResetTarget] = useState<AuthUser>();
  const [resetDraft, setResetDraft] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");

  const load = async () => {
    setPermissionError("");
    try {
      const { users: result } = await jsonRequest<{ users: AuthUser[] }>(
        "/api/admin/users",
      );
      setUsers(result);
      const next: Record<string, AccountPermissionDetails> = {};
      const nextErrors: Record<string, string> = {};
      await Promise.all(
        result
          .filter((user) => user.role !== "admin")
          .map(async (user) => {
            try {
              const body = await jsonRequest<{
                defaultPermissions?: AccountPermission[];
                effectivePermissions?: AccountPermission[];
                extraPermissions?: AccountPermission[];
                permissions: AccountPermission[];
              }>(`/api/admin/users/${encodeURIComponent(user.id)}/permissions`);
              next[user.id] = permissionDetailsFromResponse(body);
            } catch (caught) {
              nextErrors[user.id] = caught instanceof Error
                ? caught.message
                : "权限读取失败";
            }
          }),
      );
      setPermissionsByUser(next);
      setPermissionLoadErrors(nextErrors);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "账号列表读取失败",
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await jsonRequest("/api/admin/users", {
        body: JSON.stringify({ displayName, loginName, password, role: newRole }),
        method: "POST",
      });
      setDisplayName("");
      setLoginName("");
      setPassword("");
      setNewRole("user");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号创建失败");
    }
  };

  const setStatus = async (user: AuthUser) => {
    setError("");
    try {
      await jsonRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        body: JSON.stringify({
          status: user.status === "active" ? "disabled" : "active",
        }),
        method: "PATCH",
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号状态修改失败");
    }
  };

  const deleteUser = async (user: AuthUser) => {
    setError("");
    try {
      await jsonRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      setDeleting(undefined);
      await load();
    } catch (caught) {
      setDeleting(undefined);
      setError(caught instanceof Error ? caught.message : "账号删除失败");
    }
  };

  const setRole = async (user: AuthUser, role: "admin" | "user") => {
    setError("");
    try {
      await jsonRequest(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        body: JSON.stringify({ role }),
        method: "PATCH",
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "角色修改失败");
    }
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    setResetBusy(true);
    setResetError("");
    try {
      await jsonRequest(
        `/api/admin/users/${encodeURIComponent(resetTarget.id)}/password`,
        {
          body: JSON.stringify({ newPassword: resetDraft }),
          method: "POST",
        },
      );
      setResetTarget(undefined);
      setResetDraft("");
      await load();
    } catch (caught) {
      setResetError(
        caught instanceof Error ? caught.message : "密码重置失败",
      );
    } finally {
      setResetBusy(false);
    }
  };

  const togglePermission = (
    user: AuthUser,
    permission: AccountPermission,
    checked: boolean,
  ) => {
    setPermissionDrafts((current) => {
      const details = permissionsByUser[user.id];
      if (!details || details.defaultPermissions.includes(permission)) {
        return current;
      }
      const base = current[user.id] ?? details.extraPermissions;
      const next = orderedPermissions(checked
        ? [...base, permission]
        : base.filter((candidate) => candidate !== permission));
      if (samePermissions(next, details.extraPermissions)) {
        const withoutUnchangedDraft = { ...current };
        delete withoutUnchangedDraft[user.id];
        return withoutUnchangedDraft;
      }
      return { ...current, [user.id]: next };
    });
  };

  const savePermissions = async (user: AuthUser) => {
    const draft = permissionDrafts[user.id];
    if (!permissionsByUser[user.id] || !draft) return;
    setPermissionBusy(user.id);
    setPermissionError("");
    try {
      const body = await jsonRequest<{
        defaultPermissions?: AccountPermission[];
        effectivePermissions?: AccountPermission[];
        extraPermissions?: AccountPermission[];
        permissions: AccountPermission[];
      }>(
        `/api/admin/users/${encodeURIComponent(user.id)}/permissions`,
        {
          body: JSON.stringify({
            extraPermissions: draft,
          }),
          method: "PUT",
        },
      );
      setPermissionsByUser((current) => ({
        ...current,
        [user.id]: permissionDetailsFromResponse(body),
      }));
      setPermissionDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
    } catch (caught) {
      setPermissionError(
        caught instanceof Error ? caught.message : "权限保存失败",
      );
    } finally {
      setPermissionBusy("");
    }
  };

  return (
    <main className="admin-page" data-testid="admin-accounts-page">
      <SettingsPageHeader
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="账号管理"
        userId={currentUser.id}
      />
      <div className="admin-layout">
        <section className="admin-card">
          <h1>添加账号</h1>
          <p>
            可以创建普通用户或管理员；最高权限账号（第一个管理员）不受其他管理员管理。
          </p>
          <form autoComplete="off" onSubmit={createUser}>
            <input
              autoComplete="off"
              maxLength={60}
              name="unboundry-new-user-display-name"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="显示名称"
              required
              value={displayName}
            />
            <input
              autoComplete="off"
              maxLength={40}
              minLength={3}
              name="unboundry-new-user-login"
              onChange={(event) => setLoginName(event.target.value)}
              pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,39}"
              placeholder="登录账号"
              required
              value={loginName}
            />
            <input
              autoComplete="new-password"
              maxLength={200}
              minLength={12}
              name="unboundry-new-user-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="初始密码（至少 12 位）"
              required
              type="password"
              value={password}
            />
            <GrayMenuSelect
              ariaLabel="新账号角色"
              onChange={(value) => setNewRole(value as "admin" | "user")}
              options={[
                { label: "普通用户", value: "user" },
                { label: "管理员", value: "admin" },
              ]}
              testId="new-account-role"
              value={newRole}
            />
            <button type="submit">创建账号</button>
          </form>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </section>
        <section className="admin-card account-list">
          <h2>现有账号</h2>
          <p className="account-permissions-hint">
            普通账号默认拥有生成、下载、项目与自己的模板/连接能力；这里只授予额外的管理能力。
          </p>
          {permissionError && (
            <p className="auth-error" role="alert">{permissionError}</p>
          )}
          {users.map((user) => {
            const permissionDetails = permissionsByUser[user.id];
            const permissionDraft = permissionDrafts[user.id];
            const effectivePermissions = permissionDetails
              ? orderedPermissions([
                  ...permissionDetails.defaultPermissions,
                  ...(permissionDraft ?? permissionDetails.extraPermissions),
                ])
              : [];
            const permissionLoadError = permissionLoadErrors[user.id];
            return (
              <article key={user.id}>
              <div className="account-list-row">
                <div>
                  <strong>{user.displayName}</strong>
                  <span>
                    登录名：{user.loginName} ·{" "}
                    {user.role === "admin" ? "管理员" : "普通用户"}
                    {user.protected && (
                      <b className="account-root-badge">最高权限</b>
                    )}
                  </span>
                </div>
                <div className="account-list-actions">
                  <button
                    disabled={
                      user.protected || user.id === currentUser.id
                    }
                    onClick={() => void setStatus(user)}
                    type="button"
                  >
                    {user.status === "active" ? "停用" : "启用"}
                  </button>
                  <button
                    className="account-delete"
                    disabled={
                      user.protected || user.id === currentUser.id
                    }
                    onClick={() => setDeleting(user)}
                    type="button"
                  >
                    删除
                  </button>
                  {!user.protected && user.id !== currentUser.id && (
                    <>
                      <button
                        disabled={resetBusy}
                        onClick={() => {
                          setResetTarget(user);
                          setResetDraft("");
                          setResetError("");
                        }}
                        type="button"
                      >
                        重置密码
                      </button>
                      <button
                        onClick={() =>
                          void setRole(
                            user,
                            user.role === "admin" ? "user" : "admin",
                          )
                        }
                        type="button"
                      >
                        {user.role === "admin" ? "设为普通用户" : "设为管理员"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div
                className="account-permissions-section"
                data-testid={`permissions-${user.id}`}
              >
                {user.role === "admin" ? (
                  <p className="account-permissions-readonly">
                    管理员（全部权限）
                  </p>
                ) : (
                  <>
                    {permissionDetails ? (
                      <div className="account-permissions-grid">
                        {ALL_PERMISSIONS.map((permission) => {
                          const adminOnly = ADMIN_ONLY_PERMISSIONS.includes(
                            permission,
                          );
                          const defaultPermission =
                            permissionDetails.defaultPermissions.includes(
                              permission,
                            );
                          return (
                            <label
                              className="account-permission-option"
                              key={permission}
                              title={permissionLabel(permission)}
                            >
                              <input
                                checked={effectivePermissions.includes(permission)}
                                className="admin-compact-checkbox"
                                disabled={
                                  permissionBusy === user.id ||
                                  adminOnly ||
                                  defaultPermission
                                }
                                onChange={(event) =>
                                  togglePermission(
                                    user,
                                    permission,
                                    event.target.checked,
                                  )
                                }
                                type="checkbox"
                              />
                              <span>{permissionLabel(permission)}</span>
                              {(adminOnly || defaultPermission) && (
                                <small className="account-permission-locked">
                                  {defaultPermission ? "默认" : "仅管理员"}
                                </small>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p
                        className="account-permissions-readonly"
                        data-testid={`permissions-load-${user.id}`}
                      >
                        {permissionLoadError
                          ? `权限读取失败：${permissionLoadError}`
                          : "正在读取权限…"}
                      </p>
                    )}
                    <div className="account-permissions-actions">
                      <button
                        disabled={
                          Boolean(permissionBusy) ||
                          !permissionDetails ||
                          !permissionDraft
                        }
                        onClick={() => void savePermissions(user)}
                        type="button"
                      >
                        {permissionBusy === user.id
                          ? "保存中…"
                          : "保存权限"}
                      </button>
                      {permissionLoadError && (
                        <button onClick={() => void load()} type="button">
                          重试读取
                        </button>
                      )}
                      {permissionDraft && (
                        <span className="account-permissions-dirty">
                          有未保存的修改
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              </article>
            );
          })}
        </section>
      </div>
      {deleting && (
        <ConfirmDialog
          danger
          message={`确定要删除账号「${deleting.displayName}」（登录名：${deleting.loginName}）？该账号下的项目、画布、生成记录和素材记录都会一并删除，且无法恢复。`}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void deleteUser(deleting)}
          title="确认删除账号"
        />
      )}
      {resetTarget && (
        <div className="admin-template-modal-backdrop">
          <div
            className="admin-template-modal"
            data-testid="reset-password-modal"
            role="dialog"
          >
            <h2>重置密码</h2>
            <p>
              正在为「{resetTarget.displayName}」（{resetTarget.loginName}）设置新密码，成功后该账号的所有会话会被吊销。
            </p>
            <label>
              <span>新密码（至少 12 位）</span>
              <input
                autoComplete="new-password"
                maxLength={200}
                minLength={12}
                onChange={(event) => setResetDraft(event.target.value)}
                type="password"
                value={resetDraft}
              />
            </label>
            {resetError && (
              <p className="auth-error" role="alert">{resetError}</p>
            )}
            <div className="admin-template-modal-actions">
              <button
                disabled={resetBusy}
                onClick={() => setResetTarget(undefined)}
                type="button"
              >
                取消
              </button>
              <button
                disabled={resetBusy || resetDraft.length < 12}
                onClick={() => void resetPassword()}
                type="button"
              >
                {resetBusy ? "重置中…" : "确认重置"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const providerDriverDetails: Record<
  ProviderDriver,
  { baseUrl: string; description: string; label: string }
> = {
  mureka: {
    baseUrl: "https://api.mureka.ai",
    description: "歌曲、纯音乐及后续音乐处理模型",
    label: "Mureka",
  },
  "multi-protocol-relay": {
    baseUrl: "",
    description: "统一接入 OpenAI、Claude、Gemini 与媒体生成协议",
    label: "多协议中转站",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    description: "统一管理文字、图片及后续可用模型",
    label: "OpenRouter",
  },
  "volcengine-ark": {
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    description: "豆包、Seedream、Seedance 等火山方舟模型",
    label: "火山方舟",
  },
  "openai-compatible": {
    baseUrl: "",
    description: "适合提供标准 OpenAI 接口的私人中转站",
    label: "OpenAI 兼容中转站",
  },
};

const providerProtocolLabels: Record<ProviderProtocol, string> = {
  native: "平台原生协议",
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  "claude-messages": "Claude Messages",
  "gemini-generate-content": "Gemini GenerateContent",
  "gpt-image": "GPT Image",
  "media-generate": "媒体生成",
};

function providerBaseUrlEditable(driver: ProviderDriver) {
  return driver === "openai-compatible" || driver === "multi-protocol-relay";
}

function relayProtocolsForCapability(capability: ModelCapability) {
  return relayProviderProtocols.filter((protocol) =>
    providerProtocolSupportsCapability(protocol, capability),
  );
}

function providerKeyStatusLabel(status: AdminProviderProfile["keyStatus"]) {
  if (status === "valid") return "Key有效";
  if (status === "invalid") return "Key已失效";
  if (status === "unknown") return "暂时无法确认";
  return "Key未检查";
}

function providerKeyCheckedAt(value?: string) {
  if (!value) return "";
  const checkedAt = new Date(value);
  if (Number.isNaN(checkedAt.getTime())) return "";
  return `上次检查：${checkedAt.toLocaleString("zh-CN", {
    hour12: false,
  })}`;
}

type ProviderCatalogCapabilities = {
  credentialMode: "none" | "profile-api-key" | "separate";
  description: string;
  endpointLabel: string;
  modelLabel: string;
  scope: "account" | "manual" | "public";
  support: "full" | "manual" | "models" | "unsupported";
  supported: boolean;
  supportsEndpoints: boolean;
  supportsImport: boolean;
  supportsSync: boolean;
};

function providerCatalogCapabilities(
  profile: AdminProviderProfile,
  catalog: AdminProviderModelCatalog,
): ProviderCatalogCapabilities {
  if (
    catalog.support &&
    catalog.credentialMode &&
    catalog.scope &&
    typeof catalog.supported === "boolean"
  ) {
    return {
      credentialMode: catalog.credentialMode,
      description:
        catalog.description || "读取平台可用的模型资料。",
      endpointLabel: catalog.endpointLabel || "Endpoint",
      modelLabel: catalog.modelLabel || "平台模型",
      scope: catalog.scope,
      support: catalog.support,
      supported: catalog.supported,
      supportsEndpoints: Boolean(catalog.supportsEndpoints),
      supportsImport: Boolean(catalog.supportsImport),
      supportsSync: Boolean(catalog.supportsSync),
    };
  }

  // 旧版方舟返回值没有能力字段，仅在此做兼容。新平台必须由服务端明确声明能力。
  if (profile.driver === "volcengine-ark") {
    return {
      credentialMode: "separate",
      description: "读取火山方舟的官方模型和当前账号Endpoint。",
      endpointLabel: "Endpoint",
      modelLabel: "官方模型",
      scope: "account",
      support: "full",
      supported: true,
      supportsEndpoints: true,
      supportsImport: true,
      supportsSync: true,
    };
  }

  return {
    credentialMode: "none",
    description: "该平台的模型目录能力尚未加载。",
    endpointLabel: "Endpoint",
    modelLabel: "平台模型",
    scope: "manual",
    support: "unsupported",
    supported: false,
    supportsEndpoints: false,
    supportsImport: false,
    supportsSync: false,
  };
}

function providerCatalogStatusLabel(
  catalog: AdminProviderModelCatalog,
  capabilities: ProviderCatalogCapabilities,
  loading: boolean,
) {
  if (loading) return "正在同步目录…";
  if (capabilities.support === "manual") return "管理员配置";
  if (!capabilities.supported) return "平台不支持";
  if (catalog.keyStatus === "valid") {
    return capabilities.credentialMode === "separate"
      ? "目录凭证有效"
      : "目录可读取";
  }
  if (catalog.keyStatus === "invalid") {
    return capabilities.credentialMode === "separate"
      ? "目录凭证已失效"
      : "Key已失效";
  }
  if (catalog.keyStatus === "permission") return "凭证可用，读取权限不足";
  if (catalog.keyStatus === "unknown") return "目录状态暂时无法确认";
  return capabilities.credentialMode === "separate"
    ? "目录凭证未检查"
    : "目录尚未检查";
}

function providerCatalogDate(value?: string) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未同步";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function providerCatalogSnapshotSourceLabel(
  source: AdminProviderModelCatalog["catalogSource"],
) {
  if (source === "enhanced") return "全量增强目录";
  if (source === "enhanced+basic") return "完整组合目录";
  if (source === "basic-fallback") return "兼容目录（仅聊天模型）";
  return "";
}

function providerCatalogFallbackMessage(
  catalog: AdminProviderModelCatalog,
) {
  if (catalog.catalogSource !== "basic-fallback") return "";
  if (catalog.fallbackReason === "NOT_SUPPORTED") {
    return "平台不支持全量增强目录，当前使用兼容目录，仅显示聊天模型。";
  }
  if (catalog.fallbackReason === "EMPTY") {
    return "全量增强目录没有返回可用模型，当前使用兼容目录，仅显示聊天模型。";
  }
  return "当前使用兼容目录，仅显示聊天模型。";
}

function providerCatalogCompletenessMessage(
  catalog: AdminProviderModelCatalog,
) {
  const rejected = catalog.rejectedModelCount ?? 0;
  const reported = catalog.reportedModelCount;
  const countLabel = catalog.catalogSource === "enhanced+basic"
    ? "合并后"
    : "平台报告";
  if (rejected > 0) {
    return `${countLabel} ${reported ?? catalog.modelCount + rejected} 个，已保存 ${catalog.modelCount} 个；${rejected} 条格式不完整记录未进入目录。`;
  }
  if (
    typeof reported === "number" &&
    Number.isFinite(reported) &&
    reported !== catalog.modelCount
  ) {
    return `${countLabel} ${reported} 个，已保存 ${catalog.modelCount} 个，数量尚未完全对齐。`;
  }
  return "";
}

function providerCatalogCapabilityLabel(
  capability: AdminProviderDiscoveredModel["capability"],
) {
  if (capability === "text") return "文字";
  if (capability === "image") return "图片";
  if (capability === "video") return "视频";
  if (capability === "audio") return "音频";
  return "待选择";
}

function providerCatalogSourceLabel(
  source: string,
  scope: ProviderCatalogCapabilities["scope"],
) {
  const normalized = source.toLowerCase();
  if (normalized.includes("endpoint")) return "当前账号Endpoint";
  if (
    normalized.includes("account") ||
    normalized.includes("user") ||
    normalized.includes("openrouter")
  ) {
    return "当前Key可见目录";
  }
  if (
    normalized.includes("foundation") ||
    normalized.includes("official") ||
    normalized.includes("control-plane")
  ) {
    return "官方目录";
  }
  if (scope === "public") return "公共目录";
  if (scope === "account") return "当前账号目录";
  return "平台目录";
}

function providerCatalogModalityLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "text") return "文字";
  if (normalized === "image") return "图片";
  if (normalized === "video") return "视频";
  if (normalized === "audio") return "音频";
  return value.trim().slice(0, 24);
}

function providerCatalogModelMetadata(
  metadata?: AdminProviderDiscoveredModel["metadata"],
) {
  if (!metadata) return [];
  const items: string[] = [];
  const input = metadata.inputModalities
    ?.slice(0, 4)
    .map(providerCatalogModalityLabel)
    .filter(Boolean);
  const output = metadata.outputModalities
    ?.slice(0, 4)
    .map(providerCatalogModalityLabel)
    .filter(Boolean);
  if (input?.length) items.push(`输入：${input.join("/")}`);
  if (output?.length) items.push(`输出：${output.join("/")}`);
  if (metadata.modelType?.trim()) {
    items.push(`类型：${metadata.modelType.trim().slice(0, 36)}`);
  }
  const protocols = metadata.protocols
    ?.filter((protocol) => protocol !== "native")
    .slice(0, 4)
    .map((protocol) => providerProtocolLabels[protocol]);
  if (protocols?.length) items.push(`协议：${protocols.join("/")}`);
  if (
    typeof metadata.contextLength === "number" &&
    Number.isFinite(metadata.contextLength) &&
    metadata.contextLength > 0
  ) {
    items.push(`上下文：${Math.floor(metadata.contextLength).toLocaleString("zh-CN")}`);
  }
  const pricing = metadata.pricingSummary?.trim() || metadata.pricingHint?.trim();
  if (pricing) {
    items.push(`价格：${pricing.slice(0, 80)}`);
  }
  if (metadata.supportedParameters?.length) {
    items.push(
      `参数：${metadata.supportedParameters
        .slice(0, 4)
        .map((item) => item.trim().slice(0, 24))
        .filter(Boolean)
        .join("/")}`,
    );
  }
  return items.slice(0, 5);
}

function discoveredRelayProtocols(model: AdminProviderDiscoveredModel) {
  return (model.metadata?.protocols ?? []).filter(
    (protocol): protocol is Exclude<ProviderProtocol, "native"> =>
      relayProviderProtocols.includes(
        protocol as Exclude<ProviderProtocol, "native">,
      ),
  );
}

function relayProtocolOptionsForModel(
  model: AdminProviderDiscoveredModel,
  capability?: ModelCapability,
) {
  const declared = discoveredRelayProtocols(model);
  return (declared.length ? declared : relayProviderProtocols).filter(
    (protocol) =>
      !capability || providerProtocolSupportsCapability(protocol, capability),
  );
}

function discoveredModelAcceptsRelayProtocol(
  model: AdminProviderDiscoveredModel,
  protocol: Exclude<ProviderProtocol, "native"> | undefined,
  capability?: ModelCapability,
) {
  return Boolean(
    protocol && relayProtocolOptionsForModel(model, capability).includes(protocol),
  );
}

function providerCatalogRemoteStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized || normalized === "unknown") return "未知";
  if (normalized === "published") return "已发布";
  if (
    normalized === "available" ||
    normalized === "active" ||
    normalized === "enabled" ||
    normalized === "ready"
  ) {
    return "可用";
  }
  if (normalized === "running" || normalized === "online") return "运行中";
  if (
    normalized === "creating" ||
    normalized === "deploying" ||
    normalized === "pending" ||
    normalized === "starting" ||
    normalized === "updating"
  ) {
    return "处理中";
  }
  if (
    normalized === "stopped" ||
    normalized === "offline" ||
    normalized === "disabled"
  ) {
    return "已停止";
  }
  if (normalized === "deprecated" || normalized === "retired") return "已下线";
  if (normalized === "failed" || normalized === "error") return "异常";
  return status.trim();
}

const emptyProviderModelCatalog: AdminProviderModelCatalog = {
  configuredModelCount: 0,
  controlRequestCount: 0,
  endpointCount: 0,
  hasCredentials: false,
  keyStatus: "unchecked",
  modelCount: 0,
  snapshotStale: false,
};

const providerCatalogPageSize = 50;
const providerCatalogSelectionLimit = 100;

function ProviderModelCatalogSection({
  onProfilesChanged,
  profile,
}: {
  onProfilesChanged: () => Promise<void>;
  profile: AdminProviderProfile;
}) {
  const catalog = profile.modelCatalog ?? emptyProviderModelCatalog;
  const capabilities = providerCatalogCapabilities(profile, catalog);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [details, setDetails] = useState<AdminProviderCatalogDetails>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCapability, setCatalogCapability] = useState<
    "all" | "unknown" | ModelCapability
  >("all");
  const [catalogProtocol, setCatalogProtocol] = useState<
    "all" | Exclude<ProviderProtocol, "native">
  >("all");
  const [catalogPage, setCatalogPage] = useState(1);
  const [unknownCapabilities, setUnknownCapabilities] = useState<
    Record<string, ModelCapability>
  >({});
  const [selectedProtocols, setSelectedProtocols] = useState<
    Record<string, Exclude<ProviderProtocol, "native">>
  >({});
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    status: "error" | "success";
  }>();

  const openCredentials = () => {
    if (capabilities.credentialMode !== "separate") return;
    setAccessKeyId("");
    setSecretAccessKey("");
    setProjectName(catalog.projectName ?? "");
    setFeedback(undefined);
    setCredentialsOpen(true);
  };

  const closeCredentials = () => {
    setAccessKeyId("");
    setSecretAccessKey("");
    setProjectName("");
    setCredentialsOpen(false);
  };

  const saveCredentials = async (event: FormEvent) => {
    event.preventDefault();
    if (capabilities.credentialMode !== "separate") return;
    if (Boolean(accessKeyId.trim()) !== Boolean(secretAccessKey)) {
      setFeedback({
        message: "修改密钥时需要同时填写AK和SK；都不填写则保留原值。",
        status: "error",
      });
      return;
    }
    if (
      !catalog.hasCredentials &&
      (!accessKeyId.trim() || !secretAccessKey)
    ) {
      setFeedback({
        message: "首次配置需要同时填写AK和SK。",
        status: "error",
      });
      return;
    }
    setSavingCredentials(true);
    setFeedback(undefined);
    try {
      await jsonRequest(
        `/api/admin/provider-catalog/${encodeURIComponent(profile.id)}/credentials`,
        {
          body: JSON.stringify({
            accessKeyId: accessKeyId.trim(),
            projectName: projectName.trim(),
            secretAccessKey,
          }),
          method: "PATCH",
        },
      );
      closeCredentials();
      setFeedback({
        message: "目录凭证已加密保存。保存本身不会连接平台。",
        status: "success",
      });
      await onProfilesChanged();
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "目录凭证保存失败",
        status: "error",
      });
    } finally {
      setSavingCredentials(false);
      setSecretAccessKey("");
    }
  };

  const refreshDetails = async () => {
    const result = await jsonRequest<AdminProviderCatalogDetails>(
      `/api/admin/provider-catalog/${encodeURIComponent(profile.id)}`,
    );
    setDetails(result);
    setSelectedIds((current) =>
      current.filter((id) =>
        result.models.some((model) => model.discoveryId === id),
      ),
    );
    setSelectedProtocols((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id, protocol]) => {
          const model = result.models.find(
            (candidate) => candidate.discoveryId === id,
          );
          if (!model) return false;
          const capability = model.capability === "unknown"
            ? unknownCapabilities[id]
            : model.capability;
          return discoveredModelAcceptsRelayProtocol(
            model,
            protocol,
            capability,
          );
        }),
      ) as Record<string, Exclude<ProviderProtocol, "native">>,
    );
    return result;
  };

  const toggleDetails = async () => {
    if (detailsOpen) {
      setDetailsOpen(false);
      return;
    }
    setDetailsOpen(true);
    if (details) return;
    setDetailsLoading(true);
    setFeedback(undefined);
    try {
      await refreshDetails();
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "模型目录读取失败",
        status: "error",
      });
    } finally {
      setDetailsLoading(false);
    }
  };

  const syncCatalog = async () => {
    if (!capabilities.supported || !capabilities.supportsSync) return;
    setSyncing(true);
    setFeedback(undefined);
    try {
      const result = await jsonRequest<{
        catalog: AdminProviderModelCatalog;
        controlPlaneRequests: number;
        message: string;
        paidGenerationRequests: 0;
      }>(`/api/admin/provider-catalog/${encodeURIComponent(profile.id)}/sync`, {
        method: "POST",
      });
      await Promise.all([onProfilesChanged(), refreshDetails()]);
      setFeedback({
        message: result.message || "模型目录已同步，付费生成请求为0。",
        status: "success",
      });
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "模型目录同步失败",
        status: "error",
      });
    } finally {
      setSyncing(false);
    }
  };

  const setModelSelected = (discoveryId: string, selected: boolean) => {
    if (
      selected &&
      !selectedIds.includes(discoveryId) &&
      selectedIds.length >= providerCatalogSelectionLimit
    ) {
      setFeedback({
        message: `单次最多选择 ${providerCatalogSelectionLimit} 个模型，请先添加当前选择。`,
        status: "error",
      });
      return;
    }
    setSelectedIds((current) =>
      selected
        ? current.includes(discoveryId)
          ? current
          : current.length >= providerCatalogSelectionLimit
            ? current
            : [...current, discoveryId]
        : current.filter((id) => id !== discoveryId),
    );
  };

  const selectedModels =
    details?.models.filter((model) => selectedIds.includes(model.discoveryId)) ??
    [];
  const normalizedCatalogQuery = catalogQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredModels =
    details?.models.filter((model) => {
      const resolvedCapability = model.capability === "unknown"
        ? unknownCapabilities[model.discoveryId] ?? "unknown"
        : model.capability;
      if (
        catalogCapability !== "all" &&
        resolvedCapability !== catalogCapability
      ) {
        return false;
      }
      if (
        profile.driver === "multi-protocol-relay" &&
        catalogProtocol !== "all" &&
        discoveredRelayProtocols(model).length > 0 &&
        !discoveredRelayProtocols(model).includes(catalogProtocol)
      ) {
        return false;
      }
      if (!normalizedCatalogQuery) return true;
      return `${model.displayName}\n${model.providerModelId}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedCatalogQuery);
    }) ?? [];
  const catalogPageCount = Math.max(
    1,
    Math.ceil(filteredModels.length / providerCatalogPageSize),
  );
  const visibleCatalogPage = Math.min(catalogPage, catalogPageCount);
  const visibleModels = filteredModels.slice(
    (visibleCatalogPage - 1) * providerCatalogPageSize,
    visibleCatalogPage * providerCatalogPageSize,
  );
  const missingCapability = selectedModels.some(
    (model) =>
      model.capability === "unknown" && !unknownCapabilities[model.discoveryId],
  );
  const missingProtocol = profile.driver === "multi-protocol-relay" &&
    selectedModels.some((model) => {
      const capability = model.capability === "unknown"
        ? unknownCapabilities[model.discoveryId]
        : model.capability;
      return !discoveredModelAcceptsRelayProtocol(
        model,
        selectedProtocols[model.discoveryId],
        capability,
      );
    });
  const selectionLimitReached =
    selectedIds.length >= providerCatalogSelectionLimit;
  const catalogImportReady = catalog.keyStatus === "valid" &&
    Boolean(catalog.syncedAt);

  const importModels = async () => {
    if (
      !capabilities.supportsImport ||
      !catalogImportReady ||
      selectedModels.length === 0 ||
      selectedModels.length > providerCatalogSelectionLimit ||
      missingCapability ||
      missingProtocol
    ) return;
    setImporting(true);
    setFeedback(undefined);
    try {
      const result = await jsonRequest<{
        imported: number;
        message: string;
        skipped: number;
      }>(
        `/api/admin/provider-catalog/${encodeURIComponent(profile.id)}/import`,
        {
          body: JSON.stringify({
            models: selectedModels.map((model) => ({
              ...(model.capability === "unknown"
                ? { capability: unknownCapabilities[model.discoveryId] }
                : {}),
              discoveryId: model.discoveryId,
              ...(profile.driver === "multi-protocol-relay"
                ? { providerProtocol: selectedProtocols[model.discoveryId] }
                : {}),
            })),
          }),
          method: "POST",
        },
      );
      setSelectedIds([]);
      setUnknownCapabilities({});
      setSelectedProtocols({});
      await onProfilesChanged();
      setFeedback({
        message:
          result.message ||
          `已添加 ${result.imported} 个模型到“${profile.label}”模型中心，当前保持停用。`,
        status: "success",
      });
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "添加到模型中心失败",
        status: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  const catalogCredentialReady =
    capabilities.credentialMode === "separate"
      ? catalog.hasCredentials
      : capabilities.credentialMode === "profile-api-key"
        ? profile.hasApiKey
        : false;
  const catalogSourceLabel = providerCatalogSnapshotSourceLabel(
    catalog.catalogSource,
  );
  const catalogFallbackMessage = providerCatalogFallbackMessage(catalog);
  const catalogCompletenessMessage = providerCatalogCompletenessMessage(catalog);
  const catalogStateMessage =
    catalog.errorCode === "FORMAT"
      ? "平台返回格式异常，已保留上次同步结果。"
      : catalog.errorCode === "PROXY_CONFIGURATION"
      ? "本机代理地址模式阻止目录同步，已保留上次结果"
      : catalog.keyStatus === "invalid"
      ? capabilities.credentialMode === "separate"
        ? "目录凭证已失效，请修改AK/SK后重新同步。"
        : "当前平台Key已失效，请修改连接后重新检查。"
      : catalog.keyStatus === "permission"
        ? "凭证本身可用，但当前账号没有读取模型目录的权限。"
        : catalog.keyStatus === "unknown"
          ? "暂时无法确认目录状态，已保留上次同步结果。"
          : catalog.keyStatus === "unchecked" && catalogCredentialReady
            ? "目录尚未检查，同步前不会改变模型中心。"
            : "";

  return (
    <section
      className="provider-model-catalog"
      data-catalog-status={
        syncing
          ? "loading"
          : capabilities.supported
            ? catalog.keyStatus
            : "unsupported"
      }
      data-catalog-support={capabilities.support}
      data-testid={`provider-model-catalog-${profile.id}`}
    >
      <div className="provider-catalog-heading">
        <div>
          <strong>{profile.label} · 模型目录</strong>
          <span>商业平台：{profile.label} · 技术接入：{providerDriverDetails[profile.driver].label}</span>
          <span>{capabilities.description}</span>
        </div>
        <b>{providerCatalogStatusLabel(catalog, capabilities, syncing)}</b>
      </div>

      {!capabilities.supported ? (
        <div className="provider-catalog-unavailable">
          {capabilities.support === "manual" ? (
            <>
              <p>平台未提供可同步模型目录；模型由管理员在模型中心配置。</p>
              <span>本项目已配置：{catalog.configuredModelCount} 个</span>
            </>
          ) : catalog.support ? (
            <p>该平台暂不支持远程模型目录，请在模型中心手动配置。</p>
          ) : (
            <p>模型目录能力尚未加载，本页不会猜测平台能力或发起请求。</p>
          )}
        </div>
      ) : (
        <>
          {capabilities.credentialMode === "separate" ? (
            <div
              className="provider-catalog-credential-summary"
              data-credential-mode="separate"
            >
              <span>
                {catalog.hasCredentials
                  ? `AK：${catalog.accessKeyIdMask || "已保存"}`
                  : "尚未配置目录凭证"}
              </span>
              {catalog.projectName && <span>项目：{catalog.projectName}</span>}
              {catalog.checkedAt && (
                <span>上次检查：{providerCatalogDate(catalog.checkedAt)}</span>
              )}
              <button onClick={openCredentials} type="button">
                {catalog.hasCredentials ? "修改目录凭证" : "配置目录凭证"}
              </button>
            </div>
          ) : (
            <div
              className="provider-catalog-credential-summary"
              data-credential-mode="profile-api-key"
            >
              <span>
                {profile.hasApiKey
                  ? "使用管理员自己的平台密钥（在「我的连接」填写）"
                  : "管理员尚未在「我的连接」填写该平台密钥"}
              </span>
              {catalog.checkedAt && (
                <span>上次检查：{providerCatalogDate(catalog.checkedAt)}</span>
              )}
              <span>无需另行配置目录凭证</span>
            </div>
          )}

          {credentialsOpen && capabilities.credentialMode === "separate" && (
            <form className="provider-catalog-credentials" onSubmit={saveCredentials}>
              <label>
                <span>AK（Access Key ID）</span>
                <input
                  autoComplete="off"
                  maxLength={500}
                  onChange={(event) => setAccessKeyId(event.target.value)}
                  placeholder={
                    catalog.hasCredentials ? "不填写则保留原AK" : "保存后只显示遮罩"
                  }
                  required={!catalog.hasCredentials}
                  type="password"
                  value={accessKeyId}
                />
              </label>
              <label>
                <span>SK（Secret Access Key）</span>
                <input
                  autoComplete="off"
                  maxLength={500}
                  onChange={(event) => setSecretAccessKey(event.target.value)}
                  placeholder={
                    catalog.hasCredentials ? "不填写则保留原SK" : "保存后不再显示"
                  }
                  required={!catalog.hasCredentials}
                  type="password"
                  value={secretAccessKey}
                />
              </label>
              <label>
                <span>项目名称（可选）</span>
                <input
                  maxLength={100}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="不填写则使用 default 项目"
                  value={projectName}
                />
              </label>
              <p>
                AK和SK只会加密保存在本机；本应用不写入浏览器本地存储，也不会把密钥放进地址中。
              </p>
              <div>
                <button disabled={savingCredentials} type="submit">
                  {savingCredentials ? "正在加密保存…" : "加密保存"}
                </button>
                <button
                  disabled={savingCredentials}
                  onClick={closeCredentials}
                  type="button"
                >
                  取消
                </button>
              </div>
            </form>
          )}

          <dl
            className="provider-catalog-counts"
            data-has-endpoints={capabilities.supportsEndpoints ? "true" : "false"}
          >
            <div>
              <dt>{capabilities.modelLabel}</dt>
              <dd>{catalog.modelCount}</dd>
            </div>
            {capabilities.supportsEndpoints && (
              <div>
                <dt>{capabilities.endpointLabel}</dt>
                <dd>{catalog.endpointCount}</dd>
              </div>
            )}
            <div>
              <dt>本项目已配置</dt>
              <dd>{catalog.configuredModelCount}</dd>
            </div>
          </dl>

          {(catalogSourceLabel || catalog.capabilityCounts) && (
            <div
              className="provider-catalog-diagnostics"
              data-catalog-source={catalog.catalogSource ?? "legacy"}
            >
              {catalogSourceLabel && (
                <p className="provider-catalog-source-summary">
                  <strong>
                    {catalog.snapshotStale ? "保留快照来源" : "目录来源"}：
                    {catalogSourceLabel}
                  </strong>
                  {typeof catalog.reportedModelCount === "number" && (
                    <span>
                      {catalog.catalogSource === "enhanced+basic"
                        ? "合并后"
                        : "平台报告"}：
                      {catalog.reportedModelCount} 个
                    </span>
                  )}
                  <span>已保存：{catalog.modelCount} 个</span>
                  {catalog.catalogSource === "enhanced+basic" && (
                    <span>增强目录与兼容目录已只读获取并去重合并</span>
                  )}
                </p>
              )}
              {catalog.capabilityCounts && (
                <dl
                  aria-label="模型类型统计"
                  className="provider-catalog-capability-counts"
                >
                  <div>
                    <dt>文字</dt>
                    <dd>{catalog.capabilityCounts.text}</dd>
                  </div>
                  <div>
                    <dt>图片</dt>
                    <dd>{catalog.capabilityCounts.image}</dd>
                  </div>
                  <div>
                    <dt>视频</dt>
                    <dd>{catalog.capabilityCounts.video}</dd>
                  </div>
                  <div>
                    <dt>音频</dt>
                    <dd>{catalog.capabilityCounts.audio}</dd>
                  </div>
                  {catalog.capabilityCounts.unknown > 0 && (
                    <div>
                      <dt>待识别</dt>
                      <dd>{catalog.capabilityCounts.unknown}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          )}

          {catalogStateMessage && (
            <p
              className="provider-catalog-state-note"
              data-state={catalog.keyStatus}
            >
              {catalogStateMessage}
            </p>
          )}

          {catalogFallbackMessage && (
            <p className="provider-catalog-state-note" data-state="fallback">
              {catalogFallbackMessage}
            </p>
          )}

          {catalogCompletenessMessage && (
            <p className="provider-catalog-state-note" data-state="warning">
              {catalogCompletenessMessage}
            </p>
          )}

          <div className="provider-catalog-sync-row">
            <span>
              上次同步：{providerCatalogDate(catalog.syncedAt)}
              {catalog.snapshotStale ? " · 目录资料可能已过期" : ""}
            </span>
            <div className="provider-catalog-sync-actions">
              {capabilities.supportsSync && (
                <button
                  disabled={!catalogCredentialReady || syncing}
                  onClick={() => void syncCatalog()}
                  type="button"
                >
                  {syncing ? "同步中…" : `同步“${profile.label}”目录`}
                </button>
              )}
              <button
                aria-expanded={detailsOpen}
                disabled={!catalog.syncedAt && catalog.modelCount === 0}
                onClick={() => void toggleDetails()}
                type="button"
              >
                {detailsOpen ? "收起发现模型" : "查看发现模型"}
              </button>
            </div>
          </div>

          {detailsOpen && (
            <div className="provider-catalog-details">
              {detailsLoading ? (
                <p>正在读取已同步目录…</p>
              ) : details ? (
                <>
                  {details.models.length > 0 ? (
                    <>
                      <div className="provider-catalog-toolbar">
                        <input
                          aria-label="搜索发现模型"
                          onChange={(event) => {
                            setCatalogQuery(event.target.value);
                            setCatalogPage(1);
                          }}
                          placeholder="搜索模型名称或内部编号"
                          type="search"
                          value={catalogQuery}
                        />
                        <GrayMenuSelect
                          ariaLabel="筛选节点类型"
                          onChange={(value) => {
                            setCatalogCapability(
                              value as "all" | "unknown" | ModelCapability,
                            );
                            setCatalogPage(1);
                          }}
                          options={[
                            { label: "全部类型", value: "all" },
                            { label: "文字", value: "text" },
                            { label: "图片", value: "image" },
                            { label: "视频", value: "video" },
                            { label: "音频", value: "audio" },
                            ...(details.models.some(
                              (model) => model.capability === "unknown",
                            )
                              ? [{ label: "待识别", value: "unknown" }]
                              : []),
                          ]}
                          value={catalogCapability}
                        />
                        {profile.driver === "multi-protocol-relay" && (
                          <GrayMenuSelect
                            ariaLabel="筛选调用协议"
                            onChange={(value) => {
                              setCatalogProtocol(
                                value as
                                  | "all"
                                  | Exclude<ProviderProtocol, "native">,
                              );
                              setCatalogPage(1);
                            }}
                            options={[
                              { label: "全部协议", value: "all" },
                              ...relayProviderProtocols.map((protocol) => ({
                                label: providerProtocolLabels[protocol],
                                value: protocol,
                              })),
                            ]}
                            value={catalogProtocol}
                          />
                        )}
                        <span>
                          共{details.models.length}个
                          {filteredModels.length !== details.models.length
                            ? ` · 找到${filteredModels.length}个`
                            : ""}
                        </span>
                      </div>
                      <p className="provider-catalog-toolbar-note">
                        当前商业平台为“{profile.label}”。勾选后默认保持停用；管理员检查参数并手动发布后，普通用户才会看到。
                      </p>
                      {missingCapability && (
                        <p className="provider-catalog-warning">
                          所选的待识别模型需要先选择节点类型。
                        </p>
                      )}
                      {missingProtocol && (
                        <p className="provider-catalog-warning">
                          所选的中转模型需要选择当前目录与节点类型兼容的调用协议。
                        </p>
                      )}
                      {selectionLimitReached && (
                        <p className="provider-catalog-warning">
                          单次最多选择 {providerCatalogSelectionLimit} 个模型；请先添加当前选择，再继续下一批。
                        </p>
                      )}
                      {!catalogImportReady && (
                        <p className="provider-catalog-warning">
                          连接资料或Key状态已变化，请先重新同步目录再添加模型。
                        </p>
                      )}
                      {filteredModels.length > 0 ? (
                        <>
                        <div className="provider-catalog-model-list">
                          {visibleModels.map((model) => {
                            const checked = selectedIds.includes(model.discoveryId);
                            const metadataItems = providerCatalogModelMetadata(
                              model.metadata,
                            );
                            const resolvedCapability = model.capability === "unknown"
                              ? unknownCapabilities[model.discoveryId]
                              : model.capability;
                            const protocolOptions = relayProtocolOptionsForModel(
                              model,
                              resolvedCapability,
                            );
                            return (
                              <div key={model.discoveryId}>
                                <label>
                                  <input
                                    className="admin-compact-checkbox"
                                    checked={checked}
                                    disabled={!checked && selectionLimitReached}
                                    onChange={(event) =>
                                      setModelSelected(
                                        model.discoveryId,
                                        event.target.checked,
                                      )
                                    }
                                    type="checkbox"
                                  />
                                  <span>
                                    <strong title={model.displayName}>
                                      {model.displayName}
                                    </strong>
                                    <small
                                      className="provider-catalog-model-identity"
                                      title={model.providerModelId}
                                    >
                                      {model.providerModelId} · {providerCatalogSourceLabel(
                                        model.source,
                                        capabilities.scope,
                                      )}
                                      {` · 平台状态：${providerCatalogRemoteStatusLabel(model.status)}`}
                                    </small>
                                    {metadataItems.length > 0 && (
                                      <small
                                        className="provider-catalog-model-metadata"
                                        title={metadataItems.join(" · ")}
                                      >
                                        {metadataItems.join(" · ")}
                                      </small>
                                    )}
                                  </span>
                                </label>
                                <div className="provider-catalog-row-controls">
                                  {model.capability === "unknown" ? (
                                    <GrayMenuSelect
                                      ariaLabel={`${model.displayName}节点类型`}
                                      onChange={(value) => {
                                        const nextCapability = value as ModelCapability;
                                        setUnknownCapabilities((current) => ({
                                          ...current,
                                          [model.discoveryId]: nextCapability,
                                        }));
                                        const selectedProtocol =
                                          selectedProtocols[model.discoveryId];
                                        if (
                                          selectedProtocol &&
                                          !providerProtocolSupportsCapability(
                                            selectedProtocol,
                                            nextCapability,
                                          )
                                        ) {
                                          setSelectedProtocols((current) => {
                                            const next = { ...current };
                                            delete next[model.discoveryId];
                                            return next;
                                          });
                                        }
                                      }}
                                      options={[
                                        { label: "文字", value: "text" },
                                        { label: "图片", value: "image" },
                                        { label: "视频", value: "video" },
                                        { label: "音频", value: "audio" },
                                      ]}
                                      placeholder="选择节点类型"
                                      value={unknownCapabilities[model.discoveryId] ?? ""}
                                    />
                                  ) : (
                                    <span className="provider-catalog-capability">
                                      {providerCatalogCapabilityLabel(model.capability)}
                                    </span>
                                  )}
                                  {profile.driver === "multi-protocol-relay" && (
                                    <GrayMenuSelect
                                      ariaLabel={`${model.displayName}调用协议`}
                                      onChange={(value) =>
                                        setSelectedProtocols((current) => ({
                                          ...current,
                                          [model.discoveryId]: value as
                                            Exclude<ProviderProtocol, "native">,
                                        }))
                                      }
                                      options={protocolOptions.map((protocol) => ({
                                        label: providerProtocolLabels[protocol],
                                        value: protocol,
                                      }))}
                                      placeholder="选择调用协议"
                                      value={selectedProtocols[model.discoveryId] ?? ""}
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {catalogPageCount > 1 && (
                          <nav
                            aria-label="发现模型分页"
                            className="provider-catalog-pagination"
                          >
                            <button
                              aria-label="上一页目录"
                              disabled={visibleCatalogPage === 1}
                              onClick={() =>
                                setCatalogPage(Math.max(1, visibleCatalogPage - 1))
                              }
                              type="button"
                            >
                              上一页
                            </button>
                            <span>
                              第{visibleCatalogPage}页／共{catalogPageCount}页
                            </span>
                            <button
                              aria-label="下一页目录"
                              disabled={visibleCatalogPage === catalogPageCount}
                              onClick={() =>
                                setCatalogPage(
                                  Math.min(catalogPageCount, visibleCatalogPage + 1),
                                )
                              }
                              type="button"
                            >
                              下一页
                            </button>
                          </nav>
                        )}
                        </>
                      ) : (
                        <p className="provider-catalog-filter-empty">
                          没有符合当前搜索和类型条件的模型。
                        </p>
                      )}
                      {capabilities.supportsImport && (
                        <div className="provider-catalog-bulk-bar">
                          <span>
                            已选{selectedModels.length}个／共{details.models.length}个
                          </span>
                          <button
                            disabled={
                              importing ||
                              !catalogImportReady ||
                              selectedModels.length === 0 ||
                              selectedModels.length > providerCatalogSelectionLimit ||
                              missingCapability ||
                              missingProtocol
                            }
                            onClick={() => void importModels()}
                            type="button"
                          >
                            {importing
                              ? "正在添加…"
                              : `添加到“${profile.label}”模型中心（${selectedModels.length}）`}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p>当前同步结果中没有可添加的模型。</p>
                  )}
                  {capabilities.supportsEndpoints && details.endpoints.length > 0 && (
                    <div className="provider-catalog-endpoint-list">
                      <strong>当前账号 {capabilities.endpointLabel}</strong>
                      {details.endpoints.map((endpoint) => (
                        <div key={endpoint.id}>
                          <span>{endpoint.name}</span>
                          <small>
                            {endpoint.id}
                            {endpoint.providerModelId
                              ? ` · ${endpoint.providerModelId}`
                              : ""}
                            {` · 平台状态：${providerCatalogRemoteStatusLabel(endpoint.status)}`}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p>目录尚未加载，请重新展开查看。</p>
              )}
            </div>
          )}

          {feedback && (
            <p
              className="provider-catalog-feedback"
              data-status={feedback.status}
              role="status"
            >
              {feedback.message}
            </p>
          )}
          <p className="provider-catalog-safety-note">
            “{profile.label}”目录同步只读取该商业平台资料，不会跨平台导入、自动发布模型、改变默认模型或发起真实生成。
          </p>
        </>
      )}
    </section>
  );
}

function relayReadOnlyMetricText(metric?: AdminProviderReadOnlyMetric) {
  if (!metric?.available || metric.parsed === false || !metric.summary) return "";
  const metricValue = (value: unknown) => {
    if (Array.isArray(value)) return value.join("/").slice(0, 80);
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .slice(0, 8)
        .map(([key, count]) => `${key} ${String(count)}`)
        .join("/")
        .slice(0, 80);
    }
    return String(value).slice(0, 80);
  };
  return Object.entries(metric.summary)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 6)
    .map(([key, value]) => `${key}：${metricValue(value)}`)
    .join(" · ");
}

function ProviderRelayReadOnlySection({
  profile,
}: {
  profile: AdminProviderProfile;
}) {
  const [summary, setSummary] = useState<AdminProviderReadOnlySummary | undefined>(
    profile.readOnlySummary,
  );
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const balanceText = relayReadOnlyMetricText(summary?.balance);
  const usageText = relayReadOnlyMetricText(summary?.usage);

  useEffect(() => {
    setSummary(profile.readOnlySummary);
  }, [profile.readOnlySummary]);

  const loadReadOnlySummary = async () => {
    setLoading(true);
    setFeedback("");
    try {
      const base = `/api/admin/provider-catalog/${encodeURIComponent(profile.id)}/readonly`;
      const descriptor = await jsonRequest<AdminProviderReadOnlyDescriptor>(base);
      const requested = await Promise.all(
        (["balance", "usage"] as const).map(async (resource) => {
          if (!descriptor.resources?.[resource]?.supported) {
            return [resource, undefined] as const;
          }
          try {
            return [
              resource,
              await jsonRequest<AdminProviderReadOnlyMetric>(`${base}/${resource}`),
            ] as const;
          } catch {
            return [resource, undefined] as const;
          }
        }),
      );
      const next = Object.fromEntries(requested) as AdminProviderReadOnlySummary;
      const hasVisibleData = Boolean(
        relayReadOnlyMetricText(next.balance) || relayReadOnlyMetricText(next.usage),
      );
      setSummary(hasVisibleData ? next : undefined);
      setFeedback(
        hasVisibleData
          ? "只读信息已更新，不会创建生成任务。"
          : "平台没有返回可展示的余额或用量资料。",
      );
    } catch (caught) {
      setSummary(undefined);
      setFeedback(
        caught instanceof Error ? caught.message : "只读信息暂时不可用",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="provider-relay-readonly" data-testid={`provider-relay-readonly-${profile.id}`}>
      <div className="provider-relay-readonly-heading">
        <div>
          <strong>可选只读信息</strong>
          <span>仅在平台返回可解析资料后显示余额或用量，不涉及生成。</span>
        </div>
        <button
          disabled={loading}
          onClick={() => void loadReadOnlySummary()}
          type="button"
        >
          {loading ? "读取中…" : "读取余额/用量"}
        </button>
      </div>
      {(balanceText || usageText) && (
        <div className="provider-relay-readonly-cards">
          {balanceText && (
            <div title={balanceText}>
              <strong>余额</strong>
              <span>{balanceText}</span>
            </div>
          )}
          {usageText && (
            <div title={usageText}>
              <strong>用量</strong>
              <span>{usageText}</span>
            </div>
          )}
        </div>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}

function AdminProviders({ currentUser }: { currentUser: AuthUser }) {
  const [profiles, setProfiles] = useState<AdminProviderProfile[]>([]);
  const [driver, setDriver] = useState<ProviderDriver>("openrouter");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    providerDriverDetails.openrouter.baseUrl,
  );
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState("");
  const [testFeedback, setTestFeedback] = useState<
    Record<string, { message: string; status: "error" | "success" }>
  >({});
  const [connectionSettingsId, setConnectionSettingsId] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [connectionBaseUrl, setConnectionBaseUrl] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () =>
    jsonRequest<AdminProviderStatus>("/api/admin/providers")
      .then((result) => setProfiles(result.profiles))
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "平台连接读取失败",
        ),
      );

  useEffect(() => {
    void load();
  }, []);

  const chooseDriver = (next: ProviderDriver) => {
    setDriver(next);
    setBaseUrl(providerDriverDetails[next].baseUrl);
  };

  const resetForm = () => {
    setBaseUrl(providerDriverDetails.openrouter.baseUrl);
    setDriver("openrouter");
    setLabel("");
  };

  const openConnectionSettings = (profile: AdminProviderProfile) => {
    if (connectionSettingsId === profile.id) {
      setConnectionSettingsId("");
      setConnectionError("");
      return;
    }
    setConnectionSettingsId(profile.id);
    setConnectionLabel(profile.label);
    setConnectionBaseUrl(profile.baseUrl);
    setConnectionError("");
    setNotice("");
  };

  const closeConnectionSettings = () => {
    setConnectionSettingsId("");
    setConnectionLabel("");
    setConnectionBaseUrl("");
    setConnectionError("");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        "/api/admin/providers",
        {
          body: JSON.stringify({ baseUrl, driver, label }),
          method: "POST",
        },
      );
      resetForm();
      setNotice(
        "连接资料已加密保存；尚未连接平台，也没有发起生成或产生费用。",
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "平台连接保存失败");
    } finally {
      setBusy(false);
    }
  };

  const saveConnectionSettings = async (
    event: FormEvent,
    profile: AdminProviderProfile,
  ) => {
    event.preventDefault();
    setConnectionBusy(true);
    setConnectionError("");
    setNotice("");
    try {
      await jsonRequest(
        `/api/admin/providers/${encodeURIComponent(profile.id)}`,
        {
          body: JSON.stringify({
            baseUrl: connectionBaseUrl,
            driver: profile.driver,
            label: connectionLabel,
          }),
          method: "PATCH",
        },
      );
      closeConnectionSettings();
      setNotice(
        "连接设置已保存；生成密钥由每个账号在「我的连接」填写。",
      );
      await load();
    } catch (caught) {
      setConnectionError(
        caught instanceof Error ? caught.message : "连接设置保存失败",
      );
    } finally {
      setConnectionBusy(false);
    }
  };

  const testConnection = async (profile: AdminProviderProfile) => {
    setTestingId(profile.id);
    setTestFeedback((current) => {
      const next = { ...current };
      delete next[profile.id];
      return next;
    });
    try {
      const result = await jsonRequest<{
        paidGenerationRequests: 0;
        verification: { message: string };
      }>(`/api/admin/providers/${encodeURIComponent(profile.id)}/test`, {
        method: "POST",
      });
      setTestFeedback((current) => ({
        ...current,
        [profile.id]: {
          message: result.verification.message,
          status: "success",
        },
      }));
    } catch (caught) {
      setTestFeedback((current) => ({
        ...current,
        [profile.id]: {
          message:
            caught instanceof Error ? caught.message : "连接测试失败",
          status: "error",
        },
      }));
    } finally {
      await load();
      setTestingId("");
    }
  };

  return (
    <main
      className="admin-page provider-admin-page"
      data-testid="admin-providers-page"
    >
      <SettingsPageHeader
        browserTitle="平台连接"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="管理员平台连接"
        userId={currentUser.id}
      />
      <div className="model-safety-banner provider-safety-banner">
        <div>
          <strong>这里只保存平台连接</strong>
          <span>
            生成 API Key 由每个账号在「我的连接」自行填写；保存不会连接平台、不会生成内容，当前付费请求为0。
          </span>
        </div>
        <button
          onClick={() => {
            window.location.href = settingsDestination(
              "/admin/models",
              currentUser.id,
            );
          }}
          type="button"
        >
          前往模型中心
        </button>
      </div>
      {notice && (
        <p className="storage-admin-notice provider-page-message">{notice}</p>
      )}
      <div className="provider-admin-layout">
        <section className="admin-card provider-create-card">
          <h1>添加平台连接</h1>
          <p>选择平台后，只填写名称和地址；生成密钥由每个账号在「我的连接」填写。</p>
          <form onSubmit={save}>
            <div className="provider-driver-grid" aria-label="技术接入方式">
              {(Object.keys(providerDriverDetails) as ProviderDriver[]).map(
                (item) => (
                  <button
                    aria-pressed={driver === item}
                    data-selected={driver === item ? "true" : "false"}
                    key={item}
                    onClick={() => chooseDriver(item)}
                    type="button"
                  >
                    <strong>{providerDriverDetails[item].label}</strong>
                    <span>{providerDriverDetails[item].description}</span>
                  </button>
                ),
              )}
              <button disabled type="button">
                <strong>特殊接口</strong>
                <span>需要单独适配时再开放，不填写复杂规则</span>
              </button>
            </div>
            <label>
              <span>商业平台名称</span>
              <input
                maxLength={40}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="例如：云腾（按余额和账单所有者命名）"
                required
                value={label}
              />
            </label>
            <label>
              <span>接口地址</span>
              <input
                maxLength={300}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                readOnly={!providerBaseUrlEditable(driver)}
                required
                value={baseUrl}
              />
            </label>
            <button disabled={busy} type="submit">
              {busy ? "正在加密保存…" : "加密保存连接"}
            </button>
          </form>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </section>
        <section className="admin-card provider-list-card">
          <div className="provider-list-heading">
            <div>
              <span>已保存连接</span>
              <h2>平台连接</h2>
            </div>
            <b>{profiles.length} 个</b>
          </div>
          {profiles.length === 0 ? (
            <div
              className="model-list-empty provider-list-empty"
              data-testid="provider-list-empty"
            >
              <strong>还没有平台连接</strong>
              <span>先在左侧保存一个平台账号，再去模型中心添加模型。</span>
            </div>
          ) : (
            <div className="provider-profile-list">
              {profiles.map((profile) => (
                <article key={profile.id}>
                  <div className="provider-profile-summary">
                    <span>商业平台</span>
                    <strong>{profile.label}</strong>
                    <small>技术 Driver：{providerDriverDetails[profile.driver].label}</small>
                    <small title={profile.baseUrl}>{profile.baseUrl}</small>
                  </div>
                  <div className="provider-profile-actions">
                    <b data-key-status={profile.keyStatus}>
                      {providerKeyStatusLabel(profile.keyStatus)}
                    </b>
                    {profile.lastCheckedAt && (
                      <small className="provider-key-checked-at">
                        {providerKeyCheckedAt(profile.lastCheckedAt)}
                      </small>
                    )}
                    <button
                      disabled={testingId === profile.id}
                      onClick={() => void testConnection(profile)}
                      type="button"
                    >
                      {testingId === profile.id
                        ? "检查中…"
                        : "检查连接"}
                    </button>
                    <button
                      aria-expanded={connectionSettingsId === profile.id}
                      onClick={() => openConnectionSettings(profile)}
                      type="button"
                    >
                      {connectionSettingsId === profile.id
                        ? "收起设置"
                        : "编辑连接"}
                    </button>
                  </div>
                  {profile.driver === "multi-protocol-relay" && (
                    <dl className="provider-relay-summary">
                      <div>
                        <dt>商业平台</dt>
                        <dd>{profile.label}</dd>
                      </div>
                      <div>
                        <dt>技术 Driver</dt>
                        <dd>{providerDriverDetails[profile.driver].label}</dd>
                      </div>
                      <div>
                        <dt>Key状态</dt>
                        <dd>{providerKeyStatusLabel(profile.keyStatus)}</dd>
                      </div>
                      <div>
                        <dt>目录状态</dt>
                        <dd>
                          {providerCatalogStatusLabel(
                            profile.modelCatalog ?? emptyProviderModelCatalog,
                            providerCatalogCapabilities(
                              profile,
                              profile.modelCatalog ?? emptyProviderModelCatalog,
                            ),
                            false,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>模型数量</dt>
                        <dd>{profile.modelCatalog?.modelCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>上次检查</dt>
                        <dd>
                          {providerCatalogDate(
                            profile.lastCheckedAt ?? profile.modelCatalog?.checkedAt,
                          )}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {connectionSettingsId === profile.id && (
                    <form
                      className="provider-inline-settings"
                      onSubmit={(event) =>
                        void saveConnectionSettings(event, profile)
                      }
                    >
                      <div className="provider-inline-settings-heading">
                        <div>
                          <strong>连接设置</strong>
                          <span>
                            生成密钥由每个账号在「我的连接」填写；保存后连接检查状态会重置。
                          </span>
                        </div>
                        <button
                          disabled={connectionBusy}
                          onClick={closeConnectionSettings}
                          type="button"
                        >
                          取消
                        </button>
                      </div>
                      <label>
                        <span>连接名称</span>
                        <input
                          aria-label={`${profile.label}连接名称`}
                          maxLength={40}
                          onChange={(event) =>
                            setConnectionLabel(event.target.value)
                          }
                          required
                          value={connectionLabel}
                        />
                      </label>
                      <label>
                        <span>接口地址</span>
                        <input
                          aria-label={`${profile.label}接口地址`}
                          maxLength={300}
                          onChange={(event) =>
                            setConnectionBaseUrl(event.target.value)
                          }
                          readOnly={!providerBaseUrlEditable(profile.driver)}
                          required
                          value={connectionBaseUrl}
                        />
                      </label>
                      {connectionError && (
                        <p className="auth-error" role="alert">
                          {connectionError}
                        </p>
                      )}
                      <button disabled={connectionBusy} type="submit">
                        {connectionBusy ? "正在加密保存…" : "保存连接设置"}
                      </button>
                    </form>
                  )}
                  {testFeedback[profile.id] && (
                    <p
                      className="provider-test-feedback"
                      data-status={testFeedback[profile.id].status}
                      role="status"
                    >
                      {testFeedback[profile.id].message}
                    </p>
                  )}
                  {profile.driver === "multi-protocol-relay" && (
                    <ProviderRelayReadOnlySection profile={profile} />
                  )}
                  <ProviderModelCatalogSection
                    onProfilesChanged={load}
                    profile={profile}
                  />
                </article>
              ))}
            </div>
          )}
          <div className="provider-next-step">
            <strong>Key状态</strong>
            <span>
              这里只确认已保存的Key是否仍可用，不会生成内容或产生生成费用。
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}

function AdminParameterDefaultSelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel?: string;
  onChange: (value: ModelParameterValue) => void;
  options: ModelParameterOption[];
  value: ModelParameterValue;
}) {
  return (
    <GrayMenuSelect
      ariaLabel={ariaLabel}
      chevronClassName="admin-parameter-select-chevron"
      className="admin-parameter-select"
      menuClassName="admin-parameter-select-menu"
      onChange={(nextValue) => onChange(nextValue as ModelParameterValue)}
      optionClassName="admin-parameter-select-option"
      options={options.map((option) => ({
        label: option.label,
        value: String(option.value),
      }))}
      placeholder="未设置"
      triggerClassName="admin-parameter-select-trigger"
      value={String(value)}
    />
  );
}

function AdminCustomParameterBuilder({
  onChange,
  schema,
}: {
  onChange: (schema: ModelParameterSchema) => void;
  schema: ModelParameterSchema;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ModelParameterField["type"]>("select");
  const [group, setGroup] = useState<ModelParameterField["group"]>("main");
  const [optionText, setOptionText] = useState("低=low，中=medium，高=high");
  const [builderError, setBuilderError] = useState("");
  const customFields = schema.fields.filter(isCustomParameterField);
  const typeOptions: ModelParameterOption[] = [
    { label: "下拉选择", value: "select" },
    { label: "开关", value: "boolean" },
    { label: "数字", value: "number" },
    { label: "单行文字", value: "text" },
    { label: "多行文字", value: "textarea" },
  ];
  const groupOptions: ModelParameterOption[] = [
    { label: "输入区", value: "input" },
    { label: "主参数", value: "main" },
    { label: "高级设置", value: "advanced" },
    { label: "输出", value: "output" },
  ];
  const typeLabels = Object.fromEntries(
    typeOptions.map((option) => [String(option.value), option.label]),
  );
  const groupLabels = Object.fromEntries(
    groupOptions.map((option) => [String(option.value), option.label]),
  );

  const updateField = (key: string, update: Partial<ModelParameterField>) => {
    onChange({
      ...schema,
      fields: schema.fields.map((field) => field.key === key ? { ...field, ...update } : field),
    });
  };

  const addField = () => {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setBuilderError("请填写参数名称");
      return;
    }
    if (schema.fields.length >= 24) {
      setBuilderError("单个模型最多配置24个参数");
      return;
    }
    const parsedOptions = optionText
      .split(/[，,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 16)
      .map((entry) => {
        const [optionLabel, ...rawValue] = entry.split("=");
        const value = rawValue.length ? rawValue.join("=").trim() : optionLabel.trim();
        return { label: optionLabel.trim(), value } satisfies ModelParameterOption;
      })
      .filter((option, index, items) =>
        option.label && option.value && items.findIndex((item) => item.value === option.value) === index,
      );
    if (type === "select" && parsedOptions.length < 1) {
      setBuilderError("下拉参数至少需要一个选项");
      return;
    }
    const options = type === "select"
      ? parsedOptions
      : type === "boolean"
        ? [{ label: "开启", value: true }, { label: "关闭", value: false }]
        : [];
    const defaultValue: ModelParameterValue = type === "select"
      ? options[0].value
      : type === "boolean"
        ? false
        : type === "number" ? 0 : "";
    const key = `custom_${crypto.randomUUID().replaceAll("-", "")}`;
    onChange({
      ...schema,
      fields: [
        ...schema.fields,
        {
          defaultValue,
          group,
          key,
          label: cleanLabel,
          ...(type === "number" ? { max: 100, min: 0, step: 1 } : {}),
          ...(type === "text" || type === "textarea" ? { maxLength: 2_000 } : {}),
          options,
          providerStatus: "pending",
          summary: true,
          type,
        },
      ],
    });
    setBuilderError("");
    setLabel("");
    setOpen(false);
  };

  return (
    <section className="admin-custom-parameters">
      <div className="admin-custom-parameters-heading">
        <div>
          <strong>未来模型参数</strong>
          <span>新增后会自动出现在对应节点；收费平台映射保持待适配。</span>
        </div>
        <button
          disabled={schema.fields.length >= 24}
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? "取消新增" : "新增参数"}
        </button>
      </div>
      {open && (
        <div className="admin-custom-parameter-builder">
          <label>
            <span>用户看到的参数名称</span>
            <input
              maxLength={40}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="例如：安全等级"
              value={label}
            />
          </label>
          <label>
            <span>参数形式</span>
            <AdminParameterDefaultSelect
              onChange={(value) => setType(value as ModelParameterField["type"])}
              options={typeOptions}
              value={type}
            />
          </label>
          <label>
            <span>显示位置</span>
            <AdminParameterDefaultSelect
              onChange={(value) => setGroup(value as ModelParameterField["group"])}
              options={groupOptions}
              value={group ?? "main"}
            />
          </label>
          {type === "select" && (
            <label className="admin-custom-parameter-options-input">
              <span>下拉选项</span>
              <input
                onChange={(event) => setOptionText(event.target.value)}
                placeholder="显示名称=平台值，用逗号分隔"
                value={optionText}
              />
              <small>例如：低=low，中=medium，高=high</small>
            </label>
          )}
          {builderError && <span className="admin-custom-parameter-error">{builderError}</span>}
          <button onClick={addField} type="button">添加到节点</button>
        </div>
      )}
      {customFields.length > 0 && (
        <div className="admin-custom-parameter-list">
          {customFields.map((field) => (
            <div className="admin-custom-parameter-card" key={field.key}>
              <div>
                <strong>{field.label}</strong>
                <span>{typeLabels[field.type]} · {groupLabels[field.group ?? "main"]}</span>
              </div>
              <b>待平台适配</b>
              {(field.type === "select" || field.type === "boolean") && (
                <label>
                  <span>默认值</span>
                  <AdminParameterDefaultSelect
                    onChange={(value) => updateField(field.key, { defaultValue: value })}
                    options={field.options}
                    value={field.defaultValue}
                  />
                </label>
              )}
              {field.type === "number" && (
                <label>
                  <span>默认值</span>
                  <input
                    max={field.max}
                    min={field.min}
                    onChange={(event) => updateField(field.key, {
                      defaultValue: Math.min(
                        field.max ?? Number.POSITIVE_INFINITY,
                        Math.max(field.min ?? Number.NEGATIVE_INFINITY, Number(event.target.value) || 0),
                      ),
                    })}
                    step={field.step}
                    type="number"
                    value={Number(field.defaultValue)}
                  />
                </label>
              )}
              {(field.type === "text" || field.type === "textarea") && (
                <label>
                  <span>默认内容</span>
                  <input
                    maxLength={field.maxLength}
                    onChange={(event) => updateField(field.key, { defaultValue: event.target.value })}
                    value={String(field.defaultValue)}
                  />
                </label>
              )}
              <button
                onClick={() => onChange({
                  ...schema,
                  fields: schema.fields.filter((item) => item.key !== field.key),
                })}
                type="button"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <small>“待平台适配”参数只负责节点显示和保存，不会直接发送到任何收费接口。</small>
    </section>
  );
}

function AdminGptImageSizeMapRowAdd({
  existing,
  listIdBase,
  onAdd,
  tier,
}: {
  existing: ReadonlySet<string>;
  listIdBase: string;
  onAdd: (ratio: string, pixel: string) => void;
  tier: GptImageSizeTier;
}) {
  const [ratio, setRatio] = useState("");
  const [pixel, setPixel] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const nextRatio = ratio.trim();
    const nextPixel = pixel.trim();
    if (existing.has(nextRatio)) {
      setError("这个比例已经加过了");
      return;
    }
    const message = gptImageSizeMapEntryError(nextRatio, nextPixel);
    if (message) {
      setError(message);
      return;
    }
    onAdd(nextRatio, nextPixel);
    setRatio("");
    setPixel("");
    setError("");
  };
  return (
    <div className="admin-gpt-image-size-row-add">
      <input
        aria-label={`新增${tier.toUpperCase()}比例`}
        onChange={(event) => setRatio(event.target.value)}
        placeholder="比例，如 9:16 或 auto"
        value={ratio}
        list={`${listIdBase}-${tier}`}
      />
      <input
        aria-label={`新增${tier.toUpperCase()}像素`}
        onChange={(event) => setPixel(event.target.value)}
        placeholder="像素，如 2160x3840 或 auto"
        value={pixel}
      />
      <button onClick={add} type="button">加一行</button>
      {error && (
        <span className="admin-gpt-image-size-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function AdminGptImageSizeMapEditor({
  onChange,
  schema,
}: {
  onChange: (schema: ModelParameterSchema) => void;
  schema: ModelParameterSchema;
}) {
  const listIdBase = useId();
  const sizeMap = schema.sizeMap ?? {};
  const ratioSuggestions = Array.from(new Set([
    "auto",
    ...(schema.fields.find((field) => field.key === "aspectRatio")?.options ?? [])
      .filter((option) => (option.availability ?? "available") === "available")
      .map((option) => String(option.value)),
  ]));
  const updateSizeMap = (next: GptImageSizeMap | undefined) =>
    onChange({ ...schema, sizeMap: next });
  const setEntry = (tier: GptImageSizeTier, ratio: string, pixel: string) => {
    const tierRows = { ...(sizeMap[tier] ?? {}) };
    tierRows[ratio] = pixel;
    updateSizeMap({ ...sizeMap, [tier]: tierRows });
  };
  const removeEntry = (tier: GptImageSizeTier, ratio: string) => {
    const tierRows = { ...(sizeMap[tier] ?? {}) };
    delete tierRows[ratio];
    const next = { ...sizeMap };
    if (Object.keys(tierRows).length === 0) {
      delete next[tier];
    } else {
      next[tier] = tierRows;
    }
    updateSizeMap(next);
  };
  const addEntry = (tier: GptImageSizeTier) => (
    ratio: string,
    pixel: string,
  ) => {
    const tierRows = { ...(sizeMap[tier] ?? {}) };
    tierRows[ratio] = pixel;
    updateSizeMap({ ...sizeMap, [tier]: tierRows });
  };
  const builtinRatios = Array.from(new Set(
    gptImageSizeTiers.flatMap((tier) =>
      Object.keys(youchuangGptImageSizes[tier]),
    ),
  ));
  return (
    <section
      className="admin-gpt-image-size-map"
      data-testid="admin-gpt-image-size-map"
    >
      <div className="admin-gpt-image-size-map-heading">
        <div>
          <strong>优创尺寸映射</strong>
          <span>这里一般不用动：空着就按下面的内置表出图；想改某个组合才点「加一行」。保存后只对之后新提交的格子生效。</span>
        </div>
        <button onClick={() => updateSizeMap(undefined)} type="button">
          全部恢复内置默认
        </button>
      </div>
      {gptImageSizeTiers.map((tier) => {
        const tierRows = sizeMap[tier] ?? {};
        const rows = Object.entries(tierRows);
        return (
          <div className="admin-gpt-image-size-tier" data-tier={tier} key={tier}>
            <strong>{tier.toUpperCase()}</strong>
            {rows.length === 0 ? (
              <small>没填 = 按内置表发</small>
            ) : (
              rows.map(([ratio, pixel]) => (
                <div className="admin-gpt-image-size-row" key={ratio}>
                  <span className="admin-gpt-image-size-ratio">{ratio}</span>
                  <input
                    aria-label={`${tier.toUpperCase()} ${ratio} 像素`}
                    onChange={(event) =>
                      setEntry(tier, ratio, event.target.value.trim())
                    }
                    value={pixel}
                  />
                  <button onClick={() => removeEntry(tier, ratio)} type="button">
                    删行
                  </button>
                </div>
              ))
            )}
            <AdminGptImageSizeMapRowAdd
              existing={new Set(rows.map(([ratio]) => ratio))}
              listIdBase={listIdBase}
              onAdd={addEntry(tier)}
              tier={tier}
            />
          </div>
        );
      })}
      {gptImageSizeTiers.map((tier) => (
        <datalist id={`${listIdBase}-${tier}`} key={`list-${tier}`}>
          {ratioSuggestions.map((ratio) => (
            <option key={ratio} value={ratio} />
          ))}
        </datalist>
      ))}
      <div className="admin-gpt-image-size-reference">
        <strong>文档内置表（参考）</strong>
        <table>
          <thead>
            <tr>
              <th>比例</th>
              {gptImageSizeTiers.map((tier) => (
                <th key={tier}>{tier.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {builtinRatios.map((ratio) => (
              <tr key={ratio}>
                <td>{ratio}</td>
                {gptImageSizeTiers.map((tier) => (
                  <td key={tier}>
                    {youchuangGptImageSizes[tier][ratio] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminModelParameterEditor({
  capability,
  constraints,
  onChange,
  providerProtocol = "",
  schema,
}: {
  capability: ModelCapability;
  constraints?: ModelParameterSchema;
  onChange: (schema: ModelParameterSchema) => void;
  providerProtocol?: ProviderProtocol | "";
  schema: ModelParameterSchema;
}) {
  const groupLabels = {
    advanced: "高级设置",
    input: "输入区",
    main: "主参数",
    output: "输出",
  } as const;
  const availabilityOptions: ModelParameterOption[] = [
    { label: "可用", value: "available" },
    { label: "显示但禁用", value: "disabled" },
    { label: "显示为锁定", value: "locked" },
  ];
  const catalogEntries = Object.entries(parameterOptionCatalog).filter(
    ([key, item]) =>
      item.capability.includes(capability) &&
      (!constraints || constraints.fields.some((field) => field.key === key)),
  );
  const availableOptions = (key: string) =>
    constraints?.fields.find((field) => field.key === key)?.options ??
    parameterOptionCatalog[key]?.options ??
    [];
  const updateFields = (fields: ModelParameterField[]) =>
    onChange({ ...schema, fields });

  const setFieldEnabled = (key: string, enabled: boolean) => {
    if (!enabled && constraints?.referencePolicy?.modeKey === key) return;
    if (!enabled) {
      updateFields(schema.fields.filter((field) => field.key !== key));
      return;
    }
    const catalog = parameterOptionCatalog[key];
    if (!catalog || !catalog.capability.includes(capability)) return;
    const selectable = catalog.type === "select" || catalog.type === "boolean";
    const enabledOptions = selectable ? availableOptions(key) : [];
    const defaultValue: ModelParameterValue = selectable
      ? enabledOptions[0]?.value ?? ""
      : catalog.type === "number" ? 0 : "";
    updateFields([
      ...schema.fields,
      {
        defaultValue,
        group: catalog.group,
        key,
        label: catalog.label,
        maxLength: catalog.maxLength,
        options: enabledOptions,
        placeholder: catalog.placeholder,
        summary: catalog.summary,
        type: catalog.type,
      },
    ]);
  };

  const setOptionEnabled = (
    field: ModelParameterField,
    value: ModelParameterValue,
    enabled: boolean,
  ) => {
    const catalog = parameterOptionCatalog[field.key];
    if (!catalog) return;
    const allowedOptions = availableOptions(field.key);
    let options = enabled
      ? allowedOptions.filter((option) =>
          field.options.some((current) => current.value === option.value) ||
          option.value === value,
        )
      : field.options.filter((option) => option.value !== value);
    if (options.length === 0) return;
    const defaultValue = options.some(
      (option) => option.value === field.defaultValue,
    )
      ? field.defaultValue
      : options[0].value;
    options = allowedOptions.filter((option) =>
      options.some((current) => current.value === option.value),
    );
    updateFields(schema.fields.map((item) =>
      item.key === field.key ? { ...item, defaultValue, options } : item,
    ));
  };

  const setDefault = (field: ModelParameterField, value: ModelParameterValue) => {
    updateFields(schema.fields.map((item) =>
      item.key === field.key ? { ...item, defaultValue: value } : item,
    ));
  };

  const setOptionAvailability = (
    field: ModelParameterField,
    value: ModelParameterValue,
    availability: ModelParameterAvailability,
  ) => {
    const options = field.options.map((option) => option.value === value
      ? {
          ...option,
          availability: availability === "available" ? undefined : availability,
          disabledReason: availability === "available" ? undefined : "当前模型配置不可用",
        }
      : option);
    const available = options.filter((option) => (option.availability ?? "available") === "available");
    if (available.length === 0) return;
    const defaultValue = available.some((option) => option.value === field.defaultValue)
      ? field.defaultValue
      : available[0].value;
    updateFields(schema.fields.map((item) => item.key === field.key
      ? { ...item, defaultValue, options }
      : item));
  };

  const setVisibleSource = (field: ModelParameterField, sourceKey: ModelParameterValue) => {
    const source = schema.fields.find((item) => item.key === sourceKey);
    const visibleWhen = source?.options[0]
      ? [{ key: source.key, operator: "equals" as const, value: source.options[0].value }]
      : undefined;
    updateFields(schema.fields.map((item) => item.key === field.key
      ? { ...item, visibleWhen }
      : item));
  };

  const setVisibleValue = (field: ModelParameterField, value: ModelParameterValue) => {
    const condition = field.visibleWhen?.[0];
    if (!condition) return;
    updateFields(schema.fields.map((item) => item.key === field.key
      ? { ...item, visibleWhen: [{ ...condition, value }] }
      : item));
  };

  const inputKinds = ["text", "image", "video", "audio"] as const;
  const inputKindLabels: Record<ModelUpstreamInputKind, string> = {
    audio: "音频",
    image: "图片",
    text: "文字",
    video: "视频",
  };
  const inputMode = schema.fields.find((field) => field.key === "inputMode");
  const inputRoleOptions: Record<
    ModelUpstreamInputKind,
    Array<{ label: string; value: string }>
  > = {
    audio: capability === "text"
      ? [{ label: "音频上下文", value: "context-audio" }]
      : [{ label: "参考音频", value: "reference-audio" }],
    image: capability === "text"
      ? [{ label: "图片上下文", value: "context-image" }]
      : capability === "video"
        ? [
            { label: "普通参考", value: "reference-image" },
            { label: "首帧", value: "first-frame" },
            { label: "尾帧", value: "last-frame" },
            { label: "主体", value: "subject" },
          ]
        : [{ label: "参考图片", value: "reference-image" }],
    text: capability === "text"
      ? [{ label: "文字上下文", value: "context-text" }]
      : [{ label: "生成指令", value: "instruction" }],
    video: capability === "text"
      ? [{ label: "视频上下文", value: "context-video" }]
      : capability === "video"
        ? [
            { label: "普通参考", value: "reference-video" },
            { label: "主体", value: "subject" },
          ]
        : [{ label: "参考视频", value: "reference-video" }],
  };
  const productAllowsUpstream = (kind: ModelUpstreamInputKind) =>
    capability === "text" ||
    capability === "video" ||
    kind === "text" ||
    (capability === "image" && kind === "image");
  const implicitUpstreamInputs = Object.fromEntries(inputKinds.map((kind) => {
    if (capability === "text") {
      return [kind, { ...textOnlyUpstreamInputs[kind] }];
    }
    if (kind === "text") {
      return [kind, { limitMode: "context" as const, supported: true }];
    }
    const count = productAllowsUpstream(kind)
      ? schema.referenceInputs[kind as keyof ModelReferenceInputs]
      : 0;
    return [kind, {
      limitMode: "fixed" as const,
      maxCount: count,
      supported: count > 0,
    }];
  })) as NonNullable<ModelParameterSchema["upstreamInputs"]>;
  const upstreamInputs = schema.upstreamInputs ?? implicitUpstreamInputs;
  const inputPolicy: ModelNodeInputPolicy = schema.inputPolicy ?? {
    switchPolicy: "keep-edge",
  };
  const upstreamConstraint = (kind: ModelUpstreamInputKind) => {
    if (!productAllowsUpstream(kind)) {
      return { limitMode: "fixed" as const, maxCount: 0, supported: false };
    }
    const explicit = constraints?.upstreamInputs?.[kind];
    if (explicit) return explicit;
    if (constraints && capability !== "text" && kind !== "text") {
      const maximum = constraints.referenceInputs[kind];
      return {
        limitMode: "fixed" as const,
        maxCount: maximum,
        supported: maximum > 0,
      };
    }
    return undefined;
  };
  const maximumUpstreamCount = (kind: ModelUpstreamInputKind) => {
    const allowed = upstreamConstraint(kind);
    return allowed?.limitMode === "fixed"
      ? allowed.maxCount ?? 0
      : 16;
  };
  const effectiveRoles = (kind: ModelUpstreamInputKind) => {
    const configured = inputPolicy.roles?.[kind];
    return configured?.length
      ? configured
      : [inputRoleOptions[kind][0].value];
  };
  const updateInputPolicy = (next: ModelNodeInputPolicy) =>
    onChange({ ...schema, inputPolicy: next });

  const setReferenceLimit = (
    kind: keyof ModelParameterSchema["referenceInputs"],
    raw: string,
  ) => {
    const maximum = productAllowsUpstream(kind)
      ? constraints?.referenceInputs[kind] ?? 16
      : 0;
    const value = Math.max(0, Math.min(maximum, Math.round(Number(raw) || 0)));
    onChange({
      ...schema,
      referenceInputs: { ...schema.referenceInputs, [kind]: value },
    });
  };

  const referenceMediaKinds = ["image", "video", "audio"] as const;
  const referenceMediaKindLabels: Record<"audio" | "image" | "video", string> = {
    audio: "音频",
    image: "图片",
    video: "视频",
  };
  const defaultReferenceMediaRule = (
    kind: "audio" | "image" | "video",
  ): ModelReferenceMediaRule => {
    const allowed = constraints?.referenceMediaRules?.[kind];
    if (allowed) return { ...allowed, contentTypes: [...allowed.contentTypes] };
    return kind === "audio"
      ? { contentTypes: ["audio/mpeg", "audio/wav"], maxBytes: 15 * 1024 * 1024 }
      : kind === "video"
        ? { contentTypes: ["video/mp4"], maxBytes: 200 * 1024 * 1024 }
        : { contentTypes: ["image/png"], maxBytes: 20 * 1024 * 1024 };
  };
  const setReferenceMediaEnabled = (
    kind: "audio" | "image" | "video",
    enabled: boolean,
  ) => {
    const current = schema.referenceMediaRules ?? {};
    onChange({
      ...schema,
      referenceMediaRules: {
        ...current,
        [kind]: enabled ? defaultReferenceMediaRule(kind) : undefined,
      },
    });
  };
  const setReferenceMediaRule = (
    kind: "audio" | "image" | "video",
    patch: Partial<ModelReferenceMediaRule>,
  ) => {
    const current = schema.referenceMediaRules?.[kind];
    if (!current) return;
    onChange({
      ...schema,
      referenceMediaRules: {
        ...schema.referenceMediaRules,
        [kind]: { ...current, ...patch },
      },
    });
  };

  const maximumReferences = (sets: ModelReferenceInputs[]) => sets.reduce<ModelReferenceInputs>(
    (maximum, set) => ({
      audio: Math.max(maximum.audio, set.audio),
      image: Math.max(maximum.image, set.image),
      video: Math.max(maximum.video, set.video),
    }),
    { audio: 0, image: 0, video: 0 },
  );

  const saveReferencePolicy = (modes: NonNullable<ModelParameterSchema["referencePolicy"]>["modes"]) => {
    const referenceInputs = maximumReferences(
      Object.values(modes).flatMap((mode) => mode.sets),
    );
    onChange({
      ...schema,
      referenceInputs,
      referencePolicy: { modeKey: "inputMode", modes },
    });
  };

  const setModeReferenceEnabled = (enabled: boolean) => {
    if (!enabled && constraints?.referencePolicy) return;
    if (!enabled) {
      const { referencePolicy: _removed, ...rest } = schema;
      onChange({ ...rest, referenceInputs: schema.referenceInputs });
      return;
    }
    if (!inputMode) return;
    const modes = Object.fromEntries(inputMode.options.map((option) => {
      const constraintSets = constraints?.referencePolicy?.modes[String(option.value)]?.sets;
      return [String(option.value), {
        sets: constraintSets?.length
          ? constraintSets.map((set) => ({ ...set }))
          : [{ ...schema.referenceInputs }],
      }];
    }));
    saveReferencePolicy(modes);
  };

  const updateReferenceSet = (
    mode: string,
    index: number,
    kind: keyof ModelReferenceInputs,
    raw: string,
  ) => {
    if (!schema.referencePolicy) return;
    const constraintSets = constraints?.referencePolicy?.modes[mode]?.sets;
    const providerMaximum = constraintSets?.reduce(
      (value, set) => Math.max(value, set[kind]),
      0,
    ) ?? constraints?.referenceInputs[kind] ?? 16;
    const inputRule = upstreamInputs[kind];
    const inputMaximum = inputRule.supported && inputRule.limitMode === "fixed"
      ? inputRule.maxCount ?? 0
      : 16;
    const maximum = productAllowsUpstream(kind)
      ? Math.min(providerMaximum, inputMaximum)
      : 0;
    const value = Math.max(0, Math.min(maximum, Math.round(Number(raw) || 0)));
    const modes = Object.fromEntries(Object.entries(schema.referencePolicy.modes ?? {}).map(([key, entry]) => [
      key,
      key === mode
        ? { sets: entry.sets.map((set, setIndex) => setIndex === index ? { ...set, [kind]: value } : set) }
        : entry,
    ]));
    saveReferencePolicy(modes);
  };

  const addReferenceSet = (mode: string) => {
    if (!schema.referencePolicy) return;
    const current = schema.referencePolicy.modes?.[mode];
    if (!current || current.sets.length >= 4) return;
    saveReferencePolicy({
      ...schema.referencePolicy.modes,
      [mode]: { sets: [...current.sets, { audio: 0, image: 0, video: 0 }] },
    });
  };

  const removeReferenceSet = (mode: string, index: number) => {
    if (!schema.referencePolicy) return;
    const current = schema.referencePolicy.modes?.[mode];
    if (!current || current.sets.length <= 1) return;
    saveReferencePolicy({
      ...schema.referencePolicy.modes,
      [mode]: { sets: current.sets.filter((_, setIndex) => setIndex !== index) },
    });
  };

  const updateUpstreamInput = (
    kind: ModelUpstreamInputKind,
    patch: Partial<(typeof upstreamInputs)[ModelUpstreamInputKind]>,
  ) => {
    const current = upstreamInputs[kind];
    onChange({
      ...schema,
      upstreamInputs: {
        ...upstreamInputs,
        [kind]: { ...current, ...patch },
      },
    });
  };
  const setUpstreamSupported = (
    kind: ModelUpstreamInputKind,
    supported: boolean,
  ) => {
    const allowed = upstreamConstraint(kind);
    if (!productAllowsUpstream(kind) || (supported && allowed && !allowed.supported)) return;
    const current = upstreamInputs[kind];
    const nextPolicy = supported
      ? {
          ...inputPolicy,
          roles: {
            ...inputPolicy.roles,
            [kind]: effectiveRoles(kind),
          },
        }
      : {
          ...inputPolicy,
          required: { ...inputPolicy.required, [kind]: 0 },
          ...(!constraints?.inputPolicy
            ? {
                rolePolicies: inputPolicy.rolePolicies?.map((policy) => ({
                  ...policy,
                  assignment: policy.assignment
                    ? { ...policy.assignment, [kind]: [] }
                    : undefined,
                  limits: policy.limits?.filter((limit) => limit.kind !== kind),
                  roles: { ...policy.roles, [kind]: [] },
                })),
                roles: { ...inputPolicy.roles, [kind]: [] },
              }
            : {}),
        };
    onChange({
      ...schema,
      inputPolicy: nextPolicy,
      upstreamInputs: {
        ...upstreamInputs,
        [kind]: {
          ...current,
          supported,
          ...(supported && current.limitMode === "fixed"
            ? {
                maxCount: Math.max(
                  1,
                  Math.min(maximumUpstreamCount(kind), current.maxCount ?? 1),
                ),
              }
            : {}),
        },
      },
    });
  };
  const setUpstreamLimitMode = (
    kind: ModelUpstreamInputKind,
    limitMode: "context" | "fixed",
  ) => {
    const allowed = upstreamConstraint(kind);
    if (limitMode === "context" && allowed?.limitMode === "fixed") return;
    updateUpstreamInput(kind, {
      limitMode,
      ...(limitMode === "fixed"
        ? { maxCount: Math.max(1, upstreamInputs[kind].maxCount ?? 1) }
        : { maxCount: undefined }),
    });
  };
  const setUpstreamMaxCount = (kind: ModelUpstreamInputKind, raw: string) => {
    const value = Math.max(
      1,
      Math.min(maximumUpstreamCount(kind), Math.round(Number(raw) || 1)),
    );
    onChange({
      ...schema,
      inputPolicy: {
        ...inputPolicy,
        required: {
          ...inputPolicy.required,
          [kind]: Math.min(inputPolicy.required?.[kind] ?? 0, value),
        },
      },
      upstreamInputs: {
        ...upstreamInputs,
        [kind]: { ...upstreamInputs[kind], maxCount: value },
      },
    });
  };
  const roleUsedByModePolicy = (kind: ModelUpstreamInputKind, role: string) =>
    inputPolicy.rolePolicies?.some((policy) =>
      policy.roles[kind]?.includes(role)) ?? false;
  const modeRolePoliciesLocked = Boolean(constraints?.inputPolicy);
  const setModeRolePoliciesEnabled = (enabled: boolean) => {
    if (modeRolePoliciesLocked || !inputMode?.options.length) return;
    const configuredRoles = Object.fromEntries(inputKinds.map((kind) => [
      kind,
      upstreamInputs[kind].supported && productAllowsUpstream(kind)
        ? effectiveRoles(kind)
        : [],
    ])) as ModelInputRolePolicy["roles"];
    updateInputPolicy({
      ...inputPolicy,
      roles: enabled
        ? { ...inputPolicy.roles, ...configuredRoles }
        : inputPolicy.roles,
      rolePolicies: enabled
        ? inputMode.options.map((option): ModelInputRolePolicy => ({
            enabledWhen: [{
              key: inputMode.key,
              operator: "equals",
              value: option.value,
            }],
            roles: configuredRoles,
          }))
        : undefined,
    });
  };
  const updateModeRolePolicy = (
    index: number,
    update: (policy: ModelInputRolePolicy) => ModelInputRolePolicy,
  ) => {
    if (modeRolePoliciesLocked || !inputPolicy.rolePolicies?.[index]) return;
    updateInputPolicy({
      ...inputPolicy,
      rolePolicies: inputPolicy.rolePolicies.map((policy, policyIndex) =>
        policyIndex === index ? update(policy) : policy),
    });
  };
  const setModeRole = (
    policyIndex: number,
    kind: ModelUpstreamInputKind,
    role: string,
    enabled: boolean,
  ) => {
    const policies = inputPolicy.rolePolicies;
    const policy = policies?.[policyIndex];
    if (modeRolePoliciesLocked || !policy) return;
    const roles = policy.roles[kind] ?? [];
    const nextRoles = enabled
      ? [...new Set([...roles, role])]
      : roles.filter((candidate) => candidate !== role);
    const nextPolicy = {
      ...policy,
      assignment: policy.assignment
        ? {
            ...policy.assignment,
            [kind]: (policy.assignment[kind] ?? []).filter((candidate) =>
              candidate !== role),
          }
        : undefined,
      limits: enabled
        ? policy.limits
        : policy.limits?.filter((limit) =>
            limit.kind !== kind || limit.role !== role),
      roles: { ...policy.roles, [kind]: nextRoles },
    };
    const globalRoles = enabled
      ? [...new Set([...effectiveRoles(kind), role])]
      : effectiveRoles(kind);
    onChange({
      ...schema,
      inputPolicy: {
        ...inputPolicy,
        rolePolicies: policies!.map((candidate, index) =>
          index === policyIndex ? nextPolicy : candidate),
        roles: { ...inputPolicy.roles, [kind]: globalRoles },
      },
    });
  };
  const modeRoleLimit = (
    policy: ModelInputRolePolicy,
    kind: ModelUpstreamInputKind,
    role: string,
  ) => policy.limits?.find((limit) =>
    limit.kind === kind && limit.role === role) ?? {
      kind,
      maxCount: upstreamInputs[kind].limitMode === "fixed"
        ? upstreamInputs[kind].maxCount ?? 1
        : 16,
      minCount: 0,
      role,
    };
  const setModeRoleLimit = (
    policyIndex: number,
    kind: ModelUpstreamInputKind,
    role: string,
    key: "maxCount" | "minCount",
    raw: string,
  ) => updateModeRolePolicy(policyIndex, (policy) => {
    const current = modeRoleLimit(policy, kind, role);
    const maximum = upstreamInputs[kind].limitMode === "fixed"
      ? upstreamInputs[kind].maxCount ?? 1
      : 16;
    const requested = Math.max(0, Math.min(maximum, Math.round(Number(raw) || 0)));
    const next = key === "minCount"
      ? { ...current, maxCount: Math.max(current.maxCount, requested), minCount: requested }
      : { ...current, maxCount: Math.max(current.minCount, requested) };
    return {
      ...policy,
      limits: [
        ...(policy.limits ?? []).filter((limit) =>
          limit.kind !== kind || limit.role !== role),
        next,
      ],
    };
  });
  const setModeRoleAssignment = (
    policyIndex: number,
    kind: ModelUpstreamInputKind,
    role: string,
    enabled: boolean,
  ) => updateModeRolePolicy(policyIndex, (policy) => {
    const assigned = policy.assignment?.[kind] ?? [];
    const allowedOrder = inputRoleOptions[kind].map((option) => option.value);
    const nextAssigned = (enabled
      ? [...new Set([...assigned, role])]
      : assigned.filter((candidate) => candidate !== role))
      .sort((left, right) => allowedOrder.indexOf(left) - allowedOrder.indexOf(right));
    return {
      ...policy,
      assignment: { ...policy.assignment, [kind]: nextAssigned },
    };
  });

  return (
    <div className="admin-model-parameters">
      <div className="admin-model-parameters-heading">
        <strong>模型参数 · 第2版规则</strong>
        <span>可设置选项、默认值、显示条件和不可用状态；平台字段仍由安全适配器处理。</span>
      </div>
      {catalogEntries.map(([key, catalog]) => {
        const field = schema.fields.find((item) => item.key === key);
        const options = availableOptions(key);
        const conditionSources = schema.fields.filter((item) =>
          item.key !== key &&
          (item.type === "select" || item.type === "boolean") &&
          item.options.length > 0);
        const visibleCondition = field?.visibleWhen?.[0];
        const visibleSource = schema.fields.find((item) => item.key === visibleCondition?.key);
        return (
          <section
            data-enabled={field ? "true" : "false"}
            data-parameter-key={key}
            key={key}
          >
            <label className="admin-model-parameter-enable">
              <input
                className="admin-compact-checkbox"
                checked={Boolean(field)}
                disabled={constraints?.referencePolicy?.modeKey === key}
                onChange={(event) => setFieldEnabled(key, event.target.checked)}
                title={constraints?.referencePolicy?.modeKey === key
                  ? "Provider要求保留生成方式，以继续校验每种输入组合"
                  : undefined}
                type="checkbox"
              />
              <strong>{catalog.label}</strong>
              <span>{groupLabels[catalog.group]}</span>
            </label>
            {field && (
              <div className="admin-model-parameter-body">
                {(field.type === "select" || field.type === "boolean") && <div className="admin-model-parameter-options">
                  {options.map((option) => {
                    const selected = field.options.some(
                      (item) => item.value === option.value,
                    );
                    return (
                      <label data-selected={selected ? "true" : "false"} key={String(option.value)}>
                        <input
                          className="admin-compact-checkbox"
                          checked={selected}
                          onChange={(event) =>
                            setOptionEnabled(field, option.value, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>}
                {(field.type === "text" || field.type === "textarea") && (
                  <div className="admin-model-parameter-text-note">
                    此项会在节点输入区显示独立{field.type === "textarea" ? "多行" : "单行"}输入框。
                  </div>
                )}
                {(field.type === "select" || field.type === "boolean") && <label className="admin-model-parameter-default">
                  <span>默认值</span>
                  <AdminParameterDefaultSelect
                    onChange={(value) => setDefault(field, value)}
                    options={field.options.filter((option) =>
                      (option.availability ?? "available") === "available")}
                    value={field.defaultValue}
                  />
                </label>}
                {(field.type === "select" || field.type === "boolean") && field.options.length > 1 && (
                  <div className="admin-model-option-states">
                    <span>选项状态</span>
                    {field.options.map((option) => (
                      <label key={String(option.value)}>
                        <span>{option.label}</span>
                        <AdminParameterDefaultSelect
                          onChange={(value) => setOptionAvailability(
                            field,
                            option.value,
                            value as ModelParameterAvailability,
                          )}
                          options={availabilityOptions}
                          value={option.availability ?? "available"}
                        />
                      </label>
                    ))}
                  </div>
                )}
                {conditionSources.length > 0 && (
                  <div className="admin-model-parameter-condition">
                    <span>显示条件</span>
                    <div>
                      <AdminParameterDefaultSelect
                        onChange={(value) => setVisibleSource(field, value)}
                        options={[
                          { label: "始终显示", value: "__always__" },
                          ...conditionSources.map((source) => ({ label: `当${source.label}为`, value: source.key })),
                        ]}
                        value={visibleCondition?.key ?? "__always__"}
                      />
                      {visibleSource && visibleCondition && (
                        <AdminParameterDefaultSelect
                          onChange={(value) => setVisibleValue(field, value)}
                          options={visibleSource.options}
                          value={visibleCondition.value ?? visibleSource.options[0].value}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      {capability === "image" && providerProtocol === "gpt-image" && (
        <AdminGptImageSizeMapEditor onChange={onChange} schema={schema} />
      )}
      <AdminCustomParameterBuilder onChange={onChange} schema={schema} />
      <section className="admin-model-upstream-inputs">
        <div className="admin-model-reference-heading">
          <strong>入参角色与必填条件</strong>
          <span>连线保留在画布，模型只决定当前能否提交</span>
        </div>
        <div className="admin-model-upstream-list">
          {inputKinds.map((kind) => {
            const roles = effectiveRoles(kind);
            const supported = upstreamInputs[kind].supported && productAllowsUpstream(kind);
            const requiredMaximum = upstreamInputs[kind].limitMode === "fixed"
              ? upstreamInputs[kind].maxCount ?? 0
              : 16;
            return (
              <div data-input-kind={kind} key={`policy-${kind}`}>
                <strong>{inputKindLabels[kind]}</strong>
                <label>
                  <span>最少数量</span>
                  <input
                    aria-label={`${kind}必填数量`}
                    disabled={!supported}
                    max={String(requiredMaximum)}
                    min="0"
                    onChange={(event) => updateInputPolicy({
                      ...inputPolicy,
                      required: {
                        ...inputPolicy.required,
                        [kind]: Math.max(
                          0,
                          Math.min(
                            requiredMaximum,
                            Math.round(Number(event.target.value) || 0),
                          ),
                        ),
                      },
                    })}
                    type="number"
                    value={supported ? inputPolicy.required?.[kind] ?? 0 : 0}
                  />
                </label>
                <div className="admin-model-parameter-options">
                  {inputRoleOptions[kind].map((role) => {
                    const selected = roles.includes(role.value);
                    const usedByMode = roleUsedByModePolicy(kind, role.value);
                    const providerRoles = constraints?.inputPolicy?.roles?.[kind];
                    const providerForbids = Boolean(
                      providerRoles && !providerRoles.includes(role.value),
                    );
                    const lastRole = selected && roles.length === 1;
                    return (
                      <label data-selected={supported && selected ? "true" : "false"} key={role.value}>
                        <input
                          className="admin-compact-checkbox"
                          checked={supported && selected}
                          disabled={
                            !supported ||
                            providerForbids ||
                            (selected && (lastRole || usedByMode))
                          }
                          onChange={(event) => updateInputPolicy({
                            ...inputPolicy,
                            roles: {
                              ...inputPolicy.roles,
                              [kind]: event.target.checked
                                ? [...new Set([...roles, role.value])]
                                : roles.filter((value) => value !== role.value),
                            },
                          })}
                          title={usedByMode
                            ? "该角色正在生成方式规则中使用，不能从全局规则单独删除"
                            : lastRole
                              ? "每种已启用的上游类型至少保留一个角色"
                              : undefined}
                          type="checkbox"
                        />
                        <span>{role.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {inputPolicy.rolePolicies?.length ? (
          <small>已被某种生成方式使用的角色不能从全局单独删除，避免模式规则与全局规则冲突。</small>
        ) : null}
        <label className="admin-model-parameter-default">
          <span>切换模型遇到不兼容引用</span>
          <AdminParameterDefaultSelect
            ariaLabel="模型切换规则"
            onChange={(value) => updateInputPolicy({
              ...inputPolicy,
              switchPolicy: value as "block-switch" | "keep-edge",
            })}
            options={[
              { label: "保留连线并显示原因（默认）", value: "keep-edge" },
              { label: "有不兼容引用时禁止切换", value: "block-switch" },
            ]}
            value={inputPolicy.switchPolicy}
          />
        </label>
      </section>
      <section className="admin-model-upstream-inputs">
        <div className="admin-model-reference-heading">
          <strong>上游输入规则</strong>
          <span>统一设置节点可接收的类型和数量</span>
        </div>
        <div className="admin-model-upstream-list">
          {inputKinds.map((kind) => {
            const rule = upstreamInputs[kind];
            const allowed = upstreamConstraint(kind);
            const label = inputKindLabels[kind];
            const baselineAllowed = productAllowsUpstream(kind);
            const note = allowed?.note ?? rule.note;
            return (
              <div data-input-kind={kind} key={kind}>
                <label className="admin-model-upstream-enable">
                  <input
                    className="admin-compact-checkbox"
                    checked={baselineAllowed && rule.supported}
                    disabled={!baselineAllowed || Boolean(allowed && !allowed.supported)}
                    onChange={(event) => setUpstreamSupported(kind, event.target.checked)}
                    type="checkbox"
                  />
                  <strong>{label}</strong>
                </label>
                {baselineAllowed && rule.supported && (
                  <div className="admin-model-upstream-limit">
                    <AdminParameterDefaultSelect
                      ariaLabel={`${label}上游数量规则`}
                      onChange={(value) => setUpstreamLimitMode(
                        kind,
                        value as "context" | "fixed",
                      )}
                      options={[
                        ...(allowed?.limitMode === "fixed"
                          ? []
                          : [{ label: "按上下文动态计算", value: "context" }]),
                        { label: "固定画布数量", value: "fixed" },
                      ]}
                      value={rule.limitMode}
                    />
                    {rule.limitMode === "fixed" && (
                      <input
                        aria-label={`${label}上游输入上限`}
                        max={String(maximumUpstreamCount(kind))}
                        min="1"
                        onChange={(event) => setUpstreamMaxCount(kind, event.target.value)}
                        type="number"
                        value={rule.maxCount ?? 1}
                      />
                    )}
                  </div>
                )}
                {!baselineAllowed && <small>当前项目连线规则不允许该类型</small>}
                {baselineAllowed && rule.supported && note && <small>{note}</small>}
              </div>
            );
          })}
        </div>
        {capability === "text" && <label className="admin-model-parameter-default">
            <span>目标 Prompt 规则</span>
            <AdminParameterDefaultSelect
              ariaLabel="文字目标Prompt规则"
              onChange={(value) => updateInputPolicy({
                ...inputPolicy,
                promptPolicy: value as ModelNodeInputPolicy["promptPolicy"],
              })}
              options={[
                { label: "必须填写本节点 Prompt（默认）", value: "own-required" },
                { label: "允许上游文字替代空 Prompt", value: "own-or-upstream-text" },
              ]}
              value={inputPolicy.promptPolicy ?? "own-required"}
            />
          </label>}
        <small>“按上下文动态计算”表示平台没有固定素材数量，最终仍受模型输入长度限制。</small>
      </section>
      {inputMode?.options.length ? (
        <section className="admin-model-upstream-inputs">
          <div className="admin-model-reference-heading">
            <strong>按生成方式设置角色与必填</strong>
            <label>
              <input
                aria-label="按生成方式设置角色与必填"
                className="admin-compact-checkbox"
                checked={Boolean(inputPolicy.rolePolicies?.length)}
                disabled={modeRolePoliciesLocked}
                onChange={(event) => setModeRolePoliciesEnabled(event.target.checked)}
                title={modeRolePoliciesLocked
                  ? "Provider已固定这组生成方式规则"
                  : undefined}
                type="checkbox"
              />
              <span>{modeRolePoliciesLocked ? "Provider固定" : "分方式设置"}</span>
            </label>
          </div>
          {inputPolicy.rolePolicies?.length ? (
            <div className="admin-model-reference-modes">
              {inputPolicy.rolePolicies.map((policy, policyIndex) => {
                const condition = policy.enabledWhen?.[0];
                const option = inputMode.options.find((candidate) =>
                  candidate.value === condition?.value);
                const modeLabel = option?.label ?? `规则${policyIndex + 1}`;
                return (
                  <div data-role-policy={policyIndex} key={`${condition?.key ?? "rule"}-${String(condition?.value ?? policyIndex)}`}>
                    <strong>{modeLabel}</strong>
                    <div className="admin-model-upstream-list">
                      {inputKinds.map((kind) => {
                        const roles = policy.roles[kind] ?? [];
                        const supported = upstreamInputs[kind].supported &&
                          productAllowsUpstream(kind);
                        return (
                          <div data-input-kind={kind} key={`${policyIndex}-${kind}`}>
                            <strong>{inputKindLabels[kind]}</strong>
                            <div className="admin-model-parameter-options">
                              {inputRoleOptions[kind].map((role) => {
                                const selected = roles.includes(role.value);
                                return (
                                  <label data-selected={selected ? "true" : "false"} key={role.value}>
                                    <input
                                      className="admin-compact-checkbox"
                                      checked={selected}
                                      disabled={modeRolePoliciesLocked || !supported}
                                      onChange={(event) => setModeRole(
                                        policyIndex,
                                        kind,
                                        role.value,
                                        event.target.checked,
                                      )}
                                      type="checkbox"
                                    />
                                    <span>{role.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                            {roles.map((role) => {
                              const roleOption = inputRoleOptions[kind].find((item) =>
                                item.value === role);
                              const limit = modeRoleLimit(policy, kind, role);
                              const assigned = policy.assignment?.[kind]?.includes(role) ?? false;
                              return (
                                <div className="admin-model-reference-set" data-input-role={role} key={`${kind}-${role}`}>
                                  <span>{roleOption?.label ?? role}</span>
                                  <label>
                                    <span>最少</span>
                                    <input
                                      aria-label={`${modeLabel}${inputKindLabels[kind]}${roleOption?.label ?? role}最少数量`}
                                      disabled={modeRolePoliciesLocked}
                                      max={String(limit.maxCount)}
                                      min="0"
                                      onChange={(event) => setModeRoleLimit(
                                        policyIndex,
                                        kind,
                                        role,
                                        "minCount",
                                        event.target.value,
                                      )}
                                      type="number"
                                      value={limit.minCount}
                                    />
                                  </label>
                                  <label>
                                    <span>最多</span>
                                    <input
                                      aria-label={`${modeLabel}${inputKindLabels[kind]}${roleOption?.label ?? role}最多数量`}
                                      disabled={modeRolePoliciesLocked}
                                      max={String(
                                        upstreamInputs[kind].limitMode === "fixed"
                                          ? upstreamInputs[kind].maxCount ?? 1
                                          : 16,
                                      )}
                                      min={String(limit.minCount)}
                                      onChange={(event) => setModeRoleLimit(
                                        policyIndex,
                                        kind,
                                        role,
                                        "maxCount",
                                        event.target.value,
                                      )}
                                      type="number"
                                      value={limit.maxCount}
                                    />
                                  </label>
                                  <label>
                                    <span>自动分配</span>
                                    <input
                                      aria-label={`${modeLabel}${inputKindLabels[kind]}${roleOption?.label ?? role}按顺序自动分配`}
                                      className="admin-compact-checkbox"
                                      checked={assigned}
                                      disabled={modeRolePoliciesLocked}
                                      onChange={(event) => setModeRoleAssignment(
                                        policyIndex,
                                        kind,
                                        role,
                                        event.target.checked,
                                      )}
                                      type="checkbox"
                                    />
                                  </label>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <small>开启后，可分别设置每种生成方式允许的角色、必填数量和自动分配顺序。</small>
          )}
        </section>
      ) : null}
      <section className="admin-model-reference-limits">
        <div className="admin-model-reference-heading">
          <strong>参考素材组合</strong>
          {inputMode && (
            <label>
              <input
                aria-label="按生成方式分别设置素材组合"
                className="admin-compact-checkbox"
                checked={Boolean(schema.referencePolicy)}
                disabled={Boolean(constraints?.referencePolicy)}
                onChange={(event) => setModeReferenceEnabled(event.target.checked)}
                title={constraints?.referencePolicy
                  ? "Provider要求按生成方式校验素材组合"
                  : undefined}
                type="checkbox"
              />
              <span>按生成方式分别设置</span>
            </label>
          )}
        </div>
        {constraints?.referencePolicy && (
          <small>Provider要求保留分模式校验；可以在当前上限内继续收紧数量和组合。</small>
        )}
        {!schema.referencePolicy && <div className="admin-model-reference-global">
          {(["image", "video", "audio"] as const).map((kind) => (
            <label key={kind}>
              <span>{kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}</span>
              <input
                aria-label={`${kind}参考素材上限`}
                disabled={
                  !productAllowsUpstream(kind) ||
                  (constraints?.referenceInputs[kind] ?? 16) === 0
                }
                max={String(
                  productAllowsUpstream(kind)
                    ? constraints?.referenceInputs[kind] ?? 16
                    : 0,
                )}
                min="0"
                onChange={(event) => setReferenceLimit(kind, event.target.value)}
                type="number"
                value={schema.referenceInputs[kind]}
              />
            </label>
          ))}
        </div>}
        {schema.referencePolicy && (
          <div className="admin-model-reference-modes">
            {Object.entries(schema.referencePolicy.modes ?? {}).map(([mode, entry]) => {
              const modeLabel = inputMode?.options.find((option) => String(option.value) === mode)?.label ?? mode;
              return (
                <div key={mode}>
                  <strong>{modeLabel}</strong>
                  {entry.sets.map((set, index) => (
                    <div className="admin-model-reference-set" key={`${mode}-${index}`}>
                      <span>组合{index + 1}</span>
                      {(["image", "video", "audio"] as const).map((kind) => (
                        <label key={kind}>
                          <span>{kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}</span>
                          <input
                            aria-label={`${mode}组合${index + 1}${kind}上限`}
                            min="0"
                            onChange={(event) => updateReferenceSet(mode, index, kind, event.target.value)}
                            type="number"
                            value={set[kind]}
                          />
                        </label>
                      ))}
                      {entry.sets.length > 1 && (
                        <button onClick={() => removeReferenceSet(mode, index)} type="button">删除组合</button>
                      )}
                    </div>
                  ))}
                  {entry.sets.length < 4 && (
                    <button onClick={() => addReferenceSet(mode)} type="button">添加另一种组合</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <small>填0表示不接收；“另一种组合”用于表达不同素材搭配方案。</small>
      </section>
      <section className="admin-model-reference-file-rules">
        <div className="admin-model-reference-heading">
          <strong>参考素材文件规则</strong>
          <span>单段格式/大小/时长、总时长上限；Provider 上限内可自行收紧，模型升级时直接在这里调整。</span>
        </div>
        {constraints?.referenceMediaRules && (
          <small>Provider 要求保留文件规则；只能在当前上限内收紧。</small>
        )}
        <div className="admin-model-reference-media-grid">
          {referenceMediaKinds.map((kind) => {
            const constraint = constraints?.referenceMediaRules?.[kind];
            const rule = schema.referenceMediaRules?.[kind];
            const enabled = Boolean(rule) || Boolean(constraint);
            return (
              <div className="admin-model-reference-media-rule" data-kind={kind} key={kind}>
                <label className="admin-model-reference-media-enable">
                  <input
                    aria-label={`启用${referenceMediaKindLabels[kind]}素材规则`}
                    checked={enabled}
                    className="admin-compact-checkbox"
                    disabled={Boolean(constraint)}
                    onChange={(event) =>
                      setReferenceMediaEnabled(kind, event.target.checked)}
                    title={constraint
                      ? "Provider要求保留该素材规则"
                      : undefined}
                    type="checkbox"
                  />
                  <strong>{referenceMediaKindLabels[kind]}</strong>
                </label>
                {enabled && rule && (
                  <div className="admin-model-reference-media-fields">
                    <label>
                      <span>单段上限(MB)</span>
                      <input
                        aria-label={`${referenceMediaKindLabels[kind]}单段大小上限`}
                        max={String(
                          constraint
                            ? Math.floor(constraint.maxBytes / (1024 * 1024))
                            : 512,
                        )}
                        min="1"
                        onChange={(event) =>
                          setReferenceMediaRule(kind, {
                            maxBytes: Math.max(
                              1,
                              Math.round(
                                Number(event.target.value) || 1,
                              ),
                            ) * 1024 * 1024,
                          })}
                        type="number"
                        value={Math.round(rule.maxBytes / (1024 * 1024))}
                      />
                    </label>
                    {kind === "image" && (
                      <>
                        <label>
                          <span>最小宽(px)</span>
                          <input
                            aria-label="参考图片最小宽度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minWidth: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minWidth ?? ""}
                          />
                        </label>
                        <label>
                          <span>最大宽(px)</span>
                          <input
                            aria-label="参考图片最大宽度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxWidth: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxWidth ?? ""}
                          />
                        </label>
                        <label>
                          <span>最小高(px)</span>
                          <input
                            aria-label="参考图片最小高度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minHeight: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minHeight ?? ""}
                          />
                        </label>
                        <label>
                          <span>最大高(px)</span>
                          <input
                            aria-label="参考图片最大高度"
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxHeight: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxHeight ?? ""}
                          />
                        </label>
                        <label>
                          <span>宽高比下限</span>
                          <input
                            aria-label="参考图片宽高比下限"
                            min="0.1"
                            step="0.1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minAspectRatio: event.target.value === ""
                                  ? undefined
                                  : Math.max(
                                      0.1,
                                      Math.round(Number(event.target.value) * 100) / 100,
                                    ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minAspectRatio ?? ""}
                          />
                        </label>
                        <label>
                          <span>宽高比上限</span>
                          <input
                            aria-label="参考图片宽高比上限"
                            min="0.1"
                            step="0.1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxAspectRatio: event.target.value === ""
                                  ? undefined
                                  : Math.max(
                                      0.1,
                                      Math.round(Number(event.target.value) * 100) / 100,
                                    ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxAspectRatio ?? ""}
                          />
                        </label>
                      </>
                    )}
                    {kind === "video" && (
                      <>
                        <label>
                          <span>最小总像素</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}最小总像素`}
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minPixelCount: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minPixelCount ?? ""}
                          />
                        </label>
                        <label>
                          <span>最大总像素</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}最大总像素`}
                            min="1"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxPixelCount: event.target.value === ""
                                  ? undefined
                                  : Math.max(1, Math.round(Number(event.target.value) || 0)),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxPixelCount ?? ""}
                          />
                        </label>
                      </>
                    )}
                    {kind !== "image" && (
                      <>
                        <label>
                          <span>单段最短(秒)</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}单段最短时长`}
                            min="0"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                minDurationSeconds:
                                  event.target.value === ""
                                    ? undefined
                                    : Math.max(
                                        0,
                                        Math.round(Number(event.target.value) || 0),
                                      ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.minDurationSeconds ?? ""}
                          />
                        </label>
                        <label>
                          <span>单段最长(秒)</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}单段最长时长`}
                            min="0"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxDurationSeconds:
                                  event.target.value === ""
                                    ? undefined
                                    : Math.max(
                                        0,
                                        Math.round(Number(event.target.value) || 0),
                                      ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxDurationSeconds ?? ""}
                          />
                        </label>
                        <label>
                          <span>总时长上限(秒)</span>
                          <input
                            aria-label={`${referenceMediaKindLabels[kind]}参考素材总时长上限`}
                            min="0"
                            onChange={(event) =>
                              setReferenceMediaRule(kind, {
                                maxTotalDurationSeconds:
                                  event.target.value === ""
                                    ? undefined
                                    : Math.max(
                                        0,
                                        Math.round(Number(event.target.value) || 0),
                                      ),
                              })}
                            placeholder="不限"
                            type="number"
                            value={rule.maxTotalDurationSeconds ?? ""}
                          />
                        </label>
                      </>
                    )}
                    <label className="admin-model-reference-media-formats">
                      <span>格式(MIME,逗号分隔)</span>
                      <input
                        aria-label={`${referenceMediaKindLabels[kind]}允许格式`}
                        onChange={(event) => {
                          const contentTypes = event.target.value
                            .split(",")
                            .map((entry) => entry.trim())
                            .filter(Boolean);
                          if (contentTypes.length) {
                            setReferenceMediaRule(kind, { contentTypes });
                          }
                        }}
                        value={rule.contentTypes.join(",")}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {schema.referenceMediaRules?.audio && (
          <label className="admin-model-reference-audio-visual">
            <input
              checked={schema.referenceMediaRules.audioRequiresVisual === true}
              className="admin-compact-checkbox"
              disabled={Boolean(
                constraints?.referenceMediaRules?.audioRequiresVisual,
              )}
              onChange={(event) =>
                onChange({
                  ...schema,
                  referenceMediaRules: {
                    ...schema.referenceMediaRules,
                    audioRequiresVisual: event.target.checked,
                  },
                })}
              type="checkbox"
            />
            <span>参考音频必须搭配图片或视频</span>
          </label>
        )}
      </section>
    </div>
  );
}

type ModelContractWorkbenchResponse = {
  impact: {
    incompatibleTemplateIds: string[];
    preexistingIncompatibleTemplateIds?: string[];
    templateIds: string[];
  };
  parameterConstraints: ModelParameterSchema;
  paidProviderRequests: 0;
  state: ModelContractState;
  suggestedDocument: ModelReleaseDocument;
};

function AdminModelContractWorkbench({
  currentUser,
  modelId,
}: {
  currentUser: AuthUser;
  modelId: string;
}) {
  const [loaded, setLoaded] = useState<ModelContractWorkbenchResponse>();
  const [document, setDocument] = useState<ModelReleaseDocument>();
  const [draftVersion, setDraftVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [conflictSnapshot, setConflictSnapshot] =
    useState<ModelContractWorkbenchResponse>();
  const [showConflictDiff, setShowConflictDiff] = useState(false);

  const endpoint = `/api/admin/models/${encodeURIComponent(modelId)}/contract`;
  const load = () => jsonRequest<ModelContractWorkbenchResponse>(endpoint)
    .then((result) => {
      setLoaded(result);
      setDocument(result.state.draft?.document ?? result.suggestedDocument);
      setDraftVersion(result.state.draftVersion);
      setDirty(false);
      setConflict(false);
      setConflictSnapshot(undefined);
      setShowConflictDiff(false);
      setError("");
    })
    .catch((caught) => setError(
      caught instanceof Error ? caught.message : "模型合同读取失败",
    ));

  useEffect(() => { void load(); }, [modelId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mutateDocument = (next: ModelReleaseDocument) => {
    setDocument(next);
    setDirty(true);
    setNotice("");
  };
  const action = async (
    name: "draft" | "publish" | "restore" | "revoke" | "rollback" | "validate",
    body: Record<string, unknown>,
  ) => {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await jsonRequest(`${endpoint}/${name}`, {
        body: JSON.stringify(body),
        method: "POST",
      });
      setNotice(name === "draft"
        ? "草稿已保存；本次没有调用 Provider。"
        : name === "validate"
          ? "本地验证通过；Provider 请求为 0。"
          : name === "publish"
            ? "新修订已发布，只影响之后新建的任务。"
            : name === "rollback"
              ? "已创建新的回滚修订；运行中任务仍使用原修订。"
              : name === "revoke"
                ? "已停止新任务；已受理任务仍按冻结修订查询。"
                : "已恢复接受新任务。");
      await load();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "操作失败";
      setError(message);
      if (/草稿|版本|管理员/.test(message)) {
        setConflict(true);
        const current = await jsonRequest<ModelContractWorkbenchResponse>(endpoint)
          .catch(() => undefined);
        setConflictSnapshot(current);
      }
    } finally {
      setBusy("");
    }
  };

  if (!loaded || !document) {
    return <main className="system-message" role={error ? "alert" : undefined}>
      {error || "正在读取模型合同…"}
    </main>;
  }
  const updateModes = (modes: readonly ModelExecutionMode[]) => mutateDocument({
    ...document,
    executionContract: { ...document.executionContract, modes },
  });
  const updateMode = (index: number, next: ModelExecutionMode) => updateModes(
    document.executionContract.modes.map((mode, candidate) =>
      candidate === index ? next : mode
    ),
  );
  const nextModeId = () => {
    let index = document.executionContract.modes.length + 1;
    while (document.executionContract.modes.some((mode) => mode.id === `mode-${index}`)) {
      index += 1;
    }
    return `mode-${index}`;
  };
  const nextRoleId = (mode: ModelExecutionMode) => {
    let index = mode.roles.length + 1;
    while (mode.roles.some((role) => role.id === `reference-${index}`)) index += 1;
    return `reference-${index}`;
  };
  const sourceForKind = (
    kind: ModelContractBinding["source"]["kind"],
    mode: ModelExecutionMode,
  ): ModelContractBinding["source"] => {
    if (kind === "parameter") return { key: "duration", kind };
    if (kind === "role") return { kind, roleId: mode.roles[0]?.id ?? "reference-1" };
    if (kind === "constant") return { kind, value: "" };
    return { kind };
  };
  const validated = Boolean(loaded.state.draft?.validation &&
    loaded.state.draft.draftVersion === draftVersion && !dirty);
  return (
    <main
      className="admin-page model-contract-page"
      data-testid="model-contract-workbench"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
    >
      <SettingsPageHeader
        browserTitle="模型合同工作台"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="模型合同工作台"
        userId={currentUser.id}
      />
      <div className="model-contract-layout">
        <nav aria-label="合同区块" className="model-contract-nav">
          <button onClick={() => window.location.href = settingsDestination("/admin/models", currentUser.id)} type="button">← 返回模型列表</button>
          {[
            "基本信息与官方文档", "输入模式", "素材角色与数量", "模型参数",
            "请求绑定", "任务、状态、结果与错误", "验证与发布", "版本历史",
          ].map((label, index) => <a href={`#contract-section-${index + 1}`} key={label}>{label}</a>)}
        </nav>
        <div className="model-contract-editor">
          <header className="model-contract-heading">
            <div>
              <span>{document.capability.toUpperCase()}</span>
              <h1>{document.providerModelId}</h1>
              <p>草稿版本 {draftVersion} · 当前发布版本 {loaded.state.active?.revisionNumber ?? "无"}</p>
            </div>
            <b data-status={loaded.state.revoked ? "danger" : loaded.state.active ? "success" : "warning"}>
              {loaded.state.revoked ? "已停止新任务" : loaded.state.active ? "已发布" : "未发布"}
            </b>
          </header>
          <section id="contract-section-1">
            <h2>基本信息与官方文档</h2>
            <div className="model-contract-grid">
              <label><span>Provider模型ID</span><input disabled value={document.providerModelId} /></label>
              <label><span>证据级别</span><input disabled value={document.evidence} /></label>
              <label className="model-contract-wide"><span>官方文档</span><input
                aria-describedby="contract-doc-help"
                onChange={(event) => mutateDocument({
                  ...document,
                  documentation: event.target.value.trim()
                    ? [{ checkedAt: new Date().toISOString().slice(0, 10), url: event.target.value }]
                    : [],
                })}
                placeholder="https://官方文档地址"
                value={document.documentation[0]?.url ?? ""}
              /></label>
              <small id="contract-doc-help">这里只保存公开来源，不允许密钥、Cookie或签名地址。</small>
            </div>
          </section>
          <section id="contract-section-2">
            <div className="model-contract-section-heading"><h2>输入模式</h2><button onClick={() => {
              const id = nextModeId();
              updateModes([...document.executionContract.modes, {
                bindings: [
                  { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
                  { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
                ],
                id,
                prompt: "required",
                roles: [],
              }]);
            }} type="button">新增模式</button></div>
            <div className="model-contract-mode-list">
              {document.executionContract.modes.map((mode, modeIndex) => (
                <article key={`${mode.id}-${modeIndex}`}>
                  <label><span>模式ID</span><input value={mode.id} onChange={(event) => updateMode(modeIndex, { ...mode, id: event.target.value })} /></label>
                  <label><span>Prompt</span><select value={mode.prompt} onChange={(event) => updateMode(modeIndex, { ...mode, prompt: event.target.value as "optional" | "required" })}><option value="required">必填</option><option value="optional">可选</option></select></label>
                  <span>素材角色：{mode.roles.length}</span>
                  <button disabled={document.executionContract.modes.length === 1} onClick={() => updateModes(document.executionContract.modes.filter((_, candidate) => candidate !== modeIndex))} type="button">删除模式</button>
                </article>
              ))}
            </div>
          </section>
          <section id="contract-section-3">
            <h2>素材角色与数量</h2>
            {document.executionContract.modes.map((mode, modeIndex) => <div className="model-contract-subsection" key={`roles-${mode.id}-${modeIndex}`}>
              <div className="model-contract-section-heading"><h3>{mode.id}</h3><button onClick={() => {
                const role: ModelContractRole = { id: nextRoleId(mode), kind: "image", maxItems: 1, minItems: 1, ordered: true, shape: "url" };
                updateMode(modeIndex, { ...mode, roles: [...mode.roles, role] });
              }} type="button">新增角色</button></div>
              {mode.roles.length === 0 ? <p>此模式不接收素材。</p> : mode.roles.map((role, roleIndex) => <div className="model-contract-grid model-contract-repeat" key={`${role.id}-${roleIndex}`}>
                <label><span>角色ID</span><input value={role.id} onChange={(event) => {
                  const id = event.target.value;
                  updateMode(modeIndex, {
                    ...mode,
                    bindings: mode.bindings.map((item) => item.source.kind === "role" && item.source.roleId === role.id ? { ...item, source: { ...item.source, roleId: id } } : item),
                    roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, id } : item),
                  });
                }} /></label>
                <label><span>素材类型</span><select value={role.kind} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, kind: event.target.value as ModelCapability } : item) })}>{["text", "image", "video", "audio"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
                <label><span>最少数量</span><input min="0" type="number" value={role.minItems} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, minItems: Number(event.target.value) } : item) })} /></label>
                <label><span>最多数量</span><input min="0" type="number" value={role.maxItems} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, maxItems: Number(event.target.value) } : item) })} /></label>
                <label><span>值形态</span><select value={role.shape} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, shape: event.target.value as "file-id" | "url" } : item) })}><option value="url">URL</option><option value="file-id">file ID</option></select></label>
                <label className="model-contract-check"><input className="admin-compact-checkbox" checked={role.ordered} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, ordered: event.target.checked } : item) })} type="checkbox" /><span>保留输入顺序</span></label>
                <button onClick={() => updateMode(modeIndex, {
                  ...mode,
                  bindings: mode.bindings.filter((item) => item.source.kind !== "role" || item.source.roleId !== role.id),
                  roles: mode.roles.filter((_, candidate) => candidate !== roleIndex),
                })} type="button">删除角色</button>
              </div>)}
            </div>)}
          </section>
          <section id="contract-section-4"><h2>模型参数</h2><AdminModelParameterEditor capability={document.capability} constraints={loaded.parameterConstraints} onChange={(capabilitySchema) => mutateDocument({ ...document, capabilitySchema })} providerProtocol={document.providerProtocol} schema={document.capabilitySchema} /></section>
          <section id="contract-section-5"><h2>请求绑定</h2>{document.executionContract.modes.map((mode, modeIndex) => <div className="model-contract-subsection" key={`bindings-${mode.id}-${modeIndex}`}><div className="model-contract-section-heading"><h3>{mode.id}</h3><button onClick={() => updateMode(modeIndex, { ...mode, bindings: [...mode.bindings, { source: { key: "duration", kind: "parameter" }, target: { location: "json", path: "params.duration" }, transform: "string" }] })} type="button">新增绑定</button></div><div className="model-contract-bindings">{mode.bindings.map((item, bindingIndex) => <div className="model-contract-binding-row" key={bindingIndex}>
            <select aria-label="来源" value={item.source.kind} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: sourceForKind(event.target.value as ModelContractBinding["source"]["kind"], mode) } : binding) })}>{["model-id", "prompt", "parameter", "role", "constant", "task-id"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
            {item.source.kind === "parameter" && <input aria-label="参数键" value={item.source.key} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: { ...item.source, key: event.target.value } } : binding) })} />}
            {item.source.kind === "role" && <select aria-label="角色" value={item.source.roleId} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: { ...item.source, roleId: event.target.value } } : binding) })}>{mode.roles.map((role) => <option key={role.id} value={role.id}>{role.id}</option>)}</select>}
            {item.source.kind === "constant" && <input aria-label="常量" value={String(item.source.value)} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: { ...item.source, value: event.target.value } } : binding) })} />}
            <span aria-hidden="true">→</span>
            <select aria-label="转换" value={item.transform ?? ""} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, ...(event.target.value ? { transform: event.target.value as ModelContractBinding["transform"] } : { transform: undefined }) } : binding) })}><option value="">不转换</option>{["array", "boolean", "number", "omit-empty", "string"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <select aria-label="目标位置" value={item.target.location} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, target: { ...item.target, location: event.target.value as "form" | "json" | "query" } } : binding) })}><option value="json">JSON</option><option value="query">Query</option><option value="form">Form</option></select>
            <input aria-label="目标字段" value={item.target.path} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, target: { ...item.target, path: event.target.value } } : binding) })} />
            <button onClick={() => updateMode(modeIndex, { ...mode, bindings: mode.bindings.filter((_, candidate) => candidate !== bindingIndex) })} type="button">删除</button>
          </div>)}</div></div>)}</section>
          <section id="contract-section-6"><h2>任务、状态、结果与错误</h2><div className="model-contract-grid">
            <label><span>创建方法</span><input disabled value={document.executionContract.create.method} /></label>
            <label><span>创建相对路径</span><input value={document.executionContract.create.path} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, create: { ...document.executionContract.create, path: event.target.value } } })} /></label>
            <label><span>创建task ID字段</span><input value={document.executionContract.create.taskIdPath ?? ""} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, create: { ...document.executionContract.create, ...(event.target.value ? { taskIdPath: event.target.value } : { taskIdPath: undefined }) } } })} /></label>
            <label><span>查询相对路径</span><input disabled={!document.executionContract.poll} value={document.executionContract.poll?.path ?? "代码connector管理"} onChange={(event) => document.executionContract.poll && mutateDocument({ ...document, executionContract: { ...document.executionContract, poll: { ...document.executionContract.poll, path: event.target.value } } })} /></label>
            <label><span>结果字段</span><input value={document.executionContract.result.resultPath} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, result: { ...document.executionContract.result, resultPath: event.target.value } } })} /></label>
            {document.executionContract.result.states && (["running", "succeeded", "failed"] as const).map((state) => <label key={state}><span>{state}状态（逗号分隔）</span><input value={document.executionContract.result.states![state].join(", ")} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, result: { ...document.executionContract.result, states: { ...document.executionContract.result.states!, [state]: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } } } })} /></label>)}
            <label><span>错误映射</span><input disabled value="代码安全分类管理；管理端不能注入错误逻辑" /></label>
            <label><span>取消合同</span><input disabled value="未开放；需先交付正式connector" /></label>
            <label><span>fallback合同</span><input disabled value="未开放；禁止管理端静默切换Provider" /></label>
          </div></section>
          <section id="contract-section-7"><h2>验证与发布</h2><p>受影响模板 {loaded.impact.templateIds.length} 个；不兼容 {loaded.impact.incompatibleTemplateIds.length} 个。保存、验证和发布本身均不调用 Provider。</p></section>
          <section id="contract-section-8"><h2>版本历史</h2><div className="model-contract-history">{[...loaded.state.history].reverse().map((revision) => <article key={revision.revisionId}><div><strong>修订 {revision.revisionNumber}</strong><span>{new Date(revision.createdAt).toLocaleString()}</span></div><button disabled={revision.revisionId === loaded.state.active?.revisionId || busy === "rollback"} onClick={() => void action("rollback", { targetRevisionId: revision.revisionId })} type="button">回滚到此版本</button></article>)}</div></section>
        </div>
        <aside className="model-contract-summary" aria-label="合同实时摘要">
          <h2>实时摘要</h2>
          <dl><div><dt>运行方式</dt><dd>{document.runtime === "declarative" ? "声明式合同" : document.runtime === "blocked" ? "无证据，已阻断" : "代码专用connector"}</dd></div><div><dt>证据</dt><dd>{document.evidence}</dd></div><div><dt>模板影响</dt><dd>{loaded.impact.templateIds.length}</dd></div><div><dt>Provider调用</dt><dd>0</dd></div></dl>
          <details><summary>脱敏只读预览</summary><pre>{JSON.stringify(validated ? loaded.state.draft?.validation?.preview : { status: "请先保存并完成本地验证" }, null, 2)}</pre></details>
        </aside>
      </div>
      {(notice || error) && <p className="model-contract-feedback" data-status={error ? "error" : "success"} role={error ? "alert" : "status"}>{error || notice}</p>}
      {conflict && <div className="model-contract-conflict" role="alert"><strong>草稿发生并发冲突，没有覆盖另一位管理员。</strong><button disabled={!conflictSnapshot} onClick={() => setShowConflictDiff((current) => !current)} type="button">{showConflictDiff ? "隐藏差异" : "查看差异"}</button><button onClick={() => void load()} type="button">重新加载</button><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(document, null, 2))} type="button">复制未保存内容</button>{showConflictDiff && conflictSnapshot && <pre>{JSON.stringify({ serverDraftVersion: conflictSnapshot.state.draftVersion, serverDocument: conflictSnapshot.state.draft?.document ?? conflictSnapshot.suggestedDocument, unsavedDraftVersion: draftVersion, unsavedDocument: document }, null, 2)}</pre>}</div>}
      <div className="model-contract-actions" aria-label="合同操作">
        <button disabled={Boolean(busy) || (!dirty && Boolean(loaded.state.draft))} onClick={() => void action("draft", { document, expectedDraftVersion: draftVersion })} type="button">{busy === "draft" ? "保存中…" : "保存草稿"}</button>
        <button disabled={dirty || !draftVersion || Boolean(busy)} onClick={() => void action("validate", { expectedDraftVersion: draftVersion })} type="button">本地验证｜不调用 Provider</button>
        <button disabled={!validated || Boolean(busy)} onClick={() => {
          if (window.confirm(`发布修订 ${draftVersion}？只影响新任务，运行中任务继续使用旧修订；受影响模板 ${loaded.impact.templateIds.length} 个；发布不会调用 Provider。`)) void action("publish", { expectedDraftVersion: draftVersion });
        }} type="button">发布</button>
        <button className="model-contract-warning" disabled={!loaded.state.history.length || Boolean(busy)} onClick={() => void action(loaded.state.revoked ? "restore" : "revoke", {})} type="button">{loaded.state.revoked ? "恢复新任务" : "停止新任务"}</button>
      </div>
    </main>
  );
}

function AdminModels({ currentUser }: { currentUser: AuthUser }) {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [providers, setProviders] = useState<
    Array<{ displayName: string; driver: ProviderDriver; id: string; status: string }>
  >([]);
  const [providerProfileId, setProviderProfileId] = useState("");
  const [providerProtocol, setProviderProtocol] = useState<ProviderProtocol | "">(
    "",
  );
  const [capability, setCapability] =
    useState<AdminModel["capability"]>("image");
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [providerModelId, setProviderModelId] = useState("");
  const [publish, setPublish] = useState(false);
  const [parameterSchema, setParameterSchema] = useState<ModelParameterSchema>(
    defaultParameterSchema("image"),
  );
  const [editingParameterModelId, setEditingParameterModelId] = useState("");
  const [editingParameterSchema, setEditingParameterSchema] =
    useState<ModelParameterSchema>();
  const [editingParameterProviderProfileId, setEditingParameterProviderProfileId] =
    useState("");
  const [editingParameterProviderProtocol, setEditingParameterProviderProtocol] =
    useState<ProviderProtocol | "">("");
  const [showArchived, setShowArchived] = useState(false);
  const [lifecycleBusyId, setLifecycleBusyId] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  const [modelLifecycleError, setModelLifecycleError] = useState("");
  const [error, setError] = useState("");
  const capabilityMenuRef = useRef<HTMLDivElement>(null);

  const load = () =>
    jsonRequest<{
      models: AdminModel[];
      providers: Array<{
        displayName: string;
        driver: ProviderDriver;
        id: string;
        status: string;
      }>;
    }>("/api/admin/models")
      .then(({ models: result, providers: providerResult }) => {
        const configured = providerResult.filter(
          (provider) => provider.id !== "provider-unconfigured",
        );
        setModels(result);
        setProviders(configured);
        setProviderProfileId((current) => current || configured[0]?.id || "");
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "模型列表读取失败"),
      );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!capabilityOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !capabilityMenuRef.current?.contains(event.target)
      ) {
        setCapabilityOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCapabilityOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [capabilityOpen]);

  const selectedProvider = providers.find((provider) => provider.id === providerProfileId);
  const providerMismatch = (modelId: string, driver?: ProviderDriver) =>
    /^doubao-(?:seed|seedance)-/i.test(modelId) && driver !== "volcengine-ark";
  const selectedProviderMismatch = providerMismatch(
    providerModelId,
    selectedProvider?.driver,
  );
  const selectedProviderUsesRelay =
    selectedProvider?.driver === "multi-protocol-relay";
  const relayProtocolReady =
    !selectedProviderUsesRelay ||
    (providerProtocol !== "" &&
      providerProtocol !== "native" &&
      providerProtocolSupportsCapability(providerProtocol, capability));
  const recommendedParameterSchema = (
    nextCapability = capability,
    nextProviderModelId = providerModelId,
    nextProvider = selectedProvider,
  ) => knownModelParameterSchema({
    capability: nextCapability,
    providerDriver: nextProvider?.driver,
    providerModelId: nextProviderModelId,
  });

  const createModel = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!providerProfileId) {
      setError("请先到“平台连接”保存一个平台账号");
      return;
    }
    if (selectedProviderMismatch) {
      setError("这个豆包模型必须选择火山方舟连接");
      return;
    }
    if (!relayProtocolReady) {
      setError("请为多协议中转模型明确选择调用协议");
      return;
    }
    try {
      await jsonRequest("/api/admin/models", {
        body: JSON.stringify({
          capability,
          displayName,
          isDefault: false,
          parameterSchema,
          providerModelId,
          providerProfileId,
          providerProtocol: selectedProviderUsesRelay
            ? providerProtocol
            : "native",
          sortOrder: 100,
          status: publish ? "published" : "draft",
        }),
        method: "POST",
      });
      setDisplayName("");
      setProviderModelId("");
      setPublish(false);
      setProviderProtocol(selectedProviderUsesRelay ? "" : "native");
      setParameterSchema(defaultParameterSchema(capability));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型创建失败");
    }
  };

  const updateModel = async (
    model: AdminModel,
    update: Partial<
      Pick<
        AdminModel,
        "isDefault" | "parameterSchema" | "providerProfileId" | "providerProtocol" | "status"
      >
    >,
  ) => {
    setError("");
    try {
      await jsonRequest(`/api/admin/models/${encodeURIComponent(model.id)}`, {
        body: JSON.stringify(update),
        method: "PATCH",
      });
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型修改失败");
      return false;
    }
  };

  const updateModelLifecycle = async (
    model: AdminModel,
    action: "archive" | "delete" | "restore",
  ) => {
    if (
      action === "delete" &&
      !window.confirm(
        `永久删除“${model.displayName}”？此操作只允许未发布且没有任何画布或任务引用的草稿，删除后不能恢复。`,
      )
    ) {
      return;
    }
    setLifecycleBusyId(model.id);
    setModelLifecycleError("");
    setModelNotice("");
    try {
      if (action === "delete") {
        await jsonRequest(`/api/admin/models/${encodeURIComponent(model.id)}`, {
          method: "DELETE",
        });
      } else {
        await jsonRequest(
          `/api/admin/models/${encodeURIComponent(model.id)}/${action}`,
          { method: "POST" },
        );
      }
      if (editingParameterModelId === model.id) {
        setEditingParameterModelId("");
        setEditingParameterSchema(undefined);
        setEditingParameterProviderProfileId("");
        setEditingParameterProviderProtocol("");
      }
      setModelNotice(
        action === "archive"
          ? `“${model.displayName}”已归档，旧画布和历史记录仍会保留。`
          : action === "restore"
            ? `“${model.displayName}”已恢复，仍沿用原模型ID。`
            : `“${model.displayName}”草稿已永久删除。`,
      );
      await load();
    } catch (caught) {
      setModelLifecycleError(
        caught instanceof Error ? caught.message : "模型生命周期操作失败",
      );
    } finally {
      setLifecycleBusyId("");
    }
  };

  const saveModelParameters = async (model: AdminModel) => {
    if (!editingParameterSchema) return;
    const editingProvider = providers.find(
      (provider) => provider.id === editingParameterProviderProfileId,
    );
    if (
      editingProvider?.driver === "multi-protocol-relay" &&
      (editingParameterProviderProtocol === "" ||
        editingParameterProviderProtocol === "native" ||
        !providerProtocolSupportsCapability(
          editingParameterProviderProtocol,
          model.capability,
        ))
    ) {
      setError("请为多协议中转模型明确选择调用协议");
      return;
    }
    const constraints = providerParameterSchema({
      capability: model.capability,
      providerDriver: editingProvider?.driver,
      providerModelId: model.providerModelId,
    });
    const parameterSchema = constraints
      ? {
          ...editingParameterSchema,
          fields: editingParameterSchema.fields.filter((field) =>
            constraints.fields.some((allowed) => allowed.key === field.key),
          ),
        }
      : editingParameterSchema;
    const saved = await updateModel(model, {
      parameterSchema,
      providerProfileId: editingParameterProviderProfileId || model.providerProfileId,
      providerProtocol:
        editingProvider?.driver === "multi-protocol-relay"
          ? editingParameterProviderProtocol as ProviderProtocol
          : "native",
    });
    if (!saved) return;
    setEditingParameterModelId("");
    setEditingParameterSchema(undefined);
    setEditingParameterProviderProfileId("");
    setEditingParameterProviderProtocol("");
  };

  const labels: Record<AdminModel["capability"], string> = {
    audio: "音频",
    image: "图片",
    text: "文字",
    video: "视频",
  };
  const providerLabels: Record<ProviderDriver, string> = {
    mureka: "Mureka",
    "multi-protocol-relay": "多协议中转站",
    "openai-compatible": "OpenAI兼容平台",
    openrouter: "OpenRouter",
    "volcengine-ark": "火山方舟",
  };
  const capabilityOptions: Array<{
    label: string;
    value: AdminModel["capability"];
  }> = [
    { label: "文字节点", value: "text" },
    { label: "图片节点", value: "image" },
    { label: "视频节点", value: "video" },
    { label: "音频节点", value: "audio" },
  ];
  const archivedCount = models.filter((model) => model.archived).length;
  const visibleModels = models.filter((model) => showArchived || !model.archived);

  return (
    <main className="admin-page model-admin-page" data-testid="admin-models-page">
      <SettingsPageHeader
        browserTitle="模型中心"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="管理员模型中心"
        userId={currentUser.id}
      />
      <div className="model-safety-banner">
        <div>
          <strong>当前只配置用户可见模型</strong>
          <span>
            模型显示、平台连接、单次费用和生成安全开关彼此独立；
            保护条件不完整时不会提交真实生成。
          </span>
        </div>
        <button
          onClick={() => {
            window.location.href = settingsDestination(
              "/admin/providers",
              currentUser.id,
            );
          }}
          type="button"
        >
          管理平台连接
        </button>
      </div>
      <div className="admin-layout">
        <section className="admin-card">
          <h1>添加模型</h1>
          <p>
            显示名称给普通用户看；模型归属由所选商业平台连接固定，技术 Driver 与调用协议另行显示。
          </p>
          <form onSubmit={createModel}>
            <div className="model-provider-choice">
              <span>选择平台连接</span>
              {providers.length === 0 ? (
                <button
                  onClick={() => {
                    window.location.href = settingsDestination(
                      "/admin/providers",
                      currentUser.id,
                    );
                  }}
                  type="button"
                >
                  先添加平台连接
                </button>
              ) : (
                <div>
                  {providers.map((provider) => (
                    <button
                      aria-pressed={providerProfileId === provider.id}
                      data-selected={
                        providerProfileId === provider.id ? "true" : "false"
                      }
                      key={provider.id}
                      onClick={() => {
                        setProviderProfileId(provider.id);
                        setProviderProtocol(
                          provider.driver === "multi-protocol-relay"
                            ? ""
                            : "native",
                        );
                        setParameterSchema(recommendedParameterSchema(
                          capability,
                          providerModelId,
                          provider,
                        ));
                      }}
                      type="button"
                    >
                      {provider.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div
              className="admin-gray-select"
              data-open={capabilityOpen ? "true" : "false"}
              ref={capabilityMenuRef}
            >
              <button
                aria-expanded={capabilityOpen}
                aria-haspopup="listbox"
                aria-label="节点类型"
                className="admin-gray-select-trigger"
                onClick={() => setCapabilityOpen((open) => !open)}
                type="button"
              >
                <span>
                  {capabilityOptions.find(
                    (option) => option.value === capability,
                  )?.label}
                </span>
                <span aria-hidden="true" className="admin-gray-select-chevron" />
              </button>
              {capabilityOpen && (
                <div
                  aria-label="节点类型选项"
                  className="admin-gray-select-menu"
                  role="listbox"
                >
                  {capabilityOptions.map((option) => (
                    <button
                      aria-selected={option.value === capability}
                      className="admin-gray-select-option"
                      data-selected={
                        option.value === capability ? "true" : "false"
                      }
                      key={option.value}
                      onClick={() => {
                        setCapability(option.value);
                        if (
                          selectedProviderUsesRelay &&
                          providerProtocol !== "" &&
                          !providerProtocolSupportsCapability(
                            providerProtocol,
                            option.value,
                          )
                        ) {
                          setProviderProtocol("");
                        }
                        setParameterSchema(recommendedParameterSchema(
                          option.value,
                          providerModelId,
                        ));
                        setCapabilityOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      <span>{option.label}</span>
                      {option.value === capability && (
                        <span aria-hidden="true">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedProviderUsesRelay && (
              <label className="model-provider-protocol">
                <span>调用协议</span>
                <GrayMenuSelect
                  ariaLabel="调用协议"
                  onChange={(value) =>
                    setProviderProtocol(value as ProviderProtocol | "")
                  }
                  options={relayProtocolsForCapability(capability).map(
                    (protocol) => ({
                      label: providerProtocolLabels[protocol],
                      value: protocol,
                    }),
                  )}
                  placeholder="请明确选择调用协议"
                  value={providerProtocol}
                />
                <small>协议由管理员明确配置，不根据模型名称猜测。</small>
              </label>
            )}
            {selectedProvider && (
              <p className="model-provider-identity-note">
                商业平台：{selectedProvider.displayName} · 技术 Driver：
                {providerLabels[selectedProvider.driver]}
                {selectedProviderUsesRelay && providerProtocol
                  ? ` · 调用协议：${providerProtocolLabels[providerProtocol]}`
                  : ""}
              </p>
            )}
            <input
              maxLength={80}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="用户看到的模型名称"
              required
              value={displayName}
            />
            <input
              maxLength={160}
              onChange={(event) => {
                const nextModelId = event.target.value;
                setProviderModelId(nextModelId);
                const arkProvider = providers.find(
                  (provider) => provider.driver === "volcengine-ark",
                );
                if (/^doubao-(?:seed|seedance)-/i.test(nextModelId) && arkProvider) {
                  setProviderProfileId(arkProvider.id);
                  setProviderProtocol("native");
                  setParameterSchema(knownModelParameterSchema({
                    capability,
                    providerDriver: arkProvider.driver,
                    providerModelId: nextModelId,
                  }));
                }
              }}
              placeholder="内部模型编号"
              required
              value={providerModelId}
            />
            {selectedProviderMismatch && (
              <div className="model-provider-warning" role="alert">
                这个内部编号属于火山方舟，请改选火山方舟连接。
              </div>
            )}
            <div className="admin-model-parameter-preset">
              <span>参数不会直接发送平台内部字段；先使用推荐值，再按模型能力修改。</span>
              <button
                onClick={() => setParameterSchema(recommendedParameterSchema())}
                type="button"
              >
                载入推荐参数
              </button>
            </div>
            <AdminModelParameterEditor
              capability={capability}
              constraints={providerParameterSchema({
                capability,
                providerDriver: selectedProvider?.driver,
                providerModelId,
              })}
              onChange={setParameterSchema}
              providerProtocol={providerProtocol}
              schema={parameterSchema}
            />
            <label className="model-publish-check">
              <input
                className="admin-compact-checkbox"
                checked={publish}
                disabled={!providerProfileId}
                onChange={(event) => setPublish(event.target.checked)}
                type="checkbox"
              />
              <span>创建后立即发布给普通用户</span>
            </label>
            <button
              disabled={
                !providerProfileId || selectedProviderMismatch || !relayProtocolReady
              }
              type="submit"
            >
              保存模型
            </button>
          </form>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </section>
        <section className="admin-card model-list">
          <div className="model-list-heading">
            <h2>节点可用模型</h2>
            <button
              aria-pressed={showArchived}
              disabled={!showArchived && archivedCount === 0}
              onClick={() => setShowArchived((current) => !current)}
              type="button"
            >
              {showArchived ? "隐藏归档" : `显示归档（${archivedCount}）`}
            </button>
          </div>
          {modelNotice && (
            <p className="model-lifecycle-feedback" data-status="success" role="status">
              {modelNotice}
            </p>
          )}
          {modelLifecycleError && (
            <p className="model-lifecycle-feedback" data-status="error" role="alert">
              {modelLifecycleError}
            </p>
          )}
          {visibleModels.length === 0 && (
            <div className="model-list-empty" data-testid="model-list-empty">
              <strong>{models.length ? "当前没有日常管理模型" : "暂无已配置模型"}</strong>
              <span>
                {models.length
                  ? "归档模型仍保留旧画布和历史关系，可通过上方按钮查看并恢复。"
                  : "请在左侧添加真实要使用的模型。发布前，普通用户不会看到任何模型。"}
              </span>
            </div>
          )}
          {visibleModels.map((model) => (
            <article data-archived={model.archived ? "true" : "false"} key={model.id}>
              <div className="model-list-main">
                <div>
                  <span className="model-capability">
                    {labels[model.capability]}
                  </span>
                  <strong>{model.displayName}</strong>
                  {model.isDefault && <b>默认</b>}
                  {model.archived && <b className="model-archived-badge">已归档</b>}
                </div>
                <small>
                  内部编号：{model.providerModelId}
                  <br />
                  {providerLabels[model.providerDriver]}（{model.providerName}） ·{" "}
                  {model.providerConnected ? "Provider已连接" : "Provider未连接"}
                  {model.providerDriver === "multi-protocol-relay" && (
                    <>
                      <br />
                      调用协议：
                      {model.providerProtocol
                        ? providerProtocolLabels[model.providerProtocol]
                        : "未设置（不可生成）"}
                    </>
                  )}
                  <br />
                  可调参数：
                  {model.parameterSchema.fields.length
                    ? model.parameterSchema.fields.map((field) => field.label).join("、")
                    : "无"}
                  <br />
                  合同：{model.contract?.status === "published"
                    ? `已发布修订 ${model.contract.activeRevision}`
                    : model.contract?.status === "revoked"
                      ? "已停止新任务"
                      : model.contract?.status === "draft"
                        ? "草稿"
                        : "尚未建立"}
                  {model.contract?.evidence ? ` · ${model.contract.evidence}` : ""}
                  {model.archived && model.references && (
                    <>
                      <br />
                      保留关系：画布{model.references.canvasDocuments}个 · 历史任务
                      {model.references.tasks}条 · 运行中{model.references.activeTasks}条
                    </>
                  )}
                </small>
                {providerMismatch(
                  model.providerModelId,
                  providers.find((provider) => provider.id === model.providerProfileId)?.driver,
                ) && (
                  <div className="model-provider-warning" role="alert">
                    平台选择错误：这个豆包模型应连接火山方舟。
                  </div>
                )}
                {!model.archived && !model.canDelete && model.deleteBlockedReason && (
                  <div
                    className="model-delete-protection"
                    title={model.deleteBlockedReason}
                  >
                    删除保护：{model.deleteBlockedReason}
                  </div>
                )}
              </div>
              <div className="model-list-actions">
                {model.archived ? (
                  <>
                    <button
                      onClick={() => window.location.href = settingsDestination(
                        `/admin/models/${model.id}/contract`,
                        currentUser.id,
                      )}
                      type="button"
                    >
                      合同工作台
                    </button>
                    <button
                      disabled={lifecycleBusyId === model.id}
                      onClick={() =>
                        void updateModelLifecycle(model, "restore")
                      }
                      type="button"
                    >
                      {lifecycleBusyId === model.id ? "处理中…" : "恢复"}
                    </button>
                    {model.canDelete && (
                      <button
                        className="model-danger-action"
                        disabled={lifecycleBusyId === model.id}
                        onClick={() =>
                          void updateModelLifecycle(model, "delete")
                        }
                        type="button"
                      >
                        永久删除
                      </button>
                    )}
                    {!model.canDelete && model.deleteBlockedReason && (
                      <span
                        className="model-lifecycle-reason"
                        title={model.deleteBlockedReason}
                      >
                        保留原因：{model.deleteBlockedReason}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        void updateModel(model, {
                          status:
                            model.status === "published" ? "disabled" : "published",
                        })
                      }
                      type="button"
                    >
                      {model.status === "published"
                        ? `停用（${model.providerName}）`
                        : `发布到${model.providerName}`}
                    </button>
                    <button
                      disabled={
                        model.status !== "published" || model.isDefault
                      }
                      onClick={() =>
                        void updateModel(model, { isDefault: true })
                      }
                      type="button"
                    >
                      设为默认
                    </button>
                    <button
                      aria-expanded={editingParameterModelId === model.id}
                      onClick={() => {
                        if (editingParameterModelId === model.id) {
                          setEditingParameterModelId("");
                          setEditingParameterSchema(undefined);
                          setEditingParameterProviderProfileId("");
                          setEditingParameterProviderProtocol("");
                        } else {
                          setEditingParameterModelId(model.id);
                          setEditingParameterSchema(model.parameterSchema);
                          setEditingParameterProviderProfileId(model.providerProfileId);
                          setEditingParameterProviderProtocol(
                            model.providerProtocol ??
                              (model.providerDriver === "multi-protocol-relay"
                                ? ""
                                : "native"),
                          );
                        }
                      }}
                      type="button"
                    >
                      {editingParameterModelId === model.id ? "收起参数" : "参数设置"}
                    </button>
                    <button
                      disabled={
                        lifecycleBusyId === model.id ||
                        model.status === "published" ||
                        model.isDefault
                      }
                      onClick={() =>
                        void updateModelLifecycle(model, "archive")
                      }
                      title={
                        model.isDefault
                          ? "请先明确设置另一个默认模型"
                          : model.status === "published"
                            ? "请先停用模型再归档"
                            : "归档后从日常列表隐藏，但保留旧画布和历史关系"
                      }
                      type="button"
                    >
                      {lifecycleBusyId === model.id ? "处理中…" : "归档"}
                    </button>
                  </>
                )}
              </div>
              {!model.archived && editingParameterModelId === model.id && editingParameterSchema && (
                <div className="admin-model-parameter-edit">
                  <div className="admin-model-provider-edit">
                    <strong>商业平台（创建后锁定）</strong>
                    <span>历史模型不能跨平台重绑；如需迁移，请创建独立模型。</span>
                    <div>
                      <strong>{model.providerName}</strong>
                      <span>技术 Driver：{providerLabels[model.providerDriver]}</span>
                    </div>
                    {providers.find(
                      (provider) =>
                        provider.id === editingParameterProviderProfileId,
                    )?.driver === "multi-protocol-relay" && (
                      <label className="model-provider-protocol">
                        <span>调用协议</span>
                        <GrayMenuSelect
                          ariaLabel={`${model.displayName}调用协议`}
                          onChange={(value) =>
                            setEditingParameterProviderProtocol(
                              value as ProviderProtocol | "",
                            )
                          }
                          options={relayProtocolsForCapability(
                            model.capability,
                          ).map((protocol) => ({
                            label: providerProtocolLabels[protocol],
                            value: protocol,
                          }))}
                          placeholder="请明确选择调用协议"
                          value={editingParameterProviderProtocol}
                        />
                        <small>不根据模型名称自动判断协议。</small>
                      </label>
                    )}
                  </div>
                  <AdminModelParameterEditor
                    capability={model.capability}
                    constraints={providerParameterSchema({
                      capability: model.capability,
                      providerDriver: providers.find(
                        (provider) => provider.id === editingParameterProviderProfileId,
                      )?.driver,
                      providerModelId: model.providerModelId,
                    })}
                    onChange={setEditingParameterSchema}
                    providerProtocol={editingParameterProviderProtocol}
                    schema={editingParameterSchema}
                  />
                  <div className="admin-model-parameter-save">
                    <button
                      disabled={
                        providers.find(
                          (provider) =>
                            provider.id === editingParameterProviderProfileId,
                        )?.driver === "multi-protocol-relay" &&
                        (editingParameterProviderProtocol === "" ||
                          editingParameterProviderProtocol === "native" ||
                          !providerProtocolSupportsCapability(
                            editingParameterProviderProtocol,
                            model.capability,
                          ))
                      }
                      onClick={() => void saveModelParameters(model)}
                      type="button"
                    >
                      保存参数设置
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function formatStorageBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) {
    return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  }
  return `${(bytes / 1_024 ** 3).toFixed(2)} GB`;
}

function AdminStorage({ currentUser }: { currentUser: AuthUser }) {
  const [status, setStatus] = useState<AdminStorageStatus>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState("");
  const [label, setLabel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [testFeedback, setTestFeedback] = useState<
    Record<string, StorageTestFeedback>
  >({});

  const load = (signal?: AbortSignal) =>
    jsonRequest<AdminStorageStatus>("/api/admin/storage", {
      signal,
    })
      .then(setStatus)
      .catch((caught) => {
        if (!signal?.aborted) {
          setError(
            caught instanceof Error ? caught.message : "存储状态读取失败",
          );
        }
      });

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const resetForm = () => {
    setEditingId("");
    setLabel("");
    setEndpoint("");
    setRegion("");
    setBucket("");
    setAccessKeyId("");
    setAccessKeySecret("");
  };

  const submitProfile = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        editingId
          ? `/api/admin/storage/profiles/${encodeURIComponent(editingId)}`
          : "/api/admin/storage/profiles",
        {
          body: JSON.stringify({
            accessKeyId,
            accessKeySecret,
            bucket,
            endpoint,
            label,
            region,
          }),
          method: editingId ? "PATCH" : "POST",
        },
      );
      resetForm();
      setNotice("配置已加密保存，尚未连接或上传。");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置保存失败");
    } finally {
      setBusy("");
    }
  };

  const editProfile = (profile: AdminStorageProfile) => {
    setEditingId(profile.id);
    setLabel(profile.label);
    setEndpoint(profile.endpoint);
    setRegion(profile.region);
    setBucket(profile.bucket);
    setAccessKeyId("");
    setAccessKeySecret("");
    setError("");
    setNotice("AK和SK留空会保留原值，不会回显。");
  };

  const testProfile = async (profile: AdminStorageProfile) => {
    if (
      !window.confirm(
        `测试“${profile.label}”会在OSS上传、读取并删除一个很小的临时文件，是否继续？`,
      )
    ) {
      return;
    }
    setBusy(`test:${profile.id}`);
    setError("");
    setNotice("");
    setTestFeedback((current) => {
      const next = { ...current };
      delete next[profile.id];
      return next;
    });
    try {
      const result = await jsonRequest<{
        test: {
          cleanupVerified: boolean;
          elapsedMs: number;
          signedReadVerified: boolean;
        };
      }>(
        `/api/admin/storage/profiles/${encodeURIComponent(profile.id)}/test`,
        { method: "POST" },
      );
      setTestFeedback((current) => ({
        ...current,
        [profile.id]: {
          message: `连接、短时读取和临时清理均成功（${result.test.elapsedMs}ms）。`,
          status: "success",
        },
      }));
      void load();
    } catch (caught) {
      setTestFeedback((current) => ({
        ...current,
        [profile.id]: {
          message:
            caught instanceof Error ? caught.message : "OSS连接测试失败",
          status: "error",
        },
      }));
    } finally {
      setBusy("");
    }
  };

  const activateProfile = async (profile: AdminStorageProfile) => {
    setBusy(`activate:${profile.id}`);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        `/api/admin/storage/profiles/${encodeURIComponent(profile.id)}/activate`,
        { method: "POST" },
      );
      setNotice("已选为正式配置；云端素材路由仍保持关闭，等待下一步验收。");
      void load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "正式配置切换失败",
      );
    } finally {
      setBusy("");
    }
  };

  const setMediaRouting = async (enabled: boolean) => {
    if (
      enabled &&
      !window.confirm(
        "开启后，新上传的图片、视频和音频会进入正式OSS；现有素材不会自动迁移。是否继续？",
      )
    ) {
      return;
    }
    setBusy("routing");
    setError("");
    setNotice("");
    try {
      await jsonRequest("/api/admin/storage/media-routing", {
        body: JSON.stringify({ enabled }),
        method: "POST",
      });
      setNotice(
        enabled
          ? "新素材OSS路由已开启；旧素材保持原位且不会自动迁移。"
          : "新素材OSS路由已关闭；已有云端素材仍可正常读取和删除。",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "素材路由切换失败",
      );
    } finally {
      setBusy("");
    }
  };

  const removeProfile = async (profile: AdminStorageProfile) => {
    if (!window.confirm(`删除“${profile.label}”的加密配置？`)) return;
    setBusy(`delete:${profile.id}`);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        `/api/admin/storage/profiles/${encodeURIComponent(profile.id)}`,
        { method: "DELETE" },
      );
      if (editingId === profile.id) resetForm();
      setNotice("配置已删除。");
      void load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置删除失败");
    } finally {
      setBusy("");
    }
  };

  const statusLabel = (profile: AdminStorageProfile) => {
    if (profile.status === "active") return "正式配置";
    if (profile.status === "verified") return "测试通过";
    return "待测试";
  };

  return (
    <main
      className="admin-page storage-admin-page"
      data-testid="admin-storage-page"
    >
      <SettingsPageHeader
        browserTitle="存储中心"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="管理员存储中心"
        userId={currentUser.id}
      />
      <div
        className="storage-safety-banner"
        data-cloud-enabled={status?.oss.mediaRoutingEnabled ?? false}
      >
        <div>
          <strong>
            {status?.oss.mediaRoutingEnabled
              ? "新素材已启用阿里云 OSS"
              : "当前仍使用本机存储"}
          </strong>
          <span>
            {status?.oss.mediaRoutingEnabled
              ? "只影响之后新上传的图片、视频和音频；现有素材不自动迁移。"
              : "网页保存只写入服务端加密文件，不会自动连接或上传。"}
          </span>
        </div>
        <b>
          {status?.oss.mediaRoutingEnabled ? "新素材云路由开启" : "云请求关闭"}
        </b>
      </div>
      {error && <p className="auth-error storage-admin-error">{error}</p>}
      {notice && <p className="storage-admin-notice">{notice}</p>}
      {status?.warning && (
        <p
          className="storage-admin-warning"
          data-testid="storage-warning"
          role="status"
        >
          {status.warning}
        </p>
      )}
      {!status && !error && (
        <div className="storage-admin-loading">正在读取存储状态…</div>
      )}
      {status && (
        <div className="storage-admin-grid">
          <section className="admin-card storage-summary-card">
            <div className="storage-card-heading">
              <div>
                <span>当前使用</span>
                <h1>本机私有存储</h1>
              </div>
              <b className="storage-status-ready">运行中</b>
            </div>
            <div className="storage-stat-grid">
              <div>
                <strong>{status.local.objects}</strong>
                <span>现有素材</span>
              </div>
              <div>
                <strong>{formatStorageBytes(status.local.bytes)}</strong>
                <span>占用空间</span>
              </div>
              <div>
                <strong>{status.local.checksummed}</strong>
                <span>带完整校验</span>
              </div>
            </div>
            <p>
              图片、视频和音频仍由服务器鉴权后读取，普通用户不能查看其他账号的素材。
            </p>
            <div
              className="storage-route-control"
              data-enabled={status.oss.mediaRoutingEnabled}
            >
              <div>
                <strong>新素材云端路由</strong>
                <span>
                  {status.oss.activeProfileId
                    ? status.oss.mediaRoutingEnabled
                      ? "已开启：新素材保存到正式OSS，旧素材保持原位。"
                      : "已准备：开关默认关闭，开启后只处理新上传素材。"
                    : "请先测试OSS并选为正式配置。"}
                </span>
              </div>
              <button
                data-testid="storage-media-routing-toggle"
                disabled={!status.oss.activeProfileId || busy === "routing"}
                onClick={() =>
                  void setMediaRouting(!status.oss.mediaRoutingEnabled)
                }
                type="button"
              >
                {busy === "routing"
                  ? "切换中…"
                  : status.oss.mediaRoutingEnabled
                    ? "关闭"
                    : "开启"}
              </button>
            </div>
          </section>
          <section className="admin-card storage-oss-card">
            <div className="storage-card-heading">
              <div>
                <span>安全配置</span>
                <h2>{editingId ? "修改阿里云 OSS" : "添加阿里云 OSS"}</h2>
              </div>
              <b className="storage-status-paused">加密保存</b>
            </div>
            <p>
              AK和SK使用密码输入，保存后不会再次回显，也不会写入普通数据库或本项目的浏览器存储。
            </p>
            <form
              autoComplete="off"
              className="storage-profile-form"
              onSubmit={submitProfile}
            >
              <input
                maxLength={40}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="配置名称，例如：生产OSS"
                required
                value={label}
              />
              <input
                maxLength={240}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                required
                type="url"
                value={endpoint}
              />
              <div>
                <input
                  maxLength={80}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder="区域，例如 oss-cn-hangzhou"
                  required
                  value={region}
                />
                <input
                  maxLength={80}
                  onChange={(event) => setBucket(event.target.value)}
                  placeholder="Bucket名称"
                  required
                  value={bucket}
                />
              </div>
              <input
                autoComplete="new-password"
                maxLength={160}
                onChange={(event) => setAccessKeyId(event.target.value)}
                placeholder={
                  editingId ? "AK留空则保留原值" : "AccessKey ID"
                }
                required={!editingId}
                spellCheck={false}
                type="password"
                value={accessKeyId}
              />
              <input
                autoComplete="new-password"
                maxLength={320}
                onChange={(event) => setAccessKeySecret(event.target.value)}
                placeholder={
                  editingId ? "SK留空则保留原值" : "AccessKey Secret"
                }
                required={!editingId}
                spellCheck={false}
                type="password"
                value={accessKeySecret}
              />
              <div className="storage-profile-form-actions">
                <button disabled={busy === "save"} type="submit">
                  {busy === "save" ? "正在保存…" : "加密保存"}
                </button>
                {editingId && (
                  <button onClick={resetForm} type="button">
                    取消修改
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      )}
      {status && (
        <section className="admin-card storage-profile-list">
          <div className="storage-profile-list-heading">
            <div>
              <span>已保存配置</span>
              <h2>阿里云 OSS 配置</h2>
            </div>
            <b>{status.oss.profiles.length} 个</b>
          </div>
          {status.oss.profiles.length === 0 ? (
            <div className="storage-profile-empty">
              暂无配置。上方填写后只会加密保存，不会自动发起云请求。
            </div>
          ) : (
            <div className="storage-profile-cards">
              {status.oss.profiles.map((profile) => (
                <article key={profile.id}>
                  <div className="storage-profile-card-main">
                    <div>
                      <strong>{profile.label}</strong>
                      <b data-status={profile.status}>
                        {statusLabel(profile)}
                      </b>
                    </div>
                    <span>
                      {profile.bucket} · {profile.region}
                    </span>
                    <small>{profile.endpoint}</small>
                    <small>
                      AK {profile.accessKeyIdMask} · SK{" "}
                      {profile.hasAccessKeySecret ? "已保存" : "未保存"}
                    </small>
                  </div>
                  <div className="storage-profile-card-actions">
                    <button
                      disabled={profile.status === "active" || Boolean(busy)}
                      onClick={() => editProfile(profile)}
                      type="button"
                    >
                      修改
                    </button>
                    <button
                      disabled={Boolean(busy)}
                      onClick={() => void testProfile(profile)}
                      type="button"
                    >
                      {busy === `test:${profile.id}`
                        ? "测试中…"
                        : profile.status === "active"
                          ? "重新测试（保持正式）"
                          : "测试连接"}
                    </button>
                    <button
                      disabled={
                        profile.status !== "verified" || Boolean(busy)
                      }
                      onClick={() => void activateProfile(profile)}
                      type="button"
                    >
                      选为正式配置
                    </button>
                    <button
                      disabled={profile.status === "active" || Boolean(busy)}
                      onClick={() => void removeProfile(profile)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                  {testFeedback[profile.id] && (
                    <p
                      className="storage-profile-test-feedback"
                      data-status={testFeedback[profile.id].status}
                      role="status"
                    >
                      {testFeedback[profile.id].message}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
          <div className="storage-cloud-stop">
            <strong>现有素材永远不会因为这个开关自动迁移</strong>
            <span>
              当前本机的 {status.local.objects} 个素材仍保留原位；开启路由后仅有新上传素材进入OSS，不会自动迁移旧素材。
            </span>
          </div>
        </section>
      )}
    </main>
  );
}

function AdminGenerationSafety({
  currentUser,
}: {
  currentUser: AuthUser;
}) {
  const [status, setStatus] = useState<AdminGenerationSafetyStatus>();
  const [draft, setDraft] = useState<GenerationSafetySettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = (signal?: AbortSignal) =>
    jsonRequest<AdminGenerationSafetyStatus>(
      "/api/admin/generation-safety",
      { signal },
    )
      .then((result) => {
        setStatus(result);
        setDraft(result.settings);
      })
      .catch((caught) => {
        if (!signal?.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "生成安全设置读取失败",
          );
        }
      });

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const save = async (
    next: GenerationSafetySettings,
    message: string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await jsonRequest<AdminGenerationSafetyStatus>(
        "/api/admin/generation-safety",
        {
          body: JSON.stringify(next),
          method: "PUT",
        },
      );
      setStatus(result);
      setDraft(result.settings);
      setNotice(message);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "生成安全设置保存失败",
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (draft) void save(draft, "安全限制已保存。");
  };

  const setNumber = (
    key:
      | "audioConcurrency"
      | "cooldownMinutes"
      | "failureThreshold"
      | "imageConcurrency"
      | "perUserConcurrency"
      | "requestsPerMinute"
      | "textConcurrency"
      | "videoConcurrency",
    value: string,
  ) => {
    const number = Number(value);
    setDraft((current) =>
      current ? { ...current, [key]: number } : current,
    );
  };

  return (
    <main
      className="admin-page generation-safety-page"
      data-testid="admin-generation-safety-page"
    >
      <SettingsPageHeader
        browserTitle="生成安全"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="管理员生成安全中心"
        userId={currentUser.id}
      />
      <div
        className="generation-safety-banner"
        data-stopped={
          !draft?.globalEnabled || draft?.emergencyStop ? "true" : "false"
        }
      >
        <div>
          <strong>
            {draft?.emergencyStop
              ? "紧急停止已生效"
              : draft?.globalEnabled
                ? "后台保护已启用"
                : "真实生成总开关关闭"}
          </strong>
          <span>
            {status?.providerConfigured
              ? `Provider已连接，迁移后精确请求${status.paidProviderRequests}次${
                  status.historicalEstimatedProviderAttempts
                    ? `；历史估算${status.historicalEstimatedProviderAttempts}次`
                    : ""
                }。`
              : "Provider尚未接入，所有真实生成仍保持禁用。"}
          </span>
        </div>
        <b>{status?.providerConfigured ? "Provider已连接" : "Provider未连接"}</b>
      </div>
      {error && <p className="auth-error safety-page-message" role="alert">{error}</p>}
      {notice && <p className="storage-admin-notice safety-page-message">{notice}</p>}
      {draft && (
        <>
          <div className="generation-safety-grid">
            <section className="admin-card safety-switch-card">
              <div>
                <span>总控制</span>
                <h1>真实生成总开关</h1>
                <p>
                  开启后仍须同时满足单次、每日、每月及并发保护。
                </p>
              </div>
              <button
                data-enabled={draft.globalEnabled ? "true" : "false"}
                data-testid="generation-global-toggle"
                disabled={busy}
                onClick={() =>
                  void save(
                    { ...draft, globalEnabled: !draft.globalEnabled },
                    draft.globalEnabled
                      ? "真实生成总开关已关闭。"
                      : status?.providerConfigured
                        ? "后台总开关已开启；所有费用和并发保护继续生效。"
                        : "后台总开关已开启；Provider未连接，真实生成继续禁用。",
                  )
                }
                type="button"
              >
                {draft.globalEnabled ? "关闭总开关" : "开启总开关"}
              </button>
            </section>
            <section className="admin-card safety-switch-card emergency-card">
              <div>
                <span>最高优先级</span>
                <h2>紧急停止</h2>
                <p>
                  立即拒绝所有新任务；已运行任务按下方选择等待或取消。
                </p>
              </div>
              <button
                data-enabled={draft.emergencyStop ? "true" : "false"}
                data-testid="generation-emergency-toggle"
                disabled={busy}
                onClick={() => {
                  if (
                    draft.emergencyStop &&
                    !window.confirm("解除紧急停止？其他费用和并发保护仍会继续生效。")
                  ) {
                    return;
                  }
                  void save(
                    { ...draft, emergencyStop: !draft.emergencyStop },
                    draft.emergencyStop
                      ? "紧急停止已解除；其他限制仍然有效。"
                      : "紧急停止已生效，新任务会在调用Provider前被拒绝。",
                  );
                }}
                type="button"
              >
                {draft.emergencyStop ? "解除紧急停止" : "立即停止"}
              </button>
            </section>
          </div>
          <form className="generation-safety-form" onSubmit={submit}>
            <section className="admin-card">
              <div className="safety-section-heading">
                <div>
                  <span>防止任务堆积</span>
                  <h2>并发与频率</h2>
                </div>
                <b>服务端强制</b>
              </div>
              <div className="safety-field-grid">
                <label>
                  <span>单个用户同时运行</span>
                  <input
                    max={1000}
                    min={1}
                    onChange={(event) =>
                      setNumber("perUserConcurrency", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.perUserConcurrency}
                  />
                </label>
                <label>
                  <span>每分钟最多请求</span>
                  <input
                    max={1000}
                    min={1}
                    onChange={(event) =>
                      setNumber("requestsPerMinute", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.requestsPerMinute}
                  />
                </label>
                <label>
                  <span>文字同时运行</span>
                  <input
                    max={1000}
                    min={1}
                    onChange={(event) =>
                      setNumber("textConcurrency", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.textConcurrency}
                  />
                </label>
                <label>
                  <span>图片同时运行</span>
                  <input
                    max={1000}
                    min={1}
                    onChange={(event) =>
                      setNumber("imageConcurrency", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.imageConcurrency}
                  />
                </label>
                <label>
                  <span>视频同时运行</span>
                  <input
                    max={1000}
                    min={1}
                    onChange={(event) =>
                      setNumber("videoConcurrency", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.videoConcurrency}
                  />
                </label>
                <label>
                  <span>音频同时运行</span>
                  <input
                    max={1000}
                    min={1}
                    onChange={(event) =>
                      setNumber("audioConcurrency", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.audioConcurrency}
                  />
                </label>
              </div>
            </section>
            <section className="admin-card">
              <div className="safety-section-heading">
                <div>
                  <span>模型服务异常保护</span>
                  <h2>连续失败熔断</h2>
                </div>
                <b>自动暂停</b>
              </div>
              <div className="safety-field-grid">
                <label>
                  <span>连续失败次数</span>
                  <input
                    max={20}
                    min={1}
                    onChange={(event) =>
                      setNumber("failureThreshold", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.failureThreshold}
                  />
                </label>
                <label>
                  <span>暂停时间（分钟）</span>
                  <input
                    max={1_440}
                    min={1}
                    onChange={(event) =>
                      setNumber("cooldownMinutes", event.target.value)
                    }
                    required
                    type="number"
                    value={draft.cooldownMinutes}
                  />
                </label>
              </div>
            </section>
            <section className="admin-card">
              <div className="safety-section-heading">
                <div>
                  <span>点击紧急停止后</span>
                  <h2>已运行任务处理</h2>
                </div>
              </div>
              <div
                className="safety-policy-options"
                data-testid="running-task-policy"
              >
                <button
                  aria-pressed={draft.runningTaskPolicy === "wait"}
                  onClick={() =>
                    setDraft({ ...draft, runningTaskPolicy: "wait" })
                  }
                  type="button"
                >
                  <strong>等待完成</strong>
                  <span>不重复提交，也不强制中断正在运行的任务</span>
                </button>
                <button
                  aria-pressed={draft.runningTaskPolicy === "cancel"}
                  onClick={() =>
                    setDraft({ ...draft, runningTaskPolicy: "cancel" })
                  }
                  type="button"
                >
                  <strong>安全取消</strong>
                  <span>Provider支持取消时才执行，不伪造取消成功</span>
                </button>
              </div>
            </section>
            <button
              className="generation-safety-save"
              disabled={busy}
              type="submit"
            >
              {busy ? "正在保存…" : "保存全部安全限制"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}

const apiOperationDetails: Record<string, { detail: string; label: string }> = {
  listCharacters: {
    label: "读取AI角色目录",
    detail: "按分类、筛选条件和页码读取项目自己的角色卡片。",
  },
  listLibraryAssets: {
    label: "读取素材目录",
    detail: "读取个人或团队空间的文件夹、素材页码和素材总数。",
  },
  readAgentConfiguration: {
    label: "读取Agent界面配置",
    detail: "读取模型、技能和建议选项；真实Agent执行继续关闭。",
  },
  listPublishedModels: {
    label: "读取模型配置",
    detail: "只返回已发布模型和用户可调参数，不返回平台密钥。",
  },
  listTemplates: {
    label: "读取模板目录",
    detail: "按分类、搜索词和页码读取模板；需要时返回画布节点与连线数据。",
  },
  createUserTemplate: {
    label: "保存我的模板",
    detail: "把当前账号的工作流模板写入私有模板库，仅本人可见。",
  },
  deleteUserTemplate: {
    label: "删除我的模板",
    detail: "删除当前账号自己的模板，其他账号不可删除或查看。",
  },
  readAccountContext: {
    label: "读取账号与权限",
    detail: "读取当前账号、个人项目空间和权限，不提供额度或积分接口。",
  },
  readCanvas: {
    label: "读取画布",
    detail: "读取当前账号的节点、连线、视口和修订版本。",
  },
  readProjectTitle: {
    label: "读取项目名称",
    detail: "读取当前账号的项目名称和更新时间。",
  },
  saveCanvas: {
    label: "保存画布",
    detail: "保存节点、连线和视口，并检查修订冲突。",
  },
  saveProjectTitle: {
    label: "保存项目名称",
    detail: "保存当前账号的项目名称和更新时间。",
  },
  downloadGroupResults: {
    label: "下载组结果",
    detail: "把组内成功生成的结果打包为 ZIP，文字结果保存为 txt。",
  },
  listAccountCredentials: {
    label: "读取我的平台密钥",
    detail: "只返回当前账号在各平台的密钥状态与掩码。",
  },
  saveAccountCredential: {
    label: "保存我的平台密钥",
    detail: "把当前账号自己的平台密钥加密保存，仅本人可见。",
  },
  deleteAccountCredential: {
    label: "删除我的平台密钥",
    detail: "删除当前账号在某平台的密钥，不影响其他账号。",
  },
  verifyAccountCredential: {
    label: "校验我的平台密钥",
    detail: "对当前账号的密钥做只读校验，不产生生成费用。",
  },
};

function AdminApiContract({ currentUser }: { currentUser: AuthUser }) {
  const [contract, setContract] = useState<ApiContractDocument>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    jsonRequest<ApiContractDocument>("/api/openapi.json", {
      signal: controller.signal,
    })
      .then(setContract)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "接口说明读取失败");
        }
      });
    return () => controller.abort();
  }, []);

  const operations = contract
    ? Object.entries(contract.paths).flatMap(([path, pathItem]) =>
        Object.entries(pathItem).map(([method, operation]) => ({
          ...operation,
          method: method.toUpperCase(),
          path,
        })),
      )
    : [];

  return (
    <main className="admin-page" data-testid="admin-api-contract-page">
      <SettingsPageHeader
        browserTitle="接口说明"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="自有接口说明"
        userId={currentUser.id}
      />
      <div className="api-contract-layout">
        <section className="admin-card api-contract-summary">
          <div>
            <span>自有API</span>
            <b>{contract ? `OpenAPI ${contract.openapi}` : "正在读取…"}</b>
          </div>
          <h1>项目自己的数据接口</h1>
          <p>
            画布、项目名称、安全模型配置及账号权限均使用本项目实现的接口，受登录状态和账号数据隔离保护。
          </p>
          <ul>
            <li>不会连接或复用 Unboundry 上游私有接口</li>
            <li>本页只读取说明，不调用任何收费模型服务</li>
            <li>模型密钥、存储密钥和密码不会出现在说明中</li>
          </ul>
        </section>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {contract && (
          <section className="admin-card api-contract-list">
            <div className="api-contract-heading">
              <div>
                <span>版本 {contract.info.version}</span>
                <h2>当前共 {Object.keys(contract.paths).length} 条接口路径</h2>
              </div>
              <b>仅登录后可用</b>
            </div>
            <div className="api-contract-grid">
              {operations.map((operation) => {
                const copy = apiOperationDetails[operation.operationId];
                return (
                  <article key={`${operation.method}-${operation.path}`}>
                    <div>
                      <b>{operation.method}</b>
                      <code>{operation.path}</code>
                    </div>
                    <strong>{copy?.label || operation.summary}</strong>
                    <p>{copy?.detail || operation.summary}</p>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

type AccountCredentialItem = {
  apiKeyMask?: string;
  baseUrl: string;
  credentialVersion: number;
  driver: string;
  keyCheckedAt?: string;
  keyStatus: "invalid" | "unchecked" | "unknown" | "valid";
  label: string;
  profileId: string;
  updatedAt?: string;
};

function accountCredentialStatusLabel(status: AccountCredentialItem["keyStatus"]) {
  if (status === "valid") return "有效";
  if (status === "invalid") return "无效";
  if (status === "unknown") return "未知";
  return "未检查";
}

type AdminPublicTemplateStatus = "draft" | "published" | "archived";
type AdminPublicTemplateCompatibilityStatus = "INVALID" | "NEEDS_MODEL" | "PASS";

type AdminPublicTemplate = {
  categories: string[];
  compatibility: {
    issues: Array<{ message: string; nodeTitle?: string }>;
    status: AdminPublicTemplateCompatibilityStatus;
  };
  createdAt: string;
  description: string;
  graph?: Record<string, unknown>;
  id: string;
  previewImage?: string;
  status: AdminPublicTemplateStatus;
  title: string;
  updatedAt: string;
};

function publicTemplateStatusLabel(status: AdminPublicTemplateStatus) {
  if (status === "published") return "已发布";
  if (status === "draft") return "草稿";
  return "已归档";
}

function publicTemplateCompatibilityLabel(
  status: AdminPublicTemplateCompatibilityStatus,
) {
  if (status === "PASS") return "兼容检查通过";
  if (status === "NEEDS_MODEL") return "需要绑定模型";
  return "模板无效";
}

function AdminTemplatesPage({ currentUser }: { currentUser: AuthUser }) {
  const [templates, setTemplates] = useState<AdminPublicTemplate[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminPublicTemplate>();
  const [archiving, setArchiving] = useState<AdminPublicTemplate>();
  const [draft, setDraft] = useState({
    baseTemplateId: "",
    categories: [] as string[],
    description: "",
    graphJson: "",
    previewImage: "",
    status: "draft" as AdminPublicTemplateStatus,
    title: "",
  });
  const [modalError, setModalError] = useState("");
  const templateModalRef = useRef<HTMLElement | null>(null);
  const templateModalReturnFocusRef = useRef<HTMLElement | null>(null);

  const closeTemplateModal = () => setCreating(false);

  useEffect(() => {
    if (!creating) return;
    const returnFocus = templateModalReturnFocusRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      templateModalRef.current
        ?.querySelector<HTMLElement>("[data-autofocus='true']")
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (returnFocus?.isConnected) {
        window.requestAnimationFrame(() => returnFocus.focus());
      }
    };
  }, [creating]);

  const handleTemplateModalKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (event.key === "Escape") {
      if (
        templateModalRef.current?.querySelector(
          ".gray-menu-select[data-open='true']",
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeTemplateModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(templateModalRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const load = async () => {
    setError("");
    try {
      const body = await jsonRequest<{ items: AdminPublicTemplate[] }>(
        "/api/admin/templates?limit=100&offset=0&includeGraph=false",
      );
      setTemplates(body.items);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "公共模板列表读取失败",
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const changeStatus = async (
    template: AdminPublicTemplate,
    status: AdminPublicTemplateStatus,
  ) => {
    setBusyId(template.id);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        `/api/admin/templates/${encodeURIComponent(template.id)}`,
        {
          body: JSON.stringify({ status }),
          method: "PATCH",
        },
      );
      setNotice(`「${template.title}」已${publicTemplateStatusLabel(status)}`);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "模板状态修改失败",
      );
    } finally {
      setBusyId("");
    }
  };

  const archive = async (template: AdminPublicTemplate) => {
    setBusyId(template.id);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        `/api/admin/templates/${encodeURIComponent(template.id)}`,
        { method: "DELETE" },
      );
      setArchiving(undefined);
      setNotice(`「${template.title}」已归档，普通账号不可见`);
      await load();
    } catch (caught) {
      setArchiving(undefined);
      setError(
        caught instanceof Error ? caught.message : "模板归档失败",
      );
    } finally {
      setBusyId("");
    }
  };

  const openCreate = () => {
    templateModalReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setEditing(undefined);
    setModalError("");
    setDraft({
      baseTemplateId: "",
      categories: [],
      description: "",
      graphJson: "",
      previewImage: "",
      status: "draft",
      title: "",
    });
    setCreating(true);
  };

  const graphJsonFor = async (templateId: string) => {
    const body = await jsonRequest<{ items: AdminPublicTemplate[] }>(
      "/api/admin/templates?limit=100&offset=0&includeGraph=true",
    );
    const full = body.items.find((item) => item.id === templateId);
    return full?.graph ? JSON.stringify(full.graph, null, 2) : "";
  };

  const openEdit = async (template: AdminPublicTemplate) => {
    templateModalReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setEditing(template);
    setModalError("");
    setDraft({
      baseTemplateId: "",
      categories: template.categories,
      description: template.description ?? "",
      graphJson: "",
      previewImage: template.previewImage ?? "",
      status: template.status,
      title: template.title,
    });
    setCreating(true);
    try {
      const graphJson = await graphJsonFor(template.id);
      setDraft((current) => ({ ...current, graphJson }));
    } catch {
      setModalError("模板图读取失败，可直接在编辑时重新填写");
    }
  };

  const pickBaseTemplate = async (templateId: string) => {
    setDraft((current) => ({ ...current, baseTemplateId: templateId }));
    if (!templateId) return;
    try {
      const graphJson = await graphJsonFor(templateId);
      setDraft((current) => ({
        ...current,
        baseTemplateId: templateId,
        graphJson,
        title: current.title || templates.find((item) => item.id === templateId)?.title || "",
      }));
    } catch {
      setModalError("模板图读取失败，请手动粘贴 JSON");
    }
  };

  const submit = async () => {
    setModalError("");
    let graph: unknown;
    if (draft.graphJson.trim()) {
      try {
        graph = JSON.parse(draft.graphJson) as unknown;
      } catch {
        setModalError("模板图 JSON 无法解析");
        return;
      }
    }
    const payload = {
      category: draft.categories,
      description: draft.description.trim() || undefined,
      graph,
      previewImage: draft.previewImage.trim() || undefined,
      status: draft.status,
      title: draft.title,
    };
    try {
      if (editing) {
        await jsonRequest(
          `/api/admin/templates/${encodeURIComponent(editing.id)}`,
          {
            body: JSON.stringify(payload),
            method: "PATCH",
          },
        );
        setNotice(`「${draft.title}」已更新`);
      } else {
        if (graph === undefined) {
          setModalError("请填写模板图 JSON，或先选择「基于现有模板」");
          return;
        }
        await jsonRequest("/api/admin/templates", {
          body: JSON.stringify(payload),
          method: "POST",
        });
        setNotice(`「${draft.title}」已创建`);
      }
      closeTemplateModal();
      await load();
    } catch (caught) {
      setModalError(
        caught instanceof Error ? caught.message : "模板保存失败",
      );
    }
  };

  return (
    <main
      className="admin-page admin-templates-page"
      data-testid="admin-templates-page"
    >
      <SettingsPageHeader
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="公共模板管理"
        userId={currentUser.id}
      />
      {notice && (
        <p className="storage-admin-notice provider-page-message">{notice}</p>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <section className="admin-card admin-templates-section">
        <div className="api-contract-heading">
          <div>
            <span>公共模板</span>
            <h1>仅管理员可新增/编辑/上下架；普通账号只能浏览与导入</h1>
          </div>
          <button onClick={openCreate} type="button">
            新建公共模板
          </button>
        </div>
        <div
          className="admin-templates-grid"
          data-testid="admin-templates-list"
        >
          {templates.length === 0 ? (
            <p className="model-list-empty">暂无公共模板</p>
          ) : (
            templates.map((template) => (
              <article
                className="admin-template-card"
                data-testid={`admin-template-${template.id}`}
                key={template.id}
              >
                <div className="admin-template-art">
                  {template.previewImage ? (
                    <img alt="" src={template.previewImage} />
                  ) : (
                    <span />
                  )}
                </div>
                <div className="admin-template-info">
                  <strong>{template.title}</strong>
                  <span>
                    {template.categories.length
                      ? template.categories.join(" / ")
                      : "未分类"}
                  </span>
                  <small>
                    更新于{" "}
                    {new Date(template.updatedAt).toLocaleString("zh-CN")}
                  </small>
                  <small
                    className="admin-template-compatibility-detail"
                    title={template.compatibility.issues[0]?.message}
                  >
                    {template.compatibility.issues[0]?.nodeTitle
                      ? `${template.compatibility.issues[0].nodeTitle}：`
                      : ""}
                    {template.compatibility.issues[0]?.message}
                  </small>
                </div>
                <b
                  className="admin-template-status"
                  data-status={template.status}
                >
                  {publicTemplateStatusLabel(template.status)}
                </b>
                <b
                  className="admin-template-compatibility"
                  data-compatibility={template.compatibility.status}
                >
                  {publicTemplateCompatibilityLabel(template.compatibility.status)}
                </b>
                <div className="admin-template-actions">
                  {template.status === "draft" && (
                    <button
                      disabled={
                        busyId === template.id ||
                        template.compatibility.status !== "PASS"
                      }
                      onClick={() => void changeStatus(template, "published")}
                      title={template.compatibility.issues[0]?.message}
                      type="button"
                    >
                      发布
                    </button>
                  )}
                  {template.status === "published" && (
                    <button
                      disabled={busyId === template.id}
                      onClick={() => void changeStatus(template, "draft")}
                      type="button"
                    >
                      下架
                    </button>
                  )}
                  {template.status === "archived" ? (
                    <button
                      disabled={
                        busyId === template.id ||
                        template.compatibility.status !== "PASS"
                      }
                      onClick={() => void changeStatus(template, "published")}
                      title={template.compatibility.issues[0]?.message}
                      type="button"
                    >
                      恢复
                    </button>
                  ) : (
                    <button
                      className="admin-template-danger"
                      disabled={busyId === template.id}
                      onClick={() => setArchiving(template)}
                      type="button"
                    >
                      归档
                    </button>
                  )}
                  <button
                    disabled={busyId === template.id}
                    onClick={() => void openEdit(template)}
                    type="button"
                  >
                    编辑
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      {creating && (
        <div
          className="admin-template-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget !== event.target) return;
            closeTemplateModal();
          }}
        >
          <section
            aria-labelledby="admin-template-modal-title"
            aria-modal="true"
            className="admin-template-modal"
            data-testid="admin-template-modal"
            onKeyDown={handleTemplateModalKeyDown}
            ref={templateModalRef}
            role="dialog"
          >
            <header className="admin-template-modal-header">
              <div>
                <span>公共模板</span>
                <h2 id="admin-template-modal-title">
                  {editing ? "编辑公共模板" : "新建公共模板"}
                </h2>
              </div>
              <button
                aria-label="关闭公共模板弹窗"
                className="admin-template-modal-close"
                onClick={closeTemplateModal}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="admin-template-modal-fields">
              <label>
                模板标题（1–40 字符）
                <input
                  data-autofocus="true"
                  maxLength={40}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="例如：电商主图工作流"
                  value={draft.title}
                />
              </label>
              <div className="admin-template-field">
                <span>状态</span>
                <GrayMenuSelect
                  ariaLabel="状态"
                  className="admin-template-select"
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      status: value as AdminPublicTemplateStatus,
                    }))
                  }
                  options={[
                    { label: "草稿", value: "draft" },
                    { label: "发布", value: "published" },
                    ...(draft.status === "archived"
                      ? [{ disabled: true, label: "已归档", value: "archived" }]
                      : []),
                  ]}
                  testId="admin-template-status-select"
                  value={draft.status}
                />
              </div>
              <label className="admin-template-field-wide">
                说明（可选）
                <input
                  maxLength={200}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="普通账号看到的模板说明"
                  value={draft.description}
                />
              </label>
              <div className="admin-template-categories admin-template-field-wide">
                <span>分类（可多选）</span>
                <div>
                  {REAL_CATEGORIES.map((category) => (
                    <label key={category}>
                      <input
                        checked={draft.categories.includes(category)}
                        className="admin-compact-checkbox"
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            categories: event.target.checked
                              ? [...current.categories, category]
                              : current.categories.filter(
                                  (item) => item !== category,
                                ),
                          }))
                        }
                        type="checkbox"
                      />
                      <span>{category}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label>
                封面路径（可选）
                <input
                  maxLength={500}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      previewImage: event.target.value,
                    }))
                  }
                  placeholder="/templates/demo.png"
                  value={draft.previewImage}
                />
              </label>
              {!editing && (
                <div className="admin-template-field">
                  <span>基于现有模板（可选）</span>
                  <GrayMenuSelect
                    ariaLabel="基于现有模板（可选）"
                    className="admin-template-select"
                    onChange={(value) => void pickBaseTemplate(value)}
                    options={[
                      { label: "不基于现有模板", value: "" },
                      ...templates.map((template) => ({
                        label: template.title,
                        value: template.id,
                      })),
                    ]}
                    testId="admin-template-base-select"
                    value={draft.baseTemplateId}
                  />
                </div>
              )}
              <label className="admin-template-field-wide">
                模板图 JSON（节点≤500、边≤1000、7 种类型）
                <textarea
                  className="admin-template-graph-json"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      graphJson: event.target.value,
                    }))
                  }
                  placeholder='{"nodes":[...],"edges":[...],"version":1}'
                  spellCheck={false}
                  value={draft.graphJson}
                />
              </label>
            </div>
            {modalError && (
              <p className="auth-error" role="alert">{modalError}</p>
            )}
            <div className="admin-template-modal-actions">
              <button onClick={closeTemplateModal} type="button">
                取消
              </button>
              <button
                className="admin-template-primary"
                onClick={() => void submit()}
                type="button"
              >
                保存
              </button>
            </div>
          </section>
        </div>
      )}
      {archiving && (
        <ConfirmDialog
          confirmLabel="归档"
          danger
          message={`确定要归档公共模板「${archiving.title}」？归档后普通账号不可见，仍可随时恢复；已导入的画布不受影响。`}
          onCancel={() => setArchiving(undefined)}
          onConfirm={() => void archive(archiving)}
          title="确认归档公共模板"
        />
      )}
    </main>
  );
}

function MyConnectionsPage({ currentUser }: { currentUser: AuthUser }) {
  const [items, setItems] = useState<AccountCredentialItem[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [feedback, setFeedback] = useState<
    Record<string, { message: string; status: "error" | "success" }>
  >({});

  const load = () =>
    jsonRequest<{ items: AccountCredentialItem[] }>(
      "/api/account-credentials",
    )
      .then((body) => setItems(body.items))
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "平台密钥状态读取失败",
        ),
      );

  useEffect(() => {
    void load();
  }, []);

  const save = async (item: AccountCredentialItem) => {
    const apiKey = keyInputs[item.profileId] ?? "";
    setBusyId(item.profileId);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        `/api/account-credentials/${encodeURIComponent(item.profileId)}`,
        { body: JSON.stringify({ apiKey }), method: "PUT" },
      );
      setKeyInputs((current) => ({ ...current, [item.profileId]: "" }));
      setNotice(`「${item.label}」的密钥已加密保存`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密钥保存失败");
    } finally {
      setBusyId("");
    }
  };

  const verify = async (item: AccountCredentialItem) => {
    setBusyId(item.profileId);
    setError("");
    setNotice("");
    try {
      const result = await jsonRequest<{
        verification: { message: string };
      }>(`/api/account-credentials/${encodeURIComponent(item.profileId)}/verify`, {
        method: "POST",
      });
      setFeedback((current) => ({
        ...current,
        [item.profileId]: {
          message: result.verification.message,
          status: "success",
        },
      }));
      await load();
    } catch (caught) {
      setFeedback((current) => ({
        ...current,
        [item.profileId]: {
          message:
            caught instanceof Error ? caught.message : "密钥校验失败",
          status: "error",
        },
      }));
    } finally {
      setBusyId("");
    }
  };

  const remove = async (item: AccountCredentialItem) => {
    setBusyId(item.profileId);
    setError("");
    setNotice("");
    try {
      await jsonRequest(
        `/api/account-credentials/${encodeURIComponent(item.profileId)}`,
        { method: "DELETE" },
      );
      setNotice(`「${item.label}」的密钥已删除`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密钥删除失败");
    } finally {
      setBusyId("");
    }
  };

  return (
    <main
      className="admin-page connections-page"
      data-testid="connections-page"
    >
      <SettingsPageHeader
        displayName={currentUser.displayName}
        pageTitle="我的连接"
        userId={currentUser.id}
      />
      <section className="admin-card connections-intro">
        <h1>我的平台密钥</h1>
        <p>
          每个平台只需填写你自己的 API Key。密钥只属于当前账号，管理员与其他人不可见。
        </p>
      </section>
      {notice && (
        <p className="storage-admin-notice provider-page-message">{notice}</p>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <section className="admin-card connections-list">
        <div className="api-contract-heading">
          <div>
            <span>平台列表</span>
            <h2>有已发布模型的平台</h2>
          </div>
          <b>{items.length} 个</b>
        </div>
        {items.length === 0 ? (
          <div className="model-list-empty">
            <strong>暂无可用平台</strong>
            <span>管理员发布模型后，这里会出现可填写密钥的平台。</span>
          </div>
        ) : (
          <div className="connections-grid">
            {items.map((item) => (
              <article
                className="connection-row"
                data-testid={`connection-row-${item.profileId}`}
                key={item.profileId}
              >
                <div className="connection-summary">
                  <strong>{item.label}</strong>
                  <small title={item.baseUrl}>
                    {item.baseUrl} · {item.driver}
                  </small>
                  <div className="connection-status">
                    <b data-key-status={item.keyStatus}>
                      {accountCredentialStatusLabel(item.keyStatus)}
                    </b>
                    {item.apiKeyMask && <span>{item.apiKeyMask}</span>}
                  </div>
                </div>
                <div className="connection-controls">
                  <input
                    aria-label={`${item.label} 的 API Key`}
                    autoComplete="new-password"
                    maxLength={500}
                    onChange={(event) =>
                      setKeyInputs((current) => ({
                        ...current,
                        [item.profileId]: event.target.value,
                      }))
                    }
                    placeholder="填写你自己的 API Key"
                    type="password"
                    value={keyInputs[item.profileId] ?? ""}
                  />
                  <button
                    disabled={busyId === item.profileId}
                    onClick={() => void save(item)}
                    type="button"
                  >
                    {busyId === item.profileId ? "保存中…" : "保存"}
                  </button>
                  <button
                    disabled={busyId === item.profileId || !item.apiKeyMask}
                    onClick={() => void verify(item)}
                    type="button"
                  >
                    校验
                  </button>
                  <button
                    disabled={busyId === item.profileId || !item.apiKeyMask}
                    onClick={() => void remove(item)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
                {feedback[item.profileId] && (
                  <p
                    className="connection-feedback"
                    data-status={feedback[item.profileId].status}
                    role="status"
                  >
                    {feedback[item.profileId].message}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ChangeOwnPasswordDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await jsonRequest("/api/auth/password", {
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
        method: "POST",
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密码修改失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-template-modal-backdrop">
      <div
        className="admin-template-modal"
        data-testid="change-password-modal"
        role="dialog"
      >
        <h2>修改密码</h2>
        <p>修改后其他设备会被强制重新登录。</p>
        <form autoComplete="off" onSubmit={submit}>
          <label>
            <span>当前密码</span>
            <input
              autoComplete="current-password"
              maxLength={200}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              type="password"
              value={currentPassword}
            />
          </label>
          <label>
            <span>新密码（至少 12 位）</span>
            <input
              autoComplete="new-password"
              maxLength={200}
              minLength={12}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </label>
          <label>
            <span>确认新密码</span>
            <input
              autoComplete="new-password"
              maxLength={200}
              minLength={12}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <div className="admin-template-modal-actions">
            <button disabled={busy} onClick={onClose} type="button">
              取消
            </button>
            <button disabled={busy} type="submit">
              {busy ? "保存中…" : "确认修改"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EffectRedirect({ to }: { to: string }) {
  const redirectStarted = useRef(false);
  useEffect(() => {
    if (redirectStarted.current || window.location.pathname === to) return;
    redirectStarted.current = true;
    window.location.replace(to);
  }, [to]);
  return (
    <main className="system-message" data-testid="route-redirect">
      正在返回可访问页面…
    </main>
  );
}

function AdminRouteGuard({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactNode;
}) {
  return allowed ? children : <EffectRedirect to="/" />;
}

function AuthenticatedApplication({
  fixtureId,
  projectId,
  workspace = false,
}: {
  fixtureId?: string;
  projectId?: string;
  workspace?: boolean;
}) {
  const [status, setStatus] = useState<AuthStatus>();
  const [loadError, setLoadError] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const accountPopover = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    jsonRequest<AuthStatus>("/api/auth/status", { signal: controller.signal })
      .then(async (result) => {
        if (!result.authenticated || !result.user) {
          setStatus(result);
          return;
        }
        try {
          const context = await jsonRequest<{
            permissions: AccountPermission[];
          }>("/api/account-context", { signal: controller.signal });
          setStatus({ ...result, permissions: context.permissions });
        } catch {
          // 权限读取失败不阻塞画布；管理员仍按角色兜底显示全部入口。
          setStatus(result);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setLoadError(
            caught instanceof Error ? caught.message : "登录状态读取失败",
          );
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const closeAccount = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else {
        const target = event.target as Element | null;
        if (
          accountPopover.current?.contains(target) ||
          target?.closest('[data-testid="user-avatar"]')
        ) {
          return;
        }
      }
      setAccountOpen(false);
      if (event instanceof KeyboardEvent) {
        window.requestAnimationFrame(() => {
          (
            document.querySelector(
              '[data-testid="user-avatar"]',
            ) as HTMLButtonElement | null
          )?.focus();
        });
      }
    };
    window.addEventListener("keydown", closeAccount);
    window.addEventListener("mousedown", closeAccount, true);
    return () => {
      window.removeEventListener("keydown", closeAccount);
      window.removeEventListener("mousedown", closeAccount, true);
    };
  }, [accountOpen]);

  if (loadError) {
    return <main className="system-message" role="alert">{loadError}</main>;
  }
  if (!status) {
    return <main className="system-message">正在读取账号状态…</main>;
  }
  if (status.bootstrapRequired) {
    return (
      <AccountForm
        bootstrap
        onSuccess={(user) => {
          setStatus({ authenticated: true, bootstrapRequired: false, user });
          window.location.replace("/canvas/projects");
        }}
      />
    );
  }
  if (!status.authenticated || !status.user) {
    return (
      <AccountForm
        bootstrap={false}
        onSuccess={(user) => {
          setStatus({ authenticated: true, bootstrapRequired: false, user });
          window.location.replace("/canvas/projects");
        }}
      />
    );
  }
  const pathname = window.location.pathname;
  const fromCurrentCanvas = (path: string) =>
    pathWithCurrentCanvasSource(
      path,
      status.user!.id,
      window.location.search,
      projectId,
    );
  const currentGroupRunScope = createGroupRunSummaryScope(
    status.user.id,
    projectId ?? fixtureId ?? "default",
    fixtureId ?? "",
  );
  const navigateFromCurrentCanvas = (path: string) => {
    if (!confirmGroupRunNavigation(currentGroupRunScope)) return;
    window.location.href = fromCurrentCanvas(path);
  };
  if (pathname === "/admin/accounts") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_accounts",
          status.user.role,
        )}
      >
        <AdminAccounts currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/models") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_models",
          status.user.role,
        )}
      >
        <AdminModels currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  const modelContractRoute = pathname.match(
    /^\/admin\/models\/([a-z0-9-]{3,80})\/contract$/i,
  );
  if (modelContractRoute) {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_models",
          status.user.role,
        )}
      >
        <AdminModelContractWorkbench
          currentUser={status.user}
          modelId={modelContractRoute[1]}
        />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/providers") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_providers",
          status.user.role,
        )}
      >
        <AdminProviders currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/storage") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_storage",
          status.user.role,
        )}
      >
        <AdminStorage currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/generation-safety") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_generation_safety",
          status.user.role,
        )}
      >
        <AdminGenerationSafety currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/api-contract") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_accounts",
          status.user.role,
        )}
      >
        <AdminApiContract currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/admin/templates") {
    return (
      <AdminRouteGuard
        allowed={hasClientPermission(
          status.permissions,
          "manage_public_templates",
          status.user.role,
        )}
      >
        <AdminTemplatesPage currentUser={status.user} />
      </AdminRouteGuard>
    );
  }
  if (pathname === "/connections") {
    return <MyConnectionsPage currentUser={status.user} />;
  }

  return (
    <>
      <CanvasApplication
        accountOpen={accountOpen}
        fixtureId={fixtureId}
        onAccountOpenChange={setAccountOpen}
        permissions={status.permissions}
        projectId={projectId}
        role={status.user.role}
        userId={status.user.id}
        userInitial={status.user.displayName.trim().charAt(0).toLocaleUpperCase() || "M"}
        workspace={workspace || pathname === "/"}
      />
      {accountOpen && (
        <aside
          className="account-popover"
          data-testid="account-popover"
          ref={accountPopover}
        >
          <strong>{status.user.displayName}</strong>
          <span>@{status.user.loginName}</span>
          <button
            onClick={() => {
              navigateFromCurrentCanvas("/canvas/projects");
            }}
            type="button"
          >
            工作空间
          </button>
          <button
            onClick={() => {
              navigateFromCurrentCanvas("/connections");
            }}
            type="button"
          >
            我的连接
          </button>
          {hasClientPermission(
            status.permissions,
            "manage_models",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/models");
                }}
                type="button"
              >
                模型中心
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_providers",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/providers");
                }}
                type="button"
              >
                平台连接
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_accounts",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/accounts");
                }}
                type="button"
              >
                账号管理
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_storage",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/storage");
                }}
                type="button"
              >
                存储中心
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_generation_safety",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/generation-safety");
                }}
                type="button"
              >
                生成安全
              </button>
          )}
          {hasClientPermission(
            status.permissions,
            "manage_public_templates",
            status.user.role,
          ) && (
              <button
                onClick={() => {
                  navigateFromCurrentCanvas("/admin/templates");
                }}
                type="button"
              >
                公共模板管理
              </button>
          )}
          <button
            onClick={() => {
              setAccountOpen(false);
              setPasswordOpen(true);
            }}
            type="button"
          >
            修改密码
          </button>
          <button
            onClick={() => {
              if (!confirmGroupRunNavigation(currentGroupRunScope)) return;
              void jsonRequest("/api/auth/logout", { method: "POST" }).then(() =>
                setStatus({
                  authenticated: false,
                  bootstrapRequired: false,
                }),
              );
            }}
            type="button"
          >
            退出登录
          </button>
        </aside>
      )}
      {passwordOpen && (
        <ChangeOwnPasswordDialog onClose={() => setPasswordOpen(false)} />
      )}
    </>
  );
}

function navigateToProjectWorkspace() {
  window.location.href = "/canvas/projects";
}

function CanvasApplication({
  accountOpen,
  fixtureId,
  onAccountOpenChange,
  permissions,
  projectId,
  role,
  userId,
  userInitial,
  workspace,
}: {
  accountOpen: boolean;
  fixtureId?: string;
  onAccountOpenChange: (open: boolean) => void;
  permissions?: AccountPermission[];
  projectId?: string;
  role?: AuthUser["role"];
  userId?: string;
  userInitial: string;
  workspace?: boolean;
}) {
  return (
    <Suspense
      fallback={(
        <main className="system-message" role="status">
          正在加载工作区…
        </main>
      )}
    >
      {workspace ? (
        <WorkspacePage userId={userId} />
      ) : (
        <ModelCatalogProvider>
          <CanvasShell
            accountOpen={accountOpen}
            fixtureId={fixtureId}
            onAccountOpenChange={onAccountOpenChange}
            onProjectMissing={navigateToProjectWorkspace}
            permissions={permissions}
            projectId={projectId}
            role={role}
            userId={userId}
            userInitial={userInitial}
          />
        </ModelCatalogProvider>
      )}
    </Suspense>
  );
}

export function App() {
  const [fixtureState, setFixtureState] = useState<FixtureState>(() =>
    fixtureMatch
      ? fixtureRouteId
        ? { state: "loading", id: fixtureRouteId }
        : { state: "error", message: "Fixture route is invalid" }
      : { state: "idle" },
  );

  useEffect(() => {
    if (!fixtureRouteId || !import.meta.env.DEV) {
      return;
    }

    const id = fixtureRouteId;
    const controller = new AbortController();

    fetch(`/__fixture-api/${encodeURIComponent(id)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Fixture request failed: ${response.status}`);
        }
        return (await response.json()) as { fixture: Fixture };
      })
      .then(({ fixture }) => {
        if (
          ![
            "canvas",
            "shell",
            "interaction",
            "node",
            "workflow",
            "geometry-catalog",
            "menu",
            "modal",
            "overlay",
            "panel",
            "persistence",
            "popover",
          ].includes(
            fixture.kind,
          )
        ) {
          throw new Error(`Fixture kind is not supported yet: ${fixture.kind}`);
        }
        setFixtureState({ state: "ready", fixture });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFixtureState({
            state: "error",
            message: error instanceof Error ? error.message : "Fixture load failed",
          });
        }
      });

    return () => controller.abort();
  }, []);

  if ((fixtureMatch || responsivePreviewMatch) && !import.meta.env.DEV) {
    return (
      <main className="system-message" data-testid="fixture-unavailable">
        Fixture routes are unavailable in production.
      </main>
    );
  }

  if (responsivePreviewMatch) {
    const [width, height] = responsivePreviewMatch[1]
      .split("x")
      .map(Number);
    return <ResponsivePreview height={height} width={width} />;
  }

  if (fixtureState.state === "loading") {
    return <main className="system-message">Loading fixture…</main>;
  }

  if (fixtureState.state === "error") {
    return (
      <main className="system-message" role="alert">
        {fixtureState.message}
      </main>
    );
  }

  if (fixtureState.state === "ready") {
    return <AuthenticatedApplication fixtureId={fixtureState.fixture.id} />;
  }

  if (projectWorkspaceMatch) {
    return <AuthenticatedApplication workspace />;
  }
  if (projectCanvasMatch) {
    if (!projectCanvasId) {
      return (
        <main className="system-message" role="alert">
          Project route is invalid.
        </main>
      );
    }
    return (
      <AuthenticatedApplication
        projectId={projectCanvasId}
      />
    );
  }

  return <AuthenticatedApplication />;
}
