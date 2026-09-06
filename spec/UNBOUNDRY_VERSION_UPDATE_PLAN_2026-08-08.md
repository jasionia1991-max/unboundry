# Unboundry 版本更新提示：实现与当前限制

原方案日期：2026-08-08。代码/现状复核：2026-09-06，v0.7.14。状态：`IMPLEMENTED / NORMAL_PATH_TESTED / MAINTENANCE_RECONNECT_OPEN`。历史版本策略与发布结果见Git和对应回执；当前发布流程仅看根目录`RELEASE_RUNBOOK.md`。

## 当前实现

`server/version.ts`读取package版本，`GET /api/version`公开只读返回版本；`GET /api/updates`连接时发送版本、每25秒心跳，带no-store和X-Accel-Buffering:no。服务端有stream准入、64KiB反压上限及10秒慢客户端清理；维护/排空时发控制事件并关闭流，非active新连接返回503/Retry-After。

`vite.config.ts`在业务鉴权门之前注册version/updates，仍受运行时边界管理；构建时注入`__UNBOUNDRY_VERSION__`。客户端`client/src/updates/UpdateNotice.tsx`创建EventSource，收到不同版本显示刷新条，同版本不显示，卸载时清理。

点击“刷新”有单次in-flight保护，**await flushCanvasSave成功后**才reload；保存失败时留在当前页并显示错误，允许重试。旧方案“4秒后不论保存结果强刷”已不符合代码，不得照此修改。

## 已确认限制

v0.7.14发布时，维护窗口旧EventSource收到502后没有恢复，自动提示未出现；人工刷新后新版本正常且原画布不变。客户端目前没有error事件后的显式重建/重连逻辑，只依赖浏览器EventSource。此结果记录于`V0_7_14_PRODUCTION_RECEIPT_2026-09-06.json`，不能标自动通知故障恢复通过。

下一次修复需专门覆盖维护503/代理502、网络断开、终止状态重建、卸载清理及保存失败不刷新；没有这次授权，不实施或发布。不得用旧页面自动重连的设计目标冒充当前保证。

## 验证与发布边界

m82覆盖正常版本/SSE、刷新等待保存、失败不刷新等7项；v0.7.14发布定向已通过。本轮只读复核实现和回执，没有重复业务测试或模拟生产中断。

`scripts/deploy.mjs`现为`LEGACY_DEPLOY_DISABLED`立即失败入口；原先“npm version→tag→rsync→restart→push”六步不能执行。当前发布必须走PR最终head/main CI、不可变merge/tag、新目录fresh build、schema43签名加密备份/独立恢复、兼容回退与用户验收。

Git tag不包含真实数据库和素材；v0.7.14回退需要`0.7.14-compat.1`保持新尺寸字段及CURRENT，不能承诺通过git回退即可无损恢复线上。
