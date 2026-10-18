# INC-GEN-014 新 Session 一次性 Goal 提示词

将下面代码块完整复制到一个新的 Codex Session。不要附加旧 Goal；以这段最新 `/goal` 为唯一当前授权。

```text
/goal 一次性完成 INC-GEN-014「工作流自动恢复与密钥校验解耦」的实现、风险驱动验证、独立终审、Git/GitHub、v0.6.44 发布、生产技术验收和必要回退。不要在普通方案选择、预期红、代码修改、定向测试、依赖安装、文档同步、commit、push、PR、合并、tag、GitHub Release、SSH、备份、部署或已授权的受控验证阶段停下来向我询问权限。

一、项目身份与起点

真实仓库：
/Users/mymy/Documents/unboundry/app

本事件现有隔离工作树：
/private/tmp/unboundry-inc-gen-014-workflow-self-healing-plan-20260825

现有分支：
codex/inc-gen-014-workflow-self-healing-plan-2026-08-25

文档基线 HEAD / 当时 origin/main：
42bc0ac60ee248ddbee4c4626cca3c1c19fe9295

当时 package / 生产：
v0.6.43 / schema41

当前预期未提交文档：
M TASKS.md
M spec/UNBOUNDRY_CURRENT_STATE.md
?? spec/INC_GEN_014_WORKFLOW_SELF_HEALING_AND_CREDENTIAL_VERIFY_DECOUPLING_PLAN_2026-08-25.md
?? spec/INC_GEN_014_WORKFLOW_SELF_HEALING_AND_CREDENTIAL_VERIFY_DECOUPLING_GOAL_PROMPT_2026-08-25.md

这些文档属于用户确认的本事件方案，必须保留、审查并纳入最终提交，不得丢弃、覆盖或降级。

严禁读取、修改、暂存、提交、移动或删除：
spec/public-templates-director-split-revision.json

不得清理或覆盖真实主工作树及其他工作树中的用户改动。禁止 reset --hard、git clean、checkout 覆盖文件等破坏性命令。

二、开始与恢复顺序

先创建并持续维护本 Goal。随后完整读取并服从：

1. 当前隔离工作树的 AGENTS.md
2. 上线规矩.md
3. spec/UNBOUNDRY_CURRENT_STATE.md
4. spec/INC_GEN_014_WORKFLOW_SELF_HEALING_AND_CREDENTIAL_VERIFY_DECOUPLING_PLAN_2026-08-25.md
5. TASKS.md 顶部 INC-GEN-014 区块
6. spec/INC_GEN_013_GROUP_RECOVERY_AND_GROUP_DRAG_PERFORMANCE_PLAN_2026-08-25.md
7. spec/INC_GEN_013_GROUP_RECOVERY_AND_GROUP_DRAG_PERFORMANCE_CHECKPOINT.md
8. spec/INC_GEN_004_GROUP_RUN_PERSIST_BARRIER_2026-08-18.md
9. spec/INC_GEN_010_GENERATION_STABILITY_2026-08-19.md
10. spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md 当前相关区块
11. AGENTS.md 要求的其余权威文档

再只读核验：pwd、worktree、branch、HEAD、origin/main、git status、现有 diff、package/schema、Node/npm、4173 listener、当前生产版本、v0.6.44 tag/release 是否已存在。

如果 origin/main 已前进，先审查新提交和本事件是否冲突。允许在保留现有文档的前提下安全 rebase/merge/cherry-pick；不得为同步丢弃当前 diff。

如果 v0.6.44 已被占用、生产版本已超过 v0.6.43、仓库身份不符或现有 diff 无法安全解释，不得移动旧 tag 或猜新版本；这属于真实身份 blocker，记录证据后停止。除此以外不要因为普通权限或方案选择停下来。

三、冻结目标与实现合同

严格实现权威方案 R0～R6 和全部 WSH-01～14、KEYV-01～10。核心合同如下：

1. Generation Task、Provider Attempt、已发布 Media 和 ownership proof 是执行事实；Canvas 是结果投影，不是执行成功裁判。
2. `createSaveGateRun`、`runGroupNodeWithPersist`及DAG不得再把Canvas投影失败降级成Provider/节点失败。
3. 节点结果证明成立后 execution success 立即生效；Canvas写回进入独立、幂等、有界重试的projection路径。
4. 当前仍存活的同一group run可使用可信run output继续原执行图；Canvas冲突不得阻断语义安全的下游。
5. Canvas冲突时GET最新Canvas，只白名单合并generation-owned字段；保留布局、视口、其他节点和其他标签页修改。
6. 写回必须绑定accountId、canvasId、runId、nodeId、kind、taskId、ownershipKey、resultKey、input fingerprint、semantic revision。
7. applicationId固定为runId+nodeId+taskId+resultKey；重复恢复只能应用一次，不得重复节点、媒体、Provider请求或扣费。
8. 目标节点语义变化、所有权不匹配或结果不完整时不覆盖、不重提；原结果保留在任务/历史入口。
9. 刷新恢复继续accepted-tasks-only：只GET原taskId；generation POST、自动retry和pending付费节点自动提交必须为0。
10. failed/cancelled/outcome-unknown且无明确退款证明时绝不自动付费重提。
11. API Key校验始终允许；`assertCredentialMutationHasNoPaidWork`只保护保存/替换/删除。
12. verify读取credential revision和profile configuration version快照，远端probe后以CAS写回；期间变化则丢弃旧结果并返回CHANGED。
13. 只有明确AUTH写invalid；网络、超时、限流、5xx、格式异常为unknown。API不得把任务占用或瞬态错误伪装成invalid。
14. 保存/替换/删除在运行任务存在时继续fail-closed，运行任务继续使用提交时的credential snapshot。
15. 不通过增加大量报错和状态提示代替自动恢复；正常可恢复路径不得要求用户手动刷新或点“对账”。
16. 不建设完整服务端工作流引擎、事件溯源平台、通用Overlay或无关大重构。首选不改schema；若代码证明确实必须新增持久化边界，可在本Goal内采用schema42，但必须先补齐精确迁移、备份恢复、旧runtime拒绝和rollback门，且独立终审通过。

四、施工顺序

R0：冻结身份、当前合同、网络/费用账本、预期改动范围和精确fixture。

R1：先补预期红，至少证明：
- node success + Canvas persist失败会被旧实现降级；
- 纯投影失败会阻断下游；
- 重复application可能重复应用；
- 有运行任务时verify被错误拒绝；
- 瞬态校验错误被错误标成invalid。

R2：拆分execution与projection状态，建立窄职责结果投影端口；不破坏既有Provider提交串行门、accepted binding、run lease和结果所有权。

R3：实现applicationId幂等、最新Canvas读取、字段白名单三方合并、单reconcile writer、有界退避、abort和刷新零POST恢复。

R4：完成credential verify解耦、双版本CAS、结构化错误和UI真实语义；保存/删除保护不得放宽。

R5：最小UI收口。常见可恢复冲突后台解决；只有自动预算耗尽或语义冲突才给准确入口，不堆积技术状态。

R6：完成风险驱动验证、冻结候选、独立P0/P1终审、文档/断点/矩阵同步、发布和生产技术验收。

每个阶段完成后立即更新本事件checkpoint、TASKS、CURRENT_STATE和验收矩阵，然后自动继续下一阶段，不向我逐项询问。

五、测试与审查授权

授权：
- 修改本事件直接相关代码、测试、fixture、脚本、OpenAPI和权威文档；
- 在确有代码证据时新增一个窄职责groupResultProjection模块；
- 使用项目锁定的Node 22.23.1/npm 10.9.8；新工作树缺依赖时允许`npm ci --offline`；
- 使用动态loopback端口、本轮新临时数据、fake Provider/fake OSS；绝不使用4173、app/data或生产路径；
- 先跑m22、m73；只有实际传播才扩大到m20、m38及最小相邻spec；
- 失败只复验失败spec或最小受影响集合；同一源码不重复full；
- 冻结发布候选后执行一次正式safe full；只有新的代码变化或无法解释的新失败才允许额外必要复验；
- 候选冻结后启动一个独立只读终审subagent，检查P0/P1、重复付费、结果覆盖、credential隔离、API语义和测试缺口；终审不得与实现并行，主Agent负责关闭问题并作最终判断。

不得为了安心无依据扩大测试，不得把定向通过写成full，不得把Agent技术验收写成USER_PASS。

六、一次性权限与预算

版本号确认：v0.6.44。

允许发布：完成本Goal全部本地门和独立终审后，允许把v0.6.44上线。

本消息一次性授权本Goal内所有必要操作，不必再问：

- 本地代码、测试、文档、依赖、fixture和必要schema迁移修改；
- 本地commit；
- fetch、push、创建PR、等待/处理CI、合并PR；
- 创建不可移动tag v0.6.44；
- 创建GitHub Release；
- SSH连接生产；
- 生产只读预检、冻结备份、恢复副本演练、fresh release构建、原子切换、健康/数据/inventory/静态资源检查；
- 若新版本技术验收失败，允许立即回切上一不可变release并验证恢复；
- 为验证「我的连接」，允许最多12次非生成型Provider密钥校验probe，必须按account/profile记账，不得记录密钥、Authorization、完整远端body或签名URL；
- 优先使用fake Provider、既有任务和零付费生产验证。只有这些证据无法证明真实付费边界，才允许在独立技术测试项目中执行最多2次真实生成请求、总费用上限20 USD；每次前必须证明幂等键、请求次数、目标账号/项目和停止条件，禁止重试未知结果请求；
- 允许这些受控测试产生必要的测试任务、媒体和Canvas结果，但不得修改zzx或其他用户现有业务画布、删除用户数据、覆盖原结果或清理历史；生产实页问题账号只做只读核对和零重提恢复验证；
- 允许校验状态本身按合同更新valid/invalid/unknown；不允许导出、显示或复制用户API Key明文。

预算耗尽时不要擅自扩大；保留已完成技术结果和精确blocker。不要把“需要更多预算”伪装成产品失败。

七、Git、生产和数据红线

- 受保护JSON永远不读、不动、不提交；
- 不覆盖其他工作树和用户改动；
- 不移动v0.6.43及更早tag，不覆盖历史GitHub Release；
- 不删除旧release、冻结备份、真实媒体或用户数据；
- 不修改无关Provider、模型、计费、模板、图片工具或Seedance合同；
- 密钥、Cookie、Authorization、签名URL、完整Provider body不得进入日志、diff、测试证据、PR或最终报告；
- schema变化前必须有一致备份、恢复副本、迁移演练、旧runtime拒绝和可执行回退；
- 生产发布必须使用精确候选源码fresh build，不复用来源不明dist；
- 发布前后核对tasks、attempts、active、media、publications、canvases、schema、service、NRestarts和静态资源；授权测试产生的增量必须单独解释，其他数据保持不变。

八、只允许在真正硬阻塞时停止

不要因普通权限、实现选择、测试失败、需要修代码、CI等待、PR冲突的可安全解决部分或发布步骤停下来问我。

只有以下情况允许停止并写清证据和唯一下一动作：

1. 仓库/分支/生产身份冲突，或v0.6.44已被占用；
2. 无法保留现有用户改动或受保护文件；
3. 无法判断Provider是否已提交，继续会有重复付费风险；
4. 备份/恢复/迁移/回退门失败且无法安全修复；
5. 缺少无法从当前环境取得的账号身份、登录态、外部服务能力或秘密；不得索取或输出明文密钥；
6. 需要超过12次非生成probe、2次真实生成或20 USD；
7. 只能通过放宽ownership、revision、credential、数据安全或重复提交保护才能继续。

普通代码bug、预期红、定向测试失败和可修复CI失败不属于停止条件，继续诊断、修复、最小复验并推进。

九、完成定义

必须一次性推进到以下全部完成：

- WSH-01～14、KEYV-01～10全部有当前候选证据；
- Provider/节点成功后Canvas冲突不再阻断当前run，且恢复generation POST=0；
- 目标语义冲突时原结果可找回、不覆盖、不重提；
- 有运行任务时verify正常，保存/替换/删除仍受保护；
- 直接相关定向、必要相邻回归、唯一safe full和独立终审完成，无未关闭P0/P1；
- 权威方案、实施checkpoint、TASKS、CURRENT_STATE、验收矩阵和receipt同步；
- 形成精确候选commit，push、PR、CI、merge、不可移动v0.6.44 tag和GitHub Release完成；
- 冻结备份、恢复演练、fresh build、原子发布、生产健康/数据/inventory/资源门完成；
- 生产技术验证优先零付费；任何已授权Provider probe或付费请求精确记账且不超预算；
- 失败时已安全回退并验证；成功时状态写PRODUCTION技术PASS / USER_RECHECK，绝不代替用户写USER_PASS。

最终用简单中文汇报：是否修好、实际根因、改动、自动测试、独立终审、Provider/费用账本、Git/PR/tag/Release、生产版本/数据/回退状态、用户需要复验的唯一动作。

第一动作：进入上述隔离工作树，只读核验身份与现有文档diff，然后从权威方案R0开始连续执行。
```
