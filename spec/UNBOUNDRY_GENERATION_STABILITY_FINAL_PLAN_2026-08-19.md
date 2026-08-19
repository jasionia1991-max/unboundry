# 无央 Unboundry · 生成稳定性最终行动方案（2026-08-19）

> 本文档是 2026-08-19 线上生成故障（6 个图片任务同时卡死）的**唯一权威行动方案**。
> 任何 agent 接手后，先读本文档再动手；上下文丢失以本文档为准。
> 状态：**方案已定稿，代码未改，等待用户逐项授权后执行。**

---

## 0. 一句话结论

本次故障的核心不是并发 500 本身，而是：**优创固定通道的轮询请求没有在发出前释放“平台/存储共用配置锁”，一条卡死的平台连接把锁占住约 1.5 小时，导致保存/上传全部抢不到锁、无限重试；网络连接自行断开后锁释放，4 个任务自动恢复成功，2 个因自动重试状态机缺口而失败。**

用户最终诉求（2026-08-19 用户原话确认）：

> 上传参考图 → 点一次生成 → 结果自动上画布，全程不需要用户操作；
> 以后会有十几个甚至几十个节点的工作流，且可能多个标签页、多个项目画布同时进行；
> 不希望出现“生成完还要手动点核对结果/重试”的体验。

---

## 1. 状态快照（截至 2026-08-19 晚，取证时点）

### 1.1 仓库与部署

- 本地仓库：`/Users/mymy/Documents/unboundry/app`
- 分支：`codex/unboundry-offline-remediation-2026-08-09`
- HEAD：`07c7235`
- package.json 版本：`0.6.22`
- 生产：`live-cockpit`（101.43.77.14）
  - `current -> /opt/unboundry/releases/v0.6.22-generation-stability-20260819`
  - `unboundry.service` active/running，`NRestarts=0`，Node `v22.23.2`
  - SQLite schema `39`，`integrity_check=ok`
- 生产关键源码与本地 HEAD 逐字节一致（已用 sha256 核对 8 个关键文件）。

### 1.2 生产数据状态

- `generation_safety_settings`：每用户并发 500、图片/视频/音频/文字并发 500、RPM 500（`updated_at=2026-08-15T02:37:03.482Z`）。
- 审计记录（`admin_audit_events` id=198）：2026-08-15 02:37，`generation_safety.update`
  - before：每用户 1、每类型 1、RPM 5
  - after：全部 500
- 故障画布 `9dd7c462-cc1e-40e9-90c7-8e0131df490e` 的 6 个图片任务（优创 gpt-image-2）：

| 模块 | 任务 | 最终状态 |
|---|---|---|
| 正面整体图 | 0079842a | success（attempt 2） |
| 领口/腰头与开口结构 | 6c5cf61e | success（attempt 2） |
| 面料肌理特写 | a941f428 | success（attempt 2） |
| 缝线与工艺特写 | e3aab194 | success（attempt 2） |
| 袖口/下摆与收口边缘 | 88df658e | failed（RESULT_DELAYED，attempt 1） |
| 细节与辅料特写 | 9785d222 | failed（RESULT_DELAYED，attempt 1） |

- 两个失败任务均有 `provider_task_id`（109940993 / 109941044）和 `outcome=response-received`：**平台已出图，只是本地保存未完成**。
- 截至 2026-08-19 21:08 后：`database is locked` 报错 0 条，配置锁探测空闲，活动任务 0。
- 用户明确表示：**不在意任何存量节点结果是否找回**，只关心以后不再出现这类体验。

### 1.3 红线（任何时候不得违反）

1. 不碰 4173、`app/data`、`/var/lib/unboundry` 真实媒体/备份。
2. 不擅自重启生产服务、不取消/重试存量任务、不发起 Provider 付费生成。
3. `spec/public-templates-director-split-revision.json` 不得提交、不得删除。
4. 修改/删除任何文件前先征求用户同意。
5. 上线、push、tag、PR 必须用户分别确认版本号和“可以上线”。
6. 测试不允许碰真实媒体、真实备份、未授权真实付费生成。

---

## 2. 已证实事实（证据清单）

### 2.1 故障时序

- 19:29:51–19:30:01：6 个同账号图片任务在约 8 秒内全部入线（并发 500 放行）。
- 19:30 起：平台已返回结果（`response-received`），但 `result_asset_id` 全空、`media_publication_attempts` 无记录。
- 19:30:53 起：持续 `generation-diagnostic stage=save errorCode=ERR_SQLITE_ERROR message="database is locked"`，约每 5.6 秒一轮，6 个任务轮流。
- 19:44 起：`/proc/1831913/fd/25` 持有配置锁 POSIX WRITE，锁 journal 文件持续存在；fd 33 是到平台 `107.149.138.*:443` 的长连接，发送队列积压 5707 字节。
- 21:06:17–21:07:13：各任务轮询到上限，转 `failed(RESULT_DELAYED)`，前端开始自动重试。
- 21:07:03–21:07:26：锁释放后，4 个任务经 `retrying→queued→running→success` 保存成片；2 个任务保持 failed。
- 21:08 后：报错归零，配置锁空闲。

### 2.2 关键实测

- 12 秒连续采样：主库写锁 12/12 空闲；配置锁 12/12 被占；锁 journal 全程存在。
- 恢复瞬间：4 个任务在锁释放后数秒内全部保存成功（锁 ↔ 恢复强相关）。
- 19:38/19:39 两次 `POST /api/assets` 400，耗时 5009/5010ms（正好是 5 秒锁等待超时）。
- 19:29–20:35 无任何 `DELETE /api/generation-tasks`（取消请求从未到达服务端，前端问题）。
- 21:12–21:13 约 90 次 `PUT /api/canvas`，全部 200、10–18ms（画布保存服务端无故障）。

### 2.3 代码事实

- 配置锁文件 `provider-profile-write-lock.sqlite` 被两套代码共用：
  - `server/providerProfiles.ts`（`acquireDocumentLock` / `acquireProviderGenerationRequestLease`）
  - `server/secureStorageProfiles.ts`（`withDocumentMutationLock` / `withStorageMediaRoutingReservation`）
  - 两边各自有进程内队列，但**互不知情**，同一进程内也会互相争锁。
- `withProviderRequestLease`（`server/generationTasks.ts:524`）设计了 `providerBoundary` 释放回调，但优创固定通道轮询没有使用它：
  - `relayJsonRequest`（`server/relayProviderAdapters.ts:608`）传 `beforeRequest: execution.beforeProviderRequest`；
  - 轮询路径 `pollRelayMediaTask` 的 `execution.beforeProviderRequest` 为 undefined；
  - 固定通道（`usePinnedTransport: true`）又不走 `fetchWithProviderLease` 包装；
  - 结果：**整个请求生命周期都持有配置锁**，网络卡多久就占多久。
- 保存保险丝（`server/generationTasks.ts:1732` `attemptProviderResultSave`）：未知 `ERR_SQLITE_ERROR` 不属于 definitive 错误，记录日志后返回 false，调用方继续轮询。
- 重试/核对接口（`server/generationTasks.ts:4757` 附近）：`acquireProviderGenerationRequestLease` 抢锁失败后，被统一 catch 为 `PROVIDER_CONFIGURATION_MISMATCH` 返回 409（“平台连接已变化”），把“锁忙”误报成“配置变更”。
- 前端自动恢复（`client/src/generation/workflowGenerationRecovery.ts`）：只对“任务失败且 attempt<2”自动重试一次，且由前端逐个触发，没有服务端兜底；本次 1 条撞锁 409、1 条未触发。
- 前端“画布还在保存”闸门（`client/src/canvas/CanvasSurface.tsx:6260` `waitForCanvasRevision`）：15 秒内画布持续 dirty/saving 就直接抛错，由 `WorkflowExecutionProvider` 弹红字，不做有界自动等待。
- 双指滑动：普通 wheel（无 ctrlKey）= 平移（`panOnScroll`，`CanvasSurface.tsx:6921`）；ctrlKey+wheel/捏合 = 画布缩放（`CanvasSurface.tsx:6438` + `CanvasShell.tsx:1012` 全局拦截）。唯一触发缩放的路是浏览器把滑动事件标成 ctrlKey=true。该现象在 `TASKS.md:1333` 已记录过一次（“Chrome/触摸板偶发把滑动识别成捏合”，当时标为待复现），2026-08-19 第二次复现。

---

## 3. 根因链路（最终定稿）

```text
并发配置 500（放大器，非根因）
  → 6 个任务 8 秒内同时进入轮询
  → 优创固定通道轮询未接上配置锁释放边界（代码缺陷 A）
  → 平台 TLS 连接卡死（外部网络/平台问题）
  → 配置锁被请求长期占用
  → 保存/上传抢配置锁，等待约 5 秒后失败（database is locked）
  → 保存保险丝吞掉错误、不判终态（代码缺陷 B）
  → 任务保持 running，约每 5.6 秒重试一轮
  → 轮询达到上限转 RESULT_DELAYED，前端自动重试
  → 锁仍忙时被误报为“平台连接已变化”409（代码缺陷 C）
  → 自动重试状态机漏任务（代码缺陷 D）
```

四个代码缺陷按优先级：

| 编号 | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| A | 固定通道轮询未在请求发出前释放配置锁 | `generationTasks.ts` / `relayProviderAdapters.ts` | 网络卡住时锁被长占 |
| B | 保存保险丝把锁忙当瞬时错误无限重试 | `generationTasks.ts:1732` | 任务长时间红呼吸 |
| C | 重试/核对把“锁忙”误报成“配置已变化”409 | `generationTasks.ts:4757` 附近 | 用户看到误导性错误、任务救不回 |
| D | 自动恢复只靠前端逐个触发，服务端不兜底 | `workflowGenerationRecovery.ts` / 服务端 | 漏任务、需要手动点 |

---

## 4. 修复方案（分模块，均待授权执行）

### 4.1 代码缺陷 A：平台请求不得持有配置锁

目标行为：

- 配置锁内**只**读取配置快照、登记任务/版本号。
- 发起平台请求前释放配置锁；DNS、TLS、连接、轮询、下载、保存全部不得持有该锁。
- 配置变更防护改用“版本号 + 活跃任务登记”，不靠整段网络请求持锁。

具体动作：

1. 检查并修正优创固定通道专用分支：`relayJsonRequest` / `pollRelayMediaTask` / `submitRelayMedia` 必须调用 `providerBoundary`（或等效释放），在请求真正交给传输层后立即释放租约。
2. 给固定通道加回归测试：模拟 `fetchPublicHttps` 挂起（不返回、不报错），断言配置锁在请求发出后即可被其他调用方获取。
3. 审计所有 `withProviderRequestLease` 调用点（提交、轮询、取消、恢复、核对），逐一确认释放点：
   - native 路径：`fetchWithProviderLease` 释放；
   - 固定通道路径：`beforeProviderRequest` 必须指向 `providerBoundary` 包装；
   - 任何新协议分支默认走“发出即释放”，禁止整请求持锁。

验收：

- 新增测试：固定通道轮询请求挂起时，保存/上传仍能拿到配置锁。
- 现有全量测试全绿。

### 4.2 代码缺陷 B：保存与轮询解耦 + 错误分类

目标行为：

- 平台出图后进入“结果待保存”状态，由独立、有界、幂等的保存通道处理；不再用轮询循环掩盖保存失败。
- `database is locked` / SQLITE_BUSY 明确归类为“锁忙/持久化暂时失败”（如 `PERSISTENCE_BUSY`），进入有界退避；重试耗尽后进入明确终态或延迟收口，而不是无限红呼吸。

具体动作：

1. 保存路径先读存储路由快照并释放配置锁，再执行主库媒体 reservation（主库事务不得在配置锁内执行）。
2. 保存失败重试采用应用层有界写队列/指数退避（上限例如 5 次、总时长 30 秒），并优先复用现有 `media_publication_attempts` 恢复机制，不新建第二套保存系统。
3. 保险丝错误分类：`ERR_SQLITE_ERROR`/`SQLITE_BUSY` → transient + 有界；超界后进入 `RESULT_DELAYED` 或明确失败（由用户对文案最终拍板）。
4. 画布“保存中”提示只用于真正无法落库的终态，不再伴随无限重试。

验收：

- 6 任务并发复现（隔离环境）不再出现连续 75 分钟红呼吸。
- 保存失败耗尽后有明确终态，且不产生重复媒体、不重复扣费。

### 4.3 代码缺陷 C：锁忙不得误报为“平台连接已变化”

目标行为：

- 重试/核对接口区分三种情况：配置真的变了、锁暂时忙、任务状态变化；返回对应错误码与中文文案。
- 锁忙时前端自动等待/重试（有界），不弹误导性红字。

具体动作：

1. `acquireProviderGenerationRequestLease` 抢锁超时改为抛出可识别的“锁忙”错误（如 `PROVIDER_LOCK_BUSY`），与配置变更错误分开。
2. 重试/核对/取消接口的 catch 分支按错误类型分别处理；`PROVIDER_LOCK_BUSY` 返回可重试语义。
3. 前端对 `PROVIDER_LOCK_BUSY` 做自动有界重试，最多 N 次后转中性提示，而不是红字。

验收：

- 隔离复现锁忙场景：接口返回“系统正在处理，请稍后自动重试”，前端不弹“平台连接已变化”。

### 4.4 代码缺陷 D：自动恢复服务端兜底，不依赖前端

目标行为：

- 每个 `RESULT_DELAYED` / 结果待保存任务都由服务端保证收口：要么保存成功，要么进入明确终态/人工核对队列。
- 前端自动重试只是加速器，不是保证。

具体动作：

1. 服务端增加恢复调度（复用现有任务状态机与 `media_publication_attempts`）：扫描“平台已出图但未保存”的任务，按有界策略自动 resume-provider-task 并保存。
2. 恢复必须幂等：同一任务只产生一个保存结果，不重复 POST、不重复付费。
3. 自动恢复失败达到上限后，任务进入明确终态，并生成一条可审计的中性提示（不是红字）。
4. 前端 `workflowRecoveryPlan` 保留但降级为“加速”；任何失败任务都不再依赖用户手动触发才能收口。

验收：

- 隔离环境：制造 6 个“平台已出图、本地保存失败”任务，全部在锁释放后自动收口（成功或明确终态），无需前端参与。

### 4.5 取消与画布保存体验（独立问题）

取消：

- 本次取证：19:29–20:35 服务端未收到任何取消请求，说明前端取消按钮没有发出请求（或请求被前端状态吞掉）。
- 修复：取消先 abort 本地循环并立即落库，再按任务状态返回；前端取消按钮必须有任务号找回/兜底，不能出现“点了没反应”。

画布“还在保存”：

- 现象：整组执行前等待画布保存，15 秒内画布持续变更就弹红字。
- 修复：`executeGroup` 的等待改为有界自动等待+自动重试（例如最长 30 秒、每 250ms 重查）；保存完成后自动开始，只有真正超时才提示，且提示用中性文案。

### 4.6 双指滑动手势（先取证、再修复）

现状：

- 代码行为确定：普通 wheel = 平移；ctrlKey+wheel/捏合 = 缩放。
- 复现两次（TASKS.md:1333 记录过一次，2026-08-19 第二次）。最可能是浏览器把滑动识别成捏合（ctrlKey=true），但未拿到浏览器侧实锤。

第一步（取证，不改行为）：

- 增加最小诊断埋点：记录 wheel 事件的 `ctrlKey/deltaX/deltaY/deltaMode/target` 到控制台（或临时日志端点），仅在生产复现时开启；复现一次拿到实锤后再决定最终手势策略。

第二步（修复方向，待取证后定稿）：

- 手势模式锁定：一次手势内，第一个事件的类型决定整段手势是平移还是缩放，避免中途翻转。
- 保留可靠缩放入口：缩放滑杆、⌘+/-、Ctrl+滚轮；必要时提供“一键复位缩放”。
- 不牺牲“捏合缩放”契约（CANVAS-011/018），若取证证明无法区分，则与用户确认取舍。

---

## 5. 并发配置（待用户拍板，默认不设 500）

### 5.1 结论

- 配置上限允许 1000；修好结构缺陷后设 500 在技术上可行，但**不推荐**：
  - 平台侧会限流；
  - 单机磁盘/内存/OSS 同时保存大量结果会排队变慢；
  - 500 是放大器，不是能力。
- 用户实际场景（几十节点工作流 + 多标签页）不需要 500 同时放行。

### 5.2 推荐配置（默认方案，可再压测调整）

| 参数 | 推荐值 | 理由 |
|---|---|---|
| per_user_concurrency | 20 | 多标签页/多项目同时进行 |
| image_concurrency | 10 | 并行出图够用 |
| video_concurrency | 2 | 视频慢且贵，少并发 |
| audio_concurrency | 2 | 同上 |
| text_concurrency | 10 | 文字快，可稍高 |
| requests_per_minute | 120 | 几十节点组跑不撞限流 |

### 5.3 决策项

- 用户若坚持 500：先在隔离环境压测，用真实比例（几十节点模板 + 多标签页 + 平台限流）给数据，再由用户决定。
- 无论最终值多少，改生产配置前必须用户明确授权，并走发布流程记录。

---

## 6. 存量任务处理（用户已表示不关心，仍记录规则）

- 两个 failed 任务平台已出图，只可做“保存恢复”，**禁止重新 POST/重新付费**。
- 用户明确不关心后，默认不处理；若用户改变主意，需单独授权后：
  1. 用现有 `reconcile` 流程核对平台任务号；
  2. 只保存已有结果；
  3. 无法证明平台结果时进入人工核对，不自动新开任务。

---

## 7. 测试计划（隔离环境，禁止碰真实数据）

1. 缺陷 A 定向测试：固定通道请求挂起时，配置锁可被保存获取。
2. 6 任务同账号并发复现：admission、保存争锁、取消与保存竞态。
3. 几十节点模板 + 多标签页并发压测：测安全并发值。
4. 自动恢复兜底测试：制造“平台出图、本地保存失败”，验证服务端自动收口。
5. 错误分类测试：锁忙 vs 配置变更 vs 任务变化。
6. 前端：画布保存自动等待、取消按钮、RESULT_DELAYED 文案、双指手势取证。
7. 全量安全回归：按项目既有发布规范执行（隔离 4173、不动 app/data、零真实 Provider/付费）。

---

## 8. 发布流程

遵循项目已有发布文档（上线规矩.md / TASKS.md 顶部发布流程），不再绕路：

1. 代码修改完成 → review（自查 + 必要的外部 review）。
2. 定向测试 + 全量测试全绿（隔离环境）。
3. 用户实页验收（隔离预览）。
4. 用户分别确认：版本号（小号递增） + “可以上线”。
5. 按发布流程：build → 生产原子切换 → 验证 /api/version、schema、服务、关键数据门。
6. commit、push、tag、PR 合并按用户确认执行。
7. 更新 TASKS.md / spec 收尾文档。

---

## 9. 风险、影响面与耦合（评审要求）

| 修复项 | 影响面 | 风险 | 应对 |
|---|---|---|---|
| 释放边界 A | 所有优创/固定通道提交、轮询、取消、恢复 | 过早释放导致配置变更竞态 | 版本号+活跃任务登记兜底；释放前校验快照 |
| 保存解耦 B | 图片/视频/音频/文字保存路径 | 新队列引入重复保存 | 幂等键 + media_publication_attempts 复用 |
| 错误分类 C | 重试/核对/取消接口 | 错误码变更影响前端映射 | 同步更新 friendlyGenerationMessage 与测试 |
| 服务端兜底 D | 任务状态机、恢复调度 | 自动重试触发重复付费 | 严格复用 resume-provider-task，禁止 new-paid 自动触发 |
| 并发配置 | 生产安全设置 | 设太高复发放大 | 先压测再改，改后观察 |
| 手势修复 | 画布交互 | 误改缩放契约 | 先取证，方案定稿后小步上线 |

---

## 10. 待用户决策清单（当前阻塞项）

1. 并发最终值：推荐 20/10/2/2/10/120；是否接受，或坚持 500（需压测）。
2. 双指手势：是否同意先加诊断埋点（不改行为）。
3. 两个存量失败节点：保持不管，还是授权做保存恢复。
4. 修复批次：一次全做，还是分批（A→B/C→D→体验）。

---

## 11. 当前硬性状态

- 未修改任何代码、数据库、生产配置、服务状态。
- 未提交/推送/打标签/PR。
- `spec/public-templates-director-split-revision.json` 保持 untracked。
- 等用户对第 10 节决策后，按第 8 节流程执行。
