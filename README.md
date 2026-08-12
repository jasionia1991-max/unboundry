# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001～REM-009B = USER_REVIEW / REM-010 = IN_PROGRESS / REM-011 = NOT_STARTED`。REM-009B 已在合成富数据、媒体、密钥和假 OSS 上完成最终候选格式 2 备份、验签、恢复、one-shot exact-v37→schema39 迁移、写锁内来源复核、中间故障恢复、假 OSS 重建及冻结 exact-v0.5.1→current bridge→schema39 数据格式与安全拒绝边界矩阵（exact v0.5.1 对 schema39 安全拒绝，迁移后不能回滚到 v0.5.1）；功能提交为 `9a158a92563814791fefb8d4e6c5531eca610d78`。测试运行于提交前同内容功能树，源码 SHA-256 `7cf46804f952e580e9574a08a93f42ad53c051d4fcd5f2705691f82c8330326b`：核心 8-spec 三轮 `399/399`（deniedViteWildcardProbes `567`），安全全量 `114/114 spec、912/912 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0（full deniedViteWildcardProbes `516`）；Node `22.23.1` / npm `10.9.8`；源码 303（TS/TSX `283/283`、JS/MJS `20/20`），15 个运维脚本进入行为验证或哈希冻结清单；隔离 snapshot 未变，4173 listener 前后均为 `1be6a5d9061f3be72e5d45a0acf7cb70f5fe86ac645fceff60138b4b718d35dd`。功能提交后及本文档树未重跑。该状态仅代表自动实现与自动证据完成、等待用户复核，不是用户 PASS，也不含真实数据/真实 Provider/真实 OSS/生产迁移或发布。REM-010 当前仅有尚未接入服务路径的 `runtimeRole` leaf/专项合同与 legacy `deploy.mjs` fail-close 基础；不可变 release、切换与回滚尚未实现验收。同 UID 非协作进程仍可替换极窄 current-database-open reservation 路径，这是已声明残余边界。一次独立只读审计曾越权对 `app/data` 执行 immutable 聚合查询；结果未纳入证据，写入/外部请求为 0，之后未再访问。package `0.5.1`、线上 v0.5.1/schema 37 未变，schema 39 仅离线候选，production HOLD；4173、真实 Provider/OSS、生产连接、push、tag、PR、正式版本号与发布仍禁止。

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
