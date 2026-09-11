# Unboundry 当前任务

文档角色：`CURRENT_TASK`。当前事实以 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md) 和 [v0.7.20 发布回执](spec/V0_7_20_PRODUCTION_RECEIPT_2026-09-12.json) 为准。

## 当前任务：视频下载超时后的保存恢复收尾

任务ID：`MEDIA-DOWNLOAD-RECOVERY-20260911`。

用户授权：本轮授权正式云存储检查、最新备份、回退演练、补丁发布及当前工作流恢复核验；不新增付费视频请求、不删除历史备份、不修复无关历史数据。前次 v0.7.18 授权不复用。

当前代码包版本：**v0.7.20**
本地候选代码版本：**v0.7.20**
当前技术状态：`PRODUCTION_TECHNICAL_PASS / PRODUCTION_USER_RECHECK`；schema44，未发生本轮数据库迁移。

## 受影响合同

[生成架构](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)2.2/2.3/3.1；[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9；[发布手册](RELEASE_RUNBOOK.md)5.3/6。

## 必须保留的行为

上述生成合同的自动找回原结果、同task/attempt保存所有权、输出slot完整身份、未知计费保护、取消与真实终态、成功节点及投影保护继续有效；不改变画布布局、模型选择和统一报错UI。

验证方法：隔离safe runner中的临时数据/假Provider与OSS/动态loopback验证下载时限、保存所有权、取消、原结果恢复及旧多输出保护；生产只沿已授权原任务恢复，以同一保存前后快照和41表精确差异审查保护范围。

## 工程检查

工程检查：m107/m108/m26/m54/m88 均 105/105；m81/m38 均 62/62；本轮定向与发布门共 167 项，fail、skip、retry、blocked 均为 0。PR178、main CI、v0.7.20 精确构建及 Linux 新→桥→新演练均通过；commit `ccac7564e2ec045d62f8beb675cfeadb18e0f3e9`，tag `v0.7.20`。

## 生产与工作流结果

最新事故保全、独立 fresh restore、938 个云对象上传及逐对象 GET、生产数据/静态资源/流量恢复均以 v0.7.20 回执记录为准。生产 CURRENT 只切到精确 v0.7.20 包，不用备份覆盖数据库；失败时保留 schema44 只读桥。

原工作流 `ea47f2a5-bc7e-4a73-8e24-3336ea164528` 技术恢复通过：9 个成功节点和 Canvas 投影受保护，视频 task `fc2cb668-654d-4c1c-8052-5c450c0ea114` 使用原 provider attempt 1178、远端任务 `133398023`，视频 Provider 新 POST 为 0；尾文字 task `50740684-43c2-45fa-a394-25f2e76d6768` 成功并已投影，新增尾文字 attempt 为 1 次（授权已消费）。旧未知任务及 v0.7.19 失败回执保持不变。

## 尚未关闭的边界

用户仍需对正式站原视频和尾文字做最后复核，故保留 `PRODUCTION_USER_RECHECK`，不能继承旧 `USER_PASS`。每日自动备份、视频/音频空工具按钮仍 `USER_DEFERRED`。GitHub v0.7.20 Release 已发布。治理文档按通过 CI 的最终 main 同步到独立镜像；具体文档提交由服务器 manifest 拥有，产品 tag、构建和进程不随文档同步改变。


独立复核：产品下载时限与runtime通道、Linux演练、最新备份/恢复/云回读、启动失败补验和精确后台恢复增量分别复审；具体阶段回执由正式发布回执引用。不把静态审查当作生产恢复结果。

用户验收：`PRODUCTION_USER_RECHECK`。用户尚未确认本轮正式画布结果。

## 下一步

按发布手册完成收尾文档的PR/main CI及独立治理镜像同步；本任务不再新增产品修复、生成或数据库迁移。GitHub本轮额外预算最多$10，全部CI结束后恢复$0，设备授权已完成。随后请用户刷新原画布，确认视频播放和最后文字内容。
