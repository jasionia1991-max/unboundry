import { useCallback, useEffect, useRef, useState } from "react";
import {
  isSeedanceTrustedAssetBranch,
  isSeedanceTrustedAssetStatus,
  seedanceTrustedAssetStatusLabels,
  type SeedanceAuthorizationSessionCreateView,
  type SeedanceAuthorizationSessionView,
  type SeedanceTrustedAssetCapability,
  type SeedanceTrustedBindingView,
} from "../../../types/seedanceTrustedAssets";
import { ImageToolSurface } from "./ImageToolHost";

type JsonRecord = Record<string, unknown>;

async function json(response: Response) {
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "可信素材请求失败");
  }
  return body;
}

function session(value: JsonRecord): SeedanceAuthorizationSessionCreateView {
  if (
    typeof value.id !== "string" || typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    value.expiresAt !== null && typeof value.expiresAt !== "string" ||
    !isSeedanceTrustedAssetStatus(value.status) ||
    value.authorizationUrl !== undefined && typeof value.authorizationUrl !== "string"
  ) throw new Error("可信素材授权状态无效");
  return value as SeedanceAuthorizationSessionCreateView;
}

function capability(value: JsonRecord): SeedanceTrustedAssetCapability {
  if (
    !isSeedanceTrustedAssetBranch(value.branch) ||
    typeof value.canCreateAuthorizationSession !== "boolean" ||
    typeof value.canInspectAsset !== "boolean" ||
    typeof value.providerDisplayName !== "string"
  ) throw new Error("可信素材能力状态无效");
  return value as SeedanceTrustedAssetCapability;
}

function binding(value: JsonRecord): SeedanceTrustedBindingView {
  const source = value.source as JsonRecord | undefined;
  if (
    typeof value.id !== "string" || typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    value.checkedAt !== null && typeof value.checkedAt !== "string" ||
    !isSeedanceTrustedAssetStatus(value.status) ||
    !source || source.kind !== "image" || typeof source.assetId !== "string" ||
    typeof source.checksumSha256 !== "string"
  ) throw new Error("可信素材关联状态无效");
  return value as SeedanceTrustedBindingView;
}

const continuingStatuses = new Set([
  "SESSION_PENDING",
  "WAITING_AUTHORIZATION",
  "AUTHORIZATION_COMPLETED",
  "PENDING_ACCEPTANCE",
  "ASSET_PROCESSING",
]);

function storedSessionKey(assetId: string) {
  return `unboundry:seedance-trusted-session:${assetId}`;
}

export function SeedanceTrustedAssetPanel({
  assetId,
  onBusyChange,
  onClose,
}: Readonly<{
  assetId: string;
  onBusyChange?(busy: boolean): void;
  onClose(): void;
}>) {
  const [providerCapability, setProviderCapability] =
    useState<SeedanceTrustedAssetCapability>();
  const [authorizationSession, setAuthorizationSession] =
    useState<SeedanceAuthorizationSessionView>();
  const [trustedBinding, setTrustedBinding] = useState<SeedanceTrustedBindingView>();
  const [providerAssetId, setProviderAssetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const requestInFlight = useRef(false);

  const changeBusy = (next: boolean) => {
    setBusy(next);
    onBusyChange?.(next);
  };

  const readBinding = useCallback(async () => {
    const response = await fetch(
      `/api/media/image/${encodeURIComponent(assetId)}/seedance/trusted-binding`,
      { cache: "no-store" },
    );
    if (response.status === 404) {
      if (alive.current) setTrustedBinding(undefined);
      return undefined;
    }
    const result = binding(await json(response));
    if (alive.current) setTrustedBinding(result);
    return result;
  }, [assetId]);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setError("");
    changeBusy(true);
    try {
      if (authorizationSession &&
          continuingStatuses.has(authorizationSession.status)) {
        const response = await fetch(
          `/api/seedance/authorization-sessions/${encodeURIComponent(authorizationSession.id)}`,
          { cache: "no-store" },
        );
        const next = session(await json(response));
        if (alive.current) setAuthorizationSession(next);
        if (continuingStatuses.has(next.status)) return;
        window.sessionStorage.removeItem(storedSessionKey(assetId));
      }
      await readBinding();
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error
        ? caught.message : "可信素材状态刷新失败");
    } finally {
      requestInFlight.current = false;
      if (alive.current) changeBusy(false);
    }
  }, [assetId, authorizationSession, readBinding]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/seedance/trusted-assets/capability", {
          cache: "no-store",
        });
        const result = capability(await json(response));
        if (alive.current) setProviderCapability(result);
        const storedSessionId = window.sessionStorage.getItem(
          storedSessionKey(assetId),
        );
        if (storedSessionId) {
          const sessionResponse = await fetch(
            `/api/seedance/authorization-sessions/${encodeURIComponent(storedSessionId)}`,
            { cache: "no-store" },
          );
          if (sessionResponse.status === 404) {
            window.sessionStorage.removeItem(storedSessionKey(assetId));
          } else {
            const restored = session(await json(sessionResponse));
            if (alive.current) setAuthorizationSession(restored);
            if (!continuingStatuses.has(restored.status)) {
              window.sessionStorage.removeItem(storedSessionKey(assetId));
            }
          }
        }
        await readBinding();
      } catch (caught) {
        if (alive.current) setError(caught instanceof Error
          ? caught.message : "可信素材能力读取失败");
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
      onBusyChange?.(false);
    };
  }, [assetId, onBusyChange, readBinding]);

  useEffect(() => {
    if (!authorizationSession ||
        !continuingStatuses.has(authorizationSession.status)) return;
    const timeout = window.setTimeout(() => void refresh(), 20_000);
    return () => window.clearTimeout(timeout);
  }, [authorizationSession, refresh]);

  const startAuthorization = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const authorizationWindow = window.open("about:blank", "_blank");
    if (authorizationWindow) authorizationWindow.opener = null;
    changeBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/media/image/${encodeURIComponent(assetId)}/seedance/authorization-sessions`,
        { method: "POST" },
      );
      const created = session(await json(response));
      if (!alive.current) return;
      setAuthorizationSession(created);
      window.sessionStorage.setItem(storedSessionKey(assetId), created.id);
      if (created.authorizationUrl) {
        if (authorizationWindow) {
          authorizationWindow.location.replace(created.authorizationUrl);
        } else {
          window.open(created.authorizationUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        authorizationWindow?.close();
      }
      await readBinding();
    } catch (caught) {
      authorizationWindow?.close();
      if (alive.current) setError(caught instanceof Error
        ? caught.message : "方舟真人授权会话创建失败");
    } finally {
      requestInFlight.current = false;
      if (alive.current) changeBusy(false);
    }
  };

  const linkExisting = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    changeBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/media/image/${encodeURIComponent(assetId)}/seedance/trusted-bindings`,
        {
          body: JSON.stringify({ providerAssetId: providerAssetId.trim() }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const result = binding(await json(response));
      if (alive.current) setTrustedBinding(result);
    } catch (caught) {
      if (alive.current) setError(caught instanceof Error
        ? caught.message : "方舟可信素材关联失败");
    } finally {
      requestInFlight.current = false;
      if (alive.current) changeBusy(false);
    }
  };

  const status = authorizationSession &&
      continuingStatuses.has(authorizationSession.status)
    ? authorizationSession.status
    : trustedBinding?.status ?? authorizationSession?.status ?? "NOT_STARTED";
  return (
    <ImageToolSurface className="seedance-trusted-asset-shell">
      <div className="seedance-trusted-asset-panel" data-testid="seedance-trusted-asset-panel">
        <header className="image-tool-panel-header">
          <span>
            <strong>角色可信素材</strong>
            <small>{providerCapability?.providerDisplayName ?? "火山方舟"}</small>
          </span>
          <button aria-label="关闭角色可信素材" disabled={busy}
            onClick={onClose} type="button">×</button>
        </header>
        <div className="image-tool-panel-body">
          {loading ? <p role="status">正在读取当前方舟账号能力…</p> : (
            <>
              <div className="seedance-trusted-status" data-status={status}>
                <span aria-hidden="true" />
                <div>
                  <strong>{seedanceTrustedAssetStatusLabels[status]}</strong>
                  <small>该状态来自当前方舟账号，最终使用仍受素材授权范围和平台规则约束。</small>
                </div>
              </div>
              <dl className="seedance-trusted-details">
                <div><dt>当前图片</dt><dd>{assetId}</dd></div>
                <div><dt>能力路径</dt><dd>{providerCapability?.branch === "A"
                  ? "方舟真人授权与可信素材创建"
                  : providerCapability?.branch === "B"
                    ? "关联已有方舟可信素材"
                    : "当前账号未开放可信素材"}</dd></div>
                <div><dt>远端核验</dt><dd>{trustedBinding?.checkedAt
                  ? new Date(trustedBinding.checkedAt).toLocaleString()
                  : "尚未完成"}</dd></div>
              </dl>
              {providerCapability?.branch === "A" &&
                  status === "NOT_STARTED" && (
                <div className="seedance-trusted-guidance">
                  <p>首次使用会打开方舟页面完成人真授权。摄像头、活体视频和人脸特征不会进入 Unboundry。</p>
                  <button className="primary" disabled={busy}
                    onClick={() => void startAuthorization()} type="button">
                    {busy ? "正在创建…" : "开始方舟真人授权"}
                  </button>
                </div>
              )}
              {providerCapability?.branch === "B" && (
                <div className="seedance-trusted-guidance">
                  <label>方舟 Asset ID
                    <input disabled={busy} maxLength={160}
                      onChange={(event) => setProviderAssetId(event.target.value)}
                      value={providerAssetId} />
                  </label>
                  <button className="primary" disabled={busy || !providerAssetId.trim()}
                    onClick={() => void linkExisting()} type="button">
                    关联方舟可信素材
                  </button>
                </div>
              )}
              {providerCapability?.branch === "C" && (
                <p>当前方舟账号没有可用的可信素材能力，普通 Seedance 参考素材仍可继续使用。</p>
              )}
              {status !== "NOT_STARTED" && (
                <button disabled={busy} onClick={() => void refresh()} type="button">
                  {busy ? "正在刷新…" : "刷新状态"}
                </button>
              )}
              {trustedBinding?.failure && (
                <div role="alert">{trustedBinding.failure.message}</div>
              )}
              {error && <div role="alert">{error}</div>}
            </>
          )}
        </div>
        <footer className="image-tool-panel-footer">
          <button disabled={busy} onClick={onClose} type="button">关闭</button>
        </footer>
      </div>
    </ImageToolSurface>
  );
}
