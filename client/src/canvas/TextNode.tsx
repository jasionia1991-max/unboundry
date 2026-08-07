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
import type { ProbeNodeType } from "./ProbeNode";
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
  moveNodeInputEdge,
  resolveNodeInputs,
  type NodeInputProblem,
} from "../../../types/nodeInputs";
import { UpstreamInputCards } from "./UpstreamInputCards";
import { GenerationAvailabilityNotice } from "./GenerationAvailabilityNotice";
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
import {
  generationFailureMessage,
  generationInputKey as createGenerationInputKey,
  generationRetryBlockReason,
} from "../generation/generationRetry";
import {
  clearGenerationSubmissionIntent,
  ensureGenerationTask,
  GenerationRequestError,
  getGenerationTask,
  recoverPendingGenerationTask,
  retryGenerationTask,
  waitForGenerationTask,
  type GenerationTaskSummary,
} from "../generation/generationTasks";

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

function clearFailedTextGeneration(data: ProbeNodeType["data"]) {
  if (
    !data.textGenerationError &&
    !data.textGenerationInputKey &&
    !data.textGenerationTaskId
  ) return data;
  return {
    ...data,
    textGenerationError: undefined,
    textGenerationErrorCode: undefined,
    textGenerationInputKey: undefined,
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

function plainTextHtml(text: string) {
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
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const [background, setBackground] = useState("#1f1f1f");
  const [bodyEditing, setBodyEditing] = useState(false);
  const [empty, setEmpty] = useState(!data.content);
  const [pinned, setPinned] = useState(false);
  const [saved, setSaved] = useState(false);
  const [modelSwitchProblem, setModelSwitchProblem] = useState("");
  const [pollingPausedTaskId, setPollingPausedTaskId] = useState<string>();
  const pollingPausedTaskIdRef = useRef<string | undefined>(undefined);
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
  const [bodyValue, setBodyValue] = useState(() =>
    storedRichTextValue(data.content ?? "", data.contentHtml),
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const bodyLocalValue = useRef(bodyValue);
  const activeTaskRef = useRef<string | null>(null);
  const recoveryTaskRef = useRef<{
    controller: AbortController;
    taskId: string;
  } | null>(null);
  const { setEdges, setNodes } = useCanvasGraphMutation();
  const { getNodes } = useReactFlow<ProbeNodeType>();
  const { register: registerWorkflowNode } = useWorkflowExecution();
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
    model: selectedTextModel?.id,
    nodeId: id,
    ownPrompt: promptControl.committedValue,
    parameters: textSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  };
  const generationInputKey = createGenerationInputKey({
    inputs: inputPreflight.inputs,
    modelId: selectedTextModel?.id,
    ownPrompt: promptControl.committedValue,
    parameters: textSubmissionParameters,
    prompt: inputPreflight.finalPrompt,
  });
  const stableGenerationInputKey = useRef<string | undefined>(undefined);
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
    // Hydration and an in-flight save do not count as user input changes. Once
    // a durable revision exists, compare only the generation-relevant input.
    if (canvasRevision === undefined) return;
    if (stableGenerationInputKey.current === undefined) {
      stableGenerationInputKey.current = generationInputKey;
    }
    const persistedMismatch = Boolean(
      data.textGenerationInputKey &&
      data.textGenerationInputKey !== generationInputKey,
    );
    if (!persistedMismatch &&
        stableGenerationInputKey.current === generationInputKey) return;
    stableGenerationInputKey.current = generationInputKey;
    clearGenerationSubmissionIntent(
      "text",
      canvasId,
      id,
      data.textGenerationTaskId,
      accountId,
    );
    setGenerationError("");
    setServerInputProblems([]);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? { ...node, data: clearFailedTextGeneration(node.data) }
      : node));
  }, [
    canvasRevision,
    canvasId,
    data.textGenerationInputKey,
    data.textGenerationTaskId,
    generationInputKey,
    id,
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
      void navigator.clipboard
        .writeText(`${titleControl.committedValue}\n${editorRef.current?.innerText ?? ""}`)
        .catch(() => undefined);
    } else if (name === "save") {
      setSaved(true);
    } else {
      void cardRef.current?.requestFullscreen();
    }
  };

  const applyGeneratedText = (task: GenerationTaskSummary) => {
    const resultText = task.resultText?.trim() ?? "";
    if (!resultText) throw new Error("文字结果不完整");
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
            textGenerationRetryAllowed: undefined,
            textGenerationRetryBlockCode: undefined,
            textGenerationRetryBlockReason: undefined,
            textGenerating: false,
            textGenerationTaskId: task.id,
          },
        }
      : node));
    setGenerationError("");
    clearGenerationSubmissionIntent("text", canvasId, id, task.id, accountId);
  };

  const persistTextGenerationFailure = (
    taskId: string,
    message: string,
    errorCode?: string,
    retryAllowed = false,
    retryBlockCode?: string,
    retryBlockReason?: string,
  ) => {
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
            textGenerationInputKey: generationInputKey,
            textGenerationRetryAllowed: retryAllowed,
            textGenerationRetryBlockCode: retryBlockCode,
            textGenerationRetryBlockReason: retryBlockReason,
            textGenerating: false,
            textGenerationTaskId: taskId,
          },
        }
      : node));
  };

  const persistTextGenerationCancellation = (taskId: string, message: string) => {
    setGenerationError(message);
    setNodes((nodes) => nodes.map((node) => node.id === id
      ? {
          ...node,
          data: {
            ...node.data,
            textGenerationError: message,
            textGenerationErrorCode: undefined,
            textGenerationInputKey: undefined,
            textGenerationRetryAllowed: undefined,
            textGenerationRetryBlockCode: undefined,
            textGenerationRetryBlockReason: undefined,
            textGenerating: false,
            textGenerationTaskId: undefined,
          },
        }
      : node));
    clearGenerationSubmissionIntent("text", canvasId, id, taskId, accountId);
  };

  const finishTextTask = async (taskId: string, signal?: AbortSignal) => {
    let task: Awaited<ReturnType<typeof waitForGenerationTask>>;
    try {
      task = await waitForGenerationTaskWithPause(taskId, () => {
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setGenerationError(POLLING_PAUSED_MESSAGE);
      }, signal);
    } catch (error) {
      if (pollingPausedTaskIdRef.current === taskId) return;
      throw error;
    }
    if (task.state === "success") {
      applyGeneratedText(task);
      pollingPausedTaskIdRef.current = undefined;
      setPollingPausedTaskId(undefined);
      return;
    }
    if (task.state === "cancelled") {
      persistTextGenerationCancellation(
        taskId,
        task.errorMessage ?? "文字生成已取消",
      );
      return;
    }
    persistTextGenerationFailure(
      taskId,
      task.errorMessage ?? "文字生成失败，请稍后再试",
      task.errorCode,
      task.retryAllowed === true,
      task.retryBlockCode,
      task.retryBlockReason,
    );
  };

  useEffect(() => {
    const taskId = data.textGenerationTaskId;
    if (
      !taskId ||
      !selectedTextModel ||
      activeTaskRef.current === taskId ||
      recoveryTaskRef.current?.taskId === taskId ||
      (!data.textGenerating && data.content)
    ) return;
    const controller = new AbortController();
    const recovery = { controller, taskId };
    recoveryTaskRef.current = recovery;
    setRecoveringTask(true);
    void getGenerationTask(taskId, controller.signal)
      .then(async (task) => {
        if (task.state === "success") {
          applyGeneratedText(task);
          return;
        }
        if (["queued", "running", "retrying", "recovering"].includes(task.state)) {
          await finishTextTask(taskId, controller.signal);
          return;
        }
        if (task.state === "cancelled") {
          persistTextGenerationCancellation(
            taskId,
            task.errorMessage ?? "文字生成已取消",
          );
          return;
        }
        const retainPersistedBlock =
          data.textGenerationRetryAllowed === false;
        persistTextGenerationFailure(
          taskId,
          retainPersistedBlock && data.textGenerationError
            ? data.textGenerationError
            : task.errorMessage ?? "文字生成失败，可重试",
          retainPersistedBlock ? data.textGenerationErrorCode : task.errorCode,
          retainPersistedBlock ? false : task.retryAllowed === true,
          retainPersistedBlock
            ? data.textGenerationRetryBlockCode
            : task.retryBlockCode,
          retainPersistedBlock
            ? data.textGenerationRetryBlockReason
            : task.retryBlockReason,
        );
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGenerationError(error instanceof Error ? error.message : "文字任务恢复失败");
      })
      .finally(() => {
        if (recoveryTaskRef.current === recovery) {
          recoveryTaskRef.current = null;
          setRecoveringTask(false);
        }
      });
    return () => {
      controller.abort();
      // React development mode deliberately mounts effects twice. Release only
      // this recovery run synchronously so its replacement can start, while an
      // older promise cannot clear the replacement in its later `finally`.
      if (recoveryTaskRef.current === recovery) {
        recoveryTaskRef.current = null;
        setRecoveringTask(false);
      }
    };
  // A persisted in-flight task must still replace the previous Text content
  // after refresh. Manual edits clear both textGenerating and the task id, so
  // an already-finished task cannot overwrite later user work.
  }, [
    data.content,
    data.textGenerating,
    data.textGenerationError,
    data.textGenerationErrorCode,
    data.textGenerationRetryAllowed,
    data.textGenerationRetryBlockCode,
    data.textGenerationRetryBlockReason,
    data.textGenerationTaskId,
    generationInputKey,
    selectedTextModel?.id,
  ]);

  useEffect(() => {
    if (
      data.textGenerationTaskId ||
      !selectedTextModel ||
      isFixture ||
      (!data.textGenerating && data.content)
    ) return;
    const controller = new AbortController();
    void recoverPendingGenerationTask(
      "text",
      canvasId,
      id,
      controller.signal,
      textGenerationRequestInput,
      accountId,
    )
      .then(async (task) => {
        if (!task) return;
        setNodes((nodes) => nodes.map((node) => node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                textGenerationError: undefined,
                textGenerationErrorCode: undefined,
                textGenerationInputKey: generationInputKey,
                textGenerationRetryAllowed: undefined,
                textGenerationRetryBlockCode: undefined,
                textGenerationRetryBlockReason: undefined,
                textGenerating: !["success", "failed", "cancelled"].includes(task.state),
                textGenerationTaskId: task.id,
              },
            }
          : node));
        if (task.state === "success") {
          applyGeneratedText(task);
        } else if (["queued", "running", "retrying", "recovering"].includes(task.state)) {
          await finishTextTask(task.id, controller.signal);
        } else if (task.state === "cancelled") {
          persistTextGenerationCancellation(
            task.id,
            task.errorMessage ?? "文字生成已取消",
          );
        } else {
          persistTextGenerationFailure(
            task.id,
            task.errorMessage ?? "文字生成失败，可重试",
            task.errorCode,
            task.retryAllowed === true,
            task.retryBlockCode,
            task.retryBlockReason,
          );
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGenerationError(error instanceof Error ? error.message : "文字任务恢复失败");
      });
    return () => controller.abort();
  }, [
    canvasId,
    data.content,
    data.textGenerating,
    data.textGenerationTaskId,
    generationInputKey,
    id,
    selectedTextModel?.id,
  ]);

  const generateText = async (): Promise<NodeGenerationOutcome> => {
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
    let taskId: string | undefined;
    try {
      await flushCanvasSave();
      const { task: submitted } = await ensureGenerationTask(
        "text",
        textGenerationRequestInput,
        accountId,
      );
      taskId = submitted.id;
      activeTaskRef.current = taskId;
      checkpoint();
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              textGenerationError: undefined,
              textGenerationErrorCode: undefined,
              textGenerationInputKey: generationInputKey,
              textGenerationRetryAllowed: undefined,
              textGenerationRetryBlockCode: undefined,
              textGenerationRetryBlockReason: undefined,
              textGenerating: true,
              textGenerationTaskId: submitted.id,
            },
          }
        : node));
      await finishTextTask(submitted.id);
      if (pollingPausedTaskIdRef.current === submitted.id) {
        return { message: POLLING_PAUSED_MESSAGE, status: "failed" };
      }
      const finished = getNodes().find((node) => node.id === id);
      if (
        finished?.data.textGenerationError ||
        finished?.data.textGenerationErrorCode
      ) {
        return {
          message: friendlyGenerationMessage(
            finished.data.textGenerationError,
            "text",
          ),
          status: "failed",
        };
      }
      return { status: "success" };
    } catch (error) {
      if (error instanceof GenerationRequestError && error.problems.length) {
        setServerInputProblems(error.problems);
      }
      const message = error instanceof Error
        ? error.message
        : generationMessageFallback("text");
      const friendly = friendlyGenerationMessage(message, "text");
      if (taskId) {
        persistTextGenerationFailure(
          taskId,
          friendly,
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
      } else {
        setGenerationError(friendly);
      }
      return { message: friendly, status: "failed" };
    } finally {
      if (taskId && activeTaskRef.current === taskId) activeTaskRef.current = null;
      setSubmitting(false);
    }
  };

  const runWorkflowNode = async (): Promise<NodeRunResult> => {
    const before = getNodes().find((node) => node.id === id);
    if (!before) return { status: "failed" };
    if (isFixture || canvasRevision === undefined) {
      return { status: "skipped" };
    }
    if (
      before.data.textGenerating === true ||
      before.data.inputState === "uploading"
    ) {
      return { message: "节点正在生成中", status: "busy" };
    }
    const outcome = await generateText();
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
          "text",
        ),
      }),
    [id, registerWorkflowNode, waitForCanvasRevision],
  );

  const retryText = async () => {
    const taskId = data.textGenerationTaskId;
    if (
      !taskId ||
      !retryableTask ||
      submitting ||
      data.textGenerating ||
      !selectedTextModel ||
      selectedTextModel.generationAvailable === false
    ) return;
    setSubmitting(true);
    setGenerationError("");
    activeTaskRef.current = taskId;
    try {
      await retryGenerationTask(taskId);
      setNodes((nodes) => nodes.map((node) => node.id === id
        ? {
            ...node,
            data: {
              ...node.data,
              textGenerationError: undefined,
              textGenerationErrorCode: undefined,
              textGenerationInputKey: generationInputKey,
              textGenerationRetryAllowed: undefined,
              textGenerationRetryBlockCode: undefined,
              textGenerationRetryBlockReason: undefined,
              textGenerating: true,
            },
          }
        : node));
      await finishTextTask(taskId);
    } catch (error) {
      persistTextGenerationFailure(
        taskId,
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
    } finally {
      if (activeTaskRef.current === taskId) activeTaskRef.current = null;
      setSubmitting(false);
    }
  };

  const resumeTextPolling = async () => {
    const taskId = pollingPausedTaskIdRef.current;
    if (!taskId) return;
    pollingPausedTaskIdRef.current = undefined;
    setPollingPausedTaskId(undefined);
    setGenerationError("");
    try {
      await finishTextTask(taskId);
      const finished = getNodes().find((node) => node.id === id);
      if (finished?.data.textGenerationError) {
        setGenerationError(finished.data.textGenerationError);
      }
    } catch (error) {
      if (isTransientPollingError(error)) {
        pollingPausedTaskIdRef.current = taskId;
        setPollingPausedTaskId(taskId);
        setGenerationError(POLLING_PAUSED_MESSAGE);
        return;
      }
      setGenerationError(
        error instanceof Error ? error.message : "文字生成失败，请稍后再试",
      );
    }
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
          disabled={Boolean(data.textGenerating || submitting)}
          inputs={inputPreflight.inputs}
          onMove={(edgeId, direction) => {
            checkpoint();
            setNodes((nodes) => nodes.map((node) => node.id === id
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node));
            setEdges((edges) => moveNodeInputEdge(edges, id, edgeId, direction));
          }}
          onRemove={(edgeId) => {
            checkpoint();
            setNodes((nodes) => nodes.map((node) => node.id === id
              ? { ...node, data: clearFailedTextGeneration(node.data) }
              : node));
            setEdges((edges) => edges.filter((edge) => edge.id !== edgeId));
          }}
          onRoleChange={(edgeId, role) => {
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
              setModelSwitchProblem("");
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
          {pollingPausedTaskId && (
            <button
              aria-label="重新检查任务状态"
              onClick={() => void resumeTextPolling()}
              type="button"
            >
              重新检查
            </button>
          )}
          <button
            aria-label={retryableTask ? "Retry generation" : "Generate"}
            className="text-creator-generate"
            data-generating={data.textGenerating || submitting || undefined}
            data-retrying={retryableTask || undefined}
            disabled={
              submitting ||
              recoveringTask ||
              data.textGenerating ||
              isFixture ||
              canvasRevision === undefined ||
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
                : data.textGenerating
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
            {data.textGenerating || submitting || recoveringTask
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
        ref={cardRef}
        style={{ background }}
      >
        <div className="text-node-title nodrag">
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
            <span>{titleControl.committedValue}</span>
          )}
        </div>

        <div
          className={`text-node-editor-wrap nowheel${bodyEditing ? " nodrag" : ""}`}
          data-editing={bodyEditing}
          data-empty={empty}
          data-testid="canvas-node-text-content"
          onDoubleClick={(event) => {
            event.stopPropagation();
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
      </div>

      <Handle id="source" position={Position.Right} type="source">
        <span className="node-handle-hit node-handle-hit-right">
          <span className="node-handle-plus" />
        </span>
      </Handle>
    </>
  );
}
export const TextNode = memo(TextNodeImpl);
