# INC-GEN-026 Checkpoint

更新时间：2026-09-02

状态：`PRODUCTION_V0_7_1_HOTFIX_1_STABLE / V0_7_2_RELEASE_AUTHORIZED / VERSION_GATES_49_OF_49_PASS / RELEASE_CANDIDATE_REVIEW_GO / USER_RECHECK`

## 2026-09-02 post-hotfix 当前覆盖层

- 生产 current=`/opt/unboundry/releases/v0.7.1-hotfix.1-inc-gen-027-20260902`，tag/merge=`f3b2f7142382521762a2b772d2eb494e458b7b3f`，tree=`df8172c201ccee22de59afb8daa69c56223a342f`，package/schema=`0.7.1/42`，active/ready。
- 真实 Canvas `bcbb1199-d154-4c1a-a580-6b66d2d10f38` 的 run `08c2e8a5-89c1-4ebf-a935-632a7f5dc4bc` 已自动完成 6 个文字节点与 4 个图片节点；10 tasks/10 attempts、4 result assets，刷新后保持，无人工去 Provider/relay/OSS 找结果。
- 独立 Seedance task `bb6e194e-c280-438d-8015-727841e23132`、Provider task `cgt-20260902064018-zx296` 只 admission/attempt 一次并成功回填 MP4；刷新后保持、无重复提交、无人工回收。
- 生产本地图片、视频、音频上传均已证明 ready 与刷新保持；视频 asset `fc40b521-c02f-4920-a457-d6b1c1ae12c3.mp4`、音频 asset `d0e77a5f-514e-4451-bfa1-59d1a7c64752.mp3` 均从 OSS 回放 readyState=4。
- 第二点审计确认是严重入参合同问题：组工作流 strict preflight 会把旧 Seedance `inputMode=text + first-frame` 正确规范化为 `multimodal + reference-image`，但生产源码仍可能把原始参数用于冻结 plan、task、generationInputKey、ownershipKey 与 request intent。当前 Provider 可能因读取 normalized snapshot 而偶然成功，但幂等、恢复、relay 与声明式合同身份会不一致，定级 `P1_NEAR_P0`。
- 另确认旧 Canvas canonical 媒体元数据回填 bug，以及无任务绑定的历史 ROLE_CONFLICT 红字残留。INC-GEN-028 本地候选已经修复上述三项，并补齐三媒体异步 assetId 竞态保护、旧 Seedance retry policy、pending metadata 最多三次有界重拉和 failed 明确终态；累计 8 个直接相关 safe specs、76 tests 全部通过，当前测试库存 1175，P2 后直接影响的 4 specs/27 tests 通过，TypeScript、source coverage、production build、diff-check 与 4173 隔离门通过，真实 Provider POST=0。
- 首轮独立逐文件/逐 hunk 复核覆盖当时 28/28 tracked files、99/99 hunks 与 1/1 receipt，代码结论 `P0=0/P1=0/GO`；唯一 P1 是验收矩阵错误复用了 v0.7.0 的 64 files/671 hunks/旧 Review AUTO_PASS。第二轮覆盖 31/31 files、120/120 hunks 与 receipt，再次确认代码 `P0=0/P1=0/GO`，并发现 AGENTS/Current State 仍把旧 INC-GEN-026 路由称作当前的文档 P1。两轮 P1 与 assetId 竞态、三媒体 legacy E2E、retry policy、旧版本命令 P2 均已整改；最终独立增量 Review 覆盖 31/31 tracked files、143/143 hunks 与 1/1 receipt，结论 `P0=0/P1=0/P2=0/GO`。
- 用户已明确回复“版本号 v0.7.2，授权上线”。package/lock/runtime allowlist 与 m81 断言已经同步，m81+m82 `49/49 PASS`；v0.7.2 完整候选 Review 覆盖 35/35 tracked files、当时 150/150 hunks 与 2/2 receipts，发现唯一非阻断 P2 后已修复；同一 Reviewer 聚焦复核 P2 增量后结论 `P0/P1/P2=0/0/0/GO`。现在执行 PR/双 CI/tag/Release、exact-tag fresh build、schema42 locked-exact backup、生产切换与 rollback-forward；v0.7.2 技术门全绿后才在原 Canvas 做一次真实 Seedance 验证，结果不明不得重发。

v0.7.2 候选回执：`spec/V0_7_2_RELEASE_CANDIDATE_RECEIPT_2026-09-02.json`；发布前生产回执：`spec/V0_7_1_HOTFIX_1_PRODUCTION_RECEIPT_2026-09-02.json`。当前本地 worktree=`/Users/mymy/Documents/unboundry-inc-gen-028-workflow-input-contract-2026-09-02`，branch=`codex/inc-gen-028-workflow-input-contract`，baseline=`f3b2f7142382521762a2b772d2eb494e458b7b3f`。

> 以下内容是 v0.7.0/R9 历史快照。原测试、授权与回执继续保留，但不能覆盖上面的生产版本、真实验证结果、INC-GEN-028 缺陷判断或新发布授权状态。

## v0.7.0 历史一句话结论

INC-GEN-026 v0.7.0 已完成 PR #144、分支/main 双 CI、不可移动 tag/GitHub Release、schema42 locked-exact 备份与全新恢复、原子切换、旧版回退及最终前滚。生产当前运行 v0.7.0/schema42，公网与回环 live/ready、33/33 静态文件、数据库 integrity/FK/静默状态及 50 秒稳定门通过，NRestarts=0；生成 admission/attempt/task 和业务数据不变，Provider POST、OSS 写、真实点击与费用均为 0。v0.7.0 没有完整公开的只读 workflow-run/capacity preflight，且本次未授权 exact Canvas/group，因此 IG26-106 诚实保持 `NOT_RUN`，不能把分项健康检查冒充完整 run preflight。用户实页确认前保持 `USER_RECHECK`。

## v0.7.0 历史代码身份

- worktree：`/Users/mymy/Documents/unboundry-inc-gen-026-workflow-reliability-2026-09-01`
- branch：`codex/inc-gen-026-workflow-reliability`
- baseline HEAD：`94d77d7618f4c88877b457c2249a824d40dd5633`
- baseline tree：`2101fe347ef02297d9580906b6cadb71603fc45c`
- baseline origin/main：与 HEAD 相同
- candidate package/schema：`0.7.0 / 42`
- current production package/schema：`0.7.0 / 42`
- safe runner：Node `22.23.1`、npm `10.9.8`、动态 loopback、临时 data、4173 禁止
- formal full：`1/1`，权限已消费，禁止重跑
- current complete candidate denominator：`64 tracked changed files / 671 tracked hunks / 13 untracked files / 77 total files`
- current tracked binary diff SHA-256：`17ae9dbcfa8e594faca782fdb34d329c89dce892d1437d5d23ee5ee57d32e69d`

R9 已完成：annotated tag `v0.7.0` 指向 merge `2129f2e0b729306f84c1245f43fac8923fea88aa`；生产 current=`/opt/unboundry/releases/v0.7.0-inc-gen-026-20260902`，service active/enabled、NRestarts=0，公网与回环 version/live/ready 均通过，schema42/integrity ok/FK0，active task=0、unsettled current unknown=0、active publication=0、active workflow run=0。权威回执为 `spec/V0_7_0_PRODUCTION_RECEIPT_2026-09-02.json`。

## R9 历史授权（已消费）

- 用户原文：`授权上线，版本号v0.7.0`。
- 允许：v0.7.0 版本差异、commit/push/PR/CI/tag/GitHub Release、schema42 locked-exact backup/verify/fresh restore、生产安装/切换、上一 schema42 release rollback 与最终 forward、零付费技术门。
- 不允许：历史 9-task apply、真实 Provider POST、真实 OSS 写/删/恢复、任何费用、真实 Canvas/group 点击。
- 唯一 formal full 已消费，禁止重跑；版本差异只运行 m81 等直接相关 safe spec、build/CI 与增量 Review。

## v0.7.0 历史读取顺序

1. `spec/INC_GEN_026_CHECKPOINT.md`
2. `spec/INC_GEN_026_ONE_CLICK_WORKFLOW_RELIABILITY_FINAL_IMPLEMENTATION_PLAN_2026-09-01.md`
3. `spec/INC_GEN_026_ACCEPTANCE_MATRIX_2026-09-01.md`
4. `spec/INC_GEN_026_LOCAL_IMPLEMENTATION_RECEIPT_2026-09-01.md`
5. `spec/INC_GEN_026_LOCAL_IMPLEMENTATION_GOAL_PROMPT_2026-09-01.md`（本 Goal 的历史授权文本）
6. `AGENTS.md`、`spec/UNBOUNDRY_CURRENT_STATE.md`、`TASKS.md`、`上线规矩.md` 顶部当前区块

INC-GEN-025 文档和更早记录只作历史证据，不能恢复已经消费的版本、发布或真实点击授权。

## 已完成的实现

### R1：schema42 backup

- current locked-exact 合同只接受 schema42；37～41 只在显式 historical-recovery 路径保留。
- schema42 operational quiet gate 只阻断活动 task、当前 unknown-billing task 和当前关联的未完成 provider-boundary attempt；终态历史 Provider 证据原样备份。schema37/38 historical-recovery 的严格重建门与运行时 paid retry fence 均未放宽。
- backup→签名/加密→verify→fresh private restore 的 logical SHA、schema、integrity、FK、table、media 和 secrets receipt 一致。
- current OSS wrapper 从自身不可变 module URL 解析完整 release tree，不依赖 WorkingDirectory；显式 data-dir 同时绑定数据库和 storage profile。
- unknown、缺值、重复 single option/flag 在创建 backup package 或 OSS client 前 fail-closed。
- wrapper 默认只生成本地 dry-run inventory；真实 upload/delete/restore 和 timer 安装均未执行。

### R2：authoritative admission

- HTTP 与 workflow 共用唯一 opaque/runtime-branded builder。
- nested modelId、capability、adapter、result count、Provider identity、release revision、semantic identity 与 workflow binding 完整比较。
- workflow reservation 由服务端事务从 locked run 读取，body 不能省略或伪造。
- store 保留独立最终 fence；四媒体缺字段或漂移均在 Provider 前失败。

### R3：Provider outcome 与历史 settlement

- 六个 adapter 共用纯 DTO classifier；publication pending 优先，terminal/no-new-fact/billing-unknown/operator incident 单调收敛。
- Provider terminal failure 原子写 attempt/task/event，finished_at 非空；重复 sweep 不增长事件、不重启、不产生第二 POST。
- historical inspect/apply 只接受显式非生产 data-dir、私有 exact evidence、DB dev/inode/schema42、source hashes、tool hashes 和逐行 fingerprint。
- apply 在一个 immediate transaction 中重新检查全部 predicate；重复 apply 为 0 mutation，不删除历史、不改 Provider ID。

### R4：result publication 与 OSS

- OpenRouter 同步图片进入统一 deferred publication/result commit 链。
- OpenRouter 与 relay-gpt 的同步响应若在 result-save 重试耗尽时仍没有 Provider task id，会先检查同一 publication：有 pending bytes 只恢复原 publication，无 pending bytes 才原子收口为 `RESULT_SAVE_FAILED_NO_RETRY`；重复 settlement 为 no-op，绝不再次 POST。
- image/video/audio staging 在暂时 OSS 失败时保留相同 bytes/attempt，并由同一 publication 恢复。
- exact HEAD adopt 要求本地和远端完整 identity 相等；mismatch/unknown 只 quarantine，不覆盖、不删除、不再次 PUT 同 key。
- result ready、attempt completed、task success 使用权威事务收口。

### R5：server workflow

- run 保存递归冻结的 immutable semantic plan；worker 不再从可变 Canvas 重取生成语义。
- node claim、task link、stop/finalize、projection、lock/reservation 都有 CAS/事务边界。
- accepted task 继续收口，stop 只取消未来节点；malformed plan 稳定 terminal 并释放本 run 资源。
- malformed quarantine 使用 `recoverRunning:false` 的精确 store，不再改变其他 run 的 running task；run 顶层首个决定性错误与 node settlement 同事务持久化，历史 `recovering + provider-failed` 组合自动单调收口。
- scheduler 对多个 disjoint run 公平，慢/坏 run 不阻塞其他 run。

### R6：browser one-click

- 点击立即建立 preparation handle、group/node/input lock，保存→编译→create/reattach 受同一有界 Web Lock 保护。
- create 回执不明后只按 canvas/group/semantic identity 只读找回，绝不第二 POST。
- transient read 继续只读 retry；400/malformed/identity incident 停止无限请求，并保留 unknown-create 本地锁。
- pagehide/scope change 只 detach 浏览器，不 stop 服务端；stop 必须等待服务端确认。
- active/terminal history 持久可见，task/run 分区；stale list 不覆盖更新 terminal event；Canvas refresh 失败也释放已 terminal 的本地锁。

### R7：测试与 CI 合同

- 新增 m104 真 HTTP→workflow→task→attempt→loopback fake Provider 集成。
- safe runner inventory 为 `124 specs / 1167 tests`，Node22/source coverage/TypeScript/build/动态端口/4173/credential/egress 门均通过定向运行的共同 preflight。
- Quality workflow 已接入固定 registry/cache、production build 和 m104 integration；PR run `33542187106` 与 main run `33542404276` 均为 success，Matrix IG26-096～098=`AUTO_PASS`。

## 风险定向自动证据

| spec | 结果 | 直接覆盖 |
|---|---:|---|
| m104 | `10/10 PASS` | builder、6 adapter classifier、OSS adopt/quarantine、immutable/fair workflow、浏览器 identity/reattach、真 HTTP、terminal no-op、历史 settlement、OpenRouter |
| m10 | `18/18 PASS` | schema42 locked backup/verify/fresh restore、wrapper unrelated cwd/strict args、历史 recovery、immutable release operational check |
| m5 | `31/31 PASS` | store admission、Provider attempt、atomic transition、resume same Provider evidence |
| m103 | `11/11 PASS` | schema42 workflow boundary、locks/reservation、malformed plan、server sweep/stop |
| m88 | `38/38 PASS` | media publication、durable staging、OSS retry、atomic result commit |
| m22 | `44/44 PASS` | browser one-click/stop/history/saving/source contract |
| m87 | `8/8 PASS` | media integrity report、locked receipt hashes |
| m16 | `12/12 PASS` | Ark video Provider boundaries |
| m33 | `9/9 PASS` | text generation runtime |
| m41 | `54/54 PASS` | generation retry/UI |
| m86 | `83/83 PASS` | Canvas scope/load/save safety |
| m57 | `18/18 PASS` | OpenRouter/relay-gpt 同步 result-save 耗尽、pending publication 与零第二 attempt |
| m38 | `18/18 PASS` | recovery sweep、同步 response-save loss、严格 authoritative fixture 与治理合同 |
| m73 | `16/16 PASS` | 当前 admission fixture 使用权威 builder/configuration identity |
| m81 | `42/42 PASS` | deployment hardening 当前 fixture 与 terminal monotonic expectation |

最终风险定向分母为 `15 unique specs / 412 unique tests PASS`。formal 后直接关闭集合为 m41+m73+m81=`112/112 PASS`；最终 m41 source/snapshot=`eb75ba5445fd11dc3c90ab19ce9df5b84840f14b09cac0b109093f6069e53ed7`，4173 listener identity 保持 `24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`。

R9 直接相关增量：m81+m82=`49/49 PASS`；backup quiet-gate 最终 m10=`18/18 PASS`，source/snapshot=`2beab2f80a11e1731db689139a72c5ff5287bad7261e5e2b4f79170542c4dbba`，immutable builder=`1 attempt / 5 invocations / PASS`，snapshot 与 4173 listener unchanged。期间两次前置/夹具失败和一次架构边界失败均如实保留，只修直接根因后最小重跑；没有第二次 full。

R9 文档治理 m38 首轮 `17/18` 只暴露 `UNBOUNDRY_CURRENT_STATE.md` 的固定机器标记被自由文本替换；恢复 `生产是` 与 `CURRENT_V0_6_70_USER_RECHECK`，并把 R9 状态移到独立发布标记后，最小复验 `18/18 PASS`，source/snapshot=`3a258ff6400276103fd8ba3045cdf559aa5c4c06e99e07e3c0048c23dc575da6`，4173 unchanged。

生产部署后的最终回执治理继续如实保留：一次错误参数调用在执行测试前即被 runner 拒绝；随后 m38 两次 `17/18` 分别只暴露 `AGENTS.md` 缺少精确 `生产运行` 标记、三份渐进模块化文档仍保留 `CURRENT_V0_6_70`。逐项修正并完成全部回执文字后，最终同一 spec 为 `18/18 PASS`、snapshot 与 4173 unchanged；没有重跑 formal full。最终 source 指纹不自写进参与该指纹的文档，提交树改由 Git commit 与 PR/main CI 绑定，避免制造不可能稳定的自引用哈希。

诊断期间曾出现并已关闭的失败必须保留：m104 一次 source-coverage hash 过期、m104 一次缺失 client classifier import、m5 两个夹具/查询问题、m57 一次 fixture FK、m38 首轮 13/18 的五项直接问题；formal full 的 m41 一项真实产品竞态与 m73/m81 四项旧 fixture/expectation 问题也永久保留。每次只修直接根因并重跑最小受影响 spec；formal full 只执行一次。

## 唯一 formal full 与最小关闭

- 命令：`node scripts/run-safe-tests.mjs full`
- 原始退出：`1`
- 原始分母：`124/124 specs`、`1167 tests`、`1162 passed`、`5 failed`、`0 skipped/retries/reportErrors`
- 原始 source/snapshot：`d0fee75970a625e020337b3bc062729e5e575f8345596322f0a2531c2c86f16e`，snapshot unchanged
- immutable builder：`1 attempt / 5 invocations / PASS`
- 4173 listener：unchanged
- m41：输入指纹 effect 与 recovery effect 对同一旧 Text ownership 排队两次撤销，首个 durable callback 被 mutation version 抑制；现按旧 task/input/ownership 精确清图、同 scope/identity 合并一次 durable mutation，并保护新 task。最终 m41 `54/54 PASS`。
- m73/m81：旧 current-admission fixture 缺 authoritative model identity；保留生产 fail-closed 校验，夹具改用权威 builder。m73 `16/16 PASS`、m81 `42/42 PASS`。
- formal full 权限已经消费；上面的最小关闭不能把原始 full 改写成全绿，也不允许第二次 full。

## Review 状态

- 主线程已逐链审阅 server/store/workflow/Provider/publication/OSS/client/backup/CI/historical settlement。
- 首次独立完整 Review 已覆盖 `69/69 files / 542/542 tracked hunks`，结论 `P0=0/P1=2/P2=2/NO-GO`。四项分别是 malformed quarantine 误恢复无关 running task、同步 adapter save exhaustion 悬挂、run 首错未按观察顺序持久化、历史 recovering+provider-failed 悬挂；均已修复并由 m103、m57/m38、m104 直接验证。
- 修复后服务端完整复审累计覆盖当时 `71/71 files / 591/591 tracked hunks`，结论 `P0=0/P1=0/P2=2/GO`。
- formal 后 m73/m81 夹具增量复审为 `P0=0/P1=0`；没有放宽生产校验。
- m41 首次增量复审把 formal 失败识别为真实 P1；修复后的最终 TextNode/m41 复审为 `P0=0/P1=0/P2=0/GO`。
- backup/CI 增量审计曾发现 WorkingDirectory 与参数 parser 两个 P1；已修复并以 m10 `18/18` 验证，同一 Reviewer 最终复审为 `P0=0/P1=0/代码级 GO`。timer/install/真实 OSS 回执保持 NOT_RUN，不属于本地代码缺陷。
- R0～R8 最终累计分母为 `74/74 files / 640/640 tracked hunks`；当时文档与测试增量已纳入同一完整 denominator。
- R9 v0.7.0/backup/docs 已冻结为当前完整 `77 files / 671 tracked hunks`，tracked binary diff SHA-256=`17ae9dbcfa8e594faca782fdb34d329c89dce892d1437d5d23ee5ee57d32e69d`；IG26-099=`AUTO_PASS`。同一独立 Reviewer 已在修正文档状态矛盾后完成增量确认，当前完整候选为 `P0=0/P1=0/P2=2/GO`，IG26-100=`AUTO_PASS`。
- 两项非阻断 P2：数据库已被破坏且跨 owner 错链时 quarantine 可再加 owner/binding 二次校验；OpenRouter/relay-gpt 同步 save exhaustion 仍缺真实 adapter fake-transport seam。正常 API 已有 exact binding，当前 helper/source wiring 与直接行为测试成立，因此不阻断本地候选。

## R9 生产结果与下一阶段

- v0.7.0 已稳定部署，schema42 backup/verify/fresh restore 与 rollback/forward 均通过；IG26-104/107=`AUTO_PASS`。
- 可安全执行的 version/live/ready/data/quiet/static 技术门通过；因缺少完整只读 workflow-run/capacity operator preflight，IG26-106 仍为 `NOT_RUN`。
- 历史数据 apply 与真实 canary 仍是独立 `NO_GO`；IG26-109/110 没有随发布自动通过。
- 唯一下一步是用户打开生产实页复验；用户明确回复通过前维持 `USER_RECHECK`。

## 授权与永久红线

本次 v0.7.0 commit/GitHub/Release、生产 schema42 备份/切换/rollback/forward 一次性授权已经执行并消费；不得据此再次发布或切换。

禁止：历史生产 data apply、真实 Provider、真实 OSS、费用、真实 Canvas/group 点击。

以下两份文件永久禁止读取、stat/hash、修改、复制、移动、删除、暂存或提交：

- `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json`
- `spec/public-templates-director-split-revision.json`
