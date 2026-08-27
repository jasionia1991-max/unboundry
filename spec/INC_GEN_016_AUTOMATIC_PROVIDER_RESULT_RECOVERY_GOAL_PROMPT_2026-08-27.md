# INC-GEN-016 新 Session 一次性实施 Goal

状态：`COPYABLE_ONE_SHOT_GOAL / SCOPED_PERMISSIONS_EMBEDDED / NOT_CURRENT_GOAL`

> 只有用户在新 Session 中完整发送下方代码块时，才构成一次性 Goal 与其中列明的权限。文件存在本身不是当前 Session 的实施、费用或发布授权。

```text
/goal 严格以以下权威文档驱动 INC-GEN-016，一次性完成只读基线、代码修复、风险驱动验证、全模型非回归、一次最终全量 Review、GitHub、v0.6.55 生产发布、受控真实 GK 验收、回滚门和文档收口。普通问题不得中途停下来询问我；只有本文明确的停止条件成立时才停止。

1. /Users/mymy/Documents/unboundry-model-contract-002-2026-08-27/AGENTS.md
2. /Users/mymy/Documents/unboundry-model-contract-002-2026-08-27/上线规矩.md
3. /Users/mymy/Documents/unboundry-model-contract-002-2026-08-27/spec/UNBOUNDRY_CURRENT_STATE.md
4. /Users/mymy/Documents/unboundry-model-contract-002-2026-08-27/spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_CHECKPOINT.md
5. /Users/mymy/Documents/unboundry-model-contract-002-2026-08-27/spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_PLAN_2026-08-27.md
6. /Users/mymy/Documents/unboundry-model-contract-002-2026-08-27/spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_ACCEPTANCE_MATRIX_2026-08-27.md
7. /Users/mymy/Documents/unboundry-model-contract-002-2026-08-27/TASKS.md 的 INC-GEN-016 区块

一、最终目标

普通用户只点击一次生成；Provider成功完成的文本、图片、视频或音频结果由后台自动追踪、保存并回到Unboundry。用户不得被要求登录中转站、填写任务号或点击核对。Provider明确失败、审核拒绝、余额不足或退款时，必须在Unboundry内明确显示。修复不得破坏当前任何已发布模型、专用connector、历史任务、旧Canvas、模板或不可变Revision。

二、一次性权限

本Goal明确授权以下与INC-GEN-016直接相关的动作：

- 修改产品代码、测试、schema及迁移、配置、package/lock和权威文档；只允许必要变更，禁止无关重构。
- 从实施时最新origin/main创建干净隔离worktree和`codex/`前缀分支；允许本地checkpoint/候选commit。
- 候选与放行门全部通过后，允许commit、push、创建PR、等待并修复CI、合并PR。
- 目标版本明确为`v0.6.55`；允许同步package/lock/runtime版本、创建不可移动tag和GitHub Release。若`v0.6.55`在开始发布前已被占用或身份不一致，停止发布并报告，不移动旧tag、不擅自换版本。
- 允许SSH生产只读核对；放行后允许冻结备份、恢复副本演练、必要schema迁移、原子部署、rollout gate、健康/数据/静态资源/回滚验证和失败时安全回退。
- 允许在目标技术画布`67bfb2ee-f895-4308-9111-9de188306514`、节点`video-019c3604-bae5-4880-b7ac-8410231df6a0`执行受控真实GK首帧视频验收，并将结果写入该任务、用户资产/OSS和原节点；不得改动其他用户画布内容。
- 真实费用总上限为预估USD 20：先只提交一次、单次预估上限USD 10；只有第一单被Provider明确证明未扣费或已退款且不可能再返回结果时，才允许最多一次替代提交。任何unknown、响应丢失、账本不唯一或费用不明都禁止第二次Provider POST。
- 允许对同一已受理Provider任务执行不限于一次的只读状态查询、账本核对、结果下载和幂等回填；这些不是新付费提交。
- 允许在候选冻结后使用一个独立只读Review subagent做一次最终全量Review；按仓库AGENTS.md要求使用`gpt-5.6-luna`、reasoning effort `max`。Review覆盖完整diff、架构、任务状态机、所有模型/connector兼容、计费幂等、恢复、媒体/OSS、数据/schema、并发、UI、可访问性、安全、测试、部署、回滚和文档一致性。

本Goal不授权购买订阅、修改云IAM/Provider权限、读取或输出密钥、删除用户数据/OSS对象/备份/历史release、移动历史tag、清理用户工作树、改动无关生产Canvas，或读取/修改/暂存/移动/删除`spec/public-templates-director-split-revision.json`。

三、执行顺序

- 先建立实施时最新origin/main的干净隔离worktree，核对Git、package、schema、生产版本、模型/模板/任务基线；不得使用历史路径或摘要替代。
- R0只读冻结全模型生产脱敏基线和本次incident证据，补预期红；R0写入Checkpoint前不改运行时代码。
- 严格按Plan的R1～R5实施：有限响应合同、脱敏Provider证据、持久提交/恢复状态机、结果资产与Canvas投影解耦、普通用户UI收口和全模型非回归。
- 统一任务生命周期但保留每个Provider真实connector；禁止万能猜测、批量升级Revision、重写旧任务/Canvas/模板或借机无关重构。
- outcome unknown禁止新付费attempt；关页、刷新、部署和服务重启必须继续原任务；Provider success先落正式asset，再幂等投影Canvas。
- 所有测试只用本轮新临时目录、动态loopback、fake Provider/OSS；不得使用4173、app/data、生产路径、真实密钥或真实媒体。
- 风险驱动验证：先跑最小直接依赖；失败时只修复并复验最小受影响集。候选实现、定向测试和文档完成后冻结源码。
- 候选冻结后执行一次最终全量Review；Review必须给出P0/P1及GO/NO-GO，不能只复述测试。发现P0/P1时主Agent修复并由同一Review线程增量复核，直至`P0=0 / P1=0 / GO`；不得为凑GO降低标准。
- Review最终GO后，如共享合同传播范围成立，执行一次正式safe full；不得在没有相关代码变化时重复full，不得把定向测试冒充full。full失败先定向修复，只有新修复确实使原full证据失效且发布硬门要求时才允许一次新的clean-record full。
- 同步Plan、Matrix、Checkpoint、TASKS、CURRENT_STATE、AGENTS、上线规矩和全局验收账本；状态严格区分AUTO_PASS、REAL_PROVIDER_PASS、PRODUCTION_TECHNICAL_PASS、USER_RECHECK和USER_PASS。
- 本地候选、Review和测试全部通过后，按上述授权完成GitHub与v0.6.55不可变发布链；PR/main CI失败必须定位并修复，不能绕过检查。
- 生产先冻结备份和恢复副本演练，再以`off/detect → allowlist`部署；只对目标技术画布开放真实GK验收。真实结果自动回到项目、刷新保持、费用/任务账本和全模型生产技术门通过后，才允许完成rollout；失败立即关闭新提交并安全回退，不得重复unknown任务。
- 发布后完成一次运营收口核验：版本/service/schema/integrity/FK、数据计数、活动/未知付费任务、静态资源、全模型目录、目标结果资产、Canvas投影和回滚可用性。它是发布核验，不替代前述唯一最终全量Review。
- 不得读取、修改、暂存、移动或删除spec/public-templates-director-split-revision.json；保留所有用户历史差异。
- 用户真实验收只要求打开生产目标画布看结果，不得要求用户去中转站、填写任务号或人工核对。没有用户明确确认不得写USER_PASS。

四、停止条件

只在以下情况停止并报告，不得把普通代码bug、测试失败、CI失败或可修复Review发现当成询问理由：

- Git/worktree/origin/生产身份无法确定或与文档冲突；
- `v0.6.55`已被占用或不可移动身份冲突；
- 会触碰受保护JSON、无关用户历史差异或需要破坏性删除；
- 必须扩展到新Provider协议、购买订阅、云权限、秘密读取或计划外用户数据；
- 真实费用将超过USD 20，或第一单仍是unknown却需要第二次POST；
- Provider本身没有任何可验证恢复能力且无法在授权范围内由Unboundry控制中转层补齐；
- 生产恢复/迁移/回滚门失败且无法安全回退；
- 完成目标必须改变本文冻结的用户产品合同或全模型不回归合同。

五、完成标准

验收矩阵APR-001～027逐项有诚实证据；最终全量Review为`P0=0 / P1=0 / GO`；风险驱动测试和必要safe full通过；当前已发布模型、专用connector、历史任务、旧Canvas、模板和Revision无计划回归；GitHub/CI/tag/Release/生产/备份/恢复/回滚门完成；真实GK首帧视频在费用上限内自动回到生产项目并刷新保持；用户不执行任何中转站核对步骤。最终停在`PRODUCTION_TECHNICAL_PASS / REAL_PROVIDER_PASS / USER_RECHECK`，只有我在生产画布看过并明确回复通过后才更新为`USER_PASS`。
```
