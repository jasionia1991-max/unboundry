import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ImageAnnotationDocument,
  ImageAnnotationElement,
  ImageAnnotationPoint,
} from "../../../types/imageTools";
import {
  emptyImageAnnotationDocument,
  replaceAnnotationElements,
  simplifyAnnotationPoints,
  validateImageAnnotationDocument,
} from "./imageAnnotations";

type AnnotationTool =
  | "select"
  | "brush"
  | "rectangle"
  | "arrow"
  | "number"
  | "text";

const annotationToolIcons: Readonly<Record<AnnotationTool, string>> = {
  arrow: "→",
  brush: "✎",
  number: "#",
  rectangle: "□",
  select: "↖",
  text: "T",
};

function annotationPath(points: readonly ImageAnnotationPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function AnnotationShape({
  element,
  selected,
  select,
}: Readonly<{
  element: ImageAnnotationElement;
  selected: boolean;
  select(): boolean;
}>) {
  const common = {
    "data-annotation-id": element.id,
    onPointerDown: (event: ReactPointerEvent<SVGGElement>) => {
      if (select()) event.stopPropagation();
    },
  };
  return (
    <g {...common} data-selected={selected || undefined}>
      {element.kind === "stroke" && (
        <polyline
          fill="none"
          points={annotationPath(element.points)}
          stroke={element.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={element.strokeWidth}
        />
      )}
      {element.kind === "rectangle" && (
        <rect
          fill="none"
          height={element.height}
          stroke={element.color}
          strokeWidth={element.strokeWidth}
          width={element.width}
          x={element.x}
          y={element.y}
        />
      )}
      {element.kind === "arrow" && (
        <line
          markerEnd="url(#image-annotation-arrow)"
          stroke={element.color}
          strokeLinecap="round"
          strokeWidth={element.strokeWidth}
          x1={element.x1}
          x2={element.x2}
          y1={element.y1}
          y2={element.y2}
        />
      )}
      {element.kind === "number" && (
        <>
          <circle cx={element.x} cy={element.y} fill={element.color} r="18" />
          <text
            dominantBaseline="central"
            fill="#111"
            fontSize="22"
            fontWeight="700"
            textAnchor="middle"
            x={element.x}
            y={element.y}
          >{element.value}</text>
        </>
      )}
      {element.kind === "text" && (
        <text
          dominantBaseline="hanging"
          fill={element.color}
          fontSize={element.fontSize}
          fontWeight="600"
          x={element.x}
          y={element.y}
        >{element.text}</text>
      )}
    </g>
  );
}

export function ImageAnnotationEditor({
  document: initialDocument,
  onBusyChange,
  onChange,
  onClose,
  onExport,
  src,
  transparent,
}: Readonly<{
  document?: ImageAnnotationDocument;
  onBusyChange?(busy: boolean): void;
  onChange(document: ImageAnnotationDocument): void;
  onClose(): void;
  onExport(document: ImageAnnotationDocument): Promise<void>;
  src: string;
  transparent: boolean;
}>) {
  const [annotationDocument, setAnnotationDocument] = useState(() =>
    initialDocument ?? emptyImageAnnotationDocument(1280, 720)
  );
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<ImageAnnotationElement>();
  const [textDraft, setTextDraft] = useState<{
    text: string;
    x: number;
    y: number;
  }>();
  const [textComposing, setTextComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = useRef<ImageAnnotationDocument[]>([]);
  const redo = useRef<ImageAnnotationDocument[]>([]);
  const drawing = useRef<{
    id: string;
    kind: "arrow" | "brush" | "rectangle";
    start: ImageAnnotationPoint;
  } | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);

  const aspect = annotationDocument.width / annotationDocument.height;
  const maxWidth = Math.min(786.72, window.innerWidth - 80);
  const maxHeight = Math.min(440, window.innerHeight - 180);
  const stage = maxWidth / maxHeight > aspect
    ? { height: maxHeight, width: maxHeight * aspect }
    : { height: maxWidth / aspect, width: maxWidth };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !textDraft) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setTextComposing(false);
      setTextDraft(undefined);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [textDraft]);

  const point = (event: Readonly<{
    clientX: number;
    clientY: number;
    currentTarget: SVGSVGElement;
  }>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(
        annotationDocument.width,
        (event.clientX - bounds.left) / bounds.width * annotationDocument.width,
      )),
      y: Math.max(0, Math.min(
        annotationDocument.height,
        (event.clientY - bounds.top) / bounds.height * annotationDocument.height,
      )),
    };
  };

  const adopt = (next: ImageAnnotationDocument, recordHistory = true) => {
    validateImageAnnotationDocument(next);
    if (recordHistory) history.current.push(annotationDocument);
    redo.current = [];
    setAnnotationDocument(next);
    onChange(next);
  };

  const add = (element: ImageAnnotationElement) => {
    adopt(replaceAnnotationElements(
      annotationDocument,
      [...annotationDocument.elements, element],
    ));
    setSelectedId(element.id);
  };

  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    const start = point(event);
    setSelectedId(undefined);
    if (tool === "select" || tool === "number" || tool === "text") return;
    const id = crypto.randomUUID();
    drawing.current = { id, kind: tool, start };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "brush") {
      setDraft({
        color: "#5b8cff",
        id,
        kind: "stroke",
        points: [start],
        strokeWidth: 6,
      });
    } else if (tool === "rectangle") {
      setDraft({
        color: "#ff5b5b",
        height: 0,
        id,
        kind: "rectangle",
        strokeWidth: 5,
        width: 0,
        ...start,
      });
    } else {
      setDraft({
        color: "#55cf78",
        id,
        kind: "arrow",
        strokeWidth: 5,
        x1: start.x,
        x2: start.x,
        y1: start.y,
        y2: start.y,
      });
    }
  };

  const clickCanvas = (event: ReactMouseEvent<SVGSVGElement>) => {
    const location = point(event);
    if (tool === "number") {
      add({
        color: "#ffd84d",
        id: crypto.randomUUID(),
        kind: "number",
        value: annotationDocument.elements.filter((element) =>
          element.kind === "number"
        )
          .length + 1,
        ...location,
      });
    } else if (tool === "text") {
      setTextDraft({ text: "", ...location });
    }
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drawing.current;
    if (!active || !draft) return;
    const current = point(event);
    if (draft.kind === "stroke") {
      if (draft.points.length >= 2_000) return;
      setDraft({ ...draft, points: [...draft.points, current] });
    } else if (draft.kind === "rectangle") {
      setDraft({
        ...draft,
        height: current.y - active.start.y,
        width: current.x - active.start.x,
      });
    } else if (draft.kind === "arrow") {
      setDraft({ ...draft, x2: current.x, y2: current.y });
    }
  };

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing.current || !draft) return;
    drawing.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    let completed: ImageAnnotationElement | undefined = draft;
    if (draft.kind === "stroke") {
      const points = simplifyAnnotationPoints(draft.points);
      completed = points.length >= 2 ? { ...draft, points } : undefined;
    } else if (draft.kind === "rectangle") {
      completed = Math.abs(draft.width) >= 2 && Math.abs(draft.height) >= 2
        ? {
            ...draft,
            height: Math.abs(draft.height),
            width: Math.abs(draft.width),
            x: draft.width < 0 ? draft.x + draft.width : draft.x,
            y: draft.height < 0 ? draft.y + draft.height : draft.y,
          }
        : undefined;
    } else if (draft.kind === "arrow") {
      completed = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= 2
        ? draft
        : undefined;
    }
    setDraft(undefined);
    if (completed) add(completed);
  };

  const restore = (
    from: { current: ImageAnnotationDocument[] },
    to: { current: ImageAnnotationDocument[] },
  ) => {
    const next = from.current.pop();
    if (!next) return;
    to.current.push(annotationDocument);
    setAnnotationDocument(next);
    onChange(next);
    setSelectedId(undefined);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    adopt(replaceAnnotationElements(
      annotationDocument,
      annotationDocument.elements.filter((element) => element.id !== selectedId),
    ));
    setSelectedId(undefined);
  };

  const commitText = () => {
    const text = textDraft?.text.trim();
    if (!textDraft || !text) {
      setTextComposing(false);
      setTextDraft(undefined);
      return;
    }
    add({
      color: "#ffffff",
      fontSize: 28,
      id: crypto.randomUUID(),
      kind: "text",
      text,
      x: textDraft.x,
      y: textDraft.y,
    });
    setTextComposing(false);
    setTextDraft(undefined);
  };

  const exportImage = async () => {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      await onExport(annotationDocument);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "标注导出失败");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const resizeEmptyDocument = (width: number, height: number) => {
    if (annotationDocument.elements.length > 0 ||
        (annotationDocument.width === width &&
          annotationDocument.height === height)) return;
    const next = emptyImageAnnotationDocument(width, height);
    setAnnotationDocument(next);
    onChange(next);
  };

  return (
    <div
      className="image-annotation-overlay nodrag nopan nowheel"
      data-testid="image-annotation-overlay"
    >
      <div className="image-annotation-toolbar" data-testid="image-annotation-toolbar">
        <button aria-label="关闭标注" disabled={busy} onClick={onClose} type="button">×</button>
        {([
          ["select", "选择"],
          ["brush", "画笔"],
          ["rectangle", "矩形"],
          ["arrow", "箭头"],
          ["number", "编号"],
          ["text", "文字"],
        ] as const).map(([value, label]) => (
          <button
            aria-label={label}
            aria-pressed={tool === value}
            data-tooltip={label}
            disabled={busy}
            key={value}
            onClick={() => setTool(value)}
            type="button"
          >{annotationToolIcons[value]}</button>
        ))}
        <button
          aria-label="删除标注"
          data-tooltip="删除"
          disabled={busy || !selectedId}
          onClick={removeSelected}
          type="button"
        >⌫</button>
        <button
          aria-label="撤销标注"
          data-tooltip="撤销"
          disabled={busy || history.current.length === 0}
          onClick={() => restore(history, redo)}
          type="button"
        >↶</button>
        <button
          aria-label="恢复标注"
          data-tooltip="重做"
          disabled={busy || redo.current.length === 0}
          onClick={() => restore(redo, history)}
          type="button"
        >↷</button>
        <button aria-label="导出标注图" data-tooltip="导出标注图" disabled={busy}
          onClick={() => void exportImage()} type="button">
          {busy ? "…" : "↓"}
        </button>
      </div>
      <div
        className="image-annotation-stage"
        data-testid="image-annotation-stage"
        style={{ height: stage.height, width: stage.width }}
      >
        <img
          alt=""
          className={transparent ? "image-transparent-preview" : undefined}
          draggable={false}
          onLoad={(event) => resizeEmptyDocument(
            event.currentTarget.naturalWidth,
            event.currentTarget.naturalHeight,
          )}
          src={src}
        />
        <span className="image-editor-processing-badge">本地标注</span>
        <svg
          aria-label="标注画布"
          data-tool={tool}
          data-testid="image-annotation-canvas"
          onClick={clickCanvas}
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={finish}
          ref={svgRef}
          role="img"
          viewBox={`0 0 ${annotationDocument.width} ${annotationDocument.height}`}
        >
          <defs>
            <marker
              id="image-annotation-arrow"
              markerHeight="8"
              markerWidth="8"
              orient="auto"
              refX="7"
              refY="4"
              viewBox="0 0 8 8"
            ><path d="M0 0L8 4L0 8Z" fill="context-stroke" /></marker>
          </defs>
          <rect
            fill="transparent"
            height={annotationDocument.height}
            pointerEvents="all"
            width={annotationDocument.width}
            x="0"
            y="0"
          />
          {annotationDocument.elements.map((element) => (
            <AnnotationShape
              element={element}
              key={element.id}
              select={() => {
                if (tool !== "select") return false;
                setSelectedId(element.id);
                return true;
              }}
              selected={selectedId === element.id}
            />
          ))}
          {draft && (
            <AnnotationShape element={draft} select={() => false} selected={false} />
          )}
        </svg>
        {textDraft && (
          <input
            aria-label="标注文字输入"
            autoFocus
            className="image-annotation-text-input"
            data-composition-active={textComposing || undefined}
            maxLength={2_000}
            onBlur={commitText}
            onChange={(event) => setTextDraft({
              ...textDraft,
              text: event.target.value,
            })}
            onCompositionEnd={(event) => {
              setTextComposing(false);
              setTextDraft({ ...textDraft, text: event.currentTarget.value });
            }}
            onCompositionStart={() => setTextComposing(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !textComposing &&
                  !(event.nativeEvent as KeyboardEvent).isComposing) {
                event.preventDefault();
                commitText();
              }
            }}
            style={{
              left: `${textDraft.x / annotationDocument.width * 100}%`,
              top: `${textDraft.y / annotationDocument.height * 100}%`,
            }}
            value={textDraft.text}
          />
        )}
      </div>
      <div className="image-annotation-status">
        <span>{annotationDocument.elements.length} 个标注</span>
        {error && <span role="alert">{error}</span>}
      </div>
    </div>
  );
}
