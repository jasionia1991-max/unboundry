# TapNow 多协议中转站接入实施计划

状态：`AUTHORITATIVE / RELAY-001～008、010 PASS / RELAY-009、011～012 USER_RECHECK`
更新时间：2026-08-04

## 1. 目标与边界

本阶段把“OpenAI兼容中转站”从只能读取`/v1/models`的简单连接，升级为可配置、可发现、可校验、可生成的多协议平台连接。首个目标站为用户指定的灵客中转站：

- 文档站：`https://ycaigc.lk666.ai/apidoc`
- API基址：`https://api.lk888.ai`
- SDK兼容基址：`https://api.lk888.ai/v1`

该站是第三方中转服务，不视为OpenAI、Anthropic、Google或火山方舟官方服务。管理员必须能够明确看到“第三方中转站”身份、连接地址、协议和模型来源。

本计划不得改变已经人工验收通过的Canvas、节点、真实图片、Seedance视频、私有OSS和任务恢复链路。Comment、社区、TapTV、竞技场、额度/积分、链接分享、真实Agent、完整Storyboard/Table、团队协作和打光仍不恢复。

## 2. 已确认的接口能力

### 2.1 鉴权

统一优先使用服务端`Authorization: Bearer <key>`。密钥只保存在服务端加密存储中，不进入浏览器、SQLite业务字段、日志、错误响应或任务快照。兼容站可能支持`x-api-key`、`x-goog-api-key`或查询参数Key，但第一版不默认使用这些方式，避免密钥进入URL和访问日志。

### 2.2 模型目录与账号只读接口

- `GET /v1/models`：OpenAI格式的基础模型目录。
- `GET /v1/skills/models`：包含类型、能力和总数的增强目录。
- `GET /v1/skills/models/{model_name}`：单模型详情。
- `GET /v1/skills/models/{model_name}/pricing`：模型价格信息。
- `GET /v1/skills/balance`：余额。
- `GET /v1/skills/usage`：用量。
- `GET /v1/skills/task-status`：异步任务状态。

目录、余额和用量均为只读能力。同步目录不得自动发布模型、改变默认模型、修改节点配置或发起真实生成。

### 2.3 生成协议

- OpenAI Chat：`POST /v1/chat/completions`。
- OpenAI Responses：`POST /v1/responses`。
- Claude Messages：`POST /v1/messages`。
- Gemini GenerateContent：`POST /v1beta/models/{model}:generateContent`。
- GPT Image：`POST /v1/images/generations`与`POST /v1/images/edits`。
- 通用图片/视频/音频：`POST /v1/media/generate`，再通过任务状态接口轮询。

“AI工具”页面属于调用指南或组合工作流，不作为可发布模型类型，不直接混入Text/Image/Video/Audio节点模型目录。

### 2.4 已知限制

- 当前文档未给出统一取消任务接口；产品不得显示虚假的“已取消Provider任务”。本地取消只停止后续轮询和结果发布，并保留审计说明。
- 本地开发服务不能稳定接收公网回调，第一版使用有上限的轮询；正式部署获准后才能增加签名回调。
- 文档模型数量和能力会变化，不能把当前聊天、图片、视频、音频数量写死为产品真相。
- 第三方目录返回的能力、价格和模型状态只作为发现草稿；管理员发布前仍需确认节点类型、协议、费用保护和输入能力。

## 3. 平台连接数据模型

在现有Provider连接上增加平台中立的适配信息：

- `driver`：使用`multi-protocol-relay`，与现有`openrouter`、`volcengine-ark`、`mureka`区分。
- `baseUrl`：管理员配置的HTTPS API基址。
- `authMode`：第一版固定为`bearer`。
- `catalogMode`：`openai-models`、`skills-models`或`auto`。
- `protocols`：可启用`openai-chat`、`openai-responses`、`claude-messages`、`gemini-generate-content`、`gpt-image`、`media-generate`。
- `catalogCapabilities`：服务端探测到的只读目录、余额、用量、价格和任务查询能力。
- `healthSnapshot`：最后检查时间、安全分类、可读取模型数；不保存原始Key或敏感响应。

单个模型继续由管理员明确保存：

- 内部模型编号、用户显示名称、节点类型。
- 生成协议和Provider模型编号。
- 输入类型、数量、角色、组合、必填条件和模型切换规则。
- 可调参数与默认值。
- 单次费用保护和是否允许真实生成。

目录发现只产生“候选草稿”，不能直接成为节点可用模型。

## 4. 一次性实施顺序

### P0：连接与安全底座

1. 增加多协议中转站平台类型和管理员表单。
2. 连接检查只调用只读目录接口；禁止任何生成POST。
3. 统一地址规范化、HTTPS/本机测试地址边界、超时、响应大小和重定向限制；真实请求必须绑定到预先校验通过的公网IP，禁止二次DNS解析绕过内网边界。
4. 安全错误只区分Key无效、权限不足、目录不可读、地址错误、限流、超时和上游异常，不回显密钥或原始敏感正文。

### P1：目录、筛选和导入草稿

1. 优先读取增强目录，失败时安全回退到`/v1/models`。
2. 统一解析模型ID、名称、输入/输出模态、能力、上下文、价格提示和可用协议。
3. 支持搜索、节点类型筛选、协议筛选、分页/虚拟列表和紧凑复选框。
4. 使用固定操作栏展示已选择数量和“添加到模型中心”，不要求滚到列表底部。
5. 去重规则以`providerConnectionId + providerModelId + capability + providerProtocol`为准；重复同步不重复创建模型，同一Provider模型可面向不同节点能力独立配置。

### P2：文字模型多协议闭环

1. 抽象统一文字请求和统一文字结果。
2. 分别实现OpenAI Chat、OpenAI Responses、Claude Messages和Gemini GenerateContent映射。
3. Provider协议由模型配置决定，不根据模型名称猜测。
4. Text节点仍使用统一ResolvedInput和不可变输入快照；四类上游是否可用由模型规则决定。
5. 流式响应留作后续增强，第一版以可靠的非流式结果、失败分类、幂等和恢复为准。

### P3：图片模型闭环

1. GPT Image生成与编辑走专用图片接口。
2. 其他中转图片走通用媒体接口。
3. 上游Text母版、自身Prompt和Image参考继续使用现有统一入参解析与安全素材引用。
4. 结果先进入项目私有媒体/OSS，再原子发布任务、节点引用和历史。

### P4：视频模型闭环

1. 中转站视频走通用媒体异步任务。
2. 复用现有`queued/running/retrying/recovering/success/failed/cancelled`任务状态和Seedance结果发布链路。
3. 图片、视频、音频和文字参考按管理员模型规则映射；不能把未知参数直接透传。
4. 本地取消只停止轮询和发布，明确提示“上游任务可能仍在运行”。

### P5：音频模型闭环

1. 中转站音频走通用媒体异步任务。
2. 支持生成结果的格式、时长和数量校验，再进入统一媒体发布。
3. 这不等于恢复Mureka真实生成；Mureka `RATE_LIMIT`暂停项保持不变，未经用户重新授权不得重试。

### P6：管理能力

1. Provider卡显示Key状态、模型目录状态、已发现数量、本项目已配置数量和最后检查时间。
2. 可选显示余额、用量和模型价格，但不恢复用户侧额度/积分UI。
3. “修改”必须打开真实连接编辑；若连接不可编辑则不显示无效按钮。
4. 模型中心提供停用与删除：已被任务、默认模型或节点引用的模型只能停用；无引用且非默认的未发布模型可二次确认后删除。

### P7：可扩展适配器

1. 新增平台优先复用连接、目录和协议能力描述，不复制整套页面。
2. 特殊平台只增加服务端适配器和能力声明。
3. 未知协议、未知任务状态、未知媒体格式默认拒绝，不伪造成功。

## 5. 自动检查与验收门禁

| ID | 验收项 | 自动检查要求 | 人工验收前状态 |
|---|---|---|---|
| RELAY-001 | 多协议平台连接与密钥安全 | 密钥不进浏览器、日志、数据库业务字段、产物和错误响应 | PASS |
| RELAY-002 | Key与目录只读检查 | 仅GET目录；目录同步不创建生成任务 | PASS |
| RELAY-003 | 增强目录与基础目录回退 | fixture覆盖两种响应、分页、去重和异常；真实目录合并为129条 | PASS |
| RELAY-004 | 搜索、筛选、紧凑列表和固定操作栏 | 12/14px、16px复选框、无覆盖和长列表可操作 | PASS |
| RELAY-005 | 导入模型中心草稿 | 重复同步不重复，未发布模型不进入节点 | PASS |
| RELAY-006 | OpenAI Chat/Responses映射 | fixture覆盖请求快照、结果、错误和取消边界；两条真实结果已由用户确认内容、刷新恢复与唯一性 | PASS |
| RELAY-007 | Claude Messages映射 | fixture覆盖请求快照、结果和错误；真实结果已由用户在真实画布确认 | PASS |
| RELAY-008 | Gemini GenerateContent映射 | fixture覆盖请求快照、结果和错误；真实结果已由用户在真实画布确认 | PASS |
| RELAY-009 | GPT Image与通用图片映射 | 零Provider fixture覆盖参考素材、结果和失败 | USER_RECHECK |
| RELAY-010 | 通用视频异步任务 | fixture覆盖提交、轮询、恢复和发布；真实单节点及零费用刷新/重启/去重恢复闭环通过 | PASS |
| RELAY-011 | 通用音频异步任务 | 零Provider fixture覆盖提交、轮询、格式校验和发布 | USER_RECHECK |
| RELAY-012 | 模型停用/安全删除与回归 | 默认/引用/任务保护，现有OpenRouter、方舟、Mureka不降级 | USER_RECHECK |

实现完成只能进入`USER_RECHECK`。只有用户自己的真实连接、对应自动门禁和人工实页确认同时满足，单项才可转为`PASS`。自动检查不得创建真实聊天、图片、视频或音频任务；用户手动授权的真实生成必须与目录检查和自动检查分开记录。

### 5.1 2026-08-03候选实现快照

- 平台连接、增强目录与`/v1/models`回退、只读余额/用量/价格/任务状态查询已进入本地候选。
- 模型发现页具备搜索、节点类型与协议筛选、紧凑复选框、长文本收敛和固定批量操作栏；目录导入只产生未发布草稿。
- 模型保存明确记录协议；OpenAI Chat/Responses、Claude Messages、Gemini GenerateContent、GPT Image和通用媒体映射均使用服务端适配器，不按模型名猜协议。
- 通用媒体结果须经过地址、类型、大小和私网边界校验后进入项目私有媒体；短期结果地址不进入任务快照。
- 目录、Key检查、生成提交/轮询和结果媒体下载共用安全HTTPS传输：校验全部DNS结果后把实际socket固定到同一公网IPv4/IPv6，TLS仍校验原域名，不跟随重定向。
- fixture与专项检查使用本地模拟响应，真实聊天、图片、视频和音频任务创建数为0，收费Provider请求数为0。
- 这一快照只证明本地候选和自动门禁，不证明用户的真实中转站Key、具体模型权限或真实生成可用；12项统一等待用户实页复验。

### 5.2 2026-08-04真实目录与Video单节点验收

- 用户已在本机管理员页面完成优创真实Key检查、目录同步、分类筛选、模型草稿导入和手动发布；密钥没有进入聊天或文档。
- 真实目录同时读取`/v1/skills/models`与`/v1/models`。增强目录返回101条，基础目录返回55条；按模型ID与能力合并去重后保存129条，分类为文字55、图片17、视频50、音频7。目录诊断、同步和筛选均未创建生成任务。
- 已选Video模型先于`2026-08-04T03:54:42.704Z`创建模型中心草稿，再由管理员于`03:55:01.914Z`手动发布，证明目录导入没有自动发布或改变默认模型。`RELAY-001～005`由用户确认后正式PASS。
- 用户使用该模型手动创建真实Video任务`8275d86c-602e-42ab-b444-969224dea601`，协议为`media-generate`，第三方任务ID为`93467467`。任务按`queued→running→success`完成且attempt为1。
- 结果`f5ae0f1d-0e97-4923-88ef-6a39f292eea6.mp4`为1,493,430字节、5.042秒，SHA-256为`969acbb31c7eed3ab82ecb3df88c7a2394fb5a1813ee094353a3dbeccbe9f412`，已进入私有OSS并登记唯一历史。此次手动生成对应1条Provider边界记录。
- 该结果已完成零费用刷新、服务重启恢复和任务/历史/媒体去重检查；任务、attempt、events、asset、history哈希稳定，三类记录均唯一。用户确认单节点生成成功，因此`RELAY-010`为`PASS`。
- 用户后续在真实画布找到并一次性确认OpenAI Chat/Responses、Claude和Gemini四条文字结果，刷新后保留且没有重复，`RELAY-006～008`正式`PASS`。`RELAY-009/011/012`继续`USER_RECHECK`；Mureka Audio的`RATE_LIMIT`暂停和`INPUT-001～007`的`PARTIAL`状态均不改变。

### 5.3 2026-08-04真实协议自动验证与安全删除

- 用户授权的7次真实API调用均成功，无失败和重复：`openai-chat` task `ff1014f8-1e0a-415a-9ebe-7a5296a50c5f`；`openai-responses` task `b2d27319-cc77-4528-a17b-fff282b03e9e`；`claude-messages` task `f554282e-f332-4a6a-8f18-fb72bcf7bbda`；`gemini-generate-content` task `0be7fd67-c1e2-4c06-950d-76dcf46d573c`。
- 图片：`gpt-image` task `b4bd07a5-9a2b-47f2-8d0f-59a369aa6e71`、asset `0f98c0b7-6ec8-470c-9840-0b94c2efaaa1`；`media-generate` task `2617ceee-acd7-4ccd-b2f9-cd44b3a3e4aa`、asset `12f84f21-0f2b-4c2e-836d-1b64f57dd5d0`。
- 音频：Doubao TTS task `d8deb41b-0a7f-428c-8242-6603c12966cc`、asset `8775c5e5-9a8e-4bcc-9d5d-4f3de68be4b2.mp3`，`audio/mpeg`、32,892字节、1.632秒。`emotion=auto`未持久化或发送`emotionScale`；UI、播放器和OSS自动检查通过，仍等待用户可见确认。
- 收费Provider边界计数由1增至8。真实自动验证本身不等于`USER PASS`；用户后续只对四条文字结果完成可见复验，因此`RELAY-006～008`可据用户验收改为PASS，图片、音频和安全删除仍不得提前PASS。
- 安全删除只使用隔离草稿`relay-delete-fixture-20260804`，先归档后永久删除；已发布、默认、历史引用模型仍受保护，`RELAY-012`仍为`USER_RECHECK`。
- 本轮真实调用已结束，不再自动发起收费Provider请求。

## 6. 交付物

- 多协议Provider连接与目录适配器。
- 四种文字协议适配器、GPT Image适配器和统一媒体任务适配器。
- Provider管理页、模型发现页和模型中心的紧凑交互。
- 版本化输入/任务快照、错误分类、轮询恢复和结果发布。
- fixture、服务端契约测试、浏览器回归、构建和零Provider请求报告。
- 最终人工验收清单；真实生成另由用户逐次授权。
