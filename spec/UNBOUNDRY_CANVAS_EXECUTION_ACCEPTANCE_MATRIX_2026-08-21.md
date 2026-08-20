# Unboundry 画布执行解耦验收矩阵

更新日期：2026-08-21  
状态：`PHASE_6 / TARGETED_AUTO_PASS / FINAL_FULL_PENDING`
关联方案：`spec/UNBOUNDRY_CANVAS_EXECUTION_DECOUPLING_PLAN_2026-08-21.md`  
当前进度：`spec/UNBOUNDRY_CANVAS_EXECUTION_CHECKPOINT.md`

## 1. 状态与证据纪律

允许状态：

- `PLANNED`：已定义但尚未实施；
- `NOT_RUN`：已实现但当前证据尚未执行；
- `AUTO_PASS`：自动测试有明确命令、环境和退出码；
- `AGENT_PAGE_PASS`：Agent 在受控页面完成技术验收；
- `USER_RECHECK`：自动/Agent 证据已具备，等待用户主观复验；
- `USER_PASS`：用户明确确认；
- `BLOCKED`：存在阻断，必须附原因；
- `NOT_APPLICABLE`：经产品裁决不适用。

结论标签：`已实锤 / 高可信推断 / 未验证 / 已否定`。测试输出被截断、没有退出码、环境不明确、只看代码推测时，不得写 `AUTO_PASS`。

本矩阵只验收本轮新架构。v0.6.26 的历史真实页面通过是基线证据，不自动证明解耦后的实现通过。

## 2. 执行器与视口生命周期

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| EXEC-001 | P0 | Text 执行器不依赖 TextNode 挂载/registration | 不挂载组件的执行器测试 + 代码审查 | AUTO_PASS（m22） |
| EXEC-002 | P0 | Image 执行器不依赖 ImageNode 挂载/registration | 同上，覆盖上传/结果应用 | AUTO_PASS（m22四模态headless preflight/run/recover/apply + m41） |
| EXEC-003 | P0 | Audio 执行器不依赖 AudioNode 挂载/registration | 同上，覆盖异步任务恢复 | AUTO_PASS（m22四模态headless preflight/run/recover/apply + m41） |
| EXEC-004 | P0 | Video 执行器不依赖 VideoNode 挂载/registration | 同上，覆盖提交/轮询/恢复 | AUTO_PASS（m22四模态headless preflight/run/recover/apply + m41） |
| EXEC-005 | P0 | 新旧执行路径不能同时真实提交 | 互斥单元测试 + task/attempt 数量断言 | AUTO_PASS（m22六个run共七个预期task POST且无重复 + m40 shared admission） |
| EXEC-006 | P0 | 已有旧任务可以由新路径 exact recover，不重新提交 | 任务 fixture + Provider POST=0 | AUTO_PASS（m41 四模态恢复POST=0） |
| VIEW-001 | P0 | 开始时部分子节点离屏仍能完整预检/运行 | 浏览器 fixture + DAG终态 | AUTO_PASS（m22 真卸载离屏Image静态预检） |
| VIEW-002 | P0 | 运行中把当前/下游/整组拖出屏幕后继续 | 浏览器 fixture + task/summary断言 | AUTO_PASS（m22 A组离屏卸载后success、B继续） |
| VIEW-003 | P0 | 节点真正卸载后执行仍继续 | mount/unmount 探针 + 运行终态 | AUTO_PASS（m22） |
| VIEW-004 | P0 | 删除 `workflowRenderRetention` 后无执行回归 | 代码不存在依赖 + VIEW-001～003 | AUTO_PASS（m22 + 文件已删除） |
| VIEW-005 | P1 | 98/171/200 节点仍保留视口虚拟化和可接受交互 | 挂载数/长任务/浏览器指标 | PLANNED |

## 3. 运行期间使用手感与精确保护

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| UX-001 | P0 | 生成期间可平移、缩放、打开面板 | 浏览器交互断言 | AUTO_PASS（m22） |
| UX-002 | P0 | 生成期间可新增和编辑无关节点 | graph diff + 保存结果 | AUTO_PASS（m22运行中编辑及复制/粘贴无关Text） |
| UX-003 | P0 | 无关节点可移动、连接、删除且不影响运行组 | graph/task 双断言 | AUTO_PASS（m22运行中移动Text、连接无关Image、删除无关图，双run仍继续） |
| UX-004 | P0 | 运行组的 Prompt/模型/参数/输入媒体修改被阻止 | 操作级策略测试 + 可见提示 | AUTO_PASS（m22） |
| UX-005 | P0 | 运行组节点/依赖边删除被阻止且不静默 | 浏览器交互 + 提示文本 | AUTO_PASS（m22 participant删除保持原图；组颜色/布局/模板/解组均持续禁用） |
| UX-006 | P1 | 移动运行组位置不改变本轮语义输入和结果归属 | snapshot/fingerprint断言 | AUTO_PASS（m22） |
| UX-007 | P0 | 所有被阻止操作都有持续可理解反馈，不只靠短 toast | 页面检查 + a11y/DOM证据 | AUTO_PASS（m22 持续锁样式、停止按钮、任务面板running摘要） |

## 4. 多工作流并发与锁

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| RUN-001 | P0 | 同画布两个不相交工作流可以同时运行 | 双run fixture + 独立task集合 | AUTO_PASS（m22 双组并行，六个独立run/task） |
| RUN-002 | P0 | A完成后B继续，B状态/锁不被清除 | 状态机反例测试 | AUTO_PASS（m22 A success后B仍active） |
| RUN-003 | P0 | A失败后B继续 | 状态机反例测试 | AUTO_PASS（m22 A failed后B仍active并success） |
| RUN-004 | P0 | A停止后B继续，A不再调度新节点 | 双run停止测试 | AUTO_PASS（m22 A cancelled后B仍active并success） |
| RUN-005 | P0 | 两组同时完成不会互相覆盖摘要/checkpoint | 并发终态测试 | AUTO_PASS（m22六个唯一runId、逐组终态计数、per-run checkpoint及精确放弃保留兄弟轮次） |
| RUN-006 | P0 | 共享可变输入/输出/结构时提交前阻止 | 冲突集合测试 + Provider POST=0 | AUTO_PASS（m22 lease） |
| RUN-007 | P0 | 冲突提示列出真实冲突节点/原因 | UI摘要 + lock evidence | AUTO_PASS（m22 lease反例 + 提示绑定角色/标题/节点ID） |
| RUN-008 | P0 | 一轮只能释放自己的锁 | lock owner不变量测试 | AUTO_PASS（m22 checkpoint/lease runId一致性门与精确清理） |
| RUN-009 | P0 | 双击/跨标签不能创建第二轮或第二次付费提交 | lease + idempotency测试 | AUTO_PASS（m22+m40） |
| RUN-010 | P1 | 并行仍受账户/模态/Provider有界并发，超出明确queued | 服务端队列与状态测试 | PLANNED |

## 5. 状态所有权、恢复和结果冲突

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| STATE-001 | P0 | 节点 `loading` 不作为任务是否提交的权威 | 代码审查 + 丢UI状态恢复测试 | AUTO_PASS（m22 headless owner gate + m41 UI丢失恢复） |
| STATE-002 | P0 | 刷新后从任务/checkpoint重建每轮状态 | 浏览器刷新 + task证据 | AUTO_PASS（m22多checkpoint枚举/逐轮保留 + m41 reload exact recover） |
| STATE-003 | P0 | 切换画布再回来仍能核对运行 | 多画布fixture | AUTO_PASS（m22一次导航中断同页全部本地run并逐轮存checkpoint + m41 exact recover + m66多画布返回） |
| STATE-004 | P0 | Provider已受理但客户端丢响应时先reconcile | Provider POST计数=1 | AUTO_PASS（m40） |
| STATE-005 | P0 | 旧结果遇到节点新编辑时不覆盖 | revision/fingerprint冲突测试 | AUTO_PASS（m22+m41） |
| STATE-006 | P0 | 冲突结果仍可在任务/结果入口找到 | 页面和持久化断言 | AUTO_PASS（m41旧结果不覆盖 + m68任务入口） |
| STATE-007 | P0 | 目标节点删除后结果不写入其他节点 | ownership反例测试 | AUTO_PASS（owner gate） |
| STATE-008 | P0 | 保存失败不清除任务事实、不触发重复提交 | save failure + POST计数断言 | AUTO_PASS（m40+m41） |
| STATE-009 | P0 | 旧run迟到结果不能覆盖新run摘要/结果 | run sequence/ownership测试 | AUTO_PASS（m22 runId/taskId/ownershipKey/nodeId/kind owner gate + m41迟到结果反例） |
| STATE-010 | P1 | 未知旧数据/未知版本拒绝覆盖原画布 | 兼容/迁移反例测试 | PLANNED |

## 6. 画布边界与回归

| ID | 级别 | 验收项 | 最低证据 | 当前状态 |
|---|---|---|---|---|
| ARCH-001 | P0 | 渲染层不能直接提交Provider | 依赖/调用链审查 | AUTO_PASS（静态审查） |
| ARCH-002 | P0 | 执行层不读取React组件/DOM状态 | 静态审查 + 测试 | AUTO_PASS（m22） |
| ARCH-003 | P0 | UiState不参与任务恢复与幂等判断 | 静态审查 + 状态丢失测试 | AUTO_PASS（m40+m41） |
| ARCH-004 | P1 | CanvasSurface不再处理节点类型的生成细节 | 调用边界审查 | AUTO_PASS（静态审查） |
| ARCH-005 | P1 | 持久化写入经明确适配器/命令边界 | 调用边界审查 +保存测试 | AUTO_PASS（m22） |
| REG-001 | P0 | 现有单节点生成、重试、停止、任务面板不回归 | 风险匹配领域回归 | AUTO_PASS（m40+m41+m68） |
| REG-002 | P0 | 现有DAG分流/汇流/失败传播语义不回归 | m22相关测试 | AUTO_PASS（m22） |
| REG-003 | P0 | 画布revision、保存和恢复不回归 | m3/m85/m98相关测试 | NOT_RUN（最终safe full覆盖） |
| REG-004 | P1 | 普通选择、拖拽、连接、删除、撤销不回归 | 相关画布交互测试 | NOT_RUN（最终safe full覆盖） |
| REG-005 | P0 | 最终安全全量通过且无真实Provider/生产数据访问 | safe runner完整回执 | PLANNED |

## 7. 测试选择与执行预算

| Gate | 默认测试 | 不应默认运行 |
|---|---|---|
| 小修改 | 类型检查 + 1～3个直接相关测试 | full、无关媒体/权限/备份 |
| 节点类型完成 | 当前节点执行/任务/恢复领域测试 | 其他节点全套 |
| 阶段完成 | m22/m38/m40/m68/m85/m98等按影响选择 | 全部119 specs |
| 核心迁移完成 | 一次核心架构回归 | 重复相同HEAD结果 |
| 最终候选 | 一次正式safe full | 第二次无理由full |

扩大测试范围必须在 Checkpoint 写明风险传播路径。相同 HEAD、相同环境和相同结果不得无理由重复运行。

## 8. 人工、真实验证与发布边界

- 用户已于 2026-08-21 对本 Goal 给出一次性全授权：零付费浏览器验收、最小必要真实 Provider 生成、版本选择、push/PR/tag、最终发布、生产技术验证和必要回退均自动推进，不逐项确认；
- 真实调用仍必须最小、有界、可对账；已受理或状态未知时先 exact reconcile，不得重复付费；
- 整个治理只发布一个最终候选版本，不按阶段反复上线；
- 发布前后必须有冻结备份、精确版本/提交/树/数据证据和可执行回退点；
- `AGENT_PAGE_PASS` 或 `PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS` 不等于 `USER_PASS`；
- 用户没有主观复验时，使用手感相关最终状态最高只能到 `USER_RECHECK`。

## 9. Goal完成闸门

本地治理 Goal 完成至少要求：

1. 所有 P0 项不再是 `PLANNED/NOT_RUN/BLOCKED`，且有合格自动或页面证据；
2. P1 未完成项必须证明不阻断核心目标并写明后续归属；
3. `REG-005` 通过；
4. 三类独立复核完成；
5. Checkpoint、本文、代码和 Git 状态一致；
6. 受控真实付费验证、最终发布和生产技术验收已按证据完成；用户主观复验仍保持 `USER_RECHECK`，不得虚报为 `USER_PASS`。
