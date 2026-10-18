import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { SettingsPageHeader } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";
import {
  type AdminStorageProfile,
  type AdminStorageStatus,
  type StorageTestFeedback,
} from "./adminTypes";

function formatStorageBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) {
    return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  }
  return `${(bytes / 1_024 ** 3).toFixed(2)} GB`;
}

export function AdminStorage({ currentUser }: { currentUser: AuthUser }) {
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
