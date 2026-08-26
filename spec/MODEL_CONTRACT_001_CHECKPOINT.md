# MODEL-CONTRACT-001 实时断点

更新时间：2026-08-26

当前状态：`R0-R7_IMPLEMENTED / V0_6_48_FAIL_CLOSED_BEFORE_SWITCH / V0_6_49_HOTFIX_REVIEW_GO / GITHUB_NEXT / USER_RECHECK_PENDING`

## 1. 当前身份与版本

- 隔离工作树：`/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`；当前分支：`codex/model-contract-bootstrap-hotfix-v0.6.49`。
- v0.6.48产品已由PR #112合并，merge `c9db1dd20fcddee877425ade9879a9b87aab093e` / tree `c34957940ee51763f49d74d2109a7e954e53a799`，tag与GitHub Release已发布；生产切换前恢复演练准确暴露bootstrap审计actor不满足`users`外键，因此v0.6.48没有激活到生产。
- v0.6.48已占用后，实时检查确认v0.6.49远端tag与GitHub Release均未占用；按Goal规则自动顺延到`v0.6.49`，schema继续保持`41`。当前hotfix基线为`origin/main@c9db1dd` / tree `c349579`。
- 普通开发：Node `25.9.0` / npm `11.12.1`；safe/release兼容通道：Node `22.23.1` / npm `10.9.8`。
- 生产仍为v0.6.47：`/opt/unboundry/releases/v0.6.47-governance-node25-20260826`，Node `22.23.2` / npm `10.9.8`，service active/enabled，`NRestarts=0`。失败发生在恢复副本、生产bootstrap和指针切换之前；旧服务已恢复且生产数据未被本轮bootstrap修改。
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
- v0.6.48 GitHub完成：PR #112、PR Quality run `32982686296`、merge `c9db1dd`、main Quality run `32982829352`、不可移动tag与Release `v0.6.48`均成功。
- v0.6.48生产预切换：精确tag archive SHA-256 `58d5aaa8…1fb3`，Node22 fresh build与release inventory `60c03ace…1206`通过；静默门79秒保持tasks 898、attempts 906、active 0、media 885、publications 476、canvases 68不变；冻结备份`/var/lib/unboundry-rollbacks/v0.6.48-model-contracts-V0m1Mv`源/恢复各366文件，双清单SHA-256均为`b34a2a15…a66a`。恢复bootstrap在任何生产写入和指针切换前因审计actor FK失败；生产保持v0.6.47并恢复active/enabled、NRestarts=0。
- v0.6.49最小hotfix：固定system actor改为auth-owned transaction command确定性选择最早活跃管理员；无有效actor仍fail-closed；package/lock和final runtime admission同步v0.6.49。第一次定向因新版本尚未加入runtime allowlist在测试启动前阻断；补齐后m102+m81为2 specs、48/48 PASS，source/snapshot `2b2ff7aa…7f69c`，4173不变；没有重复本Goal正式full。
- v0.6.49状态文档门m38首轮14/15只暴露三份渐进治理文档仍为`CURRENT_V0_6_48`；同步到当前package前缀后最小复验15/15 PASS，source/snapshot `ad60d49b…c0830`，4173不变；未重复业务spec或正式full。
- v0.6.49候选已在保留的正式冻结恢复副本上复现验证：修复前基线schema41、integrity ok、FK0、audit239、contract events0；首轮bootstrap发布11/11、`paidProviderRequests=0`，第二轮发布0/跳过11且marker不新增；修复后integrity/FK继续通过，tasks898、attempts906、active0、media885、publications476、canvases68、models20/已发布11、templates50/已发布48均不变，audit273、contract events34、publish11、marker1。生产源与当前指针未触碰；精确tag后仍须重新验证。
- 同一独立审查线程完成v0.6.49 bounded hotfix复核：确认真实活跃管理员actor满足FK/审计身份、版本/runtime admission一致、正式恢复副本真实CLI闭环；结论`P0=0 / P1=0 / GO`。P2仅为未来把actor选择与逐模型bootstrap并入更窄并发边界、补测试内真实FK表，不阻断本次发布。
- 这些是风险驱动定向验证，不称为full。当前修复候选回执failed/skipped/retries/blocked/reportErrors均0，Provider/Generation/OSS/费用0，4173不变。
- 早期隔离恢复fixture的11/11 bootstrap只能证明纯逻辑路径；v0.6.48正式生产冻结恢复副本随后暴露真实`users`外键差异并fail-closed。因此正式生产门以v0.6.48失败与v0.6.49重新演练为准，不把fixture结果冒充生产恢复通过。

## 4. 严格状态分层

- 自动工程证据：`TARGETED_AUTO_PASS`。
- 正式safe full：`EXECUTED_ONCE / 1074_OF_1076 / TWO_DIRECT_UI_GATES_FIXED / TARGETED_4_OF_4_PASS / NO_SECOND_FULL`。
- 独立Review：同一线程首轮`P0=3 / P1=8 / NO-GO`、第二轮`P0=1 / P1=2 / NO-GO`、第三轮`P0=0 / P1=0 / GO`；full后两处UI治理修复的同线程增量复核仍为`P0=0 / P1=0 / GO`。审查均只读且未运行测试。可选P2仅为补充ordered/shape独立hash断言，实现已把两者纳入签名，不阻断发布。
- GitHub/merge/tag/Release：v0.6.48已完成；v0.6.49 hotfix独立复核GO，待commit/PR/CI/tag/Release。
- 生产发布/技术验收：v0.6.48在恢复副本门fail-closed，生产未切换；v0.6.49待不可变tag重新执行恢复与生产门。
- 真实Provider控制面、真实生成、OSS测试写入、费用：`0 / 0 / 0 / 0`。
- 成片视觉质量与服装款式保持：`USER_RECHECK`，不得由请求快照冒充通过。
- `USER_PASS`：未取得，只有用户按最终手工清单明确确认后才能写入。

## 5. 唯一下一动作

提交v0.6.49 hotfix、创建PR并等待CI；通过后合并、发布不可移动v0.6.49 tag/Release，并从精确tag重新执行恢复副本bootstrap和生产切换。

恢复顺序仍为：`AGENTS.md → 上线规矩.md → CURRENT_STATE → 本checkpoint → 主方案 → 独立矩阵 → Goal prompt → TASKS顶部 → 总验收矩阵顶部`。受保护文件`spec/public-templates-director-split-revision.json`永远不得读取、修改、暂存、提交、移动或删除。
