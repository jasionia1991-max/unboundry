# Unboundry 当前状态

文档角色：`CURRENT_STATE`。授权与收尾进度见[当前任务](../TASKS.md)；精确发布、备份、回退和验证证据由[v0.7.17发布回执](V0_7_17_PRODUCTION_RECEIPT_2026-09-09.json)维护。

## 现在怎么样

**最近核验的生产是 v0.7.17 / schema43**。正式站已完成切换。V3/V4节点恢复修复已部署，原自动恢复、成功节点保护、单节点补跑、错误UI与既有画布行为保留。维护功能继续默认关闭；正式启用前仍需明确入口与负责人。

本地V3/V4及第3项视频交互修复已获 `LOCAL_USER_PASS`。精确安装包、最新停服备份的verify/fresh restore、正式站静态资源及原画布打开/刷新检查通过；最新私有备份上传及GET核验也已通过，当前为`PRODUCTION_TECHNICAL_PASS / PRODUCTION_USER_RECHECK`。独立文档同步身份与校验结果由服务器治理manifest和运维回执拥有。本地用户验收、生产工程检查与生产用户确认分开，不能把未执行的真实付费生成记为通过。

当前代码包版本：**v0.7.17**（本地源码与正式站产品包）
本地候选代码版本：**v0.7.17**（已发布，无额外产品候选）
生产观测日期：2026-09-09
当前产品验收标记：`CURRENT_V0_7_17_USER_RECHECK`

## 发布与数据边界

- 正式站current：`/opt/unboundry/releases/v0.7.17-node-recovery-20260908`；产品tag/commit/tree以发布回执为准，后续文档提交不改变不可变产品包。
- 备份使用当次已授权的`quiesced-active-preservation`：停服并持有既有active lease，保留精确旧task/attempt及事件、计费保护和媒体/secret；`finalCandidate=false`，不冒充已结算或普通locked-exact模式。
- 精确旧任务`9c93f308-bb77-4935-a4e3-37dd72e6cd28`仍为`recovering/AUTOMATIC_RESULT_RECOVERY`，attempt为`outcome-unknown`且无平台task ID。其原始Provider code/msg未保存；未解锁、改终态、取消或付费重发。充值、等待时间和维护phase不能证明未受理或未扣费。
- 前三次发布尝试的失败与补偿证据保留。第三次已实际新包启动并退回旧包；这是故障补偿，不等于正式执行rollback.py。第四次切换通过；未覆盖CURRENT数据库，schema未变。
- 现有98项非阻断媒体提示保留，具体备份计数和完整性证据见发布回执；不宣称历史媒体全部无问题。

## 回退与暂停项

固定回退目标为精确v0.7.16包`/opt/unboundry/releases/v0.7.16-status-query-20260907`。完整Linux隔离新→旧→新演练已通过，范围和运行开关限制见回执。正式回退仍须按[发布手册第6节](../RELEASE_RUNBOOK.md)重新核验最新数据、冻结备份与独立恢复，只切代码并保留CURRENT；该保全格式继续使用精确v0.7.17工具，失败保持维护，不跳更老版本。

每日自动备份和视频/音频空工具按钮仍`USER_DEFERRED`。v0.7.15模板、其他12项及图片“浏览全部”保持原用户通过记录；历史性能和更新通知不扩大为本次重测，其他暂停项见[验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md)。

## 环境入口

工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；GitHub：`jasionia1991-max/unboundry`。当前收尾分支`codex/v0717-production-receipt`；实际HEAD和工作区以Git核对为准。服务器治理文档独立于产品包，精确文档提交由`/opt/unboundry/governance/current/.governance-manifest.json`拥有。

默认读取[AGENTS](../AGENTS.md)、本页和[当前任务](../TASKS.md)，再按主题读取[生成合同](UNBOUNDRY_GENERATION_ARCHITECTURE.md)、[发布手册](../RELEASE_RUNBOOK.md)、[备份合同](../ops/production/README.md)及[恢复方案第10节](VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。
