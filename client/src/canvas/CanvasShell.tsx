import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Viewport } from "@xyflow/react";
import {
  CANVAS_LIBRARY_ASSET_MIME,
  CanvasSurface,
  initialCanvasViewport,
  type AgentCanvasReference,
  type CanvasLibraryAsset,
  type CanvasLoadState,
  type CanvasSearchEntry,
  type CanvasShellMenuCommand,
} from "./CanvasSurface";
import { GenerationTasksPanel } from "./GenerationTasksPanel";
import { useCompositionSafeText } from "./CompositionSafeText";
import { hasInteractionProbeNodes } from "./probeFixtures";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { clearProjectLocalKeys } from "../projects/projectStorage";
import type { AccountPermission } from "../../../types/accountPermissions";

type ShellButtonProps = {
  label: string;
  testId?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

type HistoryKind = "image" | "video" | "audio" | "world3d";
type HistoryAsset = {
  createdAt?: string;
  id: string;
  kind: HistoryKind;
  label: string;
  preview: string;
};

type HistoryCounts = Record<HistoryKind, number>;

type HistoryPage = {
  counts: HistoryCounts;
  items: HistoryAsset[];
  nextCursor?: string;
};

const historyPageSize = 60;

function emptyHistoryCounts(): HistoryCounts {
  return { audio: 0, image: 0, video: 0, world3d: 0 };
}

function historyAccountIdForFixture(fixtureId?: string) {
  if (fixtureId === "panel.history.final") return "fixture-account";
  if (fixtureId === "node.video.success") return "fixture-video-success";
  if (fixtureId === "node.audio.success") return "fixture-audio-success";
  return "local-user";
}

function historySeedForFixture(fixtureId?: string) {
  if (fixtureId === "panel.history.final") return historySeed;
  if (fixtureId === "node.video.success") {
    return [historySeed.find((item) => item.kind === "video")!];
  }
  if (fixtureId === "node.audio.success") {
    return historySeed.filter((item) => item.kind === "audio").slice(0, 2);
  }
  return [];
}

function validHistoryPage(value: unknown): value is HistoryPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<HistoryPage>;
  if (!page.counts || typeof page.counts !== "object" || !Array.isArray(page.items)) {
    return false;
  }
  const kinds: HistoryKind[] = ["image", "video", "audio", "world3d"];
  if (
    kinds.some(
      (kind) =>
        !Number.isSafeInteger(page.counts?.[kind]) ||
        Number(page.counts?.[kind]) < 0,
    )
  ) {
    return false;
  }
  if (
    page.nextCursor !== undefined &&
    (typeof page.nextCursor !== "string" || page.nextCursor.length > 512)
  ) {
    return false;
  }
  return page.items.every(
    (item) =>
      Boolean(item) &&
      typeof item === "object" &&
      /^[a-z0-9._-]+$/i.test(item.id) &&
      kinds.includes(item.kind) &&
      typeof item.label === "string" &&
      item.label.length >= 1 &&
      item.label.length <= 120 &&
      typeof item.preview === "string" &&
      item.preview.length <= 1_000 &&
      (item.createdAt === undefined ||
        (typeof item.createdAt === "string" && item.createdAt.length <= 80)),
  );
}

async function fetchHistoryPage(input: {
  accountId: string;
  cursor?: string;
  kind: HistoryKind;
  newestFirst: boolean;
  signal?: AbortSignal;
}) {
  const parameters = new URLSearchParams({
    kind: input.kind,
    limit: String(historyPageSize),
    order: input.newestFirst ? "newest" : "oldest",
  });
  if (input.cursor) parameters.set("cursor", input.cursor);
  const response = await fetch(
    `/api/history/${encodeURIComponent(input.accountId)}?${parameters.toString()}`,
    {
      headers: { Accept: "application/json" },
      signal: input.signal,
    },
  );
  if (!response.ok) throw new Error(`历史素材读取失败 (${response.status})`);
  const page: unknown = await response.json();
  if (!validHistoryPage(page)) throw new Error("历史素材响应格式无效");
  return page;
}

type ProjectTitleRecord = {
  title: string;
  updatedAt: number;
};

type ProjectAction = "clone" | "create" | "delete";

type TemplateCatalogCard = {
  categories: string[];
  cover?: { assetId: string; kind: "image" | "video" } | null;
  description?: string;
  graph?: {
    edges: Array<{
      id: string;
      source: string;
      sourceHandle: "source";
      target: string;
      targetHandle: "target";
      type: "cuttable";
    }>;
    nodes: Array<{
      data: Record<string, unknown> & { label: string };
      id: string;
      parentId?: string;
      position: { x: number; y: number };
      style?: { height: number; width: number };
      type:
        | "audio"
        | "group"
        | "image"
        | "playlist"
        | "storyboard"
        | "text"
        | "video";
      zIndex?: number;
    }>;
    version: 1;
  };
  id: string;
  previewImage?: string;
  title: string;
  tone?: string;
};

type TemplateCatalogResponse = {
  categories: string[];
  items: TemplateCatalogCard[];
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
};

type AgentConfiguration = {
  defaultModelId: string;
  executionEnabled: boolean;
  models: Array<{
    id: string;
    label: string;
    status: "coming-soon" | "locked" | "ready";
  }>;
  skills: Array<{
    description: string;
    enabled: boolean;
    id: string;
    label: string;
  }>;
  suggestions: Array<{
    category: string;
    description: string;
    icon: string;
    id: string;
    title: string;
  }>;
};

type AgentVoiceState =
  | "idle"
  | "requesting"
  | "recording"
  | "recorded"
  | "denied"
  | "unsupported"
  | "error";

const defaultProjectTitle = "Codex Unboundry G0.2 Sandbox 0727";

function projectTitleStorageKey(userId: string, id: string) {
  return `unboundry-project-title:v2:${userId}:${id}`;
}

function recentTemplatesKey(userId: string) {
  return `unboundry-template-recent:v2:${userId}`;
}

type RecentTemplateEntry = { at: number; id: string };

function readRecentTemplates(userId: string): RecentTemplateEntry[] {
  try {
    const raw = window.localStorage.getItem(recentTemplatesKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentTemplateEntry =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as RecentTemplateEntry).id === "string" &&
              Number.isSafeInteger((item as RecentTemplateEntry).at),
          ),
      )
      .sort((left, right) => right.at - left.at);
  } catch {
    return [];
  }
}

function recordRecentTemplate(userId: string, templateId: string) {
  try {
    const current = readRecentTemplates(userId).filter(
      (item) => item.id !== templateId,
    );
    current.unshift({ at: Date.now(), id: templateId });
    window.localStorage.setItem(
      recentTemplatesKey(userId),
      JSON.stringify(current.slice(0, 50)),
    );
  } catch {
    // 本地记录失败只影响「最近使用」排序，不阻塞导入。
  }
}

function readProjectTitleDraft(
  userId: string,
  id: string,
): ProjectTitleRecord | undefined {
  try {
    const value = window.localStorage.getItem(projectTitleStorageKey(userId, id));
    if (!value) return undefined;
    return parseProjectTitleRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function parseProjectTitleRecord(
  value: unknown,
): ProjectTitleRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<ProjectTitleRecord>;
  if (
    typeof record.title !== "string" ||
    record.title.length > 120 ||
    !Number.isSafeInteger(record.updatedAt) ||
    (record.updatedAt ?? -1) < 0
  ) {
    return undefined;
  }
  return record as ProjectTitleRecord;
}

function projectMutationResponse(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    id?: unknown;
    title?: unknown;
    updatedAt?: unknown;
  };
  if (
    typeof candidate.id !== "string" ||
    !/^[a-z0-9._-]+$/i.test(candidate.id) ||
    typeof candidate.title !== "string" ||
    candidate.title.length > 120 ||
    typeof candidate.updatedAt !== "number" ||
    !Number.isSafeInteger(candidate.updatedAt) ||
    candidate.updatedAt < 1
  ) {
    return undefined;
  }
  return candidate as { id: string; title: string; updatedAt: number };
}

function writeProjectTitleDraft(
  userId: string,
  id: string,
  record: ProjectTitleRecord,
) {
  try {
    window.localStorage.setItem(
      projectTitleStorageKey(userId, id),
      JSON.stringify(record),
    );
  } catch {
    // The SQLite request below remains the durable path when storage is blocked.
  }
}

const historySeed: HistoryAsset[] = [
  { id: "history-image-1", kind: "image", label: "图片 1", preview: "blood-red" },
  { id: "history-image-2", kind: "image", label: "图片 2", preview: "violet" },
  { id: "history-video-1", kind: "video", label: "视频 1", preview: "ocean" },
  { id: "history-audio-1", kind: "audio", label: "音频 1", preview: "wave-a" },
  { id: "history-audio-2", kind: "audio", label: "音频 2", preview: "wave-b" },
  { id: "history-audio-3", kind: "audio", label: "音频 3", preview: "wave-c" },
  { id: "history-audio-4", kind: "audio", label: "音频 4", preview: "wave-d" },
];

const historyTabs = [
  ["image", "图片历史", "image"],
  ["video", "视频历史", "video"],
  ["audio", "音频", "music"],
  ["world3d", "3D", "world"],
] as const;

function historyItemDate(item: HistoryAsset) {
  if (item.id.startsWith("history-")) {
    return /-(?:1)$/.test(item.id) ? "2026-07-27" : "2026-07-23";
  }
  if (item.createdAt) {
    const date = new Date(item.createdAt);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }
  return "未知日期";
}

function historyMediaUrl(item: HistoryAsset) {
  const patterns: Partial<Record<HistoryKind, RegExp>> = {
    audio: /^\/api\/audio-assets\/[a-z0-9._-]+$/i,
    image: /^\/api\/assets\/[a-z0-9._-]+$/i,
    video: /^\/api\/video-assets\/[a-z0-9._-]+$/i,
  };
  return patterns[item.kind]?.test(item.preview) ? item.preview : undefined;
}

function persistedHistoryPreview(item: HistoryAsset) {
  if (item.kind === "video") return `/api/video-assets/${item.id}`;
  if (item.kind === "audio") return `/api/audio-assets/${item.id}`;
  if (item.kind === "image") return `/api/assets/${item.id}`;
  return item.preview;
}

function HistoryCardMedia({ item }: { item: HistoryAsset }) {
  const mediaUrl = historyMediaUrl(item);
  if (item.kind === "image" && mediaUrl) {
    return (
      <img
        alt=""
        className="history-card-image"
        decoding="async"
        draggable={false}
        loading="lazy"
        src={mediaUrl}
      />
    );
  }
  if (item.kind === "video" && mediaUrl) {
    return <LazyHistoryVideo mediaUrl={mediaUrl} />;
  }
  return null;
}

function LazyHistoryVideo({ mediaUrl }: { mediaUrl: string }) {
  const placeholder = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const element = placeholder.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "160px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) {
    return (
      <span
        aria-hidden="true"
        className="history-card-video-placeholder"
        ref={placeholder}
      />
    );
  }
  return (
    <video
      aria-hidden="true"
      className="history-card-video"
      muted
      onLoadedMetadata={(event) => {
        event.currentTarget.currentTime = Math.min(
          0.08,
          event.currentTarget.duration || 0,
        );
      }}
      playsInline
      preload="metadata"
      src={mediaUrl}
    />
  );
}

function ShellButton({
  label,
  testId,
  className = "",
  onClick,
  active,
  disabled,
  children,
}: ShellButtonProps) {
  return (
    <button
      aria-label={label}
      className={`shell-button ${className}`}
      data-active={active || undefined}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function LineIcon({
  className,
  name,
}: {
  className?: string;
  name: string;
}) {
  const paths: Record<string, ReactNode> = {
    add: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    search: (
      <>
        <path d="M10 10m-7 0a7 7 0 1 0 14 0 7 7 0 1 0-14 0" />
        <path d="m21 21-6-6" />
      </>
    ),
    image: (
      <>
        <rect height="16" rx="2" width="18" x="3" y="4" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m21 15-4.5-4.5L7 20" />
      </>
    ),
    text: (
      <path d="M4 6h16M8 6v12M16 6v12M6 18h4M14 18h4" />
    ),
    world: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
    group: (
      <>
        <rect height="14" rx="2" width="14" x="7" y="7" />
        <path d="M17 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
      </>
    ),
    assets: (
      <>
        <path d="M13.2094 8.05177c.454 0 .8894.18034 1.2104.50135.321.32101.5013.75639.5013 1.21036v5.56302c0 .454-.1803.8894-.5013 1.2104-.321.321-.7564.5013-1.2104.5013H3.79505c-.45397 0-.88935-.1803-1.21036-.5013-.32101-.321-.50135-.7564-.50135-1.2104V7.62385c0-.45398.18034-.88936.50135-1.21036.32101-.32101.75639-.50135 1.21036-.50135h2.56756c.1993 0 .39586.0464.57412.13553.17826.08913.33332.21854.4529.37798l.51352 1.11261c.11958.15944.27464.28885.4529.37798.17826.08913.37482.13553.57412.13553h4.27923Z" />
        <path d="M17.4153 13.5414c.321-.321.5014-.7564.5014-1.2104V6.768c0-.45397-.1804-.88935-.5014-1.21036-.321-.32101-.7564-.50135-1.2104-.50135h-4.2792c-.1993 0-.3959-.0464-.5741-.13553-.1783-.08913-.3334-.21854-.4529-.37798l-.5136-1.11261c-.1195-.15944-.2746-.28885-.45286-.37798-.17826-.08913-.37482-.13553-.57412-.13553H6.79056c-.45397 0-.88935.18034-1.21036.50134" />
      </>
    ),
    templates: (
      <>
        <path d="M4 4m0 1a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
        <path d="M4 12m0 1a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM14 12h6M14 16h6M14 20h6" />
      </>
    ),
    history: (
      <>
        <path d="M12 8v4l2 2" />
        <path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" />
      </>
    ),
    tasks: (
      <>
        <path d="M9 5h11M9 12h11M9 19h11" />
        <circle cx="4.5" cy="5" r="1.2" />
        <circle cx="4.5" cy="12" r="1.2" />
        <circle cx="4.5" cy="19" r="1.2" />
      </>
    ),
    minimap: (
      <>
        <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0Z" />
        <path d="M15 5.764v15M9 3.236v15" />
      </>
    ),
    snap: (
      <>
        <rect height="18" rx="2" width="18" x="3" y="3" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      </>
    ),
    fit: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      </>
    ),
    help: (
      <>
        <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 17v.01M12 13.5a1.5 1.5 0 0 1 1-1.5 2.6 2.6 0 1 0-3-4" />
      </>
    ),
    share: (
      <>
        <path d="M6 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M18 6m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M18 18m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4" />
      </>
    ),
    agent: (
      <>
        <path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9z" />
        <path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7z" />
      </>
    ),
    video: (
      <>
        <rect x="4" y="7" width="12" height="10" rx="2" />
        <path d="m16 10 4-2v8l-4-2" />
      </>
    ),
    backdrop: (
      <>
        <path d="M5 19 19 5M4 14l10-10M10 20 20 10" />
      </>
    ),
    sparkle: (
      <>
        <path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9z" />
        <path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7z" />
      </>
    ),
    music: (
      <>
        <path d="M9 18V6l9-2v12" />
        <ellipse cx="6.5" cy="18" rx="2.5" ry="2" />
        <ellipse cx="15.5" cy="16" rx="2.5" ry="2" />
      </>
    ),
    workflow: (
      <>
        <path d="M8 6h11M8 12h11M8 18h11" />
        <circle cx="5" cy="6" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="5" cy="18" r="1" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={name === "assets" ? "0 0 20 20" : "0 0 24 24"}
    >
      {paths[name] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}

function FilledControlIcon({ name }: { name: "fit" | "minimap" | "snap" }) {
  if (name === "minimap") {
    return (
      <svg
        aria-hidden="true"
        className="control-active-icon control-active-minimap"
        viewBox="0 0 18 17"
      >
        <path d="M4.35651.084869.359968 2.00265A.631.631 0 0 0 0 2.57197V16.3458c0 .4666.492.7722.9155.5693l3.9965-1.9178a.631.631 0 0 0 .36-.5693V.654185c0-.466578-.492-.772539-.9155-.569316ZM6.36399 14.5252V.644277c0-.466578.492-.772539.9155-.569316l3.9965 1.917789a.631.631 0 0 1 .36.56931V16.3558c0 .4616-.4826.7677-.9051.5741l-3.9966-1.8306a.632.632 0 0 1-.3703-.5741ZM17.0845.063932 13.0879 1.98172a.631.631 0 0 0-.3599.56931V16.3668c0 .456.4718.7622.8931.5796l3.9966-1.7324A.632.632 0 0 0 18 14.6345V.633248c0-.466578-.492-.772539-.9155-.569316Z" />
      </svg>
    );
  }

  if (name === "snap") {
    return (
      <svg
        aria-hidden="true"
        className="control-active-icon control-active-snap"
        viewBox="0 0 18 18"
      >
        <path d="M5.03788 12.4621v4.2424H1.94462a1.149 1.149 0 0 1-1.14917-1.1491v-3.0933h4.24243Zm5.83332 0v4.2424H6.62879v-4.2424h4.24241Zm5.8333 0v3.0933a1.149 1.149 0 0 1-1.1491 1.1491h-3.0933v-4.2424h4.2424ZM5.03788 6.62879v4.24241H.795455V6.62879H5.03788Zm5.83332 0v4.24241H6.62879V6.62879h4.24241Zm5.8333 0v4.24241h-4.2424V6.62879h4.2424ZM5.03788.795455V5.03788H.795455V1.94462A1.149 1.149 0 0 1 1.94462.795455h3.09326Zm5.83332 0V5.03788H6.62879V.795455h4.24241Zm4.6842 0a1.149 1.149 0 0 1 1.1491 1.149165v3.09326h-4.2424V.795455h3.0933Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="control-active-icon control-active-fit"
      viewBox="0 0 24 24"
    >
      <path d="M3.25 18.2222v-1.7779a.75.75 0 0 1 1.5 0v1.7779c0 .5677.4602 1.0278 1.0278 1.0278h1.7779a.75.75 0 0 1 0 1.5H5.7778A2.528 2.528 0 0 1 3.25 18.2222Zm16 0v-1.7779a.75.75 0 0 1 1.5 0v1.7779A2.528 2.528 0 0 1 18.2222 20.75h-1.7779a.75.75 0 0 1 0-1.5h1.7779c.5677 0 1.0278-.4601 1.0278-1.0278ZM14.5 12a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0ZM3.25 7.55566V5.77783A2.528 2.528 0 0 1 5.77783 3.25h1.77783a.75.75 0 0 1 0 1.5H5.77783c-.56767 0-1.02783.46016-1.02783 1.02783v1.77783a.75.75 0 0 1-1.5 0Zm16 0V5.77783c0-.56767-.4602-1.02783-1.0278-1.02783h-1.7779a.75.75 0 0 1 0-1.5h1.7779A2.528 2.528 0 0 1 20.75 5.77783v1.77783a.75.75 0 0 1-1.5 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DoubleClickIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M8.06033 6.35866 16.9365 9.08986c.4841.14897.5392.81221.0861 1.03874l-3.7619 1.881c-.1087.0543-.1969.1425-.2512.2511l-1.8809 3.7619c-.2265.453-.8896.3981-1.0386-.086L7.35865 7.06017c-.13255-.4308.27088-.83406.70168-.70151Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M8.166 1.333a.833.833 0 0 0-1.666 0V3a.833.833 0 1 0 1.666 0V1.333ZM4.386 2.208a.833.833 0 1 0-1.178 1.178l1.178 1.18a.833.833 0 1 0 1.18-1.18l-1.18-1.178ZM11.458 2.208a.833.833 0 0 1 0 1.178l-1.178 1.18A.834.834 0 0 1 9.1 3.387l1.18-1.178a.833.833 0 0 1 1.178-.001ZM1.5 6.333c0-.46.373-.833.833-.833H4a.833.833 0 1 1 0 1.666H2.333a.833.833 0 0 1-.833-.833ZM5.566 9.28a.834.834 0 0 0-1.179-1.18L3.208 9.28a.834.834 0 0 0 1.18 1.179l1.178-1.18Z"
        fill="#1fa2dc"
      />
    </svg>
  );
}

function AgentModeIcon({
  mode,
}: {
  mode: "手动确认" | "自动生成";
}) {
  if (mode === "手动确认") {
    return (
      <svg
        aria-hidden="true"
        className="agent-mode-icon"
        viewBox="0 0 20 20"
      >
        <circle cx="10" cy="10" r="6.75" />
        <path d="m6.8 10.1 2.1 2.2 4.5-4.8" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="agent-mode-icon"
      viewBox="0 0 20 20"
    >
      <path d="M4.2 7.8A6.2 6.2 0 0 1 15 5.7" />
      <path d="M15.2 2.9v3.4h-3.4" />
      <path d="M15.8 12.2A6.2 6.2 0 0 1 5 14.3" />
      <path d="M4.8 17.1v-3.4h3.4" />
    </svg>
  );
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <span className="shortcut-keys">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  );
}

const dockItems = [
  ["add", "添加节点", "add-node"],
  ["search", "节点搜索", "node-search"],
  ["assets", "素材库", "assets"],
  ["templates", "工作流/模板", "templates"],
  ["history", "历史", "history"],
  ["tasks", "生成任务", "tasks"],
] as const;

const quickActions = [
  ["文字生视频", "quick-text-video", "video"],
  ["图片换背景", "quick-replace-background", "backdrop"],
  ["首帧生成视频", "quick-first-last-video", "sparkle"],
  ["音频生视频", "quick-audio-video", "music"],
  ["模板", "quick-template", "workflow"],
] as const;

const nodeSearchCategories = [
  ["全部", "search"],
  ["图片", "image"],
  ["视频", "video"],
  ["文本", "text"],
  ["音频", "music"],
  ["World", "world"],
  ["分组", "group"],
] as const;

type LibraryFolder = {
  id: string;
  kind: "folder" | "system";
  label: string;
};

type LibraryCatalogResponse = {
  folders: LibraryFolder[];
  items: CanvasLibraryAsset[];
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
  spaces: Array<{
    id: "personal" | "team";
    label: "个人" | "团队";
    readOnly: boolean;
  }>;
};

type AiCharacter = {
  category: string;
  colors: string[];
  id: string;
  meta: string[];
  name: string;
  tags: string[];
};

type AiCharacterCatalogResponse = {
  categories: string[];
  filters: Record<string, string[]>;
  items: AiCharacter[];
  pagination: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
};

type AiCharacterFilter = string;

const initialAiCharacterCategories = ["全部角色"];

const initialTemplateBrowseCategories = [
  "最近使用",
  "我的模板",
  "全部",
  "Seedance 2.0",
  "广告",
  "电商",
  "影视",
  "生活",
  "工具",
  "有趣",
  "ACG",
] as const;

type AgentMenu = "add" | "confirmation" | "model" | "skills";
type PrimaryShellSurface =
  | "account"
  | "agent"
  | "assets"
  | "help"
  | "history"
  | "project"
  | "search"
  | "share"
  | "tasks"
  | "templates";

const agentAddItems = [
  ["从画布添加", "▱"],
  ["上传附件", "⌕"],
  ["技能", "♧"],
  ["头脑风暴", "◉"],
  ["全部插件", "⌘"],
] as const;

function restoreShellControlFocus(testId: string) {
  window.requestAnimationFrame(() => {
    (
      document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLButtonElement | null
    )?.focus();
  });
}

export function CanvasShell({
  accountOpen = false,
  fixtureId,
  onAccountOpenChange,
  onProjectMissing,
  permissions,
  projectId,
  role,
  userId = "",
  userInitial = "M",
}: {
  accountOpen: boolean;
  fixtureId?: string;
  onAccountOpenChange: (open: boolean) => void;
  onProjectMissing?: () => void;
  permissions?: readonly AccountPermission[];
  projectId?: string;
  role?: "admin" | "user";
  userId?: string;
  userInitial: string;
}) {
  const canManagePublicTemplates =
    role === "admin" ||
    permissions?.includes("manage_public_templates") === true;
  const projectTitleId = projectId ?? fixtureId ?? "default";
  const durableFixture =
    !fixtureId ||
    fixtureId.startsWith("persistence.") ||
    fixtureId?.startsWith("node.") ||
    fixtureId === "panel.history.final" ||
    fixtureId === "panel.assets.drag-ready" ||
    fixtureId === "interaction.upload-image" ||
    fixtureId === "interaction.upload-media-sandbox-current";
  const initialProjectTitle =
    readProjectTitleDraft(userId, projectTitleId) ??
    ({ title: defaultProjectTitle, updatedAt: 0 } satisfies ProjectTitleRecord);
  // 缩放/平移期间外壳不再每帧跟随 viewport：只保留低频缩放摘要驱动滑块/指示条，
  // 滑块输入通过 zoomRequest 命令式下发给画布。
  const [zoomSummary, setZoomSummary] = useState(() =>
    initialCanvasViewport(fixtureId).zoom,
  );
  const zoomRequestSequence = useRef(0);
  const [viewportRequest, setViewportRequest] = useState<{
    sequence: number;
    x?: number;
    y?: number;
    zoom: number;
  }>();
  const [fitWorld, setFitWorld] = useState<() => void>();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [shellMenuCommand, setShellMenuCommand] =
    useState<CanvasShellMenuCommand>();
  const [nodeSearchOpen, setNodeSearchOpen] = useState(
    fixtureId === "modal.node-search.empty",
  );
  const [nodeSearchCategory, setNodeSearchCategory] = useState("全部");
  const [nodeSearchQuery, setNodeSearchQuery] = useState("");
  const [nodeSearchEntries, setNodeSearchEntries] = useState<
    CanvasSearchEntry[]
  >([]);
  const [focusNodeRequest, setFocusNodeRequest] = useState<{
    id: string;
    sequence: number;
  }>();
  const [assetsOpen, setAssetsOpen] = useState(
    fixtureId === "panel.assets.personal-empty" ||
      fixtureId === "panel.assets.drag-ready" ||
      fixtureId === "overlay.ai-characters.loaded",
  );
  const [assetsTab, setAssetsTab] = useState<"个人" | "团队">("个人");
  const [assetSpaces, setAssetSpaces] = useState<
    LibraryCatalogResponse["spaces"]
  >([
    { id: "personal", label: "个人", readOnly: false },
    { id: "team", label: "团队", readOnly: true },
  ]);
  const [assetFolders, setAssetFolders] = useState<LibraryFolder[]>([]);
  const [assetFolder, setAssetFolder] = useState(
    fixtureId === "panel.assets.drag-ready" ? "others" : "favorites",
  );
  const [assetSearch, setAssetSearch] = useState("");
  const [libraryAssets, setLibraryAssets] = useState<CanvasLibraryAsset[]>([]);
  const [libraryAssetTotal, setLibraryAssetTotal] = useState(0);
  const [libraryCatalogError, setLibraryCatalogError] = useState("");
  const [libraryCatalogLoading, setLibraryCatalogLoading] = useState(false);
  const [libraryVisibleCount, setLibraryVisibleCount] = useState(20);
  const [aiCharactersOpen, setAiCharactersOpen] = useState(
    fixtureId === "overlay.ai-characters.loaded",
  );
  const [aiCharacterCategories, setAiCharacterCategories] = useState<string[]>(
    [...initialAiCharacterCategories],
  );
  const [aiCharacterFilters, setAiCharacterFilters] = useState<
    Record<string, string[]>
  >({});
  const [aiCharacters, setAiCharacters] = useState<AiCharacter[]>([]);
  const [aiCharacterTotal, setAiCharacterTotal] = useState(0);
  const [aiCharacterCatalogError, setAiCharacterCatalogError] = useState("");
  const [aiCharacterCatalogLoading, setAiCharacterCatalogLoading] =
    useState(false);
  const [aiCharacterCategory, setAiCharacterCategory] =
    useState("全部角色");
  const [aiCharacterFilterOpen, setAiCharacterFilterOpen] =
    useState<AiCharacterFilter>();
  const [aiCharacterSelections, setAiCharacterSelections] = useState<
    Partial<Record<AiCharacterFilter, string[]>>
  >({});
  const [aiCharacterVisibleCount, setAiCharacterVisibleCount] = useState(60);
  const [templatesOpen, setTemplatesOpen] = useState(
    fixtureId === "panel.templates.public",
  );
  const [templateNoticeOpen, setTemplateNoticeOpen] = useState(
    fixtureId === "panel.templates.public",
  );
  const [templateTab, setTemplateTab] = useState<"公共模板" | "我的模板">(
    "公共模板",
  );
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCards, setTemplateCards] = useState<TemplateCatalogCard[]>([]);
  const [templateCatalogError, setTemplateCatalogError] = useState("");
  const [templateCatalogLoading, setTemplateCatalogLoading] = useState(false);
  const [templateCatalogRevision, setTemplateCatalogRevision] = useState(0);
  const [templateBrowseCategories, setTemplateBrowseCategories] = useState<
    string[]
  >([...initialTemplateBrowseCategories]);
  const [templateBrowseAllOpen, setTemplateBrowseAllOpen] = useState(false);
  const [templateBrowseCategory, setTemplateBrowseCategory] = useState("全部");
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [textVideoStarted, setTextVideoStarted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(
    fixtureId === "panel.history.final",
  );
  const [tasksOpen, setTasksOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryKind>("image");
  const [historyItems, setHistoryItems] = useState<HistoryAsset[]>([]);
  const [historyCounts, setHistoryCounts] = useState<HistoryCounts>(
    emptyHistoryCounts,
  );
  const [historyNextCursor, setHistoryNextCursor] = useState<string>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRefreshEpoch, setHistoryRefreshEpoch] = useState(0);
  const historyLoadSequence = useRef(0);
  const historyLoadMoreAbort = useRef<AbortController | undefined>(undefined);
  const historyLoadMoreInFlight = useRef(false);
  const [historyZoom, setHistoryZoom] = useState(120);
  const [historyNewestFirst, setHistoryNewestFirst] = useState(true);
  const [historyPreviewItem, setHistoryPreviewItem] = useState<HistoryAsset>();
  const [historyAssetRequest, setHistoryAssetRequest] = useState<{
    asset: CanvasLibraryAsset;
    sequence: number;
  }>();
  // Infinite-canvas rule: zoom gestures must never zoom the browser page.
  // Ctrl+wheel / trackpad pinch anywhere in the app is consumed in the capture
  // phase so the surrounding chrome stays fixed; the canvas world handler
  // still converts the same gesture into canvas zoom.
  useEffect(() => {
    const blockBrowserPageZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
    };
    window.addEventListener("wheel", blockBrowserPageZoom, {
      capture: true,
      passive: false,
    });
    return () =>
      window.removeEventListener("wheel", blockBrowserPageZoom, {
        capture: true,
      } as EventListenerOptions);
  }, []);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [projectActionBusy, setProjectActionBusy] = useState<ProjectAction>();
  const [projectActionError, setProjectActionError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const [projectTitleValue, setProjectTitleValue] = useState(
    initialProjectTitle.title,
  );
  const [agentOpen, setAgentOpen] = useState(
    fixtureId === "panel.agent.expanded-empty" ||
      fixtureId === "menu.agent.add-and-model" ||
      fixtureId === "panel.agent.files-empty" ||
      fixtureId === "panel.agent.voice",
  );
  const [agentFilesOpen, setAgentFilesOpen] = useState(
    fixtureId === "panel.agent.files-empty",
  );
  const [agentMenu, setAgentMenu] = useState<AgentMenu>();
  const [agentReferenceMode, setAgentReferenceMode] = useState(false);
  const [agentReferences, setAgentReferences] = useState<
    AgentCanvasReference[]
  >([]);
  const [agentConfirmation, setAgentConfirmation] = useState<
    "手动确认" | "自动生成"
  >("手动确认");
  const [agentConfiguration, setAgentConfiguration] =
    useState<AgentConfiguration>();
  const [agentConfigurationError, setAgentConfigurationError] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentVoiceState, setAgentVoiceState] =
    useState<AgentVoiceState>("idle");
  const [agentVoiceSeconds, setAgentVoiceSeconds] = useState(0);
  const [agentVoiceUrl, setAgentVoiceUrl] = useState<string>();
  const [saveConflict, setSaveConflict] = useState(false);
  const [saveConflictMessage, setSaveConflictMessage] = useState("");
  const [graphHasContent, setGraphHasContent] = useState(() =>
    hasInteractionProbeNodes(fixtureId),
  );
  const [saveStatus, setSaveStatus] = useState(
    durableFixture ? "正在加载画布..." : "已保存到云端",
  );
  const [canvasLoadState, setCanvasLoadState] = useState<CanvasLoadState>(
    durableFixture ? "loading" : "ready",
  );
  const canvasScopeId = JSON.stringify([userId, projectTitleId]);
  const [generationRetryGate, setGenerationRetryGate] = useState<{
    run: () => Promise<number>;
    scopeId: string;
  }>();
  const [canvasLoadScopeId, setCanvasLoadScopeId] = useState(canvasScopeId);
  const effectiveCanvasLoadState: CanvasLoadState =
    canvasLoadScopeId === canvasScopeId
      ? canvasLoadState
      : durableFixture
        ? "loading"
        : "ready";
  const registerGenerationRetryGate = useCallback((
    gate: (() => Promise<number>) | undefined,
  ) => {
    setGenerationRetryGate(gate ? { run: gate, scopeId: canvasScopeId } : undefined);
  }, [canvasScopeId]);
  const agentPromptControl = useCompositionSafeText({
    onCommit: setAgentPrompt,
    value: agentPrompt,
  });
  const nodeSearchControl = useCompositionSafeText({
    onCommit: setNodeSearchQuery,
    value: nodeSearchQuery,
  });
  const assetSearchControl = useCompositionSafeText({
    onCommit: (value) => {
      setAssetSearch(value);
      setLibraryVisibleCount(20);
    },
    value: assetSearch,
  });
  const templateSearchControl = useCompositionSafeText({
    onCommit: setTemplateSearch,
    value: templateSearch,
  });
  const saveTimer = useRef<number | undefined>(undefined);
  const nodeSearchInput = useRef<HTMLInputElement>(null);
  const assetsPanel = useRef<HTMLElement>(null);
  const templatesPanel = useRef<HTMLElement>(null);
  const historyPanel = useRef<HTMLElement>(null);
  const tasksPanel = useRef<HTMLElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const projectMenu = useRef<HTMLElement>(null);
  const sharePopover = useRef<HTMLElement>(null);
  const helpMenu = useRef<HTMLElement>(null);
  const agentVoiceStream = useRef<MediaStream | undefined>(undefined);
  const agentVoiceRecorder = useRef<MediaRecorder | undefined>(undefined);
  const agentVoiceChunks = useRef<Blob[]>([]);
  const agentVoiceTimer = useRef<number | undefined>(undefined);
  const agentVoiceCancelled = useRef(false);
  const projectTitleUpdatedAt = useRef(initialProjectTitle.updatedAt);
  const projectTitleSaveAttempt = useRef(0);
  const projectActionInFlight = useRef<ProjectAction | undefined>(undefined);
  useEffect(() => {
    setTextVideoStarted(false);
    setFocusNodeRequest(undefined);
    setHistoryAssetRequest(undefined);
    setShellMenuCommand(undefined);
    setViewportRequest(undefined);
    const state: CanvasLoadState = durableFixture ? "loading" : "ready";
    setCanvasLoadScopeId(canvasScopeId);
    setCanvasLoadState(state);
    setSaveStatus(
      state === "loading" ? "正在加载画布..." : "已保存到云端",
    );
  }, [canvasScopeId, durableFixture]);
  const hasProbeNodes =
    hasInteractionProbeNodes(fixtureId) || textVideoStarted;
  const zoomRatio = Math.min(1, Math.max(0, (zoomSummary - 0.15) / 1.85));
  const normalizedSearchQuery = nodeSearchQuery.trim().toLocaleLowerCase();
  const visibleSearchEntries = nodeSearchEntries.filter(
    (entry) =>
      (nodeSearchCategory === "全部" ||
        entry.category === nodeSearchCategory) &&
      (!normalizedSearchQuery ||
        entry.searchText.includes(normalizedSearchQuery)),
  );
  const visibleAssetFolders = assetFolders.filter(
    (folder) => folder.kind === "folder",
  );
  const favoriteFolder = assetFolders.find((folder) => folder.id === "favorites");
  const subjectFolder = assetFolders.find((folder) => folder.id === "subjects");
  const visibleLibraryAssets = libraryAssets;
  const visibleAiCharacters = aiCharacters;

  const stopAgentVoiceResources = () => {
    if (agentVoiceTimer.current !== undefined) {
      window.clearInterval(agentVoiceTimer.current);
      agentVoiceTimer.current = undefined;
    }
    agentVoiceStream.current?.getTracks().forEach((track) => track.stop());
    agentVoiceStream.current = undefined;
  };

  const clearAgentVoice = () => {
    if (
      agentVoiceRecorder.current &&
      agentVoiceRecorder.current.state !== "inactive"
    ) {
      agentVoiceCancelled.current = true;
      agentVoiceRecorder.current.stop();
    }
    stopAgentVoiceResources();
    agentVoiceRecorder.current = undefined;
    agentVoiceChunks.current = [];
    if (agentVoiceUrl) {
      URL.revokeObjectURL(agentVoiceUrl);
    }
    setAgentVoiceUrl(undefined);
    setAgentVoiceSeconds(0);
    setAgentVoiceState("idle");
  };

  const requestCanvasMenu = (action: CanvasShellMenuCommand["action"]) => {
    if (action !== "dismiss" && effectiveCanvasLoadState !== "ready") return;
    setShellMenuCommand((current) => ({
      action,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  };

  const applyTemplate = (template: TemplateCatalogCard) => {
    if (effectiveCanvasLoadState !== "ready" || !template.graph) return;
    recordRecentTemplate(userId, template.id);
    setTemplateNoticeOpen(false);
    setTemplatesOpen(false);
    setTemplateBrowseAllOpen(false);
    setShellMenuCommand((current) => ({
      action: "apply-template",
      graph: template.graph,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  };

  const deleteUserTemplate = async (template: TemplateCatalogCard) => {
    if (templateTab !== "我的模板") return;
    try {
      const response = await fetch(
        `/api/templates/${encodeURIComponent(template.id)}`,
        {
          headers: { Accept: "application/json" },
          method: "DELETE",
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "模板删除失败");
      }
      setTemplateCatalogRevision((revision) => revision + 1);
    } catch (error) {
      setTemplateCatalogError(
        error instanceof Error ? error.message : "模板删除失败",
      );
    }
  };

  const closePrimarySurfaces = (dismissCanvasMenu = true) => {
    setNodeSearchOpen(false);
    setAssetsOpen(false);
    setAiCharacterFilterOpen(undefined);
    setAiCharactersOpen(false);
    setTemplatesOpen(false);
    setTemplateBrowseAllOpen(false);
    setHistoryOpen(false);
    setHistoryExpanded(false);
    setHistoryPreviewItem(undefined);
    setTasksOpen(false);
    setProjectMenuOpen(false);
    setShareOpen(false);
    setHelpMenuOpen(false);
    setKeyboardShortcutsOpen(false);
    if (agentOpen) clearAgentVoice();
    setAgentFilesOpen(false);
    setAgentMenu(undefined);
    setAgentReferenceMode(false);
    setAgentOpen(false);
    onAccountOpenChange(false);
    if (dismissCanvasMenu) requestCanvasMenu("dismiss");
  };

  const togglePrimarySurface = (
    surface: PrimaryShellSurface,
    currentlyOpen: boolean,
  ) => {
    closePrimarySurfaces();
    if (currentlyOpen) return;
    if (surface === "account") onAccountOpenChange(true);
    if (surface === "agent") setAgentOpen(true);
    if (surface === "assets") setAssetsOpen(true);
    if (surface === "help") setHelpMenuOpen(true);
    if (surface === "history") setHistoryOpen(true);
    if (surface === "project") setProjectMenuOpen(true);
    if (surface === "search") setNodeSearchOpen(true);
    if (surface === "share") setShareOpen(true);
    if (surface === "tasks") setTasksOpen(true);
    if (surface === "templates") setTemplatesOpen(true);
  };

  const finishAgentVoice = () => {
    const recorder = agentVoiceRecorder.current;
    if (!recorder || recorder.state === "inactive") return;
    agentVoiceCancelled.current = false;
    recorder.stop();
    stopAgentVoiceResources();
  };

  const startAgentVoice = async () => {
    if (agentVoiceState === "recording") {
      finishAgentVoice();
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setAgentVoiceState("unsupported");
      return;
    }

    setAgentVoiceState("requesting");
    setAgentVoiceSeconds(0);
    agentVoiceCancelled.current = false;
    if (agentVoiceUrl) {
      URL.revokeObjectURL(agentVoiceUrl);
      setAgentVoiceUrl(undefined);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      agentVoiceStream.current = stream;
      agentVoiceRecorder.current = recorder;
      agentVoiceChunks.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          agentVoiceChunks.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        stopAgentVoiceResources();
        agentVoiceRecorder.current = undefined;
        if (agentVoiceCancelled.current) {
          agentVoiceCancelled.current = false;
          agentVoiceChunks.current = [];
          return;
        }
        const blob = new Blob(agentVoiceChunks.current, {
          type: recorder.mimeType || "audio/webm",
        });
        agentVoiceChunks.current = [];
        if (blob.size > 0) {
          setAgentVoiceUrl(URL.createObjectURL(blob));
          setAgentVoiceState("recorded");
        } else {
          setAgentVoiceState("error");
        }
      });
      recorder.start(250);
      setAgentVoiceState("recording");
      agentVoiceTimer.current = window.setInterval(
        () => setAgentVoiceSeconds((seconds) => seconds + 1),
        1000,
      );
    } catch (error) {
      stopAgentVoiceResources();
      setAgentVoiceState(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "denied"
          : "error",
      );
    }
  };

  useEffect(
    () => () => {
      if (
        agentVoiceRecorder.current &&
        agentVoiceRecorder.current.state !== "inactive"
      ) {
        agentVoiceCancelled.current = true;
        agentVoiceRecorder.current.stop();
      }
      stopAgentVoiceResources();
      if (agentVoiceUrl) {
        URL.revokeObjectURL(agentVoiceUrl);
      }
    },
    [agentVoiceUrl],
  );
  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      category: templateBrowseAllOpen ? templateBrowseCategory : "全部",
      includeGraph: "true",
      limit: "100",
      offset: "0",
      q: templateSearch.trim(),
      space: templateTab === "我的模板" ? "mine" : "public",
    });
    setTemplateCatalogLoading(true);
    setTemplateCatalogError("");
    void fetch(`/api/templates?${parameters.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("模板目录读取失败");
        return response.json() as Promise<TemplateCatalogResponse>;
      })
      .then((catalog) => {
        if (templateBrowseCategory === "最近使用") {
          const recent = readRecentTemplates(userId);
          const recentById = new Map(
            recent.map((entry) => [entry.id, entry.at]),
          );
          setTemplateCards(
            catalog.items
              .filter((item) => recentById.has(item.id))
              .sort(
                (left, right) =>
                  (recentById.get(right.id) ?? 0) -
                  (recentById.get(left.id) ?? 0),
              ),
          );
        } else {
          setTemplateCards(catalog.items);
        }
        if (catalog.categories.length) {
          setTemplateBrowseCategories(catalog.categories);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setTemplateCards([]);
          setTemplateCatalogError(
            error instanceof Error ? error.message : "模板目录读取失败",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setTemplateCatalogLoading(false);
      });
    return () => controller.abort();
  }, [
    templateBrowseAllOpen,
    templateBrowseCategory,
    templateSearch,
    templateTab,
    templateCatalogRevision,
    userId,
  ]);
  const visibleTemplateCards = templateCards;
  useEffect(() => {
    const controller = new AbortController();
    setAgentConfigurationError("");
    void fetch("/api/agent-config", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Agent配置读取失败");
        return response.json() as Promise<AgentConfiguration>;
      })
      .then((configuration) => {
        setAgentConfiguration(configuration);
        setAgentModel((current) => {
          const currentModel = configuration.models.find(
            (model) => model.label === current && model.status === "ready",
          );
          if (currentModel) return currentModel.label;
          return configuration.models.find(
            (model) =>
              model.id === configuration.defaultModelId &&
              model.status === "ready",
          )?.label ?? configuration.models.find(
            (model) => model.status === "ready",
          )?.label ?? "模型";
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setAgentConfigurationError(
            error instanceof Error ? error.message : "Agent配置读取失败",
          );
        }
      });
    return () => controller.abort();
  }, []);
  const agentModels =
    agentConfiguration?.models.filter((model) => model.status !== "coming-soon") ?? [];
  const filteredHistoryItems = historyItems.filter(
    (item) => item.kind === historyTab,
  );
  const historyDates = Array.from(
    new Set(filteredHistoryItems.map(historyItemDate)),
  ).sort((a, b) =>
    historyNewestFirst ? b.localeCompare(a) : a.localeCompare(b),
  );
  const historyPreviewUrl = historyPreviewItem
    ? historyMediaUrl(historyPreviewItem)
    : undefined;

  const closeHistoryPreview = () => setHistoryPreviewItem(undefined);
  const downloadHistoryPreview = () => {
    if (!historyPreviewItem || !historyPreviewUrl) return;
    const extension =
      historyPreviewItem.kind === "image"
        ? "png"
        : historyPreviewItem.kind === "video"
          ? "mp4"
          : "mp3";
    const anchor = document.createElement("a");
    anchor.href = historyPreviewUrl;
    anchor.download = `${historyPreviewItem.label}.${extension}`;
    anchor.click();
  };
  const addHistoryPreviewToCanvas = () => {
    if (
      effectiveCanvasLoadState !== "ready" ||
      !historyPreviewItem ||
      !historyPreviewUrl ||
      historyPreviewItem.kind === "world3d"
    ) {
      return;
    }
    setHistoryAssetRequest({
      asset: {
        id: historyPreviewItem.id,
        kind: historyPreviewItem.kind,
        label: historyPreviewItem.label,
        src: historyPreviewUrl,
      },
      sequence: Date.now(),
    });
    setHistoryPreviewItem(undefined);
    setHistoryExpanded(false);
    setHistoryOpen(false);
  };

  const loadMoreHistory = async () => {
    if (
      !historyNextCursor ||
      historyLoading ||
      historyLoadMoreInFlight.current
    ) {
      return;
    }
    const requestSequence = historyLoadSequence.current + 1;
    historyLoadSequence.current = requestSequence;
    const cursor = historyNextCursor;
    const controller = new AbortController();
    historyLoadMoreAbort.current = controller;
    historyLoadMoreInFlight.current = true;
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const page = await fetchHistoryPage({
        accountId: historyAccountIdForFixture(fixtureId),
        cursor,
        kind: historyTab,
        newestFirst: historyNewestFirst,
        signal: controller.signal,
      });
      if (requestSequence !== historyLoadSequence.current) return;
      setHistoryCounts(page.counts);
      setHistoryItems((current) => {
        const known = new Set(current.map((item) => `${item.kind}\0${item.id}`));
        return [
          ...current,
          ...page.items.filter((item) => !known.has(`${item.kind}\0${item.id}`)),
        ];
      });
      setHistoryNextCursor(page.nextCursor);
    } catch (error) {
      if (requestSequence === historyLoadSequence.current) {
        setHistoryError(
          error instanceof Error ? error.message : "历史素材读取失败",
        );
      }
    } finally {
      if (historyLoadMoreAbort.current === controller) {
        historyLoadMoreAbort.current = undefined;
        historyLoadMoreInFlight.current = false;
      }
      if (requestSequence === historyLoadSequence.current) {
        setHistoryLoading(false);
      }
    }
  };

  const persistProjectTitle = useCallback(
    (title: string) => {
      const updatedAt = Math.max(
        Date.now(),
        projectTitleUpdatedAt.current + 1,
      );
      const record = { title, updatedAt };
      const attempt = projectTitleSaveAttempt.current + 1;
      projectTitleSaveAttempt.current = attempt;
      projectTitleUpdatedAt.current = updatedAt;
      writeProjectTitleDraft(userId, projectTitleId, record);
      setSaveStatus("保存中...");
      void fetch(`/api/project-title/${encodeURIComponent(projectTitleId)}`, {
        body: JSON.stringify(record),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "PUT",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Project title save failed");
          const saved = parseProjectTitleRecord(await response.json());
          if (
            !saved ||
            saved.title !== record.title ||
            saved.updatedAt !== record.updatedAt
          ) {
            throw new Error("Project title response is stale");
          }
          if (projectTitleSaveAttempt.current === attempt) {
            setSaveStatus("已保存到云端");
          }
        })
        .catch(() => {
          if (projectTitleSaveAttempt.current === attempt) {
            setSaveStatus("项目名称保存失败，请重试");
          }
        });
    },
    [projectTitleId, userId],
  );
  const projectTitleControl = useCompositionSafeText({
    onCommit: (title) => {
      setProjectTitleValue(title);
      persistProjectTitle(title);
    },
    value: projectTitleValue,
  });

  const beginProjectAction = (action: ProjectAction) => {
    if (projectActionInFlight.current) return false;
    projectActionInFlight.current = action;
    setProjectActionBusy(action);
    setProjectActionError("");
    return true;
  };

  const finishProjectAction = (action: ProjectAction) => {
    if (projectActionInFlight.current !== action) return;
    projectActionInFlight.current = undefined;
    setProjectActionBusy(undefined);
  };

  const createProjectFromMenu = async () => {
    if (!beginProjectAction("create")) return;
    try {
      const response = await fetch("/api/projects", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
      const created = projectMutationResponse(await response.json());
      if (!created) throw new Error("服务器返回了无效项目");
      window.location.href = `/canvas/${encodeURIComponent(created.id)}`;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message.trim() : "";
      setProjectActionError(
        detail ? `新建项目失败：${detail}` : "新建项目失败，请重试",
      );
    } finally {
      finishProjectAction("create");
    }
  };

  const cloneCurrentProject = async () => {
    if (!projectId || !beginProjectAction("clone")) return;
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/clone`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
      const cloned = projectMutationResponse(await response.json());
      if (!cloned) throw new Error("服务器返回了无效项目");
      window.location.href = `/canvas/${encodeURIComponent(cloned.id)}`;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message.trim() : "";
      setProjectActionError(
        detail ? `克隆项目失败：${detail}` : "克隆项目失败，请重试",
      );
    } finally {
      finishProjectAction("clone");
    }
  };

  const deleteCurrentProject = async () => {
    if (!projectId || !beginProjectAction("delete")) return;
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
      setDeleteConfirmOpen(false);
      clearProjectLocalKeys(projectId, userId);
      window.location.href = "/canvas/projects";
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message.trim() : "";
      setProjectActionError(
        detail ? `删除项目失败：${detail}` : "删除项目失败，请重试",
      );
    } finally {
      finishProjectAction("delete");
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const local = readProjectTitleDraft(userId, projectTitleId);
    void fetch(`/api/project-title/${encodeURIComponent(projectTitleId)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error("Project title load failed");
        const record = parseProjectTitleRecord(await response.json());
        if (!record || record.updatedAt < 1) {
          throw new Error("Project title response is invalid");
        }
        return record;
      })
      .then((serverRecord) => {
        if (controller.signal.aborted) return;
        if (!serverRecord) {
          if (projectId) {
            onProjectMissing?.();
            return;
          }
          if (local && local.updatedAt > 0) {
            void fetch(
              `/api/project-title/${encodeURIComponent(projectTitleId)}`,
              {
                body: JSON.stringify(local),
                headers: { "Content-Type": "application/json" },
                keepalive: true,
                method: "PUT",
              },
            );
          }
          return;
        }
        const current = readProjectTitleDraft(userId, projectTitleId) ?? local;
        if (
          !current ||
          serverRecord.updatedAt > current.updatedAt
        ) {
          projectTitleUpdatedAt.current = serverRecord.updatedAt;
          writeProjectTitleDraft(userId, projectTitleId, serverRecord);
          setProjectTitleValue(serverRecord.title);
          return;
        }
        if (current.updatedAt > serverRecord.updatedAt) {
          void fetch(
            `/api/project-title/${encodeURIComponent(projectTitleId)}`,
            {
              body: JSON.stringify(current),
              headers: { "Content-Type": "application/json" },
              keepalive: true,
              method: "PUT",
            },
          );
        }
      })
      .catch(() => {
        // Keep the synchronous local draft when the server is temporarily absent.
      });
    return () => controller.abort();
  }, [onProjectMissing, projectId, projectTitleId]);

  // 每个标签页独立记住“最近打开的项目”，供工作空间返回时兜底。
  useEffect(() => {
    if (!projectId) return;
    try {
      sessionStorage.setItem(`unboundry:last-project:${userId}`, projectId);
    } catch {
      // 隐私模式等场景忽略；工作空间的 ?from 参数仍是主路径。
    }
  }, [projectId, userId]);

  useEffect(
    () => () => window.clearTimeout(saveTimer.current),
    [],
  );

  useEffect(() => {
    if (!nodeSearchOpen) return;
    nodeSearchInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNodeSearchOpen(false);
      restoreShellControlFocus("node-search");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [nodeSearchOpen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const closeAddMenu = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else {
        const target = event.target as Element | null;
        if (
          target?.closest('[data-testid="add-node-menu"]') ||
          target?.closest('[data-testid="add-node"]')
        ) {
          return;
        }
      }
      requestCanvasMenu("dismiss");
      const switchingSurface =
        event instanceof MouseEvent &&
        (event.target as Element | null)?.closest(
          '[data-testid="node-search"], [data-testid="assets"], [data-testid="templates"], [data-testid="history"], [data-testid="user-avatar"], [data-testid="logo-button"], [data-testid="share"], [data-testid="help"], [data-testid="agent-bubble"]',
        );
      if (!switchingSurface) restoreShellControlFocus("add-node");
    };
    window.addEventListener("keydown", closeAddMenu);
    window.addEventListener("mousedown", closeAddMenu, true);
    return () => {
      window.removeEventListener("keydown", closeAddMenu);
      window.removeEventListener("mousedown", closeAddMenu, true);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    if (!assetsOpen) return;
    const controller = new AbortController();
    const spaceId = assetsTab === "团队" ? "team" : "personal";
    const parameters = new URLSearchParams({
      folder: assetFolder,
      limit: String(libraryVisibleCount),
      offset: "0",
      q: assetSearch.trim(),
      space: spaceId,
    });
    setLibraryCatalogLoading(true);
    setLibraryCatalogError("");
    fetch(`/api/library?${parameters.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("素材目录暂时无法读取");
        return await response.json() as LibraryCatalogResponse;
      })
      .then((catalog) => {
        setAssetSpaces(catalog.spaces);
        setAssetFolders(catalog.folders);
        setLibraryAssets(catalog.items);
        setLibraryAssetTotal(catalog.pagination.total);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAssetFolders([]);
        setLibraryAssets([]);
        setLibraryAssetTotal(0);
        setLibraryCatalogError(
          error instanceof Error ? error.message : "素材目录暂时无法读取",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLibraryCatalogLoading(false);
      });
    return () => controller.abort();
  }, [
    assetFolder,
    assetSearch,
    assetsOpen,
    assetsTab,
    libraryVisibleCount,
  ]);

  useEffect(() => {
    if (!aiCharactersOpen) return;
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      category: aiCharacterCategory,
      limit: String(aiCharacterVisibleCount),
      offset: "0",
    });
    Object.entries(aiCharacterSelections).forEach(([key, values]) => {
      values?.forEach((value) => parameters.append("filter", `${key}:${value}`));
    });
    setAiCharacterCatalogLoading(true);
    setAiCharacterCatalogError("");
    fetch(`/api/characters?${parameters.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("角色目录暂时无法读取");
        return await response.json() as AiCharacterCatalogResponse;
      })
      .then((catalog) => {
        setAiCharacterCategories(catalog.categories);
        setAiCharacterFilters(catalog.filters);
        setAiCharacters(catalog.items);
        setAiCharacterTotal(catalog.pagination.total);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAiCharacters([]);
        setAiCharacterTotal(0);
        setAiCharacterCatalogError(
          error instanceof Error ? error.message : "角色目录暂时无法读取",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setAiCharacterCatalogLoading(false);
      });
    return () => controller.abort();
  }, [
    aiCharacterCategory,
    aiCharacterSelections,
    aiCharacterVisibleCount,
    aiCharactersOpen,
  ]);

  useEffect(() => {
    if (!aiCharactersOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAiCharacterFilterOpen(undefined);
      setAiCharactersOpen(false);
      window.requestAnimationFrame(() => {
        assetsPanel.current
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="AI 角色"]',
          )
          ?.focus();
      });
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [aiCharactersOpen]);

  useEffect(() => {
    if (!templateBrowseAllOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTemplateBrowseAllOpen(false);
      window.requestAnimationFrame(() => {
        templatesPanel.current
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="浏览全部"]',
          )
          ?.focus();
      });
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [templateBrowseAllOpen]);

  useEffect(() => {
    if (!historyExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHistoryExpanded(false);
      window.requestAnimationFrame(() => {
        historyPanel.current
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="浏览全部历史"]',
          )
          ?.focus();
      });
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [historyExpanded]);

  useEffect(() => {
    if (!historyPreviewItem) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryPreviewItem(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [historyPreviewItem]);

  useEffect(() => {
    const panel =
      assetsOpen
        ? {
            element: assetsPanel.current,
            setOpen: setAssetsOpen,
            testId: "assets",
          }
        : templatesOpen
          ? {
              element: templatesPanel.current,
              setOpen: setTemplatesOpen,
              testId: "templates",
            }
          : historyOpen
            ? {
                element: historyPanel.current,
                setOpen: setHistoryOpen,
                testId: "history",
              }
            : tasksOpen
              ? {
                  element: tasksPanel.current,
                  setOpen: setTasksOpen,
                  testId: "tasks",
                }
            : undefined;
    if (
      !panel ||
      nodeSearchOpen ||
      aiCharactersOpen ||
      templateBrowseAllOpen ||
      historyExpanded ||
      historyPreviewItem
    ) {
      return;
    }
    const closePanel = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else {
        const target = event.target as Element | null;
        if (
          panel.element?.contains(target) ||
          target?.closest(`[data-testid="${panel.testId}"]`) ||
          (panel.testId === "templates" &&
            target?.closest('[data-testid="template-first-notice"]'))
        ) {
          return;
        }
      }
      const switchingPanel =
        event instanceof MouseEvent &&
        (event.target as Element | null)?.closest(
          '[data-testid="add-node"], [data-testid="node-search"], [data-testid="assets"], [data-testid="templates"], [data-testid="history"], [data-testid="tasks"], [data-testid="user-avatar"], [data-testid="logo-button"], [data-testid="share"], [data-testid="help"], [data-testid="agent-bubble"]',
        );
      if (switchingPanel) return;
      panel.setOpen(false);
      restoreShellControlFocus(panel.testId);
    };
    window.addEventListener("keydown", closePanel);
    window.addEventListener("mousedown", closePanel, true);
    return () => {
      window.removeEventListener("keydown", closePanel);
      window.removeEventListener("mousedown", closePanel, true);
    };
  }, [
    aiCharactersOpen,
    assetsOpen,
    historyExpanded,
    historyOpen,
    historyPreviewItem,
    nodeSearchOpen,
    tasksOpen,
    templateBrowseAllOpen,
    templatesOpen,
  ]);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const closeProjectMenu = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else {
        const target = event.target as Element | null;
        if (
          projectMenu.current?.contains(target) ||
          target?.closest('[data-testid="logo-button"]')
        ) {
          return;
        }
      }
      setProjectMenuOpen(false);
      if (event instanceof KeyboardEvent) {
        window.requestAnimationFrame(() => {
          (
            document.querySelector(
              '[data-testid="logo-button"]',
            ) as HTMLButtonElement | null
          )?.focus();
        });
      }
    };
    window.addEventListener("keydown", closeProjectMenu);
    window.addEventListener("mousedown", closeProjectMenu, true);
    return () => {
      window.removeEventListener("keydown", closeProjectMenu);
      window.removeEventListener("mousedown", closeProjectMenu, true);
    };
  }, [projectMenuOpen]);

  useEffect(() => {
    if (!shareOpen) return;
    const closeShare = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else {
        const target = event.target as Element | null;
        if (
          sharePopover.current?.contains(target) ||
          target?.closest('[data-testid="share"]')
        ) {
          return;
        }
      }
      setShareOpen(false);
      const switchingSurface =
        event instanceof MouseEvent &&
        (event.target as Element | null)?.closest(
          '[data-testid="add-node"], [data-testid="node-search"], [data-testid="assets"], [data-testid="templates"], [data-testid="history"], [data-testid="tasks"], [data-testid="user-avatar"], [data-testid="logo-button"], [data-testid="help"], [data-testid="agent-bubble"]',
        );
      if (!switchingSurface) restoreShellControlFocus("share");
    };
    window.addEventListener("keydown", closeShare);
    window.addEventListener("mousedown", closeShare, true);
    return () => {
      window.removeEventListener("keydown", closeShare);
      window.removeEventListener("mousedown", closeShare, true);
    };
  }, [shareOpen]);

  useEffect(() => {
    if (!helpMenuOpen && !keyboardShortcutsOpen) return;
    const closeHelpSurface = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        setHelpMenuOpen(false);
        setKeyboardShortcutsOpen(false);
        window.requestAnimationFrame(() => {
          (
            document.querySelector(
              '[data-testid="help"]',
            ) as HTMLButtonElement | null
          )?.focus();
        });
        return;
      }
      if (!helpMenuOpen) return;
      const target = event.target as Element | null;
      if (
        helpMenu.current?.contains(target) ||
        target?.closest('[data-testid="help"]')
      ) {
        return;
      }
      setHelpMenuOpen(false);
    };
    window.addEventListener("keydown", closeHelpSurface);
    window.addEventListener("mousedown", closeHelpSurface, true);
    return () => {
      window.removeEventListener("keydown", closeHelpSurface);
      window.removeEventListener("mousedown", closeHelpSurface, true);
    };
  }, [helpMenuOpen, keyboardShortcutsOpen]);

  useEffect(() => {
    if (!historyOpen) return;
    historyLoadMoreAbort.current?.abort();
    historyLoadMoreAbort.current = undefined;
    historyLoadMoreInFlight.current = false;
    const controller = new AbortController();
    const requestSequence = historyLoadSequence.current + 1;
    historyLoadSequence.current = requestSequence;
    const accountId = historyAccountIdForFixture(fixtureId);
    const seed = historySeedForFixture(fixtureId);
    setHistoryItems([]);
    setHistoryNextCursor(undefined);
    setHistoryError("");
    setHistoryLoading(true);

    void (async () => {
      let page = await fetchHistoryPage({
        accountId,
        kind: historyTab,
        newestFirst: historyNewestFirst,
        signal: controller.signal,
      });
      const total = Object.values(page.counts).reduce(
        (sum, count) => sum + count,
        0,
      );
      if (total === 0 && seed.length > 0) {
        const url = `/api/history/${encodeURIComponent(accountId)}`;
        const created = await Promise.all(
          seed.map((item) =>
            fetch(url, {
              body: JSON.stringify({
                ...item,
                preview: persistedHistoryPreview(item),
              }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
              signal: controller.signal,
            }),
          ),
        );
        if (created.some((response) => !response.ok)) {
          throw new Error("历史素材初始化失败");
        }
        page = await fetchHistoryPage({
          accountId,
          kind: historyTab,
          newestFirst: historyNewestFirst,
          signal: controller.signal,
        });
      }
      if (
        controller.signal.aborted ||
        requestSequence !== historyLoadSequence.current
      ) {
        return;
      }
      setHistoryCounts(page.counts);
      setHistoryItems(page.items);
      setHistoryNextCursor(page.nextCursor);
    })()
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          requestSequence === historyLoadSequence.current
        ) {
          setHistoryError(
            error instanceof Error ? error.message : "历史素材读取失败",
          );
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requestSequence === historyLoadSequence.current
        ) {
          setHistoryLoading(false);
        }
      });
    return () => {
      controller.abort();
      historyLoadMoreAbort.current?.abort();
      historyLoadMoreAbort.current = undefined;
      historyLoadMoreInFlight.current = false;
      if (requestSequence === historyLoadSequence.current) {
        historyLoadSequence.current += 1;
      }
    };
  }, [
    fixtureId,
    historyNewestFirst,
    historyOpen,
    historyRefreshEpoch,
    historyTab,
  ]);

  const markSaving = useCallback(() => {
    setSaveStatus("保存中...");
    if (!durableFixture) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(
        () => setSaveStatus("已保存到云端"),
        300,
      );
    }
  }, [durableFixture]);
  const markSaveConflict = useCallback((message?: string) => {
    setSaveConflict(true);
    setSaveConflictMessage(message?.trim() || "另一页面已经保存了更新");
    setSaveStatus("保存失败");
    window.setTimeout(() => setSaveConflict(false), 3_500);
  }, []);
  const markSaveSuccess = useCallback(() => {
    setSaveStatus("已保存到云端");
  }, []);
  const markCanvasLoadState = useCallback((state: CanvasLoadState) => {
    setCanvasLoadScopeId(canvasScopeId);
    setCanvasLoadState(state);
    setSaveStatus(
      state === "ready"
        ? "已保存到云端"
        : state === "loading"
          ? "正在加载画布..."
          : state === "missing"
            ? "项目不存在"
            : "画布加载失败",
    );
  }, [canvasScopeId]);

  return (
    <main
      className="canvas-shell"
      data-canvas-load-state={effectiveCanvasLoadState}
      data-agent-open={agentOpen || undefined}
      data-dock-placement={assetsOpen ? "after-assets" : "default"}
      data-fixture-id={fixtureId}
      data-fixture-ready={fixtureId ? "true" : undefined}
      data-testid="canvas-shell"
    >
      <CanvasSurface
        key={canvasScopeId}
        accountId={userId}
        agentReferenceMode={agentReferenceMode}
        fixtureId={fixtureId}
        onProjectMissing={onProjectMissing}
        projectId={projectId}
        focusNodeRequest={focusNodeRequest}
        historyAssetRequest={historyAssetRequest}
        minimapOpen={minimapOpen}
        onAddMenuOpenChange={setAddMenuOpen}
        onAgentReferencePick={(reference) =>
          setAgentReferences((current) =>
            current.some((item) => item.id === reference.id)
              ? current
              : [...current, reference],
          )
        }
        onReady={(fitView) => setFitWorld(() => fitView)}
        onGraphContentChange={setGraphHasContent}
        onGenerationRetryGateChange={registerGenerationRetryGate}
        onLoadStateChange={markCanvasLoadState}
        onOpenAssets={() => {
          closePrimarySurfaces();
          setAssetsOpen(true);
        }}
        onSearchIndexChange={setNodeSearchEntries}
        onSaveConflict={markSaveConflict}
        onSaveSuccess={markSaveSuccess}
        onSaveStart={markSaving}
        onZoomChange={setZoomSummary}
        viewportRequest={viewportRequest}
        shellMenuCommand={shellMenuCommand}
        snapEnabled={snapEnabled}
        textVideoStarted={textVideoStarted}
      />

      {agentReferenceMode && (
        <section
          aria-live="polite"
          className="agent-reference-banner"
          data-testid="agent-reference-banner"
        >
          <div>
            <strong>从画布添加</strong>
            <span>点击节点以添加为引用</span>
          </div>
          <button
            onClick={() => setAgentReferenceMode(false)}
            type="button"
          >
            退出
          </button>
        </section>
      )}

      {agentOpen && agentFilesOpen && (
        <aside
          aria-label="文件"
          className="agent-files-panel"
          data-testid="agent-files-panel"
        >
          <header>
            <strong>文件</strong>
            <button
              aria-label="收起文件"
              onClick={() => setAgentFilesOpen(false)}
              type="button"
            >
              →
            </button>
          </header>
          <p>暂无输出</p>
        </aside>
      )}

      {saveConflict && (
        <section
          aria-live="assertive"
          className="save-conflict-toast"
          data-testid="save-conflict"
        >
          {saveConflictMessage}
        </section>
      )}

      {projectActionError && (
        <section
          aria-live="assertive"
          className="save-conflict-toast"
          data-testid="project-action-error"
          role="alert"
        >
          {projectActionError}
        </section>
      )}

      <section className="project-area" data-testid="project-area">
        <ShellButton
          active={projectMenuOpen}
          label="项目菜单"
          onClick={() =>
            togglePrimarySurface("project", projectMenuOpen)
          }
          testId="logo-button"
          className="logo-button"
        >
          <span aria-hidden="true" className="replica-mark" />
        </ShellButton>
        <label className="project-title-wrap">
          <span className="sr-only">项目名称</span>
          <input
            aria-label="项目名称"
            data-composition-active={projectTitleControl.composing || undefined}
            data-testid="title-input"
            disabled={effectiveCanvasLoadState !== "ready"}
            maxLength={120}
            onBlur={() => projectTitleControl.blur()}
            onChange={(event) =>
              projectTitleControl.change(
                event.currentTarget.value,
                (event.nativeEvent as InputEvent).isComposing,
              )
            }
            onCompositionEnd={(event) =>
              projectTitleControl.compositionEnd(event.currentTarget.value)
            }
            onCompositionStart={() => projectTitleControl.compositionStart()}
            onKeyDown={(event) => {
              projectTitleControl.keyDown(event);
            }}
            ref={titleInput}
            spellCheck={false}
            value={projectTitleControl.value}
          />
          <span className="last-modified" data-testid="save-status">
            {saveStatus}
          </span>
        </label>
      </section>

      {projectMenuOpen && (
        <menu
          aria-label="项目菜单"
          className="project-menu"
          data-testid="project-menu"
          ref={projectMenu}
        >
          <span className="project-menu-label">项目</span>
          <button
            onClick={() => {
              setProjectMenuOpen(false);
              window.location.href = projectId
                ? `/canvas/projects?from=${encodeURIComponent(projectId)}`
                : "/canvas/projects";
            }}
            type="button"
          >
            {projectId ? "返回工作空间" : "工作空间"}
          </button>
          <button
            onClick={() => {
              setProjectMenuOpen(false);
              window.requestAnimationFrame(() => {
                titleInput.current?.focus();
                titleInput.current?.select();
              });
            }}
            type="button"
          >
            重命名
          </button>
          <button
            disabled={projectActionBusy !== undefined}
            onClick={() => void createProjectFromMenu()}
            type="button"
          >
            {projectActionBusy === "create" ? "正在新建…" : "新建项目"}
          </button>
          <button
            disabled={!projectId || projectActionBusy !== undefined}
            onClick={() => void cloneCurrentProject()}
            type="button"
          >
            {projectActionBusy === "clone" ? "正在克隆…" : "克隆项目"}
          </button>
          <div className="project-menu-divider" />
          <button
            className="project-menu-delete"
            disabled={
              !projectId ||
              projectId === "default" ||
              projectActionBusy !== undefined
            }
            onClick={() => setDeleteConfirmOpen(true)}
            title={
              projectId === "default"
                ? "默认项目不能删除"
                : projectId
                  ? "删除当前项目"
                  : "为保护当前项目，暂未开放删除"
            }
            type="button"
          >
            删除
          </button>
        </menu>
      )}

      {deleteConfirmOpen && projectId && (
        <ConfirmDialog
          danger
          message={`确定要删除项目「${projectTitleValue}」？画布和生成任务记录将删除，素材库中的媒体会保留。`}
          onCancel={() => {
            if (projectActionBusy !== "delete") setDeleteConfirmOpen(false);
          }}
          onConfirm={() => void deleteCurrentProject()}
          title="确认删除"
        />
      )}

      <nav aria-label="项目操作" className="top-right" data-testid="top-right">
        <ShellButton
          active={shareOpen}
          label="分享"
          testId="share"
          className="share"
          onClick={() => {
            togglePrimarySurface("share", shareOpen);
          }}
        >
          <LineIcon name="share" />
        </ShellButton>
      </nav>
      {shareOpen && (
        <aside
          aria-label="分享"
          className="share-popover"
          data-testid="share-popover"
          ref={sharePopover}
          role="dialog"
        >
          <section aria-disabled="true" className="share-popover-row">
            <div className="share-popover-heading">
              <span className="share-popover-title">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2-2v-2M7 12c3.33-4.67 6.67-4.67 10 0M7 12c3.33 4.67 6.67 4.67 10 0M12 12h-.01" />
                </svg>
                移动到团队项目
              </span>
              <button disabled title="私有版未启用团队项目" type="button">
                移动
              </button>
            </div>
            <p>私有版未启用团队项目，暂不可移动。</p>
          </section>
        </aside>
      )}

      <nav aria-label="画布工具" className="left-toolbar" data-testid="left-toolbar">
        {dockItems.map(([icon, label, testId]) => (
          <ShellButton
            className={`dock-item dock-${testId}`}
            key={testId}
            label={label}
            active={
              (testId === "add-node" && addMenuOpen) ||
              (testId === "history" && historyOpen) ||
              (testId === "tasks" && tasksOpen) ||
              (testId === "node-search" && nodeSearchOpen) ||
              (testId === "assets" && assetsOpen) ||
              (testId === "templates" && templatesOpen)
            }
            onClick={
              testId === "add-node"
                ? () => {
                    closePrimarySurfaces(false);
                    requestCanvasMenu("toggle-add");
                  }
                : testId === "node-search"
                  ? () =>
                      togglePrimarySurface("search", nodeSearchOpen)
                : testId === "assets"
                  ? () => togglePrimarySurface("assets", assetsOpen)
                : testId === "templates"
                  ? () => togglePrimarySurface("templates", templatesOpen)
                : testId === "history"
                ? () => {
                    togglePrimarySurface("history", historyOpen);
                  }
                : testId === "tasks"
                  ? () => togglePrimarySurface("tasks", tasksOpen)
                : undefined
            }
            disabled={testId === "add-node" && effectiveCanvasLoadState !== "ready"}
            testId={testId}
          >
            <LineIcon name={icon} />
          </ShellButton>
        ))}
        <ShellButton
          label="用户"
          testId="user-avatar"
          className="user-avatar"
          active={accountOpen}
          onClick={() => togglePrimarySurface("account", accountOpen)}
        >
          {userInitial}
        </ShellButton>
      </nav>

      {nodeSearchOpen && (
        <div
          className="node-search-backdrop"
          data-testid="node-search-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget !== event.target) return;
            setNodeSearchOpen(false);
            restoreShellControlFocus("node-search");
          }}
          role="presentation"
        >
          <section
            aria-describedby="node-search-description"
            aria-labelledby="node-search-title"
            aria-modal="true"
            className="node-search-dialog"
            data-canvas-empty={nodeSearchEntries.length === 0 || undefined}
            data-testid="node-search-dialog"
            role="dialog"
          >
            <h2 className="sr-only" id="node-search-title">
              节点搜索
            </h2>
            <p className="sr-only" id="node-search-description">
              按标题、Prompt 或文本搜索画布节点。
            </p>
            <label className="node-search-input-row">
              <LineIcon name="search" />
              <span className="sr-only">搜索节点</span>
              <input
                aria-label="搜索节点..."
                data-composition-active={nodeSearchControl.composing || undefined}
                onBlur={() => nodeSearchControl.blur()}
                onChange={(event) =>
                  nodeSearchControl.change(
                    event.target.value,
                    (event.nativeEvent as InputEvent).isComposing,
                  )
                }
                onCompositionEnd={(event) =>
                  nodeSearchControl.compositionEnd(event.currentTarget.value)
                }
                onCompositionStart={() => nodeSearchControl.compositionStart()}
                onKeyDown={(event) => {
                  nodeSearchControl.keyDown(event);
                }}
                placeholder="搜索节点..."
                ref={nodeSearchInput}
                spellCheck={false}
                type="search"
                value={nodeSearchControl.value}
              />
            </label>
            <div
              aria-label="节点类型"
              className="node-search-categories"
              role="toolbar"
            >
              {nodeSearchCategories.map(([label, icon]) => (
                <button
                  aria-pressed={nodeSearchCategory === label}
                  key={label}
                  onClick={() => setNodeSearchCategory(label)}
                  type="button"
                >
                  <LineIcon name={icon} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            {visibleSearchEntries.length > 0 ? (
              <div
                aria-label="搜索结果"
                className="node-search-results"
                data-testid="node-search-results"
              >
                {visibleSearchEntries.map((entry) => {
                  const icon =
                    entry.type === "image"
                      ? "image"
                      : entry.type === "video"
                        ? "video"
                        : entry.type === "audio"
                          ? "music"
                          : entry.type === "text"
                            ? "text"
                            : entry.type === "group"
                              ? "group"
                              : "search";
                  return (
                    <button
                      aria-label={`${entry.title} ${entry.detail}`}
                      data-node-id={entry.id}
                      key={entry.id}
                      onClick={() => {
                        setFocusNodeRequest((current) => ({
                          id: entry.id,
                          sequence: (current?.sequence ?? 0) + 1,
                        }));
                        setNodeSearchOpen(false);
                      }}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="node-search-result-icon"
                        data-has-thumbnail={entry.thumbnail || undefined}
                        style={
                          entry.thumbnail
                            ? {
                                backgroundImage: `url("${entry.thumbnail}")`,
                              }
                            : undefined
                        }
                      >
                        {!entry.thumbnail && <LineIcon name={icon} />}
                      </span>
                      <span className="node-search-result-copy">
                        <strong>{entry.title}</strong>
                        <small>{entry.detail}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="node-search-empty" data-testid="node-search-empty">
                <LineIcon name="search" />
                <span>
                  {nodeSearchEntries.length === 0 && !nodeSearchQuery.trim()
                    ? "暂无可搜索节点"
                    : "未找到匹配节点"}
                </span>
              </div>
            )}
          </section>
        </div>
      )}

      {assetsOpen && (
        <aside
          aria-label="素材库"
          className="assets-panel"
          data-testid="assets-panel"
          ref={assetsPanel}
        >
          <header className="assets-panel-header">
            <button
              aria-label="关闭素材库"
              className="assets-panel-back"
              onClick={() => {
                setAssetsOpen(false);
                restoreShellControlFocus("assets");
              }}
              type="button"
            >
              ‹
            </button>
            <h2>素材库</h2>
            <button
              aria-label="AI 角色"
              className="assets-ai-characters"
              onClick={() => setAiCharactersOpen(true)}
              type="button"
            >
              <span aria-hidden="true">▣</span>
              AI 角色
            </button>
            <button
              aria-label="新建文件夹"
              className="assets-create-folder"
              disabled
              title="暂未开放"
              type="button"
            >
              +
            </button>
          </header>

          <div
            aria-label="素材空间"
            className="assets-tabs"
            data-testid="assets-tabs"
            role="tablist"
          >
            {assetSpaces.map((space) => (
              <button
                aria-selected={assetsTab === space.label}
                key={space.id}
                onClick={() => {
                  setAssetsTab(space.label);
                  setLibraryVisibleCount(20);
                }}
                role="tab"
                type="button"
              >
                {space.label}
              </button>
            ))}
          </div>

          <label className="assets-search" data-testid="assets-search">
            <LineIcon name="search" />
            <span className="sr-only">搜索素材</span>
            <input
              aria-label="搜索"
              data-composition-active={assetSearchControl.composing || undefined}
              onBlur={() => assetSearchControl.blur()}
              onChange={(event) =>
                assetSearchControl.change(
                  event.target.value,
                  (event.nativeEvent as InputEvent).isComposing,
                )
              }
              onCompositionEnd={(event) =>
                assetSearchControl.compositionEnd(event.currentTarget.value)
              }
              onCompositionStart={() => assetSearchControl.compositionStart()}
              onKeyDown={(event) => {
                assetSearchControl.keyDown(event);
              }}
              placeholder="搜索"
              spellCheck={false}
              type="search"
              value={assetSearchControl.value}
            />
          </label>

          <nav aria-label="素材文件夹" className="assets-folder-nav">
            {favoriteFolder && (
              <button
                aria-current={assetFolder === favoriteFolder.id || undefined}
                onClick={() => {
                  setAssetFolder(favoriteFolder.id);
                  setLibraryVisibleCount(20);
                }}
                type="button"
              >
                <span aria-hidden="true" className="assets-star">
                  ★
                </span>
                {favoriteFolder.label}
              </button>
            )}
            {subjectFolder && (
              <button
                aria-current={assetFolder === subjectFolder.id || undefined}
                className="assets-subject-library"
                onClick={() => {
                  setAssetFolder(subjectFolder.id);
                  setLibraryVisibleCount(20);
                }}
                type="button"
              >
                <span aria-hidden="true" className="assets-subject-icon">
                  ♙
                </span>
                {subjectFolder.label}
                <small aria-hidden="true">?</small>
              </button>
            )}
            <div className="assets-folder-divider" />
            <span className="assets-folder-label">文件夹</span>
            <div className="assets-folder-list">
              {visibleAssetFolders.map((folder) => (
                <button
                  aria-current={assetFolder === folder.id || undefined}
                  key={folder.id}
                  onClick={() => {
                    setAssetFolder(folder.id);
                    setLibraryVisibleCount(20);
                  }}
                  type="button"
                >
                  <span aria-hidden="true" className="assets-folder-chevron">
                    ›
                  </span>
                  <LineIcon name="assets" />
                  <span>{folder.label}</span>
                </button>
              ))}
            </div>
          </nav>

          {libraryCatalogLoading && visibleLibraryAssets.length === 0 ? (
            <p className="assets-empty">正在读取素材…</p>
          ) : libraryCatalogError ? (
            <p className="assets-empty">{libraryCatalogError}</p>
          ) : visibleLibraryAssets.length > 0 ? (
            <section
              aria-label="可拖动素材"
              className="assets-library-grid"
              data-testid="assets-library-grid"
            >
              <p>拖动素材到画布</p>
              <small data-testid="assets-library-total">
                共 {libraryAssetTotal} 个素材
              </small>
              <div>
                {visibleLibraryAssets.map((asset) => (
                  <button
                    aria-label={`拖动素材 ${asset.label}`}
                    className="assets-library-card"
                    data-kind={asset.kind}
                    draggable
                    key={asset.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        CANVAS_LIBRARY_ASSET_MIME,
                        JSON.stringify(asset),
                      );
                    }}
                    title="拖到画布"
                    type="button"
                  >
                    <span data-preview={asset.kind} />
                    <strong>{asset.label}</strong>
                    <small>
                      {asset.kind === "image"
                        ? "图片"
                        : asset.kind === "video"
                          ? "视频"
                          : "音频"}
                    </small>
                  </button>
                ))}
              </div>
              {visibleLibraryAssets.length < libraryAssetTotal && (
                <button
                  className="assets-library-load-more"
                  onClick={() =>
                    setLibraryVisibleCount((count) =>
                      Math.min(libraryAssetTotal, count + 20),
                    )
                  }
                  type="button"
                >
                  加载更多
                </button>
              )}
            </section>
          ) : (
            <p className="assets-empty" data-testid="assets-empty">
              该文件夹暂无素材
            </p>
          )}
        </aside>
      )}

      {aiCharactersOpen && (
        <section
          aria-label="AI角色库"
          aria-modal="true"
          className="ai-characters-overlay"
          data-testid="ai-characters-overlay"
          role="dialog"
        >
          <button
            aria-label="关闭 AI角色库"
            className="ai-characters-close"
            onClick={() => {
              setAiCharacterFilterOpen(undefined);
              setAiCharactersOpen(false);
              window.requestAnimationFrame(() => {
                assetsPanel.current
                  ?.querySelector<HTMLButtonElement>(
                    'button[aria-label="AI 角色"]',
                  )
                  ?.focus();
              });
            }}
            type="button"
          >
            ×
          </button>

          <aside className="ai-characters-sidebar">
            <h2>AI角色库</h2>
            <nav aria-label="角色分类">
              {aiCharacterCategories.map((category) => (
                <button
                  aria-current={
                    aiCharacterCategory === category || undefined
                  }
                  key={category}
                  onClick={() => {
                    setAiCharacterCategory(category);
                    setAiCharacterVisibleCount(60);
                  }}
                  type="button"
                >
                  <span>{category}</span>
                  {category !== "全部角色" && (
                    <small aria-hidden="true">›</small>
                  )}
                </button>
              ))}
            </nav>
          </aside>

          <div
            className="ai-characters-content"
            data-testid="ai-characters-content"
          >
            <h3>{aiCharacterCategory}</h3>
            <div
              aria-label="角色筛选"
              className="ai-character-filters"
            >
              {(Object.keys(aiCharacterFilters) as AiCharacterFilter[]).map(
                (filter) => (
                  <div className="ai-character-filter-wrap" key={filter}>
                    <button
                      aria-expanded={aiCharacterFilterOpen === filter}
                      onClick={() =>
                        setAiCharacterFilterOpen((current) =>
                          current === filter ? undefined : filter,
                        )
                      }
                      type="button"
                    >
                      <span aria-hidden="true">＋</span>
                      {filter}
                      {(aiCharacterSelections[filter]?.length ?? 0) > 0 && (
                        <b>{aiCharacterSelections[filter]!.length}</b>
                      )}
                    </button>
                    {aiCharacterFilterOpen === filter && (
                      <div
                        aria-label={`${filter}筛选`}
                        className="ai-character-filter-menu"
                      >
                        {aiCharacterFilters[filter].map((value) => (
                          <label key={value}>
                            <input
                              checked={
                                aiCharacterSelections[filter]?.includes(
                                  value,
                                ) ?? false
                              }
                              onChange={(event) => {
                                setAiCharacterSelections((current) => {
                                  const values = current[filter] ?? [];
                                  return {
                                    ...current,
                                    [filter]: event.target.checked
                                      ? [...values, value]
                                      : values.filter(
                                          (candidate) => candidate !== value,
                                        ),
                                  };
                                });
                                setAiCharacterVisibleCount(60);
                              }}
                              type="checkbox"
                            />
                            <span>{value}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>

            {aiCharacterCatalogLoading && visibleAiCharacters.length === 0 ? (
              <p className="ai-character-no-match">正在读取角色…</p>
            ) : aiCharacterCatalogError ? (
              <p className="ai-character-no-match">{aiCharacterCatalogError}</p>
            ) : visibleAiCharacters.length > 0 ? (
              <div
                className="ai-character-grid"
                data-testid="ai-character-grid"
              >
                {visibleAiCharacters.map((character, index) => (
                  <article
                    className="ai-character-card"
                    data-testid="ai-character-card"
                    key={character.id}
                  >
                    <div
                      aria-label={character.name}
                      className="ai-character-portrait"
                      role="img"
                      style={
                        {
                          "--character-accent": character.colors[1],
                          "--character-cloth": character.colors[0],
                          "--character-hair": character.colors[2],
                          "--character-skin":
                            index % 4 === 0
                              ? "#9e674f"
                              : index % 4 === 1
                                ? "#e0b99d"
                                : "#c48b68",
                        } as CSSProperties
                      }
                    >
                      <span className="ai-character-hair" />
                      <span className="ai-character-head" />
                      <span className="ai-character-neck" />
                      <span className="ai-character-body" />
                      <span className="ai-character-sash" />
                      <span className="ai-character-arm ai-character-arm-left" />
                      <span className="ai-character-arm ai-character-arm-right" />
                      <span className="ai-character-leg ai-character-leg-left" />
                      <span className="ai-character-leg ai-character-leg-right" />
                    </div>
                    <div className="ai-character-card-copy">
                      <strong>{character.name}</strong>
                      <p>{character.meta.join(" · ")}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="ai-character-no-match">暂无匹配角色</p>
            )}

            {visibleAiCharacters.length < aiCharacterTotal && (
              <button
                className="ai-characters-load-more"
                onClick={() =>
                  setAiCharacterVisibleCount((count) =>
                    Math.min(aiCharacterTotal, count + 20),
                  )
                }
                type="button"
              >
                加载更多
              </button>
            )}
          </div>
        </section>
      )}

      {templatesOpen && (
        <>
          {templateNoticeOpen && (
            <aside
              aria-label="模板首次提示"
              className="template-first-notice"
              data-testid="template-first-notice"
            >
              <div
                aria-hidden="true"
                className="template-notice-illustration"
              >
                <span className="template-notice-node template-notice-node-a" />
                <span className="template-notice-node template-notice-node-b" />
                <span className="template-notice-node template-notice-node-c" />
                <span className="template-notice-link template-notice-link-a" />
                <span className="template-notice-link template-notice-link-b" />
              </div>
              <div className="template-notice-copy">
                <h2>使用模板加速创作</h2>
                <p>
                  一键使用专业模版，快速构建你的专属场景。
                  <button type="button">了解更多</button>
                </p>
                <div>
                  <button
                    onClick={() => setTemplateNoticeOpen(false)}
                    type="button"
                  >
                    不再提示
                  </button>
                  <button
                    onClick={() => setTemplateNoticeOpen(false)}
                    type="button"
                  >
                    知道了
                  </button>
                </div>
              </div>
            </aside>
          )}

          <aside
            aria-label="工作流模板"
            className="templates-panel"
            data-testid="templates-panel"
            ref={templatesPanel}
          >
            <header className="templates-panel-header">
              <div
                aria-label="模板空间"
                className="templates-tabs"
                data-testid="templates-tabs"
                role="tablist"
              >
                {(["公共模板", "我的模板"] as const).map((tab) => (
                  <button
                    aria-selected={templateTab === tab}
                    key={tab}
                    onClick={() => setTemplateTab(tab)}
                    role="tab"
                    type="button"
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <button
                aria-label="浏览全部"
                className="templates-browse-all"
                onClick={() => setTemplateBrowseAllOpen(true)}
                type="button"
              >
                <LineIcon name="fit" />
              </button>
            </header>
            <label className="templates-search">
              <LineIcon name="search" />
              <span className="sr-only">搜索资产包...</span>
              <input
                aria-label="搜索资产包..."
                data-composition-active={templateSearchControl.composing || undefined}
                onBlur={() => templateSearchControl.blur()}
                onChange={(event) =>
                  templateSearchControl.change(
                    event.target.value,
                    (event.nativeEvent as InputEvent).isComposing,
                  )
                }
                onCompositionEnd={(event) =>
                  templateSearchControl.compositionEnd(event.currentTarget.value)
                }
                onCompositionStart={() => templateSearchControl.compositionStart()}
                onKeyDown={(event) => {
                  templateSearchControl.keyDown(event);
                }}
                placeholder="搜索资产包..."
                spellCheck={false}
                type="search"
                value={templateSearchControl.value}
              />
            </label>
            {templateCatalogLoading && visibleTemplateCards.length === 0 ? (
              <p className="templates-empty">正在读取模板…</p>
            ) : templateCatalogError ? (
              <p className="templates-empty" role="alert">
                {templateCatalogError}
              </p>
            ) : visibleTemplateCards.length > 0 ? (
              <div
                aria-label="模板卡片"
                className="templates-grid"
                data-testid="templates-grid"
              >
                {visibleTemplateCards.slice(0, 10).map((card) => (
                  <article
                    aria-disabled={effectiveCanvasLoadState !== "ready"}
                    className="template-card"
                    key={card.id}
                    onClick={
                      effectiveCanvasLoadState === "ready"
                        ? () => applyTemplate(card)
                        : undefined
                    }
                    role="button"
                    tabIndex={effectiveCanvasLoadState === "ready" ? 0 : -1}
                    onKeyDown={(event) => {
                      if (
                        effectiveCanvasLoadState === "ready" &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        applyTemplate(card);
                      }
                    }}
                  >
                    {templateTab === "我的模板" && (
                      <button
                        aria-label={`删除模板 ${card.title}`}
                        className="template-card-delete"
                        data-testid={`template-delete-${card.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void deleteUserTemplate(card);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        type="button"
                      >
                        ×
                      </button>
                    )}
                    <div
                      aria-label={card.title}
                      className="template-card-art"
                      data-preview={card.previewImage ? true : undefined}
                      role="img"
                    >
                      {card.previewImage
                        ? card.cover?.kind === "video"
                          ? (
                            <video
                              muted
                              playsInline
                              preload="metadata"
                              src={card.previewImage}
                            />
                          )
                          : <img alt="" src={card.previewImage} />
                        : <span />}
                    </div>
                    <p>{card.title}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="templates-empty">
                {templateTab === "我的模板" ? "暂无我的模板" : "暂无匹配模板"}
              </p>
            )}
          </aside>
        </>
      )}

      {templateBrowseAllOpen && (
        <div
          className="template-browser-backdrop"
          data-testid="template-browser-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget !== event.target) return;
            setTemplateBrowseAllOpen(false);
            window.requestAnimationFrame(() => {
              templatesPanel.current
                ?.querySelector<HTMLButtonElement>(
                  'button[aria-label="浏览全部"]',
                )
                ?.focus();
            });
          }}
        >
          <section
            aria-label="全部模板"
            aria-modal="true"
            className="template-browser"
            data-testid="template-browser"
            role="dialog"
          >
            <aside className="template-browser-sidebar">
              <h2>模板</h2>
              <nav aria-label="模板分类">
                {templateBrowseCategories.map((category) => (
                  <button
                    aria-current={
                      templateBrowseCategory === category || undefined
                    }
                    key={category}
                    onClick={() => setTemplateBrowseCategory(category)}
                    type="button"
                  >
                    {category}
                    {category === "全部" && <span>⌄</span>}
                  </button>
                ))}
              </nav>
              {canManagePublicTemplates && (
                <button
                  className="template-browser-admin-entry"
                  data-testid="admin-templates-entry"
                  onClick={() => {
                    window.location.href = "/admin/templates";
                  }}
                  type="button"
                >
                  管理公共模板
                </button>
              )}
            </aside>
            <div className="template-browser-main">
              <header>
                <h2>
                  {templateBrowseCategory === "最近使用" ||
                  templateBrowseCategory === "我的模板"
                    ? templateBrowseCategory
                    : "全部"}
                </h2>
                <button
                  aria-label="关闭全部模板"
                  onClick={() => {
                    setTemplateBrowseAllOpen(false);
                    window.requestAnimationFrame(() => {
                      templatesPanel.current
                        ?.querySelector<HTMLButtonElement>(
                          'button[aria-label="浏览全部"]',
                        )
                        ?.focus();
                    });
                  }}
                  type="button"
                >
                  ×
                </button>
              </header>
              <div className="template-browser-toolbar">
                <label>
                  <LineIcon name="search" />
                  <span className="sr-only">搜索场景、平台或模型</span>
                  <input
                    aria-label="搜索场景、平台或模型"
                    data-composition-active={templateSearchControl.composing || undefined}
                    onBlur={() => templateSearchControl.blur()}
                    onChange={(event) =>
                      templateSearchControl.change(
                        event.target.value,
                        (event.nativeEvent as InputEvent).isComposing,
                      )
                    }
                    onCompositionEnd={(event) =>
                      templateSearchControl.compositionEnd(event.currentTarget.value)
                    }
                    onCompositionStart={() => templateSearchControl.compositionStart()}
                    onKeyDown={(event) => {
                      templateSearchControl.keyDown(event);
                    }}
                    placeholder="搜索 场景/平台/模型..."
                    spellCheck={false}
                    type="search"
                    value={templateSearchControl.value}
                  />
                </label>
                <button disabled type="button">
                  创建
                </button>
              </div>
              {templateCatalogLoading && visibleTemplateCards.length === 0 ? (
                <p className="template-browser-empty">正在读取模板…</p>
              ) : templateCatalogError ? (
                <p className="template-browser-empty" role="alert">
                  {templateCatalogError}
                </p>
              ) : visibleTemplateCards.length > 0 ? (
                <div
                  aria-label="全部模板卡片"
                  className="template-browser-grid"
                >
                  {visibleTemplateCards.map((card) => (
                    <article
                      aria-disabled={effectiveCanvasLoadState !== "ready"}
                      className="template-browser-card"
                      key={card.id}
                      onClick={
                        effectiveCanvasLoadState === "ready"
                          ? () => applyTemplate(card)
                          : undefined
                      }
                      role="button"
                      tabIndex={effectiveCanvasLoadState === "ready" ? 0 : -1}
                      onKeyDown={(event) => {
                        if (
                          effectiveCanvasLoadState === "ready" &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          applyTemplate(card);
                        }
                      }}
                  >
                    {templateTab === "我的模板" && (
                      <button
                        aria-label={`删除模板 ${card.title}`}
                        className="template-card-delete"
                        data-testid={`template-browser-delete-${card.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void deleteUserTemplate(card);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                        type="button"
                      >
                        ×
                      </button>
                    )}
                    <div
                      aria-label={card.title}
                      className="template-card-art"
                      data-preview={card.previewImage ? true : undefined}
                      role="img"
                    >
                      {card.previewImage
                        ? card.cover?.kind === "video"
                          ? (
                            <video
                              muted
                              playsInline
                              preload="metadata"
                              src={card.previewImage}
                            />
                          )
                          : <img alt="" src={card.previewImage} />
                        : <span />}
                    </div>
                      <p>{card.title}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="template-browser-empty">暂无模板</p>
              )}
            </div>
          </section>
        </div>
      )}

      {tasksOpen && (
        <GenerationTasksPanel
          canvasId={projectId ?? fixtureId ?? "default"}
          canvasScopeId={canvasScopeId}
          key={canvasScopeId}
          open={tasksOpen}
          panelRef={tasksPanel}
          retryEnabled={
            !fixtureId &&
            effectiveCanvasLoadState === "ready" &&
            !saveConflict &&
            generationRetryGate?.scopeId === canvasScopeId
          }
          waitForCanvasRevision={generationRetryGate?.run}
        />
      )}

      {historyOpen && (
        <>
          <section
            aria-label="历史素材"
            className="history-panel"
            data-testid="history-panel"
            ref={historyPanel}
          >
            <div className="history-tabs" role="tablist">
              {historyTabs.map(([kind, label]) => (
                <button
                  aria-selected={historyTab === kind}
                  className="history-tab"
                  data-testid={`history-tab-${kind}`}
                  key={kind}
                  onClick={() => setHistoryTab(kind)}
                  role="tab"
                  type="button"
                >
                  {label}
                  <span aria-hidden="true">(</span>
                  <span data-testid={`history-count-${kind}`}>
                    {historyCounts[kind]}
                  </span>
                  <span aria-hidden="true">)</span>
                </button>
              ))}
            </div>
            <button
              aria-label="浏览全部历史"
              className="history-expand"
              onClick={() => setHistoryExpanded(true)}
              type="button"
            >
              <LineIcon name="fit" />
            </button>
            <div className="history-divider" />
            <div className="history-grid" data-testid="history-grid">
              {historyDates.map((date) => (
                <section className="history-date-group" key={date}>
                  <h3>{date}</h3>
                  <div>
                    {filteredHistoryItems
                      .filter((item) => historyItemDate(item) === date)
                      .map((item, index) => (
                        <button
                          aria-label={item.label}
                          className="history-card"
                          data-history-id={item.id}
                          data-preview={item.preview}
                          key={`${item.kind}:${item.id}:${item.createdAt ?? item.preview}:${index}`}
                          onClick={() => setHistoryPreviewItem(item)}
                          type="button"
                        >
                          <HistoryCardMedia item={item} />
                          <span className="sr-only">{item.label}</span>
                        </button>
                      ))}
                  </div>
                </section>
              ))}
              {filteredHistoryItems.length === 0 && (
                !historyLoading && !historyError && (
                  <p className="history-empty">暂无历史素材</p>
                )
              )}
              {!historyExpanded && historyLoading && historyItems.length === 0 && (
                <p className="history-empty" role="status">正在读取历史素材…</p>
              )}
              {!historyExpanded && historyError && (
                <div className="history-pagination">
                  <p role="alert">{historyError}</p>
                  <button
                    onClick={() => setHistoryRefreshEpoch((epoch) => epoch + 1)}
                    type="button"
                  >
                    重新读取
                  </button>
                </div>
              )}
              {!historyExpanded && historyNextCursor && !historyError && (
                <div className="history-pagination">
                  <button
                    data-testid="history-load-more"
                    disabled={historyLoading}
                    onClick={() => void loadMoreHistory()}
                    type="button"
                  >
                    {historyLoading ? "正在加载…" : "加载更多历史素材"}
                  </button>
                </div>
              )}
            </div>
          </section>

          {historyExpanded && (
            <div
              className="history-browser-backdrop"
              onMouseDown={(event) => {
                if (event.currentTarget !== event.target) return;
                setHistoryExpanded(false);
                window.requestAnimationFrame(() => {
                  historyPanel.current
                    ?.querySelector<HTMLButtonElement>(
                      'button[aria-label="浏览全部历史"]',
                    )
                    ?.focus();
                });
              }}
            >
              <section
                aria-label="全部历史素材"
                aria-modal="true"
                className="history-browser"
                data-testid="history-browser"
                role="dialog"
              >
                <aside className="history-browser-sidebar">
                  <h2>我的</h2>
                  <nav aria-label="历史素材类型">
                    {historyTabs.map(([kind, label, icon]) => (
                      <button
                        aria-current={historyTab === kind || undefined}
                        key={kind}
                        onClick={() => setHistoryTab(kind)}
                        type="button"
                      >
                        <LineIcon name={icon} />
                        <span>{label}</span>
                        <small>
                          {historyCounts[kind]}
                        </small>
                      </button>
                    ))}
                  </nav>
                </aside>
                <div className="history-browser-main">
                  <header>
                    <h2>
                      <LineIcon
                        name={
                          historyTabs.find(([kind]) => kind === historyTab)?.[2] ??
                          "image"
                        }
                      />
                      {
                        historyTabs.find(([kind]) => kind === historyTab)?.[1]
                      }
                    </h2>
                    <div className="history-browser-controls">
                      <button
                        aria-label="缩小历史缩略图"
                        onClick={() =>
                          setHistoryZoom((zoom) => Math.max(80, zoom - 10))
                        }
                        type="button"
                      >
                        −
                      </button>
                      <input
                        aria-label="历史缩略图大小"
                        max="175"
                        min="80"
                        onChange={(event) =>
                          setHistoryZoom(Number(event.target.value))
                        }
                        type="range"
                        value={historyZoom}
                      />
                      <button
                        aria-label="放大历史缩略图"
                        onClick={() =>
                          setHistoryZoom((zoom) => Math.min(175, zoom + 10))
                        }
                        type="button"
                      >
                        +
                      </button>
                      <button
                        aria-label={
                          historyNewestFirst
                            ? "当前最新在前，点击改为最早在前"
                            : "当前最早在前，点击改为最新在前"
                        }
                        className="history-sort"
                        onClick={() =>
                          setHistoryNewestFirst((newestFirst) => !newestFirst)
                        }
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M7 4v16m0 0-4-4m4 4 4-4M17 20V4m0 0-4 4m4-4 4 4" />
                        </svg>
                      </button>
                      <button
                        aria-label="关闭全部历史"
                        className="history-browser-close"
                        onClick={() => {
                          setHistoryExpanded(false);
                          window.requestAnimationFrame(() => {
                            historyPanel.current
                              ?.querySelector<HTMLButtonElement>(
                                'button[aria-label="浏览全部历史"]',
                              )
                              ?.focus();
                          });
                        }}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  </header>
                  <div
                    className="history-browser-content"
                    data-testid="history-browser-content"
                    style={
                      {
                        "--history-card-size": `${historyZoom}px`,
                      } as CSSProperties
                    }
                  >
                    {historyDates.map((date) => (
                      <section className="history-browser-date-group" key={date}>
                        <h3>{date}</h3>
                        <div>
                          {filteredHistoryItems
                            .filter((item) => historyItemDate(item) === date)
                            .map((item, index) => (
                              <button
                                aria-label={item.label}
                                className="history-card"
                                data-history-id={item.id}
                                data-preview={item.preview}
                                key={`${item.kind}:${item.id}:${item.createdAt ?? item.preview}:${index}`}
                                onClick={() => setHistoryPreviewItem(item)}
                                type="button"
                              >
                                <HistoryCardMedia item={item} />
                                <span className="sr-only">{item.label}</span>
                              </button>
                            ))}
                        </div>
                      </section>
                    ))}
                    {filteredHistoryItems.length === 0 && (
                      !historyLoading && !historyError && (
                        <p className="history-empty">暂无历史素材</p>
                      )
                    )}
                    {historyLoading && historyItems.length === 0 && (
                      <p className="history-empty" role="status">
                        正在读取历史素材…
                      </p>
                    )}
                    {historyError && (
                      <div className="history-pagination">
                        <p role="alert">{historyError}</p>
                        <button
                          onClick={() =>
                            setHistoryRefreshEpoch((epoch) => epoch + 1)}
                          type="button"
                        >
                          重新读取
                        </button>
                      </div>
                    )}
                    {historyNextCursor && !historyError && (
                      <div className="history-pagination">
                        <button
                          data-testid="history-browser-load-more"
                          disabled={historyLoading}
                          onClick={() => void loadMoreHistory()}
                          type="button"
                        >
                          {historyLoading ? "正在加载…" : "加载更多历史素材"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {historyPreviewItem && (
            <div
              className="history-preview-backdrop"
              data-testid="history-preview-backdrop"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) closeHistoryPreview();
              }}
            >
              <section
                aria-label={`${historyPreviewItem.label}预览`}
                aria-modal="true"
                className="history-preview"
                data-kind={historyPreviewItem.kind}
                data-testid="history-preview"
                role="dialog"
              >
                <header>
                  <div>
                    <strong>{historyPreviewItem.label}</strong>
                    <span>
                      {historyPreviewItem.kind === "image"
                        ? "图片"
                        : historyPreviewItem.kind === "video"
                          ? "视频"
                          : historyPreviewItem.kind === "audio"
                            ? "音频"
                            : "3D"}
                    </span>
                  </div>
                  <button
                    aria-label="关闭历史素材预览"
                    onClick={closeHistoryPreview}
                    type="button"
                  >
                    ×
                  </button>
                </header>
                <div className="history-preview-media" data-testid="history-preview-media">
                  {historyPreviewUrl && historyPreviewItem.kind === "image" && (
                    <img alt={historyPreviewItem.label} src={historyPreviewUrl} />
                  )}
                  {historyPreviewUrl && historyPreviewItem.kind === "video" && (
                    <video controls playsInline preload="metadata" src={historyPreviewUrl} />
                  )}
                  {historyPreviewUrl && historyPreviewItem.kind === "audio" && (
                    <div className="history-preview-audio">
                      <LineIcon name="music" />
                      <audio controls preload="metadata" src={historyPreviewUrl} />
                    </div>
                  )}
                  {!historyPreviewUrl && (
                    <div className="history-preview-unavailable">
                      <LineIcon
                        name={
                          historyPreviewItem.kind === "audio"
                            ? "music"
                            : historyPreviewItem.kind === "world3d"
                              ? "world"
                              : historyPreviewItem.kind
                        }
                      />
                      <strong>旧验收占位素材没有原文件</strong>
                      <span>可以查看记录，但不能预览、下载或添加到画布。</span>
                    </div>
                  )}
                </div>
                <footer>
                  <button
                    disabled={
                      effectiveCanvasLoadState !== "ready" ||
                      !historyPreviewUrl ||
                      historyPreviewItem.kind === "world3d"
                    }
                    onClick={addHistoryPreviewToCanvas}
                    type="button"
                  >
                    添加到画布
                  </button>
                  <button
                    disabled={!historyPreviewUrl}
                    onClick={downloadHistoryPreview}
                    type="button"
                  >
                    下载
                  </button>
                </footer>
              </section>
            </div>
          )}
        </>
      )}

      {effectiveCanvasLoadState === "ready" && !graphHasContent && !textVideoStarted && (
        <section
          aria-label="快捷创作"
          className="empty-quick-actions"
          data-testid="empty-quick-actions"
        >
          <div className="quick-action-badge" data-testid="quick-action-badge">
            <DoubleClickIcon />
            双击
          </div>
          <p>画布自由生成,或查看模板</p>
          <div className="quick-action-row">
            {quickActions.map(([label, testId, icon]) => (
              <ShellButton
                className={`quick-action ${testId}`}
                key={testId}
                label={label}
                onClick={
                  testId === "quick-text-video"
                    ? () => setTextVideoStarted(true)
                    : testId === "quick-template"
                      ? () => {
                          closePrimarySurfaces();
                          setTemplatesOpen(true);
                        }
                    : undefined
                }
                testId={testId}
              >
                <LineIcon name={icon} />
                <span>{label}</span>
              </ShellButton>
            ))}
          </div>
        </section>
      )}

      <nav
        aria-label="画布视图控制"
        className="bottom-controls"
        data-testid="bottom-controls"
      >
        <ShellButton
          label="小地图"
          testId="minimap-toggle"
          className="control minimap"
          active={minimapOpen}
          disabled={effectiveCanvasLoadState !== "ready"}
          onClick={() => setMinimapOpen((open) => !open)}
        >
          <LineIcon className="control-default-icon" name="minimap" />
          <FilledControlIcon name="minimap" />
        </ShellButton>
        <ShellButton
          label="吸附网格"
          testId="snap-toggle"
          className="control snap"
          active={snapEnabled}
          disabled={effectiveCanvasLoadState !== "ready"}
          onClick={() => setSnapEnabled((active) => !active)}
        >
          <LineIcon className="control-default-icon" name="snap" />
          <FilledControlIcon name="snap" />
        </ShellButton>
        <ShellButton
          label="适应视图"
          testId="fit-view"
          className="control fit"
          disabled={effectiveCanvasLoadState !== "ready"}
          onClick={() =>
            hasProbeNodes
              ? fitWorld?.()
              : setViewportRequest({
                  sequence: ++zoomRequestSequence.current,
                  x: 0,
                  y: 0,
                  zoom: 1,
                })
          }
        >
          <LineIcon className="control-default-icon" name="fit" />
          <FilledControlIcon name="fit" />
        </ShellButton>
        <div className="zoom-track" data-testid="zoom-track">
          <span
            className="zoom-track-fill"
            style={{ width: `${zoomRatio * 100}%` }}
          />
          <span
            className="zoom-thumb"
            data-testid="zoom-thumb"
            style={{ left: `${zoomRatio * 61}px` }}
          />
          <input
            aria-label="画布缩放"
            data-testid="zoom-slider"
            disabled={effectiveCanvasLoadState !== "ready"}
            max="2"
            min="0.15"
            onChange={(event) =>
              setViewportRequest({
                sequence: ++zoomRequestSequence.current,
                zoom: Number(event.target.value),
              })
            }
            step="0.01"
            type="range"
            value={zoomSummary}
          />
        </div>
      </nav>

      <ShellButton
        active={helpMenuOpen || keyboardShortcutsOpen}
        label="帮助"
        testId="help"
        className="help"
        onClick={() => {
          if (keyboardShortcutsOpen) {
            setKeyboardShortcutsOpen(false);
            return;
          }
          togglePrimarySurface("help", helpMenuOpen);
        }}
      >
        <LineIcon name="help" />
      </ShellButton>
      {helpMenuOpen && (
        <menu
          aria-label="帮助菜单"
          className="help-menu"
          data-testid="help-menu"
          ref={helpMenu}
        >
          <button disabled title="暂未开放" type="button">
            使用教程
          </button>
          <button disabled title="暂未开放" type="button">
            反馈问题
          </button>
          <button
            onClick={() => {
              setHelpMenuOpen(false);
              setKeyboardShortcutsOpen(true);
            }}
            type="button"
          >
            快捷键
          </button>
        </menu>
      )}
      {keyboardShortcutsOpen && (
        <section
          aria-label="键盘快捷键"
          className="keyboard-shortcuts-panel"
          data-testid="keyboard-shortcuts-panel"
          style={{
            left: agentOpen ? "calc((100% - 480px) / 2)" : "50%",
          }}
        >
          <div className="keyboard-shortcuts-column">
            <div className="shortcut-group">
              <h2>基础</h2>
              {[
                ["删除", ["⌫"]],
                ["撤销", ["⌘", "Z"]],
                ["重做", ["⇧", "⌘", "Z"]],
                ["复制", ["⌘", "C"]],
                ["粘贴", ["⌘", "V"]],
                ["Search nodes", ["⌘", "F"]],
                ["多选", ["⇧"]],
              ].map(([label, keys]) => (
                <div
                  className="shortcut-row"
                  data-shortcut-label={label as string}
                  key={label as string}
                >
                  <span>{label}</span>
                  <ShortcutKeys keys={keys as string[]} />
                </div>
              ))}
            </div>
            <div className="shortcut-group">
              <h2>缩放</h2>
              {[
                ["放大", ["⌘", "+"]],
                ["缩小", ["⌘", "-"]],
              ].map(([label, keys]) => (
                <div
                  className="shortcut-row"
                  data-shortcut-label={label as string}
                  key={label as string}
                >
                  <span>{label}</span>
                  <ShortcutKeys keys={keys as string[]} />
                </div>
              ))}
              <div className="shortcut-row" data-shortcut-label="键盘缩放">
                <span>键盘</span>
                <ShortcutKeys keys={["⌘"]} />
              </div>
              <div className="shortcut-row" data-shortcut-label="触控板缩放">
                <span>触控板</span>
                <span aria-label="触控板缩放手势" className="gesture-icon">
                  ⇳
                </span>
              </div>
            </div>
          </div>
          <div className="keyboard-shortcuts-column">
            <div className="shortcut-group">
              <h2>移动画布</h2>
              <div className="shortcut-row" data-shortcut-label="键盘移动画布">
                <span>键盘</span>
                <ShortcutKeys keys={["⌘", "Space"]} />
              </div>
              <div className="shortcut-row" data-shortcut-label="触控板移动画布">
                <span>触控板</span>
                <span aria-label="触控板双指手势" className="gesture-icon">
                  ⌁
                </span>
              </div>
            </div>
            <div className="shortcut-group">
              <h2>时间轴</h2>
              {[
                ["切割", ["C"]],
                ["向左裁切", ["Q"]],
                ["向右裁切", ["E"]],
              ].map(([label, keys]) => (
                <div
                  className="shortcut-row"
                  data-shortcut-label={label as string}
                  key={label as string}
                >
                  <span>{label}</span>
                  <ShortcutKeys keys={keys as string[]} />
                </div>
              ))}
            </div>
            <div className="shortcut-group">
              <h2>其他</h2>
              {[
                ["打开/关闭Agent", ["⌘", "J"]],
                ["焦点编辑", ["⌘", "I"]],
                ["语音输入", ["长按", "V"]],
                ["完成语音输入", ["V"]],
              ].map(([label, keys]) => (
                <div
                  className="shortcut-row"
                  data-shortcut-label={label as string}
                  key={label as string}
                >
                  <span>{label}</span>
                  <ShortcutKeys keys={keys as string[]} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {agentOpen && (
        <aside
          aria-label="Agent"
          className="agent-panel"
          data-testid="agent-panel"
        >
          <header className="agent-panel-header">
            <button aria-label="对话列表" type="button">
              ☷
            </button>
            <strong>新建对话</strong>
            <button
              aria-expanded={agentFilesOpen}
              aria-label="文件"
              className="agent-files-toggle"
              onClick={() => setAgentFilesOpen((open) => !open)}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M3.5 5.5h5l1.5 2h6.5v8h-13Z" />
              </svg>
            </button>
            <button
              aria-label="关闭 Agent"
              onClick={() => {
                clearAgentVoice();
                setAgentFilesOpen(false);
                setAgentMenu(undefined);
                setAgentReferenceMode(false);
                setAgentOpen(false);
              }}
              type="button"
            >
              ↗
            </button>
          </header>

          <section className="agent-welcome">
            <span aria-hidden="true" className="agent-welcome-orb" />
            <h2>Hi mymy!</h2>
            <p>今天一起创作点什么？</p>
          </section>

          <section
            aria-label="头脑风暴建议"
            className="agent-suggestions"
          >
            {agentConfiguration?.suggestions.map((suggestion, index) => (
              <button
                data-testid={`agent-suggestion-${index === 0 ? "a" : index === 1 ? "b" : suggestion.id}`}
                key={suggestion.id}
                type="button"
              >
                <span>{suggestion.icon} {suggestion.category}</span>
                <strong>{suggestion.title}</strong>
                <small>{suggestion.description}</small>
              </button>
            ))}
            {agentConfigurationError && (
              <p className="agent-config-error" role="alert">
                {agentConfigurationError}
              </p>
            )}
          </section>

          <section
            className="agent-composer"
            data-has-reference={agentReferences.length ? "true" : undefined}
          >
            {agentReferences.length > 0 && (
              <div
                aria-label="已引用画布内容"
                className="agent-reference-list"
                data-testid="agent-reference-list"
              >
                {agentReferences.map((reference) => (
                  <button
                    aria-label={`移除引用 ${reference.title}`}
                    className="agent-reference-chip"
                    key={reference.id}
                    onClick={() =>
                      setAgentReferences((current) =>
                        current.filter((item) => item.id !== reference.id),
                      )
                    }
                    title={`${reference.title} · 点击移除`}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      style={
                        reference.thumbnail
                          ? { backgroundImage: `url("${reference.thumbnail}")` }
                          : undefined
                      }
                    />
                  </button>
                ))}
              </div>
            )}
            <textarea
              aria-label="Agent 输入"
              data-composition-active={agentPromptControl.composing || undefined}
              data-testid="agent-prompt"
              onBlur={() => agentPromptControl.blur()}
              onChange={(event) =>
                agentPromptControl.change(
                  event.target.value,
                  (event.nativeEvent as InputEvent).isComposing,
                )
              }
              onCompositionEnd={(event) =>
                agentPromptControl.compositionEnd(event.currentTarget.value)
              }
              onCompositionStart={() => agentPromptControl.compositionStart()}
              onKeyDown={(event) => {
                agentPromptControl.keyDown(event);
              }}
              placeholder="描述创意或需求，/ 使用技能，@ 引用画布"
              value={agentPromptControl.value}
            />
            {agentVoiceState !== "idle" && (
              <div
                aria-live="polite"
                className="agent-voice-panel"
                data-state={agentVoiceState}
                data-testid="agent-voice-panel"
              >
                {agentVoiceState === "requesting" && (
                  <span>正在请求麦克风权限…</span>
                )}
                {agentVoiceState === "recording" && (
                  <>
                    <span className="agent-voice-recording-dot" />
                    <strong>
                      正在录音{" "}
                      {String(Math.floor(agentVoiceSeconds / 60)).padStart(
                        2,
                        "0",
                      )}
                      :
                      {String(agentVoiceSeconds % 60).padStart(2, "0")}
                    </strong>
                    <button
                      className="agent-voice-cancel"
                      onClick={clearAgentVoice}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="agent-voice-stop"
                      onClick={finishAgentVoice}
                      type="button"
                    >
                      <span aria-hidden="true" />
                      停止
                    </button>
                  </>
                )}
                {agentVoiceState === "recorded" && agentVoiceUrl && (
                  <>
                    <div>
                      <strong>录音已完成</strong>
                      <small>仅在当前页面暂存 · 转写暂未接入</small>
                    </div>
                    <audio
                      aria-label="录音预览"
                      controls
                      data-testid="agent-voice-preview"
                      src={agentVoiceUrl}
                    />
                    <button
                      className="agent-voice-clear"
                      onClick={clearAgentVoice}
                      type="button"
                    >
                      清除
                    </button>
                  </>
                )}
                {agentVoiceState === "denied" && (
                  <>
                    <div>
                      <strong>未获得麦克风权限</strong>
                      <small>请在浏览器中允许后重试</small>
                    </div>
                    <button
                      className="agent-voice-retry"
                      onClick={startAgentVoice}
                      type="button"
                    >
                      重试
                    </button>
                  </>
                )}
                {agentVoiceState === "unsupported" && (
                  <span>当前浏览器不支持本机录音</span>
                )}
                {agentVoiceState === "error" && (
                  <>
                    <div>
                      <strong>录音没有完成</strong>
                      <small>没有上传或保留不完整录音</small>
                    </div>
                    <button
                      className="agent-voice-retry"
                      onClick={startAgentVoice}
                      type="button"
                    >
                      重试
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              aria-label="添加内容"
              aria-expanded={agentMenu === "add"}
              className="agent-add"
              data-testid="agent-add"
              onClick={() =>
                setAgentMenu((current) =>
                  current === "add" ? undefined : "add",
                )
              }
              type="button"
            >
              +
            </button>
            <button
              aria-expanded={agentMenu === "confirmation"}
              className="agent-confirmation"
              data-testid="agent-confirmation-mode"
              onClick={() =>
                setAgentMenu((current) =>
                  current === "confirmation" ? undefined : "confirmation",
                )
              }
              type="button"
            >
              <AgentModeIcon mode={agentConfirmation} />
              <span>{agentConfirmation}</span>
            </button>
            <button
              aria-expanded={agentMenu === "model"}
              className="agent-model"
              data-testid="agent-model"
              onClick={() =>
                setAgentMenu((current) =>
                  current === "model" ? undefined : "model",
                )
              }
              type="button"
            >
              {agentModel}
            </button>
            <button
              aria-label={
                agentVoiceState === "recording" ? "停止录音" : "语音输入"
              }
              aria-pressed={agentVoiceState === "recording"}
              className="agent-voice"
              data-testid="agent-voice"
              disabled={agentVoiceState === "requesting"}
              onClick={startAgentVoice}
              type="button"
            >
              {agentVoiceState === "recording" ? (
                <span className="agent-voice-stop-icon" />
              ) : (
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <rect height="7.8" rx="3" width="4.4" x="5.8" y="1.4" />
                  <path d="M3.8 7.2v.9a4.2 4.2 0 0 0 8.4 0v-.9M8 12.3v2.1M5.8 14.4h4.4" />
                </svg>
              )}
            </button>
            <button
              aria-label="发送"
              className="agent-send"
              data-testid="agent-send"
              disabled
              type="button"
            >
              ↑
            </button>

            {agentMenu === "add" && (
              <div
                aria-label="添加"
                className="agent-popover agent-add-menu"
                data-testid="agent-add-menu"
                role="menu"
              >
                {agentAddItems.map(([label, icon], index) => (
                  <button
                    className={
                      index === 2 || index === 3
                        ? "agent-menu-separated"
                        : undefined
                    }
                    key={label}
                    onClick={() => {
                      if (label === "从画布添加") {
                        setAgentReferenceMode(true);
                        setAgentMenu(undefined);
                      } else if (label === "技能") {
                        setAgentMenu("skills");
                      } else {
                        setAgentMenu(undefined);
                      }
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span aria-hidden="true">{icon}</span>
                    {label}
                    {(label === "技能" || label === "全部插件") && (
                      <small aria-hidden="true">›</small>
                    )}
                  </button>
                ))}
              </div>
            )}

            {agentMenu === "skills" && (
              <div
                aria-label="技能"
                className="agent-popover agent-skills-menu"
                data-testid="agent-skills-menu"
                role="menu"
              >
                {agentConfiguration?.skills.map((skill) => (
                  <button
                    disabled={!skill.enabled}
                    key={skill.id}
                    role="menuitem"
                    title={skill.description}
                    type="button"
                  >
                    <span aria-hidden="true">♧</span>
                    <strong>{skill.label}</strong>
                    <small>{skill.enabled ? "可用" : "暂停"}</small>
                  </button>
                ))}
              </div>
            )}

            {agentMenu === "confirmation" && (
              <div
                aria-label="确认模式"
                className="agent-popover agent-confirmation-menu"
                data-testid="agent-confirmation-menu"
                role="menu"
              >
                {[
                  [
                    "手动确认",
                    "Agent在执行生成前都会寻求您的确认",
                  ],
                  [
                    "自动生成",
                    "Agent会自主规划生成任务并自动执行",
                  ],
                ].map(([label, description]) => (
                  <button
                    aria-checked={agentConfirmation === label}
                    key={label}
                    onClick={() => {
                      setAgentConfirmation(
                        label as "手动确认" | "自动生成",
                      );
                      setAgentMenu(undefined);
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span aria-hidden="true">
                      <AgentModeIcon
                        mode={label as "手动确认" | "自动生成"}
                      />
                    </span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                    {agentConfirmation === label && (
                      <b aria-hidden="true">✓</b>
                    )}
                  </button>
                ))}
              </div>
            )}

            {agentMenu === "model" && (
              <div
                aria-label="模型"
                className="agent-popover agent-model-menu"
                data-testid="agent-model-menu"
                role="menu"
              >
                {agentModels.map(({ id, label, status }) => (
                  <button
                    aria-checked={agentModel === label}
                    disabled={status === "locked"}
                    key={id}
                    onClick={() => {
                      setAgentModel(label);
                      setAgentMenu(undefined);
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span aria-hidden="true">✣</span>
                    <strong>{label}</strong>
                    {status === "locked" && <small>订阅解锁</small>}
                    {agentModel === label && <b aria-hidden="true">✓</b>}
                  </button>
                ))}
                {agentModels.length === 0 && (
                  <p className="agent-model-empty">暂无可用文字模型</p>
                )}
              </div>
            )}
          </section>
        </aside>
      )}

      {!agentOpen && (
        <ShellButton
          label="Agent"
          testId="agent-bubble"
          className="agent-bubble"
          onClick={() => togglePrimarySurface("agent", agentOpen)}
        >
          <span aria-hidden="true" className="agent-orb" />
        </ShellButton>
      )}
    </main>
  );
}
