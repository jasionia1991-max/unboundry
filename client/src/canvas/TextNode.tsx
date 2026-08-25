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
import {
  useCompositionSafeRichText,
  useCompositionSafeText,
  type CompositionSafeRichTextValue,
} from "./CompositionSafeText";
import { NodeModelControl } from "./NodeModelControl";
import { NodeParameterControl } from "./NodeParameterControl";
import { generationOwnershipKey, type ProbeNodeType } from "./ProbeNode";
import {
  usePublishedModelSelection,
} from "../models/ModelCatalog";
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
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";
import { useWorkflowExecution } from "../generation/WorkflowExecutionProvider";
import {
  effectiveLegacyTerminalGenerationState,
  LegacyTerminalGenerationNotice,
  useLegacyTerminalGenerationState,
} from "../generation/legacyTerminalGenerationState";
import { useFinishedGenerationDuration } from "../generation/useFinishedGenerationDuration";
import { GenerationDurationHint } from "./GenerationDurationHint";
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
  type NodeGenerationOutcome,
} from "../generation/workflowExecution";
import { groupRunResultKey } from "../generation/groupRunCheckpoint";
import {
  generationFailureMessage,
  generationInputKey as createGenerationInputKey,
  generationRetryBlockReason,
} from "../generation/generationRetry";
import {
  clearGenerationSubmissionIntent,
  GENERATION_TASK_RETRY_ACCEPTED_EVENT,
  GenerationRequestError,
  getGenerationTask,
  listGenerationTasks,
  recoverPendingGenerationTask,
  waitForGenerationTask,
  type GenerationTaskRetryAcceptedDetail,
  type GenerationTaskSummary,
} from "../generation/generationTasks";
import { createBrowserSingleNodeGenerationTaskPort } from "../generation/browserSingleNodeGenerationTaskPort";
import {
  createSingleNodeGenerationLifecycle,
  type SingleNodeGenerationAdapter,
  type SingleNodeGenerationBlocked,
  type SingleNodeLifecycleResult,
  type SingleNodeGenerationPlan,
} from "../generation/singleNodeGenerationLifecycle";

const tools = [
  ["背景颜色", "color"],
  ["标题 1", "h1"],
  ["标题 2", "h2"],
  ["标题 3", "h3"],
  ["正文", "body"],
  ["粗体", "bold"],
  ["斜体", "italic"],
  ["无序列表", "bullet"],
  ["有序列表", "numbered"],
  ["分割线", "divider"],
  ["Pin", "pin"],
  ["复制全部", "copy"],
  ["保存到素材库", "save"],
  ["全屏", "fullscreen"],
] as const;

type ToolName = (typeof tools)[number][1];

type TextTaskOwner = {
  generationInputKey?: string;
  generationOwnershipKey?: string;
  taskId: string;
  token: symbol;
};

function createTextGenerationAdapter(input: {
  inputKey: string;
  modelId?: string;
  modelName?: string;
  nodeId: string;
  ownershipKey: string;
  parameters?: ProbeNodeType["data"]["textParameters"];
  payload: unknown;
  readBlock: () => SingleNodeGenerationBlocked | undefined;
}): SingleNodeGenerationAdapter {
  return {
    applyPrepared(node) {
      return {
        ...node,
        data: {
          ...node.data,
          textModelId: input.modelId,
          textModelName: input.modelName,
          textParameters: input.parameters,
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
          textGenerating: true,
          textGenerationError: undefined,
          textGenerationErrorCode: undefined,
          textGenerationInputKey: plan.inputKey,
          textGenerationOwnershipKey: task.generationOwnershipKey ?? plan.ownershipKey,
          textGenerationRetryAllowed: undefined,
          textGenerationRetryBlockCode: undefined,
          textGenerationRetryBlockReason: undefined,
          textGenerationTaskId: task.id,
          textModelId: input.modelId,
          textModelName: input.modelName,
          textParameters: input.parameters,
        },
      };
    },
    applyTerminal(node, task, plan) {
      if (task.state === "success") {
        const resultText = task.resultText?.trim() ?? "";
        if (!resultText) throw new Error("文字结果不完整");
        const contentHtml = plainTextHtml(resultText);
        return {
          ...node,
          data: {
            ...node.data,
            content: resultText,
            contentHtml,
            groupRunSuccessOwnershipKey: plan.ownershipKey,
            groupRunSuccessResultKey: groupRunResultKey({ content: resultText, contentHtml }),
            groupRunSuccessTaskId: task.id,
            textGenerating: false,
            textGenerationError: undefined,
            textGenerationErrorCode: undefined,
            textGenerationInputKey: undefined,
            textGenerationOwnershipKey: undefined,
            textGenerationRetryAllowed: undefined,
            textGenerationRetryBlockCode: undefined,
            textGenerationRetryBlockReason: undefined,
            textGenerationTaskId: task.id,
          },
        };
      }
      if (task.state === "cancelled") {
        return {
          ...node,
          data: {
            ...node.data,
            textGenerating: false,
            textGenerationError: task.errorMessage ?? "文字生成已取消",
            textGenerationErrorCode: undefined,
            textGenerationInputKey: undefined,
            textGenerationOwnershipKey: undefined,
            textGenerationRetryAllowed: undefined,
            textGenerationRetryBlockCode: undefined,
            textGenerationRetryBlockReason: undefined,
            textGenerationTaskId: undefined,
          },
        };
      }
      const visibleMessage = generationFailureMessage(
        task.errorMessage ?? "文字生成失败，请稍后再试",
        task.retryAllowed ? undefined : task.retryBlockReason,
        task.errorCode,
        "text",
      );
      return {
        ...node,
        data: {
          ...node.data,
          textGenerating: false,
          textGenerationError: visibleMessage,
          textGenerationErrorCode: task.errorCode,
          textGenerationInputKey: plan.inputKey,
          textGenerationRetryAllowed: task.retryAllowed === true,
          textGenerationRetryBlockCode: task.retryBlockCode,
          textGenerationRetryBlockReason: task.retryBlockReason,
          textGenerationTaskId: task.id,
        },
      };
    },
    kind: "text",
    readPlan(): SingleNodeGenerationBlocked | SingleNodeGenerationPlan {
      const block = input.readBlock();
      if (block) return block;
      return {
        inputKey: input.inputKey,
        kind: "text",
        nodeId: input.nodeId,
        ownershipKey: input.ownershipKey,
        payload: input.payload,
      };
    },
  };
}

function textTaskMatchesNode(
  task: GenerationTaskSummary,
  canvasId: string,
  nodeId: string,
  taskId = task.id,
) {
  return task.id === taskId &&
    task.canvasId === canvasId &&
    task.kind === "text" &&
    task.nodeId === nodeId;
}

function clearFailedTextGeneration(data: ProbeNodeType["data"]) {
  if (
    !data.textGenerationError &&
    !data.textGenerationInputKey &&
    !data.textGenerationOwnershipKey &&
    !data.textGenerationTaskId
  ) return data;
  return {
    ...data,
    textGenerationError: undefined,
    textGenerationErrorCode: undefined,
    textGenerationInputKey: undefined,
    textGenerationOwnershipKey: undefined,
    textGenerationRetryAllowed: undefined,
    textGenerationRetryBlockCode: undefined,
    textGenerationRetryBlockReason: undefined,
    textGenerating: false,
    textGenerationTaskId: undefined,
  };
}

const richTextTags = new Set([
  "B",
  "BR",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "HR",
  "I",
  "LI",
  "OL",
  "P",
  "STRONG",
  "UL",
]);
const droppedRichTextTags = new Set([
  "AUDIO",
  "EMBED",
  "IFRAME",
  "IMG",
  "LINK",
  "MATH",
  "META",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "SVG",
  "VIDEO",
]);

export function plainTextHtml(text: string) {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  return paragraph.outerHTML;
}

function sanitizeRichTextHtml(html: string, fallbackText: string) {
  const source = document.createElement("template");
  const output = document.createElement("div");
  source.innerHTML = html;

  const copySafeNode = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (droppedRichTextTags.has(node.tagName)) return;
    if (!richTextTags.has(node.tagName)) {
      node.childNodes.forEach((child) => copySafeNode(child, parent));
      return;
    }
    const element = document.createElement(node.tagName.toLocaleLowerCase());
    node.childNodes.forEach((child) => copySafeNode(child, element));
    parent.appendChild(element);
  };

  source.content.childNodes.forEach((node) => copySafeNode(node, output));
  return output.innerHTML || plainTextHtml(fallbackText);
}

function storedRichTextValue(
  text: string,
  html: string | undefined,
): CompositionSafeRichTextValue {
  return {
    html: sanitizeRichTextHtml(html ?? plainTextHtml(text), text),
    text,
  };
}

function editorRichTextValue(
  editor: HTMLDivElement,
): CompositionSafeRichTextValue {
  const text = editor.innerText;
  return {
    html: sanitizeRichTextHtml(editor.innerHTML, text),
    text,
  };
}

function applyRichTextValue(
  editor: HTMLDivElement,
  value: CompositionSafeRichTextValue,
) {
  const html = sanitizeRichTextHtml(value.html, value.text);
  if (editor.innerHTML !== html) editor.innerHTML = html;
}

function ToolIcon({ name }: { name: ToolName }) {
  if (name === "color") {
    return <span className="text-tool-color" />;
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {name === "h1" && (
        <>
          <path d="M4 6v12M12 6v12M4 12h8M17 12l2-2v8" />
        </>
      )}
      {name === "h2" && (
        <>
          <path d="M4 6v12M12 6v12M4 12h8M17 12a2 2 0 1 1 4 0c0 1-4 6-4 6h4" />
        </>
      )}
      {name === "h3" && (
        <>
          <path d="M4 6v12M12 6v12M4 12h8M17 11a2 2 0 1 1 2 3 2 2 0 1 1-2 3" />
        </>
      )}
      {name === "body" && (
        <path d="M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
      )}
      {name === "bold" && (
        <>
          <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM13 12h1a3.5 3.5 0 0 1 0 7H7v-7" />
        </>
      )}
      {name === "italic" && <path d="M11 5h6M7 19h6M14 5l-4 14" />}
      {name === "bullet" && (
        <path d="M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01" />
      )}
      {name === "numbered" && (
        <path d="M11 6h9M11 12h9M12 18h8M6 10V4L4 6M4 16a2 2 0 1 1 4 0c0 1-4 4-4 4h4" />
      )}
      {name === "divider" && <path d="M5 12h14" />}
      {name === "pin" && (
        <path d="m9 4 6 2-2 4 3 3-4 1-4 6v-7l-3-3 4-1z" />
      )}
      {name === "copy" && (
        <>
          <rect height="13" rx="2" width="13" x="8" y="8" />
          <path d="M16 5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2" />
        </>
      )}
      {name === "save" && (
        <>
          <path d="M4 20h12a2 2 0 0 0 2-2V8l-4-4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
          <path d="M12 14h8M16 10v8" />
        </>
      )}
      {name === "fullscreen" && (
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      )}
    </svg>
  );
}

function TextNodeImpl({
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
      data.textGenerationTaskId && data.textGenerationOwnershipKey &&
        data.textGenerationInputKey,
    ),
    hasLegacyRun: Boolean(data.workflowExecutionRunId),
    locallyActive: lockedNodeIds.has(id),
    persistedGenerating: data.textGenerating === true,
    state: storedLegacyState,
  });
  const displayTextGenerating = legacyState && legacyState !== "PASSTHROUGH"
    ? legacyState === "ACTIVE_CONFIRMED"
    : Boolean(data.textGenerating);
  const legacySubmissionBlocked = legacyState === "DETECTING" ||
    legacyState === "ACTIVE_CONFIRMED" || legacyState === "UNKNOWN_BLOCKED";
  const [background, setBackground] = useState("#1f1f1f");
  const [bodyEditing, setBodyEditing] = useState(false);
  useEffect(() => {
    if (legacySubmissionBlocked) setBodyEditing(false);
  }, [legacySubmissionBlocked]);
  const [empty, setEmpty] = useState(!data.content);
  const [fullscreen, setFullscreen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [saved, setSaved] = useState(false);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
  const [unverifiedRecoveryTaskId, setUnverifiedRecoveryTaskId] =
    useState<string>();
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const [generationError, setGenerationError] = useState(
    data.textGenerationError ?? "",
  );
  const [recoveringTask, setRecoveringTask] = useState(
    Boolean(
      data.textGenerationTaskId &&
      !data.content &&
      !data.textGenerationError,
    ),
  );
  const [serverInputProblems, setServerInputProblems] = useState<NodeInputProblem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [retryWakeEpoch, setRetryWakeEpoch] = useState(0);
  const [bodyValue, setBodyValue] = useState(() =>
    storedRichTextValue(data.content ?? "", data.contentHtml),
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const bodyLocalValue = useRef(bodyValue);
  const activeTaskRef = useRef<string | null>(null);
  const textTaskOwnerRef = useRef<TextTaskOwner | undefined>(undefined);
  const textTerminalPatchPendingTaskRef = useRef<string | undefined>(undefined);
  const textManualEditVersionRef = useRef(0);
  const recoveryTaskRef = useRef<{
    controller: AbortController;
    owner: TextTaskOwner;
    taskId: string;
  } | null>(null);
  const { graphCommandPort, setEdges, setNodes } = useCanvasGraphMutation();
  const { getNodes } = useReactFlow<ProbeNodeType>();
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
    data.textGenerationTaskId,
    singleNodeChrome && !data.textGenerating,
    { canvasId, nodeId: id },
  );
  const claimTextTask = (
    taskId: string,
    generationOwnershipKey?: string,
    generationInputKey?: string,
  ): TextTaskOwner => {
    const owner = {
      generationInputKey,
      generationOwnershipKey,
      taskId,
      token: Symbol(taskId),
    };
    textTaskOwnerRef.current = owner;
    activeTaskRef.current = taskId;
    return owner;
  };
  const ownsTextTask = (owner: TextTaskOwner) =>
    textTaskOwnerRef.current === owner &&
    (owner.generationOwnershipKey === undefined ||
      liveGenerationOwnershipKeyRef.current === owner.generationOwnershipKey);
  const releaseTextTask = (owner: TextTaskOwner) => {
    if (textTaskOwnerRef.current !== owner) return;
    textTaskOwnerRef.current = undefined;
    if (activeTaskRef.current === owner.taskId) activeTaskRef.current = null;
  };
  const revokeTextTaskForManualBodyEdit = () => {
    textManualEditVersionRef.current += 1;
    recoveryTaskRef.current?.controller.abort("text-body-edited");
    recoveryTaskRef.current = null;
    textTaskOwnerRef.current = undefined;
    activeTaskRef.current = null;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setRecoveringTask(false);
    setGenerationError("");
    setServerInputProblems([]);
    // A manual body commit owns the node from this point on. Clear the whole
    // v2 slot (not only a possibly stale task id) so a late recovery cannot
    // reclaim the node after refresh.
    clearGenerationSubmissionIntent("text", canvasId, id, undefined, accountId);
  };
  const revokeTextTaskForGenerationInputChange = () => {
    recoveryTaskRef.current?.controller.abort("text-generation-input-changed");
    recoveryTaskRef.current = null;
    textTaskOwnerRef.current = undefined;
    activeTaskRef.current = null;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setRecoveringTask(false);
    setGenerationError("");
    setServerInputProblems([]);
    // Input changes revoke the complete v2 slot, including an intent that has
    // been recorded while ensureGenerationTask is still awaiting preflight.
    clearGenerationSubmissionIntent("text", canvasId, id, undefined, accountId);
  };
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
    value: data.title ?? "Text",
  });
  const promptControl = useCompositionSafeText({
    onCommit: (nextPrompt) => {
      revokeTextTaskForGenerationInputChange();
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...clearFailedTextGeneration(node.data),
                  textPrompt: nextPrompt,
                },
              }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: data.textPrompt ?? "",
  });
  const bodyControl = useCompositionSafeRichText({
    onCommit: (nextValue) => {
      revokeTextTaskForManualBodyEdit();
      setBodyValue(nextValue);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  content: nextValue.text,
                  contentHtml: nextValue.html,
                  textGenerationError: undefined,
                  textGenerationErrorCode: undefined,
                  textGenerationInputKey: undefined,
                  textGenerationOwnershipKey: undefined,
                  textGenerationRetryAllowed: undefined,
                  textGenerationRetryBlockCode: undefined,
                  textGenerationRetryBlockReason: undefined,
                  textGenerating: false,
                  textGenerationTaskId: undefined,
                },
              }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: bodyValue,
  });
  const textModelSelection = usePublishedModelSelection(
    "text",
    data.textModelId,
    data.textModelName,
  );
  const textModels = textModelSelection.models;
  const selectedTextModel = textModelSelection.model;
  const selectedTextModelId = textModelSelection.selectedId;
  const textModelUnavailableReason = textModelSelection.unavailableReason;
  const textParameterSchema = selectedTextModel?.parameterSchema ??
    defaultParameterSchema("text");
  const textParameters = selectedTextModel
    ? normalizeParameterValues(textParameterSchema, data.textParameters)
    : {};
  const textSubmissionParameters = selectedTextModel
    ? submissionParameterValues(textParameterSchema, textParameters)
    : {};
  const textInputParameterKeys = parameterKeysForGroups(textParameterSchema, ["input"])
    .filter((key) => {
      const field = textParameterSchema.fields.find((item) => item.key === key);
      return key !== "inputMode" || (field?.options.length ?? 0) > 1;
    });
  const textMainParameterKeys = parameterKeysForGroups(
    textParameterSchema,
    ["main", "advanced", "output"],
    ["outputCount"],
  );
  const textCountParameterKeys = textParameterSchema.fields.some((field) => field.key === "outputCount")
    ? ["outputCount"]
    : [];
  const inputPreflight = resolveNodeInputs({
    edges: canvasEdges,
    modelSchema: selectedTextModel?.parameterSchema,
    nodes: canvasNodes,
    ownPrompt: promptControl.committedValue,
    parameters: textSubmissionParameters,
    targetId: id,
    targetKind: "text",
  });
  const textGenerationRequestInput = {
    canvasId,
    canvasRevision,
    inputSchemaVersion: 1 as const,
    inputs: inputPreflight.snapshot,
    model: selectedTextModelId,
    nodeId: id,
    ownPrompt: promptControl.committedValue,
    parameters: textSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  };
  const generationInputKey = createGenerationInputKey({
    inputs: inputPreflight.inputs,
    modelId: selectedTextModelId,
    ownPrompt: promptControl.committedValue,
    parameters: textSubmissionParameters,
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
          : defaultNodeInputRole(input.kind, "text"),
        source: input.sourceNodeId,
        sourceKind: input.kind,
        src: input.kind === "text" ? undefined : input.preview,
        status: input.state,
        text: input.kind === "text" ? input.text : undefined,
      };
    });
  const effectiveGenerationInputFingerprint = generationOwnershipKey({
    modelId: selectedTextModelId,
    parameters: selectedTextModel ? textParameters : data.textParameters,
    prompt: promptControl.committedValue,
    upstream: generationOwnershipUpstream,
  });
  const rawGenerationInputFingerprint = generationOwnershipKey({
    // An ownership-bound task uses only the durable snapshot. A node that has
    // not admitted a task yet materializes the effective catalog choice before
    // the paid POST, so a later default change cannot silently retarget it.
    modelId: data.textGenerationOwnershipKey
      ? data.textModelId
      : selectedTextModelId,
    parameters: data.textGenerationOwnershipKey
      ? data.textParameters
      : selectedTextModel
        ? textParameters
        : data.textParameters,
    prompt: promptControl.committedValue,
    // Only durable source/edge semantics belong here. Compatibility, resolver
    // reasons, and resolved roles can drift with the model catalog.
    upstream: generationOwnershipUpstream,
  });
  const liveGenerationInputKeyRef = useRef(generationInputKey);
  liveGenerationInputKeyRef.current = generationInputKey;
  const liveGenerationOwnershipKeyRef = useRef(rawGenerationInputFingerprint);
  liveGenerationOwnershipKeyRef.current = rawGenerationInputFingerprint;
  const stableRawGenerationInputFingerprint = useRef<string | undefined>(
    undefined,
  );
  const legacyRecoveryCatalogKey = data.textGenerationOwnershipKey
    ? "ownership-bound"
    : `${textModelSelection.status}:${selectedTextModelId ?? ""}:${generationInputKey}`;
  const incomingInputs = inputPreflight.inputs;
  const retryBlockReason = data.textGenerationTaskId && data.textGenerationError
    ? generationRetryBlockReason({
        retryAllowed: data.textGenerationRetryAllowed,
        retryBlockReason: data.textGenerationRetryBlockReason,
        state: "failed",
      })
    : "";
  const retryableTask = Boolean(
    data.textGenerationTaskId &&
    data.textGenerationError &&
    data.textGenerationInputKey === generationInputKey &&
    (!data.textGenerationOwnershipKey ||
      data.textGenerationOwnershipKey === rawGenerationInputFingerprint) &&
    data.textGenerationRetryAllowed === true &&
    Boolean(selectedTextModel) &&
    selectedTextModel?.generationAvailable !== false,
  );
  const blockedFailedTask = Boolean(
    data.textGenerationTaskId &&
    data.textGenerationError &&
    !retryableTask,
  );
  const generationProblem = generationError
    ? retryBlockReason
      ? generationError.includes("结果无法确认")
        ? generationError
        : `生成失败：${generationError}；${retryBlockReason}`
      : retryableTask
      ? `生成失败：${generationError}；点击右侧按钮重试原任务`
      : generationError
    : "";
  const inputProblems: NodeInputProblem[] = modelSwitchProblem
    ? [
        { code: "MODEL_UNSUPPORTED", message: modelSwitchProblem },
        ...inputPreflight.problems,
        ...serverInputProblems,
        ...(generationProblem
          ? [{ code: "INVALID" as const, message: generationProblem }]
          : []),
      ]
    : [
        ...inputPreflight.problems,
        ...serverInputProblems,
        ...(generationProblem
          ? [{ code: "INVALID" as const, message: generationProblem }]
          : []),
      ];
  // An empty local Prompt is normal in the accepted 200px creator state.
  // It only becomes part of the expanded upstream area when references exist;
  // actual input/model compatibility problems still expand immediately.
  const upstreamProblem = inputProblems.find(
    (problem) => incomingInputs.length > 0 || problem.code !== "PROMPT_MISSING",
  )?.message ?? "";
  useEffect(() => {
    setModelSwitchProblem("");
  }, [canvasEdges]);

  useEffect(() => {
    setGenerationError(data.textGenerationError ?? "");
  }, [data.textGenerationError]);

  useEffect(() => {
    const wakeAcceptedRetry = (event: Event) => {
      const detail = (event as CustomEvent<GenerationTaskRetryAcceptedDetail>)
        .detail;
      if (
        detail?.canvasId === canvasId &&
        detail.nodeId === id &&
        detail.kind === "text" &&
        detail.taskId === data.textGenerationTaskId
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
  }, [canvasId, data.textGenerationTaskId, id]);

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
      data.textGenerationOwnershipKey &&
      data.textGenerationOwnershipKey !== rawGenerationInputFingerprint,
    );
    if (
      !persistedMismatch &&
      (previous === undefined || previous === rawGenerationInputFingerprint)
    ) {
      return;
    }
    if (
      !data.textGenerating &&
      !data.textGenerationTaskId &&
      !data.textGenerationInputKey &&
      !data.textGenerationOwnershipKey
    ) return;
    revokeTextTaskForGenerationInputChange();
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: clearFailedTextGeneration(node.data) }
      : node));
  }, [
    data.textGenerating,
    data.textGenerationInputKey,
    data.textGenerationOwnershipKey,
    data.textGenerationTaskId,
    data.workflowExecutionRunId,
    id,
    persistenceReady,
    rawGenerationInputFingerprint,
    setNodes,
  ]);

  useEffect(() => {
    if (!singleNodeChrome) {
      setBodyEditing(false);
    }
  }, [singleNodeChrome]);

  useEffect(() => {
    const nextValue = storedRichTextValue(
      data.content ?? "",
      data.contentHtml,
    );
    setBodyValue((current) =>
      current.text === nextValue.text && current.html === nextValue.html
        ? current
        : nextValue,
    );
  }, [data.content, data.contentHtml]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    applyRichTextValue(editor, bodyValue);
    bodyLocalValue.current = bodyValue;
    setEmpty(!bodyValue.text.trim());
  }, [bodyEditing, bodyValue]);

  useEffect(() => {
    if (!fullscreen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [fullscreen]);

  const edit = (command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    const nextValue = editorRichTextValue(editor);
    editor.dataset.committedRichHtml = nextValue.html;
    bodyLocalValue.current = nextValue;
    setEmpty(!nextValue.text.trim());
    bodyControl.change(nextValue, false);
  };

  const copyTextContent = (liveEditor = false) => {
    const bodyText = liveEditor
      ? (editorRef.current?.innerText ?? bodyControl.committedValue.text)
      : bodyControl.committedValue.text;
    void navigator.clipboard
      .writeText(`${titleControl.committedValue}\n${bodyText}`)
      .catch(() => undefined);
  };

  const runTool = (name: ToolName) => {
    if (name === "color") {
      setBackground((current) =>
        current === "#1f1f1f" ? "#2a2a2a" : "#1f1f1f",
      );
    } else if (name === "h1" || name === "h2" || name === "h3") {
      edit("formatBlock", name);
    } else if (name === "body") {
      edit("formatBlock", "p");
    } else if (name === "bold" || name === "italic") {
      edit(name);
    } else if (name === "bullet") {
      edit("insertUnorderedList");
    } else if (name === "numbered") {
      edit("insertOrderedList");
    } else if (name === "divider") {
      edit("insertHorizontalRule");
    } else if (name === "pin") {
      setPinned((current) => !current);
    } else if (name === "copy") {
      copyTextContent(true);
    } else if (name === "save") {
      setSaved(true);
    } else if (name === "fullscreen") {
      editorRef.current?.blur();
      setBodyEditing(false);
      setFullscreen(true);
    }
  };

  const applyGeneratedText = async (
    task: GenerationTaskSummary,
    owner: TextTaskOwner,
  ) => {
    if (
      !ownsTextTask(owner) ||
      !textTaskMatchesNode(task, canvasId, id, owner.taskId)
    ) return false;
    const resultText = task.resultText?.trim() ?? "";
    if (!resultText) throw new Error("文字结果不完整");
    textTerminalPatchPendingTaskRef.current = task.id;
    const nextValue = storedRichTextValue(resultText, plainTextHtml(resultText));
    checkpoint(false);
    setBodyValue(nextValue);
    bodyLocalValue.current = nextValue;
    setEmpty(false);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            content: resultText,
            contentHtml: nextValue.html,
            textGenerationError: undefined,
            textGenerationErrorCode: undefined,
            textGenerationInputKey: undefined,
            textGenerationOwnershipKey: undefined,
            textGenerationRetryAllowed: undefined,
            textGenerationRetryBlockCode: undefined,
            textGenerationRetryBlockReason: undefined,
            textGenerating: false,
            textGenerationTaskId: task.id,
            groupRunSuccessOwnershipKey: owner.generationOwnershipKey,
            groupRunSuccessResultKey: groupRunResultKey({
              content: resultText,
              contentHtml: nextValue.html,
            }),
            groupRunSuccessTaskId: task.id,
          },
        }
      : node));
    setGenerationError("");
    await flushCanvasSave();
    clearGenerationSubmissionIntent("text", canvasId, id, task.id, accountId);
    if (textTerminalPatchPendingTaskRef.current === task.id) {
      textTerminalPatchPendingTaskRef.current = undefined;
    }
    return true;
  };

  const clearTextIntentAfterDurableTerminalPatch = (taskId: string) => {
    void (async () => {
      try {
        await flushCanvasSave();
        clearGenerationSubmissionIntent(
          "text",
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

  const persistTextGenerationFailure = (
    taskId: string,
    owner: TextTaskOwner,
    message: string,
    errorCode?: string,
    retryAllowed = false,
    retryBlockCode?: string,
    retryBlockReason?: string,
  ) => {
    if (!ownsTextTask(owner) || taskId !== owner.taskId) return;
    const visibleMessage = generationFailureMessage(
      message,
      retryAllowed ? undefined : retryBlockReason,
      errorCode,
      "text",
    );
    setGenerationError(visibleMessage);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            textGenerationError: visibleMessage,
            textGenerationErrorCode: errorCode,
            textGenerationInputKey:
              owner.generationInputKey ?? data.textGenerationInputKey,
            textGenerationRetryAllowed: retryAllowed,
            textGenerationRetryBlockCode: retryBlockCode,
            textGenerationRetryBlockReason: retryBlockReason,
            textGenerating: false,
            textGenerationTaskId: taskId,
          },
      }
      : node));
    clearTextIntentAfterDurableTerminalPatch(taskId);
  };

  const persistTextGenerationCancellation = (
    taskId: string,
    owner: TextTaskOwner,
    message: string,
  ) => {
    if (!ownsTextTask(owner) || taskId !== owner.taskId) return;
    setGenerationError(message);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            textGenerationError: message,
            textGenerationErrorCode: undefined,
            textGenerationInputKey: undefined,
            textGenerationOwnershipKey: undefined,
            textGenerationRetryAllowed: undefined,
            textGenerationRetryBlockCode: undefined,
            textGenerationRetryBlockReason: undefined,
            textGenerating: false,
            textGenerationTaskId: undefined,
          },
        }
      : node));
    clearTextIntentAfterDurableTerminalPatch(taskId);
  };

  const finishTextTask = async (
    taskId: string,
    owner: TextTaskOwner,
    signal?: AbortSignal,
  ) => {
    if (!ownsTextTask(owner) || taskId !== owner.taskId) return;
    let task: Awaited<ReturnType<typeof waitForGenerationTask>>;
    try {
      task = await waitForGenerationTaskWithPause(taskId, () => {
        if (!ownsTextTask(owner)) return;
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setGenerationError(POLLING_PAUSED_MESSAGE);
      }, signal);
    } catch (error) {
      if (!ownsTextTask(owner)) return;
      if (pollingPausedTaskIdRef.current === taskId) return;
      throw error;
    }
    if (!ownsTextTask(owner)) return;
    if (!textTaskMatchesNode(task, canvasId, id, taskId)) {
      throw new Error("文字任务关联不一致，已停止恢复");
    }
    if (task.state === "success") {
      await applyGeneratedText(task, owner);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      return;
    }
    if (task.state === "cancelled") {
      persistTextGenerationCancellation(
        taskId,
        owner,
        task.errorMessage ?? "文字生成已取消",
      );
      return;
    }
    persistTextGenerationFailure(
      taskId,
      owner,
      task.errorMessage ?? "文字生成失败，请稍后再试",
      task.errorCode,
      task.retryAllowed === true,
      task.retryBlockCode,
      task.retryBlockReason,
    );
  };

  useEffect(() => {
    if (!persistenceReady || isFixture || data.workflowExecutionRunId) return;
    const persistedTaskId = data.textGenerationTaskId;
    const persistedInputKey = data.textGenerationInputKey;
    const persistedOwnershipKey = data.textGenerationOwnershipKey;
    const catalogReady = textModelSelection.status === "ready" &&
      Boolean(selectedTextModel);
    const settledSuccessProvenance = Boolean(
      persistedTaskId &&
      !data.textGenerating &&
      data.content &&
      !data.textGenerationError &&
      !persistedInputKey,
    );
    if (
      persistedTaskId &&
      (activeTaskRef.current === persistedTaskId ||
        recoveryTaskRef.current?.taskId === persistedTaskId)
    ) return;
    if (
      persistedTaskId &&
      textTerminalPatchPendingTaskRef.current === persistedTaskId
    ) return;
    if (settledSuccessProvenance) {
      setUnverifiedRecoveryTaskId((current) =>
        current === persistedTaskId ? undefined : current
      );
      clearGenerationSubmissionIntent(
        "text",
        canvasId,
        id,
        persistedTaskId,
        accountId,
      );
      return;
    }

    const controller = new AbortController();
    const manualEditVersion = textManualEditVersionRef.current;
    let owner: TextTaskOwner | undefined;
    let recovery:
      | { controller: AbortController; owner: TextTaskOwner; taskId: string }
      | undefined;
    let lifecycle: ReturnType<typeof createSingleNodeGenerationLifecycle> |
      undefined;
    let persistedTaskReadPending = false;
    void (async () => {
      let task: GenerationTaskSummary | undefined;
      if (persistedTaskId) {
        if (
          persistedOwnershipKey &&
          persistedOwnershipKey !== rawGenerationInputFingerprint
        ) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
          revokeTextTaskForGenerationInputChange();
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.textGenerationTaskId === persistedTaskId
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node
          ));
          return;
        }
        if (!persistedOwnershipKey) {
          if (!catalogReady) return;
          if (persistedInputKey && persistedInputKey !== generationInputKey) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
            revokeTextTaskForGenerationInputChange();
            setNodes((nodes) => nodes.map((node) =>
              node.id === id && node.data.textGenerationTaskId === persistedTaskId
                ? { ...node, data: clearFailedTextGeneration(node.data) }
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
          "text",
          canvasId,
          id,
          controller.signal,
          selectedTextModel ? textGenerationRequestInput : undefined,
          accountId,
          { generationOwnershipKey: rawGenerationInputFingerprint },
        );
        if (!task && data.textGenerating) {
          if (!data.textGenerationOwnershipKey && !catalogReady) return;
          const matches = (await listGenerationTasks(canvasId, controller.signal))
            .filter((candidate) =>
              candidate.kind === "text" && candidate.nodeId === id
            );
          if (matches.length === 1) task = matches[0];
        }
      }
      if (
        controller.signal.aborted ||
        textManualEditVersionRef.current !== manualEditVersion ||
        !task
      ) return;
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
          "text",
          canvasId,
          id,
          persistedTaskId ?? task.id,
          accountId,
        );
        if (persistedTaskId) {
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.textGenerationTaskId === persistedTaskId
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node
          ));
        }
        return;
      }
      if (!recoveredOwnershipKey) {
        if (!catalogReady) return;
        const legacyInputKey = persistedInputKey ?? task.generationInputKey;
        if (legacyInputKey && legacyInputKey !== generationInputKey) {
          if (persistedTaskId) {
            setUnverifiedRecoveryTaskId((current) =>
              current === persistedTaskId ? undefined : current
            );
          }
          clearGenerationSubmissionIntent(
            "text",
            canvasId,
            id,
            persistedTaskId ?? task.id,
            accountId,
          );
          if (persistedTaskId) {
            setNodes((nodes) => nodes.map((node) =>
              node.id === id && node.data.textGenerationTaskId === persistedTaskId
                ? { ...node, data: clearFailedTextGeneration(node.data) }
                : node
            ));
          }
          return;
        }
      }
      if (!textTaskMatchesNode(task, canvasId, id, persistedTaskId ?? task.id)) {
        if (persistedTaskId) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
          clearGenerationSubmissionIntent(
            "text",
            canvasId,
            id,
            persistedTaskId,
            accountId,
          );
          setNodes((nodes) => nodes.map((node) =>
            node.id === id && node.data.textGenerationTaskId === persistedTaskId
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node
          ));
        }
        return;
      }
      if (persistedTaskId) {
        setUnverifiedRecoveryTaskId((current) =>
          current === persistedTaskId ? undefined : current
        );
        setGenerationError("");
      }
      owner = claimTextTask(
        task.id,
        recoveredOwnershipKey ?? rawGenerationInputFingerprint,
        persistedInputKey ?? task.generationInputKey,
      );
      recovery = { controller, owner, taskId: task.id };
      recoveryTaskRef.current = recovery;
      setRecoveringTask(true);
      if (!ownsTextTask(owner)) return;
      if (!graphCommandPort) return;
      const retainPersistedBlock = task.state === "failed" &&
        data.textGenerationRetryAllowed === false;
      const recoveredTask = retainPersistedBlock
        ? {
            ...task,
            errorCode: data.textGenerationErrorCode,
            errorMessage: data.textGenerationError ??
              task.errorMessage ??
              "文字生成失败，可重试",
            retryAllowed: false,
            retryBlockCode: data.textGenerationRetryBlockCode,
            retryBlockReason: data.textGenerationRetryBlockReason,
          }
        : task;
      const recoveryAdapter = createTextGenerationAdapter({
        inputKey: persistedInputKey ??
          task.generationInputKey ??
          generationInputKey,
        modelId: data.textModelId,
        modelName: data.textModelName,
        nodeId: id,
        ownershipKey: recoveredOwnershipKey ??
          rawGenerationInputFingerprint,
        parameters: data.textParameters,
        payload: textGenerationRequestInput,
        readBlock() {
          if (
            !owner ||
            !ownsTextTask(owner) ||
            textManualEditVersionRef.current !== manualEditVersion
          ) {
            return {
              message: "生成输入已修改，已停止本次恢复",
              status: "blocked",
            };
          }
        },
      });
      const applyRecoveryTerminal = recoveryAdapter.applyTerminal;
      lifecycle = createSingleNodeGenerationLifecycle({
        adapter: {
          ...recoveryAdapter,
          applyTerminal(node, terminalTask, plan) {
            textTerminalPatchPendingTaskRef.current = terminalTask.id;
            return applyRecoveryTerminal(node, terminalTask, plan);
          },
        },
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
            if (!owner || !ownsTextTask(owner)) return;
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setGenerationError(POLLING_PAUSED_MESSAGE);
          },
        }),
      });
      controller.signal.addEventListener(
        "abort",
        () => lifecycle?.abort("text-recovery-aborted"),
        { once: true },
      );
      let result: SingleNodeLifecycleResult;
      try {
        result = await lifecycle.recover(recoveredTask);
      } catch (error) {
        if (
          pollingPausedTaskIdRef.current === task.id &&
          ownsTextTask(owner)
        ) return;
        throw error;
      }
      if (!result.task || result.status === "stale") {
        return;
      }
      clearGenerationSubmissionIntent(
        "text",
        canvasId,
        id,
        result.task.id,
        accountId,
      );
      if (textTerminalPatchPendingTaskRef.current === result.task.id) {
        textTerminalPatchPendingTaskRef.current = undefined;
      }
      if (!ownsTextTask(owner)) return;
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      if (result.status === "success") {
        const resultText = result.task.resultText?.trim() ?? "";
        const nextValue = storedRichTextValue(resultText, plainTextHtml(resultText));
        setBodyValue(nextValue);
        bodyLocalValue.current = nextValue;
        setEmpty(false);
        setGenerationError("");
        return;
      }
      setGenerationError(generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled"
            ? "文字生成已取消"
            : "文字生成失败，请稍后再试"
        ),
        result.task.retryAllowed ? undefined : result.task.retryBlockReason,
        result.task.errorCode,
        "text",
      ));
    })()
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (
          persistedTaskId &&
          persistedTaskReadPending &&
          isTransientPollingError(error)
        ) {
          setUnverifiedRecoveryTaskId(persistedTaskId);
          setRecoveringTask(false);
          setGenerationError(POLLING_PAUSED_MESSAGE);
          return;
        }
        if (persistedTaskId && persistedTaskReadPending) {
          setUnverifiedRecoveryTaskId((current) =>
            current === persistedTaskId ? undefined : current
          );
        }
        if (
          textManualEditVersionRef.current === manualEditVersion &&
          (!owner || ownsTextTask(owner))
        ) {
          setGenerationError(error instanceof Error ? error.message : "文字任务恢复失败");
        }
      })
      .finally(() => {
        if (owner) releaseTextTask(owner);
        if (recovery && recoveryTaskRef.current === recovery) {
          recoveryTaskRef.current = null;
          setRecoveringTask(false);
        }
      });
    return () => {
      controller.abort();
      lifecycle?.abort("text-recovery-unmounted");
      if (owner) releaseTextTask(owner);
      if (recovery && recoveryTaskRef.current === recovery) {
        recoveryTaskRef.current = null;
        setRecoveringTask(false);
      }
    };
  }, [
    accountId,
    canvasId,
    data.content,
    data.textGenerating,
    data.textGenerationError,
    data.textGenerationErrorCode,
    data.textGenerationInputKey,
    data.textGenerationOwnershipKey,
    data.textGenerationRetryAllowed,
    data.textGenerationRetryBlockCode,
    data.textGenerationRetryBlockReason,
    data.textGenerationTaskId,
    data.workflowExecutionRunId,
    graphCommandPort,
    id,
    isFixture,
    persistenceReady,
    recoveryEpoch,
    retryWakeEpoch,
    rawGenerationInputFingerprint,
    legacyRecoveryCatalogKey,
    setNodes,
  ]);

  const generateText = async (
    _options: { autoRecover?: boolean } = {},
  ): Promise<NodeGenerationOutcome> => {
    if (
      !inputPreflight.canSubmit ||
      !selectedTextModel ||
      selectedTextModel.generationAvailable === false ||
      submitting ||
      data.textGenerating ||
      isFixture ||
      canvasRevision === undefined
    ) return { status: "skipped" };
    setSubmitting(true);
    setGenerationError("");
    setServerInputProblems([]);
    let owner: TextTaskOwner | undefined;
    const manualEditVersion = textManualEditVersionRef.current;
    const requestedGenerationInputKey = generationInputKey;
    const requestedGenerationOwnershipKey =
      effectiveGenerationInputFingerprint;
    const requestedModelId = selectedTextModelId;
    const requestedModelName = textModelSelection.displayName;
    const requestedParameters = { ...textParameters };
    try {
      if (!graphCommandPort) return { status: "skipped" };
      checkpoint();
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createTextGenerationAdapter({
          inputKey: requestedGenerationInputKey,
          modelId: requestedModelId,
          modelName: requestedModelName,
          nodeId: id,
          ownershipKey: requestedGenerationOwnershipKey,
          parameters: requestedParameters,
          payload: textGenerationRequestInput,
          readBlock() {
            if (
              textManualEditVersionRef.current !== manualEditVersion ||
              liveGenerationOwnershipKeyRef.current !== requestedGenerationOwnershipKey
            ) {
              return { message: "生成输入已修改，已停止本次生成", status: "blocked" };
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
          onPollingPaused(taskId) {
            pollingPausedTaskIdRef.current = taskId;
            setPollingPausedTaskId(taskId);
            setGenerationError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            owner = claimTextTask(
              task.id,
              requestedGenerationOwnershipKey,
              requestedGenerationInputKey,
            );
          },
        }),
      });
      const result = await lifecycle.generate();
      if (!result.task) {
        return { message: "生成输入已修改，已停止本次生成", status: "failed" };
      }
      clearGenerationSubmissionIntent("text", canvasId, id, result.task.id, accountId);
      if (result.status !== "success") {
        const message = result.task.errorMessage ?? "文字生成失败，请稍后再试";
        setGenerationError(generationFailureMessage(
          message,
          result.task.retryAllowed ? undefined : result.task.retryBlockReason,
          result.task.errorCode,
          "text",
        ));
        return { message, status: "failed" };
      }
      const resultText = result.task.resultText?.trim() ?? "";
      const nextValue = storedRichTextValue(resultText, plainTextHtml(resultText));
      setBodyValue(nextValue);
      bodyLocalValue.current = nextValue;
      setEmpty(false);
      setGenerationError("");
      return {
        status: "success",
        successProof: {
          ownershipKey: requestedGenerationOwnershipKey,
          resultKey: groupRunResultKey({
            content: resultText,
            contentHtml: nextValue.html,
          }),
          taskId: result.task.id,
        },
      };
    } catch (error) {
      if (error instanceof GenerationRequestError && error.problems.length) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : generationMessageFallback("text");
      const friendly = friendlyGenerationMessage(message, "text");
      if (textManualEditVersionRef.current === manualEditVersion) {
        setGenerationError(friendly);
      }
      return { message: friendly, status: "failed" };
    } finally {
      if (owner) releaseTextTask(owner);
      setSubmitting(false);
    }
  };

  const retryText = async () => {
    const taskId = data.textGenerationTaskId;
    if (
      !taskId ||
      !retryableTask ||
      isFixture ||
      !retryGenerationEnabled ||
      submitting ||
      data.textGenerating ||
      !selectedTextModel ||
      selectedTextModel.generationAvailable === false
    ) return;
    const requestedGenerationInputKey = generationInputKey;
    const requestedGenerationOwnershipKey = rawGenerationInputFingerprint;
    const owner = claimTextTask(
      taskId,
      requestedGenerationOwnershipKey,
      requestedGenerationInputKey,
    );
    setSubmitting(true);
    let retryAccepted = false;
    let retrySaveGatePassed = false;
    try {
      if (!graphCommandPort) return;
      const lifecycle = createSingleNodeGenerationLifecycle({
        adapter: createTextGenerationAdapter({
          inputKey: requestedGenerationInputKey,
          modelId: selectedTextModelId,
          modelName: textModelSelection.displayName,
          nodeId: id,
          ownershipKey: requestedGenerationOwnershipKey,
          parameters: { ...textParameters },
          payload: textGenerationRequestInput,
          readBlock() {
            if (!retrySaveGatePassed) return;
            if (!ownsTextTask(owner)) {
              return { message: "正文已手工修改，已停止本次重试", status: "blocked" };
            }
            if (liveGenerationInputKeyRef.current !== requestedGenerationInputKey) {
              return { message: "生成输入已修改，已停止本次重试", status: "blocked" };
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
            pollingPausedTaskIdRef.current = pausedTaskId;
            setPollingPausedTaskId(pausedTaskId);
            setGenerationError(POLLING_PAUSED_MESSAGE);
          },
          onTaskObserved(task) {
            if (task.id === taskId) retryAccepted = true;
          },
        }),
      });
      const result = await lifecycle.retry({ id: taskId });
      if (!result.task || result.status === "stale") return;
      clearGenerationSubmissionIntent("text", canvasId, id, taskId, accountId);
      if (result.status === "success") {
        const resultText = result.task.resultText?.trim() ?? "";
        const nextValue = storedRichTextValue(resultText, plainTextHtml(resultText));
        setBodyValue(nextValue);
        bodyLocalValue.current = nextValue;
        setEmpty(false);
        setGenerationError("");
        pollingPausedTaskIdRef.current = undefined;
        setPollingPausedTaskId(undefined);
        return;
      }
      setGenerationError(generationFailureMessage(
        result.task.errorMessage ?? (
          result.status === "cancelled" ? "文字生成已取消" : "文字生成重试失败"
        ),
        result.task.retryAllowed ? undefined : result.task.retryBlockReason,
        result.task.errorCode,
        "text",
      ));
    } catch (error) {
      if (!ownsTextTask(owner)) return;
      if (pollingPausedTaskIdRef.current === taskId) return;
      if (!retryAccepted && !(error instanceof GenerationRequestError)) {
        setGenerationError(
          error instanceof Error ? error.message : "画布尚未安全保存，不能重试生成",
        );
        return;
      }
      if (ownsTextTask(owner)) {
        persistTextGenerationFailure(
          taskId,
          owner,
          error instanceof Error ? error.message : "文字生成重试失败",
          error instanceof GenerationRequestError
            ? error.code
            : "TASK_STATUS_UNKNOWN",
          false,
          error instanceof GenerationRequestError
            ? error.code
            : "TASK_STATUS_UNKNOWN",
          error instanceof GenerationRequestError
            ? error.message
            : "任务状态暂时无法确认，不能一键重试，请稍后刷新查看",
        );
      }
    } finally {
      releaseTextTask(owner);
      setSubmitting(false);
    }
  };

  const resumeTextPolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setGenerationError("");
    const owner = claimTextTask(
      taskId,
      data.textGenerationOwnershipKey ?? rawGenerationInputFingerprint,
      data.textGenerationInputKey,
    );
    try {
      await flushCanvasSave();
      await finishTextTask(taskId, owner);
      const finished = getNodes().find((node) => node.id === id);
      if (finished?.data.textGenerationError) {
        setGenerationError(finished.data.textGenerationError);
      }
    } catch (error) {
      if (!ownsTextTask(owner)) return;
      if (isTransientPollingError(error)) {
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setGenerationError(POLLING_PAUSED_MESSAGE);
        return;
      }
      setGenerationError(
        error instanceof Error ? error.message : "文字生成失败，请稍后再试",
      );
    } finally {
      releaseTextTask(owner);
    }
  };

  const recheckTextTaskStatus = () => {
    if (
      unverifiedRecoveryTaskId &&
      unverifiedRecoveryTaskId === data.textGenerationTaskId
    ) {
      setRecoveryEpoch((current) => current + 1);
      return;
    }
    void resumeTextPolling();
  };

  return (
    <>
      <NodeToolbar
        className="text-node-toolbar nodrag nopan"
        data-testid="text-node-toolbar"
        isVisible={singleNodeChrome}
        offset={48}
        position={Position.Top}
      >
        {tools.map(([label, name], index) => (
          <span className="text-node-tool-slot" key={name}>
            {index === 1 || index === 5 || index === 10 ? (
              <span className="text-node-tool-separator" />
            ) : null}
            <button
              aria-label={label}
              className="text-node-tool"
              data-active={
                (name === "pin" && pinned) || (name === "save" && saved)
                  ? "true"
                  : undefined
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runTool(name)}
              title={label}
              type="button"
            >
              <ToolIcon name={name} />
            </button>
          </span>
        ))}
      </NodeToolbar>
      <NodeToolbar
        className="text-creator nodrag nopan nowheel"
        data-has-upstream={incomingInputs.length ? "true" : undefined}
        data-upstream-problem={upstreamProblem ? "true" : undefined}
        data-testid="text-creator"
        isVisible={singleNodeChrome}
        offset={16}
        position={Position.Bottom}
      >
        {selectedTextModel ? (
          <NodeParameterControl
            keys={textInputParameterKeys}
            onChange={(key, value) => {
              if (Object.is(textParameters[key], value)) return;
              revokeTextTaskForGenerationInputChange();
              setNodes((nodes) => nodes.map((node) => node.id === id
                ? {
                    ...node,
                    data: {
                      ...clearFailedTextGeneration(node.data),
                      textParameters: { ...textParameters, [key]: value },
                    },
                  }
                : node));
            }}
            onEditSessionStart={checkpoint}
            schema={textParameterSchema}
            values={textParameters}
          />
        ) : (
          <button
            aria-label="添加参考素材"
            className="text-creator-reference"
            disabled
            title="暂未开放"
            type="button"
          >
            +
          </button>
        )}
        <UpstreamInputCards
          disabled={Boolean(data.textGenerating || submitting || legacySubmissionBlocked)}
          inputs={inputPreflight.inputs}
          onMove={(edgeId, direction) => {
            revokeTextTaskForGenerationInputChange();
            checkpoint();
            setNodes((nodes) => nodes.map((node) => node.id === id
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node));
            setEdges((edges) => moveNodeInputEdge(edges, id, edgeId, direction));
          }}
          onRemove={(edgeId) => {
            revokeTextTaskForGenerationInputChange();
            checkpoint();
            setNodes((nodes) => nodes.map((node) => node.id === id
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node));
            setEdges((edges) => edges.filter((edge) => edge.id !== edgeId));
          }}
          onRoleChange={(edgeId, role) => {
            revokeTextTaskForGenerationInputChange();
            checkpoint();
            setNodes((nodes) => nodes.map((node) => node.id === id
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node));
            setEdges((edges) => edges.map((edge) => edge.id === edgeId
              ? { ...edge, data: { ...edge.data, inputRole: role } }
              : edge));
          }}
          problems={inputProblems}
          roleOptions={(input) => availableNodeInputRoles({
            kind: input.kind,
            modelSchema: selectedTextModel?.parameterSchema,
            parameters: textSubmissionParameters,
            targetKind: "text",
          })}
          testId="text-upstream-inputs"
        />
        <GenerationAvailabilityNotice
          canvasId={canvasId}
          kind="text"
          reason={textModelUnavailableReason}
        />
        {!incomingInputs.length && upstreamProblem && (
          <div
            className="upstream-input-problem"
            data-testid="upstream-input-problem"
            role="status"
          >
            {upstreamProblem}
          </div>
        )}
        <textarea
          aria-label="文字提示词"
          data-canvas-text-edit="graph"
          data-composition-active={promptControl.composing || undefined}
          data-testid="text-creator-prompt"
          onChange={(event) => {
            promptControl.change(
              event.target.value,
              (event.nativeEvent as InputEvent).isComposing,
            );
          }}
          onBlur={() => promptControl.blur()}
          onCompositionEnd={(event) => {
            promptControl.compositionEnd(event.currentTarget.value);
          }}
          onCompositionStart={() => {
            promptControl.compositionStart();
          }}
          onKeyDown={(event) => {
            promptControl.keyDown(event);
          }}
          placeholder="描述任何你想要生成的内容"
          value={promptControl.value}
        />
        <div className="text-creator-controls">
          <NodeModelControl
            capability="text"
            icon="text"
            onChange={(modelId, displayName) => {
              const nextModel = textModels?.find((model) => model.id === modelId);
              const nextSchema = nextModel?.parameterSchema ?? defaultParameterSchema("text");
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
                    targetKind: "text",
                  }), nextSchema)
                : undefined;
              if (blocked) {
                setModelSwitchProblem(`模型未切换：${blocked.message}`);
                return;
              }
              revokeTextTaskForGenerationInputChange();
              setModelSwitchProblem("");
              setServerInputProblems([]);
              checkpoint();
              setNodes((nodes) =>
                nodes.map((node) =>
                  node.id === id
                    ? {
                        ...node,
                        data: {
                          ...clearFailedTextGeneration(node.data),
                          textModelId: modelId,
                          textModelName: displayName,
                          textParameters: nextParameters,
                        },
                      }
                    : node,
                ),
              );
            }}
            selectedId={textModelSelection.selectedId}
            selectedName={textModelSelection.displayName}
          />
          {selectedTextModel && (
            <NodeParameterControl
              keys={textMainParameterKeys}
              onChange={(key, value) => {
                if (Object.is(textParameters[key], value)) return;
                revokeTextTaskForGenerationInputChange();
                setNodes((nodes) => nodes.map((node) => node.id === id
                  ? {
                      ...node,
                      data: {
                        ...clearFailedTextGeneration(node.data),
                        textParameters: { ...textParameters, [key]: value },
                      },
                    }
                  : node));
              }}
              onEditSessionStart={checkpoint}
              schema={textParameterSchema}
              values={textParameters}
            />
          )}
          <span className="text-creator-spacer" />
          <GenerationDurationHint label={finishedDurationLabel} />
          <button aria-label="语音输入" disabled title="暂未开放" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <rect height="11" rx="4" width="6" x="9" y="3" />
              <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
            </svg>
          </button>
          {selectedTextModel ? (
            <NodeParameterControl
              keys={textCountParameterKeys}
              onChange={(key, value) => {
                if (Object.is(textParameters[key], value)) return;
                revokeTextTaskForGenerationInputChange();
                setNodes((nodes) => nodes.map((node) => node.id === id
                  ? {
                      ...node,
                      data: {
                        ...clearFailedTextGeneration(node.data),
                        textParameters: { ...textParameters, [key]: value },
                      },
                    }
                  : node));
              }}
              onEditSessionStart={checkpoint}
              schema={textParameterSchema}
              values={textParameters}
            />
          ) : (
            <button aria-label="生成数量" disabled title="暂未开放" type="button">1×</button>
          )}
          {(pollingPausedTaskId ||
            (unverifiedRecoveryTaskId &&
              unverifiedRecoveryTaskId === data.textGenerationTaskId)) && (
            <button
              aria-label="重新检查任务状态"
              onClick={recheckTextTaskStatus}
              type="button"
            >
              重新检查
            </button>
          )}
          <button
            aria-label={retryableTask ? "Retry generation" : "Generate"}
            className="text-creator-generate"
            data-generating={displayTextGenerating || submitting || undefined}
            data-retrying={retryableTask || undefined}
            disabled={
              submitting ||
              recoveringTask ||
              data.textGenerating ||
              legacySubmissionBlocked ||
              isFixture ||
              (retryableTask
                ? !retryGenerationEnabled
                : canvasRevision === undefined) ||
              !selectedTextModel ||
              selectedTextModel.generationAvailable === false ||
              blockedFailedTask ||
              (!data.textGenerationTaskId && !inputPreflight.canSubmit)
            }
            onClick={() => {
              void (retryableTask
                ? retryText()
                : generateText());
            }}
            title={
              recoveringTask
                ? "正在恢复原生成任务状态"
                : displayTextGenerating
                  ? "正在生成文字"
                  : submitting
                    ? retryableTask
                      ? "正在重试原生成任务"
                      : "正在提交文字生成"
                    : (canvasRevision === undefined
                        ? "画布正在保存"
                        : undefined) ||
                      textModelUnavailableReason ||
                      (blockedFailedTask
                        ? retryBlockReason ||
                          "原任务与当前生成输入不一致，请修改内容后重新提交"
                        : undefined) ||
                      (retryableTask
                        ? `重试原任务：${generationError}`
                        : inputProblems[0]?.message ||
                          "生成文字")
            }
            type="button"
          >
            {displayTextGenerating || submitting || recoveringTask
              ? "…"
              : retryableTask
                ? "↻"
                : "↑"}
          </button>
        </div>
      </NodeToolbar>

      <NodeResizer
        color="transparent"
        isVisible={singleNodeChrome}
        minHeight={250}
        minWidth={250}
        onResizeStart={() => checkpoint()}
      />
      <Handle id="target" position={Position.Left} type="target">
        <span className="node-handle-hit node-handle-hit-left">
          <span className="node-handle-plus" />
        </span>
      </Handle>

      <div
        className="text-node-card"
        data-pinned={pinned || undefined}
        data-testid={`text-node-${id}`}
        style={{ background }}
      >
        <div
          className="canvas-node-title text-node-title nodrag"
          data-parent-group-id={parentId}
        >
          <svg aria-hidden="true" viewBox="0 0 14 14">
            <path d="M9.7 10.84H2.04M7.8 7H2.04M11.96 3.16H2.04" />
          </svg>
          {singleNodeChrome ? (
            <input
              aria-label="Text 标题"
              data-canvas-text-edit="graph"
              data-composition-active={titleControl.composing || undefined}
              data-testid="canvas-node-title"
              onBlur={() => titleControl.blur()}
              onChange={(event) => {
                titleControl.change(
                  event.target.value,
                  (event.nativeEvent as InputEvent).isComposing,
                );
              }}
              onCompositionEnd={(event) => {
                titleControl.compositionEnd(event.currentTarget.value);
              }}
              onCompositionStart={() => {
                titleControl.compositionStart();
              }}
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
          className={`text-node-editor-wrap${bodyEditing ? " nowheel nodrag" : ""}`}
          data-editing={bodyEditing}
          data-empty={empty}
          data-testid="canvas-node-text-content"
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (legacySubmissionBlocked) return;
            const { clientX, clientY } = event;
            setBodyEditing(true);
            requestAnimationFrame(() => {
              const editor = editorRef.current;
              if (!editor) {
                return;
              }

              editor.focus();
              const position = document.caretPositionFromPoint?.(
                clientX,
                clientY,
              );
              const range = position
                ? document.createRange()
                : document.caretRangeFromPoint?.(clientX, clientY);

              if (position && range) {
                range.setStart(position.offsetNode, position.offset);
                range.collapse(true);
              }

              if (!range || !editor.contains(range.startContainer)) {
                return;
              }

              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
            });
          }}
        >
          <div
            className={`text-node-editor${bodyEditing ? " ProseMirror-focused" : ""}`}
            contentEditable={bodyEditing}
            data-canvas-text-edit="graph"
            data-committed-rich-html={bodyControl.committedValue.html}
            data-composition-active={bodyControl.composing || undefined}
            data-testid="text-node-editor"
            onBlur={(event) => {
              const result = bodyControl.blur();
              bodyLocalValue.current = result.value;
              setEmpty(!result.value.text.trim());
              applyRichTextValue(event.currentTarget, result.value);
              event.currentTarget.dataset.committedRichHtml = result.value.html;
            }}
            onCompositionEnd={(event) => {
              const nextValue = editorRichTextValue(event.currentTarget);
              bodyLocalValue.current = nextValue;
              setEmpty(!nextValue.text.trim());
              bodyControl.compositionEnd(nextValue);
              event.currentTarget.dataset.committedRichHtml = nextValue.html;
            }}
            onCompositionStart={() => {
              revokeTextTaskForManualBodyEdit();
              bodyControl.compositionStart();
            }}
            onInput={(event) => {
              const nextValue = editorRichTextValue(event.currentTarget);
              bodyLocalValue.current = nextValue;
              setEmpty(!nextValue.text.trim());
              bodyControl.change(
                nextValue,
                (event.nativeEvent as InputEvent).isComposing,
              );
              if (!(event.nativeEvent as InputEvent).isComposing) {
                event.currentTarget.dataset.committedRichHtml = nextValue.html;
              }
            }}
            onKeyDown={(event) => {
              const historyValue = bodyControl.keyDown(event);
              if (historyValue !== undefined) {
                applyRichTextValue(event.currentTarget, historyValue);
                event.currentTarget.dataset.committedRichHtml = historyValue.html;
                bodyLocalValue.current = historyValue;
                setEmpty(!historyValue.text.trim());
                return;
              }
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                setBodyEditing(false);
                event.currentTarget.blur();
              }
            }}
            ref={editorRef}
            suppressContentEditableWarning
          />
        </div>
        <LegacyTerminalGenerationNotice state={legacyState} />
        {(displayTextGenerating || submitting) && (
          <div
            aria-label="文字生成中"
            className="text-node-generating"
            data-testid="text-node-generating"
            role="status"
          >
            <span
              className="image-node-generating-background text-node-generating-background"
              data-testid="text-node-generating-background"
            />
            <span
              className="image-node-loading-grid text-node-loading-grid"
              data-grid-columns="12"
              data-grid-rows="12"
              data-testid="text-node-loading-grid"
            />
          </div>
        )}
      </div>

      <Handle id="source" position={Position.Right} type="source">
        <span className="node-handle-hit node-handle-hit-right">
          <span className="node-handle-plus" />
        </span>
      </Handle>
      {fullscreen &&
        createPortal(
          <div
            className="image-detail-backdrop"
            data-testid="text-detail"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setFullscreen(false);
            }}
          >
            <div
              aria-label={`${titleControl.committedValue || "Text"} 文字详情`}
              aria-modal="true"
              className="image-detail-dialog text-detail-dialog"
              role="dialog"
            >
              <div className="image-detail-actions">
                <strong>{titleControl.committedValue || "Text"}</strong>
                <button onClick={() => copyTextContent()} type="button">
                  复制
                </button>
                <button
                  aria-label="关闭文字详情"
                  onClick={() => setFullscreen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div
                className="text-detail-body text-node-editor"
                data-testid="text-detail-body"
                dangerouslySetInnerHTML={{
                  __html: bodyControl.committedValue.html,
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
export const TextNode = memo(TextNodeImpl);
