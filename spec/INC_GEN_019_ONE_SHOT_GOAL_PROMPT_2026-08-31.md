# INC-GEN-019 新 Session 一次性限时实施 Goal 提示词

状态：`COPYABLE_GOAL_PROMPT / NOT_STARTED / NOT_CURRENT_SESSION_AUTHORIZATION`

日期：2026-08-31

预计时间：本地复现、修复、定向验证与候选 Review 约 2～3 小时；包含唯一 formal full、CI、不可变发布和一次有上限的真实生产整组验收约 4～6 小时。第 6 小时为硬停止门，不允许演变为十几个小时的开放式重构。

使用方法：在新的 Codex Session 中完整复制下面代码块并发送。只有用户在新 Session 实际发送后才创建并启动 Goal；本文档存在、当前 Session 编辑本文或历史 `/goal` 均不授权当前 Session 实施。

```text
/goal

你现在开始执行 Unboundry 的 INC-GEN-019「整组执行保存竞态与原子准入精确修复」。这是一次性、连续、限时、限范围、文档驱动的实施 Goal。

本 Goal 只修生产 v0.6.64 中已经查实的真实用户失败：整组执行的模型/输入 preflight 两次 HTTP 200，但正式 generation task admission 因 Canvas revision 在慢 preflight/POST 期间持续变化而两次返回 `409 CANVAS_NOT_SAVED`，首节点失败并使 10 个下游节点未运行。本次点击新增 task=0、admission=0、Provider attempt=0、Provider POST=0、费用=0。

不得只分析、只写方案、只改文案或停在候选代码；在本 Goal 的时间、文件和安全预算内，连续完成复现、精确修复、定向验证、候选逐代码 Review、唯一正式 safe full、GitHub、不可变 patch 发布、rollback/forward、零付费生产技术门和一次有上限的真实生产整组验收，直到技术终态或本文规定的真实硬停止条件。

本消息是用户对本 Goal 的最新明确授权。立即调用 Goal 创建工具，以本文目标创建 Goal。本文明确授权且只授权目标 Canvas/目标 group 的一次真实整组点击：最多新增 11 个 generation task、11 个 admission、11 个 Provider attempt、11 次 Provider POST、11 个结果所需的 OSS object 写，总新增费用硬上限按保守折算不超过人民币 100 元；第八节的精确计数、身份、费用和 unknown-outcome 围栏不得放宽。

## 一、唯一仓库和实时身份

1. 唯一实施 checkout：
   `/Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28`
2. 先进入该目录，核对 `pwd`、Git root、branch、HEAD、全部 worktree、`origin/main`、remote、package/schema、Node/npm、生产 version/schema/service、当前 task/attempt/admission/active/unknown/Provider 计数。
3. 文档冻结时已知生产为 `v0.6.64/schema41`。Git HEAD 和 origin/main 必须以 R0 实时 fetch/只读核对为准，不得使用聊天摘要里的旧 commit。
4. 默认新分支：`codex/inc-gen-019-group-admission-2026-08-31`。若已占用，自动使用同前缀不冲突后缀，不要询问。
5. 从实时最新 `origin/main` 建立隔离分支/工作树，并把本 Goal 的 Plan/Goal 文档安全带入；不得 reset、clean、覆盖或丢弃用户与历史工作。
6. 两个既有受保护 JSON 继续禁止读取、stat、hash、复制、编辑、枚举、暂存、提交、移动或删除。不得使用会把它们列出的宽泛文件命令；所有文件查询使用显式 allowlist 或排除规则。

## 二、本事件的窄权威恢复路由

本条新 Goal 明确覆盖 INC-GEN-018 历史 Goal 中“每次恢复完整重读 24 份旧文档”的要求。本事件是小型精确修复，不允许为仪式重复读取全部历史材料或重复历史阶段。

首次启动及每次上下文压缩恢复，只按以下顺序完整读取 8 份当前相关文件：

1. 仓库根 `AGENTS.md`
2. `spec/INC_GEN_019_ONE_SHOT_GOAL_PROMPT_2026-08-31.md`
3. `spec/INC_GEN_019_GROUP_EXECUTION_SAVE_RACE_AND_ATOMIC_ADMISSION_FINAL_AUDITED_PLAN_2026-08-31.md`
4. `spec/INC_GEN_019_CHECKPOINT.md`（R0 创建后成为实时断点）
5. `spec/INC_GEN_019_ACCEPTANCE_MATRIX_2026-08-31.md`（R0 从 Plan 的 IG19-001～036 创建）
6. `spec/UNBOUNDRY_CURRENT_STATE.md` 顶部 INC-GEN-019/018 当前区块
7. `TASKS.md` 顶部 INC-GEN-019/018 当前区块
8. `spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_CHECKPOINT.md` 的顶部状态、R8技术终态和用户失败后证据区块

随后按需精确读取代码直接依赖和 Plan 明确引用的历史合同。只有出现身份冲突、DATA-005、accepted-only recovery、发布/回退证据缺口时，才读取对应单份历史文件；不得把“可能有用”当成完整重读历史文档的理由。

事实优先级：本条最新 Goal消息 > 当前仓库 `AGENTS.md` 中不冲突条款 > INC-GEN-019 Checkpoint > INC-GEN-019 Plan > INC-GEN-019 Matrix > 当前代码/测试/生产证据 > INC-GEN-018 历史证据 > 聊天摘要和记忆。

## 三、唯一技术目标

必须用最小可靠改动实现：

1. 客户端在一个 shared monotonic deadline 内执行：保存稳定 → 重算完整 generation identity → 零 Provider preflight → 校验 preflight 返回的现有 `canvasRevision` → 再确认本地 revision/语义/lease → 正式 POST。
2. 客户端检查只负责减少竞态；服务端 `admitOrGet(expectedCanvasRevision)` 的事务 revision fence 保持唯一原子准入权威，不删除、不放宽。
3. 明确 `idempotencyKey` 全生命周期：
   - 明确 `CANVAS_NOT_SAVED` 且 exact key lookup 为空、语义未变时，同一 key 在 deadline 内重新预检；
   - network/timeout/5xx unknown 只 reconcile 原 key，绝不换 key、绝不再 POST；
   - exact task 已存在时恢复原 task；
   - semantic identity 变化时安全停止本轮，不在同一点击中静默生成新内容。
4. 对本次 34 次 Canvas PUT 先做 reason/fingerprint 因果插桩，精确归因 writer；只合并已证明的同一 hydration/reconciliation epoch no-op 写，不做全局 debounce、暂停保存或第二套保存队列。
5. 保持 DATA-005、pagehide、task binding、accepted-only recovery、result projection、group checkpoint、跨标签同步和四种节点类型合同。
6. 正常无并发编辑时，用户只点一次，系统自动等待、准入、绑定任务并继续下游；不要求刷新、二次点击或打开任务面板。
7. 内部 revision 收敛不刷连续红错；timeout、input changed、unknown outcome、accepted/projection pending 必须使用不同稳定 reasonCode 和准确文案。

严格实施最终 Plan 第 5～19 节、GA19-01～07、IG19-001～036 和全部 NO-GO 条件。

## 四、小修复范围预算

这些预算用于阻止无边界扩张，不得用来跳过必要正确性：

1. 预计产品/测试改动集中在 4～8 个文件；硬扩张门为 10 个产品+测试文件。治理文档、版本文件和锁文件不计入该分母。
2. 预计产品代码净新增不超过 250 行；硬扩张门为 450 行产品代码净新增。删除重复逻辑不计为新增；测试代码单独报告。
3. 不新增数据库 schema migration、不新增依赖、不重写 Canvas persistence、不重构模型合同/Provider adapter、不拆新服务。
4. 允许修改的初始产品范围：
   - `client/src/generation/generationTasks.ts`
   - `client/src/generation/workflowNodeExecutors.ts`
   - `client/src/generation/groupRunPersist.ts`
   - `client/src/generation/WorkflowExecutionProvider.tsx`
   - 已有 `saveGate.ts` / `groupRunCheckpoint.ts`
   - 只有 R1 因果证据证明需要时才修改 `CanvasSurface.tsx` 或 `canvasPersistenceFacade.ts`
   - 只有保持/加强最终事务 fence 需要时才修改 `server/generationTasksApi.ts` 或 task store
5. 测试优先放在 `tests/m22-group-execution.spec.ts` 及现有直接 Canvas persistence/idempotency specs；不为本事件复制一套测试框架。
6. 若需要超过 10 个产品+测试文件、超过 450 行产品净新增、增加 schema/dependency、重写保存架构或改变模型/Provider语义，立即停止为 `SCOPE_EXPANSION_BLOCKED`：写清已证明根因、为什么窄修复不足、预计新范围，不继续堆代码，不把半成品发布。

## 五、时间预算与超时纪律

目标墙钟不是精确承诺，但必须按以下硬门控制，禁止无上限工作：

1. R0 身份/证据冻结：最多 20 分钟。
2. R1 确定性复现和 34 PUT writer 归因：累计最多 75 分钟。75 分钟仍不能得到稳定红测或 writer denominator 时，停止为 `ROOT_CAUSE_NOT_REPRODUCED`，不得靠猜测改 Canvas 大模块。
3. R2～R4 产品实现：最多 120 分钟。到时仍超过 2 个未关闭 P1，停止为 `IMPLEMENTATION_SCOPE_UNDERSTATED`，保留小 diff 和证据，不继续滚雪球。
4. R5 定向验证与 R6 候选 Review：最多 90 分钟。只允许一个独立只读 Review 代理，且只在候选冻结后启动；不得多代理重复审计或测试。
5. R7 唯一 formal full、失败最小关闭：预计 30～60 分钟，不重复 full。
6. R8 GitHub/CI/发布、生产零付费门和一次真实整组验收：预计 60～120 分钟，外部 CI/Provider 等待单独记录但仍计入总墙钟。
7. 总墙钟达到 6 小时仍未满足 R8 进入条件时，必须停止为 `TIMEBOX_EXCEEDED`，更新 Checkpoint/Matrix/TASKS/CURRENT_STATE，给出：已完成、未完成、精确 blocker、当前 diff/测试、是否可安全恢复。不得继续到十几个小时，也不得为赶时间跳过 P0/P1、安全或回滚门。

正常预期：代码与本地证据 2～3 小时；含 CI/发布 4～6 小时。任何超时停止都不是“修复通过”，也不能发布候选。

## 六、实施顺序

### R0：20 分钟身份与状态冻结

- 创建 `spec/INC_GEN_019_CHECKPOINT.md` 和 `spec/INC_GEN_019_ACCEPTANCE_MATRIX_2026-08-31.md`。
- 把 CURRENT_STATE/TASKS/AGENTS 顶部状态纠正为：`INC_GEN_018_MODEL_CONTRACT_PASS / INC_GEN_019_GROUP_EXECUTION_USER_FAIL / ZERO_NEW_TASK_ATTEMPT_PROVIDER_POST / IMPLEMENTATION_IN_PROGRESS`。
- 冻结 200→409→200→409、34 PUT、目标 Canvas 最终 revision/graphRevision/saveSequence、tasks1026/attempts1037/admissions946/new0/active0 的只读历史证据。
- 冻结实时 Git/版本/生产/模型/identity/Provider 分母和每阶段墙钟起点。

### R1：75 分钟确定性红测和 writer 归因

- 用 safe runner、新临时数据、动态 loopback、fake transport/fake monotonic clock 构造 53 nodes/98 edges、至少 11 executable nodes、至少 2 个同层 root、约 4 秒 controlled preflight 和持续 revision 漂移。
- 旧代码必须稳定复现两轮 200→409，首节点失败、10 下游未运行、task/admission/provider=0。
- save diagnostics 只记录 reason、epoch、fingerprint、dirty/saving、sequence/revision、caller family、monotonic time；禁止记录 owner、Prompt、媒体、graph 正文或 secret。
- 每个 PUT 必须归类，`other=0` 才进入 R2/R3。

### R2：客户端有界 admission state machine

- 复用现有 `ensureGenerationTask`、Canvas admission、workflow executor；不建旁路。
- 补齐并校验服务端 preflight 已返回但客户端类型遗漏的 `canvasRevision`，不要增加重复字段。
- 一个 monotonic deadline 覆盖 flush/save/preflight/confirm/formal POST/revision retry；不得嵌套多个 30 秒。
- 确定性 revision 409 只在 exact key 为空、语义相同、deadline 未到时同 key 继续。
- 保留服务端 strict preflight、revision assertion 和 transaction `admitOrGet` 最终围栏。

### R3：idempotency 与保存 writer 精确修复

- 逐项实现 Plan 第 6 节状态表，覆盖 preflight reject/network、formal 409/4xx/5xx、task exists、cancelled、semantic change、unknown outcome。
- 只修 R1 证明的冗余 writer；给出 before/after reason 分母、PUT 数和 graph fingerprint。
- user edit、task binding、result projection、checkpoint、pagehide 与跨标签 last-writer 不能被合并掉。

### R4：UX、资源释放和恢复

- 优先复用 preparing/running/skipped/failed 与 reasonCode；无证据不新增持久 group 状态枚举。
- 覆盖 success、明确失败、cancel、deadline、navigation、unmount、lease loss、exception 的 lease/locks/checkpoint/notification 清理。
- accepted task 与 projection pending 不得显示成 Provider失败，不得触发重复提交。

### R5：风险驱动定向验证

- 先跑 m22 新红/绿 cases，再跑实际受影响的 Canvas persistence、idempotency、accepted recovery、四节点入口最小 specs。
- 失败只重跑失败 spec/最小直接集合；没有传播证据不扩大测试。
- 全部命令使用 `node scripts/run-safe-tests.mjs`，记录 Node/npm、动态端口、fixture、source/snapshot、pass/fail/skip/retry/block/reportErrors 和 exit。

### R6：冻结候选并逐代码 Review

- 冻结 HEAD/tree/diff hash/candidate manifest、文件数、产品净新增行和测试证据。
- 主线程逐文件、逐 hunk、逐关键分支、完整调用链审查。
- 只允许一个独立只读 Review 代理；必须使用 `gpt-5.6-luna`、reasoning effort `max`，仅在候选冻结后运行，不得修改文件或重复测试。
- 覆盖 single/group/retry/task panel/startup recovery、四节点、全部 published models/exact identities/Provider protocol/adapter 分支及所有错误出口。
- 报告 numerator/denominator。`P0>0` 或 `P1>0` 一律解冻 NO-GO；只修直接项并做最小复验/增量复审。

### R7：唯一 formal full

- 仅 R6 `P0=0/P1=0/GO` 后运行一次：`node scripts/run-safe-tests.mjs full`。
- full 原始结果永久保留。失败后只跑失败 spec/最小受影响集合，不重复 full。
- 使用 fresh temp、动态 loopback；禁止 4173、生产路径、真实 Provider/OSS/credential/media。

### R8：GitHub、不可变 patch、生产零付费门和一次真实整组验收

- 候选 GO 后选择 `v0.6.65`；若实时已占用，自动选择高于实时生产的最低未占用 patch。先把占用证明和最终版本写入 Checkpoint。
- 本 Goal 明确授权必要 commit、push、PR、final-head CI、merge、main CI、annotated tag、GitHub Release、fresh tag build。
- 本 Goal 明确授权 quiet gate、冻结备份/恢复、不可变 release、原子切换、实际 rollback/final forward、service/version/schema/integrity/FK/static/data/counts 稳定门。
- 本事件预期无 schema migration；若发现需要 schema migration，触发 `SCOPE_EXPANSION_BLOCKED`，不得执行。
- 先完成零付费生产门：版本/服务、模型目录、preflight canvasRevision、目标 Canvas 静态/预检、保存活动和 task/attempt/admission/provider/fee 基线。任何一项失败，不得进入真实整组点击。
- 真实验收只允许目标 Canvas `3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`、目标 group `group-736e7a8d-be5e-48f7-8927-8a2d6b92f46a`。R0/R8 必须冻结该 group 当前 exact node allowlist、11 个 logical executable node 的依赖图、各自模型/adapter/单结果、估算费用和预期 task/admission/attempt/Provider POST 分母；任一身份变化、节点数大于 11、费用无法估算或预计总费用超过第八节硬上限，必须在点击前停止。
- 只点击一次“整组执行”，禁止刷新后再点、手动任务重试、节点重试或第二次 group run。每个 logical node 最多创建一个 task、一个 admission、一个 Provider attempt、一次 Provider POST；同一个 idempotency intent 的只读 reconcile/poll 不计为新 POST。
- 点击后按 exact task/identity 自动跟进到 terminal、结果投影和依赖下游；若响应丢失或结果不明，只核对原 key/task，绝不再次 POST。任一节点明确失败则记录真实失败，不重跑整组来追求全绿。
- 真实验收前、中、后持续核对累计新增 task/admission/attempt/Provider POST/OSS/费用。任一计数即将超过上限，必须阻断后续尚未提交节点；已 accepted 的原任务只允许继续查询和回填。
- 成功标准：全部获授权 executable node 按依赖完成、无重复 task/attempt/POST，结果自动投影并在刷新后保持，最终 active/unknown=0，实际总费用不超过硬上限。技术证据可写 `REAL_GROUP_FLOW_PASS`，用户未明确确认前仍保持 `USER_RECHECK`。
- 生成不可变生产回执并同步 Checkpoint/Matrix/TASKS/CURRENT_STATE/Plan/AGENTS/README/上线规矩的必要当前状态。

## 七、一次性权限

以下本 Goal 内权限提前授予，不要中途再问；真实 Provider/OSS/费用只按第八节目标身份和硬上限授权：

1. 修改本 Goal 必需的产品代码、类型、测试、fixture、safe test coverage、治理文档和版本文件。
2. 创建隔离分支/worktree、安装 lockfile 既有依赖、运行静态检查、类型检查、构建、定向 safe tests 和唯一 formal full。
3. 创建本地 checkpoint/功能/候选/治理 commit。
4. 候选 Review GO 后 push、PR、CI 修复/等待、merge、main CI。
5. 版本号确认：首选 `v0.6.65`；占用时使用高于实时生产的最低未占用 patch。
6. 允许发布：可以完成不可变 tag/Release、fresh build、冻结备份恢复、原子生产切换、rollback/final forward、零付费生产门和一次有上限的真实目标整组验收。
7. 允许通过既有认证通道进行本 Goal 所需的脱敏 GitHub/生产只读与上述精确发布操作。
8. 允许一个候选冻结后的独立只读 Review 代理；不允许多个代理并行重复工作。

授权在技术完成、任一硬停止或 6 小时墙钟到达后自动消费，不得延伸到其他事件。

## 八、数量和费用硬上限

1. 授权范围只限 target Canvas `3b3cb4f8-56c3-49f5-ad42-1a00748ba33a` 和 target group `group-736e7a8d-be5e-48f7-8927-8a2d6b92f46a` 的一次整组执行；其他 Canvas/group/node 的真实提交上限仍为 0。
2. 新增真实 generation task：最多 `11`，且每个 R0 冻结的 logical executable node 最多 1 个。
3. 新增真实 admission：最多 `11`，且必须与上述 task 一一对应。
4. 新增真实 Provider attempt：最多 `11`，每个 task 最多 1 个；禁止自动/手动创建第二 attempt。
5. 新增真实 Provider POST：最多 `11`，每个 logical node 最多 1 次；poll、GET、reconcile 不得伪装成新 submit。
6. 新增真实 OSS object 写：最多 `11`，只允许上述 task 的最终结果资产；禁止额外测试对象、复制或覆盖无关对象。
7. 总新增真实费用硬上限：按保守统一账本计算 `CNY_actual + 10 × USD_actual <= CNY 100`。本 Goal 不授权其他计费币种；无法获得可靠单价或最坏费用估算时，不得提交该节点。
8. 正式整组点击：最多 `1` 次；节点重试、task retry、整组重跑均为 `0` 次。
9. formal full：最多 `1` 次。
10. 独立 Review 代理：最多 `1` 个，只读，候选冻结后使用。
11. 产品+测试改动文件硬门：`10`；产品代码净新增硬门：`450` 行。
12. 总墙钟硬门：`6` 小时。达到时间门时，已 accepted 的原任务只能继续后台运行/原 key 核对；停止新增提交和工程扩张，写明 `EXTERNAL_PROVIDER_PENDING` 或实际终态。

任何路径即将超过上限必须在边界前停止；不得先做后解释。

## 九、永久红线

1. 不读取/输出 secret、Authorization、Cookie、API key、签名 URL、真实 Prompt、媒体或用户 graph 正文。
2. 不触碰两个受保护 JSON，不用宽泛文件枚举间接暴露它们。
3. 不执行 `git reset --hard`、`git clean`、破坏性 checkout，不覆盖用户改动，不移动历史 tag，不删除 release/backup/staging/用户数据。
4. 不放宽 owner、revision、CAS、transaction、idempotency、credential、model contract、Provider、费用和 publication 围栏。
5. 不用 sleep、无限重试、隐藏 toast、刷新、二次点击或全局暂停保存冒充修复。
6. unknown outcome 永不第二次 POST；只能按原 key/完整 identity 核对恢复。
7. 不把零付费 preflight、测试、CI 或健康接口写成真实整组 Provider flow 通过；只有本 Goal 唯一真实点击按完整分母完成才可写 `REAL_GROUP_FLOW_PASS`。

## 十、Checkpoint 与防失忆

1. 每完成 R0～R8 任一阶段，立即同步：INC-GEN-019 Checkpoint、Matrix、TASKS、CURRENT_STATE；记录墙钟累计、文件/行数预算、命令/结果、source/snapshot、Provider/OSS/费用、下一步和硬停止余额。
2. 压缩前先写 Checkpoint；压缩后只按第二节 8 份窄权威路由恢复，不重新跑已完成的 full、测试、GitHub、发布或生产动作。
3. 已通过且源码未变的测试不重复；文档/格式变更不使业务证据失效。
4. `EXPECTED_RED`、`TARGETED_PASS`、`REVIEW_GO`、`FORMAL_FULL_RECORDED`、`PRODUCTION_ZERO_PAID_TECHNICAL_PASS`、`REAL_GROUP_FLOW_PASS/FAIL/PENDING`、`USER_RECHECK`、`USER_PASS`严格分开。

## 十一、技术完成终态

在本 Goal 的有上限真实验收边界下，成功完成状态是：

`PRODUCTION_V0_6_65_TECHNICAL_PASS / INC_GEN_019_ATOMIC_ADMISSION_PASS / REAL_GROUP_FLOW_PASS / FEE_WITHIN_CNY_100_CAP / USER_RECHECK`

若最终版本因占用顺延，用实际版本替代 v0.6.65。

必须同时满足：

1. 旧代码稳定复现 200→409→200→409，候选在相同 controlled race 下自动收敛。
2. 34 PUT 复现分母全部归因、`other=0`，内部冗余 writer 有 before/after 证据。
3. 全部 IG19-001～035 自动/技术项按证据关闭；IG19-036 保持 USER_RECHECK。
4. 一个 root、两个同层 root、11-node dependency graph 的 task/admission 分母准确。
5. network/5xx unknown、accepted response loss、semantic change、cancel、lease loss、navigation/unmount 全部 fail-safe 且无重复提交。
7. 候选逐代码 Review `P0=0/P1=0/GO`；唯一 formal full 和失败最小关闭按规则记录。
8. GitHub、不可变 release、fresh build、rollback/final forward 和零付费生产门完成。
9. 唯一真实整组点击的 exact node/task/admission/attempt/Provider POST/OSS/费用分母完整；最多 11 个节点各至多一次提交，全部结果自动投影并刷新保持，active/unknown 最终为 0。

若唯一真实点击出现明确 Provider/输入/结果失败，本 Goal 状态为 `REAL_GROUP_FLOW_FAIL`，不得第二次点击或重试来追求通过；若出现 unknown outcome，则为 `OUTCOME_UNKNOWN_BILLING_RISK`，只核对原任务。即使真实技术流通过，只有用户在网站查看结果后明确确认，才能写 `USER_PASS`。

## 十二、硬停止报告格式

若触发 `ROOT_CAUSE_NOT_REPRODUCED`、`SCOPE_EXPANSION_BLOCKED`、`IMPLEMENTATION_SCOPE_UNDERSTATED`、`TIMEBOX_EXCEEDED`、`OUTCOME_UNKNOWN_BILLING_RISK` 或其他 NO-GO：

1. 立即停止新增代码、formal full、GitHub和生产动作。
2. 更新 Checkpoint/Matrix/TASKS/CURRENT_STATE，保留红测、diff、日志和计数证据。
3. 报告实际墙钟、改动文件数、产品净新增行、已通过/失败测试、P0/P1/P2、Provider/OSS/费用计数。
4. 用不超过一页说明：精确 blocker、为什么不能在原预算内安全解决、已完成内容能否保留、下一次最小动作。
5. 不把 BLOCKED 包装成部分通过，不在停止后继续“顺手修一点”。
```

## 使用前说明

- 这份 Goal 已包含一次真实生产整组验收授权，只限精确 target Canvas/group、最多 11 个 logical executable nodes、每节点最多一次 task/admission/attempt/Provider POST、最多 11 个结果 OSS object，总新增费用按 `CNY_actual + 10 × USD_actual <= CNY 100` 计算。
- 授权不是“可重试 11 次”：它是 11 个不同 logical node 各最多一次。任一 unknown outcome、重复身份、费用预计超限或分母漂移都必须在下一次提交前停止。
- Agent 完成真实技术流后仍只能写 `USER_RECHECK`；用户查看网站结果并明确确认后才是 `USER_PASS`。
