# Unboundry 全量修复施工断点

断点版本：`41`
更新时间：`2026-08-15`
状态：`INC_ECOM_002_PRODUCTION_READ_ONLY_AUDITED_RELEASE_CANDIDATE_AUTHORIZED_FULL_PENDING`
用途：上下文压缩、任务中断或更换 Agent 后恢复施工；**本文件记录当前状态，不代替用户授权**。

## 0. 当前新事件：INC-ECOM-002

- 用户已确认电商参考图工作流完整修复方案，并追加授权本地clean candidate、正式full和生产模板只读审计。
- 权威事件断点：`spec/INC_ECOM_002_REFERENCE_WORKFLOW_REMEDIATION_2026-08-15.md`。恢复者必须在本文件当前结论前先读取它。
- 当前阶段：`D3 生产只读模板审计完成，clean candidate与正式full施工中`。
- 已完成：参考图`prepare/send/cleanup`拆锁和Provider最终边界；五类阶段错误；整组task创建前全节点预检；缺失/停用模型显式阻止；模板edge角色/顺序保留；公共模板发布/恢复/更新兼容门；管理页矩阵和发布按钮门禁。
- 当前生产只读矩阵：schema39共19条模板（18 published、1 archived）全部`NEEDS_MODEL`，`INVALID=0 / PASS=0`；共99个执行节点未保存模型，其中published模板87个。「服装详情页｜面料与工艺拆解」为5个节点缺模型。矩阵文件：`spec/INC_ECOM_002_TEMPLATE_COMPATIBILITY_MATRIX_2026-08-15.md`。
- 已通过定向：m88含Storage busy与1/5/20并行`34/34`、m53 `23/23`、m22+m70+m77 `30/30`；旧Text输入提示误伤修复后的五spec `28/28`。最终安全入口发现`117 files / 953 tests`，全部非发布产品测试`113 files / 926 tests`为`926/926 PASS`且异常计数0，源码快照与4173不变、真实外部请求0。
- full边界：冻结清单已因新增Storyboard审计专项更新为`117 files / 954 tests`；m77当前`9/9 PASS`。用户已授权按正式source pair形成clean candidate并补full，不得绕过门禁。
- 用户设置的并发`500`、OSS路由、OSS配置/密钥/对象、生产数据和服务均禁止修改；真实Provider/OSS、付费、push/tag/PR和发布均未授权。
- `INC-ECOM-001 = USER_RECHECK` 的重复结果别名去重、节点错误落盘和既有结果恢复继续保留；不得把它扩大为参考图自锁、全图预检或模板包已验收。

## 1. 当前结论

- 用户已于 2026-08-09 明确回复“施工文档确认通过”，REM-000 = `PASS`。
- 施工总方案以 v1.0 建立权威合同，当前版本为 `1.30-production-operational-complete`。
- 用户已于 2026-08-09 明确启动一次性离线 Goal，Goal ID `019fe226-4d7b-7831-a254-106e40b346c2`；REM-001～010 与 REM-011 离线工程部分可按依赖顺序连续施工，中途不再逐项询问。
- 允许本地代码/测试/脚本/配置/文档/package 修改、动态 loopback 临时环境、假 Provider/OSS/服务器、必要测试容器和本地 checkpoint/功能/candidate commit。
- 用户在随后连续指令中授权并完成了bridge、final与schema39切换；该一次性生产授权现已消费，不得用于未来生产动作、Provider、push/tag/PR或新版本发布。
- 用户明确允许原生产使用实际 Node `22.23.2`，但 formal manifest 的 Node22.23.1 绑定保持原样，必须对相同候选在生产Node/SHA上做副本兼容补证；不得把waiver写成formal conformance。
- 用户还授权：仅在维护、旧服务停止、无写者、可恢复原始备份完成并精确复核后，删除唯一 FK 孤儿 `project_metadata rowid=14`；不得扩大为其他生产清理。
- 真实OSS只读HEAD/GET以及必要的bwrap安装/使用已经纳入最新bridge总授权；只允许按冻结控制器、最小权限和只读对象合同执行。
- 生产现运行 `/opt/unboundry/current -> releases/v0.6.0`，service active/enabled、NRestarts0、监听127.0.0.1:4173；公网live/ready/version/auth/root均200，ready active/schema39。
- 数据最新核验：schema39、integrity ok、FK0、row14 absent、active generation0、99 tasks/99 attempts、416 ready media（local346+OSS70）、pending0；globalEnabled1/emergencyStop0、每用户/每类型并发1、每分钟5。
- 原schema37 raw backup SHA `7f14c611faab136c1ae8e9579bc47755f7298e4ea6e2bba516c71e85670f8fca` 已离机恢复PASS，inspection `b4d58243e88efe1c2c967ffab5f63ed6704d18324a80e8449ec9d3ad77e28e1d`。最终技术凭证 SHA `5c78e7bca9af1c099e2d94e5120b63f867e4ea3b25bb61a18f751dfc8a46c2d8` 为 `TECHNICAL_CUTOVER_VERIFIED`。
- 技术凭证生成时 `userAcceptance=PENDING` 保持不变；用户随后确认生成任务状态可读取，并结合此前确认老项目大量生成/上传素材仍在、第4项正常，生产验收现为`USER PASS`，但不声称全部历史素材逐一验证。
- 最终切换是人工受控bounded cutover，不冒充新的formal controller/full regression PASS；切换期间Provider/付费调用0。REM-010/011与本次G7为`PASS`，REM-001～009B继续`USER_REVIEW`，当前没有IN_PROGRESS REM。
- 切换完成后用户另行明确授权真实生成和生产运维补验。唯一一次Doubao Seed文字任务`77d3feec-35c1-4b1e-87a2-c457983a8046`一次成功、无重试，结果“真实生成验收通过”，审计成本`10,000,000 microunits CNY`。公网Cookie、513,802,240字节上传/Range/完整下载、schema39自动OSS备份/保留与整机离机恢复均PASS；`DEP-003/005/006/007`与`OPS-002`闭环。用户随后明确“文档确认通过”，`DEP-010 = PASS`。该补验授权已经消费，未来Agent付费请求仍需新授权。
- 最后自动备份前缀`objects/backups/2026-08-14T23-15-59-569Z/`，356文件/267,091,270字节；active脚本SHA为`e50ac515…970c5`与`05721427…7b95f`。整机离机目录`/Users/mymy/Documents/unboundry/recovery/2026-08-15`，包874,823,680字节/SHA`d3b6023f…ae109`，fresh restore receipt SHA`151c7886…f3962`。

## 2. 项目身份

| 项目 | 当前记录 |
|---|---|
| 仓库根 | `/Users/mymy/Documents/unboundry/app` |
| 生产站点 | `https://canvas.mymy.ltd` |
| 线上版本 | `v0.6.0` / schema39 |
| package 版本 | 本地checkout package为`0.6.0`；生产F14 artifact commit为`eb4f99ea…`，不得与本地HEAD `a9051ce…`混同 |
| 生产程序目录 | 2026-08-14 原生产只读核实为 systemd `unboundry.service`、应用 `/opt/unboundry`；`/opt/unboundry-app` 仅为历史记录，不得用于动作目标 |
| 生产数据目录 | `/var/lib/unboundry` |
| 本地真实数据目录 | `/Users/mymy/Documents/unboundry/app/data` |
| 真实本地服务端口 | `4173`，有守护进程，不得用于测试 |
| 生产/历史数据库基线 | 当前schema39、integrity ok、FK0、row14 absent、ready local346/OSS70/pending0；迁移前schema37 raw备份及离机恢复证据保留 |
| 当前生产制品 | F14 `eb4f99ea525390b0dd7a39d3cad55d882ffea41d` / tree `86b4e424b6d6324c5f24d4c633b0cd35baf0d626` / manifest `46e2365c…` / inventory `ac8ca43a…` / tar `0e3a96a1…` |
| Node | formal构建/验证为v22.23.1；生产为`/opt/node22/bin/node` v22.23.2，production-specific waiver与恢复副本补证已完成 |

### 2.1 Goal 启动前只读预检

- 本机已有可隔离使用的 `/Users/mymy/.hermes/node/bin/node v22.23.1` + `npm 10.9.8`，`node:sqlite` 加载通过；推荐作为本地候选基线，不冒充已复核的生产版本。
- 已安装 `@playwright/test 1.62.0` 与本地 Chromium 缓存；如最终清单需缺失的浏览器二进制，须使用用户预先授权的官方依赖准备网络。
- Goal 启动前本机有 ffmpeg/ffprobe、SQLite 和 Docker CLI，当时 Docker daemon 未运行、本机无 nginx；用户后续已另行授权并完成隔离 Docker 子门，当前结果见 §6.11，仍不得声称已验证生产同版本模块。
- 当前可用磁盘约 `358 GiB`，容量不是已知启动阻塞。
- 上述只读预检未运行项目构建/测试，未操作 4173，未读真实数据，未请求 Provider/OSS/生产。

### 2.2 Goal 固定本地执行环境

- Node 固定使用 `/Users/mymy/.local/bin/node`（实际指向 `/Users/mymy/.hermes/node/bin/node`）`v22.23.1`，npm 固定为 `10.9.8`；先用本地缓存，缺失时只访问用户授权的官方 Node/Homebrew、npm、Playwright 或 Docker 镜像源。
- 依赖准备完成后，所有测试进程必须拒绝非 loopback 网络；真实 Provider/OSS/代理凭据不得进入测试进程。
- 当前专用分支：`codex/unboundry-offline-remediation-2026-08-09`；文档前起点为 `262c66c4087d915b03971191ee00a9bfba74da65`，一次性 Goal 本地基线 commit 为 `34909f283e417c6772dcbdfebb6e717db85d0605`。

## 3. Git 基线与已有改动

文档批次开始时：

- 分支：`main`；
- HEAD：`262c66c4087d915b03971191ee00a9bfba74da65`；
- 相对远端：`ahead 1`；
- 原本已修改且必须保留：
  - `TASKS.md`；
  - `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`；
  - `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`。

这些原有修改来自用户对六项验收通过的确认，不属于本轮待回退内容。REM-000 在其上追加文档，不得清理、reset 或覆盖。

## 4. 当前施工项

| ID | 内容 | 状态 | 用户授权 |
|---|---|---|---|
| REM-000 | 施工总方案、防漂移断点、项目级守则、入口和验收登记 | `PASS` | 用户 2026-08-09 确认通过 |
| REM-001 | 绝对隔离测试底座、动态端口/临时目录、零外网、真正全量发现 | `USER_REVIEW` | 工程候选与首轮全量证据已完成，Goal 结束时集中交用户复核 |
| REM-002 | API、进程与可观测性基础 | `USER_REVIEW` | 工程候选、专项与安全全量已完成，Goal 结束时集中交用户复核 |
| REM-009A | 真正只读的备份、恢复与数据库兼容前置底座 | `USER_REVIEW` | 加密签名包、合成恢复、损坏拒绝、三轮与安全全量均已完成，Goal 结束时集中交用户复核 |
| REM-003 | 画布持久化与 DATA-005 语义保护 | `USER_REVIEW` | 加载/保存凭据、每标签高水位、原子墓碑、持久草稿与生成门禁均已完成，Goal 结束时集中交用户复核 |
| REM-004 | 统一媒体生命周期 | `USER_REVIEW` | 原子媒体发布/补偿、ready-only、权威尺寸、adoption ACK 与完整性报告已完成 |
| REM-005 | 生成、幂等与付费边界 | `USER_REVIEW` | 原子 admission、最终付费闸、凭据 epoch、未知结果保护、deadline 与持久队列已完成 |
| REM-006 | 账号删除、模板、权限与清理 | `USER_REVIEW` | PERM-011/KEY-008/AUTH-006 合同、专项/核心/安全全量与独立终审已完成 |
| REM-007 | 前端生成恢复与失败体验 | `USER_REVIEW` | 四类 ownership/exact GET/终态 ACK、transport/retry fail-closed、mutation 失败体验及完整安全证据已完成 |
| REM-008 | 资源、安全、性能和运维脚本 | `USER_REVIEW` | 登录/SSE、媒体资源、出站、安全头、依赖、脚本及必要性能治理已完成 |
| REM-009B | 最终候选备份、恢复与双向兼容演练 | `USER_REVIEW` | 自动实现及同源自动证据完成；不是用户 PASS |
| REM-010 | 不可变发布、切换与回滚 | `PASS` | B14→F14正式链、formal Linux、Node22.23.2补证、raw备份/离机恢复、OSS70、条件修复、schema39迁移、current切换及最终健康全部完成；技术凭证`5c78e7bc…` |
| REM-011 | 候选全量验收与正式发布门 | `PASS` | F14 targeted81/full2832/race1420与formal Linux证据保留；生产v0.6.0/schema39技术核验完成，用户后续确认任务状态可读取；G7本次PASS |

REM-009B及REM-001～009B的`USER_REVIEW`保持不变；上线不替代用户逐项工程复核。REM-010/011、本次G7和生产用户验收已闭环。旧`8b639ffe…`、B13/F13与G5/G6继续只作历史/隔离回归证据。

### 4.1 历史一次性授权的决策默认（已消费）

- 账号删除继续遵守 `PERM-011 / KEY-008 / AUTH-006`；普通账号的公共模板及必要素材转交受保护最高权限账号，其他私有数据按既有合同安全清理；受保护最高权限账号绝不可删除。
- 原决策优先争取 schema 37 与 v0.5.1 数据格式双向兼容；REM-004 形成 schema 38、REM-005 追加 schema 39。REM-009B 证明 exact v0.5.1 对 schema39 安全拒绝，但 F-054 也证明旧 current bridge 只是合成角色。当前冻结 `v0.5.2` 双引擎：schema37 仅基础业务允许面 active、高风险 generation/media mutation fail-close、`generation_provider_attempts=0`且成功外部出站0；schema39 为完整回滚引擎。`v0.6.0` 为独立最终产物。生产和迁移授权没有扩大，DEC-REM-006 前绝不连接或发布。
- `F-001～F-054` 全部纳入；review 新发现且不改变产品合同的 P0/P1 登记后直接修复；无关 P2、视觉改版或新功能只登记。
- 保持 `DATA-005`、默认五项权限、500MB 视频合同和既有 PASS；不恢复金额/额度/订阅，不启用任何 PAUSED 范围。
- 遇到真实数据、生产连接、外部 Provider 或产品语义变化时登记并继续其他不依赖工作；仅在仓库身份被外部改变，或无法保证真实数据隔离与零外部请求时安全停止整个 Goal。

## 5. REM-000 历史变更范围

本批允许触及：

- `AGENTS.md`；
- `README.md`；
- `TASKS.md`；
- `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`；
- `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`；
- `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`；
- `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`。

本批禁止触及：`client/`、`server/`、`types/`、`scripts/`、测试文件、配置、package 文件、真实数据、生产主机。

## 6. 历史工程批次验证边界与最终生产证据

§6.1～§6.17按发生时点保留，不把其中“线上v0.5.1/HOLD/未授权”解读为当前状态；当前生产结果见§6.18。

只允许文档级只读验证：

- `git diff --check`；
- 文档路径和 REM ID 一致性搜索；
- Git 状态与变更范围核对；
- 不运行项目构建、Playwright、数据库、服务或网络测试。

已完成的文档级验证：

- `git diff --check` 通过；
- Git 变更范围恰好是第 5 节允许的 7 份文档：4 份已跟踪文档修改 + 3 份新文档，无业务代码、测试、配置或 package 文件变更；
- README / AGENTS / 施工总方案 / 断点 / 交接 / TASKS / 验收矩阵的读取顺序、授权和 REM 状态已交叉核对；
- 三路独立只读复核的可执行意见已逐项纳入；最终复核确认 `USER_REVIEW / USER_RECHECK / PASS`、真实数据隔离、旧备份/发布命令冻结和桥梁两次授权已一致；
- 未执行运行时测试，这是 REM-000 的主动安全边界，不得将文档检查误报为项目功能回归。

REM-000 文档批次外部动作计数（历史时点）：

| 动作 | 当前值 |
|---|---|
| 业务代码修改 | 0 |
| 运行时/浏览器测试 | 0 |
| 真实数据读取或写入 | 0 |
| 4173 操作 | 0 |
| Provider 请求 | 0 |
| 生产 SSH/修改 | 0 |
| 本地 commit | 0 |
| push/tag/发布 | 0 |

当前 Goal 治理披露：safe runner/tests 对真实路径的成功访问为 0；一次独立审计曾越权对 `app/data` 执行 immutable 只读聚合查询，结果未纳入证据，写入/外部请求为 0，之后未再访问。

### 6.1 REM-001 工程证据与边界

- 运行时已固定为 Node `22.23.1`、npm `10.9.8`；依赖只在跟踪文件隔离快照中以 offline/ignore-scripts 方式准备。
- 唯一安全入口：`node scripts/run-safe-tests.mjs <preflight|list|run|full>`。105 个 spec 精确分为 dev 73、hybrid 4、node 18、preview 2、self 8；当前发现 520 个唯一测试，0 skip/only/fixme。
- 每个 spec 使用新的系统临时目录、独立 data/HOME/cache/report/audit 与动态 loopback MAIN/AUX 端口。Node/浏览器拒绝非 loopback、未登记 loopback、Unix socket、自定义 DNS/transport 和 4173；网络负控 24 类、文件负控 24 类通过。
- 源码门：当前源文件 272；TS/TSX `258/258`，JS/MJS `14/14`；9 个运维脚本为 4 个行为验证 + 5 个哈希冻结。绿地、生产构建和两次重启持久化均在 sandbox 内通过。
- 诚实基线首次全量为 500 pass / 18 fail / 1 串行连带未执行。逐项修复陈旧断言、等待假绿与 review 发现的 P0/P1 后，F-035 定向 `8/8`、m17+m70 五轮 `120/120`、首轮修复后全量 `520/520 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0。
- 首轮修复后全量工作树指纹：HEAD `34909f283e417c6772dcbdfebb6e717db85d0605`，非忽略工作区内容 SHA-256 `ed4630555b9a10ea753c1456cc3bd251bc4d771fddbd6b6f0ab9eb5ad8f721eb`。这是未提交候选内容指纹，不是最终 candidate SHA。
- 每轮临时目录与受管进程组均已清理；4173 监听身份 SHA-256 前后均为 `d5670e320e7d8f9203a8a2f5d02b8c08c2e74352a4f7747c00b5ae42670f4bb7`。
- 本轮新增并登记：F-035（服务端信任伪造媒体元数据，基础修复已完成）、F-036（图片权威尺寸仍缺，待 REM-004/005）、F-037（账号浮层触发重复 hydration，已修）、F-038（render 内重定向，已修）、F-039（模板动画保存风暴，已修）、F-040（单行 session 高水位可被其他标签覆盖，待 REM-003）。
- `GOV-001`：只读 reviewer 曾枚举到被忽略真实目录中的文件名，但没有读取内容、stat/hash、修改或网络动作。后续只能陈述“安全 runner/测试子进程真实路径成功访问为 0”，禁止扩大为“整个 Goal 所有 agent 访问为 0”。
- REM-001 保持 schema `37`、package `0.5.1`；真实数据读取/写入、4173 操作、真实 Provider/OSS、生产、SSH、push/tag/PR/发布均为 0。工程状态为 `USER_REVIEW`，不是 PASS。

### 6.2 REM-002 工程证据与边界

- 13 处 JSON body reader 已统一大小上限、Content-Type、fatal UTF-8 和中止语义；20 个服务路径入口与 3 个编码文件名使用安全解码；所有异步 API 经统一边界转换为结构化 4xx/5xx。
- 每个请求使用 UUID request ID；日志只有固定 8 字段，不记录 URL、query、header、body、错误 message/stack，业务 4xx/5xx 不再被记成 `OK`。
- 维护/关闭时只放行经证明无副作用的 health/version 路由，其他 `/api`（包括会触发迁移、回填或任务恢复的 GET）统一 `503 + Retry-After`；排空同时覆盖 response、handler、未读请求体和 SSE。
- readiness 不调用 `openAppDatabase`、不初始化 taskStore、不创建业务行。它只读验证 schema 37 的 37 项迁移账本、19 张表、27 个显式索引、5 个触发器、SQLite 完整性及有限已证明的 v21/v31 物理形态；活跃 WAL 有 SHM 时读取已提交快照，无 SHM 时 fail-closed，未知或语义损坏 schema 不就绪。
- Vite dev/preview 精确捕获并恢复自己的 SIGTERM/SIGINT 监听器；超时/close 失败有硬截止。生成恢复、重试和新任务 3 个 detached 启动点的同步 throw、Promise rejection 与失败回写异常均被吸收。
- 新登记并关闭 F-041～F-047。专项 `m81 17/17 PASS`；固定 Node `22.23.1` / npm `10.9.8` 的最终安全全量为 `105/105 spec、536/536 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0；源码 274，TS/TSX `260/260`，JS/MJS `14/14`。
- 最终安全全量工作树：HEAD `4321f2da03cb496236747d8eaba21e98cd3d597a`，非忽略工作区内容 SHA-256 `608b7c665163199f79f97085e842651b6ff04c30ca1307443f019676da333a38`。这是 REM-002 提交前的内容指纹，不是最终 candidate SHA。
- REM-002 本地功能提交：`c7b2af01b5441fe9532d7f1e2696cd4fc2ceac89`；未 push/tag/PR。其后的文档断点提交不改变该功能内容。
- 一次诊断全量检测到 Goal 外部的 4173 守护服务监听身份在运行期间改变，runner 按设计 fail-closed；本 Goal 没有连接、终止、重启或复用 4173。外部监听稳定后重新全量通过，前后监听身份 SHA-256 均为 `0bbb8e5874e169f362481f626b49123e554ae478e4c261b7691e2eb30e80c14f`。
- 本项保持 schema `37`、package `0.5.1`；安全 runner/测试子进程没有成功访问真实路径，真实 Provider/OSS/生产/SSH/push/tag/PR/发布均为 0。工程状态为 `USER_REVIEW`，不是 PASS。

### 6.3 REM-009A 工程证据与边界

- 格式 2 包对数据库、媒体、密钥和假 OSS 镜像逐项加密并独立签名；恢复私钥与可信签名公钥不进入包或数据根。CLI 只接受显式绝对路径和 `--source-frozen`，无默认真实数据/备份路径。
- 源 SQLite 只复制 main/WAL/journal 到 0700 私有临时目录后处理；不调用 `openAppDatabase`、不 checkpoint、不迁移源库。前后数据库、media、secrets 全树和 source inode 均稳定。
- inspection 覆盖 schema37 的 37 项迁移、19 张业务表、`sqlite_sequence`、完整 schema 与行级逻辑 hash、integrity/FK；三类密钥文档使用真实 AAD 解密验证但只返回计数。
- 本地已登记文件、孤儿文件与 ready 假 OSS 对象内容均进入包；OSS 强制绑定 object_key、versionId、size、checksum。任何带 object_key 的 pending/failed 行 fail-closed。
- 所有输入文件在 lstat、fd-open、fd-after 三阶段校验 owner/root-current、无 group/other 写、inode、size、mtime/ctime、nlink=1；数据/包/工作/密钥路径校验原始和 realpath 父链。异常权限、硬链接、符号链接、特殊文件、路径穿越与 key-as-mirror 均拒绝。
- 创建和恢复使用独占 reservation、no-clobber 发布与 incomplete marker；readiness 使用 lstat 拒绝任何 marker。签名、manifest、每个密文对象、外来路径、并发替换和 checkpoint 故障矩阵均证明不覆盖既有目标。
- 新登记并关闭 F-050～F-053；REM-003 预审登记 F-048/F-049。专项 `m10 9/9`，最终快照三轮 `27/27`；最终安全全量 `105/105 spec、542/542 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0；源码 277，TS/TSX `262/262`、JS/MJS `15/15`。
- 最终全量非忽略工作区内容 SHA-256 `af762ea16b7b50abde3cc8dc0c3b020c043fc656d9e2321e938660fe72129a96`；4173 监听身份前后 SHA-256 均为 `0bbb8e5874e169f362481f626b49123e554ae478e4c261b7691e2eb30e80c14f`。
- 两路独立只读终审均确认剩余 P0/P1 为 0。REM-009A 功能提交 `ee998db80414cabb211fdc590712a0c257a25e50`；未 push/tag/PR。schema `37`、package `0.5.1` 不变，工程状态为 `USER_REVIEW`，不是 PASS。

### 6.4 REM-003 工程证据与边界

- 服务端保存使用 owner/canvas/revision/epoch 绑定的加载凭据与 session/sequence/attempt 高水位；canvas、项目 recency、墓碑复核和 TEMP 状态同事务。项目/账号删除回收精确，容量不足和故障整笔回滚；legacy 重启危险交接 fail-closed，不同标签继续保持 DATA-005。
- 客户端以账号+画布 scope、hydration identity 和 strict durable journal CAS 控制加载、普通保存、pagehide、丢响应、超时、BFCache 状态机、跨标签广播及外部基线重放。未知提交只重试原 attempt/payload；冲突或存储失败保留草稿并关闭生成。
- 四节点生成恢复、任务面板和重试均绑定当前 scope、generation input key 与 task owner；旧请求/旧任务/迟到取消或成功不能覆盖新输入。loading 期只接受 ReactFlow 纯被动 dimensions 测量，测量不进入持久指纹或生成 graph revision。
- 冻结测试源码指纹 `2ae382d4b0bed4cfa1e570d1e0172c2b84365dba4abf38ea095eb68e7c59875a`；Node `22.23.1`、npm `10.9.8`。13-spec 专项 `205/205`，m28 十轮 `30/30`，m41/m85/m86 三轮 `450/450`，安全全量发现/执行 `107/107 spec、687/687 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0。
- 清单模式 dev 74 / hybrid 4 / node 19 / preview 2 / self 8；源码 279，TS/TSX `264/264`、JS/MJS `15/15`，10 个运维脚本为 5 个行为验证 + 5 个哈希冻结。生产构建、两次重启持久化、临时目录清理通过；4173 监听身份前后 SHA-256 均为 `d57f27dc87024c26184ab9233355cabd31cd48d39c03bbe1d301fef586e4470c`。
- 独立终审确认剩余 P0/P1 为 0。相同功能文件内容提交为 `2a0b7f9819d3075d5fd339e20c5badd389cd51ae`；测试运行于提交前脏工作树的上述源码指纹，文档不冒充运行时已位于该 commit。schema `37`、package `0.5.1` 不变，未 push/tag/PR，工程状态为 `USER_REVIEW`，不是 PASS。

### 6.5 REM-004 工程证据与边界

- schema 38 离线候选用 publication/delete/account intent 与约束触发器统一媒体生命周期。本地与假 OSS 按 reserve → stage → publish → finalize 执行；媒体读取、历史、封面、下载和生成结果只消费 owner/kind 精确匹配的 ready 素材，失败用持久补偿和启动恢复收口。
- F-036 使用服务端权威尺寸；客户端只有同步 adoption ACK 成功才保留新素材；只读媒体完整性 CLI 与格式 2 备份核对 schema37/38、媒体、publication、密钥和假 OSS 证据。只关闭 F-004、F-036 与 F-005 的媒体发布子范围；Provider 付费/幂等留 REM-005，账号删除完整合同留 REM-006。
- 冻结源码指纹 `f6974d0456eb09b864e7302b85d47172d93d57182610ec42b95c42be4427454c`；8-spec 专项 `158/158`、同组三轮 `474/474`、安全全量 `109/109 spec、762/762 PASS`；failed/skipped/retries/reportErrors/blocked 均为 0。清单模式 dev 74 / hybrid 4 / node 21 / preview 2 / self 8；源码 284，TS/TSX `268/268`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结。
- REM-004 最终证据绑定监听身份 `c9663ffd4e9e26c675482e713e301f681f172b976a50df952d903fac9f00da0e`，各最终运行前后不变且本 Goal 未连接、终止或重启该监听。它与较早 REM 的历史 listener hash 不同，不能覆盖或改写旧批次证据。
- 两路独立终审无剩余即时产品 P0/P1。功能提交 `9f1019e5686ccce4f646b54a2be6ccd5ab4864d0`；测试绑定提交前相同功能内容的冻结工作区指纹，文档变更后的工作区 SHA 不冒充已运行证据。工程状态 `USER_REVIEW`，不是 PASS。
- schema 38 仅为必要 P0 的离线候选，线上 v0.5.1/schema37 未触碰，production HOLD。本段在 REM-004 时登记的富数据恢复、one-shot migrator、写锁内复核和回填故障恢复现已由 REM-009B 用合成数据完成；exact v0.5.1 对 schema39 安全拒绝且迁移后不能回滚，生产 bridge 接线及必要的两版本/两次授权仍归 REM-010。

### 6.6 REM-005 工程证据与边界

- schema 39 新增 owner-scoped idempotency、原子 generation admission 账本、credential epoch 高水位及带 outcome/revision/scope 的 Provider attempt 证据；schema 37/38 备份仍走各自冻结 exact contract。
- 新任务与幂等、安全开关、RPM/并发/熔断在同一 `BEGIN IMMEDIATE` 内提交；最终付费边界重查停止状态与 owner/model/profile/credential revision。accepted、response-received 或 outcome-unknown 均不能自动生成新付费 attempt，显式 abandon 保留 paid ledger 且 Provider 请求为 0。
- 关闭 F-008/F-009/F-010，并与 REM-004 一起关闭 F-005；F-014 只关闭 deadline 子范围。REM-005 只在单一 active process 前提下成立，F-023 继续归 REM-010。
- 冻结功能树指纹 `6a1363df8a6977e996db4b9e45aa823a89e28d6fe3955d85d6ea0ca9b315fcf9`；m81 `23/23`、6-spec 核心三轮 `207/207`、安全全量 `109/109 spec、790/790 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0。清单模式 dev 74 / hybrid 4 / node 21 / preview 2 / self 8；源码 285，TS/TSX `269/269`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结。
- 4173 listener 前后均为 `6fb8de970741a8dee0ab4c8790e237f3fe5a4c0a3cd4c1cd6a89af12fd6e16c7`，本 Goal 未连接、终止或重启该监听。三路独立终审无剩余即时产品 P0/P1。
- 测试运行于功能提交前、HEAD `2beaec585d2d33a11341b98349b31b89b41d3a62` 的上述冻结脏工作树；功能提交 `b3ceba04b5ddcf781dd58ce355be0e0f7665450e` 包含相同功能文件内容，未在该 commit 后或文档后树重跑。工程状态 `USER_REVIEW`，不是用户 PASS、真实数据迁移、真实 Provider/OSS、生产发布或 REM-011 最终三轮。
- migration 39 admission 表不从历史任务推断回填。REM-009B/010 必须先冻结新生成、排空活动任务并自最后一次可能 Provider admission 起等待至少 60 秒，再执行 one-shot exact-v37→schema39 迁移和唯一 active worker 启动；production HOLD。

### 6.7 REM-006 工程证据与边界

- 账号删除使用持久 account/media intent 和可重试 saga：先禁用账号并撤销 session，以 SQLite writer fence 和进程内 mutation/actor lease 建立提交顺序；活动或结果未知生成任务、媒体发布或关联未收口时拒绝物理删除。响应 close 只释放通用 request lease，删除 actor lease 保留到整个异步 saga 结束。
- 公共模板、封面/预览/图引用媒体及必要创建者字段转交受保护最高权限账号，私有模板、画布、项目、任务、历史、权限与凭据按合同清理。F-006/F-007/F-017A/F-033 已在离线候选关闭；F-032 继续旧 `PERM-011`，被删账号相关旧 `admin_audit_events` 清理，最终只由操作 actor 保留唯一 `delete_user` 审计。`KEY-008 / AUTH-006` 不回退。
- 权限编辑仅基于服务端有效额外授予集，GET 失败不会变成空草稿保存，同账号保存在途时禁用 checkbox/保存。账号凭据、Provider profile/catalog 与存储文档的 HTTP 变更都在最终线性化点持锁重查 actor，文档/业务元数据与审计一起成败；远程 probe 只在锁外执行，返回后必须重查。
- 冻结证据运行于功能提交前、HEAD `731b984d7e32a0b9ee648c0e7fa1bd49e59deb14` 下的 403-file 脏工作树，SHA-256 `9873952efd5a7b1f0d84d65698be79069a89aae47ab25ff277dabf6b4ef2016d`。14-spec 定向 `112/112`；核心 7-spec `repeat=3` 共 `222/222`；安全全量 `109/109 spec、804/804 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，`deniedViteWildcardProbes=477`。源码 286，TS/TSX `270/270`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结；4173 listener 前后均为 `38911ab014a12dd3353ee0897359ebfb26f075144de1ce0b35e760f2df6dea3d`。
- 独立终审无剩余即时产品 P0/P1。功能提交 `67cc39302d756bc00bff7ac31e31de7a7f574574` 包含与冻结脏工作树相同的功能文件内容，但未在该 commit 后或文档后树重跑。REM-006 工程状态为 `USER_REVIEW`，不是用户 PASS、真实数据/真实 Provider/OSS、生产迁移、发布许可或 REM-011 最终三轮。
- 上述 lease 和部分文档锁仅在单一 active process 内成立，不关闭 F-023，仍归 REM-010。账号删除是跨物理媒体的持久 saga，不是单 SQLite 事务；加密文档与 SQLite 只证明确定性审计失败时不留文档变更，不声称跨文件系统/SQLite 的进程崩溃原子性。线上 v0.5.1/schema37 不变，schema39 仅离线候选，production HOLD。

### 6.8 REM-007 工程证据与边界

- F-016/F-017B/F-018 已在离线候选修复。文字/图片/视频/音频节点以持久 `*GenerationOwnershipKey`、exact task/idempotency GET 与完整模型/参数快照绑定 active task；付费 POST 前先持久 effective snapshot 并取得 fresh canvas revision，新任务期间保留旧预览。对仍匹配当前 ownership 的 active task，success/failed/cancelled 节点状态先持久并获得 canvas ACK，再按 taskId 清 submission intent；preflight 拒绝保留 intent；恢复调用缺失或不同于已有 raw ownership proof 时不认领并保留。显式输入或新 ownership 会撤销/替换旧 intent；legacy signature 无法升级、恢复路径确认持久绑定已失效、提交前 exact GET 命中 cancelled，以及正式付费任务 POST 的确定性 4xx 等不可复用分支，按对应 guard 清理 intent；复制节点清除 generation binding。
- 正式付费任务 POST 及其响应体共用 deadline；该 POST 出现网络/status 0/5xx 未知结果时只按原 key exact GET reconcile，绝不重发付费任务 POST。retry 先保存取得 fresh revision，再由服务端最终 `BEGIN IMMEDIATE` 核验 live canvas/node/kind/taskId/inputKey/attempt/updatedAt；丢响应只对同 task exact GET reconcile。localStorage ownership/intent 写失败在付费前 fail-closed。
- Workspace create/rename/delete、CanvasShell create/clone/delete 与 UpdateNotice reload-after-save 各自具 in-flight fence 和显式失败处理；Workspace DELETE 与删除后核验所用列表 GET 具 deadline（列表覆盖 response body）。Workspace 删除向 ConfirmDialog 传入 busy，ConfirmDialog 负责 focus/Escape/a11y；CanvasShell 删除依靠外层 fence。
- 测试运行于功能提交前、HEAD `26ff9396194499365c79e5bc85238631ed44ef7a` 下的 403-file 冻结脏工作树，SHA-256 `ce7b4856b00b3ab12ee4853ece0b07b01dec86619bbca7865daa4edb659cc957`。adjacency 12-spec `142/142`；target 10-spec `255/255`；核心 8-spec `repeat=3` 共 `606/606`；安全全量 `109/109 spec、841/841 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=477`。Node `22.23.1` / npm `10.9.8`；源码 286，TS/TSX `270/270`、JS/MJS `16/16`；11 个运维脚本为 6 个行为验证 + 5 个哈希冻结；4173 listener 前后均为 `91689b3fefccfb3fe32ffc44e2b10a3146976b76d497183f56f7457924a7e219`。
- 独立终审无剩余即时产品 P0/P1。功能提交 `138f7ff0f9481e73355fbd9a9fd2c548ee9cee1a` 包含相同功能文件，但未在该 commit 后或文档后树重跑。REM-007 工程状态为 `USER_REVIEW`，不是用户 PASS、真实 Mureka/真实数据/真实 Provider/OSS、生产迁移、发布许可或 REM-011 最终三轮；真实 Mureka `INPUT-006 / AUDIO-REAL-001` 继续 PARTIAL/暂停。
- REM-007 无 schema 迁移；新增 ownership 是可选 canvas JSON/localStorage 字段，其旧数据格式与安全拒绝边界后来已由 REM-009B 矩阵覆盖。上述恢复合同只在单一 active process 内成立，不关闭 F-023，仍归 REM-010；不宣称跨标签分布式互斥。package `0.5.1`、线上 v0.5.1/schema37 不变，schema39 仅离线候选，production HOLD。

### 6.9 REM-008 工程证据与边界

- F-012～F-015 的离线候选范围已收口：登录采用有界 token bucket 与 fail-fast 密码校验并发，SSE 采用全局/每键连接和慢客户端准入；请求体、播放列表、缩略图、上传与生成结果走受控流式路径。Provider 结果和 OSS endpoint 拒绝私网/保留地址/IPv6，使用 DNS pinning、redirect fail-closed 与 deadline；只由假 Provider/OSS 和动态 loopback 证明。
- 保留 500MiB 视频合同；资源治理使用进程/账号/磁盘 reservation，ffmpeg/ffprobe 使用有界队列、超时、进程组 TERM→KILL 与输出上限。安全头、`nanoid 3.3.18`、当前 lock snapshot 离线 audit 0，以及密码重置/存储修复的默认 dry-run、显式 apply、可信路径、actor audit、锁/补偿/恢复均完成。
- F-025 只关闭密码重置和存储修复子范围；真实 OSS mirror/backup-to-OSS 保持冻结。F-030 只收口按需包、历史分页/懒加载、缩略图缓存和 object URL 生命周期等当前可验证子范围，不排除后续 P2 优化。F-028/F-034 继续由固定 Node 22 与动态全源码门满足。
- 测试运行于功能提交前、HEAD `d63af1224bbadfab00cdd65256c16afaf4195fa1` 下冻结脏工作树，SHA-256 `79625ac9768e99351f00190389a76e19945355405a3235608f219afd4d2d81be`。核心 15-spec `repeat=3` 共 `588/588`；安全全量 `111/111 spec、891/891 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=492`。Node `22.23.1` / npm `10.9.8`；源码 294，TS/TSX `277/277`、JS/MJS `17/17`；12 个运维脚本为 9 个行为验证 + 3 个哈希冻结；4173 listener 前后均为 `09d55bc82aab1e1f04aae60397395befd6d17c41b5b2622bcde7c4c7b1b8ec2`。
- 功能提交 `ff9a2adbb9ba93c9646935b2b22b318fb5503f21` 包含相同功能文件，未在该 commit 后或文档后树重跑。REM-008 工程状态为 `USER_REVIEW`，不是用户 PASS、真实 500MiB 上传、真实数据/Provider/OSS、浏览器 TLS/生产安全头、生产迁移、发布许可或 REM-011 最终三轮。
- 资源/SSE/进程/出站合同只在单一 active process 内成立，不是跨进程或多机配额；磁盘 reservation 不是 OS 全局配额，脚本不声称文件系统/SQLite 跨介质崩溃原子。F-020/F-024 归 REM-009B，F-022/F-023 归 REM-010。package `0.5.1`、线上 v0.5.1/schema37 不变，schema39 仅离线候选，production HOLD。

### 6.10 REM-009B 工程证据与边界

- 合成富数据/媒体/密钥/假 OSS 已完成格式 2 create→verify→restore、one-shot exact-v37→schema39 migration、写锁内来源复核、schema38/39 与回填故障恢复、假 OSS 重建、候选正常启动和冻结 exact-v0.5.1→current bridge→schema39 数据格式与安全拒绝边界矩阵；exact v0.5.1 对 schema39 安全拒绝，迁移后不能回滚到 v0.5.1。
- 测试在父 HEAD `bbcd5e0f6ca2096ed433d5ac45019c19aab50c53` 的同内容脏树运行，冻结 source SHA-256 `7cf46804f952e580e9574a08a93f42ad53c051d4fcd5f2705691f82c8330326b`：核心 8-spec `repeat=3` 为 `399/399`，`deniedViteWildcardProbes=567`；安全全量 `114/114 spec、912/912 PASS`，failed/skipped/retries/reportErrors/blocked 均为 0，full `deniedViteWildcardProbes=516`。Node `22.23.1` / npm `10.9.8`；源码 303，TS/TSX `283/283`、JS/MJS `20/20`；15 个运维脚本为 12 个行为验证 + 3 个哈希冻结；snapshot 未变，4173 listener 前后均为 `1be6a5d9061f3be72e5d45a0acf7cb70f5fe86ac645fceff60138b4b718d35dd`。
- 功能提交 `9a158a92563814791fefb8d4e6c5531eca610d78` 包含相同功能文件，但未在 commit 后或文档后树重跑。REM-009B 为 `USER_REVIEW`，不是用户 PASS、USER_RECHECK、真实数据/Provider/OSS、生产迁移、正式 candidate release 或发布证明。
- current-database-open reservation 可序列化协作打开；同 UID 非协作进程仍可替换该极窄路径，作为残余边界保留。REM-010 已另行接入 runtime role、跨进程 active lease 与 request/SSE/generation drain；这不消除该 REM-009B 极窄非协作路径边界。

### 6.11 REM-010/011 固定候选证据与剩余 G7 门

- runtime role、跨进程 active lease、请求/SSE/generation drain 已接入应用启动、请求、worker 与关闭生命周期，并由 m81/m93 覆盖；legacy `deploy.mjs` 保持立即 fail-close。
- Darwin 合成环境的不可变 builder/rehearsal、三层健康、排空、切换/回滚编排及静态 nginx/systemd 运维合同已实现。当时冻结发现清单 `117 specs / 931 tests`；源码 `309 = 286 TS/TSX + 23 JS/MJS`；运维脚本 `18 = 15 行为验证 + 3 哈希冻结`。此前 targeted m81/m93/m94/m95/m96 `49/49 PASS` 的历史证据保留。
- 第一轮 full 为 `117/117 specs、930/931 PASS`；唯一失败是 m92 bridge fixture 显式把 `UNBOUNDRY_MAINTENANCE_MODE` 设为空串，严格 runtime role 合同按设计返回 `RUNTIME_ROLE_INVALID`。未放宽产品 parser；仅把 fixture 改为 `UNBOUNDRY_RUNTIME_ROLE=active`、maintenance `0`，并在 m93 增补空串拒绝断言。随后 m92+m93 targeted `9/9 PASS`。
- fresh full 在 Node `22.23.1` / npm `10.9.8` 下为 `117/117 specs、931/931 PASS`，failed/skipped/retries/reportErrors/blocked 全 0，`deniedViteWildcardProbes=534`；builder operational `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file tested source snapshot SHA-256 `1e96e26feb6334611e9c2205e22d25c6eacbac54b224f44bd3b26bdcfd6f030b`，前后不变；4173 listener 前后均为 `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae`，suite cleaned、exit 0。
- `1e96e26f…` 是 m92 fixture 窄修复后、上一轮六文档同步前脏功能树的历史 full 指纹；不绑定 commit，也不是 fixed clean/formal candidate、REM-011 三轮、G0～G6、原生产、用户 PASS 或发布证明。
- 该 full 之后用户在隔离手工验收页发现 default 项目卡片错误路由与 Video 重复 Prompt 两个覆盖缺口。当前候选已统一 default 到 `/canvas`，并允许已就绪上游 Text 独立提供 Video 最终 Prompt；无任何有效文字仍阻止。m11+m30 经安全入口定向 `17/17 PASS`，源码快照 `f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be` 与 4173 listener 前后不变、零任务/零付费 Provider、suite cleaned。用户随后在端口 58352 的隔离实页明确确认两项修改均通过，`CANVAS-019 / INPUT-005` 恢复为 `PASS`。
- 页面修复后的首轮 full 为 `117/117 specs、930/931 PASS`，唯一失败是 m44 两个协作进程并发打开 exact-current DB 时暴露 reservation 创建/释放竞态，snapshot `84ddf2b9d74b551fecad7fb1e325055be3f8c42103bcf5018e06e2730030eb76`。产品并发协议把合法状态严格区分为 initializing/active/released，并继续对 stale、self-PID、malformed、unsafe 与替换路径 fail-close；m91 加入创建前和释放窗口的确定性双进程回归，m44+m91 targeted `15/15 PASS`。随后 fresh full 为 `117/117 specs、931/931 PASS`，failed/skipped/retries/reportErrors/blocked 全 0，`deniedViteWildcardProbes=534`；builder operational `attempts=1 / builderInvocations=3 / passed=1 / failed=0`。证据绑定 HEAD `9a76edc3deadad7fe1552977bb3f92baad019542` 下 429-file tested source snapshot `db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f`，前后不变；4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 前后不变，suite cleaned、exit0。
- 上述脏树先冻结为 clean candidate `b9b4691a1d06d8321578b7552ea5e14b23fb85e2`，但两个 OS 进程 Provider save 压力运行在 m44 暴露 `Application database sidecars changed before writer open`：最后一个旧 SQLite writer 关闭时可合法重建/清理 WAL/SHM。该真实交接竞态击穿了候选，`b9b4691…` 已失效，不得再作为正式候选或绿灯证据。
- 最小修复只收窄完整 WAL/SHM 对的合法交接窗口：普通只读 inspection 连接及读事务保持到新 writer 取得 `BEGIN IMMEDIATE`，完成 identity/sidecar/schema/digest 复核后再释放；hot WAL 与 zero-byte WAL 都走该 held-reader 路径，symlink、hardlink、unsafe mode、orphan sidecar、journal 与其他替换仍立即 fail-close。m91 对 hot-WAL 和 zero-WAL 的旧最后连接关闭均有确定性回归。
- F-054 前的历史 fixed clean offline candidate 为 commit `8b639ffe6c5f091c51e1914f2e2c18edf9333d90` / tree `219c4df072426cfe92f33dc4045f021064972e9c`，429-file source/snapshot SHA-256 `652b946441ee46e43bcbfbfc635dfc5aaacf5e640529ebec5bc7bd34c798dbb0`。三个独立全新环境 full 各 `117/117 specs、931/931 PASS`，合计 `2793/2793`；每轮 failed/skipped/retries/reportErrors/blocked 全0、`deniedViteWildcardProbes=534`、builder `1/3/1/0`，合计 builder `3/9/3/0`。两包竞态压力各 `570/570 PASS`，合计 `1140/1140`，覆盖5个spec各20次，异常计数全0；source/snapshot各轮不变，4173 listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 前后不变，suite cleaned、exit0。
- 用户授权的 `isolated-docker-ubuntu-amd64-ephemeral-candidate` 子门使用 Ubuntu 24.04.4 amd64/glibc 2.39。受控联网镜像/lock 依赖准备仅持有 package/lock 和私有 cache，不含项目源码、凭据或真实数据；随后正式容器为 `--network none`、无端口、无 host bind、非 privileged。429-file tar SHA-256 `08917263ed588d77c03d4a9123017119c86121a01b72d65b3e2a0fe11e8ecd01`，一次性 clean commit `6e1e9eef95e3c1f45cb0c5d11faa7c6cd16650fb` / tree `52f3a49fdec6a1a6fe036498d3c4cc0ed9628404`，`formalReleaseCommit=false`。
- 同一无网容器中隔离 cache 的 `npm ci --offline` 安装 185 packages 并 PASS；nginx `1.24.0` 对 active/maintenance 两份配置均 `nginx -t` PASS；systemd `255` 对 unit 的 `systemd-analyze verify` PASS。静态 validator `valid=true`，其 `production-host-not-inspected` 等 limitation 仍保留；未启动 nginx/systemd/Vite，未监听或连接 4173。
- production builder 以 `unboundry` 用户、0 effective capabilities 运行正式 Linux 分支；Docker Desktop 不提供 bwrap 所需 rootless user namespace，故返回 `RELEASE_COMMAND_FAILED`，保留 0700 release reservation 与 0600 `.incomplete`，没有完整 release。这是环境 BLOCK 与 fail-close 证据，不是 builder PASS。
- 2026-08-13 用户另行明确授权仅在第二台、非原项目生产的 Ubuntu 24.04 x86_64 服务器执行隔离 SSH 验证。`isolated-server-ubuntu-amd64-ephemeral-candidate` 使用 429-file tar SHA-256 `a322ec21affe7c2e73c510fceb74d5c953bee213b25084954b735f18d7be494b`，一次性 clean commit `ef206cd3dcc94ea6657a12ab7963580fe4e9bb5c` / tree `ab68ce7d3725869e674a7b7a7c3fdb0b74e5d29e`，`formalReleaseCommit=false`。
- 首次 production builder 将 `npm ci --omit=dev` 留下的空 `node_modules/@playwright` scope 目录误判为开发依赖，按设计 fail-close 并保留 `.incomplete`。窄修复仅允许该空目录，继续拒绝非目录或任一 `@playwright/*` 子项；r2 以普通 `unboundry` 用户、0 effective capabilities 在 Linux x64/glibc + bwrap 断网路径真实 PASS。release `host-validation-20260813-r2` 的 manifest SHA-256 `79e5d45dfbb9e51ec7fc60e1f5527a11f30f1d3d9638b682741c4306a25db02a`，5270 条 inventory 独立复核一致，目录为 0500、无 `.incomplete`，`networkSandboxVerified=true`，网络 namespace 拒绝探针通过，构建步骤未观察到外网尝试。
- 同一验证机的 active/maintenance 两份隔离配置真实 `nginx -t` PASS，`systemd-analyze verify` 命令 exit 0；未启动 nginx/systemd/Vite，现有 nginx/Docker 配置和服务未修改、未 reload/restart，4173 listener 为 0。
- `F-021/F-022/F-023` 的隔离 Linux 子门进一步收窄，`F-024/F-031` 继续受 REM-009B 矩阵约束。F-054 前该 core candidate 的离线 G0～G6 与三轮均曾全绿；这些历史结果不包含真实双引擎 bridge、原生产核验，也不扩大真实数据、Provider/OSS、迁移或生产边界。
- 上述结论是 F-054 发现前的历史状态：当时 REM-010/011 曾进入离线工程 `USER_REVIEW`。现在 `8b639ffe…` 只作产品 core 历史基线，不得作为 bridge/final release 绿灯。

### 6.12 F-054 与双版本当前断点

- 历史 F-054 审计确认当时 schema37 只进入 `schema37-health-only-standby`，业务 API 返回 `SERVICE_SCHEMA_STANDBY`；m95/rehearsal 的 bridge/exact/candidate 是合成夹具，没有运行真实业务 runtime 或真实迁移。故该时点 REM-010/011 回到同一收口工作流的 `IN_PROGRESS`；现行状态见 §6.14。
- 用户确认 DEC-REM-005 时 package 仍为 `0.5.1`；随后本轮桥梁源码证据快照将 package/lock 三处统一为 `0.5.2`。这两个时点都不授权 tag/release、原生产连接、迁移或发布，DEC-REM-006 pending。
- `v0.5.2` 冻结为单一不可变双引擎产物。共享 supervisor 是唯一公网 listener，先只读探测 schema，并统一执行 runtime role、active lease、request/SSE/generation drain。schema37 使用内嵌 exact-v0.5.1-compatible 引擎，只允许登录/会话、项目/画布等基础业务读写和既有媒体读取；生成提交/重试/取消、上传/删除/发布等高风险 generation/media mutation fail-close，离线验收 `generation_provider_attempts=0` 且成功外部出站0。schema39 使用内嵌 v0.6.0-compatible 引擎提供完整回滚；schema38/未知版本维护态 fail-close。启动和健康检查不得迁移。
- bridge manifest 必须分别绑定/hash supervisor、两个引擎、lock/build 输入和静态资源；运行时不得依赖 Git 或网络。`v0.6.0` 是独立不可变 final，只在显式 v37→v39 migration 后以 schema39 完整营业。
- 第一阶段重新验证 `v0.5.2`：schema37 allowlist 正向读写、高风险 mutation 全拒绝、`generation_provider_attempts=0`且成功外部出站0、schema39 回滚、schema38/未知拒绝、无启动迁移、唯一 writer/worker、排空/恢复和不可变 manifest。第二阶段验证 `v0.6.0`：显式迁移、schema39 完整业务、故障恢复、回滚到同一 `v0.5.2`、三个 fresh full、关键竞态压力、全部发现测试零异常。两阶段都只用临时合成数据、动态 loopback 与假 Provider/OSS。
- 两阶段全绿后也只进入 `USER_REVIEW`。未来 bridge 与 final 是两次独立生产动作，各自另获明确授权；当前真实数据、4173、真实 Provider/OSS、原生产 SSH/连接、push/tag/PR/release/production 均未授权且未执行。

### 6.13 双引擎桥梁源码 Mac 定向门

- 本轮桥梁源码快照为 package/lock `0.5.2`；安全清单 `117 specs / 938 tests`，源码 `319 = 292 TS/TSX + 27 JS/MJS`，运维脚本 `18 = 15 行为 + 3 冻结`。
- 四项 P1 已关闭：exact child 不持有 ffmpeg/ffprobe 且 duration 只由显式 migrator 回填；bridge/final 共享可重复验证的 runner 先决件；source-pair 只允许 `0.5.2→0.6.0` 直接子提交改三个版本值；m92 只运行 attested admitted artifacts 与 bridge 产物内 migrator。
- 首轮 `74/75` 唯一失败是 m92 `fetch` 夹具未保留显式 Host；产品代理头规则未放宽，夹具改 `node:http` 后 m92 `2/2 PASS`。最终发现 `117/938`、执行 `7 specs / 75 tests`且 `75/75 PASS`，异常计数全0、denied186、builder `1/5/1/0`。HEAD `8f607cdb5f70d760033699077dab738575a4ea69`，文档同步前 440-file source/snapshot `47fc53b93eaa6af2379484211979d7cec5199bc21dada1b424b0561f59d4c084` 前后不变，log `4e41ed6f23795eb161746c8d370bc75bf4570a0e3798f0358e2f7832a7a334db`，listener `dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae` 不变，suite cleaned、exit0。
- 该结果只是未提交 bridge 源码的 Mac `synthetic-direct-child-fixture`/artifact 定向门，非full/三轮/竞态压力/formal `v0.5.2`/formal `v0.6.0` direct child/Linux production/原生产/发布证明。

### 6.14 Formal B13/F13 收口与剩余 G5 边界

- formal bridge B13 为 `51ef51ad18ae7cb7053147ba3c1dc8577fcd771d` / tree `663228d401a03e0afaa4d644aa54347f065f3eaa` / `v0.5.2`；formal final F13 为 `a9051ce896cb6dda8e1ec6d1593f1de128484378` / tree `94bd8ccd8febb61aaa07304423f9c2242f4e96ac` / `v0.6.0`。F13 唯一父提交是 B13，二者仅 package.json/package-lock.json 三个版本值不同；source-pair proof `960f50b3bee454a30f148ca9db13379d3ad5275cb3109349285def71fbffb7e5`。
- formal targeted `79/79 PASS`。三个 fresh full 每轮 `117 specs / 942 tests`，合计 `2826/2826`；两轮关键竞态每轮 `6 specs × repeat 10 = 690/690`，合计 `1380/1380`。五轮 failed/skipped/retries/reportErrors/blocked 均为0，Node22.23.1/npm10.9.8、F13、443-file source/snapshot `b36a20db6fe3c75f20e59d5ed96bc98ed8737bbe85c4d05e0f7e3c59364e2436` 绑定一致，snapshot与4173 listener身份不变、suite cleaned。
- 第二验证机的隔离 Linux production-validation 外层 receipt PASS，SHA-256 `8f1ea00385828327d81bc7c9f9f7ef71a48fe87c58d6cb190ce45953a59c36eb`（inner `0195c8d096d7da5cd6643be0ed73c5d21e43d785ab4413f1664fd28506763969`）。它完成 B37→B39→F39→B39 rollback→F39 reswitch、schema37→39 migration、真实60秒drain、2次native duration probe、1条backfill、备份/验签/恢复与零成功外部出站；不等于原生产验证。
- F13 非根234节点依赖图与 REM-008 历史 audit=0 图逐项一致；本轮未刷新 advisory DB，不声称 fresh audit。G5 formal supplement 已以独立审批绑定在 Linux formal B13/F13 artifacts 上通过；可选 nginx/systemd/ffmpeg ops supplement 未运行且非本次 G5 normal-metrics 必要门。

### 6.15 G6 隔离用户验收

- 2026-08-14 用户在隔离临时数据与动态 loopback 端口完成 G6 并明确最终通过：A 为 B13/schema37 登录、Text/Image 与画布读写，文字在固定 250×250 内自动换行；B 为真实60秒排空及 v37→39 migration 后，在 F13/schema39 编辑、保存、重载；C 为回切 B13/schema39 后编辑、保存、重载；final 为再次切回 F13 的最终视觉复核。rollback 后画布 API 写缺口由 C 阶段关闭。
- G6 用户验收证据文件位于本轮私有保留根 `/private/tmp/unboundry-g6-20260814.4ZMd5W/evidence/g6-user-acceptance.json`，SHA-256 `d9f781600e169b93da6955fbc3395a24747edde148942b12fdcec7fa3d85358d`。验收结束后 61595/61596 listener 与本轮受管进程均为0，migration marker缺失、scratch为空；私有证据根因无创建哨兵而按 fail-close 规则保留，未递归删除。
- F13 阶段用户曾手动点击一次合成禁用 Provider `/test`，返回 HTTP 400，并使合成 credential 的 `key_status` 变为 `unknown`；`generation_provider_attempts=0`、无付费生成、成功外部出站0，但不得写成所有 Provider/test 请求为0。该 USER PASS 仅覆盖隔离候选，不是原生产、真实 Provider/OSS、公网兼容或发布证明。

### 6.16 G5 本地控制器资格验证

- 外置控制器 `/private/tmp/unboundry-g5-controller-v2.YWVsUN/g5-traffic-supplement.mjs` 冻结 SHA-256 `c78a6a367f07b72a043baf31e8d9ac80a459b029b26c4c50be7735415950b8b4`；它不属于 F13 tracked source，也未修改 product/release artifacts。
- 全新私有根 `/private/tmp/unboundry-g5-qualification-20260814.LUzWkg` 内的 synthetic-test 资格验证 PASS。receipt SHA-256 `6f2f2dcefbd45e2e1860c5017158d68ccd7a3e902bed946744725e98f098946d`，requests JSONL SHA-256 `49eddde273e06f33cf5aa6269d8fb3278d01d0b3eb2953d28bc3ee411d86ab23`。
- 同一合成 B/F 夹具依次运行 B37→显式 migration→B39→F39→B39 rollback→F39 reswitch；5 个 measured runtime 阶段、7 路 GET × 每路20次，共 `700/700` 完整且语义有效，mismatch/reset/timeout/oversize/其他传输错误均为0。观测 p50 `2.264ms`、p95 `6.617ms`、p99 `7.343ms`、max `9.102ms`；仅是当前 Mac synthetic 本地观测，不是 production SLO。
- valid complete200、complete500语义错、partial reset、hard timeout、8MiB+1 oversize、connection-refused 六类 loopback 状态机自测 PASS；4173 既有 listener 身份前后不变，受管进程组与动态端口清理完成，Provider/OSS/付费 workload 请求为0。
- receipt 明确 `formalG5Evidence=false`。它只证明控制器/分类器与合成流程具备进入后续 formal 审批审查的资格；不证明 Linux formal B13/F13、原生产、真实 Provider/OSS、ops supplement 或发布。任何第二验证机执行必须另获用户明确授权并使用独立不可变审批绑定。

### 6.17 G5 formal Linux supplement

- 用户于 2026-08-14 回复“ok 授权 go”确认 DEC-REM-007 后，既有第二台非生产 Linux 验证机按单次不可变审批执行一次且仅一次。executionId `61b1b5dfab2e78ec4fd8d93a2caa13af3f3e724cadb489133ff6b0e191d8e755`，approval SHA-256 `dfc267e115b2278a30c8f6b214fe30bef05abe7f0075856fc3686b5cfecccc6b`；one-shot marker 已消费，未重跑。
- 外层 receipt 为 `PASS / formalG5Evidence=true / g5NormalRequestMetrics=PASS`，SHA-256 `ed319a33611c8b0454fdab16e0ae85cc27bb1711a5c10a6df389bc57ee8d620b`；inner candidate SHA-256 `380ec25897f8d642c379301a313a572eb20d31e75a1ffefcc454a89487b64ad0`，requests JSONL SHA-256 `15d69b90ffdd4a686fd3653f664c0ec90f933281e16757f57ce07f13e5f43a92`。wrapper/controller/helper 分别固定为 `74e63ac68dd6a42f89f37dd577219adff5a4b3de320108a6e3f932aa2d8a4e43` / `41d5173e399a4b9dae0161e9d357254d5f4c6d6685af8c8b3b223cef83b82adb` / `46ec2a44fa71ba84eac7ffc02a561fedbe0a5550d3a6fa257cb8404b01d000c4`。
- B37/B39/F39/B39_ROLLBACK/F39_RESWITCH 五阶段各 `140/140`，共 `700/700` 且 700 条唯一；7 路 GET 每阶段各20次，全部 HTTP 200、传输完整、语义有效，mismatch/reset/timeout/oversize/other 均为0。观测 p50/p95/p99/max 为 `24.633/74.981/89.501/103.58ms`，hard deadline `2000ms`；这些数字不是原生产 SLO。六类负向状态机自测 PASS。
- final DB 为 schema39、integrity `ok`、FK violations `0`、migration marker absent、Provider attempts `0`；Provider/OSS/付费 workload 请求均为0。host before/after canonical 内容相同且 SHA-256 均为 `5474649e0e8b09914c1dbdcec349f928bbcb2ee1220fe6cbe22be6cf18398476`；4173 TCP/UDP 0、uid996进程0，旧验证根、服务、nginx与原生产禁区不变，进程组/动态端口/scratch均清零，证据根已封存。
- G6 C 阶段已关闭 rollback 后画布 API 写入缺口，因此 G5 coverage 现为 `PASS`。可选 nginx/systemd/ffmpeg/ffprobe ops supplement 仍未执行，但不是本次 `G5_NORMAL_REQUEST_METRICS_ONLY` 的必要门；本结果不证明原生产、真实 Provider/OSS或生产 SLO，也不授权 G7、tag、release、deploy、迁移或生产访问。

### 6.18 v0.6.0/schema39 最终生产切换与用户验收

- F14 production artifact：commit `eb4f99ea525390b0dd7a39d3cad55d882ffea41d`、tree `86b4e424b6d6324c5f24d4c633b0cd35baf0d626`、manifest `46e2365c48b8e8bdaa1847b1767ef2974a71f2d2b47c87743793c116e5ec2adf`、inventory `ac8ca43a9f8f6724ca67bd0899185fa3952e762e0400a1f9ce34f3ecfefc2bac`、tar `0e3a96a13299efba407ba98dc6501ae97297c9a82c067827b9f9befeb2c18944`。
- schema37 raw backup `7f14c611…`（267315200 bytes、0400）已离机恢复PASS；原logical SHA `3178d148…`，restore inspection `b4d58243…`。生产准备receipt `3d7c5992…`，prepared logical `ceaa4f35…`；schema39 target logical `1ba445af…`，postmigration inspection `a18f8224…`。
- 最终生产状态：current→`releases/v0.6.0`，service active/enabled、4173单监听；nginx配置SHA `2c6e90d1…`。DB schema39/integrity ok/FK0/row14 absent，99 tasks、99 attempts、416 ready media、active0/pending0；真实生成开启且安全阈值为1并发/每分钟5。
- 封存技术凭证远端路径 `/var/tmp/unboundry-final-94f66e5260759e7d58096fafd30c46f812f2cd96d4a18409d18ffbf1ab338c6d/evidence/FINAL-CUTOVER-SUPPLEMENT.json`，SHA `5c78e7bca9af1c099e2d94e5120b63f867e4ea3b25bb61a18f751dfc8a46c2d8`。凭证中的`userAcceptance=PENDING`为生成时点事实；用户之后确认生成任务状态可读取，生产另记USER PASS。
- 五条outcome-unknown attempt 86/108/116/120/122行政取消、禁止重试；`PROVIDER_FAILED`仅迁移/备份门surrogate，原REMOTE/TIMEOUT保留。三条音频仅修正duration元数据12.656→12.696，媒体bytes/checksum不变。cutover Provider/paid calls=0。
- 该结果是manual bounded cutover，不是formal controller PASS或切换后full regression PASS。REM-010/011与本次G7为PASS；REM-001～009B继续USER_REVIEW，其他未完成/暂停项不自动抬绿。

## 7. 2026-08-14 切换前执行路径（历史）

1. REM-001～009B保持`USER_REVIEW`；REM-010/011为B14/F14唯一`IN_PROGRESS`流。继续保留REM-001安全入口与REM-002运行时边界；
2. B14/F14 source pair与proof已形成，clean F14 targeted81/81、full2832/2832、race1420/1420已全部PASS；下一步完成formal Linux artifacts/receipt。旧B13/F13/G5/G6只作回归基线；
3. schema39仍只在线下；原生产第一阶段bridge完整执行已获授权，但formal Linux、正式备份/恢复材料、Node22.23.2副本门与条件式FK修复尚未完成，过门前production继续HOLD。真实OSS与bwrap可按冻结合同执行；final迁移/发布继续未授权；
4. 每个 REM 按施工总方案依赖顺序完成分析、实施、测试、独立 review 与文档同步；每个本地 commit 前核对范围，绝不 push/tag/PR；
5. `CANVAS-019 / INPUT-005` 既有用户 `PASS` 保持，G6 隔离候选验收为 USER PASS。REM-010/011 当前为 `IN_PROGRESS`；G5 coverage PASS 不自动提升新候选状态或授权 G7。

## 8. 2026-08-14 切换前决策记录（历史）

- `DEC-REM-001`：已确认（2026-08-09）；
- `DEC-REM-002`：已确认，允许仅本地 checkpoint/功能/candidate commit，绝不 push/tag/PR；
- `DEC-REM-003`：已确认，沿用 `PERM-011 / KEY-008 / AUTH-006`，公共模板及必要素材转交受保护最高权限账号；
- `DEC-REM-004`：已确认采用两版本；F-054 后真实双引擎 bridge 与 final 正在离线施工，旧 `8b639ffe…` 仅作 core 历史基线；
- `DEC-REM-005`：已确认，bridge `v0.5.2`、final `v0.6.0`；只确认版本号；
- `DEC-REM-006`：bridge `v0.5.2` 第一阶段连接/发布准备已授权但执行被当前STOP门阻断；final `v0.6.0` 迁移/发布仍 `PENDING`。
- `DEC-REM-007`：已确认并执行完毕（2026-08-14，用户回复“ok 授权 go”）；既有第二台非生产验证机以独立不可变审批完成唯一一次 G5 formal supplement，one-shot marker 已消费且结果 PASS。授权未扩张到原生产、4173、真实 Provider/OSS 或发布。
- `DEC-REM-008`：允许原生产Node22.23.2，须以production-specific supplement披露waiver并在恢复副本实测。
- `DEC-REM-009`：条件式删除唯一FK孤儿`project_metadata rowid=14`已授权；停服、可恢复备份、精确复核缺一即STOP。
- `DEC-REM-010`：真实OSS只读镜像与bwrap安装/使用仍`PENDING`。

## 9. 2026-08-14 切换前恢复卡（历史，禁止作为当前态）

任何恢复者必须回答并核实：

```text
项目路径：/Users/mymy/Documents/unboundry/app
线上版本：v0.5.1
当前分支：codex/unboundry-offline-remediation-2026-08-09
起点 HEAD：262c66c4087d915b03971191ee00a9bfba74da65；REM-009B 功能提交 9a158a92563814791fefb8d4e6c5531eca610d78；当前 HEAD 以 git 只读结果对照本文件
历史 REM-009B 工程候选：USER_REVIEW，核心 8-spec repeat=3 共 399/399，安全入口全量 114/912、912/912 PASS
冻结功能树指纹：7cf46804f952e580e9574a08a93f42ad53c051d4fcd5f2705691f82c8330326b（测试时父 HEAD bbcd5e0f6ca2096ed433d5ac45019c19aab50c53；未在功能 commit 后或文档后树重跑）
REM-009B 历史 4173 listener：1be6a5d9061f3be72e5d45a0acf7cb70f5fe86ac645fceff60138b4b718d35dd（该历史批次前后不变）
当前状态：REM-001～009B USER_REVIEW；REM-010/011 IN_PROGRESS；G5 coverage PASS；G6 USER PASS；G7 blocked，production HOLD
当前formal source pair：B14 3b48f61c1b16737247b9dae1145776d0287fdc72 / tree c8b0d75c9e3066d8b43ec71b24f729dbe12d468b / v0.5.2；F14 eb4f99ea525390b0dd7a39d3cad55d882ffea41d / tree 86b4e424b6d6324c5f24d4c633b0cd35baf0d626 / v0.6.0；唯一直接父子且仅三个版本值变化；proof 517d2d24d99e036432b10d720589fa885bd30191fd7f5e78a2a9604346ebf2a3
当前自动证据：两版m81 41/41、tsc/source coverage/build PASS；发现117 specs/944 tests。clean F14 targeted81/81、三轮full2832/2832、两轮race1420/1420全部PASS，所有异常计数0、五轮均exit0，source/snapshot 6af5b891ebf9a460e941485d12934a4a217ed3e2d6feece90d7c6d1b5ac856b1与4173不变、suite cleaned。日志SHA：targeted b9d260babe051c1f89ef86256ade2d57fda19b57009ec02e6973be441b5585bf；full 1f6f958d57ee855b0272ddd2576277deef6ea3e299e5ccdc597d4ca1d4559741 / 903096ed64412e184dcefecfc28c6fedda809c17a570d3fa8729a3d176560b0b / adecd5164828a87452bf5974a594c19da2e00e54f4aed281c113d57240b7917a；race 3d1b64868ef60e769158b31ee4f94efbed0015d251cfdac8b48f27f8918c5a18 / fc08356cf3bc9eb96e8b18abdd9789b96aa615361897a205240537e2ba29eb46。formal Linux artifacts/receipt尚未完成
历史B13/F13证据：targeted79/79；full2826；race1380；隔离Linux/G5/G6只作B14/F14回归基线
隔离Linux证据：outer receipt 8f1ea00385828327d81bc7c9f9f7ef71a48fe87c58d6cb190ce45953a59c36eb；B37→B39→F39→B39 rollback→F39 reswitch、60秒drain、备份恢复、外部成功出站0；不是原生产
依赖边界：F13非根234节点图与REM-008历史audit0图一致，但本轮不是fresh advisory audit
G5边界：Mac synthetic资格验证保留为formalG5Evidence=false；Linux formal supplement outer receipt ed319a33611c8b0454fdab16e0ae85cc27bb1711a5c10a6df389bc57ee8d620b，formalG5Evidence=true，五阶段700/700、传输错误0、六类状态机PASS、观测p50/p95/p99/max 24.633/74.981/89.501/103.58ms（非生产SLO）；可选ops supplement未运行且非本次必要门
G6证据：USER PASS；evidence SHA-256 d9f781600e169b93da6955fbc3395a24747edde148942b12fdcec7fa3d85358d；仅隔离候选，不是原生产或发布授权
历史 m92 修复后 full 指纹：HEAD 9a76edc3deadad7fe1552977bb3f92baad019542；429-file tested source SHA-256 1e96e26feb6334611e9c2205e22d25c6eacbac54b224f44bd3b26bdcfd6f030b；4173 listener dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae 前后不变
页面修复定向指纹：m11+m30 17/17；源码快照f714feb259dae032d61ad751feb5e67bb0bde07ea6cb0e6d026ecf07b903f9be；4173 listener同上且前后不变
历史页面/reservation修复后脏树 full：HEAD 9a76edc3deadad7fe1552977bb3f92baad019542；429-file tested source SHA-256 db91d80b2605d638f5cb2df296a81292b52dcf4b98fa874e934e83737495532f；117/117 specs、931/931 PASS；4173 listener dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae 前后不变
失效候选：b9b4691a1d06d8321578b7552ea5e14b23fb85e2，被最后旧SQLite writer关闭时的WAL/SHM交接竞态击穿，不得作为绿灯
产品core历史基线：commit 8b639ffe6c5f091c51e1914f2e2c18edf9333d90；tree 219c4df072426cfe92f33dc4045f021064972e9c；429-file source/snapshot SHA-256 652b946441ee46e43bcbfbfc635dfc5aaacf5e640529ebec5bc7bd34c798dbb0
历史core证据：三个独立fresh full各931/931、合计2793/2793；两包race各570/570、合计1140/1140，5 specs各20次；异常计数0；listener dfd25fc265125fe44b4046bb95bb89253a9ce7db9344e6afd4280f9a506e0dae不变；不得冒充v0.5.2/v0.6.0 release门
F-054：双引擎合同已建立，但B13缺两个生产历史exact raw-SQL hash；B14/F14已形成，须完成新formal门后才可继续bridge
下一步：完成formal Linux artifacts/receipt；随后依次完成Node22.23.2恢复副本、真实OSS只读镜像、正式备份恢复、条件式rowid14修复与bridge切换。上述bridge步骤均已授权但必须逐门PASS；final迁移/发布未授权
代码授权：一次性离线 Goal 范围内已授权；Goal ID 019fe226-4d7b-7831-a254-106e40b346c2
真实数据操作：仅rowid14严格条件删除已授权但先决条件未满足，当前禁止执行
Provider 请求：禁止
commit/push/发布：仅本地 commit 已授权；push/tag/PR/发布禁止
```

任一项不一致时立即停止，更新证据并向用户说明，禁止根据摘要猜测。

## 10. 2026-08-15 当前恢复卡

```text
项目路径：/Users/mymy/Documents/unboundry/app
本地文档checkout：branch codex/unboundry-offline-remediation-2026-08-09；HEAD a9051ce896cb6dda8e1ec6d1593f1de128484378；工作树含既有源码/测试改动与本轮七份文档改动，禁止reset/clean
生产：canvas.mymy.ltd；v0.6.0/schema39；/opt/unboundry/current -> releases/v0.6.0
生产artifact：commit eb4f99ea525390b0dd7a39d3cad55d882ffea41d；tree 86b4e424b6d6324c5f24d4c633b0cd35baf0d626；manifest 46e2365c48b8e8bdaa1847b1767ef2974a71f2d2b47c87743793c116e5ec2adf；inventory ac8ca43a9f8f6724ca67bd0899185fa3952e762e0400a1f9ce34f3ecfefc2bac；tar 0e3a96a13299efba407ba98dc6501ae97297c9a82c067827b9f9befeb2c18944
当前状态：REM-000 PASS；REM-001～009B USER_REVIEW；REM-010/011 PASS；G7（本次v0.6.0）PASS；PRODUCTION LIVE / USER ACCEPTED；无IN_PROGRESS REM
技术凭证：FINAL-CUTOVER-SUPPLEMENT.json SHA 5c78e7bca9af1c099e2d94e5120b63f867e4ea3b25bb61a18f751dfc8a46c2d8；TECHNICAL_CUTOVER_VERIFIED；manual bounded cutover；非formal controller/full regression PASS
用户验收：技术凭证形成后，用户另行确认生成任务状态可读取；结合此前确认老项目大量生成/上传素材仍在、第4项正常。不得扩大为全部历史素材逐一验证
数据库：schema39；integrity ok；FK0；row14 absent；99 tasks/99 attempts；416 ready media(local346+OSS70)；active0/pending0；globalEnabled1/emergencyStop0；per-user/kind concurrency1；RPM5
备份：schema37 raw archive SHA 7f14c611faab136c1ae8e9579bc47755f7298e4ea6e2bba516c71e85670f8fca；offhost restore inspection b4d58243e88efe1c2c967ffab5f63ed6704d18324a80e8449ec9d3ad77e28e1d PASS
限制：attempt 86/108/116/120/122为行政取消且禁止重试，PROVIDER_FAILED仅surrogate；3条音频仅改duration元数据；cutover Provider/paid calls=0
未来授权：本次bridge/final生产授权已消费；任何生产读写、真实Provider/付费生成、push/tag/PR或新版本发布均需新授权
下一步：没有本次发布链或文档验收遗留施工；DEP-010已由用户确认并转为PASS。只可按新任务处理既有PARTIAL/PAUSED/BLOCK/NOT_STARTED项
```

任何恢复者必须优先使用本节；第9节只保留历史，不得执行其“下一步”。
