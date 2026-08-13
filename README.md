# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001～REM-011 = USER_REVIEW`（REM-011 仅指已授权的离线工程部分）。最终 fixed clean offline candidate 为 HEAD `8b639ffe6c5f091c51e1914f2e2c18edf9333d90`、tree `219c4df072426cfe92f33dc4045f021064972e9c`，共 429 个跟踪文件，source/snapshot SHA-256 `652b946441ee46e43bcbfbfc635dfc5aaacf5e640529ebec5bc7bd34c798dbb0`。该候选的 G0～G6 离线门已全绿，G7 仍等待用户审阅证据、确认正式版本号，并在之后独立确认允许发布；production 继续 HOLD。

历史 REM-009B 证据保持不变：合成富数据、媒体、密钥和假 OSS 上完成格式 2 备份/恢复、one-shot exact-v37→schema39 迁移、故障恢复、假 OSS 重建及 exact-v0.5.1→current bridge→schema39 数据格式与安全拒绝边界矩阵；当时同内容功能树核心三轮 `399/399`、安全全量 `114/114 spec、912/912 PASS`，源码 `303 = 283 TS/TSX + 20 JS/MJS`、运维脚本 `15 = 12 行为 + 3 冻结`。该历史证据不是当前 REM-010 动态结果、用户 PASS、真实数据/Provider/OSS、生产迁移或发布证明。

`1e96e26f…` 是 m92 fixture 窄修复后、上一轮六文档同步前脏功能树的历史 tested source 指纹；该 full 不绑定 commit，也不是 fixed clean/formal candidate。

2026-08-13 用户随后在隔离手工验收页发现两个历史自动检查缺口：工作空间的虚拟 `default` 卡片错误进入 `/canvas/default` 后回跳，以及 `Text → Video` 已有有效文字仍被强制要求重复填写 Video 本节点 Prompt。当前候选已统一把默认卡片导向规范 `/canvas`，并规定 Video 的最终 Prompt 可由已就绪上游 Text、Video 本节点 Prompt或两者合并提供；两者都为空时仍阻止。m11+m30 经唯一安全入口定向 `17/17 PASS`，任务/付费 Provider 请求为 0。该定向结果绑定修复后、文档同步前源码快照 `f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be`。用户随后在端口 58352 的同一隔离实页明确确认两项修改均通过，`CANVAS-019 / INPUT-005` 恢复为 `PASS`。

两项页面修复后的首轮 full 为 `930/931 PASS`，唯一失败是 m44 两个协作进程并发打开 current DB 时，竞争者把 reservation 正常创建写入或释放造成的 metadata 变化误判为篡改。产品并发协议已把合法状态严格区分为 `initializing / active / released`，继续对 stale、self-PID、malformed、unsafe、替换或非协作路径 fail-close；m91 在同一既有测试内加入创建前与释放窗口的确定性双进程回归，m44+m91 定向 `15/15 PASS`。随后 fresh full 在 Node `22.23.1` / npm `10.9.8` 下达到 `117/117 specs、931/931 PASS`，failed/skipped/retries/reportErrors/blocked 全 0，`deniedViteWildcardProbes=534`，builder operational `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file、文档同步前源码快照 `db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f`，前后不变；4173 listener 仍为 `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae`，suite cleaned、exit 0。

上述脏树单轮证据随后冻结为首个 clean candidate `b9b4691`，但其在后续压力运行中被真实 SQLite sidecar 交接竞态击穿，不再是有效候选。`8b639ffe6c5f091c51e1914f2e2c18edf9333d90` 以 held-reader 窄修复取代：完整 WAL/SHM 对（包括零字节 WAL）使用普通只读检查，并将 inspection 读事务保持到新 writer 取得 `BEGIN IMMEDIATE`、完成 identity/sidecar/schema/digest 复核后再释放；symlink、hardlink、unsafe mode、orphan sidecar 和 journal 仍立即 fail-close。m91 对 hot-WAL 和 zero-WAL 的旧最后连接关闭均有确定性回归。

固定候选完成三个独立 fresh full：每轮 `117/117 specs、931/931 PASS`，三轮合计 `2793/2793`；每轮 failed/skipped/retries/reportErrors/blocked 均为 0、`deniedViteWildcardProbes=534`、builder `1/3/1/0`，合计 builder `3/9/3/0`，日志 SHA-256 前缀依次为 `c5a8da15… / 06aed03d… / edbb4550…`。关键竞态包另外两轮均为 `5 specs × repeat 10 = 570/570`，合计 `1140/1140`，每轮异常计数全 0、`deniedViteWildcardProbes=1980`，各关键场景累计 20 次，日志 SHA-256 前缀为 `881023af… / edefe9ea…`。五轮均使用 Node `22.23.1` / npm `10.9.8`，snapshot 前后不变，4173 listener `dfd25fc2…` 前后不变，suite cleaned、exit 0。

production HOLD：REM-010 与 REM-011 仅离线工程部分进入 `USER_REVIEW`，不是用户 PASS、正式 release 或生产验证。package 仍为 `0.5.1`，线上 v0.5.1/schema 37 未变，schema 39 仅离线候选；原生产主机同版本/模块仍未核验，G7 仍缺正式版本号和之后独立的发布授权。4173、真实 Provider/OSS、原生产连接/SSH、push、tag、PR 和发布仍禁止。同 UID 非协作进程仍可替换极窄 current-database-open reservation 路径，这是已声明残余边界。一次独立只读审计曾越权对 `app/data` 执行 immutable 聚合查询；结果未纳入证据，写入/外部请求为 0，之后未再访问。

**新接手的人（含 AI agent）必须按顺序阅读：**

1. `AGENTS.md` —— 项目级施工红线与上下文恢复协议
2. `README.md`（本页）—— 项目身份与统一阅读入口
3. `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md` —— 用户已确认的全量修复、测试、发布和回滚权威施工合同
4. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md` —— 当前 REM 状态、授权边界和下一步硬停止点
5. `spec/UNBOUNDRY_HANDOFF_2026-08-09.md` —— 快速上手、环境、红线与历史现状
6. `TASKS.md` —— 工作日志与当前 REM 状态
7. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` —— 逐项验收状态

发生冲突时，以用户最新明确指令为最高权威；无法从仓库文档、Git 和当前证据恢复一致状态时必须停止，不得凭记忆或压缩摘要继续。

仓库根：`/Users/mymy/Documents/unboundry/app`
