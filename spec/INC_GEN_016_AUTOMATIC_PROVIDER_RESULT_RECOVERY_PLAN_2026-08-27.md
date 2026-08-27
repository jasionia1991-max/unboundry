# INC-GEN-016：Provider 结果自动回收与全模型不回归最终方案

状态：`PRODUCTION_V0_6_56_TECHNICAL_PASS / REAL_PROVIDER_PASS / USER_RECHECK`

建立日期：2026-08-27

## 0. 权威与当前边界

本文件是 INC-GEN-016 的唯一实施合同。验收细目以 `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_ACCEPTANCE_MATRIX_2026-08-27.md` 为准，实时状态以 `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_CHECKPOINT.md` 为准。用户已在本次Session用完整`/goal`启动实施；`spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_GOAL_PROMPT_2026-08-27.md` 保留为本次授权来源的冻结副本，不替代实时Checkpoint。

本轮已授权产品代码、测试、v0.6.55、本地commit、GitHub/CI/merge/tag/Release、可恢复生产发布和一次受控真实Provider验收；执行仍受Review GO、唯一safe full、备份/恢复/回滚门、USD 20总预算和unknown禁止第二次POST约束。

2026-08-28续作Goal另行明确指定`v0.6.56`、新增真实生成总预算USD20，并授权修复、Review、GitHub/CI、不可移动tag/Release、生产发布和同一目标Canvas真实验收。续作只修已证实的数字`data.task_ids[]`/`data.任务ids[]`有限响应外壳，不重开v0.6.55、不复用旧预算、不扩张其他Provider协议；具体实时状态以Checkpoint新增的v0.6.56区块为准。

当前生产为 `v0.6.56 / schema41`，真实GK结果门已通过并保持`USER_RECHECK`。以下仅是2026-08-27事故起点的历史证据，不代表当前任务终态：当时生产画布 `67bfb2ee-f895-4308-9111-9de188306514` 的视频节点 `video-019c3604-bae5-4880-b7ac-8410231df6a0` 只提交了一次新付费 attempt，任务 `da761fff-6a65-46fd-84cf-4dc5bddbc985` 从 attempt 1 增至 attempt 2，请求越过 Provider boundary，但没有持久 `provider_task_id`，当时收口为 `OUTCOME_UNKNOWN_BILLING_RISK`。其后v0.6.55已用Provider完整账本证明attempt2未受理且未扣费，唯一替代attempt3被明确退款；v0.6.56新增授权下的attempt4已成功完成并形成正式结果资产。

## 1. 最终产品合同

普通用户唯一需要做的事是点击一次“生成”。此后提交、保存任务号、轮询、断线恢复、服务重启恢复、结果下载、正式资产落库和画布回填全部由系统完成。

冻结语句：

> Provider 成功完成的图片、视频、音频或文本结果必须自动回到 Unboundry；Provider 明确拒绝、审核失败、余额不足或退款时，用户必须在 Unboundry 内看到明确状态。普通用户不得被要求登录中转站、填写平台任务号、点击“核对结果”或自行寻找结果。

第三方平台不能保证每次生成成功；本方案保证的是端到端自动追踪、项目内闭环、费用安全和结果不丢失，不把外部平台故障转嫁给用户。

## 2. 已证实根因

1. `submitContractRelayMedia()` 对成功响应使用顶层字段精确白名单，只允许 `task_id/state`；无害附加字段也会进入 `FORMAT + providerTaskMayStillRun`。
2. 声明式模型合同路径在跨过 Provider boundary 且没有持久任务号时直接把任务转为 failed，并显示“请人工核对”；它没有进入现有 image/video 自动恢复分支。
3. 当前 reconcile 是用户触发的 POST，带 8 秒内存频率限制；找不到唯一账本记录后写入 `OUTCOME_UNKNOWN_BILLING_RISK`，没有持久后台 continuation。
4. 现有恢复循环有固定次数上限；耗尽后仍以“只能继续核对原任务”收口。
5. v0.6.54 发布门证明了合同、模板、迁移和零付费技术安全，但没有真实证明“Provider 创建 → 任务号 → 轮询 → 结果资产 → 画布展示”。Fake Provider 的理想响应不能替代真实端到端证据。

## 3. 范围与非范围

### 3.1 进入本事件

- Text/Image/Video/Audio 共用的持久任务生命周期、提交幂等、Provider 受理证据和结果资产提交语义。
- 每个 connector 自己拥有的创建响应、任务号、轮询、结果和明确失败合同。
- 响应丢失后的自动恢复能力与 Provider connector 发布门。
- 后台 Worker、重启恢复、结果下载/落库、Canvas 幂等投影和任务中心/素材库兜底。
- 普通用户状态和管理员诊断状态分离。
- 当前所有已发布模型、历史任务、旧 Canvas、模板、ModelReleaseRevision 和专用 connector 的非回归保护。
- 风险驱动自动测试、真实 GK 首帧视频验收、独立终审、发布/回滚门和用户手工验收。

### 3.2 不进入本事件

- 不把所有 Provider 强行合并成万能协议或猜测未知字段。
- 不批量升级所有模型 Revision，不改写历史任务、Canvas 或模板。
- 不为了修 GK 改动无关模型的参数、默认值、输入模式或费用规则。
- 不新增人工平台任务号认领，不允许普通用户访问 Provider 控制面完成产品流程。
- 不在无法证明 Provider 恢复能力时伪装模型可用。
- 不借机重做画布 UI、模型中心、素材库或无关架构。

## 4. 冻结合同 APR-01～18

| ID | 冻结要求 |
|---|---|
| APR-01 | 一次用户动作最多创建一个本地任务、一个 execution attempt 和一个 Provider POST；双击、刷新、重放、超时和重启不得产生第二次付费提交。 |
| APR-02 | Provider POST 前必须持久化 task、attempt、请求指纹、Provider/profile/model、credential revision、connector/revision、幂等/关联标识和 `provider-boundary` 证据。 |
| APR-03 | Provider 返回任务号后，必须在首次 poll 前原子持久化；保存失败不得重新提交，只能恢复同一任务。 |
| APR-04 | 响应解析按 connector 声明有限候选路径并要求唯一一致任务号；允许安全的无害附加字段，禁止万能 JSONPath、任意脚本或含密钥内容。 |
| APR-05 | 记录 HTTP 状态、Content-Type、响应大小、Provider request ID、脱敏字段路径、结构哈希和失败阶段；不保存 API Key、Authorization、Cookie、Prompt、签名 URL 或原始媒体。 |
| APR-06 | 每个异步 connector 发布前必须证明至少一种可恢复能力：Provider 幂等键、request ID 查询、唯一账本匹配，或 Unboundry 控制中转层先持久任务号。四者皆无则不得切换为可用新路径。 |
| APR-07 | POST 后响应丢失进入持久 `RECONCILING`，由后台 Worker 自动核对；普通用户不需要点击按钮，且该状态禁止新 Provider POST。 |
| APR-08 | Worker 独立于浏览器和单一进程内存；关页、刷新、部署、服务重启后按数据库 lease/checkpoint 继续。 |
| APR-09 | 自动核对按 Provider 最大任务时长和账本保留窗口指数退避；成功、明确失败、明确退款或系统管理员事故队列是合法收口，普通用户平台核对不是合法收口。 |
| APR-10 | Provider 成功先提交正式 result asset，再投影 Canvas；`success` 不得因 Canvas 冲突、下载瞬态失败或投影失败降级为生成失败。 |
| APR-11 | 下载、资产写入和投影均以 taskId + executionAttempt + result identity 幂等；重放不得复制资产或节点结果。 |
| APR-12 | Canvas 投影使用最新 owner-scoped 文档、generation-owned 白名单和语义/ownership/input CAS；冲突时结果保留在任务中心和素材库，后台继续投影同一结果，绝不重新生成。 |
| APR-13 | 普通用户 UI 只显示提交中、平台处理中、系统自动恢复、结果保存中、已完成或项目内明确失败；禁止“请人工核对/去中转站/核对太频繁”。 |
| APR-14 | 明确未扣费或已退款时才允许安全重试；outcome unknown 永远禁止产生新付费 attempt。 |
| APR-15 | 当前所有已发布模型先冻结生产身份、模式、参数、默认值、connector、Revision、模板/Canvas引用和任务恢复基线；任何无计划漂移阻止发布。 |
| APR-16 | 统一任务生命周期但不统一 Provider 协议；GPT Image、Ark、Mureka、GK 和其他专用 connector 保持自己的合同，未受影响路径不得被强制迁移。 |
| APR-17 | 旧任务始终按自身冻结 Revision/connector/profile/credential/taskId 继续；schema 与发布回滚必须能继续处理在途任务，不得因回滚重复提交。 |
| APR-18 | 完成的唯一产品证据是结果在生产项目内可打开且刷新仍在；Fake、HTTP 202、Provider boundary 或 taskId 本身都不是完成。 |

## 5. 目标状态机

```text
LOCAL_ADMITTED
  -> SUBMITTING
     -> ACCEPTED(providerTaskId durable)
        -> POLLING
           -> RESULT_STAGING
              -> ASSET_COMMITTED
                 -> PROJECTION_PENDING
                    -> COMPLETED
     -> RECONCILING(no durable task id, zero new POST)
        -> ACCEPTED -> POLLING -> ... -> COMPLETED
        -> PROVIDER_FAILED / REFUNDED
        -> OPERATOR_INCIDENT
```

约束：`OPERATOR_INCIDENT` 只进入系统管理员事故队列；它不能向普通用户暴露“去平台找结果”。`PROVIDER_FAILED/REFUNDED` 必须在项目内给出明确、非误导状态。`COMPLETED` 必须绑定正式资产；Canvas 投影待处理不影响 Provider/资产成功事实。

## 6. 全模型兼容策略

1. R0 从生产只读冻结全部已发布模型和引用矩阵，不使用手写合成清单替代真实快照。
2. 新持久生命周期做共享层；创建、状态、结果和错误解析仍由 connector-owning adapter 负责。
3. 第一阶段只灰度 `grok-video-3`；其他模型保持旧路径，不批量切换。
4. 每个模型切换前做旧/新 shadow compare，必须证明请求体、输入角色、参数、费用估算和结果语义一致或有显式版本迁移。
5. 所有未修改模型运行生产配置快照、真实脱敏响应回放和 Fake 端到端；每个实际修改的 connector family 至少一次受控真实生成。
6. 旧任务恢复、旧 Canvas、旧模板和不可变 Revision 纳入回归门；不允许以“新任务正常”替代历史兼容证据。
7. rollback 必须采用 expand/contract 兼容迁移或兼容 Worker；旧 runtime 不能识别新状态时禁止直接回滚到旧二进制。

## 7. 实施顺序

### R0：只读基线与预期红

- 建立实施时最新干净隔离 worktree；冻结 Git、package/schema、生产版本、全模型/模板/Canvas/任务基线。
- 固化本次 task/attempt/provider-boundary/outcome-unknown 证据，不读取密钥或受保护 JSON。
- 新增预期红证明：声明式响应多字段被拒、合同路径绕过自动恢复、用户 reconcile 依赖、重启后 recovery 不继续、结果成功与 Canvas 投影耦合。

### R1：有限响应合同与脱敏证据

- 为 connector 增加版本化 create/status/result/error schema 和有限 task ID 路径。
- 增加脱敏响应结构证据和 Provider request/correlation identity。
- 保持 SSRF、Header、credential、大小、重定向和商业 Provider 隔离由代码拥有。

### R2：持久提交与恢复状态机

- 在数据库中原子管理 submitting/accepted/reconciling/polling/result-staging 状态、lease、nextAttemptAt 和终态。
- 所有 retry 区分“查询/轮询同一任务”与“新付费提交”；只有前者可在 unknown 状态自动执行。
- crash recovery 扫描非终态任务并接管，不依赖页面。

### R3：结果资产与 Canvas 投影解耦

- Provider 成功先走 result asset 提交；下载/媒体/OSS按现有 owner、ready、checksum 和 publication 规则。
- 结果资产成功后建立持久 projection job；复用既有 generation-owned 字段白名单和事务 CAS。
- 任务中心、素材库和 Canvas 至少一个稳定入口始终可找到结果。

### R4：用户体验收口

- 普通用户移除人工 reconcile 主流程和频率错误。
- 保留管理员诊断页、自动恢复年龄、候选匹配和无密钥证据。
- 未决付费任务禁用新生成；明确失败/退款按项目内语义处理。

### R5：全模型非回归与故障注入

- 所有已发布模型执行身份/合同/模板/Canvas/历史任务矩阵。
- 覆盖额外字段、嵌套ID、HTTP 202、断线、保存前崩溃、轮询重启、双击、未知状态、结果延迟、下载失败、Canvas冲突、零/一/多账本匹配。
- 每个用例断言 Provider POST、paid attempt、taskId、结果资产、投影和用户文案。

### R6：候选冻结与独立终审

- 只在直接影响范围定向测试通过后，按共享合同传播风险决定是否运行一次正式 safe full。
- 候选冻结后独立只读终审；P0/P1 必须为 0。不得用 Review 代替真实 Provider 门。

### R7：受控真实 GK 验收

- 本次Goal已明确授权一次受控首帧视频；真实费用总上限USD 20，第一次提交预估不超过USD 10，任何unknown都禁止第二次Provider POST。
- 同一次任务覆盖创建、任务号、后台轮询、结果资产、Canvas回填和刷新保持；如需验证重启恢复，只能恢复同一已受理任务，不能新增付费提交。
- 真实视频没有出现在项目内则门失败，不得发布。

### R8：发布与用户验收

- 本次Goal已明确授权v0.6.55、GitHub和生产发布；仍须依次通过Review、唯一full、PR/main CI、不可变tag/Release、冻结备份、恢复演练、原子切换和回滚门。
- 灰度只从受影响 connector 开始；监控 accepted-without-task-id、reconciling-age、success-without-asset、projection-pending 和 duplicate-attempt。
- 用户在生产项目内看到并播放结果后才可记 `USER_PASS`。

## 8. 风险驱动验证规则

- 所有模型：生产脱敏快照、黄金请求/响应回放、Fake Provider 端到端。
- 所有共享任务状态改动：数据库事务、并发、重启、重复点击、费用幂等和结果提交测试。
- 所有受影响 connector：专属请求/响应/错误/结果回归。
- 实际修改的 connector family：至少一次受控真实生成；未修改 connector 不做无意义付费重复测试。
- 一个正式 full 只在候选冻结和独立 Review 后运行一次；失败先跑最小受影响集。
- 文档-only 变更不运行业务 full，不得把定向或文档校验称为完整回归。

## 9. 发布硬门

以下任一项失败即 `NO-GO`：

1. 单次用户操作不是精确一个 Provider POST；
2. 普通用户仍需点击核对或访问中转站；
3. Provider 成功结果没有正式 `result_asset_id`；
4. 刷新、关页或服务重启后任务不能继续；
5. Canvas 冲突会丢失结果或触发重新生成；
6. outcome unknown 能产生新 paid attempt；
7. 当前已发布模型、旧任务、旧 Canvas、模板或 Revision 出现未计划回归；
8. 实际修改 connector 没有真实端到端证据；
9. GK 首帧真实视频未自动回到生产画布并在刷新后保留；
10. 独立终审仍有 P0/P1；
11. 版本号或发布授权缺失；
12. 文档、Checkpoint、TASKS、CURRENT_STATE 和验收矩阵不一致。

## 10. 普通用户手工验收

路径：打开生产画布，选择一个已有图片输入和视频节点，确认模型为 `grok-video-3`，只点击一次生成。

预期：页面自动经历处理中并最终在同一节点显示可播放视频；刷新页面后结果仍在，任务中心和素材库可找到同一结果。用户不点击“核对结果”，不输入平台任务号，不打开中转站。

失败条件：要求用户外部核对、重复点击、结果只存在 Provider、刷新丢失、出现第二次付费 attempt、其他既有模型或旧画布不可用。

费用说明：本次Goal已授权上述受控预算，禁止自动重提；在真实验收开始前Provider请求、OSS写和费用仍为0。

## 11. 完成定义

代码完成、自动测试、独立 Review、真实 Provider、生产技术通过和用户验收必须分开记录。只有同时满足“全模型非回归 + 一次真实 GK 首帧结果自动回到生产项目 + 用户明确确认”，INC-GEN-016 才能关闭为 `USER_PASS`。

## 12. 2026-08-28 生产最终结果

- v0.6.55已完成GitHub、不可移动Release、生产备份/恢复/回滚和技术稳定门，代码与生产技术部分通过。
- 真实GK验收中，历史attempt2经Provider完整账本证明未受理且未扣费；唯一替代attempt3随后被Provider明确全额退款，成功数0、退款数1，没有结果作品、`result_asset_id`或Canvas视频。
- 产品已在项目内准确显示退款且未再次提交，APR-020通过；但发布硬门9及APR-021～023的成功条件失败。费用实际为0，版本、发布和真实提交授权全部消费完毕。
- 本Goal停在`PRODUCTION_TECHNICAL_PASS / REAL_PROVIDER_REFUNDED / NO_RESULT / USER_RECHECK`。禁止再次Provider POST；不得把终态退款证据写成`REAL_PROVIDER_PASS`，也不得关闭为`USER_PASS`。

## 13. v0.6.56 续作范围

- R0重新冻结最新main、生产v0.6.55、全模型和目标退款task；新增预算尚未消费。
- 运行时只为声明式GK创建响应增加两个已证实的有限候选路径：`data.task_ids[]`与`data.任务ids[]`。数值安全转字符串；两个路径同时出现时必须各自恰好一个值且完全一致；零值、多值、冲突值、非安全整数和危险字符串继续进入可恢复FORMAT且禁止重提。
- canonical顶层`task_id`、轮询、结果资产、Canvas投影、unknown费用围栏及所有未修改connector行为保持不变。
- 候选必须先定向绿、独立Review P0=0/P1=0、GitHub/CI、不可移动v0.6.56、冻结备份/恢复/回滚和生产技术门，再允许消费新增USD20。真实结果必须自动形成正式资产并回到原节点，刷新后仍在；否则不得写`REAL_PROVIDER_PASS`。

## 14. v0.6.56 最终收口

- Review最终`P0=0/P1=0/GO`；PR #124、PR/main CI、不可移动tag/Release、fresh build、冻结备份、restore-copy standby、原子切换、回滚/前滚、公网/静态资源和稳定门均通过。
- 唯一正式safe full为`1084/1090`、3失败、3跳过；源码不变的失败最小集`13/13 PASS`，没有第二次full。该证据按原始结果如实记录，不冒充1090/1090 clean full。
- 真实attempt4只有一个Provider POST，数字task ID `118533110`成功持久化；任务自动轮询完成，正式OSS资产发布并幂等投影回原节点。浏览器刷新后视频仍可播放，没有中转站、任务号输入或人工核对步骤。
- 实际费用USD10，不超过新增USD20总上限；当前无活动或unknown付费任务，禁止再提交本Goal的Provider POST。
- 技术和真实链状态为`PRODUCTION_TECHNICAL_PASS / REAL_PROVIDER_PASS`；成片主观质量保持`USER_RECHECK`，只有用户观看生产画布并明确确认后才能写`USER_PASS`。
