import { useEffect, useState } from "react";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";

export function UpdateNotice() {
  const { flushCanvasSave } = useGenerationCanvas();
  const [nextVersion, setNextVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div
      className="update-notice"
      data-testid="update-notice"
      role="status"
    >
      <span>已更新到 v{nextVersion}</span>
      <button
        data-testid="update-reload"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void flushCanvasSave()
            .catch(() => undefined)
            .finally(() => {
              window.location.reload();
            });
        }}
        type="button"
      >
        {busy ? "正在保存…" : "刷新"}
      </button>
    </div>
  );
}
