# 模板导入自动找空位方案（2026-08-07）

状态：`IMPLEMENTED`（用户确认三点决策后实施，待真实验收）

## 1. 背景

导入模板前，模板节点按模板原始坐标直接铺入画布，若该位置已有节点/模板会重叠。
TapNow 会在画布上自动寻找不与任何已有节点重叠的位置，连续导入多个模板互不覆盖。

## 2. 用户决策（2026-08-07）

1. 导入后镜头：对齐 TapNow，平滑移动到新模板（800ms + padding 0.2）；
2. 空画布：保留 ±50 随机偏移；
3. 搜索参数：对齐 TapNow（间隔 100、横向 8 列、纵向 ±10 行）。

## 3. 算法（对齐 TapNow 前端代码）

1. 模板包围盒：所有节点（含 group 子节点，相对坐标递归累加）的全局矩形并集；
2. 锚点：
   - 有选中节点：选中区右侧 +100，顶部对齐；
   - 无选中：视野中心（x 右偏 100，y 垂直居中）；
   - 空画布：视野中心 - 模板尺寸/2 + 随机 ±50；
3. 网格扫描：横向 0..8 列、纵向 0,±1..±10 行，步进 = 模板宽/高 + 100；
   第一个不与任何已有节点矩形相交的位置即落点；全部重叠回落锚点；
4. 整块平移：只改顶层节点位置，子节点随父级移动；
5. 镜头：受控 viewport 下 React Flow 的 `fitView` 动画会被受控同步覆盖成瞬移，
   因此用 `viewportForBounds`（与 React Flow 同语义，padding 0.2）算目标视野，
   目标必须用“平移后实际落位”的包围盒（不是模板原始坐标）。
   再用 rAF 逐帧调用 `onViewportChange` 平滑插值 800ms；动画期间保存调度被
   “动画闸门”跳过，最后一帧先关闸再提交最终镜头，只触发一次保存；
   React Flow 回显按容差忽略，用户滚轮/拖拽立即取消动画。
   已移除会与 React 渲染时序竞争的“外部镜头变化检测”effect。

## 4. 实现位置

- 纯函数：`client/src/canvas/templatePlacement.ts`
  （`templateBounds / templateAnchor / emptyCanvasTemplateSpot / findTemplateSpot /
  offsetTemplate / nodePlacementRect / nodeGlobalPosition`，常量 GAP=100、MAX_COLS=8、
  MAX_ROWS=10、MIN_SIZE=320×220、EMPTY_JITTER=50）；
- 接入点：`CanvasSurface` 的 `apply-template` effect（位置计算在 `checkpoint()` 与
  `setNodes` 之前，历史/撤销语义不变）。

## 5. 风险与应对（预审计）

| 风险 | 应对 |
|---|---|
| 节点尺寸未就绪 | `measured ?? style ?? NODE_DEFAULT_SIZES ?? group 默认` 兜底 |
| 子节点相对坐标 | 全局坐标递归累加；只平移顶层节点 |
| 画布极挤扫不到 | 回落锚点（与 TapNow 一致），可后续扩搜索 |
| 空画布随机抖动影响测试 | 抖动 ±50，测试断言不重叠/中心附近；函数支持注入随机源 |
| 历史/撤销 | 位置计算为纯函数，checkpoint 在 setNodes 前，语义不变 |
| 持久化/多标签 | 只改普通位置数据，无新增请求 |
| 性能 | 扫描 ≤ 8×21×N，导入时一次，可忽略 |
| 模板空图/无 group | 包围盒回退最小尺寸 |
| 嵌套 group | 递归全局坐标已覆盖 |

## 6. 测试

- `tests/m70-template-placement.spec.ts`：6 项纯函数单测 + 1 项集成
  （同一模板连续导入两次，两组包围盒不相交）；
- 回归：模板契约、壳层、历史、额度、连接、任务面板、边高亮等 94 项通过
  （仅剩 m0 P1 基线已知失败）。
