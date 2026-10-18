# INC-GEN-013：整组刷新恢复与组合框拖动性能治理方案

状态：`PRODUCTION_V0_6_42_TECHNICAL_PASS / PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK`

建立日期：2026-08-25

事件目标：修复「整组生成中刷新后，已被服务端接收的原任务不能自动回填」和「富组合框拖动明显卡顿」两个问题，同时守住不重复付费、不覆盖新编辑、不破坏组合框坐标语义和不扩大生产风险的边界。

唯一实时断点：`spec/INC_GEN_013_GROUP_RECOVERY_AND_GROUP_DRAG_PERFORMANCE_CHECKPOINT.md`

当前生产事实仍以 `spec/UNBOUNDRY_CURRENT_STATE.md` 为准：生产运行 `v0.6.42 / schema41`。本文的实施、自动验收、GitHub、冻结备份、原子发布与零付费生产技术矩阵已完成；用户在涉事账号实页确认前保持`USER_RECHECK`。

## 0. 结论

这次不是一个单一“耦合 bug”，而是两个历史边界缺口同时暴露：

1. 整组执行恢复依赖浏览器 checkpoint，但 checkpoint 没有可靠保存「服务端已接收任务」的精确绑定；安全门因此只能阻止新一轮，不能在刷新后自动接回原任务。
2. 组合框使用 `GroupNode.tsx` 的旧自定义拖动路径，每次 pointer move 直接 `setNodes`，并绕过 `CanvasSurface` 已有的拖动状态、交互节流和持久化安静期。

对应治理原则是：

- 恢复只核对并接回原任务，绝不自动创建、重试或继续提交待执行节点；
- 拖动优先回归 React Flow 原生路径；原生路径不能保留现有语义时，才接入唯一共享的画布交互端口；
- 自动恢复只承诺同账号、同画布、同浏览器持久化范围；跨浏览器或浏览器存储被清空后的恢复不在本事件内；
- 不先做全画布重写、媒体缓存重构或服务端新工作流系统。

## 1. 现象与已核实事实

### 1.1 用户可见现象

- 点击开始新一轮时提示：`当前画布有一轮未完成记录，请在生成任务面板继续或明确放弃后再开始新一轮`。
- 同一账号的复杂画布上，拖动大组合框明显卡顿。

### 1.2 生产只读证据

- 涉事画布：`60a739ce-9cb4-4c46-9c77-92e9f6f22b49`；账号线索为 `zzx`。
- 页面约在 09:56:45 CST 重载时图片任务仍在运行；任务于 09:57:13 成功结束。
- 服务端任务和 Provider 均成功，结果媒体仍在 OSS：PNG、960×1280、1,261,318 bytes。
- 画布节点保留任务 ID，但缺少能够证明该次 group run 已完成回填的 asset/imageSrc/success proof；服务端当前没有 active task。
- 服务器保存请求成功且耗时低，没有发现服务端异常或 Provider 失败能解释拖动卡顿。
- 画布约有 3 个大组合框、39 个节点、73 条边；被选组合框约 2900×1660，含 12 个子节点和 24 条边，视口缩放约 15.6%。

因此：提示本身是防止重复付费的正确安全门；真正缺口是刷新后的原任务自动对账不足。当前人工恢复入口「继续剩余节点」仍应保留。

## 2. 回归定性

| 现象 | 定性 | 说明 |
|---|---|---|
| “有一轮未完成记录”提示 | 非回归 | 安全门按设计工作，避免直接重复创建付费任务 |
| 已成功原任务刷新后不能自动回填 | 恢复设计缺口 | 现有 m22 覆盖的是刷新后打开任务面板、人工继续并复用原任务，不等于自动对账 |
| 组合框拖动卡顿 | 历史旁路缺口、实际体验回归 | 旧 `beginMove` 路径从基线即存在；不是后续 commit 撤销修复，但后续性能门没有覆盖富组合框父节点路径 |
| 既有 VIEW-005/CANVAS-016 | 历史证据继续有效 | 既有证据覆盖扁平密集画布或当时 fixture，不应被本事件改写，也不能外推为富组合框路径已通过 |

## 3. 范围

### 3.1 进入本事件

1. `GroupRunCheckpoint` 向后兼容扩展，可靠记录已接收任务绑定。
2. 页面加载后，对已接收任务执行严格的只读自动对账和结果回填。
3. 多标签页恢复租约、终止条件、冲突保护和 checkpoint 清理时序。
4. 组合框拖动接入统一画布交互路径和持久化安静期。
5. 精确复现生产密度的本地 fake fixture、行为测试和性能门。
6. 更准确的提示文案与行动入口；首版不强制弹开任务面板。

### 3.2 不进入本事件

- 不创建新的 Provider 任务，不做真实 Provider、真实 OSS、付费生成或生产媒体写入；
- 不修改 Provider adapter、模型合同、任务计费合同或结果保存期限；
- 不承诺跨浏览器、跨设备或浏览器存储被清空后的自动恢复；
- 不做全画布渲染架构重写、全局媒体缓存改造或所有节点统一重构；
- 不改变 pending 节点必须由用户明确继续/放弃的产品语义；
- 不重写既有历史 PASS、生产回执或用户验收结论。

## 4. 恢复合同

### 4.1 checkpoint 兼容扩展

现有 `GroupRunCheckpoint` v1 保留可读。新增可选字段：

```ts
type AcceptedTaskBinding = {
  kind: GenerationKind;
  nodeId: string;
  taskId: string;
  ownershipKey: string;
};

type GroupRunCheckpoint = {
  // 既有字段不变
  acceptedTasks?: Record<string, AcceptedTaskBinding>;
};
```

写入时机：服务端 admission 返回任务已接收后，必须先持久化 `acceptedTasks[nodeId]`，再进入常规轮询。不得只依赖节点上可能晚一步保存的 taskId。

兼容规则：

- v1 checkpoint 继续可解析，不能因没有 `acceptedTasks` 被破坏；
- v1 只能继续现有安全人工流程，不推断或伪造 ownership key；
- 新字段是可选扩展，不要求本事件新增数据库 schema；
- 不在日志、错误或回执中写完整 Provider body、秘密或敏感图片。

### 4.2 自动恢复模式

新增内部模式：`accepted-tasks-only`。

允许动作只有：

1. 读取当前账号、画布和 checkpoint；
2. 获取恢复租约；
3. 对 `acceptedTasks` 中精确的原 `taskId` 发起 GET；
4. 等待其进入 terminal；
5. 通过既有结果门把原结果写回原节点；
6. 保存画布并确认 revision；
7. 更新 success proof，并在整轮满足清理条件时清除 checkpoint。

明确禁止：

- POST 新任务；
- 自动 retry、补提交或继续 pending 节点；
- 调用 Provider、切换模型或重新生成 ownership key；
- 上传媒体或额外创建 OSS 结果对象；
- 用最近任务、相同 prompt、相同模型等弱条件猜测任务归属。

### 4.3 启动门与失败关闭

自动对账仅在以下条件全部成立时启动：

- 画布已安全 hydrate；
- 当前账号、canvasId、groupId 和 checkpoint scope 完全一致；
- checkpoint 可解析，任务绑定字段完整；
- 当前节点和 checkpoint snapshot 兼容；
- 没有外部有效恢复租约，且当前标签页成功取得租约。

以下任一情况必须停止自动回填并保留 checkpoint：

- taskId、ownershipKey、runId、nodeId、kind 任一不匹配；
- 用户切换画布、退出账号、pagehide、组件卸载或恢复租约丢失；
- 结果媒体/asset 不完整，或 checksum/owner 不符合既有门；
- 当前节点已被用户修改，snapshot/revision 不能证明安全写回；
- 保存返回冲突、超时或失败；
- checkpoint 损坏或凭据缺失。

### 4.4 精确写回围栏

结果写回至少同时绑定：

`accountId + canvasId + groupId + runId + nodeId + kind + taskId + ownershipKey + checkpoint snapshot + current revision`

任何字段不一致都不得覆盖节点。不可通过“服务端任务已成功”单独推导“当前节点允许写回”。

### 4.5 checkpoint 清理顺序

清理顺序固定为：

1. 原任务进入 terminal；
2. 结果通过归属和完整性门；
3. 节点应用结果；
4. 画布保存成功；
5. 客户端确认新 revision；
6. 写入 success proof；
7. 全部已接收任务均被证明收口后，才允许清除 checkpoint。

任一步失败都不得提前清理。尚有 pending 节点时保留人工「继续剩余节点 / 放弃剩余节点」。

### 4.6 多标签页与轮询

- 同一 `account + canvas + runId` 同时只允许一个恢复写入者；优先使用 Web Lock，需有可测试的租约 fallback。
- 一个 run 只有一个 poller；采用有上限的退避和终态停止。
- `AbortController` 覆盖画布切换、pagehide、unmount 和租约丢失。
- 其他标签页只观察持久化结果，不进行第二次节点写回。

## 5. 组合框拖动合同

### 5.1 第一优先方案：React Flow 原生拖动

移除组合框 body 上旧 `beginMove` 的全局 pointermove + 每帧 `setNodes` 路径，让组合框进入 `CanvasSurface` 已有的：

- `onNodeDragStart`；
- `nodeDragging`；
- `markCanvasInteraction`；
- `onNodeDragStop`；
- 统一撤销和持久化安静期。

必须逐项验证：组合框 body 可拖、标题和工具栏 `nodrag`、子节点不被误拖、运行中组合框语义、子节点相对坐标、撤销、多选和缩放 15.6% 下可见性。

### 5.2 回退方案：共享交互端口

若 React Flow 原生拖动不能保留组合框和子节点的既有语义，只允许增加共享端口：

```ts
beginCanvasInteraction("group-drag")
updateCanvasInteraction(...)
endCanvasInteraction(...)
```

它必须复用 `CanvasSurface` 的状态、撤销和 persistence gate。不得在 `GroupNode` 内另建保存队列、revision 管理或第二套拖动状态机。

### 5.3 持久化硬门

拖动期间：

- 不计算 drag-originated snapshot fingerprint；
- 不 enqueue drag-originated canvas save；
- 只更新屏幕交互所需状态。

拖动结束后：

- 合并为一次最终保存；
- 保存成功后刷新仍保持最终位置；
- pointerup、pointercancel、window blur、Escape、unmount 和 canvas switch 都必须结束交互，不能让 `nodeDragging` 卡死。

### 5.4 性能优化止损线

先修旁路和保存风暴，再用精确 fixture 复测。只有仍不达门时，才允许对组合框子内容做低负载渲染；不得在没有证据前扩成媒体缓存、edge 引擎或全节点重写。

## 6. 预计影响文件

以下是实施时的初步边界，实际施工前需重新只读定位；本方案不预先授权修改：

- `src/features/workflow/WorkflowExecutionProvider.tsx`
- `src/features/workflow/groupRunCheckpoint.ts`
- 可选小型 `groupRunReconciler.ts`，但不得同时吞并 UI、租约、保存和任务领域全部职责
- `src/features/generation/GenerationTasksPanel.tsx`
- `src/features/canvas/nodes/GroupNode.tsx`
- `src/features/canvas/CanvasSurface.tsx`
- `src/features/canvas/canvasPersistenceFacade.ts`
- 受影响测试：m22、m40、m2-group、m3-persistence、m79 或仓库届时的等价 spec

预期不需要：schema migration、OpenAPI、Provider adapter、OSS 接口或服务端新 API。若施工时证明同浏览器恢复也无法在既有任务 GET 合同内完成，应停止扩张并回到方案审计，不得暗中引入跨设备工作流系统。

## 7. 验收矩阵

### 7.1 自动恢复

| ID | 断言 |
|---|---|
| REC-01 | 刷新后只查询 checkpoint 绑定的原任务；generation POST 精确为 0 |
| REC-02 | 原任务 success 后，结果回填到原节点并保持唯一历史/媒体引用 |
| REC-03 | 原任务 queued/running 时只轮询原 taskId，直到终态或安全中止 |
| REC-04 | failed/cancelled 如实收口，不自动重提 |
| REC-05 | pending 节点绝不自动提交 |
| REC-06 | 节点编辑、revision 变化或 ownership mismatch 阻止覆盖 |
| REC-07 | task credential 或结果资产不完整时保留 checkpoint |
| REC-08 | 全部完成且画布保存确认后才清除 checkpoint |
| REC-09 | 部分完成时保留人工继续/放弃入口 |
| REC-10 | 双标签页同一 run 只有一个写入者 |
| REC-11 | v1 checkpoint 仍可读取并走安全人工流程 |
| REC-12 | 保存失败或冲突时 checkpoint 不清除 |

### 7.2 组合框拖动

| ID | 断言 |
|---|---|
| DRAG-01 | 组合框与其子节点视觉同步移动 |
| DRAG-02 | 子节点相对坐标不漂移 |
| DRAG-03 | 单标签纯拖动期间 drag-originated PUT 精确为 0 |
| DRAG-04 | 停止后最多一次合并保存 |
| DRAG-05 | 刷新后保留最终位置 |
| DRAG-06 | 本地 fake 媒体不产生拖动诱发的额外媒体请求 |
| DRAG-07 | 拖动期间 long task `>=100ms` 为 0 |
| DRAG-08 | controlled production build 的 frame p95 `<=25ms` |
| DRAG-09 | controlled production build 的 frame max `<100ms` |
| DRAG-10 | `>24ms` 的 dropped frame `<=5` |
| DRAG-11 | 15.6% 缩放下不闪白、不消失 |
| DRAG-12 | group run/stop、撤销、多选和工具栏交互不回归 |

性能数字只用于固定环境的候选门，不是对所有硬件和浏览器的永久性能承诺。最终仍需用户在真实账号画布上复验。

### 7.3 精确本地 fixture

- 3 个组合框；
- 每组 12 个子节点：7 text、4 image、1 video；
- 每组 24 条边；
- 全画布约 39 个节点、73 条边；
- 组合框约 2900×1660；
- 视口约 15.6%；
- 只使用本地 fake 媒体和 fake task，不访问真实 Provider、OSS 或生产路径。

## 8. 风险评估与应对

| 等级 | 风险 | 触发信号 | 应对与硬门 |
|---|---|---|---|
| P0 | 自动恢复误创建第二个付费任务 | 任何 generation POST | `accepted-tasks-only` 网络硬拦截；出现1次即失败 |
| P0 | 迟到结果覆盖用户新编辑 | snapshot/revision/ownership 不一致仍写回 | 全字段围栏，任一不一致 fail closed |
| P0 | 多标签页同时回填 | 同一 run 两个写入者 | Web Lock/租约；REC-10 必过 |
| P0 | checkpoint 提前删除 | 保存未确认却清除 | 固定清理顺序；REC-08/12 必过 |
| P1 | admission 后任务绑定丢失 | 节点只有 taskId 或刷新后 key 缺失 | admission 返回后立即持久化 `acceptedTasks` |
| P1 | 轮询风暴 | 一个 run 多 poller、无上限重试 | 单 poller、退避、abort、终态停止 |
| P1 | 成功任务结果不完整 | task success 但 asset/checksum 不完整 | 不写回、不清理，保留人工诊断入口 |
| P1 | 原生拖动破坏组合框语义 | 子节点错位、工具栏误拖 | DRAG-01/02/12；不通过则使用共享端口 |
| P1 | 拖动状态卡死 | blur/cancel 后仍禁止保存 | 覆盖全部结束事件并做回归 |
| P1 | 性能测试再次漏掉真实路径 | 简单 fixture 绿、富组合框仍卡 | 固定 rich-group fixture 和 production build 采样 |
| P1 | v1 checkpoint 不兼容 | 老画布被锁死 | 字段可选、parser 兼容、REC-11 |
| P2 | 提示过于技术化 | 用户不知道继续或放弃 | 明确说明“原任务仍在核对”，提供继续/放弃动作 |

## 9. 防止回归策略

1. 把「原任务恢复不得 POST」做成网络层不变量，不只测 UI 文案。
2. 把 checkpoint v1 兼容样本和 v2 acceptedTasks 样本作为长期 fixture。
3. 把双标签页租约、保存失败、结果不完整、节点被编辑四类负边界固化为自动测试。
4. 把富组合框 fixture 加入组合框专项，而不是扩大每次普通改动的 full suite。
5. 对拖动期间 PUT 数、媒体请求数和 long task 同时采样，防止“看起来顺”掩盖保存风暴。
6. 所有组合框新交互必须通过统一 interaction gate；代码审查禁止节点组件自建全局 pointermove + persistence 路径。
7. 性能证据绑定 Node/npm、production build、fixture、视口、缩放和采样方式，避免跨环境误比较。
8. 历史 PASS 保留；新条目只有在当前代码证据和用户实页复验后升级。

## 10. 实施顺序与验证策略

未来获得实施授权后按以下顺序执行：

1. R0：冻结身份、权限、基线、受影响合同和精确 fixture。
2. R1：先补预期红，证明重复 POST、迟到覆盖、双写、提前清理和拖动保存风暴会被测试捕获。
3. R2：实现 checkpoint 兼容扩展及 admission 后即时绑定。
4. R3：实现 `accepted-tasks-only` 对账、围栏、租约和清理时序。
5. R4：保留人工继续/放弃，改进提示。
6. R5：移除 `GroupNode` 旧拖动旁路，接入原生路径；必要时使用共享端口。
7. R6：补齐持久化硬门和所有 cancel/end 路径。
8. R7：在固定 rich-group fixture 上做行为和性能验收。
9. R8：只运行直接受影响定向；失败只复验失败或最小受影响范围。
10. R9：冻结候选并做独立 P0/P1 终审。
11. R10：若获得版本和发布授权，才在冻结候选上执行一次 safe full、GitHub 和发布链。
12. R11：生产只做零付费技术矩阵；最终状态进入 `USER_RECHECK`，不得替用户写 `USER_PASS`。

固定测试环境：Node `22.23.1`、npm `10.9.8`、fresh 临时数据、动态 loopback；不得使用 4173、`app/data`、`/var/lib/unboundry`、真实备份或真实媒体。

## 11. 提交、发布和回滚边界

- 用户已通过2026-08-25一次性Goal明确授权按本方案实施，并绑定`v0.6.42/schema41`完成commit、push、PR、tag、GitHub Release、生产发布和零付费验证；该授权只用于本Goal且执行后消费。
- 后续若获实施授权，建议拆为三个可审查提交：恢复合同、组合框拖动、测试与治理文档。
- 本事件预计无数据库迁移；checkpoint 新字段向后兼容，旧版本可忽略。
- 回滚时保留现有人工「继续剩余节点」安全路径；不得通过删除 checkpoint 绕开重复付费门。

## 12. Go / No-Go

以下任一项出现，候选不得发布：

- 自动恢复产生任何 generation POST；
- 迟到任务覆盖不匹配节点或新 revision；
- 同一 run 出现两个恢复写入者；
- 保存确认前清除 checkpoint；
- 单标签纯拖动期间持续产生 drag-originated PUT；
- 组合框移动后子节点相对坐标漂移；
- rich-group 行为或性能门失败；
- 人工继续/放弃路径失效；
- v1 checkpoint 不可读；
- 生产零付费门无法证明。

只有全部自动门通过并完成用户真实画布复验，相关新验收项才能由 `USER_RECHECK` 进入 `PASS`。
