# 调研报告：公共模板（跨账号分享）与账号权限管理

状态：`HISTORICAL_RESEARCH / IMPLEMENTATION_COMPLETED_LATER / SUPERSEDED_BY_CURRENT_STATE`
基线：当前 `main` 提交 `04a1538`（三功能全部验收 PASS）
范围：只做现状调研与改造影响分析，不含正式部署；正式部署方案另行立项。
方法：全仓只读扫描 + 关键文件逐段阅读 + 现有测试盘点；所有结论附文件与行号证据。

后续结果：本调研对应的公共模板、账号权限与部署能力均已在后续版本完成；当前生产为 v0.6.33/schema39。本文件不再代表当前代码结构或待批准事项。

## 0. 调研结论速览

1. **公共模板**：现有公共模板是纯静态 JSON（`server/templateCatalogData.json`，2 条记录），服务端只有 GET，无任何管理面；要支持“仅管理员新增/删除/更新/上下架”，需要新增 v30 `public_templates` 表 + `/api/admin/templates` 一套 CRUD + 管理员页面，并把公共 GET 从静态数据切换到数据库（保留种子迁移）。客户端模板面板/浏览全部/导入链路已具备，改动集中在“管理入口 + 数据源”两层。
2. **账号权限管理**：当前是硬编码两级角色（`users.role = admin|user`），服务端 6 个管理 API 直接判 `role !== "admin"`，`account-context` 的 `permissions` 只是信息展示、前端完全不消费；要实现“管理员把能力授予指定账号”，需要新增 v31 `account_permissions` 表 + 统一 `hasPermission()` + 把 6 处硬编码守卫替换为权限检查 + 账号管理页权限编辑区 + 权限审计。
3. 两个事项互相依赖：公共模板管理接口正好是权限模型的第一个落地场景（`manage_public_templates`），建议先建权限底座再上公共模板，或两者同一批次实施。

## 1. 仓库与运行架构现状

### 1.1 技术栈

- 独立仓库 `app`（`REPLICA_CONSTRAINTS.md` 绿地约束）；`package.json`：React 19.2、Vite 8.1、TypeScript 7.0、@xyflow/react 12.11、node:sqlite、ali-oss、archiver；无 Express，服务端 API 全部挂在 Vite 中间件上（`vite.config.ts`）。
- 生产形态目前仍是 `vite preview` 承载（dev 与 preview 都注册同一批 API 中间件，见 `vite.config.ts` `configureServer/configurePreviewServer` 双注册）。
- 数据库：SQLite 单文件 `unboundry.sqlite`（WAL），迁移在 `server/database.ts`，当前最新 `version 29`（`user-templates` 在 1223 行、`account-provider-credentials` 在 1242 行）。
- 加密密钥：`data/secrets/config-master.key`（`server/secretStore.ts`）；Provider 文档与账号凭据均为 AES-256-GCM 加密。

### 1.2 服务端 API 全量清单（路由、模块、鉴权现状）

来源：`vite.config.ts` 中间件注册（146–458 行）+ `server/*.ts` 的 `*Api` 导出。

| 路径前缀 | 模块 | 方法 | 当前鉴权/归属 |
|---|---|---|---|
| `/api/auth/*` | `server/auth.ts:354` | GET status / POST bootstrap,login,logout | 公开（bootstrap 仅本机） |
| `/api/account-context` | `auth.ts:531` | GET | 登录；返回 permissions 信息 |
| `/api/account-credentials` | `server/accountCredentialsApi.ts:59` | GET/PUT/POST verify/DELETE | 登录；按当前账号 |
| `/api/admin/users` | `auth.ts:572` | GET/POST/PATCH/DELETE | `role !== "admin"`（581 行） |
| `/api/admin/models` | `server/modelCatalog.ts:788` | GET/POST/PATCH 等 | `role !== "admin"`（793 行） |
| `/api/models` | `modelCatalog.ts:741` | GET | 登录 |
| `/api/admin/providers` | `server/providerProfiles.ts:1585` | GET/POST/PATCH/test | `role !== "admin"`（1590 行） |
| `/api/admin/provider-catalog` | `server/providerCatalog.ts:1582` | GET/PATCH/POST（credentials/sync/import/readonly） | `role !== "admin"`（1587 行） |
| `/api/admin/storage` | `server/storageAdmin.ts:140` | GET/POST/PATCH/DELETE | `role !== "admin"`（145 行） |
| `/api/admin/generation-safety` | `server/generationSafety.ts:639` | GET/PATCH | `role !== "admin"`（644 行） |
| `/api/templates` | `server/templateCatalog.ts:606` | GET（public/mine）、POST、DELETE | 登录；space=mine 按 owner |
| `/api/agent-config` | `server/agentConfiguration.ts:85` | GET | 登录 |
| `/api/characters` | `server/characterCatalog.ts:98` | GET | 登录 |
| `/api/library` | `server/libraryCatalog.ts:70` | GET | 登录 |
| `/api/canvas` | `server/canvasPersistence.ts:146` | GET/PUT/DELETE | 登录；owner |
| `/api/canvas/:id/group-download` | `server/groupDownload.ts:231` | POST | 登录；owner |
| `/api/history` | `canvasPersistence.ts` accountHistory | GET/POST/DELETE | 登录；owner |
| `/api/project-title` | `canvasPersistence.ts` projectTitle | GET/PUT | 登录；owner |
| `/api/projects` | `server/projects.ts:189` | GET/POST/DELETE/clone | 登录；owner |
| `/api/assets` `/api/audio-assets` `/api/video-assets` | `assetStorage/audioStorage/videoStorage` | GET/POST/DELETE | 登录；owner |
| `/api/media-metadata` | `server/mediaMetadataApi.ts:16` | GET | 登录；owner |
| `/api/generation-tasks` | `server/generationTasks.ts` | GET/POST/DELETE/status/preflight | 登录；owner |
| `/api/playlist/export` `/api/playlist/thumbnails` | `playlistExport/playlistThumbnails` | POST/GET | 登录 |
| `/api/openapi.json` | `server/openApi.ts:1120` | GET | 登录（经 `/api` authGate） |
| `/api/test-data-directory` | `vite.config.ts:100` | GET | 仅测试 bypass |

OpenAPI 文档现有 15 条路径（`server/openApi.ts` 第 13–591 行），其中没有 `/api/admin/*` 的管理接口文档；管理面接口目前不在 OpenAPI 契约内。

### 1.3 鉴权机制细节

- `authGate`（`auth.ts:320-351`）：`UNBOUNDRY_TEST_AUTH_BYPASS=1` 时把身份固定为 `__test__/admin`；否则校验 HttpOnly 会话 cookie，`authenticate()` 从 sessions+users 读取。
- `requestIdentity(request)`（`auth.ts:310`）：后续处理器从 WeakMap 取身份；测试 bypass 与真实登录统一为 `{ userId, role, displayName, bypass }`。
- `adminUsersApi` 与其他管理 API 鉴权方式不一致：`adminUsersApi` 自己调 `authenticate()`（581 行），其余 5 个管理 API 都只读 `requestIdentity()`（依赖 authGate 已置身份）。权限统一化时需一并收敛。
- 非 GET 请求先过 `isMutationAllowed`（`auth.ts:286-296`）防 CSRF/来源伪造。
- 会话 7 天、SameSite=Strict；`UNBOUNDRY_SECURE_COOKIES=1` 或生产时加 Secure。

### 1.4 数据表现状（与两事项相关）

- `users`：`id/login_name/display_name/password_hash/role('admin'|'user')/status/created_at/updated_at`（v4）。
- `user_templates`：v28（`database.ts:1223`），账号私有模板。
- `account_provider_credentials`：v29（`database.ts:1242`），账号私有平台密钥。
- `provider_profiles / model_profiles / node_model_bindings / generation_tasks / media_assets / project_metadata / canvas_documents / admin_audit_events / generation_safety_settings`：现有业务表。
- 删除账号级联清单在 `auth.ts:702-736`（sessions、attempts、events、tasks、credentials、canvas、project、history、media、audit、user）；新表必须加入该清单或依赖 ON DELETE CASCADE。

## 2. 模板系统现状（事项一）

### 2.1 数据现状

- 公共模板：`server/templateCatalogData.json`（34,034 字节）只含 2 条真实电商模板：
  - `0786e042-095e-4551-b91b-365492e91241 电商详情页工作流`（11 节点/29 边）
  - `aaf7cc53-a595-45da-a6bb-7c93309e0962 213.电商图片生成专家`（13 节点/12 边）
  每条含 `id/title/description/previewImage/categories/sourceTemplateId/nodes/edges`。
- 私有模板：`user_templates`（v28）已具备 owner 隔离、搜索、分类、分页、includeGraph、封面字段。
- 封面：私有模板保存时按“画布 success 任务 → 图内素材 → 渐变”计算并落 `cover_asset_id`（`templateCatalog.ts:400 resolveTemplateCover`）。

### 2.2 服务端现状（`server/templateCatalog.ts`，606 行）

| 函数 | 行号 | 现状 |
|---|---|---|
| `buildTemplateGraph` | 170 | 静态 JSON → 模板图（组+子节点+边） |
| `resolveTemplateCover` | 400 | 封面三级规则 |
| `userTemplateCard` | 436 | 私有模板卡（含 cover/previewImage） |
| `listUserTemplates` | 486 | owner 过滤 + q/category/limit/offset |
| `saveUserTemplate` | 531 | 校验标题/分类/图结构后落库 |
| `deleteUserTemplate` | 592 | owner 校验删除 |
| `templateCatalogApi` | 606 | GET space=public/mine、POST、DELETE |

- `space=public` 分支（663–677 行）直接过滤静态 `templates/records`，**不读数据库**、**没有管理面**。
- `space=mine` 分支（634–661 行）已按 owner 查询 `user_templates`。
- 分类白名单 `categories`（约 90 行）：最近使用/我的模板/全部/Seedance 2.0/广告/电商/影视/生活/工具/有趣/ACG。
- 图结构校验（`validTemplateGraph`）与模板节点类型（audio/group/image/playlist/storyboard/text/video）已就绪，可直接复用于公共模板。
- OpenAPI 只登记了 `/api/templates` 的 GET/POST/DELETE（`openApi.ts:416-516`），无管理接口。

### 2.3 客户端现状（`client/src/canvas/CanvasShell.tsx` 与 `CanvasSurface.tsx`）

| 位置 | 行号 | 现状 |
|---|---|---|
| 面板标签页 state | 732 | `templateTab: "公共模板" \| "我的模板"` |
| 卡片/分类 state | 736–744 | `templateCards`、`templateBrowseCategories`、`templateBrowseAllOpen`、`templateBrowseCategory` |
| 导入入口 | 917 | `applyTemplate(template)` → 派发 `apply-template` 命令 |
| 私有模板删除 | 929 | `deleteUserTemplate`（仅 `templateTab === "我的模板"` 时） |
| 目录拉取 | 1087–1128 | `space: templateTab === "我的模板" ? "mine" : "public"`；`includeGraph=true` |
| 面板渲染 | 2676–2806 | tabs、搜索、卡片（私有卡片含删除按钮 2760–2768） |
| 浏览全部 | 2808–2960 | 侧栏分类 + 网格 + 私有删除按钮（2930–2938） |
| 素材地址补全 | `CanvasSurface.tsx` apply-template | 导入时 `normalizePersistedMediaNodes` 已接入（三功能 t-05 修复） |
| 组内保存模板 | `GroupNode.tsx` | `saveTemplate`（POST /api/templates）+ 弹窗 + toast |

- 公共模板目前**只有卡片与导入**，无“管理”形态；面板与浏览全部均无管理员入口。
- “最近使用”目前只是分类桶，无服务端计数。

### 2.4 相关测试现状

| 测试 | 覆盖 |
|---|---|
| `m22-template-contract.spec.ts` | 公共 GET（2 条种子）、includeGraph、UI 面板搜索 |
| `m0-shell.spec.ts`（模板段 752–834） | 面板几何、tabs、浏览全部、创建按钮禁用 |
| `m70-template-placement.spec.ts` | 导入找空位/镜头 |
| `m71-user-templates.spec.ts` | 私有模板 API/序列化/导入/删除/封面/浏览全部删除（10 项） |

### 2.5 与目标差距清单（公共模板）

- GAP-A1：公共模板无数据库表（只有静态 JSON）。
- GAP-A2：公共 GET 不读库，无法被管理操作影响。
- GAP-A3：无管理员 CRUD 接口（新增/编辑/上下架/删除）与审计。
- GAP-A4：无管理员管理页与入口；普通账号无“管理”入口（正确）。
- GAP-A5：无状态模型（draft/published/archived）；现有种子无法停用/编辑。
- GAP-A6：OpenAPI 无管理接口文档。
- GAP-A7：“最近使用”无服务端计数（可先本地）。
- GAP-A8：公共模板封面当前是静态 previewImage 路径，需支持管理员素材封面。

## 3. 账号与权限现状（事项二）

### 3.1 角色模型

- `users.role`：`admin | user`；管理员创建见 bootstrap（`auth.ts:374-455`）与 `adminUsersApi` POST（584–620 行）；普通账号只能由管理员创建，无公开注册。
- 停用/删除：PATCH status、DELETE 级联（`auth.ts:633-760`）。
- 身份对象 `RequestIdentity`（`auth.ts:24-30`）：`{ bypass, displayName, role, userId }`。

### 3.2 account-context 权限现状（`auth.ts:553-565`）

```ts
permissions: {
  manageOwnCredentials: true,
  manageAccounts: row.role === "admin",
  manageModels: row.role === "admin",
  manageProviders: row.role === "admin",
  manageStorage: row.role === "admin",
  readOwnData: true,
  submitOwnTasks: true,
  writeOwnData: true,
}
```

关键结论：**前端完全不消费 `permissions`**（全仓扫描无 `permissions.manage*` 引用）；客户端只按 `status.user.role` 控制路由与菜单（`App.tsx:6486-6525` 路由守卫、6562–6600 账号浮层菜单、621 行角色标签）。也就是说当前权限对象只是“告知性”字段。

### 3.3 服务端硬编码守卫清单

| API | 文件:行号 | 当前判定 | 目标权限（建议） |
|---|---|---|---|
| 账号管理 | `auth.ts:581` | `role !== "admin"` | `manage_accounts` |
| 模型中心 | `modelCatalog.ts:793` | `role !== "admin"` | `manage_models` |
| 平台连接 | `providerProfiles.ts:1590` | `role !== "admin"` | `manage_providers` |
| 平台目录 | `providerCatalog.ts:1587` | `role !== "admin"` | `manage_providers`（同组） |
| 存储中心 | `storageAdmin.ts:145` | `role !== "admin"` | `manage_storage` |
| 生成安全 | `generationSafety.ts:644` | `role !== "admin"` | `manage_generation_safety` |

其他需要“权限化”的既有能力：项目增删/克隆（`projects.ts`）、生成提交（`generationTasks.ts`）、批量下载（`groupDownload.ts`）、我的模板（`templateCatalog.ts`）、我的连接（`accountCredentialsApi.ts`）、公共模板（新增）。

### 3.4 客户端权限使用

- 路由守卫：`App.tsx:6486-6525`（accounts/models/providers/storage/generation-safety/api-contract 六个 `/admin/*` 都要求 `role === "admin"`）。
- 账号浮层：`App.tsx:6562` 仅 admin 显示管理菜单。
- 账号管理页：`App.tsx` `AdminAccounts`（565–660 行附近）展示用户列表、角色、停用/删除（ConfirmDialog）。
- 表单组件：`client/src/ui/GrayMenuSelect.tsx`、`InlineOptionGroup.tsx`、`ConfirmDialog.tsx`；`m45-admin-checkbox-system.spec.ts` 锁定 16px 紧凑自绘 checkbox——权限编辑区可直接复用该类。

### 3.5 相关测试现状

| 测试 | 覆盖 |
|---|---|
| `m11-auth.spec.ts` | 首管理员、普通账号隔离、停用/删除、非 UUID、403 边界 |
| `m21-account-contract.spec.ts` | account-context 结构与 permissions（37–42 行断言） |
| `m12/m13/m14/m15` | 管理 API 的 403/200 与页面 |
| `m43/m46/m49/m52/m56/m58` | 管理 UI（目录、模型生命周期、中转站、代理） |
| `m45` | 管理表单/checkbox 灰阶一致 |

### 3.6 与目标差距清单（账号权限）

- GAP-B1：无权限表，权限不可按账号授予/撤销。
- GAP-B2：6 处硬编码 `role` 守卫未收敛到统一检查。
- GAP-B3：`adminUsersApi` 与其余管理 API 鉴权方式不一致（authenticate vs requestIdentity）。
- GAP-B4：account-context permissions 是布尔对象且前端不消费；目标应是权限清单并驱动 UI。
- GAP-B5：账号管理页无权限编辑区。
- GAP-B6：权限变更无审计（现有审计只覆盖账号状态/删除、Provider/模型操作）。
- GAP-B7：删除账号级联未包含未来权限表（需 ON DELETE CASCADE 或显式删除）。
- GAP-B8：能力枚举无白名单与文档（OpenAPI/验收矩阵）。
- GAP-B9：部分“普通能力”目前无权限入口（生成、下载、项目管理），若要做“可收回”需逐处接入；若只做“默认授予、仅管理员可收回部分能力”，范围可控。

## 4. 数据模型与迁移草案

### 4.1 v30 `public_templates`

```sql
CREATE TABLE IF NOT EXISTS public_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  graph TEXT NOT NULL,
  cover_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS public_templates_status_updated
  ON public_templates (status, updated_at DESC);
```

- 种子迁移：把 `templateCatalogData.json` 两条记录以 `INSERT OR IGNORE` 灌入（`created_by` 可空表示内置种子），公共 GET 改读库；`m22` 契约保持两条种子可见。
- 删除语义：建议 `archived` 软归档 + 管理页可见（决策点）。

### 4.2 v31 `account_permissions`

```sql
CREATE TABLE IF NOT EXISTS account_permissions (
  account_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, permission),
  FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS account_permissions_account
  ON account_permissions (account_id, permission);
```

- 权限枚举（白名单，放 `types/accountPermissions.ts` 共享给前后端与 OpenAPI）：`manage_accounts / manage_models / manage_providers / manage_storage / manage_generation_safety / manage_public_templates / manage_permissions / manage_projects / generate / group_download / manage_own_templates / manage_own_credentials`。
- 管理员恒真；普通账号默认拥有：`manage_projects / generate / group_download / manage_own_templates / manage_own_credentials`。
- 普通账号默认不拥有：全部 `manage_*` 管理能力。

## 5. 事项一详细改造点（公共模板）

### 5.1 服务端

- `server/database.ts`：新增 v30 迁移（表+索引+种子）。
- 新模块 `server/adminTemplates.ts`（或并入 `templateCatalog.ts`）：
  - `listPublicTemplates(store, {q,category,status,limit,offset,includeGraph})`
  - `savePublicTemplate(store, actorId, input)` / `updatePublicTemplate(...)` / `archivePublicTemplate(...)` / `deletePublicTemplate(...)`（校验复用 `validTemplateGraph` 与分类白名单，写审计）。
  - `adminTemplatesApi(request,response)`：GET/POST/PATCH/DELETE `/api/admin/templates`，权限 `manage_public_templates`。
- `server/templateCatalog.ts`：`space=public` GET 改为读库（published），保留静态数据仅作迁移种子来源；卡片/封面/图结构输出对齐私有模板。
- `vite.config.ts`：注册 `/api/admin/templates`。
- `server/openApi.ts`：新增 `/api/admin/templates` 与 `/api/admin/templates/{templateId}` 文档；公共 `/api/templates` 说明改为“读取已发布公共模板”。

### 5.2 客户端

- `App.tsx`：新增 `/admin/templates` 路由（守卫 `manage_public_templates`，管理员恒有）；账号浮层或浏览全部内加入口。
- 新组件 `AdminTemplatesPage`（列表卡：标题/分类/状态/封面/更新时间；新建/编辑弹窗；上下架/归档/删除；复用 16px 自绘 checkbox 与 ConfirmDialog）。
- `CanvasShell.tsx`：面板/浏览全部公共卡片不加删除按钮；浏览全部侧栏对管理员增加「管理公共模板」入口。

### 5.3 测试

- 新 `m77-public-templates.spec.ts`：种子迁移幂等、管理员 CRUD、状态过滤、普通账号 403、归档后公共列表消失、公开导入仍可用。
- 更新 `m22-template-contract.spec.ts`：公共 GET 仍返回两条种子（从库读出）。

## 6. 事项二详细改造点（账号权限）

### 6.1 服务端

- `types/accountPermissions.ts`：权限枚举 + 默认集 + 白名单校验。
- `server/permissions.ts`：`hasPermission(identity, permission)`（管理员恒真，读表缓存短周期）、`setAccountPermissions(store, actorId, accountId, permissions)`（事务+审计）。
- `auth.ts`：
  - account-context 改为返回 `permissions: string[]`（保持旧布尔字段兼容或同步新增，决策点）。
  - `adminUsersApi`：新增 GET/PUT `/api/admin/users/:id/permissions`（守卫 `manage_permissions`；管理员目标恒全量，普通账号白名单校验）。
  - 删除级联追加 `account_permissions`（或依赖 ON DELETE CASCADE）。
  - 收敛鉴权：统一由 `authGate` 置身份后 `requestIdentity()` 判断（`adminUsersApi` 不再自调 authenticate）。
- 替换 6 处硬编码守卫（见 §3.3 表）为 `hasPermission`。
- 生成/下载/项目等普通能力若需要“可收回”，在对应 API 加入口（决策点；默认方案是先只对管理能力做可授予）。
- `server/openApi.ts`：登记权限相关接口与 account-context 权限字段。

### 6.2 客户端

- `App.tsx`：
  - 路由守卫从 `role !== "admin"` 改为基于 `permissions`（管理员恒真）。
  - 账号浮层菜单按权限显隐。
  - `AdminAccounts` 增加「权限」区：16px 自绘 checkbox 网格（复用 m45 锁定的控件类），保存走 `PUT /api/admin/users/:id/permissions`。
- `account-context` 消费：新增 `useAccountPermissions()` 或在 `AuthStatus` 中携带 `permissions`。

### 6.3 测试

- 新 `m78-account-permissions.spec.ts`：授予/撤销、403/200、越权授予拒绝、管理员恒真、级联删除、审计。
- 更新 `m11/m21`（account-context 新字段）、`m12/m13/m14/m15/m43/m46/m49/m52/m56/m58`（管理接口守卫语义）。
- 权限矩阵测试：对每个管理 API 以“无权限普通账号”请求断言 403。

## 7. 权限矩阵草案（现状 → 目标）

| 能力 | 现状 | 目标 |
|---|---|---|
| 公共模板管理 | 无此能力 | `manage_public_templates`（仅管理员可授予） |
| 模型管理 | admin | `manage_models` |
| Provider/目录 | admin | `manage_providers` |
| 存储 | admin | `manage_storage` |
| 生成安全 | admin | `manage_generation_safety` |
| 账号管理 | admin | `manage_accounts` |
| 权限管理 | admin | `manage_permissions`（不可授予非管理员，默认） |
| 项目管理 | 所有登录账号 | `manage_projects`（默认授予） |
| 生成 | 所有登录账号 | `generate`（默认授予） |
| 批量下载 | 所有登录账号 | `group_download`（默认授予） |
| 我的模板 | 所有登录账号 | `manage_own_templates`（默认授予） |
| 我的连接 | 所有登录账号 | `manage_own_credentials`（默认授予） |

## 8. 实施顺序与批次建议

- 批次 P0（一次提交）：v31 权限底座（表 + `server/permissions.ts` + account-context 改造 + 权限管理 API + 6 处守卫替换 + AdminAccounts 权限 UI + m78）——因为公共模板管理直接依赖它。
- 批次 P1：v30 公共模板（表+种子迁移 + `/api/admin/templates` + 公共 GET 改库 + AdminTemplatesPage + m77 + m22 更新）。
- 批次 P2：可选普通能力收回（generate/download/projects 开关）——如果只需要“管理员能收走生成/下载”，本批做；否则延后。
- 部署：另行立项（本文档不含部署细节）。

## 9. 风险与决策点

### 9.1 风险

- 公共 GET 改库后若种子迁移失败，公共模板会消失：用 `INSERT OR IGNORE` + 启动自检 + m22 兜底。
- 权限替换遗漏某管理入口：以 §3.3 清单为基线 + 权限矩阵测试逐个断言。
- `permissions` 从布尔对象改为数组会破坏 m21 断言与前端类型：选择兼容策略（数组 + 保留布尔对象，或一次性迁移并更新 m21）。
- 删除级联遗漏：新表必须 ON DELETE CASCADE 且纳入 `auth.ts` 删除事务核对。
- 管理员“收走自己权限”导致锁死：`manage_permissions/manage_accounts` 不可从当前管理员身上移除。

### 9.2 决策点（需用户拍板）

1. 公共模板删除：硬删还是归档（建议归档）。
2. “最近使用”是否做服务端计数（建议先本地）。
3. 生成/下载/项目等“普通能力”是否也要可收回（建议：本批只做管理能力授权，普通能力默认授予；如需收回放入 P2）。
4. 权限对象兼容：account-context 返回数组即可，还是要保留旧布尔字段（建议：直接换成数组 + 更新 m21/前端）。
5. 是否允许把 `manage_accounts / manage_permissions` 授予非管理员（建议：不允许）。
6. 权限粒度：`generate` 一个总开关还是拆四类（建议先一个）。

## 10. 附录：关键文件与行号索引

- `vite.config.ts`：中间件注册 100–458。
- `server/auth.ts`：authGate 320、requestIdentity 310、accountContext 531、adminUsers 572、删除级联 702。
- `server/templateCatalog.ts`：公共 GET 663、私有 API 634–720、校验函数 282–390。
- `server/modelCatalog.ts`：publicModels 741、adminModels 788、守卫 793。
- `server/providerProfiles.ts`：守卫 1590。
- `server/providerCatalog.ts`：守卫 1587。
- `server/storageAdmin.ts`：守卫 145。
- `server/generationSafety.ts`：守卫 644。
- `server/database.ts`：迁移 v28 1223、v29 1242。
- `client/src/App.tsx`：路由守卫 6486–6525、账号浮层 6562、AdminAccounts 565–660、AdminProviders 2068+。
- `client/src/canvas/CanvasShell.tsx`：模板面板 2676+、浏览全部 2808+、目录拉取 1087+。
- `client/src/canvas/CanvasSurface.tsx`：apply-template + 素材补全。
- 测试：`m11`、`m21`、`m22`、`m45`、`m70`、`m71`、`m12–m15`、`m43/46/49/52/56/58`。
