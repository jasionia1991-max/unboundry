# INC-GEN-026 一次点击工作流可靠生成验收矩阵

状态：`R0_R8_COMPLETE / LOCAL_CANDIDATE_TECHNICAL_PASS / FORMAL_FULL_1_OF_1_CONSUMED / TARGETED_CLOSURE_PASS / R9_V0_7_0_AUTHORIZED_IN_PROGRESS / PRODUCTION_V0_6_70_UNCHANGED`

本矩阵与 `spec/INC_GEN_026_ONE_CLICK_WORKFLOW_RELIABILITY_FINAL_IMPLEMENTATION_PLAN_2026-09-01.md` 一一对应。

状态定义：

- `DOC_PASS`：当前事实、边界或方案合同已有直接证据并完成文档确认；不代表代码已修。
- `NOT_RUN`：尚未执行对应的外部或终审门。
- `NO_GO`：当前明确禁止进入该动作。
- `USER_RECHECK`：只能由用户在真实页面主观验收。
- `AUTO_PASS`：当前本地候选已有可复验自动证据；只代表本地技术项，不代表 GitHub、生产、真实 Provider/OSS 或用户验收。

证据主路由 `spec/INC_GEN_026_LOCAL_IMPLEMENTATION_RECEIPT_2026-09-01.md` 绑定 HEAD/tree、命令、环境、测试分母、退出码、候选文件/hunk 分母和直接证据。

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
| IG26-096 | CI build | NOT_RUN | Quality gates 实际执行 npm build，失败即阻断。 |
| IG26-097 | CI integration | NOT_RUN | CI 实际运行 m104 等高风险集，不把 preflight/--list 叫产品测试。 |
| IG26-098 | CI 权限与网络分层 | NOT_RUN | contents:read；无 Provider/OSS/生产 secret；依赖安装/audit 只走配置注册表，应用/测试进程除动态 loopback 外 egress=0。 |
| IG26-099 | candidate manifest | AUTO_PASS | baseline HEAD/tree 不变；当前完整候选为 64 tracked changed files、671 tracked hunks、13 untracked files、77 files 总分母，tracked binary diff SHA-256=`17ae9dbcfa8e594faca782fdb34d329c89dce892d1437d5d23ee5ee57d32e69d`。R0～R8 的 74/640 作为历史冻结分母保留。 |
| IG26-100 | 完整独立 Review | AUTO_PASS | 同一独立 Reviewer 已覆盖 R9 新增/变化文件与 backup/version/release/docs 链，并在修正文档状态矛盾后增量确认当前完整候选：`P0=0/P1=0/P2=2/GO`。 |

## I. 版本、发布、生产和用户验收

| ID | 验收项 | 当前状态 | 通过标准 |
|---|---|---|---|
| IG26-101 | 新版本号 | AUTO_PASS | 用户明确选择 v0.7.0；实时核对远端 tag 与 GitHub Release 均未占用。 |
| IG26-102 | GitHub/Release 授权 | DOC_PASS | 用户原文“授权上线，版本号v0.7.0”按上线规矩授权本次 commit/push/PR/CI/tag/Release。 |
| IG26-103 | 生产发布授权 | DOC_PASS | 同一原文授权本次精确 v0.7.0 release 的 schema42 备份、安装、切换与 rollback/forward；不包含历史 apply 或真实生成。 |
| IG26-104 | 生产 schema42 backup | NOT_RUN | 已获本次授权；locked-exact backup+verify+fresh restore receipt 先通过。 |
| IG26-105 | 历史 task apply | NO_GO | 用户对 exact manifest 和生产数据写单独授权。 |
| IG26-106 | 零付费生产门 | NOT_RUN | 已获本次授权；version/live/ready/data/models/capacity/run preflight，Provider/OSS=0。 |
| IG26-107 | schema42 rollback/forward | NOT_RUN | 已获本次授权；上一 schema42 release 可回滚且再次 forward；不把 schema42 交给 schema41 runtime。 |
| IG26-108 | exact 真实 canary | NO_GO | 新授权指定 Canvas/group/models/POST/费用/OSS，一次点击。 |
| IG26-109 | 无人工回收 | NOT_RUN | 普通用户不进入真实 Provider/relay/OSS 管理台，不复制 task id，不手工下载、搬运或重新上传结果。 |
| IG26-110 | 自动技术证据 | NOT_RUN | run/node/task/attempt/result/projection/refresh 全部自动收口。 |
| IG26-111 | 用户主观验收 | USER_RECHECK | 用户在真实页面看结果并明确回复通过。 |
| IG26-112 | 最终关闭 | NO_GO | IG26-001～110 按类别通过，IG26-111 由用户确认后才可 USER_PASS。 |

当前汇总：

- `DOC_PASS 12`
- `AUTO_PASS 87`
- `NOT_RUN 9`
- `NO_GO 3`
- `USER_RECHECK 1`

这是 R0～R8 完成并进入 R9 后的当前汇总。唯一 formal safe full 已消费，原始结果为 `1162/1167`；5 项失败由 m41/m73/m81 最小关闭为 `112/112 PASS`，没有第二次 full。CI、生产 backup/切换/rollback-forward 已获授权但尚未完成，因此保持 `NOT_RUN`；timer 安装、历史 apply、真实 Provider/OSS/canary 与用户验收没有随发布授权自动通过。旧 INC-GEN-025 的测试、Review 或 release 证据没有继承为本次修复通过。
