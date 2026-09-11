# Unboundry 当前状态

文档角色：`CURRENT_STATE`。授权与收尾进度见[当前任务](../TASKS.md)；当前失败发布与回退证据见[v0.7.19失败回执](V0_7_19_FAILED_RELEASE_RECEIPT_2026-09-11.json)；此前数据库迁移由[v0.7.18发布回执](V0_7_18_PRODUCTION_RECEIPT_2026-09-11.json)维护。

## 现在怎么样

**最近核验的生产是 v0.7.19 / schema44，但本轮发布未通过，正式站处于只读维护。** 新版短暂启动后释放了原视频被占用的保存槽；随后原结果下载连续触发60秒总时限，视频及最后一个文字节点仍未完成。已停止应用并按最新CURRENT绑定schema44只读维护桥；没有降级或用备份覆盖数据库，不能记上线成功。

当前代码包版本：**v0.7.20**（本地追加候选；v0.7.19 tag和构建不可改写）
本地候选代码版本：**v0.7.20**；正在处理逐块保存反复扫描全库的性能缺陷与下载时限，精确任务由TASKS维护。
生产观测日期：2026-09-11
当前产品验收标记：`CURRENT_V0_7_19_USER_RECHECK`

本次完整事故保全、独立fresh restore及938份云备份对象和清单回读已通过。原视频Provider没有重新提交；应用运行期间前9个成功节点及旧未知任务保持保护。停服时触发SHUTDOWN_DEADLINE并退出1；已确认原PID不存在、cgroup为空和原端口关闭，记录失败后仅清除systemd失败状态，再完成只读桥回退。实际失败材料保留，不伪造成功发布回执。

以下v0.7.18内容只说明上一发布的数据背景，不表示当前服务已恢复；v0.7.19最新操作证据位于主机私有`/var/lib/unboundry-v0719-media-download-recovery-20260911/evidence`。

## 数据与已有故障边界

- v0.7.18原发布目录为`/opt/unboundry/releases/v0.7.18-media-publication-20260911`；当前产品指针为v0.7.19，应用已停止，由独立只读桥提供维护。数据库43→44事务迁移、完整性、外键、旧列与账本、素材保护检查通过；未用备份覆盖CURRENT。
- 原未知视频任务仍保留其task/attempt/四条事件完整证据，未解锁、改终态或付费重发。充值、等待和维护phase不能证明平台未受理或未扣费。
- 原失败图片及两份同哈希素材仍保留，原失败工作流和9个未准入后继未由本次发布人为恢复。新程序启动后正常后台查询更改了该旧attempt的一格错误分类，并留下已释放的保存锁记录；独立精确比对通过，未新增Provider attempt、采用或续跑。不能把“修复已部署”写成“历史失败内容已全部找回”。
- 迁移前后使用`quiesced-active-preservation`保全模式，`finalCandidate=false`；未把未知任务改为已结算以满足普通备份条件。100项非阻断媒体提示保留，阻断项0，不宣称历史媒体全部无问题。
- 第一次生产操作在迁移前被操作检查拦截并补偿，旧程序及安全开关恢复；第二次完成迁移和切换。失败、修正及精确证据保留在本次回执，不改写成一次无故障发布。

## 回退与暂停项

数据库现为schema44，不能启动旧schema43程序或倒灌旧库。当前备用方案为独立schema44只读维护桥；真实Linux隔离演练已通过，本次v0.7.19启动失败后已按最新数据完成生产桥回退。若将来需要回退，必须先停止新程序、重新保全最新CURRENT并重新绑定桥包；现初始manifest不能复用于已变化的数据。具体流程见[发布手册第6节](../RELEASE_RUNBOOK.md)。

每日自动备份和视频/音频空工具按钮仍 `USER_DEFERRED`，本次手动备份不代表每日任务已修复。维护功能继续默认关闭。v0.7.15模板及其他既有用户通过记录保留；其他暂停项见[验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md)。

## 环境入口

工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；GitHub：`jasionia1991-max/unboundry`。实际分支/HEAD以Git核对为准。服务器文档与不可变产品包分开，精确文档提交由`/opt/unboundry/governance/current/.governance-manifest.json`拥有。

默认读取[AGENTS](../AGENTS.md)、本页和[当前任务](../TASKS.md)，再按主题读取[生成合同](UNBOUNDRY_GENERATION_ARCHITECTURE.md)、[发布手册](../RELEASE_RUNBOOK.md)、[备份合同](../ops/production/README.md)及[上次发布方案](MEDIA_PUBLICATION_RECOVERY_REPAIR_PLAN_2026-09-10.md)。
