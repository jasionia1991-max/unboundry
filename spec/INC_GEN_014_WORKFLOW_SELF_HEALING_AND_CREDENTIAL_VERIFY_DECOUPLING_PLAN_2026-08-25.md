# INC-GEN-014：工作流自动恢复与密钥校验解耦最终方案

状态：`PLAN_FROZEN / IMPLEMENTATION_NOT_STARTED`

建立日期：2026-08-25

基线：`origin/main@42bc0ac60ee248ddbee4c4626cca3c1c19fe9295`，package `0.6.43`，生产 `v0.6.43 / schema41`

事件目标：解决两个相互独立、但都被错误耦合放大的问题：

1. Provider 任务或节点执行已经成功时，Canvas 保存冲突不能再把成功改判为失败、阻断整个工作流或诱导重新付费生成；系统应自动对账、自动合并可安全写回的原结果，并让仍在当前运行授权内的后续节点继续。
2. 「我的连接」中的只读 API Key 校验必须与运行中的生成任务解耦；只有替换和删除正在被任务使用的密钥继续受保护。

本文是经过最终审计的实施合同。方案冻结时没有修改业务代码，也未授权真实 Provider、OSS、生产、GitHub 或发布操作；其后用户在INC-GEN-014 Goal中明确确认`v0.6.44`并授予本Goal内受控实施、验证、GitHub和生产发布权限。`v0.6.43`的历史发布授权仍已消费，不得复用。

## 0. 最终结论

这次不应继续增加更多错误状态或提示文案。真正需要改变的是控制权：

- Generation Task、Provider Attempt、已发布 Media 和结果所有权证明是执行事实；
- Canvas 是结果的可编辑投影，不是任务是否成功、工作流是否继续的裁判；
- Canvas 保存冲突进入后台结果投影队列，不得把 Provider 成功改写成节点失败；
- 当前同一次整组运行中，后续节点可使用已验证的运行结果继续；刷新恢复只自动核对和应用原任务，不自动新建付费任务；
- API Key 校验读取一个密钥快照并探测平台，不改变密钥，因此不得调用“运行任务禁止变更密钥”的保护。

方案通过，但必须守住三条审计边界：

1. 恢复不得产生第二次 Provider 提交；
2. 自动写回不得覆盖用户对目标节点的语义编辑；
3. 校验结果只能写回它开始时读取的同一密钥和平台配置版本。

## 1. 已核实根因

### 1.1 工作流仍把 Canvas 保存当成执行成功条件

当前 `client/src/generation/saveGate.ts` 的 `createSaveGateRun()` 在 `waitForCanvasRevision()` 失败时直接返回节点 `failed`，不执行节点。

当前 `client/src/generation/groupRunPersist.ts` 的 `runGroupNodeWithPersist()` 还有两层问题：

- 只把包含“画布还在保存”的错误识别为可重试保存问题；“画布保存状态异常”不会进入该分支；
- 节点已经返回 `success` 后，只要 `persist()` 失败，仍会把结果改成 `failed`。

`client/src/generation/WorkflowExecutionProvider.tsx` 随后把该节点标为失败，并由 DAG 把依赖它的后续节点标为 blocked。用户看到的“另有 10 个后续节点因上游失败未运行”因此可能不是 Provider 或业务节点失败，而是 Canvas 投影失败被冒充成执行失败。

`client/src/canvas/CanvasSurface.tsx` 的 `waitForCanvasRevision()` 遇到 `persistenceConflict.current` 会立即抛出“画布保存状态异常，请刷新后重试”。这个行为适合保护提交前的输入快照，却不适合作为已成功结果和后续执行的唯一裁判。

INC-GEN-013 / v0.6.42 已解决“刷新后精确 GET 已接收原任务并回填”的一部分恢复问题，但它没有解除“节点执行成功必须先 Canvas 保存成功，DAG 才承认成功”的耦合。因此本事件不是撤销 INC-GEN-013，而是补齐其下一个边界。

### 1.2 API Key 校验误用了密钥变更保护

当前 `server/accountCredentials.ts` 的 `assertCredentialMutationHasNoPaidWork()` 本应保护密钥替换和删除，避免运行任务失去原 credential revision。

但 `verifyAccountCredential()` 在远端探测结束、记录 `valid / invalid / unknown` 状态时，也调用了同一个保护函数。因此只要存在已跨过 Provider 边界的任务，校验就会被拒绝并显示：

`仍有已提交到模型平台的任务依赖当前密钥，请等待结果保存后再更换或删除`

这里并没有更换或删除密钥，属于明确的职责误用。`server/accountCredentialsApi.ts` 还会把多种校验异常统一返回为 `keyStatus: "invalid"`，可能把任务占用、限流、网络或配置变化伪装成“API Key 无效”。

## 2. 同类产品参考的正确用法

TapNow 的公开文档和当前线上客户端表明，它至少把“生成完成”和“预览/画布显示失败”分开：结果可从历史记录重新放回画布，协作连接会自动重连，后续指令进入 Queue；但保存失败和任务状态查询失败仍存在手动重试。

本事件只借鉴以下产品原则：

- 生成结果拥有独立于当前画布展示的持久入口；
- 展示失败不等于生成失败；
- 已有内容应阻止重复发送；
- 协作断线应自动重连。

不把 TapNow 的公开 UI 文案当作其服务端幂等或 exactly-once 架构证明，也不复制“让用户刷新、重试、联系支持”作为主要恢复方案。

参考：

- <https://docs.tapnow.ai/zh/docs/account/troubleshoot-issues>
- <https://docs.tapnow.ai/zh/docs/agent/manage-conversations>
- <https://docs.tapnow.ai/zh/docs/projects/manage-canvases>
- <https://docs.tapnow.ai/zh/docs/changelog>

## 3. 范围

### 3.1 进入本事件

1. 将节点执行事实与 Canvas 结果投影状态拆开。
2. 对 Canvas 409、同标签迟到 revision、短暂网络失败和保存超时实施有界自动对账。
3. 对最新 Canvas 做生成字段级安全合并，保留布局、视口和其他节点的新修改。
4. 当前存活的同一次 group run 在结果可用时继续其已授权执行图，不等待 Canvas 投影成功。
5. 刷新后继续复用 INC-GEN-013 的 accepted-task 精确 GET；自动应用原结果，但不自动提交新的付费 pending 节点。
6. API Key 校验与 credential mutation guard 解耦，校验使用密钥与平台配置快照并以 CAS 写回状态。
7. 校验 API 返回结构化错误，不把任务占用、限流、网络和配置变化写成 invalid。
8. 补齐直接相关测试、事故治理检查和最小用户提示。

### 3.2 不进入本事件

- 不建设完整服务端工作流引擎、事件溯源平台或通用消息总线；
- 不重写 React Flow、整张 Canvas 持久化协议或所有节点执行器；
- 不修改 Provider 模型参数、计费、媒体保存期限或商业账号归属；
- 不自动重提 failed、outcome-unknown 或没有退款证明的付费任务；
- 不在刷新恢复时自动启动此前尚未提交的付费节点；
- 不允许结果覆盖已发生语义变化的目标节点；
- 不把 API Key 校验设计成生成、余额、模型质量或全部接口权限证明；
- 不借机改版「我的连接」页面或增加大批用户可见状态；
- 不调用真实 Provider、真实 OSS，不读写生产数据。

## 4. 冻结领域合同

### 4.1 两条独立状态轴

节点必须至少在内部区分：

```ts
type ExecutionState =
  | "pending"
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

type ProjectionState =
  | "not-needed"
  | "pending"
  | "applying"
  | "applied"
  | "conflict";
```

规则：

- DAG 是否放行下游只看 `ExecutionState`、结果完整性和所有权证明；
- Canvas 保存只能改变 `ProjectionState`，不得把 `succeeded` 改成 `failed`；
- Provider 明确失败、结果不完整或所有权不匹配才允许判定执行失败；
- 用户界面不必逐一展示上述内部状态，只在后台无法自动收口时给出一个准确入口。

### 4.2 运行结果凭证

每个可供下游使用或写回 Canvas 的结果必须绑定既有可信字段：

`accountId + canvasId + runId + nodeId + kind + taskId + ownershipKey + resultKey + input fingerprint + semantic revision`

不得用 prompt、模型名、时间接近或“最近成功任务”等弱条件猜测结果归属。

同一次运行的结果投影标识固定为：

`applicationId = runId + nodeId + taskId + resultKey`

同一 `applicationId` 重放必须是幂等的；已经应用同一结果时返回成功，不生成重复节点、不重复上传媒体、不新增 Provider 请求。

### 4.3 当前运行继续规则

在页面未重载、原 group run 仍持有有效租约和原始执行图时：

1. 节点结果通过任务、媒体和 ownership proof 后标记 execution success；
2. 结果同时进入 Canvas 投影队列；
3. 下游从本次 run 的可信输出表读取输入，不再以“Canvas 已成功 PUT”为先决条件；
4. Canvas 投影失败时后台继续合并和保存，但不阻断可安全执行的下游；
5. 原执行图中的付费节点仍属于用户这次点击整组执行的既有授权，不属于恢复流程额外发起。

以下情况仍必须停止后续付费节点：

- 执行租约丢失；
- checkpoint 或 accepted-task binding 无法持久化；
- 上游结果不完整或 ownership proof 不成立；
- 目标节点已发生会改变下游语义的编辑；
- 无法判断 Provider 是否已接收请求；
- 用户主动停止。

### 4.4 刷新恢复规则

刷新后继续使用 INC-GEN-013 的 `accepted-tasks-only` 安全模式：

- 只 GET checkpoint 精确绑定的原 taskId；
- 自动等待原任务终态并应用原结果；
- generation POST、自动 retry 和 pending 付费节点自动提交必须为 0；
- 已提交任务全部收口后，幂等/无费用/无外部副作用的本地步骤可以自动继续；
- 新的付费生成、发布、删除和外部同步不得因为恢复流程自动触发；
- 人工“继续剩余节点 / 放弃剩余节点”保留为付费边界，不作为结果找回的必经步骤。

### 4.5 Canvas 自动对账与三方合并

投影队列收到保存冲突时按以下顺序处理：

1. GET 当前服务端 Canvas 和 revision；
2. 读取本次 run 启动时的目标节点语义快照；
3. 比较最新目标节点的输入、模型、关键参数、上游引用和 ownership 字段；
4. 如果语义未变，仅把 generation-owned 结果字段合并到最新节点，保留布局、视口、选择、其他节点和其他标签的新修改；
5. 使用最新 revision 和同一 `applicationId` 再保存；
6. 成功后确认 revision、写入 success proof 并清理相应投影项。

可自动合并的字段必须由现有节点种类白名单明确列出，不能复制整个旧节点对象覆盖新 Canvas。

以下情况不得自动合并：

- 目标节点已更换 prompt、模型、输入、尺寸、时长、参考素材或上游连接；
- nodeId、kind、taskId、ownershipKey、resultKey 任一不匹配；
- 结果媒体 owner、checksum 或 ready 状态不满足既有门；
- 最新 Canvas 已包含不同任务的更新结果；
- 当前账号、项目或画布范围变化。

不能自动合并时：保留服务端任务和历史结果，不重新生成、不覆盖；该分支可以阻止依赖该结果语义的后续节点，但不能把 Provider 成功写成 Provider 失败。

### 4.6 自动重试预算

只允许重试读取和结果投影，不允许重试 Provider 提交。

- 短暂网络/5xx/同标签 revision 竞争：指数退避并加抖动；
- 409：先重新读取并重做语义合并，不原样盲重放旧文档；
- 同一 application 同时只允许一个 reconcile writer；
- 页面切换、账号退出、租约丢失、目标语义变化时立即 abort；
- 达到时间或次数上限后保留投影项，等待下一次页面恢复自动继续；
- 不使用无限轮询，不制造保存风暴。

首版具体次数和时长在 R0 根据既有保存节奏冻结到测试常量，不写死在 UI 文案中。

## 5. API Key 校验合同

### 5.1 操作分类

| 操作 | 是否改变密钥 | 运行任务存在时 |
|---|---:|---|
| 校验 | 否 | 始终允许 |
| 保存新密钥 / 替换 | 是 | 继续阻止 |
| 删除 | 是 | 继续阻止 |

`assertCredentialMutationHasNoPaidWork()` 只能被保存/替换/删除路径调用，不得被 verify 的状态记录路径调用。

### 5.2 快照与 CAS

校验流程固定为：

1. 读取当前账号、profile、API Key、credential revision 和 profile configuration version 快照；
2. 在数据库事务和 credential mutation lease 之外执行只读远端 probe；
3. 返回后开启短事务；
4. 比较当前 credential revision 和 profile configuration version；
5. 完全相同才写 `key_status + key_checked_at`；
6. 任一变化则丢弃探测结果并返回 `ACCOUNT_CREDENTIAL_CHANGED`，不得覆盖新密钥状态。

运行任务继续持有它提交时的 credential revision 快照；校验既不轮换密钥，也不改变运行任务的快照。

### 5.3 状态语义

- `valid`：当前探测接口以当前密钥成功；
- `invalid`：只有明确 AUTH 或经合同确认等价的鉴权拒绝；
- `unknown`：网络、超时、限流、远端 5xx、格式异常或无法判断；
- `ACCOUNT_CREDENTIAL_CHANGED`：校验期间密钥或平台配置变化，结果过期；
- `ACCOUNT_CREDENTIAL_IN_USE`：只用于保存/替换/删除，不得从 verify 返回。

API catch 不得把所有错误统一返回 `keyStatus: "invalid"`。结构化错误至少包含稳定 `code` 和用户可读 `error`；瞬态失败保留原状态或写 `unknown`，不能把历史任务问题伪装成密钥无效。

### 5.4 UI 合同

- 已保存密钥时，“校验”始终可点，唯一例外是同一 profile 已有一次校验正在进行；
- 保存/替换/删除遇到运行任务时，准确提示这些动作会改变任务依赖的密钥；
- 校验期间密钥变化时提示“密钥已变化，本次校验结果已过期，请重新校验”；
- 不增加与工作流状态无关的大段错误说明；
- 校验不产生 Generation task、Provider generation attempt、Media 或费用记录。

## 6. 预计影响边界

施工前必须重新定位；当前代码证据支持的最小范围是：

### 工作流与 Canvas

- `client/src/generation/saveGate.ts`
- `client/src/generation/groupRunPersist.ts`
- `client/src/generation/WorkflowExecutionProvider.tsx`
- `client/src/generation/groupRunCheckpoint.ts`
- `client/src/generation/workflowExecution.ts`
- `client/src/canvas/CanvasSurface.tsx`
- 可能新增一个窄职责 `groupResultProjection.ts`，只负责投影队列、合并和有界重试

### 密钥校验

- `server/accountCredentials.ts`
- `server/accountCredentialsApi.ts`
- `client/src/App.tsx` 的 `MyConnectionsPage`
- 如结构化错误合同变化，最小同步 `server/openApi.ts`

### 直接测试

- `tests/m22-group-execution.spec.ts`
- `tests/m73-account-credentials.spec.ts`
- 必要时 `tests/m20-api-contract.spec.ts`
- 事故治理一致性 `tests/m38-generation-runtime-incidents.spec.ts`

原则上不需要：Provider adapter、Media/Storage 实现、数据库 schema、公共模板、模型目录、图片工具或 GroupNode 布局代码。出现修改这些范围的需求时，必须先给出无法在现有可信结果和 Canvas 合同内完成的代码证据。

## 7. 实施阶段

### R0：冻结现场和不变量

- 基于实施时最新 `origin/main` 建隔离工作树；
- 记录 package/schema、现有 dirty state、当前生产版本和授权边界；
- 冻结现有 v0.6.42 accepted-only 恢复正例；
- 冻结 Provider 成功、Canvas 409、保存超时、重复恢复和运行中任务校验的预期红；
- 真实 Provider、OSS、生产和费用保持 0。

### R1：先补会失败的合同测试

测试必须能证明旧实现存在以下问题：

1. 节点 success 后 Canvas persist 失败被改判 failed；
2. 下游因纯投影失败被 blocked；
3. 相同结果重复恢复可能重复应用；
4. 运行任务存在时 verify 被 `ACCOUNT_CREDENTIAL_IN_USE` 拒绝；
5. verify 的瞬态错误被返回 invalid。

只冻结直接相关预期红，不扩大到 full。

### R2：拆分执行事实与投影事实

- 调整 NodeRunResult / group node state 的内部合同；
- execution success 在结果证明成立时立即收口；
- persist 错误进入 projection queue；
- 当前 run 的下游从可信 run output 读取结果；
- 保持 Provider 提交串行门、accepted-task binding 和 run lease 不变。

### R3：自动对账与安全合并

- 实现 applicationId 幂等；
- 实现 GET 最新 Canvas、字段白名单三方合并、revision 重试；
- 接入账号/画布切换 abort、单 writer、退避和恢复入口；
- 复用 INC-GEN-013 accepted-only，确保刷新后 POST=0；
- 冲突无法安全合并时保留历史结果并 fail closed。

### R4：校验解耦

- 从 verify record 移除 paid-work mutation guard；
- 保留 credential/profile 双版本 CAS；
- 修正 API 错误码和 keyStatus；
- UI 保持校验可用，保存/删除继续保护；
- 验证无 Generation/Media/费用副作用。

### R5：最小 UI 收口

- 常见可恢复冲突不弹阻断性红错；
- 只有自动恢复预算耗尽或语义冲突时显示准确入口；
- 不新增用户必须理解的多状态面板；
- 任务面板和历史结果继续作为诊断与兜底，不成为正常流程必经步骤。

### R6：风险驱动验证与独立审查

- 实施中只跑 m22/m73 及被实际合同传播命中的最小 spec；
- API 合同变化才跑 m20；治理文档变化跑 m38；
- 冻结候选后做一次独立 P0/P1 审查；
- 只有进入正式 release candidate，才按项目发布门执行一次 safe full；
- 同一未变源码不得为了安心重复 full。

## 8. 验收矩阵

### 8.1 工作流自动恢复

| ID | 必须证明 |
|---|---|
| WSH-01 | Provider/节点成功、Canvas 保存冲突时，execution 保持 success |
| WSH-02 | 纯投影失败不阻止当前 run 中依赖结果的后续节点 |
| WSH-03 | 冲突恢复期间 generation POST、Provider 重提和额外费用为 0 |
| WSH-04 | 自动获取最新 Canvas，只合并 generation-owned 字段 |
| WSH-05 | 无关布局、视口或其他节点修改被保留 |
| WSH-06 | 目标节点语义变化时不覆盖，原结果保留在任务/历史入口 |
| WSH-07 | 同一 applicationId 重放只应用一次，不重复节点/媒体 |
| WSH-08 | 双标签页同一 application 只有一个 reconcile writer |
| WSH-09 | 刷新恢复只 GET accepted task；pending 付费节点 POST=0 |
| WSH-10 | failed/cancelled/outcome-unknown 不自动重提 |
| WSH-11 | 保存恢复有界退避，切换账号/画布/租约丢失会 abort |
| WSH-12 | 成功、失败、投影冲突在任务统计中不互相冒充 |
| WSH-13 | v0.6.42 accepted-only 正例、人工继续/放弃入口不回归 |
| WSH-14 | DATA-005 跨标签最后保存者胜合同不被改成全局 CAS |

### 8.2 API Key 校验

| ID | 必须证明 |
|---|---|
| KEYV-01 | 存在 queued/running/recovering 已提交任务时 verify 仍能探测并记录 |
| KEYV-02 | 同一条件下保存/替换和删除仍返回稳定冲突且 revision 不变 |
| KEYV-03 | verify 期间密钥变化，旧结果不写回并返回 CHANGED |
| KEYV-04 | verify 期间 profile 配置变化，旧结果不写回 |
| KEYV-05 | 明确 AUTH 才写 invalid；网络/超时/限流/5xx 为 unknown |
| KEYV-06 | API 不再把 ACCOUNT_CREDENTIAL_IN_USE 或瞬态错误标成 invalid |
| KEYV-07 | 两个账号、两个 profile 的状态和密钥完全隔离 |
| KEYV-08 | verify 不新增 generation task/attempt/media/publication/费用 |
| KEYV-09 | 密钥明文不进入日志、响应、SQLite 非密文列或测试证据 |
| KEYV-10 | UI 校验按钮和错误反馈符合真实操作语义 |

## 9. 风险与应对

| 等级 | 风险 | 硬门与应对 |
|---|---|---|
| P0 | 恢复误提交第二个付费任务 | 恢复网络账本 generation POST=0；任何一次即失败 |
| P0 | 迟到结果覆盖用户新编辑 | 语义 fingerprint + ownership 全字段门；字段白名单合并 |
| P0 | 假成功让下游读取不完整结果 | 结果完整性、Media ready、owner/checksum/proof 缺一不可放行 |
| P0 | 校验改变或泄漏运行任务密钥 | verify 只读快照；明文只在服务端内存；保存/删除保护不放宽 |
| P1 | 双标签页重复写回 | applicationId 幂等 + 单 reconcile writer + revision 复核 |
| P1 | 保存重试风暴 | 有界退避、abort、单队列；不盲重放整张旧 Canvas |
| P1 | 旧 checkpoint 无法恢复 | 保留 INC-GEN-013 v1 兼容和人工安全入口 |
| P1 | 投影成功但 checkpoint 提前清理 | Canvas revision 确认和 success proof 后才清理 |
| P1 | 瞬态校验失败污染 valid 状态 | unknown/保留旧状态合同；禁止统一 invalid |
| P1 | Provider profile 更新与校验竞态 | profile configuration version CAS，变化则结果过期 |
| P2 | UI 再次堆积技术状态 | 内部状态不直接外露；只保留一个必要恢复入口 |

## 10. 防回归策略

1. 把“execution success 不得被 projection failure 降级”固化为纯函数级长期测试。
2. 把“刷新恢复 generation POST=0”保持为网络层不变量，不能只断言文案。
3. 把 Provider success + Canvas 409 + 下游继续做成 m22 固定 fixture。
4. 把目标语义变化、双标签页、重复 applicationId、保存超时四个负边界固化。
5. 禁止节点执行器自行决定 Canvas 保存失败等于 Provider/节点失败；统一通过结果投影端口。
6. code review 检查不得再次在 verify 路径调用 credential mutation guard。
7. m73 长期同时覆盖 verify-while-running 正例和 save/delete-while-running 反例。
8. API 错误状态必须用稳定 code 断言，避免文案变化掩盖语义回归。
9. 事故治理测试记录 INC-GEN-004、010、013 与本事件的边界，防止历史修复被错误复用。
10. 定向绿不表述为 full；技术 PASS、生产技术 PASS、USER_RECHECK、USER_PASS 继续分开。

## 11. 回滚与发布边界

- 首选不新增 schema；若实施证明必须持久化新的服务端投影记录，先重新审计 schema42、备份恢复、旧 runtime 拒绝和 rollback 合同，不得在本方案下暗中扩张。
- 功能候选必须能通过回切上一不可变 release 恢复；不得移动 `v0.6.43` tag 或覆盖其 GitHub Release。
- 发布前必须另行获得新版本号确认和允许发布；当前请求只授权文档落地。
- 生产验证默认只做零付费行为：已有任务/合成 fixture、Canvas 冲突恢复、连接校验接口和数据不变门。
- 任何真实 Provider 校验若会触发第三方请求，必须在实施 Goal 中单独冻结请求类型、次数和零生成费用证明；没有授权时使用 fake Provider。

## 12. 完成定义

本事件只有同时满足以下条件才能从实施状态进入技术完成：

1. WSH-01～14、KEYV-01～10 全部有当前候选证据；
2. Provider 成功后 Canvas 冲突不再让工作流卡住或产生第二次提交；
3. 无法安全合并时原结果仍可找到，且不覆盖、不重提；
4. 运行任务存在时 API Key 校验正常，保存/删除保护继续有效；
5. 真实 Provider、OSS、费用和生产操作严格符合届时新授权账本；
6. 独立审查无未关闭 P0/P1；
7. 权威方案、TASKS、CURRENT_STATE、验收矩阵和实施 checkpoint 同步；
8. 自动证据只能写 `AUTO_PASS`，生产技术验证只能写 `PRODUCTION_*_PASS`；用户在目标账号真实页面确认后才允许写 `USER_PASS`。

当前状态：`PLAN_FROZEN / R0_TO_R5_IMPLEMENTED / R6_THIRD_REVIEW_FINDING_CLOSED / FINAL_REVIEW_PENDING`。

## 13. 本次文档落地凭证

- 隔离工作树：`/private/tmp/unboundry-inc-gen-014-workflow-self-healing-plan-20260825`
- 分支：`codex/inc-gen-014-workflow-self-healing-plan-2026-08-25`
- 基线 HEAD：`42bc0ac60ee248ddbee4c4626cca3c1c19fe9295`
- `git diff --check`：PASS
- 文档一致性定向门：`PATH=/Users/mymy/.local/bin:$PATH node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`
- 首轮 m38：`14/15 PASS`，唯一失败为本批新增计划状态破坏既有 `CURRENT_V0_6_43_USER_RECHECK` 精确标记；已把生产治理标记与未实施计划标记拆开。
- 修正后 m38：`15/15 PASS`，failed/skipped/retries/blocked/reportErrors 均为 0；source/snapshot `a88ec4a5c53d17b22cbc12ce6349510f0c6a1415b5ee1f854503ff90cbca3f2f`，4173 listener unchanged。
- 本批未运行 m22、m73 或 full：没有业务代码变化，相关测试只属于未来实施 R1～R6。
- 业务代码、schema、package、生产、Provider、Generation、OSS 和费用均未改变；未 commit、push、PR、tag 或发布。

## 14. 实施Goal进展（2026-08-25）

- 实施仍严格遵循本方案R0～R6、WSH-01～14与KEYV-01～10；schema保持41。
- 首轮独立只读终审发现的`2 P0 + 2 P1`已关闭：服务端Canvas事务内目标语义CAS、当前plan/input精确围栏、无Web Locks零写fail-closed、accepted-task人工继续统一projection边界。
- 修复后最小受影响safe为m22 `37/37`、m85 `26/26`、m20 `1/1 PASS`；真实Provider、Generation、OSS和费用仍为0。
- 当前尚待同一独立审查线程复核、唯一safe full、GitHub与生产技术验收；不得写`USER_PASS`。
- 第二轮复核新增的checkpoint提前清理P1已用持久pending projection节点与逐节点settled receipt关闭；继续入口只GET原accepted task重建projection，保持generation POST=0。
- 第三轮复核新增的direct persist receipt活性P1已关闭：普通DAG与accepted-only路径都把`projectionState=applied`结算为逐节点receipt，pending可安全移除。
