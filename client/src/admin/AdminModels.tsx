import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { GrayMenuSelect } from "../ui/GrayMenuSelect";
import {
  defaultParameterSchema,
  knownModelParameterSchema,
  providerParameterSchema,
  type ModelParameterSchema,
} from "../../../types/modelParameters";
import { providerProtocolSupportsCapability, type ProviderProtocol } from "../../../types/relayProtocols";
import { SettingsPageHeader, settingsDestination } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";
import { AdminModelParameterEditor } from "./AdminModelParameterEditor";
import { type AdminModel, type ProviderDriver } from "./adminTypes";
import { providerProtocolLabels, relayProtocolsForCapability } from "./providerCatalog";

export function AdminModels({ currentUser }: { currentUser: AuthUser }) {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [providers, setProviders] = useState<
    Array<{ displayName: string; driver: ProviderDriver; id: string; status: string }>
  >([]);
  const [providerProfileId, setProviderProfileId] = useState("");
  const [providerProtocol, setProviderProtocol] = useState<ProviderProtocol | "">(
    "",
  );
  const [capability, setCapability] =
    useState<AdminModel["capability"]>("image");
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [providerModelId, setProviderModelId] = useState("");
  const [publish, setPublish] = useState(false);
  const [parameterSchema, setParameterSchema] = useState<ModelParameterSchema>(
    defaultParameterSchema("image"),
  );
  const [editingParameterModelId, setEditingParameterModelId] = useState("");
  const [editingParameterSchema, setEditingParameterSchema] =
    useState<ModelParameterSchema>();
  const [editingParameterProviderProfileId, setEditingParameterProviderProfileId] =
    useState("");
  const [editingParameterProviderProtocol, setEditingParameterProviderProtocol] =
    useState<ProviderProtocol | "">("");
  const [showArchived, setShowArchived] = useState(false);
  const [lifecycleBusyId, setLifecycleBusyId] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  const [modelLifecycleError, setModelLifecycleError] = useState("");
  const [error, setError] = useState("");
  const capabilityMenuRef = useRef<HTMLDivElement>(null);

  const load = () =>
    jsonRequest<{
      models: AdminModel[];
      providers: Array<{
        displayName: string;
        driver: ProviderDriver;
        id: string;
        status: string;
      }>;
    }>("/api/admin/models")
      .then(({ models: result, providers: providerResult }) => {
        const configured = providerResult.filter(
          (provider) => provider.id !== "provider-unconfigured",
        );
        setModels(result);
        setProviders(configured);
        setProviderProfileId((current) => current || configured[0]?.id || "");
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "模型列表读取失败"),
      );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!capabilityOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !capabilityMenuRef.current?.contains(event.target)
      ) {
        setCapabilityOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCapabilityOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [capabilityOpen]);

  const selectedProvider = providers.find((provider) => provider.id === providerProfileId);
  const providerMismatch = (modelId: string, driver?: ProviderDriver) =>
    /^doubao-(?:seed|seedance)-/i.test(modelId) && driver !== "volcengine-ark";
  const selectedProviderMismatch = providerMismatch(
    providerModelId,
    selectedProvider?.driver,
  );
  const selectedProviderUsesRelay =
    selectedProvider?.driver === "multi-protocol-relay";
  const relayProtocolReady =
    !selectedProviderUsesRelay ||
    (providerProtocol !== "" &&
      providerProtocol !== "native" &&
      providerProtocolSupportsCapability(providerProtocol, capability));
  const recommendedParameterSchema = (
    nextCapability = capability,
    nextProviderModelId = providerModelId,
    nextProvider = selectedProvider,
  ) => knownModelParameterSchema({
    capability: nextCapability,
    providerDriver: nextProvider?.driver,
    providerModelId: nextProviderModelId,
  });

  const createModel = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!providerProfileId) {
      setError("请先到“平台连接”保存一个平台账号");
      return;
    }
    if (selectedProviderMismatch) {
      setError("这个豆包模型必须选择火山方舟连接");
      return;
    }
    if (!relayProtocolReady) {
      setError("请为多协议中转模型明确选择调用协议");
      return;
    }
    try {
      await jsonRequest("/api/admin/models", {
        body: JSON.stringify({
          capability,
          displayName,
          isDefault: false,
          parameterSchema,
          providerModelId,
          providerProfileId,
          providerProtocol: selectedProviderUsesRelay
            ? providerProtocol
            : "native",
          sortOrder: 100,
          status: publish ? "published" : "draft",
        }),
        method: "POST",
      });
      setDisplayName("");
      setProviderModelId("");
      setPublish(false);
      setProviderProtocol(selectedProviderUsesRelay ? "" : "native");
      setParameterSchema(defaultParameterSchema(capability));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型创建失败");
    }
  };

  const updateModel = async (
    model: AdminModel,
    update: Partial<
      Pick<
        AdminModel,
        "isDefault" | "parameterSchema" | "providerProfileId" | "providerProtocol" | "status"
      >
    >,
  ) => {
    setError("");
    try {
      await jsonRequest(`/api/admin/models/${encodeURIComponent(model.id)}`, {
        body: JSON.stringify(update),
        method: "PATCH",
      });
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型修改失败");
      return false;
    }
  };

  const updateModelLifecycle = async (
    model: AdminModel,
    action: "archive" | "delete" | "restore",
  ) => {
    if (
      action === "delete" &&
      !window.confirm(
        `永久删除“${model.displayName}”？此操作只允许未发布且没有任何画布或任务引用的草稿，删除后不能恢复。`,
      )
    ) {
      return;
    }
    setLifecycleBusyId(model.id);
    setModelLifecycleError("");
    setModelNotice("");
    try {
      if (action === "delete") {
        await jsonRequest(`/api/admin/models/${encodeURIComponent(model.id)}`, {
          method: "DELETE",
        });
      } else {
        await jsonRequest(
          `/api/admin/models/${encodeURIComponent(model.id)}/${action}`,
          { method: "POST" },
        );
      }
      if (editingParameterModelId === model.id) {
        setEditingParameterModelId("");
        setEditingParameterSchema(undefined);
        setEditingParameterProviderProfileId("");
        setEditingParameterProviderProtocol("");
      }
      setModelNotice(
        action === "archive"
          ? `“${model.displayName}”已归档，旧画布和历史记录仍会保留。`
          : action === "restore"
            ? `“${model.displayName}”已恢复，仍沿用原模型ID。`
            : `“${model.displayName}”草稿已永久删除。`,
      );
      await load();
    } catch (caught) {
      setModelLifecycleError(
        caught instanceof Error ? caught.message : "模型生命周期操作失败",
      );
    } finally {
      setLifecycleBusyId("");
    }
  };

  const saveModelParameters = async (model: AdminModel) => {
    if (!editingParameterSchema) return;
    const editingProvider = providers.find(
      (provider) => provider.id === editingParameterProviderProfileId,
    );
    if (
      editingProvider?.driver === "multi-protocol-relay" &&
      (editingParameterProviderProtocol === "" ||
        editingParameterProviderProtocol === "native" ||
        !providerProtocolSupportsCapability(
          editingParameterProviderProtocol,
          model.capability,
        ))
    ) {
      setError("请为多协议中转模型明确选择调用协议");
      return;
    }
    const constraints = providerParameterSchema({
      capability: model.capability,
      providerDriver: editingProvider?.driver,
      providerModelId: model.providerModelId,
    });
    const parameterSchema = constraints
      ? {
          ...editingParameterSchema,
          fields: editingParameterSchema.fields.filter((field) =>
            constraints.fields.some((allowed) => allowed.key === field.key),
          ),
        }
      : editingParameterSchema;
    const saved = await updateModel(model, {
      parameterSchema,
      providerProfileId: editingParameterProviderProfileId || model.providerProfileId,
      providerProtocol:
        editingProvider?.driver === "multi-protocol-relay"
          ? editingParameterProviderProtocol as ProviderProtocol
          : "native",
    });
    if (!saved) return;
    setEditingParameterModelId("");
    setEditingParameterSchema(undefined);
    setEditingParameterProviderProfileId("");
    setEditingParameterProviderProtocol("");
  };

  const labels: Record<AdminModel["capability"], string> = {
    audio: "音频",
    image: "图片",
    text: "文字",
    video: "视频",
  };
  const providerLabels: Record<ProviderDriver, string> = {
    mureka: "Mureka",
    "multi-protocol-relay": "多协议中转站",
    "openai-compatible": "OpenAI兼容平台",
    openrouter: "OpenRouter",
    "volcengine-ark": "火山方舟",
  };
  const capabilityOptions: Array<{
    label: string;
    value: AdminModel["capability"];
  }> = [
    { label: "文字节点", value: "text" },
    { label: "图片节点", value: "image" },
    { label: "视频节点", value: "video" },
    { label: "音频节点", value: "audio" },
  ];
  const archivedCount = models.filter((model) => model.archived).length;
  const visibleModels = models.filter((model) => showArchived || !model.archived);

  return (
    <main className="admin-page model-admin-page" data-testid="admin-models-page">
      <SettingsPageHeader
        browserTitle="模型中心"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="管理员模型中心"
        userId={currentUser.id}
      />
      <div className="model-safety-banner">
        <div>
          <strong>当前只配置用户可见模型</strong>
          <span>
            模型显示、平台连接、单次费用和生成安全开关彼此独立；
            保护条件不完整时不会提交真实生成。
          </span>
        </div>
        <button
          onClick={() => {
            window.location.href = settingsDestination(
              "/admin/providers",
              currentUser.id,
            );
          }}
          type="button"
        >
          管理平台连接
        </button>
      </div>
      <div className="admin-layout">
        <section className="admin-card">
          <h1>添加模型</h1>
          <p>
            显示名称给普通用户看；模型归属由所选商业平台连接固定，技术 Driver 与调用协议另行显示。
          </p>
          <form onSubmit={createModel}>
            <div className="model-provider-choice">
              <span>选择平台连接</span>
              {providers.length === 0 ? (
                <button
                  onClick={() => {
                    window.location.href = settingsDestination(
                      "/admin/providers",
                      currentUser.id,
                    );
                  }}
                  type="button"
                >
                  先添加平台连接
                </button>
              ) : (
                <div>
                  {providers.map((provider) => (
                    <button
                      aria-pressed={providerProfileId === provider.id}
                      data-selected={
                        providerProfileId === provider.id ? "true" : "false"
                      }
                      key={provider.id}
                      onClick={() => {
                        setProviderProfileId(provider.id);
                        setProviderProtocol(
                          provider.driver === "multi-protocol-relay"
                            ? ""
                            : "native",
                        );
                        setParameterSchema(recommendedParameterSchema(
                          capability,
                          providerModelId,
                          provider,
                        ));
                      }}
                      type="button"
                    >
                      {provider.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div
              className="admin-gray-select"
              data-open={capabilityOpen ? "true" : "false"}
              ref={capabilityMenuRef}
            >
              <button
                aria-expanded={capabilityOpen}
                aria-haspopup="listbox"
                aria-label="节点类型"
                className="admin-gray-select-trigger"
                onClick={() => setCapabilityOpen((open) => !open)}
                type="button"
              >
                <span>
                  {capabilityOptions.find(
                    (option) => option.value === capability,
                  )?.label}
                </span>
                <span aria-hidden="true" className="admin-gray-select-chevron" />
              </button>
              {capabilityOpen && (
                <div
                  aria-label="节点类型选项"
                  className="admin-gray-select-menu"
                  role="listbox"
                >
                  {capabilityOptions.map((option) => (
                    <button
                      aria-selected={option.value === capability}
                      className="admin-gray-select-option"
                      data-selected={
                        option.value === capability ? "true" : "false"
                      }
                      key={option.value}
                      onClick={() => {
                        setCapability(option.value);
                        if (
                          selectedProviderUsesRelay &&
                          providerProtocol !== "" &&
                          !providerProtocolSupportsCapability(
                            providerProtocol,
                            option.value,
                          )
                        ) {
                          setProviderProtocol("");
                        }
                        setParameterSchema(recommendedParameterSchema(
                          option.value,
                          providerModelId,
                        ));
                        setCapabilityOpen(false);
                      }}
                      role="option"
                      type="button"
                    >
                      <span>{option.label}</span>
                      {option.value === capability && (
                        <span aria-hidden="true">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedProviderUsesRelay && (
              <label className="model-provider-protocol">
                <span>调用协议</span>
                <GrayMenuSelect
                  ariaLabel="调用协议"
                  onChange={(value) =>
                    setProviderProtocol(value as ProviderProtocol | "")
                  }
                  options={relayProtocolsForCapability(capability).map(
                    (protocol) => ({
                      label: providerProtocolLabels[protocol],
                      value: protocol,
                    }),
                  )}
                  placeholder="请明确选择调用协议"
                  value={providerProtocol}
                />
                <small>协议由管理员明确配置，不根据模型名称猜测。</small>
              </label>
            )}
            {selectedProvider && (
              <p className="model-provider-identity-note">
                商业平台：{selectedProvider.displayName} · 技术 Driver：
                {providerLabels[selectedProvider.driver]}
                {selectedProviderUsesRelay && providerProtocol
                  ? ` · 调用协议：${providerProtocolLabels[providerProtocol]}`
                  : ""}
              </p>
            )}
            <input
              maxLength={80}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="用户看到的模型名称"
              required
              value={displayName}
            />
            <input
              maxLength={160}
              onChange={(event) => {
                const nextModelId = event.target.value;
                setProviderModelId(nextModelId);
                const arkProvider = providers.find(
                  (provider) => provider.driver === "volcengine-ark",
                );
                if (/^doubao-(?:seed|seedance)-/i.test(nextModelId) && arkProvider) {
                  setProviderProfileId(arkProvider.id);
                  setProviderProtocol("native");
                  setParameterSchema(knownModelParameterSchema({
                    capability,
                    providerDriver: arkProvider.driver,
                    providerModelId: nextModelId,
                  }));
                }
              }}
              placeholder="内部模型编号"
              required
              value={providerModelId}
            />
            {selectedProviderMismatch && (
              <div className="model-provider-warning" role="alert">
                这个内部编号属于火山方舟，请改选火山方舟连接。
              </div>
            )}
            <div className="admin-model-parameter-preset">
              <span>参数不会直接发送平台内部字段；先使用推荐值，再按模型能力修改。</span>
              <button
                onClick={() => setParameterSchema(recommendedParameterSchema())}
                type="button"
              >
                载入推荐参数
              </button>
            </div>
            <AdminModelParameterEditor
              capability={capability}
              constraints={providerParameterSchema({
                capability,
                providerDriver: selectedProvider?.driver,
                providerModelId,
              })}
              onChange={setParameterSchema}
              providerProtocol={providerProtocol}
              schema={parameterSchema}
            />
            <label className="model-publish-check">
              <input
                className="admin-compact-checkbox"
                checked={publish}
                disabled={!providerProfileId}
                onChange={(event) => setPublish(event.target.checked)}
                type="checkbox"
              />
              <span>创建后立即发布给普通用户</span>
            </label>
            <button
              disabled={
                !providerProfileId || selectedProviderMismatch || !relayProtocolReady
              }
              type="submit"
            >
              保存模型
            </button>
          </form>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </section>
        <section className="admin-card model-list">
          <div className="model-list-heading">
            <h2>节点可用模型</h2>
            <button
              aria-pressed={showArchived}
              disabled={!showArchived && archivedCount === 0}
              onClick={() => setShowArchived((current) => !current)}
              type="button"
            >
              {showArchived ? "隐藏归档" : `显示归档（${archivedCount}）`}
            </button>
          </div>
          {modelNotice && (
            <p className="model-lifecycle-feedback" data-status="success" role="status">
              {modelNotice}
            </p>
          )}
          {modelLifecycleError && (
            <p className="model-lifecycle-feedback" data-status="error" role="alert">
              {modelLifecycleError}
            </p>
          )}
          {visibleModels.length === 0 && (
            <div className="model-list-empty" data-testid="model-list-empty">
              <strong>{models.length ? "当前没有日常管理模型" : "暂无已配置模型"}</strong>
              <span>
                {models.length
                  ? "归档模型仍保留旧画布和历史关系，可通过上方按钮查看并恢复。"
                  : "请在左侧添加真实要使用的模型。发布前，普通用户不会看到任何模型。"}
              </span>
            </div>
          )}
          {visibleModels.map((model) => (
            <article data-archived={model.archived ? "true" : "false"} key={model.id}>
              <div className="model-list-main">
                <div>
                  <span className="model-capability">
                    {labels[model.capability]}
                  </span>
                  <strong>{model.displayName}</strong>
                  {model.isDefault && <b>默认</b>}
                  {model.archived && <b className="model-archived-badge">已归档</b>}
                </div>
                <small>
                  内部编号：{model.providerModelId}
                  <br />
                  {providerLabels[model.providerDriver]}（{model.providerName}） ·{" "}
                  {model.providerConnected ? "Provider已连接" : "Provider未连接"}
                  {model.providerDriver === "multi-protocol-relay" && (
                    <>
                      <br />
                      调用协议：
                      {model.providerProtocol
                        ? providerProtocolLabels[model.providerProtocol]
                        : "未设置（不可生成）"}
                    </>
                  )}
                  <br />
                  可调参数：
                  {model.parameterSchema?.fields.length
                    ? model.parameterSchema.fields.map((field) => field.label).join("、")
                    : model.parameterSchema
                      ? "无"
                      : "合同无效（已阻止生成）"}
                  <br />
                  合同：{model.contract?.status === "published"
                    ? `已发布修订 ${model.contract.activeRevision}`
                    : model.contract?.status === "revoked"
                      ? "已停止新任务"
                      : model.contract?.status === "draft"
                        ? "草稿"
                        : "尚未建立"}
                  {model.contract?.evidence ? ` · ${model.contract.evidence}` : ""}
                  {model.archived && model.references && (
                    <>
                      <br />
                      保留关系：画布{model.references.canvasDocuments}个 · 历史任务
                      {model.references.tasks}条 · 运行中{model.references.activeTasks}条
                    </>
                  )}
                </small>
                {providerMismatch(
                  model.providerModelId,
                  providers.find((provider) => provider.id === model.providerProfileId)?.driver,
                ) && (
                  <div className="model-provider-warning" role="alert">
                    平台选择错误：这个豆包模型应连接火山方舟。
                  </div>
                )}
                {!model.archived && !model.canDelete && model.deleteBlockedReason && (
                  <div
                    className="model-delete-protection"
                    title={model.deleteBlockedReason}
                  >
                    删除保护：{model.deleteBlockedReason}
                  </div>
                )}
              </div>
              <div className="model-list-actions">
                <button
                  onClick={() => window.location.href = settingsDestination(
                    `/admin/models/${model.id}/contract`,
                    currentUser.id,
                  )}
                  type="button"
                >
                  合同工作台
                </button>
                {model.archived ? (
                  <>
                    <button
                      disabled={lifecycleBusyId === model.id}
                      onClick={() =>
                        void updateModelLifecycle(model, "restore")
                      }
                      type="button"
                    >
                      {lifecycleBusyId === model.id ? "处理中…" : "恢复"}
                    </button>
                    {model.canDelete && (
                      <button
                        className="model-danger-action"
                        disabled={lifecycleBusyId === model.id}
                        onClick={() =>
                          void updateModelLifecycle(model, "delete")
                        }
                        type="button"
                      >
                        永久删除
                      </button>
                    )}
                    {!model.canDelete && model.deleteBlockedReason && (
                      <span
                        className="model-lifecycle-reason"
                        title={model.deleteBlockedReason}
                      >
                        保留原因：{model.deleteBlockedReason}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        void updateModel(model, {
                          status:
                            model.status === "published" ? "disabled" : "published",
                        })
                      }
                      type="button"
                    >
                      {model.status === "published"
                        ? `停用（${model.providerName}）`
                        : `发布到${model.providerName}`}
                    </button>
                    <button
                      disabled={
                        model.status !== "published" || model.isDefault
                      }
                      onClick={() =>
                        void updateModel(model, { isDefault: true })
                      }
                      type="button"
                    >
                      设为默认
                    </button>
                    <button
                      aria-expanded={editingParameterModelId === model.id}
                      disabled={!model.parameterSchema}
                      onClick={() => {
                        if (editingParameterModelId === model.id) {
                          setEditingParameterModelId("");
                          setEditingParameterSchema(undefined);
                          setEditingParameterProviderProfileId("");
                          setEditingParameterProviderProtocol("");
                        } else {
                          setEditingParameterModelId(model.id);
                          setEditingParameterSchema(model.parameterSchema);
                          setEditingParameterProviderProfileId(model.providerProfileId);
                          setEditingParameterProviderProtocol(
                            model.providerProtocol ??
                              (model.providerDriver === "multi-protocol-relay"
                                ? ""
                                : "native"),
                          );
                        }
                      }}
                      type="button"
                    >
                      {editingParameterModelId === model.id ? "收起参数" : "参数设置"}
                    </button>
                    <button
                      disabled={
                        lifecycleBusyId === model.id ||
                        model.status === "published" ||
                        model.isDefault
                      }
                      onClick={() =>
                        void updateModelLifecycle(model, "archive")
                      }
                      title={
                        model.isDefault
                          ? "请先明确设置另一个默认模型"
                          : model.status === "published"
                            ? "请先停用模型再归档"
                            : "归档后从日常列表隐藏，但保留旧画布和历史关系"
                      }
                      type="button"
                    >
                      {lifecycleBusyId === model.id ? "处理中…" : "归档"}
                    </button>
                  </>
                )}
              </div>
              {!model.archived && editingParameterModelId === model.id && editingParameterSchema && (
                <div className="admin-model-parameter-edit">
                  <div className="admin-model-provider-edit">
                    <strong>商业平台（创建后锁定）</strong>
                    <span>历史模型不能跨平台重绑；如需迁移，请创建独立模型。</span>
                    <div>
                      <strong>{model.providerName}</strong>
                      <span>技术 Driver：{providerLabels[model.providerDriver]}</span>
                    </div>
                    {providers.find(
                      (provider) =>
                        provider.id === editingParameterProviderProfileId,
                    )?.driver === "multi-protocol-relay" && (
                      <label className="model-provider-protocol">
                        <span>调用协议</span>
                        <GrayMenuSelect
                          ariaLabel={`${model.displayName}调用协议`}
                          onChange={(value) =>
                            setEditingParameterProviderProtocol(
                              value as ProviderProtocol | "",
                            )
                          }
                          options={relayProtocolsForCapability(
                            model.capability,
                          ).map((protocol) => ({
                            label: providerProtocolLabels[protocol],
                            value: protocol,
                          }))}
                          placeholder="请明确选择调用协议"
                          value={editingParameterProviderProtocol}
                        />
                        <small>不根据模型名称自动判断协议。</small>
                      </label>
                    )}
                  </div>
                  <AdminModelParameterEditor
                    capability={model.capability}
                    constraints={providerParameterSchema({
                      capability: model.capability,
                      providerDriver: providers.find(
                        (provider) => provider.id === editingParameterProviderProfileId,
                      )?.driver,
                      providerModelId: model.providerModelId,
                    })}
                    onChange={setEditingParameterSchema}
                    providerProtocol={editingParameterProviderProtocol}
                    schema={editingParameterSchema}
                  />
                  <div className="admin-model-parameter-save">
                    <button
                      disabled={
                        providers.find(
                          (provider) =>
                            provider.id === editingParameterProviderProfileId,
                        )?.driver === "multi-protocol-relay" &&
                        (editingParameterProviderProtocol === "" ||
                          editingParameterProviderProtocol === "native" ||
                          !providerProtocolSupportsCapability(
                            editingParameterProviderProtocol,
                            model.capability,
                          ))
                      }
                      onClick={() => void saveModelParameters(model)}
                      type="button"
                    >
                      保存参数设置
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
