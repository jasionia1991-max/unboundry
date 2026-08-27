# INC-GEN-016 实时断点

状态：`V0_6_56_REVIEW_P1_2_REMEDIATED / INCREMENTAL_REVIEW_PENDING / RELEASE_GATE_CLOSED / USER_RECHECK`

更新时间：2026-08-28

## 当前事实

### 2026-08-28 v0.6.56 独立Review首轮

- 冻结候选`c29295ce23727f50806a2cf422e128c52386f8d3`、tree`03972428fe234586fcddf823209e105af223e742`的独立只读Review为`P0=0/P1=2/NO-GO`；没有push、发布、生产写或真实Provider请求。
- P1-1：有限声明式解析仍接受数字`0`或字符串`"0"`；需明确拒绝零值并补双负向fixture。P1-2：唯一实施方案残留“当前生产v0.6.54”历史句，与v0.6.56的R0生产v0.6.55身份冲突。
- 两项正在最小修复：只在声明式有限候选中拒绝全零ID，不扩大通用connector；实施方案明确当前生产v0.6.55并把v0.6.54/事故起点改为历史证据。修复后只复验m102和文档门m38，再冻结新commit交回同一Review线程。
- 两项已最小修复：m102+m38 `29/29 PASS`，failed/skipped/retries/reportErrors/blocked均0，source/snapshot `6cb0ce4461e2010232a6729d565aebaf8de40337db15dca28e49075647be6e12`，4173监听不变；没有重复m53/m81/m88或运行full，真实Provider/OSS/生产写/费用0。下一步只冻结增量commit并交回同一Review线程复核。

### 2026-08-28 v0.6.56 预期红、实现与定向绿

- 预期红只执行m102：发现122 specs/1090 tests，13项中12通过、唯一失败精确落在真实数字`data.task_ids[]`/`data.任务ids[]`无法提取；Node22.23.1/npm10.9.8，source/snapshot `32c0c2af8de8ff0ec0b8989da0227095c2867fd91b4e150aba7c36465eb2d7e7`，4173监听不变，真实Provider/OSS/生产写/费用0。
- 实现保持顶层`task_id`为canonical，只新增两个已观测数组别名；每个出现的数组必须恰好一个安全整数或安全字符串，所有出现路径规范化后必须唯一一致。空数组、多值、别名冲突、canonical冲突、非整数、危险字符串、`data.task_id`和`data.id`均继续以可恢复`FORMAT`失败，不扩张任意JSONPath。
- 修复后m102 `13/13 PASS`，source/snapshot `29e7603ec163a10c148de8519bd1ea72fab6cdfa81a54601bf0f6a32c1faef3e`；版本同步为package/lock `0.6.56`，schema保持41，final runtime admission增加0.6.56。
- 共享adapter、媒体publication和版本准入风险定向m53+m81+m88共`103/103 PASS`，failed/skipped/retries/reportErrors/blocked均0，source/snapshot `90d11593f069b31b134f2d2d9e888ad9a1f277642bc27e16e48536d73394c21b`，4173监听不变。未重复m102、未运行full；真实Provider/OSS/生产写和新增USD20预算消费仍为0。
- 文档治理首次命令因误写不存在的m38文件名在执行前阻断，随后两次只暴露`UNBOUNDRY_CURRENT_STATE.md`的旧固定版本标签格式；只修正文档标签后最小复验m38 `16/16 PASS`，source/snapshot `f1ca77e28bdfe54c6102db516a0aa2a61e766559749029eea1d01e34dd33cf8a`，没有重复业务spec或运行full。
- 下一门是冻结候选commit后进行一次独立只读Review；Review未给出`P0=0/P1=0/GO`前不得push、发布、生产写或真实生成。

### 2026-08-28 v0.6.56 新Goal R0实时基线

- 用户明确指定新版本`v0.6.56`，新增真实生成总预算上限USD20，并授权修复、Review、GitHub/CI、不可移动tag/Release、生产备份恢复发布回滚和同一目标Canvas真实GK验收。首单预估上限USD10；只有明确未受理/未扣费或退款时最多允许一次替代提交，任何unknown禁止第二次Provider POST。
- 新干净隔离工作树：`/Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28`；分支`codex/inc-gen-016-v0.6.56`；基线`origin/main@86e17db78559a83e781e75ba8c1b1eaa0079ac0e`、tree`97cc8165fdbb0c17a54914fccbc11dbe8f8c1e55`。远端`v0.6.56`未占用；R0时package为0.6.55，schema41，默认Node25.9.0/npm11.12.1。
- 生产只读身份：v0.6.55/schema41，公网live/ready通过，active lease和写入准入正常；release仍为`/opt/unboundry/releases/v0.6.55-inc-gen-016-20260828`，service active/enabled、NRestarts0。
- R0生产计数：tasks954、provider attempts964、active0、当前`OUTCOME_UNKNOWN_BILLING_RISK`任务0、media910、publications501、canvases72、models20、published models10、templates50、published templates48。
- 10个当前已发布模型身份、capability、provider model和protocol已重新从生产脱敏冻结；未计划修改的专用connector、模板、Canvas和历史Revision必须保持不变。
- 目标Canvas`67bfb2ee-f895-4308-9111-9de188306514`为revision296/graphRevision138、42节点/72边；目标节点存在，仍为`grok-video-3`、9:16、720p、10秒、音频开启、输出1，生成false，错误`PROVIDER_REFUNDED`，没有result asset。
- 目标task`da761fff-6a65-46fd-84cf-4dc5bddbc985`保持failed/attempt3/`PROVIDER_REFUNDED`、actual cost 0、provider task ID/result asset均空；attempt2为`PROVIDER_NOT_ACCEPTED_NO_CHARGE`，attempt3为明确退款。旧USD20授权已消费；本次新增USD20尚未消费。
- 已证实的新缺口是Provider真实创建响应含数字`data.task_ids[]`和数字`data.任务ids[]`，而`submitContractRelayMedia()`只读取顶层`task_id`。v0.6.56只允许把这两个已证实有限路径规范化为唯一一致task ID；不得扩张为万能猜测、任意JSONPath或接受多值冲突。
- 受保护`spec/public-templates-director-split-revision.json`未读取、未修改、未暂存；历史工作树未清理；R0期间真实Provider/Generation/OSS写和新费用均0。

### 2026-08-28 生产发布与真实Provider最终结果

- 冻结实现commit `5860c51be9602a0292ba343f80d63b2104d6c98f`；发布候选commit `8ffcdeb4be9b48acc3e9e5c58b054238eafbc420`、tree `5be35b37ada49576e43c80fefb01b102cbe4e086`。PR #122 Quality run `33100464212`、main Quality run `33100549022`通过；merge `7bdc40f67697e1e3be735db947d3b26ba5b6c0bd`。
- 注释tag `v0.6.55`对象`77b705f6fa20a0f8d4ac2285fc8122933514122c`精确指向merge，GitHub Release已发布。tag archive SHA-256 `4017968c1c50196c55eb1de036aa76579eaefb93e4120976f6754ccbd1255745`，生产release `/opt/unboundry/releases/v0.6.55-inc-gen-016-20260828`，inventory SHA-256 `0912e077fa48762baef7f4ee78b68e3e5cac6d25e75d36820a1bdeaf94713103`。
- 生产冻结备份`/var/lib/unboundry-rollbacks/v0.6.55-cutover-frozen.wcaUii`，source manifest `72d57c9fdd079d9b6441b1b49b3d56004bf20a4ad156c1ce97fd137dc341afcc`；恢复副本演练、原子切换和回滚门通过。回滚测试曾触发systemd `StartLimitBurst`，已`reset-failed`后先恢复v0.6.54健康，再完成v0.6.55前向切换；这是已安全处置的运维节流，不是应用或数据失败。
- 最终生产v0.6.55/schema41，service active/enabled、NRestarts0，公网/回环live/ready通过，journal error 0；rollout为目标account+Canvas allowlist。最终计数tasks954、attempts964、active0、unknown-billing tasks0、media910、publications501、canvases72；02:19:48～02:20:54的66秒稳定门计数不变。
- 历史attempt2的Provider完整当日消费账本和作品列表均无目标记录，明确证明未受理、未扣费且不可能返回结果；冻结备份`/var/lib/unboundry-rollbacks/v0.6.55-inc-gen-016-nocharge.T0evyW`，DB SHA-256 `99eed262d0e624855794e561b54f296f496d8b6e6b8472bfc93ebcdc458af1ff`。attempt2收口为`definitive-rejected / PROVIDER_NOT_ACCEPTED_NO_CHARGE`、实际费用0。
- 只在上述无扣费证据成立后，普通页面只点击一次重试，产生本Goal允许的唯一替代attempt3。Provider于2026-08-28 02:14:27返回HTTP 200，响应为192字节，含数字`data.task_ids[]`与数字`data.任务ids[]`，当前解析器未提取到字符串task ID；没有再次POST。
- Provider权威账本随后显示该GK-video-3为`已退款`、金额0.924、当日成功0、退款1；没有结果作品。冻结备份`/var/lib/unboundry-rollbacks/v0.6.55-inc-gen-016-refund.lL33YP`，DB SHA-256 `5f64577b630a3ddfe717c38bdf15351d603109805eb20768f4d05abf7ba27a21`。attempt3收口为`provider-failed / PROVIDER_REFUNDED`；task最终failed，`provider_task_id/result_asset_id=null`、实际费用0。
- 生产Canvas刷新后显示“平台未完成本次生成，费用已全额退回；未再次提交”，APR-020真实退款UI通过。没有视频结果、结果资产或刷新播放证据，因此APR-021～023成功条件失败；版本、发布和真实提交授权全部消费完毕，禁止再次Provider POST。
- 权威回执：`spec/V0_6_55_PRODUCTION_RECEIPT_2026-08-28.json`。最终结论严格为`PRODUCTION_TECHNICAL_PASS / REAL_PROVIDER_REFUNDED / NO_RESULT / USER_RECHECK`，不得写`REAL_PROVIDER_PASS`或`USER_PASS`。
- 生产回执与权威状态同步后只运行文档治理最小集m38：`16/16 PASS`，failed/skipped/retries/reportErrors/blocked均0；Node22.23.1/npm10.9.8，source/snapshot SHA-256均为`28e85a90c6735578f10e024a0338a5952607550352f2d923649a072671aa663d`，4173 listener unchanged。没有重复业务spec或唯一full。

### 2026-08-27 新 Goal R0 实时基线

- 用户已在新Session用完整Goal明确启动实施；本次授权覆盖INC-GEN-016代码、测试、本地commit、GitHub PR/CI/merge、不可变`v0.6.55` Release、可恢复生产发布和一次受控GK首帧真实验收。费用总上限USD 20；第一次提交估算上限USD 10；任何未知结果都禁止第二次Provider POST。
- 实施工作树：`/Users/mymy/Documents/unboundry-model-contract-002-2026-08-27`；分支`codex/inc-gen-016-v0.6.55`；基线`origin/main@384c27f152b`。规划文档先冻结为commit`f74529f86aa57050f238b0bc3d4ef4cfc0d8fe8e`，tree`4a8e5382d9076e0c5b86598abe2404ddb4a5a485`。
- `v0.6.55`本地tag、远端tag和GitHub Release均未占用。候选package/lock已同步为`0.6.55`；schema仍为41。默认工具链Node`25.9.0`/npm`11.12.1`；safe复现通道Node`22.23.1`/npm`10.9.8`；生产只读核对Node`22.23.2`/npm`10.9.8`。
- 生产只读身份：公网`/api/version=0.6.54`、live/ready通过；`/opt/unboundry/current -> /opt/unboundry/releases/v0.6.54-model-contract-revision-20260827`；service active/enabled、NRestarts0；schema41、quick_check ok、FK0。
- R0生产计数：tasks954、provider attempts963、active0、unknown-billing tasks1、media910、publications501、canvases72、models20、published models10、templates50、published templates48。
- 目标Canvas保持revision291/graphRevision134、42节点/72边；目标GK节点仍为9:16、720p、10秒、音频开启、输出1。事故task`da761fff-6a65-46fd-84cf-4dc5bddbc985`仍为attempt2/failed/`OUTCOME_UNKNOWN_BILLING_RISK`，providerTaskId/resultAssetId/actualCost均空，估算USD10；没有发起第二次Provider POST。
- 已冻结10个当前已发布模型的真实身份与默认能力；模型、binding、Provider、模板、Canvas、task和attempt脱敏摘要均已记录在本Goal现场证据中，后续发布前必须与R0逐项对比。
- 受保护`spec/public-templates-director-split-revision.json`未读取、未修改、未暂存；历史脏工作树未清理、未覆盖；4173监听未占用、未终止。

### R0 预期红

- 命令：`PATH=/Users/mymy/.local/bin:$PATH npm run test:safe -- --spec m102-model-execution-contracts.spec.ts --spec m5-generation-task-store.spec.ts`。
- 发现122 specs/1086 tests；只执行2 specs/36 tests，34通过、2个预期失败：GK成功响应含`request_id/metadata`时被`relayProviderAdapters.ts`顶层精确白名单拒绝；paid boundary后从`running -> recovering`被旧状态机拒绝。
- source/snapshot均为`41fd15b19cff6e6dcf0814aeecf6105fc4ef140234efb2e6c02bda8111d55c36`；suite已清理；4173 listener hash`24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`前后不变。
- 全程使用新临时目录、动态loopback和fake数据；真实Provider/Generation/OSS/生产写/费用均为0。R0至此完成，R1～R5进入实现；这不是候选冻结、Review或发布放行。

### R1～R5 候选与定向证据

- 声明式GK创建响应继续只从合同声明的`task_id`取值，但允许`request_id/state/metadata`等无害外壳字段；HTTP状态、Content-Type、响应大小、request ID、脱敏字段路径和结构哈希写入任务事件，不保存secret、prompt、签名URL或原始媒体。
- paid boundary后响应丢失进入持久`recovering`；后台Worker以SQLite CAS租约接管，按30秒到15分钟指数退避。唯一账本匹配只绑定原attempt/providerTaskId并继续poll，零/多候选保持恢复；超出Provider窗口加24小时保留期进入`OPERATOR_INCIDENT`管理员队列。任何unknown均阻止新paid attempt。
- Provider结果仍先经既有原子媒体publication形成正式`result_asset_id`，任务成功与Canvas generation-owned CAS投影解耦；重启恢复、重复交付和Canvas冲突继续复用现有持久任务/资产/投影合同。
- 普通任务面板及Image/Video/Audio节点不再展示人工“核对结果”；服务端摘要固定`reconcileAllowed=false`，兼容API保留但不进入普通用户流程。
- 定向绿证据：m102+m5 `38/38`，m38 `16/16`，m53-server+m57+m68+m88 `70/70`，三类媒体节点+m68 `22/22`，全模型/connector矩阵 `82/82`；所有失败/重试/跳过均0。source/snapshot末次为`74c7db3d697f5d102301b759adb840387e19100e329e0341c309bbd037cbea64`，4173 listener始终不变。
- 所有定向验证只使用本轮新临时目录、动态loopback、Fake Provider/OSS；真实Provider/OSS/生产写/费用仍为0。正式safe full尚未运行，必须等候选冻结后的独立Review最终GO。

### 独立Review首轮、第二轮与修复

- 冻结候选commit `4fe7ad6a686663857faaf36ccf48269e036cd675`的唯一独立Review首轮为`P0=3/P1=4/NO-GO`；没有运行safe full、发布或生产写。
- 已修复：同一Provider task恢复保持原execution attempt并可完成原账本；Ark/Mureka及所有unsafe no-ID attempt重启后保持recovering且零重提；远端错误正文不再进入任务/UI/日志；账本匹配使用不受CAS checkpoint改写的Provider attempt→首次recovery窗口；`OPERATOR_INCIDENT`不再被自动恢复；权威文档不再把当前Goal写成文档-only；relay/Ark/Mureka完整记录成功、HTTP失败、超限和畸形响应的脱敏结构证据，事件按任务去重并上限64条。
- 受影响定向验证：首轮5 specs/75 tests中72通过，3项失败均为旧测试预期；按最小范围修正后m26+m5 `35/35 PASS`。其余同轮m102 `13/13`、m16 `11/11`、m38 `16/16`已通过。全部使用safe runner、Node22.23.1、新临时目录、动态loopback和Fake Provider，4173监听不变，真实Provider/OSS/生产写/费用0。
- 当前候选尚未获得Review GO；下一步只能把本次修复交回同一Review线程增量复核。唯一safe full仍未运行。
- 同一Review线程第二轮复核为`P0=2/P1=4/NO-GO`：人工恢复仍会增加execution attempt；重启及relay/Ark/Mureka畸形响应仍存在退出自动恢复的路径；恢复窗口可能读到旧attempt事件；管理员事故仍可经兼容API恢复；权威文档未记录第二轮；Ark/Mureka HTTP失败证据缺少实际响应大小。
- 第二轮六项已修复：人工恢复原子保持同一attempt并可完成原Provider账本；所有unsafe no-ID协议重启后保持recovering；relay创建/轮询和Ark/Mureka畸形响应统一进入零新POST恢复；恢复窗口绑定当前Provider attempt；`OPERATOR_INCIDENT`同时阻断普通retry与兼容reconcile；HTTP失败正文只做有界丢弃并记录字节数，不持久原文。
- 最终受影响定向为m102+m16+m26+m38+m5+m53共`102/102 PASS`；同树m5+m88 `61/61 PASS`证明原attempt publication。随后m57首轮`15/16`只暴露一项已被脱敏日志合同取代的旧测试文案，修正该断言后最小复验`16/16 PASS`。Node22.23.1、临时目录、动态loopback、Fake Provider/OSS，末次source/snapshot `aa6ee9f20fdb69acf6ee8be8684aac5edf5287b7b5f2cb50fc64a08e7165342b`，4173 unchanged；真实Provider/OSS/生产写/费用0。唯一safe full仍未运行。
- 同一Review线程第三轮对冻结commit `5860c51be9602a0292ba343f80d63b2104d6c98f`、tree `128d642be2239e0c751a3cb7ced719d2b39307eb`给出`P0=0/P1=0/GO`；这是本Goal唯一独立最终Review。
- 唯一正式safe full随后执行一次：发现122 specs/1090 tests，`1089/1090 PASS`，唯一失败是m22仍断言旧文案“不会自动重提”，而产品已按已审合同显示更准确的“系统会自动找回结果且不会重复付费提交”；其余failed/retries/skipped/reportErrors/blocked均为0，immutable builder `attempts=1/builderInvocations=5/passed=1/failed=0`，source/snapshot `1400178cd9706483cf686d149278b32a14c3f18544eb69bc5e0bf52b243effe6`，4173 listener不变。
- 只同步该测试断言后，按失败最小集复验m22 `41/41 PASS`；source/snapshot `db8a7c8c3f60a7f791f47b427c42e4027f2abe674b572471687e7fc3c2f442b5`，4173 listener不变。没有第二次full，产品实现、Review结论和1090项发现清单未改变；真实Provider/OSS/生产写/费用仍为0。
- Review/full治理文档同步后，m38最小复验`16/16 PASS`，source/snapshot `90dbd6f1838caf85b694dd2eaf9fbe4d1c4a2d8e6c43159dbe612696535fd958`，4173 listener不变；没有重复业务full。

- 工作树：`/Users/mymy/Documents/unboundry-model-contract-002-2026-08-27`
- 当前 Git：`codex/inc-gen-016-v0.6.55`；冻结实现commit `5860c51be9602a0292ba343f80d63b2104d6c98f`，发布候选commit `8ffcdeb4be9b48acc3e9e5c58b054238eafbc420`，PR #122已合并。
- 当前生产：`v0.6.55 / schema41 / service healthy / PRODUCTION_TECHNICAL_PASS / USER_RECHECK`。
- 目标画布：`67bfb2ee-f895-4308-9111-9de188306514`，名称“MODEL-CONTRACT-001 真实生成验收 2026-08-27”。
- 目标节点：`video-019c3604-bae5-4880-b7ac-8410231df6a0`，`grok-video-3`，Prompt + 恰好一张首帧，9:16、720p、10秒、音频开启、输出1。
- 原任务：`da761fff-6a65-46fd-84cf-4dc5bddbc985`。attempt2已由完整Provider账本证明未受理且未扣费；唯一替代attempt3被Provider明确退款。
- 最终状态：`failed / PROVIDER_REFUNDED`；`provider_task_id=null`、`result_asset_id=null`、`actual_cost_microunits=0`。页面准确显示全额退款且未再次提交，但没有图片或视频结果。

## 最终审计结论

- 直接原因不是单一 UI 文案，而是声明式成功响应白名单、合同路径恢复旁路、用户触发 reconcile 和有界内存 recovery 共同形成的架构缺口。
- 修复必须同时覆盖有限响应合同、持久任务号、后台自动恢复、结果资产、Canvas投影和普通用户体验。
- 修复共享任务生命周期时，全部当前已发布模型、专用 connector、历史任务、旧 Canvas/模板和不可变 Revision 必须通过非回归门。
- 没有正式恢复能力的异步 connector 不得切换为可用新路径；旧路径在新路径验收成功前保持不动。
- 真实结果没有自动回到生产项目，就不能发布或关闭事故。

## 历史授权记录（已被当前Goal取代）

- 下列“只授权文档”是上一Session历史时点，已被本次新Goal的明确实施授权取代；不得反向把历史边界当成当前阻断。
- 用户随后要求生成新Session一次性Goal并提前写明实施所需权限；Goal模板冻结了v0.6.55、GitHub/生产、目标画布、真实费用USD 20上限和一次最终全量Review。用户已在本次Session完整发送并激活该Goal。
- “只能修改Markdown”“预算为0”“未来另行授权”均只描述上一Session，不是当前执行边界。
- 当前版本、发布和真实提交授权均已执行并消费；实际费用0。没有新授权不得再发Provider POST或再次发布。

## 历史文档落地验证

- `git diff --check` 通过；变更范围只有 Markdown 权威文档，没有产品代码、测试、schema、package 或锁文件变化。
- 受保护 `spec/public-templates-director-split-revision.json` 未读取、未修改、未暂存。
- 文档治理与生成事故定向 safe m38：`15/15 PASS`，failed/skipped/retries/blocked/reportErrors 均为 0；Node `22.23.1`、npm `10.9.8`，动态 loopback 与新临时目录，4173 listener unchanged。
- m38 source/snapshot SHA-256 均为 `8c72526267b8a8a1742a37a1823b1447a745bed390c7d01cc81be2c987c8a0fe`；它是文档落档时的定向证据，不是 INC-GEN-016 产品实现或完整回归。

## 恢复顺序

1. `AGENTS.md`
2. `上线规矩.md`
3. `spec/UNBOUNDRY_CURRENT_STATE.md`
4. 本文件
5. `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_PLAN_2026-08-27.md`
6. `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_ACCEPTANCE_MATRIX_2026-08-27.md`
7. `TASKS.md` 的 INC-GEN-016 区块

本次用户已用新的`/goal`明确启动并授权实现、v0.6.55发布、生产和受控真实GK验收；历史“仅文档”边界不再是当前授权。

## 唯一下一步

当前Goal在“Provider全额退款、无结果、唯一替代提交已消费”的明确停止条件下停止。不要点击页面“重试生成”；若未来继续，只能由用户另行明确授权新预算，并先修复数字task ID解析后建立新的真实验收Goal。
