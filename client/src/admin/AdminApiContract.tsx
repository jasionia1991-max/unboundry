import { useEffect, useState } from "react";
import { SettingsPageHeader } from "../navigation/SettingsPageHeader";
import { type AuthUser } from "../app/accountAuth";
import { jsonRequest } from "../app/jsonRequest";
import { type ApiContractDocument } from "./adminTypes";

const apiOperationDetails: Record<string, { detail: string; label: string }> = {
  listCharacters: {
    label: "读取AI角色目录",
    detail: "按分类、筛选条件和页码读取项目自己的角色卡片。",
  },
  listLibraryAssets: {
    label: "读取素材目录",
    detail: "读取个人或团队空间的文件夹、素材页码和素材总数。",
  },
  readAgentConfiguration: {
    label: "读取Agent界面配置",
    detail: "读取模型、技能和建议选项；真实Agent执行继续关闭。",
  },
  listPublishedModels: {
    label: "读取模型配置",
    detail: "只返回已发布模型和用户可调参数，不返回平台密钥。",
  },
  listTemplates: {
    label: "读取模板目录",
    detail: "按分类、搜索词和页码读取模板；需要时返回画布节点与连线数据。",
  },
  createUserTemplate: {
    label: "保存我的模板",
    detail: "把当前账号的工作流模板写入私有模板库，仅本人可见。",
  },
  deleteUserTemplate: {
    label: "删除我的模板",
    detail: "删除当前账号自己的模板，其他账号不可删除或查看。",
  },
  readAccountContext: {
    label: "读取账号与权限",
    detail: "读取当前账号、个人项目空间和权限，不提供额度或积分接口。",
  },
  readCanvas: {
    label: "读取画布",
    detail: "读取当前账号的节点、连线、视口和修订版本。",
  },
  readProjectTitle: {
    label: "读取项目名称",
    detail: "读取当前账号的项目名称和更新时间。",
  },
  saveCanvas: {
    label: "保存画布",
    detail: "保存节点、连线和视口，并检查修订冲突。",
  },
  saveProjectTitle: {
    label: "保存项目名称",
    detail: "保存当前账号的项目名称和更新时间。",
  },
  downloadGroupResults: {
    label: "下载组结果",
    detail: "把组内成功生成的结果打包为 ZIP，文字结果保存为 txt。",
  },
  listAccountCredentials: {
    label: "读取我的平台密钥",
    detail: "只返回当前账号在各平台的密钥状态与掩码。",
  },
  saveAccountCredential: {
    label: "保存我的平台密钥",
    detail: "把当前账号自己的平台密钥加密保存，仅本人可见。",
  },
  deleteAccountCredential: {
    label: "删除我的平台密钥",
    detail: "删除当前账号在某平台的密钥，不影响其他账号。",
  },
  verifyAccountCredential: {
    label: "校验我的平台密钥",
    detail: "对当前账号的密钥做只读校验，不产生生成费用。",
  },
};

export function AdminApiContract({ currentUser }: { currentUser: AuthUser }) {
  const [contract, setContract] = useState<ApiContractDocument>();
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    jsonRequest<ApiContractDocument>("/api/openapi.json", {
      signal: controller.signal,
    })
      .then(setContract)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "接口说明读取失败");
        }
      });
    return () => controller.abort();
  }, []);

  const operations = contract
    ? Object.entries(contract.paths).flatMap(([path, pathItem]) =>
        Object.entries(pathItem).map(([method, operation]) => ({
          ...operation,
          method: method.toUpperCase(),
          path,
        })),
      )
    : [];

  return (
    <main className="admin-page" data-testid="admin-api-contract-page">
      <SettingsPageHeader
        browserTitle="接口说明"
        displayName={`管理员：${currentUser.displayName}`}
        pageTitle="自有接口说明"
        userId={currentUser.id}
      />
      <div className="api-contract-layout">
        <section className="admin-card api-contract-summary">
          <div>
            <span>自有API</span>
            <b>{contract ? `OpenAPI ${contract.openapi}` : "正在读取…"}</b>
          </div>
          <h1>项目自己的数据接口</h1>
          <p>
            画布、项目名称、安全模型配置及账号权限均使用本项目实现的接口，受登录状态和账号数据隔离保护。
          </p>
          <ul>
            <li>不会连接或复用 Unboundry 上游私有接口</li>
            <li>本页只读取说明，不调用任何收费模型服务</li>
            <li>模型密钥、存储密钥和密码不会出现在说明中</li>
          </ul>
        </section>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {contract && (
          <section className="admin-card api-contract-list">
            <div className="api-contract-heading">
              <div>
                <span>版本 {contract.info.version}</span>
                <h2>当前共 {Object.keys(contract.paths).length} 条接口路径</h2>
              </div>
              <b>仅登录后可用</b>
            </div>
            <div className="api-contract-grid">
              {operations.map((operation) => {
                const copy = apiOperationDetails[operation.operationId];
                return (
                  <article key={`${operation.method}-${operation.path}`}>
                    <div>
                      <b>{operation.method}</b>
                      <code>{operation.path}</code>
                    </div>
                    <strong>{copy?.label || operation.summary}</strong>
                    <p>{copy?.detail || operation.summary}</p>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
