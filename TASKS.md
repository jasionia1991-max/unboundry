# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见 [当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：v0.7.18图片保存与自动恢复冲突修复发布

任务ID：`MEDIA-PUBLICATION-RACE-20260910`。用户反馈正式站整组生成报错后，要求详细修复方案及正常功能影响评估。用户授权：在修订3独立方案审查后回复“可以”，已授权按该方案进行本地实现、新旧回归、撤销演练和独立代码复审；当时先不上线。2026-09-11用户在四项验收通过后明确回复“授权”，授权继续发布检查与上线。候选为v0.7.18。用户随后明确回复“同意 数据库也得对齐的”，已批准schema43→44生产迁移及事先说明的仅维护页回退；继续本次commit/push、PR/CI、tag/release、配套备份/恢复/迁移和上线，不重复确认。当前为LOCAL_TECHNICAL_PASS / LOCAL_USER_PASS / RELEASE_PREPARING / NOT_DEPLOYED，本地修复、相关回归、撤销演练、独立复审及四项用户验收已完成；不复用已消费的v0.7.17发布授权。仅使用本地动态假Provider，未调用真实Provider/OSS、重发真实生成、修改真实任务终态、删除或搬移真实素材。

本次选用方案：[媒体保存与自动恢复冲突修复方案](spec/MEDIA_PUBLICATION_RECOVERY_REPAIR_PLAN_2026-09-10.md)。实现/测试/验收状态和方案审查结论分开，精确审查结果由方案第10节拥有。

## 已核实的生产事实

核查时间：2026-09-10北京时间00:55—01:00；日志和数据库时间为UTC。正式current仍为`/opt/unboundry/releases/v0.7.17-node-recovery-20260908`，API版本0.7.17，服务active、PID1909187、重启次数0。开发工作树HEAD为`3eae6840ec3ac825e7e3908fc7b8f66692228db2`，开始时clean。

- 画布：`837344f0-5988-4408-9651-0b0cebe0f6fa`。本次run：`0c512ea1-cf82-4000-af34-2887099aab11`，UTC09-09 16:51:47启动；首个文字task成功且投影applied。
- 图片task：`216afbcc-98f2-4de7-b053-abfc2776bc50`，node：`image-5391c659-9e03-46fd-acb6-6e550e3c9059`，模型tt-image-2；attempt1、Provider任务131830540、response-received。仅1条Provider attempt记录，不据此推断退款或实际账单。
- publication `308baa18-3dac-461e-88f5-52cde4a0e883`在16:53:33建立，byte_size0；task在16:53:37被记为`MEDIA_RECOVERY_EVIDENCE_MISSING`。16:53:45起日志连续出现保存状态/冲突错误。run在16:54:09失败，后续9节点blocked/UPSTREAM_FAILED，未创建这些节点的生成task。
- 同一task的publication `29e3563c-7893-46e1-a930-221c1a02c792`与`06f513c4-79e6-4844-829e-aaa181c4976c`随后均published、关联media ready；各1760881字节、SHA256均为`a43a8fbe1f7f1ba7fc407f28ba3f1112d5e195a4df1f2c869f60854550fb61df`。这是数据库登记证据，未重新GET云对象，不等于本轮已验证媒体实际可读。
- 自动恢复在16:55:38继续原task；16:56:36最终为`failed/PROVIDER_RESULT_FORMAT`，result_asset_id仍null，目标画布节点未获得图片结果。原工作流仍failed，尚未恢复。

## 代码线索与证据边界

- `server/generationTasks.ts`恢复扫描每30秒执行；`runGenerationRecoverySweep`会处理待发布结果。
- `server/mediaLifecycle.ts:1198`扫描包含`reserved`；`:1320`准备恢复时把reserved直接视为failed，未区分仍在正常写入的任务。`server/generationResultCommit.ts:1083`随即以`MEDIA_RECOVERY_EVIDENCE_MISSING`写失败。代码路径与本次保存尚未结束便失败的时间线吻合。
- `server/generationTasks.ts:4520`的输出保存以已发布条目数计算剩余输出；已发布数多于平台输出数时抛`PROVIDER_RESULT_FORMAT`。同哈希双登记与本次后续错误相符。
- 本地受控并发已完成旧代码红测及首轮绿测，精确证据见方案第11节；后续分组回归与同页工程实跑已完成，不能冒充生产修复或用户通过。旧代码已有上述reserved判定，不能仅凭发布日期断言是v0.7.17新增。

## 受影响合同

受影响合同：[生成架构](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)2.2/2.3/3、[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9。现有自动恢复优先、原请求结果找回、成功节点保护、完整身份和计费保护必须保留；历史failed run不能直接改回running。修复需处理正常保存与恢复并发、同一输出重复登记、可恢复保存异常过早变终态；不能只隐藏报错或关闭自动恢复。

## 必须保留的行为

保留上述合同中的自动恢复、完整身份、成功节点和未知结果保护。验证方法：按安全入口，以临时数据/假Provider/动态loopback制造保存窗口内扫描和重复恢复，验证一个原请求、同一输出一次登记、自动回填、工作流正确推进；复核旧终态/未知计费、取消、重启恢复及已有单节点行为。真实已失败run如何继续、已保存双记录如何安全采用须另有具体方案，不能直接写生产数据库处理。

工程检查：相关业务回归已分组通过。最新第16轮m81启动兼容43/43，第15轮m38生成错误/文档治理19/19，第14轮保存所有权14项、撤销/idle清理3项、媒体发布41项通过；此前正常HTTP生成16项、媒体后继10项、画布安全89项、UI自动核对4项通过。四项同页辅助脚本已修正并完成第14次真实浏览器实跑：保存竞争视频、原PNG采用、仅两视频后继、原内容保护通过；视频POST2、图片/未知模型POST0。第13次另检查白框/菜单层级/拖线创建节点/缩放和刷新保留。精确分组证据见方案第11节，不将重复测试次数相加。

独立复核：按代码作者交叉审查。原保存证据冲突和idle清理问题已修，后者本轮真实启动回归通过；验收辅助脚本和夹具亦已独立复核。受影响范围无已知未关闭P0/P1/P2。用户验收：LOCAL_USER_PASS，四项确认的原文、日期与边界见[验收账本当前增量](spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md)。精确命令、源SHA与失败记录见方案第11节。

## 下一步

v0.7.18候选版本准入已就绪，新增62项发布相关检查通过，四个版本文件增量独立复审通过；精确证据与后续操作顺序见[方案第12节](spec/MEDIA_PUBLICATION_RECOVERY_REPAIR_PLAN_2026-09-10.md#12-v0718发布准备2026-09-11尚未上线)。操作单检查发现发布阻断：backup-data CLI仍将quiesced模式固定schema43，虽底层支持44，线上未知任务却不能走普通locked-exact；精确43/44命令行已修复，23项备份回归全部通过（含43/44未知任务真实CLI备份→verify→fresh restore），源码覆盖通过；独立非作者代码复审通过，无已知P2及以上问题。数据库配套升级及维护回退影响现已获用户确认，按发布手册继续GitHub与Linux精确包发布门，再做最新生产备份/恢复与迁移；未通过各门不得切换。提交清单必须包含未跟踪的tests/schema-fixtures.ts及本次其他新源文件；保留真实旧任务与素材；不做真实生成或结果采用。2026-09-11只读复核current仍v0.7.17/schema43、PID1909187、restarts0、ready200。临时验收服务停止、50680关闭，日志/合成数据保留。

## 上一项发布收尾

v0.7.17已发布；本地V3/V4与第3项视频交互验收已获USER_PASS，生产工程通过记录保留，本次生产故障未通过。完整发布、备份、回退及未测边界见[v0.7.17发布回执](spec/V0_7_17_PRODUCTION_RECEIPT_2026-09-09.json)，本地实施见[恢复方案第10节](spec/VIDEO_BALANCE_SINGLE_NODE_RECOVERY_PLAN_2026-09-07.md#10-第4版本地实施与验证2026-09-08)。GitHub PR173/174及main CI通过，治理镜像来源提交为上述HEAD，文档后续本地增量尚未同步。原未知视频任务保全不变；维护默认关闭，每日自动备份、视频/音频空工具按钮继续暂缓，自托管CI路线保持取消。
