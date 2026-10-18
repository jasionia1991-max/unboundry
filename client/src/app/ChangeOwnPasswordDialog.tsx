import { useState, type FormEvent } from "react";
import { jsonRequest } from "./jsonRequest";

export function ChangeOwnPasswordDialog({
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
