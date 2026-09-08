# Unboundry 当前状态

文档角色：`CURRENT_STATE`。当前授权、进度和验收见[当前任务](../TASKS.md)；本页只维护现状与边界。发布身份、生产观测和回退数据见[发布回执](V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json)。

## 现在怎么样

正式站仍为 **v0.7.16 / schema43**；本地候选为 **v0.7.17**。V3/V4 本地修复、撤销演练、相关回归和三项用户验收均完成，V4 第1/2/3项已获 `USER_PASS`，尚未切换生产。维护功能默认关闭。

本地候选已完成：持久维护记录和严格 admin、原结果受保护找回、四节点进展、重启接续、单节点补跑及第3项视频交互修复。`quiesced-active-preservation` 已实现，用于停服且持有既有 active lease 时保留一个精确旧 task/attempt 的未知事实；它保留原 task、attempt、事件和付费围栏，不改终态，不替代平台证据。

verification-72 安全入口对 m10/m93 共 29/29 通过（m10 21/21、m93 8/8），发现清单 134 specs/1368 tests；类型、架构、构建、隔离、动态 loopback 和 source coverage 前置通过，外网尝试为 0，4173 未变化。证据见[verification-72 回执](../node-recovery-v0717-release-ops-20260908/verification-72-m10-m93.json)。此前 95 项发布增量检查和 71 号存储层演练继续有效，范围不扩大；本轮独立后端复审无 P0/P1，不等于全仓安全审计。

## 正式站事实

2026-09-09 只读核对显示正式站仍 v0.7.16，唯一旧 task `9c93f308-bb77-4935-a4e3-37dd72e6cd28` 保持 `recovering/AUTOMATIC_RESULT_RECOVERY`，attempt 为 `outcome-unknown` 且无平台 task ID。原始 Provider code/msg 未保存；充值、`finished_at`、假回执或维护 phase 都不能证明未受理、未扣费或可取消。该任务未解锁、未改码、未重跑，正式站无本轮生产写入或 Provider 请求。

## 发布与未决边界

- v0.7.17 已获发布授权，但 ops 切换/回退脚本独立复审仍在完成。
- 完整 Linux 真实安装包、真实停服备份、systemd 切换和线上回退尚未执行；本地测试、合成数据和撤销演练不能替代这些门。
- 通过精确身份、CI/tag、停服保留式备份、verify/fresh restore、回退和文档回执后才可上线；失败保持旧站和 CURRENT。不得用 SQL 或清理旧未知任务骗过备份门。
- 每日自动备份及视频/音频空工具按钮仍按原状态暂缓；正式启用维护入口前仍需明确负责人。

## 环境入口

- 工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`，分支 `codex/v0717-node-recovery-release`，本轮冻结 HEAD `38709d2b878e8546daa06e9ea20d2a82a2ae91b8`，保留 dirty。
- GitHub：`jasionia1991-max/unboundry`；正式 current 为 `/opt/unboundry/releases/v0.7.16-status-query-20260907`。后续治理提交不改变已发布 v0.7.16 身份。

## 备份与回退约束

用户已同意本次 `quiesced-active-preservation` 规则：冻结生成并停服后，由同一既有 runtime lease 持有 secret/DB 锁，核验停服证明、冻结审计、schema43、logical SHA、媒体/secret 和无额外活动边界；签名清单明确保留未结算请求，不标成 `locked-exact` 或 `finalCandidate`。精确旧 v0.7.15 回退须保留 CURRENT、重新验证最新一致备份和恢复；失败保持维护，不能自动切回问题包或更老版本。

默认阅读[工作规则](../AGENTS.md)、本页和[当前任务](../TASKS.md)，再按主题读取[生成架构合同](UNBOUNDRY_GENERATION_ARCHITECTURE.md)、[发布手册](../RELEASE_RUNBOOK.md)、[备份合同](../ops/production/README.md)及[恢复方案第10节](VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。
