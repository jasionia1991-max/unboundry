import {
  NodeResizer,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import { useCanvasAccount } from "./CanvasAccountContext";
import {
  serializeGroupTemplate,
  stripPrivateMediaForPublicTemplate,
} from "./groupTemplate";
import type { ProbeNodeType } from "./ProbeNode";
import type { CuttableEdge } from "./canvasTypes";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";
import { useWorkflowExecution } from "../generation/WorkflowExecutionProvider";
import {
  createGroupRunSummaryScope,
  formatGenerationDuration,
  GROUP_RUN_SUMMARY_EVENT,
  groupRunSummaryMatchesScope,
  readLastGroupRunSummaryForGroup,
  type GroupRunSummary,
} from "../generation/groupRunSummary";
import { GenerationDurationHint } from "./GenerationDurationHint";
import { isExecutableWorkflowNode } from "../generation/workflowExecution";
import { GrayMenuSelect } from "../ui/GrayMenuSelect";

const colors = [
  "transparent",
  "rgba(239, 68, 68, 0.16)",
  "rgba(249, 115, 22, 0.16)",
  "rgba(234, 179, 8, 0.16)",
  "rgba(34, 197, 94, 0.16)",
  "rgba(6, 182, 212, 0.16)",
  "rgba(59, 130, 246, 0.16)",
  "rgba(168, 85, 247, 0.16)",
];

function nodeSize(node: ProbeNodeType) {
  return {
    height:
      node.measured?.height ??
      (typeof node.style?.height === "number" ? node.style.height : 0),
    width:
      node.measured?.width ??
      (typeof node.style?.width === "number" ? node.style.width : 0),
  };
}

function GroupNodeImpl({
  data,
  dragging,
  id,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected, dragging);
  const checkpoint = useCanvasCheckpoint();
  const { getEdges, getNodes } = useReactFlow<ProbeNodeType>();
  const { setNodes } = useCanvasGraphMutation();
  const { accountId, canvasId, fixtureScopeId, isFixture, notify } =
    useGenerationCanvas();
  const groupRunScope = createGroupRunSummaryScope(
    accountId,
    canvasId,
    fixtureScopeId,
  );
  const { canManagePublicTemplates } = useCanvasAccount();
  const { cancelGroup, executeGroup, executingGroupIds } =
    useWorkflowExecution();
  const executing = executingGroupIds.has(id);
  const showGroupToolbar = singleNodeChrome || executing;
  const [lastGroupRun, setLastGroupRun] = useState(
    () => readLastGroupRunSummaryForGroup(groupRunScope, id),
  );
  const allNodes = getNodes();
  const childNodes = allNodes.filter((node) => node.parentId === id);
  const incomingTextTargets = new Set(
    getEdges()
      .filter(
        (edge) =>
          allNodes.find((node) => node.id === edge.source)?.type === "text",
      )
      .map((edge) => edge.target),
  );
  const hasExecutableChild = childNodes.some((node) =>
    isExecutableWorkflowNode(node, {
      hasIncomingText: incomingTextTargets.has(node.id),
    }),
  );
  const [colorMenu, setColorMenu] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateDestination, setTemplateDestination] = useState<
    "mine" | "public"
  >("mine");
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => {
    setLastGroupRun(readLastGroupRunSummaryForGroup(groupRunScope, id));
    const onSummary = (event: Event) => {
      const summary = (event as CustomEvent<GroupRunSummary>).detail;
      if (
        !summary ||
        !groupRunSummaryMatchesScope(summary, groupRunScope) ||
        summary.groupId !== id
      ) {
        return;
      }
      setLastGroupRun(summary);
    };
    window.addEventListener(GROUP_RUN_SUMMARY_EVENT, onSummary);
    return () => window.removeEventListener(GROUP_RUN_SUMMARY_EVENT, onSummary);
  }, [accountId, canvasId, fixtureScopeId, id]);
  const titleControl = useCompositionSafeText({
    onCommit: (title) => {
      if (executing) return;
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, title } }
            : node,
        ),
      );
    },
    onEditSessionStart: checkpoint,
    value: data.title ?? "新建组",
  });

  useEffect(() => {
    if (!singleNodeChrome) {
      setColorMenu(false);
      setLayoutMenu(false);
      setTemplateDialogOpen(false);
    }
  }, [singleNodeChrome]);

  useEffect(() => {
    if (!executing) return;
    setColorMenu(false);
    setLayoutMenu(false);
    setTemplateDialogOpen(false);
  }, [executing]);

  useEffect(() => {
    if (!templateDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !templateSaving) {
        setTemplateDialogOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [templateDialogOpen, templateSaving]);

  const updateData = (patch: Partial<ProbeNodeType["data"]>) => {
    if (executing) return;
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
    );
  };
  const ungroup = () => {
    if (executing) return;
    checkpoint();
    setNodes((nodes) => {
      const group = nodes.find((node) => node.id === id);
      if (!group) return nodes;
      return nodes
        .filter((node) => node.id !== id)
        .map((node) =>
          node.parentId === id
            ? {
                ...node,
                parentId: undefined,
                position: {
                  x: group.position.x + node.position.x,
                  y: group.position.y + node.position.y,
                },
                selected: true,
                zIndex: 0,
              }
            : node,
        );
    });
  };

  const layout = (mode: "grid" | "horizontal") => {
    if (executing) return;
    checkpoint();
    setNodes((nodes) => {
      const children = nodes.filter((node) => node.parentId === id);
      if (!children.length) return nodes;
      const sizes = children.map(nodeSize);
      const gap = 20;
      const padding = 20;
      const columns =
        mode === "horizontal" ? children.length : Math.ceil(Math.sqrt(children.length));
      const cellWidth = Math.max(...sizes.map((size) => size.width));
      const cellHeight = Math.max(...sizes.map((size) => size.height));
      const rows = Math.ceil(children.length / columns);
      const positions = new Map(
        children.map((child, index) => [
          child.id,
          {
            x: padding + (index % columns) * (cellWidth + gap),
            y: padding + Math.floor(index / columns) * (cellHeight + gap),
          },
        ]),
      );
      return nodes.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            style: {
              ...node.style,
              height: padding * 2 + rows * cellHeight + (rows - 1) * gap,
              width:
                padding * 2 +
                Math.min(columns, children.length) * cellWidth +
                (Math.min(columns, children.length) - 1) * gap,
            },
          };
        }
        const position = positions.get(node.id);
        return position ? { ...node, position } : node;
      });
    });
    setLayoutMenu(false);
  };

  const downloadAll = async () => {
    const children = getNodes().filter((node) => node.parentId === id);
    if (isFixture) {
      // 验收页不触达真实服务端，沿用逐素材下载行为供 fixture 检查。
      for (const [index, child] of children.entries()) {
        const source =
          child.data.imageSrc ?? child.data.videoSrc ?? child.data.audioSrc;
        if (!source) continue;
        const link = document.createElement("a");
        link.href = source;
        link.download = `${index + 1}-${child.data.title ?? child.data.label}`;
        link.click();
      }
      return;
    }
    if (downloadBusy) return;
    setDownloadBusy(true);
    notify("正在打包生成结果…");
    try {
      const response = await fetch(
        `/api/canvas/${encodeURIComponent(canvasId)}/group-download`,
        {
          body: JSON.stringify({ groupId: id }),
          headers: {
            Accept: "application/zip",
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
        };
        if (body.code === "INSUFFICIENT_STORAGE") {
          throw new Error("磁盘空间不足，请稍后再试");
        }
        if (body.code === "RESOURCE_BUSY") {
          throw new Error("打包人数较多，请稍后再试");
        }
        throw new Error(body.error ?? "下载失败");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filename = filenameMatch
        ? decodeURIComponent(filenameMatch[1])
        : "工作流结果.zip";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      notify("下载完成", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "下载失败",
        "error",
      );
    } finally {
      setDownloadBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (executing) return;
    const title = templateTitle.trim();
    if (title.length < 1 || title.length > 40) {
      setTemplateError("模板标题需为 1–40 个字符");
      return;
    }
    const publishPublic =
      canManagePublicTemplates && templateDestination === "public";
    setTemplateSaving(true);
    setTemplateError("");
    try {
      const graph = serializeGroupTemplate({
        edges: getEdges() as CuttableEdge[],
        groupId: id,
        nodes: getNodes(),
      });
      const children = getNodes().filter((node) => node.parentId === id);
      const response = publishPublic
        ? await fetch("/api/admin/templates", {
            body: JSON.stringify({
              category: templateCategory ? [templateCategory] : undefined,
              graph: stripPrivateMediaForPublicTemplate(graph),
              status: "published",
              title,
            }),
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            method: "POST",
          })
        : await fetch("/api/templates", {
            body: JSON.stringify({
              category: templateCategory || undefined,
              graph,
              nodeIds: children.map((node) => node.id),
              sourceCanvasId: canvasId,
              title,
            }),
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            method: "POST",
          });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.error ?? (publishPublic ? "公共模板发布失败" : "模板保存失败"),
        );
      }
      notify(
        publishPublic ? "已发布到公共模板" : "模板已保存到我的模板",
        "success",
      );
      setTemplateDialogOpen(false);
      setTemplateTitle("");
      setTemplateCategory("");
      setTemplateDestination("mine");
    } catch (error) {
      setTemplateError(
        error instanceof Error
          ? error.message
          : publishPublic
            ? "公共模板发布失败"
            : "模板保存失败",
      );
    } finally {
      setTemplateSaving(false);
    }
  };

  const childCount = getNodes().filter((node) => node.parentId === id).length;
  const hasDownload = getNodes().some(
    (node) =>
      node.parentId === id &&
      Boolean(node.data.imageSrc ?? node.data.videoSrc ?? node.data.audioSrc),
  );

  useEffect(() => {
    const canvasWorld = document.querySelector<HTMLElement>(
      '[data-testid="canvas-world"]',
    );
    if (!canvasWorld) return;
    const reveal = selected || titleHovered;
    const childTitles = canvasWorld.querySelectorAll<HTMLElement>(
      ".canvas-node-title[data-parent-group-id]",
    );
    childTitles.forEach((title) => {
      if (title.dataset.parentGroupId === id) {
        title.toggleAttribute("data-group-title-revealed", reveal);
      }
    });
    return () => {
      childTitles.forEach((title) => {
        if (title.dataset.parentGroupId === id) {
          title.removeAttribute("data-group-title-revealed");
        }
      });
    };
  }, [childCount, id, selected, titleHovered]);

  return (
    <>
      <NodeResizer
        isVisible={singleNodeChrome && !executing}
        minHeight={147}
        minWidth={312}
        onResizeStart={() => checkpoint()}
      />
      {singleNodeChrome && !executing && (
        <GenerationDurationHint
          label={
            lastGroupRun
              ? `上次 ${formatGenerationDuration(lastGroupRun.elapsedMs)}`
              : undefined
          }
          testId="group-last-duration"
        />
      )}
      {showGroupToolbar && (
        <div
          className="group-node-toolbar nodrag nopan"
          data-testid="group-node-toolbar"
        >
          <button
            aria-label="组合框颜色"
            disabled={executing}
            onClick={() => {
              setColorMenu((open) => !open);
              setLayoutMenu(false);
            }}
            type="button"
          >
            <span
              className="group-color-dot"
              style={{ background: data.groupColor ?? "transparent" }}
            />
          </button>
          <button
            aria-label="组合框布局"
            disabled={executing}
            onClick={() => {
              setLayoutMenu((open) => !open);
              setColorMenu(false);
            }}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <rect height="6" rx="1" width="6" x="4" y="4" />
              <rect height="6" rx="1" width="6" x="14" y="4" />
              <rect height="6" rx="1" width="6" x="4" y="14" />
              <rect height="6" rx="1" width="6" x="14" y="14" />
            </svg>
          </button>
          <button
            aria-label={executing ? "停止后续节点" : "整组执行"}
            data-testid="group-execute-button"
            disabled={!hasExecutableChild || isFixture}
            onClick={(event) => {
              if (executing) {
                // A fast second click from the original start double-click can
                // arrive after React has switched the button to “stop”. Treat
                // that pair as one start; a later single click still stops.
                if (event.detail > 1) return;
                cancelGroup(id);
              } else {
                void executeGroup(id);
              }
            }}
            title={
              isFixture
                ? "验收页面不会触发真实生成"
                : !hasExecutableChild
                  ? "组内没有可执行的生成节点"
                  : executing
                    ? "停止后续节点；已经开始的任务会继续并保存结果"
                    : "整组执行"
            }
            type="button"
          >
            {executing && (
              <span
                aria-hidden="true"
                className="group-execute-spinner"
              />
            )}
            {executing ? "停止后续" : "整组执行"}
          </button>
          <button
            data-testid="group-template-button"
            disabled={executing || isFixture || childCount === 0}
            onClick={() => {
              setTemplateError("");
              setTemplateTitle("");
              setTemplateCategory("");
              setTemplateDestination("mine");
              setTemplateDialogOpen(true);
            }}
            title={
              isFixture
                ? "验收页面不会保存模板"
                : childCount === 0
                  ? "组内没有节点可保存"
                  : data.groupTemplate
                    ? "更新模板"
                    : "创建模板"
            }
            type="button"
          >
            {data.groupTemplate ? "更新模板" : "创建模板"}
          </button>
          <button disabled={executing} onClick={ungroup} type="button">
            解组
          </button>
          <button
            aria-label="下载全部"
            data-testid="group-download-button"
            disabled={
              (isFixture ? !hasDownload : childCount === 0) || downloadBusy
            }
            onClick={() => void downloadAll()}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 3v12m-4-4 4 4 4-4M5 20h14" />
            </svg>
          </button>
          {colorMenu && (
            <div className="group-color-menu" role="menu">
              {colors.map((color) => (
                <button
                  aria-label={color === "transparent" ? "清除颜色" : "设置颜色"}
                  disabled={executing}
                  key={color}
                  onClick={() => {
                    checkpoint();
                    updateData({ groupColor: color });
                    setColorMenu(false);
                  }}
                  style={{ background: color }}
                  type="button"
                />
              ))}
            </div>
          )}
          {layoutMenu && (
            <div className="group-layout-menu" role="menu">
              <button
                disabled={executing}
                onClick={() => layout("grid")}
                type="button"
              >
                宫格
              </button>
              <button
                disabled={executing}
                onClick={() => layout("horizontal")}
                type="button"
              >
                水平
              </button>
            </div>
          )}
        </div>
      )}
      <div
        className="canvas-node-title group-node-title nodrag"
        onPointerEnter={() => setTitleHovered(true)}
        onPointerLeave={() => setTitleHovered(false)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect height="12" rx="2" width="14" x="3" y="7" />
          <path d="M7 7V4h14v12h-4" />
        </svg>
        {singleNodeChrome ? (
          <input
            aria-label="组合框标题"
            disabled={executing}
            data-canvas-text-edit="graph"
            data-composition-active={titleControl.composing || undefined}
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
                event.key === "Enter" &&
                !titleControl.composing &&
                !event.nativeEvent.isComposing
              ) {
                event.currentTarget.blur();
              }
            }}
            value={titleControl.value}
          />
        ) : (
          <span title={titleControl.committedValue}>
            {titleControl.committedValue}
          </span>
        )}
      </div>
      <div
        className="group-node-body"
        data-child-count={childCount}
        data-testid={`group-node-${id}`}
        data-workflow-run-active={executing ? "true" : undefined}
        onPointerEnter={() => setTitleHovered(true)}
        onPointerLeave={() => setTitleHovered(false)}
        style={{ background: data.groupColor ?? "transparent" }}
      />
      {templateDialogOpen && createPortal(
        <div
          className="group-template-dialog-backdrop"
          data-testid="group-template-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !templateSaving) {
              setTemplateDialogOpen(false);
            }
          }}
        >
          <div
            aria-label="保存为模板"
            aria-modal="true"
            className="group-template-dialog"
            role="dialog"
          >
            <h2>{data.groupTemplate ? "更新模板" : "保存为模板"}</h2>
            <label className="group-template-title-field">
              <span>模板标题</span>
              <input
                aria-label="模板标题"
                maxLength={40}
                onChange={(event) => {
                  setTemplateTitle(event.target.value);
                  setTemplateError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !templateSaving) {
                    event.preventDefault();
                    void saveTemplate();
                  }
                }}
                placeholder="输入模板标题"
                spellCheck={false}
                value={templateTitle}
              />
            </label>
            <label className="group-template-category-field">
              <span>模板分类（可选）</span>
              <GrayMenuSelect
                ariaLabel="模板分类"
                onChange={setTemplateCategory}
                options={[
                  { label: "不选分类", value: "" },
                  { label: "电商", value: "电商" },
                  { label: "广告", value: "广告" },
                  { label: "影视", value: "影视" },
                  { label: "生活", value: "生活" },
                  { label: "工具", value: "工具" },
                  { label: "有趣", value: "有趣" },
                  { label: "ACG", value: "ACG" },
                  { label: "Seedance 2.0", value: "Seedance 2.0" },
                ]}
                placeholder="不选分类"
                testId="group-template-category"
                value={templateCategory}
              />
            </label>
            {canManagePublicTemplates && (
              <fieldset
                className="group-template-destination"
                data-testid="group-template-destination"
              >
                <legend>保存到</legend>
                <label>
                  <input
                    checked={templateDestination === "mine"}
                    name="group-template-destination"
                    onChange={() => setTemplateDestination("mine")}
                    type="radio"
                    value="mine"
                  />
                  <span>我的模板</span>
                </label>
                <label>
                  <input
                    checked={templateDestination === "public"}
                    data-testid="group-template-destination-public"
                    name="group-template-destination"
                    onChange={() => setTemplateDestination("public")}
                    type="radio"
                    value="public"
                  />
                  <span>公共模板（所有人可见）</span>
                </label>
                {templateDestination === "public" && (
                  <p className="group-template-destination-hint">
                    所有账号都能看见并导入。组里的图会变成空上传位，提示词和连线会留下。
                  </p>
                )}
              </fieldset>
            )}
            {templateError && (
              <p className="group-template-error" role="alert">
                {templateError}
              </p>
            )}
            <div className="group-template-dialog-actions">
              <button
                disabled={templateSaving}
                onClick={() => setTemplateDialogOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                data-testid="group-template-submit"
                disabled={templateSaving}
                onClick={() => void saveTemplate()}
                type="button"
              >
                {templateSaving ? "保存中…" : "保存模板"}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  );
}
export const GroupNode = memo(GroupNodeImpl);
