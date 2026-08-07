# Unboundry 复刻 · 多项目（项目制画布）开发方案

状态：`APPROVED BY USER 2026-08-06 / 实施时以此文档为准`
适用范围：后端 API、数据库迁移、前端路由与工作空间页、画布项目模式、测试与验收。
来源：用户 2026-08-06 多轮审阅确认；Unboundry 真实页面勘测（2026-08-06，CUA 驱动 Chrome）与代码全量审阅。

## 0. 目标与范围

把当前「单项目/单画布（default）」升级为「多项目项目制画布」，对齐 Unboundry 的真实行为：

- 项目列表（工作空间）、新建项目、打开画布、重命名、删除；
- 项目封面（最近生成结果 → 画布内媒体素材 → 浅蓝渐变占位）；
- 搜索、排序（按最近修改/创建时间 × 最新/最早优先）、Grid/List 视图；
- 数据按项目隔离；媒体/历史/模型绑定保持账号级共享；
- 删除项目防复活（服务端墓碑），默认项目保护。

**v1 明确不做**：文件夹、团队项目 tab、移动至团队（分享面板保持禁用）、首页改版。

## 1. 真实勘测结论（Unboundry）

- 首页 `/home`；工作空间 `/canvas/projects`；画布 `/canvas/<uuid>`（一个项目=一个画布）。
- 工作空间：个人/团队项目 tab；搜索框；「显示全部」下拉（显示全部/仅文件夹/仅项目 + 按最近修改/按创建日期 + 最新优先/最早优先）；Grid/List 视图切换；「新建项目」按钮。
- 新建项目：点击后立即创建名为 Untitled 的项目并直接进入画布，无命名弹窗；命名在画布顶部标题输入框内联编辑。
- 画布头部：左上 logo（项目菜单：返回工作空间/重命名/新建项目/删除等）+ 标题输入框 + 「上次修改于 X」；右上积分/社区。
- 删除：模态「确认删除 / 确定要删除项目 / 取消 / 删除」。
- 列表视图列头：预览 / 名称 / 类型 / 内容 / 创建时间 / 最近更新；文件夹类型显示「文件夹」。
- 搜索：按名称过滤；无结果时显示「+ 新建项目」空状态卡。
- 文件夹有独立 UUID（`?collection=<uuid>`），v1 不做。

## 2. 现状盘点（可复用代码）

### 后端
- `canvas_documents`：`UNIQUE(owner_id, id)`，`/api/canvas/:id` 已支持任意 id（`server/canvasPersistence.ts`）。
- `project_metadata`：`UNIQUE(owner_id, id)`，`/api/project-title/:id` 已支持 GET/PUT/DELETE（`server/canvasPersistence.ts` 的 `projectTitle`）。
- `generation_tasks.canvas_id` 按项目隔离；`media_assets` 账号级；`node_model_bindings` 全局。
- 路由挂载：`vite.config.ts` 的 `canvasPersistenceApi` 插件（`/api/canvas`、`/api/history`、`/api/project-title`、媒体接口）。
- 契约：`server/openApi.ts` 的 `openApiDocument` + `tests/m20-api-contract.spec.ts`（硬断言路径清单/卡片数/文案）。

### 前端
- `client/src/App.tsx`：无路由库；fixture 用 `window.location.pathname` 匹配 `/__fixture/<id>`；admin 路径 switch；其余渲染 `CanvasApplication`。
- `client/src/canvas/CanvasShell.tsx`：`fixtureId ?? "default"`；项目标题输入框 + 本地草稿 + 自动保存已存在；项目菜单（logo）已存在（重命名可用，「新建项目/删除」为 disabled 占位）；分享面板存在（团队移动 disabled）。
- `client/src/canvas/CanvasSurface.tsx`：持久化/自动保存/revision/多标签广播已按 `persistenceId = fixtureId ?? "default"` 参数化；**`persistenceFixture` 只对非 fixture 或 persistence.* 等开启**。
- 可复用 UI：`client/src/ui/GrayMenuSelect.tsx`、`InlineOptionGroup.tsx`；Admin 卡片/紧凑输入样式；`project-menu`、`project-title-wrap`、`share-popover` 样式已存在。

## 3. 关键风险（代码审阅确认）

1. **项目 id 不能走 fixture 通道**：`CanvasSurface.persistenceFixture` 对普通 uuid 为 false，会导致项目画布不加载/不保存 → 必须新增独立 `projectId` 通道。
2. **404 自动建画布**：fixture 模式 GET 404 → 自动 PUT 空画布。项目模式必须改为「项目不存在 → 跳工作空间」，不自动创建。
3. **标题 404 回写**：`CanvasShell` 标题 GET 404 会用本地草稿 PUT 重建 `project_metadata`。项目模式必须阻止。
4. **旧标签页复活**：已加载的标签页自动保存 PUT 会在无画布行时 INSERT 重建。仅靠前端 404 不够 → 服务端墓碑硬拦截。
5. **「编辑于 X」数据源**：`project_metadata.updated_at` 只随标题保存更新；画布内容保存不会更新 → 列表时间会失真。需要在 canvas PUT 时同步更新时间。
6. **删除时运行中任务**：`server/generationTasks.ts` 有 `runningImage/Video/Audio/TextRequests` Map；删除项目必须先 abort 再清记录。
7. **m20 契约硬断言**：新增接口必须同步更新 `tests/m20-api-contract.spec.ts`。
8. **历史垃圾行**：`project_metadata` 存在 `legacy.*`、`menu.project` 行，必须用 `is_project` 隔离。

## 4. 数据模型与迁移（v26）

`server/database.ts` 追加迁移 v26（name: `multi-project-workspace`）：

```sql
ALTER TABLE project_metadata ADD COLUMN is_project INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_metadata ADD COLUMN created_at INTEGER;
ALTER TABLE project_metadata ADD COLUMN deleted_at INTEGER;
UPDATE project_metadata SET is_project = 1, created_at = updated_at WHERE id = 'default';
```

语义：

- `is_project=1 AND deleted_at IS NULL` = 有效项目；
- 删除项目 = `is_project=0, deleted_at=now`（墓碑），画布/任务记录物理删除，**媒体与账号历史保留**；
- 墓碑行保留在 `project_metadata`，用于拒绝旧标签页 PUT 复活；
- `default` 项目由用户保护：**禁止删除**（DELETE 返回 409）。

## 5. 后端 API

新增 `server/projects.ts`（挂载于 `vite.config.ts` 的 `canvasPersistenceApi` 插件，走既有 `/api` authGate）：

### GET /api/projects

返回当前身份的项目列表（真实用户按 `owner_id`；测试 bypass 返回全部 `is_project=1 AND deleted_at IS NULL`）：

```json
{
  "projects": [
    {
      "id": "…",
      "title": "…",
      "createdAt": 0,
      "updatedAt": 0,
      "cover": { "kind": "image" | "video" | null, "assetId": "…" | null }
    }
  ]
}
```

封面优先级（服务端计算）：

1. 该项目最近一次成功生成（video/image）的 `generation_tasks.result_asset_id`；
2. 解析 `canvas_documents.nodes`，取第一个有 `assetId` 的 Image/Video 节点；
3. 都没有 → `cover: null`（前端浅蓝渐变）。

### POST /api/projects

- body：`{ "title"?: string }`，缺省为「未命名项目」；
- 事务：插入 `project_metadata(is_project=1, created_at, updated_at)` + 空 `canvas_documents`（revision 1 / graph_revision 1 / 空 nodes/edges / 默认 viewport）；
- 返回新项目 `{ id, title, createdAt, updatedAt }`。

### DELETE /api/projects/:id

- `id === "default"` → 409「默认项目不能删除」；
- 校验项目存在且属于当前身份，否则 404；
- 先对 `canvas_id` 的 queued/running/recovering/retrying 任务 `abort` 对应控制器（复用 `generationTasks.ts` 现有 abort 逻辑），abort 失败 → 409「请先取消生成任务再删除」；
- 事务：墓碑化 `project_metadata` + 删除 `canvas_documents` + 删除 `generation_tasks/generation_task_events/generation_provider_attempts`（按 `canvas_id`）；
- 媒体、`asset_history` 保留。

### 对既有接口的改动

`server/canvasPersistence.ts`：

- `canvasPersistence` PUT：若 `(owner,id)` 存在墓碑（`project_metadata.is_project=0 AND deleted_at IS NOT NULL`）→ 409「项目已删除，请返回工作空间」，禁止 INSERT 复活；
- `canvasPersistence` PUT 成功后：若该 id 存在有效项目行，则 `UPDATE project_metadata SET updated_at = max(now, updated_at)`（保证「编辑于」正确）；
- `projectTitle` PUT：墓碑 id → 409 拒绝。

`server/openApi.ts`：新增 `/api/projects`（get/post）、`/api/projects/{projectId}`（delete）+ `ProjectSummary/ProjectCover` schema。

## 6. 前端改动

### 路由（`client/src/App.tsx`）

- `/canvas/projects` → `WorkspacePage`；
- `/canvas/<id>`（非 fixture/admin）→ `AuthenticatedApplication projectId=<id>`；
- `/`、`/canvas/default` → 默认项目（行为不变）；
- `/__fixture/...`、`/__responsive-preview/...`、`/admin/*` 保持原逻辑。

### `client/src/canvas/CanvasShell.tsx`

- 新增 `projectId?: string`；`projectTitleId = projectId ?? fixtureId ?? "default"`；
- fixture 专属面板条件只认 `fixtureId`；
- 项目菜单启用：返回工作空间（`/canvas/projects`）、新建项目（POST 后跳转）、删除（ConfirmDialog + DELETE + 清理本地 `unboundry-project-title:<id>` 与 `unboundry:generation-submission:v1:<id>:*` 草稿 + 跳工作空间）、重命名（保持现有）；
- 项目模式标题 GET 404：不回写本地草稿，标记项目不存在交由外层跳转。

### `client/src/canvas/CanvasSurface.tsx`

- 新增 `projectId?: string`；`persistenceId = projectId ?? fixtureId ?? "default"`；
- `persistenceFixture = Boolean(projectId) || 原条件`；
- 404 分支：projectId 模式 → `onProjectMissing()`（App 层跳工作空间），不自动建画布；fixture 模式保持原逻辑。

### 新组件

- `client/src/projects/WorkspacePage.tsx`：项目列表页（搜索/排序/Grid/List/新建/重命名/删除/封面/空状态）；
- `client/src/ui/ConfirmDialog.tsx`：深色确认框（14/12px 两档字号、灰按钮 + 危险按钮红色弱底、Escape/外点关闭、焦点返回；作为新组件标注待验收）；
- `client/src/styles.css`：工作空间页、卡片/列表行、浅蓝渐变封面、确认框样式（复用现有灰阶/圆角/间距 token）。

## 7. 数据独立性矩阵

| 数据面 | 隔离方式 | 决策 |
|---|---|---|
| 画布内容/版本/保存会话 | `canvas_documents(owner_id,id)` | 按项目 |
| 项目标题 | `project_metadata(owner_id,id)` | 按项目 |
| 生成任务 | `generation_tasks.canvas_id` | 按项目 |
| 提交意图/标题草稿（localStorage） | key 含 canvasId/projectId | 按项目 |
| 多标签同步 | `BroadcastChannel(unboundry-canvas-sync:<canvasId>)` | 按项目 |
| URL | `/canvas/<uuid>` | 按项目 |
| 媒体素材 | `media_assets(owner_id)` | 账号级共享（有意） |
| 账号历史/模型绑定/Provider | 全局 | 账号级共享（有意） |

## 8. 兼容与安全

- 默认项目行为不变（`/`、`/canvas/default`、自动保存、多标签、revision、生成任务、既有 INPUT/DATA 验收路径）；
- fixture 机制完全不动（`/__fixture/...`、`__fixture-api`、`spec/unboundry-state-fixtures.json`）；
- 迁移前运行 `npm run data:backup`；
- 全程零 Provider 请求；无删库/破坏性操作；
- 删除为墓碑式，服务端硬拦截复活。

## 9. 测试计划

新增 `tests/m66-multi-project.spec.ts`：

- API：创建默认名、列表过滤 legacy、重命名、封面三级优先级、删除（画布+任务清空、媒体保留）、默认项目 409、墓碑防复活（删除后旧 PUT 画布/标题被拒、GET 404）、运行中任务删除处理；
- 页面：工作空间渲染/新建跳转/搜索/排序/Grid↔List/重命名/删除确认；项目画布加载、刷新恢复、多标签最后写入；删除后旧 URL 跳工作空间。

更新 `tests/m20-api-contract.spec.ts`（路径清单、卡片数、「当前共 N 条接口路径」文案）。

回归：m3/m27（持久化/多标签/输入）、m16/m18（灰 UI/字号）、m62（缩放）相关子集；`tsc` + 构建全绿。

## 10. 实施顺序（一次 commit 收尾）

1. 迁移 v26 + `server/projects.ts` + openApi + vite 挂载 + m20 更新 + m66 API 部分；
2. `CanvasShell/CanvasSurface` 的 `projectId` 解耦 + 默认项目回归（m3/m62）；
3. `WorkspacePage` + `ConfirmDialog` + 样式 + 页面测试；
4. 封面计算与删除清理；
5. 全量回归 → 用户实页验收 → 更新 TASKS/验收矩阵 → 一次 commit。

## 11. 验收与提交约定

- 所有 UI 改动遵守 `spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md`（两档字号、灰阶、紧凑控件、无蓝色默认控件）；
- 新组件（ConfirmDialog、WorkspacePage）完成自动检查后由用户实页验收；
- 未经用户确认不得修改验收矩阵状态；本功能完成且验收通过后统一写入 TASKS.md 与验收矩阵。
