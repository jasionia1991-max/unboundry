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
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import {
  MediaLoadFallback,
  useMediaLoadRecovery,
} from "./MediaLoadFallback";
import { fitVisualMediaSize } from "./mediaGeometry";
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
import {
  createSaveGateRun,
  runExclusiveCanvasSubmit,
} from "../generation/saveGate";
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
import { shouldIgnoreStaleCanvasSaveProblem } from "../generation/groupRunPersist";
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
import { recoverWorkflowGenerationOnce } from "../generation/workflowGenerationRecovery";
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

type VideoPollingRun = {
  inputKey?: string;
  ownershipKey?: string;
  taskId: string;
  token: symbol;
};

function videoTaskMatchesNode(
  task: GenerationTaskSummary,
  canvasId: string,
  nodeId: string,
  taskId = task.id,
) {
  return task.id === taskId &&
    task.canvasId === canvasId &&
    task.kind === "video" &&
    task.nodeId === nodeId;
}

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

function VideoNodeImpl({
  data,
  dragging,
  id,
  parentId,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const mediaLoad = useMediaLoadRecovery(data.videoSrc);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  const deferredVideoMetadata = useRef<{
    duration: number;
    height: number;
    width: number;
  } | undefined>(undefined);
  const { getNode, getNodes } = useReactFlow<ProbeNodeType>();
  const { register: registerWorkflowNode } = useWorkflowExecution();
  const { setEdges, setNodes, tryAdoptNodes } = useCanvasGraphMutation();
  const canvasEdges = useEdges();
  const canvasNodes = useNodes<ProbeNodeType>();
  const checkpoint = useCanvasCheckpoint();
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
    data.videoGenerationTaskId,
    singleNodeChrome && !data.videoGenerating,
    { canvasId, nodeId: id },
  );
  const mediaAdoptionScopeRef = useRef(`${accountId}\u0000${canvasId}`);
  mediaAdoptionScopeRef.current = `${accountId}\u0000${canvasId}`;
  const persistenceReadyLive = useRef(persistenceReady);
  persistenceReadyLive.current = persistenceReady;
  const videoModelSelection = usePublishedModelSelection(
    "video",
    data.videoModelId,
    data.videoModel,
  );
  const videoModels = videoModelSelection.models;
  const selectedVideoModel = videoModelSelection.model;
  const selectedVideoModelId = videoModelSelection.selectedId;
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
  // 页面刷新或组件重挂后 activeTaskId 会丢失，但持久化任务号还在；
  // 取消按钮用它兜底，保证“生成中一定能取消”。
  const cancelableTaskId = activeTaskId ??
    (typeof data.videoGenerationTaskId === "string"
      ? data.videoGenerationTaskId
      : undefined);
  const [submitting, setSubmitting] = useState(false);
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [playing, setPlaying] = useState(false);
  const [prompt, setPrompt] = useState(data.videoPrompt ?? "");
  const [title, setTitle] = useState(data.title ?? "Video");
  const [uploadError, setRawUploadError] = useState(
    visibleGenerationError(data.videoGenerationError),
  );
  const [uploadErrorNeutral, setUploadErrorNeutral] = useState(false);
  const setUploadError = (message: string, errorCode?: string | null) => {
    setUploadErrorNeutral(
      Boolean(message) && !generationFailureIsDefinitive(errorCode),
    );
    setRawUploadError(message);
  };
  const [transientUploadError, setTransientUploadError] = useState("");
  const [retryTaskId, setRetryTaskId] = useState<string>();
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileConfirmedMissing, setReconcileConfirmedMissing] = useState(false);
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
  const [unverifiedRecoveryTaskId, setUnverifiedRecoveryTaskId] =
    useState<string>();
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const generationPollingRunRef = useRef<VideoPollingRun | undefined>(undefined);
  const liveGenerationInputKeyRef = useRef<string | undefined>(undefined);
  const liveGenerationOwnershipKeyRef = useRef<string | undefined>(undefined);
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const [retryWakeEpoch, setRetryWakeEpoch] = useState(0);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadInFlight = useRef(false);
  const uploadOperation = useRef(0);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const beginGenerationPollingRun = (
    taskId: string,
    inputKey?: string,
    ownershipKey?: string,
  ): VideoPollingRun => {
    const run = { inputKey, ownershipKey, taskId, token: Symbol(taskId) };
    generationPollingRunRef.current = run;
    setActiveTaskId(taskId);
    return run;
  };
  const ownsGenerationPollingRun = (run: VideoPollingRun) =>
    generationPollingRunRef.current === run &&
    (run.ownershipKey === undefined ||
      liveGenerationOwnershipKeyRef.current === run.ownershipKey);
  const endGenerationPollingRun = (run: VideoPollingRun) => {
    if (generationPollingRunRef.current !== run) return;
    generationPollingRunRef.current = undefined;
    setActiveTaskId((current) =>
      current === run.taskId ? undefined : current,
    );
  };

  useEffect(() => {
    if (!singleNodeChrome) setVolumeOpen(false);
  }, [singleNodeChrome]);
  const promptControl = useCompositionSafeText({
    onCommit: (nextPrompt) => {
      if (nextPrompt === prompt) return;
      setPrompt(nextPrompt);
      generationPollingRunRef.current = undefined;
      setActiveTaskId(undefined);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      setRetryTaskId(undefined);
      setServerInputProblems([]);
      setUploadError("");
      clearGenerationSubmissionIntent(
        "video",
        canvasId,
        id,
        data.videoGenerationTaskId,
        accountId,
      );
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  videoGenerationError: undefined,
                  videoGenerationErrorCode: undefined,
                  videoGenerationInputKey: undefined,
                  videoGenerationOwnershipKey: undefined,
                  videoGenerating: false,
                  videoGenerationRetryAllowed: undefined,
                  videoGenerationRetryBlockCode: undefined,
                  videoGenerationRetryBlockReason: undefined,
                  videoGenerationTaskId: undefined,
                  videoPrompt: nextPrompt,
                },
              }
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
  const modelSelectionProblem = workflowModelSelectionProblem({
    isFixture,
    kind: "video",
    model: selectedVideoModel,
    status: videoModelSelection.status,
    unavailableReason: videoModelUnavailableReason,
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
  const inputFeedbackFingerprint = JSON.stringify({
    edges: canvasEdges.map((edge) => [edge.id, edge.source, edge.target, edge.data]),
    model: selectedVideoModel?.id,
    parameters: videoSubmissionParameters,
    prompt: promptControl.committedValue,
    revision: canvasRevision,
  });
  const videoGenerationInputKey = createGenerationInputKey({
    inputs: inputPreflight.inputs,
    modelId: selectedVideoModelId,
    ownPrompt: promptControl.committedValue,
    parameters: videoSubmissionParameters,
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
          : defaultNodeInputRole(input.kind, "video"),
        source: input.sourceNodeId,
        sourceKind: input.kind,
        src: input.kind === "text" ? undefined : input.preview,
        status: input.state,
        text: input.kind === "text" ? input.text : undefined,
      };
    });
  const effectiveGenerationInputFingerprint = generationOwnershipKey({
    modelId: selectedVideoModelId,
    parameters: selectedVideoModel ? videoParameters : data.videoParameters,
    prompt: promptControl.committedValue,
    upstream: generationOwnershipUpstream,
  });
  const rawGenerationInputFingerprint = generationOwnershipKey({
    // Once a task is ownership-bound, catalog changes must not reinterpret its
    // saved model snapshot. Before admission, use the effective values that are
    // materialized and ACKed on the canvas below.
    modelId: data.videoGenerationOwnershipKey
      ? data.videoModelId
      : selectedVideoModelId,
    parameters: data.videoGenerationOwnershipKey
      ? data.videoParameters
      : selectedVideoModel
        ? videoParameters
        : data.videoParameters,
    prompt: promptControl.committedValue,
    // Only durable source/edge semantics belong here. Compatibility, resolver
    // reasons, and resolved roles can drift with the model catalog.
    upstream: generationOwnershipUpstream,
  });
  liveGenerationInputKeyRef.current = videoGenerationInputKey;
  liveGenerationOwnershipKeyRef.current = rawGenerationInputFingerprint;
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
    model: selectedVideoModelId,
    nodeId: id,
    ownPrompt: promptControl.committedValue,
    parameters: videoSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  };
  const stableRawGenerationInputFingerprint = useRef<string | undefined>(
    undefined,
  );
  const legacyRecoveryCatalogKey = data.videoGenerationOwnershipKey
    ? "ownership-bound"
    : `${videoModelSelection.status}:${selectedVideoModelId ?? ""}:${videoGenerationInputKey}`;
  const retryAvailable = Boolean(
    retryTaskId &&
    data.videoGenerationInputKey === videoGenerationInputKey &&
    (!data.videoGenerationOwnershipKey ||
      data.videoGenerationOwnershipKey === rawGenerationInputFingerprint) &&
    data.videoGenerationRetryAllowed === true &&
    selectedVideoModel &&
    selectedVideoModel.generationAvailable !== false,
  );
  const showVideoRetry = generationRetryVisible({
    confirmedMissing: reconcileConfirmedMissing,
    errorCode: data.videoGenerationErrorCode,
    retryAvailable,
  });
  const canReconcileVideo = Boolean(
    data.videoGenerationTaskId &&
    data.videoGenerationError &&
    !generating &&
    !isFixture &&
    generationNeedsReconcile(
      data.videoGenerationErrorCode,
      data.videoGenerationRetryBlockCode,
    ),
  );

  const clearVideoIntentAfterDurableTerminalPatch = (taskId: string) => {
    void (async () => {
      try {
        await flushCanvasSave();
        clearGenerationSubmissionIntent(
          "video",
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

  useEffect(() => {
    setModelSwitchProblem("");
  }, [canvasEdges]);

  useEffect(() => {
    setServerInputProblems([]);
  }, [inputFeedbackFingerprint]);

  useEffect(() => {
    const wakeAcceptedRetry = (event: Event) => {
      const detail = (event as CustomEvent<GenerationTaskRetryAcceptedDetail>)
        .detail;
      if (
        detail?.canvasId === canvasId &&
        detail.nodeId === id &&
        detail.kind === "video" &&
        detail.taskId === data.videoGenerationTaskId
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
  }, [canvasId, data.videoGenerationTaskId, id]);

  useEffect(() => {
    if (!persistenceReady) {
      stableRawGenerationInputFingerprint.current = undefined;
      return;
    }
    const previous = stableRawGenerationInputFingerprint.current;
    stableRawGenerationInputFingerprint.current = rawGenerationInputFingerprint;
    const persistedMismatch = Boolean(
      data.videoGenerationOwnershipKey &&
      data.videoGenerationOwnershipKey !== rawGenerationInputFingerprint,
    );
    if (
      !persistedMismatch &&
      (previous === undefined || previous === rawGenerationInputFingerprint)
    ) {
      return;
    }
    if (
      !data.videoGenerating &&
      !data.videoGenerationTaskId &&
      !data.videoGenerationInputKey &&
      !data.videoGenerationOwnershipKey
    ) return;
    generationPollingRunRef.current = undefined;
    setActiveTaskId(undefined);
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setRetryTaskId(undefined);
    setServerInputProblems([]);
    setUploadError("");
    clearGenerationSubmissionIntent("video", canvasId, id, undefined, accountId);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationError: undefined,
            videoGenerationErrorCode: undefined,
            videoGenerationInputKey: undefined,
            videoGenerationOwnershipKey: undefined,
            videoGenerating: false,
            videoGenerationRetryAllowed: undefined,
            videoGenerationRetryBlockCode: undefined,
            videoGenerationRetryBlockReason: undefined,
            videoGenerationTaskId: undefined,
          },
        }
      : node));
  }, [
    accountId,
    canvasId,
    data.videoGenerating,
    data.videoGenerationInputKey,
    data.videoGenerationOwnershipKey,
    data.videoGenerationTaskId,
    id,
    persistenceReady,
    rawGenerationInputFingerprint,
    setNodes,
  ]);

  const persistVideoGenerationFailure = (
    taskId: string,
    message: string,
    errorCode: string | undefined,
    retryAllowed: boolean,
    retryBlockCode?: string,
    retryBlockReason?: string,
    generationInputKey?: string,
    generationOwnershipKey?: string,
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
            videoGenerationInputKey:
              generationInputKey ?? node.data.videoGenerationInputKey,
            videoGenerationOwnershipKey:
              generationOwnershipKey ?? node.data.videoGenerationOwnershipKey,
            videoGenerating: false,
            videoGenerationRetryAllowed: retryAllowed,
            videoGenerationRetryBlockCode: retryBlockCode,
            videoGenerationRetryBlockReason: retryBlockReason,
            videoGenerationTaskId: taskId,
          },
        }
      : node));
    setUploadError(visibleMessage, errorCode);
    setRetryTaskId(retryAllowed ? taskId : undefined);
    clearVideoIntentAfterDurableTerminalPatch(taskId);
  };

  const persistVideoGenerationCancellation = (
    taskId: string,
    message: string,
  ) => {
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationError: message,
            videoGenerationErrorCode: undefined,
            videoGenerationInputKey: undefined,
            videoGenerationOwnershipKey: undefined,
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
    clearVideoIntentAfterDurableTerminalPatch(taskId);
  };

  useEffect(() => {
    setUploadError(
      data.inputState === "invalid"
        ? data.inputStateReason ?? data.videoGenerationError ?? "视频不可用"
        : visibleGenerationError(data.videoGenerationError),
      data.inputState === "invalid"
        ? "INPUT_INVALID"
        : data.videoGenerationErrorCode,
    );
  }, [
    data.inputState,
    data.inputStateReason,
    data.videoGenerationError,
    data.videoGenerationErrorCode,
  ]);

  useEffect(() => {
    if (
      !persistenceReady ||
      data.inputState !== "uploading" ||
      uploadInFlight.current
    ) return;
    const message = "视频上传已中断，请重新上传";
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...mediaUploadState("invalid", message) } }
      : node));
  }, [data.inputState, id, persistenceReady, setNodes]);

  useEffect(() => {
    if (!uploadInFlight.current || data.inputState === "uploading") return;
    uploadOperation.current += 1;
    uploadController.current?.abort();
    uploadController.current = undefined;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, [data.inputState]);

  useEffect(() => {
    if (persistenceReady || !uploadInFlight.current) return;
    uploadOperation.current += 1;
    uploadController.current?.abort();
    uploadController.current = undefined;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, [persistenceReady]);

  useEffect(() => () => {
    uploadOperation.current += 1;
    uploadController.current?.abort();
    uploadController.current = undefined;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, []);

  useEffect(() => {
    if (
      !persistenceReady ||
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
    persistenceReady,
    setNodes,
  ]);

  const applyGeneratedVideo = async (
    task: GenerationTaskSummary,
    cleanPrompt: string,
    run: VideoPollingRun,
  ) => {
    if (
      !ownsGenerationPollingRun(run) ||
      !videoTaskMatchesNode(task, canvasId, id, run.taskId)
    ) return false;
    if (task.state !== "success" || !task.resultAssetId || !task.resultUrl) {
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
                videoModel:
                  videoModelSelection.displayName ??
                  node.data.videoModel ??
                  "Seedance 2.0 Mini",
                videoPrompt: cleanPrompt,
                videoSrc: task.resultUrl,
              },
            }
          : node,
      ),
    );
    await flushCanvasSave();
    clearGenerationSubmissionIntent("video", canvasId, id, task.id, accountId);
    return true;
  };

  const generateVideo = async (
    options: { autoRecover?: boolean } = {},
  ): Promise<NodeGenerationOutcome> => {
    const cleanPrompt = inputPreflight.finalPrompt;
    if (
      !cleanPrompt ||
      generating ||
      uploading ||
      submitting ||
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
    let pollingRun: VideoPollingRun | undefined;
    let bindingPersisted = false;
    const requestedGenerationInputKey = videoGenerationInputKey;
    const requestedGenerationOwnershipKey =
      effectiveGenerationInputFingerprint;
    const requestedModelId = selectedVideoModelId;
    const requestedModelName = videoModelSelection.displayName;
    const requestedParameters = { ...videoParameters };
    try {
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              videoModel: requestedModelName,
              videoModelId: requestedModelId,
              videoParameters: requestedParameters,
            },
          }
        : node));
      const admitted = await (async () => {
        setSavingCanvas(true);
        try {
          return await runExclusiveCanvasSubmit(canvasId, async () => {
            const freshCanvasRevision = await waitForCanvasRevision();
            if (
              liveGenerationOwnershipKeyRef.current !==
                requestedGenerationOwnershipKey
            ) {
              return {
                message: "生成输入已修改，已停止本次生成",
                status: "failed" as const,
              };
            }
            const {
              generationOwnershipKey: persistedGenerationOwnershipKey,
              task: submitted,
            } = await ensureGenerationTask(
              "video",
              {
                ...videoGenerationRequestInput,
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
              liveGenerationOwnershipKeyRef.current !==
                requestedGenerationOwnershipKey
            ) {
              clearGenerationSubmissionIntent(
                "video",
                canvasId,
                id,
                submitted.id,
                accountId,
              );
              return {
                message: "生成输入已修改，旧任务结果不会覆盖当前内容",
                status: "failed" as const,
              };
            }
            pollingRun = beginGenerationPollingRun(
              submitted.id,
              requestedGenerationInputKey,
              requestedGenerationOwnershipKey,
            );
            checkpoint();
            setNodes((nodes) => nodes.map((node) => node.id === id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    videoGenerationError: undefined,
                    videoGenerationErrorCode: undefined,
                    videoGenerationInputKey,
                    videoGenerationOwnershipKey:
                      persistedGenerationOwnershipKey ??
                      requestedGenerationOwnershipKey,
                    videoGenerating: true,
                    videoGenerationRetryAllowed: undefined,
                    videoGenerationRetryBlockCode: undefined,
                    videoGenerationRetryBlockReason: undefined,
                    videoGenerationTaskId: submitted.id,
                    videoModel: requestedModelName,
                    videoModelId: requestedModelId,
                    videoParameters: requestedParameters,
                  },
                }
              : node));
            await flushCanvasSave();
            bindingPersisted = true;
            if (
              !pollingRun ||
              !ownsGenerationPollingRun(pollingRun) ||
              liveGenerationOwnershipKeyRef.current !==
                requestedGenerationOwnershipKey
            ) {
              return {
                message: "生成输入已修改，旧任务结果不会覆盖当前内容",
                status: "failed" as const,
              };
            }
            return { status: "admitted" as const, submitted };
          });
        } finally {
          setSavingCanvas(false);
        }
      })();
      if (admitted.status !== "admitted") return admitted;
      const submitted = admitted.submitted;
      // Submission is complete once the durable task id has been persisted.
      // Keep polling under videoGenerating so the same button can safely
      // cancel that task instead of remaining disabled for the whole run.
      setSubmitting(false);
      let task: Awaited<ReturnType<typeof waitForGenerationTask>>;
      while (true) {
        try {
          task = await waitForGenerationTaskWithPause(submitted.id, () => {
            if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
            pollingPausedTaskIdRef.current = submitted.id;
            setPollingPausedTaskId(submitted.id);
            setUploadError(POLLING_PAUSED_MESSAGE);
          });
        } catch (error) {
          if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) {
            return { status: "skipped" };
          }
          if (pollingPausedTaskIdRef.current === submitted.id) {
            return { message: POLLING_PAUSED_MESSAGE, status: "failed" };
          }
          throw error;
        }
        if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) {
          return { status: "skipped" };
        }
        if (task.state === "cancelled") {
          const message = task.errorMessage ?? "视频生成已取消";
          persistVideoGenerationCancellation(task.id, message);
          return {
            message: friendlyGenerationMessage(message, "video"),
            status: "failed",
          };
        }
        if (task.state === "success") break;
        if (!options.autoRecover) {
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
        const recovered = await recoverWorkflowGenerationOnce({
          canvasId,
          generationInputKey: requestedGenerationInputKey,
          kind: "video",
          nodeId: id,
          taskId: task.id,
          waitForCanvasRevision,
        });
        if (recovered.status === "success" && recovered.task) {
          task = recovered.task;
          break;
        }
        if (recovered.status === "skipped") {
          // 服务端还在继续核对/重试，保持呼吸灯，继续轮询。
          continue;
        }
        const failed = recovered.task ?? task;
        persistVideoGenerationFailure(
          failed.id,
          friendlyGenerationMessage(
            recovered.message ?? failed.errorMessage,
            "video",
          ),
          failed.errorCode,
          safelyRetryableGenerationTask(failed),
          failed.retryBlockCode,
          failed.retryBlockReason,
        );
        return {
          message: friendlyGenerationMessage(
            recovered.message ?? failed.errorMessage,
            "video",
          ),
          status: "failed",
        };
      }
      await applyGeneratedVideo(
        task,
        promptControl.committedValue.trim(),
        pollingRun,
      );
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
      if (
        submittedTaskId &&
        pollingRun &&
        ownsGenerationPollingRun(pollingRun)
      ) {
        if (!bindingPersisted) {
          pollingPausedTaskIdRef.current = submittedTaskId;
          setPollingPausedTaskId(submittedTaskId);
          setUploadError(
            "画布尚未安全保存，任务状态未查询；请重新检查",
            "CANVAS_NOT_SAVED",
          );
          return {
            message: "画布尚未安全保存，任务状态未查询；请重新检查",
            status: "failed",
          };
        }
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
      } else if (!pollingRun) {
        setUploadError(
          friendly,
          error instanceof GenerationRequestError ? error.code : undefined,
        );
      }
      return { message: friendly, status: "failed" };
    } finally {
      setSubmitting(false);
      if (pollingRun) endGenerationPollingRun(pollingRun);
    }
  };

  const persistWorkflowInputFailure = async (problem: NodeInputProblem) => {
    if (shouldIgnoreStaleCanvasSaveProblem(problem)) {
      return { status: "success" as const };
    }
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationError: problem.message,
            videoGenerationErrorCode: problem.code,
            videoGenerationInputKey: undefined,
            videoGenerationOwnershipKey: undefined,
            videoGenerating: false,
            videoGenerationRetryAllowed: undefined,
            videoGenerationRetryBlockCode: undefined,
            videoGenerationRetryBlockReason: undefined,
            videoGenerationTaskId: undefined,
          },
        }
      : node));
    setUploadError(problem.message, problem.code);
    setRetryTaskId(undefined);
    await flushCanvasSave();
    return {
      errorCode: problem.code,
      message: problem.message,
      status: "failed" as const,
    };
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
      before.data.videoGenerating === true ||
      before.data.inputState === "uploading"
    ) {
      return { message: "节点正在生成中", status: "busy" };
    }
    const outcome = await generateVideo({ autoRecover: true });
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
          "video",
        ),
      }),
    [id, registerWorkflowNode, waitForCanvasRevision],
  );

  const retryVideoGeneration = async () => {
    if (
      !retryTaskId ||
      !retryAvailable ||
      isFixture ||
      !retryGenerationEnabled ||
      generating ||
      submitting
    ) return;
    const taskId = retryTaskId;
    const requestedGenerationInputKey = videoGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setSubmitting(true);
    let retryAccepted = false;
    let pollingRun: VideoPollingRun | undefined;
    try {
      setSavingCanvas(true);
      await retryGenerationTask({
        canvasId,
        generationInputKey: requestedGenerationInputKey,
        kind: "video",
        nodeId: id,
        taskId,
      }, async () => {
        const revision = await waitForCanvasRevision();
        if (
          liveGenerationInputKeyRef.current !== requestedGenerationInputKey
        ) {
          throw new Error("生成输入已修改，已停止本次重试");
        }
        return revision;
      });
      if (
        liveGenerationInputKeyRef.current !== requestedGenerationInputKey
      ) return;
      retryAccepted = true;
      setUploadError("");
      pollingRun = beginGenerationPollingRun(
        taskId,
        requestedGenerationInputKey,
        requestedGenerationOwnershipKey,
      );
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              videoGenerationError: undefined,
              videoGenerationErrorCode: undefined,
              videoGenerationInputKey,
              videoGenerationOwnershipKey: requestedGenerationOwnershipKey,
              videoGenerating: true,
              videoGenerationRetryAllowed: undefined,
              videoGenerationRetryBlockCode: undefined,
              videoGenerationRetryBlockReason: undefined,
              videoGenerationTaskId: taskId,
            },
          }
      : node));
      const task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
      });
      if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
      if (task.state === "cancelled") {
        persistVideoGenerationCancellation(
          task.id,
          task.errorMessage ?? "视频生成已取消",
        );
        return;
      }
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
      await applyGeneratedVideo(
        task,
        promptControl.committedValue.trim(),
        pollingRun,
      );
      setRetryTaskId(undefined);
    } catch (error) {
      if (
        pollingRun &&
        pollingPausedTaskIdRef.current === taskId &&
        ownsGenerationPollingRun(pollingRun)
      ) return;
      if (!retryAccepted && !(error instanceof GenerationRequestError)) {
        setUploadError(
          error instanceof Error ? error.message : "画布尚未安全保存，不能重试生成",
          "CANVAS_NOT_SAVED",
        );
        return;
      }
      const message = error instanceof Error
        ? error.message
        : "视频生成失败，请稍后再试";
      const errorCode = error instanceof GenerationRequestError
        ? error.code
        : "TASK_STATUS_UNKNOWN";
      if (!pollingRun || ownsGenerationPollingRun(pollingRun)) {
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
      }
    } finally {
      setSavingCanvas(false);
      if (pollingRun) endGenerationPollingRun(pollingRun);
      setSubmitting(false);
    }
  };

  const resumeVideoPolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setUploadError("");
    const pollingRun = beginGenerationPollingRun(
      taskId,
      data.videoGenerationInputKey,
      data.videoGenerationOwnershipKey ?? rawGenerationInputFingerprint,
    );
    try {
      await flushCanvasSave();
      const task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!ownsGenerationPollingRun(pollingRun)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
      });
      if (!ownsGenerationPollingRun(pollingRun)) return;
      if (task.state === "cancelled") {
        persistVideoGenerationCancellation(
          task.id,
          task.errorMessage ?? "视频生成已取消",
        );
        return;
      }
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
      await applyGeneratedVideo(
        task,
        promptControl.committedValue.trim(),
        pollingRun,
      );
      setRetryTaskId(undefined);
    } catch (error) {
      if (!ownsGenerationPollingRun(pollingRun)) return;
      if (pollingPausedTaskIdRef.current === taskId) return;
      if (isTransientPollingError(error)) {
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
        return;
      }
      setUploadError(
        error instanceof Error ? error.message : "视频生成失败，请稍后再试",
        error instanceof GenerationRequestError ? error.code : undefined,
      );
    } finally {
      endGenerationPollingRun(pollingRun);
    }
  };

  const reconcileVideoResult = async () => {
    const taskId = data.videoGenerationTaskId;
    if (
      !taskId ||
      !canReconcileVideo ||
      reconcileBusy ||
      isFixture ||
      !retryGenerationEnabled
    ) return;
    setReconcileBusy(true);
    try {
      const result = await reconcileGenerationTask({
        canvasId,
        generationInputKey: data.videoGenerationInputKey || videoGenerationInputKey,
        kind: "video",
        nodeId: id,
        taskId,
      }, waitForCanvasRevision);
      const message = reconcileOutcomeMessage(result.outcome);
      if (result.outcome === "missing") {
        setReconcileConfirmedMissing(true);
        setRetryTaskId(result.task.id);
        setUploadError(message, "PROVIDER_RESULT_MISSING");
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    videoGenerationError: message,
                    videoGenerationErrorCode: "PROVIDER_RESULT_MISSING",
                    videoGenerating: false,
                    videoGenerationRetryAllowed: true,
                    videoGenerationTaskId: result.task.id,
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
      setUploadError("");
      const pollingRun = beginGenerationPollingRun(
        taskId,
        videoGenerationInputKey,
        rawGenerationInputFingerprint,
      );
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  videoGenerationError: undefined,
                  videoGenerationErrorCode: undefined,
                  videoGenerating: true,
                  videoGenerationTaskId: taskId,
                },
              }
            : node,
        ),
      );
      const task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!ownsGenerationPollingRun(pollingRun)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
      });
      if (!ownsGenerationPollingRun(pollingRun)) return;
      if (task.state === "success") {
        await applyGeneratedVideo(
          task,
          promptControl.committedValue,
          pollingRun,
        );
        return;
      }
      setUploadError(
        task.errorMessage ?? "视频生成失败，请稍后再试",
        task.errorCode,
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "核对结果失败，请稍后再试",
        error instanceof GenerationRequestError ? error.code : undefined,
      );
    } finally {
      setReconcileBusy(false);
    }
  };

  const recheckVideoTaskStatus = () => {
    if (
      unverifiedRecoveryTaskId &&
      unverifiedRecoveryTaskId === data.videoGenerationTaskId
    ) {
      setRecoveryEpoch((current) => current + 1);
      return;
    }
    void resumeVideoPolling();
  };

  const cancelVideoGeneration = async () => {
    if (pollingPausedTaskIdRef.current) {
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
    }
    if (!cancelableTaskId) return;
    const taskId = cancelableTaskId;
    const pollingRun = generationPollingRunRef.current?.taskId === taskId
      ? generationPollingRunRef.current
      : undefined;
    try {
      const task = await cancelGenerationTask(taskId);
      if (
        !pollingRun ||
        !ownsGenerationPollingRun(pollingRun) ||
        task.id !== pollingRun.taskId
      ) return;
      if (task.state !== "cancelled") return;
      persistVideoGenerationCancellation(
        task.id,
        task.errorMessage ?? "视频生成已取消",
      );
      endGenerationPollingRun(pollingRun);
    } catch (error) {
      if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
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
    if (!persistenceReady || isFixture || generationPollingRunRef.current) return;
    const persistedTaskId = data.videoGenerationTaskId;
    const persistedInputKey = data.videoGenerationInputKey;
    const persistedOwnershipKey = data.videoGenerationOwnershipKey;
    const catalogReady = videoModelSelection.status === "ready" &&
      Boolean(selectedVideoModel);
    const controller = new AbortController();
    let pollingRun: VideoPollingRun | undefined;
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
            "video",
            canvasId,
            id,
            persistedTaskId,
            accountId,
          );
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.videoGenerationTaskId === persistedTaskId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    videoGenerationError: undefined,
                    videoGenerationErrorCode: undefined,
                    videoGenerationInputKey: undefined,
                    videoGenerationOwnershipKey: undefined,
                    videoGenerating: false,
                    videoGenerationRetryAllowed: undefined,
                    videoGenerationRetryBlockCode: undefined,
                    videoGenerationRetryBlockReason: undefined,
                    videoGenerationTaskId: undefined,
                  },
                }
              : node
          ));
          return;
        }
        if (!persistedOwnershipKey) {
          if (!catalogReady) return;
          if (persistedInputKey && persistedInputKey !== videoGenerationInputKey) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
            clearGenerationSubmissionIntent(
              "video",
              canvasId,
              id,
              persistedTaskId,
              accountId,
            );
            setNodes((nodes) => nodes.map((node) =>
              node.id === id && node.data.videoGenerationTaskId === persistedTaskId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      videoGenerationError: undefined,
                      videoGenerationErrorCode: undefined,
                      videoGenerationInputKey: undefined,
                      videoGenerationOwnershipKey: undefined,
                      videoGenerating: false,
                      videoGenerationRetryAllowed: undefined,
                      videoGenerationRetryBlockCode: undefined,
                      videoGenerationRetryBlockReason: undefined,
                      videoGenerationTaskId: undefined,
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
          "video",
          canvasId,
          id,
          controller.signal,
          selectedVideoModel ? videoGenerationRequestInput : undefined,
          accountId,
          { generationOwnershipKey: rawGenerationInputFingerprint },
        );
        recoveredIntent = Boolean(task);
        if (!task && data.videoGenerating) {
          if (!data.videoGenerationOwnershipKey && !catalogReady) return;
          const matches = (await listGenerationTasks(canvasId, controller.signal))
            .filter((candidate) =>
              candidate.kind === "video" && candidate.nodeId === id
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
          "video",
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
        if (legacyInputKey && legacyInputKey !== videoGenerationInputKey) {
          if (persistedTaskId) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
          }
          clearGenerationSubmissionIntent(
            "video",
            canvasId,
            id,
            persistedTaskId ?? task.id,
            accountId,
          );
          return;
        }
      }
      if (!videoTaskMatchesNode(task, canvasId, id, persistedTaskId ?? task.id)) {
        if (persistedTaskId) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
          clearGenerationSubmissionIntent(
            "video",
            canvasId,
            id,
            persistedTaskId,
            accountId,
          );
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.videoGenerationTaskId === persistedTaskId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    videoGenerationError: undefined,
                    videoGenerationErrorCode: undefined,
                    videoGenerationInputKey: undefined,
                    videoGenerationOwnershipKey: undefined,
                    videoGenerating: false,
                    videoGenerationRetryAllowed: undefined,
                    videoGenerationRetryBlockCode: undefined,
                    videoGenerationRetryBlockReason: undefined,
                    videoGenerationTaskId: undefined,
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
      pollingRun = beginGenerationPollingRun(
        task.id,
        persistedInputKey ?? task.generationInputKey,
        recoveredOwnershipKey ?? rawGenerationInputFingerprint,
      );
      if (!ownsGenerationPollingRun(pollingRun)) return;
      if (task.state === "success") {
        await applyGeneratedVideo(
          task,
          promptControl.committedValue.trim(),
          pollingRun,
        );
        return;
      }
      if (task.state === "failed") {
        const retainPersistedBlock =
          !recoveredIntent && data.videoGenerationRetryAllowed === false;
        persistVideoGenerationFailure(
          task.id,
          retainPersistedBlock && data.videoGenerationError
            ? data.videoGenerationError
            : task.errorMessage ?? "视频生成失败，请稍后再试",
          retainPersistedBlock ? data.videoGenerationErrorCode : task.errorCode,
          retainPersistedBlock ? false : safelyRetryableGenerationTask(task),
          retainPersistedBlock
            ? data.videoGenerationRetryBlockCode
            : task.retryBlockCode,
          retainPersistedBlock
            ? data.videoGenerationRetryBlockReason
            : task.retryBlockReason,
          persistedInputKey ?? task.generationInputKey,
          recoveredOwnershipKey,
        );
        return;
      }
      if (task.state === "cancelled") {
        persistVideoGenerationCancellation(
          task.id,
          task.errorMessage ?? "视频生成已取消",
        );
        return;
      }
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              videoGenerationError: undefined,
              videoGenerationErrorCode: undefined,
              videoGenerationInputKey:
                persistedInputKey ?? task.generationInputKey,
              videoGenerationOwnershipKey: recoveredOwnershipKey,
              videoGenerating: true,
              videoGenerationRetryAllowed: undefined,
              videoGenerationRetryBlockCode: undefined,
              videoGenerationRetryBlockReason: undefined,
              videoGenerationTaskId: task.id,
            },
          }
        : node));
      const finished = await waitForGenerationTaskWithPause(
        task.id,
        () => {
          if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
          pollingPausedTaskIdRef.current = task.id;
          setPollingPausedTaskId(task.id);
          setUploadError(POLLING_PAUSED_MESSAGE);
        },
        controller.signal,
      );
      if (
        !pollingRun ||
        !ownsGenerationPollingRun(pollingRun) ||
        !videoTaskMatchesNode(finished, canvasId, id, task.id)
      ) return;
      if (finished.state === "success") {
        await applyGeneratedVideo(
          finished,
          promptControl.committedValue.trim(),
          pollingRun,
        );
      } else if (finished.state === "failed") {
        persistVideoGenerationFailure(
          finished.id,
          finished.errorMessage ?? "视频生成失败，请稍后再试",
          finished.errorCode,
          safelyRetryableGenerationTask(finished),
          finished.retryBlockCode,
          finished.retryBlockReason,
        );
      } else if (finished.state === "cancelled") {
        persistVideoGenerationCancellation(
          finished.id,
          finished.errorMessage ?? "视频生成已取消",
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
        if (pollingRun && ownsGenerationPollingRun(pollingRun) &&
          isTransientPollingError(error)) {
          pollingPausedTaskIdRef.current = pollingRun.taskId;
          setPollingPausedTaskId(pollingRun.taskId);
          setUploadError(POLLING_PAUSED_MESSAGE);
        } else if (!pollingRun || ownsGenerationPollingRun(pollingRun)) {
          setUploadError("生成任务状态暂时无法读取");
        }
      })
      .finally(() => {
        if (pollingRun) endGenerationPollingRun(pollingRun);
      });
    return () => {
      controller.abort();
      if (pollingRun) endGenerationPollingRun(pollingRun);
    };
  }, [
    canvasId,
    data.videoGenerationError,
    data.videoGenerationErrorCode,
    data.videoGenerationRetryAllowed,
    data.videoGenerationRetryBlockCode,
    data.videoGenerationRetryBlockReason,
    data.videoGenerationInputKey,
    data.videoGenerationOwnershipKey,
    data.videoGenerating,
    data.videoGenerationTaskId,
    id,
    persistenceReady,
    recoveryEpoch,
    retryWakeEpoch,
    rawGenerationInputFingerprint,
    legacyRecoveryCatalogKey,
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
    const scope = mediaAdoptionScopeRef.current;
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
    let shouldCompensate = true;
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
        scope !== mediaAdoptionScopeRef.current ||
        !persistenceReadyLive.current ||
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
      if (response.status === 409) shouldCompensate = false;
      const asset = await response.json() as {
        assetId: string;
        byteSize: number;
        contentType: string;
        durationSeconds: number;
        error?: string;
        mediaHeight?: number;
        mediaWidth?: number;
        storageBackend: "local" | "oss";
        url: string;
      };
      if (!response.ok) {
        throw new Error(asset.error ?? "视频上传失败");
      }
      if (asset.assetId !== requestedAssetId) {
        throw new Error("服务端返回的视频素材标识不一致");
      }
      if (
        !Number.isSafeInteger(asset.byteSize) ||
        asset.byteSize < 1 ||
        asset.contentType !== "video/mp4" ||
        !Number.isFinite(asset.durationSeconds) ||
        (asset.storageBackend !== "local" && asset.storageBackend !== "oss")
      ) throw new Error("服务端返回的视频素材信息不完整");
      const trustedMetadata = hasTrustedMediaDimensions(asset)
        ? {
            assetId: asset.assetId,
            byteSize: asset.byteSize,
            contentType: asset.contentType,
            durationSeconds: asset.durationSeconds,
            durationStatus: "ready" as const,
            kind: "video" as const,
            mediaHeight: asset.mediaHeight,
            mediaWidth: asset.mediaWidth,
            storageBackend: asset.storageBackend,
          }
        : await fetchTrustedMediaMetadata(
            "video",
            asset.assetId,
            controller.signal,
          );
      if (!hasTrustedMediaDimensions(trustedMetadata)) {
        throw new Error("服务端返回的视频尺寸未经可信校验");
      }
      if (
        operation !== uploadOperation.current ||
        scope !== mediaAdoptionScopeRef.current ||
        !persistenceReadyLive.current ||
        controller.signal.aborted ||
        getNode(id)?.data.inputState !== "uploading"
      ) {
        await discardUnadoptedVideoAsset(requestedAssetId);
        requestedAssetId = undefined;
        return;
      }

      setCurrentTime(0);
      setPlaying(false);
      adopted = tryAdoptNodes(id, (nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                height: undefined,
                measured: undefined,
                style: {
                  ...node.style,
                  ...fitVisualMediaSize(
                    trustedMetadata.mediaWidth,
                    trustedMetadata.mediaHeight,
                  ),
                },
                width: undefined,
                data: {
                  ...node.data,
                  ...trustedMediaPatch(trustedMetadata),
                  assetId: asset.assetId,
                  videoAudioEnabled: true,
                  videoCreatedAt: new Intl.DateTimeFormat("zh-CN").format(
                    new Date(),
                  ),
                  videoDuration: asset.durationSeconds,
                  videoFileSize: asset.byteSize,
                  videoGenerationError: undefined,
                  videoHeight: trustedMetadata.mediaHeight,
                  videoModel: "本地上传",
                  videoPrompt: "",
                  videoSrc: asset.url,
                  videoWidth: trustedMetadata.mediaWidth,
                },
              }
            : node,
        ),
      );
      if (!adopted) {
        await discardUnadoptedVideoAsset(requestedAssetId);
        requestedAssetId = undefined;
        return;
      }
      setTransientUploadError("");
    } catch (error) {
      if (!adopted && requestedAssetId && shouldCompensate) {
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
        setUploadError(message, "INPUT_INVALID");
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

  const applyVideoMetadata = useCallback((metadata: {
    duration: number;
    height: number;
    width: number;
  }) => {
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
                  : fitVisualMediaSize(metadata.width, metadata.height)),
              },
              data: {
                ...node.data,
                videoDuration: metadata.duration,
                videoHeight: metadata.height,
                videoWidth: metadata.width,
              },
            }
          : node,
      ),
    );
  }, [id, setNodes]);

  const captureMetadata = (video: HTMLVideoElement) => {
    const metadata = {
      duration: video.duration,
      height: video.videoHeight,
      width: video.videoWidth,
    };
    if (!persistenceReady) {
      deferredVideoMetadata.current = metadata;
      return;
    }
    deferredVideoMetadata.current = undefined;
    applyVideoMetadata(metadata);
  };

  useEffect(() => {
    if (!persistenceReady || !deferredVideoMetadata.current) return;
    const metadata = deferredVideoMetadata.current;
    deferredVideoMetadata.current = undefined;
    applyVideoMetadata(metadata);
  }, [applyVideoMetadata, persistenceReady]);

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
              setServerInputProblems([]);
              checkpoint();
              setNodes((nodes) =>
                nodes.map((node) =>
                  node.id === id
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          videoGenerationError: undefined,
                          videoGenerationErrorCode: undefined,
                          videoGenerationInputKey: undefined,
                          videoGenerationOwnershipKey: undefined,
                          videoGenerating: false,
                          videoGenerationRetryAllowed: undefined,
                          videoGenerationRetryBlockCode: undefined,
                          videoGenerationRetryBlockReason: undefined,
                          videoGenerationTaskId: undefined,
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
          <GenerationDurationHint label={finishedDurationLabel} />
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
            className="video-creator-generate"
            data-tooltip={
              savingCanvas
                ? "正在保存画布…"
                : isFixture
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
              savingCanvas ||
              uploading ||
              (generating
                ? !cancelableTaskId
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
            {savingCanvas
              ? "正在保存画布…"
              : generating && cancelableTaskId
                ? "×"
                : "↑"}
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
      <div
        className="canvas-node-title video-node-title nodrag"
        data-parent-group-id={parentId}
      >
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
          <span title={titleControl.committedValue}>
            {titleControl.committedValue}
          </span>
        )}
      </div>
      <div
        className="video-node-card"
        data-asset-id={data.assetId}
        data-testid={`video-node-${id}`}
      >
        {(transientUploadError || uploadError) && (
          <div
            className={[
              "image-node-upload-error",
              "video-node-upload-error",
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
            {canReconcileVideo && (
              <GenerationReconcileControls
                busy={reconcileBusy || submitting}
                canRetry={showVideoRetry}
                onReconcile={() => void reconcileVideoResult()}
                onRetry={() => void retryVideoGeneration()}
                retryEnabled={retryGenerationEnabled}
              />
            )}
            {!canReconcileVideo && retryAvailable && (
              <button
                aria-label="重试生成"
                disabled={
                  submitting ||
                  generating ||
                  isFixture ||
                  !retryGenerationEnabled
                }
                onClick={() => void retryVideoGeneration()}
                type="button"
              >
                重试
              </button>
            )}
            {(pollingPausedTaskId ||
              (unverifiedRecoveryTaskId &&
                unverifiedRecoveryTaskId === data.videoGenerationTaskId)) && (
              <button
                aria-label="重新检查任务状态"
                onClick={recheckVideoTaskStatus}
                type="button"
              >
                重新检查
              </button>
            )}
          </div>
        )}
        {data.videoSrc ? (
          <>
            <video
              className={`video-node-preview${
                mediaLoad.failed ? " media-load-obscured" : ""
              }`}
              data-testid="video-node-preview"
              key={mediaLoad.key}
              muted={muted}
              onEnded={() => setPlaying(false)}
              onError={mediaLoad.markFailed}
              onLoadedMetadata={(event) => {
                mediaLoad.markLoaded();
                captureMetadata(event.currentTarget);
              }}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime)
              }
              playsInline
              preload="auto"
              ref={videoRef}
              src={mediaLoad.source}
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
        ) : !generating && !uploading ? (
          <div aria-hidden="true" className="video-node-empty-action">
            <svg aria-hidden="true" viewBox="0 0 48 48">
              <rect height="34" rx="6" width="38" x="5" y="7" />
              <path d="m19 16 13 8-13 8Z" />
            </svg>
          </div>
        ) : null}
        {data.videoSrc && mediaLoad.failed && (
          <MediaLoadFallback
            kind="视频"
            onReload={mediaLoad.reload}
            onReplace={() => inputRef.current?.click()}
          />
        )}
        {(generating || uploading) && (
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
        !mediaLoad.failed &&
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
