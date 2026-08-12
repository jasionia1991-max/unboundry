# 无央 Unboundry

TapNow 风格 AI 画布（本地优先，已发布到生产服务器 `canvas.mymy.ltd`，当前线上 v0.5.1）。

当前施工状态：`REM-000 = PASS / REM-001、REM-002、REM-003、REM-004、REM-005、REM-006、REM-007、REM-008、REM-009A = USER_REVIEW / REM-009B = IN_PROGRESS`。REM-008 离线候选已收口登录与 SSE 有界准入、受控请求体和流式媒体处理、保留 500MiB 合同的磁盘/并发预算、ffmpeg/ffprobe 有界队列与进程组终止、Provider 结果及 OSS 的 DNS pinning/私网/IPv6/重定向防护、安全响应头、依赖告警、密码重置与存储修复脚本，以及工作区按需包、历史分页/懒加载和缩略图缓存/URL 生命周期。测试运行于功能提交前、HEAD `d63af1224bbadfab00cdd65256c16afaf4195fa1` 下冻结脏工作树 `79625ac9768e99351f00190389a76e19945355405a3235608f219afd4d2d81be`：核心 15-spec `repeat=3` 共 `588/588`、安全全量 `111/111 spec、891/891 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=492`；Node `22.23.1` / npm `10.9.8`；源码 294（TS/TSX `277/277`、JS/MJS `17/17`），12 个运维脚本为 9 个行为验证 + 3 个哈希冻结，4173 listener 前后均为 `09d55bc82aab1e1f04aae60397395befd6d17c41b5b2622bcde7c4c7b1b8ec2`。功能提交 `ff9a2adbb9ba93c9646935b2b22b318fb5503f21` 包含相同功能文件，未在该 commit 后或文档后树重跑。这不是用户 PASS、真实 500MiB 上传、真实数据/Provider/OSS、浏览器 TLS/生产安全头、生产迁移、发布许可或 REM-011 最终三轮。资源/SSE/进程/出站合同只在单一 active process 内成立，不是跨进程或多机配额；磁盘 reservation 不是 OS 全局配额，运维修复也不声称文件系统与 SQLite 的跨介质崩溃原子性，F-023 仍归 REM-010。`mirror-oss` / `backup-to-oss` 继续哈希冻结，F-020/F-024 与最终双向数据格式兼容仍归 REM-009B，F-022 归 REM-010。package `0.5.1`、线上 v0.5.1/schema 37 未变，schema 39 仅离线候选，production HOLD；真实数据、4173、真实 Provider/OSS、生产连接、push、tag、PR 与发布仍禁止。

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
