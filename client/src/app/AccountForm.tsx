import { useState, type FormEvent } from "react";
import { usePageTitle } from "../pageIdentity";
import { type AuthUser } from "./accountAuth";
import { jsonRequest } from "./jsonRequest";

export function AccountForm({
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
