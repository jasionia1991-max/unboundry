# INC-GEN-023 服务端终态解绑方案

## 结论

v0.6.68 已发布并部署，客户端与服务端的 `terminal-detach` identity 已一致；但旧失败任务仍被浏览器本地 checkpoint/lease 挡在客户端协调层，导致合法解绑请求没有发出。真实整组点击仍为 0/1，Provider POST 0/11、费用 0。

## 用户合同

- 普通用户只点击一次整组执行；不得要求用户反复重试、清浏览器缓存或去 Provider 平台找结果。
- 本轮真实验收预算上限 CNY 300 等值，最多 11 次 Provider POST；不重试，结果不明只核对原 task id。

## 最小可靠修复

1. 使用纳入active runtime lease与shutdown drain的独立terminal-only sweep执行allowlist-scoped terminal detach；不得因空闲allowlist启动打开全局generation recovery。
2. 只处理 allowlist 中 owner/canvas 下真正不可恢复的`failed`或`cancelled`任务；持有accepted Provider task id或未决Provider attempt的failed任务继续保留绑定，`success`和非终态任务也不自动解绑。
3. 必须同时匹配 owner、canvas、node、kind、task、run、ownership、input、`generating=true`；由服务端对当前权威 node data 计算 fingerprint/application identity。
4. 单事务、CAS 更新 Canvas 文档；重复执行无副作用。
5. 不创建或修改 generation task、admission、Provider attempt、Provider request、media 或 publication；不放宽现有 HTTP endpoint 的任何安全门。

## 发布和验收门

- 候选版本暂定 v0.6.69；不得改写 v0.6.68 tag、Release 或不可变部署目录。
- 先通过定向 safe tests、TypeScript、diff-check、部署治理检查和 fresh production build。
- v0.6.69 必须得到新的明确版本确认及发布许可后，才能 commit/push/PR/tag/Release/生产切换。
- 生产切换后先证明旧绑定由服务端自动解除、计数不增；再消费唯一一次真实整组点击并只追踪该批原 task id。
