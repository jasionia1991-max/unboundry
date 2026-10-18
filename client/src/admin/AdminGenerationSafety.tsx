import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { SettingsPageHeader } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";
import {
  type AdminGenerationSafetyStatus,
  type GenerationSafetySettings,
} from "./adminTypes";

export function AdminGenerationSafety({
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
