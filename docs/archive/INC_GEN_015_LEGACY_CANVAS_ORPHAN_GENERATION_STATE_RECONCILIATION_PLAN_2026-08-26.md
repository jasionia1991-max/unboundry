# INC-GEN-015：老画布孤立生成态与终态结果自动收口最终审计方案

状态：`FINAL_AUDITED_PLAN / DOCUMENTATION_ONLY / IMPLEMENTATION_NOT_STARTED / RELEASE_NOT_AUTHORIZED`

建立日期：2026-08-26

文档基线：当前隔离工作树 `a310ab156f463a0e21c43601c85b0dabef0f5236` 与 `origin/main@49197fb36924b4df11a8c39236275a4ceec8c553` tree 相同；package `0.6.44`，生产 `v0.6.44 / schema41`。

事件目标：修复历史画布中“持久化节点仍标记生成中，但服务端原任务已经终态”的孤立生成态。页面打开后应自动核对原任务、优先恢复可安全应用的原结果；无法安全应用时应停止假呼吸灯并保留历史结果，绝不自动新建付费任务、覆盖用户新编辑或把未知状态伪装成失败。

本文件合并了初版方案与后续诚实审计结论，是 INC-GEN-015 的唯一实施合同。方案冻结时只完成文档落地；2026-08-26后续获授权实施的实时状态以`spec/INC_GEN_015_LEGACY_CANVAS_ORPHAN_GENERATION_STATE_RECONCILIATION_CHECKPOINT.md`为准，不用本段历史基线覆盖当前断点。

## 0. 最终结论

INC-GEN-014 / v0.6.44 修好了“未来仍带可信 checkpoint 的工作流执行与 Canvas 投影解耦”，但没有充分覆盖已经失去可用 checkpoint 的历史孤立节点。因此，旧画布继续显示呼吸灯并不代表后台仍在生成，而是 Canvas 中的持久运行标记没有被终态任务收口。

诚实判断：

- 在无法证明任务归属和终态时，系统 fail-closed、不擅自覆盖结果是合理的；
- 明知服务端没有活动任务，却无限显示“正在生成”不合理，这是状态真实性与历史兼容缺口；
- 当前已核实案例没有重复付费、Provider 重提、结果删除或服务端活动任务，风险级别为 `P1`，不是已发生的 `P0` 数据或费用事故；
- 修复不能只是把呼吸灯布尔值改成 false。必须同时处理旧 run 围栏、task/ownership/input 绑定、结果归属与未来再次生成的准入，否则会制造“表面不亮、实际仍卡住”或旧任务被单节点恢复重新唤醒的新 bug。

方案结论：新增一个窄职责的“历史终态生成核对器”，页面打开时只 GET Canvas 已绑定的原 taskId；匹配当前有效 group checkpoint/lease 时立即让路；确认原任务活动时继续显示真实生成态；确认终态且结果可安全投影时复用 INC-GEN-014 投影端口；确认终态但当前节点语义已变化或结果不完整时，使用新的服务端 `terminal-detach` 原子命令解除旧运行绑定并保留任务历史；任何未知状态只显示中性“待核对”，不持久清理、不允许自动或人工绕过保护发起新单。

## 1. 当前事实与根因边界

### 1.1 已核实的生产案例

2026-08-26 对用户截图中的 Canvas `60a739ce-9cb4-4c46-9c77-92e9f6f22b49` 做过一次只读核对，证据为：

- Canvas revision `327`、graph revision `52`，共 `39` 个节点；
- `5` 个节点持久保存 `Generating=true`：`3` 个 Text、`2` 个 Image；
- 这 `5` 个节点各自仍保存 `workflowExecutionRunId + taskId + ownershipKey + inputKey`，分属 `3` 个历史 runId；
- 对应 `5` 个原任务全部为 `success / attempt 1`，文字结果和图片资产均存在；
- 整张画布共 `10` 个任务，全部 success；该 Canvas 活动任务 `0`，全局活动任务 `0`；
- Canvas 中这 `5` 个节点没有形成当前代码要求的完整 group success/result proof，因此不能把“任务 success”直接等同于“可覆盖当前节点”。

这组证据证明截图中的呼吸灯是持久化状态残留，不是后台真实生成。

### 1.2 已确认的代码原因

1. Text/Image/Video/Audio 节点的单节点恢复在检测到 `data.workflowExecutionRunId` 时主动让路；Text 在 `client/src/canvas/TextNode.tsx`，Image/Video/Audio 也有同类早退。
2. 呼吸灯直接读取各节点的 `textGenerating / imageGenerating / videoGenerating / audioGenerating` 布尔字段；它不查询服务端活动任务账本。
3. `client/src/generation/WorkflowExecutionProvider.tsx` 的自动恢复只在浏览器存在可信 group checkpoint 且 `acceptedTasks` 非空时继续。
4. `client/src/generation/groupRunCheckpoint.ts` 将 checkpoint/lease 保存在浏览器 localStorage；当前代码虽提供 `readGroupRunCheckpoints(scope)`，自动恢复主路径仍优先读取 scope 下最新一条 checkpoint。
5. 因此，当旧 Canvas 保留 `workflowExecutionRunId`，但原浏览器 checkpoint 已被清除、过期、不可用或不属于当前浏览器时：单节点恢复让路，group 恢复又没有可信入口，持久 `Generating=true` 就可能永久无人收口。

### 1.3 推断而非已证实的历史形成过程

最可能的历史形成过程是：旧版本已在内存中收到原任务终态或结果，但 Canvas 写回失败/冲突，随后 checkpoint 被旧逻辑清理或在浏览器侧丢失，留下 run/task 绑定和 `Generating=true`。

该过程与当前事实一致，但没有读取用户浏览器的 localStorage、Cookie、Profile 或会话存储来证明具体哪一步发生；因此实施和验收不得把这段推断写成唯一已证实根因。修复必须覆盖“checkpoint 缺失、损坏、属于其他浏览器、旧清理提前发生”等所有等价入口。

## 2. 范围与非范围

### 2.1 进入本事件

1. 页面打开后识别 Canvas 中带 group run 绑定的孤立生成态。
2. 按节点精确检查全部 checkpoint/runId，而不是只检查 scope 下最新 checkpoint。
3. 只 GET Canvas 已绑定的原 taskId，区分活动、成功、失败、取消、结果不完整和未知。
4. 成功且结果/ownership/semantic fence 完整时，复用 `groupResultProjection` 安全投影原结果。
5. 明确终态但不能安全投影时，通过窄职责服务端 `terminal-detach` 原子解除旧运行绑定，保留任务/媒体/历史结果。
6. 页面展示 `ACTIVE_CONFIRMED / RESTORED / CONFLICT_PRESERVED / UNKNOWN_BLOCKED` 的真实语义；只有活动确认态显示生成呼吸灯。
7. 增加 server-controlled rollout gate、精确审计账本、受影响测试、OpenAPI 和权威文档。
8. 覆盖 Text/Image/Video/Audio 四类生成节点的共享合同。

### 2.2 不进入本事件

- 不建设完整服务端工作流引擎、事件溯源、通用 Overlay 或全画布状态机；
- 不批量扫描或后台改写所有生产 Canvas；
- 不按 prompt、时间接近、模型名或“最近成功任务”猜测结果；
- 不自动重提任何 Generation、Provider、媒体发布或外部同步；
- 不对 failed/cancelled/outcome-unknown 执行付费重试；
- 不把“没有查到活动证据”当成“已确认终态”；
- 不覆盖节点 prompt、模型、输入、上游、尺寸、时长、参考素材、布局、视口或其他标签页修改；
- 不删除任务、attempt、media、publication、历史结果或旧 checkpoint 证据；
- 不改 Provider、计费、credential、模型目录、公共模板或图片工具；
- 首选不改 schema；本方案没有 schema42 的必要证据；
- 不在本次文档授权下实施代码、commit、GitHub、SSH 或发布。

## 3. 冻结领域合同 LGR-01～12

| ID | 冻结合同 |
|---|---|
| LGR-01 | 候选节点必须同时具备 `kind Generating=true + workflowExecutionRunId + 原taskId + ownershipKey + inputKey`；缺少关键绑定时不得猜任务，只进入 `UNKNOWN_BLOCKED` 或现有人工历史入口。 |
| LGR-02 | 使用 `readGroupRunCheckpoints(scope)` 检查全部 checkpoint，并按节点 `workflowExecutionRunId` 精确匹配；有效 checkpoint、accepted binding 或活动 lease 永远优先，孤立核对器必须让路。 |
| LGR-03 | 核对只允许 GET 节点绑定的原 taskId；generation task POST、retry POST、Provider submit、Media/OSS 写和费用必须为 0。 |
| LGR-04 | `queued/running/retrying/recovering` 只有在原 taskId、account/canvas/node/kind/ownership 全部匹配时才是 `ACTIVE_CONFIRMED`；继续显示呼吸灯，不改 Canvas。 |
| LGR-05 | `success` 只有在结果完整、owner/ready/checksum/resultKey、input fingerprint 和当前节点语义全部成立时才允许进入既有 `groupResultProjection`。 |
| LGR-06 | 相同成功结果复用既有 `applicationId = runId + nodeId + taskId + resultKey`；重复打开、双标签和重放只能 `applied/already-applied`，不得复制节点、媒体或成功 proof。 |
| LGR-07 | 明确 terminal 但目标语义变化、结果不完整或不可安全投影时，不覆盖、不重提；原任务/媒体留在历史，通过 `terminal-detach` 收口为 `CONFLICT_PRESERVED`。解除假运行态不得清除服务端任务/idempotency/retry safety；同输入再次付费仍受原任务终态、退款证明和既有提交保护约束。 |
| LGR-08 | 403/404、网络、超时、5xx、格式异常、归属不匹配、task state 不认识或 outcome-unknown 均为 `UNKNOWN_BLOCKED`；不持久清理、不允许新提交，只显示中性状态并有界重读。failed/cancelled 无明确退款/可重试证明时也不得因视觉收口自动或旁路付费重提。 |
| LGR-09 | 终态收口必须是单个事务内的原子状态转换；不得只清 `Generating`、只清 runId 或留下会重新唤醒单节点恢复的半套 task/ownership/input 绑定。 |
| LGR-10 | `terminal-detach` 必须绑定 accountId、canvasId、runId、nodeId、kind、taskId、ownershipKey、inputFingerprint 和稳定 applicationId；服务端在 `BEGIN IMMEDIATE` 内重读最新 Canvas 并执行精确 CAS。 |
| LGR-11 | Canvas 写入前必须先完成任务 GET，再取得现有 canvas admission Web Lock、重读最新节点并执行投影/解除；浏览器无 Web Locks 时允许只读核对，但客户端写入必须为 0。 |
| LGR-12 | 只有服务端明确终态并成功完成 projection 或 detach，才允许停止呼吸灯并解除旧 run 提交围栏；所有四类节点共用同一判定，不复制四套漂移逻辑。 |

## 4. 真实状态机与 UI 语义

| 状态 | 证据 | 呼吸灯 | Canvas 持久写 | 新 Generation |
|---|---|---:|---:|---:|
| `DETECTING` | 已识别候选，正在 GET 原 task | 否；显示轻量“正在核对” | 否 | 禁止 |
| `ACTIVE_CONFIRMED` | 原 task 精确匹配且为 queued/running/retrying/recovering | 是 | 否 | 禁止 |
| `RESTORED` | 原 task success，完整结果已 applied/already-applied | 否 | 允许一次幂等投影 | 仅未来用户主动操作 |
| `CONFLICT_PRESERVED` | 原 task 明确 terminal，但语义冲突或结果不完整；detach 已成功 | 否；提示“原结果保留在任务历史” | 允许一次原子 detach | 不自动；用户主动操作仍须通过原任务/idempotency/retry safety |
| `UNKNOWN_BLOCKED` | 网络/权限/格式/归属/outcome 无法证明 | 否；显示“状态待核对” | 否 | 禁止 |

UI 原则：

- 不再用呼吸灯表达“本地字段还没清”；它只表达已确认的活动任务。
- `DETECTING` 和 `UNKNOWN_BLOCKED` 使用静态中性提示，不能伪装成生成中、失败或已完成。
- 常见 `RESTORED` 不弹阻断红错；`CONFLICT_PRESERVED` 只提供任务历史入口，不要求用户手动刷新或点“对账”才能结束假呼吸灯。
- `UNKNOWN_BLOCKED` 在本页有界重读，刷新后仍可重新核对，但不能通过按钮绕过状态保护发起可能重复付费的新任务。

## 5. 两条合法收口路径

### 5.1 路径 A：完整终态结果投影

适用条件：原 task 为 success，结果完整，目标节点仍是原 kind/run/task/ownership/input/semantic revision，且没有不同任务的新结果。

顺序：

1. 在 Canvas 锁外 GET 原 taskId；
2. 读取全部 checkpoint，若精确 runId 的 accepted-only 恢复仍可信则立即让路；
3. 取得 `unboundry-group-run-canvas-admission:<canvasId>`；
4. 重读最新 Canvas 和目标节点；
5. 构造既有 `GroupResultProjection`，复用 generation-owned 白名单、result completeness 和 applicationId；
6. 由服务端事务内 projection semantic CAS 应用；
7. 只有 `applied/already-applied` 才进入 `RESTORED`；conflict 转路径 B 或安全阻断，绝不盲重放旧文档。

该路径不能放宽 INC-GEN-014 的 result proof、Media owner/ready/checksum、input fingerprint 或 semantic revision。

### 5.2 路径 B：明确终态的原子解除 `terminal-detach`

适用条件：服务端已明确 terminal，但当前节点语义已变化、结果不完整或不满足安全投影门；此时继续显示“生成中”是假的，但覆盖结果也不安全。

新增窄职责服务端命令建议为：

`POST /api/canvases/:canvasId/generation-terminal-detach`

这里的 POST 是 Canvas 内部状态命令，不是 Generation task/Provider submit；验收账本必须分别统计，避免把“生成 POST=0”写得含糊。

请求只允许携带：

`applicationId + accountId + canvasId + runId + nodeId + kind + taskId + ownershipKey + inputFingerprint + observedTerminalState`

服务端在 `BEGIN IMMEDIATE` 中必须：

1. 重新验证登录账号和 Canvas owner；
2. 精确 GET/校验 task 的 account/canvas/node/kind/ownership 与 terminal state；客户端传入 terminal state 不能作为事实来源；
3. 读取数据库中最新 Canvas，而不是使用客户端旧快照；
4. 目标节点仍精确匹配 runId/taskId/ownershipKey/inputFingerprint 才允许修改；
5. 原子修改且只修改本次旧绑定拥有的 generation-owned 运行字段：
   - `${kind}Generating = false`；
   - 删除 `workflowExecutionRunId`；
   - 删除 `${kind}GenerationTaskId / GenerationOwnershipKey / GenerationInputKey`；
   - 清除属于同一旧绑定的 error/retry 暂态字段；
   - 只有 group success proof 精确属于同一旧 task/ownership/result 时才允许一并清除，遇到不同 proof 立即 conflict；
6. 不修改内容结果、asset/src、prompt、模型、参数、上游、布局、视口、其他节点或整个旧 Canvas 文档；
7. 如果上述绑定已经全部解除且没有新 run，返回 `already-detached`；如果已出现新 run/task/语义，返回 conflict 且零修改；
8. 递增并返回 Canvas revision/graph revision，使客户端按最新版本同步。

`terminal-detach` 只解除 Canvas 的假运行展示和旧 group run 围栏，不删除服务端 task/attempt/idempotency/result/retry evidence，也不授予下一次付费提交。单节点和整组付费准入仍必须查询原任务账本：同输入 success 优先找回原结果；failed/cancelled 没有明确退款或既有 `retryAllowed` 证明时继续 fail-closed；outcome-unknown 永远禁止自动或旁路重提。

这一原子命令同时关闭三类审计 bug：只关灯但 run 围栏仍阻止新生成；只清 runId 导致旧 taskId 被单节点恢复重新唤醒；整张旧 Canvas PUT 覆盖用户后续编辑。

## 6. Checkpoint、租约与多 run 优先级

页面打开后对每个候选节点按以下优先级处理：

1. 当前页面内存中已有相同 run 的执行 owner：孤立核对器不启动；
2. `readGroupRunCheckpoints(scope)` 中存在精确 runId，且 acceptedTasks 对该节点绑定完整：交给 INC-GEN-013/014 accepted-only 恢复；
3. 精确 runId 存在活动 lease：等待 owner/lease，不并发投影或 detach；
4. checkpoint 存在但结构损坏、binding 不完整或不匹配：不得从 checkpoint 猜测；仍只可依据 Canvas 的精确 task binding GET 原任务，并把任何归属异常归为 `UNKNOWN_BLOCKED`；
5. 没有可信 checkpoint/lease，且 Canvas 精确绑定完整：进入历史孤立核对；
6. 同一 Canvas 有多个 runId 时逐节点匹配，绝不以“最新 checkpoint”替代精确 runId。

checkpoint 一旦被可信恢复 owner 接管，历史核对器必须 abort。历史核对器不得清理、改写或伪造 checkpoint/lease。

## 7. 并发、锁和幂等顺序

冻结锁顺序：

1. Canvas 锁外只读 GET 原 task，避免持锁等待网络；
2. 获取既有 canvas admission Web Lock，序列化 group claim、单节点付费提交和终态写回；
3. 锁内重新检查精确 checkpoint/lease，防止 GET 后新 group run 已启动；
4. 锁内 GET 最新 Canvas/重读目标绑定；
5. 调用 projection 或 terminal-detach 的服务端事务 CAS；
6. 同步新 revision 后释放锁。

额外规则：

- 无 Web Locks：GET 原 task 可以执行；任何客户端 Canvas 写为 0，状态为 `UNKNOWN_BLOCKED` 或交给现有安全入口。
- 双标签同时核对：稳定 applicationId + Web Lock + 服务端 CAS 至多应用一次；第二个标签得到 already-applied/already-detached/conflict。
- GET 后用户编辑输入、启动新 run、改变账号/画布或 lease：写前重读会失败关闭，旧结果只留历史。
- `groupResultProjection` 当前锁按 account+canvas+applicationId 隔离；本事件额外先取得 canvas admission 锁，解决与新付费 run 准入之间的竞态。

## 8. 运行时 rollout gate

生产页面打开即自动写 Canvas 属于高影响行为，必须分阶段启用，不能硬编码目标账号/Canvas 到源码。

新增 server-controlled 策略：

- `off`：完全关闭；
- `detect`：只识别候选并 GET 原 task，记录脱敏计数，Canvas 写 0；
- `allowlist`：只允许部署配置中的 accountId+canvasId 执行 projection/detach；
- `on`：全量开启。

部署配置只保存在服务器环境或部署清单，不进入客户端源码；客户端通过 authenticated、owner-scoped 的只读 policy 响应获得当前 Canvas 的布尔/枚举能力，不获取完整 allowlist。

生产顺序：

1. 新版本部署时默认 `detect`；
2. 核对候选数量、任务状态分布、GET/错误账本和 generation POST=0；
3. 切到 `allowlist`，只覆盖技术测试 Canvas 与用户已报告的目标 Canvas；
4. 目标 Canvas 验证 5 个节点均收口为允许的安全状态，且数据/费用门通过；
5. 观察窗口无 P0/P1 后才切 `on`；
6. 任一异常先把策略切回 `detect/off`，无需等待代码回退即可停止新自动写。

## 9. 风险、应对与停止门

| 等级 | 风险/可能 bug | 应对与硬门 |
|---|---|---|
| P0 | 把未知任务当终态后允许第二次付费提交 | 只有服务端明确 terminal 才 projection/detach；unknown 保持 blocked；Generation POST/Provider submit 账本必须为0 |
| P0 | 旧结果覆盖用户新 prompt/模型/输入/上游 | 最新 Canvas 重读 + 完整 semantic/ownership/input CAS；只用 generation-owned 白名单 |
| P0 | 正在活动的旧 run 被 detach | 全 checkpoint 精确 runId、活动 lease 优先；服务端二次验证 task terminal；活动态零写 |
| P0 | 整张旧 Canvas 回滚覆盖新标签修改 | terminal-detach 只在服务端最新文档上字段级修改；禁止客户端全快照恢复 |
| P1 | 只清呼吸灯，runId 仍卡住未来生成 | 原子清理完整绑定集合；测试半字段状态全部失败关闭 |
| P1 | 只清 runId，旧 taskId 被单节点恢复重新应用 | run/task/ownership/input/Generating 同事务收口；新单节点 effect 不得观察到中间态 |
| P0 | detach 后绕过原 failed/cancelled/success 任务重新付费 | 服务端任务/idempotency/retry evidence永不删除；付费准入继续按同输入原任务与退款/retry proof fail-closed |
| P1 | 多个 runId 只检查最新 checkpoint，误判另外两轮为孤儿 | 对 `readGroupRunCheckpoints()` 全量按节点 runId 匹配；生产 fixture 固定 3 runId |
| P1 | 双标签重复投影或 detach | canvas admission Web Lock + applicationId + server transaction CAS |
| P1 | 403/网络/格式错误仍显示假“生成中”或错误解锁 | UI 转 `UNKNOWN_BLOCKED` 静态状态，Canvas 零写，新提交禁用 |
| P1 | 页面打开形成 GET/PUT 风暴 | 每 Canvas 单调度器、taskId 去重、有界并发、退避、导航 abort、rollout gate |
| P1 | terminal-detach API 被跨账号或伪造终态调用 | owner-scoped auth；服务端自行查询 task 和绑定；OpenAPI/negative tests 覆盖 |
| P2 | 为四类节点复制四套恢复逻辑后漂移 | 共享 pure classifier/reconciler；节点只提供 kind-specific field adapter |
| P2 | UI 堆积技术状态 | 只暴露“生成中/正在核对/原结果已保留”三类用户语言，不展示 runId/applicationId |

以下任一情况为 No-Go：

- 无法证明 Provider 是否已接收但继续会产生第二次提交风险；
- 必须放宽 ownership/input/semantic/task 绑定才能写回；
- 无法在同一事务内完成 terminal-detach；
- rollout gate 不能在不发版的情况下关闭自动写；
- 回退只能依赖整张 Canvas 快照覆盖；
- 生产出现非授权 Canvas 修改、Generation POST、Provider submit、媒体写或费用增量。

## 10. 实施阶段 R0～R6

### R0：冻结身份、fixture 与账本

- 从实施时最新 `origin/main` 新建隔离工作树，保留本方案；不得直接把当前生产回执分支当实现分支。
- 核对 package/schema/生产版本、tag 占用、Node 22.23.1/npm 10.9.8、4173 listener 和 dirty state。
- 建立与当前案例一致的精确 fixture：39 节点、5 个 stale generating（3 Text/2 Image）、3 个 runId、5 个 terminal success task、checkpoint 缺失/多 checkpoint 变体。
- 冻结网络/费用账本：task GET、Canvas GET、projection/detach 写分别统计；Generation task POST、Provider、Media/OSS、费用固定为0。

### R1：预期红

至少证明旧实现：

1. `Generating=true + workflowExecutionRunId + terminal success task + no checkpoint` 永久跳过恢复；
2. 多 runId 时只读最新 checkpoint 会漏掉节点；
3. 只清 `Generating` 仍被旧 run fence 阻止；
4. 只清 runId 会唤醒单节点旧 task 恢复；
5. unknown/403/网络错误仍不能形成真实 UI 状态；
6. 客户端整文档清理存在覆盖并发编辑风险。

只冻结直接相关红，不运行 full。

### R2：共享分类器和历史核对器

- 新增窄职责 `client/src/generation/legacyTerminalGenerationReconciler.ts`；
- 提取四类节点共享的 candidate adapter、task classifier 和 UI reconciliation state；
- 使用全部 checkpoint 精确 runId 优先级；
- GET 只读在锁外执行，taskId 去重、有界并发和 abort；
- 活动、未知、终态三类不得互相冒充。

### R3：投影复用与 terminal-detach

- 完整 success 复用 `groupResultProjection`，不另写第二套 result merge；
- 新增 owner-scoped terminal-detach Application/Store/API/OpenAPI 窄端口；
- 服务端事务内 task terminal + Canvas binding 双重 CAS；
- 固化原子字段集合、already-detached 和 new-run conflict；
- schema 保持41，Canvas JSON 仍由现有文档承载，不新增通用持久化平台。

### R4：页面接入、UI 和 rollout gate

- 在 Canvas hydration 完成后启动每 Canvas 单调度器；
- Text/Image 做完整页面级接入；Video/Audio 走同一共享 adapter 并做最小渲染验证；
- 呼吸灯只取 `ACTIVE_CONFIRMED` 或当前真实本地提交态；
- 接入 `off/detect/allowlist/on` server-controlled policy；
- 常见恢复无弹窗，冲突保留历史入口，unknown 阻止提交。

### R5：风险驱动验证和候选冻结

- 先跑 m22（checkpoint/run/zero-submit/shared classifier）、m85（server Canvas CAS/atomic detach）、m41（Text/Image 页面真实状态）；
- 新 API 合同实际变化才跑 m20；权威文档变化跑 m38；Video/Audio 只跑共享 pure adapter 和最小相邻 spec；
- TypeScript/build 只在代码候选冻结时执行；
- 定向失败只复验失败 spec 或最小传播集合；
- 候选冻结后启动一个独立只读 P0/P1 终审，检查重复付费、活动 run 误清、结果覆盖、partial cleanup、unknown 解锁、API 越权和测试缺口；
- 只有进入正式 release candidate 才执行一次 safe full；同一源码不得重复 full。

### R6：发布、灰度、生产验收与必要回退

- 版本号和允许发布必须由用户在实施 Goal 中重新确认；本方案不预占版本。
- fresh candidate source build、冻结备份/恢复演练、原子切换、健康/数据/inventory/静态资源门沿用上线规矩。
- 发布默认 `detect`，再按技术 Canvas → 用户目标 Canvas allowlist → 全量 on 推进。
- 优先零付费验证；不得为本事件执行真实生成。
- 生产写前后核对 tasks、attempts、active、media、publications、canvases、schema、service、NRestarts 和静态资源；只解释本事件 Canvas revision 的预期增量。
- 任何技术失败先关闭 rollout gate；若 runtime 本身失败，回切上一不可变 release 并验证恢复。

## 11. 风险驱动测试与防回归清单

必须固化以下长期回归：

1. 当前案例 fixture：3 runId、3 Text/2 Image、全部原 task success、active0、无 checkpoint。
2. 多 checkpoint：精确 runId 的活动 lease/accepted binding 让 orphan reconciler 让路。
3. task active：呼吸灯保留，Canvas 写0，Generation POST0。
4. success 完整且语义相同：只应用一次，布局/视口/其他节点不变。
5. success 但结果不完整：不调用 result projection；terminal-detach 后历史仍可读。
6. prompt/model/input/upstream 在 task GET 后变化：服务端 conflict，零覆盖。
7. 新 run 在 task GET 后启动：旧 detach conflict，新 run 不受影响。
8. failed/cancelled：不自动重提；解除假运行绑定后显示准确终态/历史入口。
9. outcome-unknown/403/404/网络/超时/5xx/格式异常：`UNKNOWN_BLOCKED`、Canvas 写0、Generation POST0。
10. 无 Web Locks：task GET 可执行，projection/detach 写0。
11. 双标签重复 application：一次 applied/detached，另一次 already/conflict；节点、媒体、revision 无重复异常增量。
12. terminal-detach 字段白名单、事务原子性、跨账号/跨 Canvas/错 kind/run/task/ownership/input 全部拒绝。
13. partial cleanup fixture：只清 Generating、只清 runId、只清 taskId 均不得成为合法持久结果。
14. Text/Image 完整 UI；Video/Audio 共享 pure adapter 与最小渲染，防止四类逻辑漂移。
15. rollout `detect` 模式精确证明 Canvas 写0；allowlist 外精确证明写0。
16. terminal-detach 后，同输入 success/failed/cancelled/outcome-unknown 仍命中原 task/idempotency/retry safety，不能通过清 Canvas binding 创建第二个付费请求。

不扩大到：真实 Provider、付费生成、OSS、公共模板、credential、完整四节点 UI 重构、schema migration、多个 full 或全站浏览器漫游。

## 12. 验收矩阵

| ID | 必须证明 |
|---|---|
| LGR-01 | 精确识别合法孤立候选，缺绑定不猜测 |
| LGR-02 | 全部 checkpoint 按节点 runId 精确匹配，活动 owner/lease 优先 |
| LGR-03 | 恢复只 GET 原 taskId；Generation/Provider/Media/OSS/费用为0 |
| LGR-04 | 活动原 task 才显示呼吸灯，且不写 Canvas |
| LGR-05 | success 完整结果只通过既有 projection 安全应用 |
| LGR-06 | applicationId 重放、双标签和重复刷新只应用一次 |
| LGR-07 | 语义冲突/结果不完整不覆盖、不重提，原结果历史可找回 |
| LGR-08 | unknown/权限/网络/格式异常为中性 blocked，不能新提交 |
| LGR-09 | run/task/ownership/input/Generating 原子收口，无半状态 |
| LGR-10 | terminal-detach owner/task/terminal/Canvas 事务 CAS 和字段白名单成立 |
| LGR-11 | GET→canvas admission lock→最新重读→写入顺序成立；无锁零写 |
| LGR-12 | Text/Image/Video/Audio 共用同一判定；UI 不再把持久布尔值冒充真实生成 |

生产目标 Canvas 不要求 5 个节点全部写成 `RESTORED`。准确完成标准是：5 个假呼吸灯全部转为 `RESTORED / CONFLICT_PRESERVED / UNKNOWN_BLOCKED / ACTIVE_CONFIRMED` 中有证据的状态；其中当前已知服务端 active0，因此若生产现场仍一致，不应出现 `ACTIVE_CONFIRMED`。任何语义冲突节点必须是 `CONFLICT_PRESERVED`，不得为了追求“全部恢复”覆盖当前节点。

## 13. 回退合同

### 13.1 功能回退

- 第一层：把 rollout gate 切回 `detect/off`，立即停止新的自动 Canvas 写；
- 第二层：回切上一不可变 release；
- 不删除新 release、冻结备份、任务、媒体或历史结果。

### 13.2 Canvas 字段回退

禁止把发布前整张 Canvas 快照直接覆盖回生产，因为用户可能在修复后继续编辑。

若必须撤销某次 projection/detach：

1. 只允许目标 Canvas 当前 revision 仍等于该应用返回的 post-repair revision 时执行精确逆变更；
2. revision 已变化时，必须 GET 最新 Canvas，对同一 application 的 generation-owned 字段做三方合并；
3. 任何 prompt/model/input/upstream/新 run/新结果变化都停止自动回退；
4. 任务、attempt、media、publication、布局、视口和其他节点永不随字段回退删除或覆盖；
5. 无法证明安全时保留当前数据，关闭功能并登记人工核对，不以“恢复旧快照”冒充安全回退。

## 14. 完成定义

只有同时满足以下条件，INC-GEN-015 才能进入生产技术完成：

1. LGR-01～12 全部有当前候选证据；
2. 当前案例精确 fixture 和目标生产 Canvas 均不再把非活动任务显示为生成中；
3. Generation task POST、Provider submit、自动 retry、Media/OSS 写和费用均为0；
4. 活动任务不被误清，unknown 不被解锁，终态冲突不覆盖且历史结果可找回；detach 后同输入付费准入仍受原任务和退款/retry proof 保护；
5. terminal-detach 原子、幂等、owner-scoped，partial cleanup 不可出现；
6. 风险驱动定向、必要相邻回归、唯一 safe full 和独立终审完成，无未关闭 P0/P1；
7. 方案、checkpoint、TASKS、CURRENT_STATE、验收矩阵、OpenAPI 和 release receipt 同步；
8. rollout gate 已验证 detect/allowlist/on/off，异常可先关写再回切 runtime；
9. Git/PR/tag/Release、冻结恢复、fresh build、原子发布和生产数据/资源门完成；
10. 自动证据只写 `AUTO_PASS`，生产技术证据只写 `PRODUCTION_*_PASS`；用户在目标老画布刷新并确认视觉状态后才允许写 `USER_PASS`。

当前实施状态：`PRODUCTION_V0_6_45_DEPLOYED / TARGET_ALLOWLIST_WAITING_AUTHENTICATED_PAGE / USER_RECHECK`。独立终审、唯一safe full、PR/main CI、tag/Release、fresh build、冻结恢复、原子切换、detect与技术Canvas allowlist均完成；生产v0.6.45/schema41健康且全部数据/费用账本不变。目标owner`zzx`未登录可控浏览器，目标精确allowlist已就绪但5节点尚未收口；不得提前进入`on`或运行第二次full。实时证据见`spec/V0_6_45_PRODUCTION_RECEIPT_2026-08-26.json`。

## 15. 下一步与授权边界

用户已通过本Goal明确授权实施与v0.6.45发布；当前唯一下一步是让目标owner`zzx`登录可控浏览器并打开目标Canvas。目标验收通过后才继续`on`，否则维持target-only allowlist或切回`detect/off`。

方案阶段本身不等于实施或发布；本次后续Goal已单独提供v0.6.45实施、GitHub与生产灰度授权，仍不得突破零Generation重提、零Provider提交、零费用和数据安全边界。
