# Unboundry Canvas 文档写入边界解耦详细行动方案

状态：`DOCUMENT_GO / V0_7_9_DEPLOYED_SCHEMA43 / RELEASE_AND_REAL_PROVIDER_AUTHORIZED / R9_PASS / R10_REFRESH_NO_GO`

日期：2026-09-03

配套验收矩阵：`spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_ACCEPTANCE_MATRIX_2026-09-03.md`

## 0. 一句话结论

### 最新执行证据（2026-09-05）

正式full后7/7文件文档增量已获同一独立Reviewer P0/P1/P2=0/DOCUMENT_GO，产品/测试变化0；维护方案revision4也获设计GO（实际执行仍须精确命令、最新freeze与备份门）。以下待审文字是本回填之前的历史时点。进入0710 GitHub发布流程，不重复业务full。

v0.7.10读取截止/迟到缓存/精确final版本登记已完成；定向208项通过。冻结独立Review为158/158files、1969/1969hunks、256writers、194CWB、10models/12identities/6adapters，P0/P1/P2=0、遗漏0。唯一正式full已取得127specs、1239/1239PASS、exit0、failed/skipped/retries/blocked/reportErrors0，source/snapshot=`676ea9bc69eb4051a64b7abe32235c5cbd38f1ae9481370964a53ac5ece6e37b`且不变。当前仅作文档增量复核，不重复业务full；0710尚未发布。

恢复证据已从只读probe补成三份独立fresh restore上的真实进程079/43→077/42→079/43 PASS，仍不等于live rollback。真实service维护方案必须在停止writer后证明媒体删除/上传清理/projection/legacy sweep潜在写候选0，旧077只运行在隔离新42副本；前进及失败回退都保留当前live43，绝不恢复旧快照覆盖新写。操作方案和精确runbook在独立有界复核，未执行。生产079刷新仍NO_GO、group点击0；后续cold/warm、唯一group、audio/三上传/下游与最终生产复核均不因本地通过而豁免。以下“待冻结/full”的文字为本补证之前的历史设计与执行时点。

### R10 暖刷新失败修复补充（2026-09-05，待候选验证）

版本化必要补充（独立设计复核P0/P1/P2=0/DOCUMENT_GO，已按方案实施、待定向验证）：package更新0.7.10后，safe m38在产品spec之前的重启验证因`UNBOUNDRY_RELEASE_VERSION_INVALID`退出1。`server/bridgeRuntimeMode.ts`精确白名单只到0.7.9；因此上述两模块范围之外仅补登记0.7.10为final，并在既有m81用例验证精确版本、角色冲突及未登记/带后缀版本仍拒绝。不改schema或bridge选择，不改为宽泛semver放行。验证最小集合为m81与未执行到的m38；正式full仍待最终冻结。该故障发生于本地隔离启动，未部署候选。

本地实施状态：本补充独立文档Review为P0/P1/P2=0/DOCUMENT_GO；已实施两个读取模块，safe m3 14/14、m86最终87/87。见`spec/V0_7_10_LOCAL_IMPLEMENTATION_RECEIPT_2026-09-05.json`；新候选冻结、formal full、回滚/生产门仍未完成。

- 实证：v0.7.9暖刷新GET约3秒被客户端取消，约6秒后服务器返回200；同样的3秒截止已存在于v0.7.7，不宣称版本回归或服务器延迟根因已确定。
- 将Canvas读取统一为30秒有界deadline，覆盖初始hydrate、generation admission权威读取、workflow结果refresh和external baseline；deadline必须覆盖headers与body，即使transport忽略abort也结束调用并拒绝迟到结果。取消的读取不得污染transport的authoritative cache。
- 保持保存6秒、命令/receipt、Provider计费边界、草稿/journal恢复及DATA-005语义不变；不增加GET重试或任何写入。只修改两个现有Canvas读取模块和直接相关测试，不扩展数据库性能重构。
- 定向证明6秒有效响应可读、30秒挂起与迟到body失败关闭、四调用点使用同一读合同、保存6秒不变；新代码须重新冻结、独立复核、正式full和下一未占用普通patch发布，不能复用旧候选证据当新代码PASS。
- 生产schema43已存在新写，按schema附件保留全部数据，不直接覆盖为旧schema42。回滚方案及完整进程rollback-forward证据仍须补齐；本补充不授权伪降级或跳过回滚门。重新部署后必须重做完整cold/warm三方证据，再执行唯一真实点击。

必须先完成 Canvas 应用层与持久化边界的有限解耦，再考虑下一次发布；不得继续用单点 hotfix 逐个压制图片、视频、音频或恢复副作用。

本方案不是微服务化、不是 React Flow 重写、不是 Provider/Task 账本重写。目标是把以下四类动作从同一个裸 `setNodes/setEdges -> fingerprint -> PUT` 通道中分开：

1. 用户明确编辑；
2. 服务端生成结果与恢复证明；
3. 页面渲染、媒体加载和交互视图状态；
4. 旧文档兼容迁移。

最终必须建立可执行的不变量：**干净 Canvas 的渲染、hydration、图片 `onLoad`、视频 `loadedmetadata`、音频解码、选中、测量、呼吸灯和任务轮询都不能改变 Durable Canvas Document，也不能触发 Canvas PUT。**

## 1. 本文权限与边界

### 1.1 当前授权

- 本节最初记录的是文档阶段边界；2026-09-04 用户通过当前 `/goal` 明确取代该旧边界。
- 当前已授权 R0-R10；首个 `v0.7.8` 已发布但未部署，生产 preflight 发现确定性 migration bug 后按 Goal 自动转入下一普通 patch `v0.7.9`，继续覆盖产品/测试/文档/schema43 migration、GitHub 发布、locked-exact backup/restore、生产部署与回滚、普通 Chrome、真实 Provider/OSS 和费用。
- 权限不改变阶段顺序：冻结候选、独立全量 Review `P0/P1/P2=0` 与唯一 formal full 仍是发布前硬门。
- 生产仅可操作本 Goal 新建的验收对象；指定既有 Canvas/group 先只读核对，且必须先通过冷/暖刷新零写门。

### 1.2 仍然不允许

- 清理历史任务、画布、媒体、备份或旧 release；
- 覆盖/删除任何既有用户 Canvas、媒体、任务、账单证据和历史数据；
- 在刷新零写门通过前点击真实目标 group；
- 对 accepted、response-received 或 outcome-unknown 的 Provider operation 重复 POST；
- 覆盖已存在 tag、Release 或 release 目录；
- 把本方案的 `DOCUMENT_GO` 写成实现通过、发布通过或用户通过。

### 1.3 明确不做

- 不引入微服务、消息队列、Redis、Kafka或第二套 scheduler；
- 不替换 React Flow；
- 不重写已稳定的 Generation Task、Provider boundary、publication 和 billing fence；
- 不把服务端生成结果改成浏览器可信写入；
- 不删除 `runId + taskId + ownershipKey + nodeId + kind`、revision、load token、save session、attempt 或 publication 原子性；
- 不为“看起来更解耦”重构 Auth、Admin、Template、模型目录等无关模块；
- 不以重复执行全量测试代替风险定向证据。

## 2. 当前基线与已确认事实

### 2.1 代码与生产身份

- 当前审计工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；
- 当前实施分支：`codex/v0.7.8-canvas-write-boundary`；
- 当前 HEAD：`a401016607f1b01b2c266caa786d61734d64b545`；
- 当前 origin：`https://github.com/jasionia1991-max/unboundry.git`；
- 当前产品代码树与 exact `v0.7.7` 产品代码一致；
- 生产：`v0.7.7/schema42`；
- 当前 Goal 已授权目标 `v0.7.8`（冲突时使用下一个空闲普通 patch）、修复、GitHub/发布、生产部署、普通 Chrome、真实 Provider/OSS 与费用；实际发布和真实点击仍必须在 R9 通过后按 R10 固定顺序执行。

任何未来施工开始前都必须重新核对这些身份，不能把本段当成永远有效的事实。

### 2.2 生产失败事实

目标 Canvas `adcb89a5-c1f4-47e4-bbbb-28fff8d81583`、目标 group `group-17ee0cbc-cc81-4b35-9c5e-41040f627033`。该 Canvas 的干净服务器版本页在约 1.4 秒内产生 4 次成功但多余的 Canvas PUT：

- Canvas revision：`71 -> 75`；
- graph revision：`46 -> 50`；
- 只修改 3 个图片节点的 `style.height`；
- 内容、连线、viewport 未变；
- 409 为 0；
- workflow create、generation task、admission、Provider attempt 和 paid Provider request 均为 0；
- 因刷新硬门失败，真实 group 点击保持 0。

因此当前状态只能是：`V0_7_7_RELEASE_PASS / REFRESH_GATE_NO_GO / REAL_WORKFLOW_NOT_RUN`。

### 2.3 当前直接根因

`ImageNode` 的即时图片加载与 deferred hydration 路径只检查运行时 `node.width/node.height`，没有把已经持久化的 `node.style.width/node.style.height` 视为已确定布局。图片像素就绪后又调用 `setNodes` 改写 durable `style`，而 `style` 进入 Canvas fingerprint，所以触发真实保存。

这段自动适配逻辑早于 v0.7.7 存在；v0.7.7 清除 7 个文字恢复写入后，严格刷新门暴露了这条独立路径。这个事实不能被用作继续单点修补的理由；它证明原验收覆盖没有封住“被动渲染导致持久化”这一缺陷类别。

### 2.4 审计覆盖分母

- 只读探索已覆盖 Canvas load/save/pagehide/CAS、四媒体节点、Group/Playlist、上传、图片工具、单节点生成、整组生成、workflow result projection、legacy recovery、Generation Task、Provider boundary、结果提交和相关测试；
- 探索阶段没有冻结统一的 glob、排除规则和源码 hash，因此历史搜索命中数全部只作定位线索，不作为验收分母，也不在本方案中混写成正式数字；
- R0 在当时冻结 HEAD 上用可复现命令生成 `spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_WRITER_MANIFEST_2026-09-03.json`，其中的 client/server/test 分类计数才是唯一正式分母；
- manifest 必须记录扫描命令、glob、排除规则、源码 hash、每条命中、去重依据和逐条归属；在它产生前，相应验收项保持 `NOT_RUN`。

这里的“全量”指对本缺陷相关的写入面、调用入口和测试面做完整扫描与分类，不冒充逐行审计所有无关业务模块。

## 3. 为什么会连续出现“修一个又冒一个”

当前不是一条根因反复复发，而是不同边界依次挡住真实流程：

1. 动态输入角色、准入耗时和 CI `ffprobe` 环境；
2. 浏览器 Canvas submit lock 阻止 workflow POST 到达服务端；
3. 慢 Provider 结果被过早终态化；
4. 服务端结果投影后，旧浏览器恢复与 autosave 竞争；
5. 干净刷新时，ImageNode 媒体加载又改写 durable layout。

以前的 Review 主要覆盖“当次改动文件和 diff hunks”，而不是把所有既有 Canvas writer 当成一个完整系统验收；测试 fixture 也没有同时具备生产 Canvas 的多媒体、已保存自定义尺寸、旧恢复字段和真实浏览器事件时序。

流程错误是：在“生产形状、干净刷新零写”被证明之前就进入了发布。后续必须把生产形状回放前移为本地发布硬门。

## 4. 不能破坏的安全核心

以下边界不是坏耦合，重构时必须保留：

1. 一个 logical node 的一个 execution intent 最多一个 outbound Provider create/submit boundary；
2. Provider 请求前，服务端原子记录唯一 task attempt、Provider boundary、凭据 revision 和准入证明；
3. Provider HTTP 在数据库事务外执行，不能伪称跨系统原子事务；
4. 响应不明且没有可查询远端 task id 时进入 `OUTCOME_UNKNOWN_BILLING_RISK`，禁止第二次 POST；
5. 有远端 task id 时只 inspect/resume 原 task；
6. publication pending 只续传原始 staged 结果，不重新生成；
7. task success 只能建立在 durable text 或 committed media asset 上；
8. Canvas projection 失败不能把已成功 task 降级，也不能触发新 Provider 请求；
9. 结果写入继续校验 `runId + taskId + ownershipKey + nodeId + kind + inputFingerprint + resultKey`；
10. 节点和边的拓扑修改必须原子提交，不能拆成无约束字段 patch；
11. Canvas revision、load token、save session high-water、workflow lock 和 tombstone 继续 fail-closed；
12. 自动证据、生产技术证据、`USER_RECHECK` 与 `USER_PASS` 继续分开。

## 5. 目标状态模型

### 5.1 Durable User Document

由用户意图拥有，允许持久化：

- 节点 id/type、parent/extent、节点和边拓扑；
- 标题、prompt、model、parameters；
- 用户手工文本或对生成结果的明确编辑；
- storyboard、playlist clips、group color；
- 用户确认的 position、width/height/style；
- 用户上传后经服务端确认的 asset 引用；
- viewport（作为用户工作区偏好保存，但不属于生成输入 revision）。

任何用户编辑如果改变生成语义，必须由服务端原子清除或失效化与旧输入绑定的 success proof，防止旧结果继续冒充当前输入。

### 5.2 Durable Server Projection

由服务端权威拥有，允许持久化：

- generation task id、attempt/result 绑定；
- ownership key、input/contract/model revision；
- `groupRunSuccess*` 结果证明；
- 生成后的 text/media 结果；
- 已验证的媒体 asset、content type、byte size、duration、width/height、storage backend；
- terminal error/retry/projection 证明，在兼容期内需要保留的恢复字段。

浏览器不得伪造或覆盖这些字段。普通全量保存携带的同值字段只作兼容读取；不同值必须由服务端保留当前权威值或拒绝。

### 5.3 Ephemeral View State

只存在浏览器运行时，永不进入 Canvas PUT：

- selected、dragging、measured、resizing；
- hover、menu、fullscreen、播放器播放位置和播放状态；
- React Flow 被动 measurement；
- 图片/视频自然尺寸的临时显示值；
- 缺少 durable waveform 时的本地 waveform 展示缓存；
- preparing、server-running、server-stopping、呼吸灯和加载动画；
- poll timer、AbortController、临时错误提示和请求 in-flight 状态；
- playlist picking 模式。

### 5.4 Migration State

只用于读取旧文档并安全收口：

- 旧 `*Generating`、`workflowExecutionRunId`、standalone recovery binding；
- 缺失的旧媒体 metadata；
- 旧浏览器 group projection/detach；
- 历史 task/result 与 Canvas proof 不完整但可精确核对的状态。

Migration 必须有明确 `migrationId/applicationId`、适用版本、一次性/幂等证明和退休条件。不得在组件 mount effect 中静默迁移。

## 6. 字段所有权与 revision 规则

| 变化 | 所有者 | Durable | documentRevision | inputGraphRevision | 允许入口 |
|---|---|---:|---:|---:|---|
| selected/dragging/measured/resizing | View | 否 | 不变 | 不变 | `applyViewPatch` |
| hover/menu/fullscreen/playback/breathing | View | 否 | 不变 | 不变 | `applyViewPatch` |
| 图片/视频自然尺寸仅用于显示 | View | 否 | 不变 | 不变 | `applyViewPatch` |
| 标题、颜色、位置、用户尺寸、viewport | User | 是 | +1 | 不变 | user command |
| prompt/model/parameters | User | 是 | +1 | +1 | user command |
| node/edge/group 拓扑 | User | 是 | +1 | +1 | atomic graph command |
| 用户上传 asset 引用/inputState | User + Server validation | 是 | +1 | +1 | adopt-uploaded-asset |
| 用户编辑生成后的 content/result | User | 是 | +1 | +1 | edit-result-and-invalidate-proof |
| task/attempt/ownership/input key | Server | 是（兼容期） | +1 | 不变 | server generation command |
| server generation result/proof | Server | 是 | +1 | 不变 | server projection command |
| terminal detach/旧运行字段清理 | Server migration | 是 | +1 | 不变 | server legacy command |
| 相同目标状态重复提交 | 任意合法 owner | 否 | 不变 | 不变 | `already-applied` |

逻辑名称：

- 现有 `revision` 在 wire/DB 兼容期继续保留，代码语义固定为 `documentRevision`；
- 现有 `graphRevision`/`graph_revision` 在兼容期继续保留，代码语义固定为 `inputGraphRevision`，即“会让当前执行定义失效的用户输入/拓扑版本”，而不是所有 node.data 变化次数。

是否物理改列名或升级 schema 不在此处先猜。第一阶段按 schema42 复用现有列；只有第 14 节的 schema 决策门证明现有表示不足时才停止并另立迁移方案。

### 6.1 `canvasDocumentFingerprint` 与完整 no-op 规范

R1 必须新增服务端权威纯函数 `canvasDocumentFingerprint(document)` 和等价判断 `durableDocumentEquals(before, after)`。它回答的唯一问题是“完整 Durable Canvas Document 是否真的改变”，不能用 input fingerprint、React state 对象 identity 或序列化插入顺序代替。

规范性投影如下：

- 纳入全部已登记的 Durable User、Durable Server 与仍需持久化的 Migration 字段，包括 nodes、edges、viewport、用户布局/内容/参数/asset 引用、服务端 task/result/proof、权威媒体 metadata 和兼容恢复字段；
- 排除全部 Ephemeral View 字段，以及 revision、graph revision、updated_at、load token、save session/sequence、requestId、operation receipt 和 fingerprint 自身等传输/并发/审计包络；
- 每个持久字段都由同一字段 descriptor 声明 `owner`、`durability`、`documentImpact`、`inputImpact` 与 canonicalizer；未登记字段在读取时原样保留，但任何创建/修改/迁移 command 遇到它都 fail-closed，不能猜测是否 no-op；
- canonicalization 使用字段白名单投影、对象 key 递归排序、业务有序数组保序、无序集合按稳定 tuple 排序、缺省值规范化、有限数值校验、UTF-8 原值和稳定 JSON，最终取 SHA-256；服务端结果是 revision 决策权威，客户端实现只用于预览并必须共享 golden vectors；
- `durableDocumentEquals` 只比较两份已验证文档的 canonical durable projection；服务端先完成字段/ownership/拓扑校验，再分别计算 before/after document hash 与 input hash。

两类 hash 的 revision 状态机固定为：

| before/after document hash | before/after input hash | 结论 |
|---|---|---|
| 相同 | 相同 | `NO_OP`；Canvas row、updated_at、两个 revision 均不变，只可同事务写 receipt/high-water。 |
| 不同 | 相同 | 仅 `documentRevision +1`；适用于 layout、viewport、server projection、terminal detach、durable metadata。 |
| 不同 | 不同 | `documentRevision +1` 且 `inputGraphRevision +1`；适用于 prompt/model/参数/input asset/拓扑等。 |
| 相同 | 不同 | 合同错误并 fail-closed；input projection 必须是 durable document projection 的受控子集。 |

Golden vectors 至少覆盖：完全 no-op、layout-only、viewport-only、server-projection-only、terminal-detach-only、prompt/input-only、topology-only，以及同语义但对象 key/集合顺序不同。任何命令即使类型上“通常会变化”，最终也必须以实际两类 before/after hash 决定 revision。

### 6.2 `canvasInputGraphFingerprint` 规范

不能继续复用当前“排除少量 React Flow 字段、其余全算输入”的宽泛 fingerprint。R1 必须新增唯一纯函数 `canvasInputGraphFingerprint(document)`；服务端是权威实现，客户端同名实现只能用于预览，并由共享 golden vectors 校验完全一致。

规范性输入如下：

| 字段族 | 是否进入 input fingerprint | 规则 |
|---|---:|---|
| node `id/type` | 是 | 按 node id 稳定排序；类型变化一定改变输入。 |
| edge `id/source/target/sourceHandle/targetHandle` | 是 | 按稳定 tuple 排序；拒绝悬空、重复或未知 handle。 |
| parent/group/member/order/extent | 是 | 只纳入会改变 DAG 或组执行定义的结构字段。 |
| prompt/model/parameters/seed/ratio 等生成参数 | 是 | 先按字段 descriptor 做类型与默认值 canonicalization。 |
| 输入 asset identity | 是 | 只用不可变 `assetId/contentDigest/inputState`，不使用临时 URL 或展示 metadata。 |
| playlist clips/order/trim | 条件是 | 仅当它们进入生成/导出执行定义；由字段 descriptor 明确，不靠字段名猜。 |
| 用户手工输入或用户确认替换的上游内容 | 是 | 只有确实作为下游输入的 durable user content 才纳入。 |
| server 生成结果正文/媒体 URL | 否 | 结果身份由 task/result proof 管理；不得因 server projection 使当前 plan 自失效。 |
| task/run/attempt/ownership/result/proof/error/status | 否 | 全部是 ServerRun/Projection 事实。 |
| position/width/height/style/viewport/color/label | 否 | 布局和显示偏好不改变生成输入；若某 model 参数目前藏在 style，必须先迁出并登记。 |
| media width/height/duration/waveform/contentType/byteSize | 否 | 服务端 metadata 与浏览器 intrinsic metadata 都不改变执行定义。 |
| selected/dragging/measured/resizing/hover/menu/playback/breathing | 否 | 全部 Ephemeral。 |
| timestamps、load token、save session/sequence、operation receipt | 否 | 只用于并发、审计或传输。 |
| 未登记字段 | 禁止决定 | 读取时原样保留；创建 command 或编译 workflow 时 fail-closed，先补 descriptor。 |

Canonicalization 固定为：字段白名单投影、对象 key 递归排序、数组按业务语义排序（有序数组保持顺序，无序集合按稳定 tuple 排序）、缺省值规范化、数值有限性校验、UTF-8 字符串原值、最终稳定 JSON 后 SHA-256。不得纳入对象插入顺序、React mount 顺序或当前时间。

`ProbeNode` 每一个持久字段必须在 descriptor 中登记：`owner`、`durability`、`inputImpact`、`canonicalizer`、允许 command、legacy alias。R1 的 AST/类型门必须证明没有未登记的新字段。

### 6.3 旧 `graph_revision` 的兼容映射

- schema42 的物理列名 `graph_revision` 暂不改名，运行时语义从切换点起固定为 `inputGraphRevision`；
- 现有数值作为单调基线保留，不回算、不降低、不批量改写历史 Canvas；
- 切换后的 user command 只有在第 6.2 节 input fingerprint 实际变化时才 `+1`；
- server projection、terminal detach、媒体 metadata、布局和 view event 一律不增加；
- 切换前已存在 task 的 saved input fingerprint、task/run/node/ownership proof 仍是恢复权威；不得只因旧 graph revision 曾被 server-only 写入而重新 admission 或重发 Provider；
- compatibility PUT 也必须由服务端计算 before/after `canvasInputGraphFingerprint`，浏览器不能声明 graph 是否变化；
- golden vectors 必须覆盖旧 Canvas、四媒体、group/playlist、server projection、terminal detach 和未知 legacy 字段。

### 6.4 DATA-005 并发语义

本方案不得把 Canvas 改成跨标签页全局 CAS。现有 P0 合同继续成立：

1. 同一 `saveSessionId` 内，`saveSequence` 迟到或重复的旧写仍以 `CANVAS_SAVE_SUPERSEDED` 拒绝；
2. 不同 session/tab 的合法用户命令不因 base document revision 过期而自动拒绝；服务端在事务内把 typed command 重放到最新权威 document；
3. 不同 tab 修改不同 user-owned 字段时两者都保留；修改同一 user-owned 字段时，最后成功提交的 command 生效并广播同步；
4. server-owned 字段、workflow lock、tombstone、media ownership 和拓扑前置条件不服从 last-writer-wins，冲突时 fail-closed；
5. `baseDocumentRevision/baseInputGraphRevision` 是重放、诊断和精确前置条件输入，不得被实现成“一过期就全局 409”；
6. 旧 full-document PUT 在兼容期继续维持 DATA-005 的跨 session last-successful-save-wins；服务端必须保留权威 server-owned 字段、同 session high-water 和 load-token 证明。它不能冒充新 typed command 的字段级 rebase，必须通过指标和观察窗尽快退休。

## 7. 目标写入架构

```text
User event
  -> CanvasDocumentCommandPort
  -> client command journal
  -> Canvas mutation HTTP endpoint
  -> server CanvasMutationGateway
  -> ownership + topology + DATA-005/session fence + no-op + revision
  -> canvas_documents

Provider/task success
  -> GenerationResultCommit (task/publication authority)
  -> server-only CanvasMutationGateway.applyGenerationProjectionInTransaction
  -> canvas_documents + workflow_run_nodes.projection_state in one DB transaction

Render/media event
  -> CanvasViewState
  -> rendered ReactFlow nodes
  -> never enters persistence journal or HTTP

Legacy task
  -> server census/reconciliation
  -> server-only CanvasMutationGateway.detachLegacyTerminalInTransaction
  -> never trusts browser terminal/result claims
```

“统一 gateway”指统一规则和事务内 domain entry，不等于把服务端结果绕到浏览器，也不等于所有操作都变成任意字段 patch。

## 8. Typed command 合同

### 8.1 客户端可提交的公开命令

建议新增共享类型 `types/canvasCommands.ts`：

```ts
type CanvasUserCommand =
  | CreateCanvasDocumentCommand
  | ApplyUserFieldChangesCommand
  | ApplyTopologyCommand
  | CommitUserLayoutCommand
  | AdoptUploadedAssetCommand
  | EditResultAndInvalidateProofCommand;

type CanvasCommandBase = {
  operationId: string;
  saveSessionId: string;
  saveSequence: number;
};

type ExistingCanvasCommandBase = CanvasCommandBase & {
  baseDocumentRevision: number;
  baseInputGraphRevision: number;
  observedLoadToken: string;
};

type CreateCanvasDocumentCommand = CanvasCommandBase & {
  kind: "create-canvas-document";
  baseDocumentRevision: null;
  baseInputGraphRevision: null;
  observedLoadToken: null;
  initialDocument: InitialUserOwnedCanvasDocument;
};

type UserFieldChange = {
  nodeId: string;
  field: UserOwnedFieldPath;
  action: "set" | "delete";
  baseValueDigest: string;
  value?: UserOwnedFieldValue;
};

type ApplyUserFieldChangesCommand = ExistingCanvasCommandBase & {
  kind: "apply-user-field-changes";
  changes: UserFieldChange[];
};

type ApplyTopologyCommand = ExistingCanvasCommandBase & {
  kind: "apply-topology";
  topologyOperation:
    | CreateNodeOperation
    | DeleteSubgraphOperation
    | ConnectEdgeOperation
    | DisconnectEdgeOperation
    | GroupMembersOperation
    | UngroupOperation
    | PasteSubgraphOperation
    | ReplacePlaylistOrderOperation;
  affectedTopologyDigest: string;
};
```

安全规则：

- `actor/ownerId` 由认证上下文赋值，不能信任客户端字段；
- `intent` 必须是枚举，不接受任意字符串；
- 全文只使用 `operationId` 表示新 command 的 durable 幂等身份；不再混用 `commandId`；
- `operationId` 在 `(ownerId, canvasId)` 范围唯一并跨进程/重启可核对；
- `saveSessionId + saveSequence` 只负责同一标签页顺序；旧 `saveAttemptId` 只是 legacy transport correlation，不得冒充 durable `operationId`；
- patch 必须使用字段 allowlist，禁止 `Record<string, unknown>` 任意改 data；
- 现代客户端不得发送整图 replacement；`ApplyUserFieldChanges` 显式列出 touched field，`action=delete` 与“未携带”完全不同；
- `baseValueDigest` 用于审计和发现类型/ownership 漂移，不把跨 tab user-owned stale 变成全局 CAS；同字段由最后成功 command 生效；
- `ApplyTopology` 必须原子校验受影响 nodes + edges + parent/group/playlist；每个 operation 显式列出新增、删除、级联和前置条件；
- `CreateCanvasDocument` 的 `baseDocumentRevision/baseInputGraphRevision/observedLoadToken` 必须显式为 `null`，`initialDocument` 只允许 User-owned 初始 nodes/edges/viewport，不能携带 server-owned 字段；
- create 在认证/owner/tombstone 校验后先按 `(ownerId, path canvasId, operationId)` 查 receipt：同 payload replay 返回原 outcome；无 row 时与 receipt 原子创建并把两个 revision 初始化为 1；已有 row 且不是该 operation replay 时写稳定 `REJECTED_CONFLICT(CANVAS_ALREADY_EXISTS)` receipt 并返回 409；并发 create 只能一项 applied，其余各自稳定冲突；
- server-owned 字段必须与当前权威值相等，否则保留服务器值或返回稳定冲突；
- 无实际 durable 变化返回 `already-applied`，不增加 revision；
- 相同 command 丢响应后只能用相同 operationId 和完全相同 canonical payload 重试或只读核对。

字段命令在最新 document 上的合并算法固定为：

1. 按 allowlist 验证每个 `field` 归属 User；
2. 未列入 `changes[]` 的所有字段原样保留，包括另一 tab 新写入的 user 字段与全部 server-owned 字段；
3. `set` 只替换列明路径，`delete` 只删除列明路径；禁止用缺失 key 猜删除；
4. 当前同一 user-owned 路径已被另一 session 修改时，本次合法 command 作为最后成功写生效，并记录 overwritten digest；
5. node 已删除、kind 改变、字段 owner 改变、workflow lock 或 asset ownership 不成立时返回专用安全冲突，不复活旧节点；
6. 多字段命令全部通过才原子提交，任一失败全部不写。

拓扑命令不使用 full graph replacement。每种 operation 都携带明确 identity 与受影响子图 digest：删除节点必须列出级联 edge/member 语义；连接必须引用当前仍存在的 endpoint/handle；group/ungroup 必须列出成员与 parent 变换；paste 必须使用新 node/edge ids；playlist order 必须是现有成员的完整排列。与受影响集合无关的并发拓扑原样保留；同一受影响集合若仍满足命令前置条件，则最后合法 command 生效；若 endpoint 已删除、id 冲突或会产生悬空/循环/非法 parent，则 `CANVAS_TOPOLOGY_CONFLICT`，不得用 base snapshot 复活数据。

`ReplaceUserGraphCommand` 只存在于旧 PUT compatibility adapter 内部，不能出现在新公开 command union、客户端 journal 或现代 OpenAPI schema。

### 8.2 服务端内部命令

不得从公开 HTTP body 解析：

```ts
type CanvasServerCommand =
  | ApplyGenerationProjectionCommand
  | DetachLegacyTerminalCommand
  | ApplyDocumentMigrationCommand;
```

`ApplyGenerationProjectionCommand` 只携带 task/run/node/ownership/result 身份。结果 patch 必须由服务端从已提交 task、publication 和 media record 重新构造，不能使用浏览器提供的成功内容。

`DetachLegacyTerminalCommand` 必须在事务内重新读取 authoritative task state 和当前 Canvas binding；浏览器提供的 terminal state 不能作为事实。

`ApplyDocumentMigrationCommand` 必须有稳定 migrationId、旧文档版本/指纹前置条件和 already-applied 判断。

### 8.3 返回合同

```ts
type CanvasCommandResult = {
  status: "applied" | "already-applied";
  operationId: string;
  replayed: boolean;
  originalStatus: "applied" | "already-applied";
  operationDocumentRevision: number;
  operationInputGraphRevision: number;
  currentDocumentRevision: number;
  currentInputGraphRevision: number;
  currentLoadToken: string;
  authoritativeDocument: CanvasDocument;
  requestId: string;
  originalRequestId: string;
};
```

Receipt 保存的是原 operation 结论、原 requestId 及其 resulting revisions/digest，不保存可过期的原始 load token。每次成功或 replay 都在认证与 receipt 核对后读取当前权威 document，返回与当前 revision/进程 epoch 绑定的 `current-valid loadToken` 和新的当前 requestId，并同时返回 originalRequestId、原 operation revisions 与当前 revisions；revision 和进程 epoch 都未变化时，该 token 允许与此前相同，验收只验证绑定有效，绝不强制字符串变化。因此后续其他 command 已提交时也不会把旧 document 重新发给客户端。

DB receipt 与 wire 的唯一映射：

| Durable receipt outcome | 首次 wire | 同 payload replay wire |
|---|---|---|
| `APPLIED` | HTTP 200，`status=applied`、`originalStatus=applied`、`replayed=false` | HTTP 200，`status=already-applied`、`originalStatus=applied`、`replayed=true` |
| `NO_OP` | HTTP 200，`status=already-applied`、`originalStatus=already-applied`、`replayed=false` | HTTP 200，`status=already-applied`、`originalStatus=already-applied`、`replayed=true` |
| `REJECTED_CONFLICT(code)` | 原 HTTP 409/code、`replayed=false` | 保持同一 HTTP 409/code、`replayed=true`；不得变成 200 |

机器状态必须按命名空间使用，禁止在 API、日志、UI 与指标之间把裸 `success/conflict/already_applied` 当成同一枚举：

| 命名空间 | 唯一规范值 | 映射规则 |
|---|---|---|
| durable receipt outcome | `APPLIED`、`NO_OP`、`REJECTED_CONFLICT(code)` | 数据库存储与幂等重放的权威结论；不存 `already_applied`。 |
| command success wire | `applied`、`already-applied` | `already-applied` 可能是 `NO_OP` 首次响应，也可能是 `APPLIED/NO_OP` replay；靠 `originalStatus/replayed` 区分。 |
| command error wire | 稳定 HTTP + `code` + `replayed` | 不能只写裸 `conflict`；`REJECTED_CONFLICT(code)` replay 保持原 HTTP/code。 |
| workflow projection state | `pending`、`applied`、`conflict`、`failed` | 与当前 schema/type 一致；`conflict` 是权威绑定不匹配，`failed` 才进入 bounded retry，task/run success 不因此回退。 |
| generation task state | `queued`、`running`、`success`、`failed`、`cancelled`、`retrying`、`recovering` | 与当前 `GenerationTaskState` 一致；不得把 Provider 的 `accepted` 或 `outcome-unknown` 塞进 task state。 |
| workflow run state | `running`、`stopping`、`success`、`failed`、`cancelled` | 与当前 `WorkflowRunState` 一致。 |
| workflow node state | `pending`、`admitting`、`admitted`、`success`、`failed`、`blocked`、`cancelled` | 与当前 `WorkflowRunNodeState` 一致。 |
| Provider attempt outcome | `boundary-claimed`、`definitive-rejected`、`accepted`、`response-received`、`provider-failed`、`completed`、`outcome-unknown` | 这是付费边界证据；不得与 task/workflow state 混写。 |
| census serverClass | `A`、`B`、`C`、`D`、`T` | 这是对象分类，不是 task/projection 状态。 |
| metrics outcome | `command.applied`、`command.no-op`、`command.rejected-conflict.<code>`、`projection.<state>`、`generation-task.<state>`、`workflow-run.<state>`、`workflow-node.<state>`、`provider-attempt.<outcome>`、`legacy.reconcile-required`、`view.rejected` | 必须 namespaced；禁止聚合成含义不明的 `success/conflict`。 |

UI 只把上述 server wire/task/projection 状态映射成“已保存、需要重新同步、生成中、恢复中、投影失败”等文案，不得从 HTTP 模糊字符串或组件本地状态再发明终态。

成功与冲突是 discriminated wire union。409 body 返回 originalRequestId/current requestId、operation revisions（若尚未 apply 则为接收时基线）、当前 authoritative document/revisions/current-valid loadToken；它不承诺原始响应字节一致。400 解析错误可能没有合法 operationId，此时 `operationId=null`；auth/not-found 在身份边界前不创建或暴露 receipt。

成功响应与错误响应不能混在一个 optional-string 结构里。固定 HTTP/错误合同如下；现有稳定 code 保留，新增 code 在 OpenAPI 和 UI 映射中封闭枚举：

| HTTP | code/status | 语义 |
|---:|---|---|
| 200 | `applied` | command 有实际 durable 变化并提交。 |
| 200 | `already-applied` | operation receipt replay 或语义 no-op；Canvas row/revisions/updated_at 不变。 |
| 400 | `CANVAS_COMMAND_INVALID` | command kind、字段、数值、拓扑或 payload 非法。 |
| 400 | `CANVAS_WRITE_CONTRACT_UNSUPPORTED` | write-contract header 非空但不是当前 route 支持的精确值；不降级。 |
| 400 | `CANVAS_LEGACY_WRITE_IDENTITY_INVALID` | capability PUT 缺少合法 session/sequence/attempt tuple，尚不创建 receipt。 |
| 401/403 | 既有 auth code | 未认证或无权限；owner/actor 不取自 body。 |
| 404 | `CANVAS_NOT_FOUND` | Canvas 不存在或按现有防枚举策略不可见。 |
| 409 | `CANVAS_OPERATION_REUSED` | 同一 operationId 的 canonical payload hash 不同。 |
| 409 | `CANVAS_ALREADY_EXISTS` | create command 的 path Canvas 已存在且不是同 operation replay。 |
| 409 | `CANVAS_SAVE_SUPERSEDED` | 同一 saveSessionId 的迟到/重复 sequence；不用于跨标签全局 CAS。 |
| 409 | `WORKFLOW_GRAPH_LOCKED` | 当前命令与 workflow lock 冲突。 |
| 409 | `CANVAS_TOPOLOGY_CONFLICT` | command 的节点/边/parent 前置条件在最新 document 上不成立。 |
| 409 | `CANVAS_SERVER_OWNERSHIP_CONFLICT` | 浏览器试图修改 server-owned 字段或权威绑定已变化。 |
| 409 | `CANVAS_MEDIA_UNAVAILABLE` | 引用的上传资产不可被当前 owner/Canvas 采用。 |
| 409 | project deleted/not owned 既有 code | tombstone/ownership 继续 fail-closed。 |
| 503 | `CANVAS_OPERATION_RECEIPT_CAPACITY` | 新 operation 超出 receipt hard capacity；在任何 Canvas mutation 前 fail-closed，不创建 receipt、不降级写入；同 operation replay 不受此门影响。 |
| 503 | `CANVAS_COMMAND_RECEIPT_UNAVAILABLE` | 无法安全写/读幂等 receipt；不得降级成无 receipt 写入。 |

除第 8.4 节明确的“无 capability 缓存旧 PUT 保持旧 body shape”例外外，所有成功/错误 response body 和 `x-request-id` header 都必须包含同一个当前 requestId；该唯一例外也必须有 header requestId。错误 body 还必须包含稳定 `code`、可用时的 `operationId`、当前 revisions；需要重新同步时返回 authoritative document 或专用 GET 指示。no-op、APPLIED/NO_OP 同 payload replay和相同 projection返回200；`REJECTED_CONFLICT` replay保持原409/code。任何 replay 都不能制造 revision 或误报。

### 8.4 新旧请求映射与兼容边界

| 语义 | 新 typed command | 旧 Canvas PUT compatibility adapter |
|---|---|---|
| 用户/owner | 认证上下文 | 认证上下文；忽略 body 中任何身份暗示 |
| 幂等身份 | durable `operationId` | `saveAttemptId` 单独不是 operationId；仅 header=`legacy-put-v1` 且完整 session/sequence/attempt tuple 可由 server 派生 legacy receipt key |
| 标签顺序 | `saveSessionId + saveSequence` | 原样保留现有 high-water 规则 |
| document 基线 | `baseDocumentRevision` 用于重放/诊断 | `observedRevision + observedLoadToken` 继续证明服务器签发的加载基线 |
| input 基线 | `baseInputGraphRevision` | body 缺失时由服务端在事务内读取；浏览器不能声明是否变化 |
| 跨标签 | typed command 重放到最新 document，保持 DATA-005 | 继续现有跨 session last-successful-save-wins，不改成全局 stale 409 |
| server-owned nested fields | 永不在 UserOwned patch 中出现 | 从当前 server document 保留；不同值不能覆盖权威值 |
| graph revision | 服务端按 6.2 input 纯函数计算 | 服务端对当前/目标 user document 按同一 input 纯函数计算 |
| no-op | 200 `already-applied` | 见下述 capability gate；不得直接让旧 parser 接收同 revision |
| 响应 | 新稳定 command result | 继续返回兼容 `revision/graphRevision/loadToken`，可附新语义别名 |

旧 PUT 不能安全表达字段级 typed intent，因此只作为限时 adapter；不得从旧 full document 接受 result/task/proof 等 server-owned 变化。它的独立兼容合同如下：

1. 兼容 route 固定为当前 `PUT /api/canvas/{canvasId}`；capability 唯一协商值是请求 header `X-Unboundry-Canvas-Write-Contract: legacy-put-v1`；header 缺失走该 route 原无 capability 行为；值非空但不是该精确值则返回 400 `CANVAS_WRITE_CONTRACT_UNSUPPORTED`，不得静默降级；capability 响应回显同 header；
2. 认证、解析并 canonicalize user-owned document；server-owned 字段不进入 legacy payload hash；capability request 缺少或非法 `saveSessionId/saveSequence/saveAttemptId` 时返回 400 `CANVAS_LEGACY_WRITE_IDENTITY_INVALID`，此时尚无可识别 operation identity，不写 receipt；
3. 仅当 header 精确匹配且 tuple 完整合法时，server 对 owner/canvas/session/sequence/attempt 的 length-prefixed canonical tuple 计算 SHA-256，派生唯一 `legacy-save:<sha256(owner,canvas,session,sequence,attempt)>` receipt key，并在 high-water 判断前查询 durable receipt；禁止另一种明文拼接算法；
4. receipt 存在且 hash 相同，按第 8.3 节 replay；hash 不同返回 409 `CANVAS_OPERATION_REUSED`；不存在才继续；
5. 在 `BEGIN IMMEDIATE` 读取 Canvas、tombstone、durable row sequence 和 TEMP high-water；没有 exact receipt 时，只要同 session sequence 已到达/超过 high-water，就在同一事务写 `REJECTED_CONFLICT(CANVAS_SAVE_SUPERSEDED)` receipt 并返回 `requiresAuthoritativeGet=true`，绝不能因当前内容碰巧相同推断旧 PUT 已应用；
6. 合法的新 same-session sequence 或不同 session PUT 继续现有 DATA-005；load token、lock、ownership、media、server-owned merge 全部校验；所有在合法 derived operation identity 后得到的确定性 409 都与 rejection receipt 同事务，之后相同 payload replay 原 HTTP/code；只有 parse、auth、owner/not-found 防枚举等尚未建立安全 receipt scope 的失败可以不写；
7. capability request 的实际写/no-op 与派生 legacy receipt 同事务；no-op 不更新 Canvas row；不带 capability 的缓存旧客户端没有 durable replay receipt，继续历史 response/revision 行为，即使内容等值也不启用同-revision no-op；
8. 在 server 启用 capability no-op 前，先修改 `canvasPersistenceFacade` parser：只有 response 带 `saveStatus=already-applied`、echo 完整相同 tuple、`requiresAuthoritativeGet=false`、当前 authoritative document/revisions 与 `current-valid loadToken` 时，才接受相同 revision；token 只要求与当前 revision/epoch 有效绑定，不要求与此前不同；
9. 缺失 Canvas 的现代创建只使用本节明确 null baseline 的 `CreateCanvasDocumentCommand`；旧 PUT create 只向无 capability 缓存客户端保留一个明确 release 观察窗，并登记为 `time-bounded-legacy-create-adapter`，不是 schema bootstrap；tombstone/owner 不成立一律不创建；current build 调用必须为 0，旧 build 调用归零且 rollback window 结束后删除；
10. 旧 body 带 `generationProjection` 时，adapter 只提取 run/task/node/kind/ownership/input identity，忽略客户端结果 patch，由服务端重读 task/publication/media 后调用 server projection gateway；terminal detach 继续使用 identity-only `POST /api/canvases/{canvasId}/generation-terminal-detach`；
11. legacy projection/detach 的 response loss 由同一 server identity/application proof 或只读 task/Canvas 核对，不允许浏览器 full PUT 再次声明结果。

Capability legacy wire 固定为：

```ts
type LegacyCanvasSaveResult = {
  operationId: string;
  saveStatus: "applied" | "already-applied";
  originalSaveStatus: "applied" | "already-applied";
  replayed: boolean;
  operationRevision: number;
  operationGraphRevision: number;
  currentRevision: number;
  currentGraphRevision: number;
  revision: number;
  graphRevision: number;
  loadToken: string;
  currentLoadToken: string;
  authoritativeDocument: CanvasDocument;
  saveSessionId: string;
  saveSequence: number;
  saveAttemptId: string;
  requiresAuthoritativeGet: false;
  requestId: string;
  originalRequestId: string;
};

type LegacyCanvasSaveReconcileRequired = {
  operationId: string;
  code: "CANVAS_SAVE_SUPERSEDED" | "CANVAS_LEGACY_RECONCILE_REQUIRED";
  replayed: boolean;
  originalRequestId: string;
  operationRevision: number;
  operationGraphRevision: number;
  currentRevision: number;
  currentGraphRevision: number;
  currentLoadToken: string;
  rejectedSessionId: string | null;
  rejectedSequence: number | null;
  rejectedAttemptId: string | null;
  requiresAuthoritativeGet: true;
  requestId: string;
};
```

Capability success 中兼容字段 `revision/graphRevision/loadToken` 必须分别等于 `currentRevision/currentGraphRevision/currentLoadToken`，且 `currentLoadToken` 必须与当前 revision/进程 epoch 有效绑定；原 operation 的版本只放在 `operationRevision/operationGraphRevision`。因此响应丢失后即使已有后续写入，replay 也不会让客户端回退版本。`LegacyCanvasSaveReconcileRequired` 对首次和 replay 都强制 GET；合法 operation identity 对应的 replay 保持原 409/code，并用 `replayed` 与 `originalRequestId` 说明原结论。所有 capability 409 的通用 body 还遵守第 8.3 节的 current document/revision/requestId 规则；防枚举 404 不返回 document。

无 capability 旧 PUT 的 body 保持现有兼容 shape，所有 response 仍带 `x-request-id` header；capability PUT 的 body/header 均带 requestId。`generation-terminal-detach` 在 R3 同步升级为 body/header requestId；server internal projection 没有 HTTP body，但必须继承或生成 requestId 并写 structured trace。

它的调用量、客户端 capability/build、route、server-classified A/B/C/D/T 和退役观察窗必须单独计数。

### 8.5 唯一 HTTP 与认证合同

现代客户端唯一 durable write route 固定为：

```text
POST /api/canvases/{canvasId}/commands
Content-Type: application/json
X-Unboundry-Canvas-Write-Contract: command-v1
body: CanvasUserCommand discriminated by kind
```

不采用“endpoint 或 envelope”二选一。GET/DELETE 保持现有 route；旧 PUT 仅限第 8.4 节 compatibility。server-only projection 直接调用 transaction gateway，不经过公开 HTTP。

`canvasId` 只从 path 读取；`CanvasCommandBase` 及所有 public command body 不得包含 `canvasId`、`target`、`actor`、`accountId`、`ownerId` 或 `tenantId` 字段。handler 以 path canvasId 和认证后的 project/Canvas ownership 绑定，不做 body/path ID 比对；如果未来启用 tenant，tenantId 只能来自已验证 membership context。身份任一不一致按现有防枚举策略返回 404/403，不能 fallback 到客户端字段。

OpenAPI 必须为每个 command kind 使用 discriminated schema，禁止 `additionalProperties` 偷带 server fields；全部 response 使用第 8.3 节统一 requestId 合同。

路由安装不是隐含工作，固定 composition 是：

1. 新增 `server/canvasCommandsApi.ts`，只解析 `/{canvasId}/commands` POST 并调用 authenticated application service；
2. `server/canvasApplicationApi.ts` 显式 export command handler，`server/applicationComposition.ts` 暴露同一实例给直接测试/运行时；
3. `vite.config.ts` 的 `/api/canvases` router 先精确匹配 `/{canvasId}/commands`，再分发既有 reconciliation policy/detach；未知路径/method 返回稳定 404/405，不能落入错误 handler；
4. `apiBoundary` 继续负责认证上下文和 requestId；handler 内再做 project/Canvas owner binding；
5. `server/legacyReverseProxy.ts` 明确**不允许**新 command route：旧 schema bridge 无 durable receipt/新 gateway 时必须维持 fail-closed 503，不能转发或静默降级到旧 PUT；
6. 路由集成测试覆盖 Vite dev/preview 安装、application composition 直接调用、auth/owner、body limit、method、404/405、legacy bridge deny 和 handler 只调用一次。

## 9. 服务端事务、DATA-005 与幂等顺序

### 9.1 用户命令

每个用户 durable command 在一个 `BEGIN IMMEDIATE` 中按固定顺序执行：

1. 校验用户、从 path 解析的目标、owner scope 与 project tombstone；非 create command 必须存在 Canvas，create command 把“尚不存在”作为合法前置条件；
2. 计算 canonical command payload hash；按 `(ownerId, canvasId, operationId)` 查 durable receipt；
3. receipt 已存在且 hash 相同则返回原 operation outcome/revisions 加当前 authoritative document、current-valid loadToken 和新的当前 requestId；hash 不同返回 `CANVAS_OPERATION_REUSED`；
4. 严格分支校验基线：`create-canvas-document` 必须确认 `baseDocumentRevision/baseInputGraphRevision/observedLoadToken` 三项均为 `null`，不得执行 existing-canvas token/base freshness 检查，也不得因历史/残留 high-water 拒绝；existing command 三项必须非空并继续校验 token、base revisions 与 same-session high-water，同 session 迟到 sequence 拒绝，跨 session revision 过期不自动拒绝；
5. 在同一 writer transaction 内重新读取目标：create 必须再次证明 row 不存在并依赖唯一 row 约束解决并发；existing command 读取最新权威 document、workflow locks 和受影响 node ids；
6. 校验 command 类型、字段 allowlist、asset ownership、拓扑前置条件；create 的 `initialDocument` 只允许已登记 User-owned 初始字段，任一 server-owned/unknown 字段都拒绝；
7. 构造候选状态：create 直接从已验证 `initialDocument` 构造首份 document，不对不存在的 base 做 rebase；existing command 才重放到最新 document，不同 session 遵守第 6.4 节 DATA-005；
8. ownership 分支：create 没有可继承的 server-owned 字段并禁止客户端提供；existing command 保留/拒绝客户端试图改变的当前 server-owned 字段；
9. fingerprint 分支：create 计算首份 document/input hash 作为 receipt 证明并把 `documentRevision/inputGraphRevision` 都初始化为 1；existing command 按第 6.1/6.2 节分别计算 before/after 两类 hash，彼此绝不直接比较；
10. existing command 的 document 与 input hash 都相同才不更新 `canvas_documents`、`updated_at`、document/input revision，只在同一事务写 terminal `NO_OP` receipt/必要 high-water；document hash 变化时 document revision 恰好 +1，input hash 也变化时 input revision 才恰好 +1；create 除相同 operation receipt replay 外没有 no-op 路径；
11. create 原子 INSERT 首份 row；existing command 有实际变化时按第 6 节规则一次 UPDATE Canvas、revisions、project timestamp；成功 create 可在提交事务中初始化该 session 的 high-water 供后续 command 使用，但不得用 create 前的残留 high-water 作为拒绝条件；
12. 原子写 terminal operation receipt、save high-water 和必要 event；
13. commit 后返回 receipt 中的 operation outcome/revisions，以及事务后的当前 authoritative document、当前 revisions、current-valid loadToken 和新的当前 requestId。

Operation receipt 的最小 durable 合同：

| 字段 | 规则 |
|---|---|
| 唯一键 | `owner_id + canvas_id + operation_id` |
| 请求证明 | `command_kind + canonical_payload_sha256` |
| 顺序 | `save_session_id + save_sequence`，与 operation identity 分离 |
| 基线类型 | `baseline_kind` 只能是 `create` 或 `existing`；schema 必须用 nullable + CHECK 约束保证两种形状互斥。 |
| 基线 | `create` 时 base document/input revisions 与 observed load-token digest/epoch 全为 NULL；`existing` 时全部非 NULL（不保存原 token，只存 digest/epoch）。 |
| 结论 | 第 8.3 节唯一 receipt 枚举 `APPLIED / NO_OP / REJECTED_CONFLICT(code)` |
| 返回证明 | original status、original requestId、resulting document/input revisions、result document digest；不持久化进程期 load token |
| 审计 | created/settled timestamp、actor class、affected node ids digest、original requestId |
| 保留 | 迁移和离线 journal 窗口内禁止清理；未来清理策略必须另有可证明的 replay 安全合同 |

receipt 与 Canvas mutation 必须同一事务提交；“Canvas 已写但 receipt 没写”或反向状态均不允许。凡是已完成认证、canonical payload hash 和合法 operationId 识别后得到的确定性 command 冲突，都必须在同一事务写 `REJECTED_CONFLICT(code)` terminal receipt；相同 operationId/payload 永远重放原 409/code。唯一键已经存在但 payload hash 不同的 `CANVAS_OPERATION_REUSED` 不覆盖原 receipt，而是由该不可变原 receipt 稳定推出同一 409 并另留安全审计事件。只有 body 无法解析、认证失败、或防枚举 owner/not-found 使安全 receipt scope 尚未建立时可以不写。若当前 schema 无 durable 存放位置，必须触发第 14 节停止门，不能退化使用连接级 TEMP high-water。

必须保留现有稳定错误：`CANVAS_LOAD_REQUIRED`、`CANVAS_SAVE_SUPERSEDED`、`WORKFLOW_GRAPH_LOCKED`、project deleted/not owned、media unavailable。

### 9.2 服务端生成结果投影

必须继续在 workflow/task 现有事务中：

1. 读取已成功 task 与已提交 publication/media；
2. 校验 run/node/kind/task/ownership/input/result/model/contract revision；
3. 已有完全相同 result proof 时 gateway outcome=`NO_OP`、projection state=`applied`；若经 HTTP 暴露只映射成 wire `already-applied`；
4. 当前用户输入或绑定变化时 gateway outcome=`REJECTED_CONFLICT(CANVAS_SERVER_OWNERSHIP_CONFLICT)`、projection state=`conflict`，不覆盖 Canvas；
5. 从服务端账本构造结果 patch 与 canonical result identity；
6. 更新结果和 proof；
7. `documentRevision +1`，`inputGraphRevision` 不变；
8. 与 `workflow_run_nodes.projection_state` 一起提交；
9. projection 失败只进入 projection retry，不回退 task success、不新建 Provider attempt。

Canonical result identity 只能由服务端函数 `buildCanvasProjectionIdentity()` 计算。输入固定为 owner/canvas/run/workflow-node/generation-task/node/kind、task 保存的 input fingerprint、ownership key、model contract revision，以及 committed text digest 或 published asset identity/content digest；对象 key 稳定排序后 SHA-256。临时 URL、客户端 resultKey、浏览器时间和 UI 字段不得进入。客户端现有 resultKey 仅是 legacy hint，不能作为新路径的 authority。

`applyGenerationProjectionInTransaction(transaction, identity)` 必须显式接收调用方现有事务句柄，禁止自己 `BEGIN/COMMIT` 或嵌套连接；Canvas document 与 `workflow_run_nodes.projection_state` 在同一事务成功或回滚。

### 9.3 Provider 边界的准确表述

Provider HTTP 不可能和 SQLite 组成真正跨系统事务。正确合同是：

- 请求前原子取得唯一 Provider boundary；
- HTTP 在事务外执行；
- task id、响应证据、publication 和 settlement 分别原子落账；
- outcome unknown 时保留 boundary，禁止盲目再次 POST。

Canvas gateway 永远不能调用 Provider，Canvas PUT 成功也不能作为 Provider success 证明。

## 10. 客户端详细迁移清单

### 10.1 `CanvasSurface.tsx`

当前职责：底层 `setNodes/setEdges`、React Flow change、hydrate/adopt、history、模板/复制/新增/删除/连线/建组、viewport、保存前 flush、服务端结果刷新。

目标：

- 保留内部 React setter，但只允许 CanvasSurface 的 document/view adapter 使用；
- 建立 `documentState`、`viewStateByNodeId`、`pendingUserCommands`；
- `renderedNodes = merge(documentState.nodes, viewStateByNodeId)`；
- hydration 通过 `replaceAuthoritativeDocument()` 原子设置基线，明确 `dirty=false`；
- React Flow `select/dimensions/measured` 进入 view patch；
- drag/resize 过程进入 view，结束时才提交一次 layout command；
- remove/add/paste/template/group/ungroup/edge 操作编译为第 8.1 节原子 topology command；
- viewport 只有在 `interactionSource=user` 的 `onMoveEnd` 才提交：一次手势一个 gesture/operation identity；wheel burst、拖动画布和键盘缩放在结束时合并一次；hydration、resize observer、自动居中、程序化 `fitView`、节点聚焦和动画一律 `interactionSource=system` 且不持久化；用户明确点击“适配视图”使用独立 `user-fit-view` command；与上次 canonical viewport 等值时 no-op；
- `flushCanvasSave()` 只等待 pending durable commands，不再扫描 rendered nodes 猜测是否变脏；
- `refreshAuthoritativeCanvasDocument()` 不得在 clean refresh 前先 flush 渲染派生状态；
- dirty draft 时先 GET 权威文档，再只重放 user-owned commands；跨标签 user-owned 同字段遵守 DATA-005，以最后成功 command 为准并广播同步；只有 server-owned、workflow lock、资产 ownership 或拓扑前置条件冲突时才保留可见草稿并 fail-closed。

禁止完成态：业务节点仍可获得通用 durable `setNodes/setEdges`。

### 10.2 `CanvasGraphMutationContext.ts` 与 `canvasPorts.ts`

将当前重叠入口收敛为：

- `applyUserCommand(command)`；
- `applyFencedGenerationIntent(intent)`；
- `applyViewPatch(nodeId, patch)`；
- `replaceAuthoritativeDocument(document)`；
- `readDocumentSnapshot()`；
- `flushPendingUserCommands()`。

`trySetNodes` 标记为 Migration-only 并最终删除。上传失败回滚必须使用带 admission、operationId 和 expected revision 的补偿 command，不能只检查 persistenceReady 后裸写。

现有 CanvasGraphWriteFence、CanvasImageToolWriteFence、run/task/ownership/revision 校验继续复用，包进新 command envelope，不能降级。

### 10.3 `canvasPersistenceFacade.ts`

- transport 继续拥有浏览器端 Canvas HTTP；
- autosave 从“监听 raw nodes/edges/viewport”改为“监听 pending durable command journal”；
- 浏览器 fingerprint 只用于请求去重和 UI 状态，不再是权限/安全边界；
- pagehide 只能发送已经生成的 pending user command，不得重新抓 rendered nodes 生成快照；
- BroadcastChannel/external revision 到达时：clean 页面 adopt remote；dirty 页面 fetch + rebase user commands；
- command response 丢失时按同 operationId 与同 canonical payload 核对，禁止创建新 operation 冒充重试；
- server `already-applied` 必须清理 pending journal 并正确显示“已保存到云端”；
- expected 409 与不可恢复冲突分开显示；普通 clean flow 不得出现 409。

### 10.4 `ProbeNode.tsx`

第一批不破坏旧存储 shape；先建立类型与字段 descriptor：

- `DurableUserNodeData`；
- `DurableServerNodeData`；
- `EphemeralNodeRuntime`；
- `LegacyCompatibilityNodeData`。

新增字段必须登记 owner、durability、是否影响 input revision、允许 command。未登记字段编译/AST 门失败。

后续逐步把 `*Generating`、playlistPicking、媒体临时尺寸等移出 `node.data`。旧字段读取保留，mount 不回写。

### 10.5 `TextNode.tsx`

- 标题、prompt、model、parameters、用户手工 content 走 user command；
- 用户修改生成结果时原子清除旧 success proof/绑定；
- recovery 不再在 effect 中直接 `setNodes`；
- task/terminal/projection 状态从 ServerRun 读取；
- 旧绑定清理由服务端 legacy command 完成；
- 迟到结果必须继续通过 input/ownership/revision fence 拒绝。

### 10.6 `ImageNode.tsx`

- `onLoad` 和 deferred auto-fit 只能更新 view state；
- 已保存 `style.width/height` 永远优先；
- 只有用户明确 resize 或点击“适配尺寸”才提交 durable layout command；
- metadata fetch 只展示服务端权威值；旧 metadata backfill 走显式 migration；
- 上传中/进度/失败提示为 view state；
- 上传成功后以 `AdoptUploadedAssetCommand` 一次提交 asset + validated metadata；
- 上传失败补偿走 admission-aware command，不再使用通用 `trySetNodes`；
- image tool 结果继续使用 operationId/source ownership fence，通过 user/image-tool command 落图。

### 10.7 `VideoNode.tsx`

- `loadedmetadata` 只更新播放器 view state；
- 不得覆盖 persisted user style；
- duration/width/height 优先采用服务端 asset metadata；
- 旧数据缺失时允许本地显示值，但不写 Canvas；
- 上传、结果选择、prompt/model/parameters 分别走明确 command；
- 重复 metadata event 必须 value-equivalent 且零 command、零 PUT。

### 10.8 `AudioNode.tsx`

- playback currentTime/playing/duration fallback 为 view state；
- 已有 durable waveform 直接显示；
- 旧节点没有 waveform 时可在浏览器计算 view cache，但不得 `setNodes`；
- 新上传若需要 durable waveform，应随明确 upload adoption 一次提交；
- server duration/metadata 是权威值；HTMLAudioElement 的 duration 只作显示 fallback；
- 上传失败和结果选择通过 admission-aware command；
- 刷新和重复 metadata 不得产生 Canvas write。

### 10.9 `GroupNode.tsx` 与 `PlaylistNode.tsx`

- title/color/group/ungroup/layout、playlist clips/trim/order 是 user durable commands；
- group/ungroup 必须原子修改 nodes + edges + parent关系；
- playlistPicking、drag preview、播放预览进入 view state；
- undo/redo 保存 command 前后快照或逆 command，不能恢复 server-owned 旧字段；
- export 不得借机修改 Canvas，除非用户明确提交 playlist edit。

### 10.10 `WorkflowExecutionProvider.tsx`

- 移除 raw durable `setNodes` 参数；
- `stripStaleCanvasSaveErrors` 改为显式兼容命令或服务端 reconcile，不在 preparation 中裸写；
- server preparing/server admitted/terminal 只更新 view state；
- breathing 只对应 server-admitted；preparing 使用不同的准备反馈，不能伪造生成中；
- create 前只 flush pending user commands；
- create outcome unknown 继续只读 reattach，绝不第二次 POST；
- terminal 后通过 GET/adopt authoritative document 展示结果；
- server projection 已成功时浏览器不再次投影。

### 10.11 `singleNodeGenerationLifecycle.ts` 与 `workflowNodeExecutors.ts`

- 保留现有 preflight/run/recover/fence 顺序；
- prepare/bind/unknown/success/failure 变为明确 generation intents；
- 长期目标是所有 task result 均由服务端 projection service 写 Canvas；
- 单节点客户端只负责发起一次 task、轮询/展示和只读核对，不直接宣称 task success；
- server projection 未落图时显示 task success + projection pending，不重发 Provider；
- 四模态 executor 共用同一 projection contract；
- 任一 executor 重新依赖 React component mount 或 raw setter，静态门失败。

### 10.12 `groupResultProjection.ts`

- 现代 server workflow 禁止使用浏览器 GET -> merge -> PUT；
- compatibility 期间仅允许历史精确任务进入旧路径；
- 客户端 resultKey 只作为 legacy hint；现代 result identity 必须由第 9.2 节服务端函数生成；
- 完成 server projector、事务原子性和 legacy census 后，现代路径改为只 GET server authoritative document；
- applicationId/semantic revision 的幂等思想保留到服务端 command；
- 不可一刀切删除所有 legacy recovery，避免丢失已付费但未收口的历史结果。

切换禁止双写，固定顺序是：先让 server projector 对 modern run 达到幂等/故障矩阵通过；再在同一冻结候选中让 modern client writer 变为 0；然后用 route counters 证明 workflowNodeExecutors、WorkflowExecutionProvider、groupRunPersist 均不再调用 browser projection；最后仅对 census 明确标记的历史 C 类保留 allowlisted endpoint。任何时刻都不能让同一 modern result 同时由 browser 与 server 写 Canvas。

### 10.13 `imageTools/*`

- 保留 operationId、sourceAssetId、ownershipKey、runId、expectedRevision；
- placeholder、prepared asset、最终结果采用同一个 operation identity；
- durable graph adoption 走 image-tool user command；
- asset 已生成但 graph command 失败时进入可恢复 publication/cleanup，不重做付费工具调用；
- 任何 source 变化或 ownership 不一致 fail-closed。

## 11. 服务端详细迁移清单

### 11.1 新增 `server/canvasMutationGateway.ts`

提供事务内 domain methods：

- `createCanvasDocumentInTransaction`；
- `applyUserFieldChangesInTransaction`；
- `applyTopologyInTransaction`；
- `commitUserLayoutInTransaction`；
- `adoptUploadedAssetInTransaction`；
- `editResultAndInvalidateProofInTransaction`；
- `applyGenerationProjectionInTransaction`；
- `detachLegacyTerminalInTransaction`；
- `applyDocumentMigrationInTransaction`。

每个方法固定 command type、字段 allowlist、owner、affected nodes、revision 规则、no-op、幂等和 conflict code。所有 `*InTransaction` 方法必须接收现有 SQLite transaction/store handle，绝不自行开启、提交或切换连接；只有最外层 application service 拥有 commit/rollback。Gateway 自身不得调用 Provider。

### 11.2 `server/canvasPersistence.ts`

- GET 行为保持；
- 旧 PUT 暂时作为 `ReplaceUserGraph` compatibility adapter；
- 新增唯一 `POST /api/canvases/{canvasId}/commands` typed endpoint；
- 旧 PUT 不再无条件接受客户端 server-owned generation 字段；
- 旧 PUT 明确保留 DATA-005：同 session 旧 sequence 拒绝，跨 session last-successful-save-wins；不得把 `observedRevision` 变成跨标签全局 CAS；
- typed endpoint 做内容级 no-op，完全相同时不增加 revision；legacy PUT 依第 8.4 节 capability gate 分阶段启用同 revision no-op；
- 保留 load token、session sequence/high-water、tombstone、workflow lock、media ownership；
- response 同时返回 wire 兼容字段和明确的 document/input revision 语义。

### 11.3 `server/canvasTransactionCommands.ts`

- 把 Canvas create、user field change、atomic topology、revision 计算、字段 merge 和 command receipt helpers 集中到事务命令；
- 禁止其他模块复制 revision 算法；
- 所有命令先分别计算 before/after document fingerprint 与 input fingerprint，再按第 6.1 节状态机决定 no-op/revision；
- topology command 原子验证 edge endpoint、parent/group、node kind 和重复 id。

### 11.4 `server/canvasWorkflowProjection.ts`

- 继续要求调用者已处于 transaction；
- 不接受任意 `patch` 作为最终公开合同；
- 从 task/publication/media 权威记录构造 patch 和 canonical result identity；
- 增加 exact proof 判断；命中时 gateway=`NO_OP`、projection state=`applied`；
- projection 只增加 document revision；
- 继续和 workflow node projection_state 同事务提交；
- current prompt/model/input/ownership 变化时返回 `REJECTED_CONFLICT(CANVAS_SERVER_OWNERSHIP_CONFLICT)` 并把 projection state 设为 `conflict`，保留 task/result。

### 11.5 `server/canvasLegacyGenerationReconciliation.ts`

- HTTP detach 与 allowlisted sweep 共用同一个 gateway command；
- 重新读取 task state、attempt、Provider task id、result、Canvas binding；
- generation task 的 `success/running/recovering/retrying` 与 Provider attempt 的 `accepted/response-received/outcome-unknown` 按第 8.3 节各自命名空间处理，不能误删或互相代替；
- exact already-detached 为 no-op；
- terminal detach 只增加 document revision；
- D 类证据不完整对象进入 quarantine，不由浏览器猜测或自动清理；
- detach success/error schema 与 parser 增加 body requestId，所有 response 同时返回同值 `x-request-id`。

### 11.6 `server/workflowRunService.ts`

- 保持 create 时的 active run、input graph revision、未决 task、locks、reservation 检查；
- 保持 immutable semantic plan 与 node idempotency key；
- task success 后调用 server-only projection gateway；
- projection failure 只更新 `projection_state=failed` 并进入 bounded retry；
- workflow DAG 不依赖客户端是否在线；
- run/node terminal 不删除 task、attempt、result 和 billing evidence。

### 11.7 `server/generationTaskStore.ts`

- 不直接写 Canvas；
- 将 `expectedCanvasRevision` 的代码语义明确为 input graph revision；
- 保留 admission idempotency、request fingerprint、credential revision、Provider boundary、attempt 和 unknown billing fence；
- 提供只读 authoritative task/result proof 给 projection gateway；
- 任何 Canvas 重构不得扩大可创建新 attempt 的条件。

### 11.8 `server/generationResultCommit.ts`

- 继续拥有 Provider response、media staging/publication、task success 和 event 原子收口；
- Canvas projection 只能消费已 committed 的结果；
- projection failure 不反向修改 task success；
- publication pending 恢复同一 object/token，不调用新 Provider；
- server restart 后 projection retry 必须幂等。

### 11.9 `types/*` 与 `server/openApi.ts`

- 新增 command union、field ownership descriptor、result/conflict schema；
- 文档化 `revision/documentRevision` 与 `graphRevision/inputGraphRevision`；
- server-only command 不出现在浏览器可调用 schema；
- 旧 PUT 与 generationProjection 标为 compatibility，不作为现代 workflow 路径；
- 所有新 conflict code 加稳定测试和用户可理解文案。

## 12. Legacy 盘点与退出方案

### 12.1 只读盘点分母

未来取得生产只读授权后，统计但不修改：

- Canvas 中 `workflowExecutionRunId`、四模态 task/input/ownership/error/generating 字段和 `groupRunSuccess*`；
- active/stopping workflow runs；
- pending/admitting/admitted workflow nodes；
- projection pending/failed/conflict；
- workflow locks 与 reservations；
- queued/running/recovering/retrying generation tasks；
- Provider task id、attempt outcome、unknown billing；
- publication pending/staged/external-ready；
- 只依赖浏览器 legacy projection/detach 才能收口的对象数量。

### 12.2 分类

- A：现代 server workflow，结果已投影；
- B：现代 workflow，task/result 成功但 projection pending/failed；
- C：legacy terminal，具备 exact detach/projection proof；
- D：task/attempt/ownership/result 证据不完整或 outcome unknown。
- T：accepted/running/recovering/retrying 的在途任务；继续走原 server lifecycle，不进入 terminal detach，也不计为可退休对象。

D 类一律 quarantine/fail-closed，不自动清理、不重新 admission、不发新 Provider 请求。

### 12.3 浏览器 legacy writer 关闭条件

以下全部满足后，才关闭现代 workflow 的浏览器 projection/detach：

1. B 类可由服务端 projection retry 收口；
2. C 类可由服务端 exact legacy sweep 收口；
3. T 类全部由 server lifecycle 可持续恢复，且不依赖浏览器在线；
4. D 类已隔离并有用户可见说明；
5. 新客户端对现代 workflow 的 projection/detach POST 为 0；
6. 兼容 endpoint 观察窗无现代调用；
7. clean refresh 0 PUT/0 task/0 Provider；
8. dirty refresh 不丢草稿、不覆盖 server result；
9. rollback 不需要删除或倒写历史任务/结果。

关闭的是现代浏览器 writer；服务端 legacy sweep 在历史任务完全收口前必须保留。

### 12.4 Browser producer 与 route allowlist

R0 manifest 至少必须逐调用点登记当前已知 producer，且 AST/HTTP route 扫描发现的新增入口同样纳入：

- `client/src/generation/groupResultProjection.ts`；
- `client/src/generation/legacyTerminalGenerationReconciler.ts`；
- `client/src/generation/WorkflowExecutionProvider.tsx`；
- `client/src/generation/workflowNodeExecutors.ts`；
- `client/src/generation/groupRunPersist.ts`；
- `client/src/canvas/canvasPersistenceFacade.ts` 中承载 full-document/generationProjection 的 transport。

允许的最终 route 只有：

1. modern user durable edit：`POST /api/canvases/{canvasId}/commands`；绝不带 generation result/proof；
2. modern server result：进程内 `applyGenerationProjectionInTransaction`；无 browser route；
3. legacy policy read：`GET /api/canvases/{canvasId}/generation-reconciliation-policy`；
4. C 类 terminal signal：`POST /api/canvases/{canvasId}/generation-terminal-detach`，只传 identity，server 重新分类；
5. 缓存旧客户端的 legacy Canvas PUT/generationProjection：time-bounded adapter，只取 identity、忽略 result patch、server 重建。

`legacyTerminalGenerationReconciler` 只能提出候选：server 在事务内把对象分类为 C/T/D；C 才可 exact detach，T 保持原 lifecycle，D quarantine。浏览器声明的 terminal/class/result 一律不是事实。

Route counter 至少按 `clientBuild/capability/route/callerSymbol/serverClass/operation/runId/taskId/outcome/requestId` 分桶；`outcome` 必须使用第 8.3 节 namespaced 枚举，serverClass 必须由 server evidence 计算。发布门要求当前 build 的 modern projection/detach producer 调用为 0、任何 modern result 双写为 0、历史 C 调用全部命中逐项 allowlist。出现未登记 caller 或 modern 调 legacy route 即 P0。

## 13. 静态治理门

新增 TypeScript AST/源码覆盖规则，不能只靠人工 `rg`：

1. 节点组件禁止 raw setter 修改 durable/server-owned 字段；
2. `trySetNodes` 除 migration adapter/test double 外为 0；
3. `onLoad`、`onLoadedMetadata`、媒体 decode callback 不得调用 durable command；
4. `WorkflowExecutionProvider`、`workflowNodeExecutors`、`singleNodeGenerationLifecycle` 不得依赖 React raw setter；
5. 产品中的 Canvas HTTP write 只允许在 persistence transport/command client；
6. 服务端 Canvas SQL UPDATE 只允许 gateway/受审事务适配器；
7. 新 ProbeNode 字段必须登记 owner、durability、input revision 影响和允许 command；
8. server-only generation fields 不得出现在 UserOwnedNodePatch；
9. server projection command 不得从公开客户端 request 解析；
10. 每个 durable command 必须有 command/application identity 与 revision precondition；
11. fixture/test helper 的例外必须显式 allowlist，不能用宽泛目录排除；
12. 迁移期间每一个旧入口都在 writer manifest 中有 owner、替代入口和删除阶段；
13. 新 typed command 必须使用 operationId 和 durable receipt；`saveAttemptId` 不得被静态重命名伪装成 receipt；
14. `canvasDocumentFingerprint` 与 `canvasInputGraphFingerprint` 共用一个权威字段 descriptor、分别投影完整 durable document 与 input 子集；旧宽泛 fingerprint 不得继续决定 no-op 或 input revision；
15. modern result identity 只能调用服务端 canonical builder，浏览器计算 key 不得进入权威 projection；
16. 跨 session revision stale 不得直接映射为全局 CAS 409；DATA-005 测试是发布硬门。

R0 必须生成并由测试消费 `spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_WRITER_MANIFEST_2026-09-03.json`。最小 schema：

```text
baseline: gitRoot, branch, head, sourceTreeHash, generatedAt
scan: commands[], includeGlobs[], exactExclusions[], parserVersion
entries[]:
  id, side, file, symbol, astKind, sourceAnchorHash,
  writeTarget, stateClass, fieldOwner, transactionOwner,
  currentEntry, targetEntry, primaryPhase, removalPhase,
  exceptionKind, exceptionReason, tests[]
summary:
  scannedFiles, rawHits, productHits, classified, exceptions, violations
```

Manifest 必须逐项覆盖：

- 客户端 raw setter、graph.apply/mutate、Canvas HTTP write、pagehide、BroadcastChannel、媒体 callback、workflow projection/detach；
- 服务端 `INSERT/UPDATE/DELETE canvas_documents`、revision 算法、projection、legacy sweep/detach；
- `server/database.ts` 的 bootstrap/schema 初始化、账户删除/级联、migration DDL/DML 等 lifecycle writer。

允许例外只分为 `bootstrap`、`schema-migration`、`account-delete-cascade`、`test-double`、`time-bounded-legacy-adapter`。每个例外仍必须写 transaction owner、revision 是否适用、为什么不能走普通 gateway、删除/保留条件；不得用目录级排除隐藏 SQL。每次候选冻结重新生成 manifest，source anchor 或正式分母变化必须人工解释；探索阶段搜索命中数不参与分母比较。

## 14. Schema 决策门

当前不预判“必定 schema42”或“必定 schema43”，但决策必须在 R2 改写任何运行时 writer 之前闭合。

已知代码事实：当前 `canvas_save_session_high_water` 是连接级 SQLite TEMP table；durable `canvas_documents` 只保存当前 save session/sequence，不保存 `(owner, canvas, operationId, payload hash, canonical result)`。因此 TEMP high-water 不能证明跨进程/重启 operation replay，也不能发现相同 operationId 的不同 payload。

### 14.1 Schema42 分支的通过标准

R1.5 必须指出一个已经存在、durable、事务可共用且语义不冲突的存放位置，并以 crash/restart 测试证明第 9.1 节 receipt 全合同。不得复用：

- TEMP table；
- 只保存最新 sequence 的 Canvas row；
- workflow/task 表来承载普通用户编辑；
- 日志文件、内存 Map、localStorage；
- 仅凭“目标状态看起来相同”来判断同 operationId 的 payload 是否被替换。

只有上述证据全部通过，才允许继续 schema42 分支。

### 14.2 Schema change 分支

若不存在合格 durable 位置，矩阵状态立即使用已定义的 `NO_GO`，并在 stop receipt 的 reason 中记录 `SCHEMA_CHANGE_REQUIRED / IMPLEMENTATION_STOPPED`；不得把这两个 reason 当作新状态，也不得在当前权限下建表。另立并 Review migration 附件，至少定义：

- receipt table 字段、unique/index/foreign-key/check constraints；
- 与 Canvas mutation 同一 transaction 的写入顺序；
- conflict receipt 与成功 receipt 的状态机；
- 重启、回滚、备份/fresh restore、旧二进制读取行为；
- retention/容量上限；迁移观察期内不得 prune；
- schema42→新 schema 的 forward-only migration 与 previous release 回滚限制；
- staging/fake-data migration 演练、locked-exact production backup 和独立 Review；
- 新版本号、发布和生产 migration 的单独授权。

表名和 schema 版本号只能在该附件核对现有 migration 序列后确定，本文不擅自把它叫 schema43。

### 14.3 共同通过标准

无论走哪个分支，都必须证明：

1. 同 operationId+同 hash 跨重启返回原结论；
2. 同 operationId+不同 hash 稳定 409；
3. applied/no-op/conflict receipt 与 Canvas/updated_at/revisions 不会半提交；
4. receipt 故障 fail-closed，不降级写 Canvas；
5. DATA-005 与 same-session high-water 均不回退；
6. Provider/task/projection 使用其现有专用 idempotency，不被普通 user receipt 取代。

## 15. 分阶段施工顺序

### R0：冻结身份、writer manifest 与预期红测

修改范围：测试 fixture、writer manifest、方案/矩阵状态；不改产品行为。

动作：

1. 重新核对 Git root/branch/HEAD/origin/main/package/Node 和工作树；
2. 核对生产版本仅作只读身份，不读取真实 Canvas 内容；
3. 用 manifest 内记录的命令重新扫描客户端；逐项标记 DurableUser/DurableServer/Ephemeral/Migration，实际新分母可以与初步 154 不同但必须解释；
4. 冻结所有 Canvas SQL writer，包括 persistence、projection、legacy、bootstrap、migration、账户删除/级联；
5. 建立脱敏生产形状 fixture；
6. 在旧代码上写预期红测：图片、视频、音频被动加载零写，revision 规则，autosave/projection race；
7. 红测只能失败在预期断言，若出现其他失败先诊断，不继续扩大范围。

R0 通过门：writer manifest 路径、命令、baseline hash 完整，分母 100% 有归属且例外逐项解释；预期红稳定；真实 Provider/OSS/生产写为 0。

### R1：共享合同与纯函数

主要文件：`types/canvasCommands.ts`（新）、`types/canvasFingerprint.ts`、ProbeNode 字段 descriptor、server/client contract tests。

动作：

1. 定义 create、field-change、topology、layout、upload、edited-result command union 和 result；现代 union 不含 full graph replace；
2. 定义 user/server/view/migration 字段 owner；
3. 按第 6.1/6.2 节分别定义 document/input fingerprint 纯函数、独立 revision 状态机和 ProbeNode 全字段 descriptor；
4. 定义 revision transition table；
5. 定义 no-op、conflict、already-applied；
6. server/client golden vectors 覆盖每个 command、字段类别、旧 Canvas、四媒体和 projection/detach；
7. 定义 operation receipt 的 canonical payload/response schema；
8. 不切换运行时 writer。

R1 通过门：纯函数测试全绿；未分类字段为 0；旧行为不变。

### R1.5：Durable operation receipt / Schema 决策

修改范围：只允许 capability spike、测试、schema/migration 附件；不得切换运行时 writer。

动作：

1. 验证 schema42 是否存在满足第 14.1 节的 durable receipt 位置；
2. 模拟同 operation replay、不同 payload、进程重启、事务中点故障；
3. 证明 receipt 与 Canvas mutation 同事务；
4. 若满足，冻结 schema42 复用证据；
5. 若不满足，写独立 schema/migration/backup/rollback 附件并停止，等待新的 Review 与用户授权。

R1.5 通过门：第 14.3 节 6 项全部有证据。没有通过就不得进入 R2。

### R2：服务端 CanvasMutationGateway 骨架

主要文件：`server/canvasMutationGateway.ts`（新）、`server/canvasCommandsApi.ts`（新）、`server/canvasTransactionCommands.ts`、`server/canvasPersistence.ts`、`server/canvasApplicationApi.ts`、`server/applicationComposition.ts`、`vite.config.ts`、`server/legacyReverseProxy.ts`、types/OpenAPI、`tests/m85-canvas-persistence-server.spec.ts` 与新增 route/contract tests。

动作：

1. 建立事务内 gateway；
2. 实现唯一 `POST /api/canvases/{canvasId}/commands` 与 discriminated OpenAPI；
3. 在 canvasApplicationApi/applicationComposition/Vite router 安装 handler，并验证 route 顺序；
4. legacyReverseProxy 明确 deny 新 POST，不把旧 schema bridge 当 fallback；
5. 先升级 client parser/capability，再启用 typed/no-op response；
6. 旧 PUT 通过第 8.4 节 time-bounded compatibility adapter 调 gateway；
7. 实现现代 `CreateCanvasDocumentCommand`，旧 PUT create 单列 legacy adapter；
8. 加 server-owned 字段保护；
9. 接入 R1.5 已批准的 durable operation receipt和内容级 no-op；
10. 集中 revision 计算；
11. 保留 DATA-005、same-session high-water 和现有 error/fence；
12. 完成第 8.3~8.5 节新旧 payload/response/error/requestId/routing 映射回归。

R2 通过门：旧客户端兼容；typed command 与 capability legacy PUT 的等值请求不增 revision；无 capability PUT 保持旧语义并单独计数；拓扑原子；无 task/Provider 行为变化。

### R3：服务端 projection 与 legacy writer 收敛

主要文件：`canvasWorkflowProjection.ts`、`canvasLegacyGenerationReconciliation.ts`、`workflowRunService.ts`、`generationResultCommit.ts`、m85/m103 等。

动作：

1. workflow projection 改用 server-only gateway command；
2. 从服务端 task/publication 构造 patch；
3. 加 already-applied no-op；
4. projection_state 与 Canvas 同事务；
5. detach endpoint/sweep 共用 gateway；
6. terminal detach 不增加 input revision；
7. projection/detach 故障注入。

R3 通过门：task success 不受 projection 失败影响；重复 projection/detach 零副作用；无新 Provider POST。

### R4：客户端 document/view 状态与 persistence controller

主要文件：`CanvasSurface.tsx`、`CanvasGraphMutationContext.ts`、`canvasPorts.ts`、`canvasPersistenceFacade.ts`、GenerationCanvasContext 及直接测试。

动作：

1. 分 documentState/viewState；
2. hydration adopt 设为 clean baseline；
3. autosave 改为 command journal；
4. React Flow change 分类；
5. pagehide 只提交 pending user commands；
6. clean remote refresh 先 GET 后 adopt；
7. dirty remote refresh 做 user-command rebase；
8. 跨 tab user-owned 同字段按 DATA-005 让最后成功 command 生效；server ownership、lock、asset 或 topology 冲突保留草稿并提示。

R4 通过门：clean hydration 0 PUT；selection/measurement/media event 0 PUT；真实用户编辑仍准确保存一次。

### R5：迁移所有用户编辑入口

主要文件：CanvasSurface、Text/Image/Video/Audio/Group/Playlist、imageTools。

动作：

1. 标题/prompt/model/parameters；
2. 节点/边增删、连接、模板、复制粘贴；
3. group/ungroup、playlist clips；
4. drag/resize/viewport 最终提交；
5. upload adoption/rollback；
6. image tool result；
7. undo/redo 不恢复 server-owned 旧字段；
8. 删除业务层 `trySetNodes`。

R5 通过门：writer manifest 中 DurableUser 100% 已迁移；AST 门通过；编辑/撤销/上传非回归通过。

### R6：迁移媒体被动事件

主要文件：ImageNode、VideoNode、AudioNode、media normalization/tests。

动作：

1. 图片即时/deferred onLoad view-only；
2. 视频 loadedmetadata view-only；
3. 音频 waveform/duration fallback view-only；
4. 完整 server metadata 不再被浏览器重写；
5. legacy metadata 只走显式 migration；
6. 用户“适配尺寸”作为明确 command；
7. 自定义持久尺寸永不被 mount 覆盖。

R6 通过门：四种媒体事件重复触发均 0 durable command/0 PUT；生产形状 clean fixture 连续刷新通过。

### R7：生成链与浏览器 legacy writer 退出

主要文件：WorkflowExecutionProvider、singleNodeGenerationLifecycle、workflowNodeExecutors、groupResultProjection、server projection/recovery。

动作：

1. WorkflowExecutionProvider 移除 durable setter；
2. server run phase 只驱动 view state；
3. 服务端用 canonical result identity 统一单节点/整组 projection，并与 projection_state 共用调用方 transaction；
4. 完成 legacy census 分类和 modern/legacy route allowlist；
5. 禁止双写地切换 modern client：workflowNodeExecutors、WorkflowExecutionProvider、groupRunPersist、groupResultProjection 的 browser projection/detach 调用变为 0；
6. 通过 route counters 观察 modern=0 后，才封闭 modern 旧路径；
7. T 类继续原 server lifecycle，保留 C 类 server sweep、隔离 D 类；
8. preparation、admitted breathing、terminal UI 分开。

R7 通过门：一次点击一个 workflow create；每节点最多一个 Provider boundary；canonical result replay 为 no-op；同一 modern result 从未双写；浏览器 modern projection/detach POST 0；T/C/D 路径仍按分类安全存在。

### R8：故障矩阵、可观测性与生产形状 E2E

动作：

1. command 日志记录 command kind/operationId、actor、affected node hash、before/after revisions，以及第 8.3 节 namespaced outcome；
2. 日志不得包含 prompt 全文、凭据、原媒体或敏感 token；
3. 统一 route log/counter schema 固定记录 `clientBuild/capability/route/callerSymbol/serverClass/operation/runId/taskId/outcome/requestId`；serverClass 只由 server evidence 算 A/B/C/D/T；
4. 对第 12.4 节六个已知 producer 建 callerSymbol 绑定；AST/route 扫描出现的其他 caller 归为 `unknown` 并立即失败，不允许靠客户端自报 symbol 绕过；
5. 指标区分 typed user command、capability legacy PUT、uncapable legacy PUT、server projection、legacy C detach、T lifecycle、D quarantine、view-only rejected write；
6. 自动断言 current build modern projection/detach=0、modern 双写=0、unknown caller=0、legacy 调用全部命中 exact allowlist；
7. 完成第 17 节故障矩阵；
8. 完成 clean/dirty/multi-tab/restart/slow Provider/ffprobe absence E2E；
9. 证明所有测试只用临时数据、动态 loopback、fake Provider/OSS。

R8 通过门：仅限 R0-R8 所属的 CWB-001..170，其中全部 P0/P1 实施项都有命令、环境、分母和 exit status；四个 route-counter 零值断言全部通过；无真实费用。R9 的候选 Review/formal full 与 R10 的版本/上线/真实费用权限不在本门冒充完成。

### R9：冻结候选、完整 Review 与唯一 formal full

动作：

1. 冻结 tracked/untracked 文件、hunks、source hash、test inventory；
2. 主线程逐文件/逐 hunk/逐 writer manifest 行 Review；
3. 独立 Reviewer 覆盖同一完整分母；
4. P0=0、P1=0 后才允许 formal full；
5. formal full 只执行一次；
6. 失败只复验最小受影响子集，不重复 full；
7. 文档同步不得冒充产品测试。

R9 通过门：`LOCAL_CANDIDATE_TECHNICAL_PASS / PRODUCTION_NOT_CHANGED / REAL_PROVIDER_NOT_RUN / USER_RECHECK`。

### R10：版本、发布与生产 canary

当前 Goal 已明确给出普通 patch 目标、冻结候选上线以及真实生成/费用权限；v0.7.9 独立 Review 与变更后 formal full 已通过，R9 已关闭，R10 获准开始。生产动作仍须严格按下列顺序执行。

授权后顺序固定：

1. 版本身份与远端占用检查；
2. 版本差异定向测试和增量 Review；
3. commit/push/PR、branch/main CI；
4. annotated tag/GitHub Release；
5. exact-tag fresh build；
6. 对候选最终采用的 exact schema 做 locked-exact backup/verify/fresh restore；
7. 原子切换、健康、静态资源、数据静默、rollback-forward；
8. 登录普通 Chrome 打开目标 Canvas 的服务器权威版本；
9. 冷缓存硬刷新一次：从 Canvas GET 开始记录；等待全部可观察图片 load/error、视频 metadata/error 和 hydration promise 结束，再保持 30 秒网络/定时器静默；总等待上限 120 秒，未稳定即 `NO_GO`；
10. 暖缓存普通刷新一次，使用相同 30 秒静默窗和 120 秒上限；
11. 两次刷新都必须由浏览器网络、server structured log、DB revision/task/attempt 计数三方证明：Canvas PUT/command POST=0、workflow/task create=0、刷新触发的Provider生成/OSS上传或其他写入=0、普通409=0、误报=0。2026-09-05 用户明确确认允许已有素材只读加载；已有素材的owner-scoped GET/307及OSS GET/Range须单列精确计数，不冒充所有OSS请求0，其他副作用门不放宽；
12. 只有第 11 步通过，才在新的真实点击/费用授权范围内对指定 group 点一次；
13. 结果不明只核对原 run/task，禁止第二次点击；
14. 验证当前 Canvas 实际 DAG（7 text + 3 image + 1 video）全部节点终态、结果自动回填、每节点最多一个 Provider boundary；
15. 完成后再暖刷新一次并执行相同 30 秒静默窗，要求结果保持且 Canvas write=0；
16. 当前 Goal 已明确授权并要求补充 audio 与 local-upload 生产验收：在当前账号新建明确标记版本的验收 Canvas，只使用本 Goal 生成的无隐私 fixture，完成一次真实付费音频生成回填、图片/视频/音频本地上传以及保存/刷新/下游读取/工作流输入验证；不得把 fake E2E 或目标 group 的文字/图片/视频成功冒充这些生产证据，不再另索费用或上传权限；
17. 保持 `USER_RECHECK`，直到用户明确说通过。

## 16. 测试策略与生产形状 fixture

### 16.1 Fixture 必备形状

脱敏 fixture 必须包含：

- text、image、video、audio、group、playlist；
- 本地上传图片/视频/音频 asset；
- image/video 自定义 persisted style width/height；
- 完整 server metadata；
- 音频有 waveform 与无 waveform 两种；
- generated result + groupRunSuccess proof；
- terminal legacy binding；
- pending/failed projection；
- 复杂 edges、parent/group 和 viewport；
- revision、graphRevision、loadToken、save session/high-water；
- 与真实目标相同的 7 text + 3 image + 1 video 工作流形状，但不复制用户 prompt/媒体/秘密。

至少两组：

1. `complete-multimedia-clean`：数据完整，刷新只读；
2. `legacy-incomplete-explicit-migration`：只允许一次 server migration，完成后再次刷新只读。

### 16.2 分层测试

1. 纯函数：field owner、fingerprint、revision、command merge、no-op；
2. 服务端事务：DATA-005、same-session fence、operation receipt、lock、topology、projection、legacy、restart；
3. 组件：Image/Video/Audio/Text/Group/Playlist；
4. 浏览器 persistence：hydrate、pagehide、BroadcastChannel、dirty rebase；
5. fake Provider HTTP：single/group、slow/lost response/result replay；
6. production-shaped E2E；
7. 唯一 formal safe full；
8. 生产 clean refresh + 唯一真实 canary（另行授权）。

### 16.3 网络计数必须区分

- Canvas GET；
- Canvas user command/legacy PUT；
- workflow create/list/get/stop；
- generation task create/get/reconcile；
- Provider create/submit/inspect；
- media/OSS publication；
- legacy projection/detach。

不能只看总请求数；必须逐 endpoint、method、operationId、runId、taskId、attempt 计数。

## 17. 故障矩阵

| 故障 | 必须保留的事实 | 系统动作 | 新 Provider POST |
|---|---|---|---:|
| Provider boundary 前失败 | 尚未越界 | 允许合法新 attempt 或取消 | 仅新合法 attempt |
| boundary 后丢响应且无 task id | unknown attempt | quarantine/recovering，只核对证据 | 禁止 |
| 已有 task id 后丢响应 | accepted task | inspect/resume 原 task id | 禁止 |
| Provider 明确失败/退款 | terminal attempt | 准确终态、保留历史 | 不自动重试 |
| 结果已返回但 publication 失败 | staged/pending result | 续传同一对象 | 禁止 |
| task success、Canvas projection 失败 | task/result success | retry 同一 projection | 禁止 |
| projection ownership 冲突 | task/result 保留 | 不覆盖 Canvas，projection conflict | 禁止 |
| 用户无关字段编辑与 projection 并发 | 用户 command + server result | 两者均保留、revision 单调 | 禁止 |
| 用户同字段编辑与 projection 并发 | 用户草稿 + server result | typed conflict，保留草稿和结果 | 禁止 |
| command response 丢失 | operationId + payload hash + durable receipt | 相同 operationId/相同 payload 重试或只读核对 | 禁止 |
| 两标签同时编辑 | 两套 user command journal | 重放到最新 document；无关字段均保留；同一 user 字段最后成功 command 生效；安全前置冲突才阻断 | 禁止 |
| 页面刷新/关闭 | pending user commands | pagehide 仅提交已登记 command | 禁止 |
| 图片/视频/音频加载 | view data | 只更新 view | 禁止 |
| ffprobe 不存在/媒体不可读 | task/result evidence | 明确终态，不无限重试 | 禁止 |
| server restart | durable task/attempt/publication | 按原 boundary 恢复 | 依原证据，绝不盲发 |
| legacy 证据不完整 | D 类 quarantine | 不清理、不猜、不投影 | 禁止 |

## 18. 风险等级

### P0 发布阻断

- 干净 refresh 仍产生 Canvas write；
- 任一逻辑节点可能产生第二次 Provider POST；
- server projection 被改为客户端可信写入；
- task/result/billing evidence 被删除或降级；
- user graph command 可覆盖 server-owned result/proof；
- topology 非原子导致悬空 edge/parent；
- outcome unknown 被重新 admission；
- dirty rebase 丢失用户草稿或静默覆盖结果。
- inputGraphFingerprint 未按字段 descriptor 封闭或错误失效执行；
- operation receipt 不能跨进程/重启证明同 payload replay 与异 payload 冲突；
- 把 DATA-005 改成跨标签全局 CAS，或让 legacy full PUT 覆盖 server-owned 字段。

### P1 必须在候选冻结前关闭

- revision 规则仍由多个 writer 分别实现；
- 业务组件仍可裸写 durable fields；
- 媒体事件仍能进入 command journal；
- modern browser projection/detach 仍被调用；
- 旧数据分类分母不完整；
- no-op 仍增加 revision；
- exact production-shaped fixture 缺失；
- 单节点与整组结果仍使用不同 ownership/projection 合同；
- expected 409 与普通流程 409 无法区分。
- canonical result identity 仍由浏览器或两套算法分别计算；
- server projection 自开事务，不能与 projection_state 原子提交。

### P2 可登记但不得伪装成已解决

- preparation 反馈不够明显；
- mutation observability 不完整；
- 大型 Canvas 性能需后续精确档位验证；
- 兼容 endpoint 退休观察窗尚未结束；
- 物理类型/文件拆分尚未全部完成，但安全入口已收口。

## 19. 回滚设计

### 19.1 本地阶段

- 每个 R 阶段必须保持单独可复核 diff 和 checkpoint；
- 某阶段失败只回退该阶段内部适配，不删除用户现有改动；
- 不用 `git reset --hard`、`git clean` 或覆盖工作树；
- 无新相关代码变化时不重复已经通过的测试。

### 19.2 数据兼容

- 若 R1.5 证明 schema42 足够，第一候选保持 schema42；若需要 schema change，本方案在 R1.5 停止，必须先由独立 migration 附件取代本段假设；
- 无论 schema 分支如何，旧 Canvas JSON 必须可读且不得批量重写；
- 新 command 不删除历史 task/attempt/result/proof；
- 新客户端写出的 document 必须能被 v0.7.7 读取；
- 旧 PUT compatibility adapter 在生产观察窗结束前保留并 fail-closed；
- 不做不可逆批量迁移。

### 19.3 生产回滚

- exact release 原子切换；
- 切换前 locked-exact backup/verify/fresh restore；
- forward -> previous -> forward 成对验证；
- rollback 不依赖执行反向数据脚本；
- 若必须 schema change，使用第 14.2 节单独评审的 forward/backup/downlevel 模型，不能沿用“二进制原子切回即可”的假设。

## 20. 硬停止条件

出现任一项立即停止继续实现、测试扩张、版本化或发布：

1. 当前 Git/生产/version identity 无法确认；
2. 工作树存在无法归属的重叠用户改动；
3. writer manifest 有未分类 durable writer；
4. revision 规则无法通过纯函数定义；
5. gateway 需要信任浏览器生成结果；
6. Provider boundary 可能被绕过或重复；
7. unknown billing task 可能重新 admission；
8. legacy census 发现未处理 accepted/recovering/unknown 对象；
9. server result 与 user edit 无法无损保留；
10. clean fixture 仍有 PUT；
11. 需要任何 schema change，但独立 migration/backup/rollback 附件尚未 Review 和授权；
12. 独立 Review 存在 P0/P1；
13. formal full 尚未达到执行前门；
14. 版本号、上线、真实生成中任一所需授权缺失；
15. 生产 clean refresh 门失败；
16. 真实 canary outcome 不明。

## 21. 完成定义

只有以下全部成立，才能说本项目技术完成：

1. R0 当时 manifest 的实际产品 writer 分母全部归属并迁移/明确保留，初步 154 只作参考；
2. 所有 server Canvas SQL writer 经过统一 revision/ownership 合同；
3. clean hydration/media/render 绝不产生 durable command；
4. 用户编辑、拓扑、上传、图片工具完整可用；
5. server projection 保持事务内权威且幂等；
6. single/group 共用同一结果投影安全合同；
7. modern browser projection/detach 为 0；
8. legacy C 类可收口、D 类隔离；
9. document/input fingerprint 与 revision 规则逐字段/逐 command 通过；
10. operation receipt 跨重启幂等，no-op 不修改 Canvas row/updated_at/revisions；
11. dirty draft 不丢、不覆盖 server result，并保持 DATA-005；
12. text/image/video/audio/local upload 生产形状 fixture 通过；
13. 一次点击/一次 workflow create/每节点最多一次 Provider boundary；
14. lost response/restart/slow Provider/publication/projection/409 故障矩阵通过；
15. AST/源码覆盖门通过；
16. 完整候选 Review P0=0、P1=0；
17. 唯一 formal safe full 已如实记录并最小关闭失败；
18. 版本、GitHub、备份、部署和 canary 获得新的明确授权后完成；
19. 生产干净刷新 0 PUT 后才执行唯一真实点击；
20. 用户明确验收前保持 `USER_RECHECK`。

R0-R9 完成但没有发布授权时，最远只能写：

`LOCAL_CANDIDATE_TECHNICAL_PASS / PRODUCTION_NOT_CHANGED / REAL_PROVIDER_NOT_RUN / USER_RECHECK`

## 22. 推荐恢复顺序

未来施工会话必须按顺序阅读：

1. `AGENTS.md`；
2. `上线规矩.md`；
3. `spec/UNBOUNDRY_CURRENT_STATE.md` 顶部当前区块；
4. 当前生产 receipt；
5. 本 Plan；
6. 配套 Acceptance Matrix；
7. 当时唯一 Checkpoint（只有获得实现授权后才建立）；
8. writer manifest；
9. 当前阶段直接相关源码与测试。

历史 Goal、旧版本授权和当前 Plan 的文档授权均不得复用为实现、版本、发布或真实 Provider 权限。

## 23. 下一步

文档 Review 与早期冻结实现候选的独立全量 Review 均已完成，后续 `/goal` 已给出实现、版本、GitHub、发布、生产和真实生成授权。第二次 formal full 为 `1224/1227`，其 3 条失败已最小关闭；后续产品/测试变更使上一轮 Review GO 失效。当前必须先完成当前身份的增量终审，再在最终冻结候选上取得通过的 formal full，才允许继续 R10。

### 23.1 文档独立 Review 回执

- 最终合同候选：Plan SHA-256 `2abc485c8e75d34ff92bc9d95964890ed95986d7497fc596e05bafc49586f140`；Matrix SHA-256 `4472daf980058608d3aaa854d23242fb2101b4713dc49cd97706ace5a99db2f6`；
- 覆盖：Plan §0-§23 为 24/24；Matrix CWB-001..194 为 194/194；主阶段映射 194/194 唯一、无遗漏、无重复；
- Review 过程先后对双 fingerprint/revision、legacy PUT capability/create/replay、path-only identity、状态枚举、load token、route composition/counter、schema 决策和 create null baseline 提出 `NO_GO`，均已回写合同并复核；
- 最终独立结论：`P0=0 / P1=0 / P2=0 / DOCUMENT_GO`；
- Reviewer 全程只读，没有编辑文件、运行产品测试/构建、访问生产/浏览器、调用 Provider/OSS 或触碰永久保护 JSON；
- Review 通过后只修改文档状态头并登记本回执，没有改变已审合同；最终文件 hash 因这两项行政性文字变化而与候选 hash 不同；
- 该条结论记录的是当时仅完成文档 Review 的历史时点：当时实现、版本号、GitHub、发布、生产、真实点击/费用和用户验收均未授权、未执行；后续 Goal 已另行给齐权限，不能用该历史句覆盖当前授权状态。

## 24. 实施候选回执（2026-09-04）

- 唯一工作树：`/Users/mymy/Documents/unboundry-post-v076-canvas-convergence-2026-09-03`；implementation branch `codex/v0.7.8-canvas-write-boundary`；baseline HEAD `a401016607f1b01b2c266caa786d61734d64b545`。
- 已实现 schema43 durable operation receipt、typed Canvas command gateway、document/input 双 fingerprint、server projection、legacy capability adapter、client command journal、view/durable writer 分离、上传/图片工具/Group/Playlist/单节点/整组链路与结构化观测。
- writer manifest 当前扫描 `295` 个产品源文件、`253` 个 raw writer 命中；产品命中 `200`（client `131`、server `69`），例外 `92`，未分类违规 `0`。
- 最近冻结前定向复核：`m104-canvas-command-gateway 11/11`、`m3-persistence 8/8`、`m37-media-upload-transactions 39/39`、`m79-canvas-smoothness 3/3`、`m84-copy-paste 3/3`、`m86-canvas-load-safety 83/83`、`m105-canvas-writer-manifest 1/1`；每次 safe runner 的 source/type/architecture/credential/network/动态 loopback 门均通过。
- 更早同一未发布实现树上的相关定向层还覆盖 `m2`、`m4`、`m10`、`m19`、`m20`、`m22`、`m27`、`m30`、`m33`、`m38`、`m41`、`m63`、`m81`、`m85`、`m87`、`m88`、`m91`、`m92`、`m94`、`m95`、`m100`、`m101`、`m103`、`m104-inc-gen-026`、`m106`；不得把这些定向结果冒充 formal full。
- source coverage：`514/514`，其中 TypeScript `462/462`、JavaScript `52/52`；writer manifest check 与 `git diff --check` 通过。
- 尚未执行：唯一 formal full、commit/push/PR/CI/merge/tag/Release、exact-tag fresh build、生产 backup/restore/deploy/rollback、普通 Chrome refresh 门、真实 Provider/OSS 验收与用户复核。

### 24.1 首轮实现 Review finding 闭环

- 唯一独立 Reviewer 首轮完整覆盖 `139/139` files、`1847/1847` hunks、`250/250` 当时 writer entries、CWB `194/194`，结论 `P0=0 / P1=2 / P2=2`，formal full 因此未执行。
- 两项 P1 与两项 P2 已修复：group topology parent/kind/move 前置；legacy full-document user fields 与 authoritative projection 原子合并并纳入 payload hash；现代 edge handle fail-closed；detach rollout-disabled OpenAPI 409 精确 schema。
- 修复后 safe runner 定向证据为 `42/42 + 1/1 + 6/6`；同一 Reviewer 已确认首轮四项关闭，但第二轮新增 `P1=2 / P2=1`，因此仍未进入 formal full。

### 24.2 第二轮实现 Review finding 闭环

- legacy PUT 的 durable-user 输入字段现在按 descriptor 的 `input=true` 语义比较；任一输入变化均清除旧 generation proof。携带旧 generation projection 的同请求如果改变 prompt/model/parameters/content/asset 等输入，事务在投影前返回 reconcile conflict。
- 无 capability 的 legacy projection 已从早退分支移入统一事务门：先校验 workflow lock、stale projection、same-session high-water/capacity，再完成 uploaded-media adoption，随后才允许 authoritative projection；writer identity/high-water 与投影在同一 commit 中结算。
- writer scanner 为 SQL hit 记录 control-flow context；同一 `applyGenerationProjectionCore` 内 existing-receipt legacy merge SQL 继续属于限时例外，而共享 modern projection SQL 精确归类为 `Durable Server`。
- 回归证据：`m85-canvas-persistence-server 31/31`；`m103-server-authoritative-workflow + m104-canvas-command-gateway + m105-canvas-writer-manifest 24/24`；全部 safe runner exit `0`。测试库存精确为 `1226`。
- 第二轮修复候选经同一 Reviewer 复核，三项 finding 均关闭；新增 `P0=0 / P1=1 / P2=0`：legacy 素材/顶层/边拓扑和 modern topology 变化仍可能保留旧 generation proof。
- 第三轮已把 proof 失效覆盖扩展到 legacy 顶层 input、legacy edge target、权威素材替换与 modern topology target，并同时清理旧/新 kind；canonical input fingerprint 也改为逐个 node 顶层 `input=true` descriptor 投影。连接边只清 target，source proof 保留。
- 修复后 safe runner：`m85 + m92 + m104 = 46/46`、`m105 = 1/1`，全部 exit `0`；测试库存仍为 `1226`。
- 第三轮复核确认 proof P1 已关闭，但新增 `P0=0 / P1=1 / P2=0`：legacy rejected projection 和 modern 多素材冲突可能提交未采用 Canvas 的 upload adoption。
- 第四轮已把两条 adoption 路径纳入 savepoint；任何 media/projection conflict 都先回滚全部 adoption，再保留 rejection receipt。回归证明 capability 拒绝与 modern 第二素材冲突均不留下部分 adoption；`m85 + m104 = 42/42`、`m88 + m105 = 39/39`。
- 最终冻结候选：`139` files、`1855` hunks、`253` writer entries；产品 payload（排除 Plan/Matrix/Checkpoint）`136` files，SHA-256 `5833e0f0dffc5054f97e0d5f21be1ae7a6e2572bc06c2270f7aecd71cd3c5a1b`；manifest `253/200/92/0`，原始 SHA `7d0d5fcd...`、canonical `abd9a8d8...`、source tree `8d557e79...`。

### 24.3 最终实现 Review 回执

- 同一独立 Reviewer 对冻结候选完成 `139/139` files、`1855/1855` hunks、`253/253` writer entries、CWB `194/194` 只读复核；10/10 models、12/12 identities、6/6 adapters 全部覆盖。
- 第四轮 rejected adoption savepoint finding 已关闭，无新增 finding；最终结论 `P0=0 / P1=0 / P2=0 / GO`。
- Reviewer 未运行测试、生产、浏览器、Provider/OSS，也未触碰永久保护 JSON。formal full 已获准，执行前账本仍为 `0/1`。

## 25. Formal full 失败闭环与再冻结（2026-09-04）

- 首个冻结候选执行过一次正式 full：共 `1226` tests，原始结果 `1192 passed / 30 failed / 4 skipped`，exit `1`。该失败结果永久保留，不改写成通过。
- 30 条失败按最小范围逐项归因并关闭；最终原失败所属规格全部定向通过：`m17 18/18`、`m22 45/45`、`m27 27/27`、`m28 3/3`、`m29 8/8`、`m31 13/13`、`m34 6/6`、`m35 2/2`、`m36 2/2`、`m41 59/59`、`m60 3/3`、`m65 3/3`、`m68 4/4`、`m71 14/14`、`m82 7/7`、`m86 83/83`、`m98 5/5`、`m102 31/31`。
- 最后一个真实产品竞态是 foreign high-water 期间直接拖拽已被保存，却又被旧 React state 排入第二次保存；现在仅当已确认的 live-editor fingerprint 与当前 live snapshot 精确一致时认定收敛，`m86 83/83` 证明无重复 PUT。
- edge role/order 修改不再编译成先断开后连接，而由 `replace-edge` 在同一 topology command 中原子替换；legacy 无 handle 边只允许同 endpoint 原位兼容，现代 endpoint 变化仍要求 `source/target` handle。新增直接合同回归后 `m104-canvas-command-gateway 12/12`。
- 测试库存因此从 `1226` 精确增加到 `1227`；`scripts/run-safe-tests.mjs` 与 source coverage manifest 同步，source coverage 仍为 `514/514`（TS `462/462`、JS `52/52`）。新增/受影响合同复验：`m104 12/12`、`m102 31/31`、`m92 4/4`，全部 exit `0`。
- 当前再冻结身份为允许范围 `153` files（tracked `132`、untracked `21`）、`1919` hunks；排除 Plan/Matrix/Checkpoint 后产品 payload `150` files，SHA-256 `0cf6e5ab45e0825ea3cafd72e2a455b1cb399136dca07236834c1b6f9e8153e7`。writer manifest 已重生成并由 `m105 1/1` 验证：`295` source、`256` raw、`200` product、`95` exceptions、`0` violations；原始文件 SHA-256 `cbe4570fbae6203196fd905ec0d9f79f21ba0bf37ad7fd7d08c2b0d218840be0`，canonical fingerprint `9ab50c550a153bb7c962e9ed7e72dc27d62d5c90ed758c3541bc3d7ee55e941a`，source tree hash `1b0f03e814b338b7884576ea69afbc0625b00af051ffe3bbf86133dc95379aa0`。
- 同一独立 Reviewer 已对当前再冻结候选完成 `153/153` files、`1919/1919` hunks、`256/256` writers、CWB `194/194`、10/10 models、12/12 identities、6/6 adapters 复核；保护文件访问 `0`，最终 `P0=0 / P1=0 / P2=0 / GO`。当前门只剩在该候选执行必须通过的正式 full；发布、生产、浏览器和真实 Provider/OSS 仍为零新增。

### 25.1 第二次 formal full 与当前再冻结身份（2026-09-05）

- 第二次 formal full 原始结果为 `1224 passed / 3 failed / 0 skipped`（总数 `1227`，exit `1`）；3 条失败分别属于键盘位移时序、Text 富文本提交竞态和删除后过早撤销。
- Text 产品修复只允许最新同字段 body mutation 提交，聚焦且值一致时不以 React effect 重写 DOM，复制读取最新 committed value；m1/m69 仅补齐前序持久状态等待。`m1 + m2 + m69` 连续三轮 `60/60`，Text 直接依赖 `76/76`，全部 safe runner exit `0`。
- 当前冻结身份：`155` files（tracked `134`、untracked `21`）、`1931` hunks；产品 payload `152` files、SHA-256 `0b17dd9fe61550e4a254dec78d15286491e56110dd65c857046d50c24f485661`。writer manifest 为 `295/256/200/95/0`，原始 SHA `3c9b0662a334f11b6f0a51e37d69cbf262cd65edf49758d231aa3ef274b1b68e`、canonical `bbe9aa46bd84b41abbeca213d9221052122219ef75e7e9e24f4a43e403023df8`、source tree `8d4a5f8fce10c30c66c5b28d4eb2685197954418d9ce854e1ee2222eaf689e2d`。
- 先前 `153/153` Review GO 仅为历史候选回执；当前身份须由同一独立 Reviewer 复核并给出 `P0=0 / P1=0 / P2=0 / GO`，随后才执行最终 formal full。
- 同一 Reviewer 已完成当前身份 `155/155` files、`1931/1931` hunks、payload `152/152`、writer `256/256`、CWB `194/194` 终审；10/10 models、12/12 identities、6/6 adapters 结论继续有效，保护文件访问 `0`。
- 最终 `P0=0 / P1=0 / P2=0 / GO`，无 drift、无新 finding；当前只获准执行冻结 payload `0b17dd9fe61550e4a254dec78d15286491e56110dd65c857046d50c24f485661` 的最终 formal full。

### 25.2 最终 full 压力等待修正（2026-09-05）

- 最终 formal full 原始结果为 `1225/1227`、2 failed、0 skipped；两条失败均为 UI 等待预算超时。原候选未改代码时，完整 m4 `7/7` 与完整 m41 `59/59` 已分别通过。
- 测试层只把 m4 连续媒体替换轮询从默认 5 秒调为 20 秒，并把 m41 双轮询持有用例从默认 60 秒调为 120 秒，均复用同文件现有等待预算；合并复验 `66/66 PASS`。产品源码、writer manifest、Provider/生产边界均未变化。
- 当前 payload 为 `152` files、SHA-256 `96b62e1e11a65451f578b2ffa925ab2a9be2fd97569614269de7adbf9e77f087`；允许范围 `155` files、`1934` hunks。须完成该测试 delta 的独立复核后，执行最后一次 mandatory formal full 并要求命令 exit `0`。
- 同一 Reviewer 已对正确的 m4 两个 poll hunk 与 m41 old-Image-poll 单用例 timeout hunk完成复核；所有业务、次数与零 Provider 断言保持不变。覆盖 `155/155` files、`1934/1934` hunks，无新 finding，最终 `P0=0 / P1=0 / P2=0 / GO`。

### 25.3 Mandatory formal full PASS 与最后测试基础设施 delta（2026-09-05）

- 等待预算候选的 mandatory formal full 首次执行为 `1226/1227`、1 failed、0 skipped、exit `1`；唯一失败是 m41 terminal Text 用例的本地临时测试服务器 `route.fetch` 遇到一次 `ECONNRESET`。其余 1226 条通过，source snapshot 与 4173 listener 均未变化。
- 该测试只为对应 `route.fetch` 增加 Playwright 内置 `maxRetries: 2`；该选项只重试 `ECONNRESET`，不吞掉 HTTP、解析、业务断言、Canvas 写入或 Provider/request-count 失败。目标完整规格复验 `59/59 PASS`。
- 最后一次 mandatory formal full 取得 `127` specs、`1227/1227 PASS`、0 failed、0 skipped、exit `0`；Node/npm `22.23.1/10.9.8`，source/snapshot SHA-256 `70ac7cd827e2442cfe91d4a39639328b267218864b1fff2102791cf8914ca6da`，4173 listener `unchanged`。
- 当前允许范围仍为 `155` files（tracked `134`、untracked `21`）、`1934` hunks；payload `152` files，SHA-256 `8e7a00c6b11b3410fed749e72cebc4856c4cdf84bf90b6c7f3d91e2045c70567`。writer manifest 保持 `295/256/200/95/0`。
- 同一独立 Reviewer 已核对该单一测试基础设施 delta、最终 identity 与 CURRENT_STATE 同步，覆盖 `155/155` files、`1934/1934` hunks、CWB `194/194`，保护文件访问 0；结论 `P0=0 / P1=0 / P2=0 / GO`。R9 已通过，现进入 R10，禁止再次重复 full。

## 26. v0.7.8 生产 preflight 与 v0.7.9 再冻结（2026-09-05）

- v0.7.8 已完成 PR #157、双 CI、annotated tag、GitHub Release 与 exact-tag fresh build，但尚未切换生产；生产仍为 v0.7.7/schema42。
- 上线前只读 census 为 active task/run/publication/capacity 全 0，同时保留 23 条属于 failed/cancelled 终态 task 的 Provider boundary 历史证据。v0.7.8 one-shot 错把这些永久计费/恢复证据当作活跃执行，确定性拒绝迁移；没有修改生产 DB、没有切 current、没有 Provider/OSS/费用新增。
- v0.7.9 只把 42→43 quiescence 收口到活跃 task/run/publication/capacity 与 generation freeze。terminal task 的 accepted、response-received、outcome-unknown 行逐字段保留；不 settlement、不删除、不重发 Provider。新增 production-shaped terminal-history migration 回归，测试库存为 1229。
- 首轮独立增量 Review 覆盖 `17/17` files、`55/55` hunks，产品逻辑 `P0=0 / P1=0`，但因 attempt 只比较部分字段且 schema42 五个负向门未直接覆盖而给出 `P2=2 / NO_GO`。现已补齐全部 attempt 字段、failed/cancelled 和 accepted/response-received/outcome-unknown，以及 active task/run/publication/capacity 与 generation-unfrozen 的 fail-closed/source-unchanged 回归。
- 当前定向结果：m91 `12/12`、m81+m103 `54/54`、m105 `1/1`，合计 `67/67`，均 exit 0；writer manifest `295/256/200/95/0`，source tree `7f7942be29d4e342ec079439468d1136dd2fc2f2de5d4771a64cd944020330bb`。
- 补测后同一 Reviewer 确认原两项 P2 和随后发现的文档同步 P2 全部关闭；最终覆盖 `17/17` files、`55/55` hunks，`P0=0 / P1=0 / P2=0 / GO`，保护文件访问 0。当前只允许执行一次变更后 formal full；通过后才可发布和继续生产 R10。
- 变更后 formal full 仅执行一次并通过：`127` specs、`1229/1229 PASS`、0 failed、0 skipped、0 retries/blocked/reportErrors，exit `0`；Node/npm `22.23.1/10.9.8`，source/snapshot SHA-256 `3b1fcd369e292c272183e3db7ee8316a38f700b96847f83e0370d2a0ebcbb9ea`，4173 listener hash `24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244` unchanged。post-receipt m38 `19/19 PASS`；同一 Reviewer 对当前 `17/17` files、`56/56` hunks完成只读收口，`P0/P1/P2=0/0/0 / GO`，保护文件访问 0。R9=`PASS`，进入 R10；不得重复 full。
