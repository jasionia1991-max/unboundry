# INC-ECOM-002 电商参考图工作流修复方案与施工断点

状态：`PRODUCTION_STATIC_REPAIR_PASS_ONE_REQUEST_REAL_IMAGE_SMOKE_PASS_USER_RESULT_REVIEW`
建立日期：`2026-08-15`
当前阶段：`D7 180秒修复已formal部署；新授权下同一节点一次1K请求成功，结果待用户确认`

## 1. 当前授权与硬边界

用户已确认本方案，可以开始本地离线代码、测试和文档施工。

用户随后明确授权形成 clean candidate、运行正式全量，并通过既有 SSH 对生产模板做只读审计。本批当前允许：

- 修改本地代码、测试和项目文档；
- 使用全新临时数据目录、动态 loopback 端口、假 Provider 和假 OSS；
- 运行项目安全测试入口、类型检查和构建；
- 对现有公共模板图做静态契约检查；
- 通过既有 SSH 对生产模板和模型合同做 `readOnly + query_only` 审计；
- 创建本地 bridge/final candidate commit，并在 clean formal source 上运行安全 full。

本批明确禁止：

- 修改用户已设置的并发值；当前按用户设置的 `500` 视为冻结外部状态；
- 修改 `mediaRoutingEnabled`、OSS 配置、密钥、Bucket、RAM 权限或真实对象；
- 修改生产数据、重启服务、切换 release 或发布；
- 发起真实 Provider、真实 OSS 或任何可能收费的请求；
- 自动重提历史失败任务；
- push、tag 或 PR。

上述边界是本事件首批授权的历史记录。用户随后明确授权正式候选部署、生产模板模型绑定、备份、必要停启和零付费页面/API复核；仍未授权真实 Provider/付费生成、并发或 OSS 变更、push/tag/PR。

## 2. 已确认事实

### 2.1 第一次参考图失败的代码根因

当前 GPT Image 参考图路径存在同锁自锁：

1. `generationTasks.ts` 的 `withProviderRequestLease` 先取得 Provider generation lease；
2. lease 在真正调用 `fetch` 前不会释放；
3. `requestRelayGptImage` 在调用 `fetch` 前，为 `data:` 本地参考图调用 `withReadableStorageProfileReservation`；
4. Provider 配置与 Storage 配置都使用 `secrets/provider-profile-write-lock.sqlite`；
5. 同一请求在持锁期间再次 `BEGIN IMMEDIATE`，等待约 5 秒后失败；Provider 尚未收到请求。

现场原始异常文字已被旧的通用 `GENERATION_FAILED` 覆盖，不能追溯原文；但当前调用顺序、同一锁文件与 5 秒超时已形成确定性代码根因。

### 2.2 既有热修复边界

`INC-ECOM-001 = USER_RECHECK` 只完成：

- Provider 响应中重复结果 URL 别名去重；
- 整组执行遇到节点级不兼容时不再静默停止，错误会写回节点；
- 只恢复 Provider 已完成的既有任务，没有第二次 Provider 提交。

它没有完成：参考图同锁自锁、整组提交前全图兼容预检、显眼的输入不兼容提示、公共模板发布兼容门和全部电商模板验收。

## 3. 修复设计

### A. 参考图准备与付费边界拆分（P0）

把 GPT Image 调用拆为两个阶段：

1. `prepare`：在 Provider lease 之外解析本地参考图、固定 Storage profile、建立 publication journal、上传临时 OSS 对象并生成短时签名 URL；完成后释放 Storage 锁；
2. `send`：重新取得 Provider generation lease，复核任务快照、Provider 配置和账号 credential revision，只在最终网络边界登记唯一 Provider attempt 并发起请求；
3. `cleanup`：无论成功、失败或取消均补偿临时对象；清理失败保留 journal，交现有恢复机制继续处理，绝不因此重提 Provider。

不得用延长 5 秒超时、打开永久 OSS 路由、移除 Provider 安全 lease 或自动重试来掩盖问题。

### B. 错误真相与恢复语义（P0）

至少区分并持久化以下阶段，页面明确显示是否已越过 Provider 边界：

- `REFERENCE_STORAGE_BUSY`：参考图存储准备繁忙，Provider attempt 必须为 0；
- `REFERENCE_UPLOAD_FAILED`：临时上传失败，Provider attempt 必须为 0；
- `REFERENCE_SIGN_FAILED`：短时签名失败，Provider attempt 必须为 0；
- `PROVIDER_REQUEST_FAILED`：已进入 Provider 请求阶段；
- `PROVIDER_RESULT_FORMAT`：Provider 已响应，但结果格式无法安全收口。

不得保存或展示密钥、完整签名 URL、原始媒体字节或敏感提示词。

### C. 整组执行前全图兼容预检（P0）

在创建任何 generation task 之前，对组内所有可执行节点完成静态预检：

- 模型存在且已发布；
- 上游类型、角色、数量和参数组合被模型支持；
- 图结构、节点引用和循环依赖合法；
- 静态不兼容时整组阻止，task POST 和 Provider attempt 均为 0；
- 节点保留常驻、可刷新恢复的明确错误；组提示给出失败节点数量并定位首个问题。

静态兼容预检与逐层运行时就绪检查必须分开：允许上游 Text 在前一层生成后供下游使用，但不能允许模型能力不兼容的节点先产生部分付费任务。

### D. 公共模板兼容门与模板包审计（P0/P1）

公共模板从 `draft` 进入 `published` 前必须增加语义检查，不能只验证 JSON 外形：

- 节点 ID、edge 端点、parent、角色、顺序、重复边和 DAG 合法；
- 每个生成节点推导所需 capability、输入类型/数量/角色和参数；
- 推荐模型存在且兼容；不兼容时拒绝发布并返回逐节点原因；
- 导入时推荐模型失效不得静默切换到收费或质量不同的模型，必须要求用户明确选择兼容模型。

对全部现有电商模板生成一份静态矩阵：`PASS / NEEDS_MODEL / INVALID / USER_RECHECK`。未经静态通过和代表性真实验收，不得标记为“已验证模板”。

## 4. 零费用自动验收

所有自动检查使用临时数据、假 OSS、假 Provider和动态 loopback，真实外部请求为 0。

必须覆盖：

1. `mediaRoutingEnabled=false + active OSS + 本地参考图` 能在假 Provider 收到一次签名 URL 请求；
2. 1、5、20 个并行参考图节点无 5 秒锁超时，每个任务最多一次 Provider attempt；
3. OSS 上传、签名、Provider 配置变化、请求失败、结果成功和清理失败逐点故障注入；
4. 清理失败保留可恢复 journal，重启恢复不重新请求 Provider；
5. 任一静态不兼容节点使整组 task POST=0、Provider attempt=0；
6. 上游 Text→下游 Image 的合法分层工作流仍可运行；
7. 重复结果别名只保存一个结果，两个不同结果在预期单结果时安全拒绝；
8. 节点错误保存、重载和重新选择兼容模型后的清除语义正确；
9. 所有公共模板通过结构与能力静态审计，失败模板不能发布；
10. 受影响专项、关键并发压力、TypeScript、production build 和安全全量回归全部通过。

## 5. 真实验收与发布门

正式部署与模板静态修正已经用户授权并完成；仍需用户另行授权：

1. 单参考图、单图片节点、最多一次付费请求的真实 smoke；
2. 明确节点数和最大请求数后，对「服装详情页｜面料与工艺拆解」做一次完整真实验收；
3. 如真实验收暴露新问题，再决定是否需要新正式版本号。

第一次失败发生在 Provider 前，没有远端结果可恢复。此后用户已授权一次受限真实图片smoke；该请求已越过Provider边界但在同步端点约121秒时被旧120秒deadline中止，没有返回`provider_task_id`或结果素材。它属于`outcome-unknown`，不得自动重提。180秒修复部署后再次生成仍属于新的可能收费请求，必须取得新的明确授权。`INC-ECOM-001` 已恢复的既有结果继续保留，不得重提。

## 6. 连续施工与上下文恢复

每完成一个阶段，必须同步本文件、`TASKS.md`、`spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md` 和 `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`。任何上下文压缩或换 Agent 后，按以下顺序恢复：

1. `AGENTS.md`；
2. `README.md`；
3. 本文件；
4. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md` 顶部当前事件；
5. `TASKS.md` 的 `INC-ECOM-002`；
6. 验收矩阵的 `INC-ECOM-002`；
7. 只读核对仓库路径、分支、HEAD、工作树、package 与 Node。

任一身份或授权不一致立即停止。聊天摘要和内部记忆只能帮助定位，不能替代本断点。

## 6.1 当前施工结果

- A已完成：本地`data:`参考图在Provider lease外完成临时OSS上传和短时签名；发送阶段只持Provider lease；清理失败保留journal且不重提Provider。
- B已完成：新增`REFERENCE_STORAGE_BUSY / REFERENCE_UPLOAD_FAILED / REFERENCE_SIGN_FAILED / PROVIDER_REQUEST_FAILED / PROVIDER_RESULT_FORMAT`；页面说明是否越过Provider边界，不展示签名URL、密钥或原始媒体。
- C已完成：整组执行先预检全部可执行节点，再创建任何运行组/task；提示失败节点数量和首个节点；节点错误持久化；模型目录未就绪、模型缺失、停用或能力不兼容均为静态阻止项。
- D已完成实现：公共模板进入/恢复/更新为published前做结构、DAG、角色、顺序、参数、明确模型和能力检查；管理页显示兼容状态；模板导入保留edge角色/顺序，缺模型时要求用户明确选择而非借用默认模型。
- 生产只读矩阵已完成：schema39 共19条模板（18 published、1 archived）均为`NEEDS_MODEL`，`INVALID=0 / PASS=0`；唯一问题为99个执行节点没有保存模型，其中published模板87个。「服装详情页｜面料与工艺拆解」明确为5个节点缺模型。详见`INC_ECOM_002_TEMPLATE_COMPATIBILITY_MATRIX_2026-08-15.md`。
- 审计器回归已修复：首次只读审计把5条短视频模板的合法`text→storyboard`连线误报INVALID；已改为复用画布连接合同，新增m77专项并`9/9 PASS`。
- 已通过安全定向：m88含确定性Storage busy和1/5/20并行参考图`34/34`；m53 `23/23`；m22+m70+m77 `30/30`；修复旧Text输入提示误伤后m22/m29/m36/m50/m65 `28/28`。上传/签名失败、Provider请求/结果、清理journal、模板发布门、管理页和组预检均由假Provider/OSS验证；真实外部请求0。
- 最终非发布产品回归：安全入口发现`117 files / 953 tests`；执行全部不依赖正式发布制品的`113 files / 926 tests`，结果`926/926 PASS`，失败/跳过/重试/报告错误/blocked均0，`deniedViteWildcardProbes=516`；文档同步前449-file source/snapshot SHA-256均为`d5836ca074537bb763fbac07722d711ca25b897028a6e48bee9b11272ce958cc`，4173 listener SHA-256仍为`dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae`，suite已清理。
- 正式候选与full已完成：bridge `45e9cefe489ffea23970517c420bf9c64a49896b`（v0.5.2）和其唯一直接子final `e1e0e0d33809a519e8856d11135237a6a30ff912`（v0.6.0）已形成，B→F只改`package.json/package-lock.json`三个版本值。clean final上安全入口执行`117/117 specs、954/954 PASS`，失败/跳过/重试/报告错误/blocked均0，`deniedViteWildcardProbes=516`；immutable builder `attempts=1 / builderInvocations=5 / passed=1 / failed=0`；449-file source/snapshot SHA-256均为`0720f06d14e8c3d85ee22e596a28c51f7a1f68b6c1dceb46f66b7bc8633e27e8`，4173 listener SHA-256仍为`dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae`，suite cleaned、exit0。
- 生产部署已完成：Linux x64 glibc formal artifact绑定final `e1e0e0d33809a519e8856d11135237a6a30ff912`、source tree `9bfb43d456f8e250657a82f4f4574dff73cb1620`、Node22.23.1/npm10.9.8；manifest `692995bc9f6fc6833b314afeaea65bc5d367142aa03234299c4ab02b76aa56ff`、inventory `a2b685f64e1f3acab915e6b22d1f6dc05b2ffd75f6d5345e006f5bcb6af96151`均通过 admitted-release 全量库存复核。生产current已从保留的INC-ECOM-001 hotfix切换到`/opt/unboundry/releases/v0.6.0`。
- 生产模板事务已完成：19条模板全部静态`PASS`，99个执行节点明确绑定模型（published模板87个；Text50/Image42/Video7），缺模型0；7处历史`Auto`规范化为`auto`。目标模板「服装详情页｜面料与工艺拆解」2个Text节点绑定Doubao Seed，3个Image节点绑定GPT Image 2专用协议。短视频节点绑定grok-video-3.5，避免Seedance不支持`reference-image`角色的问题。
- 回滚与零费用证据：停服后创建`/var/lib/unboundry-rollbacks/inc-ecom-002-20260815`，主库停机SHA-256 `347b07f2ade6b9f6a3f0d70d433ec0c828605d9b9101d34e343594c905ff94a8`并保留WAL/SHM，副本schema39/integrity ok/FK0；旧`v0.6.0`产物保存在`/opt/unboundry/retired-releases/20260815-pre-inc-ecom-002/v0.6.0`，前一current hotfix未删除。部署前后generation tasks=`106`、provider attempts=`104`、admission events=`8`、publication attempts=`3`、active=`0`，没有生成或付费请求。
- 零付费生产复核已完成：service active，公网live/ready/version/root正常，version0.6.0、ready active/schema39；登录Chrome实页打开公共模板面板，可见「服装详情页｜面料与工艺拆解」及其他电商模板，控制台warning/error为0。该项只证明页面与静态合同，不是图片真实生成或用户结果验收。
- 后续状态：一次受限真实图片smoke已执行并按失败事实保留；目标模板完整真实生成和用户实页结果确认仍待新授权并继续独立控制请求数与费用。本次未改用户并发、OSS路由/配置/密钥/对象，也未push/tag/PR。

## 6.2 单次真实 smoke 与超时修复结果

- 授权边界：仅目标模板「服装详情页｜面料与工艺拆解」的`工艺拆解·完整商品`节点，最多一次真实图片Provider请求；不自动重试、不运行另外两个图片节点或视频。
- 执行事实：项目`18255461-b14f-40dd-9dbb-d3c307649387`，任务`e5cfd5bc-2863-4eb1-9546-4a93c76b17e7`，Provider attempt 131。参考图/OSS准备与静态预检均通过，请求只提交一次；约121秒后任务为`failed / PROVIDER_REQUEST_FAILED`，attempt为`outcome-unknown`，`provider_task_id=null / result_asset_id=null`。
- 可恢复性：该模型绑定使用GPT Image专用同步协议；Provider在连接期限内没有返回可轮询任务ID，因此本次结果不能从Unboundry恢复。未知结果保护按设计没有创建第二个attempt。
- 新根因：`sendPreparedRelayGptImageRequest`沿用通用JSON请求默认`120000ms`，而项目统一Provider submit deadline已是`180000ms`；历史专用图片编辑成功耗时曾达到约70～115秒，本次精确撞到旧120秒窗口。
- 代码修复：`server/relayProviderAdapters.ts`显式使用`providerRequestTimeoutMsByOperation.submit`，导出并测试GPT Image deadline为`180000ms`；不改变同步协议、不改变自动重试规则。m53+m57+m88定向`66/66 PASS`，clean正式full `117/117 specs、954/954 PASS`。
- 正式部署：final commit `de0551c8187156f0283f330a39e15e5825f1f2c5`、tree `b083289ae514f6b7c7c3cdef7953065deb2c7276`、Linux x64 glibc production manifest `5386c74440f8868719bb7942af31437a1a2dfcbb9de28d604ccf836ddc1478b1`已部署到`/opt/unboundry/releases/v0.6.0`。旧release保存在`/opt/unboundry/retired-releases/20260815-pre-inc-ecom-003/v0.6.0`，停机备份在`/var/lib/unboundry-rollbacks/inc-ecom-003-20260815`且SHA清单全量通过。
- 部署后：service active，公网live/ready/version/root正常，ready active/schema39；quick_check ok、active0、tasks108、Provider attempts106、pending publication0。刷新原验收画布后，失败节点和“不自动重提/先核对模型平台”提示仍可见，没有伪造结果或清除未知状态。Provider/Storage密文配置SHA前后不变，用户设置的各并发和RPM仍为500，OSS路由/配置/密钥/对象未改。
- 当前结论：`REFERENCE/OSS/PREFLIGHT_PASS`已获得真实路径证据；`REAL_IMAGE_SMOKE_FAIL_PROVIDER_TIMEOUT`保留；代码状态为`GPT_IMAGE_TIMEOUT_REPAIR_DEPLOYED`。不能标记真实图片PASS或用户PASS，下一次生成必须由用户重新授权。

## 6.3 修复后成本受控真实复验

- 新授权边界：只对同一`工艺拆解·完整商品`节点提交一次；保持GPT Image 2专用协议、3:4与最低现有1K，不运行另外两个图片节点，不自动重试。
- 计数门：提交前tasks108、Provider attempts106、active0；提交后只增加task `9e4faf78-e466-4ae7-8799-2c9d2150bed6`和Provider attempt 132，最终tasks109、attempts107、active0，没有第二条新attempt。
- 结果：约58.6秒一次成功，attempt为`completed`，result asset `9f755d07-42df-47a0-9bd1-443030244a59`已绑定节点；PNG `1023×1537`、1,545,396 bytes、SHA-256 `ecf51e6ca9f081b4b98cd12f9917b51bd8518129ab9613dc2a3f296d638ddb44`、storage ready。
- 页面与数据：刷新原画布已显示生成结果及收藏、替换、下载、全屏等正常操作；数据库quick_check ok。系统审计字段记录estimated/actual均为10,000,000 microunits USD，这是管理员模型配置的记账值，不等于已核验上游账单。
- 结论：超时修复后的`ONE_REQUEST_REAL_IMAGE_SMOKE_PASS`成立；图片内容质量仍为`USER_RESULT_REVIEW`。目标模板另外两个图片节点、完整三图和视频没有运行，未来继续需要独立授权。

## 7. 当前恢复卡

```text
项目：/Users/mymy/Documents/unboundry/app
分支：codex/unboundry-offline-remediation-2026-08-09
本次生产候选：de0551c8187156f0283f330a39e15e5825f1f2c5
package：0.6.0
当前事件：INC-ECOM-003
状态：PRODUCTION_STATIC_REPAIR_PASS_ONE_REQUEST_REAL_IMAGE_SMOKE_PASS_USER_RESULT_REVIEW
当前阶段：D7 修复后同一节点一次1K请求成功，另外两图未运行
既有脏改动：INC-ECOM-001 热修复、相关测试和历史施工文件，全部保留，不得 reset/clean
正式候选：bridge 3b43e9de40ba0921e29cd169e1c3cd945a247c17；final de0551c8187156f0283f330a39e15e5825f1f2c5
正式full：117/117 specs，954/954 PASS，builder 1/5/1/0
允许：本地证据文档收口
禁止：自动重提任务e5cfd5bc或9e4faf78、并发/OSS路由修改、另外两图/视频真实Provider、push/tag/PR；本次成本受控单节点授权已消费
下一步：等待用户确认当前图片质量；完整三图/视频继续单独授权
```
