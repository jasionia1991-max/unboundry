import { useEffect, useState } from "react";
import { SettingsPageHeader } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "./accountAuth";
import { jsonRequest } from "./jsonRequest";

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

export function MyConnectionsPage({ currentUser }: { currentUser: AuthUser }) {
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
