# Unboundry Canvas 文档写入边界解耦验收矩阵

状态：`V0_7_8_PUBLISHED_NOT_DEPLOYED / TARGET_VERSION_V0_7_9 / RELEASE_AND_REAL_PROVIDER_AUTHORIZED / R9_PASS / R10_READY`

日期：2026-09-03

配套方案：`spec/UNBOUNDRY_CANVAS_DOCUMENT_WRITE_BOUNDARY_DECOUPLING_PLAN_2026-09-03.md`

## 0. 这份矩阵怎么用

这不是“测试通过清单”，而是下一轮实施从开工到生产验收的逐项合同。任何人不得把文档里已经写清楚的要求标成实现通过，也不得用一次页面成功掩盖未执行的故障分支。

每一项都必须保留以下五个要素：

1. 唯一编号；
2. 被验证的行为或不变量；
3. 可判定的通过标准；
4. 必须留存的证据；
5. 当前状态。

## 1. 状态定义

| 状态 | 含义 |
|---|---|
| `DOC_PASS` | 事实或合同已在方案中明确；不代表代码、测试、发布或生产通过。 |
| `NOT_RUN` | 尚未实施或尚未执行验收。 |
| `PENDING` | 已开始但证据不完整，不能算通过。 |
| `TARGETED_PASS` | 冻结前定向自动化或可复现检查已通过；仍须独立 Review 与唯一 formal full，不能冒充最终候选或生产通过。 |
| `AUTO_PASS` | 在冻结候选代码上由自动化或可复现检查通过。 |
| `PRODUCTION_AUTO_PASS` | 在已授权生产版本上，由只读或明确授权的可计数验证通过。 |
| `USER_RECHECK` | 技术证据通过，但仍需要用户在真实产品里复核。 |
| `USER_PASS` | 用户明确确认通过。 |
| `NO_GO` | 当前已知失败，或权限前置条件不成立，禁止进入下一阶段。 |
| `N/A_WITH_REASON` | 经 Review 证明不适用，并记录具体理由；不得仅写 N/A。 |

状态升级规则：

- `DOC_PASS` 不能直接升级为 `PRODUCTION_AUTO_PASS`；中间必须有实现、冻结候选、自动化证据和发布授权；
- 任一 P0 项为 `NO_GO/PENDING/NOT_RUN`，不得版本化、发布或真实点击；
- 任一 P1 项为 `NO_GO/PENDING/NOT_RUN`，不得冻结候选；
- P2 可延期，但必须有 owner、原因和不会破坏本方案不变量的证据；
- 同一条证据只能证明它实际覆盖的层，不能把单测通过写成生产通过；
- 真实 Provider 请求只能在单独授权后执行，且同一个 outcome 不明任务不得二次请求。

## 2. 证据格式

每个实施回执必须按验收项记录：

```text
ID:
STATUS:
COMMAND_OR_ACTION:
ENVIRONMENT:
CODE_IDENTITY:
FIXTURE_OR_OBJECT:
EXPECTED:
ACTUAL:
REQUEST_IDS:
ARTIFACT_PATHS:
REVIEWER:
TIMESTAMP:
RESIDUAL_RISK:
```

涉及网络的证据必须分别计数，禁止只写“没有多余请求”：

- Canvas GET；
- Canvas PUT/command POST；
- workflow create；
- generation task create/admission；
- Provider boundary insert；
- Provider HTTP attempt；
- OSS/publication；
- reconcile/status GET；
- 409、4xx、5xx；
- 浏览器重试或重复提交。

## 3. A 组：权限、身份与基线

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-001 | P0 | 当前工作树身份 | `pwd`、Git root、branch、HEAD、origin 全部明确且相互一致。 | 原始命令与输出 | `DOC_PASS` |
| CWB-002 | P0 | 工作树污染检查 | 开工前记录全部 tracked/untracked 改动；未知重叠改动必须停工。 | `git status --short` | `AUTO_PASS` |
| CWB-003 | P0 | 生产身份 | 当前生产版本、commit、schema、服务实例身份可交叉核对。 | release/health/部署证据 | `DOC_PASS` |
| CWB-004 | P0 | 目标对象身份 | 目标 Canvas、group、测试用户/租户边界明确，不误操作其他对象。 | 对象 ID 清单 | `DOC_PASS` |
| CWB-005 | P0 | 当前失败基线 | 保留 v0.7.7 刷新 4 PUT、revision 71→75、graphRevision 46→50 的原始回执。 | production receipt | `DOC_PASS` |
| CWB-006 | P0 | 权限边界 | 当前 Goal 已明确授权 R0-R10、目标版本、GitHub/发布/生产、普通 Chrome、真实 Provider/OSS 与费用；仍不得把技术证据冒充用户复核。 | 用户最新授权与方案边界 | `DOC_PASS` |
| CWB-007 | P0 | Goal 状态 | 不从历史 Goal、旧版本授权或聊天摘要恢复实施权限。 | current-state/会话记录 | `DOC_PASS` |
| CWB-008 | P0 | 禁止文件边界 | 两个永久保护 JSON 不读、不 stat、不 hash、不复制、不修改、不 stage。 | 操作记录与 diff 范围 | `DOC_PASS` |
| CWB-009 | P1 | 版本规则 | 当前 Goal 锁定目标 `v0.7.8`；只有远端占用检查发现冲突时才按 Goal 使用下一个空闲普通 patch，不使用 hotfix 后缀。 | release checklist | `DOC_PASS` |
| CWB-010 | P0 | 生产副作用冻结 | 在正式 release gate 前，无 SSH、部署、服务启停、生产写、Provider/OSS 请求。 | 操作审计 | `AUTO_PASS` |
| CWB-011 | P1 | 测试环境隔离 | 自动化使用临时数据、动态 loopback；不得使用生产路径、4173、真实 Provider 或 OSS。 | 命令、端口、fixture 记录 | `AUTO_PASS` |
| CWB-012 | P1 | 基线可复现 | 修复前目标 fixture 能稳定复现被动媒体事件导致 durable write 的失败。 | 预期红测输出 | `AUTO_PASS` |

## 4. B 组：Writer 全量盘点与字段所有权

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-013 | P0 | 客户端 writer 分母 | 在冻结 HEAD 以 manifest 记录的命令、glob、排除规则和源码 hash 重扫；manifest 的 client 产品命中是唯一正式分母，探索阶段数字不作验收依据。 | machine-readable manifest + commands + baseline hash | `AUTO_PASS` |
| CWB-014 | P0 | 产品 writer 零遗漏 | R0 实际产品分母每个都有文件、symbol/anchor、owner、state class、target command、主/删除阶段；classified=denominator。 | manifest denominator/denominator | `AUTO_PASS` |
| CWB-015 | P1 | 测试 writer 盘点 | 测试 helper/fixture 中的 writer 与生产 writer 分开标记，不能混入分母。 | manifest 分类 | `AUTO_PASS` |
| CWB-016 | P0 | 服务端 writer 分母 | 在冻结 HEAD 重扫；manifest 的 server SQL/revision/lifecycle 命中是唯一正式分母，全部进入逐项归属，探索阶段数字不作验收依据。 | server manifest + commands + baseline hash | `AUTO_PASS` |
| CWB-017 | P0 | SQL writer 零遗漏 | 所有 Canvas nodes/edges/viewport/revision/graphRevision 写 SQL 都标明入口与事务。 | SQL writer 清单 | `AUTO_PASS` |
| CWB-018 | P0 | Durable User 字段 | 标题、提示词、用户尺寸/位置/边、group/playlist 结构、用户工具结果等逐字段归属。 | ownership table + types | `NOT_RUN` |
| CWB-019 | P0 | Durable Server 字段 | task/run/result/publication/ownership/projection 等字段只能由服务端权威路径写。 | ownership table + server tests | `NOT_RUN` |
| CWB-020 | P0 | Ephemeral View 字段 | selected、hover、测量、媒体 intrinsic size、loading、呼吸灯、轮询显示等不入 document。 | view-state schema + tests | `NOT_RUN` |
| CWB-021 | P1 | Migration 字段 | legacy 标记、迁移版本、兼容来源与退出条件独立描述。 | migration model | `NOT_RUN` |
| CWB-022 | P0 | 未知字段处理 | 任一未分类字段默认禁止持久化，不允许猜 owner。 | fail-closed test | `NOT_RUN` |
| CWB-023 | P0 | 一字段一 owner | 同一 durable 字段不得同时允许 browser 与 server 无条件写。 | static ownership validation | `NOT_RUN` |
| CWB-024 | P1 | 派生字段 | 可从权威数据重算的字段标成 derived；不得因渲染重算自动 durable save。 | derivation inventory | `NOT_RUN` |
| CWB-025 | P1 | 尺寸语义 | 用户设定尺寸、持久化布局尺寸、媒体原始尺寸、运行时测量四者类型可区分。 | type/fixture evidence | `NOT_RUN` |
| CWB-026 | P0 | 连接拓扑语义 | create/delete/connect/group/ungroup/paste/playlist 各有原子 operation、受影响子图 digest、显式删除/级联/前置条件；不使用整图替换。 | command definition + concurrency tests | `NOT_RUN` |
| CWB-027 | P1 | viewport 语义 | viewport 是否 durable、何时保存、是否 debounce 有唯一合同。 | ownership + no-op tests | `NOT_RUN` |
| CWB-028 | P1 | 资源引用语义 | 本地临时 URL、上传 asset ID、published URL、Provider URL 不混为同一 durable 字段。 | asset state model | `NOT_RUN` |

## 5. C 组：Command、revision、CAS 与 Mutation Gateway

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-029 | P0 | Typed command 封闭集合 | 现代客户端只用 create/field-change/topology/layout/upload/edited-result；create 三项 baseline 必须为 null 且不走 existing freshness/high-water 拒绝；full graph replace 与任意 JSON patch 不在公开 union。 | command union + create/OpenAPI negative tests | `NOT_RUN` |
| CWB-030 | P0 | 字段白名单 | 每种 command 只能修改自己的字段集合，越权字段 fail-closed。 | negative contract tests | `NOT_RUN` |
| CWB-031 | P0 | 身份绑定 | 唯一 route `/api/canvases/{canvasId}/commands`；canvasId 仅取 path，body 禁止 canvasId/target/actor/account/owner/tenant，handler 仅以 auth+ownership 绑定且不做 body/path ID 比对。 | route/OpenAPI/authz integration | `NOT_RUN` |
| CWB-032 | P0 | base revisions | typed command 携带 base document/input revisions；同 session 旧 sequence 拒绝，跨 session 不做全局 stale CAS，而是在最新 document 重放并保持 DATA-005。 | same/cross-session request tests | `NOT_RUN` |
| CWB-033 | P0 | operationId 幂等 | 同payload replay返回不可变原outcome/originalRequestId/operation revisions及新的current requestId、当前document/revisions/current-valid loadToken；token在revision/epoch未变时可相同；APPLIED/NO_OP为200，REJECTED_CONFLICT保持原409/code。 | success/conflict duplicate + crash/restart test | `NOT_RUN` |
| CWB-034 | P0 | payload hash 冲突 | canonical payload hash 被 durable 保存；相同 operationId 配不同 payload 稳定 409 `CANVAS_OPERATION_REUSED` 并留审计。 | negative idempotency + DB receipt | `NOT_RUN` |
| CWB-035 | P0 | no-op 规则 | before/after `canvasDocumentFingerprint` 与 `canvasInputGraphFingerprint` 都相同才是 NO_OP；不更新 Canvas row、updated_at、两类 revision，只可同事务写 receipt/high-water。 | DB before/after + receipt test | `NOT_RUN` |
| CWB-036 | P0 | document revision | 完整 durable document hash 变化时 document revision 恰好增 1；layout/viewport/server projection 单独变化也必须增加，多表原子命令只增 1。 | transaction + layout/projection golden tests | `NOT_RUN` |
| CWB-037 | P0 | graphRevision | input hash 变化时才恰好增 1；layout/viewport/server result/view 不增加，prompt/topology/input asset 增加。 | per-command + golden-vector tests | `NOT_RUN` |
| CWB-038 | P0 | revision 纯函数 | server 分别计算 before/after document hash 与 input hash，绝不互相比；覆盖 no-op、layout-only、server-projection-only、input-only，决策不依赖 React 事件顺序。 | two-fingerprint pure tests | `NOT_RUN` |
| CWB-039 | P0 | DATA-005 并发 | field changes 只触及显式 path（set/delete）；跨 tab 不同字段保留、同 user 字段最后成功者生效；拓扑只在非法 endpoint/id/parent 等安全前置失败时409。 | field/delete/topology two-tab tests | `NOT_RUN` |
| CWB-040 | P0 | 单事务 | 授权、receipt lookup、读取、重放/diff、安全前置、写入、revision、receipt/审计在同一数据库事务。 | transaction fault instrumentation | `NOT_RUN` |
| CWB-041 | P0 | server gateway 唯一入口 | typed POST、legacy PUT/create/projection adapter、terminal detach 与所有 server writer 最终进统一 transaction gateway/审计例外。 | call graph + static gate | `NOT_RUN` |
| CWB-042 | P0 | 兼容 PUT 收口 | 当前 `PUT /api/canvas/{canvasId}` 仅在 exact header `X-Unboundry-Canvas-Write-Contract: legacy-put-v1`+完整tuple时派生receipt并先于high-water核对；非法值不降级；无exact proof旧sequence写稳定拒绝receipt并GET reconcile；modern create 的 null baseline/nullable-CHECK receipt/并发、projection与无capability观察窗均固定。 | route/header/ABA/response-loss/restart/parser/create/receipt/projection tests | `NOT_RUN` |
| CWB-043 | P0 | topology 原子性 | 显式 operation 的新增/删除/级联/edge/parent/playlist 要么全成功要么全回滚；无关并发保留，非法前置不复活旧快照。 | fault + two-tab DB tests | `NOT_RUN` |
| CWB-044 | P1 | 返回合同 | command-v1与capability PUT及detach的body/header含requestId；无capability旧PUT保留body且header含requestId；成功/409 replay union、原/当前revision/current authoritative document/current-valid loadToken明确，token不强制变化。 | OpenAPI + all-route replay/API/UI snapshot | `NOT_RUN` |
| CWB-045 | P1 | 审计字段 | 每个 durable mutation 留 commandType、operationId、actor、canvas、revision、结果。 | structured logs | `NOT_RUN` |
| CWB-046 | P1 | 重试合同 | 仅对可证明幂等、未获结论的 command 重试；指数退避且有上限。 | retry tests | `NOT_RUN` |
| CWB-047 | P0 | 409 不误报成功 | 仅 operation reuse、同 session superseded、lock/topology/server ownership/media 等真实冲突显示失败；跨 tab 普通 stale 不误报 409。 | UI/network integration | `NOT_RUN` |
| CWB-048 | P0 | 409 不重复提交 | 可重放失败只用原 operationId+原 payload 核对；需要用户形成新意图时才创建新 operation，不能变体风暴。 | request/receipt trace | `NOT_RUN` |
| CWB-049 | P1 | 空队列稳定 | 无 durable command 时 persistence controller 绝不发请求；旧 PUT adapter 也不能由 render state触发。 | fake timer/network test | `NOT_RUN` |
| CWB-050 | P1 | 有界队列 | 页面退出、断网、慢响应时 operation journal有界；同 payload复用原operationId，不能复制；legacy失败只GET核对。 | state-machine/restart tests | `NOT_RUN` |

## 6. D 组：CanvasSurface、hydration 与 clean/dirty 页面

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-051 | P0 | document/view 分离 | `CanvasSurface` 不再把 ReactFlow 的每次节点对象变化视为 durable document 变化。 | source review + tests | `NOT_RUN` |
| CWB-052 | P0 | 首次 hydration | 服务器文档装载仅建立 canonical document/view model，0 次 durable save。 | network count test | `NOT_RUN` |
| CWB-053 | P0 | StrictMode | 开发 StrictMode 双调用不会生成 durable command 或重复网络写。 | component integration | `NOT_RUN` |
| CWB-054 | P0 | clean refresh | 无本地 durable draft 的干净刷新观察窗内 Canvas PUT/command POST 为 0。 | production-shape trace | `NOT_RUN` |
| CWB-055 | P0 | clean delayed media | 图片/音视频在观察窗后才完成加载仍为 0 durable write。 | delayed event test | `NOT_RUN` |
| CWB-056 | P0 | dirty page 定义 | 只有已被用户 durable action 标记的 draft 才是 dirty，媒体/测量/轮询不能标 dirty。 | state tests | `NOT_RUN` |
| CWB-057 | P0 | dirty refresh 恢复 | 有本地 durable draft 时恢复路径明确显示待保存/冲突，不能伪装成 clean。 | browser integration | `NOT_RUN` |
| CWB-058 | P0 | dirty + server result | 未保存的显式 field/topology command 重放到含 server projection 的最新 document；未触及字段与 server result 均保留。 | two-writer changed-path scenario | `NOT_RUN` |
| CWB-059 | P0 | dirty + conflict | 同 user path按DATA-005；显式delete不等于缺失；node/kind/lock/asset/topology前置失败时不复活快照并保留可恢复意图。 | delete/same-field/topology conflict fixture | `NOT_RUN` |
| CWB-060 | P1 | load token | 旧 load/hydration callback 不能污染新 Canvas 或新 revision。 | stale callback test | `NOT_RUN` |
| CWB-061 | P1 | save session | 上一 Canvas 未完成 save response 不能落到当前 Canvas。 | navigation race test | `NOT_RUN` |
| CWB-062 | P1 | unsubscribe | unmount 后轮询、媒体回调、observer 不再派发 durable 或 view action。 | leak/race test | `NOT_RUN` |
| CWB-063 | P1 | selection | 选中/取消、框选、多选、焦点切换为纯 view 行为，0 durable write。 | UI/network test | `NOT_RUN` |
| CWB-064 | P1 | drag preview | 拖动中的高频位置为 view preview；结束时最多一个 durable command。 | event/request count | `NOT_RUN` |
| CWB-065 | P1 | resize preview | resize 中为 view preview；结束时只在实际变化时提交一次。 | event/request count | `NOT_RUN` |
| CWB-066 | P1 | viewport | 仅 user-origin `onMoveEnd`/明确 user-fit-view 一手势一 operation；hydration、observer、程序化 fit/聚焦/动画 0 write；同值 no-op。 | gesture/request/revision test | `NOT_RUN` |

## 7. E 组：文字、图片、视频、音频与本地上传节点

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-067 | P0 | Text 被动渲染 | mount、测量、字体加载、placeholder 不产生 durable command。 | component/network test | `NOT_RUN` |
| CWB-068 | P0 | Text 用户编辑 | 一次提交产生最多一个 typed command，值不变为 no-op。 | command/revision test | `NOT_RUN` |
| CWB-069 | P1 | Text composition | 中文输入法 composition 中不重复保存，确认后语义提交一次。 | IME integration | `NOT_RUN` |
| CWB-070 | P1 | Text blur/Enter | blur、快捷键、按钮不会对同一编辑产生双提交。 | UI event test | `NOT_RUN` |
| CWB-071 | P0 | Image `onLoad` | 图片像素加载只更新 ephemeral intrinsic/render state，0 durable write。 | delayed onLoad trace | `NOT_RUN` |
| CWB-072 | P0 | Image persisted style | 已持久化 style width/height 被视为确定布局，不被 intrinsic size 覆盖。 | regression fixture | `NOT_RUN` |
| CWB-073 | P0 | Image deferred hydration | deferred hydration 不改 durable style/revisions。 | hydration test | `NOT_RUN` |
| CWB-074 | P1 | Image error/retry | broken URL、重试、缓存命中/未命中均不产生 durable write。 | network/media matrix | `NOT_RUN` |
| CWB-075 | P0 | Video metadata | `loadedmetadata`/duration/dimensions 只更新 view state，0 durable write。 | component/network test | `NOT_RUN` |
| CWB-076 | P1 | Video playback state | play/pause/currentTime/buffering/ended 不进 durable document。 | playback trace | `NOT_RUN` |
| CWB-077 | P0 | Audio decode | metadata/decode/duration/waveform 计算不触发 durable save。 | audio integration | `NOT_RUN` |
| CWB-078 | P1 | Audio playback state | play/pause/currentTime/volume 可按产品合同保持 ephemeral，0 durable save。 | playback trace | `NOT_RUN` |
| CWB-079 | P0 | 本地上传选择 | 选择文件只建立本地 upload state，不把 blob URL 当永久资源保存。 | upload state test | `NOT_RUN` |
| CWB-080 | P0 | 上传 publication | 只有服务器确认的 asset identity 才进入 durable command。 | upload integration | `NOT_RUN` |
| CWB-081 | P0 | 上传重复事件 | input change、progress、完成回调、retry 对同一文件不会重复建资产/重复提交。 | request count test | `NOT_RUN` |
| CWB-082 | P0 | 上传失败/取消 | 失败或取消不留下指向无效资产的 durable document。 | negative upload test | `NOT_RUN` |
| CWB-083 | P1 | 大文件/慢上传 | 导航、超时、重试时状态可恢复且不跨 Canvas 落盘。 | race/fault test | `NOT_RUN` |
| CWB-084 | P1 | URL 撤销 | object URL 生命周期正确，撤销不会改变 durable state。 | lifecycle test | `NOT_RUN` |
| CWB-085 | P0 | 图片工具 crop | crop 输入、输出资产、节点替换通过审定 command/asset 合同，失败不半写。 | imageTools integration | `NOT_RUN` |
| CWB-086 | P0 | 图片工具 edit | edit/mask/upscale 等入口不绕过 gateway，不信任临时 URL。 | call graph + tests | `NOT_RUN` |
| CWB-087 | P1 | 图片工具取消 | 取消/关闭 modal 0 durable write。 | UI/network test | `NOT_RUN` |
| CWB-088 | P0 | 媒体类型隔离 | image/video/audio 结果不会写入错误节点 kind 或错误字段。 | negative projection tests | `NOT_RUN` |
| CWB-089 | P0 | 本地节点真实行为 | text/image/video/audio/local upload 五类生产形状 fixture 均可新增、编辑、保存、重载。 | E2E artifacts | `NOT_RUN` |
| CWB-090 | P1 | accessibility 事件 | 键盘/辅助操作与指针操作使用同一 command，不生成额外写。 | interaction tests | `NOT_RUN` |

## 8. F 组：Group、Playlist 与拓扑操作

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-091 | P0 | create group | group、成员关系、布局一次原子提交；失败全回滚。 | transaction/E2E | `NOT_RUN` |
| CWB-092 | P0 | ungroup | 解组不丢节点/边/结果引用，revision 只增一次。 | before/after snapshot | `NOT_RUN` |
| CWB-093 | P0 | group membership | 加入/移出成员经过拓扑 command，不能多组件裸写。 | static + integration | `NOT_RUN` |
| CWB-094 | P0 | delete group | 删除语义明确区分只删容器、级联删除；不得靠 UI 时序决定。 | command contract tests | `NOT_RUN` |
| CWB-095 | P0 | playlist ordering | 排序原子、稳定、幂等；相同顺序 no-op。 | ordering tests | `NOT_RUN` |
| CWB-096 | P1 | layout computation | 自动布局预览不保存；用户确认后一个 command。 | UI/request test | `NOT_RUN` |
| CWB-097 | P0 | edge create/delete | 边变更与执行输入 revision 同步，重复边/悬空边按合同拒绝。 | graph invariant tests | `NOT_RUN` |
| CWB-098 | P0 | node delete | 节点、边、group membership、task/result 引用按事务合同处理。 | deletion integration | `NOT_RUN` |
| CWB-099 | P1 | copy/paste | 复制粘贴生成新 identity，不复制 server ownership/task boundary。 | E2E snapshot | `NOT_RUN` |
| CWB-100 | P1 | undo/redo | 若当前产品保留 undo/redo，其动作走相同 typed command 与冲突规则。 | history integration | `NOT_RUN` |

## 9. G 组：Workflow、Task、Provider、Result 与 Projection

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-101 | P0 | 单次 workflow create | 用户一次点击最多创建一个 workflow run；重复 UI 事件被 admission 幂等挡住。 | request/DB trace | `NOT_RUN` |
| CWB-102 | P0 | 一节点一 task | 每个被接受节点最多一个逻辑 generation task。 | task rows + trace | `NOT_RUN` |
| CWB-103 | P0 | ownership/result identity | run/task/node/kind/ownership/input/model-contract 与 committed text/asset digest 由服务端 canonical 算法生成唯一 result proof；客户端 key 仅作 legacy hint。 | golden vectors + correlation audit | `NOT_RUN` |
| CWB-104 | P0 | Provider boundary 先记录 | 发 Provider HTTP 前，唯一 attempt/boundary 已在本地事务持久化。 | DB + HTTP ordering | `NOT_RUN` |
| CWB-105 | P0 | 不虚构跨系统原子性 | 文档与实现明确 Provider HTTP 不在 SQLite 事务内，以 evidence/reconcile 收口。 | review + fault tests | `NOT_RUN` |
| CWB-106 | P0 | 重复 Provider 阻断 | retry/restart/double-click 不产生第二个已禁止的 Provider POST。 | fake Provider counts | `NOT_RUN` |
| CWB-107 | P0 | outcome unknown | 响应丢失且可能计费时标成 `OUTCOME_UNKNOWN_BILLING_RISK`，保留证据且不重发。 | fault-injection evidence | `NOT_RUN` |
| CWB-108 | P0 | result commit | Provider 结果、result asset、task settlement 在既有安全合同下幂等提交。 | transaction tests | `NOT_RUN` |
| CWB-109 | P0 | publication fence | 资产 publication 成功前不把不可信/临时 URL 投影到 durable Canvas。 | publication fault tests | `NOT_RUN` |
| CWB-110 | P0 | server projection | 结果投影由服务端构造；gateway 接收调用方 transaction handle，不自行 commit，并与 projection_state 同事务。 | call graph + transaction fault tests | `NOT_RUN` |
| CWB-111 | P0 | projection no-op | 已投影相同结果的 replay 为 no-op，不增 revision、不重复通知。 | replay tests | `NOT_RUN` |
| CWB-112 | P0 | single/group 共用合同 | 单节点与 group workflow 使用同一 result ownership/commit/projection 不变量。 | shared contract tests | `NOT_RUN` |
| CWB-113 | P0 | partial group success | 部分节点失败不覆盖已成功结果；组状态能准确结算。 | mixed-outcome E2E | `NOT_RUN` |
| CWB-114 | P0 | dependency scheduling | DAG 依赖只在前置结果可用时 admission；不因 Canvas UI state 误触发。 | headless executor tests | `NOT_RUN` |
| CWB-115 | P0 | restart recovery | 服务重启后从 server evidence 恢复，不依赖浏览器 localStorage 判断完成。 | restart E2E | `NOT_RUN` |
| CWB-116 | P0 | lost response recovery | Provider/OSS/Canvas response 丢失时 reconcile 查证已有 outcome，不盲重做。 | fault matrix trace | `NOT_RUN` |
| CWB-117 | P0 | slow Provider | 慢响应期间轮询/呼吸灯可更新，但 0 Canvas durable write。 | timer/network trace | `NOT_RUN` |
| CWB-118 | P0 | task settlement | 每个已越过 Provider boundary/`accepted` attempt 对应的 generation task 都按各自规范状态收口；无永久 preparing/running 假状态。 | DB invariant query | `NOT_RUN` |
| CWB-119 | P0 | UI 投影 | Canvas 只显示服务器权威结果/状态；刷新后与任务事实一致。 | E2E before/after | `NOT_RUN` |
| CWB-120 | P0 | 无错误误报 | 成功或可恢复状态不弹“服务器未读取到”类误报；错误必须有真实 error code/request ID。 | UI + structured log | `NOT_RUN` |
| CWB-121 | P1 | 状态文案 | command receipt/wire、generation task、workflow run/node、projection、Provider attempt 使用各自固定枚举和映射；UI 不混淆 `success`、`accepted`、`outcome-unknown`、`conflict`。 | namespaced state table + UI tests | `NOT_RUN` |
| CWB-122 | P1 | 呼吸灯 | 呼吸灯由 ephemeral/task state 驱动；存在时不写 Canvas，终态后准确停止。 | visual state + network trace | `NOT_RUN` |

## 10. H 组：Legacy 盘点、兼容与退出

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-123 | P0 | legacy census | 只读统计 A已投影、B投影待收口、C exact legacy terminal、D不确定、T在途五类数量/状态/年龄/ownership。 | census report | `NOT_RUN` |
| CWB-124 | P0 | A 类已结算 | 已正确 settlement+projection 的对象保持只读，无需迁移写。 | sample/aggregate proof | `NOT_RUN` |
| CWB-125 | P0 | B 类可证明恢复 | 有 server evidence 可安全补 projection 的对象走幂等 server reconciliation。 | dry-run + applied counts | `NOT_RUN` |
| CWB-126 | P0 | C 类 exact legacy | legacy terminal 只有具备 exact task/ownership/result/detach proof 才由 server command 幂等收口。 | exact reconciliation evidence | `NOT_RUN` |
| CWB-127 | P0 | D 类不确定计费 | 证据不足或可能计费的对象隔离为人工审查，不自动重发。 | quarantine report | `NOT_RUN` |
| CWB-128 | P0 | 浏览器 projection 退出 | manifest逐项覆盖 groupResultProjection、legacyTerminalGenerationReconciler、WorkflowExecutionProvider、workflowNodeExecutors、groupRunPersist与transport；current build modern调用=0。 | caller manifest + route counters + E2E | `NOT_RUN` |
| CWB-129 | P0 | server legacy sweep 保留 | T在途继续server lifecycle；C exact detach、D quarantine；legacyTerminal producer只提候选且server重分类，不因解耦误删。 | census + class/lifecycle/code review | `NOT_RUN` |
| CWB-130 | P1 | 旧 route 观察窗 | 指标按clientBuild/capability/route/callerSymbol/serverClass(A/B/C/D/T)/operation/runId/taskId/namespaced outcome/requestId分桶；未登记caller或modern命中legacy route fail-closed。 | route allowlist + metrics/log report | `NOT_RUN` |
| CWB-131 | P1 | 不可逆迁移禁令 | 默认不批量重写旧 Canvas；任何不可逆数据动作须单独计划与授权。 | migration decision record | `DOC_PASS` |
| CWB-132 | P0 | legacy 退出证据 | 删除兼容代码前有current-build modern=0、历史C逐项allowlist、所有producer零未知、对象census、回滚点和独立Review。 | retirement receipt | `NOT_RUN` |

## 11. I 组：Schema、兼容性与数据安全

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-133 | P0 | schema 不预判 | R1.5 前不假定 schema42 足够，也不擅自分配新 schema 号；当前 TEMP high-water 不算 durable receipt。 | code evidence + decision record | `DOC_PASS` |
| CWB-134 | P0 | schema 决策门 | schema42 分支必须指出现有 durable receipt 位置并通过同 payload/异 payload/crash/restart/同事务测试，否则判定 schema change required。 | capability spike evidence | `NOT_RUN` |
| CWB-135 | P0 | schema change 硬停止 | 若需任何 schema change，运行时施工停止；另审 table/constraint/migration/backup/restore/downlevel/retention 并获授权，版本号届时核对序列后确定。 | stop + migration review receipt | `NOT_RUN` |
| CWB-136 | P0 | 向后读取 | 新代码能读取现存 schema42 Canvas/task/result，不要求先批量改数据。 | compatibility tests | `NOT_RUN` |
| CWB-137 | P0 | 前后版本回滚 | 若无 schema change，previous release 能重新读取未变形数据。 | locked restore drill | `NOT_RUN` |
| CWB-138 | P0 | 备份精确性 | 上线前 backup 来自 exact production DB/object state，且能 fresh restore 验证。 | backup/restore receipt | `NOT_RUN` |
| CWB-139 | P1 | document/input canonicalization | 同一字段 descriptor 分别投影完整 durable document 与 input 子集；对象 key、集合/有序数组、缺省值与 SHA-256 golden vectors稳定；Ephemeral 不进两者，server result 只进 document。 | server/client two-fingerprint golden tests | `NOT_RUN` |
| CWB-140 | P0 | server-owned 保留 | 用户 command 永不删除/覆盖未知 server-owned 新字段。 | forward-compat tests | `NOT_RUN` |

## 12. J 组：静态门、测试与故障注入

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-141 | P0 | AST 裸 setter 门 | 业务组件不能用 raw `setNodes/setEdges` 修改 durable/server-owned 字段。 | AST report 0 violation | `AUTO_PASS` |
| CWB-142 | P1 | 合法 view setter | ReactFlow 内部/view-only setter 可保留，但必须有 allowlist 与理由。 | allowlist review | `AUTO_PASS` |
| CWB-143 | P0 | fetch/PUT 门 | 客户端 Canvas write endpoint 只能从 persistence adapter/command client 调用。 | static call graph | `AUTO_PASS` |
| CWB-144 | P0 | server SQL 门 | Canvas durable SQL writer 只能从审定 gateway/transaction path 到达。 | static call graph | `AUTO_PASS` |
| CWB-145 | P0 | server-owned 类型门 | Browser-facing command type 不含 result/task/publication/ownership setter。 | compile-time negative test | `AUTO_PASS` |
| CWB-146 | P1 | source coverage manifest | manifest 固定路径，记录命令/glob/exclusion/parser/source hash；新增/改名自动进入，bootstrap/migration/delete/test/legacy 例外逐项解释。 | manifest schema + diff | `AUTO_PASS` |
| CWB-147 | P0 | 单元测试层 | ownership、diff、revision、command validation、idempotency 纯函数全部通过。 | exact commands/exit 0 | `TARGETED_PASS` |
| CWB-148 | P0 | 组件测试层 | 五类节点、group/playlist、imageTools 的被动/用户事件矩阵通过。 | exact commands/exit 0 | `TARGETED_PASS` |
| CWB-149 | P0 | 服务集成层 | gateway、CAS、transaction、projection、legacy reconciliation 通过。 | exact commands/exit 0 | `TARGETED_PASS` |
| CWB-150 | P0 | fake Provider E2E | single/group、四媒体、失败、慢响应、丢响应、重启，零真实费用。 | fake request ledger | `TARGETED_PASS` |
| CWB-151 | P0 | 生产形状 fixture | fixture 含持久化图片尺寸、local upload、text/image/video/audio、group DAG。 | fixture manifest | `NOT_RUN` |
| CWB-152 | P0 | refresh 长观察窗 | 冷/暖缓存均在全部媒体/hydration settle 后保持 30 秒静默，总上限 120 秒；延迟媒体和 timer flush 后仍 0 durable write。 | timed network/DB timeline | `NOT_RUN` |
| CWB-153 | P0 | 409 矩阵 | user/user、user/server、stale tab 三类冲突无丢数据、无风暴、无误报。 | concurrent E2E | `NOT_RUN` |
| CWB-154 | P0 | 网络故障矩阵 | request before-send/after-send/response-loss/timeout/retry 分支均有唯一结论。 | fault injection artifacts | `NOT_RUN` |
| CWB-155 | P0 | 进程故障矩阵 | gateway、Provider、publication、projection 各关键点 crash/restart 可收口。 | restart traces | `NOT_RUN` |
| CWB-156 | P1 | 资源/内存 | observer、object URL、poll timer、request queue 无明显泄漏或重复订阅。 | leak test/profile | `NOT_RUN` |
| CWB-157 | P1 | 性能预算 | 拖动/resize 高频 view update 不引起网络/数据库放大。 | event vs write metrics | `NOT_RUN` |
| CWB-158 | P0 | 测试不重复 | 未有相关代码变化时不重复全套；失败先最小复现和最小子集。 | test ledger | `AUTO_PASS` |
| CWB-159 | P0 | 唯一 formal full | 候选冻结、定向层全绿后只执行一次项目规定的正式全套。 | full command/exit/identity | `AUTO_PASS` |
| CWB-160 | P0 | full 失败处理 | formal full 失败先归因并修最小范围；代码变更后按 gate 决定是否需新候选。 | failure closure record | `AUTO_PASS` |

## 13. K 组：可观测性、错误语义与用户体验

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-161 | P0 | correlation IDs | command-v1/capability PUT/detach成功错误body+header同requestId；无capability PUT至少header；internal projection trace继承/生成，并关联workflow/task/attempt/publication。 | all-route response + structured trace sample | `NOT_RUN` |
| CWB-162 | P0 | outcome 结构化 | UI 错误来自 server error code/state，不用模糊字符串猜测结果。 | API/UI mapping tests | `NOT_RUN` |
| CWB-163 | P0 | 保存提示真实性 | “已保存/保存失败/冲突/重试”与 server apply 结果一致。 | UI/network cross-check | `NOT_RUN` |
| CWB-164 | P0 | 生成提示真实性 | “准备/执行/发布/恢复/失败”与 task/server evidence 一致。 | UI/task cross-check | `NOT_RUN` |
| CWB-165 | P0 | 服务器未读取到错误 | 必须能凭 request ID 确定具体端点与根因；无法复现时明确 unknown，不猜。 | error catalog/log trace | `NOT_RUN` |
| CWB-166 | P1 | metrics 分桶 | clientBuild/capability/route/callerSymbol/serverClass(A/B/C/D/T)/operation/runId/taskId/outcome/requestId完整；outcome 使用 command/projection/task/legacy/view namespaced 固定枚举；current modern旧写、双写、unknown caller均0，legacy仅allowlist。 | schema/assertion tests + metrics snapshot | `NOT_RUN` |
| CWB-167 | P1 | 告警阈值 | refresh durable write、重复 operationId payload、Provider duplicate、projection backlog 有告警。 | alert config/test | `NOT_RUN` |
| CWB-168 | P1 | 隐私与 secret | 日志不记录 prompt 私密内容、密钥、完整 signed URL；request ID 可检索。 | log redaction review | `NOT_RUN` |
| CWB-169 | P1 | UI 不依赖调试工具 | 普通用户无需去 Provider/中转站找结果或理解内部 task。 | product E2E | `NOT_RUN` |
| CWB-170 | P1 | 一次点击原则 | 正常恢复自动完成；只有真实冲突/用户输入才要求额外动作。 | recovery E2E | `NOT_RUN` |

## 14. L 组：完整 Review、版本、发布与真实 Canvas 验收

| ID | 级别 | 验收行为 | 通过标准 | 必需证据 | 当前状态 |
|---|---:|---|---|---|---|
| CWB-171 | P0 | 候选冻结 | 所有计划内实现完成，diff/HEAD/生成物冻结，之后 Review 不与写入并行。 | candidate identity | `AUTO_PASS` |
| CWB-172 | P0 | 文件级 Review 分母 | 每个改动文件和每个 diff hunk 均被 Review，无抽样表述。 | reviewed files/hunks count | `AUTO_PASS` |
| CWB-173 | P0 | 调用链 Review | client event→command→gateway→DB→projection→Canvas 的关键分支逐链检查。 | call-chain checklist | `AUTO_PASS` |
| CWB-174 | P0 | Provider 分支 Review | 各 Provider/model/media 分支不改变 boundary、billing、settlement 不变量。 | provider matrix review | `AUTO_PASS` |
| CWB-175 | P0 | 独立 Review | 独立 reviewer P0=0、P1=0；P2 有 owner/处置。 | signed review report | `AUTO_PASS` |
| CWB-176 | P0 | 文档与实现一致 | Plan、Matrix、OpenAPI、types、receipt 不夸大、不互相矛盾。 | docs review | `AUTO_PASS` |
| CWB-177 | P0 | 实现授权 | 用户明确授权按本方案实施后方可改产品代码。 | 最新用户指令 | `DOC_PASS` |
| CWB-178 | P0 | 版本授权 | 用户明确给出下一版本号；不使用 hotfix 后缀、不自行递增。 | 最新用户指令 | `DOC_PASS` |
| CWB-179 | P0 | 上线授权 | 用户明确授权该冻结候选上线；实现授权不等于上线授权。 | 最新用户指令 | `DOC_PASS` |
| CWB-180 | P0 | 真实生成授权 | 用户明确授权真实 Provider/OSS 请求；上线授权不自动等于费用授权。 | 最新用户指令 | `DOC_PASS` |
| CWB-181 | P0 | GitHub release 顺序 | commit/push/PR/tag/release 只在相应授权后按 release 规则执行。 | Git/GitHub receipt | `NOT_RUN` |
| CWB-182 | P0 | exact backup/restore | 部署前 locked-exact backup、verify、fresh restore 全绿。 | deployment receipt | `NOT_RUN` |
| CWB-183 | P0 | 原子部署 | release 目录完整、依赖/构建完成后原子切换，不在 live 目录拼装。 | deploy trace | `NOT_RUN` |
| CWB-184 | P0 | health 不越权 | health/ready 只证明进程/数据库探测，不写成工作流通过。 | receipt wording review | `NOT_RUN` |
| CWB-185 | P0 | 生产 clean refresh | 指定 Canvas 冷缓存硬刷新+暖缓存普通刷新各一次；媒体/hydration settle 后 30 秒静默、总上限120秒；Canvas write/409/workflow/task/Provider/OSS均0。 | DevTools/server/DB 三方计数 | `NOT_RUN` |
| CWB-186 | P0 | refresh 门先行 | CWB-185 未通过时真实 group 点击必须保持 0。 | action count receipt | `NOT_RUN` |
| CWB-187 | P0 | 唯一真实点击 | refresh 门通过且获授权后，对指定 group 只点击一次。 | video/network/request IDs | `NOT_RUN` |
| CWB-188 | P0 | 无重复提交 | 一次真实点击仅一个 workflow run；每节点最多一次 boundary/Provider attempt。 | DB/provider trace | `NOT_RUN` |
| CWB-189 | P0 | 无 409/误报 | 真实执行期间无 Canvas 保存 409、无重复 save、无错误成功/失败 toast。 | browser/server trace | `NOT_RUN` |
| CWB-190 | P0 | 当前真实 DAG 结果 | 指定 Canvas 实际 7 text+3 image+1 video 按 DAG 正常 settlement/projection；不得冒充 audio/local-upload 生产证明。 | task/result/Canvas evidence | `NOT_RUN` |
| CWB-191 | P0 | 刷新后保持 | 真实执行完成后刷新，结果仍由 server document 正确呈现且 0 多余保存。 | before/after snapshot | `NOT_RUN` |
| CWB-192 | P0 | 回滚演练 | forward→previous→forward 能恢复服务与数据读取；不执行反向破坏性数据脚本。 | rollback receipt | `NOT_RUN` |
| CWB-193 | P0 | 生产结论分层 | release、refresh、workflow、Provider、Canvas projection、用户验收分别报告。 | final receipt | `NOT_RUN` |
| CWB-194 | P1 | 用户复核 | 技术通过后由用户确认网站正常生成工作流；不评价图片审美。 | 用户明确回复 | `NOT_RUN` |

## 15. 阶段门与退出条件

| 主阶段 | 唯一主验收 ID | 依赖阶段 | 退出条件 | 当前结论 |
|---|---|---|---|---|
| R0 身份/manifest/红测 | CWB-001~017 | 获得实现授权；身份一致；工作树可控 | manifest 分母与预期红测完整 | `TARGETED_PASS` |
| R1 合同/纯函数 | CWB-018~040 | R0 | 字段 owner、document/input 双 fingerprint、revision 状态机、DATA-005、receipt 合同测试通过 | `TARGETED_PASS` |
| R1.5 Schema/receipt 决策 | CWB-133~140 | R1 | schema42 不满足 durable receipt，已按授权实现 schema43；本地 migration/compatibility 证据通过，生产 backup/restore 仍属 R10 | `TARGETED_PASS` |
| R2 Server gateway | CWB-041~050 | R1.5 | gateway、旧 PUT 映射、receipt 和 server integration 通过 | `TARGETED_PASS` |
| R3 Server projection/legacy | CWB-103~116、CWB-118~119、CWB-123~127、CWB-129、CWB-131 | R2 | server result/transaction/legacy 分类通过 | `TARGETED_PASS` |
| R4 Client controller | CWB-051~066 | R2 | clean/dirty、view/document、session/navigation 通过 | `TARGETED_PASS` |
| R5 用户编辑入口 | CWB-067~070、CWB-079~100 | R4 | text/upload/tools/group/playlist/topology 通过 | `TARGETED_PASS` |
| R6 被动媒体事件 | CWB-071~078 | R4、R5 | image/video/audio 被动事件 0 durable write | `TARGETED_PASS` |
| R7 生成链/浏览器旧 writer 退出 | CWB-101~102、CWB-117、CWB-120~122、CWB-128、CWB-130、CWB-132 | R3、R6 | modern browser projection/detach 为0且无双写 | `TARGETED_PASS` |
| R8 故障/可观测性 | CWB-141~170 | R7 | 静态、故障、E2E、日志/指标通过 | `TARGETED_PASS` |
| R9 冻结/Review/full | CWB-171~176 | R8 | mandatory formal full 1227/1227、0 skipped、exit 0；最终独立 Review P0/P1/P2=0/GO | `PASS` |
| R10 版本/上线/canary | CWB-177~194 | R9；当前 Goal 已给齐权限 | 按顺序完成 release、刷新门、唯一真实点击与用户复核 | `IN_PROGRESS` |

每个 CWB row 只有上表一个主阶段；依赖阶段可以复用证据，但不能重复认领 owner。共享失败首先归属于主阶段，再阻断所有下游阶段。

## 16. 不允许的“伪通过”

以下说法不能作为本矩阵证据：

- “页面看起来没问题”；
- “单测过了，所以生产没问题”；
- “ready 是 200，所以工作流没问题”；
- “只看到一个 toast，所以没有重复请求”；
- “没有 409，所以没有多余保存”；
- “Provider 返回成功，所以 Canvas 已正确投影”；
- “刷新后结果还在，所以没有后台写入”；
- “完整跑了一次，所以所有分支都覆盖”；
- “图片不好看/好看”，因为本验收只判断工作流与系统行为，不判断提示词审美；
- “以前授权过 v0.7.x”，因为旧授权不能复用到新版本、上线或真实费用。

## 17. 当前文档结论

方案合同与早期冻结实现候选均已完成独立只读 Review。第二次 formal full 原始结果为 `1224 passed / 3 failed / 0 skipped`；3 条失败现已通过最小修复及定向复验关闭，并形成新的冻结候选。上一轮 Review GO 已被这些后续产品/测试变更失效，CWB-171..176 必须重新确认；发布、生产及 CWB-181..194 尚未执行。

本矩阵当前文档状态为：

`IMPLEMENTATION_CANDIDATE / TARGET_VERSION_V0_7_8 / RELEASE_AND_REAL_PROVIDER_AUTHORIZED / R9_FORMAL_FULL_FAILED_TARGETED_CLOSURE_PASS_REVIEW_PENDING`

这代表第二次 formal full 的失败已完成定向闭环；仍不代表当前候选 Review、最终 formal full、发布、生产 Canvas、真实 Provider/OSS 或用户复核通过。

### 17.1 文档独立 Review 回执

- 被审合同候选：Plan SHA-256 `2abc485c8e75d34ff92bc9d95964890ed95986d7497fc596e05bafc49586f140`；Matrix SHA-256 `4472daf980058608d3aaa854d23242fb2101b4713dc49cd97706ace5a99db2f6`；
- 覆盖分母：Plan 24/24 个二级章节；Matrix 194/194 个 CWB 行；主阶段唯一映射 194/194；
- 最终 findings：`P0=0 / P1=0 / P2=0`；结论 `DOCUMENT_GO`；
- Reviewer 只读且未运行产品测试/构建/生产/浏览器/Provider/OSS；两个永久保护 JSON 未访问；
- Review 后只新增状态与回执文字，不改变验收 ID、状态、阶段归属或合同要求；因此 CWB-175 等未来实现验收项继续保持 `NOT_RUN`。

### 17.2 实施候选定向证据（2026-09-04）

- writer manifest：扫描产品源文件 `295`，raw writer `253`；产品 writer `200`（client `131`、server `69`），例外 `92`，未分类违规 `0`；source tree hash `8d557e79...`。
- 最近冻结前定向复核：`m86-canvas-load-safety 83/83`；`m104-canvas-command-gateway + m3-persistence + m37-media-upload-transactions + m79-canvas-smoothness + m84-copy-paste 64/64`；`m105-canvas-writer-manifest 1/1`。
- 同一实现树更早定向层覆盖 `m2/m4/m10/m19/m20/m22/m27/m30/m33/m38/m41/m63/m81/m85/m87/m88/m91/m92/m94/m95/m100/m101/m103/m104-inc-gen-026/m106`；source coverage `514/514`（TS `462/462`、JS `52/52`）。
- 所有自动化均通过 safe runner，使用临时数据与动态 loopback；生产路径、端口 4173、真实 Provider/OSS、生产写入均为 `0`。
- 上述证据只支持阶段级 `TARGETED_PASS` 与明确标成 `AUTO_PASS` 的静态/隔离项；其余单行仍保留 `NOT_RUN`，待独立 Reviewer 按 194/194 行和完整 diff 分母核对后再升级，不能由绿色测试批量推定。

### 17.3 首轮实现 Review 与修复回执

- 唯一独立 Reviewer 覆盖 `139/139` files、`1847/1847` hunks、`250/250` 当时 writer entries、CWB `194/194`，首轮结论 `P0=0 / P1=2 / P2=2`；没有运行测试、生产或真实费用操作。
- 四项 finding 已分别修复：group parent/kind/move 前置、legacy user document + authoritative projection 原子合并、现代 edge handle 封闭校验、detach rollout-disabled OpenAPI schema。
- 修复后定向证据：`m104 + m20 + m85 = 42/42`、`m105 = 1/1`、`m63 + m84 = 6/6`；writer manifest 更新为 `252/199/92/0`。
- 同一 Reviewer 已关闭首轮四项 finding，第二轮增量复核新增 `P0=0 / P1=2 / P2=1`：legacy 输入变更未清旧 proof、无 capability projection 绕过事务保护、共享 projection SQL 被误归 legacy。
- 第二轮修复已完成：输入变化清 proof 且旧 projection fail-closed；uncapable projection 经过 workflow lock/high-water/upload adoption 并在同一事务结算；writer scanner 按 control-flow 区分 legacy replay SQL 与共享 Durable Server SQL。
- 新增回归后定向证据：`m85 31/31`、`m103 + m104 + m105 24/24`，全部 exit `0`；测试库存 `1226`，writer manifest `253/200/92/0`。
- 同一 Reviewer 对第二轮冻结候选复核为 `P0=0 / P1=1 / P2=0`；唯一 P1 是 legacy 素材/顶层/边拓扑与 modern topology 变化仍可能保留旧 generation proof。现已按受影响 target、旧/新 kind 原子清 proof，并让 node 顶层 input fingerprint 与 descriptor 对齐；`m85 + m92 + m104 = 46/46`、`m105 = 1/1`。
- 第三轮复核确认 proof P1 已关闭，但新增 `P0=0 / P1=1 / P2=0`：rejected legacy projection 与 modern 多素材 adoption 冲突可能持久化部分 adoption。现已用事务 savepoint 在持久化 rejection receipt 前全量回滚 adoption；`m85 + m104 = 42/42`、`m88 + m105 = 39/39`。
- 同一 Reviewer 已完成最终只读复核：`139/139` files、`1855/1855` hunks、`253/253` writer entries、CWB `194/194`，并覆盖 10/10 models、12/12 identities、6/6 adapters；冻结 payload SHA-256 仍为 `5833e0f0dffc5054f97e0d5f21be1ae7a6e2572bc06c2270f7aecd71cd3c5a1b`。
- 最终结论 `P0=0 / P1=0 / P2=0 / GO`；第四轮 adoption finding 已关闭且无新增 finding。因此 CWB-172..176 为 `AUTO_PASS`，唯一 formal full 获准但仍为 `0/1`。

### 17.4 Formal full 失败闭环与变更候选（2026-09-04）

- 首个冻结候选正式 full 原始结果：`1226` tests，`1192 passed / 30 failed / 4 skipped`，exit `1`。CWB-159 继续 `NOT_RUN`，不得用定向结果冒充 full PASS。
- CWB-160 已满足：所有 30 条失败均先归因、只修受影响范围并运行对应完整 spec；最终 `m41 59/59`、`m86 83/83`，其余原失败规格也全部定向通过。
- 新增原子 `replace-edge` 合同后库存为 `1227`；`m104 12/12`、`m102 31/31`、`m92 4/4`，source coverage `514/514`，全部 safe runner exit `0`。
- 当前再冻结身份：允许范围 `153` files（tracked `132`、untracked `21`）、`1919` hunks；排除 Plan/Matrix/Checkpoint 后产品 payload `150` files，SHA-256 `0cf6e5ab45e0825ea3cafd72e2a455b1cb399136dca07236834c1b6f9e8153e7`。当前 writer manifest 为 `295/256/200/95/0`，原始文件 SHA-256 `cbe4570fbae6203196fd905ec0d9f79f21ba0bf37ad7fd7d08c2b0d218840be0`、canonical fingerprint `9ab50c550a153bb7c962e9ed7e72dc27d62d5c90ed758c3541bc3d7ee55e941a`、source tree hash `1b0f03e814b338b7884576ea69afbc0625b00af051ffe3bbf86133dc95379aa0`。
- 同一独立 Reviewer 已对当前再冻结候选完成 `153/153` files、`1919/1919` hunks、`256/256` writers、CWB `194/194`、10/10 models、12/12 identities、6/6 adapters 复核；保护文件访问 `0`，最终 `P0=0 / P1=0 / P2=0 / GO`。CWB-171..176 现为 `AUTO_PASS`；这只放行最终候选 formal full，不等同于 full 或生产通过。

### 17.5 第二次 formal full 失败闭环与当前冻结候选（2026-09-05）

- 第二次 formal full 原始结果：`1227` tests，`1224 passed / 3 failed / 0 skipped`，exit `1`；该结果永久保留，不改写为通过。
- 3 条失败已逐项关闭：Text 富文本增加同字段最新 mutation fence、聚焦 DOM 同值不回写且复制读取 committed ref；键盘位移和删除撤销 fixture 等待前序状态落地。`m1 + m2 + m69` 连续三轮 `60/60 PASS`；Text 直接依赖 `m105 + m28 + m3 + m41 + m98 = 76/76 PASS`，均由 safe runner 执行且 source/4173 不变。
- 当前允许范围身份为 `155` files（tracked `134`、untracked `21`）、`1931` hunks；排除 Plan/Matrix/Checkpoint 后产品 payload `152` files，SHA-256 `0b17dd9fe61550e4a254dec78d15286491e56110dd65c857046d50c24f485661`。
- writer manifest 已重生成并通过 check：`295` source、`256` raw、`200` product、`95` exceptions、`0` violations；原始文件 SHA-256 `3c9b0662a334f11b6f0a51e37d69cbf262cd65edf49758d231aa3ef274b1b68e`、canonical fingerprint `bbe9aa46bd84b41abbeca213d9221052122219ef75e7e9e24f4a43e403023df8`、source tree hash `8d4a5f8fce10c30c66c5b28d4eb2685197954418d9ce854e1ee2222eaf689e2d`。
- 上一轮 `153/153` Review GO 是历史身份，已被后续修复失效；当前 CWB-171..176 恢复 `PENDING`，只允许同一 Reviewer 对当前身份作只读增量终审。终审归零后才可执行最终 formal full。
- 同一独立 Reviewer 已完成当前身份终审：`155/155` files、`1931/1931` hunks、payload `152/152`、writer `256/256`、CWB `194/194`、10/10 models、12/12 identities、6/6 adapters；保护文件访问 `0`，无 drift、无新 finding。
- 最终结论 `P0=0 / P1=0 / P2=0 / GO`。CWB-171..176 现升级为 `AUTO_PASS`，只放行当前冻结 payload 的最终 formal full；不等同于 full、release 或 production PASS。

### 17.6 最终 full 压力等待修正与再冻结（2026-09-05）

- 最终 formal full 原始执行 `1225 passed / 2 failed / 0 skipped`（总数 `1227`，exit `1`）。两条均为等待预算超时：m4 GIF 替换在默认 5 秒内未观察到新 assetId；m41 双轮询持有用例触发默认 60 秒测试上限。source snapshot 与 4173 listener 均未变化。
- 未改产品代码的原候选上，m4 完整规格 `7/7`、m41 完整规格 `59/59` 均已通过，证明业务断言可满足。随后只把 m4 两个替换轮询预算与同文件既有惯例对齐为 20 秒，并把 m41 该复杂用例与同文件既有惯例对齐为 120 秒；两规格合并复验 `66/66 PASS`。
- 当前再冻结身份：`155` files（tracked `134`、untracked `21`）、`1934` hunks；payload `152` files，SHA-256 `96b62e1e11a65451f578b2ffa925ab2a9be2fd97569614269de7adbf9e77f087`。产品源码与 writer manifest 未变，仍为 `295/256/200/95/0`。
- 测试 delta 使上一轮 Review GO 失效；CWB-171..176 再次恢复 `PENDING`。只允许同一 Reviewer 对等待预算 delta 与当前 identity 作只读复核，GO 后执行一次最终 mandatory formal full。
- 同一 Reviewer 已纠正并核对正确 m41 hunk：120 秒预算属于“old Image poll cannot overwrite newer task”用例；旧响应延迟释放、新任务绑定/投影、旧结果不得覆盖、task submission=1、Provider=0 等断言均完整保留。
- 当前 `155/155` files、`1934/1934` hunks、payload `152/152`、writer `256/256` 复核无 drift；最终 `P0=0 / P1=0 / P2=0 / GO`。CWB-171..176 恢复 `AUTO_PASS`，放行最后一次 mandatory formal full。

### 17.7 Mandatory formal full PASS 与最后 delta（2026-09-05）

- mandatory formal full 的一次中间执行为 `1226/1227`、1 failed、0 skipped、exit `1`；唯一失败是 m41 terminal Text 用例对本地临时服务器的 `route.fetch` 收到 `ECONNRESET`。source snapshot 与 4173 listener 均未变化。
- 只在该 fetch 上启用 Playwright `maxRetries: 2`；它只处理连接重置，不改变业务、Canvas、task、Provider 或 request-count 断言。完整 m41 复验 `59/59 PASS`。
- 最后一次 mandatory formal full：`127` specs、`1227/1227 PASS`、0 failed、0 skipped、exit `0`；source/snapshot SHA-256 `70ac7cd827e2442cfe91d4a39639328b267218864b1fff2102791cf8914ca6da`，4173 listener unchanged。CWB-159=`AUTO_PASS`。
- 当前 identity：`155` files、`1934` hunks；payload `152` files、SHA-256 `8e7a00c6b11b3410fed749e72cebc4856c4cdf84bf90b6c7f3d91e2045c70567`；writer manifest `295/256/200/95/0`。同一 Reviewer 最终 `P0=0 / P1=0 / P2=0 / GO`；R9=`PASS`，进入 R10，不再重复 full。

### 17.8 v0.7.8 preflight NO_GO 与 v0.7.9 delta（2026-09-05）

- v0.7.8 release 与 exact-tag build 已完成但未部署。生产 census：active task/run/publication/capacity 均为 0；23 条 accepted/response-received/outcome-unknown 记录全部绑定 failed/cancelled 终态 task，必须保留且绝不重发 Provider。
- v0.7.8 迁移错误地把这 23 条历史证据当成活跃执行，因此 CWB-182 继续 `NOT_RUN`，生产 current、schema、业务数据和费用均未变化。
- v0.7.9 delta 保留 active/freeze 门并允许 terminal billing history 原样穿越 DDL-only migration；新增回归覆盖 failed/cancelled task 的 accepted、response-received、outcome-unknown，dry-run/source schema42 不变、apply 后 schema43 且三行全部字段相同。
- 首轮独立增量 Review 覆盖 `17/17` files、`55/55` hunks，产品逻辑 `P0=0 / P1=0`，因 attempt 全字段/terminal 组合与 schema42 五个负向门缺少直接回归而为 `P2=2 / NO_GO`。两项均已补测：failed/cancelled 的 accepted/response-received/outcome-unknown 全字段保留，以及 active task/run/publication/capacity/generation-unfrozen fail-closed 且 source 不变。
- 定向证据：m91 `12/12`、m81+m103 `54/54`、m105 `1/1`，合计 `67/67`；测试库存 `1229`，writer manifest `295/256/200/95/0`。补测后同一 Reviewer 覆盖 `17/17` files、`55/55` hunks并确认三项 P2 全部关闭，最终 `P0=0 / P1=0 / P2=0 / GO`；当前只待变更后 formal full。
- 变更后 formal full：`127` specs、`1229/1229 PASS`、0 failed、0 skipped、0 retries/blocked/reportErrors，exit `0`；Node/npm `22.23.1/10.9.8`，source/snapshot SHA-256 `3b1fcd369e292c272183e3db7ee8316a38f700b96847f83e0370d2a0ebcbb9ea`，4173 listener unchanged。post-receipt m38 `19/19 PASS`；同一 Reviewer 对当前 `17/17` files、`56/56` hunks完成只读收口，保护文件访问 0，`P0/P1/P2=0/0/0 / GO`。CWB-159=`AUTO_PASS`，R9=`PASS`，R10=`READY`；不得重复 full。
