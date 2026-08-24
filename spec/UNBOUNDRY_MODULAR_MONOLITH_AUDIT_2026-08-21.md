# Unboundry 全项目模块化单体审计

更新日期：2026-08-23
状态：`CURRENT_GOVERNANCE_HARDENING / FIRST_AND_SECOND_BATCH_PRODUCTION_PUBLISHED / CURRENT_V0_6_37_USER_RECHECK / VIEW_005_AUTO_PASS`
适用仓库：`/Users/mymy/Documents/unboundry/app`

## 1. 一句话结论

Unboundry 已有可靠的模块化骨架，但还不是边界完全受约束的模块化单体；第一批同步文字 Provider port 与第二批 Generation/Media 结果提交边界、三媒体模型合同均已随 v0.6.28 发布，并继续包含在当前 v0.6.33 生产版本中。v0.6.29/30 完成商业 Provider 隔离、真实任务验证和Provider结果兼容，v0.6.31 将模块化成果送入普通 main-safe 生产路径；v0.6.32由真实图片裁剪功能触发MediaBlobStore可取消读取和客户端可替换编辑源resolver，v0.6.33只优化其客户端准备态，没有启动第三至第七批全局重构。当前最强的是画布整组执行、文字 Provider 和 Generation 结果提交链；最弱的是 Canvas/节点 UI 应用层、媒体 Provider/Storage 边界和跨域数据所有权。其余边界只按新功能触发条件渐进治理，当前没有全项目大重构计划。

治理门：后续批次只在真实新功能触发边界问题时立项；没有触发就不得施工。

本结论不得被解释为否定 v0.6.27 已完成的画布执行解耦：核心 P0 为 `41/41 = 100%`；原完整矩阵唯一缺口 `VIEW-005` 已由精确 98/171/200 节点安全定向证据收口为 `AUTO_PASS`，因此当前矩阵为 `48/48 = 100%`。该工程证据不改写 v0.6.27 的生产或用户验收时点。

## 2. 审计基线与证据边界

2026-08-21 原审计基线与第一批施工结果保留为历史；2026-08-22 当前只读复核基线如下：

- 仓库：`/Users/mymy/Documents/unboundry/app`；当前分支 `codex/view-005-dense-canvas-performance-2026-08-21`；复核前 HEAD `9793082c3f83246c82a5fa9c43d5ccc6e31c3481`；package `0.6.30`；
- 当前分支相对 tag `v0.6.30` 没有 `client/`、`server/`、`types/` 产品代码差异；差异只涉及测试、runner manifest、回执和权威文档；
- 当前 shell 默认 Node/npm 为 `v25.9.0 / 11.12.1`，不满足 package 约束；本轮只读复核没有借此重跑测试。既有正式产品证据均使用 Node `22.23.1`、npm `10.9.8`；
- 受保护未跟踪文件 `spec/public-templates-director-split-revision.json` 未读取、未修改、未格式化、未暂存；
- 本轮静态扫描 159 个 TS/TSX 文件，复核 import、关键调用链、跨域 SQL 和现有测试 seam；发现的强连通分量反向边均为 type-only，没有确认新的运行时循环；
- 2026-08-22 离线 P1 补充纠正：上述论断来自旧静态扫描，没有完整覆盖 dynamic import。新 TypeScript Compiler API 图在同一冻结 base 上确认 1 个由 16 个 server 文件组成的既有 runtime SCC，已作精确 baseline 冻结；这是审计证据纠正，不表示 P1 扩张业务重构或发现新生产故障。
- 本轮没有运行 TypeScript、build、浏览器或 full；没有访问真实 Provider、OSS、SSH 或生产。`VIEW-005`只继承已记录的 m79 安全定向 `3/3 PASS`，不冒充本轮新测试。

状态标签：

- `已实锤`：当前代码或 Git 可直接证明；
- `高可信推断`：调用链明确，但本轮没有运行时验证；
- `未验证`：缺少足够当前证据；
- `已否定`：当前代码已能排除该说法。

## 3. 当前实际模块地图

| 模块 | 对外入口 | 数据归属 | 当前成熟度 | 主要边界问题 |
|---|---|---|---:|---|
| Canvas | `CanvasShell`、`CanvasSurface`、`/api/canvas` | `canvas_documents`、`project_metadata`、revision/journal | 50% | ReactFlow交互、保存协议、模板落图和执行前revision闸门集中在CanvasSurface |
| Workflow | `WorkflowExecutionProvider`、`NodeExecutorRegistry` | 浏览器run/checkpoint/lease/lock | 80% | 已headless，但executor仍依赖React setter、ProbeNode字段和Canvas保存回调 |
| Generation Tasks | `/api/generation-tasks`、`generationTaskStore`、`GenerationResultCommit` | task/event/attempt/admission表 | 70% | 结果提交边界已清楚；协调器仍直接读取Canvas、Auth、Model、Provider表，并驱动具体媒体Provider和恢复 |
| Provider Adapters | `TextGenerationProvider`、`TextProviderRegistry`、Provider admin API、具体adapter | Provider profile、连接与凭据元数据 | 70% | 同步文字已有唯一port/registry；图片、视频、音频仍按后续触发批治理 |
| Media/Storage | assets/audio/video API、MediaLifecycle | media/publication/delete intent及对象 | 60% | Media已不再更新Generation表；Provider仍直接依赖MediaLifecycle/OSS，local/OSS分支散落，无统一后端接口 |
| Templates | `/api/templates`、`/api/admin/templates` | user/public template和种子 | 70% | 节点类型、转换、校验和种子在客户端、服务端、脚本重复 |
| Auth/Admin | `/api/auth`、`/api/admin/users` | users、sessions、permissions、account intents | 60% | 账号删除直接清理Task、Media、Canvas、Template和OSS |
| Persistence/Backup | `openAppDatabase`、backup/restore API | SQLite物理设施、schema、备份包 | 40% | 物理安全强，但没有领域repository，业务模块普遍直接SQL |
| Model Catalog | `/api/models`、`/api/admin/models` | model profiles、node bindings | 60% | 直接读取task/attempt/canvas/provider表，能力规则多处重复 |
| Release/Ops | safe runner、build、backup、switch、rollback | artifact、manifest、receipt | 80% | 安全闸门成熟；v0.6.28已确认当前通用发布入口，历史bridge/final工具继续作为迁移历史保留 |

成熟度是边界治理指标，不是功能完成率，也不得作为必须刷到100%的KPI。

## 4. 已清晰的边界

1. Workflow 的纯DAG、分层并发、停止与失败传播已经从React节点挂载生命周期中解耦。
2. Generation Task 已形成可靠账本，拥有task、attempt、幂等、reconcile、retry fence和结果归属。
3. Provider密钥和真实Provider URL不下发浏览器；客户端只调用内部`/api`。
4. Media publication journal、补偿、恢复和对象校验具有明确安全语义。
5. Template HTTP入口、服务端graph校验和发布状态较清楚。
6. Backup、schema inspection、不可变构建和回滚证据采用fail-closed策略。

## 5. 主要耦合问题

当前没有发现新的P0。

### MOD-001：跨模块数据所有权未被接口约束

- 状态：已实锤；风险：P1。
- 证据：`server/auth.ts:1281-1314`直接删除generation/canvas等数据；`server/projects.ts:149-199`直接删除task/attempt；`server/modelCatalog.ts:575-660`直接统计canvas和task。
- 依赖方向：Auth/Project/Model/Template/Media → 其他模块拥有的表。
- 影响：账号删除、项目删除、任务表或schema变化会修改多个模块。
- 最小治理：每域提供transaction-scoped command/query port；保留同一SQLite和原子事务。
- 是否阻断：阻断账号生命周期、任务表演进和存储替换；不阻断普通UI功能。

### MOD-002：Generation执行协调器仍过度集中，已完成文字port和结果提交边界

- 状态：已完成两项关键收口，剩余风险：P1。
- 证据：同步文字路径只调用`TextProviderRegistry.generate`，driver/protocol到adapter的选择集中在`server/providerRegistry.ts`；`GenerationResultCommit`统一拥有文字和媒体结果提交，并在同一SQLite事务中核对task/attempt/profile/model/owner与publication证据。`server/generationTasks.ts`仍约6064行、静态扫描有34个内部依赖，继续同时承担图片、视频、音频Provider、下载、轮询、恢复和运行时协调。
- 调用链：HTTP → Generation Task → Provider port/具体媒体adapter → 规范化结果/持久publication → GenerationResultCommit → Task complete。
- 已消除：通用文字任务按具体driver调用adapter；MediaLifecycle直接完成task/attempt；TaskStore与Safety的运行时循环。
- 剩余影响：增加媒体Provider、修改异步恢复或结果下载仍会集中改动`generationTasks.ts`及具体Storage模块。
- 后续治理：新增媒体Provider或显著修改异步恢复时，先抽媒体Provider gateway；不要再次翻修已稳定的结果原子提交事务。

### MOD-003：UI仍承担应用层执行和持久化判断

- 状态：已实锤；风险：P1。
- 证据：`CanvasSurface.tsx:4405-5929`直接处理GET/PUT、revision、journal、conflict和pagehide；Text/Image/Video/Audio节点直接执行`waitForCanvasRevision → ensureGenerationTask → setNodes → flushCanvasSave`。
- 已否定：UI没有直接调用真实Provider、OSS或SQLite。
- 影响：保存协议、单节点执行和新生成节点会牵动画布组件。
- 最小治理：后续抽`CanvasDocumentPort`和`NodeGenerationController`。
- 是否阻断：阻断新生成节点或保存协议大改；不阻断一般画布交互。

### MOD-004：Provider→Storage反向依赖仍在，Media→Task反向写入已消除

- 状态：部分缓解；剩余风险：P1。
- 证据：`relayProviderAdapters.ts:10-25`仍直接导入OSS和MediaLifecycle；但`mediaLifecycle.ts`已不再查询或更新`generation_tasks`、`generation_provider_attempts`、`generation_task_events`，带task的publication必须交给`GenerationResultCommit`完成。
- 影响：Task/Media结果所有权已单向收口；但Provider参考图准备仍绑住当前OSS与publication实现，Storage无法低成本替换。
- 最小治理：第三种Storage backend或统一local/OSS行为前建立`MediaObjectStore`；Provider只消费临时可读引用和对象存储port。
- 是否阻断：阻断第三种存储后端和复杂异步Provider。

### MOD-005：节点、模型、Provider和模板能力契约重复

- 状态：已实锤；风险：P1。
- 证据：`types/modelParameters.ts`、`nodeExecutorRegistry.ts`、`templateCatalog.ts`、`CanvasSurface.nodeTypes`分别维护kind；`modelAvailability.ts`再次硬编码兼容规则。
- 影响：新增可生成节点约需同步十余个契约点；新Provider约6-10个文件；新Storage后端核心约8-12个文件。
- 最小治理：建立单一版本化`NodeCapabilityDescriptor`。
- 是否阻断：阻断新节点或模板类型的安全扩展。

### MOD-006：TaskStore与Safety运行时循环已关闭

- 状态：已关闭；当前不是待施工项。
- 证据：attempt统计与时间查询已进入`generationAttemptQueries.ts`；`generationSafety.ts`对`generationTaskStore.ts`只保留`GenerationTaskKind`的type-only引用，运行时依赖方向为TaskStore → Safety与双方 → AttemptQueries。
- 边界：类型层仍相互引用，不构成运行时循环；后续不得重新把attempt查询实现导回TaskStore。

### MOD-007：组合根和管理UI继续膨胀

- 状态：已实锤；风险：P2。
- 证据：`client/src/App.tsx`约8155行；`vite.config.ts`导入全部server API，并在`169-184`直接读取generation task做readiness。
- 影响：局部修改审查困难、模块依赖检查噪声高。
- 最小治理：按页面/route拆UI；readiness调用Task query port。
- 是否阻断：不阻断当前新功能。

### MOD-008：当前Release入口已确认，历史bridge工具继续冻结保留

- 状态：已确认；当前不是待施工项。
- 证据：v0.6.28发布前只读追踪已确认当前通用路径为safe runner、精确Git archive、staging fresh build、冻结备份和`current`原子切换；历史`0.5.2/0.6.0`脚本属于schema37→39桥接工具。
- 推荐：每次正式发布仍重新核对实际调用链，但不得为了统一外观删除或改写历史migration bridge。

## 6. 合理耦合，不得为了模块化删除

- `runId + taskId + ownershipKey + nodeId + kind`结果所有权门；
- Canvas revision、load token、save fence；
- task准入、attempt和task插入的同一`BEGIN IMMEDIATE`；
- Media publication和Task结果归属的原子性；
- 账号删除的跨域协调职责；
- Backup对完整schema、secret alignment和Provider quiet period的校验；
- Generation runtime中的任务Set/Map及teardown检查。

需要治理的是这些约束的调用边界，不是删除约束本身。

## 7. 百分比计算基线

每个模块按五项各0/1/2评分：

- `A`：公开API；
- `O`：数据所有权；
- `D`：依赖方向；
- `R`：可替换性；
- `T`：独立测试能力。

0=没有；1=部分存在或主要靠约定；2=明确且有代码/测试约束。

| 模块 | A | O | D | R | T | 合计 |
|---|---:|---:|---:|---:|---:|---:|
| Canvas | 1 | 1 | 1 | 1 | 1 | 5/10 |
| Workflow | 2 | 2 | 1 | 1 | 2 | 8/10 |
| Generation Tasks | 2 | 1 | 1 | 1 | 2 | 7/10 |
| Provider | 2 | 1 | 1 | 1 | 2 | 7/10 |
| Media/Storage | 2 | 1 | 1 | 0 | 2 | 6/10 |
| Templates | 2 | 1 | 1 | 1 | 2 | 7/10 |
| Auth/Admin | 2 | 1 | 0 | 1 | 2 | 6/10 |
| Persistence/Backup | 1 | 0 | 0 | 1 | 2 | 4/10 |
| Model Catalog | 2 | 1 | 0 | 1 | 2 | 6/10 |
| Release/Ops | 2 | 2 | 1 | 1 | 2 | 8/10 |
| 分子/分母 | 18/20 | 11/20 | 7/20 | 9/20 | 19/20 | 64/100 |

聚合结果：

- 核心执行链解耦率：`41/41 = 100%`；
- 完整既有矩阵：`48/48 = 100%`；
- 全项目模块边界成熟度：`(A+D)/40 = 25/40 = 62.5%`；
- 数据所有权成熟度：`O = 11/20 = 55%`；
- 可替换性：`R = 9/20 = 45%`；
- 独立测试能力：`T = 19/20 = 95%`，表示存在测试seam，不表示本轮重新跑出PASS；
- 十模块平均成熟度：`64/100 = 64%`；
- 综合模块化完成度：`100%×20% + 62.5%×30% + 55%×20% + 45%×15% + 95%×15% = 70.75%`，即`70.8%`。

`64%`更接近当前模块边界本身的健康度；`70.8%`包含核心执行链和测试seam的加权抬升，不代表“已经完全解耦”。综合指标只用于复核边界变化，不得驱动无用户价值的重构。

## 8. 当前真实优先级

当前没有需要立即施工的新P0，也没有自动启动的下一批。只有在业务触发时才按下列顺序治理：

1. 第三种存储后端或统一local/OSS行为：先抽`MediaObjectStore`，关闭Provider对OSS/MediaLifecycle具体实现的直接依赖；
2. 新生成节点、Canvas保存协议或单节点重试变化：抽`CanvasPersistenceController`与`NodeGenerationController`，让executor不再依赖React Dispatch；
3. 新节点或模板类型：建立单一`NodeCapabilityDescriptor`，收敛重复allowlist；
4. 账号生命周期、项目删除、任务表或领域schema变化：由数据owner提供transaction-scoped port，保留同库事务；
5. `CanvasSurface.tsx`、`generationTasks.ts`和`App.tsx`只在上述真实改动触发时按内聚职责拆分，不做机械搬文件。
