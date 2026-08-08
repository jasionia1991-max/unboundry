import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GrayMenuSelect } from "../ui/GrayMenuSelect";
import { InlineOptionGroup } from "../ui/InlineOptionGroup";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { clearProjectLocalKeys } from "./projectStorage";

type ProjectCover = {
  assetId: string | null;
  kind: "image" | "video" | null;
};

type ProjectSummary = {
  cover: ProjectCover;
  createdAt: number | null;
  id: string;
  title: string;
  updatedAt: number;
};

type SortValue =
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc";

const sortOptions = [
  { label: "按最近修改 · 最新优先", value: "updated-desc" },
  { label: "按最近修改 · 最早优先", value: "updated-asc" },
  { label: "按创建时间 · 最新优先", value: "created-desc" },
  { label: "按创建时间 · 最早优先", value: "created-asc" },
] as const;

function relativeTime(timestamp: number) {
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function dateTime(timestamp: number | null) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function WorkspacePage({ userId = "" }: { userId?: string }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortValue>("updated-desc");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [renamingId, setRenamingId] = useState<string>();
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<ProjectSummary>();
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string>();
  const renameInputRef = useRef<HTMLInputElement>(null);
  const selectMode = selectedIds.size > 0;
  const fromProject = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("from")?.trim() || "",
    [],
  );

  const rememberLastProject = (id: string) => {
    try {
      sessionStorage.setItem(`unboundry:last-project:${userId}`, id);
    } catch {
      // 隐私模式等场景忽略。
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`项目列表读取失败：${response.status}`);
      const body = (await response.json()) as { projects: ProjectSummary[] };
      setProjects(body.projects);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目列表读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (!selectMode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIds(new Set());
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectMode]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const sorted = [...projects].filter((project) =>
      query ? project.title.toLocaleLowerCase().includes(query) : true,
    );
    const [key, direction] = sort.split("-") as [
      "created" | "updated",
      "asc" | "desc",
    ];
    sorted.sort((left, right) => {
      const a = key === "updated" ? left.updatedAt : (left.createdAt ?? 0);
      const b = key === "updated" ? right.updatedAt : (right.createdAt ?? 0);
      return direction === "desc" ? b - a : a - b;
    });
    return sorted;
  }, [projects, search, sort]);

  const createProject = async () => {
    const response = await fetch("/api/projects", {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error("新建项目失败");
    const created = (await response.json()) as { id: string };
    window.location.href = `/canvas/${created.id}`;
  };

  const startRename = (project: ProjectSummary) => {
    setMenuFor(undefined);
    setRenamingId(project.id);
    setRenameDraft(project.title);
  };

  const commitRename = async (project: ProjectSummary) => {
    const title = renameDraft.trim();
    setRenamingId(undefined);
    if (!title || title === project.title) return;
    const response = await fetch(
      `/api/project-title/${encodeURIComponent(project.id)}`,
      {
        body: JSON.stringify({ title, updatedAt: Date.now() }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      },
    );
    if (response.ok) await load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(undefined);
    const response = await fetch(
      `/api/projects/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setError("删除项目失败，请稍后再试");
      return;
    }
    clearProjectLocalKeys(id, userId);
    await load();
  };

  const openProject = (id: string) => {
    rememberLastProject(id);
    window.location.href = `/canvas/${id}`;
  };

  const backToCanvas = async () => {
    const candidates = fromProject ? [fromProject] : [];
    try {
      const last = sessionStorage.getItem(`unboundry:last-project:${userId}`);
      if (last && !candidates.includes(last)) candidates.push(last);
    } catch {
      // 无本标签页记录时直接回落默认画布。
    }
    if (candidates.length > 0) {
      try {
        const response = await fetch("/api/projects", {
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          const body = (await response.json()) as {
            projects: Array<{ id: string }>;
          };
          const alive = new Set(body.projects.map((project) => project.id));
          for (const id of candidates) {
            if (alive.has(id)) {
              window.location.href = `/canvas/${encodeURIComponent(id)}`;
              return;
            }
          }
        }
      } catch {
        // 列表读取失败时直接尝试第一个候选，项目缺失由画布页处理。
        if (candidates[0]) {
          window.location.href = `/canvas/${encodeURIComponent(candidates[0])}`;
          return;
        }
      }
    }
    window.location.href = "/canvas";
  };

  const cloneProject = async (project: ProjectSummary) => {
    setMenuFor(undefined);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/clone`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("克隆项目失败");
      await load();
    } catch {
      setError("克隆项目失败，请稍后再试");
    }
  };

  const selectProject = (id: string) => {
    if (id === "default") return;
    setSelectedIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const toggleSelection = (id: string) => {
    if (id === "default") return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const confirmDeleteSelected = async () => {
    const ids = [...selectedIds].filter((id) => id !== "default");
    setDeletingSelected(false);
    let failed = false;
    for (const id of ids) {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        failed = true;
        break;
      }
      clearProjectLocalKeys(id, userId);
    }
    if (failed) setError("部分项目删除失败，请刷新后再试");
    setSelectedIds(new Set());
    await load();
  };

  const renderSelectCheck = (project: ProjectSummary) => {
    if (!selectMode) return null;
    const selected = selectedIds.has(project.id);
    return (
      <button
        aria-label={`选择项目 ${project.title}`}
        aria-pressed={selected}
        className="workspace-select-check"
        data-checked={selected ? "true" : "false"}
        data-testid={`workspace-select-${project.id}`}
        disabled={project.id === "default"}
        onClick={(event) => {
          event.stopPropagation();
          toggleSelection(project.id);
        }}
        title={project.id === "default" ? "默认项目不能删除" : undefined}
        type="button"
      >
        <span aria-hidden="true">✓</span>
      </button>
    );
  };

  const renderRenameOrTitle = (project: ProjectSummary) => {
    if (renamingId === project.id) {
      return (
        <input
          aria-label="重命名项目"
          className="workspace-inline-rename"
          data-testid="workspace-rename-input"
          maxLength={120}
          onBlur={() => void commitRename(project)}
          onChange={(event) => setRenameDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setRenamingId(undefined);
            } else if (event.key === "Enter") {
              void commitRename(project);
            }
          }}
          ref={renameInputRef}
          value={renameDraft}
        />
      );
    }
    return (
      <span className="workspace-card-title" title={project.title}>
        {project.title}
      </span>
    );
  };

  const renderCover = (project: ProjectSummary) => {
    const cover = project.cover;
    if (cover?.assetId && cover.kind === "image") {
      return (
        <img
          alt=""
          className="workspace-cover-media"
          src={`/api/assets/${encodeURIComponent(cover.assetId)}`}
        />
      );
    }
    if (cover?.assetId && cover.kind === "video") {
      return (
        <video
          className="workspace-cover-media"
          muted
          playsInline
          preload="metadata"
          src={`/api/video-assets/${encodeURIComponent(cover.assetId)}`}
        />
      );
    }
    return <div className="workspace-cover-gradient" />;
  };

  return (
    <main className="workspace-page" data-testid="workspace-page">
      <header className="workspace-header">
        <div className="workspace-header-main">
          <div className="workspace-brand" data-testid="workspace-brand">
            <span aria-hidden="true" className="replica-mark" />
            <span className="workspace-mark">
              <strong className="workspace-wordmark">无央</strong>
              <span className="workspace-latin">UNBOUNDRY</span>
            </span>
          </div>
          <div className="workspace-title">
            <strong>工作空间</strong>
            <span>我的项目</span>
          </div>
        </div>
        <div className="workspace-toolbar">
          <button
            className="workspace-back-button"
            data-testid="workspace-back"
            onClick={() => void backToCanvas()}
            type="button"
          >
            返回画布
          </button>
          <input
            aria-label="搜索项目"
            className="workspace-search"
            data-testid="workspace-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索"
            type="search"
            value={search}
          />
          <GrayMenuSelect
            ariaLabel="项目排序"
            onChange={(value) => setSort(value as SortValue)}
            options={[...sortOptions]}
            testId="workspace-sort"
            value={sort}
          />
          <InlineOptionGroup
            ariaLabel="视图"
            onChange={(value) => setView(value as "grid" | "list")}
            options={[
              { label: "网格", value: "grid" },
              { label: "列表", value: "list" },
            ]}
            testId="workspace-view"
            value={view}
          />
          <button
            className="workspace-new-button"
            data-testid="workspace-new"
            onClick={() => void createProject()}
            type="button"
          >
            + 新建项目
          </button>
        </div>
      </header>

      {error && <p className="workspace-error" role="alert">{error}</p>}

      {loading ? (
        <p className="workspace-status">正在读取项目…</p>
      ) : filtered.length === 0 ? (
        <button
          className="workspace-empty"
          data-testid="workspace-empty"
          onClick={() => void createProject()}
          type="button"
        >
          <span aria-hidden="true">+</span>
          <strong>新建项目</strong>
          {search ? "没有匹配的项目" : "还没有项目"}
        </button>
      ) : view === "grid" ? (
        <div className="workspace-grid" data-testid="workspace-grid">
          {filtered.map((project) => (
            <div
              className={[
                "workspace-card",
                selectedIds.has(project.id) ? "workspace-selected" : "",
              ].filter(Boolean).join(" ")}
              key={project.id}
            >
              <div
                aria-label={`打开项目 ${project.title}`}
                className="workspace-card-main"
                data-testid={`project-card-${project.id}`}
                onClick={() =>
                  selectMode
                    ? toggleSelection(project.id)
                    : openProject(project.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    selectMode
                      ? toggleSelection(project.id)
                      : openProject(project.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="workspace-cover">
                  {renderSelectCheck(project)}
                  {renderCover(project)}
                </span>
                {renderRenameOrTitle(project)}
                <span className="workspace-card-time">
                  编辑于 {relativeTime(project.updatedAt)}
                </span>
              </div>
              <div
                className="workspace-card-menu-wrap"
                data-open={menuFor === project.id ? "true" : undefined}
              >
                <button
                  aria-label={`${project.title} 项目菜单`}
                  className="workspace-card-menu-trigger"
                  data-testid={`project-menu-${project.id}`}
                  onClick={() =>
                    setMenuFor((current) =>
                      current === project.id ? undefined : project.id,
                    )}
                  type="button"
                >
                  ⋯
                </button>
                {menuFor === project.id && (
                  <div
                    className="workspace-card-menu"
                    data-testid={`project-menu-pop-${project.id}`}
                    role="menu"
                  >
                    <button
                      onClick={() => openProject(project.id)}
                      type="button"
                    >
                      打开
                    </button>
                    <button onClick={() => startRename(project)} type="button">
                      重命名
                    </button>
                    <button
                      onClick={() => void cloneProject(project)}
                      type="button"
                    >
                      克隆
                    </button>
                    {project.id !== "default" && (
                      <button
                        onClick={() => {
                          setMenuFor(undefined);
                          selectProject(project.id);
                        }}
                        type="button"
                      >
                        选择
                      </button>
                    )}
                    {project.id !== "default" && (
                      <button
                        className="workspace-card-menu-danger"
                        onClick={() => {
                          setMenuFor(undefined);
                          setDeleting(project);
                        }}
                        type="button"
                      >
                        删除
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="workspace-list" data-testid="workspace-list">
          <div className="workspace-list-head">
            <span>预览</span>
            <span>名称</span>
            <span>类型</span>
            <span>内容</span>
            <span>创建时间</span>
            <span>最近更新</span>
          </div>
          {filtered.map((project) => (
            <div
              className={[
                "workspace-list-row",
                selectedIds.has(project.id) ? "workspace-selected" : "",
              ].filter(Boolean).join(" ")}
              key={project.id}
            >
              <span className="workspace-list-cover">
                {renderSelectCheck(project)}
                {renderCover(project)}
              </span>
              {renamingId === project.id ? (
                <input
                  aria-label="重命名项目"
                  className="workspace-inline-rename"
                  data-testid="workspace-rename-input"
                  maxLength={120}
                  onBlur={() => void commitRename(project)}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setRenamingId(undefined);
                    } else if (event.key === "Enter") {
                      void commitRename(project);
                    }
                  }}
                  ref={renameInputRef}
                  value={renameDraft}
                />
              ) : (
                <button
                  className="workspace-list-name"
                  data-testid={`project-row-${project.id}`}
                  onClick={() =>
                    selectMode
                      ? toggleSelection(project.id)
                      : openProject(project.id)}
                  type="button"
                >
                  {project.title}
                </button>
              )}
              <span>项目</span>
              <span>—</span>
              <span>{dateTime(project.createdAt)}</span>
              <span>{relativeTime(project.updatedAt)}</span>
            </div>
          ))}
        </div>
      )}

      {selectMode && (
        <div
          aria-label="批量操作"
          className="workspace-selection-bar"
          data-testid="workspace-selection-bar"
          role="toolbar"
        >
          <button
            aria-label="取消选择"
            className="workspace-selection-close"
            data-testid="workspace-selection-close"
            onClick={() => setSelectedIds(new Set())}
            type="button"
          >
            ×
          </button>
          <span
            className="workspace-selection-count"
            data-testid="workspace-selection-count"
          >
            已选择 {selectedIds.size} 个画布
          </span>
          <button
            aria-label="删除选中项目"
            className="workspace-selection-delete"
            data-testid="workspace-selection-delete"
            onClick={() => setDeletingSelected(true)}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
              <path
                d="M3 6h18"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <line
                x1="10"
                x2="10"
                y1="11"
                y2="17"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
              <line
                x1="14"
                x2="14"
                y1="11"
                y2="17"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
            </svg>
          </button>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          danger
          message={`确定要删除项目「${deleting.title}」？画布和生成任务记录将删除，素材库中的媒体会保留。`}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void confirmDelete()}
          title="确认删除"
        />
      )}

      {deletingSelected && (
        <ConfirmDialog
          danger
          message={`确定要删除选中的 ${selectedIds.size} 个项目？画布和生成任务记录将删除，素材库中的媒体会保留。`}
          onCancel={() => setDeletingSelected(false)}
          onConfirm={() => void confirmDeleteSelected()}
          title="确认删除"
        />
      )}
    </main>
  );
}
