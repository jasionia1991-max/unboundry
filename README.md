# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001、REM-002、REM-003、REM-004、REM-005、REM-006、REM-007、REM-009A = USER_REVIEW / REM-008 = IN_PROGRESS`。REM-007 离线候选已修复 F-016/F-017B/F-018：四类节点以持久 `*GenerationOwnershipKey`、exact task/idempotency GET 和完整模型/参数快照绑定 active task；新任务期间保留旧预览。对仍匹配当前 ownership 的 active task，success/failed/cancelled 节点状态先持久并获得 canvas ACK，再按 taskId 清 submission intent；preflight 拒绝保留 intent；恢复调用缺失或不同于已有 raw ownership proof 时不认领并保留。显式输入或新 ownership 会撤销/替换旧 intent；legacy signature 无法升级、恢复路径确认持久绑定已失效、提交前 exact GET 命中 cancelled，以及正式付费任务 POST 的确定性 4xx 等不可复用分支，按对应 guard 清理 intent。正式付费任务 POST 及其响应体共用 deadline；该 POST 出现网络/status 0/5xx 未知结果时只按原 key exact GET reconcile，绝不重发付费任务 POST。retry 先保存取得 fresh revision，再由服务端最终事务核验 live canvas/node/kind/taskId/inputKey/attempt/updatedAt；localStorage 写失败在付费前 fail-closed。Workspace create/rename/delete、CanvasShell create/clone/delete 与 UpdateNotice reload-after-save 各自具 in-flight fence 和显式失败处理；Workspace DELETE 与删除后核验所用列表 GET 具 deadline（列表覆盖 response body）。Workspace 删除向 ConfirmDialog 传入 busy，ConfirmDialog 负责 focus/Escape/a11y；CanvasShell 删除依靠外层 fence。测试运行于功能提交前、HEAD `26ff9396194499365c79e5bc85238631ed44ef7a` 下 403-file 冻结脏工作树 `ce7b4856b00b3ab12ee4853ece0b07b01dec86619bbca7865daa4edb659cc957`：adjacency 12-spec `142/142`、target 10-spec `255/255`、核心 8-spec `repeat=3` 共 `606/606`、安全全量 `109/109 spec、841/841 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=477`；Node `22.23.1` / npm `10.9.8`；源码 286（TS/TSX `270/270`、JS/MJS `16/16`），11 个运维脚本为 6 个行为验证 + 5 个哈希冻结，4173 listener 前后均为 `91689b3fefccfb3fe32ffc44e2b10a3146976b76d497183f56f7457924a7e219`。功能提交 `138f7ff0f9481e73355fbd9a9fd2c548ee9cee1a` 包含相同功能文件，未在该 commit 后或文档后树重跑。这不是用户 PASS、真实 Mureka/真实数据/真实 Provider/OSS 验证或发布许可；真实 Mureka 继续 PARTIAL/暂停。结论仅在单一 active process 前提下成立，F-023 仍归 REM-010，也不宣称跨标签分布式互斥。REM-007 无 schema 迁移；新增 ownership 是可选 canvas JSON/localStorage 字段，旧数据兼容与最终数据格式矩阵仍归 REM-009B。package `0.5.1`、线上 v0.5.1/schema 37 未变，schema 39 仅离线候选，production HOLD；真实数据、4173、真实 Provider/OSS、生产连接、push、tag、PR 与发布仍禁止。

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
