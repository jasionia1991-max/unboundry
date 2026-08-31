# INC-GEN-022 验收矩阵

| ID | 级别 | 验收项 | 当前证据 | 状态 |
|---|---|---|---|---|
| IG22-001 | P0 | 客户端与服务端 terminal-detach application identity 完全一致 | m22 跨层回归 | AUTO_PASS |
| IG22-002 | P0 | fixture scope 不进入服务端 application identity | m22 反例回归 | AUTO_PASS |
| IG22-003 | P0 | owner/task/terminal/binding/fingerprint/result/CAS 校验不放宽 | m85 27/27 | AUTO_PASS |
| IG22-004 | P0 | 修复过程不创建新 task/attempt/Provider POST | 生产点击前计数与日志 | AUTO_PASS |
| IG22-005 | P0 | v0.6.68 版本、部署角色与治理一致 | m81 41/41；m38修正后18/18；safe production build | AUTO_PASS |
| IG22-006 | P0 | 生产自动解除原失败任务绑定且按钮恢复可用 | v0.6.68 部署后实页 | NOT_RUN |
| IG22-007 | P0 | 唯一一次整组执行最多 11 次 Provider POST，无重试 | 生产任务/attempt/Provider ledger | NOT_RUN |
| IG22-008 | P0 | 图片、视频和视频音轨素材真实可读、可下载、刷新后仍在 | 页面、媒体 API、ffprobe | NOT_RUN |
| IG22-009 | P1 | 用户无需任务面板或 Provider 平台人工回收 | 完整实页流程 | NOT_RUN |
| IG22-010 | USER | 素材主观质量与业务可用性 | 用户复验 | USER_RECHECK |
