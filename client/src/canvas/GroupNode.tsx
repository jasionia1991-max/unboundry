import {
  NodeResizer,
  useReactFlow,
  useViewport,
  type NodeProps,
} from "@xyflow/react";
import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useCanvasCheckpoint } from "./CanvasHistory";
import { useCanvasGraphMutation } from "./CanvasGraphMutationContext";
import { useSingleNodeChrome } from "./CanvasSelectionContext";
import { useCompositionSafeText } from "./CompositionSafeText";
import type { ProbeNodeType } from "./ProbeNode";
import { useGenerationCanvas } from "../generation/GenerationCanvasContext";
import { useWorkflowExecution } from "../generation/WorkflowExecutionProvider";
import { isExecutableWorkflowNode } from "../generation/workflowExecution";

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

export function GroupNode({
  data,
  id,
  selected,
}: NodeProps<ProbeNodeType>) {
  const singleNodeChrome = useSingleNodeChrome(selected);
  const checkpoint = useCanvasCheckpoint();
  const { getEdges, getNode, getNodes } = useReactFlow<ProbeNodeType>();
  const { setNodes } = useCanvasGraphMutation();
  const { zoom } = useViewport();
  const { isFixture } = useGenerationCanvas();
  const { cancelGroup, executeGroup, executingGroupIds } =
    useWorkflowExecution();
  const executing = executingGroupIds.has(id);
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
  const titleControl = useCompositionSafeText({
    onCommit: (title) => {
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
    }
  }, [singleNodeChrome]);

  const updateData = (patch: Partial<ProbeNodeType["data"]>) =>
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
    );
  const beginMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const group = getNode(id);
    if (!group) return;
    event.preventDefault();
    event.stopPropagation();
    checkpoint();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = group.position;
    setNodes((nodes) =>
      nodes.map((node) => ({ ...node, selected: node.id === id })),
    );
    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                position: {
                  x: start.x + (pointerEvent.clientX - startX) / zoom,
                  y: start.y + (pointerEvent.clientY - startY) / zoom,
                },
              }
            : node,
        ),
      );
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  const ungroup = () => {
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

  const downloadAll = () => {
    const children = getNodes().filter((node) => node.parentId === id);
    for (const [index, child] of children.entries()) {
      const source =
        child.data.imageSrc ?? child.data.videoSrc ?? child.data.audioSrc;
      if (!source) continue;
      const link = document.createElement("a");
      link.href = source;
      link.download = `${index + 1}-${child.data.title ?? child.data.label}`;
      link.click();
    }
  };

  const scale = 1 / Math.max(zoom, 0.01);
  const toolbarStyle = {
    left: "50%",
    marginLeft: -195 * scale,
    top: -94 * scale,
    transform: `scale(${scale})`,
  };
  const titleStyle = {
    left: 4 * scale,
    top: -28 * scale,
    transform: `scale(${scale})`,
  };
  const childCount = getNodes().filter((node) => node.parentId === id).length;
  const hasDownload = getNodes().some(
    (node) =>
      node.parentId === id &&
      Boolean(node.data.imageSrc ?? node.data.videoSrc ?? node.data.audioSrc),
  );

  return (
    <>
      <NodeResizer
        handleStyle={{
          height: 24 * scale,
          width: 24 * scale,
        }}
        isVisible={singleNodeChrome}
        minHeight={147}
        minWidth={312}
        onResizeStart={() => checkpoint()}
      />
      {singleNodeChrome && (
        <div
          className="group-node-toolbar nodrag nopan"
          data-testid="group-node-toolbar"
          style={toolbarStyle}
        >
          <button
            aria-label="组合框颜色"
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
            aria-label={executing ? "取消整组执行" : "整组执行"}
            data-testid="group-execute-button"
            disabled={!hasExecutableChild || isFixture}
            onClick={() => {
              if (executing) {
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
                    ? "取消整组执行"
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
            {executing ? "取消" : "整组执行"}
          </button>
          <button disabled title="模板阶段实现" type="button">
            {data.groupTemplate ? "更新模板" : "创建模板"}
          </button>
          <button onClick={ungroup} type="button">
            解组
          </button>
          <button
            aria-label="下载全部"
            disabled={!hasDownload}
            onClick={downloadAll}
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
              <button onClick={() => layout("grid")} type="button">
                宫格
              </button>
              <button onClick={() => layout("horizontal")} type="button">
                水平
              </button>
            </div>
          )}
        </div>
      )}
      <div
        className="group-node-title nodrag"
        style={titleStyle}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect height="12" rx="2" width="14" x="3" y="7" />
          <path d="M7 7V4h14v12h-4" />
        </svg>
        {singleNodeChrome ? (
          <input
            aria-label="组合框标题"
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
          <span>{titleControl.committedValue}</span>
        )}
      </div>
      <div
        className="group-node-body"
        data-child-count={childCount}
        data-testid={`group-node-${id}`}
        onPointerDown={beginMove}
        style={{ background: data.groupColor ?? "transparent" }}
      />
    </>
  );
}
