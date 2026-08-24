import { useEffect, useRef, useState } from "react";
import {
  visibleImageBoundsSupportGrid,
  type VisibleImageBounds,
} from "./localImageProcessing";

const maximumLocalDimension = 8_192;

export function ImageResizePanel({
  initialHeight,
  initialWidth,
  onBusyChange,
  onCancel,
  onConfirm,
}: Readonly<{
  initialHeight: number;
  initialWidth: number;
  onBusyChange?(busy: boolean): void;
  onCancel(): void;
  onConfirm(width: number, height: number): Promise<void>;
}>) {
  const safeWidth = Math.max(1, Math.round(initialWidth || 1024));
  const safeHeight = Math.max(1, Math.round(initialHeight || 1024));
  const ratio = safeWidth / safeHeight;
  const [width, setWidth] = useState(safeWidth);
  const [height, setHeight] = useState(safeHeight);
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [busy, onCancel]);
  const confirm = async () => {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      await onConfirm(width, height);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "调整像素失败");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return (
    <div className="image-tool-compact-panel" data-testid="image-resize-panel">
      <header className="image-tool-panel-header">
        <span><strong>调整像素</strong><small>本地处理 · 不会覆盖原图</small></span>
        <button aria-label="关闭调整像素" disabled={busy} onClick={onCancel} type="button">×</button>
      </header>
      <div className="image-tool-panel-body image-resize-fields">
        <label>宽度<input
          aria-label="像素宽度"
          max={maximumLocalDimension}
          min="1"
          onChange={(event) => {
            const next = Number(event.target.value);
            setWidth(next);
            if (locked && Number.isFinite(next)) setHeight(Math.max(1, Math.round(next / ratio)));
          }}
          ref={firstInput}
          type="number"
          value={width}
        /></label>
        <button
          aria-pressed={locked}
          className="image-resize-lock"
          onClick={() => setLocked((value) => !value)}
          type="button"
        >{locked ? "比例已锁定" : "比例未锁定"}</button>
        <label>高度<input
          aria-label="像素高度"
          max={maximumLocalDimension}
          min="1"
          onChange={(event) => {
            const next = Number(event.target.value);
            setHeight(next);
            if (locked && Number.isFinite(next)) setWidth(Math.max(1, Math.round(next * ratio)));
          }}
          type="number"
          value={height}
        /></label>
        {error && <span role="alert">{error}</span>}
      </div>
      <footer className="image-tool-panel-footer">
        <button disabled={busy} onClick={onCancel} type="button">取消</button>
        <button className="primary" disabled={busy} onClick={() => void confirm()} type="button">
          {busy ? "处理中…" : "保存本地副本"}
        </button>
      </footer>
    </div>
  );
}

export function ImageSplitPanel({
  onBusyChange,
  onCancel,
  onConfirm,
  preview,
  previewBounds,
  previewBusy,
  previewError,
}: Readonly<{
  onBusyChange?(busy: boolean): void;
  onCancel(): void;
  onConfirm(grid: 2 | 3 | 4): Promise<void>;
  preview: string;
  previewBounds?: VisibleImageBounds;
  previewBusy: boolean;
  previewError: string;
}>) {
  const [grid, setGrid] = useState<2 | 3 | 4>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gridSupported = Boolean(
    previewBounds && visibleImageBoundsSupportGrid(previewBounds, grid),
  );
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [busy, onCancel]);
  const confirm = async () => {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      await onConfirm(grid);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "快速切分失败");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return (
    <div className="image-tool-sheet image-split-panel" data-testid="image-split-panel">
      <header className="image-tool-panel-header">
        <span><strong>快速切分</strong><small>本地处理 · 只切分可见图片本体 · 生成 {grid ** 2} 张</small></span>
        <button aria-label="关闭快速切分" disabled={busy} onClick={onCancel} type="button">×</button>
      </header>
      <div className="image-tool-panel-body image-split-body">
        <div className="image-split-preview">
          {previewBusy && <span className="image-split-preview-status">正在识别图片本体…</span>}
          {!previewBusy && previewError && (
            <span className="image-split-preview-status" role="alert">{previewError}</span>
          )}
          {!previewBusy && !previewError && previewBounds && (
            <svg
              aria-label="切分预览"
              className="image-split-preview-frame"
              data-source-bounds={`${previewBounds.x},${previewBounds.y},${previewBounds.width},${previewBounds.height}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              viewBox={`0 0 ${previewBounds.width} ${previewBounds.height}`}
            >
              <image
                height={previewBounds.sourceHeight}
                href={preview}
                width={previewBounds.sourceWidth}
                x={-previewBounds.x}
                y={-previewBounds.y}
              />
              {Array.from({ length: grid - 1 }, (_, index) => index + 1).map((line) => (
                <g key={line}>
                  <line
                    className="image-split-grid-line"
                    x1={previewBounds.width * line / grid}
                    x2={previewBounds.width * line / grid}
                    y1="0"
                    y2={previewBounds.height}
                  />
                  <line
                    className="image-split-grid-line"
                    x1="0"
                    x2={previewBounds.width}
                    y1={previewBounds.height * line / grid}
                    y2={previewBounds.height * line / grid}
                  />
                </g>
              ))}
            </svg>
          )}
        </div>
        <div className="image-split-options">{([2, 3, 4] as const).map((value) => (
          <button
            aria-label={`${value}×${value}（${value ** 2}张）`}
            aria-pressed={grid === value}
            disabled={busy || Boolean(
              previewBounds && !visibleImageBoundsSupportGrid(previewBounds, value),
            )}
            key={value}
            onClick={() => setGrid(value)}
            ref={value === 2 ? firstButton : undefined}
            type="button"
          ><strong>{value}×{value}</strong><small>{value ** 2} 张图片</small></button>
        ))}</div>
        {!previewBusy && !previewError && previewBounds && !gridSupported && (
          <span role="alert">可见内容至少需要 {grid}×{grid} 像素才能使用 {grid}×{grid} 切分</span>
        )}
        {error && <span role="alert">{error}</span>}
      </div>
      <footer className="image-tool-panel-footer">
        <button disabled={busy} onClick={onCancel} type="button">取消</button>
        <button aria-label="确认切分" className="primary"
          disabled={busy || previewBusy || Boolean(previewError) || !gridSupported}
          onClick={() => void confirm()} type="button">
          {busy ? "处理中…" : `确认切分为 ${grid ** 2} 张`}
        </button>
      </footer>
    </div>
  );
}
