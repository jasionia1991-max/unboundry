> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# INC-GEN-023 Checkpoint

状态：`V0_6_68_DEPLOYED / V0_6_69_CANDIDATE_REVIEW_GO / REAL_GROUP_NOT_CLICKED / RELEASE_AUTHORIZED_NOT_CONSUMED`

- 工作树：`/Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28`。
- 分支：`codex/inc-gen-023-server-terminal-detach`；基线 `origin/main@6f6cb4478c12e95e4e4d4ff5dd40dc748ab96ca2`。
- 生产 v0.6.68/schema41 已部署且 service active/enabled、NRestarts0；tag、Release、exact-tag fresh Linux build、冻结 source/restore 与静态文件门均通过。
- 目标 Canvas：`3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`；目标 group：`group-fe8ea3c2-981d-4377-80e7-33aef9d38f35`。
- 原任务 `8b6e5b71-c45f-485d-a6a7-7f83dc7be3f1` 已通过原任务的无费用 abandon 收口为 cancelled；没有新 task/attempt/Provider POST。
- v0.6.68 客户端/服务端 identity 合同已一致，但浏览器本地 checkpoint/active lease 使客户端 reconciler 持续 defer，未发出新 `generation-terminal-detach` POST；Canvas 仍保留旧 task/run/ownership/input binding。
- 真实整组点击 0/1，Provider POST 0/11，费用 0；不得提前点击。
- 当前修复边界：服务端 active recovery sweep 对精确 allowlist owner/canvas 做 failed/cancelled terminal detach；不处理 success，不创建任何生成或媒体账本记录。
- v0.6.69候选实现已完成：独立terminal-only定时器调用allowlist-scoped服务端解绑；failed/cancelled精确绑定单事务/CAS清除，success、非终态、非allowlist和task binding不匹配保持不变；重复执行幂等。
- safe m85 `28/28`、首次m38 `18/18`通过；generation task/event/admission/attempt、media、publication账本逐项不变，source/snapshot一致，4173 unchanged。
- 首次独立终审覆盖20/20 tracked文件、44/44 hunks，结论`P0=0 / P1=1 / P2=1 / NO-GO`：P1为active task为0时启动入口未安装sweep，P2为根验收矩阵过期。两项均已修复；新增真实Vite启动回归证明active0+allowlist仍自动解绑且Provider请求0，m81 `42/42 PASS`、m85 `28/28 PASS`，测试库存1142；safe preflight的TypeScript、架构、source coverage、production build与4173隔离门通过。
- 第二次独立复审覆盖20/20 tracked文件、47/47 hunks，发现allowlist空闲启动仍会打开全局taskStore并可能修改其他Canvas outcome-unknown任务的P1。现已把terminal detach与generation recovery完全分离；新增跨Canvas outcome-unknown任务、attempt和event逐项不变断言。首次测试夹具误用不存在的attempt `updated_at`列而`41/42`，修正夹具后m81 `42/42 PASS`。
- 第三次独立复审覆盖19/19 tracked文件、43/43 hunks，确认前述P1关闭，同时发现terminal-only timer未纳入runtime lease/drain，以及可恢复的failed accepted任务可能被提前解绑两个P1和方案注释过期P2。现已将timer回调纳入`runDetached`、teardown在active lease释放前清理全部generation timers，并收紧SQL排除持有provider task id或未决attempt的failed任务；m85增加accepted恢复竞态反例，m93增加timer teardown断言。三spec联合首轮m81 `42/42`、m85 `28/28`通过，m93测试seam被safe全局disable挡住而`4/7`；仅修正test-only强制启动seam后m93 `7/7 PASS`。最终功能树source/snapshot `3ae7c560161d6d9025e404f15a53354d8ff488a0054da902b2adae1ffe64bc5d`、4173 unchanged。
- 第四轮最终增量复审覆盖20/20 tracked文件、52/52 hunks，确认全部既有P1/P2关闭且无新增问题，结论`P0=0 / P1=0 / P2=0 / GO`。最终治理m38 `18/18 PASS`，文档树source/snapshot `fa935674e8a78f874f9d8d57fd74d05f6f9e50acd0e8d4ff3cd6bcee6e6a5a78`、4173 unchanged。
- 用户已明确发送`确认版本 v0.6.69，并允许发布 v0.6.69`；授权尚未消费。候选已冻结且独立复审GO，可以执行commit/push/PR/tag/Release/生产切换。
- 用户未跟踪受保护文件 `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json` 不读取、不修改、不暂存、不移动、不删除。
