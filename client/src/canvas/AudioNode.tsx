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
import { useCanvasCheckpoint } from "./CanvasHistory";
import {
  canvasUploadTargetStillCurrent,
  useCanvasGraphMutation,
} from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import {
  MediaLoadFallback,
  useMediaLoadRecovery,
} from "./MediaLoadFallback";
import { NODE_DEFAULT_SIZES } from "./mediaGeometry";
import { NodeModelControl } from "./NodeModelControl";
import { NodeParameterControl } from "./NodeParameterControl";
import { EmptyMediaUploadToolbar } from "./EmptyMediaUploadToolbar";
import { generationOwnershipKey, type ProbeNodeType } from "./ProbeNode";
import { boundGenerationParameterProof, boundGenerationSourceProof } from "../../../types/generationIdentity";
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
  activeParameterFields,
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
import { ProviderErrorNotice } from "../generation/ProviderErrorNotice";
import { useGenerationRecoveryFollowUp } from "../generation/GenerationRecoveryContext";
import type { CuttableEdge } from "./canvasTypes";
import {
  effectiveMediaInputState,
  effectiveMediaInputStateReason,
  fetchTrustedMediaMetadata,
  hasCompleteTrustedMediaMetadata,
  mediaUploadState,
  trustedMediaPatch,
} from "./mediaInputMetadata";

type AudioPollingRun = {
  inputKey?: string;
  ownershipKey?: string;
  taskId: string;
  token: symbol;
};

type AudioGenerationRevocationIdentity = {
  inputKey?: string;
  ownershipKey?: string;
  taskId?: string;
};

function audioGenerationRevocationIdentity(
  data: ProbeNodeType["data"],
): AudioGenerationRevocationIdentity {
  return {
    inputKey: data.audioGenerationInputKey,
    ownershipKey: data.audioGenerationOwnershipKey,
    taskId: data.audioGenerationTaskId,
  };
}

function createAudioGenerationAdapter(input: {
  bindingOwnershipKey?: string;
  contractFingerprint: string;
  inputKey: string;
  modelId?: string;
  modelName?: string;
  modelConfigurationRevision: string;
  modelReleaseRevision: string;
  nodeId: string;
  ownershipKey: string;
  parameters?: ProbeNodeType["data"]["audioParameters"];
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
          audioModelId: input.modelId,
          audioModelName: input.modelName,
          audioParameters: input.parameters,
          audioGenerationContractFingerprint: input.contractFingerprint,
          audioGenerationModelConfigurationRevision:
            input.modelConfigurationRevision,
          audioGenerationModelReleaseRevision: input.modelReleaseRevision,
        },
      };
    },
    applyBinding(node, task, plan) {
      return {
        ...node,
        data: {
          ...node.data,
          audioGenerating: true,
          audioGenerationError: undefined,
          audioGenerationErrorCode: undefined,
          audioGenerationContractFingerprint: plan.contractFingerprint,
          audioGenerationInputKey: plan.inputKey,
          audioGenerationModelConfigurationRevision:
            plan.modelConfigurationRevision,
          audioGenerationModelReleaseRevision: plan.modelReleaseRevision,
          audioGenerationOwnershipKey: input.preserveBindingOwnership
            ? input.bindingOwnershipKey
            : task.generationOwnershipKey ?? plan.ownershipKey,
          audioGenerationRetryAllowed: undefined,
          audioGenerationRetryBlockCode: undefined,
          audioGenerationRetryBlockReason: undefined,
          audioGenerationTaskId: task.id,
          audioModelId: input.modelId,
          audioModelName: input.modelName,
          audioParameters: input.parameters,
          groupRunSuccessOwnershipKey: undefined,
          groupRunSuccessResultKey: undefined,
          groupRunSuccessTaskId: undefined,
        },
      };
    },
    applyTerminal(node, task, plan) {
      if (task.state === "success") {
        if (!task.resultAssetId || !task.resultUrl) {
          throw new Error("音频结果不完整");
        }
        return {
          ...node,
          height: undefined,
          measured: undefined,
          style: { ...node.style, ...NODE_DEFAULT_SIZES.audio },
          width: undefined,
          data: {
            ...node.data,
            assetId: task.resultAssetId,
            ...(task.resultMedia
              ? trustedMediaPatch({
                  assetId: task.resultAssetId,
                  kind: "audio",
                  ...task.resultMedia,
                })
              : {}),
            audioDuration:
              task.resultMedia?.durationSeconds ?? node.data.audioDuration,
            audioFileName: `${(input.prompt || "生成音频").slice(0, 60)}.${generatedAudioExtension(task)}`,
            audioFileSize: task.resultMedia?.byteSize ?? node.data.audioFileSize,
            audioGeneratedResult: true,
            audioGenerating: false,
            audioGenerationError: undefined,
            audioGenerationErrorCode: undefined,
            audioGenerationInputKey: undefined,
            audioGenerationOwnershipKey: undefined,
            audioGenerationRetryAllowed: undefined,
            audioGenerationRetryBlockCode: undefined,
            audioGenerationRetryBlockReason: undefined,
            audioGenerationTaskId: undefined,
            audioModelId: input.modelId ?? node.data.audioModelId,
            audioModelName:
              input.modelName ?? node.data.audioModelName ?? "Mureka",
            audioPrompt: input.prompt,
            audioResultChoices: task.resultOutputs?.map((output) => ({
              assetId: output.assetId,
              ...output.media,
              role: output.role,
              url: output.url,
            })),
            audioSrc: task.resultUrl,
            audioWaveform: undefined,
            groupRunSuccessOwnershipKey: plan.ownershipKey,
            groupRunSuccessResultKey: groupRunResultKey(task.resultUrl),
            groupRunSuccessTaskId: task.id,
          },
        };
      }
      if (task.state === "cancelled") {
        return {
          ...node,
          data: {
            ...node.data,
            audioGenerating: false,
            audioGenerationError: task.errorMessage ?? "音频生成已取消",
            audioGenerationErrorCode: undefined,
            audioGenerationInputKey: undefined,
            audioGenerationOwnershipKey: undefined,
            audioGenerationRetryAllowed: undefined,
            audioGenerationRetryBlockCode: undefined,
            audioGenerationRetryBlockReason: undefined,
            audioGenerationTaskId: undefined,
          },
        };
      }
      const retryAllowed = safelyRetryableGenerationTask(task);
      const visibleMessage = generationFailureMessage(
        task.errorMessage ?? "音频生成失败，请稍后再试",
        retryAllowed ? undefined : task.retryBlockReason,
        task.errorCode,
        "audio",
      );
      return {
        ...node,
        data: {
          ...node.data,
          audioGenerating: false,
          audioGenerationError: visibleMessage,
          audioGenerationErrorCode: task.errorCode,
          audioGenerationInputKey: plan.inputKey,
          audioGenerationRetryAllowed: retryAllowed,
          audioGenerationRetryBlockCode: task.retryBlockCode,
          audioGenerationRetryBlockReason: task.retryBlockReason,
          audioGenerationTaskId: task.id,
        },
      };
    },
    kind: "audio",
    readPlan(): SingleNodeGenerationBlocked | SingleNodeGenerationPlan {
      const block = input.readBlock();
      if (block) return block;
      return {
        contractFingerprint: input.contractFingerprint,
        inputKey: input.inputKey,
        kind: "audio",
        modelConfigurationRevision: input.modelConfigurationRevision,
        modelReleaseRevision: input.modelReleaseRevision,
        nodeId: input.nodeId,
        ownershipKey: input.ownershipKey,
        payload: input.payload,
      };
    },
  };
}

function audioTaskMatchesNode(
  task: GenerationTaskSummary,
  canvasId: string,
  nodeId: string,
  taskId = task.id,
  fixtureScopeId = "",
) {
  return task.id === taskId &&
    task.canvasId === canvasId &&
    (task.fixtureScopeId ?? "") === fixtureScopeId &&
    task.kind === "audio" &&
    task.nodeId === nodeId;
}

function clock(seconds = 0) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(
    Math.floor(safe % 60),
  ).padStart(2, "0")}`;
}

function waveform(buffer: AudioBuffer, bars = 64) {
  const samples = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(samples.length / bars));
  const peaks = Array.from({ length: bars }, (_, index) => {
    const start = index * block;
    const end = Math.min(samples.length, start + block);
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) {
      sum += samples[sample] ** 2;
    }
    return Math.sqrt(sum / Math.max(1, end - start));
  });
  const max = Math.max(...peaks, 0.01);
  return peaks.map((peak) => Math.round(6 + (peak / max) * 52));
}

function generatedAudioExtension(task: GenerationTaskSummary) {
  const storedExtension = task.resultAssetId?.split(".").at(-1)?.toLowerCase();
  if (["aac", "m4a", "mp3", "ogg", "wav"].includes(storedExtension ?? "")) {
    return storedExtension!;
  }
  return task.resultMedia?.contentType === "audio/ogg"
    ? "ogg"
    : task.resultMedia?.contentType === "audio/wav"
      ? "wav"
      : task.resultMedia?.contentType === "audio/mp4"
        ? "m4a"
        : task.resultMedia?.contentType === "audio/aac"
          ? "aac"
          : "mp3";
}

function hasReadyAudioMedia(node?: ProbeNodeType) {
  return Boolean(
    node?.data.assetId &&
    node.data.audioSrc &&
    (effectiveMediaInputState(node.data) === undefined ||
      effectiveMediaInputState(node.data) === "ready"),
  );
}

async function discardUnadoptedAudioAsset(assetId: string) {
  try {
    await fetch(`/api/audio-assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
    });
  } catch {
    // A stale upload must stay detached even if best-effort cleanup is offline.
  }
}

function AudioNodeImpl({
  data,
  dragging,
  id,
  parentId,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const { lockedNodeIds } = useWorkflowExecution();
  const storedLegacyState = useLegacyTerminalGenerationState(id);
  const legacyState = effectiveLegacyTerminalGenerationState({
    bindingComplete: Boolean(
      data.audioGenerationTaskId && data.audioGenerationOwnershipKey &&
        data.audioGenerationInputKey,
    ),
    hasLegacyRun: Boolean(data.workflowExecutionRunId),
    locallyActive: lockedNodeIds.has(id),
    persistedGenerating: data.audioGenerating === true,
    state: storedLegacyState,
  });
  const displayAudioGenerating = legacyState && legacyState !== "PASSTHROUGH"
    ? legacyState === "ACTIVE_CONFIRMED"
    : Boolean(data.audioGenerating);
  const legacySubmissionBlocked = legacyState === "DETECTING" ||
    legacyState === "ACTIVE_CONFIRMED" || legacyState === "UNKNOWN_BLOCKED";
  const mediaLoad = useMediaLoadRecovery(data.audioSrc);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadAdmissionPending = useRef(false);
  const uploadInFlight = useRef(false);
  const metadataHydrationAssetIdRef = useRef<string | undefined>(undefined);
  const uploadOperation = useRef(0);
  const waveformSourceAttempted = useRef<string | undefined>(undefined);
  const { getNodes } = useReactFlow<ProbeNodeType>();
  const {
    adoptUploadedAsset,
    adoptAuthoritativeNodeData,
    applyViewUpdate,
    canvasMutationPendingNodeIds,
    graphCommandPort,
    mutateGraph,
    readCanvasNode,
    readCanvasMutationVersion,
    tryAdoptNodes,
  } = useCanvasGraphMutation();
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
    data.audioGenerationTaskId,
    singleNodeChrome && !data.audioGenerating,
    { canvasId, nodeId: id },
  );
  const mediaAdoptionScopeRef = useRef(`${accountId}\u0000${canvasId}`);
  mediaAdoptionScopeRef.current = `${accountId}\u0000${canvasId}`;
  const persistenceReadyLive = useRef(persistenceReady);
  persistenceReadyLive.current = persistenceReady;
  const audioModelSelection = usePublishedModelSelection(
    "audio",
    data.audioModelId,
    data.audioModelName,
  );
  const audioModels = audioModelSelection.models;
  const selectedAudioModel = audioModelSelection.model;
  const selectedAudioModelId = audioModelSelection.selectedId;
  const audioModelUnavailableReason = audioModelSelection.unavailableReason;
  const audioParameterSchema = selectedAudioModel?.parameterSchema ??
    defaultParameterSchema("audio");
  const audioParameters = selectedAudioModel
    ? normalizeParameterValues(audioParameterSchema, data.audioParameters)
    : {};
  const audioSubmissionParameters = selectedAudioModel
    ? submissionParameterValues(audioParameterSchema, audioParameters)
    : {};
  const visibleAudioParameterKeys = new Set(
    activeParameterFields(audioParameterSchema, audioParameters).map(
      (field) => field.key,
    ),
  );
  const audioTextParameterKeys = audioParameterSchema.fields
    .filter((field) =>
      (field.type === "text" || field.type === "textarea") &&
      visibleAudioParameterKeys.has(field.key),
    )
    .map((field) => field.key);
  const audioInputParameterKeys = parameterKeysForGroups(
    audioParameterSchema,
    ["input"],
  ).filter((key) =>
    visibleAudioParameterKeys.has(key) &&
    !audioTextParameterKeys.includes(key),
  );
  const audioMainParameterKeys = parameterKeysForGroups(
    audioParameterSchema,
    ["main", "advanced", "output"],
    ["outputCount"],
  ).filter((key) => visibleAudioParameterKeys.has(key));
  const audioCountParameterKeys = audioParameterSchema.fields.some((field) => field.key === "outputCount")
    ? ["outputCount"]
    : [];
  const [currentTime, setCurrentTime] = useState(0);
  const [viewAudioMetadata, setViewAudioMetadata] = useState<{
    duration: number;
    source: string;
    waveform?: number[];
  }>();
  const generating = Boolean(data.audioGenerating);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  // 页面刷新或组件重挂后 activeTaskId 会丢失，但持久化任务号还在；
  // 取消按钮用它兜底，保证“生成中一定能取消”。
  const cancelableTaskId = activeTaskId ??
    (typeof data.audioGenerationTaskId === "string"
      ? data.audioGenerationTaskId
      : undefined);
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [playing, setPlaying] = useState(false);
  const [prompt, setPrompt] = useState(data.audioPrompt ?? "");
  const [title, setTitle] = useState(data.title ?? "Audio");
  const [uploadError, setRawUploadError] = useState(
    visibleGenerationError(data.audioGenerationError),
  );
  const [uploadErrorNeutral, setUploadErrorNeutral] = useState(false);
  const setUploadError = (message: string, errorCode?: string | null) => {
    setUploadErrorNeutral(
      Boolean(message) && !generationFailureIsDefinitive(errorCode),
    );
    setRawUploadError(message);
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
  const generationPollingRunRef = useRef<AudioPollingRun | undefined>(undefined);
  const audioRecoveryControllerRef = useRef<AbortController | undefined>(
    undefined,
  );
  useEffect(() => () => {
    audioRecoveryControllerRef.current?.abort("audio-node-unmounted");
    audioRecoveryControllerRef.current = undefined;
  }, []);
  const audioRecoveryLifecycleRef = useRef<ReturnType<
    typeof createSingleNodeGenerationLifecycle
  > | undefined>(undefined);
  const nodeRecoveryCase = useGenerationRecoveryFollowUp(
    data.audioGenerationTaskId,
    Boolean(generationPollingRunRef.current || audioRecoveryControllerRef.current),
    () => setRecoveryEpoch((current) => current + 1),
  );
  const audioRetryLifecycleRef = useRef<ReturnType<
    typeof createSingleNodeGenerationLifecycle
  > | undefined>(undefined);
  const liveGenerationInputKeyRef = useRef<string | undefined>(undefined);
  const liveGenerationOwnershipKeyRef = useRef<string | undefined>(undefined);
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const [retryWakeEpoch, setRetryWakeEpoch] = useState(0);
  const effectiveInputState = effectiveMediaInputState(data);
  const effectiveInputStateReason = effectiveMediaInputStateReason(data);
  const uploading = effectiveInputState === "uploading";
  const audioDataMutationVersionRef = useRef(0);
  const audioMutationScopeKey = JSON.stringify([
    accountId,
    canvasId,
    fixtureScopeId,
    id,
  ]);
  const liveAudioMutationScopeKeyRef = useRef(audioMutationScopeKey);
  liveAudioMutationScopeKeyRef.current = audioMutationScopeKey;
  const clearAudioGenerationForSemanticChange = (
    current: ProbeNodeType["data"],
  ): ProbeNodeType["data"] => ({
    ...current,
    audioGenerationError: undefined,
    audioGenerationErrorCode: undefined,
    audioGenerationInputKey: undefined,
    audioGenerationOwnershipKey: undefined,
    audioGenerating: false,
    audioGenerationRetryAllowed: undefined,
    audioGenerationRetryBlockCode: undefined,
    audioGenerationRetryBlockReason: undefined,
    audioGenerationTaskId: undefined,
    groupRunSuccessOwnershipKey: undefined,
    groupRunSuccessResultKey: undefined,
    groupRunSuccessTaskId: undefined,
  });
  const revokeAudioTaskForGenerationInputChange = (expectedTaskId?: string) => {
    const currentRun = generationPollingRunRef.current;
    if (
      currentRun &&
      (expectedTaskId === undefined || currentRun.taskId !== expectedTaskId)
    ) {
      if (expectedTaskId) {
        clearGenerationSubmissionIntent(
          "audio",
          canvasId,
          id,
          expectedTaskId,
          accountId,
          fixtureScopeId,
        );
      }
      return;
    }
    audioRecoveryControllerRef.current?.abort("audio-generation-input-changed");
    audioRecoveryControllerRef.current = undefined;
    audioRecoveryLifecycleRef.current?.abort("audio-generation-input-changed");
    audioRetryLifecycleRef.current?.abort("audio-generation-input-changed");
    generationPollingRunRef.current = undefined;
    setActiveTaskId(undefined);
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setRetryTaskId(undefined);
    setServerInputProblems([]);
    setUploadError("");
    clearGenerationSubmissionIntent(
      "audio",
      canvasId,
      id,
      expectedTaskId,
      accountId,
      fixtureScopeId,
    );
  };
  const finishAudioGenerationInputRevocation = (
    identity: AudioGenerationRevocationIdentity,
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
      liveAudioMutationScopeKeyRef.current !== expectedScopeKey ||
      replacementClaimed
    ) {
      if (identity.taskId) {
        clearGenerationSubmissionIntent(
          "audio",
          canvasId,
          id,
          identity.taskId,
          accountId,
          fixtureScopeId,
        );
      }
      return;
    }
    revokeAudioTaskForGenerationInputChange(identity.taskId);
  };
  const commitAudioDataMutation = (
    update: (current: ProbeNodeType["data"]) => ProbeNodeType["data"],
    afterApplied?: (identity: AudioGenerationRevocationIdentity) => void,
  ) => {
    const mutationVersion = audioDataMutationVersionRef.current + 1;
    audioDataMutationVersionRef.current = mutationVersion;
    const expectedScopeKey = audioMutationScopeKey;
    let identity: AudioGenerationRevocationIdentity | undefined;
    void mutateGraph(({ edges, nodes }) => ({
      edges,
      nodes: nodes.map((node) => {
        if (node.id !== id) return node;
        identity = audioGenerationRevocationIdentity(node.data);
        return { ...node, data: update(node.data) };
      }),
    })).then((applied) => {
      if (
        !applied ||
        !identity ||
        audioDataMutationVersionRef.current !== mutationVersion ||
        liveAudioMutationScopeKeyRef.current !== expectedScopeKey
      ) return;
      if (afterApplied) afterApplied(identity);
      else finishAudioGenerationInputRevocation(identity, expectedScopeKey);
    });
  };
  const commitAudioInputEdgesMutation = (
    updateEdges: (edges: CuttableEdge[]) => CuttableEdge[],
  ) => {
    const mutationVersion = audioDataMutationVersionRef.current + 1;
    audioDataMutationVersionRef.current = mutationVersion;
    const expectedScopeKey = audioMutationScopeKey;
    let identity: AudioGenerationRevocationIdentity | undefined;
    void mutateGraph(({ edges, nodes }) => {
      const target = nodes.find((node) => node.id === id);
      identity = target
        ? audioGenerationRevocationIdentity(target.data)
        : undefined;
      return { edges: updateEdges(edges), nodes };
    }).then((applied) => {
      if (
        !applied ||
        !identity ||
        audioDataMutationVersionRef.current !== mutationVersion ||
        liveAudioMutationScopeKeyRef.current !== expectedScopeKey
      ) return;
      finishAudioGenerationInputRevocation(identity, expectedScopeKey);
    });
  };
  const beginGenerationPollingRun = (
    taskId: string,
    inputKey?: string,
    ownershipKey?: string,
  ): AudioPollingRun => {
    audioDataMutationVersionRef.current += 1;
    audioRecoveryLifecycleRef.current?.abort("audio-recovery-superseded");
    const run = { inputKey, ownershipKey, taskId, token: Symbol(taskId) };
    generationPollingRunRef.current = run;
    setActiveTaskId(taskId);
    return run;
  };
  const ownsGenerationPollingRun = (run: AudioPollingRun) =>
    generationPollingRunRef.current === run &&
    (run.ownershipKey === undefined ||
      liveGenerationOwnershipKeyRef.current === run.ownershipKey);
  const endGenerationPollingRun = (run: AudioPollingRun) => {
    if (generationPollingRunRef.current !== run) return;
    generationPollingRunRef.current = undefined;
    setActiveTaskId((current) =>
      current === run.taskId ? undefined : current,
    );
  };
  const promptSemanticVersionRef = useRef(0);
  const promptControl = useCompositionSafeText({
    onCommit: (nextPrompt) => {
      if (nextPrompt === prompt) return;
      markSingleNodeSemanticEdit({
        accountId,
        canvasId,
        fixtureScopeId,
        kind: "audio",
        nodeId: id,
      });
      audioRecoveryControllerRef.current?.abort("audio-input-edited");
      audioRecoveryControllerRef.current = undefined;
      audioRecoveryLifecycleRef.current?.abort("audio-input-edited");
      audioRetryLifecycleRef.current?.abort("audio-input-edited");
      promptSemanticVersionRef.current += 1;
      commitAudioDataMutation((current) => ({
        ...clearAudioGenerationForSemanticChange(current),
        audioPrompt: nextPrompt,
      }), (identity) => {
        setPrompt(nextPrompt);
        finishAudioGenerationInputRevocation(identity, audioMutationScopeKey);
      });
    },
    onEditSessionStart: checkpoint,
    value: prompt,
  });
  const titleControl = useCompositionSafeText({
    onCommit: (nextTitle) => {
      commitAudioDataMutation(
        (current) => ({ ...current, title: nextTitle }),
        () => setTitle(nextTitle),
      );
    },
    onEditSessionStart: checkpoint,
    value: title,
  });
  const activeViewAudioMetadata =
    viewAudioMetadata?.source === data.audioSrc ? viewAudioMetadata : undefined;
  const duration = activeViewAudioMetadata?.duration ?? data.audioDuration ??
    data.mediaDurationSeconds ?? 0;
  const displayedWaveform = activeViewAudioMetadata?.waveform ??
    data.audioWaveform ?? [];
  const inputPreflight = resolveNodeInputs({
    edges: canvasEdges,
    modelReleaseRevision: selectedAudioModel?.releaseRevisionId,
    modelSchema: selectedAudioModel?.parameterSchema,
    nodes: canvasNodes,
    ownPrompt: promptControl.committedValue,
    parameters: audioSubmissionParameters,
    targetId: id,
    targetKind: "audio",
  });
  const inputProblems: NodeInputProblem[] = [
    ...(modelSwitchProblem
      ? [{ code: "MODEL_UNSUPPORTED" as const, message: modelSwitchProblem }]
      : []),
    ...inputPreflight.problems,
    ...serverInputProblems,
  ];
  const uploadFailureNotice = Boolean(transientUploadError) ||
    Boolean(uploadFailureMessage && uploadError === uploadFailureMessage);
  const audioNoticeMessage = effectiveInputState === "invalid" &&
    inputProblems.length > 0 && !uploadFailureNotice
    ? ""
    : transientUploadError || uploadError;
  const audioNoticeTone = uploadFailureNotice
    ? generationNoticeTone({ message: audioNoticeMessage })
    : generationNoticeTone({
    code: data.audioGenerationErrorCode,
    inputBlocked: Boolean(
      modelSwitchProblem ||
      inputPreflight.problems.length ||
      serverInputProblems.length ||
      effectiveInputState === "invalid",
    ),
    message: audioNoticeMessage,
    recovering: Boolean(
      pollingPausedTaskId ||
      unverifiedRecoveryTaskId,
    ),
  });
  const hasCompatibleUpstreamText = inputPreflight.inputs.some((input) =>
    input.kind === "text" &&
    input.state === "ready" &&
    input.compatibility === "compatible" &&
    !input.reason);
  const independentLyrics = typeof audioSubmissionParameters.lyrics === "string"
    ? audioSubmissionParameters.lyrics.trim()
    : "";
  const inputFeedbackKey = JSON.stringify({
    edges: inputPreflight.inputs.map((input) => ({
      assetId: input.assetId,
      edgeId: input.edgeId,
      order: input.order,
      role: input.role,
      sourceNodeId: input.sourceNodeId,
      state: input.state,
    })),
    model: selectedAudioModel?.id,
    parameters: audioSubmissionParameters,
    prompt: promptControl.committedValue,
    revision: canvasRevision,
  });
  const audioGenerationInputKey = createGenerationInputKey({
    inputs: inputPreflight.inputs,
    modelConfigurationRevision: selectedAudioModel?.configurationRevision,
    modelId: selectedAudioModelId,
    modelReleaseRevision: selectedAudioModel?.releaseRevisionId,
    ownPrompt: promptControl.committedValue,
    parameters: audioSubmissionParameters,
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
    modelConfigurationRevision: selectedAudioModel?.configurationRevision,
    modelId: selectedAudioModelId,
    modelReleaseRevision: selectedAudioModel?.releaseRevisionId,
    parameters: selectedAudioModel ? audioSubmissionParameters : data.audioParameters,
    prompt: promptControl.committedValue,
    upstream: generationOwnershipUpstream,
  });
  const boundParameterProof = boundGenerationParameterProof({
    kind: "audio",
    frozen: {
      inputKey: data.audioGenerationInputKey,
      ownershipKey: data.audioGenerationOwnershipKey,
      modelId: data.audioModelId,
      modelConfigurationRevision: data.audioGenerationModelConfigurationRevision,
      modelReleaseRevision: data.audioGenerationModelReleaseRevision,
      contractFingerprint: data.audioGenerationContractFingerprint,
    },
    current: selectedAudioModel ? {
      capability: selectedAudioModel.capability,
      modelId: selectedAudioModel.id,
      modelConfigurationRevision: selectedAudioModel.configurationRevision,
      modelReleaseRevision: selectedAudioModel.releaseRevisionId,
      contractFingerprint: inputPreflight.contractFingerprint,
      parameterSchema: selectedAudioModel.parameterSchema,
      parameters: data.audioParameters,
    } : undefined,
  });
  const boundParameterProofRef = useRef(boundParameterProof);
  boundParameterProofRef.current = boundParameterProof;
  const boundSourceProof = boundGenerationSourceProof(data.audioGenerationInputKey, audioGenerationInputKey);
  const boundSourceProofRef = useRef(boundSourceProof);
  boundSourceProofRef.current = boundSourceProof;
  const rawGenerationInputFingerprint = data.audioGenerationOwnershipKey ?? generationOwnershipKey({
    contractFingerprint: data.audioGenerationOwnershipKey
      ? data.audioGenerationContractFingerprint
      : inputPreflight.contractFingerprint,
    modelConfigurationRevision: data.audioGenerationOwnershipKey
      ? data.audioGenerationModelConfigurationRevision
      : selectedAudioModel?.configurationRevision,
    // Once a task is ownership-bound, catalog changes must not reinterpret its
    // saved model snapshot. Before admission, use the effective values that are
    // materialized and ACKed on the canvas below.
    modelId: data.audioGenerationOwnershipKey
      ? data.audioModelId
      : selectedAudioModelId,
    modelReleaseRevision: data.audioGenerationOwnershipKey
      ? data.audioGenerationModelReleaseRevision
      : selectedAudioModel?.releaseRevisionId,
    parameters: data.audioGenerationOwnershipKey
      ? data.audioParameters
      : selectedAudioModel
        ? audioSubmissionParameters
        : data.audioParameters,
    prompt: promptControl.committedValue,
    // Only durable source/edge semantics belong here. Compatibility, resolver
    // reasons, and resolved roles can drift with the model catalog.
    upstream: generationOwnershipUpstream,
  });
  liveGenerationInputKeyRef.current = audioGenerationInputKey;
  liveGenerationOwnershipKeyRef.current = rawGenerationInputFingerprint;
  const audioGenerationRequestInput = {
    canvasId,
    canvasRevision,
    inputSchemaVersion: 1 as const,
    inputs: inputPreflight.snapshot,
    model: selectedAudioModelId,
    nodeId: id,
    ownPrompt: promptControl.committedValue,
    parameters: audioSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  };
  const stableRawGenerationInputFingerprint = useRef<string | undefined>(
    undefined,
  );
  const legacyRecoveryCatalogKey = data.audioGenerationOwnershipKey
    ? "ownership-bound"
    : `${audioModelSelection.status}:${selectedAudioModelId ?? ""}:${audioGenerationInputKey}`;
  const retryAvailable = Boolean(
    retryTaskId &&
    (!data.audioGenerationOwnershipKey || boundParameterProof.state === "valid") &&
    data.audioGenerationInputKey === audioGenerationInputKey &&
    (!data.audioGenerationOwnershipKey ||
      data.audioGenerationOwnershipKey === rawGenerationInputFingerprint) &&
    data.audioGenerationRetryAllowed === true &&
    selectedAudioModel &&
    selectedAudioModel.generationAvailable !== false,
  );
  const newGenerationAvailable = Boolean(
    newGenerationTaskId &&
    newGenerationAllowed &&
    selectedAudioModel &&
    selectedAudioModel.generationAvailable !== false,
  );
  const existingAudioTaskNeedsDecision = Boolean(
    data.audioGenerationTaskId &&
    data.audioGenerationError &&
    !data.audioGenerating &&
    !newGenerationAvailable,
  );
  const showAudioRetry = generationRetryVisible({
    errorCode: data.audioGenerationErrorCode,
    retryAvailable,
  });
  const canReconcileAudio = false;

  const relayCancellationAvailable =
    selectedAudioModel?.providerProtocol === "media-generate";

  useEffect(() => {
    setModelSwitchProblem("");
  }, [canvasEdges]);

  useEffect(() => {
    if (pollingPausedTaskIdRef.current) return;
    setUploadError(
      effectiveInputState === "invalid" && effectiveInputStateReason
        ? effectiveInputStateReason
        : visibleGenerationError(data.audioGenerationError),
      effectiveInputState === "invalid"
        ? "INPUT_INVALID"
        : data.audioGenerationErrorCode,
    );
  }, [
    data.audioGenerationError,
    data.audioGenerationErrorCode,
    effectiveInputState,
    effectiveInputStateReason,
  ]);

  useEffect(() => {
    setServerInputProblems([]);
  }, [inputFeedbackKey]);

  useEffect(() => {
    const wakeAcceptedRetry = (event: Event) => {
      const detail = (event as CustomEvent<GenerationTaskRetryAcceptedDetail>)
        .detail;
      if (
        detail?.canvasId === canvasId &&
        detail.nodeId === id &&
        detail.kind === "audio" &&
        detail.taskId === data.audioGenerationTaskId
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
  }, [canvasId, data.audioGenerationTaskId, id]);

  useEffect(() => {
    if (!persistenceReady) {
      stableRawGenerationInputFingerprint.current = undefined;
      return;
    }
    if (data.workflowExecutionRunId || data.audioGenerationOwnershipKey) {
      stableRawGenerationInputFingerprint.current = rawGenerationInputFingerprint;
      return;
    }
    const previous = stableRawGenerationInputFingerprint.current;
    stableRawGenerationInputFingerprint.current = rawGenerationInputFingerprint;
    const persistedMismatch = Boolean(
      data.audioGenerationOwnershipKey &&
      data.audioGenerationOwnershipKey !== rawGenerationInputFingerprint,
    );
    if (
      !persistedMismatch &&
      (previous === undefined || previous === rawGenerationInputFingerprint)
    ) {
      return;
    }
    if (
      !data.audioGenerating &&
      !data.audioGenerationTaskId &&
      !data.audioGenerationInputKey &&
      !data.audioGenerationOwnershipKey
    ) return;
    if (persistedMismatch) {
      clearGenerationSubmissionIntent(
        "audio",
        canvasId,
        id,
        data.audioGenerationTaskId,
        accountId,
        fixtureScopeId,
      );
    }
    commitAudioDataMutation(clearAudioGenerationForSemanticChange);
  }, [
    accountId,
    canvasId,
    data.audioGenerating,
    data.audioGenerationInputKey,
    data.audioGenerationOwnershipKey,
    data.audioGenerationTaskId,
    data.workflowExecutionRunId,
    id,
    persistenceReady,
    rawGenerationInputFingerprint,
  ]);

  const persistAudioGenerationFailure = async (
    taskId: string,
    message: string,
    errorCode: string | undefined,
    retryAllowed: boolean,
    retryBlockCode?: string,
    retryBlockReason?: string,
    _generationInputKey?: string,
    _generationOwnershipKey?: string,
  ) => {
    const visibleMessage = generationFailureMessage(
      message,
      retryAllowed ? undefined : retryBlockReason,
      errorCode,
      "audio",
    );
    const applied = applyViewUpdate((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            audioGenerationError: visibleMessage,
            audioGenerationErrorCode: errorCode,
            audioGenerating: false,
            audioGenerationRetryAllowed: retryAllowed,
            audioGenerationRetryBlockCode: retryBlockCode,
            audioGenerationRetryBlockReason: retryBlockReason,
          },
      }
      : node));
    if (!applied) return false;
    setUploadError(visibleMessage);
    setRetryTaskId(retryAllowed ? taskId : undefined);
    clearGenerationSubmissionIntent(
      "audio",
      canvasId,
      id,
      taskId,
      accountId,
      fixtureScopeId,
    );
    return true;
  };

  const persistAudioGenerationCancellation = async (
    taskId: string,
    message: string,
  ) => {
    const applied = applyViewUpdate((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            audioGenerationError: message,
            audioGenerationErrorCode: undefined,
            audioGenerating: false,
            audioGenerationRetryAllowed: undefined,
            audioGenerationRetryBlockCode: undefined,
            audioGenerationRetryBlockReason: undefined,
          },
      }
      : node));
    if (!applied) return false;
    setUploadError(message);
    setRetryTaskId(undefined);
    clearGenerationSubmissionIntent(
      "audio",
      canvasId,
      id,
      taskId,
      accountId,
      fixtureScopeId,
    );
    return true;
  };

  useEffect(() => {
    if (
      !persistenceReady ||
      effectiveInputState !== "uploading" ||
      uploadInFlight.current
    ) return;
    const message = "上传已中断，请重新上传";
    applyViewUpdate((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            ...mediaUploadState("invalid", message),
          },
        }
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
      !data.audioSrc ||
      hasCompleteTrustedMediaMetadata("audio", data) ||
      metadataHydrationAssetIdRef.current === data.assetId ||
      effectiveInputState === "uploading"
    ) return;
    const requestedAssetId = data.assetId;
    metadataHydrationAssetIdRef.current = requestedAssetId;
    const controller = new AbortController();
    let settled = false;
    void fetchTrustedMediaMetadata("audio", requestedAssetId, controller.signal)
      .then((metadata) => {
        settled = true;
        adoptAuthoritativeNodeData({
          expectedAssetId: requestedAssetId,
          nodeId: id,
          patch: {
            ...trustedMediaPatch(metadata),
            audioDuration: metadata.durationSeconds ?? data.audioDuration,
          },
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        settled = true;
        const message = error instanceof Error
          ? error.message
          : "服务端无法确认音频素材信息";
        applyViewUpdate((nodes) => nodes.map((node) =>
          node.id === id && node.data.assetId === requestedAssetId
          ? {
              ...node,
              data: {
                ...node.data,
                ...mediaUploadState("invalid", message),
              },
            }
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
    data.audioSrc,
    effectiveInputState,
    data.mediaByteSize,
    data.mediaContentType,
    data.mediaDurationSeconds,
    data.mediaMetadataSource,
    data.mediaMetadataStatus,
    data.mediaStorageBackend,
    id,
    persistenceReady,
    adoptAuthoritativeNodeData,
    applyViewUpdate,
  ]);

  const applyGeneratedAudio = async (
    task: GenerationTaskSummary,
    cleanPrompt: string,
    run: AudioPollingRun,
    signal: AbortSignal,
  ) => {
    if (
      signal?.aborted ||
      !ownsGenerationPollingRun(run) ||
      !audioTaskMatchesNode(task, canvasId, id, run.taskId, fixtureScopeId)
    ) return false;
    if (!taskMatchesSingleNodeGenerationIdentity(task, {
      contractFingerprint: data.audioGenerationContractFingerprint ?? "",
      inputKey: run.inputKey ?? "",
      modelConfigurationRevision:
        data.audioGenerationModelConfigurationRevision ?? "",
      modelReleaseRevision: data.audioGenerationModelReleaseRevision ?? "",
      ownershipKey: run.ownershipKey ?? "",
    })) {
      throw new Error("音频任务合同已变化，旧结果已保留且未覆盖当前节点");
    }
    if (task.state !== "success" || !task.resultAssetId || !task.resultUrl) {
      throw new Error("音频结果不完整");
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
          "audio",
          canvasId,
          id,
          task.id,
          accountId,
          fixtureScopeId,
        );
        return true;
      }
      const patched = graphCommandPort?.applyViewPatch?.({
        kind: "audio",
        nodeId: id,
        ownershipKey: run.ownershipKey ?? "",
        patch: {
          audioGenerating: false,
          audioGenerationError: projectionMessage,
          audioGenerationErrorCode: projectionState === "conflict"
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
        "audio",
        canvasId,
        id,
        task.id,
        accountId,
        fixtureScopeId,
      );
      return true;
    }
    const applied = await tryAdoptNodes(id, (nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              height: undefined,
              measured: undefined,
              style: {
                ...node.style,
                ...NODE_DEFAULT_SIZES.audio,
              },
              width: undefined,
              data: {
                ...node.data,
                assetId: task.resultAssetId,
                ...(task.resultMedia
                  ? trustedMediaPatch({
                      assetId: task.resultAssetId!,
                      kind: "audio",
                      ...task.resultMedia,
                    })
                  : {}),
                audioDuration: task.resultMedia?.durationSeconds ?? node.data.audioDuration,
                audioFileSize: task.resultMedia?.byteSize ?? node.data.audioFileSize,
                audioFileName: `${(cleanPrompt || "生成音频").slice(0, 60)}.${generatedAudioExtension(task)}`,
                audioGeneratedResult: true,
                audioGenerationError: undefined,
                audioGenerationErrorCode: undefined,
                audioGenerationInputKey: undefined,
                audioGenerationOwnershipKey: undefined,
                audioGenerating: false,
                audioGenerationRetryAllowed: undefined,
                audioGenerationRetryBlockCode: undefined,
                audioGenerationRetryBlockReason: undefined,
                audioGenerationTaskId: undefined,
                groupRunSuccessOwnershipKey: run.ownershipKey,
                groupRunSuccessResultKey: groupRunResultKey(task.resultUrl),
                groupRunSuccessTaskId: task.id,
                audioModelId:
                  audioModelSelection.selectedId ?? node.data.audioModelId,
                audioModelName:
                  audioModelSelection.displayName ??
                  node.data.audioModelName ??
                  "Mureka",
                audioPrompt: cleanPrompt,
                audioResultChoices: task.resultOutputs?.map((output) => ({
                  assetId: output.assetId,
                  ...output.media,
                  role: output.role,
                  url: output.url,
                })),
                audioSrc: task.resultUrl,
                audioWaveform: undefined,
              },
            }
          : node,
      ),
    );
    if (signal?.aborted || !ownsGenerationPollingRun(run) || !applied) {
      return false;
    }
    waveformSourceAttempted.current = undefined;
    setCurrentTime(0);
    setPlaying(false);
    clearGenerationSubmissionIntent("audio", canvasId, id, task.id, accountId, fixtureScopeId);
    return true;
  };

  const generateAudio = async (
    _options: { autoRecover?: boolean } = {},
  ): Promise<NodeGenerationOutcome> => {
    const cleanPrompt = inputPreflight.finalPrompt;
    if (
      !cleanPrompt ||
      generating ||
      submitting ||
      isFixture ||
      canvasRevision === undefined ||
      !inputPreflight.canSubmit ||
      serverInputProblems.length > 0 ||
      !selectedAudioModel ||
      selectedAudioModel.generationAvailable === false
    ) {
      if (canvasRevision === undefined) {
        setUploadError("画布尚未保存，保存完成后可生成", "CANVAS_NOT_SAVED");
      } else if (
        !inputProblems.length &&
        !audioModelUnavailableReason &&
        !isFixture &&
        !generating &&
        !submitting
      ) {
        setUploadError("音频生成暂未开始，请检查当前节点状态");
      }
      return { status: "skipped" };
    }
    audioDataMutationVersionRef.current += 1;
    setUploadError("");
    setServerInputProblems([]);
    setRetryTaskId(undefined);
    setSubmitting(true);
    let pollingRun: AudioPollingRun | undefined;
    const requestedGenerationInputKey = audioGenerationInputKey;
    const requestedGenerationOwnershipKey =
      effectiveGenerationInputFingerprint;
    const requestedModelId = selectedAudioModelId;
    const requestedModelName = audioModelSelection.displayName;
    const requestedParameters = { ...audioParameters };
    const requestedPrompt = promptControl.committedValue.trim();
    let saveBoundary = 0;
    try {
      if (!graphCommandPort) {
        setUploadError("画布事务尚未就绪，暂未创建音频生成任务");
        return { status: "skipped" };
      }
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createAudioGenerationAdapter({
          contractFingerprint: inputPreflight.contractFingerprint ?? "",
          inputKey: requestedGenerationInputKey,
          modelId: requestedModelId,
          modelName: requestedModelName,
          modelConfigurationRevision:
            selectedAudioModel?.configurationRevision ?? "",
          modelReleaseRevision: selectedAudioModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: requestedGenerationOwnershipKey,
          parameters: requestedParameters,
          payload: audioGenerationRequestInput,
          prompt: requestedPrompt,
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
        onBindingCommitted() {
          setSubmitting(false);
        },
        save: {
          flush: async () => undefined,
          async waitForRevision() {
            const revision = await waitForCanvasRevision();
            saveBoundary += 1;
            if (saveBoundary === 2) setSubmitting(false);
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
              requestedGenerationInputKey,
              requestedGenerationOwnershipKey,
            );
          },
        }),
      });
      const result = await lifecycle.generate();
      if (!result.task) {
        const message = result.message ??
          "生成任务未创建，当前节点未开始生成";
        setUploadError(message);
        return { message, status: "failed" };
      }
      if (result.status === "stale") {
        const message = result.message ??
          "生成结果已过期，当前节点未被覆盖";
        setUploadError(message);
        return { message, status: "failed" };
      }
      clearGenerationSubmissionIntent(
        "audio",
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
          "audio",
        );
        setUploadError(generationFailureMessage(
          message,
          result.task.retryAllowed ? undefined : result.task.retryBlockReason,
          result.task.errorCode,
          "audio",
        ));
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
      waveformSourceAttempted.current = undefined;
      setCurrentTime(0);
      setPlaying(false);
      setRetryTaskId(undefined);
      setNewGenerationTaskId(undefined);
      setNewGenerationAllowed(false);
      setNewGenerationBlockReason("");
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
        : generationMessageFallback("audio");
      const friendly = friendlyGenerationMessage(message, "audio");
      if (!pollingRun) {
        setUploadError(friendly);
      }
      return { message: friendly, status: "failed" };
    } finally {
      setSubmitting(false);
      if (pollingRun) endGenerationPollingRun(pollingRun);
    }
  };

  const retryAudioGeneration = async () => {
    if (
      !retryTaskId ||
      !retryAvailable ||
      isFixture ||
      !retryGenerationEnabled ||
      generating ||
      submitting
    ) return;
    audioDataMutationVersionRef.current += 1;
    audioRecoveryControllerRef.current?.abort("audio-recovery-superseded");
    const taskId = retryTaskId;
    const requestedPrompt = promptControl.readCommittedValue();
    const requestedPromptSemanticVersion = promptSemanticVersionRef.current;
    const semanticEditScope = {
      accountId,
      canvasId,
      fixtureScopeId,
      kind: "audio" as const,
      nodeId: id,
    };
    const requestedSemanticEditVersion =
      readSingleNodeSemanticEditVersion(semanticEditScope);
    const requestedCanvasMutationVersion = readCanvasMutationVersion(id);
    const requestedGenerationInputKey = audioGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setRetrying(true);
    setSubmitting(true);
    let retryAccepted = false;
    let pollingRun: AudioPollingRun | undefined;
    try {
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createAudioGenerationAdapter({
          contractFingerprint: data.audioGenerationContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: requestedGenerationInputKey,
          modelId: data.audioModelId,
          modelName: data.audioModelName,
          modelConfigurationRevision:
            data.audioGenerationModelConfigurationRevision ??
            selectedAudioModel?.configurationRevision ?? "",
          modelReleaseRevision: data.audioGenerationModelReleaseRevision ??
            selectedAudioModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: requestedGenerationOwnershipKey,
          parameters: data.audioParameters,
          payload: audioGenerationRequestInput,
          prompt: data.audioPrompt ?? promptControl.committedValue.trim(),
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
      audioRetryLifecycleRef.current = lifecycle;
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
      setServerInputProblems([]);
      clearGenerationSubmissionIntent("audio", canvasId, id, taskId, accountId, fixtureScopeId);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
        waveformSourceAttempted.current = undefined;
        setCurrentTime(0);
        setPlaying(false);
        setRetryTaskId(undefined);
        setUploadError("");
        return;
      }
      const message = generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled"
            ? "音频生成已取消"
            : "音频生成失败，请稍后再试"
        ),
        result.task.retryAllowed
          ? undefined
          : result.task.retryBlockReason,
        result.task.errorCode,
        "audio",
      );
      setUploadError(message);
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
    } catch (error) {
      if (
        pollingRun &&
        pollingPausedTaskIdRef.current === taskId &&
        ownsGenerationPollingRun(pollingRun)
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
        : "音频生成失败，请稍后再试";
      const errorCode = error instanceof GenerationRequestError
        ? error.code
        : "TASK_STATUS_UNKNOWN";
      if (!pollingRun || ownsGenerationPollingRun(pollingRun)) {
        await persistAudioGenerationFailure(
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
      audioRetryLifecycleRef.current = undefined;
      if (pollingRun) endGenerationPollingRun(pollingRun);
      setSubmitting(false);
      setRetrying(false);
    }
  };

  const resumeAudioPolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    audioRecoveryControllerRef.current?.abort("audio-recovery-superseded");
    const controller = new AbortController();
    audioRecoveryControllerRef.current = controller;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setUploadError("");
    const pollingRun = beginGenerationPollingRun(
      taskId,
      data.audioGenerationInputKey,
      data.audioGenerationOwnershipKey ?? rawGenerationInputFingerprint,
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
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
        const applied = await persistAudioGenerationCancellation(
          task.id,
          task.errorMessage ?? "音频生成已取消",
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
        const applied = await persistAudioGenerationFailure(
          task.id,
          friendlyGenerationMessage(task.errorMessage, "audio", task.errorCode),
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
      const applied = await applyGeneratedAudio(
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
      setNewGenerationTaskId(undefined);
      setNewGenerationAllowed(false);
      setNewGenerationBlockReason("");
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
        error instanceof Error ? error.message : "音频生成失败，请稍后再试",
      );
    } finally {
      if (audioRecoveryControllerRef.current === controller) {
        audioRecoveryControllerRef.current = undefined;
      }
      endGenerationPollingRun(pollingRun);
    }
  };

  const reconcileAudioResult = async () => {
    const taskId = data.audioGenerationTaskId;
    if (
      !taskId ||
      !canReconcileAudio ||
      reconcileBusy ||
      isFixture ||
      !retryGenerationEnabled
    ) return;
    const requestedGenerationInputKey = audioGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setReconcileBusy(true);
    let reconcileSaveGatePassed = false;
    let pollingRun: AudioPollingRun | undefined;
    try {
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createAudioGenerationAdapter({
          contractFingerprint: data.audioGenerationContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: data.audioGenerationInputKey || audioGenerationInputKey,
          modelId: data.audioModelId,
          modelName: data.audioModelName,
          modelConfigurationRevision:
            data.audioGenerationModelConfigurationRevision ??
            selectedAudioModel?.configurationRevision ?? "",
          modelReleaseRevision: data.audioGenerationModelReleaseRevision ??
            selectedAudioModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: data.audioGenerationOwnershipKey ??
            requestedGenerationOwnershipKey,
          parameters: data.audioParameters,
          payload: audioGenerationRequestInput,
          prompt: data.audioPrompt ?? promptControl.committedValue.trim(),
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
        setUploadError(message);
        return;
      }
      if (!result.task || result.status === "stale") return;
      clearGenerationSubmissionIntent(
        "audio",
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
        waveformSourceAttempted.current = undefined;
        setCurrentTime(0);
        setPlaying(false);
        setUploadError("");
        setRetryTaskId(undefined);
        return;
      }
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
      const failureMessage = generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled"
            ? "音频生成已取消"
            : "音频生成失败，请稍后再试"
        ),
        result.task.retryAllowed
          ? undefined
          : result.task.retryBlockReason,
        result.task.errorCode,
        "audio",
      );
      setUploadError(failureMessage);
      setRetryTaskId(
        safelyRetryableGenerationTask(result.task)
          ? result.task.id
          : undefined,
      );
    } catch (error) {
      if (
        pollingRun &&
        pollingPausedTaskIdRef.current === taskId &&
        ownsGenerationPollingRun(pollingRun)
      ) return;
      setUploadError(
        error instanceof Error ? error.message : "核对结果失败，请稍后再试",
      );
    } finally {
      if (pollingRun) endGenerationPollingRun(pollingRun);
      setReconcileBusy(false);
    }
  };

  const recheckAudioTaskStatus = () => {
    if (
      unverifiedRecoveryTaskId &&
      unverifiedRecoveryTaskId === data.audioGenerationTaskId
    ) {
      setRecoveryEpoch((current) => current + 1);
      return;
    }
    void resumeAudioPolling();
  };

  const cancelAudioGeneration = async () => {
    if (pollingPausedTaskIdRef.current) {
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
    }
    if (!cancelableTaskId || !relayCancellationAvailable) return;
    const taskId = cancelableTaskId;
    const pollingRun = generationPollingRunRef.current?.taskId === taskId
      ? generationPollingRunRef.current
      : undefined;
    try {
      if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createAudioGenerationAdapter({
          contractFingerprint: data.audioGenerationContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: pollingRun.inputKey ??
            data.audioGenerationInputKey ??
            audioGenerationInputKey,
          modelId: data.audioModelId,
          modelName: data.audioModelName,
          modelConfigurationRevision:
            data.audioGenerationModelConfigurationRevision ??
            selectedAudioModel?.configurationRevision ?? "",
          modelReleaseRevision: data.audioGenerationModelReleaseRevision ??
            selectedAudioModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: pollingRun.ownershipKey ??
            data.audioGenerationOwnershipKey ??
            rawGenerationInputFingerprint,
          parameters: data.audioParameters,
          payload: audioGenerationRequestInput,
          prompt: data.audioPrompt ?? promptControl.committedValue.trim(),
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
      setUploadError(
        result.task.errorMessage ?? "已停止本地等待，上游任务可能仍在运行",
      );
      setRetryTaskId(undefined);
      clearGenerationSubmissionIntent(
        "audio",
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
    if (
      !persistenceReady ||
      isFixture ||
      generationPollingRunRef.current ||
      workflowBlocksSingleNodeRecovery({
        locked: lockedNodeIds.has(id),
        workflowExecutionRunId: data.workflowExecutionRunId,
      })
    ) return;
    const persistedTaskId = data.audioGenerationTaskId;
    const persistedInputKey = data.audioGenerationInputKey;
    const persistedOwnershipKey = data.audioGenerationOwnershipKey;
    const catalogReady = audioModelSelection.status === "ready" &&
      Boolean(selectedAudioModel);
    const canInspectTerminalFailure = Boolean(
      persistedTaskId &&
      data.audioGenerationError &&
      !data.audioGenerating,
    );
    const controller = new AbortController();
    audioRecoveryControllerRef.current = controller;
    let pollingRun: AudioPollingRun | undefined;
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
            "audio",
            canvasId,
            id,
            persistedTaskId,
            accountId,
            fixtureScopeId,
          );
          commitAudioDataMutation(
            (current) => current.audioGenerationTaskId === persistedTaskId
              ? clearAudioGenerationForSemanticChange(current)
              : current,
            (identity) => {
              setUnverifiedRecoveryTaskId((current) =>
                current === persistedTaskId ? undefined : current
              );
              finishAudioGenerationInputRevocation(identity, audioMutationScopeKey);
            },
          );
          return;
        }
        if (!persistedOwnershipKey) {
          if (!catalogReady && !canInspectTerminalFailure) return;
          if (
            persistedInputKey &&
            persistedInputKey !== audioGenerationInputKey &&
            !canInspectTerminalFailure
          ) {
            commitAudioDataMutation(
              (current) => current.audioGenerationTaskId === persistedTaskId
                ? clearAudioGenerationForSemanticChange(current)
                : current,
              (identity) => {
                setUnverifiedRecoveryTaskId((current) =>
                  current === persistedTaskId ? undefined : current
                );
                finishAudioGenerationInputRevocation(identity, audioMutationScopeKey);
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
      if (controller.signal.aborted || !task) return;
      if (
        canInspectTerminalFailure &&
        task.state === "failed" &&
        ((persistedOwnershipKey &&
          persistedOwnershipKey !== rawGenerationInputFingerprint) ||
          (!persistedOwnershipKey && persistedInputKey &&
            persistedInputKey !== audioGenerationInputKey))
      ) {
        setNewGenerationTaskId(task.id);
        setNewGenerationAllowed(task.newGenerationAllowed === true);
        setNewGenerationBlockReason(
          task.newGenerationBlockReason ??
            "原任务已结束，当前暂不能重新生成",
        );
        setRetryTaskId(undefined);
        setUploadError(generationFailureMessage(
          task.errorMessage ?? data.audioGenerationError ??
            "音频生成失败，请稍后再试",
          undefined,
          task.errorCode ?? data.audioGenerationErrorCode,
          "audio",
        ));
        return;
      }
      // Reading the original task does not need a live catalog. Legacy client
      // result writes do; modern server projection keeps its own full fence.
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
          "audio",
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
        if (legacyInputKey && legacyInputKey !== audioGenerationInputKey) {
          if (persistedTaskId) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
          }
          clearGenerationSubmissionIntent(
            "audio",
            canvasId,
            id,
            persistedTaskId ?? task.id,
            accountId,
            fixtureScopeId,
          );
          return;
        }
      }
      if (!audioTaskMatchesNode(
        task,
        canvasId,
        id,
        task.id,
        fixtureScopeId,
      )) {
        if (persistedTaskId) {
          commitAudioDataMutation(
            (current) => current.audioGenerationTaskId === persistedTaskId
              ? clearAudioGenerationForSemanticChange(current)
              : current,
            (identity) => {
              setUnverifiedRecoveryTaskId((current) =>
                current === persistedTaskId ? undefined : current
              );
              finishAudioGenerationInputRevocation(identity, audioMutationScopeKey);
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
        !recoveredIntent && data.audioGenerationRetryAllowed === false;
      const recoveredTask = retainPersistedBlock
        ? {
            ...task,
            errorCode: data.audioGenerationErrorCode,
            errorMessage: data.audioGenerationError ??
              task.errorMessage ??
              "音频生成失败，请稍后再试",
            retryAllowed: false,
            retryBlockCode: data.audioGenerationRetryBlockCode,
            retryBlockReason: data.audioGenerationRetryBlockReason,
          }
        : task;
      if (recoveredTask.state === "failed") {
        const retryAllowed = safelyRetryableGenerationTask(recoveredTask);
        setUploadError(generationFailureMessage(
          recoveredTask.errorMessage ?? "音频生成失败，请稍后再试",
          retryAllowed ? undefined : recoveredTask.retryBlockReason,
          recoveredTask.errorCode,
          "audio",
        ));
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
        adapter: createAudioGenerationAdapter({
          bindingOwnershipKey: recoveredOwnershipKey,
          contractFingerprint: task.modelInputContractFingerprint ??
            data.audioGenerationContractFingerprint ??
            inputPreflight.contractFingerprint ?? "",
          inputKey: persistedInputKey ??
            task.generationInputKey ??
            audioGenerationInputKey,
          modelId: data.audioModelId,
          modelName: data.audioModelName,
          modelConfigurationRevision: task.modelConfigurationRevision ??
            data.audioGenerationModelConfigurationRevision ??
            selectedAudioModel?.configurationRevision ?? "",
          modelReleaseRevision: task.modelReleaseRevision ??
            data.audioGenerationModelReleaseRevision ??
            selectedAudioModel?.releaseRevisionId ?? "",
          nodeId: id,
          ownershipKey: recoveredOwnershipKey ??
            rawGenerationInputFingerprint,
          parameters: data.audioParameters,
          payload: audioGenerationRequestInput,
          preserveBindingOwnership: true,
          prompt: data.audioPrompt ?? promptControl.committedValue.trim(),
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
      audioRecoveryLifecycleRef.current = lifecycle;
      controller.signal.addEventListener(
        "abort",
        () => lifecycle?.abort("audio-recovery-aborted"),
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
        !ownsGenerationPollingRun(pollingRun)
      ) return;
      if (
        !result.task ||
        result.status === "stale"
      ) {
        setUploadError(result.message ?? (
          result.status === "stale"
            ? "生成结果已过期，当前节点未被覆盖"
            : "恢复任务未返回结果，当前节点未被更新"
        ));
        return;
      }
      // This effect can be aborted by its own terminal graph patch. Clearing
      // the task-specific intent remains safe because taskId CAS will not
      // remove a newer submission intent.
      clearGenerationSubmissionIntent(
        "audio",
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
        waveformSourceAttempted.current = undefined;
        setCurrentTime(0);
        setPlaying(false);
        setUploadError("");
        setRetryTaskId(undefined);
      } else if (result.status === "cancelled") {
        setNewGenerationTaskId(undefined);
        setNewGenerationAllowed(false);
        setNewGenerationBlockReason("");
        setUploadError(result.task.errorMessage ?? "音频生成已取消");
        setRetryTaskId(undefined);
      } else {
        const retryAllowed = safelyRetryableGenerationTask(result.task);
        setUploadError(generationFailureMessage(
          result.task.errorMessage ?? "音频生成失败，请稍后再试",
          retryAllowed ? undefined : result.task.retryBlockReason,
          result.task.errorCode,
          "audio",
        ));
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
          "audio",
          canvasId,
          id,
          persistedTaskId,
          accountId,
          fixtureScopeId,
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
        if (audioRecoveryControllerRef.current === controller) {
          audioRecoveryControllerRef.current = undefined;
        }
        if (audioRecoveryLifecycleRef.current === lifecycle) {
          audioRecoveryLifecycleRef.current = undefined;
        }
        if (pollingRun) endGenerationPollingRun(pollingRun);
      });
    return () => {
      controller.abort();
      if (audioRecoveryControllerRef.current === controller) {
        audioRecoveryControllerRef.current = undefined;
      }
      lifecycle?.abort("audio-recovery-unmounted");
      if (audioRecoveryLifecycleRef.current === lifecycle) {
        audioRecoveryLifecycleRef.current = undefined;
      }
      if (pollingRun) endGenerationPollingRun(pollingRun);
    };
  }, [
    canvasId,
    data.audioGenerationError,
    data.audioGenerationErrorCode,
    data.audioGenerationRetryAllowed,
    data.audioGenerationRetryBlockCode,
    data.audioGenerationRetryBlockReason,
    data.audioGenerationInputKey,
    data.audioGenerationOwnershipKey,
    data.audioGenerating,
    data.audioGenerationTaskId,
    data.workflowExecutionRunId,
    graphCommandPort,
    id,
    persistenceReady,
    recoveryEpoch,
    retryWakeEpoch,
    boundParameterProof.state,
    boundSourceProof,
    rawGenerationInputFingerprint,
    legacyRecoveryCatalogKey,
    lockedNodeIds,
  ]);

  useEffect(() => {
    const nextTitle = data.title ?? "Audio";
    setTitle(nextTitle);
  }, [data.title]);

  useEffect(() => {
    setPrompt(data.audioPrompt ?? "");
  }, [data.audioPrompt]);

  useEffect(() => {
    const source = data.audioSrc;
    if (
      !persistenceReady ||
      !source ||
      data.audioWaveform?.length ||
      waveformSourceAttempted.current === source
    ) {
      return;
    }

    waveformSourceAttempted.current = source;
    const controller = new AbortController();
    let active = true;

    void (async () => {
      let context: AudioContext | undefined;
      try {
        const response = await fetch(source, { signal: controller.signal });
        if (!response.ok) throw new Error("音频读取失败");
        context = new AudioContext();
        const decoded = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (!active) return;
        setViewAudioMetadata({
          duration: decoded.duration,
          source,
          waveform: waveform(decoded),
        });
      } catch (error) {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          waveformSourceAttempted.current = undefined;
        }
      } finally {
        if (context) await context.close();
      }
    })();

    return () => {
      active = false;
      controller.abort();
      if (waveformSourceAttempted.current === source) {
        waveformSourceAttempted.current = undefined;
      }
    };
  }, [
    data.audioSrc,
    data.audioWaveform?.length,
    persistenceReady,
  ]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const update = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const loadFile = async (file?: File) => {
    if (
      !file ||
      semanticEditBlocked ||
      canvasMutationPending ||
      uploadInFlight.current
    ) return;

    const extension =
      file.type === "audio/wav" || file.type === "audio/x-wav"
        ? "wav"
        : file.type === "audio/mpeg" || file.type === "audio/mp3"
          ? "mp3"
          : file.type === "audio/mp4" || file.type === "audio/x-m4a"
            ? "m4a"
            : file.type === "audio/aac" || file.type === "audio/x-aac"
              ? "aac"
              : file.type === "audio/ogg" ||
                  file.type === "application/ogg"
                ? "ogg"
                : undefined;
    const preflightError = file.size > 50 * 1_024 * 1_024
      ? "音频不能超过 50MiB"
      : !extension
        ? "当前音频格式不受支持"
        : "";
    if (preflightError) {
      const current = readCanvasNode(id);
      if (current && hasReadyAudioMedia(current)) {
        setTransientUploadError(preflightError);
      } else {
        const applied = applyViewUpdate((nodes) =>
          nodes.map((node) => node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...mediaUploadState("invalid", preflightError),
                },
              }
            : node)
        );
        if (!applied) return;
        setUploadError(preflightError);
        setUploadFailureMessage(preflightError);
      }
      return;
    }

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
            ...mediaUploadState("uploading", "音频正在上传"),
            audioGenerationError: undefined,
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
      const context = new AudioContext();
      let decoded: AudioBuffer;
      try {
        decoded = await context.decodeAudioData(await file.arrayBuffer());
      } finally {
        await context.close();
      }

      if (
        operation !== uploadOperation.current ||
        scope !== mediaAdoptionScopeRef.current ||
        !canvasUploadTargetStillCurrent(admittedBaseline, readCanvasNode(id)) ||
        !persistenceReadyLive.current ||
        controller.signal.aborted ||
        effectiveMediaInputState(readCanvasNode(id)?.data ?? {}) !== "uploading"
      ) return;

      requestedAssetId = `${crypto.randomUUID()}.${extension}`;
      const response = await fetch(`/api/audio-assets/${requestedAssetId}`, {
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
        byteSize?: number;
        contentType?: string;
        durationSeconds?: number;
        error?: string;
        storageBackend?: "local" | "oss";
        url: string;
      };
      if (!response.ok) {
        throw new Error(asset.error ?? "音频上传失败");
      }
      if (asset.assetId !== requestedAssetId) {
        throw new Error("服务端返回的音频素材标识不一致");
      }
      const metadata =
        Number.isFinite(asset.byteSize) &&
        asset.byteSize! > 0 &&
        typeof asset.contentType === "string" &&
        Number.isFinite(asset.durationSeconds) &&
        (asset.storageBackend === "local" || asset.storageBackend === "oss")
          ? {
              assetId: asset.assetId,
              byteSize: Number(asset.byteSize),
              contentType: asset.contentType,
              durationSeconds: Number(asset.durationSeconds),
              durationStatus: "ready" as const,
              kind: "audio" as const,
              storageBackend: asset.storageBackend,
            }
          : await fetchTrustedMediaMetadata("audio", asset.assetId, controller.signal);
      if (
        operation !== uploadOperation.current ||
        scope !== mediaAdoptionScopeRef.current ||
        !canvasUploadTargetStillCurrent(admittedBaseline, readCanvasNode(id)) ||
        !persistenceReadyLive.current ||
        controller.signal.aborted ||
        effectiveMediaInputState(readCanvasNode(id)?.data ?? {}) !== "uploading"
      ) {
        await discardUnadoptedAudioAsset(requestedAssetId);
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
            byteSize: metadata.byteSize,
            contentType: metadata.contentType,
            durationSeconds: metadata.durationSeconds,
            src: asset.url,
            storageBackend: metadata.storageBackend,
          },
          mediaKind: "audio",
          rollbackTarget: admittedBaseline,
          targetNodeId: id,
          update: (nodes) => nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                height: undefined,
                measured: undefined,
                width: undefined,
                data: {
                  ...node.data,
                  assetId: asset.assetId,
                  ...trustedMediaPatch(metadata),
                  audioDuration: metadata.durationSeconds ?? decoded.duration,
                  audioFileSize: metadata.byteSize,
                  audioFileName: file.name,
                  audioGeneratedResult: undefined,
                  audioGenerationContractFingerprint: undefined,
                  audioGenerationError: undefined,
                  audioGenerationErrorCode: undefined,
                  audioGenerationInputKey: undefined,
                  audioGenerationModelConfigurationRevision: undefined,
                  audioGenerationModelReleaseRevision: undefined,
                  audioGenerationOwnershipKey: undefined,
                  audioGenerationRetryAllowed: undefined,
                  audioGenerationRetryBlockCode: undefined,
                  audioGenerationRetryBlockReason: undefined,
                  audioGenerationTaskId: undefined,
                  audioGenerating: undefined,
                  audioResultChoices: undefined,
                  groupRunSuccessOwnershipKey: undefined,
                  groupRunSuccessInputFingerprint: undefined,
                  groupRunSuccessModelConfigurationRevision: undefined,
                  groupRunSuccessModelReleaseRevision: undefined,
                  groupRunSuccessResultKey: undefined,
                  groupRunSuccessTaskId: undefined,
                  workflowExecutionRunId: undefined,
                  audioSrc: asset.url,
                  audioWaveform: waveform(decoded),
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
        await discardUnadoptedAudioAsset(requestedAssetId);
        requestedAssetId = undefined;
        return;
      }
      setTransientUploadError("");
    } catch (error) {
      if (!adopted && requestedAssetId && shouldCompensate) {
        await discardUnadoptedAudioAsset(requestedAssetId);
        requestedAssetId = undefined;
      }
      if (operation !== uploadOperation.current) return;
      const message = error instanceof Error ? error.message : "音频上传失败";
      if (baseline && hasReadyAudioMedia(baseline)) {
        applyViewUpdate((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                audioGenerationError: baseline.data.audioGenerationError,
                inputViewState: baseline.data.inputViewState,
                inputViewStateReason: baseline.data.inputViewStateReason,
              },
            }
          : node));
        setTransientUploadError(message);
      } else {
        applyViewUpdate((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...mediaUploadState("invalid", message),
              },
            }
          : node));
        setUploadError(message);
        setUploadFailureMessage(message);
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

  const seek = (next: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Math.max(0, Math.min(duration, next));
    audio.currentTime =
      target === duration && duration > 0
        ? duration - Math.min(0.05, duration / 2)
        : target;
    setCurrentTime(target);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  };

  const applyLoadedAudioDuration = useCallback((nextDuration: number) => {
    const source = data.audioSrc;
    if (!source || !Number.isFinite(nextDuration) || nextDuration < 0) return;
    setViewAudioMetadata((current) => ({
      duration: nextDuration,
      source,
      waveform: current?.source === source ? current.waveform : undefined,
    }));
  }, [data.audioSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!persistenceReady || !data.audioSrc || !audio || audio.readyState < 1) {
      return;
    }
    applyLoadedAudioDuration(audio.duration);
  }, [applyLoadedAudioDuration, data.audioSrc, persistenceReady]);
  const semanticEditBlocked = Boolean(
    generating || (submitting && !retrying) || legacySubmissionBlocked ||
      lockedNodeIds.has(id),
  );
  const uploadControlBlocked =
    semanticEditBlocked || canvasMutationPending || uploading;

  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        minHeight={160}
        minWidth={280}
      />
      <EmptyMediaUploadToolbar
        disabled={uploadControlBlocked}
        label="上传音频"
        onUpload={() => {
          if (!uploadControlBlocked) inputRef.current?.click();
        }}
        testId="audio-empty-upload-toolbar"
        visible={singleNodeChrome && !data.audioSrc && !generating && !uploading}
      />
      <NodeToolbar
        className="media-node-toolbar audio-node-toolbar nodrag nopan nowheel"
        data-testid="audio-node-toolbar"
        isVisible={Boolean(data.audioSrc && singleNodeChrome && !uploading)}
        offset={12}
        position={Position.Top}
      >
        <button aria-label="音频颜色" data-tooltip="颜色" type="button">
          <span className="audio-node-color" />
        </button>
        <span className="audio-node-toolbar-divider" />
        <button aria-label="素材检查" data-tooltip="素材检查" type="button">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M16 6.2c-2.1 0-4.4-1-6-2.4-1.6 1.4-3.9 2.4-6 2.4v5c0 3 2.2 4.8 6 6 3.8-1.2 6-3 6-6Z" />
            <path d="m7.2 10.4 1.8 1.8 3.8-3.8" />
          </svg>
        </button>
        <button
          aria-label="下载"
          className="audio-node-toolbar-download"
          data-tooltip="下载"
          onClick={() => {
            const link = document.createElement("a");
            link.href = data.audioSrc!;
            link.download = data.audioFileName || `${title || "Audio"}.wav`;
            link.click();
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 4v12M7 11l5 5 5-5M4 19h16" />
          </svg>
        </button>
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
      </NodeToolbar>
      <NodeToolbar
        className="audio-creator nodrag nopan nowheel"
        data-testid="audio-creator"
        isVisible={Boolean(data.audioPromptReady && singleNodeChrome)}
        offset={16}
        position={Position.Bottom}
      >
        <UpstreamInputCards
          disabled={semanticEditBlocked}
          inputs={inputPreflight.inputs}
          onMove={(edgeId, direction) => {
            commitAudioInputEdgesMutation((edges) =>
              moveNodeInputEdge(edges, id, edgeId, direction)
            );
          }}
          onRemove={(edgeId) => {
            commitAudioInputEdgesMutation((edges) =>
              edges.filter((edge) => edge.id !== edgeId)
            );
          }}
          onRoleChange={(edgeId, role) => {
            commitAudioInputEdgesMutation((edges) =>
              edges.map((edge) => edge.id === edgeId
                ? { ...edge, data: { ...edge.data, inputRole: role } }
                : edge)
            );
          }}
          problems={inputProblems}
          roleOptions={(input) => availableNodeInputRoles({
            kind: input.kind,
            modelSchema: selectedAudioModel?.parameterSchema,
            parameters: audioSubmissionParameters,
            targetKind: "audio",
          })}
        />
        <GenerationAvailabilityNotice
          canvasId={canvasId}
          kind="audio"
          reason={audioModelUnavailableReason}
        />
        {hasCompatibleUpstreamText && (
          <div
            className="image-creator-final-prompt audio-creator-final-prompt"
            data-testid="audio-final-prompt"
          >
            <span>
              {promptControl.committedValue.trim()
                ? "母版 + 本节点补充"
                : "使用上游母版"}
            </span>
            <strong data-testid="audio-final-prompt-value">
              {inputPreflight.finalPrompt}
            </strong>
            {independentLyrics && (
              <span data-testid="audio-lyrics-source">
                歌词由音频参数独立提供，不并入最终Prompt
              </span>
            )}
          </div>
        )}
        <textarea
          aria-label="音频提示词"
          data-canvas-text-edit="graph"
          data-composition-active={promptControl.composing || undefined}
          data-testid="audio-creator-prompt"
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
                kind: "audio",
                nodeId: id,
              });
              audioRetryLifecycleRef.current?.abort("audio-input-editing");
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
                kind: "audio",
                nodeId: id,
              });
              audioRetryLifecycleRef.current?.abort("audio-input-editing");
              promptSemanticVersionRef.current += 1;
            }
            promptControl.compositionEnd(event.currentTarget.value);
          }}
          onCompositionStart={() => promptControl.compositionStart()}
          onKeyDown={(event) => {
            promptControl.keyDown(event);
          }}
          placeholder="描述你想要生成的音频"
          value={promptControl.value}
        />
        <div className="audio-creator-controls">
          <NodeModelControl
            capability="audio"
            disabled={semanticEditBlocked}
            onChange={(modelId, displayName) => {
              const nextModel = audioModels?.find((model) => model.id === modelId);
              const nextSchema = nextModel?.parameterSchema ?? defaultParameterSchema("audio");
              const nextParameters = nextModel
                ? defaultParameterValues(nextSchema)
                : {};
              const blocked = nextModel
                ? blockedModelSwitchProblem(resolveNodeInputs({
                    edges: canvasEdges,
                    modelSchema: nextSchema,
                    nodes: canvasNodes,
                    ownPrompt: promptControl.committedValue,
                    parameters: nextParameters,
                    targetId: id,
                    targetKind: "audio",
                  }), nextSchema)
                : undefined;
              if (blocked) {
                setModelSwitchProblem(`模型未切换：${blocked.message}`);
                return;
              }
              setModelSwitchProblem("");
              setServerInputProblems([]);
              commitAudioDataMutation((current) => ({
                ...clearAudioGenerationForSemanticChange(current),
                audioModelId: modelId,
                audioModelName: displayName,
                audioParameters: nextParameters,
              }));
            }}
            selectedId={audioModelSelection.selectedId}
            selectedName={audioModelSelection.displayName}
          />
          {selectedAudioModel && (
            <>
              {audioInputParameterKeys.length > 0 && (
                <NodeParameterControl
                  disabled={semanticEditBlocked}
                  keys={audioInputParameterKeys}
                  onChange={(key, value) => {
                    commitAudioDataMutation((current) => ({
                      ...clearAudioGenerationForSemanticChange(current),
                      audioParameters: { ...audioParameters, [key]: value },
                    }));
                  }}
                  onEditSessionStart={checkpoint}
                  schema={audioParameterSchema}
                  values={audioParameters}
                />
              )}
              <NodeParameterControl
                disabled={semanticEditBlocked}
                dialogKeys={[
                  ...audioTextParameterKeys,
                  ...audioMainParameterKeys.filter(
                    (key) => !audioTextParameterKeys.includes(key),
                  ),
                ]}
                keys={audioMainParameterKeys}
                onChange={(key, value) => {
                  commitAudioDataMutation((current) => ({
                    ...clearAudioGenerationForSemanticChange(current),
                    audioParameters: { ...audioParameters, [key]: value },
                  }));
                }}
                onEditSessionStart={checkpoint}
                schema={audioParameterSchema}
                values={audioParameters}
              />
            </>
          )}
          <span className="audio-creator-spacer" />
          <GenerationDurationHint label={finishedDurationLabel} />
          {selectedAudioModel && (
            <NodeParameterControl
              disabled={semanticEditBlocked}
              keys={audioCountParameterKeys}
              onChange={(key, value) => {
                commitAudioDataMutation((current) => ({
                  ...clearAudioGenerationForSemanticChange(current),
                  audioParameters: { ...audioParameters, [key]: value },
                }));
              }}
              onEditSessionStart={checkpoint}
              schema={audioParameterSchema}
              values={audioParameters}
            />
          )}
          <button
            aria-label={
              generating && cancelableTaskId && relayCancellationAvailable
                ? "取消生成"
                : generating
                  ? "Generating..."
                : submitting
                  ? "Submitting..."
                  : "Generate"
            }
            className="audio-creator-generate"
            data-tooltip={
              isFixture
                ? "验收页面不会调用真实生成"
                : !selectedAudioModel
                  ? "管理员尚未发布音频模型"
                : audioModelUnavailableReason
                  ? audioModelUnavailableReason
                : generating
                    ? relayCancellationAvailable
                      ? "停止本地等待；上游任务可能仍在运行"
                      : "Mureka 暂不支持安全取消，任务会继续保存结果"
                : canvasRevision === undefined
                      ? "画布正在保存"
                      : existingAudioTaskNeedsDecision
                        ? newGenerationBlockReason ||
                          "原任务已结束，当前暂不能重新生成"
                      : inputProblems[0]?.message
            }
            disabled={
              submitting ||
              legacySubmissionBlocked ||
              lockedNodeIds.has(id) ||
              canvasMutationPending ||
              (generating
                ? !cancelableTaskId || !relayCancellationAvailable
                : !inputPreflight.canSubmit ||
                  serverInputProblems.length > 0 ||
                  !selectedAudioModel ||
                  selectedAudioModel.generationAvailable === false ||
                  canvasRevision === undefined ||
                  existingAudioTaskNeedsDecision)
            }
            onClick={() =>
              void (generating ? cancelAudioGeneration() : generateAudio())
            }
            type="button"
          >
            {generating && cancelableTaskId && relayCancellationAvailable
              ? "×"
              : generating
                ? "…"
                : "↑"}
          </button>
        </div>
      </NodeToolbar>
      <Handle id="target" position={Position.Left} type="target">
        {!data.audioSrc && !generating && (
          <span className="node-handle-hit node-handle-hit-left">
            <span className="node-handle-plus" />
          </span>
        )}
      </Handle>
      <div
        className="canvas-node-title audio-node-title nodrag"
        data-parent-group-id={parentId}
      >
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path d="M7 14a3 3 0 1 1-2-2.82V5l9-2v8a3 3 0 1 1-2-2.82V5.5L7 6.6Z" />
        </svg>
        {singleNodeChrome ? (
          <input
            aria-label="Audio 标题"
            data-canvas-text-edit="graph"
            data-composition-active={titleControl.composing || undefined}
            data-testid="audio-node-title-input"
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
        className="audio-node-card"
        data-asset-id={data.assetId}
        data-generated-result={data.audioGeneratedResult || undefined}
        data-testid={`audio-node-${id}`}
      >
        {(transientUploadError || uploadError || nodeRecoveryCase) && (
          <div
            className={[
              "image-node-upload-error",
              "audio-node-upload-error",
              uploadErrorNeutral && !transientUploadError ? "neutral" : "",
            ].filter(Boolean).join(" ")}
            data-error-kind={nodeRecoveryCase ? "recovering" : audioNoticeTone}
            role={nodeRecoveryCase || audioNoticeTone !== "failed" ? "status" : "alert"}
          >
            <ProviderErrorNotice
              diagnostic={data.audioGenerationError}
              local={uploadFailureNotice}
              message={audioNoticeMessage}
              recoveryTaskId={data.audioGenerationTaskId}
              tone={audioNoticeTone}
            />
            {canReconcileAudio && (
              <GenerationReconcileControls
                busy={reconcileBusy || submitting}
                canRetry={showAudioRetry}
                onReconcile={() => void reconcileAudioResult()}
                onRetry={() => void retryAudioGeneration()}
                retryEnabled={retryGenerationEnabled}
              />
            )}
            {!canReconcileAudio && retryAvailable && (
              <button
                aria-label="重试生成"
                disabled={
                  submitting ||
                  generating ||
                  isFixture ||
                  !retryGenerationEnabled
                }
                onClick={() => void retryAudioGeneration()}
                type="button"
              >
                重试
              </button>
            )}
            {(pollingPausedTaskId ||
              (unverifiedRecoveryTaskId &&
                unverifiedRecoveryTaskId === data.audioGenerationTaskId)) && (
              <button
                aria-label="重新检查任务状态"
                onClick={recheckAudioTaskStatus}
                type="button"
              >
                重新检查
              </button>
            )}
          </div>
        )}
        {data.audioSrc ? (
          <>
            {(data.audioResultChoices?.length ?? 0) > 1 && (
              <div
                aria-label="生成音频版本"
                className="audio-result-choices nodrag nopan"
                role="group"
              >
                {data.audioResultChoices!.map((output, index) => (
                  <button
                    aria-label={`使用音频版本 ${index + 1}`}
                    aria-pressed={data.assetId === output.assetId}
                    key={output.assetId}
                    onClick={() => {
                      if (data.assetId === output.assetId) return;
                      checkpoint(false);
                      setCurrentTime(0);
                      setPlaying(false);
                      void mutateGraph(({ edges, nodes }) => ({
                        edges,
                        nodes: nodes.map((node) => node.id === id
                        ? {
                            ...node,
                            data: {
                              ...node.data,
                              ...trustedMediaPatch({
                                assetId: output.assetId,
                                byteSize: output.byteSize,
                                contentType: output.contentType,
                                durationSeconds: output.durationSeconds,
                                durationStatus: output.durationStatus,
                                kind: "audio",
                                mediaHeight: output.mediaHeight,
                                mediaWidth: output.mediaWidth,
                                storageBackend: output.storageBackend,
                              }),
                              assetId: output.assetId,
                              audioDuration: output.durationSeconds ?? undefined,
                              audioSrc: output.url,
                              audioWaveform: undefined,
                            },
                          }
                        : node),
                      }));
                    }}
                    type="button"
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            )}
            <audio
              className={mediaLoad.failed ? "media-load-obscured" : undefined}
              data-testid="audio-node-media"
              key={mediaLoad.key}
              onEnded={() => setPlaying(false)}
              onError={mediaLoad.markFailed}
              onLoadedMetadata={(event) => {
                mediaLoad.markLoaded();
                applyLoadedAudioDuration(event.currentTarget.duration);
              }}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime)
              }
              preload="metadata"
              ref={audioRef}
              src={mediaLoad.source}
            />
            <div className="audio-waveform">
              <div className="audio-waveform-bars" aria-hidden="true">
                {displayedWaveform.map((height, index) => (
                  <span key={index} style={{ height }} />
                ))}
              </div>
              <div
                className="audio-waveform-playhead"
                style={{
                  left: `${duration ? (currentTime / duration) * 100 : 0}%`,
                }}
              />
              <input
                aria-label="音频进度"
                max={duration}
                min="0"
                onChange={(event) => seek(Number(event.target.value))}
                step="0.1"
                type="range"
                value={Math.min(currentTime, duration)}
              />
            </div>
            <div className="audio-node-controls nodrag nopan">
              <button
                aria-label="后退 10 秒"
                onClick={() => seek(currentTime - 10)}
                type="button"
              >
                «
              </button>
              <button
                aria-label={playing ? "暂停音频" : "播放音频"}
                className="audio-node-play"
                onClick={() => void togglePlayback()}
                type="button"
              >
                {playing ? "Ⅱ" : "▶"}
              </button>
              <button
                aria-label="前进 10 秒"
                onClick={() => seek(currentTime + 10)}
                type="button"
              >
                »
              </button>
            </div>
            <span className="audio-node-time">
              {clock(
                duration > 0 && duration - currentTime <= 0.051
                  ? duration
                  : currentTime,
              )}/{clock(duration)}
            </span>
              <button
                aria-label="替换"
                className="audio-node-replace nodrag nopan"
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
          <div aria-hidden="true" className="audio-node-empty-action">
            <svg aria-hidden="true" viewBox="0 0 48 48">
              <path d="M18 34a7 7 0 1 1-5-6.7V13l24-5v19a7 7 0 1 1-5-6.7v-6l-14 3Z" />
            </svg>
          </div>
        ) : null}
        {data.audioSrc && mediaLoad.failed && (
          <MediaLoadFallback
            kind="音频"
            onReload={mediaLoad.reload}
            onReplace={() => {
              if (!uploadControlBlocked) inputRef.current?.click();
            }}
            replaceDisabled={uploadControlBlocked}
          />
        )}
        <LegacyTerminalGenerationNotice state={legacyState} />
        {(displayAudioGenerating || uploading) && (
          <div
            aria-label={uploading ? "音频上传中" : "音频生成中"}
            className="video-node-generating audio-node-generating"
            data-testid="audio-node-generating"
            role="status"
          >
            <span
              className="image-node-generating-background video-node-generating-background"
              data-testid="audio-node-generating-background"
            />
            <span
              className="image-node-loading-grid video-node-loading-grid"
              data-grid-columns="18"
              data-grid-rows="12"
              data-testid="audio-node-loading-grid"
            />
          </div>
        )}
        <input
          accept="audio/*"
          data-testid="audio-upload-input"
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
    </>
  );
}
export const AudioNode = memo(AudioNodeImpl);
