# MODEL-CONTRACT-001 实时断点

更新时间：2026-08-27

当前状态：`V0_6_50_PRODUCTION_TECHNICAL_PASS / VERSION_A_COMPLETE / VERSION_B_COMPLETE / COMPUTER_USE_EXECUTED_WITH_BLOCKERS / REVIEW_P0_0_P1_0_GO / FORMAL_FULL_EXECUTED_ONCE_1077_OF_1079 / TARGETED_STALE_ASSERTIONS_PASS / PR_CI_PENDING / RELEASE_GATE_CLOSED / USER_RECHECK`

## 0.000 唯一正式full与陈旧断言收口（2026-08-27）

- 本Goal唯一正式safe full已严格只执行一次，执行源码为commit `e56df4efcf607ab7e9c79a94cc8c205b96bbe798`：122 specs、1079 tests，`1077 PASS / 2 FAIL`，skipped/retries/blocked/reportErrors均0；immutable release builder `1 attempt / 5 invocations PASS`，source/snapshot `459770bee1b30e933bed13e243cf82bb12f354d4dba76bf2350e4f90af5c76b9`，4173监听哈希保持`24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`。
- 两项失败都来自测试仍期待版本A修复前的语义：m100把unknown outcome当成`PROVIDER_RESULT_MISSING`并允许retry/写Canvas错误；m81把已越过付费边界的attempt降级为`provider-failed`。产品当前的`OUTCOME_UNKNOWN_BILLING_RISK`、禁止retry、Canvas零写和attempt保持`accepted`均符合冻结政策，因此只同步陈旧断言。
- 断言收口commit为`2821f0579d4f455109349232e053502670686c03`/tree`4ea5af76002f149b16d21ac8b637672d0fc3da18`。首次m100+m81定向准确暴露m100仍有两处派生陈旧断言，m81同时`41/41 PASS`；随后只重跑失败最小集m100并`13/13 PASS`，source/snapshot `9dde121af3e7f2b4b8bba92de171fe9aa27a754782a5704cdd87b0aab04471e9`，4173不变。没有第二次full。
- 当前累计仍为真实Provider POST 0、Generation 0、OSS写0、生产写0、新费用0；schema继续为41。Browser阻塞与27项`USER_RECHECK`账本不变，不升级`USER_PASS`。
- 唯一下一动作：推送当前候选、创建PR并等待最终CI；CI通过后停在生产发布授权门，不merge/tag/Release/生产写。

## 0.00 独立全量Review与P1关闭（2026-08-27）

- 冻结候选`54b08282a9a91f5d476ae00e561e6faaba4af19f`/tree`8134df0dd6c61cc50c3847b48c4ee853946eae90`的独立只读终审首轮为`P0=0 / P1=2 / NO-GO`：一是模板影响只比较capability schema，未覆盖execution contract/runtime/connector/binding；二是reconcile API可凭手工字符串把unknown attempt提升为accepted并绑定Provider task ID。
- 修复commit为`979d448256fb5f58970eafae41f6ea17c0282c1b`/tree`5701870b2f69f285ac356b0824cef315f4126f0a`：模板影响现使用稳定、执行相关的完整合同签名，draft/validate/publish/rollback统一保守阻断引用模板；手工Provider task ID一律以`PROVIDER_TASK_ID_UNVERIFIED`拒绝，只有Provider只读账本的唯一匹配可进入明确命名的verified绑定入口。
- 受影响safe证据：第一次因新增独立test使冻结inventory从1079变1080而在发现门准确失败，未执行目标spec；把断言并入既有m102测试后，m102+m38为`22/22 PASS`，source/snapshot `cfcd2210a5db3d5edb4f2683e8c3c3c4df2a7106eea1912e60f24f69e014720a`。随后只增加稳定键序规范，精确复验m102 `7/7 PASS`，source/snapshot `6c4f0876b143569d03d3bcb053a53b64f69d1aaf9aa3938bacb86da57041f562`；Node`22.23.1`/npm`10.9.8`，4173不变。
- 同一审查线程在冻结修复候选上增量复核为`P0=0 / P1=0 / GO`，未发现新P0/P1；Browser的`USER_RECHECK`阻塞仍不等于`USER_PASS`。
- 候选临时数据目录已移动到用户Trash，可恢复；没有触碰生产或用户项目数据。当前Goal真实Provider POST 0、Generation 0、OSS写0、生产写0、新费用0。
- 该阶段下一动作已完成；当前唯一下一动作以上方0.000节为准。

## 0.0 版本 B 与候选浏览器执行（2026-08-27）

- 版本B已冻结为commit `31b3d28489742b69846eac6f3826a5c0289a1f69` / tree `956c1e78d01e216fe2d62f2a33420ed8fd5cd79d`。工作台现明确区分当前页面、已保存草稿与当前发布版本；当前页本地校验是纯校验，零保存、零发布、零CAS、零Provider；草稿保存继续使用CAS，发布只接受已保存且验证通过的非脏草稿。
- 当前页面、已保存草稿和当前发布版本均有始终可发现的脱敏预览；只展示假Prompt/假URL/相对路径/模式角色，不含API Key、Authorization、Cookie、签名URL或真实素材。模式/角色内部ID由系统生成，普通管理员只操作中文语义；只读值改为静态`output`，checkbox/select统一灰阶并保留键盘语义。
- 官方文档建议已去除不能支撑EXACT的平台首页/营销页；保留OpenAI、Google、xAI、Kling、火山模型精确文档和Mureka精确changelog。GK首帧的冻结内部精确证据不被营销首页替代，文生视频仍为`UNKNOWN/BLOCKED`。
- 当前源码最小受影响safe证据：m102首轮仅因测试locator同时匹配“保存草稿/已保存草稿”而`6/7`，精确修正测试后`7/7 PASS`；m20 `1/1 PASS`。Node `22.23.1` / npm `10.9.8`，safe preflight、生产构建、架构/源码/secret和动态loopback门通过，4173不变；没有运行full。
- 候选Computer Use在动态`127.0.0.1:49312`、新临时数据目录、fake本地Provider上执行；种入11个四模态模型和11份发布合同，Provider生成POST为0。已证明11张卡合同状态、三列八区工作台、三态、本地校验零写/零Provider、预览脱敏、编辑后校验失效、草稿持久、内部ID不可编辑、模式/角色语义和发布API不可变revision。
- 浏览器工具在处理原生确认对话框时两次重置，Computer Use只返回窗口标题而无截图/可访问性树。因此27项均已执行到安全候选或前置条件边界，但不能把工具未覆盖项冒充通过：候选通过为1、2、3、4、6、7、8、9、25；5、10、11、12、13、14、15、19、20、21、22、23、24、26、27保留`USER_RECHECK/INSUFFICIENT_BROWSER_EVIDENCE`；16因GK文生视频证据UNKNOWN正确阻断，17因真实Provider费用门阻断，18没有发起新视频。发布/回滚API和m102有自动证据，但不替代缺失的浏览器确认。
- 临时候选发布只发生在隔离数据：草稿v4从活动revision1发布为不可变revision2，Provider生成POST 0；没有生产写、真实Provider、OSS或费用。当前Goal累计账本仍为真实Provider POST 0、Generation 0、OSS写0、生产写0、新费用0；既有`⚡2.182`不可换算人民币，真实付费分支继续阻断。
- 保护路径偏差继续保留：版本A曾误发起一次`shasum`，没有摘要输出或变更；之后未再读取或执行Git操作。
- 该阶段下一动作已完成；当前唯一下一动作以上方0.00节为准。

## 0.1 版本 A 付费安全候选（2026-08-27）

- schema保持41。付费边界后的`AUTH/PERMISSION/RATE_LIMIT/NETWORK/TIMEOUT/REMOTE/PROVIDER_RESULT_FORMAT`均保留为`outcome-unknown`；稳定任务码为`OUTCOME_UNKNOWN_BILLING_RISK`，UI不显示新付费重试。只有明确`PROVIDER_REFUNDED`或`PROVIDER_NOT_ACCEPTED_NO_CHARGE`才可开放新attempt。
- “核对结果”在无task ID/查询空时只把原任务标为不确定；不会创建任务或Provider attempt。m38 API证据在核对前后task数与paid-attempt计数完全不变，随后retry仍为`RETRY_OUTCOME_UNKNOWN`。
- GPT Image新增白名单`output[].type=image_generation_call/result=<PNG base64>`成功结构，仍执行PNG、大小和结果安全链；未知/仿冒结构继续`PROVIDER_RESULT_FORMAT`并禁止重提。Mureka 429解析`Retry-After`，只提示多久后核对原任务，单次fixture请求数为1。
- GK证据下沉到模式级：文生视频为`UNKNOWN/BLOCKED`并在Provider前拒绝；首帧模式为`EXACT/declarative`，继续只接受Prompt+恰好1张first-frame。
- 当前源码的最小受影响safe证据：m5 `22/22 PASS`、m38 `15/15 PASS`，Node`22.23.1`/npm`10.9.8`，source/snapshot均为`229370b0939d4a0aae5b4e9f8436f5bdefad3897058aad3aa5899426e2a70317`，4173不变；m22 `41/41 PASS`覆盖未知格式中性提示。此前同一版本A改动下m102 `7/7`、m26 `10/10`、m53 `26/26 PASS`，其后未修改对应GK compiler/default、Mureka adapter或GPT Image parser，因此按“不重复已成功且未受影响测试”保留有效回执。
- safe runner预检、生产构建、架构/源码/secret与动态loopback门均通过；测试只用新临时目录、fake Provider/OSS和假数据。当前Goal累计真实Provider POST 0、Generation 0、OSS写0、生产写0、新费用0；既有`⚡2.182`仍不可换算，真实付费分支继续阻断。
- 首轮m38曾暴露两个当前源码不一致断言：AUTH/PERMISSION新语义应为unknown，以及CURRENT_STATE治理标记后缀不满足既有正则；精确修正后只重跑m38并`15/15 PASS`。没有运行full。
- 保护路径事件：版本A收口自检时误发起一次针对`spec/public-templates-director-split-revision.json`的`shasum`命令；命令没有产生摘要输出，未修改、未暂存、未提交该路径。此后不再对该路径执行任何读取或Git操作。该偏差必须保留在最终回执中，不冒充“从未尝试读取”。
- 版本A独立提交已形成：commit `584e4071c87ae06b980e091df47ce0aaa3e03b4f` / tree `c85bd81a8775ef786bf3146583ae57c2ee00ec53`。提交后剩余dirty仅为进入本Goal前冻结的版本B/历史治理差异：`AGENTS.md`、`client/src/App.tsx`、`client/src/styles.css`、`server/modelReleaseDefaults.ts`、四份历史MODEL-CONTRACT文档、`tests/m102-model-execution-contracts.spec.ts`和`上线规矩.md`；没有丢弃或覆盖。
- 唯一下一动作：进入版本B，逐块审查并完成工作台三态、CAS/本地校验/预览、精确官方文档、模式/角色人话界面、UI和可访问性；仍不得开始27项浏览器复验或正式full。

## 0. 本 Session 返工 R0 现场冻结（2026-08-27）

- 唯一最新 Goal 已由用户明确启动；只执行`MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_GOAL_PROMPT_2026-08-27.md`代码块，不恢复或拼接历史 Goal。
- `git fetch --prune origin`后复核：工作树`/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`，分支`codex/model-contract-user-recheck-fixes`，`HEAD = origin/main = cc9df2a57aca8abc68596ee398e19de6bd0b4ef3`，tree `f91bfb23d30da1b0f8b0543f11c6d2ed3e397dc3`。
- R0开始时不是“只有4个文件”：实际为14个tracked修改和3个untracked返工文档。4个产品候选文件属于进入本Goal前的未提交差异；其余治理/方案差异也属于进入本Goal前的现场。全部保留，不用`reset/clean/checkout`覆盖，也不冒充本Session实现证据。
- R0冻结文件SHA-256：`AGENTS 427a57ec…55ff`、`TASKS d3f8cd1b…e6e1`、`App 0c56b7a8…d3f9`、`styles 2e32d129…e85f`、`modelReleaseDefaults ac1e335d…2670`、原矩阵`c076de7a…4887`、checkpoint`591aa1f9…eb40`、历史Goal`db70b3f1…91ac`、原方案`9545037a…8462`、原用户清单`54557dbd…1c31`、总矩阵`74a95737…ca48`、CURRENT_STATE`e852b6ff…6787`、m102`b7b8e72e…4d01`、上线规矩`41477381…c393`、新返工矩阵`8a81852e…a779`、新Goal`36733a0b…08f9`、新方案`fc5c632b…e545`；`git diff --check`通过。
- 已逐块审查4个产品候选差异：CAS稳定错误码与部分预览/UI文案可保留；但“先保存草稿才可本地校验”、普通管理员可编辑内部mode/role ID、非精确文档首页支撑EXACT和隐藏caret断言均与新Goal冲突，必须在版本B纠正。
- 只读生产复核：公网`v0.6.50`，live/ready健康；当前release`/opt/unboundry/releases/v0.6.50-model-contract-workbench-entry-20260827`，service active/enabled、`NRestarts=0`，schema41、quick_check ok、FK0、active tasks 0。旧4173监听仍属于历史工作树`/Users/mymy/Documents/unboundry/app`，未触碰。
- 只读账本显示生产数据自历史回执后有用户活动，但本Goal没有生产写、Provider请求、OSS写或费用。既有平台账本`⚡2.182`无法核验人民币换算，因此本Goal后续真实付费生成保持阻断；只用fake Provider、临时数据和既有任务证据。
- GitHub只读复核：最新不可移动版本为`v0.6.50`、无开放PR；当前最小未占用patch建议为`v0.6.51`，候选冻结前必须再次核验。
- 版本A根因已关闭：平台查询空/无task ID不再调用“确认缺失”或补提交，而是复用schema41的`outcome-unknown`并写稳定码`OUTCOME_UNKNOWN_BILLING_RISK`；只有权威未受理/未计费或已退款证据才允许新付费attempt。
- R0本身没有测试或提交；版本A已完成最小受影响safe定向验证和独立commit/checkpoint，现进入版本B。

## 1. 当前身份与版本

- 隔离工作树：`/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`；当前分支`codex/model-contract-user-recheck-fixes`，`HEAD = origin/main = cc9df2a57aca8abc68596ee398e19de6bd0b4ef3` / tree `f91bfb23d30da1b0f8b0543f11c6d2ed3e397dc3`。
- 进入本Goal前已有4个产品候选文件：`client/src/App.tsx`、`client/src/styles.css`、`server/modelReleaseDefaults.ts`、`tests/m102-model-execution-contracts.spec.ts`，合计336 insertions/28 deletions；R0已冻结并逐块审查，保留有效内容但不把它们冒充已完成。
- v0.6.48产品已由PR #112合并，merge `c9db1dd20fcddee877425ade9879a9b87aab093e` / tree `c34957940ee51763f49d74d2109a7e954e53a799`，tag与GitHub Release已发布；生产切换前恢复演练准确暴露bootstrap审计actor不满足`users`外键，因此v0.6.48没有激活到生产。
- v0.6.49已由PR #113合并为`3a0b58375db6cb64246d9cf2634519918629fb69` / tree `de1607724b54048474c056a5cb6326071308381c`，tag/GitHub Release和生产发布完成。生产实页随后发现活动模型没有“合同工作台”入口P1；按同一版本线最小未占用patch自动选择`v0.6.50`。当前hotfix基线为`origin/main@3a0b58375db6cb64246d9cf2634519918629fb69` / tree `de1607724b54048474c056a5cb6326071308381c`，schema继续保持`41`。
- v0.6.50已由PR #114合并为`d3f5490f524b2d8d212ef7607d85afbf1981ca05` / tree `5b12ebeb97ed7a0e9ed34927fca51de2d0fd38ad`；PR/main CI、不可移动tag/GitHub Release均通过。
- 普通开发：Node `25.9.0` / npm `11.12.1`；safe/release兼容通道：Node `22.23.1` / npm `10.9.8`。
- 生产当前为v0.6.50：`/opt/unboundry/releases/v0.6.50-model-contract-workbench-entry-20260827`，Node `22.23.2` / npm `10.9.8`，service active/enabled，`NRestarts=0`；schema41、integrity ok、FK0。活动模型入口P1已由生产浏览器关闭，技术状态为`PRODUCTION_V0_6_50_TECHNICAL_PASS / USER_RECHECK`。
- 4173既有监听属于旧工作树，全部safe回执均为`listener4173=unchanged`。受保护JSON未读取、未修改、未暂存。

### 1.1 2026-08-27 用户复验返工入口

- 用户要求由 Computer Use 代为执行原27项清单；本轮真实验收结果为15项通过、12项失败或证据不足，不能升级`USER_PASS`。
- P0：GK/grok-video-3可能已计费但无task ID/结果，现有恢复路径把“平台匹配为空”误当“未提交”并开放新付费尝试；GPT Image已计费但结果解析失败；Mureka出现429。真实账本合计`⚡2.182`，平台未提供可核验人民币换算。
- P1：合同工作台的草稿/发布/未保存状态不清、本地校验误触发CAS冲突、预览入口不可发现、部分官方文档缺失或不精确、模式/角色内部ID暴露、校验禁用原因不清、原生蓝色checkbox和只读输入光标不符合UI规范。
- 新权威方案：`spec/MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_PLAN_2026-08-27.md`。
- 新返工矩阵：`spec/MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_ACCEPTANCE_MATRIX_2026-08-27.md`。
- 新Session Goal：`spec/MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_GOAL_PROMPT_2026-08-27.md`。
- 固定施工顺序：版本A付费安全与结果恢复 → 版本B工作台/文档/UI/Provider兼容 → 27项Computer Use → 独立只读全量Review → 修复P0/P1 → 唯一safe full → PR/CI候选 → 生产发布授权门。

## 2. R0-R6实现事实

- [x] R0：四类节点、图片工具、11个生产已发布模型、6个Provider profile、connector、模板和恢复路径完成EXACT/SPECIALIZED/GENERIC_GUESS/UNKNOWN分类。
- [x] R1：增加有限白名单合同schema/compiler、确定性hash、互斥模式检查、不可变`ModelReleaseRevision`、草稿CAS、验证、原子发布、回滚、停止/恢复新任务、审计历史和task完整revision快照；不增加schema版本。
- [x] R2：增加独立`/admin/models/:id/contract`工作台和7条OpenAPI路由，覆盖八区块、草稿、本地零Provider验证、脱敏预览、模板影响、发布、历史、回滚、停止/恢复和冲突恢复；四视口无横向溢出。
- [x] R3：GK-video-3仅开放文生视频和恰好1张`first-frame`图片两种互斥模式；图片只进入`params.images`；创建、task ID、poll和单结果字段采用冻结精确合同。
- [x] R4：Doubao TTS、grok imagine继续走代码拥有的显式映射；`kwvideo-v2`因`UNKNOWN`发布不可执行`blocked`快照并阻断新任务。未把共用端点冒充共用字段或把UNKNOWN伪造为可执行合同。
- [x] R5：Text和GPT Image发布revision但继续走各自专用connector；Files API、同步图片、尺寸与输入准备链不降级。
- [x] R6：Ark native与Mureka native发布专用代码revision；签名、素材、任务、结果和Suno多结果继续由代码拥有。
- [x] 发布模型bootstrap在恢复的生产副本上完成：11/11发布、第二次0新增幂等、marker 1、integrity ok、FK0；tasks 898、attempts 906、active 0、模板50/已发布48不变，Provider/Generation/OSS/费用0。
- [x] marker之后，新发布模型没有active revision即拒绝新任务；新任务冻结revision；Provider边界重新校验自身document/compiler/hash及model/profile/credential快照；旧运行中任务不被后来发布或回滚改写。
- [x] 首轮独立终审`P0=3 / P1=8 / NO-GO`后已逐项修复：所有角色和Provider参数在每个声明式模式中恰好消费一次；`generic-async-media`只允许GK及精确create/poll/state/result合同；Suno等专用模型不能切换runtime；声明式POST结果未知立即人工核对且不恢复/重提；发布/回滚事务内重读模型与模板；revoke不被发布/回滚清除；角色kind/order/shape/min/max稳定且不能删除；能力schema清洗后必须精确一致；官方URL和常量不能携带凭据；冲突可看diff；checkbox不使用原生蓝。
- [x] 同一审查线程第二轮给出`P0=1 / P1=2 / NO-GO`后已逐项修复：GK合同发布必须与代码核准的两种模式、角色和Provider字段精确同hash；绑定目标不能改为connector未开放字段；验证预览会按真实模式、角色最小输入和能力默认值逐一编译，不再展示固定假请求；模式身份同时冻结ordered与shape。
- [x] R7：11个已发布模型均有可追溯revision，GK关闭旧generic guessing；SPECIALIZED继续走代码合同，UNKNOWN保持阻断；模板、旧任务恢复、停止/回滚、安全fake矩阵与终审门均通过，没有为完成R7伪造UNKNOWN合同。

## 3. 当前验证账本

- 默认Node25：`npm run build` PASS；`npm run check:architecture` PASS。
- safe定向A：m102+m20+m77，3 specs、18/18 PASS，source/snapshot `94528eb6…67066`。
- safe受影响回归：21 specs、286/286 PASS，source/snapshot `94528eb6…67066`。
- Provider边界hash加固后的最小复验：m102+m38，2 specs、21/21 PASS，source/snapshot `d58f7c9e…5d72c`。
- 版本/治理/不可变构建门：m38+m81+m94，3 specs、60/60 PASS，immutable release builder 1次/5次调用均通过，source/snapshot `dedcb87f…e542`。
- 首轮终审修复后：默认Node25 `npm run build` PASS；受影响组合m102+m12+m20+m38+m77为5 specs、40/40 PASS，source/snapshot `576f828a…db734`；补齐声明式参数全消费和文档收敛后最小复验m102+m38为2 specs、22/22 PASS，source/snapshot `2893682f…f3013`，4173不变。
- 第二轮终审修复后的最小复验：m102为1 spec、7/7 PASS，source/snapshot `080c2a07…0aa0df7`；直接覆盖GK额外模式/角色、错误目标、真实双模式编译预览和UI消费，4173不变。
- 第二轮状态文档收敛后的治理复验：m38为1 spec、15/15 PASS，source/snapshot `ddc24056…d181d8`，4173不变。
- 本Goal唯一正式safe full在commit `57b5eca4118f3f2d66dc0e8d82ef6a42927ec9c3` / tree `5871d78fec44eb436ad5b8773e749a84015b1a6d`执行：122/122 specs、1074/1076 PASS，failed 2、其余skipped/retries/blocked/reportErrors均0，immutable release builder 1次/5次调用PASS，source/snapshot `2ac9d743…ba97b7`，4173不变。唯二失败均为本轮UI直接治理门：m18发现新工作台使用未授权字号，m45发现ordered复选框缺共享类。
- 精确修复只把字号收敛至12/14/22并补`admin-compact-checkbox`，不改产品语义；同一修复源码下只复验失败的m18+m45，2 specs、4/4 PASS，source/snapshot `7a0eb6bb…0d99cf`，4173不变。未运行第二次full。
- GitHub前状态文档治理m38首轮14/15仅因CURRENT_STATE一句话去掉既有机器正则所需空格；恢复规范句式后15/15 PASS，source/snapshot `94223333…2f94e6`，4173不变；没有重复业务spec或full。
- v0.6.48 GitHub完成：PR #112、PR Quality run `32982686296`、merge `c9db1dd`、main Quality run `32982829352`、不可移动tag与Release `v0.6.48`均成功。
- v0.6.48生产预切换：精确tag archive SHA-256 `58d5aaa8…1fb3`，Node22 fresh build与release inventory `60c03ace…1206`通过；静默门79秒保持tasks 898、attempts 906、active 0、media 885、publications 476、canvases 68不变；冻结备份`/var/lib/unboundry-rollbacks/v0.6.48-model-contracts-V0m1Mv`源/恢复各366文件，双清单SHA-256均为`b34a2a15…a66a`。恢复bootstrap在任何生产写入和指针切换前因审计actor FK失败；生产保持v0.6.47并恢复active/enabled、NRestarts=0。
- v0.6.49最小hotfix：固定system actor改为auth-owned transaction command确定性选择最早活跃管理员；无有效actor仍fail-closed；package/lock和final runtime admission同步v0.6.49。第一次定向因新版本尚未加入runtime allowlist在测试启动前阻断；补齐后m102+m81为2 specs、48/48 PASS，source/snapshot `2b2ff7aa…7f69c`，4173不变；没有重复本Goal正式full。
- v0.6.49状态文档门m38首轮14/15只暴露三份渐进治理文档仍为`CURRENT_V0_6_48`；同步到当前package前缀后最小复验15/15 PASS，source/snapshot `ad60d49b…c0830`，4173不变；未重复业务spec或正式full。
- v0.6.49候选已在保留的正式冻结恢复副本上复现验证：修复前基线schema41、integrity ok、FK0、audit239、contract events0；首轮bootstrap发布11/11、`paidProviderRequests=0`，第二轮发布0/跳过11且marker不新增；修复后integrity/FK继续通过，tasks898、attempts906、active0、media885、publications476、canvases68、models20/已发布11、templates50/已发布48均不变，audit273、contract events34、publish11、marker1。生产源与当前指针未触碰；精确tag后仍须重新验证。
- 同一独立审查线程完成v0.6.49 bounded hotfix复核：确认真实活跃管理员actor满足FK/审计身份、版本/runtime admission一致、正式恢复副本真实CLI闭环；结论`P0=0 / P1=0 / GO`。P2仅为未来把actor选择与逐模型bootstrap并入更窄并发边界、补测试内真实FK表，不阻断本次发布。
- v0.6.49 GitHub与生产已完成：PR #113、替换PR Quality run `32997764316`、merge `3a0b58375db6cb64246d9cf2634519918629fb69`、main Quality run `32997854877`、不可移动tag/Release均通过；精确tag恢复首次11/11、二次0新增，生产bootstrap同样首次11/11、二次0新增。权威备份`/var/lib/unboundry-rollbacks/v0.6.49-cutover-final.WZ1GPK`源/恢复各366文件、manifest `2c33c4b278e1d7b0497d5b75fa99da7f0d1e6e0dceb56d2d3a3ca4f71b6ff4f3`；切换后65秒计数稳定且五个静态资产逐字节一致。
- v0.6.50入口热修：把既有“合同工作台”动作从仅归档分支提升到活动、停用、归档模型共享动作；m102增加活动模型实页入口断言。默认Node25 build PASS；Node22.23.1/npm10.9.8下m102+m81为2 specs、48/48 PASS，source/snapshot `4acb1d3c4abd425a0f767cc64f2e797905b6bf5475f8515ba7e58943312ab029`。文档同步后m38首轮14/15只发现AGENTS缺机器要求的精确生产版本句式；修正后最小复验1 spec、15/15 PASS，source/snapshot `1cadc543b0540f4ed00f647b795d46f97b10df0beea854db6d331eb8db7cda5a`，failed/skipped/retries/blocked/reportErrors=0、4173不变；未重复业务spec或正式full。
- v0.6.50独立增量Review首轮为`P0=0 / P1=1 / NO-GO`，唯一P1是总矩阵、上线规矩与三份渐进治理文档仍把v0.6.47当当前生产。精确统一为v0.6.49/schema41与v0.6.50候选后，m38最小复验15/15 PASS，source/snapshot `12677da36c57b59f442816aff14b71e9487c0592d3686bf6d0cddee1da0bb1e4`；同一审查线程最终为`P0=0 / P1=0 / GO`。P2仅为未来补停用/归档模型入口实页断言；共享渲染逻辑已证明三类模型共用单一入口，不阻断发布。
- v0.6.50 GitHub完成：PR #114、PR Quality run `33001209607`、merge `d3f5490f524b2d8d212ef7607d85afbf1981ca05`、main Quality run `33001297571`、annotated tag object `4700ce73694c5d277a356fc9f0049b09e5e120d9`与GitHub Release均成功；tag和merge tree均为`5b12ebeb97ed7a0e9ed34927fca51de2d0fd38ad`。
- v0.6.50生产完成：精确tag archive SHA-256 `90fa1e816b91a32c29fbe56d2b20d48a88c75ed7bcede06265e89322ea14792e`，fresh build/inventory通过；权威备份`/var/lib/unboundry-rollbacks/v0.6.50-cutover-final.6gFJQc`源/恢复各366文件、manifest `81b1b5937ec335fb3fdf210bbbc51a9042b2b1ce0a5ad659d63d4f0a811fa1f7`。66秒静默门、原子切换、六资源逐字节、最终数据快照和journal门通过。
- 生产浏览器确认14张模型卡有14个“合同工作台”入口；grok-video-3活动模型进入八区块工作台，文生视频与恰好1张首帧模式、published revision 1和EXACT证据可见。1280×720、1440×900、1920×1080、900×900均无横向溢出；保存/校验/发布/撤销/回滚均未点击。
- 最终只读快照保持tasks898、attempts906、active0、media885、publications476、canvases68、models20/已发布11、templates50/已发布48、audit273、contract34、publish11、marker1；schema41/integrity ok/FK0，service active/enabled、NRestarts0。Provider控制面/Generation/OSS/费用仍为0。
- 这些是风险驱动定向验证，不称为full。当前修复候选回执failed/skipped/retries/blocked/reportErrors均0，Provider/Generation/OSS/费用0，4173不变。
- 早期隔离恢复fixture的11/11 bootstrap只能证明纯逻辑路径；v0.6.48正式生产冻结恢复副本随后暴露真实`users`外键差异并fail-closed。因此正式生产门以v0.6.48失败与v0.6.49重新演练为准，不把fixture结果冒充生产恢复通过。

## 4. 严格状态分层

- 自动工程证据：`TARGETED_AUTO_PASS`。
- 正式safe full：`EXECUTED_ONCE / 1074_OF_1076 / TWO_DIRECT_UI_GATES_FIXED / TARGETED_4_OF_4_PASS / NO_SECOND_FULL`。
- 独立Review：主实现同一线程首轮`P0=3 / P1=8 / NO-GO`、第二轮`P0=1 / P1=2 / NO-GO`、第三轮`P0=0 / P1=0 / GO`；full后两处UI治理修复同线程增量复核仍为GO。v0.6.50入口热修增量Review首轮`P0=0 / P1=1 / NO-GO`，文档语义冲突修复后同一线程最终`P0=0 / P1=0 / GO`。审查均只读且未运行测试。
- GitHub/merge/tag/Release：v0.6.48、v0.6.49与v0.6.50均已完成；v0.6.50为PR #114 / merge `d3f5490f…1ca05` / immutable tag+Release。
- 生产发布/技术验收：v0.6.50零schema/零数据迁移发布、生产实页与四视口技术复验通过，状态`PRODUCTION_V0_6_50_TECHNICAL_PASS`。
- v0.6.50原发布技术门的真实Provider控制面、真实生成、OSS测试写入、费用历史值为`0 / 0 / 0 / 0`；2026-08-27用户复验另有真实生成与平台账本`⚡2.182`，不得合并抹零，也不得在无法换算时冒充人民币金额。
- 成片视觉质量与服装款式保持：`USER_RECHECK`，不得由请求快照冒充通过。
- `USER_PASS`：未取得，只有用户按最终手工清单明确确认后才能写入。

## 5. 唯一下一动作

在当前冻结源码与同步治理文档上执行本Goal唯一一次正式safe full。之后形成PR/CI候选，并在merge/tag/GitHub Release/生产写入之前停在最终发布授权门；无论full结果如何不得为刷绿重复执行。

恢复顺序改为：`AGENTS.md → 上线规矩.md → CURRENT_STATE → 本checkpoint → 新返工方案 → 新返工矩阵 → 原主方案 → 原独立矩阵 → 原用户清单 → TASKS顶部 → 总验收矩阵顶部`。受保护文件`spec/public-templates-director-split-revision.json`永远不得读取、修改、暂存、提交、移动或删除。
