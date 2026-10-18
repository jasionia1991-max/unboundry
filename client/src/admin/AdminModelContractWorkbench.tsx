import { useEffect, useState } from "react";
import { type ModelCapability, type ModelParameterSchema } from "../../../types/modelParameters";
import type {
  ModelContractBinding,
  ModelContractRole,
  ModelExecutionMode,
} from "../../../types/modelExecutionContracts";
import type {
  ModelContractState,
  ModelContractValidation,
  ModelReleaseDocument,
} from "../../../types/modelReleaseRevisions";
import { SettingsPageHeader, settingsDestination } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";
import { AdminModelParameterEditor } from "./AdminModelParameterEditor";

type ModelContractWorkbenchResponse = {
  impact: {
    incompatibleTemplateIds: string[];
    preexistingIncompatibleTemplateIds?: string[];
    templateIds: string[];
  };
  parameterConstraints: ModelParameterSchema;
  paidProviderRequests: 0;
  previews: {
    active?: ModelContractValidation["preview"];
    savedDraft?: ModelContractValidation["preview"];
  };
  state: ModelContractState;
  suggestedDocument: ModelReleaseDocument;
};

function contractModeDescription(mode: ModelExecutionMode) {
  if (mode.id === "text-to-video") return "纯文字生成视频";
  if (mode.id === "first-frame-to-video") return "首帧生成视频";
  if (mode.id === "specialized-code") return "由系统专用适配器管理";
  if (mode.roles.length === 0) return "只使用文字指令";
  return `文字加${mode.roles.map((role) => contractRoleDescription(role.id)).join("、")}`;
}

function contractRoleDescription(roleId: string) {
  const labels: Record<string, string> = {
    "context-audio": "音频上下文",
    "context-image": "图片上下文",
    "context-text": "文字上下文",
    "context-video": "视频上下文",
    "first-frame": "首帧图片",
    "last-frame": "尾帧图片",
    "reference-audio": "参考音频",
    "reference-image": "参考图片",
    "reference-video": "参考视频",
    subject: "主体素材",
  };
  return labels[roleId] ?? "自定义素材用途";
}

export function AdminModelContractWorkbench({
  currentUser,
  modelId,
}: {
  currentUser: AuthUser;
  modelId: string;
}) {
  const [loaded, setLoaded] = useState<ModelContractWorkbenchResponse>();
  const [document, setDocument] = useState<ModelReleaseDocument>();
  const [draftVersion, setDraftVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [conflictSnapshot, setConflictSnapshot] =
    useState<ModelContractWorkbenchResponse>();
  const [showConflictDiff, setShowConflictDiff] = useState(false);
  const [localValidation, setLocalValidation] =
    useState<ModelContractValidation>();
  const [previewTarget, setPreviewTarget] =
    useState<"active" | "page" | "savedDraft">("page");

  const endpoint = `/api/admin/models/${encodeURIComponent(modelId)}/contract`;
  const load = () => jsonRequest<ModelContractWorkbenchResponse>(endpoint)
    .then((result) => {
      setLoaded(result);
      setDocument(
        result.state.draft?.document ??
          result.state.active?.document ??
          result.suggestedDocument,
      );
      setDraftVersion(result.state.draftVersion);
      setDirty(false);
      setConflict(false);
      setConflictSnapshot(undefined);
      setShowConflictDiff(false);
      setLocalValidation(undefined);
      setPreviewTarget("page");
      setError("");
    })
    .catch((caught) => setError(
      caught instanceof Error ? caught.message : "模型合同读取失败",
    ));

  useEffect(() => { void load(); }, [modelId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mutateDocument = (next: ModelReleaseDocument) => {
    setDocument(next);
    setDirty(true);
    setLocalValidation(undefined);
    setNotice("");
  };
  const action = async (
    name: "draft" | "publish" | "restore" | "revoke" | "rollback" | "validate",
    body: Record<string, unknown>,
  ) => {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const result = await jsonRequest<{ validation?: ModelContractValidation }>(
        `${endpoint}/${name}`,
        {
        body: JSON.stringify(body),
        method: "POST",
        },
      );
      setNotice(name === "draft"
        ? "草稿已保存；本次没有调用 Provider。"
        : name === "validate"
          ? "本地验证通过；Provider 请求为 0。"
          : name === "publish"
            ? "新修订已发布，只影响之后新建的任务。"
            : name === "rollback"
              ? "已创建新的回滚修订；运行中任务仍使用原修订。"
              : name === "revoke"
                ? "已停止新任务；已受理任务仍按冻结修订查询。"
                : "已恢复接受新任务。");
      if (name === "validate" && result.validation) {
        setLocalValidation(result.validation);
        setPreviewTarget("page");
      } else {
        await load();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "操作失败";
      setError(message);
      if ((caught as { code?: string }).code === "MODEL_CONTRACT_DRAFT_CONFLICT") {
        setConflict(true);
        const current = await jsonRequest<ModelContractWorkbenchResponse>(endpoint)
          .catch(() => undefined);
        setConflictSnapshot(current);
      }
    } finally {
      setBusy("");
    }
  };

  if (!loaded || !document) {
    return <main className="system-message" role={error ? "alert" : undefined}>
      {error || "正在读取模型合同…"}
    </main>;
  }
  const updateModes = (modes: readonly ModelExecutionMode[]) => mutateDocument({
    ...document,
    executionContract: { ...document.executionContract, modes },
  });
  const updateMode = (index: number, next: ModelExecutionMode) => updateModes(
    document.executionContract.modes.map((mode, candidate) =>
      candidate === index ? next : mode
    ),
  );
  const nextModeId = () => {
    let index = document.executionContract.modes.length + 1;
    while (document.executionContract.modes.some((mode) => mode.id === `mode-${index}`)) {
      index += 1;
    }
    return `mode-${index}`;
  };
  const nextRoleId = (mode: ModelExecutionMode) => {
    let index = mode.roles.length + 1;
    while (mode.roles.some((role) => role.id === `reference-${index}`)) index += 1;
    return `reference-${index}`;
  };
  const sourceForKind = (
    kind: ModelContractBinding["source"]["kind"],
    mode: ModelExecutionMode,
  ): ModelContractBinding["source"] => {
    if (kind === "parameter") return { key: "duration", kind };
    if (kind === "role") return { kind, roleId: mode.roles[0]?.id ?? "reference-1" };
    if (kind === "constant") return { kind, value: "" };
    return { kind };
  };
  const hasSavedDraft = Boolean(loaded.state.draft);
  const savedDraftValidated = Boolean(loaded.state.draft?.validation &&
    loaded.state.draft.draftVersion === draftVersion && !dirty);
  const recommendedDocumentation = loaded.suggestedDocument.documentation[0];
  const currentDocumentation = document.documentation[0];
  const validationGuide = localValidation
    ? "当前页面已通过本地验证；验证没有保存、发布或调用 Provider。"
    : "当前页面可直接本地验证；无需先保存，不会发布，也不会调用 Provider。";
  const previews = {
    active: loaded.previews.active ?? { status: "当前发布版本：无" },
    page: localValidation?.preview ?? { status: "当前页面尚未本地验证" },
    savedDraft: loaded.previews.savedDraft ?? { status: "已保存草稿：无" },
  };
  const canPublish = savedDraftValidated && !dirty;
  return (
    <main
      className="admin-page model-contract-page"
      data-testid="model-contract-workbench"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
    >
      <SettingsPageHeader
        browserTitle="模型合同工作台"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="模型合同工作台"
        userId={currentUser.id}
      />
      <div className="model-contract-layout">
        <nav aria-label="合同区块" className="model-contract-nav">
          <button onClick={() => window.location.href = settingsDestination("/admin/models", currentUser.id)} type="button">← 返回模型列表</button>
          {[
            "基本信息与官方文档", "输入模式", "素材角色与数量", "模型参数",
            "请求绑定", "任务、状态、结果与错误", "验证与发布", "版本历史",
          ].map((label, index) => <a href={`#contract-section-${index + 1}`} key={label}>{label}</a>)}
        </nav>
        <div className="model-contract-editor">
          <header className="model-contract-heading">
            <div>
              <span>{document.capability.toUpperCase()}</span>
              <h1>{document.providerModelId}</h1>
              <p>当前页面：{dirty ? "有未保存修改" : "无未保存修改"} · 已保存草稿：{hasSavedDraft ? `版本 ${draftVersion}` : "无"} · 当前发布版本：{loaded.state.active?.revisionNumber ?? "无"}</p>
            </div>
            <b data-status={loaded.state.revoked ? "danger" : loaded.state.active ? "success" : "warning"}>
              {loaded.state.revoked ? "已停止新任务" : loaded.state.active ? "已发布" : "未发布"}
            </b>
          </header>
          <section id="contract-section-1">
            <h2>基本信息与官方文档</h2>
            <div className="model-contract-grid">
              <div className="model-contract-readonly"><span>Provider模型ID</span><output>{document.providerModelId}</output></div>
              <div className="model-contract-readonly"><span>证据级别</span><output>{document.evidence}</output></div>
              <label className="model-contract-wide"><span>官方文档</span><input
                aria-describedby="contract-doc-help"
                onChange={(event) => mutateDocument({
                  ...document,
                  documentation: event.target.value.trim()
                    ? [{ checkedAt: new Date().toISOString().slice(0, 10), url: event.target.value }]
                    : [],
                })}
                placeholder="https://官方文档地址"
                value={document.documentation[0]?.url ?? ""}
              /></label>
              <small id="contract-doc-help">这里只保存公开来源，不允许密钥、Cookie或签名地址。</small>
              {!currentDocumentation && recommendedDocumentation && <div className="model-contract-doc-suggestion">
                <span>已找到可核验的官方来源，但尚未写入当前发布版本。</span>
                <a href={recommendedDocumentation.url} rel="noreferrer" target="_blank">打开官方文档</a>
                <button onClick={() => mutateDocument({
                  ...document,
                  documentation: [recommendedDocumentation],
                })} type="button">填入草稿</button>
              </div>}
              {!currentDocumentation && !recommendedDocumentation && <div className="model-contract-doc-suggestion" data-status="warning">
                尚未找到能核验到具体模型的官方文档，因此没有用平台首页或搜索结果冒充。
              </div>}
            </div>
          </section>
          <section id="contract-section-2">
            <div className="model-contract-section-heading"><div><h2>输入模式</h2><small>模式决定“只输入文字”或“文字加素材”等合法组合。标识供系统匹配，不会展示给普通用户。</small></div><button onClick={() => {
              const id = nextModeId();
              updateModes([...document.executionContract.modes, {
                bindings: [
                  { source: { kind: "model-id" }, target: { location: "json", path: "model" } },
                  { source: { kind: "prompt" }, target: { location: "json", path: "prompt" } },
                ],
                id,
                prompt: "required",
                roles: [],
              }]);
            }} type="button">新增模式</button></div>
            <div className="model-contract-mode-list">
              {document.executionContract.modes.map((mode, modeIndex) => (
                <article key={`${mode.id}-${modeIndex}`}>
                  <div className="model-contract-mode-name"><strong>{contractModeDescription(mode)}</strong><small>系统标识已自动管理</small></div>
                  <label><span>文字指令</span><select value={mode.prompt} onChange={(event) => updateMode(modeIndex, { ...mode, prompt: event.target.value as "optional" | "required" })}><option value="required">必填</option><option value="optional">可选</option></select></label>
                  <span>素材角色：{mode.roles.length}</span>
                  <button disabled={document.executionContract.modes.length === 1} onClick={() => updateModes(document.executionContract.modes.filter((_, candidate) => candidate !== modeIndex))} type="button">删除模式</button>
                </article>
              ))}
            </div>
          </section>
          <section id="contract-section-3">
            <div className="model-contract-section-heading"><div><h2>素材角色与数量</h2><small>角色表示素材用途，例如“首帧”不是素材ID。最少/最多数量决定用户必须连接几份素材。</small></div></div>
            {document.executionContract.modes.map((mode, modeIndex) => <div className="model-contract-subsection" key={`roles-${mode.id}-${modeIndex}`}>
              <div className="model-contract-section-heading"><h3>{contractModeDescription(mode)}</h3><button onClick={() => {
                const role: ModelContractRole = { id: nextRoleId(mode), kind: "image", maxItems: 1, minItems: 1, ordered: true, shape: "url" };
                updateMode(modeIndex, { ...mode, roles: [...mode.roles, role] });
              }} type="button">新增角色</button></div>
              {mode.roles.length === 0 ? <p>此模式不接收素材。</p> : mode.roles.map((role, roleIndex) => <div className="model-contract-grid model-contract-repeat" key={`${role.id}-${roleIndex}`}>
                <div className="model-contract-readonly"><span>素材用途</span><output>{contractRoleDescription(role.id)}</output></div>
                <label><span>素材类型</span><select value={role.kind} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, kind: event.target.value as ModelCapability } : item) })}>{["text", "image", "video", "audio"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
                <label><span>最少数量</span><input min="0" type="number" value={role.minItems} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, minItems: Number(event.target.value) } : item) })} /></label>
                <label><span>最多数量</span><input min="0" type="number" value={role.maxItems} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, maxItems: Number(event.target.value) } : item) })} /></label>
                <label><span>值形态</span><select value={role.shape} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, shape: event.target.value as "file-id" | "url" } : item) })}><option value="url">URL</option><option value="file-id">file ID</option></select></label>
                <label className="model-contract-check"><input className="admin-compact-checkbox" checked={role.ordered} onChange={(event) => updateMode(modeIndex, { ...mode, roles: mode.roles.map((item, candidate) => candidate === roleIndex ? { ...item, ordered: event.target.checked } : item) })} type="checkbox" /><span>保留输入顺序</span></label>
                <button onClick={() => updateMode(modeIndex, {
                  ...mode,
                  bindings: mode.bindings.filter((item) => item.source.kind !== "role" || item.source.roleId !== role.id),
                  roles: mode.roles.filter((_, candidate) => candidate !== roleIndex),
                })} type="button">删除角色</button>
              </div>)}
            </div>)}
          </section>
          <section id="contract-section-4"><h2>模型参数</h2><AdminModelParameterEditor capability={document.capability} constraints={loaded.parameterConstraints} onChange={(capabilitySchema) => mutateDocument({ ...document, capabilitySchema })} providerProtocol={document.providerProtocol} schema={document.capabilitySchema} /></section>
          <section id="contract-section-5"><h2>请求绑定</h2>{document.executionContract.modes.map((mode, modeIndex) => <div className="model-contract-subsection" key={`bindings-${mode.id}-${modeIndex}`}><div className="model-contract-section-heading"><h3>{contractModeDescription(mode)}</h3><button onClick={() => updateMode(modeIndex, { ...mode, bindings: [...mode.bindings, { source: { key: "duration", kind: "parameter" }, target: { location: "json", path: "params.duration" }, transform: "string" }] })} type="button">新增绑定</button></div><div className="model-contract-bindings">{mode.bindings.map((item, bindingIndex) => <div className="model-contract-binding-row" key={bindingIndex}>
            <select aria-label="来源" value={item.source.kind} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: sourceForKind(event.target.value as ModelContractBinding["source"]["kind"], mode) } : binding) })}>{["model-id", "prompt", "parameter", "role", "constant", "task-id"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
            {item.source.kind === "parameter" && <input aria-label="参数键" value={item.source.key} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: { ...item.source, key: event.target.value } } : binding) })} />}
            {item.source.kind === "role" && <select aria-label="素材用途" value={item.source.roleId} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: { ...item.source, roleId: event.target.value } } : binding) })}>{mode.roles.map((role) => <option key={role.id} value={role.id}>{contractRoleDescription(role.id)}</option>)}</select>}
            {item.source.kind === "constant" && <input aria-label="常量" value={String(item.source.value)} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, source: { ...item.source, value: event.target.value } } : binding) })} />}
            <span aria-hidden="true">→</span>
            <select aria-label="转换" value={item.transform ?? ""} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, ...(event.target.value ? { transform: event.target.value as ModelContractBinding["transform"] } : { transform: undefined }) } : binding) })}><option value="">不转换</option>{["array", "boolean", "number", "omit-empty", "string"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <select aria-label="目标位置" value={item.target.location} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, target: { ...item.target, location: event.target.value as "form" | "json" | "query" } } : binding) })}><option value="json">JSON</option><option value="query">Query</option><option value="form">Form</option></select>
            <input aria-label="目标字段" value={item.target.path} onChange={(event) => updateMode(modeIndex, { ...mode, bindings: mode.bindings.map((binding, candidate) => candidate === bindingIndex ? { ...binding, target: { ...item.target, path: event.target.value } } : binding) })} />
            <button onClick={() => updateMode(modeIndex, { ...mode, bindings: mode.bindings.filter((_, candidate) => candidate !== bindingIndex) })} type="button">删除</button>
          </div>)}</div></div>)}</section>
          <section id="contract-section-6"><h2>任务、状态、结果与错误</h2><div className="model-contract-grid">
            <div className="model-contract-readonly"><span>创建方法</span><output>{document.executionContract.create.method}</output></div>
            <label><span>创建相对路径</span><input value={document.executionContract.create.path} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, create: { ...document.executionContract.create, path: event.target.value } } })} /></label>
            <label><span>创建task ID字段</span><input value={document.executionContract.create.taskIdPath ?? ""} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, create: { ...document.executionContract.create, ...(event.target.value ? { taskIdPath: event.target.value } : { taskIdPath: undefined }) } } })} /></label>
            {document.executionContract.poll
              ? <label><span>查询相对路径</span><input value={document.executionContract.poll.path} onChange={(event) => document.executionContract.poll && mutateDocument({ ...document, executionContract: { ...document.executionContract, poll: { ...document.executionContract.poll, path: event.target.value } } })} /></label>
              : <div className="model-contract-readonly"><span>查询相对路径</span><output>代码connector管理</output></div>}
            <label><span>结果字段</span><input value={document.executionContract.result.resultPath} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, result: { ...document.executionContract.result, resultPath: event.target.value } } })} /></label>
            {document.executionContract.result.states && (["running", "succeeded", "failed"] as const).map((state) => <label key={state}><span>{state}状态（逗号分隔）</span><input value={document.executionContract.result.states![state].join(", ")} onChange={(event) => mutateDocument({ ...document, executionContract: { ...document.executionContract, result: { ...document.executionContract.result, states: { ...document.executionContract.result.states!, [state]: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } } } })} /></label>)}
            <div className="model-contract-readonly"><span>错误映射</span><output>代码安全分类管理；管理端不能注入错误逻辑</output></div>
            <div className="model-contract-readonly"><span>取消合同</span><output>未开放；需先交付正式connector</output></div>
            <div className="model-contract-readonly"><span>fallback合同</span><output>未开放；禁止管理端静默切换Provider</output></div>
          </div></section>
          <section id="contract-section-7"><h2>验证与发布</h2><p>受影响模板 {loaded.impact.templateIds.length} 个；不兼容 {loaded.impact.incompatibleTemplateIds.length} 个。保存、验证和发布本身均不调用 Provider。</p><p className="model-contract-validation-guide" role="status">{validationGuide}</p><div className="model-contract-preview-panel"><div><strong>三份脱敏只读预览</strong><span>只显示请求方法、相对路径和假数据；不含密钥、真实媒体或可编辑 JSON。</span></div><div aria-label="选择预览版本" className="model-contract-preview-tabs" role="group"><button aria-pressed={previewTarget === "page"} onClick={() => setPreviewTarget("page")} type="button">当前页面</button><button aria-pressed={previewTarget === "savedDraft"} onClick={() => setPreviewTarget("savedDraft")} type="button">已保存草稿</button><button aria-pressed={previewTarget === "active"} onClick={() => setPreviewTarget("active")} type="button">当前发布版本</button></div><pre aria-live="polite" id="model-contract-preview">{JSON.stringify(previews[previewTarget], null, 2)}</pre></div></section>
          <section id="contract-section-8"><h2>版本历史</h2><div className="model-contract-history">{[...loaded.state.history].reverse().map((revision) => <article key={revision.revisionId}><div><strong>修订 {revision.revisionNumber}</strong><span>{new Date(revision.createdAt).toLocaleString()}</span></div><button disabled={revision.revisionId === loaded.state.active?.revisionId || busy === "rollback"} onClick={() => void action("rollback", { targetRevisionId: revision.revisionId })} type="button">回滚到此版本</button></article>)}</div></section>
        </div>
        <aside className="model-contract-summary" aria-label="合同实时摘要">
          <h2>实时摘要</h2>
          <dl><div><dt>运行方式</dt><dd>{document.runtime === "declarative" ? "声明式合同" : document.runtime === "blocked" ? "无证据，已阻断" : "代码专用connector"}</dd></div><div><dt>证据</dt><dd>{document.evidence}</dd></div><div><dt>模板影响</dt><dd>{loaded.impact.templateIds.length}</dd></div><div><dt>Provider调用</dt><dd>0</dd></div></dl>
          <div className="model-contract-summary-preview"><span>当前页面预览</span><b>{localValidation ? "可查看" : "等待验证"}</b></div>
        </aside>
      </div>
      {(notice || error) && <p className="model-contract-feedback" data-status={error ? "error" : "success"} role={error ? "alert" : "status"}>{error || notice}</p>}
      {conflict && <div className="model-contract-conflict" role="alert"><strong>草稿发生并发冲突，没有覆盖另一位管理员。</strong><button disabled={!conflictSnapshot} onClick={() => setShowConflictDiff((current) => !current)} type="button">{showConflictDiff ? "隐藏差异" : "查看差异"}</button><button onClick={() => void load()} type="button">重新加载</button><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(document, null, 2))} type="button">复制未保存内容</button>{showConflictDiff && conflictSnapshot && <pre>{JSON.stringify({ serverDraftVersion: conflictSnapshot.state.draftVersion, serverDocument: conflictSnapshot.state.draft?.document ?? conflictSnapshot.suggestedDocument, unsavedDraftVersion: draftVersion, unsavedDocument: document }, null, 2)}</pre>}</div>}
      <div className="model-contract-actions" aria-label="合同操作">
        <button disabled={Boolean(busy) || (!dirty && Boolean(loaded.state.draft))} onClick={() => void action("draft", { document, expectedDraftVersion: draftVersion })} type="button">{busy === "draft" ? "保存中…" : "保存草稿"}</button>
        <span className="model-contract-action-guide">{validationGuide}</span>
        <button disabled={Boolean(busy)} onClick={() => void action("validate", { document })} title={validationGuide} type="button">本地验证当前页面｜零写入</button>
        <button disabled={!canPublish || Boolean(busy)} onClick={() => {
          if (window.confirm(`发布修订 ${draftVersion}？只影响新任务，运行中任务继续使用旧修订；受影响模板 ${loaded.impact.templateIds.length} 个；发布不会调用 Provider。`)) void action("publish", { expectedDraftVersion: draftVersion });
        }} type="button">发布</button>
        <button className="model-contract-warning" disabled={!loaded.state.history.length || Boolean(busy)} onClick={() => void action(loaded.state.revoked ? "restore" : "revoke", {})} type="button">{loaded.state.revoked ? "恢复新任务" : "停止新任务"}</button>
      </div>
    </main>
  );
}
