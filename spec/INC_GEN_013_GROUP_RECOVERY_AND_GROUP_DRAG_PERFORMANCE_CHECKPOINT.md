# INC-GEN-013：整组刷新恢复与组合框拖动性能实时断点

更新时间：2026-08-25

状态：`LOCAL_ENGINEERING_COMPLETE / TARGETED_AUTO_PASS / P0_P1_REVIEW_PASS / V0_6_42_CANDIDATE / SAFE_FULL_EXECUTED_WITH_TARGETED_RECHECK / RELEASE_PENDING`

权威方案：`spec/INC_GEN_013_GROUP_RECOVERY_AND_GROUP_DRAG_PERFORMANCE_PLAN_2026-08-25.md`

## 1. 当前结论

- 截图提示是防重复付费安全门，不是 Provider 报错；服务端原任务已成功且结果媒体仍在 OSS，没有数据丢失证据。
- group run checkpoint 已向后兼容保存已接收任务完整绑定；刷新只核对精确 accepted task，pending 不自动提交，保存/revision/proof 完成前不清 checkpoint。
- `GroupNode.tsx` 旧自定义 `beginMove` 已移除；组合框使用 React Flow 原生拖动并统一进入 `CanvasSurface` 拖动态与 persistence quiet gate。
- 这不是后续 commit 把修复撤回；它是历史旁路和测试覆盖缺口，但对用户而言属于需要修复的实际体验回归。
- 人工「继续剩余节点」和放弃仍保留；本地自动与性能门已过，生产真实画布尚未复验，不能写 `USER_PASS`。

## 2. 文档工作区

| 项目 | 当前值 |
|---|---|
| 真实仓库 | `/Users/mymy/Documents/unboundry/app` |
| 文档隔离工作树 | `/private/tmp/unboundry-canvas-recovery-group-drag-plan-20260825` |
| 分支 | `codex/inc-canvas-recovery-group-drag-plan-2026-08-25` |
| 基线 / origin/main | `a0c8d285789ac2e51ff73e7c1ff48cd8676b560a` |
| package / schema | `0.6.42 / 41` |
| 生产 | `v0.6.41 / schema41 / USER_RECHECK` |

受保护 `spec/public-templates-director-split-revision.json` 未读取、修改、移动、删除、stage 或提交；真实主工作树未清理。

## 3. 生产只读证据摘要

| 证据 | 结论 |
|---|---|
| 画布 | `60a739ce-9cb4-4c46-9c77-92e9f6f22b49`，账号线索 `zzx` |
| 时间线 | 约09:56:45 CST重载；图片任务09:57:13成功 |
| 服务端任务 | Provider成功；当前无active task |
| 结果媒体 | OSS PNG 960×1280，1,261,318 bytes，仍存在 |
| 画布回填 | 节点保留task ID，但缺少asset/imageSrc/group-run success proof |
| 画布规模 | 3大组、39节点、73边；目标组约2900×1660、12子节点、24边；zoom约15.6% |
| 服务端性能 | 保存请求成功且低耗时，未发现服务端异常能解释拖动卡顿 |

## 4. 已冻结方案

### 4.1 恢复

- `GroupRunCheckpoint` 增加可选 `acceptedTasks[nodeId] = {kind,nodeId,taskId,ownershipKey}`；v1 继续可读。
- 服务端 admission 成功后立即写入绑定，再开始轮询。
- 页面加载只进入 `accepted-tasks-only`：只 GET 原 task，POST/重试/继续 pending/Provider/上传全部禁止。
- 写回必须同时匹配 account/canvas/group/run/node/kind/task/ownership/snapshot/revision。
- 同一 run 只允许一个恢复写入者；单 poller、退避、abort、终态停止。
- 先成功写回并确认画布 save/revision，再写 success proof 和清 checkpoint；失败保留 checkpoint。
- 自动恢复范围仅为同浏览器持久化范围；跨浏览器/设备或 local storage 被清空不在本事件内。

### 4.2 拖动

- 第一选择：移除 `GroupNode` 旧 `beginMove`，使用 React Flow 原生拖动和 `CanvasSurface` 现有交互门。
- 原生路径不能保持组合框语义时，才增加共享 `begin/update/endCanvasInteraction("group-drag")`，不得在 GroupNode 再造保存状态机。
- 拖动期间不 fingerprint、不 enqueue drag-originated save；结束后合并一次保存。
- pointerup/pointercancel/blur/Escape/unmount/canvas switch 必须全部释放拖动态。
- 先验证旁路和保存风暴；不达性能门时才考虑低负载子内容渲染。

## 5. 核心风险门

| 等级 | No-Go 条件 |
|---|---|
| P0 | 自动恢复产生任何 generation POST |
| P0 | 不匹配的迟到结果覆盖新编辑 |
| P0 | 同一 run 两个恢复写入者 |
| P0 | 保存确认前清除 checkpoint |
| P1 | v1 checkpoint 不可读或老画布被锁死 |
| P1 | 单标签纯拖动期间持续 PUT |
| P1 | 子节点相对坐标漂移、拖动态卡死或人工恢复失效 |
| P1 | 精确 rich-group fixture 的行为/性能门失败 |

## 6. 验收入口

- 恢复：REC-01～REC-12，详见权威方案第7.1节。
- 拖动：DRAG-01～DRAG-12，详见权威方案第7.2节。
- fixture：3组、39节点、73边、每组12子节点/24边、约2900×1660、zoom约15.6%，仅本地 fake media/task。
- 候选性能门：long task >=100ms 为0；frame p95 <=25ms；max <100ms；>24ms dropped frame <=5。
- 性能门只在固定 production build 环境判定；用户真实画布最终仍为 `USER_RECHECK`。

## 7. 当前执行证据

- [x] R0身份门：隔离worktree/分支、基线`a0c8d285…b560a`、Node`22.23.1`/npm`10.9.8`、4173 listener SHA`24c91e57…8244`均锁定；受保护JSON未读取、修改或stage。
- [x] R1 expected-red：m22为`35/37`，捕获accepted回调缺失和畸形binding未拒绝；m2为`4/5`，捕获旧`beginMove`旁路。
- [x] R2～R4：四类executor在admission后即时写binding；accepted-only只GET精确任务，pending POST为0；同run单租约/单poller，page-exit、续租失败、外来租约均abort；先save+revision+proof后清理。
- [x] R5～R6：移除GroupNode自建pointermove；pointerup/pointercancel/blur/Escape/unmount/canvas switch均释放拖动态；拖动按下期间PUT为0，结束至稳定最多1次PUT。
- [x] R7 rich fixture：3组/39节点/73边、每组12子节点和24边、2900×1660、zoom15.6%；p95`9.9ms`、max`10.3ms`、>=100ms long task`0`、dropped frame`0`、媒体请求`0`、最终画布PUT`1`，相对坐标/刷新/undo-redo/多选均通过。
- [x] 风险驱动回归：m1-selection-drag`6/6`、m2`5/5`、m3`6/6`、m40`14/14`、m79`3/3`；m22最终`37/37`。一次组合运行旧toast瞬态断言失败后改为持久租约证据；两次P1终审发现均已修复。
- [x] 独立只读审查原始发现2个P1（admission-to-binding窗口、外来租约未abort）；均已关闭，最终无已知P0/P1。
- [x] build与`git diff --check`通过；真实Provider、Generation、OSS写入、费用和生产变更均为0。
- [x] 本Goal唯一safe full在精确功能候选`31f0fcbc40cd7236bdfe3fdf4657c53de9b3ee4b`执行：121/121 specs、1060/1061 tests通过；唯一失败为未改动AI角色库筛选的瞬态计数断言。未重复full；相同源码快照只复跑失败spec `tests/m0-shell.spec.ts`，23/23通过。source/snapshot均为`3baf4f5d…97e41`，4173 listener保持`24c91e57…8244`不变；不把原始full改写成全绿。
- [ ] GitHub PR/CI/merge、tag/Release、生产发布与零付费生产矩阵尚未执行。

## 8. 唯一下一步

按Runbook完成GitHub PR/CI/merge、不可变`v0.6.42` tag/Release和零付费生产矩阵。任何真实Provider/Generation/OSS写入继续为0，最终只进入`USER_RECHECK`。
