# INC-GEN-017 新Session一次性实施 Goal 提示词

状态：`COPYABLE_GOAL_PROMPT / NOT_STARTED / NOT_CURRENT_SESSION_AUTHORIZATION`

使用方法：在新的 Codex Session 中完整复制下面代码块。只有用户在新Session实际发送后，才启动该Goal；本文件的存在本身不授权当前Session实施。

```text
/goal

你现在开始执行 Unboundry 的 INC-GEN-017「工作流自动自愈与模型合同隔离」。这是一次性连续实施 Goal。不得只分析、只写计划或只修截图中的单点；必须严格由冻结文档驱动，完成代码、测试、逐代码Review、GitHub、可回滚生产发布、最小真实Provider技术验收和最终手工验收清单。

一、项目身份与第一步

1. 规划文档所在工作树：
   /Users/mymy/Documents/unboundry-inc-gen-016-v0.6.56-2026-08-28
2. 进入后先完整读取仓库根AGENTS.md，并服从其中所有安全测试、受保护文件、工具链和发布规则。
3. 然后严格按以下顺序完整读取，不得只读摘要：
   - 上线规矩.md
   - spec/UNBOUNDRY_CURRENT_STATE.md
   - README.md
   - spec/INC_GEN_017_CHECKPOINT.md
   - spec/INC_GEN_017_WORKFLOW_SELF_HEALING_AND_MODEL_CONTRACT_ISOLATION_PLAN_2026-08-28.md
   - spec/INC_GEN_017_ACCEPTANCE_MATRIX_2026-08-28.md
   - spec/INC_GEN_017_ONE_SHOT_GOAL_PROMPT_2026-08-28.md
   - spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_CHECKPOINT.md
   - spec/INC_GEN_016_AUTOMATIC_PROVIDER_RESULT_RECOVERY_PLAN_2026-08-27.md
   - spec/MODEL_CONTRACT_002_CHECKPOINT.md
   - TASKS.md 当前区块
   - spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md 当前区块
4. 只读核对pwd、Git root、所有worktree、branch、HEAD、origin/main、status、package/schema、Node/npm、当前线上版本和最新生产回执。不得仅凭目录名识别仓库。
5. 当前规划基线记录为生产v0.6.56/schema41、产品实现NOT_STARTED。实施时以实时核验为准；若origin/main前进，自动把冻结文档完整带到基于最新origin/main的新隔离分支/工作树，解决普通冲突并重新执行R0，不要询问我。
6. 预期规划工作树只含INC-GEN-017及权威路由文档改动；全部保留。禁止读取、修改、暂存、移动或删除spec/public-templates-director-split-revision.json。
7. 默认分支名：codex/inc-gen-017-workflow-self-healing-2026-08-28；如已存在，使用同前缀加不会冲突的日期时间后缀，不要询问。

二、唯一目标

用户上传素材并点击一次整组生成后，系统必须自行完成预检、无损输入规范化、提交、轮询、断线/刷新恢复、明确安全重试、后继节点继续、结果资产保存和原节点回填。普通用户不得进入Provider平台、复制任务号、点击人工核对、依赖任务面板继续或到别处寻找正常结果。可恢复过程中不得连续弹红错；一个恢复状态、静默成功、不可恢复终态最多一次项目内说明。

必须同时完成：

1. checkpoint/lease/lock/summary按account+canvas+group+run隔离；不重叠组互不阻塞。
2. localStorage checkpoint降为缓存；缓存缺失/损坏时从Canvas任务绑定和服务端task/attempt重建。
3. accepted原任务永不重复POST；snapshot一致才继续旧pending，snapshot变化自动收口旧run并按当前图建立新run。
4. Seedance 2.0 Mini的text、first-last-frame、multimodal全能参考及图片/视频/音频角色正确；模型、模式、edge角色用Canvas级事务原子切换。
5. 共享纯语义compiler、CanvasModelTransitionCommand、ProviderRequestCompiler/Adapter三层隔离；不得形成新的万能模块。
6. Grok当前只开放已有精确证据的纯文字与单首帧；不得猜测扩张reference-image/subject。
7. Mureka本事件固定outputCount=1；UI/API/task/adapter/result全部一致，不实现半成品多结果。
8. 实施时全部published模型先建立显式adapter registry和零Provider shadow一致证据，再关闭未来新模型的通用兜底；历史revision和在途任务继续可执行。
9. 从实时published快照动态生成N×N模型切换矩阵；当前全部模型逐一有schema→compiler→adapter→result/recovery证据，未来新增模型自动进入。
10. Provider成功结果优先自动回到原节点；任务中心/素材库只作项目内部安全副本，不是用户必经步骤。

三、冻结产品决策，不得中途再问

1. 严格实施Plan的SHC-01～27、R0～R8、46项Matrix和25项NO-GO硬门。
2. 发现普通实现细节时，由你选择最简单、可靠且不削弱安全合同的方案，不要问我。
3. 不静默删除素材/边、不改变输入顺序、不改Prompt、不跨模型/跨Provider兜底、不绕过内容审核。
4. 内容拒绝、余额/权限/订阅不足或缺少不可替代素材属于不可恢复终态：只终止受影响分支，保留其他结果并显示一次项目内说明；继续完成所有不依赖分支，不要停下来问我。
5. 页面打开时工作流自动跑完；刷新或断网重连后自动继续，无需再次点击。Provider已受理任务关页后继续由服务端收片；未提交的下游在再次打开项目时自动继续。本Goal不复制第二套服务端DAG执行器。
6. 当前没有必要为了本事件重写React Flow、拆微服务、批量改历史Canvas或重做无关UI。

四、一次性权限已全部提前授予

本Goal明确授权以下动作，不得中途再询问版本号、commit、GitHub、测试、发布、生产或真实验收权限：

1. 修改必要的产品代码、测试、脚本、配置、schema迁移、文档、package和lock文件。
2. 创建/切换本地分支和隔离worktree，安装锁文件内依赖，运行格式化、类型检查、构建、动态loopback/fake Provider/OSS测试和安全测试。
3. 创建本地checkpoint/功能/候选commit；候选通过后push、创建PR、等待并修复CI、合并、选择实施时高于线上且未占用的最低patch版本、更新package/lock/runtime版本、创建不可移动annotated tag和GitHub Release。
4. 通过SSH只读核对生产；执行必要的静默门、完整备份、恢复副本演练、schema迁移演练、原子切换、健康/数据/静态资源验证和必要回滚/前滚。
5. 允许在完整备份、恢复演练、旧runtime拒绝门和回滚门通过后执行本Goal必需的生产schema迁移；不得删除用户数据、历史任务、媒体、备份或旧release。
6. 允许为本Goal做最小真实Provider技术验收和对应生成结果OSS写入，总新增真实Provider费用硬上限USD100。只消费证明改动所需的最少请求，不以花完预算为目标。
7. 真实验收优先使用新建的专用验收Canvas或对失败工作流的安全副本；如必须使用Canvas 00712d81-c197-4339-a119-8042b564076b，先冻结graph/revision/task/media基线，只允许增加本Goal预期task/result和精确运行字段，不删除或覆盖用户素材、Prompt、节点、边或历史结果。
8. 允许最小必要Provider凭证验证和既有配置读取；禁止输出密钥、购买订阅、修改云IAM/权限或创建与本Goal无关的外部资源。
9. 上述授权均为本Goal一次性授权；完成或BLOCKED后自动消费完毕，不得延伸到未来任务。

五、永远不能因“全部授权”放松的红线

1. OUTCOME_UNKNOWN_BILLING_RISK或任何无法证明未受理的请求永远禁止第二次Provider POST；只能恢复/查询原任务。
2. 只有Provider明确未受理或明确退款，且持久retrySafetyDecision允许时，才可最多自动新提交1次。
3. 不读取真实密钥内容，不把Authorization/Cookie/Prompt/签名URL/原媒体写入日志或证据。
4. 不运行测试到4173、app/data、/var/lib/unboundry或真实媒体；只用安全runner、系统临时目录、动态loopback和fake数据。
5. 不git reset --hard、不git clean、不覆盖用户改动；不移动历史tag，不删除备份、旧release、用户数据或OSS对象。
6. 不读取、修改、暂存、移动或删除受保护spec/public-templates-director-split-revision.json。
7. 不绕过审核、权限、SSRF、owner、run/task/ownership/node/kind/revision、credential lease、CAS、费用和原子publication安全门。

六、文档驱动和防失忆协议

1. 本Goal的事实优先级：本条最新Goal消息 > AGENTS.md > UNBOUNDRY_CURRENT_STATE > INC_GEN_017_CHECKPOINT > Final Plan > Matrix > 当前代码/测试证据 > 历史文档/聊天摘要。
2. R0开始前把实际branch/HEAD/package/schema/生产/模型清单/授权预算写入INC_GEN_017_CHECKPOINT。
3. 每完成R0～R8一阶段，立即更新Checkpoint、Matrix、TASKS和CURRENT_STATE：记录代码范围、测试命令、环境、通过/失败数、source hash、Provider POST/费用、下一阶段和停止条件。
4. 上下文接近上限时先更新Checkpoint，再继续；压缩后必须重新读取Checkpoint、Plan和Matrix，不得凭记忆重开旧步骤、重复full或重复Provider请求。
5. AUTO_PASS、TARGETED_AUTO_PASS、FINAL_REVIEW_GO、PRODUCTION_TECHNICAL_PASS、REAL_PROVIDER_PASS、USER_RECHECK和USER_PASS严格分开；没有我的最终实页确认不得写USER_PASS。

七、实施与验证顺序

1. R0：最新基线、实时published模型、生产和预期红；不得先写代码再补证据。
2. R1：先关闭工作流卡死、checkpoint重建、snapshot续作和通知风暴。
3. R2：建立共享纯语义compiler与Canvas真原子命令。
4. R3：确定性修复Seedance；收紧Grok；Mureka单结果收口。
5. R4：全部当前模型显式registry、旧/新零Provider shadow、服务端发布门和两个临时V2止损开关。
6. R5：全部published模型、动态N×N、旧Canvas/任务/revision和未来假模型矩阵。
7. R6：刷新、崩溃、存储失败、202、响应丢失、taskId已存、投影冲突、退款、unknown、双击、跨组并发、30次轮询通知去重故障注入。
8. R7：本地/预发布真实规模三组浏览器验收。
9. 冻结候选后完成第八节的逐代码Review；Review GO后才运行一次正式safe full。
10. GitHub/CI、不可变版本、fresh build、生产备份恢复迁移、原子发布、回滚和稳定门。
11. 最小真实Provider验收；任何unknown立即停止该Provider的新POST但继续所有不依赖工作。
12. 最终同步Plan/Matrix/Checkpoint/TASKS/CURRENT_STATE/回执，给我简单中文结果和手工验收清单。

八、我要求的全量Review/复检

这里的“全量”不是泛泛跑一次测试，也不是扫描无关文案。候选冻结后必须进行一次独立、只读、逐代码Review：

1. 列出本Goal全部改动文件；逐文件、逐diff hunk、逐关键条件和错误分支复检，不得抽样。
2. 沿以下完整调用链逐文件复检所有相关代码，不只看diff：
   Canvas模型/模式切换 → semantic compiler → graph transaction/undo/save → workflow admission → checkpoint/cache reconstruction → lease/lock → preflight → task admission → revision/compiler → adapter submit/poll/recover → result asset → Canvas projection → notification/UI。
3. 对每个当前published模型逐一核对schema、mode、roles、数量、参数、connector、request、task/result、错误、费用和恢复；不得以“同类模型”抽样代替。
4. 全仓搜索并逐项解释新增/残留的providerModelId/providerDriver/providerProtocol/inputMode/inputRole/specialized-code/outputCount判断，确认没有模型专属逻辑散落、串用或通用兜底逃逸。
5. 复检所有状态写入和清理：runId、taskId、ownershipKey、inputFingerprint、semantic revision、attempt、credential lease、result identity、Canvas revision和applicationId；确认一个run不能清另一个run。
6. 复检所有失败/重试分支的Provider POST、attempt、费用、taskId、结果资产和通知数量；unknown必须0新POST，30次恢复轮询普通UI最多1个中性状态。
7. 复检旧Canvas、旧checkpoint、旧任务、历史revision、归档模型、回滚runtime和新模型发布；不允许只证明新Canvas。
8. 独立Review只在候选冻结后开始，可使用最多2个只读审查agent分工；主agent必须逐条复核并汇总。Review期间不得边审边改；发现P0/P1先退回实施，最小修复和定向验证后由同一审查上下文复核。
9. Review最终必须给出逐文件覆盖清单、完整相关调用链覆盖清单、模型分母、测试分母、未覆盖项、P0/P1/P2和GO/NO-GO。P0或P1不为0不得进入唯一safe full、GitHub或生产。

九、测试和验收门

1. 先新增精确预期红，再实施，再跑最小直接依赖；失败只复验失败集。
2. 使用node scripts/run-safe-tests.mjs。候选冻结和Review GO后，由于本Goal修改共享工作流/模型合同，必须运行一次且仅一次正式safe full；如full有失败，诚实保留原始结果，按最小失败集修复/复验，不重复full。
3. 必须完整关闭Matrix IG17-001～046；自动证据不得冒充真实Provider或用户验收。
4. 发布前全部25项NO-GO硬门必须通过。
5. 真实生产验收至少证明：
   - Seedance 2.0 Mini全能参考可接入计划内图片/视频/音频组合，零角色错误，结果自动回原节点并刷新保持；
   - 一组遇到可恢复故障时自己恢复且不堆红错，同画布不重叠组不被阻塞；
   - checkpoint损坏/缺失能从权威任务重建；
   - Grok未证明模式不可选，Mureka不能选2/3；
   - 其他全部published模型的选择、预检、请求合同和历史恢复没有回归；
   - 普通用户页面没有外部平台、任务号输入或人工核对步骤。
6. 最终只可写PRODUCTION_TECHNICAL_PASS / REAL_PROVIDER_PASS / USER_RECHECK；我观看生产实页并明确回复通过后，才能另行同步USER_PASS。

十、连续执行和停止规则

1. 除真实身份无法建立、不可恢复的数据销毁风险、法律/审核禁止、Provider外部永久不可用或USD100预算耗尽外，不得中途停下来向我询问权限、版本号、是否commit、是否push、是否PR、是否发布、是否迁移、是否真实验收或普通实现选择。
2. 遇到一个外部Provider/模型阻塞时，记录证据并继续所有不依赖分支；不得因此暂停整个Goal。
3. 对临时错误使用文档冻结的有界退避；不得无限重试、不得用重复full获得安心、不得用第二付费POST绕过unknown。
4. 只有全部技术目标完成，或同一真实阻塞满足Goal工具规定的blocked条件时，才结束Goal。
5. 最终回复必须先给结论，再给：实现结果、逐代码Review结论、测试原始结果、全部模型覆盖、真实Provider请求/费用、生产/回滚状态、未完成项、用户五步手工验收。不得用长篇过程掩盖结果。

现在开始。先读取文档、核对身份、创建/更新Goal和Checkpoint，然后持续执行到上述终态；不要再向我询问任何已在本提示词提前授权的事项。
```
