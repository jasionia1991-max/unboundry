# Unboundry 渐进式模块化施工路线图

更新日期：2026-08-26
状态：`PLAN_FROZEN / FIRST_AND_SECOND_BATCH_PRODUCTION_PUBLISHED / CURRENT_V0_6_66_USER_RECHECK / VIEW_005_AUTO_PASS / CURRENT_GOVERNANCE_HARDENING`
关联审计：`spec/UNBOUNDRY_MODULAR_MONOLITH_AUDIT_2026-08-21.md`

当前收口：第一批同步文字 Provider port 与第二批 Generation/Media 结果提交边界、三媒体模型合同均已发布并持续包含在 v0.6.56；云腾商业 Provider 隔离和真实结果兼容已在 v0.6.29/30 完成，模块化成果随 v0.6.31 进入普通 main-safe 生产路径。v0.6.32的真实图片裁剪功能只在触发点增加可取消存储读取port和可替换客户端resolver；INC-IMGEDIT-003～006按第四批触发原则完成图片工具需要的轻量Dispatcher、Canvas命令端口、UI Host和产品质量边界；v0.6.41按同一原则增加角色合规Port/Application/Store及付费前门，v0.6.42只增加accepted-only恢复租约并复用既有Canvas拖动quiet gate，没有重做整个Canvas。v0.6.47完成项目默认Node25/npm11与生产Node22/npm10分工治理并已发布；v0.6.49/50完成MODEL-CONTRACT-001后端、数据和入口，v0.6.51完成用户复验返工，v0.6.54完成MODEL-CONTRACT-002历史revision解耦，v0.6.55/56完成INC-GEN-016结果恢复与数字task ID真实闭环。`VIEW-005` 已由精确 98/171/200 节点安全定向证据收口为 `AUTO_PASS`。当前没有自动启动的后续批次，路线图只在真实新功能触发边界问题时重新立项。

## 1. 目标与非目标

目标是把Unboundry治理成边界可复核的模块化单体，让新功能经过模块公开接口接入，并在真实阻塞点出现时顺手解耦。

非目标：

- 不拆微服务；
- 不换SQLite；
- 不重写Canvas、Workflow、Generation或Release系统；
- 不为了提高百分比移动目录或机械拆文件；
- 不重新否定v0.6.27已经通过的Canvas/Workflow解耦；
- 不把`VIEW-005`的`AUTO_PASS`冒充新的`USER_PASS`、生产发布或全量回归；
- 不提前改没有功能触发、当前稳定且高风险的模块。

## 2. 目标模块边界

| 模块 | 公开命令/查询 | 数据所有权 |
|---|---|---|
| Canvas | `LoadCanvas`、`SaveCanvas`、`ApplyNodePatch`、`ApplyTemplate`、`GetCanvasSnapshot` | canvas/project/revision |
| Workflow | `RunWorkflow`、`StopWorkflow`、`ResumeWorkflow`、`GetRunStatus` | run/checkpoint/lease/lock，不拥有task |
| Generation | `SubmitTask`、`ReconcileTask`、`RetryTask`、`AbandonTask`、`GetTask` | task/event/attempt/admission |
| Provider | `Submit`、`Inspect`、`Cancel`、`NormalizeResult` | provider profile和连接；不写task/media |
| Media | `Put`、`Publish`、`GetReadReference`、`Delete`、`Inspect` | media/publication/delete intent和对象 |
| Templates | `CreateTemplate`、`PublishTemplate`、`GetTemplateGraph` | user/public templates和canonical seed |
| Auth | `Authenticate`、`Authorize`、`DeleteAccount` | users/sessions/permissions/account intents |
| Persistence | `DbSession`、`Transaction`、migration/schema contract | SQLite物理设施，不拥有业务表 |
| Model Catalog | `PublishModel`、`BindNodeCapability`、`QueryAvailableModels` | model profiles/bindings |
| Release/Ops | build、verify、backup、switch、rollback | artifact/manifest/receipt |

推荐执行流：

```text
UI
  -> Workflow.RunWorkflow
  -> Canvas.GetSnapshot
  -> Generation.SubmitTask
  -> ProviderGateway.submit/inspect
  -> Media.Publish
  -> Generation.CommitResult
  -> TaskSucceeded
  -> Canvas.ApplyNodePatch + SaveCanvas
```

付费边界、attempt、媒体结果归属继续使用同步事务/直接命令。事件只用于提交后的通知、任务面板和缓存刷新，不得为了形式上的事件化削弱原子性。

## 3. 禁止依赖方向

- UI不得导入server、Provider实现或Repository；
- Provider adapter不得导入MediaLifecycle、OSS具体实现或TaskStore；
- Media不得直接更新generation表；
- Auth、Project、Template、Model不得直接SQL读写他域表；
- Vite composition root不得包含业务SQL；
- 模块只能导入其他模块的公开contract，不能导入内部repository；
- infrastructure只能实现application/domain定义的port，不得反向调用UI；
- 不允许新增运行时循环依赖。

## 4. 施工策略

路线图分为“已完成批次”和“功能触发批”。第一、第二批均已发布并包含在当前 v0.6.33；后续批次只在对应新功能出现前强制执行，不允许绕过，也不为了架构好看提前翻修稳定代码。

2026-08-22 只读复核没有发现新的P0，也没有批准下一施工批。文字Provider port、Generation结果提交、Media不再写Generation表以及TaskStore/Safety运行时循环均已确认收口；剩余主要风险是Canvas应用层仍依赖React状态、媒体Provider仍直接依赖Storage实现、跨域SQL和节点能力清单重复。本次只同步文档，没有修改产品代码，也没有重跑测试、访问Provider/OSS或生产。

### 第一批：同步文字Provider port

- 状态：原本地工程为 `LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW`；后来随 v0.6.28 发布并持续包含在当前 v0.6.33。原矩阵未运行真实Provider的证据边界继续保留。
- 触发：2026-08-21 Goal已执行完毕；授权随本批结束失效。
- 目标：让同步文字Provider可由registry/fake替换，通用任务协调器不再按具体driver分支。
- 精确现有范围：
  - `server/generationProvider.ts`；
  - `server/generationTasks.ts`的同步文字执行分支；
  - `server/volcengineArkTextProvider.ts`；
  - `server/relayProviderAdapters.ts`的文字协议；
  - `server/providerRegistry.ts`单一入口；
  - `tests/m33-text-generation-runtime.spec.ts`；
  - `tests/m39-ark-text-auth-errors.spec.ts`；
  - `tests/m44-provider-profile-atomicity.spec.ts`；
  - `tests/m53-relay-provider-adapters.spec.ts`；
  - `tests/m57-relay-generation-runtime.spec.ts`。
- 明确不碰：Canvas、Workflow、Media publication、数据库schema、真实Provider、OSS、生产。
- 回滚：无schema和数据变化；整批逆向补丁，或在明确获得提交授权后revert独立批次。
- 实现结果：
  - 原未使用的媒体形态`GenerationProvider`假抽象已明确收敛为同步文字`TextGenerationProvider` port；
  - `TextProviderRegistry`按已解析的`profile.driver + protocol`选择Ark native或四类relay文字实现；
  - Generation Task保留输入物化、profile/credential lease、attempt、task状态与结果写回，只调用一个registry入口；
  - adapter只收到已授权profile、规范化文字请求和执行回调，返回`text + providerUsageTokens`，不获得数据库或TaskStore；
  - m33新增fake port注入和未知实现零网络断言，安全测试冻结清单从1029更新为1030。
- 验证结果：Node `22.23.1` / npm `10.9.8`下，一次`npx tsc --noEmit`退出0；m33 `8/8`、m39 `3/3`、m44 `8/8`、m53 `23/23`、m57 `14/14`通过，均使用安全runner、新临时目录和动态loopback端口；未运行full。
- 完成标准与逐项证据：见首批验收矩阵。

### 第二批：Task/Media结果提交边界

- 状态：原本地工程为 `LOCAL_ENGINEERING_COMPLETE / AUTO_PASS / USER_REVIEW`；由三媒体异步模型Goal触发并完成，随 v0.6.28 发布，后续 v0.6.29/30 已补真实Provider与结果兼容证据。
- 触发：准备新增异步Provider、改变任务恢复/结果提交或修改Media publication时。
- 目标：移除TaskStore↔Safety运行时循环；建立Task拥有的`GenerationResultCommit`。
- 范围：`generationTaskStore.ts`、`generationSafety.ts`、`mediaLifecycle.ts`、`mediaRegistry.ts`及m5/m14/m38/m40/m88。
- 风险：P1；必须保留同一SQLite事务和所有付费证据。
- 完成标准：Media不拥有任务状态机；Task/Safety无运行时循环；既有attempt/idempotency行为不变。
- 当前回执：`GenerationResultCommit`已成为唯一Generation侧结果事务编排者；MediaLifecycle/MediaRegistry已移除generation SQL；第一提交`3144d7a`。直接回归包含在三媒体Goal十spec最终有效`148/148`证据中。

### 第三批：Storage backend port

- 触发：增加第三种存储后端前，或需要统一local/OSS行为时。
- 目标：建立`MediaObjectStore`，统一put/head/delete/sign/read。
- 范围：`assetStorage.ts`、`audioStorage.ts`、`videoStorage.ts`、`aliyunOss.ts`、`secureStorageProfiles.ts`、`providerMedia.ts`、`providerResultMedia.ts`及m37/m54/m80/m87/m88/m90。
- 风险：P1；首轮只包住现有local/OSS，不新增backend enum、不迁移数据。
- 完成标准：三类媒体复用同一后端port，Provider不直接拥有OSS实现。

### 第四批：Canvas应用层与单节点执行

- 触发：新增可生成节点、修改Canvas保存协议、改变单节点retry/reconcile时。
- 目标：抽`CanvasDocumentPort`、`CanvasPersistenceController`和`NodeGenerationController`。
- 范围：`CanvasSurface.tsx`、`GenerationCanvasContext.tsx`、`nodeExecutorRegistry.ts`、`workflowNodeExecutors.ts`、Text/Image/Video/Audio节点及m3/m22/m41/m62/m85/m86/m98。
- 风险：高；v0.6.27刚稳定，不得无触发提前施工。
- 完成标准：executor不依赖React Dispatch；单节点和整组共用保存与任务port；所有ownership/revision fence保留。

### 第五批：单一Node Capability Catalog

- 触发：增加新节点或模板类型前。
- 目标：节点类型、是否可执行、模型能力、输入、模板兼容性只登记一次。
- 范围：`types/modelParameters.ts`、`ProbeNode.tsx`、`CanvasSurface.tsx`、`groupTemplate.ts`、`CanvasShell.tsx`、`workflowExecution.ts`、`templateCatalog.ts`、`templateCompatibility.ts`、seed校验及m17/m22/m27/m70/m71/m77。
- 风险：P1；不得改变已有模板序列化格式。
- 完成标准：新增类型只修改descriptor、renderer/adapter和直接测试，不再同步十余个allowlist。

### 第六批：数据所有权与账号生命周期

- 触发：修改账号删除、用户数据生命周期、任务表、项目删除或领域schema时。
- 目标：跨域操作通过transaction-scoped port，Auth只负责授权、claim和协调。
- 范围：`auth.ts`、`permissions.ts`、`projects.ts`、`modelCatalog.ts`、`providerProfiles.ts`、`templateCatalog.ts`、`adminTemplates.ts`及m11/m21/m49/m66/m71/m73/m78/m88。
- 风险：高；不得先移动表或拆数据库。
- 完成标准：跨域SQL由数据owner提供；原账号删除、转移、恢复和审计语义不变。

### 第七批：Release调用链核对与条件治理

- 触发：下一次正式发布准备阶段。
- v0.6.28正式发布前已完成首次只读追踪，确认当前通用路径为safe runner、精确Git archive、staging fresh build、冻结备份和`current`原子切换；历史`0.5.2/0.6.0` bridge不是当前通用入口。
- 下一次正式发布仍需重新只读核对实际构建、切换和receipt路径。
- 只有确认当前通用发布入口受阻时，才治理`build-release.mjs`、`admitted-release.mjs`、`release-source-pair.mjs`、`release-attestation.mjs`和m94/m95/m96。
- 不得把历史migration bridge删掉或改写成当前通用流程。

## 5. 统一测试与安全规则

- 施工前使用Node `22.23.1`、npm `10.9.8`；
- 测试使用新临时数据目录和动态loopback端口；
- 禁止4173、`app/data`、`/var/lib/unboundry`、真实媒体和真实密钥；
- 不运行默认`npm run verify`；
- 每批先跑类型检查和最小定向测试，风险传播时再扩大；
- 只有最终候选且得到当前Goal授权时，才允许通过安全runner执行一次最终full；
- fake fetch、零请求断言优先于真实Provider；
- 自动测试、Agent页面验收、生产技术验收和USER PASS必须保持不同状态；
- 受保护JSON不得读取、提交、删除、改名、覆盖或格式化。

## 6. 防止过度重构的停止条件

出现以下任一情况，应停止扩张当前批次，而不是顺手治理更多模块：

- 改动不再服务本批公开API或验收项；
- 为了移动目录而需要改大量无关import；
- 需要改变数据库schema但本批目标没有要求；
- 需要削弱runId、attempt、ownership、revision或publication原子性；
- 只能通过真实Provider/OSS才能证明接口成立；
- 发现受保护文件或用户改动与目标文件重叠；
- 施工开始追求百分比而不是实际新增功能的改动面下降。
