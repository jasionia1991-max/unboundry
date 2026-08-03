import { useState } from "react";
import type { NodeProps } from "@xyflow/react";
import type { ProbeNodeType, StoryboardShot } from "./ProbeNode";

const fields = ["媒体", "分镜编号", "时长", "景别", "内容摘要", "对白", "备注"];

function ExpandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m8 10 4 4 4-4" />
    </svg>
  );
}

function ShotMedia({ shot }: { shot: StoryboardShot }) {
  return (
    <div
      aria-label={shot.status === "loading" ? "媒体生成中" : `分镜 ${shot.number} 媒体`}
      className={`storyboard-shot-media storyboard-shot-media-${shot.mediaTone}`}
    >
      {shot.status === "loading" ? (
        <div className="storyboard-loading-mark">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <span className="storyboard-shot-number">{shot.number}</span>
          <span className="storyboard-shot-duration">{shot.duration}</span>
          <span className="storyboard-media-screen" />
          <span className="storyboard-media-base" />
        </>
      )}
    </div>
  );
}

function CardView({ shots }: { shots: StoryboardShot[] }) {
  return (
    <div className="storyboard-card-grid" data-testid="storyboard-default-view">
      {shots.map((shot) => (
        <article
          className={`storyboard-shot-card storyboard-shot-${shot.status}`}
          data-shot-id={shot.id}
          data-shot-status={shot.status}
          key={shot.id}
        >
          <ShotMedia shot={shot} />
          <div className="storyboard-shot-copy">
            <strong>
              {shot.status === "loading" ? "正在生成分镜…" : shot.summary}
            </strong>
            <p>{shot.status === "loading" ? "媒体生成完成后将在此显示" : shot.notes}</p>
            <span>{shot.status === "loading" ? "处理中" : `镜头 ${shot.number}`}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function CreativeView({ shots }: { shots: StoryboardShot[] }) {
  return (
    <div
      className="storyboard-creative-view"
      data-testid="storyboard-creative-view"
    >
      <div className="storyboard-creative-head" aria-hidden="true">
        {fields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>
      {shots.map((shot) => (
        <div
          className={`storyboard-creative-row storyboard-shot-${shot.status}`}
          data-shot-id={shot.id}
          key={shot.id}
        >
          <ShotMedia shot={shot} />
          <span>{shot.number}</span>
          <span>{shot.duration}</span>
          <span>{shot.framing}</span>
          <span>{shot.summary}</span>
          <span>{shot.dialogue}</span>
          <span>{shot.notes}</span>
        </div>
      ))}
    </div>
  );
}

export function StoryboardTableNode({
  data,
  id,
}: NodeProps<ProbeNodeType>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"default" | "creative">("default");
  const shots = data.storyboardShots ?? [];

  return (
    <section
      className="storyboard-node"
      data-fields={fields.join("|")}
      data-logical-size="1200x1000"
      data-testid={`storyboard-node-${id}`}
    >
      <div className="storyboard-node-title">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect height="16" rx="2" width="18" x="3" y="4" />
          <path d="M8 4v16M3 9h18" />
        </svg>
        <span>{data.title ?? "剪辑结果 (0:03.5)"}</span>
      </div>

      <div className="storyboard-view-control nodrag nopan">
        <button aria-label="最大化分镜表" type="button">
          <ExpandIcon />
        </button>
        <span className="storyboard-view-divider" />
        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          {view === "default" ? "图表视图" : "创意视图"}
          <ChevronIcon />
        </button>
        {menuOpen && (
          <div className="storyboard-view-menu" role="menu">
            <button
              onClick={() => {
                setView("default");
                setMenuOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              Default
            </button>
            <button
              onClick={() => {
                setView("creative");
                setMenuOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              创意视图
            </button>
          </div>
        )}
      </div>

      <div className="storyboard-node-body">
        {view === "default" ? (
          <CardView shots={shots} />
        ) : (
          <CreativeView shots={shots} />
        )}
      </div>
    </section>
  );
}
