# MODEL-CONTRACT-001 用户复验失败修复方案

更新时间：2026-08-27
状态：`PLAN_FROZEN / RELEASE_CANDIDATE_READY / PR_116_OPEN / REVIEW_P0_0_P1_0_GO / FORMAL_FULL_EXECUTED_ONCE_1077_OF_1079 / TARGETED_STALE_ASSERTIONS_PASS / RELEASE_GATE_CLOSED / USER_RECHECK`

> 2026-08-27执行断点：版本A、版本B和27项候选执行均完成。独立只读Review首轮`P0=0/P1=2/NO-GO`后，模板完整合同影响与手工Provider task ID认领漏洞已由`979d448256fb5f58970eafae41f6ea17c0282c1b`关闭；同一线程最终`P0=0/P1=0/GO`。本Goal唯一正式safe full已在`e56df4e`执行一次，1077/1079通过；唯二陈旧断言由`2821f0579d4f455109349232e053502670686c03`同步并经m81 `41/41`、m100 `13/13 PASS`收口，没有第二次full。PR #116已打开，初始候选CI通过；最终精确head以PR最新Quality gate为准。当前唯一下一动作是最终生产发布授权门；schema41、真实Provider/OSS/生产写和新费用均为0，既有`⚡2.182`无法核验人民币换算，真实付费生成继续阻断。完整证据见实时checkpoint。

## 1. 目标与结论

生产 v0.6.50/schema41 的工程与发布技术证据保留，但 2026-08-27 真实网站验收不能升级为 `USER_PASS`：27 项用户清单中已有 15 项通过，另有 12 项失败或证据不足；真实 Provider 验收还暴露了“可能已扣费但系统允许再次提交”的 P0 风险。

本修复不推翻三层合同与不可变 `ModelReleaseRevision`，而是在现有架构上依次完成：

1. **版本 A：付费安全与结果恢复**，先关闭重复扣费、结果误判和不可信模式准入；
2. **版本 B：合同工作台、文档、UI 与 Provider 兼容**，再关闭用户可理解性、CAS、本地校验、预览和结果解析问题；
3. 冻结候选后执行一次覆盖本次完整范围的独立只读 Review；
4. 完成风险驱动定向验证与本 Goal 唯一一次正式 safe full；
5. 在生产发布前停在授权门，不自行发布。

## 2. 当前事实基线

### 2.1 生产与 Git

- 当前生产：`v0.6.50 / schema41 / PRODUCTION_V0_6_50_TECHNICAL_PASS / USER_RECHECK`。
- 当前隔离工作树：`/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`。
- 当前分支：`codex/model-contract-user-recheck-fixes`。
- 当前 `HEAD = origin/main = cc9df2a57aca8abc68596ee398e19de6bd0b4ef3`，tree `f91bfb23d30da1b0f8b0543f11c6d2ed3e397dc3`。
- package：`0.6.50`；默认 Node `25.9.0` / npm `11.12.1`；生产兼容测试通道继续使用项目规定的 Node22/npm10。
- 受保护文件 `spec/public-templates-director-split-revision.json` 永远不得读取、修改、暂存、提交、移动或删除。

### 2.2 已存在但尚未审定的相关改动

当前工作树已有 4 个未提交文件、336 insertions / 28 deletions：

- `client/src/App.tsx`
- `client/src/styles.css`
- `server/modelReleaseDefaults.ts`
- `tests/m102-model-execution-contracts.spec.ts`

这些改动初步覆盖 CAS 错误识别、版本文案、只读预览、文档建议、模式/角色说明和部分控件样式，但尚未完成正式审计、测试或归属确认，也没有覆盖付费重试根因。实施时必须先冻结 diff、逐块审查并保留有效内容；禁止 reset、checkout 覆盖或把它们直接当作已完成证据。

### 2.3 真实验收发现

- 合同工作台出现原生蓝色勾选控件；只读值仍使用输入框，出现无意义光标。
- “草稿版本 1 / 当前发布版本 1”语义不清；没有草稿时仍像有两份可用版本。
- 未修改内容或执行本地校验时出现“草稿发生并发冲突，没有覆盖另一位管理员”。
- “脱敏只读预览”入口不明显或未找到。
- 部分模型缺少精确官方文档，或只有占位符/平台首页。
- 普通管理员无法理解模式 ID、角色 ID，也不知道应填写什么。
- 编辑部分模型后“本地验证”不可点击且没有明确原因。
- GK/grok-video-3 两次提交均发生费用但应用没有任务号或结果；核对结果后仍允许再次提交。
- GPT Image 已发生费用但成功结果未被解析为应用结果。
- Mureka 出现限流；不能把 429 变成自动付费重试。
- 发布/回滚只影响新任务的第 12、27 项仍缺少完整真实边界证据。
- 本轮可追溯平台账本为优创 `⚡1.621`、云腾 Suno `⚡0.561`，合计 `⚡2.182`；平台没有给出可核验的人民币换算，因此不能冒充人民币费用。

## 3. 根因判断

### 3.1 P0：把“搜索不到结果”错误等同于“没有提交”

现有恢复路径在没有 `providerTaskId` 时尝试平台匹配；匹配为空后会把尝试标为缺失，并开放一次新付费尝试。这个推断不成立：Provider 可以已经受理或计费，但任务尚未出现在查询面板、查询接口不完整、响应在回程中丢失，或结果结构未被应用识别。

本地幂等键只能约束 Unboundry 自身，不能替代 Provider 端幂等。只要请求可能越过付费边界，就必须默认“不确定”，而不是默认“未提交”。

### 3.2 合同证据粒度错误

当前证据主要落在模型级；但同一模型的“文生视频”和“首帧生视频”可能使用不同字段、限制和可信证据。GK 历史冻结合同与本次实时 Provider 页面/运行结果发生矛盾，不能继续用一个 `EXACT` 覆盖全部模式，也不能仅凭营销页面永久删除能力。

### 3.3 工作台混淆了三类状态

当前页面把编辑缓冲区、服务器草稿和当前发布版本混在一起。本地校验本应是零写、零 Provider 的纯校验，却错误地受保存草稿、CAS 或按钮状态影响。草稿 CAS 应只保护保存/发布写操作，不能污染本地校验。

### 3.4 Provider 适配与任务状态耦合

Provider adapter、结果解析、任务恢复、重试策略和 UI 提示之间职责不清，导致“解析失败”“查询为空”“Provider 拒绝”“费用未知”被压成相似失败状态。修复必须拆开这些边界，不能继续追加 Provider 特例到 Canvas UI。

## 4. 版本 A：付费安全与结果恢复

### A1. 远端尝试确定性

逻辑上明确区分：

- `NOT_DISPATCHED`：有权威证据证明请求没有越过 Provider 边界；
- `ACCEPTED_TASK_KNOWN`：Provider 已接受且任务号已知；
- `ACCEPTED_TASK_UNKNOWN`：Provider 可能接受但任务号未知；
- `RESULT_RECEIVED`：Provider 已返回可验证结果；
- `DEFINITIVE_FAILED`：Provider 明确拒绝且可证明未计费；
- `OUTCOME_UNKNOWN`：是否接受、是否计费无法证明；
- `REFUNDED`：有权威退款证据。

热修优先复用现有持久化状态和稳定错误码表达 `OUTCOME_UNKNOWN_BILLING_RISK`，避免为了命名新增不必要 schema。只有代码和数据库约束证明无法安全复用时才设计 schema42，并补齐真实恢复副本、旧 runtime 拒绝和回滚门。

### A2. 统一重试判定

- 平台搜索为空、没有 task ID、查询暂时不可见、回程响应丢失都不能证明“未提交”。
- 可能越过付费边界时，禁止自动重提，也禁止 UI 直接开放新付费请求。
- “核对结果”只能查询和恢复原提交，不得暗中创建新请求。
- 只有 `NOT_DISPATCHED`、明确未受理且未计费、或已确认退款时才允许人工重新生成。
- 401/403、429、超时、5xx、格式异常不触发端点 fallback 或付费重试。
- 重复刷新、重复点击、重启恢复和双标签只能作用于同一个任务/attempt，不增加 Provider POST。

### A3. 任务账本与用户状态

在不暴露秘密的前提下记录：本地 task/attempt、model revision、请求摘要指纹、Provider/profile、credential revision、脱敏关联号、越界时间、task ID、查询结果、确定性、是否允许重试和原因。

`OUTCOME_UNKNOWN` 的普通用户提示必须明确：Provider 可能已经受理或扣费，系统已为避免重复扣费禁止重试；可执行的动作只有“继续核对原任务”和“查看脱敏证据”。

### A4. GK 模式级降级

- 把证据从模型级拆到模式级。
- GK 文生视频暂时降为 `UNKNOWN/BLOCKED`，直到取得精确官方 API 证据或一次符合费用门的受控成功证据。
- GK 首帧模式只允许 Prompt + 恰好一张 `first-frame` 图片，进入 `params.images` 单元素 URL 数组。
- 尾帧、多图、参考视频、主体图和未知角色继续零 POST 阻断。
- 合同变更只影响新任务，运行中任务继续使用冻结 revision。

### A5. GPT Image 与限流

- GPT Image 只接受经过白名单验证的成功结构，例如明确的 `b64_json`、结果 URL 或冻结 output 结构。
- 结果必须经过 MIME、大小、HTTPS/SSRF、任务归属和 publication 安全链。
- Provider 已响应但结构未知时进入“响应已收到、结果格式未知”，禁止再次付费提交。
- Mureka 429 尊重 `Retry-After` 用于只读状态提示；不得自动创建新付费 attempt。

### A6. 版本 A 完成门

- 所有缺 task ID、查询为空、响应丢失和格式未知 fixture 均证明新 Provider POST 为 0。
- GPT Image 已知成功结构可正确进入安全结果提交链。
- 429/5xx/超时不触发付费重试。
- GK 非法模式和非法素材在客户端与服务端均为零 POST。
- 数据库兼容与旧任务恢复通过。
- 完成版本 A 独立 commit/checkpoint；在此之前不得开始版本 B。

2026-08-27执行结果：全部完成门已由fake Provider、临时数据库和Node22 safe定向证明；schema保持41，真实Provider/OSS/生产写与新费用均为0。m5 `22/22`、m38 `15/15`、m22 `41/41`为当前源码回执；对应实现未再变化的m102 `7/7`、m26 `10/10`、m53 `26/26`回执继续有效。独立commit为`584e4071c87ae06b980e091df47ce0aaa3e03b4f`/tree`c85bd81a8775ef786bf3146583ae57c2ee00ec53`，版本A正式关闭。

## 5. 版本 B：合同工作台、文档与 UI

### B1. 明确三类版本状态

页面顶部改为：

- `当前页面：无未保存修改 / 有未保存修改`
- `已保存草稿：无 / vN`
- `当前发布版本：vN`

发布版本是新任务采用的不可变版本；草稿只是尚未发布的候选；页面缓冲区不等于服务器草稿。没有草稿时必须显示“无”。

### B2. 本地校验与 CAS 解耦

- “本地校验当前页面”直接验证当前编辑内容，零保存、零发布、零 Provider、零 CAS。
- “保存草稿”才携带草稿 revision/CAS。
- 只有服务端稳定错误码 `MODEL_CONTRACT_DRAFT_CONFLICT` 才显示并发冲突，禁止按中文字符串或任意 409 猜测。
- “发布”只接受已保存、未过期且验证通过的草稿。
- 按钮禁用必须显示准确原因；没有草稿时仍应允许校验当前发布版或当前页面。

### B3. 脱敏只读预览

工作台提供始终可发现的预览入口，并明确预览来源：当前页面、已保存草稿或当前发布版本。预览仅展示方法、受限相对路径、假 Prompt、假 URL/file ID、模式、角色、数量、顺序、绑定和阻断原因；不得出现 API Key、Authorization、Cookie、签名 URL 或真实用户素材。

### B4. 模式与角色的人话界面

- `modeId`、`roleId` 由系统生成稳定内部 ID，普通管理员默认不填写。
- 主界面显示中文名称、用途、允许素材、数量和顺序。
- 高级设置只读显示内部 ID；若允许修改，必须先做历史引用与模板完整性校验。
- 角色用“首帧图片、尾帧图片、参考图片、参考视频”等产品词，不要求用户猜 `first-frame` 或 `specialized-code`。

### B5. 官方文档治理

每个来源记录精确 URL、来源类型、适用模型/模式、核验日期和证据等级。平台首页、营销页或占位符不能支持 `EXACT`。建议链接只进入新草稿，不静默改写已发布 revision。没有可信来源时显示“待补证”，不能填入猜测地址。

### B6. 控件和可访问性

- 原生蓝色 checkbox 替换为项目统一自绘组件，但保留键盘、焦点和读屏语义。
- 非编辑内容使用静态值/标签，不使用可聚焦输入框，也不通过全局 `caret-color: transparent` 隐藏问题。
- Select、Checkbox、输入、状态和危险操作对齐现有灰阶、圆角、尺寸、hover/focus/disabled 规范。
- 覆盖 1280×720、1440×900、1920×1080、900×900 与 ≤928px 单列；无横向溢出、遮挡、不可达操作或 sticky 覆盖。

### B7. 版本 B 完成门

- 六张用户截图问题全部在真实浏览器复验关闭。
- 工作台本地校验始终为零 Provider、零保存、零 CAS。
- 草稿冲突只在真实双管理员旧 revision 写入时出现。
- 文档证据不会静默改写发布合同。
- 27 项用户清单全部由 Computer Use 重新执行；不能证明的项目保持 `USER_RECHECK/BLOCKED`，不得冒充通过。

## 6. 解耦边界

1. `ContractCompiler`：纯函数编译 immutable revision，不知道 UI 和 Provider 网络。
2. `AdmissionDecision`：根据合同和输入作唯一模式准入；客户端只做提示，服务端是最终权威；折叠面板和滚动状态不得影响结果。
3. `ProviderAdapter`：只提交、查询和规范化返回；不决定是否可以付费重试。
4. `TaskLedger`：原子记录 attempt、确定性、task ID、revision 与恢复证据。
5. `RecoveryPolicy`：只根据证据决定查询、等待、阻断或重试，不依赖 Canvas/UI。
6. 工作台：只编辑/验证/发布合同，不直接修改运行中任务。

禁止把 GK/GPT Image/Mureka 特例继续堆进 Canvas 节点组件，也禁止为了复用制造万能 Provider DSL。

## 7. 风险与应对

| 风险 | 后果 | 应对与回退门 |
|---|---|---|
| 搜索为空仍实际收费 | 重复扣费 | 默认 unknown、零重提；只用权威未受理/退款证据解锁 |
| 严格策略阻断合法重试 | 需要人工处理 | 提供只查询原任务、关联号和退款后解锁，不用猜测换取自动化 |
| 错误禁用 GK 文生视频 | 合法能力暂时不可用 | 只降级具体模式；证据恢复后新 revision 单独开放 |
| 结果解析过宽 | 错误资源、SSRF、跨 owner | 固定结构白名单和既有 media/publication 安全链 |
| 新 outcome 破坏旧 runtime | 回滚失败 | 版本 A 优先复用旧状态；必要迁移先做真实恢复副本演练 |
| CAS 改动污染 Canvas DATA-005 | 多标签保存回归 | 合同草稿 CAS 与 Canvas 最后保存者胜严格分区 |
| 文档建议污染历史 revision | 不可变合同被暗改 | 只写新草稿，发布需显式验证和事务 |
| 隐藏光标破坏可访问性 | 真输入框不可用 | 改语义组件，不做全局视觉掩盖 |
| 发布/回滚改变运行中任务 | 任务漂移或丢结果 | task 冻结完整 revision；双 revision 恢复测试 |
| 日志泄露签名 URL/秘密 | 安全事故 | 只存脱敏关联号和摘要，不存原始响应 |
| 回滚旧代码重新开放付费重试 | P0 复发 | 生产回滚前先停止新任务并停用受影响模式 |
| 既有未提交改动被覆盖 | 用户工作丢失 | 先冻结/审查 diff；禁止 reset/clean/checkout 覆盖 |
| 费用单位无法换算人民币 | 超预算 | 无法证明人民币金额时不再调用真实生成，只记录外部 blocker |

## 8. 验证策略

### 8.1 风险驱动定向验证

- 任务/attempt/恢复：缺 task ID、响应丢失、查询空、重启、刷新、双标签、幂等。
- 合同：模式级证据、GK 输入、revision 冻结、发布/回滚新旧任务边界。
- Provider：GPT Image 结果形态、Mureka 429、Suno 有序多结果、专用 connector 不回归。
- 工作台：CAS、当前页面校验、预览、文档来源、模式/角色、禁用原因。
- 安全：SSRF、秘密、签名 URL、跨 owner、恶意结果和 unknown outcome。
- 兼容：Text/Image/Video/Audio、图片工具、旧 Canvas、旧模板和历史任务。

失败时只修复并复跑最小受影响集合；源码未变化的成功证据不重复。

### 8.2 Computer Use 验收

在本地/候选网站完整执行 27 项清单，保留截图、路径、输入、预期、实际、网络请求数和费用账本。合同后台操作必须 Provider=0。真实生成只有在 fake/既有任务无法证明且人民币费用可核验时才允许；总人民币费用包含本轮此前已发生费用，不得超过用户授权的 20 元。

### 8.3 全量 Review 与正式 safe full

版本 A、B 均冻结后，启动独立只读全量 Review，不与实现并行。Review 覆盖全部本次影响链而不只看 diff：付费边界、Provider adapter、task/attempt 状态机、合同 compiler、工作台、四节点、图片工具、模板、旧任务、数据/schema、安全、可访问性、部署与回滚。发现 P0/P1 后由主线程修复、最小复验，再由同一审查线程复核；只有 `P0=0 / P1=0 / GO` 才能进入正式 safe full。

候选冻结后最多执行一次正式 safe full。它与“全量 Review”是两个独立门；定向测试不能改称 full。

## 9. Git、文档与断点纪律

- 每完成一个阶段立即同步本方案、`MODEL_CONTRACT_001_CHECKPOINT.md`、本修复矩阵、`TASKS.md`、`UNBOUNDRY_CURRENT_STATE.md` 和总验收矩阵当前区块。
- checkpoint 每次记录：阶段、唯一下一动作、HEAD/tree、dirty diff、测试命令/Node/npm/source/snapshot、Provider 请求/费用/OSS、Review 结论与状态分层。
- 压缩或 Session 恢复后重新读取权威文档和 checkpoint，只从唯一下一动作继续；不重复成功且源码未变化的测试。
- 版本 A 和 B 使用独立、可审计 commit；不混入无关重构。
- 当前 Goal 完成到“发布候选就绪”即停在发布授权门；不得把本文档授权解释为生产发布授权。

## 10. 发布授权门与回滚预案

发布门前必须交付：建议版本号及占用证据、精确 commit/tree、PR/CI 状态、Review `P0=0/P1=0/GO`、唯一 safe full、27 项浏览器矩阵、Provider/费用账本、schema/备份/恢复/回滚方案和未关闭外部 blocker。

用户明确给出最终发布授权后才允许 merge/tag/GitHub Release、SSH 生产写入、冻结备份、恢复演练、fresh build、原子切换和生产技术验收。若生产门失败：先停止新任务并停用受影响模式，再回切上一不可变 release；已发生的外部费用不能靠应用回滚撤销。

## 11. 完成定义

- 版本 A、版本 B 全部实现并有当前源码证据。
- 27 项清单全部重新执行，失败/阻塞项诚实记录。
- P0/P1 全量 Review 为 0，结论 GO。
- 唯一正式 safe full 完成且未被重复粉饰。
- Provider 请求、费用和 OSS 写入可追溯，重复付费路径关闭。
- 候选 commit/tree、文档和 checkpoint 一致。
- 最终状态只可为 `RELEASE_CANDIDATE_READY / USER_RECHECK`；生产发布和 `USER_PASS` 均需后续明确授权/确认。
