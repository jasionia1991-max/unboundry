# 新 Session 可直接复制的 Goal 提示词

```text
/goal 一次性完成 MODEL-CONTRACT-001 用户真实验收失败返工：严格按权威文档先完成“版本 A：付费安全与结果恢复”，再完成“版本 B：合同工作台、官方文档、UI 与 Provider 兼容”，完成全部风险驱动验证、真实 Computer Use 候选验收和一次独立只读全量 Review，修复 Review 的全部 P0/P1，形成可发布候选；然后只在最终生产发布前停在授权门，一次性向我提交版本、commit/tree、PR/CI、测试、Review、费用、回滚和发布建议。除这个最终发布门外，不得中途向我询问普通权限、版本号或方案选择。

这是本 Session 唯一最新 Goal。不要恢复、拼接或执行历史 Goal；聊天摘要、历史记忆和旧 Goal 只能作为线索，不能覆盖当前权威文档、Git 实况和测试证据。

一、唯一目标和完成边界

目标不是重新实现 MODEL-CONTRACT-001，也不是只修六张截图，而是关闭 2026-08-27 全部用户复验缺陷：27 项清单当前只有 15 项通过，另有 12 项失败或证据不足；必须重新覆盖完整 27 项，并优先关闭可能重复扣费的 P0。

施工顺序固定为：

1. R0 只读恢复与差异归属；
2. 版本 A：付费安全与结果恢复；
3. 版本 A 定向验证并冻结独立 commit/checkpoint；
4. 版本 B：合同工作台、官方文档、模式/角色、UI、可访问性和 Provider 兼容；
5. 版本 B 定向验证；
6. 本地/候选真实 Computer Use 完整重跑 27 项；
7. 候选冻结后启动一次独立只读全量 Review，不得与实现并行；
8. 修复 Review 的全部 P0/P1并由同一审查线程复核；
9. Review 为 P0=0 / P1=0 / GO 后，最多执行一次本 Goal 正式 safe full；
10. 完成 commit、push、Draft PR/PR、CI 修复和候选冻结；
11. 在 merge/tag/GitHub Release/生产写入之前停在最终发布授权门。

本 Goal 的完成状态只能先到 `RELEASE_CANDIDATE_READY / USER_RECHECK`。不得自行写生产发布通过或 `USER_PASS`。

二、权威文档与读取顺序

开始后立即创建 Goal，并按以下顺序完整阅读：

1. `AGENTS.md`
2. `上线规矩.md`
3. `spec/UNBOUNDRY_CURRENT_STATE.md`
4. `README.md`
5. `spec/MODEL_CONTRACT_001_CHECKPOINT.md`
6. `spec/MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_PLAN_2026-08-27.md`
7. `spec/MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_ACCEPTANCE_MATRIX_2026-08-27.md`
8. `spec/MODEL_CONTRACT_001_MODEL_EXECUTION_CONTRACT_GOVERNANCE_PLAN_2026-08-26.md`
9. `spec/MODEL_CONTRACT_001_ACCEPTANCE_MATRIX_2026-08-26.md`
10. `spec/MODEL_CONTRACT_001_USER_RECHECK_2026-08-26.md`
11. `TASKS.md` 顶部 MODEL-CONTRACT-001 区块
12. `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 顶部当前区块
13. `AGENTS.md` 要求的其余权威文档

冲突优先级：本 Goal → AGENTS.md → 当前 remediation checkpoint/plan/matrix → CURRENT_STATE → 原 MODEL-CONTRACT-001 方案/矩阵 → 其他历史文档。冲突时选择更严格的数据、秘密、付费、ownership、revision 和回滚边界，并及时修正文档冲突。

三、开始时必须只读核验

先核验并写入 checkpoint：

- 真实 Git 根、worktree、branch、HEAD commit/tree；
- `origin/main` commit/tree，是否与 HEAD 一致；
- `git status`、全部 tracked/untracked 差异及归属；
- package、lock、schema、`.node-version`、packageManager、当前 Node/npm；
- 当前生产版本、service、schema 和只读任务计数；
- Git tag、GitHub Release 和版本占用；
- 4173 监听身份；
- 当前 Provider/费用账本和真实生成预算余额。

已知但必须重新核验的基线：

- 工作树 `/Users/mymy/Documents/unboundry-model-contract-001-2026-08-26`；
- 分支 `codex/model-contract-user-recheck-fixes`；
- 历史基线 `HEAD = origin/main = cc9df2a57aca8abc68596ee398e19de6bd0b4ef3`，tree `f91bfb23d30da1b0f8b0543f11c6d2ed3e397dc3`；
- package `0.6.50`、schema41；
- 当前已有未提交改动：`client/src/App.tsx`、`client/src/styles.css`、`server/modelReleaseDefaults.ts`、`tests/m102-model-execution-contracts.spec.ts`。

不得丢弃、覆盖或直接信任这四个文件。先冻结 diff 和归属，逐块审查：有效部分保留，无效部分修正；禁止 `git reset --hard`、`git clean`、checkout 覆盖或清理其他 worktree。若实况与上述基线不同，优先以当前 Git 事实和用户文件安全为准；完成所有不依赖工作后，只在确实无法安全确认归属时作为最终硬阻塞报告，不因普通差异停下来问我。

四、永久红线

永远不得读取、修改、暂存、提交、移动或删除：

`spec/public-templates-director-split-revision.json`

禁止：

- 使用 4173、`app/data`、生产目录、真实备份或用户业务数据运行测试；
- 暴露 API Key、Authorization、Cookie、签名 URL、完整 Provider 响应或用户秘密；
- 在无法证明 Provider 未受理时重提付费请求；
- 用平台查询为空推断没有收费；
- 跨 owner 读取/绑定媒体或结果；
- 把合同工作台 CAS 扩散到 Canvas DATA-005；
- 静默截断、丢图、重排、猜角色或自动取第一张；
- 把请求合同通过冒充成片视觉或服装款式通过；
- 为了“完成”而伪造官方文档、Provider 证据、EXACT 合同、测试或费用。

五、版本 A：付费安全与结果恢复

必须完成：

1. 把 Provider attempt 明确区分为未派发、已受理且任务号已知、可能受理但任务号未知、已收到结果、明确未受理、结果未知和已退款等确定性；优先复用现有持久状态和稳定错误码，非必要不升 schema。
2. “搜索不到远端任务”“缺 task ID”“响应丢失”“结果结构未知”一律不能自动变成可重试。
3. 只要请求可能越过付费边界且没有权威未受理/未计费/退款证据，就进入 `OUTCOME_UNKNOWN_BILLING_RISK`，禁止新的 Provider POST。
4. “核对结果”只能查询/恢复原任务；刷新、重启、重复点击和双标签不能增加 attempt 或 Provider POST。
5. 401/403、429、网络/超时、5xx、格式异常不触发付费重试或端点 fallback。
6. 记录脱敏请求关联号、revision、请求摘要、attempt 确定性和阻断原因；不记录秘密和签名 URL。
7. GPT Image 支持经过白名单验证的成功响应结构；结果仍经过 MIME、大小、HTTPS/SSRF、owner 和 publication 安全链。未知结构保留证据并禁止重提。
8. Mureka 429 只展示限流和可核对时间，不创建新付费 attempt。
9. 把模型证据细化到模式级。GK 文生视频在正式证据恢复前标记 `UNKNOWN/BLOCKED`；GK 首帧只允许 Prompt + 恰好1张 `first-frame`，图片仅进入 `params.images` 单元素 URL 数组；其他角色/数量零 POST。
10. 发布/回滚只影响新任务，运行中任务继续使用冻结 revision。

版本 A 的最低放行门：所有缺 task ID、查询空、响应丢失、格式未知、429/超时 fixture 都证明没有第二次 POST；旧任务恢复、数据库兼容和 GPT Image 已知成功结构通过；更新 checkpoint 和矩阵后形成独立 commit，再进入版本 B。

六、版本 B：合同工作台、文档与 UI

必须完成：

1. 页面明确区分“当前页面未保存状态”“已保存草稿：无/vN”“当前发布版本：vN”。
2. “本地校验当前页面”零保存、零发布、零 Provider、零 CAS；“保存草稿”才使用草稿 revision/CAS；“发布”只接受未过期的已验证草稿。
3. 只有稳定错误码 `MODEL_CONTRACT_DRAFT_CONFLICT` 才显示并发冲突；不得按中文字符串或任意 409 猜测。
4. 没有草稿时仍能校验当前页面或发布版本；按钮禁用必须显示准确原因。
5. 当前页面、已保存草稿、当前发布版本都有始终可发现的脱敏只读预览；预览不得包含秘密、真实素材 URL 或可编辑 JSON。
6. 模式 ID、角色 ID 默认由系统生成；普通管理员只看到中文名称、用途、数量和顺序。内部 ID 放在高级只读区；变更前验证历史 revision、模板和引用完整性。
7. 官方文档必须是精确来源并记录来源类型、适用模式、核验日期和证据等级；平台首页、营销页、占位符不能支持 EXACT；建议只进入新草稿，不改写发布 revision。
8. checkbox/select/input 对齐项目灰阶 UI；无原生蓝色控件。只读值使用静态语义组件，不用输入框，不靠全局隐藏 caret 掩盖。
9. 完成键盘、焦点返回、inert、错误关联和非仅颜色状态。
10. 完成 1280×720、1440×900、1920×1080、900×900 与 ≤928px 单列验证，无横向溢出、遮挡和不可达操作。
11. Text/Image/Video/Audio、图片工具、Suno 多结果、旧 Canvas、旧模板和历史任务不得回归。

七、架构与过度耦合约束

保持以下职责分离：

- `ContractCompiler` 只编译不可变合同；
- `AdmissionDecision` 是纯准入判断，服务端为最终权威，UI 折叠状态不影响结果；
- `ProviderAdapter` 只提交、查询和规范化响应，不决定付费重试；
- `TaskLedger` 原子记录 attempt、revision、task ID 和确定性；
- `RecoveryPolicy` 只根据证据决定查询、等待、阻断或重试；
- 工作台只编辑/校验/发布合同，不修改运行中任务；
- Canvas 节点不堆 Provider 特例；不创建万能脚本 DSL。

任何修复如果必须跨越上述边界，先把原因、替代方案和最小接口写入方案/checkpoint，再继续；不要停下来问普通实现选择。

八、测试和 Computer Use 纪律

普通开发使用项目 `.node-version` 和 packageManager；safe runner/release builder 使用项目冻结的 Node22/npm10 兼容通道。

测试只使用本轮新临时目录、动态 loopback、fake Provider/fake OSS、假 Prompt、假 URL 和脱敏 fixture。先跑最小直接相关测试；失败后只复跑失败 spec 或最小受影响集合。没有新相关代码变化，不重复已成功测试。

版本 A+B 冻结后，通过真实 Computer Use 在候选网站逐项重跑 `spec/MODEL_CONTRACT_001_USER_RECHECK_2026-08-26.md` 的 1～27 项。每项记录路径、输入、预期、实际、Network Provider POST 数、费用与截图；不能只凭 DOM 或代码推断网站通过。后台合同操作必须 Provider POST=0。

真实生成优先为0。fake Provider、既有任务和只读记录可以证明的，不得花钱。用户此前给出的本轮总费用上限为人民币20元；已有平台账本单位 `⚡2.182` 尚不能证明人民币换算。只有在能核验人民币单价、扣除已发生人民币费用后仍有余额、且 fake/既有证据无法完成关键门时，才允许最小真实生成。任一请求进入 outcome unknown，立即停止该 Provider 后续付费验收，继续完成所有不依赖工作；不得为了验收通过再次付费重提。

九、全量 Review

版本 A、版本 B 和候选浏览器验收全部冻结后，必须启动一个独立只读审查线程进行全量 Review，不得与实现并行。审查范围不只看 diff，至少覆盖：

- Provider 付费边界、幂等、unknown outcome、恢复和重复提交；
- task/attempt/revision 原子性、重启和发布/回滚漂移；
- GPT Image、GK、Mureka、Suno及其他专用 connector；
- 合同 schema/compiler/准入、秘密、SSRF、恶意合同、结果 ownership；
- 工作台的三态、CAS、本地校验、预览、官方文档、模式/角色；
- 四类节点、图片工具、旧 Canvas、模板和历史任务；
- UI/UX、四视口、窄屏、键盘、焦点和可访问性；
- schema、部署、备份、回滚与旧 runtime 兼容；
- 测试缺口和文档/实现漂移。

Review 发现 P0/P1 时，主线程直接修复并运行最小复验，再把同一冻结候选交回同一审查线程。只有 `P0=0 / P1=0 / GO` 才能运行本 Goal 唯一一次正式 safe full。全量 Review 和 safe full 是两种证据，不能互相冒充。

十、持续文档与防失忆

每完成 R0、版本 A、版本 B、Computer Use、Review 修复、safe full、PR/CI 中任一阶段，立即同步：

- `spec/MODEL_CONTRACT_001_CHECKPOINT.md`
- `spec/MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_PLAN_2026-08-27.md`
- `spec/MODEL_CONTRACT_001_USER_RECHECK_REMEDIATION_ACCEPTANCE_MATRIX_2026-08-27.md`
- `TASKS.md`
- `spec/UNBOUNDRY_CURRENT_STATE.md`
- `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md` 当前区块

checkpoint 每次必须记录：当前阶段、唯一下一动作、HEAD/tree/dirty 状态、改动范围、测试命令与 Node/npm、source/snapshot、Provider 请求/费用/OSS、Computer Use 项目、Review 结论、状态分层和硬 blocker。

上下文压缩、Session 恢复或长时间执行不是停止条件。恢复时重新读取本 Goal、AGENTS、CURRENT_STATE、checkpoint、remediation plan/matrix，然后只从唯一下一动作继续；不重复已完成且源码未变化的测试、Review 或付费请求。

十一、一次性授权边界

除最终生产发布门外，我一次性授权本 Goal 所需的：

- 项目代码、测试、fixture、OpenAPI、必要 schema、脚本、配置和权威文档修改；
- 保留并审查当前相关未提交改动；
- 必要的本地临时目录、动态端口、fake Provider/OSS和离线依赖安装；
- 本地 commit、fetch、push、创建/更新 PR、等待并修复 CI；
- 使用 Chrome/Computer Use 对本地或候选网站完成真实交互验收；
- 在费用门内且满足确定性条件的最小真实 Provider 验证；
- 候选冻结、版本号自动建议、发布和回滚方案准备。

不要询问普通方案选择、依赖安装、代码修改、测试失败修复、commit、push、PR、CI、候选版本号或 Computer Use 权限。版本号根据当前生产/package/origin/main/tag/Release 的最高正式版本自动建议同一版本线最小未占用 patch，并把证据写入 checkpoint。

本 Goal 明确不授权在最终门之前执行：PR merge、不可移动 tag、GitHub Release、SSH 生产写入、真实备份、schema 迁移、生产切换或生产回滚。完成其余全部工作后，只允许在这里停一次，提交一个合并授权请求；不要提前或分散询问。

十二、真正允许停止的硬阻塞

普通 bug、测试失败、CI 失败、代码选择、版本号和可修复文档冲突都不是停止条件。

只有以下情况允许在完成所有不依赖工作后停止并一次性报告：

1. 无法确认仓库/用户改动归属，继续会覆盖用户工作；
2. 受保护文件可能被触碰；
3. Provider 是否受理无法证明，继续会产生重复付费；
4. 缺少当前环境无法取得的登录、秘密或外部服务能力；
5. 必须超过人民币20元总预算；
6. 只能通过放宽 ownership、revision、credential、SSRF、秘密、数据或重复提交保护才能继续；
7. 独立 Review 仍有无法关闭的 P0/P1；
8. 数据恢复、schema 兼容或回滚门无法安全成立。

遇到硬阻塞时先完成所有其他工作、同步 checkpoint，最后只报告阻塞证据和唯一恢复动作，不得伪造通过。

十三、发布授权门交付

停在发布门时一次性给我：

1. 版本 A、B 的实际改动和架构边界；
2. 建议版本号、精确 commit/tree、分支、PR 和 CI；
3. 定向测试、唯一 safe full 的原始结果与未重复说明；
4. 全量 Review 轮次、发现、修复和最终 `P0=0 / P1=0 / GO`；
5. 27 项 Computer Use 的逐项结论、截图/网络证据与尚未能在生产证明的项目；
6. Provider 请求次数、attempt、真实生成、人民币费用或无法换算说明、OSS写入；
7. schema、备份、恢复、旧 runtime、停止新任务和回滚方案；
8. 未关闭外部 blocker和剩余风险；
9. 一条明确的最终授权语句供我回复，例如“允许按候选 X 发布并执行回滚门”。

在我明确允许发布后，再在同一 Goal 中连续完成 merge、tag、GitHub Release、生产备份/恢复演练、fresh tag build、原子切换、生产健康/数据/inventory/静态资源/浏览器技术验收和失败自动回切；不要重新创建 Goal。生产技术通过后仍保持 `USER_RECHECK`，只有我明确确认 27 项及成片质量后才能写 `USER_PASS`。
```
