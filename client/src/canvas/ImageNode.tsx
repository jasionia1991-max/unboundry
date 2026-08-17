import {
  Handle,
  NodeResizer,
  NodeToolbar,
  Position,
  useEdges,
  useNodes,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import {
  MediaLoadFallback,
  useMediaLoadRecovery,
} from "./MediaLoadFallback";
import {
  discardImageAsset,
  uploadImageAsset,
  uploadPngAsset,
} from "./imageAsset";
import { withImageReferenceInputMode } from "./imageReferenceMode";
import { fitVisualMediaSize, NODE_DEFAULT_SIZES } from "./mediaGeometry";
import { NodeModelControl } from "./NodeModelControl";
import { NodeParameterControl } from "./NodeParameterControl";
import { EmptyMediaUploadToolbar } from "./EmptyMediaUploadToolbar";
import { generationOwnershipKey, type ProbeNodeType } from "./ProbeNode";
import {
  usePublishedModelSelection,
} from "../models/ModelCatalog";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";
import { useFinishedGenerationDuration } from "../generation/useFinishedGenerationDuration";
import { GenerationDurationHint } from "./GenerationDurationHint";
import { GenerationReconcileControls } from "./GenerationReconcileControls";
import {
  useWorkflowExecution,
  type NodeRunResult,
} from "../generation/WorkflowExecutionProvider";
import { createSaveGateRun } from "../generation/saveGate";
import {
  friendlyGenerationMessage,
  generationMessageFallback,
} from "../generation/friendlyGenerationMessage";
import {
  isTransientPollingError,
  POLLING_PAUSED_MESSAGE,
  waitForGenerationTaskWithPause,
} from "../generation/taskPolling";
import {
  workflowModelSelectionProblem,
  workflowRuntimePreflightDisposition,
  workflowSubmissionPreflightProblem,
  type NodeGenerationOutcome,
  type WorkflowPreflightPhase,
} from "../generation/workflowExecution";
import { visibleGenerationError } from "../generation/generationErrors";
import {
  generationFailureMessage,
  generationInputKey as createGenerationInputKey,
  safelyRetryableGenerationTask,
} from "../generation/generationRetry";
import {
  cancelGenerationTask,
  clearGenerationSubmissionIntent,
  ensureGenerationTask,
  GENERATION_TASK_RETRY_ACCEPTED_EVENT,
  GenerationRequestError,
  getGenerationTask,
  listGenerationTasks,
  recoverPendingGenerationTask,
  reconcileGenerationTask,
  reconcileOutcomeMessage,
  retryGenerationTask,
  waitForGenerationTask,
  type GenerationTaskRetryAcceptedDetail,
  type GenerationTaskSummary,
} from "../generation/generationTasks";
import {
  defaultParameterSchema,
  defaultParameterValues,
  normalizeParameterValues,
  parameterKeysForGroups,
  submissionParameterValues,
} from "../../../types/modelParameters";
import {
  availableNodeInputRoles,
  blockedModelSwitchProblem,
  defaultNodeInputRole,
  moveNodeInputEdge,
  resolveNodeInputs,
  type NodeInputProblem,
} from "../../../types/nodeInputs";
import { UpstreamInputCards } from "./UpstreamInputCards";
import { GenerationAvailabilityNotice } from "./GenerationAvailabilityNotice";
import {
  fetchTrustedMediaMetadata,
  hasTrustedMediaDimensions,
  mediaUploadState,
  trustedMediaPatch,
} from "./mediaInputMetadata";

type CropBox = { height: number; width: number; x: number; y: number };
type ImageGenerationRun = {
  inputKey?: string;
  ownershipKey?: string;
  taskId: string;
  token: symbol;
};

function imageTaskMatchesNode(
  task: GenerationTaskSummary,
  canvasId: string,
  nodeId: string,
  taskId = task.id,
) {
  return task.id === taskId &&
    task.canvasId === canvasId &&
    task.kind === "image" &&
    task.nodeId === nodeId;
}

// 页面重载/节点重挂载时，运行中的图片任务必须由恢复逻辑继续轮询，
// 否则服务端已成功的结果要等下一次刷新才会显示。同一任务只允许一个
// 恢复轮询器，避免重挂载产生重复轮询。
const recoveredImagePollingTasks = new Map<string, symbol>();
type CropRatio = "原图" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9" | "自定义";
type MultiAngle = { rotation: number; scale: number; tilt: number; wide: boolean };
type RedrawTool = "brush" | "box" | "erase";

const imageQualityLabels: Record<string, string> = {
  auto: "自动",
  high: "高",
  "1k": "1K",
  "2k": "2K",
  "3k": "3K",
  "4k": "4K",
  low: "低",
  medium: "中",
};

const commonImageQualities = [
  "auto",
  "low",
  "medium",
  "high",
  "1k",
  "2k",
  "3k",
  "4k",
];

const commonImageAspectRatios = [
  "auto",
  "1:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
];

function completeImageOptions(common: string[], supported: string[]) {
  return [...common, ...supported.filter((item) => !common.includes(item))];
}

function hasReadyImageMedia(node?: ProbeNodeType) {
  return Boolean(
    node?.data.assetId &&
    node.data.imageSrc &&
    (node.data.inputState === undefined || node.data.inputState === "ready"),
  );
}

function restoreImageUploadBaseline(
  node: ProbeNodeType,
  baseline: ProbeNodeType,
) {
  return {
    ...node,
    data: {
      ...node.data,
      assetId: baseline.data.assetId,
      imageGenerationError: baseline.data.imageGenerationError,
      imageSrc: baseline.data.imageSrc,
      inputState: baseline.data.inputState ?? "ready",
      inputStateReason: baseline.data.inputStateReason,
      mediaByteSize: baseline.data.mediaByteSize,
      mediaContentType: baseline.data.mediaContentType,
      mediaDurationSeconds: baseline.data.mediaDurationSeconds,
      mediaMetadataSource: baseline.data.mediaMetadataSource,
      mediaMetadataStatus: baseline.data.mediaMetadataStatus,
      mediaStorageBackend: baseline.data.mediaStorageBackend,
    },
  };
}

function supportedImageValue(values: string[], preferred?: string) {
  if (preferred && values.includes(preferred)) return preferred;
  if (values.includes("auto")) return "auto";
  return values[0] ?? "auto";
}

function ImageParameterControl({
  aspectRatio,
  disabled,
  onAspectRatioChange,
  onQualityChange,
  quality,
  supportedAspectRatios,
  supportedQualities,
}: {
  aspectRatio: string;
  disabled: boolean;
  onAspectRatioChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  quality: string;
  supportedAspectRatios: string[];
  supportedQualities: string[];
}) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const ratioLabel = aspectRatio === "auto" ? "自适应" : aspectRatio;
  const qualityLabel = imageQualityLabels[quality] ?? quality;
  const qualities = completeImageOptions(
    commonImageQualities,
    supportedQualities,
  );
  const aspectRatios = completeImageOptions(
    commonImageAspectRatios,
    supportedAspectRatios,
  );

  return (
    <div
      className="image-parameter-control nodrag nopan"
      data-open={open ? "true" : "false"}
      ref={controlRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="图片参数"
        className="image-parameter-trigger"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {ratioLabel} · {qualityLabel}
      </button>
      {open && !disabled && (
        <div
          aria-label="图片生成参数"
          className="image-parameter-panel"
          role="dialog"
        >
          <section>
            <span className="image-parameter-label">画质</span>
            <div className="image-quality-options" role="group" aria-label="画质">
              {qualities.map((item) => (
                <button
                  aria-label={`${imageQualityLabels[item] ?? item}画质`}
                  aria-pressed={quality === item}
                  data-supported={
                    supportedQualities.includes(item) ? "true" : "false"
                  }
                  data-selected={quality === item ? "true" : "false"}
                  disabled={disabled || !supportedQualities.includes(item)}
                  key={item}
                  onClick={() => onQualityChange(item)}
                  title={
                    supportedQualities.includes(item)
                      ? undefined
                      : "当前模型不支持"
                  }
                  type="button"
                >
                  {imageQualityLabels[item] ?? item}
                </button>
              ))}
            </div>
          </section>
          <section>
            <span className="image-parameter-label">比例</span>
            <div className="image-ratio-options" role="group" aria-label="比例">
              {aspectRatios.map((item) => (
                <button
                  aria-label={item === "auto" ? "自适应比例" : `${item}比例`}
                  aria-pressed={aspectRatio === item}
                  data-supported={
                    supportedAspectRatios.includes(item) ? "true" : "false"
                  }
                  data-selected={aspectRatio === item ? "true" : "false"}
                  disabled={disabled || !supportedAspectRatios.includes(item)}
                  key={item}
                  onClick={() => onAspectRatioChange(item)}
                  title={
                    supportedAspectRatios.includes(item)
                      ? undefined
                      : "当前模型不支持"
                  }
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={item === "auto" ? "is-auto" : undefined}
                    style={{ aspectRatio: item === "auto" ? "1" : item.replace(":", " / ") }}
                  />
                  <small>{item === "auto" ? "自适应" : item}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

const cropRatios: CropRatio[] = [
  "原图",
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "21:9",
  "自定义",
];

function ImageCropEditor({
  onCancel,
  onConfirm,
  src,
  title,
}: {
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void>;
  src: string;
  title: string;
}) {
  const drag = useRef<{
    box: CropBox;
    mode: string;
    x: number;
    y: number;
  } | undefined>(undefined);
  const [box, setBox] = useState<CropBox>({
    height: 0.8,
    width: 0.8,
    x: 0.1,
    y: 0.1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [natural, setNatural] = useState({ height: 720, width: 1280 });
  const [ratio, setRatio] = useState<CropRatio>("原图");
  const [ratioOpen, setRatioOpen] = useState(false);
  const aspect = natural.width / natural.height;
  const maxWidth = Math.min(987, window.innerWidth - 80);
  const maxHeight = Math.min(552, window.innerHeight - 180);
  const stage =
    maxWidth / maxHeight > aspect
      ? { height: maxHeight, width: maxHeight * aspect }
      : { height: maxWidth / aspect, width: maxWidth };

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onCancel]);

  const chooseRatio = (next: CropRatio) => {
    setRatio(next);
    setRatioOpen(false);
    if (next === "自定义") return;
    const desired = next === "原图"
      ? aspect
      : next.split(":").map(Number).reduce((width, height) => width / height);
    const normalized = desired / aspect;
    const height = normalized >= 1 ? 0.8 / normalized : 0.8;
    const width = normalized >= 1 ? 0.8 : 0.8 * normalized;
    setBox({
      height,
      width,
      x: (1 - width) / 2,
      y: (1 - height) / 2,
    });
  };

  const moveCrop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = (event.clientX - drag.current.x) / stage.width;
    const dy = (event.clientY - drag.current.y) / stage.height;
    const start = drag.current.box;
    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));

    if (drag.current.mode === "move") {
      setBox({
        ...start,
        x: clamp(start.x + dx, 0, 1 - start.width),
        y: clamp(start.y + dy, 0, 1 - start.height),
      });
      return;
    }

    let { height, width, x, y } = start;
    if (drag.current.mode.includes("n")) {
      y = clamp(start.y + dy, 0, start.y + start.height - 0.08);
      height = start.height + start.y - y;
    }
    if (drag.current.mode.includes("s")) {
      height = clamp(start.height + dy, 0.08, 1 - start.y);
    }
    if (drag.current.mode.includes("w")) {
      x = clamp(start.x + dx, 0, start.x + start.width - 0.08);
      width = start.width + start.x - x;
    }
    if (drag.current.mode.includes("e")) {
      width = clamp(start.width + dx, 0.08, 1 - start.x);
    }
    setRatio("自定义");
    setBox({ height, width, x, y });
  };

  const confirm = async () => {
    setError("");
    setBusy(true);
    try {
      const image = new window.Image();
      image.src = src;
      await image.decode();
      const sx = Math.round(box.x * image.naturalWidth);
      const sy = Math.round(box.y * image.naturalHeight);
      const width = Math.max(1, Math.round(box.width * image.naturalWidth));
      const height = Math.max(1, Math.round(box.height * image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(
        image,
        sx,
        sy,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("裁剪失败")),
          "image/png",
        ),
      );
      await onConfirm(new File([blob], `${title || "Image"}-crop.png`, {
        type: "image/png",
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "裁剪保存失败");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      aria-label="图片裁剪"
      aria-modal="true"
      className="image-crop-overlay nodrag nopan nowheel"
      data-testid="image-crop-overlay"
      role="dialog"
    >
      <div
        className="image-crop-stage"
        data-testid="image-crop-stage"
        style={{ height: stage.height, width: stage.width }}
      >
        <img
          alt=""
          draggable={false}
          onLoad={(event) =>
            setNatural({
              height: event.currentTarget.naturalHeight,
              width: event.currentTarget.naturalWidth,
            })
          }
          src={src}
        />
        <div
          className="image-crop-selection"
          data-testid="image-crop-selection"
          onPointerDown={(event) => {
            const mode =
              (event.target as HTMLElement).dataset.cropHandle ?? "move";
            drag.current = {
              box,
              mode,
              x: event.clientX,
              y: event.clientY,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={moveCrop}
          onPointerUp={(event) => {
            drag.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          style={{
            height: `${box.height * 100}%`,
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
          }}
        >
          {["nw", "ne", "sw", "se"].map((handle) => (
            <span
              className={`image-crop-handle ${handle}`}
              data-crop-handle={handle}
              key={handle}
            />
          ))}
        </div>
      </div>
      <div className="image-crop-controls" data-testid="image-crop-controls">
        <button
          aria-label="取消裁剪"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          ×
        </button>
        <span className="image-crop-divider" />
        <span className="image-crop-ratio-wrap">
          <button
            aria-expanded={ratioOpen}
            className="image-crop-ratio"
            onClick={() => setRatioOpen((open) => !open)}
            type="button"
          >
            {ratio === "原图" ? "宽高比" : ratio}
          </button>
          {ratioOpen && (
            <div className="image-crop-ratio-menu" role="menu">
              {cropRatios.map((item) => (
                <button
                  aria-checked={ratio === item}
                  key={item}
                  onClick={() => chooseRatio(item)}
                  role="menuitemradio"
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </span>
        <button
          className="image-crop-confirm"
          disabled={busy}
          onClick={() => void confirm()}
          type="button"
        >
          <span aria-hidden="true">✓</span>
          <span>{busy ? "处理中" : "确认裁剪"}</span>
        </button>
        {error && <div className="image-crop-error" role="alert">{error}</div>}
      </div>
    </div>,
    document.body,
  );
}

function ImageMultiAnglePanel({
  onClose,
  src,
}: {
  onClose: () => void;
  src: string;
}) {
  const drag = useRef<
    { rotation: number; tilt: number; x: number; y: number } | undefined
  >(undefined);
  const [angle, setAngle] = useState<MultiAngle>({
    rotation: -30,
    scale: 0,
    tilt: 23,
    wide: false,
  });
  const reset = () =>
    setAngle({ rotation: 0, scale: 0, tilt: 0, wide: false });
  const formatAngle = (value: number) =>
    Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <div
      aria-label="图片多角度"
      className="image-multi-angle-panel nodrag nopan nowheel"
      data-testid="image-multi-angle-panel"
      role="dialog"
    >
      <header>
        <strong>拖拽方块调整角度</strong>
        <button aria-label="关闭多角度" onClick={onClose} type="button">×</button>
      </header>
      <div
        className="image-multi-angle-preview"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          drag.current = {
            rotation: angle.rotation,
            tilt: angle.tilt,
            x: event.clientX,
            y: event.clientY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const halfDegree = (value: number) => Math.round(value * 2) / 2;
          setAngle((current) => ({
            ...current,
            rotation: halfDegree(
              Math.max(
                -180,
                Math.min(
                  180,
                  drag.current!.rotation + event.clientX - drag.current!.x,
                ),
              ),
            ),
            tilt: halfDegree(
              Math.max(
                -90,
                Math.min(
                  90,
                  drag.current!.tilt - event.clientY + drag.current!.y,
                ),
              ),
            ),
          }));
        }}
        onPointerUp={(event) => {
          drag.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div
          className="image-multi-angle-cube"
          data-testid="image-multi-angle-cube"
          style={{
            transform: `rotateX(${-angle.tilt}deg) rotateY(${angle.rotation}deg) scale(${1 + angle.scale / 200})`,
          }}
        >
          <span className="image-multi-angle-guide image-multi-angle-left">L</span>
          <span className="image-multi-angle-guide image-multi-angle-bottom">B</span>
          <img alt="" draggable={false} src={src} />
        </div>
        <button className="image-multi-angle-reset" onClick={reset} type="button">
          ↻ 重置
        </button>
      </div>
      <div className="image-multi-angle-controls">
        {([
          ["rotation", "旋转", -180, 180, "°"],
          ["tilt", "倾斜", -90, 90, "°"],
          ["scale", "缩放", -100, 100, ""],
        ] as const).map(([key, label, min, max, suffix]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              aria-label={label}
              max={max}
              min={min}
              onChange={(event) =>
                setAngle((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))
              }
              type="range"
              value={angle[key]}
            />
            <output data-testid={`image-multi-angle-${key}`}>
              {formatAngle(angle[key])}{suffix}
            </output>
          </label>
        ))}
        <label className="image-multi-angle-wide">
          <span>广角镜头</span>
          <input
            checked={angle.wide}
            onChange={(event) =>
              setAngle((current) => ({ ...current, wide: event.target.checked }))
            }
            type="checkbox"
          />
        </label>
        <div className="image-multi-angle-submit">
          <button
            aria-label="生成多角度图片"
            data-tooltip="尚未接入生成服务"
            disabled
            type="button"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageRedrawEditor({
  onClose,
  src,
}: {
  onClose: () => void;
  src: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<
    | {
        image: ImageData;
        tool: RedrawTool;
        x: number;
        y: number;
      }
    | undefined
  >(undefined);
  const history = useRef<ImageData[]>([]);
  const redo = useRef<ImageData[]>([]);
  const [brushSize, setBrushSize] = useState(32);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [natural, setNatural] = useState({ height: 720, width: 1280 });
  const [prompt, setPrompt] = useState("");
  const [tool, setTool] = useState<RedrawTool>("brush");
  const promptControl = useCompositionSafeText({
    onCommit: setPrompt,
    value: prompt,
  });
  const aspect = natural.width / natural.height;
  const maxWidth = Math.min(786.72, window.innerWidth - 80);
  const maxHeight = Math.min(440, window.innerHeight - 280);
  const stage =
    maxWidth / maxHeight > aspect
      ? { height: maxHeight, width: maxHeight * aspect }
      : { height: maxWidth / aspect, width: maxWidth };
  const stageTop = Math.max(
    80,
    Math.min(140, window.innerHeight - stage.height - 140),
  );

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = natural.width;
    canvas.height = natural.height;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    history.current = [];
    redo.current = [];
    setHistoryVersion((version) => version + 1);
  }, [natural.height, natural.width]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  const beginDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    const start = point(event);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    history.current.push(image);
    redo.current = [];
    drawRef.current = { image, tool, ...start };
    canvas.setPointerCapture(event.pointerId);
    if (tool !== "box") {
      context.beginPath();
      context.moveTo(start.x, start.y);
    }
    setHistoryVersion((version) => version + 1);
  };

  const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drawing = drawRef.current;
    const context = event.currentTarget.getContext("2d");
    if (!drawing || !context) return;
    const current = point(event);
    const scale = event.currentTarget.width /
      event.currentTarget.getBoundingClientRect().width;

    if (drawing.tool === "box") {
      context.putImageData(drawing.image, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "rgba(72, 153, 255, 0.5)";
      context.fillRect(
        drawing.x,
        drawing.y,
        current.x - drawing.x,
        current.y - drawing.y,
      );
      return;
    }

    context.globalCompositeOperation =
      drawing.tool === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "rgba(72, 153, 255, 0.62)";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize * scale;
    context.lineTo(current.x, current.y);
    context.stroke();
  };

  const finishDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawRef.current) return;
    drawRef.current = undefined;
    event.currentTarget.getContext("2d")!.globalCompositeOperation = "source-over";
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const restore = (
    from: { current: ImageData[] },
    to: { current: ImageData[] },
  ) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const image = from.current.pop();
    if (!canvas || !context || !image) return;
    to.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    context.putImageData(image, 0, 0);
    setHistoryVersion((version) => version + 1);
  };

  return createPortal(
    <div
      aria-label="图片重绘"
      aria-modal="true"
      className="image-redraw-overlay nodrag nopan nowheel"
      data-testid="image-redraw-overlay"
      role="dialog"
    >
      <div
        className="image-redraw-stage"
        data-testid="image-redraw-stage"
        style={{
          height: stage.height,
          top: stageTop,
          width: stage.width,
        }}
      >
        <img
          alt=""
          draggable={false}
          onLoad={(event) =>
            setNatural({
              height: event.currentTarget.naturalHeight,
              width: event.currentTarget.naturalWidth,
            })
          }
          src={src}
        />
        <canvas
          aria-label="重绘蒙版"
          data-testid="image-redraw-canvas"
          onPointerDown={beginDraw}
          onPointerMove={moveDraw}
          onPointerUp={finishDraw}
          ref={canvasRef}
        />
      </div>
      <div
        className="image-redraw-toolbar"
        data-testid="image-redraw-toolbar"
        style={{ top: stageTop - 64 }}
      >
        <button aria-label="取消重绘" onClick={onClose} type="button">×</button>
        <span className="image-redraw-divider" />
        <span className="image-redraw-tools">
          {([
            ["brush", "画笔"],
            ["box", "框选"],
            ["erase", "橡皮"],
          ] as const).map(([value, label]) => (
            <button
              aria-label={label}
              aria-pressed={tool === value}
              key={value}
              onClick={() => setTool(value)}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                {value === "brush" && (
                  <>
                    <path d="M4 16c2.2.2 3.6-.7 4-2.6.4-1.8 1.5-2.3 2.8-1" />
                    <path d="m9.8 12.8 6.5-7a1.7 1.7 0 0 0-2.4-2.4l-6.4 7Z" />
                  </>
                )}
                {value === "box" && <rect height="12" rx="1.5" width="12" x="4" y="4" />}
                {value === "erase" && (
                  <>
                    <path d="m5.2 13.5 7.7-8.3a1.8 1.8 0 0 1 2.6 0l1.1 1.1a1.8 1.8 0 0 1 0 2.5l-6.2 6.7H7.1Z" />
                    <path d="M10.4 15.5H17M9 9.5l3.7 3.4" />
                  </>
                )}
              </svg>
            </button>
          ))}
        </span>
        <span className="image-redraw-brush-mark">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M11.8 2.5c-4 3.6 1.3 5.7-2.4 9.1-2.2 2-1.6 3.9-.2 5.9" />
          </svg>
        </span>
        <input
          aria-label="画笔大小"
          max="80"
          min="5"
          onChange={(event) => setBrushSize(Number(event.target.value))}
          type="range"
          value={brushSize}
        />
        <span className="image-redraw-divider" />
        <button
          aria-label="撤销蒙版"
          disabled={!history.current.length}
          onClick={() => restore(history, redo)}
          type="button"
        >
          ↶
        </button>
        <button
          aria-label="恢复蒙版"
          disabled={!redo.current.length}
          onClick={() => restore(redo, history)}
          type="button"
        >
          ↷
        </button>
        <span hidden>{historyVersion}</span>
      </div>
      <div
        className="image-redraw-prompt"
        data-testid="image-redraw-prompt"
        style={{ top: stageTop + stage.height + 8 }}
      >
        <textarea
          aria-label="重绘提示词"
          data-composition-active={promptControl.composing || undefined}
          onBlur={() => promptControl.blur()}
          onChange={(event) =>
            promptControl.change(
              event.target.value,
              (event.nativeEvent as InputEvent).isComposing,
            )
          }
          onCompositionEnd={(event) =>
            promptControl.compositionEnd(event.currentTarget.value)
          }
          onCompositionStart={() => promptControl.compositionStart()}
          onKeyDown={(event) => {
            promptControl.keyDown(event);
          }}
          placeholder="描述你想改变什么..."
          value={promptControl.value}
        />
        <div>
          <span aria-hidden="true">⌕</span>
          <span>绘制蒙版以重绘</span>
          <span className="image-redraw-prompt-spacer" />
          <button type="button">1K</button>
          <button type="button">x1</button>
          <button type="button">PRO</button>
          <button aria-label="提交重绘" disabled type="button">↑</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ImageLightingPanel({
  onClose,
  src,
}: {
  onClose: () => void;
  src: string;
}) {
  const [brightness, setBrightness] = useState(50);
  const [direction, setDirection] = useState("前方");
  const [front, setFront] = useState(false);
  const [rimLight, setRimLight] = useState(true);
  const [temperature, setTemperature] = useState(5600);
  const lightPosition: Record<string, [number, number]> = {
    左侧: [19, 50],
    顶部: [50, 17],
    右侧: [81, 50],
    前方: [72, 26],
    底部: [50, 83],
    后方: [28, 72],
  };
  const [lightX, lightY] = lightPosition[direction];
  const reset = () => {
    setBrightness(50);
    setDirection("前方");
    setFront(false);
    setRimLight(true);
    setTemperature(5600);
  };

  return (
    <div
      aria-label="图片打光"
      className="image-lighting-panel nodrag nopan nowheel"
      data-testid="image-lighting-panel"
      role="dialog"
    >
      <div className="image-lighting-preview">
        <div className="image-lighting-view-tabs">
          <button
            aria-pressed={!front}
            onClick={() => setFront(false)}
            type="button"
          >
            透视
          </button>
          <button
            aria-pressed={front}
            onClick={() => setFront(true)}
            type="button"
          >
            正面
          </button>
        </div>
        <div className="image-lighting-orbit">
          <span
            className="image-lighting-beam"
            style={{
              rotate: `${Math.atan2(50 - lightY, 50 - lightX) * 180 / Math.PI}deg`,
              width: `${Math.hypot(50 - lightX, 50 - lightY)}%`,
            }}
          />
          <span
            className="image-lighting-source"
            data-testid="image-lighting-source"
            style={{ left: `${lightX}%`, top: `${lightY}%` }}
          />
          <div
            className="image-lighting-image"
            data-front={front ? "true" : undefined}
            style={{
              filter: `brightness(${0.6 + brightness / 100}) sepia(${Math.abs(5600 - temperature) / 9000})`,
            }}
          >
            <img alt="" draggable={false} src={src} />
          </div>
        </div>
        <span className="image-lighting-source-label">主光源</span>
        <button className="image-lighting-reset" onClick={reset} type="button">
          ↻ 重置
        </button>
      </div>
      <div className="image-lighting-controls">
        <header>
          <strong>全局</strong>
          <button aria-label="关闭打光" onClick={onClose} type="button">×</button>
        </header>
        <label className="image-lighting-slider">
          <span>亮度</span>
          <input
            aria-label="亮度"
            max="100"
            min="0"
            onChange={(event) => setBrightness(Number(event.target.value))}
            type="range"
            value={brightness}
          />
          <output data-testid="image-lighting-brightness">☼ {brightness} %</output>
        </label>
        <label className="image-lighting-slider image-lighting-temperature">
          <span>色温</span>
          <input
            aria-label="色温"
            max="8000"
            min="3000"
            onChange={(event) => setTemperature(Number(event.target.value))}
            step="100"
            type="range"
            value={temperature}
          />
          <output data-testid="image-lighting-temperature">♨ {temperature} K</output>
        </label>
        <span className="image-lighting-rule" />
        <fieldset>
          <legend>主光源</legend>
          <div className="image-lighting-directions">
            {["左侧", "顶部", "右侧", "前方", "底部", "后方"].map((item) => (
              <button
                aria-pressed={direction === item}
                key={item}
                onClick={() => setDirection(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="image-lighting-rim">
          <span>轮廓光 <small>?</small></span>
          <input
            aria-label="轮廓光"
            checked={rimLight}
            onChange={(event) => setRimLight(event.target.checked)}
            type="checkbox"
          />
        </label>
        <div className="image-lighting-submit">
          <button
            aria-label="生成打光图片"
            data-tooltip="尚未接入生成服务"
            disabled
            type="button"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageNodeImpl({
  data,
  dragging,
  id,
  parentId,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const mediaLoad = useMediaLoadRecovery(data.imageSrc);
  const inputRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const uploadInFlight = useRef(false);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadOperation = useRef(0);
  const deferredPreviewAutoFit = useRef<{
    height: number;
    width: number;
  } | undefined>(undefined);
  const { getEdges, getNode, getNodes } = useReactFlow<ProbeNodeType>();
  const { register: registerWorkflowNode } = useWorkflowExecution();
  const { setEdges, setNodes, tryAdoptNodes } = useCanvasGraphMutation();
  const canvasEdges = useEdges();
  const canvasNodes = useNodes<ProbeNodeType>();
  const checkpoint = useCanvasCheckpoint();
  const promptControl = useCompositionSafeText({
    onCommit: (nextPrompt) => {
      if (nextPrompt === (data.imagePrompt ?? "")) return;
      generationRunRef.current = undefined;
      setActiveTaskId(undefined);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      setRetryTaskId(undefined);
      setServerInputProblems([]);
      setUploadError("");
      clearGenerationSubmissionIntent(
        "image",
        canvasId,
        id,
        data.imageGenerationTaskId,
        accountId,
      );
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  imageGenerationError: undefined,
                  imageGenerationErrorCode: undefined,
                  imageGenerationInputKey: undefined,
                  imageGenerationOwnershipKey: undefined,
                  imageGenerating: false,
                  imageGenerationRetryAllowed: undefined,
                  imageGenerationRetryBlockCode: undefined,
                  imageGenerationRetryBlockReason: undefined,
                  imageGenerationTaskId: undefined,
                  imagePrompt: nextPrompt,
                },
              }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: data.imagePrompt ?? "",
  });
  const titleControl = useCompositionSafeText({
    onCommit: (nextTitle) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, title: nextTitle } }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: data.title ?? "Image",
  });
  const {
    accountId,
    canvasId,
    canvasRevision,
    flushCanvasSave,
    isFixture,
    persistenceReady,
    retryGenerationEnabled,
    waitForCanvasRevision,
  } = useGenerationCanvas();
  const finishedDurationLabel = useFinishedGenerationDuration(
    data.imageGenerationTaskId,
    singleNodeChrome && !data.imageGenerating,
    { canvasId, nodeId: id },
  );
  const mediaAdoptionScopeRef = useRef(`${accountId}\u0000${canvasId}`);
  mediaAdoptionScopeRef.current = `${accountId}\u0000${canvasId}`;
  const persistenceReadyLive = useRef(persistenceReady);
  persistenceReadyLive.current = persistenceReady;
  const imageModelSelection = usePublishedModelSelection(
    "image",
    data.imageModelId,
    data.imageModelName,
  );
  const imageModels = imageModelSelection.models;
  const selectedImageModel = imageModelSelection.model;
  const selectedImageModelId = imageModelSelection.selectedId;
  const imageModelUnavailableReason = imageModelSelection.unavailableReason;
  const imageParameterSchema = selectedImageModel?.parameterSchema ??
    defaultParameterSchema("image");
  const imageParameters = selectedImageModel?.imageParameters ?? {
    aspectRatios: ["auto"],
    maxReferenceImages: 0,
    qualities: ["auto"],
  };
  const imageParameterValues = selectedImageModel
    ? normalizeParameterValues(imageParameterSchema, {
        ...data.imageParameters,
        ...(data.imageAspectRatio ? { aspectRatio: data.imageAspectRatio } : {}),
        ...(data.imageQuality ? { quality: data.imageQuality } : {}),
      })
    : {};
  const imageExtraParameterKeys = parameterKeysForGroups(
    imageParameterSchema,
    ["input", "main", "advanced", "output"],
    ["aspectRatio", "quality", "outputCount"],
  );
  const imageCountParameterKeys = imageParameterSchema.fields.some((field) => field.key === "outputCount")
    ? ["outputCount"]
    : [];
  const aspectRatio = supportedImageValue(
    imageParameters.aspectRatios,
    String(imageParameterValues.aspectRatio ?? data.imageAspectRatio ?? ""),
  );
  const quality = supportedImageValue(
    imageParameters.qualities,
    String(imageParameterValues.quality ?? data.imageQuality ?? ""),
  );
  const effectiveImageParameters = selectedImageModel
    ? {
        ...imageParameterValues,
        aspectRatio,
        quality,
      }
    : {};
  const imageSubmissionParameterValues = selectedImageModel
    ? submissionParameterValues(imageParameterSchema, effectiveImageParameters)
    : {};
  const generatedSuccess = Boolean(data.imageGeneratedSuccess);
  const generating = Boolean(data.imageGenerating);
  const preview = data.imageSrc;
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [multiAngleOpen, setMultiAngleOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [retryTaskId, setRetryTaskId] = useState<string>();
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileNeedsTaskId, setReconcileNeedsTaskId] = useState(false);
  const [reconcileProviderTaskId, setReconcileProviderTaskId] = useState("");
  const [reconcileConfirmedMissing, setReconcileConfirmedMissing] = useState(false);
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
  const [unverifiedRecoveryTaskId, setUnverifiedRecoveryTaskId] =
    useState<string>();
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const generationRunRef = useRef<ImageGenerationRun | undefined>(undefined);
  const liveGenerationInputKeyRef = useRef<string | undefined>(undefined);
  const liveGenerationOwnershipKeyRef = useRef<string | undefined>(undefined);
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const [retryWakeEpoch, setRetryWakeEpoch] = useState(0);
  const [uploadError, setUploadError] = useState(
    visibleGenerationError(data.imageGenerationError),
  );
  const [transientUploadError, setTransientUploadError] = useState("");
  const uploading = data.inputState === "uploading";
  const referenceLimit = imageParameters.maxReferenceImages ?? 0;
  const imageInputSchema = selectedImageModel
    ? {
        ...imageParameterSchema,
        referenceInputs: {
          ...imageParameterSchema.referenceInputs,
          image: referenceLimit,
        },
      }
    : undefined;
  const inputPreflight = resolveNodeInputs({
    edges: canvasEdges,
    modelSchema: imageInputSchema,
    nodes: canvasNodes,
    ownPrompt: promptControl.committedValue,
    parameters: imageSubmissionParameterValues,
    targetId: id,
    targetKind: "image",
  });
  const modelSelectionProblem = workflowModelSelectionProblem({
    isFixture,
    kind: "image",
    model: selectedImageModel,
    status: imageModelSelection.status,
    unavailableReason: imageModelUnavailableReason,
  });
  const inputProblems: NodeInputProblem[] = [
    ...(modelSwitchProblem
      ? [{ code: "MODEL_UNSUPPORTED" as const, message: modelSwitchProblem }]
      : []),
    ...inputPreflight.problems,
    ...serverInputProblems,
  ];
  const workflowProblems: NodeInputProblem[] = [
    ...(modelSelectionProblem ? [modelSelectionProblem] : []),
    ...inputProblems,
  ];
  const inputFeedbackKey = JSON.stringify({
    edges: inputPreflight.inputs.map((input) => ({
      assetId: input.assetId,
      edgeId: input.edgeId,
      order: input.order,
      role: input.role,
      sourceNodeId: input.sourceNodeId,
      state: input.state,
    })),
    model: selectedImageModel?.id,
    parameters: imageSubmissionParameterValues,
    prompt: promptControl.committedValue,
    revision: canvasRevision,
  });
  const imageGenerationInputKey = createGenerationInputKey({
    inputs: inputPreflight.inputs,
    modelId: selectedImageModelId,
    ownPrompt: promptControl.committedValue,
    parameters: imageSubmissionParameterValues,
    prompt: inputPreflight.finalPrompt,
  });
  const generationOwnershipUpstream = inputPreflight.inputs.map((input) => {
      const edge = canvasEdges.find((candidate) =>
        candidate.id === input.edgeId
      );
      return {
        assetId: input.kind === "text" ? undefined : input.assetId,
        edgeId: input.edgeId,
        metadataStatus: input.metadataStatus,
        order: input.order,
        ready: input.state === "ready",
        role: typeof edge?.data?.inputRole === "string"
          ? edge.data.inputRole
          : defaultNodeInputRole(input.kind, "image"),
        source: input.sourceNodeId,
        sourceKind: input.kind,
        src: input.kind === "text" ? undefined : input.preview,
        status: input.state,
        text: input.kind === "text" ? input.text : undefined,
      };
    });
  const effectiveGenerationInputFingerprint = generationOwnershipKey({
    aspectRatio: selectedImageModel ? aspectRatio : data.imageAspectRatio,
    modelId: selectedImageModelId,
    parameters: selectedImageModel
      ? effectiveImageParameters
      : data.imageParameters,
    prompt: promptControl.committedValue,
    quality: selectedImageModel ? quality : data.imageQuality,
    upstream: generationOwnershipUpstream,
  });
  const rawGenerationInputFingerprint = generationOwnershipKey({
    // Once a task is ownership-bound, catalog changes must not reinterpret its
    // saved full model snapshot. Before admission, use the effective values
    // materialized and ACKed on the canvas below.
    aspectRatio: data.imageGenerationOwnershipKey
      ? data.imageAspectRatio
      : selectedImageModel
        ? aspectRatio
        : data.imageAspectRatio,
    modelId: data.imageGenerationOwnershipKey
      ? data.imageModelId
      : selectedImageModelId,
    parameters: data.imageGenerationOwnershipKey
      ? data.imageParameters
      : selectedImageModel
        ? effectiveImageParameters
        : data.imageParameters,
    prompt: promptControl.committedValue,
    quality: data.imageGenerationOwnershipKey
      ? data.imageQuality
      : selectedImageModel
        ? quality
        : data.imageQuality,
    // Only durable source/edge semantics belong here. Compatibility, resolver
    // reasons, and resolved roles can drift with the model catalog.
    upstream: generationOwnershipUpstream,
  });
  liveGenerationInputKeyRef.current = imageGenerationInputKey;
  liveGenerationOwnershipKeyRef.current = rawGenerationInputFingerprint;
  const beginImageGenerationRun = (
    taskId: string,
    inputKey?: string,
    ownershipKey?: string,
  ): ImageGenerationRun => {
    const run = { inputKey, ownershipKey, taskId, token: Symbol(taskId) };
    generationRunRef.current = run;
    setActiveTaskId(taskId);
    return run;
  };
  const ownsImageGenerationRun = (run: ImageGenerationRun) =>
    generationRunRef.current === run &&
    (run.ownershipKey === undefined ||
      liveGenerationOwnershipKeyRef.current === run.ownershipKey);
  const endImageGenerationRun = (run: ImageGenerationRun) => {
    if (generationRunRef.current !== run) return;
    generationRunRef.current = undefined;
    setActiveTaskId((current) =>
      current === run.taskId ? undefined : current,
    );
  };
  // 只有“当前输入”对应的生成结果才视为已完成；改提示词/参数/参考后允许重新生成。
  const generatedForCurrentInput = Boolean(
    data.imageGeneratedSuccess &&
    data.imageGenerationInputKey === imageGenerationInputKey,
  );
  const stableRawGenerationInputFingerprint = useRef<string | undefined>(
    undefined,
  );
  const legacyRecoveryCatalogKey = data.imageGenerationOwnershipKey
    ? "ownership-bound"
    : `${imageModelSelection.status}:${selectedImageModelId ?? ""}:${imageGenerationInputKey}`;

  useEffect(() => {
    setModelSwitchProblem("");
  }, [canvasEdges]);

  useEffect(() => {
    setUploadError(
      data.inputState === "invalid" && data.inputStateReason
        ? data.inputStateReason
        : visibleGenerationError(data.imageGenerationError),
    );
  }, [data.imageGenerationError, data.inputState, data.inputStateReason]);

  useEffect(() => {
    const wakeAcceptedRetry = (event: Event) => {
      const detail = (event as CustomEvent<GenerationTaskRetryAcceptedDetail>)
        .detail;
      if (
        detail?.canvasId === canvasId &&
        detail.nodeId === id &&
        detail.kind === "image" &&
        detail.taskId === data.imageGenerationTaskId
      ) {
        setRetryWakeEpoch((current) => current + 1);
      }
    };
    window.addEventListener(
      GENERATION_TASK_RETRY_ACCEPTED_EVENT,
      wakeAcceptedRetry,
    );
    return () => window.removeEventListener(
      GENERATION_TASK_RETRY_ACCEPTED_EVENT,
      wakeAcceptedRetry,
    );
  }, [canvasId, data.imageGenerationTaskId, id]);

  useEffect(() => {
    if (!persistenceReady) {
      stableRawGenerationInputFingerprint.current = undefined;
      return;
    }
    const previous = stableRawGenerationInputFingerprint.current;
    stableRawGenerationInputFingerprint.current = rawGenerationInputFingerprint;
    const persistedMismatch = Boolean(
      data.imageGenerationOwnershipKey &&
      data.imageGenerationOwnershipKey !== rawGenerationInputFingerprint,
    );
    if (
      !persistedMismatch &&
      (previous === undefined || previous === rawGenerationInputFingerprint)
    ) {
      return;
    }
    if (
      !data.imageGenerating &&
      !data.imageGenerationTaskId &&
      !data.imageGenerationInputKey &&
      !data.imageGenerationOwnershipKey
    ) return;
    generationRunRef.current = undefined;
    setActiveTaskId(undefined);
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setRetryTaskId(undefined);
    setServerInputProblems([]);
    setUploadError("");
    clearGenerationSubmissionIntent("image", canvasId, id, undefined, accountId);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            imageGenerationError: undefined,
            imageGenerationErrorCode: undefined,
            imageGenerationInputKey: undefined,
            imageGenerationOwnershipKey: undefined,
            imageGenerating: false,
            imageGenerationRetryAllowed: undefined,
            imageGenerationRetryBlockCode: undefined,
            imageGenerationRetryBlockReason: undefined,
            imageGenerationTaskId: undefined,
          },
        }
      : node));
  }, [
    accountId,
    canvasId,
    data.imageGenerating,
    data.imageGenerationInputKey,
    data.imageGenerationOwnershipKey,
    data.imageGenerationTaskId,
    id,
    persistenceReady,
    rawGenerationInputFingerprint,
    setNodes,
  ]);

  useEffect(() => {
    setServerInputProblems([]);
  }, [inputFeedbackKey]);

  useEffect(() => {
    if (
      !persistenceReady ||
      data.inputState !== "uploading" ||
      uploadInFlight.current
    ) return;
    const message = "上传已中断，请重新上传";
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            ...mediaUploadState("invalid", message),
          },
        }
      : node));
  }, [data.inputState, id, persistenceReady, setNodes]);

  useEffect(() => {
    if (!uploadInFlight.current || data.inputState === "uploading") return;
    uploadOperation.current += 1;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, [data.inputState]);

  useEffect(() => {
    if (persistenceReady || !uploadInFlight.current) return;
    uploadOperation.current += 1;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, [persistenceReady]);

  useEffect(() => () => {
    uploadOperation.current += 1;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, []);

  useEffect(() => {
    if (
      !persistenceReady ||
      isFixture ||
      !data.assetId ||
      !data.imageSrc ||
      data.mediaMetadataSource === "server" ||
      data.inputState === "uploading" ||
      data.inputState === "invalid"
    ) return;
    const controller = new AbortController();
    void fetchTrustedMediaMetadata("image", data.assetId, controller.signal)
      .then((metadata) => {
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...trustedMediaPatch(metadata),
              },
            }
          : node));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error
          ? error.message
          : "服务端无法确认图片素材信息";
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...mediaUploadState("invalid", message),
              },
            }
          : node));
      });
    return () => controller.abort();
  }, [
    canvasId,
    data.assetId,
    data.imageSrc,
    data.inputState,
    data.mediaMetadataSource,
    id,
    persistenceReady,
    setNodes,
  ]);
  const incomingImageReferences = inputPreflight.inputs
    .filter((input) => input.kind === "image" && input.preview)
    .map((input) => ({
      assetId: input.assetId ?? "",
      edgeId: input.edgeId,
      sourceNodeId: input.sourceNodeId,
      src: input.preview ?? "",
      title: input.title,
    }));
  const referencesSupported =
    inputProblems.length === 0 &&
    incomingImageReferences.every((reference) => Boolean(reference.assetId));
  const referenceProblem = inputProblems[0]?.message ?? "";
  const imageGenerationRequestInput = {
    canvasId,
    canvasRevision,
    inputSchemaVersion: 1 as const,
    inputs: inputPreflight.snapshot,
    model: selectedImageModelId,
    nodeId: id,
    ownPrompt: promptControl.committedValue,
    parameters: {
      ...imageSubmissionParameterValues,
      references: incomingImageReferences.map((reference) => ({
        assetId: reference.assetId,
        kind: "image" as const,
        sourceNodeId: reference.sourceNodeId,
      })),
    },
    prompt: inputPreflight.finalPrompt,
  };
  const retryAvailable = Boolean(
    retryTaskId &&
    data.imageGenerationInputKey === imageGenerationInputKey &&
    (!data.imageGenerationOwnershipKey ||
      data.imageGenerationOwnershipKey === rawGenerationInputFingerprint) &&
    data.imageGenerationRetryAllowed === true &&
    selectedImageModel &&
    selectedImageModel.generationAvailable !== false,
  );
  const showImageRetry = retryAvailable && (
    reconcileConfirmedMissing ||
    data.imageGenerationErrorCode === "PROVIDER_RESULT_MISSING" ||
    data.imageGenerationErrorCode === "PROVIDER_FAILED"
  );
  const canReconcileImage = Boolean(
    data.imageGenerationTaskId &&
    data.imageGenerationError &&
    !generating &&
    !isFixture,
  );

  const clearImageIntentAfterDurableTerminalPatch = (taskId: string) => {
    void (async () => {
      try {
        await flushCanvasSave();
        clearGenerationSubmissionIntent(
          "image",
          canvasId,
          id,
          taskId,
          accountId,
        );
      } catch {
        // Keep the intent for exact-GET recovery when the canvas ACK is lost.
      }
    })();
  };

  const persistImageGenerationFailure = (
    taskId: string,
    run: ImageGenerationRun,
    message: string,
    errorCode: string | undefined,
    retryAllowed: boolean,
    retryBlockCode?: string,
    retryBlockReason?: string,
  ) => {
    if (!ownsImageGenerationRun(run) || run.taskId !== taskId) return false;
    const visibleMessage = generationFailureMessage(
      message,
      retryAllowed ? undefined : retryBlockReason,
      errorCode,
      "image",
    );
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                imageGenerationError: visibleMessage,
                imageGenerationErrorCode: errorCode,
                imageGenerationInputKey:
                  run.inputKey ?? node.data.imageGenerationInputKey,
                imageGenerationOwnershipKey:
                  run.ownershipKey ?? node.data.imageGenerationOwnershipKey,
                imageGenerating: false,
                imageGenerationRetryAllowed: retryAllowed,
                imageGenerationRetryBlockCode: retryBlockCode,
                imageGenerationRetryBlockReason: retryBlockReason,
                imageGenerationTaskId: taskId,
              },
            }
          : node,
      ),
    );
    setUploadError(visibleMessage);
    setRetryTaskId(retryAllowed ? taskId : undefined);
    clearImageIntentAfterDurableTerminalPatch(taskId);
    endImageGenerationRun(run);
    return true;
  };

  const persistImageGenerationCancellation = (
    taskId: string,
    run: ImageGenerationRun,
    message: string,
  ) => {
    if (!ownsImageGenerationRun(run) || run.taskId !== taskId) return false;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                imageGenerationError: message,
                imageGenerationErrorCode: undefined,
                imageGenerationInputKey: undefined,
                imageGenerationOwnershipKey: undefined,
                imageGenerating: false,
                imageGenerationRetryAllowed: undefined,
                imageGenerationRetryBlockCode: undefined,
                imageGenerationRetryBlockReason: undefined,
                imageGenerationTaskId: undefined,
              },
            }
          : node,
      ),
    );
    setUploadError(message);
    setRetryTaskId(undefined);
    clearImageIntentAfterDurableTerminalPatch(taskId);
    endImageGenerationRun(run);
    return true;
  };

  const applyGeneratedImage = async (
    task: GenerationTaskSummary,
    run: ImageGenerationRun,
  ) => {
    if (
      !ownsImageGenerationRun(run) ||
      !imageTaskMatchesNode(task, canvasId, id, run.taskId)
    ) return false;
    if (task.state !== "success" || !task.resultAssetId || !task.resultUrl) {
      throw new Error(task.errorMessage ?? "图片生成失败，请稍后再试");
    }
    checkpoint(false);
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              height: undefined,
              measured: undefined,
              style: { ...node.style, ...NODE_DEFAULT_SIZES.image },
              width: undefined,
              data: {
                ...node.data,
                assetId: task.resultAssetId,
                ...(task.resultMedia
                  ? trustedMediaPatch({
                      assetId: task.resultAssetId!,
                      kind: "image",
                      ...task.resultMedia,
                    })
                  : {}),
                imageGeneratedSuccess: true,
                imageGenerationError: undefined,
                imageGenerationErrorCode: undefined,
                imageGenerating: false,
                imageGenerationRetryAllowed: undefined,
                imageGenerationRetryBlockCode: undefined,
                imageGenerationRetryBlockReason: undefined,
                imageGenerationTaskId: undefined,
                imageSrc: task.resultUrl,
              },
            }
          : node,
      ),
    );
    await flushCanvasSave();
    clearGenerationSubmissionIntent("image", canvasId, id, task.id, accountId);
    endImageGenerationRun(run);
    return true;
  };

  const generateImage = async (): Promise<NodeGenerationOutcome> => {
    const cleanPrompt = inputPreflight.finalPrompt;
    if (
      !cleanPrompt ||
      generating ||
      submitting ||
      isFixture ||
      canvasRevision === undefined ||
      !selectedImageModel ||
      selectedImageModel.generationAvailable === false ||
      !referencesSupported
    ) return { status: "skipped" };
    setUploadError("");
    setServerInputProblems([]);
    setRetryTaskId(undefined);
    setSubmitting(true);
    let submittedTaskId: string | undefined;
    let generationRun: ImageGenerationRun | undefined;
    let bindingPersisted = false;
    const requestedGenerationInputKey = imageGenerationInputKey;
    const requestedGenerationOwnershipKey =
      effectiveGenerationInputFingerprint;
    const requestedModelId = selectedImageModelId;
    const requestedModelName = imageModelSelection.displayName;
    const requestedParameters = { ...effectiveImageParameters };
    try {
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              imageAspectRatio: aspectRatio,
              imageModelId: requestedModelId,
              imageModelName: requestedModelName,
              imageParameters: requestedParameters,
              imageQuality: quality,
            },
          }
        : node));
      const freshCanvasRevision = await waitForCanvasRevision();
      if (
        liveGenerationOwnershipKeyRef.current !== requestedGenerationOwnershipKey
      ) {
        return {
          message: "生成输入已修改，已停止本次生成",
          status: "failed",
        };
      }
      const {
        generationOwnershipKey: persistedGenerationOwnershipKey,
        task: submitted,
      } = await ensureGenerationTask(
        "image",
        {
          ...imageGenerationRequestInput,
          canvasRevision: freshCanvasRevision,
        },
        accountId,
        () => {
          if (
            liveGenerationOwnershipKeyRef.current !==
              requestedGenerationOwnershipKey
          ) {
            throw new Error("生成输入已修改，已停止本次生成");
          }
        },
        { generationOwnershipKey: requestedGenerationOwnershipKey },
      );
      submittedTaskId = submitted.id;
      if (
        liveGenerationOwnershipKeyRef.current !== requestedGenerationOwnershipKey
      ) {
        clearGenerationSubmissionIntent(
          "image",
          canvasId,
          id,
          submitted.id,
          accountId,
        );
        return {
          message: "生成输入已修改，旧任务结果不会覆盖当前内容",
          status: "failed",
        };
      }
      generationRun = beginImageGenerationRun(
        submitted.id,
        requestedGenerationInputKey,
        requestedGenerationOwnershipKey,
      );
      checkpoint();
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  imageGeneratedSuccess: false,
                  imageGenerationError: undefined,
                  imageGenerationErrorCode: undefined,
                  imageGenerationInputKey,
                  imageGenerationOwnershipKey:
                    persistedGenerationOwnershipKey ??
                    requestedGenerationOwnershipKey,
                  imageGenerating: true,
                  imageGenerationRetryAllowed: undefined,
                  imageGenerationRetryBlockCode: undefined,
                  imageGenerationRetryBlockReason: undefined,
                  imageGenerationTaskId: submitted.id,
                  imageAspectRatio: aspectRatio,
                  imageModelId: requestedModelId,
                  imageModelName: requestedModelName,
                  imageParameters: requestedParameters,
                  imageQuality: quality,
                },
              }
          : node,
        ),
      );
      await flushCanvasSave();
      bindingPersisted = true;
      if (
        !generationRun ||
        !ownsImageGenerationRun(generationRun) ||
        liveGenerationOwnershipKeyRef.current !==
          requestedGenerationOwnershipKey
      ) {
        return {
          message: "生成输入已修改，旧任务结果不会覆盖当前内容",
          status: "failed",
        };
      }
      // Submission is complete once the durable task id has been persisted.
      // Keep polling under imageGenerating so the same button can safely
      // cancel that task instead of remaining disabled for the whole run.
      setSubmitting(false);
      let task: Awaited<ReturnType<typeof waitForGenerationTask>>;
      try {
        task = await waitForGenerationTaskWithPause(submitted.id, () => {
          if (
            !generationRun ||
            !ownsImageGenerationRun(generationRun)
          ) return;
          pollingPausedTaskIdRef.current = submitted.id;
          setPollingPausedTaskId(submitted.id);
          setUploadError(POLLING_PAUSED_MESSAGE);
        });
      } catch (error) {
        if (
          !generationRun ||
          !ownsImageGenerationRun(generationRun)
        ) return { status: "skipped" };
        if (pollingPausedTaskIdRef.current === submitted.id) {
          return { message: POLLING_PAUSED_MESSAGE, status: "failed" };
        }
        throw error;
      }
      if (!generationRun || !ownsImageGenerationRun(generationRun)) {
        return { status: "skipped" };
      }
      if (task.state === "cancelled") {
        const message = task.errorMessage ?? "图片生成已取消";
        persistImageGenerationCancellation(task.id, generationRun, message);
        return {
          message: friendlyGenerationMessage(message, "image"),
          status: "failed",
        };
      }
      if (task.state !== "success") {
        persistImageGenerationFailure(
          task.id,
          generationRun,
          friendlyGenerationMessage(
            task.errorMessage,
            "image",
          ),
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return {
          message: friendlyGenerationMessage(task.errorMessage, "image"),
          status: "failed",
        };
      }
      await applyGeneratedImage(task, generationRun);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      setRetryTaskId(undefined);
      return { status: "success" };
    } catch (error) {
      if (error instanceof GenerationRequestError) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : generationMessageFallback("image");
      const friendly = friendlyGenerationMessage(message, "image");
      if (
        submittedTaskId &&
        generationRun &&
        ownsImageGenerationRun(generationRun)
      ) {
        if (!bindingPersisted) {
          pollingPausedTaskIdRef.current = submittedTaskId;
          setPollingPausedTaskId(submittedTaskId);
          setUploadError("画布尚未安全保存，任务状态未查询；请重新检查");
          return {
            message: "画布尚未安全保存，任务状态未查询；请重新检查",
            status: "failed",
          };
        }
        const errorCode = error instanceof GenerationRequestError
          ? error.code
          : "TASK_STATUS_UNKNOWN";
        persistImageGenerationFailure(
          submittedTaskId,
          generationRun,
          friendly,
          errorCode,
          false,
          errorCode,
          error instanceof GenerationRequestError
            ? error.message
            : "任务状态暂时无法确认，不能一键重试，请稍后刷新查看",
        );
      } else if (!generationRun) {
        setUploadError(friendly);
      }
      return { message: friendly, status: "failed" };
    } finally {
      setSubmitting(false);
      if (generationRun) endImageGenerationRun(generationRun);
    }
  };

  const persistWorkflowInputFailure = async (problem: NodeInputProblem) => {
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            imageGenerationError: problem.message,
            imageGenerationErrorCode: problem.code,
            imageGenerationInputKey: undefined,
            imageGenerationOwnershipKey: undefined,
            imageGenerating: false,
            imageGenerationRetryAllowed: undefined,
            imageGenerationRetryBlockCode: undefined,
            imageGenerationRetryBlockReason: undefined,
            imageGenerationTaskId: undefined,
          },
        }
      : node));
    setUploadError(problem.message);
    setRetryTaskId(undefined);
    await flushCanvasSave();
    return { message: problem.message, status: "failed" as const };
  };

  const preflightWorkflowNode = async (context: {
    executableIds: ReadonlySet<string>;
    phase: WorkflowPreflightPhase;
  }): Promise<NodeRunResult> => {
    const common = {
      executableIds: context.executableIds,
      inputs: inputPreflight.inputs,
      problems: workflowProblems,
    };
    if (context.phase !== "static") {
      const disposition = workflowRuntimePreflightDisposition(common);
      if (disposition.status === "ready") return { status: "success" };
      if (disposition.status === "waiting" && context.phase === "runtime") {
        return { message: disposition.problem.message, status: "busy" };
      }
      return persistWorkflowInputFailure(disposition.problem);
    }
    const problem = workflowSubmissionPreflightProblem(common);
    return problem
      ? persistWorkflowInputFailure(problem)
      : { status: "success" };
  };

  const runWorkflowNode = async (): Promise<NodeRunResult> => {
    const before = getNodes().find((node) => node.id === id);
    if (!before) return { status: "failed" };
    if (isFixture || canvasRevision === undefined) {
      return { status: "skipped" };
    }
    if (
      before.data.imageGenerating === true ||
      before.data.inputState === "uploading"
    ) {
      return { message: "节点正在生成中", status: "busy" };
    }
    const blockingProblem = inputProblems[0];
    if (blockingProblem) {
      return persistWorkflowInputFailure(blockingProblem);
    }
    const outcome = await generateImage();
    if (outcome.status === "failed") {
      return { message: outcome.message, status: "failed" };
    }
    if (outcome.status === "skipped") {
      return {
        message: inputProblems[0]?.message,
        status: "skipped",
      };
    }
    return { status: "success" };
  };

  const runWorkflowNodeRef = useRef<() => Promise<NodeRunResult>>(
    async () => ({ status: "skipped" }),
  );
  const preflightWorkflowNodeRef = useRef<(
    context: {
      executableIds: ReadonlySet<string>;
      phase: WorkflowPreflightPhase;
    },
  ) => Promise<NodeRunResult>>(
    async () => ({ status: "success" }),
  );
  runWorkflowNodeRef.current = runWorkflowNode;
  preflightWorkflowNodeRef.current = preflightWorkflowNode;
  useEffect(
    () =>
      registerWorkflowNode(id, {
        preflight: (context) => preflightWorkflowNodeRef.current(context),
        run: createSaveGateRun(
          waitForCanvasRevision,
          () => runWorkflowNodeRef.current(),
          "image",
        ),
      }),
    [id, registerWorkflowNode, waitForCanvasRevision],
  );

  const retryImageGeneration = async () => {
    if (
      !retryTaskId ||
      !retryAvailable ||
      isFixture ||
      !retryGenerationEnabled ||
      generating ||
      submitting
    ) return;
    const taskId = retryTaskId;
    const requestedGenerationInputKey = imageGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setSubmitting(true);
    let retryAccepted = false;
    let generationRun: ImageGenerationRun | undefined;
    try {
      await retryGenerationTask({
        canvasId,
        generationInputKey: requestedGenerationInputKey,
        kind: "image",
        nodeId: id,
        taskId,
      }, async () => {
        const revision = await waitForCanvasRevision();
        if (
          liveGenerationInputKeyRef.current !== requestedGenerationInputKey
        ) {
          throw new Error("生成输入已修改，已停止本次重试");
        }
        generationRun = beginImageGenerationRun(
          taskId,
          requestedGenerationInputKey,
          requestedGenerationOwnershipKey,
        );
        return revision;
      });
      if (
        !generationRun ||
        !ownsImageGenerationRun(generationRun)
      ) return;
      retryAccepted = true;
      setUploadError("");
      setServerInputProblems([]);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  imageGenerationError: undefined,
                  imageGenerationErrorCode: undefined,
                  imageGenerationInputKey,
                  imageGenerationOwnershipKey: requestedGenerationOwnershipKey,
                  imageGenerating: true,
                  imageGenerationRetryAllowed: undefined,
                  imageGenerationRetryBlockCode: undefined,
                  imageGenerationRetryBlockReason: undefined,
                  imageGenerationTaskId: taskId,
                },
              }
            : node,
        ),
      );
      const task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!generationRun || !ownsImageGenerationRun(generationRun)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
      });
      if (!generationRun || !ownsImageGenerationRun(generationRun)) return;
      if (task.state === "cancelled") {
        persistImageGenerationCancellation(
          task.id,
          generationRun,
          task.errorMessage ?? "图片生成已取消",
        );
        return;
      }
      if (task.state !== "success") {
        persistImageGenerationFailure(
          task.id,
          generationRun,
          task.errorMessage ?? "图片生成失败，请稍后再试",
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return;
      }
      await applyGeneratedImage(task, generationRun);
      setRetryTaskId(undefined);
    } catch (error) {
      if (
        generationRun &&
        pollingPausedTaskIdRef.current === taskId &&
        ownsImageGenerationRun(generationRun)
      ) return;
      if (!retryAccepted && !(error instanceof GenerationRequestError)) {
        setUploadError(
          error instanceof Error ? error.message : "画布尚未安全保存，不能重试生成",
        );
        return;
      }
      if (error instanceof GenerationRequestError) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : "图片生成失败，请稍后再试";
      const errorCode = error instanceof GenerationRequestError
        ? error.code
        : "TASK_STATUS_UNKNOWN";
      if (generationRun && ownsImageGenerationRun(generationRun)) {
        persistImageGenerationFailure(
          taskId,
          generationRun,
          message,
          errorCode,
          false,
          errorCode,
          error instanceof GenerationRequestError
            ? error.message
            : "任务状态暂时无法确认，不能一键重试，请稍后刷新查看",
        );
      }
    } finally {
      if (generationRun) endImageGenerationRun(generationRun);
      setSubmitting(false);
    }
  };

  const resumeImagePolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setUploadError("");
    const generationRun = beginImageGenerationRun(
      taskId,
      data.imageGenerationInputKey,
      data.imageGenerationOwnershipKey ?? rawGenerationInputFingerprint,
    );
    try {
      await flushCanvasSave();
      const task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!ownsImageGenerationRun(generationRun)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
      });
      if (!ownsImageGenerationRun(generationRun)) return;
      if (task.state === "cancelled") {
        persistImageGenerationCancellation(
          task.id,
          generationRun,
          task.errorMessage ?? "图片生成已取消",
        );
        return;
      }
      if (task.state !== "success") {
        persistImageGenerationFailure(
          task.id,
          generationRun,
          friendlyGenerationMessage(task.errorMessage, "image", task.errorCode),
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return;
      }
      await applyGeneratedImage(task, generationRun);
      setRetryTaskId(undefined);
    } catch (error) {
      if (!ownsImageGenerationRun(generationRun)) return;
      if (pollingPausedTaskIdRef.current === taskId) return;
      if (isTransientPollingError(error)) {
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
        return;
      }
      setUploadError(
        error instanceof Error ? error.message : "图片生成失败，请稍后再试",
      );
    } finally {
      endImageGenerationRun(generationRun);
    }
  };

  const reconcileImageResult = async () => {
    const taskId = data.imageGenerationTaskId;
    if (
      !taskId ||
      !canReconcileImage ||
      reconcileBusy ||
      isFixture ||
      !retryGenerationEnabled
    ) return;
    const requestedGenerationInputKey = imageGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setReconcileBusy(true);
    try {
      const result = await reconcileGenerationTask({
        canvasId,
        generationInputKey: data.imageGenerationInputKey || imageGenerationInputKey,
        kind: "image",
        nodeId: id,
        taskId,
      }, waitForCanvasRevision, reconcileProviderTaskId);
      const message = reconcileOutcomeMessage(result.outcome);
      if (result.outcome === "needs-task-id") {
        setReconcileNeedsTaskId(true);
        setUploadError(message);
        return;
      }
      if (result.outcome === "missing") {
        setReconcileConfirmedMissing(true);
        setReconcileNeedsTaskId(false);
        setRetryTaskId(result.task.id);
        setUploadError(message);
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    imageGenerationError: message,
                    imageGenerationErrorCode: "PROVIDER_RESULT_MISSING",
                    imageGenerating: false,
                    imageGenerationRetryAllowed: true,
                    imageGenerationTaskId: result.task.id,
                  },
                }
              : node,
          ),
        );
        return;
      }
      if (result.outcome !== "recovered") {
        setUploadError(message);
        return;
      }
      setReconcileNeedsTaskId(false);
      setUploadError("");
      const generationRun = beginImageGenerationRun(
        taskId,
        requestedGenerationInputKey,
        requestedGenerationOwnershipKey,
      );
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  imageGenerationError: undefined,
                  imageGenerationErrorCode: undefined,
                  imageGenerating: true,
                  imageGenerationTaskId: taskId,
                },
              }
            : node,
        ),
      );
      const task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!ownsImageGenerationRun(generationRun)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
      });
      if (!ownsImageGenerationRun(generationRun)) return;
      if (task.state === "success") {
        await applyGeneratedImage(task, generationRun);
        return;
      }
      persistImageGenerationFailure(
        task.id,
        generationRun,
        task.errorMessage ?? "图片生成失败，请稍后再试",
        task.errorCode,
        safelyRetryableGenerationTask(task),
        task.retryBlockCode,
        task.retryBlockReason,
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "核对结果失败，请稍后再试",
      );
    } finally {
      setReconcileBusy(false);
    }
  };

  const recheckImageTaskStatus = () => {
    if (
      unverifiedRecoveryTaskId &&
      unverifiedRecoveryTaskId === data.imageGenerationTaskId
    ) {
      setRecoveryEpoch((current) => current + 1);
      return;
    }
    void resumeImagePolling();
  };

  const cancelImageGeneration = async () => {
    const pausedTaskId = pollingPausedTaskIdRef.current;
    if (pausedTaskId) {
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
    }
    if (!activeTaskId) return;
    const generationRun = generationRunRef.current?.taskId === activeTaskId
      ? generationRunRef.current
      : undefined;
    try {
      const task = await cancelGenerationTask(activeTaskId);
      if (task.state !== "cancelled") return;
      if (!generationRun || !ownsImageGenerationRun(generationRun)) return;
      persistImageGenerationCancellation(
        task.id,
        generationRun,
        task.errorMessage ?? "图片生成已取消",
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "取消生成失败",
      );
    }
  };

  useEffect(() => {
    if (!persistenceReady || isFixture || generationRunRef.current) return;
    const persistedTaskId = data.imageGenerationTaskId;
    const persistedInputKey = data.imageGenerationInputKey;
    const persistedOwnershipKey = data.imageGenerationOwnershipKey;
    const catalogReady = imageModelSelection.status === "ready" &&
      Boolean(selectedImageModel);
    const controller = new AbortController();
    let pollingOwner:
      | { taskId: string; token: symbol }
      | undefined;
    let generationRun: ImageGenerationRun | undefined;
    let persistedTaskReadPending = false;
    void (async () => {
      let task: GenerationTaskSummary | undefined;
      let recoveredIntent = false;
      if (persistedTaskId) {
        if (
          persistedOwnershipKey &&
          persistedOwnershipKey !== rawGenerationInputFingerprint
        ) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
          clearGenerationSubmissionIntent(
            "image",
            canvasId,
            id,
            persistedTaskId,
            accountId,
          );
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.imageGenerationTaskId === persistedTaskId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    imageGenerationError: undefined,
                    imageGenerationErrorCode: undefined,
                    imageGenerationInputKey: undefined,
                    imageGenerationOwnershipKey: undefined,
                    imageGenerating: false,
                    imageGenerationRetryAllowed: undefined,
                    imageGenerationRetryBlockCode: undefined,
                    imageGenerationRetryBlockReason: undefined,
                    imageGenerationTaskId: undefined,
                  },
                }
              : node
          ));
          return;
        }
        if (!persistedOwnershipKey) {
          if (!catalogReady) return;
          if (persistedInputKey && persistedInputKey !== imageGenerationInputKey) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
            clearGenerationSubmissionIntent(
              "image",
              canvasId,
              id,
              persistedTaskId,
              accountId,
            );
            setNodes((nodes) => nodes.map((node) =>
              node.id === id && node.data.imageGenerationTaskId === persistedTaskId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      imageGenerationError: undefined,
                      imageGenerationErrorCode: undefined,
                      imageGenerationInputKey: undefined,
                      imageGenerationOwnershipKey: undefined,
                      imageGenerating: false,
                      imageGenerationRetryAllowed: undefined,
                      imageGenerationRetryBlockCode: undefined,
                      imageGenerationRetryBlockReason: undefined,
                      imageGenerationTaskId: undefined,
                    },
                  }
                : node
            ));
            return;
          }
        }
        persistedTaskReadPending = true;
        task = await getGenerationTask(persistedTaskId, controller.signal);
        persistedTaskReadPending = false;
      } else {
        task = await recoverPendingGenerationTask(
          "image",
          canvasId,
          id,
          controller.signal,
          selectedImageModel ? imageGenerationRequestInput : undefined,
          accountId,
          { generationOwnershipKey: rawGenerationInputFingerprint },
        );
        recoveredIntent = Boolean(task);
        if (!task && data.imageGenerating) {
          if (!data.imageGenerationOwnershipKey && !catalogReady) return;
          const matches = (await listGenerationTasks(canvasId, controller.signal))
            .filter((candidate) =>
              candidate.kind === "image" && candidate.nodeId === id
            );
          if (matches.length === 1) task = matches[0];
        }
      }
      if (controller.signal.aborted || !task) return;
      const recoveredOwnershipKey = persistedOwnershipKey ??
        task.generationOwnershipKey;
      if (
        recoveredOwnershipKey &&
        recoveredOwnershipKey !== rawGenerationInputFingerprint
      ) {
        if (persistedTaskId) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
        }
        clearGenerationSubmissionIntent(
          "image",
          canvasId,
          id,
          persistedTaskId ?? task.id,
          accountId,
        );
        return;
      }
      if (!recoveredOwnershipKey) {
        if (!catalogReady) return;
        const legacyInputKey = persistedInputKey ?? task.generationInputKey;
        if (legacyInputKey && legacyInputKey !== imageGenerationInputKey) {
          if (persistedTaskId) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
          }
          clearGenerationSubmissionIntent(
            "image",
            canvasId,
            id,
            persistedTaskId ?? task.id,
            accountId,
          );
          return;
        }
      }
      if (!imageTaskMatchesNode(task, canvasId, id, persistedTaskId ?? task.id)) {
        if (persistedTaskId) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
          clearGenerationSubmissionIntent(
            "image",
            canvasId,
            id,
            persistedTaskId,
            accountId,
          );
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.imageGenerationTaskId === persistedTaskId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    imageGenerationError: undefined,
                    imageGenerationErrorCode: undefined,
                    imageGenerationInputKey: undefined,
                    imageGenerationOwnershipKey: undefined,
                    imageGenerating: false,
                    imageGenerationRetryAllowed: undefined,
                    imageGenerationRetryBlockCode: undefined,
                    imageGenerationRetryBlockReason: undefined,
                    imageGenerationTaskId: undefined,
                  },
                }
              : node
          ));
        }
        return;
      }
      if (persistedTaskId) {
        setUnverifiedRecoveryTaskId((current) =>
          current === persistedTaskId ? undefined : current
        );
        setUploadError("");
      }
      const polling = ["queued", "running", "retrying", "recovering"]
        .includes(task.state);
      if (polling && recoveredImagePollingTasks.has(task.id)) return;
      generationRun = beginImageGenerationRun(
        task.id,
        persistedInputKey ?? task.generationInputKey,
        recoveredOwnershipKey ?? rawGenerationInputFingerprint,
      );
      if (!ownsImageGenerationRun(generationRun)) return;
      if (task.state === "success") {
        await applyGeneratedImage(task, generationRun);
        return;
      }
      if (task.state === "cancelled") {
        persistImageGenerationCancellation(
          task.id,
          generationRun,
          task.errorMessage ?? "图片生成已取消",
        );
        return;
      }
      if (task.state === "failed") {
        const retainPersistedBlock =
          !recoveredIntent && data.imageGenerationRetryAllowed === false;
        persistImageGenerationFailure(
          task.id,
          generationRun,
          retainPersistedBlock && data.imageGenerationError
            ? data.imageGenerationError
            : task.errorMessage ?? "图片生成失败，请稍后再试",
          retainPersistedBlock ? data.imageGenerationErrorCode : task.errorCode,
          retainPersistedBlock ? false : safelyRetryableGenerationTask(task),
          retainPersistedBlock
            ? data.imageGenerationRetryBlockCode
            : task.retryBlockCode,
          retainPersistedBlock
            ? data.imageGenerationRetryBlockReason
            : task.retryBlockReason,
        );
        return;
      }
      const ownerToken = Symbol(task.id);
      pollingOwner = { taskId: task.id, token: ownerToken };
      recoveredImagePollingTasks.set(task.id, ownerToken);
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              imageGenerationError: undefined,
              imageGenerationErrorCode: undefined,
              imageGenerationInputKey:
                persistedInputKey ?? task.generationInputKey,
              imageGenerationOwnershipKey: recoveredOwnershipKey,
              imageGenerating: true,
              imageGenerationRetryAllowed: undefined,
              imageGenerationRetryBlockCode: undefined,
              imageGenerationRetryBlockReason: undefined,
              imageGenerationTaskId: task.id,
            },
          }
        : node));
      const finished = await waitForGenerationTaskWithPause(
        task.id,
        () => {
          if (
            recoveredImagePollingTasks.get(task.id) !== ownerToken ||
            !generationRun ||
            !ownsImageGenerationRun(generationRun)
          ) return;
          pollingPausedTaskIdRef.current = task.id;
          setPollingPausedTaskId(task.id);
          setUploadError(POLLING_PAUSED_MESSAGE);
        },
        controller.signal,
      );
      if (
        recoveredImagePollingTasks.get(task.id) !== ownerToken ||
        !generationRun ||
        !ownsImageGenerationRun(generationRun) ||
        !imageTaskMatchesNode(finished, canvasId, id, task.id)
      ) return;
      if (finished.state === "success") {
        await applyGeneratedImage(finished, generationRun);
      } else if (finished.state === "failed") {
        persistImageGenerationFailure(
          finished.id,
          generationRun,
          friendlyGenerationMessage(
            finished.errorMessage ?? "图片生成失败，请稍后再试",
            "image",
          ),
          finished.errorCode,
          safelyRetryableGenerationTask(finished),
          finished.retryBlockCode,
          finished.retryBlockReason,
        );
      } else if (finished.state === "cancelled") {
        persistImageGenerationCancellation(
          finished.id,
          generationRun,
          finished.errorMessage ?? "图片生成已取消",
        );
      }
    })()
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (
          persistedTaskId &&
          persistedTaskReadPending &&
          isTransientPollingError(error)
        ) {
          setUnverifiedRecoveryTaskId(persistedTaskId);
          setUploadError(POLLING_PAUSED_MESSAGE);
          return;
        }
        if (persistedTaskId && persistedTaskReadPending) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
        }
        if (generationRun && ownsImageGenerationRun(generationRun) &&
          isTransientPollingError(error)) {
          pollingPausedTaskIdRef.current = generationRun.taskId;
          setPollingPausedTaskId(generationRun.taskId);
          setUploadError(POLLING_PAUSED_MESSAGE);
        } else if (!generationRun || ownsImageGenerationRun(generationRun)) {
          setUploadError("生成任务状态暂时无法读取");
        }
        if (generationRun) endImageGenerationRun(generationRun);
      });
    return () => {
      controller.abort();
      if (
        pollingOwner &&
        recoveredImagePollingTasks.get(pollingOwner.taskId) ===
          pollingOwner.token
      ) {
        recoveredImagePollingTasks.delete(pollingOwner.taskId);
      }
      if (generationRun) endImageGenerationRun(generationRun);
    };
  }, [
    canvasId,
    data.imageGenerationError,
    data.imageGenerationErrorCode,
    data.imageGenerationRetryAllowed,
    data.imageGenerationRetryBlockCode,
    data.imageGenerationRetryBlockReason,
    data.imageGenerationInputKey,
    data.imageGenerationOwnershipKey,
    data.imageGenerating,
    data.imageGenerationTaskId,
    id,
    persistenceReady,
    rawGenerationInputFingerprint,
    recoveryEpoch,
    retryWakeEpoch,
    legacyRecoveryCatalogKey,
  ]);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [moreOpen]);

  useEffect(() => {
    if (singleNodeChrome) return;
    setCropOpen(false);
    setLightingOpen(false);
    setMultiAngleOpen(false);
    setMoreOpen(false);
    setRedrawOpen(false);
  }, [singleNodeChrome]);

  useEffect(() => {
    if (!fullscreen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [fullscreen]);

  const loadFile = async (file?: File) => {
    if (!file) return;

    const supersedingUpload = uploadInFlight.current;
    const baseline = uploadBaseline.current ?? getNode(id);
    if (baseline && !uploadBaseline.current) uploadBaseline.current = baseline;
    const operation = uploadOperation.current + 1;
    const scope = mediaAdoptionScopeRef.current;
    uploadOperation.current = operation;
    uploadInFlight.current = true;
    setUploadError("");
    setTransientUploadError("");
    if (!supersedingUpload) checkpoint();
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            ...mediaUploadState("uploading", "图片正在上传"),
            imageGenerationError: undefined,
          },
        }
      : node));

    let createdAssetId: string | undefined;
    try {
      const asset = await uploadImageAsset(file);
      createdAssetId = asset.assetId;
      if (
        operation !== uploadOperation.current ||
        scope !== mediaAdoptionScopeRef.current ||
        !persistenceReadyLive.current ||
        getNode(id)?.data.inputState !== "uploading"
      ) {
        await discardImageAsset(asset.assetId);
        return;
      }
      const upload = asset as typeof asset & {
        byteSize?: number;
        contentType?: string;
        storageBackend?: "local" | "oss";
      };
      const metadata =
        Number.isFinite(upload.byteSize) &&
        upload.byteSize! > 0 &&
        upload.contentType === "image/png" &&
        hasTrustedMediaDimensions(upload) &&
        (upload.storageBackend === "local" || upload.storageBackend === "oss")
          ? {
              assetId: upload.assetId,
              byteSize: Number(upload.byteSize),
              contentType: upload.contentType,
              durationSeconds: null,
              durationStatus: "not-applicable" as const,
              kind: "image" as const,
              mediaHeight: upload.mediaHeight,
              mediaWidth: upload.mediaWidth,
              storageBackend: upload.storageBackend,
            }
          : await fetchTrustedMediaMetadata("image", upload.assetId);
      if (
        operation !== uploadOperation.current ||
        scope !== mediaAdoptionScopeRef.current ||
        !persistenceReadyLive.current ||
        getNode(id)?.data.inputState !== "uploading"
      ) {
        await discardImageAsset(asset.assetId);
        return;
      }
      const wasReadyReplacement = hasReadyImageMedia(baseline);
      const adopted = tryAdoptNodes(id, (nodes) =>
        {
          const liveEdges = getEdges();
          const nodesById = new Map(nodes.map((node) => [node.id, node]));
          const outgoingImageTargets = new Set(
            liveEdges
              .filter((edge) => edge.source === id)
              .map((edge) => edge.target),
          );
          const targetsWithAnotherReadyImage = new Set(
            liveEdges.flatMap((edge) => {
              if (!outgoingImageTargets.has(edge.target) || edge.source === id) {
                return [];
              }
              return hasReadyImageMedia(nodesById.get(edge.source))
                ? [edge.target]
                : [];
            }),
          );
          return nodes.map((node) => {
          if (node.id === id) {
            return {
                ...node,
                height: undefined,
                measured: undefined,
                style: {
                  ...node.style,
                  ...fitVisualMediaSize(asset.width, asset.height),
                },
                width: undefined,
                data: {
                  ...node.data,
                  assetId: asset.assetId,
                  ...trustedMediaPatch(metadata),
                  imageGenerationError: undefined,
                  imageSrc: asset.url,
                },
              };
          }
          return !wasReadyReplacement &&
            outgoingImageTargets.has(node.id) &&
            !targetsWithAnotherReadyImage.has(node.id)
            ? withImageReferenceInputMode(node, imageModels)
            : node;
          });
        },
      );
      if (!adopted) {
        await discardImageAsset(asset.assetId);
        createdAssetId = undefined;
        return;
      }
      createdAssetId = undefined;
      setTransientUploadError("");
    } catch (error) {
      if (createdAssetId) await discardImageAsset(createdAssetId);
      if (operation !== uploadOperation.current) return;
      const message = error instanceof Error ? error.message : "图片上传失败";
      if (baseline && hasReadyImageMedia(baseline)) {
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? restoreImageUploadBaseline(node, baseline)
          : node));
        setTransientUploadError(message);
      } else {
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...mediaUploadState("invalid", message),
              },
            }
          : node));
        setUploadError(message);
      }
    } finally {
      if (operation === uploadOperation.current) {
        uploadInFlight.current = false;
        uploadBaseline.current = undefined;
      }
    }
  };

  const download = () => {
    if (!preview) return;
    const link = document.createElement("a");
    link.href = preview;
    link.download = `${titleControl.committedValue || "Image"}.png`;
    link.click();
  };

  const applyCrop = async (file: File) => {
    const source = getNode(id);
    if (!source || !persistenceReadyLive.current) {
      throw new Error("画布尚未完成安全加载");
    }
    const operation = uploadOperation.current;
    const scope = mediaAdoptionScopeRef.current;
    const asset = await uploadPngAsset(file);
    let adopted = false;
    try {
      const metadata = await fetchTrustedMediaMetadata("image", asset.assetId);
      if (
        operation !== uploadOperation.current ||
        scope !== mediaAdoptionScopeRef.current ||
        !persistenceReadyLive.current ||
        !getNode(id)
      ) {
        await discardImageAsset(asset.assetId);
        return;
      }
    const derivedId = `image-crop-${crypto.randomUUID()}`;
    const derivedSize = fitVisualMediaSize(asset.width, asset.height);
    const sourceWidth = typeof source.style?.width === "number"
      ? source.style.width
      : 250;
    checkpoint();
    adopted = tryAdoptNodes(id, (nodes) => [
      ...nodes.map((node) => ({ ...node, selected: false })),
      {
        id: derivedId,
        type: "image",
        position: {
          x: source.position.x + sourceWidth + 140,
          y: source.position.y,
        },
        selected: true,
        data: {
          assetId: asset.assetId,
          ...trustedMediaPatch(metadata),
          imageSrc: asset.url,
          label: "Image",
          sourceKind: "image",
          title: asset.fileName.replace(/\.[^.]+$/, "") || "Image",
        },
        style: { ...derivedSize },
      },
    ]);
    if (!adopted) {
      await discardImageAsset(asset.assetId);
      return;
    }
    setEdges((edges) => [
      ...edges,
      {
        id: `edge-${id}-${derivedId}`,
        interactionWidth: 20,
        source: id,
        sourceHandle: "source",
        target: derivedId,
        targetHandle: "target",
        type: "cuttable",
      },
    ]);
    setCropOpen(false);
    } catch (error) {
      if (!adopted) await discardImageAsset(asset.assetId);
      throw error;
    }
  };

  const applyPreviewAutoFit = useCallback((
    width: number,
    height: number,
    resetHydrationMeasurement = false,
  ) => {
    const size = fitVisualMediaSize(width, height);
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id !== id ||
        (!resetHydrationMeasurement && (
          typeof node.width === "number" ||
          typeof node.height === "number"
        ))
          ? node
          : {
              ...node,
              ...(resetHydrationMeasurement
                ? { height: undefined, measured: undefined, width: undefined }
                : {}),
              style: { ...node.style, ...size },
            },
      ),
    );
  }, [id, setNodes]);

  useEffect(() => {
    if (!persistenceReady || !deferredPreviewAutoFit.current) return;
    const { height, width } = deferredPreviewAutoFit.current;
    deferredPreviewAutoFit.current = undefined;
    applyPreviewAutoFit(width, height, true);
  }, [applyPreviewAutoFit, persistenceReady]);

  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        minHeight={120}
        minWidth={120}
        onResizeStart={() => checkpoint()}
      />
      <EmptyMediaUploadToolbar
        label="上传图片"
        onUpload={() => inputRef.current?.click()}
        testId="image-empty-upload-toolbar"
        visible={singleNodeChrome && !preview && !generating && !uploading}
      />
      <NodeToolbar
        className="media-node-toolbar image-node-toolbar nodrag nopan nowheel"
        data-testid="image-node-toolbar"
        isVisible={Boolean(preview && singleNodeChrome && !generating && !uploading && !redrawOpen)}
        offset={28}
        position={Position.Top}
      >
        <button
          aria-label="裁剪"
          data-tooltip="裁剪"
          onClick={() => {
            setLightingOpen(false);
            setMoreOpen(false);
            setCropOpen(true);
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M5.5 2.5v10A2 2 0 0 0 7.5 14.5h10M2.5 5.5h10a2 2 0 0 1 2 2v10" />
          </svg>
        </button>
        <button
          aria-label="多角度"
          data-tooltip="多角度"
          onClick={() => {
            setCropOpen(false);
            setLightingOpen(false);
            setMoreOpen(false);
            setMultiAngleOpen(true);
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m10 3 6 3.5v7L10 17l-6-3.5v-7Z" />
            <path d="m4 6.5 6 3.5 6-3.5M10 10v7M13.5 2.5h3v3" />
          </svg>
        </button>
        <button
          aria-label="重绘"
          data-tooltip="重绘"
          onClick={() => {
            setCropOpen(false);
            setLightingOpen(false);
            setMoreOpen(false);
            setMultiAngleOpen(false);
            setRedrawOpen(true);
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m4 16 3.2-.8L16 6.4a2 2 0 0 0-2.8-2.8L4.4 12.4Z" />
            <path d="m11.8 5 3.2 3.2M4 4l3 3M13 13l3 3" />
          </svg>
        </button>
        <button
          aria-label="打光"
          data-tooltip="打光（暂未开放）"
          disabled
          onClick={() => {
            setCropOpen(false);
            setMoreOpen(false);
            setMultiAngleOpen(false);
            setRedrawOpen(false);
            setLightingOpen(true);
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m6 3 8 4-4 8-6-3Z" />
            <path d="M14 12.5 17 14M15.5 9.5l2.5-.5M12 15l.8 2.5" />
          </svg>
        </button>
        <span className="image-node-more-wrap" ref={moreRef}>
          <button
            aria-expanded={moreOpen}
            aria-label="浏览全部"
            data-tooltip="浏览全部"
            onClick={() => setMoreOpen((open) => !open)}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <circle cx="4" cy="10" r="1.5" />
              <circle cx="10" cy="10" r="1.5" />
              <circle cx="16" cy="10" r="1.5" />
            </svg>
          </button>
          {moreOpen && (
            <div
              aria-label="图片更多工具"
              className="image-node-more-menu"
              data-testid="image-node-more-menu"
              role="menu"
            >
              {[
                ["扩图", "expand"],
                ["擦除", "erase"],
                ["标注", "mark"],
                ["增强", "enhance"],
                ["调整像素", "pixels"],
                ["抠图", "cutout"],
              ].map(([label, icon]) => (
                <button disabled key={label} role="menuitem" type="button">
                  <span aria-hidden="true" className={`image-more-icon ${icon}`} />
                  {label}
                </button>
              ))}
              <button disabled role="menuitem" type="button">
                <span aria-hidden="true" className="image-more-icon split" />
                <span>快速切分</span>
                <span className="image-more-sizes">2×2　3×3　4×4　›</span>
              </button>
              <button disabled role="menuitem" type="button">
                <span aria-hidden="true" className="image-more-icon compliance" />
                Seedance 合规验证
              </button>
            </div>
          )}
        </span>
        <span className="media-node-toolbar-divider" />
        <button aria-label="Pin" data-tooltip="Pin" type="button">
          <span className="media-node-color" />
        </button>
        <span className="media-node-toolbar-divider" />
        <button
          aria-label="保存到素材库"
          data-tooltip="保存到素材库"
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M2.5 5.5h6l1.5 2h7.5v8.5h-15Z" />
            <path d="M14.5 10v5M12 12.5h5" />
          </svg>
        </button>
        <button
          aria-label="下载"
          data-tooltip="下载"
          onClick={download}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M10 2.5v10M6 8.5l4 4 4-4M3 12v3.5h14V12" />
          </svg>
        </button>
        <button
          aria-label="全屏查看"
          data-tooltip="全屏查看"
          onClick={() => setFullscreen(true)}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M8 3H3v5M12 3h5v5M3 12v5h5M17 12v5h-5" />
          </svg>
        </button>
      </NodeToolbar>
      {preview && cropOpen && (
        <ImageCropEditor
          onCancel={() => setCropOpen(false)}
          onConfirm={applyCrop}
          src={preview}
          title={titleControl.committedValue}
        />
      )}
      {preview && redrawOpen && (
        <ImageRedrawEditor
          onClose={() => setRedrawOpen(false)}
          src={preview}
        />
      )}
      <NodeToolbar
        className="image-multi-angle-toolbar"
        isVisible={Boolean(preview && singleNodeChrome && multiAngleOpen)}
        offset={16}
        position={Position.Bottom}
      >
        {preview && (
          <ImageMultiAnglePanel
            onClose={() => setMultiAngleOpen(false)}
            src={preview}
          />
        )}
      </NodeToolbar>
      <NodeToolbar
        className="image-lighting-toolbar"
        isVisible={Boolean(preview && singleNodeChrome && lightingOpen)}
        offset={16}
        position={Position.Bottom}
      >
        {preview && (
          <ImageLightingPanel
            onClose={() => setLightingOpen(false)}
            src={preview}
          />
        )}
      </NodeToolbar>
      <NodeToolbar
        className="image-creator nodrag nopan nowheel"
        data-testid="image-creator"
        isVisible={Boolean(data.imagePromptReady && singleNodeChrome)}
        offset={16}
        position={Position.Bottom}
      >
        <UpstreamInputCards
          disabled={generating}
          inputs={inputPreflight.inputs}
          onMove={(edgeId, direction) => {
            checkpoint();
            setEdges((edges) => moveNodeInputEdge(edges, id, edgeId, direction));
          }}
          onRemove={(edgeId) => {
            checkpoint();
            setEdges((edges) => edges.filter((edge) => edge.id !== edgeId));
          }}
          onRoleChange={(edgeId, role) => {
            checkpoint();
            setEdges((edges) => edges.map((edge) => edge.id === edgeId
              ? { ...edge, data: { ...edge.data, inputRole: role } }
              : edge));
          }}
          problems={inputProblems}
          roleOptions={(input) => availableNodeInputRoles({
            kind: input.kind,
            modelSchema: imageInputSchema,
            parameters: imageSubmissionParameterValues,
            targetKind: "image",
          })}
          testId="image-creator-references"
        />
        <GenerationAvailabilityNotice
          canvasId={canvasId}
          kind="image"
          reason={imageModelUnavailableReason}
        />
        {inputPreflight.inputs.some((input) =>
          input.kind === "text" &&
          input.state === "ready" &&
          input.compatibility === "compatible") && (
          <div className="image-creator-final-prompt" data-testid="image-final-prompt">
            <span>{promptControl.committedValue.trim() ? "母版 + 本节点补充" : "使用上游母版"}</span>
            <strong>{inputPreflight.finalPrompt}</strong>
          </div>
        )}
        <textarea
          aria-label="图片提示词"
          data-canvas-text-edit="graph"
          data-composition-active={promptControl.composing || undefined}
          data-testid="image-creator-prompt"
          disabled={generating}
          onBlur={() => promptControl.blur()}
          onChange={(event) =>
            promptControl.change(
              event.target.value,
              (event.nativeEvent as InputEvent).isComposing,
            )
          }
          onCompositionEnd={(event) =>
            promptControl.compositionEnd(event.currentTarget.value)
          }
          onCompositionStart={() => promptControl.compositionStart()}
          onKeyDown={(event) => {
            promptControl.keyDown(event);
          }}
          placeholder="描述任何你想要生成的内容"
          value={promptControl.value}
        />
        <div className="image-creator-controls">
          <NodeModelControl
            capability="image"
            disabled={generating}
            onChange={(modelId, displayName) => {
              const nextModel = imageModels?.find(
                (model) => model.id === modelId,
              );
              const nextParameters = nextModel?.imageParameters ?? {
                aspectRatios: ["auto"],
                maxReferenceImages: 0,
                qualities: ["auto"],
              };
              const nextValues = nextModel
                ? defaultParameterValues(
                    nextModel.parameterSchema ?? defaultParameterSchema("image"),
                  )
                : {};
              const nextSchema = nextModel?.parameterSchema ?? defaultParameterSchema("image");
              const blocked = nextModel
                ? blockedModelSwitchProblem(resolveNodeInputs({
                    edges: canvasEdges,
                    modelSchema: nextSchema,
                    nodes: canvasNodes,
                    ownPrompt: promptControl.committedValue,
                    parameters: nextValues,
                    targetId: id,
                    targetKind: "image",
                  }), nextSchema)
                : undefined;
              if (blocked) {
                setModelSwitchProblem(`模型未切换：${blocked.message}`);
                return;
              }
              setModelSwitchProblem("");
              setServerInputProblems([]);
              checkpoint();
              setNodes((nodes) =>
                nodes.map((node) =>
                  node.id === id
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          imageGenerationError: undefined,
                          imageGenerationErrorCode: undefined,
                          imageGenerationInputKey: undefined,
                          imageGenerationOwnershipKey: undefined,
                          imageGenerating: false,
                          imageGenerationRetryAllowed: undefined,
                          imageGenerationRetryBlockCode: undefined,
                          imageGenerationRetryBlockReason: undefined,
                          imageGenerationTaskId: undefined,
                          imageParameters: nextValues,
                          imageAspectRatio: supportedImageValue(
                            nextParameters.aspectRatios,
                            "auto",
                          ),
                          imageModelId: modelId,
                          imageModelName: displayName,
                          imageQuality: supportedImageValue(
                            nextParameters.qualities,
                            "auto",
                          ),
                        },
                      }
                    : node,
                ),
              );
            }}
            selectedId={imageModelSelection.selectedId}
            selectedName={imageModelSelection.displayName}
          />
          {!isFixture ? (
            <ImageParameterControl
              aspectRatio={aspectRatio}
              disabled={generating}
              onAspectRatioChange={(value) => {
                checkpoint();
                setNodes((nodes) =>
                  nodes.map((node) =>
                    node.id === id
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            imageAspectRatio: value,
                            imageParameters: {
                              ...imageParameterValues,
                              aspectRatio: value,
                            },
                          },
                        }
                      : node,
                  ),
                );
              }}
              onQualityChange={(value) => {
                checkpoint();
                setNodes((nodes) =>
                  nodes.map((node) =>
                    node.id === id
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            imageParameters: {
                              ...imageParameterValues,
                              quality: value,
                            },
                            imageQuality: value,
                          },
                        }
                      : node,
                  ),
                );
              }}
              quality={quality}
              supportedAspectRatios={imageParameters.aspectRatios}
              supportedQualities={imageParameters.qualities}
            />
          ) : (
            <button disabled={generating} type="button">自适应 · 1K</button>
          )}
          {selectedImageModel && imageExtraParameterKeys.length > 0 && (
            <NodeParameterControl
              disabled={generating}
              keys={imageExtraParameterKeys}
              onChange={(key, value) => {
                setNodes((nodes) => nodes.map((node) => node.id === id
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        imageParameters: { ...imageParameterValues, [key]: value },
                      },
                    }
                  : node));
              }}
              onEditSessionStart={checkpoint}
              schema={imageParameterSchema}
              values={imageParameterValues}
            />
          )}
          <span className="image-creator-spacer" />
          <GenerationDurationHint label={finishedDurationLabel} />
          {selectedImageModel ? (
            <NodeParameterControl
              disabled={generating}
              keys={imageCountParameterKeys}
              onChange={(key, value) => {
                setNodes((nodes) =>
                  nodes.map((node) =>
                    node.id === id
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            imageParameters: {
                              ...imageParameterValues,
                              [key]: value,
                            },
                          },
                        }
                      : node,
                  ),
                );
              }}
              onEditSessionStart={checkpoint}
              schema={imageParameterSchema}
              values={imageParameterValues}
            />
          ) : (
            <button aria-label="生成数量" disabled type="button">1×</button>
          )}
          <button
            aria-label={
              generating && activeTaskId
                ? "取消生成"
                : generating
                  ? "Generating..."
                  : submitting
                    ? "Submitting..."
                    : "Generate"
            }
            className="image-creator-generate"
            data-tooltip={
              generating && activeTaskId
                ? "取消本次生成"
                : isFixture
                ? "验收页面不会调用真实生成"
                : !selectedImageModel
                  ? "管理员尚未发布图片模型"
                : imageModelUnavailableReason
                  ? imageModelUnavailableReason
                : canvasRevision === undefined
                  ? "画布正在保存"
                : referenceProblem ||
                  (generatedForCurrentInput ? "当前节点已生成" : undefined)
            }
            disabled={
              submitting ||
              (generating
                ? !activeTaskId
                : generatedForCurrentInput ||
                  !inputPreflight.canSubmit ||
                  !referencesSupported ||
                  selectedImageModel?.generationAvailable === false ||
                  (!isFixture &&
                    (!selectedImageModel || canvasRevision === undefined)))
            }
            onClick={() =>
              void (generating ? cancelImageGeneration() : generateImage())
            }
            type="button"
          >
            {generating && activeTaskId ? "×" : "↑"}
          </button>
        </div>
      </NodeToolbar>
      <Handle id="target" position={Position.Left} type="target">
        {!preview && (
          <span className="node-handle-hit node-handle-hit-left">
            <span className="node-handle-plus" />
          </span>
        )}
      </Handle>
      <div
        className="canvas-node-title image-node-title nodrag"
        data-parent-group-id={parentId}
      >
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <rect height="14" rx="3" width="16" x="1" y="2" />
          <circle cx="12.5" cy="6.5" r="1.5" />
          <path d="m3 14 4-4 3 3 2-2 3 3" />
        </svg>
        {singleNodeChrome ? (
          <input
            aria-label="Image 标题"
            data-canvas-text-edit="graph"
            data-composition-active={titleControl.composing || undefined}
            data-testid="image-node-title-input"
            onBlur={() => titleControl.blur()}
            onChange={(event) => {
              titleControl.change(
                event.target.value,
                (event.nativeEvent as InputEvent).isComposing,
              );
            }}
            onCompositionEnd={(event) =>
              titleControl.compositionEnd(event.currentTarget.value)
            }
            onCompositionStart={() => titleControl.compositionStart()}
            onKeyDown={(event) => {
              if (titleControl.keyDown(event) !== undefined) return;
              event.stopPropagation();
              if (
                titleControl.composing ||
                event.nativeEvent.isComposing ||
                event.keyCode === 229
              ) {
                return;
              }
              if (event.key === "Escape" || event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            placeholder="请输入标题"
            value={titleControl.value}
          />
        ) : (
          <span title={titleControl.committedValue}>
            {titleControl.committedValue}
          </span>
        )}
      </div>
      <div
        className="image-node-card"
        data-asset-id={data.assetId}
        data-empty={preview || generating || uploading ? undefined : "true"}
        data-testid={`image-node-${id}`}
      >
        {(transientUploadError || uploadError) && (
          <div className="image-node-upload-error" role="alert">
            <span className="provider-error-summary">
              {transientUploadError || uploadError}
            </span>
            {canReconcileImage && (
              <GenerationReconcileControls
                busy={reconcileBusy || submitting}
                canRetry={showImageRetry}
                needsTaskId={reconcileNeedsTaskId}
                onReconcile={() => void reconcileImageResult()}
                onRetry={() => void retryImageGeneration()}
                providerTaskDraft={reconcileProviderTaskId}
                retryEnabled={retryGenerationEnabled}
                setProviderTaskDraft={setReconcileProviderTaskId}
              />
            )}
            {!canReconcileImage && retryAvailable && (
              <button
                aria-label="重试生成"
                disabled={
                  submitting ||
                  generating ||
                  isFixture ||
                  !retryGenerationEnabled
                }
                onClick={() => void retryImageGeneration()}
                type="button"
              >
                重试
              </button>
            )}
            {(pollingPausedTaskId ||
              (unverifiedRecoveryTaskId &&
                unverifiedRecoveryTaskId === data.imageGenerationTaskId)) && (
              <button
                aria-label="重新检查任务状态"
                onClick={recheckImageTaskStatus}
                type="button"
              >
                重新检查
              </button>
            )}
          </div>
        )}
        {preview ? (
          <img
            alt=""
            className={`image-node-preview${
              mediaLoad.failed ? " media-load-obscured" : ""
            }`}
            data-testid="image-node-preview"
            draggable={false}
            key={mediaLoad.key}
            onError={mediaLoad.markFailed}
            onLoad={(event) => {
              mediaLoad.markLoaded();
              const current = getNode(id);
              if (
                !current ||
                typeof current.width === "number" ||
                typeof current.height === "number"
              ) return;
              const naturalSize = {
                height: event.currentTarget.naturalHeight,
                width: event.currentTarget.naturalWidth,
              };
              if (!persistenceReady) {
                deferredPreviewAutoFit.current = naturalSize;
                return;
              }
              deferredPreviewAutoFit.current = undefined;
              applyPreviewAutoFit(naturalSize.width, naturalSize.height);
            }}
            src={mediaLoad.source}
          />
        ) : !generating && !uploading ? (
          <div aria-hidden="true" className="image-node-empty-action">
            <svg aria-hidden="true" viewBox="0 0 48 48">
              <rect height="34" rx="6" width="38" x="5" y="7" />
              <circle cx="33" cy="17" r="3" />
              <path d="m9 36 10-10 7 7 5-5 8 8" />
            </svg>
          </div>
        ) : null}
        {preview && mediaLoad.failed && (
          <MediaLoadFallback
            kind="图片"
            onReload={mediaLoad.reload}
            onReplace={() => inputRef.current?.click()}
          />
        )}
        {(generating || uploading) && (
          <div
            aria-label={uploading ? "图片上传中" : "Generating..."}
            className="image-node-generating"
            data-testid="image-node-generating"
            role="status"
          >
            <span
              className="image-node-generating-background"
              data-testid="image-node-generating-background"
            />
            <span
              className="image-node-loading-grid"
              data-grid-columns="18"
              data-grid-rows="18"
              data-testid="image-node-loading-grid"
            />
          </div>
        )}
        {generatedSuccess && !mediaLoad.failed && (
          <button
            aria-label="收藏"
            aria-pressed={favorite}
            className="image-node-favorite nodrag nopan"
            onClick={() => setFavorite((current) => !current)}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="m10 2.8 2.15 4.35 4.8.7-3.48 3.39.82 4.78L10 13.76l-4.29 2.26.82-4.78-3.48-3.39 4.8-.7Z" />
            </svg>
          </button>
        )}
        {preview && !mediaLoad.failed && !generating && !uploading && (
          <button
            aria-label="替换"
            className="image-node-replace nodrag nopan"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 16V4M8 8l4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
            </svg>
            替换
          </button>
        )}
        <input
          accept="image/png,image/jpeg,image/webp,image/gif"
          data-testid="image-upload-input"
          hidden
          onChange={(event) => {
            void loadFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>
      <Handle id="source" position={Position.Right} type="source">
        <span className="node-handle-hit node-handle-hit-right">
          <span className="node-handle-plus" />
        </span>
      </Handle>
      {fullscreen && preview && !mediaLoad.failed &&
        createPortal(
          <div
            className="image-detail-backdrop"
            data-testid="image-detail"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setFullscreen(false);
            }}
          >
            <div
              aria-label={`${titleControl.committedValue || "Image"} 图片详情`}
              aria-modal="true"
              className="image-detail-dialog"
              role="dialog"
            >
              <img
                alt={titleControl.committedValue || "图片预览"}
                className="image-detail-preview"
                data-testid="image-detail-preview"
                src={preview}
              />
              <div className="image-detail-actions">
                <strong>{titleControl.committedValue || "Image"}</strong>
                <button onClick={download} type="button">下载</button>
                <button
                  aria-label="关闭图片详情"
                  onClick={() => setFullscreen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
export const ImageNode = memo(ImageNodeImpl);
