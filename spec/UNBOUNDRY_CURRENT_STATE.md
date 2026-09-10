# Unboundry 当前状态

文档角色：`CURRENT_STATE`。授权与收尾进度见[当前任务](../TASKS.md)；精确发布、备份、回退和验证证据由[v0.7.17发布回执](V0_7_17_PRODUCTION_RECEIPT_2026-09-09.json)维护。

## 现在怎么样

**最近核验的生产是 v0.7.17 / schema43**。正式站已完成切换。V3/V4节点恢复修复已部署，原自动恢复、成功节点保护、单节点补跑、错误UI与既有画布行为保留。维护功能继续默认关闭；正式启用前仍需明确入口与负责人。

本地V3/V4及第3项视频交互修复已获 `LOCAL_USER_PASS`。精确安装包、最新停服备份的verify/fresh restore、正式站静态资源及原画布打开/刷新检查通过；最新私有备份上传及GET核验也已通过，当前为`PRODUCTION_TECHNICAL_PASS / PRODUCTION_USER_RECHECK`。独立文档同步身份与校验结果由服务器治理manifest和运维回执拥有。本地用户验收、生产工程检查与生产用户确认分开，不能把未执行的真实付费生成记为通过。

当前代码包版本：**v0.7.18**（本地发布候选；正式站仍v0.7.17）
本地候选代码版本：**v0.7.18**（本地验收已通过，发布进行中；GitHub与部署实测由当前任务维护）
生产观测日期：2026-09-11（只读复核；最近正式发布仍是9月9日）
当前产品验收标记：`CURRENT_V0_7_17_USER_RECHECK`

## 当前生产故障（2026-09-10）

用户实际整组生成触发“生成结果未能安全发布”。已只读确认：文字成功，图片保存/后台恢复发生冲突；同一task/attempt登记了两份同哈希的已发布素材，任务最终为`PROVIDER_RESULT_FORMAT`，工作流失败且后续9节点未准入。仅有1条Provider attempt记录。不能把素材登记成功说成画布已恢复，也不能把9月9日发布工程通过说成本次工作流通过。生产运行仍是v0.7.17，未重启或修改。精确任务、时间与代码线索见[当前任务](../TASKS.md)，[修复方案](MEDIA_PUBLICATION_RECOVERY_REPAIR_PLAN_2026-09-10.md)已通过修订3方案评审；现已获本地施工授权，保存竞争、原结果采用、仅执行未完成节点及自动核对已在本地实现，相关新旧功能回归分组通过。本地新→只读保全→新撤销演练及空闲启动清理已通过，历史启动及文档回归也已通过；四项同页辅助脚本已完成真实操作及独立复核，四项本地用户验收已通过（LOCAL_TECHNICAL_PASS / LOCAL_USER_PASS / NOT_DEPLOYED），确认原文和范围由[验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md)维护；精确进度与证据只由当前任务及方案第11节维护。生产处理未执行，本次问题尚未在生产修复。

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

工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；GitHub：`jasionia1991-max/unboundry`。当前发布分支`codex/v0718-media-publication-release`；实际HEAD和工作区以Git核对为准。服务器治理文档独立于产品包，精确文档提交由`/opt/unboundry/governance/current/.governance-manifest.json`拥有。

默认读取[AGENTS](../AGENTS.md)、本页和[当前任务](../TASKS.md)，再按主题读取[生成合同](UNBOUNDRY_GENERATION_ARCHITECTURE.md)、[发布手册](../RELEASE_RUNBOOK.md)、[备份合同](../ops/production/README.md)及[恢复方案第10节](VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。
