# INC-GEN-020 同步图片结果持久化与自动收口方案

状态：`PLAN_FROZEN / V0_6_66_RELEASE_AUTHORIZED / RELEASE_IN_PROGRESS / ZERO_NEW_PROVIDER_POST`

## 用户要的结果

用户仍然只点一次“整组执行”。平台已经返回的图片由系统自己安全保存并继续下游；用户不需要反复点击重试，也不需要去大模型平台找结果。任何结果不明的任务只处理原任务，绝不创建第二次 Provider POST。

## 已证明的问题

- 生产任务 `8b6e5b71-c45f-485d-a6a7-7f83dc7be3f1` 的同步 `gpt-image` 请求已经取得 `response-received` 证据，但本地保存时遇到存储压力。
- 同步 `gpt-image` 没有可轮询的远端 task id。现有保存保险丝耗尽后把任务留在 `recovering`，而恢复扫描只会为 `media-generate` 无 ID 任务查用量记录，因此该任务会长期占住整组。
- 原任务只有一次 attempt/一次 Provider POST；结果不明时禁止重提。

## 最小修复

1. OSS 为正式存储时，已在内存中的 PNG 直接上传私有 OSS，不再先写一份本地 staging 文件；仍保留媒体 publication journal、校验和、大小、尺寸、对象不可覆盖、上传后 HEAD 校验和事务提交。
2. 资源并发预算继续生效；只有明确不落本地文件的 OSS 路径跳过本地磁盘余量门。本地存储路径保持原门不变。
3. 同步 `gpt-image` 已 `response-received`、无远端 task id、没有可恢复 publication 的任务，如果保存保险丝已耗尽，则由服务端自动收口为明确失败，释放整组；不要求用户点击、不创建新 attempt、不发第二次 Provider POST。
4. 其他 `outcome-unknown`、有远端 task id、`media-generate`、文字/视频/音频恢复合同保持不变。

## 验收

- Buffer 上传 OSS 仍执行 PUT + HEAD、私有 ACL、SHA-256 元数据和 forbid-overwrite。
- OSS 路径在本地磁盘门不足时仍受进程并发/内存预算保护，但不因无需落盘而被 507 拦下。
- 本地存储仍严格执行磁盘余量门。
- `gpt-image + response-received + no providerTaskId` 自动进入终态；attempt/Provider POST 不增加。
- `gpt-image + outcome-unknown` 不被误终止或重提；`media-generate` 无 ID 自动匹配保持。
- 只运行直接相关 safe specs；不重跑 INC-GEN-019 已消费的 formal full。

## 发布边界

本地工程和定向验证已完成：safe m13+m38+m88+m90共84/84 PASS，TypeScript与diff-check通过；INC-GEN-019 formal full未重跑。用户已明确确认并允许发布v0.6.66；本次授权不包含新的真实生成或Provider POST。
