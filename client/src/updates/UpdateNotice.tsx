import { useEffect, useRef, useState } from "react";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";

const maximumReconnectDelayMs = 30_000;
const initialReconnectDelayMs = 1_000;

function boundedRetryDelay(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(
    maximumReconnectDelayMs,
    Math.max(initialReconnectDelayMs, Math.ceil(value * 1_000)),
  );
}

export function UpdateNotice() {
  const { flushCanvasSave } = useGenerationCanvas();
  const [nextVersion, setNextVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reloadInFlight = useRef(false);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let source: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let preferredRetryDelay: number | undefined;

    const isVisible = () => document.visibilityState !== "hidden";
    const canConnect = () =>
      !disposed && navigator.onLine !== false && isVisible();
    const clearReconnectTimer = () => {
      if (reconnectTimer === undefined) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };
    const nextBackoffDelay = () => {
      const delay = Math.min(
        maximumReconnectDelayMs,
        initialReconnectDelayMs * (2 ** reconnectAttempt),
      );
      reconnectAttempt += 1;
      return delay;
    };

    const detach = (candidate: EventSource) => {
      candidate.removeEventListener("open", onOpen);
      candidate.removeEventListener("message", onMessage);
      candidate.removeEventListener("maintenance", onMaintenance);
      candidate.removeEventListener("shutdown", onShutdown);
      candidate.removeEventListener("error", onError);
    };
    const retire = (candidate: EventSource) => {
      if (source !== candidate) return;
      detach(candidate);
      source = undefined;
      generation += 1;
      candidate.close();
    };
    const scheduleReconnect = (delay?: number) => {
      if (disposed || !canConnect()) return;
      if (source && source.readyState !== EventSource.CLOSED) return;
      if (reconnectTimer !== undefined) return;
      const selectedDelay = delay ?? preferredRetryDelay ?? nextBackoffDelay();
      preferredRetryDelay = undefined;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        if (!canConnect()) return;
        connect();
      }, selectedDelay);
    };
    const onOpen = (event: Event) => {
      const candidate = event.currentTarget as EventSource | null;
      if (!candidate || candidate !== source) return;
      reconnectAttempt = 0;
      preferredRetryDelay = undefined;
    };
    const onMessage = (event: MessageEvent<string>) => {
      const candidate = event.currentTarget as EventSource | null;
      if (!candidate || candidate !== source) return;
      try {
        const payload = JSON.parse(event.data) as { version?: string };
        if (payload.version && payload.version !== __UNBOUNDRY_VERSION__) {
          setNextVersion(payload.version);
        }
      } catch {
        // 忽略非版本事件。
      }
    };
    const handleLifecycleEvent = (event: MessageEvent<string>) => {
      const candidate = event.currentTarget as EventSource | null;
      if (!candidate || candidate !== source) return;
      let retryDelay: number | undefined;
      try {
        const payload = JSON.parse(event.data) as {
          retryAfterSeconds?: number;
        };
        retryDelay = boundedRetryDelay(payload.retryAfterSeconds);
      } catch {
        // 没有可用的维护退避时继续使用客户端退避。
      }
      if (retryDelay !== undefined) preferredRetryDelay = retryDelay;
      // 维护/关闭事件意味着服务端将结束当前流。先移除旧实例，
      // 再安排唯一一次重建，避免和 EventSource 原生重连并行。
      retire(candidate);
      scheduleReconnect(retryDelay);
    };
    const onMaintenance = (event: Event) =>
      handleLifecycleEvent(event as MessageEvent<string>);
    const onShutdown = (event: Event) =>
      handleLifecycleEvent(event as MessageEvent<string>);
    const onError = (event: Event) => {
      const candidate = event.currentTarget as EventSource | null;
      if (!candidate || candidate !== source) return;
      // CONNECTING 是 EventSource 的原生重连阶段；不另开连接。
      if (candidate.readyState === EventSource.CONNECTING) return;
      if (candidate.readyState !== EventSource.CLOSED) return;
      retire(candidate);
      scheduleReconnect();
    };
    let connect: () => void;
    connect = () => {
      if (!canConnect()) {
        return;
      }
      if (source && source.readyState !== EventSource.CLOSED) return;
      if (source) retire(source);
      const instance = ++generation;
      let candidate: EventSource;
      try {
        candidate = new EventSource("/api/updates");
      } catch {
        if (!disposed && generation === instance) scheduleReconnect();
        return;
      }
      source = candidate;
      candidate.addEventListener("open", onOpen);
      candidate.addEventListener("message", onMessage);
      candidate.addEventListener("maintenance", onMaintenance);
      candidate.addEventListener("shutdown", onShutdown);
      candidate.addEventListener("error", onError);
    };
    const onOnline = () => {
      if (!disposed) scheduleReconnect(0);
    };
    const onOffline = () => {
      clearReconnectTimer();
      if (source) retire(source);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !disposed) {
        scheduleReconnect(0);
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    connect();
    return () => {
      disposed = true;
      clearReconnectTimer();
      if (source) {
        const candidate = source;
        detach(candidate);
        source = undefined;
        generation += 1;
        candidate.close();
      }
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!nextVersion) return null;

  const reloadAfterSave = async () => {
    if (reloadInFlight.current) return;
    reloadInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await flushCanvasSave();
      window.location.reload();
    } catch (caught) {
      reloadInFlight.current = false;
      setBusy(false);
      const detail = caught instanceof Error ? caught.message.trim() : "";
      setError(
        detail
          ? `保存失败，未刷新页面：${detail}`
          : "保存失败，未刷新页面，请重试",
      );
    }
  };

  return (
    <div
      className="update-notice"
      data-testid="update-notice"
      role="status"
    >
      <span>已更新到 v{nextVersion}</span>
      <button
        aria-describedby={error ? "update-reload-error" : undefined}
        data-testid="update-reload"
        disabled={busy}
        onClick={() => void reloadAfterSave()}
        type="button"
      >
        {busy ? "正在保存…" : "刷新"}
      </button>
      {error && (
        <span
          data-testid="update-reload-error"
          id="update-reload-error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}
