# INC-GEN-019 整组执行保存竞态与原子准入最终审计方案

状态：`FINAL_PLAN_FROZEN / R7_FORMAL_FULL_RECORDED_WITH_TARGETED_CLOSURE / R8_VERSION_V0_6_65_SELECTED / PRODUCTION_GROUP_EXECUTION_USER_FAIL / ZERO_NEW_TASK_ATTEMPT_PROVIDER_POST`

日期：2026-08-31

适用实现仓库：`/Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28`

当前生产基线：`v0.6.64 / schema41`

## 1. 结论先行

INC-GEN-018 修复的“模型合同健康边界与旧 Revision”已经生效：本次真实点击前的两次模型/输入预检均返回 HTTP 200，没有再出现伪 `GLOBAL_GENERATION_DISABLED`。但真实整组执行仍在第一个正式任务准入处失败，服务端返回 `409 CANVAS_NOT_SAVED`；整组首节点失败后，另外 10 个下游节点按依赖规则未运行。

因此当前状态必须拆开表达：

- `INC_GEN_018_MODEL_CONTRACT_PASS`：模型合同问题不再是本次失败原因。
- `INC_GEN_019_GROUP_EXECUTION_USER_FAIL`：真实整组执行用户路径尚未通过。
- `ZERO_NEW_TASK_ATTEMPT_PROVIDER_POST`：失败点击没有创建 task、admission 或 Provider attempt，没有产生新费用。
- v0.6.64 的发布、迁移、CI 和零付费预检证据仍是历史技术事实，但不得再把它们表述为“真实整组执行已验收”。

本事件不是“把 409 去掉”或“多重试几次”。服务器拒绝旧画布版本是正确安全围栏。正确修复是：让客户端在一个有界准入状态机内反复取得一致快照、重算完整语义身份、执行零 Provider 预检，并以服务端事务中的最终 revision fence 作为唯一原子提交判定；同时查清并消除本次点击期间 34 次 Canvas PUT 的真实写入来源。

本文件已经吸收首轮方案审计的 5 项 P1 与 3 项 P2。最终方案审计结论仅代表“方案可进入新的实施 Goal”，不代表代码候选、测试、发布或生产通过。

实施进展（2026-08-31 20:51 +08:00）：R1～R7 已完成。旧代码红测与 34/34 PUT 归因已闭合；候选实现补齐 shared monotonic deadline、preflight revision 校验、preflight network/5xx 同 key 重试、确定性 revision 409 exact lookup 后收敛及 formal unknown 原 key reconcile。最终候选为10/10产品+测试文件、62/62 hunks、产品净新增199/450，binary diff=`9925eda3…d16ed`。唯一 formal full 原始`1133/1135`与2失败永久保留；m22+m36+m38最小关闭`62/62`，未运行第二次full。主线程与唯一 independent Review 线程完成初始及formal后增量终审，覆盖10/10 published models、11个exact identities及全部Provider分支，最终`P0=0/P1=0/P2=0/GO`。当前严格进入R8版本身份只读门；GitHub、发布、生产与真实 Provider 均未执行。

## 2. 本次生产失败的冻结证据

### 2.1 用户可见事实

- 用户在生产网站点击“整组执行”后，页面提示：`整组执行部分失败：画布还在保存，请稍等保存完成后再试；另有 10 个后续节点因上游失败未运行`。
- 截图文件时间为 2026-08-31 17:10:33（Asia/Shanghai）。
- 目标 Canvas：`3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`。

### 2.2 生产日志时序

按同一登录会话、Canvas 和请求时间关联：

1. 17:10:05：第一次零 Provider preflight 返回 HTTP 200，耗时约 4.149 秒。
2. 17:10:10：第一次正式 `POST /api/generation-tasks` 返回 HTTP 409，耗时约 5.003 秒。
3. 17:10:14：第二次零 Provider preflight 返回 HTTP 200，耗时约 4.166 秒。
4. 17:10:17：第二次正式任务 POST 再次返回 HTTP 409，耗时约 2.486 秒。
5. 17:09:50～17:10:25：同一 Canvas 共出现 34 次成功 PUT；保存活动在约 17:10:19 后停止。

两次“200 预检 → 409 正式准入”的形状证明：模型/输入可用性预检已经通过，但预检和正式 POST 之间 Canvas 的持久 revision 继续变化；既有“一次保存后重试一次”没有覆盖持续漂移。

### 2.3 只读数据库与服务证据

失败后只读核对：

- 全局 tasks=`1026`、Provider attempts=`1037`、admissions=`946`、active=`0`。
- 从本次点击前的基线时间起，new tasks=`0`、new Provider attempts=`0`、new admissions=`0`。
- 目标 Canvas 最终 revision=`95`、graphRevision=`62`、saveSequence=`66`、nodes=`53`、edges=`98`，updatedAt=`2026-08-31T09:10:19.867Z`。
- 生产服务保持 active，MainPID=`2859331`、NRestarts=`0`，运行 v0.6.64/schema41。

结论：本轮没有跨过任务准入和 Provider 付费边界；409 是安全拒绝，不是已扣费但结果丢失。

### 2.4 证据边界

- 上述 34 次 PUT 已证实“发生”，尚未逐次证明由哪个本地 writer/reason 触发。不得在没有因果证据前直接把它们统称为 hydration、reconciliation 或 React effect 风暴。
- 现有日志可以证明请求时序和零新增 task/attempt/admission，不能单独证明浏览器内每次 state mutation 的来源。
- 本计划只冻结原因链和修复门，不把尚待 R1 复现与插桩证明的保存 writer 当成既定根因。

## 3. 当前代码调用链与缺口

### 3.1 已确认调用链

```text
WorkflowExecutionProvider
  -> workflowNodeExecutors.run
  -> context.save.waitForRevision() 取得 revision R1
  -> ensureGenerationTask(...canvasRevision=R1)
       -> 持久化 submission intent / idempotencyKey
       -> POST /api/generation-tasks/preflight
       -> 预检返回时 Canvas 可能已成为 R2/R3
       -> assertCurrentInput() 只复核语义输入，不复核服务端 revision
       -> POST /api/generation-tasks 仍携带 R1
  -> generationTasksApi 严格校验持久 revision
  -> taskStore.admitOrGet(expectedCanvasRevision=R1) 在事务内再次围栏
  -> 409 CANVAS_NOT_SAVED，task/admission/Provider attempt 均未创建
  -> runGroupNodeWithPersist 保存后只重跑一次
  -> 若 revision 继续移动，第二次 409 被当成节点终态失败
  -> WorkflowExecutionProvider 将 10 个下游节点标为因上游失败未运行
```

当前关键位置：

- `client/src/generation/workflowNodeExecutors.ts`：在进入 `ensureGenerationTask` 前取得 `canvasRevision`。
- `client/src/generation/generationTasks.ts`：先执行较慢 preflight，随后复用原 prepared body 正式 POST。
- `client/src/generation/groupRunPersist.ts`：只对“画布还在保存”固定重跑一次。
- `server/generationTasksApi.ts`：正式准入前和 `admitOrGet` 事务内保留 exact revision fence。
- `tests/m22-group-execution.spec.ts`：现有测试只模拟“第一次失败、保存一次、第二次成功”，没有模拟 preflight/POST 期间持续版本漂移。

### 3.2 首轮方案审计发现及最终关闭方式

| 首轮发现 | 等级 | 最终方案中的关闭方式 |
| --- | --- | --- |
| 客户端 `R2 == R1` 检查不能提供原子性 | P1 | 客户端只负责有界重取一致快照；服务端 `admitOrGet` 事务 revision fence 保持最终原子权威。 |
| idempotencyKey 生命周期未定义 | P1 | 第 6 节给出按 preflight、确定性 409、语义变化、unknown outcome、task exists 分支的完整状态表。 |
| 未查明 34 次 PUT 就计划全局 batching | P1 | R1 先插桩冻结 writer/reason/fingerprint；R3 只合并同一因果 epoch 的冗余写，DATA-005 不变。 |
| “整组只创建 1 个 task”验收分母错误 | P1 | 改为每个 logical executable node 每次 execution intent 至多一个 task/admission；并覆盖多个同层 root。 |
| 零付费 preflight 被再次当作真实整组验收 | P1 | 第 14 节拆成零付费技术门和需独立授权的真实 Provider 用户流；费用上限为 0 时不得宣称真实整组通过。 |
| 服务端 preflight 已返回 canvasRevision，客户端类型遗漏 | P2 | R2 直接补齐现有字段的客户端类型和校验，不重复发明第二个 revision 字段。 |
| 新增持久化 group status 可能扩大状态机 | P2 | 优先复用现有 preparing/running/skipped/failed 与 reasonCode；无证据不加持久化枚举。 |
| 多层 30 秒等待可能叠加 | P2 | 全部 admission 子步骤共用一个 monotonic deadline；阈值由 R0/R1 实测分位数冻结。 |

最终文档审计：`P0=0 / P1=0 / P2=0 / GO_FOR_NEW_IMPLEMENTATION_GOAL`。

## 4. 范围与非范围

### 4.1 本事件必须完成

1. 复现“持续 Canvas 保存 + 慢 preflight + 正式 POST revision 过期”的确定性红测。
2. 建立客户端有界准入状态机，并保留服务端事务最终围栏。
3. 明确 idempotency intent/key 在全部错误分支中的保留、关闭、替换和只读核对规则。
4. 查明 34 次 PUT 的精确 writer/reason，并只修真正的冗余保存来源。
5. 保持一个点击、自动等待与自动继续；普通用户不需要刷新、访问任务中转站或手工找结果。
6. 补齐单 root、多 root、下游、跨标签、用户编辑、unknown response、accepted recovery 和全部节点类型回归。
7. 候选冻结后逐文件、逐 hunk、逐关键分支、完整调用链和全部 published model/identity/Provider 分支审查。
8. 技术、零付费生产门、真实 Provider 流和用户主观验收分别记账，不互相冒充。

### 4.2 明确不在本事件内

- 不重做 INC-GEN-018 的 canonical model contract、Seed/TTS revision 迁移或 availability 分类。
- 不移除或放宽 Canvas revision fence。
- 不改变 DATA-005“跨标签最后保存者胜；同标签迟到旧请求拒绝”。
- 不改变模板、节点语义、Prompt、模型默认值、Provider adapter、价格、结果数量或媒体角色。
- 不清理历史 task、attempt、release、rollback、backup、staging 或用户数据。
- 不顺带治理 9 个历史图片任务轮询 churn 或根盘 99% 容量问题。
- 不在没有新 `/goal` 的情况下实施代码、运行正式 full、commit、push、PR、tag、Release、迁移或生产发布。
- 不在没有独立明确费用授权的情况下发起真实 Provider POST、真实 OSS 写或新增费用。

## 5. 不可破坏的安全与产品合同

### GA19-01 服务端最终围栏不可删除

客户端任何“看起来稳定”的检查都可能在网络往返期间失效。正式准入必须继续在服务端事务中比较 exact persisted canvas revision；不匹配时在 task/admission/Provider attempt 创建前返回确定性 `CANVAS_NOT_SAVED`。

### GA19-02 一个逻辑节点一个执行意图

整组不是一个 task。每个 logical executable node 对一个 frozen semantic execution intent 至多产生：

- 一个 idempotencyKey；
- 一个 generation task；
- 一个 admission；
- 对应 adapter 允许的 Provider attempt。

同层有 N 个可执行 root 时，成功分母是 N 个各自精确的 task/admission，不是整个 group 恰好 1 个 task。

### GA19-03 unknown outcome 永不重发

若正式 POST 的网络/5xx 结果不确定，保留原 intent 和原 idempotencyKey，只按 exact key/完整 generation identity 查询、恢复或进入 `OUTCOME_UNKNOWN_BILLING_RISK`；绝不通过换 key 或再次 POST 猜测。

### GA19-04 revision 漂移不等于语义漂移

- 仅 Canvas revision 变化而当前节点完整语义身份不变：允许使用同一 intent/key 在统一 deadline 内重新预检和准入。
- generation input、ownership、model contract/configuration/release revision、workflow run/group binding 任一变化：停止当前节点意图。只有确认旧 key 在服务端不存在且没有 unknown outcome 后，下一次明确执行才能建立新 intent；不得在同一点击中静默改为生成新内容。

### GA19-05 accepted task 优先于 Canvas 投影

一旦服务器已存在 exact accepted task，必须恢复该原任务并持久化 accepted binding；Canvas 写回失败不能把 Provider 成功降级为生成失败，也不能导致再次付费。

### GA19-06 保存优化不得改变 DATA-005

只允许抑制同一标签、同一 hydration/reconciliation epoch、相同序列化 graph fingerprint 的冗余写。用户编辑、跨标签新写、task binding、result projection、group checkpoint、显式模型迁移和 pagehide durability 不得被吞掉或重排。

### GA19-07 一次点击自动完成正常路径

正常无并发编辑情况下，用户点击一次后系统必须自动完成“等待保存稳定 → 预检 → 准入 → 接收任务绑定 → 下游继续”。不得把刷新页面、再次点击、手工清错误或打开任务面板设为成功前置条件。

## 6. Idempotency intent/key 完整生命周期

| 阶段/结果 | 是否可能已跨正式准入 | key 处理 | 后续动作 |
| --- | --- | --- | --- |
| intent 写入后、preflight 业务拒绝 | 否 | 保留同一 key；若显式关闭 intent，须先 exact lookup 为空 | 展示具体输入/模型错误，不自动正式 POST |
| preflight 网络/5xx | 否 | 保留同一 key | 统一 deadline 内可重做 preflight，不触发正式 POST |
| preflight 200，但本地 revision/语义在 POST 前变化 | 否 | 语义相同保留 key；语义变化停止 | 同 revision 漂移进入下一轮；语义变化不静默续跑 |
| 正式 POST 明确返回 `409 CANVAS_NOT_SAVED` | 服务端合同保证未创建 | 保留原 key | exact lookup 为空且语义相同后，统一 deadline 内重新取 revision/preflight/POST |
| 正式 POST 其他确定性 4xx | 按错误合同判定；默认不得猜测 | 先 exact lookup；只有明确未创建且错误允许关闭时才关闭 | 不对非 revision 错误自动重发 |
| 正式 POST 网络断开、超时或 5xx | 可能 | 永久保留原 key，禁止换 key | 只读 reconcile 原 key；找不到且无法证明未受理则 `OUTCOME_UNKNOWN_BILLING_RISK` |
| exact task 已存在 | 是 | 绑定原 key/task | 返回 recovered task，写 accepted binding，继续轮询/投影 |
| 语义身份变化 | 旧意图可能未知 | 先核对旧 key | 旧 key 明确为空且无 unknown 才允许后续明确执行创建新 key |
| cancelled task 已存在 | 已有服务器事实 | 不复用为新付费意图 | 展示取消；新内容只在新明确执行中建立新 intent |

运行时代码不能依赖“全局 task 总数没变”来决定是否重发；全局计数只用于测试和生产验收。产品路径必须依赖 exact account/canvas/fixture/node/kind/idempotencyKey、完整 generation identity 和 workflow binding。

## 7. 最终准入算法

每个节点只建立一个 monotonic `admissionDeadline`。保存、quiet window、preflight、本地确认、正式 POST 和确定性 revision 重试共用这一截止时间，不允许每层重新获得 30 秒。

```text
创建 runId / group lease / run locks
为当前 node 冻结 original semantic intent 和一个 idempotencyKey

while monotonicNow < admissionDeadline:
  1. 在 Canvas admission 临界区确认 lease、run、node ownership 仍有效
  2. flush 当前待保存内容
  3. 等待 dirty=false、saving=false、revision 已确认
  4. 重算完整 generation identity 与 workflow binding
     - 若相对 original semantic intent 已变化：安全停止，不静默换输入
  5. 使用同一 key 和当前 revision 执行零 Provider preflight
  6. 读取 preflight 响应中现有 canvasRevision 字段
     - 客户端类型必须声明并校验它
  7. 再确认本地持久 revision、完整语义身份、lease 和 deadline
     - 不一致：回到循环，不正式 POST
  8. 正式 POST 携带同一 key、完整 identity、workflow binding、expected revision
  9. 服务端在 transaction / admitOrGet 中做最终 exact revision fence
     - created/existing：持久化 accepted task binding，退出 admission 锁
     - 明确 CANVAS_NOT_SAVED：exact key lookup 为空且语义未变，回到循环
     - network/5xx unknown：只 reconcile 原 key，绝不再 POST
     - 其他错误：按稳定 reasonCode fail-closed

deadline 到期：
  - 再做一次 exact key lookup
  - 存在 task：恢复并持久化 accepted binding
  - 明确不存在且从未出现 unknown：失败为 SAVE_STABILITY_TIMEOUT，task/attempt/provider=0
  - outcome 不明：OUTCOME_UNKNOWN_BILLING_RISK，禁止重发
```

### 7.1 原子性的准确表述

客户端的“preflight revision 与当前 revision 相同”只能减少冲突，不能提供原子保证。唯一原子保证是服务端 `BEGIN IMMEDIATE`/等价事务中的 `expectedCanvasRevision` 检查与 `admitOrGet` 提交。计划验收不得写成“客户端 R2==R1 所以不会 409”；正确目标是“正常稳定路径不发生 409，竞态路径由 409 安全吸收并在同一 intent 下有界收敛”。

### 7.2 deadline 冻结规则

R0/R1 必须分别测量：Canvas flush/confirm、preflight、正式 admission 的 p50/p95/p99。最终 deadline 由当前生产代际的实测分位数和安全余量冻结，并在测试中使用 fake monotonic clock；不得直接散落多个 magic `30_000`。若实测不能支持一个合理的用户等待上限，先修慢路径或保存风暴，不能靠无限延长等待掩盖。

## 8. 34 次 Canvas PUT 的因果审计与最小修复

### 8.1 先证明 writer，再决定优化

R1 在隔离测试环境增加只记录元数据的 save diagnostics：

- `canvasId` 使用测试 fixture 标识，不记录真实 owner、Prompt、媒体 URL 或 graph 正文；
- mutation reasonCode；
- hydration/reconciliation epoch；
- before/after graph fingerprint；
- dirty/saving 状态；
- local saveSequence、confirmedSequence、server revision；
- caller family 和 monotonic timestamp；
- 是否同 fingerprint、是否实际发出 PUT、是否被 facade 合并。

必须把生产形状的 34 PUT 分解为可核对分母，例如 `hydration=N / reconciliation=N / workflow-preparation=N / task-binding=N / user-edit=N / other=N`。任何 `other` 未归因时，R3 不得宣称保存风暴已修复。

### 8.2 允许的优化

- 同一 hydration epoch 内，相同 graph fingerprint 的重复 setter/save 合并为零或一次最终 PUT。
- reconciliation 得出 no-op patch 时不标 dirty、不提升 graph revision。
- 同一事件循环/同一事务内成对 nodes+edges 变化走既有原子 graph mutation，而不是两次独立保存。
- group preparation 中纯 UI/transient 状态不得污染持久 graph；确需持久化的 workflow binding/checkpoint 保持明确原因码。
- 复用 `canvasPersistenceFacade` 的 fingerprint、sequence 和 pagehide 规则，不建立第二套保存队列。

### 8.3 禁止的优化

- 全局加大 debounce、暂停所有保存或在整组执行期间锁死用户数据持久化。
- 把所有 34 PUT 粗暴批成一次，吞掉 task binding、结果投影、checkpoint 或 pagehide durability。
- 改成跨标签全局 CAS，破坏 DATA-005。
- 只在 UI 隐藏“保存中”而不改变真实 dirty/revision 行为。
- 因测试难写而删除 revision 检查、固定 sleep 或无限重试。

## 9. 用户体验与恢复语义

优先复用现有 group/node 状态和 reasonCode，不新增第二套持久状态机：

- `preparing`：`正在等待画布保存稳定，尚未创建生成任务`。
- 内部 revision 漂移重试：不连续弹红色 toast；进度保持 preparing。
- `SAVE_STABILITY_TIMEOUT`：`画布持续变化，本次没有创建生成任务。请停止编辑后再试。`
- `GENERATION_INPUT_CHANGED`：`生成内容已在提交前变化，本轮已安全停止且未创建任务。`
- `OUTCOME_UNKNOWN_BILLING_RISK`：`提交状态正在安全核对，系统不会重复提交或重复收费。`
- task 已 accepted 但 Canvas binding/projection 待写：显示任务继续运行/结果待回填，不得显示“生成失败”。
- 下游计数必须区分“因上游业务失败未运行”和“因准入仍在核对暂未运行”；unknown outcome 不得伪装成普通失败后允许一键重发。

run lease、run locks、checkpoint、pending notification 和 preparing 状态在 success、明确失败、取消、deadline、navigation、unmount、lease loss 与 exception 所有出口都必须成对释放/持久化；测试覆盖每个出口。

## 10. 分阶段实施顺序

### R0：权威状态纠正与只读基线冻结

1. 在新的 `/goal` 激活后，先把 AGENTS、CURRENT_STATE、Checkpoint、Matrix、TASKS 的当前状态改为：`INC_GEN_018_MODEL_CONTRACT_PASS / INC_GEN_019_GROUP_EXECUTION_USER_FAIL / ZERO_NEW_TASK_ATTEMPT_PROVIDER_POST / IMPLEMENTATION_IN_PROGRESS`。
2. 核对目标 checkout、branch、HEAD、origin/main、package、Node/npm、生产 v0.6.64/schema41 与已消费授权。
3. 冻结本次 200→409→200→409 请求时序、34 PUT、Canvas 最终 revision/graphRevision/saveSequence 和零新增 task/attempt/admission 证据。
4. 冻结 published logical models、exact execution identities 和 Provider/protocol/adapter 分母，确保后续 Review 有完整 denominator。
5. 测量 save/preflight/admission 时延分位数，确定一个共享 monotonic deadline 规则。

停止：仓库/生产身份不一致、存在 active/unknown billing、需要访问受保护文件/secret、零新增计数证据无法确认或真实 Provider 边界状态不明。

### R1：确定性红测与保存 writer 因果证明

在安全 runner 的新临时数据和动态 loopback 环境中构造：

- 53 nodes / 98 edges；
- 至少 11 个 executable nodes，包含至少 2 个同层 root；
- preflight 延迟约 4 秒，可用 fake clock/controlled barrier；
- preflight 与正式 POST 之间连续产生 revision 漂移；
- 首轮精确复现 `preflight 200 -> formal 409 -> preflight 200 -> formal 409`；
- 旧实现最终首节点 failed、10 个 downstream 未运行；
- task/admission/provider attempt 全部 0。

同时用 save diagnostics 把每次 PUT 归因。R1 的目标是稳定红测和原因分母，不是立即修代码；无法稳定复现或存在未归因 writer 时不得进入 R2/R3。

### R2：客户端有界准入状态机与服务端原子围栏

- 在现有 `ensureGenerationTask`、Canvas admission 和 workflow executor 链内实现，不新建旁路提交器。
- 补齐 `GenerationPreflightResult.canvasRevision` 客户端类型及运行时校验，直接消费服务端已经返回的字段。
- 把 revision/semantic/lease 确认放在同一 monotonic deadline 内。
- 保留服务端正式 strict preflight、`assertPersistedCanvasRevision` 和 `admitOrGet(expectedCanvasRevision)` 最终事务围栏。
- `CANVAS_NOT_SAVED` 只在 exact lookup 为空、语义未变、deadline 未到时自动重新进入循环。
- 网络/5xx unknown 只 reconcile 原 key，不进入 revision 重试分支。

### R3：idempotency 生命周期与保存风暴根因修复

- 按第 6 节逐分支实现和测试 intent/key 生命周期。
- 只修 R1 已证明的 save writer；每项优化必须附 before/after reason 分布、PUT 数量和 graph fingerprint 证据。
- 保持 user edit、task binding、result projection、checkpoint、pagehide、跨标签 last-writer 合同。
- 正常无编辑执行时，preflight 与正式 POST 之间不应被内部 no-op 保存持续打断。

### R4：组执行状态、通知与所有退出分支

- 复用现有状态和稳定 reasonCode。
- revision 内部收敛不刷红 toast；deadline、semantic change、unknown outcome 给出不同文案。
- accepted task、projection pending、上游失败、准入核对中和 downstream skipped 分开表达。
- 证明 lease/locks/checkpoint/notifications 在全部出口无泄漏、无重复、刷新可恢复。

### R5：最小直接测试与风险驱动回归

先运行变更直接相关的 safe specs；失败时只重跑失败项或最小依赖集合。至少覆盖第 11 节全部验收项。只有共享 Canvas/generation contract 的传播证据要求扩展到相关 domain tests。

### R6：冻结候选后的完整逐代码 Review

冻结 exact HEAD、tree、tracked diff hash、candidate manifest 和测试证据后，主审与独立审查逐一覆盖：

- 所有改动文件与每个 diff hunk；
- 所有新增/修改类型、状态和 reasonCode；
- group click → graph scheduler → executor → save gate → preflight → formal admission → task binding → polling → projection → downstream 的完整调用链；
- single-node、group-run、retry、task panel、startup recovery、accepted-only recovery、cancel 和 unknown-outcome 入口；
- 全部 published logical models、全部 exact execution identities、Provider driver/protocol/adapter 分支；
- text/image/video/audio、单 root、多 root、下游、跨标签、navigation/unmount/pagehide；
- DATA-005、费用、idempotency、ownership、revision、model contract 和受保护文件边界。

报告必须列出 coverage numerator/denominator、未覆盖项及 `P0/P1/P2`。`P0>0` 或 `P1>0` 一律 NO-GO。

### R7：唯一正式 safe full 与候选冻结

只在 R6 `P0=0/P1=0/GO` 后运行本事件唯一正式 safe full。遵守：

```sh
node scripts/run-safe-tests.mjs full
```

- 使用 fresh temp data、动态 loopback，禁止 4173、生产路径、真实 Provider/OSS。
- full 若失败，保留原始结果；修直接根因后只跑失败 spec/最小依赖集合，不为“全绿截图”重复 full。
- full 前后若有相关源码变化，必须重做相应 diff review；文档回执不重复业务 full。

R7 完成仍只是本地 release candidate，不自动授权 commit/push/PR/tag/Release 或生产。

### R8：GitHub、发布与分层生产验收

只有新的实施 Goal 明确授予版本、commit/push/PR/CI/tag/Release、数据库/生产、rollback/forward 权限后才可进入。必须按仓库上线规矩执行不可变 release、fresh build、冻结恢复、原子切换、成对 rollback/forward、服务/版本/schema/数据稳定门。

生产验收必须按第 14 节分层记账。零付费 preflight 只能关闭结构性技术门；没有单独的真实 Provider POST 与费用上限授权时，状态必须保持 `PRODUCTION_ZERO_PAID_TECHNICAL_PASS / REAL_GROUP_FLOW_NOT_RUN / USER_RECHECK`，不得再写“真实整组执行通过”。

## 11. 验收矩阵

### A. revision 与原子准入

- **IG19-001**：慢 preflight + 持续 revision 漂移可稳定复现旧代码 200→409→200→409。
- **IG19-002**：客户端成功 preflight 必须读取并校验服务端现有 `canvasRevision`。
- **IG19-003**：preflight 后本地 revision 变化时不发送使用旧 revision 的正式 POST。
- **IG19-004**：客户端最后确认后再发生竞态时，服务端事务返回 409 且 task/admission/provider=0。
- **IG19-005**：相同语义、确定性 409、exact lookup 为空时，同一 key 在 shared deadline 内自动收敛。
- **IG19-006**：deadline 到期且明确未创建时只失败一次，无死循环、无残留 lock、无 Provider POST。

### B. idempotency 与付费安全

- **IG19-007**：preflight 业务拒绝不正式 POST。
- **IG19-008**：preflight 网络/5xx 只重做 preflight，key 不变。
- **IG19-009**：正式 POST 网络断开/5xx 后只 reconcile 原 key，正式 POST 次数保持 1。
- **IG19-010**：POST 已提交但响应丢失时，exact task 被恢复，不创建第二 task/attempt。
- **IG19-011**：语义变化时旧 key 未查清前禁止新 key；查明旧 key 为空后也不在同一点击中静默换内容。
- **IG19-012**：IDEMPOTENCY_CONFLICT、cancelled、ambiguous/incomplete identity 全部分支 fail-closed。
- **IG19-013**：accepted task 的 Canvas binding 失败不会触发第二次 Provider POST。

### C. group graph 与计数

- **IG19-014**：一个 root 成功时恰好一个 logical task/admission。
- **IG19-015**：两个同层 root 成功时恰好两个各自独立 task/admission，生成可并行，准入安全串行/协调。
- **IG19-016**：11 executable nodes 的依赖图按每节点一个 execution intent 运行；成功计数不是“整组一个 task”。
- **IG19-017**：上游 accepted 后，下游只在所需结果投影/保存合同满足时启动。
- **IG19-018**：一个独立分支失败不会错误阻断无依赖兄弟分支。
- **IG19-019**：cancel、lease loss、navigation、unmount、exception、deadline 均清理 run locks/checkpoint/notification。

### D. Canvas 保存与 DATA-005

- **IG19-020**：R1 复现中的每个 PUT 都有已知 reason，`other=0`。
- **IG19-021**：同一 hydration/reconciliation epoch 的 no-op mutation 不提升 graph revision、不发 PUT。
- **IG19-022**：task binding、result projection、checkpoint 与 pagehide 保存不被优化吞掉。
- **IG19-023**：同标签迟到旧请求仍拒绝；跨标签最后保存者胜并同步。
- **IG19-024**：用户在准入期间修改当前节点语义时，本轮安全停止且不创建旧/新语义 task。
- **IG19-025**：用户修改无关 UI/非语义字段导致 revision 漂移时，同一语义 intent 可有界收敛。

### E. 全节点、模型与恢复回归

- **IG19-026**：text/image/video/audio 都经过同一安全准入合同。
- **IG19-027**：single-node、group-run、retry、task panel 不存在旁路旧 revision/key 的提交入口。
- **IG19-028**：全部当前 published logical models、exact identities、Provider/protocol/adapter 分支 denominator 100% 审查。
- **IG19-029**：模型合同 drift、global off、emergency stop、credential/provider/adapter 错误优先级保持 INC-GEN-018 合同。
- **IG19-030**：accepted-only refresh/startup recovery 只恢复原 task，不创建新 task。

### F. 用户体验与发布证据

- **IG19-031**：正常稳定 Canvas 一次点击自动进入 running，不要求刷新/二次点击。
- **IG19-032**：内部 revision 收敛不连续弹错误；timeout/input changed/unknown outcome 文案不同。
- **IG19-033**：技术测试、零付费生产门、真实 Provider flow、用户主观确认四种状态严格分层。
- **IG19-034**：唯一 formal full 原始结果与最小复验记录永久保留，不被重写。
- **IG19-035**：生产 release、DB、service、task/attempt/admission/provider/fee 前后计数和 rollback/forward 有完整回执。
- **IG19-036**：用户在真实目标路径明确确认前保持 `USER_RECHECK`。

## 12. 预计改动文件与调用链覆盖

最终以 R0/R1 实际 diff 为准。初始检查范围：

- `client/src/generation/generationTasks.ts`
- `client/src/generation/workflowNodeExecutors.ts`
- `client/src/generation/groupRunPersist.ts`
- `client/src/generation/WorkflowExecutionProvider.tsx`
- `client/src/generation/saveGate.ts`
- `client/src/generation/groupRunCheckpoint.ts`（现有 `runWithGroupRunCanvasAdmission` 所在位置）
- `client/src/canvas/canvasPorts.ts`
- `client/src/canvas/CanvasSurface.tsx`
- `client/src/canvas/canvasPersistenceFacade.ts`
- `server/generationTasksApi.ts`
- `server/generationTasks.ts`
- generation task store 的 `admitOrGet/expectedCanvasRevision` 实现
- `tests/m22-group-execution.spec.ts`
- Canvas persistence、generation API、idempotency、workflow recovery 的直接相关 specs

若插桩证明 34 PUT 来自上述范围外的 writer，必须把该调用链和测试加入候选 denominator；不得用本清单排除必要文件。

## 13. 测试策略与重复控制

1. 只使用仓库 `scripts/run-safe-tests.mjs`。
2. 首先跑 m22 中的确定性红测与新 admission state machine cases。
3. 保存 writer 修改后跑 Canvas persistence/DATA-005 最小直接 specs。
4. generationTasks/server store 修改后跑 idempotency、unknown outcome、accepted recovery、四节点类型最小直接 specs。
5. 只有共享合同传播证据存在时扩展 domain/core 回归。
6. 候选 Review GO 后最多一次正式 `full`；同一未变源码不重复。
7. 记录每条命令、Node/npm、source/snapshot、动态端口、fixture、pass/fail/skip/retry/block/reportErrors 和退出码。
8. 自动测试只能产生 `AUTO_PASS/TECHNICAL_PASS`，不能产生 `USER_PASS`。

所有测试禁止：固定 4173、`app/data`、`/var/lib/unboundry`、生产数据库、真实媒体、真实 Provider/OSS、真实 credential 或付费请求。

## 14. 生产验收分层与费用授权

### 14.1 零付费技术门

在 Provider POST、OSS 写、新费用上限均为 0 时，可以验证：

- 版本/schema/service/静态资源/数据完整性；
- `/api/models`、preflight、revision 响应字段和错误分类；
- 目标 Canvas 当前状态只读核对；
- task/attempt/admission/provider/fee 计数不变；
- 浏览器没有保存风暴或错误 toast 的静态/预检路径。

该层不能证明正式 group admission、Provider 接收、结果投影和完整下游都成功。

### 14.2 真实 Provider 整组流

若要宣称“网站真实整组执行修复通过”，必须在新 Goal 中单独冻结并授权：

- exact account/canvas/group/node allowlist；
- executable node 总数及每个节点的模型/adapter/预计费用；
- Provider POST 硬上限；
- task/admission/attempt 硬上限；
- 币种和新增费用硬上限；
- 是否允许真实 OSS result 写入；
- unknown outcome 停止与不得重发规则；
- 成功后 result 自动回填、刷新保持和下游完成的验收步骤。

验收分母必须等于被授权的 logical executable nodes。不得再写“整组只允许一个 task”，也不得用 preflight 200 替代正式任务流。

如果这些上限仍全部为 0，R8 只能收口为：

`PRODUCTION_ZERO_PAID_TECHNICAL_PASS / REAL_GROUP_FLOW_NOT_RUN / USER_RECHECK`

### 14.3 用户确认

只有用户在真实页面实际点击并明确确认一次点击完成、结果符合预期、刷新后保持，才能将 IG19-036 标为 `USER_PASS`。技术日志、测试、CI、健康接口和代理截图均不能代替。

## 15. 候选 Review 清单

冻结候选后必须逐项回答，不能抽样：

1. 每个改动 hunk 改变了什么合同，测试如何直接证明。
2. 客户端是否把“减少冲突”误写成“提供原子性”。
3. 服务端最终 revision fence 是否仍在 transaction/admitOrGet 中。
4. 每个 409/4xx/5xx/network 分支是否明确 task 可能性与 key 生命周期。
5. unknown outcome 是否存在任何换 key、自动重发或 Provider retry 旁路。
6. semantic fingerprint 与 canvas revision 是否被正确区分。
7. 多 root 是否按每节点计数，且真正 Provider 工作仍可并行。
8. save diagnostics 是否覆盖全部 PUT，是否记录了敏感数据。
9. 保存优化是否破坏 DATA-005、pagehide、task binding、projection 或 checkpoint。
10. single-node/retry/task panel/startup recovery 是否绕过新准入合同。
11. 全部 published models、exact identities、Provider/protocol/adapter 是否 100% 覆盖。
12. text/image/video/audio 的 identity、result count、ownership 和 release revision 是否保持。
13. 所有 success/failure/cancel/timeout/unknown/lease loss 出口是否释放资源。
14. 文案是否准确区分“未创建”“已接收”“状态未知”“结果待回填”。
15. 测试是否只使用 safe runner、动态 loopback 和临时数据。
16. 生产验收是否把零付费技术门与真实 Provider 流分开。

## 16. NO-GO 与硬停止条件

任一条件成立立即停止，不进入下一阶段：

1. 仓库、branch、HEAD、origin/main、package、生产 release/schema 身份不一致且无法解释。
2. 需要读取、stat、hash、复制、编辑、枚举、暂存或提交受保护 JSON。
3. 无法证明本次/测试没有 active 或 unknown-billing task。
4. 34 PUT 仍有未归因 writer，却准备做全局 debounce/batching。
5. 修复要求删除/放宽服务端 revision fence。
6. 任何入口可以在 unknown outcome 后换 key 或再次 Provider POST。
7. semantic identity 变化后仍在同一点击静默生成新内容。
8. DATA-005、pagehide、accepted-only recovery 或 result projection 合同回退。
9. 多 root/task/admission 验收分母不清楚。
10. 当前 published model、exact identity 或 Provider branch denominator 未完成全量 Review。
11. 候选 `P0>0` 或 `P1>0`。
12. 唯一 formal full 已消费却准备无新理由重复。
13. 没有新 Goal/版本/发布/生产授权却要执行 GitHub、tag、Release、迁移或发布。
14. 没有独立真实 Provider POST/OSS/费用授权却要做真实生成验收。
15. 生产结果/费用状态不明、备份/恢复/rollback/forward 无法证明或用户数据可能受损。

## 17. 回滚与 forward 原则

- 代码回滚不得回退 INC-GEN-018 已验证的模型合同健康边界和 exact revision 数据。
- 若仅客户端候选失败，回退到 v0.6.64 代码并保持 schema41/已迁移 Seed/TTS revisions 原样。
- 本事件原则上不需要 schema migration；若实施中发现必须迁移数据库，视为方案身份变化，立即 NO-GO 并重新审计。
- 生产切换必须使用新的不可变 release 和现有项目原子 current 机制；先证明 rollback，再最终 forward。
- rollback 后仍须核对 task/attempt/admission/provider/fee 和 Canvas 数据完整性，不能只看 `/ready`。
- unknown Provider outcome 期间禁止通过 rollback、刷新或重新点击触发新提交。

## 18. 文档治理与授权说明

本文件是最终审计方案，不是实施 Goal，也不是当前代码、测试、GitHub、版本、生产或真实 Provider 授权。后续若实施，必须由用户最新消息显式发送新的 `/goal` 或明确要求启动 Goal 模式，并在 Goal 中指定：

- 本文件为首要事件方案；
- 实际 checkout、baseline、目标版本规则；
- R0～R8 的 Checkpoint/Matrix/TASKS/CURRENT_STATE 回写要求；
- commit/push/PR/CI/tag/Release/生产/rollback/forward 权限；
- formal full 仅一次；
- 真实 Provider POST、OSS 和费用是否仍为 0，或 exact capped acceptance 授权。

在新的 Goal 激活前：

- `IMPLEMENTATION_NOT_STARTED`；
- 不修改产品代码和测试；
- 不运行 formal full；
- 不做 GitHub、版本、tag、Release、数据库或生产动作；
- 不发起任何真实 Provider POST、OSS 写或新增费用；
- 不把本方案 `GO` 表述为产品修复 `PASS`。

## 19. 最终完成定义

只有以下全部成立，INC-GEN-019 才能技术收口：

1. 本次 200→409 持续漂移红测在旧代码稳定失败、在候选稳定通过。
2. 34 PUT 全部归因且内部冗余 writer 已修，`other=0`。
3. 客户端有界状态机与服务端事务围栏共同通过全部 revision/semantic/unknown 分支。
4. 每 logical node 的 task/admission/idempotency 分母准确，多 root 与下游均通过。
5. DATA-005、accepted-only recovery、Canvas projection 和四节点/全模型/全 adapter 无回退。
6. 候选全量逐代码 Review 为 `P0=0/P1=0/GO`。
7. 唯一 formal full 与失败最小关闭按规则完成。
8. GitHub、不可变 release、fresh build、备份恢复、rollback/forward 和生产稳定门在新授权下完成。
9. 零付费技术门与真实 Provider 流状态被准确分层。
10. 若未获真实 Provider/费用授权，则终态只能是 `REAL_GROUP_FLOW_NOT_RUN / USER_RECHECK`；若获授权，必须按 exact cap 完成且无重复提交/未知费用。
11. 用户真实页面明确确认前，任何技术证据都不得写 `USER_PASS`。
