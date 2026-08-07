# 逐小点详拆：账号权限管理 × 公共模板（操作 / 风险 / 应对 / 已验收保护）

状态：`DRAFT / PENDING USER APPROVAL 2026-08-07`
依据：
- `spec/TAPNOW_NEXT_PHASE_INVESTIGATION_2026-08-07.md`（现状与行号）
- `spec/TAPNOW_NEXT_PHASE_WBS_2026-08-07.md`（步骤总览）

本文档把 WBS 的每一个小点展开为：具体操作、可能风险、应对方式、对已验收功能的保护、验证与回滚。

## 0. 全局保护红线（所有步骤都必须满足）

已验收且不得回退的功能面（节选）：
- 三功能 21 项 PASS：我的模板（保存/列表/删除/导入/素材/封面/隔离）、批量下载（空结果/单类型/混合/命名/超限/权限/每节点最新）、账号私有密钥（我的连接/CRUD/校验/无 key 禁止/坏 key 隔离/迁移/排队变更/删除级联）。
- 历史 PASS：画布与节点交互、持久化与多标签、上传媒体、生成任务生命周期、模型中心、Provider/目录、存储、生成安全、账号启停删除、OpenAPI 契约、UI 灰阶规范（含 m45 的 16px `admin-compact-checkbox`）。

全局保护措施（每个小点默认执行）：
1. **只增不改**：新表、新列、新 API 均新增；不修改既有表字段语义、不改变既有接口的请求/响应结构（公共 GET 例外：数据源换库但响应结构保持，且种子迁移兜底）。
2. **管理员行为不变**：权限系统上线后，管理员在任何路径上的权限都等价于今天的 `role === "admin"`；用回归断言锁定。
3. **普通账号默认集=现状能力**：默认授予集与今天普通账号实际可用能力完全一致，避免“新增权限系统导致普通账号功能回退”。
4. **迁移安全**：所有迁移幂等、临时数据目录演练、真实库操作前先备份；失败可回滚（git 回退 + 备份恢复）。
5. **接口兼容**：新增字段用可选/增量方式；account-context 若改结构，先加后删并同步测试。
6. **测试红线**：每步 tsc/构建/专项/相关回归；全量回归以“已知基线失败列表”为准，新增失败一律当场分诊。

## P0 账号权限管理

### P0-1 权限类型与默认集

**目标**：定义唯一权限枚举、默认授予集、白名单校验与中文文案。

**具体操作**：
1. 新增 `types/accountPermissions.ts`：
   - `export type AccountPermission = "manage_accounts" | "manage_models" | "manage_providers" | "manage_storage" | "manage_generation_safety" | "manage_public_templates" | "manage_permissions" | "manage_projects" | "generate" | "group_download" | "manage_own_templates" | "manage_own_credentials"`；
   - `ALL_PERMISSIONS: readonly AccountPermission[]`；
   - `DEFAULT_USER_PERMISSIONS: readonly AccountPermission[] = ["manage_projects","generate","group_download","manage_own_templates","manage_own_credentials"]`；
   - `isAccountPermission(value): value is AccountPermission`；
   - `permissionLabel(p)`（中文，供 UI/文档）。
2. 前端类型引用该文件（`client/src/App.tsx`、`client/src/models/ModelCatalog.tsx` 若需要）。
3. 新增 `tests/m78-account-permissions.spec.ts` 首批单测：白名单拒绝未知值、默认集与现状一致。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R01 | 默认集与现状不一致 | 少写/多写一项默认权限 | 普通账号生成/下载/项目功能回退或越权 |
| R02 | 枚举漏项 | 后续新增管理能力未登记 | 权限系统不完整，需二次迁移 |
| R03 | 前端/后端枚举漂移 | 两侧各自维护 | UI 显示与服务端校验不一致 |

**应对**：
- M01：默认集逐项对照现状代码（projects.ts 项目操作、generationTasks 生成、groupDownload 下载、templateCatalog 我的模板、accountCredentialsApi 我的连接均对所有登录账号开放）；用单测锁默认集快照。
- M02：`ALL_PERMISSIONS` 唯一来源，后端权限 API 校验与前端 UI 都从这里生成；新增能力必须先改此文件。
- M03：前后端共用 `types/accountPermissions.ts`（位于 tsconfig include 的 `types/` 下），单一来源。

**已验收功能保护**：本步只新增类型文件，不改任何运行时行为；m21/m11 等无需改动即可通过（在 P0-4 再改断言）。

**验证与回滚**：tsc/构建；m78 单测。回滚=删除新文件，零影响。

### P0-2 v31 迁移：account_permissions 表

**目标**：落权限表与索引，删除账号自动级联。

**具体操作**：
1. `server/database.ts` 追加迁移（版本号与公共模板表统一排定，见决策点）：
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
2. 迁移测试：临时库从 v29 升级、重复执行、`user_version` 正确。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R04 | 迁移编号冲突 | 与公共模板迁移编号重叠 | 迁移表混乱 |
| R05 | ON DELETE CASCADE 未生效 | foreign_keys 未开启或表建错 | 删账号残留权限行 |
| R06 | 真实库迁移失败 | 磁盘/权限/锁 | 服务启动失败 |

**应对**：
- M04：迁移编号在开工前一次性定稿（v30=权限、v31=公共模板，或相反），写入 TASKS.md。
- M05：`openAppDatabase` 已 `PRAGMA foreign_keys=ON`；删除账号事务仍显式 `DELETE`（双保险，见 P0-9）；迁移测试断言级联。
- M06：迁移前备份；先在临时库跑；真实库由用户确认后由启动流程执行并自检 `user_version`。

**已验收功能保护**：新表不影响既有表；启动自检仅多一条迁移。

**验证与回滚**：迁移幂等测试；回滚=删除该迁移条目并恢复备份。

### P0-3 权限服务 `server/permissions.ts`

**目标**：统一鉴权入口与权限写入。

**具体操作**：
1. `hasPermission(identity, permission)`：管理员恒真；普通账号 `SELECT 1 FROM account_permissions WHERE account_id=? AND permission=?`。
2. `accountPermissionSet(store, accountId)`：返回 Set。
3. `setAccountPermissions(store, actorId, accountId, permissions)`：
   - 白名单校验（`isAccountPermission`）；
   - 事务：全删后全插（或 diff 增删）；
   - 写审计 `admin_audit_events`（action=`account_permissions.update`，details 含 added/removed）；
   - 防锁死：目标账号若为当前管理员，禁止移除 `manage_accounts/manage_permissions`；
   - 目标账号 role=admin 时强制全量。
4. 审计写入复用 `auth.ts` 的 `recordAudit`（若为私有，改为导出或在本模块复制最小插入）。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R07 | 全删全插并发丢失 | 两管理员同时改同一账号 | 权限被覆盖 |
| R08 | 管理员自锁 | 移除自己 manage_permissions | 无法再管理权限 |
| R09 | 审计缺失 | 写入未记录 | 无法追溯 |
| R10 | 查询性能 | 每个请求都查表 | 管理接口低频，影响可忽略 |

**应对**：
- M07：事务内 `BEGIN IMMEDIATE` + 逐行 diff 写入（增删明确），或全删全插但返回影响行数并复查。
- M08：`setAccountPermissions` 内强制保护；API 层再校验一次。
- M09：审计必写；测试断言审计行。
- M10：表行数 = 账号×权限，量级极小；每请求直读可接受；如需要再加短 TTL 缓存（本期不做）。

**已验收功能保护**：管理员恒真，先保证今天 admin 全部可用；普通账号在未写权限行时按默认集返回（`hasPermission` 对默认集内置 true），所以即便权限表为空，普通账号现状能力不回退。

**验证与回滚**：m78 单测；回滚=删除模块并撤销调用。

### P0-4 account-context 改造

**目标**：前端拿到当前账号实际权限。

**具体操作**：
1. `auth.ts` `accountContextApi`：新增 `permissions: AccountPermission[]` = 管理员全量，普通账号 = 默认集 ∪ 表内授予集。
2. 兼容策略（决策点）：本期先“新增数组 + 保留旧布尔字段”，前端消费数组；m21 断言两者；下一批再删布尔字段。
3. 前端 `AuthStatus` 增加 `permissions`。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R11 | m21 断言失败 | 响应结构变更 | 契约测试红 |
| R12 | 前端旧代码读不到新字段 | 只加字段不消费 | 无影响（增量） |
| R13 | 权限数组与布尔字段不一致 | 计算逻辑分叉 | 前端误导 |

**应对**：
- M11：同步更新 m21（37–42 行）为“布尔字段 + 数组”双断言。
- M12：本期前端只读数组；布尔字段仅供兼容，不新增消费点。
- M13：数组是唯一事实来源，布尔字段由数组派生（避免两套逻辑）。

**已验收功能保护**：新增字段不回退；`/connections`、画布等现有消费不受影响。

**验证与回滚**：m21 更新后全绿；回滚=撤销字段与断言。

### P0-5 权限管理 API

**目标**：管理员可读/写指定账号权限。

**具体操作**：
1. 在 `auth.ts`（`adminUsersApi`）或新 `server/accountPermissionsApi.ts` 增加：
   - `GET /api/admin/users/:id/permissions` → `{ permissions: AccountPermission[] }`；
   - `PUT /api/admin/users/:id/permissions`，body `{ permissions: string[] }`；
   - 守卫 `hasPermission(identity,"manage_permissions")`；
   - 参数校验、404（账号不存在）、403（无权限/越权目标）、400（白名单外）。
2. `vite.config.ts` 注册 `/api/admin/users` 下的新子路径（或独立前缀）。
3. `server/openApi.ts` 登记。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R14 | 越权改管理员 | 目标账号是 admin | 破坏角色模型 |
| R15 | 把自己锁死 | 改自己权限 | 管理面不可恢复 |
| R16 | 非法权限值入库 | 白名单缺失 | 数据脏 |

**应对**：
- M14：目标 role=admin → 返回全量且拒绝写入（或仅允许全量写入）。
- M15：API 层禁止移除当前管理员的 `manage_accounts/manage_permissions`；测试断言。
- M16：`isAccountPermission` 逐项校验，非法整体 400。

**已验收功能保护**：新接口不影响既有接口；m11 账号管理回归继续绿。

**验证与回滚**：m78 API 段；回滚=移除路由与 OpenAPI 条目。

### P0-6 六处硬编码守卫替换

**目标**：管理能力全部走权限检查，同时保持管理员行为不变。

**具体操作**（逐文件）：
1. `server/auth.ts:581` → `hasPermission(identity,"manage_accounts")`；同时把 `adminUsersApi` 从“自调 authenticate”改为统一 `requestIdentity`（收敛鉴权写法）。
2. `server/modelCatalog.ts:793` → `manage_models`。
3. `server/providerProfiles.ts:1590` → `manage_providers`。
4. `server/providerCatalog.ts:1587` → `manage_providers`。
5. `server/storageAdmin.ts:145` → `manage_storage`。
6. `server/generationSafety.ts:644` → `manage_generation_safety`。
7. 新增“权限矩阵测试”：无权限普通账号对 6 类管理接口逐一断言 403，管理员 200。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R17 | 漏改某子路径 | 接口内部多个分支 | 未授权访问残留 |
| R18 | adminUsersApi 鉴权方式改变引入回归 | 会话/绕过路径差异 | 账号管理不可用 |
| R19 | 403 文案变化被测试断言 | 错误信息不同 | 测试红（易修） |

**应对**：
- M17：以 §3.3 清单为基线逐文件核对；权限矩阵测试覆盖每个管理 API 的每个方法。
- M18：`adminUsersApi` 改后立即跑 m11 全量；`requestIdentity` 依赖 authGate 已置身份（测试 bypass 同样覆盖）。
- M19：保留原 403 文案或同步更新断言；文案不是安全边界。

**已验收功能保护**：管理员恒真 ⇒ 管理功能与今天完全一致；普通账号从未有权访问这些接口，语义不变。

**验证与回滚**：m11/m12/m13/m14/m15 + m78 矩阵；回滚=还原 6 处守卫。

### P0-7 前端权限消费

**目标**：路由与菜单按权限显隐。

**具体操作**：
1. `client/src/App.tsx` 新增 `hasClientPermission(permissions, permission)`（管理员恒真）。
2. 六个 `/admin/*` 路由守卫（6486–6525 行）从 `role !== "admin"` 改为权限判断。
3. 账号浮层（6562–6600 行）菜单按权限渲染。
4. 直链无权限页面 → 重定向 `/`。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R20 | 前端权限与后端不同步 | 缓存/旧包 | 显示入口但接口 403（安全仍有效，仅体验） |
| R21 | 管理员误判 | 权限数组缺失 | 管理菜单消失 |
| R22 | m0/m11 断言菜单结构 | 按钮增减 | 测试红 |

**应对**：
- M20：前端权限仅做展示，安全以后端为准；刷新即同步。
- M21：`hasClientPermission` 对 admin 恒真；account-context 故障时降级为仅显示「我的连接/工作空间」。
- M22：同步更新 m0 账号浮层测试与 m11 断言。

**已验收功能保护**：普通账号默认集=现状 ⇒ 菜单与今天一致；管理员全量 ⇒ 菜单不变。

**验证与回滚**：m0/m11/m21；回滚=还原守卫与浮层。

### P0-8 AdminAccounts 权限编辑 UI

**目标**：管理员在账号管理页逐账号授予/撤销权限。

**具体操作**：
1. `App.tsx` `AdminAccounts`（565–660 行）：每个用户卡片增加「权限」区：
   - 管理员行：只读显示“管理员（全部权限）”；
   - 普通账号行：12 项权限 checkbox 网格，全部使用 `className="admin-compact-checkbox"`（m45 会检查）；
   - `manage_accounts/manage_permissions` 对普通账号默认禁用（决策点若允许授予则放开）；
   - 「保存权限」按钮 + 加载/成功/失败反馈。
2. 保存走 `PUT /api/admin/users/:id/permissions`；成功后刷新列表。
3. 同步更新 `m45-admin-checkbox-system.spec.ts`：该测试断言源码里 checkbox 总数（当前 12 个），新增权限 checkbox 会使数量变化，需把“数量断言”改为“集合断言”或更新数量，并断言新 checkbox 也带 `admin-compact-checkbox`。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R23 | m45 数量断言红 | 新增 checkbox | 测试失败（预期内，需同步） |
| R24 | checkbox 误继承 46px 输入样式 | 选择器过宽 | 布局破坏 |
| R25 | 保存失败状态不显示 | 前端无错误分支 | 用户以为成功 |

**应对**：
- M23：先改 m45 断言再合入 UI（同一 commit），并新增权限区断言。
- M24：复用 `.admin-card .admin-compact-checkbox` 既有类与样式，不新增裸 checkbox；m45 回归。
- M25：保存按钮 busy 态 + 错误文案 + 服务端 4xx 原样展示。

**已验收功能保护**：账号管理页其它功能（创建/停用/删除）不动；m11 回归。

**验证与回滚**：m45/m78 UI 段 + m11；回滚=移除权限区。

### P0-9 删除账号级联与审计查询

**目标**：删除账号不残留权限行；权限变更可追溯。

**具体操作**：
1. `auth.ts` 删除事务（702–736 行）追加 `DELETE FROM account_permissions WHERE account_id = ?`（与 CASCADE 双保险），删除后断言 0 行。
2. 审计查询（可选）：账号详情展示最近权限变更（`admin_audit_events WHERE action='account_permissions.update'`）。

**可能风险**：
| 编号 | 风险 | 触发条件 | 影响 |
|---|---|---|---|
| R26 | 漏删 | 只依赖 CASCADE | 残留权限行 |
| R27 | 删除事务失败 | 新表外键 | 整单回滚，账号未删（安全） |

**应对**：
- M26：显式 DELETE + 断言；m78 覆盖。
- M27：外键引用 users(id) 且 granted_by 存在性在写入时保证；删除失败按现有事务回滚语义处理。

**已验收功能保护**：删除事务其它表顺序不变；m11 删除回归。

**验证与回滚**：m78 + m11；回滚=去掉显式 DELETE（CASCADE 仍兜底）。

### P0-10 权限能力回归与文档收口

**目标**：全量验证与文档同步。

**具体操作**：
1. 全量相关回归：m11/m12/m13/m14/m15/m21/m43/m45/m46/m49/m52/m56/m58/m78。
2. TASKS.md 记录；验收矩阵新增权限条目；OpenAPI 收口。
3. commit（按 WBS 建议粒度）。

**可能风险**：回归暴露旧基线失败（m26/m38/m46 端口等）——按既有清单单独标注，不归本批。
**应对**：新增失败必须能解释到本批改动；无法解释则回退该小点。

## P1 公共模板

### P1-1 v30 数据模型与种子迁移

**具体操作**：
1. `server/database.ts` 追加 `public_templates` 表（含 status/cover/created_by/updated_by/archived_at）。
2. 迁移内 `INSERT OR IGNORE` 两条种子（`templateCatalogData.json`）。
3. 迁移幂等测试。

**风险/应对**：
- R30 种子丢失→启动后公共列表为空：`INSERT OR IGNORE` + m22 契约兜底；迁移失败即启动失败而非静默空表。
- R31 迁移编号冲突：开工前定稿（见 P0-2 决策）。
- R32 真实库升级：先备份、临时库演练。

**已验收保护**：`m22` 两条种子可见性不变；`space=mine` 不动。

### P1-2 公共模板存储层

**具体操作**：
1. 新增 `server/adminTemplates.ts`：
   - `listPublicTemplates`（q/category/status/limit/offset/includeGraph）；
   - `publicTemplateCard`（对齐 `userTemplateCard`：categories/cover/previewImage/graph）；
   - `savePublicTemplate/updatePublicTemplate/archivePublicTemplate/deletePublicTemplate`；
   - 审计写 `admin_audit_events`。
2. `server/templateCatalog.ts` 需要把 `validTemplateGraph`（303 行）、`categories`（105 行）、`userTemplateCard`（436 行）导出或抽到共享模块。

**风险/应对**：
- R33 导出私有函数改变模块表面：只加 `export`，不改实现；tsc 与 m22/m71 回归。
- R34 校验逻辑复制导致漂移：直接导出复用，不复制。
- R35 状态机非法转移：save/update/archive 各自校验合法转移（draft→published→archived→draft? 定义转移表）。

**已验收保护**：私有模板路径不动；公共路径在 P1-4 才切换数据源。

### P1-3 管理员 CRUD API

**具体操作**：
1. `adminTemplatesApi`：GET/POST/PATCH/DELETE；守卫 `manage_public_templates`；审计。
2. 路由注册 `/api/admin/templates`；OpenAPI 登记。
3. 删除语义按决策（归档+恢复 或 硬删）。

**风险/应对**：
- R36 普通账号越权：守卫 + 矩阵测试 403。
- R37 图结构校验遗漏：复用 `validTemplateGraph`。
- R38 删除影响正在使用模板的画布：模板导入是快照复制，画布不引用模板 ID，删除公共模板不影响已导入画布（写进验收说明）。

### P1-4 公共 GET 改库

**具体操作**：
1. `templateCatalog.ts` `space=public` 分支改读 `public_templates WHERE status='published'`。
2. 响应结构保持：`categories/items/pagination`；`includeGraph` 行为不变。
3. 静态 JSON 降级为迁移种子来源；删除运行时依赖（或保留只读 fallback，决策点）。

**风险/应对**：
- R39 公共列表行为回归：m22 契约 + m0 模板段回归；新增“归档后消失”“草稿不可见”断言。
- R40 性能：表行数极小，分页沿用内存过滤→改 SQL 过滤；limit≤100 不变。
- R41 与私有分支共用 categories：保持导出同一个白名单。

**已验收保护**：响应结构与字段名完全不变；前端无需改动即可继续工作（除新增管理入口）。

### P1-5 管理员模板管理页

**具体操作**：
1. `App.tsx` 新增 `AdminTemplatesPage` + `/admin/templates` 路由（守卫 `manage_public_templates`）。
2. 列表卡 + 新建/编辑弹窗 + 状态胶囊 + 上下架/归档/删除 + ConfirmDialog。
3. 样式遵守 12/14px、灰阶、紧凑控件。

**风险/应对**：
- R42 与模板面板样式漂移：复用既有 `.template-card` 视觉语言与 `admin-card` 布局。
- R43 删除误触：ConfirmDialog（现有组件）；危险按钮语义按 UI 规范 §5.1 单独确认。
- R44 权限不足用户直达：路由守卫 + 服务端 403。

### P1-6 浏览全部管理入口 + 面板适配

**具体操作**：CanvasShell 浏览全部侧栏对管理员显示「管理公共模板」；公共卡片永无删除按钮。
**风险/应对**：
- R45 m0/m70/m71 断言菜单/卡片结构：同步测试。
- R46 管理员入口判断用 permissions（P0-7 已就绪）。

### P1-7 公共模板导入与素材兼容

**具体操作**：新增集成测试：管理员发布含素材公共模板 → 普通账号导入 → 不刷新可见、刷新仍在。
**风险/应对**：
- R47 素材地址/权限：公共模板素材 assetId 必须归属发布者且仍可读；若素材被删，导入后节点显示缺失提示（沿用 normalize 规则），封面降级渐变。

### P1-8 最近使用（可选）

**具体操作**：localStorage v2（按账号）记录最近导入；「最近使用」分类倒序。
**风险/应对**：
- R48 跨标签/跨账号串数据：key 带 userId + projectId 语义（只按账号即可）；测试断言不串。
- R49 与现有“最近使用”空态冲突：无记录时回落原行为。

### P1-9 公共模板回归与收口

**具体操作**：m22/m70/m71/m77/m0 模板段全量；TASKS.md/验收矩阵/OpenAPI；commit。

## P2 可选（普通能力收回）

### P2-1 生成权限
**操作**：`generationTasks.ts` preflight 与 POST submit 入口加 `hasPermission(identity,"generate")`；可用性接口（`/api/generation-tasks/status`、`/api/models`）同步“未授权”原因。
**风险**：普通账号默认集含 generate ⇒ 默认无回退；授权测试用 A/B 账号断言提交 403 且零任务。

### P2-2 批量下载权限
**操作**：`groupDownload.ts:231` 入口（identity 检查后）加 `group_download`。
**风险**：已验收 D-01~D-06 默认授予不回退；m72 回归 + 403 断言。

### P2-3 项目管理权限
**操作**：`projects.ts:189` 写操作（POST/重命名/删除/clone）加 `manage_projects`；GET 保持所有登录账号可读。
**风险**：默认授予不回退；m66 回归 + 403 断言。

## 附：每步回归与提交对照

| 步骤 | 专项测试 | 必须回归 | 建议提交 |
|---|---|---|---|
| P0-1 | m78 单测 | tsc/build | 1（底座） |
| P0-2 | 迁移测试 | m10/m44 迁移类 | 1 |
| P0-3 | m78 单测 | m11/m21 | 1 |
| P0-4 | m78 | m21 | 2（接口+守卫） |
| P0-5 | m78 API | m11 | 2 |
| P0-6 | m78 矩阵 | m11-m15/m43/m46/m49/m52/m56/m58 | 2 |
| P0-7 | m78 UI | m0/m11/m21 | 3（前端） |
| P0-8 | m78 UI + m45 | m11 | 3 |
| P0-9 | m78 | m11 | 4（级联+收口） |
| P0-10 | 全量 | 上述全部 | 4 |
| P1-1 | m77 迁移 | m22 | 5（数据+存储+API） |
| P1-2 | m77 存储 | m71 | 5 |
| P1-3 | m77 API | m11/m21 | 5 |
| P1-4 | m77 | m22/m0/m70/m71 | 6（公共 GET+管理页+入口） |
| P1-5 | m77 UI | m45 | 6 |
| P1-6 | m77 | m0/m70/m71 | 6 |
| P1-7 | m77 集成 | m71 | 7（导入+收口） |
| P1-8 | m77 | m0 | 7（可选） |
| P1-9 | 全量 | 上述全部 | 7 |

## 下一轮讨论问题

1. 权限表与公共模板表的迁移版本号分配（v30/v31 顺序）。
2. account-context：先加数组并保留布尔，还是直接替换。
3. 公共模板删除：归档+恢复 vs 硬删；种子模板是否允许删除。
4. 最近使用：本批本地版、服务端版、还是不做。
5. `manage_accounts/manage_permissions` 是否可授予非管理员。
6. 普通能力收回（P2）是否本批纳入。
7. 是否给权限系统加环境开关（默认开）以便紧急回退。
8. 公共模板是否允许普通账号“投稿待审”（默认不做）。
