# Unboundry 节点入参/引用逻辑完整优化计划

状态：`P0/P1 LOCAL CANDIDATE IMPLEMENTED / INPUT-005 PASS`
更新时间：2026-08-13

依据：

- `UNBOUNDRY_UPSTREAM_INPUT_SURVEY_2026-08-02.md`的两轮Unboundry实页勘测。
- 当前本地的Canvas、四类节点、模型参数schema、生成任务和Provider适配代码。
- 目标是复刻已确认的Unboundry入参行为，同时给未来新增模型留下可配置扩展点；不复用Lumino/Lumino Web。

2026-08-13 产品裁决：原始实页勘测中 Video 仍要求本节点 Prompt，这一历史事实保留在 survey；用户在旧项目复测后确认该规则造成重复输入，当前产品改为“已就绪上游 Text 或 Video 本节点 Prompt 任一可提供最终 Prompt，两者都有则按顺序合并，两者都没有才阻止”。Provider只接收解析后的非空最终 Prompt，不依赖它来自哪个界面字段。

2026-08-13 验收收口：共享前后端解析器修正及零任务/零付费定向检查通过后，用户在端口58352的隔离实页确认空 Video 本节点 Prompt 能正确使用已就绪上游 Text，原阻止提示消失；`INPUT-005` 恢复为 `PASS`。用户确认与随后当前脏功能树单轮 full `931/931 PASS` 分开记录；二者均不是新的付费生成、固定正式候选或生产发布证据。

## 一、目标行为基线

| 目标节点 | 允许的直接上游 | 上游作用 | 目标自身Prompt |
|---|---|---|---|
| Text | Text、Image、Video、Audio | Text是文字母版/上下文；Image、Video、Audio是多模态理解素材 | 默认必填；允许模型配置为上游Text可代替 |
| Image | Text、Image | Text是生成指令；Image是参考图 | 上游Text可代替；否则必填 |
| Video | Text、Image、Video、Audio | Text指令 + 多模态参考素材 | 上游Text可代替；与本节点Prompt并存时合并；两者都无则必填 |
| Audio | Text | Text可直接提供生成指令 | 上游Text可代替；歌词仍为独立字段 |

禁止直连：Video→Image、Audio→Image、Image/Video/Audio→Audio。非法拖线不创建edge，应打开与来源类型相匹配的“引用该节点生成”菜单。

这里有一项明确的产品增强：Unboundry当前实页勘测中Text目标只接受Image、Video，但本项目按用户决定扩展为Text、Image、Video、Audio四类都可作为Text目标的上游。实测文档继续保留Unboundry原始事实，实施计划以本产品决定为准。

## 二、当前本地差距

| 层级 | 当前状态 | 必须修复 |
|---|---|---|
| 画布连线 | 已接入11允许/5禁止矩阵、自连/重复/反向保护和来源感知菜单；完整人工矩阵仍未逐条收口 | 只补人工缺口和模型数量/组合边界，不重写连线底座 |
| Text节点 | 已共用解析器、四类引用卡、任务输入快照和真实Text任务入口；四类上游及模型兼容尚未逐项人工通过 | 验收Text、Image、Video、Audio单独及组合输入，不重复实现组件 |
| Image节点 | 已解析上游Text与Image，支持空Prompt替代、“母版+本节点补充”预览和assetId快照 | 复核删除/撤销/刷新/重启后的最终Prompt与引用唯一性，再决定`INPUT-003`状态 |
| Video节点 | 已解析四类上游、角色、数量和版本化任务快照；单节点真实生成不等于全能参考已通过 | 验收首尾帧/主体/普通参考、9图/3视频/3音频及模型能力阻塞 |
| Audio节点 | 已解析Text上游并形成合并Prompt/歌词候选；Mureka真实生成仍暂停 | 使用零Provider方式验收文字合并和持久化，不重试Mureka |
| 服务端任务 | 已按持久画布重新解析edge并校验版本化输入快照；浏览器结果不作为信任边界 | 补齐各Provider协议的真实能力验收和重启去重，不另起任务系统 |
| 模型管理 | 已能配置四类上游、数量、角色策略、Prompt策略、组合和模型切换规则 | 验收新增模型与不兼容引用保留，不再复制节点专用配置 |
| 可解释性 | 引用卡和生成区已显示素材状态、模型不兼容、数量/角色/Prompt等阻塞原因 | 继续补真实界面边界，禁止退回无说明灰按钮 |

## 三、核心数据设计

### 1. Edge保持唯一事实来源

不在目标节点里另存一份可漂移的“引用节点ID数组”。运行时从edge解析；创建生成任务时保存不可变输入快照。

```ts
type InputKind = "text" | "image" | "video" | "audio";

type ResolvedInput = {
  edgeId: string;
  sourceNodeId: string;
  kind: InputKind;
  role: string;
  order: number;
  state: "ready" | "empty" | "uploading" | "invalid" | "missing";
  text?: string;
  assetId?: string;
  url?: string;
  mimeType?: string;
};
```

`role`不写死在节点组件里，由当前目标类型、模型和模式共同决定，例如`instruction`、`reference-image`、`first-frame`、`last-frame`、`reference-video`、`reference-audio`、`lyrics`。

### 2. 模型输入规则升级

在现有`ModelParameterSchema.version: 2`基础上增加下一版schema；旧模型自动迁移为等价默认规则，不破坏已经配置好的模型。

```ts
type ModelInputRule = {
  kind: InputKind;
  supported: boolean;
  minCount: number;
  maxCount: number | "context";
  roles: Array<{
    key: string;
    label: string;
    minCount?: number;
    maxCount?: number;
    providerField?: string;
  }>;
  requiredWhen?: ModelParameterCondition[];
  enabledWhen?: ModelParameterCondition[];
};
```

同时增加：

- `allowedSets`：合法组合，如Text+Image、Image+Video、全能参考。
- `roleAssignment`：按连接顺序自动分配，或允许用户手动改为首帧/尾帧/主体。
- `promptPolicy`：`own-required`、`upstream-text-or-own`、`merge`。
- `overflowPolicy`：默认阻止新增edge，不静默截断。
- `unsupportedOnModelSwitch`：默认保留edge并显示阻塞原因，由用户确认后再移除。
- `providerMapping`：只允许服务端维护；管理页只保存平台中立规则，不直接暴露Provider私有字段。

### 3. 统一解析与预检

新增纯函数模块，例如`client/src/canvas/resolveNodeInputs.ts`：

1. 从nodes+edges按edge顺序收集来源。
2. 读取Text正文或媒体`assetId/src/uploading`状态。
3. 应用目标类型基线矩阵。
4. 应用当前模型、输入模式和角色规则。
5. 输出`resolvedInputs`、`effectivePrompt`、`problems`和`canSubmit`。

服务端使用同构校验逻辑重新验证，不能信任浏览器传来的`canSubmit`。

阻塞原因至少区分：不支持的来源类型、素材未上传、素材丢失、超出数量、缺少Prompt、角色冲突、参数冲突、Provider未连接、超过单次上限、余额不足。

## 四、前端交互方案

### 1. 连接阶段

- `CanvasSurface.isValidConnection`改为调用统一规则，而不是只判断自连和重复。
- 合法连接立即创建edge；非法连接不落edge，打开来源感知的创建菜单。
- 达到当前模型上限时，目标端口和拖线反馈直接显示原因。

### 2. 目标输入框

- 四类节点共用`UpstreamInputStrip`，卡片样式、删除、排序、ready状态一致。
- 图片/视频显示缩略图；音频显示小波形/时长；Text显示正文摘要。
- 删除卡片就是删除edge；`Cmd+Z`同时恢复卡片、edge、角色和顺序。
- Video和Image支持角色标签；切换角色时立即重新预检。
- Generate旁显示唯一、简单的阻塞文案，不只显示灰色按钮。

### 3. Prompt合并预览

- Image：`effectivePrompt = ownPrompt || upstreamText`；若两者都有，默认按“上游母版 + 本节点补充”合并，并允许用户查看最终文本。
- Text：自身Prompt必填，媒体只进入多模态消息，不拼到纯文本字符串里。
- Video：`effectivePrompt = upstreamText + ownPrompt`（只拼接非空部分）；上游Text可独立提供生成指令，本节点Prompt可作为补充，媒体按角色进入Provider字段。
- Audio：上游Text与自身Prompt按`merge`规则合并；歌词只进入歌词字段，不能混入普通Prompt。

## 五、服务端与Provider方案

统一任务请求增加版本化输入快照：

```json
{
  "inputSchemaVersion": 1,
  "prompt": "最终合并后的提示词",
  "inputs": [
    {"kind":"image","role":"reference-image","assetId":"...","sourceNodeId":"..."}
  ]
}
```

- 创建任务前读取每个asset，验证owner、类型、storageStatus和实际MIME。
- 快照只保存`assetId/sourceNodeId/role/order`，不保存会过期的签名URL。
- Provider adapter把平台中立输入映射为OpenRouter、火山方舟、Mureka等各自payload。
- 不支持某角色时在任务入队前零费用拒绝，不允许“入队后才发现”。
- 每次创建仍使用idempotencyKey；重试复用原任务和原输入快照，禁止重复历史和重复收费。
- Text任务需要新增独立`kind: text`和结果持久化；在此之前Text的Generate必须明确显示“服务未接入”，不能假装可执行。

## 六、按风险拆分的实施顺序

### P0：纯规则和数据层（零Provider调用，候选已完成）

1. 新增类型矩阵、`ResolvedInput`、角色和preflight结果类型。
2. 升级模型schema并提供V2→新版本迁移。
3. 编写纯函数单元测试，覆盖11条允许组合和5条禁止组合。
4. 接入Canvas连线校验，但先用fixture画布验收。

完成标准：非法组合不能落edge；合法组合、删卡、撤销、刷新都稳定。

### P1：Image目标闭环（候选已完成，仍待完整人工收口）

1. 接入Text+Image统一解析。
2. 实现上游Text替代空Prompt和“母版+补充”合并预览。
3. 图片references继续使用真实assetId；服务端同步校验。

完成标准：用户给出的“文字母版 + 服装照片 → 电商白底图”在提交前能显示正确的最终Prompt和参考图片；真实生成另行授权。

### P2：Text目标闭环

1. Text、Image、Video、Audio四类引用卡统一化。
2. 上游Text作为文字母版或上下文；图片、视频进入视觉理解消息；音频进入音频理解或转写消息。
3. 默认要求目标节点填写“要对这些上游内容做什么”；模型可以配置为上游Text能够代替目标Prompt。
4. 新增Text任务/Provider适配；若某个Provider模型不支持视频或音频，管理页规则必须限制，并在切换模型时显示不兼容原因。

完成标准：四类上游都能正确显示和传入；当前模型所需素材与Prompt满足时可进入任务，缺少内容或模型不兼容时显示明确原因。

### P3：Video目标闭环

1. 四类上游解析和全能参考卡片。
2. 首帧、尾帧、主体、普通参考的角色分配。
3. 精确实现9图/3视频/3音频及模式组合。
4. 火山方舟adapter完成后再移除服务端非text拒绝。

完成标准：输入组合、参数、费用预估、余额和Provider能力在入队前全部一致；未授权时测试必须保持Provider请求数0。

### P4：Audio目标闭环

1. Text上游、目标Prompt和歌词的合并规则。
2. Mureka adapter映射与单条0.5美元安全上限沿用。

完成标准：UI能展示最终Prompt/歌词来源；失败和重试不重复创建任务。

### P5：模型切换和未来模型

1. 管理页可设置类型、数量、角色、组合、必填条件和默认参数。
2. 新模型保存前做schema校验和Provider能力上限校验。
3. 模型切换遇到旧引用不兼容时保留edge并阻塞，向用户说明具体冲突。

完成标准：新增模型不需要修改四个节点组件，只需配置schema和实现/选择Provider adapter。

### P6：持久化和回归

覆盖：刷新、服务重启、删除来源、复制目标、撤销/重做、超限、素材上传中、素材失效、切换模型、失败/取消/超时/重试、余额不足、历史去重。

## 七、建议新增的自动检查

- `tests/m27-input-connection-matrix.spec.ts`：16种来源/目标组合，按本产品11条允许、5条禁止验收。
- `tests/m27-input-resolver.spec.ts`：ready、empty、invalid、角色、顺序、Prompt合并。
- `tests/m27-input-cards-undo.spec.ts`：删卡/删线/撤销/刷新一致。
- `tests/m27-image-text-reference.spec.ts`：Text+Image电商白底图提交快照。
- `tests/m27-text-multimodal.spec.ts`：Text、Image、Video、Audio分别输入及四类组合输入。
- `tests/m27-video-multimodal.spec.ts`：Text+9图+3视频+3音频、超限和角色冲突。
- `tests/m27-audio-text-input.spec.ts`：上游Text、目标Prompt、歌词合并。
- `tests/m27-provider-input-preflight.spec.ts`：所有不支持组合在Provider调用前拒绝，付费请求计数为0。
- `tests/m27-input-persistence.spec.ts`：刷新/重启后节点、edge、角色、输入快照不重复。

## 八、人工验收批次

每个批次都先自动验证，再打开真实本地画布给用户检查；不因自动通过直接标PASS。

1. 连线矩阵和非法拖线菜单。
2. Image的Text+Image母版场景。
3. Text的文字母版、图片、视频、音频四类理解场景。
4. Video全能参考、角色和上限。
5. Audio的Text/Prompt/歌词合并。
6. 模型切换和新增模型配置。
7. 删除、撤销、刷新、服务重启和历史去重。
8. 经用户逐次授权后，分别做最小真实Provider调用。

验收文件继续遵循用户要求：累计10次成功人工验收后再集中同步一次；2026-08-04用户明确要求提前同步后当前下一批为6/10。第6项是`RELAY-009/011/012`联合复验，一次用户确认只计1项。本计划本身不改变任何`INPUT`现有PASS/PARTIAL/BLOCK状态。

## 九、当前最合理的下一步

P0和P1不得重新实现。中转站`RELAY-001～012`已经全部PASS，不再重复验收现有结果或安全删除流程；当前返回现有P0/P1候选，只补“删除/撤销→刷新→服务重启→任务/历史/媒体不重复”的零费用可靠性证据。画布搜索缩放和多选/打组回归已人工通过，不再重做。P0/P1收口后依次验收Text四类上游、Video全能参考、Audio文字合并、模型切换和完整持久化。`INPUT-001～007`在用户逐项确认前继续保持PARTIAL。
