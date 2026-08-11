# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001、REM-002、REM-003、REM-004、REM-005、REM-006、REM-009A = USER_REVIEW / REM-007 = IN_PROGRESS`。REM-006 离线候选已按 `PERM-011 / KEY-008 / AUTH-006` 收口账号删除可重试 saga、公共模板与必要媒体转交、权限额外授予集、账号凭据、Provider/catalog 与存储文档变更的 actor fence/审计线性化；F-006/F-007/F-017A/F-033 已在离线候选修复，F-032 继续遵守旧合同：删除相关旧审计，只保留唯一 `delete_user` 记录。测试运行于功能提交前、HEAD `731b984d7e32a0b9ee648c0e7fa1bd49e59deb14` 下 403-file 冻结脏工作树 `9873952efd5a7b1f0d84d65698be79069a89aae47ab25ff277dabf6b4ef2016d`：14-spec 定向 `112/112`、核心 7-spec `repeat=3` 共 `222/222`、安全全量 `109/109 spec、804/804 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，`deniedViteWildcardProbes=477`；源码 286（TS/TSX `270/270`、JS/MJS `16/16`），11 个运维脚本为 6 个行为验证 + 5 个哈希冻结，4173 listener 前后均为 `38911ab014a12dd3353ee0897359ebfb26f075144de1ce0b35e760f2df6dea3d`。功能提交 `67cc39302d756bc00bff7ac31e31de7a7f574574` 包含相同功能文件，未在该 commit 后或文档后树重跑。这不是用户 PASS、真实数据/真实 Provider/OSS 验证或发布许可；结论仅在单一 active process 前提下成立，F-023 仍归 REM-010，账号删除是持久 intent + 可重试 saga，文档/SQLite 变更也不宣称具有跨文件系统崩溃原子性。线上 v0.5.1/schema 37 未变，schema 39 仅离线候选，production HOLD；真实数据、4173、真实 Provider/OSS、生产连接、push、tag、PR 与发布仍禁止。

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
