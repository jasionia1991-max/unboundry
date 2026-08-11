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

type ProjectTitleRecord = Pick<ProjectSummary, "title" | "updatedAt">;
type ProjectMutationRecord = ProjectTitleRecord & { id: string };
type ProjectDeleteAction = "batch" | "single";

const PROJECT_DELETE_DEADLINE_MS = 10_000;
const PROJECT_LIST_DEADLINE_MS = 10_000;

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

function projectTitleRecord(value: unknown): ProjectTitleRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ProjectTitleRecord>;
  if (
    typeof candidate.title !== "string" ||
    candidate.title.length > 120 ||
    !Number.isSafeInteger(candidate.updatedAt) ||
    (candidate.updatedAt ?? 0) < 1
  ) {
    return undefined;
  }
  return candidate as ProjectTitleRecord;
}

function projectMutationRecord(
  value: unknown,
): ProjectMutationRecord | undefined {
  const titleRecord = projectTitleRecord(value);
  if (!titleRecord) return undefined;
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[a-z0-9._-]+$/i.test(id)) {
    return undefined;
  }
  return { id, ...titleRecord };
}

function projectSummaryRecord(value: unknown): ProjectSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ProjectSummary>;
  if (
    typeof candidate.id !== "string" ||
    !/^[a-z0-9._-]+$/i.test(candidate.id) ||
    typeof candidate.title !== "string" ||
    candidate.title.length > 120 ||
    !Number.isSafeInteger(candidate.updatedAt) ||
    (candidate.updatedAt ?? -1) < (candidate.id === "default" ? 0 : 1) ||
    !(
      candidate.createdAt === null ||
      (Number.isSafeInteger(candidate.createdAt) &&
        (candidate.createdAt ?? 0) >= 1)
    ) ||
    !candidate.cover ||
    typeof candidate.cover !== "object"
  ) {
    return undefined;
  }
  const cover = candidate.cover as Partial<ProjectCover>;
  if (
    cover.kind === null
      ? cover.assetId !== null
      : (cover.kind !== "image" && cover.kind !== "video") ||
        typeof cover.assetId !== "string" ||
        !/^[a-z0-9._-]+$/i.test(cover.assetId)
  ) {
    return undefined;
  }
  return candidate as ProjectSummary;
}

function projectMutationError(action: string, caught: unknown) {
  if (caught instanceof Error && caught.message.trim()) {
    return `${action}失败：${caught.message}`;
  }
  return `${action}失败，请稍后重试`;
}

async function withProjectRequestDeadline<T>(
  timeoutMs: number,
  timeoutMessage: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function deleteProjectRequest(id: string) {
  return withProjectRequestDeadline(
    PROJECT_DELETE_DEADLINE_MS,
    "删除请求超时，结果未知",
    (signal) =>
      fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal,
      }),
  );
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
  const [renameSavingId, setRenameSavingId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectSummary>();
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState<ProjectDeleteAction>();
  const [batchDeleteIds, setBatchDeleteIds] = useState<readonly string[]>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string>();
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInFlight = useRef(false);
  const deleteInFlight = useRef<ProjectDeleteAction | undefined>(undefined);
  const renameInFlight = useRef<string | undefined>(undefined);
  const renameUpdatedAt = useRef(0);
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

  const load = useCallback(async (
    showLoading = true,
  ): Promise<ProjectSummary[] | undefined> => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const body = await withProjectRequestDeadline(
        PROJECT_LIST_DEADLINE_MS,
        "项目列表读取超时，请稍后重试",
        async (signal) => {
          const response = await fetch("/api/projects", {
            headers: { Accept: "application/json" },
            signal,
          });
          if (!response.ok) {
            throw new Error(`项目列表读取失败：${response.status}`);
          }
          return (await response.json()) as { projects?: unknown };
        },
      );
      if (!Array.isArray(body.projects)) {
        throw new Error("项目列表返回无效，请稍后重试");
      }
      const next = body.projects.map(projectSummaryRecord);
      if (next.some((project) => !project)) {
        throw new Error("项目列表返回无效，请稍后重试");
      }
      const projects = next as ProjectSummary[];
      setProjects(projects);
      return projects;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目列表读取失败");
      return undefined;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (renamingId && !renameSavingId) renameInputRef.current?.focus();
  }, [renameSavingId, renamingId]);

  useEffect(() => {
    if (!selectMode) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteInFlight.current) {
        setSelectedIds(new Set());
      }
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
    if (createInFlight.current) return;
    createInFlight.current = true;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`服务器返回 ${response.status}，请重试`);
      }
      const created = projectMutationRecord(await response.json());
      if (!created) {
        throw new Error("服务器返回了无效项目");
      }
      window.location.href = `/canvas/${encodeURIComponent(created.id)}`;
    } catch (caught) {
      setError(projectMutationError("新建项目", caught));
    } finally {
      createInFlight.current = false;
      setCreating(false);
    }
  };

  const startRename = (project: ProjectSummary) => {
    if (renameInFlight.current) return;
    setMenuFor(undefined);
    setError("");
    setRenamingId(project.id);
    setRenameDraft(project.title);
    renameUpdatedAt.current = project.updatedAt;
  };

  const commitRename = async (project: ProjectSummary) => {
    if (renameInFlight.current) return;
    const title = renameDraft.trim();
    if (!title) {
      setError("项目名称不能为空");
      return;
    }
    if (title === project.title) {
      setError("");
      setRenamingId(undefined);
      return;
    }

    const updatedAt = Math.max(
      Date.now(),
      project.updatedAt + 1,
      renameUpdatedAt.current + 1,
    );
    renameUpdatedAt.current = updatedAt;
    renameInFlight.current = project.id;
    setRenameSavingId(project.id);
    setError("");
    try {
      const response = await fetch(
        `/api/project-title/${encodeURIComponent(project.id)}`,
        {
          body: JSON.stringify({ title, updatedAt }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      if (!response.ok) {
        const reason = response.status === 409
          ? "项目名称已在其他页面更新，请确认草稿后重试"
          : `服务器返回 ${response.status}，请重试`;
        throw new Error(reason);
      }
      const saved = projectTitleRecord(await response.json());
      if (!saved || saved.title !== title || saved.updatedAt !== updatedAt) {
        throw new Error("项目名称已在其他页面更新，请确认草稿后重试");
      }
      setProjects((current) =>
        current.map((item) =>
          item.id === project.id ? { ...item, ...saved } : item,
        ),
      );
      setRenamingId(undefined);
    } catch (caught) {
      setError(projectMutationError("重命名项目", caught));
    } finally {
      renameInFlight.current = undefined;
      setRenameSavingId(undefined);
    }
  };

  const confirmDelete = async () => {
    const target = deleting;
    if (!target || deleteInFlight.current) return;
    deleteInFlight.current = "single";
    setDeleteBusy("single");
    setError("");
    let acknowledged = false;
    let failure = "";
    try {
      const response = await deleteProjectRequest(target.id);
      if (response.status !== 204) {
        failure = response.ok
          ? "服务器返回了无效删除响应"
          : `服务器返回 ${response.status}`;
      } else {
        acknowledged = true;
      }
    } catch (caught) {
      failure = caught instanceof Error && caught.message.trim()
        ? caught.message
        : "网络连接失败";
    }

    try {
      const authoritative = await load(false);
      const absent = authoritative
        ? !authoritative.some((project) => project.id === target.id)
        : false;
      const confirmedDeleted = authoritative ? absent : acknowledged;
      if (confirmedDeleted) {
        clearProjectLocalKeys(target.id, userId);
        if (!authoritative) {
          setProjects((current) =>
            current.filter((project) => project.id !== target.id)
          );
        }
        setDeleting(undefined);
        setError(
          failure
            ? `删除项目响应异常，但已确认项目已删除：${failure}`
            : authoritative
              ? ""
              : "项目已删除，但项目列表刷新失败，请稍后重新加载",
        );
      } else {
        setDeleting(target);
        setError(
          failure
            ? `删除项目失败：${failure}${
              authoritative ? "" : "；项目列表确认失败，请重试"
            }`
            : acknowledged
              ? "删除响应与项目列表不一致，请确认后重试"
              : "删除项目失败，请稍后重试",
        );
      }
    } finally {
      deleteInFlight.current = undefined;
      setDeleteBusy(undefined);
    }
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
    if (id === "default" || deleteInFlight.current === "batch") return;
    setSelectedIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const toggleSelection = (id: string) => {
    if (id === "default" || deleteInFlight.current === "batch") return;
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
    if (deleteInFlight.current) return;
    const ids = [...selectedIds]
      .filter((id) => id !== "default")
      .sort((left, right) => left.localeCompare(right));
    if (ids.length === 0) return;
    deleteInFlight.current = "batch";
    setDeleteBusy("batch");
    setBatchDeleteIds(ids);
    setError("");
    const acknowledged = new Set<string>();
    let failure = "";
    for (const id of ids) {
      try {
        const response = await deleteProjectRequest(id);
        if (response.status !== 204) {
          failure = response.ok
            ? `项目 ${id} 返回了无效删除响应`
            : `项目 ${id} 返回 ${response.status}`;
          break;
        }
        acknowledged.add(id);
      } catch (caught) {
        const detail = caught instanceof Error && caught.message.trim()
          ? caught.message
          : "网络连接失败";
        failure = `项目 ${id}：${detail}`;
        break;
      }
    }

    try {
      const authoritative = await load(false);
      const alive = authoritative
        ? new Set(authoritative.map((project) => project.id))
        : undefined;
      const confirmedDeleted = new Set(
        alive
          ? ids.filter((id) => !alive.has(id))
          : [...acknowledged],
      );
      if (!alive && confirmedDeleted.size > 0) {
        setProjects((current) =>
          current.filter((project) => !confirmedDeleted.has(project.id))
        );
      }
      for (const id of confirmedDeleted) {
        clearProjectLocalKeys(id, userId);
      }
      const remaining = ids.filter((id) => !confirmedDeleted.has(id));
      setSelectedIds(new Set(remaining));
      if (remaining.length === 0) {
        setDeletingSelected(false);
        setError(
          failure
            ? `删除响应异常，但已确认所选项目已删除：${failure}`
            : authoritative
              ? ""
              : "项目已删除，但项目列表刷新失败，请稍后重新加载",
        );
      } else {
        setDeletingSelected(true);
        setError(
          failure
            ? `部分项目删除失败：${failure}${
              authoritative ? "" : "；项目列表确认失败，请重试"
            }`
            : authoritative
              ? "部分删除响应与项目列表不一致，请确认后重试"
              : "部分项目已删除，但项目列表刷新失败，请重试其余项目",
        );
      }
    } finally {
      deleteInFlight.current = undefined;
      setDeleteBusy(undefined);
      setBatchDeleteIds(undefined);
    }
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
        disabled={project.id === "default" || deleteBusy === "batch"}
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
          aria-describedby={error ? "workspace-error" : undefined}
          aria-label="重命名项目"
          aria-invalid={Boolean(error)}
          className="workspace-inline-rename"
          data-testid="workspace-rename-input"
          disabled={renameSavingId === project.id}
          maxLength={120}
          onBlur={() => void commitRename(project)}
          onChange={(event) => setRenameDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              if (renameSavingId !== project.id) setRenamingId(undefined);
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
            disabled={creating}
            onClick={() => void createProject()}
            type="button"
          >
            {creating ? "正在新建…" : "+ 新建项目"}
          </button>
        </div>
      </header>

      {error && (
        <p className="workspace-error" id="workspace-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="workspace-status">正在读取项目…</p>
      ) : filtered.length === 0 ? (
        <button
          className="workspace-empty"
          data-testid="workspace-empty"
          disabled={creating}
          onClick={() => void createProject()}
          type="button"
        >
          <span aria-hidden="true">+</span>
          <strong>{creating ? "正在新建…" : "新建项目"}</strong>
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
                  deleteInFlight.current
                    ? undefined
                    : selectMode
                    ? toggleSelection(project.id)
                    : openProject(project.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    deleteInFlight.current
                      ? undefined
                      : selectMode
                      ? toggleSelection(project.id)
                      : openProject(project.id);
                  }
                }}
                role="button"
                tabIndex={deleteBusy ? -1 : 0}
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
                  aria-describedby={error ? "workspace-error" : undefined}
                  aria-label="重命名项目"
                  aria-invalid={Boolean(error)}
                  className="workspace-inline-rename"
                  data-testid="workspace-rename-input"
                  disabled={renameSavingId === project.id}
                  maxLength={120}
                  onBlur={() => void commitRename(project)}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      if (renameSavingId !== project.id) {
                        setRenamingId(undefined);
                      }
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
                    deleteInFlight.current
                      ? undefined
                      : selectMode
                      ? toggleSelection(project.id)
                      : openProject(project.id)}
                  disabled={Boolean(deleteBusy)}
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
            disabled={deleteBusy === "batch"}
            onClick={() => {
              if (!deleteInFlight.current) setSelectedIds(new Set());
            }}
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
            disabled={deleteBusy === "batch"}
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
          busy={deleteBusy === "single"}
          confirmLabel={deleteBusy === "single" ? "正在删除…" : "删除"}
          danger
          message={`确定要删除项目「${deleting.title}」？画布和生成任务记录将删除，素材库中的媒体会保留。`}
          onCancel={() => {
            if (!deleteInFlight.current) setDeleting(undefined);
          }}
          onConfirm={() => void confirmDelete()}
          title="确认删除"
        />
      )}

      {deletingSelected && (
        <ConfirmDialog
          busy={deleteBusy === "batch"}
          confirmLabel={deleteBusy === "batch" ? "正在删除…" : "删除"}
          danger
          message={`确定要删除选中的 ${
            batchDeleteIds?.length ?? selectedIds.size
          } 个项目？画布和生成任务记录将删除，素材库中的媒体会保留。`}
          onCancel={() => {
            if (!deleteInFlight.current) setDeletingSelected(false);
          }}
          onConfirm={() => void confirmDeleteSelected()}
          title="确认删除"
        />
      )}
    </main>
  );
}
