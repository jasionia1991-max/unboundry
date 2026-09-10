# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见[当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：v0.7.18图片保存与自动恢复冲突修复发布

任务ID：`MEDIA-PUBLICATION-RACE-20260910`。用户授权：修订3已审方案的本地实现、回归、撤销演练与独立复审；2026-09-11四项本地验收“全部通过”后回复“授权”继续发布，随后明确“同意 数据库也得对齐的”，包含本次schema43→44迁移、备份/恢复、维护回退、commit/push、PR/CI、tag/release和上线。既有本次授权有效，不重复确认；不扩大为付费生成、历史数据采用/删除、云权限或暂停项。

当前状态：`LOCAL_TECHNICAL_PASS / LOCAL_USER_PASS / PRODUCTION_TECHNICAL_PASS / PRODUCTION_USER_RECHECK`。程序v0.7.18和数据库schema44已配套上线，公网已恢复。精确身份、操作、失败补偿、备份和边界由[v0.7.18发布回执](spec/V0_7_18_PRODUCTION_RECEIPT_2026-09-11.json)拥有；本页仅维护剩余收尾。

选用方案：[媒体保存与自动恢复冲突修复方案](spec/MEDIA_PUBLICATION_RECOVERY_REPAIR_PLAN_2026-09-10.md)。本地实现/测试/用户验收和方案审查的时间线保留在第10—12节，不将历史“未上线”快照当成现在事实。

## 受影响合同

[生成架构](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)2.2/2.3/3、[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9，以及[发布手册](RELEASE_RUNBOOK.md)5.1/5.2/6和[备份合同](ops/production/README.md)。发布修正规则为已审范围内的程序及必要数据库迁移一起验证、一起发布；需要额外确认的是未覆盖的重大影响，不是一概排除数据库。

## 必须保留的行为

自动恢复优先、完整身份、成功节点保护、同标签迟到保存拒绝、跨标签最后保存者胜、未知计费结果保护和统一报错UI。历史failed run不得直接改回running；不手写终态来满足备份门。

验证方法：临时数据/动态loopback假Provider复现保存竞争和重复恢复，验证原请求一次输出登记、自动回填和安全后继；相关旧行为分组回归；精确包真实Linux隔离迁移及新→只读维护→新；生产冻结前后备份verify/fresh restore、旧列/账本/素材与未知任务哈希、公网版本与资源核对。禁止数据库降级或覆盖CURRENT。

工程检查：相关业务分组回归、四项同页真实操作已通过，精确命令及红绿记录在方案第11节。发布定向62项、备份CLI23项通过；最终操作比较守卫14项合成验证通过。精确tag新构建、6215项安装清单、真实Linux隔离演练、迁移前后独立恢复及生产最终核对通过。真实Provider POST0，不重复业务全套来替代缺少的生产证据。

独立复核：保存/采用/续跑/清理/UI、备份CLI、Linux真实证据、生产迁移与恢复、临时操作脚本均经过非作者交叉审查。最终允许的两处运行期变化被限制到原失败图片的精确错误分类和已释放保存锁，其余行列及原未知任务证据严格核对；无人工数据改写。

用户验收：本地四项 `LOCAL_USER_PASS`，原文及范围见[验收账本当前增量](spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md)。正式站刷新后会话要求登录，认证画布视觉复验仍为 `PRODUCTION_USER_RECHECK`；数据库只读比对证明原画布和task/attempt/操作回执数量未变。未点击付费生成或采用历史结果。

## 下一步

公网35个资源及两份私有加密云备份全部对象和清单GET核验已通过。收尾文档按正式回执独立复核、定向文档检查、PR/main CI和服务器治理镜像核验流程同步；精确文档提交及同步结果由服务器`/opt/unboundry/governance/current/.governance-manifest.json`与`deployment-receipts/<文档提交SHA>.json`记录，产品tag和运行包不改变。下一步由用户登录正式站查看原画布；不把缺失的登录后视觉检查写为通过。

每日自动备份、视频/音频空工具按钮仍暂缓，维护功能默认关闭。原未知任务与原失败工作流保持既有数据边界；此次上线未手动重新请求模型、采用原图或执行付费后继。
