# INC-GEN-014：工作流自动恢复与密钥校验解耦实时断点

更新时间：2026-08-25

状态：`R0～R5_COMPLETE / R6_SECOND_REVIEW_FINDING_CLOSED / FINAL_REVIEW_PENDING`

权威方案：`spec/INC_GEN_014_WORKFLOW_SELF_HEALING_AND_CREDENTIAL_VERIFY_DECOUPLING_PLAN_2026-08-25.md`

## 1. 当前结论

- 身份硬门通过：隔离工作树、分支、HEAD、`origin/main`与用户给定基线一致；生产仍为`v0.6.43/schema41`。
- `v0.6.44`本地/远端tag及GitHub Release均不存在，版本未被占用。
- 保留并纳入本事件的四项文档diff可解释；受保护JSON未读取、修改、移动、删除、stage或提交。
- 首选保持schema41；当前代码证据不需要schema42。
- 旧实现已确认仍把成功结果的Canvas persist失败降级为节点失败；verify状态写回仍误用paid-work mutation guard，API catch仍统一返回`invalid`。
- R1预期红已由安全运行器精确证明：m22为`35/37`，两项唯一失败分别是纯投影失败阻断下游、成功结果被persist失败降级；m73为`14/16`，两项唯一失败分别是瞬态错误丢失结构化code、运行任务把verify错误拒绝。
- R2～R5已完成：节点执行事实先于Canvas投影生效；新增窄职责`groupResultProjection.ts`，以最新owner-scoped Canvas做字段白名单合并、applicationId幂等、单writer、有界退避/超时/abort；语义或所有权变化只保留任务历史入口。
- credential verify已移除paid-work mutation guard，但保存/替换/删除的guard保持；校验结果使用credential revision与profile configuration快照CAS，只有AUTH写invalid，其余瞬态/权限错误写unknown并保留稳定code。
- 当前源码快照`ca81902e…a21b`定向安全验证：m22 `37/37`、m73 `16/16`、m20 `1/1`，TypeScript/构建由安全运行器通过，4173不变。
- v0.6.44版本/运行时角色同步后，safe m81 `41/41 PASS`；source/snapshot`66a14287…0158f`，schema仍为41、4173不变。
- 文档治理首次因不存在的spec名在产品测试前退出；改用权威m38文件后首轮产品`14/15`仅暴露CURRENT_STATE生产句式不符合既有机器正则，修正文案后最小复验`15/15 PASS`，source/snapshot`6428b45b…6414`，未重复其他spec。
- account/canvas/application三重scope与投影队列异常收口后，最小复验m22仍为`37/37 PASS`；当前功能候选source/snapshot`2c889063…3042`，4173不变。
- 首轮独立只读终审发现`2 P0 + 2 P1`：DATA-005的GET→PUT窗口可能覆盖并发语义修改、terminal success在当前plan失效时回退旧plan、无Web Locks浏览器缺少跨标签writer、人工继续的accepted-task分支绕过projection边界。
- 四项均已关闭：Canvas PUT携带完整projection绑定并在`BEGIN IMMEDIATE`内对当前节点执行语义CAS；terminal success要求当前plan仍存在且input fingerprint完全一致；浏览器无Web Locks时投影零GET/PUT fail-closed；人工继续与普通执行统一进入`runGroupNodeWithPersist`。
- 修复后最小受影响安全验证：m22 `37/37 PASS`、m85 `26/26 PASS`、m20 `1/1 PASS`，均使用动态loopback/临时数据，4173不变，Provider/Generation/OSS/费用为0。一次误写不存在的m20 spec名在产品测试前退出，不计产品测试。
- 第二轮独立复核确认首轮`2 P0 + 2 P1`均关闭，但新增发现`1 P1`：projection exhausted后队列清空，人工继续可能因success proof排除该节点并把空队列误判为settled，提前清除checkpoint。
- 新P1已关闭：checkpoint持久保存`projectionPendingNodeIds`；pending success不会进入initial-success跳过集合，人工/自动继续都只GET accepted原task并重建projection；只有每个pending节点收到`applied/already-applied` receipt才从集合移除并允许清checkpoint。m22最小复验`37/37 PASS`，真实POST/Provider/费用为0。

## 2. 冻结身份与环境

| 项目 | 当前值 |
|---|---|
| 工作树 | `/private/tmp/unboundry-inc-gen-014-workflow-self-healing-plan-20260825` |
| 分支 | `codex/inc-gen-014-workflow-self-healing-plan-2026-08-25` |
| HEAD / origin/main | `42bc0ac60ee248ddbee4c4626cca3c1c19fe9295` |
| package / schema | `0.6.43 / 41` |
| 生产 | `v0.6.43 / schema41`，live/ready通过 |
| Node / npm | `22.23.1 / 10.9.8` |
| 4173 | 既有`127.0.0.1:4173`监听者已记录；本Goal不使用、不终止 |
| v0.6.44 | tag/remote tag/GitHub Release均不存在 |

## 3. 网络与费用账本

| 类型 | 已用 / 上限 | 当前结论 |
|---|---:|---|
| Generation POST | `0` | R0只读核验 |
| 真实付费生成 | `0 / 2` | 未使用；优先保持0 |
| 真实生成费用 | `0 / 20 USD` | 未使用 |
| 非生成Provider密钥probe | `0 / 12` | 未使用 |
| 真实OSS写入 | `0` | 未发生 |

## 4. 冻结实现边界

- 工作流：`saveGate.ts`、`groupRunPersist.ts`、`workflowExecution.ts`、`workflowNodeExecutors.ts`、`WorkflowExecutionProvider.tsx`、`groupRunCheckpoint.ts`，以及一个窄职责`groupResultProjection.ts`。
- Canvas：只通过owner-scoped GET/PUT做最新文档读取与generation-owned字段白名单合并；普通DATA-005语义不变，只有携带`generationProjection`的窄写入在服务端事务内增加目标节点语义CAS。
- 密钥：`accountCredentials.ts`、`accountCredentialsApi.ts`、必要OpenAPI与`MyConnectionsPage`真实错误语义。
- 测试：先m22/m73；API合同实际变化后加m20；治理文档变化后加m38。

## 5. 阶段断点

- [x] R0：身份、合同、账本、影响范围、fixture冻结。
- [x] R1：预期红冻结并记录。m22 `35/37`、m73 `14/16`，均仅有冻结的预期失败；4173不变、真实请求0。
- [x] R2：execution/projection拆分。
- [x] R3：applicationId、白名单三方合并、单writer、有界重试/超时、abort、刷新零POST。
- [x] R4：credential verify双版本CAS、结构化错误与mutation保护隔离。
- [x] R5：最小UI收口；沿用现有始终可用的校验按钮与真实服务端文案，不堆叠技术状态。
- [ ] R6：首轮与第二轮独立终审问题均已修复；尚待同一审查线程最终复核、候选再冻结、唯一safe full、GitHub与生产技术验收。

## 6. 当前候选验收映射

- `WSH-01～02/12`：m22预期红转绿，Provider/节点success在persist失败时仍为success并继续DAG；失败原因与projection状态分离。
- `WSH-03/09～10/13`：accepted-only恢复仍只GET原task；既有m22浏览器合同证明task POST为0，未知结果不自动重提，人工继续/放弃入口保留。
- `WSH-04～08/11/14`：最新Canvas GET、generation-owned白名单、布局/视口/其他节点保留、事务内目标语义CAS、application去重、Web Lock单writer、无Web Locks零写fail-closed、4次指数退避与4s/6s超时、abort由m22/m85覆盖；普通DATA-005合同不变。
- `KEYV-01～05`：m73覆盖运行任务期间verify、mutation仍冲突、credential/profile双版本变化返回CHANGED、AUTH invalid、PERMISSION/5xx unknown。
- `KEYV-06～10`：m73/m20覆盖结构化API、账号/profile隔离、零generation写入、密文/遮罩和现有UI只读校验语义。

## 7. 唯一下一动作

提交第二轮终审修复并交回同一独立审查线程最终复核；确认剩余P0/P1为0后冻结精确候选并运行本Goal唯一safe full。
