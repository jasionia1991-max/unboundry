# Unboundry 全量修复施工断点

断点版本：`7`
更新时间：`2026-08-09`
状态：`OFFLINE_GOAL_ACTIVE_REM-001_REM-002_USER_REVIEW_REM-009A_IN_PROGRESS`
用途：上下文压缩、任务中断或更换 Agent 后恢复施工；**本文件记录当前状态，不代替用户授权**。

## 1. 当前结论

- 用户已于 2026-08-09 明确回复“施工文档确认通过”，REM-000 = `PASS`。
- 施工总方案 v1.0 已成为本轮权威施工合同。
- 用户已于 2026-08-09 明确启动一次性离线 Goal，Goal ID `019fe226-4d7b-7831-a254-106e40b346c2`；REM-001～010 与 REM-011 离线工程部分可按依赖顺序连续施工，中途不再逐项询问。
- 允许本地代码/测试/脚本/配置/文档/package 修改、动态 loopback 临时环境、假 Provider/OSS/服务器、必要测试容器和本地 checkpoint/功能/candidate commit。
- 真实数据、4173、真实 Provider/OSS、canvas.mymy.ltd、SSH、生产、push、tag、PR、正式版本号与发布仍绝对禁止。
- REM-001 安全底座与 REM-002 API/进程基础工程候选均已完成并进入 `USER_REVIEW`；当前唯一 `IN_PROGRESS` 施工项为 REM-009A。

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
| 数据库最高迁移版本 | `37` |
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
| REM-009A | 真正只读的备份、恢复与数据库兼容前置底座 | `IN_PROGRESS` | 用户 2026-08-09 一次性离线 Goal 合并授权；当前唯一施工项 |

REM-003～011 尚未进入实施；离线工程权限已预先授予，达到施工总方案依赖后可连续进入下一项。REM-003～008 在 REM-009A 完成前只允许分析和不涉及持久迁移的准备。

### 4.1 一次性授权的决策默认

- 账号删除继续遵守 `PERM-011 / KEY-008 / AUTH-006`；普通账号的公共模板及必要素材转交受保护最高权限账号，其他私有数据按既有合同安全清理；受保护最高权限账号绝不可删除。
- 优先保持 schema 37 与 v0.5.1 数据格式双向兼容；必要 P0 若无法兼容，只在线下制作并完整验证桥梁候选与最终候选，绝不发布；P1/P2 不兼容扩张延期。
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
| commit/push/tag/发布 | 0 |

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
- 一次诊断全量检测到 Goal 外部的 4173 守护服务监听身份在运行期间改变，runner 按设计 fail-closed；本 Goal 没有连接、终止、重启或复用 4173。外部监听稳定后重新全量通过，前后监听身份 SHA-256 均为 `0bbb8e5874e169f362481f626b49123e554ae478e4c261b7691e2eb30e80c14f`。
- 本项保持 schema `37`、package `0.5.1`；安全 runner/测试子进程没有成功访问真实路径，真实 Provider/OSS/生产/SSH/push/tag/PR/发布均为 0。工程状态为 `USER_REVIEW`，不是 PASS。

## 7. 当前执行路径

1. 保留 REM-001 安全入口与 REM-002 运行时边界；任何后续测试只能经安全入口执行；
2. 当前实施 REM-009A：真正只读的合成数据库/媒体/密钥备份、加密包、恢复与损坏拒绝底座；
3. REM-009A 工程候选完成前，REM-003～008 只能分析或做不涉及持久迁移的准备；
4. 每个 REM 按施工总方案依赖顺序完成分析、实施、测试、独立 review 与文档同步；每个本地 commit 前核对范围，绝不 push/tag/PR；
5. 终点是固定 candidate SHA、G0～G6 离线证据、工程 `USER_REVIEW` 与页面 `USER_RECHECK`，生产和发布留待用户另行确认。

## 8. 未决决策

- `DEC-REM-001`：已确认（2026-08-09）；
- `DEC-REM-002`：已确认，允许仅本地 checkpoint/功能/candidate commit，绝不 push/tag/PR；
- `DEC-REM-003`：已确认，沿用 `PERM-011 / KEY-008 / AUTH-006`，公共模板及必要素材转交受保护最高权限账号；
- `DEC-REM-004`：已确认，首选 schema 37 与 v0.5.1 双向兼容；必要 P0 桥梁只在线下制作验证，P1/P2 不兼容扩张延期；
- `DEC-REM-005/006`：正式版本号与发布授权，远期才可询问。

## 9. 恢复前检查卡

任何恢复者必须回答并核实：

```text
项目路径：/Users/mymy/Documents/unboundry/app
线上版本：v0.5.1
当前分支：codex/unboundry-offline-remediation-2026-08-09
起点 HEAD：262c66c4087d915b03971191ee00a9bfba74da65；当前 HEAD 以 git 只读结果对照本文件
最后完成工程候选：REM-002（USER_REVIEW），安全入口全量 105/536、536/536 PASS
当前施工项：REM-009A（IN_PROGRESS）
下一步：完成真正只读的合成数据备份、加密、恢复、损坏拒绝和故障注入底座
代码授权：一次性离线 Goal 范围内已授权；Goal ID 019fe226-4d7b-7831-a254-106e40b346c2
真实数据操作：禁止
Provider 请求：禁止
commit/push/发布：仅本地 commit 已授权；push/tag/PR/发布禁止
```

任一项不一致时立即停止，更新证据并向用户说明，禁止根据摘要猜测。
