# INC-GEN-026 一次点击工作流可靠生成验收矩阵

状态：`V0_7_4_LOCAL_FIX_PASS / INDEPENDENT_REVIEW_GO / RELEASE_AND_REAL_CANVAS_NOT_RUN`

本矩阵与 `spec/INC_GEN_026_ONE_CLICK_WORKFLOW_RELIABILITY_FINAL_IMPLEMENTATION_PLAN_2026-09-01.md` 一一对应。

状态定义：

- `DOC_PASS`：当前事实、边界或方案合同已有直接证据并完成文档确认；不代表代码已修。
- `PENDING`：当前候选的冻结或 Review 门仍在进行，禁止借用历史通过状态。
- `NOT_RUN`：尚未执行对应的外部或终审门。
- `NO_GO`：当前明确禁止进入该动作。
- `USER_RECHECK`：只能由用户在真实页面主观验收。
- `AUTO_PASS`：当前本地候选已有可复验自动证据；只代表本地技术项，不代表 GitHub、生产、真实 Provider/OSS 或用户验收。
- `PRODUCTION_AUTO_PASS`：当前生产已有可复验技术证据；不代表用户主观验收。
- `REAL_PROVIDER_PASS`：生产真实任务已有 task/attempt/result/persistence 证据且没有人工回收；不等于本地候选已发布，也不等于用户主观验收。
- `LOCAL_FIX_PASS`：缺陷修复已有本地直接影响证据；不代表已获得版本号、已发布或线上已修复。

## 2026-09-03 v0.7.4 候选当前覆盖层

生产仍运行`v0.7.3/schema42`。v0.7.4已经获得修复、发布和上线后精确Canvas/group执行一次的最新授权。PR #151已打开；首个branch CI `33666408795`在25ms轮询下12/13失败，轮询改为250ms压力门与45秒终态门后，修正head CI `33668540380`仍12/13失败，45秒时run为`running [success, admitted]`且图片结果保存反复`save/save-retry`、视频未开始。没有发现重复Provider POST；保留日志没有暴露具体数据库错误类型。该证据推翻了“只需修测试”的判断：workflow GET/list此前每次都走写入级数据库打开和`BEGIN IMMEDIATE`，会干扰结果保存。当前候选已改成验证后的事务一致只读快照，不获取SQLite writer lock；250ms压力轮询保留。本地m104 `13/13`、m91+m103 `20/20`通过；此前25/140的Review GO已被产品代码变更取代，最终累计Review覆盖26/26非回执文件、151/151 hunks和1/1回执并`P0=0/P1=0/P2=0/GO`。新head CI、tag/Release、生产切换和真实点击尚未执行。生产失败请求`4666a088-aca9-402b-ba8b-c842023470cb`仍证明0 run/task/admission/attempt/Provider POST；其直接根因为动态Grok首帧角色被静态准入误判，逐节点数据库重复打开令400拖到35.260秒并被浏览器30秒超时遮蔽，服务端节点状态又未驱动原呼吸灯。

本地候选已完成精确动态角色等待、create准入连接复用、`admitted`节点临时呼吸灯映射、不确定create结果的先锁定/只读找回/禁止重提，以及workflow状态查询与writer-open隔离。m22 `45/45`、m104 `13/13`、原直接依赖`106/106`，再加共享数据库m91 `9/9`，去重后共173项PASS；库存1178，TypeScript/build/source coverage/4173隔离通过，formal full未重跑。当前详细门见IG26-122～132和`spec/V0_7_4_RELEASE_CANDIDATE_RECEIPT_2026-09-03.json`。

## 2026-09-02 v0.7.3 发布历史覆盖层

生产现为 `v0.7.3/schema42`。PR #149、双 CI、annotated tag/Release、exact-tag fresh build、locked-exact backup/verify/fresh restore、原子切换与 `v0.7.2→v0.7.3→v0.7.2→v0.7.3` rollback-forward 均通过。v0.7.2 在 Canvas `bcbb1199-d154-4c1a-a580-6b66d2d10f38` 的唯一真实整组 run/task 继续证明 canonical Seedance 入参贯穿 plan/task/key/ownership/request，结果自动回填并刷新持久化；v0.7.3 不重复该付费请求。

保存提示补丁已在 v0.7.3 上线。普通 Chrome 两次加载同一既有 Canvas：文字工作流、3/3图片和1/1视频正常，顶部持续“已保存到云端”，15秒内后续写入0，console error/warn=0；没有点击生成，task/admission/attempt/workflow run/Provider POST 零新增。`IG26-111/119` 继续 `USER_RECHECK`，`IG26-112` 继续 `NO_GO`，`IG26-120/121` 转为 `PRODUCTION_AUTO_PASS`。v0.7.3 一次性授权已消费；下一版本从普通patch v0.7.4开始，不加hotfix后缀。

当前证据主路由为 `spec/V0_7_3_PRODUCTION_RECEIPT_2026-09-02.json`、`spec/V0_7_3_RELEASE_CANDIDATE_RECEIPT_2026-09-02.json`、`spec/V0_7_2_PRODUCTION_RECEIPT_2026-09-02.json`、`spec/INC_GEN_026_CHECKPOINT.md` 顶部覆盖层与本矩阵。

> A～G 与 H 的 IG26-087～098 保留 INC-GEN-026/v0.7.0 当时的验收账本；其中旧 baseline、旧生产身份与 `AUTO_PASS` 只代表历史候选。当前 INC-GEN-028 的 v0.7.2 候选证据看 IG26-099/100，发布后保存状态补丁看 IG26-120/121 和顶部 production receipt。

## A. 权威、范围和审计纪律

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-001 | 最终复核报告身份 | DOC_PASS | 路径和 SHA-256 与 Plan 1.2 完全一致。 |
| IG26-002 | 代码树身份 | DOC_PASS | 本 Goal 基线 HEAD=`94d77d7618f4c88877b457c2249a824d40dd5633`、tree=`2101fe347ef02297d9580906b6cadb71603fc45c`。 |
| IG26-003 | 生产身份 | DOC_PASS | 2026-09-01 18:25 CST 会话内只读快照为 v0.6.70/schema42/ready；未单独落盘为生产 receipt，实施前必须刷新。 |
| IG26-004 | 当前业务判断 | DOC_PASS | 进程健康但正常整组 workflow 为 BROKEN/NO-GO。 |
| IG26-005 | 当前 P0 根因 | DOC_PASS | workflow 手写 modelConfiguration 缺 nested modelId，store 在 Provider 前拒绝。 |
| IG26-006 | 核心产品合同 | DOC_PASS | 一次点击、服务端继续、结果自动回项目、普通用户不手工回收。 |
| IG26-007 | 当前授权边界 | DOC_PASS | 用户已授权 v0.7.0 的一次性 commit/GitHub/Release、schema42 backup/安装/切换/rollback-forward；历史 apply、真实 Provider/OSS、费用与真实 Canvas/group 点击仍未授权。 |
| IG26-008 | 历史授权隔离 | DOC_PASS | INC-GEN-025 的版本/发布/真实点击授权已消费，不得复用。 |
| IG26-009 | 受保护文件边界 | DOC_PASS | 两份受保护 JSON 永久不读、不 hash、不改、不移动、不暂存。 |
| IG26-010 | 不过度审计 | DOC_PASS | 只修有直接证据的风险和必要传播链；正确合同不为迎合审计而判错。 |

## B. schema42 备份与恢复

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-011 | backup CLI schema42 | AUTO_PASS | locked-exact source contract 接受且只接受正确 schema42 身份。 |
| IG26-012 | backup package 类型一致 | AUTO_PASS | server/CLI/report/verify/restore 不再停留在 37–41 或 37–39 类型。 |
| IG26-013 | 不完整冻结 fail-closed | AUTO_PASS | 缺 schema/SHA/freeze/admission/key 任一证据均不发布备份。 |
| IG26-014 | 活动生成边界 | AUTO_PASS | active task、unknown outcome 或活动 publication 不满足冻结策略时阻断最终备份。 |
| IG26-015 | schema42 临时备份 | AUTO_PASS | 只用新临时数据目录生成签名、加密、locked-exact 包。 |
| IG26-016 | backup verify | AUTO_PASS | 签名、manifest、schema、logical SHA、媒体和 secrets 证明全部一致。 |
| IG26-017 | fresh restore | AUTO_PASS | 只恢复到全新私有目录，schema42/integrity/FK/counts/SHA 一致。 |
| IG26-018 | incomplete/overwrite 安全 | AUTO_PASS | incomplete marker 和已存在目标都 fail-closed，不覆盖活动数据。 |
| IG26-019 | current timer contract | NOT_RUN | current wrapper、安装位置、SHA、timer 和 receipt 可复验；schema39 helper 仅历史。 |
| IG26-020 | OSS backup 副作用隔离 | AUTO_PASS | 自动测试只用 fake OSS；真实上传/删除/恢复保持 0，需另授权。 |

## C. 强类型 admission 与服务端 reservation

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-021 | 唯一 authoritative builder | AUTO_PASS | HTTP 与 workflow 共用同一 branded/opaque builder；新 admission 不接受 raw `GenerationTaskInput`、`Record` 或结构化强转，无第二份手写对象。 |
| IG26-022 | nested modelId 必填 | AUTO_PASS | 缺失在编译或 admission 前确定性失败，0 task/attempt/POST。 |
| IG26-023 | model capability/adapter | AUTO_PASS | kind、adapter、result count 与 registry/release 完全一致。 |
| IG26-024 | Provider 身份 | AUTO_PASS | driver/model/protocol/profile/config/credential 全部冻结并 authoritative compare。 |
| IG26-025 | model release 身份 | AUTO_PASS | revision/hash/document 与 active immutable contract 一致。 |
| IG26-026 | semantic identity | AUTO_PASS | input/ownership/contract fingerprints 由共享 compiler 产生并相等。 |
| IG26-027 | workflow binding | AUTO_PASS | run/group/node/canvas/semantic identity 全部精确匹配。 |
| IG26-028 | reservation 服务端权威 | AUTO_PASS | store 事务从 run 查询 reservation；body 无法省略或伪造绕过。 |
| IG26-029 | runtime final fence | AUTO_PASS | 保留 store 层独立校验，不因 builder 通过而删除。 |
| IG26-030 | 真实 HTTP integration | AUTO_PASS | 真 app HTTP create→DB run/node→claim→admit→task/attempt→fake Provider。 |
| IG26-031 | duplicate create 幂等 | AUTO_PASS | 同 semantic identity 只有 1 run/1 task/1 fake Provider POST。 |
| IG26-032 | 四媒体 admission | AUTO_PASS | text/image/video/audio 的合法配置通过，缺字段/漂移均在 Provider 前阻断。 |

## D. Provider outcome、sweep 和历史任务

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-033 | 单一 outcome classifier | AUTO_PASS | task+latest attempt+publication+adapter observation 只由一个纯分类器决策。 |
| IG26-034 | provider terminal failed | AUTO_PASS | 明确失败一次性写 attempt outcome/failure/finishedAt 与稳定 task failure。 |
| IG26-035 | provider accepted/running | AUTO_PASS | 只 inspect 原 task id，不 create 新远端任务。 |
| IG26-036 | publication pending | AUTO_PASS | 只恢复同一 publication bytes，不 inspect/submit。 |
| IG26-037 | temporary inspect failure | AUTO_PASS | 有界退避同一 id，无三态循环和事件风暴。 |
| IG26-038 | billing unknown | AUTO_PASS | 保留原 boundary evidence，禁止新 task/attempt/POST。 |
| IG26-039 | operator incident | AUTO_PASS | 证据冲突稳定隔离并告警，不自动猜测。 |
| IG26-040 | no-new-fact no-op | AUTO_PASS | 重复 sweep task state/event/attempt/updatedAt 不变。 |
| IG26-041 | 原子 settlement | AUTO_PASS | attempt、task、event 在同一事务收口；中间崩溃不留矛盾状态。 |
| IG26-042 | selector 排除 terminal | AUTO_PASS | finished terminal attempt 永不被 failed auto-recover selector 再选中。 |
| IG26-043 | 6 adapter outcome 表 | AUTO_PASS | ark-text/ark-video/mureka/openrouter/relay-gpt/relay-media 全部分支有行为证据；普通 Provider classifier 与 legacy terminal-detach/Canvas reconciliation 互不触发。 |
| IG26-044 | 历史形态 frozen-copy dry-run | AUTO_PASS | 本地只接收脱敏 fixture/显式非生产 data-dir；manifest 含来源 SHA/DB identity、schema、row fingerprint、tool HEAD/hash，缺证据标 blocked，0 mutation/0 Provider。 |
| IG26-045 | 历史 apply 精确门 | AUTO_PASS | exact manifest/hash、全 predicate 相等、单事务、无删除、无 provider id 改写。 |
| IG26-046 | 历史 apply repeat | AUTO_PASS | 第二次运行 0 mutation；原 event/attempt/task 历史完整保留。 |

## E. 同步结果、Media publication 与 OSS

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-047 | OpenRouter 统一 result-save | AUTO_PASS | saveGeneratedPng+commit 进入 attemptProviderResultSave。 |
| IG26-048 | deferred 不误 failed | AUTO_PASS | MediaPublicationDeferredError 保持 recovering/publication-pending。 |
| IG26-049 | pending 不 compensation | AUTO_PASS | staged 原结果不会因 task 误终态被删除。 |
| IG26-050 | relay-gpt sync gap | AUTO_PASS | 对“无 task id + response-received + save 重试耗尽”先检查同一 pending publication：有则只恢复原 bytes，无则原子 `RESULT_SAVE_FAILED_NO_RETRY`；重复 settlement no-op，零第二 attempt/POST。 |
| IG26-051 | workflow eligibility 与可用性 | AUTO_PASS | registry 声明由故障行为测试支撑；exact 目标每个 selected model 均 eligible，且每种产品承诺支持的必需 kind 至少一个 published eligible model；否则 run 前稳定说明且 0 task/POST。 |
| IG26-052 | 图片 durable staging | AUTO_PASS | bytes/checksum/size/format 持久后才允许结果提交。 |
| IG26-053 | 视频 durable staging | AUTO_PASS | OSS 暂时失败保留同一 staging/attempt。 |
| IG26-054 | 音频 durable staging | AUTO_PASS | OSS 暂时失败保留同一 staging/attempt。 |
| IG26-055 | result commit 原子性 | AUTO_PASS | publication ready、attempt completed、task success 同一权威事务。 |
| IG26-056 | OSS PUT outcome 分类 | AUTO_PASS | 明确 success、conflict、unknown 分流，不把全部异常当可删对象。 |
| IG26-057 | OSS exact HEAD adopt | AUTO_PASS | 本地 owner/storage-profile/publication/task/attempt/object-key/kind/format/size/SHA/content-type 与远端 publication/task/attempt/SHA 元数据全部相等才领养。 |
| IG26-058 | OSS mismatch quarantine | AUTO_PASS | 远端元数据缺失、HEAD unknown 或任一字段不符都不覆盖、不删除、不再次 PUT 同 key，保留 staged/incident；普通用户不处理。 |
| IG26-059 | cleanup intent | AUTO_PASS | 只有可证明由本次调用新建的对象才登记 cleanup；delete 失败有持久、可重试 intent，不空 catch 丢证据。 |
| IG26-060 | forbid-overwrite 保持 | AUTO_PASS | 修复不删除对象不可覆盖边界。 |

## F. Workflow run/node/stop/projection

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-061 | immutable run plan | AUTO_PASS | 当前 run 不再读取可变 Canvas 改变生成语义。 |
| IG26-062 | node claim CAS | AUTO_PASS | pending→admitting 只有一个 worker 成功。 |
| IG26-063 | task link 崩溃恢复 | AUTO_PASS | admission commit 后崩溃由 idempotency 领养同一 task。 |
| IG26-064 | task/media 先于 node | AUTO_PASS | task success + durable result ready 后 node 才 success。 |
| IG26-065 | node 先于下游 | AUTO_PASS | 下游只在依赖 node success 后准入。 |
| IG26-066 | run 顶层错误 | AUTO_PASS | 首个决定性 error 持久化；无 task 也可查询。 |
| IG26-067 | stop latest-state CAS | AUTO_PASS | stop/finalization 同事务读取最新状态，旧快照不能覆盖 terminal。 |
| IG26-068 | stop 仅取消未来节点 | AUTO_PASS | accepted task 继续收口，未 admitted 节点 cancelled。 |
| IG26-069 | projection 解耦 | AUTO_PASS | pending/conflict/failed 不降级 node/task，不触发 Provider。 |
| IG26-070 | projection retry | AUTO_PASS | 同一 result/Canvas CAS 幂等重试，成功后可见。 |
| IG26-071 | malformed plan terminal | AUTO_PASS | 损坏 plan 稳定 quarantine/failed，locks/reservation 可审计释放。 |
| IG26-072 | 多 run 无饥饿 | AUTO_PASS | 一个慢/坏 run 不阻塞其他 disjoint run，仍复用现有 scheduler。 |

## G. 客户端一次点击、停止与稳定可见

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-073 | workflow runtime parser | AUTO_PASS | null/畸形/未知 run/node/projection 状态显式失败。 |
| IG26-074 | list 不伪装为空 | AUTO_PASS | 缺失/坏 runs envelope 显示读取失败，不显示“还没有任务”。 |
| IG26-075 | preparation 立即可见 | AUTO_PASS | 点击瞬间显示 preparing 并锁 group/子节点/直接输入。 |
| IG26-076 | preparation Web Lock | AUTO_PASS | 保存→编译→create/reattach 同一有界 lock，支持 AbortSignal。 |
| IG26-077 | preparation 防双击 | AUTO_PASS | 双击/重复 handler 只发一次 create。 |
| IG26-078 | create response 丢失 | AUTO_PASS | 只按 canvas/group/semantic identity reattach，不盲目第二 POST。 |
| IG26-079 | active run 恢复 | AUTO_PASS | 刷新/重开后服务端 active run 重新锁定并 poll。 |
| IG26-080 | terminal run 历史 | AUTO_PASS | success/failed/cancelled 刷新后仍可见，无 task 也显示。 |
| IG26-081 | task/run 分区 | AUTO_PASS | workflow history 不伪造成 generation task，不重复计数。 |
| IG26-082 | stop await | AUTO_PASS | 请求失败不报停止；成功显示 stopping，终态来自 server。 |
| IG26-083 | projection UI | AUTO_PASS | pending/conflict/failed 有持久说明和自动重试状态。 |
| IG26-084 | saving 成对收口 | AUTO_PASS | success/conflict/failure/abort/scope-change 均结束“保存中”。 |
| IG26-085 | 生命周期隔离 | AUTO_PASS | 旧 Canvas delayed callback/reload 不污染新 scope；server run 不因关页停止。 |
| IG26-086 | edge fallback 稳定 | AUTO_PASS | legacy inputOrder 缺失时，不同 array 排列仍产生一致 fingerprint；非法 edge fail-closed。 |

## H. 测试、CI、Review 与证据

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-087 | m104 真 HTTP spec | AUTO_PASS | 启动真实 app HTTP + loopback fake Provider，穿过 workflow→task→attempt。 |
| IG26-088 | fake Provider egress | AUTO_PASS | m104 应用/测试进程只允许动态 loopback，Provider/relay/OSS/生产及其他外部请求=0。 |
| IG26-089 | 6 adapter 故障矩阵 | AUTO_PASS | 每 adapter 覆盖 boundary、response/task id、result save、restart。 |
| IG26-090 | 4 media kind | AUTO_PASS | text/image/video/audio 的 identity、结果和 UI 状态都覆盖。 |
| IG26-091 | persistence kill points | AUTO_PASS | Plan 第 8 节每个边界 kill/restart 收敛且无第二 POST。 |
| IG26-092 | 历史 loop negative test | AUTO_PASS | production-shaped terminal failure 连续 sweep no-op。 |
| IG26-093 | OSS adopt/mismatch test | AUTO_PASS | exact adopt 与 mismatch quarantine 都有 fault injection。 |
| IG26-094 | backup roundtrip test | AUTO_PASS | schema42 backup/verify/fresh restore 全链执行。 |
| IG26-095 | UI regression | AUTO_PASS | preparation、failed no-task history、stop、projection、saving、scope 全覆盖。 |
| IG26-096 | CI build | AUTO_PASS | PR run `33542187106` 与 main run `33542404276` 均实际执行 production build 并 success。 |
| IG26-097 | CI integration | AUTO_PASS | 两个 Quality runs 均执行 m104 真 HTTP/fake-provider integration，不把 discovery 冒充产品测试。 |
| IG26-098 | CI 权限与网络分层 | AUTO_PASS | 两个 Quality runs 使用 contents:read、固定 registry/cache、无 Provider/OSS/生产 secret；应用/测试进程除动态 loopback 外 egress=0。 |
| IG26-099 | INC-GEN-028/v0.7.2 candidate manifest | AUTO_PASS | baseline HEAD/tree=`f3b2f7142382521762a2b772d2eb494e458b7b3f`/`df8172c201ccee22de59afb8daa69c56223a342f`；当前冻结分母为 35 tracked changed files/153 tracked hunks + 2 untracked receipts = 37 files，tracked binary diff SHA-256 见 v0.7.2 candidate receipt。不能复用 pre-version 的 31/143 或 v0.7.0 的 64/671。 |
| IG26-100 | INC-GEN-028/v0.7.2 完整独立 Review | AUTO_PASS | 同一 Reviewer 先覆盖 35/35 tracked files、当时 150/150 hunks 与 2/2 receipts，发现唯一非阻断 P2；修复后又聚焦覆盖 media metadata、m31、safe-runner 与 coverage manifest 增量，最终 `P0=0/P1=0/P2=0/GO`。 |

## I. v0.7.0 历史发布与 post-hotfix 当前生产验收

> IG26-101～107 是 v0.7.0 的历史版本、授权与发布回执；IG26-108～112 才是当前 post-hotfix 真实运行与剩余门。历史 `AUTO_PASS` 不表示 INC-GEN-028 已版本化、获授权或发布。

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-101 | 新版本号 | AUTO_PASS | 用户明确选择 v0.7.0；annotated tag object=`2929ce06…fcf`，peeled commit=`2129f2e0…8aa`，GitHub Release 已发布。 |
| IG26-102 | GitHub/Release 授权 | DOC_PASS | 用户原文“授权上线，版本号v0.7.0”已用于 PR #144、双 CI、tag 与 GitHub Release，本次一次性授权已消费。 |
| IG26-103 | 生产发布授权 | DOC_PASS | 同一原文已用于精确 v0.7.0 release 的 schema42 备份、安装、切换与 rollback/forward；不包含历史 apply 或真实生成，授权已消费。 |
| IG26-104 | 生产 schema42 backup | AUTO_PASS | backup `bc453c79-f491-4eb5-9dee-3ef758b8a844` 完成 locked-exact backup+verify+fresh restore；schema42/integrity/FK/counts/logical SHA 一致。 |
| IG26-105 | 历史 task apply | NO_GO | 用户对 exact manifest 和生产数据写单独授权。 |
| IG26-106 | 零付费生产门 | NOT_RUN | version/live/ready/data/quiet/static 与 Provider POST/OSS 写=0 已有分项证据；但 v0.7.0 没有完整公开的只读 workflow-run/capacity preflight，且未授权 exact Canvas/group，不能把分项证据冒充完整 PASS。 |
| IG26-107 | schema42 rollback/forward | AUTO_PASS | v0.7.0→v0.6.70/schema42→v0.7.0 成对通过，两个方向 ready/schema/counts 正确，最终 current 为 v0.7.0。 |
| IG26-108 | exact 真实 canary | REAL_PROVIDER_PASS | v0.7.2 生产 Canvas 唯一真实整组只产生 1 run/1 task/1 admission/1 Provider attempt，Seedance 结果自动回填并刷新保持。 |
| IG26-109 | 无人工回收 | REAL_PROVIDER_PASS | 本次真实 group 与独立 Seedance 均由网站自动回项目；普通用户没有进入 Provider/relay/OSS 管理台，没有手工下载、搬运或重新上传结果。 |
| IG26-110 | 自动技术证据 | REAL_PROVIDER_PASS | v0.7.2 的 run/node/task/attempt/result/projection/refresh 与 canonical plan/task/key/ownership/request 已由生产真实证据证明；另行发现的保存提示 UI 缺陷由 IG26-120/121 跟踪，不改写本项核心工作流证据。 |
| IG26-111 | 用户主观验收 | USER_RECHECK | 用户在真实页面看结果并明确回复通过。 |
| IG26-112 | 最终关闭 | NO_GO | IG26-001～110 按类别通过，IG26-111 由用户确认后才可 USER_PASS。 |

当前覆盖层结论：IG26-099/100=`AUTO_PASS`，IG26-108～110=`REAL_PROVIDER_PASS`，IG26-120/121=`PRODUCTION_AUTO_PASS`，IG26-111/119=`USER_RECHECK`，IG26-112=`NO_GO`。v0.7.3 技术通过不自动升级用户验收。

## J. INC-GEN-028 / v0.7.2 工作流与 v0.7.3 保存状态发布覆盖层

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-113 | v0.7.2 版本选择 | DOC_PASS | 用户明确原文“版本号 v0.7.2，授权上线”；package、lock、runtime allowlist 与测试断言一致。 |
| IG26-114 | v0.7.2 发布授权 | DOC_PASS | 本次一次性授权包含 commit/push/PR/双 CI/tag/Release、schema42 备份、生产切换与 rollback-forward；执行后即消费。 |
| IG26-115 | 版本与构建门 | AUTO_PASS | safe m81+m82 `49/49 PASS`，TypeScript、production build、source coverage、架构与 4173 隔离均通过；不重复 formal full。 |
| IG26-116 | PR、双 CI、tag 与 Release | AUTO_PASS | PR #148 head 和 main Quality 均成功；annotated tag `v0.7.2` 指向 merge `36f491da…1079`/tree `be8e5612…e7f`，GitHub Release 已发布。 |
| IG26-117 | exact-tag build、backup 与切换 | AUTO_PASS | fresh archive/build/inventory、schema42 locked-exact backup/verify/fresh restore、原子切换、v0.7.1-hotfix.1 rollback 与最终 forward 全部通过。 |
| IG26-118 | 修复后真实 Canvas 验证 | REAL_PROVIDER_PASS | Canvas `bcbb1199-d154-4c1a-a580-6b66d2d10f38` 只执行一次 exact Seedance 输入；plan/task/key/ownership/request 一致，结果自动回填、播放并刷新持久化，无重复提交。 |
| IG26-119 | 用户验收 | USER_RECHECK | 用户在生产实页确认网站工作流符合预期；不评价成片审美。 |
| IG26-120 | 保存提示修复 | PRODUCTION_AUTO_PASS | 相同 metadata 返回原节点；只有当前 snapshot 已与 durable fingerprint 一致时才收口提示。TypeScript、safe m37 `39/39`、m4 `1/1`、m2-text `8/8` 与 diff-check 通过；普通 Chrome 两次加载最终均为“已保存到云端”，稳定观察15秒无后续写入、console error/warn=0。 |
| IG26-121 | 保存提示补丁发布 | PRODUCTION_AUTO_PASS | 用户指定 v0.7.3 的一次性授权已消费；PR #149、双CI、tag/Release、exact-tag build、locked-exact backup/verify/fresh restore、生产切换及rollback-forward均通过，新增Provider POST=0。 |

## K. INC-GEN-028 / v0.7.4 动态准入、呼吸灯与真实工作流

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-122 | 失败请求无计费边界 | DOC_PASS | request `4666a088-aca9-402b-ba8b-c842023470cb`在run创建前400；run/task/admission/attempt/Provider POST均为0。 |
| IG26-123 | 精确动态角色等待 | AUTO_PASS | 只有同kind+role的ready输入或本工作流动态上游可满足角色最低数；无关动态边不能掩盖真实ROLE_CONFLICT。 |
| IG26-124 | 下游权威重解析 | AUTO_PASS | 上游成功后，下游以服务端结果重新解析first-frame并只创建一个task/attempt。 |
| IG26-125 | create准入时延 | AUTO_PASS | 图、模型合同和strict preflight复用一次数据库连接；动态首帧真HTTP fake-Provider测试create为186ms，远低于30秒浏览器上限。 |
| IG26-126 | 服务端节点呼吸灯 | AUTO_PASS | 仅server node `admitted`临时映射四媒体`*Generating`；pending/admitting/terminal不亮，且不写入Canvas数据。 |
| IG26-127 | 不确定create禁止重提 | AUTO_PASS | 可能送达服务端时先设置reconciliation lock，只做GET；90秒期限后仍保留锁并明确提示，POST总数不得增加。 |
| IG26-128 | 风险定向验证 | AUTO_PASS | m22 45/45、m104 13/13、原直接依赖106/106，再加共享数据库m91 9/9，去重后共173项；最新复验m104 13/13、m91+m103 20/20；TypeScript/build/source coverage/4173隔离通过，库存1178。 |
| IG26-129 | 冻结独立Review | AUTO_PASS | 旧25/140 Review GO已被状态读路径产品代码变更取代；最终累计Review覆盖26/26非回执文件、151/151 hunks和1/1回执，结论`P0=0/P1=0/P2=0/GO`。 |
| IG26-130 | v0.7.4发布 | NOT_RUN | PR/双CI、merge后annotated tag/Release、exact-tag fresh build、schema42 backup/restore、切换和rollback-forward全部通过。 |
| IG26-131 | 精确Canvas真实执行一次 | NOT_RUN | v0.7.4生产健康后，只点击目标group一次；记录run/node/task/attempt/Provider次数、呼吸灯、自动回填、保存与刷新。结果不明不得重试。 |
| IG26-132 | 用户最终验收 | USER_RECHECK | 用户确认网站正常生成工作流；不把图片/视频审美纳入本次技术验收。 |
