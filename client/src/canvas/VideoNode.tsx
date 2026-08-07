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
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import { fitVisualMediaSize } from "./mediaGeometry";
import { NodeModelControl } from "./NodeModelControl";
import { NodeParameterControl } from "./NodeParameterControl";
import { EmptyMediaUploadToolbar } from "./EmptyMediaUploadToolbar";
import type { ProbeNodeType } from "./ProbeNode";
import {
  usePublishedModelSelection,
} from "../models/ModelCatalog";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";
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
import type {
  NodeGenerationOutcome,
} from "../generation/workflowExecution";
import { visibleGenerationError } from "../generation/generationErrors";
import { ProviderErrorNotice } from "../generation/ProviderErrorNotice";
import {
  generationFailureMessage,
  generationInputKey as createGenerationInputKey,
  safelyRetryableGenerationTask,
} from "../generation/generationRetry";
import {
  cancelGenerationTask,
  clearGenerationSubmissionIntent,
  ensureGenerationTask,
  GenerationRequestError,
  listGenerationTasks,
  recoverPendingGenerationTask,
  retryGenerationTask,
  waitForGenerationTask,
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
  moveNodeInputEdge,
  resolveNodeInputs,
  type NodeInputProblem,
} from "../../../types/nodeInputs";
import { UpstreamInputCards } from "./UpstreamInputCards";
import { GenerationAvailabilityNotice } from "./GenerationAvailabilityNotice";
import {
  fetchTrustedMediaMetadata,
  mediaUploadState,
  trustedMediaPatch,
} from "./mediaInputMetadata";

function clock(seconds = 0) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    Math.floor(safe % 60),
  ).padStart(2, "0")}`;
}

function compactTime(seconds = 0) {
  return `${(Number.isFinite(seconds) ? seconds : 0).toFixed(1)}s`;
}

function fileSize(bytes = 0) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ratioLabel(width = 0, height = 0) {
  if (!width || !height) return "—";
  const divisor = (a: number, b: number): number =>
    b ? divisor(b, a % b) : a;
  const common = divisor(width, height);
  return `${width / common} : ${height / common}`;
}

function hasReadyVideoMedia(node?: ProbeNodeType) {
  return Boolean(
    node?.data.assetId &&
    node.data.videoSrc &&
    (node.data.inputState === undefined || node.data.inputState === "ready"),
  );
}

function restoreVideoUploadBaseline(
  node: ProbeNodeType,
  baseline: ProbeNodeType,
) {
  return {
    ...node,
    data: {
      ...node.data,
      assetId: baseline.data.assetId,
      inputState: baseline.data.inputState ?? "ready",
      inputStateReason: baseline.data.inputStateReason,
      mediaByteSize: baseline.data.mediaByteSize,
      mediaContentType: baseline.data.mediaContentType,
      mediaDurationSeconds: baseline.data.mediaDurationSeconds,
      mediaMetadataSource: baseline.data.mediaMetadataSource,
      mediaMetadataStatus: baseline.data.mediaMetadataStatus,
      mediaStorageBackend: baseline.data.mediaStorageBackend,
      videoAudioEnabled: baseline.data.videoAudioEnabled,
      videoCreatedAt: baseline.data.videoCreatedAt,
      videoDuration: baseline.data.videoDuration,
      videoFileSize: baseline.data.videoFileSize,
      videoGenerationError: baseline.data.videoGenerationError,
      videoHeight: baseline.data.videoHeight,
      videoModel: baseline.data.videoModel,
      videoPrompt: baseline.data.videoPrompt,
      videoSrc: baseline.data.videoSrc,
      videoWidth: baseline.data.videoWidth,
    },
  };
}

async function discardUnadoptedVideoAsset(assetId: string) {
  try {
    await fetch(`/api/video-assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
    });
  } catch {
    // A stale upload must stay detached even if best-effort cleanup is offline.
  }
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      {playing ? (
        <>
          <path d="M6.5 5v10M13.5 5v10" />
        </>
      ) : (
        <path d="m7 5 8 5-8 5Z" />
      )}
    </svg>
  );
}

function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 10v4h3l4 4V6L8 10Z" />
      {muted ? (
        <>
          <path d="m16 9 5 6M21 9l-5 6" />
        </>
      ) : (
        <>
          <path d="M16 9c1.4 1.7 1.4 4.3 0 6" />
          <path d="M19 6c3.2 3.3 3.2 8.7 0 12" />
        </>
      )}
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M8 3H3v5M12 3h5v5M3 12v5h5M17 12v5h-5" />
    </svg>
  );
}

function VideoNodeImpl({ data, id, selected }: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  const { getNode, getNodes } = useReactFlow<ProbeNodeType>();
  const { register: registerWorkflowNode } = useWorkflowExecution();
  const { setEdges, setNodes } = useCanvasGraphMutation();
  const canvasEdges = useEdges();
  const canvasNodes = useNodes<ProbeNodeType>();
  const checkpoint = useCanvasCheckpoint();
  const {
    accountId,
    canvasId,
    canvasRevision,
    flushCanvasSave,
    isFixture,
    waitForCanvasRevision,
  } = useGenerationCanvas();
  const videoModelSelection = usePublishedModelSelection(
    "video",
    data.videoModelId,
    data.videoModel,
  );
  const videoModels = videoModelSelection.models;
  const selectedVideoModel = videoModelSelection.model;
  const videoModelUnavailableReason = videoModelSelection.unavailableReason;
  const videoParameterSchema = selectedVideoModel?.parameterSchema ??
    defaultParameterSchema("video");
  const videoParameters = selectedVideoModel
    ? normalizeParameterValues(videoParameterSchema, data.videoParameters)
    : {};
  const videoSubmissionParameters = selectedVideoModel
    ? submissionParameterValues(videoParameterSchema, videoParameters)
    : {};
  const videoInputParameterKeys = parameterKeysForGroups(videoParameterSchema, ["input"]);
  const videoMainParameterKeys = parameterKeysForGroups(
    videoParameterSchema,
    ["main", "advanced", "output"],
    ["outputCount"],
  );
  const videoCountParameterKeys = videoParameterSchema.fields.some((field) => field.key === "outputCount")
    ? ["outputCount"]
    : [];
  const generating = Boolean(data.videoGenerating);
  const generatedSuccess = Boolean(data.videoSrc && data.videoPromptReady);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [playing, setPlaying] = useState(false);
  const [prompt, setPrompt] = useState(data.videoPrompt ?? "");
  const [title, setTitle] = useState(data.title ?? "Video");
  const [uploadError, setUploadError] = useState(
    visibleGenerationError(data.videoGenerationError),
  );
  const [transientUploadError, setTransientUploadError] = useState("");
  const [retryTaskId, setRetryTaskId] = useState<string>();
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadInFlight = useRef(false);
  const uploadOperation = useRef(0);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);

  useEffect(() => {
    if (!singleNodeChrome) setVolumeOpen(false);
  }, [singleNodeChrome]);
  const promptControl = useCompositionSafeText({
    onCommit: (nextPrompt) => {
      setPrompt(nextPrompt);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, videoPrompt: nextPrompt } }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: prompt,
  });
  const titleControl = useCompositionSafeText({
    onCommit: (nextTitle) => {
      setTitle(nextTitle);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, title: nextTitle } }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: title,
  });
  const duration = data.videoDuration ?? 0;
  const uploading = data.inputState === "uploading";
  const inputPreflight = resolveNodeInputs({
    edges: canvasEdges,
    mediaInputPolicy: selectedVideoModel?.mediaInputPolicy,
    modelSchema: selectedVideoModel?.parameterSchema,
    nodes: canvasNodes,
    ownPrompt: promptControl.committedValue,
    parameters: videoSubmissionParameters,
    targetId: id,
    targetKind: "video",
  });
  const inputProblems: NodeInputProblem[] = modelSwitchProblem
    ? [{ code: "MODEL_UNSUPPORTED", message: modelSwitchProblem }, ...inputPreflight.problems, ...serverInputProblems]
    : [...inputPreflight.problems, ...serverInputProblems];
  const inputFeedbackFingerprint = JSON.stringify({
    edges: canvasEdges.map((edge) => [edge.id, edge.source, edge.target, edge.data]),
    model: selectedVideoModel?.id,
    parameters: videoSubmissionParameters,
    prompt: promptControl.committedValue,
    revision: canvasRevision,
  });
  const videoGenerationInputKey = createGenerationInputKey({
    inputs: inputPreflight.inputs,
    modelId: selectedVideoModel?.id,
    ownPrompt: promptControl.committedValue,
    parameters: videoSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  });
  // 只有“当前输入”对应的结果才视为已完成；修改提示词/参数/参考后允许重新生成。
  const generatedForCurrentInput = Boolean(
    generatedSuccess &&
    data.videoGenerationInputKey === videoGenerationInputKey,
  );
  const videoGenerationRequestInput = {
    canvasId,
    canvasRevision,
    inputSchemaVersion: 1 as const,
    inputs: inputPreflight.snapshot,
    model: selectedVideoModel?.id,
    nodeId: id,
    ownPrompt: promptControl.committedValue,
    parameters: videoSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  };
  const stableGenerationInputKey = useRef<string | undefined>(undefined);
  const retryAvailable = Boolean(
    retryTaskId &&
    data.videoGenerationInputKey === videoGenerationInputKey &&
    data.videoGenerationRetryAllowed === true &&
    selectedVideoModel &&
    selectedVideoModel.generationAvailable !== false,
  );

  useEffect(() => {
    setModelSwitchProblem("");
  }, [canvasEdges]);

  useEffect(() => {
    setServerInputProblems([]);
  }, [inputFeedbackFingerprint]);

  useEffect(() => {
    if (canvasRevision === undefined) return;
    const previous = stableGenerationInputKey.current;
    stableGenerationInputKey.current = videoGenerationInputKey;
    const persistedMismatch = Boolean(
      data.videoGenerationInputKey &&
      data.videoGenerationInputKey !== videoGenerationInputKey,
    );
    if (!persistedMismatch && (
      previous === undefined || previous === videoGenerationInputKey
    )) return;
    setRetryTaskId(undefined);
    setServerInputProblems([]);
    if (data.videoGenerationTaskId || data.videoGenerationInputKey) {
      clearGenerationSubmissionIntent(
        "video",
        canvasId,
        id,
        data.videoGenerationTaskId,
        accountId,
      );
      setUploadError("");
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              videoGenerationError: undefined,
              videoGenerationErrorCode: undefined,
              videoGenerationInputKey: undefined,
              videoGenerationRetryAllowed: undefined,
              videoGenerationRetryBlockCode: undefined,
              videoGenerationRetryBlockReason: undefined,
              videoGenerationTaskId: undefined,
            },
          }
        : node));
    }
  }, [
    canvasRevision,
    canvasId,
    data.videoGenerationInputKey,
    data.videoGenerationTaskId,
    id,
    setNodes,
    videoGenerationInputKey,
  ]);

  const persistVideoGenerationFailure = (
    taskId: string,
    message: string,
    errorCode: string | undefined,
    retryAllowed: boolean,
    retryBlockCode?: string,
    retryBlockReason?: string,
  ) => {
    const visibleMessage = generationFailureMessage(
      message,
      retryAllowed ? undefined : retryBlockReason,
      errorCode,
      "video",
    );
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationError: visibleMessage,
            videoGenerationErrorCode: errorCode,
            videoGenerationInputKey,
            videoGenerating: false,
            videoGenerationRetryAllowed: retryAllowed,
            videoGenerationRetryBlockCode: retryBlockCode,
            videoGenerationRetryBlockReason: retryBlockReason,
            videoGenerationTaskId: taskId,
          },
        }
      : node));
    setUploadError(visibleMessage);
    setRetryTaskId(retryAllowed ? taskId : undefined);
  };

  useEffect(() => {
    setUploadError(
      data.inputState === "invalid"
        ? data.inputStateReason ?? data.videoGenerationError ?? "视频不可用"
        : visibleGenerationError(data.videoGenerationError),
    );
  }, [data.inputState, data.inputStateReason, data.videoGenerationError]);

  useEffect(() => {
    if (data.inputState !== "uploading" || uploadInFlight.current) return;
    const message = "视频上传已中断，请重新上传";
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...mediaUploadState("invalid", message) } }
      : node));
  }, [data.inputState, id, setNodes]);

  useEffect(() => {
    if (!uploadInFlight.current || data.inputState === "uploading") return;
    uploadOperation.current += 1;
    uploadController.current?.abort();
    uploadController.current = undefined;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, [data.inputState]);

  useEffect(() => () => {
    uploadOperation.current += 1;
    uploadController.current?.abort();
    uploadController.current = undefined;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, []);

  useEffect(() => {
    if (
      isFixture ||
      !data.assetId ||
      data.mediaMetadataSource === "server" ||
      data.inputState === "uploading" ||
      data.inputState === "invalid"
    ) return;
    const controller = new AbortController();
    void fetchTrustedMediaMetadata("video", data.assetId, controller.signal)
      .then((metadata) => {
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, ...trustedMediaPatch(metadata) } }
          : node));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error
          ? error.message
          : "服务端无法确认视频素材信息";
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, ...mediaUploadState("invalid", message) } }
          : node));
      });
    return () => controller.abort();
  }, [
    canvasId,
    data.assetId,
    data.inputState,
    data.mediaMetadataSource,
    id,
    setNodes,
  ]);

  const applyGeneratedVideo = (task: GenerationTaskSummary, cleanPrompt: string) => {
    if (!task.resultAssetId || !task.resultUrl) {
      throw new Error("视频结果不完整");
    }
    const metadataPatch = task.resultMedia
      ? trustedMediaPatch({
          assetId: task.resultAssetId,
          ...task.resultMedia,
          kind: "video",
        })
      : {
          inputState: "ready" as const,
          inputStateReason: undefined,
          mediaByteSize: undefined,
          mediaContentType: undefined,
          mediaDurationSeconds: undefined,
          mediaMetadataSource: undefined,
          mediaMetadataStatus: undefined,
          mediaStorageBackend: undefined,
        };
    checkpoint(false);
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              height: undefined,
              measured: undefined,
              width: undefined,
              data: {
                ...node.data,
                assetId: task.resultAssetId,
                ...metadataPatch,
                videoAudioEnabled: videoParameters.generateAudio !== false,
                videoCreatedAt: new Intl.DateTimeFormat("zh-CN").format(new Date()),
                videoGenerationError: undefined,
                videoGenerationErrorCode: undefined,
                videoGenerating: false,
                videoGenerationRetryAllowed: undefined,
                videoGenerationRetryBlockCode: undefined,
                videoGenerationRetryBlockReason: undefined,
                videoGenerationTaskId: undefined,
                videoModel: selectedVideoModel?.displayName ?? "Seedance 2.0 Mini",
                videoPrompt: cleanPrompt,
                videoSrc: task.resultUrl,
              },
            }
          : node,
      ),
    );
    clearGenerationSubmissionIntent("video", canvasId, id, task.id, accountId);
  };

  const generateVideo = async (): Promise<NodeGenerationOutcome> => {
    const cleanPrompt = inputPreflight.finalPrompt;
    if (
      !cleanPrompt ||
      generating ||
      uploading ||
      submitting ||
      generatedSuccess ||
      isFixture ||
      canvasRevision === undefined ||
      !inputPreflight.canSubmit ||
      !selectedVideoModel ||
      selectedVideoModel.generationAvailable === false
    ) return { status: "skipped" };
    setUploadError("");
    setServerInputProblems([]);
    setRetryTaskId(undefined);
    setSubmitting(true);
    let submittedTaskId: string | undefined;
    try {
      await flushCanvasSave();
      const { task: submitted } = await ensureGenerationTask(
        "video",
        videoGenerationRequestInput,
        accountId,
      );
      submittedTaskId = submitted.id;
      setActiveTaskId(submitted.id);
      checkpoint();
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              videoGenerationError: undefined,
              videoGenerationErrorCode: undefined,
              videoGenerationInputKey,
              videoGenerating: true,
              videoGenerationRetryAllowed: undefined,
              videoGenerationRetryBlockCode: undefined,
              videoGenerationRetryBlockReason: undefined,
              videoGenerationTaskId: submitted.id,
            },
          }
        : node));
      // Submission is complete once the durable task id has been persisted.
      // Keep polling under videoGenerating so the same button can safely
      // cancel that task instead of remaining disabled for the whole run.
      setSubmitting(false);
      let task: Awaited<ReturnType<typeof waitForGenerationTask>>;
      try {
        task = await waitForGenerationTaskWithPause(submitted.id, () => {
          pollingPausedTaskIdRef.current = submitted.id;
          setPollingPausedTaskId(submitted.id);
          setUploadError(POLLING_PAUSED_MESSAGE);
        });
      } catch (error) {
        if (pollingPausedTaskIdRef.current === submitted.id) {
          return { message: POLLING_PAUSED_MESSAGE, status: "failed" };
        }
        throw error;
      }
      if (task.state !== "success") {
        persistVideoGenerationFailure(
          task.id,
          friendlyGenerationMessage(task.errorMessage, "video"),
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return {
          message: friendlyGenerationMessage(task.errorMessage, "video"),
          status: "failed",
        };
      }
      applyGeneratedVideo(task, promptControl.committedValue.trim());
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      setRetryTaskId(undefined);
      return { status: "success" };
    } catch (error) {
      if (error instanceof GenerationRequestError && error.problems.length) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : generationMessageFallback("video");
      const friendly = friendlyGenerationMessage(message, "video");
      if (submittedTaskId) {
        const errorCode = error instanceof GenerationRequestError
          ? error.code
          : "TASK_STATUS_UNKNOWN";
        persistVideoGenerationFailure(
          submittedTaskId,
          friendly,
          errorCode,
          false,
          errorCode,
          error instanceof GenerationRequestError
            ? error.message
            : "任务状态暂时无法确认，不能一键重试，请稍后刷新查看",
        );
      } else {
        setUploadError(friendly);
      }
      return { message: friendly, status: "failed" };
    } finally {
      setSubmitting(false);
      setActiveTaskId(undefined);
    }
  };

  const runWorkflowNode = async (): Promise<NodeRunResult> => {
    const before = getNodes().find((node) => node.id === id);
    if (!before) return { status: "failed" };
    if (isFixture || canvasRevision === undefined) {
      return { status: "skipped" };
    }
    if (
      before.data.videoGenerating === true ||
      before.data.inputState === "uploading"
    ) {
      return { message: "节点正在生成中", status: "busy" };
    }
    const outcome = await generateVideo();
    if (outcome.status === "failed") {
      return { message: outcome.message, status: "failed" };
    }
    if (outcome.status === "skipped") {
      return {
        message: inputPreflight.problems[0]?.message,
        status: "skipped",
      };
    }
    return { status: "success" };
  };

  const runWorkflowNodeRef = useRef<() => Promise<NodeRunResult>>(
    async () => ({ status: "skipped" }),
  );
  runWorkflowNodeRef.current = runWorkflowNode;
  useEffect(
    () =>
      registerWorkflowNode(id, {
        run: createSaveGateRun(
          waitForCanvasRevision,
          () => runWorkflowNodeRef.current(),
          "video",
        ),
      }),
    [id, registerWorkflowNode, waitForCanvasRevision],
  );

  const retryVideoGeneration = async () => {
    if (!retryTaskId || !retryAvailable || generating || submitting) return;
    const taskId = retryTaskId;
    setUploadError("");
    setActiveTaskId(taskId);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationError: undefined,
            videoGenerationErrorCode: undefined,
            videoGenerationInputKey,
            videoGenerating: true,
            videoGenerationRetryAllowed: undefined,
            videoGenerationRetryBlockCode: undefined,
            videoGenerationRetryBlockReason: undefined,
            videoGenerationTaskId: taskId,
          },
        }
      : node));
    try {
      await retryGenerationTask(taskId);
      const task = await waitForGenerationTask(taskId);
      if (task.state !== "success") {
        persistVideoGenerationFailure(
          task.id,
          task.errorMessage ?? "视频生成失败，请稍后再试",
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return;
      }
      applyGeneratedVideo(task, promptControl.committedValue.trim());
      setRetryTaskId(undefined);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "视频生成失败，请稍后再试";
      const errorCode = error instanceof GenerationRequestError
        ? error.code
        : "TASK_STATUS_UNKNOWN";
      persistVideoGenerationFailure(
        taskId,
        message,
        errorCode,
        false,
        errorCode,
        error instanceof GenerationRequestError
          ? error.message
          : "任务状态暂时无法确认，不能一键重试，请稍后刷新查看",
      );
    } finally {
      setActiveTaskId(undefined);
    }
  };

  const resumeVideoPolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setUploadError("");
    try {
      const task = await waitForGenerationTask(taskId);
      if (task.state !== "success") {
        persistVideoGenerationFailure(
          task.id,
          friendlyGenerationMessage(task.errorMessage, "video", task.errorCode),
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return;
      }
      applyGeneratedVideo(task, promptControl.committedValue.trim());
      setRetryTaskId(undefined);
    } catch (error) {
      if (isTransientPollingError(error)) {
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
        return;
      }
      setUploadError(
        error instanceof Error ? error.message : "视频生成失败，请稍后再试",
      );
    } finally {
      setActiveTaskId(undefined);
    }
  };

  const cancelVideoGeneration = async () => {
    if (pollingPausedTaskIdRef.current) {
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
    }
    if (!activeTaskId) return;
    try {
      const task = await cancelGenerationTask(activeTaskId);
      if (task.state !== "cancelled") return;
      const message = task.errorMessage ?? "视频生成已取消";
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
            ...node.data,
            videoGenerationError: message,
            videoGenerationErrorCode: undefined,
            videoGenerationInputKey: undefined,
            videoGenerating: false,
            videoGenerationRetryAllowed: undefined,
            videoGenerationRetryBlockCode: undefined,
            videoGenerationRetryBlockReason: undefined,
            videoGenerationTaskId: undefined,
            },
          }
        : node));
      setUploadError(message);
      setRetryTaskId(undefined);
      clearGenerationSubmissionIntent("video", canvasId, id, task.id, accountId);
      setActiveTaskId(undefined);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "取消生成失败");
    }
  };

  useEffect(() => {
    const nextTitle = data.title ?? "Video";
    setTitle(nextTitle);
  }, [data.title]);

  useEffect(() => {
    setPrompt(data.videoPrompt ?? "");
  }, [data.videoPrompt]);

  useEffect(() => {
    if (data.videoSrc || isFixture) return;
    const controller = new AbortController();
    void recoverPendingGenerationTask(
      "video",
      canvasId,
      id,
      controller.signal,
      videoGenerationRequestInput,
      accountId,
    )
      .then(async (pending) => ({
        recoveredIntent: Boolean(pending),
        tasks: pending
          ? [pending]
          : await listGenerationTasks(canvasId, controller.signal),
      }))
      .then(async ({ recoveredIntent, tasks }) => {
        const latest = tasks.filter((task) => task.kind === "video" && task.nodeId === id).at(-1);
        if (!latest) return;
        if (latest.state === "success") {
          applyGeneratedVideo(latest, promptControl.committedValue.trim());
          return;
        }
        if (latest.state === "failed") {
          const matchesPersistedInput = recoveredIntent || (
            data.videoGenerationTaskId === latest.id &&
            data.videoGenerationInputKey === videoGenerationInputKey
          );
          if (matchesPersistedInput) {
            const retainPersistedBlock =
              data.videoGenerationRetryAllowed === false;
            persistVideoGenerationFailure(
              latest.id,
              retainPersistedBlock && data.videoGenerationError
                ? data.videoGenerationError
                : latest.errorMessage ?? "视频生成失败，请稍后再试",
              retainPersistedBlock
                ? data.videoGenerationErrorCode
                : latest.errorCode,
              retainPersistedBlock
                ? false
                : safelyRetryableGenerationTask(latest),
              retainPersistedBlock
                ? data.videoGenerationRetryBlockCode
                : latest.retryBlockCode,
              retainPersistedBlock
                ? data.videoGenerationRetryBlockReason
                : latest.retryBlockReason,
            );
          }
          return;
        }
        if (latest.state === "cancelled") {
          const message = latest.errorMessage ?? "视频生成已取消";
          setNodes((nodes) => nodes.map((node) => node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  videoGenerationError: message,
                  videoGenerationErrorCode: undefined,
                  videoGenerationInputKey: undefined,
                  videoGenerating: false,
                  videoGenerationRetryAllowed: undefined,
                  videoGenerationRetryBlockCode: undefined,
                  videoGenerationRetryBlockReason: undefined,
                  videoGenerationTaskId: undefined,
                },
              }
            : node));
          setUploadError(message);
          clearGenerationSubmissionIntent("video", canvasId, id, latest.id);
          return;
        }
        setActiveTaskId(latest.id);
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                videoGenerationError: undefined,
                videoGenerationErrorCode: undefined,
                videoGenerationInputKey,
                videoGenerating: true,
                videoGenerationRetryAllowed: undefined,
                videoGenerationRetryBlockCode: undefined,
                videoGenerationRetryBlockReason: undefined,
                videoGenerationTaskId: latest.id,
              },
            }
          : node));
        const finished = await waitForGenerationTask(latest.id, controller.signal);
        if (finished.state === "success") {
          applyGeneratedVideo(finished, promptControl.committedValue.trim());
        } else {
          if (finished.state === "failed") {
            persistVideoGenerationFailure(
              finished.id,
              finished.errorMessage ?? "视频生成失败，请稍后再试",
              finished.errorCode,
              safelyRetryableGenerationTask(finished),
              finished.retryBlockCode,
              finished.retryBlockReason,
            );
          } else if (finished.state === "cancelled") {
            const message = finished.errorMessage ?? "视频生成已取消";
            setNodes((nodes) => nodes.map((node) => node.id === id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    videoGenerationError: message,
                    videoGenerationErrorCode: undefined,
                    videoGenerationInputKey: undefined,
                    videoGenerating: false,
                    videoGenerationRetryAllowed: undefined,
                    videoGenerationRetryBlockCode: undefined,
                    videoGenerationRetryBlockReason: undefined,
                    videoGenerationTaskId: undefined,
                  },
                }
              : node));
            setUploadError(message);
          }
        }
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setUploadError("生成任务状态暂时无法读取");
        }
      })
      .finally(() => setActiveTaskId(undefined));
    return () => controller.abort();
  }, [
    canvasId,
    data.videoGenerationError,
    data.videoGenerationErrorCode,
    data.videoGenerationRetryAllowed,
    data.videoGenerationRetryBlockCode,
    data.videoGenerationRetryBlockReason,
    data.videoGenerationInputKey,
    data.videoGenerationTaskId,
    data.videoSrc,
    id,
    videoGenerationInputKey,
  ]);

  useEffect(() => {
    if (!fullscreen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [fullscreen]);

  const loadFile = async (file?: File) => {
    if (!file) return;

    const supersedingUpload = uploadInFlight.current;
    const baseline = uploadBaseline.current ?? getNode(id);
    if (baseline && !uploadBaseline.current) uploadBaseline.current = baseline;
    const operation = uploadOperation.current + 1;
    uploadOperation.current = operation;
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    uploadInFlight.current = true;
    setUploadError("");
    setTransientUploadError("");
    if (!supersedingUpload) checkpoint();
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            ...mediaUploadState("uploading", "视频正在上传并由服务端检查"),
          },
        }
      : node));
    const localUrl = URL.createObjectURL(file);
    let adopted = false;
    let requestedAssetId: string | undefined;
    try {
      if (file.type !== "video/mp4") {
        throw new Error("仅支持MP4视频上传");
      }
      const metadata = await new Promise<{
        duration: number;
        height: number;
        width: number;
      }>((resolve, reject) => {
        const video = document.createElement("video");
        video.onloadedmetadata = () =>
          resolve({
            duration: video.duration,
            height: video.videoHeight,
            width: video.videoWidth,
          });
        video.onerror = () => reject(new Error("视频无法解码"));
        video.preload = "metadata";
        video.src = localUrl;
      });

      if (
        operation !== uploadOperation.current ||
        controller.signal.aborted ||
        getNode(id)?.data.inputState !== "uploading"
      ) return;

      requestedAssetId = `${crypto.randomUUID()}.mp4`;
      const response = await fetch(`/api/video-assets/${requestedAssetId}`, {
        body: file,
        headers: {
          "Content-Type": file.type,
          "X-File-Name": encodeURIComponent(file.name),
        },
        method: "POST",
        signal: controller.signal,
      });
      const asset = await response.json() as {
        assetId: string;
        byteSize: number;
        contentType: string;
        durationSeconds: number;
        error?: string;
        storageBackend: "local" | "oss";
        url: string;
      };
      if (!response.ok) throw new Error(asset.error ?? "视频上传失败");
      if (
        !Number.isSafeInteger(asset.byteSize) ||
        asset.byteSize < 1 ||
        asset.contentType !== "video/mp4" ||
        !Number.isFinite(asset.durationSeconds) ||
        (asset.storageBackend !== "local" && asset.storageBackend !== "oss")
      ) throw new Error("服务端返回的视频素材信息不完整");
      if (
        operation !== uploadOperation.current ||
        controller.signal.aborted ||
        getNode(id)?.data.inputState !== "uploading"
      ) {
        await discardUnadoptedVideoAsset(requestedAssetId);
        requestedAssetId = undefined;
        return;
      }

      setCurrentTime(0);
      setPlaying(false);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                height: undefined,
                measured: undefined,
                style: {
                  ...node.style,
                  ...fitVisualMediaSize(metadata.width, metadata.height),
                },
                width: undefined,
                data: {
                  ...node.data,
                  ...trustedMediaPatch({
                    assetId: asset.assetId,
                    byteSize: asset.byteSize,
                    contentType: asset.contentType,
                    durationSeconds: asset.durationSeconds,
                    durationStatus: "ready",
                    kind: "video",
                    storageBackend: asset.storageBackend,
                  }),
                  assetId: asset.assetId,
                  videoAudioEnabled: true,
                  videoCreatedAt: new Intl.DateTimeFormat("zh-CN").format(
                    new Date(),
                  ),
                  videoDuration: asset.durationSeconds,
                  videoFileSize: asset.byteSize,
                  videoGenerationError: undefined,
                  videoHeight: metadata.height,
                  videoModel: "本地上传",
                  videoPrompt: "",
                  videoSrc: asset.url,
                  videoWidth: metadata.width,
                },
              }
            : node,
        ),
      );
      adopted = true;
      setTransientUploadError("");
    } catch (error) {
      if (!adopted && requestedAssetId) {
        await discardUnadoptedVideoAsset(requestedAssetId);
        requestedAssetId = undefined;
      }
      if (operation !== uploadOperation.current) return;
      const message = error instanceof Error ? error.message : "视频上传失败";
      if (baseline && hasReadyVideoMedia(baseline)) {
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? restoreVideoUploadBaseline(node, baseline)
          : node));
        setTransientUploadError(message);
      } else {
        setUploadError(message);
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, ...mediaUploadState("invalid", message) } }
          : node));
      }
    } finally {
      URL.revokeObjectURL(localUrl);
      if (operation === uploadOperation.current) {
        uploadController.current = undefined;
        uploadInFlight.current = false;
        uploadBaseline.current = undefined;
      }
    }
  };

  const captureMetadata = (video: HTMLVideoElement) => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              style: {
                ...node.style,
                ...(typeof node.width === "number" ||
                typeof node.height === "number"
                  ? {}
                  : fitVisualMediaSize(video.videoWidth, video.videoHeight)),
              },
              data: {
                ...node.data,
                videoDuration: video.duration,
                videoHeight: video.videoHeight,
                videoWidth: video.videoWidth,
              },
            }
          : node,
      ),
    );
  };

  const togglePlayback = async (video?: HTMLVideoElement | null) => {
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      await video.play();
    } catch {
      setPlaying(false);
    }
  };

  const seek = (video: HTMLVideoElement | null, next: number) => {
    if (!video) return;
    video.currentTime = next;
    setCurrentTime(next);
  };

  const openFullscreen = () => {
    videoRef.current?.pause();
    setFullscreen(true);
  };

  const closeFullscreen = () => {
    const preview = fullscreenVideoRef.current;
    if (preview && videoRef.current) {
      videoRef.current.currentTime = preview.currentTime;
      setCurrentTime(preview.currentTime);
      preview.pause();
    }
    setFullscreen(false);
  };

  const download = () => {
    if (!data.videoSrc) return;
    const link = document.createElement("a");
    link.href = data.videoSrc;
    link.download = `${title || "Video"}.mp4`;
    link.click();
  };

  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        minHeight={135}
        minWidth={240}
        onResizeStart={() => checkpoint()}
      />
      <EmptyMediaUploadToolbar
        label="上传视频"
        onUpload={() => inputRef.current?.click()}
        testId="video-empty-upload-toolbar"
        visible={singleNodeChrome && !data.videoSrc && !generating && !uploading}
      />
      <NodeToolbar
        className="media-node-toolbar video-node-toolbar nodrag nopan nowheel"
        data-testid="video-node-toolbar"
        isVisible={Boolean(data.videoSrc && singleNodeChrome && !generating && !uploading)}
        offset={28}
        position={Position.Top}
      >
        <button aria-label="剪辑" data-tooltip="剪辑" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <circle cx="5.5" cy="15" r="2.5" />
            <circle cx="14.5" cy="15" r="2.5" />
            <path d="m4 4 8.5 8.5M16 4l-5.5 5.5" />
          </svg>
        </button>
        <button aria-label="增强" data-tooltip="增强" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <rect height="12" rx="2" width="16" x="2" y="4" />
            <path d="M5 7v6M9 7v6M5 10h4M12 7h1.5a2.5 2.5 0 0 1 0 5H12Z" />
          </svg>
        </button>
        <button aria-label="替换" data-tooltip="替换" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <rect height="6" rx="1.5" width="6" x="2.5" y="11.5" />
            <path d="M12 3v4M10 5h4M16 8.5v3M14.5 10h3M4 8l3-3M4 5h3v3" />
          </svg>
        </button>
        <button aria-label="移除" data-tooltip="移除" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m3.5 12 7.5-8a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-7 7H6Z" />
            <path d="m7.5 8 5 5M9 16h8" />
          </svg>
        </button>
        <button aria-label="截帧" data-tooltip="截帧" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M3 7h2l1-2h8l1 2h2v9H3Z" />
            <circle cx="10" cy="11.5" r="3" />
          </svg>
        </button>
        <button aria-label="浏览全部" data-tooltip="浏览全部" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <circle cx="4" cy="10" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="16" cy="10" r="1.5" />
          </svg>
        </button>
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
          onClick={openFullscreen}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M8 3H3v5M12 3h5v5M3 12v5h5M17 12v5h-5" />
          </svg>
        </button>
      </NodeToolbar>
      <NodeToolbar
        className="video-creator nodrag nopan nowheel"
        data-testid="video-creator"
        isVisible={Boolean(data.videoPromptReady && singleNodeChrome)}
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
              ? {
                  ...edge,
                  data: {
                    ...edge.data,
                    inputRole: role,
                  },
                }
              : edge));
          }}
          problems={inputProblems}
          roleOptions={(input) => availableNodeInputRoles({
            kind: input.kind,
            modelSchema: selectedVideoModel?.parameterSchema,
            parameters: videoSubmissionParameters,
            targetKind: "video",
          })}
        />
        <GenerationAvailabilityNotice
          canvasId={canvasId}
          kind="video"
          reason={videoModelUnavailableReason}
        />
        <textarea
          aria-label="视频提示词"
          data-canvas-text-edit="graph"
          data-composition-active={promptControl.composing || undefined}
          data-testid="video-creator-prompt"
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
          placeholder="描述你想要生成的视频"
          value={promptControl.value}
        />
        <div className="video-creator-controls">
          <NodeModelControl
            capability="video"
            disabled={generating}
            onChange={(modelId, displayName) => {
              const nextModel = videoModels?.find((model) => model.id === modelId);
              const nextSchema = nextModel?.parameterSchema ?? defaultParameterSchema("video");
              const nextParameters = nextModel
                ? defaultParameterValues(nextSchema)
                : {};
              const blocked = nextModel
                  ? blockedModelSwitchProblem(resolveNodeInputs({
                    edges: canvasEdges,
                    mediaInputPolicy: nextModel?.mediaInputPolicy,
                    modelSchema: nextSchema,
                    nodes: canvasNodes,
                    ownPrompt: promptControl.committedValue,
                    parameters: nextParameters,
                    targetId: id,
                    targetKind: "video",
                  }), nextSchema)
                : undefined;
              if (blocked) {
                setModelSwitchProblem(`模型未切换：${blocked.message}`);
                return;
              }
              setModelSwitchProblem("");
              checkpoint();
              setNodes((nodes) =>
                nodes.map((node) =>
                  node.id === id
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          videoModel: displayName,
                          videoModelId: modelId,
                          videoParameters: nextParameters,
                        },
                      }
                    : node,
                ),
              );
            }}
            selectedId={videoModelSelection.selectedId}
            selectedName={videoModelSelection.displayName}
          />
          {selectedVideoModel && (
            <>
              <NodeParameterControl
                disabled={generating}
                emptyLabel="文生视频"
                keys={videoInputParameterKeys}
                onChange={(key, value) => {
                  setNodes((nodes) => nodes.map((node) => node.id === id
                    ? { ...node, data: { ...node.data, videoParameters: { ...videoParameters, [key]: value } } }
                    : node));
                }}
                onEditSessionStart={checkpoint}
                schema={videoParameterSchema}
                values={videoParameters}
              />
              <NodeParameterControl
                disabled={generating}
                keys={videoMainParameterKeys}
                onChange={(key, value) => {
                  setNodes((nodes) => nodes.map((node) => node.id === id
                    ? { ...node, data: { ...node.data, videoParameters: { ...videoParameters, [key]: value } } }
                    : node));
                }}
                onEditSessionStart={checkpoint}
                schema={videoParameterSchema}
                values={videoParameters}
              />
            </>
          )}
          {!selectedVideoModel && (
            <>
              <button disabled type="button">全能参考</button>
              <button disabled type="button">16:9 · 480p · 5s</button>
            </>
          )}
          <span className="video-creator-spacer" />
          {selectedVideoModel ? (
            <NodeParameterControl
              disabled={generating}
              keys={videoCountParameterKeys}
              onChange={(key, value) => {
                setNodes((nodes) => nodes.map((node) => node.id === id
                  ? { ...node, data: { ...node.data, videoParameters: { ...videoParameters, [key]: value } } }
                  : node));
              }}
              onEditSessionStart={checkpoint}
              schema={videoParameterSchema}
              values={videoParameters}
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
            className="video-creator-generate"
            data-tooltip={
              isFixture
                ? "验收页面不会调用真实生成"
                : generatedForCurrentInput
                  ? "当前节点已有结果"
                : !selectedVideoModel
                  ? "管理员尚未发布视频模型"
                : videoModelUnavailableReason
                  ? videoModelUnavailableReason
                  : canvasRevision === undefined
                    ? "画布正在保存"
                    : inputProblems[0]?.message
            }
            disabled={
              submitting ||
              uploading ||
              (generating
                ? !activeTaskId
                : generatedForCurrentInput ||
                  !inputPreflight.canSubmit ||
                  serverInputProblems.length > 0 ||
                  !selectedVideoModel ||
                  selectedVideoModel.generationAvailable === false ||
                  canvasRevision === undefined)
            }
            onClick={() => void (generating ? cancelVideoGeneration() : generateVideo())}
            type="button"
          >
            {generating && activeTaskId ? "×" : "↑"}
          </button>
        </div>
      </NodeToolbar>
      <Handle id="target" position={Position.Left} type="target">
        {!data.videoSrc && !generating && !uploading && (
          <span className="node-handle-hit node-handle-hit-left">
            <span className="node-handle-plus" />
          </span>
        )}
      </Handle>
      <div className="video-node-title nodrag">
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <rect height="14" rx="3" width="16" x="1" y="2" />
          <path d="m7 6 5 3-5 3Z" />
        </svg>
        {singleNodeChrome ? (
          <input
            aria-label="Video 标题"
            data-canvas-text-edit="graph"
            data-composition-active={titleControl.composing || undefined}
            data-testid="video-node-title-input"
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
          <span>{titleControl.committedValue}</span>
        )}
      </div>
      <div
        className="video-node-card"
        data-asset-id={data.assetId}
        data-testid={`video-node-${id}`}
      >
        {(transientUploadError || uploadError) && (
          <div className="image-node-upload-error video-node-upload-error" role="alert">
            <ProviderErrorNotice message={transientUploadError || uploadError} />
            {retryAvailable && (
              <button
                aria-label="重试生成"
                onClick={() => void retryVideoGeneration()}
                type="button"
              >
                重试
              </button>
            )}
            {pollingPausedTaskId && (
              <button
                aria-label="重新检查任务状态"
                onClick={() => void resumeVideoPolling()}
                type="button"
              >
                重新检查
              </button>
            )}
          </div>
        )}
        {generating || uploading ? (
          <div
            aria-label={uploading ? "视频上传中" : "视频生成中"}
            className="video-node-generating"
            data-testid="video-node-generating"
            role="status"
          >
            <span
              className="image-node-generating-background video-node-generating-background"
              data-testid="video-node-generating-background"
            />
            <span
              className="image-node-loading-grid video-node-loading-grid"
              data-grid-columns="18"
              data-grid-rows="18"
              data-testid="video-node-loading-grid"
            />
          </div>
        ) : data.videoSrc ? (
          <>
            <video
              className="video-node-preview"
              data-testid="video-node-preview"
              muted={muted}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => captureMetadata(event.currentTarget)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime)
              }
              playsInline
              preload="auto"
              ref={videoRef}
              src={data.videoSrc}
            />
            <button
              aria-label={muted ? "开启声音" : "静音"}
              className="video-node-volume nodrag nopan"
              onClick={() => setMuted((value) => !value)}
              type="button"
            >
              <VolumeIcon muted={muted} />
            </button>
            <div className="video-node-controls nodrag nopan">
              <button
                aria-label={playing ? "暂停视频" : "播放视频"}
                onClick={() => void togglePlayback(videoRef.current)}
                type="button"
              >
                <PlayIcon playing={playing} />
              </button>
              <span>{compactTime(currentTime)}</span>
              <input
                aria-label="视频进度"
                max={duration}
                min="0"
                onChange={(event) =>
                  seek(videoRef.current, Number(event.target.value))
                }
                step="0.1"
                type="range"
                value={Math.min(currentTime, duration)}
              />
              <span>{compactTime(duration)}</span>
              <button
                aria-label="全屏查看"
                data-testid="video-node-fullscreen"
                onClick={openFullscreen}
                type="button"
              >
                <ExpandIcon />
              </button>
            </div>
            <button
              aria-label="替换"
              className="video-node-replace nodrag nopan"
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              替换
            </button>
          </>
        ) : (
          <div aria-hidden="true" className="video-node-empty-action">
            <svg aria-hidden="true" viewBox="0 0 48 48">
              <rect height="34" rx="6" width="38" x="5" y="7" />
              <path d="m19 16 13 8-13 8Z" />
            </svg>
          </div>
        )}
        <input
          accept="video/*"
          data-testid="video-upload-input"
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
      {fullscreen &&
        data.videoSrc &&
        createPortal(
          <div className="video-detail-backdrop" data-testid="video-detail">
            <div className="video-detail-dialog">
              <div className="video-detail-viewer">
                <video
                  aria-label="Video preview"
                  autoPlay
                  muted={muted}
                  onLoadedMetadata={(event) => {
                    event.currentTarget.currentTime = Math.min(
                      currentTime,
                      event.currentTarget.duration,
                    );
                    event.currentTarget.volume = volume;
                  }}
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onTimeUpdate={(event) =>
                    setCurrentTime(event.currentTarget.currentTime)
                  }
                  playsInline
                  ref={fullscreenVideoRef}
                  src={data.videoSrc}
                />
                <div className="video-detail-controls">
                  <button
                    aria-label={playing ? "暂停视频" : "播放视频"}
                    onClick={() =>
                      void togglePlayback(fullscreenVideoRef.current)
                    }
                    type="button"
                  >
                    <PlayIcon playing={playing} />
                  </button>
                  <input
                    aria-label="Video progress"
                    max={duration}
                    min="0"
                    onChange={(event) =>
                      seek(
                        fullscreenVideoRef.current,
                        Number(event.target.value),
                      )
                    }
                    step="0.1"
                    type="range"
                    value={Math.min(currentTime, duration)}
                  />
                  <span>
                    {clock(currentTime)} / {clock(duration)}
                  </span>
                  <div className="video-detail-volume">
                    {volumeOpen && (
                      <div className="video-detail-volume-popover">
                        <span>{Math.round(volume * 100)}</span>
                        <input
                          aria-label="音量"
                          max="1"
                          min="0"
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            setVolume(next);
                            if (fullscreenVideoRef.current) {
                              fullscreenVideoRef.current.volume = next;
                            }
                          }}
                          step="0.01"
                          type="range"
                          value={volume}
                        />
                      </div>
                    )}
                    <button
                      aria-label={muted ? "开启声音" : "静音"}
                      onClick={() => {
                        setMuted((value) => !value);
                        setVolumeOpen((value) => !value);
                      }}
                      type="button"
                    >
                      <VolumeIcon muted={muted} />
                    </button>
                  </div>
                  <button
                    aria-label="浏览器全屏"
                    onClick={() =>
                      void document
                        .querySelector<HTMLElement>(".video-detail-viewer")
                        ?.requestFullscreen()
                    }
                    type="button"
                  >
                    <ExpandIcon />
                  </button>
                </div>
              </div>
              <aside className="video-detail-panel">
                <button
                  aria-label="关闭视频详情"
                  className="video-detail-close"
                  onClick={closeFullscreen}
                  type="button"
                >
                  ×
                </button>
                <section>
                  <h3>提示词</h3>
                  <div className="video-detail-prompt">
                    {data.videoPrompt || "暂无提示词"}
                  </div>
                </section>
                <section>
                  <h3>信息</h3>
                  <dl className="video-detail-info">
                    <div>
                      <dt>模型:</dt>
                      <dd>{data.videoModel || "本地上传"}</dd>
                    </div>
                    <div>
                      <dt>质量:</dt>
                      <dd>
                        {data.videoWidth || 0} x {data.videoHeight || 0}
                      </dd>
                    </div>
                    <div>
                      <dt>宽高比:</dt>
                      <dd>
                        {ratioLabel(data.videoWidth, data.videoHeight)}
                      </dd>
                    </div>
                    <div>
                      <dt>时长:</dt>
                      <dd>{clock(duration)}</dd>
                    </div>
                    <div>
                      <dt>文件大小:</dt>
                      <dd>{fileSize(data.videoFileSize)}</dd>
                    </div>
                    <div>
                      <dt>生成音频:</dt>
                      <dd>{data.videoAudioEnabled ? "开启" : "关闭"}</dd>
                    </div>
                    <div>
                      <dt>创建日期:</dt>
                      <dd>{data.videoCreatedAt || "—"}</dd>
                    </div>
                    <div>
                      <dt>创建者:</dt>
                      <dd>M</dd>
                    </div>
                  </dl>
                </section>
                <div className="video-detail-actions">
                  <button onClick={closeFullscreen} type="button">
                    应用到画布
                  </button>
                  <button
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = data.videoSrc!;
                      link.download = `${title || "Video"}.mp4`;
                      link.click();
                    }}
                    type="button"
                  >
                    下载
                  </button>
                </div>
              </aside>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
export const VideoNode = memo(VideoNodeImpl);
