> **历史断点路由（2026-09-06）**：本文保留对应事件的当时证据和独立未决项，不承担当前生产身份或执行授权。接手先读 [UNBOUNDRY_CURRENT_STATE.md](UNBOUNDRY_CURRENT_STATE.md) 与 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)；不得因本文旧“当前/Goal/允许发布”重启操作。未确认项目不自动升级PASS。

# MODEL-CONTRACT-002 实时断点

状态：`PRODUCTION_V0_6_54_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`

更新时间：2026-08-27

## 结论

历史 revision 完整性与当前发布政策已经拆开：合法 GK revision 1 可继续执行，当前 GK 新发布政策恢复文字与单首帧并提升为合同 version 2。显式升级会新建 revision 2，不修改 revision 1；模板影响改为语义矩阵。`kwvideo-v2` 因没有可核验的文字基础证据，候选决定为停用归档而不是伪造 `EXACT`。

v0.6.52已完成PR/CI、merge、tag/Release与fresh build，但真实生产只读dry-run发现兼容分析器没有复用产品对缺省instruction角色和legacy输入顺序的运行时默认规则，22模板因此全部fail-closed。v0.6.53完成PR #119、main CI、merge、tag/Release与fresh build，冻结生产副本演练又发现模型级升级把一个无关普通账户的无效Ark凭证当成共享Provider全局失败。两次均在生产切换和数据替换前fail-closed，生产保持v0.6.51/schema41；两个tag保持不可变，Release均标记未部署。用户要求继续发布，修正版自动递增为`v0.6.54`；最终状态上限仍是`USER_RECHECK`。

## R0 只读基线

- 隔离 worktree：`/Users/mymy/Documents/unboundry-model-contract-002-2026-08-27`
- 分支：`codex/model-contract-002-2026-08-27`
- 基线：`origin/main@41bef082b7349667b3161b705e8b705eabe84e83`
- origin：`https://github.com/jasionia1991-max/unboundry.git`
- 基线package：v0.6.51；发布候选package：v0.6.54；schema：41
- 普通工具链：Node 25.9.0/npm 11.12.1；safe runner：Node 22.23.1/npm 10.9.8；生产运行时只读核对为 Node 22.23.2/npm 10.9.8
- 4173 为历史工作树监听，本轮未占用、未终止；safe runner 每次验证 listener hash 不变
- 历史 `/Users/mymy/Documents/unboundry/app` 和 MODEL-CONTRACT-001 worktree 均不是施工基线，未清理、未覆盖
- 受保护 `spec/public-templates-director-split-revision.json` 未读取、未修改、未暂存

生产只读证据：目标任务 `da761fff-6a65-46fd-84cf-4dc5bddbc985` 为 failed；输入是 Prompt + 恰好一张 `first-frame`；没有 provider attempt、provider task ID、result 或费用。冻结 revision 1 为 `77010660-f111-4d80-a45b-6a137be3ca6d`，document hash `582683…d966`，compiler hash `566f5361…e681`，保存时文字与首帧两种模式均可执行；当前代码政策漂移是阻断根因。生产只读审计确认已发布模型11个，GK关联已发布模板22个、可执行节点34个；34个节点均为 instruction + first-frame 并唯一匹配首帧模式。GK之外没有当前政策漂移。`kwvideo-v2` 活动 revision 6 为 `UNKNOWN/blocked`，模板0、任务0、active task0、历史 Canvas 引用1，因此可安全归档并保留历史引用。

## 已实现

- 新模块 `server/currentModelReleasePolicy.ts`：当前发布政策与执行版本迁移门。
- `server/modelReleaseRevisionStore.ts`：冻结完整性稳定错误码、历史支持表、原子 CAS 升级；rollback 先通过当前发布政策，禁止重新激活已淘汰的 GK revision 1 合同。
- `server/modelReleaseDefaults.ts` / compiler/types：GK version 2，文字与单首帧 EXACT；版本 1/2 有界支持。
- `server/modelContractTemplateCompatibility.ts`：逐模板、逐节点检查真实参数、来源、ready 状态、显式角色和唯一正整数顺序，再做旧/新合同唯一匹配。
- `spec/MODEL_CONTRACT_002_PRODUCTION_TEMPLATE_MATRIX_2026-08-27.json`：R0生产只读结果的脱敏冻结矩阵，保留22个真实模板ID、34个真实GK节点ID、revision身份及执行相关归一字段，不含Prompt、媒体、URL、owner或无关graph内容；m102直接消费该证据，不再把内嵌合成ID表冒充生产矩阵。
- `server/modelContractUpgrade.ts` 与 CLI：schema41/精确11模型身份集合 dry-run、apply、repeat，输出 from/to hash、模式、漂移、Provider/profile/config/credential 脱敏快照、模板影响和零 Provider 账本；apply在`BEGIN IMMEDIATE`内以dry-run完整基线hash做CAS。共享Provider自身状态、key状态与配置版本继续全局fail-closed；账户凭证完整进入快照和CAS，但单个无关账户的无效凭证只在该账户任务边界阻断，不再阻断模型合同治理。CLI只允许固定恢复根或系统临时根内的私有隔离目录，拒绝root symlink、应用/生产数据，核对只读manifest摘要与数据库流式SHA-256。
- `server/generationTasks.ts`：已合成 Prompt 的 instruction/context-text 不再作为未声明媒体角色；其他未知角色继续 fail-closed；对外保持安全错误码，对内诊断保留冻结完整性 `causeCode`。
- `server/modelCatalog.ts`：合同影响使用语义兼容；`kwvideo-v2` 归档前检查 default、模板和 active task，并保留历史任务/Canvas。

## 验证记录

- m102 首轮发现 current policy 约束被拆得过宽；修正为只有已核准 GK 可用 declarative runtime 后，12/12 PASS。
- m12+m22+m57：6+1+16=23/23 PASS；覆盖模型管理、模板和 relay/unknown-outcome 直接依赖。
- 上述均使用 safe runner、临时目录、动态 loopback、fake 数据；source/snapshot unchanged，4173 unchanged，真实 Provider/OSS/费用0。
- 独立 Review 首轮为 `P0=0 / P1=6 / NO-GO`：模板未读取真实参数/状态、升级缺精确模型及Provider/credential快照、rollback绕过当前政策、CLI apply目录边界不足、版本签名遗漏capability schema、执行边界丢失内部完整性原因。六项均已逐项修复并补负向门，等待同一线程复核，不把修复自报为Review通过。
- 修复后 m102 `13/13 PASS`：含 schema41/精确11模型 plan/apply/repeat、Provider/profile/config/credential脱敏快照、GK revision 2、`kwvideo-v2`归档、跨模型事务故障全回滚、22/34矩阵、真实参数/输入状态/顺序、rollback当前政策、staging证明、schema版本门及稳定causeCode；source/snapshot `f746df3f6ab514b3474d49d1a9f8e157f07945a835f068f7d3c88b70e22ec231`，4173 unchanged。
- 相同源码 m38 `15/15 PASS`，覆盖恢复、credential、诊断字段与当前状态文档；source/snapshot同为`f746df3f6ab514b3474d49d1a9f8e157f07945a835f068f7d3c88b70e22ec231`，4173 unchanged。
- 同一线程第二轮复核为`P0=0 / P1=3 / NO-GO`：生产22/34仍是内嵌合成fixture、完整Provider/credential快照未绑定apply、staging marker和root仍可伪造/软链接绕过。三项已按上一段关闭；最小复验曾准确暴露把Canvas `nodeInputMode=reference`误放进模型参数，修正脱敏矩阵字段后m102 `13/13 PASS`，source/snapshot `419b47fb3a2eace902a65d397d1eb6275f52b69fc21a0e01cf40c0078ef51dc8`，4173 unchanged。等待同一线程第三轮复核，不提前写GO。
- 同一线程第三轮复核为`P0=0 / P1=2 / NO-GO`：生产矩阵测试仍把输入种类/状态/角色/顺序/Canvas inputMode写死，且临时根allowlist仍信任调用者可改写的`TMPDIR`。现已让m102直接由冻结矩阵构造22模板/34节点并绑定生产model/schema/revision身份；apply改用不受调用者环境影响的固定OS临时根。新增`TMPDIR=/`负向门后m102 `13/13 PASS`，source/snapshot `d95ea0c59cf78e6703e66bb1f2d37693ff59c6a3fd45d57676102f00eb2f6a9f`，4173 unchanged。等待同一线程第四轮复核，不提前写GO。
- 同一线程第四轮只读终审确认上述两项均关闭，最终为`P0=0 / P1=0 / GO`；没有读取受保护文件、没有运行重复测试或访问网络/生产。
- 独立Review放行后唯一正式 safe full 执行一次：`122/122 specs、1085/1085 tests PASS`，失败0、重试0、跳过0；Node 22.23.1/npm 10.9.8，source/snapshot `b56efbd8f3cf8681d46fb612f870f94f3a76ce2e9b41aa64d0caa21f54831698`，4173 unchanged。没有第二次full。
- 本地产品候选 commit `5c7419f7dec0114ac86e8595fa964e57c840ce3b`、tree `23197c6ec3c37c98770a9121e01730f19709f5d6`；候选回执为`spec/MODEL_CONTRACT_002_LOCAL_CANDIDATE_RECEIPT_2026-08-27.json`。现场核验`v0.6.52` tag未占用，因此只建议v0.6.52，未修改package版本、未创建tag。
- 用户确认并授权后，package/lock/final runtime已冻结为v0.6.52；默认Node25/npm11 `npm run build` PASS。Node22 safe m38+m81 `56/56 PASS`，失败/重试/跳过0，source/snapshot `78b96eacab4a7c4b5de76009cc96878eae51f428865ea4a80c3705977220e177`，4173 unchanged；没有重复正式full。
- v0.6.52生产只读dry-run在实际写入前以22个模板不兼容fail-closed；根因修复commit为`26cdc6d1dcd6a612dc616677fbe67519042f6254`。修复后m102 `13/13 PASS`，source/snapshot `e058810e…067c`，真实生产只读dry-run为22模板/34节点全部兼容，仍为零Provider/Generation/OSS/费用。用户随后明确授权v0.6.53。
- v0.6.53候选head `71d3b926…4517`、merge `a9d360b7…a859`、main CI run `33077030627`与fresh build通过；冻结副本演练因一个无关账户的无效Ark凭证被误作全局Provider失败而阻断，生产自动恢复且从未切换。保留冻结证据`/var/lib/unboundry-rollbacks/v0.6.53-cutover-frozen.mUOSYM`；v0.6.53 Release已标记未部署。修复后m102 `13/13 PASS`，无效账户凭证计数仍被快照/CAS绑定，用户任务安全边界未放宽；目标改为v0.6.54。
- v0.6.54版本门已冻结；默认Node25 `npm run build` PASS。最终源码Node22 safe m38+m81 `56/56 PASS`，失败/重试/跳过0，source/snapshot `66fafbe6b08e53e21571870aa865e6eb7d4b36dfbbdc81584ce30c94293fa97d`，4173 unchanged；没有重复正式full。
- PR #120与main Quality CI通过，merge `5a6347f596396e1f4e9cef0fc8069ccaaecb1e0f`；注释tag `v0.6.54`对象`5b01446d…68ab`精确指向该merge/tree `4d7febc9…3c81`，GitHub Release与fresh tag build通过，正式inventory `8242d29d…4583`。
- 候选冻结副本`/var/lib/unboundry-rollbacks/v0.6.54-pretag-rehearsal.miVrCL`首次升级与重复apply幂等通过。生产66秒静默门后创建冻结备份`/var/lib/unboundry-rollbacks/v0.6.54-cutover-frozen.wF6woT`，source 366文件、manifest `b008971b…3f2c`；生产副本再次完成dry-run/apply/repeat后原子替换数据与current symlink，回滚门未触发。
- 生产现为v0.6.54/schema41，service active/enabled、NRestarts0、integrity ok/FK0；tasks954/attempts962/active0/media910/publications501/canvases72/templates50保持，publishedModels 11→10、audits 297→299、contractEvents 56→58、publishEvents 14→15是唯一预期治理变化。33个公网静态文件逐字节一致，发布后66秒稳定门通过。
- Chrome零付费只读验收确认模型中心普通已发布列表不含`kwvideo-v2`，GK工作台显示已发布revision 2/EXACT，存在“纯文字生成视频”和“首帧生成视频”，首帧image数量精确1且保序；console error/warn 0、页面写按钮点击0，真实Provider/Generation/OSS/新费用0。回执：`spec/V0_6_54_PRODUCTION_RECEIPT_2026-08-27.json`。
- 回执文档m38首轮`14/15`仅暴露三份渐进治理文档仍保留`CURRENT_V0_6_51`；精确同步为`CURRENT_V0_6_54`后最小复验`15/15 PASS`，source/snapshot `50fabe69…d7678`、4173 unchanged；未重复业务spec或full。

## 下一步与授权门

1. 用户在生产实页复验目标工作流与最终成片质量；用户明确确认前保持`USER_RECHECK`，不得自动重跑失败任务或发起付费生成。
