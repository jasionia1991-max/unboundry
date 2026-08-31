# INC-GEN-018 模型合同健康边界与旧 Revision 精确修复方案

状态：`GOAL_EXECUTED / R0_TO_R8_TECHNICAL_COMPLETE / PRODUCTION_V0_6_64_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`

更新时间：2026-08-31

## 1. 结论先行

生产 v0.6.63 在用户重新开启真实生成后，整组预检把 7 个节点阻断为“管理员已关闭真实生成”。只读核对已经证明：平台总开关实际开启，真正不健康的是 Doubao Seed 与 Doubao TTS 2.0 的活动 immutable revision；当前代码为这两个模型补入了新的 `inputPolicy`，但生产活动 revision 仍是旧形状，且 INC-GEN-017 的合同升级集合遗漏了这两个模型。

故障又被第二个边界错误放大：`modelCatalog` 把“单模型合同不健康”与“平台全局开关关闭”合并成同一个布尔值，`modelAvailability` 因而返回 `GLOBAL_GENERATION_DISABLED`。这是生产回归，不是用户操作、浏览器缓存或真实开关状态错误。

本事件是 INC-GEN-017 发布后的新生产事件。INC-GEN-017 的历史候选 Review GO、发布技术通过和唯一真实 Provider 结果均保留为当时时点事实，不回写为失败；当前产品状态由本 INC-GEN-018 覆盖为开放整改。

## 2. 证据边界

### 2.1 已查实事实

1. 生产运行 v0.6.63/schema41。
2. 用户于 2026-08-30 开启真实生成后，安全状态只读核对为 `globalEnabled=1 / emergencyStop=0`。
3. 登录态页面以 `cache: no-store` 请求 `/api/models` 返回 HTTP 200；当前生产有 10 个 published 模型，其中 8 个 available。
4. Doubao Seed 与 Doubao TTS 2.0 返回 `GLOBAL_GENERATION_DISABLED / 管理员已关闭真实生成`；其余 8 个 published 模型没有该错误。
5. Doubao Seed 活动 revision 前缀为 `6ab5deb8…`，Doubao TTS 2.0 活动 revision 前缀为 `bc0bcfef…`。旧活动合同缺少当前 effective schema 所要求的 `capabilitySchema.inputPolicy`；精确全量身份必须在未来 R0 重新冻结，本文不使用截断值执行任何迁移。
6. 本次用户点击没有创建任务：只读计数保持 tasks=1026、attempts=1037、active=0；当时最新任务创建时间早于本轮点击。没有新增 Provider POST 或费用。
7. `types/modelParameters.ts` 当前为 Doubao Seed 与 Doubao TTS 2.0 提供 `inputPolicy`。
8. `server/modelCatalog.ts` 的 `parameterSchema()` 会继承当前 Provider 语义默认值；`server/activeModelContractHealth.ts` 又把活动 revision 的 capability schema 与该 effective schema 做精确比较，因此正确发现漂移。
9. `server/modelContractUpgrade.ts` 的 `semanticContractUpgradeProviderModelIds` 包含 Seedance、GPT Image、Grok 和 Mureka，但遗漏 Doubao Seed 与 Doubao TTS 2.0，所以 v0.6.62 的迁移没有为它们发布新 revision。
10. `server/modelCatalog.ts` 将 `safety.globalEnabled && contractHealthy` 作为 `globalEnabled` 传给 `evaluateModelRuntimeAvailability()`；`server/modelAvailability.ts` 把 false 解释为 `GLOBAL_GENERATION_DISABLED`，产生错误提示。
11. 该组合逻辑由 INC-GEN-017 功能提交 `46a9abf110e55dd14d9519228c708759224d8c78` 引入，并已进入 v0.6.57～v0.6.63。
12. 既有 m102 主要用当前代码创建的新 revision 验证活动合同健康，没有回放“生产旧 Seed/TTS revision 缺少 inputPolicy”的历史形状，因此既有 10/10 模型 Review 没有覆盖到这个真实旧数据分支。

### 2.2 R0前尚未执行（历史基线，现已由R0～R8技术门闭合）

- 没有修改代码、测试、数据库或生产配置。
- 没有为两个模型发布新 revision。
- 没有执行冻结生产库 dry-run/apply/repeat。
- 没有形成代码候选、运行测试或完成候选逐代码 Review。
- 没有获得版本号、GitHub、发布或生产写授权。
- 没有发起任何新的真实 Provider 请求；本事件也不需要真实付费生成来证明修复。

以上六项是方案冻结时的初始边界，不是当前实时状态；不得删除或倒写。当前生产终态只以 Checkpoint、Matrix 与 `spec/V0_6_64_PRODUCTION_RECEIPT_2026-08-31.json` 为准。

## 3. 根因与耦合分类

### 3.1 故障链

```text
当前 schema 新增 inputPolicy
  -> 生产旧 active immutable revision 不含该字段
  -> 手工 semantic upgrade 集合遗漏 Seed/TTS
  -> active contract health = unhealthy
  -> modelCatalog 折叠为 globalEnabled = false
  -> modelAvailability 返回 GLOBAL_GENERATION_DISABLED
  -> 整组预检把多个共享文字模型的节点一起阻断
```

### 3.2 这是不是“没有模块化”

不是整个工程没有模块化。`modelCatalog`、`activeModelContractHealth`、`modelAvailability` 和 `modelContractUpgrade` 已经分文件、分职责；问题在组合边界仍有三处语义耦合：

1. **错误域耦合**：单模型合同健康被压进平台全局安全开关。
2. **合同派生耦合**：catalog effective schema、bootstrap revision 与 migration target 分别派生合同，缺少单一 canonical 解析结果。
3. **迁移覆盖耦合**：语义字段变化依赖人工维护 model-ID allowlist；漏一个模型就不会进入迁移。

模块化不等于没有依赖；正确目标是让依赖显式、单向、可枚举，并由类型和迁移证明约束。此次需要修的是语义边界，不是把文件再拆得更多。

## 4. 冻结的产品与安全合同

### MC18-01 平台安全与模型健康必须独立

- `globalEnabled` 只代表管理员平台级总开关。
- `emergencyStop` 只代表平台级紧急停止。
- `contractHealth` 是单模型状态，不得修改或伪装前两者。
- Provider、credential、configuration 与 adapter 状态继续各自拥有稳定错误码。

### MC18-02 合同漂移继续 fail-closed

合同不健康时仍须在 Provider boundary 前阻断。修复错误分类不等于删除健康检查；不得用 `contractHealthy=true`、忽略异常或默认 fallback 放行。

### MC18-03 历史 revision 不可变

Doubao Seed 与 Doubao TTS 2.0 的旧 active revision 不得原地修改。若精确迁移证明通过，必须创建新 immutable revision，经 active-revision CAS 激活，并保留旧 revision、document hash、compiler hash、审计和回滚身份。

### MC18-04 零付费修复

代码验证、数据库演练、生产迁移和生产页面预检均应保持 Provider POST=0。验收只需证明合同健康、错误分类、整组预检和任务计数，不需要真实生成。

### MC18-05 不静默换模型

不得把 7 个节点自动切换到其他文字模型，不得改 Prompt、媒体、edge、模板或 Canvas 绑定来绕过模型合同。

## 5. 目标边界设计

### 5.1 Availability 使用可区分状态

`evaluateModelRuntimeAvailability` 的输入应保留独立字段，名称可在实施时按现有类型收敛，但语义必须等价：

```ts
type ModelContractHealth =
  | { state: "healthy"; activeRevisionId: string; fingerprint: string }
  | { state: "out-of-sync"; activeRevisionId: string; expectedFingerprint: string }
  | { state: "missing" }
  | { state: "invalid"; causeCode: string };

evaluateModelRuntimeAvailability({
  globalSafety: { globalEnabled, emergencyStop },
  contractHealth,
  providerHealth,
  credentialHealth,
  adapterHealth,
});
```

至少新增或等价实现以下稳定模型级错误：

- `MODEL_CONTRACT_OUT_OF_SYNC`
- `MODEL_CONTRACT_MIGRATION_REQUIRED`
- `MODEL_CONTRACT_INVALID`

只有真实 `globalEnabled=false` 才能返回 `GLOBAL_GENERATION_DISABLED`。UI 继续消费服务端可用性结果，不在前端重判合同。

### 5.2 单一 canonical published contract

建立一个纯、确定、无网络、无 secret、无数据库写的 canonical resolver；可以复用现有模块，不要求为拆文件而拆文件。它必须以同一输入生成：

- 清洗后的 capability schema；
- Provider 语义默认值继承结果；
- execution registry 身份；
- execution/capability contract fingerprint；
- 当前发布 target document；
- 与 active revision 的结构化差异。

catalog、健康检查、bootstrap、发布与迁移 planner 必须消费同一结果，不得各自重新拼一份“应该是什么”。

### 5.3 迁移 planner 枚举全部 published 模型

planner 必须遍历实施时全部 published logical models 和 exact execution identities，并为每个模型产生唯一动作：

- `none`
- `publish-revision`
- `blocked-unclassified-drift`
- `blocked-invalid-active`

人工 allowlist 只能描述“已批准的精确 legacy 形状”，不能决定哪些模型有资格被检查。任一 published 模型存在未分类差异，计划整体 fail-closed。

## 6. Doubao Seed / TTS 精确迁移设计

### 6.1 R0 必须冻结的完整身份

未来实施前必须从新的只读生产快照重新记录以下字段，且不得使用本文截断 ID：

- model ID、display name、capability；
- provider profile ID、driver、protocol、provider model ID；
- provider configuration revision/version；
- active revision ID、release revision ID、execution contract version；
- active document/compiler hash；
- raw stored capability schema、canonical effective schema 与各自 fingerprint；
- published/default/archived 状态；
- 模板、Canvas、任务和 active/unknown 引用数量；
- tasks/attempts/Provider POST/费用基线。

R0 快照不得包含 Prompt、媒体 URL、owner、credential、secret 或 graph 正文。

### 6.2 可批准差异

迁移实现不得只按 display name 或 provider model ID 匹配。只有完整 identity、from revision/hash 与冻结 legacy schema 全部精确匹配时才允许规划 `publish-revision`。

预期核心差异是缺少当前 canonical `inputPolicy`。dry-run 必须输出结构化字段差异；若还出现参数范围、角色、数量、模式、adapter、费用币种、结果数量、Provider profile、configuration revision、execution version或模板执行语义变化，立即停止并修订本方案，不得顺手迁移。

### 6.3 数据动作

1. 在只读 attestation、schema41、active=0、unsettled unknown=0 和冻结恢复副本门通过后运行 dry-run。
2. dry-run 必须恰好把目标旧 Seed/TTS identity 分类为已批准迁移；其他 published 模型全部为 `none`。
3. 对每个目标创建新的 immutable revision；不修改旧 document/hash。
4. 在一个事务中完成 from-active CAS、revision 写入、激活、审计和最终全模型健康复核；任一步失败整事务回滚。
5. 默认不改模板、Canvas graph、任务或历史结果。若影响分析要求任何 graph/template 数据变更，必须 fail-closed并另行审计，不能夹带进本迁移。
6. 在干净兄弟副本执行 repeat dry-run/apply；必须全模型 `none`、升级0且数据库字节不变。

## 7. 分阶段实施顺序

### R0：重新冻结代码与生产只读基线

- 从实施时最新 `origin/main` 建立隔离工作树。
- 核对生产版本、schema、开关、10个 published 模型、两个旧 active revision、任务/attempt/unknown/费用计数。
- 生成脱敏 exact identity 与 legacy diff 证据。
- 补预期红，证明当前树能复现：平台开关开 + 单模型 drift 却返回 `GLOBAL_GENERATION_DISABLED`。

停止：生产身份变化、published 分母变化未解释、活动/unknown任务不为0、完整 identity 无法取得、差异不止批准字段、需要读取受保护 JSON 或 secret。

### R1：拆分 availability 错误边界

- 修改 `server/modelAvailability.ts` 类型与稳定错误码。
- 修改 `server/modelCatalog.ts`，分别传递平台安全和合同健康。
- API/UI 透传明确模型级提示，禁止前端猜测。
- 保持所有现有 emergency/global/provider/credential/adapter 优先级及 fail-closed行为。

### R2：统一 canonical contract 与全 published planner

- 收敛 `parameterSchema`、active health、bootstrap/defaults、registry 与 migration target 的合同派生。
- planner 枚举每个 published model，而不是只枚举人工升级集合。
- 未分类 drift 阻断发布，并输出脱敏结构化原因。

### R3：实现 Seed/TTS exact legacy revision migration

- 只接受 R0 冻结的 exact from identity。
- 新建 immutable revision、事务 CAS 激活、保留旧 revision。
- 失败回滚、repeat no-op、Provider POST=0。

### R4：最小直接依赖验证

至少覆盖：

1. `globalEnabled=false` 只返回 `GLOBAL_GENERATION_DISABLED`。
2. `globalEnabled=true + contract drift` 返回模型级合同错误。
3. emergency stop、Provider config、credential、adapter 状态优先级不回退。
4. 生产形状的旧 Doubao Seed/TTS revision 缺 `inputPolicy` 可被 planner 精确识别。
5. near-miss identity/hash/schema 全部阻断。
6. 首次 apply 新建且激活新 revision；故障注入全回滚；repeat 0 写入。
7. 其余 8 个 published logical models 与全部 exact identities 动作为 `none`。
8. `/api/models` 代表性快照中 10/10 合同健康；两个模型不再冒充总开关关闭。
9. 7 节点整组预检不再因该错误阻断；仅预检不创建 task/attempt。
10. Provider transport mock 计数严格为0。

### R5：冻结生产数据库副本演练

- 只在新冻结 source/restore 与独立工作副本上执行。
- `dry-run -> apply -> health -> repeat dry-run -> repeat apply` 全链通过。
- 数据差异只能是预期的新 revision、active pointer 和脱敏审计；任务、attempt、模板、Canvas、媒体、发布物及用户内容不变。
- 生产库和服务在候选 Review GO、版本/发布授权前保持不变。

### R6：候选冻结后的完整 Review

冻结精确 diff/hash 后，主审与独立审查必须逐一覆盖：

- 每个改动文件和每个 diff hunk；
- catalog -> canonical resolver -> active health -> availability -> API/UI 完整调用链；
- migration plan/dry-run/attestation/CAS/transaction/rollback/repeat 完整链；
- 实施时全部 published logical models、exact identities、Provider/protocol/adapter 分支；
- 历史 revision、模板、任务恢复、credential、安全开关和零付费边界。

`P0>0` 或 `P1>0` 一律 NO-GO，不得进入正式 full、GitHub 或生产。

### R7：测试与本地验收

- Review GO 后才运行本事件唯一正式 safe full；若失败，只修直接根因并运行最小失败集合，不重复 full。
- 浏览器验收使用隔离假数据和动态 loopback，不触碰4173、生产数据、真实 Provider或OSS。
- 自动证据只标 `AUTO_PASS`，不能替代生产页面或用户确认。

### R8：新Session Goal激活后的发布与生产验证

R8 不由本文或Goal提示词文件的存在自动授权。用户在新Session完整发送`spec/INC_GEN_018_ONE_SHOT_GOAL_PROMPT_2026-08-31.md`后，该最新Goal消息即分别确认版本号选择规则与允许发布，并授权按项目规矩完成 PR/main CI、不可变tag/Release、fresh tag build、静默门、冻结备份恢复、生产副本dry-run/apply/repeat、原子切换和成对rollback/forward。

生产验收只做零付费检查：

- `/api/models` 当前10/10 published模型合同健康；
- 真实全局开关状态显示准确；
- Seed/TTS若有问题显示模型级合同错误，不显示伪全局关闭；
- 目标整组预检不再出现本事件7个假不兼容节点；
- tasks/attempts/active/unknown和Provider POST计数不变；
- 用户实页确认前保持 `USER_RECHECK`。

#### R8 实际执行结果（2026-08-31）

- 用户已在本Session完整发送一次性Goal，版本号、GitHub、数据库迁移与生产发布权限按正文一次性消费。PR #134 final-head/main CI、annotated tag/GitHub Release v0.6.64、fresh tag build与6044行inventory均通过。
- 新鲜生产冻结source/restore、attestation、dry-run/apply/health/repeat、外部exact release+DB pair拒绝、原子切换和paired rollback/forward均通过。迁移仅为Doubao Seed与Doubao TTS 2.0发布两个exact replacement revision；其余8模型none，repeat为10 none、升级0、DB字节不变。
- 生产运行`/opt/unboundry/releases/v0.6.64-inc-gen-018-20260831`，schema41，service active/enabled、MainPID2859331、NRestarts0；正式start恰为3，禁止再次stop/restart。10/10 published模型健康；目标7节点零付费preflight不再返回伪全局关闭。
- 迁移与浏览器验收前后tasks1026/attempts1037/active0/current unknown0，Provider request count保持1025；Provider POST、OSS写、新费用均为0。72秒7样本稳定门通过。
- 技术终态为`PRODUCTION_V0_6_64_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`。用户未在真实页面明确确认，故IG18-040不得升级为`USER_PASS`。
- R8-P2-001保留9个历史失败图片任务的同attempt结果收回轮询/状态事件与日志churn；R8-P2-002保留根盘99%容量风险。它们没有新增task/attempt/admission/Provider POST，不是本轮新增P0/P1；本Goal不擅自重启、清历史或删除release/rollback/backup/staging。

## 8. 测试与审查文件初始范围

实施时以 R0 真实 diff 为准，至少检查：

- `types/modelParameters.ts`
- `server/modelCatalog.ts`
- `server/modelAvailability.ts`
- `server/activeModelContractHealth.ts`
- `server/modelContractUpgrade.ts`
- `server/modelReleaseDefaults.ts`
- `server/modelReleaseBootstrap.ts`
- `server/modelReleaseRevisionStore.ts`
- `server/modelExecutionRegistry.ts`
- `/api/models` 序列化与客户端模型预检消费链
- `tests/m12-model-catalog.spec.ts`
- `tests/m17-model-parameters.spec.ts`
- `tests/m29-text-node-inputs.spec.ts`
- `tests/m32-model-runtime-availability.spec.ts`
- `tests/m36-four-node-preflight-ui.spec.ts`
- `tests/m77-public-templates.spec.ts`
- `tests/m81-deployment-hardening.spec.ts`
- `tests/m102-model-execution-contracts.spec.ts`

若 canonical resolver 或 API 类型变更影响其他模块，必须按实际调用链扩展，不得用本清单限制必要审查。

## 9. 明确禁止的快捷修复

- 写死或强制 `contractHealthy=true`。
- 删除 active contract health、revision integrity 或 registry 检查。
- 只修改中文提示、只在前端重分类。
- 原地修改旧 revision document/hash。
- 手工编辑生产 JSON/SQLite 或直接批量重写所有旧 revision。
- 只把 Seed/TTS 添加成散落的运行时特判，而不让 planner 枚举全 published 模型。
- 静默隐藏两个模型或切换到其他模型。
- 因本事件直接回滚整个 v0.6.63；回滚会同时撤回已验证的工作流安全修复，且不能解决生产旧 revision 数据。
- 通过真实 Provider生成来“试试看”；本修复必须在零 Provider POST下证明。

## 10. 硬停止条件

任一条件成立立即停止：

1. R0完整生产身份与本文证据不一致且无法解释。
2. published logical model分母或 exact identity集合变化未纳入Review。
3. Seed/TTS实际差异超出已批准的语义元数据修复。
4. 需要修改模板/Canvas graph/历史task/result或用户素材。
5. active task、unsettled unknown、Provider边界或费用状态不安全。
6. migration不是 exact from identity、缺CAS、缺事务或repeat有写入。
7. 任一 Provider POST、OSS写、secret读取或受保护JSON访问发生。
8. 候选 P0/P1 未清零。
9. 用户尚未在新Session完整发送一次性Goal，或无法按Goal证明版本未占用，却要进入GitHub/生产。
10. 无法证明数据备份、恢复、rollback/forward或计数不变。

## 11. 授权说明

用户已在本Session完整发送一次性连续实施Goal并激活；本文、Checkpoint、Matrix和Goal提示词文件本身仍不构成未来授权。该Goal正文确认的`v0.6.64`、GitHub、数据库迁移和生产发布权限均已按回执消费；真实Provider POST、OSS写和费用硬上限保持0且已通过。后续代码、tag/Release移动、生产stop/restart、数据清理或Provider动作均需要新的明确授权。

实时断点：`spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_CHECKPOINT.md`

验收矩阵：`spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_ACCEPTANCE_MATRIX_2026-08-30.md`

新Session一次性Goal：`spec/INC_GEN_018_ONE_SHOT_GOAL_PROMPT_2026-08-31.md`
