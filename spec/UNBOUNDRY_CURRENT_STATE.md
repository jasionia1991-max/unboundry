# Unboundry 当前状态

文档角色：`CURRENT_STATE`。授权与收尾进度见[当前任务](../TASKS.md)；精确发布、数据库迁移、备份和回退证据由[v0.7.18发布回执](V0_7_18_PRODUCTION_RECEIPT_2026-09-11.json)维护。

## 现在怎么样

**最近核验的生产是 v0.7.18 / schema44**。正式站已切换并恢复公网访问；图片保存与后台恢复竞争的修复，以及原结果采用、仅继续未完成节点的功能已部署。程序与所需数据库结构已配套升级，原自动恢复、成功节点保护、错误UI及画布行为保留。

v0.7.18发布前四项本地验收为 `LOCAL_USER_PASS`。迁移前后两份停服备份、verify、独立fresh restore，真实Linux隔离新→只读维护→新演练及生产数据核对已通过。公网35个资源已全部逐字节核对通过；迁移前后两份私有加密云备份均完成全部对象和清单GET哈希核验，发布工程检查为 `PRODUCTION_TECHNICAL_PASS`。浏览器刷新后需要登录，未把原缓存画布当作新版本认证画布复验；`PRODUCTION_USER_RECHECK` 保留，未执行真实付费生成。

当前代码包版本：**v0.7.19**（本地发布候选，生产仍为v0.7.18）
本地候选代码版本：**v0.7.19**。视频下载恢复修复已提交至草稿PR #177，尚未上线。同对象低权限真实云检查已通过，无需修改IAM。现有备份门不能保留本次卡住的现场，事故保全流程正在验证；精确进度由TASKS维护。
生产观测日期：2026-09-11
当前产品验收标记：`CURRENT_V0_7_18_USER_REJECTED_VIDEO_RECOVERY_BLOCKED`

2026-09-11用户正式生成发现新的未解决故障：最新工作流前9个节点成功，视频在下载超时后卡入保存补偿循环，最后一个文字节点因此等待。已由只读生产记录与源码确认，本地修复已通过相关检查，尚未上线；精确身份、测试/复审证据和发布前剩余检查由[当前任务](../TASKS.md)维护。前次发布技术通过不等于这个真实生成案例通过。

## 数据与已有故障边界

- 正式current为`/opt/unboundry/releases/v0.7.18-media-publication-20260911`。数据库43→44事务迁移、完整性、外键、旧列与账本、素材保护检查通过；未用备份覆盖CURRENT。
- 原未知视频任务仍保留其task/attempt/四条事件完整证据，未解锁、改终态或付费重发。充值、等待和维护phase不能证明平台未受理或未扣费。
- 原失败图片及两份同哈希素材仍保留，原失败工作流和9个未准入后继未由本次发布人为恢复。新程序启动后正常后台查询更改了该旧attempt的一格错误分类，并留下已释放的保存锁记录；独立精确比对通过，未新增Provider attempt、采用或续跑。不能把“修复已部署”写成“历史失败内容已全部找回”。
- 迁移前后使用`quiesced-active-preservation`保全模式，`finalCandidate=false`；未把未知任务改为已结算以满足普通备份条件。100项非阻断媒体提示保留，阻断项0，不宣称历史媒体全部无问题。
- 第一次生产操作在迁移前被操作检查拦截并补偿，旧程序及安全开关恢复；第二次完成迁移和切换。失败、修正及精确证据保留在本次回执，不改写成一次无故障发布。

## 回退与暂停项

数据库现为schema44，不能启动旧schema43程序或倒灌旧库。当前备用方案为独立schema44只读维护桥；真实Linux隔离演练已通过，生产只安装初始桥包，未执行生产桥回退。若将来需要回退，必须先停止新程序、重新保全最新CURRENT并重新绑定桥包；现初始manifest不能复用于已变化的数据。具体流程见[发布手册第6节](../RELEASE_RUNBOOK.md)。

每日自动备份和视频/音频空工具按钮仍 `USER_DEFERRED`，本次手动备份不代表每日任务已修复。维护功能继续默认关闭。v0.7.15模板及其他既有用户通过记录保留；其他暂停项见[验收账本](UNBOUNDRY_ACCEPTANCE_MATRIX.md)。

## 环境入口

工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；GitHub：`jasionia1991-max/unboundry`。实际分支/HEAD以Git核对为准。服务器文档与不可变产品包分开，精确文档提交由`/opt/unboundry/governance/current/.governance-manifest.json`拥有。

默认读取[AGENTS](../AGENTS.md)、本页和[当前任务](../TASKS.md)，再按主题读取[生成合同](UNBOUNDRY_GENERATION_ARCHITECTURE.md)、[发布手册](../RELEASE_RUNBOOK.md)、[备份合同](../ops/production/README.md)及[上次发布方案](MEDIA_PUBLICATION_RECOVERY_REPAIR_PLAN_2026-09-10.md)。
