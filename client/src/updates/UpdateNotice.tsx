import { useEffect, useRef, useState } from "react";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";

export function UpdateNotice() {
  const { flushCanvasSave } = useGenerationCanvas();
  const [nextVersion, setNextVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reloadInFlight = useRef(false);

  useEffect(() => {
    const source = new EventSource("/api/updates");
    const onMessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { version?: string };
        if (payload.version && payload.version !== __UNBOUNDRY_VERSION__) {
          setNextVersion(payload.version);
        }
      } catch {
        // 忽略非版本事件。
      }
    };
    source.addEventListener("message", onMessage);
    return () => {
      source.removeEventListener("message", onMessage);
      source.close();
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
