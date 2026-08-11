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
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import { NODE_DEFAULT_SIZES } from "./mediaGeometry";
import { NodeModelControl } from "./NodeModelControl";
import { NodeParameterControl } from "./NodeParameterControl";
import { EmptyMediaUploadToolbar } from "./EmptyMediaUploadToolbar";
import { generationOwnershipKey, type ProbeNodeType } from "./ProbeNode";
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
  retryGenerationTask,
  waitForGenerationTask,
  type GenerationTaskRetryAcceptedDetail,
  type GenerationTaskSummary,
} from "../generation/generationTasks";
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
import {
  fetchTrustedMediaMetadata,
  mediaUploadState,
  trustedMediaPatch,
} from "./mediaInputMetadata";

type AudioPollingRun = {
  inputKey?: string;
  ownershipKey?: string;
  taskId: string;
  token: symbol;
};

function audioTaskMatchesNode(
  task: GenerationTaskSummary,
  canvasId: string,
  nodeId: string,
  taskId = task.id,
) {
  return task.id === taskId &&
    task.canvasId === canvasId &&
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
    (node.data.inputState === undefined || node.data.inputState === "ready"),
  );
}

function restoreAudioUploadBaseline(
  node: ProbeNodeType,
  baseline: ProbeNodeType,
) {
  return {
    ...node,
    data: {
      ...node.data,
      assetId: baseline.data.assetId,
      audioDuration: baseline.data.audioDuration,
      audioFileName: baseline.data.audioFileName,
      audioFileSize: baseline.data.audioFileSize,
      audioGenerationError: baseline.data.audioGenerationError,
      audioSrc: baseline.data.audioSrc,
      audioWaveform: baseline.data.audioWaveform,
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
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadInFlight = useRef(false);
  const uploadOperation = useRef(0);
  const waveformSourceAttempted = useRef<string | undefined>(undefined);
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
  const generating = Boolean(data.audioGenerating);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [playing, setPlaying] = useState(false);
  const [prompt, setPrompt] = useState(data.audioPrompt ?? "");
  const [title, setTitle] = useState(data.title ?? "Audio");
  const [uploadError, setUploadError] = useState(
    visibleGenerationError(data.audioGenerationError),
  );
  const [transientUploadError, setTransientUploadError] = useState("");
  const [retryTaskId, setRetryTaskId] = useState<string>();
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
  const [unverifiedRecoveryTaskId, setUnverifiedRecoveryTaskId] =
    useState<string>();
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const generationPollingRunRef = useRef<AudioPollingRun | undefined>(undefined);
  const liveGenerationInputKeyRef = useRef<string | undefined>(undefined);
  const liveGenerationOwnershipKeyRef = useRef<string | undefined>(undefined);
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const [retryWakeEpoch, setRetryWakeEpoch] = useState(0);
  const uploading = data.inputState === "uploading";
  const beginGenerationPollingRun = (
    taskId: string,
    inputKey?: string,
    ownershipKey?: string,
  ): AudioPollingRun => {
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
        "audio",
        canvasId,
        id,
        data.audioGenerationTaskId,
        accountId,
      );
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  audioGenerationError: undefined,
                  audioGenerationErrorCode: undefined,
                  audioGenerationInputKey: undefined,
                  audioGenerationOwnershipKey: undefined,
                  audioGenerating: false,
                  audioGenerationRetryAllowed: undefined,
                  audioGenerationRetryBlockCode: undefined,
                  audioGenerationRetryBlockReason: undefined,
                  audioGenerationTaskId: undefined,
                  audioPrompt: nextPrompt,
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
  const duration = data.audioDuration ?? 0;
  const inputPreflight = resolveNodeInputs({
    edges: canvasEdges,
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
    modelId: selectedAudioModelId,
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
        role: typeof edge?.data?.inputRole === "string"
          ? edge.data.inputRole
          : defaultNodeInputRole(input.kind, "audio"),
        source: input.sourceNodeId,
        sourceKind: input.kind,
        src: input.kind === "text" ? undefined : input.preview,
        status: input.state,
        text: input.kind === "text" ? input.text : undefined,
      };
    });
  const effectiveGenerationInputFingerprint = generationOwnershipKey({
    modelId: selectedAudioModelId,
    parameters: selectedAudioModel ? audioParameters : data.audioParameters,
    prompt: promptControl.committedValue,
    upstream: generationOwnershipUpstream,
  });
  const rawGenerationInputFingerprint = generationOwnershipKey({
    // Once a task is ownership-bound, catalog changes must not reinterpret its
    // saved model snapshot. Before admission, use the effective values that are
    // materialized and ACKed on the canvas below.
    modelId: data.audioGenerationOwnershipKey
      ? data.audioModelId
      : selectedAudioModelId,
    parameters: data.audioGenerationOwnershipKey
      ? data.audioParameters
      : selectedAudioModel
        ? audioParameters
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
    data.audioGenerationInputKey === audioGenerationInputKey &&
    (!data.audioGenerationOwnershipKey ||
      data.audioGenerationOwnershipKey === rawGenerationInputFingerprint) &&
    data.audioGenerationRetryAllowed === true &&
    selectedAudioModel &&
    selectedAudioModel.generationAvailable !== false,
  );

  const clearAudioIntentAfterDurableTerminalPatch = (taskId: string) => {
    void (async () => {
      try {
        await flushCanvasSave();
        clearGenerationSubmissionIntent(
          "audio",
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
  const relayCancellationAvailable =
    selectedAudioModel?.providerProtocol === "media-generate";

  useEffect(() => {
    setModelSwitchProblem("");
  }, [canvasEdges]);

  useEffect(() => {
    setUploadError(
      data.inputState === "invalid" && data.inputStateReason
        ? data.inputStateReason
        : visibleGenerationError(data.audioGenerationError),
    );
  }, [data.audioGenerationError, data.inputState, data.inputStateReason]);

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
    generationPollingRunRef.current = undefined;
    setActiveTaskId(undefined);
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setRetryTaskId(undefined);
    setServerInputProblems([]);
    setUploadError("");
    clearGenerationSubmissionIntent("audio", canvasId, id, undefined, accountId);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            audioGenerationError: undefined,
            audioGenerationErrorCode: undefined,
            audioGenerationInputKey: undefined,
            audioGenerationOwnershipKey: undefined,
            audioGenerating: false,
            audioGenerationRetryAllowed: undefined,
            audioGenerationRetryBlockCode: undefined,
            audioGenerationRetryBlockReason: undefined,
            audioGenerationTaskId: undefined,
          },
        }
      : node));
  }, [
    accountId,
    canvasId,
    data.audioGenerating,
    data.audioGenerationInputKey,
    data.audioGenerationOwnershipKey,
    data.audioGenerationTaskId,
    id,
    persistenceReady,
    rawGenerationInputFingerprint,
    setNodes,
  ]);

  const persistAudioGenerationFailure = (
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
      "audio",
    );
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            audioGenerationError: visibleMessage,
            audioGenerationErrorCode: errorCode,
            audioGenerationInputKey:
              generationInputKey ?? node.data.audioGenerationInputKey,
            audioGenerationOwnershipKey:
              generationOwnershipKey ?? node.data.audioGenerationOwnershipKey,
            audioGenerating: false,
            audioGenerationRetryAllowed: retryAllowed,
            audioGenerationRetryBlockCode: retryBlockCode,
            audioGenerationRetryBlockReason: retryBlockReason,
            audioGenerationTaskId: taskId,
          },
        }
      : node));
    setUploadError(visibleMessage);
    setRetryTaskId(retryAllowed ? taskId : undefined);
    clearAudioIntentAfterDurableTerminalPatch(taskId);
  };

  const persistAudioGenerationCancellation = (
    taskId: string,
    message: string,
  ) => {
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            audioGenerationError: message,
            audioGenerationErrorCode: undefined,
            audioGenerationInputKey: undefined,
            audioGenerationOwnershipKey: undefined,
            audioGenerating: false,
            audioGenerationRetryAllowed: undefined,
            audioGenerationRetryBlockCode: undefined,
            audioGenerationRetryBlockReason: undefined,
            audioGenerationTaskId: undefined,
          },
        }
      : node));
    setUploadError(message);
    setRetryTaskId(undefined);
    clearAudioIntentAfterDurableTerminalPatch(taskId);
  };

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
      !data.audioSrc ||
      data.mediaMetadataSource === "server" ||
      data.inputState === "uploading" ||
      data.inputState === "invalid"
    ) return;
    const controller = new AbortController();
    void fetchTrustedMediaMetadata("audio", data.assetId, controller.signal)
      .then((metadata) => {
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...trustedMediaPatch(metadata),
                audioDuration: metadata.durationSeconds ?? node.data.audioDuration,
                audioFileSize: metadata.byteSize,
              },
            }
          : node));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const message = error instanceof Error
          ? error.message
          : "服务端无法确认音频素材信息";
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
    data.audioSrc,
    data.inputState,
    data.mediaMetadataSource,
    id,
    persistenceReady,
    setNodes,
  ]);

  const applyGeneratedAudio = async (
    task: GenerationTaskSummary,
    cleanPrompt: string,
    run: AudioPollingRun,
  ) => {
    if (
      !ownsGenerationPollingRun(run) ||
      !audioTaskMatchesNode(task, canvasId, id, run.taskId)
    ) return false;
    if (task.state !== "success" || !task.resultAssetId || !task.resultUrl) {
      throw new Error("音频结果不完整");
    }
    checkpoint(false);
    waveformSourceAttempted.current = undefined;
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
                audioModelId:
                  audioModelSelection.selectedId ?? node.data.audioModelId,
                audioModelName:
                  audioModelSelection.displayName ??
                  node.data.audioModelName ??
                  "Mureka",
                audioPrompt: cleanPrompt,
                audioSrc: task.resultUrl,
                audioWaveform: undefined,
              },
            }
          : node,
      ),
    );
    await flushCanvasSave();
    clearGenerationSubmissionIntent("audio", canvasId, id, task.id, accountId);
    return true;
  };

  const generateAudio = async (): Promise<NodeGenerationOutcome> => {
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
    ) return { status: "skipped" };
    setUploadError("");
    setServerInputProblems([]);
    setRetryTaskId(undefined);
    setSubmitting(true);
    let submittedTaskId: string | undefined;
    let pollingRun: AudioPollingRun | undefined;
    let bindingPersisted = false;
    const requestedGenerationInputKey = audioGenerationInputKey;
    const requestedGenerationOwnershipKey =
      effectiveGenerationInputFingerprint;
    const requestedModelId = selectedAudioModelId;
    const requestedModelName = audioModelSelection.displayName;
    const requestedParameters = { ...audioParameters };
    try {
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              audioModelId: requestedModelId,
              audioModelName: requestedModelName,
              audioParameters: requestedParameters,
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
        "audio",
        {
          ...audioGenerationRequestInput,
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
          "audio",
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
              audioGenerationError: undefined,
              audioGenerationErrorCode: undefined,
              audioGenerationInputKey,
              audioGenerationOwnershipKey:
                persistedGenerationOwnershipKey ??
                requestedGenerationOwnershipKey,
              audioGenerating: true,
              audioGenerationRetryAllowed: undefined,
              audioGenerationRetryBlockCode: undefined,
              audioGenerationRetryBlockReason: undefined,
              audioGenerationTaskId: submitted.id,
              audioModelId: requestedModelId,
              audioModelName: requestedModelName,
              audioParameters: requestedParameters,
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
          status: "failed",
        };
      }
      setSubmitting(false);
      let task: Awaited<ReturnType<typeof waitForGenerationTask>>;
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
        persistAudioGenerationCancellation(
          task.id,
          task.errorMessage ?? "音频生成已取消",
        );
        return {
          message: friendlyGenerationMessage(
            task.errorMessage ?? "音频生成已取消",
            "audio",
          ),
          status: "failed",
        };
      }
      if (task.state !== "success") {
        persistAudioGenerationFailure(
          task.id,
          friendlyGenerationMessage(task.errorMessage, "audio"),
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return {
          message: friendlyGenerationMessage(task.errorMessage, "audio"),
          status: "failed",
        };
      }
      await applyGeneratedAudio(
        task,
        promptControl.committedValue.trim(),
        pollingRun,
      );
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
        : generationMessageFallback("audio");
      const friendly = friendlyGenerationMessage(message, "audio");
      if (
        submittedTaskId &&
        pollingRun &&
        ownsGenerationPollingRun(pollingRun)
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
        persistAudioGenerationFailure(
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
        setUploadError(friendly);
      }
      return { message: friendly, status: "failed" };
    } finally {
      setSubmitting(false);
      if (pollingRun) endGenerationPollingRun(pollingRun);
    }
  };

  const runWorkflowNode = async (): Promise<NodeRunResult> => {
    const before = getNodes().find((node) => node.id === id);
    if (!before) return { status: "failed" };
    if (isFixture || canvasRevision === undefined) {
      return { status: "skipped" };
    }
    if (
      before.data.audioGenerating === true ||
      before.data.inputState === "uploading"
    ) {
      return { message: "节点正在生成中", status: "busy" };
    }
    const outcome = await generateAudio();
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
          "audio",
        ),
      }),
    [id, registerWorkflowNode, waitForCanvasRevision],
  );

  const retryAudioGeneration = async () => {
    if (
      !retryTaskId ||
      !retryAvailable ||
      isFixture ||
      !retryGenerationEnabled ||
      generating ||
      submitting
    ) return;
    const taskId = retryTaskId;
    const requestedGenerationInputKey = audioGenerationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    setSubmitting(true);
    let retryAccepted = false;
    let pollingRun: AudioPollingRun | undefined;
    try {
      await retryGenerationTask({
        canvasId,
        generationInputKey: requestedGenerationInputKey,
        kind: "audio",
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
      setServerInputProblems([]);
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              audioGenerationError: undefined,
              audioGenerationErrorCode: undefined,
              audioGenerationInputKey,
              audioGenerationOwnershipKey: requestedGenerationOwnershipKey,
              audioGenerating: true,
              audioGenerationRetryAllowed: undefined,
              audioGenerationRetryBlockCode: undefined,
              audioGenerationRetryBlockReason: undefined,
              audioGenerationTaskId: taskId,
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
        persistAudioGenerationCancellation(
          task.id,
          task.errorMessage ?? "音频生成已取消",
        );
        return;
      }
      if (task.state !== "success") {
        persistAudioGenerationFailure(
          task.id,
          task.errorMessage ?? "音频生成失败，请稍后再试",
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return;
      }
      await applyGeneratedAudio(
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
        persistAudioGenerationFailure(
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
      if (pollingRun) endGenerationPollingRun(pollingRun);
      setSubmitting(false);
    }
  };

  const resumeAudioPolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setUploadError("");
    const pollingRun = beginGenerationPollingRun(
      taskId,
      data.audioGenerationInputKey,
      data.audioGenerationOwnershipKey ?? rawGenerationInputFingerprint,
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
        persistAudioGenerationCancellation(
          task.id,
          task.errorMessage ?? "音频生成已取消",
        );
        return;
      }
      if (task.state !== "success") {
        persistAudioGenerationFailure(
          task.id,
          friendlyGenerationMessage(task.errorMessage, "audio", task.errorCode),
          task.errorCode,
          safelyRetryableGenerationTask(task),
          task.retryBlockCode,
          task.retryBlockReason,
        );
        return;
      }
      await applyGeneratedAudio(
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
        error instanceof Error ? error.message : "音频生成失败，请稍后再试",
      );
    } finally {
      endGenerationPollingRun(pollingRun);
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
    if (!activeTaskId || !relayCancellationAvailable) return;
    const taskId = activeTaskId;
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
      persistAudioGenerationCancellation(
        task.id,
        task.errorMessage ?? "已停止本地等待，上游任务可能仍在运行",
      );
      endGenerationPollingRun(pollingRun);
    } catch (error) {
      if (!pollingRun || !ownsGenerationPollingRun(pollingRun)) return;
      setUploadError(error instanceof Error ? error.message : "取消生成失败");
    }
  };

  useEffect(() => {
    if (!persistenceReady || isFixture || generationPollingRunRef.current) return;
    const persistedTaskId = data.audioGenerationTaskId;
    const persistedInputKey = data.audioGenerationInputKey;
    const persistedOwnershipKey = data.audioGenerationOwnershipKey;
    const catalogReady = audioModelSelection.status === "ready" &&
      Boolean(selectedAudioModel);
    const controller = new AbortController();
    let pollingRun: AudioPollingRun | undefined;
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
            "audio",
            canvasId,
            id,
            persistedTaskId,
            accountId,
          );
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.audioGenerationTaskId === persistedTaskId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    audioGenerationError: undefined,
                    audioGenerationErrorCode: undefined,
                    audioGenerationInputKey: undefined,
                    audioGenerationOwnershipKey: undefined,
                    audioGenerating: false,
                    audioGenerationRetryAllowed: undefined,
                    audioGenerationRetryBlockCode: undefined,
                    audioGenerationRetryBlockReason: undefined,
                    audioGenerationTaskId: undefined,
                  },
                }
              : node
          ));
          return;
        }
        if (!persistedOwnershipKey) {
          if (!catalogReady) return;
          if (!persistedInputKey || persistedInputKey !== audioGenerationInputKey) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
            clearGenerationSubmissionIntent(
              "audio",
              canvasId,
              id,
              persistedTaskId,
              accountId,
            );
            setNodes((nodes) => nodes.map((node) =>
              node.id === id && node.data.audioGenerationTaskId === persistedTaskId
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      audioGenerationError: undefined,
                      audioGenerationErrorCode: undefined,
                      audioGenerationInputKey: undefined,
                      audioGenerationOwnershipKey: undefined,
                      audioGenerating: false,
                      audioGenerationRetryAllowed: undefined,
                      audioGenerationRetryBlockCode: undefined,
                      audioGenerationRetryBlockReason: undefined,
                      audioGenerationTaskId: undefined,
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
          "audio",
          canvasId,
          id,
          controller.signal,
          selectedAudioModel ? audioGenerationRequestInput : undefined,
          accountId,
          { generationOwnershipKey: rawGenerationInputFingerprint },
        );
        recoveredIntent = Boolean(task);
        if (!task && data.audioGenerating) {
          if (!data.audioGenerationOwnershipKey && !catalogReady) return;
          const matches = (await listGenerationTasks(canvasId, controller.signal))
            .filter((candidate) =>
              candidate.kind === "audio" && candidate.nodeId === id
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
          "audio",
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
        if (!legacyInputKey || legacyInputKey !== audioGenerationInputKey) {
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
          );
          return;
        }
      }
      if (!audioTaskMatchesNode(task, canvasId, id, persistedTaskId ?? task.id)) {
        if (persistedTaskId) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
          clearGenerationSubmissionIntent(
            "audio",
            canvasId,
            id,
            persistedTaskId,
            accountId,
          );
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.audioGenerationTaskId === persistedTaskId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    audioGenerationError: undefined,
                    audioGenerationErrorCode: undefined,
                    audioGenerationInputKey: undefined,
                    audioGenerationOwnershipKey: undefined,
                    audioGenerating: false,
                    audioGenerationRetryAllowed: undefined,
                    audioGenerationRetryBlockCode: undefined,
                    audioGenerationRetryBlockReason: undefined,
                    audioGenerationTaskId: undefined,
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
        await applyGeneratedAudio(
          task,
          promptControl.committedValue.trim(),
          pollingRun,
        );
        return;
      }
      if (task.state === "failed") {
        const retainPersistedBlock =
          !recoveredIntent && data.audioGenerationRetryAllowed === false;
        persistAudioGenerationFailure(
          task.id,
          retainPersistedBlock && data.audioGenerationError
            ? data.audioGenerationError
            : task.errorMessage ?? "音频生成失败，请稍后再试",
          retainPersistedBlock ? data.audioGenerationErrorCode : task.errorCode,
          retainPersistedBlock ? false : safelyRetryableGenerationTask(task),
          retainPersistedBlock
            ? data.audioGenerationRetryBlockCode
            : task.retryBlockCode,
          retainPersistedBlock
            ? data.audioGenerationRetryBlockReason
            : task.retryBlockReason,
          persistedInputKey ?? task.generationInputKey,
          recoveredOwnershipKey,
        );
        return;
      }
      if (task.state === "cancelled") {
        persistAudioGenerationCancellation(
          task.id,
          task.errorMessage ?? "音频生成已取消",
        );
        return;
      }
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              audioGenerationError: undefined,
              audioGenerationErrorCode: undefined,
              audioGenerationInputKey:
                persistedInputKey ?? task.generationInputKey,
              audioGenerationOwnershipKey: recoveredOwnershipKey,
              audioGenerating: true,
              audioGenerationRetryAllowed: undefined,
              audioGenerationRetryBlockCode: undefined,
              audioGenerationRetryBlockReason: undefined,
              audioGenerationTaskId: task.id,
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
        !audioTaskMatchesNode(finished, canvasId, id, task.id)
      ) return;
      if (finished.state === "success") {
        await applyGeneratedAudio(
          finished,
          promptControl.committedValue.trim(),
          pollingRun,
        );
      } else if (finished.state === "failed") {
        persistAudioGenerationFailure(
          finished.id,
          finished.errorMessage ?? "音频生成失败，请稍后再试",
          finished.errorCode,
          safelyRetryableGenerationTask(finished),
          finished.retryBlockCode,
          finished.retryBlockReason,
        );
      } else if (finished.state === "cancelled") {
        persistAudioGenerationCancellation(
          finished.id,
          finished.errorMessage ?? "音频生成已取消",
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
    data.audioGenerationError,
    data.audioGenerationErrorCode,
    data.audioGenerationRetryAllowed,
    data.audioGenerationRetryBlockCode,
    data.audioGenerationRetryBlockReason,
    data.audioGenerationInputKey,
    data.audioGenerationOwnershipKey,
    data.audioGenerating,
    data.audioGenerationTaskId,
    id,
    persistenceReady,
    recoveryEpoch,
    retryWakeEpoch,
    rawGenerationInputFingerprint,
    legacyRecoveryCatalogKey,
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
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    audioDuration: decoded.duration,
                    audioWaveform: waveform(decoded),
                  },
                }
              : node,
          ),
        );
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
    id,
    persistenceReady,
    setNodes,
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
            ...mediaUploadState("uploading", "音频正在上传"),
            audioGenerationError: undefined,
          },
        }
      : node));
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
        !persistenceReadyLive.current ||
        controller.signal.aborted ||
        getNode(id)?.data.inputState !== "uploading"
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
      if (!extension) throw new Error("当前音频格式不受支持");
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
        !persistenceReadyLive.current ||
        controller.signal.aborted ||
        getNode(id)?.data.inputState !== "uploading"
      ) {
        await discardUnadoptedAudioAsset(requestedAssetId);
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
                  ...NODE_DEFAULT_SIZES.audio,
                },
                width: undefined,
                data: {
                  ...node.data,
                  assetId: asset.assetId,
                  ...trustedMediaPatch(metadata),
                  audioDuration: metadata.durationSeconds ?? decoded.duration,
                  audioFileSize: metadata.byteSize,
                  audioFileName: file.name,
                  audioGenerationError: undefined,
                  audioSrc: asset.url,
                  audioWaveform: waveform(decoded),
                },
              }
            : node,
        ),
      );
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
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? restoreAudioUploadBaseline(node, baseline)
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
      URL.revokeObjectURL(localUrl);
      if (operation === uploadOperation.current) {
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
    if (!Number.isFinite(nextDuration) || nextDuration < 0) return;
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id !== id || node.data.audioDuration === nextDuration
          ? node
          : {
              ...node,
              data: { ...node.data, audioDuration: nextDuration },
            },
      ),
    );
  }, [id, setNodes]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!persistenceReady || !data.audioSrc || !audio || audio.readyState < 1) {
      return;
    }
    applyLoadedAudioDuration(audio.duration);
  }, [applyLoadedAudioDuration, data.audioSrc, persistenceReady]);

  return (
    <>
      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        minHeight={160}
        minWidth={280}
        onResizeStart={() => checkpoint()}
      />
      <EmptyMediaUploadToolbar
        label="上传音频"
        onUpload={() => inputRef.current?.click()}
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
          placeholder="描述你想要生成的音频"
          value={promptControl.value}
        />
        <div className="audio-creator-controls">
          <NodeModelControl
            capability="audio"
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
              checkpoint();
              setNodes((nodes) =>
                nodes.map((node) =>
                  node.id === id
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          audioModelId: modelId,
                          audioModelName: displayName,
                          audioParameters: nextParameters,
                        },
                      }
                    : node,
                ),
              );
            }}
            selectedId={audioModelSelection.selectedId}
            selectedName={audioModelSelection.displayName}
          />
          {selectedAudioModel && (
            <>
              {audioInputParameterKeys.length > 0 && (
                <NodeParameterControl
                  keys={audioInputParameterKeys}
                  onChange={(key, value) => {
                    setNodes((nodes) => nodes.map((node) => node.id === id
                      ? { ...node, data: { ...node.data, audioParameters: { ...audioParameters, [key]: value } } }
                      : node));
                  }}
                  onEditSessionStart={checkpoint}
                  schema={audioParameterSchema}
                  values={audioParameters}
                />
              )}
              <NodeParameterControl
                dialogKeys={[
                  ...audioTextParameterKeys,
                  ...audioMainParameterKeys.filter(
                    (key) => !audioTextParameterKeys.includes(key),
                  ),
                ]}
                keys={audioMainParameterKeys}
                onChange={(key, value) => {
                  setNodes((nodes) => nodes.map((node) => node.id === id
                    ? { ...node, data: { ...node.data, audioParameters: { ...audioParameters, [key]: value } } }
                    : node));
                }}
                onEditSessionStart={checkpoint}
                schema={audioParameterSchema}
                values={audioParameters}
              />
            </>
          )}
          <span className="audio-creator-spacer" />
          {selectedAudioModel && (
            <NodeParameterControl
              keys={audioCountParameterKeys}
              onChange={(key, value) => {
                setNodes((nodes) => nodes.map((node) => node.id === id
                  ? { ...node, data: { ...node.data, audioParameters: { ...audioParameters, [key]: value } } }
                  : node));
              }}
              onEditSessionStart={checkpoint}
              schema={audioParameterSchema}
              values={audioParameters}
            />
          )}
          <button
            aria-label={
              generating && activeTaskId && relayCancellationAvailable
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
                      : inputProblems[0]?.message
            }
            disabled={
              submitting ||
              (generating
                ? !activeTaskId || !relayCancellationAvailable
                : !inputPreflight.canSubmit ||
                  serverInputProblems.length > 0 ||
                  !selectedAudioModel ||
                  selectedAudioModel.generationAvailable === false ||
                  canvasRevision === undefined)
            }
            onClick={() =>
              void (generating ? cancelAudioGeneration() : generateAudio())
            }
            type="button"
          >
            {generating && activeTaskId && relayCancellationAvailable
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
      <div className="audio-node-title nodrag">
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
          <span>{titleControl.committedValue}</span>
        )}
      </div>
      <div
        className="audio-node-card"
        data-asset-id={data.assetId}
        data-generated-result={data.audioGeneratedResult || undefined}
        data-testid={`audio-node-${id}`}
      >
        {(transientUploadError || uploadError) && (
          <div
            className="image-node-upload-error audio-node-upload-error"
            role="alert"
          >
            <span className="provider-error-summary">
              {transientUploadError || uploadError}
            </span>
            {retryAvailable && (
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
            <audio
              data-testid="audio-node-media"
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => {
                if (persistenceReady) {
                  applyLoadedAudioDuration(event.currentTarget.duration);
                }
              }}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onTimeUpdate={(event) =>
                setCurrentTime(event.currentTarget.currentTime)
              }
              preload="metadata"
              ref={audioRef}
              src={data.audioSrc}
            />
            <div className="audio-waveform">
              <div className="audio-waveform-bars" aria-hidden="true">
                {(data.audioWaveform ?? []).map((height, index) => (
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
              onClick={() => inputRef.current?.click()}
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
        {(generating || uploading) && (
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
