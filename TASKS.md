# Unboundry 当前任务

文档角色：`CURRENT_TASK`。线上版本及历史发布以 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md) 为准。

## 当前任务：视频查询异常与工作流恢复，第2版本地实施

任务ID：`VIDEO-QUERY-WORKFLOW-RECOVERY-20260913`。

用户授权：第2版本地实施及三项本地验收已完成。2026-09-14用户对“发布检查、备份和回退验证，通过后上线”明确回复“授权”，本轮发布流程已获准；随后用户对“本次版本号定为v0.7.21，可以吗”回复“允许发布”，版本和上线范围均已明确。本轮包括commit/push/PR合并/tag/Release、正式备份/fresh restore/云端GET核验、Linux隔离回退演练及通过后的生产切换。发布不包含历史事故回填、真实付费生成或下游收费续跑；既有未知请求不得重发。此前发布及尾文字生成授权不复用。

当前阶段：`RELEASE_PREPARATION`；本地结论保留`LOCAL_AUTO_PASS / LOCAL_USER_PASS`。本地修复、新旧功能回归、撤销演练、独立代码复审及完整浏览器验证完成，尚未上线。方案正文是审查时的冻结快照；当前实施结论以[方案第9节](spec/VIDEO_QUERY_WORKFLOW_RECOVERY_PLAN_2026-09-13.md#9-本地实施记录)为证，不将旧“未实施”叙述当作现在状态。

## 已核实与未知

本会话9月13日只读观察到本次原视频任务已自动success并保存，关联历史run/node仍failed、画布未回填；错误处理把配置锁获取异常映射为最终失败，恢复链没有把结果送回历史workflow。精确事故身份和代码证据见方案第1～2节。本次底层锁异常原始原因未被日志保留，不能猜锁持有者。方案期间没有重新访问生产；实施或生产处理前须重新核对现状。

## 受影响合同

[生成合同](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)2.2～2.5、3～3.2；[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9；[发布手册](RELEASE_RUNBOOK.md)6。

## 必须保留的行为

保留自动找回原请求、原task/attempt/Provider身份、未知计费围栏、取消/真实终态、保存所有权与slot、成功节点/布局连线、单节点补跑和一次补偿；历史failed run/node不复活，普通新活动工作流恢复后自动推进。DATA-005和UI白框/菜单规范不改变；每日自动备份及视频/音频空工具按钮仍暂停。验证方法：详细行为及对应强制验证由方案第3～7节拥有；使用同一假Provider链路验证自动恢复、历史同步与后继，既有相关回归验证正常功能。

基线HEAD `300e3e891d87f3d294a4be24b780a07b315bee2a`；本地实施起点保留前轮4个方案文档改动，未覆盖用户代码改动。运行时恢复和历史结果同步按不重叠文件分工；主代理整合、使用safe runner串行验证并负责最终验收。
工程检查：架构/类型/构建通过，未增加跨域SQL豁免。351项相关回归已通过：画布保存m3 14项+m86 90项，原有旧功能219项，m109后继10项、m110只读维护桥撤销3项、m112持久恢复及日志5项、m113历史同步及真实CLI8项、m114状态映射2项。明细/日志与有效范围由[方案第9节](spec/VIDEO_QUERY_WORKFLOW_RECOVERY_PLAN_2026-09-13.md#9-本地实施记录)拥有。

独立复核：产品阻断及验收误判阻断均已关闭。锁错误原始安全码采用白名单保留；历史来源拒绝迁移推断的Provider记录；完整验收必须匹配同task的精确锁忙日志。

全链路验证：冻结旧HEAD的211份server/types真实复现同类故障；修复版经同task实际SQLite锁忙后，原视频沿attempt1自动成功并显示，尾文字首次提交1次自动完成。历史原视频窄同步后仅继续尾文字，未重发视频，九个成功节点未变；恢复期限耗尽后停止新增查询、保留原身份和围栏、诚实提示待处理。另修正刷新journal重放后使用旧快照导致误删新文字的问题；m3/m86共104项和完整网页复验均通过。截图已人工核对，测试数据重置通过。证据由方案第9节拥有。

用户验收：`LOCAL_USER_PASS`。2026-09-14，用户在本轮 `http://127.0.0.1:51892/__acceptance` 明确回复“3项通过”：自动恢复、刷新后结果保留、历史原视频同步后仅继续尾节点。全部使用假平台，不收费；不扩大为生产验收或上线授权。验收会话已正常结束，安全运行器退出0；最终运行日志 `/tmp/unboundry-video-query-final-acceptance-20260914.log`，技术报告保留在 `/tmp/unboundry-video-query-final-evidence-20260914/accepted-session-product-smoke.json`。

## 上一任务的保留边界

`MEDIA-DOWNLOAD-RECOVERY-20260911` 已有发布和原工作流技术恢复记录，见 [v0.7.20回执](spec/V0_7_20_PRODUCTION_RECEIPT_2026-09-12.json)；其用户验收仍按当前状态保留，不继承成本事故通过。旧任务中的生成、GitHub预算及上线授权不是本任务授权，旧任务尾部操作不自动继续。

## 下一步

v0.7.21发布已获用户明确确认。已准备可逆v0.7.21候选（package/lock/精确运行准入及m81版本用例），m81+m38发布检查62/62通过、退出0，日志`/tmp/unboundry-v0721-release-prep-20260914/release-checks.log`，源码SHA `95f8dca7bd5d877be7754b8d17469109ccabb15f273f318c9541156ef59a1c6a`。此前351项业务证据保留，未重复运行。9月14日只读核对生产current仍v0.7.20/schema44，服务active、PID2644686、NRestarts0；main仍300e3e8。无活动workflow或未完成publication；只有原未知视频task 9c93f308-bb77-4935-a4e3-37dd72e6cd28 recovering/attempt1。本事故原task仍success、原run仍failed，未执行回填或重试。旧v0720操作脚本绑定已停服v0719，不能直接复用；准备本轮精确停服保全、新包Linux隔离回退及发布审查，全部门通过后切换。生产当前保持运行，尚未冻结或停服。
