# Unboundry v0.6.30 Provider 结果兼容与既有任务恢复

日期：2026-08-21  
状态：`FROZEN_RELEASE_CANDIDATE / ZERO_NEW_PROVIDER_POST`

## 结论

v0.6.29 的浏览器上传入口本来就接受 PNG、JPEG、WebP、GIF，并统一存成 PNG；故障只在 Provider 成片下载链：图片结果只接受 PNG，音频结果只允许一个 URL。云腾真实返回中，Nano Banana Pro 是 JPEG；Suno V4.5 是两个不同的完整 MP3 候选，不是 stem、封面或同一文件重复。因此 v0.6.30 扩展的是 Provider 结果合同，不是用户上传合同。

## 实际响应与云腾文档边界

- 云腾媒体任务文档描述单个 `result_url`，不能证明 Suno 实际数组的两个元素语义；生产真实任务 `112087930` 返回两个不同 URL。
- 第一首 MP3：4,506,390 字节，约 217.68 秒，SHA-256 前缀 `031470`。
- 第二首 MP3：4,254,966 字节，约 189.92 秒，SHA-256 前缀 `64e13c`。
- 两者均为单音轨、完整音乐候选，无可证明的 stem/伴奏/封面标签；产品只把 Provider 原顺序第一个标为 primary，其余标为 alternate，不编造标题。
- Nano 真实任务 `112083470` 返回 1024×1024 JPEG，593,919 字节，SHA-256 前缀 `67af`。

## v0.6.30 合同

- Provider 图片接受 PNG/JPEG/WebP/GIF；结果先取得媒体资源配额，再读取最多20 MiB。非PNG在私有临时目录内经有界ffprobe/ffmpeg解码首帧，限制4,000万像素，并统一验证、持久化为PNG。资源繁忙保持可恢复语义，不伪装成格式错误。
- Relay 媒体结果接受1至4个同类型输出。所有输出按Provider原序逐个成为restart-safe的published candidate；只有整组全部持久化后，才在一个事务中把第一个设为primary、完成原task/attempt和单一成功事件。进程在任一候选之间崩溃时，启动恢复先发布已有pending candidate，再从既有Provider task继续核对，不会提前显示任务成功或静默丢失第二结果。
- 后续输出是alternate，共用同一个task、execution attempt、Provider profile、Provider model和Provider task身份；不重复成本或成功事件。已发布alternate同样禁止普通删除，并纳入媒体完整性检查。
- 任务API返回`resultOutputs`；音频节点保存并显示版本1/2/…选择器。切换更新当前媒体引用与整组成功证明，不触发生成请求；用户上传新音频会清除旧生成候选。
- schema仍为39；不新增Provider、模型、密钥或付费入口，不借用优创凭据。

## 成本与恢复边界

- v0.6.29的三次真实Provider创建POST已全部消费，v0.6.30真实创建POST预算为 **0**。
- 生产恢复只允许读取已存在的Provider task `112083470`与`112087930`。恢复前必须停服务并在单事务内核对本地task/attempt/profile/model/providerTaskId/state；任何不匹配都fail-closed。
- 恢复只把精确的两个FORMAT失败任务转为`recovering`并写审计事件，随后由v0.6.30启动恢复执行既有任务查询、下载和本地/OSS发布；禁止创建新Provider task，未知、失败或超时不得自动重试POST。
- Nano/Suno只有在既有结果成功回收、媒体完整性与生产验收通过后才重新发布绑定。Kling和优创数据保持不变。

## 验证与回滚

- 定向覆盖：JPEG/WebP→PNG、资源闸门先于响应读取、Suno两结果保序、完整输出集合崩溃恢复、primary/alternate身份与删除保护、API输出、音频版本切换、版本/runtime门。
- 候选冻结后唯一一次正式safe full在HEAD`a8c9e8f`、source/snapshot`621ac501…e6b`执行，`1035/1037`通过；失败仅为m38候选文档精确字符串和m4测试夹具伪assetId归一化到不存在的API路径。没有第二次运行full；m38最小复验`15/15`、纠正夹具后m2+m4`4/4`通过。独立subagent复审无剩余阻断。
- 发布前保留v0.6.29不可变release和冻结备份；切换或恢复出现应用级问题时回切v0.6.29，但不删除任何任务、媒体、审计、备份或release。
- 生产回执以发布后的精确commit/tag/PR/release/backup/hash、任务恢复结果和技术验收矩阵为准；本文件不提前宣称生产PASS或用户PASS。
