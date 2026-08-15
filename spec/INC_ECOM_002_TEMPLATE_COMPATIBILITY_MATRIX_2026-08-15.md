# INC-ECOM-002 电商模板兼容性矩阵

检查日期：`2026-08-15`
证据范围：先以`readOnly + PRAGMA query_only=ON`完成生产审计；随后在用户明确授权下停服备份、部署formal final，并以单事务为生产模板绑定明确模型。写后再次只读审计和登录实页复核。全程未调用真实Provider/OSS、未生成或付费。

## 状态定义

- `PASS`：结构、输入角色/顺序、参数和明确保存的推荐模型均通过静态检查。
- `NEEDS_MODEL`：结构可检查，但一个或多个可执行节点没有保存推荐模型，或推荐模型当前未发布/停用。
- `INVALID`：图结构、输入组合、参数或模型能力存在确定性冲突。
- `USER_RECHECK`：本地快照没有该模板的完整生产图/模型绑定，不能冒充已审计或已修复。

## 当前矩阵

| 模板 | 来源 | 状态 | 静态结论 | 下一步 |
|---|---|---:|---|---|
| 电商详情页工作流 | 生产 published | `PASS` | 8 个执行节点已绑定兼容模型，历史`Auto`已规范化 | 真实结果待受限验收 |
| 213.电商图片生成专家 | 生产 published | `PASS` | 12 个执行节点已绑定兼容模型 | 真实结果待受限验收 |
| 测试管理新建模板 | 生产 archived | `PASS` | 12 个执行节点已绑定；继续保持归档 | 如恢复仍须走发布门 |
| 女装货架主图｜白底标准款 | 生产 published | `PASS` | 3 个Text/Image执行节点已绑定 | 真实结果待受限验收 |
| 男装货架主图｜白底标准款 | 生产 published | `PASS` | 3 个Text/Image执行节点已绑定 | 同上 |
| 女装货架主图｜生活方式场景 | 生产 published | `PASS` | 3 个Text/Image执行节点已绑定 | 同上 |
| 男装货架主图｜通勤/户外场景 | 生产 published | `PASS` | 3 个Text/Image执行节点已绑定 | 同上 |
| 女装详情页｜五图转化组 | 生产 published | `PASS` | 7 个执行节点已绑定 | 同上 |
| 男装详情页｜五图转化组 | 生产 published | `PASS` | 7 个执行节点已绑定 | 同上 |
| 服装详情页｜面料与工艺拆解 | 生产 published | `PASS` | 2个Text绑定Doubao Seed，3个Image绑定GPT Image 2专用协议 | 下一步做受限真实复验 |
| 服装详情页｜版型与尺码说明 | 生产 published | `PASS` | 4 个执行节点已绑定 | 真实结果待受限验收 |
| 服装上新｜颜色变体与搭配 | 生产 published | `PASS` | 5 个执行节点已绑定 | 同上 |
| 直播间/抖音｜9:16商品封面 | 生产 published | `PASS` | 4 个执行节点已绑定 | 同上 |
| 抖音带货｜6秒商品主图动效 | 生产 published | `PASS` | Text/Image/Video节点已绑定 | 同上 |
| 抖音女装｜15秒穿搭转化 | 生产 published | `PASS` | 4 个执行节点已绑定 | 同上 |
| 抖音男装｜15秒功能卖点 | 生产 published | `PASS` | 4 个执行节点已绑定 | 同上 |
| 抖音带货｜服装细节与面料微距 | 生产 published | `PASS` | 3 个执行节点已绑定 | 同上 |
| 抖音上新｜四镜头批量短视频 | 生产 published | `PASS` | 5 个执行节点已绑定 | 同上 |
| 抖音直播切片｜商品三段式 | 生产 published | `PASS` | 4 个执行节点已绑定 | 同上 |

## 已落实的门禁

1. 草稿进入 `published`、归档模板恢复、已发布模板更新时都必须重新通过语义兼容检查；失败返回 `TEMPLATE_COMPATIBILITY_FAILED` 和逐节点原因。
2. 管理页展示 `兼容检查通过 / 需要绑定模型 / 模板无效`，并禁用不兼容模板的发布或恢复按钮。
3. 历史已发布模板不会被离线代码擅自下架；它们会显示实时兼容状态，等待管理员修正。
4. 模板导入不再丢失 edge 的 `inputRole / inputOrder`。
5. 可执行节点没有保存模型时不再静默借用当前默认模型，而是显示“请选择兼容模型”；模型被停用/归档时同样在任何任务提交前阻止整组执行。

## 证据边界

生产初始只读审计共读取19条模板：18条published、1条archived；当时结果为`PASS=0 / NEEDS_MODEL=19 / INVALID=0`，99个执行节点缺模型，其中published模板87个。事务绑定后复核为`PASS=19 / NEEDS_MODEL=0 / INVALID=0`，执行节点缺模型0；类型分布为Text50/Image42/Video7，7处历史`Auto`已规范化为`auto`。首次审计曾把五条短视频模板的合法`text→storyboard`画布连线误报为`INVALID`；根因已修复并由m77 `9/9 PASS`覆盖。

离线自动证据：模板发布/恢复/管理页/导入语义专项已通过；Storyboard审计回归修复后m77 `9/9 PASS`。正式final `e1e0e0d33809a519e8856d11135237a6a30ff912` 上clean full为`117/117 specs、954/954 PASS`，异常计数全0，builder `1/5/1/0`。生产formal manifest为`692995bc9f6fc6833b314afeaea65bc5d367142aa03234299c4ab02b76aa56ff`；零付费复核前后generation tasks106、provider attempts104，未新增请求。上述PASS是静态结构、模型、参数与输入合同PASS，不替代真实图片/视频结果和用户验收。
