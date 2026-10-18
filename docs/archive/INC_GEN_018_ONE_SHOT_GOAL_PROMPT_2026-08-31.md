# INC-GEN-018 新 Session 一次性实施 Goal 提示词

状态：`COPYABLE_GOAL_PROMPT / NOT_STARTED / NOT_CURRENT_SESSION_AUTHORIZATION`

更新时间：2026-08-31

使用方法：在一个新的 Codex Session 中完整复制下面代码块并发送。只有用户在新 Session 实际发送后，才启动该 Goal；本文件的存在、当前 Session 的文档编辑或历史聊天都不授权当前 Session 实施。

```text
/goal

你现在开始执行 Unboundry 的 INC-GEN-018「模型合同健康边界与旧 Revision 精确修复」。这是一次性、连续、文档驱动的实施 Goal，也是本次任务的完整目标、权限、安全边界、执行顺序、验收标准和停止条件。

不得只分析、只出方案、只修提示文案或停在候选代码；必须从实时 R0 开始，连续完成实现、定向验证、生产冻结副本迁移演练、候选逐代码全量 Review、唯一正式 safe full、GitHub、不可变版本、可回滚生产迁移与零 Provider POST 生产验证，直到达到本文规定的技术完成终态或真实不可绕过的安全阻塞。

本消息是用户对本 Goal 的最新明确授权。立即创建 Goal，并把本消息中的目标写入 Goal；不要把历史 Goal、聊天摘要、附件或本提示词文件的存在误当成另一次授权。

一、项目身份与启动核对

1. 唯一规划工作树：
   /Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28
2. 先进入该目录，完整读取仓库根 `AGENTS.md`。然后严格按下列顺序完整读取，不得只读摘要、搜索命中或聊天转述：
   - `上线规矩.md`
   - `spec/UNBOUNDRY_CURRENT_STATE.md`
   - `README.md`
   - `spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_CHECKPOINT.md`
   - `spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_PLAN_2026-08-30.md`
   - `spec/INC_GEN_018_MODEL_CONTRACT_HEALTH_BOUNDARY_AND_LEGACY_REVISION_REMEDIATION_ACCEPTANCE_MATRIX_2026-08-30.md`
   - `spec/INC_GEN_018_ONE_SHOT_GOAL_PROMPT_2026-08-31.md`
   - `spec/INC_GEN_017_CHECKPOINT.md`（历史生产断点）
   - `spec/INC_GEN_017_WORKFLOW_SELF_HEALING_AND_MODEL_CONTRACT_ISOLATION_PLAN_2026-08-28.md`
   - `spec/INC_GEN_017_ACCEPTANCE_MATRIX_2026-08-28.md`
   - `spec/INC_GEN_017_ONE_SHOT_GOAL_PROMPT_2026-08-28.md`（历史授权已消费，不得恢复）
   - `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_CHECKPOINT.md`（历史生产断点）
   - `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_PLAN_2026-08-27.md`
   - `spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_ACCEPTANCE_MATRIX_2026-08-27.md`
   - `spec/MODEL_CONTRACT_002_CHECKPOINT.md`（历史发布断点）
   - `spec/MODEL_CONTRACT_002_IMMUTABLE_REVISION_REMEDIATION_PLAN_2026-08-27.md`
   - `spec/MODEL_CONTRACT_002_ACCEPTANCE_MATRIX_2026-08-27.md`
   - `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`
   - `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`
   - `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`
   - `TASKS.md` 顶部 INC-GEN-018 区块
   - `spec/INCIDENT_2026-08-20_TEMPLATE_GROUP_FAILURE_AND_QUEUED_TASK_HANDOFF.md`
   - `spec/UNBOUNDRY_GLOBAL_AUDIT_REMEDIATION_PLAN_2026-08-20.md`
   - `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 顶部 INC-GEN-018 区块
3. 只读核对 `pwd`、Git root、全部 worktree、branch、HEAD、`origin/main`、status、remote、package/schema、Node/npm 双通道、线上 version/schema/service、当前 published 模型分母、active revision 和任务/费用基线。不得仅凭目录名、旧文档或聊天记忆确认身份。
4. 文档冻结时记录的基线是：工作树 `main@d3e213da3b516ba8abc8bff4aada4d983f655ab2`、package `0.6.63`、schema `41`、生产 `v0.6.63/schema41`、10 个 published 模型、tasks1026/attempts1037/active0、本事件新增 Provider POST/费用0。实施以 R0 实时只读核对为准。
5. 当前工作树已有用户批准的 INC-GEN-018 Plan、Checkpoint、Matrix及权威路由文档改动，必须完整保留。不得用 reset、checkout、clean、stash 丢失、覆盖或把它们当成无关脏文件。
6. 已存在未跟踪文件 `spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json`，禁止读取、修改、暂存、移动或删除。`spec/public-templates-director-split-revision.json`同样禁止读取、修改、暂存、移动或删除。
7. 默认实施分支为 `codex/inc-gen-018-contract-health-boundary-2026-08-31`。若已存在，自动使用同前缀加不冲突的时间后缀，不要询问。
8. 若 `origin/main` 已前进，先识别实时差异；在不丢失当前已批准文档的前提下，自动把本 Goal 带到基于最新 `origin/main` 的隔离分支/工作树，解决普通冲突并重新执行 R0。若身份变化使冻结方案的核心假设不再成立，则按硬停止条件处理。

二、唯一目标

修复生产 v0.6.63 中“平台真实总开关已开启，但 Doubao Seed 与 Doubao TTS 2.0 因旧 active immutable revision 合同漂移而被错误提示为管理员关闭真实生成”的回归，并消除造成该事故的语义边界耦合。

必须同时完成：

1. 平台安全状态与单模型合同健康彻底分离：`globalEnabled` 只代表管理员总开关，`emergencyStop` 只代表紧急停止，合同漂移不得伪装成全局关闭。
2. 合同漂移继续在 Provider boundary 前 fail-closed，并返回稳定、明确的模型级错误；不得为了恢复可用性关闭健康检查。
3. catalog、active health、bootstrap、发布和 migration planner 使用同一个纯、确定、无网络、无 secret、无数据库写的 canonical published contract 解析结果。
4. migration planner 枚举实施时全部 published logical models 和全部 exact execution identities；每个 identity 唯一分类为 `none`、`publish-revision`、`blocked-unclassified-drift` 或 `blocked-invalid-active`，不得再由人工 model-ID allowlist 决定检查分母。
5. Doubao Seed 与 Doubao TTS 2.0 只在完整 model/provider/profile/driver/protocol/configuration/revision/hash/schema 身份与 R0 冻结 legacy 形状精确匹配时迁移；创建新的 immutable revision，以事务和 active CAS 激活，旧 revision/document/compiler hash 永久保留。
6. 除两个被批准的 exact legacy identity 外，其他 published 模型及 exact identities 全部必须为 `none`；任一未分类 drift 在写入前阻断整体计划。
7. 默认不修改模板、Canvas graph、Prompt、媒体、边、任务、历史结果或用户数据；旧任务仍按其冻结 revision 执行和恢复。
8. 修复、测试、演练和生产验收全程新增真实 Provider POST=0、OSS 写=0、新费用=0；本事件不需要也不允许付费生成来证明修复。
9. 最终生产必须逐一证明当前全部 published 模型合同健康、全局开关显示准确、目标整组预检不再出现本事件的 7 个假不兼容节点，且预检前后任务/attempt/active/unknown/Provider计数不变。

三、冻结设计与禁止降级

1. 严格实施 Plan 的 MC18-01～MC18-05、R0～R8、Matrix IG18-001～040 和全部 NO-GO 门。
2. Availability 至少要稳定区分：真实全局关闭、emergency stop、模型合同 out-of-sync/migration-required/invalid、Provider、credential、configuration 与 adapter 状态。错误优先级必须由服务端合同定义，前端只透传，不重新猜测。
3. canonical resolver 必须输出或等价覆盖：清洗后的 capability schema、Provider 语义默认继承、execution registry 身份、execution/capability fingerprint、当前发布 target document、active-vs-current 结构化差异。
4. 不写死 `contractHealthy=true`，不删除 active health/revision integrity/registry 检查，不只改中文提示，不在前端特判 Seed/TTS，不静默隐藏或换模型。
5. 不原地修改旧 revision，不手工编辑生产 SQLite/JSON，不直接批量重写所有旧 revision，不把历史任务按新 active revision 重新解释。
6. 不因本事件整体回滚 v0.6.63，不撤销已验证的工作流安全修复；本事件只修模型合同健康边界和经精确证明的 legacy revision。
7. 发现普通实现细节时，自主选择最简单、可靠、与现有模块边界一致的实现，不要询问我；不得借机重写无关架构、拆微服务或扩大产品范围。

四、一次性权限全部提前授予

以下授权只对本 Goal 有效，完成或 BLOCKED 后自动消费，不得延伸到未来任务。不得就这些事项中途再次询问我：

1. 修改本 Goal 必需的产品代码、类型、测试、fixture、脚本、配置、数据库迁移、治理文档、package、lock 和 runtime/version 文件。
2. 创建/切换分支和隔离 worktree；安装锁文件要求的依赖；运行格式化、静态检查、类型检查、构建、定向测试、冻结副本迁移演练、安全浏览器验证和一次正式 safe full。
3. 创建本地 checkpoint/功能/候选/治理 commit；候选 Review GO 后 push、创建 PR、等待并修复 CI、合并、验证 main CI。
4. 本 Goal 的首选发布版本为 `v0.6.64`。如果实时核对发现本地/远端 tag、GitHub Release、package、生产或并行 main 已占用 `v0.6.64`，自动选择高于实时生产且未占用的最低 patch 版本；该确定性替代版本同样已获确认，不要询问。修改 package/lock/runtime版本、创建版本相关commit或tag之前，必须把全部占用对象、候选版本、最终版本和未占用证明先写入Checkpoint。
5. 更新 package/lock/runtime版本，创建不可移动 annotated tag 和 GitHub Release，从精确 tag 做 fresh build。
6. 使用既有已认证通道进行必要的 GitHub 与生产 SSH 读写；执行静默门、停服/启服、完整冻结备份与恢复副本、生产副本 dry-run/apply/repeat、精确数据迁移、原子 release/DB 切换、健康/静态资源/数据验证及成对 rollback/forward。
7. 在备份、恢复演练、old-runtime拒绝门、quiet gate、active/unknown门和回滚门通过后，允许执行本 Goal 精确需要的生产 revision 数据迁移及必要 schema migration；不得删除用户数据、媒体、历史任务、旧 revision、备份或旧 release。
8. 允许使用隔离假账号/假Canvas/假数据和动态 loopback 完成本地/浏览器验收；允许只读查看生产模型、revision、任务、计数、服务和部署身份所需的脱敏元数据。
9. **版本号确认（独立授权 A）**：按 `v0.6.64`；若该版本已占用，按第4条确定性选择并使用高于实时生产的最低未占用patch版本。
10. **允许发布（独立授权 B）**：可以上线。允许完成本Goal的commit、GitHub、数据库迁移、生产发布、rollback和forward。

上面A与B是本条最新用户Goal消息中的两个独立、明确拍板字段；不要把它们合并成含糊的“继续”或“开搞”。

五、数量与费用硬上限

1. 新增真实 Provider POST 硬上限：`0`。
2. 新增真实 Provider 费用硬上限：`USD 0`。
3. 新增真实 OSS 写硬上限：`0`。
4. 生产验证只允许 API/页面模型目录、预检、只读计数和无付费副作用的健康检查；任何路径即将越过 Provider submit/OSS write boundary，必须在边界前 fail-closed。
5. 任何历史或新发现的 `OUTCOME_UNKNOWN_BILLING_RISK` 永远禁止第二次 POST，只能核对和恢复原任务；本 Goal 不以重试任务验证修复。

六、永远不能因“全部授权”放松的红线

1. 不读取或输出 secret、Authorization、Cookie、API key、签名 URL、真实 Prompt、原媒体或用户 graph 正文；只使用现有认证会话和脱敏身份。
2. 不读取、修改、暂存、移动或删除两个受保护 JSON；不把它们纳入 source hash、diff、commit、PR 或发布包。
3. 不运行测试到生产端口4173、本地 `app/data`、`/var/lib/unboundry` 生产路径、真实媒体或真实用户 Canvas；测试使用 `node scripts/run-safe-tests.mjs`、系统临时目录、动态 loopback 和 fake transport。
4. 不执行 `git reset --hard`、`git clean`、破坏性 checkout，不覆盖用户改动，不移动历史 tag，不删除备份、旧 release、用户数据或 OSS 对象。
5. 不绕过 owner、权限、SSRF、内容审核、revision、configuration、registry、credential lease、CAS、事务、费用和 publication 安全门。
6. 不允许测试夹具只用当前代码新建 revision 来冒充生产 legacy 形状；必须直接回放 R0 证明的旧 Seed/TTS revision。
7. 不允许人工补齐生产旧 row、手动改 hash 或用截断 revision ID 执行迁移。

七、文档驱动与防失忆协议

1. 事实优先级固定为：本条最新 Goal 消息 > `AGENTS.md` > `spec/UNBOUNDRY_CURRENT_STATE.md` > INC-GEN-018 Checkpoint > INC-GEN-018 Plan > INC-GEN-018 Matrix > 当前代码/测试/生产证据 > 历史文档与聊天摘要。
2. R0 开始前，立即把实际 Git/worktree/branch/HEAD/origin、package/schema、Node/npm、生产版本、全部 published logical models、全部 exact identities、两个 from-revision 全量身份、任务/费用计数和本 Goal 授权写入 Checkpoint。
3. 每完成 R0～R8 任一阶段，必须立即同步：
   - INC-GEN-018 Checkpoint
   - INC-GEN-018 Matrix
   - `TASKS.md` 顶部 INC-GEN-018 区块
   - `spec/UNBOUNDRY_CURRENT_STATE.md` 顶部 INC-GEN-018 区块
   同步记录代码范围、命令、环境、通过/失败/跳过/重试、source/snapshot/hash、模型和 identity 分母、Provider POST/OSS/费用、下一步与停止条件。
4. 任何上下文压缩前先写 Checkpoint；压缩后必须重新完整读取 `AGENTS.md`，并按本Goal第一节第2项重新完整读取其中全部24项权威文件，不得只读CURRENT_STATE/Checkpoint摘要，不得依赖聊天记忆继续。
5. 不得凭记忆重复 formal full、生产迁移、rollback/forward、tag/Release或任何有副作用阶段。先读取 Checkpoint 的命令、hash、exit和回执，只有相关代码变化或强制门要求时才补最小证据。
6. `EVIDENCE_PASS`、`TARGETED_AUTO_PASS`、`AUTO_PASS`、`REVIEW_GO`、`PRODUCTION_TECHNICAL_PASS`、`ZERO_PROVIDER_POST_PASS`、`USER_RECHECK`、`USER_PASS`严格分开。自动和生产技术证据不能代替我的主观页面确认；没有我在完成后明确回复“通过”，不得写 `USER_PASS`。

八、连续实施顺序

R0：重新冻结实时身份与预期红

- 基于最新 origin/main 和当前批准文档建立实施分支。
- 只读冻结生产 version/schema/safety、全部 published 模型和 exact identities、Seed/TTS完整 active/release/configuration/document/compiler hash、raw stored schema、canonical expected schema、模板/Canvas/任务引用计数、tasks/attempts/active/unknown/费用。
- 生成脱敏 exact identity 与结构化 legacy diff；不得记录 secret、Prompt、媒体 URL、owner 或 graph 正文。
- 先补预期红，证明 `globalEnabled=true + contract drift` 当前错误返回 `GLOBAL_GENERATION_DISABLED`；再开始实现。

R1：拆分 availability 错误边界

- 让平台安全、合同健康、Provider、credential、configuration 和 adapter 状态分别进入 availability。
- 增加稳定模型级合同错误并保持 emergency/global/provider/credential/adapter 既有优先级和 fail-closed。
- API/UI 只透传服务端结果，不在前端重判。

R2：统一 canonical contract 与全 published planner

- 收敛 parameter schema、Provider默认继承、active health、bootstrap/defaults、registry、发布 target 与 planner 的合同派生。
- planner 遍历全部 published logical models 和 exact identities；人工清单只能批准精确 legacy 形状，不能决定检查分母。
- 任一未分类 drift 在任何写入前阻断并输出脱敏结构化原因。

R3：实现 Seed/TTS exact immutable revision migration

- 只接受 R0 冻结的完整 from identity、from active、hash、schema 和 configuration revision。
- 新建 immutable revision；在一个事务中完成 from-active CAS、revision写入、激活、脱敏审计和全模型最终健康检查；任一步失败全部回滚。
- 保留旧 revision/document/compiler hash；repeat 必须零写入和数据库字节不变。

R4：最小直接依赖验证

- 覆盖 global off、global on+drift、emergency、Provider、credential、configuration、adapter 的完整优先级矩阵。
- 覆盖真实 legacy Seed/TTS 形状、全部 near-miss、首次apply、故障注入、事务回滚、repeat no-op、其余模型 none、API模型目录、7节点整组预检和 transport submit=0。
- 失败只修直接根因并重跑失败集或最小受影响集合，不用大套件获得安心。

R5：冻结生产数据库副本演练

- 只在新冻结 source/restore 与其独立工作副本上执行 attestation、dry-run、apply、health、repeat dry-run、repeat apply。
- 数据差异只能是经批准的新 revision、active pointer 与脱敏 audit；模板、Canvas、任务、attempt、历史结果、媒体、publication和用户内容必须不变。
- repeat 必须全部 `none`、升级0、DB逐字节不变；生产库此时仍不写。

R6：冻结候选并做完整逐代码 Review

- 定向证据全绿后冻结精确 diff/hash；Review 期间只读，不边审边改。
- 主线程和一个独立只读审查上下文都必须完成第九节的全量 Review。发现 P0/P1 时立即 NO-GO、解冻候选、回到最小整改和定向复验；同一审查上下文复核修复后重新冻结。
- `P0=0/P1=0` 前不得进入正式 full、commit候选、GitHub或生产。

R7：唯一正式 safe full 与隔离浏览器验收

- Review GO 后运行本事件一次且仅一次正式 `node scripts/run-safe-tests.mjs full`。
- formal full 若失败，保留原始结果，只跑最小失败集合完成修复/复验，不重复 full；如修复改变候选风险边界，重新进行受影响 Review。
- 浏览器只使用隔离假数据和动态 loopback，验证模型目录、错误码和7节点预检；不碰4173、生产数据、Provider或OSS。

R8：GitHub、不可变发布与生产零付费验证

- 刷新版本占用并把占用对象、候选、最终选择及未占用证明写入Checkpoint后，才修改版本文件并使用已授权版本；随后精确 commit、push、PR、final-head CI、merge、main CI、annotated tag、GitHub Release、fresh tag build。
- 生产先做 quiet gate、active/unknown/费用门、冻结source/restore、恢复与生产副本dry-run/apply/repeat、old-runtime拒绝门和回滚门；全部通过后才原子迁移与切换。
- 实际执行成对 rollback/forward，核对 service、version、schema、integrity、FK、静态资源、release inventory、关键数据计数和有界稳定门。
- 生产页面只做零付费验证：逐一检查全部 published 模型、真实全局开关、Seed/TTS错误分类、目标整组预检；前后 tasks/attempts/active/unknown/Provider POST/OSS/费用不变。
- 生成不可变生产回执，并同步 Plan/Checkpoint/Matrix/TASKS/CURRENT_STATE/README/AGENTS/上线规矩中需要更新的当前状态与链接。

九、候选冻结后的逐代码全量 Review

这里的“全量”不是只跑测试，也不是抽样看同类模型。必须逐一完成并报告覆盖分母：

1. 列出本 Goal 全部改动文件；逐文件、逐 diff hunk、逐关键条件、逐异常和回滚分支审查。
2. 沿完整调用链审查：模型定义/参数默认 → canonical resolver → execution registry → release defaults/bootstrap → active contract health → availability → `/api/models` 序列化 → 客户端模型目录与工作流预检。
3. 沿完整迁移链审查：生产身份读取 → legacy diff/classification → planner → attestation → dry-run → exact selector → active CAS → transaction → immutable revision write → activation → audit → final health → rollback → repeat no-op。
4. 对实施时全部 published logical models 和全部 exact execution identities逐一审查，不得以“其余同类”代替；逐一核 model ID、provider profile、driver、protocol、provider model ID、configuration revision、execution version、schema、fingerprint和planner action。
5. 对全部 Provider/protocol/adapter 分支逐一证明本改动不改变请求、费用、任务恢复与历史 revision 行为；尤其检查 Seed、TTS、Seedance、GPT Image、Grok、Mureka、relay/native及实施时新增分支。
6. 逐项复检 global/emergency/contract/provider/configuration/credential/adapter 的错误码和优先级，确认合同健康不再污染平台开关且仍 fail-closed。
7. 逐项复检历史 revision、旧任务、恢复、模板、Canvas、媒体、publication、owner与审计边界，确认没有 current active revision 反向重释历史数据。
8. 全仓搜索并解释新增/残留的 model-ID allowlist、`globalEnabled && contractHealthy`、`contractHealthy`覆盖、providerModelId/driver/protocol/configurationRevision和 schema 特判，确认没有散落的第二真相或通用 fallback 逃逸。
9. Review最终输出：改动文件分母、hunk分母、调用链、模型分母、identity分母、Provider分支分母、测试分母、未覆盖项、P0/P1/P2与GO/NO-GO。任何P0/P1未清零，禁止进入formal full、GitHub和生产。

十、验收硬门

1. Matrix IG18-001～040必须逐项有证据；未到阶段的项目不得提前写PASS。
2. 目标 legacy 差异只能是 R0 和 Plan 批准的语义元数据；出现参数范围、输入角色/数量/模式、adapter、费用、result count、Provider profile、configuration revision、execution version、模板执行语义或其他未知差异立即停止。
3. 首次迁移必须精确创建和激活新 immutable revision；near-miss全部拒绝；故障注入零半状态；repeat全模型none、升级0、DB字节不变。
4. 其余全部 published 模型/exact identities为none；生产最终全部 published 模型逐一健康，不抽样。
5. 目标7节点整组预检不再因伪全局关闭阻断，且预检不创建task/attempt。
6. 全程真实 Provider POST=0、OSS写=0、新费用=0；任何非零即NO-GO并保留证据。
7. 候选 Review必须P0=0/P1=0；formal full只执行一次；GitHub/CI/tag/Release/fresh build身份一致。
8. 生产备份、恢复、迁移、rollback/forward、静态资源、数据计数和稳定门全部通过，才可写 `PRODUCTION_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`。
9. 最终技术完成允许停在 `PRODUCTION_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`。用户主观实页确认是本 Goal 完成后的人工步骤，不是技术执行阻塞；没有我的明确回复不得写 `USER_PASS`。

十一、连续执行与唯一硬停止条件

1. 不得因为普通实现选择、依赖版本、分支名冲突、版本fallback、测试失败、CI失败、迁移脚本选择、commit、PR、merge、发布或生产步骤再次询问我；在授权范围内自行诊断、修复、重试并继续。
2. 临时外部错误使用有界退避；一个外部环节失败时先完成所有不依赖工作。不得无限重试、不得重复formal full、不得用Provider POST验证。
3. 只有下列真实不可绕过条件才允许停止，并必须先更新Checkpoint/Matrix/TASKS/CURRENT_STATE，保留证据和已完成工作：
   - Git/生产/模型/revision exact identity无法证明，且安全只读渠道已穷尽；
   - 实际 legacy 差异超出冻结批准范围，需要修改 Plan 或用户数据域；
   - active/unsettled unknown/费用边界不安全，或零Provider/零OSS硬上限无法维持；
   - 必须删除、覆盖或不可逆修改用户数据、备份、旧release、历史revision、真实媒体或受保护文件；
   - 必须获得新的账号登录、身份、密钥、法律/合规决策而现有授权无法提供；
   - P0/P1在完整整改和复核后仍无法清零；
   - 无法证明生产备份、恢复、事务、rollback/forward或关键计数不变；
   - GitHub/CI/生产外部系统在有界重试后持续不可用，无法完成必要硬门。
4. 真正阻塞时遵守 Goal 工具的 blocked 判定规则；不要把任务困难、时间长、上下文压缩或需要继续工作当成阻塞。
5. 全部技术目标实际完成且没有剩余必需工作时，立即调用Goal工具把状态标记为`complete`；不得只停止回复而把Goal留在进行中。只有满足上述真实硬阻塞并按工具规则标记`blocked`时，才可以阻塞终止。

十二、最终交付格式

最终回复必须先给结论，再用简单中文给出：

1. 生产问题是否已解决、实际生产版本与schema；
2. 实现范围和为什么不会再把模型合同健康冒充全局关闭；
3. Seed/TTS旧revision如何精确迁移、旧revision是否保留；
4. 全部published模型/exact identities/Provider分支的Review分母与P0/P1/P2；
5. 定向测试、唯一formal full、CI、迁移演练、生产rollback/forward的原始结果；
6. Provider POST、OSS写和费用的精确总数；
7. 生产数据、任务、attempt、模板、Canvas、媒体和历史结果是否保持；
8. 未完成项、残余P2和用户只需执行的最短实页复验步骤；
9. 当前状态只能诚实写到 `PRODUCTION_TECHNICAL_PASS / ZERO_PROVIDER_POST_PASS / USER_RECHECK`，除非我之后明确回复“通过”。

现在开始：立即创建Goal，然后完整读取权威文档、核对实时身份并写入R0 Checkpoint，随后持续执行到底。不要再向我询问本文已提前授权的任何事项。
```
