# Unboundry v0.6.4 发布说明

状态：`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`
日期：`2026-08-16`

## 内容

- 收录v0.6.3公共模板UI与旧画布会话恢复的GitHub源码链。
- 收录普通节点标题低缩放屏幕空间可读性。
- 优化Group标题总览层级：稳定间隔、限制宽度，并在总览按组hover/选中披露组内节点标题。
- 保持组内无新增视觉边距/边框、不移动节点、不改变持久数据。

## 发布门

- 精确源码commit`ba5805c4448e504d33238947ea9aec1dfa160166`通过安全全量`118/118 specs、968/968 tests PASS`，异常0。
- 生产最终发布目录为`/opt/unboundry/releases/v0.6.4-inc-ui-005-20260816-r2`；首个旧dist产物被浏览器门拒绝，最终公网使用fresh build资源。
- 公网资源哈希、隔离启动、冻结备份恢复、service/schema39、数据不变与Chrome总览合同均通过；详细凭证见`spec/INC_UI_005_PRODUCTION_RECEIPT_2026-08-16.json`。
- GitHub分支与PR #3已建立，合并与精确源码注释标签由本次已授权流程收尾。
- 本次未运行真实Provider或付费生成，未写OSS，未迁移schema。
