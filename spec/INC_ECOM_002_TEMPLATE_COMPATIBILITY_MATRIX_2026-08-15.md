# INC-ECOM-002 电商模板兼容性矩阵

检查日期：`2026-08-15`
证据范围：当前本地源码快照，以及通过既有 SSH 对生产 schema39 数据库执行的 `readOnly + PRAGMA query_only=ON` 导出；生产数据只进入本机内存数据库供候选审计器计算。未写生产、未调用真实 Provider/OSS、未生成或付费。

## 状态定义

- `PASS`：结构、输入角色/顺序、参数和明确保存的推荐模型均通过静态检查。
- `NEEDS_MODEL`：结构可检查，但一个或多个可执行节点没有保存推荐模型，或推荐模型当前未发布/停用。
- `INVALID`：图结构、输入组合、参数或模型能力存在确定性冲突。
- `USER_RECHECK`：本地快照没有该模板的完整生产图/模型绑定，不能冒充已审计或已修复。

## 当前矩阵

| 模板 | 来源 | 状态 | 静态结论 | 下一步 |
|---|---|---:|---|---|
| 电商详情页工作流 | 生产 published | `NEEDS_MODEL` | 8 个执行节点未保存模型 | 管理员逐节点选择兼容模型并保存 |
| 213.电商图片生成专家 | 生产 published | `NEEDS_MODEL` | 12 个执行节点未保存模型 | 同上 |
| 测试管理新建模板 | 生产 archived | `NEEDS_MODEL` | 12 个执行节点未保存模型 | 保持归档；如需恢复，先绑定模型 |
| 女装货架主图｜白底标准款 | 生产 published | `NEEDS_MODEL` | 3 个执行节点未保存模型 | 绑定 Text/Image 模型 |
| 男装货架主图｜白底标准款 | 生产 published | `NEEDS_MODEL` | 3 个执行节点未保存模型 | 同上 |
| 女装货架主图｜生活方式场景 | 生产 published | `NEEDS_MODEL` | 3 个执行节点未保存模型 | 同上 |
| 男装货架主图｜通勤/户外场景 | 生产 published | `NEEDS_MODEL` | 3 个执行节点未保存模型 | 同上 |
| 女装详情页｜五图转化组 | 生产 published | `NEEDS_MODEL` | 7 个执行节点未保存模型 | 绑定 Text 与 5 个 Image 节点模型 |
| 男装详情页｜五图转化组 | 生产 published | `NEEDS_MODEL` | 7 个执行节点未保存模型 | 同上 |
| 服装详情页｜面料与工艺拆解 | 生产 published | `NEEDS_MODEL` | 5 个执行节点未保存模型 | 绑定 Text/Image 模型后才可做真实复验 |
| 服装详情页｜版型与尺码说明 | 生产 published | `NEEDS_MODEL` | 4 个执行节点未保存模型 | 绑定模型 |
| 服装上新｜颜色变体与搭配 | 生产 published | `NEEDS_MODEL` | 5 个执行节点未保存模型 | 绑定模型 |
| 直播间/抖音｜9:16商品封面 | 生产 published | `NEEDS_MODEL` | 4 个执行节点未保存模型 | 绑定模型 |
| 抖音带货｜6秒商品主图动效 | 生产 published | `NEEDS_MODEL` | 3 个执行节点未保存模型 | 绑定 Text/Image/Video 模型 |
| 抖音女装｜15秒穿搭转化 | 生产 published | `NEEDS_MODEL` | 4 个执行节点未保存模型 | 绑定模型 |
| 抖音男装｜15秒功能卖点 | 生产 published | `NEEDS_MODEL` | 4 个执行节点未保存模型 | 绑定模型 |
| 抖音带货｜服装细节与面料微距 | 生产 published | `NEEDS_MODEL` | 3 个执行节点未保存模型 | 绑定模型 |
| 抖音上新｜四镜头批量短视频 | 生产 published | `NEEDS_MODEL` | 5 个执行节点未保存模型 | 绑定模型 |
| 抖音直播切片｜商品三段式 | 生产 published | `NEEDS_MODEL` | 4 个执行节点未保存模型 | 绑定模型 |

## 已落实的门禁

1. 草稿进入 `published`、归档模板恢复、已发布模板更新时都必须重新通过语义兼容检查；失败返回 `TEMPLATE_COMPATIBILITY_FAILED` 和逐节点原因。
2. 管理页展示 `兼容检查通过 / 需要绑定模型 / 模板无效`，并禁用不兼容模板的发布或恢复按钮。
3. 历史已发布模板不会被离线代码擅自下架；它们会显示实时兼容状态，等待管理员修正。
4. 模板导入不再丢失 edge 的 `inputRole / inputOrder`。
5. 可执行节点没有保存模型时不再静默借用当前默认模型，而是显示“请选择兼容模型”；模型被停用/归档时同样在任何任务提交前阻止整组执行。

## 证据边界

生产只读审计共读取 19 条模板：18 条 published、1 条 archived；结果为 `PASS=0 / NEEDS_MODEL=19 / INVALID=0`。唯一问题代码为 `MODEL_SELECTION_REQUIRED`，共 99 个节点，其中 published 模板 87 个。首次审计曾把五条短视频模板的合法 `text→storyboard` 画布连线误报为 `INVALID`；根因是审计器把非生成型 Storyboard 错当作四类生成输入，现已改为复用画布连接合同，并新增专项测试，m77 当前 `9/9 PASS`。这说明图结构未发现确定性非法项，但不等于真实出图、用户验收或发布证明。

离线自动证据：模板发布/恢复/管理页/导入语义专项已通过；Storyboard审计回归修复后 m77 `9/9 PASS`。此前非发布产品回归为`926/926 PASS`；新增专项使冻结清单更新为`117 files / 954 tests`，正式 clean candidate full 仍待本轮执行。
