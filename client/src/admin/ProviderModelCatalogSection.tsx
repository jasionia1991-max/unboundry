import { useState, type FormEvent } from "react";
import { GrayMenuSelect } from "../ui/GrayMenuSelect";
import { type ModelCapability } from "../../../types/modelParameters";
import {
  relayProviderProtocols,
  providerProtocolSupportsCapability,
  type ProviderProtocol,
} from "../../../types/relayProtocols";
import { jsonRequest } from "../app/jsonRequest";
import {
  type AdminProviderCatalogDetails,
  type AdminProviderModelCatalog,
  type AdminProviderProfile,
} from "./adminTypes";
import {
  discoveredModelAcceptsRelayProtocol,
  discoveredRelayProtocols,
  emptyProviderModelCatalog,
  providerCatalogCapabilities,
  providerCatalogCapabilityLabel,
  providerCatalogCompletenessMessage,
  providerCatalogDate,
  providerCatalogFallbackMessage,
  providerCatalogModelMetadata,
  providerCatalogPageSize,
  providerCatalogRemoteStatusLabel,
  providerCatalogSelectionLimit,
  providerCatalogSnapshotSourceLabel,
  providerCatalogSourceLabel,
  providerCatalogStatusLabel,
  providerDriverDetails,
  providerProtocolLabels,
  relayProtocolOptionsForModel,
} from "./providerCatalog";

export function ProviderModelCatalogSection({
  onProfilesChanged,
  profile,
}: {
  onProfilesChanged: () => Promise<void>;
  profile: AdminProviderProfile;
}) {
  const catalog = profile.modelCatalog ?? emptyProviderModelCatalog;
  const capabilities = providerCatalogCapabilities(profile, catalog);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [details, setDetails] = useState<AdminProviderCatalogDetails>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCapability, setCatalogCapability] = useState<
    "all" | "unknown" | ModelCapability
  >("all");
  const [catalogProtocol, setCatalogProtocol] = useState<
    "all" | Exclude<ProviderProtocol, "native">
  >("all");
  const [catalogPage, setCatalogPage] = useState(1);
  const [unknownCapabilities, setUnknownCapabilities] = useState<
    Record<string, ModelCapability>
  >({});
  const [selectedProtocols, setSelectedProtocols] = useState<
    Record<string, Exclude<ProviderProtocol, "native">>
  >({});
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    status: "error" | "success";
  }>();

  const openCredentials = () => {
    if (capabilities.credentialMode !== "separate") return;
    setAccessKeyId("");
    setSecretAccessKey("");
    setProjectName(catalog.projectName ?? "");
    setFeedback(undefined);
    setCredentialsOpen(true);
  };

  const closeCredentials = () => {
    setAccessKeyId("");
    setSecretAccessKey("");
    setProjectName("");
    setCredentialsOpen(false);
  };

  const saveCredentials = async (event: FormEvent) => {
    event.preventDefault();
    if (capabilities.credentialMode !== "separate") return;
    if (Boolean(accessKeyId.trim()) !== Boolean(secretAccessKey)) {
      setFeedback({
        message: "修改密钥时需要同时填写AK和SK；都不填写则保留原值。",
        status: "error",
      });
      return;
    }
    if (
      !catalog.hasCredentials &&
      (!accessKeyId.trim() || !secretAccessKey)
    ) {
      setFeedback({
        message: "首次配置需要同时填写AK和SK。",
        status: "error",
      });
      return;
    }
    setSavingCredentials(true);
    setFeedback(undefined);
    try {
      await jsonRequest(
        `/api/admin/provider-catalog/${encodeURIComponent(profile.id)}/credentials`,
        {
          body: JSON.stringify({
            accessKeyId: accessKeyId.trim(),
            projectName: projectName.trim(),
            secretAccessKey,
          }),
          method: "PATCH",
        },
      );
      closeCredentials();
      setFeedback({
        message: "目录凭证已加密保存。保存本身不会连接平台。",
        status: "success",
      });
      await onProfilesChanged();
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "目录凭证保存失败",
        status: "error",
      });
    } finally {
      setSavingCredentials(false);
      setSecretAccessKey("");
    }
  };

  const refreshDetails = async () => {
    const result = await jsonRequest<AdminProviderCatalogDetails>(
      `/api/admin/provider-catalog/${encodeURIComponent(profile.id)}`,
    );
    setDetails(result);
    setSelectedIds((current) =>
      current.filter((id) =>
        result.models.some((model) => model.discoveryId === id),
      ),
    );
    setSelectedProtocols((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id, protocol]) => {
          const model = result.models.find(
            (candidate) => candidate.discoveryId === id,
          );
          if (!model) return false;
          const capability = model.capability === "unknown"
            ? unknownCapabilities[id]
            : model.capability;
          return discoveredModelAcceptsRelayProtocol(
            model,
            protocol,
            capability,
          );
        }),
      ) as Record<string, Exclude<ProviderProtocol, "native">>,
    );
    return result;
  };

  const toggleDetails = async () => {
    if (detailsOpen) {
      setDetailsOpen(false);
      return;
    }
    setDetailsOpen(true);
    if (details) return;
    setDetailsLoading(true);
    setFeedback(undefined);
    try {
      await refreshDetails();
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "模型目录读取失败",
        status: "error",
      });
    } finally {
      setDetailsLoading(false);
    }
  };

  const syncCatalog = async () => {
    if (!capabilities.supported || !capabilities.supportsSync) return;
    setSyncing(true);
    setFeedback(undefined);
    try {
      const result = await jsonRequest<{
        catalog: AdminProviderModelCatalog;
        controlPlaneRequests: number;
        message: string;
        paidGenerationRequests: 0;
      }>(`/api/admin/provider-catalog/${encodeURIComponent(profile.id)}/sync`, {
        method: "POST",
      });
      await Promise.all([onProfilesChanged(), refreshDetails()]);
      setFeedback({
        message: result.message || "模型目录已同步，付费生成请求为0。",
        status: "success",
      });
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "模型目录同步失败",
        status: "error",
      });
    } finally {
      setSyncing(false);
    }
  };

  const setModelSelected = (discoveryId: string, selected: boolean) => {
    if (
      selected &&
      !selectedIds.includes(discoveryId) &&
      selectedIds.length >= providerCatalogSelectionLimit
    ) {
      setFeedback({
        message: `单次最多选择 ${providerCatalogSelectionLimit} 个模型，请先添加当前选择。`,
        status: "error",
      });
      return;
    }
    setSelectedIds((current) =>
      selected
        ? current.includes(discoveryId)
          ? current
          : current.length >= providerCatalogSelectionLimit
            ? current
            : [...current, discoveryId]
        : current.filter((id) => id !== discoveryId),
    );
  };

  const selectedModels =
    details?.models.filter((model) => selectedIds.includes(model.discoveryId)) ??
    [];
  const normalizedCatalogQuery = catalogQuery.trim().toLocaleLowerCase("zh-CN");
  const filteredModels =
    details?.models.filter((model) => {
      const resolvedCapability = model.capability === "unknown"
        ? unknownCapabilities[model.discoveryId] ?? "unknown"
        : model.capability;
      if (
        catalogCapability !== "all" &&
        resolvedCapability !== catalogCapability
      ) {
        return false;
      }
      if (
        profile.driver === "multi-protocol-relay" &&
        catalogProtocol !== "all" &&
        discoveredRelayProtocols(model).length > 0 &&
        !discoveredRelayProtocols(model).includes(catalogProtocol)
      ) {
        return false;
      }
      if (!normalizedCatalogQuery) return true;
      return `${model.displayName}\n${model.providerModelId}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedCatalogQuery);
    }) ?? [];
  const catalogPageCount = Math.max(
    1,
    Math.ceil(filteredModels.length / providerCatalogPageSize),
  );
  const visibleCatalogPage = Math.min(catalogPage, catalogPageCount);
  const visibleModels = filteredModels.slice(
    (visibleCatalogPage - 1) * providerCatalogPageSize,
    visibleCatalogPage * providerCatalogPageSize,
  );
  const missingCapability = selectedModels.some(
    (model) =>
      model.capability === "unknown" && !unknownCapabilities[model.discoveryId],
  );
  const missingProtocol = profile.driver === "multi-protocol-relay" &&
    selectedModels.some((model) => {
      const capability = model.capability === "unknown"
        ? unknownCapabilities[model.discoveryId]
        : model.capability;
      return !discoveredModelAcceptsRelayProtocol(
        model,
        selectedProtocols[model.discoveryId],
        capability,
      );
    });
  const selectionLimitReached =
    selectedIds.length >= providerCatalogSelectionLimit;
  const catalogImportReady = catalog.keyStatus === "valid" &&
    Boolean(catalog.syncedAt);

  const importModels = async () => {
    if (
      !capabilities.supportsImport ||
      !catalogImportReady ||
      selectedModels.length === 0 ||
      selectedModels.length > providerCatalogSelectionLimit ||
      missingCapability ||
      missingProtocol
    ) return;
    setImporting(true);
    setFeedback(undefined);
    try {
      const result = await jsonRequest<{
        imported: number;
        message: string;
        skipped: number;
      }>(
        `/api/admin/provider-catalog/${encodeURIComponent(profile.id)}/import`,
        {
          body: JSON.stringify({
            models: selectedModels.map((model) => ({
              ...(model.capability === "unknown"
                ? { capability: unknownCapabilities[model.discoveryId] }
                : {}),
              discoveryId: model.discoveryId,
              ...(profile.driver === "multi-protocol-relay"
                ? { providerProtocol: selectedProtocols[model.discoveryId] }
                : {}),
            })),
          }),
          method: "POST",
        },
      );
      setSelectedIds([]);
      setUnknownCapabilities({});
      setSelectedProtocols({});
      await onProfilesChanged();
      setFeedback({
        message:
          result.message ||
          `已添加 ${result.imported} 个模型到“${profile.label}”模型中心，当前保持停用。`,
        status: "success",
      });
    } catch (caught) {
      setFeedback({
        message:
          caught instanceof Error ? caught.message : "添加到模型中心失败",
        status: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  const catalogCredentialReady =
    capabilities.credentialMode === "separate"
      ? catalog.hasCredentials
      : capabilities.credentialMode === "profile-api-key"
        ? profile.hasApiKey
        : false;
  const catalogSourceLabel = providerCatalogSnapshotSourceLabel(
    catalog.catalogSource,
  );
  const catalogFallbackMessage = providerCatalogFallbackMessage(catalog);
  const catalogCompletenessMessage = providerCatalogCompletenessMessage(catalog);
  const catalogStateMessage =
    catalog.errorCode === "FORMAT"
      ? "平台返回格式异常，已保留上次同步结果。"
      : catalog.errorCode === "PROXY_CONFIGURATION"
      ? "本机代理地址模式阻止目录同步，已保留上次结果"
      : catalog.keyStatus === "invalid"
      ? capabilities.credentialMode === "separate"
        ? "目录凭证已失效，请修改AK/SK后重新同步。"
        : "当前平台Key已失效，请修改连接后重新检查。"
      : catalog.keyStatus === "permission"
        ? "凭证本身可用，但当前账号没有读取模型目录的权限。"
        : catalog.keyStatus === "unknown"
          ? "暂时无法确认目录状态，已保留上次同步结果。"
          : catalog.keyStatus === "unchecked" && catalogCredentialReady
            ? "目录尚未检查，同步前不会改变模型中心。"
            : "";

  return (
    <section
      className="provider-model-catalog"
      data-catalog-status={
        syncing
          ? "loading"
          : capabilities.supported
            ? catalog.keyStatus
            : "unsupported"
      }
      data-catalog-support={capabilities.support}
      data-testid={`provider-model-catalog-${profile.id}`}
    >
      <div className="provider-catalog-heading">
        <div>
          <strong>{profile.label} · 模型目录</strong>
          <span>商业平台：{profile.label} · 技术接入：{providerDriverDetails[profile.driver].label}</span>
          <span>{capabilities.description}</span>
        </div>
        <b>{providerCatalogStatusLabel(catalog, capabilities, syncing)}</b>
      </div>

      {!capabilities.supported ? (
        <div className="provider-catalog-unavailable">
          {capabilities.support === "manual" ? (
            <>
              <p>平台未提供可同步模型目录；模型由管理员在模型中心配置。</p>
              <span>本项目已配置：{catalog.configuredModelCount} 个</span>
            </>
          ) : catalog.support ? (
            <p>该平台暂不支持远程模型目录，请在模型中心手动配置。</p>
          ) : (
            <p>模型目录能力尚未加载，本页不会猜测平台能力或发起请求。</p>
          )}
        </div>
      ) : (
        <>
          {capabilities.credentialMode === "separate" ? (
            <div
              className="provider-catalog-credential-summary"
              data-credential-mode="separate"
            >
              <span>
                {catalog.hasCredentials
                  ? `AK：${catalog.accessKeyIdMask || "已保存"}`
                  : "尚未配置目录凭证"}
              </span>
              {catalog.projectName && <span>项目：{catalog.projectName}</span>}
              {catalog.checkedAt && (
                <span>上次检查：{providerCatalogDate(catalog.checkedAt)}</span>
              )}
              <button onClick={openCredentials} type="button">
                {catalog.hasCredentials ? "修改目录凭证" : "配置目录凭证"}
              </button>
            </div>
          ) : (
            <div
              className="provider-catalog-credential-summary"
              data-credential-mode="profile-api-key"
            >
              <span>
                {profile.hasApiKey
                  ? "使用管理员自己的平台密钥（在「我的连接」填写）"
                  : "管理员尚未在「我的连接」填写该平台密钥"}
              </span>
              {catalog.checkedAt && (
                <span>上次检查：{providerCatalogDate(catalog.checkedAt)}</span>
              )}
              <span>无需另行配置目录凭证</span>
            </div>
          )}

          {credentialsOpen && capabilities.credentialMode === "separate" && (
            <form className="provider-catalog-credentials" onSubmit={saveCredentials}>
              <label>
                <span>AK（Access Key ID）</span>
                <input
                  autoComplete="off"
                  maxLength={500}
                  onChange={(event) => setAccessKeyId(event.target.value)}
                  placeholder={
                    catalog.hasCredentials ? "不填写则保留原AK" : "保存后只显示遮罩"
                  }
                  required={!catalog.hasCredentials}
                  type="password"
                  value={accessKeyId}
                />
              </label>
              <label>
                <span>SK（Secret Access Key）</span>
                <input
                  autoComplete="off"
                  maxLength={500}
                  onChange={(event) => setSecretAccessKey(event.target.value)}
                  placeholder={
                    catalog.hasCredentials ? "不填写则保留原SK" : "保存后不再显示"
                  }
                  required={!catalog.hasCredentials}
                  type="password"
                  value={secretAccessKey}
                />
              </label>
              <label>
                <span>项目名称（可选）</span>
                <input
                  maxLength={100}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="不填写则使用 default 项目"
                  value={projectName}
                />
              </label>
              <p>
                AK和SK只会加密保存在本机；本应用不写入浏览器本地存储，也不会把密钥放进地址中。
              </p>
              <div>
                <button disabled={savingCredentials} type="submit">
                  {savingCredentials ? "正在加密保存…" : "加密保存"}
                </button>
                <button
                  disabled={savingCredentials}
                  onClick={closeCredentials}
                  type="button"
                >
                  取消
                </button>
              </div>
            </form>
          )}

          <dl
            className="provider-catalog-counts"
            data-has-endpoints={capabilities.supportsEndpoints ? "true" : "false"}
          >
            <div>
              <dt>{capabilities.modelLabel}</dt>
              <dd>{catalog.modelCount}</dd>
            </div>
            {capabilities.supportsEndpoints && (
              <div>
                <dt>{capabilities.endpointLabel}</dt>
                <dd>{catalog.endpointCount}</dd>
              </div>
            )}
            <div>
              <dt>本项目已配置</dt>
              <dd>{catalog.configuredModelCount}</dd>
            </div>
          </dl>

          {(catalogSourceLabel || catalog.capabilityCounts) && (
            <div
              className="provider-catalog-diagnostics"
              data-catalog-source={catalog.catalogSource ?? "legacy"}
            >
              {catalogSourceLabel && (
                <p className="provider-catalog-source-summary">
                  <strong>
                    {catalog.snapshotStale ? "保留快照来源" : "目录来源"}：
                    {catalogSourceLabel}
                  </strong>
                  {typeof catalog.reportedModelCount === "number" && (
                    <span>
                      {catalog.catalogSource === "enhanced+basic"
                        ? "合并后"
                        : "平台报告"}：
                      {catalog.reportedModelCount} 个
                    </span>
                  )}
                  <span>已保存：{catalog.modelCount} 个</span>
                  {catalog.catalogSource === "enhanced+basic" && (
                    <span>增强目录与兼容目录已只读获取并去重合并</span>
                  )}
                </p>
              )}
              {catalog.capabilityCounts && (
                <dl
                  aria-label="模型类型统计"
                  className="provider-catalog-capability-counts"
                >
                  <div>
                    <dt>文字</dt>
                    <dd>{catalog.capabilityCounts.text}</dd>
                  </div>
                  <div>
                    <dt>图片</dt>
                    <dd>{catalog.capabilityCounts.image}</dd>
                  </div>
                  <div>
                    <dt>视频</dt>
                    <dd>{catalog.capabilityCounts.video}</dd>
                  </div>
                  <div>
                    <dt>音频</dt>
                    <dd>{catalog.capabilityCounts.audio}</dd>
                  </div>
                  {catalog.capabilityCounts.unknown > 0 && (
                    <div>
                      <dt>待识别</dt>
                      <dd>{catalog.capabilityCounts.unknown}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          )}

          {catalogStateMessage && (
            <p
              className="provider-catalog-state-note"
              data-state={catalog.keyStatus}
            >
              {catalogStateMessage}
            </p>
          )}

          {catalogFallbackMessage && (
            <p className="provider-catalog-state-note" data-state="fallback">
              {catalogFallbackMessage}
            </p>
          )}

          {catalogCompletenessMessage && (
            <p className="provider-catalog-state-note" data-state="warning">
              {catalogCompletenessMessage}
            </p>
          )}

          <div className="provider-catalog-sync-row">
            <span>
              上次同步：{providerCatalogDate(catalog.syncedAt)}
              {catalog.snapshotStale ? " · 目录资料可能已过期" : ""}
            </span>
            <div className="provider-catalog-sync-actions">
              {capabilities.supportsSync && (
                <button
                  disabled={!catalogCredentialReady || syncing}
                  onClick={() => void syncCatalog()}
                  type="button"
                >
                  {syncing ? "同步中…" : `同步“${profile.label}”目录`}
                </button>
              )}
              <button
                aria-expanded={detailsOpen}
                disabled={!catalog.syncedAt && catalog.modelCount === 0}
                onClick={() => void toggleDetails()}
                type="button"
              >
                {detailsOpen ? "收起发现模型" : "查看发现模型"}
              </button>
            </div>
          </div>

          {detailsOpen && (
            <div className="provider-catalog-details">
              {detailsLoading ? (
                <p>正在读取已同步目录…</p>
              ) : details ? (
                <>
                  {details.models.length > 0 ? (
                    <>
                      <div className="provider-catalog-toolbar">
                        <input
                          aria-label="搜索发现模型"
                          onChange={(event) => {
                            setCatalogQuery(event.target.value);
                            setCatalogPage(1);
                          }}
                          placeholder="搜索模型名称或内部编号"
                          type="search"
                          value={catalogQuery}
                        />
                        <GrayMenuSelect
                          ariaLabel="筛选节点类型"
                          onChange={(value) => {
                            setCatalogCapability(
                              value as "all" | "unknown" | ModelCapability,
                            );
                            setCatalogPage(1);
                          }}
                          options={[
                            { label: "全部类型", value: "all" },
                            { label: "文字", value: "text" },
                            { label: "图片", value: "image" },
                            { label: "视频", value: "video" },
                            { label: "音频", value: "audio" },
                            ...(details.models.some(
                              (model) => model.capability === "unknown",
                            )
                              ? [{ label: "待识别", value: "unknown" }]
                              : []),
                          ]}
                          value={catalogCapability}
                        />
                        {profile.driver === "multi-protocol-relay" && (
                          <GrayMenuSelect
                            ariaLabel="筛选调用协议"
                            onChange={(value) => {
                              setCatalogProtocol(
                                value as
                                  | "all"
                                  | Exclude<ProviderProtocol, "native">,
                              );
                              setCatalogPage(1);
                            }}
                            options={[
                              { label: "全部协议", value: "all" },
                              ...relayProviderProtocols.map((protocol) => ({
                                label: providerProtocolLabels[protocol],
                                value: protocol,
                              })),
                            ]}
                            value={catalogProtocol}
                          />
                        )}
                        <span>
                          共{details.models.length}个
                          {filteredModels.length !== details.models.length
                            ? ` · 找到${filteredModels.length}个`
                            : ""}
                        </span>
                      </div>
                      <p className="provider-catalog-toolbar-note">
                        当前商业平台为“{profile.label}”。勾选后默认保持停用；管理员检查参数并手动发布后，普通用户才会看到。
                      </p>
                      {missingCapability && (
                        <p className="provider-catalog-warning">
                          所选的待识别模型需要先选择节点类型。
                        </p>
                      )}
                      {missingProtocol && (
                        <p className="provider-catalog-warning">
                          所选的中转模型需要选择当前目录与节点类型兼容的调用协议。
                        </p>
                      )}
                      {selectionLimitReached && (
                        <p className="provider-catalog-warning">
                          单次最多选择 {providerCatalogSelectionLimit} 个模型；请先添加当前选择，再继续下一批。
                        </p>
                      )}
                      {!catalogImportReady && (
                        <p className="provider-catalog-warning">
                          连接资料或Key状态已变化，请先重新同步目录再添加模型。
                        </p>
                      )}
                      {filteredModels.length > 0 ? (
                        <>
                        <div className="provider-catalog-model-list">
                          {visibleModels.map((model) => {
                            const checked = selectedIds.includes(model.discoveryId);
                            const metadataItems = providerCatalogModelMetadata(
                              model.metadata,
                            );
                            const resolvedCapability = model.capability === "unknown"
                              ? unknownCapabilities[model.discoveryId]
                              : model.capability;
                            const protocolOptions = relayProtocolOptionsForModel(
                              model,
                              resolvedCapability,
                            );
                            return (
                              <div key={model.discoveryId}>
                                <label>
                                  <input
                                    className="admin-compact-checkbox"
                                    checked={checked}
                                    disabled={!checked && selectionLimitReached}
                                    onChange={(event) =>
                                      setModelSelected(
                                        model.discoveryId,
                                        event.target.checked,
                                      )
                                    }
                                    type="checkbox"
                                  />
                                  <span>
                                    <strong title={model.displayName}>
                                      {model.displayName}
                                    </strong>
                                    <small
                                      className="provider-catalog-model-identity"
                                      title={model.providerModelId}
                                    >
                                      {model.providerModelId} · {providerCatalogSourceLabel(
                                        model.source,
                                        capabilities.scope,
                                      )}
                                      {` · 平台状态：${providerCatalogRemoteStatusLabel(model.status)}`}
                                    </small>
                                    {metadataItems.length > 0 && (
                                      <small
                                        className="provider-catalog-model-metadata"
                                        title={metadataItems.join(" · ")}
                                      >
                                        {metadataItems.join(" · ")}
                                      </small>
                                    )}
                                  </span>
                                </label>
                                <div className="provider-catalog-row-controls">
                                  {model.capability === "unknown" ? (
                                    <GrayMenuSelect
                                      ariaLabel={`${model.displayName}节点类型`}
                                      onChange={(value) => {
                                        const nextCapability = value as ModelCapability;
                                        setUnknownCapabilities((current) => ({
                                          ...current,
                                          [model.discoveryId]: nextCapability,
                                        }));
                                        const selectedProtocol =
                                          selectedProtocols[model.discoveryId];
                                        if (
                                          selectedProtocol &&
                                          !providerProtocolSupportsCapability(
                                            selectedProtocol,
                                            nextCapability,
                                          )
                                        ) {
                                          setSelectedProtocols((current) => {
                                            const next = { ...current };
                                            delete next[model.discoveryId];
                                            return next;
                                          });
                                        }
                                      }}
                                      options={[
                                        { label: "文字", value: "text" },
                                        { label: "图片", value: "image" },
                                        { label: "视频", value: "video" },
                                        { label: "音频", value: "audio" },
                                      ]}
                                      placeholder="选择节点类型"
                                      value={unknownCapabilities[model.discoveryId] ?? ""}
                                    />
                                  ) : (
                                    <span className="provider-catalog-capability">
                                      {providerCatalogCapabilityLabel(model.capability)}
                                    </span>
                                  )}
                                  {profile.driver === "multi-protocol-relay" && (
                                    <GrayMenuSelect
                                      ariaLabel={`${model.displayName}调用协议`}
                                      onChange={(value) =>
                                        setSelectedProtocols((current) => ({
                                          ...current,
                                          [model.discoveryId]: value as
                                            Exclude<ProviderProtocol, "native">,
                                        }))
                                      }
                                      options={protocolOptions.map((protocol) => ({
                                        label: providerProtocolLabels[protocol],
                                        value: protocol,
                                      }))}
                                      placeholder="选择调用协议"
                                      value={selectedProtocols[model.discoveryId] ?? ""}
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {catalogPageCount > 1 && (
                          <nav
                            aria-label="发现模型分页"
                            className="provider-catalog-pagination"
                          >
                            <button
                              aria-label="上一页目录"
                              disabled={visibleCatalogPage === 1}
                              onClick={() =>
                                setCatalogPage(Math.max(1, visibleCatalogPage - 1))
                              }
                              type="button"
                            >
                              上一页
                            </button>
                            <span>
                              第{visibleCatalogPage}页／共{catalogPageCount}页
                            </span>
                            <button
                              aria-label="下一页目录"
                              disabled={visibleCatalogPage === catalogPageCount}
                              onClick={() =>
                                setCatalogPage(
                                  Math.min(catalogPageCount, visibleCatalogPage + 1),
                                )
                              }
                              type="button"
                            >
                              下一页
                            </button>
                          </nav>
                        )}
                        </>
                      ) : (
                        <p className="provider-catalog-filter-empty">
                          没有符合当前搜索和类型条件的模型。
                        </p>
                      )}
                      {capabilities.supportsImport && (
                        <div className="provider-catalog-bulk-bar">
                          <span>
                            已选{selectedModels.length}个／共{details.models.length}个
                          </span>
                          <button
                            disabled={
                              importing ||
                              !catalogImportReady ||
                              selectedModels.length === 0 ||
                              selectedModels.length > providerCatalogSelectionLimit ||
                              missingCapability ||
                              missingProtocol
                            }
                            onClick={() => void importModels()}
                            type="button"
                          >
                            {importing
                              ? "正在添加…"
                              : `添加到“${profile.label}”模型中心（${selectedModels.length}）`}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p>当前同步结果中没有可添加的模型。</p>
                  )}
                  {capabilities.supportsEndpoints && details.endpoints.length > 0 && (
                    <div className="provider-catalog-endpoint-list">
                      <strong>当前账号 {capabilities.endpointLabel}</strong>
                      {details.endpoints.map((endpoint) => (
                        <div key={endpoint.id}>
                          <span>{endpoint.name}</span>
                          <small>
                            {endpoint.id}
                            {endpoint.providerModelId
                              ? ` · ${endpoint.providerModelId}`
                              : ""}
                            {` · 平台状态：${providerCatalogRemoteStatusLabel(endpoint.status)}`}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p>目录尚未加载，请重新展开查看。</p>
              )}
            </div>
          )}

          {feedback && (
            <p
              className="provider-catalog-feedback"
              data-status={feedback.status}
              role="status"
            >
              {feedback.message}
            </p>
          )}
          <p className="provider-catalog-safety-note">
            “{profile.label}”目录同步只读取该商业平台资料，不会跨平台导入、自动发布模型、改变默认模型或发起真实生成。
          </p>
        </>
      )}
    </section>
  );
}
