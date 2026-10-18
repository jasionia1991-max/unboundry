import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GrayMenuSelect } from "../ui/GrayMenuSelect";
import { REAL_CATEGORIES } from "../../../types/templateCategories";
import { SettingsPageHeader } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";

type AdminPublicTemplateStatus = "draft" | "published" | "archived";
type AdminPublicTemplateCompatibilityStatus = "INVALID" | "NEEDS_MODEL" | "PASS";

type AdminPublicTemplate = {
  categories: string[];
  compatibility: {
    issues: Array<{ message: string; nodeTitle?: string }>;
    status: AdminPublicTemplateCompatibilityStatus;
  };
  createdAt: string;
  description: string;
  graph?: Record<string, unknown>;
  id: string;
  previewImage?: string;
  status: AdminPublicTemplateStatus;
  title: string;
  updatedAt: string;
};

type AdminTemplatePage = {
  hasMore: boolean;
  limit: number;
  offset: number;
  revision: string;
  total: number;
};

function useAdminTemplateList() {
  const [items, setItems] = useState<AdminPublicTemplate[]>([]);
  const [pagination, setPagination] = useState<AdminTemplatePage>({
    hasMore: false, limit: 50, offset: 0, revision: "", total: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequenceRef = useRef(0);
  const aliveRef = useRef(true);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const filtersRef = useRef({ query: "", status: "" });
  const pageRef = useRef(pagination);

  const load = async (options?: { offset?: number; query?: string; status?: string }) => {
    const offset = options?.offset ?? 0;
    const filters = {
      query: options?.query ?? filtersRef.current.query,
      status: options?.status ?? filtersRef.current.status,
    };
    const previousRevision = pageRef.current.revision;
    if (offset > 0 && !previousRevision) return;
    filtersRef.current = filters;
    const requestId = ++sequenceRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    setNotice("");
    const accepts = () => aliveRef.current && requestId === sequenceRef.current;
    const read = (nextOffset: number, revision?: string) => {
      const params = new URLSearchParams({
        limit: "50", offset: String(nextOffset), includeGraph: "false",
        q: filters.query, status: filters.status,
      });
      if (revision) params.set("revision", revision);
      return jsonRequest<{ items: AdminPublicTemplate[]; pagination: AdminTemplatePage }>(
        `/api/admin/templates?${params}`, { cache: "no-store", signal: controller.signal },
      );
    };
    try {
      let body;
      try {
        body = await read(offset, options?.offset !== undefined ? previousRevision || undefined : undefined);
      } catch (caught) {
        if (!accepts()) return;
        if (!(caught instanceof Error) ||
          (caught as Error & { code?: string }).code !== "LIST_REVISION_STALE") throw caught;
        setItems([]);
        pageRef.current = { ...pageRef.current, hasMore: false, offset: 0, revision: "" };
        setPagination(pageRef.current);
        setNotice("模板列表已变化，已返回第一页；编辑内容和已选来源保留。");
        body = await read(0); // One refresh only; any further failure remains visible.
      }
      if (!accepts()) return;
      if (!Array.isArray(body.items) || !body.pagination ||
        !/^[a-f0-9]{64}$/.test(body.pagination.revision)) {
        throw new Error("模板列表响应无效，请刷新重试");
      }
      pageRef.current = body.pagination;
      setPagination(body.pagination);
      setItems(body.items);
    } catch (caught) {
      if (accepts()) setError(caught instanceof Error ? caught.message : "公共模板列表读取失败");
    } finally {
      if (accepts()) setLoading(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
      sequenceRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);
  const invalidate = () => {
    sequenceRef.current += 1;
    controllerRef.current?.abort();
    if (aliveRef.current) setLoading(false);
  };
  return { items, setItems, pagination, loading, error, notice, load, invalidate };
}

function AdminTemplatePager({ list, label }: {
  list: ReturnType<typeof useAdminTemplateList>;
  label: string;
}) {
  return <nav aria-label={label} className="admin-template-modal-actions">
    <span role="status">共 {list.pagination.total} 个模板 · 第 {Math.floor(list.pagination.offset / list.pagination.limit) + 1} 页</span>
    <button type="button" disabled={list.loading || list.pagination.offset === 0}
      onClick={() => void list.load({ offset: Math.max(0, list.pagination.offset - list.pagination.limit) })}>上一页</button>
    <button type="button" disabled={list.loading || !list.pagination.hasMore}
      onClick={() => void list.load({ offset: list.pagination.offset + list.pagination.limit })}>下一页</button>
    <button type="button" disabled={list.loading} onClick={() => void list.load()}>刷新列表</button>
  </nav>;
}

function AdminTemplateSourcePicker({ disabled, isBusy, onChange, value }: {
  disabled: boolean;
  isBusy: (id: string) => boolean;
  onChange: (id: string) => void;
  value: string;
}) {
  const list = useAdminTemplateList();
  const [query, setQuery] = useState("");
  const labelsRef = useRef(new Map<string, string>());
  for (const item of list.items) labelsRef.current.set(item.id, item.title);
  const options = list.items.map((template) => ({
    label: template.title, disabled: isBusy(template.id), value: template.id,
  }));
  if (value && !options.some((item) => item.value === value)) {
    options.unshift({ label: labelsRef.current.get(value) ?? "已选择的模板", disabled: isBusy(value), value });
  }
  return <div className="admin-template-field admin-template-field-wide">
    <span>基于现有模板（可选）</span>
    <label>搜索来源模板
      <input disabled={disabled} maxLength={120} value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault(); void list.load({ query });
          }
        }} />
    </label>
    <button disabled={disabled || list.loading} type="button" onClick={() => void list.load({ query })}>搜索来源</button>
    <GrayMenuSelect disabled={disabled} ariaLabel="基于现有模板（可选）"
      className="admin-template-select" onChange={onChange}
      options={[{ label: "不基于现有模板", value: "" }, ...options]}
      testId="admin-template-base-select" value={value} />
    <AdminTemplatePager list={list} label="来源模板分页" />
    {list.loading && <span role="status">正在读取来源列表</span>}
    {list.notice && <span role="status">{list.notice}</span>}
    {list.error && <span role="alert">{list.error}</span>}
  </div>;
}

function publicTemplateStatusLabel(status: AdminPublicTemplateStatus) {
  if (status === "published") return "已发布";
  if (status === "draft") return "草稿";
  return "已归档";
}

function publicTemplateCompatibilityLabel(
  status: AdminPublicTemplateCompatibilityStatus,
) {
  if (status === "PASS") return "兼容检查通过";
  if (status === "NEEDS_MODEL") return "需要绑定模型";
  return "模板无效";
}

type AdminTemplateDraft = {
  baseTemplateId: string;
  categories: string[];
  description: string;
  graphJson: string;
  previewImage: string;
  status: AdminPublicTemplateStatus;
  title: string;
};

const emptyAdminTemplateDraft: AdminTemplateDraft = {
  baseTemplateId: "",
  categories: [],
  description: "",
  graphJson: "",
  previewImage: "",
  status: "draft",
  title: "",
};

type AdminTemplateGraphRead = {
  requestId: number;
  templateId: string;
  kind: "edit" | "base";
  fallback: Pick<AdminTemplateDraft, "baseTemplateId" | "graphJson"> & {
    graphDirty: boolean;
  };
};

type AdminTemplateEditor = {
  sessionId: number;
  templateId?: string;
  draft: AdminTemplateDraft;
  graphDirty: boolean;
  error: string;
  read?: AdminTemplateGraphRead;
  failedRead?: Pick<AdminTemplateGraphRead, "kind" | "templateId">;
};

type AdminTemplateSave = {
  sessionId: number;
  templateId?: string;
  title: string;
};

export function AdminTemplatesPage({ currentUser }: { currentUser: AuthUser }) {
  const templateList = useAdminTemplateList();
  const { items: templates, setItems: setTemplates, load } = templateList;
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [archiving, setArchiving] = useState<AdminPublicTemplate>();
  const [editor, setEditor] = useState<AdminTemplateEditor>();
  const [saving, setSaving] = useState<AdminTemplateSave>();
  const mountedRef = useRef(true);
  const editorRef = useRef<AdminTemplateEditor | undefined>(undefined);
  const sessionSequenceRef = useRef(0);
  const readSequenceRef = useRef(0);
  const graphReadRef = useRef<{
    controller: AbortController;
    requestId: number;
    sessionId: number;
  } | undefined>(undefined);
  const saveRef = useRef<AdminTemplateSave | undefined>(undefined);
  const rowWriteRef = useRef(new Map<string, { templateId: string }>());
  const templateModalRef = useRef<HTMLElement | null>(null);
  const templateModalReturnFocusRef = useRef<HTMLElement | null>(null);

  const creating = Boolean(editor);
  const editing = editor?.templateId;
  const draft = editor?.draft ?? emptyAdminTemplateDraft;
  const modalError = editor?.error ?? "";
  const fieldsLocked = Boolean(saving && saving.sessionId === editor?.sessionId);
  const templateBusy = (templateId: string) =>
    rowWriteRef.current.has(templateId) ||
    saveRef.current?.templateId === templateId;

  // All editor mutations are serialized here, including checks after awaits.
  // The ref is written before React renders so a second event cannot reuse old state.
  const writeEditor = (next: AdminTemplateEditor | undefined) => {
    editorRef.current = next;
    if (mountedRef.current) setEditor(next);
  };
  const updateEditor = (
    sessionId: number,
    update: (current: AdminTemplateEditor) => AdminTemplateEditor,
  ) => {
    const current = editorRef.current;
    if (!mountedRef.current || current?.sessionId !== sessionId) return;
    writeEditor(update(current));
  };
  const cancelGraphRead = () => {
    readSequenceRef.current += 1;
    const previous = graphReadRef.current;
    graphReadRef.current = undefined;
    previous?.controller.abort();
  };
  const closeEditor = (sessionId: number | undefined) => {
    if (sessionId === undefined || editorRef.current?.sessionId !== sessionId) return;
    cancelGraphRead();
    writeEditor(undefined);
  };
  const closeTemplateModal = () => closeEditor(editorRef.current?.sessionId);
  const setDraft = (update: (current: AdminTemplateDraft) => AdminTemplateDraft) => {
    const sessionId = editor?.sessionId;
    if (sessionId === undefined || saveRef.current?.sessionId === sessionId) return;
    updateEditor(sessionId, (current) => ({ ...current, draft: update(current.draft) }));
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      templateList.invalidate();
      cancelGraphRead();
      editorRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const sessionId = editor.sessionId;
    const returnFocus = templateModalReturnFocusRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      if (editorRef.current?.sessionId !== sessionId) return;
      templateModalRef.current
        ?.querySelector<HTMLElement>("[data-autofocus='true']")
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (returnFocus?.isConnected) {
        window.requestAnimationFrame(() => {
          if (!editorRef.current && returnFocus.isConnected) returnFocus.focus();
        });
      }
    };
  }, [editor?.sessionId]);

  const handleTemplateModalKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (templateModalRef.current?.querySelector(".gray-menu-select[data-open='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      closeTemplateModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(templateModalRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const acceptSavedTemplate = (template: AdminPublicTemplate, expectedId?: string) => {
    if (!template || typeof template.id !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(template.id) ||
      (expectedId !== undefined && template.id !== expectedId)) {
      throw new Error("模板保存响应不匹配，请重新读取列表确认");
    }
    templateList.invalidate();
    setTemplates((current) => current.some((item) => item.id === template.id)
      ? current.map((item) => item.id === template.id ? template : item)
      : current);
  };

  const mutateTemplateStatus = async (
    template: AdminPublicTemplate,
    status: AdminPublicTemplateStatus | "archive",
  ) => {
    if (templateBusy(template.id)) return;
    const operation = { templateId: template.id };
    rowWriteRef.current.set(template.id, operation);
    setBusyIds((current) => new Set(current).add(template.id));
    templateList.invalidate();
    setError("");
    setNotice("");
    try {
      if (status === "archive") {
        await jsonRequest("/api/admin/templates/" + encodeURIComponent(template.id), {
          method: "DELETE",
        });
        if (!mountedRef.current) return;
        templateList.invalidate();
        setTemplates((current) => current.map((item) => item.id === template.id
          ? { ...item, status: "archived" as const } : item));
        setArchiving((current) => current?.id === template.id ? undefined : current);
        setNotice("「" + template.title + "」已归档，普通账号不可见");
      } else {
        const body = await jsonRequest<{ template: AdminPublicTemplate }>(
          "/api/admin/templates/" + encodeURIComponent(template.id),
          { body: JSON.stringify({ status }), method: "PATCH" },
        );
        if (!mountedRef.current) return;
        acceptSavedTemplate(body.template, template.id);
        setNotice("「" + template.title + "」已" + publicTemplateStatusLabel(status));
      }
      void load();
    } catch (caught) {
      if (!mountedRef.current) return;
      setArchiving((current) => current?.id === template.id ? undefined : current);
      setError(caught instanceof Error ? caught.message : "模板状态修改失败");
    } finally {
      if (rowWriteRef.current.get(template.id) === operation) {
        rowWriteRef.current.delete(template.id);
        if (mountedRef.current) setBusyIds((current) => {
          const next = new Set(current);
          next.delete(template.id);
          return next;
        });
      }
    }
  };
  const changeStatus = (template: AdminPublicTemplate, status: AdminPublicTemplateStatus) =>
    mutateTemplateStatus(template, status);
  const archive = (template: AdminPublicTemplate) => mutateTemplateStatus(template, "archive");

  const startEditor = (template?: AdminPublicTemplate) => {
    if (template && templateBusy(template.id)) return undefined;
    cancelGraphRead();
    templateModalReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next: AdminTemplateEditor = {
      sessionId: ++sessionSequenceRef.current,
      templateId: template?.id,
      error: "",
      graphDirty: false,
      draft: template ? {
        baseTemplateId: "",
        categories: [...template.categories],
        description: template.description ?? "",
        graphJson: "",
        previewImage: template.previewImage ?? "",
        status: template.status,
        title: template.title,
      } : { ...emptyAdminTemplateDraft, categories: [] },
    };
    writeEditor(next);
    return next;
  };
  const openCreate = () => { startEditor(); };

  const readTemplateGraph = async (
    sessionId: number,
    templateId: string,
    kind: "edit" | "base",
  ) => {
    const current = editorRef.current;
    if (current?.sessionId !== sessionId ||
      saveRef.current?.sessionId === sessionId || templateBusy(templateId)) return;
    cancelGraphRead();
    const read: AdminTemplateGraphRead = {
      requestId: readSequenceRef.current,
      templateId,
      kind,
      fallback: {
        baseTemplateId: current.draft.baseTemplateId,
        graphJson: current.draft.graphJson,
        graphDirty: current.graphDirty,
      },
    };
    const operation = {
      controller: new AbortController(),
      requestId: read.requestId,
      sessionId,
    };
    graphReadRef.current = operation;
    updateEditor(sessionId, (value) => ({
      ...value, read, failedRead: undefined, error: "",
    }));
    const accepts = (value: AdminTemplateEditor) =>
      graphReadRef.current === operation &&
      value.read?.requestId === read.requestId &&
      value.read.templateId === templateId && value.read.kind === kind &&
      (kind === "base" ? !value.templateId : value.templateId === templateId);
    try {
      const body = await jsonRequest<{ template: AdminPublicTemplate }>(
        "/api/admin/templates/" + encodeURIComponent(templateId),
        { cache: "no-store", signal: operation.controller.signal },
      );
      const full = body.template?.id === templateId ? body.template : undefined;
      const graph = full?.graph;
      if (!graph || Array.isArray(graph) || typeof graph !== "object" ||
        !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.version !== 1) {
        throw new Error("未找到可读取的模板图");
      }
      const graphJson = JSON.stringify(graph, null, 2);
      updateEditor(sessionId, (value) => !accepts(value) ? value : {
        ...value,
        read: undefined,
        failedRead: undefined,
        error: "",
        graphDirty: false,
        draft: {
          ...value.draft,
          graphJson,
          baseTemplateId: kind === "base" ? templateId : "",
          title: kind === "base" ? value.draft.title || full?.title || "" : value.draft.title,
        },
      });
    } catch {
      updateEditor(sessionId, (value) => !accepts(value) ? value : {
        ...value,
        read: undefined,
        failedRead: { templateId, kind },
        error: kind === "base"
          ? "来源模板读取失败，保留原内容"
          : "模板图读取失败，可手动填写或仅保存其他信息",
        graphDirty: read.fallback.graphDirty,
        draft: { ...value.draft,
          graphJson: read.fallback.graphJson,
          baseTemplateId: read.fallback.baseTemplateId },
      });
    } finally {
      if (graphReadRef.current === operation) graphReadRef.current = undefined;
    }
  };

  const openEdit = (template: AdminPublicTemplate) => {
    const next = startEditor(template);
    if (next) void readTemplateGraph(next.sessionId, template.id, "edit");
  };
  const pickBaseTemplate = (templateId: string) => {
    const current = editorRef.current;
    if (!current || current.sessionId !== editor?.sessionId || current.templateId ||
      saveRef.current?.sessionId === current.sessionId) return;
    if (templateId) {
      void readTemplateGraph(current.sessionId, templateId, "base");
    } else {
      cancelGraphRead();
      updateEditor(current.sessionId, (value) => ({
        ...value, read: undefined, failedRead: undefined, error: "",
        draft: { ...value.draft, baseTemplateId: "" },
      }));
    }
  };
  const editGraphJson = (graphJson: string) => {
    const sessionId = editor?.sessionId;
    if (sessionId === undefined || editorRef.current?.sessionId !== sessionId ||
      saveRef.current?.sessionId === sessionId) return;
    cancelGraphRead();
    updateEditor(sessionId, (current) => ({
      ...current, graphDirty: true, read: undefined, failedRead: undefined, error: "",
      draft: { ...current.draft, baseTemplateId: "", graphJson },
    }));
  };

  const submit = async () => {
    const current = editorRef.current;
    if (!current || current.sessionId !== editor?.sessionId || saveRef.current ||
      (current.templateId && templateBusy(current.templateId)) ||
      (!current.templateId && current.read?.kind === "base")) return;
    let graph: unknown;
    if ((!current.templateId || current.graphDirty) && current.draft.graphJson.trim()) {
      try {
        graph = JSON.parse(current.draft.graphJson) as unknown;
      } catch {
        updateEditor(current.sessionId, (value) => ({
          ...value, error: "模板图 JSON 无法解析",
        }));
        return;
      }
    }
    if (!current.templateId && graph === undefined) {
      updateEditor(current.sessionId, (value) => ({
        ...value, error: "请填写模板图 JSON，或先选择「基于现有模板」",
      }));
      return;
    }
    const body = JSON.stringify({
      category: current.draft.categories,
      description: current.draft.description.trim() || undefined,
      graph,
      previewImage: current.draft.previewImage.trim() || undefined,
      status: current.draft.status,
      title: current.draft.title,
    });
    const operation: AdminTemplateSave = {
      sessionId: current.sessionId, templateId: current.templateId,
      title: current.draft.title,
    };
    saveRef.current = operation;
    cancelGraphRead();
    updateEditor(current.sessionId, (value) => ({
      ...value, read: undefined, failedRead: undefined, error: "",
    }));
    setSaving(operation);
    templateList.invalidate();
    try {
      const result = await jsonRequest<{ template: AdminPublicTemplate }>(
        operation.templateId
          ? "/api/admin/templates/" + encodeURIComponent(operation.templateId)
          : "/api/admin/templates",
        { body, method: operation.templateId ? "PATCH" : "POST" },
      );
      if (!mountedRef.current) return;
      acceptSavedTemplate(result.template, operation.templateId);
      setNotice("「" + operation.title + "」" + (operation.templateId ? "已更新" : "已创建"));
      closeEditor(operation.sessionId);
      void load();
    } catch (caught) {
      if (!mountedRef.current) return;
      const message = caught instanceof Error ? caught.message : "模板保存失败";
      if (editorRef.current?.sessionId === operation.sessionId) {
        updateEditor(operation.sessionId, (value) => ({ ...value, error: message }));
      } else {
        setError("「" + operation.title + "」保存失败：" + message);
      }
    } finally {
      if (saveRef.current === operation) {
        saveRef.current = undefined;
        if (mountedRef.current) setSaving(undefined);
      }
    }
  };

  return (
    <main
      className="admin-page admin-templates-page"
      data-testid="admin-templates-page"
    >
      <SettingsPageHeader
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="公共模板管理"
        userId={currentUser.id}
      />
      {notice && (
        <p className="storage-admin-notice provider-page-message">{notice}</p>
      )}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <section className="admin-card admin-templates-section">
        <div className="api-contract-heading">
          <div>
            <span>公共模板</span>
            <h1>仅管理员可新增/编辑/上下架；普通账号只能浏览与导入</h1>
          </div>
          <button onClick={openCreate} type="button">
            新建公共模板
          </button>
        </div>
        <form className="admin-template-form" onSubmit={(event) => {
          event.preventDefault(); void load({ query: searchQuery, status: statusFilter });
        }}>
          <label>搜索公共模板
            <input maxLength={120} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          </label>
          <div className="admin-template-field">
            <span>模板状态筛选</span>
            <GrayMenuSelect ariaLabel="模板状态筛选" className="admin-template-filter-select" value={statusFilter}
              onChange={(value) => { setStatusFilter(value); void load({ query: searchQuery, status: value }); }}
              options={[{ label: "全部状态", value: "" }, { label: "草稿", value: "draft" },
                { label: "已发布", value: "published" }, { label: "已归档", value: "archived" }]} />
          </div>
          <button type="submit" disabled={templateList.loading}>搜索模板</button>
        </form>
        <AdminTemplatePager list={templateList} label="公共模板分页" />
        {templateList.loading && <p role="status">正在读取模板列表</p>}
        {templateList.notice && <p role="status">{templateList.notice}</p>}
        {templateList.error && <p className="auth-error" role="alert">{templateList.error}</p>}
        <div
          className="admin-templates-grid"
          data-testid="admin-templates-list"
        >
          {templates.length === 0 ? (
            <p className="model-list-empty">暂无公共模板</p>
          ) : (
            templates.map((template) => (
              <article
                className="admin-template-card"
                data-testid={`admin-template-${template.id}`}
                key={template.id}
              >
                <div className="admin-template-art">
                  {template.previewImage ? (
                    <img alt="" src={template.previewImage} />
                  ) : (
                    <span />
                  )}
                </div>
                <div className="admin-template-info">
                  <strong>{template.title}</strong>
                  {saving?.templateId === template.id && (
                    <small role="status">正在保存，完成后可继续编辑或更改状态</small>
                  )}
                  <span>
                    {template.categories.length
                      ? template.categories.join(" / ")
                      : "未分类"}
                  </span>
                  <small>
                    更新于{" "}
                    {new Date(template.updatedAt).toLocaleString("zh-CN")}
                  </small>
                  <small
                    className="admin-template-compatibility-detail"
                    title={template.compatibility.issues[0]?.message}
                  >
                    {template.compatibility.issues[0]?.nodeTitle
                      ? `${template.compatibility.issues[0].nodeTitle}：`
                      : ""}
                    {template.compatibility.issues[0]?.message}
                  </small>
                </div>
                <b
                  className="admin-template-status"
                  data-status={template.status}
                >
                  {publicTemplateStatusLabel(template.status)}
                </b>
                <b
                  className="admin-template-compatibility"
                  data-compatibility={template.compatibility.status}
                >
                  {publicTemplateCompatibilityLabel(template.compatibility.status)}
                </b>
                <div className="admin-template-actions">
                  {template.status === "draft" && (
                    <button
                      disabled={
                        busyIds.has(template.id) || saving?.templateId === template.id ||
                        template.compatibility.status !== "PASS"
                      }
                      onClick={() => void changeStatus(template, "published")}
                      title={template.compatibility.issues[0]?.message}
                      type="button"
                    >
                      发布
                    </button>
                  )}
                  {template.status === "published" && (
                    <button
                      disabled={busyIds.has(template.id) || saving?.templateId === template.id}
                      onClick={() => void changeStatus(template, "draft")}
                      type="button"
                    >
                      下架
                    </button>
                  )}
                  {template.status === "archived" ? (
                    <button
                      disabled={
                        busyIds.has(template.id) || saving?.templateId === template.id ||
                        template.compatibility.status !== "PASS"
                      }
                      onClick={() => void changeStatus(template, "published")}
                      title={template.compatibility.issues[0]?.message}
                      type="button"
                    >
                      恢复
                    </button>
                  ) : (
                    <button
                      className="admin-template-danger"
                      disabled={busyIds.has(template.id) || saving?.templateId === template.id}
                      onClick={() => {
                        if (!templateBusy(template.id)) setArchiving(template);
                      }}
                      type="button"
                    >
                      归档
                    </button>
                  )}
                  <button
                    disabled={templateBusy(template.id)}
                    onClick={() => void openEdit(template)}
                    type="button"
                  >
                    编辑
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      {creating && (
        <div
          className="admin-template-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget !== event.target) return;
            closeTemplateModal();
          }}
        >
          <section
            aria-labelledby="admin-template-modal-title"
            aria-modal="true"
            className="admin-template-modal"
            data-testid="admin-template-modal"
            aria-busy={fieldsLocked}
            onKeyDown={handleTemplateModalKeyDown}
            ref={templateModalRef}
            role="dialog"
          >
            <header className="admin-template-modal-header">
              <div>
                <span>公共模板</span>
                <h2 id="admin-template-modal-title">
                  {editing ? "编辑公共模板" : "新建公共模板"}
                </h2>
              </div>
              <button
                aria-label="关闭公共模板弹窗"
                className="admin-template-modal-close"
                onClick={closeTemplateModal}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="admin-template-modal-fields">
              <label>
                模板标题（1–40 字符）
                <input
                  disabled={fieldsLocked}
                  data-autofocus="true"
                  maxLength={40}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="例如：电商主图工作流"
                  value={draft.title}
                />
              </label>
              <div className="admin-template-field">
                <span>状态</span>
                <GrayMenuSelect
                  disabled={fieldsLocked}
                  ariaLabel="状态"
                  className="admin-template-select"
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      status: value as AdminPublicTemplateStatus,
                    }))
                  }
                  options={[
                    { label: "草稿", value: "draft" },
                    { label: "发布", value: "published" },
                    ...(draft.status === "archived"
                      ? [{ disabled: true, label: "已归档", value: "archived" }]
                      : []),
                  ]}
                  testId="admin-template-status-select"
                  value={draft.status}
                />
              </div>
              <label className="admin-template-field-wide">
                说明（可选）
                <input
                  disabled={fieldsLocked}
                  maxLength={200}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="普通账号看到的模板说明"
                  value={draft.description}
                />
              </label>
              <div className="admin-template-categories admin-template-field-wide">
                <span>分类（可多选）</span>
                <div>
                  {REAL_CATEGORIES.map((category) => (
                    <label key={category}>
                      <input
                        disabled={fieldsLocked}
                        checked={draft.categories.includes(category)}
                        className="admin-compact-checkbox"
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            categories: event.target.checked
                              ? [...current.categories, category]
                              : current.categories.filter(
                                  (item) => item !== category,
                                ),
                          }))
                        }
                        type="checkbox"
                      />
                      <span>{category}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label>
                封面路径（可选）
                <input
                  disabled={fieldsLocked}
                  maxLength={500}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      previewImage: event.target.value,
                    }))
                  }
                  placeholder="/templates/demo.png"
                  value={draft.previewImage}
                />
              </label>
              {!editing && (
                <AdminTemplateSourcePicker key={editor?.sessionId} disabled={fieldsLocked}
                  isBusy={templateBusy} onChange={pickBaseTemplate}
                  value={editor?.read?.kind === "base" ? editor.read.templateId : draft.baseTemplateId} />
              )}
              <label className="admin-template-field-wide">
                模板图 JSON（节点≤500、边≤1000、7 种类型）
                <textarea
                  className="admin-template-graph-json"
                  disabled={fieldsLocked}
                  onChange={(event) => editGraphJson(event.target.value)}
                  placeholder='{"nodes":[...],"edges":[...],"version":1}'
                  spellCheck={false}
                  value={draft.graphJson}
                />
              </label>
            </div>
            {editor?.read && (
              <p className="storage-admin-notice" role="status">正在读取模板内容</p>
            )}
            {editing && (
              <p className="storage-admin-notice">模板图留空会保留原图；只改其他信息不会重写模板图。</p>
            )}
            {fieldsLocked && (
              <p className="storage-admin-notice" role="status">关闭窗口后仍会继续保存</p>
            )}
            {saving && !fieldsLocked && (
              <p className="storage-admin-notice" role="status">「{saving.title}」正在保存，当前模板尚未提交。</p>
            )}
            {editor?.failedRead && (
              <div className="admin-template-modal-actions">
                <button
                  disabled={fieldsLocked || templateBusy(editor.failedRead.templateId)}
                  onClick={() => {
                    const current = editorRef.current;
                    if (current?.sessionId === editor.sessionId && current.failedRead) {
                      void readTemplateGraph(current.sessionId, current.failedRead.templateId, current.failedRead.kind);
                    }
                  }}
                  type="button"
                >
                  重新读取模板内容
                </button>
              </div>
            )}
            {modalError && (
              <p className="auth-error" role="alert">{modalError}</p>
            )}
            <div className="admin-template-modal-actions">
              <button onClick={closeTemplateModal} type="button">
                取消
              </button>
              <button
                className="admin-template-primary"
                disabled={Boolean(saving) || Boolean(editing && busyIds.has(editing)) || (!editing && editor?.read?.kind === "base")}
                onClick={() => void submit()}
                type="button"
              >
                {fieldsLocked ? "保存中" : saving ? "等待上一项保存" : "保存"}
              </button>
            </div>
          </section>
        </div>
      )}
      {archiving && (
        <ConfirmDialog
          confirmLabel="归档"
          danger
          message={`确定要归档公共模板「${archiving.title}」？归档后普通账号不可见，仍可随时恢复；已导入的画布不受影响。`}
          onCancel={() => setArchiving(undefined)}
          onConfirm={() => void archive(archiving)}
          title="确认归档公共模板"
        />
      )}
    </main>
  );
}
