# INC-GEN-020 验收矩阵

状态：`PRODUCTION_V0_6_66_TECHNICAL_PASS / ZERO_NEW_PROVIDER_POST / USER_RECHECK`

| ID | 要求 | 状态 | 证据 |
|---|---|---|---|
| IG20-001 | 用户只点一次，不要求手动重试或平台捞结果 | AUTO_PASS | 后台只处理原任务；m38覆盖无新attempt/launch |
| IG20-002 | OSS 图片结果不依赖本地 staging 空间 | AUTO_PASS | m88确认Buffer直传且无staging文件 |
| IG20-003 | OSS 直传保留大小/SHA/HEAD/私有/不可覆盖校验 | AUTO_PASS | m13 `8/8` PASS，覆盖Buffer PUT与HEAD合同 |
| IG20-004 | 进程资源预算保留，本地路径磁盘门不放宽 | AUTO_PASS | m90覆盖OSS跳过statfs但保留进程门；旧本地磁盘门继续通过 |
| IG20-005 | response-received 无 ID 的同步图片自动终止并释放整组 | AUTO_PASS | m38断言`RESULT_SAVE_FAILED_NO_RETRY`、attempt不增加、launch为0 |
| IG20-006 | outcome-unknown 与 media-generate 恢复不回归 | AUTO_PASS | m38覆盖gpt-image unknown保留recovering及既有relay路径 |
| IG20-007 | 新 task/attempt/Provider POST/OSS/费用为 0 | AUTO_PASS | 发布前后tasks1028/admissions948/provider attempts1039/media956/publications547不变 |
| IG20-008 | 生产原任务自动收口、页面解锁 | AUTO_PASS | 原任务自动转`RESULT_SAVE_FAILED_NO_RETRY`，三次采样active0；实页整组按钮可用、任务面板明确不重复提交 |
| IG20-009 | 用户实页确认 | USER_RECHECK | 仅用户可确认 |
