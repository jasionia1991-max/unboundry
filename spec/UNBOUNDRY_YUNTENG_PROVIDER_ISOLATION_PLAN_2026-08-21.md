# Unboundry 云腾 Provider 隔离与三媒体模型上线实施方案

更新日期：2026-08-21

状态：`GOAL_ACTIVE / PRODUCTION_CODE_PUBLISHED / YUNTENG_CREDENTIAL_GATE_BLOCKED / USER_RECHECK`

建议目标版本：`v0.6.29`

施工续接：`spec/UNBOUNDRY_YUNTENG_PROVIDER_ISOLATION_CHECKPOINT.md`

实施状态（2026-08-21）：v0.6.29代码、GitHub、冻结备份、fresh build、原子切换和不依赖云腾key的生产技术门已完成；独立云腾元数据profile已创建。没有云腾自己的key，且标准「我的连接」只列已有发布模型的平台、当前不显示云腾；不得靠发布占位模型绕过。credential、三模型、binding、task、attempt和真实Provider POST均为0，后续配置按本方案fail-closed，等待经批准的非回显安全运维入口。

## 1. 一句话结论

优创和云腾必须是两个独立的 Provider profile。它们可以复用同一个“天空兼容”技术通道，也可以碰巧使用同一个 API base URL，但绝不能共享平台身份、密钥、余额、账号凭据、模型记录或任务归属。

本次要修的不是三模型执行合同；该合同已经随 v0.6.28 上线。v0.6.29已发布商业Provider隔离和普通模型下拉辨认能力，并创建独立云腾元数据profile；当前真正缺失的是云腾自己的安全凭据、目录同步，以及三条只归属云腾的模型记录和节点绑定。

## 2. 已确认的业务结构

### 2.1 商业与计费边界

| 层级 | 示例 | 在 Unboundry 中的表达 |
|---|---|---|
| 商业平台 / 余额所有者 | 优创、云腾、OpenRouter、火山方舟 | 独立 `provider_profiles` 记录 |
| 技术兼容层 / 上游协议 | 天空兼容 API、OpenAI-compatible、Ark native | Provider driver、protocol 和 endpoint 配置 |
| 平台内模型 | Nano Banana Pro、Kling V3 Omni、Suno V4.5 | 归属于某个 Provider profile 的 `model_profiles` 记录 |
| 用户自己的调用额度 | 用户在优创或云腾分别充值的余额 | `(account_id, provider_profile_id)` 对应的独立账号凭据 |

结论：

- 优创与云腾不是别名，也不是同一个 Provider 的两个展示名；
- 在云腾充值的额度不能被优创 profile 使用，反之亦然；
- “天空”只描述兼容来源或技术通道。除非用户确实直接向天空购买额度，否则不创建名为“天空”的计费 Provider profile；
- 即使优创和云腾最终配置成相同的 base URL，也必须使用两个 profile、两套密钥状态、两组账号凭据和两套模型内部 ID；
- 相同 `provider_model_id` 可以分别存在于优创和云腾，因为真实身份是“Provider profile + Provider model ID + capability + protocol”。

### 2.2 本次三模型的正确归属

| 展示名 | Provider 模型 ID | capability | protocol | 商业 Provider |
|---|---|---|---|---|
| Nano Banana Pro | `gemini-3-pro-image-preview` | `image` | `media-generate` | 云腾 |
| Kling V3 Omni | `kling-v3-omni-cankao` | `video` | `media-generate` | 云腾 |
| Suno V4.5 | `suno-v4.5` | `audio` | `media-generate` | 云腾 |

技术 driver 继续使用 `multi-protocol-relay`。不新增“云腾 driver”，不复制一套媒体执行器，也不把模型写进优创 profile。

## 3. 当前事实与问题定性

方案落笔时的已核实现场：

- 仓库：`/Users/mymy/Documents/unboundry/app`；
- 分支：`codex/unboundry-offline-remediation-2026-08-09`；
- 本地 HEAD：`79151690e4d49045ca3c517bb2e86c17e2d64296`；
- `origin/main`：`a4bfda3cf85cef509cb79d565daec5441896810b`；
- package：`0.6.29`；生产版本：`v0.6.29 / schema39`；
- 生产 current：`/opt/unboundry/releases/v0.6.29-yunteng-provider-isolation-20260821`；
- 生产已有优创 profile，driver 为 `multi-protocol-relay`；
- 发布前生产没有云腾 profile；当前已创建独立云腾元数据 profile，但没有云腾 key、账号凭据、模型或绑定；
- 优创的远端目录快照碰巧出现上述三个 Provider 模型 ID，但生产 `model_profiles` 中没有这三条精确模型记录，也没有节点绑定；
- 因此“在优创目录快照里看见 ID”不等于“模型属于优创”，也不等于“云腾已接入”；
- v0.6.29 隔离代码已经发布，但云腾凭据、目录、模型发布和真实smoke没有完成。当前功能状态是 `PRODUCTION_CODE_PUBLISHED_CONFIGURATION_BLOCKED / USER_RECHECK`，不能写成用户可用、smoke PASS或 `USER_PASS`。

受保护文件 `spec/public-templates-director-split-revision.json` 当前为未跟踪文件。后续所有阶段都禁止读取、修改、格式化、移动、删除、暂存或提交该文件，也不得让它进入 fixture、snapshot、build 或 artifact。

## 4. 现有架构能否支持

现有数据和任务边界已经基本正确，不应为了本次隔离新增 schema：

- Provider 目录导入按 `provider_profile_id + provider_model_id + capability + provider_protocol` 查重；
- 账号凭据以 `(account_id, provider_profile_id)` 为主键；
- Provider task ID 的唯一性包含 `provider_profile_id`；
- task、attempt、credential lease 和恢复路径都保留 Provider profile 身份；
- 管理员模型接口已经返回 `providerName`。

因此默认裁决是 `schema39 保持不变`。只有新 Goal 以直接证据证明现有字段无法维持隔离时，才允许提出 migration；不得为了“结构更漂亮”升级 schema。

当前明确的产品缺口是普通用户 `/api/models` 响应和 `NodeModelControl` 下拉项没有 Provider 名称。若优创和云腾都发布同名模型，用户只能看到两个相同的 “Nano Banana Pro”，容易选错并消耗错误平台的余额。

## 5. 目标体验

节点模型下拉框使用两层信息，而不是把 Provider 名永久拼进模型 display name：

```text
Nano Banana Pro
云腾 · 图片
```

同名模型并存时：

```text
Nano Banana Pro
优创 · 图片

Nano Banana Pro
云腾 · 图片
```

规则：

- 主标题继续是模型商品名，画布既有 `selectedName` 和历史显示不被污染；
- 次级标签显示 `providerName` 与 capability；
- 当前选中态、不可用原因、键盘/ARIA 名称、title 和测试选择器都要包含足够的 Provider 语义；
- 内部选择和任务提交始终使用 model profile 的内部 `id`，不能按 display name 或 Provider model ID 猜测；
- 管理后台继续显示 Provider 名、driver、protocol 和 Provider model ID，并把“平台身份”与“技术通道”分开描述；
- 不把通用 `multi-protocol-relay` 全局改名为“天空”，因为它还可能承载其他中转实现。

## 6. 实施范围

### 6.1 公共模型目录

1. 让 `/api/models` 对每条已发布模型返回稳定的 `providerName`；必要时同时返回 `providerProfileId`，但客户端不得据此绕过模型内部 ID。
2. 更新 `client/src/models/ModelCatalog.tsx` 的 `PublishedModel` 类型。
3. 确保旧服务响应缺少新字段时客户端有安全兼容显示，不因一次滚动发布白屏。
4. 不向普通用户返回 base URL、密钥状态、密钥内容或其他敏感 Provider 配置。

### 6.2 节点模型选择器

1. `client/src/canvas/NodeModelControl.tsx` 在选项中展示 Provider 次级标签；同名模型必须能被视觉和辅助技术区分。
2. 选中按钮在空间允许时显示 Provider；若需保持紧凑，至少 title/aria-description 中明确 Provider，并确保展开后立即可辨认。
3. 继续按 model internal ID 保存和提交，绝不把 Provider 名当身份键。
4. 增补必要样式，处理窄节点、长平台名、省略号和高对比度状态。

### 6.3 管理端术语与防误操作

1. Provider profile 的名称必须直接使用商业平台名“云腾”。
2. 管理界面将商业平台、技术 driver、调用 protocol 分行或分标签显示，避免“优创 = 天空 = 云腾”的误读。
3. 目录同步、导入草稿、发布、绑定等动作必须始终在当前选中的 profile 下进行；确认文案应带 Provider 名。
4. 不自动搬迁、改名、归档或删除优创已有配置；不把优创模型重新归属到云腾。

### 6.4 生产配置与模型发布

生产步骤必须在新 Goal 的发布阶段执行，并保留前后证据：

1. 读取版本、service、数据库完整性、profile/model/binding/task/attempt 基线；
2. 创建冻结备份并核对清单；
3. 创建独立 Provider profile：显示名“云腾”，driver `multi-protocol-relay`，使用云腾实际提供的 base URL 和云腾自己的密钥；
4. 通过既有加密入口保存 Provider 目录凭据；如生成需要账号级凭据，再为目标账号保存 `(account_id, 云腾profile)` 的独立凭据；
5. 先只读同步云腾目录，核对三条精确 Provider 模型 ID；
6. 只在云腾 profile 下导入三条 draft，逐条核对 capability、`media-generate`、参数 schema 和可用性原因；
7. 发布并启用三条模型绑定，初次不得擅自替换其他 Provider 的默认模型；
8. 从普通账号验证 `/api/models` 和节点下拉框均显示“云腾”，且任务预检选中的是云腾内部 model ID / profile ID；
9. 完成零付费门后，才允许执行有界真实 smoke；
10. 更新生产回执、当前状态和验收状态为 `USER_RECHECK`，等待用户实际使用后决定 `USER_PASS`。

密钥不得写入 Goal 文本、Markdown、Git、终端回显、测试 fixture 或聊天记录。用户给出的“所有权限”不等于凭空获得云腾密钥；新 Goal 开始前应先通过产品的安全入口准备好云腾自己的密钥。若密钥不存在，Goal 应先完成所有不依赖密钥的工作，然后在凭据门 fail-closed，绝不能借用优创密钥或伪造成功。

## 7. 测试与验证策略

### 7.1 实现期：风险驱动定向验证

直接覆盖以下行为：

- 公共 `/api/models` 返回正确 `providerName`，不泄露敏感 Provider 配置；
- 两个 Provider 下允许存在相同 `provider_model_id`，并得到不同内部 model ID；
- 同一 Provider 内相同四元组仍正确跳过重复导入；
- 优创与云腾账号凭据独立，缺少云腾凭据时不得回退使用优创；
- task、attempt、recovery 和 Provider task identity 保留云腾 profile；
- 节点下拉中同名模型能明确区分优创/云腾，选择后提交内部 ID 正确；
- 管理端导入、发布、绑定操作不会跨 profile；
- 三模型原有参数和异步恢复合同不回归。

优先使用现有直接相关 spec：m12、m43、m46、m47、m50、m57、m73，以及 UI/节点目录直接覆盖的 m40、m44；以实际职责为准做最小调整，不为凑编号扩大范围。

测试规则：

- 使用新临时数据目录、动态 loopback、fake fetch；禁止默认 4173、`app/data`、`/var/lib/unboundry`、真实媒体和真实密钥；
- 实现期间先跑 TypeScript/直接 spec，失败只重跑失败 spec 或最小相邻集合；
- 同一源码、环境和成功结果不得重复运行；
- 独立 review 只做一次：在定向测试转绿后，由一个独立 subagent 审查 Provider 身份、凭据、任务归属、UI 歧义和发布/回滚边界；发现项由主 agent 修复并做相应最小复验；
- 候选冻结后执行一次正式安全 full。这是生产切换前的发布门，不得把自动 full 直接打到生产数据；
- full 若失败，只诊断并重跑失败项/最小集合。除非修复触及新的共享高风险边界，否则不得第二次重复 full。

### 7.2 上线后：一次完整生产技术验收

“上线后全量检验”定义为对完整生产验收矩阵逐项核验，不是在生产数据库上运行本地自动测试套件：

1. 公网与 loopback 版本、Git tag/tree/release artifact 一致；
2. service active/enabled，restart、应用错误和 nginx 错误符合门槛；
3. schema39、integrity、FK、关键表计数、active task、模板和媒体清单无非预期变化；
4. 优创 profile、凭据、模型和历史任务保持原样；
5. 云腾 profile 独立存在，base URL/driver/protocol 状态正确且密钥不回显；
6. 三模型只归属于云腾 profile，内部 ID、绑定、发布状态和非默认策略正确；
7. 普通用户目录与四类节点的完整可见性/不可用原因正确，同名模型可辨认；
8. 静态资源与 release 逐字节一致，浏览器无新增 error/warn；
9. 有界真实 smoke 的 task、attempt、Provider task ID、结果类型和保存归属逐项一致，重复 POST 为 0；
10. 回执写明自动 full、生产验收、真实 smoke 和用户主观验收是四种不同证据，不得把前三者写成 `USER_PASS`。

### 7.3 有界真实 Provider smoke

只有在云腾独立凭据有效、零付费门全部通过且新 Goal 已明确授权的情况下执行：

- Nano：1K 文生图 1 次；
- Kling：5 秒 standard 文生视频 1 次；
- Suno：instrumental 1 次。

总创建 POST 上限为 3。任一请求出现未知提交结果、超时、失败或无法证明退款时，不自动重试，不切换到优创，不换账号绕过；保留 task/attempt/providerTaskId 证据并报告。

## 8. 发布与回滚

### 8.1 发布顺序

1. 冻结实现和文档；
2. 定向测试绿；
3. 一次独立 review 并解决发现；
4. 一次正式安全 full；
5. 版本升级为 v0.6.29，精确提交、tag、push、PR/merge；
6. 生产冻结备份；
7. fresh build 和原子 current 切换；
8. 先完成代码版本生产技术门，再配置云腾 profile/模型；
9. 零付费生产验收；
10. 最多 3 次真实 smoke；
11. 完整生产技术验收、回执和文档同步；
12. 停在 `PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK`，由用户决定是否 `USER_PASS`。

### 8.2 回滚原则

- 代码故障：原子切回上一个不可变 release，并保留 v0.6.29 现场和日志；
- 云腾配置故障：先停用/归档云腾的模型绑定或禁用云腾 profile，不删除历史 task/attempt；
- 不把云腾模型改绑到优创作为“回滚”；
- 不删除优创、云腾、媒体、数据库、备份或审计记录；
- 未知 Provider 提交状态优先保留证据和等待核对，不靠重新 POST 恢复绿色；
- 回滚后重新核对 service、版本、schema/integrity/FK、关键数据计数和公网资源。

## 9. 验收矩阵

| 编号 | 验收项 | 必须证据 | 阻断级别 |
|---|---|---|---|
| P0-01 | 优创与云腾是两个 profile | profile ID、名称、driver/config 摘要 | P0 |
| P0-02 | 凭据与余额边界隔离 | 两组 credential identity；禁止 fallback 测试 | P0 |
| P0-03 | 三模型只在云腾发布 | model/profile/binding 查询 | P0 |
| P0-04 | 同 Provider ID 可跨 profile 共存 | 导入/查重定向测试 | P0 |
| P0-05 | 普通用户可辨认 Provider | API + 节点 UI/ARIA 测试 | P0 |
| P0-06 | 任务全链保留云腾身份 | task/attempt/recovery 定向测试与 smoke | P0 |
| P0-07 | 优创配置和历史不变 | 发布前后差异证据 | P0 |
| P0-08 | 无密钥泄露或错误借用 | 日志/响应/fixture 检查 | P0 |
| P0-09 | 有界付费且不重复提交 | POST 计数、task/attempt/providerTaskId | P0 |
| P0-10 | 可恢复发布与配置回滚 | 冻结备份、release 指针、禁用方案 | P0 |
| P1-01 | 三模型参数合同无回归 | 原定向媒体 spec | P1 |
| P1-02 | 管理端术语清楚 | 页面/组件验证 | P1 |
| P1-03 | 同名长文本布局可用 | UI 定向验证 | P1 |
| P1-04 | 文档与生产回执一致 | diff/checkpoint/receipt | P1 |

任何 P0 未通过均不得发布或不得继续真实 smoke。自动门通过只记 `AUTO_PASS`；生产技术门通过只记 `PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK`；只有用户明确验收后才能写 `USER_PASS`。

## 10. 明确不做

- 不新增云腾专用 Provider driver 或第二套媒体执行框架；
- 不创建“天空”计费 profile；
- 不把 Provider 名永久写进模型 display name；
- 不迁移、复用、删除或覆盖优创的密钥、余额、模型和历史任务；
- 不修改 Canvas/Workflow 执行架构、Template、Auth 产品范围或 Storage backend；
- 默认不改 schema；
- 不无限扩展 Provider smoke，不自动重试未知付费结果；
- 不读取或提交受保护 JSON；
- 不在本轮文档工作中启动 Goal、改代码、测试产品、发布或生产操作。

## 11. 当前 Goal 凭据门

当前 Goal 已由用户明确启动并授权 v0.6.29 发布、SSH、生产配置、GitHub 与最多三次真实创建 POST。云腾 API key 仍只能通过 Unboundry 既有安全入口取得，不能写入聊天、Markdown、Git、测试或终端回显。若安全入口没有云腾自己的 key，先完成全部不依赖密钥的发布阶段，最后在凭据门 fail-closed；不得借用优创 key。
