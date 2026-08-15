import { useState } from "react";

type MediaLoadState = {
  failed: boolean;
  revision: number;
  source: string;
};

function reloadableSource(source: string, revision: number) {
  if (revision === 0 || !source.startsWith("/api/")) return source;
  const hashIndex = source.indexOf("#");
  const base = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const hash = hashIndex >= 0 ? source.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}unboundry-media-retry=${revision}${hash}`;
}

export function useMediaLoadRecovery(source: string | undefined) {
  const currentSource = source ?? "";
  const [state, setState] = useState<MediaLoadState>({
    failed: false,
    revision: 0,
    source: currentSource,
  });
  const active = state.source === currentSource
    ? state
    : { failed: false, revision: 0, source: currentSource };

  return {
    failed: Boolean(currentSource && active.failed),
    key: `${currentSource}:${active.revision}`,
    markFailed: () => {
      if (!currentSource) return;
      setState((existing) => ({
        failed: true,
        revision: existing.source === currentSource ? existing.revision : 0,
        source: currentSource,
      }));
    },
    markLoaded: () => {
      if (!currentSource) return;
      setState((existing) => ({
        failed: false,
        revision: existing.source === currentSource ? existing.revision : 0,
        source: currentSource,
      }));
    },
    reload: () => {
      if (!currentSource) return;
      setState((existing) => ({
        failed: false,
        revision: existing.source === currentSource
          ? existing.revision + 1
          : 1,
        source: currentSource,
      }));
    },
    source: reloadableSource(currentSource, active.revision),
  };
}

export function MediaLoadFallback({
  kind,
  onReload,
  onReplace,
}: {
  kind: "图片" | "视频" | "音频";
  onReload: () => void;
  onReplace: () => void;
}) {
  return (
    <div
      className="media-load-fallback nodrag nopan"
      data-testid="media-load-fallback"
      role="status"
    >
      <svg aria-hidden="true" viewBox="0 0 48 48">
        <rect height="32" rx="6" width="38" x="5" y="8" />
        <path d="m11 34 9-9 7 7 5-5 5 5M34 14l6 6M40 14l-6 6" />
      </svg>
      <strong>{kind}暂时无法显示</strong>
      <span>素材已保留，可以重新加载或替换</span>
      <div>
        <button onClick={onReload} type="button">重新加载</button>
        <button onClick={onReplace} type="button">重新上传</button>
      </div>
    </div>
  );
}
