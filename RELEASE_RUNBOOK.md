# Unboundry 版本发布 Runbook

更新日期：2026-09-11。当前授权与进度只看 [TASKS](TASKS.md)，产品现状看 [CURRENT_STATE](spec/UNBOUNDRY_CURRENT_STATE.md)。以下普通代码/构建发布流程与独立文档同步流程分别适用。

## 1. 识别范围和已有授权

- 先核对实际Git root、branch、HEAD、dirty范围、origin及live current指针、版本/schema；外层资料目录和历史app路径不能替代真实源码树。
- 版本与发布授权须明确。用户已明确委托自行增加patch时直接核对未占用版本，不再次索要版本确认。其他情况下按`上线规矩.md`补齐缺失范围。
- 发布包含已审方案中与该代码版本配套的必要schema迁移；代码、数据库版本、备份/恢复工具和回退能力须一起核对。用户已批准相应发布范围及已说明的影响后直接执行，不因涉及数据库而重复索要确认。若发现未覆盖的破坏性数据变更、额外停服或回退能力变化，先完成可审查准备，再仅确认新增影响。
- 发布授权不自动包含付费生成、历史数据/备份删除、无关数据修复或云权限变更；已有明确授权则在原范围内继续。
- 两份永久保护JSON不得读取、hash、复制、移动、修改、删除或暂存：`spec/public-templates-director-split-revision.json`、`spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json`。所有源码导出/检查使用显式排除。
- 纯模板数据发布走`上线规矩.md`轻量路径；纯文档同步按下节发布独立文档镜像，不替换产品构建或 bump 产品版本。

当前发布身份、迁移、备份与验证状态统一从 [CURRENT_STATE](spec/UNBOUNDRY_CURRENT_STATE.md) 路由到对应回执；旧版本回执只作历史证据，当前回退约束见第6节。每日自动备份仍USER_DEFERRED，不以手动发布备份代替该项验收。

## 独立文档同步

同步前先对齐事实：按受影响条目核对实际代码、配置、已有有效测试、运行观测和用户验收，再更新拥有该事实的文档，复核后才进入以下流程。无法确认的内容明确写“待核实”或“未验证”；历史记录保留当时范围，其他说明链接当前事实来源，不另存一份待办状态。文件哈希一致只证明复制一致，不能代替内容与项目现状相符的检查。

1. 用户授权推送和同步后，将治理入口及其现行文档依赖提交到 GitHub；保留产品代码与数据。PR 最终 head 和合并后的 main 均通过现有 CI，其中 m38 检查治理入口。
2. 从通过 CI 的精确 main 提交枚举并导出已跟踪 Markdown、文档索引/回执、治理测试与 CI 配置；先按路径排除两份永久保护 JSON。不要复制 dirty 工作树、凭据、真实数据、依赖或本地日志。
3. 在服务器 `/opt/unboundry/governance/releases/<文档提交SHA>` 新目录准备私有镜像；生成 `.governance-manifest.json`，记录提交、文件清单和 SHA-256。校验完整后原子切换 `governance/current`；保留上一镜像用于文档回退。
4. `/opt/unboundry/AGENTS.md` 使用 [服务器导航源](ops/production/GOVERNANCE_AGENT_ENTRY.md)，进入当前镜像。镜像不进 Nginx/应用静态目录，不提供公网文档页；不改 `/opt/unboundry/current`、产品 release、数据库或服务。
5. 比较 Git 提交、本地对应文件及服务器镜像哈希；核对产品版本、current、PID/restarts 前后不变。这里的健康检查只证明文档同步没有改变进程状态，不替代产品行为验收。收尾文档有新提交时再同步该提交并核验；不因此重启产品或触发付费生成。

## 2. 本地候选和最小必要验证

1. package/lock与`server/bridgeRuntimeMode.ts`精确版本准入一致；不要移动既有tag，普通版本不加hotfix。
2. 列出实际行为变更、直接依赖和失败代价，选择受影响safe specs；用本轮合成数据和动态loopback，不碰4173、本地app/data、真实Provider或OSS。
3. 普通类型/构建默认Node25.9.0/npm11.12.1；safe runner和source coverage专用Node22.23.1/npm10.9.8；生产Node22.23.2/npm10.9.8，不能混同。
4. 成功测试只在相关代码变化、明确失败或强制发布门时重跑。文档更新只检查文档，不重跑业务full。风险跨域且发布门确需full时按当次计划执行，不能继承或复活旧Goal的full权限。
5. 冻结产品候选并审查实际增量；区分主代理审查与独立审查。UI变化先让用户验收可见本地候选；通过后复核候选未漂移。
6. 新增持久字段须验证旧节点读取、旧客户端命令、刷新、撤销、并发与回退包兼容。schema号未变并不证明旧包可读新字段。

## 3. GitHub和不可变身份

获当次发布授权后，显式文件清单commit/push → PR的最终head CI通过 → 合并 → main CI通过 → annotated tag指向精确merge → GitHub Release。

当前CI源码为`.github/workflows/quality-gates.yml`：两个job均完整checkout历史与tag（safe runner校验精确v0.5.1基线），macOS15；Node25类型/架构/build、`npm audit --audit-level=high`；随后Node22 safe preflight、ffprobe准备、m104真实HTTP/fake Provider集成、源码覆盖及其行为检查；新增独立Node22备份/运行锁合成检查（m10/m93）；进入离线safe runner前，在RUNNER_TEMP预热精确v0.5.1旧lock依赖，安装禁用scripts。中等级告警不会使high阈值失败，CI绿色不等于依赖无告警或真实付费验收通过。

记录PR、branch/main CI run、tag object、peeled commit/tree和Release。已发布tag和产品构建不可改写；后续验收文档记录用自己的提交身份，不将文档HEAD冒充生产产品commit。

## 4. 从精确tag构建新目录

- 从已通过main CI的精确tag，用排除受保护路径的allowlist导出源码，落到全新staging目录；不上传脏工作树或复用旧dist。
- 在该目录按lock安装并用自身源码构建，核对Node/npm、源码清单不变、构建完整性。v0.7.14记录为921源码文件与33静态资源；这些是该次分母，下次须重新枚举。
- 使用NUL分隔文件名制作清单，排除清单自身和永久保护路径；校验源码身份和完整静态资产，不能只看一个JS文件。
- `scripts/deploy.mjs`已立即抛`LEGACY_DEPLOY_DISABLED`，不得执行旧rsync一键上线流程。
- `scripts/build-release.mjs`、`lib/release-source-pair.mjs`及配对演练工具绑定历史0.5.2/0.6.0合同，不是任意patch发布器；不要为了新版本改写历史工具。

## 5. 与来源schema配套的备份门

普通备份使用不可变release内`backup-data.mjs` → `verify-backup.mjs` → `restore-backup.mjs`合同。正式切换前最新快照须持有真实冻结/静默证据并满足locked-exact或已审的第5.1节独立保全模式；已有故障使这些模式明确拒绝时，只可按第5.3节完成独立事故保全的全部发布门。必须显式绑定来源schema、logical SHA、冻结时间、last Provider admission、独立scratch、外置签名/恢复key路径及精确媒体策略。跨schema发布在迁移前后分别备份、verify和fresh restore；旧来源及目标schema必须由当次精确工具明确支持，不能让代码先启动后隐式迁移。

必须先核对当前活动任务、计费结果不明边界和publication，不伪造冻结时间或为通过门清理历史终态记录。备份不通过就不切换。`--external-freeze-non-final`不能冒充final candidate；schema42仅历史恢复，不能作为当前验收schema。

- 私钥内容不得输出或进仓库；新恢复目录私有且独立，不能覆盖CURRENT。
- verify通过后fresh restore，再核对该备份来源schema、integrity、FK、logical SHA及计数/媒体/secret清单。日志模式包含实际生产DELETE，不能只测WAL。
- 允许的历史媒体 warning 精确列入证据，不能写成“无媒体问题”；历史 v0.7.16 的非阻断提示和本次最终媒体计数以对应发布回执为准。
- 真实云上传只在已授权范围进行，上传后需要GET哈希/大小核验，PUT成功本身不等于可恢复。
- `ops/production/backup-to-oss-retention.mjs`只接受普通locked-exact模式；结果未知任务走第5.1节精确quiesced备份CLI和独立已审上传器。该wrapper自身不自动完成verify/fresh restore/远端GET闭环，需要操作方案分别补齐。
- **当前自动备份故障尚未修好**：systemd仍调用`/opt/unboundry/scripts/backup-to-oss.mjs`，其旧子脚本要求schema41。不得把它作为当前备份入口。更不能仅因应用已升级就宣称每日备份生效。

### 5.1 经当次授权的停服保全备份

v0.7.17于2026-09-09首次经当次授权使用`quiesced-active-preservation`，该历史授权已消费。v0.7.18/schema44 本次使用的精确来源、任务范围和保全证据以当前发布回执为准。此方式保留结果未知的旧请求及防重复提交证据，不把它改成成功、失败、取消或无扣费。`locked-exact`的原有静默要求和`external-unverified`非最终性质保持；不能通过改旧记录或改readiness计数满足门。

只有以下证据全部成立，当前发布才可接受该独立captureMode：

1. 新生成已由真实管理员审计冻结，冻结时间与最后Provider准入匹配并经过至少60秒；无活动工作流和未完成媒体发布。
2. 已排空并停止旧应用，验证原进程身份确实退出；从精确既有runtime目录取得同一active lease，拒绝缺失、路径偏移、活进程或租约竞争。备份进程保持draining，不启动HTTP或生成worker；租约、secret锁、SQLite锁按既定顺序覆盖采集。
3. 使用当次明确允许的task ID、attempt身份及完整task/attempt/events摘要。其他活动任务、摘要变化或未列明边界使备份失败；保留全部原始记录及原请求标记，不进行解锁、重试、删改。
4. 签名加密清单记录该独立模式和保全证据，精确来源schema、logical SHA、媒体与secret验证严格不减。`finalCandidate`不伪装成现有locked-exact的true；发布操作依据本节授权及完整保全证据单独准入。
5. 新包verify及独立fresh restore验证原始账本摘要、schema、完整性、FK、素材及secret一致。精确新→兼容回退包→新完整安装包演练验证原记录、画布及防重复提交保护；开关关闭的演练只能证明相应关闭范围，不扩大成正常开启自动恢复或付费生成证明。
6. 实现和本次操作脚本经独立复审。实际操作失败保留原数据、已存在备份和旧包；未完成恢复门不得切换。维护状态及恢复服务的处理按本次已核验操作单执行。

冻结等待期间只允许非目标历史任务推进状态并追加查询事件；所有任务的身份、输入与Provider证据及既有事件前缀必须保持，禁止改写或删掉旧事件。目标未知task/attempt及其全部事件摘要保持一致，其他业务表和媒体/secret保持。停服前重新采集完整快照；停服、备份和新进程启动后逐表核对，不豁免生成表。

该模式的verify/restore使用支持本次精确schema和备份格式的不可变包内工具；产品回退时也保留该工具和密钥路径，不使用旧版解析器冒充新格式恢复。回退只切代码，绝不把备份还原覆盖CURRENT。

该规则不授权删除未知请求、付费重发或修复每日备份。每次保全必须重新绑定当前精确数据、任务范围、进程/租约和构建身份，不复用过期停服证明。具体实施状态和当次授权由TASKS维护，最终实测由本次发布回执维护。

### 5.2 schema43→44发布的保全与兼容回退

本节约束 v0.7.18/schema43→44 配套发布，执行授权与进度由TASKS维护。本次 schema43→44 dry-run/apply 及迁移后 schema44 backup/verify/fresh restore 已有实际阶段回执；生产程序切换、资源核对、解除维护和用户验收仍只能按最终发布回执确认，不能把方案或本地通过写成这些阶段已完成。迁移前须通过精确新包Linux隔离演练、操作脚本独立复审及最新schema43备份/verify/fresh restore；迁移后须完成schema44备份/verify/fresh restore再启动新应用。

- schema44 当前候选必须通过 `schema43To44Migration` 的原子迁移、integrity/FK、结构合同、logical SHA、全账本和媒体关联核对。迁移只增加输出槽、保存租约、adoption receipt、continuation 表及其约束；不把未知结果改成终态，不删除事件/素材，不调用 Provider/OSS。
- schema44 的 quiesced-active-preservation 备份可以保留旧 schema43 或当前 schema44 的明确来源版本。verify/fresh restore 必须保留 `media_publication_attempts` 的旧 nullable 槽、新槽记录、`generation_result_save_leases`、`generation_result_adoptions`、`workflow_run_continuations` 以及 outcome-unknown 账本，恢复后重新执行 FK、integrity、logical SHA 和媒体清单核对。
- 兼容回退包是独立的只读维护桥接包，目录只包含 `preservation-manifest.json`、`maintenance.html` 和 `schema44-readonly-preservation-runtime.mjs`。它绑定原 CURRENT 数据目录的路径、数据库身份、数据库/媒体 SHA 和自身运行文件 SHA；不复制数据库、媒体、secret，也不导入应用 bootstrap。
- 维护桥接进程以原 CURRENT 为唯一数据源，只读打开 schema44 数据库。维护页可读；`/health`、`/api/health`、`/results`、媒体、认证及所有 POST/写路由统一返回 503，不暴露任务或账本内容。桥接进程退出后，CURRENT 数据 SHA 和账本快照必须完全一致。
- 回退禁止 schema44→43 数据库降级、覆盖 CURRENT 或用 schema43 旧解析器打开新表。回退演练只切换代码指针：先停止新应用并保留 CURRENT，再运行只读桥接，确认维护状态，最后启动 schema44 新应用正常 worker；若新应用恢复 staged 结果，只允许使用已有持久证据完成本地保存，不产生第二次 Provider POST。
- 独立演练必须按“新应用 worker 启动并停止 → 同一 CURRENT 运行只读桥接 → 桥接停止 → 同一 CURRENT 启动新应用 worker”顺序执行，至少核验一个 staged synthetic 结果自动恢复，同时核验 Canvas 草稿、媒体、publication 槽、lease、adoption、continuation 和 outcome-unknown 账本保持约束；Provider POST 计数必须为零。

本节对应 `m110-schema44-readonly-preservation` 和独立桥接脚本。每次新应用运行并停服后均须重新绑定最新CURRENT与桥接manifest；桥接失败保持静态维护，禁止启动schema43应用。当前生产是否已完成新包启动及公网切换，由 CURRENT_STATE 指向的当次实际回执确认；本地测试和历史迁移回执不能替代本次真实systemd切换或真实Provider验收。

### 5.3 同schema补丁的事故现场保全

适用于当次已授权的同schema修复：真实未完成工作流、下载半成品或compensating记录使普通备份与5.1模式拒绝，而修复前必须保留完整现场。不修改任务终态、删除半成品或降低普通媒体校验来过门；不把损坏或未完成素材标为ready。不适用于跨schema迁移或自动备份。

使用独立格式与`captureMode=incident-active-preservation`，明确`finalCandidate=false`，不得冒充普通备份。以下条件全部通过，才可把本次独立保全包及其完整验证证据作为发布前备份依据；单独完成打包、签名或解密均不构成上线准入：

1. 当次操作单绑定精确current、候选提交/包、来源schema、原数据路径和全部允许的活动task/attempt/workflow/publication/slot；既有未知计费任务也逐个列明。任何额外活动链或原请求身份变化均停止，禁止新增Provider请求来验证。
2. 管理员审计冻结新准入并等待至少60秒；维护隔离、旧PID/startTicks退出及原监听消失均可核验。持有原runtime active lease并保持draining，随后按secret锁、数据库写锁的顺序覆盖全部采集；不能复用过期停服证明。若应用已停止且旧记录缺失startTicks，禁止编造或重新启动旧应用补采；仅事故保全可使用经当次独立复审的`already-stopped`证明：绑定真实最后应用PID与既有启动/失败停服回执，重新核验服务inactive、MainPID=0、cgroup为空、原监听关闭、最后PID不存在、PID命名空间和当前只读桥/数据身份，随后取得同一既有runtime独占租约并持有至恢复核验结束；前后重新检查停服状态。该证明须明确缺失的历史字段及替代证据，不冒充原PID/startTicks证明，不改变普通备份的拒绝条件。
3. 原样保全完整数据库、library数据库、媒体树（包括隐藏的下载半成品）、密钥及加密配置；ready OSS素材须逐项完整镜像，以精确profile/objectKey/版本/字节数/哈希绑定到签名清单，单独恢复核验，不能把仅本地文件树当全部素材；拒绝路径别名、软链接、特殊文件和采集中变化。来源schema、integrity/FK、logical SHA、全表与全文件摘要、secret与数据库配置对齐均验证；事故媒体单独标记其真实状态，不运行会改写状态的普通恢复流程。
4. 使用AES-256-GCM、RSA-OAEP-SHA256及独立Ed25519签名，域分隔的签名覆盖格式、现场身份与全部文件清单。外置恢复/签名密钥不进代码仓库或日志。密文包、恢复目录和证据私有且不覆盖已存在目录；拒绝额外文件、缺失、篡改和路径逃逸。
5. 全新scratch中验签、解密并逐文件核对，与来源的完整数据库/账本/媒体/半成品/secret摘要一致；保持事故状态而不启动生成。生产CURRENT不得作为恢复目标。全部云端备份对象使用私有、唯一键、禁止覆盖上传，逐对象GET核对完整大小和SHA，清单也核对。
6. 精确新包在独立Linux环境完成新→当前schema只读维护桥→新演练，保留同一数据目录与原未知请求保护。生产实际切换前，独立代码复审、备份恢复和回退证据必须全部通过。普通备份CLI、locked-exact及5.1的拒绝条件保持原样。

失败即不切换并保留现场、已生成备份和旧包。维护中的服务恢复按当次已验证的同schema代码路径处理，不能倒灌备份覆盖CURRENT。上线后仍须观察原任务的正常恢复；事故保全成功不代表生成已恢复。精确实施和实测结果由当前TASKS及本次回执拥有，本节不是操作已完成的证明。

## 6. 切换与回退

先准备本次精确新包、精确兼容回退包及数据保持策略，在隔离副本完成真实Linux HTTP保存/刷新和forward→rollback→forward；记录其与真实systemd切换测试的区别。正式维护中保留旧current身份，排空再原子切换；核对服务、版本、ready、数据及静态资源后解除维护。

当前schema44回退约束：

- 当前应用包及精确 commit/tree、操作单、备份/恢复和脚本 SHA，由 CURRENT_STATE 指向的当次实际回执拥有；v0.7.18 仅记录数据库进入 schema44 的历史迁移来源。不能从旧版本段落选取当前包。
- 当前回退路径是代码层回到 schema44 只读维护桥：停止当前应用，保留 CURRENT 和 schema44 数据，按当次最新停服数据重新生成并绑定 `schema44-preservation-<label>` 桥接包，由 `unboundry-schema44-readonly-bridge.service` 提供维护页；每次新应用停服后都要重新绑定最新数据库/媒体 manifest。桥接包只读，不运行 worker、不调用 Provider/OSS、不接收 POST/写请求。
- 生产桥接回退是否已经实际执行，必须由本次回执中的 `bridge-rollback-complete.json` 及公网/服务核验确认；本手册不预写该事实。桥接重绑或启动失败时继续保持静态维护，不能启动旧 schema43 应用。
- 禁止 schema44→43 数据库降级、把备份还原覆盖 CURRENT，或让 v0.7.17 直接打开 schema44。恢复正常服务只能启动支持 schema44 的新应用，并重新核验数据与服务状态；旧未知任务和已有媒体不得借回退改写。

历史 v0.7.17→v0.7.16 普通代码回退（不适用于当前 schema44）：

- `/opt/unboundry/releases/v0.7.17-node-recovery-20260908` 与 `/opt/unboundry/releases/v0.7.16-status-query-20260907` 只保留为上一轮 schema43 的历史身份和证据。它们不能作为当前 schema44 的在线回退候选，除非另有明确的 schema44 兼容性证据。
- 旧 RB05 隔离 Linux 新→旧→新、此前 systemd 补偿和 v0.7.16→v0.7.15 DELETE 演练均不替代本次 schema44 桥接路径或 v0.7.18 正式回执。禁止跳过当前已核验候选切更老包；旧 v0.7.13 parser/resize 语义不兼容，v0.7.11 代码检查点也不是数据库备份。

### 历史 v0.7.14 兼容约束（非当前回退身份）

- `v0.7.14-compat.1-media-aspect-20260906` 及 `/var/lib/unboundry-v0714-media-aspect-20260906/evidence/rollback.py` 只记录上一轮的兼容方案和证据；执行任何回退前仍须按当前版本重新核对身份、授权和数据门。
- 其中“保留新字段解析和 manual 保护、关闭当时的 auto 适配/主动按钮/临时置前”是 v0.7.14 当时的历史约束，不是 v0.7.15 的新产品要求。

## 7. 发布后验证

1. current精确指针、`/api/version`、`/api/health/live`与`ready`、service/PID/restarts、schema与当前数据保持；ready只证明进程/只读探针。
2. 首页引用与其他静态资产全部在公网和loopback逐项匹配构建清单。
3. 用既有素材或已授权合成上传核对实际受影响界面，观察保存/刷新/重新打开与写请求次数；查看和刷新不得产生额外Canvas写或Generation POST。
4. 真实生成仅在单独明确授权后进行，不能照抄v0.7.7旧group点击；结果不明不自动重复提交。
5. 更新提示须单独记录：v0.7.14维护期间旧EventSource遇502未恢复，人工刷新通过。不要把m82正常SSE测试当故障重连验收。

## 8. 收尾

生产回执分别记录源码/CI、定向或full范围、备份/恢复/云端验证、生产数据和UI、未决风险、用户验收；本轮最终状态与回执入口见 [CURRENT_STATE](spec/UNBOUNDRY_CURRENT_STATE.md)，旧版本回执保留为历史。先是技术结果，只有用户明确通过才记对应范围USER_PASS。

更新CURRENT_STATE、TASKS、主题checkpoint、总矩阵及必要架构/操作文档。固定历史JSON、失败记录和tag不改写；演进中的当前回执补上后续验收事实。文档是否commit/push按用户当次授权，不能把旧发布授权扩为永久权限。

仅清理当次已获授权且确认身份的临时副本；保留用户数据与必要回退/恢复材料。不要为了收尾再部署、重复测试、真实生成或清空历史未决项。
