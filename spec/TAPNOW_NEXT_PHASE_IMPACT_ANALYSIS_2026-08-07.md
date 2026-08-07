# 全量影响分析：账号权限管理 × 公共模板（逐行级）

状态：`ANALYSIS COMPLETE / PENDING USER REVIEW 2026-08-07`
基线：当前 `main` 提交 `500d24c`
对象方案：`spec/TAPNOW_NEXT_PHASE_WBS_2026-08-07.md` 与 `spec/TAPNOW_NEXT_PHASE_WBS_DETAIL_2026-08-07.md`
方法：对方案每一步与现状代码逐文件、逐函数、逐符号比对；所有结论附文件:行号；重点核查“已验收功能是否会回退”。

## 0. 总体结论（先看这里）

1. **方案方向可行，但有两个方案级缺口必须先在实施前补上**：
   - H1：公共模板若嵌入发布者自己的素材（assetId），其他账号导入后**必然 404**——因为 `server/mediaRegistry.ts` 的读取是 owner 隔离（36–52 行），且导入补全会生成 `/api/assets/<id>` 给非 owner 账号。P1-7 的验收测试会失败。必须在方案里选一个跨账号读取策略。
   - H2：`public_templates` 表草案**没有 previewImage 列**，两条种子模板的静态封面图（`/templates/*.png`）迁移后会丢，公共卡片封面变空白。
2. **权限方案整体安全**，但有一处必须按现状事实修正：`/api/admin/users` 在中间件里注册于 `/api` authGate **之前**（`vite.config.ts:149` vs `152`），所以 `adminUsersApi` 只能自己 `authenticate()`。P0-6 若直接改成 `requestIdentity()` 会让账号管理接口失去身份，必须同步调整中间件顺序或保留现状写法。
3. **测试连锁面比方案清单大**：m20（OpenAPI 路径/操作数）、m44（迁移列表 19–29 → 需加 30/31）、m45（checkbox 源码计数 12）、m22（公共列表来源与总量）、m21/m11（account-context/账号管理）都要同步；m77/m78 必须独立配置并自清理，否则会污染共享临时库中的 m22 总量断言。
4. **已验收功能在“管理员恒真 + 普通账号默认集=现状”前提下不回退**；主要风险集中在“公共模板数据源切换”与“权限 UI/路由”两层。

## 1. 分析方法与范围

- 只读扫描 + 逐段阅读：`server/auth.ts`、`server/templateCatalog.ts`、`server/mediaRegistry.ts`、`server/database.ts`、`server/openApi.ts`、`vite.config.ts`、`client/src/App.tsx`、`client/src/canvas/CanvasShell.tsx`、`client/src/canvas/CanvasSurface.tsx`、`client/src/canvas/GroupNode.tsx`、相关测试。
- 分析维度：有利影响 / 不利影响 / 隐患 / 可能 bug / 逻辑错乱 / UI 混乱 / 与已验收功能冲突 / 修正建议。
- 每步结论尽量给到“哪个文件哪一行、哪个函数、哪个断言”。

## 2. 全局有利影响

1. 鉴权从“硬编码 role”收敛为“权限表 + 统一入口”，后续新增管理能力只需登记枚举，不再散落 `role !== "admin"`。
2. 公共模板从静态 JSON 变为数据库可管理，管理员可上下架/编辑/审计，不再需要改代码发布模板。
3. 权限变更全量审计，配合现有 `admin_audit_events`，可回答“谁在什么时候给了谁什么权限”。
4. 普通账号默认集=现状能力，权限系统上线不改变现有用户行为，回退面小。
5. 公共模板与“我的模板”共用同一套图校验/封面/导入链路，代码复用度高，长期维护成本下降。

## 3. 全局不利影响与共性风险

1. 引入两套权限事实来源（users.role + account_permissions），若后续有人忘记 `hasPermission` 而直接用 role，会出现守卫不一致（本次会把 6 处替换掉，但未来新增管理 API 可能漏）。
2. 公共 GET 数据源从“进程内常量”变为“SQLite 查询”，服务启动依赖迁移成功；迁移失败即公共模板全空（比现在“永远有两条”更脆）。
3. 新增两张表 + 两个管理接口群，会让 OpenAPI、验收矩阵、备份 manifest、迁移测试同步改动，任何一处漏改都会红测试或文档失实。
4. 前端开始消费 permissions 后，账号权限变更的“即时性”受刷新约束：改他人权限他人需刷新；改自己权限（允许的自改场景）需立即刷新，否则 UI 与后端短暂不一致。

## 4. 关键隐藏问题（跨步骤，优先级最高）

### H1 公共模板素材跨账号读取（P1 致命缺口）

- 现状：`server/mediaRegistry.ts` `mayReadMedia`（36–52 行）只允许 `owner_id` 匹配（bypass 除外）；`readableMediaForOwner`（65–110 行）同样 owner 过滤。客户端导入公共模板时若节点带 `assetId`，`normalizePersistedMediaNodes`（`client/src/canvas/CanvasSurface.tsx` 导入路径）会生成 `/api/assets/<id>`，非 owner 账号请求即 404。
- 触发条件：管理员发布“含自己上传素材”的公共模板；普通账号导入。P1-7 的验收测试必挂。
- 影响：素材节点导入后空白/缺失提示；公共模板只能退回“上传位占位”形态，能力打折。
- 三个可选修正（需用户选）：
  a) **发布时复制素材到公共池**：新增 `public_template_assets`（或 media_assets 增加 public 标志与公开读取路由），发布模板时复制/登记，公共列表封面与导入都走公开路由；删除模板时回收。安全可控、体验最好，但多一套媒体生命周期。
  b) **公共模板禁止嵌入私有素材**：只允许上传位/占位节点（与现有两条种子一致），封面用管理员上传的静态图或渐变。实现最小，但“模板带图”能力缺失。
  c) **按模板白名单放开读取**：`mayReadMedia` 增加“该 assetId 在已发布公共模板的图内”放行。注意不能放行整目录，且要防枚举/防盗链；实现要非常小心。
- 建议：先选 b（最小可靠），把 a 作为后续增强；并在方案中明确“公共模板本期不携带私有素材”。

### H2 public_templates 缺 previewImage 列（P1 数据缺口）

- 现状：种子模板卡片依赖 `previewImage: "/templates/*.png"`（`server/templateCatalogData.json` 5 行、424 行；客户端 `CanvasShell.tsx` 用 `card.previewImage` 渲染 `<img>`）。
- 问题：v30 草案只有 `cover_asset_id`，没有 previewImage；迁移后公共卡片无封面。
- 修正：表增加 `preview_image TEXT`（可空）；种子迁移写入 `/templates/*.png`；管理员新建模板可上传封面素材生成 preview_image（或复用 cover 三级规则生成）。

### H3 公共模板多分类语义（P1 逻辑）

- 现状：种子 `categories` 是数组（各 1 个“电商”）；公开 GET 的筛选语义是“分类包含”（`templateCatalog.ts:663-677`，`template.categories.includes(category)`）。
- 问题：v30 草案 `category TEXT` 单值，未来管理员想挂两个分类会丢失；且“最近使用/我的模板/全部”是筛选桶，不应入库。
- 修正：把 `category` 定为 JSON 数组文本（`CHECK (json_valid(category))`）并在响应中解析；或本期先单值并明示限制。另外新增“真实分类白名单”`REAL_CATEGORIES`（电商/广告/影视/生活/工具/有趣/ACG/Seedance 2.0），与筛选桶分开。

### H4 /api/admin/users 的中间件顺序（P0-6 修正项）

- 现状：`vite.config.ts` 149 行注册 `/api/admin/users`（直接进 `adminUsersApi`），152 行才注册 `/api` authGate；所以 `/api/admin/users` 的请求**不会经过 authGate**，`requestIdentity` 未被设置，`adminUsersApi` 只能自己 `authenticate()`（`auth.ts:581` 附近）。
- 若按 P0-6“收敛鉴权”改成 `requestIdentity()`，账号管理接口将全部 401/403。
- 修正：把 `/api/admin/users` 的注册移到 `/api` authGate 之后（或让 authGate 显式包含该前缀），再统一用 `requestIdentity()`；改完必须 m11 全量回归。

### H5 分类白名单包含筛选桶（既有隐患，方案会继承）

- 现状：`templateCatalog.ts:105-116` 的 `categories` 含“最近使用/我的模板/全部”；`saveUserTemplate`（531 行附近）用 `categories.includes(category)` 校验，因此**现在就能把“我的模板”存成私有模板分类**（语义错误但无破坏）。
- 公共模板复用同一白名单会把隐患放大：管理员可能存出“最近使用”这种桶分类，列表筛选逻辑错乱。
- 修正：本次新增 `REAL_CATEGORIES`（不含三个桶），`saveUserTemplate` 与公共模板校验统一改用它；顺带修掉既有隐患（属“顺手修”，需在 TASKS.md 记录）。

### H6 测试连锁清单（比方案 §7 更长）

| 文件:行号 | 断言 | 影响 |
|---|---|---|
| `tests/m20-api-contract.spec.ts:128-129` | 20 个 article、15 条路径 | 新增 /api/admin/templates、/api/admin/users/:id/permissions 等 → 数量变，必须同步 |
| `tests/m44-provider-profile-atomicity.spec.ts:693` | 迁移列表 19–29 | 加 v30/v31，必须同步 |
| `tests/m45-admin-checkbox-system.spec.ts:75` | checkbox 源码计数 = 12 | 权限区新增 checkbox → 必须改为集合断言或动态计数 |
| `tests/m22-template-contract.spec.ts:27` | public 总量 = 2 | 公共 GET 改库后种子仍需保证 2；m77 若同库必须先清理 |
| `tests/m21-account-contract.spec.ts:37-42` | permissions 结构 | 加数组后双断言 |
| `tests/m11-auth.spec.ts` | 账号管理 403/删除 | 权限守卫替换 + 中间件顺序变化，必须全量回归 |
| `tests/m0-shell.spec.ts` | 账号浮层/菜单 | 菜单按权限显隐后需同步 |
| `tests/m10-backup.spec.ts` / `scripts/verify-backup.mjs` | manifest schemaVersion | 新增迁移后，旧备份恢复校验会与 currentSchemaVersion 不一致；新备份不受影响，需在文档说明 |

### H7 m77/m78 测试隔离

- 组合回归（如 m75-full）共享一个临时数据目录：m77 若创建公共模板后不删除，会改变 m22 的 total=2 断言；m78 创建账号/权限后不清理，会影响 m11 账号列表。
- 修正：m77/m78 用独立 config（仿 m71/m72），测试内清理（删除创建的模板/账号），并在组合跑前先跑独立套件。

### H8 CanvasShell 需要新增权限入参

- 现状：`CanvasShell` 只在 `App.tsx` 两处渲染（6639、6640–6648），props 无 role/permissions。
- 影响：要在浏览全部里显示“管理公共模板”入口，需要给 CanvasShell 传 `permissions`（或 role）；改动面小但必须同步 fixture 挂载与相关测试。

### H9 改自己权限的即时性

- 若管理员在账号页改自己权限（如去掉 manage_models），页面当前 `AuthStatus` 不会自动刷新，账号浮层/路由仍按旧权限渲染，出现“前端还能进，后端已 403”的短暂不一致。
- 修正：改自己权限成功后强制重新拉取 account-context 或整页刷新；或对当前登录管理员禁止编辑自己权限（建议：禁止自改，避免误锁）。

### H10 账号列表权限读取的 N+1

- `GET /api/admin/users`（`auth.ts:592-602`）返回用户列表；权限 UI 需要每账号权限。逐账号查权限会有 N+1。
- 修正：扩展该接口一次聚合返回 `permissions`（`GROUP BY account_id`），或权限区懒加载（展开才查）。

## 5. P0 步骤逐条影响分析

### P0-1 权限类型与默认集

- 有利：单一来源、前后端共用、中文文案。
- 不利/隐患：`types/` 被服务端与客户端共用后，任何 import 变化会同时影响两端构建；`DEFAULT_USER_PERMISSIONS` 若与现状不一致（漏项）会静默回退普通账号能力。
- 可能 bug：把“筛选桶”误当权限名；权限名拼写错误导致前端显示与服务端校验不同步。
- 已验收冲突：无（纯新增类型）。
- 修正：默认集逐项对照现状接口（projects/generation/group-download/template/credentials 全部对登录账号开放）；m78 用快照断言锁死。

### P0-2 v31 迁移

- 有利：表结构简单、CASCADE 级联。
- 不利/隐患：迁移编号需与 P1 的 v30 定稿；真实库升级前必须备份；`PRAGMA foreign_keys=ON` 依赖 `openAppDatabase`（已是）。
- 可能 bug：`permission TEXT` 无 CHECK 约束——应用层白名单能挡住，但直接改库可写入任意值；建议加 CHECK 或接受应用层约束（SQLite 加 CHECK 需枚举，枚举变化要迁移，建议应用层）。
- 已验收冲突：m44 迁移列表断言、备份 manifest schemaVersion。
- 修正：先备份+临时库演练；同步 m44。

### P0-3 权限服务

- 有利：统一入口、审计、防自锁。
- 不利/隐患：`hasPermission` 每请求查库（量小可接受）；`recordAudit` 目前是 `auth.ts` 私有函数（约 228 行），需要导出或复制，复制会造成审计字段漂移。
- 可能 bug：全删全插时并发两个 PUT 会互相覆盖且审计 diff 不准；目标账号为 admin 时若忘记强制全量会破坏角色模型。
- 逻辑错乱：默认集（表外隐含）与表内授予集并存，读权限时若忘加默认集会误判；写权限时若把默认集也写进表，会造成“撤销不了默认能力”的假象（需要决定：默认集是否可被管理员撤销——本期默认集不可撤销，写接口只管理“额外授予集”）。
- 已验收冲突：无（新增模块），但 m11 中账号管理行为不变。
- 修正：写接口只维护“额外授予集”（默认集永远生效）；事务内先读后 diff；导出 recordAudit。

### P0-4 account-context 改造

- 有利：前端拿到真实权限。
- 不利/隐患：响应多一个字段；m21 断言要同步。
- 可能 bug：数组与布尔对象派生逻辑分叉（应数组为唯一来源）；普通账号若表内授予集与默认集冲突（如被授予 manage_models）要正确合并。
- UI 混乱：前端若先消费数组，旧布尔字段仍返回但不再更新，会有“两套数据”的维护困惑；须明确布尔字段只读兼容、不更新。
- 已验收冲突：m21（37–42 行）会红，属预期内同步。

### P0-5 权限管理 API

- 有利：可授予/撤销、审计、404/403 明确。
- 不利/隐患：新接口在 `auth.ts` 或新模块注册路径需与 H4 中间件顺序一致；目标账号校验（`userIdPattern` 允许非 UUID）复用。
- 可能 bug：`PUT` 未校验目标存在（先 404）；权限数组含重复值/未知值（400）；`granted_by` 引用不存在的管理员（外键会拦，但要先查）。
- 逻辑错乱：管理员目标“返回全量”与“写入只允许全量”的语义要写清楚，否则 UI 误以为能改管理员。
- 已验收冲突：m11 的账号管理断言若含新子路径的 403 需补。

### P0-6 六处守卫替换 + 收敛鉴权

- 有利：守卫统一。
- 不利/隐患：H4 是硬性前置；6 处 403 文案不同，替换后错误信息可能变化，相关测试若断言文案需同步。
- 可能 bug：`hasPermission` 对 `identity` 为空（中间件漏跑）的调用——每个 API 先判 401 再判权限，顺序不能反。
- 已验收冲突：m12/m13/m14/m15/m43/m46/m49/m52/m56/m58 全部要回归（管理员行为不变所以预期全绿）。
- 修正：加“权限矩阵测试”逐接口断言；`adminUsersApi` 的鉴权方式收敛必须先改中间件顺序。

### P0-7 前端权限消费

- 有利：路由/菜单与权限一致。
- 不利/隐患：`AuthStatus`（`App.tsx:52`）结构变化波及所有消费方；fixture 页面在 bypass 下 userId=`__test__`、role=admin，permissions 应全量。
- 可能 bug：`hasClientPermission` 若把“未登录/未加载”误判为有权限，会短暂显示入口（后端仍拦）；若误判为无权限，管理员菜单消失。
- UI 混乱：账号浮层从“管理员一堆按钮”变为按权限显示后，非管理员被授予 manage_public_templates 时只多一个入口，文案与视觉要与管理员区分。
- 已验收冲突：m0 浮层、m11 路由断言。

### P0-8 AdminAccounts 权限编辑 UI

- 有利：可视化授予/撤销。
- 不利/隐患：m45 计数断言（12）必红；checkbox 若未带 `admin-compact-checkbox` 会触发 m45 源扫描失败。
- UI 混乱：12 个 checkbox 平铺会很长，建议分“管理能力 / 普通能力”两组；普通账号行禁用两个总钥匙要有 tooltip 说明。
- 可能 bug：保存时把默认集也提交，导致后续“撤销默认能力”语义混乱（见 P0-3）；勾选状态与服务端不一致（刷新恢复）。
- 已验收冲突：账号管理其它按钮（创建/停用/删除）不动；m11 回归。

### P0-9 删除账号级联

- 有利：双保险清理。
- 不利/隐患：删除事务新增一条 DELETE，失败会整单回滚（安全）；外键 CASCADE 与显式 DELETE 并存需测试确认无冲突。
- 可能 bug：若迁移未生效（老库）就删账号，SQL 会因表不存在报错——迁移必然先于运行，理论不存在，但建议删除事务对表存在做保护或依赖 schema 版本。

### P0-10 收口

- 风险集中在“回归红测试是否都能解释到本批”；已知基线失败清单要单独标注。

## 6. P1 步骤逐条影响分析

### P1-1 v30 数据模型与种子迁移

- 有利：模板可管理、可审计。
- 不利/隐患：H2（previewImage 缺列）、H3（多分类语义）；种子迁移若与真实库已存在同名 id 冲突（理论无，种子只在空表插入）需 `INSERT OR IGNORE`。
- 可能 bug：迁移里读 JSON 文件（`templateCatalogData.json`）需要 import attribute（与 `templateCatalog.ts:2` 相同写法）；若迁移模块与模板模块循环依赖，会启动失败——建议迁移内直接内联种子数据或从 JSON 静态导入，避免运行时依赖。
- 已验收冲突：m22 总量=2 依赖种子存在；m0 模板面板。

### P1-2 公共模板存储层

- 有利：复用校验与卡片结构。
- 不利/隐患：需要导出 `validTemplateGraph/categories/userTemplateCard`（当前私有，行号 105/303/436），导出后模块公共面扩大，但没有行为变化。
- 可能 bug：`parseTemplateGraph` 读取 DB 时若管理员存了“合法但结构旧”的图，读端会丢图（返回 undefined）——写入端已校验，属防御性兜底。
- 逻辑错乱：状态机（draft/published/archived）转移规则未在方案定义清楚（如 archived→draft 是否允许），建议先定转移表。

### P1-3 管理员 CRUD API

- 有利：完整管理能力 + 审计。
- 不利/隐患：普通账号 403 语义（404 还是 403）需与“我的模板”删除（404 不泄露）统一决策；公共模板管理建议对非授权账号返回 403（管理面无泄露风险）。
- 可能 bug：删除后公共 GET 仍返回（缓存/索引问题）——查询必须实时读库，不能加长缓存。
- 已验收冲突：无（新接口）。

### P1-4 公共 GET 改库

- 有利：管理即时生效。
- 不利/隐患：响应结构必须逐字段保持（categories/items/pagination/includeGraph）；分类筛选在 SQL 层要等价实现“最近使用/全部/我的模板”桶语义（桶不入库）。
- 可能 bug：`limit=100` 等参数校验逻辑若复制到新查询会漏（应复用 `boundedInteger`）；分页 total 由 COUNT 计算。
- 已验收冲突：m22 是主要风险点（总量、图节点数、分类）；m0 模板面板。

### P1-5 管理员模板管理页

- 有利：可视化 CRUD。
- 不利/隐患：新页面要复用 `admin-card` 与模板卡片视觉，避免第三套样式；删除用 ConfirmDialog（现有组件）。
- UI 混乱：与“浏览全部”里的管理入口语义重复，建议管理页为唯一权威入口，浏览全部只做跳转。
- 可能 bug：编辑弹窗保存时若标题/分类/图校验失败，错误要就地显示（复用 GroupNode 弹窗模式）。

### P1-6 浏览全部管理入口

- 有利：管理员便捷入口。
- 不利/隐患：H8（CanvasShell 需新增 permissions 入参）；入口判断必须用权限而非 role，否则“被授权普通账号”看不到入口。
- UI 混乱：普通账号在浏览全部里看到“管理公共模板”但点了 403 最差——必须按权限显隐。

### P1-7 公共模板导入与素材兼容

- 有利：验收闭环。
- **不利/致命**：H1（跨账号素材读取）若采用方案 b（不带私有素材），本步退化为“上传位模板导入测试”；若采用 a，需要新增公开媒体路由与生命周期。方案当前文本写的“含素材公共模板”与现状 owner 隔离冲突，必须二选一并更新方案。

### P1-8 最近使用（本地版）

- 有利：分类可用、不动服务端。
- 不利/隐患：localStorage 与账号隔离（key 带 userId）；fixture 测试中 userId 稳定（__test__）避免串数据；隐私（本机数据）可接受。
- 可能 bug：localStorage 满/被禁用时需 try/catch 降级；模板被删后“最近使用”里残留 id，点击应静默跳过（列表过滤失效项）。

### P1-9 收口

- 与 P0-10 相同：所有红测试必须可解释；m22/m70/m71/m77/m0 全量。

## 7. P2 简述

- 生成/下载/项目三个入口加权限后，默认集保证不回退；但“生成可用性”接口（`/api/generation-tasks/status`、`/api/models`）也要反映未授权原因，否则前端仍显示可生成但提交 403。本批不做，已定稿。

## 8. 必须同步的既有测试/文档清单（表）

| 位置 | 当前值 | 变化 | 动作 |
|---|---|---|---|
| `tests/m20-api-contract.spec.ts:128-129` | 20 article / 15 路径 | +admin 接口 | 更新数量与路径列表 |
| `tests/m44-provider-profile-atomicity.spec.ts:693` | 19–29 | +30/31 | 更新迁移列表 |
| `tests/m45-admin-checkbox-system.spec.ts:75` | 12 | +权限 checkbox | 改集合断言 |
| `tests/m22-template-contract.spec.ts:27` | total 2 | 数据源换库 | 保持种子 2 + m77 独立清理 |
| `tests/m21-account-contract.spec.ts:37-42` | permissions 布尔 | +数组 | 双断言 |
| `tests/m11-auth.spec.ts` | 账号管理 | 守卫/中间件 | 全量回归 |
| `tests/m0-shell.spec.ts` | 浮层/菜单 | 权限显隐 | 同步 |
| `scripts/verify-backup.mjs` | manifest schemaVersion | 新迁移 | 新备份兼容；旧备份说明 |
| `server/openApi.ts` | 15 路径/20 操作 | +接口 | 登记 |
| `TASKS.md` / 验收矩阵 | — | 新阶段 | 逐里程碑登记 |

## 9. 结论与建议

1. 开工前必须先修两处方案缺口：H1（公共模板素材跨账号策略，建议本期 b：不带私有素材）、H2（preview_image 列）。
2. P0 实施前先改 H4（中间件顺序），否则 P0-6 必然引入账号管理回归。
3. H5 顺手修（真实分类白名单），避免把既有隐患带进公共模板。
4. 测试按 §8 表格同步；m77/m78 独立配置并自清理。
5. 在已验收保护上，核心保证是“管理员恒真 + 默认集=现状 + 公共 GET 响应结构不变 + 种子迁移兜底”，四条都写进每步验收门。

## 10. 讨论点结论（2026-08-07 用户确认）

1. ✅ 公共模板素材策略：本期采用 b（不携带私有素材；公共素材复制另行立项）。
2. ✅ preview_image 列：本期增加。
3. ✅ 默认集不可撤销；权限写接口只维护“额外授予集”。
4. ✅ 禁止管理员修改自己的权限。
5. ✅ 公共模板管理接口对无权限账号返回 403。
6. ✅ 种子模板允许编辑但不可物理删除；m22 契约测试以“种子存在”为断言而非固定标题（实施时同步）。

> H1/H2 已按上述结论修订进 WBS 与 WBS_DETAIL（P1-1 表结构、P1-7 验收方式）。
