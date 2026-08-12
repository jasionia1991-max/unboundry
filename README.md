# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001～REM-009B = USER_REVIEW / REM-010 = IN_PROGRESS / REM-011 = NOT_STARTED`。REM-010 已把 runtime role、跨进程 active lease、请求/SSE/generation drain 接入应用生命周期并由 m81/m93 覆盖；Darwin 合成环境的不可变 builder/rehearsal 与静态 nginx/systemd 运维合同已实现，legacy `deploy.mjs` 继续立即 fail-close。当前发现清单为 `117 specs / 931 tests`，源码覆盖为 `309 = 286 TS/TSX + 23 JS/MJS`，运维脚本为 `18 = 15 行为验证 + 3 哈希冻结`。此前修复后的 targeted m81/m93/m94/m95/m96 为 `49/49 PASS`；上一阶段第一轮 full 为 `930/931 PASS`，唯一失败是 m92 bridge fixture 把 `UNBOUNDRY_MAINTENANCE_MODE` 设为空串，严格 runtime role 合同按设计返回 `RUNTIME_ROLE_INVALID`。仅将 fixture 改为 `UNBOUNDRY_RUNTIME_ROLE=active`、maintenance `0`，并在 m93 增补空串拒绝回归后，m92+m93 targeted `9/9 PASS`，fresh full `117/117 specs、931/931 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0，`deniedViteWildcardProbes=534`。builder operational 为 `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。该历史证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file tested source snapshot，SHA-256 `1e96e26feb6334611e9c2205e22d25c6eacbac54b224f44bd3b26bdcfd6f030b` 前后不变；4173 listener 前后均为 `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae`，suite cleaned、exit 0。历史 Docker Ubuntu 子门与第二台非生产 Ubuntu 验证机的 builder/ops 证据继续有效；其 `formalReleaseCommit=false`，不是正式 release commit、原生产主机验证或发布，REM-010 仍未完成/未验收。

历史 REM-009B 证据保持不变：合成富数据、媒体、密钥和假 OSS 上完成格式 2 备份/恢复、one-shot exact-v37→schema39 迁移、故障恢复、假 OSS 重建及 exact-v0.5.1→current bridge→schema39 数据格式与安全拒绝边界矩阵；当时同内容功能树核心三轮 `399/399`、安全全量 `114/114 spec、912/912 PASS`，源码 `303 = 283 TS/TSX + 20 JS/MJS`、运维脚本 `15 = 12 行为 + 3 冻结`。该历史证据不是当前 REM-010 动态结果、用户 PASS、真实数据/Provider/OSS、生产迁移或发布证明。

`1e96e26f…` 是 m92 fixture 窄修复后、上一轮六文档同步前脏功能树的历史 tested source 指纹；该 full 不绑定 commit，也不是 fixed clean/formal candidate。

2026-08-13 用户随后在隔离手工验收页发现两个历史自动检查缺口：工作空间的虚拟 `default` 卡片错误进入 `/canvas/default` 后回跳，以及 `Text → Video` 已有有效文字仍被强制要求重复填写 Video 本节点 Prompt。当前候选已统一把默认卡片导向规范 `/canvas`，并规定 Video 的最终 Prompt 可由已就绪上游 Text、Video 本节点 Prompt或两者合并提供；两者都为空时仍阻止。m11+m30 经唯一安全入口定向 `17/17 PASS`，任务/付费 Provider 请求为 0。该定向结果绑定修复后、文档同步前源码快照 `f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be`。用户随后在端口 58352 的同一隔离实页明确确认两项修改均通过，`CANVAS-019 / INPUT-005` 恢复为 `PASS`。

两项页面修复后的首轮 full 为 `930/931 PASS`，唯一失败是 m44 两个协作进程并发打开 current DB 时，竞争者把 reservation 正常创建写入或释放造成的 metadata 变化误判为篡改。产品并发协议已把合法状态严格区分为 `initializing / active / released`，继续对 stale、self-PID、malformed、unsafe、替换或非协作路径 fail-close；m91 在同一既有测试内加入创建前与释放窗口的确定性双进程回归，m44+m91 定向 `15/15 PASS`。随后 fresh full 在 Node `22.23.1` / npm `10.9.8` 下达到 `117/117 specs、931/931 PASS`，failed/skipped/retries/reportErrors/blocked 全 0，`deniedViteWildcardProbes=534`，builder operational `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file、文档同步前源码快照 `db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f`，前后不变；4173 listener 仍为 `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae`，suite cleaned、exit 0。

production HOLD：两项页面修复、current-open reservation 并发修复、定向 `15/15` 与当前脏功能树单轮 full `931/931` 已完成。仍缺原生产主机同版本/模块核验、最终固定 candidate clean SHA 的 G0～G6、REM-011 三个全新环境、正式版本号和发布授权。本轮 full 不是 REM-011、固定正式候选、原生产验证或发布证明。package `0.5.1`、线上 v0.5.1/schema 37 未变，schema 39 仅离线候选；仅第二台验证机 SSH 获本次明确授权，4173、真实 Provider/OSS、原生产连接/SSH、push、tag、PR 和发布仍禁止。同 UID 非协作进程仍可替换极窄 current-database-open reservation 路径，这是已声明残余边界。一次独立只读审计曾越权对 `app/data` 执行 immutable 聚合查询；结果未纳入证据，写入/外部请求为 0，之后未再访问。

**新接手的人（含 AI agent）必须按顺序阅读：**

1. `AGENTS.md` —— 项目级施工红线与上下文恢复协议
2. `README.md`（本页）—— 项目身份与统一阅读入口
3. `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md` —— 用户已确认的全量修复、测试、发布和回滚权威施工合同
4. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md` —— 当前唯一施工项、授权边界和下一步硬停止点
5. `spec/UNBOUNDRY_HANDOFF_2026-08-09.md` —— 快速上手、环境、红线与历史现状
6. `TASKS.md` —— 工作日志与当前 REM 状态
7. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` —— 逐项验收状态

发生冲突时，以用户最新明确指令为最高权威；无法从仓库文档、Git 和当前证据恢复一致状态时必须停止，不得凭记忆或压缩摘要继续。

仓库根：`/Users/mymy/Documents/unboundry/app`
