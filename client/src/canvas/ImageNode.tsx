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
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useCanvasCheckpoint } from "./CanvasHistory";
import type { ImageToolOperation } from "../../../types/imageTools";
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
import {
  resolveEditableImageSource,
  type EditableImageSource,
} from "./editableImageSource";
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
import { useWorkflowExecution } from "../generation/WorkflowExecutionProvider";
import {
  effectiveLegacyTerminalGenerationState,
  LegacyTerminalGenerationNotice,
  useLegacyTerminalGenerationState,
} from "../generation/legacyTerminalGenerationState";
import { useFinishedGenerationDuration } from "../generation/useFinishedGenerationDuration";
import { GenerationDurationHint } from "./GenerationDurationHint";
import { GenerationReconcileControls } from "./GenerationReconcileControls";
import {
  friendlyGenerationMessage,
  generationMessageFallback,
} from "../generation/friendlyGenerationMessage";
import {
  createBrowserSingleNodeGenerationTaskPort,
} from "../generation/browserSingleNodeGenerationTaskPort";
import {
  isTransientPollingError,
  POLLING_PAUSED_MESSAGE,
  waitForGenerationTaskWithPause,
} from "../generation/taskPolling";
import {
  type NodeGenerationOutcome,
} from "../generation/workflowExecution";
import { groupRunResultKey } from "../generation/groupRunCheckpoint";
import { visibleGenerationError } from "../generation/generationErrors";
import {
  generationFailureMessage,
  generationFailureIsDefinitive,
  generationInputKey as createGenerationInputKey,
  generationNeedsReconcile,
  generationRetryVisible,
  safelyRetryableGenerationTask,
} from "../generation/generationRetry";
import {
  clearGenerationSubmissionIntent,
  GENERATION_TASK_RETRY_ACCEPTED_EVENT,
  GenerationRequestError,
  getGenerationTask,
  listGenerationTasks,
  recoverPendingGenerationTask,
  reconcileOutcomeMessage,
  waitForGenerationTask,
  type GenerationTaskRetryAcceptedDetail,
  type GenerationTaskSummary,
} from "../generation/generationTasks";
import {
  createSingleNodeGenerationLifecycle,
  type SingleNodeLifecycleResult,
} from "../generation/singleNodeGenerationLifecycle";
import { createImageGenerationAdapter } from
  "../generation/imageGenerationAdapter";
import { imageToolSubmissionParameterValues } from
  "../imageTools/generationImageToolUseCase";
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
import { createImageToolDispatcher } from "../imageTools/imageToolDispatcher";
import { createDerivedImageToolUseCase } from
  "../imageTools/derivedImageToolUseCase";
import {
  createDownloadImageToolUseCase,
  createFullscreenImageToolUseCase,
} from "../imageTools/viewerImageToolUseCases";
import { createBatchDerivedImageToolUseCase } from
  "../imageTools/batchDerivedImageToolUseCase";
import {
  ImageResizePanel,
  ImageSplitPanel,
} from "../imageTools/LocalImageToolPanels";
import {
  ImageToolHost,
  ImageToolSurface,
} from "../imageTools/ImageToolHost";
import {
  imageToolDescriptors,
  initialImageToolUiState,
  reduceImageToolUiState,
  type ImageToolId,
} from "../imageTools/imageToolUiContract";
import {
  analyzeVisibleImageBounds,
  enhanceConservativeLocalImage,
  prepareOutpaintImages,
  resizeLocalImage,
  splitLocalImage,
  type VisibleImageBounds,
} from "../imageTools/localImageProcessing";
import { ImageAnnotationEditor } from
  "../imageTools/ImageAnnotationEditor";
import { renderAnnotatedImage } from
  "../imageTools/renderAnnotatedImage";
import { emptyImageAnnotationDocument } from
  "../imageTools/imageAnnotations";
import { SeedanceTrustedAssetPanel } from
  "../imageTools/SeedanceTrustedAssetPanel";
import { createSaveLibraryAssetUseCase } from
  "../imageTools/saveLibraryAssetUseCase";
import { useImageToolCapability } from
  "../imageTools/ImageToolCapabilityContext";
import {
  createMultiAngleImageToolUseCase,
  multiAngleOwnershipEvidence,
  multiAnglePrompt,
} from
  "../imageTools/multiAngleImageToolUseCase";
import {
  createRedrawImageToolUseCase,
  redrawOwnershipEvidence,
} from "../imageTools/redrawImageToolUseCase";
import {
  createRedrawMaskFile,
  redrawCanvasPoint,
} from "../imageTools/redrawMask";
import {
  createOutpaintEraseImageToolUseCase,
  outpaintEraseOwnershipEvidence,
  type OutpaintEraseOperation,
} from "../imageTools/outpaintEraseImageToolUseCase";
import {
  createPromptGenerationImageToolUseCase,
  promptGenerationOwnershipEvidence,
  type PromptGenerationOperation,
} from "../imageTools/promptGenerationImageToolUseCase";
import type {
  ImageGenerationToolInput,
  ImageToolCapability,
} from "../../../types/imageTools";
import {
  legacySeedancePreflightSummary,
} from "../../../types/imageTools";

type CropBox = { height: number; width: number; x: number; y: number };
const imageColorMarks = [
  ["red", "红色", "#ff5b5b"],
  ["orange", "橙色", "#ff9f43"],
  ["yellow", "黄色", "#ffd84d"],
  ["green", "绿色", "#55cf78"],
  ["blue", "蓝色", "#5b8cff"],
  ["purple", "紫色", "#a879ff"],
] as const;
type CropVisualPreview = Readonly<{
  height: number;
  url: string;
  width: number;
}>;

function freezeReusableCropVisualPreview(
  image: HTMLImageElement | null,
): CropVisualPreview | undefined {
  if (
    !image?.complete ||
    image.naturalWidth <= 0 ||
    image.naturalHeight <= 0
  ) return undefined;
  const url = image.currentSrc || image.src;
  let protocol: string;
  try {
    protocol = new URL(url, window.location.href).protocol;
  } catch {
    return undefined;
  }
  // Creating a second <img> for an HTTP(S) asset can issue another large OSS
  // read when the original response is no-store. Only in-memory URLs are safe
  // to reuse as a visual placeholder; every other source gets the compact card.
  if (protocol !== "blob:" && protocol !== "data:") return undefined;
  return {
    height: image.naturalHeight,
    url,
    width: image.naturalWidth,
  };
}
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

const imageToolSourceLabels: Partial<Record<ImageToolOperation, string>> = {
  annotate: "标注 · 本地处理",
  crop: "裁剪 · 本地处理",
  "enhance-conservative": "保守增强 · 本地处理",
  "enhance-creative": "创意增强 · AI生成",
  erase: "擦除 · AI修补",
  "multi-angle": "多角度 · AI生成",
  outpaint: "扩图 · AI生成",
  "quick-split": "快速切分 · 本地处理",
  redraw: "重绘 · AI生成",
  "remove-background": "主体抠图 · AI生成",
  "resize-pixels": "调整像素 · 本地处理",
};

const creativeEnhancePrompt =
  "在保持主体身份、构图和主要颜色的前提下增强清晰度与细节；允许补充自然纹理，不添加无关对象。";
const removeBackgroundPrompt =
  "精确保留主要主体和边缘细节，完全移除背景，输出透明背景PNG；不要添加阴影、底色或棋盘格。";
const erasePrompt = "移除选中对象并自然补全背景，保持未选择区域不变";

function imageDetailFileSize(bytes?: number) {
  if (!Number.isFinite(bytes) || !bytes || bytes < 1) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function imageDetailRatio(width: number, height: number, stored?: string) {
  if (stored && stored !== "auto") return stored;
  if (width < 1 || height < 1) return "—";
  const divisor = (left: number, right: number): number => right === 0
    ? left
    : divisor(right, left % right);
  const common = divisor(Math.round(width), Math.round(height));
  return `${Math.round(width) / common}:${Math.round(height) / common}`;
}

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
  assetId,
  onCancel,
  onConfirm,
  title,
  transparent,
  visualPreview,
}: {
  assetId: string;
  onCancel: () => void;
  onConfirm: (file: File, sourceAssetId: string) => Promise<void>;
  title: string;
  transparent: boolean;
  visualPreview?: CropVisualPreview;
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
  const [editableSource, setEditableSource] =
    useState<EditableImageSource>();
  const [sourceDecoded, setSourceDecoded] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(true);
  const [sourceError, setSourceError] = useState("");
  const [sourceEpoch, setSourceEpoch] = useState(0);
  const [visualPreviewFailed, setVisualPreviewFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ height: 720, width: 1280 });
  const [ratio, setRatio] = useState<CropRatio>("原图");
  const [ratioOpen, setRatioOpen] = useState(false);
  const hasVisualPreview = Boolean(visualPreview && !visualPreviewFailed);
  const aspect = sourceDecoded
    ? natural.width / natural.height
    : hasVisualPreview
    ? visualPreview!.width / visualPreview!.height
    : 16 / 9;
  const maxWidth = Math.min(987, window.innerWidth - 80);
  const maxHeight = Math.min(552, window.innerHeight - 180);
  const stage = !sourceDecoded && !hasVisualPreview
    ? { height: 180, width: 320 }
    : maxWidth / maxHeight > aspect
    ? { height: maxHeight, width: maxHeight * aspect }
    : { height: maxWidth / aspect, width: maxWidth };

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let resolved: EditableImageSource | undefined;
    setEditableSource(undefined);
    setSourceDecoded(false);
    setSourceBusy(true);
    setSourceError("");
    const start = window.setTimeout(() => {
      void resolveEditableImageSource(assetId, controller.signal).then(
        (source) => {
          resolved = source;
          if (!active) {
            source.release();
            return;
          }
          setEditableSource(source);
        },
        (failure) => {
          if (!active || controller.signal.aborted) return;
          setSourceBusy(false);
          setSourceError(
            failure instanceof Error
              ? failure.message
              : "图片暂时无法读取，请稍后重试",
          );
        },
      );
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(start);
      controller.abort(new DOMException("Crop editor closed", "AbortError"));
      resolved?.release();
    };
  }, [assetId, sourceEpoch]);

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
    if (!editableSource || !imageRef.current) {
      setError(sourceError || "图片尚未准备完成");
      return;
    }
    setBusy(true);
    try {
      const image = imageRef.current;
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
        throw new Error("图片尚未准备完成");
      }
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
      await onConfirm(
        new File([blob], `${title || "Image"}-crop.png`, {
          type: "image/png",
        }),
        editableSource.sourceAssetId,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "裁剪保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="image-crop-overlay nodrag nopan nowheel"
      data-testid="image-crop-overlay"
    >
      <div
        className="image-crop-stage"
        data-testid="image-crop-stage"
        style={{ height: stage.height, width: stage.width }}
      >
        {editableSource && (
          <img
            alt=""
            className={`image-crop-secure-source${
              sourceDecoded ? " ready" : ""
            }${transparent ? " image-transparent-preview" : ""}`}
            crossOrigin={editableSource.crossOrigin}
            data-testid="image-crop-secure-source"
            draggable={false}
            onError={() => {
              editableSource.release();
              setEditableSource(undefined);
              setSourceBusy(false);
              setSourceDecoded(false);
              setSourceError("图片暂时无法读取，请稍后重试");
            }}
            onLoad={(event) => {
              setNatural({
                height: event.currentTarget.naturalHeight,
                width: event.currentTarget.naturalWidth,
              });
              setSourceDecoded(true);
              setSourceBusy(false);
            }}
            ref={imageRef}
            src={editableSource.url}
          />
        )}
        {hasVisualPreview && (
          <img
            alt=""
            aria-hidden="true"
            className={`image-crop-visual-preview${
              transparent ? " image-transparent-preview" : ""
            }`}
            data-testid="image-crop-visual-preview"
            draggable={false}
            onError={() => setVisualPreviewFailed(true)}
            src={visualPreview!.url}
          />
        )}
        {sourceBusy && (
          <div
            className="image-crop-source-status"
            data-testid="image-crop-loading"
            role="status"
          >
            <span aria-hidden="true" className="image-crop-loading-indicator" />
            <span>
              {editableSource
                ? "正在打开高清原图…"
                : "正在准备高清原图…"}
            </span>
          </div>
        )}
        {editableSource && sourceDecoded && <div
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
        </div>}
        <span className="image-editor-processing-badge">本地裁剪</span>
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
          disabled={busy || sourceBusy || !editableSource || !sourceDecoded}
          onClick={() => void confirm()}
          type="button"
        >
          <span aria-hidden="true">✓</span>
          <span>{busy ? "处理中" : "确认裁剪"}</span>
        </button>
        {(error || sourceError) && (
          <div className="image-crop-error" role="alert">
            <span>{error || sourceError}</span>
            {sourceError && !sourceBusy && (
              <button
                className="image-crop-retry"
                onClick={() => setSourceEpoch((epoch) => epoch + 1)}
                type="button"
              >
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageMultiAnglePanel({
  busy,
  capability,
  error,
  onClose,
  onSubmit,
  src,
  transparent,
}: {
  busy: boolean;
  capability: ImageToolCapability;
  error: string;
  onClose: () => void;
  onSubmit: (angle: MultiAngle) => Promise<void>;
  src: string;
  transparent: boolean;
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
      className="image-multi-angle-panel nodrag nopan nowheel"
      data-testid="image-multi-angle-panel"
    >
      <header className="image-tool-panel-header">
        <span>
          <strong>多角度</strong>
          <small>拖拽预览或调整参数</small>
        </span>
        <button aria-label="关闭多角度" disabled={busy} onClick={onClose} type="button">×</button>
      </header>
      <div className="image-tool-panel-body image-multi-angle-body">
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
            <img alt="" className={transparent ? "image-transparent-preview" : undefined}
              draggable={false} src={src} />
          </div>
          <button className="image-multi-angle-reset" disabled={busy} onClick={reset} type="button">
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
                disabled={busy}
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
              disabled={busy}
              onChange={(event) =>
                setAngle((current) => ({ ...current, wide: event.target.checked }))
              }
              type="checkbox"
            />
          </label>
          {error && <div className="image-multi-angle-error" role="alert">{error}</div>}
        </div>
      </div>
      <footer className="image-tool-panel-footer">
        <span data-testid="image-multi-angle-capability">
          {capability.status === "available"
            ? "图片模型已就绪"
            : capability.reason}
        </span>
        <button disabled={busy} onClick={onClose} type="button">取消</button>
        <button
          className="primary"
          data-tooltip={capability.status === "available"
            ? "生成多角度图片"
            : capability.reason}
          disabled={busy || capability.status !== "available"}
          onClick={() => void onSubmit(angle)}
          type="button"
        >{busy ? "生成中…" : "生成多角度图片"}</button>
      </footer>
    </div>
  );
}

function ImageRedrawEditor({
  busy,
  capability,
  error,
  onClose,
  onError,
  onSubmit,
  operation = "redraw",
  src,
  transparent,
}: {
  busy: boolean;
  capability: ImageToolCapability;
  error: string;
  onClose: () => void;
  onError: (message: string) => void;
  onSubmit: (input: Readonly<{
    featherPixels: number;
    maskFile: File;
    prompt: string;
  }>) => Promise<void>;
  operation?: "erase" | "redraw";
  src: string;
  transparent: boolean;
}) {
  const isErase = operation === "erase";
  const noun = isErase ? "擦除" : "重绘";
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
  const [featherPixels, setFeatherPixels] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [natural, setNatural] = useState({ height: 720, width: 1280 });
  const [prompt, setPrompt] = useState(isErase ? erasePrompt : "");
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
    return redrawCanvasPoint({
      canvasHeight: canvas.height,
      canvasWidth: canvas.width,
      clientX: event.clientX,
      clientY: event.clientY,
      rect: bounds,
    });
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
      context.fillStyle = "rgba(255, 255, 255, 0.5)";
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
    context.strokeStyle = "rgba(255, 255, 255, 0.62)";
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

  return (
    <div
      className="image-redraw-overlay nodrag nopan nowheel"
      data-testid={`image-${operation}-overlay`}
    >
      <div
        className="image-redraw-stage"
        data-testid="image-redraw-stage"
        style={{
          height: stage.height,
          width: stage.width,
        }}
      >
        <img
          alt=""
          className={transparent ? "image-transparent-preview" : undefined}
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
          aria-label={`${noun}蒙版`}
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
      >
        <button aria-label={`取消${noun}`} disabled={busy} onClick={onClose} type="button">×</button>
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
              disabled={busy}
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
          disabled={busy}
          max="80"
          min="5"
          onChange={(event) => setBrushSize(Number(event.target.value))}
          type="range"
          value={brushSize}
        />
        <span className="image-redraw-divider" />
        <button
          aria-label="撤销蒙版"
          disabled={busy || !history.current.length}
          onClick={() => restore(history, redo)}
          type="button"
        >
          ↶
        </button>
        <button
          aria-label="恢复蒙版"
          disabled={busy || !redo.current.length}
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
      >
        <textarea
          aria-label={`${noun}提示词`}
          data-composition-active={promptControl.composing || undefined}
          disabled={busy}
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
          placeholder={isErase ? "描述擦除后应如何补全背景..." : "描述你想改变什么..."}
          value={promptControl.value}
        />
        <div>
          <span aria-hidden="true">⌕</span>
          <span>{capability.status === "available"
            ? `本地绘制蒙版 · 由图片模型完成${noun}`
            : capability.reason}</span>
          <label className="image-redraw-feather">
            羽化
            <input
              aria-label="蒙版羽化"
              disabled={busy}
              max="64"
              min="0"
              onChange={(event) => setFeatherPixels(Number(event.target.value))}
              type="range"
              value={featherPixels}
            />
            <output>{featherPixels}px</output>
          </label>
          <span className="image-redraw-prompt-spacer" />
          <button
            aria-label={`提交${noun}`}
            disabled={
              busy || capability.status !== "available" ||
              !promptControl.committedValue.trim() || history.current.length < 1
            }
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              void createRedrawMaskFile(canvas, { featherPixels })
                .then((maskFile) => onSubmit({
                  featherPixels,
                  maskFile,
                  prompt: promptControl.committedValue.trim(),
                }))
                .catch((caught) => onError(
                  caught instanceof Error ? caught.message : `${noun}遮罩生成失败`,
                ));
            }}
            type="button"
          >{busy ? "…" : "↑"}</button>
        </div>
        {error && <div className="image-redraw-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

function ImageOutpaintEditor({
  busy,
  capability,
  error,
  naturalHeight,
  naturalWidth,
  onClose,
  onSubmit,
  src,
  transparent,
}: {
  busy: boolean;
  capability: ImageToolCapability;
  error: string;
  naturalHeight: number;
  naturalWidth: number;
  onClose: () => void;
  onSubmit: (input: Readonly<{ marginPercent: number; prompt: string }>) => Promise<void>;
  src: string;
  transparent: boolean;
}) {
  const [marginPercent, setMarginPercent] = useState(25);
  const [prompt, setPrompt] = useState("自然延展画面边缘，保持原图主体和原区域不变");
  const promptControl = useCompositionSafeText({ onCommit: setPrompt, value: prompt });
  const horizontalMargin = Math.max(
    1,
    Math.round(naturalWidth * marginPercent / 100 / 2),
  );
  const verticalMargin = Math.max(
    1,
    Math.round(naturalHeight * marginPercent / 100 / 2),
  );
  const outputWidth = naturalWidth + horizontalMargin * 2;
  const outputHeight = naturalHeight + verticalMargin * 2;
  const outputRatio = outputWidth / outputHeight;
  const previewMaximumWidth = Math.max(240, Math.min(820, window.innerWidth - 80));
  const previewMaximumHeight = Math.max(160, window.innerHeight - 300);
  const previewWidth = Math.min(
    previewMaximumWidth,
    previewMaximumHeight * outputRatio,
  );
  const previewHeight = previewWidth / outputRatio;
  return (
    <div
      className="image-outpaint-overlay nodrag nopan nowheel"
      data-testid="image-outpaint-overlay">
      <header className="image-editor-header">
        <span><strong>扩图</strong><small>边框内是原图，深灰区域是新增范围</small></span>
        <button aria-label="取消扩图" disabled={busy} onClick={onClose} type="button">×</button>
      </header>
      <div className="image-outpaint-stage" data-testid="image-outpaint-stage">
        <div className="image-outpaint-frame"
          data-output-height={outputHeight}
          data-output-width={outputWidth}
          data-source-x={horizontalMargin}
          data-source-y={verticalMargin}
          style={{ height: previewHeight, width: previewWidth }}>
          <div className="image-outpaint-original" style={{
            height: `${naturalHeight / outputHeight * 100}%`,
            left: `${horizontalMargin / outputWidth * 100}%`,
            top: `${verticalMargin / outputHeight * 100}%`,
            width: `${naturalWidth / outputWidth * 100}%`,
          }}>
            <img alt="" className={transparent ? "image-transparent-preview" : undefined}
              draggable={false} src={src} />
            <span>原图范围</span>
          </div>
        </div>
        <small>{naturalWidth}×{naturalHeight} → {outputWidth}×{outputHeight}</small>
      </div>
      <div className="image-outpaint-controls">
        <label>画布总扩展
          <input aria-label="扩图边界" disabled={busy} max="50" min="5"
            onChange={(event) => setMarginPercent(Number(event.target.value))}
            type="range" value={marginPercent} />
          <output>{marginPercent}%</output>
        </label>
        <textarea aria-label="扩图提示词" disabled={busy} value={promptControl.value}
          onBlur={() => promptControl.blur()}
          onChange={(event) => promptControl.change(event.target.value,
            (event.nativeEvent as InputEvent).isComposing)}
          onCompositionEnd={(event) => promptControl.compositionEnd(event.currentTarget.value)}
          onCompositionStart={() => promptControl.compositionStart()}
          onKeyDown={(event) => promptControl.keyDown(event)} />
        <span>扩展范围、原图位置和新增区域会随任务提交，由图片模型生成新增区域{capability.status === "available"
          ? ""
          : ` · ${capability.reason}`}</span>
        <button aria-label="提交扩图" disabled={busy || capability.status !== "available" ||
          !promptControl.committedValue.trim()}
          onClick={() => void onSubmit({ marginPercent,
            prompt: promptControl.committedValue })} type="button">
          {busy ? "…" : "↑"}
        </button>
        {error && <div role="alert">{error}</div>}
      </div>
    </div>
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
  height,
  id,
  parentId,
  selected,
  width,
}: NodeProps<ProbeNodeType>) {
  const multiAngleCapability = useImageToolCapability("multi-angle");
  const redrawCapability = useImageToolCapability("redraw");
  const outpaintCapability = useImageToolCapability("outpaint");
  const eraseCapability = useImageToolCapability("erase");
  const creativeEnhanceCapability = useImageToolCapability("enhance-creative");
  const removeBackgroundCapability = useImageToolCapability("remove-background");
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const { lockedNodeIds } = useWorkflowExecution();
  const storedLegacyState = useLegacyTerminalGenerationState(id);
  const legacyState = effectiveLegacyTerminalGenerationState({
    bindingComplete: Boolean(
      data.imageGenerationTaskId && data.imageGenerationOwnershipKey &&
        data.imageGenerationInputKey,
    ),
    hasLegacyRun: Boolean(data.workflowExecutionRunId),
    locallyActive: lockedNodeIds.has(id),
    persistedGenerating: data.imageGenerating === true,
    state: storedLegacyState,
  });
  const displayImageGenerating = legacyState && legacyState !== "PASSTHROUGH"
    ? legacyState === "ACTIVE_CONFIRMED"
    : Boolean(data.imageGenerating);
  const legacySubmissionBlocked = legacyState === "DETECTING" ||
    legacyState === "ACTIVE_CONFIRMED" || legacyState === "UNKNOWN_BLOCKED";
  const mediaLoad = useMediaLoadRecovery(data.imageSrc);
  const imageShowsTransparency = data.imageHasTransparency === true ||
    data.imageToolOutputBackground === "transparent";
  const previewFrameStyle = (() => {
    const mediaWidth = data.mediaWidth;
    const mediaHeight = data.mediaHeight;
    if (!width || !height || !mediaWidth || !mediaHeight) return undefined;
    const scale = Math.min(width / mediaWidth, height / mediaHeight);
    return {
      height: Math.max(1, Math.round(mediaHeight * scale)),
      width: Math.max(1, Math.round(mediaWidth * scale)),
    } satisfies CSSProperties;
  })();
  const inputRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const uploadInFlight = useRef(false);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadOperation = useRef(0);
  const deferredPreviewAutoFit = useRef<{
    height: number;
    width: number;
  } | undefined>(undefined);
  const { getEdges, getNode, getNodes } = useReactFlow<ProbeNodeType>();
  const {
    graphCommandPort,
    imageColorFilter,
    setEdges,
    setImageColorFilter,
    setNodes,
    tryAdoptNodes,
  } =
    useCanvasGraphMutation();
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
  // 页面刷新或组件重挂后 activeTaskId 会丢失，但持久化任务号还在；
  // 取消按钮用它兜底，保证“生成中一定能取消”。
  const cancelableTaskId = activeTaskId ??
    (typeof data.imageGenerationTaskId === "string"
      ? data.imageGenerationTaskId
      : undefined);
  const [submitting, setSubmitting] = useState(false);
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [toolUiState, dispatchToolUi] = useReducer(
    reduceImageToolUiState,
    initialImageToolUiState,
  );
  const activeImageTool = toolUiState.activeTool;
  const colorMarksOpen = toolUiState.colorMenuOpen;
  const moreOpen = toolUiState.moreMenuOpen;
  const imageToolTriggerRef = useRef<HTMLElement | null>(null);
  const [cropSourceAssetId, setCropSourceAssetId] = useState<string>();
  const [cropVisualPreview, setCropVisualPreview] =
    useState<CropVisualPreview>();
  const [lightingOpen, setLightingOpen] = useState(false);
  const [multiAngleBusy, setMultiAngleBusy] = useState(false);
  const [multiAngleError, setMultiAngleError] = useState("");
  const [localToolBusy, setLocalToolBusy] = useState(false);
  const [splitVisibleBounds, setSplitVisibleBounds] =
    useState<VisibleImageBounds>();
  const [splitPreviewError, setSplitPreviewError] = useState("");
  const [splitPreviewBusy, setSplitPreviewBusy] = useState(false);
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [redrawBusy, setRedrawBusy] = useState(false);
  const [redrawError, setRedrawError] = useState("");
  const [eraseBusy, setEraseBusy] = useState(false);
  const [eraseError, setEraseError] = useState("");
  const [outpaintBusy, setOutpaintBusy] = useState(false);
  const [outpaintError, setOutpaintError] = useState("");
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhanceError, setEnhanceError] = useState("");
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [cutoutError, setCutoutError] = useState("");
  const [seedanceBusy, setSeedanceBusy] = useState(false);
  const annotationOpen = activeImageTool === "annotation";
  const cropOpen = activeImageTool === "crop";
  const cutoutOpen = activeImageTool === "cutout";
  const enhanceOpen = activeImageTool === "enhance";
  const eraseOpen = activeImageTool === "erase";
  const fullscreen = activeImageTool === "fullscreen";
  const localToolOpen = activeImageTool === "resize" || activeImageTool === "split"
    ? activeImageTool
    : undefined;
  const multiAngleOpen = activeImageTool === "multi-angle";
  const outpaintOpen = activeImageTool === "outpaint";
  const redrawOpen = activeImageTool === "redraw";
  const seedanceOpen = activeImageTool === "seedance";
  const imageToolModalOpen = activeImageTool
    ? imageToolDescriptors[activeImageTool].inertBackground
    : false;
  const imageToolBusy = activeImageTool === "multi-angle"
    ? multiAngleBusy
    : activeImageTool === "annotation"
    ? annotationBusy
    : activeImageTool === "resize" || activeImageTool === "split"
    ? localToolBusy
    : activeImageTool === "redraw"
    ? redrawBusy
    : activeImageTool === "erase"
    ? eraseBusy
    : activeImageTool === "outpaint"
    ? outpaintBusy
    : activeImageTool === "enhance"
    ? enhanceBusy
    : activeImageTool === "cutout"
    ? cutoutBusy
    : activeImageTool === "seedance"
    ? seedanceBusy
    : false;
  const openImageTool = useCallback((
    tool: ImageToolId,
    trigger?: HTMLElement | null,
  ) => {
    setLocalToolBusy(false);
    setAnnotationBusy(false);
    setSeedanceBusy(false);
    imageToolTriggerRef.current = trigger ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setLightingOpen(false);
    dispatchToolUi({ tool, type: "open-tool" });
  }, []);
  const closeImageTool = useCallback((tool?: ImageToolId) => {
    setLocalToolBusy(false);
    setAnnotationBusy(false);
    setSeedanceBusy(false);
    dispatchToolUi({ tool, type: "close-tool" });
  }, []);
  const [retryTaskId, setRetryTaskId] = useState<string>();
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
  const [unverifiedRecoveryTaskId, setUnverifiedRecoveryTaskId] =
    useState<string>();
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const generationRunRef = useRef<ImageGenerationRun | undefined>(undefined);
  const imageRecoveryControllerRef = useRef<AbortController | undefined>(
    undefined,
  );
  const imageRecoveryLifecycleRef = useRef<ReturnType<
    typeof createSingleNodeGenerationLifecycle
  > | undefined>(undefined);
  const liveGenerationInputKeyRef = useRef<string | undefined>(undefined);
  const liveGenerationOwnershipKeyRef = useRef<string | undefined>(undefined);
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const [retryWakeEpoch, setRetryWakeEpoch] = useState(0);
  const [uploadError, setRawUploadError] = useState(
    visibleGenerationError(data.imageGenerationError),
  );
  const [uploadErrorNeutral, setUploadErrorNeutral] = useState(false);
  useEffect(() => {
    if (localToolOpen !== "split") {
      setSplitVisibleBounds(undefined);
      setSplitPreviewError("");
      setSplitPreviewBusy(false);
      return;
    }
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId) {
      setSplitVisibleBounds(undefined);
      setSplitPreviewError("图片尚未完成安全保存");
      setSplitPreviewBusy(false);
      return;
    }
    let cancelled = false;
    setSplitVisibleBounds(undefined);
    setSplitPreviewError("");
    setSplitPreviewBusy(true);
    void analyzeVisibleImageBounds(sourceAssetId)
      .then((bounds) => {
        if (!cancelled) setSplitVisibleBounds(bounds);
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setSplitPreviewError(
            failure instanceof Error ? failure.message : "无法识别图片本体",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSplitPreviewBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.assetId, localToolOpen]);
  const setUploadError = (message: string, errorCode?: string | null) => {
    setUploadErrorNeutral(
      Boolean(message) && !generationFailureIsDefinitive(errorCode),
    );
    setRawUploadError(message);
  };
  const [transientUploadError, setTransientUploadError] = useState("");
  const [librarySaveState, setLibrarySaveState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
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
  const inputProblems: NodeInputProblem[] = [
    ...(modelSwitchProblem
      ? [{ code: "MODEL_UNSUPPORTED" as const, message: modelSwitchProblem }]
      : []),
    ...inputPreflight.problems,
    ...serverInputProblems,
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
  const imageToolInput = inputPreflight.inputs.length === 1
    ? inputPreflight.inputs[0]
    : undefined;
  const imageToolGenerationOwnershipKey =
    data.imageToolOperation === "multi-angle" &&
    data.imageToolOperationId &&
    data.imageMultiAngleParameters &&
    imageToolInput?.kind === "image" &&
    imageToolInput.assetId
      ? generationOwnershipKey(multiAngleOwnershipEvidence({
          accountId,
          aspectRatio: data.imageAspectRatio,
          canvasId,
          modelId: data.imageModelId,
          modelParameters: data.imageParameters,
          operationId: data.imageToolOperationId,
          parameters: data.imageMultiAngleParameters,
          prompt: promptControl.committedValue,
          quality: data.imageQuality,
          sourceAssetId: imageToolInput.assetId,
          sourceNodeId: imageToolInput.sourceNodeId,
        }))
      : (data.imageToolOperation === "redraw" ||
          data.imageToolOperation === "erase" ||
          data.imageToolOperation === "outpaint") &&
          data.imageToolOperationId &&
          data.imageToolMaskAssetId &&
          data.imageToolMaskVersion === 1 &&
          data.imageToolMaskWidth &&
          data.imageToolMaskHeight &&
          data.imageToolMaskFeatherPixels !== undefined &&
          imageToolInput?.kind === "image" &&
          imageToolInput.assetId
        ? generationOwnershipKey(data.imageToolOperation === "redraw"
          ? redrawOwnershipEvidence({
            accountId,
            aspectRatio: data.imageAspectRatio,
            canvasId,
            maskAssetId: data.imageToolMaskAssetId,
            maskFeatherPixels: data.imageToolMaskFeatherPixels,
            maskHeight: data.imageToolMaskHeight,
            maskWidth: data.imageToolMaskWidth,
            modelId: data.imageModelId,
            modelParameters: data.imageParameters,
            operationId: data.imageToolOperationId,
            prompt: promptControl.committedValue,
            quality: data.imageQuality,
            sourceAssetId: imageToolInput.assetId,
            sourceNodeId: imageToolInput.sourceNodeId,
          })
          : outpaintEraseOwnershipEvidence({
            accountId,
            aspectRatio: data.imageAspectRatio,
            canvasId,
            maskAssetId: data.imageToolMaskAssetId,
            maskFeatherPixels: data.imageToolMaskFeatherPixels,
            maskHeight: data.imageToolMaskHeight,
            maskWidth: data.imageToolMaskWidth,
            modelId: data.imageModelId,
            modelParameters: data.imageParameters,
            operation: data.imageToolOperation,
            operationId: data.imageToolOperationId,
            outpaint: data.imageToolOutpaintParameters,
            preparedAssetId: data.imageToolPreparedAssetId,
            prompt: promptControl.committedValue,
            quality: data.imageQuality,
            sourceAssetId: imageToolInput.assetId,
            sourceNodeId: imageToolInput.sourceNodeId,
          }))
      : (data.imageToolOperation === "enhance-creative" ||
          data.imageToolOperation === "remove-background") &&
          data.imageToolOperationId && imageToolInput?.kind === "image" &&
          imageToolInput.assetId
        ? generationOwnershipKey(promptGenerationOwnershipEvidence({
            accountId, aspectRatio: data.imageAspectRatio, canvasId,
            modelId: data.imageModelId, modelParameters: data.imageParameters,
            operation: data.imageToolOperation,
            operationId: data.imageToolOperationId,
            prompt: promptControl.committedValue, quality: data.imageQuality,
            sourceAssetId: imageToolInput.assetId,
            sourceNodeId: imageToolInput.sourceNodeId,
          }))
      : undefined;
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
  const rawGenerationInputFingerprint = imageToolGenerationOwnershipKey ??
    generationOwnershipKey({
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
    imageRecoveryLifecycleRef.current?.abort("image-recovery-superseded");
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
    if (pollingPausedTaskIdRef.current) return;
    setUploadError(
      data.inputState === "invalid" && data.inputStateReason
        ? data.inputStateReason
        : visibleGenerationError(data.imageGenerationError),
      data.inputState === "invalid"
        ? "INPUT_INVALID"
        : data.imageGenerationErrorCode,
    );
  }, [
    data.imageGenerationError,
    data.imageGenerationErrorCode,
    data.inputState,
    data.inputStateReason,
  ]);

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
    if (data.workflowExecutionRunId) {
      stableRawGenerationInputFingerprint.current = rawGenerationInputFingerprint;
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
    data.workflowExecutionRunId,
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
  const imageGenerationToolInput: ImageGenerationToolInput | undefined =
    data.imageToolOperation &&
    [
      "enhance-creative",
      "erase",
      "multi-angle",
      "outpaint",
      "redraw",
      "remove-background",
    ].includes(data.imageToolOperation) &&
    data.imageToolOperationId &&
    data.imageToolSourceAssetId &&
    imageToolInput?.kind === "image" &&
    imageToolInput.assetId === data.imageToolSourceAssetId
      ? {
          ...(data.imageToolMaskAssetId &&
              data.imageToolMaskVersion === 1 &&
              data.imageToolMaskWidth &&
              data.imageToolMaskHeight &&
              data.imageToolMaskFeatherPixels !== undefined
            ? {
                mask: {
                  assetId: data.imageToolMaskAssetId,
                  featherPixels: data.imageToolMaskFeatherPixels,
                  height: data.imageToolMaskHeight,
                  version: 1 as const,
                  width: data.imageToolMaskWidth,
                },
              }
            : {}),
          ...(data.imageToolOutpaintParameters
            ? { outpaint: data.imageToolOutpaintParameters }
            : {}),
          ...(data.imageToolPreparedAssetId &&
              data.imageToolPreparedVersion === 1 &&
              data.imageToolPreparedWidth && data.imageToolPreparedHeight
            ? { preparedInput: { assetId: data.imageToolPreparedAssetId,
                height: data.imageToolPreparedHeight, version: 1 as const,
                width: data.imageToolPreparedWidth } }
            : {}),
          operation: data.imageToolOperation as ImageGenerationToolInput["operation"],
          operationId: data.imageToolOperationId,
          sourceAssetId: data.imageToolSourceAssetId,
          sourceNodeId: imageToolInput.sourceNodeId,
        }
      : undefined;
  const imageGenerationRequestInput = {
    canvasId,
    canvasRevision,
    ...(imageGenerationToolInput ? { imageTool: imageGenerationToolInput } : {}),
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
  const showImageRetry = generationRetryVisible({
    errorCode: data.imageGenerationErrorCode,
    retryAvailable,
  });
  const canReconcileImage = Boolean(
    data.imageGenerationTaskId &&
    data.imageGenerationError &&
    !generating &&
    !isFixture &&
    generationNeedsReconcile(
      data.imageGenerationErrorCode,
      data.imageGenerationRetryBlockCode,
    ),
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
    setUploadError(visibleMessage, errorCode);
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
                groupRunSuccessOwnershipKey: run.ownershipKey,
                groupRunSuccessResultKey: groupRunResultKey(task.resultUrl),
                groupRunSuccessTaskId: task.id,
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

  const generateImage = async (
    _options: { autoRecover?: boolean } = {},
  ): Promise<NodeGenerationOutcome> => {
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
    let generationRun: ImageGenerationRun | undefined;
    const requestedGenerationInputKey = imageGenerationInputKey;
    const requestedGenerationOwnershipKey =
      effectiveGenerationInputFingerprint;
    const requestedModelId = selectedImageModelId;
    const requestedModelName = imageModelSelection.displayName;
    const requestedParameters = { ...effectiveImageParameters };
    let saveBoundary = 0;
    try {
      if (!graphCommandPort) return { status: "skipped" };
      checkpoint();
      setSavingCanvas(true);
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createImageGenerationAdapter({
          aspectRatio,
          inputKey: requestedGenerationInputKey,
          modelId: requestedModelId,
          modelName: requestedModelName,
          nodeId: id,
          ownershipKey: requestedGenerationOwnershipKey,
          parameters: requestedParameters,
          payload: imageGenerationRequestInput,
          quality,
          readBlock() {
            if (
              liveGenerationOwnershipKeyRef.current !==
                requestedGenerationOwnershipKey
            ) {
              return {
                message: "生成输入已修改，已停止本次生成",
                status: "blocked",
              };
            }
          },
        }),
        graph: graphCommandPort,
        nodeId: id,
        save: {
          flush: async () => undefined,
          async waitForRevision() {
            const revision = await waitForCanvasRevision();
            saveBoundary += 1;
            if (saveBoundary === 2) {
              setSavingCanvas(false);
              setSubmitting(false);
            }
            return { revision };
          },
        },
        tasks: createBrowserSingleNodeGenerationTaskPort({
          accountId,
          onPollingPaused(taskId) {
            pollingPausedTaskIdRef.current = taskId;
            setPollingPausedTaskId(taskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            generationRun = beginImageGenerationRun(
              task.id,
              requestedGenerationInputKey,
              requestedGenerationOwnershipKey,
            );
          },
        }),
      });
      const result = await lifecycle.generate();
      setSavingCanvas(false);
      if (!result.task) {
        return { message: "生成输入已修改，已停止本次生成", status: "failed" };
      }
      clearGenerationSubmissionIntent(
        "image",
        canvasId,
        id,
        result.task.id,
        accountId,
      );
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status !== "success") {
        const message = friendlyGenerationMessage(
          result.task.errorMessage,
          "image",
        );
        setUploadError(
          generationFailureMessage(
            message,
            result.task.retryAllowed
              ? undefined
              : result.task.retryBlockReason,
            result.task.errorCode,
            "image",
          ),
          result.task.errorCode,
        );
        setRetryTaskId(
          safelyRetryableGenerationTask(result.task)
            ? result.task.id
            : undefined,
        );
        return { message, status: "failed" };
      }
      setRetryTaskId(undefined);
      setUploadError("");
      return {
        status: "success",
        successProof: {
          ownershipKey: requestedGenerationOwnershipKey,
          resultKey: groupRunResultKey(result.task.resultUrl),
          taskId: result.task.id,
        },
      };
    } catch (error) {
      if (error instanceof GenerationRequestError) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : generationMessageFallback("image");
      const friendly = friendlyGenerationMessage(message, "image");
      if (!generationRun) {
        setUploadError(
          friendly,
          error instanceof GenerationRequestError ? error.code : undefined,
        );
      }
      return { message: friendly, status: "failed" };
    } finally {
      setSavingCanvas(false);
      setSubmitting(false);
      if (generationRun) endImageGenerationRun(generationRun);
    }
  };

  const retryImageGeneration = async () => {
    if (
      !retryTaskId ||
      !retryAvailable ||
      isFixture ||
      !retryGenerationEnabled ||
      generating ||
      submitting
    ) return;
    imageRecoveryControllerRef.current?.abort("image-recovery-superseded");
    const taskId = retryTaskId;
    const requestedGenerationInputKey = imageGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setSubmitting(true);
    let retryAccepted = false;
    let retrySaveGatePassed = false;
    let generationRun: ImageGenerationRun | undefined;
    try {
      if (!graphCommandPort) return;
      setSavingCanvas(true);
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createImageGenerationAdapter({
          aspectRatio: data.imageAspectRatio,
          inputKey: requestedGenerationInputKey,
          modelId: data.imageModelId,
          modelName: data.imageModelName,
          nodeId: id,
          ownershipKey: requestedGenerationOwnershipKey,
          parameters: data.imageParameters,
          payload: imageGenerationRequestInput,
          quality: data.imageQuality,
          readBlock() {
            if (!retrySaveGatePassed) return;
            if (
              liveGenerationInputKeyRef.current !==
                requestedGenerationInputKey ||
              liveGenerationOwnershipKeyRef.current !==
                requestedGenerationOwnershipKey
            ) {
              return {
                message: "生成输入已修改，已停止本次重试",
                status: "blocked",
              };
            }
          },
        }),
        graph: graphCommandPort,
        nodeId: id,
        save: {
          flush: async () => undefined,
          async waitForRevision() {
            const revision = await waitForCanvasRevision();
            retrySaveGatePassed = true;
            return { revision };
          },
        },
        tasks: createBrowserSingleNodeGenerationTaskPort({
          accountId,
          onPollingPaused(pausedTaskId) {
            if (!generationRun || !ownsImageGenerationRun(generationRun)) {
              return;
            }
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            if (task.id !== taskId) return;
            retryAccepted = true;
            generationRun = beginImageGenerationRun(
              task.id,
              requestedGenerationInputKey,
              requestedGenerationOwnershipKey,
            );
          },
        }),
      });
      const result = await lifecycle.retry({ id: taskId });
      if (
        !result.task ||
        result.status === "stale" ||
        !generationRun ||
        !ownsImageGenerationRun(generationRun)
      ) return;
      setServerInputProblems([]);
      clearGenerationSubmissionIntent("image", canvasId, id, taskId, accountId);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        setUploadError("");
        setRetryTaskId(undefined);
        return;
      }
      const message = generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled"
            ? "图片生成已取消"
            : "图片生成失败，请稍后再试"
        ),
        result.task.retryAllowed
          ? undefined
          : result.task.retryBlockReason,
        result.task.errorCode,
        "image",
      );
      setUploadError(message, result.task.errorCode);
      setRetryTaskId(
        safelyRetryableGenerationTask(result.task)
          ? result.task.id
          : undefined,
      );
    } catch (error) {
      if (
        generationRun &&
        pollingPausedTaskIdRef.current === taskId &&
        ownsImageGenerationRun(generationRun)
      ) return;
      if (!retryAccepted && !(error instanceof GenerationRequestError)) {
        setUploadError(
          error instanceof Error ? error.message : "画布尚未安全保存，不能重试生成",
          "CANVAS_NOT_SAVED",
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
      setSavingCanvas(false);
      if (generationRun) endImageGenerationRun(generationRun);
      setSubmitting(false);
    }
  };

  const resumeImagePolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    imageRecoveryControllerRef.current?.abort("image-recovery-superseded");
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
        error instanceof GenerationRequestError ? error.code : undefined,
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
    let reconcileSaveGatePassed = false;
    let generationRun: ImageGenerationRun | undefined;
    try {
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createImageGenerationAdapter({
          aspectRatio: data.imageAspectRatio,
          inputKey: data.imageGenerationInputKey || imageGenerationInputKey,
          modelId: data.imageModelId,
          modelName: data.imageModelName,
          nodeId: id,
          ownershipKey: data.imageGenerationOwnershipKey ??
            requestedGenerationOwnershipKey,
          parameters: data.imageParameters,
          payload: imageGenerationRequestInput,
          quality: data.imageQuality,
          readBlock() {
            if (!reconcileSaveGatePassed) return;
            if (
              liveGenerationInputKeyRef.current !==
                requestedGenerationInputKey ||
              liveGenerationOwnershipKeyRef.current !==
                requestedGenerationOwnershipKey
            ) {
              return {
                message: "生成输入已修改，已停止本次核对",
                status: "blocked",
              };
            }
          },
        }),
        graph: graphCommandPort,
        nodeId: id,
        save: {
          flush: async () => undefined,
          async waitForRevision() {
            const revision = await waitForCanvasRevision();
            reconcileSaveGatePassed = true;
            return { revision };
          },
        },
        tasks: createBrowserSingleNodeGenerationTaskPort({
          accountId,
          onPollingPaused(pausedTaskId) {
            if (!generationRun || !ownsImageGenerationRun(generationRun)) {
              return;
            }
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            if (task.id !== taskId) return;
            generationRun = beginImageGenerationRun(
              task.id,
              requestedGenerationInputKey,
              requestedGenerationOwnershipKey,
            );
          },
        }),
      });
      const result = await lifecycle.reconcile({ id: taskId });
      const message = result.reconcileOutcome
        ? reconcileOutcomeMessage(result.reconcileOutcome)
        : "";
      if (result.reconcileOutcome !== "recovered") {
        setUploadError(message, result.task?.errorCode);
        return;
      }
      if (!result.task || result.status === "stale") return;
      clearGenerationSubmissionIntent(
        "image",
        canvasId,
        id,
        result.task.id,
        accountId,
      );
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        setUploadError("");
        setRetryTaskId(undefined);
        return;
      }
      const failureMessage = generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled"
            ? "图片生成已取消"
            : "图片生成失败，请稍后再试"
        ),
        result.task.retryAllowed
          ? undefined
          : result.task.retryBlockReason,
        result.task.errorCode,
        "image",
      );
      setUploadError(failureMessage, result.task.errorCode);
      setRetryTaskId(
        safelyRetryableGenerationTask(result.task)
          ? result.task.id
          : undefined,
      );
    } catch (error) {
      if (
        generationRun &&
        pollingPausedTaskIdRef.current === taskId &&
        ownsImageGenerationRun(generationRun)
      ) return;
      setUploadError(
        error instanceof Error ? error.message : "核对结果失败，请稍后再试",
        error instanceof GenerationRequestError ? error.code : undefined,
      );
    } finally {
      if (generationRun) endImageGenerationRun(generationRun);
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
    if (!cancelableTaskId) return;
    const generationRun = generationRunRef.current?.taskId === cancelableTaskId
      ? generationRunRef.current
      : undefined;
    try {
      if (!generationRun || !ownsImageGenerationRun(generationRun)) return;
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createImageGenerationAdapter({
          aspectRatio: data.imageAspectRatio,
          inputKey: generationRun.inputKey ??
            data.imageGenerationInputKey ??
            imageGenerationInputKey,
          modelId: data.imageModelId,
          modelName: data.imageModelName,
          nodeId: id,
          ownershipKey: generationRun.ownershipKey ??
            data.imageGenerationOwnershipKey ??
            rawGenerationInputFingerprint,
          parameters: data.imageParameters,
          payload: imageGenerationRequestInput,
          quality: data.imageQuality,
          readBlock() {
            if (!ownsImageGenerationRun(generationRun)) {
              return {
                message: "生成输入已修改，已停止本次取消",
                status: "blocked",
              };
            }
          },
        }),
        graph: graphCommandPort,
        nodeId: id,
        save: {
          flush: async () => undefined,
          async waitForRevision() {
            return { revision: await waitForCanvasRevision() };
          },
        },
        tasks: createBrowserSingleNodeGenerationTaskPort({ accountId }),
      });
      const result = await lifecycle.cancel({ id: cancelableTaskId });
      if (result.status !== "cancelled" || !result.task) return;
      if (!generationRun || !ownsImageGenerationRun(generationRun)) return;
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      setUploadError(result.task.errorMessage ?? "图片生成已取消");
      setRetryTaskId(undefined);
      clearGenerationSubmissionIntent(
        "image",
        canvasId,
        id,
        result.task.id,
        accountId,
      );
      endImageGenerationRun(generationRun);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "取消生成失败",
      );
    }
  };

  useEffect(() => {
    if (
      !persistenceReady ||
      isFixture ||
      generationRunRef.current ||
      data.workflowExecutionRunId
    ) return;
    const persistedTaskId = data.imageGenerationTaskId;
    const persistedInputKey = data.imageGenerationInputKey;
    const persistedOwnershipKey = data.imageGenerationOwnershipKey;
    const catalogReady = imageModelSelection.status === "ready" &&
      Boolean(selectedImageModel);
    const controller = new AbortController();
    imageRecoveryControllerRef.current = controller;
    let pollingOwner:
      | { taskId: string; token: symbol }
      | undefined;
    let generationRun: ImageGenerationRun | undefined;
    let lifecycle: ReturnType<typeof createSingleNodeGenerationLifecycle> |
      undefined;
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
      if (!graphCommandPort) return;
      if (polling) {
        const ownerToken = Symbol(task.id);
        pollingOwner = { taskId: task.id, token: ownerToken };
        recoveredImagePollingTasks.set(task.id, ownerToken);
      }
      const retainPersistedBlock = task.state === "failed" &&
        !recoveredIntent && data.imageGenerationRetryAllowed === false;
      const recoveredTask = retainPersistedBlock
        ? {
            ...task,
            errorCode: data.imageGenerationErrorCode,
            errorMessage: data.imageGenerationError ??
              task.errorMessage ??
              "图片生成失败，请稍后再试",
            retryAllowed: false,
            retryBlockCode: data.imageGenerationRetryBlockCode,
            retryBlockReason: data.imageGenerationRetryBlockReason,
          }
        : task;
      if (recoveredTask.state === "failed") {
        const retryAllowed = safelyRetryableGenerationTask(recoveredTask);
        setUploadError(generationFailureMessage(
          recoveredTask.errorMessage ?? "图片生成失败，请稍后再试",
          retryAllowed ? undefined : recoveredTask.retryBlockReason,
          recoveredTask.errorCode,
          "image",
        ), recoveredTask.errorCode);
        setRetryTaskId(retryAllowed ? recoveredTask.id : undefined);
      }
      lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createImageGenerationAdapter({
          aspectRatio: data.imageAspectRatio,
          bindingOwnershipKey: recoveredOwnershipKey,
          inputKey: persistedInputKey ??
            task.generationInputKey ??
            imageGenerationInputKey,
          modelId: data.imageModelId,
          modelName: data.imageModelName,
          nodeId: id,
          ownershipKey: recoveredOwnershipKey ??
            rawGenerationInputFingerprint,
          parameters: data.imageParameters,
          payload: imageGenerationRequestInput,
          preserveBindingOwnership: true,
          quality: data.imageQuality,
          readBlock() {
            if (
              !generationRun ||
              !ownsImageGenerationRun(generationRun) ||
              (pollingOwner &&
                recoveredImagePollingTasks.get(pollingOwner.taskId) !==
                  pollingOwner.token)
            ) {
              return {
                message: "生成输入已修改，已停止本次恢复",
                status: "blocked",
              };
            }
          },
        }),
        graph: graphCommandPort,
        nodeId: id,
        save: {
          flush: async () => undefined,
          async waitForRevision() {
            return { revision: await waitForCanvasRevision() };
          },
        },
        tasks: createBrowserSingleNodeGenerationTaskPort({
          accountId,
          onPollingPaused(pausedTaskId) {
            if (
              !generationRun ||
              !ownsImageGenerationRun(generationRun) ||
              (pollingOwner &&
                recoveredImagePollingTasks.get(pollingOwner.taskId) !==
                  pollingOwner.token)
            ) return;
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
        }),
      });
      imageRecoveryLifecycleRef.current = lifecycle;
      controller.signal.addEventListener(
        "abort",
        () => lifecycle?.abort("image-recovery-aborted"),
        { once: true },
      );
      let result: SingleNodeLifecycleResult;
      try {
        result = await lifecycle.recover(recoveredTask);
      } catch (error) {
        if (
          pollingPausedTaskIdRef.current === task.id &&
          generationRun &&
          ownsImageGenerationRun(generationRun)
        ) return;
        throw error;
      }
      if (
        controller.signal.aborted ||
        !result.task ||
        result.status === "stale"
      ) return;
      clearGenerationSubmissionIntent(
        "image",
        canvasId,
        id,
        result.task.id,
        accountId,
      );
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        setUploadError("");
        setRetryTaskId(undefined);
      } else if (result.status === "cancelled") {
        setUploadError(result.task.errorMessage ?? "图片生成已取消");
        setRetryTaskId(undefined);
      } else {
        const retryAllowed = safelyRetryableGenerationTask(result.task);
        setUploadError(generationFailureMessage(
          result.task.errorMessage ?? "图片生成失败，请稍后再试",
          retryAllowed ? undefined : result.task.retryBlockReason,
          result.task.errorCode,
          "image",
        ), result.task.errorCode);
        setRetryTaskId(retryAllowed ? result.task.id : undefined);
      }
      if (generationRun) endImageGenerationRun(generationRun);
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
      })
      .finally(() => {
        if (imageRecoveryControllerRef.current === controller) {
          imageRecoveryControllerRef.current = undefined;
        }
        if (imageRecoveryLifecycleRef.current === lifecycle) {
          imageRecoveryLifecycleRef.current = undefined;
        }
      });
    return () => {
      controller.abort();
      if (imageRecoveryControllerRef.current === controller) {
        imageRecoveryControllerRef.current = undefined;
      }
      lifecycle?.abort("image-recovery-unmounted");
      if (imageRecoveryLifecycleRef.current === lifecycle) {
        imageRecoveryLifecycleRef.current = undefined;
      }
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
    data.workflowExecutionRunId,
    graphCommandPort,
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
        dispatchToolUi({ type: "close-transient-ui" });
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [moreOpen]);

  useEffect(() => {
    if (singleNodeChrome) return;
    setLightingOpen(false);
    dispatchToolUi({ type: "close-transient-ui" });
  }, [singleNodeChrome]);

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
                  imageAssetOrigin: "local-upload",
                  imageAnnotations: undefined,
                  imageAspectRatio: undefined,
                  imageGeneratedSuccess: undefined,
                  imageHasTransparency: asset.hasTransparency,
                  imageGenerationErrorCode: undefined,
                  imageGenerationError: undefined,
                  imageGenerationInputKey: undefined,
                  imageGenerationOwnershipKey: undefined,
                  imageGenerationRetryAllowed: undefined,
                  imageGenerationRetryBlockCode: undefined,
                  imageGenerationRetryBlockReason: undefined,
                  imageGenerationTaskId: undefined,
                  imageGenerating: undefined,
                  imageModelId: undefined,
                  imageModelName: undefined,
                  imageMultiAngleParameters: undefined,
                  imageParameters: undefined,
                  imagePrompt: undefined,
                  imageQuality: undefined,
                  imageSeedanceValidation: undefined,
                  imageSrc: asset.url,
                  imageToolMaskAssetId: undefined,
                  imageToolMaskFeatherPixels: undefined,
                  imageToolMaskHeight: undefined,
                  imageToolMaskVersion: undefined,
                  imageToolMaskWidth: undefined,
                  imageToolOperation: undefined,
                  imageToolOperationId: undefined,
                  imageToolOutpaintParameters: undefined,
                  imageToolOutputBackground: undefined,
                  imageToolPreparedAssetId: undefined,
                  imageToolPreparedHeight: undefined,
                  imageToolPreparedVersion: undefined,
                  imageToolPreparedWidth: undefined,
                  imageToolSourceAssetId: undefined,
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
        setUploadError(message, "INPUT_INVALID");
      }
    } finally {
      if (operation === uploadOperation.current) {
        uploadInFlight.current = false;
        uploadBaseline.current = undefined;
      }
    }
  };

  const derivedMediaPort = {
    discard: discardImageAsset,
    async metadata(assetId: string) {
      return trustedMediaPatch(
        await fetchTrustedMediaMetadata("image", assetId),
      );
    },
    upload: uploadPngAsset,
  };

  const applyDerivedImage = async (
    operation: "annotate" | "crop" | "resize-pixels" | "enhance-conservative",
    file: File,
    sourceAssetId: string,
  ) => {
    const source = getNode(id);
    if (!source || source.data.assetId !== sourceAssetId) {
      throw new Error(operation === "crop"
        ? "原图片已发生变化，请重新打开裁剪"
        : "原图片已发生变化，请重新打开图片工具");
    }
    if (!persistenceReadyLive.current) {
      throw new Error("画布尚未完成安全加载");
    }
    if (!graphCommandPort) throw new Error("画布写入端口暂不可用");
    await flushCanvasSave();
    const expectedRevision = await waitForCanvasRevision();
    const operationId = crypto.randomUUID();
    const runId = `image-tool-${operation}-${operationId}`;
    const ownershipKey = generationOwnershipKey({
      accountId,
      canvasId,
      nodeId: id,
      operation,
      operationId,
      sourceAssetId,
    });
    checkpoint();
    const result = await createDerivedImageToolUseCase({
      graph: graphCommandPort,
      media: derivedMediaPort,
      operation,
      size: fitVisualMediaSize,
    }).execute({
      expectedRevision,
      file,
      operationId,
      ownershipKey,
      runId,
      sourceAssetId,
      sourceNodeId: id,
      title: file.name.replace(/\.[^.]+$/, "") ||
        titleControl.committedValue || "Image",
    });
    return result;
  };

  const applyCrop = async (file: File, sourceAssetId: string) => {
    const result = await applyDerivedImage("crop", file, sourceAssetId);
    closeImageTool("crop");
    return result;
  };

  const resizePixels = async (width: number, height: number) => {
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId) throw new Error("图片尚未完成安全保存");
    const file = await resizeLocalImage({
      assetId: sourceAssetId,
      fileName: `${titleControl.committedValue || "Image"}-${width}x${height}.png`,
      height,
      width,
    });
    const result = await applyDerivedImage("resize-pixels", file, sourceAssetId);
    closeImageTool("resize");
    return result;
  };

  const enhanceConservative = async () => {
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId) throw new Error("图片尚未完成安全保存");
    const file = await enhanceConservativeLocalImage({
      assetId: sourceAssetId,
      fileName: `${titleControl.committedValue || "Image"}-保守增强.png`,
    });
    return applyDerivedImage("enhance-conservative", file, sourceAssetId);
  };

  const updateAnnotations = (
    annotations: NonNullable<ProbeNodeType["data"]["imageAnnotations"]>,
  ) => {
    checkpoint();
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, imageAnnotations: annotations } }
      : node));
  };

  const exportAnnotations = async (
    annotations: NonNullable<ProbeNodeType["data"]["imageAnnotations"]>,
  ) => {
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId) throw new Error("图片尚未完成安全保存");
    const file = await renderAnnotatedImage({
      assetId: sourceAssetId,
      document: annotations,
      fileName: `${titleControl.committedValue || "Image"}-annotated.png`,
    });
    const result = await applyDerivedImage("annotate", file, sourceAssetId);
    closeImageTool("annotation");
    return result;
  };

  const quickSplit = async (grid: 2 | 3 | 4) => {
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId) throw new Error("图片尚未完成安全保存");
    if (!graphCommandPort) throw new Error("画布写入端口暂不可用");
    const files = await splitLocalImage({
      assetId: sourceAssetId,
      fileNamePrefix: titleControl.committedValue || "Image",
      grid,
    });
    await flushCanvasSave();
    const expectedRevision = await waitForCanvasRevision();
    const operationId = crypto.randomUUID();
    const runId = `image-tool-quick-split-${operationId}`;
    const ownershipKey = generationOwnershipKey({
      accountId,
      canvasId,
      nodeId: id,
      operation: "quick-split",
      operationId,
      sourceAssetId,
    });
    checkpoint();
    const result = await createBatchDerivedImageToolUseCase({
      graph: graphCommandPort,
      media: derivedMediaPort,
      operation: "quick-split",
      size: fitVisualMediaSize,
    }).execute({
      expectedRevision,
      files,
      grid,
      operationId,
      ownershipKey,
      runId,
      sourceAssetId,
      sourceNodeId: id,
      title: titleControl.committedValue || "Image",
    });
    closeImageTool("split");
    return result;
  };

  const submitMultiAngle = async (angle: MultiAngle) => {
    if (multiAngleBusy) return;
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId) {
      setMultiAngleError("图片尚未完成安全保存");
      return;
    }
    if (!graphCommandPort) {
      setMultiAngleError("画布尚未完成安全加载");
      return;
    }
    const model = imageModels?.find((candidate) =>
      candidate.id === multiAngleCapability.modelId
    );
    if (!model || model.generationAvailable === false ||
        !multiAngleCapability.supportsReferenceImage) {
      setMultiAngleError("当前多角度模型不支持安全参考图输入");
      return;
    }
    const schema = model.parameterSchema ?? defaultParameterSchema("image");
    const modelParameters = imageToolSubmissionParameterValues(
      schema,
      data.imageParameters,
    );
    const aspectRatio = supportedImageValue(
      model.imageParameters?.aspectRatios ?? ["auto"],
      String(modelParameters.aspectRatio ?? "auto"),
    );
    const quality = supportedImageValue(
      model.imageParameters?.qualities ?? ["auto"],
      String(modelParameters.quality ?? "auto"),
    );
    const parameters = {
      distance: angle.scale,
      horizontalDegrees: angle.rotation,
      verticalDegrees: angle.tilt,
      wideAngle: angle.wide,
    } as const;
    const operationId = crypto.randomUUID();
    const prompt = multiAnglePrompt(parameters);
    const ownershipKey = generationOwnershipKey(multiAngleOwnershipEvidence({
      accountId,
      aspectRatio,
      canvasId,
      modelId: model.id,
      modelParameters,
      operationId,
      parameters,
      prompt,
      quality,
      sourceAssetId,
      sourceNodeId: id,
    }));
    setMultiAngleBusy(true);
    setMultiAngleError("");
    try {
      await flushCanvasSave();
      const expectedRevision = await waitForCanvasRevision();
      checkpoint();
      await createMultiAngleImageToolUseCase({
        async afterPlaceholderCreated() {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
          await flushCanvasSave();
          await waitForCanvasRevision();
        },
        capability: multiAngleCapability,
        graph: graphCommandPort,
        createLifecycle(plan) {
          return createSingleNodeGenerationLifecycle({
            adapter: createImageGenerationAdapter({
              aspectRatio: plan.aspectRatio,
              inputKey: plan.inputKey,
              modelId: plan.modelId,
              modelName: plan.modelName,
              nodeId: plan.nodeId,
              ownershipKey: plan.ownershipKey,
              parameters: plan.modelParameters,
              payload: plan.payload,
              quality: plan.quality,
              readBlock() {
                const snapshot = graphCommandPort.snapshot();
                const source = snapshot.nodes.find((node) => node.id === id);
                const target = snapshot.nodes.find((node) =>
                  node.id === plan.nodeId
                );
                if (
                  !source || source.type !== "image" ||
                  source.data.assetId !== sourceAssetId ||
                  !target || target.type !== "image" ||
                  target.data.imageToolOperation !== "multi-angle" ||
                  target.data.imageToolSourceAssetId !== sourceAssetId
                ) {
                  return {
                    message: "多角度来源或任务占位已变化，已停止提交",
                    status: "blocked",
                  };
                }
              },
            }),
            graph: graphCommandPort,
            nodeId: plan.nodeId,
            save: {
              async flush() {
                await new Promise<void>((resolve) =>
                  requestAnimationFrame(() => resolve())
                );
                await flushCanvasSave();
              },
              async waitForRevision() {
                return { revision: await waitForCanvasRevision() };
              },
            },
            tasks: createBrowserSingleNodeGenerationTaskPort({ accountId }),
          });
        },
      }).execute({
        aspectRatio,
        canvasId,
        expectedRevision,
        modelId: model.id,
        modelName: model.displayName,
        modelParameters,
        operationId,
        ownershipKey,
        parameters,
        quality,
        runId: `image-tool-multi-angle-${operationId}`,
        sourceAssetId,
        sourceNodeId: id,
        title: titleControl.committedValue || "Image",
      });
      closeImageTool("multi-angle");
    } catch (error) {
      setMultiAngleError(
        error instanceof Error ? error.message : "多角度任务提交失败",
      );
    } finally {
      setMultiAngleBusy(false);
    }
  };

  const submitRedraw = async (input: Readonly<{
    featherPixels: number;
    maskFile: File;
    prompt: string;
  }>) => {
    if (redrawBusy) return;
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId) {
      setRedrawError("图片尚未完成安全保存");
      return;
    }
    if (!graphCommandPort) {
      setRedrawError("画布尚未完成安全加载");
      return;
    }
    const model = imageModels?.find((candidate) =>
      candidate.id === redrawCapability.modelId
    );
    if (!model || model.generationAvailable === false ||
        !redrawCapability.supportsReferenceImage) {
      setRedrawError("当前重绘模型不支持安全参考图输入");
      return;
    }
    const schema = model.parameterSchema ?? defaultParameterSchema("image");
    const modelParameters = imageToolSubmissionParameterValues(
      schema,
      data.imageParameters,
    );
    const requestedAspectRatio = supportedImageValue(
      model.imageParameters?.aspectRatios ?? ["auto"],
      String(modelParameters.aspectRatio ?? "auto"),
    );
    const requestedQuality = supportedImageValue(
      model.imageParameters?.qualities ?? ["auto"],
      String(modelParameters.quality ?? "auto"),
    );
    const operationId = crypto.randomUUID();
    const preOwnershipKey = generationOwnershipKey({
      accountId,
      canvasId,
      featherPixels: input.featherPixels,
      operation: "redraw",
      operationId,
      prompt: input.prompt.trim(),
      sourceAssetId,
      sourceNodeId: id,
    });
    setRedrawBusy(true);
    setRedrawError("");
    try {
      await flushCanvasSave();
      const expectedRevision = await waitForCanvasRevision();
      checkpoint();
      await createRedrawImageToolUseCase({
        async afterPlaceholderCreated() {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
          await flushCanvasSave();
          await waitForCanvasRevision();
        },
        capability: redrawCapability,
        graph: graphCommandPort,
        media: derivedMediaPort,
        ownershipKey: generationOwnershipKey,
        createLifecycle(plan) {
          return createSingleNodeGenerationLifecycle({
            adapter: createImageGenerationAdapter({
              aspectRatio: plan.aspectRatio,
              inputKey: plan.inputKey,
              modelId: plan.modelId,
              modelName: plan.modelName,
              nodeId: plan.nodeId,
              ownershipKey: plan.ownershipKey,
              parameters: plan.modelParameters,
              payload: plan.payload,
              quality: plan.quality,
              readBlock() {
                const snapshot = graphCommandPort.snapshot();
                const source = snapshot.nodes.find((node) => node.id === id);
                const target = snapshot.nodes.find((node) =>
                  node.id === plan.nodeId
                );
                if (
                  !source || source.type !== "image" ||
                  source.data.assetId !== sourceAssetId ||
                  !target || target.type !== "image" ||
                  target.data.imageToolOperation !== "redraw" ||
                  target.data.imageToolSourceAssetId !== sourceAssetId ||
                  !target.data.imageToolMaskAssetId
                ) {
                  return {
                    message: "重绘来源、遮罩或任务占位已变化，已停止提交",
                    status: "blocked",
                  };
                }
              },
            }),
            graph: graphCommandPort,
            nodeId: plan.nodeId,
            save: {
              async flush() {
                await new Promise<void>((resolve) =>
                  requestAnimationFrame(() => resolve())
                );
                await flushCanvasSave();
              },
              async waitForRevision() {
                return { revision: await waitForCanvasRevision() };
              },
            },
            tasks: createBrowserSingleNodeGenerationTaskPort({ accountId }),
          });
        },
      }).execute({
        accountId,
        aspectRatio: requestedAspectRatio,
        canvasId,
        expectedRevision,
        featherPixels: input.featherPixels,
        maskFile: input.maskFile,
        modelId: model.id,
        modelName: model.displayName,
        modelParameters,
        operationId,
        preOwnershipKey,
        prompt: input.prompt,
        quality: requestedQuality,
        runId: `image-tool-redraw-${operationId}`,
        sourceAssetId,
        sourceNodeId: id,
        title: titleControl.committedValue || "Image",
      });
      closeImageTool("redraw");
    } catch (caught) {
      setRedrawError(
        caught instanceof Error ? caught.message : "重绘任务提交失败",
      );
    } finally {
      setRedrawBusy(false);
    }
  };

  const submitOutpaintErase = async (
    operation: OutpaintEraseOperation,
    input: Readonly<{
      featherPixels: number;
      maskFile: File;
      outpaint?: import("../../../types/imageTools").ImageOutpaintParameters;
      preparedFile?: File;
      prompt: string;
    }>,
  ) => {
    const busy = operation === "outpaint" ? outpaintBusy : eraseBusy;
    if (busy) return;
    const setBusy = operation === "outpaint" ? setOutpaintBusy : setEraseBusy;
    const setError = operation === "outpaint" ? setOutpaintError : setEraseError;
    const capability = operation === "outpaint" ? outpaintCapability : eraseCapability;
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId || !graphCommandPort) {
      setError(!sourceAssetId ? "图片尚未完成安全保存" : "画布尚未完成安全加载");
      return;
    }
    const model = imageModels?.find((candidate) => candidate.id === capability.modelId);
    if (!model || model.generationAvailable === false ||
        !capability.supportsReferenceImage) {
      setError(`当前${operation === "outpaint" ? "扩图" : "擦除"}模型不支持安全参考图输入`);
      return;
    }
    const schema = model.parameterSchema ?? defaultParameterSchema("image");
    const modelParameters = imageToolSubmissionParameterValues(
      schema,
      data.imageParameters,
    );
    const requestedAspectRatio = supportedImageValue(
      model.imageParameters?.aspectRatios ?? ["auto"],
      String(modelParameters.aspectRatio ?? "auto"),
    );
    const requestedQuality = supportedImageValue(
      model.imageParameters?.qualities ?? ["auto"],
      String(modelParameters.quality ?? "auto"),
    );
    const operationId = crypto.randomUUID();
    const preOwnershipKey = generationOwnershipKey({ accountId, canvasId,
      operation, operationId, outpaint: input.outpaint,
      prompt: input.prompt.trim(), sourceAssetId, sourceNodeId: id });
    setBusy(true);
    setError("");
    try {
      await flushCanvasSave();
      const expectedRevision = await waitForCanvasRevision();
      checkpoint();
      await createOutpaintEraseImageToolUseCase({
        async afterPlaceholderCreated() {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await flushCanvasSave();
          await waitForCanvasRevision();
        },
        capability,
        graph: graphCommandPort,
        media: derivedMediaPort,
        operation,
        ownershipKey: generationOwnershipKey,
        createLifecycle(plan) {
          return createSingleNodeGenerationLifecycle({
            adapter: createImageGenerationAdapter({
              aspectRatio: plan.aspectRatio, inputKey: plan.inputKey,
              modelId: plan.modelId, modelName: plan.modelName, nodeId: plan.nodeId,
              ownershipKey: plan.ownershipKey, parameters: plan.modelParameters,
              payload: plan.payload, quality: plan.quality,
              readBlock() {
                const snapshot = graphCommandPort.snapshot();
                const source = snapshot.nodes.find((node) => node.id === id);
                const target = snapshot.nodes.find((node) => node.id === plan.nodeId);
                if (!source || source.type !== "image" ||
                    source.data.assetId !== sourceAssetId || !target ||
                    target.type !== "image" ||
                    target.data.imageToolOperation !== operation ||
                    target.data.imageToolSourceAssetId !== sourceAssetId ||
                    !target.data.imageToolMaskAssetId ||
                    (operation === "outpaint" && !target.data.imageToolPreparedAssetId)) {
                  return { message: `${operation === "outpaint" ? "扩图" : "擦除"}来源或任务占位已变化，已停止提交`,
                    status: "blocked" };
                }
              },
            }),
            graph: graphCommandPort, nodeId: plan.nodeId,
            save: {
              async flush() {
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                await flushCanvasSave();
              },
              async waitForRevision() {
                return { revision: await waitForCanvasRevision() };
              },
            },
            tasks: createBrowserSingleNodeGenerationTaskPort({ accountId }),
          });
        },
      }).execute({ accountId, aspectRatio: requestedAspectRatio, canvasId,
        expectedRevision, featherPixels: input.featherPixels,
        maskFile: input.maskFile, modelId: model.id, modelName: model.displayName,
        modelParameters, operationId, outpaint: input.outpaint,
        preOwnershipKey, preparedFile: input.preparedFile, prompt: input.prompt,
        quality: requestedQuality, runId: `image-tool-${operation}-${operationId}`,
        sourceAssetId, sourceNodeId: id, title: titleControl.committedValue || "Image" });
      closeImageTool(operation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message :
        `${operation === "outpaint" ? "扩图" : "擦除"}任务提交失败`);
    } finally {
      setBusy(false);
    }
  };

  const submitPromptGeneration = async (
    operation: PromptGenerationOperation,
    prompt: string,
  ) => {
    const setBusy = operation === "enhance-creative" ? setEnhanceBusy : setCutoutBusy;
    const setError = operation === "enhance-creative" ? setEnhanceError : setCutoutError;
    const capability = operation === "enhance-creative"
      ? creativeEnhanceCapability : removeBackgroundCapability;
    const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
    if (!sourceAssetId || !graphCommandPort) {
      setError(!sourceAssetId ? "图片尚未完成安全保存" : "画布尚未完成安全加载");
      return;
    }
    const model = imageModels?.find((candidate) => candidate.id === capability.modelId);
    if (!model || model.generationAvailable === false ||
        !capability.supportsReferenceImage) {
      setError("当前模型不支持安全参考图输入");
      return;
    }
    const schema = model.parameterSchema ?? defaultParameterSchema("image");
    const modelParameters = imageToolSubmissionParameterValues(
      schema,
      data.imageParameters,
    );
    const requestedAspectRatio = supportedImageValue(
      model.imageParameters?.aspectRatios ?? ["auto"],
      String(modelParameters.aspectRatio ?? "auto"));
    const requestedQuality = supportedImageValue(
      model.imageParameters?.qualities ?? ["auto"],
      String(modelParameters.quality ?? "auto"));
    const operationId = crypto.randomUUID();
    const preOwnershipKey = generationOwnershipKey({ accountId, canvasId,
      operation, operationId, prompt, sourceAssetId, sourceNodeId: id });
    setBusy(true);
    setError("");
    try {
      await flushCanvasSave();
      const expectedRevision = await waitForCanvasRevision();
      checkpoint();
      await createPromptGenerationImageToolUseCase({
        async afterPlaceholderCreated() {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await flushCanvasSave();
          await waitForCanvasRevision();
        }, capability, graph: graphCommandPort, operation,
        ownershipKey: generationOwnershipKey,
        createLifecycle(plan) {
          return createSingleNodeGenerationLifecycle({
            adapter: createImageGenerationAdapter({ aspectRatio: plan.aspectRatio,
              inputKey: plan.inputKey, modelId: plan.modelId,
              modelName: plan.modelName, nodeId: plan.nodeId,
              ownershipKey: plan.ownershipKey, parameters: plan.modelParameters,
              payload: plan.payload, quality: plan.quality,
              readBlock() {
                const snapshot = graphCommandPort.snapshot();
                const source = snapshot.nodes.find((node) => node.id === id);
                const target = snapshot.nodes.find((node) => node.id === plan.nodeId);
                if (!source || source.type !== "image" ||
                    source.data.assetId !== sourceAssetId || !target ||
                    target.type !== "image" ||
                    target.data.imageToolOperation !== operation ||
                    target.data.imageToolOutputBackground !==
                      (operation === "remove-background" ? "transparent" : undefined) ||
                    target.data.imageToolSourceAssetId !== sourceAssetId) {
                  return { message: "图片处理来源或任务占位已变化，已停止提交",
                    status: "blocked" };
                }
              } }), graph: graphCommandPort, nodeId: plan.nodeId,
            save: { async flush() {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              await flushCanvasSave();
            }, async waitForRevision() {
              return { revision: await waitForCanvasRevision() };
            } }, tasks: createBrowserSingleNodeGenerationTaskPort({ accountId }) });
        },
      }).execute({ accountId, aspectRatio: requestedAspectRatio, canvasId,
        expectedRevision, modelId: model.id, modelName: model.displayName,
        modelParameters, operationId, preOwnershipKey, prompt,
        quality: requestedQuality, runId: `image-tool-${operation}-${operationId}`,
        sourceAssetId, sourceNodeId: id, title: titleControl.committedValue || "Image" });
      closeImageTool(operation === "enhance-creative" ? "enhance" : "cutout");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片处理任务提交失败");
    } finally { setBusy(false); }
  };

  const toggleColorMark = (color: string) => {
    if (imageColorFilter === color && data.imageColorMarks?.includes(color)) {
      setImageColorFilter();
    }
    checkpoint();
    setNodes((nodes) => nodes.map((node) => {
      if (node.id !== id) return node;
      const current = node.data.imageColorMarks ?? [];
      const next = current.includes(color)
        ? current.filter((item) => item !== color)
        : [...current, color];
      return {
        ...node,
        data: {
          ...node.data,
          imageColorMarks: next.length > 0 ? next : undefined,
        },
      };
    }));
  };

  const download = () => {
    if (!preview) return;
    void imageToolDispatcher.execute("download", {
      fileName: `${titleControl.committedValue || "Image"}.png`,
      sourceUrl: preview,
    });
  };

  const imageToolDispatcher = createImageToolDispatcher()
    .register({
      operation: "crop",
      execute: (input: Readonly<{ file: File; sourceAssetId: string }>) =>
        applyCrop(input.file, input.sourceAssetId),
    })
    .register({
      operation: "resize-pixels",
      execute: (input: Readonly<{ height: number; width: number }>) =>
        resizePixels(input.width, input.height),
    })
    .register({
      operation: "quick-split",
      execute: (input: Readonly<{ grid: 2 | 3 | 4 }>) =>
        quickSplit(input.grid),
    })
    .register({
      operation: "enhance-conservative",
      execute: () => enhanceConservative(),
    })
    .register({
      operation: "annotate",
      execute: (input: Readonly<{
        annotations: NonNullable<ProbeNodeType["data"]["imageAnnotations"]>;
      }>) => exportAnnotations(input.annotations),
    })
    .register(createSaveLibraryAssetUseCase())
    .register(createDownloadImageToolUseCase())
    .register(createFullscreenImageToolUseCase());

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
        isVisible={Boolean(preview && singleNodeChrome && !generating && !uploading)}
        offset={28}
        position={Position.Top}
      >
        <button
          aria-label="裁剪"
          data-tooltip={typeof data.assetId === "string" && data.assetId
            ? "裁剪"
            : "图片尚未完成安全保存"}
          disabled={typeof data.assetId !== "string" || !data.assetId}
          onClick={(event) => {
            setCropVisualPreview(
              freezeReusableCropVisualPreview(previewImageRef.current),
            );
            setCropSourceAssetId(
              typeof data.assetId === "string" ? data.assetId : undefined,
            );
            openImageTool("crop", event.currentTarget);
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M5.5 2.5v10A2 2 0 0 0 7.5 14.5h10M2.5 5.5h10a2 2 0 0 1 2 2v10" />
          </svg>
        </button>
        <button
          aria-label="多角度"
          data-capability-status={multiAngleCapability.status}
          data-tooltip={multiAngleCapability.status === "available"
            ? "多角度"
            : multiAngleCapability.reason}
          onClick={(event) => openImageTool("multi-angle", event.currentTarget)}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m10 3 6 3.5v7L10 17l-6-3.5v-7Z" />
            <path d="m4 6.5 6 3.5 6-3.5M10 10v7M13.5 2.5h3v3" />
          </svg>
        </button>
        <button
          aria-label="重绘"
          data-capability-status={redrawCapability.status}
          data-tooltip={redrawCapability.status === "available"
            ? "重绘"
            : redrawCapability.reason}
          onClick={(event) => {
            setRedrawError("");
            openImageTool("redraw", event.currentTarget);
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
            dispatchToolUi({ type: "close-transient-ui" });
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
            onClick={() => dispatchToolUi({ type: "toggle-more-menu" })}
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
              {([
                ["扩图", "expand", outpaintCapability],
                ["擦除", "erase", eraseCapability],
                ["标注", "mark", undefined],
                ["增强", "enhance", creativeEnhanceCapability],
                ["调整像素", "pixels", undefined],
                ["抠图", "cutout", removeBackgroundCapability],
              ] as const).map(([label, icon, toolCapability]) => (
                <button
                  data-capability-status={toolCapability?.status}
                  disabled={!(["调整像素", "标注", "扩图", "擦除", "增强", "抠图"] as string[]).includes(label)}
                  key={label}
                  onClick={(event) => {
                    setEraseError("");
                    setOutpaintError("");
                    setEnhanceError("");
                    setCutoutError("");
                    const tool = ({
                      "扩图": "outpaint",
                      "擦除": "erase",
                      "标注": "annotation",
                      "增强": "enhance",
                      "调整像素": "resize",
                      "抠图": "cutout",
                    } as const)[label];
                    openImageTool(
                      tool,
                      moreRef.current?.querySelector<HTMLElement>("button"),
                    );
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span aria-hidden="true" className={`image-more-icon ${icon}`} />
                  {label}
                </button>
              ))}
              <button
                disabled={typeof data.assetId !== "string" || !data.assetId}
                onClick={() => openImageTool(
                  "seedance",
                  moreRef.current?.querySelector<HTMLElement>("button"),
                )}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true" className="image-more-icon seedance" />
                <span>角色可信素材</span>
              </button>
              <button
                aria-label="角色风险预检（当前不可用）"
                disabled
                role="menuitem"
                title="当前没有满足合同与隐私要求的正式审核 Provider"
                type="button"
              >
                <span aria-hidden="true" className="image-more-icon seedance" />
                <span>角色风险预检（当前不可用）</span>
              </button>
              <button
                onClick={() => openImageTool(
                  "split",
                  moreRef.current?.querySelector<HTMLElement>("button"),
                )}
                role="menuitem"
                type="button"
              >
                <span aria-hidden="true" className="image-more-icon split" />
                <span>快速切分</span>
                <span className="image-more-sizes">2×2　3×3　4×4　›</span>
              </button>
            </div>
          )}
        </span>
        <span className="media-node-toolbar-divider" />
        <span className="image-color-mark-wrap">
          <button
            aria-expanded={colorMarksOpen}
            aria-label="颜色标记"
            data-tooltip="颜色标记"
            onClick={() => dispatchToolUi({ type: "toggle-color-menu" })}
            type="button"
          >
            <span
              className="media-node-color"
              style={{
                background: imageColorMarks.find(([color]) =>
                  data.imageColorMarks?.includes(color))?.[2],
              }}
            />
          </button>
          {colorMarksOpen && (
            <div
              aria-label="图片颜色标记"
              className="image-color-mark-menu"
              data-testid="image-color-mark-menu"
              role="menu"
            >
              {imageColorMarks.map(([color, label, value]) => (
                <span key={color}>
                  <button
                    aria-checked={data.imageColorMarks?.includes(color) ?? false}
                    aria-label={`${label}标记`}
                    onClick={() => toggleColorMark(color)}
                    role="menuitemcheckbox"
                    type="button"
                  ><i style={{ background: value }} />{label}</button>
                  <button
                    aria-pressed={imageColorFilter === color}
                    aria-label={`只看${label}标记`}
                    disabled={!data.imageColorMarks?.includes(color)}
                    onClick={() => setImageColorFilter(
                      imageColorFilter === color ? undefined : color,
                    )}
                    type="button"
                  >筛</button>
                </span>
              ))}
              {imageColorFilter && (
                <button onClick={() => setImageColorFilter()} type="button">
                  清除筛选
                </button>
              )}
            </div>
          )}
        </span>
        <span className="media-node-toolbar-divider" />
        <button
          aria-label="保存到素材库"
          data-library-state={librarySaveState}
          data-tooltip={librarySaveState === "saved" ? "已保存到素材库" : "保存到素材库"}
          disabled={typeof data.assetId !== "string" ||
            !data.assetId || librarySaveState === "saving"}
          onClick={() => {
            const sourceAssetId = typeof data.assetId === "string"
              ? data.assetId
              : "";
            if (!sourceAssetId) return;
            setLibrarySaveState("saving");
            setUploadError("");
            void imageToolDispatcher.execute("save-to-library", {
              assetId: sourceAssetId,
              kind: "image",
              label: titleControl.committedValue || "Image",
            }).then(() => {
              setLibrarySaveState("saved");
            }).catch((failure: unknown) => {
              setLibrarySaveState("idle");
              setUploadError(
                failure instanceof Error ? failure.message : "素材保存失败",
              );
            });
          }}
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
          data-tooltip={mediaLoad.failed ? "图片加载失败，暂时无法查看详情" : "全屏查看"}
          disabled={mediaLoad.failed}
          onClick={(event) => void imageToolDispatcher.execute("fullscreen", {
            open: () => openImageTool("fullscreen", event.currentTarget),
          })}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M8 3H3v5M12 3h5v5M3 12v5h5M17 12v5h-5" />
          </svg>
        </button>
      </NodeToolbar>
      <ImageToolHost
        activeTool={activeImageTool}
        anchor={imageToolTriggerRef.current}
        busy={imageToolBusy}
        onClose={closeImageTool}
        returnFocus={imageToolTriggerRef.current}
      >
        {preview && cropOpen && cropSourceAssetId && (
          <ImageToolSurface className="image-tool-editor-surface">
            <ImageCropEditor
              assetId={cropSourceAssetId}
              onCancel={() => closeImageTool("crop")}
              onConfirm={async (file, sourceAssetId) => {
                await imageToolDispatcher.execute("crop", { file, sourceAssetId });
              }}
              title={titleControl.committedValue}
              transparent={imageShowsTransparency}
              visualPreview={cropVisualPreview}
            />
          </ImageToolSurface>
        )}
        {preview && localToolOpen === "resize" && (
          <ImageResizePanel
            initialHeight={data.mediaHeight ??
              previewImageRef.current?.naturalHeight ?? 1024}
            initialWidth={data.mediaWidth ??
              previewImageRef.current?.naturalWidth ?? 1024}
            onBusyChange={setLocalToolBusy}
            onCancel={() => closeImageTool("resize")}
            onConfirm={async (width, height) => {
              await imageToolDispatcher.execute("resize-pixels", { height, width });
            }}
          />
        )}
        {preview && localToolOpen === "split" && (
          <ImageToolSurface className="image-tool-split-shell">
            <ImageSplitPanel
              onBusyChange={setLocalToolBusy}
              onCancel={() => closeImageTool("split")}
              onConfirm={async (grid) => {
                await imageToolDispatcher.execute("quick-split", { grid });
              }}
              preview={preview}
              previewBounds={splitVisibleBounds}
              previewBusy={splitPreviewBusy}
              previewError={splitPreviewError}
            />
          </ImageToolSurface>
        )}
        {preview && enhanceOpen && (
          <div className="image-tool-compact-panel" data-testid="image-enhance-panel">
            <header className="image-tool-panel-header">
              <span><strong>增强图片</strong><small>选择保守处理或创意生成</small></span>
              <button aria-label="关闭增强图片" disabled={enhanceBusy}
                onClick={() => closeImageTool("enhance")} type="button">×</button>
            </header>
            <div className="image-tool-panel-body image-enhance-options">
              <p>保守增强只做轻量清晰度与色彩校正，不改变构图。</p>
              <button disabled={enhanceBusy} onClick={() => {
                setEnhanceBusy(true); setEnhanceError("");
                void imageToolDispatcher.execute("enhance-conservative", {})
                  .then(() => closeImageTool("enhance"))
                  .catch((error: unknown) => setEnhanceError(error instanceof Error
                    ? error.message : "保守增强失败"))
                  .finally(() => setEnhanceBusy(false));
              }} type="button"><strong>保守增强</strong><small>本地处理 · 不新增内容</small></button>
              <button disabled={enhanceBusy || creativeEnhanceCapability.status !== "available"}
                onClick={() => void submitPromptGeneration("enhance-creative",
                  creativeEnhancePrompt)}
                type="button"><strong>创意增强</strong><small>会生成新细节 · 需要模型能力</small></button>
              <div className="image-tool-task-prompt">
                <strong>创意增强任务指令</strong><span>{creativeEnhancePrompt}</span>
              </div>
              {enhanceError && <div role="alert">{enhanceError}</div>}
            </div>
            <footer className="image-tool-panel-footer">
              <button disabled={enhanceBusy} onClick={() => closeImageTool("enhance")}
                type="button">取消</button>
            </footer>
          </div>
        )}
        {preview && cutoutOpen && (
          <ImageToolSurface>
            <div className="image-tool-compact-panel image-processing-alpha"
              data-testid="image-cutout-panel">
              <header className="image-tool-panel-header">
                <span><strong>主体抠图</strong><small>由图片模型生成透明 PNG</small></span>
                <button aria-label="关闭主体抠图" disabled={cutoutBusy}
                  onClick={() => closeImageTool("cutout")} type="button">×</button>
              </header>
              <div className="image-tool-panel-body">
                <p>移除背景并保留主体边缘。棋盘格仅用于预览透明区域，不会写入图片。</p>
                <div className="image-tool-task-prompt">
                  <strong>任务指令</strong><span>{removeBackgroundPrompt}</span>
                </div>
                {cutoutError && <div role="alert">{cutoutError}</div>}
              </div>
              <footer className="image-tool-panel-footer">
                <button disabled={cutoutBusy} onClick={() => closeImageTool("cutout")}
                  type="button">取消</button>
                <button className="primary"
                  aria-label="生成透明PNG"
                  disabled={cutoutBusy || removeBackgroundCapability.status !== "available"}
                  onClick={() => void submitPromptGeneration("remove-background",
                    removeBackgroundPrompt)}
                  type="button">{cutoutBusy ? "生成中…" : "生成透明 PNG"}</button>
              </footer>
            </div>
          </ImageToolSurface>
        )}
        {preview && annotationOpen && (
          <ImageToolSurface className="image-tool-editor-surface">
            <ImageAnnotationEditor
              document={data.imageAnnotations ?? emptyImageAnnotationDocument(
                data.mediaWidth ?? previewImageRef.current?.naturalWidth ?? 1280,
                data.mediaHeight ?? previewImageRef.current?.naturalHeight ?? 720,
              )}
              onBusyChange={setAnnotationBusy}
              onChange={updateAnnotations}
              onClose={() => closeImageTool("annotation")}
              onExport={async (annotations) => {
                await imageToolDispatcher.execute("annotate", { annotations });
              }}
              src={preview}
              transparent={imageShowsTransparency}
            />
          </ImageToolSurface>
        )}
        {preview && redrawOpen && (
          <ImageToolSurface className="image-tool-editor-surface">
            <ImageRedrawEditor
              busy={redrawBusy}
              capability={redrawCapability}
              error={redrawError}
              onClose={() => closeImageTool("redraw")}
              onError={setRedrawError}
              onSubmit={submitRedraw}
              src={preview}
              transparent={imageShowsTransparency}
            />
          </ImageToolSurface>
        )}
        {preview && eraseOpen && (
          <ImageToolSurface className="image-tool-editor-surface">
            <ImageRedrawEditor
              busy={eraseBusy}
              capability={eraseCapability}
              error={eraseError}
              onClose={() => closeImageTool("erase")}
              onError={setEraseError}
              onSubmit={(input) => submitOutpaintErase("erase", input)}
              operation="erase"
              src={preview}
              transparent={imageShowsTransparency}
            />
          </ImageToolSurface>
        )}
        {preview && outpaintOpen && (
          <ImageToolSurface className="image-tool-editor-surface">
            <ImageOutpaintEditor
              busy={outpaintBusy}
              capability={outpaintCapability}
              error={outpaintError}
              naturalHeight={data.mediaHeight ?? previewImageRef.current?.naturalHeight ?? 720}
              naturalWidth={data.mediaWidth ?? previewImageRef.current?.naturalWidth ?? 1280}
              onClose={() => closeImageTool("outpaint")}
              onSubmit={async ({ marginPercent, prompt }) => {
                const sourceAssetId = typeof data.assetId === "string" ? data.assetId : "";
                if (!sourceAssetId) {
                  setOutpaintError("图片尚未完成安全保存");
                  return;
                }
                setOutpaintBusy(true);
                setOutpaintError("");
                try {
                  const sourceWidth = data.mediaWidth ?? previewImageRef.current?.naturalWidth ?? 0;
                  const sourceHeight = data.mediaHeight ?? previewImageRef.current?.naturalHeight ?? 0;
                  const horizontal = Math.max(1, Math.round(sourceWidth * marginPercent / 100 / 2));
                  const vertical = Math.max(1, Math.round(sourceHeight * marginPercent / 100 / 2));
                  const prepared = await prepareOutpaintImages({ assetId: sourceAssetId,
                    fileNamePrefix: `image-outpaint-${crypto.randomUUID()}`,
                    outputHeight: sourceHeight + vertical * 2,
                    outputWidth: sourceWidth + horizontal * 2,
                    sourceX: horizontal, sourceY: vertical });
                  setOutpaintBusy(false);
                  await submitOutpaintErase("outpaint", { featherPixels: 0,
                    maskFile: prepared.maskFile, outpaint: prepared.parameters,
                    preparedFile: prepared.preparedFile, prompt });
                } catch (caught) {
                  setOutpaintError(caught instanceof Error ? caught.message : "扩图输入准备失败");
                  setOutpaintBusy(false);
                }
              }}
              src={preview}
              transparent={imageShowsTransparency}
            />
          </ImageToolSurface>
        )}
        {preview && multiAngleOpen && (
          <ImageMultiAnglePanel
            busy={multiAngleBusy}
            capability={multiAngleCapability}
            error={multiAngleError}
            onClose={() => closeImageTool("multi-angle")}
            onSubmit={submitMultiAngle}
            src={preview}
            transparent={imageShowsTransparency}
          />
        )}
        {preview && seedanceOpen && typeof data.assetId === "string" &&
            data.assetId && (
          <SeedanceTrustedAssetPanel
            assetId={data.assetId}
            onBusyChange={setSeedanceBusy}
            onClose={() => closeImageTool("seedance")}
          />
        )}
        {fullscreen && preview && !mediaLoad.failed && (
          <ImageToolSurface className="image-detail-surface">
            <div className="image-detail-dialog" data-testid="image-detail">
              <div className="image-detail-viewer">
                <img
                  alt={titleControl.committedValue || "图片预览"}
                  className={`image-detail-preview${
                    imageShowsTransparency
                      ? " image-transparent-preview"
                      : ""
                  }`}
                  data-testid="image-detail-preview"
                  src={preview}
                />
              </div>
              <aside className="image-detail-panel" data-testid="image-detail-panel">
                <section>
                  <h3>提示词</h3>
                  <div className="image-detail-prompt">
                    {data.imagePrompt?.trim() || "—"}
                  </div>
                </section>
                <section>
                  <h3>信息</h3>
                  <dl className="image-detail-info">
                    <div><dt>来源</dt><dd>{data.imageAssetOrigin === "local-upload"
                      ? "本地上传"
                      : data.imageToolOperation
                      ? imageToolSourceLabels[data.imageToolOperation] ?? "图片工具输出"
                      : data.imageModelName ? "AI生成" : "—"}</dd></div>
                    <div><dt>模型</dt><dd>{data.imageModelName || "—"}</dd></div>
                    <div><dt>尺寸</dt><dd>{(() => {
                      const detailWidth = data.mediaWidth ?? previewImageRef.current?.naturalWidth;
                      const detailHeight = data.mediaHeight ?? previewImageRef.current?.naturalHeight;
                      return detailWidth && detailHeight
                        ? `${detailWidth} × ${detailHeight}`
                        : "—";
                    })()}</dd></div>
                    <div><dt>宽高比</dt><dd>{imageDetailRatio(
                      data.mediaWidth ?? previewImageRef.current?.naturalWidth ?? 0,
                      data.mediaHeight ?? previewImageRef.current?.naturalHeight ?? 0,
                      data.imageAspectRatio,
                    )}</dd></div>
                    <div><dt>质量</dt><dd>{data.imageQuality
                      ? imageQualityLabels[data.imageQuality] ?? data.imageQuality
                      : "—"}</dd></div>
                    <div><dt>文件大小</dt><dd>{imageDetailFileSize(data.mediaByteSize)}</dd></div>
                    <div><dt>来源素材</dt><dd>{data.imageToolSourceAssetId || "—"}</dd></div>
                    {data.imageSeedanceValidation && (
                      <div><dt>旧版记录</dt><dd>{legacySeedancePreflightSummary(
                        data.imageSeedanceValidation,
                      )}</dd></div>
                    )}
                    <div><dt>创建日期</dt><dd>—</dd></div>
                  </dl>
                </section>
              </aside>
              <div className="image-detail-actions">
                <strong>{titleControl.committedValue || "Image"}</strong>
                <button onClick={download} type="button">下载</button>
                <button
                  aria-label="关闭图片详情"
                  onClick={() => closeImageTool("fullscreen")}
                  type="button"
                >
                  ×
                </button>
              </div>
            </div>
          </ImageToolSurface>
        )}
      </ImageToolHost>
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
        isVisible={Boolean(data.imagePromptReady && singleNodeChrome && !imageToolModalOpen)}
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
                            node.data.imageAspectRatio,
                          ),
                          imageModelId: modelId,
                          imageModelName: displayName,
                          imageQuality: supportedImageValue(
                            nextParameters.qualities,
                            node.data.imageQuality,
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
              savingCanvas
                ? "正在保存画布…"
                : generating && cancelableTaskId
                  ? "取消生成"
                  : generating
                    ? "Generating..."
                    : submitting
                      ? "Submitting..."
                      : "Generate"
            }
            className="image-creator-generate"
            data-tooltip={
              savingCanvas
                ? "正在保存画布…"
                : generating && cancelableTaskId
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
                            (generatedForCurrentInput
                              ? "当前节点已生成"
                              : undefined)
            }
            disabled={
              submitting ||
              savingCanvas ||
              legacySubmissionBlocked ||
              (generating
                ? !cancelableTaskId
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
            {savingCanvas
              ? "正在保存画布…"
              : generating && cancelableTaskId
                ? "×"
                : "↑"}
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
        className={`image-node-card${preview ? " image-node-image-surface" : ""}`}
        data-asset-id={data.assetId}
        data-empty={preview || generating || uploading ? undefined : "true"}
        data-transparent-output={imageShowsTransparency
          ? "true"
          : undefined}
        data-testid={`image-node-${id}`}
      >
        {(transientUploadError || uploadError) && (
          <div
            className={[
              "image-node-upload-error",
              uploadErrorNeutral && !transientUploadError ? "neutral" : "",
            ].filter(Boolean).join(" ")}
            data-error-kind={
              uploadErrorNeutral && !transientUploadError ? "notice" : "error"
            }
            role="alert"
          >
            <span className="provider-error-summary">
              {transientUploadError || uploadError}
            </span>
            {canReconcileImage && (
              <GenerationReconcileControls
                busy={reconcileBusy || submitting}
                canRetry={showImageRetry}
                onReconcile={() => void reconcileImageResult()}
                onRetry={() => void retryImageGeneration()}
                retryEnabled={retryGenerationEnabled}
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
          <span
            className={`image-node-preview-frame${
              imageShowsTransparency ? " image-transparent-preview" : ""
            }`}
            data-testid="image-node-preview-frame"
            style={previewFrameStyle}
          >
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
              ref={previewImageRef}
              src={mediaLoad.source}
            />
          </span>
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
        <LegacyTerminalGenerationNotice state={legacyState} />
        {(displayImageGenerating || uploading) && (
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
    </>
  );
}
export const ImageNode = memo(ImageNodeImpl);
