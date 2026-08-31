# INC-GEN-020 Checkpoint

状态：`R0-R2_LOCAL_COMPLETE / V0_6_66_RELEASE_AUTHORIZED / RELEASE_IN_PROGRESS / ZERO_NEW_PROVIDER_POST`

- 基线：branch `codex/inc-gen-020-durable-gpt-image-result`，HEAD `15165c6`，候选package `0.6.66`；用户既有未跟踪文件保持不动。
- 生产只读事实：v0.6.65/schema41健康；目标图片任务仍为 `recovering`，attempt 1，Provider attempt `response-received`，provider task id/result asset id 均为空。
- 计费安全：本事件不授权新的真实生成；本地实现、测试和文档的 Provider POST/OSS/费用均为 0。
- 根因：同步图片响应只存在当前执行内存；本地 staging 失败后没有远端 task id 可轮询，恢复扫描无法取得原结果，只会周期性续写 recovering checkpoint。
- 已实现：OSS路径从内存直接上传PNG，不写本地staging；进程并发/内存门和OSS校验不变，本地存储继续执行磁盘门。
- 已实现：精确同步图片`response-received`且无远端ID、无待提交publication时，后台只终止原任务并释放整组；不创建新attempt、不重提Provider。
- 不回归：`outcome-unknown`继续核对原任务；`media-generate`无ID匹配和有ID轮询保持。
- 定向证据：safe m13 `8/8`、safe m38+m88+m90 `76/76`，共84/84 PASS；TypeScript与diff-check通过；formal full未重跑。
- v0.6.66版本门：package/lock、final runtime allowlist与m81断言已同步；safe m38+m81 `59/59 PASS`，source/snapshot=`114bcca0…109c60`，4173 unchanged。
- 当前边界：生产仍是v0.6.65旧代码，原任务尚未收口；本地阶段真实Provider POST、OSS写、新费用均为0。
- 授权：用户已明确“确认版本v0.6.66，并允许发布v0.6.66”；本次授权包含commit/push/PR/tag/Release、备份和生产切换，不包含新的真实生成或Provider POST。
- 下一门：完成版本门、CI、不可变tag/Release、生产备份和原子切换；随后只核对原任务自动收口和页面解锁。
