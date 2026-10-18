import { MediaAspectFitButton } from "./MediaAspectFitButton";
import { adoptedMediaStyle } from "../../../types/mediaGeometry";
import { boundGenerationParameterProof, boundGenerationSourceProof } from "../../../types/generationIdentity";
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
import {
  canvasUploadTargetStillCurrent,
  useCanvasGraphMutation,
} from "./CanvasGraphMutationContext";
import {
  canvasModelTransitionExpectedBefore,
  type CanvasModelTransitionRequest,
  type CanvasModelTransitionResult,
} from "./CanvasModelTransitionCommand";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import {
  MediaLoadFallback,
  useMediaLoadRecovery,
} from "./MediaLoadFallback";
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
  workflowBlocksSingleNodeRecovery,
} from "../generation/taskPolling";
import {
  type NodeGenerationOutcome,
} from "../generation/workflowExecution";
import { groupRunResultKey } from "../generation/groupRunCheckpoint";
import {
  generationNoticeTone,
  shouldClearStaleVideoInputError,
  visibleGenerationError,
} from "../generation/generationErrors";
import {
  generationFailureMessage,
  generationFailureIsDefinitive,
  generationInputKey as createGenerationInputKey,
  generationRetryVisible,
  safelyRetryableGenerationTask,
} from "../generation/generationRetry";
import {
  clearGenerationSubmissionIntent,
  GENERATION_TASK_RETRY_ACCEPTED_EVENT,
  GenerationRequestError,
  getGenerationTask,
  reconcileOutcomeMessage,
  runWithSingleNodeGenerationAdmission,
  waitForGenerationTask,
  type GenerationTaskRetryAcceptedDetail,
  type GenerationTaskSummary,
} from "../generation/generationTasks";
import {
  createSingleNodeGenerationLifecycle,
  markSingleNodeSemanticEdit,
  readSingleNodeSemanticEditVersion,
  taskMatchesSingleNodeGenerationIdentity,
  type SingleNodeGenerationAdapter,
  type SingleNodeGenerationBlocked,
  type SingleNodeLifecycleResult,
  type SingleNodeGenerationPlan,
} from "../generation/singleNodeGenerationLifecycle";
import {
  defaultParameterSchema,
  defaultParameterValues,
  normalizeParameterValues,
  parameterKeysForGroups,
  submissionParameterValues,
} from "../../../types/modelParameters";
import {
  availableNodeInputRoles,
  moveNodeInputEdge,
  resolveNodeInputs,
  type NodeInputProblem,
} from "../../../types/nodeInputs";
import { UpstreamInputCards } from "./UpstreamInputCards";
import { GenerationAvailabilityNotice } from "./GenerationAvailabilityNotice";
import { ProviderErrorNotice } from "../generation/ProviderErrorNotice";
import { useGenerationRecoveryFollowUp } from "../generation/GenerationRecoveryContext";
import type { CuttableEdge } from "./canvasTypes";
import type { CanvasGraphSnapshot } from "./canvasPorts";
import {
  effectiveMediaInputState,
  effectiveMediaInputStateReason,
  fetchTrustedMediaMetadata,
  hasCompleteTrustedMediaMetadata,
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

type VideoGenerationRevocationIdentity = {
  inputKey?: string;
  ownershipKey?: string;
  taskId?: string;
};

function videoGenerationRevocationIdentity(
  data: ProbeNodeType["data"],
): VideoGenerationRevocationIdentity {
  return {
    inputKey: data.videoGenerationInputKey,
    ownershipKey: data.videoGenerationOwnershipKey,
    taskId: data.videoGenerationTaskId,
  };
}

function createVideoGenerationAdapter(input: {
  bindingOwnershipKey?: string;
  contractFingerprint: string;
  inputKey: string;
  modelId?: string;
  modelName?: string;
  modelConfigurationRevision: string;
  modelReleaseRevision: string;
  nodeId: string;
  ownershipKey: string;
  parameters?: ProbeNodeType["data"]["videoParameters"];
  payload: unknown;
  preserveBindingOwnership?: boolean;
  prompt: string;
  readBlock: () => SingleNodeGenerationBlocked | undefined;
}): SingleNodeGenerationAdapter {
  return {
    applyPrepared(node) {
      return {
        ...node,
        data: {
          ...node.data,
          videoModel: input.modelName,
          videoModelId: input.modelId,
          videoParameters: input.parameters,
          videoGenerationModelInputContractFingerprint: input.contractFingerprint,
          videoGenerationModelConfigurationRevision:
            input.modelConfigurationRevision,
          videoGenerationModelReleaseRevision: input.modelReleaseRevision,
        },
      };
    },
    applyBinding(node, task, plan) {
      return {
        ...node,
        data: {
          ...node.data,
          groupRunSuccessOwnershipKey: undefined,
          groupRunSuccessResultKey: undefined,
          groupRunSuccessTaskId: undefined,
          videoGenerating: true,
          videoGenerationError: undefined,
          videoGenerationErrorCode: undefined,
          videoGenerationContractFingerprint: undefined,
          videoGenerationInputKey: plan.inputKey,
          videoGenerationModelConfigurationRevision:
            plan.modelConfigurationRevision,
          videoGenerationModelInputContractFingerprint: plan.contractFingerprint,
          videoGenerationModelReleaseRevision: plan.modelReleaseRevision,
          videoGenerationOwnershipKey: input.preserveBindingOwnership
            ? input.bindingOwnershipKey
            : task.generationOwnershipKey ?? plan.ownershipKey,
          videoGenerationRetryAllowed: undefined,
          videoGenerationRetryBlockCode: undefined,
          videoGenerationRetryBlockReason: undefined,
          videoGenerationTaskId: task.id,
          videoModel: input.modelName,
          videoModelId: input.modelId,
          videoParameters: input.parameters,
        },
      };
    },
    applyTerminal(node, task, plan) {
      if (task.state === "success") {
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
        return {
          ...node,
          height: undefined,
          measured: undefined,
          width: undefined,
          data: {
            ...node.data,
            assetId: task.resultAssetId,
            ...metadataPatch,
            groupRunSuccessOwnershipKey: plan.ownershipKey,
            groupRunSuccessResultKey: groupRunResultKey(task.resultUrl),
            groupRunSuccessTaskId: task.id,
            videoAudioEnabled: input.parameters?.generateAudio !== false,
            videoCreatedAt: new Intl.DateTimeFormat("zh-CN").format(new Date()),
            videoGenerating: false,
            videoGenerationError: undefined,
            videoGenerationErrorCode: undefined,
            videoGenerationContractFingerprint: undefined,
            videoGenerationRetryAllowed: undefined,
            videoGenerationRetryBlockCode: undefined,
            videoGenerationRetryBlockReason: undefined,
            videoGenerationTaskId: undefined,
            videoModel:
              input.modelName ?? node.data.videoModel ?? "Seedance 2.0 Mini",
            videoPrompt: input.prompt,
            videoSrc: task.resultUrl,
          },
        };
      }
      if (task.state === "cancelled") {
        return {
          ...node,
          data: {
            ...node.data,
            videoGenerating: false,
            videoGenerationError: task.errorMessage ?? "视频生成已取消",
            videoGenerationErrorCode: undefined,
            videoGenerationInputKey: undefined,
            videoGenerationOwnershipKey: undefined,
            videoGenerationRetryAllowed: undefined,
            videoGenerationRetryBlockCode: undefined,
            videoGenerationRetryBlockReason: undefined,
            videoGenerationTaskId: undefined,
          },
        };
      }
      const retryAllowed = safelyRetryableGenerationTask(task);
      const visibleMessage = generationFailureMessage(
        task.errorMessage ?? "视频生成失败，请稍后再试",
        retryAllowed ? undefined : task.retryBlockReason,
        task.errorCode,
        "video",
      );
      return {
        ...node,
        data: {
          ...node.data,
          videoGenerating: false,
          videoGenerationError: visibleMessage,
          videoGenerationErrorCode: task.errorCode,
          videoGenerationInputKey: plan.inputKey,
          videoGenerationRetryAllowed: retryAllowed,
          videoGenerationRetryBlockCode: task.retryBlockCode,
          videoGenerationRetryBlockReason: task.retryBlockReason,
          videoGenerationTaskId: task.id,
        },
      };
    },
    kind: "video",
    readPlan(): SingleNodeGenerationBlocked | SingleNodeGenerationPlan {
      const block = input.readBlock();
      if (block) return block;
      return {
        contractFingerprint: input.contractFingerprint,
        inputKey: input.inputKey,
        kind: "video",
        modelConfigurationRevision: input.modelConfigurationRevision,
        modelReleaseRevision: input.modelReleaseRevision,
        nodeId: input.nodeId,
        ownershipKey: input.ownershipKey,
        payload: input.payload,
      };
    },
  };
}

function videoTaskMatchesNode(
  task: GenerationTaskSummary,
  canvasId: string,
  nodeId: string,
  taskId = task.id,
  fixtureScopeId = "",
) {
  return task.id === taskId &&
    task.canvasId === canvasId &&
    (task.fixtureScopeId ?? "") === fixtureScopeId &&
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
    (effectiveMediaInputState(node.data) === undefined ||
      effectiveMediaInputState(node.data) === "ready"),
  );
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
  const { lockedNodeIds, stoppedNodeIds } = useWorkflowExecution();
  const workflowRecoveryStopped = stoppedNodeIds.has(id);
  const storedLegacyState = useLegacyTerminalGenerationState(id);
  const legacyState = effectiveLegacyTerminalGenerationState({
    bindingComplete: Boolean(
      data.videoGenerationTaskId && data.videoGenerationOwnershipKey &&
        data.videoGenerationInputKey,
    ),
    hasLegacyRun: Boolean(data.workflowExecutionRunId),
    locallyActive: lockedNodeIds.has(id),
    persistedGenerating: data.videoGenerating === true,
    state: storedLegacyState,
  });
  const displayVideoGenerating = !workflowRecoveryStopped && (legacyState && legacyState !== "PASSTHROUGH"
    ? legacyState === "ACTIVE_CONFIRMED"
    : Boolean(data.videoGenerating));
  const legacySubmissionBlocked = legacyState === "DETECTING" ||
    legacyState === "ACTIVE_CONFIRMED" || legacyState === "UNKNOWN_BLOCKED";
  const mediaLoad = useMediaLoadRecovery(data.videoSrc);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  const { getNodes } = useReactFlow<ProbeNodeType>();
  const {
    adoptUploadedAsset,
    adoptAuthoritativeNodeData,
    applyViewUpdate,
    applyModelTransition,
    canvasMutationPendingNodeIds,
    graphCommandPort,
    mutateGraph,
    readCanvasNode,
    readCanvasMutationVersion,
    tryAdoptNodes,
  } =
    useCanvasGraphMutation();
  const canvasMutationPending = canvasMutationPendingNodeIds.has(id);
  const canvasEdges = useEdges();
  const canvasNodes = useNodes<ProbeNodeType>();
  const checkpoint = useCanvasCheckpoint();
  const {
    accountId,
    canvasId,
    canvasRevision,
    fixtureScopeId,
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
  const liveVideoModelsRef = useRef(videoModels);
  liveVideoModelsRef.current = videoModels;
  const selectedVideoModel = videoModelSelection.model;
  const selectedVideoModelId = videoModelSelection.selectedId;
  const videoModelUnavailableReason = videoModelSelection.unavailableReason;
  const applyInteractiveModelTransition = async (
    request: CanvasModelTransitionRequest,
  ): Promise<CanvasModelTransitionResult> => {
    if (!applyModelTransition || !graphCommandPort) {
      return { message: "画布事务尚未就绪", status: "rejected" };
    }
    const expectedBefore = request.expectedBefore ??
      canvasModelTransitionExpectedBefore(graphCommandPort.snapshot(), id);
    try {
      return await runWithSingleNodeGenerationAdmission({
        accountId,
        canvasId,
        fixtureScopeId,
      }, id, () => applyModelTransition({ ...request, expectedBefore }));
    } catch (error) {
      return {
        message: error instanceof Error
          ? error.message
          : "当前节点正在整组执行中，请稍后再切换",
        status: "rejected",
      };
    }
  };
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
  const generating = !workflowRecoveryStopped && Boolean(data.videoGenerating);
  const generatedSuccess = Boolean(data.videoSrc && data.videoPromptReady);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  // 页面刷新或组件重挂后 activeTaskId 会丢失，但持久化任务号还在；
  // 取消按钮用它兜底，保证“生成中一定能取消”。
  const cancelableTaskId = activeTaskId ??
    (typeof data.videoGenerationTaskId === "string"
      ? data.videoGenerationTaskId
      : undefined);
  const [submitting, setSubmitting] = useState(false);
  const normalSubmissionInFlightRef = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [viewVideoMetadata, setViewVideoMetadata] = useState<{
    duration: number;
    height: number;
    source: string;
    width: number;
  }>();
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
  const [submissionFailure, setSubmissionFailure] = useState<string>();
  const setVideoSubmissionError = (message: string, errorCode?: string | null) => {
    setSubmissionFailure(message || undefined);
    setUploadError(message, errorCode);
  };
  const [transientUploadError, setTransientUploadError] = useState("");
  // Local upload rejections are confirmed failures of the user's action, not
  // generation input blockers, so they keep the failure notice tone.
  const [uploadFailureMessage, setUploadFailureMessage] = useState("");
  const [retryTaskId, setRetryTaskId] = useState<string>();
  const [newGenerationTaskId, setNewGenerationTaskId] = useState<string>();
  const [newGenerationAllowed, setNewGenerationAllowed] = useState(false);
  const [newGenerationBlockReason, setNewGenerationBlockReason] = useState("");
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
  const [unverifiedRecoveryTaskId, setUnverifiedRecoveryTaskId] =
    useState<string>();
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const generationPollingRunRef = useRef<VideoPollingRun | undefined>(undefined);
  const videoRecoveryControllerRef = useRef<AbortController | undefined>(
    undefined,
  );
  useEffect(() => () => {
    videoRecoveryControllerRef.current?.abort("video-node-unmounted");
    videoRecoveryControllerRef.current = undefined;
  }, []);
  const videoRecoveryLifecycleRef = useRef<ReturnType<
    typeof createSingleNodeGenerationLifecycle
  > | undefined>(undefined);
  const nodeRecoveryCase = useGenerationRecoveryFollowUp(
    data.videoGenerationTaskId,
    Boolean(submitting || normalSubmissionInFlightRef.current ||
      generationPollingRunRef.current || videoRecoveryControllerRef.current),
    () => {
      // A new durable result/progress version can resume a paused read. A
      // submit-state render alone must not restart an exhausted read budget.
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      setRecoveryEpoch((current) => current + 1);
    },
  );
  const videoRetryLifecycleRef = useRef<ReturnType<
    typeof createSingleNodeGenerationLifecycle
  > | undefined>(undefined);
  const liveGenerationInputKeyRef = useRef<string | undefined>(undefined);
  const liveGenerationOwnershipKeyRef = useRef<string | undefined>(undefined);
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const [retryWakeEpoch, setRetryWakeEpoch] = useState(0);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadAdmissionPending = useRef(false);
  const uploadInFlight = useRef(false);
  const metadataHydrationAssetIdRef = useRef<string | undefined>(undefined);
  const uploadOperation = useRef(0);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const videoDataMutationVersionRef = useRef(0);
  const videoMutationScopeKey = JSON.stringify([
    accountId,
    canvasId,
    fixtureScopeId,
    id,
  ]);
  const liveVideoMutationScopeKeyRef = useRef(videoMutationScopeKey);
  liveVideoMutationScopeKeyRef.current = videoMutationScopeKey;
  const clearVideoGenerationForSemanticChange = (
    current: ProbeNodeType["data"],
  ): ProbeNodeType["data"] => ({
    ...current,
    groupRunSuccessOwnershipKey: undefined,
    groupRunSuccessResultKey: undefined,
    groupRunSuccessTaskId: undefined,
    videoGenerationError: undefined,
    videoGenerationErrorCode: undefined,
    videoGenerationInputKey: undefined,
    videoGenerationOwnershipKey: undefined,
    videoGenerating: false,
    videoGenerationRetryAllowed: undefined,
    videoGenerationRetryBlockCode: undefined,
    videoGenerationRetryBlockReason: undefined,
    videoGenerationTaskId: undefined,
  });
  const revokeVideoTaskForGenerationInputChange = (expectedTaskId?: string) => {
    const currentRun = generationPollingRunRef.current;
    if (
      currentRun &&
      (expectedTaskId === undefined || currentRun.taskId !== expectedTaskId)
    ) {
      if (expectedTaskId) {
        clearGenerationSubmissionIntent(
          "video",
          canvasId,
          id,
          expectedTaskId,
          accountId,
          fixtureScopeId,
        );
      }
      return;
    }
    videoRecoveryControllerRef.current?.abort("video-generation-input-changed");
    videoRecoveryControllerRef.current = undefined;
    videoRecoveryLifecycleRef.current?.abort("video-generation-input-changed");
    videoRetryLifecycleRef.current?.abort("video-generation-input-changed");
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
      expectedTaskId,
      accountId,
      fixtureScopeId,
    );
  };
  const finishVideoGenerationInputRevocation = (
    identity: VideoGenerationRevocationIdentity,
    expectedScopeKey: string,
  ) => {
    const currentRun = generationPollingRunRef.current;
    const replacementClaimed = identity.taskId === undefined
      ? Boolean(currentRun)
      : Boolean(
          currentRun && (
            currentRun.taskId !== identity.taskId ||
            (identity.inputKey !== undefined &&
              currentRun.inputKey !== identity.inputKey) ||
            (identity.ownershipKey !== undefined &&
              currentRun.ownershipKey !== identity.ownershipKey)
          ),
        );
    if (
      liveVideoMutationScopeKeyRef.current !== expectedScopeKey ||
      replacementClaimed
    ) {
      if (identity.taskId) {
        clearGenerationSubmissionIntent(
          "video",
          canvasId,
          id,
          identity.taskId,
          accountId,
          fixtureScopeId,
        );
      }
      return;
    }
    revokeVideoTaskForGenerationInputChange(identity.taskId);
  };
  const commitVideoDataMutation = (
    update: (current: ProbeNodeType["data"]) => ProbeNodeType["data"],
    afterApplied?: (identity: VideoGenerationRevocationIdentity) => void,
  ) => {
    const mutationVersion = videoDataMutationVersionRef.current + 1;
    videoDataMutationVersionRef.current = mutationVersion;
    const expectedScopeKey = videoMutationScopeKey;
    let identity: VideoGenerationRevocationIdentity | undefined;
    void mutateGraph(({ edges, nodes }) => ({
      edges,
      nodes: nodes.map((node) => {
        if (node.id !== id) return node;
        identity = videoGenerationRevocationIdentity(node.data);
        return { ...node, data: update(node.data) };
      }),
    })).then((applied) => {
      if (
        !applied ||
        !identity ||
        videoDataMutationVersionRef.current !== mutationVersion ||
        liveVideoMutationScopeKeyRef.current !== expectedScopeKey
      ) return;
      if (afterApplied) afterApplied(identity);
      else finishVideoGenerationInputRevocation(identity, expectedScopeKey);
    });
  };
  const commitVideoInputEdgesMutation = (
    updateEdges: (edges: CuttableEdge[]) => CuttableEdge[],
  ) => {
    const mutationVersion = videoDataMutationVersionRef.current + 1;
    videoDataMutationVersionRef.current = mutationVersion;
    const expectedScopeKey = videoMutationScopeKey;
    let identity: VideoGenerationRevocationIdentity | undefined;
    void mutateGraph(({ edges, nodes }) => {
      const target = nodes.find((node) => node.id === id);
      identity = target
        ? videoGenerationRevocationIdentity(target.data)
        : undefined;
      return { edges: updateEdges(edges), nodes };
    }).then((applied) => {
      if (
        !applied ||
        !identity ||
        videoDataMutationVersionRef.current !== mutationVersion ||
        liveVideoMutationScopeKeyRef.current !== expectedScopeKey
      ) return;
      finishVideoGenerationInputRevocation(identity, expectedScopeKey);
    });
  };
  const beginGenerationPollingRun = (
    taskId: string,
    inputKey?: string,
    ownershipKey?: string,
  ): VideoPollingRun => {
    videoDataMutationVersionRef.current += 1;
    videoRecoveryLifecycleRef.current?.abort("video-recovery-superseded");
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
  const promptSemanticVersionRef = useRef(0);
  const promptControl = useCompositionSafeText({
    onCommit: (nextPrompt) => {
      if (nextPrompt === prompt) return;
      markSingleNodeSemanticEdit({
        accountId,
        canvasId,
        fixtureScopeId,
        kind: "video",
        nodeId: id,
      });
      videoRecoveryControllerRef.current?.abort("video-input-edited");
      videoRecoveryControllerRef.current = undefined;
      videoRecoveryLifecycleRef.current?.abort("video-input-edited");
      videoRetryLifecycleRef.current?.abort("video-input-edited");
      promptSemanticVersionRef.current += 1;
      commitVideoDataMutation((current) => ({
        ...clearVideoGenerationForSemanticChange(current),
        videoPrompt: nextPrompt,
      }), (identity) => {
        setPrompt(nextPrompt);
        finishVideoGenerationInputRevocation(identity, videoMutationScopeKey);
      });
    },
    onEditSessionStart: checkpoint,
    value: prompt,
  });
  const titleControl = useCompositionSafeText({
    onCommit: (nextTitle) => {
      commitVideoDataMutation(
        (current) => ({ ...current, title: nextTitle }),
        () => setTitle(nextTitle),
      );
    },
    onEditSessionStart: checkpoint,
    value: title,
  });
  const activeViewVideoMetadata =
    viewVideoMetadata?.source === data.videoSrc ? viewVideoMetadata : undefined;
  const duration = activeViewVideoMetadata?.duration ?? data.videoDuration ??
    data.mediaDurationSeconds ?? 0;
  const displayVideoHeight = activeViewVideoMetadata?.height ??
    data.videoHeight ?? data.mediaHeight ?? 0;
  const displayVideoWidth = activeViewVideoMetadata?.width ?? data.videoWidth ??
    data.mediaWidth ?? 0;
  const effectiveInputState = effectiveMediaInputState(data);
  const effectiveInputStateReason = effectiveMediaInputStateReason(data);
  const uploading = effectiveInputState === "uploading";
  const inputPreflight = resolveNodeInputs({
    edges: canvasEdges,
    mediaInputPolicy: selectedVideoModel?.mediaInputPolicy,
    modelReleaseRevision: selectedVideoModel?.releaseRevisionId,
    modelSchema: selectedVideoModel?.parameterSchema,
    nodes: canvasNodes,
    ownPrompt: promptControl.committedValue,
    parameters: videoSubmissionParameters,
    targetId: id,
    targetKind: "video",
  });
  const normalizedVideoParameters = selectedVideoModel
    ? normalizeParameterValues(
        videoParameterSchema,
        inputPreflight.normalizedParameters ?? videoParameters,
      )
    : {};
  const normalizedVideoSubmissionParameters = selectedVideoModel
    ? submissionParameterValues(videoParameterSchema, normalizedVideoParameters)
    : {};
  const inputProblems: NodeInputProblem[] = [
    ...(modelSwitchProblem
      ? [{ code: "MODEL_UNSUPPORTED" as const, message: modelSwitchProblem }]
      : []),
    ...inputPreflight.problems,
    ...serverInputProblems,
  ];
  const uploadFailureNotice = Boolean(transientUploadError) ||
    Boolean(
      uploadFailureMessage &&
      uploadError === uploadFailureMessage &&
      !submissionFailure &&
      !workflowRecoveryStopped,
    );
  const videoNoticeMessage = effectiveInputState === "invalid" &&
    inputProblems.length > 0 && !uploadFailureNotice
    ? ""
    : transientUploadError || submissionFailure || (workflowRecoveryStopped
      ? friendlyGenerationMessage("", "video", "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED")
      : uploadError);
  const videoNoticeTone = uploadFailureNotice
    ? generationNoticeTone({ message: videoNoticeMessage })
    : generationNoticeTone({
    code: workflowRecoveryStopped ? "AUTOMATIC_RECOVERY_WINDOW_EXHAUSTED" : data.videoGenerationErrorCode,
    inputBlocked: Boolean(
      modelSwitchProblem ||
      inputPreflight.problems.length ||
      serverInputProblems.length ||
      effectiveInputState === "invalid",
    ),
    message: videoNoticeMessage,
    recovering: Boolean(
      pollingPausedTaskId ||
      unverifiedRecoveryTaskId ||
      savingCanvas,
    ),
  });
  const inputFeedbackFingerprint = JSON.stringify({
    edges: canvasEdges.map((edge) => [edge.id, edge.source, edge.target, edge.data]),
    model: selectedVideoModel?.id,
    parameters: normalizedVideoSubmissionParameters,
    prompt: promptControl.committedValue,
    revision: canvasRevision,
  });
  const videoGenerationInputKey = createGenerationInputKey({
    inputs: inputPreflight.inputs,
    modelConfigurationRevision: selectedVideoModel?.configurationRevision,
    modelId: selectedVideoModelId,
    modelReleaseRevision: selectedVideoModel?.releaseRevisionId,
    ownPrompt: promptControl.committedValue,
    parameters: normalizedVideoSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  });
  const generationOwnershipUpstream = inputPreflight.inputs.map((input) => {
      return {
        assetId: input.kind === "text" ? undefined : input.assetId,
        edgeId: input.edgeId,
        metadataStatus: input.metadataStatus,
        order: input.order,
        ready: input.state === "ready",
        role: input.role,
        source: input.sourceNodeId,
        sourceKind: input.kind,
        src: input.kind === "text" ? undefined : input.preview,
        status: input.state,
        text: input.kind === "text" ? input.text : undefined,
      };
    });
  const effectiveGenerationInputFingerprint = generationOwnershipKey({
    contractFingerprint: inputPreflight.contractFingerprint,
    modelConfigurationRevision: selectedVideoModel?.configurationRevision,
    modelId: selectedVideoModelId,
    modelReleaseRevision: selectedVideoModel?.releaseRevisionId,
    parameters: selectedVideoModel ? videoSubmissionParameters : data.videoParameters,
    prompt: promptControl.committedValue,
    upstream: generationOwnershipUpstream,
  });
  // New user intent follows the live input, while an old task keeps its own
  // frozen ownership for recovery. Those identities need not be equal.
  const liveEffectiveGenerationOwnershipKeyRef = useRef(effectiveGenerationInputFingerprint);
  liveEffectiveGenerationOwnershipKeyRef.current = effectiveGenerationInputFingerprint;
  const boundParameterProof = boundGenerationParameterProof({
    kind: "video",
    frozen: {
      inputKey: data.videoGenerationInputKey,
      ownershipKey: data.videoGenerationOwnershipKey,
      modelId: data.videoModelId,
      modelConfigurationRevision: data.videoGenerationModelConfigurationRevision,
      modelReleaseRevision: data.videoGenerationModelReleaseRevision,
      contractFingerprint: data.videoGenerationModelInputContractFingerprint,
    },
    current: selectedVideoModel ? {
      capability: selectedVideoModel.capability,
      modelId: selectedVideoModel.id,
      modelConfigurationRevision: selectedVideoModel.configurationRevision,
      modelReleaseRevision: selectedVideoModel.releaseRevisionId,
      contractFingerprint: inputPreflight.contractFingerprint,
      parameterSchema: selectedVideoModel.parameterSchema,
      parameters: data.videoParameters,
    } : undefined,
  });
  const boundParameterProofRef = useRef(boundParameterProof);
  boundParameterProofRef.current = boundParameterProof;
  const boundSourceProof = boundGenerationSourceProof(data.videoGenerationInputKey, videoGenerationInputKey);
  const boundSourceProofRef = useRef(boundSourceProof);
  boundSourceProofRef.current = boundSourceProof;
  const rawGenerationInputFingerprint = data.videoGenerationOwnershipKey ?? generationOwnershipKey({
    contractFingerprint: data.videoGenerationOwnershipKey
      ? data.videoGenerationModelInputContractFingerprint
      : inputPreflight.contractFingerprint,
    modelConfigurationRevision: data.videoGenerationOwnershipKey
      ? data.videoGenerationModelConfigurationRevision
      : selectedVideoModel?.configurationRevision,
    // Once a task is ownership-bound, catalog changes must not reinterpret its
    // saved model snapshot. Before admission, use the effective values that are
    // materialized and ACKed on the canvas below.
    modelId: data.videoGenerationOwnershipKey
      ? data.videoModelId
      : selectedVideoModelId,
    modelReleaseRevision: data.videoGenerationOwnershipKey
      ? data.videoGenerationModelReleaseRevision
      : selectedVideoModel?.releaseRevisionId,
    parameters: data.videoGenerationOwnershipKey
      ? data.videoParameters
      : selectedVideoModel
        ? videoSubmissionParameters
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
    parameters: normalizedVideoSubmissionParameters,
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
    (!data.videoGenerationOwnershipKey || boundParameterProof.state === "valid") &&
    data.videoGenerationInputKey === videoGenerationInputKey &&
    (!data.videoGenerationOwnershipKey ||
      data.videoGenerationOwnershipKey === rawGenerationInputFingerprint) &&
    data.videoGenerationRetryAllowed === true &&
    selectedVideoModel &&
    selectedVideoModel.generationAvailable !== false,
  );
  const newGenerationAvailable = Boolean(
    newGenerationTaskId &&
    newGenerationAllowed &&
    selectedVideoModel &&
    selectedVideoModel.generationAvailable !== false,
  );
  const existingVideoTaskNeedsDecision = Boolean(
    data.videoGenerationTaskId &&
    data.videoGenerationError &&
    !data.videoGenerating &&
    !newGenerationAvailable,
  );
  const showVideoRetry = generationRetryVisible({
    errorCode: data.videoGenerationErrorCode,
    retryAvailable,
  });
  const canReconcileVideo = false;

  useEffect(() => {
    if (
      !persistenceReady ||
      !shouldClearStaleVideoInputError({
        canSubmit: inputPreflight.canSubmit && inputProblems.length === 0,
        error: data.videoGenerationError,
        errorCode: data.videoGenerationErrorCode,
        identityBindings: [
          data.videoGenerationTaskId,
          data.videoGenerationInputKey,
          data.videoGenerationOwnershipKey,
          data.videoGenerationContractFingerprint,
          data.videoGenerationModelInputContractFingerprint,
          data.videoInputContractFingerprint,
          data.videoGenerating,
        ],
      })
    ) return;
    applyViewUpdate((nodes) => nodes.map((node) => {
      if (node.id !== id || !shouldClearStaleVideoInputError({
        canSubmit: true,
        error: node.data.videoGenerationError,
        errorCode: node.data.videoGenerationErrorCode,
        identityBindings: [
          node.data.videoGenerationTaskId,
          node.data.videoGenerationInputKey,
          node.data.videoGenerationOwnershipKey,
          node.data.videoGenerationContractFingerprint,
          node.data.videoGenerationModelInputContractFingerprint,
          node.data.videoInputContractFingerprint,
          node.data.videoGenerating,
        ],
      })) return node;
      return {
        ...node,
        data: {
          ...node.data,
          videoGenerationError: undefined,
          videoGenerationErrorCode: undefined,
        },
      };
    }));
  }, [
    data.videoGenerating,
    data.videoGenerationContractFingerprint,
    data.videoGenerationError,
    data.videoGenerationErrorCode,
    data.videoGenerationInputKey,
    data.videoGenerationModelInputContractFingerprint,
    data.videoGenerationOwnershipKey,
    data.videoGenerationTaskId,
    data.videoInputContractFingerprint,
    id,
    inputPreflight.canSubmit,
    inputProblems.length,
    persistenceReady,
    applyViewUpdate,
  ]);

  useEffect(() => {
    setModelSwitchProblem("");
  }, [canvasEdges]);

  useEffect(() => {
    setServerInputProblems([]);
  }, [inputFeedbackFingerprint]);

  useEffect(() => {
    setSubmissionFailure(undefined);
  }, [data.videoGenerationTaskId, data.videoSrc]);

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
    if (data.workflowExecutionRunId || data.videoGenerationOwnershipKey) {
      stableRawGenerationInputFingerprint.current = rawGenerationInputFingerprint;
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
    if (persistedMismatch) {
      clearGenerationSubmissionIntent(
        "video",
        canvasId,
        id,
        data.videoGenerationTaskId,
        accountId,
        fixtureScopeId,
      );
    }
    commitVideoDataMutation(clearVideoGenerationForSemanticChange);
  }, [
    accountId,
    canvasId,
    data.videoGenerating,
    data.videoGenerationInputKey,
    data.videoGenerationOwnershipKey,
    data.videoGenerationTaskId,
    data.workflowExecutionRunId,
    id,
    persistenceReady,
    rawGenerationInputFingerprint,
  ]);

  const persistVideoGenerationFailure = async (
    taskId: string,
    message: string,
    errorCode: string | undefined,
    retryAllowed: boolean,
    retryBlockCode?: string,
    retryBlockReason?: string,
    _generationInputKey?: string,
    _generationOwnershipKey?: string,
    _contractFingerprint?: string,
  ) => {
    const visibleMessage = generationFailureMessage(
      message,
      retryAllowed ? undefined : retryBlockReason,
      errorCode,
      "video",
    );
    const applied = applyViewUpdate((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationError: visibleMessage,
            videoGenerationErrorCode: errorCode,
            videoGenerating: false,
            videoGenerationRetryAllowed: retryAllowed,
            videoGenerationRetryBlockCode: retryBlockCode,
            videoGenerationRetryBlockReason: retryBlockReason,
          },
      }
      : node));
    if (!applied) return false;
    setUploadError(visibleMessage, errorCode);
    setRetryTaskId(retryAllowed ? taskId : undefined);
    clearGenerationSubmissionIntent(
      "video",
      canvasId,
      id,
      taskId,
      accountId,
      fixtureScopeId,
    );
    return true;
  };

  const persistVideoGenerationCancellation = async (
    taskId: string,
    message: string,
  ) => {
    const applied = applyViewUpdate((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            videoGenerationError: message,
            videoGenerationErrorCode: undefined,
            videoGenerating: false,
            videoGenerationRetryAllowed: undefined,
            videoGenerationRetryBlockCode: undefined,
            videoGenerationRetryBlockReason: undefined,
          },
      }
      : node));
    if (!applied) return false;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setUploadError(message);
    setRetryTaskId(undefined);
    clearGenerationSubmissionIntent(
      "video",
      canvasId,
      id,
      taskId,
      accountId,
      fixtureScopeId,
    );
    return true;
  };

  useEffect(() => {
    if (pollingPausedTaskIdRef.current) return;
    setUploadError(
      effectiveInputState === "invalid"
        ? effectiveInputStateReason ?? data.videoGenerationError ?? "视频不可用"
        : visibleGenerationError(data.videoGenerationError),
      effectiveInputState === "invalid"
        ? "INPUT_INVALID"
        : data.videoGenerationErrorCode,
    );
  }, [
    effectiveInputState,
    effectiveInputStateReason,
    data.videoGenerationError,
    data.videoGenerationErrorCode,
  ]);

  useEffect(() => {
    if (
      !persistenceReady ||
      effectiveInputState !== "uploading" ||
      uploadInFlight.current
    ) return;
    const message = "视频上传已中断，请重新上传";
    applyViewUpdate((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, ...mediaUploadState("invalid", message) } }
      : node));
  }, [applyViewUpdate, effectiveInputState, id, persistenceReady]);

  useEffect(() => {
    if (
      !uploadInFlight.current ||
      uploadAdmissionPending.current ||
      effectiveMediaInputState(readCanvasNode(id)?.data ?? {}) === "uploading"
    ) return;
    uploadOperation.current += 1;
    uploadAdmissionPending.current = false;
    uploadController.current?.abort();
    uploadController.current = undefined;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, [effectiveInputState, id, readCanvasNode]);

  useEffect(() => {
    if (persistenceReady || !uploadInFlight.current) return;
    uploadOperation.current += 1;
    uploadAdmissionPending.current = false;
    uploadController.current?.abort();
    uploadController.current = undefined;
    uploadInFlight.current = false;
    uploadBaseline.current = undefined;
  }, [persistenceReady]);

  useEffect(() => () => {
    uploadOperation.current += 1;
    uploadAdmissionPending.current = false;
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
      hasCompleteTrustedMediaMetadata("video", data) ||
      metadataHydrationAssetIdRef.current === data.assetId ||
      effectiveInputState === "uploading"
    ) return;
    const requestedAssetId = data.assetId;
    metadataHydrationAssetIdRef.current = requestedAssetId;
    const controller = new AbortController();
    let settled = false;
    void fetchTrustedMediaMetadata("video", requestedAssetId, controller.signal)
      .then((metadata) => {
        settled = true;
        adoptAuthoritativeNodeData({
          expectedAssetId: requestedAssetId,
          nodeId: id,
          patch: trustedMediaPatch(metadata),
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        settled = true;
        const message = error instanceof Error
          ? error.message
          : "服务端无法确认视频素材信息";
        applyViewUpdate((nodes) => nodes.map((node) =>
          node.id === id && node.data.assetId === requestedAssetId
          ? { ...node, data: { ...node.data, ...mediaUploadState("invalid", message) } }
          : node));
      });
    return () => {
      controller.abort();
      if (!settled && metadataHydrationAssetIdRef.current === requestedAssetId) {
        metadataHydrationAssetIdRef.current = undefined;
      }
    };
  }, [
    canvasId,
    data.assetId,
    effectiveInputState,
    data.mediaByteSize,
    data.mediaContentType,
    data.mediaDurationSeconds,
    data.mediaHeight,
    data.mediaMetadataSource,
    data.mediaMetadataStatus,
    data.mediaStorageBackend,
    data.mediaWidth,
    id,
    persistenceReady,
    adoptAuthoritativeNodeData,
    applyViewUpdate,
  ]);

  const applyGeneratedVideo = async (
    task: GenerationTaskSummary,
    cleanPrompt: string,
    run: VideoPollingRun,
    signal: AbortSignal,
  ) => {
    if (
      signal?.aborted ||
      !ownsGenerationPollingRun(run) ||
      !videoTaskMatchesNode(task, canvasId, id, run.taskId, fixtureScopeId)
    ) return false;
    if (!taskMatchesSingleNodeGenerationIdentity(task, {
      contractFingerprint:
        data.videoGenerationModelInputContractFingerprint ?? "",
      inputKey: run.inputKey ?? "",
      modelConfigurationRevision:
        data.videoGenerationModelConfigurationRevision ?? "",
      modelReleaseRevision: data.videoGenerationModelReleaseRevision ?? "",
      ownershipKey: run.ownershipKey ?? "",
    })) {
      throw new Error("视频任务合同已变化，旧结果已保留且未覆盖当前节点");
    }
    if (task.state !== "success" || !task.resultAssetId || !task.resultUrl) {
      throw new Error("视频结果不完整");
    }
    if (task.generationIdentityVersion === 2) {
      const projectionState = task.canvasProjectionState;
      const projectionMessage = projectionState === "conflict"
        ? "结果已生成，但节点输入已变化，未覆盖当前画布"
        : projectionState === "failed"
          ? "结果已生成，画布同步暂时失败，系统会继续重试"
          : projectionState === "applied"
            ? undefined
            : "结果已生成，画布正在同步";
      if (projectionState === "applied") {
        try {
          if (
            !await graphCommandPort?.refreshAuthoritativeDocument?.(signal) ||
            signal?.aborted ||
            !ownsGenerationPollingRun(run)
          ) return false;
        } catch {
          return false;
        }
        clearGenerationSubmissionIntent(
          "video",
          canvasId,
          id,
          task.id,
          accountId,
          fixtureScopeId,
        );
        return true;
      }
      const patched = graphCommandPort?.applyViewPatch?.({
        kind: "video",
        nodeId: id,
        ownershipKey: run.ownershipKey ?? "",
        patch: {
          videoGenerating: false,
          videoGenerationError: projectionMessage,
          videoGenerationErrorCode: projectionState === "conflict"
            ? "CANVAS_SERVER_OWNERSHIP_CONFLICT"
            : projectionState === "failed"
              ? "CANVAS_PROJECTION_FAILED"
              : "CANVAS_PROJECTION_PENDING",
        },
        taskId: task.id,
      });
      if (patched?.status !== "applied") return false;
      if (signal?.aborted || !ownsGenerationPollingRun(run)) return false;
      clearGenerationSubmissionIntent(
        "video",
        canvasId,
        id,
        task.id,
        accountId,
        fixtureScopeId,
      );
      return true;
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
    const applied = await tryAdoptNodes(id, (nodes) =>
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
                videoGenerationContractFingerprint: undefined,
                videoGenerating: false,
                videoGenerationRetryAllowed: undefined,
                videoGenerationRetryBlockCode: undefined,
                videoGenerationRetryBlockReason: undefined,
                videoGenerationTaskId: undefined,
                groupRunSuccessOwnershipKey: run.ownershipKey,
                groupRunSuccessResultKey: groupRunResultKey(task.resultUrl),
                groupRunSuccessTaskId: task.id,
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
    if (signal?.aborted || !ownsGenerationPollingRun(run) || !applied) {
      return false;
    }
    clearGenerationSubmissionIntent("video", canvasId, id, task.id, accountId, fixtureScopeId);
    return true;
  };

  const generateVideo = async (
    _options: { autoRecover?: boolean } = {},
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
      !selectedVideoModel.configurationRevision ||
      !selectedVideoModel.releaseRevisionId ||
      !selectedVideoModel.parameterSchema ||
      !applyModelTransition ||
      !graphCommandPort ||
      selectedVideoModel.generationAvailable === false
    ) {
      if (canvasRevision === undefined) {
        setVideoSubmissionError("画布尚未保存，保存完成后可生成", "CANVAS_NOT_SAVED");
      } else if (
        !inputProblems.length &&
        !videoModelUnavailableReason &&
        !isFixture &&
        !generating &&
        !submitting
      ) {
        setVideoSubmissionError("视频生成暂未开始，请检查当前节点状态");
      }
      return { status: "skipped" };
    }
    videoDataMutationVersionRef.current += 1;
    normalSubmissionInFlightRef.current = true;
    const submissionInputFingerprint = (snapshot: CanvasGraphSnapshot) =>
      canvasModelTransitionExpectedBefore({
        ...snapshot,
        nodes: snapshot.nodes.map((node) => {
          if (!["image", "video", "audio"].includes(node.type ?? "") ||
            node.data.mediaMetadataSource !== "server" ||
            node.data.mediaMetadataStatus !== "ready") return node;
          // Canvas reloads omit cached metadata. Its disappearance is not an
          // input edit; preparation below reloads it from the same asset ID.
          const sourceData = { ...node.data };
          for (const key of ["mediaByteSize", "mediaContentType",
            "mediaDurationSeconds", "mediaHeight", "mediaMetadataSource",
            "mediaMetadataStatus", "mediaStorageBackend", "mediaWidth"] as const) {
            delete sourceData[key];
          }
          if (sourceData.inputState === "ready") delete sourceData.inputState;
          return { ...node, data: sourceData };
        }),
      }, id).semanticFingerprint;
    const transitionInputFingerprint = submissionInputFingerprint(
      graphCommandPort.snapshot(),
    );
    const semanticEditVersions = [
      { kind: "video" as const, nodeId: id },
      ...inputPreflight.inputs.map((source) => ({
        kind: source.kind, nodeId: source.sourceNodeId,
      })),
    ].map((node) => {
      const scope = { accountId, canvasId, fixtureScopeId, ...node };
      return { scope, version: readSingleNodeSemanticEditVersion(scope) };
    });
    const assertSubmissionInputsUnedited = () => {
      // Editor commits can queue behind this submission's Canvas admission.
      // Check their synchronous intent as well as the committed graph below.
      if (semanticEditVersions.some(({ scope, version }) =>
        readSingleNodeSemanticEditVersion(scope) !== version)) {
        throw new Error("生成输入已修改，已停止本次生成");
      }
    };
    videoRecoveryControllerRef.current?.abort("video-new-generation");
    videoRecoveryControllerRef.current = undefined;
    videoRecoveryLifecycleRef.current?.abort("video-new-generation");
    setVideoSubmissionError("");
    setServerInputProblems([]);
    setRetryTaskId(undefined);
    setSubmitting(true);
    let pollingRun: VideoPollingRun | undefined;
    let admittedGenerationInputKey = videoGenerationInputKey;
    let admittedGenerationOwnershipKey = effectiveGenerationInputFingerprint;
    let admittedContractFingerprint = inputPreflight.contractFingerprint ?? "";
    const requestedModelId = selectedVideoModelId;
    const requestedModelName = videoModelSelection.displayName;
    const requestedParameters = { ...normalizedVideoParameters };
    const requestedPrompt = promptControl.committedValue.trim();
    let saveBoundary = 0;
    const compileCurrentSubmission = (
      model: NonNullable<typeof selectedVideoModel> & Readonly<{
        configurationRevision: string;
        parameterSchema: NonNullable<NonNullable<typeof selectedVideoModel>["parameterSchema"]>;
        releaseRevisionId: string;
      }>,
    ) => {
      assertSubmissionInputsUnedited();
      if (!graphCommandPort) throw new Error("画布事务尚未就绪");
      const snapshot = graphCommandPort.snapshot();
      const target = snapshot.nodes.find((node) => node.id === id);
      if (
        !target ||
        target.type !== "video" ||
        target.data.videoModelId !== model.id ||
        target.data.videoModelConfigurationRevision !==
          model.configurationRevision
      ) {
        throw new Error("视频节点模型合同已变化，未提交生成");
      }
      const graphPrompt = typeof target.data.videoPrompt === "string"
        ? target.data.videoPrompt.trim()
        : "";
      const normalizedParameters = normalizeParameterValues(
        model.parameterSchema,
        target.data.videoParameters ?? {},
      );
      const submissionParameters = submissionParameterValues(
        model.parameterSchema,
        normalizedParameters,
      );
      const preflight = resolveNodeInputs({
        edges: snapshot.edges,
        mediaInputPolicy: model.mediaInputPolicy,
        modelReleaseRevision: model.releaseRevisionId,
        modelSchema: model.parameterSchema,
        nodes: snapshot.nodes,
        ownPrompt: graphPrompt,
        parameters: submissionParameters,
        targetId: id,
        targetKind: "video",
      });
      if (!preflight.canSubmit || !preflight.finalPrompt ||
        !preflight.contractFingerprint) {
        throw new Error(
          preflight.problems[0]?.message ?? "输入合同无法无损保存，未提交生成",
        );
      }
      const inputKey = createGenerationInputKey({
        inputs: preflight.inputs,
        modelConfigurationRevision: model.configurationRevision,
        modelId: model.id,
        modelReleaseRevision: model.releaseRevisionId,
        ownPrompt: graphPrompt,
        parameters: submissionParameters,
        prompt: preflight.finalPrompt,
      });
      const ownershipKey = generationOwnershipKey({
        contractFingerprint: preflight.contractFingerprint,
        modelConfigurationRevision: model.configurationRevision,
        modelId: model.id,
        modelReleaseRevision: model.releaseRevisionId,
        parameters: normalizedParameters,
        prompt: graphPrompt,
        upstream: preflight.inputs.map((connected) => ({
          assetId: connected.kind === "text" ? undefined : connected.assetId,
          edgeId: connected.edgeId,
          metadataStatus: connected.metadataStatus,
          order: connected.order,
          ready: connected.state === "ready",
          role: connected.role,
          source: connected.sourceNodeId,
          sourceKind: connected.kind,
          src: connected.kind === "text" ? undefined : connected.preview,
          status: connected.state,
          text: connected.kind === "text" ? connected.text : undefined,
        })),
      });
      return {
        contractFingerprint: preflight.contractFingerprint,
        inputKey,
        inputs: preflight.inputs,
        model,
        normalizedParameters,
        ownershipKey,
        payload: {
          canvasId,
          canvasRevision: snapshot.revision ?? canvasRevision,
          inputSchemaVersion: 1 as const,
          inputs: preflight.snapshot,
          model: model.id,
          nodeId: id,
          ownPrompt: graphPrompt,
          parameters: submissionParameters,
          prompt: preflight.finalPrompt,
        },
        prompt: graphPrompt,
      };
    };
    const adapterForSubmission = (
      compiled: ReturnType<typeof compileCurrentSubmission>,
    ) => createVideoGenerationAdapter({
      contractFingerprint: compiled.contractFingerprint,
      inputKey: compiled.inputKey,
      modelId: compiled.model.id,
      modelName: compiled.model.displayName,
      modelConfigurationRevision: compiled.model.configurationRevision,
      modelReleaseRevision: compiled.model.releaseRevisionId,
      nodeId: id,
      ownershipKey: compiled.ownershipKey,
      parameters: compiled.normalizedParameters,
      payload: compiled.payload,
      prompt: compiled.prompt,
      readBlock() {
        try {
          const currentModel = liveVideoModelsRef.current?.find(
            (model) => model.id === compiled.model.id,
          );
          if (
            !currentModel ||
            !currentModel.configurationRevision ||
            !currentModel.parameterSchema ||
            !currentModel.releaseRevisionId ||
            currentModel.configurationRevision !==
              compiled.model.configurationRevision ||
            currentModel.releaseRevisionId !== compiled.model.releaseRevisionId
          ) throw new Error("模型合同已更新");
          const current = compileCurrentSubmission({
            ...currentModel,
            configurationRevision: currentModel.configurationRevision,
            parameterSchema: currentModel.parameterSchema,
            releaseRevisionId: currentModel.releaseRevisionId,
          });
          if (
            current.inputKey !== compiled.inputKey ||
            current.ownershipKey !== compiled.ownershipKey ||
            current.contractFingerprint !== compiled.contractFingerprint
          ) throw new Error("生成输入已修改");
          return undefined;
        } catch (error) {
          return {
            message: error instanceof Error
              ? error.message
              : "生成输入已修改，已停止本次生成",
            status: "blocked" as const,
          };
        }
      },
    });
    try {
      if (!graphCommandPort) {
        setVideoSubmissionError("画布事务尚未就绪，暂未创建视频生成任务");
        return { status: "skipped" };
      }
      setSavingCanvas(true);
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createVideoGenerationAdapter({
          contractFingerprint: inputPreflight.contractFingerprint ?? "",
          inputKey: videoGenerationInputKey,
          modelId: requestedModelId,
          modelName: requestedModelName,
          modelConfigurationRevision:
            selectedVideoModel?.configurationRevision ?? "",
          modelReleaseRevision: selectedVideoModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: effectiveGenerationInputFingerprint,
          parameters: requestedParameters,
          payload: videoGenerationRequestInput,
          prompt: requestedPrompt,
          readBlock() {
            try {
              assertSubmissionInputsUnedited();
            } catch (error) {
              return { message: (error as Error).message, status: "blocked" };
            }
            if (
              liveEffectiveGenerationOwnershipKeyRef.current !==
                effectiveGenerationInputFingerprint
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
        onBindingCommitted() {
          setSavingCanvas(false);
          setSubmitting(false);
        },
        prepareSubmissionAdapter: async () => {
          assertSubmissionInputsUnedited();
          const currentModel = liveVideoModelsRef.current?.find(
            (model) => model.id === requestedModelId,
          );
          if (
            !currentModel?.parameterSchema ||
            !currentModel.configurationRevision ||
            !currentModel.releaseRevisionId ||
            currentModel.generationAvailable === false ||
            currentModel.configurationRevision !==
              selectedVideoModel.configurationRevision ||
            currentModel.releaseRevisionId !==
              selectedVideoModel.releaseRevisionId
          ) throw new Error("模型合同已更新，请按当前画布重新生成");
          const currentTransitionSnapshot = graphCommandPort.snapshot();
          if (submissionInputFingerprint(currentTransitionSnapshot) !==
            transitionInputFingerprint) {
            throw new Error("生成输入已修改，已停止本次生成");
          }
          // Admission can finish an unrelated Canvas save. Keep the exact
          // input fence, then let the transition port guard the current revision.
          const transition = await applyModelTransition({
            expectedBefore: canvasModelTransitionExpectedBefore(currentTransitionSnapshot, id),
            intent: "execute",
            model: {
              configurationRevision: currentModel.configurationRevision,
              displayName: currentModel.displayName,
              id: currentModel.id,
              parameterSchema: currentModel.parameterSchema,
              releaseRevisionId: currentModel.releaseRevisionId,
            },
            nodeId: id,
            requestedParameters,
          });
          if (transition.status !== "applied") {
            const message = transition.problems?.[0] ?? transition.message ??
              "输入合同无法无损保存，未提交生成";
            setModelSwitchProblem(message);
            throw new Error(message);
          }
          const submissionModel = {
            ...currentModel,
            configurationRevision: currentModel.configurationRevision,
            parameterSchema: currentModel.parameterSchema,
            releaseRevisionId: currentModel.releaseRevisionId,
          };
          const beforeMetadata = compileCurrentSubmission(submissionModel);
          const sources = graphCommandPort.snapshot().nodes;
          const missingMetadata = beforeMetadata.inputs.filter((source) =>
            source.kind !== "text" && source.assetId &&
            !hasCompleteTrustedMediaMetadata(source.kind,
              sources.find((node) => node.id === source.sourceNodeId)?.data ?? {}));
          if (missingMetadata.length) {
            // Upstream nodes can be outside the rendered viewport. Admission
            // must fetch their real metadata instead of relying on a mount effect.
            const metadata = await Promise.all(missingMetadata.map(async (source) => ({
              source,
              metadata: await fetchTrustedMediaMetadata(
                source.kind as "image" | "video" | "audio",
                source.assetId!,
                AbortSignal.timeout(15_000),
              ),
            })));
            const current = compileCurrentSubmission(submissionModel);
            if (current.inputKey !== beforeMetadata.inputKey ||
              current.contractFingerprint !== beforeMetadata.contractFingerprint ||
              JSON.stringify(current.inputs.map((source) => source.preview)) !==
                JSON.stringify(beforeMetadata.inputs.map((source) => source.preview))) {
              throw new Error("生成输入已修改，已停止本次生成");
            }
            for (const item of metadata) {
              if (item.metadata.assetId !== item.source.assetId ||
                item.metadata.kind !== item.source.kind ||
                !adoptAuthoritativeNodeData({
                  expectedAssetId: item.source.assetId,
                  nodeId: item.source.sourceNodeId,
                  patch: trustedMediaPatch(item.metadata),
                })) throw new Error("素材信息已变化，未提交视频生成");
            }
          }
          const compiled = compileCurrentSubmission(submissionModel);
          admittedGenerationInputKey = compiled.inputKey;
          admittedGenerationOwnershipKey = compiled.ownershipKey;
          admittedContractFingerprint = compiled.contractFingerprint;
          return adapterForSubmission(compiled);
        },
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
          fixtureScopeId,
          replacesTaskId: newGenerationAvailable
            ? newGenerationTaskId
            : undefined,
          onPollingPaused(taskId) {
            pollingPausedTaskIdRef.current = taskId;
            setPollingPausedTaskId(taskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            setNewGenerationTaskId(undefined);
            setNewGenerationAllowed(false);
            setNewGenerationBlockReason("");
            pollingRun = beginGenerationPollingRun(
              task.id,
              admittedGenerationInputKey,
              admittedGenerationOwnershipKey,
            );
          },
        }),
      });
      const result = await lifecycle.generate();
      setSavingCanvas(false);
      if (!result.task) {
        const message = result.message ??
          "生成任务未创建，当前节点未开始生成";
        setVideoSubmissionError(message);
        return { message, status: "failed" };
      }
      if (result.status === "stale") {
        const message = result.message ??
          "生成结果已过期，当前节点未被覆盖";
        setUploadError(message);
        return { message, status: "failed" };
      }
      clearGenerationSubmissionIntent(
        "video",
        canvasId,
        id,
        result.task.id,
        accountId,
        fixtureScopeId,
      );
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status !== "success") {
        const message = friendlyGenerationMessage(
          result.task.errorMessage,
          "video",
        );
        setUploadError(
          generationFailureMessage(
            message,
            result.task.retryAllowed
              ? undefined
              : result.task.retryBlockReason,
            result.task.errorCode,
            "video",
          ),
          result.task.errorCode,
        );
        setRetryTaskId(
          safelyRetryableGenerationTask(result.task)
            ? result.task.id
            : undefined,
        );
        setNewGenerationTaskId(result.task.id);
        setNewGenerationAllowed(result.task.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          result.task.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
        return { message, status: "failed" };
      }
      setRetryTaskId(undefined);
      setNewGenerationTaskId(undefined);
      setNewGenerationAllowed(false);
      setNewGenerationBlockReason("");
      setVideoSubmissionError("");
      return {
        status: "success",
        successProof: {
          ownershipKey: admittedGenerationOwnershipKey,
          resultKey: groupRunResultKey(result.task.resultUrl),
          taskId: result.task.id,
        },
      };
    } catch (error) {
      if (error instanceof GenerationRequestError && error.problems.length) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : generationMessageFallback("video");
      const friendly = friendlyGenerationMessage(message, "video");
      if (!pollingRun) {
        setVideoSubmissionError(
          friendly,
          error instanceof GenerationRequestError ? error.code : undefined,
        );
        if (
          error instanceof GenerationRequestError &&
          admittedContractFingerprint
        ) {
          applyViewUpdate((nodes) => nodes.map((node) => node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  videoGenerationError: friendly,
                  videoGenerationErrorCode: error.code,
                },
              }
            : node));
        }
      }
      return { message: friendly, status: "failed" };
    } finally {
      normalSubmissionInFlightRef.current = false;
      setSavingCanvas(false);
      setSubmitting(false);
      if (pollingRun) endGenerationPollingRun(pollingRun);
    }
  };

  const retryVideoGeneration = async () => {
    if (
      !retryTaskId ||
      !retryAvailable ||
      isFixture ||
      !retryGenerationEnabled ||
      generating ||
      submitting
    ) return;
    videoDataMutationVersionRef.current += 1;
    videoRecoveryControllerRef.current?.abort("video-recovery-superseded");
    const taskId = retryTaskId;
    const requestedPrompt = promptControl.readCommittedValue();
    const requestedPromptSemanticVersion = promptSemanticVersionRef.current;
    const semanticEditScope = {
      accountId,
      canvasId,
      fixtureScopeId,
      kind: "video" as const,
      nodeId: id,
    };
    const requestedSemanticEditVersion =
      readSingleNodeSemanticEditVersion(semanticEditScope);
    const requestedCanvasMutationVersion = readCanvasMutationVersion(id);
    const requestedGenerationInputKey = videoGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setNewGenerationTaskId(undefined);
    setNewGenerationAllowed(false);
    setNewGenerationBlockReason("");
    setRetrying(true);
    setSubmitting(true);
    let retryAccepted = false;
    let pollingRun: VideoPollingRun | undefined;
    try {
      if (!graphCommandPort) return;
      setSavingCanvas(true);
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createVideoGenerationAdapter({
          contractFingerprint: data.videoGenerationModelInputContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: requestedGenerationInputKey,
          modelId: data.videoModelId,
          modelName: data.videoModel,
          modelConfigurationRevision:
            data.videoGenerationModelConfigurationRevision ??
            selectedVideoModel?.configurationRevision ?? "",
          modelReleaseRevision: data.videoGenerationModelReleaseRevision ??
            selectedVideoModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: requestedGenerationOwnershipKey,
          parameters: data.videoParameters,
          payload: videoGenerationRequestInput,
          prompt: data.videoPrompt ?? promptControl.committedValue.trim(),
          readBlock() {
            if (
              readSingleNodeSemanticEditVersion(semanticEditScope) !==
                requestedSemanticEditVersion ||
              readCanvasMutationVersion(id) !== requestedCanvasMutationVersion ||
              promptControl.readCommittedValue() !== requestedPrompt ||
              promptSemanticVersionRef.current !==
                requestedPromptSemanticVersion ||
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
            return { revision: await waitForCanvasRevision() };
          },
        },
        tasks: createBrowserSingleNodeGenerationTaskPort({
          accountId,
          fixtureScopeId,
          onPollingPaused(pausedTaskId) {
            if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            if (task.id !== taskId) return;
            retryAccepted = true;
            pollingRun = beginGenerationPollingRun(
              task.id,
              requestedGenerationInputKey,
              requestedGenerationOwnershipKey,
            );
          },
        }),
      });
      videoRetryLifecycleRef.current = lifecycle;
      const result = await lifecycle.retry({ id: taskId });
      if (
        !result.task ||
        result.status === "stale" ||
        !pollingRun ||
        !ownsGenerationPollingRun(pollingRun)
      ) {
        if (result.task && pollingRun && ownsGenerationPollingRun(pollingRun)) {
          setUploadError(result.message ?? "生成结果已过期，当前节点未被覆盖");
        } else if (!result.task) {
          setUploadError(result.message ?? "重试任务未返回结果，当前节点未被更新");
        }
        return;
      }
      clearGenerationSubmissionIntent("video", canvasId, id, taskId, accountId, fixtureScopeId);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        setUploadError("");
        setRetryTaskId(undefined);
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
        return;
      }
      const message = generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled"
            ? "视频生成已取消"
            : "视频生成失败，请稍后再试"
        ),
        result.task.retryAllowed
          ? undefined
          : result.task.retryBlockReason,
        result.task.errorCode,
        "video",
      );
      setUploadError(message, result.task.errorCode);
      setRetryTaskId(
        safelyRetryableGenerationTask(result.task)
          ? result.task.id
          : undefined,
      );
      if (result.status === "cancelled") {
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
      } else {
        setNewGenerationTaskId(result.task.id);
        setNewGenerationAllowed(result.task.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          result.task.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
      }
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
        await persistVideoGenerationFailure(
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
      videoRetryLifecycleRef.current = undefined;
      setSavingCanvas(false);
      if (pollingRun) endGenerationPollingRun(pollingRun);
      setSubmitting(false);
      setRetrying(false);
    }
  };

  const resumeVideoPolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    videoRecoveryControllerRef.current?.abort("video-recovery-superseded");
    const controller = new AbortController();
    videoRecoveryControllerRef.current = controller;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setUploadError("");
    const pollingRun = beginGenerationPollingRun(
      taskId,
      data.videoGenerationInputKey,
      data.videoGenerationOwnershipKey ?? rawGenerationInputFingerprint,
    );
    try {
      await flushCanvasSave(controller.signal);
      if (controller.signal.aborted || !ownsGenerationPollingRun(pollingRun)) {
        return;
      }
      const task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!ownsGenerationPollingRun(pollingRun)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError(POLLING_PAUSED_MESSAGE);
      }, controller.signal, fixtureScopeId, { followReplacementTask: true });
      if (controller.signal.aborted || !ownsGenerationPollingRun(pollingRun)) {
        return;
      }
      if (task.id !== pollingRun.taskId) {
        pollingRun.taskId = task.id;
        setActiveTaskId(task.id);
      }
      if (task.state === "cancelled") {
        const applied = await persistVideoGenerationCancellation(
          task.id,
          task.errorMessage ?? "视频生成已取消",
        );
        if (!applied) {
          pollingPausedTaskIdRef.current = taskId;
          setPollingPausedTaskId(taskId);
          setUploadError("画布修改正在安全保存，任务结果将在稍后继续写回");
        }
        return;
      }
      if (task.state !== "success") {
        setNewGenerationTaskId(task.id);
        setNewGenerationAllowed(task.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          task.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
        const applied = await persistVideoGenerationFailure(
          task.id,
          friendlyGenerationMessage(task.errorMessage, "video", task.errorCode),
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        if (!applied) {
          pollingPausedTaskIdRef.current = taskId;
          setPollingPausedTaskId(taskId);
          setUploadError("画布修改正在安全保存，任务结果将在稍后继续写回");
        }
        return;
      }
      const applied = await applyGeneratedVideo(
        task,
        promptControl.committedValue.trim(),
        pollingRun,
        controller.signal,
      );
      if (!applied) {
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setUploadError("画布修改正在安全保存，任务结果将在稍后继续写回");
        return;
      }
      setRetryTaskId(undefined);
    } catch (error) {
      if (controller.signal.aborted) return;
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
      if (videoRecoveryControllerRef.current === controller) {
        videoRecoveryControllerRef.current = undefined;
      }
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
    const requestedGenerationInputKey = videoGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setReconcileBusy(true);
    let reconcileSaveGatePassed = false;
    let pollingRun: VideoPollingRun | undefined;
    try {
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createVideoGenerationAdapter({
          contractFingerprint: data.videoGenerationModelInputContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: data.videoGenerationInputKey || videoGenerationInputKey,
          modelId: data.videoModelId,
          modelName: data.videoModel,
          modelConfigurationRevision:
            data.videoGenerationModelConfigurationRevision ??
            selectedVideoModel?.configurationRevision ?? "",
          modelReleaseRevision: data.videoGenerationModelReleaseRevision ??
            selectedVideoModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: data.videoGenerationOwnershipKey ??
            requestedGenerationOwnershipKey,
          parameters: data.videoParameters,
          payload: videoGenerationRequestInput,
          prompt: data.videoPrompt ?? promptControl.committedValue.trim(),
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
          fixtureScopeId,
          onPollingPaused(pausedTaskId) {
            if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            if (task.id !== taskId) return;
            pollingRun = beginGenerationPollingRun(
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
        "video",
        canvasId,
        id,
        result.task.id,
        accountId,
        fixtureScopeId,
      );
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        setUploadError("");
        setRetryTaskId(undefined);
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
        return;
      }
      const failureMessage = generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled"
            ? "视频生成已取消"
            : "视频生成失败，请稍后再试"
        ),
        result.task.retryAllowed
          ? undefined
          : result.task.retryBlockReason,
        result.task.errorCode,
        "video",
      );
      setUploadError(failureMessage, result.task.errorCode);
      setRetryTaskId(
        safelyRetryableGenerationTask(result.task)
          ? result.task.id
          : undefined,
      );
      if (result.status === "cancelled") {
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
      } else {
        setNewGenerationTaskId(result.task.id);
        setNewGenerationAllowed(result.task.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          result.task.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
      }
    } catch (error) {
      if (
        pollingRun &&
        pollingPausedTaskIdRef.current === taskId &&
        ownsGenerationPollingRun(pollingRun)
      ) return;
      setUploadError(
        error instanceof Error ? error.message : "核对结果失败，请稍后再试",
        error instanceof GenerationRequestError ? error.code : undefined,
      );
    } finally {
      if (pollingRun) endGenerationPollingRun(pollingRun);
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
      if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createVideoGenerationAdapter({
          contractFingerprint: data.videoGenerationModelInputContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: pollingRun.inputKey ??
            data.videoGenerationInputKey ??
            videoGenerationInputKey,
          modelId: data.videoModelId,
          modelName: data.videoModel,
          modelConfigurationRevision:
            data.videoGenerationModelConfigurationRevision ??
            selectedVideoModel?.configurationRevision ?? "",
          modelReleaseRevision: data.videoGenerationModelReleaseRevision ??
            selectedVideoModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: pollingRun.ownershipKey ??
            data.videoGenerationOwnershipKey ??
            rawGenerationInputFingerprint,
          parameters: data.videoParameters,
          payload: videoGenerationRequestInput,
          prompt: data.videoPrompt ?? promptControl.committedValue.trim(),
          readBlock() {
            if (!ownsGenerationPollingRun(pollingRun)) {
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
        tasks: createBrowserSingleNodeGenerationTaskPort({
          accountId,
          fixtureScopeId,
        }),
      });
      const result = await lifecycle.cancel({ id: taskId });
      if (result.status !== "cancelled" || !result.task) return;
      if (!ownsGenerationPollingRun(pollingRun)) return;
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      setUploadError(result.task.errorMessage ?? "视频生成已取消");
      setRetryTaskId(undefined);
      clearGenerationSubmissionIntent(
        "video",
        canvasId,
        id,
        result.task.id,
        accountId,
        fixtureScopeId,
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
    if (
      !persistenceReady ||
      isFixture ||
      submitting ||
      normalSubmissionInFlightRef.current ||
      pollingPausedTaskIdRef.current ||
      generationPollingRunRef.current ||
      workflowBlocksSingleNodeRecovery({
        locked: lockedNodeIds.has(id),
        workflowExecutionRunId: data.workflowExecutionRunId,
      })
    ) return;
    const persistedTaskId = data.videoGenerationTaskId;
    const persistedInputKey = data.videoGenerationInputKey;
    const persistedOwnershipKey = data.videoGenerationOwnershipKey;
    const catalogReady = videoModelSelection.status === "ready" &&
      Boolean(selectedVideoModel);
    const canInspectTerminalFailure = Boolean(
      persistedTaskId &&
      data.videoGenerationError &&
      !data.videoGenerating,
    );
    const controller = new AbortController();
    videoRecoveryControllerRef.current = controller;
    const recoveryMutationVersion = videoDataMutationVersionRef.current;
    const recoveryReadStillCurrent = () => !controller.signal.aborted &&
      videoRecoveryControllerRef.current === controller &&
      videoDataMutationVersionRef.current === recoveryMutationVersion &&
      !generationPollingRunRef.current;
    let pollingRun: VideoPollingRun | undefined;
    let lifecycle: ReturnType<typeof createSingleNodeGenerationLifecycle> |
      undefined;
    let persistedTaskReadPending = false;
    void (async () => {
      let task: GenerationTaskSummary | undefined;
      let recoveredIntent = false;
      if (persistedTaskId) {
        if (
          persistedOwnershipKey &&
          persistedOwnershipKey !== rawGenerationInputFingerprint &&
          !canInspectTerminalFailure
        ) {
          clearGenerationSubmissionIntent(
            "video",
            canvasId,
            id,
            persistedTaskId,
            accountId,
            fixtureScopeId,
          );
          commitVideoDataMutation(
            (current) => current.videoGenerationTaskId === persistedTaskId
              ? clearVideoGenerationForSemanticChange(current)
              : current,
            (identity) => {
              setUnverifiedRecoveryTaskId((current) =>
                current === persistedTaskId ? undefined : current
              );
              finishVideoGenerationInputRevocation(identity, videoMutationScopeKey);
            },
          );
          return;
        }
        if (!persistedOwnershipKey) {
          if (!catalogReady && !canInspectTerminalFailure) return;
          if (
            persistedInputKey &&
            persistedInputKey !== videoGenerationInputKey &&
            !canInspectTerminalFailure
          ) {
            commitVideoDataMutation(
              (current) => current.videoGenerationTaskId === persistedTaskId
                ? clearVideoGenerationForSemanticChange(current)
                : current,
              (identity) => {
                setUnverifiedRecoveryTaskId((current) =>
                  current === persistedTaskId ? undefined : current
                );
                finishVideoGenerationInputRevocation(identity, videoMutationScopeKey);
              },
            );
            return;
          }
        }
        persistedTaskReadPending = true;
        task = await getGenerationTask(
          persistedTaskId,
          controller.signal,
          fixtureScopeId,
          {
            followReplacementTask: true,
            retryTransientStatusReads: true,
          },
        );
        persistedTaskReadPending = false;
      } else return;
      if (!recoveryReadStillCurrent() || !task) return;
      if (
        canInspectTerminalFailure &&
        task.state === "failed" &&
        ((persistedOwnershipKey &&
          persistedOwnershipKey !== rawGenerationInputFingerprint) ||
          (!persistedOwnershipKey && persistedInputKey &&
            persistedInputKey !== videoGenerationInputKey))
      ) {
        setNewGenerationTaskId(task.id);
        setNewGenerationAllowed(task.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          task.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
        setRetryTaskId(undefined);
        setUploadError(generationFailureMessage(
          task.errorMessage ?? data.videoGenerationError ??
            "视频生成失败，请稍后再试",
          undefined,
          task.errorCode ?? data.videoGenerationErrorCode,
          "video",
        ));
        return;
      }
      if (persistedOwnershipKey && (
        boundParameterProofRef.current.state === "changed" ||
        boundSourceProofRef.current === "changed" ||
        (boundParameterProofRef.current.state === "unknown" &&
          (task.generationIdentityVersion !== 2 || !graphCommandPort?.refreshAuthoritativeDocument)) ||
        (boundParameterProofRef.current.state === "valid" &&
          persistedInputKey !== liveGenerationInputKeyRef.current)
      )) return;
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
          fixtureScopeId,
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
            fixtureScopeId,
          );
          return;
        }
      }
      if (!videoTaskMatchesNode(
        task,
        canvasId,
        id,
        task.id,
        fixtureScopeId,
      )) {
        if (persistedTaskId) {
          commitVideoDataMutation(
            (current) => current.videoGenerationTaskId === persistedTaskId
              ? clearVideoGenerationForSemanticChange(current)
              : current,
            (identity) => {
              setUnverifiedRecoveryTaskId((current) =>
                current === persistedTaskId ? undefined : current
              );
              finishVideoGenerationInputRevocation(identity, videoMutationScopeKey);
            },
          );
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
      if (!graphCommandPort) return;
      const retainPersistedBlock = task.id === persistedTaskId &&
        task.state === "failed" &&
        !recoveredIntent && data.videoGenerationRetryAllowed === false;
      const recoveredTask = retainPersistedBlock
        ? {
            ...task,
            errorCode: data.videoGenerationErrorCode,
            errorMessage: data.videoGenerationError ??
              task.errorMessage ??
              "视频生成失败，请稍后再试",
            retryAllowed: false,
            retryBlockCode: data.videoGenerationRetryBlockCode,
            retryBlockReason: data.videoGenerationRetryBlockReason,
          }
        : task;
      if (recoveredTask.state === "failed") {
        const retryAllowed = safelyRetryableGenerationTask(recoveredTask);
        setUploadError(generationFailureMessage(
          recoveredTask.errorMessage ?? "视频生成失败，请稍后再试",
          retryAllowed ? undefined : recoveredTask.retryBlockReason,
          recoveredTask.errorCode,
          "video",
        ), recoveredTask.errorCode);
        setRetryTaskId(retryAllowed ? recoveredTask.id : undefined);
        setNewGenerationTaskId(recoveredTask.id);
        setNewGenerationAllowed(recoveredTask.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          recoveredTask.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
      } else {
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
      }
      lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createVideoGenerationAdapter({
          bindingOwnershipKey: recoveredOwnershipKey,
          contractFingerprint: task.modelInputContractFingerprint ??
            data.videoGenerationModelInputContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: persistedInputKey ??
            task.generationInputKey ??
            videoGenerationInputKey,
          modelId: data.videoModelId,
          modelName: data.videoModel,
          modelConfigurationRevision: task.modelConfigurationRevision ??
            data.videoGenerationModelConfigurationRevision ??
            selectedVideoModel?.configurationRevision ?? "",
          modelReleaseRevision: task.modelReleaseRevision ??
            data.videoGenerationModelReleaseRevision ??
            selectedVideoModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: recoveredOwnershipKey ??
            rawGenerationInputFingerprint,
          parameters: data.videoParameters,
          payload: videoGenerationRequestInput,
          preserveBindingOwnership: true,
          prompt: promptControl.committedValue.trim(),
          readBlock() {
            if (!pollingRun || !ownsGenerationPollingRun(pollingRun) ||
              (persistedOwnershipKey && (
               boundParameterProofRef.current.state === "changed" ||
                boundSourceProofRef.current === "changed" ||
                (boundParameterProofRef.current.state === "unknown" &&
                  (task!.generationIdentityVersion !== 2 || !graphCommandPort?.refreshAuthoritativeDocument)) ||
                (boundParameterProofRef.current.state === "valid" &&
                  persistedInputKey !== liveGenerationInputKeyRef.current)
              ))) {
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
          fixtureScopeId,
          onPollingPaused(pausedTaskId) {
            if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setUploadError(POLLING_PAUSED_MESSAGE);
          },
        }),
      });
      videoRecoveryLifecycleRef.current = lifecycle;
      controller.signal.addEventListener(
        "abort",
        () => lifecycle?.abort("video-recovery-aborted"),
        { once: true },
      );
      let result: SingleNodeLifecycleResult;
      try {
        result = await lifecycle.recover(recoveredTask);
      } catch (error) {
        if (
          pollingPausedTaskIdRef.current === task.id &&
          pollingRun &&
          ownsGenerationPollingRun(pollingRun)
        ) return;
        throw error;
      }
      if (
        controller.signal.aborted ||
        !pollingRun ||
        !ownsGenerationPollingRun(pollingRun) ||
        !result.task ||
        result.status === "stale"
      ) {
        if (
          !controller.signal.aborted &&
          pollingRun &&
          ownsGenerationPollingRun(pollingRun)
        ) {
          setUploadError(result.message ?? (
            result.status === "stale"
              ? "生成结果已过期，当前节点未被覆盖"
              : "恢复任务未返回结果，当前节点未被更新"
          ));
        }
        return;
      }
      clearGenerationSubmissionIntent(
        "video",
        canvasId,
        id,
        result.task.id,
        accountId,
        fixtureScopeId,
      );
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
        setUploadError("");
        setRetryTaskId(undefined);
        const recoveredTaskId = result.task.id;
        const recoveredOwnershipKey = pollingRun.ownershipKey;
        applyViewUpdate((nodes) => nodes.map((node) =>
          node.id !== id ||
          (node.data.videoGenerationTaskId !== undefined &&
            node.data.videoGenerationTaskId !== recoveredTaskId &&
            node.data.videoGenerationTaskId !== persistedTaskId) ||
          (node.data.videoGenerationOwnershipKey !== undefined &&
            recoveredOwnershipKey !== undefined &&
            node.data.videoGenerationOwnershipKey !== recoveredOwnershipKey)
            ? node
            : {
                ...node,
                data: {
                  ...node.data,
                  videoGenerationError: undefined,
                  videoGenerationErrorCode: undefined,
                  videoGenerationRetryAllowed: undefined,
                  videoGenerationRetryBlockCode: undefined,
                  videoGenerationRetryBlockReason: undefined,
                  videoGenerating: false,
                },
              },
        ));
      } else if (result.status === "cancelled") {
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
        setUploadError(result.task.errorMessage ?? "视频生成已取消");
        setRetryTaskId(undefined);
      } else {
        const retryAllowed = safelyRetryableGenerationTask(result.task);
        setUploadError(generationFailureMessage(
          result.task.errorMessage ?? "视频生成失败，请稍后再试",
          retryAllowed ? undefined : result.task.retryBlockReason,
          result.task.errorCode,
          "video",
        ), result.task.errorCode);
        setRetryTaskId(retryAllowed ? result.task.id : undefined);
        setNewGenerationTaskId(result.task.id);
        setNewGenerationAllowed(result.task.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          result.task.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
      }
      if (result.task.id !== persistedTaskId) {
        clearGenerationSubmissionIntent(
          "video",
          canvasId,
          id,
          persistedTaskId,
          accountId,
          fixtureScopeId,
        );
      }
    })()
      .catch((error) => {
        if (controller.signal.aborted ||
          (pollingRun ? !ownsGenerationPollingRun(pollingRun) : !recoveryReadStillCurrent())) return;
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
        if (videoRecoveryControllerRef.current === controller) {
          videoRecoveryControllerRef.current = undefined;
        }
        if (videoRecoveryLifecycleRef.current === lifecycle) {
          videoRecoveryLifecycleRef.current = undefined;
        }
        if (pollingRun) endGenerationPollingRun(pollingRun);
      });
    return () => {
      controller.abort();
      if (videoRecoveryControllerRef.current === controller) {
        videoRecoveryControllerRef.current = undefined;
      }
      lifecycle?.abort("video-recovery-unmounted");
      if (videoRecoveryLifecycleRef.current === lifecycle) {
        videoRecoveryLifecycleRef.current = undefined;
      }
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
    data.workflowExecutionRunId,
    graphCommandPort,
    id,
    applyViewUpdate,
    persistenceReady,
    submitting,
    recoveryEpoch,
    retryWakeEpoch,
    boundParameterProof.state,
    boundSourceProof,
    rawGenerationInputFingerprint,
    legacyRecoveryCatalogKey,
    lockedNodeIds,
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
    if (
      !file ||
      semanticEditBlocked ||
      canvasMutationPending ||
      uploadInFlight.current
    ) return;

    const baseline = uploadBaseline.current ?? readCanvasNode(id);
    const operation = uploadOperation.current + 1;
    const scope = mediaAdoptionScopeRef.current;
    uploadOperation.current = operation;
    uploadAdmissionPending.current = true;
    uploadInFlight.current = true;
    let admittedBaseline = baseline;
    const releaseUploadCheckpoint = checkpoint();
    const prepared = applyViewUpdate((nodes) =>
      nodes.map((node) => {
        if (node.id !== id) return node;
        admittedBaseline = uploadBaseline.current ?? node;
        return {
          ...node,
          data: {
            ...node.data,
            ...mediaUploadState("uploading", "视频正在上传并由服务端检查"),
          },
        };
      }),
    );
    if (operation === uploadOperation.current) {
      uploadAdmissionPending.current = false;
    }
    if (!prepared) {
      releaseUploadCheckpoint();
      if (operation === uploadOperation.current) {
        uploadAdmissionPending.current = false;
        uploadInFlight.current = false;
        uploadBaseline.current = undefined;
      }
      return;
    }
    if (admittedBaseline && !uploadBaseline.current) {
      uploadBaseline.current = admittedBaseline;
    }
    uploadController.current?.abort();
    const controller = new AbortController();
    uploadController.current = controller;
    setUploadError("");
    setTransientUploadError("");
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
        !canvasUploadTargetStillCurrent(admittedBaseline, readCanvasNode(id)) ||
        !persistenceReadyLive.current ||
        controller.signal.aborted ||
        effectiveMediaInputState(readCanvasNode(id)?.data ?? {}) !== "uploading"
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
        !canvasUploadTargetStillCurrent(admittedBaseline, readCanvasNode(id)) ||
        !persistenceReadyLive.current ||
        controller.signal.aborted ||
        effectiveMediaInputState(readCanvasNode(id)?.data ?? {}) !== "uploading"
      ) {
        await discardUnadoptedVideoAsset(requestedAssetId);
        requestedAssetId = undefined;
        return;
      }

      setCurrentTime(0);
      setPlaying(false);
      // Keep the upload-only undo checkpoint until the remote response is
      // fully validated, then retire it before the authoritative adoption is
      // allowed to render.
      releaseUploadCheckpoint();
      uploadAdmissionPending.current = true;
      try {
        adopted = await adoptUploadedAsset({
          asset: {
            assetId: asset.assetId,
            byteSize: asset.byteSize,
            contentType: asset.contentType,
            durationSeconds: asset.durationSeconds,
            height: trustedMetadata.mediaHeight,
            src: asset.url,
            storageBackend: asset.storageBackend,
            width: trustedMetadata.mediaWidth,
          },
          mediaKind: "video",
          rollbackTarget: admittedBaseline,
          targetNodeId: id,
          update: (nodes) => nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                height: undefined,
                measured: undefined,
                width: undefined,
                ...(adoptedMediaStyle(node, { ...node.data, ...trustedMediaPatch(trustedMetadata) })
                  ? { style: adoptedMediaStyle(node, { ...node.data, ...trustedMediaPatch(trustedMetadata) }) } : {}),
                data: {
                  ...node.data,
                  ...trustedMediaPatch(trustedMetadata),
                  assetId: asset.assetId,
                  videoAudioEnabled: true,
                  videoDuration: asset.durationSeconds,
                  videoFileSize: asset.byteSize,
                  videoGenerationContractFingerprint: undefined,
                  videoGenerationError: undefined,
                  videoGenerationErrorCode: undefined,
                  videoGenerationInputKey: undefined,
                  videoGenerationModelConfigurationRevision: undefined,
                  videoGenerationModelInputContractFingerprint: undefined,
                  videoGenerationModelReleaseRevision: undefined,
                  videoGenerationOwnershipKey: undefined,
                  videoGenerationRetryAllowed: undefined,
                  videoGenerationRetryBlockCode: undefined,
                  videoGenerationRetryBlockReason: undefined,
                  videoGenerationTaskId: undefined,
                  videoGenerating: undefined,
                  videoInputContractFingerprint: undefined,
                  videoHeight: trustedMetadata.mediaHeight,
                  videoModel: "本地上传",
                  videoPrompt: "",
                  videoSrc: asset.url,
                  videoWidth: trustedMetadata.mediaWidth,
                  groupRunSuccessInputFingerprint: undefined,
                  groupRunSuccessModelConfigurationRevision: undefined,
                  groupRunSuccessModelReleaseRevision: undefined,
                  groupRunSuccessOwnershipKey: undefined,
                  groupRunSuccessResultKey: undefined,
                  groupRunSuccessTaskId: undefined,
                  workflowExecutionRunId: undefined,
                },
              }
            : node,
          ),
        });
      } finally {
        if (operation === uploadOperation.current) {
          uploadAdmissionPending.current = false;
        }
      }
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
        applyViewUpdate((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                inputViewState: baseline.data.inputViewState,
                inputViewStateReason: baseline.data.inputViewStateReason,
              },
            }
          : node));
        setTransientUploadError(message);
      } else {
        setUploadError(message, "INPUT_INVALID");
        setUploadFailureMessage(message);
        applyViewUpdate((nodes) => nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, ...mediaUploadState("invalid", message) } }
          : node));
      }
    } finally {
      URL.revokeObjectURL(localUrl);
      releaseUploadCheckpoint();
      if (operation === uploadOperation.current) {
        uploadAdmissionPending.current = false;
        uploadController.current = undefined;
        uploadInFlight.current = false;
        uploadBaseline.current = undefined;
      }
    }
  };

  const captureMetadata = (video: HTMLVideoElement) => {
    const source = data.videoSrc;
    if (!source) return;
    const metadata = {
      duration: video.duration,
      height: video.videoHeight,
      source,
      width: video.videoWidth,
    };
    if (
      !Number.isFinite(metadata.duration) ||
      metadata.duration < 0 ||
      !Number.isFinite(metadata.height) ||
      metadata.height <= 0 ||
      !Number.isFinite(metadata.width) ||
      metadata.width <= 0
    ) return;
    setViewVideoMetadata(metadata);
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
  const semanticEditBlocked = Boolean(
    generating || (!retrying && (submitting || savingCanvas)) ||
      legacySubmissionBlocked ||
      lockedNodeIds.has(id),
  );
  const uploadControlBlocked =
    semanticEditBlocked || canvasMutationPending || uploading;

  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        minHeight={135}
        minWidth={240}
      />
      <EmptyMediaUploadToolbar
        disabled={uploadControlBlocked}
        label="上传视频"
        onUpload={() => {
          if (!uploadControlBlocked) inputRef.current?.click();
        }}
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
      <MediaAspectFitButton nodeId={id} />
      </NodeToolbar>
      <NodeToolbar
        className="video-creator nodrag nopan nowheel"
        data-testid="video-creator"
        isVisible={Boolean(data.videoPromptReady && singleNodeChrome)}
        offset={16}
        position={Position.Bottom}
      >
        <UpstreamInputCards
          disabled={semanticEditBlocked}
          inputs={inputPreflight.inputs}
          onMove={(edgeId, direction) => {
            commitVideoInputEdgesMutation((edges) =>
              moveNodeInputEdge(edges, id, edgeId, direction)
            );
          }}
          onRemove={(edgeId) => {
            commitVideoInputEdgesMutation((edges) =>
              edges.filter((edge) => edge.id !== edgeId)
            );
          }}
          onRoleChange={(edgeId, role) => {
            commitVideoInputEdgesMutation((edges) =>
              edges.map((edge) => edge.id === edgeId
                ? { ...edge, data: { ...edge.data, inputRole: role } }
                : edge)
            );
          }}
          problems={inputProblems}
          roleOptions={(input) => availableNodeInputRoles({
            kind: input.kind,
            modelSchema: selectedVideoModel?.parameterSchema,
            parameters: normalizedVideoSubmissionParameters,
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
          disabled={semanticEditBlocked}
          onBlur={() => promptControl.blur()}
          onChange={(event) => {
            const composing = (event.nativeEvent as InputEvent).isComposing;
            if (!composing &&
              event.target.value !== promptControl.readCommittedValue()) {
              markSingleNodeSemanticEdit({
                accountId,
                canvasId,
                fixtureScopeId,
                kind: "video",
                nodeId: id,
              });
              videoRetryLifecycleRef.current?.abort("video-input-editing");
              promptSemanticVersionRef.current += 1;
            }
            promptControl.change(event.target.value, composing);
          }}
          onCompositionEnd={(event) => {
            if (event.currentTarget.value !== promptControl.readCommittedValue()) {
              markSingleNodeSemanticEdit({
                accountId,
                canvasId,
                fixtureScopeId,
                kind: "video",
                nodeId: id,
              });
              videoRetryLifecycleRef.current?.abort("video-input-editing");
              promptSemanticVersionRef.current += 1;
            }
            promptControl.compositionEnd(event.currentTarget.value);
          }}
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
            disabled={semanticEditBlocked}
            onChange={(modelId) => {
              const nextModel = videoModels?.find((model) => model.id === modelId);
              if (
                !nextModel?.parameterSchema ||
                !nextModel.configurationRevision ||
                !nextModel.releaseRevisionId ||
                !applyModelTransition
              ) {
                setModelSwitchProblem("模型未切换：模型合同或画布事务尚未就绪");
                return;
              }
              const revocationIdentity = videoGenerationRevocationIdentity(
                getNodes().find((node) => node.id === id)?.data ?? data,
              );
              const revocationScopeKey = videoMutationScopeKey;
              const mutationVersion = videoDataMutationVersionRef.current + 1;
              videoDataMutationVersionRef.current = mutationVersion;
              void applyInteractiveModelTransition({
                intent: "model-switch",
                model: {
                  configurationRevision: nextModel.configurationRevision,
                  displayName: nextModel.displayName,
                  id: nextModel.id,
                  parameterSchema: nextModel.parameterSchema,
                  releaseRevisionId: nextModel.releaseRevisionId,
                },
                nodeId: id,
                requestedParameters: defaultParameterValues(nextModel.parameterSchema),
              }).then((result) => {
                if (
                  videoDataMutationVersionRef.current !== mutationVersion ||
                  liveVideoMutationScopeKeyRef.current !== revocationScopeKey
                ) return;
                if (result.status === "applied") {
                  setModelSwitchProblem("");
                  setServerInputProblems([]);
                  finishVideoGenerationInputRevocation(
                    revocationIdentity,
                    revocationScopeKey,
                  );
                  return;
                }
                setModelSwitchProblem(
                  `模型未切换：${result.problems?.[0] ?? result.message ?? "现有输入无法无损迁移"}`,
                );
              });
            }}
            selectedId={videoModelSelection.selectedId}
            selectedName={videoModelSelection.displayName}
          />
          {selectedVideoModel && (
            <>
              <NodeParameterControl
                disabled={semanticEditBlocked}
                emptyLabel="文生视频"
                keys={videoInputParameterKeys}
                onChange={(key, value) => {
                  if (
                    !selectedVideoModel?.parameterSchema ||
                    !selectedVideoModel.configurationRevision ||
                    !selectedVideoModel.releaseRevisionId ||
                    !applyModelTransition
                  ) {
                    setModelSwitchProblem("输入模式未切换：模型合同或画布事务尚未就绪");
                    return;
                  }
                  const revocationIdentity = videoGenerationRevocationIdentity(
                    getNodes().find((node) => node.id === id)?.data ?? data,
                  );
                  const revocationScopeKey = videoMutationScopeKey;
                  const mutationVersion = videoDataMutationVersionRef.current + 1;
                  videoDataMutationVersionRef.current = mutationVersion;
                  void applyInteractiveModelTransition({
                    intent: "mode-switch",
                    model: {
                      configurationRevision: selectedVideoModel.configurationRevision,
                      displayName: selectedVideoModel.displayName,
                      id: selectedVideoModel.id,
                      parameterSchema: selectedVideoModel.parameterSchema,
                      releaseRevisionId: selectedVideoModel.releaseRevisionId,
                    },
                    nodeId: id,
                    requestedParameters: { ...videoParameters, [key]: value },
                  }).then((result) => {
                    if (
                      videoDataMutationVersionRef.current !== mutationVersion ||
                      liveVideoMutationScopeKeyRef.current !== revocationScopeKey
                    ) return;
                    if (result.status === "applied") {
                      setModelSwitchProblem("");
                      setServerInputProblems([]);
                      finishVideoGenerationInputRevocation(
                        revocationIdentity,
                        revocationScopeKey,
                      );
                      return;
                    }
                    setModelSwitchProblem(
                      `输入模式未切换：${result.problems?.[0] ?? result.message ?? "现有输入无法无损迁移"}`,
                    );
                  });
                }}
                schema={videoParameterSchema}
                values={videoParameters}
              />
              <NodeParameterControl
                disabled={semanticEditBlocked}
                keys={videoMainParameterKeys}
                onChange={(key, value) => {
                  commitVideoDataMutation((current) => ({
                    ...clearVideoGenerationForSemanticChange(current),
                    videoParameters: { ...videoParameters, [key]: value },
                  }));
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
              disabled={semanticEditBlocked}
              keys={videoCountParameterKeys}
              onChange={(key, value) => {
                commitVideoDataMutation((current) => ({
                  ...clearVideoGenerationForSemanticChange(current),
                  videoParameters: { ...videoParameters, [key]: value },
                }));
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
                    : existingVideoTaskNeedsDecision
                      ? newGenerationBlockReason ||
                        "原任务已结束，当前暂不能重新生成"
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
              legacySubmissionBlocked ||
              (generating
                ? !cancelableTaskId
                : generatedForCurrentInput ||
                  !inputPreflight.canSubmit ||
                  serverInputProblems.length > 0 ||
                  !selectedVideoModel ||
                  selectedVideoModel.generationAvailable === false ||
                  canvasRevision === undefined ||
                  existingVideoTaskNeedsDecision)
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
        {(transientUploadError || submissionFailure || uploadError || nodeRecoveryCase || workflowRecoveryStopped) && (
          <div
            className={[
              "image-node-upload-error",
              "video-node-upload-error",
              uploadErrorNeutral && !transientUploadError ? "neutral" : "",
            ].filter(Boolean).join(" ")}
            data-error-kind={nodeRecoveryCase && !submissionFailure ? "recovering" : videoNoticeTone}
            role={(nodeRecoveryCase && !submissionFailure) || videoNoticeTone !== "failed" ? "status" : "alert"}
          >
            <ProviderErrorNotice
              diagnostic={submissionFailure || data.videoGenerationError}
              local={uploadFailureNotice}
              message={videoNoticeMessage}
              recoveryTaskId={submissionFailure || workflowRecoveryStopped ? undefined : data.videoGenerationTaskId}
              tone={videoNoticeTone}
            />
            {canReconcileVideo && (
              <GenerationReconcileControls
                busy={reconcileBusy || submitting}
                canRetry={showVideoRetry}
                onReconcile={() => void reconcileVideoResult()}
                onRetry={() => void retryVideoGeneration()}
                retryEnabled={retryGenerationEnabled}
              />
            )}
            {!workflowRecoveryStopped && !canReconcileVideo && retryAvailable && (
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
            {(!workflowRecoveryStopped && (pollingPausedTaskId ||
              (unverifiedRecoveryTaskId &&
                unverifiedRecoveryTaskId === data.videoGenerationTaskId))) && (
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
                disabled={uploadControlBlocked}
                onClick={() => {
                  if (!uploadControlBlocked) inputRef.current?.click();
                }}
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
            onReplace={() => {
              if (!uploadControlBlocked) inputRef.current?.click();
            }}
            replaceDisabled={uploadControlBlocked}
          />
        )}
        <LegacyTerminalGenerationNotice state={legacyState} />
        {(displayVideoGenerating || uploading) && (
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
          disabled={uploadControlBlocked}
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
                        {displayVideoWidth} x {displayVideoHeight}
                      </dd>
                    </div>
                    <div>
                      <dt>宽高比:</dt>
                      <dd>
                        {ratioLabel(displayVideoWidth, displayVideoHeight)}
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
