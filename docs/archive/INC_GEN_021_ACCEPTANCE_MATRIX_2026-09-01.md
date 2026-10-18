# INC-GEN-021 验收矩阵

状态：`V0_6_67_RELEASE_AUTHORIZED / RELEASE_IN_PROGRESS / REAL_GROUP_AUTHORIZED_NOT_RUN`

| ID | 要求 | 状态 | 证据 |
|---|---|---|---|
| IG21-001 | 用户只点一次，不手动重试、不去 Provider 平台捞结果 | AUTO_PASS_LOCAL | recovery sweep 只处理原 task/attempt/publication |
| IG21-002 | 图片结果在 OSS 前先可靠落 staging | AUTO_PASS_LOCAL | m88 检查上传时 staging 逐字节等于 PNG |
| IG21-003 | 视频结果在 OSS/提交失败时保留 staging | AUTO_PASS_LOCAL | m88 视频首次失败后从相同 MP4 staging 恢复 |
| IG21-004 | 音频结果在 OSS/提交失败时保留 staging | AUTO_PASS_LOCAL | m88 音频首次失败后从相同 WAV staging 恢复 |
| IG21-005 | 后台运行中自动续传，不依赖服务重启或用户点击 | AUTO_PASS_LOCAL | m38+m88 覆盖 periodic recovery sweep |
| IG21-006 | 待提交媒体与 Provider 轮询/匹配互斥 | AUTO_PASS_LOCAL | recovery sweep 先恢复并按 task id fence |
| IG21-007 | 恢复不新增 attempt 或 Provider POST | AUTO_PASS_LOCAL | 三媒体均attempt1；paid request只按原任务累计1/2/3 |
| IG21-008 | 本地 staging 仍受磁盘容量门保护 | AUTO_PASS_LOCAL | 三媒体保存均在写入前执行 local storage verification；m90 资源门通过 |
| IG21-009 | 图片/视频/音频已发布协议不回归 | AUTO_PASS_LOCAL | safe m57 `17/17`，m88 `38/38` |
| IG21-010 | 终态提示不再残留“自动找回中” | AUTO_PASS_LOCAL | safe m22 `44/44`，新增终态优先断言 |
| IG21-011 | 代码与测试候选可复现 | AUTO_PASS_LOCAL | TypeScript、diff-check、定向 safe 证据通过；唯一formal full原始1139/1140，未改源码只复验唯一m69失败后6/6通过，未重跑full |
| IG21-011A | v0.6.67版本身份与治理文档一致 | AUTO_PASS_LOCAL | m81 41/41；m38修正当前标记后18/18 |
| IG21-012 | 发布新版本并完成生产健康门 | IN_PROGRESS | v0.6.67 已确认并允许发布 |
| IG21-013 | 真实整组一次点击拿到图片/视频/音频 | AUTHORIZED_NOT_RUN | CNY300、最多11 POST、一次点击、不重试、原任务核对 |
| IG21-014 | 用户确认实际素材可用 | USER_RECHECK | 只能由用户观看/试听实际结果后确认 |
