# Unboundry v0.6.3 发布说明

状态：`PRODUCTION PUBLISHED / AUTOMATED PASS / USER RECHECK`

## 本次内容

- 公共模板管理页和编辑弹窗全面对齐项目灰阶 UI 规范，并补齐键盘焦点与窄屏布局。
- 修复特定旧浏览器标签从设置页返回画布时，因服务器重启前保存 journal 与当前 epoch 不同而误报加载失败的问题。
- 当本地旧 journal 与服务器文档完全一致时，无写入地安全结算；内容不一致时继续保护双方内容并给出专用提示，同时可一键在新标签打开服务器版本，原标签的本地恢复副本不被覆盖。

## 验证

- 118/118 specs、967/967 tests PASS，所有异常计数为 0。
- 测试未读取生产数据、未调用真实 Provider、未产生付费生成、未写真实 OSS。
- schema版本保持39；生产已切换到`/opt/unboundry/releases/v0.6.3-inc-ui-003-r2-20260816`，公网version/live/ready、服务、release库存及静态资源哈希均通过。
- 生产切换前后tasks132、Provider attempts131、active0、公共模板46/45不变；本次发布Provider调用、付费生成和OSS写入均为0。
- 登录Chrome已真实验证目标男装画布的新标签安全恢复、公共模板返回画布和编辑弹窗UI/键盘合同。技术凭证见`INC_UI_003_PRODUCTION_RECEIPT_2026-08-16.json`。

## 用户验收

上线后请重点确认：公共模板弹窗控件、间距与按钮风格；从公共模板管理页返回此前报错的男装测试画布；其他普通画布仍能正常进入。自动门通过不等于用户肉眼 PASS。
