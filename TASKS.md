# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见[当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：视频下载超时后自动恢复卡住

任务ID：`MEDIA-DOWNLOAD-RECOVERY-20260911`。用户报告最新工作流长时间卡在生成。

用户授权：2026-09-11用户明确回复“授权”，批准本次正式云存储检查、备份、回退演练，通过后发布本次补丁并核验当前工作流恢复。本轮候选版本按patch递增为v0.7.19（须核对未占用），包括提交/PR/CI/tag/发布/治理同步。用户在精确只读权限说明后回复“继续”，本次仅允许向当前存储身份增加tapfk桶的oss:GetBucketInfo；其余云权限不变。只继续已有原视频及原工作流，禁止额外付费重发视频、无关历史修复、删除备份；前次v0.7.18授权不复用。

当前状态：`RELEASE_AUTHORIZED / CLOUD_PASS_INCIDENT_BACKUP_IN_PROGRESS`。截至2026-09-11本轮最新只读核验，正式 v0.7.18/schema44 的最新工作流 `ea47f2a5-bc7e-4a73-8e24-3336ea164528` 前9项成功且投影完成，视频第10项仍恢复中，第11项文字等待。不是重新判断旧失败工作流。

视频task `fc2cb668-654d-4c1c-8052-5c450c0ea114`，原Provider任务已返回结果；下载流TIMEOUT后，publication `5c68e571-e23f-4ab3-9055-dfe6152ff042` 进入compensating，但字节数0、完整哈希NULL。磁盘仅有183777字节不完整staging，无最终文件、无删除意图。OSS补偿要求完整文件身份，故反复拒绝；输出slot又被compensating占用，后台租约持续更新却无法推进。证据由只读SQL、精确文件元数据、限定journal和当前源码交叉确认。没有查询真实Provider或操作OSS。

## 受影响合同

[生成架构](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)2.2/2.3/3.1；[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9。

## 必须保留的行为

上述生成合同的自动找回原结果、同task/attempt保存所有权、输出slot完整身份、未知计费保护、取消与真实终态、成功节点与投影保护，以及UI合同的统一错误语义。不改变画布写入、布局、前端控件、模型选择或金额/订阅功能。

验证方法：临时数据、假OSS流式下载中断，经过真实publication补偿与恢复链复现；缺对象、有对象、HEAD未知、并发/租约、取消、原task重查、多输出及成功节点保护回归。只走safe runner，动态loopback；不使用真实数据/Provider/OSS。两个永久保护JSON不得访问。

## 局部修复候选与风险

优先复用现有补偿和原请求下载通道。对精确生成身份下的未完成staging（严格byte_size=0/checksum=NULL），仅在只读HEAD后同一对象的有界签名GET返回可信NoSuchKey错误体，确认精确OSS对象不存在后，才清理该不完整本地staging并结束补偿，使同一输出slot能保存原结果。HEAD返回对象则保留证据，不发DELETE；网络、鉴权或桶异常不当作对象不存在。完整哈希素材继续现有精确身份及版本删除保护，用户上传逻辑不变。独立审查发现SDK会混淆无响应体404与缺桶，候选已改用同对象签名GET的原始非空XML核验；无可信缺失证明时保留证据，不自动修改云权限。新分支仅适用于原任务仍running/recovering、精确Provider响应身份且有远端任务号、有效保存令牌及schema44输出编号。取消、无ID同步和历史无编号记录不进入新分支。代码及本地复审通过不等于生产恢复完成。

本次不重跑已成功的9个节点、不增加Provider POST、不手工改生产终态、不覆盖数据库、不降schema；不把程序技术检查写成真实工作流已恢复。真实旧记录已只读匹配原请求保护条件，云端精确缺失证明与上线前保全仍待执行。

## 断点与证据

本地证据：`/tmp/unboundry-latest-workflow-20260911/`（原始journal私有，禁止未经脱敏展示）。施工基线HEAD `f5b14018ce5185bfe9a91a9b3ececdf02d996ce0`；生产运行目录/schema44已核验，未重启。05:19只读SQL确认目标原请求身份符合候选保护条件；本次05:50正式只读预检：精确对象HEAD=404，同桶GetBucketInfo=403 AccessDenied。没有DB写入、云写入或Provider请求；不能把403当不存在，正在验证更小权限替代。

工程检查：六组共104项相关检查通过，范围为m108/m88/m54/m109/m40/m38。旧版红测16项中原有14项通过、新增2项失败（`m108-red-3.log`，退出1，预期）；初次候选17/18，失败为测试夹具的ready/空hash非法组合，已修正夹具，没有放宽产品约束。首轮六组103/104，唯一失败为文档格式未对齐（`regression.log`，退出1）；修正文档、强化旧compensating记录释放原租约后由新recovery租约接手的用例，再定向重跑m108/m38，37/37通过（`targeted-final.log`，退出0），复用其余未变四组67项证据。模拟网络下的视频/音频真实保存代码路径及同请求重取、取消、未知结果、成功节点、多输出、旧功能回归通过；类型/架构/源覆盖及安全入口检查通过。safe runner清单1414项只表示发现总数，不是执行总数；同步3处绑定哈希，未减弱安全入口。首次命令：`node scripts/run-safe-tests.mjs run --spec tests/m108-generation-publication-slots.spec.ts --spec tests/m88-media-publication.spec.ts --spec tests/m54-provider-result-media.spec.ts --spec tests/m109-workflow-continuation.spec.ts --spec tests/m40-generation-recovery-worker.spec.ts --spec tests/m38-generation-runtime-incidents.spec.ts`。最终补测使用同一命令入口，仅保留m108/m38两个精确路径。Node为专用22.23.1。

独立复核：最终代码、真实SDK形状、m88下载/保存/补偿/提交链及m108旧记录新恢复租约接手用例复审GO，无技术阻断；补测37项通过，文档已结算本地通过与生产未改变的状态。证据使用本地模拟fetch/OSS，第二次GET由测试驱动，不等于真实Provider/OSS全工作流通过。未新增数据库迁移或客户端改动，既有完整素材删除保护、用户上传及正常生成通道保留。

用户验收：本次正式生成报告未通过；本地新修复尚未交付用户验收，不继承旧发布USER_PASS。

## 下一步

候选已提交草稿PR #177，head `7ad1fa0695482f5f0648b1fdf4c7ea39e378a4eb` 的CI run `34577683277` 两项均通过；尚未合并、tag、部署。package/lock/runtime精确准入为0.7.19，tag未占用；m81/m38共62/62通过。后续本地增量尚未提交，不能复用旧head CI冒充最终检查。

新增桶信息GET曾缺少`oss:GetBucketInfo`，实查implicit deny；未修改IAM。现已改为同一对象有界签名GET，真实预检通过（`/tmp/unboundry-v0719-release-20260911/cloud-range-preflight-result.json`，退出0）：HEAD404，GET404且真实OSS NoSuchKey；检查前后任务及存储配置哈希一致，无云写入/数据库写入/Provider请求。不再需要用户登录或补桶信息权限。

最终局部回归：m108/m88/m93/m38四组89/89通过（`final-recovery-safe-2.log`）；随后补充只凭包和外置密钥读取已验签上下文的恢复入口，m93/m38再29/29通过（`envelope-recovery-entry-safe.log`），复用未改m108/m88的60项，不重复累加为118项。慢/永不结束响应体、空404、篡改/缺失、cloud-only素材和未来独立恢复已覆盖。首轮仅新增测试代码误插finally导致类型预检失败，已修正，未改旧产品行为来过门。

旧备份门拒绝本次活动工作流及未完成publication，external-unverified也拒绝failed OSS素材；不能用旧快照或改终态过门。按[发布手册5.3](RELEASE_RUNBOOK.md)新增独立事故加密保全工具，保留原账本、library、半下载文件和secret，普通门不放宽。合成m93/m38共29/29通过（`/tmp/unboundry-v0719-release-20260911/incident-envelope-safe-3.log`，退出0），包括逐字节fresh restore、篡改/缺失/错误身份/覆盖/软硬链/别名路径/缺library拒绝；前两次仅清单预检失败，未执行业务测试，已修正清单字段与绑定哈希。运行锁、冻结和生产操作会话仍在独立复审；实查664份ready OSS素材无本地副本，需完整云镜像一同保全；实际最新备份、云端全量GET校验、Linux回退及部署未执行。safe runner当前发现1416项，不代表全量执行。

本次生产授权已取得，先核对目标原请求/输出slot及存储配置，实查精确对象HEAD与同对象有界签名GET；对象存在或权限/网络不明确时停止该恢复方案，保留现场且不自动改云权限。检查通过后递增补丁版本，完成发布检查、最新数据一致备份/恢复与回退演练，再部署。修复仅继续同一原视频的取回/保存，不额外提交该视频生成；随后观察原工作流未完成后继。部署后需实际确认本条视频与后继完成，再更新生产结果；不把本地通过当作已经恢复。

前次发布结果由[v0.7.18发布回执](spec/V0_7_18_PRODUCTION_RECEIPT_2026-09-11.json)拥有，工程发布通过不表示本次真实工作流通过。每日自动备份、视频/音频空工具按钮仍暂停。
