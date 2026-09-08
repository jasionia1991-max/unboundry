# Unboundry 当前状态

文档角色：`CURRENT_STATE`。当前授权、进度和验收见[当前任务](../TASKS.md)；本页只维护现状与边界。发布身份、生产观测和回退数据见[发布回执](V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json)。

## 现在怎么样

**最近核验的生产是 v0.7.16 / schema43**；本地候选为 **v0.7.17**。V3/V4 本地修复、撤销演练、相关回归和三项用户验收均完成，V4 第1/2/3项已获 `USER_PASS`，尚未切换生产。维护功能默认关闭。生产技术验证与本地用户验收分开记录：v0.7.16 为 `PRODUCTION_TECHNICAL_PASS / PRODUCTION_USER_RECHECK`，V3/V4 为 `LOCAL_USER_PASS / NOT_DEPLOYED`。

本地候选已完成：持久维护记录和严格 admin、原结果受保护找回、四节点进展、重启接续、单节点补跑及第3项视频交互修复。`quiesced-active-preservation` 已实现，用于停服且持有既有 active lease 时保留一个精确旧 task/attempt 的未知事实；它保留原 task、attempt、事件和付费围栏，不改终态，不替代平台证据。

本地备份新模式29/29及独立窄复审通过，既有生成与UI有效证据保持原范围。候选已提交至[PR #173](https://github.com/jasionia1991-max/unboundry/pull/173)；2026-09-09本次CI因GitHub账号付款/额度限制未启动，发布停在合并前。精确进度、测试证据和阻断由[当前任务](../TASKS.md)维护。

当前代码包版本：**v0.7.17**（本地源码；正式站仍v0.7.16）
本地候选代码版本：**v0.7.17**（已授权，尚未上线）
生产观测日期：2026-09-09（只读核对）
当前产品验收标记：`CURRENT_V0_7_16_USER_RECHECK`

## 正式站事实

2026-09-09 只读核对显示正式站仍 v0.7.16，唯一旧 task `9c93f308-bb77-4935-a4e3-37dd72e6cd28` 保持 `recovering/AUTOMATIC_RESULT_RECOVERY`，attempt 为 `outcome-unknown` 且无平台 task ID。原始 Provider code/msg 未保存；充值、`finished_at`、假回执或维护 phase 都不能证明未受理、未扣费或可取消。该任务未解锁、未改码、未重跑，正式站无本轮生产写入或 Provider 请求。

## 发布与未决边界

- v0.7.17 已获发布授权；ops切换/回退脚本独立窄复审完成，直接阻断已修复，完整安装包演练和真实备份仍待执行。
- 完整 Linux 真实安装包、真实停服备份、systemd 切换和线上回退尚未执行；本地测试、合成数据和撤销演练不能替代这些门。
- 通过精确身份、CI/tag、停服保留式备份、verify/fresh restore、回退和文档回执后才可上线；失败保持旧站和 CURRENT。不得用 SQL 或清理旧未知任务骗过备份门。
- 每日自动备份及视频/音频空工具按钮仍按原状态暂缓；正式启用维护入口前仍需明确入口与负责人。
- v0.7.15模板、其他12项及图片“浏览全部”保持原用户通过记录；历史首次画布性能与维护更新通知仅保留原验证范围，未扩大为本次正式站重测。已暂停功能及依赖告警仍见[验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md)。

## 环境入口

- 工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`，分支 `codex/v0717-node-recovery-release`，发布基线为 `38709d2b878e8546daa06e9ea20d2a82a2ae91b8`，候选提交为 `c3d21e39c0ece8ac400b00345b5e2aed13199dbc`；实际dirty以Git核对为准。
- GitHub：`jasionia1991-max/unboundry`；正式 current 为 `/opt/unboundry/releases/v0.7.16-status-query-20260907`。后续治理提交不改变已发布 v0.7.16 身份。

## 备份与回退约束

用户已同意本次 `quiesced-active-preservation` 规则：冻结生成并停服后，由同一既有 runtime lease 持有 secret/DB 锁，核验停服证明、冻结审计、schema43、logical SHA、媒体/secret 和无额外活动边界；签名清单明确保留未结算请求，captureMode为独立模式，`finalCandidate=false`，由当次已授权发布规则单独准入。当前已部署v0.7.16的既定回退包是精确v0.7.15；本次v0.7.17候选的回退目标是精确v0.7.16，完整安装包演练仍待执行。回退仅切代码并保留CURRENT，重新验证当次最新备份和独立恢复；失败保持维护，不自动切回问题包或更老包。

默认阅读[工作规则](../AGENTS.md)、本页和[当前任务](../TASKS.md)，再按主题读取[生成架构合同](UNBOUNDRY_GENERATION_ARCHITECTURE.md)、[发布手册](../RELEASE_RUNBOOK.md)、[备份合同](../ops/production/README.md)及[恢复方案第10节](VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。
