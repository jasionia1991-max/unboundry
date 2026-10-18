# INC-GEN-022 terminal-detach 合同热修方案

## 结论

v0.6.67 已成功发布并部署，但真实整组点击前的旧任务收口暴露了一个阻断：客户端计算 `applicationId` 时额外纳入 `fixtureScopeId`，服务端按不含该字段的正式绑定计算，因此合法 `generation-terminal-detach` 被 400 拒绝。目标整组按钮仍被旧失败任务锁住，真实整组点击和 Provider POST 均未发生。

## 用户合同

- 用户只点击一次整组执行；失败恢复由系统完成。
- 不要求用户重试，不要求用户访问 Provider 平台找结果。
- 本轮真实验收预算上限 CNY 300 等值，最多 11 次 Provider POST；结果不明只核对原任务。

## 最小可靠修复

1. 客户端 `legacyTerminalDetachApplicationId` 只使用服务端合同字段：account、canvas、input、kind、node data fingerprint、node、ownership、result、run、task。
2. `fixtureScopeId` 继续用于任务/缓存隔离，但不得进入服务端 application identity。
3. 增加客户端/服务端跨层相等性回归；改变 fixture scope 不得改变 application identity。
4. 不放宽服务端 owner、task、terminal state、Canvas binding、data fingerprint、result proof 或 CAS 校验。

## 发布和验收门

- 候选版本为 v0.6.68；不得改写 v0.6.67 tag、Release 或已部署不可变目录。
- 先通过 TypeScript、diff-check、m22、m85、m81、m38 和 fresh build。
- v0.6.68 必须得到新的明确发布授权后，才能 commit/push/PR/tag/Release/生产切换。
- 生产切换后先让系统自动解除原失败任务绑定；只有按钮可用且任务/attempt/Provider 计数未增加，才消费唯一一次整组点击。
- 点击后最多接纳 11 个 Provider POST，不重试；任何不明结果只查询同一批 task id。
