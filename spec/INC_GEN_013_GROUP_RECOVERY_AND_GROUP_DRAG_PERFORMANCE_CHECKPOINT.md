# INC-GEN-013：整组刷新恢复与组合框拖动性能实时断点

更新时间：2026-08-25

状态：`PLAN_FROZEN / IMPLEMENTATION_NOT_STARTED / USER_REVIEW`

权威方案：`spec/INC_GEN_013_GROUP_RECOVERY_AND_GROUP_DRAG_PERFORMANCE_PLAN_2026-08-25.md`

## 1. 当前结论

- 截图提示是防重复付费安全门，不是 Provider 报错；服务端原任务已成功且结果媒体仍在 OSS，没有数据丢失证据。
- 当前缺口是 group run checkpoint 没有可靠保存已接收任务的完整绑定，刷新后无法在严格归属门下自动接回原任务。
- 组合框拖动卡顿的直接代码路径是 `GroupNode.tsx` 旧自定义 `beginMove`：pointer move 每次直接 `setNodes`，并绕过 `CanvasSurface` 的统一拖动态和 persistence quiet gate。
- 这不是后续 commit 把修复撤回；它是历史旁路和测试覆盖缺口，但对用户而言属于需要修复的实际体验回归。
- 当前唯一安全人工恢复仍是任务面板的「继续剩余节点」或明确放弃，不得删除 checkpoint 或重新开一轮绕过。

## 2. 文档工作区

| 项目 | 当前值 |
|---|---|
| 真实仓库 | `/Users/mymy/Documents/unboundry/app` |
| 文档隔离工作树 | `/private/tmp/unboundry-canvas-recovery-group-drag-plan-20260825` |
| 分支 | `codex/inc-canvas-recovery-group-drag-plan-2026-08-25` |
| 基线 / origin/main | `a0c8d285789ac2e51ff73e7c1ff48cd8676b560a` |
| package / schema | `0.6.41 / 41` |
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

## 7. 当前未执行

- [ ] 未修改应用代码
- [ ] 未修改数据库 schema 或 OpenAPI
- [x] 文档治理定向m38最终`15/15 PASS`；首次因CURRENT_STATE一句话未满足既有机器正则而`14/15`，修正文案后按最小spec复验通过
- [ ] 未运行INC-GEN-013新功能测试、safe full 或生产浏览器矩阵
- [ ] 未 commit、push、创建 PR/tag/Release
- [ ] 未执行 Provider、OSS、付费请求或生产写入
- [ ] 未取得新版本号和发布授权
- [ ] 未进入 `USER_RECHECK` 或 `USER_PASS`

## 8. 唯一下一步

等待用户另行明确启动实施。获得授权后，从权威方案 R0 开始：重新只读冻结基线与精确 fixture，先补 REC/DRAG 预期红；不得从写代码、发布或删除 checkpoint 开始。
