# INC-GEN-025 服务端权威整组执行最终方案

状态：`HISTORICAL_IMPLEMENTATION_PLAN / RELEASED_V0_6_70 / POST_RELEASE_AUDIT_NO_GO / SUPERSEDED_BY_INC_GEN_026`

日期：2026-09-01

> 2026-09-01 后置最终审计确认本方案的架构方向仍有参考价值，但当前实现存在 admission P0 和 recovery/publication/OSS/UI/backup/CI 缺口。本文件不再是 current implementation authority，也不携带任何未消费授权。当前入口为 `spec/INC_GEN_026_CHECKPOINT.md`。

## 1. 结论

本方案替代继续修补浏览器 checkpoint/lease 的路线。最终方向是：**一次用户点击只创建一个服务端权威 workflow run；服务端持久化冻结语义计划、调度 DAG、复用既有 generation task/Provider attempt/media publication 权威链，并在浏览器关闭、刷新或换设备后继续执行和恢复。**

INC-GEN-024 的 v0.6.70 窄修只证明可安全越过精确的旧 `cancelled / USER_ABANDONED` checkpoint，不能解决浏览器承担调度、可变 Canvas 被反复读取、结果投影与业务成功耦合、Provider 返回后容量不足等系统性根因。因此该候选保留为诊断证据，但结论为 `SUPERSEDED_NO_GO`，不得发布。

用户最初接受本最终审计与文档落地；2026-09-01 最新 `/goal` 已进一步明确授权按本方案实施，并确认目标版本 `v0.6.70`、不可变发布、成对生产迁移/回退，以及所有门通过后的一次指定真实整组点击。该授权不放宽预算、Provider POST、结果不明、受保护文件和 `USER_RECHECK` 边界。

## 2. 用户合同

1. 普通用户只点一次“整组执行”。
2. 用户不需要反复点击重试，也不需要去大模型平台回收结果。
3. Provider 已受理或已返回的原任务由系统自动核对、保存、发布和回填；结果不明时只核对原任务，不创建第二个付费请求。
4. 图片、视频和音频素材都必须由同一条持久化链交付。当前目标组没有独立 Audio 生成节点；音频验收对象是视频文件中的音轨。
5. 刷新页面、关闭浏览器、换设备、服务重启均不得改变本次 run 的语义或重复计费。

## 3. 已查证事实

- 当前生产为 `v0.6.69/schema41`，服务健康；最近一次真实整组点击没有创建新 task/admission/attempt/Provider POST，费用为 0，但也没有产出素材。
- 当前整组执行、DAG 分层、checkpoint 与 lease 主要由浏览器负责；checkpoint/lease 使用 `localStorage` 与 Web Locks，因此不能成为服务端业务真相。
- 当前 generation runtime 已有持久化任务、工作角色协调、启动恢复与 shutdown drain，可复用，不需要新建第二套调度进程。
- 当前数据库 schema 为 41，没有 durable workflow run/node 表。
- generation task、Provider attempt、media asset、publication 已分别有权威记录；workflow 不得复制它们的状态机。
- 当前同步 GPT Image 路径没有可查询的 Provider task id，也没有已验证的 Provider 幂等查询合同；Grok Video 有异步 task id。文字模型的精确可恢复等级必须在实现阶段逐分支查证后登记，不得猜测。
- 已有 Canvas group 语义指纹实现可作为共享语义编译器的基础；通用 Canvas 指纹包含输出/状态字段，不能直接作为 immutable run plan 的语义身份。
- 当前图片、视频、音频的单文件上限分别为 20 MiB、500 MiB、50 MiB；这些只是文件上限，不等同于整组所需容量。容量估算还必须包含 staging、pending publication 与并发占用。
- 当前目标 Canvas 为 `3b3cb4f8-56c3-49f5-ad42-1a00748ba33a`，目标 group 为 `group-fe8ea3c2-981d-4377-80e7-33aef9d38f35`；冻结分母为 11 个可执行节点、24 条组内边，其中 7 个文字、3 个图片、1 个视频。
- 既有事故中，同步图片 Provider 已返回后才发生 `INSUFFICIENT_STORAGE`，由于没有 durable publication/staging，返回字节丢失。释放数百 MiB 只能缓解当时磁盘，不是根治。

以上事实是本方案的输入；任何未在实现时由代码、合同或故障注入证明的分支均保持 `NOT_RUN`。

## 4. 权威边界

### 4.1 Workflow 只拥有编排状态

新增持久化 workflow run/node 只保存：

- run 的生命周期、冻结计划身份、owner/Canvas/group 绑定、停止状态；
- node 的依赖与编排状态、确定性 idempotency key、关联 `task_id`；
- Canvas projection 的独立状态与稳定错误码；
- media 域返回的容量 reservation id。

generation task/Provider attempt 继续决定 Provider 是否受理、是否可核对及是否计费；media asset/publication 继续决定字节是否被安全保存和发布。workflow 不复制 Provider、媒体或 publication 细节状态。

建议的最小 run 状态：`running / stopping / success / failed / cancelled`。

建议的最小 node 状态：`pending / admitted / success / failed / blocked / cancelled`。

实现时若需要短暂 `preparing` 状态，必须证明其原子准入用途，不能扩张为第二套 task 状态机。

### 4.2 节点成功与 Canvas 投影解耦

节点成功的唯一依据是原 generation task 的成功结果和 durable publication。Canvas 回填只是最终一致、可重试的副作用：

- projection 失败不得把成功节点降级；
- projection 失败不得阻塞下游；
- projection 失败不得触发新的 Provider POST；
- 下游直接读取 run/task 的权威结果，而不是等待 Canvas 出现输出字段。

### 4.3 不变语义计划

准入时在同一原子边界内生成 immutable semantic run plan：

- 冻结 executable nodes、依赖边、模型精确 revision、prompt/参数、输入引用与语义指纹；
- 排除输出、运行状态、错误文案、projection 状态等非语义字段；
- 上游占位引用绑定到 `run_node_id`，下游在执行时用权威上游结果解析；
- 当前 run 不再读取可变 Canvas 决定语义；用户后续编辑只影响下一次 run；
- 下游输入由“冻结图 + 权威 task result”临时拼装，再进入共享输入/模型编译器。

不得使用包含 durable result 字段的通用 Canvas fingerprint 作为 run 语义指纹。

## 5. 最小架构

### 5.1 共享语义编译器

从现有客户端工作流代码中提取纯函数到共享 `types/` 边界，浏览器预览和服务端准入共用：

- executable-node 判定；
- DAG 校验与拓扑层；
- semantic fingerprint；
- 冻结输入引用和模型精确 revision。

只共享纯类型和纯编译逻辑。React、localStorage、Web Locks、UI 文案与浏览器恢复代码不得迁到服务端。

### 5.2 内部 generation admission 服务

抽取一个内部 application service，供现有 HTTP 单节点入口和 workflow runner 共同调用。workflow runner 不得通过 HTTP 调用自身，也不得复制 admission、模型合同、输入 preflight、idempotency 或 Provider 准入逻辑。

### 5.3 Durable workflow runner

在现有 runtime role coordinator、generation worker、startup recovery 与 shutdown drain 内增加 workflow runner：

1. 原子认领 runnable node；
2. 解析冻结输入；
3. 通过内部 admission 服务查找或创建唯一 task；
4. 持久化 `task_id` 后等待/核对原 task；
5. publication 成功后标记 node success 并唤醒下游；
6. 独立排队 Canvas projection；
7. 重启后按持久化 run/node/task link 恢复。

首版不引入微服务、消息队列、Redis、Kafka、第二 scheduler 进程或 SSE。浏览器以轮询展示状态。

### 5.4 并发与锁

- 同一 Canvas/group 只允许一个 active run；
- 重叠 node/input lock set 冲突；
- 互不相交的 group 可并行；
- Canvas projection 按 Canvas 串行化，不能把整个 Canvas 变成全局执行锁；
- DB 原子 claim 决定唯一调度者，进程内锁只作为优化，不能成为正确性来源。

## 6. 准入、幂等与计费围栏

每个 run node 使用由 run identity、node identity、semantic fingerprint 与 model revision 派生的确定性 idempotency key。DB 原子准入必须满足：

1. 相同 key 只能关联一个 generation task；
2. 崩溃恢复先按 key 查原 task，不得再次创建；
3. 所有真实 outbound Provider POST 都计入围栏，不以“create POST”文字偷换统计口径；
4. 产品代码不做 Provider POST 自动重试；状态查询和结果核对只能针对原任务；
5. `OUTCOME_UNKNOWN_BILLING_RISK` 保持硬停止，只核对原 task/attempt；
6. 用户停止时，未提交的未来节点停止，已受理原任务继续核对、保存和投影。

CNY 300 只属于这一次真实验收的外部预算门，不建设产品级人民币预算子系统。当前目标真实验收上限仍是总 outbound Provider POST 不超过 11；任何代码验证阶段均不得消费该预算。

## 7. 存储与媒体容量

容量管理由 media 域拥有，workflow 只依赖端口：

- `estimatePlannedCapacity(plan)`：按媒体类型、staging、pending publication、并发峰值给出保守估算；
- `reservePlannedCapacity(owner, bytes)`：持久化预留并返回 reservation id；
- `recheckBeforeProviderPost(reservationId, node)`：每次可能付费 POST 前再次核对；
- publication/cleanup 完成后由 media 域释放预留。

整组准入先做全 run 预留；每个 Provider POST 前再做一次硬门。失败必须发生在付费 POST 之前。workflow 不得硬编码 20/50/500 MiB，也不得用“当前空闲磁盘很多”代替容量合同。

同步 Provider 返回的字节必须先进入受保护的 durable staging/publication 链，确认可恢复后才允许 task 完成。保存故障继续恢复相同字节，不能发第二次 Provider POST。

## 8. Provider 可恢复等级

实现阶段必须逐个目标模型/adapter 建立证据表：

- `QUERYABLE_TASK_ID`：Provider 返回持久 task id，可轮询原任务；
- `VERIFIED_IDEMPOTENCY`：Provider 明确支持且项目已验证相同 key 查询/收敛；
- `DURABLE_RELAY`：付费 POST 前已有项目控制的 durable relay/outbox，能证明是否发送；
- `SYNC_RESPONSE_ONLY`：没有远端 task id/可查幂等；只能依赖 POST 前容量预留和返回字节即时 durable staging。

强保证 workflow 只允许满足本工作流恢复合同的模型。该资格门只限制整组 workflow，不得无依据全局关闭普通单节点生成。

不为消除极小的同步 POST 崩溃窗口而重写全部 Provider transport。若某模型不能满足强保证，必须明确判为 workflow 不可用，或另立方案引入已证明的 relay；不得用重试掩盖。

## 9. 浏览器职责

浏览器只负责：

- 发送一次创建 run 请求；
- 保存并展示服务端 `run_id`；
- 轮询 run/node/task/projection 摘要；
- 展示“运行中、正在保存、投影待恢复、失败且不会重复扣费”等稳定文案；
- 允许停止未来未提交节点。

浏览器 localStorage 可以缓存 `run_id`，但不是真相。刷新、换设备或缓存丢失后都从服务端恢复。旧 client checkpoint/lease 只作为迁移桥读取，不能再阻止新服务端 run，也不能调度 Provider。

## 10. 迁移、兼容与回滚

1. schema 迁移新增 workflow run/node 与必要索引，必须在冻结生产副本演练，验证 integrity/FK/业务计数。
2. 新 runtime 可读取旧 Canvas/checkpoint 并引导到服务端 run；旧 runtime 不得读取新 schema。
3. 发布采用 bridge：先关闭新 workflow admissions，再 drain/保留已受理 run；已受理 task、publication、projection 继续核对。
4. rollback 只能回到与数据库 schema 兼容的 runtime+DB pair，禁止旧 runtime 直接读取已迁移数据库。
5. 不删除 INC-GEN-024 候选、旧 checkpoint、历史 task、publication、release 或 rollback 证据。

## 11. 故障语义

| 故障点 | 期望结果 | 禁止行为 |
|---|---|---|
| 创建 run 前容量不足 | 准入失败，0 Provider POST | 先 POST 后报磁盘不足 |
| node claim 后进程崩溃 | 重启按 key 找回同一 task | 创建第二 task/POST |
| Provider 已受理、状态不明 | 只核对原 task/attempt | 自动重试 POST |
| Provider 同步返回、publication 暂时失败 | 保留同一字节并后台续传 | 丢字节或重发 Provider |
| Canvas projection 409/断网 | node 保持 success，projection 重试 | 阻塞下游或降级成功 |
| 用户运行中编辑 Canvas | 当前 run 使用冻结计划 | 中途改变模型/prompt/边 |
| 用户关闭浏览器 | 服务端继续执行 | 浏览器关闭即放弃 run |
| 用户停止 | 停止未来未提交节点；原已受理任务继续收口 | 取消远端结果后再重发 |

## 12. 实施阶段与门

### R0：施工身份与证据冻结

- 从最新 `origin/main` 建立新的干净实现工作树；不得在 INC-GEN-024 脏候选上直接施工。
- 记录 Git、版本、schema、测试库存、生产只读基线及目标 11 节点/24 边分母。
- 受保护文件 `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json` 禁止读取、修改、暂存、移动或删除。

### R1：共享语义编译器与内部 admission

- 先用 characterization tests 冻结现有 11 节点语义。
- 提取纯共享 compiler；抽取 HTTP/runner 共用 application service。
- 不改变 Provider 或媒体行为。

### R2：schema 与 workflow store

- 落地最小 run/node schema、原子 claim、same-group/lock-set 冲突和确定性 key。
- 故障注入证明 crash/restart 仍只关联同一 task。

### R3：runner、恢复与 projection

- 接入现有 runtime lease/startup/drain。
- 下游从冻结计划和权威结果解析。
- projection 独立重试且不阻塞 DAG。

### R4：media reservation、Provider 资格与客户端切换

- media 域实现容量估算/预留/释放。
- 逐 adapter 查证恢复等级并只为 workflow 建资格门。
- 客户端切换为一次 create + 服务端轮询；旧 checkpoint 进入兼容桥。

### R5：风险驱动验证

- 静态/类型门；共享 compiler 与 admission 直接依赖；schema/store/runner；三媒体 staging/publication；Provider adapter；浏览器刷新/换设备。
- 故障注入覆盖第 11 节全部故障点。
- 只有共享合同或 release gate 的实际传播证据成立时才扩到正式 full suite；失败先跑最小子集，禁止用反复全量测试换取安心。

### R6：冻结候选完整 Review

- 实现冻结后再做一次独立 Review。
- 分母：全部 changed files/diff hunks、共享 compiler/admission、workflow store/runner、generation task/Provider adapter、media publication/reservation、Canvas projection、客户端入口，以及目标 workflow 使用的全部模型分支。
- 只报告直接风险、耦合、状态复制、幂等、费用、数据和回滚问题；不因“要审计”扩成无关重构。
- 凡属于本次变更或受影响完整调用链的发现，不论P0/P1/P2都必须修复、定向复验并由同一Reviewer复审为0；无关历史问题不借题扩项，除非会破坏本次合同或上线安全。

### R7：版本与发布准备

- 只有 R0-R6 全部通过后才提议版本。
- 用户需分别确认版本与允许发布；授权前不得 commit/push/PR/tag/Release、生产迁移或切换。

### R8：生产零付费门与唯一真实验收

- 发布后先做服务、schema、数据、模型资格、容量 reservation 与目标计划的零付费 preflight。
- 只有用户另行明确授权真实点击和预算后，才允许在指定 Canvas/group 点击一次。
- 上限 CNY 300 等值、所有 Provider POST 合计最多 11、不重试；结果不明只核对原任务。
- 图片 3 项逐一检查可见与持久化；视频检查可播放；用 `ffprobe` 证明视频包含音频流；刷新/换设备后结果仍在。
- 技术证据只能写 `AUTO_PASS`；用户观看和主观质量确认前保持 `USER_RECHECK`。

## 13. NO-GO 条件

任一项成立即不得发布或真实点击：

- 浏览器仍是 DAG/重试/计费正确性的唯一调度者；
- 当前 run 仍会读取可变 Canvas 改变语义；
- Canvas projection 失败会阻塞下游或触发 Provider；
- workflow 复制 generation/provider/media 状态机；
- runner 通过 HTTP 调自己或复制 admission；
- 容量在 Provider POST 后才检查，或没有 durable reservation；
- 同一 node 在 crash/restart 后可能创建第二 task/Provider POST；
- 目标任一模型恢复等级未查证却被声明“不会重复消费”；
- schema bridge、drain、rollback pair 未演练；
- Review 分母不完整，或范围内任一P0/P1/P2发现未关闭；
- 没有新的版本授权、发布授权或真实验收授权。

## 14. 明确非目标

- 不建设微服务、消息队列、Redis/Kafka、SSE 或第二调度集群。
- 不建设产品级 CNY 预算系统。
- 不全局重写 Provider transport。
- 不把所有单节点模型都因 workflow 资格不足而禁用。
- 不借本事件清理历史 release/backup/checkpoint/task 或做无关架构重构。
- 不把自动测试、生产技术门或截图冒充用户主观验收。
