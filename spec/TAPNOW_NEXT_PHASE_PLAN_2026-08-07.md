# 下一阶段三事项实施方案（公共模板 / 账号权限管理 / 正式部署）

状态：`PENDING USER APPROVAL 2026-08-07`
基线：当前 `main` 提交 `04a1538`（三功能全部验收 PASS）
范围：本文件只写方案与实施边界；未经用户逐项确认，不授权任何代码改动。

## 0. 总原则

- 三个事项按 1→2→3 顺序实施：先公共模板、再账号权限、最后部署。权限模型完成后，部署前的“管理员页面与远程访问控制”可以直接复用同一套权限检查。
- 每个事项沿用既有纪律：迁移、API、UI、单测/集成、全量回归、TASKS.md 同步、验收后 commit、不擅自 push。
- 不修改 4173 真实数据做测试；测试一律临时数据目录 + 独立端口。
- 部署阶段所有真实 Provider 请求仍需用户逐次授权并明确预算。
- 已验收的三功能（我的模板 / 批量下载 / 账号私有平台密钥）不因本批重做；只在其上扩展。

## 1. 事项一：公共模板（跨账号分享）

### 1.1 目标

把“跨账号分享模板”收敛为**管理员发布的公共模板**：管理员负责公共模板的新增/删除/更新/上下架；普通账号只能浏览、搜索、导入，不能新增/修改/删除公共模板。“我的模板”保持账号私有不变。

### 1.2 数据模型（迁移 v30）

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

- 迁移时把现有 `server/templateCatalogData.json` 的两个真实电商模板灌入表（`created_by` 允许 NULL 表示“内置种子”），公共接口只读表；后续管理员可编辑/归档这些种子行。
- 图结构校验复用三功能的模板图规则（节点≤500、边≤1000、7 种类型、标题 1–40、分类白名单）。
- 封面三级规则复用：生成结果 → 图内素材 → 浅蓝渐变；管理员上传封面素材时以素材 assetId 记录。

### 1.3 管理员 API（仅管理员）

- `GET /api/admin/templates`：分页/搜索/状态过滤，返回公共模板管理列表（含 status、created/updated、graph 可选）。
- `POST /api/admin/templates`：新增；body `{ title, category?, graph, status? }`；默认 `draft`，可 `published`。
- `PATCH /api/admin/templates/:id`：更新标题/分类/图/封面/状态（draft↔published↔archived）。
- `DELETE /api/admin/templates/:id`：硬删除（无画布引用关系；删除前审计）；或按 `archived` 软归档（决策点，见 §6）。
- 所有写操作写入 `admin_audit_events`（不记录密钥/素材内容）。

### 1.4 公共读取 API（所有账号）

- `GET /api/templates?space=public` 改为读取 `public_templates WHERE status='published'`，返回结构与现有 `TemplateCatalog` 一致；搜索/分页/分类逻辑沿用。
- `space=mine` 与“我的模板”完全不变。
- “最近使用”分类：先做客户端按账号本地记录（localStorage，v2 命名空间），不做服务端计数（决策点，见 §6）。

### 1.5 客户端

- 模板面板与“浏览全部”保持现有交互；公共模板不显示删除按钮（普通账号），管理员在“浏览全部”内增加「管理公共模板」入口跳转 `/admin/templates`。
- 新增管理员页 `/admin/templates`：列表卡（标题/分类/状态/封面/更新时间）、新建/编辑弹窗（复用 GroupNode 保存弹窗的标题+分类+图结构校验）、上下架与删除按钮，样式遵守两档字号与灰色体系。
- 公共模板导入继续复用 `apply-template`（含素材地址补全与找空位镜头）。

### 1.6 测试

- 单测：公共模板校验、状态机（draft/published/archived）、种子迁移幂等。
- API：管理员 CRUD；普通账号 POST/PATCH/DELETE 403；公共列表只含 published；归档后消失；搜索/分页。
- 集成：管理员发布含素材的公共模板 → 普通账号导入 → 素材立即显示、刷新保留。
- 回归：m22-template-contract、m70/m71 全部保持通过。

## 2. 事项二：账号权限管理

### 2.1 目标

在不推翻“管理员/普通用户”两级身份的前提下，增加**按账号授予能力权限**：管理员可以把项目能力逐项授予指定普通账号；未授予的能力普通账号不可访问（服务端强制）。管理员始终拥有全部权限。

### 2.2 数据模型（迁移 v31）

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

### 2.3 权限清单（枚举）

| 权限 | 说明 | 默认 |
|---|---|---|
| `manage_public_templates` | 公共模板新增/删除/更新/上下架 | 仅管理员 |
| `manage_models` | 模型中心（发布/停用/默认/参数） | 仅管理员 |
| `manage_providers` | 平台连接与目录同步 | 仅管理员 |
| `manage_storage` | 存储中心与 OSS 配置 | 仅管理员 |
| `manage_generation_safety` | 生成安全与预算 | 仅管理员 |
| `manage_accounts` | 账号启停/删除 | 仅管理员 |
| `manage_permissions` | 授予/撤销他人权限 | 仅管理员 |
| `manage_projects` | 新建/重命名/删除/克隆项目 | 普通账号默认有 |
| `manage_own_templates` | 我的模板增删改 | 普通账号默认有 |
| `manage_own_credentials` | 我的连接（自己的平台密钥） | 普通账号默认有 |
| `generate` | 发起真实生成（所有类型） | 普通账号默认有 |
| `group_download` | 组/模板结果 ZIP 下载 | 普通账号默认有 |

决策点：是否按生成类型再拆（`generate_text/image/video/audio`），见 §6。

### 2.4 服务端

- 新增 `server/permissions.ts`：`hasPermission(identity, permission)`；管理员恒真；读取 `account_permissions`。
- `account-context` 返回 `permissions: string[]` 与 `role`，前端隐藏不作为权限依据。
- 逐项替换现有 `role !== "admin"` 守卫：模型/Provider/存储/生成安全/账号/API 契约页等管理接口改为对应权限检查（管理员不受影响）。
- 新增管理员接口：
  - `GET /api/admin/accounts/:id/permissions`：列出当前权限。
  - `PUT /api/admin/accounts/:id/permissions`：整体写入权限集（白名单校验）；写审计；不能授予 `manage_permissions` 给自己之外的组合导致越权（管理员本身恒有）。
- 删除账号级联清理 `account_permissions`（v31 外键 ON DELETE CASCADE）。

### 2.5 客户端

- 账号管理页新增“权限”区：紧凑 16px 自绘复选框网格（按 UI 规范），管理员勾选后保存；未授权账号不显示该区。
- 普通账号侧不新增页面；无权限时按钮照常隐藏（服务端仍强制 403/404）。

### 2.6 测试

- 单测：权限白名单、管理员恒真、级联删除。
- API：A 授权/撤销后对应接口 200/403；B 不受影响；越权授予被拒；审计存在。
- 回归：m11/m12/m13/m14/m15/m21/m43/m45/m46/m49/m52/m56/m58 等管理接口测试按新权限模型复核。

## 3. 事项三：正式部署到服务器

### 3.1 目标与假设

- 目标：私有项目经 HTTPS 对外提供服务，仅服务器本机可执行管理员初始化；普通账号经域名访问。
- 假设（需用户确认）：国内云主机 Ubuntu 22.04/24.04 x64，至少 2C4G；Node.js 22 LTS；已有域名且 ICP 备案可完成；使用 Caddy（自动 HTTPS）或 Nginx+certbot；OSS 沿用现有私有 Bucket。
- 本机当前 Node 25 存在基线测试失败（m30 等），部署前先在 Node 22 环境复跑全量回归并修正环境差异。

### 3.2 架构

```
用户浏览器
   │ HTTPS
   ▼
Caddy / Nginx（443，证书自动/Let's Encrypt）
   │ 反代到本机
   ▼
vite preview（127.0.0.1:4173，生产构建 + 服务端 API 中间件）
   │
   ├─ SQLite（/var/lib/tapnow/tapnow.sqlite，WAL）
   ├─ media/ 与 secrets/（同一数据目录）
   ├─ 私有 OSS（签名读取/上传，服务器时钟 NTP）
   └─ 定时备份（cron + scripts/backup-data.mjs）
```

### 3.3 实施步骤

1. 环境预检：Node 22 上 `npm ci && npm run build`，全量回归（临时数据目录）；锁定依赖版本；确认无密钥文件入库。
2. 生产构建：`npm run build`，产物 `dist/client`；服务端继续由 `vite preview` 承载（与现有 `playwright.config` preview 模式一致），或抽独立 Node 服务（决策点）。
3. 目录与账号：`/opt/tapnow/app`（代码）、`/var/lib/tapnow`（数据，`TAPNOW_DATA_DIR`）、专用运行用户 `tapnow`。
4. systemd 服务 `tapnow.service`：`vite preview --host 127.0.0.1 --port 4173 --strictPort`；环境 `TAPNOW_DATA_DIR`、`TAPNOW_SECURE_COOKIES=1`、`NODE_ENV=production`；`Restart=always`；禁止远程 bootstrap（默认 loopback-only）。
5. 反向代理：Caddy `domain → 127.0.0.1:4173`（自动 TLS）或 Nginx + certbot；限制请求体大小、设置安全响应头；仅暴露 443/80。
6. 首管理员初始化：SSH 到服务器本机访问 `http://127.0.0.1:4173` 创建管理员；随后创建部署用普通账号并授予所需权限（复用事项二）。
7. 备份与恢复演练：cron 每日备份（SQLite+media+secrets+manifest）；执行一次 `scripts/verify-backup.mjs --runtime-port <port>` 恢复演练；保留首份备份。
8. 监控与运维：journald 日志轮转、磁盘水位告警、每日健康检查（`/api/auth/status`）、进程自拉起。
9. 上线验收：HTTPS 可达、127.0.0.1 绑定不被外网直连、登录/权限/三功能复验、真实生成（预算内授权）、服务重启持久化、备份恢复、迁移 v30/v31 在真实库前先演练。

### 3.4 测试与验收

- 自动：生产构建隔离、fixture 生产隔离、备份恢复脚本、权限矩阵。
- 人工验收清单（写入验收矩阵新段）：域名 HTTPS、本机绑定、管理员初始化、普通账号权限、三功能全链路、真实生成、重启恢复、备份恢复演练。

## 4. 实施顺序与里程碑

| 里程碑 | 内容 | 放行条件 |
|---|---|---|
| P1 | 公共模板（v30 + 管理员 CRUD + 管理页 + 公共列表改造） | tsc/构建；m77 专项；模板相关回归全绿；用户实页验收 |
| P2 | 账号权限（v31 + permissions 服务 + 管理接口/UI + 逐接口替换守卫） | tsc/构建；m78 专项；管理接口回归全绿；用户实页验收 |
| P3 | 正式部署（Node 22 预检 → 服务器初始化 → systemd → 反代 → 备份演练 → 上线验收） | 部署验收清单逐项通过；无付费请求未授权 |

## 5. 风险与应对

| 风险 | 应对 |
|---|---|
| 公共模板改造影响现有静态种子 | 迁移幂等灌入种子；m22 契约测试保留；编辑/归档不删除历史引用 |
| 权限替换守卫时漏改某管理接口 | 权限检查集中在 `server/permissions.ts`；回归清单逐接口核对；审计测试断言 |
| 部署后 Node 版本差异 | 部署前在 Node 22 复跑全量回归；锁版本；服务器与开发环境统一 Node 22 |
| 远程管理面暴露 | 反代只暴露 HTTPS；管理接口仍走权限检查；bootstrap 仅本机 |
| 数据/密钥备份丢失 | 备份含 secrets（已实现）；恢复演练强制一次 |
| 迁移 v30/v31 损坏真实库 | 部署前备份 + 临时库演练 + 可回滚提交 |

## 6. 待用户拍板的决策点

> 注：本节的 6 个决策点已于 2026-08-07 在 `spec/TAPNOW_NEXT_PHASE_WBS_DETAIL_2026-08-07.md`「决策点定稿」中全部确认（8 项，含本节 6 项与补充 2 项），实施未开始。

1. 公共模板删除：硬删除还是归档保留？（建议：归档保留 + 管理页可见）
2. “最近使用”分类：客户端本地记录即可，还是要服务端跨设备？（建议：先本地）
3. 权限粒度：生成权限按“全部类型”一个开关，还是拆 text/image/video/audio 四个？（建议：先一个 `generate`，以后需要再拆）
4. 是否允许把 `manage_accounts`/`manage_permissions` 授予非管理员？（建议：不允许，仅管理员）
5. 部署环境：云厂商/域名/备案状态；是否接受 Caddy；Node 22 LTS；`vite preview` 直跑还是抽独立 Node 服务？（建议：先 `vite preview`，后续量大再拆）
6. 部署后是否允许通过域名直接访问管理员页面（建议：允许，但依赖权限与 HTTPS）。

## 7. 明确不做

- 普通账号向公共模板“投稿/审核”流程（先只做管理员发布）。
- 模板跨账号直接分享链接/授权查看（与公共模板二选一，本批做公共模板）。
- 团队项目、邀请、多人协作。
- 公网注册、开放注册。
- K8s/多机/数据库主从/多地域 CDN。
- 本批不改动已验收的三功能行为。
