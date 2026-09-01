# INC-GEN-026 本地实施回执

更新时间：2026-09-02

状态：`R0_R8_LOCAL_CANDIDATE_TECHNICAL_PASS / R0_R8_CANDIDATE_74_FILES_640_HUNKS_FROZEN / FORMAL_FULL_1_OF_1_CONSUMED / TARGETED_CLOSURE_PASS / R9_V0_7_0_AUTHORIZED_IN_PROGRESS / PRODUCTION_V0_6_70_UNCHANGED / REAL_PROVIDER_NOT_AUTHORIZED / USER_RECHECK`

## 1. 结论和授权

INC-GEN-026 R0～R8 已在隔离工作树完成，最终风险定向分母为 `15 unique specs / 412 unique tests PASS`，累计完整 Review 为 `P0=0/P1=0/GO`。唯一 formal safe full 原始结果 `1162/1167` 与 5 项失败永久保留；m41/m73/m81 已最小关闭 `112/112 PASS`，没有第二次 full。本文件第 2～7 节首先保留 R0～R8 本地回执，不把它冒充 GitHub、生产或用户验收回执。

2026-09-02 用户最新原文“授权上线，版本号v0.7.0”已新增一次性 R9 授权：v0.7.0 版本差异、commit/push/PR/CI、合并后不可移动 tag/GitHub Release，以及生产 schema42 locked-exact backup/verify/fresh restore、安装、切换、上一 schema42 release rollback 和最终 forward。历史 9-task apply、timer 安装、真实 Provider、真实 OSS、费用和真实 Canvas/group 点击仍未授权。本段覆盖 R0～R8 冻结时“只授权本地”的历史边界。

两份永久受保护 JSON 没有读取、stat、hash、修改、复制、移动、删除或暂存；所有 Git 盘点和测试均使用显式排除路径。

## 2. 唯一代码身份

- worktree：`/Users/mymy/Documents/unboundry-inc-gen-026-workflow-reliability-2026-09-01`
- branch：`codex/inc-gen-026-workflow-reliability`
- baseline HEAD：`94d77d7618f4c88877b457c2249a824d40dd5633`
- baseline tree：`2101fe347ef02297d9580906b6cadb71603fc45c`
- baseline origin/main：`94d77d7618f4c88877b457c2249a824d40dd5633`
- R0～R8 冻结时 package/schema：`0.6.70 / 42`
- R9 candidate package/schema：`0.7.0 / 42`
- Node/npm：`22.23.1 / 10.9.8`
- safe runner：`node scripts/run-safe-tests.mjs`
- 网络与数据：临时 data、动态 loopback、4173 禁止、应用/测试进程外部 egress 0、无真实 credential

## 3. 候选冻结分母

2026-09-02 R0～R8 最终冻结快照（历史分母；后续 R9 增量另列，不改写本段）：

- tracked changed files：`61`
- tracked diff：`+5999 / -1126`
- tracked zero-context hunks：`640`
- tracked binary diff SHA-256：`7b7f4f4a05d0b67ede89199d0c3b41f57d9adbab778e38825bc164c70ba94792`
- untracked files：`13`（含本回执）
- changed/new files 总分母：`74`
- `scripts/source-coverage-manifest.json` SHA-256：`024782031ab4ec1991e77666cff598474baff2b96686a21cc0978a6d7ab56dbd`
- `tests/safe-test-manifest.json` SHA-256：`9d123cbcdf658e769a422dfd1659afb918fb8b5f61a9bf683b0174ac7c7cbe08`
- `package.json` SHA-256：`5fbac2a99e6e79a48231140408471ceefcd3c721dfcc0c053ffb1cc6e1f243b5`
- `scripts/run-safe-tests.mjs` SHA-256：`c9466ab99140b3f7246773aa31286556a374a7f20b4afbc745216664b7abe005`
- `git diff --check`：exit `0`

tracked changed files（61）：

```text
.github/workflows/quality-gates.yml
AGENTS.md
README.md
RELEASE_RUNBOOK.md
TASKS.md
client/src/canvas/CanvasShell.tsx
client/src/canvas/CanvasSurface.tsx
client/src/canvas/GenerationTasksPanel.tsx
client/src/canvas/GroupNode.tsx
client/src/canvas/TextNode.tsx
client/src/canvas/canvasPersistenceFacade.ts
client/src/generation/GenerationCanvasContext.tsx
client/src/generation/WorkflowExecutionProvider.tsx
client/src/generation/saveGate.ts
client/src/generation/workflowRuns.ts
ops/production/README.md
ops/production/backup-data-schema39.mjs
ops/production/backup-to-oss-retention.mjs
package.json
scripts/architecture-boundaries.json
scripts/backup-data.mjs
scripts/backup-final-candidate.mjs
scripts/check-source-coverage.mjs
scripts/report-media-integrity.mjs
scripts/run-safe-tests.mjs
scripts/source-coverage-manifest.json
server/aliyunOss.ts
server/assetStorage.ts
server/audioStorage.ts
server/backupPackage.ts
server/generationAdmissionApplication.ts
server/generationAttemptQueries.ts
server/generationResultCommit.ts
server/generationTaskStore.ts
server/generationTasks.ts
server/generationTasksApi.ts
server/mediaLifecycle.ts
server/mediaPublicationService.ts
server/modelCatalog.ts
server/modelExecutionRegistry.ts
server/videoStorage.ts
server/workflowRunLocks.ts
server/workflowRunService.ts
spec/INC_GEN_025_ACCEPTANCE_MATRIX_2026-09-01.md
spec/INC_GEN_025_CHECKPOINT.md
spec/INC_GEN_025_ONE_SHOT_GOAL_PROMPT_2026-09-01.md
spec/INC_GEN_025_SERVER_AUTHORITATIVE_GROUP_RUN_PLAN_2026-09-01.md
spec/UNBOUNDRY_CURRENT_STATE.md
tests/m10-backup.spec.ts
tests/m103-server-authoritative-workflow.spec.ts
tests/m22-group-execution.spec.ts
tests/m38-generation-runtime-incidents.spec.ts
tests/m5-generation-task-store.spec.ts
tests/m57-relay-generation-runtime.spec.ts
tests/m73-account-credentials.spec.ts
tests/m81-deployment-hardening.spec.ts
tests/m87-media-integrity.spec.ts
tests/m88-media-publication.spec.ts
tests/safe-test-manifest.json
types/workflowSemanticPlan.ts
上线规矩.md
```

untracked files（13）：

```text
scripts/apply-inc-gen-026-attempt-settlements.mjs
scripts/inspect-inc-gen-026-attempt-settlements.mjs
server/authoritativeGenerationModelConfiguration.ts
server/generationProviderOutcome.ts
server/modelConfigurationIdentity.ts
spec/INC_GEN_026_ACCEPTANCE_MATRIX_2026-09-01.md
spec/INC_GEN_026_CHECKPOINT.md
spec/INC_GEN_026_LOCAL_IMPLEMENTATION_GOAL_PROMPT_2026-09-01.md
spec/INC_GEN_026_LOCAL_IMPLEMENTATION_RECEIPT_2026-09-01.md
spec/INC_GEN_026_ONE_CLICK_WORKFLOW_RELIABILITY_FINAL_IMPLEMENTATION_PLAN_2026-09-01.md
tests/fixtures/inc-gen-026/terminal-provider-failures.redacted.json
tests/m104-inc-gen-026-reliability.spec.ts
types/workflowRuns.ts
```

本回执是未跟踪的新文件，因此不进入 tracked binary diff SHA；它进入 R0～R8 的 74 文件总分母，但不做自引用 hash。formal 后的 m41 产品修复、m73/m81 夹具修复和当时治理路由都已重新冻结并完成增量 Review。

### 3.1 R9 v0.7.0 增量

- package/lock、final runtime allowlist 与部署断言已升为 `0.7.0`；m81+m82 直接相关 safe spec 为 `49/49 PASS`。
- 生产只读预检发现 schema42 库含应原样保留的终态历史 Provider 证据；原 backup gate 会把这些终态历史行误当成当前活动边界，导致 locked-exact backup 永远无法合法创建。
- 修复后 schema42 operational quiet gate 只阻断活动 task、当前 `OUTCOME_UNKNOWN_BILLING_RISK` 和当前关联的未完成 provider-boundary attempt；已完成/已取消/已失败的历史证据原样进入加密备份。schema37/38 historical-recovery 严格门和运行时 paid retry fence均未放宽。
- 最终 m10 直接验证 `18/18 PASS`，source/snapshot=`2beab2f80a11e1731db689139a72c5ff5287bad7261e5e2b4f79170542c4dbba`，immutable builder `1 attempt / 5 invocations / PASS`，snapshot 与 4173 listener 均 unchanged。
- R9 当前完整候选：`64 tracked changed files / +6455 / -1226 / 671 tracked hunks / 13 untracked files / 77 total files`；tracked binary diff SHA-256=`17ae9dbcfa8e594faca782fdb34d329c89dce892d1437d5d23ee5ee57d32e69d`。`scripts/source-coverage-manifest.json` SHA-256=`63b9fb348cdefba513e9367d0a0c8da7f254fbe51bc6c5dff79c1829d607b7b3`，`scripts/run-safe-tests.mjs`=`100cfbb37646d977830839ee561718e4378f7faf0911ddab48a9f0d502581111`，`package.json`=`8b9b20fa55114f045b14e198e3f4ba539aefcf528fa44d5ef0ac79e34bc34b2a`，`package-lock.json`=`7c1359dd62859839729c6d5e49c1a59f64d680b47d167d9ca6b580d1bd4b8ef8`，`git diff --check` exit0。R0～R8 的 74/640 历史分母不回写。
- R9 文档治理 m38 首轮 `17/18` 只暴露 CURRENT_STATE 固定机器标记格式；恢复既有 marker 并另列 R9 发布标记后最小复验 `18/18 PASS`，source/snapshot=`3a258ff6400276103fd8ba3045cdf559aa5c4c06e99e07e3c0048c23dc575da6`，snapshot 与 4173 unchanged。

## 4. 实施收口

- R1：schema42 locked-exact backup/verify/fresh restore；current wrapper 从 module URL 绑定完整 immutable release tree，strict args 在 package/OSS 前 fail-closed；真实 timer/OSS 未运行。
- R2：HTTP/workflow 共享唯一 opaque authoritative builder；nested modelId、capability、Provider/release/semantic/workflow identity 与服务端 reservation/store final fence 一致。
- R3：六 adapter 共用单一纯 outcome classifier；terminal settlement 原子、no-new-fact no-op、billing unknown/operator incident 不产生第二 Provider POST；historical inspect/apply manifest-fenced、逐行 fingerprint、重复 apply 0 mutation。
- R4：OpenRouter 与 image/video/audio 统一 durable staging/publication/result commit；同步 OpenRouter/relay-gpt save exhaustion 先判 pending publication、否则原子 `RESULT_SAVE_FAILED_NO_RETRY`；OSS exact HEAD adopt，mismatch/unknown quarantine，不覆盖、不删除、不再次 PUT 同 key。
- R5：immutable workflow plan、node claim/task link/stop/projection CAS、malformed terminal 精确隔离、首个决定性 run error 原子持久化、历史 recovering+provider-failed 单调收口、锁/reservation 释放与多 run 公平调度。
- R6：点击即 preparation lock；保存→编译→create/reattach 同一有界 Web Lock；unknown create 只读找回、非 retryable 停止请求且保留本地锁；刷新恢复、历史、stop、projection、saving/scope 成对收口。
- R7：m104 真 HTTP+loopback fake Provider；safe runner inventory、source coverage、TypeScript、build、动态端口、credential/egress 门；GitHub CI 只改本地 workflow，未实际运行。

## 5. 风险定向验证

所有命令均通过 `node scripts/run-safe-tests.mjs <spec>` 执行；共同 preflight 包含 Node22、inventory、source coverage、TypeScript、production build、动态 loopback、4173、credential 和 egress 检查。

| spec | 结果 | 退出码 | 主要证明 |
|---|---:|---:|---|
| m104 | `10/10 PASS` | 0 | 真 HTTP、builder、六 adapter、OSS、workflow、client identity/reattach、历史 settlement、OpenRouter |
| m10 | `18/18 PASS` | 0 | schema42 backup/verify/fresh restore、unrelated cwd wrapper、strict args、historical helper |
| m5 | `31/31 PASS` | 0 | store admission、attempt、原子状态、同一 Provider evidence resume |
| m103 | `11/11 PASS` | 0 | workflow locks/reservation/malformed/sweep/stop |
| m88 | `38/38 PASS` | 0 | durable publication/staging、OSS retry、原子 result commit |
| m22 | `44/44 PASS` | 0 | browser one-click/stop/history/saving/source contract |
| m87 | `8/8 PASS` | 0 | media integrity 与 locked receipt hashes |
| m16 | `12/12 PASS` | 0 | Ark video Provider boundaries |
| m33 | `9/9 PASS` | 0 | text generation runtime |
| m41 | `54/54 PASS` | 0 | generation retry/UI |
| m86 | `83/83 PASS` | 0 | Canvas scope/load/save safety |
| m57 | `18/18 PASS` | 0 | OpenRouter/relay-gpt 同步 save exhaustion、pending publication、零第二 attempt |
| m38 | `18/18 PASS` | 0 | recovery sweep、sync response-save loss、authoritative fixtures、治理合同 |
| m73 | `16/16 PASS` | 0 | authoritative current-admission fixture 与 model identity |
| m81 | `42/42 PASS` | 0 | deployment-hardening fixture 与 terminal monotonic expectation |

合计：`15 unique specs / 412 unique tests PASS`。完整 inventory 为 `124 specs / 1167 tests`；这是风险定向与 formal 失败最小关闭，不称为完整全绿回归。

最终 m41 source/snapshot：`eb75ba5445fd11dc3c90ab19ce9df5b84840f14b09cac0b109093f6069e53ed7`；4173 listener identity：`24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`，unchanged。此前 m38、m5/m103/m104、m57、m22 与 m10 快照保留为各自直接证据。

诊断失败完整保留：m104 一次 source-coverage hash 过期；m104 一次缺失 client classifier import；m5 两个 fixture/query 问题；m57 一次 fixture FK；m38 首轮 13/18 的五项直接问题；formal full 的 m41 一项真实产品竞态和 m73/m81 四项旧 fixture/expectation 问题。都只修直接根因并重跑最小受影响 spec；formal full 只执行一次。

## 6. Review 证据

- 主线程：已逐链审阅 server/store/workflow/Provider/publication/OSS/client/backup/CI/historical settlement。
- 首次独立完整 Review：`69/69 files / 542/542 tracked hunks`，结论 `P0=0/P1=2/P2=2/NO-GO`。malformed 隔离、同步 save exhaustion、run 首错和 recovering+provider-failed 四项均已按直接根因关闭并通过最小受影响验证。
- 修复后服务端完整复审累计覆盖当时 `71/71 files / 591/591 tracked hunks`，结论 `P0=0/P1=0/P2=2/GO`。
- formal 后 m73/m81 增量复审为 `P0=0/P1=0`，确认只修夹具且生产 fail-closed 校验未放宽。
- m41 首次增量复审识别真实 P1；修复后的 TextNode/m41 最终复审为 `P0=0/P1=0/P2=0/GO`。
- backup/CI 增量复审：此前 WorkingDirectory 和参数 parser 两项 P1 已关闭；最终 `P0=0/P1=0`，代码级 GO。timer/immutable install/真实 OSS receipt 保持 NOT_RUN，不属于本地代码缺陷。
- 最终累计 Review denominator：`74/74 files / 640/640 tracked hunks`；所有测试、源码和治理增量均纳入对账。
- R9 增量终审：同一独立 Reviewer 覆盖当前完整 `77/77 files / 671/671 tracked hunks` 与 backup/version/release/docs 链；首次指出本文件把待确认的 IG26-100 过早写成 `AUTO_PASS`，修正后完成极小增量确认，最终 `P0=0/P1=0/P2=2/GO`。
- 非阻断 P2 两项：malformed 跨 owner 数据库错链可再加 quarantine 二次 binding 校验；OpenRouter/relay-gpt 同步 save exhaustion 仍缺真实 adapter fake-transport seam。正常 API exact binding、当前 helper/source wiring 和行为证据成立，因此不阻断本地候选。

## 7. Formal full 与剩余门

- formal safe full：`1/1 / CONSUMED`。命令 `node scripts/run-safe-tests.mjs full`，退出 `1`；`124/124 specs`、`1167 tests`、`1162 passed`、`5 failed`、`0 skipped/retries/reportErrors`。source/snapshot=`d0fee75970a625e020337b3bc062729e5e575f8345596322f0a2531c2c86f16e`，snapshot unchanged；immutable builder `1 attempt / 5 invocations / PASS`；4173 unchanged。
- formal 最小关闭：m41 `54/54`、m73 `16/16`、m81 `42/42`，合计 `112/112 PASS`。原始失败不改写为 full 全绿，禁止第二次 full。
- candidate manifest：IG26-099=`AUTO_PASS`，见第 3 节。
- complete independent Review：IG26-100=`AUTO_PASS`；当前完整候选最终 `P0=0/P1=0/P2=2/GO`。
- GitHub CI：R0～R8 时点为 `NOT_RUN`；R9 已授权，等待实际 PR/main runs。
- current timer/install receipt：`NOT_RUN`。
- production backup/switch/rollback-forward：R9 已授权、尚未执行；Provider/OSS/history apply 继续 `NO_GO`。
- user real-page acceptance：`USER_RECHECK`。

下一步只有一个：完成已授权的 v0.7.0 GitHub/Release、schema42 backup/切换/rollback-forward 和零付费门；历史 apply 与真实 canary 不夹带执行。
