# INC-UI-003 公共模板 UI 与画布旧会话恢复

状态：`RELEASE_AUTHORIZED / AUTOMATED PASS / PRODUCTION PENDING`

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
- 内容不一致时继续 fail-close、保留 journal、零 PUT、零生成，并显示“旧会话内容冲突”的专用说明；连接、响应格式和会话存储错误分别显示明确原因。

## 自动验证

- 公共模板专项：`tests/m77-public-templates.spec.ts` 10/10 PASS。
- 画布加载安全专项：`tests/m86-canvas-load-safety.spec.ts` 83/83 PASS；新增“旧 epoch + 相同 document 自动结算”和“旧 epoch + 不同 document 保留并阻断”双向用例。
- UI 规范专项：m16/m18/m45 与相关模板测试通过。
- 正式安全全量：118/118 specs、967/967 tests PASS；failed/skipped/retries/blocked/reportErrors 均为 0；源码快照和 4173 listener 均保持不变。
- 所有测试使用临时数据、动态 loopback 与假 Provider；真实 Provider、付费生成和真实 OSS 写入均为 0。

## 发布边界

- 用户已确认版本 `v0.6.3` 并明确授权生产发布。
- schema 仍为 39，不运行迁移；发布前必须创建可恢复备份并核对 quick_check/FK/活动任务。
- 不发起真实生成；生产切换后验证 version/live/ready、服务、数据计数、静态资源和目标项目加载。
- 自动验证和线上技术验证不能代替用户对公共模板 UI 的肉眼验收，发布后保持 `USER_RECHECK`。
