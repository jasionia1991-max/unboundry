# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001、REM-002、REM-003、REM-004、REM-005、REM-009A = USER_REVIEW / REM-006 = IN_PROGRESS`。REM-005 已以 schema 39 离线候选完成 owner-scoped 幂等、原子 admission/任务插入、Provider 最终付费闸、凭据 epoch、未知结果保护、请求 deadline、持久队列恢复和显式 abandon；关闭 F-008/F-009/F-010，并与 REM-004 一起关闭 F-005，F-014 只关闭 deadline 子范围。测试运行于功能提交前、HEAD `2beaec585d2d33a11341b98349b31b89b41d3a62` 的冻结脏工作树 `6a1363df8a6977e996db4b9e45aa823a89e28d6fe3955d85d6ea0ca9b315fcf9`：m81 `23/23`、核心 6-spec 三轮 `207/207`、安全全量 `109/109 spec、790/790 PASS`，异常计数为 0；源码 285（TS/TSX `269/269`、JS/MJS `16/16`）。功能提交 `b3ceba04b5ddcf781dd58ce355be0e0f7665450e` 包含相同功能文件内容；未在该 commit 后或文档后树重跑。线上 v0.5.1/schema 37 未变，生产发布保持 HOLD；REM-009B/010 仍须完成 one-shot 迁移、v37/v39 bridge、回滚矩阵、唯一 active worker 与 F-023，并在迁移前冻结新生成、排空活动任务且自最后一次可能 Provider admission 起至少 60 秒。本 Goal 永久排除真实数据、4173、真实 Provider/OSS、生产连接、push、tag、PR 与发布。

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
