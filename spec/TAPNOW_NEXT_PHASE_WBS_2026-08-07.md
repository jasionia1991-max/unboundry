# 下一阶段工作分解（WBS）：公共模板 × 账号权限管理

状态：`DRAFT / PENDING USER APPROVAL 2026-08-07`
依据：`spec/TAPNOW_NEXT_PHASE_INVESTIGATION_2026-08-07.md`（现状与行号证据）
范围：只拆“账号权限管理”与“公共模板”两个需求；正式部署另行立项。
执行纪律：每个小点依次完成 实现 → 逐行审计 → tsc/构建/单测/集成（临时数据目录）→ 分诊 → 相关回归 → TASKS.md 同步 → commit。

## 0. 依赖顺序与总览

```
P0 权限底座（10 步） ──► P1 公共模板（9 步） ──► P2 可选：普通能力收回
```

为什么 P0 在前：公共模板管理接口要挂在权限系统上（`manage_public_templates`），先有 `hasPermission()` 再写管理 API，避免二次返工。

| 里程碑 | 步骤 | 产出 |
|---|---|---|
| P0 | P0-1 ~ P0-10 | 权限表、权限服务、权限 API、6 处守卫替换、前端权限消费、账号管理页权限 UI、级联与审计、回归收口 |
| P1 | P1-1 ~ P1-9 | 公共模板表+种子、管理员 CRUD API、公共 GET 改库、管理员管理页、导入兼容、最近使用（可选）、回归收口 |
| P2 | P2-1 ~ P2-3 | 生成/下载/项目管理权限开关（可选，需用户确认再做） |

## P0 账号权限管理（10 步）

### P0-1 权限类型与默认集

- 目标：定义唯一权限枚举与默认授予集，前后端与 OpenAPI 共用。
- 文件：
  - 新增 `types/accountPermissions.ts`：`AccountPermission` 联合类型、`ALL_PERMISSIONS`、`DEFAULT_USER_PERMISSIONS`、`isAccountPermission()`、`permissionLabel(permission)`（中文文案，供 UI 与文档）。
  - `client/src/models/ModelCatalog.tsx` 或 `App.tsx` 类型引用该文件。
- 权限枚举（12 项）：
  `manage_accounts / manage_models / manage_providers / manage_storage / manage_generation_safety / manage_public_templates / manage_permissions / manage_projects / generate / group_download / manage_own_templates / manage_own_credentials`
- 默认集（普通账号）：`manage_projects / generate / group_download / manage_own_templates / manage_own_credentials`。
- 验证：新增 `tests/m78-account-permissions.spec.ts` 首批单测（白名单拒绝未知值、默认集快照）。
- 验收：tsc/构建通过；枚举与默认集单测全绿。

### P0-2 v31 迁移：account_permissions 表

- 文件：`server/database.ts`（在 v29 后追加 v31；编号直接 v31，跳过 30 留待公共模板，或按顺序 v30——决策点，建议：权限 v30、公共模板 v31，或统一按实现顺序编号，任选其一并在 TASKS.md 记录）。
- SQL：
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
- 验证：迁移幂等（v29 库升级、重复执行）；沿用 m44 迁移测试模式新增用例。
- 验收：`PRAGMA user_version` 递增；迁移可重放。

### P0-3 权限服务 `server/permissions.ts`

- 函数：
  - `hasPermission(identity: RequestIdentity, permission: AccountPermission): boolean`：管理员恒真；普通账号查 `account_permissions`（每次查询直读，量小不缓存，避免权限变更滞后）。
  - `accountPermissionSet(store, accountId): Set<AccountPermission>`
  - `setAccountPermissions(store, actorId, accountId, permissions)`：白名单校验；事务；写 `admin_audit_events`（action=`account_permissions.update`，details 含增删集合）；禁止把 `manage_accounts/manage_permissions` 从当前管理员身上移除；目标账号是管理员时强制全量。
- 文件：新增 `server/permissions.ts`；`server/auth.ts` 不直接引用新表（由本模块封装）。
- 验证：m78 单测（管理员恒真、普通账号授予/撤销、越权、审计、锁死保护）。
- 验收：单测全绿。

### P0-4 account-context 改造

- 文件：`server/auth.ts`（`accountContextApi`，553–565 行）。
- 改动：返回新增 `permissions: AccountPermission[]`（按默认集+授予集合并去重）；保留旧布尔字段或删除——决策点：建议直接新增数组并保留旧布尔字段一个版本，m21 同步断言两者，前端切换后再删布尔。
- 客户端类型：`client/src/App.tsx` 的 `AuthStatus`/`AuthenticatedApplication` 增加 `permissions`。
- 验证：更新 `tests/m21-account-contract.spec.ts`（37–42 行断言）；新增权限数组断言。
- 验收：account-context 返回数组且 m21 全绿。

### P0-5 权限管理 API

- 文件：`server/auth.ts`（`adminUsersApi`）或新增 `server/accountPermissionsApi.ts`；`vite.config.ts` 注册；`server/openApi.ts` 登记。
- 接口：
  - `GET /api/admin/users/:id/permissions` → `{ permissions: AccountPermission[] }`（守卫 `manage_permissions`；管理员目标返回全量）。
  - `PUT /api/admin/users/:id/permissions` body `{ permissions: string[] }`（白名单校验、事务、审计、防锁死）。
- 权限：`manage_permissions`（默认仅管理员可授予；决策点：是否允许授予非管理员，默认不允许）。
- 验证：m78 API 段（授予/撤销/403/404/越权/审计）。
- 验收：API 测试全绿；OpenAPI 文档更新。

### P0-6 六处硬编码守卫替换

- 文件与替换：
  | 文件:行号 | 旧判定 | 新判定 |
  |---|---|---|
  | `server/auth.ts:581` | role !== admin | `hasPermission(identity, "manage_accounts")` |
  | `server/modelCatalog.ts:793` | role !== admin | `manage_models` |
  | `server/providerProfiles.ts:1590` | role !== admin | `manage_providers` |
  | `server/providerCatalog.ts:1587` | role !== admin | `manage_providers` |
  | `server/storageAdmin.ts:145` | role !== admin | `manage_storage` |
  | `server/generationSafety.ts:644` | role !== admin | `manage_generation_safety` |
- 顺带收敛：`adminUsersApi` 改用 `requestIdentity()` + `hasPermission`（不再自调 `authenticate()`，与其余管理 API 一致）。
- 验证：新增“权限矩阵测试”——对每个管理 API，用无权限普通账号会话断言 403；管理员仍 200。
- 验收：矩阵测试全绿；现有 m11/m12/m13/m14/m15 管理测试不回归。

### P0-7 前端权限消费

- 文件：`client/src/App.tsx`（路由守卫 6486–6525、账号浮层 6562–6600）、类型。
- 改动：
  - 新增 `hasClientPermission(permissions, permission)` 帮助函数（管理员恒真）。
  - 六个 `/admin/*` 路由守卫从 `role !== "admin"` 改为权限判断（`manage_accounts/manage_models/manage_providers/manage_storage/manage_generation_safety/manage_public_templates`；api-contract 跟随 manage_accounts 或保留 admin）。
  - 账号浮层菜单按权限显隐；新增“公共模板管理”入口（P1 时加入）。
  - `/connections` 保持所有账号可见。
- 验证：更新 m0 账号浮层测试、m11/m21；新增无权限普通账号路由跳转断言。
- 验收：前端仅凭权限显示入口；直链无权限页面被踢回画布。

### P0-8 AdminAccounts 权限编辑 UI

- 文件：`client/src/App.tsx` `AdminAccounts`（565–660 行区域）。
- 改动：账号行/详情新增“权限”区：
  - 16px 自绘 checkbox 网格（复用 `m45` 锁定的 checkbox 类，不裸用 `input[type=checkbox]`）。
  - 只对非管理员账号可编辑；管理员行只读显示“管理员（全部权限）”。
  - 保存按钮 + 加载/错误/成功反馈（12px/14px 两档字号、灰阶状态色）。
  - `manage_permissions/manage_accounts` 两个 checkbox 对非管理员默认禁用（防越权授予）。
- 验证：m78 UI 段（勾选保存→刷新保持、403 处理）；m45 回归。
- 验收：实页操作权限编辑生效且样式符合设计系统。

### P0-9 删除账号级联与审计查询

- 文件：`server/auth.ts`（删除事务 702–736）。
- 改动：`account_permissions` 依赖 ON DELETE CASCADE，并在事务内显式 `DELETE FROM account_permissions WHERE account_id = ?`（双保险）；删除后断言 0 行。
- 可选：权限变更审计在账号详情展示最近 5 条（`admin_audit_events WHERE action='account_permissions.update'`）。
- 验证：m78（删除账号后权限行 0）；m11 删除回归。
- 验收：删除账号不残留权限行。

### P0-10 权限能力回归与文档收口

- 动作：全量相关回归（m11/m12/m13/m14/m15/m21/m43/m45/m46/m49/m52/m56/m58/m78）；`TASKS.md` 记录实施与验收；验收矩阵新增权限条目；OpenAPI 收口；commit。
- 验收：除既有基线失败外全绿；用户实页验收权限授予/撤销/入口显隐。

## P1 公共模板（9 步）

### P1-1 v30 数据模型与种子迁移

- 文件：`server/database.ts`（迁移 v30 `public_templates`，见调研 §4.1）。
- 种子：迁移时把 `server/templateCatalogData.json` 两条记录 `INSERT OR IGNORE`（`created_by` 可空表示内置种子）。
- 验证：迁移幂等；升级后表内有且仅 2 条种子（临时库）。
- 验收：迁移可重放；m22 种子数据不丢。

### P1-2 公共模板存储层

- 文件：新增 `server/adminTemplates.ts`（或并入 `server/templateCatalog.ts`，建议独立模块）。
- 函数：
  - `listPublicTemplates(store, { q, category, status, limit, offset, includeGraph })`
  - `publicTemplateCard(store, row, includeGraph)`（对齐 `userTemplateCard` 的 categories/cover/previewImage/graph）
  - `savePublicTemplate(store, actorId, input)` / `updatePublicTemplate(store, actorId, id, input)` / `archivePublicTemplate(...)` / `deletePublicTemplate(...)`
  - 校验复用：标题 1–40、分类白名单、`validTemplateGraph`（从 `templateCatalog.ts` 导出复用，避免复制逻辑）。
- 验证：m77 存储层单测（CRUD/校验/状态机/审计）。
- 验收：单测全绿。

### P1-3 管理员 CRUD API

- 文件：`server/adminTemplates.ts`（`adminTemplatesApi`）、`vite.config.ts`（注册 `/api/admin/templates`）、`server/openApi.ts`。
- 接口：
  - `GET /api/admin/templates?q&category&status&limit&offset&includeGraph`
  - `POST /api/admin/templates`（`{ title, category?, graph, status? }`，默认 draft）
  - `PATCH /api/admin/templates/:id`（标题/分类/图/封面/status；draft↔published↔archived）
  - `DELETE /api/admin/templates/:id`（按决策：硬删或归档；建议归档+显式恢复接口）
- 守卫：`hasPermission(identity, "manage_public_templates")`；写审计。
- 验证：m77 API 段（CRUD、状态、403、审计）。
- 验收：API 测试全绿；OpenAPI 更新。

### P1-4 公共 GET 改库

- 文件：`server/templateCatalog.ts`（663–677 行 `space=public` 分支）。
- 改动：公共 GET 改读 `public_templates WHERE status='published'`；`categories` 返回全部分类；搜索/分页参数不变；静态 JSON 仅作为种子来源，不再作为运行时数据源（或保留 fallback 但以库为准）。
- 验证：更新 `m22-template-contract.spec.ts`（两条种子仍可见）；m77 覆盖“归档后公共列表消失”“草稿不可见”。
- 验收：公共列表行为与改造前一致且受管理操作影响。

### P1-5 管理员模板管理页

- 文件：`client/src/App.tsx`（新增 `AdminTemplatesPage` 与 `/admin/templates` 路由）、`client/src/styles.css`。
- UI：列表卡（标题/分类/状态胶囊/封面/更新时间）；新建/编辑弹窗（标题+分类+图结构校验提示，样式对齐 GroupNode 保存弹窗）；操作按钮（发布/下架/归档/删除+ConfirmDialog）。
- 守卫：`manage_public_templates`。
- 验证：m77 UI 段（列表、新建、编辑、上下架、删除、Escape/外点关闭）。
- 验收：实页管理员操作完整；样式符合设计系统（12/14px、灰阶、紧凑控件）。

### P1-6 浏览全部管理入口 + 面板适配

- 文件：`client/src/canvas/CanvasShell.tsx`（2808–2960 浏览全部区域；2676–2806 面板区域）。
- 改动：浏览全部侧栏对管理员显示「管理公共模板」入口（跳 `/admin/templates`）；公共卡片永不显示删除按钮；面板逻辑不变。
- 验证：m0 模板段、m70/m71 回归。
- 验收：普通账号无管理入口；管理员入口可达。

### P1-7 公共模板导入与素材兼容

- 文件：复用 `CanvasSurface.tsx` apply-template（已含 `normalizePersistedMediaNodes`）。
- 验证：新增集成测试——管理员发布含素材（assetId）的公共模板 → 普通账号导入 → 图片/视频/音频不刷新即可见、刷新仍在。
- 验收：导入链路与私有模板一致。

### P1-8 最近使用（可选，决策点确认后做）

- 文件：`client/src/canvas/CanvasShell.tsx`（templateSearch/浏览全部逻辑）。
- 改动：localStorage（v2 命名空间，按账号）记录最近导入模板 id（公共+私有），「最近使用」分类按记录倒序；无记录时回落现有空态。
- 验证：新增本地记录/跨标签不串断言。
- 验收：最近使用排序符合直觉；不影响其他分类。

### P1-9 公共模板回归与收口

- 动作：模板相关全量回归（m22/m70/m71/m77/m0 模板段）；`TASKS.md` 记录；验收矩阵新增公共模板条目；commit。
- 验收：除既有基线失败外全绿；用户实页验收管理员发布→普通账号导入闭环。

## P2 可选：普通能力收回（决策点确认后做）

### P2-1 生成权限接入

- `server/generationTasks.ts` 提交/预检入口加 `hasPermission(identity, "generate")`；可用性接口同步反映。

### P2-2 批量下载权限接入

- `server/groupDownload.ts` 入口加 `hasPermission(identity, "group_download")`。

### P2-3 项目管理权限接入

- `server/projects.ts` 写操作（新建/重命名/删除/克隆）加 `hasPermission(identity, "manage_projects")`；默认集已含。

## 附：每步通用验证命令

```bash
npx tsc --noEmit
npm run build
npx playwright test -c tests/m78-account-permissions.config.ts   # P0 步骤专用
npx playwright test -c tests/m77-public-templates.config.ts     # P1 步骤专用
npx playwright test -c tests/m74-regression.config.ts           # 管理/账号/Provider 回归
npx playwright test -c tests/m71-regression.config.ts           # 模板/画布回归
```

## 附：建议 commit 策略

- P0-1/P0-2/P0-3 一个 commit（权限底座不可分割最小集）；
- P0-4~P0-6 一个 commit（接口+守卫替换）；
- P0-7/P0-8 一个 commit（前端）；
- P0-9/P0-10 一个 commit（级联+回归+文档）；
- P1-1/P1-2/P1-3 一个 commit（数据+存储+API）；
- P1-4/P1-5/P1-6 一个 commit（公共 GET+管理页+入口）；
- P1-7/P1-8/P1-9 一个 commit（导入兼容+可选最近使用+收口）。

## 决策点（开工前需确认）

1. 权限表版本号与公共模板表版本号如何分配（v30/v31 顺序）。
2. account-context：新增数组并暂留布尔字段，还是直接替换。
3. 公共模板删除：归档+恢复接口（建议）还是硬删。
4. 最近使用：本批做本地版还是不做。
5. `manage_accounts/manage_permissions` 是否允许授予非管理员（建议不允许）。
6. 普通能力收回（P2）本批是否纳入。
