# 新 Session 一次性 Goal 提示词：云腾 Provider 隔离与三媒体模型上线

状态：`READY_TO_COPY / NOT_STARTED`（2026-08-21）

使用前提：云腾自己的 API key 必须能通过安全入口提供，不得写进本文、聊天、Git 或命令回显。

将下面全文复制到新的 Codex Session：

```text
/goal

请创建一个全新的 Goal，并严格连续完成 Unboundry 的“云腾 Provider 隔离、三媒体模型正式接入、v0.6.29 发布与生产验收”。不得复用任何旧 Goal、旧授权或旧基线。

按 v0.6.29。允许发布。

这是一次性完整授权：允许在本 Goal 内完成必要的只读检查、代码实现、定向测试、一次独立 review、一次正式安全 full、文档同步、语义独立本地 commit、版本升级、push、tag、PR、merge、SSH、冻结备份、fresh build、生产原子切换、云腾 Provider/账号凭据安全配置、目录同步、模型导入/发布/绑定、最多三次有界真实 Provider 创建请求、完整生产技术验收、回执提交和必要回滚。允许在修复或优化途中调用 subagent；所有 subagent 按仓库 AGENTS.md 的固定模型策略执行，并避免重复测试。

普通实现问题、定向测试失败、review 发现和可恢复发布问题请自行诊断并继续，不要逐步向我确认。只有身份冲突、无法安全取得云腾自己的密钥、数据完整性失败、未知且可能重复计费的 Provider 提交、无法恢复的生产风险或必须扩大到本 Goal 明确禁止范围时，才允许 BLOCKED。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、真实目标与业务边界
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

优创和云腾是两个完全独立的商业平台：老板不同、充值余额不同、API key/额度/账单不同，互相不能使用。它们只是都接入“天空兼容”的中转 API。

在 Unboundry 中必须表达为：

- 优创 = 一个独立 provider profile；
- 云腾 = 另一个独立 provider profile；
- 天空 = 技术兼容层/上游来源，不是计费 profile，除非我直接向天空购买额度；
- 同一个 provider_model_id 可以在优创和云腾各自存在，但必须拥有不同内部 model ID，并保留各自 provider_profile_id；
- 密钥、账号凭据、余额、任务、attempt、providerTaskId、目录导入、发布和回滚全部按 provider profile 隔离；
- 绝不把云腾三模型写进优创，绝不借用优创密钥，绝不把优创当成云腾 fallback。

目标模型全部属于云腾：

1. Nano Banana Pro：`gemini-3-pro-image-preview`，image；
2. Kling V3 Omni：`kling-v3-omni-cankao`，video；
3. Suno V4.5：`suno-v4.5`，audio。

三者继续使用现有 `multi-protocol-relay + media-generate` 合同。不要新增云腾专用 driver，不要建立平行媒体 Provider registry，不要创建名为“天空”的计费 Provider。

最终用户模型下拉必须明确显示平台，例如：

Nano Banana Pro
云腾 · 图片

如果优创也发布同名模型，两条必须可辨认，但内部选择和任务提交仍只使用 model internal ID，不能按名称猜测。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、项目身份与第一动作
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

真实仓库：

/Users/mymy/Documents/unboundry/app

预期分支：

codex/unboundry-offline-remediation-2026-08-09

文档落笔基线：

- HEAD `79151690e4d49045ca3c517bb2e86c17e2d64296`；
- origin/main `a4bfda3cf85cef509cb79d565daec5441896810b`；
- package `0.6.28`；
- 生产 `v0.6.28 / schema39`；
- 生产 current `/opt/unboundry/releases/v0.6.28-relay-media-models-20260821`；
- v0.6.28 代码和三媒体执行合同已上线，但生产尚无云腾 profile，三模型也未作为云腾模型发布；
- 当前正确业务状态是 `PRODUCTION_CONFIGURATION_BLOCKED / USER_RECHECK`；
- 工作树可能只额外包含本方案/Goal文档同步和唯一受保护未跟踪文件。

第一动作必须只读执行：

pwd
git status --porcelain=v1 -b
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git log -8 --oneline --decorate
node --version
npm --version
node -p "require('./package.json').version"

若基线因本次文档尚未 commit 而有预期 Markdown 差异，先完整审阅并纳入 Goal；不要把它当成冲突。除此之外不得覆盖用户改动，不得 reset、clean、stash、强制 checkout 或删除不明文件。

受保护文件 `spec/public-templates-director-split-revision.json` 禁止读取、修改、格式化、移动、删除、暂存和提交，也不得进入测试 fixture、snapshot、build、archive 或 artifact。所有显式 `git add` 都必须列出精确文件并在提交前检查 index。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、必读顺序
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

完整阅读并遵守仓库 `AGENTS.md`，再按以下顺序完整阅读：

1. `spec/UNBOUNDRY_CURRENT_STATE.md`
2. `TASKS.md`
3. `spec/UNBOUNDRY_YUNTENG_PROVIDER_ISOLATION_PLAN_2026-08-21.md`
4. `spec/UNBOUNDRY_YUNTENG_PROVIDER_ISOLATION_CHECKPOINT.md`
5. `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_INTEGRATION_PLAN_2026-08-21.md`
6. `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_ACCEPTANCE_MATRIX_2026-08-21.md`
7. `spec/UNBOUNDRY_RELAY_MEDIA_MODELS_CHECKPOINT.md`
8. `RELEASE_RUNBOOK.md`
9. `spec/V0_6_28_PRODUCTION_RECEIPT_2026-08-21.json`

第三份是本 Goal 的权威实施合同。旧三媒体文档用于保留已上线的参数、异步恢复和结果提交边界，不得重新归属为优创，也不得重新实现一套执行器。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
四、连续施工阶段
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stage 0：冻结真实现场。

- 只读核对本地/远端Git身份、运行时、现有测试证据和生产v0.6.28现场；
- 只读核对生产 provider_profiles、加密Provider配置摘要、account credentials身份、model_profiles、node bindings、generation tasks/attempts；
- 不回显密钥；
- 明确证明生产没有云腾 profile，优创目录快照里出现三个ID只是目录事实，不是模型归属；
- 记录发布前schema/integrity/FK/task/attempt/model/binding/template/media/service/asset基线。

Stage 1：修正公共目录和节点辨识。

- `/api/models` 为每条模型返回安全的 `providerName`；必要时返回非敏感 `providerProfileId`，但客户端身份仍用 model internal ID；
- 更新 `PublishedModel` 类型与向后兼容；
- `NodeModelControl` 选项显示模型主名 + Provider/capability次级标签；
- aria-label、title、选中态和不可用原因能区分同名模型；
- 处理窄节点和长平台名；
- 不把Provider名永久拼进displayName，不泄露base URL、密钥或敏感配置。

Stage 2：强化跨 Provider 隔离证据与管理端防误操作。

- 固定目录查重四元组包含 provider_profile_id；
- 固定 `(account_id, provider_profile_id)` 凭据隔离，云腾缺凭据时绝不回退优创；
- 固定 task/attempt/recovery/providerTaskId 的 provider profile 身份；
- 管理端导入、发布、绑定和确认文案明确当前商业 Provider；
- 把商业平台名、driver和protocol分开显示；
- 不迁移、不重命名、不删除、不覆盖优创现有配置或历史；
- 默认保持schema39，除非直接证据证明无法实现P0隔离。若确需migration，必须先记录原因、兼容、备份、回滚和定向测试，再最小实施。

Stage 3：定向验证与一次独立 review。

- 使用新临时目录、动态loopback、fake fetch；禁止默认4173、app/data、/var/lib/unboundry、真实媒体、真实密钥和真实OSS；
- 先TypeScript/构建所需静态门和直接spec；优先检查m12/m43/m46/m47/m50/m57/m73及实际受影响的m40/m44，按职责做最小集合；
- 证明同ID跨Provider共存、同Provider内去重、凭据不fallback、task/attempt身份不漂移、普通UI同名可辨认、管理动作不跨profile、三媒体合同不回归；
- 失败只重跑失败spec或最小相邻集合；成功后没有新相关代码变化不得重复；
- 定向转绿后只做一次独立subagent review，覆盖Provider身份、凭据、任务归属、UI歧义、密钥泄露、发布与回滚。主agent解决发现并做最小复验；不要为了形式反复review。

Stage 4：冻结候选、文档和正式full。

- 完成计划验收矩阵全部P0；
- 同步CURRENT_STATE、TASKS、实施方案/Checkpoint和版本文档；
- 至少创建两个语义独立本地commit：实现/定向测试一批，文档/发布准备一批；不要为凑数量机械拆分。生产回执若在部署后产生，单独做第三个精确文档commit；
- 提交前确认受保护JSON不在index；
- 候选源码冻结后执行一次正式安全full，记录命令、Node/npm、源码SHA、快照SHA、端口/数据隔离、通过数和退出码；
- full失败时只重跑失败项或最小集合。除非修复传播到新的共享高风险边界，否则禁止第二次完整full；
- 正式full必须在隔离环境对候选运行，禁止直接对生产数据库执行。

Stage 5：v0.6.29 GitHub与生产发布。

- 将版本升级为v0.6.29；
- 精确push、annotated tag、PR、merge，并核对tag tree、测试tree、main tree、release artifact一致；
- 按RELEASE_RUNBOOK创建冻结备份、双清单、staging fresh build和不可变release；
- 原子切换current；
- 核对公网/loopback版本、service active/enabled/NRestarts、应用和nginx错误、静态资源逐字节一致；
- 核对schema39/integrity/FK和发布前后关键数据不变；
- 任何门失败优先按Runbook回滚，不删除失败release和证据。

Stage 6：只在云腾下完成生产配置。

- 创建独立“云腾”provider profile，driver=`multi-protocol-relay`，使用云腾实际base URL和云腾自己的密钥；
- 通过既有加密入口保存，任何输出只允许脱敏摘要；
- 若账号级生成需要凭据，为目标账号单独保存 `(account_id, 云腾profile)`；不得复制/读取/借用优创凭据；
- 先只读同步云腾目录；
- 只导入三条精确模型为云腾draft，核对capability、media-generate、参数schema；
- 发布并启用节点binding，初次不得擅自替换现有默认模型；
- 从普通账号验证API和页面显示“云腾”，任务预检解析到云腾内部model/profile；
- 优创profile、凭据、模型、绑定和历史任务发布前后必须保持不变。

如果云腾key无法安全取得：先完成所有不依赖key的实现、测试、review、full和可发布工件；到生产配置凭据门时fail-closed并报告精确缺口。绝不能用优创key代替，绝不能伪造已接入，也不要把这种状态写成Goal完成。

Stage 7：零付费门与最多三次真实smoke。

先完成版本、service、数据库、配置隔离、目录、UI可见性、任务身份和日志脱敏等全部零付费门。然后本Goal明确授权最多3次真实创建POST：

1. Nano 1K文字图1次；
2. Kling 5秒standard文字视频1次；
3. Suno instrumental 1次。

每个模型最多一次创建POST，总上限3。已有providerTaskId只查询原任务。任一未知响应、失败、超时、提交响应丢失或无法证明退款时禁止自动重试，禁止切到优创或另一个账号。结果必须核对task/attempt/providerTaskId/profile/model/result_type/asset ownership，保存或下载重试不得重新创建Provider任务。

Stage 8：上线后的完整生产技术验收与收口。

上线后必须完整执行方案第7.2节生产验收矩阵，而不是在生产数据上跑本地safe full：

- Git/tag/tree/release/artifact/版本；
- service、restart、日志、nginx、公网静态资源；
- schema/integrity/FK/关键计数/active/template/media数据不变；
- 优创完整不变；
- 云腾profile/凭据身份/三模型/绑定独立正确；
- 普通目录、图片/视频/音频节点显示与ARIA可辨认；
- 三次smoke的付费次数、任务、attempt、Provider task、结果和保存归属；
- 受保护JSON、密钥、4173、非目标数据和备份边界；
- 回滚路径仍可用。

更新生产回执、CURRENT_STATE、TASKS和方案状态。技术验收完成后只能写 `PRODUCTION_PUBLISHED_AGENT_REAL_PAGE_PASS / USER_RECHECK`；不得把自动测试、review、生产技术验收或agent页面验证写成 `USER_PASS`。等待我线上实测并明确回复通过后，才可另行同步USER_PASS。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
五、提交、范围与安全红线
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

允许修改与目标直接相关的 server/modelCatalog、providerCatalog/providerProfiles/accountCredentials、公共模型类型、NodeModelControl、必要样式、管理端术语、直接测试、版本/发布文档和回执。范围外文件只有被编译或直接高风险合同证明必需时才最小修改并说明。

明确禁止：

- 新建云腾专用driver或平行媒体执行系统；
- 创建“天空”计费profile；
- 复用、导出、覆盖或删除优创密钥/余额/配置/模型/历史；
- 把云腾模型写进优创；
- 不必要的schema、Canvas/Workflow、Template、Auth、Storage backend重构；
- 删除生产数据、媒体、历史任务、审计记录、失败release或冻结备份；
- reset/clean/强制覆盖用户工作树；
- 读取、修改、暂存或提交受保护JSON；
- 超过3次真实创建POST或对未知付费结果自动重试；
- 把任何技术PASS冒充USER PASS。

本Goal授权在目标范围内进行push/PR/merge/tag/发布/SSH/生产配置/有界真实smoke/必要回滚，但授权在Goal完成或BLOCKED后立即失效，不自动延伸到后续版本、其他Provider、其他模型、生产治理或再次付费验证。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
六、最终报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

完成后一次性报告：

- 最终版本、commit、tag、PR/merge、tree和release路径；
- 优创/云腾/天空在产品中的最终表达；
- 实际代码和UI变化；
- 每条定向测试和唯一正式full的环境、命令、退出码、通过数；
- 独立review范围、发现和处理；
- 为什么没有重复/过度测试；
- 生产备份、切换、数据不变和公网证据；
- 云腾profile、三模型和节点绑定证据，以及优创不变证据；
- 真实Provider POST总数、每个任务/attempt/providerTaskId/result/asset证据；
- 是否发生回滚及结果；
- 受保护JSON、密钥、4173、真实数据/OSS触碰边界；
- 当前技术状态和仍需我在线上主观验收的项目。

所有阶段完成后停止，不进入v0.6.30、额外Provider/模型、再次push/发布/付费验证或其他生产工作。
```
