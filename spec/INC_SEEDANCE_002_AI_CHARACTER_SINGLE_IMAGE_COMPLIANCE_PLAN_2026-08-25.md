# INC-SEEDANCE-002：AI 角色单图合规验证详细方案

状态：`PLAN_DOCUMENTED / IMPLEMENTATION_NOT_STARTED / VERSION_UNSET / AUTHORIZATION_NOT_GRANTED`

建立日期：2026-08-25

事件目标：在不冒充 TapNow 私有后端、方舟可信真人素材或法律审查的前提下，为 Unboundry 设计一条可落地、可审计、可替换 Provider 的「AI 角色单图合规验证」链路，并明确只有在真实上游旁路合同得到证明后，才允许把蓝色通过标记用于 Seedance 提交放行。

唯一实时断点：`spec/INC_SEEDANCE_002_AI_CHARACTER_SINGLE_IMAGE_COMPLIANCE_CHECKPOINT.md`

当前生产事实仍以 `spec/UNBOUNDRY_CURRENT_STATE.md` 为准：生产运行 `v0.6.40 / schema40`；INC-SEEDANCE-001 的方舟 Assets API 可信真人素材链因 `SubscriptionRequired` 阻断。本文是新事件的实施方案，不改写旧事件、旧回执、旧用户验收或现网状态。

## 0. 一句话结论

TapNow 当前菜单做的是「判断这张单图是不是可被 Seedance 接受的原创/AI 角色」，不是「给真人做 H5 实名认证并注册 `asset://`」。Unboundry 应把两条能力彻底分开：

- `AI 角色单图合规验证`：针对原创或 AI 生成人物，输出与图片字节、策略版本和 Provider 身份绑定的审查结论；
- `真人授权可信素材`：针对有合法授权的真实人物，继续属于 INC-SEEDANCE-001 的企业级方舟 Assets API/H5/Group/Asset 链；
- 在上游没有给出可验证的「审核结果如何旁路 Seedance 筛查」合同前，新功能最多只能叫「角色风险预检」，不能显示“已可用于 Seedance”蓝勾，也不能让付费 Generation 绕过服务端门禁。

## 1. 语义纠正与历史边界

### 1.1 此前映射错在哪里

v0.6.38～v0.6.40 的「角色可信素材」实现对应方舟私域真人素材：H5 授权、身份 Group、Asset、Active、`asset://`。这条实现和安全合同本身仍是有效历史成果，但它不是 TapNow 截图中的「Seedance 2.0 合规验证」。

TapNow 当前页面与前端文案显示，它的目标是筛出以下内容：

- 可以验证：原创角色、AI 生成角色，包括看起来很真实的 AI 人物；
- 不可以验证：真人照片、明星/公众人物、受版权保护的 IP 角色；
- 每张图片独立验证，成功后显示蓝色验证标记；
- 用户有真人或版权授权，也不能靠这条单图验证通过，应走独立企业通道。

因此，本事件不得复用 `seedance_asset_bindings`、H5 Session 或 `asset://` 状态来表示 AI 角色合规，也不得把 INC-SEEDANCE-001 的 `BLOCKED_EXTERNAL_CAPABILITY` 写成 TapNow 同类功能已完成。

### 1.2 历史状态保持不变

- v0.6.38 用户通过：只证明图片全屏和当时失败状态呈现通过，不证明 Provider 协议成功；
- v0.6.40 技术上线：只证明诊断与发布链健康；真实 H5 创建仍为 `403 SubscriptionRequired`；
- 旧 `imageSeedanceValidation`：只作为本地结构预检历史字段，不升级为 AI 角色合规结论；
- 任何旧 `ACTIVE`、`USER_PASS`、本地预检或图片工具技术冒烟，都不能迁移成本文的新 `APPROVED`。

## 2. 证据分层

| 证据 | 能证明什么 | 不能证明什么 | 本方案用法 |
|---|---|---|---|
| 2026-08-25 登录态 TapNow 实页与当前前端 bundle | 当前可见入口、文案、允许/禁止范围、逐图验证和蓝勾体验 | TapNow 私有后端接口、模型、阈值、旁路令牌 | 产品语义事实源 |
| [AIGC-PineLine](https://github.com/maitongxue1994/AIGC-PineLine) 及 commit `0d1baa06f84d` | 有同款菜单、蓝勾和成功提示；明确是 TapNow 风格 UI | 真实合规服务 | 只作 UI 参考；源码实际只是 `compliance:true` 本地模拟 |
| [nextbound/bragi-canvas](https://github.com/nextbound/bragi-canvas) | `asset://`、Asset 注册与状态查询的开源实现线索 | TapNow 的 AI 角色单图判断 | 只作方舟 Asset API 对照，不作本事件 Provider |
| 方舟私域真人素材正式合同与 INC-SEEDANCE-001 | H5/Group/Asset/Active/`asset://` 企业链 | AI 角色原创性、公众人物、版权 IP 判断 | 保持为独立企业通道 |
| Unboundry 当前 schema40 与 Seedance 提交门 | owner/profile/checksum/任务快照与 Provider 前复核基础 | TapNow 的私有旁路协议 | 可复用安全模式，不复用业务状态 |

TapNow 前端证据快照：2026-08-25 实页及当时加载的 [index-C3ZI6hGH.js](https://fe-assets.tapnow.media/8c27c80eb61967ec43df18c83d8ffb1d8acd04aa/assets/index-C3ZI6hGH.js)。这是时点证据；bundle 更新后必须重新核对，不把旧 hash 当永久合同。

证据纪律：若后续 Provider 调研与 TapNow 文案冲突，必须记录来源、时间、账号/地域/产品版本和可复现实测；不得用开源仿制 UI 推断真实后端。

## 3. 产品范围

### 3.1 进入本事件

1. 图片节点「更多」中的单图动作：`AI 角色合规验证`。
2. 对当前图片字节做异步检查，识别：
   - AI/原创人物角色；
   - 真人照片风险；
   - 明星/公众人物风险；
   - 受版权保护 IP 风险；
   - 未成年人、来源不明、低置信或不可判断风险。
3. 结论与 `owner + source asset + checksum + policy revision + provider profile + model revision` 强绑定。
4. 只有服务端证明的当前有效结论才能显示蓝色标记。
5. 在付费 Seedance 提交前重新核验结论，图片被替换、字节变化、策略升级、Provider 身份变化、过期或撤销时必须失败关闭。
6. 结果原因、时间、版本和重试边界可审计，但不保存秘密、原始 Provider Body、完整敏感消息或生物特征向量。

### 3.2 不进入本事件

- 不做真人 H5 身份认证、Group、Asset 或 `asset://` 注册；
- 不做 Subject/@ 角色库、LoRA、角色一致性训练或社区素材库；
- 不做版权确权、肖像权确权或法律意见；
- 不因用户声称“有授权”自动通过；
- 不做付费视频生成或真实 OSS 测试写入；
- 不复刻 TapNow 私有接口，不抓取或使用其登录 Cookie、内部 token、服务端接口或未公开模型；
- 不在本计划事件修改代码、schema、生产、云权限或发布版本。

### 3.3 非人物图片

场景、动物、商品、建筑、纯文字等没有人物角色的图片默认 `NOT_REQUIRED`，不强制用户提交人物合规验证。分类不确定时进入 `REJECTED_UNCERTAIN` 或未来的人工复核，不自动标蓝。

## 4. 用户体验合同

### 4.1 入口与首次告知

- 入口放在 Image 节点「更多」菜单，文案优先使用 `AI 角色合规验证`，避免继续和真人可信素材混淆；
- 首次点击先显示简短告知：图片会发送给所选审核服务、用途、保存时间、可接受范围和不能证明的法律事项；
- 用户明确确认后才创建审核任务。不得复制 TapNow 当前可能“一点即提交”的易误触体验；
- 已确认告知可按账号和告知版本保存，告知版本变化后重新确认；
- 无登录、图片未 ready、缺 checksum、来源不归当前 owner、能力关闭或 Provider 未配置时，零外部请求失败关闭。

### 4.2 状态机

| 状态 | 用户看到的含义 | 允许的动作 |
|---|---|---|
| `NOT_REQUIRED` | 未检测到人物角色，无需此验证 | 正常使用普通参考图路径 |
| `NOT_SUBMITTED` | 尚未验证 | 查看说明、提交 |
| `DISCLOSURE_REQUIRED` | 需要同意发送和处理说明 | 同意或取消 |
| `QUEUED` | 已进入本地队列，尚未到 Provider | 取消本地等待 |
| `CHECKING` | 审核中 | 查看状态；不得重复提交 |
| `APPROVED` | 当前图片与当前策略下通过 | 显示蓝勾；是否可旁路 Seedance 仍受第 6 节能力分支控制 |
| `REJECTED_REAL_PERSON` | 疑似真人照片 | 换原创/AI 角色；有授权走企业真人通道 |
| `REJECTED_PUBLIC_FIGURE` | 疑似明星或公众人物 | 换角色；不得靠提示词声明绕过 |
| `REJECTED_COPYRIGHT_IP` | 疑似受保护 IP | 换自有原创角色；有授权走人工/企业通道 |
| `REJECTED_MINOR_OR_SENSITIVE` | 涉及未成年人或敏感人物风险 | 停止自动处理，进入保守人工策略 |
| `REJECTED_UNCERTAIN` | 证据或置信度不足 | 换图或走人工复核；不得自动通过 |
| `FAILED_RETRYABLE` | 网络或服务暂时异常，远端未受理可证明 | 受限重试 |
| `FAILED_TERMINAL` | 参数、权限、产品能力或确定性拒绝 | 修复原因后新建检查 |
| `STALE_SOURCE` | 图片字节或来源已变化 | 对新 checksum 重新检查 |
| `EXPIRED` | 结论超过有效期或策略已升级 | 重新检查 |
| `REVOKED` | Provider/管理员撤销 | 不得使用；按新策略处理 |

蓝勾只允许对应 `APPROVED + current checksum + current policy revision + current model revision + current provider profile + not expired + not revoked`。节点复制可以复制图片引用，但不能复制另一 owner 的审核权利；替换图片必须原子失效旧标记。

TapNow 文案观察到单图约需 10～30 秒，这只能作为产品参照，不是 Unboundry SLA。实际轮询间隔、总 deadline 和用户提示必须来自所选 Provider 正式合同与受控实测，不能硬编码 10～30 秒后把未完成任务判失败。

### 4.3 文案边界

允许：`这张图在当前 AI 角色策略下通过`、`可进入 Seedance 提交前复核`。

禁止：`版权已认证`、`法律合规`、`真人已授权`、`永久可用`、`TapNow 官方认证`、`Seedance 一定不会拒绝`。

## 5. 最关键的能力分支

TapNow 的蓝勾为什么能让后续 Seedance 跳过筛查，当前没有公开可验证合同。它可能依赖同平台内部白名单、私有素材 ID、审核票据、隐藏元数据或同一商业账号的内部能力。实现前必须冻结唯一分支：

### A：只完成内部风险预检

- 可接入合法可用的图像审核/溯源服务；
- 结论只影响 Unboundry 自己的 UI 和提交前风险提示；
- 菜单必须命名为 `角色风险预检`；
- 不显示“Seedance 已验证”蓝勾，不声称能旁路 Provider；
- Seedance 仍按普通参考图提交，Provider 拒绝按原协议处理。

### B：真实上游旁路合同已证明

只有以下全部成立才可进入 B：

1. 上游正式一手合同明确支持 AI 角色单图审核；
2. 审核响应提供可绑定图片 checksum、账号、模型和有效期的票据或素材 ID；
3. Seedance 正式提交合同明确说明该票据如何传入；
4. fake 合同、零付费集成和真实受限控制面验证均通过；
5. 真实 Provider 预算、数据处理、版本和发布分别获得新授权。

B 分支才允许显示 `Seedance 角色验证通过` 蓝勾，并把票据放入只读任务快照，在真实 Provider 边界再次校验。

### C：无合法/可用审核能力

- 隐藏或禁用入口；
- 明确显示“当前未接入角色审核服务”；
- 不提供本地假勾，不用 AIGC-PineLine 的 `compliance:true` 模拟；
- INC-SEEDANCE-001 的真人企业通道也必须按其自身能力探测显示，不互相兜底。

R0 必须通过正式合同或受控实测选定 A/B/C；在此之前默认 C。

## 6. 技术架构

### 6.1 分层

新增独立边界，建议命名：

- `SeedanceCharacterCompliancePort`：Provider 抽象，只暴露 create/inspect/cancel-capability；
- `SeedanceCharacterComplianceApplication`：准入、幂等、状态推进、失效和 owner scope；
- `SeedanceCharacterComplianceStore`：持久化检查、票据元数据和审计；
- `seedanceCharacterComplianceApplicationApi`：owner-scoped HTTP DTO；
- `SeedanceCharacterCompliancePanel`：纯 UI，不接触 Provider 凭据或远端原始响应；
- `resolveSeedanceCharacterReference`：Generation 提交前的唯一判别联合。

禁止把业务编排继续堆入 `ImageNode.tsx`。ImageNode 只负责打开面板、读取安全 DTO 和显示状态；异步、重试、checksum、权限、过期和 Provider 复核全部在服务端。

### 6.2 数据流

1. 客户端从当前 owner-scoped ready Image asset 打开面板；
2. 服务端重新读取 Media 权威行，冻结 `assetId/sourceKind/sourceId/checksum/byteSize/mime/width/height`；
3. 能力、告知、限速、owner、Provider profile 与幂等门通过后，创建本地 Check；
4. 本地提交采用稳定 request key；只有没有既有 `accepted/response-received/outcome-unknown` 证据时才能创建新远端 attempt；
5. Provider 通过 callback 或有界 polling 更新；回调必须签名、时间窗、nonce 和 check identity 全部通过；
6. 只把枚举状态、受限 reason code、Provider request ID 摘要、策略/模型版本和过期时间写库；
7. UI 轮询本地状态，绝不直接轮询 Provider；
8. Generation 提交前重新取当前 Check，核对 checksum、策略、模型、账号、有效期与撤销；
9. 只有 B 分支可把服务端票据转换为 Provider 正式参考类型；A 分支只作内部风险预检，C 分支零外部请求。

### 6.3 幂等与结果未知

稳定幂等键建议：

```text
SHA256(
  ownerId |
  sourceKind | sourceId | sourceChecksum |
  providerProfileId | providerAccountFingerprint |
  policyRevision | providerModelRevision |
  disclosureRevision
)
```

- 同键已有 `QUEUED/CHECKING/APPROVED/REJECTED_*` 时返回同一 Check；
- Provider 已受理、已收到响应或结果未知时禁止自动新建第二个远端 attempt；
- 只有确定性未受理或用户明确 abandon 且 Provider 合同允许时，才能创建新 attempt；
- UI 双击、刷新、丢 POST 响应和服务重启必须恢复同一 Check。

## 7. 数据模型

新 schema 必须使用独立表，不能复用 `seedance_asset_bindings`：两者一个是 AI 角色策略结论，一个是真人授权 Asset，混用会产生错误信任提升。

建议主表 `seedance_character_compliance_checks`：

| 字段 | 说明 |
|---|---|
| `id` | 本地 UUID |
| `owner_id` | 强 owner scope |
| `source_kind/source_id/source_checksum` | 当前图片身份 |
| `provider_profile_id/provider_account_fingerprint` | 商业与凭据身份 |
| `policy_revision/provider_model_revision/disclosure_revision` | 决策版本 |
| `capability_branch` | `A/B/C` |
| `status/reason_code` | 受限枚举 |
| `idempotency_key` | 同一语义唯一 |
| `provider_check_id_digest/provider_request_id` | 受限诊断；不暴露完整秘密 |
| `provider_ticket_ciphertext` | 仅 B 分支且确有正式票据；应用密钥加密 |
| `requested_at/accepted_at/completed_at/expires_at/revoked_at` | 生命周期 |
| `superseded_by` | 图片或策略变化后的替代检查 |
| `created_at/updated_at` | 审计时间 |

建议 attempt 表 `seedance_character_compliance_attempts`：记录本地 attempt、admission、accepted/response-received/outcome-unknown/definitive-rejected/provider-failed，不保存原始 Body。

建议 disclosure 表或现有账号设置扩展：记录 `owner_id + disclosure_revision + accepted_at`。不得存储人脸 embedding、身份号码、原图副本或长期人像特征；Provider 若要求此类数据，必须单独做隐私与法律评估。

必要约束：

- `(owner_id, id)` 唯一；
- `(owner_id, idempotency_key)` 唯一；
- source 必须引用当前 owner 的 ready Image Media；
- `APPROVED` 必须有完成时间、策略/模型版本和有效期；
- B 分支 `APPROVED` 才可有加密票据；A/C 不得存旁路票据；
- 替换/删除 source 时旧 Check 不删除历史，但必须变成不可用。

## 8. HTTP 合同

建议新增：

### `GET /api/seedance/character-compliance/capability`

返回当前 A/B/C、用户可见原因、告知版本、允许的 source 类型和安全轮询建议。不得返回 Provider 账号指纹、内部模型 ID、密钥或购买链接自动动作。

### `POST /api/media/image/{assetId}/seedance/character-compliance-checks`

创建或返回幂等 Check，正常快速返回 `202`。服务端重新计算/核对 checksum；客户端不能提交 `APPROVED`、reason、ticket 或 Provider ID。

### `GET /api/seedance/character-compliance-checks/{checkId}`

只返回 owner-scoped 安全 DTO：状态、用户文案、reason code、策略版本、完成/过期时间、是否当前有效、是否可用于 Seedance 提交。

### `GET /api/media/image/{assetId}/seedance/character-compliance-current`

返回当前 checksum 下的最新有效结论，供刷新恢复和节点蓝勾使用。

### `POST /api/seedance/character-compliance-checks/{checkId}/cancel`

只在 Provider 正式支持取消时传递远端取消；否则只取消本地尚未提交的 `QUEUED`。不得把“停止本地等待”冒充远端已取消。

所有 mutation 必须有登录、CSRF/Origin/Host、owner scope、body 上限、rate limit、request ID、幂等和统一异步错误边界。OpenAPI 与实际 DTO 同批冻结。

## 9. Provider 判定合同

### 9.1 结果必须保守

自动系统不能真正证明“原创”或“拥有版权”。`APPROVED` 只能表达：在当前技术策略下，图片表现为 AI/原创角色，且真人、公众人物、版权 IP、未成年人/敏感风险均低于明确阈值。

任一必要信号缺失、模型冲突、质量不足、低置信或 Provider 无法判断，统一 `REJECTED_UNCERTAIN`，不能采用“多数投票就通过”。

### 9.2 最小判定输入

- 图像内容分类与人物存在性；
- 真实照片/合成人物概率；
- 公众人物相似度风险；
- 受保护 IP 相似度风险；
- 未成年人/敏感场景风险；
- 图片质量、遮挡、多人、拼图或元数据异常；
- 可选的生成溯源/C2PA/内部生成记录，只作正向辅助，不能单独证明版权。

### 9.3 Provider 选择门

候选 Provider 必须满足：

- 正式允许该用途和商业使用；
- 数据地域、保留期、训练用途和删除机制可确认；
- 支持异步状态、幂等或可由本地包装；
- 返回结构化原因和模型/策略版本；
- 有可测试的速率、超时和费用边界；
- B 分支另需正式 Seedance 旁路票据合同。

如果没有 Provider 同时满足这些条件，保持 C；不得临时用通用视觉模型一句自然语言判断后打蓝勾。

## 10. Seedance Generation 集成

在创建付费任务之前，对所有人物角色参考图执行：

1. 重建当前 owner、asset、checksum 和模型输入角色；
2. 判断是否人物角色以及当前 capability 分支；
3. B 分支要求当前有效 `APPROVED` 与加密票据，并在任务快照冻结 `checkId/checksum/policy/model/provider identity/expiresAt`；
4. 真正 Provider 边界前再次从库与远端必要只读状态核对；
5. 任一漂移在付费前返回明确错误，Generation task/attempt/费用为 0；
6. A 分支只能增加风险提示或按产品决定 fail-closed，不能构造假票据；
7. C 分支不得显示可旁路状态；普通无人物参考图继续走既有 URL/Data reference 合同；
8. Provider 最终仍可能拒绝，必须原样记录为 Provider 结果，不能反向把本地 Check 改成法律结论。

任务恢复时只使用已冻结 Check 快照，但真正发起新付费 attempt 前仍核对当前有效性。已被 Provider 接受的既有付费 attempt 不因后续策略变化自动重提。

## 11. 隐私、安全与治理

- 明示图片会被发送到哪个类别的服务、目的、保留时间和退出方式；
- 默认最短保留；只保存业务必要的 source checksum 与枚举结果，不复制原图；
- 未成年人、真实人物、公众人物和敏感人物一律保守拒绝自动通道；
- 不把人像图片、特征或票据写日志、analytics、错误消息或前端 localStorage；
- Provider 凭据只在服务端；callback 使用独立 secret、签名、nonce 和重放窗口；
- 管理员只能看到受限统计，不可跨 owner 浏览原图；
- 删除账号/媒体时，按现有 saga 清理可删除元数据并撤销可用性；远端删除能力若不确定，要明确展示保留边界；
- CSP、SSRF、redirect、DNS pinning、响应体大小、mime/PNG 解码、20MiB 上限和超时沿用现有媒体安全底座；
- 变更策略版本必须让旧结论过期，不允许静默沿用；
- 不提供“用户勾选我有授权”作为技术旁路。

## 12. 失败、重试与恢复

| 情形 | 处理 |
|---|---|
| 本地准入失败 | 零 Provider 请求，返回确定性错误 |
| Provider 确定性 4xx 未受理 | `FAILED_TERMINAL` 或受限 reason；修复输入后新 Check |
| Provider 明确 429/5xx 且确认未受理 | `FAILED_RETRYABLE`，有界退避并受预算控制 |
| POST 已发送但响应丢失 | `outcome-unknown`，只查询/对账，不自动重发 |
| callback 重复/乱序 | 以 provider revision/sequence 和 terminal fence 幂等吸收 |
| 服务重启 | 从持久 Check/attempt 恢复，不重复提交 |
| 图片替换 | 原子标记 `STALE_SOURCE`，新 checksum 新 Check |
| 策略/模型升级 | 旧 Check `EXPIRED`，不得继续蓝勾 |
| 票据过期/撤销 | 提交前拒绝，付费 attempt 为 0 |
| 删除图片/账号 | 立即不可用；按合同尝试远端删除，不伪造已删除 |

## 13. 分阶段施工计划

### R0：事实与能力冻结

- 固定 TapNow 当前产品语义证据、开源 UI 模拟边界和 INC-SEEDANCE-001 独立边界；
- 从正式一手资料确认候选 Provider、数据政策和旁路合同；
- 选择 A/B/C，默认 C；
- 写下版本、预算、Provider/生产/GitHub授权；缺任一项停止。

完成门：`CAPABILITY_BRANCH_CONFIRMED`，且没有用 UI 或猜测代替 Provider 合同。

### R1：失败合同与夹具

- 建立正/负/不确定/真人/公众人物/IP/未成年人/多人/低质/非人物夹具；
- 先让新验收在无实现时精确失败；
- 夹具必须使用有权测试的自建/合成素材，不下载明星或受版权保护图库作仓库资产。

完成门：预期红原因与本方案逐项一致，外部请求 0。

### R2：领域、表与迁移

- 新增独立 Check/Attempt/Disclosure 模型和 migration；
- 加 owner/checksum/provider/policy 约束与删除/替换失效；
- 贯穿备份、恢复、逻辑指纹、exact schema、bridge/final 与媒体完整性。

完成门：迁移/回滚/损坏拒绝专项通过，不接真实 Provider。

### R3：Port 与 fake Provider

- 实现 `SeedanceCharacterCompliancePort`、fake adapter、受限错误映射；
- 覆盖 accepted、response-received、outcome-unknown、callback乱序、超时、取消和重启；
- 凭据回显扫描和非 loopback 门通过。

完成门：fake 全状态可重复，真实请求 0。

### R4：Application 与 API

- 实现准入、幂等、owner scope、限速、恢复、失效、OpenAPI；
- Image media 权威重建，不信任 Canvas 字段；
- DTO 不泄露内部 ID、票据或原始 Provider 错误。

完成门：API 与安全负例定向通过。

### R5：Image 节点 UI

- 新增菜单、首次告知、状态面板、蓝勾、原因和动作；
- 单一 ImageToolHost、inert、Escape、焦点返回、忙碌态、三视口和四 zoom；
- capability C 时隐藏/禁用；A 时显示风险预检；B 才显示 Seedance 验证。

完成门：本地浏览器矩阵与 a11y 通过，外部请求仍 0。

### R6：真实 Provider 合同发现

- 只在用户另行授权的精确预算内做最少控制面请求；
- 先只读能力/合同，再做最多一次可确定副作用的创建；
- 保存受限诊断与 RequestId，不保存 Message/Body/凭据；
- 不能确认旁路票据则回退 A 或 C，绝不硬上 B。

完成门：`REAL_PROVIDER_CONTRACT_PASS` 或诚实 `BLOCKED_EXTERNAL_CAPABILITY`。

### R7：Generation 前置门

- 接入任务创建前与真正 Provider 边界双重复核；
- 冻结 Check 快照和 B 分支票据；
- 证明 stale/expired/revoked/跨 owner/伪造全部在付费前拒绝；
- 普通非人物参考图不回归。

完成门：fake Provider 下 Generation task/attempt/费用边界可证明。

### R8：迁移与兼容

- 旧 `imageSeedanceValidation` 只显示本地历史；
- 旧 `seedance_asset_bindings` 只属于真人可信素材；
- 不自动生成新 `APPROVED`；
- 新 runtime 对旧 schema、旧 runtime 对新 schema 的拒绝/桥接边界明确。

完成门：旧画布加载、复制、保存、导出、替换和回滚矩阵通过。

### R9：独立审查与风险收口

- P0/P1 独立只读审查：信任提升、跨 owner、结果未知重复请求、隐私、日志、票据加密、Generation 防重；
- 所有发现先用反例锁定再修复；
- 候选冻结后才做最终审查。

完成门：无剩余 P0/P1；P2 有明确接受或延期。

2026-08-25执行结果：独立只读审查原始发现`1 P0 + 5 P1`，已全部关闭。正式B票据与当前Generation模型/Provider配置/凭据/策略完整绑定并在两道付费前边界重查；旧真人可信入口恢复且C入口在菜单层禁用；Attempt新增递增编号、显式outcome、未知结果不自动重提和仅限明确未接收的有界retry；媒体删除保留合规审计。修复后受影响定向全绿，无剩余P0/P1。

### R10：候选自动门

- 直接受影响定向；
- schema/备份/恢复/发布兼容专项；
- 唯一一次 safe full 仅在真正 release candidate；
- 原始失败不改写，只对失败或受影响最小范围复验。

完成门：证据绑定同一源码快照、Node22.23.1/npm10.9.8、动态 loopback、临时数据、4173不变、非loopback/Provider/OSS为授权账本值。

2026-08-25执行结果：冻结功能commit `9f4ed1589bb4d8d65619186035a076f572409255`上执行本Goal唯一safe full，`121/121 specs、1061/1061 tests PASS`，failed/skipped/retries/blocked/reportErrors均0，source/snapshot均为`07a69e52e9b10cf5fcab53a576792ccd23cf5fcbd129f3830fc7b9a2a60c2863`，4173 listener unchanged。后续文档收口不重复full。

### R11：版本、GitHub、生产与用户验收

- 用户分别确认版本号和发布；
- commit、push、PR、CI、merge、tag、Release、SSH、备份、迁移、切换分别按授权执行；
- 生产先走 capability C/A/B 准确显示，再做零付费浏览器矩阵；
- 真实审核和真实 Generation 必须是两个独立预算；
- 自动技术通过进入 `USER_RECHECK`，只有用户在真实页面明确确认才写 `USER_PASS`。

2026-08-25执行结果：PR #96、main Quality、merge、注释tag/GitHub Release `v0.6.41`完成；冻结双副本、schema40→41恢复副本演练、fresh build、生产迁移和原子切换通过。公网/回环/service/schema41/数据/inventory/5资源门及三视口零付费浏览器通过；真实审核、Generation、OSS和费用均0。当前严格停在`USER_RECHECK`，未写`USER_PASS`。

## 14. 验收编号

| ID | P | 验收合同 | 当前状态 |
|---|---|---|---|
| SEEDANCE-CHAR-001 | P0 | AI 角色单图与真人可信 Asset 语义、表和 UI 完全隔离 | TARGETED_AUTO_PASS / PRODUCTION_BROWSER_PASS |
| SEEDANCE-CHAR-002 | P0 | A/B/C 能力分支由正式合同证明，未知默认 C | BRANCH_C / CONTRACT_FAIL_CLOSED |
| SEEDANCE-CHAR-003 | P0 | 首次告知、明确同意、owner/ready/checksum 准入在外部请求前完成 | TARGETED_AUTO_PASS / C_ZERO_EXTERNAL_REQUEST |
| SEEDANCE-CHAR-004 | P0 | 16 态状态机、逐图独立、替换/策略/模型变化失效 | TARGETED_AUTO_PASS |
| SEEDANCE-CHAR-005 | P0 | Check/Attempt/Disclosure 独立持久化、幂等和结果未知防重 | TARGETED_AUTO_PASS / SCHEMA41 |
| SEEDANCE-CHAR-006 | P0 | 真人、公众人物、版权IP、未成年人、低置信保守拒绝；非人物可 NOT_REQUIRED | BRANCH_C / ENTRY_DISABLED |
| SEEDANCE-CHAR-007 | P0 | 蓝勾只来自服务端当前有效 APPROVED；客户端和旧字段不能伪造 | TARGETED_AUTO_PASS / BLUE_CHECK_ZERO |
| SEEDANCE-CHAR-008 | P0 | Generation 创建前与 Provider 边界双重复核，失效在付费前拒绝 | TARGETED_AUTO_PASS / GENERATION_ZERO |
| SEEDANCE-CHAR-009 | P0 | B 分支旁路票据正式可验证；否则只能 A 风险预检或 C 关闭 | BLOCKED_EXTERNAL_CAPABILITY / BRANCH_C |
| SEEDANCE-CHAR-010 | P0 | 隐私、最短保留、无生物特征/原始Body/秘密日志、callback防重放 | C_ZERO_EXTERNAL_DATA / TARGETED_AUTO_PASS |
| SEEDANCE-CHAR-011 | P1 | ImageToolHost、三视口、四zoom、键盘/焦点/刷新恢复和明确文案 | PRODUCTION_ZERO_PAID_BROWSER_PASS / USER_RECHECK |
| SEEDANCE-CHAR-012 | P0 | 自动、真实审核、真实Generation、生产技术与USER_PASS严格分层 | PRODUCTION_PUBLISHED_AUTO_PASS / USER_RECHECK |

## 15. 测试策略

### 15.1 直接专项

- 新建专项 spec，覆盖 Port/Application/Store/API/UI/Generation preflight；
- m2：Image 节点入口、面板、蓝勾、替换失效、视口与 a11y；
- m20：OpenAPI 与 owner-scoped API；
- m5/m16/m17/m30：任务快照、模型策略、输入角色和 Provider 前复核；
- m9：凭据、错误和票据不泄露；
- m10/m81/m87/m91/m92/m95：schema、备份、恢复、媒体完整性和发布兼容；
- m38：CURRENT_STATE/TASKS/矩阵/Checkpoint 治理一致性。

### 15.2 负例优先

至少直接覆盖：跨 owner、客户端伪造 approved/ticket、图片 bytes 变化、策略升级、Provider profile 改变、过期、撤销、callback 重放、乱序、重复点击、丢 POST、服务重启、429、5xx、结果未知、删除图片、删除账号和 C 分支零请求。

### 15.3 真实验证分层

- fake Provider 自动门不能写 `REAL_PROVIDER_PASS`；
- 真实审核通过不能写 `SEEDANCE_GENERATION_PASS`；
- 真实 Seedance 技术结果不能写 `USER_PASS`；
- 生产浏览器零付费检查不能证明审核模型质量；
- 用户确认只覆盖其实际查看和操作的页面/素材，不外推到所有人物或版权类别。

## 16. 方案冻结时预算与授权

以下是方案最初冻结时的只写文档预算；2026-08-25新Goal随后给出的v0.6.41精确实施与发布授权已经消费，实际用量以Checkpoint和生产回执为准：

| 动作 | 当前额度 |
|---|---:|
| Provider 控制面请求 | 0 |
| 合规审核请求 | 0 |
| 付费 Generation | 0 |
| OSS 测试写入 | 0 |
| 云权限/订阅/购买 | 0 |
| 生产读取/写入/SSH | 0 |
| commit/push/PR/merge/tag/Release | 0 |

历史 v0.6.39/v0.6.40 授权和 50 次控制面账本均已消费或封存，不得复用。实施开始前，用户至少需要重新给出：目标版本、是否允许改代码/迁移、是否允许 commit/GitHub、Provider 身份与每类精确预算、是否允许真实审核、是否允许真实 Generation、是否允许生产与发布。

## 17. 方案冻结时的已知阻断

1. 哪个正式 Provider 能合法提供 AI/原创角色、真人、公众人物、版权 IP 的结构化判断？
2. 该 Provider 是否允许用结果直接旁路 Seedance，票据如何传入？
3. TapNow 的蓝勾是否只在其自有后端和商业账号内有效？当前未知，不能推断。
4. 审核图片的地域、保留、训练使用、删除和未成年人政策是什么？
5. `APPROVED` 有效期和策略升级策略如何定义？
6. A 分支是否要求付费 Seedance 提交前硬阻止，还是只警告？必须由用户产品裁决。
7. 用户有真人/版权授权时，走 INC-SEEDANCE-001、人工企业复核还是不支持？不能用本功能代替。

任一 B 分支关键问题无法证明，就保持 A 或 C；这不是工程失败，而是防止产品作出虚假承诺的必要门。

## 18. 本计划的完成定义

本文落地只代表：产品语义、边界、架构、状态机、数据/API、阶段、验收、测试、预算和阻断已形成可施工合同。

它不代表：代码已实现、Provider 已选定、审核已成功、Seedance 已能旁路、生产已变更、版本已确认、GitHub 已提交或用户已经验收。

历史方案冻结时的下一步是等待实施授权；用户已于2026-08-25新开本Goal并精确授权v0.6.41实施与发布，因此该等待门已消费。实际执行按B→A→C选择C，当前工程、验证和后续发布状态只以对应Checkpoint为准；本段不再作为活动停止门。

## 19. 2026-08-25 实施选择附录

- B：官方Seedance提交合同没有第三方审核ticket字段；私域虚拟人像权益额外订阅超预算，不能证明。
- A：公开审核Provider合同不足以同时证明本方案要求的风险分类、用途与隐私边界，不能诚实启用。
- C：已实施「角色风险预检」准确关闭态与完整可插拔工程边界；不显示蓝勾，不外发图片，不产生真实审核、Generation、OSS或费用。
- 实施证据、请求账本、定向测试和R9～R11断点见`spec/INC_SEEDANCE_002_AI_CHARACTER_SINGLE_IMAGE_COMPLIANCE_CHECKPOINT.md`。
