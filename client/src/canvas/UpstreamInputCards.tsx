import type {
  ResolvedNodeInput,
  NodeInputProblem,
  NodeInputRole,
} from "../../../types/nodeInputs";

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

export function UpstreamInputCards({
  disabled,
  inputs,
  onRemove,
  onRoleChange,
  problems,
  removeLabel = "移除引用",
  roleOptions,
  testId = "upstream-inputs",
}: {
  disabled?: boolean;
  inputs: ResolvedNodeInput[];
  onRemove: (edgeId: string) => void;
  onRoleChange?: (edgeId: string, role: NodeInputRole) => void;
  problems: NodeInputProblem[];
  removeLabel?: string;
  roleOptions?: (input: ResolvedNodeInput) => readonly NodeInputRole[];
  testId?: string;
}) {
  if (!inputs.length) return null;
  const areaProblem = problems.find((problem) => !problem.edgeId) ?? problems[0];
  return (
    <div className="upstream-input-area" data-testid="upstream-inputs">
      <div
        aria-label="上游引用"
        className="upstream-input-cards"
        data-testid={testId}
      >
        {inputs.map((input) => {
          const configuredRoles = roleOptions?.(input) ?? [];
          const choices = configuredRoles.includes(input.role)
            ? configuredRoles
            : [input.role, ...configuredRoles];
          const directProblem = input.reason ?? problems.find(
            (problem) => problem.edgeId === input.edgeId,
          )?.message;
          const currentRoleLabel = roleLabel[input.role] ?? input.role;
          return (
            <div
              className="upstream-input-card"
              data-input-compatibility={input.compatibility}
              data-input-kind={input.kind}
              data-input-role={input.role}
              data-input-state={input.state}
              data-testid={`upstream-input-${input.sourceNodeId}`}
              key={input.edgeId}
              title={directProblem ?? input.summary}
            >
              <span className="upstream-input-preview" data-kind={input.kind}>
                {input.kind === "image" && input.preview ? (
                  <img alt={input.title} draggable={false} src={input.preview} />
                ) : input.kind === "video" && input.preview ? (
                  <video aria-hidden="true" muted playsInline preload="metadata" src={input.preview} />
                ) : input.kind === "audio" && input.waveform?.length ? (
                  <span className="upstream-input-waveform">
                    {input.waveform.slice(0, 12).map((height, index) => (
                      <i key={index} style={{ height: `${Math.max(3, Math.min(18, height / 3))}px` }} />
                    ))}
                  </span>
                ) : (
                  <span aria-hidden="true">{kindLabel[input.kind].slice(0, 1)}</span>
                )}
              </span>
              <span className="upstream-input-copy">
                <strong>{input.title}</strong>
                <small title={input.kind === "text" ? input.summary : undefined}>
                  {input.kind === "text" && input.summary ? `${input.summary} · ` : ""}
                  #{input.order} · {choices.length > 1 && onRoleChange ? (
                    <select
                      aria-label={`${input.title}角色`}
                      className="upstream-input-role"
                      data-testid={`upstream-input-role-${input.edgeId}`}
                      disabled={disabled}
                      onChange={(event) => onRoleChange(
                        input.edgeId,
                        event.target.value as NodeInputRole,
                      )}
                      value={input.role}
                    >
                      {choices.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel[role] ?? role}
                        </option>
                      ))}
                    </select>
                  ) : currentRoleLabel} · {stateLabel[input.state]}
                  {input.compatibility === "blocked" && input.state === "ready"
                    ? " · 当前模型不兼容"
                    : ""}
                </small>
                {directProblem && (
                  <small
                    className="upstream-input-card-reason"
                    data-testid={`upstream-input-reason-${input.edgeId}`}
                    role="status"
                  >
                    {directProblem}
                  </small>
                )}
              </span>
              <button
                aria-label={`${removeLabel} ${input.title}`}
                disabled={disabled}
                onClick={() => onRemove(input.edgeId)}
                type="button"
              >×</button>
            </div>
          );
        })}
      </div>
      {areaProblem && (
        <div className="upstream-input-problem" data-testid="upstream-input-problem" role="status">
          {areaProblem.message}
        </div>
      )}
    </div>
  );
}
