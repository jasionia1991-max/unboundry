# INC-IMGEDIT-006 图片全屏完整适配与 Seedance 可信素材最终修订方案

> 状态：`GOAL_ACTIVE / R1_EXPECTED_RED_COMPLETE / R2_IN_PROGRESS`
>
> 日期：2026-08-24
>
> 适用仓库：`/Users/mymy/Documents/unboundry/app`
>
> 当前生产：`v0.6.37 / schema39 / USER_RECHECK`
>
> 候选版本：`v0.6.38 / VERSION_GATE_VALID`
>
> schema 变化：`UNDECIDED`；只有 A/B 能力分支确认需要持久化时才评估 `schema39 -> schema40`
>
> 发布授权：`RELEASE_GATE_VALID`；用户于本 Goal 明确给出“允许发布：v0.6.38 上线”，v0.6.37 既有授权保持已消费
>
> 真实付费生成预算：`0 attempts / 0 successes / 0 cost`
>
> Provider 控制面请求预算：总计最多 `200`；分项为权益/能力只读10、H5创建1、H5状态60、Asset创建1、Asset状态120、最终只读5；不得购买、不得产生生成费用

> Goal 启动补充：本文件落地后的最新用户 Goal 已明确启动执行，并以更具体的新版本门、发布门和 Provider 控制面预算替代本方案中的施工前占位边界；其余安全、分阶段和验收合同保持不变。实时消耗与阶段只以对应 Checkpoint 为准。

## 1. 立项原因

用户在 v0.6.37 生产实页复验中确认其他图片工具基本可接受，但指出两个未闭环问题：

1. 部分竖图在图片全屏详情中只显示上半部分，原图下半部分被 modal 边界裁掉；
2. 当前“Seedance 素材校验”只执行本地格式与模型规则检查，产品语义与 TapNow/方舟真正的可信素材或真人授权流程不一致。

INC-IMGEDIT-005 的既有工程、发布和生产技术证据继续作为历史保留，但不能覆盖本次用户复验发现。不得改写 INC-IMGEDIT-005 的历史结论；本次新立 INC-IMGEDIT-006。

## 2. 当前事实边界

- 当前生产为 `v0.6.37/schema39`，技术健康但仍是 `USER_RECHECK`，没有 `USER_PASS`；
- v0.6.37 的版本号、tag 和发布授权已经执行并消费；本事件不得复用；
- 新版本号未指定，不得自行选择或写入 package；
- 当前真实 Provider 请求、尝试、成功和费用预算均为 0；
- 自动化和本地浏览器验收禁止真实 Provider、真实 OSS、真实生产数据和付费视频生成；
- `spec/public-templates-director-split-revision.json` 永久禁止读取、修改、暂存、提交、删除或改名；
- 当前代码中本地 Seedance 结果仍是 `scope=local-technical-preflight` 且 `remoteValidationAvailable=false`；它只能证明本地技术预检；
- 当前 Ark 视频媒体输入只接受受控 Data URL 或 HTTPS URL，`asset://` 尚未进入安全类型合同；
- ComfyUI 的 `/proxy/seedance/...` 是 ComfyUI 自有代理接口，只能作为业务流程证据，不能冒充方舟公开上游 API；
- 方舟官方资料表明，控制台真人认证和 Assets API 集成属于不同权益。没有当前账号的正式权益证据前，不得承诺站内 H5/Asset API 闭环。

## 3. 本事件的两条独立工作线

### 3.1 F 线：图片全屏完整显示

必须解决：

- 竖图只显示上半部分；
- 图片被弹窗、Grid 或 overflow 裁掉；
- 长提示词或详情面板撑坏图片区；
- 透明棋盘格超出图片实际矩形；
- 不同比例在不同视口表现不一致。

### 3.2 S 线：Seedance 可信素材语义和真实能力

必须解决：

- 删除“本地格式预检等于 Seedance 素材校验”的错误产品语义；
- 区分本地预检、普通参考素材、方舟可信素材、真人授权与主体引用；
- 只有方舟远端证据才能显示可信素材可用；
- 当前账号没有 Assets API 权益时，不制作假的 TapNow 式验证流程；
- `asset://` 必须由服务端可信记录生成，客户端不能伪造；
- 普通商品、场景、非真人参考素材不能被真人授权流程强制阻断。

图片打光 `IMGEDIT-007` 继续 `PAUSED`，不纳入本事件。

## 4. R0：Seedance 能力分流门

Seedance 远端功能施工前，必须确认当前方舟账号属于哪一种能力。R0 只读核对不等于授权发起真实 Provider 请求；如账号权益无法从现有本地配置与用户提供证据确认，必须先记录未知，不得自行探测或购买。

### 4.1 分支 A：已开通 Assets API

必须同时具备：

- 当前账号完成官方要求的实名认证；
- 当前账号确实具有 Assets API 集成权益；
- 获得方舟正式接口文档、SDK 或销售提供的合同；
- 明确认证方式、地域、项目、QPM、超时和错误码；
- 明确创建验证会话、获取 Group、创建 Asset 及查询状态的正式接口；
- 不依赖或复制 ComfyUI `/proxy/seedance/...` 私有代理。

只有 A 分支可以实现完整站内闭环：

```text
H5 授权
-> Group ID
-> 创建 Asset
-> 轮询远端可用状态
-> 服务端生成 asset:// 引用
-> Seedance 视频节点使用
```

### 4.2 分支 B：只有方舟控制台认证能力

如果账号只能在方舟控制台管理真人人像，则本次只能实现：

```text
方舟控制台完成认证
-> 用户取得已有 Asset ID
-> Unboundry 关联已有可信素材
-> 服务端在当前能力允许时只读核验
-> 视频节点使用
```

对应入口必须叫“关联方舟可信素材”，不能叫“角色合规验证”，因为验证本身不在 Unboundry 内完成。

如果没有可靠的只读 Asset 查询接口，只能显示“已关联，尚未核验”，不得显示“方舟可信素材可用”。

### 4.3 分支 C：没有可信素材能力

- 移除当前错误的“Seedance 素材校验”入口；
- 本地技术预检移到视频节点选择参考素材的内部流程并自动执行；
- 普通图片、商品和场景继续走现有安全参考链；
- 真人参考由方舟在正式提交时最终判断；
- 状态记录为 `BLOCKED_EXTERNAL_CAPABILITY`；
- 不显示禁用按钮或 fake 合规面板冒充实现。

### 4.4 R0 退出证据

```text
ACTIVE_BRANCH=A/B/C
OFFICIAL_API_CONTRACT=CONFIRMED/UNAVAILABLE
ACCOUNT_ENTITLEMENT=CONFIRMED/UNAVAILABLE
CONTROL_REQUEST_AUTHORIZATION=VALID/MISSING
PURCHASE_REQUIRED=YES/NO
```

如需要购买服务，只报告事实、价格边界和恢复条件，禁止购买。

R0 即使阻断 S 线，F 线仍继续，不得让外部权益问题拖住全屏修复。

## 5. F 线：全屏完整显示合同

### 5.1 产品结果

原图必须百分之百完整显示在 viewer 可用区域内：

```text
image.top >= viewer.contentTop
image.left >= viewer.contentLeft
image.right <= viewer.contentRight
image.bottom <= viewer.contentBottom
renderedRatio == naturalRatio
visibleArea == renderedArea
```

### 5.2 实现原则

- 继续使用产品内 modal，不调用浏览器 Fullscreen API；
- 图片使用双轴 `contain`，禁止 `cover`；
- Grid 内容行必须具有可解析的确定尺寸；
- viewer 必须具备 `min-width:0`、`min-height:0` 和受控 overflow；
- 右侧详情面板独立滚动，不得撑高或挤压左侧图片；
- 图片不能因为提示词或详情内容增长而改变布局上限；
- 不强行放大小于可用区域的原图；
- 不用滚动条掩盖图片被裁问题。

可优先验证以下最小修复：

```css
.image-detail-dialog {
  grid-template-rows: minmax(0, 1fr);
}

.image-detail-viewer {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

这只是候选实现，不是完成证据。如果仍不能稳定双轴适配，可以增加小型 `ImageFitFrame`；不得建立新的大型控制器。

### 5.3 透明图片

- 棋盘格只覆盖透明图片实际绘制矩形；
- viewer 使用项目统一纯灰黑背景；
- 普通图片不显示棋盘格；
- 棋盘格不得进入下载、导出或媒体字节。

## 6. S 线的三个独立概念

### 6.1 本地技术预检

检查 owner、storage ready、MIME、文件大小、分辨率、比例、当前模型支持的素材角色和数量。

合同：

- 自动运行；
- 模型和角色相关；
- 允许短期过期；
- 只能显示“本地预检通过/失败”；
- 不进入图片节点“更多”菜单；
- 不代表方舟可信素材或真人授权。

### 6.2 方舟可信素材

可信状态至少绑定：

- 当前 Provider 账号；
- Asset Group；
- Asset ID；
- 方舟详情可用状态；
- 本地源素材 kind、asset ID 和 checksum；
- 是否被撤销、拒绝、删除、失效或权益过期。

只有远端证据符合官方可用条件时，才能显示“方舟可信素材可用”。不得使用笼统绿色“合规通过”。

### 6.3 主体 / @ 引用

主体用于组织多份图片、视频、音频和文字参考；可信素材用于方舟账号下的授权与可用性。两者不得混为一项。本轮不扩大为完整主体库重构。

## 7. Provider Adapter 合同

禁止前端或 `ImageNode` 直接访问方舟。新增小型服务端端口：

```ts
interface SeedanceTrustedAssetPort {
  capability(): Promise<TrustedAssetCapability>;
  createAuthorizationSession(...): Promise<AuthorizationSession>;
  inspectAuthorizationSession(...): Promise<AuthorizationSession>;
  createAsset(...): Promise<ProviderAsset>;
  inspectAsset(...): Promise<ProviderAsset>;
}
```

要求：

- 只允许 `volcengine-ark` 注册实现；
- 必须基于方舟正式接口合同；
- 不复制 ComfyUI 私有代理路径；
- Provider 凭据永不返回客户端；
- 所有接口具有超时、限流、脱敏日志和结构化错误；
- Provider 账号、地域和项目身份必须明确；
- API Key 或 AK/SK 轮换不能错误地让同一 Provider 账号下的已验证人物失效；
- Provider 账号或租户变化时禁止复用旧 Asset；
- `ImageToolHost` 继续只负责 UI 宿主、互斥、焦点和 viewport，不负责 Provider 编排。

## 8. 持久化设计

完整 A/B 分支建议评估迁移为 `schema40`；只有正式启动、确认表结构必要且完成备份/恢复方案后才能冻结。

### 8.1 人物授权组

```text
seedance_identity_groups
```

核心字段：

- `id`
- `owner_id`
- `provider_profile_id`
- `provider_account_fingerprint`
- `provider_group_id`
- `authorization_status`
- `provider_status`
- `accepted_at`
- `revoked_at`
- `expires_at`
- `created_at`
- `updated_at`

### 8.2 素材绑定

```text
seedance_asset_bindings
```

核心字段：

- `id`
- `group_id`
- `owner_id`
- `source_kind`
- `source_asset_id`
- `source_checksum_sha256`
- `provider_profile_id`
- `provider_asset_id`
- `provider_asset_type`
- `status`
- `provider_status`
- `checked_at`
- `failure_code`
- `failure_message`
- `created_at`
- `updated_at`

### 8.3 授权会话

可使用短生命周期 `seedance_authorization_sessions`，但不得长期保存：

- H5 完整链接；
- 摄像头内容；
- 活体视频；
- 人脸特征；
- Provider 密钥。

Unboundry 只保存会话状态和不透明标识，活体数据由方舟页面处理。

### 8.4 数据完整性

- 本地媒体身份必须包含 `kind + asset_id`，不得只用 asset ID；
- owner、Provider profile、source checksum 必须共同参与可用性判断；
- Group 和 Asset 分表，避免把人物授权与具体素材错误合并；
- H5 session、Group 和 Asset 分别有幂等键；
- 不自动删除方舟远端 Asset、Asset Group 或用户历史媒体。

## 9. 详细状态机

服务端状态：

```text
NOT_STARTED
SESSION_PENDING
WAITING_AUTHORIZATION
AUTHORIZATION_COMPLETED
PENDING_ACCEPTANCE
ASSET_PROCESSING
ACTIVE
REJECTED
CONSISTENCY_FAILED
REVOKED
DELETED
ENTITLEMENT_EXPIRED
STALE_SOURCE
FAILED
```

UI 归并：

| 服务端状态 | 用户看到 |
|---|---|
| NOT_STARTED | 尚未关联可信素材 |
| SESSION_PENDING / WAITING_AUTHORIZATION | 等待完成真人授权 |
| AUTHORIZATION_COMPLETED / PENDING_ACCEPTANCE / ASSET_PROCESSING | 方舟正在处理 |
| ACTIVE | 方舟可信素材可用 |
| REJECTED / CONSISTENCY_FAILED | 素材未通过方舟校验 |
| REVOKED / DELETED | 素材已撤销或不可用 |
| ENTITLEMENT_EXPIRED | 当前账号权益不可用 |
| STALE_SOURCE | 图片已变化，需要重新处理 |
| FAILED | 处理失败，可查看原因 |

详情说明固定包含：该状态来自当前方舟账号，最终使用仍受素材授权范围和平台规则约束。

## 10. API 设计

### 10.1 能力查询

```text
GET /api/seedance/trusted-assets/capability
```

只返回 A/B/C 能力分支、是否可创建会话、是否可查询 Asset 和当前 Provider 显示名；不返回凭据、完整账号标识或内部权限材料。

### 10.2 A 分支

```text
POST /api/media/image/:assetId/seedance/authorization-sessions
GET  /api/seedance/authorization-sessions/:sessionId
GET  /api/media/image/:assetId/seedance/trusted-binding
```

### 10.3 B 分支

```text
POST /api/media/image/:assetId/seedance/trusted-bindings
GET  /api/media/image/:assetId/seedance/trusted-binding
```

用户可以提供从方舟控制台获得的 Asset ID，但服务端必须严格校验格式、绑定 owner 和 Provider 账号并在能力允许时只读核验。未核验只能保存为 `LINKED_UNVERIFIED`，不得直接生成 `ACTIVE`。

### 10.4 异步和幂等

- 创建接口快速返回 `202`，不得维持几十分钟长请求；
- 前端只轮询 Unboundry 状态接口；
- 服务端使用有界轮询、指数退避、QPM 门和最长截止时间；
- modal 关闭不取消已经提交的远端流程；
- 服务重启后能从持久状态恢复；
- 重复点击使用幂等键，不得创建两个 session、Group 或 Asset；
- 超时显示中性状态，不自动重建 Group 或发起付费生成。

所有新增 API 必须同步 OpenAPI、请求大小、owner 权限、CSRF/同站合同和 source coverage manifest。

## 11. 视频生成安全接入

当前普通媒体引用需要升级为判别联合，禁止把所有引用继续作为任意字符串：

```ts
type ArkVideoReference =
  | { kind: "inline-data"; value: string }
  | { kind: "public-url"; value: string }
  | {
      kind: "trusted-asset";
      bindingId: string;
      providerAssetId: string;
    };
```

只有服务端满足以下条件时才能构造 `trusted-asset`：

```text
owner 匹配
source kind/id 匹配
checksum 匹配
Provider 账号匹配
绑定状态 ACTIVE
方舟详情状态可用
未撤销
未过期
```

最终 Provider 请求才转换为 `asset://<provider_asset_id>`。客户端直接提交的 `asset://` 全部拒绝。

任务快照需保存 binding ID、Provider profile、Provider Asset ID、source checksum、本次核验时间和素材角色。重试和重启恢复必须复用同一身份，不得静默切换到另一个 Asset。

生成前发现 Asset 失效时：

- 在 Provider 计费提交前失败；
- 提示重新关联或验证；
- 不自动新建 Group；
- 不自动重新付费。

普通 URL/Data URL 素材继续走现有安全合同，不因缺少真人 Asset ID 被一刀切阻断。

## 12. 旧画布兼容

既有画布可能保存：

```text
imageSeedanceValidation
scope: local-technical-preflight
operation: seedance-validate
```

兼容规则：

- 继续允许解析和保存；
- 永远只认作历史本地预检；
- 不升级为可信素材；
- UI 显示“旧版本地预检，不代表方舟可信素材”；
- 替换图片后原子清除旧预检结果；
- 新操作使用独立名称，例如 `seedance-trusted-asset` 或 `seedance-authorize-character`；
- 旧画布刷新、复制、保存和导出不得损坏。

## 13. UI 设计

### 13.1 A 分支

“更多”菜单显示“角色可信素材”。面板展示当前图片、当前方舟 Provider、是否已有已验证人物、首次授权、复用已有 Group、当前处理状态、失败原因和“验证由方舟提供”的说明。

### 13.2 B 分支

显示“关联方舟可信素材”，明确提示用户先在方舟控制台完成真人认证。

### 13.3 C 分支

不显示角色合规入口。本地预检在视频节点选择参考素材时自动完成。

### 13.4 H5 交互

- 使用产品内 modal 展示流程状态；
- H5 验证在安全新标签打开，并使用 `noopener/noreferrer`；
- modal 关闭不取消远端流程，重新打开恢复状态；
- Escape、Tab、Shift+Tab、focus-visible、焦点返回和 reduced-motion 必须通过；
- 不记录 H5 完整链接；
- 普通用户不展示 Group ID、Asset ID 等内部字段；
- 不显示预计费用；
- 背景 Canvas、Creator 和图片工具栏在 modal 中保持 inert。

## 14. 分阶段执行

同时最多一个阶段为 `IN_PROGRESS`。每阶段完成后先更新 Checkpoint、验收矩阵和 TASKS；候选、版本、GitHub或生产事实变化时再更新 CURRENT_STATE。

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| R0 | Git、文档、账号权益和正式 API 合同核对 | 冻结 A/B/C 分支 |
| R1 | 全屏旧问题红测试 | 精确复现 1086×1448 裁切 |
| R2 | 全屏双轴修复 | 六类素材、三视口全部完整 |
| R3 | 删除伪校验语义、旧画布兼容 | 老画布不坏且不冒充远端 |
| R4 | 冻结 Group/Asset/Session、schema 和 API 合同 | 架构、隐私和OpenAPI可审查 |
| R5A | A分支完整 Provider adapter | fake 合同全通过 |
| R5B | B分支已有 Asset 关联 | 未核验不冒充 Active |
| R5C | C分支准确移除入口 | 普通 Seedance 引用无回归 |
| R6 | `asset://` 安全接入与任务恢复 | 伪造、跨账号、失效全部拦截 |
| R7 | UI、浏览器、隐私、幂等和错误矩阵 | 三视口、刷新和失败恢复通过 |
| R8 | 候选冻结、独立审查、一次 safe full | 无 P0/P1 遗留 |
| R9 | GitHub 和生产发布 | 需要新版本门及发布门 |
| R10 | 真实方舟协议验收 | 需要控制面请求授权和用户参与 |
| R11 | 用户生产验收 | 用户明确确认后才能 USER_PASS |

## 15. 自动测试最低集合

### 15.1 全屏

- 用户截图对应的 `1086×1448`；
- 9:16、16:9、1:1、超宽图和透明 PNG；
- 1280×720、1440×900、1728×900；
- 长提示词和详情面板独立滚动；
- 图片四边完整位于 viewer 内；
- 比例不变、无滚动裁切；
- 棋盘格不进入下载或导出字节。

### 15.2 Seedance

- A/B/C 能力分支；
- 本地预检与远端状态绝不串联变绿；
- 授权等待、完成、拒绝、超时；
- Group 复用；
- Asset 处理、Active、失败、撤销、删除；
- 权益过期；
- 图片替换或 checksum 变化；
- Provider 账号变化；
- 双击幂等；
- 页面刷新和服务重启恢复；
- 跨账号拒绝；
- 任意客户端伪造 `asset://` 拒绝；
- 普通 URL/Data URL 无回归；
- 生成提交前失效检查；
- 验证过程不创建视频 Generation task；
- 自动化真实 Provider、Generation、OSS 和费用均为 0。

## 16. 本地浏览器验收

候选必须提供可操作地址和素材清单，不能只给截图。

用户检查：

1. 打开 3:4 和 9:16 图片全屏；
2. 确认人物全身和图片四边全部可见；
3. 确认透明棋盘格只在图片实际矩形；
4. 确认详情长提示词不会挤坏图片；
5. 确认 A/B/C 对应入口符合真实账号能力；
6. 检查等待、失败、过期、撤销和刷新恢复；
7. 确认视频节点普通参考素材继续可用；
8. 已远端核验素材才显示“方舟可信素材可用”；
9. 未核验 Asset 绝不显示可用。

## 17. Provider请求与费用账本

必须分开记录：

```text
paidGenerationAttempts
paidGenerationSuccesses
paidGenerationCost

providerControlRequests
authorizationSessions
assetCreateRequests
assetInspectRequests

ossWrites
```

自动测试全部为 0。

R10 真实协议验收开始前必须另行获得：

```text
允许进行方舟可信素材控制面验证
允许的请求种类和次数
确认不购买任何权益
确认不生成付费视频
```

没有该授权只能完成 fake adapter、本地自动化和浏览器验收，不能写 `PROVIDER_PROTOCOL_REAL_PASS`。

## 18. schema 与数据安全门

如 A/B 分支最终需要新增表并迁移 `schema39 -> schema40`，生产发布前必须完成：

- 只读生产一致性检查；
- 完整备份和校验；
- 新临时目录恢复；
- migration 演练；
- rollback 或旧版本兼容演练；
- 切换前后表、任务、媒体和Canvas计数；
- SQLite integrity 和 FK 检查；
- 不删除历史媒体、Asset、Group、备份或旧 release。

无法证明备份与回滚时，S线数据库部分必须 `BLOCKED`。

## 19. 版本与发布门

当前不自行选择版本号。R8 完成后必须重新获得两条明确内容：

```text
版本号确认：vX.Y.Z
允许发布：vX.Y.Z 上线
```

缺任意一项时，可以完成本地工程、自动化、本地浏览器、候选冻结和本地checkpoint commits，但不得 push、PR、merge、tag、SSH或生产发布。

自动化、独立审查、Agent浏览器、Provider协议技术验证和生产技术通过都不能自动写 `USER_PASS`。

## 20. 硬阻断

只有以下情况允许停止相关分支：

- 当前方舟账号没有可信素材或 Assets API 权益；
- 正式接口合同与当前凭据类型不兼容；
- 需要购买高级能力但没有单独购买授权；
- 必须发起真实 Provider 请求但没有控制面请求授权；
- 无法证明 Group/Asset 的账号、owner、地域或项目隔离；
- 必须迁移生产 schema 且无法证明备份、恢复和回滚；
- 安全接入 `asset://` 会破坏既有 Generation/Media 合同且没有兼容路径；
- GitHub或生产基础设施出现无法自行修复的外部故障；
- R9 缺少新版本号或对应发布句子。

S线外部阻断不能阻止F线全屏修复继续完成。

## 21. 完成状态

理想终态：

```text
FULLSCREEN_FIT_AUTO_PASS
FULLSCREEN_VIEWPORT_PASS
SEEDANCE_CAPABILITY_BRANCH_CONFIRMED
LEGACY_PREFLIGHT_SEMANTICS_CORRECTED
TRUSTED_ASSET_PROTOCOL_AUTO_PASS
LOCAL_BROWSER_PASS
SAFE_FULL_EXECUTED
INDEPENDENT_REVIEW_PASS
PROVIDER_PROTOCOL_REAL_PASS
PRODUCTION_PUBLISHED_AUTO_PASS
USER_RECHECK
```

只有用户在生产实页明确确认后才能写：

```text
USER_PASS
```

如果最终是 C 分支，则必须诚实记录：

```text
FULLSCREEN_COMPLETE
FALSE_SEEDANCE_VALIDATION_REMOVED
SEEDANCE_TRUSTED_ASSET_BLOCKED_EXTERNAL_CAPABILITY
```

不得把外部能力缺失写成 Seedance 可信素材功能完成。

## 22. 恢复顺序与启动方式

本文件落地不等于启动 Goal 或开发。用户后续明确要求开始时，先建立独立 Checkpoint；任何新 Session、上下文压缩、换 Agent 或自动续跑后都必须停止编辑，重新完整阅读项目 `AGENTS.md` 规定的权威文件，再按以下顺序阅读：

1. 本方案；
2. 对应 `INC_IMGEDIT_006` Checkpoint；
3. `spec/INC_IMGEDIT_005_IMAGE_TOOL_PRODUCT_REMEDIATION_PLAN_2026-08-24.md`；
4. `spec/INC_IMGEDIT_005_IMAGE_TOOL_PRODUCT_REMEDIATION_CHECKPOINT.md`；
5. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 图片工具当前区块；
6. `spec/UNBOUNDRY_UI_DESIGN_SYSTEM.md`；
7. `spec/UNBOUNDRY_REFERENCE_EVIDENCE_CATALOG.md` 图片高级编辑部分；
8. 当前 Git、工作树、package、schema、生产状态和 Provider预算。

启动后的第一步只能是只读恢复与R0能力分流，不得从聊天记忆、旧Goal或历史授权直接施工。
