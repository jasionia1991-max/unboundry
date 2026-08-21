# Unboundry 画布执行解耦施工 Checkpoint

更新时间：2026-08-21（最终safe full、独立复审、GitHub、冻结备份、生产发布、真实双组页面验收与用户验收完成）
状态：`PRODUCTION_PUBLISHED_USER_PASS`
用途：这是本轮治理唯一的可变施工状态。每个批次结束必须更新；上下文压缩或新 Session 接手时，先重新核对真实 Git/代码，再从“下一步唯一动作”继续。

## 1. 当前身份

- 仓库：`/Users/mymy/Documents/unboundry/app`
- 分支：`codex/unboundry-offline-remediation-2026-08-09`
- 最终自动验收候选 HEAD：`26525387ff02a34d8de1eae4d74ed51c11529a7a`
- package：`0.6.27`
- 发布身份：tag`v0.6.27`→tested commit`26525387ff02a34d8de1eae4d74ed51c11529a7a`；tree`3735ea655cc9f353b0ccfca1060221cea445ba0e`；PR #55 merge`93f0e46be78d04f7663444c3306f91081051dc9b`且main tree一致。
- 生产：`/opt/unboundry/current -> /opt/unboundry/releases/v0.6.27-canvas-execution-decoupling-20260821`；回执`spec/V0_6_27_PRODUCTION_RECEIPT_2026-08-21.json`。
- 预期工作树保留：`spec/public-templates-director-split-revision.json` 未跟踪，禁止提交、删除、改名。

新 Session 若发现分支、版本、目标、路径或权威文档与此冲突：不要开始 Goal 施工；先只读查清并报告。

## 2. 权威阅读顺序

1. `上线规矩.md`
2. `spec/UNBOUNDRY_CURRENT_STATE.md`
3. `README.md`
4. `spec/UNBOUNDRY_CANVAS_EXECUTION_DECOUPLING_PLAN_2026-08-21.md`
5. `spec/UNBOUNDRY_CANVAS_EXECUTION_ACCEPTANCE_MATRIX_2026-08-21.md`
6. 本文
7. `spec/INC_GEN_012_VIEWPORT_INDEPENDENT_GROUP_RUN_2026-08-20.md`
8. `spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md`
9. `TASKS.md` 当前区块
10. 与当前阶段直接相关的代码和测试

历史报告用于证据追溯；当前事实以 Git、代码、测试、数据库/日志和 `UNBOUNDRY_CURRENT_STATE.md` 为准。

## 3. 当前已实锤架构事实

- 四类节点组件已不再注册整组执行；静态 `NodeExecutorRegistry` 统一提供 Text/Image/Audio/Video 的preflight/run/recover/apply。
- `WorkflowExecutionProvider` 保留DAG、run生命周期、checkpoint、lease、锁和摘要；不再读取组件registration或DOM状态。
- `workflowRenderRetention.ts` 已删除；视口虚拟化会真实卸载离屏子节点，headless executor和durable task继续运行。
- checkpoint、lease和lock均按runId分槽；checkpoint写入强制与lease runId一致；不相交组可并行，重叠节点/直接输入在提交前阻止，一轮只清理自己的状态。
- 同页导航会先核对全部本地活跃run，再逐轮写入interrupted checkpoint并逐轮发停止事件；发现外来owner时在任何部分写入前失败关闭。
- 手动单节点提交与整组提交共用同一canvas/node租约冲突门；只有持有该runId的headless executor可显式放行自己的租约。
- 结果应用必须同时匹配runId、taskId、ownershipKey、nodeId和kind；不匹配结果只留在任务事实，不覆盖当前画布。
- m22双run浏览器fixture已证明A成功、A失败、A停止三种反例都不清除B；六个唯一runId、七个预期task POST和逐组摘要均核对通过；A整组真实卸载后，第二层仍提交、完成并落盘。
- v0.6.27真实新画布已证明两个不相交Text组同时active并各自2/2完成，刷新后结果仍在原节点；v0.6.26“运行中拖出视口仍完成11/11”保留为上一版历史止血证据。

## 4. 当前阶段

当前阶段：`COMPLETE / USER_PASS`

已完成：

- 固化总体方案、严格范围、阶段顺序、风险、回滚和自动推进边界；
- 固化验收矩阵、证据状态和测试预算；
- 建立跨 Session/上下文压缩续接的 Checkpoint；
- 采用风险驱动测试：小批次最小定向、节点领域、阶段中等回归、最终一次safe full；
- 明确普通阶段不需要用户逐项确认，只有授权红线和关键产品裁决才停下。
- 完成阶段0路径、身份、Git、版本、Node、工作树、安全 runner 与四类执行调用链复核；
- 完成三路独立只读审查：调用链、RunState/LockOwner 反例、测试映射；
- 确认旧组件 registration、render retention、scope 单槽 checkpoint/lease 和全局组串行是本轮必须替换的真实边界；
- 阶段1已建立静态 `NodeExecutorRegistry` 与四类 headless executor 草稿，并移除四类节点的 workflow registration；当前 TypeScript `--noEmit` 已通过。
- 阶段2已删除执行对 renderer retention 的依赖；运行节点真正离屏卸载，执行仍由 headless executor 和 durable task 继续；
- 阶段3已把 checkpoint/lease 改为 runId 分槽，节点锁按 runId 求并集；不相交租约并存，重叠锁在提交前拒绝，一轮清理只删除自己的 checkpoint/lease/锁；
- 阶段4已把 `runId + taskId + ownershipKey + nodeId/kind` 作为结果应用门槛，旧轮次/删除节点/新任务绑定不匹配时只保留任务结果，不覆盖画布；
- 阶段5生成细节集中到 `workflowNodeExecutors.ts`，Provider保留DAG、run生命周期、锁、checkpoint和摘要，CanvasSurface只执行交互锁策略；
- package候选版本已选择 `0.6.27`。
- 三类独立终审已完成：架构终审在HEAD `2652538`确认P0=0、P1=0并允许final full；测试终审确认无新的P0/P1实现阻断，同时要求对组合证据边界保持诚实，矩阵已同步这些边界。
- 最终候选HEAD `26525387ff02a34d8de1eae4d74ed51c11529a7a`已完成唯一一次正式safe full：119/119 specs、1029/1029 tests全部通过。
- release reviewer采用“tag精确指向tested commit，PR/main保持同tree，docs/receipt后置”的不可变身份方案放行；注释tag和PR #55已发布并核对main tree一致。
- 服务器从tag immutable archive构建；Node22.23.2/npm10.9.8、tsc、Vite build、5800行inventory校验通过。冻结备份`v0.6.27-frozen-yaet3a`含365文件，双清单SHA一致，restore DB schema39/integrity ok/FK0。
- 生产切换成功：service active/enabled、NRestarts0，公网/回环version 0.6.27，5个构建资源逐字节一致；切换前数据590 tasks/598 attempts/50 templates/48 published/active0未变。
- 新建真实技术画布`0f92bbc0-b30a-4c1d-bef2-ecf15216ac01`；A/B两个不相交文字组于557ms内先后启动并同时active。并发轮4 tasks/4 attempts全部attempt1 success、重复0；连同前置A组控制轮共6 tasks/6 attempts，active归零、OSS写0。A/B摘要各2/2，刷新后四个结果仍在精确原节点，已保存到云端，应用console error/warn 0。

非阻断后续：

- VIEW-005精确98/171/200档位未跑，归product engineering后续性能专项；已有m79 60节点与m1 62节点代表性回归，不冒充精确档位通过。
- 用户于2026-08-21明确回复「v0.6.27 验收通过，同步更新为 USER PASS。」状态已据实收口为`USER_PASS`。

## 5. 当前施工文件

- `spec/UNBOUNDRY_CANVAS_EXECUTION_DECOUPLING_PLAN_2026-08-21.md`（新增）
- `spec/UNBOUNDRY_CANVAS_EXECUTION_ACCEPTANCE_MATRIX_2026-08-21.md`（新增）
- `spec/UNBOUNDRY_CANVAS_EXECUTION_CHECKPOINT.md`（新增）
- `client/src/generation/nodeExecutorRegistry.ts`（新增，静态执行器注册表）
- `client/src/generation/workflowNodeExecutors.ts`（新增，四类执行/preflight/recover/apply）
- `client/src/generation/WorkflowExecutionProvider.tsx`（改为按类型调用静态执行器）
- `client/src/canvas/ProbeNode.tsx`（新增 workflow run ownership 标记）
- `client/src/canvas/TextNode.tsx`、`ImageNode.tsx`、`AudioNode.tsx`、`VideoNode.tsx`（移除 workflow registration；组件恢复避让 workflow-owned task）
- `client/src/canvas/CanvasSurface.tsx`、`client/src/styles.css`（移除保活，改为精确参与节点锁；允许无关新增/复制/粘贴/选择/连接/删除）
- `client/src/generation/groupRunCheckpoint.ts`、`generationTasks.ts`（runId 分槽 checkpoint/lease、跨标签节点冲突、精确释放）
- `tests/m22-group-execution.spec.ts`（registry、无render依赖、分槽租约/checkpoint、真实卸载、无关交互、双run成功/失败/停止隔离）
- `scripts/run-safe-tests.mjs`、`scripts/source-coverage-manifest.json`（测试库存从1025增至1029并同步安全manifest）
- `package.json`、`package-lock.json`（0.6.27）

生产未修改schema、Provider/Storage配置、OSS对象或历史回执；当前权威文档已同步v0.6.27发布事实。未跟踪模板文件保持原样且未进入commit、tag、PR、archive或release。

## 6. 本批测试与证据

阶段0～5当前证据：

- `node scripts/run-safe-tests.mjs preflight`：退出码0；119 specs；安全入口确认；4173 listener unchanged。
- `/Users/mymy/.hermes/node/bin/node node_modules/typescript/bin/tsc --noEmit`：退出码0（移除四类旧 registration 并修正 executor 类型后）。
- 三路只读审查确认：HEAD 的四类执行均依赖 React `useEffect` registration；Provider resume 轮询不等于 exact task recover；scope 单槽 checkpoint/lease 与 scope-wide finally 无法安全支持多 run。
- 真实 Provider、生产检查与正式发布证据见本节末和v0.6.27回执；此前定向证据不替代最终全量。
- `node scripts/run-safe-tests.mjs run --spec tests/m22-group-execution.spec.ts`：37/37 PASS；覆盖四模态headless preflight/run/recover/apply、DAG、离屏真实卸载后第二层提交与结果落盘、运行期无关编辑/移动/连接/删除/复制、参与图锁、checkpoint/lease runId门、精确放弃、多run导航，以及双run成功/失败/停止隔离；4173 unchanged。
- `node scripts/run-safe-tests.mjs run --spec tests/m40-generation-idempotency-recovery.spec.ts`：14/14 PASS；覆盖共享四节点幂等、丢响应reconcile、一次POST。
- `node scripts/run-safe-tests.mjs run --spec tests/m41-generation-retry-ui.spec.ts`：51/51 PASS；覆盖四节点恢复、迟到结果、输入变化、保存失败/重放。
- `node scripts/run-safe-tests.mjs run --spec tests/m68-generation-tasks-panel.spec.ts`：4/4 PASS；任务面板和exact reconcile无回归。
- `node scripts/run-safe-tests.mjs run --spec tests/m38-generation-runtime-incidents.spec.ts`：15/15 PASS；CURRENT_STATE候选版本权威同步通过。
- `node scripts/run-safe-tests.mjs run --spec tests/m44-provider-profile-atomicity.spec.ts`：8/8 PASS；第一轮全量中的WAL sidecar并发偶发未复现，独立进程原子性领域通过。
- 最终正式回执：候选HEAD `26525387ff02a34d8de1eae4d74ed51c11529a7a`执行`node scripts/run-safe-tests.mjs full`退出码0；119/119 specs、1029/1029 tests，failed/skipped/retries/blocked/reportErrors均0；Node22.23.1、npm10.9.8、575个source files，immutable builder attempts1/invocations5/failures0，denied Vite wildcard probes 522；source/snapshot SHA均为`bef8b0f3c0204a6634dd45753d0700827eb8df6de0a7abb992f144116cf535d6`，4173 listener SHA前后同为`24c91e579e5f03e4327568db06303d4f094c0250c63228866946f7b8a47b8244`；受保护未跟踪JSON未进入source/snapshot。
- 组合证据边界：UX通用锁由wrapper pointer-events、持续aria、禁用控件和任务摘要共同证明，不声称逐一点击每个同类控件；共享冲突页面fixture直接覆盖durable外部Text输入，其余重叠结构由锁集合单元反例覆盖；STATE-007删除后归属和STATE-009旧轮次结果分别由owner gate/迟到结果反例直接证明。
- 生产回执：`spec/V0_6_27_PRODUCTION_RECEIPT_2026-08-21.json`完整记录tag/PR/main tree、archive、构建、inventory、冻结备份、生产数据门、真实group/node/task ID、并发时间窗和页面刷新结果。成功完成后checkpoint/lease按设计清理，浏览器不再持久保留runId；文档不编造runId，以持久group/node/task ID和数据库时间窗替代。

## 7. 测试政策摘要

- 小修改：类型检查 + 1～3个最小相关测试；
- 单一节点类型完成：该节点执行/任务/恢复领域测试；
- 阶段完成：按风险选择中等范围回归；
- 核心执行迁移完成：一次核心架构回归；
- 最终候选：一次正式安全全量；
- 同一 HEAD/环境/结果不重复；
- 扩大测试必须记录风险传播路径；
- 不把完整长日志写入上下文，只记录命令、环境、退出码、数量和失败项。

## 8. 自动推进与一次性全授权

用户已于 2026-08-21 明确要求：本 Goal 的全部范围内步骤自动推进，用户不逐项确认，只验收最终结果是否符合治理文档。

已授权自动完成：

- 只读审查、代码/文档编辑、临时测试环境、风险匹配测试和子 Agent 审查；
- 按阶段建立本地提交；
- 选择实施完成时真实 package 的下一个补丁版本；
- 最小必要、最低合理规格、有界重试的真实 Provider 验证；
- push、PR、tag、最终发布、生产切换、必要重启、生产技术验收和失败回退；
- 在目标确实无法绕开时，对精确目标执行已备份、已验证恢复路径的最小可逆真实数据操作。

自动安全限制：

- 整个治理只发布一个最终候选，不按阶段反复上线；
- 已受理或状态未知的真实任务先 exact reconcile，不重复提交；
- 发布前必须建立并验证冻结备份和精确回退点；
- 真实数据/媒体/备份默认不删不改；无法绕开时也禁止广泛、未解析、不可恢复操作；
- 保留并绕开无法识别的用户改动，禁止 reset/clean/静默覆盖；
- 产品选择服从治理方案和既有合同；未覆盖时采用最保守、可回退、不损数据、不重复付费、不恶化手感的方案，并记录决定；
- 触发红线后自动停止影响面、保存证据、回退或修复，满足闸门后继续。只有外部状态或权限确实不可恢复、安全路径不存在时才标 `BLOCKED`，不为普通步骤向用户提问。

这次授权只适用于本 Goal，完成或 `BLOCKED` 后失效。Agent 技术实页通过不等于用户主观 `USER_PASS`。

## 9. 子 Agent安排

- 主 Agent 负责核心实现、证据复核、测试执行和文档更新；
- 子 Agent 默认只读，分别检查调用链、并发/状态机、测试反例和UX；
- 子 Agent 不得用共享工作区同时修改核心文件，除非获得互不重叠的明确范围；
- 主 Agent 必须复核子 Agent 的文件行、命令和结论。

## 10. 停止红线

- 重复真实提交；
- 旧结果覆盖新编辑；
- 已提交任务无持久化记录；
- 一轮清除另一轮状态/锁；
- 旧画布/媒体数据损坏；
- 无法判断 Provider 是否提交；
- 必须删除/手改真实数据才能继续；
- 只能放宽安全校验让测试通过；
- 当前阶段被迫扩张成三个以上无关核心模块的同时重写。

触发后：保存证据、更新本文、停止后续阶段；不得把 Goal 标成完成。

## 11. 下一步唯一动作

本Goal已由用户明确验收通过，无待办验收动作。精确98/171/200节点性能档位由product engineering在v0.6.27后单独处理，仍是非阻断独立性能专项，不改写为已验证。

## 12. 最终完成前复核

Goal结束前必须确认：

- 方案、矩阵、Checkpoint、代码和Git状态一致；
- 所有P0项有证据且无BLOCKED；
- 受控真实测试、最终发布和生产技术验收具有完整证据；
- 自动PASS、Agent页面PASS、USER_RECHECK、USERPASS保持区分；
- 三类独立复核完成且主Agent复核证据；
- 没有必做项被转成“后续优化”以迎合完成。
