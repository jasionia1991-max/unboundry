# Unboundry 全量修复施工断点

断点版本：`10`
更新时间：`2026-08-11`
状态：`OFFLINE_GOAL_ACTIVE_REM-001_REM-002_REM-003_REM-004_REM-009A_USER_REVIEW_REM-005_IN_PROGRESS`
用途：上下文压缩、任务中断或更换 Agent 后恢复施工；**本文件记录当前状态，不代替用户授权**。

## 1. 当前结论

- 用户已于 2026-08-09 明确回复“施工文档确认通过”，REM-000 = `PASS`。
- 施工总方案以 v1.0 建立权威合同，当前离线施工版本已更新为 v1.4-offline。
- 用户已于 2026-08-09 明确启动一次性离线 Goal，Goal ID `019fe226-4d7b-7831-a254-106e40b346c2`；REM-001～010 与 REM-011 离线工程部分可按依赖顺序连续施工，中途不再逐项询问。
- 允许本地代码/测试/脚本/配置/文档/package 修改、动态 loopback 临时环境、假 Provider/OSS/服务器、必要测试容器和本地 checkpoint/功能/candidate commit。
- 真实数据、4173、真实 Provider/OSS、canvas.mymy.ltd、SSH、生产、push、tag、PR、正式版本号与发布仍绝对禁止。
- REM-001 安全底座、REM-002 API/进程基础、REM-003 画布持久化、REM-004 统一媒体生命周期与 REM-009A 只读备份恢复底座工程候选均已完成并进入 `USER_REVIEW`；当前唯一 `IN_PROGRESS` 施工项为 REM-005。

## 2. 项目身份

| 项目 | 当前记录 |
|---|---|
| 仓库根 | `/Users/mymy/Documents/unboundry/app` |
| 生产站点 | `https://canvas.mymy.ltd` |
| 线上版本 | `v0.5.1` |
| package 版本 | `0.5.1` |
| 生产程序目录 | 历史交接记录 `/opt/unboundry`，旧部署计划记录 `/opt/unboundry-app`；当前未获 SSH 授权核实 |
| 生产数据目录 | `/var/lib/unboundry` |
| 本地真实数据目录 | `/Users/mymy/Documents/unboundry/app/data` |
| 真实本地服务端口 | `4173`，有守护进程，不得用于测试 |
| 生产/历史数据库基线 | 线上 v0.5.1、schema `37`；本 Goal 未读取或改动真实数据 |
| 当前离线候选 | package `0.5.1`、schema `38`；production HOLD，v0.5.1 不可直接回滚该库 |
| Node | 离线施工固定 `/Users/mymy/.local/bin/node`（指向 `/Users/mymy/.hermes/node/bin/node`）`v22.23.1` + npm `10.9.8`；历史生产记录为 `v22.23.2`，当前生产未复核 |

### 2.1 Goal 启动前只读预检

- 本机已有可隔离使用的 `/Users/mymy/.hermes/node/bin/node v22.23.1` + `npm 10.9.8`，`node:sqlite` 加载通过；推荐作为本地候选基线，不冒充已复核的生产版本。
- 已安装 `@playwright/test 1.62.0` 与本地 Chromium 缓存；如最终清单需缺失的浏览器二进制，须使用用户预先授权的官方依赖准备网络。
- 本机有 ffmpeg/ffprobe、SQLite 和 Docker CLI；Docker daemon 当前未运行，本机无 nginx。如需真实本地 `nginx -t`，Goal 授权必须包含仅用于测试的本地工具/固定镜像准备；仍不得声称已验证生产同版本模块。
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
| REM-005 | 生成、幂等与付费边界 | `IN_PROGRESS` | 用户 2026-08-09 一次性离线 Goal 合并授权；当前唯一施工项 |

REM-006～008、REM-009B～011 尚未进入实施；离线工程权限已预先授予，达到施工总方案依赖后可连续进入下一项。REM-009A 已解除核心持久化施工的前置阻断。

### 4.1 一次性授权的决策默认

- 账号删除继续遵守 `PERM-011 / KEY-008 / AUTH-006`；普通账号的公共模板及必要素材转交受保护最高权限账号，其他私有数据按既有合同安全清理；受保护最高权限账号绝不可删除。
- 优先保持 schema 37 与 v0.5.1 数据格式双向兼容；REM-004 的必要 P0 已形成 schema 38 离线候选，但生产和迁移授权没有扩大。REM-009B/010 桥梁、迁移和回滚硬门通过前绝不发布；P1/P2 不兼容扩张延期。
- `F-001～F-034` 全部纳入；review 新发现且不改变产品合同的 P0/P1 登记后直接修复；无关 P2、视觉改版或新功能只登记。
- 保持 `DATA-005`、默认五项权限、500MB 视频合同和既有 PASS；不恢复金额/额度/订阅，不启用任何 PAUSED 范围。
- 遇到真实数据、生产连接、外部 Provider 或产品语义变化时登记并继续其他不依赖工作；仅在仓库身份被外部改变，或无法保证真实数据隔离与零外部请求时安全停止整个 Goal。

## 5. REM-000 变更范围

本批允许触及：

- `AGENTS.md`；
- `README.md`；
- `TASKS.md`；
- `spec/UNBOUNDRY_HANDOFF_2026-08-09.md`；
- `spec/UNBOUNDRY_ACCEPTANCE_MATRIX.md`；
- `spec/UNBOUNDRY_REMEDIATION_PLAN_2026-08-09.md`；
- `spec/UNBOUNDRY_REMEDIATION_CHECKPOINT.md`。

本批禁止触及：`client/`、`server/`、`types/`、`scripts/`、测试文件、配置、package 文件、真实数据、生产主机。

## 6. 本批验证边界

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

本批外部动作计数：

| 动作 | 当前值 |
|---|---|
| 业务代码修改 | 0 |
| 运行时/浏览器测试 | 0 |
| 真实数据读取或写入 | 0 |
| 4173 操作 | 0 |
| Provider 请求 | 0 |
| 生产 SSH/修改 | 0 |
| 本地 commit | 已按授权创建 checkpoint/功能提交；REM-009A 与 REM-003 功能 SHA 见下文 |
| push/tag/发布 | 0 |

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
- schema 38 仅为必要 P0 的离线候选，线上 v0.5.1/schema37 未触碰，production HOLD。REM-009B/010 必须完成富数据 v37 格式 2 备份→恢复→迁移→启动、one-shot maintenance migrator、写锁内 exact-v37 复核、迁移后回填故障恢复、v37/v38 bridge、v0.5.1 数据格式矩阵及两版本/两次生产授权；当前 exact-v37 round-trip 与显式迁移角色只算离线结构证明。

## 7. 当前执行路径

1. REM-004 已完成并冻结证据；继续保留 REM-001 安全入口与 REM-002 运行时边界，任何后续测试只能经安全入口执行；
2. 当前实施 REM-005：用本地假 Provider 收口任务幂等、付费边界、限额、停止重查和未知结果保护；
3. schema 38 只在线下；REM-009B/010 桥梁、迁移、回填故障与双版本矩阵硬门通过前 production HOLD；REM-003 TEMP 高水位只在单一可写进程内可靠，REM-010 必须证明切换期间不会有两个可写服务；
4. 每个 REM 按施工总方案依赖顺序完成分析、实施、测试、独立 review 与文档同步；每个本地 commit 前核对范围，绝不 push/tag/PR；
5. 终点是固定 candidate SHA、G0～G6 离线证据、工程 `USER_REVIEW` 与页面 `USER_RECHECK`，生产和发布留待用户另行确认。

## 8. 未决决策

- `DEC-REM-001`：已确认（2026-08-09）；
- `DEC-REM-002`：已确认，允许仅本地 checkpoint/功能/candidate commit，绝不 push/tag/PR；
- `DEC-REM-003`：已确认，沿用 `PERM-011 / KEY-008 / AUTH-006`，公共模板及必要素材转交受保护最高权限账号；
- `DEC-REM-004`：已确认，必要 P0 已选择 schema 38 离线候选；生产 HOLD，REM-009B/010 桥梁、迁移、回填故障与双版本矩阵未通过前不得发布；
- `DEC-REM-005/006`：正式版本号与发布授权，远期才可询问。

## 9. 恢复前检查卡

任何恢复者必须回答并核实：

```text
项目路径：/Users/mymy/Documents/unboundry/app
线上版本：v0.5.1
当前分支：codex/unboundry-offline-remediation-2026-08-09
起点 HEAD：262c66c4087d915b03971191ee00a9bfba74da65；REM-004 功能提交 9f1019e5686ccce4f646b54a2be6ccd5ab4864d0；当前 HEAD 以 git 只读结果对照本文件
最后完成工程候选：REM-004（USER_REVIEW），安全入口全量 109/762、762/762 PASS，核心专项三轮 474/474
当前施工项：REM-005（IN_PROGRESS）
下一步：以本地假 Provider 收口幂等、任务插入、限额、Provider 前停止重查和未知结果不重复付费
代码授权：一次性离线 Goal 范围内已授权；Goal ID 019fe226-4d7b-7831-a254-106e40b346c2
真实数据操作：禁止
Provider 请求：禁止
commit/push/发布：仅本地 commit 已授权；push/tag/PR/发布禁止
```

任一项不一致时立即停止，更新证据并向用户说明，禁止根据摘要猜测。
