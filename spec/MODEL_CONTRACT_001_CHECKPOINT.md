# MODEL-CONTRACT-001 实时断点

更新时间：2026-08-26

当前状态：`R0-R7_IMPLEMENTED / REVIEW_P0_0_P1_0_GO / SINGLE_FULL_EXECUTED_TARGETED_REPAIR_PASS / GITHUB_NEXT / USER_RECHECK_PENDING`

## 1. 当前身份与版本

- 隔离工作树：`/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`；分支：`codex/model-contract-001-2026-08-26`。
- 干净基线：`origin/main = 7b475416a77cdee8d7b04ce965600551aa16858c`；tree `eb0882df4f729f4cf4893e652168f7fd1cc46dbc`。产品候选已冻结为commit `4aef16fdc93e8cf799d7d00d50cb5c57a418f5fe` / tree `01594eb72555553a0bc70c0c923650fbfa762bb3`；后续仅允许证据文档和发布回执提交。
- 基线package/生产为v0.6.47；2026-08-26实时检查确认远端tag和GitHub Release最高均为v0.6.47且v0.6.48未占用，因此候选自动定为`v0.6.48`。schema保持`41`。
- 普通开发：Node `25.9.0` / npm `11.12.1`；safe/release兼容通道：Node `22.23.1` / npm `10.9.8`。
- 生产仍为v0.6.47：`/opt/unboundry/releases/v0.6.47-governance-node25-20260826`，Node `22.23.2` / npm `10.9.8`，service active/enabled，`NRestarts=0`。本Goal尚未改生产。
- 4173既有监听属于旧工作树，全部safe回执均为`listener4173=unchanged`。受保护JSON未读取、未修改、未暂存。

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
- 这些是风险驱动定向验证，不称为full。当前修复候选回执failed/skipped/retries/blocked/reportErrors均0，Provider/Generation/OSS/费用0，4173不变。
- 生产恢复副本bootstrap：source snapshot SHA-256 `022cfbb31773758da4ce786d74c69fab6d123ecf55eb14e84fd9ddb56db7293c`、15192064 bytes；临时本地与远端副本已删除，生产源未写。

## 4. 严格状态分层

- 自动工程证据：`TARGETED_AUTO_PASS`。
- 正式safe full：`EXECUTED_ONCE / 1074_OF_1076 / TWO_DIRECT_UI_GATES_FIXED / TARGETED_4_OF_4_PASS / NO_SECOND_FULL`。
- 独立Review：同一线程首轮`P0=3 / P1=8 / NO-GO`、第二轮`P0=1 / P1=2 / NO-GO`、第三轮`P0=0 / P1=0 / GO`；full后两处UI治理修复的同线程增量复核仍为`P0=0 / P1=0 / GO`。审查均只读且未运行测试。可选P2仅为补充ordered/shape独立hash断言，实现已把两者纳入签名，不阻断发布。
- GitHub/merge/tag/Release：`AUTHORIZED_NOT_STARTED`。
- 生产发布/技术验收：`AUTHORIZED_NOT_STARTED`。
- 真实Provider控制面、真实生成、OSS测试写入、费用：`0 / 0 / 0 / 0`。
- 成片视觉质量与服装款式保持：`USER_RECHECK`，不得由请求快照冒充通过。
- `USER_PASS`：未取得，只有用户按最终手工清单明确确认后才能写入。

## 5. 唯一下一动作

推送当前分支、创建PR并等待CI；CI通过后合并、创建不可移动v0.6.48 tag与GitHub Release，再按生产门发布。

恢复顺序仍为：`AGENTS.md → 上线规矩.md → CURRENT_STATE → 本checkpoint → 主方案 → 独立矩阵 → Goal prompt → TASKS顶部 → 总验收矩阵顶部`。受保护文件`spec/public-templates-director-split-revision.json`永远不得读取、修改、暂存、提交、移动或删除。
