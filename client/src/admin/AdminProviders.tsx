import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { SettingsPageHeader, settingsDestination } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";
import { ProviderModelCatalogSection } from "./ProviderModelCatalogSection";
import {
  type AdminProviderProfile,
  type AdminProviderReadOnlyDescriptor,
  type AdminProviderReadOnlyMetric,
  type AdminProviderReadOnlySummary,
  type AdminProviderStatus,
  type ProviderDriver,
} from "./adminTypes";
import {
  emptyProviderModelCatalog,
  providerBaseUrlEditable,
  providerCatalogCapabilities,
  providerCatalogDate,
  providerCatalogStatusLabel,
  providerDriverDetails,
  providerKeyCheckedAt,
  providerKeyStatusLabel,
} from "./providerCatalog";

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

export function AdminProviders({ currentUser }: { currentUser: AuthUser }) {
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
