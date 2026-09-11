# Unboundry 当前任务

文档角色：`CURRENT_TASK`。项目现状见[当前状态](spec/UNBOUNDRY_CURRENT_STATE.md)。

## 当前任务：视频下载超时后自动恢复卡住

任务ID：`MEDIA-DOWNLOAD-RECOVERY-20260911`。用户报告最新工作流长时间卡在生成。

用户授权：2026-09-11用户明确回复“授权”，批准本次正式云存储检查、备份、回退演练，通过后发布本次补丁并核验当前工作流恢复。本轮v0.7.19未通过，继续同一故障修复的追加候选为v0.7.20（远端tag未占用），包括提交/PR/CI/tag/发布/治理同步。曾授权补GetBucketInfo，但同对象替代检查已通过，无需改IAM。只继续已有原视频及原工作流，禁止额外付费重发视频、无关历史修复、删除备份；前次v0.7.18授权不复用。

当前状态：`RELEASE_NOT_PASSED / READONLY_BRIDGE_ACTIVE / DOWNLOAD_SAVE_PERFORMANCE_REPAIR`。初始v0.7.18/schema44只读核验的目标工作流 `ea47f2a5-bc7e-4a73-8e24-3336ea164528` 前9项成功且投影完成，视频第10项仍恢复中，第11项文字等待。不是重新判断旧失败工作流。

视频task `fc2cb668-654d-4c1c-8052-5c450c0ea114`，原Provider任务已返回结果；下载流TIMEOUT后，publication `5c68e571-e23f-4ab3-9055-dfe6152ff042` 进入compensating，但字节数0、完整哈希NULL。磁盘仅有183777字节不完整staging，无最终文件、无删除意图。OSS补偿要求完整文件身份，故反复拒绝；输出slot又被compensating占用，后台租约持续更新却无法推进。证据由只读SQL、精确文件元数据、限定journal和当前源码交叉确认。这是最初只读定位记录；后续授权诊断见下方断点。

## 受影响合同

[生成架构](spec/UNBOUNDRY_GENERATION_ARCHITECTURE.md)2.2/2.3/3.1；[UI合同](spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md)5.9。

## 必须保留的行为

上述生成合同的自动找回原结果、同task/attempt保存所有权、输出slot完整身份、未知计费保护、取消与真实终态、成功节点与投影保护，以及UI合同的统一错误语义。不改变画布写入、布局、前端控件、模型选择或金额/订阅功能。

验证方法：临时数据、假OSS流式下载中断，经过真实publication补偿与恢复链复现；缺对象、有对象、HEAD未知、并发/租约、取消、原task重查、多输出及成功节点保护回归。只走safe runner，动态loopback；不使用真实数据/Provider/OSS。两个永久保护JSON不得访问。

## 局部修复候选与风险

优先复用现有补偿和原请求下载通道。对精确生成身份下的未完成staging（严格byte_size=0/checksum=NULL），仅在只读HEAD后同一对象的有界签名GET返回可信NoSuchKey错误体，确认精确OSS对象不存在后，才清理该不完整本地staging并结束补偿，使同一输出slot能保存原结果。HEAD返回对象则保留证据，不发DELETE；网络、鉴权或桶异常不当作对象不存在。完整哈希素材继续现有精确身份及版本删除保护，用户上传逻辑不变。独立审查发现SDK会混淆无响应体404与缺桶，候选已改用同对象签名GET的原始非空XML核验；无可信缺失证明时保留证据，不自动修改云权限。新分支仅适用于原任务仍running/recovering、精确Provider响应身份且有远端任务号、有效保存令牌及schema44输出编号。取消、无ID同步和历史无编号记录不进入新分支。代码及本地复审通过不等于生产恢复完成。

本次不重跑已成功的9个节点、不新增视频Provider POST、不手工改生产终态、不覆盖数据库、不降schema；不把程序技术检查写成真实工作流已恢复。真实旧记录已只读匹配原请求保护条件，云端精确缺失证明已通过，最新保全与云端核验已通过。

## 断点与证据

工程检查：最终m108/m88/m93/m38为89/89；后续恢复包入口m93/m38定向29/29，复用未改60项，不重复累加118项。m81/m38为62/62，候选独立代码复核GO。全部走专用Node22 safe runner与合成临时数据。发现清单1416项不代表全量执行，旧/tmp日志不可读，原结果依据当时工具回执。

独立复核：已复核原task/attempt/slot、可信NoSuchKey、lease接手和完整素材删除保护；部署时追加的真实慢下载时限问题不在既有通过范围，现为阻断项。

PR177最终head与main CI均PASS，annotated v0.7.19指向`6af63dde4c6698b3d57f70dc203f6a36144dff72`，tree `14589420457fd800931929106582d6c6c5be15a3`。精确包986源文件/6217文件，真实Linux新→桥→新隔离演练通过。不可变tag/产品包不改写；GitHub Release仍草稿。

最新事故保全与独立fresh restore通过，664项ready云素材对应575份去重文件，938份加密云对象1774817480字节及远端清单全部PUT/GET核验PASS。曾有检查目录错配、上传运行UID错配，均在保护现场的情况下修正并复核，保留失败材料。未改IAM、无云DELETE，不修每日备份。

2026-09-11 11:59 UTC v0.7.19启动健康、schema44未迁移，旧视频publication已failed释放，新publication可沿同task/attempt下载原结果；但连续多次60秒总下载TIMEOUT，不能记原视频或尾部文字成功。仍无新视频Provider attempt，9个成功节点与旧未知任务未变。源码`providerResultMedia.ts`覆盖统一180秒为60秒，总时限包括整个响应体且进展不重置；正在核对真实视频大小/速率，并独立审查有限总时限与无进展超时修复。后续源码确认：视频/音频每块两次Io检查均重新打开writer，触发全库校验和两次全库摘要，是明确的性能缺陷；本地改为复用既有runtime事务通道，每块仍实时检查task/token/fence/取消、目录/数据库身份及维护标记。

12:06 UTC已停止新应用，SHUTDOWN_DEADLINE导致进程退出1，rollback首次因systemd failed状态被拒。确认PID2569070不存在、cgroup空、4173关闭并保存证据后，仅reset-failed再执行已审回退；当前只读schema44桥已启动，原数据保留，公网仍维护。候选start/回退/备份等实际证据均在主机`/var/lib/unboundry-v0719-media-download-recovery-20260911/evidence`，本地操作目录`/Users/mymy/Documents/unboundry-release-ops-20260911/v0719`。不得套用此前成功DRAFT文案或生成虚假的通过回执。

2026-09-11 12:55 UTC重新核验应用inactive、schema44桥active。原Provider状态GET与媒体HEAD/64KiB范围GET诊断：原结果成功、15934485字节，样本48ms；数据/密钥指纹不变，Provider POST和OSS调用均0。随后独立完整无Range GET核验15934485字节用时2846ms、SHA256 b0437df7e6e3105511e786bce3393b72afe018ef953449b68ab8516d5884373f；只流式核验不保存，数据库/密钥指纹不变，Provider POST/OSS均0。完整诊断回执SHA bc9ee9ee04d9ab33940c404656c520a1930c8cba4aac24f7d735d1896391c9f5，位于上述本地操作目录/v0720-original-full-transfer-probe.json。失败发布事实见[v0.7.19失败回执](spec/V0_7_19_FAILED_RELEASE_RECEIPT_2026-09-11.json)。safe runner子进程继承输出描述符导致Node native abort，改为私有pipe后离线安装、沙箱负向测试、类型/源码/build/restart门通过。新增冻结清单1425；m107/m108/m26/m54/m88实际105/105通过、fail/skip/retry/blocked均0，源码快照97e58c9b5847d0818f3f5fd32dfcc0cbc8f939f7ad5f44342a58b6ad23879c8b，日志v0720-download-save-regression-r1.log。包括视频/音频多块流、实际Canvas保存入口、另一连接心跳写入、取消/fence中止、原结果恢复和旧多输出/素材保护。deadline及runtime通道独立代码审查GO；m81/m38版本与文档门62/62通过（日志v0720-release-doc-regression.log，快照a67aa3b448715e07923a729aec0e05f20b2b05f1e2c7443d0d8de65d3133efda）。本轮合计实际167项、未重跑业务full；新包Linux演练与GitHub CI尚待执行。

v19失败后41表只读比对：integrity/FK通过，第一9/旧unknown/Provider attempts未变。另两旧失败图片各新增3轮既有AUTOMATIC_RESULT_RECOVERY→running→failed事件，216af保存lease变化；无新增Provider attempt或publication，但不能称非目标数据完全没变。当前最终业务guard仍NO-GO，正在独立核对该原有自动恢复行为与精确发布保护范围，未放宽全表门。

用户验收：本次原真实视频仍未完成，`PRODUCTION_USER_RECHECK`；不继承旧USER_PASS。

## 下一步

追加本地候选v0.7.20，分支codex/v0720-media-download-deadline，远端tag未占用。只读核对原视频大小、下载速度和超时来源；补修并回归下载策略，保留自动恢复、取消和原请求防重复保护，独立复审通过后再进行后续发布。现有v0.7.19 tag不可更改；任何下一候选须用新patch身份及自己的发布门。GitHub本轮额外预算最多$10，全部CI结束后恢复$0；用户已设置预算并完成设备授权，不重复登录。

前次v0.7.18技术结果由其发布回执维护；本次失败不能写成已恢复。每日自动备份、视频/音频空按钮仍USER_DEFERRED。
