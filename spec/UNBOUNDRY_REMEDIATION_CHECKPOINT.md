# Unboundry 全量修复施工断点

断点版本：`15`
更新时间：`2026-08-12`
状态：`OFFLINE_GOAL_ACTIVE_REM-001_THROUGH_REM-009B_USER_REVIEW_REM-010_IN_PROGRESS_REM-011_NOT_STARTED`
用途：上下文压缩、任务中断或更换 Agent 后恢复施工；**本文件记录当前状态，不代替用户授权**。

## 1. 当前结论

- 用户已于 2026-08-09 明确回复“施工文档确认通过”，REM-000 = `PASS`。
- 施工总方案以 v1.0 建立权威合同，当前离线施工版本已更新为 v1.9-offline。
- 用户已于 2026-08-09 明确启动一次性离线 Goal，Goal ID `019fe226-4d7b-7831-a254-106e40b346c2`；REM-001～010 与 REM-011 离线工程部分可按依赖顺序连续施工，中途不再逐项询问。
- 允许本地代码/测试/脚本/配置/文档/package 修改、动态 loopback 临时环境、假 Provider/OSS/服务器、必要测试容器和本地 checkpoint/功能/candidate commit。
- 真实数据、4173、真实 Provider/OSS、canvas.mymy.ltd、SSH、生产、push、tag、PR、正式版本号与发布仍绝对禁止。
- REM-001～REM-009B 的离线工程候选与对应自动证据均已完成并进入 `USER_REVIEW`；当前唯一 `IN_PROGRESS` 项为 REM-010，但只落地了未接入服务路径的 runtimeRole leaf/专项合同与 legacy deploy fail-close，尚未完成/验收。REM-011 为 `NOT_STARTED`。

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
| 生产/历史数据库基线 | 线上 v0.5.1、schema `37`；一次独立审计曾越权用 immutable 只读聚合访问本地 `app/data`，结果未纳入证据，写入/外部请求为 0，之后未再访问 |
| 当前离线候选 | package `0.5.1`、schema `39`；production HOLD，v0.5.1 不可直接回滚该库 |
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
| REM-005 | 生成、幂等与付费边界 | `USER_REVIEW` | 原子 admission、最终付费闸、凭据 epoch、未知结果保护、deadline 与持久队列已完成 |
| REM-006 | 账号删除、模板、权限与清理 | `USER_REVIEW` | PERM-011/KEY-008/AUTH-006 合同、专项/核心/安全全量与独立终审已完成 |
| REM-007 | 前端生成恢复与失败体验 | `USER_REVIEW` | 四类 ownership/exact GET/终态 ACK、transport/retry fail-closed、mutation 失败体验及完整安全证据已完成 |
| REM-008 | 资源、安全、性能和运维脚本 | `USER_REVIEW` | 登录/SSE、媒体资源、出站、安全头、依赖、脚本及必要性能治理已完成 |
| REM-009B | 最终候选备份、恢复与双向兼容演练 | `USER_REVIEW` | 自动实现及同源自动证据完成；不是用户 PASS |
| REM-010 | 不可变发布、切换与回滚 | `IN_PROGRESS` | 仅 runtimeRole leaf/专项合同与 legacy deploy fail-close 已落地，尚未接线、未完成验收 |
| REM-011 | 候选全量验收与正式发布门 | `NOT_STARTED` | 尚未开始 |

REM-009B 的自动实现与自动证据已完成；REM-010 已进入施工但未实现验收，REM-011 尚未开始。

### 4.1 一次性授权的决策默认

- 账号删除继续遵守 `PERM-011 / KEY-008 / AUTH-006`；普通账号的公共模板及必要素材转交受保护最高权限账号，其他私有数据按既有合同安全清理；受保护最高权限账号绝不可删除。
- 原决策优先争取 schema 37 与 v0.5.1 数据格式双向兼容；REM-004 形成 schema 38、REM-005 追加 schema 39。REM-009B 已证明 exact v0.5.1 对 schema39 安全拒绝，迁移后不能回滚到 v0.5.1，并完成 exact-v0.5.1→current bridge→schema39 数据格式与拒绝边界矩阵；生产和迁移授权没有扩大。REM-010 bridge 接线、60 秒 admission 排空、切换和回滚硬门通过前绝不发布。
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
- current-database-open reservation 可序列化协作打开；同 UID 非协作进程仍可替换该极窄路径，作为残余边界保留。REM-010 的 runtime role/lease/drain 目前只是 leaf 与 m93 隔离合同，尚未接入应用启动、请求、worker 或 SSE 生命周期。

## 7. 当前执行路径

1. REM-009B 已完成同源自动证据并进入 `USER_REVIEW`；继续保留 REM-001 安全入口与 REM-002 运行时边界，任何后续测试只能经安全入口执行；
2. 当前实施 REM-010：把 runtime role/lease/drain 接入应用启动、请求、worker 与 SSE 生命周期，并补不可变 release、三层健康、排空、切换和回滚；真实数据/Provider/OSS、4173 与生产仍禁止；
3. schema 39 只在线下；REM-010 的唯一 active worker、切换、正式候选 release 和回滚硬门通过前 production HOLD；
4. 每个 REM 按施工总方案依赖顺序完成分析、实施、测试、独立 review 与文档同步；每个本地 commit 前核对范围，绝不 push/tag/PR；
5. 终点是固定 candidate SHA、G0～G6 离线证据、工程 `USER_REVIEW` 与页面 `USER_RECHECK`，生产和发布留待用户另行确认。

## 8. 未决决策

- `DEC-REM-001`：已确认（2026-08-09）；
- `DEC-REM-002`：已确认，允许仅本地 checkpoint/功能/candidate commit，绝不 push/tag/PR；
- `DEC-REM-003`：已确认，沿用 `PERM-011 / KEY-008 / AUTH-006`，公共模板及必要素材转交受保护最高权限账号；
- `DEC-REM-004`：已确认，REM-004 形成 schema 38、REM-005 追加 schema 39，当前为 schema 39 离线候选；生产 HOLD，REM-009B/010 桥梁、迁移、60 秒 admission 排空、回填故障与双版本矩阵未通过前不得发布；
- `DEC-REM-005/006`：正式版本号与发布授权，远期才可询问。

## 9. 恢复前检查卡

任何恢复者必须回答并核实：

```text
项目路径：/Users/mymy/Documents/unboundry/app
线上版本：v0.5.1
当前分支：codex/unboundry-offline-remediation-2026-08-09
起点 HEAD：262c66c4087d915b03971191ee00a9bfba74da65；REM-009B 功能提交 9a158a92563814791fefb8d4e6c5531eca610d78；当前 HEAD 以 git 只读结果对照本文件
最后完成工程候选：REM-009B（USER_REVIEW），核心 8-spec repeat=3 共 399/399，安全入口全量 114/912、912/912 PASS
冻结功能树指纹：7cf46804f952e580e9574a08a93f42ad53c051d4fcd5f2705691f82c8330326b（测试时父 HEAD bbcd5e0f6ca2096ed433d5ac45019c19aab50c53；未在功能 commit 后或文档后树重跑）
4173 listener：1be6a5d9061f3be72e5d45a0acf7cb70f5fe86ac645fceff60138b4b718d35dd（前后不变）
当前施工项：REM-010（IN_PROGRESS，尚未完成/验收）；REM-011 NOT_STARTED
下一步：接入 runtime role/lease/drain 并实现不可变 release、排空、切换与回滚；真实 Provider/OSS、4173 与生产继续禁止
代码授权：一次性离线 Goal 范围内已授权；Goal ID 019fe226-4d7b-7831-a254-106e40b346c2
真实数据操作：禁止
Provider 请求：禁止
commit/push/发布：仅本地 commit 已授权；push/tag/PR/发布禁止
```

任一项不一致时立即停止，更新证据并向用户说明，禁止根据摘要猜测。
