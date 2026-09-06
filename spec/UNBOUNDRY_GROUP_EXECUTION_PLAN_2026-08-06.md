> **历史方案入口（2026-09-06）**：本文保留原规划/阶段验收，不作为当前实现清单或施工授权。已发布v0.7.14的实际结构、参数与未决项见 [CURRENT_STATE](UNBOUNDRY_CURRENT_STATE.md)、[生成结构](UNBOUNDRY_GENERATION_ARCHITECTURE.md) 和 [文档索引](PROJECT_DOCUMENTATION_INVENTORY_2026-09-06.tsv)。旧“未接入/未部署/等待发布”不得脱离日期直接当当前待办；独立PARTIAL/PAUSED仍需原范围证据。

# 整组执行（Group Run）实现方案

状态：`APPROVED`（用户 2026-08-06 确认方案，实施中）
适用版本：私有复刻当前代码基线

## 1. 目标

把 Group 工具栏上的“整组执行”从禁用状态接通为一个真正的工作流执行器：
点一次按钮，组内所有可执行的生成节点按依赖关系自动“流水式”执行：

- 同一层的节点并行提交；
- 上一层全部完成后，下一层自动开始；
- 执行中按钮变“取消”，可中途停止；
- 结束给出成功 / 失败 / 未就绪 / 已取消的明确提示。

## 2. 事实依据

### 2.1 Unboundry 前端代码（v2.12.16 构建，2026-08-06 取证）

`vendor-pkg-canvas-3XsW7E77.js` 中 Group 执行逻辑：

- 按钮文案 `common.runAll`（中文“整组执行”），执行中变 `common.cancel` 并显示 spinner；
- 点击时校验组内有可执行节点，否则直接返回；
- 收集组内子节点和“两端都在组内”的连线；
- `buildDependencyGraph`（邻接表 + 入度）→ `getLayeredExecutionOrder`（Kahn 分层）→ 逐层执行；
- 每一层内 `Promise.all` 并行提交节点任务；
- 层内任一节点失败 → 报“执行失败”并停止；任一节点被跳过 → 停止（不报成功）；
- 层间先提交、再等待该层全部任务到达终态；
- `cancelWorkflow` 只置取消标志：已提交的当前层继续跑完，后续层不再调度；
- 多于一层时逐层提示“正在执行第 x/y 层”。

### 2.2 Dify 官方文档

`docs.dify.ai` “Orchestration Logic”：串联节点按顺序执行且可读取链路前方变量；
互不依赖的并行分支同时执行；分支汇合后下游节点可读取所有上游结果。

## 3. 设计

### 3.1 可复用执行层（不绑定 Group）

- `client/src/generation/workflowExecution.ts`：纯函数模块
  - `isExecutableWorkflowNode(node)`：判断节点是否可执行；
  - `buildWorkflowLayers(nodes, edges)`：只取组内连线，Kahn 分层，检测循环；
  - `runWorkflowLayers(...)`：逐层并行执行，支持取消、失败/跳过即停、层进度回调。
- `client/src/generation/WorkflowExecutionProvider.tsx`：
  - 节点执行登记表：Text/Image/Video/Audio 把各自的“运行函数”登记进来；
  - 组执行入口：`executeGroup(groupId)`、`cancelGroup(groupId)`、执行中分组集合；
  - 复用各节点现有生成逻辑，不复制提交/轮询/重试/幂等代码。

该执行层以后可复用于“整画布执行”“Agent 批量执行”等场景。

### 3.2 可执行节点判定

| 节点类型 | 判定 | 说明 |
|---|---|---|
| text | `textPromptReady && textPrompt.trim()` 非空 | 纯笔记（无生成指令）不执行 |
| image/video/audio | `promptReady === true` 且（自身有提示词 **或** 有上游文字节点） | 纯上传位/参考位即使带旧生成标记也不执行；无提示词但由上游文字提供指令时可执行 |
| group/playlist/probe/storyboard | 不执行 | 容器类节点 |

> 2026-08-06 修正：最初按 `promptReady` 判定，导致旧画布中已上传素材的参考位（仍带旧生成标记）被当成执行节点，
> 第一层全部“未就绪”导致整组执行立即停止。现改为“自身提示词或上游文字”双条件，上传位永不参与执行；
> 该修正对已套用的旧模板画布同样生效，无需重新铺模板。

### 3.3 依赖图与分层

- 只使用“两端都在组内”的连线；
- 组外上游视为已就绪（节点自身 preflight 会决定是否可提交）；
- 自环忽略；环导致无零入度层时抛“循环依赖”并停止。

### 3.4 节点运行结果

节点登记的运行函数返回 `success | failed | skipped | busy`：

- `success`：任务成功、结果已落到节点；
- `failed`：任务失败或提交异常；
- `skipped`：未就绪（缺提示词/缺参考素材/验收页）；
- `busy`：该节点已在生成中。

判定方式：调用节点现有生成函数前抓取 live 节点状态，结束后对比任务 id /
成功标志 / 错误字段；不改动节点现有交互。

### 3.5 执行规则（对齐 Unboundry）

- 任一节点失败 → 停止，toast“整组执行失败”；
- 任一节点被跳过 → 停止，toast“有节点未就绪，整组执行已停止”；
- 节点 `busy` → 视为未就绪，停止并提示；
- 取消 → 停止调度后续层，当前层已提交任务继续跑完；
- 多于一层时逐层 toast“整组执行中：第 x/y 层”；
- 全部成功 → toast“整组执行完成”。

### 3.6 UI

- Group 工具栏“整组执行”：
  - 无可执行子节点 / 验收 fixture 页面 → 禁用并显示原因 tooltip；
  - 本组执行中 → 按钮变“取消”+ spinner，可点击停止；
- 执行提示复用项目现有 toast 样式（与“已添加到播放列表”同款）；
- 每个节点仍显示自己的生成/失败/重试状态。

### 3.7 安全与一致性

- 费用、并发、每日/每月上限完全沿用现有服务端任务保护；
- 每个节点提交前仍执行 `flushCanvasSave()`（先保存画布 revision 再提交）；
- 防重复提交沿用每节点幂等键；
- 验收/fixture 页面不触发生成，保持零付费请求；
- 组执行不自动提交“还没就绪”的节点，不伪造成功。

## 4. 边界情况

| 情况 | 行为 |
|---|---|
| 空组 / 无可执行节点 | 按钮禁用 |
| 循环依赖 | 提示“工作流存在循环依赖”，不执行 |
| 执行前已有节点在跑 | 不启动，提示先完成当前生成 |
| 执行中用户修改画布 | 每节点提交前 flushCanvasSave，服务端 revision 校验兜底 |
| 执行中删除分组 | 取消本次执行 |
| 多分组同时执行 | 各分组独立状态，互不阻塞（服务端并发/费用保护兜底） |
| 嵌套分组 | 本版只跑直接子节点；嵌套组视为容器，后续可扩展 |

## 5. 改动范围

新增：

- `client/src/generation/workflowExecution.ts`
- `client/src/generation/WorkflowExecutionProvider.tsx`
- `spec/UNBOUNDRY_GROUP_EXECUTION_PLAN_2026-08-06.md`

修改：

- `TextNode.tsx` / `ImageNode.tsx` / `VideoNode.tsx` / `AudioNode.tsx`：登记运行函数
- `GroupNode.tsx`：启用按钮、取消、进度
- `CanvasSurface.tsx`：接入 Provider、toast 状态与渲染
- `styles.css`：spinner / toast 样式
- 测试：新增 `m22-group-execution.spec.ts`（纯分层逻辑 + fixture 零请求），必要时更新 `m2-group-node.spec.ts`
- `TASKS.md`：实施与验收记录

服务端不改动。

## 6. 验收标准

1. 纯逻辑单测：并行分支、多级依赖、循环检测通过；
2. fixture 页面：按钮禁用或点击零付费请求；
3. 用户真实验收（模板“电商详情页工作流”）：传好参考素材 → 点整组执行 →
   文字策略先生成，随后多张图片并行生成，全部完成提示；失败/未就绪/取消路径均符合预期。

## 7. 明确不做

- 不做服务端批量执行接口；
- 不做余额/额度预检（项目无钱包体系）；
- 不做条件分支、循环节点；
- 不做“套模板自动执行”；
- 不重写节点现有生成、轮询、重试、幂等逻辑。

## 8. 2026-08-06 实测修正：真实原因透传与统一文案

- 真机复现（系统Chrome + CUA + 真实模型副本）确认：整组执行“未就绪”的真实根因是服务端在创建任务前拦截
  （费用保护、素材归属、保存状态等），原实现把错误吞进节点本地状态，导致工作流误报“有节点未就绪”。
- 已改为：四个生成节点的生成函数返回`成功/失败+文案`，执行器把真实原因透传为toast；
  节点自身仍保留原有错误展示与重试逻辑。
- 新增`friendlyGenerationMessage`统一文案层：已知服务端文案映射为短中文；
  长英文、技术串、专业词汇替换为各类型友好回退，任何节点与整组执行都不再直接展示原始报错。
