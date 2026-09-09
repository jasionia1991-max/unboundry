# Unboundry 版本发布 Runbook

更新日期：2026-09-09。当前授权与进度只看 [TASKS](TASKS.md)，产品现状看 [CURRENT_STATE](spec/UNBOUNDRY_CURRENT_STATE.md)。以下普通代码/构建发布流程与独立文档同步流程分别适用。

## 1. 识别范围和已有授权

- 先核对实际Git root、branch、HEAD、dirty范围、origin及live current指针、版本/schema；外层资料目录和历史app路径不能替代真实源码树。
- 版本与发布授权须明确。用户已明确委托自行增加patch时直接核对未占用版本，不再次索要版本确认。其他情况下按`上线规矩.md`补齐缺失范围。
- 发布授权不自动包含付费生成、历史数据/备份删除、schema迁移或云权限变更；已有明确授权则在原范围内继续，不重复确认。
- 两份永久保护JSON不得读取、hash、复制、移动、修改、删除或暂存：`spec/public-templates-director-split-revision.json`、`spec/INC_GEN_017_R0_PUBLISHED_MODEL_SNAPSHOT_2026-08-28.json`。所有源码导出/检查使用显式排除。
- 纯模板数据发布走`上线规矩.md`轻量路径；纯文档同步按下节发布独立文档镜像，不替换产品构建或 bump 产品版本。

当前发布身份、备份与验证状态统一见 [v0.7.16发布回执](spec/V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json)；当前回退约束见第6节。每日自动备份仍USER_DEFERRED，不以手动发布备份代替该项验收。

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

当前CI源码为`.github/workflows/quality-gates.yml`：两个job均完整checkout历史与tag（safe runner校验精确v0.5.1基线），macOS15；Node25类型/架构/build、`npm audit --audit-level=high`；随后Node22 safe preflight、ffprobe准备、m104真实HTTP/fake Provider集成、源码覆盖及其行为检查；新增独立Node22备份/运行锁合成检查（m10/m93）。中等级告警不会使high阈值失败，CI绿色不等于依赖无告警或真实付费验收通过。

记录PR、branch/main CI run、tag object、peeled commit/tree和Release。已发布tag和产品构建不可改写；后续验收文档记录用自己的提交身份，不将文档HEAD冒充生产产品commit。

## 4. 从精确tag构建新目录

- 从已通过main CI的精确tag，用排除受保护路径的allowlist导出源码，落到全新staging目录；不上传脏工作树或复用旧dist。
- 在该目录按lock安装并用自身源码构建，核对Node/npm、源码清单不变、构建完整性。v0.7.14记录为921源码文件与33静态资源；这些是该次分母，下次须重新枚举。
- 使用NUL分隔文件名制作清单，排除清单自身和永久保护路径；校验源码身份和完整静态资产，不能只看一个JS文件。
- `scripts/deploy.mjs`已立即抛`LEGACY_DEPLOY_DISABLED`，不得执行旧rsync一键上线流程。
- `scripts/build-release.mjs`、`lib/release-source-pair.mjs`及配对演练工具绑定历史0.5.2/0.6.0合同，不是任意patch发布器；不要为了新版本改写历史工具。

## 5. 当前schema43备份门

当前使用不可变release内`backup-data.mjs` → `verify-backup.mjs` → `restore-backup.mjs`合同。正式切换前最新快照须持有真实冻结/静默证据并满足locked-exact：显式schema43、logical SHA、冻结时间、last Provider admission、独立scratch、外置签名/恢复key路径及精确媒体策略。

必须先核对当前活动任务、计费结果不明边界和publication，不伪造冻结时间或为通过门清理历史终态记录。备份不通过就不切换。`--external-freeze-non-final`不能冒充final candidate；schema42仅历史恢复，不能作为当前验收schema。

- 私钥内容不得输出或进仓库；新恢复目录私有且独立，不能覆盖CURRENT。
- verify通过后fresh restore，再核对schema43、integrity、FK、logical SHA及计数/媒体/secret清单。日志模式包含实际生产DELETE，不能只测WAL。
- 允许的历史媒体 warning 精确列入证据，不能写成“无媒体问题”；本轮 v0.7.16 的 98 条非阻断提示和最终媒体计数以发布回执为准。
- 真实云上传只在已授权范围进行，上传后需要GET哈希/大小核验，PUT成功本身不等于可恢复。
- `ops/production/backup-to-oss-retention.mjs`可创建当前加密备份并上传；它自身不自动完成verify/fresh restore/远端GET闭环，需要操作方案分别补齐。
- **当前自动备份故障尚未修好**：systemd仍调用`/opt/unboundry/scripts/backup-to-oss.mjs`，其旧子脚本要求schema41。不得把它作为当前备份入口。更不能仅因应用已升级就宣称每日备份生效。

### 5.1 经当次授权的停服保全备份

2026-09-09用户已明确同意本次v0.7.17使用`quiesced-active-preservation`。此方式保留结果未知的旧请求及防重复提交证据，不把它改成成功、失败、取消或无扣费。`locked-exact`的原有静默要求和`external-unverified`非最终性质保持；不能通过改旧记录或改readiness计数满足门。

只有以下证据全部成立，当前发布才可接受该独立captureMode：

1. 新生成已由真实管理员审计冻结，冻结时间与最后Provider准入匹配并经过至少60秒；无活动工作流和未完成媒体发布。
2. 已排空并停止旧应用，验证原进程身份确实退出；从精确既有runtime目录取得同一active lease，拒绝缺失、路径偏移、活进程或租约竞争。备份进程保持draining，不启动HTTP或生成worker；租约、secret锁、SQLite锁按既定顺序覆盖采集。
3. 使用当次明确允许的task ID、attempt身份及完整task/attempt/events摘要。其他活动任务、摘要变化或未列明边界使备份失败；保留全部原始记录及原请求标记，不进行解锁、重试、删改。
4. 签名加密清单记录该独立模式和保全证据，schema43、logical SHA、媒体与secret验证严格不减。`finalCandidate`不伪装成现有locked-exact的true；发布操作依据本节授权及完整保全证据单独准入。
5. 新包verify及独立fresh restore验证原始账本摘要、schema、完整性、FK、素材及secret一致。精确新→旧→新完整安装包演练验证原记录、画布及防重复提交保护；开关关闭的演练只能证明相应关闭范围，不扩大成正常开启自动恢复或付费生成证明。
6. 实现和本次操作脚本经独立复审。实际操作失败保留原数据、已存在备份和旧包；未完成恢复门不得切换。维护状态及恢复服务的处理按本次已核验操作单执行。

该模式的verify/restore使用本次精确v0.7.17包内工具；即使产品回退至v0.7.16，也保留该工具和密钥路径，不使用旧版解析器冒充新模式恢复。回退只切代码，绝不把备份还原覆盖CURRENT。

该规则不授权删除未知请求、付费重发或修复每日备份。每次保全必须重新绑定当前精确数据、任务范围、进程/租约和构建身份，不复用过期停服证明。具体实施状态和当次授权由TASKS维护，最终实测由本次发布回执维护。

## 6. 切换与回退

先准备本次精确新包、精确兼容回退包及数据保持策略，在隔离副本完成真实Linux HTTP保存/刷新和forward→rollback→forward；记录其与真实systemd切换测试的区别。正式维护中保留旧current身份，排空再原子切换；核对服务、版本、ready、数据及静态资源后解除维护。

v0.7.16当前回退约束：

- 当前新包：`/opt/unboundry/releases/v0.7.16-status-query-20260907`；固定回退包：`/opt/unboundry/releases/v0.7.15-bug-ui-20260907`。精确commit/tree、操作单和脚本SHA由本次发布回执拥有。
- 回退前确认当前仍是精确v0.7.16，按本次rollback.py重新执行静默、最新冻结备份/verify/fresh restore；只原子切换代码指针，保留CURRENT，不迁移schema或清理持久字段。
- RB05隔离Linux新→旧→新、原合成任务/草稿/素材和真实客户端bundle身份通过。它不等于实际线上systemd回退或真实Provider恢复。新素材必须在当前备份镜像中严格对应，缺失时停止；回退失败保持维护，不自动切回问题新包。
- v0.7.15→v0.7.14及其DELETE演练是历史证据，不替代本次身份。禁止跳过已核验回退候选直接切更老包；旧v0.7.13的parser/resize语义不兼容，v0.7.11代码检查点也不是数据库备份。

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

生产回执分别记录源码/CI、定向或full范围、备份/恢复/云端验证、生产数据和UI、未决风险、用户验收；本轮最终状态见 [v0.7.16 发布回执](spec/V0_7_16_PRODUCTION_RECEIPT_2026-09-07.json)。先是技术结果，只有用户明确通过才记对应范围USER_PASS。

更新CURRENT_STATE、TASKS、主题checkpoint、总矩阵及必要架构/操作文档。固定历史JSON、失败记录和tag不改写；演进中的当前回执补上后续验收事实。文档是否commit/push按用户当次授权，不能把旧发布授权扩为永久权限。

仅清理当次已获授权且确认身份的临时副本；保留用户数据与必要回退/恢复材料。不要为了收尾再部署、重复测试、真实生成或清空历史未决项。
