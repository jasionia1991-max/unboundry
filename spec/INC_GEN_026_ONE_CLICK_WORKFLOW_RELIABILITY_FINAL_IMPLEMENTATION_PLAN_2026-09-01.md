# INC-GEN-026 一次点击工作流可靠生成与结果自动收口最终实施方案

状态：`PLAN_FROZEN / R0_R8_IMPLEMENTED / LOCAL_CANDIDATE_TECHNICAL_PASS / R9_V0_7_0_AUTHORIZED_IN_PROGRESS / PRODUCTION_V0_6_70_UNCHANGED / USER_RECHECK`

建立日期：2026-09-01

> **2026-09-02 R9 授权覆盖层**：用户最新原文“授权上线，版本号v0.7.0”已经授权本次 v0.7.0 的版本差异、commit/push/PR/CI、合并后不可移动 tag/GitHub Release，以及生产 schema42 locked-exact backup/verify/fresh restore、安装、切换、上一 schema42 release rollback 和最终 forward。历史 9-task apply、真实 Provider POST、真实 OSS 写删恢复、费用和真实 Canvas/group 点击仍未授权。下文保留的“未授权”段落是 2026-09-01 方案冻结时的历史门，不覆盖本段。

R9 唯一实施身份：worktree=`/Users/mymy/Documents/unboundry-inc-gen-026-workflow-reliability-2026-09-01`，branch=`codex/inc-gen-026-workflow-reliability`，baseline HEAD/origin-main=`94d77d7618f4c88877b457c2249a824d40dd5633`，baseline tree=`2101fe347ef02297d9580906b6cadb71603fc45c`，candidate=`v0.7.0/schema42`，current production=`v0.6.70/schema42`。

## 0. 先用最直白的话说结论

这次不能只补一个漏掉的 `modelId` 就上线。补完以后，原来被挡在 Provider 前面的 Provider 路径会变得可达；历史恢复循环、同步图片结果丢失、OSS 卡死、停止误报和界面空白是彼此独立的已确认缺口，必须分别修复和验证，不能暗示一次运行必然同时触发全部问题。

最终修复必须按以下顺序完成：

1. 先修当前 schema42 备份，保证任何后续操作都有可恢复底座；
2. 再让 HTTP 和 workflow 只通过同一份强类型准入对象创建任务；
3. 再统一 Provider 终态分类，停止“没有新事实也反复恢复”；
4. 再保证 Provider 已返回的原始结果不会被失败分支删除或放弃；
5. 再修 workflow 收口、停止、投影和用户可见历史；
6. 最后才跑完整故障矩阵、独立 Review、发布和一次真实验收。

普通用户的最终体验必须是：只点击一次，关页或刷新也不影响服务端继续；成功结果自动回到项目；明确失败在项目内稳定可见；结果不明时系统禁止重复付费并自动保留证据。用户不去 Provider、relay 或 OSS 管理台找结果，也不复制 task id，不手工下载再上传。

## 1. 本方案的权威、基线和证据边界

### 1.1 方案冻结时的代码与线上身份（历史基线）

- 实施仓库：`/Users/mymy/Documents/unboundry-inc-gen-025-server-authoritative-2026-09-01`
- 当前文档工作分支：`codex/inc-gen-025-server-authoritative-group-run`
- 当前文档工作 HEAD：`1d0cf8a4b0dfb0cb53c6f26fc15992eb50e89048`
- 当前代码树：`2101fe347ef02297d9580906b6cadb71603fc45c`
- 2026-09-01 18:25 CST 只读核对远端 `main`：`94d77d7618f4c88877b457c2249a824d40dd5633`
- 远端 `main`、`v0.6.70` tag 与当前文档工作 HEAD 的 tree 相同，均为 `2101fe347ef02297d9580906b6cadb71603fc45c`。
- 2026-09-01 18:25 CST 只读核对生产：`/api/version=0.6.70`，`/api/health/ready` 报告 `schemaVersion=42`、`status=ready`。
- “进程健康”只证明进程和数据库探针正常，不证明整组生成业务正常。
- 上述生产结果是本次会话的时间点只读输出，没有单独落盘为生产 receipt；它不能作为永久发布证据，实施前必须重新刷新。

未来真正开始实施时，必须从当时实时 `origin/main` 新建隔离 worktree。若 commit、tree、生产版本或 schema 已变化，先更新本 Plan/Checkpoint/Matrix，再改代码；不得把本段快照当永久事实。

### 1.2 审计证据

- 最终复核报告：`/Users/mymy/Documents/unboundry/UNBOUNDRY_AUDIT_REPORT_AND_LEDGER_REVIEW_2026-09-01.md`
  - SHA-256：`e31e92a87badd48f61baa8235267f3245d7b866261b63b1538665145b72c0410`
- 原始全量报告：`/Users/mymy/Documents/unboundry/UNBOUNDRY_FULL_AUDIT_2026-09-01.md`
  - SHA-256：`52e3bad76efa028be42c16ac253e76dc7615c80240f708b3811f18e804b3d0a0`
- 原始覆盖台账：`/Users/mymy/Documents/unboundry/UNBOUNDRY_FULL_AUDIT_COVERAGE_2026-09-01.tsv`
  - SHA-256：`7418a89dbc214ab4b300004cb2969cac4902d1c3fb6270acfc0251e4b8409276`

报告里的直接代码、数据库和线上证据可以作为 R0 输入；推断、单次时延观察和未执行的修复效果不能冒充已验证事实。原 TSV 只证明机械库存，不证明逐行语义 Review。

### 1.3 方案冻结时的授权（历史；已被顶部 R9 覆盖层更新）

本文件是实施合同，不自行产生授权。以下内容记录 2026-09-01 冻结方案时的边界；2026-09-02 最新授权只以文件顶部 R9 覆盖层为准。

本轮只允许：

- 新建和修订方案、矩阵、Checkpoint、Goal 提示词及当前路由文档；
- 只读核对 Git、公开健康接口和现有证据；
- 独立只读复审这些文档。

本轮不允许：

- 修改产品代码或测试；
- 运行 formal full；
- commit、push、PR、tag、GitHub Release；
- 生产配置、数据库、服务、备份 timer 或发布操作；
- 真实 Provider POST、真实 OSS 写入/删除、付费生成；
- 复用 INC-GEN-025 已消费的历史版本、发布或真实验收授权。

## 2. 最终产品合同

### 2.1 必须实现

1. 用户只点击一次整组生成。
2. 一个 logical node 的一个 execution intent 最多一个 outbound Provider create/submit POST。
3. 浏览器关闭、刷新、换设备或请求响应丢失后，服务端从持久状态继续同一 run/task/attempt。
4. Provider 已受理的 task id 在第一次 poll 前持久化。
5. 同步返回的 text/bytes 在 task success 前进入可恢复的持久证据。
6. Provider 已返回且结果已 staged 时，OSS 或提交暂时失败只能续传同一结果，不能补偿删除、重生成或要求用户回收。
7. Provider 明确失败时，attempt 一次性收口，task/run 稳定失败，sweep 无新事实时 no-op。
8. Provider outcome 不明时进入 billing fence，只核对原证据，绝不换 key 或第二次 POST。
9. Canvas projection 是独立副作用；失败不降级 task/node success，不阻断已经可安全运行的下游，不触发 Provider。
10. 即使 generation task 尚未创建，workflow admission 失败也必须在刷新后稳定可见。
11. stop 只有服务端确认后才能显示“已停止后续”；已受理任务继续保存原结果。
12. 当前 schema42 备份必须可验证、可恢复，不能用“目录存在”冒充有效备份。
13. 每个 exact 目标 workflow node 的已选模型都必须具备经行为测试证明的 workflow eligibility；每种产品承诺支持的必需 node kind 至少有一个 published eligible model。否则在创建 run 前稳定显示“不支持工作流”，不得以“全部禁用”冒充可靠生成通过。

### 2.2 明确不承诺

- 不保证第三方 Provider 永远成功、永不审核失败或永不退款。
- 不伪造 Provider 成功。
- 不在证据不完整时自动发起新的付费请求。
- 不把所有 Provider 协议重写成一个万能协议。
- 不引入微服务、消息队列、Redis、Kafka、第二套 scheduler 或第二套编辑器状态机。
- 不为了“全量审计看起来更大”重构无关模块。

## 3. 冻结的不变量

| ID | 不变量 |
|---|---|
| INV-01 | 同一 run/node/semantic identity 只能关联一个 generation task。 |
| INV-02 | 同一 task execution attempt 最多一个 outbound Provider create/submit POST。 |
| INV-03 | Provider POST 前先持久化 attempt boundary 与请求指纹。 |
| INV-04 | task id/response id 一旦取得，必须先持久化再 poll。 |
| INV-05 | sync bytes 未 durable 时不能宣称强恢复；无法证明的 adapter 必须在 workflow preflight 阶段 fail-closed。 |
| INV-06 | publication pending 的原结果优先于 Provider inspect 和 compensation。 |
| INV-07 | Provider terminal failure 必须使 attempt `finished_at` 非空，重复 sweep 为 no-op。 |
| INV-08 | no-new-fact sweep 不新增 task event，不在 failed/recovering/running 间循环。 |
| INV-09 | task success 只可发生在 text durable 或 result asset committed 之后。 |
| INV-10 | workflow node success 只可领养 authoritative task success。 |
| INV-11 | projection 不拥有 Provider、task 或 node success 的决定权。 |
| INV-12 | stop 只阻止未来未准入节点，不删除已受理 task/result evidence。 |
| INV-13 | 客户端/localStorage 不是执行真相，不能决定是否再次提交。 |
| INV-14 | OSS 保持 forbid-overwrite；相同对象只能在完整身份一致时安全领养。 |
| INV-15 | 历史 task/attempt/event/provider id 不删除、不改写成从未发生。 |
| INV-16 | 自动测试、技术生产门、USER_RECHECK 和 USER_PASS 分开记录。 |
| INV-17 | exact 目标节点模型 eligibility 必须逐节点通过；无 eligible model 时在 run/task/Provider 前稳定 fail-closed。 |

## 4. 目标权威状态顺序

```text
workflow run + immutable plan + locks + reservation committed
  -> node pending -> admitting
  -> generation task admitted with deterministic idempotency
  -> Provider attempt boundary-claimed
  -> Provider accepted / response-received / outcome-unknown
  -> async task id durable OR sync bytes durable staged
  -> publication external-ready + result asset committed
  -> attempt completed + task success
  -> workflow node success
  -> downstream admission
  -> Canvas projection applied / pending / conflict / failed
  -> run terminal + locks/reservation released
```

明确禁止以下倒序：

- task success 后结果仍不可读；
- task failed 后 publication worker 删除仍可恢复的原始结果；
- projection 失败把 node/task 改回 failed；
- stop 请求刚发出就显示 terminal；
- browser reload 或 localStorage 丢失触发第二次 create；
- 只补 `modelId` 后直接开放真实 Provider。

## 5. 修复依赖与不能拆错的关系

| 修复 | 必须先完成 | 为什么 |
|---|---|---|
| schema42 备份 | 当前文档基线 | 后续任何代码/数据修复都需要可信恢复底座。 |
| admission builder | 备份本地候选可验证 | 补齐 P0 后 Provider 链才会真正开始被触发。 |
| Provider outcome classifier | admission parity | 防止新 workflow 进入已有无限恢复路径。 |
| sync result/publication | classifier | publication pending 必须先于 terminal failure 判定。 |
| OSS safe-adopt | publication 语义 | 否则相同 staged 结果会被同 key forbid-overwrite 永久卡住。 |
| workflow settlement | task/media 顺序 | node/run 只能领养权威 task/result，不可另建状态真相。 |
| UI/history/stop | server API 合同 | 客户端只能展示并控制服务端事实。 |
| CI/Review/full | 所有产品改动冻结 | 需要覆盖真实跨层接缝，不能只测层内函数。 |
| 发布/真实 canary | 全部自动门与新授权 | 版本、生产、Provider、OSS、费用都是独立边界。 |

## 6. 逐文件实施范围

下列是实施前的确定范围。实际 diff 若出现新文件，必须说明它属于哪条调用链并加入 Matrix/Review denominator；不得用本清单排除必要文件。

### 6.1 Admission 与 workflow binding

| 文件 | 计划改动 |
|---|---|
| `server/authoritativeGenerationModelConfiguration.ts`（新增） | 定义不可结构化伪造的 branded/opaque `AuthoritativeGenerationModelConfiguration` 和唯一 builder；必填 modelId、capability、adapter、Provider/profile/protocol/driver、credential/config revision、release revision/hash、parameter schema、result count、semantic/ownership identity。只允许 builder 产出品牌值，禁止 `as`/raw `Record<string, unknown>` 绕过。 |
| `server/generationAdmissionApplication.ts` | `PreparedGenerationAdmission` 只能携带 builder 产出的 branded 配置；HTTP 与 workflow 的新 admission 只能从这个边界进入。旧历史读取兼容不能成为新 create 入口。 |
| `server/generationTasksApi.ts` | 删除手写 model configuration 拼装，改用共享 builder；客户端传入的 workflow reservation 不作为权威。 |
| `server/workflowRunService.ts` | 删除第二份手写拼装，改用共享 builder；修复当前缺失 nested `modelId`；保留运行时 authoritative comparison。 |
| `server/workflowRunLocks.ts` | 在 admission 事务内按 owner/canvas/run/node 查出权威 group、lock 和 reservation；不信任 HTTP body 里的 reservation id。 |
| `server/generationTaskStore.ts` | 新 admission 不再接受可任意拼装的泛型 `GenerationTaskInput`/raw configuration；保留并加强独立 runtime model/release/provider/schema 比对。workflow binding 在事务内补齐或校验服务端 reservation；缺失/漂移在 task/attempt/Provider 前 fail-closed。 |

### 6.2 Provider outcome 与历史任务

| 文件 | 计划改动 |
|---|---|
| `server/generationProviderOutcome.ts`（新增） | 纯 DTO/纯函数分类器：terminal、running、publication-pending、inspect-retry、billing-unknown、operator-incident、no-new-fact。只接收序列化的 task/attempt/publication/adapter observation DTO，不导入 Provider、Media、数据库或 runtime 实现，避免循环依赖。 |
| `server/generationTaskStore.ts` | 新增原子 settlement：一次事务更新 attempt outcome/failure/finishedAt、task state/error 和有限 event；selector 不再选中已终结 attempt。 |
| `server/generationAttemptQueries.ts` | 提供 latest attempt 与未决 paid boundary 的单一查询口径，避免各模块各写一套判断。 |
| `server/generationTasks.ts` | `retrySafetyDecision`、启动恢复和 30 秒 sweep 统一使用分类器；无新事实不 transition、不写三条 event。 |
| `server/canvasLegacyGenerationReconciliation.ts` | 作为历史 terminal-detach/Canvas 兼容链保持隔离；不得接入普通 INC-GEN-026 Provider outcome classifier。只增加必要的边界回归，证明两条链互不触发。 |
| `tests/fixtures/inc-gen-026/terminal-provider-failures.redacted.json`（新增） | 本地只保存由既有审计冻结证据派生的脱敏、production-shaped 最小字段；记录来源报告 SHA、fixture schema 与证据缺口。缺字段就标 blocked，禁止猜造 9 条精确事实。 |
| `scripts/inspect-inc-gen-026-attempt-settlements.mjs`（新增） | 默认只读 dry-run；必须显式传入非生产 `--data-dir`/fixture，拒绝生产路径。逐 task 输出 source DB/fixture identity、schema、row fingerprint、分类、理由、预计变更、tool HEAD 与 manifest hash。 |
| `scripts/apply-inc-gen-026-attempt-settlements.mjs`（新增） | 只接受 dry-run 生成的 exact manifest/hash；全部 predicate 一致才单事务 apply；不删除 task/attempt/event/provider id，repeat 必须 no-op。 |

### 6.3 同步结果、publication 与 OSS

| 文件 | 计划改动 |
|---|---|
| `server/generationTasks.ts` | OpenRouter image 改走 `attemptProviderResultSave`；`MediaPublicationDeferredError` 进入 recovering/publication-pending，不能掉入 generic failed。relay-gpt-image 只有在“无 providerTaskId + 当前 attempt=response-received + result-save 重试耗尽 + 无 pending publication”全部成立时才保守终结；没有 durable response 查询能力时不得宣称强 workflow eligible。 |
| `server/generationResultCommit.ts` | 只在 publication/task/attempt/owner/kind/checksum 完整匹配时提交结果和 task success；历史 terminal task 只允许精确的 result-save failure 窄恢复。 |
| `server/mediaLifecycle.ts` | generated publication recovery 先 safe-adopt/续传，再考虑终结；staged 原结果不能因 task 误终态直接 compensation。 |
| `server/mediaPublicationService.ts` | 暴露 generation-owned recover/adopt facade，不让 Generation 直接操作 Media 内表。 |
| `server/aliyunOss.ts` | 区分 PUT success/conflict/unknown；HEAD 同 key 按下述完整 identity 校验；一致领养，不一致或缺元数据 durable quarantine；只删除能证明由本次调用创建的对象。 |
| `server/assetStorage.ts` | 图片 reservation/staging/upload 使用统一 OSS identity 和 deferred 语义。 |
| `server/videoStorage.ts` | 保持视频同一 staging 续传，并接入统一 OSS adoption 结果。 |
| `server/audioStorage.ts` | 保持音频同一 staging 续传，并接入统一 OSS adoption 结果。 |
| `server/modelExecutionRegistry.ts` | `workflowEligible` 必须来自行为测试证据；不能只靠字符串声明。无可查询 task id、无 Provider 幂等、无 durable relay/outbox 的 sync adapter 在强 workflow 中 fail-closed，普通单节点路径不被误伤。逐 exact 目标节点验证其已选模型；每种产品承诺支持的必需 kind 至少一项 published model 可用，不能靠全部 ineligible 通过测试。 |

OSS safe-adopt 的完整 identity 冻结为：本地权威 `owner + storage profile + publication id + task id + attempt id + object key + media kind/format + byte size + SHA-256 + content type`，远端对象必须带可逐字段比对的 publication/task/attempt/SHA 元数据。只有本地 publication tuple 与远端 HEAD 全部相等才可 adopt。旧对象缺任一必要元数据、HEAD 暂时不可读或字段冲突时，均保持 staged 并进入 durable quarantine/incident；不得覆盖、不得删除、不得再次 PUT 到同 key。只有 PUT 明确成功且能证明对象由本次调用新建时才可登记 cleanup intent，DELETE 失败必须持久重试。旧孤儿对象只能走另行授权的管理员清理，不交给普通用户。

默认不升级 schema42。OSS identity conflict 可用现有 `staged/error_code/retry_count` 持久化并阻止自动删除。只有实现证明现有字段无法表达必要不变量时，才停止实施、修订方案并单独审计 schema43；不得边写代码边顺手迁移。

### 6.4 Workflow server settlement

| 文件 | 计划改动 |
|---|---|
| `types/workflowRuns.ts`（新增） | 共享 run/node/projection/submission-state 类型与纯运行时 parser；必须 browser-safe，只依赖可序列化类型，不导入 server、Node、数据库或 secret 模块；服务端和客户端使用同一状态枚举。 |
| `server/workflowRunService.ts` | 顶层 run 持久化首个决定性 error；stop/finalization 在同一事务读取最新状态并 CAS；malformed plan 稳定 terminal/quarantine；disjoint run 不被单个慢 run 饥饿。 |
| `server/workflowRunsApi.ts` | 返回稳定 code；list 包含 active 和近期 terminal；stop 幂等并返回最新服务端状态。 |
| `server/mediaCapacityReservations.ts` | 每个 paid boundary 从 task 的服务端权威 run binding 重查 reservation；不接受伪造/缺失的 workflow reservation。 |
| `server/workflowRunLocks.ts` | run terminal 时只释放本 run 的 locks；task admission、stop、delete 继续共用事务围栏。 |

run 最终态事务必须同时：

1. 重新读取 `stop_requested` 和 node 最新状态；
2. 计算 `success/failed/cancelled`；
3. 写 run 顶层 error code/message；
4. 删除本 run locks；
5. 释放本 run reservation；
6. CAS 限制旧 worker 不能覆盖更新后的 terminal state。

### 6.5 客户端与用户可见闭环

| 文件 | 计划改动 |
|---|---|
| `client/src/generation/workflowRuns.ts` | create/get/list/stop 全部运行时校验；畸形响应显式失败；stop 支持 AbortSignal；503/408/429 只 poll 同一 run。 |
| `client/src/generation/groupRunCheckpoint.ts` | preparation 使用现有 Web Lock + AbortSignal；收到/找回 server run 后立即释放浏览器 preparation lock；旧 checkpoint 继续只是兼容缓存。 |
| `client/src/generation/WorkflowExecutionProvider.tsx` | 点击瞬间建立 preparation handle 和 node lock；create 响应丢失只按 canvas/group/semantic identity 找回；active/terminal runs 并行恢复；stop await；scope cancel；移除无 scope 的 delayed reload。 |
| `client/src/canvas/GenerationTasksPanel.tsx` | 同时读取 generation tasks 和 workflow runs；无 task 的 failed run 仍显示；展示 run id、首错、节点计数、Provider submission truth、projection 状态和 stop 结果。 |
| `client/src/canvas/GroupNode.tsx` | 区分“正在准备/停止准备”和“服务端已接收/停止后续”；preparation 时禁用会改变语义或旁路生成的操作。 |
| `client/src/canvas/CanvasSurface.tsx` | preparation lock 接入现有 retained lock；mutation 在 `onSaveStart` 前 fail-closed；新增明确 `onSaveFailure`，所有保存出口成对收口。 |
| `client/src/canvas/CanvasShell.tsx` | success/conflict/failure 清理旧 timer；旧 Canvas 的迟到 callback 不覆盖新 scope；侧栏点击本身不触发 save/flush。 |
| `types/workflowSemanticPlan.ts` | legacy/非法 inputOrder fallback 先稳定排序；重复/空 edge id、未知 endpoint fail-closed；runtime output/task/projection 继续排除在 fingerprint 外。 |

server run history 与 generation task history必须分区展示，不能把无 task 的 workflow node 伪造成 generation task，也不能让两个区块重复计算 Provider 请求。

### 6.6 备份、CI、发布与治理

| 文件 | 计划改动 |
|---|---|
| `scripts/backup-data.mjs` | locked-exact frozen source contract 支持 schema42；不完整参数、SHA 漂移、活动/未决生成边界 fail-closed。 |
| `server/backupPackage.ts` | 所有 schema 类型/验证口径包含当前 schema42，保持签名、逻辑 SHA、媒体与 secrets manifest。 |
| `scripts/report-media-integrity.mjs` | 与 backup 共享 schema42 source contract。 |
| `scripts/verify-backup.mjs` | 验签、schema42、logical SHA、manifest、媒体/secrets 完整性。 |
| `scripts/restore-backup.mjs` | 只恢复到全新私有目录；拒绝覆盖活动目录和 incomplete marker。 |
| `ops/production/backup-data-schema39.mjs` | 明确标记 historical，不再作为 current timer 源。 |
| `ops/production/backup-to-oss-retention.mjs` | 改为调用 current schema42 wrapper/contract；真实 OSS 仍需独立生产授权。 |
| `ops/production/README.md` | 当前与历史脚本、安装路径、SHA、timer、receipt 分开。 |
| `package.json` | 增加 workflow integration、backup verify/restore rehearsal 的明确命令；默认命令不能误连真实 OSS。 |
| `.github/workflows/quality-gates.yml` | 增加 build 和真实执行的 fake-provider HTTP integration；保持 contents:read，不注入 Provider/OSS/生产密钥。 |
| `scripts/run-safe-tests.mjs` | m104 可在临时数据、动态 loopback、fake Provider 下显式执行 recovery sweep；继续封锁 4173、生产路径和外部 egress。 |
| `scripts/source-coverage-manifest.json` | 登记新增产品/测试/脚本，不能把登记本身叫行为覆盖。 |
| `scripts/architecture-boundaries.json` | 登记新增 server/shared 边界，防止 Client/Generation/Media 反向耦合。 |
| `RELEASE_RUNBOOK.md` | 当前 schema42 路径与旧 schema39 历史流程分开；旧 `scripts/build-release.mjs` 若未被当前发布采用，明确标记 historical，不为满足审计而整套重写。 |

当前正常代码 rollback 目标应是上一份可运行的 schema42 release，而不是把 schema42 数据库直接交给 v0.6.69/schema41 runtime。历史 schema41 备份只属于灾难恢复，必须单独演练和授权，不能冒充普通代码回滚。

## 7. 分阶段实施顺序

项目规则要求同一时间只推进一个写阶段。每阶段通过对应 Matrix 后才进入下一阶段。

### R0：基线、红线和止血决策

当前文档阶段完成：

- 冻结 main/tag/tree、生产 v0.6.70/schema42、审计报告/hash；
- 把 INC-GEN-025 的 GO/发布中状态降为历史声明，当前业务标记 NO-GO；
- 建立 Plan/Matrix/Checkpoint/本地实施 Goal；
- 不改生产。

未来 Goal 启动后的第一步：

- 从实时 origin/main 建新 worktree；
- 只读刷新公开 version/ready/schema；active/unknown-billing task、pending publication 和 backup timer 继续使用审计冻结证据，除非用户另行授权精确的生产只读核对；
- 建预期红：workflow HTTP 真链缺 nested modelId；历史形态 terminal Provider failure 被 sweep 再选中；OpenRouter deferred publication 被误 failed/compensating。

如果需要立刻暂停当前线上整组入口，必须另获生产授权并选择可逆、明确的 workflow-only gate；不得默认打开全局 emergency stop，也不得现场拼 Nginx 黑洞。

### R1：schema42 备份独立修复

1. 统一 backup CLI/server/package/verify/restore 的 schema42 合同。
2. 在全新临时目录构造 schema42 数据，完成 backup → verify → fresh restore。
3. 证明 schema、integrity、FK、logical SHA、关键表计数、media/secrets manifest 一致。
4. 定时 wrapper 默认 fail-closed；OSS 镜像用 fake client，真实 OSS 为 0。
5. 形成独立候选和回执。生产安装/timer 执行需单独版本与发布授权。

R1 不改 generation 业务状态，不借备份修复写生产业务 DB。

### R2：强类型 admission parity

1. 先加 builder 单元红测：任一必填字段缺失编译/运行时均失败。
2. HTTP 路径改用 builder，行为保持。
3. workflow 路径改用同一 builder，补齐 nested `modelId`。
4. reservation 在 store 事务内从 run 权威查出，任何 body-supplied 值只能被忽略或精确比对。
5. 真 HTTP app → workflow create → DB run/node → claim → admission → task/attempt → loopback fake Provider。
6. admission 失败断言 0 task/attempt/Provider；成功同一 node 断言 1 task/1 attempt/1 fake POST。

R2 完成后仍不开放生产真实 workflow。

### R3：Provider outcome classifier 与历史 dry-run

1. 冻结所有 6 adapter 的当前 observation→outcome 表。
2. 实现只依赖 DTO 的纯分类器和原子 settlement；普通 Provider recovery 与 historical terminal-detach/Canvas reconciliation 保持两条独立链。
3. selector/retry/sweep 全部调用分类器。
4. Provider terminal failure 首次写 finished/outcome；第二次及以后 sweep no-op、event 不增长。
5. 本地阶段只对脱敏 production-shaped fixture 或显式非生产冻结副本 dry-run；输入 manifest 必须包含来源报告/DB identity、schema、row fingerprint、tool HEAD 和 manifest hash，缺证据的行标 blocked，不猜测。
6. 生产 exact frozen-copy dry-run 与 apply 都保持未授权；只有 R9 取得精确生产只读/数据授权且 backup/restore 通过后才能生成新的生产 manifest，不能用实时生产读取替代本地 fixture。

不能用“黑名单 GENERATION_FAILED 字符串”代替分类器，也不能把证据不足批量标为退款/未收费。

### R4：同步结果与 OSS durable recovery

1. OpenRouter image 接入统一 result-save/deferred 语义。
2. pending publication 在 task/provider recovery 前拥有优先级。
3. relay-gpt-image 等 sync-only adapter 若无 durable retrieve/idempotency/outbox 证据，在强 workflow 中明确 ineligible；不得谎称自动回收。
4. 每个 exact 目标节点的 selected model 都做 workflow-eligible preflight；每种产品承诺支持的必需 kind 至少有一个 published eligible model。否则创建 run 前稳定报“不支持工作流”，不创建 run/task/attempt。
5. OSS PUT success/conflict/unknown 分流；只按第 6.3 节完整 identity 做 exact HEAD adopt，missing/mismatch/unknown 保留 staged/quarantine。
6. staged→external-ready→result commit→task success 的每个边界做 kill/restart。
7. 图片/视频/音频用同一不变量验证，但保留各自格式/Provider adapter。

### R5：workflow settlement、stop 和服务端 API

1. run/node/task/result/projection 顺序按第 4 节冻结。
2. run 顶层 error 持久化；无 task admission failure 也能查询。
3. stop/finalization 事务内读最新状态并 CAS。
4. projection pending/conflict/failed 独立重试，run success 不降级。
5. malformed plan/API 显式 terminal 或失败，不永久占锁。
6. 多 active run 的恢复互不饥饿，仍复用现有 scheduler。

### R6：客户端一次点击与稳定历史

1. 服务端 response parser 先落地。
2. preparation handle、锁、AbortSignal、bounded deadline 落地。
3. create response 丢失只 reattach 同一 semantic identity。
4. stop await 服务端；失败不报成功。
5. 任务面板同时展示 workflow history 与 task history。
6. saving success/conflict/failure 全出口收口。
7. terminal/projection 更新不靠 `window.location.reload()` 或 localStorage 真相。

### R7：风险驱动测试与 CI

建议新增 `tests/m104-inc-gen-026-reliability.spec.ts`，并扩展：

- `tests/m5-generation-task-store.spec.ts`
- `tests/m10-backup.spec.ts`
- `tests/m22-group-execution.spec.ts`
- `tests/m38-generation-runtime-incidents.spec.ts`
- `tests/m57-relay-generation-runtime.spec.ts`
- `tests/m68-generation-tasks-panel.spec.ts`
- `tests/m86-canvas-load-safety.spec.ts`
- `tests/m88-media-publication.spec.ts`
- `tests/m102-model-execution-contracts.spec.ts`
- `tests/m103-server-authoritative-workflow.spec.ts`

测试顺序：

1. 每个改动模块的最小直接 spec；
2. 共享 task/media/workflow 直接依赖集；
3. CI 中真实执行 build + m104 HTTP fake-provider integration；
4. 候选冻结和 Review GO 后，最多一次 formal safe full；
5. full 失败保留原始结果，只跑失败 spec/最小依赖关闭；相关源码再变才重做对应 Review，不为截图重复 full。

CI 网络必须分层：依赖安装与 `npm audit` 只允许配置好的依赖注册表；应用与测试进程在 m104/故障矩阵期间只允许动态 loopback，Provider、relay、OSS、生产及其他外部 egress 必须为 0。

### R8：候选冻结与独立完整 Review

冻结：

- HEAD/tree；
- tracked diff hash；
- changed file/hunk denominator；
- 新增文件全文；
- test command/environment/exit/receipt；
- 6 adapter、4 media kinds、全部 Provider boundary 分支；
- backup/restore/CI/runbook 变更。

主审和独立 Reviewer 必须逐一覆盖所有 changed files/hunks 及完整调用链。报告必须区分：

- 机械 inventory；
- 代码语义 Review；
- 行为测试；
- 未覆盖/条件性证据。

只有 `P0=0 / P1=0 / GO` 才能进入发布候选。P2 必须说明为什么不阻断；不能为了迎合“全量审计”编造问题，也不能为了赶进度把 P1 降级。

### R9：版本、发布、生产和一次真实验收

以下是原始分阶段门。2026-09-02 最新授权已满足第 1～3 项；第 4～5 项仍未满足，必须保持 NO-GO：

1. 目标版本号；
2. commit/push/PR/CI/tag/Release 授权；
3. 生产备份、安装、切换、rollback/forward 授权；
4. 历史 9-task apply 的精确数据授权；
5. exact Canvas/group、Provider POST 上限、费用上限、真实 OSS 写入的一次 canary 授权。

发布前：

- current schema42 locked-exact backup + verify + fresh restore；
- 当前 release 在 schema42 启动；
- 上一 schema42 release rollback、再 forward；
- active/unknown/pending publication 静默门；
- API/version/live/ready/static/data counts；
- 0 Provider POST、0真实 OSS 门。

真实 canary：

- 先只读核对 exact group shape、模型与 workflow eligibility；
- 证明 exact group 每个已选模型都 eligible，且每种必需 node kind 至少有一个 published eligible model；
- 只点击一次；
- 每 logical node 最多一个 outbound Provider POST；
- 记录 run/node/task/attempt/provider/result asset/projection；
- 关页/重开后服务端继续并可见；
- 用户不进入 Provider/relay/OSS；
- 自动证据只能写 TECHNICAL_PASS，用户看结果后才可能写 USER_PASS。

## 8. 必须执行的故障矩阵

| 故障点 | 必须收敛为 | 禁止 |
|---|---|---|
| run commit 前崩溃 | 无 run 或稳定 admission failure；0 POST | 半个 run/锁残留 |
| run commit 后、task 前崩溃 | claim 同一 node | 第二 run/跳过 node |
| task admission commit 后、launch 前崩溃 | 启动同一 queued task | 第二 task |
| Provider boundary 前崩溃 | 原 task 可继续；0已付费 POST | 新 key |
| paid boundary 后响应丢失 | billing unknown/可查原 identity | 第二 POST |
| async task id 返回、保存前崩溃 | 持久/恢复同一 id | create 新远端 task |
| sync response 到达、staging 前崩溃 | 有行为证据的恢复；否则 adapter workflow-ineligible | 宣称可自动恢复 |
| bytes staged、OSS 暂时失败 | 续传同一 staging | task failed+补偿原结果 |
| PUT 成功、HEAD 失败、DELETE 失败 | 按完整 identity exact adopt；元数据缺失/冲突/暂时不可读则 durable quarantine | overwrite/删除未知对象/无限同 key PUT |
| result commit 后、task success 前崩溃 | 领养同一 asset | 重发 Provider |
| task success 后、node success 前崩溃 | node 领养同一 task | 第二 task |
| node success、projection 409 | projection retry，node success | 降级/重生成 |
| Provider 明确 generation failed | attempt finished，task稳定failed，sweep no-op | failed/recovering循环 |
| stop 与 node finalization 竞态 | 最新事务状态一致 | 客户端假报停止 |
| list API 畸形/503 | 显式读取错误或同 run retry | 伪装为空 |
| 页面关闭/切 Canvas | server run继续；旧请求不能污染新 scope | stale reload/第二create |
| backup 任一步失败 | 无有效 receipt，保留诊断证据 | 把残目录算成功 |
| restore 目标已存在 | fail-closed | 覆盖活动数据 |

## 9. 测试环境和费用红线

- 只使用 `scripts/run-safe-tests.mjs`。
- 只使用 runner 新建的临时 data、动态 loopback 和 fake Provider/OSS。
- 禁止 4173、`app/data`、`/var/lib/unboundry`、生产备份、真实媒体、真实 credential。
- 应用与测试进程的 Provider/relay/OSS/生产/其他外部 egress 必须为 0；依赖安装与 audit 的受控注册表网络单独记录。
- 本地实施阶段 Provider POST/OSS 写/新费用硬上限均为 0。
- 同一未变代码的成功 full 不重复。
- 文档-only 变更不跑业务 full。

## 10. 回滚与数据安全

### 10.1 代码回滚

- 新代码默认保持 schema42，不做 schema 迁移。
- rollback 到上一 schema42 release；先 drain 新 admission，已受理 task/run 继续按兼容 worker 收口。
- rollback 后核对 task/attempt/publication/run/locks/reservation，不只看 `/ready`。

### 10.2 历史 9-task 修复

- apply 前必须有 locked-exact backup 和 fresh restore receipt。
- dry-run manifest 记录每条 task/attempt 的 exact fingerprint。
- 任一 row 漂移则整个 apply fail-closed。
- apply 只允许 settlement 字段与一条有限审计 event；不改 provider_task_id，不删历史。
- repeat 必须 0 mutation。

### 10.3 OSS

- 不删除无法证明由本次调用创建的对象。
- mismatch 保留 durable incident/staging，等待系统管理员处理；普通用户不承担回收。
- 任何 cleanup 必须有可重试持久 intent。

## 11. NO-GO 条件

任一成立立即停止：

1. 仓库/main/tag/tree、生产版本/schema 身份不一致且未解释；
2. 需要读取、哈希、修改、移动或暂存两份受保护 JSON；
3. schema42 backup/verify/fresh restore 未通过；
4. HTTP 与 workflow 仍可手写不同 model configuration；
5. workflow reservation 仍由客户端/body 决定；
6. terminal Provider attempt 仍可被 sweep 反复选中；
7. publication pending 仍可能先被 task failed/compensation；
8. sync-only adapter 无恢复证据却仍标 workflow eligible；
9. OSS mismatch 可覆盖或删除未知对象；
10. stop 请求失败仍显示停止成功；
11. terminal run 无 task 时仍不可见；
12. CI 缺少 build 或真实 workflow HTTP/fake-provider integration；现有 TypeScript、架构、audit、preflight、inventory/source-coverage 不能冒充产品行为测试；
13. candidate Review 有 P0/P1；
14. formal full 被无理由重复；
15. 未获得新版本/发布/生产/Provider/OSS/费用授权；
16. 真实 canary 目标或费用分母不清楚；
17. 任何 unknown outcome 路径可换 key 或第二次付费 POST。
18. exact 目标节点存在 ineligible model，或某种产品承诺支持的必需 kind 没有任何 published eligible model，却仍允许创建 run 或宣称通过。

## 12. 完成定义

只有以下全部成立，才能说 INC-GEN-026 技术完成：

1. 当前 P0 workflow admission 在真实 HTTP fake-provider 链闭合。
2. 6 adapter 均有行为级 recovery 证据或被准确标为 workflow-ineligible。
3. Provider terminal/no-new-fact/unknown/publication-pending 全部单调收敛。
4. OpenRouter、relay、图片、视频、音频 publication 故障矩阵通过。
5. OSS exact adopt/mismatch quarantine 通过。
6. run/node/task/attempt/result/projection 状态顺序全部通过 kill/restart。
7. preparation、stop、terminal history、projection、saving UI 通过。
8. schema42 backup/verify/fresh restore 和 timer contract 通过。
9. CI 真正执行 build 和 fake-provider HTTP integration。
10. 候选完整 Review `P0=0/P1=0/GO`。
11. formal full 原始结果和最小关闭如实记录。
12. 新授权下完成 immutable release、schema42 rollback/forward 和零付费生产门。
13. 新授权下的一次真实 canary 无重复提交、无人工回收。
14. 用户主观确认前保持 `USER_RECHECK`。

在 R0-R8 完成但没有 R9 授权时，最远只能写：

`LOCAL_CANDIDATE_TECHNICAL_PASS / PRODUCTION_NOT_CHANGED / REAL_PROVIDER_NOT_RUN / USER_RECHECK`

## 13. 文档冻结回执

同一独立只读 Reviewer 已覆盖本 Plan、112 项 Matrix、Checkpoint、本地 Goal、当前路由文档和 INC-GEN-025 历史降级头部。首轮如实给出 `DOCUMENT_NO_GO`，指出旧版本路由、branded 入口、OSS identity、eligible-model、CI 网络、relay 条件、历史 fixture、legacy 隔离和分级映射缺口；逐项修正后增量复审结论为 `P0=0 / P1=0 / P2=0 / DOCUMENT_GO`。

上述 `DOCUMENT_GO` 是实施前的方案冻结证据。2026-09-02 的 R0～R8 实施结果以 Matrix、Checkpoint 和本地回执为准：本地候选已技术通过，唯一 formal full 原始 `1162/1167` 与最小关闭 `112/112` 均已记录。R9 的 v0.7.0 GitHub/Release 与 schema42 生产切换现已获一次性授权并正在执行；历史 apply、真实 Provider/OSS、费用、真实 canary 和用户验收仍未授权或未执行。
