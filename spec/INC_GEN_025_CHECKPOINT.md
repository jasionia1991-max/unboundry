> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# INC-GEN-025 Checkpoint

更新时间：2026-09-01

状态：`HISTORICAL_RELEASE_CHECKPOINT / V0_6_70_RELEASED / POST_RELEASE_AUDIT_BUSINESS_NO_GO / SUPERSEDED_BY_INC_GEN_026`

> 本文件保留 INC-GEN-025 的历史实施与测试回执，但不再是实时断点。v0.6.70 已发布，后置审计确认当前 workflow 业务 NO-GO；历史 Goal 授权已消费。当前实时断点为 `spec/INC_GEN_026_CHECKPOINT.md`。

## 当前结论

- 用户已在新 Session 通过 `/goal` 完整激活一次性实施目标；旧“仅文档/未授权”断点已被最新明确授权覆盖。
- 当前权威方案改为服务端 durable workflow run；浏览器只创建一次并展示状态。
- INC-GEN-024 v0.6.70 窄候选保留为诊断证据，结论为 `SUPERSEDED_NO_GO`，不得发布。
- R0-R5 已完成服务端权威workflow、schema42精确迁移、共享语义编译、原子准入/锁、容量reservation、投影恢复、浏览器薄客户端和Ark文字原响应GET恢复；package候选已改为0.6.70。R7唯一正式safe full已执行，原始结果永久保留为`1149/1154`，5项均由失败最小子集关闭且未运行第二次full。当前尚无commit/push/PR/tag/Release、生产写入、Provider POST、OSS写或新费用。

## 工作树身份

- 当前实现工作树：`/Users/mymy/Documents/unboundry-inc-gen-025-server-authoritative-2026-09-01`
- 分支：`codex/inc-gen-025-server-authoritative-group-run`
- 基线 HEAD：`74dc9d9307abee9169a2d2aefc4b01add96114c9`
- 基线生产/tag/main：`v0.6.69 / 74dc9d9307abee9169a2d2aefc4b01add96114c9`
- 由实时 `origin/main` 新建隔离 worktree；使用 sparse checkout 排除受保护文件，工作树中该文件不存在且从未读取或哈希。
- `v0.6.70` 本地/远端 tag 与 GitHub Release 均未占用。

## R0 实时证据

- 生产 `/api/version` 为 `0.6.69`；live/ready 正常，ready 报告 schema41、lease held、mutations accepted。
- 生产 current 为 `/opt/unboundry/releases/v0.6.69-inc-gen-023-20260901`；systemd active/running/enabled，检查时 `NRestarts=0`。
- 生产运行时 Node `22.23.2` / npm `10.9.8`；数据库 `/var/lib/unboundry/unboundry.sqlite` 只读核对 schema41、quick check通过、FK 0。
- 项目默认 Node `25.9.0` / npm `11.12.1`；safe full与不可变构建继续走 Node `22.23.1` / npm `10.9.8`兼容通道。
- 目标身份冻结为 Canvas `3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`、group `group-fe8ea3c2-981d-4377-80e7-33aef9d38f35`、11 executable nodes、24 intra-group edges、7 text/3 image/1 video；无独立 Audio 节点，音频验收取视频音轨。2026-09-01再次只读核对生产graph revision 107：组内共12个子节点，其中1个3,573,146-byte PNG为非执行ready输入。

## R1-R5 实现与定向证据

- schema42新增`workflow_runs/workflow_run_nodes/workflow_run_locks/media_capacity_reservations`；schema41→42 dry-run/apply及精确合同测试通过，旧runtime仍拒绝新schema。
- 服务端冻结Canvas语义、活动模型revision与输入引用；transaction内复核graph revision，锁定全部相关节点/边，普通单节点准入与项目/素材删除在同一数据库边界fail-closed。
- runner复用现有generation task、Provider attempt、media publication、runtime lease和30秒恢复sweep；无第二scheduler。停止只取消未来节点，accepted原任务继续收口。
- Ark文字POST使用`store:true`并先持久化`resp_`编号；崩溃后只GET原响应。workflow文字禁用Ark Files ancillary POST，保证强工作流每个逻辑节点至多一个outbound Provider POST；目标初始PNG低于10MiB阈值，目标计划上限精确为11。
- projection不决定node success/下游，失败由既有sweep独立重试；浏览器只create/list/get/stop，关闭页面不取消服务端run，旧checkpoint只隔离不再调度Provider。
- 当前定向最终证据：TypeScript、architecture `907 runtime / 251 type`、source coverage `491 stable / 444 TypeScript / 47 JavaScript / 32 operational`与diff-check通过；m103 `10/10`、m22 `44/44`、m10 `17/17`、m44 `8/8`、m87 `8/8`、m81 `42/42`、m93 `7/7`、m66 `28/28`、m99 `19/19`、m88 `38/38`、m101 `4/4`、m102 `30/30`通过。测试库存为`123 specs / 1154 tests`，当前最终定向结果失败/重试/跳过/reportErrors均为0，4173与生产均未触碰。
- 定向验证曾发现并已关闭两处直接回归：schema42新增表未纳入m10精确逻辑指纹分母；m44 Ark `store:true`成功fixture缺少`resp_`编号。均先复现、做最小修复并复验对应spec为全绿。
- 唯一正式safe full执行了`123 specs / 1154 tests`，原始`1149 PASS / 5 FAIL`，retries/skipped/blocked/reportErrors均0，源码快照`b0da2efc…ad60`及4173监听均不变。5项为：m2未改产品代码的富文本时序波动1项；m38当前版本文档旧值1项；m92当前schema attestation旧值2项；m57同步relay结果不明仍按旧failed状态断言1项。没有第二次full。
- 只按失败与共享变更最小子集关闭：m2 `8/8`；m38 `18/18`；m92 `2/2`；m57在补齐`recovering + no providerTaskId`与attempt `outcome-unknown`同事务围栏后`17/17`；共享task store直接依赖m5 `31/31`。这些关闭轮次failed/retries/skipped/blocked/reportErrors均0，最终source/snapshot`3c5be49b…ad24`、4173不变。
- 同一独立Reviewer最终增量只读覆盖11文件（9 tracked 34 hunks+2 untracked全文），并盘点当前整体72文件（57 tracked+15 untracked）、299 tracked hunks；结果不明task/attempt/event原子事务、accepted/response-received不误改、m57重开与零重提、m92真实bridge→schema42→final runtime/持久化链和治理文档均通过，结论`P0=0/P1=0/P2=0/GO`。受保护文件未读取、未哈希、未接触。
- 主线程与唯一独立只读Reviewer已覆盖当前`67 changed files`（`52 tracked + 15 untracked`）、`277 tracked diff hunks + 15 untracked全文`，并覆盖workflow→generation→目标3个Provider/model分支→media→projection→client、schema/backup/rollback调用链和54项Matrix。Reviewer发现的确定性admission错误被误报为已提交500这一P2已修复：只有明确的post-commit handoff失败进入可核对500，workflow lock等未提交错误继续走精确409；m5 `31/31`与m103 `10/10`复验通过。同一Reviewer对最终增量复审结论为`P0=0/P1=0/P2=0/GO`，受保护文件未读取、未哈希、未接触。

## 当前权威文件

1. `spec/INC_GEN_025_CHECKPOINT.md`
2. `spec/INC_GEN_025_SERVER_AUTHORITATIVE_GROUP_RUN_PLAN_2026-09-01.md`
3. `spec/INC_GEN_025_ACCEPTANCE_MATRIX_2026-09-01.md`
4. `spec/INC_GEN_025_ONE_SHOT_GOAL_PROMPT_2026-09-01.md`（仅当用户在新Session完整粘贴时才激活Goal）
5. `spec/UNBOUNDRY_CURRENT_STATE.md`
6. `AGENTS.md`
7. `上线规矩.md`
8. `TASKS.md` 当前区块

INC-GEN-024 Plan/Matrix/Checkpoint 从当前方案降为历史诊断证据，不得当成发布授权。

## 冻结架构决策

- server-authoritative immutable run plan；当前run不再读取可变Canvas决定语义。
- workflow只拥有编排/task link/projection/reservation，不复制generation/provider/media状态机。
- generation task + durable publication决定node success；Canvas projection最终一致，不阻塞下游。
- shared pure semantic compiler；HTTP和runner共用内部generation admission service。
- media域拥有整组容量estimate/reservation/recheck/release；付费POST前fail-closed。
- deterministic idempotency key + DB atomic claim；crash/restart只核对同一task。
- 复用现有runtime role/startup recovery/shutdown drain；不引入微服务、MQ、Redis/Kafka、第二scheduler或SSE。
- same group/overlap互斥，disjoint group保留并行；projection按Canvas串行。
- CNY300仅为未来真实验收门，不做产品级预算系统；统计全部outbound Provider POST。

## 当前授权与下一动作

- 用户已明确确认目标版本 `v0.6.70`，并一次性授权实现、Review、唯一 formal safe full、GitHub/CI/merge/tag/Release、冻结副本演练、成对生产迁移/回退和最终切换。
- 只有全部自动门通过后，才可在普通 Chrome 既有登录态对指定 Canvas/group 点击一次；预算不超过 CNY 300 等值，全部 outbound Provider POST 总数不超过 11，每个逻辑节点最多一次原始 POST，结果不明只核对原任务。
- R7唯一formal safe full、失败最小子集关闭及同一独立Reviewer增量GO均已完成；原始结果不得改写为全绿，也不得运行第二次full。当前进入R8 GitHub/不可变发布，生产迁移或真实点击仍须等待各自前置门。

## 永久红线

`spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json` 禁止读取、哈希、修改、暂存、移动或删除。
