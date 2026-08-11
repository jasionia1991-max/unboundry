# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001、REM-002、REM-003、REM-004、REM-009A = USER_REVIEW / REM-005 = IN_PROGRESS`。REM-004 已完成原子媒体所有权预留、本地/假 OSS 分阶段发布、pending/ready/failed 与持久补偿恢复、ready-only 消费、权威媒体尺寸、删除 intent、只读完整性报告和客户端同步 adoption ACK；只关闭 F-004、F-036 与 F-005 的媒体发布子范围，Provider 付费/幂等继续归 REM-005，账号删除完整合同继续归 REM-006。冻结源码指纹 `f6974d…` 的专项 `158/158`、核心三轮 `474/474`、安全全量 `109/109 spec、762/762 PASS` 均通过，异常计数为 0；功能内容提交为 `9f1019e5686ccce4f646b54a2be6ccd5ab4864d0`。schema 38 仅为离线候选；线上 v0.5.1/schema 37 未变，生产发布保持 HOLD，REM-009B/010 的迁移、桥梁和回滚硬门尚未通过。本 Goal 永久排除真实数据、4173、真实 Provider/OSS、生产连接、push、tag、PR 与发布。

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
