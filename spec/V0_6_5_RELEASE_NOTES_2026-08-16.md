# Unboundry v0.6.5 发布说明

状态：`RELEASE_CANDIDATE / PRODUCTION_PENDING / USER_RECHECK`
日期：`2026-08-16`

## 内容

- 修复缩放/平移期间Group及子节点世界坐标被被动改写的问题。
- 移除Group对React viewport的重渲染依赖，保留标题屏幕空间可读性和v0.6.4总览层级。
- 对历史模板根组自引用执行输入归一化，并阻止个人/公共模板再次发布循环parentId。
- 备份后恢复目标生产组的已确认世界坐标，不改变其14个子节点相对坐标和145条画布边。

## 发布门

- 相关6份spec定向69/69通过；正式安全全量、生产备份恢复、源码精确构建、公网哈希和实页缩放复验完成后才能切换为已发布状态。
- 本次不迁移schema，不运行真实Provider或付费生成，不写OSS。
- 详细证据见`spec/INC_UI_006_CANVAS_ZOOM_POSITION_STABILITY_2026-08-16.md`及发布后receipt。

