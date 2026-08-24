import { useEffect, useRef, useState } from "react";
import type {
  ResolvedNodeInput,
  NodeInputProblem,
  NodeInputRole,
} from "../../../types/nodeInputs";
import { InlineOptionGroup } from "../ui/InlineOptionGroup";
import { useCreatorOverlayCoordinator } from "./CreatorOverlayCoordinator";

const kindLabel = { audio: "音频", image: "图片", text: "文字", video: "视频" } as const;
const roleLabel: Record<string, string> = {
  "context-audio": "音频上下文",
  "context-image": "图片上下文",
  "context-text": "文字上下文",
  "context-video": "视频上下文",
  "first-frame": "首帧",
  instruction: "生成指令",
  "last-frame": "尾帧",
  "reference-audio": "参考音频",
  "reference-image": "参考图片",
  "reference-video": "参考视频",
  subject: "主体",
} as const;
const stateLabel = {
  empty: "等待内容",
  invalid: "不兼容",
  missing: "来源缺失",
  ready: "已就绪",
  uploading: "上传中",
} as const;

function InputKindPreview({ input }: { input: ResolvedNodeInput }) {
  if (input.kind === "image" && input.preview) {
    return <img alt={input.title} draggable={false} src={input.preview} />;
  }
  if (input.kind === "video" && input.preview) {
    return <video aria-hidden="true" muted playsInline preload="metadata" src={input.preview} />;
  }
  if (input.kind === "audio" && input.waveform?.length) {
    return (
      <span className="upstream-input-waveform">
        {input.waveform.slice(0, 10).map((height, index) => (
          <i key={index} style={{ height: `${Math.max(3, Math.min(16, height / 3))}px` }} />
        ))}
      </span>
    );
  }
  if (input.kind === "text") {
    return (
      <svg aria-hidden="true" className="upstream-input-kind-icon" viewBox="0 0 20 20">
        <path d="M5 6h10M5 10h8M5 14h6" />
      </svg>
    );
  }
  if (input.kind === "image") {
    return (
      <svg aria-hidden="true" className="upstream-input-kind-icon" viewBox="0 0 20 20">
        <rect height="13" rx="2" width="15" x="2.5" y="3.5" />
        <circle cx="13" cy="7.5" r="1.25" />
        <path d="m4.5 14 4-4 3 3 1.5-1.5 2.5 2.5" />
      </svg>
    );
  }
  if (input.kind === "video") {
    return (
      <svg aria-hidden="true" className="upstream-input-kind-icon" viewBox="0 0 20 20">
        <rect height="13" rx="2" width="15" x="2.5" y="3.5" />
        <path d="m8 7 5 3-5 3Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="upstream-input-kind-icon" viewBox="0 0 20 20">
      <path d="M4 11V9M7 14V6M10 16V4M13 13V7M16 11V9" />
    </svg>
  );
}

export function UpstreamInputCards({
  disabled,
  inputs,
  onMove,
  onRemove,
  onRoleChange,
  problems,
  removeLabel = "删除引用",
  roleOptions,
  testId = "upstream-inputs",
}: {
  disabled?: boolean;
  inputs: ResolvedNodeInput[];
  onMove?: (edgeId: string, direction: "backward" | "forward") => void;
  onRemove: (edgeId: string) => void;
  onRoleChange?: (edgeId: string, role: NodeInputRole) => void;
  problems: NodeInputProblem[];
  removeLabel?: string;
  roleOptions?: (input: ResolvedNodeInput) => readonly NodeInputRole[];
  testId?: string;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [openEdgeId, setOpenEdgeId] = useState<string>();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [globalProblemOpen, setGlobalProblemOpen] = useState(false);
  const announceOpen = useCreatorOverlayCoordinator(() => {
    setOpenEdgeId(undefined);
    setOverflowOpen(false);
    setGlobalProblemOpen(false);
  });
  const hasOverflow = inputs.length > 4;
  const hasAreaProblems = problems.some((problem) => !problem.edgeId);

  useEffect(() => {
    if (!openEdgeId || inputs.some((input) => input.edgeId === openEdgeId)) {
      return;
    }
    setOpenEdgeId(undefined);
  }, [inputs, openEdgeId]);

  useEffect(() => {
    if (hasOverflow || !overflowOpen) return;
    setOverflowOpen(false);
  }, [hasOverflow, overflowOpen]);

  useEffect(() => {
    if (hasAreaProblems || !globalProblemOpen) return;
    setGlobalProblemOpen(false);
  }, [globalProblemOpen, hasAreaProblems]);

  useEffect(() => {
    if (!openEdgeId && !overflowOpen && !globalProblemOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!areaRef.current?.contains(event.target as Node)) {
        setOpenEdgeId(undefined);
        setOverflowOpen(false);
        setGlobalProblemOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [globalProblemOpen, openEdgeId, overflowOpen]);

  if (!inputs.length) return null;

  const inputProblem = (input: ResolvedNodeInput) => input.reason ?? problems.find(
    (problem) => problem.edgeId === input.edgeId,
  )?.message;
  const visibleInputs = hasOverflow ? inputs.slice(0, 3) : inputs;
  const overflowInputs = hasOverflow ? inputs.slice(3) : [];
  const activeInput = inputs.find((input) => input.edgeId === openEdgeId);
  const activeIndex = activeInput ? inputs.indexOf(activeInput) : -1;
  const activeDirectProblem = activeInput ? inputProblem(activeInput) : undefined;
  const activeConfiguredRoles = activeInput ? roleOptions?.(activeInput) ?? [] : [];
  const activeRoleChoices = activeInput && activeConfiguredRoles.includes(activeInput.role)
    ? activeConfiguredRoles
    : activeInput
      ? [activeInput.role, ...activeConfiguredRoles]
      : [];
  const activeVisibleState = activeInput?.compatibility === "blocked" && activeInput.state === "ready"
    ? "当前模型不兼容"
    : activeInput
      ? stateLabel[activeInput.state]
      : "";
  const areaProblems = problems.filter((problem, problemIndex) =>
    !problem.edgeId &&
    problems.findIndex((candidate) => candidate.message === problem.message) === problemIndex);

  const renderInput = (input: ResolvedNodeInput) => {
    const directProblem = inputProblem(input);
    const detailsOpen = openEdgeId === input.edgeId;
    const detailsId = `upstream-input-details-${input.edgeId}`;
    const visibleState = input.compatibility === "blocked" && input.state === "ready"
      ? "当前模型不兼容"
      : stateLabel[input.state];
    const hasMediaPreview = (input.kind === "image" || input.kind === "video") && Boolean(input.preview);
    return (
      <div
        className="upstream-input-card"
        data-details-open={detailsOpen ? "true" : undefined}
        data-input-compatibility={input.compatibility}
        data-input-kind={input.kind}
        data-input-role={input.role}
        data-input-state={input.state}
        data-testid={`upstream-input-${input.sourceNodeId}`}
        key={input.edgeId}
        title={directProblem ?? input.summary}
      >
        <button
          aria-controls={detailsId}
          aria-expanded={detailsOpen}
          aria-label={`查看引用 ${input.title}`}
          className="upstream-input-trigger"
          onClick={() => {
            if (openEdgeId !== input.edgeId) announceOpen();
            setOverflowOpen(false);
            setGlobalProblemOpen(false);
            setOpenEdgeId((current) => current === input.edgeId ? undefined : input.edgeId);
          }}
          title={`${input.title} · ${visibleState}`}
          type="button"
        >
          <span
            className="upstream-input-preview"
            data-has-media={hasMediaPreview ? "true" : "false"}
            data-kind={input.kind}
          >
            <InputKindPreview input={input} />
          </span>
          <span
            aria-hidden="true"
            className="upstream-input-state-mark"
            data-problem={
              directProblem ||
              input.compatibility === "blocked" ||
              input.state === "invalid" ||
              input.state === "missing"
                ? "true"
                : undefined
            }
            data-state={input.state}
            title={visibleState}
          />
        </button>
        <button
          aria-label={`${removeLabel} ${input.title}`}
          className="upstream-input-quick-remove"
          disabled={disabled}
          onClick={() => onRemove(input.edgeId)}
          type="button"
        >×</button>
        {directProblem && !detailsOpen && (
          <span
            className="sr-only"
            data-testid={`upstream-input-reason-${input.edgeId}`}
            role="status"
          >
            {directProblem}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className="upstream-input-area"
      data-testid="upstream-input-area"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpenEdgeId(undefined);
          setOverflowOpen(false);
          setGlobalProblemOpen(false);
        }
      }}
      ref={areaRef}
    >
      <div
        aria-label="上游引用"
        className="upstream-input-cards"
        data-testid={testId}
      >
        {visibleInputs.map(renderInput)}
        {hasOverflow && (
          <div className="upstream-input-overflow" data-open={overflowOpen ? "true" : undefined}>
            <button
              aria-controls={`${testId}-overflow-panel`}
              aria-expanded={overflowOpen}
              aria-label={`查看其余${overflowInputs.length}个引用`}
              className="upstream-input-overflow-trigger"
              data-testid="upstream-input-overflow-trigger"
              onClick={() => {
                if (!overflowOpen) announceOpen();
                setOpenEdgeId(undefined);
                setGlobalProblemOpen(false);
                setOverflowOpen((current) => !current);
              }}
              type="button"
            >+{overflowInputs.length}</button>
            <div
              aria-label="其余上游引用"
              className="upstream-input-overflow-panel"
              hidden={!overflowOpen}
              id={`${testId}-overflow-panel`}
              role="dialog"
            >
              {overflowInputs.map(renderInput)}
            </div>
          </div>
        )}
      </div>
      {activeInput && (
        <div
          aria-label={`${activeInput.title}引用详情`}
          className="upstream-input-details"
          data-testid={`upstream-input-details-${activeInput.edgeId}`}
          id={`upstream-input-details-${activeInput.edgeId}`}
          role="dialog"
        >
          <div className="upstream-input-details-heading">
            <span>
              <strong>{activeInput.title}</strong>
              <small>
                {kindLabel[activeInput.kind]} · #{activeInput.order} · {activeVisibleState}
              </small>
            </span>
            <button
              aria-label={`关闭 ${activeInput.title}引用详情`}
              onClick={() => setOpenEdgeId(undefined)}
              type="button"
            >×</button>
          </div>
          {activeInput.summary && (
            <p className="upstream-input-summary">{activeInput.summary}</p>
          )}
          {activeInput.localTechnicalPreflight && (
            <p
              className="upstream-input-local-preflight"
              data-state={activeInput.localTechnicalPreflight.status}
              data-testid={`seedance-local-preflight-${activeInput.edgeId}`}
            >
              {activeInput.localTechnicalPreflight.status === "eligible"
                ? "本地技术预检通过，不代表方舟可信素材或真人授权已通过"
                : `本地技术预检未通过：${activeInput.localTechnicalPreflight.problems.join("；")}`}
            </p>
          )}
          <label className="upstream-input-role-row">
            <span>角色</span>
            {activeRoleChoices.length > 1 && onRoleChange ? (
              <InlineOptionGroup
                ariaLabel={`${activeInput.title}角色`}
                disabled={disabled}
                onChange={(role) => {
                  onRoleChange(activeInput.edgeId, role as NodeInputRole);
                }}
                options={activeRoleChoices.map((role) => ({
                  label: roleLabel[role] ?? role,
                  value: role,
                }))}
                testId={`upstream-input-role-${activeInput.edgeId}`}
                value={activeInput.role}
              />
            ) : <strong>{roleLabel[activeInput.role] ?? activeInput.role}</strong>}
          </label>
          {activeDirectProblem && (
            <p
              className="upstream-input-card-reason"
              data-testid={`upstream-input-reason-${activeInput.edgeId}`}
              role="status"
            >
              {activeDirectProblem}
            </p>
          )}
          {onMove && inputs.length > 1 && (
            <div className="upstream-input-actions">
              <button
                aria-label={`向前移动 ${activeInput.title}`}
                disabled={disabled || activeIndex === 0}
                onClick={() => onMove(activeInput.edgeId, "backward")}
                type="button"
              >← 向前</button>
              <button
                aria-label={`向后移动 ${activeInput.title}`}
                disabled={disabled || activeIndex === inputs.length - 1}
                onClick={() => onMove(activeInput.edgeId, "forward")}
                type="button"
              >向后 →</button>
            </div>
          )}
        </div>
      )}
      {areaProblems.length > 0 && (
        <details
          className="upstream-input-global-problem"
          data-testid="upstream-input-problem"
          onToggle={(event) => {
            const nextOpen = event.currentTarget.open;
            if (nextOpen && !globalProblemOpen) {
              announceOpen();
              setOpenEdgeId(undefined);
              setOverflowOpen(false);
            }
            if (nextOpen !== globalProblemOpen) setGlobalProblemOpen(nextOpen);
          }}
          open={globalProblemOpen}
          role="status"
        >
          <summary title={areaProblems[0].message}>
            <span aria-hidden="true">!</span>
            <span>{areaProblems.length > 1 ? `${areaProblems.length}个输入问题` : "输入受阻"}</span>
          </summary>
          <div>
            {areaProblems.map((problem) => (
              <p key={`${problem.code}-${problem.message}`}>{problem.message}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
