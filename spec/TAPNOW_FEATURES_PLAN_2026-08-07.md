# 三个新功能实施方案（我的模板 / 批量下载 / 账号私有平台密钥）

状态：`APPROVED BY USER 2026-08-07`（决策点已逐项确认）
基线：当前 `main` 提交 `e45c761`
范围：只写方案与实施边界，不授权任何代码改动；按用户指令分步实施。

## 0. 总原则

- 除公共模板外，项目内内容全部账号私有：画布、项目、素材、生成任务、历史、我的模板、平台密钥。
- API key 彻底隔离：每个账号使用自己的平台密钥；不存在“子账号用管理员 key”或“管理员用子账号 key”的任何回退路径，并用测试锁死。
- 普通账号只看到「平台」层（连接定义的安全摘要 + 自己的密钥），不看到模型层配置；模型层由管理员统一发布。
- 本方案不要求先重构画布保存链路；三个功能按 1→2→3 顺序实施，账号私 key 内部再分三小步。

## 1. 用户已确认的决策

1. 普通账号只看到“至少有一个已发布模型”的平台连接。
2. 多个同类型连接（例如两个中转站）各自独立成行，各自填写密钥；哪个连接下有模型，生成时就用该行密钥。
3. 「我的模板」允许包含 Audio / Playlist / Storyboard 节点（模板图类型从 4 种扩到 8 种）。
4. 保存模板时不保留组内已生成的图片/视频结果，只保留提示词、参数、上传素材引用与组结构；结果字段、任务字段、瞬态字段全部剥离。
5. ZIP 打包采用新增依赖 `archiver`（方案 A），不自行实现 ZIP writer。
6. 备份策略纳入加密凭据（`data/secrets` 相关文件或等价机制），否则账号密钥无法恢复；此点同时修复现有备份缺口。
7. 生成密钥变更/删除语义：任务提交时快照密钥版本；执行时版本不符 → 任务友好失败，提示重新提交，不偷偷换 key。
8. 封面规则复用项目工作空间：生成结果 → 画布/模板内素材 → 浅蓝渐变。
9. 批量下载命名：节点标题-序号.扩展名；文字结果存 .txt；上限 500MB / 200 个文件。

## 2. 功能 1：我的模板（账号私有）

### 2.1 目标

打组节点 → 「保存为模板」→ 存入当前账号的「我的模板」→ 可搜索/筛选/删除 → 导入任意自己的项目，导入复用现有找空位 + 平滑聚焦链路。

### 2.2 数据模型（数据库迁移 v28）

```sql
CREATE TABLE IF NOT EXISTS user_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  graph TEXT NOT NULL,
  cover_asset_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS user_templates_owner_updated
  ON user_templates (owner_id, updated_at DESC);
```

### 2.3 API

- `GET /api/templates?space=mine&q=&category=&limit=&offset=&includeGraph=`：改为查 `user_templates`，owner 过滤；返回结构对齐现有 `TemplateCatalog`（分类、items、pagination）。
- `POST /api/templates`：body `{ title, category?, graph }`；校验标题长度、分类白名单、图结构（节点数 ≤ 500、边 ≤ 1000、类型 ∈ 8 种）；写入 owner。
- `DELETE /api/templates/:id`：仅允许删除自己的模板。
- 公共模板 `space=public` 保持静态目录不变。
- OpenAPI 文档同步（`server/openApi.ts`）。

### 2.4 模板图序列化（纯函数模块 `client/src/canvas/groupTemplate.ts`）

输入：组节点 id + 当前 nodes/edges。
输出：与公共模板同构的 `TemplateGraph`。

规则：
- 只收集组内节点（`parentId === groupId`）和两端都在组内的边。
- 子节点坐标相对组原点归一化。
- 保留：type、title、label、提示词、参数（`*Parameters`）、`inputMode`/`inputRole`/`inputOrder`（边 data）、上传素材的 `assetId` 与可信媒体元数据（尺寸/时长/格式/storageBackend）、组标题与 `groupColor`。
- 剥离：`measured/selected/dragging/resizing`、`imageSrc/videoSrc/audioSrc` 结果 URL、`*Generation*` 任务/错误/成功字段、`*Generating`、`imageGeneratedSuccess`、`audioGeneratedResult`、`playlistPicking`、`storyboardShots` 以外的运行时字段。
- 边：删除 `cutIndicator`、`flowAnimated`、`flowDirection`、`animatedHighlight` 等渲染标记。
- 对含 assetId 的媒体节点，由导入端 `normalizePersistedMediaNodes` 在 hydration 时重建 durable src，模板不保存短时地址。

### 2.5 模板图类型放宽

- `CanvasShellMenuCommand.graph.nodes[].type` 与 `CanvasSurface` 导入器类型从 `group|image|text|video` 扩为 `audio|group|image|playlist|storyboard|text|video`（`probe` 不进入模板）。
- `CanvasShell.tsx` 的 `TemplateCatalogCard.graph` 类型同步放宽。
- 公共模板数据与既有测试语义不变。

### 2.6 封面

复用 `projectCover` 三级规则，抽成纯函数：
1. 模板图内第一个带成功生成任务结果的图片/视频素材（查询 `generation_tasks`，owner 过滤）；
2. 模板图内第一个图片/视频 `assetId`；
3. 浅蓝渐变占位（沿用 `workspace-cover-gradient`）。

### 2.7 客户端

- GroupNode 工具栏「创建模板」启用：弹窗（标题 ≤40、分类可选），提交 POST，成功 toast。
- 模板面板「我的模板」：卡片 + 删除入口（hover 出现，样式对齐工作空间卡片），搜索/分类沿用现有控件。
- 全屏「浏览全部」中「创建」按钮保持禁用（普通用户从组节点创建）。
- 导入：`apply-template` 现有链路，不做第二套导入。

### 2.8 测试

- 单测：抽取/清洗/坐标归一化/瞬态字段剥离/类型白名单。
- API 测试：A 账号保存后 B 账号列表与删除均 404/403；分页/搜索/分类。
- 集成：真实项目打组保存 → 导入另一项目 → 节点/边/角色/顺序/素材引用正确；封面三级规则。

## 3. 功能 2：批量下载组/模板生成结果（ZIP）

### 3.1 数据来源

以 `generation_tasks` 为准：
- `canvas_id = ? AND owner_id = ? AND node_id IN (组内子节点) AND state = 'success'`
- 文字：`result_text` → `.txt`
- 图片/视频/音频：`result_asset_id` → 媒体文件（本机路径或 OSS 签名 URL 流式读取）

### 3.2 服务端接口

`POST /api/canvas/:id/group-download`，body `{ groupId }` 或 `{ nodeIds }`。

- owner 校验画布与组/节点归属。
- 打包：`archiver`（新增运行时依赖，方案 A）。
- 命名：`节点标题-序号.扩展名`；标题重复自动追加序号；非法字符清洗。
- 上限：总字节 ≤ 500MB，文件数 ≤ 200；超限友好错误。
- 0 个结果：`400 { error: "该组还没有可下载的生成结果" }`。
- 缺失/失败/云端读取失败：跳过并在响应头或说明文件列出，不中断。
- 响应：`application/zip`，`Content-Disposition: attachment; filename="工作流结果-<时间>.zip"`。

### 3.3 客户端

- GroupNode「下载全部」改为调用接口 → 下载 blob；过程 toast「正在打包…/下载完成」。
- 失败/空结果展示服务端友好文案（沿用现有 toast/错误规范）。

### 3.4 测试

- 命名/清洗/去重单测。
- 集成：临时数据目录种成功任务（image/video/audio/text 各一）→ 下载 → 用系统 `unzip` 校验条目名与内容哈希。
- 权限：他人画布 404。

## 4. 功能 3：账号私有平台密钥（核心）

### 4.1 概念模型

| 层 | 谁管 | 普通账号可见 |
|---|---|---|
| 连接定义（driver/baseUrl/label/目录/模型发布） | 管理员 | 只显示名称与地址 |
| 模型配置（模型归属平台、参数、发布） | 管理员 | 否 |
| 平台生成密钥（每账号每连接一个） | 每个账号 | 是 |

### 4.2 数据模型（迁移 v29）

```sql
CREATE TABLE IF NOT EXISTS account_provider_credentials (
  account_id TEXT NOT NULL,
  provider_profile_id TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_status TEXT NOT NULL DEFAULT 'unchecked',
  key_checked_at TEXT,
  credential_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, provider_profile_id),
  FOREIGN KEY (account_id) REFERENCES users(id),
  FOREIGN KEY (provider_profile_id) REFERENCES provider_profiles(id)
);
```

- `encrypted_key` 用现有 AES-GCM + `config-master.key` 加密，任何接口不返回明文。
- 全局 `provider-profiles.enc.json` 迁移为“连接定义文档”，移除 `apiKey`；原 key 写入管理员账号凭据。
- 平台连接元数据表 `provider_profiles` 增加/调整状态语义：`status/key_status` 表示“管理员已完成连接检查”，不再单独作为生成可用性依据；生成可用性 = 连接定义就绪 + 当前账号凭据有效。

### 4.3 API（普通账号与管理员同构）

- `GET /api/account-credentials`：当前账号在各平台的凭据状态（只含平台名称/地址/掩码/状态）。
- `PUT /api/account-credentials/:profileId`：保存/更新自己的 key（加密落库，版本 +1）。
- `POST /api/account-credentials/:profileId/verify`：只读校验（401/403/429/网络 → 状态 invalid/unknown），零生成费用。
- `DELETE /api/account-credentials/:profileId`：删除自己的 key。
- 管理员平台管理页不再包含生成 key 字段；方舟目录凭证（AK/SK）保留在管理员页。
- `account-context` 权限新增 `manageOwnCredentials: true`；OpenAPI/m20/m21 同步。

### 4.4 生成链路（全部按 owner 维度）

1. 模型可用性：
   - `resolveModel(kind, modelId, ownerId)`：SQL 增加账号凭据状态（有效/无效/缺失）。
   - `generationAvailability(ownerId)`、`modelRuntimeAvailability(rows, ownerId)`、`publicModelsApi`：`generationAvailable` 反映当前账号凭据。
   - `modelAvailability.ts` 新增原因码：`ACCOUNT_CREDENTIAL_MISSING`、`ACCOUNT_CREDENTIAL_INVALID`；friendly 文案「未配置你的平台密钥」「你的平台密钥无效」。
2. 提交：
   - 任务 `model_configuration` 增加 `credentialVersion` 快照。
3. 执行：
   - `getProviderProfileForGeneration` / `acquireProviderGenerationRequestLease` 改为 owner 感知：连接定义（全局）+ 账号凭据（owner）合成执行 profile；保持原子锁语义。
   - `requireTaskProviderSnapshot` 增加 credentialVersion 校验；不符 → 友好失败「你的平台密钥已变更，请重新提交」。
4. 统计隔离（关键）：
   - `recordProviderAttempt` 的鉴权失败/成功/恢复尝试统计从 `provider_profile_id` 全局改为按 `owner_id + provider_profile_id`。
   - `generationSafety.admission` 的连续失败熔断同样按 owner 过滤。
   - 专项测试：A 账号坏 key 不影响 B 账号与管理员的可用性。
5. 管理员操作：
   - 连接检查、目录同步、余额/用量读取使用管理员自己的凭据；普通账号无这些入口。

### 4.5 普通账号 UI

- 账号浮层新增「我的连接」。
- 页面列出“至少有一个已发布模型”的连接（决策 1），每行：平台名称、地址、key 输入/保存/校验/删除、状态与掩码。
- 页面顶部一句说明：密钥只属于当前账号，管理员与其他人不可见。
- 样式遵循 `TAPNOW_UI_DESIGN_SYSTEM.md`（14px/12px 两档字号、紧凑输入、灰色菜单等）。

### 4.6 删除/迁移/备份

- `auth.ts` 删除账号流程级联删除 `account_provider_credentials`。
- 迁移前自动备份；迁移幂等可重放；回滚 = git 恢复 + 备份恢复。
- 备份脚本纳入加密凭据（决策 6）：建议把 `data/secrets` 纳入备份或明确等价机制，并在 manifest 记录；同时评估本机 master key 的安全边界。

### 4.7 测试

- 隔离测试：A/B 各自 key；A 坏 key 不影响 B/管理员；无 key 禁止生成；无回退路径（代码层断言 + API 层断言）。
- 迁移测试：旧全局文档 → 管理员凭据 + 文档无 key；任务快照兼容。
- UI 测试：普通账号只见平台列表；管理员页面不再出现生成 key 输入。
- 回归：m9/m15/m21/m44/m53/m57/m58 等 Provider/账号测试成组更新。

## 5. 实施顺序与里程碑

### 5.1 功能 1：我的模板

1. v28 迁移 + 模板 API 扩展 + 单测。
2. `groupTemplate.ts` 序列化器 + 单测。
3. 模板图类型放宽（CanvasShell/CanvasSurface）。
4. GroupNode「创建模板」+ 我的模板面板/删除。
5. 封面三级规则。
6. tsc + 构建 + 相关回归 + CUA 实页验收。

### 5.2 功能 2：批量下载

1. 新增 `archiver` 依赖（决策 5）。
2. `POST /api/canvas/:id/group-download` + 命名/上限/跳过逻辑 + 单测。
3. GroupNode 下载按钮接入 + toast。
4. ZIP 集成测试（unzip 校验）。
5. CUA 实页验收。

### 5.3 功能 3：账号私有平台密钥

第一步（数据与接口）：
1. v29 迁移 + 凭据加密存储 + 迁移旧全局 key。
2. `account-credentials` CRUD/verify + 权限 + OpenAPI。
3. 迁移/隔离单测。

第二步（生成链路）：
4. owner 感知可用性（resolveModel/generationAvailability/modelRuntimeAvailability）。
5. 提交快照 credentialVersion + 执行 owner 感知取 key。
6. 鉴权失败/熔断统计按 owner 隔离。
7. 全链路隔离测试。

第三步（UI 与收口）：
8. 普通账号「我的连接」页面 + 账号浮层入口。
9. 管理员平台管理页去掉生成 key 字段。
10. 删除账号级联 + 备份纳入密钥 + 文档/OpenAPI 收口。
11. 全量回归 + CUA 实页验收。

## 6. 预审计：风险与应对

| 风险 | 应对 |
|---|---|
| 模板图类型放宽破坏既有契约 | 公共模板不变；m22-template-contract 扩展；导入器已支持全部节点类型 |
| 模板素材引用后续被删 | 导入成功但节点提示素材缺失；封面自动降级；文档写明 |
| ZIP 体积/内存 | 流式 + 500MB/200 文件上限 + 计数，不做整包缓冲 |
| 新增依赖 | 锁文件 + 安全检查；测试隔离数据目录 |
| 子账号坏 key 污染全局 | 鉴权/熔断/恢复统计全部按 owner 隔离，专项测试锁死 |
| 迁移丢管理员 key | 迁移前备份 + 幂等 + 回滚说明；迁移后管理员可自查状态 |
| 备份不含密钥（现有缺口） | 本批一并修：备份纳入加密凭据或明确等价机制 |
| 排队任务遇 key 变更 | credentialVersion 快照；版本不符友好失败重提交（决策 7） |
| 普通账号页面误展示模型/管理员信息 | 接口只返回连接安全摘要；测试断言无模型字段 |

## 7. 明确不做

- 不做按模型填 key（每平台一个 key）。
- 不做团队/共享密钥、管理员代填子账号 key、管理员查看子账号 key。
- 不做模板跨账号分享（将来如需要，另立公共/发布机制）。
- 不改变公共模板、全局额度、OSS 存储与画布保存机制。

## 8. 文档同步

本方案确认后写入 `TASKS.md`；实施过程中的每个里程碑、验收记录与 PASS/BLOCK 状态按项目既有规则同步。
