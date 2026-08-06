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
import { useEffect, useRef, useState } from "react";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import { NODE_DEFAULT_SIZES } from "./mediaGeometry";
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
import {
  friendlyGenerationMessage,
  generationMessageFallback,
} from "../generation/friendlyGenerationMessage";
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

export function AudioNode({ data, id, selected }: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const uploadBaseline = useRef<ProbeNodeType | undefined>(undefined);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const uploadInFlight = useRef(false);
  const uploadOperation = useRef(0);
  const waveformSourceAttempted = useRef<string | undefined>(undefined);
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
  } = useGenerationCanvas();
  const audioModelSelection = usePublishedModelSelection(
    "audio",
    data.audioModelId,
    data.audioModelName,
  );
  const audioModels = audioModelSelection.models;
  const selectedAudioModel = audioModelSelection.model;
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
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const uploading = data.inputState === "uploading";
  const promptControl = useCompositionSafeText({
    onCommit: (nextPrompt) => {
      setPrompt(nextPrompt);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, audioPrompt: nextPrompt } }
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
    modelId: selectedAudioModel?.id,
    ownPrompt: promptControl.committedValue,
    parameters: audioSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  });
  const audioGenerationRequestInput = {
    canvasId,
    canvasRevision,
    inputSchemaVersion: 1 as const,
    inputs: inputPreflight.snapshot,
    model: selectedAudioModel?.id,
    nodeId: id,
    ownPrompt: promptControl.committedValue,
    parameters: audioSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  };
  const stableGenerationInputKey = useRef<string | undefined>(undefined);
  const retryAvailable = Boolean(
    retryTaskId &&
    data.audioGenerationInputKey === audioGenerationInputKey &&
    data.audioGenerationRetryAllowed === true &&
    selectedAudioModel &&
    selectedAudioModel.generationAvailable !== false,
  );
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
    if (canvasRevision === undefined) return;
    const previous = stableGenerationInputKey.current;
    stableGenerationInputKey.current = audioGenerationInputKey;
    const persistedMismatch = Boolean(
      data.audioGenerationInputKey &&
      data.audioGenerationInputKey !== audioGenerationInputKey,
    );
    if (!persistedMismatch && (
      previous === undefined || previous === audioGenerationInputKey
    )) return;
    setRetryTaskId(undefined);
    setActiveTaskId(undefined);
    setServerInputProblems([]);
    if (data.audioGenerationTaskId || data.audioGenerationInputKey) {
      clearGenerationSubmissionIntent(
        "audio",
        canvasId,
        id,
        data.audioGenerationTaskId,
        accountId,
      );
      setUploadError("");
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              audioGenerationError: undefined,
              audioGenerationErrorCode: undefined,
              audioGenerationInputKey: undefined,
              audioGenerationRetryAllowed: undefined,
              audioGenerationRetryBlockCode: undefined,
              audioGenerationRetryBlockReason: undefined,
              audioGenerationTaskId: undefined,
            },
          }
        : node));
    }
  }, [
    audioGenerationInputKey,
    canvasId,
    canvasRevision,
    data.audioGenerationInputKey,
    data.audioGenerationTaskId,
    id,
    setNodes,
  ]);

  const persistAudioGenerationFailure = (
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
    );
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            audioGenerationError: visibleMessage,
            audioGenerationErrorCode: errorCode,
            audioGenerationInputKey,
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
    setActiveTaskId(undefined);
    clearGenerationSubmissionIntent("audio", canvasId, id, taskId, accountId);
  };

  useEffect(() => {
    if (data.inputState !== "uploading" || uploadInFlight.current) return;
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
    setNodes,
  ]);

  const applyGeneratedAudio = (
    task: GenerationTaskSummary,
    cleanPrompt: string,
  ) => {
    if (!task.resultAssetId || !task.resultUrl) {
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
                audioGenerating: false,
                audioGenerationRetryAllowed: undefined,
                audioGenerationRetryBlockCode: undefined,
                audioGenerationRetryBlockReason: undefined,
                audioGenerationTaskId: undefined,
                audioModelId: selectedAudioModel?.id,
                audioModelName: selectedAudioModel?.displayName ?? "Mureka",
                audioPrompt: cleanPrompt,
                audioSrc: task.resultUrl,
                audioWaveform: undefined,
              },
            }
          : node,
      ),
    );
    clearGenerationSubmissionIntent("audio", canvasId, id, task.id, accountId);
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
    try {
      await flushCanvasSave();
      const { task: submitted } = await ensureGenerationTask(
        "audio",
        audioGenerationRequestInput,
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
              audioGenerationError: undefined,
              audioGenerationErrorCode: undefined,
              audioGenerationInputKey,
              audioGenerating: true,
              audioGenerationRetryAllowed: undefined,
              audioGenerationRetryBlockCode: undefined,
              audioGenerationRetryBlockReason: undefined,
              audioGenerationTaskId: submitted.id,
            },
          }
        : node));
      setSubmitting(false);
      const task = await waitForGenerationTask(submitted.id);
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
      applyGeneratedAudio(task, promptControl.committedValue.trim());
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
      if (submittedTaskId) {
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
        run: () => runWorkflowNodeRef.current(),
      }),
    [id, registerWorkflowNode],
  );

  const retryAudioGeneration = async () => {
    if (!retryTaskId || !retryAvailable || generating || submitting) return;
    const taskId = retryTaskId;
    setUploadError("");
    setActiveTaskId(taskId);
    setServerInputProblems([]);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            audioGenerationError: undefined,
            audioGenerationErrorCode: undefined,
            audioGenerationInputKey,
            audioGenerating: true,
            audioGenerationRetryAllowed: undefined,
            audioGenerationRetryBlockCode: undefined,
            audioGenerationRetryBlockReason: undefined,
            audioGenerationTaskId: taskId,
          },
        }
      : node));
    try {
      await retryGenerationTask(taskId);
      const task = await waitForGenerationTask(taskId);
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
      applyGeneratedAudio(task, promptControl.committedValue.trim());
      setRetryTaskId(undefined);
    } catch (error) {
      if (error instanceof GenerationRequestError) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : "音频生成失败，请稍后再试";
      const errorCode = error instanceof GenerationRequestError
        ? error.code
        : "TASK_STATUS_UNKNOWN";
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
    } finally {
      setActiveTaskId(undefined);
    }
  };

  const cancelAudioGeneration = async () => {
    if (!activeTaskId || !relayCancellationAvailable) return;
    try {
      const task = await cancelGenerationTask(activeTaskId);
      if (task.state !== "cancelled") return;
      persistAudioGenerationCancellation(
        task.id,
        task.errorMessage ?? "已停止本地等待，上游任务可能仍在运行",
      );
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "取消生成失败");
    }
  };

  useEffect(() => {
    if (data.audioSrc || isFixture) return;
    const controller = new AbortController();
    void recoverPendingGenerationTask(
      "audio",
      canvasId,
      id,
      controller.signal,
      audioGenerationRequestInput,
      accountId,
    )
      .then(async (pending) => ({
        recoveredIntent: Boolean(pending),
        tasks: pending
          ? [pending]
          : await listGenerationTasks(canvasId, controller.signal),
      }))
      .then(async ({ recoveredIntent, tasks }) => {
        const latest = tasks
          .filter((task) => task.kind === "audio" && task.nodeId === id)
          .at(-1);
        if (!latest) return;
        if (latest.state === "success") {
          applyGeneratedAudio(latest, promptControl.committedValue.trim());
          return;
        }
        if (latest.state === "failed") {
          const matchesPersistedInput = recoveredIntent || (
            data.audioGenerationTaskId === latest.id &&
            data.audioGenerationInputKey === audioGenerationInputKey
          );
          if (matchesPersistedInput) {
            const retainPersistedBlock =
              data.audioGenerationRetryAllowed === false;
            persistAudioGenerationFailure(
              latest.id,
              retainPersistedBlock && data.audioGenerationError
                ? data.audioGenerationError
                : latest.errorMessage ?? "音频生成失败，请稍后再试",
              retainPersistedBlock
                ? data.audioGenerationErrorCode
                : latest.errorCode,
              retainPersistedBlock
                ? false
                : safelyRetryableGenerationTask(latest),
              retainPersistedBlock
                ? data.audioGenerationRetryBlockCode
                : latest.retryBlockCode,
              retainPersistedBlock
                ? data.audioGenerationRetryBlockReason
                : latest.retryBlockReason,
            );
          }
          return;
        }
        if (latest.state === "cancelled") {
          persistAudioGenerationCancellation(
            latest.id,
            latest.errorMessage ?? "音频生成已取消",
          );
          return;
        }
        setActiveTaskId(latest.id);
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                audioGenerationError: undefined,
                audioGenerationErrorCode: undefined,
                audioGenerationInputKey,
                audioGenerating: true,
                audioGenerationRetryAllowed: undefined,
                audioGenerationRetryBlockCode: undefined,
                audioGenerationRetryBlockReason: undefined,
                audioGenerationTaskId: latest.id,
              },
            }
          : node));
        const finished = await waitForGenerationTask(latest.id, controller.signal);
        if (finished.state === "success") {
          applyGeneratedAudio(finished, promptControl.committedValue.trim());
        } else {
          if (finished.state === "failed") {
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
        }
        setActiveTaskId(undefined);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setUploadError("生成任务状态暂时无法读取");
        }
      });
    return () => controller.abort();
  }, [
    audioGenerationInputKey,
    canvasId,
    data.audioGenerationError,
    data.audioGenerationErrorCode,
    data.audioGenerationRetryAllowed,
    data.audioGenerationRetryBlockCode,
    data.audioGenerationRetryBlockReason,
    data.audioGenerationInputKey,
    data.audioGenerationTaskId,
    data.audioSrc,
    id,
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
  }, [data.audioSrc, data.audioWaveform?.length, id, setNodes]);

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
      const asset = await response.json() as {
        assetId: string;
        byteSize?: number;
        contentType?: string;
        durationSeconds?: number;
        error?: string;
        storageBackend?: "local" | "oss";
        url: string;
      };
      if (!response.ok) throw new Error(asset.error ?? "音频上传失败");
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
        controller.signal.aborted ||
        getNode(id)?.data.inputState !== "uploading"
      ) {
        await discardUnadoptedAudioAsset(requestedAssetId);
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
      adopted = true;
      setTransientUploadError("");
    } catch (error) {
      if (!adopted && requestedAssetId) {
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
            <ProviderErrorNotice message={transientUploadError || uploadError} />
            {retryAvailable && (
              <button
                aria-label="重试生成"
                onClick={() => void retryAudioGeneration()}
                type="button"
              >
                重试
              </button>
            )}
          </div>
        )}
        {generating || uploading ? (
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
        ) : data.audioSrc ? (
          <>
            <audio
              data-testid="audio-node-media"
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => {
                const nextDuration = event.currentTarget.duration;
                setNodes((nodes) =>
                  nodes.map((node) =>
                    node.id === id
                      ? {
                          ...node,
                          data: {
                            ...node.data,
                            audioDuration: nextDuration,
                          },
                        }
                      : node,
                  ),
                );
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
        ) : (
          <div aria-hidden="true" className="audio-node-empty-action">
            <svg aria-hidden="true" viewBox="0 0 48 48">
              <path d="M18 34a7 7 0 1 1-5-6.7V13l24-5v19a7 7 0 1 1-5-6.7v-6l-14 3Z" />
            </svg>
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
