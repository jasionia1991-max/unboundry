# Unboundry 全项目模块化单体审计

更新日期：2026-08-21
状态：`FIRST_BATCH_IMPLEMENTED_AUTO_PASS / USER_REVIEW`
适用仓库：`/Users/mymy/Documents/unboundry/app`

## 1. 一句话结论

Unboundry 已有可靠的模块化骨架，但还不是边界受约束的模块化单体；第一批已把同步文字执行收口到唯一的Provider registry/port，Generation Task不再按具体文字driver调用adapter，fake Provider可零网络注入。其余最大瓶颈仍是Generation Tasks、Provider、Media围绕共享SQLite相互读取或修改数据；后续按触发条件渐进治理，当前不需要全项目大重构。

本结论不得被解释为否定 v0.6.27 已完成的画布执行解耦：核心 P0 为 `41/41 = 100%`，完整矩阵为 `47/48 = 97.9%`；剩余 `VIEW-005` 是 98/171/200 节点性能专项，仍为 `NOT_RUN`。

## 2. 审计基线与证据边界

只读审计基线与第一批施工结果：

- 分支：`codex/unboundry-offline-remediation-2026-08-09`；
- HEAD：`4cad6fc45d9db1937fbc90475180181b69745aa4`；
- `origin/main`：`3c967157b6fd257264556cc02f3ebceb3d033922`；
- HEAD 与 `origin/main` 文件树一致，提交历史不同；
- package：`0.6.27`；
- shell默认仍是Node/npm `v25.9.0 / 11.12.1`；第一批所有施工和验证均显式使用`/Users/mymy/.local/bin`中的Node `22.23.1`、npm `10.9.8`；
- 受保护未跟踪文件`spec/public-templates-director-split-revision.json`未读取、未修改、未格式化、未暂存；
- 第一批仅修改同步文字port/registry、两个文字adapter、Generation Task文字分支、定向测试及对应文档/安全测试清单；
- 已运行一次`npx tsc --noEmit`和m33/m39/m44/m53/m57定向安全测试；未运行默认`npm run verify`或最终full；
- 未访问真实Provider、OSS、SSH或生产，未修改版本、schema、Canvas、Workflow、Media publication或生产配置。

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
| Generation Tasks | `/api/generation-tasks`、`generationTaskStore` | task/event/attempt/admission表 | 60% | 直接读取Canvas、Auth、Model、Provider表，并驱动具体Provider和Media |
| Provider Adapters | `TextGenerationProvider`、`TextProviderRegistry`、Provider admin API、具体adapter | Provider profile、连接与凭据元数据 | 70% | 同步文字已有唯一port/registry；图片、视频、音频仍按后续触发批治理 |
| Media/Storage | assets/audio/video API、MediaLifecycle | media/publication/delete intent及对象 | 50% | Media与Task双向SQL；local/OSS分支散落，无统一后端接口 |
| Templates | `/api/templates`、`/api/admin/templates` | user/public template和种子 | 70% | 节点类型、转换、校验和种子在客户端、服务端、脚本重复 |
| Auth/Admin | `/api/auth`、`/api/admin/users` | users、sessions、permissions、account intents | 60% | 账号删除直接清理Task、Media、Canvas、Template和OSS |
| Persistence/Backup | `openAppDatabase`、backup/restore API | SQLite物理设施、schema、备份包 | 40% | 物理安全强，但没有领域repository，业务模块普遍直接SQL |
| Model Catalog | `/api/models`、`/api/admin/models` | model profiles、node bindings | 60% | 直接读取task/attempt/canvas/provider表，能力规则多处重复 |
| Release/Ops | safe runner、build、backup、switch、rollback | artifact、manifest、receipt | 80% | 安全闸门成熟；历史bridge/final契约是否仍为当前发布入口需另行追踪 |

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

### MOD-002：Generation执行协调器仍集中Task和Media，文字driver耦合已收口

- 状态：部分缓解；剩余风险：P1。
- 证据：同步文字路径现在只调用`TextProviderRegistry.generate`，driver/protocol到adapter的选择集中在`server/providerRegistry.ts`；Ark与relay adapter实现各自拥有序列化、请求边界和错误规范化。`server/generationTasks.ts`仍同时承担图片、视频、音频、Media与恢复协调。
- 调用链：HTTP → Generation Task → 同步文字port/registry → 具体文字adapter → 规范化文字/usage → Task结果写回。
- 已消除：通用任务协调器按`volcengine-ark`/`multi-protocol-relay`分支编排同步文字adapter。
- 剩余影响：图片、视频、音频Provider和Media结果提交仍会牵动任务状态、费用、媒体和恢复。
- 后续治理：只在异步Provider或Media result commit触发第二批时继续，不顺手扩张。

### MOD-003：UI仍承担应用层执行和持久化判断

- 状态：已实锤；风险：P1。
- 证据：`CanvasSurface.tsx:4405-5929`直接处理GET/PUT、revision、journal、conflict和pagehide；Text/Image/Video/Audio节点直接执行`waitForCanvasRevision → ensureGenerationTask → setNodes → flushCanvasSave`。
- 已否定：UI没有直接调用真实Provider、OSS或SQLite。
- 影响：保存协议、单节点执行和新生成节点会牵动画布组件。
- 最小治理：后续抽`CanvasDocumentPort`和`NodeGenerationController`。
- 是否阻断：阻断新生成节点或保存协议大改；不阻断一般画布交互。

### MOD-004：Provider、Storage和Task存在反向依赖

- 状态：已实锤；风险：P1。
- 证据：`relayProviderAdapters.ts:1-31`直接导入OSS和MediaLifecycle；`mediaLifecycle.ts:553-680`直接更新task/attempt。
- 影响：Provider和Storage无法独立替换，Media改动可能影响付费证据与任务成功归属。
- 最小治理：Provider只消费临时可读引用；Task拥有`GenerationResultCommit`；Media返回publication token。
- 是否阻断：阻断第三种存储后端和复杂异步Provider。

### MOD-005：节点、模型、Provider和模板能力契约重复

- 状态：已实锤；风险：P1。
- 证据：`types/modelParameters.ts`、`nodeExecutorRegistry.ts`、`templateCatalog.ts`、`CanvasSurface.nodeTypes`分别维护kind；`modelAvailability.ts`再次硬编码兼容规则。
- 影响：新增可生成节点约需同步十余个契约点；新Provider约6-10个文件；新Storage后端核心约8-12个文件。
- 最小治理：建立单一版本化`NodeCapabilityDescriptor`。
- 是否阻断：阻断新节点或模板类型的安全扩展。

### MOD-006：TaskStore与Safety存在真运行时循环

- 状态：已实锤；风险：P1。
- 证据：`generationSafety.ts:18-21`运行时导入TaskStore attempt统计；`generationTaskStore.ts:4-8`运行时调用Safety准入。
- 影响：付费安全规则和attempt统计职责互锁。
- 最小治理：把attempt metrics移入无反向依赖的只读模块，准入通过参数或port读取。
- 是否阻断：阻断任务安全规则重构；不是当前线上故障。

### MOD-007：组合根和管理UI继续膨胀

- 状态：已实锤；风险：P2。
- 证据：`client/src/App.tsx`约8155行；`vite.config.ts`导入全部server API，并在`169-184`直接读取generation task做readiness。
- 影响：局部修改审查困难、模块依赖检查噪声高。
- 最小治理：按页面/route拆UI；readiness调用Task query port。
- 是否阻断：不阻断当前新功能。

### MOD-008：Release历史契约需要确认而不是立即重构

- 状态：高可信推断；风险：P2，暂不列入第一施工批。
- 证据：`build-release.mjs`、`admitted-release.mjs`和`release-attestation.mjs`仍固定`0.5.2/0.6.0`；但v0.6.27已有另一条实际发布记录。
- 影响：可能只是历史schema37→39桥接工具，也可能意味着通用发布入口尚未收口。
- 推荐：下一次正式发布前先追踪当前实际发布调用链，再决定是否通用化。

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
| Generation Tasks | 2 | 1 | 0 | 1 | 2 | 6/10 |
| Provider | 2 | 1 | 1 | 1 | 2 | 7/10 |
| Media/Storage | 2 | 1 | 0 | 0 | 2 | 5/10 |
| Templates | 2 | 1 | 1 | 1 | 2 | 7/10 |
| Auth/Admin | 2 | 1 | 0 | 1 | 2 | 6/10 |
| Persistence/Backup | 1 | 0 | 0 | 1 | 2 | 4/10 |
| Model Catalog | 2 | 1 | 0 | 1 | 2 | 6/10 |
| Release/Ops | 2 | 2 | 1 | 1 | 2 | 8/10 |
| 分子/分母 | 18/20 | 11/20 | 5/20 | 9/20 | 19/20 | 62/100 |

聚合结果：

- 核心执行链解耦率：`41/41 = 100%`；
- 完整既有矩阵：`47/48 = 97.9%`；
- 全项目模块边界成熟度：`(A+D)/40 = 23/40 = 57.5%`；
- 数据所有权成熟度：`O = 11/20 = 55%`；
- 可替换性：`R = 9/20 = 45%`；
- 独立测试能力：`T = 19/20 = 95%`，表示存在测试seam，不表示本轮重新跑出PASS；
- 十模块平均成熟度：`62/100 = 62%`；
- 综合模块化完成度：`100%×20% + 57.5%×30% + 55%×20% + 45%×15% + 95%×15% = 69.25%`，即`69.3%`。

综合指标只用于复核边界变化，不得驱动无用户价值的重构。
