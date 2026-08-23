import { useEffect, useRef, useState } from "react";

const maximumLocalDimension = 8_192;

export function ImageResizePanel({
  initialHeight,
  initialWidth,
  onCancel,
  onConfirm,
}: Readonly<{
  initialHeight: number;
  initialWidth: number;
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
    setError("");
    try {
      await onConfirm(width, height);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "调整像素失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-local-tool-panel" data-testid="image-resize-panel">
      <strong>调整像素</strong>
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
      <button disabled={busy} onClick={onCancel} type="button">取消</button>
      <button disabled={busy} onClick={() => void confirm()} type="button">
        {busy ? "处理中" : "生成派生图"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

export function ImageSplitPanel({
  onCancel,
  onConfirm,
  preview,
}: Readonly<{
  onCancel(): void;
  onConfirm(grid: 2 | 3 | 4): Promise<void>;
  preview: string;
}>) {
  const [grid, setGrid] = useState<2 | 3 | 4>(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    setError("");
    try {
      await onConfirm(grid);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "快速分割失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-local-tool-panel" data-testid="image-split-panel">
      <strong>快速分割</strong>
      <div className="image-split-preview">
        <img alt="分割预览" src={preview} />
        <span
          aria-hidden="true"
          style={{
            backgroundImage:
              "linear-gradient(#ffffff80 1px, transparent 1px), " +
              "linear-gradient(90deg, #ffffff80 1px, transparent 1px)",
            backgroundSize: `100% ${100 / grid}%, ${100 / grid}% 100%`,
          }}
        />
      </div>
      <div>{([2, 3, 4] as const).map((value) => (
        <button
          aria-pressed={grid === value}
          key={value}
          onClick={() => setGrid(value)}
          ref={value === 2 ? firstButton : undefined}
          type="button"
        >{value}×{value}（{value ** 2}张）</button>
      ))}</div>
      <button disabled={busy} onClick={onCancel} type="button">取消</button>
      <button disabled={busy} onClick={() => void confirm()} type="button">
        {busy ? "处理中" : "确认分割"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
