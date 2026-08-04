# TapNow 生成链路结构

状态：`AUTHORITATIVE / IMAGE REAL PATH ACCEPTED / VIDEO REAL PATH ACCEPTED / UPSTREAM INPUT PARTIAL / MULTI-PROTOCOL RELAY DIRECTORY + TEXT PROTOCOLS + REAL VIDEO RECOVERY ACCEPTED / RELAY IMAGE-AUDIO-DELETE USER_RECHECK / AUDIO REAL GENERATION DEFERRED`
更新时间：2026-08-04

## 1. 对齐边界

当前可以依据 TapNow 实页、冻结截图和人工验收确定：

- Text、Image、Video、Audio 的创作入口和参数区。
- 排队/生成中的节点状态、控件禁用和呼吸动效。
- 图片、视频、音频成功结果的节点形态。
- 成功素材进入账号级历史；删除画布节点不删除历史。
- 刷新页面后画布、媒体引用和任务不能丢失。
- 图片节点可通过连线成为另一图片生成节点的参考素材；目标输入区用缩略片呈现该关系，删除缩略片同步删除连线，撤销同步恢复。
- TapNow当前直接连线矩阵和三类ready素材进入目标后的引用、提示词条件、模式变化及刷新恢复，详见`TAPNOW_UPSTREAM_INPUT_SURVEY_2026-08-02.md`。

当前无法从 TapNow 网页确定：

- TapNow 内部数据库表、消息队列和服务器数量。
- TapNow 使用的 Provider 路由、密钥保存和回调协议。
- 失败分类、超时时间、取消确认、自动重试次数和重启恢复策略。

本项目只复刻可观察的产品行为。内部未知部分使用自有、可测试、可恢复的实现，
不得把本项目设计反写成 TapNow 事实。

## 2. 完整链路

```text
节点创作栏
  → 从edge统一解析Text/Image/Video/Audio及引用角色
  → 浏览器和服务端零费用preflight
  → 前端生成任务接口
  → 服务端请求校验与幂等
  → SQLite 持久任务
  → 任务执行器
  → Provider 适配器
  → 媒体原子落盘
  → 同一事务发布任务结果、节点引用和账号历史
  → 前端恢复并显示成功/失败状态
```

任何一层失败，都不能用假素材或定时器把任务显示为成功。

图片参考素材的当前真实路径：

```text
源Image节点 ──edge──> 目标Image生成节点
  → 前端从入边派生参考图缩略片
  → 任务只保存assetId和sourceNodeId
  → 服务端检查账号归属、图片类型、ready状态和模型上限
  → 执行时生成5分钟私有OSS签名地址
     或复核本机PNG大小、SHA-256和结构后生成数据地址
  → OpenRouter input_references
```

短时签名地址不写入画布、节点或任务参数；edge是参考关系事实来源，缩略片不是第二份持久关系。

计划中的统一输入路径：

```text
source nodes + edges
  → ResolvedInput[]（类型、角色、顺序、ready状态）
  → 目标节点规则 + 当前模型规则 + Prompt合并规则
  → problems / effectivePrompt / canSubmit
  → 版本化任务输入快照
  → Provider adapter映射为厂商字段
```

TapNow实测与本项目产品决定分开：TapNow当前Text目标只接受Image/Video直连；用户已经决定本项目Text目标扩展接受Text/Image/Video/Audio四类上游。本项目最终类型矩阵为11条允许、5条禁止。

## 3. 前端职责

- 收集提示词、模型、比例、质量、数量和参考素材；计划统一由当前目标节点的全部入边派生，不另存一份可能漂移的关系数组。
- 统一显示文字摘要、图片缩略图、视频封面、音频波形、引用角色和`empty/uploading/ready/invalid/missing`状态。
- Generate禁用时必须区分缺少Prompt、素材未ready、数量超限、角色冲突、模型不兼容、Provider未连接和安全门禁；不能只显示无解释的灰色按钮。
- 每次提交生成稳定幂等键，重复点击只对应一个任务。
- 只读取本项目任务状态，不直接访问 Provider。
- `queued/running/retrying/recovering` 显示生成中且禁用冲突操作。
- `success` 只显示服务端已经保存并登记为ready的真实素材。
- `failed/cancelled` 保留原节点和原素材，不发布半成品。
- 刷新后按画布重新读取未结束任务。

当前只有管理员已经发布、已连接Provider且服务端明确适配的图片或视频模型可提交。模型不支持某参数、参考图超限或素材尚未保存时，前端先禁用提交；服务端仍会再次检查，不能只依赖前端。

## 4. 后端职责

- 校验画布、节点、任务类型、参数和请求大小。
- 用画布 ID + 幂等键拒绝重复任务和冲突请求。
- 只有任务执行器可以调用 Provider；浏览器不能持有密钥。
- Provider 适配器只负责提交、查询、取消和结果解析。
- 任务执行器负责超时、恢复、重试边界和状态转换。
- 结果必须先完整写入媒体目录，再发布数据库引用。
- 错误响应不得包含密钥、签名地址或 Provider 原始敏感信息。
- 参考素材必须归属当前账号且状态ready；不得接受浏览器直接提交的任意公网URL或本机路径。
- OpenRouter GPT Image 2当前最多接收16张参考图；未知模型默认按0张处理，不猜测能力。
- 创建任务前按版本化输入schema重新验证来源类型、角色、顺序、数量、Prompt策略和Provider能力；浏览器的preflight结果不能作为信任边界。
- 任务只保存不可变的`sourceNodeId/assetId/kind/role/order`输入快照，不保存短时签名URL；重试复用原快照和原任务。

当前不做微服务、Redis、消息总线或通用插件系统。

## 5. 数据库职责

`generation_tasks`

- 保存画布、节点、类型、提示词、模型、参数和幂等键。
- 保存当前状态、尝试次数、错误代码和更新时间。
- 服务重启时把未确认完成的 `running` 转为 `recovering`。

`generation_task_events`

- 追加记录每次状态变化。
- 用于排查重复提交、服务重启和失败恢复。
- 事件只记录安全错误代码和清洗后的用户提示。

媒体和历史

- 图片、视频和音频文件不放进 SQLite。
- SQLite 只保存自有媒体 ID 和相对引用。
- 任务成功、节点结果和账号历史必须共同发布，不能只成功其中一部分。

## 6. 当前完成度

- 前端：Text/Image/Video/Audio共用可扩展模型参数注册结构；图片提示词、统一画质/比例、参考图缩略片和视频比例/分辨率/时长/音频开关均按管理员模型能力显示并持久化。
- 后端：生成安全门禁、幂等提交、SQLite任务、状态事件、OpenRouter图片执行器、火山方舟Seedance视频执行器和结果发布已接通。
- 数据库：任务、事件、请求指纹、模型快照、结果素材引用和账号历史均已持久化；内部`running→recovering`基础检查通过。
- 媒体：旧图片/视频/音频继续支持本机读取；新图片和真实Seedance视频结果可写入私有阿里云OSS并通过短时签名地址、Range和下载读取。
- Provider：OpenRouter GPT Image 2真实图片与火山方舟Seedance 2.0 Mini真实视频均已成功；视频结果通过播放、下载、历史操作、刷新和服务重启恢复人工验收。
- 多协议中转：显式协议模型配置、OpenAI Chat/Responses、Claude Messages、Gemini GenerateContent、GPT Image和通用媒体适配均已进入统一任务体系。`RELAY-001～005`已PASS；优创真实Video任务`8275d86c-602e-42ab-b444-969224dea601`的刷新、服务重启恢复和去重复验已闭环，`RELAY-010`经用户确认PASS。用户授权的7次真实协议自动验证均成功，Provider边界由1增至8；用户后续在真实画布找到并确认OpenAI Chat/Responses、Claude和Gemini四条文字结果，`RELAY-006～008`正式PASS。`RELAY-009/011/012`继续USER_RECHECK。
- 参考图：edge、缩略片、删除/撤销同步、账号归属、模型上限和OpenRouter `input_references`安全传参已完成，`GEN-009`于2026-08-01人工通过；本轮没有增加收费请求。
- 入参调研：TapNow两轮实页勘测已完成，8节点/9边和三类ready素材刷新恢复均有证据；本轮未点击Generate。该证据不等于本地统一入参实现完成。
- 入参实现状态：11允许/5禁止矩阵、共享edge解析器、四类引用卡、角色/顺序/阻塞原因、版本化任务快照、服务端重解析、Image的Text+Image合并及Text/Video/Audio任务入口均已有本地候选。尚缺完整人工矩阵、Text四类上游、Video全能参考角色/上限、Audio文字合并、模型切换及删除/撤销/刷新/重启去重收口，因此`INPUT-001～007`继续保持PARTIAL。
- 恢复：真实图片任务`438b50dd-cd9c-42ed-8321-1fcbd49adf35`和真实视频任务`788ebeaa-b37d-499a-becc-64ae16f2a9f5`在服务完全停止并重启后均保持唯一任务、历史、媒体与画布引用，私有OSS结果仍可读。
- 异常：真实取消、TIMEOUT、同任务重试成功及服务重启`running→recovering→failed`均有数据库事件和用户实页证据；`GEN-006/OPEN-007`于2026-08-01人工通过。
- 接口：自有OpenAPI 3.1契约现有8条路径、10个操作，覆盖画布、项目标题、安全模型配置、当前账号、模板、Agent界面配置、AI角色和素材目录；`API-001～006`均已人工通过。
- Agent边界：只读取管理员明确设为默认的已发布文字模型；当前为Doubao Seed。技能和建议仅作界面配置，真实Agent执行继续关闭。
- 未完成：Audio Provider；正式服务器HTTPS、进程守护、定时备份与整机回滚演练。

## 7. 当前门禁与下一步

已完成：

1. 管理员选择并配置OpenRouter，密钥只在服务端加密保存。
2. GPT Image 2模型发布、参数能力和后台费用保护通过。
3. 图片结果真实进入私有OSS并通过完整性、刷新和下载检查。
4. 任务、节点引用和账号历史发布链路已经完成一次真实成功验证。
5. 图片前置参考素材连线与安全传参已通过人工验收。
6. 现有真实成功结果已完成零费用服务重启恢复、任务/历史去重、私有OSS读取和用户实页验收。
7. 真实取消、超时、同任务重试和服务重启恢复失败均已按原任务事件链完成验收。
8. Seedance 2.0 Mini真实视频已进入私有OSS并完成播放、下载、历史和重启恢复验收。
9. 本地服务只监听`127.0.0.1:4173`；`API-001～006`的8条路径/10个操作及最终回归已完成，当前仍未部署服务器。

继续执行：

1. 先完成`RELAY-009/011/012`的用户可见复验：两张已有真实图片、已有Doubao TTS音频和隔离草稿的安全删除/全局回归。不重新生成，不再继续触发收费Provider。
2. 用户可见复验完成后回到入参计划：先收口已完成候选的P0/P1全局持久化，不重复已验收步骤；再按P2～P6完成Text四类上游、Video多模态参考、Audio文字合并、未来模型规则和模型切换不兼容保留。
3. Audio真实生成继续等待Mureka官网状态确认和新授权；中转站Audio也不能被当成Mureka恢复验收。
4. 已完成的自有数据契约只按实际功能维护，不照抄TapNow私有协议；新增接口必须继续经过账号隔离和密钥暴露检查。
5. 最后完成正式服务器HTTPS、进程守护、备份恢复和回滚演练；当前不得提前部署。

## 8. 多协议中转站扩展

2026-08-03用户批准`TAPNOW_RELAY_PROVIDER_INTEGRATION_PLAN.md`。该阶段在现有生成任务、安全门禁、统一入参和私有媒体发布之上增加协议适配层，不另起一套画布或任务系统。

```text
管理员模型配置
  → provider connection + protocol + providerModelId
  → 统一生成任务与不可变输入快照
  → protocol adapter
     ├─ OpenAI Chat / Responses
     ├─ Claude Messages
     ├─ Gemini GenerateContent
     ├─ GPT Image
     └─ generic media generate + task polling
  → 统一结果校验、私有媒体发布、节点引用和历史
```

模型目录只负责发现候选项；协议、节点类型、输入规则和费用保护必须由管理员确认后保存。不能根据模型名称猜测协议，也不能把第三方原始字段直接透传给Provider。

当前实现已用fixture覆盖连接、目录、协议映射、异步轮询、错误分类和回归；自动fixture检查保持收费Provider请求为0。2026-08-04真实优创目录由增强101条与基础55条合并为129条，`RELAY-001～005`经用户确认PASS。真实Video任务`8275d86c-602e-42ab-b444-969224dea601`的零费用刷新/重启/去重复验稳定，`RELAY-010`经用户确认PASS。另经用户授权完成OpenAI Chat/Responses、Claude、Gemini、GPT Image、通用图片和Doubao TTS共7次真实自动验证，全部成功且无重复，Provider边界由1增至8。用户后续在真实画布找到并确认OpenAI Chat/Responses、Claude和Gemini四条文字结果，`RELAY-006～008`正式PASS。两张图片、Doubao TTS和安全删除继续等待用户可见复验，`RELAY-009/011/012`保持USER_RECHECK。
