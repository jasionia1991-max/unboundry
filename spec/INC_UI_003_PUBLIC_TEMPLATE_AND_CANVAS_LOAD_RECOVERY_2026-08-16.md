# INC-UI-003 公共模板 UI 与画布旧会话恢复

状态：`PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK`

## 用户问题

1. 公共模板管理弹窗仍使用浏览器原生下拉框和复选框，内容密度、宽度、层级、按钮及移动端布局没有对齐项目灰阶 UI 规范。
2. 从公共模板页返回项目 `14601b3e-3073-443f-9799-7a4fc02362c1` 时显示“画布加载失败”，其他画布正常。

## 根因

- UI：公共模板页保留了早期表单结构和原生控件，没有复用项目的 `GrayMenuSelect`、紧凑灰阶复选框、焦点样式与对话框交互合同。
- 加载：该浏览器标签仍保存服务器上一个进程 epoch 留下的 pagehide 保存 journal。服务器已完整保存同一份画布，但旧逻辑只认当前 epoch/high-water，因此在内容完全一致时也会 fail-close。问题来自单标签的旧保存凭证，不是项目数据库缺失或 OSS 故障。

## 修复合同

- 公共模板列表内容宽度限制为 960px；编辑弹窗使用项目灰阶层级、两栏自适应布局、GrayMenuSelect、自绘复选框、统一主次按钮和窄屏单栏布局。
- 对话框具备可访问名称、打开自动聚焦、Tab 焦点圈定、Escape 关闭、关闭后焦点回到触发按钮；下拉菜单打开时 Escape 先交给菜单。
- 旧 epoch journal 只有在其完整 document fingerprint 与服务器权威 document 完全一致时，才无 PUT 地结算 journal 并正常加载。
- 内容不一致时继续 fail-close、保留 journal、零 PUT、零生成，并显示“旧会话内容冲突”的专用说明；原标签提供“打开服务器版本”，在新标签打开同一项目的服务器权威版本，原标签继续保存本地恢复副本，双方内容都不被覆盖。
- 连接、响应格式和会话存储错误分别显示明确原因；“打开服务器版本”只出现在旧会话冲突类型，不把其他错误伪装成可恢复冲突。

## 自动验证

- 公共模板专项：`tests/m77-public-templates.spec.ts` 10/10 PASS。
- 画布加载安全专项：`tests/m86-canvas-load-safety.spec.ts` 83/83 PASS；覆盖“旧 epoch + 相同 document 自动结算”“旧 epoch + 不同 document 保留并阻断”“打开服务器版本且原 journal 不变”。
- UI 规范专项：m16/m18/m45 与相关模板测试通过。
- 正式安全全量：118/118 specs、967/967 tests PASS；failed/skipped/retries/blocked/reportErrors 均为 0；源码快照和 4173 listener 均保持不变。
- 所有测试使用临时数据、动态 loopback 与假 Provider；真实 Provider、付费生成和真实 OSS 写入均为 0。

## 生产发布结果

- 用户确认并授权后，生产已原子切换到`/opt/unboundry/releases/v0.6.3-inc-ui-003-r2-20260816`；公网version为0.6.3，service active+enabled、NRestarts0，ready为active/schema39。
- 发布源码为commit`399c0fb40c2ffe36c21a8e93ad61549e5d703696`、tree`bf0f1f775d9a62a77e194f35273d18d2ca0d722a`；库存5014文件，inventory SHA-256为`1e56c7e22d2846bae403abff13d8277249174a035434cf1d9923af797082b7c8`。
- 停机冻结备份和恢复副本均为schema39、quick_check ok、FK0，清单SHA-256同为`fb0570333953ac59823a9d3c22ab698bd97d390db9bd5f32dc853c94ea67dd25`。
- 切换前后tasks132、Provider attempts131、active0、模板46/45完全不变；真实Provider、付费生成和OSS写入均为0。
- 登录Chrome真实复核：旧冲突标签显示双恢复操作；点击“打开服务器版本”后新标签加载目标男装画布完整节点且显示已保存，原journal保留；从公共模板页“返回画布”同样正常；编辑弹窗720px/20px灰阶层级、GrayMenuSelect、8个紧凑复选框、主按钮、Escape关闭和焦点归还均通过。
- 自动与上线技术验证不能代替用户肉眼验收，状态保持`USER_RECHECK`。完整凭证：`INC_UI_003_PRODUCTION_RECEIPT_2026-08-16.json`。
