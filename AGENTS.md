# Unboundry 项目级 Agent 施工守则

> **2026-09-02 INC-GEN-028 当前最高优先级**：生产运行`v0.7.2/schema42`，current=`/opt/unboundry/releases/v0.7.2-inc-gen-028-20260902`。核心工作流真实通过；保存提示本地补丁的 TypeScript、m37 `39/39`、m4 `1/1`、m2-text `8/8` 与独立 Review `P0=0/P1=0/P2=0/GO` 已完成。用户现已明确指定 `v0.7.3` 并授权上线，版本只按普通 patch 号递增、不再使用 `hotfix` 后缀；当前 package/runtime allowlist 已升到 0.7.3，但版本门、PR/CI/tag/Release、生产备份与切换尚未执行。v0.7.3 只发布保存提示修复，生产复验只允许复用现有结果做刷新和 metadata 重放，新增 Provider POST 上限为 0。当前权威为 `spec/UNBOUNDRY_CURRENT_STATE.md`、`spec/V0_7_3_RELEASE_CANDIDATE_RECEIPT_2026-09-02.json`、`spec/V0_7_2_PRODUCTION_RECEIPT_2026-09-02.json` 和 `spec/INC_GEN_026_CHECKPOINT.md` 顶部覆盖层。

> **以下 INC-GEN-025 段落是历史时点记录，不再是当前授权**：2026-09-01 当时用户 `/goal` 曾激活 INC-GEN-025，并授权 v0.6.70 实现、发布和受控验收。该授权后来已执行并消费；不得据此再次修改、发布或发起真实生成。受保护文件继续永久禁止读取、哈希、修改、暂存、移动或删除。

本文件适用于“包含本文件的 Unboundry Git 工作树”，不再用固定目录名代替仓库身份。用户最新明确指令优先；若与仓库状态或本文冲突，先停止并向用户报告，不得猜测。

历史 INC-GEN-025 发布前身份：当时生产运行`v0.6.69/schema41`，候选处于 R8。当前生产运行`v0.6.70/schema42`，且 INC-GEN-026 审计判定 workflow 业务 NO-GO；不得按本历史段继续发布或点击。

2026-09-01 INC-GEN-025 历史状态：当时的实现、定向验证、Review 和 formal full 回执原样保留；后置审计证明这些证据没有穿过关键 HTTP→admission 接缝，也漏掉同步 publication/OSS 故障，因此其 `P0=0/P1=0/GO` 不能作为当前 GO。实时断点已经迁移到 `spec/INC_GEN_026_CHECKPOINT.md`。

下方所有更早 INC/版本状态均为历史时点记录，即使原文保留“当前”字样，也不再是当前授权或当前生产播报。

2026-09-01 INC-GEN-024 当前候选状态：v0.6.69生产真实点击证明旧`cancelled / USER_ABANDONED` accepted task会永久阻止新明确点击，但重复计费围栏有效。v0.6.70候选只允许一次明确新点击在逐项匹配task/node/kind及服务端`cancelled / USER_ABANDONED`后结束旧checkpoint并执行当前图；自动恢复、普通failed、running、outcome-unknown或身份不匹配继续禁止新提交。safe m22 `45/45`、治理m38最终`18/18`与preflight通过；尚未版本化、独立Review或获得发布/再次点击授权。实时断点为`spec/INC_GEN_024_CHECKPOINT.md`。

2026-09-01 INC-GEN-021 当前候选状态：现网截图不构成整组通过；v0.6.67候选已为图片/视频/音频统一 durable staging、deferred publication 和运行时自动续传，Provider 已返回后不因短暂 OSS 故障丢弃原始字节，也不新增 attempt/Provider POST。TypeScript、diff-check与直接相关 safe specs 已通过；唯一正式safe full原始1139/1140，同源码只复验唯一无关m69失败后6/6通过，未重复full。生产仍是v0.6.66。用户已确认并允许发布v0.6.67；发布后真实整组授权为CNY300、最多11次POST、一次点击、不重试、结果不明只核对原任务。实时断点为`spec/INC_GEN_021_CHECKPOINT.md`。

2026-09-01 INC-GEN-020 当前权威状态：v0.6.66已完成candidate `1308c06…cfd31`、PR #138、merge `bbb8001…ce7bb`、PR/main CI、annotated tag/GitHub Release、exact tag fresh build、schema41冻结备份和原子生产切换；当前release=`/opt/unboundry/releases/v0.6.66-inc-gen-020-20260901`，service active/enabled、NRestarts0，公网version/live/ready与33/33静态文件门通过。原任务已在既有15分钟退避到期后自动转`RESULT_SAVE_FAILED_NO_RETRY`，三次采样active0，tasks1028/admissions948/provider attempts1039/media956/publications547不变，无新Provider POST。登录实页整组按钮可用，任务面板明确“不会重复提交”，未点击任何生成操作；节点alert尚有“自动找回中”旧文案残余，所以保持`USER_RECHECK`。v0.6.66一次性版本/发布授权已消费，新代码、新发布或Provider POST需新授权。实时断点为`spec/INC_GEN_020_CHECKPOINT.md`，回执为`spec/V0_6_66_PRODUCTION_RECEIPT_2026-09-01.json`。

2026-08-31 INC-GEN-019 当前权威状态：v0.6.65已完成PR #136双CI、不可移动tag/Release、exact tag fresh build、冻结恢复、forward→rollback→final forward、33/33静态与生产零付费门，当前release=`/opt/unboundry/releases/v0.6.65-inc-gen-019-20260831`、schema41、active/enabled、NRestarts0。业务产品+测试10/10、产品净新增199/450、Review `P0=0/P1=0/P2=0/GO`；唯一formal full原始`1133/1135`永久保留，最小关闭`62/62`，未重跑full。10/10模型available、目标11节点preflight 11/11 HTTP200，但三张图片配置上限合计USD30，按Goal折算CNY300>CNY100且无可靠实际报价，因此真实group click在付费前停止、权限未消费；新增task/admission/attempt/Provider POST/OSS/费用0。当前严格为`PRODUCTION_V0_6_65_TECHNICAL_PASS / REAL_GROUP_FLOW_NOT_RUN_BUDGET_ESTIMATE_BLOCKED / USER_RECHECK`。v0.6.65版本/tag/Release/生产发布授权已消费，禁止再次stop/restart、移动tag、重建Release或发起Provider POST。实时断点为`spec/INC_GEN_019_CHECKPOINT.md`，回执为`spec/V0_6_65_PRODUCTION_RECEIPT_2026-08-31.json`。

2026-08-31 INC-GEN-018 当前权威状态：生产运行`v0.6.64/schema41`，状态严格为`PRODUCTION_V0_6_64_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`。R0～R8技术门完成；R6冻结候选独立全量Review覆盖37/37文件、309/309 tracked hunks、10/10 published模型、11/11 registry identities、10/10数据库exact identities及全部Provider/protocol/adapter分支，结论`P0=0/P1=0/P2=7/GO`。R7唯一正式safe full原始`1131/1135`及4失败永久保留，4项均由最小直接复验关闭，5-hunk复审`P0=0/P1=0/P2=0/GO`，隔离浏览器AUTO_PASS；不得重跑formal full或改写为全绿。PR #134 final-head/main CI、不可移动tag/Release、fresh build、冻结恢复、exact Seed/TTS immutable revision迁移、repeat no-op、原子切换及paired rollback/forward均通过；生产10/10 published模型健康，7节点零付费preflight不再出现伪全局关闭，tasks1026/attempts1037不变。Provider POST、OSS写、新费用均为0；用户实页确认前不得写`USER_PASS`。历史9个图片任务的result-recovery轮询与根盘99%登记为R8 P2残余，不在本Goal内擅自重启、清历史或删除release/backup/staging。权威回执为`spec/V0_6_64_PRODUCTION_RECEIPT_2026-08-31.json`。

2026-08-27 MODEL-CONTRACT-001实时基线：生产运行`v0.6.51/schema41`；PR #116已合并为`0c63938536a3056b1b1f652486d2ea5c72ad283f`，候选、merge与tag tree均为`90861ecd464c4413a1bdfe57abad6672227f679e`，注释tag/GitHub Release、PR/main CI、fresh tag build、冻结双副本恢复门、原子切换与回滚门均已完成。生产数据完整性、33个静态文件逐字节、66秒稳定门和四视口零付费浏览器通过；当前13张可见模型卡均有合同工作台入口。真实Provider/Generation/OSS/新费用均为0，一次性v0.6.51发布授权已消费；技术状态严格为`PRODUCTION_V0_6_51_TECHNICAL_PASS / USER_RECHECK`。原隔离工作树`/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`仍含进入Goal前的用户历史改动，**不得替用户清理、覆盖或把它当成干净main**。

2026-08-27 MODEL-CONTRACT-002 当前权威状态：v0.6.52生产只读dry-run与v0.6.53冻结副本演练均fail-closed并保留为未部署不可变证据；修正版`v0.6.54`已完成PR #120/main CI、merge、tag/Release、fresh tag build、候选与生产冻结副本双幂等演练、备份、原子数据/版本切换、回滚门、33静态文件逐字节、66秒稳定门和零付费生产浏览器验收。生产运行v0.6.54/schema41，service active/enabled、NRestarts0；GK为已发布revision 2/EXACT并显示文字与单首帧，`kwvideo-v2`已归档。真实Provider/Generation/OSS/新费用均0，失败任务未重跑；当前严格为`PRODUCTION_V0_6_54_TECHNICAL_PASS / USER_RECHECK`，不得冒充成片质量或`USER_PASS`。权威回执为`spec/V0_6_54_PRODUCTION_RECEIPT_2026-08-27.json`。

2026-08-28 INC-GEN-016 当前权威状态：v0.6.55已完成PR #122/main CI、不可移动tag/Release、冻结备份/恢复演练、原子发布、回滚和稳定门；生产v0.6.55/schema41健康，unknown-billing tasks为0。历史attempt2获Provider无受理/无扣费证据后只替代提交一次，attempt3被Provider明确全额退款且无结果；项目内退款提示正确、实际费用0。当前严格为`PRODUCTION_V0_6_55_TECHNICAL_PASS / REAL_PROVIDER_REFUNDED / NO_RESULT / USER_RECHECK`。版本、发布和真实提交授权均已消费，禁止再次Provider POST，不得写`REAL_PROVIDER_PASS/USER_PASS`。回执`spec/V0_6_55_PRODUCTION_RECEIPT_2026-08-28.json`。

2026-08-28 INC-GEN-016 v0.6.56续作权威状态：生产运行`v0.6.56/schema41`，PR #124、PR/main Quality、不可移动tag/Release、fresh build、冻结备份恢复演练、原子切换、回滚与健康门均通过；有限数字task ID修复独立Review最终`P0=0/P1=0/GO`。同一目标Canvas只新增attempt4并只发出一次Provider POST，数字task ID `118533110`已持久化，真实MP4自动回填且刷新后继续可播放；实际费用USD10，unknown-billing 0，结果后60秒数据和服务稳定。当前严格为`PRODUCTION_V0_6_56_TECHNICAL_PASS / REAL_PROVIDER_PASS / USER_RECHECK`；版本、发布和真实提交授权已消费，禁止再次Provider POST或移动tag。只有用户观看成片后明确确认才可写`USER_PASS`。回执`spec/V0_6_56_PRODUCTION_RECEIPT_2026-08-28.json`；受保护JSON继续禁止读取、修改、暂存、移动或删除。

人和 AI 共用的上线拍板规矩见仓库根目录 `上线规矩.md`。发布前必须分别获得版本号确认和允许发布；一次授权只用一次。

## 1. 每次开始或上下文恢复必读

INC-GEN-028 当前状态按顺序完整阅读：

1. `spec/UNBOUNDRY_CURRENT_STATE.md` 顶部 INC-GEN-028 当前区块
2. `spec/V0_7_3_RELEASE_CANDIDATE_RECEIPT_2026-09-02.json`
3. `spec/V0_7_2_PRODUCTION_RECEIPT_2026-09-02.json`（发布前生产基线）
4. `spec/V0_7_2_RELEASE_CANDIDATE_RECEIPT_2026-09-02.json`（历史）
5. `spec/V0_7_1_HOTFIX_1_PRODUCTION_RECEIPT_2026-09-02.json`（历史）
6. `spec/INC_GEN_026_CHECKPOINT.md` 顶部 v0.7.3 发布覆盖层
7. `spec/INC_GEN_026_ACCEPTANCE_MATRIX_2026-09-01.md` 顶部覆盖层及 IG26-099～121
8. `TASKS.md`、`上线规矩.md`、`README.md` 顶部 INC-GEN-028 区块

下列旧清单只在查历史事故时按需读取，不得覆盖上面的当前路由或恢复旧授权：

1. `spec/INC_GEN_026_ONE_CLICK_WORKFLOW_RELIABILITY_FINAL_IMPLEMENTATION_PLAN_2026-09-01.md`
2. `spec/INC_GEN_026_LOCAL_IMPLEMENTATION_RECEIPT_2026-09-01.md`
3. `spec/INC_GEN_026_LOCAL_IMPLEMENTATION_GOAL_PROMPT_2026-09-01.md`（历史授权已消费；禁止复制或重新激活）
4. `spec/V0_7_0_PRODUCTION_RECEIPT_2026-09-02.json`
5. `/Users/mymy/Documents/unboundry/UNBOUNDRY_AUDIT_REPORT_AND_LEDGER_REVIEW_2026-09-01.md`
6. `spec/INC_GEN_025_CHECKPOINT.md`（历史断点；当时 Goal 与一次性授权均已执行并消费）
7. `spec/INC_GEN_025_SERVER_AUTHORITATIVE_GROUP_RUN_PLAN_2026-09-01.md`
8. `spec/INC_GEN_025_ACCEPTANCE_MATRIX_2026-09-01.md`
9. `spec/INC_GEN_025_ONE_SHOT_GOAL_PROMPT_2026-09-01.md`（历史授权已消费；禁止复制或重新激活）
10. `spec/INC_GEN_024_CHECKPOINT.md`（历史诊断断点；v0.6.70窄候选SUPERSEDED_NO_GO）
11. `spec/INC_GEN_024_EXPLICIT_TERMINAL_RESTART_PLAN_2026-09-01.md`
12. `spec/INC_GEN_024_ACCEPTANCE_MATRIX_2026-09-01.md`
13. `spec/INC_GEN_023_CHECKPOINT.md`（历史生产断点；v0.6.69已部署）
14. `spec/INC_GEN_023_SERVER_TERMINAL_DETACH_PLAN_2026-09-01.md`
15. `spec/INC_GEN_023_ACCEPTANCE_MATRIX_2026-09-01.md`
16. `spec/INC_GEN_022_CHECKPOINT.md`（历史生产断点；v0.6.68已部署）
17. `spec/INC_GEN_021_CHECKPOINT.md`（历史跨媒体可靠性断点）
18. `spec/INC_GEN_021_CROSS_MEDIA_ONE_CLICK_RELIABILITY_PLAN_2026-09-01.md`
19. `spec/INC_GEN_021_ACCEPTANCE_MATRIX_2026-09-01.md`
20. `spec/INC_GEN_020_CHECKPOINT.md`（历史生产断点；v0.6.66生产技术通过）
21. `spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_ACCEPTANCE_MATRIX_2026-08-30.md`
22. `spec/INC_GEN_018_ONE_SHOT_GOAL_PROMPT_2026-08-31.md`（历史授权已消费，不得恢复）
23. `spec/INC_GEN_017_CHECKPOINT.md`（历史生产断点）
24. `spec/INC_GEN_017_WORKFLOW_SELF_HEALING_AND_MODEL_CONTRACT_ISOLATION_PLAN_2026-08-28.md`
25. `spec/INC_GEN_017_ACCEPTANCE_MATRIX_2026-08-28.md`
26. `spec/INC_GEN_017_ONE_SHOT_GOAL_PROMPT_2026-08-28.md`（历史授权已消费，不得恢复）
27. `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_CHECKPOINT.md`（历史生产断点）
28. `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_PLAN_2026-08-27.md`
29. `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_ACCEPTANCE_MATRIX_2026-08-27.md`
30. `spec/MODEL_CONTRACT_002_CHECKPOINT.md`（历史发布断点）
31. `spec/MODEL_CONTRACT_002_IMMUTABLE_REVISION_REMEDIATION_PLAN_2026-08-27.md`
32. `spec/MODEL_CONTRACT_002_ACCEPTANCE_MATRIX_2026-08-27.md`
33. `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`
34. `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`
35. `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`
36. `TASKS.md` 当前区块
37. `spec/INCIDENT_2026-08-20_TEMPLATE_GROUP_FAILURE_AND_QUEUED_TASK_HANDOFF.md`（2026-08-20 事一/事二交接，接手必读）
38. `spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md`（事一/事二查证后的全局审计结论、修复设计与验收门）
39. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 当前区块

然后只读核对 `pwd`、Git 分支、HEAD、工作树、package 版本和 Node 版本。与施工断点不一致时停止，不得继续施工。

### 默认工具链与生产兼容通道

- 项目普通开发、类型检查、构建和新shell默认使用`.node-version`中的Node `25.9.0`与`packageManager`中的npm `11.12.1`；不得再把`/Users/mymy/.hermes/node/bin`或`/Users/mymy/.local/bin`中的Node 22预置到普通shell PATH。
- 2026-09-02 已确认 v0.7.2 生产继续运行 Node `22.23.2` / npm `10.9.8`；本次没有顺带迁移 Node/npm。
- `scripts/run-safe-tests.mjs`、源码覆盖门和历史不可变 release builder 继续使用 Node `22.23.1` / npm `10.9.8` 专用兼容通道；它是本地复现通道，不等同于已确认的生产 Node `22.23.2`，也不是项目默认 shell。在完成兼容性审计前不得删除 Node 22 边界。

## 2. 当前授权边界

- **2026-09-02 INC-GEN-028 当前最高权威**：v0.7.2 已完成 PR #148、双 CI、annotated tag/Release、exact-tag fresh build、schema42 locked-exact backup/verify/fresh restore、生产切换和 rollback-forward。指定 Canvas 的唯一真实整组执行成功，canonical `multimodal + reference-image` 贯穿 plan/task/key/ownership/request，1 admission/1 attempt/1 Provider create，结果自动回填、播放并持久化；同时确认生产存在“数据已保存但顶部误停在保存中”的 UI 状态缺陷，本地补丁已通过直接影响测试但尚未发布。一次性版本、发布与真实提交授权均已消费；任何新版本、新发布或新 Provider POST 都需要新授权，用户确认前保持 `USER_RECHECK`；

- **2026-09-02 v0.7.3 当前发布授权**：用户已指定 `v0.7.3` 并授权上线保存提示补丁；允许版本升级、提交、PR/CI、annotated tag/Release、备份、生产切换和成对 rollback-forward。此授权不包含新 Provider POST；发布后只用既有 Canvas 结果做零付费复验。版本命名以后只用普通 patch 递增，不再添加 `hotfix` 后缀；

- **2026-09-02 INC-GEN-026/v0.7.0 历史最高权威（已执行、已消费）**：R0～R8 本地实现、测试、Review、唯一 formal safe full 和文档收口已完成；full 原始 `1162/1167` 与 5 项失败如实保留，m41/m73/m81 最小关闭 `112/112 PASS`，未重复 full。v0.7.0 一次性 commit/push/PR/CI/tag/Release 与生产 schema42 backup/安装/切换/rollback-forward 已执行并消费。IG26-106 当时因缺少完整只读 workflow-run/capacity preflight 保持 `NOT_RUN`；该段不得覆盖 INC-GEN-028 当前路由或恢复任何授权；

- **2026-09-01 INC-GEN-025 历史授权状态（已执行、已消费）**：当时用户 `/goal` 曾授权该隔离工作树的一次性实现、v0.6.70、Review、GitHub/Release、成对生产迁移/回退及受控真实点击。该段只保留历史过程，不得据此继续 R6、发布、点击或产生费用；

- **2026-09-01 INC-GEN-024 当前权威状态**：用户要求一步到位解决图片/视频/音频一次点击交付。现网v0.6.69健康；本轮唯一真实整组点击已消费，Provider POST0/11、费用0，但没有生成素材，不能写验收通过。v0.6.70本地候选只允许明确新点击越过精确`cancelled / USER_ABANDONED`旧accepted task，自动恢复和结果不明边界不放宽；safe m22 `45/45`与preflight通过。v0.6.70版本/发布授权、独立Review及新的真实点击/预算授权均未取得；

- **2026-09-01 INC-GEN-020 当前权威状态**：用户的核心合同是“只点一次，系统自动保存/回收，不要求重复点击或去Provider平台找结果”。v0.6.66生产技术门已通过，原任务自动收口、整组页面解锁且无新attempt/Provider POST；实页任务面板已读验，但节点alert有一处旧文案残余，所以保持`USER_RECHECK`。v0.6.66一次性commit/push/PR/tag/Release、备份与生产切换授权已消费；新代码、新版本、新发布或Provider POST都需新授权；

- **2026-08-31 INC-GEN-018 当前权威状态**：用户已在本Session完整发送一次性Goal并启动连续实施；R0～R8技术门完成。冻结候选独立终审为`P0=0/P1=0/P2=7/GO`，唯一正式safe full原始`1131/1135`，4项最小关闭并隔离浏览器AUTO_PASS，formal full权限已消费且禁止重跑。PR #134、final-head/main CI、v0.6.64不可移动tag/Release、fresh build、冻结恢复、生产exact迁移、repeat no-op、原子切换、paired rollback/forward、10/10模型健康、7节点零付费preflight与72秒稳定门均通过。当前严格为`PRODUCTION_V0_6_64_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`；版本、GitHub、迁移和生产发布一次性权限均已消费，禁止移动tag、重建Release、再次stop/restart、再次Provider POST或把自动证据升级为`USER_PASS`；

- **2026-08-30 INC-GEN-017 当前权威状态**：生产运行`v0.6.63/schema41`。PR #132最终head/main CI、merge `55ef9557…de9b3`、不可移动tag/Release、fresh tag build、冻结恢复、原子切换、成对rollback/forward、33/33回环与公网静态字节、数据完整性及72秒7采样稳定门均通过；成对验证脚本的退出trap曾触发systemd `start-limit-hit`，确认应用forward已成功后以`reset-failed`恢复，最终service active/enabled、NRestarts0、journal warning0。后置2项P1已关闭，safe m22 44/44、m81 41/41，独立复审`P0=0/P1=0/P2=0/GO`，正式full不重跑。唯一Seedance真实Provider结果继续有效，实际费用`1.412012 CNY`、重试0、unknown0，额外Provider POST权限已消费。当前是`PRODUCTION_V0_6_63_TECHNICAL_PASS / REAL_PROVIDER_PASS / USER_RECHECK`；用户实页确认前不得写`USER_PASS`；

- **2026-08-28 INC-GEN-016 当前权威状态**：本次`/goal`授权的代码、Review、唯一safe full、GitHub/CI、v0.6.55 tag/Release、生产备份/恢复/发布/回滚和真实GK验收均已执行。生产技术通过；唯一替代attempt被Provider全额退款且没有结果，实际费用0。授权已全部消费，禁止再次Provider POST；没有真实结果，故不得写`REAL_PROVIDER_PASS/USER_PASS`；
- **2026-08-28 INC-GEN-016 v0.6.56续作授权**：修复、Review、GitHub/CI/tag/Release、生产备份恢复发布回滚和目标Canvas唯一真实GK提交均已执行；实际费用USD10，结果已回填并刷新保持。版本、发布和Provider提交授权全部消费；禁止再次POST、移动v0.6.56或把`USER_RECHECK`自升为`USER_PASS`；

- **2026-08-26 v0.6.47 当前权威状态**：生产运行`v0.6.47/schema41`，服务active/enabled、NRestarts=0；PR #110、PR/main CI、merge `24541b3`、不可移动tag/Release、fresh build、冻结备份`v0.6.47-cutover-final2-20j2R3`、恢复/schema/integrity/FK/数据门、原子切换、公网/回环/inventory/5资源和60秒稳定门通过。真实Provider/Generation/OSS/费用0；用户随后明确回复`v0.6.47 验收通过`，当前聚合状态为`PRODUCTION_V0_6_47_USER_PASS / USER_PASS`。原回执`spec/V0_6_47_PRODUCTION_RECEIPT_2026-08-26.json`保留生成时技术状态。一次性v0.6.47授权已消费，后续新代码、Provider或发布需要新授权；
- **2026-08-27 MODEL-CONTRACT-001 当前权威状态**：用户知悉本轮没有新真实付费生成且仍有`USER_RECHECK`后，明确授权PR #116与候选v0.6.51发布。PR/main CI、merge `0c639385…ea5c`、tag/Release、fresh build、冻结恢复、原子切换和回滚门均通过；生产release为`/opt/unboundry/releases/v0.6.51-model-contract-remediation-20260827`，service active/enabled、NRestarts=0，schema41/integrity/FK通过，tasks933/attempts942/active0等基线在发布与浏览器复验中不变，33个静态文件逐字节一致，四视口工作台无溢出。真实Provider/Generation/OSS/新费用均0；一次性发布授权已消费，当前严格为`PRODUCTION_V0_6_51_TECHNICAL_PASS / USER_RECHECK`，不得升级`USER_PASS`；
- **2026-08-26 INC-GEN-015 当前权威状态**：生产运行`v0.6.46/schema41`且技术健康；PR #107、PR/main Quality CI、不可移动tag/GitHub Release、fresh tag build、冻结备份/恢复和原子切换完成。目标owner`zzx`+目标Canvas的5个旧节点均复用原success task/result proof收口，Generating=false且旧task/ownership/input/run binding清空；39节点/73边、位置、连线与viewport保持。target tasks10/attempts10及global tasks825/attempts833/active0/media855/publications445/canvases68不变，Generation/Provider/Media/OSS/publication/费用0。`on → off → on`回退门通过，最终mode=`on`；用户随后在生产目标Canvas明确回复“通过”，本项收口为`PRODUCTION_V0_6_46_USER_PASS / TARGET_RECONCILIATION_PASS / ROLLOUT_ON`；权威回执`spec/V0_6_46_PRODUCTION_RECEIPT_2026-08-26.json`。一次性v0.6.46授权已消费，用户确认不授权新代码、Provider或再次发布；
- **2026-08-26 INC-GEN-014 当前权威状态**：生产运行`v0.6.44/schema41`且技术健康；工作流执行成功已与Canvas结果投影失败解耦，accepted-only刷新恢复、generation-owned字段白名单合并、applicationId幂等和credential verify双版本CAS已完成。PR #103、PR/main Quality CI、不可移动tag/GitHub Release、冻结备份与恢复副本、fresh build、原子切换、公网/回环/数据/inventory/静态资源门均通过；独立终审`P0=0 / P1=0`。真实Provider probe、Generation、OSS写入和费用均为0；当前为`PRODUCTION_V0_6_44_TECHNICAL_PASS / USER_RECHECK`，回执`spec/V0_6_44_PRODUCTION_RECEIPT_2026-08-26.json`；v0.6.44一次性实施与发布授权已消费，不得写生产`USER_PASS`，后续新代码、Provider或发布动作需要新授权；
- **2026-08-25 INC-UI-011 当前权威状态**：生产运行`v0.6.43/schema41`且技术健康；节点排序菜单Portal层级修复已完成本地`USER_PASS`、唯一safe full `121/121 specs、1061/1061 tests PASS`、PR #100与PR/main Quality CI、不可移动tag/GitHub Release、冻结恢复演练、fresh build、原子切换、公网/回环/数据/inventory/静态资源和生产零付费浏览器验证。生产菜单「宫格/水平」可见且中心点命中自身，Escape返焦，画布revision/graph_revision/updated_at不变；真实Provider、Generation、OSS写入、购买/订阅和费用为0。当前为`PRODUCTION_V0_6_43_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / LOCAL_USER_PASS / USER_RECHECK`，回执`spec/V0_6_43_PRODUCTION_RECEIPT_2026-08-25.json`；v0.6.43一次性发布授权已消费，生产用户实页确认前不得写生产`USER_PASS`；
- **2026-08-25 INC-GEN-013 当前权威状态**：生产运行`v0.6.42/schema41`且技术健康；accepted-only恢复、原生组合框拖动、定向验收、P0/P1终审、唯一safe full原始`1060/1061`及相同源码m0定向`23/23 PASS`均已记录。PR #98、PR/main Quality CI、merge、不可移动tag/GitHub Release、冻结双副本、schema41恢复副本验证、fresh build、原子发布、公网/回环/数据/inventory/全静态资源和三视口零付费浏览器均通过；真实Provider/Generation/OSS写入/费用为0。当前是`PRODUCTION_V0_6_42_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`；v0.6.42一次性GitHub与生产授权已消费，后续新代码、Provider或发布动作需要新授权；
- **2026-08-25 INC-SEEDANCE-002 当前权威状态**：生产运行`v0.6.41/schema41`且技术健康；C分支「角色风险预检」在菜单层准确禁用并保留独立的「角色可信素材」入口，PR #96、Quality CI、tag/GitHub Release、冻结双副本、schema40→41副本演练、fresh build、原子发布、公网/回环/数据/inventory/资源门和三视口零付费浏览器均已完成，回执为`spec/V0_6_41_PRODUCTION_RECEIPT_2026-08-25.json`。Provider控制面、真实审核、状态查询、Generation、OSS、订阅/购买和费用均0；当前是`PRODUCTION_V0_6_41_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`，不得写`USER_PASS`。v0.6.41一次性实施和发布授权已消费，后续新代码、Provider或发布动作需要新授权；
- **2026-08-25 INC-SEEDANCE-001 当前权威状态**：生产运行`v0.6.40/schema40`且健康；PR #92、Quality CI、tag、GitHub Release、冻结备份、fresh build、原子切换、公网/回环、数据不变和5资源门均已完成，回执为`spec/V0_6_40_PRODUCTION_RECEIPT_2026-08-24.json`。受限Provider诊断只保存HTTP状态、错误码和RequestId，不保存远端Message、Body或密钥。Project `default`已只为IAM用户`tapnow-ark-catalog-ro-20260803`补`ArkFullAccess`，用户详情显示项目限制；一次用户级误授权已立即撤销且无残留。唯一H5创建`1/1`返回远端`403 SubscriptionRequired`，无Provider session ID/H5Link/BytedToken；认证查询、Asset创建/查询、Generation、费用和OSS写入均0。当前是`PRODUCTION_V0_6_40_TECHNICAL_PASS / PROJECT_PERMISSION_APPLIED / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / BLOCKED_EXTERNAL_CAPABILITY / USER_RECHECK`；不得购买、重试、移动历史tag或复用预算，下一动作只以INC-SEEDANCE-001 Checkpoint为准；
- **2026-08-24 当前权威状态**：生产运行`v0.6.38/schema40`且技术健康，状态`PRODUCTION_PUBLISHED_USER_PASS / PROVIDER_PROTOCOL_REAL_FAIL_CLOSED / USER_PASS`。INC-IMGEDIT-006已完成R0～R11、GitHub PR #87/CI/Release、双冻结备份、schema39→40副本演练与旧runtime拒绝门、fresh build、原子发布和生产零付费浏览器复验；全屏两张高图在三视口均完整contain。真实控制链只消费1次entitlement read与唯一1次H5 create；H5 create返回503且没有H5 URL，因写请求远端副作用未知而未重试，未执行asset create、paid generation或OSS写入。用户已在生产实页明确回复“通过”，用户验收已收口，但这不把真实Provider协议失败改写为成功。权威方案为`spec/INC_IMGEDIT_006_FULLSCREEN_FIT_AND_SEEDANCE_TRUSTED_ASSET_PLAN_2026-08-24.md`，实时断点为对应Checkpoint，回执为`spec/V0_6_38_PRODUCTION_RECEIPT_2026-08-24.json`。v0.6.38发布授权和H5 create预算已消费；
- **v0.6.28 历史时点**：精确源码commit`ee6ce437730cf78ef4488217b778f6b0ef2aaee5`、tree`2811ada65140779d4a5e10cbd8ed6fa54893638b`，tag`v0.6.28`，PR #58 merge`753d24f8ee6e4facb3c88e876c4a38b456addc75`；正式safe full执行`1032/1034`，两个失败分别为0.3ms性能抖动与候选文档精确字符串，修正文档后只复验失败spec并`16/16 PASS`，未重复full。生产回执`spec/V0_6_28_PRODUCTION_RECEIPT_2026-08-21.json`；
- v0.6.18生产源码commit为`e47f50c0bde0ee23585f27b71ad8df240973161a1`、tree为`48bee3c2c050ced3d2854390ca1ef1d0aba8fae5`；注释标签`v0.6.18`精确指向该源码。PR #32已于2026-08-19合并到`main`，merge commit为`265c8f63e867e122ecab2f145c362d5bdab3bd19`。生产凭证为`spec/INC_GEN_009_UI_ALIGN_PRODUCTION_RECEIPT_2026-08-19.json`；
- v0.6.18正式安全全量为`118/118 specs、983/983 tests PASS`，异常0。管理员后台「优创尺寸映射」面板样式对齐暗黑 UI、比例下拉、文案大白话；出图逻辑不变。优创专用协议按文档像素发 1K/2K/4K，生产默认画质保持 1K；
- 冻结备份位于`/var/lib/unboundry-rollbacks/v0.6.18-frozen-vctAv7`，冻结源与恢复副本均365文件且清单SHA-256同为`b3bb61a68e03b810e8573f52d81c331f06b825feb3d67f9f4b202e3310aa7ca8`。发布与验证期间真实Provider请求、付费生成和OSS写入均为0；上一不可变release `v0.6.17-inc-gen-008-009-20260819`及对应冻结备份继续保留；
- 既有v0.6.0～v0.6.17、真实工作流与视频证据继续作为历史记录保留；其历史时点字段不得改写。用户于2026-08-18回复「全通过」只覆盖当时列出的待复验旧项；其他仍为`USER_RECHECK / PARTIAL / PAUSED / BLOCK / NOT_STARTED`的独立条目不自动升级。v0.6.17与v0.6.18生产及GitHub授权已经消费完毕，不是未来继续改生产、数据、Provider、OSS、push/tag/PR或发布的永久授权；

- REM-000 施工文档已于 2026-08-09 获用户确认，状态为 `PASS`；
- 用户已于 2026-08-09 明确启动一次性离线 Goal，合并授权 REM-001～010 与 REM-011 离线工程部分；各 REM 仍按施工总方案依赖顺序分析、实施、测试、review 和更新文档，中途不再逐项询问；
- 允许修改项目代码、测试、脚本、配置、文档、package/锁文件和必要测试依赖，允许本地专用分支与本地 checkpoint/功能/candidate commit；
- 允许动态 loopback 端口、本轮新临时目录、本地假 Provider/OSS/服务器和 Docker 测试容器；只允许终止/清理由本 Goal 创建且已核实身份的资源；
- 上述旧 Goal/bridge/final 授权均为历史已消费授权，不得复用；绝不允许擅自 push、tag、PR、SSH、生产读取/修改、真实备份、真实 Provider/OSS 或发布。

## 3. 永久红线

- 测试绝不使用 `4173`、`app/data`、`/var/lib/unboundry`、真实媒体或真实备份；
- 测试只使用本轮新建的系统临时目录和动态端口，并验证端口不等于 4173；
- REM-001 安全入口完成前，不运行默认 `npm run verify` 或自称“全量”的组合测试；
- 测试不得读取真实 Provider、OSS、代理或云账号凭据，不得访问非 loopback 网络；
- 不发起任何真实或付费 Provider 请求；
- 不修改、删除或清理真实数据和历史孤儿；只读报告也要先获得相应授权；
- 不 `git reset --hard`、不 `git clean`、不覆盖已有改动；
- 未经用户明确授权不 commit；绝不擅自 push、tag、部署、改云权限；
- 发布前必须分别获得“版本号确认”和“允许发布”；
- 数据库迁移前必须有只读一致备份、临时恢复和迁移演练。

## 4. 产品合同保护

- 站着的结果：用户上传一张图，工作流自己跑完，用户下载。中间不要再发明必须人手点的步骤。
- DATA-005：跨标签保持“最后保存者胜并同步”；只拒绝同一标签迟到旧请求。不得改成跨标签全局 CAS。
- 普通账号默认五项权限不可撤销，只维护额外授予集。
- 不恢复金额/额度/订阅功能。
- PAUSED/PARTIAL 项不得借修复改为 PASS；团队、打光、真实 Agent、社区、插件等不得擅自扩 scope。

## 5. 施工工作流

每个 REM 项必须：

1. 只读分析真实代码和影响范围；
2. 把证据、方案、风险和验收标准写入施工记录；
3. 核对动作落在用户已确认的一次性离线授权内；超出范围的分支只登记并继续其他不依赖工作；
4. 只在隔离工作区实施；
5. 运行安全专项与受影响回归；
6. 更新 `TASKS.md`、验收矩阵和施工断点；
7. 文档/工程证据完成只标 `USER_REVIEW`，需要实页的产品行为标 `USER_RECHECK`；用户确认后才标 `PASS`。

同时只允许一个 REM 项处于 IN_PROGRESS。新发现且不改变既有产品合同的 P0/P1 先登记再直接修复；无关 P2 重构、视觉改版、新功能、真实数据/外部服务或产品语义变化只登记，不扩张范围。

## 6. 恢复与失败关闭

- 内部记忆、压缩摘要和历史自动报告不是权威；
- 以用户指令、施工总方案、施工断点、Git 与当前测试证据恢复；
- 无法证明当前状态、隔离条件或授权时，默认停止；
- 不得以“应该”“大概”“历史上通过”代替当前证据；
- 定向验证不能表述为全量回归，健康接口正常不能表述为数据库或用户验收通过。
