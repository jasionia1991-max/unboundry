# INC-GEN-023 验收矩阵

| ID | 级别 | 验收项 | 当前证据 | 状态 |
|---|---|---|---|---|
| IG23-001 | P0 | allowlist 内 failed/cancelled 精确绑定由服务端自动解绑 | m85服务端sweep正例 | AUTO_PASS |
| IG23-002 | P0 | success、非终态、可恢复accepted failed、非 allowlist、绑定不匹配均保持不变 | m85反例 | AUTO_PASS |
| IG23-003 | P0 | 解绑原子、CAS 安全且重复执行幂等 | m85 revision+repeat断言 | AUTO_PASS |
| IG23-004 | P0 | 不新增/修改 task、event、admission、attempt、Provider、media、publication，且不触发非allowlist Canvas恢复 | m85六类账本前后相等；m81跨Canvas outcome-unknown task/attempt/event不变 | AUTO_PASS |
| IG23-005 | P0 | 既有客户端 HTTP terminal-detach 安全门不放宽 | m85既有owner/terminal/fingerprint/proof/CAS回归 | AUTO_PASS |
| IG23-006 | P0 | v0.6.69 版本、部署角色、治理、runtime lease和 fresh build 一致 | m81 42/42；m85 28/28；m93 7/7；m38 18/18；safe TypeScript/架构/source coverage/build；独立复审P0/P1/P2均0 GO | AUTO_PASS |
| IG23-007 | P0 | 生产旧绑定自动解除且整组按钮恢复可用 | v0.6.69 部署后实页/数据库 | NOT_RUN |
| IG23-008 | P0 | 唯一一次整组执行最多 11 次 Provider POST，无重试 | 生产 task/attempt/Provider ledger | NOT_RUN |
| IG23-009 | P0 | 图片、视频和视频音轨素材真实可读、可下载、刷新后仍在 | 页面、媒体 API、ffprobe | NOT_RUN |
| IG23-010 | P1 | 用户无需任务面板、浏览器清理或 Provider 平台人工回收 | 完整实页流程 | NOT_RUN |
| IG23-011 | USER | 素材主观质量与业务可用性 | 用户复验 | USER_RECHECK |
