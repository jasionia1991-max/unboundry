# TapNow 多协议中转站接入实施计划

状态：`AUTHORITATIVE PLAN / APPROVED / NOT IMPLEMENTED / NOT ACCEPTED`  
更新时间：2026-08-03

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
3. 统一地址规范化、HTTPS/本机测试地址边界、超时、响应大小和重定向限制。
4. 安全错误只区分Key无效、权限不足、目录不可读、地址错误、限流、超时和上游异常，不回显密钥或原始敏感正文。

### P1：目录、筛选和导入草稿

1. 优先读取增强目录，失败时安全回退到`/v1/models`。
2. 统一解析模型ID、名称、输入/输出模态、能力、上下文、价格提示和可用协议。
3. 支持搜索、节点类型筛选、协议筛选、分页/虚拟列表和紧凑复选框。
4. 使用固定操作栏展示已选择数量和“添加到模型中心”，不要求滚到列表底部。
5. 去重规则以`providerConnectionId + providerModelId + protocol`为准；重复同步不重复创建模型。

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
| RELAY-001 | 多协议平台连接与密钥安全 | 密钥不进浏览器、日志、数据库业务字段、产物和错误响应 | NOT_STARTED |
| RELAY-002 | Key与目录只读检查 | 仅GET目录；收费Provider请求数为0 | NOT_STARTED |
| RELAY-003 | 增强目录与基础目录回退 | fixture覆盖两种响应、分页、去重和异常 | NOT_STARTED |
| RELAY-004 | 搜索、筛选、紧凑列表和固定操作栏 | 12/14px、16px复选框、无覆盖和长列表可操作 | NOT_STARTED |
| RELAY-005 | 导入模型中心草稿 | 重复同步不重复，未发布模型不进入节点 | NOT_STARTED |
| RELAY-006 | OpenAI Chat/Responses映射 | fixture覆盖请求快照、结果、错误和取消边界 | NOT_STARTED |
| RELAY-007 | Claude Messages映射 | fixture覆盖请求快照、结果和错误 | NOT_STARTED |
| RELAY-008 | Gemini GenerateContent映射 | fixture覆盖请求快照、结果和错误 | NOT_STARTED |
| RELAY-009 | GPT Image与通用图片映射 | 零Provider fixture覆盖参考素材、结果和失败 | NOT_STARTED |
| RELAY-010 | 通用视频异步任务 | 零Provider fixture覆盖提交、轮询、恢复和发布 | NOT_STARTED |
| RELAY-011 | 通用音频异步任务 | 零Provider fixture覆盖提交、轮询、格式校验和发布 | NOT_STARTED |
| RELAY-012 | 模型停用/安全删除与回归 | 默认/引用/任务保护，现有OpenRouter、方舟、Mureka不降级 | NOT_STARTED |

实现完成只能进入`USER_RECHECK`。没有用户自己的中转站Key和人工实页确认，不得把`RELAY-001～012`标为PASS。自动检查不得创建真实聊天、图片、视频或音频任务。

## 6. 交付物

- 多协议Provider连接与目录适配器。
- 四种文字协议适配器、GPT Image适配器和统一媒体任务适配器。
- Provider管理页、模型发现页和模型中心的紧凑交互。
- 版本化输入/任务快照、错误分类、轮询恢复和结果发布。
- fixture、服务端契约测试、浏览器回归、构建和零Provider请求报告。
- 最终人工验收清单；真实生成另由用户逐次授权。
