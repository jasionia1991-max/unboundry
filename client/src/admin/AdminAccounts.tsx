import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GrayMenuSelect } from "../ui/GrayMenuSelect";
import {
  ADMIN_ONLY_PERMISSIONS,
  ALL_PERMISSIONS,
  permissionLabel,
  type AccountPermission,
} from "../../../types/accountPermissions";
import { SettingsPageHeader } from "../navigation/SettingsPageHeader";
import {
  type AccountPermissionDetails,
  type AuthUser,
  orderedPermissions,
  permissionDetailsFromResponse,
  samePermissions,
} from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";

export function AdminAccounts({ currentUser }: { currentUser: AuthUser }) {
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
